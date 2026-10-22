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
import * as W from './wire.mjs';
import { parseImpair } from './impair.js';
import { sleep, opt, setup, relay, botHost, chrome, knock, grader, hostReport, finish } from './gate.mjs';

const seconds = Number(opt('seconds', 60));
const golfers = Number(opt('golfers', 128));
const watchersEach = Number(opt('watchers', 200));
const impair = opt('impair', 'delay=100,jitter=15,loss=0.05');
const chromeOn = Number(opt('chrome', 1));
// name: [QUIC port, native port, upstream (a relay name) or null]
const RELAYS = { root: [4433, 4434, null], a: [4443, 4444, 'root'], b: [4453, 4454, 'root'], c: [4463, 4464, 'a'] };
const EDGES = ['a', 'b', 'c'];

const hash = setup('n3');
const relays = {}, hosts = {};
const start = (name, duration) => {
  const [port, nativePort, upName] = RELAYS[name];
  relays[name] = relay(`traces/n3/${name}.relay.json`, ['--port', String(port), '--native-port', String(nativePort), '--duration', String(duration),
    ...(upName ? ['--upstream', `127.0.0.1:${RELAYS[upName][1]}`] : ['--seed', '7'])]);
};
const host = (name, relayName, n, secs, extra) => {
  hosts[name] = botHost(`traces/n3/${name}.json`, ['--relay', `127.0.0.1:${RELAYS[relayName][1]}`, '--bots', String(n), '--seconds', String(secs), '--rate', '100', ...extra]);
};

const report = { seconds, golfers, watchersEach, impair, relays: {}, hosts: {}, chrome: null, gate: {} };
const t0 = Date.now();
start('root', seconds + 40);
await sleep(1500);
host('golfers', 'root', golfers, seconds + 15, []);
await sleep(4000);
// the tree: A and B watch the root, C watches A
start('a', seconds + 30); start('b', seconds + 30);
await sleep(2500);
start('c', seconds + 25);
await sleep(2500);
for (const e of EDGES) host(`watch-${e}`, e, watchersEach, seconds - 10, ['--watch', '--impair', impair]);

const browser = chromeOn ? await chrome() : null;
try {
  const page = browser && await browser.open({ watch: '1', present: '0', url: `https://127.0.0.1:${RELAYS.c[0]}/`, hash, impair }, 'chrome');
  report.knock = await knock(RELAYS.b[1]);
  let shot = false;
  while (Date.now() - t0 < (seconds + 8) * 1000) {
    await sleep(5000);
    const st = page && await browser.state(page);
    process.stderr.write(`\r${((Date.now() - t0) / 1000).toFixed(0)} s  ${st ? `chrome watching P${st.watching + 1}, sim tick ${st.hole.tick}` : ''}   `);
    if (page && !shot && Date.now() - t0 > seconds * 600) shot = !!await browser.capture(page, 'traces/n3-watch.png');
  }
  process.stderr.write('\n');
  if (page) report.chrome = await browser.record(page);
} finally {
  await browser?.close();
  for (const name of EDGES.concat('root')) report.relays[name] = { cpuSeconds: relays[name].cpu() };
  await Promise.all(Object.values(hosts).map((h) => h.done));
  for (const name of ['c', 'b', 'a', 'root']) await relays[name].stop();
}

const runs = Object.fromEntries(Object.entries(relays).map(([n, r]) => [n, r.result()]));
const grade = grader(runs.root?.refHashes);
for (const name of Object.keys(RELAYS)) {
  const r = runs[name];
  if (!r) { report.relays[name].missing = true; continue; }
  Object.assign(report.relays[name], {
    upstream: RELAYS[name][2], players: r.sessions, watchers: r.watchers, compared: r.compared, agreed: r.agreed, mismatches: r.mismatches.length,
    referee: name === 'root' ? { intervals: r.refHashes.length } : grade(r.refHashes), upstreamLink: r.upstream && { keys: r.upstream.keys, ticks: r.upstream.ticks, repairs: r.upstream.repairs, syncs: r.upstream.syncs },
    cpuPctOfOneCore: report.relays[name].cpuSeconds ? Number((100 * report.relays[name].cpuSeconds / seconds).toFixed(1)) : null,
  });
}
for (const [name, h] of Object.entries(hosts)) {
  const run = h.result();
  if (run) report.hosts[name] = hostReport(run, grade, seconds - 10);
}
if (report.chrome) report.chrome = { watching: report.chrome.watching, clState: report.chrome.clState, error: report.chrome.error, keys: report.chrome.keys, ...grade(report.chrome.hashes) };
const loss = parseImpair(impair).loss || 0;
const w = EDGES.map((e) => report.hosts[`watch-${e}`]);
report.gate = {
  edgesHashAsTheRoot: EDGES.every((e) => report.relays[e].referee?.compared >= 4 && report.relays[e].referee.wrong === 0),
  everyReportAgrees: Object.values(report.relays).every((r) => r.compared > 0 && r.agreed === r.compared && r.mismatches === 0),
  golfersHashAsTheRoot: report.hosts.golfers?.joined === golfers && report.hosts.golfers.world.wrong === 0 && report.hosts.golfers.world.compared >= 4,
  everySpectatorIn: w.every((h) => h && h.joined === watchersEach && h.rejected === 0 && h.errors === 0 && h.world.compared >= 4 && h.world.wrong === 0),
  chromeSpectatorAgrees: !chromeOn || (!!report.chrome && !report.chrome.error && report.chrome.watching >= 0 && report.chrome.compared >= 4 && report.chrome.wrong === 0),
  delivered: w.every((h) => h && h.deliveredByBundlePct >= 100 * (1 - loss * loss) - 0.5),
  edgesWatchOnly: report.knock?.reject === W.REJECT.WATCH_ONLY,
};
finish('n3', report);
