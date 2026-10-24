#!/usr/bin/env node
// Party online: a relay on Party's sim, AI balls through its native door
// (net/bot-host.mjs --party, one world shared by them all), and Chrome playing
// the page with an AI ball at its controls, over a lossy network if asked.
// --mg k plays only minigame k (the relay's seed carries it), else the
// rotation from seed 7. Passes when the referee checked interval hashes from
// every session and none differed, every bot got in, a round was played to
// its end and placed (when the run is long enough for one), every round was
// the forced minigame (with --mg), and Chrome kept up without an error.
// Screenshots go to traces/party-<key>-<s>s.png (traces/party-<s>s.png for
// the rotation).
//   node net/run-party.mjs [--mg k] [--bots 15] [--chrome 1] [--seconds 60] [--impair delay=60,jitter=10,loss=0.05] [--shots 1] [--every 4] [--res 1280x800]
//                          [--port 4433: the relay's, its native door the next]
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { serve } from '../tools/serve.mjs';
import { partySeed } from '../tools/genparty.mjs';
import { MINIGAMES, P_COUNT } from '../src/layout.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const nbots = Number(opt('bots', 15));
const chrome = Number(opt('chrome', 1));
const seconds = Number(opt('seconds', 60));
const impair = opt('impair', '');
const shots = opt('shots', '1') !== '0';
const every = Number(opt('every', 4));
const mgArg = opt('mg', null);
const mg = mgArg === null ? null : Number(mgArg);
const tag = mg === null ? 'party' : `party-${MINIGAMES[mg]?.key ?? mg}`;
const port = Number(opt('port', 4433));
const DENO = existsSync('.tools/deno') ? '.tools/deno' : 'deno';
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

execFileSync('sh', ['tools/cert.sh'], { stdio: 'inherit' });
execFileSync(process.execPath, ['tools/asm.mjs'], { stdio: 'inherit' });
const hash = readFileSync('certs/hash.txt', 'utf8').trim();
mkdirSync('traces', { recursive: true });
const summaryPath = 'traces/party.relay.json';
rmSync(summaryPath, { force: true });
const relay = spawn(DENO, ['run', '--unstable-net', '-A', '--v8-flags=--single-threaded-gc', 'net/relay.ts', '--port', String(port), '--seed', String(partySeed(7, mg)),
  '--native-port', String(port + 1), '--wasm', 'build/party/game.wasm', '--duration', String(seconds + 40), '--summary', summaryPath, '--quiet'], { stdio: ['ignore', 'inherit', 'inherit'] });
await new Promise((ok) => setTimeout(ok, 1500));
const botsPath = 'traces/party.bots.json';
rmSync(botsPath, { force: true });
const bots = nbots ? spawn(process.execPath, ['net/bot-host.mjs', '--party', '--relay', `127.0.0.1:${port + 1}`, '--bots', String(nbots), '--seconds', String(seconds + 10), '--quiet', '--out', botsPath],
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
const res = opt('res', '320x200');
const q = new URLSearchParams({ bot: '1', present: '0', url: `https://127.0.0.1:${port}/`, hash, impair, net: opt('net', '0'), skill: '0.9', res });
const report = { bots: nbots, chrome, seconds, mg: mg === null ? 'rotation' : MINIGAMES[mg]?.name, impair: impair || 'none', screenshots: [], errors: [] };
const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(0);
const STATES = ['idle', 'countdown', 'play', 'over'];
try {
  for (let k = 0; k < chrome; k++) {
    const page = await browser.newPage({ viewport: { width: Math.max(640, Number(res.split('x')[0])), height: Math.max(400, Number(res.split('x')[1])) } });
    page.on('console', (m) => { if (m.type() === 'error') { report.errors.push(m.text()); process.stderr.write(`[chrome ${k}] ${m.text()}\n`); } });
    page.on('pageerror', (e) => { report.errors.push(e.message); process.stderr.write(`[chrome ${k}] ${e.message}\n`); });
    await page.goto(`http://127.0.0.1:${webPort}/client/party.html?${q}`);
    pages.push(page);
  }
  let snapAt = 0;
  while (Date.now() - t0 < seconds * 1000) {
    await new Promise((ok) => setTimeout(ok, 1000));
    const st = await Promise.all(pages.map((p) => p.evaluate(() => window.__qa?.state?.() || window.__qa || null)));
    if (st.some((s) => s?.error)) throw new Error(st.find((s) => s?.error).error);
    process.stderr.write(`\r${secs()} s  ${st.map((s, k) => s?.me ? `c${k}: P${s.slot + 1} ${s.me.pts}pts ${s.me.wins}w ${s.me.out ? 'out' : 'in'} round ${s.round.round + 1} ${s.name} ${STATES[s.round.state]} ${s.round.left}/${s.round.n0} left` : `c${k}: ${s?.clState ?? '-'}`).join(' | ')}     `);
    if (shots && pages.length && Date.now() - snapAt > every * 1000 && st[0]?.me) {
      snapAt = Date.now();
      const png = await pages[0].evaluate(() => window.__qa.capture?.(2)).catch(() => null);
      if (png) { const f = `traces/${tag}-${secs().padStart(3, '0')}s.png`; writeFileSync(f, Buffer.from(png, 'base64')); report.screenshots.push(f); }
    }
  }
  process.stderr.write('\n');
  const end = await Promise.all(pages.map((p) => p.evaluate(() => window.__qa.state())));
  report.chromeState = end.map((s) => ({ fps: s.fps, slot: s.slot, pts: s.me?.pts, wins: s.me?.wins, kos: s.me?.kos, rounds: s.me?.rounds, behind: s.clState !== 2, feed: s.feed, round: s.round.round, game: s.name }));
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
const games = b?.games || [];
report.botHost = b && { joined: b.joined, rejected: b.rejected, errors: b.errors, cpuPctOfOneCore: b.cpuPctOfOneCore, meanStepMs: b.world.meanStepMs, worstStepMs: b.world.worstStepMs,
  pts: b.world.players.reduce((n, p) => n + p.pts, 0), wins: b.world.players.reduce((n, p) => n + p.wins, 0), kos: b.world.players.reduce((n, p) => n + p.kos, 0),
  rounds: games.map((g) => ({ round: g.round + 1, name: g.name, balls: g.n0, seconds: g.over ? Number(((g.over - g.simTick) / 125).toFixed(1)) : null })),
  downKBpsEach: b.sessions.length ? Number((b.sessions.reduce((n, x) => n + x.downKB, 0) / b.sessions.length / seconds).toFixed(1)) : 0 };
// a round can be expected to end when its countdown and its whole length fit in the run, from when the first began
const first = games[0];
const roundFits = !!first && (first.simTick + first.len) / 125 + 8 < seconds;
const gate = {
  everyBotIn: !nbots || (!!b && b.joined === nbots && !b.errors.length),
  refereeChecked: !!r && r.compared >= 4 * (nbots + chrome),
  hashesAgree: !!r && (r.mismatches?.length ?? r.mismatches) === 0 && r.agreed === r.compared,
  played: games.length > 0,
  aRoundPlaced: !roundFits || (games.some((g) => g.over) && (report.botHost?.pts ?? 0) > 0),
  theForcedMinigame: mg === null || (games.length > 0 && games.every((g) => g.game === mg)),
  chromeKeptUp: (report.chromeState || []).every((s) => !s.behind),
  noErrors: report.errors.length === 0,
};
report.gate = { ...gate, pass: Object.values(gate).every(Boolean) };
report.countdownSeconds = P_COUNT / 125;
writeFileSync(`traces/${tag}.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
console.log(report.gate.pass ? 'Party gate: PASS' : 'Party gate: FAIL');
process.exit(report.gate.pass ? 0 : 1);
