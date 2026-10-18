// The replay harness, the same file in Node, Deno and a Chrome worker.
// It feeds a log's events tick by tick, steps the sim (one thread, random
// splits, or n threads), and records a hash of the whole region every tick.

import * as L from '../src/layout.mjs';

export function newMemory() {
  return new WebAssembly.Memory({ initial: L.PAGES, maximum: L.PAGES, shared: true });
}

export async function instantiate(module, memory) {
  const { exports } = await WebAssembly.instantiate(module, { env: { mem: memory } });
  return exports;
}

export function parseLog(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== 'QGEL') throw new Error('not a .qgl log');
  return {
    courseSeed: dv.getUint32(8, true),
    genSeed: dv.getUint32(12, true),
    ticks: dv.getUint32(16, true),
    count: dv.getUint32(20, true),
    tickOf: (k) => dv.getUint32(32 + k * L.REC, true),
    bytes,
  };
}

// Trace (.qgh): 64 B header, then u64 per tick, u64 per interval, 128 u64 slice digests per interval.
export function encodeTrace({ tag, ticks, tickHashes, intervalHashes, sliceDigests, terrainHash, logHash }) {
  const nInt = intervalHashes.length;
  const buf = new Uint8Array(64 + 8 * (ticks + nInt + nInt * L.NSLICE));
  const dv = new DataView(buf.buffer);
  buf.set([0x51, 0x47, 0x48, 0x31], 0); // QGH1
  dv.setUint32(4, ticks, true);
  dv.setUint32(8, nInt, true);
  dv.setBigUint64(16, terrainHash, true);
  dv.setBigUint64(24, logHash, true);
  buf.set(new TextEncoder().encode(tag.slice(0, 32)), 32);
  new BigUint64Array(buf.buffer, 64, ticks).set(tickHashes.subarray(0, ticks));
  new BigUint64Array(buf.buffer, 64 + 8 * ticks, nInt).set(intervalHashes);
  new BigUint64Array(buf.buffer, 64 + 8 * (ticks + nInt), nInt * L.NSLICE).set(sliceDigests);
  return buf;
}

export function decodeTrace(bytes) {
  const buf = new Uint8Array(bytes).buffer;
  const dv = new DataView(buf);
  const ticks = dv.getUint32(4, true);
  const nInt = dv.getUint32(8, true);
  const tag = new TextDecoder().decode(new Uint8Array(buf, 32, 32)).replace(/\0+$/, '');
  return {
    tag, ticks, nInt,
    terrainHash: dv.getBigUint64(16, true),
    logHash: dv.getBigUint64(24, true),
    tickHashes: new BigUint64Array(buf, 64, ticks),
    intervalHashes: new BigUint64Array(buf, 64 + 8 * ticks, nInt),
    sliceDigests: new BigUint64Array(buf, 64 + 8 * (ticks + nInt), nInt * L.NSLICE),
  };
}

// A small PRNG for picking random work splits; it never touches the sim.
function splitter(seed) {
  let s = seed >>> 0 || 1;
  const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
  return (total) => {
    const cuts = new Set([0, total]);
    const k = r() % 6;
    for (let i = 0; i < k && total > 1; i++) cuts.add(r() % total);
    const pts = [...cuts].sort((a, b) => a - b);
    const ranges = [];
    for (let i = 0; i + 1 < pts.length; i++) ranges.push([pts[i], pts[i + 1]]);
    for (let i = ranges.length - 1; i > 0; i--) {
      const j = r() % (i + 1);
      [ranges[i], ranges[j]] = [ranges[j], ranges[i]];
    }
    return ranges;
  };
}

export class Sim {
  constructor(exports, memory) {
    this.x = exports;
    this.memory = memory;
    this.u8 = new Uint8Array(memory.buffer);
    this.i32 = new Int32Array(memory.buffer);
    this.recPtr = 0;
  }

  init(seed) {
    this.x.init(seed);
    this.recPtr = 0;
  }

  get tick() { return Atomics.load(this.i32, L.HDR_TICK >> 2); }
  get nballs() { return Atomics.load(this.i32, L.HDR_NBALLS >> 2); }
  get awake() { return Atomics.load(this.i32, L.JOB_NA >> 2); }

  // Copy this tick's records into the inbox. Logs are sorted by tick.
  feed(log, t) {
    while (this.recPtr < log.count && log.tickOf(this.recPtr) < t) this.recPtr++;
    let n = 0;
    while (this.recPtr < log.count && log.tickOf(this.recPtr) === t) {
      if (n === L.INBOX_MAX) throw new Error(`more than ${L.INBOX_MAX} events at tick ${t}`);
      const src = 32 + this.recPtr * L.REC;
      this.u8.set(log.bytes.subarray(src, src + L.REC), L.INBOX_REC + n * L.REC);
      n++;
      this.recPtr++;
    }
    Atomics.store(this.i32, L.INBOX >> 2, n);
  }

  // Every phase over random ranges in shuffled order; must equal step().
  stepSplit(split) {
    this.x.tick_begin();
    for (const [lo, hi] of split(this.i32[L.JOB_NA >> 2])) this.x.contacts(lo, hi);
    for (const [lo, hi] of split(this.i32[L.JOB_NB >> 2])) this.x.integrate(lo, hi);
    this.x.tick_end();
  }

  regionCopy() { return this.u8.slice(L.REGION, L.REGION + L.REGION_SIZE); }
  setRegion(bytes) { this.u8.set(bytes, L.REGION); }
  error() {
    return { code: this.i32[L.ERR_CODE >> 2], index: this.i32[L.ERR_INDEX >> 2], tick: this.i32[L.ERR_TICK >> 2] };
  }
}

// Replays `ticks` ticks of `log`. `threads` > 1 needs `startWorkers({ bytes, memory, n })` -> { stop() }.
export async function replay({ bytes, log, ticks, threads = 1, salt = 0, tag = 'run', startWorkers, onProgress }) {
  const module = await WebAssembly.compile(bytes);
  const memory = newMemory();
  const sim = new Sim(await instantiate(module, memory), memory);
  sim.init(log.courseSeed);
  const terrainHash = BigInt.asUintN(64, sim.x.terrain_hash());
  // Hash the log with the module's own XXH64, staged in the (unused in M1) net area.
  let logHash = 0n;
  if (log.bytes.length <= L.PAGES * 65536 - L.NET) {
    sim.u8.set(log.bytes, L.NET);
    logHash = BigInt.asUintN(64, sim.x.xxh64(L.NET, log.bytes.length, 0n));
    sim.u8.fill(0, L.NET, L.NET + log.bytes.length);
  }
  ticks = Math.min(ticks, log.ticks);
  const nInt = Math.floor(ticks / L.NSLICE);
  const tickHashes = new BigUint64Array(ticks);
  const intervalHashes = new BigUint64Array(nInt);
  const sliceDigests = new BigUint64Array(nInt * L.NSLICE);
  const digests = new BigUint64Array(memory.buffer, L.DIGESTS, L.NSLICE);
  const intervalHash = new BigUint64Array(memory.buffer, L.INTERVAL_HASH, 1);
  const split = salt ? splitter(salt) : null;
  const workers = threads > 1 ? await startWorkers({ bytes, memory, n: threads }) : null;
  const t0 = performance.now();
  let awakeSum = 0;
  try {
    for (let t = 0; t < ticks; t++) {
      sim.feed(log, t);
      if (workers) sim.x.step_mt(threads);
      else if (split) sim.stepSplit(split);
      else sim.x.step();
      awakeSum += sim.awake;
      tickHashes[t] = BigInt.asUintN(64, sim.x.hash_region());
      if ((t + 1) % L.NSLICE === 0) {
        const k = (t + 1) / L.NSLICE - 1;
        if (k < nInt) {
          intervalHashes[k] = intervalHash[0];
          sliceDigests.set(digests, k * L.NSLICE);
        }
      }
      if (onProgress && (t + 1) % 10000 === 0) onProgress(t + 1, sim);
    }
  } finally {
    if (workers) {
      Atomics.store(sim.i32, L.JOB_QUIT >> 2, 1);
      sim.x.barrier(threads);
      await workers.stop();
    }
  }
  const ms = performance.now() - t0;
  return {
    trace: encodeTrace({ tag, ticks, tickHashes, intervalHashes, sliceDigests, terrainHash, logHash }),
    stats: { ticks, ms, msPerTick: ms / ticks, nballs: sim.nballs, meanAwake: awakeSum / ticks, terrainHash: terrainHash.toString(16) },
  };
}
