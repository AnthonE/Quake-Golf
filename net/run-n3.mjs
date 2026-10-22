#!/usr/bin/env node
// N3: spectators, through a tree of relays. The root relay holds the room:
// the bot host's golfers play it. Edge relays A and B watch the root, and C
// watches A, each a spectator upstream (net/relay.ts --upstream) with its own
// referee, serving the room to spectators of its own: the bot host in --watch
// mode on each edge, and on C, the deepest, a Chrome client watching (?watch=1)
// through a golfer's eyes. Every spectator's own link is impaired; the links
// between relays are not. Then a player knocks at an edge.
//   node net/run-n3.mjs [--seconds 60] [--golfers 128] [--watchers 200] [--impair delay=100,jitter=15,loss=0.05] [--chrome 1]
// The gate, each part in report.gate:
//   every edge's referee hashes the room as the root's does;
//   every hash report each relay compared, its spectators' and its children's,
//   equals that relay's referee's, and the root's players' too;
//   every spectator joined (from its edge's own keyframe), and its shared world
//   hashes as the root's; the Chrome spectator's every interval too;
//   spectators heard ticks by bundle at the rate two bundles a tick give at
//   this loss, less 0.5 point;
//   an edge turns a player away (spectators only).
// The report lands in traces/n3.json; the Chrome spectator's frame in traces/n3-watch.png.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import { serve } from '../tools/serve.mjs';
import * as W from './wire.mjs';
import { parseImpair } from './impair.js';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const seconds = Number(opt('seconds', 60));
const golfers = Number(opt('golfers', 128));
const watchersEach = Number(opt('watchers', 200));
const impair = opt('impair', 'delay=100,jitter=15,loss=0.05');
const chrome = Number(opt('chrome', 1));
const DENO = existsSync('.tools/deno') ? '.tools/deno' : 'deno';
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// name: [QUIC port, native port, upstream (a relay name) or null]
const RELAYS = { root: [4433, 4434, null], a: [4443, 4444, 'root'], b: [4453, 4454, 'root'], c: [4463, 4464, 'a'] };
const EDGES = ['a', 'b', 'c'];

execFileSync('sh', ['tools/cert.sh'], { stdio: 'inherit' });
execFileSync(process.execPath, ['tools/asm.mjs'], { stdio: 'inherit' });
const hash = readFileSync('certs/hash.txt', 'utf8').trim();
mkdirSync('traces/n3', { recursive: true });
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const cpuOf = (pid) => { try { const f = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); return (Number(f[11]) + Number(f[12])) / 100; } catch { return null; } };

const procs = {};
function relay(name, duration) {
  const [port, nativePort, upName] = RELAYS[name];
  const path = `traces/n3/${name}.relay.json`;
  rmSync(path, { force: true });
  const args = ['run', '--unstable-net', '-A', '--v8-flags=--single-threaded-gc', 'net/relay.ts', '--port', String(port), '--native-port', String(nativePort),
    '--duration', String(duration), '--summary', path, '--quiet', ...(upName ? ['--upstream', `127.0.0.1:${RELAYS[upName][1]}`] : ['--seed', '7'])];
  const p = spawn(DENO, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  procs[name] = { p, path, done: new Promise((ok) => p.on('exit', ok)), cpu0: null };
  setTimeout(() => { procs[name].cpu0 = cpuOf(p.pid); }, 500);
}
function host(name, relayName, n, secs, extra) {
  const path = `traces/n3/${name}.json`;
  rmSync(path, { force: true });
  const p = spawn(process.execPath, ['net/bot-host.mjs', '--relay', `127.0.0.1:${RELAYS[relayName][1]}`, '--bots', String(n), '--seconds', String(secs),
    '--rate', '100', '--out', path, '--quiet', ...extra], { stdio: ['ignore', 'inherit', 'inherit'] });
  procs[name] = { p, path, done: new Promise((ok) => p.on('exit', ok)) };
}
// a player at an edge's door: the answer to its hello
function knock(port) {
  return new Promise(async (ok) => {
    const prefix = await W.wasmPrefix(readFileSync('build/game.wasm'));
    const c = net.connect({ host: '127.0.0.1', port }, () => c.write(W.encodeHello({ maxDatagram: 1400, wasmPrefix: prefix })));
    let got = Buffer.alloc(0);
    c.on('data', (d) => { got = Buffer.concat([got, d]); if (got.length >= 4) { c.destroy(); ok(got[0] === W.T_REJECT ? { reject: got[1] } : { admitted: true }); } });
    c.on('error', () => ok({ error: true }));
    setTimeout(() => { c.destroy(); ok({ timeout: true }); }, 5000);
  });
}

const report = { seconds, golfers, watchersEach, impair, relays: {}, hosts: {}, chrome: null, gate: {} };
const t0 = Date.now();
relay('root', seconds + 40);
await sleep(1500);
host('golfers', 'root', golfers, seconds + 15, []);
await sleep(4000);
// the tree: A and B watch the root, C watches A
relay('a', seconds + 30); relay('b', seconds + 30);
await sleep(2500);
relay('c', seconds + 25);
await sleep(2500);
for (const e of EDGES) host(`watch-${e}`, e, watchersEach, seconds - 10, ['--watch', '--impair', impair]);

let browser = null, server = null, page = null;
try {
  if (chrome) {
    const require = createRequire(import.meta.url);
    const { chromium } = (() => { for (const n of ['playwright', 'playwright-core']) { try { return require(n); } catch { /* next */ } } throw new Error('playwright not found'); })();
    let webPort;
    ({ server, port: webPort } = await serve());
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || (existsSync(LOCAL_CHROMIUM) ? LOCAL_CHROMIUM : undefined),
      args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'],
    });
    page = await browser.newPage({ viewport: { width: 640, height: 400 } });
    page.on('pageerror', (e) => process.stderr.write(`\n[chrome] ${e.message}\n`));
    const q = new URLSearchParams({ watch: '1', present: '0', url: `https://127.0.0.1:${RELAYS.c[0]}/`, hash, impair });
    await page.goto(`http://127.0.0.1:${webPort}/client/index.html?${q}`);
  }
  report.knock = await knock(RELAYS.b[1]);
  let shot = false;
  while (Date.now() - t0 < (seconds + 8) * 1000) {
    await sleep(5000);
    const st = page && await page.evaluate(() => window.__qg?.state?.() || null).catch(() => null);
    process.stderr.write(`\r${((Date.now() - t0) / 1000).toFixed(0)} s  ${st ? `chrome watching P${st.watching + 1}, sim tick ${st.hole.tick}` : ''}   `);
    if (page && !shot && Date.now() - t0 > seconds * 600) {
      const png = await page.evaluate(() => window.__qg.capture?.(2)).catch(() => null);
      if (png) { writeFileSync('traces/n3-watch.png', Buffer.from(png, 'base64')); shot = true; }
    }
  }
  process.stderr.write('\n');
  if (page) {
    report.chrome = await page.evaluate(() => {
      const s = window.__qg.state();
      return { watching: s.watching, clState: s.clState, error: s.error, hashes: window.__qg.hashes, keys: window.__qg.keys.map((k) => ({ reason: k.reason, simTick: k.simTick })) };
    });
  }
} finally {
  await browser?.close();
  server?.close();
  for (const name of Object.keys(RELAYS)) report.relays[name] = { cpuSeconds: procs[name].cpu0 !== null ? cpuOf(procs[name].p.pid) - procs[name].cpu0 : null };
  await Promise.all(Object.keys(procs).filter((n) => !RELAYS[n]).map((n) => procs[n].done));
  for (const name of ['c', 'b', 'a', 'root']) { procs[name].p.kill('SIGTERM'); await Promise.race([procs[name].done, sleep(5000)]); }
}

const read = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);
const runs = Object.fromEntries(Object.keys(procs).map((n) => [n, read(procs[n].path)]));
const rootRef = new Map((runs.root?.refHashes || []).map(([t, h]) => [t, h]));
const grade = (hashes) => {
  let compared = 0, wrong = 0;
  for (const [t, h] of hashes) {
    if (!rootRef.has(t)) continue;
    compared++;
    if (rootRef.get(t) !== (typeof h === 'string' ? h.replace(/^0x/, '') : BigInt(h).toString(16))) wrong++;
  }
  return { compared, wrong };
};
for (const name of Object.keys(RELAYS)) {
  const r = runs[name];
  if (!r) { report.relays[name].missing = true; continue; }
  Object.assign(report.relays[name], {
    upstream: RELAYS[name][2], players: r.sessions, watchers: r.watchers, compared: r.compared, agreed: r.agreed, mismatches: r.mismatches.length,
    referee: name === 'root' ? { intervals: r.refHashes.length } : grade(r.refHashes), upstreamLink: r.upstream && { keys: r.upstream.keys, ticks: r.upstream.ticks, repairs: r.upstream.repairs, syncs: r.upstream.syncs },
    cpuPctOfOneCore: report.relays[name].cpuSeconds ? Number((100 * report.relays[name].cpuSeconds / seconds).toFixed(1)) : null,
  });
}
for (const [name, h] of Object.entries(runs)) {
  if (RELAYS[name] || !h) continue;
  const ses = h.sessions.filter((s) => s.joined);
  const sum = (f) => ses.reduce((a, s) => a + f(s), 0);
  report.hosts[name] = {
    watch: h.watch, joined: h.joined, rejected: h.rejected, errors: h.errors.length, cpuPctOfOneCore: h.cpuPctOfOneCore, keys: h.world.keys, ...grade(h.world.hashes),
    deliveredByBundlePct: Number((100 * sum((s) => s.bundleTicks) / Math.max(1, sum((s) => s.expected))).toFixed(3)),
    downKBpsEach: Number((sum((s) => s.downKB) / Math.max(1, ses.length) / (seconds - 10)).toFixed(2)),
  };
}
if (report.chrome) report.chrome = { ...report.chrome, ...grade(report.chrome.hashes), hashes: undefined };
const loss = parseImpair(impair).loss || 0;
const w = EDGES.map((e) => report.hosts[`watch-${e}`]);
const gate = {
  edgesHashAsTheRoot: EDGES.every((e) => report.relays[e].referee?.compared >= 4 && report.relays[e].referee.wrong === 0),
  everyReportAgrees: Object.values(report.relays).every((r) => r.compared > 0 && r.agreed === r.compared && r.mismatches === 0),
  golfersHashAsTheRoot: report.hosts.golfers?.joined === golfers && report.hosts.golfers.wrong === 0 && report.hosts.golfers.compared >= 4,
  everySpectatorIn: w.every((h) => h && h.joined === watchersEach && h.rejected === 0 && h.errors === 0 && h.compared >= 4 && h.wrong === 0),
  chromeSpectatorAgrees: !chrome || (!!report.chrome && !report.chrome.error && report.chrome.watching >= 0 && report.chrome.compared >= 4 && report.chrome.wrong === 0),
  delivered: w.every((h) => h && h.deliveredByBundlePct >= 100 * (1 - loss * loss) - 0.5),
  edgesWatchOnly: report.knock?.reject === W.REJECT.WATCH_ONLY,
};
report.gate = { ...gate, pass: Object.values(gate).every(Boolean) };
writeFileSync('traces/n3.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
console.log(report.gate.pass ? 'N3 gate: PASS' : 'N3 gate: FAIL');
process.exit(report.gate.pass ? 0 : 1);
