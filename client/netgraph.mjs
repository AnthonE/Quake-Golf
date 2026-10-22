// The net graph: what the netcode is doing, as four strips in the HUD's top
// right corner (drawn by client/render.mjs fs_hud), a column every 100 ms for
// the last 9.6 s:
//   IN / OUT  bytes a second down, by kind (bundles, repairs, keyframes and
//             fills, stacked), and up (a line)
//   REPAIRED  the share of ticks heard that needed a repair; LAG, from an input
//             to the confirmed world: the lead and the delay, in ms
//   LEAD      the input lead and the playout delay, in ticks (client/clock.mjs)
//   SYNC      each interval hash sent to the relay (green), and each keyframe:
//             a join (blue), a resync for a hole or a stall (purple), a desync (red)
// The net worker counts the bytes and ticks in shared memory (L.CL_RX_*);
// N or ?net=0 hides it.
import * as L from '../src/layout.mjs';

export const GRAPH_N = 96; // columns, one pixel each
export const GRAPH_PANELS = 4;
export const GRAPH_COL = 55; // the HUD cell the labels start at: 4 px left of the strips
const STEP_MS = 100;
// keyframe reasons (net/wire.mjs SYNC) to the SYNC strip's codes
const KEY_CODE = [2, 3, 3, 4];
const nice = (x) => { const e = 10 ** Math.floor(Math.log10(Math.max(x, 1e-9))); return [1, 2, 5, 10].map((m) => m * e).find((v) => v >= x); };
const kb = (x) => (x >= 10000 ? (x / 1000).toFixed(0) : (x / 1000).toFixed(1));

export class NetGraph {
  constructor(memory) {
    this.u32 = new Uint32Array(memory.buffer);
    this.f32 = new Float32Array(memory.buffer);
    this.cols = [];
    this.at = 0;
    this.prev = null;
    this.seenHashes = 0;
    this.seenKeys = 0;
    this.desyncs = 0;
    this.data = new Float32Array(GRAPH_PANELS * GRAPH_N * 4);
  }

  get(a) { return Atomics.load(this.u32, a >> 2); }

  // A column, once STEP_MS has passed. hashes and keys: the client's lists of
  // interval hashes sent and keyframes restored, as client/main.mjs keeps them.
  sample(now, hashes, keys) {
    if (now - this.at < STEP_MS) return;
    const c = { bundle: this.get(L.CL_RX_BUNDLE), repair: this.get(L.CL_RX_REPAIR), stream: this.get(L.CL_RX_STREAM), up: this.get(L.CL_TX), heard: this.get(L.CL_HEARD), repaired: this.get(L.CL_REPAIRS) };
    if (this.prev) {
      const s = (now - this.at) / 1000;
      const d = (k) => ((c[k] - this.prev[k]) >>> 0) / s;
      let key = 0;
      for (const k of keys.slice(this.seenKeys)) { key = Math.max(key, KEY_CODE[k.reason] || 2); if (k.reason === 3) this.desyncs++; }
      this.cols.push({
        bundle: d('bundle'), repair: d('repair'), stream: d('stream'), up: d('up'),
        heard: (c.heard - this.prev.heard) >>> 0, repaired: (c.repaired - this.prev.repaired) >>> 0,
        lead: this.f32[L.CL_LEAD >> 2], delay: this.f32[L.CL_DELAY >> 2], hash: hashes.length > this.seenHashes ? 1 : 0, key,
      });
      if (this.cols.length > GRAPH_N) this.cols.shift();
    }
    this.seenHashes = hashes.length;
    this.seenKeys = keys.length;
    this.prev = c;
    this.at = now;
  }

  // The strips' values, 0 to 1 of their height (newest on the right), and the
  // labels through put(x, y, text, colour); y is the label's HUD row.
  build(put, C) {
    const cols = this.cols, n = cols.length, data = this.data;
    data.fill(0);
    const sIn = nice(Math.max(1000, ...cols.map((c) => Math.max(c.bundle + c.repair + c.stream, c.up))));
    const sLead = nice(Math.max(16, ...cols.map((c) => Math.max(c.lead, c.delay))));
    const share = (c) => (c.heard ? c.repaired / c.heard : 0);
    const sRep = nice(Math.max(0.05, ...cols.map(share)));
    cols.forEach((c, k) => {
      const col = GRAPH_N - n + k;
      const at = (panel) => 4 * (panel * GRAPH_N + col);
      data.set([c.bundle / sIn, c.repair / sIn, c.stream / sIn, c.up / sIn], at(0));
      data[at(1)] = share(c) / sRep;
      data.set([c.lead / sLead, c.delay / sLead], at(2));
      data.set([c.hash, c.key], at(3));
    });
    const last = cols[n - 1] || { bundle: 0, repair: 0, stream: 0, up: 0, lead: 0, delay: 0 };
    const recent = cols.slice(-20);
    const heard = recent.reduce((a, c) => a + c.heard, 0), repaired = recent.reduce((a, c) => a + c.repaired, 0);
    let x = GRAPH_COL;
    const say = (y, s, c) => { put(x, y, s, c); x += s.length; };
    const row = (y, parts) => { x = GRAPH_COL; for (const [s, c] of parts) say(y, s, c); };
    row(2, [['IN ', C.GREEN], [kb(last.bundle + last.repair + last.stream), C.WHITE], [' OUT ', C.CYAN], [kb(last.up), C.WHITE], [` KB/S <${kb(sIn)}`, C.GREY]]);
    row(6, [['REPAIRED ', C.ORANGE], [`${heard ? (100 * repaired / heard).toFixed(1) : '0.0'}%`, C.WHITE], ['  LAG ', C.GREY], [`${Math.round((last.lead + last.delay) * 8)}MS`, C.WHITE]]);
    row(10, [['LEAD ', C.YELLOW], [last.lead.toFixed(1), C.WHITE], [' DELAY ', C.CYAN], [last.delay.toFixed(1), C.WHITE], [` <${sLead}`, C.GREY]]);
    row(14, [['SYNC ', C.GREEN], [`${this.seenHashes} HASHES `, C.WHITE], [`${this.desyncs} DESYNC`, this.desyncs ? C.RED : C.GREY]]);
    return data;
  }
}
