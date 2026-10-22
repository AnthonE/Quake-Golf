import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generate } from '../tools/genlog.mjs';
import { newSim, smallLog, hashes } from './helpers.mjs';
import { NSLICE, VX, FLAGS, F_AWAKE, INTERVAL_HASH, INTERVAL_TICK, SNAP0, REGION, REGION_SIZE } from '../src/layout.mjs';

const TICKS = 1600;

test('the log generator writes the same bytes every time', () => {
  const a = createHash('sha256').update(generate({ ticks: 5000 })).digest('hex');
  const b = createHash('sha256').update(generate({ ticks: 5000 })).digest('hex');
  assert.equal(a, b);
});

test('terrain is the same bytes from the same seed', async () => {
  const [a, b] = [await newSim(), await newSim()];
  a.init(7);
  b.init(7);
  assert.equal(a.x.terrain_hash(), b.x.terrain_hash());
  b.init(8);
  assert.notEqual(a.x.terrain_hash(), b.x.terrain_hash());
});

test('two runs of one log agree on every tick', async () => {
  const log = smallLog(TICKS);
  const [a, b] = [await newSim(), await newSim()];
  a.init(log.courseSeed);
  b.init(log.courseSeed);
  const ha = await hashes(a, log, 0, TICKS);
  const hb = await hashes(b, log, 0, TICKS);
  assert.deepEqual(ha, hb);
  assert.ok(a.nballs > 1000, `only ${a.nballs} balls`);
});

test('random splits in shuffled order equal one thread', async () => {
  const log = smallLog(TICKS);
  const [a, b] = [await newSim(), await newSim()];
  a.init(log.courseSeed);
  b.init(log.courseSeed);
  let s = 99;
  const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
  const split = (total) => {
    const cuts = [...new Set([0, total, r() % (total + 1), r() % (total + 1), r() % (total + 1)])].sort((x, y) => x - y);
    const ranges = cuts.slice(1).map((c, i) => [cuts[i], c]);
    return ranges.sort(() => (r() & 1) - 0.5);
  };
  const ha = await hashes(a, log, 0, TICKS);
  const hb = await hashes(b, log, 0, TICKS, (sim) => sim.stepSplit(split));
  assert.deepEqual(ha, hb);
});

test('a keyframe restored into a fresh sim continues identically', async () => {
  const log = smallLog(TICKS);
  const a = await newSim();
  a.init(log.courseSeed);
  const K = 8 * NSLICE;
  await hashes(a, log, 0, K);
  const key = a.regionCopy();
  const tail = await hashes(a, log, K, TICKS);
  const intervalA = a.x.hash_region();

  const b = await newSim();
  b.init(log.courseSeed); // terrain from the seed, never from the keyframe
  b.setRegion(key);
  const tailB = await hashes(b, log, K, TICKS);
  assert.deepEqual(tailB, tail);
  assert.equal(b.x.hash_region(), intervalA);
});

// The production interval hashes from tick `from` to `to`, closing every 128 ticks.
async function intervals(sim, log, from, to) {
  const out = [];
  const view = new BigUint64Array(sim.memory.buffer, INTERVAL_HASH, 1);
  for (let t = from; t < to; t++) {
    sim.feed(log, t);
    sim.x.step();
    if (sim.i32[INTERVAL_TICK >> 2] === t + 1) out.push(view[0]);
  }
  return out;
}

test('after a keyframe, the production interval hashes match too (late join and resync)', async () => {
  const log = smallLog(TICKS);
  const K = 8 * NSLICE;
  const a = await newSim();
  a.init(log.courseSeed);
  await intervals(a, log, 0, K);
  const key = a.regionCopy();
  a.x.snapshot(0);
  const want = await intervals(a, log, K, TICKS);
  assert.ok(want.length >= 3);

  const joiner = await newSim();
  joiner.init(log.courseSeed);
  joiner.setRegion(key);
  assert.deepEqual(await intervals(joiner, log, K, TICKS), want, 'late join');

  // twice: feed() has to seek back to the keyframe's tick each time
  for (const n of [1, 2]) {
    a.x.restore(0);
    assert.deepEqual(await intervals(a, log, K, TICKS), want, `resync in place, ${n}`);
  }

  const fresh = await newSim();
  fresh.init(log.courseSeed);
  fresh.u8.set(key, SNAP0);
  fresh.x.restore(0);
  assert.deepEqual(await intervals(fresh, log, K, TICKS), want, 'restore() into a fresh sim');
  assert.equal(REGION_SIZE, key.length);
  assert.ok(REGION > 0);
});

test('a NaN in state traps in debug builds and names the field', async () => {
  const log = smallLog(400);
  const sim = await newSim(true);
  sim.init(log.courseSeed);
  await hashes(sim, log, 0, 100);
  const f32 = new Float32Array(sim.memory.buffer);
  sim.u8[FLAGS] |= F_AWAKE;
  f32[VX >> 2] = NaN;
  assert.throws(() => { sim.feed(log, 100); sim.x.step(); }, WebAssembly.RuntimeError);
  const err = sim.error();
  assert.ok(err.code >= 1 && err.code <= 6, `error code ${err.code}`);
});

test('debug builds refuse a keyframe off an interval boundary', async () => {
  const sim = await newSim(true);
  sim.init(7);
  sim.x.step();
  assert.throws(() => sim.x.snapshot(0), WebAssembly.RuntimeError);
  assert.equal(sim.error().code, 90);
});

test('the ball grid kept from tick to tick is the one the region gives; regrid rebuilds it after an outside write', async () => {
  // Two sims at the same tick, with as many balls in other places: b takes
  // a's region, as a desync heal does. The debug build checks the whole grid every tick.
  const T = 900;
  const logA = smallLog(TICKS), logB = smallLog(TICKS, { blastR: 8 }); // the same spawns, other blasts
  const a = await newSim(true), b = await newSim(true), c = await newSim(true);
  for (const s of [a, b, c]) s.init(logA.courseSeed);
  await hashes(a, logA, 0, T);
  await hashes(b, logB, 0, T);
  await hashes(c, logB, 0, T);
  const key = a.regionCopy(), n = a.nballs;
  const want = await hashes(a, logA, T, T + 300);
  b.setRegion(key); // calls regrid
  assert.deepEqual(await hashes(b, logA, T, T + 300), want);

  // the same write without regrid: same tick, same ball count, a stale grid
  c.u8.set(key, REGION);
  assert.equal(c.nballs, n);
  assert.throws(() => { c.feed(logA, T); c.x.step(); }, WebAssembly.RuntimeError);
  assert.equal(c.error().code, 93); // a ball not in the bucket its position gives
});
