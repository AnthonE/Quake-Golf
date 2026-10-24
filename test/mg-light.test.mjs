import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty, partyBytes, predicted } from './helpers.mjs';
import { View, partyWord, PLAT_Y } from '../src/party-view.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { playParty } from '../tools/genparty.mjs';
import * as L from '../src/layout.mjs';
import light, { stage, when, phaseOf, fateOf, greenOf, redOf, startOf, peekOf } from '../client/mg/light.mjs';

const C = L.B_CX;
const TICK = 0.008;
const IDLE = Math.fround(L.RL_IDLE);
const FWD = partyWord({ yaw: 12288, move: 1 }); // toward -z, the finish
const NONE = partyWord({ yaw: 12288 });

// A room of n balls on Red Light, on the debug build (a NaN traps), stepped into play unless asked not to.
async function room(n = 2, { play = true, seed = 7 } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_LIGHT + 1, true);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); assert.equal(sim.error().code, 0, 'no trap'); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  while (play && v.hole().state !== L.H_PLAY) step();
  return { sim, v, dv, step };
}
const rec = (p) => L.PLAYERS + p * L.PSIZE;
// Ball p on the floor at (x, z), rolling at (vx, vz).
function put(g, p, x, z, { vx = 0, vz = 0 } = {}) {
  g.dv.setFloat32(rec(p) + L.P_PX, x, true);
  g.dv.setFloat32(rec(p) + L.P_PY, PLAT_Y, true);
  g.dv.setFloat32(rec(p) + L.P_PZ, z, true);
  g.dv.setFloat32(rec(p) + L.P_VX, vx, true);
  g.dv.setFloat32(rec(p) + L.P_VY, 0, true);
  g.dv.setFloat32(rec(p) + L.P_VZ, vz, true);
  g.dv.setUint8(rec(p) + L.P_FL, L.PF_LIVE | L.PF_GROUND);
}
// The next step plays tick t into play (the clock moved, the round's end with it).
function at(g, t) {
  const now = g.v.tick;
  g.dv.setUint32(L.HDR_START, now - t, true);
  g.dv.setUint32(L.HDR_UNTIL, now - t + L.RL_LEN, true);
}
const playT = (g) => g.v.party().t; // the tick into play the next step plays
const fxs = (v, kind) => { const out = []; for (let k = 0; k < v.fxCount(); k++) { const f = v.fx(k); if (f.kind === kind) out.push(f); } return out; };
// How far a ball at z has got, as $rl_progress has it: cm from the back wall.
const progress = (st, z) => Math.max(0, Math.min(L.RL_SCORE_MAX, Math.trunc(Math.fround(Math.fround(st.zb - z) * 100))));
// A cycle of the round whose green is at least `len` ticks.
const longGreen = (st, len, from = 1) => { let c = from; while (greenOf(st, c) < len) c++; return c; };

test('the field for 1, 8, 64 and 256: wider for a crowd, the balls on a grid behind the start line, apart, inside the rails', async () => {
  let last = 0;
  for (const n of [1, 8, 64, 256]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party();
    const st = stage(g.v);
    assert.equal(r.game, L.MG_LIGHT);
    const hw = Math.fround(Math.min(L.RL_W0 + L.RL_WK * n, L.RL_WMAX) * 0.5);
    assert.equal(st.hw, hw, `${n}: half-width`);
    assert.ok(hw >= last, 'wider with the crowd');
    last = hw;
    assert.deepEqual([r.kind, r.len, r.idle, r.drag, r.hop, r.respawn, r.size], [L.PK_SCORE, L.RL_LEN, IDLE, Math.fround(Number(L.BPHYS.B_DRAG)), 0, 0x7fffffff, hw]);
    assert.deepEqual([st.zs, st.zf], [C + L.RL_FIELD / 2, C - L.RL_FIELD / 2]);
    const f = Math.fround, cols = Math.trunc(f(f(f(hw + hw) - f(2 * L.RL_EDGE)) / f(L.RL_SP))) + 1, rows = Math.ceil(n / cols);
    assert.equal(st.cols, cols);
    assert.ok(Math.abs(st.zb - (st.zs + 2 * L.RL_GRID0 + (rows - 1) * L.RL_SP)) < 1e-3, `${n}: the back wall behind ${rows} rows`);
    const spots = [];
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p);
      assert.equal(b.pos[1], PLAT_Y);
      assert.ok(Math.abs(b.pos[0] - C) <= hw - L.RL_EDGE + 1e-3, `${n}: P${p + 1} inside the rails`);
      assert.ok(b.pos[2] >= st.zs + L.RL_GRID0 - 1e-3 && b.pos[2] <= st.zb - L.RL_GRID0 + 1e-3, `${n}: P${p + 1} on the grid`);
      spots.push(b.pos);
    }
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      assert.ok(Math.hypot(spots[a][0] - spots[b][0], spots[a][2] - spots[b][2]) >= L.RL_SP - 1e-3, `${n}: P${a + 1} and P${b + 1} apart`);
    }
    if (n === 1) assert.deepEqual([spots[0][0], spots[0][2]], [C, Math.fround(st.zs + L.RL_GRID0)]);
    // the first row is full and centred on the field
    const front = spots.filter((s) => Math.abs(s[2] - (st.zs + L.RL_GRID0)) < 1e-3);
    assert.equal(front.length, Math.min(n, cols));
    assert.ok(Math.abs(front.reduce((a, s) => a + s[0], 0) / front.length - C) < 1e-3);
  }
});

test('the grid puts the fewest party points in front: a newcomer in the countdown lays it out again', async () => {
  const g = await room(29, { play: false });
  for (let p = 0; p < 29; p++) g.dv.setUint16(rec(p) + L.PG_PTS, p % 2 ? 40 + p : p, true);
  g.step([[L.EV_JOIN, 29]]);
  const st = stage(g.v);
  assert.equal(g.v.party().n0, 30);
  assert.ok(st.cols < 30 && st.cols >= 15, `${st.cols} a row`);
  const z = (p) => g.v.partier(p).pos[2];
  const front = Math.fround(st.zs + L.RL_GRID0);
  // the newcomer's 0 and the evens' few points fill the front row from the fewest; the rest behind
  const order = [...Array(30).keys()].sort((a, b) => g.v.partier(a).pts - g.v.partier(b).pts);
  order.forEach((p, k) => {
    if (k < st.cols) assert.equal(z(p), front, `P${p + 1} (${g.v.partier(p).pts} points) in front`);
    else assert.ok(z(p) > front, `P${p + 1} (${g.v.partier(p).pts} points) behind`);
  });
  assert.equal(z(29), front, 'the newcomer, with none');
  assert.ok(z(1) > front, 'P2, with 41');
});

test('the lights: green (now and then a peek) then red, their lengths from the round\'s seed; the JS mirror is the sim\'s: a ball rolling flat out is caught on the tick red looks, not before', async () => {
  for (const seed of [7, 8, 1234]) {
    const g = await room(3, { seed });
    const st = stage(g.v);
    assert.ok(greenOf(st, 0) >= L.RL_G0A && greenOf(st, 0) < L.RL_G0A + L.RL_G0N);
    let peeks = 0;
    for (let c = 1; c < 40; c++) {
      const g0 = greenOf(st, c);
      if (g0 < L.RL_GA) { assert.ok(c >= L.RL_PEEK0 && g0 >= L.RL_PA && g0 < L.RL_PA + L.RL_PN, `a peek, ${g0} ticks`); assert.ok(peekOf(st, c)); peeks++; }
      else assert.ok(g0 < L.RL_GA + L.RL_GN);
      assert.ok(g0 >= L.RL_PA + 0 && g0 > L.RL_TURN + 40, 'long enough for her to turn away and back');
      assert.ok(redOf(st, c) >= L.RL_RA && redOf(st, c) < L.RL_RA + L.RL_RN);
      assert.equal(startOf(st, c + 1) - startOf(st, c), greenOf(st, c) + redOf(st, c));
    }
    assert.ok(peeks >= 3 && peeks <= 20, `${peeks} peeks in 40 greens`);
    // P1 flat out from the start: through the first green, the turn and red's grace, caught as it looks
    put(g, 0, C, st.zs, { vz: -10 });
    g.step([[L.EV_INPUT, 0, FWD]]);
    const start = g.v.party().start;
    const w = when(st, 0);
    assert.deepEqual([w.c, w.s, w.r0, w.j, w.w], [0, 0, greenOf(st, 0), greenOf(st, 0) + L.RL_GRACE, greenOf(st, 0) - L.RL_TURN]);
    assert.equal(phaseOf(w, w.w - 1), 'green');
    assert.equal(phaseOf(w, w.w), 'turn');
    assert.equal(phaseOf(w, w.r0), 'grace');
    assert.equal(phaseOf(w, w.j), 'red');
    while (!g.v.partier(0).out) { assert.ok(playT(g) <= w.j, 'not caught before red looks'); g.step(); }
    const b = g.v.partier(0);
    assert.equal((b.outAt - start) | 0, w.j, `seed ${seed}: caught as red looks`);
    assert.ok(!g.v.partier(1).out && !g.v.partier(2).out, 'the still ones aren\'t');
    // and in a later cycle too: P2 rolls on from that red's end, flat out, and is caught as the next looks
    const w1 = when(st, startOf(st, 1));
    at(g, w1.s);
    put(g, 1, C + 5, st.zs, { vz: -10 });
    g.step([[L.EV_INPUT, 1, FWD]]);
    while (!g.v.partier(1).out) g.step();
    assert.equal((g.v.partier(1).outAt - g.v.party().start) | 0, w1.j, `seed ${seed}: the second cycle's look`);
    // and through a peek: the green over almost as it starts
    let c = L.RL_PEEK0;
    while (!peekOf(st, c)) c++;
    const wp = when(st, startOf(st, c));
    at(g, wp.s);
    put(g, 2, C - 5, st.zs, { vz: -10 });
    g.step([[L.EV_INPUT, 2, FWD]]);
    while (!g.v.partier(2).out) g.step();
    assert.equal((g.v.partier(2).outAt - g.v.party().start) | 0, wp.j, `seed ${seed}: a peek's look`);
  }
});

test('on red, faster than RL_VMAX across the ground is caught; slower, or still, or anything through the grace, isn\'t', async () => {
  const g = await room(6);
  const st = stage(g.v);
  const w = when(st, startOf(st, 2));
  at(g, w.j - 1);
  // speeds as they'll be after this tick's brake (no keys): just over, just under, slow, still
  const x = (p) => C - 12 + 4.5 * p;
  put(g, 0, x(0), C, { vx: 1.25 / IDLE });
  put(g, 1, x(1), C, { vz: -1.15 / IDLE });
  put(g, 2, x(2), C, { vx: 0.6, vz: 0.6 });
  put(g, 3, x(3), C);
  put(g, 4, x(4), C, { vz: 9 });
  g.step();
  assert.equal(playT(g), w.j, 'the grace\'s last tick played');
  assert.deepEqual([0, 1, 2, 3, 4].map((p) => g.v.partier(p).out), [false, false, false, false, false], 'nobody is caught in the grace');
  put(g, 0, x(0), C, { vx: 1.25 / IDLE });
  put(g, 1, x(1), C, { vz: -1.15 / IDLE });
  put(g, 4, x(4), C, { vz: -1.3 / IDLE, vx: 0.3 });
  const before = g.v.fxCount();
  g.step();
  assert.deepEqual([0, 1, 2, 3, 4].map((p) => g.v.partier(p).out), [true, false, false, false, true]);
  const tick = g.v.tick - 1;
  for (const p of [0, 4]) {
    const b = g.v.partier(p);
    assert.deepEqual([b.vel[0], b.vel[1], b.vel[2]], [0, 0, 0], 'stopped where it was caught');
    assert.equal(b.outAt, tick);
    assert.deepEqual(fateOf(b.m), { kind: 'caught', n: 2 });
    assert.equal(b.score, progress(st, b.pos[2]));
    const f = fxs(g.v, L.RL_FX_CAUGHT).find((e) => e.owner === p);
    assert.ok(f && g.v.fxCount() > before);
    assert.deepEqual([f.tick, f.shot, f.pos[0], f.pos[2]], [tick, 255, b.pos[0], b.pos[2]]);
    assert.ok(Math.abs(f.size - (b.pos[2] - st.zf)) < 1e-3, 'm it had to go');
  }
  assert.equal(g.dv.getUint32(L.PG_H + L.RL_OUT, true), 2);
  // all through the red the slow ones stay in; then green again
  while (playT(g) < w.e + 5) { g.step(); for (const p of [1, 2, 3]) assert.ok(!g.v.partier(p).out); }
  assert.equal(g.v.hole().state, L.H_PLAY);
});

test('bumped into moving on red: caught, and a KO for the ball that did it', async () => {
  const g = await room(3);
  const st = stage(g.v);
  const w = when(st, startOf(st, 1));
  at(g, w.r0);
  // P2 brakes too late in the grace and runs into P1, still, bouncing off slow; P3 far off, still
  put(g, 0, C, C);
  put(g, 1, C, C + 2.6, { vz: -8 });
  put(g, 2, C + 10, C);
  let n = 0;
  while (!g.v.partier(0).out && n++ < 200) g.step();
  const a = g.v.partier(0), b = g.v.partier(1);
  assert.ok(a.out, 'P1 caught');
  assert.equal((a.outAt - g.v.party().start) | 0, w.j, 'as red looked');
  const f = fxs(g.v, L.RL_FX_CAUGHT).find((e) => e.owner === 0);
  assert.equal(f.shot, 1, 'P2 bumped it');
  assert.equal(b.kos, 1, 'a KO for P2');
  assert.ok(!g.v.partier(2).out);
});

test('while she looks the balls don\'t bump: one creeping into another, both slower than RL_VMAX, kicks neither into being caught; bumps are back with the green', async () => {
  const g = await room(3);
  const st = stage(g.v);
  const w = when(st, startOf(st, 1));
  at(g, w.j + 2);
  put(g, 0, C, C);
  put(g, 1, C, C + 2.2, { vz: -1.1 });
  put(g, 2, C + 10, C);
  for (let k = 0; k < 60; k++) {
    g.step();
    assert.equal(g.v.party().flags & L.PGF_BUMPS, 0, 'no bumps through the look');
    // P2 creeps on and stops; held back by IDLE, under the limit all the way
    assert.ok(!g.v.partier(0).out && !g.v.partier(1).out, `nobody caught ${k} ticks in`);
  }
  assert.ok(g.v.partier(1).pos[2] - g.v.partier(0).pos[2] < 2, 'it crept into P1, no kick');
  while (playT(g) < w.e) g.step();
  assert.equal(g.v.party().flags & L.PGF_BUMPS, L.PGF_BUMPS, 'on again for the green');
  g.step();
  assert.ok(g.v.partier(1).pos[2] - g.v.partier(0).pos[2] >= 2 - 1e-3, 'and the two pushed apart');
});

test('on red a bump has no kick: two balls all but still that touch in the grace just trade their speeds, neither caught; a kick again with the green', async () => {
  for (const k of [10, 20, 40]) {
    const g = await room(3);
    const st = stage(g.v);
    const w = when(st, startOf(st, 1));
    at(g, w.r0 + k - 1);
    g.step();
    assert.equal(g.v.party().flags, L.PGF_BUMPS | L.PGF_NOKICK, 'bumps, no kick');
    // P1 braking ahead, P2 a little faster just behind it: they touch on the next tick or so
    put(g, 0, C, C, { vz: -0.5 });
    put(g, 1, C, C + 2.0005, { vz: -0.55 });
    put(g, 2, C + 10, C);
    while (playT(g) < w.j + 30) {
      g.step();
      assert.ok(!g.v.partier(0).out && !g.v.partier(1).out, `nobody caught, touching ${k} ticks into red`);
    }
    assert.equal(g.v.partier(0).hitBy, 1, 'they touched');
    assert.deepEqual([0, 1].map((p) => g.v.partier(p).kos), [0, 0]);
    while (playT(g) < w.e) g.step();
    assert.equal(g.v.party().flags, L.PGF_BUMPS, 'the kick back with the green');
  }
});

test('the pen holds every finisher on the yard\'s floor however many there are: RL_PROWS rows of the grid\'s width, as many of one fewer in their gaps, then round again', async () => {
  const g = await room(2);
  const st = stage(g.v);
  assert.equal(st.cols, 12, 'the narrowest field');
  at(g, startOf(st, longGreen(st, 400)) + 20);
  const spots = [];
  for (let k = 0; k < 400; k++) {
    g.dv.setUint32(L.PG_H + L.RL_FIN, k, true);
    put(g, 0, C, st.zf + 0.05, { vz: -10 });
    g.step([[L.EV_INPUT, 0, k & 1 ? FWD : NONE]]);
    const b = g.v.partier(0);
    assert.ok(b.out && fateOf(b.m).n === k + 1, `finisher ${k + 1}`);
    assert.ok(b.pos[2] >= st.zf - L.RL_YARD + 1 - 1e-3 && b.pos[2] <= st.zf - L.RL_PEN0 + 1e-3, `finisher ${k + 1} in the yard: ${(st.zf - b.pos[2]).toFixed(1)} m past the line`);
    assert.ok(Math.abs(b.pos[0] - C) <= st.hw - 1 + 1e-3, `finisher ${k + 1} inside the rails`);
    spots.push([b.pos[0], b.pos[2]]);
  }
  const cap = L.RL_PROWS * (2 * st.cols - 1);
  assert.ok(cap >= L.NPLAYER && cap < 400);
  for (let i = 0; i < cap; i++) for (let j = i + 1; j < cap; j++) {
    const d = Math.hypot(spots[i][0] - spots[j][0], spots[i][1] - spots[j][1]);
    const one = (i < L.RL_PROWS * st.cols) === (j < L.RL_PROWS * st.cols);
    assert.ok(d >= (one ? L.RL_SP : L.RL_SP * 0.7) - 1e-3, `spots ${i} and ${j} ${d.toFixed(2)} m apart`);
  }
  assert.deepEqual(spots[cap], spots[0], 'round again');
  assert.equal(g.v.hole().state, L.H_PLAY, 'P2 still racing');
});

test('over the line: out of play into the pen, placed by the order they crossed in (balls over on one tick share it); the first leaves the rest RL_RUSH', async () => {
  const g = await room(4);
  const st = stage(g.v);
  const c = longGreen(st, 400);
  at(g, startOf(st, c) + 20);
  put(g, 0, C, st.zf + 0.05, { vz: -10 });
  g.step([[L.EV_INPUT, 0, FWD]]);
  let b = g.v.partier(0);
  const tick = g.v.tick - 1;
  assert.ok(b.out, 'out of play');
  assert.deepEqual([b.score, fateOf(b.m).kind, fateOf(b.m).n, b.outAt], [L.RL_SCORE_FIN, 'fin', 1, tick]);
  assert.deepEqual([b.vel[0], b.vel[1], b.vel[2], b.pos[1]], [0, 0, 0, PLAT_Y]);
  assert.ok(b.pos[2] < st.zf - L.RL_PEN0 + 1e-3 && Math.abs(b.pos[0] - C) < st.hw, 'in the pen past the line');
  const f = fxs(g.v, L.RL_FX_FINISH)[0];
  assert.deepEqual([f.owner, f.shot, f.tick], [0, 1, tick]);
  assert.ok(Math.abs(f.size - (startOf(st, c) + 20) * TICK) < 1e-3, 'its time');
  assert.equal(g.v.hole().until, tick + L.RL_RUSH, 'the clock cut');
  // two over on one tick share 2nd, a spot each in the pen
  put(g, 1, C - 3, st.zf + 0.05, { vz: -10 });
  put(g, 2, C + 3, st.zf + 0.05, { vz: -10 });
  g.step([[L.EV_INPUT, 1, FWD], [L.EV_INPUT, 2, FWD]]);
  const p1 = g.v.partier(1), p2 = g.v.partier(2);
  assert.deepEqual([p1.score, p2.score, fateOf(p1.m).n, fateOf(p2.m).n], [L.RL_SCORE_FIN - 1, L.RL_SCORE_FIN - 1, 2, 2]);
  b = g.v.partier(0);
  const spots = [b.pos, p1.pos, p2.pos];
  for (let i = 0; i < 3; i++) for (let k = i + 1; k < 3; k++) assert.ok(Math.hypot(spots[i][0] - spots[k][0], spots[i][2] - spots[k][2]) >= L.RL_SP - 1e-3);
  assert.equal(g.dv.getUint32(L.PG_H + L.RL_FIN, true), 3);
  assert.equal(g.v.hole().until, tick + L.RL_RUSH, 'cut once');
  assert.equal(g.v.hole().state, L.H_PLAY, 'P4 still racing');
});

test('the end: nobody racing ends it; finishers by their order, then the rest by how far they got; points 10 down to 1', async () => {
  const g = await room(4);
  const st = stage(g.v);
  const w = when(st, startOf(st, 1));
  // P3 caught 100 m out, P2 caught 50 m out (on red), P1 over first, P4 over second
  at(g, w.j + 5);
  put(g, 2, C - 6, st.zf + 100, { vz: -5 });
  put(g, 1, C + 6, st.zf + 50, { vx: 5 });
  g.step();
  assert.ok(g.v.partier(1).out && g.v.partier(2).out);
  at(g, startOf(st, 2) + 10);
  put(g, 0, C, st.zf + 0.05, { vz: -10 });
  g.step([[L.EV_INPUT, 0, FWD]]);
  assert.equal(g.v.hole().state, L.H_PLAY);
  put(g, 3, C + 2, st.zf + 0.05, { vz: -10 });
  g.step([[L.EV_INPUT, 3, FWD]]);
  const r = g.v.party();
  assert.equal(r.state, L.H_OVER, 'nobody racing: over');
  assert.equal(r.winner, 0);
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.partier(p).place), [1, 3, 4, 2]);
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.partier(p).pts), [10, 4, 1, 7]);
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.partier(p).wins), [1, 0, 0, 0]);
});

test('the clock\'s end: the balls still racing scored by how far they got, a ball caught near the line above them', async () => {
  const g = await room(3);
  const st = stage(g.v);
  const w = when(st, startOf(st, 1));
  at(g, w.j + 5);
  put(g, 0, C, st.zf + 20, { vz: -5 });
  put(g, 1, C + 5, st.zf + 60);
  put(g, 2, C - 5, st.zf + 120);
  g.step();
  assert.ok(g.v.partier(0).out && !g.v.partier(1).out && !g.v.partier(2).out);
  assert.deepEqual([g.v.partier(1).score, g.v.partier(2).score], [0, 0], 'kept out of their records while they race');
  g.dv.setUint32(L.HDR_UNTIL, g.v.tick, true);
  g.step();
  const r = g.v.party();
  assert.equal(r.state, L.H_OVER);
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).place), [1, 2, 3]);
  assert.equal(g.v.partier(1).score, progress(st, g.v.partier(1).pos[2]));
  assert.equal(r.winner, 0, 'the furthest wins, caught or not');
});

test('the rails, the back wall and the yard\'s end keep every ball on the field', async () => {
  const g = await room(4);
  const st = stage(g.v);
  const c = longGreen(st, 600, 0);
  at(g, startOf(st, c));
  put(g, 0, C + st.hw - 3, C, { vx: 10 });
  put(g, 1, C - st.hw + 3, C - 20, { vx: -10 });
  put(g, 2, C, st.zb - 3, { vz: 10 });
  put(g, 3, C + 8, st.zf - L.RL_YARD + 3, { vz: -10 });
  g.step([[L.EV_INPUT, 0, partyWord({ yaw: 0, move: 1 })], [L.EV_INPUT, 1, partyWord({ yaw: 8192, move: 1 })], [L.EV_INPUT, 2, partyWord({ yaw: 4096, move: 1 })]]);
  for (let k = 0; k < 120; k++) {
    for (let p = 0; p < 3; p++) {
      const b = g.v.partier(p);
      assert.ok(b.ground && Math.abs(b.pos[0] - C) <= st.hw - 1 + 1e-3 && b.pos[2] <= st.zb - 1 + 1e-3, `P${p + 1} on the field`);
    }
    g.step();
  }
  assert.equal(g.v.partier(0).pos[0], Math.fround(C + Math.fround(st.hw - 1)), 'against the right rail');
  assert.equal(g.v.partier(1).pos[0], Math.fround(C - Math.fround(st.hw - 1)), 'against the left');
  assert.equal(g.v.partier(2).pos[2], Math.fround(st.zb - 1), 'against the back wall');
  // the yard's end (a ball the prediction rolls on over the line meets it); in the confirmed world it's over the line
  assert.ok(g.v.partier(3).out && fateOf(g.v.partier(3).m).kind === 'fin');
});

test('the prediction matches the confirmed ball bit for bit: into a rail, along it, braking through the turn and the red, off again, into the back wall', async () => {
  const g = await room(3);
  const st = stage(g.v);
  // A: a long green, flat out into the right rail at an angle, along it; let go 150 ticks before red, through it, rolling again
  const c = longGreen(st, 450);
  const w = when(st, startOf(st, c));
  at(g, w.s);
  put(g, 0, C + st.hw - 6, C + 40);
  put(g, 1, C - 10, C + 40);
  put(g, 2, C - 10, C + 60);
  const into = Array(250).fill(partyWord({ yaw: 12288 + 1500, move: 1 }));
  assert.ok(predicted(g, into) >= into.length);
  assert.ok(Math.abs(g.v.partier(0).pos[0] - (C + st.hw - 1)) < 0.3, 'up against the rail');
  const words = [];
  for (let k = 250; k < w.r0 - w.s - 150; k++) words.push(FWD);
  for (let k = w.r0 - w.s - 150; k < w.e - w.s; k++) words.push(NONE);
  for (let k = 0; k < 60; k++) words.push(FWD);
  assert.ok(predicted(g, words) >= words.length);
  assert.ok(!g.v.partier(0).out, 'stopped in time, not caught');
  // B: from the first green, backward and across into the back wall's corner, then on down the field
  at(g, 30);
  put(g, 0, C - st.hw + 4, st.zb - 3);
  const back = [...Array(150).fill(partyWord({ yaw: 4096 + 1500, move: 1 })), ...Array(150).fill(FWD)];
  assert.ok(predicted(g, back) >= back.length);
  assert.ok(!g.v.partier(0).out);
});

test('a ball joining in play comes in at the back and races', async () => {
  const g = await room(3);
  for (let k = 0; k < 50; k++) g.step();
  g.step([[L.EV_JOIN, 5]]);
  const st = stage(g.v);
  let b = g.v.partier(5);
  assert.ok(b.live && !b.out && !b.ground, 'falling in');
  for (let k = 0; k < 200 && !g.v.partier(5).ground; k++) g.step();
  b = g.v.partier(5);
  assert.ok(b.ground && !b.out && fateOf(b.m).kind === 'racing');
  assert.ok(b.pos[2] > st.zs && b.pos[2] <= st.zb && Math.abs(b.pos[0] - C) <= st.hw, 'behind the start line');
});

for (const [bots, ticks] of [[8, 8000], [64, 8000]]) {
  test(`a round of ${bots} AI balls on the debug build: no trap, most over the line, some caught, everyone placed; equal on 1 and 4 threads`, async () => {
    let start = -1, over = -1, places = null, pts = null, fates = null, winner = -1, caught = 0, finished = 0, seen = 0;
    const r = await playParty({ bytes: partyBytes(true), seed: bots, mg: L.MG_LIGHT, bots, ticks, delay: 8, onTick: (t, sim, v) => {
      assert.equal(sim.error().code, 0, 'no trap');
      const g = v.party();
      for (; seen < v.fxCount(); seen++) { const f = v.fx(seen); caught += f.kind === L.RL_FX_CAUGHT; finished += f.kind === L.RL_FX_FINISH; }
      if (start < 0 && g.state === L.H_PLAY) start = t;
      if (over < 0 && start >= 0 && g.state === L.H_OVER) {
        over = t;
        winner = g.winner;
        places = [...Array(bots).keys()].map((p) => v.partier(p).place);
        pts = [...Array(bots).keys()].map((p) => v.partier(p).pts);
        fates = [...Array(bots).keys()].map((p) => fateOf(v.partier(p).m).kind);
      }
    } });
    assert.ok(over > 0, 'the round ended');
    const secs = (over - start) * TICK;
    assert.ok(secs > 20 && secs < L.RL_LEN * TICK, `${secs.toFixed(1)} s of play`);
    assert.ok(finished >= bots / 2, `${finished} of ${bots} over the line`);
    if (bots >= 64) assert.ok(caught >= 3, `${caught} caught`);
    assert.ok(fates.every((k) => k !== 'racing') || secs > 89, 'everyone over or caught, or the clock');
    assert.ok(places.every((x) => x >= 1 && x <= bots), `places ${places}`);
    assert.ok(pts.every((x) => x >= 1 && x <= 10), `points ${pts}`);
    assert.ok(winner >= 0 && winner < bots && places[winner] === 1 && fates[winner] === 'fin', 'the first over won');
    const parsed = parseLog(r.log);
    const n = over + 50;
    const a = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 1, tag: 't1' });
    const b = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 4, tag: 't4', startWorkers });
    const d = await replay({ bytes: partyBytes(true), log: parsed, ticks: n, threads: 1, tag: 'd1' });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(d.trace).tickHashes], 'the debug build steps the same bits');
  });
}

test('the client module: draws the countdown, every light and the result, frames the field, writes its HUD lines; its brain lets go in time', async () => {
  const { Scene } = await import('../client/party-render.mjs');
  const g = await room(3, { seed: 41, play: false });
  const out = () => ({ scene: new Scene(24000), solid: [], glow: [], beams: [], decals: [], casters: [], paint: null });
  const lines = [];
  const hctx = (now) => ({ put: (x, y, s, c) => lines.push([y, s, c]), centre: (y, s, c) => lines.push([y, s, c]), right: (y, s, c) => lines.push([y, s, c]), rect: () => {}, rows: 44, C: {}, slot: 0, now });
  // the countdown: the doll stares, the light red
  let o = out();
  light.draw(g.v, { tick: g.v.tick, dt: 0, now: 1, slot: 0 }, o);
  assert.ok(o.scene.count > 100, `${o.scene.count} solids`);
  while (g.v.hole().state !== L.H_PLAY) g.step();
  const st = stage(g.v);
  const fr = light.frame(g.v);
  assert.equal(fr.shape, 'square');
  assert.ok(Math.abs(fr.radius - (st.zb - st.zf + L.RL_YARD) / 2) < 1e-3);
  assert.equal(light.facing(), -Math.PI / 2);
  const w = when(st, startOf(st, 1));
  const caught = [];
  for (const [t, ph, words] of [[w.s + 5, 'green', 'GREEN LIGHT'], [w.w + 10, 'turn', 'TURNING'], [w.r0 + 5, 'grace', 'RED LIGHT'], [w.j + 20, 'red', 'RED LIGHT']]) {
    at(g, t);
    if (ph === 'red') { put(g, 1, C, C, { vx: 6 }); caught.push(1); }
    g.step();
    o = out();
    lines.length = 0;
    const now = t * 8;
    light.draw(g.v, { tick: g.v.tick, dt: 0, now, slot: 0, ptick: g.v.tick, pme: g.v.partier(0), pview: g.v }, o);
    assert.equal(phaseOf(when(st, playT(g) - 1), playT(g) - 1), ph);
    for (let k = 0; k < o.scene.count * 16; k++) assert.ok(Number.isFinite(o.scene.data[k]), 'finite');
    assert.equal(o.music, ph === 'green' || ph === 'turn', 'the music while she sings');
    if (ph === 'red') assert.ok(o.beams.length >= 2, 'her eyes sweep the field');
    light.hud(g.v, hctx(now));
    const text = lines.map((l) => l[1]).join(' | ');
    assert.ok(text.includes(words), text);
    assert.ok(text.includes('M TO GO') && text.includes('RACING'), text);
    for (const l of lines) assert.ok(l[1].length <= 80, l[1]);
  }
  // the caught ball drawn grey where it stopped (the frontend draws no ball out)
  assert.ok(g.v.partier(1).out);
  o = out();
  light.draw(g.v, { tick: g.v.tick, dt: 0, now: 0, slot: 0 }, o);
  assert.ok(o.solid.some((s) => s.kind === 0 && s.color[0] < 0.5 && Math.abs(s.pos[0] - g.v.partier(1).pos[0]) < 1e-3), 'grey ball');
  assert.ok(light.hint.length <= 70 && light.rules.length <= 70 && light.ownScore);
  // the brain: flat out on a long green it rolls on, and lets go in time to be still when red looks
  const c = longGreen(st, 500);
  const wc = when(st, startOf(st, c));
  const bot = { slot: 0, skill: 1, mem: {}, rand: () => 0.99, pos: [C, C + 40], vel: [0, -10] };
  at(g, wc.s + 100);
  g.step();
  const T = g.v.party().start;
  put(g, 0, C, C + 40, { vz: -10 });
  assert.equal(light.brain.think(g.v, 0, bot, T + wc.s + 100).move, 1, 'rolls on early in the green');
  const off = [];
  for (let t = wc.s + 100; t < wc.j; t += 4) if (light.brain.think(g.v, 0, bot, T + t).move === 0) { off.push(t); break; }
  assert.ok(off.length && wc.j - off[0] >= Math.log(L.RL_VMAX / 10) / Math.log(IDLE) && wc.j - off[0] < 130, `let go ${wc.j - off[0]} ticks before red looks`);
  assert.equal(light.brain.think(g.v, 0, bot, T + wc.j + 10).move, 0, 'no keys on red');
  // having let go this green, it still pushes off from rest in red's last 10 ticks, for the next green
  put(g, 0, C, C + 40);
  assert.equal(light.brain.think(g.v, 0, bot, T + wc.e - 11).move, 0, 'no keys on red');
  for (let t = wc.e - 10; t < wc.e; t++) assert.equal(light.brain.think(g.v, 0, bot, T + t).move, 1, `a push ${wc.e - t} ticks before the green`);
  assert.equal(light.brain.danger(g.v, C, C, T), 0);
  assert.equal(light.brain.danger(g.v, C + st.hw + 1, C, T), 1);
  assert.equal(light.brain.hop(), false);
});
