#!/usr/bin/env node
// N1: 256 players in one room. The Deno relay with its referee; two Chrome
// clients, one with the golf bot at the controls and one with the neural
// golfer; the Xbox's network code (build/x86/xbox-headless --online), one
// native client from the start and one that joins last, from a keyframe,
// under qemu-i386 -cpu pentium3 when qemu is installed; and the bot host
// (net/bot-host.mjs) filling every other slot with a neural golfer, each its
// own session over the relay's native door. Every datagram both ways is
// impaired, and then one more player knocks and is turned away.
//   node net/run-n1.mjs [--seconds 90] [--late 30] [--flip 45] [--chrome 2] [--impair delay=100,jitter=15,loss=0.05] [--no-qemu]
// The gate, each part in report.gate:
//   all 256 slots held at once, and the 257th refused as full;
//   every interval hash every client reported (the bot host's for each of its
//   sessions) equals the referee's, but the flipped native's between its flip
//   and the desync keyframe that heals it, the referee's one mismatch;
//   the late native joined from a keyframe of the full room with under 400
//   ticks to fast-forward;
//   every bundle datagram fit the 1,161-byte budget, and the bot host's sessions
//   heard ticks by bundle at the rate two bundles a tick give at this loss,
//   less 0.5 point, their inputs applied as sent.
// The report lands in traces/n1.json; the Chrome clients' frames once the room
// is full, and their scoreboards then, in traces/n1-*.png.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import { serve } from '../tools/serve.mjs';
import * as W from './wire.mjs';
import { parseImpair } from './impair.js';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const seconds = Number(opt('seconds', 90));
const late = Number(opt('late', 30));
const flipAt = Number(opt('flip', 45));
const chromeClients = Number(opt('chrome', 2));
const impair = opt('impair', 'delay=100,jitter=15,loss=0.05');
const port = Number(opt('port', 4433));
const nativePort = Number(opt('native-port', 4434));
const seed = opt('seed', '7');
const NATIVES = 2;
const bots = W.NP - chromeClients - NATIVES;
const has = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; } catch { return false; } };
const qemu = !argv.includes('--no-qemu') && has('qemu-i386', ['-version']);
const DENO = existsSync('.tools/deno') ? '.tools/deno' : 'deno';
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const genome = readFileSync('xbox/golfer.h', 'utf8').match(/GOLFER_DEFAULT "(qg2:[A-Za-z0-9_-]+)"/)[1];

execFileSync('sh', ['tools/cert.sh'], { stdio: 'inherit' });
execFileSync(process.execPath, ['tools/asm.mjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['tools/x86.mjs'], { stdio: 'inherit' });
const hash = readFileSync('certs/hash.txt', 'utf8').trim();
mkdirSync('traces/n1', { recursive: true });
const summaryPath = 'traces/n1.relay.json', botPath = 'traces/n1/bot-host.json';
rmSync(summaryPath, { force: true });
rmSync(botPath, { force: true });

// CPU seconds a process has used, from /proc (Linux)
const cpuOf = (pid) => { try { const f = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); return (Number(f[11]) + Number(f[12])) / 100; } catch { return null; } };

const relay = spawn(DENO, ['run', '--unstable-net', '-A', '--v8-flags=--single-threaded-gc', 'net/relay.ts', '--port', String(port), '--native-port', String(nativePort),
  '--seed', seed, '--duration', String(seconds + 30), '--summary', summaryPath, '--quiet'], { stdio: ['ignore', 'inherit', 'inherit'] });
const relayDone = new Promise((ok) => relay.on('exit', ok));
await new Promise((ok) => setTimeout(ok, 1500));

// A native client: its JSON summary on stdout when it leaves.
function native(name, secs, pre, rng, flip = 0) {
  const out = [];
  const args = ['build/x86/xbox-headless', '--online', `127.0.0.1:${nativePort}`, '--seconds', String(secs), '--out', 'traces/n1', '--impair', impair, '--rng', String(rng), '--flip', String(flip)];
  const p = pre ? spawn(pre[0], [...pre.slice(1), ...args]) : spawn(args[0], args.slice(1));
  p.stdout.on('data', (d) => out.push(d));
  p.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  return new Promise((ok) => p.on('exit', (code) => {
    let s = null;
    try { s = JSON.parse(Buffer.concat(out).toString()); } catch { /* none */ }
    ok({ name, code, s, qemu: !!pre });
  }));
}

// One more player at the door: the relay's answer to its hello.
function knock() {
  return new Promise((ok) => {
    const c = net.connect({ host: '127.0.0.1', port: nativePort }, () => c.write(W.encodeHello({ maxDatagram: 1400, wasmPrefix: prefixBytes })));
    let got = Buffer.alloc(0);
    c.on('data', (d) => { got = Buffer.concat([got, d]); if (got.length >= 4) { c.destroy(); ok(got[0] === W.T_REJECT ? { reject: got[1] } : { admitted: true }); } });
    c.on('error', () => ok({ error: true }));
    setTimeout(() => { c.destroy(); ok({ timeout: true }); }, 5000);
  });
}
const prefixBytes = await W.wasmPrefix(readFileSync('build/game.wasm'));

// A frame from a Chrome client, drawn on request (headless Chrome can't present WebGPU)
async function capture(page, file, tab = false) {
  if (tab) await page.keyboard.down('Tab');
  if (tab) await new Promise((ok) => setTimeout(ok, 200));
  const png = await page.evaluate(() => window.__qg.capture?.(2)).catch(() => null);
  if (tab) await page.keyboard.up('Tab');
  if (png) { writeFileSync(file, Buffer.from(png, 'base64')); report.screenshots.push(file); }
}

const require = createRequire(import.meta.url);
let server = null, webPort = 0, browser = null;
if (chromeClients > 0) {
  const { chromium } = (() => { for (const n of ['playwright', 'playwright-core']) { try { return require(n); } catch { /* next */ } } throw new Error('playwright not found'); })();
  ({ server, port: webPort } = await serve());
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || (existsSync(LOCAL_CHROMIUM) ? LOCAL_CHROMIUM : undefined),
    args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
}
const pages = [];
const report = { seconds, late, flipAt, impair, qemu, players: W.NP, bots, chrome: [], natives: [], screenshots: [], gate: {} };
const t0 = Date.now();
let natives = [], botHost = null, botDone = null, knocked = null;
const cpu0 = { relay: cpuOf(relay.pid) };
try {
  for (let k = 0; k < chromeClients; k++) {
    const q = new URLSearchParams({ bot: '1', present: '0', url: `https://127.0.0.1:${port}/`, hash, impair, ...(k % 2 ? { genome } : {}) });
    const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
    page.on('pageerror', (e) => process.stderr.write(`\n[chrome ${k}] ${e.message}\n`));
    await page.goto(`http://127.0.0.1:${webPort}/client/index.html?${q}`);
    pages.push(page);
  }
  natives.push(native('native', seconds, null, 11, flipAt));
  await new Promise((ok) => setTimeout(ok, 2000));
  botHost = spawn(process.execPath, ['net/bot-host.mjs', '--relay', `127.0.0.1:${nativePort}`, '--bots', String(bots), '--seconds', String(seconds - 4),
    '--rate', '50', '--impair', impair, '--out', botPath, '--quiet'], { stdio: ['ignore', 'inherit', 'inherit'] });
  botDone = new Promise((ok) => botHost.on('exit', ok));
  await new Promise((ok) => setTimeout(ok, (late - 2) * 1000));
  natives.push(native(qemu ? 'native-late (qemu pentium3)' : 'native-late', seconds - late, qemu ? ['qemu-i386', '-cpu', 'pentium3'] : null, 23));
  // the room is full once the late one is in: one more is turned away
  await new Promise((ok) => setTimeout(ok, 5000));
  knocked = await knock();
  for (const [k, p] of pages.entries()) { await capture(p, `traces/n1-c${k}-full.png`); await capture(p, `traces/n1-c${k}-scores.png`, true); }
  while (Date.now() - t0 < seconds * 1000) {
    await new Promise((ok) => setTimeout(ok, 5000));
    const st = await Promise.all(pages.map((p) => p.evaluate(() => window.__qg?.state?.() || null).catch(() => null)));
    process.stderr.write(`\r${((Date.now() - t0) / 1000).toFixed(0)} s  ${st.map((s, k) => s?.me ? `chrome ${k}: tick ${s.hole.tick} strokes ${s.me.strokes}` : `chrome ${k}: -`).join(' | ')}   `);
  }
  process.stderr.write('\n');
  report.relayCpuSeconds = cpuOf(relay.pid) - cpu0.relay;
  natives = await Promise.all(natives);
  await botDone;
  report.chrome = await Promise.all(pages.map((p) => p.evaluate(() => {
    const s = window.__qg.state();
    return { slot: s.slot, clState: s.clState, error: s.error, hashes: window.__qg.hashes, keys: window.__qg.keys.map((k) => ({ reason: k.reason, simTick: k.simTick })) };
  })));
} finally {
  await browser?.close();
  server?.close();
  botHost?.kill('SIGTERM');
  relay.kill('SIGTERM');
  await Promise.race([relayDone, new Promise((ok) => setTimeout(ok, 5000))]);
}

const relayRun = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : null;
const botRun = existsSync(botPath) ? JSON.parse(readFileSync(botPath, 'utf8')) : null;
const ref = new Map((relayRun?.refHashes || []).map(([t, h]) => [t, BigInt('0x' + h)]));
const grade = (hashes, excuse = null) => {
  let compared = 0, wrong = 0, excused = 0;
  for (const [t, h] of hashes) {
    if (!ref.has(t)) continue;
    if (excuse && t > excuse.from && t <= excuse.to) { excused++; continue; }
    compared++;
    if (ref.get(t) !== BigInt(typeof h === 'string' && !h.startsWith('0x') ? '0x' + h : h)) wrong++;
  }
  return { compared, wrong, excused };
};
const REASON = ['join', 'hole', 'behind', 'desync'];
report.natives = natives.map(({ name, code, s, qemu: q3 }) => s ? (() => {
  const heal = s.keys.find(([r]) => r === 3)?.[1];
  const excuse = s.flipTick ? { from: s.flipTick - 128, to: heal ?? Infinity } : null;
  return {
    name, code, qemu: q3, slot: s.slot, state: ['hello', 'joining', 'catching up', 'playing', 'left'][s.state], error: s.error,
    keys: s.keys.map(([r, t]) => ({ reason: REASON[r], simTick: t })), fillTicks: s.fillTicks, bundles: s.bundles, repairs: s.repairs, repairTicks: s.repairTicks,
    syncs: s.syncs, stepped: s.stepped, rttMs: s.rttMs, lead: s.leadX10 / 10, strokes: s.strokes, flipTick: s.flipTick || null, desyncs: s.desyncs, ...grade(s.hashes, excuse),
  };
})() : { name, code, error: 'no summary' });
report.chrome = report.chrome.map((c) => ({ slot: c.slot, clState: c.clState, error: c.error, keys: c.keys, ...grade(c.hashes) }));
const ses = (botRun?.sessions || []).filter((s) => s.slot >= 0);
const sum = (f) => ses.reduce((a, s) => a + f(s), 0);
report.botHost = botRun && {
  joined: botRun.joined, rejected: botRun.rejected, errors: botRun.errors, cpuPctOfOneCore: botRun.cpuPctOfOneCore,
  world: { stepped: botRun.world.stepped, keys: botRun.world.keys, syncs: botRun.world.syncs, meanStepMs: botRun.world.meanStepMs, worstStepMs: botRun.world.worstStepMs, ...grade(botRun.world.hashes) },
  deliveredByBundlePct: Number((100 * sum((s) => s.bundleTicks) / sum((s) => s.expected)).toFixed(3)),
  worstSessionPct: Number((100 * Math.min(...ses.map((s) => (s.expected ? s.bundleTicks / s.expected : 1)))).toFixed(3)),
  repairTicks: sum((s) => s.repairTicks),
  inputsAppliedAsSentPct: Number((100 * sum((s) => s.matched) / sum((s) => s.mine)).toFixed(3)),
  strokes: botRun.world.players.reduce((a, p) => a + p.strokes + p.total, 0),
};
report.relay = relayRun && {
  sessions: relayRun.sessions, rejected: relayRun.rejected, leaves: relayRun.leaves, compared: relayRun.compared, agreed: relayRun.agreed, mismatches: relayRun.mismatches,
  bundlesSent: relayRun.bundlesSent, datagramsPerBundle: Number((relayRun.bundleDatagrams / relayRun.bundlesSent).toFixed(3)), bytesPerBundle: relayRun.bytesPerBundle,
  maxDatagramSent: relayRun.maxDatagramSent, tickBytes: relayRun.tickBytes, repairs: relayRun.repairs, repairTicks: relayRun.repairTicks, fills: relayRun.fills,
  keys: relayRun.keys.length, substitutedPct: relayRun.substitutedPct, stalls: relayRun.stalls, closeLateMs: relayRun.closeLateMs, refLagMax: relayRun.refLagMax,
  downKBpsPerSession: relayRun.downKBpsPerSession, upKBpsPerSession: relayRun.upKBpsPerSession,
  cpuPctOfOneCore: report.relayCpuSeconds ? Number((100 * report.relayCpuSeconds / seconds).toFixed(1)) : null,
};
report.knock = knocked;
const loss = parseImpair(impair).loss || 0;
const [first, second] = report.natives;
const gate = {
  roomFull: !!relayRun && relayRun.sessions === W.NP && botRun?.joined === bots && botRun.rejected === 0 && knocked?.reject === W.REJECT.FULL,
  botHostHashesAgree: !!botRun && botRun.errors.length === 0 && report.botHost.world.compared >= 4 && report.botHost.world.wrong === 0,
  nativesRanClean: report.natives.length === NATIVES && report.natives.every((n) => n.code === 0 && !n.error),
  lateJoinFromKeyframe: !!second?.keys && second.keys[0]?.reason === 'join' && second.keys[0].simTick > 0 && second.fillTicks < 400,
  nativeHashesAgree: report.natives.every((n) => n.compared >= 4 && n.wrong === 0),
  chromeHashesAgree: report.chrome.length === chromeClients && report.chrome.every((c) => c.compared >= 4 && c.wrong === 0),
  flipCaughtAndHealed: !flipAt || (!!first?.flipTick && relayRun?.mismatches.length === 1 && relayRun.mismatches[0].slot === first.slot
    && first.keys.some((k) => k.reason === 'desync')),
  refereeFoundNoOtherMismatch: !!relayRun && relayRun.mismatches.every((m) => flipAt && m.slot === first?.slot),
  bundlesFit: !!relayRun && relayRun.maxDatagramSent <= W.MAX_DATAGRAM,
  delivered: !!report.botHost && report.botHost.deliveredByBundlePct >= 100 * (1 - loss * loss) - 0.5 && report.botHost.inputsAppliedAsSentPct >= 99,
};
report.gate = { ...gate, pass: Object.values(gate).every(Boolean) };
writeFileSync('traces/n1.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, natives: report.natives.map(({ keys, ...n }) => ({ ...n, keys: keys?.length })) }, null, 2));
console.log(report.gate.pass ? 'N1 gate: PASS' : 'N1 gate: FAIL');
process.exit(report.gate.pass ? 0 : 1);
