import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty, partyBytes, wasmBytes, arenaBytes, bumperBytes, fireplaceBytes, scriptedParty, predicted } from './helpers.mjs';
import { View, partyWord, hexAt, hexCentre, seed, hash32, PLAT_Y, B_RAD } from '../src/party-view.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { expandMacros } from '../tools/asm.mjs';
import { makeMacros } from '../src/macros.mjs';
import { playParty, partySeed } from '../tools/genparty.mjs';
import { MG } from '../client/mg/index.mjs';
import * as L from '../src/layout.mjs';
import * as MC from '../src/mg/thinice.mjs'; // TI_*: the minigame's own constants

const TURN = 16384;
const THIN = L.MG_THINICE + 1;

// A room of n balls on the debug build (a NaN traps), the minigame forced
// (null: the rotation's), stepped into play unless asked not to.
async function room({ seed: s = 7, n = 2, force = THIN, play = true } = {}) {
  const sim = await newParty(true);
  sim.init(s);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  if (force !== null) dv.setUint32(L.PG_FORCE, force, true);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  while (play && v.hole().state !== L.H_PLAY) step();
  return { sim, v, dv, step };
}
const rec = (p) => L.PLAYERS + p * L.PSIZE;
// Ball p under the lowest floor: out (or down) at the end of the next tick.
const sink = (g, p) => g.dv.setFloat32(rec(p) + L.P_PY, g.v.party().floor - L.OUT_DEPTH - 1, true);
// Ball p in the air just under it: going out (PF_FALL) from the next tick, out some 0.9 s later.
const drop = (g, p) => { g.dv.setFloat32(rec(p) + L.P_PY, g.v.party().floor - 1.01, true); g.dv.setUint8(rec(p) + L.P_FL, L.PF_LIVE); };
// Whatever state the room is in ends on the next tick.
const hurry = (g) => g.dv.setUint32(L.HDR_UNTIL, g.v.tick, true);
const fxs = (v, kind) => { const out = []; for (let k = 0; k < v.fxCount(); k++) { const f = v.fx(k); if (f.kind === kind) out.push(f); } return out; };

test('party is its own sim: another wasm on the same engine, every other build its own bytes', async () => {
  const s = await newParty();
  for (const other of [wasmBytes(), arenaBytes(), bumperBytes(), fireplaceBytes()]) assert.notDeepEqual(partyBytes(), other);
  for (const name of ['init', 'step', 'step_mt', 'worker_run', 'predict', 'snapshot', 'restore', 'regrid', 'hash_region']) assert.equal(typeof s.x[name], 'function', name);
  s.init(7);
  const v = new View(s.memory.buffer);
  const g = v.party();
  assert.equal(g.state, L.H_IDLE);
  assert.deepEqual([g.kind, g.len, g.floor, g.size, g.cx, g.acc, g.hop, g.respawn, g.flags, g.force], [L.PK_OUT, L.ROUND_TICKS, PLAT_Y, 20, L.B_CX, 1, 6, 250, L.PGF_BUMPS, 0]);
  assert.deepEqual(g.prev, [255, 255], 'nothing played yet');
  assert.equal(g.winner, 255);
});

test('the layout: the header between golf\'s and Fireplace\'s, the state between the projectiles and Fireplace\'s, the minigames in order', () => {
  assert.equal(L.PG_GAME, L.HDR_LIVE + 4);
  assert.equal(L.PG_H + L.PG_H_SIZE, L.FP_GAME);
  assert.ok(L.PG_H + L.PG_H_SIZE - L.REGION <= L.PRED_COPY, 'the header is in the prediction\'s copy');
  assert.equal(L.PG_S, L.PROJ + L.NPROJ * L.JSIZE);
  assert.equal(L.PG_S + L.PG_S_SIZE, L.FP);
  assert.equal(L.PG_BIG + L.PG_BIG_SIZE, L.REGION + L.REGION_SIZE);
  assert.ok(L.PG_SCORE >= L.B_BUMPS + 2 && L.PG_M + 4 <= L.PSIZE);
  assert.equal(L.MINIGAMES.length, L.NMG);
  const ids = [L.MG_THINICE, L.MG_COLOR, L.MG_SWEEP, L.MG_LIGHT, L.MG_BOMBS, L.MG_WALL, L.MG_PADS, L.MG_HILL, L.MG_POTATO, L.MG_COINS, L.MG_PAINT, L.MG_RACE, L.MG_CHUTE, L.MG_TAG];
  assert.deepEqual(ids, [...Array(L.NMG).keys()]);
  assert.deepEqual(L.MINIGAMES.map((m) => m.prefix), ['ti', 'cc', 'sw', 'rl', 'bo', 'wl', 'mp', 'kh', 'hp', 'cr', 'pp', 'rc', 'fc', 'tg']);
  assert.equal(MC.TI_FX_CRACK, L.FX_MG + 4 * L.MG_THINICE);
});

test('MG_CONSTS: every minigame\'s constants, none named twice or after a layout name; the layout\'s own names held under V8\'s dictionary line', async () => {
  const seen = new Map();
  for (const m of L.MINIGAMES) {
    for (const [k, v] of Object.entries(await import(`../src/mg/${m.key}.mjs`))) {
      assert.ok(!seen.has(k), `${k} in ${m.key} and ${seen.get(k)}`);
      assert.ok(!(k in L), `${k} in ${m.key} and layout.mjs`);
      assert.deepEqual(L.MG_CONSTS[k], v);
      seen.set(k, m.key);
    }
  }
  assert.equal(Object.keys(L.MG_CONSTS).length, seen.size);
  // past about 1,020 exports V8 keeps a module namespace as a dictionary, and
  // every L.NAME read in the bot host, the relay and a page's frame slows 14 times
  assert.ok(Object.keys(L).length < 800, `layout.mjs exports ${Object.keys(L).length} names`);
});

test('(!mg type hook args...): an if-chain on PG_GAME over every minigame, the last its else', () => {
  const out = expandMacros('(!mg f32 f32 f32 spawn (local.get $i) (i32.const 1024))', makeMacros({ DEBUG: false }));
  assert.equal(out.match(/\(call \$\w+_spawn \(local\.get \$i\) \(i32\.const 1024\)\)/g).length, L.NMG);
  assert.equal(out.match(/\(if \(result f32 f32 f32\)/g).length, L.NMG - 1);
  assert.ok(out.startsWith('(if (result f32 f32 f32) (i32.eq (i32.load (i32.const @PG_GAME)) (i32.const 0)) (then (call $ti_spawn'));
  assert.ok(out.includes(`(else (call $${L.MINIGAMES.at(-1).prefix}_spawn (local.get $i) (i32.const 1024)))`));
  assert.ok(!expandMacros('(!mg none tick)', makeMacros({ DEBUG: false })).includes('result'));
  assert.match(expandMacros('(!mg i32 over)', makeMacros({ DEBUG: false })), /^\(if \(result i32\) .* \(then \(call \$ti_over\)\)/);
});

test('every minigame lays its round out for 1, 8, 64 and 256: each ball on its own spot, held up there once play starts', async () => {
  for (const mg of L.MINIGAMES.keys()) {
    for (const n of [1, 8, 64, 256]) {
      const g = await room({ seed: 3 + n, n, force: mg + 1, play: false });
      const r = g.v.party();
      assert.equal(r.game, mg);
      assert.equal(r.n0, n);
      assert.equal(r.state, L.H_COUNT);
      assert.equal(r.until - r.tick, L.P_COUNT - 1);
      const spots = [];
      for (let p = 0; p < n; p++) {
        const b = g.v.partier(p);
        assert.ok(b.live && b.ground && !b.out && !b.falling, `${L.MINIGAMES[mg].name} ${n}: P${p + 1} placed`);
        assert.deepEqual([b.place, b.score, b.m, b.hitBy, b.item], [0, 0, 0, 255, 0]);
        spots.push(b.pos);
      }
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
        assert.ok(Math.hypot(spots[a][0] - spots[b][0], spots[a][2] - spots[b][2]) > 2 * B_RAD, `${L.MINIGAMES[mg].name} ${n}: P${a + 1} and P${b + 1} apart`);
      }
      hurry(g);
      g.step();
      assert.equal(g.v.hole().state, L.H_PLAY);
      g.step();
      for (let p = 0; p < n; p++) {
        const b = g.v.partier(p);
        assert.ok(b.ground && !b.falling, `${L.MINIGAMES[mg].name} ${n}: P${p + 1} held up`);
        assert.deepEqual(b.pos, spots[p], `${L.MINIGAMES[mg].name} ${n}: P${p + 1} still`);
      }
    }
  }
});

test('the rotation: never one of the last two played, every minigame in time', async () => {
  const g = await room({ seed: 99, n: 2, force: null, play: false });
  const seen = [g.v.party().game];
  assert.deepEqual(g.v.party().prev, [seen[0], 255]);
  for (let k = 0; k < 80; k++) {
    const round = g.v.hole().hole;
    while (g.v.hole().hole === round || g.v.hole().state !== L.H_COUNT) { hurry(g); g.step(); }
    const r = g.v.party();
    seen.push(r.game);
    assert.deepEqual(r.prev, [seen.at(-1), seen.at(-2)]);
  }
  for (let i = 2; i < seen.length; i++) assert.ok(seen[i] !== seen[i - 1] && seen[i] !== seen[i - 2], `round ${i}: ${seen.slice(i - 2, i + 1)}`);
  assert.equal(new Set(seen).size, L.NMG, 'all of them');
});

test('PG_FORCE: from a seed whose top byte is 0xA7, every round that minigame; written by hand, from the next round', async () => {
  const sim = await newParty();
  const v = new View(sim.memory.buffer);
  sim.init(0xa7050000 | 77);
  assert.equal(v.party().force, L.MG_WALL + 1);
  sim.init(0xa6050000);
  assert.equal(v.party().force, 0);
  const g = await room({ seed: (0xa7030000 | 5) >>> 0, n: 2, force: null, play: false });
  for (let k = 0; k < 4; k++) {
    assert.equal(g.v.party().game, L.MG_LIGHT);
    const round = g.v.hole().hole;
    while (g.v.hole().hole === round || g.v.hole().state !== L.H_COUNT) { hurry(g); g.step(); }
  }
  g.dv.setUint32(L.PG_FORCE, L.MG_PAINT + 1, true);
  assert.equal(g.v.party().game, L.MG_LIGHT, 'not this round');
  const round = g.v.hole().hole;
  while (g.v.hole().hole === round || g.v.hole().state !== L.H_COUNT) { hurry(g); g.step(); }
  assert.equal(g.v.party().game, L.MG_PAINT);
});

test('PK_OUT: under the lowest floor is out, everyone out on one tick shares the place, the last ball in wins; points 10 down to 1', async () => {
  const g = await room({ n: 4 });
  // P1 bumped by P4 just before it goes: P4's KO
  g.dv.setUint8(rec(0) + L.B_HITBY, 3);
  g.dv.setUint16(rec(0) + L.B_HITT, 100, true);
  sink(g, 0);
  g.step();
  let b = g.v.partier(0);
  assert.ok(b.out);
  assert.equal(b.place, 4);
  assert.equal(b.rounds, 1);
  assert.equal(b.outAt, g.v.tick - 1);
  assert.equal(g.v.partier(3).kos, 1);
  const [s] = fxs(g.v, L.FX_SINK);
  assert.deepEqual([s.owner, s.shot, s.size], [0, 3, 4]);
  assert.equal(g.v.party().left, 3);
  sink(g, 1);
  sink(g, 2);
  g.step();
  const r = g.v.party();
  assert.equal(r.state, L.H_OVER, 'one left of four');
  assert.equal(r.winner, 3);
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.partier(p).place), [4, 3, 3, 1]);
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.partier(p).pts), [1, 4, 4, 10]);
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.partier(p).wins), [0, 0, 0, 1]);
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.partier(p).rounds), [1, 1, 1, 1]);
  // the result, then the next round: everyone back in, points kept, the round's fields cleared
  assert.equal(r.until - r.tick, L.P_OVER - 1);
  while (g.v.hole().state !== L.H_COUNT) g.step();
  assert.equal(g.v.party().round, 1);
  assert.equal(g.v.party().n0, 4);
  for (let p = 0; p < 4; p++) {
    b = g.v.partier(p);
    assert.ok(!b.out && b.ground);
    assert.deepEqual([b.place, b.score], [0, 0]);
  }
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.partier(p).pts), [1, 4, 4, 10]);
});

test('PK_OUT at the time: everyone still in shares 1st and a win; a ball going out is out first, unless none is in', async () => {
  const g = await room({ n: 4 });
  sink(g, 0);
  g.step();
  hurry(g);
  g.step();
  const r = g.v.party();
  assert.equal(r.state, L.H_OVER);
  assert.equal(r.winner, 255);
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.partier(p).place), [4, 1, 1, 1]);
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.partier(p).pts), [1, 10, 10, 10]);
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.partier(p).wins), [0, 1, 1, 1]);
  // a ball going out (falling, not yet under the depth) is out before the rest are placed
  const f = await room({ seed: 5, n: 3 });
  f.dv.setUint8(rec(1) + L.B_HITBY, 2);
  f.dv.setUint16(rec(1) + L.B_HITT, 100, true);
  drop(f, 1);
  for (let k = 0; k < 40 && !f.v.partier(1).falling; k++) f.step();
  assert.ok(f.v.partier(1).falling && !f.v.partier(1).out, 'going out');
  hurry(f);
  f.step();
  assert.equal(f.v.party().state, L.H_OVER);
  assert.ok(f.v.partier(1).out);
  assert.deepEqual([0, 1, 2].map((p) => f.v.partier(p).place), [1, 3, 1]);
  assert.deepEqual([0, 1, 2].map((p) => f.v.partier(p).pts), [10, 1, 10]);
  assert.deepEqual([0, 1, 2].map((p) => f.v.partier(p).wins), [1, 0, 1]);
  assert.deepEqual([0, 1, 2].map((p) => f.v.partier(p).rounds), [1, 1, 1]);
  assert.equal(f.v.partier(2).kos, 1, 'its KO');
  assert.equal(fxs(f.v, L.FX_SINK).length, 1);
  // of two, the one still in wins alone
  const w = await room({ seed: 6, n: 2 });
  drop(w, 0);
  for (let k = 0; k < 40 && !w.v.partier(0).falling; k++) w.step();
  hurry(w);
  w.step();
  assert.deepEqual([w.v.partier(0).place, w.v.partier(1).place, w.v.party().winner], [2, 1, 1]);
  // every ball left going out at once: the last up, they share 1st
  const a = await room({ seed: 8, n: 3 });
  sink(a, 0);
  a.step();
  drop(a, 1);
  drop(a, 2);
  for (let k = 0; k < 40 && !(a.v.partier(1).falling && a.v.partier(2).falling); k++) a.step();
  hurry(a);
  a.step();
  assert.deepEqual([0, 1, 2].map((p) => a.v.partier(p).place), [3, 1, 1]);
  assert.deepEqual([0, 1, 2].map((p) => a.v.partier(p).wins), [0, 1, 1]);
  assert.ok(!a.v.partier(1).out && !a.v.partier(2).out);
  // a ball alone plays till it falls
  const s = await room({ seed: 9, n: 1 });
  for (let k = 0; k < 40; k++) s.step();
  assert.equal(s.v.hole().state, L.H_PLAY);
  sink(s, 0);
  s.step();
  assert.equal(s.v.hole().state, L.H_OVER);
  assert.deepEqual([s.v.partier(0).place, s.v.partier(0).pts, s.v.party().winner], [1, 1, 255]);
  // and falling at the time, it fell: 1st of 1, no win
  const z = await room({ seed: 9, n: 1 });
  drop(z, 0);
  for (let k = 0; k < 40 && !z.v.partier(0).falling; k++) z.step();
  hurry(z);
  z.step();
  assert.deepEqual([z.v.partier(0).place, z.v.partier(0).wins, z.v.party().winner], [1, 0, 255]);
  assert.ok(z.v.partier(0).out);
});

test('PK_SCORE: a fall is a down, back after PG_RESPAWN falling in; at the time placed by score, ties sharing', async () => {
  const g = await room({ n: 4 });
  g.dv.setUint32(L.PG_KIND, L.PK_SCORE, true);
  g.dv.setUint32(L.PG_RESPAWN, 100, true);
  sink(g, 0);
  g.step();
  const t0 = g.v.tick - 1;
  let b = g.v.partier(0);
  assert.ok(b.out, 'down');
  assert.deepEqual([b.place, b.rounds, b.outAt], [0, 0, t0]);
  assert.equal(fxs(g.v, L.FX_SINK)[0].size, 0);
  assert.equal(g.v.hole().state, L.H_PLAY, 'the round goes on');
  while (g.v.partier(0).out) g.step();
  assert.equal(g.v.tick - 1 - t0, 100);
  b = g.v.partier(0);
  assert.ok(!b.ground && !b.falling, 'falling in');
  assert.ok(b.pos[1] > PLAT_Y + 5.5, `6 m up: ${b.pos[1]}`);
  assert.ok(Math.hypot(b.pos[0] - L.B_CX, b.pos[2] - L.B_CX) < g.v.party().size, 'over the stage');
  // a newcomer in play falls straight in too
  g.step([[L.EV_JOIN, 4]]);
  b = g.v.partier(4);
  assert.ok(b.live && !b.out && b.pos[1] > PLAT_Y + 5);
  for (const [p, s] of [[0, 5], [1, 5], [2, 3], [3, 0], [4, 1]]) g.dv.setUint16(rec(p) + L.PG_SCORE, s, true);
  hurry(g);
  g.step();
  const r = g.v.party();
  assert.equal(r.state, L.H_OVER);
  assert.equal(r.winner, 255, 'a shared win');
  assert.deepEqual([0, 1, 2, 3, 4].map((p) => g.v.partier(p).place), [1, 1, 3, 5, 4]);
  assert.deepEqual([0, 1, 2, 3, 4].map((p) => g.v.partier(p).pts), [10, 10, 5, 1, 3]);
  assert.deepEqual([0, 1, 2, 3, 4].map((p) => g.v.partier(p).wins), [1, 1, 0, 0, 0]);
  assert.deepEqual([0, 1, 2, 3, 4].map((p) => g.v.partier(p).rounds), [1, 1, 1, 1, 1]);
});

test('late joiners: in the countdown, laid out with the rest (the same minigame); in a PK_OUT round, watching till the next', async () => {
  const c = await room({ n: 2, force: null, play: false });
  const before = c.v.party();
  c.step([[L.EV_JOIN, 2]]);
  const after = c.v.party();
  assert.equal(after.n0, 3);
  assert.equal(after.game, before.game);
  assert.deepEqual(after.prev, before.prev, 'not picked again');
  assert.ok(c.v.partier(2).ground && !c.v.partier(2).out);

  const g = await room({ n: 2 });
  g.step([[L.EV_JOIN, 2]]);
  const b = g.v.partier(2);
  assert.ok(b.out, 'watching');
  assert.equal(b.place, 0);
  assert.deepEqual(b.pos, [L.B_CX, PLAT_Y + 20, L.B_CX]);
  assert.equal(g.v.party().left, 2);
  sink(g, 0);
  g.step();
  assert.equal(g.v.party().winner, 1);
  assert.deepEqual([g.v.partier(2).place, g.v.partier(2).pts, g.v.partier(2).rounds], [0, 0, 0], 'not in it');
  // a join in the result watches too; then everyone is in the next round
  g.step([[L.EV_JOIN, 3]]);
  assert.ok(g.v.partier(3).out);
  while (g.v.hole().state !== L.H_COUNT) g.step();
  assert.equal(g.v.party().n0, 4);
  for (let p = 0; p < 4; p++) assert.ok(!g.v.partier(p).out, `P${p + 1} in`);
  // one leaves: the rest play on; the room empty, it idles
  hurry(g);
  g.step();
  g.step([[L.EV_LEAVE, 0]]);
  assert.equal(g.v.party().left, 3);
  g.step([[L.EV_LEAVE, 1], [L.EV_LEAVE, 2], [L.EV_LEAVE, 3]]);
  assert.equal(g.v.hole().state, L.H_IDLE);
});


test('the prediction matches the confirmed ball bit for bit: into play off the countdown, rolling, hopping, falling between layers of thin ice', async () => {
  const g = await room({ n: 1, play: false });
  while (g.v.hole().until - g.v.tick > 20) g.step();
  // across the countdown's end, keys held from before it
  assert.ok(predicted(g, Array.from({ length: 60 }, () => partyWord({ yaw: TURN / 4, move: 1 }))) >= 60);
  assert.equal(g.v.hole().state, L.H_PLAY);
  // circling the middle, hopping now and then: it comes round onto ice it
  // cracked a lap before, drops through and lands on the layer below
  let k = 0;
  const circling = () => partyWord({ yaw: (TURN / 4 + k * 40) & (TURN - 1), move: 1, hop: k++ % 150 === 60 ? 1 : 0 });
  for (let n = 0; n < 40 && !(g.v.partier(0).ground && g.v.partier(0).pos[1] === PLAT_Y - MC.TI_GAP); n++) {
    assert.ok(predicted(g, Array.from({ length: 25 }, circling)) >= 25);
  }
  let b = g.v.partier(0);
  assert.ok(b.ground && b.pos[1] === PLAT_Y - MC.TI_GAP, `a layer down at ${b.pos[1]} after ${k} ticks`);
  assert.ok(k > 300, 'after a lap');
  // standing still: the tile under it cracks, holds, drops, and it falls another layer and lands
  for (let n = 0; n < 40 && !(g.v.partier(0).ground && g.v.partier(0).pos[1] === PLAT_Y - 2 * MC.TI_GAP); n++) {
    assert.ok(predicted(g, Array.from({ length: 10 }, () => partyWord({ yaw: 0 }))) >= 10);
  }
  b = g.v.partier(0);
  assert.ok(b.ground && b.pos[1] === PLAT_Y - 2 * MC.TI_GAP, `the last layer at ${b.pos[1]}`);
  // and through the last one, going out (not yet counted out)
  assert.ok(predicted(g, Array.from({ length: MC.TI_HOLD + 110 }, () => partyWord({ yaw: 0 }))) >= MC.TI_HOLD + 110);
  b = g.v.partier(0);
  assert.ok(b.falling && !b.out, `going out, at ${b.pos[1]}`);
});

test('the hex grid: hexAt and hexCentre mirror the sim\'s, each cell\'s centre in its own cell; seed() mirrors $p_seed', async () => {
  for (let q = -6; q <= 6; q++) for (let r = -6; r <= 6; r++) {
    const [x, z] = hexCentre(q, r, 2);
    assert.deepEqual(hexAt(x, z, 2), [q, r]);
    // a point 1.7 m (inside the inradius) off the centre is still in it
    for (let a = 0; a < 6; a++) assert.deepEqual(hexAt(x + 1.7 * Math.cos(a), z + 1.7 * Math.sin(a), 2), [q, r]);
  }
  assert.deepEqual(hexCentre(1, 0, 2), [Math.fround(L.B_CX + 2 * Math.fround(1.7320508)), L.B_CX]);
  assert.equal(hexCentre(0, 1, 2)[1], L.B_CX + 3);
  // the sim's own cells for Thin Ice's tiles agree: every tile's centre is on the disc
  const g = await room({ n: 8, play: false });
  const rad = g.dv.getFloat32(L.PG_H + MC.TI_RAD, true);
  let tiles = 0;
  for (let r = -MC.TI_N; r <= MC.TI_N; r++) for (let q = -MC.TI_N; q <= MC.TI_N; q++) {
    const on = g.dv.getUint32(L.PG_BIG + 4 * ((r + MC.TI_N) * MC.TI_W + q + MC.TI_N), true) === 1;
    const [x, z] = hexCentre(q, r, MC.TI_S);
    assert.equal(on, Math.hypot(x - L.B_CX, z - L.B_CX) <= rad + 1e-4, `tile ${q},${r}`);
    tiles += on;
  }
  assert.equal(tiles, g.dv.getUint32(L.PG_H + MC.TI_COUNT, true));
  assert.equal(hash32(1, 2, 3), hash32(1, 2, 3));
  const k = seed(g.v, 5);
  assert.ok(k >= 0 && k < 2 ** 32);
  assert.notEqual(seed(g.v, 5), seed(g.v, 6));
});

test('a room of scripted balls into the rotation replays to the same hash on every tick, on 1 and 4 threads', async () => {
  // seed 2's first round is Thin Ice (16 balls are through it in 7 s), then the rotation's next
  const bytes = partyBytes();
  let rounds = 0, state = -1;
  const games = new Set();
  const { log } = await scriptedParty({ bytes, seed: 2, balls: 16, ticks: 6000, leaveAt: 1500, onTick: (t, sim) => {
    const v = new View(sim.memory.buffer);
    const s = v.hole().state;
    if (s === L.H_OVER && state !== L.H_OVER) rounds++;
    if (s === L.H_PLAY) games.add(v.party().game);
    state = s;
  } });
  assert.ok(rounds >= 1, `${rounds} rounds`);
  assert.ok(games.size >= 2, `${games.size} minigames`);
  const parsed = parseLog(log);
  const a = await replay({ bytes, log: parsed, ticks: 6000, threads: 1, tag: 'p1' });
  const b = await replay({ bytes, log: parsed, ticks: 6000, threads: 4, tag: 'p4', startWorkers });
  assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
});

test('every minigame has a client module: its id, key and name as the layout has them, a backdrop, a hint the HUD can show, a brain', () => {
  assert.equal(MG.length, L.NMG);
  MG.forEach((m, k) => {
    assert.deepEqual([m.id, m.key, m.name], [k, L.MINIGAMES[k].key, L.MINIGAMES[k].name]);
    assert.ok(['day', 'sunset', 'night', 'snow'].includes(m.env), `${m.key}: env ${m.env}`);
    assert.ok(typeof m.hint === 'string' && m.hint.length <= 70 && /^[ -_]*$/.test(m.hint), `${m.key}: the hint in the 3x5 font's characters`);
    for (const f of ['draw', 'frame', 'fx', 'hud']) assert.equal(typeof m[f], 'function', `${m.key}.${f}`);
    for (const f of ['danger', 'goal', 'hop']) assert.equal(typeof m.brain[f], 'function', `${m.key}.brain.${f}`);
  });
});

test('Partier: AI balls on Thin Ice keep rolling, none out in the first 8 s; the same seed and world, the same words', async () => {
  const bytes = partyBytes();
  const a = await playParty({ bytes, mg: L.MG_THINICE, bots: 8, ticks: 4500 });
  const b = await playParty({ bytes, mg: L.MG_THINICE, bots: 8, ticks: 4500 });
  assert.deepEqual(a.log, b.log, 'deterministic');
  assert.ok(a.rounds >= 1, `${a.rounds} rounds`);
  assert.ok(a.scores.some((s) => s.wins > 0));
  // a round of eight lasts: no ball falls through all three layers in its first 8 s
  let start = -1, first = Infinity;
  await playParty({ bytes, mg: L.MG_THINICE, bots: 8, ticks: 4000, onTick: (t, sim, v) => {
    const h = v.hole();
    if (h.state === L.H_PLAY && start < 0) start = h.start;
    for (let p = 0; p < 8 && start >= 0; p++) if (v.partier(p).out && v.partier(p).place) first = Math.min(first, v.partier(p).outAt - start);
  } });
  assert.ok(first > 8 * 125, `the first out ${(first / 125).toFixed(1)} s in`);
});

test('rounds of AI balls on the debug build, no trap: Thin Ice, then the rotation; equal on every tick on 1 and 4 threads', async () => {
  const bytes = partyBytes(true);
  // Thin Ice forced (through the seed), a ball leaving and coming back
  const ti = await playParty({ bytes, mg: L.MG_THINICE, bots: 12, ticks: 5000, leaveAt: 1200 });
  assert.ok(ti.rounds >= 1 && ti.games.every((g) => g === L.MG_THINICE), `${ti.rounds} rounds of ${ti.games}`);
  // a rotation that opens on Thin Ice, then whatever the PRNG picks next (seed 9's, with fourteen minigames:
  // which seed opens on it moves as minigames are added, so it is looked for)
  let seed = 9;
  while ((await playParty({ bytes, seed, bots: 12, ticks: 800 })).games[0] !== L.MG_THINICE) seed++;
  const rot = await playParty({ bytes, seed, bots: 12, ticks: 6500, leaveAt: 1500 });
  assert.ok(rot.games.length >= 2 && rot.games[0] === L.MG_THINICE && rot.games[1] !== L.MG_THINICE, `minigames ${rot.games}`);
  assert.equal(partySeed(5, 3), (0xa7030005) >>> 0);
  for (const [tag, r, ticks] of [['ti', ti, 5000], ['rot', rot, 6500]]) {
    const parsed = parseLog(r.log);
    const a = await replay({ bytes, log: parsed, ticks, threads: 1, tag: `pp-${tag}1` });
    const b = await replay({ bytes, log: parsed, ticks, threads: 4, tag: `pp-${tag}4`, startWorkers });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes], tag);
  }
});
