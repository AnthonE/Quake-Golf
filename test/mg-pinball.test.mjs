// PINBALL (src/mg/pinball.wat): the table for the crowd, its floor and its
// drains, the pull down it, the walls, bumpers, slingshots, drop targets, top
// lanes, spinner and flippers, the drain's loss and the plunger lane, double
// time, the prediction through all of it, and rounds of AI balls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty, partyBytes } from './helpers.mjs';
import { View, partyWord, PLAT_Y } from '../src/party-view.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { playParty } from '../tools/genparty.mjs';
import * as L from '../src/layout.mjs';
import * as MC from '../src/mg/pinball.mjs'; // PN_*: the minigame's own constants
import pinball, { table, batAng, batClock, onFloor, stands, planeY, funnel } from '../client/mg/pinball.mjs';

const f = Math.fround;
const C = L.B_CX;
const TICK = 0.008;
const S = f(Number(MC.PN_SLOPE));

// A room of n balls on Pinball, on the debug build (a NaN traps), stepped
// into play unless asked not to. Balls in g.held (slot -> [u, w]) are put
// back there, still, before every step.
async function room(n = 2, { play = true, seed = 7 } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_PINBALL + 1, true);
  const g = { sim, v, dv, held: new Map(), T: null };
  g.step = (recs = []) => {
    for (const [p, [u, w]] of g.held) put(g, p, u, w);
    sim.feedPlayers(recs);
    sim.x.step();
    assert.equal(sim.error().code, 0, 'no trap');
  };
  g.step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  g.T = table(v);
  while (play && v.hole().state !== L.H_PLAY) g.step();
  return g;
}
const rec = (p) => L.PLAYERS + p * L.PSIZE;
// The table's plane under world z, in f32 as $pn_h has it.
const hAt = (g, z) => f(f(f(g.T.hl - f(z - C)) * S) + Number(L.BPHYS.PLAT_Y));
// Ball p at (u, w) of the table, on its plane (or y over it), rolling at (vx, vz).
function put(g, p, u, w, { y = 0, vx = 0, vz = 0, vy = 0, ground = true } = {}) {
  const z = f(C + w);
  g.dv.setFloat32(rec(p) + L.P_PX, C + u, true);
  g.dv.setFloat32(rec(p) + L.P_PY, f(hAt(g, z) + y), true);
  g.dv.setFloat32(rec(p) + L.P_PZ, z, true);
  g.dv.setFloat32(rec(p) + L.P_VX, vx, true);
  g.dv.setFloat32(rec(p) + L.P_VY, vy, true);
  g.dv.setFloat32(rec(p) + L.P_VZ, vz, true);
  g.dv.setUint8(rec(p) + L.P_FL, L.PF_LIVE | (ground && !y ? L.PF_GROUND : 0));
}
const uw = (g, p) => { const b = g.v.partier(p); return [b.pos[0] - C, b.pos[2] - C]; };
const score = (g, p) => g.dv.getUint16(rec(p) + L.PG_SCORE, true);
const setScore = (g, p, s) => g.dv.setUint16(rec(p) + L.PG_SCORE, s, true);
// The next step plays tick tp into play (the clock moved; the round's end with it).
function at(g, tp) {
  const now = g.v.tick;
  g.dv.setUint32(L.HDR_START, now - tp, true);
  g.dv.setUint32(L.HDR_UNTIL, now - tp + MC.PN_LEN, true);
}
const playT = (g) => g.v.party().t;
const fxs = (v, kind, from = 0) => { const out = []; for (let k = from; k < v.fxCount(); k++) { const x = v.fx(k); if (x.kind === kind) out.push(x); } return out; };
const yawOf = (x, z) => Math.round(Math.atan2(z, x) / (2 * Math.PI) * 16384) & 16383;
// A capsule's nearest distance from (u, w), less its radius.
const gap = (s, u, w) => { const qu = u - s.u, qw = w - s.w, t = Math.max(0, Math.min(s.len, qu * s.eu + qw * s.ew)); return Math.hypot(qu - s.eu * t, qw - s.ew * t) - s.rad; };

test('the table for 1, 8, 64 and 256: sized for the crowd, its solids laid out, every ball on its floor on its own spot, clear of them all', async () => {
  for (const n of [1, 8, 64, 256]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party(), T = g.T;
    const W = Math.min(MC.PN_WMAX, Math.max(MC.PN_WMIN, MC.PN_W0 + MC.PN_WK * Math.sqrt(n)));
    assert.equal(r.game, L.MG_PINBALL);
    assert.ok(Math.abs(2 * T.hw - W) < 1e-4 && Math.abs(T.hl - W * MC.PN_LK / 2) < 1e-4, `${n}: ${2 * T.hw} x ${2 * T.hl} m`);
    assert.deepEqual([r.kind, r.len, r.size, r.floor, r.respawn], [L.PK_SCORE, MC.PN_LEN, T.hl, PLAT_Y, MC.PN_BACK]);
    assert.deepEqual([r.acc, r.drag, r.idle, r.hop], [f(Number(MC.PN_ACC)), f(Number(MC.PN_DRAG)), f(Number(MC.PN_IDLE)), 6]);
    assert.equal(r.flags & L.PGF_BUMPS, L.PGF_BUMPS, 'bumps on');
    // the bottom: two pairs of flippers, three on a wide table; the funnels split the width
    assert.equal(T.m, W >= MC.PN_W3 ? 3 : 2);
    assert.ok(Math.abs(T.f * T.m - 2 * T.hw) < 1e-3);
    assert.ok(Math.abs(T.wt - (T.hl - MC.PN_TIPB)) < 1e-4 && T.wp < T.wt && T.wg < T.wp, 'tips under the pivots under the guides\' tops');
    const rows = W < MC.PN_W4 ? 2 : W < MC.PN_W5 ? 3 : 4;
    assert.equal(T.bumpers.length, rows * (rows + 1) / 2, `${n}: ${T.bumpers.length} bumpers`);
    assert.equal(T.lanes.length, W < MC.PN_W4 ? 3 : W < MC.PN_W5 ? 4 : 5);
    assert.equal(T.spinners.length, W >= MC.PN_W3 ? 2 : 1);
    assert.equal(T.banks.length, W >= MC.PN_W3 ? 4 : 2);
    assert.equal(T.targets.length, T.banks.length * (W >= MC.PN_W4 ? 4 : 3));
    assert.equal(T.segs.filter((s) => s.kind === MC.PN_KSLING).length, 2 * T.m, 'a slingshot over each flipper');
    assert.equal(T.segs.filter((s) => s.kind === MC.PN_KDEF).length, 2);
    // every solid on the table, every band's list in reach of its solids
    for (const s of T.segs) {
      for (const [a, b] of [[s.u, s.w], [s.u + s.eu * s.len, s.w + s.ew * s.len]]) assert.ok(Math.abs(a) <= T.hw + 1e-3 && Math.abs(b) <= T.hl + 1e-3, `${n}: solid ${s.i} on the table`);
    }
    for (let b = 0; b < MC.PN_NBAND; b++) assert.ok(g.v.u8[L.PG_S + MC.PN_BANDN + b] <= MC.PN_BANDCAP);
    // targets on the side walls, out from them; the top lanes in a row under the top, clear of the plunger lane
    for (const Tg of T.targets) assert.ok(Math.abs(Math.abs(Tg.u) - (T.hw - MC.PN_TD)) < 1e-4 && Tg.w > T.sw0 + MC.PN_SPL && Tg.w < T.wg - 2);
    for (const Ln of T.lanes) assert.ok(Ln.u + MC.PN_LANEW / 2 < T.plu - 1);
    const spots = [];
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p);
      const [u, w] = [b.pos[0] - C, b.pos[2] - C];
      assert.ok(b.ground && !b.out && !b.falling);
      assert.equal(b.pos[1], hAt(g, b.pos[2]), `${n}: P${p + 1} on the plane`);
      assert.ok(onFloor(T, u, w) && w < T.wg - MC.PN_SPAWN1 + 0.01 && Math.abs(u) <= T.hw - MC.PN_SPAWNU + 1e-3, `${n}: P${p + 1} on the playfield at ${u.toFixed(1)}, ${w.toFixed(1)}`);
      for (const s of T.segs) assert.ok(gap(s, u, w) > 1.15, `${n}: P${p + 1} clear of solid ${s.i} (${gap(s, u, w).toFixed(2)})`);
      spots.push([u, w]);
    }
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) assert.ok(Math.hypot(spots[a][0] - spots[b][0], spots[a][1] - spots[b][1]) > MC.PN_SPACE - 1e-3);
  }
});

test('the floor: the table\'s plane rising up it, its drains past the flippers\' line and across the gap; on it a ball is pulled down, coasting at most 5 m/s, climbing at 3 with the keys', async () => {
  const g = await room(1);
  const T = g.T;
  for (const [k, uc] of [[0, T.f / 2 - T.hw], [1, 1.5 * T.f - T.hw]]) {
    assert.deepEqual(funnel(T, uc), [k, uc]);
    assert.ok(onFloor(T, uc, T.wt - 0.01) && !onFloor(T, uc, T.wt + 0.01), 'across the gap: the tips\' line');
    assert.ok(onFloor(T, uc - T.ap, T.wp - 0.01) && !onFloor(T, uc - T.ap, T.wp + 0.01), 'at a pivot');
    assert.ok(onFloor(T, uc - T.f / 2 + 0.01, T.wg - 0.01) && !onFloor(T, uc - T.f / 2 + 0.01, T.wg + 0.05), 'up at the funnel\'s edge');
  }
  assert.ok(!onFloor(T, 0, T.hl + 0.1) && !onFloor(T, T.hw + 0.1, 0));
  // the pull: from rest down the left of the playfield, with no keys: on the plane all the way, at most PN_PULL / (1 - PN_IDLE) a second
  put(g, 0, -9, -15);
  let top = 0;
  for (let k = 0; k < 400; k++) {
    g.step();
    const b = g.v.partier(0);
    assert.ok(b.ground, 'on the plane');
    assert.equal(b.pos[1], hAt(g, b.pos[2]));
    assert.equal(b.pos[0], C - 9, 'straight down');
    top = Math.max(top, b.vel[2]);
  }
  const vmax = Number(MC.PN_PULL) * TICK / (1 - Number(MC.PN_IDLE));
  assert.ok(top > vmax - 0.6 && top <= vmax + 1e-3, `coasting ${top.toFixed(2)} m/s`);
  // the keys up the table: it climbs, at 3 m/s at most
  put(g, 0, -9, 12);
  const up = partyWord({ yaw: yawOf(0, -1), move: 1 });
  let least = 0;
  for (let k = 0; k < 500; k++) { g.step(k ? [] : [[L.EV_INPUT, 0, up]]); least = Math.min(least, g.v.partier(0).vel[2]); }
  const climb = (Number(L.BPHYS.B_ACC_DT) * Number(MC.PN_ACC) - Number(MC.PN_PULL) * TICK) / (1 - Number(MC.PN_DRAG));
  assert.ok(-least > climb * (1 - Number(MC.PN_DRAG) ** 500) - 0.1 && -least < climb + 0.01, `climbing ${(-least).toFixed(2)} m/s`);
  assert.ok(uw(g, 0)[1] < 12 - 5, 'up the table');
});

test('the walls keep a ball in: off the side, the top and a corner\'s deflector', async () => {
  const g = await room(1);
  const T = g.T;
  // into the right wall at 15 m/s: back off it at 0.3 of that, never past it
  put(g, 0, 8, -2, { vx: 15 });
  let most = -1e9, back = null, into = 0;
  for (let k = 0; k < 120; k++) {
    const vx = g.v.partier(0).vel[0];
    g.step();
    most = Math.max(most, uw(g, 0)[0]);
    if (back === null && g.v.partier(0).vel[0] < 0) { back = g.v.partier(0).vel[0]; into = vx; }
  }
  assert.ok(most <= T.hw - 1 - Number(MC.PN_WALLR) + 0.01 && most > T.hw - 1.4, `${most}`);
  assert.ok(Math.abs(back / into + Number(MC.PN_WALLE)) < 0.02, `off it at ${back} from ${into}`);
  // up into the top at 20 m/s, off the top-left deflector toward the middle, keeping more of it
  put(g, 0, -T.hw + 1.6, -T.hl + 9, { vz: -20 });
  let hit = null;
  for (let k = 0; k < 80 && !hit; k++) { g.step(); const b = g.v.partier(0); if (b.vel[0] > 3) hit = b.vel; }
  assert.ok(hit && hit[0] > 6, `turned across the top: ${hit}`);
  for (let k = 0; k < 125; k++) g.step();
  const [u, w] = uw(g, 0);
  assert.ok(Math.abs(u) < T.hw - 1.2 && w > -T.hl + 1.2, 'still on the table');
});

test('a pop bumper kicks a ball off at PN_KICK and pays 1, twice that in the last 15 s', async () => {
  const g = await room(1);
  const T = g.T;
    const B = T.bumpers.at(-1); // the bottom one
  const k0 = g.v.fxCount();
  put(g, 0, B.u, B.w + MC.PN_BR + 2.5, { vz: -5 });
  let kicked = null;
  for (let k = 0; k < 60 && !kicked; k++) { g.step(); const x = fxs(g.v, MC.PN_FX_KICK, k0).find((e) => e.owner === 0); if (x) kicked = x; }
  assert.ok(kicked, 'kicked');
  assert.equal(kicked.shot, (MC.PN_JBUMP << 8) | B.i);
  assert.ok(kicked.size >= MC.PN_KICK - 1e-3, `${kicked.size} m/s off it`);
  assert.ok(g.v.partier(0).vel[2] >= MC.PN_KICK - 1, 'back down the table');
  const [pay] = fxs(g.v, MC.PN_FX_SCORE, k0);
  assert.deepEqual([pay.owner, pay.shot, pay.size, pay.tick], [0, (MC.PN_WBUMP << 8) | B.i, MC.PN_BUMPPAY, kicked.tick]);
  assert.equal(score(g, 0), 1);
  assert.equal(g.dv.getUint32(L.PG_S + MC.PN_BUMP + 16 * B.i + 8, true), 1, 'its hits');
  // double time: called, and the next kick pays 2
  at(g, MC.PN_LEN - MC.PN_DOUBLE);
  const k1 = g.v.fxCount();
  g.step();
  assert.deepEqual(fxs(g.v, MC.PN_FX_CALL, k1).map((x) => x.shot), [0]);
  put(g, 0, B.u, B.w + MC.PN_BR + 2.5, { vz: -5 });
  for (let k = 0; k < 60 && score(g, 0) === 1; k++) g.step();
  assert.equal(score(g, 0), 1 + 2 * MC.PN_BUMPPAY);
});

test('a slingshot throws a ball off at PN_SLINGK at least; the guides round it don\'t', async () => {
  const g = await room(1);
  const T = g.T;
    for (const s of T.segs.filter((x) => x.kind === MC.PN_KSLING)) {
    const mu = s.u + s.eu * s.len / 2, mw = s.w + s.ew * s.len / 2;
    const [, uc] = funnel(T, mu);
    // its normal toward the funnel's middle
    let nu = -s.ew, nw = s.eu;
    if (nu * (uc - mu) < 0) { nu = -nu; nw = -nw; }
    const k0 = g.v.fxCount();
    put(g, 0, mu + nu * 1.6, mw + nw * 1.6, { vx: -nu * 3, vz: -nw * 3 });
    for (let k = 0; k < 30; k++) g.step();
    const kick = fxs(g.v, MC.PN_FX_KICK, k0).find((x) => x.owner === 0 && x.shot >> 8 === MC.PN_JSLING);
    assert.ok(kick, `slingshot ${s.idx} kicked`);
    assert.equal(kick.shot & 255, s.idx);
    assert.ok(kick.size >= MC.PN_SLINGK - 1e-3);
  }
  // a guide's wall end: only bounced, no kick
  const s = T.segs.find((x) => x.kind === MC.PN_KWALL && Math.abs(x.u - (-T.hw)) < 1e-3 && x.w > T.wg - 0.01 && x.len < 3);
  const k0 = g.v.fxCount();
  const mu = s.u + s.eu * s.len / 2, mw = s.w + s.ew * s.len / 2;
  put(g, 0, mu + s.ew * 1.5, mw - s.eu * 1.5, { vx: -s.ew * 3, vz: s.eu * 3 });
  for (let k = 0; k < 30; k++) g.step();
  assert.equal(fxs(g.v, MC.PN_FX_KICK, k0).length, 0);
});

test('drop targets: a hit pays 5 and the target stands PN_DROPT more, then drops; the bank\'s last pays 25 more, and it stands again PN_RESETT after', async () => {
  const g = await room(2);
  const T = g.T;
  const B = T.banks[0];
  const tg = (j) => T.targets[j];
  const face = (j) => tg(j).u + 1 + Number(MC.PN_WALLR); // a ball's centre against a target's face (the left bank)
  const k0 = g.v.fxCount();
  // into target 0 at 6 m/s
  g.held.set(1, [4, 3]);
  put(g, 0, -T.hw + 3.6, tg(B.first).w, { vx: -8 });
  for (let k = 0; k < 60 && !score(g, 0); k++) g.step();
  const t0 = g.dv.getUint32(L.PG_S + MC.PN_TGT, true);
  assert.equal(score(g, 0), MC.PN_TGTPAY);
  assert.equal(t0, g.v.tick - 1, 'hit on the tick its push met it');
  const [pay] = fxs(g.v, MC.PN_FX_SCORE, k0);
  assert.deepEqual([pay.owner, pay.shot, pay.size], [0, (MC.PN_WTGT << 8) | B.first, MC.PN_TGTPAY]);
  assert.ok(g.v.partier(0).vel[0] > 1, 'bounced off it');
  // still standing: P2 thrown at it bounces off it, and is paid nothing
  g.held.clear();
  g.held.set(0, [4, 3]);
  put(g, 1, -T.hw + 3.6, tg(B.first).w, { vx: -8 });
  let least = 1e9;
  for (let k = 0; k < 50; k++) { g.step(); least = Math.min(least, uw(g, 1)[0]); }
  assert.ok(least >= face(B.first) - 0.02, `held off by it (${least})`);
  assert.equal(score(g, 1), 0);
  assert.ok(stands(g.v, B.first, t0 + MC.PN_DROPT - 1) && !stands(g.v, B.first, t0 + MC.PN_DROPT));
  // dropped: P2 rolls through where it was, to the wall
  while (g.v.tick < t0 + MC.PN_DROPT) g.step();
  put(g, 1, -T.hw + 3.6, tg(B.first).w - 0.9, { vx: -10 });
  least = 1e9;
  for (let k = 0; k < 40 && least > face(B.first) - 0.6; k++) { g.step(); least = Math.min(least, uw(g, 1)[0]); }
  assert.ok(least < face(B.first) - 0.5, `through it to the wall (${least})`);
  assert.ok(!fxs(g.v, MC.PN_FX_SCORE, k0).some((x) => x.owner === 1 && x.shot === ((MC.PN_WTGT << 8) | B.first)), 'paid nothing for it');
  // the rest of the bank: 5 each, the last 25 more (P2 held off)
  g.held.clear();
  g.held.set(1, [4, 3]);
  assert.equal(g.dv.getUint32(L.PG_S + MC.PN_TGT + 8 * (B.first + 1), true), 0, 'the next one unhit');
  for (let j = B.first + 1; j < B.first + B.n; j++) {
    put(g, 0, -T.hw + 3.6, tg(j).w, { vx: -8 });
    const s0 = score(g, 0);
    for (let k = 0; k < 60 && score(g, 0) === s0; k++) g.step();
    assert.equal(score(g, 0) - s0, MC.PN_TGTPAY + (j === B.first + B.n - 1 ? MC.PN_BANKPAY : 0), `target ${j}`);
  }
  const last = g.dv.getUint32(L.PG_S + MC.PN_TGT + 8 * (B.first + B.n - 1), true);
  const resetAt = g.dv.getUint32(L.PG_S + MC.PN_BANK, true);
  assert.equal(resetAt, last + MC.PN_DROPT + MC.PN_RESETT);
  assert.equal(g.dv.getUint32(L.PG_S + MC.PN_BANK + 8, true), 1, 'downed once');
  assert.deepEqual(fxs(g.v, MC.PN_FX_SCORE, k0).filter((x) => x.shot >> 8 === MC.PN_WBANK).map((x) => [x.owner, x.size]), [[0, MC.PN_BANKPAY]]);
  // standing again on its tick, all of them, called; unhit
  for (let j = B.first; j < B.first + B.n; j++) assert.ok(!stands(g.v, j, resetAt - 1) && stands(g.v, j, resetAt), `target ${j} stands again then`);
  g.held.set(0, [-4, 3]);
  const k1 = g.v.fxCount();
  while (g.v.tick <= resetAt) g.step();
  for (let j = B.first; j < B.first + B.n; j++) assert.equal(g.dv.getUint32(L.PG_S + MC.PN_TGT + 8 * j, true), 0);
  assert.equal(g.dv.getUint32(L.PG_S + MC.PN_BANK, true), 0);
  assert.deepEqual(fxs(g.v, MC.PN_FX_CALL, k1).map((x) => [x.shot, x.size]), [[1, 0]]);
});

test('the top lanes: rolling down through one pays 3 and lights it, once in PN_LANECD; up through one pays nothing', async () => {
  const g = await room(1);
  const T = g.T;
  const Ln = T.lanes[1];
  const k0 = g.v.fxCount();
  const drop = () => { put(g, 0, Ln.u, T.ltop - 1.6); for (let k = 0; k < 200; k++) g.step(); };
  drop();
  assert.equal(score(g, 0), MC.PN_LANEPAY);
  const [pay] = fxs(g.v, MC.PN_FX_SCORE, k0);
  assert.deepEqual([pay.owner, pay.shot, pay.size], [0, (MC.PN_WLANE << 8) | Ln.j, MC.PN_LANEPAY]);
  const lit = g.dv.getUint32(L.PG_S + MC.PN_LANE + 16 * Ln.j + 4, true);
  assert.equal(lit, pay.tick + MC.PN_LLIT, 'lit');
  assert.equal(g.dv.getUint32(L.PG_S + MC.PN_LANE + 16 * Ln.j + 8, true), 1);
  // again at once: nothing; another lane: paid
  drop();
  assert.equal(score(g, 0), MC.PN_LANEPAY, 'not again so soon');
  put(g, 0, T.lanes[0].u, T.ltop - 1.6);
  for (let k = 0; k < 200; k++) g.step();
  assert.equal(score(g, 0), 2 * MC.PN_LANEPAY, 'another lane');
  // after PN_LANECD, the first again
  while (g.v.tick < pay.tick + MC.PN_LANECD) g.step();
  drop();
  assert.equal(score(g, 0), 3 * MC.PN_LANEPAY);
  // up through a lane, fast: nothing
  at(g, 4000);
  put(g, 0, T.lanes[2].u, T.lbot + 1.5, { vz: -18 });
  for (let k = 0; k < 90; k++) g.step();
  assert.ok(uw(g, 0)[1] < T.ltop, 'went up through it');
  assert.equal(score(g, 0), 3 * MC.PN_LANEPAY);
});

test('the spinner: a ball down through it spins it, and every turn pays whoever spun it last', async () => {
  const g = await room(1);
  const T = g.T;
    const Sp = T.spinners[0];
  const a = L.PG_S + MC.PN_SPIN + 32 * Sp.i;
  const k0 = g.v.fxCount();
  put(g, 0, Sp.u, Sp.w - 3, { vz: 10 });
  let spun = 0;
  for (let k = 0; k < 30; k++) { g.step(); spun = Math.max(spun, g.dv.getUint32(a + 16, true)); }
  assert.equal(g.dv.getUint32(a + 24, true), 0, 'P1 spun it');
  assert.ok(spun >= 9 * MC.PN_SPINK && spun <= MC.PN_SPINMAX, `spun at ${spun} a tick`);
  // P1 held well away while it runs down
  g.held.set(0, [0, 3]);
  for (let k = 0; k < 900; k++) g.step();
  g.held.clear();
  assert.equal(g.dv.getUint32(a + 16, true), 0, 'run down');
  const turns = g.dv.getUint32(a + 20, true);
  assert.equal(turns, g.dv.getUint32(a + 12, true) >>> 14);
  const pays = fxs(g.v, MC.PN_FX_SCORE, k0).filter((x) => x.shot >> 8 === MC.PN_WSPIN);
  assert.ok(turns >= 4 && turns <= 12, `${turns} turns`);
  assert.equal(pays.reduce((s, x) => s + x.size, 0), turns);
  assert.equal(score(g, 0), turns);
  // too slow through it: no spin
  put(g, 0, Sp.u, Sp.w, { vz: 1.5 });
  g.step();
  assert.equal(g.dv.getUint32(a + 16, true), 0);
});

test('the flippers: at rest till PN_FWAIT, then up and back on the clock, the right ones PN_FHALF after the left; a ball on one is batted up the table', async () => {
  // the schedule: at rest, up over PN_FUP, held, back over PN_FDOWN, at rest
  assert.equal(batAng(-1), MC.PN_REST);
  assert.equal(batAng(0), MC.PN_REST);
  assert.equal(batAng(MC.PN_FUP), MC.PN_UP);
  assert.equal(batAng(MC.PN_FUP + MC.PN_FHOLD - 1), MC.PN_UP);
  assert.equal(batAng(MC.PN_FUP + MC.PN_FHOLD + MC.PN_FDOWN), MC.PN_REST);
  assert.equal(batAng(MC.PN_FPER + 3), batAng(3));
  for (let t = 1; t < MC.PN_FUP; t++) assert.ok(batAng(t) < batAng(t - 1), 'up');
  assert.deepEqual([batClock(500, 0), batClock(500, 1)], [500 - MC.PN_FWAIT, 500 - MC.PN_FWAIT - MC.PN_FHALF]);
  const g = await room(1);
  const T = g.T;
  // a ball on the left flipper of funnel 0, 0.7 of its length out, as it rests: batted when it swings
  for (const [side, out] of [[0, 0.7], [1, 0.7], [0, 0.35]]) {
    const P = T.pivots[0][side];
    const th = MC.PN_REST * 2 * Math.PI / 16384;
    const eu = P.sd * Math.cos(th), ew = Math.sin(th), nu = P.sd * Math.sin(th), nw = -Math.cos(th);
    const u = P.u + eu * T.lb * out + nu * (1 + Number(MC.PN_BATR) + 0.01), w = P.w + ew * T.lb * out + nw * (1 + Number(MC.PN_BATR) + 0.01);
    // the tick before its swing starts
    const fire = MC.PN_FWAIT + side * MC.PN_FHALF + 2 * MC.PN_FPER;
    at(g, fire - 2);
    put(g, 0, u, w);
    let k = 0, v = null;
    const k0 = g.v.fxCount();
    for (; k < MC.PN_FUP + 4; k++) { g.step(); if (g.v.partier(0).vel[2] < -6 && !v) v = { at: playT(g) - 1, vel: g.v.partier(0).vel }; }
    assert.ok(v, `side ${side} at ${out}: batted`);
    assert.ok(v.at >= fire && v.at < fire + MC.PN_FUP, `while it swings up (${v.at - fire} ticks in)`);
    const sp = Math.hypot(v.vel[0], v.vel[2]);
    assert.ok(sp > (out > 0.5 ? 14 : 6), `${sp.toFixed(1)} m/s`);
    assert.ok(Math.sign(v.vel[0]) === (side ? -1 : 1), 'toward the middle');
    const kick = fxs(g.v, MC.PN_FX_KICK, k0).find((x) => x.owner === 0 && x.shot >> 8 === MC.PN_JBAT);
    assert.equal(kick?.shot & 255, side);
    // and flies well up the table
    let high = w;
    for (let i = 0; i < 150; i++) { g.step(); high = Math.min(high, uw(g, 0)[1]); }
    assert.ok(high < w - (out > 0.5 ? 12 : 3), `up to ${high.toFixed(1)} from ${w.toFixed(1)}`);
  }
  // before PN_FWAIT nothing swings: a ball on a flipper stays on it
  at(g, 0);
  const P = T.pivots[1][0];
  put(g, 0, P.u + 0.3 * T.lb + 0.5, P.w + 0.15 * T.lb - 1.7);
  for (let k = 0; k < MC.PN_FWAIT - 10; k++) g.step();
  assert.ok(g.v.partier(0).vel[2] > -1, 'not batted');
});

test('a flipper coming back down sweeps a ball under it into the drain, unless it hops it', async () => {
  for (const hop of [false, true]) {
    const g = await room(1);
    const T = g.T;
    const P = T.pivots[0][0];
    // under the raised left flipper of funnel 0, between it and where it rests
    const down = MC.PN_FWAIT + 2 * MC.PN_FPER + MC.PN_FUP + MC.PN_FHOLD; // the tick it starts back down
    const th = ((MC.PN_UP + MC.PN_REST) / 2) * 2 * Math.PI / 16384;
    const u = P.u + Math.cos(th) * T.lb * 0.65, w = P.w + Math.sin(th) * T.lb * 0.65;
    at(g, down - 30);
    put(g, 0, u, w);
    const word = partyWord({ yaw: yawOf(0, -1), move: 0, hop: hop ? 1 : 0 });
    let out = false;
    for (let k = 0; k < 400; k++) {
      // held still till it hops, 23 ticks before the flipper starts down
      if (k < 7) put(g, 0, u, w);
      g.step(k === 6 ? [[L.EV_INPUT, 0, word]] : []);
      out ||= g.v.partier(0).falling || g.v.partier(0).out;
    }
    if (hop) assert.ok(!out && onFloor(T, ...uw(g, 0)), 'hopped it: still on the table');
    else assert.ok(out, 'swept into the drain');
  }
});

test('the drain: a ball through it is down, a fifth of its points gone; back in the plunger lane PN_BACK on, and shot up and over the top', async () => {
  const g = await room(1);
  const T = g.T;
    setScore(g, 0, 52);
  const k0 = g.v.fxCount();
  const uc = T.f / 2 - T.hw;
  put(g, 0, uc, T.wt - 1.2, { vz: 2 });
  for (let k = 0; k < 400 && !g.v.partier(0).out; k++) g.step();
  const b = g.v.partier(0);
  assert.ok(b.out, 'down');
  assert.equal(score(g, 0), 52 - 10);
  const [dr] = fxs(g.v, MC.PN_FX_DRAIN, k0);
  assert.deepEqual([dr.owner, dr.shot], [0, 10]);
  const [sk] = fxs(g.v, L.FX_SINK, k0);
  assert.equal(pinball.sink(sk, (p) => `P${p + 1}`), 'P1 DRAINED');
  const outAt = b.outAt;
  while (g.v.partier(0).out) g.step();
  assert.equal(g.v.tick - 1 - outAt, MC.PN_BACK, 'back in after PN_BACK');
  const [u, w] = uw(g, 0);
  assert.ok(u > T.plu && u < T.hw && w > T.plt && w < T.plb, `in the plunger lane (${u.toFixed(1)}, ${w.toFixed(1)})`);
  const k1 = g.v.fxCount();
  let shot = null, across = false;
  for (let k = 0; k < 250; k++) {
    g.step();
    const p = g.v.partier(0);
    if (!shot && p.vel[2] <= -MC.PN_PLUNGE + 1e-3) shot = p.vel[2];
    if (p.vel[0] < -5 && uw(g, 0)[1] < T.plt) across = true;
  }
  assert.equal(shot, -MC.PN_PLUNGE, 'shot up the lane');
  assert.equal(fxs(g.v, MC.PN_FX_KICK, k1).filter((x) => x.owner === 0 && x.shot >> 8 === MC.PN_JPLUNGE).length, 1, 'once');
  assert.ok(across, 'off the deflector and across the top');
});

test('placing: by points when the clock runs out, ties sharing', async () => {
  const g = await room(4);
  at(g, MC.PN_LEN - 2);
  for (const [p, s] of [[0, 12], [1, 40], [2, 12], [3, 3]]) setScore(g, p, s);
  for (let p = 0; p < 4; p++) put(g, p, -6 + 4 * p, 0);
  while (g.v.party().state === L.H_PLAY) g.step();
  const r = g.v.party();
  assert.equal(r.winner, 1);
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.partier(p).place), [2, 1, 2, 4]);
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.partier(p).pts), [7, 10, 7, 1]);
});

// The prediction against the confirmed world, as helpers.mjs's predicted(),
// for slot 0 of room g through `inputs`: its whole record bit for bit but
// PG_SCORE, which only the confirmed world's tick writes (pay and loss arrive
// a round trip late, as a bump does). Returns how many it compared.
function predicted(g, inputs) {
  const due = new Map();
  let compared = 0;
  const strip = (u8) => { const r = u8.slice(); r[L.PG_SCORE] = 0; r[L.PG_SCORE + 1] = 0; return r; };
  for (let k = 0; k < inputs.length; k++) {
    for (const n of [1, 6, 30]) {
      if ((k % 7 !== 0 && n !== 1) || k + n > inputs.length) continue;
      for (let i = 0; i < n; i++) g.dv.setUint32(L.PWORDS + 4 * i, inputs[k + i], true);
      g.sim.x.predict(0, n);
      const list = due.get(k + n) || [];
      list.push({ n, from: k, player: strip(g.sim.u8.slice(L.PLAYERS + L.PRED_D, L.PLAYERS + L.PRED_D + L.PSIZE)) });
      due.set(k + n, list);
    }
    g.step([[L.EV_INPUT, 0, inputs[k]]]);
    for (const p of due.get(k + 1) || []) {
      assert.deepEqual(p.player, strip(g.sim.u8.slice(L.PLAYERS, L.PLAYERS + L.PSIZE)), `predicted ${p.n} from ${p.from}`);
      compared++;
    }
  }
  return compared;
}

test('the prediction matches the confirmed ball bit for bit (but its score): bumpers, slingshots, walls, flippers, a target standing and dropping, the drain', async () => {
  const g = await room(1, { seed: 11 });
  const T = g.T;
  const word = (x, z, o = {}) => partyWord({ yaw: yawOf(x, z), move: 1, ...o });
  // A: up into the bumpers and among them, hopping now and then, then coasting down onto the flippers as they swing
  put(g, 0, T.bumpers.at(-1).u + 0.4, T.bumpers.at(-1).w + 3.5, { vz: -4 });
  const k0 = g.v.fxCount();
  const a = [...Array.from({ length: 160 }, (_, k) => word(0.1, -1, { hop: k % 50 === 30 ? 1 : 0 })),
    ...Array.from({ length: 420 }, (_, k) => partyWord({ yaw: yawOf(1, 0.3), move: k % 90 < 40 ? 1 : 0 }))];
  assert.ok(predicted(g, a) >= a.length);
  const kinds = new Set(fxs(g.v, MC.PN_FX_KICK, k0).filter((x) => x.owner === 0).map((x) => x.shot >> 8));
  assert.ok(kinds.has(MC.PN_JBUMP), 'met a bumper');
  // B: a ball on a flipper as it swings, batted (and on into whatever it meets)
  const P = T.pivots[1][0];
  const th = MC.PN_REST * 2 * Math.PI / 16384;
  at(g, MC.PN_FWAIT + 4 * MC.PN_FPER - 8);
  put(g, 0, P.u + Math.cos(th) * T.lb * 0.6 + Math.sin(th) * 1.6, P.w + Math.sin(th) * T.lb * 0.6 - Math.cos(th) * 1.6);
  const k1 = g.v.fxCount();
  const b = Array(220).fill(partyWord({ yaw: yawOf(0, -1), move: 0 }));
  assert.ok(predicted(g, b) >= b.length);
  assert.ok(fxs(g.v, MC.PN_FX_KICK, k1).some((x) => x.owner === 0 && x.shot >> 8 === MC.PN_JBAT), `batted: ${JSON.stringify(fxs(g.v, MC.PN_FX_KICK, k1).map((x) => [x.tick, x.shot, x.size]))} ${uw(g, 0)}`);
  // C: a target hit, then rolling at it as it stands its last ticks and drops (the drop fixed since the hit)
  const Tg = T.targets[0];
  put(g, 0, -T.hw + 3.6, Tg.w, { vx: -8 });
  const c = Array(60).fill(word(-1, 0));
  assert.ok(predicted(g, c) >= c.length);
  const hit = g.dv.getUint32(L.PG_S + MC.PN_TGT + 8 * Tg.j, true);
  assert.ok(hit > 0, 'hit');
  g.held.set(0, [0, 3]);
  while (g.v.tick < hit + MC.PN_DROPT - 45) g.step();
  g.held.clear();
  put(g, 0, -T.hw + 3.2, Tg.w - 1);
  let deepest = 1e9;
  for (let k = 0; k < 12; k++) {
    const cc = Array(10).fill(word(-1, -0.7));
    assert.ok(predicted(g, cc) >= cc.length);
    deepest = Math.min(deepest, uw(g, 0)[0]);
  }
  assert.ok(deepest < Tg.u + 1, `through where it stood (${deepest})`);
  // D: down the middle of a funnel (its flippers at rest), through the drain and falling
  at(g, 0);
  put(g, 0, T.f / 2 - T.hw, T.wt - 4, { vz: 5 });
  const d = Array(150).fill(word(0, 1));
  assert.ok(predicted(g, d) >= d.length);
  assert.ok(g.v.partier(0).falling || g.v.partier(0).out, 'through the drain');
});

// Rounds of AI balls (client/party-bot.mjs, this brain), as tools/genparty.mjs plays them.
for (const [balls, ticks] of [[8, 11000], [64, 11100]]) {
  test(`a round of ${balls} AI balls on the debug build: no trap, points from all over the table, flippers used, placed by points at the time; equal on 1 and 4 threads`, async () => {
    const stats = { start: -1, over: -1, by: {}, scorers: new Set(), bats: 0, drains: 0, scores: null, places: null, pts: null, ws: [] };
    let seen = 0;
    const { log, sim, view } = await playParty({ bytes: partyBytes(true), mg: L.MG_PINBALL, seed: balls, bots: balls, ticks, delay: 8, onTick: (t, s, v) => {
      assert.equal(s.error().code, 0, 'no trap');
      for (; seen < v.fxCount(); seen++) {
        const x = v.fx(seen);
        if (x.kind === MC.PN_FX_SCORE) { stats.by[x.shot >> 8] = (stats.by[x.shot >> 8] || 0) + x.size; stats.scorers.add(x.owner); }
        if (x.kind === MC.PN_FX_KICK && x.shot >> 8 === MC.PN_JBAT) stats.bats++;
        if (x.kind === MC.PN_FX_DRAIN) stats.drains++;
      }
      const g = v.party();
      if (stats.start < 0 && g.state === L.H_PLAY) stats.start = t;
      if (g.state === L.H_PLAY && (t - stats.start) % 250 === 100) {
        for (let p = 0; p < balls; p++) { const b = v.partier(p); if (!b.out && !b.falling) stats.ws.push((b.pos[2] - C) / v.dv.getFloat32(L.PG_H + MC.PN_HL, true)); }
      }
      if (stats.over < 0 && stats.start >= 0 && g.state === L.H_OVER) {
        stats.over = t;
        const all = [...Array(balls).keys()].map((p) => v.partier(p));
        stats.scores = all.map((b) => b.score);
        stats.places = all.map((b) => b.place);
        stats.pts = all.map((b) => b.pts);
      }
    } });
    assert.equal(sim.error().code, 0);
    assert.ok(stats.over > 0, 'the round ended');
    assert.equal(stats.over - stats.start, MC.PN_LEN, 'at the time');
    const total = stats.scores.reduce((s, x) => s + x, 0);
    assert.ok(total > balls * 10, `${total} points`);
    assert.ok(stats.scorers.size >= balls * 0.85, `${stats.scorers.size} of ${balls} scored`);
    for (const w of [MC.PN_WBUMP, MC.PN_WTGT, MC.PN_WBANK, MC.PN_WSPIN]) assert.ok(stats.by[w] > 0, `points from ${w}: ${JSON.stringify(stats.by)}`);
    if (balls >= 64) assert.ok(stats.by[MC.PN_WLANE] > 0 && stats.drains > 0, `lanes ${stats.by[MC.PN_WLANE]}, drains ${stats.drains}`);
    assert.ok(stats.bats > balls, `${stats.bats} batted up`);
    // they keep off the bottom: most of the time over the funnels' tops
    const low = stats.ws.filter((w) => w > 0.7).length / stats.ws.length;
    assert.ok(low < 0.25, `${(low * 100).toFixed(0)}% of the time down by the flippers`);
    assert.ok(stats.drains < balls * 2, `${stats.drains} drains`);
    stats.scores.forEach((s, p) => assert.equal(stats.places[p], 1 + stats.scores.filter((o) => o > s).length, 'placed by points'));
    assert.ok(stats.pts.every((x) => x >= 1 && x <= 10) && stats.pts.includes(10), `points ${stats.pts}`);
    assert.equal(view.party().game, L.MG_PINBALL);
    const parsed = parseLog(log);
    const n = stats.over + 50;
    const ra = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 1, tag: 't1' });
    const rb = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 4, tag: 't4', startWorkers });
    const rd = await replay({ bytes: partyBytes(true), log: parsed, ticks: n, threads: 1, tag: 'd1' });
    assert.deepEqual([...decodeTrace(ra.trace).tickHashes], [...decodeTrace(rb.trace).tickHashes]);
    assert.deepEqual([...decodeTrace(ra.trace).tickHashes], [...decodeTrace(rd.trace).tickHashes], 'the debug build steps the same bits');
  });
}

test('the client module: draws every phase, frames the table, writes its HUD lines, its FX; its brain sees the drain, rides a flipper, hops one coming down', async () => {
  const { Scene } = await import('../client/party-render.mjs');
  assert.equal(MC.PN_FX_SCORE, L.FX_MG + 4 * L.MG_PINBALL);
  assert.deepEqual([MC.PN_FX_KICK, MC.PN_FX_DRAIN, MC.PN_FX_CALL], [MC.PN_FX_SCORE + 1, MC.PN_FX_SCORE + 2, MC.PN_FX_SCORE + 3]);
  assert.ok(pinball.hint.length <= 70, pinball.hint);
  assert.deepEqual([pinball.id, pinball.key, pinball.env], [L.MG_PINBALL, 'pinball', 'night']);
  const g = await room(6, { seed: 41, play: false });
  const out = () => ({ scene: new Scene(24000), solid: [], glow: [], beams: [], decals: [], casters: [], paint: null });
  const lines = [];
  const hctx = (o = {}) => ({ put: (x, y, s, c) => lines.push([y, s, c]), centre: (y, s, c) => lines.push([y, s, c]), right: (y, s, c) => lines.push([y, s, c]), rows: 44, C: {}, slot: 0, now: 0, ...o });
  const check = (o) => {
    assert.ok(o.scene.count > 60, `${o.scene.count} solids`);
    for (let k = 0; k < o.scene.count * 16; k++) assert.ok(Number.isFinite(o.scene.data[k]), 'finite');
    for (const s of [...o.solid, ...o.glow]) assert.ok(s.pos.every(Number.isFinite) && Number.isFinite(s.size));
    for (const d of o.decals) assert.ok(d.pos.every(Number.isFinite) && d.radius > 0);
  };
  let o = out();
  pinball.draw(g.v, { tick: g.v.tick, dt: 0, now: 0, slot: 0 }, o);
  check(o);
  while (g.v.hole().state !== L.H_PLAY) g.step();
  const T = table(g.v);
  // play: a target hit, a lane lit, the spinner turning, double time
  at(g, MC.PN_LEN - MC.PN_DOUBLE + 5);
  put(g, 0, -T.hw + 3.6, T.targets[0].w, { vx: -8 });
  put(g, 1, T.lanes[0].u, T.ltop - 1.6);
  put(g, 2, T.spinners[0].u, T.spinners[0].w - 3, { vz: 10 });
  for (let k = 0; k < 200; k++) g.step();
  const shown = [];
  for (let k = 0; k < g.v.fxCount(); k++) {
    const x = g.v.fx(k);
    if (x.kind >= MC.PN_FX_SCORE && x.kind <= MC.PN_FX_CALL) pinball.fx(x, { slot: 0, now: 100, dist: 5, name: (p) => `P${p + 1}`, glow: (e) => shown.push(e), banner: (s) => lines.push([9, s]), feed: (s) => lines.push([10, s]), sound: {} });
  }
  assert.ok(shown.length > 3);
  for (const e of shown) assert.ok(e.pos.every(Number.isFinite));
  o = out();
  lines.length = 0;
  pinball.draw(g.v, { tick: g.v.tick, dt: 0, ptick: g.v.tick + 0.5, now: 1000, slot: 0, pme: g.v.partier(0) }, o);
  check(o);
  pinball.hud(g.v, hctx({ t: g.v.party().t * TICK, me: g.v.partier(0) }));
  const text = lines.map((l) => l[1]).join(' | ');
  assert.ok(/DOUBLE SCORE/.test(text) && /TARGETS _II/.test(text) && /OF 6/.test(text), text);
  for (const l of lines) assert.ok(l[1].length <= 60);
  at(g, 100);
  lines.length = 0;
  pinball.hud(g.v, hctx({ t: 100 * TICK, me: g.v.partier(0) }));
  assert.ok(/DOUBLE IN \d+/.test(lines.map((l) => l[1]).join(' ')));
  const fr = pinball.frame(g.v);
  assert.deepEqual([fr.shape, fr.radius, fr.centre[0], fr.centre[2]], ['square', T.hl, C, C]);
  assert.ok(Math.abs(fr.centre[1] - planeY(T, 0)) < 1e-9);
  assert.equal(pinball.facing(), -Math.PI / 2);
  // the brain: the drain past the flippers, nothing up the table
  const { danger, think, hop } = pinball.brain;
  const uc = T.f / 2 - T.hw;
  assert.equal(danger(g.v, C + uc, C + T.wt + 1), 1);
  assert.ok(danger(g.v, C + uc, C + T.wt - 0.5) >= 0.8);
  assert.equal(danger(g.v, C, C - 10), 0);
  // low on the table with a lane to go for: it rides the flipper on its side
  at(g, 300);
  put(g, 3, uc - 2.5, T.wp - 3);
  const bot = { slot: 3, skill: 0.8, at: g.v.tick, pos: [C + uc - 2.5, C + T.wp - 3], vel: [0, 0], mem: {}, lag: 0 };
  const word = think(g.v, 3, bot);
  assert.ok(word && Number.isFinite(word.yaw) && word.move === 1);
  assert.ok(bot.mem.plan.rides, 'riding a flipper');
  const [gu, gw] = bot.mem.plan.goal;
  assert.ok(gu < uc && gw < T.wp + 0.5 && gw > T.wp - 3, `on the left flipper (${gu.toFixed(1)}, ${gw.toFixed(1)})`);
  // under the raised left flipper as it's about to come back down: it hops, at the right time only
  const P = T.pivots[0][0];
  const down = MC.PN_FWAIT + 2 * MC.PN_FPER + MC.PN_FUP + MC.PN_FHOLD;
  const th = ((MC.PN_UP + MC.PN_REST) / 2) * 2 * Math.PI / 16384;
  const bu = P.u + Math.cos(th) * T.lb * 0.65, bw = P.w + Math.sin(th) * T.lb * 0.65;
  put(g, 4, bu, bw);
  const hops = [];
  for (let tp = down - 40; tp < down + 20; tp++) {
    at(g, tp);
    hops.push(hop(g.v, 4, { slot: 4, skill: 0.8, at: g.v.tick, pos: [C + bu, C + bw], vel: [0, 0], mem: {}, lag: 0 }) ? tp - down : null);
  }
  const when = hops.filter((x) => x !== null);
  assert.ok(when.length > 0 && when.every((x) => x >= -24 && x <= -19), `hops at ${when}`);
});
