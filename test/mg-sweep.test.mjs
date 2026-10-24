import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty, partyBytes, predicted } from './helpers.mjs';
import { View, partyWord, PLAT_Y, seed as pseed } from '../src/party-view.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { playParty } from '../tools/genparty.mjs';
import { Partier } from '../client/party-bot.mjs';
import * as L from '../src/layout.mjs';
import sweep, { angleAt, dropsAt, rimOf, rimAt, solidAt, barsAt, stage, spinAt, touches, nextBar, AIR } from '../client/mg/sweep.mjs';

const C = L.B_CX;
const TICK = 0.008;
const f = Math.fround;
const TAU = 2 * Math.PI;

// A room of n balls on Sweeper, on the debug build (a NaN traps).
async function room(n = 2, { play = true, seed = 7 } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_SWEEP + 1, true);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); assert.equal(sim.error().code, 0, 'no trap'); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  while (play && v.hole().state !== L.H_PLAY) step();
  return { sim, v, dv, step };
}
const rec = (p) => L.PLAYERS + p * L.PSIZE;
// Ball p at (x, z) on the floor (or y), rolling at (vx, vz).
function put(g, p, x, z, { y = PLAT_Y, vx = 0, vz = 0, ground = true } = {}) {
  g.dv.setFloat32(rec(p) + L.P_PX, x, true);
  g.dv.setFloat32(rec(p) + L.P_PY, y, true);
  g.dv.setFloat32(rec(p) + L.P_PZ, z, true);
  g.dv.setFloat32(rec(p) + L.P_VX, vx, true);
  g.dv.setFloat32(rec(p) + L.P_VY, 0, true);
  g.dv.setFloat32(rec(p) + L.P_VZ, vz, true);
  g.dv.setUint8(rec(p) + L.P_FL, L.PF_LIVE | (ground ? L.PF_GROUND : 0));
}
// The next step plays tick t into play (the clock moved; the round's end with it).
function at(g, t) {
  const now = g.v.tick;
  g.dv.setUint32(L.HDR_START, now - t, true);
  g.dv.setUint32(L.HDR_UNTIL, now - t + L.SW_LEN, true);
}
const playT = (g) => g.v.party().t; // the tick into play the next step plays
// Bar k's bearing (radians) on tick t, and the point rho out along a bearing.
const bar = (st, k, t) => (angleAt(st.a0, st.dir, t) >>> 0) / 2 ** 24 * TAU + L.SW_QUARTER[k] * Math.PI / 2;
const on = (st, a, rho) => [f(st.cx + Math.cos(a) * rho), f(st.cx + Math.sin(a) * rho)];
// How fast the bars turn into tick t as the sim works it out in f32, rad/s.
const spin32 = (st, t) => f(f((angleAt(st.a0, st.dir, t) - angleAt(st.a0, st.dir, t - 1)) | 0) * f(L.SW_RAD_TICK));
// Which way the bars turn into tick t: +1 x towards z, -1 back, 0 still.
const way = (st, t) => Math.sign(spinAt(st, t));
const fxs = (v, kind, from = 0) => { const out = []; for (let k = from; k < v.fxCount(); k++) { const x = v.fx(k); if (x.kind === kind) out.push(x); } return out; };
// The ball's velocity along bearing a (radial) and across it (+ x towards z).
const split = (vel, a) => [vel[0] * Math.cos(a) + vel[2] * Math.sin(a), vel[2] * Math.cos(a) - vel[0] * Math.sin(a)];

test('the stage for 1, 8, 64 and 256: a platform sized for the crowd, its knobs and seed, every ball on it between the post and the rim, apart', async () => {
  let last = 0;
  for (const n of [1, 8, 64, 256]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party();
    const rad = Math.min(L.SW_R0 + L.SW_RK * Math.sqrt(n), L.SW_RMAX);
    assert.equal(r.game, L.MG_SWEEP);
    assert.ok(Math.abs(r.size - rad) < 1e-4, `${r.size} m for ${n}`);
    assert.ok(r.size >= last, 'grows with the crowd');
    last = r.size;
    assert.deepEqual([r.kind, r.len, r.floor, r.hop, r.idle, r.drag], [L.PK_OUT, L.SW_LEN, PLAT_Y, L.SW_HOP, f(L.SW_IDLE), f(Number(L.BPHYS.B_DRAG))]);
    const st = stage(g.v);
    assert.equal(st.r0, r.size);
    const h = pseed(g.v, L.SW_KSEED);
    assert.equal(st.a0, h & 0xffffff, 'the first bar\'s angle from the round\'s seed');
    assert.equal(st.dir, h >>> 31 ? -1 : 1);
    const pos = [];
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p);
      assert.ok(b.ground && !b.out && b.pos[1] === PLAT_Y, 'on the floor');
      const rho = Math.hypot(b.pos[0] - C, b.pos[2] - C);
      assert.ok(rho >= L.SW_POST + L.SW_SPAWN0 - 1e-3 && rho <= r.size * L.SW_SPAWN1 + 1e-3, `${n}: P${p + 1} ${rho.toFixed(2)} m out`);
      for (const [x, z] of pos) assert.ok(Math.hypot(b.pos[0] - x, b.pos[2] - z) >= 2, `${n}: P${p + 1} apart`);
      const [along, across] = split([b.pos[0] - C, 0, b.pos[2] - C], bar(st, 0, 0));
      assert.ok(along < 0 || Math.abs(across) >= L.SW_CLEAR - 0.05, `${n}: P${p + 1} clear of the bar (${across.toFixed(2)} m across)`);
      pos.push([b.pos[0], b.pos[2]]);
    }
  }
});

test('the schedule: still for the grace, one bar turning faster and faster, a bar more at each of SW_TS after a pause, the other way each time', () => {
  const st = { a0: 0x123456, dir: 1, r0: f(30), cx: C };
  for (let t = 0; t < L.SW_GRACE; t++) assert.equal(angleAt(st.a0, st.dir, t), st.a0, 'still in the grace');
  // the speed a tick: SW_S0 plus SW_SK a tick since the start, while turning
  let dir = 1, moving = 0;
  for (let t = 1; t < 12000; t++) {
    const d = (angleAt(st.a0, st.dir, t) - angleAt(st.a0, st.dir, t - 1)) | 0;
    const still = t <= L.SW_GRACE || L.SW_TS.some((tk) => t > tk && t <= tk + L.SW_PAUSE);
    if (still) { assert.equal(d, 0, `still into ${t}`); continue; }
    if (L.SW_TS.includes(t - 1 - L.SW_PAUSE)) dir = -dir;
    assert.equal(d, dir * (L.SW_S0 + L.SW_SK * (t - 1)), `into tick ${t}`);
    moving++;
  }
  assert.ok(moving > 11000);
  assert.deepEqual([0, L.SW_TS[0], L.SW_TS[0] + 1, L.SW_TS[1] + 1, L.SW_TS[2] + 1, 15000].map(barsAt), [1, 1, 2, 3, 4, 4]);
  // a new bar is solid from its first still tick
  assert.ok(solidAt(0, 0) && !solidAt(1, L.SW_TS[0]) && solidAt(1, L.SW_TS[0] + 1) && !solidAt(3, L.SW_TS[2]) && solidAt(3, L.SW_TS[2] + 1));
  // rad/s at the start and two minutes in
  assert.ok(Math.abs(L.SW_S0 * L.SW_RAD_TICK - 0.8) < 1e-3);
  assert.ok(Math.abs(spinAt(st, 15000)) > 2 && Math.abs(spinAt(st, 15000)) < 2.4, `${spinAt(st, 15000)} rad/s at the end`);
  // the rim: in SW_RINGS steps from SW_TR0, every SW_TRI, to SW_RMIN
  assert.deepEqual([0, L.SW_TR0 - 1, L.SW_TR0, L.SW_TR0 + L.SW_TRI - 1, L.SW_TR0 + L.SW_TRI, L.SW_TR0 + 4 * L.SW_TRI, 15000].map(dropsAt), [0, 0, 1, 1, 2, 5, 5]);
  assert.equal(rimOf(st.r0, 0), st.r0);
  assert.equal(rimOf(st.r0, L.SW_RINGS), L.SW_RMIN);
  for (let k = 1; k <= L.SW_RINGS; k++) assert.ok(rimOf(st.r0, k) < rimOf(st.r0, k - 1));
  assert.ok((L.SW_TR0 + (L.SW_RINGS - 1) * L.SW_TRI) < L.SW_LEN - 2000, 'the last ring well before the clock');
  assert.equal(L.SW_FX_HIT, L.FX_MG + 4 * L.MG_SWEEP);
  assert.deepEqual([L.SW_FX_BEAM, L.SW_FX_GO, L.SW_FX_RING], [L.SW_FX_HIT + 1, L.SW_FX_HIT + 2, L.SW_FX_HIT + 3]);
});

test('the schedule\'s moments as FX on time: the bars setting off, a bar coming, a ring shaking and going', async () => {
  const g = await room(2, { seed: 5 });
  const st = stage(g.v);
  const seen = (t) => { at(g, t); const k = g.v.fxCount(); g.step(); return [L.SW_FX_GO, L.SW_FX_BEAM, L.SW_FX_RING].flatMap((kind) => fxs(g.v, kind, k)); };
  let [x] = seen(L.SW_GRACE);
  assert.deepEqual([x.kind, x.owner, x.shot, x.pos[0], x.pos[1], x.pos[2]], [L.SW_FX_GO, 255, 1, C, PLAT_Y, C]);
  assert.equal(x.size, spin32(st, L.SW_GRACE + 1));
  for (let k = 0; k < 3; k++) {
    [x] = seen(L.SW_TS[k] - L.SW_WARN);
    assert.deepEqual([x.kind, x.shot, x.size], [L.SW_FX_BEAM, k + 1, L.SW_WARN + L.SW_PAUSE]);
    [x] = seen(L.SW_TS[k] + L.SW_PAUSE);
    assert.deepEqual([x.kind, x.shot], [L.SW_FX_GO, (k + 2) | 16]);
    assert.equal(Math.sign(x.size), -way(st, L.SW_TS[k]), 'the other way');
    assert.equal(x.size, spin32(st, L.SW_TS[k] + L.SW_PAUSE + 1));
  }
  for (let j = 0; j < L.SW_RINGS; j++) {
    const tj = L.SW_TR0 + j * L.SW_TRI;
    [x] = seen(tj - L.SW_RWARN);
    assert.deepEqual([x.kind, x.shot, x.size], [L.SW_FX_RING, 0, rimOf(st.r0, j + 1)]);
    [x] = seen(tj);
    assert.deepEqual([x.kind, x.shot, x.size], [L.SW_FX_RING, 1, rimOf(st.r0, j + 1)]);
  }
  assert.equal(seen(1000).length, 0, 'and nothing between');
});

test('a bar meeting a ball on the floor flings it on round the way the bar turns, out and up, on the tick it touches; PG_M counts it', async () => {
  const g = await room(3, { seed: 3 });
  const st = stage(g.v);
  const t0 = 1500, rho = 8;
  at(g, t0);
  const dir = way(st, t0 + 1);
  assert.ok(dir !== 0);
  // P1 a little ahead of the bar; P2 and P3 behind it, well away
  const a = bar(st, 0, t0) + dir * 0.35;
  const [x, z] = on(st, a, rho);
  put(g, 0, x, z);
  put(g, 1, ...on(st, bar(st, 0, t0) - dir * 1.2, 6));
  put(g, 2, ...on(st, bar(st, 0, t0) - dir * 2, 9));
  let meet = -1;
  for (let t = t0; t < t0 + 200 && meet < 0; t++) if (touches(st, x, z, 0, t)) meet = t;
  assert.ok(meet > t0 + 5, `meets it ${meet - t0} ticks on`);
  const k0 = g.v.fxCount();
  let hit = null;
  while (!hit && playT(g) < t0 + 200) {
    const t = playT(g);
    g.step();
    hit = fxs(g.v, L.SW_FX_HIT, k0).find((e) => e.owner === 0);
    if (hit) {
      assert.ok(Math.abs(t - meet) <= 1, `flung on tick ${t}, the mirror says ${meet}`);
      // in the bar's own frame: along it and across it
      const b = g.v.partier(0);
      const ang = bar(st, 0, t);
      const [vr, vh] = split(b.vel, ang);
      const [along] = split([b.pos[0] - C, 0, b.pos[2] - C], ang);
      const u = Math.abs(spinAt(st, t)) * along;
      const want = Math.min(L.SW_KICK * u + L.SW_KICK0, L.SW_VMAX);
      assert.ok(dir * vh >= want - 0.05, `on round at ${vh.toFixed(2)}, the bar at ${u.toFixed(2)}`);
      assert.ok(vr > L.SW_OUT - 0.5, `out at ${vr.toFixed(2)}`);
      assert.equal(b.vel[1], L.SW_UP, 'up');
      assert.ok(!b.ground && b.pos[1] > PLAT_Y, 'off the floor');
      assert.deepEqual([hit.shot, hit.pos[0], hit.pos[1], hit.pos[2]], [0, b.pos[0], b.pos[1], b.pos[2]]);
      assert.ok(Math.abs(hit.size - want) < 0.05);
      assert.equal(b.m, 1, 'PG_M: flung once');
    } else assert.ok(g.v.partier(0).ground, 'still on the floor till then');
  }
  assert.ok(hit, 'flung');
  assert.equal(g.v.partier(1).m + g.v.partier(2).m, 0, 'the others untouched');
});

test('a hop the mirror says clears the bar clears it in the sim; one too early or not at all is flung', async () => {
  for (const [rho, early] of [[8, false], [11, false], [8, true], [8, null]]) {
    const g = await room(3, { seed: 4 });
    const st = stage(g.v);
    const t0 = 3000;
    at(g, t0);
    const dir = way(st, t0 + 1);
    const a = bar(st, 0, t0) + dir * 1.0;
    const [x, z] = on(st, a, rho);
    put(g, 0, x, z);
    put(g, 1, ...on(st, bar(st, 0, t0) - dir * 1.0, 6));
    put(g, 2, ...on(st, bar(st, 0, t0) + Math.PI - dir * 1.0, 6));
    const nb = nextBar(st, t0, x, z);
    assert.ok(nb && nb.late >= nb.early && nb.early > 0, `a window: ${JSON.stringify(nb)}`);
    // hop at the window's middle, before it, or never
    const j = early === null ? -1 : early ? Math.max(0, nb.early - 25) : Math.round((nb.early + nb.late) / 2);
    const k0 = g.v.fxCount();
    for (let i = 0; i < nb.until + AIR + 30; i++) g.step(i === j ? [[L.EV_INPUT, 0, partyWord({ hop: 1 })]] : i === j + 1 ? [[L.EV_INPUT, 0, partyWord({})]] : []);
    const hit = fxs(g.v, L.SW_FX_HIT, k0).some((e) => e.owner === 0);
    if (early === false) {
      assert.ok(!hit, `${rho} m: cleared, hopping ${j} ticks on (${nb.early}..${nb.late})`);
      const b = g.v.partier(0);
      assert.ok(b.ground && !b.out && Math.hypot(b.pos[0] - x, b.pos[2] - z) < 0.01, 'back down where it was');
    } else assert.ok(hit, `${early ? 'too early' : 'no hop'}: flung`);
  }
});

test('the post: a ball rolling into it bounces off at half the speed and never gets inside it', async () => {
  const g = await room(2, { seed: 6 });
  const st = stage(g.v);
  at(g, 10); // the grace: the bar still
  const a = bar(st, 0, 10) + Math.PI / 2;
  const [x, z] = on(st, a, L.SW_POST + 1 + 0.3);
  put(g, 0, x, z, { vx: -Math.cos(a) * 8, vz: -Math.sin(a) * 8 });
  put(g, 1, ...on(st, a + Math.PI, 8));
  let out = -Infinity;
  for (let i = 0; i < 80; i++) {
    g.step();
    const b = g.v.partier(0);
    const d = Math.hypot(b.pos[0] - C, b.pos[2] - C);
    assert.ok(d >= L.SW_POST + 1 - 1e-3, `outside the post: ${d}`);
    out = Math.max(out, split(b.vel, a)[0]);
  }
  assert.ok(out > 3 && out <= 4.01, `bounced off at ${out.toFixed(2)} m/s`);
});

test('a still bar holds a ball off and doesn\'t fling it: in the grace, and a new bar in its pause, from the tick it comes in', async () => {
  for (const [t0, k] of [[5, 0], [L.SW_TS[0] + 3, 1], [L.SW_TS[0], 1]]) {
    const g = await room(2, { seed: 8 });
    const st = stage(g.v);
    at(g, t0);
    assert.equal(spinAt(st, t0 + 1), 0, 'still');
    // across the bar's axis 0.5 m, 7 m out, on the side it was turning to as it stopped
    const a = bar(st, k, t0), side = way(st, L.SW_TS[0]);
    const [x, z] = on(st, a, 7);
    put(g, 0, f(x - Math.sin(a) * 0.5 * side), f(z + Math.cos(a) * 0.5 * side));
    put(g, 1, ...on(st, a + Math.PI / 2 + 0.4, 8));
    const k0 = g.v.fxCount();
    for (let i = 0; i < 60; i++) g.step();
    assert.equal(fxs(g.v, L.SW_FX_HIT, k0).length, 0, 'not flung');
    const b = g.v.partier(0);
    const [, h] = split([b.pos[0] - C, 0, b.pos[2] - C], a);
    assert.ok(b.ground && Math.abs(h) > 1.06 && Math.abs(h) < 1.6, `held off the bar, ${h.toFixed(2)} m across it, on the floor`);
    assert.equal(b.m, 0);
  }
});

test('the rings: the outer ring drops on its tick and takes a ball on it; inside the next rim stays up; at the last, SW_RMIN', async () => {
  for (let j = 0; j < L.SW_RINGS; j += 2) {
    const g = await room(3, { seed: 9 + j });
    const st = stage(g.v);
    const tj = L.SW_TR0 + j * L.SW_TRI;
    at(g, tj - 6);
    // somewhere no bar comes near for the next 40 ticks
    let best = null;
    for (let i = 0; i < 64 && !best; i++) {
      const a = (i / 64) * TAU;
      const ring = on(st, a, (rimOf(st.r0, j) + rimOf(st.r0, j + 1)) / 2);
      const inside = on(st, a, rimOf(st.r0, j + 1) - 3);
      const third = on(st, a, rimOf(st.r0, j + 1) - 6);
      let clear = true;
      for (let t = tj - 6; t < tj + 40 && clear; t++) clear = ![ring, inside, third].some((p) => touches(st, ...p, 0, t));
      if (clear) best = [ring, inside, third];
    }
    assert.ok(best, 'a gap between the bars');
    best.forEach((p, k) => put(g, k, ...p));
    while (playT(g) < tj) { g.step(); assert.ok(g.v.partier(0).ground, 'held up till the drop'); }
    g.step();
    assert.ok(!g.v.partier(0).ground, `ring ${j + 1} gone from under it`);
    assert.ok(g.v.partier(1).ground && g.v.partier(2).ground, 'inside the next rim: still up');
    assert.equal(rimAt(st, playT(g)), rimOf(st.r0, j + 1));
    let n = 0;
    while (!g.v.partier(0).falling && n++ < 100) g.step();
    assert.ok(g.v.partier(0).falling, 'and going out');
  }
  const st = { r0: f(40) };
  assert.equal(rimAt(st, L.SW_TR0 + (L.SW_RINGS - 1) * L.SW_TRI), L.SW_RMIN);
});

test('balls that went off ticks apart don\'t share the win: the first is out in its place, the last on wins alone (or the two that went together share it)', async () => {
  for (const n of [2, 3]) {
    const g = await room(n, { seed: 12 });
    const st = stage(g.v);
    at(g, 20);
    // P1 off the platform, falling; 40 ticks on the rest go off, on one tick
    put(g, 0, C + st.r0 + 1.5, C, { y: PLAT_Y - 0.5, ground: false });
    for (let k = 0; k < 40; k++) g.step();
    assert.ok(g.v.partier(0).falling && !g.v.partier(0).out, 'going out');
    for (let p = 1; p < n; p++) put(g, p, C - st.r0 - 1.5, C + 3 * p, { y: PLAT_Y - 0.5, ground: false });
    let k = 0;
    while (g.v.party().state === L.H_PLAY && k++ < 400) g.step();
    const r = g.v.party();
    assert.equal(r.state, L.H_OVER);
    const ps = Array.from({ length: n }, (_, q) => q);
    assert.ok(g.v.partier(0).out, 'P1 out first');
    if (n === 2) {
      assert.deepEqual(ps.map((q) => g.v.partier(q).place), [2, 1]);
      assert.equal(r.winner, 1, 'the last on wins alone');
    } else {
      assert.deepEqual(ps.map((q) => g.v.partier(q).place), [3, 1, 1]);
      assert.equal(r.winner, 255, 'the two that went together share it');
    }
  }
});

test('the end: the last ball on wins; two flung off together share the win', async () => {
  let g = await room(2, { seed: 10 });
  let st = stage(g.v);
  at(g, 20);
  put(g, 0, C + st.r0 + 1.5, C, { y: PLAT_Y + 0.5, ground: false });
  let n = 0;
  while (g.v.party().state === L.H_PLAY && n++ < 400) g.step();
  assert.equal(g.v.party().state, L.H_OVER);
  assert.equal(g.v.party().winner, 1);
  assert.deepEqual([0, 1].map((p) => g.v.partier(p).place), [2, 1]);
  assert.deepEqual([0, 1].map((p) => g.v.partier(p).pts), [1, 10]);
  g = await room(3, { seed: 11 });
  st = stage(g.v);
  at(g, 20);
  put(g, 2, C + st.r0 + 1.5, C, { y: PLAT_Y, ground: false });
  n = 0;
  while (!g.v.partier(2).out && n++ < 400) g.step();
  put(g, 0, C - st.r0 - 1.5, C, { y: PLAT_Y, ground: false });
  put(g, 1, C, C + st.r0 + 1.5, { y: PLAT_Y, ground: false });
  n = 0;
  while (g.v.party().state === L.H_PLAY && n++ < 400) g.step();
  const r = g.v.party();
  assert.equal(r.state, L.H_OVER);
  assert.equal(r.winner, 255, 'shared');
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).place), [1, 1, 3]);
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).pts), [10, 10, 1]);
});

test('the prediction matches the confirmed ball bit for bit: flung by a bar, hopping one, off the post, through a pause and a new bar, a ring dropping, roaming the fast end', async () => {
  // one ball alone, so nothing bumps it (bumps are the confirmed world's)
  const g = await room(1, { seed: 12 });
  const st = stage(g.v);
  const still = (n) => Array(n).fill(partyWord({}));
  // A: ahead of the bar, flung
  let t0 = 1200;
  at(g, t0);
  let dir = way(st, t0 + 1);
  put(g, 0, ...on(st, bar(st, 0, t0) + dir * 0.3, 7));
  assert.ok(predicted(g, still(90)) >= 90);
  assert.ok(g.v.partier(0).m === 1 && !g.v.partier(0).out, 'flung, predicted all the way');
  // B: a hop over it
  t0 = 2600;
  at(g, t0);
  dir = way(st, t0 + 1);
  let [x, z] = on(st, bar(st, 0, t0) + dir * 0.5, 9);
  put(g, 0, x, z);
  g.dv.setUint32(rec(0) + L.PG_M, 0, true);
  const nb = nextBar(st, t0, x, z);
  const hop = Math.round((nb.early + nb.late) / 2);
  assert.ok(predicted(g, Array.from({ length: nb.until + AIR + 20 }, (_, i) => partyWord({ hop: i === hop ? 1 : 0 }))) > 100);
  assert.equal(g.v.partier(0).m, 0, 'cleared');
  // C: into the post
  t0 = 100;
  at(g, t0);
  const a = bar(st, 0, t0) + Math.PI / 2;
  put(g, 0, ...on(st, a, 5), { vx: -Math.cos(a) * 9, vz: -Math.sin(a) * 9 });
  assert.ok(predicted(g, Array(60).fill(partyWord({ yaw: Math.round(((a + Math.PI) / TAU) * 16384) & 16383, move: 1 }))) >= 60);
  // D: through the second bar's warning, the pause and the way back, rolling round
  t0 = L.SW_TS[0] - 40;
  at(g, t0);
  put(g, 0, ...on(st, bar(st, 1, t0) + 0.05, 6));
  const roam = Array.from({ length: 270 }, (_, i) => partyWord({ yaw: (i * 61) & 16383, move: (i >> 5) & 1, hop: i % 45 === 0 ? 1 : 0 }));
  let k = 0;
  for (; k < roam.length && !g.v.partier(0).falling; k += 30) assert.ok(predicted(g, roam.slice(k, k + 30)) >= 1);
  assert.ok(k > 150, `${k} ticks before it fell`);
  // E: on the ring as it drops, then (falling) not much longer
  t0 = L.SW_TR0 - 20;
  at(g, t0);
  let ok = null;
  for (let i = 0; i < 64 && !ok; i++) {
    const p = on(st, (i / 64) * TAU, (rimOf(st.r0, 0) + rimOf(st.r0, 1)) / 2);
    let clear = true;
    for (let t = t0; t < t0 + 50 && clear; t++) clear = !touches(st, ...p, 0, t);
    if (clear) ok = p;
  }
  put(g, 0, ...ok);
  assert.ok(predicted(g, still(80)) >= 80);
  assert.ok(g.v.partier(0).falling && !g.v.partier(0).out, 'dropped with the ring');
  // F: the fast end, four bars, rolling and hopping round inside the last rim
  t0 = L.SW_TR0 + 5 * L.SW_TRI;
  at(g, t0);
  put(g, 0, ...on(st, 1, 5));
  const words = Array.from({ length: 300 }, (_, i) => partyWord({ yaw: (i * 211) & 16383, move: (i >> 3) % 3 === 0 ? 0 : 1, hop: i % 23 === 0 ? 1 : 0 }));
  for (k = 0; k < words.length && !g.v.partier(0).falling; k += 30) assert.ok(predicted(g, words.slice(k, k + 30)) >= 1);
});

// A round of Partier balls steered by this minigame's brain (tools/genparty.mjs), recorded as a log.
async function aiRound(balls, ticks, seed) {
  let start = -1, over = -1, seen = 0, hits = 0, at15 = -1;
  let places = null, pts = null, winner = -1;
  const { log, sim } = await playParty({ bytes: partyBytes(true), seed, mg: L.MG_SWEEP, bots: balls, ticks, onTick: (t, s, v) => {
    const g = v.party();
    for (; seen < v.fxCount(); seen++) hits += v.fx(seen).kind === L.SW_FX_HIT;
    if (start < 0 && g.state === L.H_PLAY) start = t;
    if (start >= 0 && at15 < 0 && t - start >= 15 / TICK) at15 = g.left;
    if (start >= 0 && over < 0 && g.state === L.H_OVER) {
      over = t;
      winner = g.winner;
      places = [...Array(balls).keys()].map((p) => v.partier(p).place);
      pts = [...Array(balls).keys()].map((p) => v.partier(p).pts);
    }
  } });
  return { log, sim, start, over, hits, at15, places, pts, winner };
}

for (const [balls, ticks, seed] of [[8, 16500, 21], [64, 16500, 22]]) {
  test(`a round of ${balls} AI balls on the debug build: no trap, most of them up a while, a winner or the clock; equal on 1 and 4 threads`, async () => {
    const r = await aiRound(balls, ticks, seed);
    assert.equal(r.sim.error().code, 0);
    assert.ok(r.over > 0, 'the round ended');
    const secs = (r.over - r.start) * TICK;
    assert.ok(secs > 20 && secs <= L.SW_LEN * TICK + 0.01, `${secs.toFixed(1)} s of play`);
    assert.ok(r.at15 >= balls / 2, `${r.at15} of ${balls} still on 15 s in`);
    assert.ok(r.hits >= balls / 2, `${r.hits} flung`);
    assert.ok(r.places.every((x) => x >= 1 && x <= balls), `places ${r.places}`);
    assert.ok(r.pts.every((x) => x >= 1 && x <= 10), `points ${r.pts}`);
    assert.ok(r.places.includes(1) && r.pts.includes(10), 'somebody won');
    const v = new View(r.sim.memory.buffer);
    assert.equal(v.party().game, L.MG_SWEEP);
    const parsed = parseLog(r.log);
    const n = r.over + 50;
    const a = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 1, tag: 't1' });
    const b = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 4, tag: 't4', startWorkers });
    const d = await replay({ bytes: partyBytes(true), log: parsed, ticks: n, threads: 1, tag: 'd1' });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(d.trace).tickHashes], 'the debug build steps the same bits');
  });
}

test('the client module: draws every phase, frames the platform, writes its HUD lines; its brain sees the rim, the rings and the post, and its hops clear bars in the sim', async () => {
  const { Scene } = await import('../client/party-render.mjs');
  const g = await room(3, { seed: 41 });
  const st = stage(g.v);
  const out = { scene: new Scene(24000), solid: [], glow: [], beams: [], decals: [], paint: null };
  const lines = [];
  const hctx = { put: (x, y, s, c) => lines.push([y, s, c]), centre: (y, s, c) => lines.push([y, s, c]), right: (y, s, c) => lines.push([y, s, c]), rows: 44, C: {}, slot: 0, now: 0 };
  for (const t of [10, 600, L.SW_TS[0] - 100, L.SW_TS[0] + 50, L.SW_TS[2] + 400, L.SW_TR0 - 100, L.SW_TR0 + 10, L.SW_TR0 + 5 * L.SW_TRI]) {
    at(g, t);
    g.step();
    out.scene.clear(); out.decals.length = 0; out.glow.length = 0; lines.length = 0;
    const me = g.v.partier(0);
    sweep.draw(g.v, { tick: g.v.tick, ptick: g.v.tick, dt: 0, now: 1000, slot: 0, me, pme: me }, out);
    assert.ok(out.scene.count > 8 && out.scene.count < 80, `${out.scene.count} solids at ${t}`);
    for (let k = 0; k < out.scene.count * 16; k++) assert.ok(Number.isFinite(out.scene.data[k]), 'finite');
    sweep.hud(g.v, { ...hctx, me, t: (t + 1) * TICK + 1e-6 });
    for (const l of lines) assert.ok(l[1].length <= 80, l[1]);
    const text = lines.map((l) => l[1]).join(' | ');
    assert.ok(text.includes(`BARS ${barsAt(t + 1)}`), text);
    if (t + 1 >= L.SW_TR0 - L.SW_RWARN && t + 1 < L.SW_TR0) assert.ok(text.includes('THE EDGE DROPS') && out.decals.some((d) => d.color[0] === 1 && d.color[1] === 0.2), 'the edge to come');
    const fr = sweep.frame(g.v);
    assert.equal(fr.shape, 'disc');
    assert.ok(Math.abs(fr.radius - (rimAt(st, playT(g)) + 1)) < 1e-3);
  }
  assert.ok(sweep.hint.length <= 70);
  // danger: off the rim, the post, the ring about to drop, and fine in between
  at(g, L.SW_TR0 - 200);
  g.step();
  const T = g.v.party().start;
  const tk = T + L.SW_TR0 - 100;
  assert.equal(sweep.brain.danger(g.v, C + st.r0 + 1, C, tk), 1);
  assert.ok(sweep.brain.danger(g.v, C + 1.5, C, tk) >= 0.6);
  assert.ok(sweep.brain.danger(g.v, C + (st.r0 + rimOf(st.r0, 1)) / 2, C, tk) >= 0.8);
  assert.equal(sweep.brain.danger(g.v, C + 7, C, T + 2000), 0);
  assert.equal(sweep.brain.danger(g.v, C + rimOf(st.r0, 1) + 0.5, C, T + L.SW_TR0 + 1), 1, 'past the rim the drop left');
  // its hop over a bar, asked every 4th tick as the bot asks, clears it in the sim
  const g2 = await room(3, { seed: 42 });
  const st2 = stage(g2.v);
  const t0 = 4000;
  at(g2, t0);
  const dir = way(st2, t0 + 1);
  put(g2, 0, ...on(st2, bar(st2, 0, t0) + dir * 0.7, 10));
  put(g2, 1, ...on(st2, bar(st2, 0, t0) - dir * 1.0, 6));
  put(g2, 2, ...on(st2, bar(st2, 0, t0) + Math.PI - dir * 1.0, 6));
  const bot = { skill: 1, rand: () => 0.5, mem: {}, at: 0, pos: null, vel: [0, 0] };
  const k0 = g2.v.fxCount();
  let hopped = -1, word = partyWord({});
  for (let i = 0; i < 200; i++) {
    if (i % 4 === 0) {
      const b = g2.v.partier(0);
      Object.assign(bot, { at: g2.v.tick, pos: [b.pos[0], b.pos[2]], vel: [b.vel[0], b.vel[2]] });
      const h = sweep.brain.hop(g2.v, b, bot);
      if (h && hopped < 0) hopped = i;
      word = partyWord({ hop: h ? 1 : 0 });
    }
    g2.step([[L.EV_INPUT, 0, word]]);
  }
  assert.ok(hopped > 0, 'it hopped');
  assert.equal(fxs(g2.v, L.SW_FX_HIT, k0).filter((e) => e.owner === 0).length, 0, 'and cleared the bar');
  assert.ok(g2.v.partier(0).ground && !g2.v.partier(0).out);
  // and the whole AI ball (client/party-bot.mjs, its words landing 8 ticks late) alone with three bars for 10 s: it stands, hops them, stays on
  const g3 = await room(1, { seed: 43 });
  at(g3, L.SW_TS[1] + L.SW_PAUSE + 10);
  const ai = new Partier(0, 5, 1);
  const k1 = g3.v.fxCount(), late = [];
  let hops = 0, last = 0;
  for (let i = 0; i < 1250; i++) {
    late.push(ai.think(g3.v, g3.v.tick + 8, 8));
    const w = late.length > 8 ? late.shift() : partyWord({});
    if ((w >>> 28) & 1 && !((last >>> 28) & 1)) hops++;
    last = w;
    g3.step([[L.EV_INPUT, 0, w]]);
  }
  assert.ok(hops >= 4, `${hops} hops`);
  assert.equal(fxs(g3.v, L.SW_FX_HIT, k1).length, 0, 'never flung');
  assert.ok(!g3.v.partier(0).out);
});
