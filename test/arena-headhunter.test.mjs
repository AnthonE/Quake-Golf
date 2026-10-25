import test from 'node:test';
import assert from 'node:assert/strict';
import { arenaBytes } from './helpers.mjs';
import { View, arenaWord, forcedSeed } from '../src/arena-view.mjs';
import { aimAt } from '../client/bot.mjs';
import { playArena } from '../tools/genarena.mjs';
import { compileMap } from '../tools/map.mjs';
import { replay, parseLog, decodeTrace, newMemory, instantiate, Sim } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { AMC, SIDE_C } from '../client/am/index.mjs';
import hh, { zoneOf, pilesOf, inZone } from '../client/am/headhunter.mjs';
import { C } from '../client/font.mjs';
import * as L from '../src/layout.mjs';
import * as AC from '../src/am/consts.mjs';

// Headhunter (src/am/headhunter.wat, client/am/headhunter.mjs): skulls
// dropped by every death, taken by touch, banked in a zone that moves round
// the map's hills. Helpers as test/arena-hill.test.mjs and
// test/arena-oddball.test.mjs have them; the zone, the piles and what each
// slot carries read straight from AO (its fields in src/am/headhunter.mjs).

// A room on the debug build: n fighters in, stepped to play. mode forces every
// match through the seed; null plays the rotation.
let debugModule = null;
async function room(n = 2, { seed = 7, mode = L.M_HEADHUNT } = {}) {
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
const points = (g, slots) => slots.map((p) => g.dv.getUint16(L.MODE_REC + p * L.MR_SIZE + L.MR_POINTS, true));
const setPoints = (g, p, n) => g.dv.setUint16(L.MODE_REC + p * L.MR_SIZE + L.MR_POINTS, n, true);
const MAP = compileMap();
const FEET = [19.69, 25.8, 23.4, 21, 25.8, 23.4]; // where each of Blood Gulch's hills stands (test/map.test.mjs)
const steps = (g, n, recs) => { for (let i = 0; i < n; i++) g.step(recs); };

function put(g, p, x, z, y = g.v.height(x, z)) {
  g.dv.setFloat32(rec(p) + L.P_PX, x, true);
  g.dv.setFloat32(rec(p) + L.P_PY, y, true);
  g.dv.setFloat32(rec(p) + L.P_PZ, z, true);
  for (const o of [L.P_VX, L.P_VY, L.P_VZ]) g.dv.setFloat32(rec(p) + o, 0, true);
}
// Slots well away from every hill, on open ground, 3 m apart.
const away = (g, slots) => slots.forEach((p, i) => put(g, p, 470, 540 + 3 * i));
// p dead by hand (no kill, no hook), `ticks` before it respawns
const dead = (g, p, ticks = 2000) => { g.dv.setUint8(rec(p) + L.P_FL, fl(g, p) | L.PF_DEAD); g.dv.setUint16(rec(p) + L.A_RESPAWN, ticks, true); };

// What slot p carries: AO's count and its record's MR_AUX, which agree.
function carried(g, p) {
  const a = g.dv.getUint16(L.AO + AC.HH_CARRY + 2 * p, true), b = g.dv.getUint16(L.MODE_REC + p * L.MR_SIZE + L.MR_AUX, true);
  assert.equal(a, b, `P${p}: AO's count and MR_AUX`);
  return a;
}
const carries = (g, slots) => slots.map((p) => carried(g, p));
// p carries n, both counts, by hand
const give = (g, p, n) => { g.dv.setUint16(L.AO + AC.HH_CARRY + 2 * p, n, true); g.dv.setUint16(L.MODE_REC + p * L.MR_SIZE + L.MR_AUX, n, true); };

// The piles lying, as AO holds them: { k, pos, n, left }, by place.
const pileAt = (k) => L.AO + AC.HH_PILES + k * AC.HH_PILE_SIZE;
function piles(g) {
  const out = [];
  for (let k = 0; k < AC.HH_NPILE; k++) {
    const a = pileAt(k), n = g.dv.getUint16(a + 12, true);
    if (n) out.push({ k, pos: [0, 4, 8].map((o) => g.dv.getFloat32(a + o, true)), n, left: g.dv.getUint16(a + 14, true) });
    else assert.equal(g.dv.getUint16(a + 14, true), 0, `place ${k}: no pile, no time`);
  }
  return out;
}
// A pile laid by hand in place k.
function lay(g, k, x, y, z, n, left = 1000) {
  const a = pileAt(k);
  [x, y, z].forEach((c, i) => g.dv.setFloat32(a + 4 * i, c, true));
  g.dv.setUint16(a + 12, n, true);
  g.dv.setUint16(a + 14, left, true);
}
const clearPiles = (g) => { for (let k = 0; k < AC.HH_NPILE; k++) g.dv.setUint32(pileAt(k) + 12, 0, true); };

// The zone as AO holds it.
function zone(g) {
  const f = (o) => g.dv.getFloat32(L.AO + o, true);
  return { at: u32(g, L.AO + AC.HH_AT), moves: u32(g, L.AO + AC.HH_MOVES), pos: [f(AC.HH_X), f(AC.HH_Y), f(AC.HH_Z)], r: f(AC.HH_R) };
}
// The zone moves on to hill k on the next tick (its time up, the one before it in the map's order).
function goZone(g, k) {
  const n = u32(g, L.MAP_NHILL);
  g.dv.setUint32(L.AO + AC.HH_AT, (k + n - 1) % n, true);
  g.dv.setUint32(L.AO + AC.HH_MOVES, g.v.tick, true);
  g.step();
  assert.equal(zone(g).at, k);
}
// p in the zone dx, dz from its centre, its feet at the zone's height plus dy.
const on = (g, p, dx = 0, dz = 0, dy = 0) => { const z = zone(g); put(g, p, z.pos[0] + dx, z.pos[2] + dz, z.pos[1] + dy); };

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
// p's melee at q on open ground at (x, z), q `gap` m off facing p and pressing nothing.
function melee(g, p, q, { gap = 2, x = 500, z = 510 } = {}) {
  put(g, p, x, z); put(g, q, x + gap, z);
  const w = still(g, p);
  g.step([[L.EV_INPUT, q, arenaWord({ yaw: 8192, ...still(g, q) })], [L.EV_INPUT, p, at(g, p, q, 1.0, { ...w, melee: w.melee ^ 1 })]]);
  assert.ok(g.v.fighter(q).dead, `P${p} kills P${q}`);
}
// A frag of p's about to go off at (x, z), on the ground or at height y.
function frag(g, p, x, z, y = g.v.height(x, z)) {
  const j = L.PROJ;
  g.dv.setFloat32(j + L.J_PX, x, true); g.dv.setFloat32(j + L.J_PY, y + 0.12, true); g.dv.setFloat32(j + L.J_PZ, z, true);
  for (const o of [L.J_VX, L.J_VY, L.J_VZ]) g.dv.setFloat32(j + o, 0, true);
  g.dv.setUint16(j + L.J_AGE, L.A_FUSE - 1, true); g.sim.u8[j + L.J_KIND] = L.K_GRENADE; g.sim.u8[j + L.J_OWNER] = p;
}
// p dies by its own frag where it stands (put there first if x, z given).
function suicide(g, p, x, z, y) {
  if (x !== undefined) put(g, p, x, z, y);
  const pos = g.v.fighter(p).pos;
  frag(g, p, pos[0], pos[2], pos[1]);
  g.dv.setUint8(rec(p) + L.A_SH, 0); g.dv.setUint8(rec(p) + L.A_HP, 10);
  g.step();
  assert.ok(g.v.fighter(p).dead, `P${p} by its own frag`);
}
const respawned = (g, p) => { while (g.v.fighter(p).dead) g.step(); };

// FX of a kind (and size) from the running count `from` on, at most the ring's last FX_MAX
function fxs(v, kind, size, from = 0) {
  const out = [];
  for (let k = Math.max(from, v.fxCount() - L.FX_MAX); k < v.fxCount(); k++) {
    const f = v.fx(k);
    if (f.kind === kind && (size === undefined || f.size === size)) out.push(f);
  }
  return out;
}
// The mode's news from `from` on: [what, owner, shot].
const news = (g, from) => fxs(g.v, L.FX_MODE, undefined, from).filter((f) => f.size >= L.MX_AM + 32 && f.size < L.MX_AM + 40).map((f) => [f.size, f.owner, f.shot]);
const [BANK, MOVE, TAKE] = [AC.HH_MX_BANK, AC.HH_MX_MOVE, AC.HH_MX_TAKE];
const endMatch = (g) => { g.dv.setUint32(L.HDR_UNTIL, g.v.tick + 1, true); for (let i = 0; i < 4; i++) g.step(); };
const untilPlay = (g) => { while (g.v.hole().state !== L.H_PLAY) g.step(); g.step(); };
const near = (a, b, e = 1e-4) => a.every((x, i) => Math.abs(x - b[i]) < e);

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

test('Headhunter: nothing of it before play; the first zone drawn as play starts, where it stands; the map\'s order every HH_MOVE, news at the new zone; none on the clock\'s last tick; the target HH_PER a fighter on the larger side, at least HH_MIN', async () => {
  debugModule ||= await WebAssembly.compile(arenaBytes(true));
  const memory = newMemory();
  const sim = new Sim(await instantiate(debugModule, memory), memory);
  sim.init(forcedSeed(L.M_HEADHUNT));
  const cv = new View(memory.buffer);
  sim.feedPlayers([[L.EV_JOIN, 0], [L.EV_JOIN, 1]]);
  sim.x.step();
  let counted = 0;
  while (cv.hole().state !== L.H_PLAY) { assert.ok(sim.u8.slice(L.AO, L.AO + L.AO_SIZE).every((x) => x === 0), 'the countdown'); counted++; sim.x.step(); }
  assert.ok(counted > 300);
  const g = await room(2);
  let z = zone(g);
  assert.equal(u32(g, L.AH_TARGET), AC.HH_MIN);
  assert.equal(u32(g, L.MAP_NHILL), MAP.hills.length);
  assert.ok(z.at < MAP.hills.length);
  assert.equal(z.moves, g.v.hole().start + AC.HH_MOVE, 'HH_MOVE from play\'s first tick');
  assert.deepEqual([z.pos[0], z.pos[2], z.r], [MAP.hills[z.at][0], MAP.hills[z.at][1], MAP.hills[z.at][3]].map(Math.fround), 'the hill\'s own radius');
  assert.equal(+z.pos[1].toFixed(2), FEET[z.at]);
  assert.deepEqual([piles(g), carries(g, [0, 1])], [[], [0, 0]]);
  // drawn: rooms on other seeds start on every hill
  const firsts = new Set([z.at]);
  for (let s = 1; s <= 40 && firsts.size < MAP.hills.length; s++) firsts.add(zone(await room(1, { seed: s })).at);
  assert.equal(firsts.size, MAP.hills.length, 'every hill a first');
  // it stays until its tick, then moves on to the next, HH_MOVE more
  const first = z.at;
  let from = g.v.fxCount();
  while (g.v.tick < z.moves) g.step();
  assert.deepEqual([zone(g).at, news(g, from)], [first, []]);
  g.step();
  let k = (first + 1) % MAP.hills.length;
  z = zone(g);
  assert.deepEqual([z.at, z.moves], [k, g.v.tick - 1 + AC.HH_MOVE]);
  assert.deepEqual(fxs(g.v, L.FX_MODE, MOVE, from).map((f) => [f.owner, f.shot, f.tick, ...f.pos]), [[255, k, g.v.tick - 1, ...z.pos]], 'news at the new zone, owner nobody');
  // every hill in the map's order, round to the first again, each standing where it should (the roofs, not the rooms under them)
  const order = [];
  for (let i = 0; i < MAP.hills.length; i++) {
    g.dv.setUint32(L.AO + AC.HH_MOVES, g.v.tick, true);
    g.step();
    z = zone(g);
    order.push(z.at);
    assert.deepEqual([z.pos[0], z.pos[2], z.r, +z.pos[1].toFixed(2)], [...[MAP.hills[z.at][0], MAP.hills[z.at][1], MAP.hills[z.at][3]].map(Math.fround), FEET[z.at]]);
  }
  assert.deepEqual(order, order.map((_, i) => (k + 1 + i) % MAP.hills.length));
  // the clock's last tick is the zone's: the match ends and the zone stays
  from = g.v.fxCount();
  k = zone(g).at;
  g.dv.setUint32(L.AO + AC.HH_MOVES, g.v.tick + 2, true);
  g.dv.setUint32(L.HDR_UNTIL, g.v.tick + 2, true);
  steps(g, 3);
  assert.deepEqual([g.v.hole().state, zone(g).at, news(g, from)], [L.H_OVER, k, []]);
  // the target: 8 against 8 is HH_MIN; 9 against 8, and 10 against 10, HH_PER each on the larger side
  for (const [n, want] of [[16, AC.HH_MIN], [17, 9 * AC.HH_PER], [20, 10 * AC.HH_PER]]) assert.equal(u32(await room(n), L.AH_TARGET), want, `${n} fighters`);
});

test('Headhunter: every death drops what its fighter carried and one more, in a pile at its feet on what is under them, HH_LIFE to go counting its tick; by its own hand too; a body on it doesn\'t take it, the killer stepping on it does', async () => {
  const g = await room(4); // 0 and 2 red, 1 and 3 blue
  assert.deepEqual(sides(g, [0, 1, 2, 3]), [0, 1, 0, 1]);
  goZone(g, 1); // red's roof, out of the way
  away(g, [2, 3]);
  for (const p of [0, 1]) loadout(g, p, L.W_SWORD);
  steps(g, L.COOL_TICKS);
  give(g, 0, 3);
  let from = g.v.fxCount();
  melee(g, 1, 0);
  const f0 = g.v.fighter(0);
  let ps = piles(g);
  assert.deepEqual(ps.map((p) => [p.k, p.pos[0], p.pos[2], p.n, p.left]), [[0, f0.pos[0], f0.pos[2], 4, AC.HH_LIFE - 1]], 'three and one more, a tick gone');
  assert.ok(Math.abs(ps[0].pos[1] - g.v.height(f0.pos[0], f0.pos[2])) < 1e-3, 'on the ground');
  assert.deepEqual([carries(g, [0, 1, 2, 3]), news(g, from)], [[0, 0, 0, 0], []], 'the killer 2 m off didn\'t take it; a drop is no news');
  // the body lying on it doesn't take it (the killer, its lunge carrying it on, moved off)
  away(g, [1]);
  steps(g, 10);
  assert.deepEqual(piles(g).map((p) => [p.n, p.left]), [[4, AC.HH_LIFE - 11]]);
  // blue 1 steps onto red 0's pile: the whole of it, news at the pile
  put(g, 1, ps[0].pos[0], ps[0].pos[2]);
  from = g.v.fxCount();
  g.step();
  assert.deepEqual([piles(g), carried(g, 1)], [[], 4]);
  assert.deepEqual(fxs(g.v, L.FX_MODE, TAKE, from).map((f) => [f.owner, f.shot, ...f.pos]), [[1, 4, ...ps[0].pos]]);
  // by its own hand, in the air: what it carried and one, on the ground under it
  suicide(g, 1, 530, 512, g.v.height(530, 512) + 3);
  ps = piles(g);
  assert.deepEqual(ps.map((p) => [p.n, p.pos[0], p.pos[2], p.left]), [[5, 530, 512, AC.HH_LIFE - 1]]);
  assert.ok(Math.abs(ps[0].pos[1] - g.v.height(530, 512)) < 1e-3 && g.v.fighter(1).pos[1] > ps[0].pos[1] + 2, `from ${g.v.fighter(1).pos[1]} to ${ps[0].pos[1]}`);
  assert.equal(carried(g, 1), 0);
  // a death on blue's roof (a box over its room): the pile stays on the roof
  respawned(g, 0);
  give(g, 0, 1);
  suicide(g, 0, 632, 512, FEET[4]);
  assert.deepEqual(piles(g).filter((p) => p.pos[0] === 632).map((p) => [p.n, p.pos]), [[2, [632, Math.fround(FEET[4]), 512]]]);
  // nobody's death but its own takes from what it carries: blue 3 with 6 sees red 0 die and keeps them
  give(g, 3, 6);
  respawned(g, 0);
  suicide(g, 0, 470, 470);
  assert.deepEqual([carried(g, 3), piles(g).find((p) => p.pos[0] === 470)?.n], [6, 1]);
});

test('Headhunter: a death strictly within HH_MERGE_R across and HH_TOUCH_H up or down of a pile adds to the nearest (the lower place on a tie), its time starting again; farther off, a pile of its own in the first free place', async () => {
  const g = await room(8);
  goZone(g, 1);
  away(g, [0, 1, 2, 3, 4, 5, 6, 7]);
  const y = g.v.height(480, 470);
  const reset = () => { clearPiles(g); lay(g, 0, 480, y, 470, 2, 100); lay(g, 1, 481.5, y, 470, 3, 100); };
  const counts = () => piles(g).map((p) => [p.k, p.n, p.left]);
  // 1.9 m from place 0, 0.4 from place 1: onto 1, its time HH_LIFE again
  reset();
  give(g, 0, 4);
  suicide(g, 0, 481.9, 470);
  assert.deepEqual(counts(), [[0, 2, 99], [1, 8, AC.HH_LIFE - 1]]);
  assert.deepEqual(piles(g)[1].pos, [481.5, y, 470], 'it stays where it lay');
  // 1.95 m from 0 (3.45 from 1): onto 0
  reset();
  suicide(g, 1, 478.05, 470);
  assert.deepEqual(counts(), [[0, 3, AC.HH_LIFE - 1], [1, 3, 99]]);
  // 2.05 m from 0: a pile of its own, in the first free place
  reset();
  suicide(g, 2, 477.95, 470);
  assert.deepEqual(counts(), [[0, 2, 99], [1, 3, 99], [2, 1, AC.HH_LIFE - 1]]);
  assert.ok(near(piles(g)[2].pos, [477.95, g.v.height(477.95, 470), 470]));
  // a free place before others: place 0 taken away, the next pile goes there
  reset();
  g.dv.setUint32(pileAt(0) + 12, 0, true);
  suicide(g, 3, 470, 480);
  assert.deepEqual(counts(), [[0, 1, AC.HH_LIFE - 1], [1, 3, 99]]);
  // up or down: a pile 1.9 m over where a death lands takes it, 2.05 m over doesn't
  for (const [dy, adds] of [[1.9, true], [-1.9, true], [2.05, false], [-2.05, false]]) {
    clearPiles(g);
    lay(g, 0, 490, g.v.height(490, 470) + dy, 470, 2, 100);
    const p = [4, 5, 6, 7].find((q) => !g.v.fighter(q).dead);
    suicide(g, p, 490.5, 470);
    assert.deepEqual(counts(), adds ? [[0, 3, AC.HH_LIFE - 1]] : [[0, 2, 99], [1, 1, AC.HH_LIFE - 1]], `${dy} m`);
  }
  // as near two piles: the lower place
  for (const p of [0, 1, 2, 3]) respawned(g, p);
  clearPiles(g);
  lay(g, 5, 499, g.v.height(499, 470), 470, 2, 100); lay(g, 3, 501, g.v.height(501, 470), 470, 4, 100);
  suicide(g, 0, 500, 470);
  assert.deepEqual(counts(), [[3, 5, AC.HH_LIFE - 1], [5, 2, 99]]);
  // two deaths on one tick at one spot (a frag between them): one pile of both
  clearPiles(g);
  for (const p of [1, 2]) { g.dv.setUint8(rec(p) + L.A_SH, 0); g.dv.setUint8(rec(p) + L.A_HP, 10); }
  give(g, 2, 3);
  put(g, 1, 520, 470); put(g, 2, 520.6, 470);
  frag(g, 1, 520.3, 470); // blue 1's: it hurts its thrower and red 2
  g.step();
  assert.ok(g.v.fighter(1).dead && g.v.fighter(2).dead);
  assert.deepEqual(counts(), [[0, 5, AC.HH_LIFE - 1]], 'one and three and one');
});

test('Headhunter: a pile taken whole by the first fighter in slot order alive with its feet within HH_TOUCH_R across and HH_TOUCH_H up or down, either side; every pile it touches on one tick; the killer near enough on the tick of its kill', async () => {
  const g = await room(4); // 0 and 2 red, 1 and 3 blue
  goZone(g, 1);
  away(g, [0, 1, 2, 3]);
  const [x, z] = [500, 545];
  const y = g.v.height(x, z);
  // 1.55 m across: not near enough
  lay(g, 0, x, y, z, 3);
  put(g, 0, x + 1.55, z);
  steps(g, 5);
  assert.deepEqual(piles(g).map((p) => p.n), [3]);
  // all four inside 1.45 m: 0 is dead, so blue 1 has it, not red 2 or blue 3; on top of what it carried
  put(g, 0, x + 1.45, z); put(g, 1, x, z - 1.45); put(g, 2, x - 1.0, z + 1.0); put(g, 3, x, z + 0.5);
  dead(g, 0);
  give(g, 1, 2);
  let from = g.v.fxCount();
  g.step();
  assert.deepEqual([piles(g), carries(g, [0, 1, 2, 3])], [[], [0, 5, 0, 0]]);
  assert.deepEqual(fxs(g.v, L.FX_MODE, TAKE, from).map((f) => [f.owner, f.shot, ...f.pos]), [[1, 3, x, y, z]], 'news at the pile, owner who took it, shot how many');
  // the band: a pile 1.95 m over or under a fighter's feet is taken, 2.05 m isn't
  g.dv.setUint8(rec(0) + L.P_FL, fl(g, 0) & ~L.PF_DEAD);
  away(g, [0, 1, 3]);
  put(g, 2, 500, 560);
  g.step();
  const fy = g.v.fighter(2).pos[1];
  for (const [dy, taken] of [[2.05, false], [-2.05, false], [1.95, true], [-1.95, true], [0, true]]) {
    clearPiles(g);
    give(g, 2, 0);
    lay(g, 0, 500.5, fy + dy, 560.5, 1);
    g.step();
    assert.equal(carried(g, 2), taken ? 1 : 0, `${dy} m`);
  }
  // red 2 stands on two piles at once: both, news in place order; a third a step off stays
  clearPiles(g);
  give(g, 2, 0);
  lay(g, 4, 500.6, fy, 560, 2); lay(g, 9, 499.6, fy, 560.4, 5); lay(g, 2, 502, fy, 560, 1);
  from = g.v.fxCount();
  g.step();
  assert.deepEqual([carried(g, 2), piles(g).map((p) => p.k), news(g, from)], [7, [2], [[TAKE, 2, 2], [TAKE, 2, 5]]]);
  // two fighters by two piles: the one both touch goes to the lower slot, the other to the one touching it
  clearPiles(g);
  put(g, 1, 510, 560); put(g, 3, 511.8, 560);
  g.step();
  lay(g, 0, 510.9, g.v.fighter(1).pos[1], 560, 4); lay(g, 1, 512.5, g.v.fighter(3).pos[1], 560, 1);
  give(g, 1, 0); give(g, 3, 0);
  g.step();
  assert.deepEqual([carried(g, 1), carried(g, 3), piles(g)], [4, 1, []]);
  // it keeps its guns: no PF_CARRY, and it shoots
  assert.equal(fl(g, 1) & L.PF_CARRY, 0);
  put(g, 2, 525, 560);
  const mag = g.v.fighter(1).mag[g.v.fighter(1).hand];
  from = g.v.fxCount();
  for (let i = 0; i < 20; i++) {
    put(g, 1, 510, 560); put(g, 2, 525, 560);
    g.step([[L.EV_INPUT, 1, at(g, 1, 2, 1.2, { shot: (still(g, 1).shot + 1) & 3 })]]);
  }
  assert.ok(fxs(g.v, L.FX_SHOT, undefined, from).some((f) => f.owner === 1), 'a shot');
  assert.ok(g.v.fighter(1).mag[g.v.fighter(1).hand] < mag, 'the magazine went down');
  // the killer 1.2 m off takes its victim's pile on the tick of the kill
  for (const p of [0, 1, 2, 3]) loadout(g, p, L.W_SWORD);
  steps(g, L.COOL_TICKS);
  clearPiles(g);
  give(g, 1, 0); give(g, 2, 2);
  from = g.v.fxCount();
  melee(g, 1, 2, { gap: 1.2, x: 520, z: 470 });
  assert.deepEqual([carries(g, [1, 2]), piles(g), news(g, from)], [[3, 0], [], [[TAKE, 1, 3]]]);
});

test('Headhunter: a fighter alive in the zone banks every skull it carries, a point each for its side and its MR_POINTS, news at its feet; strictly inside its radius, HH_ZONE_H up or down (a roof, not the room under it); either side, both on one tick; a pile in the zone taken and banked on the tick', async () => {
  const g = await room(6); // 0, 2, 4 red; 1, 3, 5 blue
  const all = [0, 1, 2, 3, 4, 5];
  away(g, all);
  goZone(g, 1); // red's roof: flat, 6 m across
  give(g, 0, 2);
  // the rim isn't in it; just inside is
  for (const [dx, dz] of [[6, 0], [0, -6], [-6, 0]]) {
    on(g, 0, dx, dz);
    g.step();
    assert.deepEqual([carried(g, 0), scores(g)], [2, [0, 0]], `${dx}, ${dz}`);
  }
  on(g, 0, 5.99, 0);
  let from = g.v.fxCount();
  g.step();
  assert.deepEqual([carried(g, 0), scores(g), points(g, [0])], [0, [2, 0], [2]]);
  assert.deepEqual(fxs(g.v, L.FX_MODE, BANK, from).map((f) => [f.owner, f.shot, ...f.pos]), [[0, 2, ...g.v.fighter(0).pos]], 'at its feet');
  // without skulls, standing in it is nothing
  steps(g, 50);
  assert.deepEqual([scores(g), news(g, from).length], [[2, 0], 1]);
  // the band: 2.1 m over it is out, 1.9 m in; the room under the roof, 4.8 m down, is out
  give(g, 0, 1);
  on(g, 0, 0, 0, 2.1);
  g.step();
  assert.equal(carried(g, 0), 1, 'over it');
  put(g, 0, 390, 512, 21);
  g.step();
  assert.ok(Math.abs(g.v.fighter(0).pos[1] - 21) < 0.01, 'in the room');
  assert.equal(carried(g, 0), 1, 'under it');
  on(g, 0, 0, 0, 1.9);
  g.step();
  assert.deepEqual([carried(g, 0), scores(g)], [0, [3, 0]], 'just within');
  // blue banks in it as well as red, both on one tick
  away(g, [0]);
  give(g, 2, 3); give(g, 1, 4);
  on(g, 2, 1, 0); on(g, 1, -1, 0);
  from = g.v.fxCount();
  g.step();
  assert.deepEqual([scores(g), points(g, all), carries(g, all)], [[6, 4], [3, 4, 3, 0, 0, 0], [0, 0, 0, 0, 0, 0]]);
  assert.deepEqual(news(g, from), [[BANK, 1, 4], [BANK, 2, 3]], 'in slot order');
  // a pile lying in the zone: whoever stands on it takes it and banks it on that tick
  away(g, all);
  const zp = zone(g).pos;
  lay(g, 0, zp[0] + 2, zp[1], zp[2], 5);
  g.step();
  assert.deepEqual(piles(g).map((p) => p.n), [5], 'nobody on it');
  on(g, 3, 2, 0);
  from = g.v.fxCount();
  g.step();
  assert.deepEqual([scores(g), points(g, [3]), carried(g, 3), piles(g), news(g, from)], [[6, 9], [5], 0, [], [[TAKE, 3, 5], [BANK, 3, 5]]]);
  // the dead don't bank: a fighter dead in it with skulls (no kill seen) drops them where it stood, in the zone, for someone else
  on(g, 4, 0, 2);
  g.step();
  give(g, 4, 2);
  dead(g, 4);
  g.step();
  assert.deepEqual([scores(g), carried(g, 4), piles(g).map((p) => [p.n, p.pos[0], p.pos[2]])], [[6, 9], 0, [[2, zp[0], zp[2] + 2]]]);
  // the zone moves: banking is where it is now
  give(g, 5, 3);
  on(g, 5, -3, 0);
  goZone(g, 4);
  assert.deepEqual([carried(g, 5), scores(g)], [3, [6, 9]], 'red\'s roof is nothing now');
  on(g, 5);
  g.step();
  assert.deepEqual([carried(g, 5), scores(g)], [0, [6, 12]], 'blue\'s roof');
});

test('Headhunter: a pile lies HH_LIFE ticks counting the one it was laid on, unless taken; added to, its time starts again; with every place taken the oldest gives way, the lower place on a tie', async () => {
  const g = await room(4);
  goZone(g, 1);
  away(g, [0, 1, 2, 3]);
  suicide(g, 0, 500, 470);
  assert.deepEqual(piles(g).map((p) => [p.n, p.left]), [[1, AC.HH_LIFE - 1]]);
  steps(g, AC.HH_LIFE - 2);
  assert.deepEqual(piles(g).map((p) => [p.n, p.left]), [[1, 1]], 'a tick to go');
  let from = g.v.fxCount();
  g.step();
  assert.deepEqual([piles(g), news(g, from)], [[], []], 'gone, and no news of it');
  // a death on it with 100 ticks to go: its time starts again
  lay(g, 0, 510, g.v.height(510, 470), 470, 3, 100);
  steps(g, 50);
  suicide(g, 1, 510.5, 470);
  assert.deepEqual(piles(g).map((p) => [p.n, p.left]), [[4, AC.HH_LIFE - 1]]);
  // someone on it the tick its time is up: it's gone first
  clearPiles(g);
  lay(g, 0, 470, g.v.height(470, 540), 540, 2, 1);
  put(g, 2, 470, 540);
  g.step();
  assert.deepEqual([piles(g), carried(g, 2)], [[], 0]);
  // every place taken: the oldest gives way to a death far from them all (7 and 12 the oldest: 7 first, then 12, then 0)
  respawned(g, 0); respawned(g, 1);
  away(g, [0, 1, 2, 3]);
  clearPiles(g);
  for (let k = 0; k < AC.HH_NPILE; k++) lay(g, k, 400 + 4 * k, g.v.height(400 + 4 * k, 600), 600, 1 + (k % 3), k === 7 || k === 12 ? 500 : 900 + k);
  for (const [p, gone] of [[0, 7], [1, 12], [2, 0]]) {
    const was = piles(g);
    suicide(g, p, 520, 470 + 4 * p);
    const now = piles(g);
    assert.equal(now.length, AC.HH_NPILE);
    assert.deepEqual([now[gone].n, now[gone].left, now[gone].pos[0], now[gone].pos[2]], [1, AC.HH_LIFE - 1, 520, 470 + 4 * p], `place ${gone} gave way`);
    assert.ok(now.every((q, k) => k === gone || (q.n === was[k].n && q.left === was[k].left - 1)), 'the others kept');
  }
});

test('Headhunter: joins and leaves mid-objective: a fighter who leaves drops what it carried, no more, where it stood; its slot taken again on one tick likewise, the new fighter with nothing; dead with no kill, the same; a join goes to the side with fewer', async () => {
  const g = await room(3); // 0, 2 red; 1 blue
  goZone(g, 1);
  away(g, [0, 1, 2]);
  // blue 1 leaves with 3: a pile of 3 where it stood
  give(g, 1, 3);
  put(g, 1, 520, 520);
  g.step();
  let where = g.v.fighter(1).pos;
  let from = g.v.fxCount();
  g.step([[L.EV_LEAVE, 1]]);
  assert.deepEqual([piles(g).map((p) => [p.n, p.pos, p.left]), carried(g, 1), news(g, from)], [[[3, where, AC.HH_LIFE - 1]], 0, []]);
  // red 2 with 4 leaves, and its slot is taken again on the same tick: the pile where it stood; the new 2 has nothing, and is blue
  clearPiles(g);
  give(g, 2, 4);
  put(g, 2, 540, 520);
  g.step();
  where = g.v.fighter(2).pos;
  g.step([[L.EV_LEAVE, 2], [L.EV_JOIN, 2]]);
  assert.deepEqual([piles(g).map((p) => [p.n, p.pos]), carried(g, 2), points(g, [2]), team(g, 2)], [[[4, where]], 0, [0], 1]);
  // a join in play goes to the side with fewer: red, two each now
  g.step([[L.EV_JOIN, 1]]);
  assert.deepEqual([team(g, 1), carried(g, 1)], [0, 0]);
  // dead with no kill (by hand): what it carried, no more, where it stood
  clearPiles(g);
  away(g, [0, 1, 2]);
  give(g, 0, 2);
  g.step();
  where = g.v.fighter(0).pos;
  dead(g, 0);
  g.step();
  assert.deepEqual([piles(g).map((p) => [p.n, p.pos]), carried(g, 0)], [[[2, where]], 0]);
  // a slot taken again and killed on that tick, before the tick hook sees it: the last
  // fighter's skulls where it stood the tick before, the new one's one at its feet
  clearPiles(g);
  for (const p of [1, 2]) loadout(g, p, L.W_SWORD);
  steps(g, L.COOL_TICKS);
  put(g, 1, 470, 470);
  g.step();
  const before = g.v.fighter(1).pos;
  g.dv.setUint16(L.AO + AC.HH_CARRY + 2 * 1, 5, true); // as a join leaves it: AO's 5, the record's 0
  melee(g, 2, 1, { x: 520, z: 470 });
  const f1 = g.v.fighter(1);
  assert.deepEqual(piles(g).map((p) => [p.n, p.pos[0], p.pos[2]]).sort((a, b) => a[1] - b[1]), [[5, before[0], before[2]], [1, f1.pos[0], f1.pos[2]]]);
  assert.equal(carried(g, 1), 0);
});

test('Headhunter: over on the tick a side banks to its target (or past it); at the clock the side ahead, or a draw; places by the side, then skulls banked, then kills; the next match from zero', async () => {
  const g = await room(4); // 0, 2 red; 1, 3 blue
  goZone(g, 0);
  away(g, [0, 1, 2, 3]);
  const target = u32(g, L.AH_TARGET);
  g.dv.setUint32(L.AH_SCORE, target - 2, true); g.dv.setUint32(L.AH_SCORE + 4, 10, true);
  [[4, 1], [9, 9], [6, 9], [2, 2]].forEach(([pts, k], p) => { setPoints(g, p, pts); g.dv.setUint16(rec(p) + L.A_KILLS, k, true); });
  give(g, 2, 1);
  on(g, 2);
  g.step();
  assert.deepEqual([g.v.hole().state, scores(g)], [L.H_PLAY, [target - 1, 10]], 'one short');
  give(g, 0, 5);
  on(g, 0, 1, 0);
  const from = g.v.fxCount();
  g.step();
  assert.deepEqual([g.v.hole().state, scores(g), u32(g, L.AH_TEAMWIN)], [L.H_OVER, [target + 4, 10], 1], 'over on its tick, red\'s, past the target');
  assert.deepEqual(fxs(g.v, L.FX_MODE, L.MX_TEAMWIN, from).map((f) => f.shot), [1]);
  assert.deepEqual(points(g, [0, 1, 2, 3]), [9, 9, 7, 2]);
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.fighter(p).place), [1, 3, 2, 4], 'red first, by banked (0 then 2), then blue');
  // over, nothing counts: banking or taking
  give(g, 1, 3);
  on(g, 1);
  steps(g, 50);
  assert.deepEqual([scores(g), carried(g, 1)], [[target + 4, 10], 3]);
  // the next match: a zone drawn anew, nothing lying, nobody carrying, no scores or points
  untilPlay(g);
  const z = zone(g);
  assert.deepEqual([scores(g), u32(g, L.AH_TEAMWIN), u32(g, L.AH_TARGET), points(g, [0, 1, 2, 3]), carries(g, [0, 1, 2, 3]), piles(g)], [[0, 0], 0, target, [0, 0, 0, 0], [0, 0, 0, 0], []]);
  assert.deepEqual([z.moves, +z.pos[1].toFixed(2)], [g.v.hole().start + AC.HH_MOVE, FEET[z.at]]);
  // blue to it on one tick with red: blue ahead wins
  const b = await room(4);
  goZone(b, 0);
  away(b, [0, 1, 2, 3]);
  const tb = u32(b, L.AH_TARGET);
  b.dv.setUint32(L.AH_SCORE, tb - 1, true); b.dv.setUint32(L.AH_SCORE + 4, tb - 1, true);
  give(b, 0, 1); give(b, 1, 2);
  on(b, 0, 1, 0); on(b, 1, -1, 0);
  b.step();
  assert.deepEqual([b.v.hole().state, scores(b), u32(b, L.AH_TEAMWIN)], [L.H_OVER, [tb, tb + 1], 2]);
  // the clock: blue ahead by one
  const c = await room(4);
  c.dv.setUint32(L.AH_SCORE, 20, true); c.dv.setUint32(L.AH_SCORE + 4, 21, true);
  endMatch(c);
  assert.deepEqual([c.v.hole().state, u32(c, L.AH_TEAMWIN)], [L.H_OVER, 2]);
  assert.deepEqual([0, 1, 2, 3].map((p) => c.v.fighter(p).place), [3, 1, 3, 1], 'blue first; nobody banked, so each side shares');
  // a draw: by banked, then kills, across both sides
  const d = await room(4);
  d.dv.setUint32(L.AH_SCORE, 13, true); d.dv.setUint32(L.AH_SCORE + 4, 13, true);
  [[10, 2], [10, 5], [3, 9], [3, 0]].forEach(([pts, k], p) => { setPoints(d, p, pts); d.dv.setUint16(rec(p) + L.A_KILLS, k, true); });
  endMatch(d);
  assert.equal(u32(d, L.AH_TEAMWIN), 3);
  assert.deepEqual([0, 1, 2, 3].map((p) => d.v.fighter(p).place), [2, 1, 3, 4]);
});

test('Headhunter: a fighter\'s own runs, jumps, turns, shots and swings carrying skulls, over piles and into the zone, predicted from every tick bit for bit; what it carries is the confirmed world\'s', async () => {
  const g = await room(3);
  away(g, [0, 1, 2]);
  goZone(g, 0); // mid-field, 8 m across
  put(g, 0, 480, 512);
  give(g, 0, 2);
  // piles along its way, and one off it
  for (const [k, x] of [[0, 486], [1, 492], [2, 498]]) lay(g, k, x, g.v.height(x, 512), 512, k + 1, 3000);
  lay(g, 3, 490, g.v.height(490, 530), 530, 9, 3000);
  const inputs = [];
  for (let k = 0; k < 500; k++) {
    inputs.push(arenaWord({ yaw: k < 250 ? 0 : (k < 300 ? 30 * (k - 250) : 1500), pitch: 500, move: k < 300 ? 1 : k < 400 ? 9 : 2, jump: k % 70 === 20 ? 1 : 0,
      shot: (k >> 4) & 3, melee: (k >> 6) & 1 }));
  }
  const seen = [];
  const compared = predicted(g, 0, inputs, () => { const n = carried(g, 0); if (seen[seen.length - 1] !== n) seen.push(n); });
  assert.ok(compared > 500);
  assert.deepEqual(seen, [2, 3, 5, 8, 0], 'one pile, then the next, then banked');
  assert.deepEqual([scores(g), points(g, [0]), piles(g).map((p) => p.k)], [[8, 0], [8], [3]]);
  assert.ok(g.v.fighter(0).shots > 4, 'it shot on the way');
  assert.equal(fl(g, 0) & L.PF_CARRY, 0);
});

test('a Fiesta after a match of Headhunter: its region exactly a Fiesta\'s (the mode header, the zone and piles, the records, no pads, no sides)', async () => {
  const g = await room(4);
  assert.equal(g.v.mode().mode, L.M_HEADHUNT);
  // a match of it leaves all of it dirty: skulls carried, piles lying, banked, scores, pads, sides
  away(g, [0, 1, 2, 3]);
  goZone(g, 1);
  give(g, 0, 3);
  on(g, 0);
  g.step();
  give(g, 1, 2); give(g, 2, 4);
  suicide(g, 3, 500, 470);
  assert.deepEqual([scores(g), points(g, [0, 1, 2, 3]), carries(g, [0, 1, 2, 3]), piles(g).length], [[3, 0], [3, 0, 0, 0], [0, 2, 4, 0], 1]);
  assert.ok(g.v.pads().length > 0 && sides(g, [0, 1, 2, 3]).includes(1));
  // the room's seed no longer forcing it, the next match is the rotation's Fiesta
  g.dv.setUint32(L.HDR_SEED, 7, true);
  g.dv.setUint32(L.HDR_HOLE, L.ARENA_MODES.length - 1, true);
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
  // and stays so through play: deaths, fighters where the zone was
  put(g, 0, 392, 512, FEET[1]);
  suicide(g, 1, 500, 470);
  steps(g, 200);
  check();
});

test('Headhunter\'s client module: the zone drawn with its waypoint, piles as skulls with a count, carriers\' stacks; its HUD lines, news, the board\'s columns, the AI fighter\'s goals, the gates\' state', async () => {
  const g = await room(6); // 0, 2, 4 red; 1, 3, 5 blue
  const v = g.v;
  const kit = AMC[L.M_HEADHUNT];
  assert.equal(kit, hh);
  away(g, [0, 1, 2, 3, 4, 5]);
  goZone(g, 1); // red's roof
  const z = zone(g);
  assert.deepEqual(zoneOf(v), z);
  const draw = (slot, { shown = slot, cam = [470, 30, 540], now = 0 } = {}) => {
    const out = { solid: [], glow: [], beams: [], markers: [], zone: null };
    kit.draw(v, { dt: 0, now, t: 1, slot, shown, me: slot >= 0 ? v.fighter(slot) : null, pme: null, cam, view: v, pview: v }, out);
    return out;
  };
  // the zone: gold, painted only within HH_ZONE_H of the roof; lights round the rim on the roof, a pillar, ZONE
  let out = draw(0);
  assert.deepEqual(out.zone, { x: 392, z: 512, r: 6, y: z.pos[1], h: 2, color: [1, 0.78, 0.22], pulse: 1 });
  assert.ok(out.glow.length === 12 && out.glow.every((x) => Math.abs(Math.hypot(x.pos[0] - 392, x.pos[2] - 512) - 6 * 0.97) < 1e-6 && Math.abs(x.pos[1] - z.pos[1] - 0.35) < 1e-6), 'the rim, on the roof');
  assert.deepEqual(out.beams.map((b) => [b.a, b.b]), [[[392, z.pos[1] + 2, 512], [392, z.pos[1] + 30, 512]]]);
  assert.deepEqual(out.markers, [{ pos: [392, z.pos[1] + 8, 512], label: 'ZONE', color: C.YELLOW, kind: 'hill' }]);
  assert.deepEqual(out.solid, []);
  // in it, nothing over your head; a spectator as the one it watches; carrying, it pulses
  on(g, 0);
  g.step();
  assert.deepEqual([draw(0).markers, draw(-1, { shown: 0 }).markers, draw(-1, { shown: 2 }).markers.map((m) => m.label)], [[], [], ['ZONE']]);
  away(g, [0]);
  give(g, 0, 2);
  const pulses = [0, 235, 706].map((now) => draw(0, { now }).zone.pulse);
  assert.ok(pulses.every((x) => x >= 0.6 && x <= 1) && Math.max(...pulses) - Math.min(...pulses) > 0.3, `${pulses}`);
  // piles: a heap of up to three skulls each; a +N waypoint on the nearest three within 30 m in front of
  // where the fighter shown faces (0 faces +x), none behind or well to the side, none over another's
  clearPiles(g);
  const fy = (x, zz) => v.height(x, zz);
  const eyeOf = (p) => { const f = v.fighter(p).pos; return [f[0], f[1] + 1.6, f[2]]; };
  const ahead = [[480, 536, 1], [480, 544, 7], [490, 540, 2], [500, 540.5, 3], [460, 540, 4], [484, 552, 5]];
  ahead.forEach(([x, zz, n], k) => lay(g, k, x, fy(x, zz), zz, n));
  g.step();
  give(g, 0, 0);
  assert.equal(v.fighter(0).yaw, 0);
  out = draw(0, { cam: eyeOf(0) });
  const skulls = out.solid.filter((s) => s.kind === 8);
  assert.equal(skulls.length, ahead.reduce((n, [, , c]) => n + Math.min(3, c), 0), 'by how many: at most three a pile');
  assert.ok(skulls.every((s) => s.size === 0.24));
  assert.deepEqual(out.markers.filter((m) => m.kind === 'skull').map((m) => [m.label, m.color]), [['+1', C.WHITE], ['+7', C.WHITE], ['+2', C.WHITE]],
    'not the 4 behind, the 5 to the side, nor the 3 behind the 2 from here');
  // carriers but the fighter shown: a stack over each head (five at most); the count over the nearest three within 35 m in front, in its side's colour
  clearPiles(g);
  away(g, [0, 1, 2, 3, 4, 5]);
  put(g, 1, 485, 538); put(g, 2, 490, 545); put(g, 3, 500, 541); put(g, 5, 495, 540 - 10 / 3); // (5 in line behind 1 from 0's eye)
  give(g, 1, 3); give(g, 2, 9); give(g, 3, 1); give(g, 4, 2); give(g, 5, 5); give(g, 0, 4);
  g.step();
  out = draw(0, { cam: eyeOf(0) });
  const heads = out.solid.filter((s) => s.kind === 8);
  assert.equal(heads.length, 3 + 5 + 1 + 2 + 5, 'not 0\'s own');
  const c2 = v.fighter(2).pos;
  assert.deepEqual(heads.filter((s) => s.pos[0] === c2[0] && s.pos[2] === c2[2]).map((s) => +(s.pos[1] - c2[1]).toFixed(2)), [2.2, 2.56, 2.92, 3.28, 3.64]);
  assert.deepEqual(out.markers.filter((m) => m.kind === 'skull').map((m) => [m.label, m.color]), [['3', SIDE_C[1]], ['9', SIDE_C[0]], ['1', SIDE_C[1]]], '5 hidden behind 1, 4 to the side');
  // a spectator watching 0 sees what 0 does; with nobody shown (a fixed camera), the heaps and stacks but no waypoints on them
  assert.deepEqual(draw(-1, { shown: 0, cam: eyeOf(0) }).markers, out.markers);
  assert.deepEqual(draw(-1, { shown: -1, cam: eyeOf(0) }).markers.filter((m) => m.kind === 'skull'), []);
  // the sprites stay inside their share of the renderer's
  for (let k = 0; k < AC.HH_NPILE; k++) lay(g, k, 400 + 3 * k, fy(400 + 3 * k, 500), 500, 5);
  for (let p = 0; p < 6; p++) give(g, p, 40);
  assert.ok(draw(0).solid.length <= 120);
  // the HUD: what you carry, the zone's distance and when it moves (on the last zone, the target), what to do; within cols 1 to 26
  clearPiles(g);
  for (let p = 0; p < 6; p++) give(g, p, 0);
  const hud = (slot, view = v) => { const lines = []; kit.hud(view, { put: (x, y, s, c) => lines.push([x, y, s, c]), C, slot, me: v.fighter(slot), team: team(g, slot), now: 0 }); return lines; };
  const fits = (lines) => lines.every(([x, , s]) => x >= 1 && x + s.length - 1 <= 26);
  const left = (n) => `${Math.floor(n / 125 / 60)}:${String(Math.floor(n / 125) % 60).padStart(2, '0')}`;
  const d0 = Math.round(Math.hypot(v.fighter(0).pos[0] - 392, v.fighter(0).pos[2] - 512));
  assert.deepEqual(hud(0), [[1, 2, 'NO SKULLS  KILL FOR THEM', C.GREY], [1, 3, `ZONE ${d0}M  MOVES IN ${left(z.moves - v.tick)}`, C.GREY]]);
  give(g, 0, 3);
  assert.deepEqual(hud(0), [[1, 2, 'CARRYING 3 SKULLS', C.YELLOW], [1, 3, `ZONE ${d0}M  MOVES IN ${left(z.moves - v.tick)}`, C.GREY], [1, 4, 'BANK THEM IN THE ZONE', C.WHITE]]);
  give(g, 0, 1);
  assert.deepEqual(hud(0)[0], [1, 2, 'CARRYING 1 SKULL', C.YELLOW]);
  // dead: still the distance, nothing to do yet
  dead(g, 0);
  assert.deepEqual(hud(0), [[1, 2, 'CARRYING 1 SKULL', C.YELLOW], [1, 3, `ZONE ${d0}M  MOVES IN ${left(z.moves - v.tick)}`, C.GREY]]);
  g.dv.setUint8(rec(0) + L.P_FL, fl(g, 0) & ~L.PF_DEAD);
  const last = Object.assign(Object.create(v), { hole: () => ({ ...v.hole(), until: z.moves }) });
  assert.deepEqual(hud(0, last)[1], [1, 3, `ZONE ${d0}M  FIRST TO ${u32(g, L.AH_TARGET)}`, C.GREY], 'the last zone');
  give(g, 3, 0);
  on(g, 3);
  g.step();
  assert.deepEqual(hud(3)[1], [1, 3, `IN THE ZONE  MOVES IN ${left(z.moves - v.tick)}`, C.YELLOW]);
  assert.ok([hud(0), hud(3), hud(0, last)].every(fits));
  // the news: banked in the banker's side's colour, a banner for your own; taken, a glint (and a word for your own); the zone moved
  for (const p of [0, 1]) {
    const said = [], shown = [], glows = [];
    const ctx = { slot: p, me: v.fighter(p), name: (q) => (q === p ? 'YOU' : `P${q + 1}`), team: (q) => team(g, q), view: v, C, feed: (t, c) => said.push([t, c]), banner: (t, c) => shown.push([t, c]),
      glow: (x) => glows.push(x), sound: { pickup() {} } };
    for (const [size, owner, shot] of [[BANK, 0, 3], [BANK, 1, 1], [TAKE, 0, 2], [TAKE, 1, 1], [MOVE, 255, 2]]) kit.news({ size, owner, shot, pos: z.pos }, ctx);
    assert.deepEqual(said, [[p === 0 ? 'YOU BANKED 3 SKULLS' : 'P1 BANKED 3 SKULLS', C.RED], [p === 1 ? 'YOU BANKED 1 SKULL' : 'P2 BANKED 1 SKULL', C.CYAN], ['THE ZONE MOVED', C.YELLOW]]);
    assert.deepEqual(shown, [p === 0 ? ['BANKED 3 SKULLS', C.RED] : ['BANKED 1 SKULL', C.CYAN], p === 0 ? ['+2 SKULLS', C.YELLOW] : ['+1 SKULL', C.YELLOW], ['THE ZONE MOVED', C.YELLOW]]);
    assert.equal(glows.length, 5);
  }
  // the board's columns: banked, carried
  setPoints(g, 2, 17);
  give(g, 2, 4);
  assert.deepEqual(kit.cols.map((c) => [c.head, c.get(v.fighter(2))]), [['SKULLS', '17'], ['CARRIED', '4']]);
  // the goals: carrying, to the zone, hurrying more with more (a pile on its way first); else a pile near it, bigger from farther; defenders guard the zone; attackers hunt a carrier, else the nearest enemy
  const ctx = (p, role = 'attack') => ({ role, rank: role === 'defend' ? 2 : 0, view: v, ally: (a, b) => v.ally(a, b), slot: p, t: v.tick });
  for (let p = 0; p < 6; p++) give(g, p, 0);
  away(g, [0, 1, 2, 3, 4, 5]);
  g.step();
  const me = () => v.fighter(0);
  for (const [n, hurry] of [[1, 0.6], [2, 0.75], [3, 0.9], [4, 0.95], [12, 0.95]]) {
    give(g, 0, n);
    const goal = kit.goal(v, me(), ctx(0));
    assert.deepEqual([goal.pos, goal.r, +goal.hurry.toFixed(2), goal.hold], [z.pos, 4, hurry, false], `${n} skulls`);
  }
  lay(g, 0, me().pos[0] + 6, fy(me().pos[0] + 6, me().pos[2]), me().pos[2], 1);
  g.step();
  assert.deepEqual(kit.goal(v, me(), ctx(0)).pos, piles(g)[0].pos, 'a pile on the way');
  clearPiles(g);
  give(g, 0, 0);
  const mp = me().pos;
  lay(g, 0, mp[0] + 35, fy(mp[0] + 35, mp[2]), mp[2], 1); lay(g, 1, mp[0], fy(mp[0], mp[2] - 40), mp[2] - 40, 4);
  g.step();
  assert.deepEqual(kit.goal(v, me(), ctx(0)), { pos: piles(g)[1].pos, r: 1, hurry: 0.55, hold: false }, 'the 4 at 40 m, not the 1 at 35');
  clearPiles(g);
  g.step();
  assert.deepEqual(kit.goal(v, me(), ctx(0, 'defend')), { pos: z.pos, r: 4, hurry: 0.3, hold: true });
  give(g, 3, 2);
  assert.deepEqual(kit.goal(v, me(), ctx(0)), { pos: v.fighter(3).pos, r: 2, hurry: 0.3, hold: false }, 'an enemy carrier near');
  give(g, 3, 0);
  const foe = [1, 3, 5].map((q) => [q, Math.hypot(v.fighter(q).pos[0] - mp[0], v.fighter(q).pos[2] - mp[2])]).sort((a, b) => a[1] - b[1])[0][0];
  assert.deepEqual(kit.goal(v, me(), ctx(0)), { pos: v.fighter(foe).pos, r: 2, hurry: 0, hold: false }, 'the nearest enemy');
  // the gates' state
  lay(g, 0, 480, fy(480, 600), 600, 3);
  give(g, 2, 2); give(g, 1, 5);
  assert.deepEqual(kit.state(v), { score: scores(g), target: u32(g, L.AH_TARGET), zone: 1, moves: z.moves, piles: 1, lying: 3, carry: [2, 5] });
  // the readers agree with the sim's: what's in the zone, what lies
  assert.ok(inZone(z, z.pos) && !inZone(z, [z.pos[0] + 6, z.pos[1], z.pos[2]]) && !inZone(z, [z.pos[0], z.pos[1] - 2, z.pos[2]]));
  assert.deepEqual(pilesOf(v), piles(g));
  // the next match's countdown: no zone yet, nothing drawn, no goal
  endMatch(g);
  while (v.hole().state !== L.H_COUNT) g.step();
  out = draw(0);
  assert.deepEqual([zoneOf(v), out.zone, out.markers, out.solid, kit.goal(v, v.fighter(0), ctx(0))], [null, null, [], [], null]);
  assert.deepEqual(hud(0), [[1, 2, 'NO SKULLS  KILL FOR THEM', C.GREY]]);
});

test('Headhunter with 8 and 16 AI fighters: skulls dropped, taken and banked by both sides in 20,000 ticks; no trap on the debug build, the same hash on every tick on 1 and 4 threads', async (t) => {
  const [debug, bytes] = [arenaBytes(true), arenaBytes()];
  const ticks = 20000;
  for (const bots of [8, 16]) {
    // banks and takes by side, from the news; kills
    const banked = [0, 0], took = [0, 0];
    let kills = 0, moves = 0, k0 = 0, n = null;
    const { log } = await playArena({ bytes: debug, seed: forcedSeed(L.M_HEADHUNT), bots, ticks, leaveAt: 1000,
      onTick: (tick, v) => {
        for (let k = Math.max(k0, v.fxCount() - L.FX_MAX); k < v.fxCount(); k++) {
          const f = v.fx(k);
          if (f.kind === L.FX_KILL) kills++;
          if (f.kind !== L.FX_MODE) continue;
          const side = v.u8[L.PLAYERS + f.owner * L.PSIZE + L.P_FL] & L.PF_BLUE ? 1 : 0;
          if (f.size === BANK) banked[side] += f.shot;
          if (f.size === TAKE) took[side] += f.shot;
          if (f.size === MOVE) moves++;
        }
        k0 = v.fxCount();
        n = [v.dv.getUint32(L.AH_TEAMN, true), v.dv.getUint32(L.AH_TEAMN + 4, true)];
      } });
    t.diagnostic(`${bots} fighters: ${kills} kills, skulls taken ${took}, banked ${banked}, ${moves} moves`);
    assert.deepEqual(n, [bots / 2, bots / 2]);
    assert.ok(took.every((k) => k >= 5), `${bots}: both sides take skulls`);
    assert.ok(banked.every((k) => k >= 3), `${bots}: both sides bank`);
    const parsed = parseLog(log);
    const a = await replay({ bytes, log: parsed, ticks, threads: 1, tag: `hh${bots}x1` });
    const b = await replay({ bytes, log: parsed, ticks, threads: 4, tag: `hh${bots}x4`, startWorkers });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
  }
});
