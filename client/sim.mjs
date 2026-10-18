// The sim worker: steps the confirmed world. It inits from the room's seed,
// restores the join's keyframe, then steps each closed tick in order as soon
// as the playout clock passes it, as fast as it can while it catches up.
// Lost ticks come back as repairs on their own; a hole still open 56 ticks
// past the newest tick, or a world more than 2 s behind the playout clock,
// asks the relay for a keyframe instead. Each closed interval's hash goes to
// the relay, and its slice digests are kept, so a desync names the slice.
// The world is never rolled back: a keyframe replaces it.
import * as L from '../src/layout.mjs';
import * as W from '../net/wire.mjs';
import { feedTick } from '../net/inbox.mjs';
import { readClock } from './clock.mjs';

const epoch = () => performance.timeOrigin + performance.now();
const HOLE_TICKS = 56; // a repair can come until a hole is 64 ticks old
const BEHIND_TICKS = 250;

self.onmessage = (e) => { if (e.data.module) run(e.data).catch((err) => self.postMessage({ error: String(err?.stack || err) })); };

async function run({ module, memory, netPort }) {
  const { exports: x } = await WebAssembly.instantiate(module, { env: { mem: memory } });
  const i32 = new Int32Array(memory.buffer);
  const u8 = new Uint8Array(memory.buffer);
  const dv = new DataView(memory.buffer);
  const f64 = new Float64Array(memory.buffer);
  const set = (a, v) => Atomics.store(i32, a >> 2, v);
  // CL_SEQ is odd while the world changes, so readers of a copy retry
  const changing = (f) => { Atomics.add(i32, L.CL_SEQ >> 2, 1); try { f(); } finally { Atomics.add(i32, L.CL_SEQ >> 2, 1); } };
  const store = new Map(); // server tick -> { ev, w }
  let welcome = null;
  let started = false; // the join's keyframe is in
  let newest = -1;
  let keys = 0;
  let syncAt = -1e9; // the last keyframe asked for
  let filling = false; // a keyframe is in and its fill isn't yet
  const digests = new Map(); // interval (sim tick) -> its 128 slice digests, the newest few
  const at = () => welcome.roomStart + dv.getUint32(L.HDR_TICK, true); // the next server tick to step
  netPort.onmessage = (e) => {
    const m = e.data;
    if (m.welcome) {
      welcome = m.welcome;
      x.init(welcome.seed);
      set(L.CL_STATE, 1);
      self.postMessage({ ready: true, seed: welcome.seed });
    }
    if (m.key) restore(m.key);
    if (m.ticks) {
      for (const t of m.ticks) {
        if (t.t >= at() && !store.has(t.t)) store.set(t.t, t);
        newest = Math.max(newest, t.t);
      }
      if (m.fill) {
        filling = false;
        self.postMessage({ filled: { ticks: m.ticks.length, from: m.ticks[0]?.t ?? at() } });
      }
    }
  };
  // the debug flip: one bit of the confirmed world, as a cosmic ray would
  self.onmessage = (e) => { if (e.data.flip) { const { addr, bit } = e.data.flip; changing(() => { u8[addr] ^= 1 << bit; }); } };

  // A keyframe: the region at server tick `tick` (or the room's start), then
  // the fill from there. A desync's keyframe carries the referee's digests of
  // the interval that differed; ours name the first slice that differs.
  function restore({ tick, reason, region, interval, digests: theirs }) {
    changing(() => {
      if (region) u8.set(region, L.REGION);
      else x.init(welcome.seed);
    });
    if (at() !== tick) self.postMessage({ error: `keyframe for tick ${tick} restored tick ${at()}` });
    for (const t of store.keys()) if (t < tick) store.delete(t);
    keys++;
    set(L.CL_KEYS, keys);
    filling = true;
    let named = null;
    if (reason === W.SYNC.DESYNC && theirs) {
      const mine = digests.get(interval);
      if (mine) for (let s = 0; s < L.NSLICE && !named; s++) {
        if (!mine.subarray(8 * s, 8 * s + 8).every((b, i) => b === theirs[8 * s + i])) named = { slice: s, field: L.describeSlice(s) };
      }
      self.postMessage({ desync: { interval, ...(named || { slice: -1, field: mine ? 'none differ' : 'not kept' }) } });
    }
    self.postMessage({ key: { reason, tick, simTick: tick - welcome.roomStart, raw: !!region } });
    if (!started) { started = true; loop(); }
  }

  const hashes = []; // interval hashes closed since the last post, for the runs
  function loop() {
    const now = epoch();
    const play = readClock(i32, f64, L.CL_PLAY, now);
    const target = Math.floor(play) - welcome.roomStart;
    let k = dv.getUint32(L.HDR_TICK, true);
    const t1 = performance.now();
    while (k < target && performance.now() - t1 < 12) {
      const d = store.get(welcome.roomStart + k);
      if (!d) break;
      store.delete(welcome.roomStart + k);
      changing(() => { feedTick(u8, dv, d); x.step(); });
      k++;
      if (i32[L.INTERVAL_TICK >> 2] === k) {
        const hash = dv.getBigUint64(L.INTERVAL_HASH, true).toString(16);
        hashes.push([k, hash]);
        digests.set(k, u8.slice(L.DIGESTS, L.DIGESTS + 8 * L.NSLICE));
        for (const t of digests.keys()) if (t < k - 8 * L.NSLICE) digests.delete(t);
        netPort.postMessage({ report: { interval: k, epoch: keys, hash } });
      }
    }
    if (hashes.length) { self.postMessage({ hashes }); hashes.length = 0; }
    // A hole repairs couldn't fill, or a world too far behind: start again from a keyframe.
    const next = welcome.roomStart + k;
    if (!filling && now - syncAt > 1500) {
      let why = -1;
      if (!store.has(next) && newest - next >= HOLE_TICKS) why = W.SYNC.HOLE;
      else if (target - k > BEHIND_TICKS) why = W.SYNC.BEHIND;
      if (why >= 0) {
        netPort.postMessage({ sync: [why, next] });
        syncAt = now;
        let after = 0; // how many ticks past the hole are already here
        for (let t = next + 1; t <= newest; t++) if (store.has(t)) after++;
        self.postMessage({ sync: why, next, newest, after, behind: target - k });
      }
    }
    set(L.CL_QUEUED, store.size);
    set(L.CL_STATE, target - k > 16 ? 1 : 2);
    setTimeout(loop, k < target && store.has(welcome.roomStart + k) ? 0 : 1);
  }
}
