import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty, partyBytes, predicted } from './helpers.mjs';
import { View, partyWord, PLAT_Y } from '../src/party-view.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { playParty } from '../tools/genparty.mjs';
import * as L from '../src/layout.mjs';
import chute, { stage, fruitAt, surf, laneZ, KINDS } from '../client/mg/chute.mjs';

const C = L.B_CX;
const TICK = 0.008;
const TOP = PLAT_Y + L.FC_RISE;
const f = Math.fround;

// A room of n balls on Fruit Chute, on the debug build (a NaN traps), stepped into play unless asked not to.
async function room(n = 2, { play = true, seed = 7 } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_CHUTE + 1, true);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); assert.equal(sim.error().code, 0, 'no trap'); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  while (play && v.hole().state !== L.H_PLAY) step();
  return { sim, v, dv, step };
}
const rec = (p) => L.PLAYERS + p * L.PSIZE;
const H = (g, o) => g.dv.getFloat32(L.PG_H + o, true);
// Ball p at (x, z), its bottom on the floor there (or at y), moving at (vx, vy, vz).
function put(g, p, x, z, { y = null, vx = 0, vy = 0, vz = 0, ground = true } = {}) {
  const s = stage(g.v);
  g.dv.setFloat32(rec(p) + L.P_PX, x, true);
  g.dv.setFloat32(rec(p) + L.P_PY, y ?? f(surf(s, x)), true);
  g.dv.setFloat32(rec(p) + L.P_PZ, z, true);
  g.dv.setFloat32(rec(p) + L.P_VX, vx, true);
  g.dv.setFloat32(rec(p) + L.P_VY, vy, true);
  g.dv.setFloat32(rec(p) + L.P_VZ, vz, true);
  g.dv.setUint8(rec(p) + L.P_FL, L.PF_LIVE | (ground ? L.PF_GROUND : 0));
}
const fxs = (v, kind, from = 0) => { const out = []; for (let k = from; k < v.fxCount(); k++) { const x = v.fx(k); if (x.kind === kind) out.push(x); } return out; };
// The schedule's clock on the tick the next step plays (the fruit as that step's moves meet them).
const sched = (g) => g.v.party().t + L.FC_PRE;
// The sim's floor top at x, in f32 as $fc_surf works it.
const surf32 = (g, x) => f(f(f(Math.min(Math.max(f(x - H(g, L.FC_X0)), 0), L.FC_RUN)) * f(L.FC_SLOPE)) + PLAT_Y);
// A fruit rolling on the schedule's tick ts between x0 + lo and x0 + hi, of kind (any if null).
function rolling(s, ts, lo, hi, kind = null) {
  const o = {};
  for (let k = 0; k < s.nf; k++) {
    if (kind !== null && s.kind[k] !== kind) continue;
    if (fruitAt(s, k, ts, o) && o.phase === 1 && o.x > s.x0 + lo && o.x < s.x0 + hi) return k;
  }
  return -1;
}

test('the stage for 1, 8, 64 and 256: a chute as wide as the crowd wants, lanes wall to wall, every ball on the grid over the catch floor', async () => {
  let last = 0;
  for (const n of [1, 8, 64, 256]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party();
    const w = Math.min(L.FC_W0 + L.FC_WK * Math.sqrt(n), L.FC_WMAX);
    const hw = H(g, L.FC_HW), x0 = H(g, L.FC_X0), xt = H(g, L.FC_XT), xb = H(g, L.FC_XB), xe = H(g, L.FC_XE);
    assert.ok(Math.abs(2 * hw - w) < 1e-4, `${2 * hw} m wide for ${n}`);
    assert.ok(hw > last, 'wider with the crowd');
    last = hw;
    assert.deepEqual([r.kind, r.len, r.floor, r.respawn], [L.PK_SCORE, L.FC_LEN, PLAT_Y, 0x7fffffff]);
    assert.equal(xt - x0, L.FC_RUN);
    assert.equal(x0, C - L.FC_RUN / 2);
    assert.ok(x0 - xb >= L.FC_CATCH && xe - xt > L.FC_PEN0, 'a catch floor, a pen');
    assert.ok(Math.abs(r.size - (xe - xb) / 2) < 1e-3);
    // lanes about FC_LANE apart, the outer ones FC_LEDGE off the walls
    const s = stage(g.v);
    assert.equal(s.nl, Math.round((w - 2 * L.FC_LEDGE) / L.FC_LANE) + 1);
    assert.ok(Math.abs(laneZ(s, 0) - (C - hw + L.FC_LEDGE)) < 1e-3 && Math.abs(laneZ(s, s.nl - 1) - (C + hw - L.FC_LEDGE)) < 1e-3);
    assert.ok(Math.abs(s.lsp - L.FC_LANE) < 0.6, `lanes ${s.lsp.toFixed(2)} m apart`);
    // every ball on the catch floor, inside the walls, in rows back from the foot
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p);
      assert.equal(b.pos[1], PLAT_Y, `P${p + 1} on the catch floor`);
      assert.ok(b.pos[0] <= x0 - L.FC_GRID0 + 1e-4 && b.pos[0] > xb + 1, `P${p + 1} at x ${b.pos[0] - x0}`);
      assert.ok(Math.abs(b.pos[2] - C) <= hw - L.FC_EDGE + 1e-3, `P${p + 1} inside the walls`);
    }
    assert.ok(g.v.partier(0).pos[0] === x0 - L.FC_GRID0, 'the front row');
  }
});

test('the schedule: in the order they drop, every fruit in a lane, its kind\'s size and speed, the buckets right, waves with a gap', async () => {
  for (const n of [2, 64]) {
    const g = await room(n, { play: false, seed: 11 + n });
    const s = stage(g.v);
    assert.ok(s.nf > 100 && s.nf < L.FC_NMAX, `${s.nf} fruit`);
    const lanes = Array.from({ length: s.nl }, (_, l) => f(laneZ(s, l)));
    const kinds = [0, 0, 0, 0];
    for (let k = 0; k < s.nf; k++) {
      if (k) assert.ok(s.t0[k] >= s.t0[k - 1], `fruit ${k} in order`);
      assert.ok(lanes.some((z) => Math.abs(z - s.z[k]) < 1e-3), `fruit ${k} in a lane`);
      const K = KINDS[s.kind[k]];
      assert.equal(s.r[k], f(K.r));
      assert.equal(s.v[k], f(K.v));
      assert.ok(Math.abs(s.z[k] - C) + s.r[k] <= s.hw + 1e-3, 'inside the walls');
      kinds[s.kind[k]]++;
    }
    assert.ok(kinds.every((c) => c > 0), `every kind: ${kinds}`);
    assert.ok(s.t0[0] < L.FC_I0 && s.t0[s.nf - 1] < L.FC_LEN + L.FC_PRE && s.t0[s.nf - 1] > L.FC_LEN + L.FC_PRE - 2 * L.FC_I1, 'over the whole round');
    for (let b = 0; b < L.FC_NB; b++) {
      const first = s.t0.findIndex((t0) => t0 >= b * L.FC_BUCKET);
      assert.equal(s.idx[b], first < 0 ? s.nf : first, `bucket ${b}`);
    }
    // the waves: at their times, every lane but the gap, apples then melons
    for (let w = 0; w < L.FC_WAVES; w++) {
      const at = L.FC_WAVE0 + w * L.FC_WAVEI + L.FC_PRE;
      const mine = [...Array(s.nf).keys()].filter((k) => s.wave[k] === w + 1);
      const gap = g.v.u8[L.PG_S + L.FC_GAPS + w];
      assert.equal(mine.length, s.nl - s.gl, `wave ${w + 1}: ${mine.length} fruit`);
      for (const k of mine) {
        assert.equal(s.t0[k], at);
        assert.equal(s.kind[k], w < L.FC_WAVEA ? L.FC_APPLE : L.FC_MELON);
        const l = Math.round((s.z[k] - s.lz0) / s.lsp);
        assert.ok(l < gap || l >= gap + s.gl, `wave ${w + 1}: none in the gap`);
      }
    }
    assert.equal(s.gl, s.nl >= L.FC_GAP2 ? 2 : 1);
  }
});

test('the floor: the catch floor, the belt rising FC_SLOPE a metre to the line, the top past it; nothing outside the walls, nothing to fall through', async () => {
  const g = await room(2);
  const s = stage(g.v);
  const x0 = H(g, L.FC_X0);
  // a ball set down anywhere inside lands on the floor's top there, and stays on it
  for (const [dx, want] of [[-6, PLAT_Y], [10, PLAT_Y + 2], [50, PLAT_Y + 10], [99, PLAT_Y + 19.8]]) {
    put(g, 0, x0 + dx, C + 3, { y: want + 3, ground: false });
    for (let k = 0; k < 120 && !g.v.partier(0).ground; k++) g.step();
    const b = g.v.partier(0);
    assert.ok(b.ground, `landed at ${dx}`);
    assert.ok(Math.abs(b.pos[1] - surf32(g, b.pos[0])) < 1e-4 && Math.abs(surf(s, b.pos[0]) - (dx < 0 || dx > L.FC_RUN ? want : PLAT_Y + (b.pos[0] - x0) * L.FC_SLOPE)) < 1e-3, `on the floor at ${dx}: ${b.pos[1]}`);
  }
  // a ball pushed under the floor comes up onto it, never through
  put(g, 0, x0 + 40, C, { y: PLAT_Y + 4, ground: true });
  g.step();
  const b = g.v.partier(0);
  assert.ok(b.ground && Math.abs(b.pos[1] - surf32(g, b.pos[0])) < 1e-4, `lifted onto the belt: ${b.pos[1]}`);
  assert.equal(g.v.hole().state, L.H_PLAY);
});

test('the belt carries a ball on it down at FC_BELT, and keeps one rolling down it on it; not one in the air, nor on the catch floor or the top', async () => {
  const g = await room(3);
  const x0 = H(g, L.FC_X0), xt = H(g, L.FC_XT);
  // two balls still, no keys: on the belt, on the catch floor (a third out of the way)
  put(g, 0, x0 + 30, C - 6);
  put(g, 1, x0 - 6, C);
  put(g, 2, x0 - 6, C + 4);
  void xt;
  const a0 = g.v.partier(0).pos[0], a1 = g.v.partier(1).pos[0];
  for (let k = 0; k < 125; k++) {
    g.step();
    const b = g.v.partier(0);
    assert.ok(b.ground && Math.abs(b.pos[1] - surf32(g, b.pos[0])) < 1e-4, `on the belt at ${k}`);
  }
  const moved = a0 - g.v.partier(0).pos[0];
  assert.ok(Math.abs(moved - L.FC_BELT) < 0.01, `carried ${moved.toFixed(4)} m in a second`);
  assert.equal(g.v.partier(1).pos[0], a1, 'the catch floor stays put');
  // rolling down it at 8 m/s with no keys: on it every tick, the belt's 3 m/s on top of its own
  put(g, 0, x0 + 80, C - 6, { vx: -8 });
  let x = g.v.partier(0).pos[0];
  for (let k = 0; k < 60; k++) {
    g.step();
    const b = g.v.partier(0);
    assert.ok(b.ground && Math.abs(b.pos[1] - surf32(g, b.pos[0])) < 1e-4, `kept on the slope at ${k}`);
    assert.ok(x - b.pos[0] > (-b.vel[0] + L.FC_BELT) * TICK - 1e-3, 'down at its speed and the belt\'s');
    x = b.pos[0];
  }
  // in the air over the belt: no carry till it lands
  put(g, 0, x0 + 50, C - 6, { y: PLAT_Y + 10 + 4, ground: false });
  const ax = g.v.partier(0).pos[0];
  for (let k = 0; k < 20; k++) g.step();
  assert.equal(g.v.partier(0).pos[0], ax, 'not carried in the air');
});

test('the walls hold every ball in: both sides, behind the catch floor, past the pen, what it hits them with given back at FC_BOUNCE', async () => {
  const g = await room(2);
  const hw = H(g, L.FC_HW), x0 = H(g, L.FC_X0), xb = H(g, L.FC_XB), xe = H(g, L.FC_XE);
  for (const [x, z, vx, vz, axis, lim] of [[x0 + 20, C + hw - 1.05, 0, 12, 'z', C + hw - 1], [x0 + 20, C - hw + 1.05, 0, -12, 'z', C - hw + 1], [xb + 1.05, C, -12, 0, 'x', xb + 1]]) {
    put(g, 0, x, z, { vx, vz });
    g.step();
    const b = g.v.partier(0);
    const i = axis === 'z' ? 2 : 0;
    assert.ok(Math.abs(b.pos[i] - lim) < 1e-3, `held at the ${axis} wall: ${b.pos[i] - lim}`);
    assert.ok(Math.sign(b.vel[i]) === -Math.sign(axis === 'z' ? vz : vx) && Math.abs(b.vel[i]) < 12 * L.FC_BOUNCE + 0.5, `bounced back at ${b.vel[i]}`);
  }
  assert.ok(xe - H(g, L.FC_XT) > L.FC_PEN0 + L.FC_BACK, 'room in the pen');
});

test('a fruit knocks a ball climbing into it back down and out of its lane, up a little, never into the floor; a melon harder', async () => {
  const kicks = [];
  for (const kind of [L.FC_APPLE, L.FC_MELON]) {
    const g = await room(2, { seed: 5 + kind });
    put(g, 1, H(g, L.FC_X0) - 6, C);
    const s = stage(g.v);
    // on till one of the kind rolls mid-belt
    let k = -1;
    for (let i = 0; i < 3000 && k < 0; i++) { g.step(); k = rolling(s, sched(g), 20, 80, kind); }
    assert.ok(k >= 0, `a ${KINDS[kind].name} rolling mid-belt`);
    const o = {};
    fruitAt(s, k, sched(g), o);
    const reach = s.r[k] + 1;
    // just downhill of it, a little to its +z side, rolling up at 8 m/s
    put(g, 0, o.x - reach - 0.3, s.z[k] + 0.4, { vx: 8 });
    const n0 = g.v.fxCount();
    let hit = null;
    for (let i = 0; i < 40 && !hit; i++) { g.step(); hit = fxs(g.v, L.FC_FX_HIT, n0).find((x) => x.owner === 0 && x.shot === k); }
    assert.ok(hit, `hit by fruit ${k}`);
    const b = g.v.partier(0);
    const v = s.v[k];
    assert.ok(b.vel[0] < -v, `knocked down the belt at ${b.vel[0].toFixed(1)} m/s (the fruit ${v})`);
    assert.ok(b.vel[2] > 1, `and aside, to the side it was on: ${b.vel[2].toFixed(1)}`);
    assert.equal(b.vel[1], f(kind === L.FC_MELON ? L.FC_POPM : L.FC_POP));
    assert.ok(!b.ground && b.pos[1] >= surf32(g, b.pos[0]) - 1e-4, 'up off the floor, not into it');
    // out of it: a reach from its centre where the sim had it
    fruitAt(s, k, hit.tick - g.v.party().start + L.FC_PRE, o);
    const d = Math.hypot(b.pos[0] - o.x, b.pos[1] + 1 - o.y, b.pos[2] - o.z);
    assert.ok(d >= reach - 1e-3, `out of it: ${d.toFixed(3)} of ${reach}`);
    assert.ok(Math.abs(Math.hypot(hit.pos[0] - o.x, hit.pos[2] - o.z) - s.r[k]) < 1e-3, 'the FX on its skin');
    assert.ok(hit.size > 20, `kicked ${hit.size.toFixed(1)} m/s`);
    kicks.push(hit.size);
  }
  assert.ok(kicks[1] > kicks[0], `a melon harder: ${kicks.map((x) => x.toFixed(1))}`);
});

test('a fruit out of the dispenser lands on a ball under it; one at the grate over the foot is gone', async () => {
  const g = await room(2, { seed: 9 });
  put(g, 1, H(g, L.FC_X0) - 6, C);
  const s = stage(g.v);
  // the next fruit to drop after a second's time, and a ball parked under its hatch (the belt would carry it off: keep it there)
  for (let i = 0; i < 300; i++) g.step();
  const ts = sched(g);
  const k = s.t0.findIndex((t0) => t0 > ts + 60);
  const n0 = g.v.fxCount();
  let hit = null;
  for (let i = 0; i < s.t0[k] - ts + L.FC_DROPT + 20 && !hit; i++) {
    put(g, 0, s.xd, s.z[k]);
    g.step();
    hit = fxs(g.v, L.FC_FX_HIT, n0).find((x) => x.owner === 0 && x.shot === k);
  }
  assert.ok(hit, 'hit from above');
  const age = hit.tick - g.v.party().start + L.FC_PRE - s.t0[k];
  assert.ok(age > 0 && age < L.FC_DROPT, `while dropping, ${age} ticks out`);
  // the grate: a ball just under it, a fruit reaching it bursts rather than roll on down
  const x0 = H(g, L.FC_X0);
  const o = {};
  const soon = () => [...Array(s.nf).keys()].find((j) => s.t0[j] < sched(g) && fruitAt(s, j, sched(g) + 200, o) === false && o.burst > 0 && o.burst < 1);
  let kk;
  for (let i = 0; i < 2000 && kk === undefined; i++) { put(g, 0, s.x0 - 8, C); g.step(); kk = soon(); }
  assert.ok(kk !== undefined, 'one bursting soon');
  for (let i = 0; i < 260; i++) { put(g, 0, x0 + L.FC_GRATE - s.r[kk] - 1.05, s.z[kk]); g.step(); }
  assert.ok(!fxs(g.v, L.FC_FX_HIT, n0).some((x) => x.shot === kk && x.owner === 0), 'gone at the grate, no hit past it');
});

test('over the line: out of play, parked in the pen, placed by the order crossed (one tick, one place); the first cuts the round to FC_RUSH', async () => {
  const g = await room(4);
  const xt = H(g, L.FC_XT), x0 = H(g, L.FC_X0);
  put(g, 3, x0 - 6, C);
  // P1 and P2 cross on the same tick, P3 later
  put(g, 0, xt - 0.05, C - 3, { vx: 9 });
  put(g, 1, xt - 0.05, C + 3, { vx: 9 });
  put(g, 2, xt - 0.6, C, { vx: 9 });
  const n0 = g.v.fxCount();
  g.step();
  const t1 = g.v.tick - 1;
  for (const p of [0, 1]) {
    const b = g.v.partier(p);
    assert.ok(b.out && b.ground, `P${p + 1} out of play`);
    assert.equal(b.m, L.FC_M_FIN | 1);
    assert.equal(b.score, L.FC_SCORE_FIN);
    assert.equal(b.outAt, t1);
    assert.ok(b.pos[0] >= xt + L.FC_PEN0 - 1e-3 && b.pos[1] === TOP && b.vel.every((x) => x === 0), 'still in the pen');
  }
  assert.notDeepEqual(g.v.partier(0).pos, g.v.partier(1).pos, 'spots of their own');
  const fin = fxs(g.v, L.FC_FX_FINISH, n0);
  assert.deepEqual(fin.map((x) => [x.owner, x.shot]), [[0, 1], [1, 1]]);
  assert.equal(g.dv.getUint32(L.PG_H + L.FC_FIN, true), 2);
  assert.equal(g.v.hole().until, t1 + L.FC_RUSH, 'the rush');
  let k = 0;
  while (!g.v.partier(2).out && k++ < 300) g.step();
  assert.equal(g.v.partier(2).m, L.FC_M_FIN | 3, 'third over');
  assert.equal(g.v.partier(2).score, L.FC_SCORE_FIN - 2);
  assert.equal(g.v.hole().until, t1 + L.FC_RUSH, 'the rush stands');
  // the last over ends the round: places by the order, points
  put(g, 3, xt - 0.05, C, { vx: 9 });
  g.step();
  const r = g.v.party();
  assert.equal(r.state, L.H_OVER);
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.partier(p).place), [1, 1, 3, 4]);
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.partier(p).pts), [10, 10, 4, 1]);
  assert.equal(r.winner, 255, 'a shared win');
});

test('the time: everyone still climbing placed by how far up they stand', async () => {
  const g = await room(3);
  const x0 = H(g, L.FC_X0), xb = H(g, L.FC_XB);
  put(g, 0, x0 + 20, C - 4);
  put(g, 1, x0 + 60, C);
  put(g, 2, x0 - 5, C + 4);
  g.dv.setUint32(L.HDR_UNTIL, g.v.tick, true);
  const want = [0, 1, 2].map((p) => g.v.partier(p).pos[0]);
  g.step();
  assert.equal(g.v.party().state, L.H_OVER);
  for (const p of [0, 1, 2]) {
    const b = g.v.partier(p);
    assert.ok(Math.abs(b.score - (want[p] - xb) * 100) < 30, `P${p + 1} ${b.score} cm up`);
  }
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).place), [2, 1, 3]);
  assert.equal(g.v.party().winner, 1);
});

test('a ball that joins in play comes in over the catch floor; waves are announced FC_WARN ahead with their gap', async () => {
  const g = await room(2);
  g.step([[L.EV_JOIN, 5]]);
  const b = g.v.partier(5);
  const s = stage(g.v);
  assert.ok(b.live && !b.out);
  assert.ok(b.pos[0] < s.x0 - 1 && b.pos[0] > s.xb && Math.abs(b.pos[2] - C) < s.hw, `over the catch floor at ${b.pos[0] - s.x0}, ${b.pos[2] - C}`);
  for (let k = 0; k < 200 && !g.v.partier(5).ground; k++) g.step();
  assert.equal(g.v.partier(5).pos[1], PLAT_Y, 'landed on it');
  // the first wave's warning
  const start = g.v.party().start;
  const n0 = g.v.fxCount();
  while (g.v.tick <= start + L.FC_WAVE0 - L.FC_WARN) { put(g, 0, s.x0 - 5, C); put(g, 1, s.x0 - 5, C + 3); put(g, 5, s.x0 - 8, C); g.step(); }
  const w = fxs(g.v, L.FC_FX_WAVE, n0);
  assert.equal(w.length, 1);
  assert.equal(w[0].tick, start + L.FC_WAVE0 - L.FC_WARN);
  assert.deepEqual([w[0].shot & 255, w[0].shot >> 8, w[0].size], [g.v.u8[L.PG_S + L.FC_GAPS], s.gl, 1]);
});

test('the prediction matches the confirmed ball bit for bit: climbing into fruit, batted down, along a wall, rolling down the belt', async () => {
  const g = await room(2, { seed: 3 });
  const s = stage(g.v);
  put(g, 1, s.x0 - 6, C);
  for (let k = 0; k < 900; k++) g.step(); // fruit all down the belt
  const n0 = g.v.fxCount();
  // up a lane with a fruit coming down it: at least one hit, predicted
  const k = rolling(s, sched(g), 42, 60);
  put(g, 0, s.x0 + 30, s.z[k]);
  let compared = predicted(g, Array.from({ length: 400 }, () => partyWord({ yaw: 0, move: 1 })));
  const hits = fxs(g.v, L.FC_FX_HIT, n0).filter((x) => x.owner === 0);
  assert.ok(hits.length >= 1, `${hits.length} hits`);
  // across into a wall and along it, then no keys, rolling down with the belt
  compared += predicted(g, Array.from({ length: 150 }, () => partyWord({ yaw: 3000, move: 1 })));
  compared += predicted(g, Array.from({ length: 200 }, () => partyWord({ yaw: 0 })));
  assert.ok(compared >= 750, `${compared} compared`);
  assert.ok(!g.v.partier(0).out && g.v.hole().state === L.H_PLAY);
});

for (const [balls, ticks] of [[8, 9000], [64, 12000]]) {
  test(`a round of ${balls} AI balls on the debug build: no trap, the round ends, balls over the line in order, the rest placed; equal on 1 and 4 threads`, async () => {
    const bytes = partyBytes(true);
    const st = { start: -1, over: -1, fins: [], hits: 0, mirror: 0, places: null, pts: null };
    let seen = 0;
    const r = await playParty({ bytes, seed: balls, mg: L.MG_CHUTE, bots: balls, ticks, onTick: (t, sim, v) => {
      const h = v.hole();
      if (st.over >= 0) return;
      if (st.start < 0 && h.state === L.H_PLAY) st.start = h.start;
      for (; seen < v.fxCount(); seen++) {
        const x = v.fx(seen);
        if (st.start < 0) continue;
        if (x.kind === L.FC_FX_FINISH) st.fins.push([x.owner, x.shot, x.size]);
        if (x.kind === L.FC_FX_HIT) {
          st.hits++;
          // the client's mirror of the schedule has the fruit where the sim hit it
          const s = stage(v), o = {};
          if (fruitAt(s, x.shot, x.tick - st.start + L.FC_PRE, o) && Math.abs(Math.hypot(x.pos[0] - o.x, x.pos[2] - o.z) - s.r[x.shot]) < 2e-3) st.mirror++;
        }
      }
      if (h.state === L.H_OVER) {
        st.over = t;
        st.places = [...Array(balls).keys()].map((p) => v.partier(p).place);
        st.pts = [...Array(balls).keys()].map((p) => v.partier(p).pts);
      }
    } });
    assert.equal(r.sim.error().code, 0);
    assert.ok(st.over > 0, 'the round ended');
    assert.ok(st.fins.length >= 1, `${st.fins.length} over the line`);
    assert.ok(st.fins[0][2] > 12, `the first over in ${st.fins[0][2].toFixed(1)} s`);
    assert.ok(st.fins.every(([, n], i) => n <= i + 1 && (i === 0 || n >= st.fins[i - 1][1])), 'in order');
    assert.ok(st.hits > balls, `${st.hits} hits`);
    assert.equal(st.mirror, st.hits, 'every hit where the client draws its fruit');
    assert.ok(st.places.every((x) => x >= 1 && x <= balls), `places ${st.places}`);
    assert.ok(st.pts.every((x) => x >= 1 && x <= 10) && st.pts.includes(10), `points ${st.pts}`);
    const parsed = parseLog(r.log);
    const a = await replay({ bytes: partyBytes(), log: parsed, ticks, threads: 1, tag: 'c1' });
    const b = await replay({ bytes: partyBytes(), log: parsed, ticks, threads: 4, tag: 'c4', startWorkers });
    const d = await replay({ bytes, log: parsed, ticks, threads: 1, tag: 'cd' });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(d.trace).tickHashes], 'the debug build steps the same bits');
  });
}

test('the client module: draws the chute and its fruit through the countdown and play, frames it, writes its HUD lines, its brain dodges what the sim rolls', async () => {
  const { Scene } = await import('../client/party-render.mjs');
  const g = await room(3, { play: false, seed: 21 });
  const out = { scene: new Scene(24000), solid: [], glow: [], beams: [], decals: [], casters: [], paint: null };
  const lines = [];
  const hctx = { put: (x, y, str, c) => lines.push([y, str, c]), centre: (y, str, c) => lines.push([y, str, c]), right: (y, str, c) => lines.push([y, str, c]), rows: 44, C: {}, slot: 0, now: 0 };
  for (let k = 0; k < 1600; k++) {
    if (k % 400 === 100) {
      for (const a of [out.solid, out.glow, out.decals, out.casters]) a.length = 0;
      out.scene.clear();
      lines.length = 0;
      chute.draw(g.v, { tick: g.v.tick, dt: 0, now: k * 8, slot: 0 }, out);
      assert.ok(out.scene.count > 200, `${out.scene.count} solids`);
      for (let i = 0; i < out.scene.count * 16; i++) assert.ok(Number.isFinite(out.scene.data[i]), 'finite');
      chute.hud(g.v, { ...hctx, me: g.v.partier(0) });
      for (const l of lines) assert.ok(l[1].length <= 80, l[1]);
      if (g.v.hole().state === L.H_PLAY) assert.ok(lines.some((l) => /OF 3 +\d+ M TO GO/.test(l[1])), lines.map((l) => l[1]).join(' | '));
    }
    g.step();
  }
  const s = stage(g.v);
  // fruit drawn through the countdown too, and in play
  assert.ok(out.casters.length > 3, `${out.casters.length} fruit drawn`);
  const fr = chute.frame(g.v);
  assert.equal(fr.shape, 'square');
  assert.ok(Math.abs(fr.radius - (s.xe - s.xb) / 2) < 1e-3);
  assert.equal(chute.facing(g.v, 0), 0);
  assert.ok(chute.hint.length <= 70 && chute.rules.length <= 70 && chute.ownScore);
  // danger: 1 inside a fruit, 0 well clear of every fruit
  const ts = sched(g);
  const k = rolling(s, ts, 20, 80);
  const o = {};
  fruitAt(s, k, ts, o);
  const T = g.v.party().start + ts - L.FC_PRE;
  assert.equal(chute.brain.danger(g.v, o.x, o.z, T), 1);
  // fx: no throw for each kind
  const ctx = { slot: 0, glow: () => {}, banner: () => {}, feed: () => {}, name: (p) => `P${p + 1}`, dist: 10, sound: {}, C: {} };
  chute.fx({ kind: L.FC_FX_FINISH, owner: 0, shot: 1, pos: [s.xt, TOP, C], size: 20 }, ctx);
  chute.fx({ kind: L.FC_FX_HIT, owner: 1, shot: k, pos: [o.x, o.y, o.z], size: 14 }, ctx);
  chute.fx({ kind: L.FC_FX_WAVE, owner: 255, shot: 1 | (s.gl << 8), pos: [s.xd, TOP, C], size: 1 }, ctx);
});
