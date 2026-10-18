import test from 'node:test';
import assert from 'node:assert/strict';
import { wasmBytes } from './helpers.mjs';
import { Brain, encode, decode, weights, features, MAX_MUTATIONS, NW, TWEET } from '../client/brain.mjs';
import { Pool, breed } from '../tools/zoo.mjs';
import { Room } from '../tools/agent.mjs';
import { View } from '../src/view.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import * as L from '../src/layout.mjs';

const G = { base: 0xc0ffee, muts: [1, 0x4001, 0x8002, 0xc003, 0xffff] };

test('a genome is a few characters, and the longest still fits in a tweet', () => {
  assert.equal(encode(G), 'qg2:7v_AAAEAAUACgAPA__8');
  assert.deepEqual(decode(encode(G)), G);
  assert.deepEqual(decode(encode({ base: 7, muts: [] })), { base: 7, muts: [] });
  const full = encode({ base: 0xffffffff, muts: Array(MAX_MUTATIONS).fill(0xffff) });
  assert.ok(full.length <= TWEET, `${full.length} chars`);
  assert.ok(encode({ base: 0, muts: Array(MAX_MUTATIONS + 1).fill(0) }).length > TWEET, 'and one more does not');
  assert.throws(() => decode('hello'), /qg2:/);
  assert.throws(() => decode('qg1:AAAAAA'), /f64 brain/);
  assert.throws(() => decode('qg2:AAAAAAA'), /4 \+ 2n bytes, this one is 5/);
});

test('the recipe rebuilds the same weights bit for bit', () => {
  const w = weights(G);
  assert.equal(w.length, NW);
  let h = 0x811c9dc5;
  for (const x of new Uint8Array(w.buffer)) { h ^= x; h = Math.imul(h, 0x01000193) >>> 0; }
  // f32 + - * / only: V8, any browser and the Pentium III's SSE1 get this hash
  assert.equal(h.toString(16), 'ffac99fb');
  assert.deepEqual(weights(decode(encode(G))), w);
  assert.notDeepEqual(weights({ ...G, muts: G.muts.slice(0, 4) }), w, 'each mutation moves the weights');
});

test('the brain answers inside the bot\'s range of shots', async () => {
  const room = await Room.create({ bytes: wasmBytes(), bots: 0 });
  room.act(0, 'wait 3.1');
  const s = room.see(0);
  const f = features(room.view, s.ball.pos, s.cup.pos);
  assert.equal(f.length, 14);
  assert.equal(f[2] + f[3] + f[4] + f[5], 1, 'one lie');
  for (let b = 0; b < 50; b++) {
    const { dh, turn } = new Brain({ base: b, muts: [] }).decide(f);
    assert.ok(dh >= 0.3 && dh <= 4.8, `dh ${dh}`);
    assert.ok(Math.abs(turn) <= 6 * Math.PI / 180 + 1e-12, `turn ${turn}`);
  }
});

test('a hole by shots alone is the same every time', async () => {
  const pool = new Pool(wasmBytes(), 1);
  try {
    const [a, b] = await pool.run([encode(G), encode(G)], [7, 1001]);
    assert.deepEqual(a, b);
    const [rule] = await pool.run(['rule'], [7]);
    assert.ok(rule[0].score >= 1 && rule[0].score <= 12);
  } finally {
    pool.close();
  }
});

test('the zoo keeps a child only if it wins twice', async () => {
  const pool = new Pool(wasmBytes(), 2);
  const log = [];
  try {
    const genome = await breed({ pool, gens: 2, kids: 3, courses: 2, confirm: 2, bases: 3, seed: 5, log: (e) => log.push(e) });
    assert.match(genome, /^qg2:/);
    assert.equal(log[0].gen, -1);
    for (const e of log.slice(1)) {
      if (e.took) assert.ok(e.child <= e.parent + 3 && e.again[1] < e.again[0], 'took it only after winning again');
      else assert.ok(!e.again || e.again[1] >= e.again[0]);
    }
    assert.equal(decode(genome).muts.length, log.filter((e) => e.took).length);
  } finally {
    pool.close();
  }
});

test('a neural golfer plays a real hole on the bot\'s legs, and the game replays', async () => {
  const bytes = wasmBytes();
  const room = await Room.create({ bytes, agents: 0, bots: 0, genomes: [encode(G)] });
  const v = new View(room.sim.memory.buffer);
  while (room.t < 6000 && v.player(0).strokes < 2) room.tick();
  assert.ok(v.player(0).strokes >= 2, 'it walked to its ball and shot twice');
  assert.equal(v.hole().state, L.H_PLAY);
  const tr = decodeTrace((await replay({ bytes, log: parseLog(room.log()), ticks: room.t, tag: 'brain' })).trace);
  assert.equal(tr.tickHashes[room.t - 1], room.hash);
});

test('a real hole is scored by the game\'s own scoreboard', async () => {
  const { realHole } = await import('../tools/zoo.mjs');
  const r = await realHole(wasmBytes(), encode(G), 7);
  assert.ok(r.ticks < 40000, 'the hole ended');
  assert.ok(r.score >= 1 && r.score <= 40, `score ${r.score}`);
  if (!r.sunk) assert.ok(r.score >= 2, 'not in the cup costs 2');
});
