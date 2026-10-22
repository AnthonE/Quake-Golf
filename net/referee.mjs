// The referee: the room's confirmed world on the relay, stepped by the same
// game.wasm on every closed tick, off the clock's isolate (net/referee-worker.mjs
// runs it in a Worker). It is the source of truth for the interval hashes the
// clients report, and for keyframes: the region right after each interval
// closes, kept in the sim's two snapshot slots and packed only when asked for.
import * as L from '../src/layout.mjs';
import * as W from './wire.mjs';
import { feedTick } from './inbox.mjs';

export class Referee {
  static async create(bytes) {
    const memory = new WebAssembly.Memory({ initial: L.PAGES, maximum: L.PAGES, shared: true });
    const { exports } = await WebAssembly.instantiate(await WebAssembly.compile(bytes), { env: { mem: memory } });
    return new Referee(exports, memory);
  }

  constructor(x, memory) {
    this.x = x;
    this.u8 = new Uint8Array(memory.buffer);
    this.dv = new DataView(memory.buffer);
    this.i32 = new Int32Array(memory.buffer);
    this.keyTick = [-1, -1]; // sim tick in each snapshot slot
    this.newest = 0; // the slot holding the newest keyframe
    this.packed = new Map(); // sim tick -> packed keyframe, the newest few
  }

  get tick() { return this.dv.getUint32(L.HDR_TICK, true); }

  // A new room on `seed`: its sim tick 0 is the first keyframe. With a region
  // (an edge relay's, from the keyframe it began watching at), from there instead.
  reset(seed, region = null) {
    this.x.init(seed);
    if (region) { this.u8.set(region, L.REGION); this.x.regrid(); }
    this.packed.clear();
    this.keyTick = [-1, -1];
    this.keep();
  }

  keep() {
    this.newest ^= 1;
    this.x.snapshot(this.newest);
    this.keyTick[this.newest] = this.tick;
  }

  // One closed tick, { ev, w } as the inbox takes it. Returns the interval it
  // closed, if it closed one: { tick, hash, digests }, digests the 128 u64 slice hashes.
  step(d) {
    feedTick(this.u8, this.dv, d);
    this.x.step();
    const t = this.tick;
    if (this.i32[L.INTERVAL_TICK >> 2] !== t) return null;
    this.keep();
    return { tick: t, hash: this.dv.getBigUint64(L.INTERVAL_HASH, true), digests: this.u8.slice(L.DIGESTS, L.DIGESTS + 8 * L.NSLICE) };
  }

  // The newest keyframe: { tick (sim), raw, packed }, packed once and cached.
  async key() {
    const k = this.newest;
    const tick = this.keyTick[k];
    if (!this.packed.has(tick)) {
      const at = L.SNAP0 + k * (L.SNAP1 - L.SNAP0);
      const packing = W.packKey(this.u8.slice(at, at + L.REGION_SIZE));
      this.packed.set(tick, packing);
      for (const t of this.packed.keys()) if (t < tick - 4 * L.NSLICE) this.packed.delete(t);
    }
    return { tick, raw: L.REGION_SIZE, packed: await this.packed.get(tick) };
  }
}
