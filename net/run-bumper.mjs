#!/usr/bin/env node
// Bumper balls online: a relay on bumper balls' sim, AI balls through its
// native door (net/bot-host.mjs --bumper, one world shared by them all), and
// Chrome playing the page with an AI ball at its controls, over a lossy
// network if asked. Passes when the referee checked interval hashes from
// every session and none differed, balls were knocked out, a round was won,
// and Chrome kept up. Screenshots go to traces/.
//   node net/run-bumper.mjs [--bots 15] [--chrome 1] [--seconds 60] [--impair delay=60,jitter=10,loss=0.05] [--shots 1] [--res 1280x800]
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { serve } from '../tools/serve.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const nbots = Number(opt('bots', 15));
const chrome = Number(opt('chrome', 1));
const seconds = Number(opt('seconds', 60));
const impair = opt('impair', '');
const shots = opt('shots', '1') !== '0';
const port = 4433;
const DENO = existsSync('.tools/deno') ? '.tools/deno' : 'deno';
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

execFileSync('sh', ['tools/cert.sh'], { stdio: 'inherit' });
execFileSync(process.execPath, ['tools/asm.mjs'], { stdio: 'inherit' });
const hash = readFileSync('certs/hash.txt', 'utf8').trim();
mkdirSync('traces', { recursive: true });
const summaryPath = 'traces/bumper.relay.json';
rmSync(summaryPath, { force: true });
const relay = spawn(DENO, ['run', '--unstable-net', '-A', '--v8-flags=--single-threaded-gc', 'net/relay.ts', '--port', String(port), '--seed', '7',
  '--wasm', 'build/bumper/game.wasm', '--duration', String(seconds + 40), '--summary', summaryPath, '--quiet'], { stdio: ['ignore', 'inherit', 'inherit'] });
await new Promise((ok) => setTimeout(ok, 1500));
const botsPath = 'traces/bumper.bots.json';
rmSync(botsPath, { force: true });
const bots = nbots ? spawn(process.execPath, ['net/bot-host.mjs', '--bumper', '--relay', '127.0.0.1:4434', '--bots', String(nbots), '--seconds', String(seconds + 10), '--quiet', '--out', botsPath],
  { stdio: ['ignore', 'inherit', 'inherit'] }) : null;
const botsDone = bots ? new Promise((ok) => bots.once('exit', ok)) : null;

const require = createRequire(import.meta.url);
const { chromium } = (() => { for (const n of ['playwright', 'playwright-core']) { try { return require(n); } catch { /* next */ } } throw new Error('playwright not found'); })();
const { server, port: webPort } = await serve();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || (existsSync(LOCAL_CHROMIUM) ? LOCAL_CHROMIUM : undefined),
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const pages = [];
// software WebGPU here, so the page draws at golf's 320 x 200 unless asked for more (--res 1280x800)
const q = new URLSearchParams({ bot: '1', present: '0', url: `https://127.0.0.1:${port}/`, hash, impair, net: opt('net', '0'), skill: '0.9', res: opt('res', '320x200') });
const report = { bots: nbots, chrome, seconds, impair: impair || 'none', screenshots: [], errors: [] };
const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(0);
try {
  for (let k = 0; k < chrome; k++) {
    const page = await browser.newPage({ viewport: { width: Math.max(640, Number(opt('res', '320x200').split('x')[0])), height: Math.max(400, Number(opt('res', '320x200').split('x')[1])) } });
    page.on('console', (m) => { if (m.type() === 'error') { report.errors.push(m.text()); process.stderr.write(`[chrome ${k}] ${m.text()}\n`); } });
    page.on('pageerror', (e) => { report.errors.push(e.message); process.stderr.write(`[chrome ${k}] ${e.message}\n`); });
    await page.goto(`http://127.0.0.1:${webPort}/client/bumper.html?${q}`);
    pages.push(page);
  }
  let snapAt = 0;
  while (Date.now() - t0 < seconds * 1000) {
    await new Promise((ok) => setTimeout(ok, 1000));
    const st = await Promise.all(pages.map((p) => p.evaluate(() => window.__qa?.state?.() || window.__qa || null)));
    if (st.some((s) => s?.error)) throw new Error(st.find((s) => s?.error).error);
    process.stderr.write(`\r${secs()} s  ${st.map((s, k) => s?.me ? `c${k}: P${s.slot + 1} ${s.me.wins}w/${s.me.kos}ko ${s.me.out ? 'out' : 'in'} round ${s.round.hole + 1} ${['idle', 'countdown', 'play', 'over'][s.round.state]} ${s.round.left}/${s.round.n0} left` : `c${k}: ${s?.clState ?? '-'}`).join(' | ')}     `);
    if (shots && pages.length && Date.now() - snapAt > 4000 && st[0]?.me) {
      snapAt = Date.now();
      const png = await pages[0].evaluate(() => window.__qa.capture?.(2)).catch(() => null);
      if (png) { const f = `traces/bumper-${secs().padStart(3, '0')}s.png`; writeFileSync(f, Buffer.from(png, 'base64')); report.screenshots.push(f); }
    }
  }
  process.stderr.write('\n');
  const end = await Promise.all(pages.map((p) => p.evaluate(() => window.__qa.state())));
  report.chromeState = end.map((s) => ({ fps: s.fps, slot: s.slot, wins: s.me?.wins, kos: s.me?.kos, rounds: s.me?.rounds, behind: s.clState !== 2, feed: s.feed, round: s.round.hole }));
  report.chromeHashes = await Promise.all(pages.map((p) => p.evaluate(() => window.__qa.hashes.length)));
} finally {
  await browser.close();
  server.close();
  bots?.kill('SIGINT');
  await Promise.race([botsDone, new Promise((ok) => setTimeout(ok, 5000))]);
  // the relay writes its summary as it goes: 256 sessions' of it takes a moment
  const relayDone = new Promise((ok) => relay.once('exit', ok));
  relay.kill('SIGTERM');
  await Promise.race([relayDone, new Promise((ok) => setTimeout(ok, 15000))]);
}
const r = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : null;
report.relay = r && { sessions: r.sessions, compared: r.compared, agreed: r.agreed, mismatches: r.mismatches, keys: r.keys, repairs: r.repairs, downKBpsPerSession: r.downKBpsPerSession, upKBpsPerSession: r.upKBpsPerSession, tickBytes: r.tickBytes };
const b = existsSync(botsPath) ? JSON.parse(readFileSync(botsPath, 'utf8')) : null;
report.botHost = b && { joined: b.joined, rejected: b.rejected, errors: b.errors, cpuPctOfOneCore: b.cpuPctOfOneCore, meanStepMs: b.world.meanStepMs, worstStepMs: b.world.worstStepMs,
  wins: b.world.players.reduce((n, p) => n + p.wins, 0), kos: b.world.players.reduce((n, p) => n + p.kos, 0),
  rounds: Math.max(0, ...b.world.players.map((p) => p.rounds)), downKBpsEach: b.sessions.length ? Number((b.sessions.reduce((n, x) => n + x.downKB, 0) / b.sessions.length / seconds).toFixed(1)) : 0 };
const gate = {
  everyBotIn: !nbots || (!!b && b.joined === nbots && !b.errors.length),
  refereeChecked: !!r && r.compared >= 4 * (nbots + chrome),
  hashesAgree: !!r && (r.mismatches?.length ?? r.mismatches) === 0 && r.agreed === r.compared,
  knockouts: (report.chromeState || []).some((s) => s.kos > 0) || (report.botHost?.kos ?? 0) > 0,
  // a round takes a minute or so (90 s at most) after its 5 s countdown
  aRoundWon: seconds < 100 || (report.chromeState || []).some((s) => s.wins > 0) || (report.botHost?.wins ?? 0) > 0,
  chromeKeptUp: (report.chromeState || []).every((s) => !s.behind),
  noErrors: report.errors.length === 0,
};
report.gate = { ...gate, pass: Object.values(gate).every(Boolean) };
writeFileSync('traces/bumper.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
console.log(report.gate.pass ? 'Bumper gate: PASS' : 'Bumper gate: FAIL');
process.exit(report.gate.pass ? 0 : 1);
