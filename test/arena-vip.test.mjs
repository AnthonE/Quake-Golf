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
import vp, { vipsOf, says, CROWN } from '../client/am/vip.mjs';
import { SIDE_C } from '../client/am/sides.mjs';
import { C } from '../client/font.mjs';

// VIP (src/am/vip.wat): a VIP each side, drawn by the PRNG, an overshield;
// the other side's VIP killed is a point, any other kill nothing. Helpers as
// test/arena-oddball.test.mjs has them; the VIPs read straight from AO (its
// fields in src/am/vip.mjs).

// A room on the debug build playing VIP (or `mode`; null plays the
// rotation): n fighters in, each parked during the countdown on open ground
// mid-field, stepped to the first tick of play and one more.
let debugModule = null;
async function room(n = 4, { seed = 7, mode = L.M_VIP, park: parked = true, play = true } = {}) {
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
  if (!play) return g;
  while (v.hole().state !== L.H_PLAY) step();
  step();
  return g;
}

const rec = (p) => L.PLAYERS + p * L.PSIZE;
const mr = (p) => L.MODE_REC + p * L.MR_SIZE;
const fl = (g, p) => g.sim.u8[rec(p) + L.P_FL];
const team = (g, p) => (fl(g, p) & L.PF_BLUE ? 1 : 0);
const u32 = (g, a) => g.dv.getUint32(a, true);
const scores = (g) => [u32(g, L.AH_SCORE), u32(g, L.AH_SCORE + 4)];
const points = (g, p) => g.dv.getUint16(mr(p) + L.MR_POINTS, true);
const turns = (g, p) => g.dv.getUint16(mr(p) + L.MR_AUX, true);
const setPoints = (g, p, n) => g.dv.setUint16(mr(p) + L.MR_POINTS, n, true);
const sh = (g, p) => g.sim.u8[rec(p) + L.A_SH];
const hp = (g, p) => g.sim.u8[rec(p) + L.A_HP];
const dead = (g, p) => g.v.fighter(p).dead;
const MAP = compileMap();

// Both VIPs as AO holds them: [red's, blue's] slots (-1 none), lasts and ticks left.
const ao = (g, o, k) => g.dv.getUint16(L.AO + o + 2 * k, true);
const setAo = (g, o, k, n) => g.dv.setUint16(L.AO + o + 2 * k, n, true);
const vips = (g) => [ao(g, AC.VP_VIP, 0) - 1, ao(g, AC.VP_VIP, 1) - 1];
const lasts = (g) => [ao(g, AC.VP_LAST, 0) - 1, ao(g, AC.VP_LAST, 1) - 1];
const lefts = (g) => [ao(g, AC.VP_LEFT, 0), ao(g, AC.VP_LEFT, 1)];
// AO's bytes the VIPs take: VP_VIP, VP_LAST and VP_LEFT, two u16s each.
const VIPS = 12;
// Slot p made its side's VIP by hand (a turn in its record, as a draw leaves it).
function crown(g, p) {
  setAo(g, AC.VP_VIP, team(g, p), p + 1);
  if (!turns(g, p)) g.dv.setUint16(mr(p) + L.MR_AUX, 1, true);
}

function put(g, p, x, z, y = g.v.height(x, z)) {
  g.dv.setFloat32(rec(p) + L.P_PX, x, true);
  g.dv.setFloat32(rec(p) + L.P_PY, y, true);
  g.dv.setFloat32(rec(p) + L.P_PZ, z, true);
  for (const o of [L.P_VX, L.P_VY, L.P_VZ]) g.dv.setFloat32(rec(p) + o, 0, true);
}
// Slot p's place on open ground mid-field, 3 m from the next.
const park = (g, p) => put(g, p, 491 + 3 * (p % 8), 528 + 3 * (p >> 3));

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

// p's melee at q on open ground, q 2 m off facing p and pressing nothing (a
// sword's kills; a rifle's butt takes MELEE_DMG).
function melee(g, p, q) {
  put(g, p, 500, 510); put(g, q, 502, 510);
  const w = still(g, p);
  g.step([[L.EV_INPUT, q, arenaWord({ yaw: 8192, ...still(g, q) })], [L.EV_INPUT, p, at(g, p, q, 1.0, { ...w, melee: w.melee ^ 1 })]]);
}
// p kills q with a sword, its cooldown waited out first, everyone else parked out of reach.
function slay(g, p, q) {
  for (let r = 0; r < g.n; r++) if (r !== p && r !== q) park(g, r);
  loadout(g, p, L.W_SWORD);
  g.dv.setUint16(rec(p) + L.A_COOL, 0, true);
  melee(g, p, q);
  assert.ok(dead(g, q), `P${p} kills P${q}`);
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
// VIP news from `from` on: [what, owner, shot]
const news = (g, from) => fxs(g.v, L.FX_MODE, undefined, from).filter((f) => f.size >= AC.VP_MX_DRAW && f.size <= AC.VP_MX_GONE).map((f) => [f.size, f.owner, f.shot]);
const endMatch = (g) => { g.dv.setUint32(L.HDR_UNTIL, g.v.tick + 1, true); for (let i = 0; i < 4; i++) g.step(); };
const steps = (g, n) => { for (let i = 0; i < n; i++) g.step(); };

// A frag of p's about to go off at (x, z), on the ground or at height y.
function frag(g, p, x, z, y = g.v.height(x, z)) {
  const j = L.PROJ;
  g.dv.setFloat32(j + L.J_PX, x, true); g.dv.setFloat32(j + L.J_PY, y + 0.12, true); g.dv.setFloat32(j + L.J_PZ, z, true);
  for (const o of [L.J_VX, L.J_VY, L.J_VZ]) g.dv.setFloat32(j + o, 0, true);
  g.dv.setUint16(j + L.J_AGE, L.A_FUSE - 1, true); g.sim.u8[j + L.J_KIND] = L.K_GRENADE; g.sim.u8[j + L.J_OWNER] = p;
}
// q dies by a frag of p's (p == q: its own) at its feet, its shields gone first.
function fragged(g, p, q) {
  const pos = g.v.fighter(q).pos;
  frag(g, p, pos[0], pos[2], pos[1]);
  g.dv.setUint8(rec(q) + L.A_SH, 0); g.dv.setUint8(rec(q) + L.A_HP, 10);
  g.step();
  assert.ok(dead(g, q), `P${q} by a frag of P${p}'s`);
}

// The sim's PRNG (src/util.wat's $rand): xorshift32.
const xorshift = (x) => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x >>> 0; };

// Predicts slot p through `inputs` from every tick (1 ahead, and 6 and 30 every
// 7th) and compares each with the confirmed world when it gets there.
function predicted(g, p, inputs) {
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
  }
  return compared;
}

test('VIP: nothing of it before play; as play starts red\'s VIP drawn, then blue\'s, from each side\'s fighters by the PRNG, an overshield, full health, a turn counted, news; no mode bit; the target VP_TARGET', async () => {
  const g = await room(6, { play: false }); // 0 2 4 red, 1 3 5 blue
  const zero = () => g.sim.u8.slice(L.AO, L.AO + L.AO_SIZE).every((x) => x === 0) && [0, 1, 2, 3, 4, 5].every((p) => turns(g, p) === 0);
  while (g.v.hole().state !== L.H_PLAY) { assert.ok(zero(), 'the countdown'); g.step(); }
  // the tick play starts: the start hook alone (the tick hook's first run is the next tick)
  assert.equal(g.v.tick - 1, g.v.hole().start);
  const [r, b] = vips(g);
  assert.ok([0, 2, 4].includes(r) && [1, 3, 5].includes(b), `red ${r}, blue ${b}`);
  assert.deepEqual([sh(g, r), hp(g, r), sh(g, b), hp(g, b), turns(g, r), turns(g, b)], [L.OVERSHIELD, 100, L.OVERSHIELD, 100, 1, 1]);
  assert.ok([0, 1, 2, 3, 4, 5].filter((p) => p !== r && p !== b).every((p) => sh(g, p) === 100 && turns(g, p) === 0));
  assert.deepEqual([lasts(g), lefts(g), u32(g, L.AH_TARGET), scores(g)], [[-1, -1], [0, 0], AC.VP_TARGET, [0, 0]]);
  assert.deepEqual(news(g, 0), [[AC.VP_MX_DRAW, r, 0], [AC.VP_MX_DRAW, b, 1]], 'red\'s first');
  const draws = fxs(g.v, L.FX_MODE, AC.VP_MX_DRAW);
  assert.deepEqual(draws.map((f) => f.pos), [g.v.fighter(r).pos, g.v.fighter(b).pos], 'at their feet');
  // a VIP's record has no bit of it: its flags as anyone's on its side
  assert.equal(fl(g, r), fl(g, r === 0 ? 2 : 0));
  // the PRNG's: over seeds, every fighter of a side comes up
  const seen = [new Set(), new Set()];
  for (let s = 1; s <= 24; s++) {
    const h = await room(6, { seed: s, park: false });
    vips(h).forEach((p, k) => seen[k].add(p));
  }
  assert.deepEqual([[...seen[0]].sort(), [...seen[1]].sort()], [[0, 2, 4], [1, 3, 5]]);
  // a side with nobody on it has no VIP, and waits for one
  const one = await room(1);
  assert.deepEqual([vips(one), lefts(one)], [[0, -1], [0, 0]]);
});

test('VIP: its overshield takes hits and comes back only to 100, as the juggernaut\'s; a VIP\'s runs, jumps, swings and frames predicted bit for bit from every tick', async () => {
  const g = await room(4); // 0 2 red, 1 3 blue
  const [r, b] = vips(g);
  const foe = r === 0 || r === 2 ? (b === 1 ? 3 : 1) : -1;
  assert.ok(foe >= 0);
  steps(g, L.COOL_TICKS);
  // a butt: MELEE_DMG off the overshield; above 100 it stays where it is
  melee(g, foe, r);
  assert.deepEqual([sh(g, r), hp(g, r)], [L.OVERSHIELD - L.MELEE_DMG, 100]);
  steps(g, L.SHIELD_DELAY + 300);
  assert.equal(sh(g, r), L.OVERSHIELD - L.MELEE_DMG, 'no recharge over 100');
  // another under 100: it comes back to 100 and no more
  melee(g, foe, r);
  assert.equal(sh(g, r), L.OVERSHIELD - 2 * L.MELEE_DMG);
  steps(g, L.SHIELD_DELAY + 300);
  assert.equal(sh(g, r), 100);
  steps(g, 300);
  assert.equal(sh(g, r), 100);
  // the prediction: a VIP running, jumping, turning, shooting, swinging, framing
  put(g, b, 470, 500); put(g, foe === 1 ? 3 : 1, 600, 450);
  const inputs = [];
  for (let k = 0; k < 400; k++) {
    inputs.push(arenaWord({ yaw: 30 * k, pitch: 480, move: k < 150 ? 1 : k < 300 ? 9 : 2, jump: k % 60 === 10 ? 1 : 0, shot: (k >> 4) & 3, melee: (k >> 6) & 1,
      gren: (k >> 5) & 1, slot: k >= 200 && k < 260 ? 1 : 0, serial: (arenaFrame({ lag: 4, reload: k > 100 }) >> ((g.v.tick + k) & 7)) & 1 }));
  }
  assert.ok(predicted(g, b, inputs) > 400);
  assert.deepEqual([vips(g)[1], dead(g, b)], [b, false], 'still the VIP');
});

test('VIP: the other side\'s VIP killed is a point for the killer\'s side and the killer; any other kill nothing; by its own hand, a point for the other side; a killer gone since its throw scores its side alone; news at the VIP', async () => {
  const g = await room(6); // 0 2 4 red, 1 3 5 blue
  for (const p of [0, 1, 2, 3, 4, 5]) g.dv.setUint16(mr(p) + L.MR_AUX, 0, true);
  g.sim.u8.fill(0, L.AO, L.AO + L.AO_SIZE);
  crown(g, 2); crown(g, 3);
  // kills of anyone else score nothing, nor change the VIPs
  slay(g, 1, 0);
  slay(g, 2, 5);
  assert.deepEqual([scores(g), vips(g), [1, 2].map((p) => points(g, p))], [[0, 0], [2, 3], [0, 0]]);
  // blue 1 kills red's VIP 2: blue's point and 1's; red has no VIP, VP_REDRAW to its next (the tick's own counted)
  steps(g, L.COOL_TICKS);
  let from = g.v.fxCount();
  slay(g, 1, 2);
  assert.deepEqual([scores(g), points(g, 1), vips(g), lasts(g), lefts(g)], [[0, 1], 1, [-1, 3], [2, -1], [AC.VP_REDRAW - 1, 0]]);
  const at = g.v.fighter(2).pos;
  const k = fxs(g.v, L.FX_MODE, AC.VP_MX_KILL, from);
  assert.deepEqual([news(g, from), k[0].pos], [[[AC.VP_MX_KILL, 1, 2]], at], 'owner the killer, shot the VIP, at its feet');
  // a dead VIP's body killed again is nothing (it isn't hit), and its record keeps the turn
  assert.equal(turns(g, 2), 1);
  // blue's VIP 3 by its own frag: red's point, nobody's own; shot + 256 for blue's
  from = g.v.fxCount();
  fragged(g, 3, 3);
  assert.deepEqual([scores(g), [0, 2, 4].map((p) => points(g, p)), points(g, 3), vips(g)], [[1, 1], [0, 0, 0], 0, [-1, -1]]);
  assert.deepEqual(news(g, from), [[AC.VP_MX_KILL, 3, 3 + 256]]);
  // red 4 throws, then leaves; its frag kills blue's VIP 5: red's point, nobody's own
  while (dead(g, 5)) g.step();
  crown(g, 5);
  put(g, 5, 470, 500);
  g.step([[L.EV_LEAVE, 4]]);
  from = g.v.fxCount();
  fragged(g, 4, 5);
  assert.deepEqual([scores(g), points(g, 4)], [[2, 1], 0]);
  assert.deepEqual(news(g, from), [[AC.VP_MX_KILL, 4, 5 + 256]]);
  // a VIP kills the other VIP: a point like anyone's
  const h = await room(4);
  const [r, b] = vips(h);
  steps(h, L.COOL_TICKS);
  slay(h, r, b);
  assert.deepEqual([scores(h), points(h, r), vips(h)], [[1, 0], 1, [r, -1]]);
});

test('VIP: VP_REDRAW ticks after its VIP dies (counting that one) its side draws another by the PRNG, passing over the dead and the last VIP; the last again if it is the only one alive; nobody alive, the first to come back', async () => {
  const g = await room(6); // 0 2 4 red, 1 3 5 blue
  for (const p of [0, 1, 2, 3, 4, 5]) g.dv.setUint16(mr(p) + L.MR_AUX, 0, true);
  g.sim.u8.fill(0, L.AO, L.AO + L.AO_SIZE);
  crown(g, 0); crown(g, 1);
  steps(g, L.COOL_TICKS);
  // red's VIP 0 dies; 2 dies too, a tick later: 4 is the only one to draw
  slay(g, 1, 0);
  assert.deepEqual([vips(g)[0], lefts(g)[0]], [-1, AC.VP_REDRAW - 1], 'its tick counted');
  g.dv.setUint16(rec(1) + L.A_COOL, 0, true);
  slay(g, 3, 2);
  park(g, 2);
  steps(g, AC.VP_REDRAW - 3);
  assert.deepEqual([vips(g)[0], lefts(g)[0], dead(g, 0)], [-1, 1, true], 'a tick to go');
  let from = g.v.fxCount();
  g.step();
  assert.deepEqual([vips(g)[0], lefts(g)[0], dead(g, 0), dead(g, 2)], [4, 0, false, true], 'VP_REDRAW ticks on: 4, 0 back on that tick and passed over');
  assert.deepEqual([sh(g, 4), hp(g, 4), turns(g, 4), lasts(g)[0], news(g, from)], [L.OVERSHIELD, 100, 1, 0, [[AC.VP_MX_DRAW, 4, 0]]]);
  // the draw is $rand % those that could be, in slot order: red's 4 dies (kept dead) and 0 and 2 are both back
  while (dead(g, 2)) g.step();
  for (const p of [0, 2]) park(g, p);
  g.dv.setUint16(rec(3) + L.A_COOL, 0, true);
  slay(g, 3, 4);
  g.dv.setUint16(rec(4) + L.A_RESPAWN, 3000, true);
  steps(g, AC.VP_REDRAW - 2);
  assert.deepEqual([vips(g)[0], lefts(g)[0]], [-1, 1]);
  const picks = new Set();
  for (const seed of [1, 2, 3, 0x9e3779b9, 12345, 777]) {
    // (each from the same state, a tick before the draw)
    const was = g.sim.u8.slice(L.AO, L.AO + VIPS), shields = [sh(g, 0), sh(g, 2)];
    g.dv.setUint32(L.HDR_RNG, seed, true);
    g.step();
    assert.equal(vips(g)[0], [0, 2][xorshift(seed) % 2], `seed ${seed}`);
    picks.add(vips(g)[0]);
    g.sim.u8.set(was, L.AO);
    [0, 2].forEach((p, k) => g.dv.setUint8(rec(p) + L.A_SH, shields[k]));
  }
  assert.deepEqual([...picks].sort(), [0, 2]);
  // the last VIP again if it is the only one alive on its side: two a side
  const h = await room(4); // 0 2 red
  for (const p of [0, 1, 2, 3]) h.dv.setUint16(mr(p) + L.MR_AUX, 0, true);
  h.sim.u8.fill(0, L.AO, L.AO + L.AO_SIZE);
  crown(h, 0); crown(h, 1);
  steps(h, L.COOL_TICKS);
  slay(h, 1, 0);
  steps(h, 100);
  h.dv.setUint16(rec(1) + L.A_COOL, 0, true);
  slay(h, 1, 2);
  steps(h, AC.VP_REDRAW - 103);
  assert.deepEqual([vips(h)[0], lefts(h)[0], dead(h, 0), dead(h, 2)], [-1, 1, true, true]);
  h.step();
  assert.deepEqual([vips(h)[0], dead(h, 0), dead(h, 2), turns(h, 0)], [0, false, true, 2], '0 again on the tick it is back, its second turn');
  // nobody alive on the side at its time: nobody, VP_LEFT 0, until the first is back, on that tick
  while (dead(h, 2)) h.step();
  h.dv.setUint16(rec(1) + L.A_COOL, 0, true);
  slay(h, 1, 0);
  steps(h, AC.VP_REDRAW - 2);
  h.dv.setUint8(rec(2) + L.P_FL, fl(h, 2) | L.PF_DEAD); h.dv.setUint16(rec(2) + L.A_RESPAWN, 50, true);
  h.dv.setUint16(rec(0) + L.A_RESPAWN, 40, true);
  from = h.v.fxCount();
  h.step();
  assert.deepEqual([vips(h)[0], lefts(h)[0], news(h, from)], [-1, 0, []], 'nobody to draw');
  steps(h, 38);
  assert.deepEqual([vips(h)[0], dead(h, 0)], [-1, true]);
  h.step();
  assert.deepEqual([vips(h)[0], dead(h, 0), sh(h, 0), dead(h, 2)], [0, false, L.OVERSHIELD, true], 'the tick 0 is back');
});

test('VIP: a VIP that leaves, whose slot is taken again on one tick, or that dies unseen is gone, no score, news; VP_REDRAW to the next; a join to a side with no VIP is drawn at once, and a join elsewhere changes nothing', async () => {
  const g = await room(5); // 0 2 4 red, 1 3 blue
  for (const p of [0, 1, 2, 3, 4]) g.dv.setUint16(mr(p) + L.MR_AUX, 0, true);
  g.sim.u8.fill(0, L.AO, L.AO + L.AO_SIZE);
  crown(g, 0); crown(g, 1);
  // red's VIP 0 leaves
  let from = g.v.fxCount();
  g.step([[L.EV_LEAVE, 0]]);
  assert.deepEqual([vips(g), lasts(g), lefts(g), scores(g), news(g, from)], [[-1, 1], [0, -1], [AC.VP_REDRAW - 1, 0], [0, 0], [[AC.VP_MX_GONE, 0, 0]]]);
  steps(g, AC.VP_REDRAW - 2);
  assert.deepEqual([vips(g)[0], lefts(g)[0]], [-1, 1]);
  g.step();
  assert.ok([2, 4].includes(vips(g)[0]), 'VP_REDRAW ticks on, counting the one it left on');
  // blue's VIP 1 leaves and its slot is joined again on the same tick (blue, the side with fewer): gone, the joiner nobody
  from = g.v.fxCount();
  g.step([[L.EV_LEAVE, 1], [L.EV_JOIN, 1]]);
  assert.deepEqual([vips(g)[1], team(g, 1), turns(g, 1), news(g, from)], [-1, 1, 0, [[AC.VP_MX_GONE, 1, 1]]]);
  steps(g, AC.VP_REDRAW);
  const b = vips(g)[1];
  assert.equal(b, 3, 'not the slot that left, though it is back');
  // dead with no kill (by hand): gone
  const r = vips(g)[0];
  g.dv.setUint8(rec(r) + L.P_FL, fl(g, r) | L.PF_DEAD); g.dv.setUint16(rec(r) + L.A_RESPAWN, 500, true);
  from = g.v.fxCount();
  g.step();
  assert.deepEqual([vips(g)[0], scores(g), news(g, from)], [-1, [0, 0], [[AC.VP_MX_GONE, r, 0]]]);
  // a stale VIP (its slot rejoined, its record clear) killed on the tick: nothing scores, the tick hook finds it gone
  steps(g, L.COOL_TICKS);
  g.dv.setUint16(mr(b) + L.MR_AUX, 0, true);
  from = g.v.fxCount();
  const k = [2, 4].find((p) => p !== r);
  slay(g, k, b);
  assert.deepEqual([scores(g), points(g, k), news(g, from)], [[0, 0], 0, [[AC.VP_MX_GONE, b, 1]]]);
  // a side with nobody: a join to it is its VIP on the tick it joins
  const one = await room(1);
  from = one.v.fxCount();
  one.step([[L.EV_JOIN, 1]]);
  assert.deepEqual([team(one, 1), vips(one), sh(one, 1), news(one, from)], [1, [0, 1], L.OVERSHIELD, [[AC.VP_MX_DRAW, 1, 1]]]);
  // a join to a side that has its VIP changes nothing; nor a leave of anyone but a VIP
  const was = one.sim.u8.slice(L.AO, L.AO + VIPS);
  one.step([[L.EV_JOIN, 2]]);
  one.step([[L.EV_LEAVE, 2]]);
  assert.deepEqual(one.sim.u8.slice(L.AO, L.AO + VIPS), was);
});

test('VIP: both VIPs down on one tick (a VIP\'s frag at its feet): a point each, in slot order, the thrower\'s own for the other; both at the target on one tick, a draw', async () => {
  for (const seed of [7, 9]) {
    const g = await room(4, { seed }); // 0 2 red, 1 3 blue
    const both = () => {
      const [r, b] = vips(g);
      put(g, r, 470, 500); put(g, b, 470.8, 500);
      for (const p of [r, b]) { g.dv.setUint8(rec(p) + L.A_SH, 0); g.dv.setUint8(rec(p) + L.A_HP, 10); }
      frag(g, r, 470, 500);
      const from = g.v.fxCount();
      g.step();
      assert.ok(dead(g, r) && dead(g, b), 'both down');
      return { r, b, said: news(g, from) };
    };
    const { r, b, said } = both();
    assert.deepEqual([scores(g), points(g, r), points(g, b), vips(g)], [[1, 1], 1, 0, [-1, -1]]);
    const kill = (q) => [AC.VP_MX_KILL, r, q + (q === b ? 256 : 0)];
    assert.deepEqual(said, r < b ? [kill(r), kill(b)] : [kill(b), kill(r)], 'in slot order');
    // both drawn again; both at the target on one tick: a draw, placed by VIP kills then kills
    while (vips(g).some((p) => p < 0)) g.step();
    g.dv.setUint32(L.AH_SCORE, AC.VP_TARGET - 1, true); g.dv.setUint32(L.AH_SCORE + 4, AC.VP_TARGET - 1, true);
    const second = both();
    assert.deepEqual([g.v.hole().state, scores(g), u32(g, L.AH_TEAMWIN)], [L.H_OVER, [AC.VP_TARGET, AC.VP_TARGET], 3], `seed ${seed}: a draw`);
    const pts = [0, 1, 2, 3].map((p) => points(g, p));
    assert.equal(pts.reduce((x, y) => x + y), 2, 'two VIP kills, both the throwers\'');
    assert.equal(points(g, second.r), second.r === r ? 2 : 1);
    const top = [0, 1, 2, 3].filter((p) => pts[p] === Math.max(...pts));
    assert.ok(top.every((p) => g.v.fighter(p).place === 1), 'the most VIP kills first, whichever side');
  }
});

test('VIP: over on the tick a side reaches VP_TARGET; at the clock the side ahead, or a draw; places by the side, then VIP kills, then kills; the next match draws anew from zero', async () => {
  const g = await room(4); // 0 2 red, 1 3 blue
  const [r, b] = vips(g);
  const [rf] = [0, 2].filter((p) => p !== r);
  g.dv.setUint32(L.AH_SCORE, AC.VP_TARGET - 1, true);
  g.dv.setUint32(L.AH_SCORE + 4, 4, true);
  [3, 5, 1, 2].forEach((n, p) => setPoints(g, p, n));
  [9, 0, 4, 4].forEach((k, p) => g.dv.setUint16(rec(p) + L.A_KILLS, k, true));
  steps(g, L.COOL_TICKS);
  // a kill of someone else: still playing
  slay(g, rf, [1, 3].find((p) => p !== b));
  assert.equal(g.v.hole().state, L.H_PLAY);
  const from = g.v.fxCount();
  g.dv.setUint16(rec(rf) + L.A_COOL, 0, true);
  slay(g, rf, b);
  assert.deepEqual([g.v.hole().state, scores(g), u32(g, L.AH_TEAMWIN)], [L.H_OVER, [AC.VP_TARGET, 4], 1], 'over on its tick, red\'s');
  assert.deepEqual(fxs(g.v, L.FX_MODE, L.MX_TEAMWIN, from).map((f) => f.shot), [1]);
  const pts = [3, 5, 1, 2];
  pts[rf]++;
  assert.deepEqual([0, 1, 2, 3].map((p) => points(g, p)), pts);
  const want = (p) => [0, 2].sort((x, y) => pts[y] - pts[x])[0] === p;
  assert.deepEqual([0, 2].map((p) => g.v.fighter(p).place), [want(0) ? 1 : 2, want(2) ? 1 : 2], 'red first, by VIP kills');
  assert.deepEqual([1, 3].map((p) => g.v.fighter(p).place), [3, 4], 'then blue: 1 more VIP kills than 3');
  // over, nothing counts
  const was = g.sim.u8.slice(L.AO, L.AO + VIPS);
  steps(g, 400);
  assert.deepEqual([scores(g), g.sim.u8.slice(L.AO, L.AO + VIPS)], [[AC.VP_TARGET, 4], was]);
  // the next match: AO and the records 0 through its countdown, VIPs drawn anew as it starts
  while (g.v.hole().state !== L.H_COUNT) g.step();
  assert.ok(g.sim.u8.slice(L.AO, L.AO + L.AO_SIZE).every((x) => x === 0) && [0, 1, 2, 3].every((p) => turns(g, p) === 0 && points(g, p) === 0 && sh(g, p) === 100));
  while (g.v.hole().state !== L.H_PLAY) g.step();
  assert.deepEqual([scores(g), u32(g, L.AH_TEAMWIN), u32(g, L.AH_TARGET)], [[0, 0], 0, AC.VP_TARGET]);
  assert.ok(vips(g).every((p) => p >= 0 && turns(g, p) === 1 && sh(g, p) === L.OVERSHIELD));
  // the clock: blue ahead by one
  const c = await room(4);
  c.dv.setUint32(L.AH_SCORE, 3, true); c.dv.setUint32(L.AH_SCORE + 4, 4, true);
  [0, 1, 0, 0].forEach((n, p) => setPoints(c, p, n));
  [1, 0, 2, 9].forEach((k, p) => c.dv.setUint16(rec(p) + L.A_KILLS, k, true));
  endMatch(c);
  assert.deepEqual([c.v.hole().state, u32(c, L.AH_TEAMWIN)], [L.H_OVER, 2]);
  assert.deepEqual([0, 1, 2, 3].map((p) => c.v.fighter(p).place), [4, 1, 3, 2]);
  // a draw: by VIP kills, then kills
  const d = await room(4);
  d.dv.setUint32(L.AH_SCORE, 2, true); d.dv.setUint32(L.AH_SCORE + 4, 2, true);
  [1, 0, 1, 2].forEach((n, p) => setPoints(d, p, n));
  [1, 7, 2, 0].forEach((k, p) => d.dv.setUint16(rec(p) + L.A_KILLS, k, true));
  endMatch(d);
  assert.equal(u32(d, L.AH_TEAMWIN), 3);
  assert.deepEqual([0, 1, 2, 3].map((p) => d.v.fighter(p).place), [3, 4, 2, 1]);
});

test('a Fiesta after a VIP match: its region exactly a Fiesta\'s (the mode header, the VIPs, the records, no pads, no sides, no overshield)', async () => {
  const g = await room(4, { park: false });
  // a VIP killed, another drawn, the next one waiting
  const [r, b] = vips(g);
  steps(g, L.COOL_TICKS);
  slay(g, r, b);
  steps(g, AC.VP_REDRAW + 5);
  assert.ok(vips(g).every((p) => p >= 0) && scores(g)[0] === 1 && points(g, r) === 1);
  assert.ok(g.v.pads().length === MAP.pads.length && [0, 1, 2, 3].some((p) => team(g, p)));
  // the next match a Fiesta (the seed no longer forcing VIP; the rotation's first)
  g.dv.setUint32(L.HDR_SEED, 7, true);
  g.dv.setUint32(L.HDR_HOLE, L.ARENA_MODES.length - 1, true);
  endMatch(g);
  assert.equal(u32(g, L.AH_TEAMWIN), 1);
  while (g.v.hole().state !== L.H_PLAY) g.step();
  g.step();
  assert.equal(g.v.mode().mode, L.M_FIESTA);
  const zero = (a, b) => g.sim.u8.slice(a, b).every((x) => x === 0);
  assert.ok(zero(L.AH_MODE, L.AH_END), 'the header');
  assert.ok(zero(L.AO, L.AO + L.AO_SIZE), 'the VIPs');
  assert.ok(zero(L.MODE_REC, L.MODE_REC + L.NPLAYER * L.MR_SIZE), 'the records');
  if (L.FIESTA) assert.ok(zero(L.PAD, L.PAD + L.NPAD * L.PAD_SIZE), 'the pads');
  for (let p = 0; p < L.NPLAYER; p++) assert.equal(fl(g, p) & (L.PF_BLUE | L.PF_CARRY | L.PF_JUGG | L.PF_ZOMBIE), 0, `P${p}`);
  assert.ok([0, 1, 2, 3].every((p) => sh(g, p) === 100), 'shields as anyone\'s');
  // and stays so through play, kills and all
  slay(g, 0, 1);
  for (let i = 0; i < 500; i++) g.step();
  assert.ok(zero(L.AH_MODE, L.AH_END) && zero(L.AO, L.AO + L.AO_SIZE) && zero(L.MODE_REC, L.MODE_REC + L.NPLAYER * L.MR_SIZE));
});

test('VIP\'s client module: the VIPs as AO has them; crowns over both but the one shown, PROTECT and KILL; HUD lines, news, the board\'s column; the AI fighter\'s goals', async () => {
  const cd = await room(2, { play: false });
  assert.equal(cd.v.hole().state, L.H_COUNT);
  assert.deepEqual(vipsOf(cd.v).map(says), ['NONE YET', 'NONE YET']);
  const lines = (g, slot, tm = g.v.fighter(slot).team) => {
    const out = [];
    vp.hud(g.v, { put: (x, y, s, c) => out.push([y, s, c]), centre() {}, right() {}, rect() {}, rows: 33, C, slot, me: g.v.fighter(slot), team: tm, now: 0, t: 1 });
    return out;
  };
  assert.deepEqual(lines(cd, 0), [[2, 'EACH SIDE DRAWS A VIP', C.WHITE]]);
  assert.equal(vp.goal(cd.v, cd.v.fighter(0), { role: 'attack', rank: 0, view: cd.v, ally: (p, q) => cd.v.ally(p, q), slot: 0, t: 0 }), null);

  const g = await room(6); // 0 2 4 red, 1 3 5 blue
  const v = g.v;
  for (const p of [0, 1, 2, 3, 4, 5]) g.dv.setUint16(mr(p) + L.MR_AUX, 0, true);
  g.sim.u8.fill(0, L.AO, L.AO + L.AO_SIZE);
  crown(g, 2); crown(g, 3);
  assert.deepEqual(vipsOf(v), [{ side: 0, slot: 2, last: -1, left: 0 }, { side: 1, slot: 3, last: -1, left: 0 }]);
  // HUD: your VIP and theirs; YOU ARE THE VIP; a spectator's both
  assert.deepEqual(lines(g, 0), [[2, 'YOUR VIP  P3', C.RED], [3, 'THEIR VIP  P4', C.CYAN]]);
  assert.deepEqual(lines(g, 3), [[2, 'YOU ARE THE VIP', C.WHITE], [3, 'THEIR VIP  P3', C.RED]]);
  assert.deepEqual(lines(g, 0, -1), [[2, 'RED VIP  P3', C.RED], [3, 'BLUE VIP  P4', C.CYAN]]);
  // drawn: a crown over each, at the renderer's place, but not over the one shown; the waypoints to the side shown
  const draw = (slot, shown = slot, dt = 0) => {
    const out = { solid: [], glow: [], beams: [], markers: [], zone: null };
    vp.draw(v, { dt, now: 0, t: 1, slot, shown, me: slot >= 0 ? v.fighter(slot) : null, pme: null, cam: [0, 0, 0], view: v, pview: v }, out);
    return out;
  };
  let out = draw(0);
  const f2 = v.fighter(2), f3 = v.fighter(3);
  assert.deepEqual(out.solid.map((o) => [o.kind, o.pos[0], o.pos[2], o.color.slice(0, 3)]), [[CROWN, f2.pos[0], f2.pos[2], [0.95, 0.22, 0.16]], [CROWN, f3.pos[0], f3.pos[2], [0.22, 0.45, 1]]]);
  assert.ok(out.solid.every((o, k) => Math.abs(o.pos[1] - [f2, f3][k].pos[1] - 2.15) < 0.06));
  assert.deepEqual(out.markers.map((m) => [m.label, m.color, m.kind]), [['PROTECT', C.RED, 'crown'], ['KILL', C.CYAN, 'crown']]);
  assert.deepEqual(draw(5).markers.map((m) => [m.label, m.color]), [['KILL', C.RED], ['PROTECT', C.CYAN]]);
  out = draw(2);
  assert.deepEqual([out.solid.map((o) => o.pos[0]), out.markers.map((m) => m.label)], [[f3.pos[0]], ['KILL']], 'nothing over your own head');
  assert.deepEqual(draw(-1, 3).markers.map((m) => m.label), ['KILL'], 'a spectator watching 3, blue\'s VIP');
  assert.deepEqual(draw(-1, -1).markers, [], 'nobody shown, no waypoints');
  // a crown moves on with its VIP by dt
  g.dv.setFloat32(rec(2) + L.P_VX, 5, true);
  assert.ok(Math.abs(draw(0, 0, 0.1).solid[0].pos[0] - f2.pos[0] - 0.5) < 1e-5);
  g.dv.setFloat32(rec(2) + L.P_VX, 0, true);
  // red's VIP down: NEXT IN, no crown over it
  steps(g, L.COOL_TICKS);
  slay(g, 1, 2);
  assert.deepEqual(lines(g, 0)[0], [2, `YOUR VIP  NEXT IN ${Math.ceil((AC.VP_REDRAW - 1) / 125)}`, C.RED]);
  assert.deepEqual(draw(0).solid.length, 1);
  // news: feed lines in the side's (a kill's, the scoring side's) colour, banners for whoever it concerns
  const feed = [], banners = [], glows = [];
  const nctx = (slot) => ({ slot, me: slot >= 0 ? v.fighter(slot) : null, name: (p) => (p === slot ? 'YOU' : `P${p + 1}`), team: (p) => team(g, p),
    feed: (s, col) => feed.push([s, col]), banner: (s, col) => banners.push([s, col]), glow: (x) => glows.push(x), sound: {}, dist: 10, C, now: 0, view: v });
  const f = (size, owner, shot) => ({ tick: v.tick, kind: L.FX_MODE, owner, shot, pos: [512, 20, 512], size });
  vp.news(f(AC.VP_MX_DRAW, 4, 0), nctx(4));
  vp.news(f(AC.VP_MX_DRAW, 4, 0), nctx(0));
  vp.news(f(AC.VP_MX_DRAW, 4, 0), nctx(1));
  vp.news(f(AC.VP_MX_KILL, 1, 4), nctx(1));
  vp.news(f(AC.VP_MX_KILL, 1, 4), nctx(0));
  vp.news(f(AC.VP_MX_KILL, 1, 4), nctx(5));
  vp.news(f(AC.VP_MX_KILL, 3, 3 + 256), nctx(0));
  vp.news(f(AC.VP_MX_GONE, 3, 1), nctx(-1));
  assert.deepEqual(feed, [['YOU ARE THE RED VIP', C.RED], ['P5 IS THE RED VIP', C.RED], ['P5 IS THE RED VIP', C.RED],
    ['YOU KILLED THE RED VIP', C.CYAN], ['P2 KILLED THE RED VIP', C.CYAN], ['P2 KILLED THE RED VIP', C.CYAN], ['THE BLUE VIP DIED', C.RED], ['THE BLUE VIP LEFT', C.CYAN]]);
  assert.deepEqual(banners, [['YOU ARE THE VIP  STAY ALIVE', C.YELLOW], ['PROTECT P5  YOUR VIP', C.RED], ['YOU KILLED THEIR VIP', C.YELLOW], ['YOUR VIP IS DOWN', C.CYAN],
    ['THEIR VIP IS DOWN  A POINT', C.CYAN], ['THEIR VIP IS DOWN  A POINT', C.RED]]);
  assert.equal(glows.length, 7);
  // the board's column, the gates' state
  setPoints(g, 1, 2);
  assert.deepEqual(vp.cols.map((k) => [k.head, k.get(v.fighter(1))]), [['VIP KILLS', '2']]);
  assert.deepEqual(vp.state(v), { score: [0, 1], target: AC.VP_TARGET, vips: [{ slot: -1, last: 2, left: AC.VP_REDRAW - 1 }, { slot: 3, last: -1, left: 0 }] });

  // goals, on open ground mid-field: red 0 2 4, blue 1 3 5; red's VIP 0, blue's 3
  const h = await room(6);
  const w = h.v;
  for (const p of [0, 1, 2, 3, 4, 5]) h.dv.setUint16(mr(p) + L.MR_AUX, 0, true);
  h.sim.u8.fill(0, L.AO, L.AO + L.AO_SIZE);
  crown(h, 0); crown(h, 3);
  const ctx = (slot, role = 'attack', rank = 0) => ({ role, rank, view: w, ally: (p, q) => w.ally(p, q), slot, t: w.tick });
  const goal = (p, role, rank) => vp.goal(w, w.fighter(p), ctx(p, role, rank));
  const fl0 = MAP.flags[0];
  const ownHalf = (k, x) => (k === 0 ? x < 512 : x > 512);
  assert.ok(ownHalf(0, fl0[0]), 'red\'s flag west');
  // the VIP: a friend on its own half 30 m off and no enemy near: to that friend, holding there looking round
  put(h, 0, 470, 500); put(h, 2, 470, 530); put(h, 4, 560, 500);
  for (const p of [1, 3, 5]) put(h, p, 600 + p, 470);
  h.step();
  assert.deepEqual(goal(0), { pos: w.fighter(2).pos, r: 4, hurry: 0.2, hold: true });
  // within 6 m of it: holds where it is
  put(h, 0, 470, 526);
  h.step();
  assert.deepEqual(goal(0), { pos: w.fighter(0).pos, r: 4, hurry: 0.2, hold: true });
  // no friend on its half (2 across the middle with 4): to its own flag's stand
  put(h, 2, 540, 500);
  h.step();
  const g0 = goal(0);
  assert.deepEqual([g0.pos[0], g0.pos[2], g0.hurry, g0.hold], [fl0[0], fl0[1], 0.2, true]);
  // an enemy inside 40 m: 12 m away from it, toward its own side, inside the map
  put(h, 2, 470, 530); put(h, 1, 495, 526);
  h.step();
  const me0 = w.fighter(0), run = goal(0);
  assert.ok(Math.abs(Math.hypot(run.pos[0] - me0.pos[0], run.pos[2] - me0.pos[2]) - 12) < 1e-3 && run.hold && run.hurry === 0.2);
  assert.ok(Math.hypot(run.pos[0] - 495, run.pos[2] - 526) > Math.hypot(me0.pos[0] - 495, me0.pos[2] - 526) + 6, 'away from blue 1');
  // a defender: 3 m off its VIP round by its rank, holding within 4; well off it, keeping on while it shoots
  const d = goal(4, 'defend', 2);
  assert.ok(Math.abs(Math.hypot(d.pos[0] - me0.pos[0], d.pos[2] - me0.pos[2]) - 3) < 1e-3 && d.r === 4 && d.hold && d.hurry === 0.6);
  put(h, 4, me0.pos[0] + 4, me0.pos[2]);
  h.step();
  assert.equal(goal(4, 'defend', 2).hurry, 0.2);
  // an attacker: at their VIP, at no hurry out of sight (red's base between), hurrying once it sees it
  put(h, 3, 405, 512); put(h, 2, 340, 512);
  h.step();
  assert.deepEqual(goal(2), { pos: w.fighter(3).pos, r: 6, hurry: 0, hold: false });
  put(h, 2, 440, 470);
  h.step();
  assert.deepEqual(goal(2), { pos: w.fighter(3).pos, r: 2, hurry: 0.8, hold: false });
  // a defender with no VIP of its own attacks; with no enemy VIP, the nearest enemy
  setAo(h, AC.VP_VIP, 0, 0);
  assert.deepEqual(goal(4, 'defend', 2).pos, w.fighter(3).pos);
  setAo(h, AC.VP_VIP, 1, 0);
  setAo(h, AC.VP_LEFT, 1, 1000);
  put(h, 5, 450, 470); put(h, 1, 600, 600); put(h, 3, 600, 400);
  h.step();
  assert.deepEqual(goal(2), { pos: w.fighter(5).pos, r: 6, hurry: 0, hold: false });
});

test('VIP: in a full room the last slot, 255, is a VIP like any other: AO holds it, it stays the VIP hurt, with no redraw or heal, and its death scores', async () => {
  const g = await room(L.NPLAYER, { park: false });
  const q = L.NPLAYER - 1, s = team(g, q);
  // every other fighter of its side dead a long while: its side's next draw (due on the next tick) can only be q
  for (let p = 0; p < q; p++) if (team(g, p) === s) { g.sim.u8[rec(p) + L.P_FL] |= L.PF_DEAD; g.dv.setUint16(rec(p) + L.A_RESPAWN, 3000, true); }
  g.dv.setUint16(mr(q) + L.MR_AUX, 0, true);
  setAo(g, AC.VP_VIP, s, 0); setAo(g, AC.VP_LAST, s, 0); setAo(g, AC.VP_LEFT, s, 1);
  let from = g.v.fxCount();
  g.step();
  assert.deepEqual([vips(g)[s], turns(g, q), sh(g, q), hp(g, q), news(g, from)], [q, 1, L.OVERSHIELD, 100, [[AC.VP_MX_DRAW, q, s]]]);
  assert.deepEqual([vipsOf(g.v)[s].slot, says(vipsOf(g.v)[s])], [q, 'P256']);
  // hurt, ten ticks: still the VIP, one turn, no draw, its health as it was and its shields only recharging
  g.dv.setUint8(rec(q) + L.A_SH, 3); g.dv.setUint8(rec(q) + L.A_HP, 5);
  from = g.v.fxCount();
  steps(g, 10);
  assert.deepEqual([vips(g)[s], turns(g, q), hp(g, q), news(g, from)], [q, 1, 5, []]);
  assert.ok(sh(g, q) < 20, 'no overshield again');
  // killed by the other side: its point and the killer's, no VIP, q the last, VP_REDRAW to the next
  const k = [...Array(q).keys()].find((p) => team(g, p) !== s && !dead(g, p));
  setPoints(g, k, 0);
  const was = scores(g);
  from = g.v.fxCount();
  slay(g, k, q);
  const want = [...was]; want[1 - s]++;
  assert.deepEqual([scores(g), points(g, k), vips(g)[s], lasts(g)[s], lefts(g)[s]], [want, 1, -1, q, AC.VP_REDRAW - 1]);
  assert.deepEqual(news(g, from), [[AC.VP_MX_KILL, k, q + 256 * s]]);
});

test('VIP\'s waypoints: one whose text would cover another\'s goes to the nearest clear height (over before under, inside the band); apart ones stay; three on one point, near the top too, all apart', async () => {
  const { clearOf } = await import('../client/arena-game.mjs');
  // places markers in turn as markerRects does: each { x, y, half } where it asked to go
  const lay = (ms, top = 48, bottom = 400) => {
    const placed = [];
    for (const m of ms) placed.push({ ...m, y: clearOf(placed, m.x, m.y, m.half, top, bottom) });
    return placed.map((m) => m.y);
  };
  const m = (x, y, half = 4) => ({ x, y, half });
  // apart: across, or four rows up or down, as they were
  assert.deepEqual(lay([m(100, 200), m(200, 200), m(100, 224), m(100, 176)]), [200, 200, 224, 176]);
  // on one point: over, then under (the nearer of the two clear heights; a tie goes up)
  assert.deepEqual(lay([m(100, 200), m(100, 200)]), [200, 176]);
  assert.deepEqual(lay([m(100, 200), m(100, 200), m(100, 200)]), [200, 176, 224]);
  assert.deepEqual(lay([m(100, 200), m(100, 210)]), [200, 224], 'the nearer clear height, under');
  assert.deepEqual(lay([m(100, 200), m(100, 190)]), [200, 176], 'the nearer clear height, over');
  // at the top of the band: under, then under that (it never ends where it started)
  assert.deepEqual(lay([m(100, 60), m(100, 60), m(100, 60)]), [60, 84, 108]);
  assert.deepEqual(lay([m(100, 60), m(100, 60), m(100, 60), m(110, 60, 6)]), [60, 84, 108, 132]);
  // text widths: half widths in 4 px cells, apart by a hair or touching
  assert.deepEqual(lay([m(100, 200, 4), m(132.1, 200, 4)]), [200, 200]);
  assert.deepEqual(lay([m(100, 200, 4), m(131.9, 200, 4)]), [200, 176]);
  // the band full (no clear height inside it): where it asked
  assert.deepEqual(lay([m(100, 60), m(100, 84), m(100, 72)], 48, 100), [60, 84, 72]);
  // at the bottom of the band: over
  assert.deepEqual(lay([m(100, 400), m(100, 400)], 48, 400), [400, 376]);
});

test('VIP with 8 and 16 AI fighters: both sides\' VIPs drawn and killed, both sides scoring, in 20,000 ticks; no trap on the debug build, the same hash on every tick on 1 and 4 threads', async (t) => {
  const [debug, bytes] = [arenaBytes(true), arenaBytes()];
  const ticks = 20000;
  for (const bots of [8, 16]) {
    // draws and VIP kills by the VIP's side (news), points by side (each rise of AH_SCORE)
    const draws = [0, 0], kills = [0, 0], points = [0, 0];
    let k0 = 0, was = [0, 0], n = null, all = 0;
    const { log } = await playArena({ bytes: debug, seed: forcedSeed(L.M_VIP), bots, ticks, leaveAt: 1000,
      onTick: (tick, v) => {
        for (let k = Math.max(k0, v.fxCount() - L.FX_MAX); k < v.fxCount(); k++) {
          const f = v.fx(k);
          if (f.kind === L.FX_KILL) all++;
          if (f.kind !== L.FX_MODE) continue;
          if (f.size === AC.VP_MX_DRAW) draws[f.shot]++;
          if (f.size === AC.VP_MX_KILL) kills[f.shot >> 8]++;
        }
        k0 = v.fxCount();
        const score = [v.dv.getUint32(L.AH_SCORE, true), v.dv.getUint32(L.AH_SCORE + 4, true)];
        for (const k of [0, 1]) points[k] += Math.max(0, score[k] - was[k]);
        was = score;
        n = [v.dv.getUint32(L.AH_TEAMN, true), v.dv.getUint32(L.AH_TEAMN + 4, true)];
      } });
    t.diagnostic(`${bots} fighters: VIPs drawn ${draws} (red, blue), killed ${kills}, points ${points}, kills ${all}`);
    assert.deepEqual(n, [bots / 2, bots / 2]);
    assert.ok(kills.every((k) => k >= 1) && kills[0] + kills[1] >= 6 && draws.every((k, s) => k >= kills[s]), `${bots}: both sides' VIPs die and are drawn again`);
    assert.ok(points.every((k) => k >= 1), `${bots}: both sides score`);
    assert.deepEqual([points[0] + points[1], kills[0] + kills[1]], [kills[0] + kills[1], points[0] + points[1]], 'a point a VIP killed');
    const parsed = parseLog(log);
    const a = await replay({ bytes, log: parsed, ticks, threads: 1, tag: `vp${bots}x1` });
    const b = await replay({ bytes, log: parsed, ticks, threads: 4, tag: `vp${bots}x4`, startWorkers });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
  }
});
