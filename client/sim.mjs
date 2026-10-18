// The sim worker: steps the confirmed world. It inits from the room's seed,
// then steps each closed tick in order as soon as the playout clock passes it,
// as fast as it can while it catches up on a joiner's history. A tick that
// hasn't come while much later ones have is a hole: it asks the net worker
// to fill it from the relay's record. The world is never rolled back (and in M2
// nothing is predicted).
import * as L from '../src/layout.mjs';
import * as W from '../net/wire.mjs';

const epoch = () => performance.timeOrigin + performance.now();
const KIND = { [W.EV_JOIN]: L.EV_JOIN, [W.EV_LEAVE]: L.EV_LEAVE };

self.onmessage = (e) => { if (e.data.module) run(e.data).catch((err) => self.postMessage({ error: String(err?.stack || err) })); };

async function run({ module, memory, netPort }) {
  const { exports: x } = await WebAssembly.instantiate(module, { env: { mem: memory } });
  const i32 = new Int32Array(memory.buffer);
  const u8 = new Uint8Array(memory.buffer);
  const dv = new DataView(memory.buffer);
  const f64 = new Float64Array(memory.buffer);
  const set = (a, v) => Atomics.store(i32, a >> 2, v);
  const store = new Map(); // server tick -> { ev, w }
  let welcome = null;
  let newest = -1;
  const asked = new Map(); // first tick of a run asked for -> when
  let fills = 0; // fill requests: the history, then one per hole
  netPort.onmessage = (e) => {
    if (e.data.welcome) {
      welcome = e.data.welcome;
      x.init(welcome.seed);
      set(L.CL_STATE, 1);
      // the room's history, then live bundles take over
      netPort.postMessage({ need: [welcome.roomStart, welcome.serverTick] });
      asked.set(welcome.roomStart, epoch() + (welcome.serverTick - welcome.roomStart) * 0.05);
      set(L.CL_FILLS, ++fills);
      self.postMessage({ ready: true, seed: welcome.seed });
      loop();
    }
    if (e.data.ticks) {
      for (const t of e.data.ticks) {
        if (t.t >= welcome.roomStart + dv.getUint32(L.HDR_TICK, true) && !store.has(t.t)) store.set(t.t, t);
        newest = Math.max(newest, t.t);
      }
    }
  };

  // The tick's records: joins and leaves first, then every word it carries.
  const feed = (d) => {
    let n = 0;
    const put = (kind, slot, word) => {
      const o = L.INBOX_REC + n++ * L.REC;
      u8.fill(0, o, o + L.REC);
      u8[o + 4] = kind;
      u8[o + 5] = slot;
      dv.setUint32(o + 8, word >>> 0, true);
    };
    for (const e of d.ev) if (KIND[e.kind]) put(KIND[e.kind], e.slot, 0);
    if (d.w instanceof Uint32Array) for (let p = 0; p < d.w.length; p++) put(L.EV_INPUT, p, d.w[p]);
    else for (const [p, w] of d.w) put(L.EV_INPUT, p, w);
    i32[L.INBOX >> 2] = n;
  };

  const hashes = []; // interval hashes closed since the last post, for the M2 run
  function loop() {
    const now = epoch();
    const play = f64[L.CL_PLAY >> 3] + (now - f64[(L.CL_PLAY >> 3) + 1]) / W.TICK_MS;
    const target = Math.floor(play) - welcome.roomStart;
    let k = dv.getUint32(L.HDR_TICK, true);
    const t1 = performance.now();
    Atomics.add(i32, L.CL_SEQ >> 2, 1);
    while (k < target && performance.now() - t1 < 12) {
      const d = store.get(welcome.roomStart + k);
      if (!d) break;
      store.delete(welcome.roomStart + k);
      feed(d);
      x.step();
      k++;
      if (i32[L.INTERVAL_TICK >> 2] === k) hashes.push([k, BigInt.asUintN(64, new BigInt64Array(memory.buffer, L.INTERVAL_HASH, 1)[0]).toString(16)]);
    }
    if (hashes.length) { self.postMessage({ hashes }); hashes.length = 0; }
    Atomics.add(i32, L.CL_SEQ >> 2, 1);
    // Holes: a tick six older than the newest one here has missed every bundle
    // that carried it (four deep, plus room for reordering). Ask for each run
    // of them at once, and again if the fill hasn't come (longer for big runs).
    for (let t = welcome.roomStart + k; t < newest - 6;) {
      if (store.has(t)) { t++; continue; }
      let e = t;
      while (e < newest - 6 && !store.has(e)) e++;
      if (!(now - (asked.get(t) ?? -1e9) < 300 + (e - t) * 0.05)) {
        netPort.postMessage({ need: [t, e] });
        asked.set(t, now);
        set(L.CL_FILLS, ++fills);
      }
      t = e;
    }
    for (const t of asked.keys()) if (t < welcome.roomStart + k) asked.delete(t);
    set(L.CL_QUEUED, store.size);
    set(L.CL_STATE, target - k > 16 ? 1 : 2);
    setTimeout(loop, k < target && store.has(welcome.roomStart + k) ? 0 : 1);
  }
}
