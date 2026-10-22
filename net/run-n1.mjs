#!/usr/bin/env node
// N1: 256 players in one room. The Deno relay with its referee; two Chrome
// clients, one with the golf bot at the controls and one with the neural
// golfer; and the bot host (net/bot-host.mjs) filling every other slot with
// a neural golfer, each its own session over the relay's native door. Every
// datagram both ways is impaired, and then one more player knocks and is
// turned away. (Xbox clients play their own sim, and so their own rooms:
// net/run-x2.mjs.)
//   node net/run-n1.mjs [--seconds 90] [--chrome 2] [--impair delay=100,jitter=15,loss=0.05]
// The gate, each part in report.gate:
//   all 256 slots held at once, and the 257th refused as full;
//   every interval hash every client reported (the bot host's for each of its
//   sessions) equals the referee's, and the referee found no mismatch;
//   every bundle datagram fit the 1,161-byte budget, and the bot host's sessions
//   heard ticks by bundle at the rate two bundles a tick give at this loss,
//   less 0.5 point, their inputs applied as sent.
// The report lands in traces/n1.json; the Chrome clients' frames once the room
// is full, and their scoreboards then, in traces/n1-*.png.
import * as W from './wire.mjs';
import { parseImpair } from './impair.js';
import { sleep, opt, setup, relay, botHost, chrome, knock, grader, hostReport, genome, finish } from './gate.mjs';

const seconds = Number(opt('seconds', 90));
const chromeClients = Number(opt('chrome', 2));
const impair = opt('impair', 'delay=100,jitter=15,loss=0.05');
const port = Number(opt('port', 4433));
const nativePort = Number(opt('native-port', 4434));
const seed = opt('seed', '7');
const bots = W.NP - chromeClients;

const hash = setup('n1');
const root = relay('traces/n1.relay.json', ['--port', String(port), '--native-port', String(nativePort), '--seed', seed, '--duration', String(seconds + 30)]);
await sleep(1500);

const browser = chromeClients > 0 ? await chrome() : null;
const pages = [];
const report = { seconds, impair, players: W.NP, bots, chrome: [], screenshots: [], gate: {} };
const t0 = Date.now();
let host = null;
try {
  for (let k = 0; k < chromeClients; k++) {
    pages.push(await browser.open({ bot: '1', present: '0', url: `https://127.0.0.1:${port}/`, hash, impair, ...(k % 2 ? { genome: genome() } : {}) }, `chrome ${k}`));
  }
  host = botHost('traces/n1/bot-host.json', ['--relay', `127.0.0.1:${nativePort}`, '--bots', String(bots), '--seconds', String(seconds - 4), '--rate', '50', '--impair', impair]);
  // the room is full once the bot host is in: one more is turned away
  await sleep(30000);
  report.knock = await knock(nativePort);
  for (const [k, p] of pages.entries()) {
    for (const file of [await browser.capture(p, `traces/n1-c${k}-full.png`), await browser.capture(p, `traces/n1-c${k}-scores.png`, true)]) if (file) report.screenshots.push(file);
  }
  while (Date.now() - t0 < seconds * 1000) {
    await sleep(5000);
    const st = await Promise.all(pages.map((p) => browser.state(p)));
    process.stderr.write(`\r${((Date.now() - t0) / 1000).toFixed(0)} s  ${st.map((s, k) => s?.me ? `chrome ${k}: tick ${s.hole.tick} strokes ${s.me.strokes}` : `chrome ${k}: -`).join(' | ')}   `);
  }
  process.stderr.write('\n');
  report.relayCpuSeconds = root.cpu();
  await host.done;
  report.chrome = await Promise.all(pages.map((p) => browser.record(p)));
} finally {
  await browser?.close();
  await host?.stop();
  await root.stop();
}

const relayRun = root.result();
const botRun = host?.result();
const grade = grader(relayRun?.refHashes);
report.chrome = report.chrome.map((c) => ({ slot: c.slot, clState: c.clState, error: c.error, keys: c.keys, ...grade(c.hashes) }));
report.botHost = botRun && { ...hostReport(botRun, grade, seconds), strokes: botRun.world.players.reduce((a, p) => a + p.strokes + p.total, 0) };
report.relay = relayRun && {
  sessions: relayRun.sessions, rejected: relayRun.rejected, leaves: relayRun.leaves, compared: relayRun.compared, agreed: relayRun.agreed, mismatches: relayRun.mismatches,
  bundlesSent: relayRun.bundlesSent, datagramsPerBundle: Number((relayRun.bundleDatagrams / relayRun.bundlesSent).toFixed(3)), bytesPerBundle: relayRun.bytesPerBundle,
  maxDatagramSent: relayRun.maxDatagramSent, tickBytes: relayRun.tickBytes, repairs: relayRun.repairs, repairTicks: relayRun.repairTicks, fills: relayRun.fills,
  keys: relayRun.keys.length, substitutedPct: relayRun.substitutedPct, stalls: relayRun.stalls, closeLateMs: relayRun.closeLateMs, refLagMax: relayRun.refLagMax,
  downKBpsPerSession: relayRun.downKBpsPerSession, upKBpsPerSession: relayRun.upKBpsPerSession,
  cpuPctOfOneCore: report.relayCpuSeconds ? Number((100 * report.relayCpuSeconds / seconds).toFixed(1)) : null,
};
const loss = parseImpair(impair).loss || 0;
report.gate = {
  roomFull: !!relayRun && relayRun.sessions === W.NP && botRun?.joined === bots && botRun.rejected === 0 && report.knock?.reject === W.REJECT.FULL,
  botHostHashesAgree: !!botRun && botRun.errors.length === 0 && report.botHost.world.compared >= 4 && report.botHost.world.wrong === 0,
  chromeHashesAgree: report.chrome.length === chromeClients && report.chrome.every((c) => c.compared >= 4 && c.wrong === 0),
  refereeFoundNoMismatch: !!relayRun && relayRun.mismatches.length === 0,
  bundlesFit: !!relayRun && relayRun.maxDatagramSent <= W.MAX_DATAGRAM,
  delivered: !!report.botHost && report.botHost.deliveredByBundlePct >= 100 * (1 - loss * loss) - 0.5 && report.botHost.inputsAppliedAsSentPct >= 99,
};
finish('n1', report);
