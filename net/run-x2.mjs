#!/usr/bin/env node
// X2: Xbox clients online. The Deno relay with its referee on the Xbox's own
// sim (build/xbox/game.wasm, from xbox/sim/: browsers play another, so they
// have rooms of their own), and native clients: the Xbox build's own
// network code (xbox/online.c) over the relay's native door, played by
// scripted controllers (build/x86/xbox-headless --online). One native client
// joins with the room; the other joins late, from a keyframe, running under
// qemu-i386 -cpu pentium3 (the Xbox's instruction set) when qemu is installed.
// Every datagram both ways is impaired, but net/tiny-client.mjs's, the
// smallest whole client, which plays along.
//   node net/run-x2.mjs [--seconds 60] [--late 15] [--flip 25] [--impair delay=100,jitter=15,loss=0.05] [--no-qemu]
// The gate, each part in report.gate:
//   every native client ran to the end without an error, and was back on the
//   playout clock at the end;
//   the late one joined from a keyframe after sim tick 0 (an unpacked region)
//   with under 400 ticks to fast-forward;
//   the first native client's flipped bit (--flip seconds in, 0 for none) is
//   the referee's one mismatch, healed by a desync keyframe;
//   every other interval hash every client reported equals the referee's,
//   the tiny client's too; lost ticks came back as repairs.
// The report lands in traces/x2.json, frames in traces/x2-*.ppm.
import { sleep, opt, qemu, setup, relay, native, nativeReport, tiny, grader, finish } from './gate.mjs';

const seconds = Number(opt('seconds', 60));
const late = Number(opt('late', 15));
const impair = opt('impair', 'delay=100,jitter=15,loss=0.05');
const port = Number(opt('port', 4433));
const nativePort = Number(opt('native-port', 4434));
const seed = opt('seed', '7');
const flipAt = Number(opt('flip', 25));

const XBOX = 'build/xbox/game.wasm';
setup('x2', { x86: true });
const root = relay('traces/x2.relay.json', ['--port', String(port), '--native-port', String(nativePort), '--seed', seed, '--duration', String(seconds + 30), '--wasm', XBOX]);
await sleep(1500);

const report = { seconds, late, impair, qemu, natives: [], gate: {} };
let natives = [], small = null;
try {
  const run = { port: nativePort, out: 'traces/x2', impair };
  natives.push(native('native', { ...run, seconds, rng: 11, flip: flipAt }));
  small = tiny(nativePort, seconds - 5, XBOX);
  await sleep(late * 1000);
  natives.push(native(qemu ? 'native-late (qemu pentium3)' : 'native-late', { ...run, seconds: seconds - late, rng: 23, pentium3: qemu }));
  natives = await Promise.all(natives);
  small = await small;
} finally {
  await root.stop();
}

const relayRun = root.result();
const grade = grader(relayRun?.refHashes);
report.natives = natives.map((n) => nativeReport(n, grade));
report.tiny = small && { slot: small.slot, stepped: small.stepped, keys: small.keys, shots: small.shots, ...grade(small.hashes) };
report.relay = relayRun && {
  sessions: relayRun.sessions, leaves: relayRun.leaves, compared: relayRun.compared, agreed: relayRun.agreed, mismatches: relayRun.mismatches,
  repairs: relayRun.repairs, repairTicks: relayRun.repairTicks, keys: relayRun.keys, substitutedPct: relayRun.substitutedPct, stalls: relayRun.stalls,
  downKBpsPerSession: relayRun.downKBpsPerSession, upKBpsPerSession: relayRun.upKBpsPerSession,
};
const [first, second] = report.natives;
report.gate = {
  nativesRanClean: report.natives.length === 2 && report.natives.every((n) => n.code === 0 && !n.error),
  // a native client's last state before it leaves is "left"; it was playing if it stepped close to the room's end
  lateJoinFromKeyframe: !!second?.keys && second.keys[0]?.reason === 'join' && second.keys[0].simTick > 0 && second.fillTicks < 400,
  nativeHashesAgree: report.natives.every((n) => n.compared >= 4 && n.wrong === 0),
  tinyClientAgrees: report.tiny?.compared >= 4 && report.tiny.wrong === 0,
  flipCaughtAndHealed: !flipAt || (!!first?.flipTick && relayRun?.mismatches.length === 1 && relayRun.mismatches[0].slot === first.slot
    && first.keys.some((k) => k.reason === 'desync')),
  refereeFoundNoOtherMismatch: !!relayRun && relayRun.mismatches.every((m) => flipAt && m.slot === first?.slot),
  repairsUsed: !!first && first.repairTicks > 0,
};
finish('x2', report);
