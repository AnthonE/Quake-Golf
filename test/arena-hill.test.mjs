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
import { hillOf } from '../client/am/hill.mjs';
import { Fighter } from '../client/arena-bot.mjs';
import { C } from '../client/font.mjs';
import * as L from '../src/layout.mjs';

// King of the Hill (src/am/hill.wat, client/am/hill.mjs). Helpers as
// test/arena-teams.test.mjs has them; the hill read straight from its fields in AO.

// A room on the debug build: n fighters in, stepped to play. mode forces every
// match through the seed; null plays the rotation.
let debugModule = null;
async function room(mode, n = 2, seed = 7) {
  debugModule ||= await WebAssembly.compile(arenaBytes(true));
  const memory = newMemory();
  const sim = new Sim(await instantiate(debugModule, memory), memory);
  sim.init(mode === null ? seed : forcedSeed(mode, seed));
  const v = new View(sim.memory.buffer);
  const dv = new DataView(sim.memory.buffer);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
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
const MAP = compileMap();
const FEET = [19.69, 25.8, 23.4, 21, 25.8, 23.4]; // where each of Blood Gulch's hills stands (test/map.test.mjs)

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
function at(g, p, q, h, rest = {}) {
  const a = g.v.fighter(p), b = g.v.fighter(q);
  const { yaw, pitch } = aimAt([a.pos[0], a.pos[1] + 1.6, a.pos[2]], [b.pos[0], b.pos[1] + h, b.pos[2]]);
  return arenaWord({ yaw, pitch, ...rest });
}

// A word that presses nothing new: the counters and bits as p last took them.
const still = (g, p) => { const f = g.v.fighter(p); return { shot: f.fired, melee: f.act & L.AB_MELEE, gren: (f.act >> 1) & 1 }; };

// p swings its melee at q where they stand.
const swing = (g, p, q) => { const w = still(g, p); g.step([[L.EV_INPUT, p, at(g, p, q, 1.0, { ...w, melee: w.melee ^ 1 })]]); };

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

// The hill as AO holds it.
function hill(g) {
  const f = (o) => g.dv.getFloat32(L.AO + o, true);
  return {
    at: u32(g, L.AO + L.HL_AT), moves: u32(g, L.AO + L.HL_MOVES), pos: [f(L.HL_X), f(L.HL_Y), f(L.HL_Z)], r: f(L.HL_R),
    hold: u32(g, L.AO + L.HL_HOLD), on: [u32(g, L.AO + L.HL_ON), u32(g, L.AO + L.HL_ON + 4)],
    held: [g.dv.getUint16(L.AO + L.HL_HELD, true), g.dv.getUint16(L.AO + L.HL_HELD + 2, true)],
  };
}
const held = (g, red, blue) => { g.dv.setUint16(L.AO + L.HL_HELD, red, true); g.dv.setUint16(L.AO + L.HL_HELD + 2, blue, true); };

// The hill's news from the running count `from` on: [what, owner, shot].
const news = (g, from) => fxs(g.v, L.FX_MODE, undefined, from).filter((f) => f.size >= L.MX_AM + 24 && f.size < L.MX_AM + 32).map((f) => [f.size, f.owner, f.shot]);
const [MOVE, TAKE, CONTEST] = [L.HL_MX_MOVE, L.HL_MX_TAKE, L.HL_MX_CONTEST];

// The news gap up: the next change of hands is news at once.
const gapUp = (g) => g.dv.setUint32(L.AO + L.HL_SAIDAT, g.v.tick - L.HL_NEWSGAP, true);

// The hill moves on to hill k on the next tick (its time up, the one before it in the map's order).
function goHill(g, k) {
  const n = u32(g, L.MAP_NHILL);
  g.dv.setUint32(L.AO + L.HL_AT, (k + n - 1) % n, true);
  g.dv.setUint32(L.AO + L.HL_MOVES, g.v.tick, true);
  g.step();
  assert.equal(hill(g).at, k);
}

// Slots well away from every hill, on open ground.
const away = (g, slots) => slots.forEach((p, i) => put(g, p, 470, 540 + 3 * i));
// p on the hill dx, dz from its centre, its feet at the hill's height plus dy.
const on = (g, p, dx = 0, dz = 0, dy = 0) => { const h = hill(g); put(g, p, h.pos[0] + dx, h.pos[2] + dz, h.pos[1] + dy); };

test('King of the Hill: the first hill drawn as play starts, where it stands resolved; then the map\'s order every HL_MOVE, with news at the new hill; none on the clock\'s last tick', async () => {
  const g = await room(L.M_HILL, 2);
  let h = hill(g);
  assert.equal(u32(g, L.AH_TARGET), L.HL_TARGET);
  assert.equal(u32(g, L.MAP_NHILL), MAP.hills.length);
  assert.ok(h.at < MAP.hills.length);
  assert.equal(h.moves, g.v.hole().start + L.HL_MOVE, 'HL_MOVE from play\'s first tick');
  assert.deepEqual([h.pos[0], h.pos[2], h.r], [MAP.hills[h.at][0], MAP.hills[h.at][1], MAP.hills[h.at][3]].map(Math.fround));
  assert.equal(+h.pos[1].toFixed(2), FEET[h.at]);
  // drawn: rooms on other seeds start on every hill
  const firsts = new Set([h.at]);
  for (let s = 1; s <= 40 && firsts.size < MAP.hills.length; s++) firsts.add(hill(await room(L.M_HILL, 1, s)).at);
  assert.equal(firsts.size, MAP.hills.length, 'every hill a first');
  // it stays until its tick, then moves on to the next, HL_MOVE more
  const first = h.at;
  let from = g.v.fxCount();
  while (g.v.tick < h.moves) g.step();
  assert.deepEqual([hill(g).at, news(g, from)], [first, []]);
  g.step();
  let k = (first + 1) % MAP.hills.length;
  h = hill(g);
  assert.deepEqual([h.at, h.moves], [k, g.v.tick - 1 + L.HL_MOVE]);
  const fx = fxs(g.v, L.FX_MODE, MOVE, from);
  assert.deepEqual(fx.map((f) => [f.owner, f.shot, f.tick, ...f.pos]), [[255, k, g.v.tick - 1, ...h.pos]], 'news at the new hill, owner nobody');
  // every hill in the map's order, round to the first again, each standing where it should: the roofs (not the rooms under them), the rocks, the cave
  const order = [];
  for (let i = 0; i < MAP.hills.length; i++) {
    g.dv.setUint32(L.AO + L.HL_MOVES, g.v.tick, true);
    g.step();
    h = hill(g);
    order.push(h.at);
    assert.deepEqual([h.pos[0], h.pos[2], h.r, +h.pos[1].toFixed(2)], [...[MAP.hills[h.at][0], MAP.hills[h.at][1], MAP.hills[h.at][3]].map(Math.fround), FEET[h.at]]);
  }
  assert.deepEqual(order, order.map((_, i) => (k + 1 + i) % MAP.hills.length));
  // the clock's last tick is the hill's: the match ends and the hill stays
  from = g.v.fxCount();
  k = hill(g).at;
  g.dv.setUint32(L.AO + L.HL_MOVES, g.v.tick + 2, true);
  g.dv.setUint32(L.HDR_UNTIL, g.v.tick + 2, true);
  steps(g, 3);
  assert.deepEqual([g.v.hole().state, hill(g).at, news(g, from)], [L.H_OVER, k, []]);
});

test('King of the Hill: each side\'s live fighters on it (strictly within its radius across, HL_H up or down); more of one side holds it, as many each contests it, none leaves it nobody\'s; news as it changes hands', async () => {
  const g = await room(L.M_HILL, 6);
  const all = [0, 1, 2, 3, 4, 5];
  assert.deepEqual(sides(g, all), [0, 1, 0, 1, 0, 1]);
  away(g, all);
  goHill(g, 1); // red's roof: flat, 6 m across
  let h = hill(g);
  assert.deepEqual([h.hold, h.on, h.held], [0, [0, 0], [0, 0]]);
  const from = g.v.fxCount();
  const state = () => { const x = hill(g); return [x.hold, x.on]; };
  // the rim isn't on it; just inside is
  for (const [dx, dz] of [[6, 0], [0, -6], [-6, 0]]) {
    on(g, 0, dx, dz);
    g.step();
    assert.deepEqual(state(), [0, [0, 0]], `${dx}, ${dz}`);
  }
  on(g, 0, 5.99, 0);
  g.step();
  assert.deepEqual(state(), [1, [1, 0]], 'just inside');
  const fx = fxs(g.v, L.FX_MODE, TAKE, from);
  assert.deepEqual(fx.map((f) => [f.owner, f.shot, ...f.pos]), [[255, 1, ...h.pos]], 'at the hill\'s centre, owner nobody');
  // the band: HL_H over the roof is off it; the room under the roof, 4.8 m down, is off it
  on(g, 0, 0, 0, 2.1);
  g.step();
  assert.deepEqual(state(), [0, [0, 0]], 'over it');
  on(g, 0, 0, 0, 1.9);
  g.step();
  assert.deepEqual(state(), [1, [1, 0]], 'just within');
  put(g, 0, 390, 512, 21);
  g.step();
  assert.ok(Math.abs(g.v.fighter(0).pos[1] - 21) < 0.01 && Math.hypot(g.v.fighter(0).pos[0] - 392, g.v.fighter(0).pos[2] - 512) < 6, 'in the room');
  assert.deepEqual(state(), [0, [0, 0]], 'under it');
  assert.deepEqual(news(g, from), [[TAKE, 255, 1]], 'red taking it back off nobody isn\'t news');
  // hands change, a second each: red, contested, blue, contested, red, blue, nobody (from a new hill: the news has named nobody)
  goHill(g, 1);
  const spots = [[-3, 0], [-1.5, 1], [0, -1], [1.5, 1], [3, 0], [0, 3]];
  const hands = [[[0], 1, [1, 0]], [[0, 1], 3, [1, 1]], [[0, 1, 3], 2, [1, 2]], [[0, 1, 2, 3], 3, [2, 2]], [[0, 1, 2, 3, 4], 1, [3, 2]], [[1, 3], 2, [0, 2]], [[], 0, [0, 0]]];
  let n = g.v.fxCount();
  for (const [here, hold, count] of hands) {
    away(g, all);
    for (const p of here) on(g, p, ...spots[p]);
    steps(g, L.HL_NEWSGAP);
    assert.deepEqual(state(), [hold, count], `${here}`);
  }
  const said = fxs(g.v, L.FX_MODE, undefined, n).filter((f) => f.size === TAKE || f.size === CONTEST);
  assert.deepEqual(said.map((f) => [f.size, f.owner, f.shot]), [[TAKE, 255, 1], [CONTEST, 255, 3], [TAKE, 255, 2], [CONTEST, 255, 3], [TAKE, 255, 1], [TAKE, 255, 2]], 'one each time it changes hands; none as it goes back to nobody');
  assert.deepEqual(said.slice(1).map((f, i) => f.tick - said[i].tick), [1, 1, 1, 1, 1].map(() => L.HL_NEWSGAP), 'each on its hand\'s first tick');
  // the dead and those who left don't count: blue's two on it, one dies, the other leaves
  n = g.v.fxCount();
  on(g, 1, ...spots[1]); on(g, 3, ...spots[3]);
  g.step();
  assert.deepEqual(state(), [2, [0, 2]]);
  g.dv.setUint8(rec(1) + L.P_FL, fl(g, 1) | L.PF_DEAD); g.dv.setUint16(rec(1) + L.A_RESPAWN, 1000, true);
  g.step();
  assert.deepEqual(state(), [2, [0, 1]], 'a death');
  g.step([[L.EV_LEAVE, 3]]);
  assert.deepEqual(state(), [0, [0, 0]], 'a leave');
  assert.deepEqual(news(g, n), [], 'blue again after an empty hill: the news named blue last');
});

test('King of the Hill: its news at most one every HL_NEWSGAP: a change held back goes out as the gap is up if it still stands, and never if the hill went back; a crowd flickering on the rim, one a second at most', async () => {
  const g = await room(L.M_HILL, 8); // even slots red, odd blue
  const all = [0, 1, 2, 3, 4, 5, 6, 7];
  away(g, all);
  goHill(g, 0);
  const from = g.v.fxCount();
  const t0 = g.v.tick;
  on(g, 0);
  g.step();
  on(g, 1, 1.5, 0);
  steps(g, 10);
  assert.deepEqual([hill(g).hold, news(g, from)], [3, [[TAKE, 255, 1]]], 'red\'s at once; the contest held back');
  while (g.v.tick < t0 + L.HL_NEWSGAP) g.step();
  assert.equal(news(g, from).length, 1);
  g.step();
  const said = () => fxs(g.v, L.FX_MODE, undefined, from).filter((f) => f.size === TAKE || f.size === CONTEST);
  assert.deepEqual(said().map((f) => [f.size, f.shot, f.tick - t0]), [[TAKE, 1, 0], [CONTEST, 3, L.HL_NEWSGAP]], 'out as the gap is up');
  // blue alone for 50 ticks, then contested again: blue is never news
  away(g, [0]);
  steps(g, 50);
  assert.equal(hill(g).hold, 2);
  on(g, 0);
  steps(g, 2 * L.HL_NEWSGAP);
  assert.deepEqual([hill(g).hold, said().length], [3, 2]);
  // red's 2 in and out of the rim every two ticks, for 8 s: red, contested, red... a change every two ticks, a news a second at most
  const n = said().length;
  for (let i = 0; i < 1000; i++) {
    on(g, 2, i & 2 ? 7.9 : 8.1, 0);
    g.step();
  }
  const flick = said().slice(n);
  assert.ok(flick.length >= 7 && flick.length <= 9, `${flick.length} news`);
  assert.ok(flick.every((f, i) => i === 0 || f.tick - flick[i - 1].tick >= L.HL_NEWSGAP), flick.map((f) => f.tick).join(' '));
  assert.ok(flick.every((f, i) => i === 0 || f.size !== flick[i - 1].size), 'each one a change');
});

test('King of the Hill: every HL_POINT ticks a side holds it is a point for the side and for each of its fighters on it then; each side\'s count kept across a contest, nobody and a move', async () => {
  const g = await room(L.M_HILL, 6);
  const all = [0, 1, 2, 3, 4, 5]; // 0, 2, 4 red; 1, 3, 5 blue
  away(g, all);
  goHill(g, 0); // the middle
  on(g, 0, -1, 0); on(g, 2, 1, 0);
  g.step();
  assert.deepEqual([hill(g).hold, hill(g).held], [1, [1, 0]], 'counted from its first tick');
  steps(g, L.HL_POINT - 2);
  assert.deepEqual([scores(g), hill(g).held], [[0, 0], [L.HL_POINT - 1, 0]]);
  // 4 comes on the tick before the point, 2 goes: the point is 0's and 4's
  on(g, 4, 0, 1.5); away(g, [2]);
  g.step();
  assert.deepEqual([scores(g), hill(g).held, points(g, all)], [[1, 0], [0, 0], [1, 0, 0, 0, 1, 0]]);
  // red holds 60, a contest 50, nobody 30: red's count is kept, nothing scores
  away(g, all);
  on(g, 0);
  steps(g, 60);
  on(g, 1, 1.5, 0);
  steps(g, 50);
  assert.deepEqual([hill(g).hold, hill(g).held], [3, [60, 0]]);
  away(g, all);
  steps(g, 30);
  assert.deepEqual([hill(g).hold, hill(g).held, scores(g)], [0, [60, 0], [1, 0]]);
  // blue holds a full second (its own count), then red again: 65 more is red's point
  on(g, 1); on(g, 3, 1.5, 0);
  steps(g, L.HL_POINT);
  assert.deepEqual([scores(g), hill(g).held, points(g, all)], [[1, 1], [60, 0], [1, 1, 0, 1, 1, 0]]);
  away(g, all);
  on(g, 2);
  steps(g, L.HL_POINT - 61);
  assert.deepEqual([scores(g), hill(g).held], [[1, 1], [124, 0]]);
  g.step();
  assert.deepEqual([scores(g), hill(g).held, points(g, all)], [[2, 1], [0, 0], [1, 1, 1, 1, 1, 0]]);
  // a move: red's 100 on the middle carries over to red's roof; whoever holds the new hill takes it (news)
  steps(g, 100);
  away(g, all);
  goHill(g, 1); // nobody on it this tick
  on(g, 0); on(g, 4, 1.5, 0);
  const from = g.v.fxCount();
  gapUp(g);
  g.step();
  assert.deepEqual([hill(g).hold, hill(g).held], [1, [101, 0]]);
  steps(g, L.HL_POINT - 102);
  assert.deepEqual(scores(g), [2, 1]);
  g.step();
  assert.deepEqual([scores(g), points(g, all)], [[3, 1], [2, 1, 1, 1, 2, 0]]);
  // red holds the old hill and one of red's is on the new one as it comes up: news, it's a new hill
  steps(g, 10);
  put(g, 2, MAP.hills[2][0], MAP.hills[2][1], FEET[2]);
  gapUp(g);
  goHill(g, 2);
  assert.deepEqual(news(g, from), [[TAKE, 255, 1], [MOVE, 255, 2], [TAKE, 255, 1]]);
  assert.deepEqual([hill(g).hold, hill(g).on, hill(g).held], [1, [1, 0], [11, 0]]);
});

test('King of the Hill: over on the tick a side reaches HL_TARGET; at the clock the side ahead, or a draw; places by side, then points on the hill, then kills; the next match from zero', async () => {
  const g = await room(L.M_HILL, 4); // 0, 2 red; 1, 3 blue
  away(g, [0, 1, 2, 3]);
  goHill(g, 0);
  g.dv.setUint32(L.AH_SCORE, L.HL_TARGET - 1, true); g.dv.setUint32(L.AH_SCORE + 4, 70, true);
  held(g, L.HL_POINT - 2, 0);
  const mr = (p, pts, kills) => { g.dv.setUint16(L.MODE_REC + p * L.MR_SIZE + L.MR_POINTS, pts, true); g.dv.setUint16(rec(p) + L.A_KILLS, kills, true); };
  [[40, 1], [50, 9], [30, 9], [55, 2]].forEach(([pts, k], p) => mr(p, pts, k));
  on(g, 0);
  g.step();
  assert.deepEqual([g.v.hole().state, scores(g)], [L.H_PLAY, [L.HL_TARGET - 1, 70]]);
  const from = g.v.fxCount();
  g.step();
  assert.deepEqual([g.v.hole().state, scores(g), u32(g, L.AH_TEAMWIN)], [L.H_OVER, [L.HL_TARGET, 70], 1], 'over on its tick, red\'s');
  assert.deepEqual(fxs(g.v, L.FX_MODE, L.MX_TEAMWIN, from).map((f) => f.shot), [1]);
  assert.deepEqual(points(g, [0, 1, 2, 3]), [41, 50, 30, 55]);
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.fighter(p).place), [1, 4, 2, 3], 'red above blue, each by its points');
  // blue reaches it with two on, one of them arriving on the tick
  const b = await room(L.M_HILL, 4);
  away(b, [0, 1, 2, 3]);
  goHill(b, 4);
  b.dv.setUint32(L.AH_SCORE + 4, L.HL_TARGET - 1, true);
  on(b, 1);
  steps(b, L.HL_POINT - 1);
  on(b, 3, 1.5, 0);
  b.step();
  assert.deepEqual([b.v.hole().state, scores(b), u32(b, L.AH_TEAMWIN), points(b, [0, 1, 2, 3])], [L.H_OVER, [0, L.HL_TARGET], 2, [0, 1, 0, 1]]);
  // the clock: blue ahead by one
  const c = await room(L.M_HILL, 4);
  c.dv.setUint32(L.AH_SCORE, 40, true); c.dv.setUint32(L.AH_SCORE + 4, 41, true);
  endMatch(c);
  assert.deepEqual([c.v.hole().state, u32(c, L.AH_TEAMWIN)], [L.H_OVER, 2]);
  assert.deepEqual([0, 1, 2, 3].map((p) => c.v.fighter(p).place), [3, 1, 3, 1], 'blue first; nobody scored, so each side shares');
  // a draw: by points, then kills, across both sides
  const d = await room(L.M_HILL, 4);
  d.dv.setUint32(L.AH_SCORE, 41, true); d.dv.setUint32(L.AH_SCORE + 4, 41, true);
  [[10, 2], [10, 5], [7, 9], [3, 9]].forEach(([pts, k], p) => { d.dv.setUint16(L.MODE_REC + p * L.MR_SIZE + L.MR_POINTS, pts, true); d.dv.setUint16(rec(p) + L.A_KILLS, k, true); });
  endMatch(d);
  assert.equal(u32(d, L.AH_TEAMWIN), 3);
  assert.deepEqual([0, 1, 2, 3].map((p) => d.v.fighter(p).place), [2, 1, 3, 4]);
  // the next match from zero: a hill drawn anew, no counts, no scores, no points
  untilPlay(d);
  const h = hill(d);
  assert.deepEqual([scores(d), u32(d, L.AH_TEAMWIN), u32(d, L.AH_TARGET), points(d, [0, 1, 2, 3])], [[0, 0], 0, L.HL_TARGET, [0, 0, 0, 0]]);
  assert.deepEqual([h.held, h.moves, +h.pos[1].toFixed(2)], [[+(h.hold === 1), +(h.hold === 2)], d.v.hole().start + L.HL_MOVE, FEET[h.at]], 'one tick of play counted');
});

test('King of the Hill: nobody spawns on the hill, or within HL_BAR of its edge and HL_BAR_H up or down, while it\'s up: red\'s roof spawns closed, the room under it open', async () => {
  const g = await room(L.M_HILL, 8, 5);
  goHill(g, 1); // red's roof
  const h = hill(g);
  const sp = g.v.map().spawns; // [x, y, z], y resolved as the sim laid them
  const barred = (i) => Math.hypot(sp[i][0] - h.pos[0], sp[i][2] - h.pos[2]) < h.r + Number(L.HL_BAR) && Math.abs(sp[i][1] - h.pos[1]) < Number(L.HL_BAR_H);
  // spawns 3 and 4 are red's on its roof; 0, 1 and 2 in the room under it
  assert.deepEqual([0, 1, 2, 3, 4].map(barred), [false, false, false, true, true]);
  const reds = [0, 1, 2, 3, 4, 5, 6, 7].filter((p) => team(g, p) === 0);
  const used = new Set();
  for (let k = 0; k < 60; k++) {
    g.dv.setUint32(L.AO + L.HL_MOVES, g.v.tick + 1000, true);
    for (const p of reds) { g.dv.setUint8(rec(p) + L.P_FL, fl(g, p) | L.PF_DEAD); g.dv.setUint16(rec(p) + L.A_RESPAWN, 1, true); }
    g.step();
    for (const p of reds) {
      const f = g.v.fighter(p);
      const i = MAP.spawns.findIndex((s) => s.x === f.pos[0] && s.z === f.pos[2]);
      assert.ok(i >= 0 && !barred(i), `P${p} at spawn ${i}`);
      used.add(i);
    }
  }
  assert.ok([0, 1, 2].some((i) => used.has(i)), 'the room under the roof still used');
  // the next hill away from it: the roof is open again
  goHill(g, 2);
  const seen = new Set();
  for (let k = 0; k < 80; k++) {
    g.dv.setUint32(L.AO + L.HL_MOVES, g.v.tick + 1000, true);
    for (const p of reds) { g.dv.setUint8(rec(p) + L.P_FL, fl(g, p) | L.PF_DEAD); g.dv.setUint16(rec(p) + L.A_RESPAWN, 1, true); }
    g.step();
    for (const p of reds) seen.add(MAP.spawns.findIndex((s) => s.x === g.v.fighter(p).pos[0] && s.z === g.v.fighter(p).pos[2]));
  }
  assert.ok(seen.has(3) || seen.has(4), 'the roof\'s spawns used again once the hill has moved on');
});

test('King of the Hill: as play starts nobody stands where the first hill bars, whatever hill comes up: the countdown\'s spawns on it come in again elsewhere on their half', async () => {
  const firsts = new Set();
  for (const seed of [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13]) {
    const g = await room(L.M_HILL, 16, seed);
    const h = hill(g);
    firsts.add(h.at);
    for (let p = 0; p < 16; p++) {
      const f = g.v.fighter(p);
      const near = Math.hypot(f.pos[0] - h.pos[0], f.pos[2] - h.pos[2]) < h.r + Number(L.HL_BAR) && Math.abs(f.pos[1] - h.pos[1]) < Number(L.HL_BAR_H);
      assert.ok(!near, `seed ${seed}: P${p} (${team(g, p) ? 'blue' : 'red'}) by hill ${h.at} as play starts`);
    }
  }
  assert.ok(firsts.has(1) || firsts.has(4), `a roof hill came up first (${[...firsts]})`);
});

test('King of the Hill: joins and leaves mid-hill: a holder who leaves gives it up on its tick, its side\'s count kept; a rejoin starts from 0 points, on the side with fewer; a death leaves it', async () => {
  const g = await room(L.M_HILL, 5); // 0, 2, 4 red; 1, 3 blue
  away(g, [0, 1, 2, 3, 4]);
  goHill(g, 0);
  g.dv.setUint16(L.MODE_REC + L.MR_POINTS, 9, true);
  on(g, 0);
  steps(g, 30);
  assert.deepEqual([hill(g).hold, hill(g).held], [1, [30, 0]]);
  let from = g.v.fxCount();
  g.step([[L.EV_LEAVE, 0]]);
  assert.deepEqual([hill(g).hold, hill(g).on, hill(g).held, news(g, from)], [0, [0, 0], [30, 0], []]);
  // back in: red (two each without it), its points from 0, spawned on its own half
  g.step([[L.EV_JOIN, 0]]);
  assert.deepEqual([team(g, 0), g.v.fighter(0).points, hill(g).hold], [0, 0, 0]);
  // a join in play goes to blue, the side with fewer, and takes the hill with blue's other
  g.step([[L.EV_JOIN, 7]]);
  assert.equal(team(g, 7), 1);
  on(g, 7); on(g, 3, 1.5, 0);
  on(g, 0, -1.5, 0);
  g.step();
  assert.deepEqual([hill(g).hold, hill(g).on], [2, [1, 2]]);
  // red's 0 cuts 3 down with a sword where they stand: contested on that tick; then 0 alone against 7
  loadout(g, 0, L.W_SWORD);
  for (let i = 0; i < L.COOL_TICKS; i++) g.step();
  on(g, 0, 0, 1.5); on(g, 3, 0, 3.2); on(g, 7, -3, 0);
  from = g.v.fxCount();
  gapUp(g);
  swing(g, 0, 3);
  assert.ok(g.v.fighter(3).dead, 'a kill');
  assert.deepEqual([hill(g).hold, hill(g).on], [3, [1, 1]]);
  assert.deepEqual(news(g, from), [[CONTEST, 255, 3]]);
  // red's count kept from before blue came: its point when 7 goes
  away(g, [7]);
  steps(g, L.HL_POINT - 30);
  assert.deepEqual([scores(g), points(g, [0, 7])], [[1, 0], [1, 0]]);
});

test('King of the Hill: a fighter\'s own runs over the hill as its side scores, predicted from every tick, keep up bit for bit; the points are the confirmed world\'s', async () => {
  const g = await room(L.M_HILL, 3);
  away(g, [0, 1, 2]);
  goHill(g, 0);
  on(g, 2, 2, 2); // red holds it
  put(g, 0, 500, 512);
  held(g, 100, 0);
  const inputs = [];
  for (let k = 0; k < 600; k++) inputs.push(arenaWord({ yaw: k < 300 ? 0 : 8192, pitch: 512, move: k % 150 < 100 ? 1 : 0, jump: k % 90 === 40 ? 1 : 0 }));
  const wasOn = [];
  const compared = predicted(g, 0, inputs, () => {
    const h = hill(g), f = g.v.fighter(0);
    if (h.held[0] === 0) wasOn.push(Math.hypot(f.pos[0] - h.pos[0], f.pos[2] - h.pos[2]) < h.r && Math.abs(f.pos[1] - h.pos[1]) < 2);
  });
  assert.ok(compared > 600);
  assert.ok(wasOn.length >= 4 && wasOn.includes(true) && wasOn.includes(false), `${wasOn}`);
  assert.deepEqual([scores(g)[0], points(g, [0, 2])], [wasOn.length, [wasOn.filter((x) => x).length, wasOn.length]]);
});

test('a Fiesta after a match of King of the Hill: its region exactly a Fiesta\'s (the mode header, the hill, the records, no pads, no sides)', async () => {
  const g = await room(null, 4);
  g.dv.setUint32(L.HDR_HOLE, L.ARENA_MODES.indexOf(L.M_HILL) - 1, true);
  endMatch(g);
  untilPlay(g);
  assert.equal(g.v.mode().mode, L.M_HILL);
  // a match of it leaves all of it dirty: the hill held and contested, points, scores, pads, sides
  away(g, [0, 1, 2, 3]);
  goHill(g, 1);
  on(g, 0); on(g, 2, 1.5, 0); on(g, 1, -1.5, 0);
  steps(g, 3 * L.HL_POINT);
  on(g, 3, 0, 1.5);
  steps(g, 10);
  const h = hill(g);
  assert.deepEqual([h.hold, h.on, scores(g), points(g, [0, 1, 2, 3])], [3, [2, 2], [3, 0], [3, 0, 3, 0]]);
  assert.ok(g.v.pads().length > 0 && sides(g, [0, 1, 2, 3]).includes(1));
  g.dv.setUint32(L.HDR_HOLE, L.ARENA_MODES.length - 1, true); // the next match is the rotation's Fiesta
  endMatch(g);
  assert.equal(u32(g, L.AH_TEAMWIN), 1);
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
  // and stays so through play, fighters standing where the hill was
  away(g, [0, 1, 2, 3]);
  put(g, 0, 392, 512, FEET[1]); put(g, 1, 512, 512);
  steps(g, 2 * L.HL_POINT);
  check();
});

test('King of the Hill\'s client module: the hill drawn in its holder\'s colour with its waypoint, its HUD lines, its news, the board\'s column, the AI fighter\'s goal', async () => {
  const g = await room(L.M_HILL, 4); // 0, 2 red; 1, 3 blue
  const kit = AMC[L.M_HILL];
  away(g, [0, 1, 2, 3]);
  goHill(g, 1); // red's roof
  const h = hill(g);
  assert.deepEqual(hillOf(g.v), { at: 1, moves: h.moves, pos: h.pos, r: 6, hold: 0, on: [0, 0], held: [0, 0] });
  const draw = (slot, now = 0, cam = [470, 30, 540], shown = slot) => {
    const out = { solid: [], glow: [], beams: [], markers: [], zone: null };
    kit.draw(g.v, { now, slot, shown, me: slot >= 0 ? g.v.fighter(slot) : null, cam, view: g.v }, out);
    return out;
  };
  // nobody's: white, pulsing softly, painted only within HL_H of the roof; lights round the rim, a pillar, its waypoint
  let out = draw(0);
  assert.deepEqual(out.zone, { x: 392, z: 512, r: 6, y: h.pos[1], h: 2, color: [0.92, 0.92, 0.88], pulse: 0.35 });
  assert.ok(out.glow.length === 12 && out.glow.every((x) => Math.abs(Math.hypot(x.pos[0] - 392, x.pos[2] - 512) - 6 * 0.97) < 1e-6 && Math.abs(x.pos[1] - h.pos[1] - 0.35) < 1e-6), 'the rim, on the roof');
  assert.deepEqual(out.beams.map((b) => [b.a, b.b]), [[[392, h.pos[1] + 2, 512], [392, h.pos[1] + 30, 512]]]);
  assert.deepEqual(out.markers, [{ pos: [392, h.pos[1] + 8, 512], label: 'HILL', color: C.WHITE, kind: 'hill' }]);
  // red holds it: red; HOLD to red, HILL in red to blue, nothing over the head of the one on it; no pillar close by
  on(g, 0);
  g.step();
  assert.deepEqual([draw(2).zone.color, draw(2).zone.pulse, draw(2).markers[0].label, draw(1).markers[0].label, draw(1).markers[0].color], [SIDE_RGB[0], 1, 'HOLD', 'HILL', C.RED]);
  assert.deepEqual([draw(0).markers, draw(2, 0, [395, 27, 515]).beams], [[], []]);
  assert.deepEqual([draw(-1, 0, undefined, 0).markers, draw(-1, 0, undefined, 2).markers[0].label], [[], 'HOLD'], 'a spectator: as the one it watches');
  assert.deepEqual([20, 50, 120].map((m) => draw(2, 0, [392 + m, 30, 512]).markers[0].pos[1] - h.pos[1]), [3, 5, 8], 'the waypoint higher further off');
  // contested: flashing red and blue
  on(g, 1, 1.5, 0);
  g.step();
  assert.deepEqual([draw(2, 100).zone.color, draw(2, 400).zone.color, draw(2, 700).zone.color], [SIDE_RGB[0], SIDE_RGB[1], SIDE_RGB[0]]);
  // the HUD: who has it, when it moves (on the last hill, the target), who's on it (or how it stands for you,
  // on it); each line within cols 1 to 26, clear of the shields and the score bar
  const hud = (slot, view = g.v) => { const lines = []; kit.hud(view, { put: (x, y, s, c) => lines.push([x, y, s, c]), C, me: g.v.fighter(slot), team: team(g, slot) }); return lines; };
  const fits = (lines) => lines.every(([x, , s]) => x >= 1 && x + s.length - 1 <= 26);
  const left = (n) => `${Math.floor(n / 125 / 60)}:${String(Math.floor(n / 125) % 60).padStart(2, '0')}`;
  const moves = `MOVES IN ${left(h.moves - g.v.tick)}`;
  assert.deepEqual(hud(2), [[1, 2, 'HILL: CONTESTED', C.YELLOW], [1, 3, moves, C.GREY], [1, 4, 'ON IT', C.GREY], [7, 4, 'RED 1', C.RED], [13, 4, 'BLUE 1', C.CYAN]]);
  assert.deepEqual(hud(0)[2], [1, 4, 'CONTESTED: CLEAR THEM OFF', C.YELLOW]);
  const last = Object.assign(Object.create(g.v), { hole: () => ({ ...g.v.hole(), until: h.moves }) });
  assert.deepEqual(hud(2, last)[1], [1, 3, 'FIRST TO 100 SECONDS', C.GREY], 'the last hill');
  assert.ok([hud(0), hud(2), hud(2, last)].every(fits));
  away(g, [1]);
  g.step();
  assert.deepEqual([hud(0)[0], hud(0)[2], hud(1)[0]], [[1, 2, 'HILL: RED', C.RED], [1, 4, 'YOU ARE HOLDING IT', C.RED], [1, 2, 'HILL: RED', C.RED]]);
  // the news, told to each side
  for (const p of [0, 1]) {
    const said = [], shown = [], glows = [];
    const ctx = { slot: p, me: g.v.fighter(p), view: g.v, C, feed: (t, c) => said.push([t, c]), banner: (t, c) => shown.push([t, c]), glow: (x) => glows.push(x) };
    for (const [size, shot] of [[MOVE, 2], [TAKE, 2], [CONTEST, 3]]) kit.news({ size, owner: 255, shot, pos: h.pos }, ctx);
    assert.deepEqual(said, [['THE HILL MOVED', C.YELLOW], ['BLUE HAS THE HILL', C.CYAN], ['THE HILL IS CONTESTED', C.YELLOW]]);
    assert.deepEqual(shown.map((x) => x[0]), ['THE HILL MOVED', p ? 'YOUR SIDE HAS THE HILL' : 'BLUE HAS THE HILL', 'THE HILL IS CONTESTED']);
    assert.equal(glows.length, 3);
  }
  // the board's column: seconds on a held hill
  g.dv.setUint16(L.MODE_REC + L.MR_POINTS, 37, true);
  assert.deepEqual([kit.cols.map((c) => c.head), kit.cols[0].get(g.v.fighter(0))], [['HILL'], '37']);
  // the goal, attacker or defender: the hill at a run, held from two thirds of its radius in
  for (const role of ['attack', 'defend']) assert.deepEqual(kit.goal(g.v, g.v.fighter(3), { role }), { pos: h.pos, r: 4, hurry: 0.6, hold: true });
  assert.deepEqual(kit.state(g.v), { hill: 1, hold: 1, on: [1, 0], moves: h.moves, score: scores(g), target: L.HL_TARGET });
  // the next match's countdown: no hill yet, nothing drawn, no goal
  endMatch(g);
  while (g.v.hole().state !== L.H_COUNT) g.step();
  out = draw(0);
  assert.deepEqual([hillOf(g.v), out.zone, out.markers, kit.goal(g.v, g.v.fighter(0), {})], [null, null, [], null]);
});

test('King of the Hill: a lone AI fighter of either side gets onto every hill from where it spawns: the field, both roofs by their bridges, the rocks, the cave', async () => {
  const took = [];
  for (let k = 0; k < MAP.hills.length; k++) {
    for (const side of [0, 1]) {
      const g = await room(L.M_HILL, 2, 3);
      goHill(g, k);
      const bot = new Fighter(side, 3, 0.6), other = 1 - side;
      let t = 0, word = -1;
      for (; t < 50 * 125 && !hill(g).on[side]; t++) {
        g.dv.setUint8(rec(other) + L.P_FL, fl(g, other) | L.PF_DEAD); g.dv.setUint16(rec(other) + L.A_RESPAWN, 1000, true);
        const w = bot.think(g.v, g.v.tick, 0);
        g.step(w !== word ? [[L.EV_INPUT, side, w]] : []);
        word = w;
      }
      took.push(`${k}${'rb'[side]} ${(t / 125).toFixed(1)}`);
      assert.ok(hill(g).on[side], `hill ${k}, ${['red', 'blue'][side]}: still off it after 50 s at ${g.v.fighter(side).pos.map((x) => x.toFixed(1))}`);
    }
  }
  console.log(`  seconds to get on each hill: ${took.join(', ')}`);
});

test('King of the Hill with 8 and 16 AI fighters: no trap on the debug build, the same hash on every tick on 1 and 4 threads; both sides hold the hill and score, every hill it comes to is held, it moves on its ticks, its news a second apart at most', async () => {
  const [debug, bytes] = [arenaBytes(true), arenaBytes()];
  const ticks = 20000;
  for (const bots of [8, 16]) {
    const seen = { moves: [], hold: [0, 0, 0, 0], best: [0, 0], hills: new Map(), news: [], start: -1 };
    let last = -1, fx = 0;
    const { log, mode } = await playArena({ bytes: debug, seed: forcedSeed(L.M_HILL), bots, ticks, leaveAt: 3000,
      onTick: (t, v) => {
        for (; fx < v.fxCount(); fx++) { const f = v.fx(fx); if (f.kind === L.FX_MODE && (f.size === TAKE || f.size === CONTEST)) seen.news.push(f.tick); }
        if (v.hole().state !== L.H_PLAY) return;
        if (v.hole().start !== seen.start) { seen.start = v.hole().start; last = -1; } // a match: its moves from its own start
        const at = v.dv.getUint32(L.AO + L.HL_AT, true), hold = v.dv.getUint32(L.AO + L.HL_HOLD, true);
        if (last >= 0 && at !== last) seen.moves.push(v.tick - 1 - seen.start);
        last = at;
        seen.hold[hold]++;
        const k = `${v.hole().hole}:${at}`;
        seen.hills.set(k, (seen.hills.get(k) || 0) + (hold === 1 || hold === 2));
        seen.best = seen.best.map((b, i) => Math.max(b, v.dv.getUint32(L.AH_SCORE + 4 * i, true)));
      } });
    assert.equal(mode.mode, L.M_HILL);
    console.log(`  ${bots} fighters: ticks nobody/red/blue/contested ${seen.hold.join('/')}, points to ${seen.best.join(' and ')}, moves at ${seen.moves.join(', ')}, `
      + `ticks held on each hill ${[...seen.hills].map(([k, n]) => `${k} ${n}`).join(', ')}, ${seen.news.length} news`);
    assert.deepEqual(seen.moves.slice(0, 2), [L.HL_MOVE, 2 * L.HL_MOVE], `${bots}: moved on its ticks`);
    assert.ok(seen.hold[1] > 1000 && seen.hold[2] > 1000, `${bots}: both sides held it`);
    assert.ok(seen.best[0] >= 10 && seen.best[1] >= 10, `${bots}: both sides scored`);
    assert.ok(seen.hills.size >= 3 && [...seen.hills.values()].every((n) => n > 0), `${bots}: every hill held`);
    assert.ok(seen.news.every((t, i) => i === 0 || t - seen.news[i - 1] >= L.HL_NEWSGAP), `${bots}: news gaps`);
    const parsed = parseLog(log);
    const a = await replay({ bytes, log: parsed, ticks, threads: 1, tag: `hl${bots}-1` });
    const b = await replay({ bytes, log: parsed, ticks, threads: 4, tag: `hl${bots}-4`, startWorkers });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
  }
});
