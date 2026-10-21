import test from 'node:test';
import assert from 'node:assert/strict';
import { wasmBytes } from './helpers.mjs';
import { newMemory, instantiate, Sim, parseLog } from '../harness/core.mjs';
import { playHoles } from '../tools/gengame.mjs';
import { Referee } from '../net/referee.mjs';
import { feedTick, recordLog } from '../net/inbox.mjs';
import * as W from '../net/wire.mjs';
import * as L from '../src/layout.mjs';

// A bot match, as the relay would record it: every active slot's word every tick.
async function match() {
  const { log } = await playHoles({ bytes: wasmBytes(), courseSeed: 9, bots: 2, ticks: 3000, delay: 6, joins: [0, 700] });
  const parsed = parseLog(log);
  const ticks = [];
  const live = new Map();
  for (let k = 0, t = 0; t < parsed.ticks; t++) {
    const ev = [];
    for (; k < parsed.count && parsed.tickOf(k) === t; k++) {
      const o = 32 + k * L.REC;
      const kind = log[o + 4];
      const slot = log[o + 5];
      if (kind === L.EV_JOIN) { ev.push({ slot, kind: W.EV_JOIN }); live.set(slot, 0); }
      if (kind === L.EV_INPUT) live.set(slot, new DataView(log.buffer, log.byteOffset + o + 8, 4).getUint32(0, true));
    }
    ticks.push({ ev, w: [...live] });
  }
  return { ticks, seed: parsed.courseSeed, log: parsed };
}

async function client(seed) {
  const memory = newMemory();
  const sim = new Sim(await instantiate(await WebAssembly.compile(wasmBytes()), memory), memory);
  sim.init(seed);
  return sim;
}

function intervals(sim, ticks, from, to) {
  const out = [];
  const dv = new DataView(sim.memory.buffer);
  for (let t = from; t < to; t++) {
    feedTick(sim.u8, dv, ticks[t]);
    sim.x.step();
    if (sim.i32[L.INTERVAL_TICK >> 2] === t + 1) out.push([t + 1, dv.getBigUint64(L.INTERVAL_HASH, true)]);
  }
  return out;
}

test('the referee hashes a match as its clients do; a joiner from its keyframe agrees', async () => {
  const { ticks, seed, log } = await match();
  const ref = await Referee.create(wasmBytes());
  ref.reset(seed);
  const first = await ref.key();
  assert.equal(first.tick, 0, 'sim tick 0 is a keyframe');
  const refIntervals = [];
  let key = null;
  for (const [t, d] of ticks.entries()) {
    const iv = ref.step(d);
    if (iv) { refIntervals.push([iv.tick, iv.hash]); assert.equal(iv.digests.length, 1024); }
    if (t === 1500) key = await ref.key();
  }
  assert.equal(refIntervals.length, Math.floor(ticks.length / L.NSLICE));

  // a client that has played since tick 0
  const a = await client(seed);
  assert.deepEqual(intervals(a, ticks, 0, ticks.length), refIntervals);
  // the same match through the .qgl the relay would write on a desync
  const dump = parseLog(recordLog(ticks.map((d) => W.encodeTick(d.ev, d.w)), seed));
  assert.equal(dump.courseSeed, seed);
  assert.equal(dump.ticks, ticks.length);
  const b = await client(seed);
  const replayed = [];
  const bv = new DataView(b.memory.buffer);
  for (let t = 0; t < dump.ticks; t++) {
    b.feed(dump, t);
    b.x.step();
    if (b.i32[L.INTERVAL_TICK >> 2] === t + 1) replayed.push([t + 1, bv.getBigUint64(L.INTERVAL_HASH, true)]);
  }
  assert.deepEqual(replayed, refIntervals);
  assert.equal(log.courseSeed, seed);

  // a joiner: terrain from the seed, the region from the keyframe, then the ticks since
  assert.equal(key.tick, 1408);
  const j = await client(seed);
  j.u8.set(await W.unpackKey(key.packed), L.REGION);
  j.x.regrid();
  assert.equal(j.tick, key.tick);
  assert.deepEqual(intervals(j, ticks, key.tick, ticks.length), refIntervals.filter(([t]) => t > key.tick));
  assert.ok(key.packed.length < 40000, `keyframe packs to ${key.packed.length} B`);
});

test('shuffling the float arrays is undone exactly', () => {
  const region = new Uint8Array(L.REGION_SIZE);
  for (let i = 0; i < region.length; i++) region[i] = (i * 2654435761) >>> 24;
  const s = W.shuffle(region);
  assert.notDeepEqual(s, region);
  assert.deepEqual(W.shuffle(s, true), region);
});
