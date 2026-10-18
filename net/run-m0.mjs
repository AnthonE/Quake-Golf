#!/usr/bin/env node
// M0: the Deno relay, one Chrome client and N bots (WebTransport sessions in
// Chrome workers), for a fixed time; then the gate.
//   node net/run-m0.mjs [--bots 63] [--duration 60] [--impair delay=40,jitter=10,loss=0.05] [--cc low-latency] [--label clean]
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { serve } from '../tools/serve.mjs';
import { MAX_DATAGRAM, TICK_MS, percentile } from './wire.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const bots = Number(opt('bots', 63));
const duration = Number(opt('duration', 60));
const impair = opt('impair', '');
const cc = opt('cc', 'low-latency');
const port = Number(opt('port', 4433));
const workers = Number(opt('workers', 4));
const label = opt('label', impair ? 'impaired' : 'clean');
const DENO = existsSync('.tools/deno') ? '.tools/deno' : 'deno';
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

execFileSync('sh', ['tools/cert.sh'], { stdio: 'inherit' });
if (!existsSync('build/game.wasm')) execFileSync(process.execPath, ['tools/asm.mjs'], { stdio: 'inherit' });
const hash = readFileSync('certs/hash.txt', 'utf8').trim();

// 1. relay
const relay = spawn(DENO, ['run', '--unstable-net', '-A', 'net/relay.ts', '--port', String(port), '--duration', String(duration + 10), '--cc', cc], { stdio: ['ignore', 'pipe', 'pipe'] });
let relayOut = '';
relay.stdout.on('data', (d) => { relayOut += d; });
const relayDone = new Promise((ok) => relay.on('exit', (code) => ok(code)));
await new Promise((ok, fail) => {
  relay.stderr.on('data', (d) => { if (String(d).includes('listening')) ok(); else process.stderr.write(d); });
  relay.on('exit', () => fail(new Error('relay exited early')));
});

// 2. Chrome: the client page plus bots in workers
const require = createRequire(import.meta.url);
const { chromium } = (() => { for (const n of ['playwright', 'playwright-core']) { try { return require(n); } catch { /* next */ } } throw new Error('playwright not found'); })();
const { server, port: webPort } = await serve();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || (existsSync(LOCAL_CHROMIUM) ? LOCAL_CHROMIUM : undefined),
  args: ['--no-sandbox'],
});
let page;
let m0;
try {
  page = await browser.newPage();
  page.on('console', (m) => process.stderr.write(`[page] ${m.text()}\n`));
  const q = new URLSearchParams({ url: `https://127.0.0.1:${port}/`, hash, bots: String(bots), workers: String(workers), duration: String(duration), impair });
  await page.goto(`http://127.0.0.1:${webPort}/net/client/index.html?${q}`);
  const t0 = Date.now();
  while (!(m0 = await page.evaluate(() => window.__m0 || null))) {
    if (Date.now() - t0 > (duration + 60) * 1000) throw new Error('timed out waiting for the clients');
    process.stderr.write(`\r${label}: ${Math.round((Date.now() - t0) / 1000)} s of ${duration}   `);
    await new Promise((ok) => setTimeout(ok, 1000));
  }
  process.stderr.write('\n');
} finally {
  await browser.close();
  server.close();
}
if (m0.error) { console.error(m0.error); relay.kill(); process.exit(1); }
await relayDone;
const r = JSON.parse(relayOut.trim().split('\n').at(-1));

// 3. the gate
const all = [m0.client, ...m0.bots];
const rejects = all.filter((b) => b.reject).length;
const seen = all.reduce((a, b) => a + (b.ticksSeen || 0), 0);
const expected = all.reduce((a, b) => a + (b.ticksExpected || 0), 0);
const devs = [];
// Jitter: each bundle's arrival against its ideal slot, offset by that client's median.
for (const b of all) {
  if (!b.arrivals?.length) continue;
  const off = b.arrivals.map(([T, ms]) => ms - T * TICK_MS);
  const med = [...off].sort((x, y) => x - y)[Math.floor(off.length / 2)];
  for (const o of off) devs.push(Math.abs(o - med));
}
devs.sort((x, y) => x - y);
const mine = all.reduce((a, b) => a + (b.mine || 0), 0);
const matched = all.reduce((a, b) => a + (b.mineMatched || 0), 0);
// Bundles flow server to client, so the sender's limit is the server session's;
// Chrome's maxDatagramSize is its own send limit, which only inputs must respect.
const limit = Math.min(MAX_DATAGRAM, r.serverMaxDatagram.min);
const maxInput = Math.max(...all.map((b) => b.maxInput || 0));
const report = {
  label, bots, sessions: r.sessions, rejects, durationS: duration, cc,
  impair: impair || 'none',
  chromeMaxDatagram: m0.client.maxDatagram,
  serverMaxDatagram: r.serverMaxDatagram,
  maxBundle: r.maxBundle, oversize: r.oversize, limit, maxInput,
  delivered: expected ? Number((100 * seen / expected).toFixed(3)) : 0,
  bundleJitterMs: { p50: percentile(devs, 0.5)?.toFixed(3), p95: percentile(devs, 0.95)?.toFixed(3), p99: percentile(devs, 0.99)?.toFixed(3) },
  inputsAppliedAsSentPct: mine ? Number((100 * matched / mine).toFixed(3)) : 0,
  relay: r,
  clientLead: m0.client.lead,
};
const gate = {
  fits: r.maxBundle <= limit && maxInput <= m0.client.maxDatagram,
  noOversize: r.oversize === 0,
  delivered: report.delivered >= 99.9,
  everyoneJoined: rejects === 0 && r.sessions === bots + 1,
};
report.gate = { ...gate, pass: Object.values(gate).every(Boolean) };
mkdirSync('traces', { recursive: true });
writeFileSync(`traces/m0-${label}.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, relay: undefined }, null, 2));
console.log(`relay: close lateness p99 ${r.closeLateMs.p99} ms, input slack p5 ${r.inputSlackMs.p5} ms, substituted ${r.substitutedPct}%, ${r.downKBpsPerSession} KB/s down, ${r.upKBpsPerSession} KB/s up per session`);
console.log(report.gate.pass ? 'M0 gate: PASS' : 'M0 gate: FAIL');
process.exit(report.gate.pass ? 0 : 1);
