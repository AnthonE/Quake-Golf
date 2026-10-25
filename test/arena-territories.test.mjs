import test from 'node:test';
import assert from 'node:assert/strict';
import { arenaBytes } from './helpers.mjs';
import { View, arenaWord, forcedSeed } from '../src/arena-view.mjs';
import { aimAt } from '../client/bot.mjs';
import { playArena } from '../tools/genarena.mjs';
import { compileMap } from '../tools/map.mjs';
import { replay, parseLog, decodeTrace, newMemory, instantiate, Sim } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { AMC, SIDE_RGB } from '../client/am/index.mjs';
import { territories, push, deal, onIt, thin } from '../client/am/territories.mjs';
import { Fighter } from '../client/arena-bot.mjs';
import { C } from '../client/font.mjs';
import * as L from '../src/layout.mjs';
import * as AC from '../src/am/consts.mjs';

// Territories (src/am/territories.wat, client/am/territories.mjs). Helpers as
// test/arena-hill.test.mjs has them; the territories read straight from
// their fields in AO.

// A room on the debug build: n fighters in, stepped to play (and one tick of
// it), or with count only to the countdown. mode forces every match through
// the seed.
let debugModule = null;
async function room(mode, n = 2, seed = 7, { count = false } = {}) {
  debugModule ||= await WebAssembly.compile(arenaBytes(true));
  const memory = newMemory();
  const sim = new Sim(await instantiate(debugModule, memory), memory);
  sim.init(forcedSeed(mode, seed));
  const v = new View(sim.memory.buffer);
  const dv = new DataView(sim.memory.buffer);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  if (count) return { sim, v, dv, step, n };
  while (v.hole().state !== L.H_PLAY) step();
  step();
  return { sim, v, dv, step, n };
}

const rec = (p) => L.PLAYERS + p * L.PSIZE;
const fl = (g, p) => g.sim.u8[rec(p) + L.P_FL];
const team = (g, p) => (fl(g, p) & L.PF_BLUE ? 1 : 0);
const u32 = (g, a) => g.dv.getUint32(a, true);
const scores = (g) => [u32(g, L.AH_SCORE), u32(g, L.AH_SCORE + 4)];
const sides = (g, slots) => slots.map((p) => team(g, p));
const points = (g, slots) => slots.map((p) => g.v.fighter(p).points);
const auxes = (g, slots) => slots.map((p) => g.v.fighter(p).aux);
const MAP = compileMap();
const FEET = [19.69, 25.8, 23.4, 21, 25.8, 23.4]; // where each of Blood Gulch's hill points stands (test/map.test.mjs)
const CAP = AC.TR_CAP;

function put(g, p, x, z, y = g.v.height(x, z)) {
  g.dv.setFloat32(rec(p) + L.P_PX, x, true);
  g.dv.setFloat32(rec(p) + L.P_PY, y, true);
  g.dv.setFloat32(rec(p) + L.P_PZ, z, true);
  for (const o of [L.P_VX, L.P_VY, L.P_VZ]) g.dv.setFloat32(rec(p) + o, 0, true);
}

// p's two guns, full, with no reload or burst under way
function loadout(g, p, w0, w1 = w0) {
  g.dv.setUint8(rec(p) + L.A_GUN, w0); g.dv.setUint8(rec(p) + L.A_GUN + 1, w1);
  g.dv.setUint8(rec(p) + L.A_MAG, L.ARMS[w0].mag); g.dv.setUint8(rec(p) + L.A_MAG + 1, L.ARMS[w1].mag);
  g.dv.setUint16(rec(p) + L.A_RES, L.ARMS[w0].res, true); g.dv.setUint16(rec(p) + L.A_RES + 2, L.ARMS[w1].res, true);
  g.dv.setUint8(rec(p) + L.A_RELOAD, 0); g.dv.setUint8(rec(p) + L.A_BURST, 0);
}

// p's word aimed at q's body at height h
function aim(g, p, q, h, rest = {}) {
  const a = g.v.fighter(p), b = g.v.fighter(q);
  const { yaw, pitch } = aimAt([a.pos[0], a.pos[1] + 1.6, a.pos[2]], [b.pos[0], b.pos[1] + h, b.pos[2]]);
  return arenaWord({ yaw, pitch, ...rest });
}
const still = (g, p) => { const f = g.v.fighter(p); return { shot: f.fired, melee: f.act & L.AB_MELEE, gren: (f.act >> 1) & 1 }; };
const swing = (g, p, q) => { const w = still(g, p); g.step([[L.EV_INPUT, p, aim(g, p, q, 1.0, { ...w, melee: w.melee ^ 1 })]]); };

// FX of a kind (and size) from the running count `from` on, at most the ring's last FX_MAX
function fxs(v, kind, size, from = 0) {
  const out = [];
  for (let k = Math.max(from, v.fxCount() - L.FX_MAX); k < v.fxCount(); k++) {
    const f = v.fx(k);
    if (f.kind === kind && (size === undefined || f.size === size)) out.push(f);
  }
  return out;
}
const endMatch = (g) => { g.dv.setUint32(L.HDR_UNTIL, g.v.tick + 1, true); for (let i = 0; i < 4; i++) g.step(); };
const untilPlay = (g) => { while (g.v.hole().state !== L.H_PLAY) g.step(); g.step(); };
const steps = (g, n, recs) => { for (let i = 0; i < n; i++) g.step(recs); };
// ticks of play the next step's tick hook sees (HDR_TICK less HDR_START)
const played = (g) => g.v.tick - g.v.hole().start;
// on to the step that scores (the next step's tick of play a whole TR_POINT)
const toPoint = (g) => { while (played(g) % AC.TR_POINT !== 0) g.step(); };

// Predicts slot p through `inputs` from every tick (1 ahead, and 6 and 30 every
// 7th) and compares each with the confirmed world when it gets there; after(k)
// runs on the confirmed world after tick k.
function predicted(g, p, inputs, after = () => {}) {
  const due = new Map();
  let compared = 0;
  const at0 = rec(p), atP = rec(p) + L.PRED_D;
  for (let k = 0; k < inputs.length; k++) {
    for (const n of [1, 6, 30]) {
      if ((k % 7 !== 0 && n !== 1) || k + n > inputs.length) continue;
      for (let i = 0; i < n; i++) g.dv.setUint32(L.PWORDS + 4 * i, inputs[k + i], true);
      g.sim.x.predict(p, n);
      const list = due.get(k + n) || [];
      list.push({ n, from: k, player: g.sim.u8.slice(atP, atP + L.PSIZE) });
      due.set(k + n, list);
    }
    g.step([[L.EV_INPUT, p, inputs[k]]]);
    after(k);
    for (const d of due.get(k + 1) || []) {
      assert.deepEqual(d.player, g.sim.u8.slice(at0, at0 + L.PSIZE), `predicted ${d.n} from ${d.from}`);
      compared++;
    }
  }
  return compared;
}

// Territory k as AO holds it, and poked.
const tAt = (k) => L.AO + AC.TR_T + k * AC.TR_TSIZE;
function T(g, k) {
  const a = tAt(k), f = (o) => g.dv.getFloat32(a + o, true);
  return { pos: [f(AC.TR_X), f(AC.TR_Y), f(AC.TR_Z)], gauge: g.dv.getInt32(a + AC.TR_GAUGE, true), hold: u32(g, a + AC.TR_HOLD),
    on: [g.dv.getUint16(a + AC.TR_ON, true), g.dv.getUint16(a + AC.TR_ON + 2, true)] };
}
const gh = (g, k) => { const t = T(g, k); return [t.gauge, t.hold]; };
const setT = (g, k, gauge, hold) => { g.dv.setInt32(tAt(k) + AC.TR_GAUGE, gauge, true); g.dv.setUint32(tAt(k) + AC.TR_HOLD, hold, true); };
const held = (g) => [u32(g, L.AO + AC.TR_HELD), u32(g, L.AO + AC.TR_HELD + 4)];
const atOf = (g, p) => g.sim.u8[L.AO + AC.TR_AT + p];
const N = MAP.hills.length;
const all = (n) => [...Array(n).keys()];

// The mode's news from the running count `from` on: [what, owner, shot].
const news = (g, from) => fxs(g.v, L.FX_MODE, undefined, from).filter((f) => f.size >= L.MX_AM + 40 && f.size < L.MX_AM + 48).map((f) => [f.size, f.owner, f.shot]);
const [TAKE, LOSE] = [AC.TR_MX_TAKE, AC.TR_MX_LOSE];

// Slots well away from every territory, on open ground.
const away = (g, slots) => slots.forEach((p, i) => put(g, p, 470, 540 + 3 * i));
// p on territory k dx, dz from its centre, its feet at its height plus dy.
const on = (g, p, k, dx = 0, dz = 0, dy = 0) => { const t = T(g, k); put(g, p, t.pos[0] + dx, t.pos[2] + dz, t.pos[1] + dy); };

test('Territories: nothing in AO over the countdown; as play starts one territory for each of the map\'s hill points, each where its point stands, all neutral; the target', async () => {
  const c = await room(L.M_TERRITORY, 2, 7, { count: true });
  assert.equal(c.v.hole().state, L.H_COUNT);
  assert.ok(c.sim.u8.slice(L.AO, L.AO + L.AO_SIZE).every((x) => x === 0), 'AO clear');
  assert.equal(u32(c, L.AH_TARGET), 0);
  const g = await room(L.M_TERRITORY, 2);
  assert.deepEqual([g.v.mode().name, u32(g, L.AH_TARGET), u32(g, L.AO + AC.TR_N), held(g)], ['TERRITORIES', AC.TR_TARGET, N, [0, 0]]);
  assert.equal(N, 6);
  assert.ok(AC.TR_T + L.NHILL * AC.TR_TSIZE <= AC.TR_AT && AC.TR_AT + L.NPLAYER <= AC.TR_SIZE && AC.TR_SIZE <= L.AO_SIZE, 'its fields fit AO');
  for (let k = 0; k < N; k++) {
    const t = T(g, k);
    assert.deepEqual([t.pos[0], t.pos[2], +t.pos[1].toFixed(2)], [Math.fround(MAP.hills[k][0]), Math.fround(MAP.hills[k][1]), FEET[k]], `territory ${k}`);
    // one tick of play stepped: a fighter spawned on one has pushed it a step
    assert.deepEqual([t.hold, t.gauge], [0, Math.sign(t.on[0] - t.on[1])], `territory ${k}`);
  }
  // past the territories, AO is the slots' places, and nothing else
  assert.ok(g.sim.u8.slice(L.AO + AC.TR_T + N * AC.TR_TSIZE, L.AO + AC.TR_AT).every((x) => x === 0));
  assert.ok(g.sim.u8.slice(L.AO + AC.TR_AT + L.NPLAYER, L.AO + L.AO_SIZE).every((x) => x === 0));
});

test('Territories: a fighter is on one with its feet strictly within TR_R across and TR_H up or down; on the first in the map\'s order; each side\'s live fighters counted, the dead and the gone not', async () => {
  const g = await room(L.M_TERRITORY, 6);
  const six = all(6);
  assert.deepEqual(sides(g, six), [0, 1, 0, 1, 0, 1]);
  away(g, six);
  g.step();
  for (let k = 0; k < N; k++) assert.deepEqual(T(g, k).on, [0, 0]);
  const state = (k = 1) => [T(g, k).on, atOf(g, 0)];
  // red's roof: the rim isn't on it, a hair inside is, every way round
  for (const [dx, dz] of [[5, 0], [0, -5], [-5, 0], [0, 5.01], [3.6, 3.6]]) {
    on(g, 0, 1, dx, dz);
    g.step();
    assert.deepEqual(state(), [[0, 0], 0], `${dx}, ${dz}`);
  }
  for (const [dx, dz] of [[4.99, 0], [0, -4.99], [3.5, 3.5]]) {
    on(g, 0, 1, dx, dz);
    g.step();
    assert.deepEqual(state(), [[1, 0], 2], `${dx}, ${dz}: on territory 1`);
  }
  // the band: 2 m over it is off, a hair under 2 on; the room under the roof, 4.8 m down, off
  on(g, 0, 1, 0, 0, 2.01);
  g.step();
  assert.deepEqual(state(), [[0, 0], 0], 'over it');
  on(g, 0, 1, 0, 0, 1.99);
  g.step();
  assert.deepEqual(state(), [[1, 0], 2], 'just within');
  put(g, 0, 390, 512, 21);
  g.step();
  assert.ok(Math.abs(g.v.fighter(0).pos[1] - 21) < 0.01, 'in the room');
  assert.deepEqual(state(), [[0, 0], 0], 'under it');
  // each side's count: two red and one blue on the cave's, another blue on mid-field
  on(g, 0, 3, -2); on(g, 2, 3, 2); on(g, 1, 3); on(g, 3, 0);
  g.step();
  assert.deepEqual([T(g, 3).on, T(g, 0).on, six.map((p) => atOf(g, p))], [[2, 1], [0, 1], [4, 4, 4, 1, 0, 0]]);
  // the dead and those who left don't count
  g.dv.setUint8(rec(2) + L.P_FL, fl(g, 2) | L.PF_DEAD); g.dv.setUint16(rec(2) + L.A_RESPAWN, 1000, true);
  g.step();
  assert.deepEqual([T(g, 3).on, atOf(g, 2)], [[1, 1], 0], 'a death');
  g.step([[L.EV_LEAVE, 1]]);
  assert.deepEqual([T(g, 3).on, atOf(g, 1)], [[1, 0], 0], 'a leave');
  // two that overlap (territory 2's point moved 3 m off territory 1's): one in both counts on the first only
  const t1 = T(g, 1);
  g.dv.setFloat32(tAt(2) + AC.TR_X, t1.pos[0] + 3, true); g.dv.setFloat32(tAt(2) + AC.TR_Y, t1.pos[1], true); g.dv.setFloat32(tAt(2) + AC.TR_Z, t1.pos[2], true);
  away(g, six);
  on(g, 4, 1, 1.5); on(g, 5, 1, 6);
  g.step();
  assert.deepEqual([T(g, 1).on, T(g, 2).on, atOf(g, 4), atOf(g, 5)], [[1, 0], [0, 1], 2, 3]);
});

test('Territories: the gauge a step a tick toward the side with more on it, held still by as many each; a neutral one taken at TR_CAP to the tick, a held one lost back at neutral to the tick and only then the other side\'s; news at each, the same either way round', async () => {
  for (const s of [0, 1]) {
    const g = await room(L.M_TERRITORY, 6); // 0, 2, 4 red; 1, 3, 5 blue
    const six = all(6);
    away(g, six);
    for (let k = 0; k < N; k++) setT(g, k, 0, 0);
    g.step();
    const us = s ? [1, 3, 5] : [0, 2, 4], them = s ? [0, 2, 4] : [1, 3, 5];
    const sign = s ? -1 : 1, side = s + 1, other = 2 - s;
    const k = 0; // mid-field
    const t0 = T(g, k);
    const from = g.v.fxCount();
    on(g, us[0], k);
    g.step();
    assert.deepEqual(gh(g, k), [sign, 0], 'a step from its first tick');
    steps(g, CAP - 2);
    assert.deepEqual([gh(g, k), news(g, from)], [[sign * (CAP - 1), 0], []], 'one short');
    g.step();
    assert.deepEqual(gh(g, k), [sign * CAP, side], 'taken at TR_CAP');
    let fx = fxs(g.v, L.FX_MODE, TAKE, from);
    assert.deepEqual(fx.map((f) => [f.owner, f.shot, f.tick, ...f.pos]), [[255, side + 4 * k, g.v.tick - 1, ...t0.pos]], 'at its centre, owner nobody, its side and index');
    steps(g, 50);
    assert.deepEqual([gh(g, k), held(g)], [[sign * CAP, side], s ? [0, 1] : [1, 0]], 'never past its end');
    // the other side: one each holds it still; two against one push it back, to neutral in TR_CAP ticks
    on(g, them[0], k, 1.5);
    steps(g, 40);
    assert.deepEqual([gh(g, k), T(g, k).on[s], T(g, k).on[1 - s]], [[sign * CAP, side], 1, 1], 'as many each');
    on(g, them[1], k, -1.5);
    let n = g.v.fxCount();
    steps(g, CAP - 1);
    assert.deepEqual([gh(g, k), news(g, n)], [[sign, side], []]);
    g.step();
    assert.deepEqual([gh(g, k), news(g, n)], [[0, 0], [[LOSE, 255, side + 4 * k]]], 'lost at neutral, the news its loser\'s');
    // and on through neutral: the other side's TR_CAP ticks later
    steps(g, CAP - 1);
    assert.deepEqual([gh(g, k), news(g, n).length], [[-sign * (CAP - 1), 0], 1]);
    g.step();
    assert.deepEqual([gh(g, k), news(g, n)], [[-sign * CAP, other], [[LOSE, 255, side + 4 * k], [TAKE, 255, other + 4 * k]]]);
    // nobody on it: it rests at its holder's end; pushed part way back and left, it drifts home
    away(g, six);
    steps(g, 20);
    assert.deepEqual(gh(g, k), [-sign * CAP, other]);
    on(g, us[0], k); on(g, us[1], k, 1.5);
    steps(g, 300);
    assert.deepEqual(gh(g, k), [-sign * (CAP - 300), other]);
    away(g, six);
    steps(g, 299);
    assert.deepEqual(gh(g, k), [-sign * (CAP - 1), other], 'back a step a tick');
    steps(g, 5);
    assert.deepEqual(gh(g, k), [-sign * CAP, other]);
    // a nobody's part taken drifts back to neutral and rests there; the other side pushes it straight through, no loss
    const j = 3; // the cave's
    n = g.v.fxCount();
    on(g, us[0], j);
    steps(g, 200);
    away(g, six);
    steps(g, 199);
    assert.deepEqual(gh(g, j), [sign, 0]);
    steps(g, 30);
    assert.deepEqual(gh(g, j), [0, 0], 'rests at neutral');
    setT(g, j, sign * 200, 0);
    on(g, them[0], j);
    steps(g, 200 + CAP);
    assert.deepEqual([gh(g, j), news(g, n)], [[-sign * CAP, other], [[TAKE, 255, other + 4 * j]]]);
    // two taken on one tick: news in the map's order
    setT(g, 2, sign * (CAP - 5), 0); setT(g, 5, sign * (CAP - 5), 0);
    away(g, six);
    on(g, us[0], 5); on(g, us[1], 2);
    n = g.v.fxCount();
    steps(g, 5);
    const two = fxs(g.v, L.FX_MODE, TAKE, n);
    assert.deepEqual(two.map((f) => [f.shot, f.tick]), [[side + 8, g.v.tick - 1], [side + 20, g.v.tick - 1]]);
  }
});

test('Territories: every TR_POINT ticks of play a point for each territory a side holds then (one taken on that tick counts); a fighter\'s seconds on its side\'s territories, TR_SEC ticks each, across territories, contests and deaths, not on a neutral or theirs', async () => {
  const g = await room(L.M_TERRITORY, 4); // 0, 2 red; 1, 3 blue
  const four = all(4);
  away(g, four);
  setT(g, 0, CAP, 1); setT(g, 1, CAP, 1); setT(g, 4, -CAP, 2);
  toPoint(g);
  let s = scores(g);
  g.step();
  assert.deepEqual([scores(g), held(g)], [[s[0] + 2, s[1] + 1], [2, 1]], 'two red, one blue');
  steps(g, AC.TR_POINT - 1);
  assert.deepEqual(scores(g), [s[0] + 2, s[1] + 1], 'not before');
  // one taken on the point's own tick counts on it
  setT(g, 3, -(CAP - 1), 0);
  on(g, 3, 3);
  g.step();
  assert.deepEqual([gh(g, 3), scores(g)], [[-CAP, 2], [s[0] + 4, s[1] + 3]]);
  // red's 0 on its own: its ticks counted, a second each TR_SEC
  g.dv.setUint16(L.MODE_REC + L.MR_POINTS, 0, true); g.dv.setUint16(L.MODE_REC + L.MR_AUX, 0, true);
  on(g, 0, 1);
  steps(g, AC.TR_SEC - 1);
  assert.deepEqual([points(g, [0]), auxes(g, [0])], [[0], [AC.TR_SEC - 1]]);
  g.step();
  assert.deepEqual([points(g, [0]), auxes(g, [0])], [[1], [0]], 'a whole second');
  // onto mid-field, red's too: the count goes on; then contested there, still red's: still counted
  steps(g, 60);
  on(g, 0, 0);
  steps(g, 40);
  on(g, 1, 0, 1.5);
  steps(g, 25);
  assert.deepEqual([gh(g, 0), T(g, 0).on, points(g, [0, 1]), auxes(g, [0, 1])], [[CAP, 1], [1, 1], [2, 0], [0, 0]], 'red\'s, so 0\'s, never 1\'s');
  // dead on it: no count, the part second kept
  steps(g, 30);
  g.dv.setUint8(rec(0) + L.P_FL, fl(g, 0) | L.PF_DEAD); g.dv.setUint16(rec(0) + L.A_RESPAWN, 1000, true);
  steps(g, 200);
  assert.deepEqual([points(g, [0]), auxes(g, [0])], [[2], [30]]);
  // red's 2 on a neutral (the rock, taking it) and then on blue's roof, nothing; blue's 3 on its roof, its own
  for (const p of [2, 3]) { g.dv.setUint16(L.MODE_REC + p * L.MR_SIZE + L.MR_POINTS, 0, true); g.dv.setUint16(L.MODE_REC + p * L.MR_SIZE + L.MR_AUX, 0, true); }
  away(g, [1, 2, 3]);
  on(g, 2, 2); on(g, 3, 4);
  steps(g, 2 * AC.TR_SEC);
  assert.deepEqual([gh(g, 2), points(g, [2, 3]), auxes(g, [2, 3])], [[2 * AC.TR_SEC, 0], [0, 2], [0, 0]]);
  on(g, 2, 4, 1.5);
  steps(g, AC.TR_SEC);
  assert.deepEqual([gh(g, 4), points(g, [0, 2, 3]), auxes(g, [0, 2, 3])], [[-CAP, 2], [2, 0, 3], [30, 0, 0]], 'contested, still blue\'s');
});

test('Territories: over on the tick a side reaches TR_TARGET; at the clock the side ahead, or a draw; places by side, then time on, then kills; the next match from zero', async () => {
  const g = await room(L.M_TERRITORY, 4); // 0, 2 red; 1, 3 blue
  away(g, all(4));
  setT(g, 5, CAP, 1);
  g.dv.setUint32(L.AH_SCORE, AC.TR_TARGET - 1, true); g.dv.setUint32(L.AH_SCORE + 4, 70, true);
  const mr = (h, p, pts, kills) => { h.dv.setUint16(L.MODE_REC + p * L.MR_SIZE + L.MR_POINTS, pts, true); h.dv.setUint16(rec(p) + L.A_KILLS, kills, true); };
  [[40, 1], [50, 9], [30, 9], [55, 2]].forEach(([pts, k], p) => mr(g, p, pts, k));
  toPoint(g);
  assert.deepEqual([g.v.hole().state, scores(g)], [L.H_PLAY, [AC.TR_TARGET - 1, 70]]);
  const from = g.v.fxCount();
  g.step();
  assert.deepEqual([g.v.hole().state, scores(g), u32(g, L.AH_TEAMWIN)], [L.H_OVER, [AC.TR_TARGET, 70], 1], 'over on its tick, red\'s');
  assert.deepEqual(fxs(g.v, L.FX_MODE, L.MX_TEAMWIN, from).map((f) => f.shot), [1]);
  assert.deepEqual(points(g, all(4)), [40, 50, 30, 55]);
  assert.deepEqual(all(4).map((p) => g.v.fighter(p).place), [1, 4, 2, 3], 'red above blue, each by its time on');
  // blue there with two territories at once, from one short of it
  const b = await room(L.M_TERRITORY, 4);
  away(b, all(4));
  setT(b, 1, -CAP, 2); setT(b, 4, -CAP, 2);
  b.dv.setUint32(L.AH_SCORE + 4, AC.TR_TARGET - 1, true);
  toPoint(b);
  b.step();
  assert.deepEqual([b.v.hole().state, scores(b), u32(b, L.AH_TEAMWIN)], [L.H_OVER, [0, AC.TR_TARGET + 1], 2]);
  // the clock: blue ahead by one
  const c = await room(L.M_TERRITORY, 4);
  c.dv.setUint32(L.AH_SCORE, 40, true); c.dv.setUint32(L.AH_SCORE + 4, 41, true);
  endMatch(c);
  assert.deepEqual([c.v.hole().state, u32(c, L.AH_TEAMWIN)], [L.H_OVER, 2]);
  assert.deepEqual(all(4).map((p) => c.v.fighter(p).place), [3, 1, 3, 1], 'blue first; nobody had time on, so each side shares');
  // a draw: by time on, then kills, across both sides
  const d = await room(L.M_TERRITORY, 4);
  d.dv.setUint32(L.AH_SCORE, 41, true); d.dv.setUint32(L.AH_SCORE + 4, 41, true);
  [[10, 2], [10, 5], [7, 9], [3, 9]].forEach(([pts, k], p) => mr(d, p, pts, k));
  endMatch(d);
  assert.equal(u32(d, L.AH_TEAMWIN), 3);
  assert.deepEqual(all(4).map((p) => d.v.fighter(p).place), [2, 1, 3, 4]);
  // the next match from zero: every territory neutral again, no scores, no time on
  d.dv.setInt32(tAt(2) + AC.TR_GAUGE, 300, true);
  untilPlay(d);
  assert.deepEqual([scores(d), u32(d, L.AH_TEAMWIN), u32(d, L.AH_TARGET), points(d, all(4)), auxes(d, all(4))], [[0, 0], 0, AC.TR_TARGET, [0, 0, 0, 0], [0, 0, 0, 0]]);
  for (let k = 0; k < N; k++) assert.deepEqual(gh(d, k), [Math.sign(T(d, k).on[0] - T(d, k).on[1]), 0], `territory ${k}`);
});

test('Territories: joins and leaves mid-capture: one who leaves is off the count on its tick (a nobody\'s drifts back from there); a rejoin starts from 0 seconds, on the side with fewer; a kill on it turns the count on its tick', async () => {
  const g = await room(L.M_TERRITORY, 5); // 0, 2, 4 red; 1, 3 blue
  away(g, all(5));
  for (let k = 0; k < N; k++) setT(g, k, 0, 0);
  g.dv.setUint16(L.MODE_REC + L.MR_POINTS, 9, true);
  on(g, 0, 0);
  steps(g, 300);
  assert.deepEqual([gh(g, 0), T(g, 0).on, atOf(g, 0)], [[300, 0], [1, 0], 1]);
  let from = g.v.fxCount();
  g.step([[L.EV_LEAVE, 0]]);
  assert.deepEqual([gh(g, 0), T(g, 0).on, atOf(g, 0), news(g, from)], [[299, 0], [0, 0], 0, []], 'off it on the leave\'s tick');
  // back in: red (two each without it), its time from 0, spawned on its own half
  g.step([[L.EV_JOIN, 0]]);
  assert.deepEqual([team(g, 0), g.v.fighter(0).points, g.v.fighter(0).aux], [0, 0, 0]);
  // a join in play goes to blue, the side with fewer, and pushes with blue's other
  g.step([[L.EV_JOIN, 7]]);
  assert.equal(team(g, 7), 1);
  on(g, 7, 0); on(g, 3, 0, 1.5); on(g, 0, 0, -1.5);
  g.step();
  assert.deepEqual([T(g, 0).on, gh(g, 0)], [[1, 2], [296, 0]]);
  // red's 0 cuts 3 down with a sword where they stand: as many each on that tick, the gauge held; then 0 alone against 7
  loadout(g, 0, L.W_SWORD);
  for (let i = 0; i < L.COOL_TICKS; i++) { on(g, 0, 0, 0, 0); on(g, 3, 0, 0, 1.5); on(g, 7, 0, -3); g.step(); }
  const before = gh(g, 0);
  on(g, 0, 0, 0, 0); on(g, 3, 0, 0, 1.5); on(g, 7, 0, -3, 0);
  swing(g, 0, 3);
  assert.ok(g.v.fighter(3).dead, 'a kill');
  assert.deepEqual([T(g, 0).on, gh(g, 0)], [[1, 1], before], 'as many each: still');
  steps(g, 10);
  assert.deepEqual(gh(g, 0), before, 'still');
});

test('Territories: nothing is barred to spawns: red respawns onto its roof\'s territory whoever holds it, and counts on it there', async () => {
  const g = await room(L.M_TERRITORY, 8, 5);
  const reds = all(8).filter((p) => team(g, p) === 0);
  const sp = g.v.map().spawns;
  const roof = T(g, 1);
  const onRoof = (i) => Math.hypot(sp[i][0] - roof.pos[0], sp[i][2] - roof.pos[2]) < Number(AC.TR_R) && Math.abs(sp[i][1] - roof.pos[1]) < Number(AC.TR_H);
  // spawn 3 is red's on its roof within the territory (4, on the roof too, is 7.8 m out; 0 to 2 in the room under it)
  assert.deepEqual([0, 1, 2, 3, 4].map(onRoof), [false, false, false, true, false]);
  const used = new Set();
  for (const hold of [0, 2, 1]) {
    for (let k = 0; k < 40; k++) {
      setT(g, 1, hold === 2 ? -CAP : hold === 1 ? CAP : 0, hold);
      for (const p of reds) { g.dv.setUint8(rec(p) + L.P_FL, fl(g, p) | L.PF_DEAD); g.dv.setUint16(rec(p) + L.A_RESPAWN, 1, true); }
      g.step();
      for (const p of reds) {
        const f = g.v.fighter(p);
        const i = MAP.spawns.findIndex((s) => s.x === f.pos[0] && s.z === f.pos[2]);
        if (onRoof(i)) { used.add(`${hold}:${i}`); assert.equal(atOf(g, p), 2, `P${p} on the roof counts on it`); }
      }
    }
  }
  assert.ok([0, 1, 2].every((h) => used.has(`${h}:3`)), `the roof's spawn used whoever holds it: ${[...used]}`);
});

test('Territories: a fighter\'s own runs across mid-field and back as its side takes it and scores, predicted from every tick, keep up bit for bit; the gauges and time on are the confirmed world\'s', async () => {
  const g = await room(L.M_TERRITORY, 3);
  away(g, all(3));
  for (let k = 0; k < N; k++) setT(g, k, 0, 0);
  on(g, 2, 0, 2, 2); // red's 2 takes mid-field
  setT(g, 0, CAP - 100, 0);
  const t0 = T(g, 0);
  put(g, 0, t0.pos[0] - 12, t0.pos[2]);
  const inputs = [];
  for (let k = 0; k < 900; k++) inputs.push(arenaWord({ yaw: k < 450 ? 0 : 8192, pitch: 512, move: k % 150 < 100 ? 1 : 0, jump: k % 90 === 40 ? 1 : 0 }));
  let onTicks = 0;
  const compared = predicted(g, 0, inputs, () => {
    const f = g.v.fighter(0);
    if (atOf(g, 0) && T(g, atOf(g, 0) - 1).hold === 1) onTicks++;
    assert.equal(atOf(g, 0) === 1, onIt(T(g, 0), f.pos), 'the reader says as the sim counts');
  });
  assert.ok(compared > 900);
  assert.ok(onTicks > 50 && onTicks < 900, `${onTicks}`);
  assert.deepEqual([gh(g, 0)[1], g.v.fighter(0).points * AC.TR_SEC + g.v.fighter(0).aux], [1, onTicks]);
});

test('a Fiesta after a match of Territories: its region exactly a Fiesta\'s (the mode header, the territories, the records, no pads, no sides)', async () => {
  const g = await room(L.M_TERRITORY, 4);
  // a match of it leaves all of it dirty: territories held and pushed, time on, scores, pads, sides
  away(g, all(4));
  on(g, 0, 1); on(g, 2, 0); on(g, 1, 4); on(g, 3, 0, 1.5);
  steps(g, CAP + 3 * AC.TR_POINT);
  assert.deepEqual([gh(g, 1)[1], gh(g, 4)[1], T(g, 0).on], [1, 2, [1, 1]]);
  assert.ok(scores(g)[0] >= 3 && scores(g)[1] >= 3 && points(g, [0, 1]).every((x) => x >= 6));
  assert.ok(g.v.pads().length > 0 && sides(g, all(4)).includes(1));
  // the next match is the rotation's Fiesta: the seed no longer forces one, and the match count is the rotation's last
  g.dv.setUint32(L.HDR_SEED, 7, true);
  g.dv.setUint32(L.HDR_HOLE, L.ARENA_MODES.length - 1, true);
  endMatch(g);
  assert.ok(u32(g, L.AH_TEAMWIN) > 0);
  untilPlay(g);
  assert.equal(g.v.mode().mode, L.M_FIESTA);
  const zero = (a, b) => g.sim.u8.slice(a, b).every((x) => x === 0);
  const check = () => {
    assert.ok(zero(L.AH_MODE, L.AH_END), 'the header');
    assert.ok(zero(L.AO, L.AO + L.AO_SIZE), 'the objective');
    assert.ok(zero(L.MODE_REC, L.MODE_REC + L.NPLAYER * L.MR_SIZE), 'the records');
    if (L.FIESTA) assert.ok(zero(L.PAD, L.PAD + L.NPAD * L.PAD_SIZE), 'the pads');
    for (let p = 0; p < L.NPLAYER; p++) assert.equal(fl(g, p) & (L.PF_BLUE | L.PF_CARRY), 0, `P${p}`);
  };
  check();
  // and stays so through play, fighters standing where the territories were
  away(g, all(4));
  put(g, 0, 392, 512, FEET[1]); put(g, 1, 512, 512); put(g, 2, MAP.hills[3][0], MAP.hills[3][1], FEET[3]);
  steps(g, 2 * AC.TR_POINT);
  check();
});

test('Territories\' client module: each territory a disc in its holder\'s colour with its gauge round the rim, waypoints TAKE and DEFEND, the HUD\'s row and count and how yours goes, the news, the board\'s column, the AI fighter\'s goal', async () => {
  const g = await room(L.M_TERRITORY, 4); // 0, 2 red; 1, 3 blue
  const kit = AMC[L.M_TERRITORY];
  away(g, all(4));
  // A red's (blue's 1 on it, pushing it back), B red's, C nobody's (red's 0 on it, taking it), D nobody's, E and F blue's
  [[CAP, 1], [CAP, 1], [250, 0], [0, 0], [-CAP, 2], [-CAP, 2]].forEach(([gauge, hold], k) => setT(g, k, gauge, hold));
  on(g, 1, 0); on(g, 0, 2);
  g.step();
  const ts = territories(g.v);
  assert.deepEqual(ts.map((t) => [t.k, t.gauge, t.hold, t.on]), [[0, CAP - 1, 1, [0, 1]], [1, CAP, 1, [0, 0]], [2, 251, 0, [1, 0]], [3, 0, 0, [0, 0]], [4, -CAP, 2, [0, 0]], [5, -CAP, 2, [0, 0]]]);
  assert.deepEqual(ts.map((t) => t.pos), all(N).map((k) => T(g, k).pos));
  assert.deepEqual(ts.map(push), [-1, 0, 1, 0, 0, 0], 'which way each goes next, as the sim steps it');
  const draw = (slot, now = 0, cam = [470, 30, 540], shown = slot) => {
    const out = { solid: [], glow: [], beams: [], markers: [], zone: null };
    kit.draw(g.v, { now, slot, shown, me: slot >= 0 ? g.v.fighter(slot) : null, cam, view: g.v }, out);
    return out;
  };
  // the discs: each holder's colour (grey for nobody's), running hard while its gauge moves, painted within TR_H of its point
  const grey = [0.85, 0.85, 0.82];
  let out = draw(2);
  assert.deepEqual(out.zone, ts.map((t, k) => ({ x: t.pos[0], z: t.pos[2], r: 5, y: t.pos[1], h: 2, color: [SIDE_RGB[0], SIDE_RGB[0], grey, grey, SIDE_RGB[1], SIDE_RGB[1]][k], pulse: [1, 0.5, 1, 0.3, 0.5, 0.5][k] })));
  // the rim: C's 251 of 625 is four of twelve lit red and the fifth blinking, the rest dim; B's all twelve red; D's none
  const rim = (k, o = out) => o.glow.filter((x) => Math.abs(Math.hypot(x.pos[0] - ts[k].pos[0], x.pos[2] - ts[k].pos[2]) - 5 * 0.97) < 1e-3);
  const lit = (k, o = out) => rim(k, o).filter((x) => x.color[3] === 0.85);
  assert.deepEqual([rim(2).length, lit(2).length, lit(2).every((x) => x.color.slice(0, 3).join() === SIDE_RGB[0].join())], [12, 4, true]);
  assert.deepEqual([draw(2, 0).glow.length === draw(2, 200).glow.length, rim(2, draw(2, 0))[4].color[3], rim(2, draw(2, 200))[4].color[3]], [true, 0.3, 0.8]);
  assert.deepEqual([lit(1).length, lit(3).length, lit(5).length === rim(5).length, lit(5).every((x) => x.color.slice(0, 3).join() === SIDE_RGB[1].join())], [12, 0, true, true]);
  assert.deepEqual([rim(4).length, rim(5).length > 6], [0, true], 'none round E, 164 m off the camera');
  assert.ok(rim(3).length >= 6 && rim(3).length < 12, `the cave's walls drop some of its rim (${rim(3).length})`);
  assert.deepEqual(out.beams.length, N, 'a pillar each, far off');
  // red's 2, off them all, facing +x: DEFEND on A (blue outnumbers red there, near the left edge), none on B, TAKE
  // on the nearest of the rest in their holder's colour, three at most: D (54 m, off the right edge); F (88 m,
  // behind on the left, where A is) left out; C (103 m, ahead)
  const marks = (o) => o.markers.map((m) => [m.label, m.color]);
  assert.deepEqual(marks(out), [['DEFEND A', C.YELLOW], ['TAKE D', C.WHITE], ['TAKE C', C.WHITE]]);
  assert.ok(out.markers.every((m) => m.kind === 'hill'));
  // turned round to face -x (B, red's own, ahead): A, E and F off the one edge, C and D off the other, one each
  g.dv.setUint32(rec(2) + L.P_IN, arenaWord({ yaw: 8192 }), true);
  assert.deepEqual(marks(draw(2)), [['DEFEND A', C.YELLOW], ['TAKE D', C.WHITE]]);
  g.dv.setUint32(rec(2) + L.P_IN, 0, true);
  // the thinning: the nearest first, none within 0.2 rad across of one kept, one off the screen counted at its edge, three at most
  const mk = (d, a) => ({ d, m: { pos: [d * Math.cos(a), 0, d * Math.sin(a)], label: `${d}` } });
  const kept = (want, yaw = 0) => thin(want, [0, 0, 0], yaw).map((m) => m.label);
  assert.deepEqual(kept([mk(20, 0.1), mk(10, 0), mk(30, 0.5), mk(50, -2.5), mk(40, -2), mk(60, 0.3)]), ['10', '30', '40']);
  assert.deepEqual(kept([mk(20, 0.19), mk(10, 0), mk(60, 0.4)]), ['10', '60']);
  assert.deepEqual(kept([mk(10, 1), mk(20, 1.5), mk(30, -1), mk(40, -3)]), ['10', '30']);
  assert.deepEqual(kept([mk(10, 0.6), mk(20, 1.2), mk(30, -0.6)]), ['10', '30'], 'one just inside the edge and one off it');
  assert.deepEqual(kept([mk(10, 1), mk(20, 1.5), mk(30, -1), mk(40, -3)], 1.2), ['10', '20', '30'], 'facing between the first two, both on the screen');
  // red's 0 on C: none over its own head; blue's 1 on A; a spectator as the one it watches, and none watching nobody
  assert.deepEqual(marks(draw(0)), [['DEFEND A', C.YELLOW], ['TAKE D', C.WHITE], ['TAKE E', C.CYAN]]);
  assert.deepEqual(marks(draw(1)), [['TAKE D', C.WHITE], ['TAKE B', C.RED], ['TAKE C', C.WHITE]]);
  assert.deepEqual([marks(draw(-1, 0, undefined, 1)), draw(-1, 0, undefined, -1).markers, draw(-1, 0, undefined, -1).zone.length], [marks(draw(1)), [], N]);
  const m = draw(2, 0, [512 + 120, 30, 512]).markers[0];
  assert.deepEqual([m.pos[0], m.pos[2], m.pos[1] - ts[0].pos[1]], [512, 512, 8], 'the waypoint higher further off');
  // the HUD: the letters, under each who holds it on its chip, your side's count; how the one you stand on goes
  const hud = (slot, tm = slot >= 0 ? team(g, slot) : -1) => {
    const lines = [], rects = [];
    kit.hud(g.v, { put: (x, y, s, c) => lines.push([x, y, s, c]), rect: (...r) => rects.push(r), C, t: 30, me: slot >= 0 ? g.v.fighter(slot) : null, team: tm });
    return { lines, rects };
  };
  const row = [[1, 2, 'A', C.GREY], [1, 3, 'R', C.WHITE], [3, 2, 'B', C.GREY], [3, 3, 'R', C.WHITE], [5, 2, 'C', C.GREY], [5, 3, '-', C.WHITE],
    [7, 2, 'D', C.GREY], [7, 3, '-', C.WHITE], [9, 2, 'E', C.GREY], [9, 3, 'B', C.WHITE], [11, 2, 'F', C.GREY], [11, 3, 'B', C.WHITE]];
  let h = hud(2);
  assert.deepEqual(h.lines, [...row, [14, 3, 'YOURS 2', C.RED]]);
  // a chip each (5 x 7 units round the letter's cell), filled from the bottom to its gauge in the colour it leans to
  const chips = h.rects.filter((r) => r[7] === 0.7), fills = h.rects.filter((r) => r[7] === 0.9);
  assert.deepEqual(chips.map((r) => r.slice(0, 4)), all(N).map((i) => [8 * i + 3, 17, 8 * i + 8, 24]));
  assert.deepEqual(fills.map((r) => [r[0], r[1]]), [[3, 17], [11, 17], [19, 21], [35, 17], [43, 17]], 'A, B, E, F full, C 40%, D empty');
  assert.deepEqual(hud(0).lines.slice(-2), [[14, 3, 'YOURS 2', C.RED], [1, 4, 'TAKING C 40%', C.RED]]);
  assert.deepEqual(hud(1).lines.slice(-2), [[14, 3, 'YOURS 2', C.CYAN], [1, 4, 'PUSHING A BACK 0%', C.CYAN]]);
  assert.deepEqual(hud(-1).lines.slice(-2), [[14, 3, 'RED 2', C.RED], [20, 3, 'BLUE 2', C.CYAN]]);
  // how it goes from where you stand, each way it can
  const say = (slot, k, gauge, hold, red, blue) => {
    setT(g, k, gauge, hold); g.dv.setUint16(tAt(k) + AC.TR_ON, red, true); g.dv.setUint16(tAt(k) + AC.TR_ON + 2, blue, true);
    return hud(slot).lines.at(-1).slice(2);
  };
  on(g, 0, 2);
  assert.deepEqual([say(0, 2, CAP, 1, 1, 0), say(0, 2, 500, 1, 2, 0), say(0, 2, 500, 1, 1, 2), say(0, 2, 100, 0, 1, 1), say(0, 2, 100, 0, 1, 2), say(0, 2, -400, 2, 2, 1), say(0, 2, -100, 0, 1, 0), say(0, 2, 200, 0, 0, 0)],
    [['HOLDING C', C.RED], ['HOLDING C 80%', C.RED], ['LOSING C 80%', C.YELLOW], ['C CONTESTED', C.YELLOW], ['OUTNUMBERED ON C', C.YELLOW], ['PUSHING C BACK 36%', C.RED], ['TAKING C 0%', C.RED],
      ['TAKING C 32%', C.RED]]); // alone on it before the confirmed count has you: yours, not contested
  for (const s of [0, 1, 2, -1]) for (const [x, , str] of hud(s).lines) assert.ok(x >= 1 && x + str.length - 1 <= 26, `${str} fits cols 1 to 26`);
  // the news, told to each side: who took or lost which, a banner to whoever stands on it and to the side that lost one
  for (const p of [0, 1, 2]) {
    const said = [], shown = [], glows = [];
    const ctx = { slot: p, me: g.v.fighter(p), view: g.v, C, feed: (t, c) => said.push([t, c]), banner: (t, c) => shown.push([t, c]), glow: (x) => glows.push(x) };
    kit.news({ size: TAKE, owner: 255, shot: 1 + 4 * 2, pos: ts[2].pos }, ctx);
    kit.news({ size: LOSE, owner: 255, shot: 2 + 4 * 5, pos: ts[5].pos }, ctx);
    kit.news({ size: TAKE, owner: 255, shot: 0, pos: ts[5].pos }, ctx);
    assert.deepEqual(said, [['RED TOOK C', C.RED], ['BLUE LOST F', C.CYAN]]);
    assert.deepEqual(shown.map((x) => x[0]), [['YOUR SIDE TOOK C'], ['YOUR SIDE LOST F'], []][p], `P${p}: 0 stands on C, 1 is blue`);
    assert.equal(glows.length, 2);
  }
  // the board's column: seconds on your side's territories, as a clock
  g.dv.setUint16(L.MODE_REC + L.MR_POINTS, 83, true);
  assert.deepEqual([kit.cols.map((c) => c.head), kit.cols[0].get(g.v.fighter(0))], [['TIME ON'], '1:23']);
  assert.deepEqual(kit.state(g.v).hold, [1, 1, 0, 0, 2, 2]);
  // the next match's countdown: the map's points drawn neutral, the nearest three to take marked, no goal yet
  endMatch(g);
  while (g.v.hole().state !== L.H_COUNT) g.step();
  out = draw(2);
  assert.deepEqual([territories(g.v), out.zone.map((z) => [z.x, z.z, z.color]), marks(out).length, kit.goal(g.v, g.v.fighter(2), {}), kit.state(g.v)],
    [[], MAP.hills.map(([x, z]) => [Math.fround(x), Math.fround(z), grey]), 3, null, null]);
});

test('Territories\' AI fighters: dealt a territory each, the nearest counting a spread, attackers among those their side doesn\'t hold, defenders among those it does', async () => {
  const g = await room(L.M_TERRITORY, 6); // 0, 2, 4 red (4 defends); 1, 3, 5 blue (5 defends)
  const kit = AMC[L.M_TERRITORY];
  away(g, all(6));
  [[CAP, 1], [CAP, 1], [0, 0], [0, 0], [-CAP, 2], [-CAP, 2]].forEach(([gauge, hold], k) => setT(g, k, gauge, hold));
  on(g, 0, 2); on(g, 1, 0);
  put(g, 2, 470, 540); put(g, 3, 470, 543); put(g, 4, 400, 520); put(g, 5, 600, 500);
  g.step();
  const goal = (p) => kit.goal(g.v, g.v.fighter(p), { role: p >= 4 ? 'defend' : 'attack' });
  const ks = all(6).map((p) => deal(g.v).get(p));
  // red: 0 on C keeps it; 2 the nearest it doesn't hold (D); 4 defends B, the nearest it does
  // blue: 1 on A; 3 is as near A as D, but A is dealt and nobody red is on it, so D; 5 defends E
  assert.deepEqual(ks, [2, 0, 3, 3, 1, 4]);
  for (const p of all(6)) assert.deepEqual(goal(p), { pos: T(g, ks[p]).pos, r: 5 * (2 / 3), hurry: 0.6, hold: true }, `P${p}`);
  // the hand is one per tick: the same object until the world steps
  assert.equal(deal(g.v), deal(g.v));
  // more of red on C than it needs: 2 joins 0 there; blue's 1 stands on C too, so red needs two: 2 stays dealt C's
  on(g, 2, 2, 1.5);
  g.step();
  assert.deepEqual([deal(g.v).get(0), deal(g.v).get(2)], [2, 3], 'one is enough on C: 2 goes on to D');
  on(g, 1, 2, -1.5);
  g.step();
  assert.deepEqual([deal(g.v).get(0), deal(g.v).get(2)], [2, 2], 'blue\'s 1 there: two needed');
  // red holds them all: attackers defend; blue holds none: its defender attacks
  for (let k = 0; k < N; k++) setT(g, k, CAP, 1);
  g.step();
  const d = deal(g.v);
  assert.ok([0, 2, 4].every((p) => T(g, d.get(p)).hold === 1) && [1, 3, 5].every((p) => T(g, d.get(p)).hold === 1));
  // the dead are dealt nothing; a Fiesta's fighter (no side) has no goal
  g.dv.setUint8(rec(3) + L.P_FL, fl(g, 3) | L.PF_DEAD); g.dv.setUint16(rec(3) + L.A_RESPAWN, 1000, true);
  g.step();
  assert.equal(deal(g.v).has(3), false);
  assert.equal(kit.goal(g.v, { ...g.v.fighter(0), team: -1 }, {}), null);
});

test('Territories: a lone AI fighter of either side takes each territory from where it spawns (the field, both roofs by their bridges, the rocks, the cave) and holds it', async () => {
  const took = [];
  for (let k = 0; k < N; k++) {
    for (const side of [0, 1]) {
      const g = await room(L.M_TERRITORY, 2, 3);
      // every other territory its side's already, so k is the one it's dealt
      for (let j = 0; j < N; j++) setT(g, j, j === k ? 0 : side ? -CAP : CAP, j === k ? 0 : side + 1);
      const bot = new Fighter(side, 3, 0.6), other = 1 - side;
      let t = 0, word = -1;
      for (; t < 60 * 125 && T(g, k).hold !== side + 1; t++) {
        g.dv.setUint8(rec(other) + L.P_FL, fl(g, other) | L.PF_DEAD); g.dv.setUint16(rec(other) + L.A_RESPAWN, 1000, true);
        const w = bot.think(g.v, g.v.tick, 0);
        g.step(w !== word ? [[L.EV_INPUT, side, w]] : []);
        word = w;
      }
      took.push(`${'ABCDEF'[k]}${'rb'[side]} ${(t / 125).toFixed(1)}`);
      assert.equal(T(g, k).hold, side + 1, `territory ${k}, ${['red', 'blue'][side]}: not taken in 60 s, at ${g.v.fighter(side).pos.map((x) => x.toFixed(1))}`);
      // then 10 s on it: it stays on (not off a small top's edge, nor up onto the cave's roof)
      let n = 0;
      for (let i = 0; i < 10 * 125; i++) {
        g.dv.setUint8(rec(other) + L.P_FL, fl(g, other) | L.PF_DEAD); g.dv.setUint16(rec(other) + L.A_RESPAWN, 1000, true);
        const w = bot.think(g.v, g.v.tick, 0);
        g.step(w !== word ? [[L.EV_INPUT, side, w]] : []);
        word = w;
        if (T(g, k).on[side]) n++;
      }
      assert.ok(n >= 0.8 * 10 * 125, `territory ${k}, ${['red', 'blue'][side]}: on it ${n} ticks of ${10 * 125}`);
    }
  }
  console.log(`  seconds to take each: ${took.join(', ')}`);
});

test('Territories with 8 and 16 AI fighters: no trap on the debug build, the same hash on every tick on 1 and 4 threads; both sides take and lose territories and score, every territory taken', async () => {
  const [debug, bytes] = [arenaBytes(true), arenaBytes()];
  const ticks = 20000;
  for (const bots of [8, 16]) {
    const seen = { take: [0, 0], lose: [0, 0], taken: new Set(), best: [0, 0], held: [0, 0, 0] };
    let fx = 0;
    const { log, mode, scores: sc } = await playArena({ bytes: debug, seed: forcedSeed(L.M_TERRITORY), bots, ticks, leaveAt: 3000,
      onTick: (t, v) => {
        for (; fx < v.fxCount(); fx++) {
          const f = v.fx(fx);
          if (f.kind !== L.FX_MODE || (f.size !== TAKE && f.size !== LOSE)) continue;
          const s = (f.shot & 3) - 1;
          if (f.size === TAKE) { seen.take[s]++; seen.taken.add(f.shot >> 2); } else seen.lose[s]++;
        }
        if (v.hole().state !== L.H_PLAY) return;
        for (let k = 0; k < N; k++) seen.held[v.dv.getUint32(tAt(k) + AC.TR_HOLD, true)]++;
        seen.best = seen.best.map((b, i) => Math.max(b, v.dv.getUint32(L.AH_SCORE + 4 * i, true)));
      } });
    assert.equal(mode.mode, L.M_TERRITORY);
    const kills = sc.reduce((a, s) => a + s.kills, 0);
    console.log(`  ${bots} fighters: taken red/blue ${seen.take.join('/')}, lost ${seen.lose.join('/')}, territory-ticks nobody/red/blue ${seen.held.join('/')}, `
      + `points to ${seen.best.join(' and ')}, ${kills} kills, time on ${sc.map((s) => `${'rb'[s.team] ?? '-'}${s.points}`).join(' ')}`);
    assert.ok(seen.take[0] >= 3 && seen.take[1] >= 3, `${bots}: both sides take`);
    assert.ok(seen.lose[0] >= 1 && seen.lose[1] >= 1, `${bots}: both sides lose one`);
    assert.equal(seen.taken.size, N, `${bots}: every territory taken`);
    assert.ok(seen.best[0] >= 50 && seen.best[1] >= 50, `${bots}: both sides scored`);
    assert.ok(sc.filter((s) => s.points > 0).length >= bots / 2, `${bots}: half of them have time on`);
    const parsed = parseLog(log);
    const a = await replay({ bytes, log: parsed, ticks, threads: 1, tag: `tr${bots}-1` });
    const b = await replay({ bytes, log: parsed, ticks, threads: 4, tag: `tr${bots}-4`, startWorkers });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
  }
});
