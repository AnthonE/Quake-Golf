import test from 'node:test';
import assert from 'node:assert/strict';
import { arenaBytes } from './helpers.mjs';
import { View, arenaWord, arenaFrame, forcedSeed } from '../src/arena-view.mjs';
import { aimAt } from '../client/bot.mjs';
import { playArena } from '../tools/genarena.mjs';
import { replay, parseLog, decodeTrace, newMemory, instantiate, Sim } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import * as L from '../src/layout.mjs';

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

function put(g, p, x, z, y = g.v.height(x, z)) {
  g.dv.setFloat32(rec(p) + L.P_PX, x, true);
  g.dv.setFloat32(rec(p) + L.P_PY, y, true);
  g.dv.setFloat32(rec(p) + L.P_PZ, z, true);
  for (const o of [L.P_VX, L.P_VY, L.P_VZ]) g.dv.setFloat32(rec(p) + o, 0, true);
}

function loadout(g, p, w0, w1 = w0) {
  g.dv.setUint8(rec(p) + L.A_GUN, w0); g.dv.setUint8(rec(p) + L.A_GUN + 1, w1);
  g.dv.setUint8(rec(p) + L.A_MAG, L.ARMS[w0].mag); g.dv.setUint8(rec(p) + L.A_MAG + 1, L.ARMS[w1].mag);
  g.dv.setUint16(rec(p) + L.A_RES, L.ARMS[w0].res, true); g.dv.setUint16(rec(p) + L.A_RES + 2, L.ARMS[w1].res, true);
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

// p's melee at q, standing 2 m apart on open ground, q facing p (or away, behind = true).
function melee(g, p, q, { behind = false } = {}) {
  put(g, p, 500, 510); put(g, q, 502, 510);
  const bit = (g.v.fighter(p).act & L.AB_MELEE) ^ 1;
  g.step([[L.EV_INPUT, q, arenaWord({ yaw: behind ? 0 : 8192 })], [L.EV_INPUT, p, at(g, p, q, 1.0, { melee: bit })]]);
}

const fxs = (v, kind, size) => { const out = []; for (let k = 0; k < v.fxCount(); k++) { const f = v.fx(k); if (f.kind === kind && (size === undefined || f.size === size)) out.push(f); } return out; };
const zombies = (g) => Array.from({ length: g.n }, (_, p) => p).filter((p) => g.v.fighter(p).zombie);
const humans = (g) => Array.from({ length: g.n }, (_, p) => p).filter((p) => !g.v.fighter(p).zombie);
const endMatch = (g) => { g.dv.setUint32(L.HDR_UNTIL, g.v.tick + 1, true); for (let i = 0; i < 4; i++) g.step(); };

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

test('modes: a room plays the rotation from a Fiesta; a seed can force one mode every match', async () => {
  const g = await room(null, 2);
  for (let k = 0; k <= L.ARENA_MODES.length; k++) {
    const want = L.ARENA_MODES[k % L.ARENA_MODES.length];
    const h = g.v.hole();
    assert.deepEqual([h.hole, h.state, g.v.mode().mode], [k, L.H_PLAY, want], `match ${k}`);
    assert.equal(h.until - h.start, L.MODE_TICKS[want], `${L.MODES[want].name}'s clock`);
    if (k === 0) {
      // a Fiesta's region is what it was before modes: every mode field 0
      assert.ok(g.sim.u8.slice(L.AH_MODE, L.AH_WINNER + 4).every((b) => b === 0), 'the header');
      assert.ok(g.sim.u8.slice(L.MODE_REC, L.MODE_REC + L.NPLAYER * L.MR_SIZE).every((b) => b === 0), 'the records');
      assert.ok([0, 1].every((p) => !g.v.fighter(p).zombie && !g.v.fighter(p).jugg));
    }
    endMatch(g);
    assert.equal(g.v.hole().state, L.H_OVER);
    while (g.v.hole().state !== L.H_PLAY) g.step();
  }
  for (const m of [L.M_INFECTION, L.M_GUNGAME, L.M_JUGGERNAUT]) {
    const f = await room(m, 2, 99);
    assert.equal(f.v.mode().mode, m, `forced ${L.MODES[m].name}`);
    endMatch(f);
    while (f.v.hole().state !== L.H_PLAY) f.step();
    assert.deepEqual([f.v.hole().hole, f.v.mode().mode], [1, m], 'and the next match too');
  }
  assert.equal((await room(200, 2)).v.mode().mode, L.M_FIESTA, 'a mode past the list is a Fiesta');
});

test('Infection: one zombie for every ten at the countdown\'s end, with a sword and no shields; humans a shotgun, a magnum and two frags', async () => {
  for (const [n, want] of [[2, 1], [9, 1], [25, 2]]) {
    const g = await room(L.M_INFECTION, n);
    const z = zombies(g);
    assert.equal(z.length, want, `${n} fighters`);
    assert.equal(fxs(g.v, L.FX_MODE, L.MX_ZOMBIE).length, want);
    assert.deepEqual([g.v.mode().humans, g.v.mode().zombies], [n - want, want]);
    for (let p = 0; p < n; p++) {
      const f = g.v.fighter(p);
      if (f.zombie) assert.deepEqual([f.gun, f.sh, f.hp, f.grens, f.human], [[L.W_SWORD, L.W_SWORD], 0, 100, 0, 0], `zombie ${p}`);
      else assert.deepEqual([f.gun, f.mag, f.sh, f.grens], [[L.W_SHOTGUN, L.W_MAGNUM], [6, 8], 100, 2], `human ${p}`);
    }
  }
});

test('Infection: a human the sword kills comes back a zombie, an infection for its killer; a zombie\'s sword never runs out', async () => {
  const g = await room(L.M_INFECTION, 3);
  const [z] = zombies(g);
  const [a, b] = humans(g);
  for (let i = 0; i < L.SWAP_TICKS; i++) g.step();
  const before = g.v.tick - g.v.hole().start;
  melee(g, z, a);
  let f = g.v.fighter(a);
  assert.ok(f.dead && f.zombie, 'dead, and a zombie');
  assert.ok(Math.abs(f.human - before) <= 1, `human for ${f.human} ticks`);
  assert.equal(g.v.fighter(z).points, 1, 'an infection');
  const news = fxs(g.v, L.FX_MODE, L.MX_INFECT).at(-1);
  assert.deepEqual([news.owner, news.shot], [z, a]);
  assert.equal(g.v.fighter(z).grens, 0, 'no frag for a zombie\'s kill');
  assert.equal(f.respawn, L.ZRESPAWN_TICKS - 1, 'back in two seconds');
  for (let i = 0; i < L.ZRESPAWN_TICKS; i++) g.step();
  f = g.v.fighter(a);
  assert.deepEqual([f.dead, f.zombie, f.gun, f.sh, f.hp, f.grens], [false, true, [L.W_SWORD, L.W_SWORD], 0, 100, 0]);
  assert.deepEqual([g.v.mode().humans, g.v.mode().zombies], [1, 2]);
  // a dozen swings at nothing: the magazine stays full
  put(g, z, 500, 470);
  for (let i = 0; i < 12 * 72; i++) g.step([[L.EV_INPUT, z, arenaWord({ yaw: 0, shot: (i / 72 | 0) & 3 })]]);
  assert.ok(g.v.fighter(z).shots >= 12);
  assert.deepEqual(g.v.fighter(z).mag, [10, 10]);
  assert.equal(g.v.fighter(b).zombie, false);
  // with no shields to lose, a zombie takes a magnum's head shot as a hit, at half; a sniper's still kills
  put(g, b, 500, 510); put(g, z, 515, 510);
  for (let i = 0; i < L.SWAP_TICKS; i++) g.step([[L.EV_INPUT, b, at(g, b, z, 1.62, { slot: 1 })]]);
  fire(g, b, z, { h: 1.62, max: 1, rest: { slot: 1 } });
  assert.deepEqual([g.v.fighter(z).dead, g.v.fighter(z).hp], [false, 100 - L.ARMS[L.W_MAGNUM].dmg / 2]);
  assert.equal(fxs(g.v, L.FX_HIT).at(-1).size, 2, 'a hit, not a head shot');
  loadout(g, b, L.W_SNIPER);
  for (let i = 0; i < 30; i++) g.step([[L.EV_INPUT, b, at(g, b, z, 1.62, { slot: 1, shot: g.v.fighter(b).fired })]]);
  fire(g, b, z, { h: 1.62, max: 1, rest: { slot: 1 } });
  assert.ok(g.v.fighter(z).dead, 'the sniper');
});

test('Infection: neither side hurts its own: shotgun, magnum, frag, needles, sword', async () => {
  const g = await room(L.M_INFECTION, 4, 3);
  const [z] = zombies(g);
  const [a, b, c] = humans(g);
  for (let i = 0; i < L.SWAP_TICKS; i++) g.step();
  // the shotgun and the magnum at a human 3 m off
  put(g, a, 500, 510); put(g, b, 503, 510);
  assert.equal(fire(g, a, b, { max: 240 }), -1);
  g.step([[L.EV_INPUT, a, at(g, a, b, 1, { slot: 1 })]]);
  for (let i = 0; i < L.SWAP_TICKS; i++) g.step();
  assert.equal(fire(g, a, b, { max: 200, rest: { slot: 1 } }), -1);
  let hb = g.v.fighter(b);
  assert.deepEqual([hb.sh, hb.hp, hb.dead], [100, 100, false], 'not a scratch');
  assert.ok(g.v.fighter(a).shots >= 6, 'it fired');
  // needles: none stick, none home, no supercombine
  loadout(g, a, L.W_NEEDLER);
  put(g, a, 500, 510); put(g, b, 508, 510);
  fire(g, a, b, { max: 200, rest: { slot: 1 } });
  hb = g.v.fighter(b);
  assert.deepEqual([hb.sh, hb.hp, hb.needles], [100, 100, 0]);
  // a's frag about to go off at b's feet, a 2 m off: its thrower is hurt, its ally isn't
  put(g, a, 500, 510); put(g, b, 502, 510);
  const j = L.PROJ;
  g.dv.setFloat32(j + L.J_PX, 502, true); g.dv.setFloat32(j + L.J_PY, g.v.height(502, 510) + 0.12, true); g.dv.setFloat32(j + L.J_PZ, 510, true);
  for (const o of [L.J_VX, L.J_VY, L.J_VZ]) g.dv.setFloat32(j + o, 0, true);
  g.dv.setUint16(j + L.J_AGE, L.A_FUSE - 1, true); g.sim.u8[j + L.J_KIND] = L.K_GRENADE; g.sim.u8[j + L.J_OWNER] = a;
  g.step();
  assert.equal(g.sim.u8[j + L.J_KIND], 0, 'it went off');
  assert.ok(g.v.fighter(a).sh < 100, 'the thrower');
  hb = g.v.fighter(b);
  assert.deepEqual([hb.sh, hb.hp], [100, 100], 'its ally');
  // zombie on zombie: the sword and the lunge do nothing (the zombie back first, if a stray needle found it)
  while (g.v.fighter(z).dead) g.step();
  put(g, a, 470, 560); put(g, b, 470, 570);
  melee(g, z, c);
  assert.ok(g.v.fighter(c).dead, 'c is a zombie now');
  for (let i = 0; i < L.ZRESPAWN_TICKS + L.COOL_TICKS; i++) g.step();
  melee(g, z, c);
  const zc = g.v.fighter(c);
  assert.deepEqual([zc.dead, zc.hp], [false, 100], 'a zombie\'s sword on a zombie');
});

test('Infection: a zombie runs a quarter faster and jumps higher, and the prediction keeps up bit for bit', async () => {
  const g = await room(L.M_INFECTION, 2);
  const [z] = zombies(g);
  const [h] = humans(g);
  put(g, z, 470, 500); put(g, h, 470, 520);
  const run = arenaWord({ yaw: 0, move: 1 });
  for (let i = 0; i < 60; i++) g.step([[L.EV_INPUT, z, run], [L.EV_INPUT, h, run]]);
  const speed = (p) => Math.hypot(g.v.fighter(p).vel[0], g.v.fighter(p).vel[2]);
  assert.ok(Math.abs(speed(z) - 12.5) < 1e-3 && Math.abs(speed(h) - 10) < 1e-3, `${speed(z)} and ${speed(h)} m/s`);
  const peak = (p) => {
    put(g, p, 470, 500 + 20 * (p === h));
    g.step([[L.EV_INPUT, z, arenaWord({})], [L.EV_INPUT, h, arenaWord({})]]);
    const y0 = g.v.fighter(p).pos[1];
    let top = y0;
    for (let i = 0; i < 150; i++) { g.step([[L.EV_INPUT, p, arenaWord({ jump: i < 2 ? 1 : 0 })]]); top = Math.max(top, g.v.fighter(p).pos[1]); }
    return top - y0;
  };
  const [jz, jh] = [peak(z), peak(h)];
  assert.ok(jz > 1.8 && jz < 1.9 && jh > 1.2 && jh < 1.3, `jumps of ${jz} and ${jh} m`);
  // the zombie's own run, jumps, turns and swings, predicted from every tick
  put(g, z, 470, 500);
  const inputs = [];
  for (let k = 0; k < 300; k++) {
    inputs.push(arenaWord({ yaw: 30 * k, pitch: 512, move: k < 150 ? 1 : 9, jump: k % 60 === 10 ? 1 : 0, shot: (k >> 5) & 3, melee: (k >> 6) & 1,
      serial: (arenaFrame({ lag: 4 }) >> ((g.v.tick + k) & 7)) & 1 }));
  }
  assert.ok(predicted(g, z, inputs) > 300);
  assert.ok(g.v.fighter(z).shots > 4);
});

test('Infection: over when no human is left, or at the clock; places: survivors, then time as a human, then infections', async () => {
  // the last human falls: over on that tick
  const g = await room(L.M_INFECTION, 2);
  const [z] = zombies(g);
  const [h] = humans(g);
  for (let i = 0; i < 500; i++) g.step();
  melee(g, z, h);
  assert.ok(g.v.fighter(h).zombie);
  assert.equal(g.v.hole().state, L.H_OVER, 'no human left');
  assert.deepEqual([g.v.fighter(h).place, g.v.fighter(z).place], [1, 2], 'the longer human first');
  assert.ok(g.v.fighter(h).human >= 500);
  // the clock: z infects a, a infects b, c is left standing
  const r = await room(L.M_INFECTION, 4, 5);
  const [rz] = zombies(r);
  const [a, b, c] = humans(r);
  for (let i = 0; i < 200; i++) r.step();
  melee(r, rz, a);
  for (let i = 0; i < L.ZRESPAWN_TICKS + 200; i++) r.step();
  melee(r, a, b);
  assert.ok(r.v.fighter(b).zombie && !r.v.fighter(c).zombie);
  assert.equal(fxs(r.v, L.FX_MODE, L.MX_LAST).at(-1)?.owner, c, 'the last human');
  for (let i = 0; i < 100; i++) r.step();
  endMatch(r);
  assert.equal(r.v.hole().state, L.H_OVER);
  const f = [rz, a, b, c].map((p) => r.v.fighter(p));
  assert.deepEqual(f.map((x) => x.place), [4, 3, 2, 1]);
  assert.deepEqual(f.map((x) => x.points), [1, 1, 0, 0]);
  assert.ok(f[0].human === 0 && f[1].human > 0 && f[2].human > f[1].human && f[3].human > f[2].human, f.map((x) => x.human).join(' '));
  // two survivors share first
  const s = await room(L.M_INFECTION, 3, 8);
  endMatch(s);
  assert.deepEqual(humans(s).map((p) => s.v.fighter(p).place), [1, 1]);
  assert.equal(s.v.fighter(zombies(s)[0]).place, 3);
});

test('Infection: a join in play is a zombie; if the zombies all leave, another is drawn', async () => {
  const g = await room(L.M_INFECTION, 4);
  const [z] = zombies(g);
  g.step([[L.EV_JOIN, 9]]);
  assert.ok(g.v.fighter(9).zombie, 'the late one');
  assert.deepEqual(g.v.fighter(9).gun, [L.W_SWORD, L.W_SWORD]);
  g.step([[L.EV_LEAVE, z], [L.EV_LEAVE, 9]]);
  g.step();
  assert.equal(zombies(g).length, 1, 'a new one');
  assert.notEqual(zombies(g)[0], z);
  assert.equal(fxs(g.v, L.FX_MODE, L.MX_ZOMBIE).length, 2);
});

test('gun game: a kill moves the killer up a rung, its next gun full in its hands; a respawn hands out the rung\'s gun; an assassination moves its victim down', async () => {
  const g = await room(L.M_GUNGAME, 2);
  for (const p of [0, 1]) assert.deepEqual([g.v.fighter(p).gun, g.v.fighter(p).rung], [[L.W_AR, L.W_AR], 0]);
  put(g, 0, 500, 510); put(g, 1, 512, 510);
  assert.ok(fire(g, 0, 1) > 0);
  let a = g.v.fighter(0);
  assert.deepEqual([a.rung, a.gun, a.mag, a.res], [1, [L.W_BR, L.W_BR], [36, 36], [108, 108]]);
  assert.equal(a.refire, L.SWAP_TICKS);
  assert.deepEqual(fxs(g.v, L.FX_MODE, L.MX_RUNG).map((f) => [f.owner, f.shot]), [[0, 1]]);
  for (let i = 0; i < L.RESPAWN_TICKS; i++) g.step();
  assert.deepEqual(g.v.fighter(1).gun, [L.W_AR, L.W_AR], 'the victim stays on its rung');
  // up the ladder by kills: each rung's gun
  for (let r = 1; r < 5; r++) {
    g.dv.setUint8(L.MODE_REC + L.MR_RUNG, r);
    for (const p of [0, 1]) { g.dv.setUint8(rec(p) + L.P_FL, L.PF_LIVE | L.PF_DEAD); g.dv.setUint16(rec(p) + L.A_RESPAWN, 1, true); }
    g.step();
    assert.deepEqual(g.v.fighter(0).gun, [L.LADDER[r], L.LADDER[r]], `rung ${r}'s respawn`);
  }
  // the assassination: 1 on rung 3, butted from behind
  g.dv.setUint8(L.MODE_REC + L.MR_SIZE + L.MR_RUNG, 3);
  for (let i = 0; i < L.COOL_TICKS; i++) g.step();
  const r0 = g.v.fighter(0).rung;
  melee(g, 0, 1, { behind: true });
  assert.ok(g.v.fighter(1).dead);
  assert.equal(fxs(g.v, L.FX_KILL).at(-1).size, L.KILL_BEHIND);
  assert.deepEqual([g.v.fighter(1).rung, g.v.fighter(0).rung], [2, r0 + 1], 'down one, and up one for the killer');
  assert.deepEqual(fxs(g.v, L.FX_MODE, L.MX_DEMOTE).map((f) => [f.owner, f.shot]), [[1, 2]]);
  for (let i = 0; i < L.RESPAWN_TICKS; i++) g.step();
  assert.deepEqual(g.v.fighter(1).gun, [L.W_MAGNUM, L.W_MAGNUM], 'rung 2: the magnum');
});

test('gun game: on the sword, only a sword kill counts, and the first one wins at once', async () => {
  const g = await room(L.M_GUNGAME, 3);
  g.dv.setUint8(L.MODE_REC + L.MR_RUNG, L.LADDER.length - 1);
  loadout(g, 0, L.W_AR);
  put(g, 0, 500, 510); put(g, 1, 512, 510);
  assert.ok(fire(g, 0, 1) > 0, 'a rifle kill');
  assert.deepEqual([g.v.fighter(0).rung, g.v.hole().state], [L.LADDER.length - 1, L.H_PLAY], 'no further, no win');
  assert.equal(fxs(g.v, L.FX_MODE, L.MX_RUNG).filter((f) => f.owner === 0).length, 0);
  loadout(g, 0, L.W_SWORD);
  for (let i = 0; i < L.COOL_TICKS; i++) g.step();
  melee(g, 0, 2);
  assert.ok(g.v.fighter(2).dead);
  assert.equal(g.v.hole().state, L.H_OVER, 'over at once');
  assert.deepEqual([g.v.mode().winner, g.v.fighter(0).rung, g.v.fighter(0).place], [0, L.LADDER.length, 1]);
  assert.deepEqual(fxs(g.v, L.FX_MODE, L.MX_WIN).map((f) => f.owner), [0]);
});

test('gun game: the prediction matches the confirmed world bit for bit after a respawn on a new rung', async () => {
  const g = await room(L.M_GUNGAME, 2);
  g.dv.setUint8(L.MODE_REC + L.MR_SIZE + L.MR_RUNG, 1);
  g.dv.setUint8(rec(1) + L.P_FL, L.PF_LIVE | L.PF_DEAD);
  g.dv.setUint16(rec(1) + L.A_RESPAWN, 3, true);
  for (let i = 0; i < 4; i++) g.step();
  assert.deepEqual(g.v.fighter(1).gun, [L.W_BR, L.W_BR]);
  put(g, 1, 470, 500);
  const inputs = [];
  for (let k = 0; k < 400; k++) {
    inputs.push(arenaWord({ yaw: 20 * k, pitch: 500, move: k < 200 ? 1 : 8, jump: k === 90 ? 1 : 0, shot: (k >> 3) & 3, slot: k >= 250 && k < 330 ? 1 : 0,
      serial: (arenaFrame({ lag: 6, reload: k >= 340 }) >> ((g.v.tick + k) & 7)) & 1 }));
  }
  assert.ok(predicted(g, 1, inputs) > 400);
  assert.ok(g.v.fighter(1).shots > 9, `${g.v.fighter(1).shots} rounds of bursts`);
});

test('Juggernaut: one drawn at the start, with the sword and an overshield; its killer takes over; its kills are points, ten win', async () => {
  const g = await room(L.M_JUGGERNAUT, 3);
  const jugg = () => [0, 1, 2].filter((p) => g.v.fighter(p).jugg);
  const [j] = jugg();
  assert.equal(jugg().length, 1);
  assert.deepEqual([g.v.fighter(j).gun, g.v.fighter(j).sh, g.v.mode().leader], [[L.W_SWORD, L.W_SWORD], L.OVERSHIELD, j]);
  const [a, b] = [0, 1, 2].filter((p) => p !== j);
  // the others are one side: a can't hurt b
  loadout(g, a, L.W_SNIPER);
  put(g, a, 500, 510); put(g, b, 530, 510);
  fire(g, a, b, { max: 80, h: 1.62 });
  assert.equal(g.v.fighter(b).dead, false);
  // a kills the juggernaut and is it
  put(g, j, 530, 510);
  for (let i = 0; i < 80; i++) g.step();
  assert.ok(fire(g, a, j, { h: 1.62 }) > 0);
  assert.deepEqual(jugg(), [a]);
  assert.deepEqual([g.v.fighter(a).gun, g.v.fighter(a).sh, g.v.fighter(a).grens, g.v.mode().leader], [[L.W_SWORD, L.W_SWORD], L.OVERSHIELD, 0, a]);
  // points: the juggernaut's kills, ten to win
  g.dv.setUint16(L.MODE_REC + a * L.MR_SIZE + L.MR_POINTS, L.JUGG_POINTS - 1, true);
  for (let i = 0; i < L.COOL_TICKS; i++) g.step();
  melee(g, a, b);
  assert.ok(g.v.fighter(b).dead);
  assert.equal(g.v.hole().state, L.H_OVER);
  assert.deepEqual([g.v.fighter(a).points, g.v.mode().winner, g.v.fighter(a).place], [L.JUGG_POINTS, a, 1]);
  // a juggernaut that dies by its own hand: another is drawn from the living
  const r = await room(L.M_JUGGERNAUT, 3, 4);
  const [rj] = [0, 1, 2].filter((p) => r.v.fighter(p).jugg);
  const pos = r.v.fighter(rj).pos;
  const jb = L.PROJ;
  r.dv.setFloat32(jb + L.J_PX, pos[0], true); r.dv.setFloat32(jb + L.J_PY, pos[1] + 0.3, true); r.dv.setFloat32(jb + L.J_PZ, pos[2], true);
  r.dv.setUint16(jb + L.J_AGE, L.A_FUSE - 1, true); r.sim.u8[jb + L.J_KIND] = L.K_GRENADE; r.sim.u8[jb + L.J_OWNER] = rj;
  r.dv.setUint8(rec(rj) + L.A_SH, 0); r.dv.setUint8(rec(rj) + L.A_HP, 10);
  r.step();
  assert.ok(r.v.fighter(rj).dead && !r.v.fighter(rj).jugg, 'its own frag');
  const next = [0, 1, 2].filter((p) => r.v.fighter(p).jugg);
  assert.equal(next.length, 1);
  assert.notEqual(next[0], rj);
  assert.equal(r.v.mode().leader, next[0]);
});

test('a match of eight AI fighters in each mode: no trap on the debug build, the same hash on every tick on 1 and 4 threads', async () => {
  const [debug, bytes] = [arenaBytes(true), arenaBytes()];
  for (const m of [L.M_INFECTION, L.M_GUNGAME, L.M_JUGGERNAUT]) {
    const ticks = m === L.M_INFECTION ? 6000 : 4000;
    const { log, scores } = await playArena({ bytes: debug, seed: forcedSeed(m), bots: 8, ticks, leaveAt: 1000 });
    const name = L.MODES[m].name;
    if (m === L.M_INFECTION) assert.ok(scores.reduce((s, f) => s + f.points, 0) > 0, `${name}: infections`);
    if (m === L.M_GUNGAME) assert.ok(scores.reduce((s, f) => s + f.rung, 0) > 2, `${name}: rungs climbed`);
    if (m === L.M_JUGGERNAUT) assert.ok(scores.reduce((s, f) => s + f.points, 0) > 0, `${name}: points`);
    const parsed = parseLog(log);
    const a = await replay({ bytes, log: parsed, ticks, threads: 1, tag: `m${m}a` });
    const b = await replay({ bytes, log: parsed, ticks, threads: 4, tag: `m${m}b`, startWorkers });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes], name);
  }
});
