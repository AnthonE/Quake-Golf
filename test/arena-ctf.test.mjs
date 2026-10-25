import test from 'node:test';
import assert from 'node:assert/strict';
import { arenaBytes } from './helpers.mjs';
import { View, arenaWord, arenaFrame, forcedSeed } from '../src/arena-view.mjs';
import { aimAt } from '../client/bot.mjs';
import { playArena } from '../tools/genarena.mjs';
import { replay, parseLog, decodeTrace, newMemory, instantiate, Sim } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import * as L from '../src/layout.mjs';
import ctf, { flags } from '../client/am/ctf.mjs';
import { AMC, SIDE_RGB } from '../client/am/index.mjs';
import { C } from '../client/font.mjs';

// Capture the Flag (src/am/ctf.wat, client/am/ctf.mjs). Helpers as
// test/arena-teams.test.mjs has them; the flags read straight from AO
// (src/am/ctf.mjs's fields).

// A room on the debug build: n fighters in, stepped to play (or only to the
// countdown, play = false). mode forces every match through the seed; null
// plays the rotation.
let debugModule = null;
async function room(mode, n = 2, seed = 7, play = true) {
  debugModule ||= await WebAssembly.compile(arenaBytes(true));
  const memory = newMemory();
  const sim = new Sim(await instantiate(debugModule, memory), memory);
  sim.init(mode === null ? seed : forcedSeed(mode, seed));
  const v = new View(sim.memory.buffer);
  const dv = new DataView(sim.memory.buffer);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  if (play) {
    while (v.hole().state !== L.H_PLAY) step();
    step();
  }
  return { sim, v, dv, step, n };
}

const rec = (p) => L.PLAYERS + p * L.PSIZE;
const fl = (g, p) => g.sim.u8[rec(p) + L.P_FL];
const team = (g, p) => (fl(g, p) & L.PF_BLUE ? 1 : 0);
const carry = (g, p) => (fl(g, p) & L.PF_CARRY) !== 0;
const setCarry = (g, p, on) => { g.sim.u8[rec(p) + L.P_FL] = on ? fl(g, p) | L.PF_CARRY : fl(g, p) & ~L.PF_CARRY; };
const u32 = (g, a) => g.dv.getUint32(a, true);
const scores = (g) => [u32(g, L.AH_SCORE), u32(g, L.AH_SCORE + 4)];
const points = (g, p) => g.dv.getUint16(L.MODE_REC + p * L.MR_SIZE + L.MR_POINTS, true);
const returns = (g, p) => g.dv.getUint16(L.MODE_REC + p * L.MR_SIZE + L.MR_AUX, true);

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

// p kills q with the sword at (x, z) (at height y): q put there, p 2 m off, a
// melee press; then p goes off where it touches nothing.
function sword(g, p, q, x, z, y = g.v.height(x, z)) {
  loadout(g, p, L.W_SWORD);
  for (let i = 0; i < L.COOL_TICKS; i++) g.step();
  put(g, p, x - 2, z, y); put(g, q, x, z, y);
  const w = still(g, p);
  g.step([[L.EV_INPUT, q, arenaWord({ yaw: 8192, ...still(g, q) })], [L.EV_INPUT, p, at(g, p, q, 1.0, { ...w, melee: w.melee ^ 1 })]]);
  assert.ok(g.v.fighter(q).dead, `P${p} kills P${q}`);
  away(g, [p]);
}

// A frag of p's about to go off at (x, z), on the ground or at height y.
function frag(g, p, x, z, y = g.v.height(x, z)) {
  const j = L.PROJ;
  g.dv.setFloat32(j + L.J_PX, x, true); g.dv.setFloat32(j + L.J_PY, y + 0.12, true); g.dv.setFloat32(j + L.J_PZ, z, true);
  for (const o of [L.J_VX, L.J_VY, L.J_VZ]) g.dv.setFloat32(j + o, 0, true);
  g.dv.setUint16(j + L.J_AGE, L.A_FUSE - 1, true); g.sim.u8[j + L.J_KIND] = L.K_GRENADE; g.sim.u8[j + L.J_OWNER] = p;
}

// p dies by its own frag where it is.
function suicide(g, p) {
  const pos = g.v.fighter(p).pos;
  frag(g, p, pos[0], pos[2], pos[1]);
  g.dv.setUint8(rec(p) + L.A_SH, 0); g.dv.setUint8(rec(p) + L.A_HP, 10);
  g.step();
  assert.ok(g.v.fighter(p).dead, `P${p} by its own frag`);
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
const endMatch = (g) => { g.dv.setUint32(L.HDR_UNTIL, g.v.tick + 1, true); for (let i = 0; i < 4; i++) g.step(); };
const untilPlay = (g) => { while (g.v.hole().state !== L.H_PLAY) g.step(); g.step(); };

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

// ---- the flags

// Flag k (0 red's, 1 blue's) as AO holds it.
function flag(g, k) {
  const a = L.AO + L.CF_FLAG + k * L.CF_FSIZE;
  const f = (o) => g.dv.getFloat32(a + o, true);
  return { pos: [f(L.CF_POS), f(L.CF_POS + 4), f(L.CF_POS + 8)], state: g.sim.u8[a + L.CF_STATE], by: g.sim.u8[a + L.CF_BY],
    left: g.dv.getUint16(a + L.CF_LEFT, true), stand: [f(L.CF_STAND), f(L.CF_STAND + 4), f(L.CF_STAND + 8)] };
}
const setLeft = (g, k, n) => g.dv.setUint16(L.AO + L.CF_FLAG + k * L.CF_FSIZE + L.CF_LEFT, n, true);
// Blood Gulch's stands: on each room's floor (21), red's x 382.8-401.2, blue's
// 622.8-641.2, z 503.8-520.2; each roof's top 25.8 right over its stand.
const STAND = [[392, 21, 512], [632, 21, 512]];
const FLOOR = 21, ROOF = 25.8;
const HOME = L.CF_HOME, CARRIED = L.CF_CARRIED, DROPPED = L.CF_DROPPED;
// Each fighter off where it touches nothing: on open ground mid-field, 6 m apart.
const away = (g, slots) => slots.forEach((p) => put(g, p, 470 + 6 * p, 560));
// The flags' news from the running count `from` on: [what, owner, shot].
const news = (g, from) => fxs(g.v, L.FX_MODE, undefined, from).filter((f) => f.size >= L.CF_MX_TAKE && f.size <= L.CF_MX_DROP).map((f) => [f.size, f.owner, f.shot]);
const newsAt = (g, from) => fxs(g.v, L.FX_MODE, undefined, from).filter((f) => f.size >= L.CF_MX_TAKE && f.size <= L.CF_MX_DROP).map((f) => f.pos);
const near = (a, b, e = 1e-4) => a.every((x, i) => Math.abs(x - b[i]) < e);
const fpos = (g, p) => g.v.fighter(p).pos;

test('CTF: play lays both flags home on their stands (MAP_FLAGS resolved onto each room\'s floor), the target CF_CAPS; AO is all 0 till then', async () => {
  const c = await room(L.M_CTF, 2, 7, false);
  assert.equal(c.v.hole().state, L.H_COUNT);
  assert.ok(c.sim.u8.slice(L.AO, L.AO + L.AO_SIZE).every((x) => x === 0), 'the countdown');
  const g = await room(L.M_CTF, 4);
  assert.equal(u32(g, L.AH_TARGET), L.CF_CAPS);
  for (const k of [0, 1]) {
    const f = flag(g, k);
    assert.deepEqual([f.state, f.left, f.by], [HOME, 0, 0], `flag ${k}`);
    assert.ok(near(f.stand, STAND[k], 1e-3), `flag ${k}'s stand: ${f.stand}`);
    assert.deepEqual(f.pos, f.stand, `flag ${k} on it`);
    assert.equal(f.stand[1], g.v.height(f.stand[0], f.stand[2]), 'the floor is the ground');
  }
  // nothing past the two records
  assert.ok(g.sim.u8.slice(L.AO + 2 * L.CF_FSIZE, L.AO + L.AO_SIZE).every((x) => x === 0));
  // everyone where they spawned: nobody took anything
  for (let i = 0; i < 200; i++) g.step();
  assert.deepEqual([flag(g, 0).state, flag(g, 1).state, scores(g)], [HOME, HOME, [0, 0]]);
});

test('CTF: an enemy touching a flag at home takes it; its own side, the dead, a carrier, the roof over it and a step too far don\'t; the first in slot order; the flag goes with its carrier', async () => {
  const g = await room(L.M_CTF, 6); // red 0, 2, 4; blue 1, 3, 5
  const all = [0, 1, 2, 3, 4, 5];
  away(g, all);
  g.step();
  let from = g.v.fxCount();
  const blue = () => flag(g, 1);
  const [x, y, z] = STAND[1];
  // blue on its own flag; red a step too far across (1.6 m), on the roof right over it (4.8 m up), dead on it, carrying on it
  put(g, 1, x, z, y);
  put(g, 0, x + 1.6, z, y);
  put(g, 2, x, z, ROOF);
  put(g, 4, x - 0.5, z, y); g.sim.u8[rec(4) + L.P_FL] |= L.PF_DEAD; g.dv.setUint16(rec(4) + L.A_RESPAWN, 500, true);
  for (let i = 0; i < 10; i++) g.step();
  assert.deepEqual([blue().state, news(g, from)], [HOME, []], 'nobody');
  setCarry(g, 2, true);
  put(g, 2, x, z + 0.5, y);
  for (let i = 0; i < 10; i++) g.step();
  assert.deepEqual([blue().state, news(g, from)], [HOME, []], 'a carrier');
  setCarry(g, 2, false);
  // a step in (1.4 m): red 0 takes it, though blue 1 stands on it and red 2 touches it too
  g.dv.setUint8(rec(0) + L.A_RELOAD, 9); g.dv.setUint8(rec(0) + L.A_BURST, 2);
  put(g, 0, x + 1.4, z, y);
  g.step();
  assert.deepEqual([blue().state, blue().by, carry(g, 0), carry(g, 2)], [CARRIED, 0, true, false]);
  assert.deepEqual(news(g, from), [[L.CF_MX_TAKE, 0, 1]]);
  assert.ok(near(newsAt(g, from)[0], STAND[1], 1e-3), 'news at the stand');
  const f = g.v.fighter(0);
  assert.deepEqual([f.reload, f.burst], [0, 0], 'a reload and a burst stopped');
  assert.deepEqual(flag(g, 0).state, HOME, 'red\'s own untouched');
  // it goes where its carrier's feet go, a tick at a time
  for (const [px, pz] of [[600, 520], [560, 500.25], [512.5, 512]]) {
    put(g, 0, px, pz);
    g.step();
    assert.deepEqual(blue().pos, fpos(g, 0), `at ${px}, ${pz}`);
  }
  // red 2 (slot 2) and red 4 (slot 4), alive again, both on blue's flag once it's home: the lower slot takes it
  const h = await room(L.M_CTF, 6);
  away(h, all);
  put(h, 4, x + 0.5, z, y); put(h, 2, x - 0.5, z, y);
  from = h.v.fxCount();
  h.step();
  assert.deepEqual([flag(h, 1).by, carry(h, 2), carry(h, 4), news(h, from)], [2, true, false, [[L.CF_MX_TAKE, 2, 1]]]);
  // and blue takes red's the same way
  put(h, 3, STAND[0][0], STAND[0][2], FLOOR);
  h.step();
  assert.deepEqual([flag(h, 0).state, flag(h, 0).by, carry(h, 3), news(h, from).at(-1)], [CARRIED, 3, true, [L.CF_MX_TAKE, 3, 0]]);
});

test('CTF: a carrier captures at its own stand (within CF_CAP_R, CF_TOUCH_H up or down) while its own flag is home: a point, MR_POINTS, the carry over, the flag home', async () => {
  const g = await room(L.M_CTF, 4);
  away(g, [0, 1, 2, 3]);
  put(g, 0, STAND[1][0], STAND[1][2], FLOOR);
  g.step();
  assert.equal(flag(g, 1).by, 0);
  const from = g.v.fxCount();
  // 2.6 m off red's stand, and on the roof right over it: no capture
  for (const [x, y] of [[392 + 2.6, FLOOR], [392, ROOF]]) {
    put(g, 0, x, 512, y);
    for (let i = 0; i < 5; i++) g.step();
    assert.deepEqual([flag(g, 1).state, scores(g), news(g, from)], [CARRIED, [0, 0], []], `at ${x}, ${y}`);
  }
  // 2.4 m: captured
  put(g, 0, 392 - 2.4, 512, FLOOR);
  g.step();
  const capAt = fpos(g, 0);
  assert.deepEqual([scores(g), points(g, 0), carry(g, 0)], [[1, 0], 1, false]);
  assert.deepEqual([flag(g, 1).state, flag(g, 1).pos], [HOME, flag(g, 1).stand]);
  assert.deepEqual(news(g, from), [[L.CF_MX_CAP, 0, 1]]);
  assert.ok(near(newsAt(g, from)[0], capAt), 'at the carrier\'s feet');
  assert.deepEqual([flag(g, 0).state, points(g, 1), points(g, 2), returns(g, 0)], [HOME, 0, 0, 0]);
  // the match goes on; blue captures the same way the other way round
  put(g, 3, STAND[0][0], STAND[0][2], FLOOR);
  g.step();
  put(g, 3, 632, 512 + 1, FLOOR);
  g.step();
  assert.deepEqual([scores(g), points(g, 3), carry(g, 3), flag(g, 0).state], [[1, 1], 1, false, HOME]);
  assert.deepEqual(news(g, from).slice(1), [[L.CF_MX_TAKE, 3, 0], [L.CF_MX_CAP, 3, 0]]);
  assert.equal(g.v.hole().state, L.H_PLAY);
});

test('CTF: no capture while your own flag is away; once a teammate returns it, the carrier waiting at its stand captures on the next tick', async () => {
  const g = await room(L.M_CTF, 4);
  away(g, [0, 1, 2, 3]);
  // each side takes the other's
  put(g, 0, STAND[1][0], STAND[1][2], FLOOR); put(g, 1, STAND[0][0], STAND[0][2], FLOOR);
  g.step();
  assert.deepEqual([flag(g, 0).by, flag(g, 1).by, carry(g, 0), carry(g, 1)], [1, 0, true, true]);
  // both home with what they carry: a standoff
  put(g, 0, 392, 512, FLOOR); put(g, 1, 632, 512, FLOOR);
  for (let i = 0; i < 20; i++) g.step();
  assert.deepEqual([flag(g, 0).state, flag(g, 1).state, scores(g)], [CARRIED, CARRIED, [0, 0]]);
  // red 2 kills blue 1 mid-field: red's flag lies there, still not home
  sword(g, 2, 1, 500, 540);
  assert.deepEqual([flag(g, 0).state, scores(g)], [DROPPED, [0, 0]]);
  for (let i = 0; i < 5; i++) g.step();
  assert.equal(scores(g)[0], 0, 'dropped is not home');
  // red 2 touches it: home (a touch, after the captures on that tick); red 0 at its stand captures on the next
  const from = g.v.fxCount();
  put(g, 2, flag(g, 0).pos[0] + 1, flag(g, 0).pos[2], flag(g, 0).pos[1]);
  g.step();
  assert.deepEqual([news(g, from), scores(g), returns(g, 2), flag(g, 0).state, flag(g, 1).state], [[[L.CF_MX_RETURN, 2, 0]], [0, 0], 1, HOME, CARRIED]);
  g.step();
  assert.deepEqual(news(g, from), [[L.CF_MX_RETURN, 2, 0], [L.CF_MX_CAP, 0, 1]]);
  assert.deepEqual([scores(g), points(g, 0), flag(g, 0).state, flag(g, 1).state, carry(g, 0)], [[1, 0], 1, HOME, HOME, false]);
});

// Flag k poked dropped at (x, y, z), `left` ticks to lie.
function lay(g, k, x, y, z, left = 1000) {
  const a = L.AO + L.CF_FLAG + k * L.CF_FSIZE;
  [x, y, z].forEach((v, i) => g.dv.setFloat32(a + L.CF_POS + 4 * i, v, true));
  g.sim.u8[a + L.CF_STATE] = DROPPED;
  g.dv.setUint16(a + L.CF_LEFT, left, true);
}

test('CTF: a tie on one tick goes the same way for either colour: a capture comes before a take of the capturer\'s flag; a fighter takes the enemy\'s flag and returns its own together', async () => {
  for (const k of [0, 1]) {
    // k's carrier c brings the enemy's flag to k's stand as the enemy's t touches k's flag there
    const g = await room(L.M_CTF, 4);
    away(g, [0, 1, 2, 3]);
    const [c, t] = k === 0 ? [0, 1] : [1, 0];
    put(g, c, STAND[1 - k][0], STAND[1 - k][2], FLOOR);
    g.step();
    put(g, c, 512, 540);
    g.step();
    const from = g.v.fxCount();
    put(g, c, STAND[k][0] - 2, STAND[k][2], FLOOR); put(g, t, STAND[k][0] + 1, STAND[k][2], FLOOR);
    g.step();
    assert.deepEqual(scores(g), k === 0 ? [1, 0] : [0, 1], `${k ? 'blue' : 'red'} captures`);
    assert.deepEqual([flag(g, 1 - k).state, flag(g, k).state, flag(g, k).by, carry(g, c), carry(g, t)], [HOME, CARRIED, t, false, true]);
    assert.deepEqual(news(g, from), [[L.CF_MX_CAP, c, 1 - k], [L.CF_MX_TAKE, t, k]]);
  }
  for (const s of [0, 1]) {
    // s's fighter p on the enemy's stand, its own flag lying beside it
    const g = await room(L.M_CTF, 4);
    away(g, [0, 1, 2, 3]);
    const p = s;
    const [x, , z] = STAND[1 - s];
    lay(g, s, x + 1, FLOOR, z + 1);
    const from = g.v.fxCount();
    put(g, p, x + 0.5, z + 0.5, FLOOR);
    g.step();
    assert.deepEqual([flag(g, s).state, flag(g, 1 - s).state, flag(g, 1 - s).by, returns(g, p), carry(g, p)], [HOME, CARRIED, p, 1, true], `${s ? 'blue' : 'red'}`);
    assert.deepEqual(news(g, from), s === 0 ? [[L.CF_MX_RETURN, 0, 0], [L.CF_MX_TAKE, 0, 1]] : [[L.CF_MX_TAKE, 1, 0], [L.CF_MX_RETURN, 1, 1]]);
  }
});

// Slot `carrier` takes flag k at its stand; `killer` kills it at (x, z) (height y): the flag lies there.
function dropAt(g, k, carrier, killer, x, z, y) {
  put(g, carrier, STAND[k][0], STAND[k][2], FLOOR);
  g.step();
  assert.equal(flag(g, k).by, carrier);
  sword(g, killer, carrier, x, z, y);
  assert.equal(flag(g, k).state, DROPPED);
}

test('CTF: a carrier who dies drops the flag at its feet, CF_RETURN to go; left alone it goes home on the CF_RETURN-th tick after', async () => {
  const g = await room(L.M_CTF, 4);
  away(g, [0, 1, 2, 3]);
  put(g, 0, STAND[1][0], STAND[1][2], FLOOR);
  g.step();
  let from = g.v.fxCount();
  sword(g, 1, 0, 500, 530);
  const lay = flag(g, 1);
  assert.deepEqual([lay.state, lay.left, lay.by, carry(g, 0)], [DROPPED, L.CF_RETURN - 1, 0, false], 'one off on the drop\'s own tick');
  assert.ok(near(lay.pos, [500, g.v.height(500, 530), 530], 1e-3), `${lay.pos}`);
  assert.deepEqual(news(g, from), [[L.CF_MX_DROP, 0, 1]]);
  assert.deepEqual(newsAt(g, from), [lay.pos]);
  assert.deepEqual([scores(g), flag(g, 0).state], [[0, 0], HOME]);
  from = g.v.fxCount();
  for (let i = 1; i < L.CF_RETURN; i++) g.step();
  assert.deepEqual([flag(g, 1).state, flag(g, 1).left, news(g, from)], [DROPPED, 0, []]);
  g.step();
  assert.deepEqual([flag(g, 1).state, flag(g, 1).pos, flag(g, 1).left, news(g, from)], [HOME, flag(g, 1).stand, 0, [[L.CF_MX_HOME, 255, 1]]]);
  assert.deepEqual(newsAt(g, from), [lay.pos], 'news where it lay');
  // and it can be taken from home again
  while (g.v.fighter(0).dead) g.step();
  put(g, 0, STAND[1][0], STAND[1][2], FLOOR);
  g.step();
  assert.equal(flag(g, 1).state, CARRIED);
});

test('CTF: a dropped flag: its own side returns it (MR_AUX), the other side takes it up again, the first in slot order of both; a carrier touches nothing', async () => {
  // blue 3 returns blue's
  let g = await room(L.M_CTF, 6); // red 0, 2, 4; blue 1, 3, 5
  away(g, [0, 1, 2, 3, 4, 5]);
  dropAt(g, 1, 0, 1, 500, 530);
  let from = g.v.fxCount();
  put(g, 3, 501.4, 530);
  g.step();
  assert.deepEqual([flag(g, 1).state, flag(g, 1).pos, returns(g, 3), points(g, 3), news(g, from)], [HOME, flag(g, 1).stand, 1, 0, [[L.CF_MX_RETURN, 3, 1]]]);
  assert.ok(near(newsAt(g, from)[0], [500, g.v.height(500, 530), 530], 1e-3), 'news where it lay');
  // red 2 takes it up where it lies
  g = await room(L.M_CTF, 6);
  away(g, [0, 1, 2, 3, 4, 5]);
  dropAt(g, 1, 0, 1, 500, 530);
  from = g.v.fxCount();
  put(g, 2, 499, 530);
  g.step();
  assert.deepEqual([flag(g, 1).state, flag(g, 1).by, flag(g, 1).left, carry(g, 2), news(g, from)], [CARRIED, 2, 0, true, [[L.CF_MX_TAKE, 2, 1]]]);
  // both sides on it: the lower slot, blue 1 before red 2 (returns), red 2 before blue 3 (takes)
  for (const [own, enemy, want] of [[1, 2, HOME], [3, 2, CARRIED]]) {
    g = await room(L.M_CTF, 6);
    away(g, [0, 1, 2, 3, 4, 5]);
    dropAt(g, 1, 0, 5, 500, 530);
    put(g, own, 500.5, 530.5); put(g, enemy, 499.5, 529.5);
    g.step();
    assert.deepEqual([flag(g, 1).state, returns(g, own), carry(g, enemy)], [want, want === HOME ? 1 : 0, want === CARRIED], `P${own} and P${enemy}`);
  }
  // red 0 carries blue's; blue 1 carrying red's dies: red 0 walks over red's own flag lying there and leaves it lying
  g = await room(L.M_CTF, 6);
  away(g, [0, 1, 2, 3, 4, 5]);
  put(g, 0, STAND[1][0], STAND[1][2], FLOOR); put(g, 1, STAND[0][0], STAND[0][2], FLOOR);
  g.step();
  sword(g, 2, 1, 520, 470);
  from = g.v.fxCount();
  put(g, 0, 520, 470);
  for (let i = 0; i < 5; i++) g.step();
  assert.deepEqual([flag(g, 0).state, flag(g, 1).by, carry(g, 0), returns(g, 0), news(g, from)], [DROPPED, 0, true, 0, []]);
  assert.deepEqual(flag(g, 1).pos, fpos(g, 0), 'it carries blue\'s over red\'s');
});

test('CTF: a dropped flag falls onto what is under it: on a roof it lies on the roof, from the air over a room on its floor', async () => {
  const g = await room(L.M_CTF, 4);
  away(g, [0, 1, 2, 3]);
  put(g, 0, STAND[1][0], STAND[1][2], FLOOR);
  g.step();
  // red 0 dies by its own frag on red's roof
  put(g, 0, 394, 510, ROOF);
  g.step();
  let from = g.v.fxCount();
  suicide(g, 0);
  assert.deepEqual([flag(g, 1).state, news(g, from)], [DROPPED, [[L.CF_MX_DROP, 0, 1]]]);
  assert.ok(near(flag(g, 1).pos, [394, ROOF, 510], 1e-3), `on the roof: ${flag(g, 1).pos}`);
  // red 2 takes it there and dies in the air over the room: it falls to the floor
  put(g, 2, 394.5, 510, ROOF);
  g.step();
  assert.equal(flag(g, 1).by, 2);
  from = g.v.fxCount();
  put(g, 2, 395, 512, 23.5);
  frag(g, 2, 395, 512, 23.5);
  g.dv.setUint8(rec(2) + L.A_SH, 0); g.dv.setUint8(rec(2) + L.A_HP, 10);
  g.step();
  assert.ok(g.v.fighter(2).dead && fpos(g, 2)[1] > 23, 'in the air');
  assert.deepEqual(news(g, from), [[L.CF_MX_DROP, 2, 1]]);
  const f = flag(g, 1);
  assert.ok(Math.abs(f.pos[0] - 395) < 0.01 && Math.abs(f.pos[2] - 512) < 0.01 && f.pos[1] === g.v.height(f.pos[0], f.pos[2]) && Math.abs(f.pos[1] - FLOOR) < 1e-3, `on the floor: ${f.pos}`);
});

test('CTF: a carrier who leaves, whose slot rejoins, who is dead without a kill or no longer carries drops the flag where it last stood', async () => {
  const g = await room(L.M_CTF, 4);
  away(g, [0, 1, 2, 3]);
  const take = () => { put(g, 0, STAND[1][0], STAND[1][2], FLOOR); g.step(); put(g, 0, 500, 540); g.step(); assert.equal(flag(g, 1).by, 0); };
  const lies = (what, from) => {
    const f = flag(g, 1);
    assert.deepEqual([f.state, f.left, carry(g, 0), news(g, from)], [DROPPED, L.CF_RETURN - 1, false, [[L.CF_MX_DROP, 0, 1]]], what);
    assert.ok(near(f.pos, [500, g.v.height(500, 540), 540], 1e-3), `${what}: ${f.pos}`);
    // home again for the next
    setLeft(g, 1, 0);
    g.step();
    assert.equal(flag(g, 1).state, HOME);
  };
  // it leaves
  take();
  let from = g.v.fxCount();
  g.step([[L.EV_LEAVE, 0]]);
  lies('left', from);
  g.step([[L.EV_JOIN, 0]]);
  assert.ok(!carry(g, 0), 'back with nothing');
  // it leaves and the slot is joined again on the same tick: dropped where it was, not at the new spawn
  away(g, [0]);
  g.step();
  take();
  from = g.v.fxCount();
  g.step([[L.EV_LEAVE, 0], [L.EV_JOIN, 0]]);
  assert.ok(fl(g, 0) & L.PF_LIVE);
  lies('rejoined', from);
  // dead without a kill
  away(g, [0]);
  g.step();
  take();
  from = g.v.fxCount();
  g.sim.u8[rec(0) + L.P_FL] |= L.PF_DEAD; g.dv.setUint16(rec(0) + L.A_RESPAWN, 500, true);
  g.step();
  lies('dead', from);
  while (g.v.fighter(0).dead) g.step();
  // its carry gone some other way (and it gone off, or it takes it straight back)
  away(g, [0]);
  g.step();
  take();
  from = g.v.fxCount();
  setCarry(g, 0, false);
  away(g, [0]);
  g.step();
  lies('no longer carrying', from);
  // a join meanwhile changes nothing for the flags
  g.step([[L.EV_JOIN, 9]]);
  assert.deepEqual([flag(g, 0).state, flag(g, 1).state, carry(g, 9)], [HOME, HOME, false]);
});

test('CTF: over on the tick a side reaches CF_CAPS; at the clock the side with more, or a draw; places: winners first, then captures, then kills; the next match starts afresh', async () => {
  const g = await room(L.M_CTF, 4);
  away(g, [0, 1, 2, 3]);
  g.dv.setUint32(L.AH_SCORE, L.CF_CAPS - 1, true);
  [0, 3, 5, 1].forEach((k, p) => g.dv.setUint16(rec(p) + L.A_KILLS, k, true));
  g.dv.setUint16(L.MODE_REC + 3 * L.MR_SIZE + L.MR_POINTS, 1, true); // blue 3 captured once before
  put(g, 0, STAND[1][0], STAND[1][2], FLOOR);
  g.step();
  put(g, 0, STAND[0][0], STAND[0][2], FLOOR);
  let from = g.v.fxCount();
  g.step();
  assert.deepEqual([g.v.hole().state, scores(g), u32(g, L.AH_TEAMWIN)], [L.H_OVER, [L.CF_CAPS, 0], 1], 'over on its tick, red\'s');
  assert.deepEqual(news(g, from), [[L.CF_MX_CAP, 0, 1]]);
  assert.deepEqual(fxs(g.v, L.FX_MODE, L.MX_TEAMWIN, from).map((f) => [f.owner, f.shot]), [[0, 1]]);
  // red 0 (1 capture) above red 2 (5 kills); blue 3 (1 capture, 1 kill) above blue 1 (3 kills)
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.fighter(p).place), [1, 4, 2, 3]);
  // the clock: blue ahead by a capture
  const r = await room(L.M_CTF, 4);
  away(r, [0, 1, 2, 3]);
  put(r, 1, STAND[0][0], STAND[0][2], FLOOR);
  r.step();
  put(r, 1, STAND[1][0], STAND[1][2], FLOOR);
  r.step();
  assert.deepEqual(scores(r), [0, 1]);
  // red 2 carries blue's flag as the clock runs out
  put(r, 2, STAND[1][0], STAND[1][2], FLOOR);
  r.step();
  put(r, 2, 500, 540);
  from = r.v.fxCount();
  endMatch(r);
  assert.deepEqual([r.v.hole().state, u32(r, L.AH_TEAMWIN)], [L.H_OVER, 2]);
  assert.deepEqual(fxs(r.v, L.FX_MODE, L.MX_TEAMWIN, from).map((f) => f.shot), [2]);
  assert.deepEqual([0, 1, 2, 3].map((p) => r.v.fighter(p).place), [3, 1, 3, 2]);
  // nothing runs through the scoreboard: AO as play left it
  const over = flag(r, 1);
  for (let i = 0; i < 100; i++) r.step();
  assert.deepEqual(flag(r, 1), over);
  // the next match: both home, nobody carrying, nothing scored
  untilPlay(r);
  assert.deepEqual([scores(r), u32(r, L.AH_TEAMWIN), u32(r, L.AH_TARGET)], [[0, 0], 0, L.CF_CAPS]);
  assert.deepEqual([flag(r, 0).state, flag(r, 1).state, flag(r, 1).pos, [0, 1, 2, 3].some((p) => carry(r, p))], [HOME, HOME, flag(r, 1).stand, false]);
  assert.deepEqual([0, 1, 2, 3].map((p) => [points(r, p), returns(r, p)]), [[0, 0], [0, 0], [0, 0], [0, 0]]);
  // a draw at 1 to 1
  const s = await room(L.M_CTF, 4);
  s.dv.setUint32(L.AH_SCORE, 1, true); s.dv.setUint32(L.AH_SCORE + 4, 1, true);
  endMatch(s);
  assert.equal(u32(s, L.AH_TEAMWIN), 3);
});

test('a Fiesta after Capture the Flag: its region exactly a Fiesta\'s (the mode header, AO, the records, no pads, no sides, nothing carried)', async () => {
  const g = await room(null, 4);
  g.dv.setUint32(L.HDR_HOLE, L.ARENA_MODES.indexOf(L.M_CTF) - 1, true);
  endMatch(g);
  untilPlay(g);
  assert.equal(g.v.mode().mode, L.M_CTF);
  // a capture, a return, a flag carried and a flag lying as it ends
  away(g, [0, 1, 2, 3]);
  put(g, 0, STAND[1][0], STAND[1][2], FLOOR);
  g.step();
  put(g, 0, STAND[0][0], STAND[0][2], FLOOR);
  g.step();
  away(g, [0]);
  dropAt(g, 0, 1, 2, 520, 470);
  put(g, 2, 521, 470);
  g.step();
  away(g, [2]);
  while (g.v.fighter(1).dead) g.step();
  dropAt(g, 0, 1, 0, 520, 470);
  put(g, 2, STAND[1][0], STAND[1][2], FLOOR);
  g.step();
  assert.deepEqual([scores(g), points(g, 0), returns(g, 2), flag(g, 0).state, flag(g, 1).state, carry(g, 2)], [[1, 0], 1, 1, DROPPED, CARRIED, true]);
  g.dv.setUint32(L.HDR_HOLE, L.ARENA_MODES.length - 1, true); // the next match is the rotation's Fiesta
  endMatch(g);
  untilPlay(g);
  assert.equal(g.v.mode().mode, L.M_FIESTA);
  const zero = (a, b) => g.sim.u8.slice(a, b).every((x) => x === 0);
  assert.ok(zero(L.AH_MODE, L.AH_END), 'the header');
  assert.ok(zero(L.AO, L.AO + L.AO_SIZE), 'the objective');
  assert.ok(zero(L.MODE_REC, L.MODE_REC + L.NPLAYER * L.MR_SIZE), 'the records');
  if (L.FIESTA) assert.ok(zero(L.PAD, L.PAD + L.NPAD * L.PAD_SIZE), 'the pads');
  for (let p = 0; p < L.NPLAYER; p++) assert.equal(fl(g, p) & (L.PF_BLUE | L.PF_CARRY), 0, `P${p}`);
  // and stays so through play, fighters on the flags' stands
  put(g, 0, STAND[1][0], STAND[1][2], FLOOR); put(g, 1, STAND[0][0], STAND[0][2], FLOOR);
  for (let i = 0; i < 200; i++) g.step();
  assert.ok(zero(L.AH_MODE, L.AH_END) && zero(L.AO, L.AO + L.AO_SIZE) && !carry(g, 0) && !carry(g, 1));
});

test('CTF: a flag\'s carrier, its runs, jumps, turns, clicks, swings, frag presses and frames, predicted from every tick bit for bit', async () => {
  const g = await room(L.M_CTF, 3);
  away(g, [0, 1, 2]);
  for (let i = 0; i < L.SWAP_TICKS; i++) g.step();
  put(g, 0, STAND[1][0], STAND[1][2], FLOOR);
  g.step();
  assert.ok(carry(g, 0) && flag(g, 1).by === 0);
  put(g, 0, 470, 500); put(g, 1, 470, 540); put(g, 2, 600, 450);
  g.step();
  const inputs = [];
  for (let k = 0; k < 400; k++) {
    inputs.push(arenaWord({ yaw: 30 * k, pitch: 480, move: k < 150 ? 1 : k < 300 ? 9 : 2, jump: k % 60 === 10 ? 1 : 0, shot: (k >> 4) & 3, melee: (k >> 6) & 1,
      gren: (k >> 5) & 1, slot: k >= 200 && k < 260 ? 1 : 0, serial: (arenaFrame({ lag: 4, reload: k > 100 }) >> ((g.v.tick + k) & 7)) & 1 }));
  }
  const shots = g.v.fighter(0).shots;
  assert.ok(predicted(g, 0, inputs) > 400);
  const f = g.v.fighter(0);
  assert.ok(f.shots - shots >= 4, `${f.shots - shots} swings`);
  assert.deepEqual([f.grens, carry(g, 0), flag(g, 1).state, flag(g, 1).pos], [2, true, CARRIED, f.pos]);
});

// AI fighters in Capture the Flag on the debug build: no trap, and every tick's
// hash the same replayed on 1 and 4 threads; the flags' news as they play.
async function bots(n, ticks) {
  const [debug, bytes] = [arenaBytes(true), arenaBytes()];
  const seen = { [L.CF_MX_TAKE]: 0, [L.CF_MX_CAP]: 0, [L.CF_MX_RETURN]: 0, [L.CF_MX_HOME]: 0, [L.CF_MX_DROP]: 0 };
  let count = 0;
  const { log } = await playArena({ bytes: debug, seed: forcedSeed(L.M_CTF), bots: n, ticks, leaveAt: 1000,
    onTick: (t, v) => {
      for (let k = Math.max(count, v.fxCount() - L.FX_MAX); k < v.fxCount(); k++) { const f = v.fx(k); if (f.kind === L.FX_MODE && f.size in seen) seen[f.size]++; }
      count = v.fxCount();
    } });
  const parsed = parseLog(log);
  const a = await replay({ bytes, log: parsed, ticks, threads: 1, tag: `cf${n}a` });
  const b = await replay({ bytes, log: parsed, ticks, threads: 4, tag: `cf${n}b`, startWorkers });
  assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
  return { take: seen[L.CF_MX_TAKE], cap: seen[L.CF_MX_CAP], ret: seen[L.CF_MX_RETURN], home: seen[L.CF_MX_HOME], drop: seen[L.CF_MX_DROP] };
}

test('CTF with 8 AI fighters on Blood Gulch: no trap on the debug build, the same hash on every tick on 1 and 4 threads; flags taken in 20,000 ticks', async (t) => {
  const s = await bots(8, 20000);
  t.diagnostic(JSON.stringify(s));
  assert.ok(s.take >= 1, `${s.take} taken`);
});

test('CTF with 16 AI fighters on Blood Gulch: no trap on the debug build, the same hash on every tick on 1 and 4 threads; flags taken and captured in 20,000 ticks', async (t) => {
  const s = await bots(16, 20000);
  t.diagnostic(JSON.stringify(s));
  assert.ok(s.take >= 1 && s.cap >= 1, `${s.take} taken, ${s.cap} captured`);
});

// ---- the client module (client/am/ctf.mjs)

// What its hooks put out against a CTF room's View, for slot `slot` (on `team`).
const hudOf = (g, slot, team) => { const lines = []; ctf.hud(g.v, { put: (x, y, s, c) => lines.push([y, s, c]), C, slot, me: slot >= 0 ? g.v.fighter(slot) : null, team, now: 0 }); return lines; };
function newsOf(g, f, slot) {
  const said = [], shown = [];
  ctf.news(f, { slot, me: null, name: (p) => (p === slot ? 'YOU' : `P${p + 1}`), team: (p) => (p < L.NPLAYER ? team(g, p) : -1),
    feed: (t, c) => said.push([t, c]), banner: (t, c) => shown.push([t, c]), glow: () => {}, sound: {}, dist: 10, C, now: 0, view: g.v });
  return { said, shown };
}
// (a spectator: slot -1, shown the fighter it watches)
function drawOf(g, slot, shown = slot) {
  const out = { solid: [], glow: [], beams: [], markers: [], zone: null };
  ctf.draw(g.v, { dt: 0, now: 0, t: 1, slot, shown, me: slot >= 0 ? g.v.fighter(slot) : null, pme: null, cam: [0, 0, 0], view: g.v, pview: null }, out);
  return out;
}
// p's goal, its role and rank as the bot gives them (sides dealt red, blue, red...: rank p >> 1)
const goalOf = (g, p) => { const rank = p >> 1; return ctf.goal(g.v, g.v.fighter(p), { role: rank % 3 === 2 ? 'defend' : 'attack', rank, view: g.v, ally: (a, b) => g.v.ally(a, b), slot: p, t: 0 }); };
const round = (p) => p.map((x) => Math.round(x * 100) / 100);

test('CTF\'s client: the flags from AO (from the map in the countdown); HUD lines, news lines and banners from each side; the board\'s columns', async () => {
  assert.equal(AMC[L.M_CTF], ctf);
  const c = await room(L.M_CTF, 4, 7, false);
  assert.deepEqual(flags(c.v).map((f) => [f.state, round(f.pos)]), [[HOME, STAND[0]], [HOME, STAND[1]]], 'the countdown: the map\'s');
  const g = await room(L.M_CTF, 4);
  away(g, [0, 1, 2, 3]);
  assert.deepEqual(flags(g.v).map((f) => [f.state, f.pos, f.stand]), [0, 1].map((k) => [HOME, flag(g, k).stand, flag(g, k).stand]));
  assert.deepEqual(hudOf(g, 0, 0), [[2, 'YOUR FLAG  HOME', C.RED], [3, 'THEIR FLAG  HOME', C.CYAN]]);
  assert.deepEqual(hudOf(g, -1, -1), [[2, 'RED FLAG  HOME', C.RED], [3, 'BLUE FLAG  HOME', C.CYAN]]);
  // red 0 takes blue's: its own HUD, blue's, and the news of it each way
  let from = g.v.fxCount();
  put(g, 0, STAND[1][0], STAND[1][2], FLOOR);
  g.step();
  const take = fxs(g.v, L.FX_MODE, L.CF_MX_TAKE, from)[0];
  assert.deepEqual(hudOf(g, 0, 0), [[2, 'YOUR FLAG  HOME', C.RED], [3, 'THEIR FLAG  YOU HAVE IT', C.CYAN], [4, 'RUN HOME TO SCORE', C.WHITE]]);
  assert.deepEqual(hudOf(g, 1, 1), [[2, 'YOUR FLAG  TAKEN BY P1', C.YELLOW], [3, 'THEIR FLAG  HOME', C.RED]]);
  assert.deepEqual(newsOf(g, take, 0), { said: [['YOU TOOK THE BLUE FLAG', C.RED]], shown: [['YOU HAVE THE FLAG  RUN HOME', C.YELLOW]] });
  assert.deepEqual(newsOf(g, take, 1), { said: [['P1 TOOK THE BLUE FLAG', C.RED]], shown: [['YOUR FLAG IS TAKEN', C.CYAN]] });
  assert.deepEqual(newsOf(g, take, 2).shown, [], 'a teammate: the feed only');
  // it dies: blue's flag lies, 20 s to go
  from = g.v.fxCount();
  sword(g, 1, 0, 500, 530);
  assert.deepEqual(hudOf(g, 3, 1)[0], [2, 'YOUR FLAG  DROPPED 0:20', C.YELLOW]);
  assert.deepEqual(newsOf(g, fxs(g.v, L.FX_MODE, L.CF_MX_DROP, from)[0], 3), { said: [['P1 DROPPED THE BLUE FLAG', C.RED]], shown: [['YOUR FLAG IS DOWN  RETURN IT', C.CYAN]] });
  for (let i = 0; i < 250; i++) g.step();
  assert.deepEqual(hudOf(g, 3, 1)[0], [2, 'YOUR FLAG  DROPPED 0:18', C.YELLOW]);
  // blue 3 returns it; red 2 takes it and captures
  from = g.v.fxCount();
  put(g, 3, 501, 530);
  g.step();
  assert.deepEqual(newsOf(g, fxs(g.v, L.FX_MODE, L.CF_MX_RETURN, from)[0], 3), { said: [['YOU RETURNED THE BLUE FLAG', C.CYAN]], shown: [['YOU RETURNED YOUR FLAG', C.CYAN]] });
  away(g, [3]);
  put(g, 2, STAND[1][0], STAND[1][2], FLOOR);
  g.step();
  put(g, 2, STAND[0][0], STAND[0][2], FLOOR);
  g.step();
  const cap = fxs(g.v, L.FX_MODE, L.CF_MX_CAP, from)[0];
  assert.deepEqual(newsOf(g, cap, 0), { said: [['P3 CAPTURED THE BLUE FLAG', C.RED]], shown: [['YOUR SIDE SCORES', C.RED]] });
  assert.deepEqual(newsOf(g, cap, 1), { said: [['P3 CAPTURED THE BLUE FLAG', C.RED]], shown: [['RED CAPTURED YOUR FLAG', C.RED]] });
  assert.deepEqual(newsOf(g, cap, 2).shown, [['YOU CAPTURED THE FLAG', C.YELLOW]]);
  assert.deepEqual(newsOf(g, { size: L.CF_MX_HOME, owner: 255, shot: 0, pos: STAND[0] }, 1).said, [['THE RED FLAG IS HOME', C.RED]]);
  // the board: captures and returns
  assert.deepEqual(ctf.cols.map((col) => col.head), ['CAPS', 'RETURNS']);
  assert.deepEqual([2, 3].map((p) => ctf.cols.map((col) => col.get(g.v.fighter(p)))), [['1', '0'], ['0', '1']]);
  assert.deepEqual(ctf.state(g.v).score, [1, 0]);
});

test('CTF\'s client draws both flags on their stands, one lying, one over its carrier (not over yours); waypoints TAKE, ESCORT, HOME, RETURN, KILL', async () => {
  const g = await room(L.M_CTF, 4);
  away(g, [0, 1, 2, 3]);
  const drawn = (out) => out.solid.filter((s) => s.kind === 7).map((s) => [round(s.pos), s.color.slice(0, 3)]);
  const marks = (out) => out.markers.map((m) => [m.label, m.color]);
  // both home: each on its stand (its middle 1.2 m up), a ring at each; TAKE on the other side's
  let out = drawOf(g, 0);
  assert.deepEqual(drawn(out), [[[392, 22.2, 512], SIDE_RGB[0]], [[632, 22.2, 512], SIDE_RGB[1]]]);
  assert.equal(out.glow.filter((x) => x.kind === 6).length, 2);
  assert.deepEqual(marks(out), [['TAKE', C.CYAN]]);
  assert.deepEqual(marks(drawOf(g, 1)), [['TAKE', C.RED]]);
  // red 0 carries blue's: over it for everyone else, not for itself; HOME for it, ESCORT for red 2, KILL for blue
  put(g, 0, STAND[1][0], STAND[1][2], FLOOR);
  g.step();
  put(g, 0, 500, 540);
  g.step();
  const at0 = fpos(g, 0);
  out = drawOf(g, 2);
  const over = out.solid.find((s) => s.kind === 7 && s.color[2] > 0.9);
  assert.ok(Math.abs(over.pos[0] - at0[0]) < 1e-3 && over.pos[1] > at0[1] + 1.5 && Math.abs(over.pos[2] - at0[2]) < 1e-3, 'over the carrier');
  assert.deepEqual([drawn(out).length, marks(out)], [2, [['ESCORT', C.RED]]]);
  assert.deepEqual([drawn(drawOf(g, 0)).length, marks(drawOf(g, 0))], [1, [['HOME', C.RED]]]);
  assert.deepEqual([drawn(drawOf(g, -1, 0)).length, marks(drawOf(g, -1, 0))], [1, [['HOME', C.RED]]], 'a spectator watching it: as it sees it');
  assert.deepEqual(marks(drawOf(g, -1)), [], 'a spectator watching nobody');
  assert.deepEqual(marks(drawOf(g, 1)), [['TAKE', C.RED], ['KILL', C.RED]]);
  // blue 1 takes red's: HOME  WAIT for red 0, and its HUD says so (each line within 26 cells, clear of the
  // shields and the score bar); blue 1 kills red 0, so blue's lies: RETURN for blue, TAKE for red
  put(g, 1, STAND[0][0], STAND[0][2], FLOOR);
  g.step();
  assert.deepEqual(marks(drawOf(g, 0)), [['HOME  WAIT', C.RED], ['KILL', C.CYAN]]);
  const lines = hudOf(g, 0, 0);
  assert.deepEqual(lines, [[2, 'YOUR FLAG  TAKEN BY P2', C.YELLOW], [3, 'THEIR FLAG  YOU HAVE IT', C.CYAN], [4, 'WAIT AT HOME FOR YOUR FLAG', C.WHITE]]);
  assert.ok([...lines, ...hudOf(g, 1, 1), ...hudOf(g, -1, -1)].every(([, t]) => t.length <= 26));
  sword(g, 1, 0, 500, 540);
  assert.deepEqual(marks(drawOf(g, 3)), [['ESCORT', C.CYAN], ['RETURN', C.CYAN]]);
  assert.deepEqual(marks(drawOf(g, 2)), [['TAKE', C.CYAN], ['KILL', C.CYAN]]);
  const lying = flag(g, 1).pos;
  assert.ok(drawn(drawOf(g, 2)).some(([p]) => Math.abs(p[0] - lying[0]) < 0.01 && Math.abs(p[1] - lying[1] - 1.2) < 0.01), 'where it lies');
  assert.equal(ctf.state(g.v).flags[1].state, DROPPED);
});

test('CTF\'s brain: a carrier runs home; defenders hold, return, chase; attackers run for theirs, fight near it, escort, and get their own back', async () => {
  const g = await room(L.M_CTF, 8); // red 0, 2, 4, 6 (4 defends: rank 2); blue 1, 3, 5, 7 (5 defends)
  away(g, [0, 1, 2, 3, 4, 5, 6, 7]);
  const brief = (o) => (o ? [round(o.pos), o.hurry, o.hold] : null);
  // both home: attackers run for the enemy's flag, and fight over its last 25 m; defenders hold their stand
  assert.deepEqual(brief(goalOf(g, 0)), [STAND[1], 1, false]);
  assert.deepEqual(brief(goalOf(g, 4)), [STAND[0], 0, true]);
  assert.deepEqual(brief(goalOf(g, 5)), [STAND[1], 0, true]);
  put(g, 2, 612, 512);
  assert.equal(goalOf(g, 2).hurry, 0.7, 'within 25 m');
  // red 0 takes blue's: home at a run; red 2 and 6 ride along beside it; blue's defender chases it
  put(g, 0, STAND[1][0], STAND[1][2], FLOOR);
  g.step();
  put(g, 0, 520, 540);
  g.step();
  assert.deepEqual(brief(goalOf(g, 0)), [STAND[0], 1, true]);
  for (const p of [2, 6]) {
    const o = goalOf(g, p);
    assert.ok(Math.hypot(o.pos[0] - 520, o.pos[2] - 540) < 3.01 && o.hurry < 0.9 && !o.hold, `P${p + 1} escorts`);
  }
  assert.notDeepEqual(goalOf(g, 2).pos, goalOf(g, 6).pos, 'spread round it');
  assert.deepEqual(brief(goalOf(g, 5)), [round(fpos(g, 0)), 0.7, false]);
  assert.deepEqual(brief(goalOf(g, 1)), [STAND[0], 1, false], 'blue goes for red\'s');
  // blue 1 takes red's: red's attackers turn to its carrier, and red's defender
  put(g, 1, STAND[0][0], STAND[0][2], FLOOR);
  g.step();
  put(g, 1, 600, 470);
  g.step();
  for (const p of [2, 4, 6]) assert.deepEqual(brief(goalOf(g, p)), [round(fpos(g, 1)), 0.7, false], `P${p + 1}`);
  // red's lies: whoever goes for it runs to it
  sword(g, 2, 1, 600, 470);
  for (const p of [4, 6]) assert.deepEqual(brief(goalOf(g, p)), [round(flag(g, 0).pos), 1, false], `P${p + 1}`);
  // nothing for a fighter with no side
  assert.equal(ctf.goal(g.v, { ...g.v.fighter(0), team: -1 }, { role: 'attack', rank: 0 }), null);
});
