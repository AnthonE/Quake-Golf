// What the network gates (net/run-*.mjs) share: building, the relays, the bot
// host, the Xbox's native client, Chrome, a player at the door, and grading
// interval hashes against a referee's.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import { serve } from '../tools/serve.mjs';
import * as W from './wire.mjs';

export const argv = process.argv.slice(2);
export const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
export const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const has = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; } catch { return false; } };
export const qemu = !argv.includes('--no-qemu') && has('qemu-i386', ['-version']);
const DENO = existsSync('.tools/deno') ? '.tools/deno' : 'deno';
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export const genome = () => readFileSync('xbox/golfer.h', 'utf8').match(/GOLFER_DEFAULT "(qg2:[A-Za-z0-9_-]+)"/)[1];
export const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);

// The certificate, game.wasm (and the native client with x86), traces/<dir>; the certificate's hash.
export function setup(dir, { x86 = false } = {}) {
  execFileSync('sh', ['tools/cert.sh'], { stdio: 'inherit' });
  execFileSync(process.execPath, ['tools/asm.mjs'], { stdio: 'inherit' });
  if (x86) execFileSync(process.execPath, ['tools/x86.mjs'], { stdio: 'inherit' });
  mkdirSync(`traces/${dir}`, { recursive: true });
  return readFileSync('certs/hash.txt', 'utf8').trim();
}

// CPU seconds a process has used, from /proc (Linux)
const cpuOf = (pid) => { try { const f = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); return (Number(f[11]) + Number(f[12])) / 100; } catch { return null; } };

// A child process with its JSON summary at `path`: { p, path, done, cpu() (seconds since it began), stop(), result() }.
function child(cmd, args, path) {
  if (path) rmSync(path, { force: true });
  const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  // its CPU time, sampled while it runs (it's gone from /proc once it exits)
  let cpu0 = null, cpu = null;
  const sample = setInterval(() => { cpu = cpuOf(p.pid) ?? cpu; cpu0 ??= cpu; }, 500);
  const done = new Promise((ok) => p.on('exit', () => { clearInterval(sample); ok(); }));
  return {
    p, path, done,
    cpu: () => (cpu0 === null ? null : (cpuOf(p.pid) ?? cpu) - cpu0),
    // ends it (SIGTERM: a relay writes its summary first) and waits up to 5 s
    async stop(signal = 'SIGTERM') { p.kill(signal); await Promise.race([done, sleep(5000)]); },
    result: () => readJson(path),
  };
}

// A relay (net/relay.ts) with its summary in `path`; args as its command line takes them.
export function relay(path, args) {
  return child(DENO, ['run', '--unstable-net', '-A', '--v8-flags=--single-threaded-gc', 'net/relay.ts', '--summary', path, '--quiet', ...args], path);
}

// The bot host (net/bot-host.mjs) with its summary in `path`.
export function botHost(path, args) {
  return child(process.execPath, ['net/bot-host.mjs', '--out', path, '--quiet', ...args], path);
}

// The Xbox's network code (build/x86/xbox-headless --online), under qemu's
// Pentium III with `pentium3`: resolves to { name, code, s (its summary), qemu }.
export function native(name, { port, seconds, out, impair, rng, flip = 0, pentium3 = false }) {
  const chunks = [];
  const args = ['build/x86/xbox-headless', '--online', `127.0.0.1:${port}`, '--seconds', String(seconds), '--out', out, '--impair', impair, '--rng', String(rng), '--flip', String(flip)];
  const p = pentium3 ? spawn('qemu-i386', ['-cpu', 'pentium3', ...args]) : spawn(args[0], args.slice(1));
  p.stdout.on('data', (d) => chunks.push(d));
  p.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  return new Promise((ok) => p.on('exit', (code) => {
    let s = null;
    try { s = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* none */ }
    ok({ name, code, s, qemu: pentium3 });
  }));
}

// net/tiny-client.mjs, the smallest whole client: resolves to its summary (or null).
export function tiny(port, seconds, wasm = 'build/game.wasm') {
  const chunks = [];
  const p = spawn(process.execPath, ['net/tiny-client.mjs', `127.0.0.1:${port}`, '--seconds', String(seconds), '--wasm', wasm]);
  p.stdout.on('data', (d) => chunks.push(d));
  p.stderr.on('data', (d) => process.stderr.write(`[tiny] ${d}`));
  return new Promise((ok) => p.on('exit', () => { try { ok(JSON.parse(Buffer.concat(chunks).toString())); } catch { ok(null); } }));
}

// A native client's run as the reports give it; a flipped one's hashes from the
// interval before its flip until its desync keyframe are its own.
const REASON = ['join', 'hole', 'behind', 'desync'];
export function nativeReport({ name, code, s, qemu: q3 }, grade) {
  if (!s) return { name, code, error: 'no summary' };
  const heal = s.keys.find(([r]) => r === 3)?.[1];
  const excuse = s.flipTick ? { from: s.flipTick - 128, to: heal ?? Infinity } : null;
  return {
    name, code, qemu: q3, slot: s.slot, state: ['hello', 'joining', 'catching up', 'playing', 'left'][s.state], error: s.error,
    keys: s.keys.map(([r, t]) => ({ reason: REASON[r], simTick: t })), fillTicks: s.fillTicks, bundles: s.bundles, repairs: s.repairs, repairTicks: s.repairTicks,
    syncs: s.syncs, stepped: s.stepped, rttMs: s.rttMs, lead: s.leadX10 / 10, strokes: s.strokes, flipTick: s.flipTick || null, desyncs: s.desyncs, ...grade(s.hashes, excuse),
  };
}

// Chrome on the page server: open(query) loads the client with it and returns
// the page; state(page) and the page's own run record; capture() a frame.
export async function chrome() {
  const require = createRequire(import.meta.url);
  const { chromium } = (() => { for (const n of ['playwright', 'playwright-core']) { try { return require(n); } catch { /* next */ } } throw new Error('playwright not found'); })();
  const { server, port } = await serve();
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || (existsSync(LOCAL_CHROMIUM) ? LOCAL_CHROMIUM : undefined),
    args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  return {
    async open(query, label = 'chrome') {
      const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
      page.on('pageerror', (e) => process.stderr.write(`\n[${label}] ${e.message}\n`));
      await page.goto(`http://127.0.0.1:${port}/client/index.html?${new URLSearchParams(query)}`);
      return page;
    },
    state: (page) => page.evaluate(() => window.__qg?.state?.() || null).catch(() => null),
    // what a run grades: the slot, the state, the interval hashes and keyframes
    record: (page) => page.evaluate(() => {
      const s = window.__qg.state();
      return { slot: s.slot, watching: s.watching, clState: s.clState, error: s.error, hashes: window.__qg.hashes, keys: window.__qg.keys.map((k) => ({ reason: k.reason, simTick: k.simTick })) };
    }),
    // a frame, drawn on request (headless Chrome can't present WebGPU); with tab, the scoreboard's
    async capture(page, file, tab = false) {
      if (tab) { await page.keyboard.down('Tab'); await sleep(200); }
      const png = await page.evaluate(() => window.__qg.capture?.(2)).catch(() => null);
      if (tab) await page.keyboard.up('Tab');
      if (png) writeFileSync(file, Buffer.from(png, 'base64'));
      return png ? file : null;
    },
    async close() { await browser.close(); server.close(); },
  };
}

// A player at a relay's native door: its answer to a hello ({ reject } or { admitted }).
export async function knock(port) {
  const prefix = await W.wasmPrefix(readFileSync('build/game.wasm'));
  return new Promise((ok) => {
    const c = net.connect({ host: '127.0.0.1', port }, () => c.write(W.encodeHello({ maxDatagram: 1400, wasmPrefix: prefix })));
    let got = Buffer.alloc(0);
    c.on('data', (d) => { got = Buffer.concat([got, d]); if (got.length >= 4) { c.destroy(); ok(got[0] === W.T_REJECT ? { reject: got[1] } : { admitted: true }); } });
    c.on('error', () => ok({ error: true }));
    setTimeout(() => { c.destroy(); ok({ timeout: true }); }, 5000);
  });
}

// Grades interval hashes ([sim tick, hash], the hash as hex or a number) against
// a referee's ([sim tick, hex]); an excuse { from, to } skips the ticks in it.
export function grader(refHashes) {
  const ref = new Map((refHashes || []).map(([t, h]) => [t, BigInt('0x' + h)]));
  return (hashes, excuse = null) => {
    let compared = 0, wrong = 0, excused = 0;
    for (const [t, h] of hashes || []) {
      if (!ref.has(t)) continue;
      if (excuse && t > excuse.from && t <= excuse.to) { excused++; continue; }
      compared++;
      if (ref.get(t) !== BigInt(typeof h === 'string' && !h.startsWith('0x') ? '0x' + h : h)) wrong++;
    }
    return { compared, wrong, excused };
  };
}

// The bot host's sessions as a report: delivery by bundle, inputs applied as sent.
export function hostReport(h, grade, seconds) {
  const ses = h.sessions.filter((s) => s.joined);
  const sum = (f) => ses.reduce((a, s) => a + f(s), 0);
  return {
    watch: h.watch, joined: h.joined, rejected: h.rejected, errors: h.errors.length, cpuPctOfOneCore: h.cpuPctOfOneCore,
    world: { stepped: h.world.stepped, keys: h.world.keys, syncs: h.world.syncs, meanStepMs: h.world.meanStepMs, worstStepMs: h.world.worstStepMs, ...grade(h.world.hashes) },
    deliveredByBundlePct: Number((100 * sum((s) => s.bundleTicks) / Math.max(1, sum((s) => s.expected))).toFixed(3)),
    worstSessionPct: Number((100 * Math.min(...ses.map((s) => (s.expected ? s.bundleTicks / s.expected : 1)))).toFixed(3)),
    repairTicks: sum((s) => s.repairTicks),
    inputsAppliedAsSentPct: sum((s) => s.mine) ? Number((100 * sum((s) => s.matched) / sum((s) => s.mine)).toFixed(3)) : null,
    downKBpsEach: Number((sum((s) => s.downKB) / Math.max(1, ses.length) / seconds).toFixed(2)),
  };
}

// The report to traces/<name>.json and stdout (`shown`, if it should be shorter), the verdict, the exit code.
export function finish(name, report, shown = report) {
  const gate = report.gate;
  report.gate = { ...gate, pass: Object.values(gate).every(Boolean) };
  writeFileSync(`traces/${name}.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...shown, gate: report.gate }, null, 2));
  console.log(`${name.toUpperCase()} gate: ${report.gate.pass ? 'PASS' : 'FAIL'}`);
  process.exit(report.gate.pass ? 0 : 1);
}
