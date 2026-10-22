// The replay worker, in the net worker's place for ?replay=<url>: a room from
// a replay file (net/replay.mjs). It hands the sim worker the file's keyframe
// (or the room's start) and every tick at once, and keeps the playout clock
// itself: paused, at a speed, or moved to a time. A time before the newest
// tick stepped restores the start and steps forward again; the sim is fast
// enough that a minute of play takes well under a second. The file's
// interval hashes go to the page, which checks the sim's against them.
//   in:  { replay: url, memory, prefix, simPort } once, then { pause }, { speed: x }, { seek: seconds }, { to: sim tick }
//   out: { welcome, replay: { first, end, roomStart, hashes: [[sim tick, hex]] } }, { state: { speed, paused } }
import * as L from '../src/layout.mjs';
import { TICK_MS } from '../net/wire.mjs';
import { decodeReplay } from '../net/replay.mjs';
import { writeClock } from './clock.mjs';

const epoch = () => performance.timeOrigin + performance.now();
let command = () => {};
self.onmessage = (e) => {
  if (!e.data.replay) { command(e.data); return; }
  run(e.data).catch((err) => {
    Atomics.store(new Int32Array(e.data.memory.buffer), L.CL_STATE >> 2, 3);
    self.postMessage({ error: String(err?.stack || err) });
  });
};

async function run({ replay, memory, prefix, simPort }) {
  const i32 = new Int32Array(memory.buffer);
  const f64 = new Float64Array(memory.buffer);
  const dv = new DataView(memory.buffer);
  const res = await fetch(replay);
  if (!res.ok) throw new Error(`replay: ${res.status} for ${replay}`);
  const r = await decodeReplay(new Uint8Array(await res.arrayBuffer()));
  if (r.prefix.some((b, i) => b !== prefix[i])) throw new Error('this replay is from another build of game.wasm');
  const first = r.from, end = r.from + r.ticks.length;
  const welcome = { watch: true, slot: -1, seed: r.seed, roomStart: r.roomStart, joinTick: first, serverTick: first };
  Atomics.store(i32, L.CL_ROOM >> 2, r.roomStart);
  Atomics.store(i32, L.CL_SLOT >> 2, -1);
  Atomics.store(i32, L.CL_NEXT >> 2, first);
  simPort.postMessage({ welcome });
  self.postMessage({ welcome, replay: { first, end, roomStart: r.roomStart, hashes: [...r.hashes].map(([t, h]) => [t, h.toString(16)]) } });
  simPort.onmessage = () => {}; // its hash reports and resync asks have nowhere to go
  const ticks = r.ticks.map((t) => ({ t: t.tick, parts: t.parts }));

  let speed = 1, paused = false;
  let clock = { base: first, epoch: epoch(), rate: 1 };
  const now = () => clock.base + (epoch() - clock.epoch) * clock.rate / TICK_MS;
  const set = (t) => {
    clock = { base: Math.max(first, Math.min(end, t)), epoch: epoch(), rate: paused ? 0 : speed };
    writeClock(i32, f64, L.CL_PLAY, clock.base, clock.epoch, clock.rate);
    self.postMessage({ state: { speed, paused } });
  };
  // from the start again: the keyframe (or the seed), then every tick
  const restart = () => {
    simPort.postMessage({ key: { tick: first, reason: 0, region: r.region ? r.region.slice() : null } });
    simPort.postMessage({ ticks, fill: true });
  };
  const stepped = () => r.roomStart + dv.getUint32(L.HDR_TICK, true);
  const to = (t) => { if (t < stepped()) restart(); set(t); };
  command = (m) => {
    if (m.pause) { paused = !paused; if (!paused && now() >= end) { to(first); return; } }
    if (m.speed) speed = Math.max(0.25, Math.min(16, speed * m.speed));
    if (m.seek) { to(now() + m.seek * 1000 / TICK_MS); return; }
    if (m.to !== undefined) { to(r.roomStart + m.to); return; }
    set(now());
  };
  restart();
  set(first);
  // it stops at the end
  setInterval(() => { if (!paused && now() >= end) { paused = true; set(end); } }, 100);
}
