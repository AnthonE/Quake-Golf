import test from 'node:test';
import assert from 'node:assert/strict';
import { arenaBytes } from './helpers.mjs';
import { View, arenaWord, arenaFrame, forcedSeed } from '../src/arena-view.mjs';
import { aimAt } from '../client/bot.mjs';
import { playArena } from '../tools/genarena.mjs';
import { compileMap, half } from '../tools/map.mjs';
import { replay, parseLog, decodeTrace, newMemory, instantiate, Sim } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import * as L from '../src/layout.mjs';

// The teams core and Team Slayer (src/arena.wat's team modes, src/am/slayer.wat).
// Helpers as test/arena-modes.test.mjs has them; a fighter's side, carry and
// the team header read straight from memory.

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
const carry = (g, p) => (fl(g, p) & L.PF_CARRY) !== 0;
const setCarry = (g, p, on) => { g.sim.u8[rec(p) + L.P_FL] = on ? fl(g, p) | L.PF_CARRY : fl(g, p) & ~L.PF_CARRY; };
const u32 = (g, a) => g.dv.getUint32(a, true);
const scores = (g) => [u32(g, L.AH_SCORE), u32(g, L.AH_SCORE + 4)];
const teamN = (g) => [u32(g, L.AH_TEAMN), u32(g, L.AH_TEAMN + 4)];
const sides = (g, slots) => slots.map((p) => team(g, p));
const MAP = compileMap();
const teamed = (m) => ((1 << m) & L.TEAMED) !== 0;

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

// Ticks of p firing at q (a new press every tick) until `done`, or `max`; both held still.
function fire(g, p, q, { h = 1.0, max = 2000, rest = {}, done = () => g.v.fighter(q).dead } = {}) {
  let shot = g.v.fighter(p).fired;
  for (let i = 0; i < max; i++) {
    shot = (shot + 1) & 3;
    for (const s of [p, q]) put(g, s, g.v.fighter(s).pos[0], g.v.fighter(s).pos[2]);
    g.step([[L.EV_INPUT, p, at(g, p, q, h, { shot, ...rest })]]);
    if (done()) return i + 1;
  }
  return -1;
}

// A word that presses nothing new: the counters and bits as p last took them.
const still = (g, p) => { const f = g.v.fighter(p); return { shot: f.fired, melee: f.act & L.AB_MELEE, gren: (f.act >> 1) & 1 }; };

// p's melee at q, standing 2 m apart on open ground, q facing p (or away,
// behind = true) and pressing nothing; trigger: a press of the trigger instead.
function melee(g, p, q, { behind = false, trigger = false } = {}) {
  put(g, p, 500, 510); put(g, q, 502, 510);
  const w = still(g, p);
  const word = trigger ? { ...w, shot: (w.shot + 1) & 3 } : { ...w, melee: w.melee ^ 1 };
  g.step([[L.EV_INPUT, q, arenaWord({ yaw: behind ? 0 : 8192, ...still(g, q) })], [L.EV_INPUT, p, at(g, p, q, 1.0, word)]]);
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
// Slot p's frame sent over the next whole 8-tick window (a frame starts on a
// tick that's a multiple of 8), its word otherwise word(); then a tick of
// word() alone, so the word left standing sends no more.
function sendFrame(g, p, frame, word = () => arenaWord({})) {
  while (g.v.tick & 7) g.step([[L.EV_INPUT, p, word()]]);
  for (let i = 0; i < 8; i++) g.step([[L.EV_INPUT, p, (word() | (((frame >> (g.v.tick & 7)) & 1) << L.AW_SERIAL)) >>> 0]]);
  g.step([[L.EV_INPUT, p, word()]]);
}
const endMatch = (g) => { g.dv.setUint32(L.HDR_UNTIL, g.v.tick + 1, true); for (let i = 0; i < 4; i++) g.step(); };
const untilPlay = (g) => { while (g.v.hole().state !== L.H_PLAY) g.step(); g.step(); };

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

test('teams: dealt red, blue, red... in slot order as a match starts; a join goes to the side with fewer, red on a tie; AH_TEAMN counts them', async () => {
  const g = await room(L.M_SLAYER, 5);
  assert.deepEqual(sides(g, [0, 1, 2, 3, 4]), [0, 1, 0, 1, 0]);
  assert.deepEqual(teamN(g), [3, 2]);
  g.step([[L.EV_JOIN, 9]]);
  assert.equal(team(g, 9), 1, 'fewer on blue');
  g.step([[L.EV_JOIN, 10]]);
  assert.equal(team(g, 10), 0, 'a tie: red');
  // nobody is moved as others leave: two reds go, and the next join is red
  g.step([[L.EV_LEAVE, 0], [L.EV_LEAVE, 2]]);
  assert.deepEqual(sides(g, [1, 3, 4, 9, 10]), [1, 1, 0, 1, 0]);
  assert.deepEqual(teamN(g), [2, 3]);
  g.step([[L.EV_JOIN, 11]]);
  assert.equal(team(g, 11), 0);
  assert.deepEqual(teamN(g), [3, 3], 'counted on the tick');
  // the next match deals them all again, in slot order
  endMatch(g);
  assert.equal(g.v.hole().state, L.H_OVER);
  untilPlay(g);
  assert.deepEqual(sides(g, [1, 3, 4, 9, 10, 11]), [0, 1, 0, 1, 0, 1]);
  // the rotation: a Fiesta deals nobody (and AH_TEAMN stays 0); Team Slayer after it does
  const r = await room(null, 3);
  assert.equal(r.v.mode().mode, L.M_FIESTA);
  assert.deepEqual([sides(r, [0, 1, 2]), teamN(r)], [[0, 0, 0], [0, 0]]);
  endMatch(r);
  untilPlay(r);
  assert.equal(r.v.mode().mode, L.M_SLAYER);
  assert.deepEqual([sides(r, [0, 1, 2]), teamN(r)], [[0, 1, 0], [2, 1]]);
  // a room's first join picks the mode and is red
  const s = await room(L.M_CTF, 1);
  assert.deepEqual([team(s, 0), teamN(s)], [0, [1, 0]]);
});

test('every team mode on the kit: sides, its target set as play starts, red against blue to the clock, a draw at 0 to 0', async () => {
  const want = { [L.M_SLAYER]: L.TS_MIN, [L.M_CTF]: L.CF_CAPS, [L.M_ODDBALL]: L.OB_TARGET, [L.M_HILL]: L.HL_TARGET };
  for (const { mode } of L.AM) {
    const g = await room(mode, 3);
    const name = L.MODES[mode].name;
    assert.ok(teamed(mode) && (L.TEAM_MODES & (1 << mode)) && (L.PAD_MODES & (1 << mode)), name);
    assert.deepEqual([g.v.mode().mode, sides(g, [0, 1, 2]), u32(g, L.AH_TARGET)], [mode, [0, 1, 0], want[mode]], name);
    assert.equal(g.v.hole().until - g.v.hole().start, L.MODE_TICKS[mode]);
    const from = g.v.fxCount();
    endMatch(g);
    assert.deepEqual([g.v.hole().state, u32(g, L.AH_TEAMWIN)], [L.H_OVER, 3], `${name}: a draw`);
    assert.deepEqual(fxs(g.v, L.FX_MODE, L.MX_TEAMWIN, from).map((f) => [f.owner, f.shot]), [[0, 3]]);
    assert.deepEqual([0, 1, 2].map((p) => g.v.fighter(p).place), [1, 1, 1], 'nobody won, nobody scored');
  }
});

test('a Fiesta after a team match: its region exactly a Fiesta\'s (the mode header, the objective, the records, no pads, no sides, nothing carried)', async () => {
  const g = await room(null, 4);
  endMatch(g);
  untilPlay(g);
  assert.equal(g.v.mode().mode, L.M_SLAYER);
  // a team match leaves all of it dirty: scores, a target, sides, a carrier, the objective block, points, pads
  for (let i = 0; i < L.AO_SIZE; i += 4) g.dv.setUint32(L.AO + i, 0x9e3779b9 * (i + 1), true);
  for (let p = 0; p < 4; p++) g.dv.setUint16(L.MODE_REC + p * L.MR_SIZE + L.MR_POINTS, 7 + p, true);
  setCarry(g, 1, true);
  g.dv.setUint32(L.AH_SCORE, 12, true); g.dv.setUint32(L.AH_SCORE + 4, 9, true);
  assert.ok(g.v.pads().length === MAP.pads.length && sides(g, [0, 1, 2, 3]).includes(1));
  g.dv.setUint32(L.HDR_HOLE, L.ARENA_MODES.length - 1, true); // the next match is the rotation's Fiesta
  endMatch(g);
  assert.equal(u32(g, L.AH_TEAMWIN), 1);
  untilPlay(g);
  assert.equal(g.v.mode().mode, L.M_FIESTA);
  const zero = (a, b) => g.sim.u8.slice(a, b).every((x) => x === 0);
  assert.ok(zero(L.AH_MODE, L.AH_END), 'the header');
  assert.ok(zero(L.AO, L.AO + L.AO_SIZE), 'the objective');
  assert.ok(zero(L.MODE_REC, L.MODE_REC + L.NPLAYER * L.MR_SIZE), 'the records');
  if (L.FIESTA) assert.ok(zero(L.PAD, L.PAD + L.NPAD * L.PAD_SIZE), 'the pads');
  for (let p = 0; p < L.NPLAYER; p++) assert.equal(fl(g, p) & (L.PF_BLUE | L.PF_CARRY), 0, `P${p}`);
  // and stays so through play
  for (let i = 0; i < 200; i++) g.step();
  assert.ok(zero(L.AH_MODE, L.AH_END) && zero(L.AO, L.AO + L.AO_SIZE));
});

test('a team mode\'s loadout: an assault rifle out, a magnum on the back, two frags; the map\'s pads laid and picked up', async () => {
  const g = await room(L.M_SLAYER, 2);
  for (const p of [0, 1]) {
    const f = g.v.fighter(p);
    assert.deepEqual([f.gun, f.mag, f.res, f.grens, f.sh, f.hp], [[L.W_AR, L.W_MAGNUM], [32, 8], [192, 40], 2, 100, 100]);
  }
  const pads = g.v.pads();
  assert.deepEqual(pads.map((p) => [p.pos[0], p.pos[2], p.weapon]), MAP.pads.map((p) => [p.x, p.z, p.weapon]));
  // the rocket on its pad mid-field, with a use
  const rocket = pads.find((p) => p.weapon === L.W_ROCKET);
  put(g, 0, rocket.pos[0], rocket.pos[2], rocket.pos[1]);
  sendFrame(g, 0, arenaFrame({ use: 1 }));
  assert.equal(g.v.fighter(0).gun[0], L.W_ROCKET);
  assert.ok(g.v.pads().find((p) => p.k === rocket.k).wait > 0, 'gone for a while');
});

test('own halves: a team mode\'s fighter spawns only among the spawns nearer its own flag', async () => {
  const halves = MAP.spawns.map((s) => half(s.x, s.z, MAP.flags));
  assert.deepEqual([halves.filter((h) => h === 0).length, halves.filter((h) => h === 1).length], [14, 18]);
  const g = await room(L.M_SLAYER, 8, 11);
  const used = [new Set(), new Set()];
  for (let k = 0; k < 40; k++) {
    for (let p = 0; p < 8; p++) { g.dv.setUint8(rec(p) + L.P_FL, fl(g, p) | L.PF_DEAD); g.dv.setUint16(rec(p) + L.A_RESPAWN, 1, true); }
    g.step();
    for (let p = 0; p < 8; p++) {
      const f = g.v.fighter(p);
      const i = MAP.spawns.findIndex((s) => s.x === f.pos[0] && s.z === f.pos[2]);
      assert.ok(i >= 0 && !f.dead, `P${p} on a spawn point`);
      assert.equal(halves[i], team(g, p), `P${p} (${team(g, p) ? 'blue' : 'red'}) at spawn ${i}`);
      used[team(g, p)].add(i);
    }
  }
  assert.ok(used[0].size >= 6 && used[1].size >= 6, `${used[0].size} red spawns used, ${used[1].size} blue`);
});

test('no friendly fire for red or blue: bullets, the butt, an assassination, the sword and its lunge, frags, rockets, plasma, needles and the supercombine; the other side still hurts', async () => {
  const g = await room(L.M_SLAYER, 4, 3);
  const [a, b, c, d] = [0, 2, 1, 3]; // a and b red, c and d blue
  assert.deepEqual(sides(g, [a, b, c, d]), [0, 0, 1, 1]);
  for (let i = 0; i < L.SWAP_TICKS; i++) g.step();
  const unhurt = (p, what) => { const f = g.v.fighter(p); assert.deepEqual([f.sh, f.hp, f.dead], [100, 100, false], what); };
  put(g, c, 470, 560); put(g, d, 470, 570);
  // the rifle and the magnum at a teammate 3 m off; a sniper's head shot
  put(g, a, 500, 510); put(g, b, 503, 510);
  assert.equal(fire(g, a, b, { max: 120 }), -1);
  g.step([[L.EV_INPUT, a, at(g, a, b, 1, { slot: 1 })]]);
  for (let i = 0; i < L.SWAP_TICKS; i++) g.step();
  assert.equal(fire(g, a, b, { max: 100, rest: { slot: 1 } }), -1);
  loadout(g, a, L.W_SNIPER);
  assert.equal(fire(g, a, b, { h: 1.62, max: 160 }), -1);
  assert.ok(g.v.fighter(a).shots >= 12, 'it fired');
  unhurt(b, 'bullets');
  // the butt, from the front and from behind, and the sword: no hurt, no lunge
  for (const [w, behind] of [[L.W_AR, false], [L.W_AR, true], [L.W_SWORD, false]]) {
    loadout(g, a, w);
    for (let i = 0; i < L.COOL_TICKS; i++) g.step();
    const from = g.v.fxCount();
    melee(g, a, b, { behind });
    assert.equal(fxs(g.v, L.FX_MELEE, undefined, from).length, 1, 'a swing');
    assert.ok(Math.hypot(g.v.fighter(a).vel[0], g.v.fighter(a).vel[2]) < 1, 'no lunge');
    unhurt(b, `${L.ARMS[w].name}${behind ? ' from behind' : ''}`);
  }
  // a's frag at b's feet: the thrower hurt, its teammate not, the enemy beside them yes
  put(g, a, 500, 510); put(g, b, 502, 510); put(g, c, 503, 511);
  frag(g, a, 502, 510);
  g.step();
  assert.ok(g.v.fighter(a).sh < 100, 'the thrower');
  unhurt(b, 'a frag');
  assert.ok(g.v.fighter(c).sh < 100 || g.v.fighter(c).dead, 'the enemy');
  while (g.v.fighter(c).dead) g.step();
  put(g, c, 470, 560);
  // a rocket goes off on a teammate and a plasma bolt is spent on one (no blast past it), hurting nobody
  for (const w of [L.W_ROCKET, L.W_PLASMA]) {
    loadout(g, a, w);
    put(g, a, 500, 510); put(g, b, 508, 510);
    const from = g.v.fxCount();
    fire(g, a, b, { max: 150 });
    for (let i = 0; i < 40; i++) g.step();
    const mine = (kind) => fxs(g.v, kind, undefined, from).filter((f) => f.owner === a);
    const blasts = mine(L.FX_BLAST);
    assert.ok(mine(L.FX_SHOT).length >= 2, `${L.ARMS[w].name}: fired`);
    if (w === L.W_ROCKET) assert.ok(blasts.length >= 2 && blasts.every((f) => Math.hypot(f.pos[0] - 508, f.pos[2] - 510) < 1), 'on the teammate');
    else assert.equal(blasts.length, 0, 'every bolt spent on the teammate');
    unhurt(b, L.ARMS[w].name);
  }
  // needles: none home on a teammate, none stick, and six already in one don't make a seventh
  loadout(g, a, L.W_NEEDLER);
  put(g, a, 500, 510); put(g, b, 508, 510);
  g.dv.setUint8(rec(b) + L.A_NEEDLES, 6);
  const homing = () => { for (let j = 0; j < L.NPROJ; j++) { const o = L.PROJ + j * L.JSIZE; if (g.sim.u8[o + L.J_KIND] === L.K_NEEDLE && g.sim.u8[o + L.J_OWNER] === a) return g.sim.u8[o + L.J_HOME]; } return -1; };
  let seen = [];
  fire(g, a, b, { max: 100, done: () => { seen.push(homing()); return false; } });
  assert.ok(seen.includes(0) && !seen.includes(1), 'no homing on a teammate');
  unhurt(b, 'needles');
  assert.equal(g.v.fighter(b).needles, 6, 'none stuck');
  // the other side: needles home and stick, bullets kill
  put(g, b, 470, 580); put(g, c, 508, 510);
  seen = [];
  fire(g, a, c, { max: 60, done: () => { seen.push(homing()); return false; } });
  assert.ok(seen.includes(1), 'homing on an enemy');
  assert.ok(g.v.fighter(c).needles > 0 || g.v.fighter(c).dead, 'stuck');
  loadout(g, a, L.W_AR);
  while (g.v.fighter(c).dead) g.step();
  put(g, c, 508, 510);
  assert.ok(fire(g, a, c) > 0, 'an enemy dies');
});

test('carrying: no shot, no frag, no reload, no pickup; a click or a melee swings what it carries and kills; the prediction keeps up bit for bit', async () => {
  const g = await room(L.M_SLAYER, 3);
  const [p, q] = [0, 1]; // red carries, blue in front
  for (let i = 0; i < L.SWAP_TICKS; i++) g.step();
  setCarry(g, p, true);
  g.dv.setUint8(rec(p) + L.A_MAG, 20);
  // trigger presses at an enemy 15 m off: swings at the air, no shots, the magazine as it was
  put(g, p, 500, 510); put(g, q, 515, 510);
  let from = g.v.fxCount();
  const shots0 = g.v.fighter(p).shots;
  fire(g, p, q, { max: 3 * L.COOL_TICKS + 1 });
  let f = g.v.fighter(p);
  assert.deepEqual([fxs(g.v, L.FX_SHOT, undefined, from).length, fxs(g.v, L.FX_TRACER, undefined, from).length], [0, 0], 'no shot');
  assert.deepEqual(fxs(g.v, L.FX_MELEE, undefined, from).map((x) => x.size), [2, 2, 2, 2], 'a swing every cooldown, the carrier\'s');
  assert.deepEqual([f.shots - shots0, f.mag[0], f.burst, f.fired], [4, 20, 0, g.v.player(p).input >>> L.AW_SHOT & 3]);
  assert.equal(g.v.fighter(q).sh, 100);
  // a frag press, a reload asked for, a use on a pad: nothing
  for (let i = 0; i < L.COOL_TICKS; i++) g.step();
  const word = (rest = {}) => arenaWord({ ...still(g, p), ...rest });
  const grens = g.v.fighter(p).grens;
  g.step([[L.EV_INPUT, p, word({ gren: ((g.v.fighter(p).act >> 1) & 1) ^ 1 })]]);
  assert.deepEqual([g.v.fighter(p).grens, g.v.projectiles().length], [grens, 0], 'no frag');
  assert.equal((g.v.fighter(p).act >> 1) & 1, (g.v.player(p).input >> L.AW_GREN) & 1, 'its bit followed');
  const pad = g.v.pads().find((x) => x.weapon === L.W_ROCKET);
  put(g, p, pad.pos[0], pad.pos[2], pad.pos[1]);
  for (const ask of [{ reload: 1 }, { use: 1 }]) sendFrame(g, p, arenaFrame(ask), word);
  f = g.v.fighter(p);
  assert.deepEqual([f.reload, f.mag[0], f.gun[0]], [0, 20, L.W_AR], 'no reload, no rocket');
  assert.equal(g.v.pads().find((x) => x.k === pad.k).wait, 0, 'the pad left for someone else');
  // a melee swing kills from the front, and so does a click
  for (const trigger of [false, true]) {
    while (g.v.fighter(q).dead) g.step();
    for (let i = 0; i < L.COOL_TICKS; i++) g.step();
    from = g.v.fxCount();
    melee(g, p, q, { trigger });
    assert.ok(g.v.fighter(q).dead, trigger ? 'a click' : 'a melee');
    assert.deepEqual(fxs(g.v, L.FX_KILL, undefined, from).map((x) => [x.owner, x.shot, x.size]), [[p, q, L.KILL_CARRY]]);
    assert.ok(carry(g, p), 'still carrying');
  }
  // the carry ends: nothing was waiting, so the next shot is a new press
  setCarry(g, p, false);
  from = g.v.fxCount();
  for (let i = 0; i < 30; i++) g.step();
  assert.equal(fxs(g.v, L.FX_SHOT, undefined, from).length, 0);
  // a carrier who dies carries nothing after, nor after it respawns
  setCarry(g, p, true);
  while (g.v.fighter(q).dead) g.step();
  loadout(g, q, L.W_SWORD);
  for (let i = 0; i < L.COOL_TICKS; i++) g.step();
  melee(g, q, p);
  assert.ok(g.v.fighter(p).dead && !carry(g, p));
  setCarry(g, 2, true);
  g.dv.setUint8(rec(2) + L.P_FL, fl(g, 2) | L.PF_DEAD); g.dv.setUint16(rec(2) + L.A_RESPAWN, 1, true);
  g.step();
  assert.ok(!g.v.fighter(2).dead && !carry(g, 2), 'a respawn drops it');
  // the carrier's own runs, jumps, turns, clicks, swings, frag presses and frames, predicted from every tick
  while (g.v.fighter(p).dead) g.step();
  setCarry(g, p, true);
  put(g, p, 470, 500); put(g, q, 470, 540); put(g, 2, 600, 450);
  const inputs = [];
  for (let k = 0; k < 400; k++) {
    inputs.push(arenaWord({ yaw: 30 * k, pitch: 480, move: k < 150 ? 1 : k < 300 ? 9 : 2, jump: k % 60 === 10 ? 1 : 0, shot: (k >> 4) & 3, melee: (k >> 6) & 1,
      gren: (k >> 5) & 1, slot: k >= 200 && k < 260 ? 1 : 0, serial: (arenaFrame({ lag: 4, reload: k > 100 }) >> ((g.v.tick + k) & 7)) & 1 }));
  }
  const shots = g.v.fighter(p).shots;
  assert.ok(predicted(g, p, inputs) > 400);
  f = g.v.fighter(p);
  assert.ok(f.shots - shots >= 4, `${f.shots - shots} swings`);
  assert.deepEqual([f.grens, f.mag[0], f.reload, carry(g, p)], [2, L.ARMS[L.W_AR].mag, 0, true]);
});

test('Team Slayer: a kill of an enemy scores for the killer\'s side, a death by its own hand takes one off its own (never below 0); news as a side takes the lead', async () => {
  const g = await room(L.M_SLAYER, 4);
  const lead = (from) => fxs(g.v, L.FX_MODE, L.TS_MX_LEAD, from).map((f) => [f.owner, f.shot]);
  const swords = () => { for (const p of [0, 1, 2, 3]) loadout(g, p, L.W_SWORD); };
  swords();
  for (let i = 0; i < L.COOL_TICKS; i++) g.step();
  let from = g.v.fxCount();
  melee(g, 0, 1);
  assert.deepEqual([g.v.fighter(1).dead, scores(g)], [true, [1, 0]], 'red 1');
  assert.deepEqual(lead(from), [[0, 1]], 'red ahead');
  from = g.v.fxCount();
  suicide(g, 3);
  assert.deepEqual(scores(g), [1, 0], 'blue stays at 0');
  melee(g, 2, 0); // red on red does nothing
  assert.deepEqual([g.v.fighter(0).dead, scores(g)], [false, [1, 0]]);
  while (g.v.fighter(3).dead || g.v.fighter(1).dead) g.step();
  swords(); // a respawn brought rifles
  for (let i = 0; i < L.COOL_TICKS; i++) g.step();
  melee(g, 3, 0);
  assert.deepEqual(scores(g), [1, 1], 'level');
  assert.deepEqual(lead(from), [], 'no news for a tie');
  melee(g, 1, 2);
  assert.deepEqual(scores(g), [1, 2]);
  assert.deepEqual(lead(from), [[1, 2]], 'blue ahead');
  from = g.v.fxCount();
  while (g.v.fighter(0).dead) g.step();
  suicide(g, 0);
  assert.deepEqual(scores(g), [0, 2], 'red\'s own frag');
  assert.deepEqual(lead(from), []);
  // kills are each fighter's own, a suicide one off (none below 0): 0's taken back, 3's after its own
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.fighter(p).kills), [0, 1, 0, 1]);
});

test('Team Slayer: the target is TS_PER a fighter on the larger side, at least TS_MIN; over on the tick a side reaches it; at the clock the side ahead, or a draw; places and MX_TEAMWIN', async () => {
  assert.equal(u32(await room(L.M_SLAYER, 2), L.AH_TARGET), L.TS_MIN);
  const big = await room(L.M_SLAYER, 13);
  assert.deepEqual([teamN(big), u32(big, L.AH_TARGET)], [[7, 6], 7 * L.TS_PER]);
  // the target: blue reaches it on a kill
  const g = await room(L.M_SLAYER, 4);
  loadout(g, 1, L.W_SWORD);
  g.dv.setUint32(L.AH_SCORE + 4, L.TS_MIN - 1, true);
  g.dv.setUint32(L.AH_SCORE, 30, true);
  for (let i = 0; i < L.COOL_TICKS; i++) g.step();
  const kills = [3, 5, 6, 1];
  for (let p = 0; p < 4; p++) g.dv.setUint16(rec(p) + L.A_KILLS, kills[p], true);
  let from = g.v.fxCount();
  melee(g, 1, 0);
  assert.deepEqual([g.v.hole().state, scores(g), u32(g, L.AH_TEAMWIN)], [L.H_OVER, [30, L.TS_MIN], 2], 'over on its tick, blue\'s');
  assert.deepEqual(fxs(g.v, L.FX_MODE, L.MX_TEAMWIN, from).map((f) => f.shot), [2]);
  // blue (1 with 6 kills, 3 with 1) above red (2 with 6, 0 with 3)
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.fighter(p).place), [4, 1, 3, 2]);
  // the clock: red ahead
  const r = await room(L.M_SLAYER, 4);
  r.dv.setUint32(L.AH_SCORE, 12, true); r.dv.setUint32(L.AH_SCORE + 4, 11, true);
  [5, 7, 7, 7].forEach((k, p) => r.dv.setUint16(rec(p) + L.A_KILLS, k, true));
  from = r.v.fxCount();
  endMatch(r);
  assert.deepEqual([r.v.hole().state, u32(r, L.AH_TEAMWIN)], [L.H_OVER, 1]);
  assert.deepEqual(fxs(r.v, L.FX_MODE, L.MX_TEAMWIN, from).map((f) => f.shot), [1]);
  assert.deepEqual([0, 1, 2, 3].map((p) => r.v.fighter(p).place), [2, 3, 1, 3], 'red first; 1 and 3 share third');
  // a draw: by kills alone
  const s = await room(L.M_SLAYER, 4);
  s.dv.setUint32(L.AH_SCORE, 20, true); s.dv.setUint32(L.AH_SCORE + 4, 20, true);
  [5, 9, 7, 2].forEach((k, p) => s.dv.setUint16(rec(p) + L.A_KILLS, k, true));
  endMatch(s);
  assert.equal(u32(s, L.AH_TEAMWIN), 3);
  assert.deepEqual([0, 1, 2, 3].map((p) => s.v.fighter(p).place), [3, 1, 2, 4]);
  // the next match starts from zero
  untilPlay(s);
  assert.deepEqual([scores(s), u32(s, L.AH_TEAMWIN), u32(s, L.AH_TARGET)], [[0, 0], 0, L.TS_MIN]);
});

test('Team Slayer with eight AI fighters: no trap on the debug build, the same hash on every tick on 1 and 4 threads', async () => {
  const [debug, bytes] = [arenaBytes(true), arenaBytes()];
  const ticks = 5000;
  let last = null;
  const { log, scores: fighters } = await playArena({ bytes: debug, seed: forcedSeed(L.M_SLAYER), bots: 8, ticks, leaveAt: 1000,
    onTick: (t, v) => { last = { score: [v.dv.getUint32(L.AH_SCORE, true), v.dv.getUint32(L.AH_SCORE + 4, true)], n: [v.dv.getUint32(L.AH_TEAMN, true), v.dv.getUint32(L.AH_TEAMN + 4, true)] }; } });
  // (the bots take everyone for a teammate until their side is in the view: what this checks is the sim)
  assert.deepEqual(last.n, [4, 4]);
  assert.ok(fighters.every((f) => f.place === 0));
  const parsed = parseLog(log);
  const a = await replay({ bytes, log: parsed, ticks, threads: 1, tag: 'ts1' });
  const b = await replay({ bytes, log: parsed, ticks, threads: 4, tag: 'ts4', startWorkers });
  assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
});
