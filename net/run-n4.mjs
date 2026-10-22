#!/usr/bin/env node
// N4: failover and replays. The root relay holds the room; a standby relay
// watches it (net/relay.ts --upstream root --standby), and edge B watches the
// root or, failing that, the standby (--upstream root,standby), serving
// spectators of its own. The bot host's golfers and a Chrome player (the golf
// bot at its controls) know both the root and the standby. Partway through,
// the root is killed (SIGKILL: no goodbye). The standby takes the room over
// from its own record and referee, the players come back to it for their own
// slots, and B follows it. When the golfers and the player leave, the standby
// writes the room's replay, from before the takeover to the end; the gate
// checks it, then Chrome plays it back and checks every interval too.
//   node net/run-n4.mjs [--seconds 60] [--kill 25] [--golfers 64] [--watchers 64] [--impair delay=100,jitter=15,loss=0.05] [--chrome 1]
// The gate, each part in report.gate:
//   the standby took the room over, holding every player's slot, and every
//   player came back to their own slot (resumed, not joined) within 2 s;
//   every hash report the standby compared equals its referee's, and the
//   golfers', Chrome's and B's spectators' hashes equal it before and after;
//   B's referee hashes the room as the standby's does, from its new upstream;
//   the replay holds the room from before the takeover to its end, and every
//   interval of it, stepped again, hashes as the standby's referee did; and
//   in Chrome, played at 8x, it agrees on every interval.
// The report lands in traces/n4.json; the replay in traces/n4/replays/.
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { parseImpair } from './impair.js';
import { decodeReplay, checkReplay } from './replay.mjs';
import { sleep, opt, setup, relay, botHost, chrome, grader, hostReport, finish } from './gate.mjs';

const seconds = Number(opt('seconds', 60));
const killAt = Number(opt('kill', 25));
const golfers = Number(opt('golfers', 64));
const watchers = Number(opt('watchers', 64));
const impair = opt('impair', 'delay=100,jitter=15,loss=0.05');
const chromeOn = Number(opt('chrome', 1));
const PORTS = { root: [4433, 4434], standby: [4443, 4444], b: [4453, 4454] };
const native = (name) => `127.0.0.1:${PORTS[name][1]}`;
const REPLAYS = 'traces/n4/replays';

const hash = setup('n4');
rmSync(REPLAYS, { recursive: true, force: true });
const common = (name) => ['--port', String(PORTS[name][0]), '--native-port', String(PORTS[name][1]), '--duration', String(seconds + 60)];
const report = { seconds, killAt, golfers, watchers, impair, relays: {}, hosts: {}, chrome: null, replay: null, gate: {} };
const t0 = Date.now();
const root = relay('traces/n4/root.relay.json', [...common('root'), '--seed', '7', '--replays', REPLAYS]);
await sleep(1500);
const standby = relay('traces/n4/standby.relay.json', [...common('standby'), '--upstream', native('root'), '--standby', '--replays', REPLAYS]);
const b = relay('traces/n4/b.relay.json', [...common('b'), '--upstream', `${native('root')},${native('standby')}`]);
const golf = botHost('traces/n4/golfers.json', ['--relay', `${native('root')},${native('standby')}`, '--bots', String(golfers), '--seconds', String(seconds - 4), '--rate', '100', '--impair', impair]);
await sleep(3000);
const watch = botHost('traces/n4/watch-b.json', ['--relay', native('b'), '--bots', String(watchers), '--seconds', String(seconds - 10), '--rate', '100', '--watch', '--impair', impair]);

const browser = chromeOn ? await chrome() : null;
let replayFile = null;
try {
  const page = browser && await browser.open({ bot: '1', present: '0', url: `https://127.0.0.1:${PORTS.root[0]}/,https://127.0.0.1:${PORTS.standby[0]}/`, hash, impair }, 'chrome');
  let slotBefore = null, killed = false;
  while (Date.now() - t0 < (seconds - 4) * 1000) {
    await sleep(1000);
    const st = page && await browser.state(page);
    if (!killed && Date.now() - t0 >= killAt * 1000) {
      slotBefore = st?.slot ?? null;
      report.relays.root = { cpuSeconds: root.cpu() };
      await root.stop('SIGKILL');
      killed = true;
      process.stderr.write(`\n${((Date.now() - t0) / 1000).toFixed(1)} s  the root is gone\n`);
    }
    process.stderr.write(`\r${((Date.now() - t0) / 1000).toFixed(0)} s  ${st ? `chrome slot ${st.slot}, state ${st.clState}, sim tick ${st.hole.tick}` : ''}   `);
  }
  await golf.done;
  if (page) {
    report.chrome = { ...await browser.record(page), slotBefore };
    // its leaving, the golfers' gone already, empties the room: the standby writes the replay
    await page.close({ runBeforeUnload: true });
  }
  for (let k = 0; k < 40 && !replayFile; k++) {
    await sleep(250);
    replayFile = readdirSync(REPLAYS).filter((f) => f.endsWith('.qgr')).map((f) => `${REPLAYS}/${f}`)[0] ?? null;
  }
  if (replayFile) {
    // a moment for the file to be whole
    await sleep(500);
    const bytes = readFileSync(replayFile);
    const r = await decodeReplay(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    const out = await checkReplay(readFileSync('build/game.wasm'), r);
    report.replay = { file: replayFile, bytes: bytes.length, seconds: Number((out.ticks * 0.008).toFixed(1)), fromSimTick: r.from - r.roomStart, endSimTick: r.from - r.roomStart + out.ticks,
      fromKeyframe: !!r.region, hashes: r.hashes.size, compared: out.compared, wrong: out.wrong, players: out.players.length };
    if (browser) {
      const rp = await browser.open({ replay: `../${replayFile}`, present: '0' }, 'replay');
      for (let k = 0; k < 3; k++) { await sleep(300); await rp.keyboard.press('BracketRight'); }
      let st = null, shot = false;
      for (let k = 0; k < 60; k++) {
        await sleep(1000);
        st = await browser.state(rp);
        process.stderr.write(`\rreplay in chrome: ${st?.replay ? `${st.replay.equal} of ${st.replay.hashes} equal, ${st.replay.speed}x` : st?.error || '-'}   `);
        // a frame from the middle, with the room full
        if (!shot && st?.replay?.equal >= report.replay.compared / 2) shot = !!await browser.capture(rp, 'traces/n4-replay.png');
        if (st?.replay?.paused && st.replay.equal + st.replay.differ.length >= report.replay.compared) break;
      }
      report.replay.chrome = st?.replay ? { equal: st.replay.equal, differ: st.replay.differ, speed: st.replay.speed, error: st.error } : { error: st?.error || 'no state' };
      process.stderr.write('\n');
    }
  }
} finally {
  await browser?.close();
  await watch.done;
  for (const [name, r] of [['standby', standby], ['b', b]]) { report.relays[name] = { cpuSeconds: r.cpu() }; await r.stop(); }
  await root.stop('SIGKILL');
}

const s = standby.result(), bRun = b.result();
const grade = grader(s?.refHashes);
report.relays.standby = s && {
  ...report.relays.standby, takeover: s.takeover, resumed: s.resumed, sessions: s.sessions, rejected: s.rejected, compared: s.compared, agreed: s.agreed, mismatches: s.mismatches.length,
  upstream: s.upstream && { links: s.upstream.links, keys: s.upstream.keys }, replays: s.replays, closeLateMs: s.closeLateMs,
};
report.relays.b = bRun && {
  ...report.relays.b, referee: grade(bRun.refHashes), watchers: bRun.watchers, compared: bRun.compared, agreed: bRun.agreed, mismatches: bRun.mismatches.length,
  upstream: bRun.upstream && { links: bRun.upstream.links, keys: bRun.upstream.keys, syncs: bRun.upstream.syncs },
};
const golfRun = golf.result(), watchRun = watch.result();
if (golfRun) {
  const fo = golfRun.sessions.flatMap((x) => x.failovers);
  report.hosts.golfers = { ...hostReport(golfRun, grade, seconds - 4), failovers: fo.length, kept: fo.filter((f) => f.kept).length, worstFailoverMs: Math.max(...fo.map((f) => f.ms)) };
}
if (watchRun) report.hosts['watch-b'] = hostReport(watchRun, grade, seconds - 10);
if (report.chrome) report.chrome = { slot: report.chrome.slot, slotBefore: report.chrome.slotBefore, clState: report.chrome.clState, error: report.chrome.error, keys: report.chrome.keys, ...grade(report.chrome.hashes) };
const players = golfers + (chromeOn ? 1 : 0);
const take = s?.takeover;
const g = report.hosts.golfers, w = report.hosts['watch-b'], rep = report.replay;
const loss = parseImpair(impair).loss || 0;
report.gate = {
  standbyTookOver: !!take && take.ghosts === players && s.resumed === players,
  everyoneKeptTheirSlot: !!g && g.joined === golfers && g.failovers === golfers && g.kept === golfers && g.worstFailoverMs < 2000
    && (!chromeOn || (report.chrome?.slot === report.chrome?.slotBefore && report.chrome.slot >= 0)),
  everyReportAgrees: !!s && s.compared > 0 && s.agreed === s.compared && s.mismatches.length === 0,
  playersHashAsTheReferee: !!g && g.world.compared >= 4 && g.world.wrong === 0 && (!chromeOn || (report.chrome?.compared >= 4 && report.chrome.wrong === 0 && !report.chrome.error)),
  edgeFollowedTheStandby: !!bRun && bRun.upstream.links.includes(native('standby')) && report.relays.b.referee.compared >= 4 && report.relays.b.referee.wrong === 0
    && bRun.compared > 0 && bRun.agreed === bRun.compared && w?.joined === watchers && w.world.wrong === 0 && w.world.compared >= 4,
  spectatorsDelivered: !!w && w.deliveredByBundlePct >= 100 * (1 - loss * loss) - 2,
  replaySpansTheTakeover: !!rep && !!take && rep.fromSimTick < take.simTick && rep.endSimTick > take.simTick + 125 * 10,
  replayChecksOut: !!rep && rep.compared >= 8 && rep.wrong.length === 0,
  chromeReplayAgrees: !chromeOn || (!!rep?.chrome && rep.chrome.equal >= rep.compared && rep.chrome.differ.length === 0),
};
finish('n4', report);
