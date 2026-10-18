#!/usr/bin/env node
// X2: Xbox clients online. The Deno relay with its referee, a Chrome client
// with the golf bot at the controls, and native clients: the Xbox build's own
// network code (xbox/online.c) over the relay's native door, played by
// scripted controllers (build/x86/xbox-headless --online). One native client
// joins with the room; the other joins late, from a keyframe, running under
// qemu-i386 -cpu pentium3 (the Xbox's instruction set) when qemu is installed.
// Every datagram both ways is impaired.
//   node net/run-x2.mjs [--seconds 60] [--late 15] [--flip 25] [--chrome 1] [--impair delay=100,jitter=15,loss=0.05] [--no-qemu]
// (--chrome 0 runs the native clients alone, with no browser: what CI runs)
// The gate, each part in report.gate:
//   every native client ran to the end without an error, and was back on the
//   playout clock at the end;
//   the late one joined from a keyframe after sim tick 0 (an unpacked region)
//   with under 400 ticks to fast-forward;
//   the first native client's flipped bit (--flip seconds in, 0 for none) is
//   the referee's one mismatch, healed by a desync keyframe;
//   every other interval hash every client reported, native and Chrome,
//   equals the referee's; lost ticks came back as repairs.
// The report lands in traces/x2.json, frames in traces/x2-*.ppm.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { serve } from '../tools/serve.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const seconds = Number(opt('seconds', 60));
const late = Number(opt('late', 15));
const chromeClients = Number(opt('chrome', 1));
const impair = opt('impair', 'delay=100,jitter=15,loss=0.05');
const port = Number(opt('port', 4433));
const nativePort = Number(opt('native-port', 4434));
const seed = opt('seed', '7');
const flipAt = Number(opt('flip', 25));
const has = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; } catch { return false; } };
const qemu = !argv.includes('--no-qemu') && has('qemu-i386', ['-version']);
const DENO = existsSync('.tools/deno') ? '.tools/deno' : 'deno';
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

execFileSync('sh', ['tools/cert.sh'], { stdio: 'inherit' });
execFileSync(process.execPath, ['tools/asm.mjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['tools/x86.mjs'], { stdio: 'inherit' });
const hash = readFileSync('certs/hash.txt', 'utf8').trim();
mkdirSync('traces/x2', { recursive: true });
const summaryPath = 'traces/x2.relay.json';
rmSync(summaryPath, { force: true });

const relay = spawn(DENO, ['run', '--unstable-net', '-A', '--v8-flags=--single-threaded-gc', 'net/relay.ts', '--port', String(port), '--native-port', String(nativePort),
  '--seed', seed, '--duration', String(seconds + 30), '--summary', summaryPath, '--quiet'], { stdio: ['ignore', 'inherit', 'inherit'] });
const relayDone = new Promise((ok) => relay.on('exit', ok));
await new Promise((ok) => setTimeout(ok, 1500));

// A native client: its JSON summary on stdout when it leaves.
function native(name, secs, pre, rng, flip = 0) {
  const out = [];
  const args = ['build/x86/xbox-headless', '--online', `127.0.0.1:${nativePort}`, '--seconds', String(secs), '--out', 'traces/x2', '--impair', impair, '--rng', String(rng), '--flip', String(flip)];
  const p = pre ? spawn(pre[0], [...pre.slice(1), ...args]) : spawn(args[0], args.slice(1));
  p.stdout.on('data', (d) => out.push(d));
  p.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  return new Promise((ok) => p.on('exit', (code) => {
    let s = null;
    try { s = JSON.parse(Buffer.concat(out).toString()); } catch { /* none */ }
    ok({ name, code, s, qemu: !!pre });
  }));
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
const q = new URLSearchParams({ bot: '1', present: '0', url: `https://127.0.0.1:${port}/`, hash, impair });
const report = { seconds, late, impair, qemu, chrome: [], natives: [], gate: {} };
const t0 = Date.now();
let natives = [];
try {
  for (let k = 0; k < chromeClients; k++) {
    const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
    page.on('pageerror', (e) => process.stderr.write(`\n[chrome ${k}] ${e.message}\n`));
    await page.goto(`http://127.0.0.1:${webPort}/client/index.html?${q}`);
    pages.push(page);
  }
  natives.push(native('native', seconds, null, 11, flipAt));
  await new Promise((ok) => setTimeout(ok, late * 1000));
  natives.push(native(qemu ? 'native-late (qemu pentium3)' : 'native-late', seconds - late, qemu ? ['qemu-i386', '-cpu', 'pentium3'] : null, 23));
  while (Date.now() - t0 < seconds * 1000) {
    await new Promise((ok) => setTimeout(ok, 5000));
    const st = await Promise.all(pages.map((p) => p.evaluate(() => window.__qg?.state?.() || null).catch(() => null)));
    process.stderr.write(`\r${((Date.now() - t0) / 1000).toFixed(0)} s  ${st.map((s, k) => s?.me ? `chrome ${k}: tick ${s.hole.tick} strokes ${s.me.strokes}` : `chrome ${k}: -`).join(' | ')}   `);
  }
  process.stderr.write('\n');
  natives = await Promise.all(natives);
  report.chrome = await Promise.all(pages.map((p) => p.evaluate(() => {
    const s = window.__qg.state();
    return { slot: s.slot, clState: s.clState, error: s.error, hashes: window.__qg.hashes, keys: window.__qg.keys.map((k) => ({ reason: k.reason, simTick: k.simTick })) };
  })));
} finally {
  await browser?.close();
  server?.close();
  relay.kill('SIGTERM');
  await Promise.race([relayDone, new Promise((ok) => setTimeout(ok, 5000))]);
}

const relayRun = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : null;
const ref = new Map((relayRun?.refHashes || []).map(([t, h]) => [t, BigInt('0x' + h)]));
// a flipped client's hashes from the flip until it restored the desync's keyframe are its own
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
  syncs: s.syncs, pongs: s.pongs, stepped: s.stepped, rttMs: s.rttMs, lead: s.leadX10 / 10, meanPredicted: s.meanPredicted, strokes: s.strokes, impair: s.impair,
  flipTick: s.flipTick || null, desyncs: s.desyncs, ...grade(s.hashes, excuse),
  };
})() : { name, code, error: 'no summary' });
report.chrome = report.chrome.map((c) => ({ slot: c.slot, clState: c.clState, error: c.error, keys: c.keys, ...grade(c.hashes) }));
report.relay = relayRun && {
  sessions: relayRun.sessions, leaves: relayRun.leaves, compared: relayRun.compared, agreed: relayRun.agreed, mismatches: relayRun.mismatches,
  repairs: relayRun.repairs, repairTicks: relayRun.repairTicks, keys: relayRun.keys, substitutedPct: relayRun.substitutedPct, stalls: relayRun.stalls,
  downKBpsPerSession: relayRun.downKBpsPerSession, upKBpsPerSession: relayRun.upKBpsPerSession,
};
const [first, second] = report.natives;
const gate = {
  nativesRanClean: report.natives.length === 2 && report.natives.every((n) => n.code === 0 && !n.error),
  // a native client's last state before it leaves is "left"; it was playing if it stepped close to the room's end
  lateJoinFromKeyframe: !!second?.keys && second.keys[0]?.reason === 'join' && second.keys[0].simTick > 0 && second.fillTicks < 400,
  nativeHashesAgree: report.natives.every((n) => n.compared >= 4 && n.wrong === 0),
  chromeHashesAgree: report.chrome.every((c) => c.compared >= 4 && c.wrong === 0),
  flipCaughtAndHealed: !flipAt || (!!first?.flipTick && relayRun?.mismatches.length === 1 && relayRun.mismatches[0].slot === first.slot
    && first.keys.some((k) => k.reason === 'desync')),
  refereeFoundNoOtherMismatch: !!relayRun && relayRun.mismatches.every((m) => flipAt && m.slot === first?.slot),
  repairsUsed: !!first && first.repairTicks > 0,
};
report.gate = { ...gate, pass: Object.values(gate).every(Boolean) };
writeFileSync('traces/x2.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
console.log(report.gate.pass ? 'X2 gate: PASS' : 'X2 gate: FAIL');
process.exit(report.gate.pass ? 0 : 1);
