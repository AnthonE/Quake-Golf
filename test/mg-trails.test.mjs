import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty, partyBytes, predicted } from './helpers.mjs';
import { View, partyWord, PLAT_Y } from '../src/party-view.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { playParty } from '../tools/genparty.mjs';
import * as L from '../src/layout.mjs';
import * as MC from '../src/mg/trails.mjs'; // LT_*: the minigame's own constants
import trails, { stage, halfAt, lifeOf, stateOf, ownTrack, paintLayer, plan, hopFree, grid as gridOf } from '../client/mg/trails.mjs';

const C = L.B_CX;
const f = Math.fround;
const TICK = 0.008;
const CS = MC.LT_CS;

// A room of n balls in Light Trails, on the debug build (a NaN traps), stepped into play unless asked not to.
async function room(n = 2, { play = true, seed = 7 } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_TRAILS + 1, true);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); assert.equal(sim.error().code, 0, 'no trap'); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  while (play && v.hole().state !== L.H_PLAY) step();
  return { sim, v, dv, step };
}
const rec = (p) => L.PLAYERS + p * L.PSIZE;
// Ball p at (x, z) on the floor (or y), rolling at (vx, vz), its last walk ending there.
function put(g, p, x, z, { y = PLAT_Y, vx = 0, vz = 0, ground = true } = {}) {
  g.dv.setFloat32(rec(p) + L.P_PX, x, true);
  g.dv.setFloat32(rec(p) + L.P_PY, y, true);
  g.dv.setFloat32(rec(p) + L.P_PZ, z, true);
  g.dv.setFloat32(rec(p) + L.P_VX, vx, true);
  g.dv.setFloat32(rec(p) + L.P_VY, 0, true);
  g.dv.setFloat32(rec(p) + L.P_VZ, vz, true);
  g.dv.setUint8(rec(p) + L.P_FL, L.PF_LIVE | (ground ? L.PF_GROUND : 0));
  g.dv.setFloat32(L.PG_S + MC.LT_PREV + 8 * p, x, true);
  g.dv.setFloat32(L.PG_S + MC.LT_PREV + 8 * p + 4, z, true);
}
// Ball p out of the way: off the grid, so high it is still falling at the end, laying nothing.
const away = (g, p) => put(g, p, C + 400 + 10 * p, C + 400, { y: PLAT_Y + 20000, ground: false });
// The next step plays tick t into play (the clock moved; the round's end with it).
function at(g, t) {
  const now = g.v.tick;
  g.dv.setUint32(L.HDR_START, now - t, true);
  g.dv.setUint32(L.HDR_UNTIL, now - t + MC.LT_LEN, true);
}
const playT = (g) => g.v.party().t;
const cells = (g) => { const st = stage(g.v); return new Uint32Array(g.sim.memory.buffer, L.PG_BIG + MC.LT_CELLS, st.side * st.side); };
const wipe = (g) => cells(g).fill(0);
// Cell (i, j)'s centre, and the cell under (x, z), as the sim's grid has them.
const centre = (st, i) => f(st.x0 + (i + 0.5) * CS);
const cellOf = (st, x, z) => [Math.floor(f(f(x - st.x0) / CS)), Math.floor(f(f(z - st.x0) / CS))];
const fxs = (v, from, kind) => { const out = []; for (let k = from; k < v.fxCount(); k++) { const x = v.fx(k); if (x.kind === kind) out.push(x); } return out; };
// The floor as the sim lays it out for n balls, in f32 as the sim works it.
function floor(n) {
  const h = Math.min(f(f(f(Math.sqrt(n)) * MC.LT_HK) + MC.LT_H0), MC.LT_HMAX);
  return { h, h1: Math.max(f(h * f(MC.LT_HEND)), MC.LT_HMIN), x0: f(C - h), side: Math.ceil(f(f(h + h) / CS)) };
}
// $lt_walk's cells from (x0, z0) to (x1, z1), in f32 as the sim walks them.
function walk(st, x0, z0, x1, z1) {
  const g = st.x0;
  const u0 = f(f(x0 - g) / CS), w0 = f(f(z0 - g) / CS), u1 = f(f(x1 - g) / CS), w1 = f(f(z1 - g) / CS);
  let i = Math.floor(u0), j = Math.floor(w0), ni = Math.floor(u1) - i, nj = Math.floor(w1) - j;
  const si = ni < 0 ? -1 : 1, sj = nj < 0 ? -1 : 1;
  ni *= si; nj *= sj;
  const du = Math.abs(f(u1 - u0)), dw = Math.abs(f(w1 - w0));
  const out = [[i, j]];
  for (let k = 0; k < MC.LT_WALK && ni + nj > 0; k++) {
    const ex = Math.abs(f(i + (si > 0 ? 1 : 0) - u0)), ez = Math.abs(f(j + (sj > 0 ? 1 : 0) - w0));
    if (nj === 0 || (ni !== 0 && f(ex * dw) < f(ez * du))) { i += si; ni--; } else { j += sj; nj--; }
    out.push([i, j]);
  }
  return out;
}
// A cell's value as the sim stores it: laid tl into play by slot s.
const laid = (tl, s) => ((tl << 8) | s) >>> 0;
// The tick into play a cell would have to be laid for it to be `age` old on tick T (age may be 'last': its last tick alive).
function laidFor(T, age) {
  if (age !== 'last') return T - age;
  for (let tl = T - 1; tl > 0; tl--) if (T - tl === lifeOf(tl) - 1) return tl;
  throw new Error('no such tick');
}

test('the stage for 1, 8, 64 and 256: a square floor sized for the crowd, its grid empty and in PG_BIG, every ball on it apart', async () => {
  let last = 0;
  for (const n of [1, 8, 64, 256]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party(), st = stage(g.v), want = floor(n);
    assert.equal(r.game, L.MG_TRAILS);
    assert.deepEqual([st.half0, st.half1, st.x0, st.side], [want.h, want.h1, want.x0, want.side], `${n}`);
    assert.ok(st.half0 > last, 'grows with the crowd');
    last = st.half0;
    assert.ok(st.side * st.side * 4 <= L.PG_BIG_SIZE - MC.LT_CELLS, `${st.side} cells a side fit`);
    assert.ok(st.x0 + st.side * CS >= C + st.half0, 'the grid covers the floor');
    assert.deepEqual([r.kind, r.len, r.size, r.flags, r.acc, r.drag, r.idle, r.hop],
      [L.PK_OUT, MC.LT_LEN, st.half0, L.PGF_BUMPS | L.PGF_NOKICK, f(MC.LT_ACC), f(Number(MC.LT_DRAG)), f(Number(MC.LT_DRAG)), 6]);
    assert.ok(cells(g).every((c) => c === 0), 'no light yet');
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p);
      assert.equal(b.pos[1], PLAT_Y);
      assert.ok(Math.hypot(b.pos[0] - C, b.pos[2] - C) <= st.half0 * MC.LT_SPAWN + 1e-3, `${n}: P${p + 1} in the middle`);
      for (let q = 0; q < p; q++) {
        const o = g.v.partier(q);
        assert.ok(Math.hypot(b.pos[0] - o.pos[0], b.pos[2] - o.pos[2]) > 2.5, `${n}: P${p + 1} and P${q + 1} apart`);
      }
    }
  }
  assert.ok(floor(256).h === MC.LT_HMAX && floor(255).h < MC.LT_HMAX, 'full size at 256');
});

test('every cell a ball\'s centre crosses is laid its own on that tick, side by side so a fast ball skips none; a living cell is nobody else\'s to lay', async () => {
  const g = await room(3);
  away(g, 2);
  const st = stage(g.v);
  const grid = cells(g);
  // P1 fast on a slant (from rest at first, then flat out), P2 slowly the other way across its line
  put(g, 0, f(C - 9.37), f(C - 7.81));
  put(g, 1, f(C + 2.13), f(C + 6.4), { vz: -3 });
  const go = [[L.EV_INPUT, 0, partyWord({ yaw: 1900, move: 1 })], [L.EV_INPUT, 1, partyWord({ yaw: 12288, move: 1 })]];
  const want = new Map(); // cell -> value
  for (let k = 0; k < 240; k++) {
    const t = playT(g);
    const before = [0, 1].map((p) => [g.dv.getFloat32(L.PG_S + MC.LT_PREV + 8 * p, true), g.dv.getFloat32(L.PG_S + MC.LT_PREV + 8 * p + 4, true)]);
    if (k === 60) put(g, 0, g.v.partier(0).pos[0], g.v.partier(0).pos[2], { vx: 45, vz: 31 }); // flat out and more: 0.44 m a tick
    g.step(k ? [] : go);
    for (const p of [0, 1]) {
      const b = g.v.partier(p);
      assert.ok(!b.out, `P${p + 1} in`);
      const path = walk(st, before[p][0], before[p][1], b.pos[0], b.pos[2]);
      // side by side: each cell shares a side with the one before
      for (let q = 1; q < path.length; q++) assert.equal(Math.abs(path[q][0] - path[q - 1][0]) + Math.abs(path[q][1] - path[q - 1][1]), 1);
      // and every point of the segment is in one of them (but where it grazes a corner)
      const set = new Set(path.map(([i, j]) => j * st.side + i));
      for (let s = 0; s <= 200; s++) {
        const x = before[p][0] + ((b.pos[0] - before[p][0]) * s) / 200, z = before[p][1] + ((b.pos[2] - before[p][1]) * s) / 200;
        const u = (x - st.x0) / CS, w = (z - st.x0) / CS;
        if (Math.abs(u - Math.round(u)) < 1e-3 || Math.abs(w - Math.round(w)) < 1e-3) continue;
        assert.ok(set.has(Math.floor(w) * st.side + Math.floor(u)), `P${p + 1} tick ${t}: the walk misses a cell its centre crossed`);
      }
      for (const c of set) if (!want.has(c)) want.set(c, laid(t, p));
    }
    if (g.v.partier(0).pos[0] > C + st.half0 - 3) break;
  }
  assert.ok(want.size > 80, `${want.size} cells laid`);
  let mine = 0, theirs = 0;
  for (const [c, v] of want) { assert.equal(grid[c], v, `cell ${c}`); if ((v & 255) === 0) mine++; else theirs++; }
  for (let c = 0; c < grid.length; c++) if (grid[c]) assert.ok(want.has(c), `cell ${c} laid by nobody's walk`);
  assert.ok(mine > 50 && theirs > 15, `${mine} and ${theirs}`);
  // where the lines cross, the first to get there has it
  const crossed = [...want].filter(([c]) => grid[c] !== 0).length;
  assert.equal(crossed, want.size);
  const keys = [...want.keys()];
  assert.deepEqual([stateOf(grid[keys[0]], playT(g)), stateOf(grid[keys.at(-1)], playT(g)), stateOf(0, 5)], [2, 1, 0], 'the first hard by now, the last soft, and none');
});

test('a cell is soft LT_HARD after it\'s laid, then a wall until it fades: a ball whose centre is on it then, low, is out; its own too', async () => {
  const cases = [
    ['soft to the last tick', MC.LT_HARD - 1, 1, false],
    ['hard on its first tick', MC.LT_HARD, 1, true],
    ['hard on its last', 'last', 1, true],
    ['its own', MC.LT_HARD + 40, 0, true],
  ];
  for (const [what, age, owner, out] of cases) {
    const g = await room(3);
    away(g, 1);
    away(g, 2);
    at(g, 4000);
    wipe(g);
    const st = stage(g.v), T = playT(g);
    const [i, j] = [st.side >> 1, (st.side >> 1) + 3];
    put(g, 0, centre(st, i), centre(st, j));
    const tl = laidFor(T, age);
    cells(g)[j * st.side + i] = laid(tl, owner);
    const from = g.v.fxCount();
    g.step();
    const b = g.v.partier(0);
    assert.equal(b.out, out, `${what}: age ${T - tl} of ${lifeOf(tl)}`);
    if (!out) { assert.equal(cells(g)[j * st.side + i], laid(tl, owner), 'still theirs'); continue; }
    const crash = fxs(g.v, from, MC.LT_FX_CRASH), sink = fxs(g.v, from, L.FX_SINK);
    assert.deepEqual(crash.map((x) => [x.owner, x.shot, x.size]), [[0, owner, T - tl]]);
    assert.deepEqual(crash[0].pos, b.pos.map(f));
    assert.deepEqual(sink.map((x) => [x.owner, x.shot]), [[0, owner === 0 ? 255 : owner]], 'the KO to whoever laid it, none for your own');
    assert.equal(b.m, owner + 1, 'PG_M: whose light');
    assert.equal(g.v.partier(1).kos, owner === 1 ? 1 : 0);
    assert.equal(trails.sink(sink[0], (p) => (p === 0 ? 'YOU' : `P${p + 1}`), g.v), owner === 0 ? 'YOU HIT YOUR OWN LIGHT' : 'YOU HIT P2\'S LIGHT');
  }
  // a cell gone (its life over) is free: laid again, by whoever crosses it
  const g = await room(3);
  away(g, 1); away(g, 2);
  at(g, 4000);
  wipe(g);
  const st = stage(g.v), T = playT(g);
  const [i, j] = [st.side >> 1, st.side >> 1];
  put(g, 0, centre(st, i), centre(st, j));
  const tl = laidFor(T, 'last') - 1;
  cells(g)[j * st.side + i] = laid(tl, 1);
  g.step();
  assert.ok(!g.v.partier(0).out, 'faded');
  assert.equal(cells(g)[j * st.side + i], laid(T, 0), 'laid again');
});

test('the wall\'s height: a ball whose bottom is LT_WALL over the floor passes over it; just under, it\'s out', async () => {
  for (const [dy, out] of [[MC.LT_WALL + 0.02, false], [MC.LT_WALL - 0.02, true]]) {
    const g = await room(2);
    away(g, 1);
    at(g, 3000);
    wipe(g);
    const st = stage(g.v), T = playT(g);
    const [i, j] = [(st.side >> 1) - 4, st.side >> 1];
    put(g, 0, centre(st, i), centre(st, j), { y: PLAT_Y + dy, ground: false });
    cells(g)[j * st.side + i] = laid(T - 500, 1);
    g.step();
    assert.equal(g.v.partier(0).out, out, `${dy} m up`);
    assert.ok(g.v.partier(0).pos[1] > PLAT_Y + dy - 0.01, 'still about there');
  }
});

test('a fast ball crossing a wall in one tick is stopped by it; a still ball is out when its own light hardens under it', async () => {
  for (const [wall, out] of [[1, true], [3, false]]) {
    const g = await room(2);
    away(g, 1);
    at(g, 2000);
    wipe(g);
    const st = stage(g.v), T = playT(g);
    const [i, j] = [st.side >> 1, st.side >> 1];
    // 0.45 into cell i, at 80 m/s: 0.64 m on, through cell i + 1 and into i + 2
    put(g, 0, f(st.x0 + (i + 0.9) * CS), centre(st, j), { vx: 80 });
    cells(g)[j * st.side + i + wall] = laid(T - 300, 1);
    g.step();
    const b = g.v.partier(0);
    assert.equal(cellOf(st, b.pos[0], b.pos[2])[0], i + 2, 'two cells on');
    assert.equal(b.out, out, `the wall ${wall} on`);
    if (!out) assert.deepEqual([cells(g)[j * st.side + i + 1], cells(g)[j * st.side + i + 2]], [laid(T, 0), laid(T, 0)], 'the cells it crossed laid');
  }
  // still from the start: its first cell laid on tick 1, a wall under it on tick 1 + LT_HARD
  const g = await room(2);
  away(g, 1);
  const st = stage(g.v);
  const b0 = g.v.partier(0);
  wipe(g);
  at(g, 1);
  put(g, 0, b0.pos[0], b0.pos[2]);
  let outAt = -1;
  for (let k = 0; k < 400 && outAt < 0; k++) { const t = playT(g); g.step(); if (g.v.partier(0).out) outAt = t; }
  assert.equal(outAt, 1 + MC.LT_HARD);
  const [i, j] = cellOf(st, b0.pos[0], b0.pos[2]);
  assert.equal(cells(g)[j * st.side + i], laid(1, 0));
  assert.equal(g.v.partier(0).m, 1, 'its own light');
});

test('a ball bumped into a wall: the KO is the bumper\'s, and the feed says both', async () => {
  const g = await room(3);
  away(g, 1);
  at(g, 3000);
  wipe(g);
  const st = stage(g.v), T = playT(g);
  const [i, j] = [st.side >> 1, st.side >> 1];
  put(g, 0, centre(st, i), centre(st, j));
  put(g, 2, centre(st, i) + 10, centre(st, j) + 10);
  g.dv.setUint8(rec(0) + L.B_HITBY, 2);
  g.dv.setUint16(rec(0) + L.B_HITT, 100, true);
  cells(g)[j * st.side + i] = laid(T - 400, 1);
  const from = g.v.fxCount();
  g.step();
  const sink = fxs(g.v, from, L.FX_SINK);
  assert.deepEqual(sink.map((x) => [x.owner, x.shot]), [[0, 2]]);
  assert.deepEqual([g.v.partier(1).kos, g.v.partier(2).kos], [0, 1]);
  assert.equal(trails.sink(sink[0], (p) => `P${p + 1}`, g.v), 'P1 HIT P2\'S LIGHT  BUMPED BY P3');
  assert.equal(trails.sink(sink[0], (p) => (p === 1 ? 'YOU' : `P${p + 1}`), g.v), 'P1 HIT YOUR LIGHT  BUMPED BY P3');
});

test('the edges: the half-side until LT_CLOSE0, then in a straight line to its end by LT_CLOSE1; a ball past them falls; halfAt as the sim has it', async () => {
  const g = await room(8);
  const st = stage(g.v);
  assert.ok(st.half1 < st.half0 - 5);
  assert.equal(halfAt(st, 0), st.half0);
  assert.equal(halfAt(st, MC.LT_CLOSE0), st.half0);
  assert.equal(halfAt(st, MC.LT_CLOSE1), st.half1);
  assert.equal(halfAt(st, MC.LT_LEN), st.half1);
  // balls still at four distances out along the axes, the clock jumped to just before the edge reaches each
  const d = [st.half0 - 0.05, (st.half0 + st.half1) / 2, st.half1 + 0.3, st.half1 - 0.2].map(f);
  const sign = [1, -1, 1, -1];
  for (let p = 4; p < 8; p++) away(g, p);
  for (let k = 0; k < 4; k++) {
    let reach = MC.LT_CLOSE0;
    while (reach < MC.LT_LEN && halfAt(st, reach) >= d[k]) reach++;
    at(g, Math.max(1, reach - 3));
    wipe(g);
    for (let q = 0; q < 4; q++) put(g, q, q === k ? f(C + sign[k] * d[k]) : f(C - 6 + 3 * q), q === k ? C : f(C + 3));
    if (k === 3) { assert.ok(reach >= MC.LT_LEN, 'inside the end: never reached'); continue; }
    let fell = -1;
    for (let n = 0; n < 6; n++) {
      const t = playT(g);
      g.step();
      const b = g.v.partier(k);
      if (!b.ground && fell < 0) fell = t;
      for (let q = 0; q < 4; q++) if (q !== k) put(g, q, f(C - 6 + 3 * q), f(C + 3)); // the others still, laying nothing new
    }
    assert.equal(fell, reach, `ball at ${d[k]} m falls the tick the edge passes it`);
  }
  // the edges' FX as they start in, and PG_SIZE with them
  at(g, MC.LT_CLOSE0);
  wipe(g);
  const from = g.v.fxCount();
  g.step();
  assert.deepEqual(fxs(g.v, from, MC.LT_FX_CLOSE).map((x) => [x.owner, x.size]), [[255, st.half1]]);
  at(g, 6000);
  g.step();
  assert.equal(g.v.party().size, halfAt(st, 6000));
  assert.deepEqual(trails.frame(g.v), { centre: [C, PLAT_Y, C], radius: halfAt(st, 6001), shape: 'square' });
});

test('the prediction matches the confirmed ball bit for bit: rolling over light, hopping a wall, off the edges as they close; the client sees its crash on the tick the sim does', async () => {
  const g = await room(3, { play: false });
  while (g.v.hole().state !== L.H_PLAY) g.step();
  away(g, 1);
  away(g, 2);
  const st = stage(g.v);
  // round and round over its own light and others' soft light, a hop now and then
  put(g, 0, f(C - 4), f(C - 2));
  const words = Array.from({ length: 200 }, (_, k) => partyWord({ yaw: (k * 61) & 16383, move: k % 50 < 44 ? 1 : 0, hop: k === 120 ? 1 : 0 }));
  assert.ok(predicted(g, words) >= words.length);
  assert.ok(!g.v.partier(0).out);
  // a wall across its way, hopped: high over it, so no out, and the prediction exact all the way
  wipe(g);
  const T = playT(g);
  const wi = cellOf(st, C + 2, C)[0];
  for (let j = 0; j < st.side; j++) cells(g)[j * st.side + wi] = laid(T - 250, 1);
  put(g, 0, f(C - 6), f(C), { vx: 7.5 });
  // when to hop: rolling at about 7.6 m/s, its centre over the wall's middle 0.3 s after (high from 0.13 to 0.47 s)
  const mid = st.x0 + (wi + 0.5) * CS;
  const hopAt = Math.round(((mid - (C - 6)) / 7.6 - 0.3) / TICK);
  const run = Array.from({ length: 200 }, (_, k) => partyWord({ yaw: 0, move: 1, hop: k === hopAt ? 1 : 0 }));
  assert.ok(predicted(g, run) >= run.length);
  assert.ok(!g.v.partier(0).out && g.v.partier(0).pos[0] > mid + 2, `over it: at ${(g.v.partier(0).pos[0] - C).toFixed(2)}`);
  // no hop: out against it; the client finds the crash on the prediction's track on the same tick
  const g2 = await room(3);
  away(g2, 1);
  away(g2, 2);
  at(g2, 3000);
  wipe(g2);
  const T2 = playT(g2);
  for (let j = 0; j < st.side; j++) cells(g2)[j * st.side + wi] = laid(T2 - 250, 1);
  put(g2, 0, f(C - 3), f(C), { vx: 7 });
  const roll = Array(120).fill(partyWord({ yaw: 0, move: 1 }));
  roll.forEach((w, k) => g2.dv.setUint32(L.PWORDS + 4 * k, w, true));
  g2.sim.x.predict(0, roll.length);
  const pview = new View(g2.sim.memory.buffer, L.PRED_D);
  const seen = ownTrack(g2.v, stage(g2.v), 0, { pme: pview.partier(0), pview });
  assert.ok(seen.crash, 'the crash ahead');
  assert.ok(seen.cells.length > 10, 'and the light laid up to it');
  const from = g2.v.fxCount();
  for (const w of roll) { g2.step([[L.EV_INPUT, 0, w]]); if (g2.v.partier(0).out) break; }
  const crash = fxs(g2.v, from, MC.LT_FX_CRASH);
  assert.equal(crash.length, 1);
  assert.equal(crash[0].tick, seen.crash.tick, 'on the same tick');
  assert.deepEqual(crash[0].pos.map(f), seen.crash.pos.map(f), 'at the same spot');
  // the edges closing in under a still ball: predicted as it falls
  const g3 = await room(3);
  away(g3, 1);
  away(g3, 2);
  const st3 = stage(g3.v);
  let reach = MC.LT_CLOSE0;
  const r = f(st3.half0 - 1);
  while (halfAt(st3, reach) >= r) reach++;
  at(g3, reach - 40);
  wipe(g3);
  put(g3, 0, f(C + r), f(C));
  const creep = (k) => partyWord({ yaw: 0, move: k % 40 < 2 ? 1 : 0 });
  for (let n = 0; n < 40 && g3.v.partier(0).pos[1] > PLAT_Y - 5; n++) {
    wipe(g3);
    assert.ok(predicted(g3, Array.from({ length: 10 }, (_, k) => creep(n * 10 + k))) >= 10);
  }
  assert.ok(g3.v.partier(0).pos[1] < PLAT_Y - 1 && !g3.v.partier(0).out, 'over the edge, predicted all the way');
});

// A round of AI balls (client/party-bot.mjs) steered by this minigame's brain on the debug build, stats from it.
async function aiRound(balls, ticks, seed) {
  const stats = { start: -1, over: -1, crashes: 0, own: 0, falls: 0, outs: [], places: null, pts: null, winner: -1, hops: 0 };
  let seen = 0;
  const r = await playParty({ bytes: partyBytes(true), mg: L.MG_TRAILS, bots: balls, ticks, seed, onTick: (t, sim, v) => {
    const g = v.party();
    for (; seen < v.fxCount(); seen++) {
      const x = v.fx(seen);
      if (stats.over >= 0 || stats.start < 0) continue;
      if (x.kind === MC.LT_FX_CRASH) { stats.crashes++; if (x.shot === x.owner) stats.own++; }
      if (x.kind === L.FX_SINK) { stats.outs.push((t - stats.start) * TICK); if (!v.partier(x.owner).m) stats.falls++; }
    }
    if (stats.start < 0 && g.state === L.H_PLAY) stats.start = t;
    if (stats.over < 0 && stats.start >= 0 && g.state === L.H_OVER) {
      stats.over = t;
      stats.winner = g.winner;
      stats.places = [...Array(balls).keys()].map((p) => v.partier(p).place);
      stats.pts = [...Array(balls).keys()].map((p) => v.partier(p).pts);
    }
    if (stats.start >= 0 && stats.over < 0) for (let p = 0; p < balls; p++) { const b = v.partier(p); if (b.live && !b.out && b.pos[1] > PLAT_Y + 0.3) stats.hops++; }
  } });
  return { ...r, stats };
}

for (const [balls, ticks, seed] of [[8, 9000, 3], [64, 12500, 5]]) {
  test(`a round of ${balls} AI balls on the debug build: no trap, their light their ends, outs over the round till one is left; equal on 1 and 4 threads`, async () => {
    const { log, sim, stats, games } = await aiRound(balls, ticks, seed);
    assert.equal(sim.error().code, 0);
    assert.ok(games.every((x) => x === L.MG_TRAILS));
    assert.ok(stats.over > 0, 'the round ended');
    const secs = (stats.over - stats.start) * TICK;
    assert.ok(secs > 15 && secs < MC.LT_LEN * TICK, `${secs.toFixed(1)} s of play`);
    assert.ok(stats.crashes >= (balls - 1) * 0.8, `${stats.crashes} crashes of ${balls - 1} outs (${stats.own} on their own light, ${stats.falls} falls)`);
    const mid = stats.outs[Math.floor(stats.outs.length / 2)];
    assert.ok(mid > 6, `half out by ${mid.toFixed(1)} s`);
    assert.ok(stats.hops > 0, 'hops');
    assert.equal(stats.winner < balls, true, 'one winner');
    assert.ok(stats.places.every((x) => x >= 1 && x <= balls), `places ${stats.places}`);
    assert.ok(stats.pts.every((x) => x >= 1 && x <= 10), `points ${stats.pts}`);
    const parsed = parseLog(log);
    const n = stats.over + 50;
    const a = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 1, tag: 't1' });
    const b = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 4, tag: 't4', startWorkers });
    const d = await replay({ bytes: partyBytes(true), log: parsed, ticks: n, threads: 1, tag: 'd1' });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(d.trace).tickHashes], 'the debug build steps the same bits');
  });
}

test('the client module: draws the floor, its light and walls; frames the square; its HUD lines; its brain turns from a wall and hops what it can\'t get round', async () => {
  const { Scene } = await import('../client/party-render.mjs');
  const g = await room(4, { seed: 41 });
  const out = () => ({ scene: new Scene(24000), solid: [], glow: [], beams: [], decals: [], casters: [], paint: null });
  const st = stage(g.v);
  away(g, 2);
  away(g, 3);
  put(g, 0, f(C - 10), f(C - 5));
  put(g, 1, f(C + 10), f(C + 5));
  for (let k = 0; k < 200; k++) g.step([[L.EV_INPUT, 0, partyWord({ yaw: k < 120 ? 0 : 4096, move: 1 })], [L.EV_INPUT, 1, partyWord({ yaw: 8192, move: 1 })]]);
  assert.ok(!g.v.partier(0).out && !g.v.partier(1).out);
  const o = out();
  const me = g.v.partier(0);
  trails.draw(g.v, { tick: g.v.tick, t: playT(g) * TICK, dt: 0, now: 0, slot: 0, me, cam: [C, PLAT_Y + 10, C] }, o);
  for (let k = 0; k < o.scene.count * 16; k++) assert.ok(Number.isFinite(o.scene.data[k]), 'finite');
  assert.ok(o.paint && o.paint.n === st.side && o.paint.size === st.side * CS && o.paint.origin[0] === st.x0, 'the paint layer over the grid');
  const lit = o.paint.cells.reduce((n, c) => n + (c ? 1 : 0), 0);
  assert.equal(lit, cells(g).reduce((n, c) => n + (stateOf(c, playT(g)) ? 1 : 0), 0), 'a cell lit for each alive');
  assert.ok(lit > 30, `${lit} lit`);
  const walls = o.scene.count;
  const o2 = out();
  trails.draw(g.v, { tick: g.v.tick, t: (playT(g) + MC.LT_HARD) * TICK, pt: (playT(g) + MC.LT_HARD) * TICK, dt: 0, now: 0, slot: 0, me, cam: [C, PLAT_Y + 10, C] }, o2);
  assert.ok(o2.scene.count > walls + 3, `${walls} solids, then ${o2.scene.count} once the light hardens: walls of it near the ball`);
  // its own predicted light, soft and its own colour
  const own = paintLayer(g.v, st, playT(g), 0, [5]);
  assert.ok(own.cells[5] > 0);
  assert.deepEqual(trails.frame(g.v).shape, 'square');
  assert.equal(trails.facing(g.v, 0), Math.atan2(g.v.partier(0).pos[2] - C, g.v.partier(0).pos[0] - C), 'out from the middle');
  // the HUD
  const lines = [];
  const put2 = (y, s, c) => lines.push([y, s, c]);
  trails.hud(g.v, { put: (x, y, s, c) => put2(y, s, c), centre: put2, right: put2, rect: () => {}, rows: 44, C: {}, slot: 0, me: { ...me, vel: [0, 0, 0] }, now: 0, t: playT(g) * TICK });
  assert.ok(lines.some((l) => l[1].startsWith('LIGHT LASTS')) && lines.some((l) => l[1].startsWith('EDGES CLOSE IN')), lines.map((l) => l[1]).join(' | '));
  assert.ok(lines.some((l) => l[1].startsWith('KEEP ROLLING')), 'a still ball warned');
  for (const l of lines) assert.ok(l[1].length <= 60 && l[0] >= 2 && l[0] <= 6, l[1]);
  assert.ok(trails.hint.length <= 70);
  assert.equal(trails.env, 'night');
  // the brain: a wall across its way 3 m on, at 6 m/s: it turns; walled in close all round, it hops
  wipe(g);
  at(g, 3000);
  const T = playT(g), tick = g.v.tick;
  const bx = f(C - 5), bz = f(C);
  const [bi, bj] = cellOf(st, bx, bz);
  for (let j = bj - 30; j <= bj + 30; j++) cells(g)[j * st.side + bi + 6] = laid(T - 400, 1);
  put(g, 0, bx, bz, { vx: 6 });
  g.v._pbot = null;
  const bot = (skill) => ({ slot: 0, skill, mem: {}, pos: [bx, bz], vel: [6, 0], rand: () => 0.5 });
  assert.equal(trails.brain.danger(g.v, centre(st, bi + 6), bz, tick), 1, 'the wall');
  assert.equal(trails.brain.danger(g.v, C + st.half0 + 1, C, tick), 1, 'past the edge');
  assert.equal(trails.brain.danger(g.v, f(C - 10), f(C + 10), tick), 0, 'open floor');
  const p1 = plan(g.v, g.v.partier(0), bot(0.9), tick);
  assert.ok(Math.abs(Math.cos(p1.yaw)) < 0.75 && !p1.hop, `turns off the line: ${(p1.yaw * 180 / Math.PI).toFixed(0)} deg, ${p1.free} ticks clear`);
  // at 8 m/s in a box of light 2 m wide and 3.5 m long: it can brake (1.1 m) and turn back, but only to meet
  // the far side within a second; over the near one, a hop lands it in the open
  wipe(g);
  for (let d = -3; d <= 3; d++) {
    cells(g)[(bj - 2) * st.side + bi + d] = laid(T - 400, 1);
    cells(g)[(bj + 2) * st.side + bi + d] = laid(T - 400, 1);
  }
  for (let d = -2; d <= 2; d++) {
    cells(g)[(bj + d) * st.side + bi + 3] = laid(T - 400, 1);
    cells(g)[(bj + d) * st.side + bi - 3] = laid(T - 400, 1);
  }
  put(g, 0, bx, bz, { vx: 8 });
  const fast = { ...bot(1), vel: [8, 0] };
  const p2 = plan(g.v, g.v.partier(0), fast, tick);
  assert.ok(p2.free < 120, `walled in: ${p2.free} ticks`);
  assert.ok(p2.hop, 'hops');
  assert.ok(hopFree(st, gridOf(g.v), T, bx, bz, 8, 0, 6, C, 150) > 60, 'over it');
  assert.ok(hopFree(st, gridOf(g.v), T, bx, bz, 3, 0, 6, C, 150) < 80, 'at 3 m/s it would come down on it');
  const w = trails.brain.think(g.v, g.v.partier(0), { ...bot(1), vel: [8, 0] }, tick);
  assert.deepEqual([w.move, w.hop], [1, 1]);
});
