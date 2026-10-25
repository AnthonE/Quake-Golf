import test from 'node:test';
import assert from 'node:assert/strict';
import { arenaBytes } from './helpers.mjs';
import { View, arenaWord, arenaFrame, forcedSeed } from '../src/arena-view.mjs';
import { aimAt } from '../client/bot.mjs';
import { playArena } from '../tools/genarena.mjs';
import { compileMap } from '../tools/map.mjs';
import { replay, parseLog, decodeTrace, newMemory, instantiate, Sim } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import * as L from '../src/layout.mjs';
import * as AC from '../src/am/consts.mjs';
import assault, { bombOf } from '../client/am/assault.mjs';
import { AMC, SIDE_C, SIDE_RGB } from '../client/am/index.mjs';
import { C } from '../client/font.mjs';

// Assault (src/am/assault.wat, client/am/assault.mjs): one bomb in the
// middle, carried to the other side's plate and planted; it goes off for a
// point unless they defuse it. Helpers as test/arena-oddball.test.mjs and
// test/arena-ctf.test.mjs have them; the bomb read straight from AO (its
// fields in src/am/assault.mjs).

// A room on the debug build playing Assault (or `mode`; null plays the
// rotation): n fighters in, each parked during the countdown on open ground
// away from the bomb and the plates, stepped to the first tick of play and
// one more.
let debugModule = null;
async function room(n = 2, { seed = 7, mode = L.M_ASSAULT, park: parked = true, play = true } = {}) {
  debugModule ||= await WebAssembly.compile(arenaBytes(true));
  const memory = newMemory();
  const sim = new Sim(await instantiate(debugModule, memory), memory);
  sim.init(mode === null ? seed : forcedSeed(mode, seed));
  const v = new View(sim.memory.buffer);
  const dv = new DataView(sim.memory.buffer);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); };
  const g = { sim, v, dv, step, n };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  if (!play) return g;
  if (parked) for (let p = 0; p < n; p++) park(g, p);
  while (v.hole().state !== L.H_PLAY) step();
  step();
  return g;
}

const rec = (p) => L.PLAYERS + p * L.PSIZE;
const fl = (g, p) => g.sim.u8[rec(p) + L.P_FL];
const team = (g, p) => (fl(g, p) & L.PF_BLUE ? 1 : 0);
const carry = (g, p) => (fl(g, p) & L.PF_CARRY) !== 0;
const setCarry = (g, p, on) => { g.sim.u8[rec(p) + L.P_FL] = on ? fl(g, p) | L.PF_CARRY : fl(g, p) & ~L.PF_CARRY; };
const u32 = (g, a) => g.dv.getUint32(a, true);
const scores = (g) => [u32(g, L.AH_SCORE), u32(g, L.AH_SCORE + 4)];
const sides = (g, slots) => slots.map((p) => team(g, p));
const points = (g, p) => g.dv.getUint16(L.MODE_REC + p * L.MR_SIZE + L.MR_POINTS, true);
const defuses = (g, p) => g.dv.getUint16(L.MODE_REC + p * L.MR_SIZE + L.MR_AUX, true);
const setPoints = (g, p, n) => g.dv.setUint16(L.MODE_REC + p * L.MR_SIZE + L.MR_POINTS, n, true);
const kills = (g, p) => g.dv.getUint16(rec(p) + L.A_KILLS, true);
const dead = (g, p) => g.v.fighter(p).dead;
const MAP = compileMap();

function put(g, p, x, z, y = g.v.height(x, z)) {
  g.dv.setFloat32(rec(p) + L.P_PX, x, true);
  g.dv.setFloat32(rec(p) + L.P_PY, y, true);
  g.dv.setFloat32(rec(p) + L.P_PZ, z, true);
  for (const o of [L.P_VX, L.P_VY, L.P_VZ]) g.dv.setFloat32(rec(p) + o, 0, true);
}
// Slot p's place on open ground mid-field, 16 m or more from the bomb's spot and far from either plate.
const park = (g, p) => put(g, p, 491 + 3 * (p % 8), 528 + 3 * (p >> 3));
const fpos = (g, p) => g.v.fighter(p).pos;
const near = (a, b, e = 1e-4) => a.every((x, i) => Math.abs(x - b[i]) < e);
const steps = (g, n) => { for (let i = 0; i < n; i++) g.step(); };

// Blood Gulch's stands (the plates): on each room's floor (21), red's x
// 382.8-401.2, blue's 622.8-641.2, z 503.8-520.2; each roof's top 25.8 right
// over its stand. The middle: (512, 19.69, 512).
const STAND = [[392, 21, 512], [632, 21, 512]];
const FLOOR = 21, ROOF = Math.fround(25.8);
const { AS_HOME: HOME, AS_CARRIED: CARRIED, AS_DROPPED: DROPPED, AS_PLANTED: PLANTED } = AC;

// The bomb as AO holds it.
function bomb(g) {
  const f = (o) => g.dv.getFloat32(L.AO + o, true);
  const v3 = (o) => [f(o), f(o + 4), f(o + 8)];
  const u16 = (o) => g.dv.getUint16(L.AO + o, true);
  return { pos: v3(AC.AS_POS), state: g.sim.u8[L.AO + AC.AS_STATE], by: g.sim.u8[L.AO + AC.AS_BY], left: u16(AC.AS_LEFT), spot: v3(AC.AS_SPOT),
    side: g.sim.u8[L.AO + AC.AS_SIDE], arming: u16(AC.AS_ARMING), defusing: u16(AC.AS_DEFUSING), plates: [v3(AC.AS_PLATE), v3(AC.AS_PLATE + 12)] };
}
// The bomb laid down by hand at (x, y, z), `left` ticks to go, nobody carrying it.
function lay(g, x, y, z, left = 1000) {
  const b = bomb(g);
  if (b.state === CARRIED) setCarry(g, b.by, false);
  [x, y, z].forEach((c, k) => g.dv.setFloat32(L.AO + AC.AS_POS + 4 * k, c, true));
  g.sim.u8[L.AO + AC.AS_STATE] = DROPPED;
  g.dv.setUint16(L.AO + AC.AS_LEFT, left, true);
}
const setArming = (g, n) => g.dv.setUint16(L.AO + AC.AS_ARMING, n, true);
const setLeft = (g, n) => g.dv.setUint16(L.AO + AC.AS_LEFT, n, true);
// p stands on the bomb where it lies and takes it on the next tick
function take(g, p) {
  const b = bomb(g);
  put(g, p, b.pos[0], b.pos[2], b.pos[1]);
  g.step();
  assert.deepEqual([bomb(g).state, bomb(g).by, carry(g, p)], [CARRIED, p, true], `P${p} takes it`);
}
// p takes the bomb (laid at its feet if need be) and plants it on the other
// side's plate (its count set a tick short by hand); then p steps off it.
function plant(g, p) {
  if (bomb(g).state !== CARRIED || bomb(g).by !== p) { const f = fpos(g, p); lay(g, f[0], f[1], f[2]); g.step(); }
  assert.equal(bomb(g).by, p);
  const s = STAND[1 - team(g, p)];
  put(g, p, s[0] + 1, s[2], FLOOR);
  setArming(g, AC.AS_ARM - 1);
  g.step();
  assert.deepEqual([bomb(g).state, bomb(g).by, carry(g, p)], [PLANTED, p, false], `P${p} plants it`);
  put(g, p, s[0] - 6, s[2] + 6, FLOOR);
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

// p's melee at q on open ground (at x, z), q `gap` m off facing p and pressing nothing.
function melee(g, p, q, { gap = 2, x = 500, z = 510 } = {}) {
  put(g, p, x, z); put(g, q, x + gap, z);
  const w = still(g, p);
  g.step([[L.EV_INPUT, q, arenaWord({ yaw: 8192, ...still(g, q) })], [L.EV_INPUT, p, at(g, p, q, 1.0, { ...w, melee: w.melee ^ 1 })]]);
}

// FX of a kind (and size) from the running count `from` on, at most the ring's last FX_MAX
function fxs(v, kind, size, from = 0) {
  const out = [];
  for (let k = Math.max(from, v.fxCount() - L.FX_MAX); k < v.fxCount(); k++) {
    const f = v.fx(k);
    if (f.kind === kind && (size === undefined || f.size === size)) out.push(f);
  }
  return out;
}
// The bomb's news from `from` on: [what, owner, shot]; newsAt, where
const isOurs = (f) => f.size >= AC.AS_MX_TAKE && f.size <= AC.AS_MX_HOME;
const news = (g, from) => fxs(g.v, L.FX_MODE, undefined, from).filter(isOurs).map((f) => [f.size, f.owner, f.shot]);
const newsAt = (g, from) => fxs(g.v, L.FX_MODE, undefined, from).filter(isOurs).map((f) => f.pos);
const endMatch = (g) => { g.dv.setUint32(L.HDR_UNTIL, g.v.tick + 1, true); for (let i = 0; i < 4; i++) g.step(); };
const untilPlay = (g) => { while (g.v.hole().state !== L.H_PLAY) g.step(); g.step(); };
// The next match's play, everyone parked through its countdown.
const nextPlay = (g) => {
  while (g.v.hole().state !== L.H_COUNT) g.step();
  for (let p = 0; p < g.n; p++) park(g, p);
  untilPlay(g);
};

// A frag of p's about to go off at (x, z), on the ground or at height y.
function frag(g, p, x, z, y = g.v.height(x, z)) {
  const j = L.PROJ;
  g.dv.setFloat32(j + L.J_PX, x, true); g.dv.setFloat32(j + L.J_PY, y + 0.12, true); g.dv.setFloat32(j + L.J_PZ, z, true);
  for (const o of [L.J_VX, L.J_VY, L.J_VZ]) g.dv.setFloat32(j + o, 0, true);
  g.dv.setUint16(j + L.J_AGE, L.A_FUSE - 1, true); g.sim.u8[j + L.J_KIND] = L.K_GRENADE; g.sim.u8[j + L.J_OWNER] = p;
}

// p dies by its own frag.
function suicide(g, p) {
  const pos = g.v.fighter(p).pos;
  frag(g, p, pos[0], pos[2], pos[1]);
  g.dv.setUint8(rec(p) + L.A_SH, 0); g.dv.setUint8(rec(p) + L.A_HP, 10);
  g.step();
  assert.ok(g.v.fighter(p).dead, `P${p} by its own frag`);
}
const respawned = (g, p) => { while (g.v.fighter(p).dead) g.step(); };

// Predicts slot p through `inputs` from every tick (1 ahead, and 6 and 30 every
// 7th) and compares each with the confirmed world when it gets there; each(k)
// after the confirmed tick k.
function predicted(g, p, inputs, each = () => {}) {
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
    for (const d of due.get(k + 1) || []) {
      assert.deepEqual(d.player, g.sim.u8.slice(at0, at0 + L.PSIZE), `predicted ${d.n} from ${d.from}`);
      compared++;
    }
    each(k);
  }
  return compared;
}

test('Assault: play lays the bomb in the middle (MAP_BALL at its feet height) and both plates on their stands (MAP_FLAGS on each room\'s floor); the target AS_TARGET; AO all 0 till then', async () => {
  const c = await room(2, { play: false });
  assert.equal(c.v.hole().state, L.H_COUNT);
  let counted = 0;
  while (c.v.hole().state !== L.H_PLAY) { assert.ok(c.sim.u8.slice(L.AO, L.AO + L.AO_SIZE).every((x) => x === 0), 'the countdown'); counted++; c.step(); }
  assert.ok(counted > 300);
  const g = await room(4);
  const b = bomb(g);
  assert.deepEqual([b.spot[0], b.spot[2]], [MAP.ball[0], MAP.ball[1]]);
  assert.ok(Math.abs(b.spot[1] - 19.69) < 0.01 && Math.abs(b.spot[1] - g.v.height(512, 512)) < 1e-3, `its feet height ${b.spot[1]}`);
  assert.deepEqual([b.pos, b.state, b.left, b.arming, b.defusing], [b.spot, HOME, 0, 0, 0]);
  for (const k of [0, 1]) {
    assert.ok(near(b.plates[k], STAND[k], 1e-3), `plate ${k}: ${b.plates[k]}`);
    assert.equal(b.plates[k][1], g.v.height(STAND[k][0], STAND[k][2]), 'the floor is the ground');
  }
  assert.deepEqual([u32(g, L.AH_TARGET), scores(g)], [AC.AS_TARGET, [0, 0]]);
  // nothing past its fields
  assert.ok(g.sim.u8.slice(L.AO + AC.AS_SIZE, L.AO + L.AO_SIZE).every((x) => x === 0));
  // nobody near it: it stays
  steps(g, 300);
  assert.deepEqual([bomb(g).state, bomb(g).pos, scores(g)], [HOME, b.spot, [0, 0]]);
});

test('Assault: taken by the first fighter in slot order alive and not carrying, within AS_TOUCH_R across and AS_TOUCH_H up or down, either side; news at the bomb', async () => {
  const g = await room(4); // 0 and 2 red, 1 and 3 blue
  assert.deepEqual(sides(g, [0, 1, 2, 3]), [0, 1, 0, 1]);
  const spot = bomb(g).spot;
  // 1.55 m across: not near enough
  put(g, 0, spot[0] + 1.55, spot[2]);
  steps(g, 5);
  assert.equal(bomb(g).state, HOME);
  // all four inside 1.45 m: 0 dead and 2 carrying (by hand) come first in slot order, so blue 1 takes it, not 3
  put(g, 0, spot[0] + 1.45, spot[2]); put(g, 1, spot[0], spot[2] - 1.45); put(g, 2, spot[0] - 1.0, spot[2] + 1.0); put(g, 3, spot[0], spot[2] + 0.5);
  g.dv.setUint8(rec(0) + L.P_FL, fl(g, 0) | L.PF_DEAD); g.dv.setUint16(rec(0) + L.A_RESPAWN, 2000, true);
  setCarry(g, 2, true);
  g.dv.setUint8(rec(1) + L.A_BURST, 2); g.dv.setUint8(rec(1) + L.A_RELOAD, 30);
  let from = g.v.fxCount();
  g.step();
  let b = bomb(g);
  assert.deepEqual([b.state, b.by, b.side, carry(g, 1), carry(g, 3)], [CARRIED, 1, 1, true, false]);
  assert.deepEqual([g.v.fighter(1).burst, g.v.fighter(1).reload], [0, 0], 'its burst and reload stopped');
  assert.deepEqual(b.pos, fpos(g, 1), 'at its carrier\'s feet');
  assert.deepEqual([news(g, from), newsAt(g, from)], [[[AC.AS_MX_TAKE, 1, 1]], [spot]], 'news where it was taken');
  // the band: laid 1.95 m over or under a fighter's feet it is taken, 2.05 m it isn't
  setCarry(g, 2, false);
  g.dv.setUint8(rec(0) + L.P_FL, fl(g, 0) & ~L.PF_DEAD);
  for (const p of [0, 1, 3]) park(g, p);
  put(g, 2, 500, 540);
  g.step();
  const y = fpos(g, 2)[1];
  for (const [dy, taken] of [[2.05, false], [-2.05, false], [1.95, true], [-1.95, true], [0, true]]) {
    lay(g, 500.5, y + dy, 540.5);
    g.step();
    assert.equal(bomb(g).state === CARRIED && bomb(g).by === 2, taken, `${dy} m`);
  }
  // a tie on one tick goes by slot, not colour: red 2 and blue 3 on it, red first; then blue 1 and red 2, blue first
  lay(g, 512, spot[1], 512);
  put(g, 2, 512.5, 512); put(g, 3, 511.5, 512);
  from = g.v.fxCount();
  g.step();
  assert.deepEqual([bomb(g).by, bomb(g).side, news(g, from)], [2, 0, [[AC.AS_MX_TAKE, 2, 0]]]);
  lay(g, 512, spot[1], 512);
  put(g, 1, 512.5, 512); put(g, 2, 511.5, 512); park(g, 3);
  from = g.v.fxCount();
  g.step();
  assert.deepEqual([bomb(g).by, bomb(g).side, carry(g, 1), carry(g, 2), news(g, from)], [1, 1, true, false, [[AC.AS_MX_TAKE, 1, 1]]]);
  // a slot that has left, standing where it was, is nobody
  lay(g, 512, spot[1], 512);
  for (const p of [1, 2]) park(g, p);
  put(g, 0, 512, 512);
  g.step([[L.EV_LEAVE, 0]]);
  assert.equal(bomb(g).state, DROPPED);
});

test('Assault: a carrier on the other side\'s plate (within AS_PLATE_R, AS_TOUCH_H up or down) AS_ARM ticks in a row plants it on the stand, its guns back; off it, on its own plate, on the roof over it or dead, the count starts over', async () => {
  const g = await room(4); // 0 and 2 red, 1 and 3 blue
  take(g, 0);
  const guns = [...g.v.fighter(0).gun];
  const from = g.v.fxCount();
  // 2.6 m off blue's stand, on the roof right over it, on red's own: nothing counts
  for (const [x, z, y] of [[632 + 2.6, 512, FLOOR], [632, 512, ROOF], [392, 512, FLOOR]]) {
    put(g, 0, x, z, y);
    steps(g, 5);
    assert.deepEqual([bomb(g).state, bomb(g).arming, news(g, from)], [CARRIED, 0, []], `at ${x}, ${y}`);
  }
  // 2.4 m off: a tick at a time; stepping off a tick short starts it over
  put(g, 0, 632 - 2.4, 512, FLOOR);
  steps(g, AC.AS_ARM - 1);
  assert.deepEqual([bomb(g).state, bomb(g).arming, carry(g, 0)], [CARRIED, AC.AS_ARM - 1, true]);
  put(g, 0, 632 - 2.6, 512, FLOOR);
  g.step();
  assert.equal(bomb(g).arming, 0, 'off it: from 0');
  put(g, 0, 632, 512 + 2.4, FLOOR);
  steps(g, AC.AS_ARM - 1);
  assert.deepEqual([bomb(g).state, bomb(g).arming], [CARRIED, AC.AS_ARM - 1]);
  // the AS_ARM-th tick: planted on the stand, the carry over, the guns its own still
  g.step();
  const b = bomb(g);
  assert.deepEqual([b.state, b.by, b.side, b.left, b.arming, b.defusing, carry(g, 0)], [PLANTED, 0, 0, AC.AS_FUSE, 0, 0, false]);
  assert.ok(near(b.pos, STAND[1], 1e-3), `on the stand: ${b.pos}`);
  assert.deepEqual(g.v.fighter(0).gun, guns);
  assert.deepEqual([news(g, from), scores(g), points(g, 0)], [[[AC.AS_MX_PLANT, 0, 0]], [0, 0], 0]);
  assert.ok(near(newsAt(g, from)[0], STAND[1], 1e-3));
  // planted, nobody takes it: the planter and blue 1 standing on it
  put(g, 0, 632, 512, FLOOR); put(g, 1, 632.5, 512, FLOOR);
  g.step();
  assert.deepEqual([bomb(g).state, carry(g, 0), carry(g, 1)], [PLANTED, false, false]);
  // blue takes it the other way, and its death on red's plate starts its count over
  const h = await room(4);
  take(h, 1);
  put(h, 1, 392 + 2, 512, FLOOR);
  steps(h, 100);
  assert.equal(bomb(h).arming, 100);
  loadout(h, 2, L.W_SWORD);
  steps(h, L.COOL_TICKS);
  put(h, 2, 392 - 2, 512, FLOOR); put(h, 1, 392, 512, FLOOR);
  const w = still(h, 2);
  h.step([[L.EV_INPUT, 1, arenaWord({ yaw: 8192, ...still(h, 1) })], [L.EV_INPUT, 2, at(h, 2, 1, 1.0, { ...w, melee: w.melee ^ 1 })]]);
  assert.ok(dead(h, 1));
  assert.deepEqual([bomb(h).state, bomb(h).arming], [DROPPED, 0]);
});

test('Assault: a planted bomb goes off AS_FUSE ticks after the plant\'s: a point for its side and its planter, and the other side within AS_BLAST_R across and AS_BLAST_H up or down killed by the planter; its own side, the roof and 5.1 m off spared; back in the middle', async () => {
  const g = await room(8); // red 0 2 4 6, blue 1 3 5 7
  plant(g, 0);
  const s = STAND[1];
  const from = g.v.fxCount();
  steps(g, AC.AS_FUSE - 1);
  assert.deepEqual([bomb(g).state, bomb(g).left], [PLANTED, 1], 'a tick to go');
  // round it: blue 1 at 4.9 m, blue 3 at 5.1, blue 5 on the roof right over it, blue 7 2.9 m up in the air;
  // red 2 at 1 m and its planter at 2 m
  put(g, 1, s[0] + 4.9, s[2], FLOOR); put(g, 3, s[0], s[2] - 5.1, FLOOR); put(g, 5, s[0], s[2], ROOF); put(g, 7, s[0] - 1, s[2] + 1, FLOOR + 2.9);
  put(g, 2, s[0] + 1, s[2], FLOOR); put(g, 0, s[0], s[2] + 2, FLOOR);
  const k0 = kills(g, 0);
  g.step();
  const b = bomb(g);
  assert.deepEqual([b.state, b.pos, b.left, scores(g), points(g, 0)], [HOME, b.spot, 0, [1, 0], 1]);
  assert.deepEqual(news(g, from), [[AC.AS_MX_BOOM, 0, 0]]);
  assert.ok(near(newsAt(g, from)[0], STAND[1], 1e-3), 'news at the stand');
  assert.deepEqual([1, 3, 5, 7, 2, 0].map((p) => dead(g, p)), [true, false, false, true, false, false]);
  assert.deepEqual(fxs(g.v, L.FX_KILL, undefined, from).map((f) => [f.owner, f.shot, f.size]), [[0, 1, L.KILL_CARRY], [0, 7, L.KILL_CARRY]], 'the planter\'s, in slot order');
  assert.equal(kills(g, 0), k0 + 2);
  // over the next tick nothing more of it; blue scores the other way
  g.step();
  assert.deepEqual([scores(g), bomb(g).state], [[1, 0], HOME]);
  respawned(g, 1);
  plant(g, 3);
  steps(g, AC.AS_FUSE);
  assert.deepEqual([scores(g), points(g, 3), bomb(g).state], [[1, 1], 1, HOME]);
});

test('Assault: one of the plate\'s side on it AS_DEFUSE ticks in a row defuses it (MR_AUX for the first in slot order on it); its count starts over with nobody on it; a hair off, the roof, the dead and the planters count nothing; a defuse on its last tick comes first', async () => {
  const g = await room(6); // red 0 2 4, blue 1 3 5
  plant(g, 0);
  const s = STAND[1];
  let from = g.v.fxCount();
  // 1.55 m off, on the roof over it, dead on it, red 2 on it: nothing
  put(g, 1, s[0] + 1.55, s[2], FLOOR); put(g, 3, s[0], s[2], ROOF);
  put(g, 5, s[0] - 0.5, s[2], FLOOR); g.sim.u8[rec(5) + L.P_FL] |= L.PF_DEAD; g.dv.setUint16(rec(5) + L.A_RESPAWN, 2000, true);
  put(g, 2, s[0], s[2] + 0.5, FLOOR);
  steps(g, 10);
  assert.deepEqual([bomb(g).state, bomb(g).defusing, bomb(g).left], [PLANTED, 0, AC.AS_FUSE - 10]);
  // blue 1 on it at 1.45 m: a tick at a time; off a tick short, from 0 again, the fuse burning on
  put(g, 1, s[0] + 1.45, s[2], FLOOR);
  steps(g, AC.AS_DEFUSE - 1);
  assert.deepEqual([bomb(g).state, bomb(g).defusing], [PLANTED, AC.AS_DEFUSE - 1]);
  park(g, 1);
  g.step();
  assert.deepEqual([bomb(g).state, bomb(g).defusing, bomb(g).left], [PLANTED, 0, AC.AS_FUSE - 10 - AC.AS_DEFUSE]);
  // blue 3 and then blue 1 too, one after the other: the count goes on; the first of them on it in slot order defuses it
  put(g, 3, s[0], s[2] - 1, FLOOR);
  steps(g, 100);
  put(g, 1, s[0], s[2] + 1, FLOOR);
  steps(g, AC.AS_DEFUSE - 101);
  assert.deepEqual([bomb(g).state, bomb(g).defusing], [PLANTED, AC.AS_DEFUSE - 1]);
  g.step();
  const b = bomb(g);
  assert.deepEqual([b.state, b.pos, b.defusing, scores(g), defuses(g, 1), defuses(g, 3), points(g, 0)], [HOME, b.spot, 0, [0, 0], 1, 0, 0]);
  assert.deepEqual(news(g, from).slice(-1), [[AC.AS_MX_DEFUSE, 1, 1]]);
  assert.ok(near(newsAt(g, from).at(-1), STAND[1], 1e-3), 'news at the stand');
  assert.ok([1, 2, 3].every((p) => !dead(g, p)), 'nobody died');
  // its last tick: a defuse due on it comes first; a tick later, it goes off with the defuser on it
  for (const [left, off] of [[AC.AS_DEFUSE, false], [AC.AS_DEFUSE - 1, true]]) {
    for (const p of [1, 3]) park(g, p);
    plant(g, 0);
    setLeft(g, left);
    put(g, 3, s[0] + 0.5, s[2], FLOOR);
    from = g.v.fxCount();
    steps(g, AC.AS_DEFUSE);
    assert.deepEqual([news(g, from).map((n) => n[0]), dead(g, 3)], [[off ? AC.AS_MX_BOOM : AC.AS_MX_DEFUSE], off], `${left} to go`);
    respawned(g, 3);
  }
  assert.deepEqual([scores(g), defuses(g, 3)], [[1, 0], 1]);
});

test('Assault: a carrier killed drops it on what is under its feet, AS_RETURN to go, back in the middle on the AS_RETURN-th tick counting the drop\'s; the killer near enough takes it on the same tick; on a roof it stays on the roof', async () => {
  const g = await room(4);
  for (const p of [0, 1, 2, 3]) loadout(g, p, L.W_SWORD);
  steps(g, L.COOL_TICKS);
  // red 0 carries; blue 1 kills it from 2 m
  take(g, 0);
  let from = g.v.fxCount();
  melee(g, 1, 0);
  const f0 = g.v.fighter(0);
  let b = bomb(g);
  assert.ok(f0.dead && !carry(g, 0));
  assert.deepEqual([b.state, b.left, b.by, b.pos[0], b.pos[2]], [DROPPED, AC.AS_RETURN - 1, 0, f0.pos[0], f0.pos[2]], 'at its feet, a tick gone');
  assert.ok(Math.abs(b.pos[1] - g.v.height(502, 510)) < 1e-3, 'on the ground');
  assert.deepEqual(news(g, from), [[AC.AS_MX_DROP, 0, 0]], 'and the killer, 2 m off, didn\'t take it');
  // left alone: back on the AS_RETURN-th tick
  park(g, 1);
  steps(g, AC.AS_RETURN - 2);
  assert.deepEqual([bomb(g).state, bomb(g).left], [DROPPED, 1], 'a tick to go');
  from = g.v.fxCount();
  g.step();
  b = bomb(g);
  assert.deepEqual([b.state, b.pos, b.left, news(g, from)], [HOME, b.spot, 0, [[AC.AS_MX_HOME, 255, 0]]]);
  assert.deepEqual(newsAt(g, from), [b.spot], 'news in the middle');
  // the killer 1.2 m off takes it on the same tick: blue 3 carries, red 2 kills it
  respawned(g, 0);
  take(g, 3);
  from = g.v.fxCount();
  melee(g, 2, 3, { gap: 1.2 });
  b = bomb(g);
  assert.ok(dead(g, 3));
  assert.deepEqual([b.state, b.by, b.side, carry(g, 2)], [CARRIED, 2, 0, true]);
  assert.deepEqual(news(g, from), [[AC.AS_MX_DROP, 3, 1], [AC.AS_MX_TAKE, 2, 0]]);
  // a death by its own hand in the air: it falls to the ground under it
  put(g, 2, 530, 512, g.v.height(530, 512) + 3);
  suicide(g, 2);
  b = bomb(g);
  assert.equal(b.state, DROPPED);
  assert.ok(Math.abs(b.pos[1] - g.v.height(530, 512)) < 1e-3 && fpos(g, 2)[1] > b.pos[1] + 2, `from ${fpos(g, 2)[1]} to ${b.pos[1]}`);
  // on red's roof (a box over the room's floor), it stays on the roof
  respawned(g, 1);
  park(g, 1);
  lay(g, 512, b.spot[1], 512);
  take(g, 1);
  put(g, 1, 392, 512, ROOF);
  g.step();
  assert.deepEqual([fpos(g, 1)[1], bomb(g).pos[1]], [ROOF, ROOF], 'it stood on the roof');
  suicide(g, 1);
  assert.deepEqual([bomb(g).state, bomb(g).pos], [DROPPED, [392, ROOF, 512]]);
  // another fighter's death leaves it alone
  respawned(g, 0);
  take(g, 0);
  respawned(g, 3);
  put(g, 3, 470, 500);
  suicide(g, 3);
  assert.deepEqual([bomb(g).state, bomb(g).by], [CARRIED, 0]);
});

test('Assault: a carrier that leaves, rejoins, dies unseen or stops carrying drops it where it last had it; a planter who leaves takes its blast along: still a point for its side, nobody killed, owner 255', async () => {
  const g = await room(5); // red 0 2 4, blue 1 3
  const last = () => bomb(g).pos;
  // blue 1 leaves: the news still says blue
  take(g, 1);
  put(g, 1, 520, 520);
  g.step();
  let where = last();
  let from = g.v.fxCount();
  g.step([[L.EV_LEAVE, 1]]);
  let b = bomb(g);
  assert.deepEqual([b.state, b.left, b.pos[0], b.pos[2]], [DROPPED, AC.AS_RETURN - 1, where[0], where[2]]);
  assert.ok(Math.abs(b.pos[1] - g.v.height(520, 520)) < 1e-3);
  assert.deepEqual(news(g, from), [[AC.AS_MX_DROP, 1, 1]]);
  g.step([[L.EV_JOIN, 1]]);
  park(g, 1);
  // red 2 takes it, leaves and its slot is taken again on one tick
  take(g, 2);
  from = g.v.fxCount();
  g.step([[L.EV_LEAVE, 2], [L.EV_JOIN, 2]]);
  assert.deepEqual([bomb(g).state, carry(g, 2), news(g, from)], [DROPPED, false, [[AC.AS_MX_DROP, 2, 0]]]);
  park(g, 2);
  // dead with no kill (by hand): dropped, and the carry gone
  take(g, 3);
  g.dv.setUint8(rec(3) + L.P_FL, fl(g, 3) | L.PF_DEAD); g.dv.setUint16(rec(3) + L.A_RESPAWN, 500, true);
  g.step();
  assert.deepEqual([bomb(g).state, carry(g, 3)], [DROPPED, false]);
  // live and alive, its PF_CARRY gone (by hand) as it is moved off: dropped where it was
  take(g, 0);
  where = last();
  setCarry(g, 0, false);
  put(g, 0, 470, 500);
  from = g.v.fxCount();
  g.step();
  b = bomb(g);
  assert.deepEqual([b.state, b.pos[0], b.pos[2], news(g, from)], [DROPPED, where[0], where[2], [[AC.AS_MX_DROP, 0, 0]]]);
  // a planter who leaves: forgotten on the next tick; the bomb goes off for red, blue 1 on it lives
  respawned(g, 3);
  plant(g, 4);
  put(g, 1, STAND[1][0] + 1, STAND[1][2], FLOOR);
  g.step([[L.EV_LEAVE, 4]]);
  assert.deepEqual([bomb(g).state, bomb(g).by], [PLANTED, 255]);
  park(g, 1);
  put(g, 3, STAND[1][0] + 3, STAND[1][2], FLOOR);
  from = g.v.fxCount();
  steps(g, AC.AS_FUSE);
  assert.deepEqual([news(g, from), scores(g), dead(g, 3), fxs(g.v, L.FX_KILL, undefined, from)], [[[AC.AS_MX_BOOM, 255, 0]], [1, 0], false, []]);
  // a planter whose slot is taken on the same tick by someone on the other side: forgotten too
  // (4 back on red, 3 gone: red 0 2 4 to blue 1; 0 plants, leaves and comes back on blue)
  g.step([[L.EV_JOIN, 4]]);
  g.step([[L.EV_LEAVE, 3]]);
  park(g, 4);
  assert.equal(team(g, 4), 0);
  plant(g, 0);
  put(g, 1, STAND[1][0] + 1, STAND[1][2], FLOOR);
  g.step([[L.EV_LEAVE, 0], [L.EV_JOIN, 0]]);
  assert.deepEqual([team(g, 0), bomb(g).by], [1, 255]);
  park(g, 0);
  put(g, 1, STAND[1][0] + 3, STAND[1][2], FLOOR);
  from = g.v.fxCount();
  steps(g, AC.AS_FUSE);
  assert.deepEqual([news(g, from).map((n) => n.slice(0, 2)), scores(g), dead(g, 1)], [[[AC.AS_MX_BOOM, 255]], [2, 0], false]);
});

test('Assault: joins and leaves mid-objective: a join goes to the side with fewer and can take a dropped bomb, or defuse a planted one; a defuser leaving starts the count over', async () => {
  const g = await room(3); // red 0 2, blue 1
  take(g, 0);
  g.step([[L.EV_JOIN, 3]]);
  park(g, 3);
  assert.equal(team(g, 3), 1, 'fewer on blue');
  assert.equal(bomb(g).by, 0, 'the carrier carries on');
  // a leave of someone else changes nothing
  g.step([[L.EV_LEAVE, 2]]);
  assert.deepEqual([bomb(g).state, bomb(g).by], [CARRIED, 0]);
  // the carrier leaves; the joiner takes it
  g.step([[L.EV_LEAVE, 0]]);
  assert.equal(bomb(g).state, DROPPED);
  take(g, 3);
  assert.equal(bomb(g).side, 1);
  // red 0 back: on red, with nothing of its own; blue 3 plants on red's plate, red 0 defuses it, then leaves mid-count
  g.step([[L.EV_JOIN, 0]]);
  assert.deepEqual([team(g, 0), points(g, 0), carry(g, 0)], [0, 0, false]);
  plant(g, 3);
  put(g, 0, STAND[0][0], STAND[0][2] + 1, FLOOR);
  steps(g, 100);
  assert.equal(bomb(g).defusing, 100);
  g.step([[L.EV_LEAVE, 0]]);
  assert.equal(bomb(g).defusing, 0, 'from 0 again');
  // a join on red stands on it and defuses it
  g.step([[L.EV_JOIN, 2]]);
  assert.equal(team(g, 2), 0);
  put(g, 2, STAND[0][0] - 1, STAND[0][2], FLOOR);
  steps(g, AC.AS_DEFUSE);
  assert.deepEqual([bomb(g).state, defuses(g, 2), scores(g)], [HOME, 1, [0, 0]]);
});

test('Assault: over on the tick a side reaches AS_TARGET (its blast); at the clock the side ahead, or a draw; places by side, then bombs, then kills; the next match starts from zero', async () => {
  const g = await room(4); // 0 and 2 red, 1 and 3 blue
  g.dv.setUint32(L.AH_SCORE + 4, AC.AS_TARGET - 1, true);
  g.dv.setUint32(L.AH_SCORE, 1, true);
  [5, 9, 7, 2].forEach((n, p) => setPoints(g, p, n));
  [9, 0, 1, 4].forEach((k, p) => g.dv.setUint16(rec(p) + L.A_KILLS, k, true));
  plant(g, 1);
  steps(g, AC.AS_FUSE - 1);
  assert.equal(g.v.hole().state, L.H_PLAY, 'a tick short');
  let from = g.v.fxCount();
  g.step();
  assert.deepEqual([g.v.hole().state, scores(g), u32(g, L.AH_TEAMWIN)], [L.H_OVER, [1, AC.AS_TARGET], 2], 'over on its tick, blue\'s');
  assert.deepEqual(fxs(g.v, L.FX_MODE, L.MX_TEAMWIN, from).map((f) => f.shot), [2]);
  assert.deepEqual([0, 1, 2, 3].map((p) => points(g, p)), [5, 10, 7, 2]);
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.fighter(p).place), [4, 1, 3, 2], 'blue first (1 then 3), then red by bombs');
  // over, nothing runs: AO as play left it
  const over = bomb(g);
  steps(g, 300);
  assert.deepEqual([scores(g), bomb(g)], [[1, AC.AS_TARGET], over]);
  // the next match: the bomb in the middle, nobody carrying, the counts and scores 0
  nextPlay(g);
  const b = bomb(g);
  assert.deepEqual([scores(g), u32(g, L.AH_TEAMWIN), u32(g, L.AH_TARGET), b.state, b.pos, b.arming, b.defusing], [[0, 0], 0, AC.AS_TARGET, HOME, b.spot, 0, 0]);
  assert.ok([0, 1, 2, 3].every((p) => !carry(g, p) && points(g, p) === 0 && defuses(g, p) === 0));
  // the clock: red ahead by one, blue's bomb ticking on red's plate; red's 0 and 2 level on bombs, 2 with more kills
  const r = await room(4);
  r.dv.setUint32(L.AH_SCORE, 2, true); r.dv.setUint32(L.AH_SCORE + 4, 1, true);
  plant(r, 3);
  [1, 3, 1, 0].forEach((n, p) => setPoints(r, p, n));
  [1, 0, 2, 9].forEach((k, p) => r.dv.setUint16(rec(p) + L.A_KILLS, k, true));
  from = r.v.fxCount();
  endMatch(r);
  assert.deepEqual([r.v.hole().state, u32(r, L.AH_TEAMWIN), scores(r)], [L.H_OVER, 1, [2, 1]]);
  assert.deepEqual(fxs(r.v, L.FX_MODE, L.MX_TEAMWIN, from).map((f) => f.shot), [1]);
  assert.deepEqual([0, 1, 2, 3].map((p) => r.v.fighter(p).place), [2, 3, 1, 4]);
  // a draw: by bombs, then kills
  const d = await room(4);
  d.dv.setUint32(L.AH_SCORE, 1, true); d.dv.setUint32(L.AH_SCORE + 4, 1, true);
  [1, 3, 1, 0].forEach((n, p) => setPoints(d, p, n));
  [1, 0, 2, 9].forEach((k, p) => d.dv.setUint16(rec(p) + L.A_KILLS, k, true));
  endMatch(d);
  assert.equal(u32(d, L.AH_TEAMWIN), 3);
  assert.deepEqual([0, 1, 2, 3].map((p) => d.v.fighter(p).place), [3, 1, 2, 4]);
});

test('a Fiesta after an Assault match: its region exactly a Fiesta\'s (the mode header, the bomb, the records, no pads, no sides, nothing carried)', async () => {
  const g = await room(4, { mode: null, park: false });
  assert.equal(g.v.mode().mode, L.M_FIESTA);
  // the rotation doesn't play Assault yet: the next match forced to it, as a seed would
  g.dv.setUint32(L.HDR_SEED, forcedSeed(L.M_ASSAULT), true);
  endMatch(g);
  untilPlay(g);
  assert.equal(g.v.mode().mode, L.M_ASSAULT);
  // a bomb gone off, a defuse, a plant burning and a carrier as it ends
  for (let p = 0; p < 4; p++) park(g, p);
  plant(g, 0);
  steps(g, AC.AS_FUSE);
  plant(g, 2);
  put(g, 1, STAND[1][0], STAND[1][2] + 1, FLOOR);
  steps(g, AC.AS_DEFUSE);
  plant(g, 0);
  steps(g, 10);
  assert.deepEqual([scores(g), points(g, 0), defuses(g, 1), bomb(g).state], [[1, 0], 1, 1, PLANTED]);
  assert.ok(g.v.pads().length === MAP.pads.length && sides(g, [0, 1, 2, 3]).includes(1));
  g.dv.setUint32(L.HDR_SEED, 7, true);
  g.dv.setUint32(L.HDR_HOLE, L.ARENA_MODES.length - 1, true); // the next match is the rotation's Fiesta
  endMatch(g);
  assert.equal(u32(g, L.AH_TEAMWIN), 1);
  untilPlay(g);
  assert.equal(g.v.mode().mode, L.M_FIESTA);
  const zero = (a, b) => g.sim.u8.slice(a, b).every((x) => x === 0);
  assert.ok(zero(L.AH_MODE, L.AH_END), 'the header');
  assert.ok(zero(L.AO, L.AO + L.AO_SIZE), 'the bomb');
  assert.ok(zero(L.MODE_REC, L.MODE_REC + L.NPLAYER * L.MR_SIZE), 'the records');
  if (L.FIESTA) assert.ok(zero(L.PAD, L.PAD + L.NPAD * L.PAD_SIZE), 'the pads');
  for (let p = 0; p < L.NPLAYER; p++) assert.equal(fl(g, p) & (L.PF_BLUE | L.PF_CARRY), 0, `P${p}`);
  // and stays so through play, fighters on the bomb's spot and both plates
  put(g, 0, 512, 512); put(g, 1, STAND[0][0], STAND[0][2], FLOOR); put(g, 2, STAND[1][0], STAND[1][2], FLOOR);
  steps(g, 400);
  assert.ok(zero(L.AH_MODE, L.AH_END) && zero(L.AO, L.AO + L.AO_SIZE));
  assert.ok([0, 1, 2].every((p) => !carry(g, p)));
});

test('Assault: a carrier\'s runs on and off their plate, jumps, turns, clicks, swings and frames, predicted bit for bit from every tick as its count runs; and its planter\'s guns after', async () => {
  const g = await room(3);
  take(g, 0);
  put(g, 0, 626, 512, FLOOR); put(g, 1, 470, 540); put(g, 2, 600, 450);
  g.step();
  // east over blue's plate and back, 1.8 s a leg (on it some 60 ticks a pass), jumping, swinging, clicking
  const inputs = [];
  for (let k = 0; k < 400; k++) {
    inputs.push(arenaWord({ yaw: (k / 100) & 1 ? 8192 : 0, pitch: 480, move: 1, jump: k % 60 === 10 ? 1 : 0, shot: (k >> 4) & 3, melee: (k >> 6) & 1,
      gren: (k >> 5) & 1, slot: k >= 200 && k < 260 ? 1 : 0, serial: (arenaFrame({ lag: 4, reload: k > 100 }) >> ((g.v.tick + k) & 7)) & 1 }));
  }
  const shots = g.v.fighter(0).shots;
  let followed = 0, on = 0, most = 0;
  assert.ok(predicted(g, 0, inputs, () => {
    if (bomb(g).pos.every((c, i) => c === fpos(g, 0)[i])) followed++;
    if (bomb(g).arming) on++;
    most = Math.max(most, bomb(g).arming);
  }) > 400);
  const f = g.v.fighter(0);
  assert.ok(f.shots - shots >= 4, `${f.shots - shots} swings`);
  assert.ok(on > 100 && most > 40 && most < AC.AS_ARM, `${on} ticks on it, ${most} at most in a row`);
  assert.deepEqual([followed, carry(g, 0), bomb(g).state, f.grens, f.mag[0]], [400, true, CARRIED, 2, L.ARMS[L.W_AR].mag]);
  // planted: its guns are its hands' again, and the prediction shoots them as the world does
  plant(g, 0);
  const shot = [];
  for (let k = 0; k < 120; k++) shot.push(arenaWord({ yaw: 30 * k, pitch: 500, move: k < 60 ? 4 : 8, shot: (k >> 2) & 3 }));
  const mag = g.v.fighter(0).mag[0];
  assert.ok(predicted(g, 0, shot) > 120);
  assert.ok(g.v.fighter(0).mag[0] < mag, 'it fired');
});

// ---- the client module (client/am/assault.mjs)

// What its hooks put out against an Assault room's View, for slot `slot` (on `team`).
const hudOf = (g, slot, team, now = 0) => { const lines = []; assault.hud(g.v, { put: (x, y, s, c) => lines.push([y, s, c]), C, slot, me: slot >= 0 ? g.v.fighter(slot) : null, team, now }); return lines; };
function newsOf(g, f, slot) {
  const said = [], shown = [], glows = [];
  assault.news(f, { slot, me: slot >= 0 ? g.v.fighter(slot) : null, name: (p) => (p === slot ? 'YOU' : `P${p + 1}`), team: (p) => (p < L.NPLAYER ? team(g, p) : -1),
    feed: (t, c) => said.push([t, c]), banner: (t, c) => shown.push([t, c]), glow: (x) => glows.push(x), sound: {}, dist: 10, C, now: 0, view: g.v });
  return { said, shown, glows };
}
// (a spectator: slot -1, shown the fighter it watches)
function drawOf(g, slot, shown = slot, now = 0) {
  const out = { solid: [], glow: [], beams: [], markers: [], zone: null };
  assault.draw(g.v, { dt: 0, now, t: 1, slot, shown, me: slot >= 0 ? g.v.fighter(slot) : null, pme: null, cam: [512, 30, 400], view: g.v, pview: null }, out);
  return out;
}
const marks = (out) => out.markers.map((m) => [m.label, m.color]);
// p's goal, its role and rank as the bot gives them (sides dealt red, blue, red...: rank p >> 1)
const goalOf = (g, p) => { const rank = p >> 1; return assault.goal(g.v, g.v.fighter(p), { role: rank % 3 === 2 ? 'defend' : 'attack', rank, view: g.v, ally: (a, b) => g.v.ally(a, b), slot: p, t: g.v.tick }); };
const round = (p) => p.map((x) => Math.round(x * 100) / 100);
const brief = (o) => (o ? [round(o.pos), o.hurry, o.hold] : null);

test('Assault\'s client: the bomb from AO (the map\'s in the countdown); HUD lines for each state, each within 26 cells; news lines and banners from each side; the board\'s columns', async () => {
  assert.deepEqual([AMC[L.M_ASSAULT], assault.carry], [assault, 'bomb']);
  const c = await room(4, { play: false });
  const early = bombOf(c.v);
  assert.deepEqual([early.state, early.carrier, early.at, round(early.pos), early.plates.map(round)], [HOME, -1, -1, [512, 19.69, 512], STAND]);
  const g = await room(4); // 0 and 2 red, 1 and 3 blue
  const all = [];
  const hud = (slot, tm, now) => { const l = hudOf(g, slot, tm, now); all.push(...l); return l; };
  assert.deepEqual(bombOf(g.v).pos, bomb(g).spot);
  assert.deepEqual(hud(0, 0), [[2, 'BOMB  HOME', C.WHITE]]);
  // red 0 takes it: its own lines, everyone else's
  let from = g.v.fxCount();
  take(g, 0);
  const tk = fxs(g.v, L.FX_MODE, AC.AS_MX_TAKE, from)[0];
  assert.deepEqual(hud(0, 0, 0), [[2, 'YOU HAVE THE BOMB', C.YELLOW], [3, 'RUN TO THEIR BASE', C.WHITE]]);
  assert.deepEqual(hud(1, 1), [[2, 'BOMB  P1 HAS IT', C.RED]]);
  assert.deepEqual(hud(-1, -1), [[2, 'BOMB  P1 HAS IT', C.RED]]);
  assert.deepEqual(newsOf(g, tk, 0), { said: [['YOU TOOK THE BOMB', C.RED]], shown: [['YOU HAVE THE BOMB  RUN TO THEIR BASE', C.YELLOW]], glows: newsOf(g, tk, 0).glows });
  assert.deepEqual(newsOf(g, tk, 2).shown, [['YOUR SIDE HAS THE BOMB', C.RED]]);
  assert.deepEqual(newsOf(g, tk, 1), { said: [['P1 TOOK THE BOMB', C.RED]], shown: [], glows: newsOf(g, tk, 1).glows }, 'theirs: the feed only');
  // on their plate: the count on the HUD
  put(g, 0, 632, 512, FLOOR);
  steps(g, 125);
  assert.deepEqual(hud(0, 0, 0), [[2, 'YOU HAVE THE BOMB', C.YELLOW], [3, 'PLANTING  2', C.YELLOW]]);
  assert.deepEqual(hud(1, 1), [[2, 'BOMB  P1 HAS IT', C.RED], [3, 'P1 IS PLANTING  2', C.RED]]);
  // planted: its fuse, and what to do about it
  from = g.v.fxCount();
  steps(g, AC.AS_ARM - 125);
  assert.equal(bomb(g).state, PLANTED);
  const pl = fxs(g.v, L.FX_MODE, AC.AS_MX_PLANT, from)[0];
  assert.deepEqual(hud(0, 0), [[2, 'BOMB  PLANTED 0:05', C.RED], [3, 'AT THEIR BASE  GUARD IT', C.RED]]);
  assert.deepEqual(hud(1, 1), [[2, 'BOMB  PLANTED 0:05', C.RED], [3, 'AT YOUR BASE  DEFUSE IT', C.YELLOW]]);
  assert.deepEqual(hud(-1, -1), [[2, 'BOMB  PLANTED 0:05', C.RED], [3, 'AT BLUE BASE', C.CYAN]]);
  assert.deepEqual(newsOf(g, pl, 0).shown, [['YOU PLANTED IT  GUARD IT', C.YELLOW]]);
  assert.deepEqual(newsOf(g, pl, 2).shown, [['BOMB PLANTED  GUARD IT', C.RED]]);
  assert.deepEqual([newsOf(g, pl, 1).said, newsOf(g, pl, 1).shown], [[['P1 PLANTED THE BOMB', C.RED]], [['BOMB PLANTED  DEFUSE IT', C.YELLOW]]]);
  // blue 1 on it: DEFUSING; it defuses it
  put(g, 1, 632, 512.5, FLOOR);
  steps(g, 125);
  assert.deepEqual(hud(1, 1), [[2, 'BOMB  PLANTED 0:04', C.RED], [3, 'DEFUSING  1', C.CYAN]]);
  from = g.v.fxCount();
  steps(g, AC.AS_DEFUSE - 125);
  const df = fxs(g.v, L.FX_MODE, AC.AS_MX_DEFUSE, from)[0];
  assert.deepEqual(newsOf(g, df, 1), { said: [['YOU DEFUSED THE BOMB', C.CYAN]], shown: [['YOU DEFUSED IT', C.YELLOW]], glows: newsOf(g, df, 1).glows });
  assert.deepEqual(newsOf(g, df, 3).shown, [['YOUR SIDE DEFUSED IT', C.CYAN]]);
  assert.deepEqual(newsOf(g, df, 0), { said: [['P2 DEFUSED THE BOMB', C.CYAN]], shown: [], glows: newsOf(g, df, 0).glows });
  // dropped: its clock
  take(g, 3);
  put(g, 3, 560, 520);
  g.step();
  suicide(g, 3);
  assert.deepEqual(hud(0, 0), [[2, 'BOMB  DROPPED 0:15', C.WHITE]]);
  steps(g, 250);
  assert.deepEqual(hud(0, 0), [[2, 'BOMB  DROPPED 0:13', C.WHITE]]);
  // a blast: who scored, from each side, with a flash and a ring
  const boom = { tick: g.v.tick, kind: L.FX_MODE, owner: 0, shot: 0, pos: STAND[1], size: AC.AS_MX_BOOM };
  assert.deepEqual(newsOf(g, boom, 0).said, [['YOU BLEW UP BLUE BASE', C.RED]]);
  assert.deepEqual(newsOf(g, boom, 0).shown, [['YOU SCORED', C.YELLOW]]);
  assert.deepEqual(newsOf(g, boom, 2).shown, [['YOUR SIDE SCORES', C.RED]]);
  assert.deepEqual([newsOf(g, boom, 1).said, newsOf(g, boom, 1).shown], [[['P1 BLEW UP BLUE BASE', C.RED]], [['RED SCORES', C.RED]]]);
  assert.deepEqual(newsOf(g, { ...boom, owner: 255 }, 1).said, [['THE BOMB WENT OFF IN BLUE BASE', C.RED]]);
  assert.deepEqual(newsOf(g, boom, 1).glows.map((x) => x.kind), [3, 6]);
  assert.deepEqual(newsOf(g, { ...boom, size: AC.AS_MX_DROP, owner: 3, shot: 1 }, 0).said, [['P4 DROPPED THE BOMB', C.CYAN]]);
  assert.deepEqual(newsOf(g, { ...boom, size: AC.AS_MX_HOME, owner: 255, shot: 1 }, 0).said, [['THE BOMB IS BACK', C.WHITE]]);
  assert.deepEqual(newsOf(g, { ...boom, shot: 3 }, 0).said, [], 'no side, no news');
  assert.ok(all.every(([, t]) => t.length <= 26), 'every line within 26 cells');
  // the board: bombs and defuses
  setPoints(g, 0, 2);
  assert.deepEqual(assault.cols.map((col) => col.head), ['BOMBS', 'DEFUSES']);
  assert.deepEqual([0, 1].map((p) => assault.cols.map((col) => col.get(g.v.fighter(p)))), [['2', '0'], ['0', '1']]);
  assert.deepEqual(assault.state(g.v).bomb, { state: DROPPED, carrier: -1, by: 3, side: 1, at: -1, left: bomb(g).left, arming: 0, defusing: 0 });
});

test('Assault\'s client draws the bomb in the middle, over its carrier (not over yours), lying and planted with its pillar; both plates\' rims and the disc where it\'s headed; waypoints TAKE, ESCORT, KILL, PLANT, DEFEND, DEFUSE, GUARD', async () => {
  const g = await room(4); // 0 and 2 red, 1 and 3 blue
  const balls = (out) => out.solid.filter((s) => s.kind === 0);
  // home: the bomb hovering in the middle, its light, a ring of lights round each plate, no disc; TAKE for either side
  let out = drawOf(g, 0);
  assert.deepEqual(balls(out).map((s) => [s.pos[0], s.pos[2]]), [[512, 512]]);
  assert.ok(balls(out)[0].pos[1] > bomb(g).spot[1]);
  assert.equal(out.glow.filter((x) => x.kind === 3).length, 24, 'two rims of 12');
  assert.ok(out.glow.some((x) => x.kind === 5), 'its light');
  assert.equal(out.zone, null);
  assert.deepEqual(marks(out), [['TAKE', C.YELLOW]]);
  assert.deepEqual(marks(drawOf(g, 1)), [['TAKE', C.YELLOW]]);
  assert.deepEqual(marks(drawOf(g, -1)), [['BOMB', C.YELLOW]], 'a spectator watching nobody');
  // red 0 carries: over it for everyone else; ESCORT and PLANT for red 2, KILL and DEFEND for blue, PLANT for 0 itself
  take(g, 0);
  put(g, 0, 520, 540);
  g.step();
  const at0 = fpos(g, 0);
  out = drawOf(g, 2);
  assert.ok(near(balls(out)[0].pos, [at0[0], at0[1] + 2.25, at0[2]], 1e-3), 'over its head');
  assert.deepEqual(marks(out), [['ESCORT', C.RED], ['PLANT', C.CYAN]]);
  assert.deepEqual(out.zone && [out.zone.x, out.zone.z, out.zone.r, out.zone.color], [632, 512, Number(AC.AS_PLATE_R), SIDE_RGB[1]], 'the disc on blue\'s plate');
  assert.deepEqual(marks(drawOf(g, 1)), [['KILL', C.RED], ['DEFEND', C.CYAN]]);
  out = drawOf(g, 0);
  assert.deepEqual([balls(out), marks(out)], [[], [['PLANT', C.YELLOW]]]);
  assert.deepEqual(marks(drawOf(g, -1, 0)), [['PLANT', C.YELLOW]], 'a spectator watching it: as it sees it');
  assert.deepEqual(marks(drawOf(g, -1)), [['RED', C.RED]]);
  const plantAt = drawOf(g, 2).markers[1].pos;
  assert.ok(near(plantAt, [632, 21 + 2.9, 512], 1e-3), `the plate's waypoint ${plantAt}`);
  // planted on blue's: sitting on the stand, a pillar of light over it; DEFUSE with its seconds for blue, GUARD for red
  put(g, 0, 632, 512, FLOOR);
  steps(g, AC.AS_ARM);
  assert.equal(bomb(g).state, PLANTED);
  steps(g, 125);
  out = drawOf(g, 1);
  assert.ok(near(balls(out)[0].pos, [632, 21.32, 512], 1e-3));
  assert.equal(out.beams.length, 1);
  assert.deepEqual(marks(out), [['DEFUSE 4', C.YELLOW]]);
  assert.deepEqual(marks(drawOf(g, 2)), [['GUARD 4', C.RED]]);
  assert.deepEqual([out.zone.x, out.zone.pulse], [632, 1]);
  // its light blinks faster as it burns: on and off within 200 ms with a second to go
  setLeft(g, 125);
  const lit = [0, 40, 80, 120, 160].map((now) => drawOf(g, 1, 1, now).glow.find((x) => x.kind === 5).size);
  assert.ok(new Set(lit).size === 2, `blinking ${lit}`);
  // lying: TAKE where it lies
  lay(g, 540, g.v.height(540, 500), 500);
  out = drawOf(g, 3);
  assert.deepEqual([marks(out), out.zone], [[['TAKE', C.YELLOW]], null]);
  assert.ok(Math.abs(balls(out)[0].pos[0] - 540) < 1e-3);
});

test('Assault\'s brain: a carrier runs to their plate by a flank and holds on it; attackers run for the bomb, shield their carrier and hunt theirs; defenders hold their plate, go for a carrier near it, and defuse; a planted bomb guarded or defused', async () => {
  const g = await room(8); // red 0 2 4 6 (4 defends: rank 2); blue 1 3 5 7 (5 defends)
  for (let p = 0; p < 8; p++) put(g, p, 470 + 6 * p, 560);
  g.step();
  const spot = bomb(g).spot;
  // home: attackers run for it; defenders hold their own plate
  assert.deepEqual(brief(goalOf(g, 0)), [round(spot), 1, false]);
  assert.deepEqual(brief(goalOf(g, 3)), [round(spot), 1, false]);
  assert.deepEqual(brief(goalOf(g, 4)), [STAND[0], 0, true]);
  assert.deepEqual(brief(goalOf(g, 5)), [STAND[1], 0, true]);
  // red 0 takes it at (520, 540)
  lay(g, 520, g.v.height(520, 540), 540);
  put(g, 0, 520, 540);
  g.step();
  const at0 = fpos(g, 0);
  // the carrier: hurry 1 toward blue's plate, round by a flank out on the field; from 25 m in, onto the plate and on it
  let o = goalOf(g, 0);
  assert.equal(o.hurry, 1);
  assert.ok(Math.hypot(o.pos[0] - at0[0], o.pos[2] - at0[2]) > 5 && o.pos[0] > at0[0], `on toward blue's: ${round(o.pos)}`);
  put(g, 0, 615, 512);
  g.step();
  assert.deepEqual(brief(goalOf(g, 0)), [STAND[1], 1, true]);
  put(g, 0, 520, 540);
  g.step();
  // red's attackers: between it and the enemy nearest it, at a run that doesn't stop to shoot; blue's attackers hunt it; blue's defender holds
  for (const p of [2, 6]) {
    o = goalOf(g, p);
    assert.ok(Math.hypot(o.pos[0] - fpos(g, 0)[0], o.pos[2] - fpos(g, 0)[2]) < 4.01 && o.hurry >= 0.9, `P${p + 1} shields it: ${brief(o)}`);
  }
  for (const p of [1, 3, 7]) assert.deepEqual(brief(goalOf(g, p)), [round(fpos(g, 0)), 0.3, false], `P${p + 1}`);
  assert.deepEqual(brief(goalOf(g, 5)), [STAND[1], 0, true]);
  // within 30 m of blue's plate, blue's defender goes for it; within 25 m, red's attackers go onto the plate ahead of it
  put(g, 0, 610, 512);
  g.step();
  assert.deepEqual(brief(goalOf(g, 5)), [round(fpos(g, 0)), 0.5, false]);
  for (const p of [2, 6]) {
    o = goalOf(g, p);
    assert.ok(Math.hypot(o.pos[0] - 632, o.pos[2] - 512) < 3.01 && o.hold && o.hurry === 0.6, `P${p + 1} clears the plate: ${brief(o)}`);
  }
  // planted on blue's: blue's defender and anyone within 40 m run onto it; the rest wait in the middle; red guards it from near, its defender stays home
  plant(g, 0);
  put(g, 3, 600, 512); put(g, 2, 600, 520);
  g.step();
  assert.deepEqual(brief(goalOf(g, 5)), [STAND[1], 1, true]);
  assert.deepEqual(brief(goalOf(g, 3)), [STAND[1], 1, true]);
  assert.equal(goalOf(g, 1).pos[0] < 560, true, 'blue 1, far off, to the middle');
  o = goalOf(g, 2);
  assert.ok(Math.hypot(o.pos[0] - 632, o.pos[2] - 512) < 3.01 && o.hold && o.hurry < 0.5, `red 2 guards it: ${brief(o)}`);
  assert.deepEqual(brief(goalOf(g, 4)), [STAND[0], 0, true]);
  // nothing for a fighter with no side
  assert.equal(assault.goal(g.v, { ...g.v.fighter(0), team: -1 }, { role: 'attack', rank: 0 }), null);
});

// AI fighters in Assault on the debug build: no trap, and every tick's hash
// the same replayed on 1 and 4 threads; the bomb's news by side as they play.
async function bots(n, ticks, seed) {
  const [debug, bytes] = [arenaBytes(true), arenaBytes()];
  const seen = {};
  for (const k of ['take', 'plant', 'boom', 'defuse', 'drop', 'home']) seen[k] = [0, 0];
  const what = { [AC.AS_MX_TAKE]: 'take', [AC.AS_MX_PLANT]: 'plant', [AC.AS_MX_BOOM]: 'boom', [AC.AS_MX_DEFUSE]: 'defuse', [AC.AS_MX_DROP]: 'drop', [AC.AS_MX_HOME]: 'home' };
  let count = 0, kills = 0, n2 = null;
  const { log } = await playArena({ bytes: debug, seed: forcedSeed(L.M_ASSAULT, seed), bots: n, ticks, leaveAt: 1000,
    onTick: (t, v) => {
      for (let k = Math.max(count, v.fxCount() - L.FX_MAX); k < v.fxCount(); k++) {
        const f = v.fx(k);
        if (f.kind === L.FX_MODE && what[f.size]) seen[what[f.size]][f.shot]++;
        if (f.kind === L.FX_KILL) kills++;
      }
      count = v.fxCount();
      n2 = [v.dv.getUint32(L.AH_TEAMN, true), v.dv.getUint32(L.AH_TEAMN + 4, true)];
    } });
  const parsed = parseLog(log);
  const a = await replay({ bytes, log: parsed, ticks, threads: 1, tag: `as${n}a` });
  const b = await replay({ bytes, log: parsed, ticks, threads: 4, tag: `as${n}b`, startWorkers });
  assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
  assert.deepEqual(n2, [n / 2, n / 2]);
  return { ...seen, kills };
}

test('Assault with 8 AI fighters on Blood Gulch: no trap on the debug build, the same hash on every tick on 1 and 4 threads; the bomb carried, planted and gone off for both sides in 20,000 ticks', async (t) => {
  const s = await bots(8, 20000, 9);
  t.diagnostic(JSON.stringify(s));
  assert.ok(s.take.every((k) => k >= 3) && s.drop.every((k) => k >= 2), 'it changes hands');
  assert.ok(s.plant.every((k) => k >= 1) && s.boom.every((k) => k >= 1), 'both sides plant it and score');
});

test('Assault with 16 AI fighters on Blood Gulch: no trap on the debug build, the same hash on every tick on 1 and 4 threads; the bomb planted and gone off for both sides in 20,000 ticks', async (t) => {
  const s = await bots(16, 20000, 7);
  t.diagnostic(JSON.stringify(s));
  assert.ok(s.take.every((k) => k >= 3) && s.drop.every((k) => k >= 2), 'it changes hands');
  assert.ok(s.plant.every((k) => k >= 1) && s.boom.every((k) => k >= 1), 'both sides plant it and score');
});
