// DRUM ROLL (src/mg/drums.wat): the drums for the crowd, their spin and its
// reversals, the slots and when they open, a ball carried, held against the
// spin, dropped through a slot, off a side, an end, into a gap; the end; the
// prediction through all of it; rounds of AI balls; the client module.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty, partyBytes, predicted } from './helpers.mjs';
import { View, partyWord, PLAT_Y, B_RAD } from '../src/party-view.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { playParty } from '../tools/genparty.mjs';
import { Partier } from '../client/party-bot.mjs';
import * as L from '../src/layout.mjs';
import * as MC from '../src/mg/drums.mjs'; // DR_*: the minigame's own constants
import drums, { NAMES, stage, phiAt, angleAt, speedAt, zOf, drumOf, colOf, openAt, groundAt, nextFlip, flips, openCount, plan } from '../client/mg/drums.mjs';

const C = L.B_CX;
const TICK = 0.008;
const TAU = 2 * Math.PI;
const f = Math.fround;
const YA = PLAT_Y - MC.DR_R;
const MID = 89478485; // 2^-32 turn: half a slat, as $dr_under has a slat's middle

// A room of n balls on Drum Roll, on the debug build (a NaN traps), stepped into play unless asked not to.
async function room(n = 2, { play = true, seed = 7 } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_DRUMS + 1, true);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); assert.equal(sim.error().code, 0, 'no trap'); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  while (play && v.hole().state !== L.H_PLAY) step();
  return { sim, v, dv, step };
}
const rec = (p) => L.PLAYERS + p * L.PSIZE;
// Ball p at (x, z), its bottom on drum i's shell there (or at y), moving at (vx, vy, vz).
function put(g, p, x, z, { y = null, vx = 0, vy = 0, vz = 0, ground = true } = {}) {
  const s = stage(g.v);
  const dz = z - zOf(s, drumOf(s, z));
  g.dv.setFloat32(rec(p) + L.P_PX, x, true);
  g.dv.setFloat32(rec(p) + L.P_PY, y ?? YA + Math.sqrt(MC.DR_RC2 - dz * dz) - B_RAD, true);
  g.dv.setFloat32(rec(p) + L.P_PZ, z, true);
  g.dv.setFloat32(rec(p) + L.P_VX, vx, true);
  g.dv.setFloat32(rec(p) + L.P_VY, vy, true);
  g.dv.setFloat32(rec(p) + L.P_VZ, vz, true);
  g.dv.setUint8(rec(p) + L.P_FL, L.PF_LIVE | (ground ? L.PF_GROUND : 0));
}
// The next step plays tick t into play (the clock moved; the round's end with it).
function at(g, t) {
  const now = g.v.tick;
  g.dv.setUint32(L.HDR_START, now - t, true);
  g.dv.setUint32(L.HDR_UNTIL, now - t + MC.DR_LEN, true);
}
const playT = (g) => g.v.party().t; // the tick into play the next step plays
const fxs = (v, kind, from = 0) => { const out = []; for (let k = from; k < v.fxCount(); k++) { const x = v.fx(k); if (x.kind === kind) out.push(x); } return out; };
const word = (yaw, move = 1, hop = 0) => partyWord({ yaw: Math.round(yaw / TAU * 16384) & 16383, move, hop });
// A ball's centre's offset across from its drum's axis, and its height over the axes.
const across = (s, b) => b.pos[2] - zOf(s, drumOf(s, b.pos[2]));
// Where on drum i's shell (the ball's bottom on it) the world angle a (turns from the top toward +z) is.
const onShell = (s, i, a) => [zOf(s, i) + MC.DR_RC * Math.sin(a * TAU), YA + MC.DR_RC * Math.cos(a * TAU) - B_RAD];
// A slot (drum, cell along, slat) open by tick t0 whose middle comes over the top after it, with the
// slats either side along it there till then and 80 ticks on: [i, m, c, t] with t the tick it's at the top.
function slotOverTop(s, t0, { tmax = MC.DR_LEN } = {}) {
  for (let i = 0; i < s.K; i++) for (let m = 1; m < s.M - 1; m++) for (let c = 0; c < MC.DR_N; c++) {
    const o = openAt(s, i, m, c);
    if (o > t0) continue;
    for (let t = t0; t < tmax; t++) {
      let a = angleAt(s, i, t) + (c + 0.5) / MC.DR_N;
      a -= Math.round(a);
      if (Math.abs(a) > 0.004) continue;
      if (openAt(s, i, m - 1, c) > t + 80 && openAt(s, i, m + 1, c) > t + 80) return [i, m, c, t];
      break;
    }
  }
  return null;
}

test('the drums for 1, 8, 64 and 256: as many as the crowd needs, long enough for its share, the knobs; every ball on a top, apart, dealt evenly', async () => {
  let lastK = 0, lastM = 0;
  for (const n of [1, 8, 64, 256]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party();
    const s = stage(g.v);
    const K = Math.min(MC.DR_KMAX, 2 + Math.floor(Math.sqrt(n) / MC.DR_KN));
    const rows = Math.ceil(Math.ceil(n / K) / 2);
    const M = Math.max(MC.DR_MMIN, Math.min(MC.DR_MMAX, Math.ceil(((rows - 1) * MC.DR_SPX + 2 * MC.DR_ENDS) / MC.DR_SEG)));
    assert.deepEqual([r.game, s.K, s.M], [L.MG_DRUMS, K, M], `${n} balls`);
    assert.ok(K >= lastK && M >= lastM, 'more and longer for a crowd');
    lastK = K; lastM = M;
    assert.deepEqual([s.x0, s.x1, s.z0, s.ya], [C - M * MC.DR_SEG / 2, C + M * MC.DR_SEG / 2, f(C - f((K - 1) * f(MC.DR_P / 2))), YA]);
    assert.deepEqual([r.kind, r.len, r.floor, r.acc, r.drag, r.idle, r.hop], [L.PK_OUT, MC.DR_LEN, YA, f(MC.DR_ACC), f(MC.DR_DRAG), f(MC.DR_IDLE), f(MC.DR_HOP)]);
    assert.equal(r.size, Math.max(M * MC.DR_SEG / 2, f(f((K - 1) * f(MC.DR_P / 2)) + MC.DR_RC)));
    const per = new Array(K).fill(0);
    const pos = [];
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p);
      const i = drumOf(s, b.pos[2]), dz = across(s, b);
      per[i]++;
      assert.ok(b.ground && !b.out, `${n}: P${p + 1} on`);
      assert.ok(Math.abs(dz) <= MC.DR_SPZ + 1e-3, `${n}: P${p + 1} ${dz} across its top`);
      assert.ok(b.pos[0] >= s.x0 + MC.DR_ENDS - 1e-3 && b.pos[0] <= s.x1 - MC.DR_ENDS + 1e-3, `${n}: P${p + 1} clear of the ends`);
      assert.ok(Math.abs(b.pos[1] - (YA + Math.sqrt(MC.DR_RC2 - dz * dz) - B_RAD)) < 1e-4, `${n}: P${p + 1} on the shell`);
      assert.equal(groundAt(s, b.pos[0], b.pos[2], 0) > -999, true);
      for (const [x, z] of pos) assert.ok(Math.hypot(b.pos[0] - x, b.pos[2] - z) > 2 * B_RAD, `${n}: P${p + 1} apart`);
      pos.push([b.pos[0], b.pos[2]]);
    }
    assert.ok(Math.max(...per) - Math.min(...per) <= 1, `${n}: dealt evenly ${per}`);
  }
});

test('the spin: neighbours opposite, each drum its own speed growing DR_VK a phase, one reversing as each phase after the first begins; the angle carried on', async () => {
  for (const seed of [3, 4]) {
    const g = await room(20, { play: false, seed });
    const s = stage(g.v);
    assert.equal(s.K, 3);
    for (let i = 0; i + 1 < s.K; i++) assert.ok((s.rate[i * MC.DR_NPH] > 0) !== (s.rate[(i + 1) * MC.DR_NPH] > 0), 'neighbours opposite');
    for (let i = 0; i < s.K; i++) {
      const base = Math.abs(speedAt(s, i, 0));
      assert.ok(base >= MC.DR_V0 - 1e-3 && base <= MC.DR_V0 + MC.DR_VR + 1e-3, `drum ${i + 1} at ${base}`);
      for (let j = 0; j < MC.DR_NPH; j++) {
        const q = i * MC.DR_NPH + j;
        assert.ok(Math.abs(Math.abs(speedAt(s, i, j * MC.DR_PH)) - base * (1 + MC.DR_VK * j)) < 1e-3, 'faster a phase');
        if (j) assert.equal(s.ang[q], (s.ang[q - 1] + Math.imul(s.rate[q - 1], MC.DR_PH)) | 0, 'the angle carried on');
      }
    }
    for (let j = 1; j < MC.DR_NPH; j++) {
      let n = 0;
      for (let i = 0; i < s.K; i++) n += flips(s, i, j);
      assert.equal(n, 1, `one reverses as phase ${j} begins`);
    }
    for (let i = 0; i < s.K; i++) assert.ok(!flips(s, i, 0));
  }
  assert.deepEqual([MC.DR_FX_WARN, MC.DR_FX_FLIP, MC.DR_FX_FAST, MC.DR_FX_DROP], [0, 1, 2, 3].map((k) => L.FX_MG + 4 * L.MG_DRUMS + k));
  // the conversions: a surface at 1 m/s turns its drum DR_RT 2^-32 turn a tick, and DR_U back
  assert.ok(Math.abs(MC.DR_RT - 2 ** 32 * TICK / (TAU * MC.DR_R)) < 0.5);
  assert.ok(Math.abs(MC.DR_U * MC.DR_RT - 1) < 1e-6);
  assert.deepEqual([MC.DR_LO, MC.DR_HI], [Math.round(0.3 * 2 ** 32), Math.round(0.7 * 2 ** 32)]);
});

test('the slots: a share of the cells from DR_SLOT0 on, at an even rate, each opening only while its middle is round under its drum', async () => {
  for (const n of [2, 64]) {
    const g = await room(n, { play: false, seed: 11 + n });
    const s = stage(g.v);
    const ticks = [];
    for (let i = 0; i < s.K; i++) for (let m = 0; m < s.M; m++) for (let c = 0; c < MC.DR_N; c++) {
      const o = openAt(s, i, m, c);
      if (o === 0xffff) continue;
      assert.ok(o >= MC.DR_SLOT0, `opens at ${o}`);
      ticks.push(o);
      // its middle on that tick, as the sim works it out in i32: in DR_LO..DR_HI from the top
      const a = (phiAt(s, i, o) + Math.imul(2 * c + 1, MID)) >>> 0;
      assert.ok(a >= MC.DR_LO && a < MC.DR_HI, `drum ${i + 1} cell ${m},${c} opens ${(a / 2 ** 32).toFixed(3)} turn round`);
      // and not a tick sooner past its nominal tick: the tick before, it wasn't there yet (or it was the nominal one)
    }
    const all = s.K * s.M * MC.DR_N;
    assert.ok(ticks.length > all * (MC.DR_SLOTF - 0.08) && ticks.length < all * (MC.DR_SLOTF + 0.08), `${ticks.length} of ${all}`);
    // even: about half of them by the middle of the round
    const half = ticks.filter((t) => t < MC.DR_LEN / 2).length / ticks.length;
    assert.ok(half > 0.35 && half < 0.62, `${half.toFixed(2)} by half time`);
    assert.equal(openCount(s, MC.DR_SLOT0 - 1), 0);
  }
});

test('the schedule\'s moments as FX on time: a reversal seen DR_WARN ahead, the reversal, each phase', async () => {
  const g = await room(8, { seed: 5 });
  const s = stage(g.v);
  for (const j of [1, 2, 7]) {
    const i = [...Array(s.K).keys()].find((k) => flips(s, k, j));
    at(g, j * MC.DR_PH - MC.DR_WARN);
    let k0 = g.v.fxCount();
    g.step();
    const [w] = fxs(g.v, MC.DR_FX_WARN, k0);
    assert.deepEqual([w.owner, w.shot, w.pos[0], w.pos[1], w.pos[2], w.size], [255, i, C, PLAT_Y, f(zOf(s, i)), MC.DR_WARN]);
    assert.equal(fxs(g.v, MC.DR_FX_WARN, k0).length, 1, 'just the one');
    at(g, j * MC.DR_PH);
    k0 = g.v.fxCount();
    g.step();
    const [fl] = fxs(g.v, MC.DR_FX_FLIP, k0);
    assert.deepEqual([fl.shot, fl.size], [i, f(f(s.rate[i * MC.DR_NPH + j]) * f(MC.DR_U))]);
    assert.ok(Math.sign(fl.size) !== Math.sign(speedAt(s, i, j * MC.DR_PH - 1)), 'the other way');
    const [fa] = fxs(g.v, MC.DR_FX_FAST, k0);
    assert.equal(fa.shot, j);
    assert.ok(Math.abs(fa.size - Math.max(...[...Array(s.K).keys()].map((k) => Math.abs(speedAt(s, k, j * MC.DR_PH))))) < 1e-3);
    // and nothing on the ticks between
    at(g, j * MC.DR_PH + 7);
    k0 = g.v.fxCount();
    g.step();
    assert.equal(fxs(g.v, MC.DR_FX_WARN, k0).length + fxs(g.v, MC.DR_FX_FLIP, k0).length + fxs(g.v, MC.DR_FX_FAST, k0).length, 0);
  }
});

test('a drum carries a ball with no keys on: on at its surface\'s speed, to the side it turns to, off it and out; held against the spin it stays on top', async () => {
  for (const seed of [3, 8]) {
    const g = await room(2, { seed });
    const s = stage(g.v);
    at(g, 200);
    const u = speedAt(s, 0, 200);
    put(g, 0, C, zOf(s, 0));
    put(g, 1, C, zOf(s, 1));
    for (let k = 0; k < 60; k++) { g.step(); put(g, 1, C, zOf(s, 1)); }
    let b = g.v.partier(0);
    const dz = across(s, b), h = Math.sqrt(MC.DR_RC2 - dz * dz);
    assert.ok(b.ground, 'on it');
    assert.ok(Math.sign(dz) === Math.sign(u) && Math.abs(dz) > 0.5, `carried ${dz.toFixed(2)} m the way it turns (${u.toFixed(2)} m/s)`);
    assert.ok(Math.abs(b.vel[2] - u * h / MC.DR_RC) < 0.4, `at ${b.vel[2].toFixed(2)}, the surface at ${(u * h / MC.DR_RC).toFixed(2)}`);
    let k = 0;
    while (!b.falling && k++ < 800) { g.step(); put(g, 1, C, zOf(s, 1)); b = g.v.partier(0); }
    assert.ok(b.falling, 'off the side');
    assert.ok(Math.sign(across(s, b)) === Math.sign(u), 'the side it carried it to');
    // held against it: the keys upstream while it's downstream of a point a little upstream of the top, none else
    const g2 = await room(2, { seed });
    at(g2, 200);
    put(g2, 0, C, zOf(s, 0));
    put(g2, 1, C, zOf(s, 1));
    let worst = 0;
    for (let k2 = 0; k2 < 750; k2++) {
      const b2 = g2.v.partier(0), d = across(s, b2), uu = speedAt(s, 0, playT(g2));
      const push = (d + 0.6 * Math.sign(uu)) * Math.sign(uu) > 0;
      g2.step([[L.EV_INPUT, 0, word(uu > 0 ? -Math.PI / 2 : Math.PI / 2, push ? 1 : 0)]]);
      put(g2, 1, C, zOf(s, 1));
      worst = Math.max(worst, Math.abs(across(s, g2.v.partier(0))));
      assert.ok(g2.v.partier(0).ground && !g2.v.partier(0).falling, `on top ${k2}`);
    }
    assert.ok(worst < 2.5, `${worst.toFixed(2)} m from the top at most`);
  }
});

test('a slot coming over the top drops a ball on it through the drum (an FX, then out); the slats either side along it hold the ones there', async () => {
  for (const seed of [6, 9]) {
    const g = await room(3, { seed });
    const s = stage(g.v);
    const found = slotOverTop(s, 3000);
    assert.ok(found, 'a slot over the top');
    const [i, m, c, t1] = found;
    at(g, t1 - 1);
    const a = angleAt(s, i, t1 - 1) + (c + 0.5) / MC.DR_N;
    const [z, y] = onShell(s, i, a);
    const x = s.x0 + (m + 0.5) * MC.DR_SEG;
    // P1 on it; P2 and P3 the same way round on the cells either side, all of them still on the surface
    put(g, 0, x, z, { y });
    put(g, 1, x - MC.DR_SEG, z, { y });
    put(g, 2, x + MC.DR_SEG, z, { y });
    for (let p = 0; p < 3; p++) g.dv.setFloat32(rec(p) + L.P_VZ, speedAt(s, i, t1) * Math.cos(a * TAU), true);
    const k0 = g.v.fxCount();
    let drop = null;
    for (let k = 0; k < 60 && !drop; k++) {
      g.step();
      drop = fxs(g.v, MC.DR_FX_DROP, k0).find((e) => e.owner === 0);
      for (const p of [1, 2]) assert.ok(g.v.partier(p).ground, `P${p + 1} held, ${k}`);
    }
    assert.ok(drop, 'through the slot');
    assert.equal(drop.shot, i);
    const b = g.v.partier(0);
    assert.ok(b.falling && !b.ground, 'going out');
    assert.ok(Math.hypot(across(s, b), b.pos[1] + 1 - YA) < MC.DR_RC - MC.DR_IN + 0.05, 'into the drum');
    let k = 0;
    while (!g.v.partier(0).out && k++ < 400) g.step();
    const [sink] = fxs(g.v, L.FX_SINK, k0).filter((e) => e.owner === 0);
    assert.ok(sink, 'out');
    assert.equal(drums.sink(sink, (p) => `P${p + 1}`, g.v), 'P1 DROPPED THROUGH A SLOT');
  }
});

test('off the shell: past DR_ZS round, off an end, into a gap the ball falls and is out, held out of the shells on the way; inside DR_ZS it stands; a drop onto a top lands', async () => {
  const g = await room(3, { seed: 12 });
  const s = stage(g.v);
  at(g, 100);
  // just inside the support, either side: on
  put(g, 0, C, zOf(s, 0) + MC.DR_ZS - 0.05);
  put(g, 1, C, zOf(s, 1) - MC.DR_ZS + 0.05);
  put(g, 2, C - 3, zOf(s, 1));
  g.step();
  assert.ok(g.v.partier(0).ground && g.v.partier(1).ground);
  // past it, into the gap between: down it, never inside a shell, out
  const z0 = zOf(s, 0) + MC.DR_ZS + 0.05;
  put(g, 0, C, z0, { y: YA + Math.sqrt(MC.DR_RC2 - (MC.DR_ZS + 0.05) ** 2) - B_RAD });
  put(g, 1, C + 3.5, zOf(s, 1));
  put(g, 2, C - 3.5, zOf(s, 1));
  let k = 0, b;
  while (!(b = g.v.partier(0)).out && k++ < 400) {
    g.step();
    put(g, 1, C + 3.5, zOf(s, 1)); put(g, 2, C - 3.5, zOf(s, 1));
    b = g.v.partier(0);
    const dy = b.pos[1] + 1 - YA;
    if (dy > 0 && !b.out) for (const i of [0, 1]) assert.ok(Math.hypot(b.pos[2] - zOf(s, i), dy) >= MC.DR_RC - 1e-3, `out of drum ${i + 1}'s shell`);
  }
  assert.ok(b.out, 'out down the gap');
  assert.ok(b.pos[2] > zOf(s, 0) + MC.DR_R && b.pos[2] < zOf(s, 1) - MC.DR_R, 'between the two');
  // off an end
  const g2 = await room(3, { seed: 13 });
  at(g2, 100);
  put(g2, 0, s.x1 + 0.2, zOf(s, 0));
  put(g2, 1, C, zOf(s, 1));
  put(g2, 2, C - 3, zOf(s, 1));
  g2.step();
  assert.ok(!g2.v.partier(0).ground, 'off the end');
  k = 0;
  while (!g2.v.partier(0).out && k++ < 400) { g2.step(); put(g2, 1, C, zOf(s, 1)); put(g2, 2, C - 3, zOf(s, 1)); }
  assert.ok(g2.v.partier(0).out);
  // dropped onto a top from 3 m: lands on it
  put(g2, 1, C, zOf(s, 1) + 0.4, { y: PLAT_Y + 3, ground: false });
  k = 0;
  while (!g2.v.partier(1).ground && k++ < 200) { g2.step(); put(g2, 2, C - 3, zOf(s, 1)); }
  b = g2.v.partier(1);
  const dz = across(s, b);
  assert.ok(b.ground && Math.abs(b.pos[1] - (YA + Math.sqrt(MC.DR_RC2 - dz * dz) - B_RAD)) < 1e-3, 'landed on the shell');
});

test('the end: the last ball on wins; two dropping together share the win; one gone first is out in its place', async () => {
  let g = await room(2, { seed: 10 });
  let s = stage(g.v);
  at(g, 20);
  put(g, 0, s.x1 + 2, zOf(s, 0), { ground: false });
  let n = 0;
  while (g.v.party().state === L.H_PLAY && n++ < 500) { g.step(); put(g, 1, C, zOf(s, 1)); }
  assert.equal(g.v.party().state, L.H_OVER);
  assert.equal(g.v.party().winner, 1);
  assert.deepEqual([0, 1].map((p) => g.v.partier(p).place), [2, 1]);
  assert.deepEqual([0, 1].map((p) => g.v.partier(p).pts), [1, 10]);
  g = await room(3, { seed: 11 });
  s = stage(g.v);
  at(g, 20);
  put(g, 2, s.x1 + 2, zOf(s, 0), { ground: false });
  n = 0;
  while (!g.v.partier(2).out && n++ < 400) { g.step(); put(g, 0, C, zOf(s, 0)); put(g, 1, C, zOf(s, 1)); }
  put(g, 0, s.x0 - 2, zOf(s, 0), { ground: false });
  put(g, 1, s.x0 - 2, zOf(s, 1), { ground: false });
  n = 0;
  while (g.v.party().state === L.H_PLAY && n++ < 400) g.step();
  const r = g.v.party();
  assert.equal(r.state, L.H_OVER);
  assert.equal(r.winner, 255, 'shared');
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).place), [1, 1, 3]);
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).pts), [10, 10, 1]);
});

test('the prediction matches the confirmed ball bit for bit: carried off, held against the spin through a reversal, through a slot, a hop over one, across a gap, off a shell, roaming the fast end', async () => {
  // one ball alone, so nothing bumps it (bumps are the confirmed world's)
  const g = await room(1, { seed: 14 });
  const s = stage(g.v);
  const still = (k) => Array(k).fill(partyWord({}));
  // A: carried off the side, and falling a little (its out is the confirmed world's)
  at(g, 300);
  put(g, 0, C, zOf(s, 0));
  let k = 0;
  for (; k < 600 && !g.v.partier(0).falling; k += 20) assert.ok(predicted(g, still(20)) >= 20);
  assert.ok(g.v.partier(0).falling && k > 100, `carried off in ${k} ticks`);
  // B: held against the spin (keys on and off) across a reversal of its own drum
  const j = [...Array(MC.DR_NPH).keys()].find((jj) => jj > 1 && flips(s, 0, jj));
  at(g, j * MC.DR_PH - 200);
  put(g, 0, C, zOf(s, 0));
  const u0 = speedAt(s, 0, j * MC.DR_PH - 1);
  const hold = Array.from({ length: 400 }, (_, k) => word(((k < 200) === (u0 > 0)) ? -Math.PI / 2 : Math.PI / 2, (k >> 3) % 3 === 0 ? 0 : 1));
  assert.ok(predicted(g, hold) >= 400);
  // C: on a slot as it comes over the top
  const [i, m, c, t1] = slotOverTop(s, 5000);
  at(g, t1 - 1);
  const a = angleAt(s, i, t1 - 1) + (c + 0.5) / MC.DR_N;
  let [z, y] = onShell(s, i, a);
  put(g, 0, s.x0 + (m + 0.5) * MC.DR_SEG, z, { y, vz: speedAt(s, i, t1) * Math.cos(a * TAU) });
  assert.ok(predicted(g, still(120)) >= 120);
  assert.ok(g.v.partier(0).falling, 'through it');
  // D: the same slot, a hop over it as it comes
  at(g, t1 - 30);
  const a2 = angleAt(s, i, t1 - 30) + (c + 0.5) / MC.DR_N;
  [z, y] = onShell(s, i, a2);
  put(g, 0, s.x0 + (m + 0.5) * MC.DR_SEG, z - 1.2 * Math.sign(speedAt(s, i, t1)), { y });
  assert.ok(predicted(g, Array.from({ length: 160 }, (_, k) => word(speedAt(s, i, t1) > 0 ? -Math.PI / 2 : Math.PI / 2, 1, k === 22 ? 1 : 0))) >= 160);
  assert.ok(!g.v.partier(0).falling, 'over it');
  // E: across the gap to the next drum, flat out and a hop 3.1 m out (the tick for it from a dry run)
  const dry = await room(1, { seed: 14 });
  at(dry, 2000);
  put(dry, 0, C, zOf(s, 0));
  let hopAt = 0;
  while (across(s, dry.v.partier(0)) < 3.1 && hopAt < 300) { dry.step([[L.EV_INPUT, 0, word(Math.PI / 2)]]); hopAt++; }
  at(g, 2000);
  put(g, 0, C, zOf(s, 0));
  const across1 = Array.from({ length: hopAt + 150 }, (_, k) => word(Math.PI / 2, 1, k === hopAt ? 1 : 0));
  assert.ok(predicted(g, across1) >= hopAt + 150);
  assert.ok(g.v.partier(0).ground && drumOf(s, g.v.partier(0).pos[2]) === 1, 'on the next drum');
  // F: into the side of a shell from the gap, sliding down it
  at(g, 2600);
  put(g, 0, C, zOf(s, 0) + MC.DR_ZS + 0.3, { y: YA + 1, ground: false, vz: -6, vy: 2 });
  assert.ok(predicted(g, still(90)) >= 90);
  // G: the fast end, slots everywhere, rolling and hopping round its drum
  at(g, MC.DR_LEN - 1500);
  put(g, 0, C, zOf(s, 1));
  const words = Array.from({ length: 360 }, (_, k) => partyWord({ yaw: (k * 211) & 16383, move: (k >> 3) % 3 === 0 ? 0 : 1, hop: k % 37 === 0 ? 1 : 0 }));
  for (k = 0; k < words.length && !g.v.partier(0).falling; k += 30) assert.ok(predicted(g, words.slice(k, k + 30)) >= 1);
});

// A round of Partier balls steered by this minigame's brain (tools/genparty.mjs), recorded as a log.
async function aiRound(balls, ticks, seed) {
  let start = -1, over = -1, seen = 0, drops = 0, at20 = -1, moves = 0, places = null, pts = null, winner = -1;
  const on = new Int16Array(balls).fill(-1);
  const { log, sim } = await playParty({ bytes: partyBytes(true), seed, mg: L.MG_DRUMS, bots: balls, ticks, onTick: (t, s2, v) => {
    const g = v.party();
    for (; seen < v.fxCount(); seen++) drops += v.fx(seen).kind === MC.DR_FX_DROP;
    if (start < 0 && g.state === L.H_PLAY) start = t;
    if (start >= 0 && over < 0 && g.state === L.H_PLAY) {
      const s = stage(v);
      for (let p = 0; p < balls; p++) {
        const b = v.partier(p);
        if (!b.ground || b.out) continue;
        const i = drumOf(s, b.pos[2]);
        if (on[p] >= 0 && on[p] !== i) moves++;
        on[p] = i;
      }
    }
    if (start >= 0 && at20 < 0 && t - start >= 20 / TICK) at20 = g.left;
    if (start >= 0 && over < 0 && g.state === L.H_OVER) {
      over = t;
      winner = g.winner;
      places = [...Array(balls).keys()].map((p) => v.partier(p).place);
      pts = [...Array(balls).keys()].map((p) => v.partier(p).pts);
    }
  } });
  return { log, sim, start, over, drops, at20, moves, places, pts, winner };
}

for (const [balls, ticks, seed] of [[8, 13000, 21], [64, 13000, 22]]) {
  test(`a round of ${balls} AI balls on the debug build: no trap, most up 20 s in, some through slots, some across to another drum, a winner or the clock; equal on 1 and 4 threads`, async () => {
    const r = await aiRound(balls, ticks, seed);
    assert.equal(r.sim.error().code, 0);
    assert.ok(r.over > 0, 'the round ended');
    const secs = (r.over - r.start) * TICK;
    assert.ok(secs > 30 && secs <= MC.DR_LEN * TICK + 0.01, `${secs.toFixed(1)} s of play`);
    assert.ok(r.at20 >= balls * 0.6, `${r.at20} of ${balls} still on 20 s in`);
    assert.ok(r.drops >= balls / 4, `${r.drops} through slots`);
    assert.ok(r.moves >= balls / 4, `${r.moves} times across to another drum`);
    assert.ok(r.places.every((x) => x >= 1 && x <= balls), `places ${r.places}`);
    assert.ok(r.places.includes(1) && r.pts.includes(10), 'somebody won');
    assert.ok(r.places.filter((x) => x === 1).length <= 3, 'won by few');
    const parsed = parseLog(r.log);
    const n = r.over + 50;
    const a = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 1, tag: 't1' });
    const b = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 4, tag: 't4', startWorkers });
    const d = await replay({ bytes: partyBytes(true), log: parsed, ticks: n, threads: 1, tag: 'd1' });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(d.trace).tickHashes], 'the debug build steps the same bits');
  });
}

test('the client module: draws the drums with their slots as holes, frames the row, writes its HUD lines; its brain sees the gaps, the ends and the slots, and the AI ball alone stays on', async () => {
  const { Scene } = await import('../client/party-render.mjs');
  const g = await room(64, { seed: 41 });
  const s = stage(g.v);
  const out = { scene: new Scene(24000), solid: [], glow: [], beams: [], decals: [], casters: [], paint: null };
  const lines = [];
  const hctx = { put: (x, y, str, c) => lines.push([y, str, c]), centre: (y, str, c) => lines.push([y, str, c]), right: (y, str, c) => lines.push([y, str, c]), rows: 44, C: {}, slot: 0, now: 0 };
  let last = Infinity;
  for (const t of [10, 600, 3000, 6000, 9000, MC.DR_LEN - 10]) {
    at(g, t);
    g.step();
    for (let p = 0; p < 64; p++) put(g, p, C + (p % 8) - 4, zOf(s, p % s.K));
    out.scene.clear(); lines.length = 0;
    const me = g.v.partier(0);
    drums.draw(g.v, { tick: g.v.tick, ptick: g.v.tick, dt: 0, now: 1000, slot: 0, me, pme: me }, out);
    const n = out.scene.count;
    const open = openCount(s, t + 1);
    // every drum's slats (one box a run of cells), rims, spokes, axle, core and stands; more boxes as more cells open
    assert.ok(n >= s.K * (MC.DR_N * 3 + 8 + 2 + 6) && n < 24000, `${n} solids at ${t}`);
    for (let k = 0; k < n * 16; k++) assert.ok(Number.isFinite(out.scene.data[k]), 'finite');
    drums.hud(g.v, { ...hctx, me, t: (t + 1) * TICK });
    for (const l of lines) assert.ok(l[1].length <= 46, l[1]);
    const text = lines.map((l) => l[1]).join(' | ');
    assert.ok(text.includes(`${s.K} DRUMS`) && text.includes(`${open} SLOTS OPEN`), text);
    assert.ok(text.includes(`THE ${NAMES[drumOf(s, me.pos[2])]} DRUM `), text);
    if (t > 600) assert.ok(open >= last || last === Infinity);
    last = open;
    const fr = drums.frame(g.v);
    assert.equal(fr.shape, 'square');
    assert.equal(fr.radius, s.size + 1);
  }
  assert.ok(drums.hint.length <= 70 && drums.rules.length <= 76);
  // danger: a gap, past an end, a slot, the top
  const T = g.v.party().start;
  assert.equal(drums.brain.danger(g.v, C, (zOf(s, 0) + zOf(s, 1)) / 2, T + 100), 1, 'the gap');
  assert.equal(drums.brain.danger(g.v, s.x1 + 0.5, zOf(s, 0), T + 100), 1, 'past the end');
  assert.equal(drums.brain.danger(g.v, C, zOf(s, 0), T + 100), 0, 'the top');
  const [i, m, c, t1] = slotOverTop(s, 4000);
  const [zs] = onShell(s, i, angleAt(s, i, t1) + (c + 0.5) / MC.DR_N);
  assert.equal(drums.brain.danger(g.v, s.x0 + (m + 0.5) * MC.DR_SEG, zs, T + t1), 1, 'the slot at the top');
  // the AI ball (client/party-bot.mjs, its words landing 8 ticks late) alone late in the round for 12 s: on all the while
  const g3 = await room(1, { seed: 43 });
  at(g3, 6500);
  const s3 = stage(g3.v);
  put(g3, 0, C, zOf(s3, 0));
  const ai = new Partier(0, 5, 1);
  const late = [];
  let hops = 0, lastW = 0, cols = new Set();
  for (let k = 0; k < 1500; k++) {
    late.push(ai.think(g3.v, g3.v.tick + 8, 8));
    const w = late.length > 8 ? late.shift() : partyWord({});
    if ((w >>> 28) & 1 && !((lastW >>> 28) & 1)) hops++;
    lastW = w;
    g3.step([[L.EV_INPUT, 0, w]]);
    const b = g3.v.partier(0);
    if (b.ground) cols.add(drumOf(s3, b.pos[2]) * 100 + colOf(s3, b.pos[0]));
  }
  assert.ok(!g3.v.partier(0).out && !g3.v.partier(0).falling, `on after 12 s (${openCount(s3, playT(g3))} slots open, ${hops} hops)`);
  assert.ok(cols.size >= 2, `it moved about: ${[...cols]}`);
  // and plan(), what it steers by, is the brain's word
  assert.ok(plan(g3.v, g3.v.partier(0), ai, g3.v.tick + 8) !== null);
  assert.ok(nextFlip(s3, 0, 0) > 0);
});
