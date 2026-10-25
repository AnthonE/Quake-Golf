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

// Oddball (src/am/oddball.wat): one skull, taken by touch, a point a second
// for the side holding it. Helpers as test/arena-teams.test.mjs has them; the
// skull read straight from AO (its fields in src/am/oddball.mjs).

// A room on the debug build playing Oddball (or `mode`; null plays the
// rotation): n fighters in, each parked during the countdown on open ground
// away from the skull's spot (so nobody spawned on it takes it), stepped to
// the first tick of play and one more.
let debugModule = null;
async function room(n = 2, { seed = 7, mode = L.M_ODDBALL, park: parked = true } = {}) {
  debugModule ||= await WebAssembly.compile(arenaBytes(true));
  const memory = newMemory();
  const sim = new Sim(await instantiate(debugModule, memory), memory);
  sim.init(mode === null ? seed : forcedSeed(mode, seed));
  const v = new View(sim.memory.buffer);
  const dv = new DataView(sim.memory.buffer);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); };
  const g = { sim, v, dv, step, n };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
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
const setPoints = (g, p, n) => g.dv.setUint16(L.MODE_REC + p * L.MR_SIZE + L.MR_POINTS, n, true);
const MAP = compileMap();

function put(g, p, x, z, y = g.v.height(x, z)) {
  g.dv.setFloat32(rec(p) + L.P_PX, x, true);
  g.dv.setFloat32(rec(p) + L.P_PY, y, true);
  g.dv.setFloat32(rec(p) + L.P_PZ, z, true);
  for (const o of [L.P_VX, L.P_VY, L.P_VZ]) g.dv.setFloat32(rec(p) + o, 0, true);
}
// Slot p's place on open ground mid-field, 16 m or more from the skull's spot.
const park = (g, p) => put(g, p, 491 + 3 * (p % 8), 528 + 3 * (p >> 3));

// The skull as AO holds it.
function skull(g) {
  const f = (o) => g.dv.getFloat32(L.AO + o, true);
  return { pos: [f(L.OB_POS), f(L.OB_POS + 4), f(L.OB_POS + 8)], state: g.sim.u8[L.AO + L.OB_STATE], carrier: g.sim.u8[L.AO + L.OB_CARRIER],
    left: g.dv.getUint16(L.AO + L.OB_LEFT, true), spot: [f(L.OB_SPOT), f(L.OB_SPOT + 4), f(L.OB_SPOT + 8)],
    held: [g.dv.getUint16(L.AO + L.OB_HELD, true), g.dv.getUint16(L.AO + L.OB_HELD + 2, true)], side: g.sim.u8[L.AO + L.OB_SIDE] };
}
// The skull laid down by hand at (x, y, z), `left` ticks to go, nobody carrying it.
function lay(g, x, y, z, left = 1000) {
  const s = skull(g);
  if (s.state === L.OB_CARRIED) setCarry(g, s.carrier, false);
  [x, y, z].forEach((c, k) => g.dv.setFloat32(L.AO + L.OB_POS + 4 * k, c, true));
  g.sim.u8[L.AO + L.OB_STATE] = L.OB_DROPPED;
  g.dv.setUint16(L.AO + L.OB_LEFT, left, true);
}
const setHeld = (g, side, n) => g.dv.setUint16(L.AO + L.OB_HELD + 2 * side, n, true);
// p stands on the skull and takes it on the next tick
function take(g, p) {
  const s = skull(g);
  put(g, p, s.pos[0], s.pos[2], s.pos[1]);
  g.step();
  assert.deepEqual([skull(g).state, skull(g).carrier, carry(g, p)], [L.OB_CARRIED, p, true], `P${p} takes it`);
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

// p's melee at q on open ground, q `gap` m off facing p and pressing nothing.
function melee(g, p, q, { gap = 2 } = {}) {
  put(g, p, 500, 510); put(g, q, 500 + gap, 510);
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
// The skull's news from `from` on: [what, owner, shot, x, y, z]
const news = (g, from) => fxs(g.v, L.FX_MODE, undefined, from).filter((f) => f.size >= L.OB_MX_TAKE && f.size <= L.OB_MX_RESET)
  .map((f) => [f.size, f.owner, f.shot, ...f.pos]);
const endMatch = (g) => { g.dv.setUint32(L.HDR_UNTIL, g.v.tick + 1, true); for (let i = 0; i < 4; i++) g.step(); };
const untilPlay = (g) => { while (g.v.hole().state !== L.H_PLAY) g.step(); g.step(); };
// The next match's play, everyone parked through its countdown.
const nextPlay = (g) => {
  while (g.v.hole().state !== L.H_COUNT) g.step();
  for (let p = 0; p < g.n; p++) park(g, p);
  untilPlay(g);
};
const steps = (g, n) => { for (let i = 0; i < n; i++) g.step(); };

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

test('Oddball: the skull at its spot as play starts (MAP_BALL, at its feet height), nothing of it before; the target OB_TARGET', async () => {
  debugModule ||= await WebAssembly.compile(arenaBytes(true));
  const memory = newMemory();
  const sim = new Sim(await instantiate(debugModule, memory), memory);
  sim.init(forcedSeed(L.M_ODDBALL));
  const v = new View(sim.memory.buffer);
  const zero = () => sim.u8.slice(L.AO, L.AO + L.AO_SIZE).every((x) => x === 0);
  sim.feedPlayers([[L.EV_JOIN, 0], [L.EV_JOIN, 1]]);
  sim.x.step();
  let counted = 0;
  while (v.hole().state !== L.H_PLAY) { assert.ok(zero(), 'the countdown'); counted++; sim.x.step(); }
  assert.ok(counted > 300);
  const g = { sim, v, dv: new DataView(memory.buffer) };
  const s = skull(g);
  assert.deepEqual([s.spot[0], s.spot[2]], [MAP.ball[0], MAP.ball[1]]);
  assert.ok(Math.abs(s.spot[1] - 19.69) < 0.01 && Math.abs(s.spot[1] - v.height(512, 512)) < 1e-3, `its feet height ${s.spot[1]}`);
  assert.deepEqual([s.pos, s.state, s.left, s.held], [s.spot, L.OB_HOME, 0, [0, 0]]);
  assert.deepEqual([u32(g, L.AH_TARGET), scores(g)], [L.OB_TARGET, [0, 0]]);
  // nobody near it: it stays
  for (const p of [0, 1]) park(g, p);
  for (let i = 0; i < 300; i++) sim.x.step();
  assert.deepEqual([skull(g).state, skull(g).pos, scores(g)], [L.OB_HOME, s.spot, [0, 0]]);
});

test('Oddball: taken by the first fighter in slot order alive and not carrying, within OB_TOUCH_R across and OB_TOUCH_H up or down, either side; news at the skull', async () => {
  const g = await room(4); // 0 and 2 red, 1 and 3 blue
  assert.deepEqual(sides(g, [0, 1, 2, 3]), [0, 1, 0, 1]);
  const spot = skull(g).spot;
  // 1.55 m across: not near enough
  put(g, 0, spot[0] + 1.55, spot[2]);
  steps(g, 5);
  assert.equal(skull(g).state, L.OB_HOME);
  // all four inside 1.45 m: 0 dead and 2 carrying (by hand) come first in slot order, so blue 1 takes it, not 3
  put(g, 0, spot[0] + 1.45, spot[2]); put(g, 1, spot[0], spot[2] - 1.45); put(g, 2, spot[0] - 1.0, spot[2] + 1.0); put(g, 3, spot[0], spot[2] + 0.5);
  g.dv.setUint8(rec(0) + L.P_FL, fl(g, 0) | L.PF_DEAD); g.dv.setUint16(rec(0) + L.A_RESPAWN, 2000, true);
  setCarry(g, 2, true);
  g.dv.setUint8(rec(1) + L.A_BURST, 2); g.dv.setUint8(rec(1) + L.A_RELOAD, 30);
  let from = g.v.fxCount();
  g.step();
  let s = skull(g);
  assert.deepEqual([s.state, s.carrier, s.side, carry(g, 1), carry(g, 3)], [L.OB_CARRIED, 1, 1, true, false]);
  assert.deepEqual([g.v.fighter(1).burst, g.v.fighter(1).reload], [0, 0], 'its burst and reload stopped');
  assert.deepEqual(s.pos, g.v.fighter(1).pos, 'at its carrier\'s feet');
  assert.deepEqual(news(g, from), [[L.OB_MX_TAKE, 1, 1, ...spot]], 'news where it was taken');
  // the band: laid 1.95 m over or under a fighter's feet it is taken, 2.05 m it isn't
  setCarry(g, 2, false);
  g.dv.setUint8(rec(0) + L.P_FL, fl(g, 0) & ~L.PF_DEAD);
  for (const p of [0, 1, 3]) park(g, p);
  put(g, 2, 500, 540);
  g.step();
  const y = g.v.fighter(2).pos[1];
  for (const [dy, taken] of [[2.05, false], [-2.05, false], [1.95, true], [-1.95, true], [0, true]]) {
    lay(g, 500.5, y + dy, 540.5);
    g.step();
    assert.equal(skull(g).state === L.OB_CARRIED && skull(g).carrier === 2, taken, `${dy} m`);
  }
  // either side: red 2 has it now; laid by blue 3 alone, 3 takes it
  lay(g, 512, spot[1], 512);
  park(g, 2);
  put(g, 3, 512.5, 512);
  from = g.v.fxCount();
  g.step();
  s = skull(g);
  assert.deepEqual([s.carrier, s.side, carry(g, 3), carry(g, 2)], [3, 1, true, false]);
  assert.deepEqual(news(g, from).map((n) => n.slice(0, 3)), [[L.OB_MX_TAKE, 3, 1]]);
  // a slot that has left, standing where it was, is nobody
  lay(g, 512, spot[1], 512);
  park(g, 3);
  put(g, 0, 512, 512);
  g.step([[L.EV_LEAVE, 0]]);
  assert.equal(skull(g).state, L.OB_DROPPED);
});

test('Oddball: carried, it rides at its carrier\'s feet; every OB_POINT ticks a side holds it is a point for the side and one for the carrier then; a side\'s count is kept while the skull changes hands', async () => {
  const g = await room(4); // 0 and 2 red, 1 and 3 blue
  for (const p of [1, 2]) loadout(g, p, L.W_SWORD);
  steps(g, L.COOL_TICKS);
  take(g, 0);
  assert.deepEqual([skull(g).held, scores(g)], [[0, 0], [0, 0]], 'the tick it is taken counts nothing');
  // 0 runs: the skull follows tick by tick
  for (let i = 0; i < L.OB_POINT - 1; i++) {
    g.step([[L.EV_INPUT, 0, arenaWord({ yaw: 4096, move: 1 })]]);
    assert.deepEqual(skull(g).pos, g.v.fighter(0).pos);
  }
  assert.ok(Math.hypot(g.v.fighter(0).pos[0] - 512, g.v.fighter(0).pos[2] - 512) > 3, 'it ran');
  assert.deepEqual([skull(g).held, scores(g), points(g, 0)], [[L.OB_POINT - 1, 0], [0, 0], 0]);
  g.step([[L.EV_INPUT, 0, arenaWord({ yaw: 4096 })]]);
  assert.deepEqual([skull(g).held, scores(g), points(g, 0)], [[0, 0], [1, 0], 1], 'a point');
  steps(g, 100);
  assert.deepEqual(skull(g).held, [100, 0]);
  // blue 1 kills 0 (its tick counts nothing) and takes it: blue counts from 0, red's 100 kept
  melee(g, 1, 0);
  assert.deepEqual([g.v.fighter(0).dead, skull(g).state, skull(g).held], [true, L.OB_DROPPED, [100, 0]]);
  take(g, 1);
  steps(g, 50);
  assert.deepEqual([skull(g).held, scores(g)], [[100, 50], [1, 0]]);
  // red 2 kills 1 and takes it: 25 more of red's is red's point, and 2's
  melee(g, 2, 1);
  take(g, 2);
  steps(g, L.OB_POINT - 100 - 1);
  assert.deepEqual([skull(g).held, scores(g)], [[L.OB_POINT - 1, 50], [1, 0]]);
  g.step();
  assert.deepEqual([skull(g).held, scores(g)], [[0, 50], [2, 0]]);
  assert.deepEqual([0, 1, 2, 3].map((p) => points(g, p)), [1, 0, 1, 0]);
  // a carrier's own swing kills and it carries on
  steps(g, L.COOL_TICKS);
  put(g, 3, 503, 520);
  const w = still(g, 2);
  put(g, 2, 501, 520);
  g.step([[L.EV_INPUT, 3, arenaWord({ yaw: 8192, ...still(g, 3) })], [L.EV_INPUT, 2, at(g, 2, 3, 1.0, { ...w, melee: w.melee ^ 1 })]]);
  assert.deepEqual([g.v.fighter(3).dead, skull(g).carrier, carry(g, 2), skull(g).held], [true, 2, true, [L.COOL_TICKS + 1, 50]]);
});

test('Oddball: a carrier killed drops it on what is under its feet, OB_RESET to go; news owner the carrier, shot its side; the killer near enough takes it on the same tick', async () => {
  const g = await room(4);
  for (const p of [0, 1, 2, 3]) loadout(g, p, L.W_SWORD);
  steps(g, L.COOL_TICKS);
  // red 0 carries; blue 1 kills it from 2 m
  take(g, 0);
  let from = g.v.fxCount();
  melee(g, 1, 0);
  const f0 = g.v.fighter(0);
  let s = skull(g);
  assert.ok(f0.dead && !carry(g, 0));
  assert.deepEqual([s.state, s.left, s.pos[0], s.pos[2]], [L.OB_DROPPED, L.OB_RESET - 1, f0.pos[0], f0.pos[2]], 'at its feet, a tick gone');
  assert.ok(Math.abs(s.pos[1] - g.v.height(502, 510)) < 1e-3, 'on the ground');
  assert.deepEqual(news(g, from), [[L.OB_MX_DROP, 0, 0, ...s.pos]], 'and the killer, 2 m off, didn\'t take it');
  // a dead body on it doesn't either
  park(g, 1);
  steps(g, 10);
  assert.equal(skull(g).state, L.OB_DROPPED);
  // the killer 1.2 m off takes it on the same tick: blue 3 carries, red 2 kills it
  take(g, 3);
  from = g.v.fxCount();
  melee(g, 2, 3, { gap: 1.2 });
  s = skull(g);
  assert.ok(g.v.fighter(3).dead);
  assert.deepEqual([s.state, s.carrier, s.side, carry(g, 2)], [L.OB_CARRIED, 2, 0, true]);
  assert.deepEqual(news(g, from).map((n) => n.slice(0, 3)), [[L.OB_MX_DROP, 3, 1], [L.OB_MX_TAKE, 2, 0]]);
  // a death by its own hand drops it too; in the air, it falls to the ground under it
  while (g.v.fighter(1).dead) g.step();
  park(g, 1);
  put(g, 2, 530, 512, g.v.height(530, 512) + 3);
  from = g.v.fxCount();
  suicide(g, 2);
  s = skull(g);
  assert.deepEqual([s.state, news(g, from).map((n) => n.slice(0, 3))], [L.OB_DROPPED, [[L.OB_MX_DROP, 2, 0]]]);
  assert.ok(Math.abs(s.pos[1] - g.v.height(530, 512)) < 1e-3 && g.v.fighter(2).pos[1] > s.pos[1] + 2, `from ${g.v.fighter(2).pos[1]} to ${s.pos[1]}`);
  // on red's roof (a box over the room's floor), it stays on the roof
  while (g.v.fighter(0).dead) g.step();
  const roof = MAP.boxes.map((b) => b.box).find((b) => 392 > b[0] && 392 < b[3] && 512 > b[2] && 512 < b[5])[4];
  lay(g, 512, skull(g).spot[1], 512);
  take(g, 0);
  put(g, 0, 392, 512, roof);
  g.step();
  assert.deepEqual([g.v.fighter(0).pos[1], skull(g).pos[1]], [roof, roof], 'it stood on the roof');
  suicide(g, 0);
  assert.deepEqual([skull(g).state, skull(g).pos], [L.OB_DROPPED, [392, roof, 512]]);
  // another fighter's death leaves it alone
  take(g, 1);
  const was = skull(g);
  while (g.v.fighter(3).dead) g.step();
  put(g, 3, 470, 500);
  suicide(g, 3);
  assert.deepEqual([skull(g).state, skull(g).carrier], [L.OB_CARRIED, 1]);
  assert.deepEqual(skull(g).side, was.side);
});

test('Oddball: a carrier that leaves, rejoins, dies unseen or stops carrying drops it where it last had it, news with the side it took it for', async () => {
  const g = await room(4);
  const last = () => skull(g).pos;
  // blue 1 leaves: its record reads red now, the news still says blue
  take(g, 1);
  put(g, 1, 520, 520);
  g.step();
  let where = last();
  let from = g.v.fxCount();
  g.step([[L.EV_LEAVE, 1]]);
  let s = skull(g);
  assert.deepEqual([s.state, s.left, s.pos[0], s.pos[2]], [L.OB_DROPPED, L.OB_RESET - 1, where[0], where[2]]);
  assert.ok(Math.abs(s.pos[1] - g.v.height(520, 520)) < 1e-3);
  assert.deepEqual(news(g, from), [[L.OB_MX_DROP, 1, 1, ...s.pos]]);
  // red 2 takes it, leaves and its slot is taken again on one tick
  take(g, 2);
  from = g.v.fxCount();
  g.step([[L.EV_LEAVE, 2], [L.EV_JOIN, 2]]);
  assert.deepEqual([skull(g).state, carry(g, 2), points(g, 2), news(g, from).map((n) => n.slice(0, 3))], [L.OB_DROPPED, false, 0, [[L.OB_MX_DROP, 2, 0]]]);
  // dead with no kill (by hand): dropped, and the carry gone
  take(g, 3);
  g.dv.setUint8(rec(3) + L.P_FL, fl(g, 3) | L.PF_DEAD); g.dv.setUint16(rec(3) + L.A_RESPAWN, 500, true);
  g.step();
  assert.deepEqual([skull(g).state, carry(g, 3)], [L.OB_DROPPED, false]);
  // live and alive, its PF_CARRY gone (by hand) as it is moved off: dropped where it was
  take(g, 0);
  where = last();
  setCarry(g, 0, false);
  put(g, 0, 470, 500);
  from = g.v.fxCount();
  g.step();
  s = skull(g);
  assert.deepEqual([s.state, s.pos[0], s.pos[2], news(g, from).map((n) => n.slice(0, 3))], [L.OB_DROPPED, where[0], where[2], [[L.OB_MX_DROP, 0, 0]]]);
  // and with it still standing there, it takes it straight back
  take(g, 0);
  setCarry(g, 0, false);
  from = g.v.fxCount();
  g.step();
  assert.deepEqual([skull(g).state, carry(g, 0), news(g, from).map((n) => n.slice(0, 3))], [L.OB_CARRIED, true, [[L.OB_MX_DROP, 0, 0], [L.OB_MX_TAKE, 0, 0]]]);
});

test('Oddball: a dropped skull goes back to its spot after OB_RESET ticks, counting the one it fell on, unless taken first; at its spot it can be taken at once; the counts kept', async () => {
  const g = await room(2); // red 0, blue 1
  take(g, 0);
  put(g, 0, 530, 512);
  steps(g, 30);
  setHeld(g, 1, 40);
  const held = skull(g).held;
  suicide(g, 0);
  const spot = skull(g).spot;
  assert.deepEqual([skull(g).state, skull(g).left], [L.OB_DROPPED, L.OB_RESET - 1]);
  steps(g, L.OB_RESET - 2);
  assert.deepEqual([skull(g).state, skull(g).left], [L.OB_DROPPED, 1], 'a tick to go');
  let from = g.v.fxCount();
  g.step();
  let s = skull(g);
  assert.deepEqual([s.state, s.pos, s.left, s.held], [L.OB_HOME, spot, 0, held], 'back, the counts kept');
  assert.deepEqual(news(g, from), [[L.OB_MX_RESET, 255, 0, ...spot]], 'news at its spot, nobody\'s');
  // dropped and taken before its time: it stays with its carrier past it
  take(g, 1);
  put(g, 1, 530, 500);
  g.step();
  suicide(g, 1);
  steps(g, 1000);
  park(g, 0);
  take(g, 0);
  steps(g, L.OB_RESET);
  assert.deepEqual([skull(g).state, skull(g).carrier], [L.OB_CARRIED, 0]);
  // dropped again; someone on its spot as it comes back takes it on that tick
  suicide(g, 0);
  steps(g, L.OB_RESET - 2);
  while (g.v.fighter(1).dead) g.step();
  put(g, 1, spot[0], spot[2], spot[1]);
  from = g.v.fxCount();
  g.step();
  s = skull(g);
  assert.deepEqual([s.state, s.carrier], [L.OB_CARRIED, 1]);
  assert.deepEqual(news(g, from).map((n) => n.slice(0, 3)), [[L.OB_MX_RESET, 255, 0], [L.OB_MX_TAKE, 1, 1]]);
});

test('Oddball: joins and leaves mid-objective: a join goes to the side with fewer and can take a dropped skull; a carrier leaving keeps its side\'s count for the next', async () => {
  const g = await room(3); // 0 and 2 red, 1 blue
  take(g, 1);
  steps(g, 60);
  assert.deepEqual(skull(g).held, [0, 60]);
  g.step([[L.EV_JOIN, 3]]);
  park(g, 3);
  assert.equal(team(g, 3), 1, 'fewer on blue');
  assert.deepEqual([skull(g).carrier, skull(g).held], [1, [0, 61]], 'the carrier carries on');
  // a leave of someone else changes nothing
  g.step([[L.EV_LEAVE, 2]]);
  assert.deepEqual([skull(g).carrier, skull(g).held], [1, [0, 62]]);
  // the carrier leaves; the joiner takes it and finishes blue's second
  g.step([[L.EV_LEAVE, 1]]);
  assert.deepEqual([skull(g).state, skull(g).held], [L.OB_DROPPED, [0, 62]]);
  take(g, 3);
  steps(g, L.OB_POINT - 62 - 1);
  assert.deepEqual(scores(g), [0, 0]);
  g.step();
  assert.deepEqual([scores(g), skull(g).held, points(g, 3)], [[0, 1], [0, 0], 1]);
  // the slot that left comes back with nothing of its own, on the side with fewer
  g.step([[L.EV_JOIN, 1]]);
  assert.deepEqual([points(g, 1), team(g, 1), carry(g, 1), skull(g).carrier], [0, 0, false, 3]);
});

test('Oddball: over on the tick a side reaches OB_TARGET; at the clock the side ahead, or a draw; places by the side, then MR_POINTS, then kills; the next match starts from zero', async () => {
  const g = await room(4); // 0 and 2 red, 1 and 3 blue
  take(g, 1);
  g.dv.setUint32(L.AH_SCORE + 4, L.OB_TARGET - 1, true);
  g.dv.setUint32(L.AH_SCORE, 60, true);
  setHeld(g, 1, L.OB_POINT - 2);
  [5, 9, 7, 2].forEach((n, p) => setPoints(g, p, n));
  [9, 0, 1, 4].forEach((k, p) => g.dv.setUint16(rec(p) + L.A_KILLS, k, true));
  g.step();
  assert.equal(g.v.hole().state, L.H_PLAY, 'a tick short');
  let from = g.v.fxCount();
  g.step();
  assert.deepEqual([g.v.hole().state, scores(g), u32(g, L.AH_TEAMWIN)], [L.H_OVER, [60, L.OB_TARGET], 2], 'over on its tick, blue\'s');
  assert.deepEqual(fxs(g.v, L.FX_MODE, L.MX_TEAMWIN, from).map((f) => f.shot), [2]);
  assert.deepEqual([0, 1, 2, 3].map((p) => points(g, p)), [5, 10, 7, 2]);
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.fighter(p).place), [4, 1, 3, 2], 'blue first (1 then 3), then red by points');
  // over, nothing counts
  steps(g, 300);
  assert.deepEqual([scores(g), skull(g).held], [[60, L.OB_TARGET], [0, 0]]);
  // the next match: the skull at its spot, nobody carrying, the counts and scores 0
  nextPlay(g);
  let s = skull(g);
  assert.deepEqual([scores(g), u32(g, L.AH_TEAMWIN), u32(g, L.AH_TARGET), s.state, s.pos, s.held], [[0, 0], 0, L.OB_TARGET, L.OB_HOME, s.spot, [0, 0]]);
  assert.ok([0, 1, 2, 3].every((p) => !carry(g, p) && points(g, p) === 0));
  // the clock: red ahead by one; red's 0 and 2 level on points, 2 with more kills
  const r = await room(4);
  take(r, 3);
  r.dv.setUint32(L.AH_SCORE, 40, true); r.dv.setUint32(L.AH_SCORE + 4, 39, true);
  [3, 30, 3, 0].forEach((n, p) => setPoints(r, p, n));
  [1, 0, 2, 9].forEach((k, p) => r.dv.setUint16(rec(p) + L.A_KILLS, k, true));
  from = r.v.fxCount();
  endMatch(r);
  assert.deepEqual([r.v.hole().state, u32(r, L.AH_TEAMWIN)], [L.H_OVER, 1]);
  assert.deepEqual(fxs(r.v, L.FX_MODE, L.MX_TEAMWIN, from).map((f) => f.shot), [1]);
  assert.deepEqual([0, 1, 2, 3].map((p) => r.v.fighter(p).place), [2, 3, 1, 4]);
  // a draw: by points, then kills
  const d = await room(4);
  d.dv.setUint32(L.AH_SCORE, 20, true); d.dv.setUint32(L.AH_SCORE + 4, 20, true);
  [3, 30, 3, 0].forEach((n, p) => setPoints(d, p, n));
  [1, 0, 2, 9].forEach((k, p) => d.dv.setUint16(rec(p) + L.A_KILLS, k, true));
  endMatch(d);
  assert.equal(u32(d, L.AH_TEAMWIN), 3);
  assert.deepEqual([0, 1, 2, 3].map((p) => d.v.fighter(p).place), [3, 1, 2, 4]);
});

test('Oddball: a carrier\'s runs, jumps, turns, clicks, swings and frames predicted bit for bit from every tick, the skull following it on the confirmed world', async () => {
  const g = await room(3);
  take(g, 0);
  put(g, 0, 470, 500); put(g, 1, 470, 540); put(g, 2, 600, 450);
  const inputs = [];
  for (let k = 0; k < 400; k++) {
    inputs.push(arenaWord({ yaw: 30 * k, pitch: 480, move: k < 150 ? 1 : k < 300 ? 9 : 2, jump: k % 60 === 10 ? 1 : 0, shot: (k >> 4) & 3, melee: (k >> 6) & 1,
      gren: (k >> 5) & 1, slot: k >= 200 && k < 260 ? 1 : 0, serial: (arenaFrame({ lag: 4, reload: k > 100 }) >> ((g.v.tick + k) & 7)) & 1 }));
  }
  const shots = g.v.fighter(0).shots;
  const held = skull(g).held[0];
  let followed = 0;
  assert.ok(predicted(g, 0, inputs, () => { if (skull(g).pos.every((c, i) => c === g.v.fighter(0).pos[i])) followed++; }) > 400);
  const f = g.v.fighter(0);
  assert.ok(f.shots - shots >= 4, `${f.shots - shots} swings`);
  assert.deepEqual([followed, carry(g, 0), f.grens, f.mag[0]], [400, true, 2, L.ARMS[L.W_AR].mag]);
  assert.deepEqual([scores(g)[0] * L.OB_POINT + skull(g).held[0], points(g, 0)], [held + 400, Math.floor((held + 400) / L.OB_POINT)]);
});

test('a Fiesta after an Oddball match: its region exactly a Fiesta\'s (the mode header, the skull, the records, no pads, no sides, nothing carried)', async () => {
  const g = await room(4, { mode: null, park: false });
  assert.equal(g.v.mode().mode, L.M_FIESTA);
  g.dv.setUint32(L.HDR_HOLE, L.ARENA_MODES.indexOf(L.M_ODDBALL) - 1, true);
  endMatch(g);
  untilPlay(g);
  assert.equal(g.v.mode().mode, L.M_ODDBALL);
  // a skull carried, scored for, dropped and taken again
  for (let p = 0; p < 4; p++) park(g, p);
  lay(g, 512, skull(g).spot[1], 512);
  take(g, 2);
  setHeld(g, 0, L.OB_POINT - 1); setHeld(g, 1, 77);
  g.step();
  suicide(g, 2);
  take(g, 3);
  assert.deepEqual([scores(g), skull(g).held, points(g, 2), carry(g, 3)], [[1, 0], [0, 77], 1, true]);
  assert.ok(g.v.pads().length === MAP.pads.length && sides(g, [0, 1, 2, 3]).includes(1));
  g.dv.setUint32(L.HDR_HOLE, L.ARENA_MODES.length - 1, true); // the next match is the rotation's Fiesta
  endMatch(g);
  assert.equal(u32(g, L.AH_TEAMWIN), 1);
  untilPlay(g);
  assert.equal(g.v.mode().mode, L.M_FIESTA);
  const zero = (a, b) => g.sim.u8.slice(a, b).every((x) => x === 0);
  assert.ok(zero(L.AH_MODE, L.AH_END), 'the header');
  assert.ok(zero(L.AO, L.AO + L.AO_SIZE), 'the skull');
  assert.ok(zero(L.MODE_REC, L.MODE_REC + L.NPLAYER * L.MR_SIZE), 'the records');
  if (L.FIESTA) assert.ok(zero(L.PAD, L.PAD + L.NPAD * L.PAD_SIZE), 'the pads');
  for (let p = 0; p < L.NPLAYER; p++) assert.equal(fl(g, p) & (L.PF_BLUE | L.PF_CARRY), 0, `P${p}`);
  // and stays so through play, someone standing on the skull's spot
  put(g, 0, 512, 512);
  for (let i = 0; i < 200; i++) g.step();
  assert.ok(zero(L.AH_MODE, L.AH_END) && zero(L.AO, L.AO + L.AO_SIZE));
  assert.equal(fl(g, 0) & L.PF_CARRY, 0);
});

test('Oddball with 8 and 16 AI fighters: no trap on the debug build, the same hash on every tick on 1 and 4 threads', async (t) => {
  const [debug, bytes] = [arenaBytes(true), arenaBytes()];
  for (const [bots, ticks] of [[8, 20000], [16, 6000]]) {
    const seen = { takes: 0, drops: 0, resets: 0 };
    let last = null, k0 = 0;
    const { log } = await playArena({ bytes: debug, seed: forcedSeed(L.M_ODDBALL), bots, ticks, leaveAt: 1000,
      onTick: (tick, v) => {
        for (let k = Math.max(k0, v.fxCount() - L.FX_MAX); k < v.fxCount(); k++) {
          const f = v.fx(k);
          if (f.kind !== L.FX_MODE) continue;
          if (f.size === L.OB_MX_TAKE) seen.takes++;
          if (f.size === L.OB_MX_DROP) seen.drops++;
          if (f.size === L.OB_MX_RESET) seen.resets++;
        }
        k0 = v.fxCount();
        last = { score: [v.dv.getUint32(L.AH_SCORE, true), v.dv.getUint32(L.AH_SCORE + 4, true)], n: [v.dv.getUint32(L.AH_TEAMN, true), v.dv.getUint32(L.AH_TEAMN + 4, true)] };
      } });
    t.diagnostic(`${bots} fighters, ${ticks} ticks: ${JSON.stringify(seen)}, scores ${last.score}`);
    assert.deepEqual(last.n, [bots / 2, bots / 2]);
    const parsed = parseLog(log);
    const a = await replay({ bytes, log: parsed, ticks, threads: 1, tag: `ob${bots}x1` });
    const b = await replay({ bytes, log: parsed, ticks, threads: 4, tag: `ob${bots}x4`, startWorkers });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
  }
});
