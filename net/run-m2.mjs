#!/usr/bin/env node
// M2: the Deno relay and two Chrome clients (WebGPU on, a golf bot at each
// pair of hands) play one hole end to end over real WebTransport. The second
// client joins late, from a keyframe (M3; in M2 it replayed the room's history).
//   node net/run-m2.mjs [--clients 2] [--seed 7] [--late 4] [--limit 300] [--impair delay=40,jitter=10,loss=0.02]
// The gate: every client sinks its ball (no penalty) and the hole ends on the
// scoreboard; every 128-tick interval hash agrees across clients; no client
// is left behind the playout clock. Screenshots land in traces/m2-*.png.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { serve } from '../tools/serve.mjs';
import * as L from '../src/layout.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const clients = Number(opt('clients', 2));
const seed = opt('seed', '7');
const late = Number(opt('late', 4)); // seconds before the second client joins
const limit = Number(opt('limit', 300)); // give up after this many seconds
const port = Number(opt('port', 4433));
const shots = opt('shots', '1') !== '0';
const DENO = existsSync('.tools/deno') ? '.tools/deno' : 'deno';
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

execFileSync('sh', ['tools/cert.sh'], { stdio: 'inherit' });
execFileSync(process.execPath, ['tools/asm.mjs'], { stdio: 'inherit' });
const hash = readFileSync('certs/hash.txt', 'utf8').trim();
mkdirSync('traces', { recursive: true });
const summaryPath = 'traces/m2.relay.json';
rmSync(summaryPath, { force: true });

const relay = spawn(DENO, ['run', '--unstable-net', '-A', '--v8-flags=--single-threaded-gc', 'net/relay.ts', '--port', String(port), '--seed', seed,
  '--duration', String(limit + 30), '--summary', summaryPath, '--quiet'], { stdio: ['ignore', 'inherit', 'inherit'] });
await new Promise((ok) => setTimeout(ok, 1500));

const require = createRequire(import.meta.url);
const { chromium } = (() => { for (const n of ['playwright', 'playwright-core']) { try { return require(n); } catch { /* next */ } } throw new Error('playwright not found'); })();
const { server, port: webPort } = await serve();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || (existsSync(LOCAL_CHROMIUM) ? LOCAL_CHROMIUM : undefined),
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const pages = [];
// present=0: headless Chrome loses the WebGPU device presenting a canvas, so
// frames are drawn only for captures, read back from the GPU
const impair = opt('impair', '');
const q = new URLSearchParams({ bot: '1', present: '0', url: `https://127.0.0.1:${port}/`, hash, impair });
const open = async (k) => {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') process.stderr.write(`[client ${k}] ${m.text()}\n`); });
  page.on('pageerror', (e) => process.stderr.write(`[client ${k}] ${e.message}\n`));
  await page.goto(`http://127.0.0.1:${webPort}/client/index.html?${q}`);
  pages[k] = page;
};

const report = { clients, seed: Number(seed), late, impair: impair || 'none', holes: [], intervalsCompared: 0, mismatches: [], keys: [], repairs: [], screenshots: [] };
async function capture(page, file) {
  const png = await page.evaluate(() => window.__qg.capture?.(2)).catch((e) => { process.stderr.write(`\ncapture: ${e.message}\n`); return null; });
  if (!png) return;
  writeFileSync(file, Buffer.from(png, 'base64'));
  report.screenshots.push(file);
}

const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(0);
let snapAt = 0;
let over = null;
try {
  await open(0);
  for (let k = 1; k < clients; k++) { await new Promise((ok) => setTimeout(ok, late * 1000)); await open(k); }
  for (;;) {
    if (Date.now() - t0 > limit * 1000) throw new Error(`no finished hole after ${limit} s`);
    await new Promise((ok) => setTimeout(ok, 1000));
    const st = await Promise.all(pages.map((p) => p.evaluate(() => window.__qg?.state?.() || window.__qg || null)));
    if (st.some((s) => s?.error)) throw new Error(st.find((s) => s?.error).error);
    const line = st.map((s, k) => s?.me ? `c${k}: slot ${s.slot} ${['idle', 'countdown', 'play', 'over'][s.hole.state]} t${s.hole.tick} strokes ${s.me.strokes}${s.me.done ? ' IN' : ''} holes ${s.me.holes}` : `c${k}: ${s ? ['connecting', 'catching up', 'joined', 'failed'][s.clState] : '-'}`).join(' | ');
    process.stderr.write(`\r${secs()} s  ${line}      `);
    if (shots && Date.now() - snapAt > 20000) {
      snapAt = Date.now();
      for (const [k, p] of pages.entries()) await capture(p, `traces/m2-c${k}-${secs().padStart(3, '0')}s.png`);
    }
    // the first hole to reach the scoreboard, as every client saw it
    if (!over && st.every((s) => s?.me && s.hole.state === L.H_OVER && s.me.holes >= 1)) {
      over = st.map((s) => ({ slot: s.slot, score: s.me.score, done: s.me.done, strokes: s.me.strokes, doneTick: s.me.doneTick, overTick: s.hole.tick, keys: s.keys }));
      for (const [k, p] of pages.entries()) await capture(p, `traces/m2-c${k}-scoreboard.png`);
      break;
    }
  }
  process.stderr.write('\n');
  // let every client step to the same point, then compare interval hashes
  await new Promise((ok) => setTimeout(ok, 2000));
  const all = await Promise.all(pages.map((p) => p.evaluate(() => window.__qg.hashes)));
  const maps = all.map((list) => new Map(list.map(([t, h]) => [t, h])));
  for (const [t, h] of maps[0]) {
    if (!maps.every((m) => m.has(t))) continue;
    report.intervalsCompared++;
    if (!maps.every((m) => m.get(t) === h)) report.mismatches.push({ tick: t, hashes: maps.map((m) => m.get(t)) });
  }
  const end = await Promise.all(pages.map((p) => p.evaluate(() => window.__qg.state())));
  report.holes = over;
  report.keys = end.map((s) => s.keys);
  report.repairs = end.map((s) => s.repairs);
  report.ticks = end.map((s) => s.hole.tick);
  report.behind = end.map((s) => s.clState !== 2);
} finally {
  await browser.close();
  server.close();
  relay.kill();
}
const relayRun = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : null;
report.relay = relayRun;
const gate = {
  holeEnded: !!report.holes,
  everyoneSank: !!report.holes && report.holes.every((h) => h.done),
  hashesAgree: report.intervalsCompared >= 4 && report.mismatches.length === 0,
  noneBehind: report.behind.every((b) => !b),
};
report.gate = { ...gate, pass: Object.values(gate).every(Boolean) };
writeFileSync('traces/m2.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, relay: undefined }, null, 2));
console.log(report.gate.pass ? 'M2 gate: PASS' : 'M2 gate: FAIL');
process.exit(report.gate.pass ? 0 : 1);
