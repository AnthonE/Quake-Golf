#!/usr/bin/env node
// M3: the Deno relay with its referee, and four Chrome clients (WebGPU on, a
// golf bot at each pair of hands) playing one hole over an impaired network.
// The last client joins late, from a keyframe; one client gets a bit of its
// world flipped mid-hole, which the referee's hash check must catch, name and heal.
//   node net/run-m3.mjs [--clients 4] [--seed 7] [--late 15] [--flip 25] [--impair delay=150,jitter=15,loss=0.1] [--limit 420]
// (impair's delay is the round trip, half each way; loss applies each way)
// The gate, each part in report.gate:
//   the hole ends with every ball sunk;
//   on every client, a change of keys shows in the predicted player within 25 ms (p95);
//   the late client starts from a keyframe after sim tick 0 with under 400 ticks to fast-forward;
//   the flip is one mismatch, on that client only, named as the slice flipped, and healed;
//   every other interval hash on every client equals the referee's;
//   no client is behind at the end.
// Screenshots land in traces/m3-*.png, the report in traces/m3.json.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { serve } from '../tools/serve.mjs';
import * as L from '../src/layout.mjs';
import { percentile } from './wire.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const clients = Number(opt('clients', 4));
const seed = opt('seed', '7');
const late = Number(opt('late', 15)); // seconds before the last client joins
const flipAt = Number(opt('flip', 25)); // seconds in, once play is under way; 0 for no flip
const limit = Number(opt('limit', 420)); // give up after this many seconds
const port = Number(opt('port', 4433));
const impair = opt('impair', 'delay=150,jitter=15,loss=0.1');
const shots = opt('shots', '1') !== '0';
const DENO = existsSync('.tools/deno') ? '.tools/deno' : 'deno';
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// The flip: bit 3 of the client's own running total, state that matters (the
// scoreboard shows it) and that nothing changes mid-hole, so the slice is certain.
const flipAddr = (slot) => L.PLAYERS + slot * L.PSIZE + L.P_TOTAL;
const FLIP_BIT = 3;

execFileSync('sh', ['tools/cert.sh'], { stdio: 'inherit' });
execFileSync(process.execPath, ['tools/asm.mjs'], { stdio: 'inherit' });
const hash = readFileSync('certs/hash.txt', 'utf8').trim();
mkdirSync('traces', { recursive: true });
const summaryPath = 'traces/m3.relay.json';
rmSync(summaryPath, { force: true });

const relay = spawn(DENO, ['run', '--unstable-net', '-A', '--v8-flags=--single-threaded-gc', 'net/relay.ts', '--port', String(port), '--seed', seed,
  '--duration', String(limit + 60), '--summary', summaryPath, '--quiet', ...(argv.includes('--verbose') ? ['--verbose'] : [])], { stdio: ['ignore', 'inherit', 'inherit'] });
const relayDone = new Promise((ok) => relay.on('exit', ok));
await new Promise((ok) => setTimeout(ok, 1500));

const require = createRequire(import.meta.url);
const { chromium } = (() => { for (const n of ['playwright', 'playwright-core']) { try { return require(n); } catch { /* next */ } } throw new Error('playwright not found'); })();
const { server, port: webPort } = await serve();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || (existsSync(LOCAL_CHROMIUM) ? LOCAL_CHROMIUM : undefined),
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const pages = [];
const q = new URLSearchParams({ bot: '1', present: '0', url: `https://127.0.0.1:${port}/`, hash, impair });
const open = async (k) => {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') process.stderr.write(`\n[client ${k}] ${m.text()}\n`); });
  page.on('pageerror', (e) => process.stderr.write(`\n[client ${k}] ${e.message}\n`));
  await page.goto(`http://127.0.0.1:${webPort}/client/index.html?${q}`);
  pages[k] = page;
};

const report = { clients, seed: Number(seed), late, impair, flip: null, holes: null, clientsEnd: [], gate: {} };
async function capture(page, file) {
  const png = await page.evaluate(() => window.__qg.capture?.(2)).catch(() => null);
  if (!png) return;
  writeFileSync(file, Buffer.from(png, 'base64'));
}

const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(0);
const states = () => Promise.all(pages.map((p) => p?.evaluate(() => window.__qg?.state?.() || window.__qg || null)));
let snapAt = 0;
try {
  for (let k = 0; k < clients - 1; k++) { await open(k); await new Promise((ok) => setTimeout(ok, 1000)); }
  let lateOpened = clients === 1;
  for (;;) {
    if (Date.now() - t0 > limit * 1000) { report.error = `no finished hole after ${limit} s`; break; }
    if (!lateOpened && Date.now() - t0 > late * 1000) { await open(clients - 1); lateOpened = true; }
    await new Promise((ok) => setTimeout(ok, 1000));
    const st = await states();
    if (st.some((s) => s?.error)) { report.error = `client ${st.findIndex((s) => s?.error)}: ${st.find((s) => s?.error).error}`; break; }
    const line = st.map((s, k) => !s ? `c${k}: -` : s.me
      ? `c${k}:${['i', 'c', 'p', 'o'][s.hole.state]} t${s.hole.tick} q${s.queued} s${s.me.strokes}${s.me.done ? 'IN' : ''} L${s.lead.toFixed(1)} D${s.delay.toFixed(1)} r${s.repairs} k${s.keys}`
      : `c${k}: ${['connecting', 'catching up', 'joined', 'failed'][s.clState]}`).join(' | ');
    if (argv.includes('--verbose')) process.stderr.write('\n' + st.map((s, k) => `c${k} ${JSON.stringify(s?.net)} play ${s?.play?.toFixed(1)} room ${s?.room} next ${s?.next}`).join('\n') + '\n');
    process.stderr.write(`\r${secs()} s  ${line}   `);
    if (shots && Date.now() - snapAt > 30000) {
      snapAt = Date.now();
      for (const [k, p] of pages.entries()) if (p) await capture(p, `traces/m3-c${k}-${secs().padStart(3, '0')}s.png`);
    }
    // the flip, on client 1 once its ball is in play
    if (flipAt && !report.flip && pages[1] && Date.now() - t0 > flipAt * 1000 && st[1]?.hole.state === L.H_PLAY && st[1].clState === 2) {
      const addr = flipAddr(st[1].slot);
      await pages[1].evaluate(([a, b]) => window.__qg.flip(a, b), [addr, FLIP_BIT]);
      const slice = Math.floor((addr - L.REGION) / L.SLICE);
      report.flip = { client: 1, slot: st[1].slot, atS: Number(secs()), tick: st[1].hole.tick, addr, bit: FLIP_BIT, slice, field: L.describeSlice(slice) };
      process.stderr.write(`\n[flip] client 1 at sim tick ~${st[1].hole.tick}\n`);
    }
    if (lateOpened && st.every((s) => s?.me && s.hole.state === L.H_OVER && s.me.holes >= 1)) {
      report.holes = st.map((s) => ({ slot: s.slot, score: s.me.score, done: s.me.done, doneTick: s.me.doneTick, overTick: s.hole.tick }));
      for (const [k, p] of pages.entries()) await capture(p, `traces/m3-c${k}-scoreboard.png`);
      break;
    }
  }
  process.stderr.write('\n');
  // every client steady on the playout clock (a resync just now catches up in a second or two)
  for (let k = 0; k < 15; k++) {
    await new Promise((ok) => setTimeout(ok, 1000));
    if ((await states()).every((s) => s?.clState === 2)) break;
  }
  report.clientsEnd = await Promise.all(pages.filter(Boolean).map((p) => p.evaluate(() => {
    const q = window.__qg;
    const s = q.state();
    return { slot: s.slot, clState: s.clState, tick: s.hole.tick, repairs: s.repairs, lead: s.lead, delay: s.delay, jitter: s.jitter,
      hashes: q.hashes, keys: q.keys, desyncs: q.desyncs, syncs: q.syncs, fills: q.fills, latency: q.latency, holes: q.net()?.holes || [] };
  })));
} finally {
  await browser.close();
  server.close();
  relay.kill('SIGTERM');
  await Promise.race([relayDone, new Promise((ok) => setTimeout(ok, 5000))]);
}

const relayRun = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : null;
const ref = new Map((relayRun?.refHashes || []).map(([t, h]) => [t, h]));
const ms = (a) => { const s = [...a].sort((x, y) => x - y); return { n: s.length, p50: percentile(s, 0.5), p95: percentile(s, 0.95), max: s.at(-1) }; };
const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? Number(v.toFixed(1)) : v]));
const perClient = report.clientsEnd.map((c, k) => {
  const flipped = report.flip?.client === k;
  // the flipped client's hashes from the flip until it restored the desync's keyframe are its own
  const heal = flipped ? c.keys.find((x) => x.reason === 3)?.simTick ?? Infinity : -1;
  let compared = 0, wrong = 0, excused = 0;
  for (const [t, h] of c.hashes) {
    if (!ref.has(t)) continue;
    if (flipped && t > report.flip.tick - L.NSLICE && t <= heal) { excused++; continue; }
    compared++;
    if (ref.get(t) !== h) wrong++;
  }
  return {
    client: k, slot: c.slot, clState: c.clState, repairs: c.repairs, lead: Number(c.lead.toFixed(1)), delay: Number(c.delay.toFixed(1)), jitter: Number(c.jitter.toFixed(2)),
    keys: c.keys.map((x) => ({ reason: ['join', 'hole', 'behind', 'desync'][x.reason], simTick: x.simTick })), fillTicks: c.fills.map((f) => f.ticks),
    syncs: c.syncs.map((x) => ({ why: ['join', 'hole', 'behind', 'desync'][x.why], next: x.next, newest: x.newest, after: x.after, behind: x.behind })),
    holes: c.holes, desyncs: c.desyncs, compared, wrong, excused,
    predictedMs: round(ms(c.latency.pred)), confirmedMs: round(ms(c.latency.conf)),
  };
});
report.perClient = perClient;
report.relay = relayRun && {
  repairs: relayRun.repairs, repairTicks: relayRun.repairTicks, keys: relayRun.keys, compared: relayRun.compared, agreed: relayRun.agreed,
  mismatches: relayRun.mismatches, dumps: relayRun.dumps, refLagMax: relayRun.refLagMax, refErrors: relayRun.refErrors,
  closeLateMs: relayRun.closeLateMs, stalls: relayRun.stalls, maxBundle: relayRun.maxBundle, downKBpsPerSession: relayRun.downKBpsPerSession, upKBpsPerSession: relayRun.upKBpsPerSession,
};
const lateC = perClient[clients - 1];
const flipC = report.flip ? perClient[report.flip.client] : null;
const mism = relayRun?.mismatches || [];
const gate = {
  holeEnded: !!report.holes,
  everyoneSank: !!report.holes && report.holes.every((h) => h.done),
  predictionInstant: perClient.every((c) => c.predictedMs.n >= 10 && c.predictedMs.p95 <= 25),
  lateJoinFromKeyframe: !!lateC && lateC.keys[0]?.reason === 'join' && lateC.keys[0].simTick > 0 && lateC.fillTicks[0] < 400,
  flipCaughtNamedHealed: !report.flip || (mism.length === 1 && mism[0].slot === report.flip.slot
    && flipC.desyncs.length === 1 && flipC.desyncs[0].slice === report.flip.slice && flipC.keys.some((x) => x.reason === 'desync')),
  hashesAgree: perClient.every((c) => c.compared >= 8 && c.wrong === 0),
  noneBehind: perClient.every((c) => c.clState === 2),
};
report.gate = { ...gate, pass: Object.values(gate).every(Boolean) };
writeFileSync('traces/m3.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, clientsEnd: undefined }, null, 2));
console.log(report.gate.pass ? 'M3 gate: PASS' : 'M3 gate: FAIL');
process.exit(report.gate.pass ? 0 : 1);
