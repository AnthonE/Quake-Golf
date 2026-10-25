// RISING LAVA (src/mg/lava.wat): the tower and the route round it laid for
// the crowd, its floors and walls, the slider and the boulders where the
// schedule has them, the lava rising, the crown, the places; the prediction
// through all of it; rounds of AI balls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty, partyBytes, predicted } from './helpers.mjs';
import { View, partyWord, PLAT_Y } from '../src/party-view.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { playParty } from '../tools/genparty.mjs';
import * as L from '../src/layout.mjs';
import * as MC from '../src/mg/lava.mjs'; // LV_*: the minigame's own constants
import lava, { stage, floorAt, routeXZ, where, boulders, slide, lavaAt, secAt, fateOf } from '../client/mg/lava.mjs';

const C = L.B_CX;
const TICK = 0.008;
const TAU = 2 * Math.PI;
const f = Math.fround;

// A room of n balls on Rising Lava, on the debug build (a NaN traps), stepped into play unless asked not to.
async function room(n = 2, { play = true, seed = 7 } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_LAVA + 1, true);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); assert.equal(sim.error().code, 0, 'no trap'); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  while (play && v.hole().state !== L.H_PLAY) step();
  return { sim, v, dv, step };
}
const rec = (p) => L.PLAYERS + p * L.PSIZE;
// Ball p at (x, z), its bottom at y (if null the floor there: the summit, the first turn's, the shelf), moving at (vx, vy, vz).
function put(g, p, x, z, { y = null, vx = 0, vy = 0, vz = 0, ground = true } = {}) {
  const st = stage(g.v);
  const w = where(st, x, -1e9, z, {});
  g.dv.setFloat32(rec(p) + L.P_PX, x, true);
  g.dv.setFloat32(rec(p) + L.P_PY, y ?? (w.rho < MC.LV_RT ? st.ht : w.inb ? floorAt(st, w.sb, w.u, g.v.party().t, {}).top : PLAT_Y), true);
  g.dv.setFloat32(rec(p) + L.P_PZ, z, true);
  g.dv.setFloat32(rec(p) + L.P_VX, vx, true);
  g.dv.setFloat32(rec(p) + L.P_VY, vy, true);
  g.dv.setFloat32(rec(p) + L.P_VZ, vz, true);
  g.dv.setUint8(rec(p) + L.P_FL, L.PF_LIVE | (ground ? L.PF_GROUND : 0));
}
// Ball p on the route s along, u across, on its floor there; moving up the way at vt and out at vr.
function onRoute(g, p, s, u, { vt = 0, vr = 0, y = null } = {}) {
  const st = stage(g.v);
  const [x, z] = routeXZ(st, s, u);
  const a = (s / st.C) * TAU;
  put(g, p, x, z, { y: y ?? floorAt(st, s, u, g.v.party().t, {}).top, vx: -Math.sin(a) * vt + Math.cos(a) * vr, vz: Math.cos(a) * vt + Math.sin(a) * vr });
}
// Where ball p is on the route, as push reckons it.
const at = (g, p) => { const b = g.v.partier(p); return { b, ...where(stage(g.v), b.pos[0], b.pos[1], b.pos[2], {}) }; };
// A word up the way at the angle round the tower of ball p (keys, a hop).
const upWord = (g, p, move = 1, hop = 0) => {
  const b = g.v.partier(p);
  const a = Math.atan2(b.pos[2] - C, b.pos[0] - C);
  return partyWord({ yaw: Math.round((Math.atan2(Math.cos(a), -Math.sin(a)) / TAU) * 16384) & 16383, move, hop });
};
const fxs = (v, kind, from = 0) => { const out = []; for (let k = from; k < v.fxCount(); k++) { const x = v.fx(k); if (x.kind === kind) out.push(x); } return out; };
// The route's height over the shelf at s, as if floored.
const hAt = (st, s) => floorAt(st, s, 0, 0, {}).h;
// Ball p parked out of the way, over the lava as long as anything: still on the summit's stretch of the route, a spot each.
const park = (g, p) => { const st = stage(g.v); onRoute(g, p, st.send - 3, -st.w + 1.3 + 2.1 * (p % 4)); };

test('the stage for 1, 8, 64 and 256: the route as wide as the crowd wants, climbs only round the first turn, a pitch between turns, every ball on the start', async () => {
  let lastW = 0;
  const lava0 = {};
  for (const n of [1, 8, 64, 256]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party(), st = stage(g.v), sq = Math.sqrt(n);
    const W = Math.min(MC.LV_W0 + MC.LV_WK * sq, MC.LV_WMAX);
    assert.ok(Math.abs(st.W - W) < 1e-4 && st.W > lastW, `${st.W} m wide for ${n}`);
    lastW = st.W;
    assert.deepEqual([r.kind, r.len, r.respawn, r.floor, r.flags], [L.PK_SCORE, MC.LV_LEN, 0x7fffffff, PLAT_Y, L.PGF_BUMPS | L.PGF_NOKICK]);
    assert.equal(r.idle, f(MC.LV_IDLE));
    assert.ok(Math.abs(st.rb - (MC.LV_RT + W + MC.LV_SH0 + MC.LV_SHK * sq)) < 1e-3 && r.size === st.rb, 'the shelf');
    assert.ok(Math.abs(st.C - TAU * (MC.LV_RT + W / 2)) < 1e-3, 'a turn along the middle');
    // the sections end to end, the start flat, the summit last and LV_HMIN to 60 up
    const S = st.secs;
    assert.deepEqual([S[0].kind, S[0].s0, S[0].h0, S[0].h1], [MC.LV_START, 0, 0, 0]);
    assert.ok(Math.abs(S[0].len - (MC.LV_ST0 + MC.LV_STK * sq)) < 1e-3);
    for (let j = 1; j < S.length; j++) {
      assert.equal(S[j].s0, f(S[j - 1].s0 + S[j - 1].len), `section ${j} starts where ${j - 1} ends`);
      assert.equal(S[j].h0, S[j - 1].h1, `and at its height`);
      assert.ok(S[j].h1 >= S[j].h0, 'never down');
    }
    assert.equal(S.at(-1).kind, MC.LV_SUMMIT);
    assert.ok(st.hTop >= MC.LV_HMIN && st.hTop <= 60, `the summit ${st.hTop.toFixed(1)} m up`);
    assert.equal(st.send, f(S.at(-1).s0 + S.at(-1).len));
    assert.ok(st.send < MC.LV_NIDX - 1 && S.length <= MC.LV_NS);
    // round the first turn (rock down to the shelf) climbs only and no boulders; past it boulders on every ramp,
    // gaps, sliders and ledges
    for (const Q of S) {
      if (Q.s0 < st.C) assert.ok([MC.LV_START, MC.LV_RAMP, MC.LV_STEPS].includes(Q.kind) && !Q.fl, `section ${Q.j} on the first turn`);
      else if (Q.kind === MC.LV_RAMP) assert.equal(Q.fl, MC.LV_F_BOULDERS);
    }
    const kinds = new Set(S.map((Q) => Q.kind));
    assert.ok(kinds.has(MC.LV_SLIDER) && kinds.has(MC.LV_STEPS) && kinds.has(MC.LV_RAMP), `kinds ${[...kinds]}`);
    // every turn well over the one under it: a ball under a slab is never against it
    let pitch = Infinity;
    for (let s = 0; s + st.C < st.send; s += 0.25) pitch = Math.min(pitch, hAt(st, s + st.C) - hAt(st, s));
    assert.ok(pitch > MC.LV_DEEP + 3, `the least pitch ${pitch.toFixed(1)} m`);
    for (let s = 0; s < st.send; s += 0.37) { const Q = secAt(st, s); assert.ok(s >= Q.s0 && s < Q.s0 + Q.len, `the index at ${s}`); }
    // every ball on the start, on the floor, over its span, a ball's width apart
    const spots = [];
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p), w = where(st, b.pos[0], b.pos[1], b.pos[2], {});
      assert.ok(b.ground && b.pos[1] === PLAT_Y, `${n}: P${p + 1} on the floor`);
      assert.ok(w.th * st.C * (w.rho / st.rm) > 1 && w.th < st.ths && w.rho > MC.LV_RT + 1 && w.rho < st.rb - 1, `${n}: P${p + 1} on the start at ${w.th.toFixed(3)}, ${w.rho.toFixed(1)}`);
      spots.push(b.pos);
    }
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) assert.ok(Math.hypot(spots[a][0] - spots[b][0], spots[a][2] - spots[b][2]) > 2.3, `${n}: P${a + 1} and P${b + 1} apart`);
    // the lava: under the shelf, deeper for a bigger crowd, rising through its phases
    assert.ok(Math.abs(st.lav[0] - (PLAT_Y - MC.LV_L0 - MC.LV_L0K * sq)) < 1e-4, 'where it starts');
    for (let j = 0; j < MC.LV_NPH; j++) {
      const k = MC.LV_VN0 / (1 + MC.LV_VNK * sq), base = (MC.LV_V0 + j * MC.LV_VK) * k;
      assert.ok(st.rate[j] >= base * (1 - MC.LV_VJ / 2) - 1e-7 && st.rate[j] <= base * (1 + MC.LV_VJ / 2) + 1e-7, `phase ${j}'s pace`);
      assert.ok(Math.abs(st.lav[j + 1] - (st.lav[j] + st.rate[j] * MC.LV_PH)) < 1e-3, `phase ${j + 1} starts where ${j} ends`);
    }
    lava0[n] = { top: st.lav[0], pace: st.rate.slice(0, 6).reduce((a, b) => a + b) };
  }
  assert.ok(lava0[256].top < lava0[1].top && lava0[256].pace < lava0[1].pace * 0.8, 'deeper and slower for a crowd');
});

test('the floor: the start, a ramp, steps, a ledge, a gap, the summit, the plateau and the shelf; through a gap or off a ledge onto the turn under it', async () => {
  const g = await room(2, { seed: 11 });
  park(g, 1);
  const st = stage(g.v);
  const first = (k, from = 0) => st.secs.find((Q) => Q.kind === k && Q.s0 >= from);
  const ramp = first(MC.LV_RAMP, st.C), steps = first(MC.LV_STEPS), gap = first(MC.LV_GAP), ledge = first(MC.LV_LEDGE), slider = first(MC.LV_SLIDER);
  // set down over a point, a ball lands on the floor there (the JS mirror's top), and stands on it
  const land = (s, u, label) => {
    const [x, z] = routeXZ(st, s, u);
    const want = floorAt(st, s, u, g.v.party().t, {}).top;
    put(g, 0, x, z, { y: want + 1.5, ground: false });
    let k = 0;
    while (!g.v.partier(0).ground && k++ < 200) g.step();
    const w = at(g, 0);
    assert.ok(w.b.ground, `${label}: landed`);
    assert.ok(Math.abs(w.b.pos[1] - floorAt(st, w.sb, w.u, g.v.party().t, {}).top) < 2e-3, `${label}: on its floor ${w.b.pos[1]} vs ${want}`);
    return w;
  };
  land(st.secs[0].len * 0.5, 0, 'the start');
  land(ramp.s0 + ramp.len * 0.5, 1.5, 'a ramp');
  land(steps.s0 + steps.a * 2.5, -1, 'steps');
  if (ledge) land(ledge.s0 + ledge.len * 0.5, -st.w + 1.2, 'a ledge, by the tower');
  land(gap.s0 + 2, 0, 'a gap\'s run-up');
  land(st.send - 4, 0, 'the summit');
  const top = st.ht;
  put(g, 0, C + 4, C + 3, { y: top + 1, ground: false });
  for (let k = 0; k < 100 && !g.v.partier(0).ground; k++) g.step();
  assert.equal(g.v.partier(0).pos[1], f(top), 'the tower\'s top');
  // over a gap: down through it onto the turn under it
  const s = gap.s0 + gap.a + gap.g / 2, [x, z] = routeXZ(st, s, 0);
  put(g, 0, x, z, { y: PLAT_Y + gap.h0 + 0.2, ground: false });
  for (let k = 0; k < 300 && !g.v.partier(0).ground; k++) g.step();
  let w = at(g, 0);
  assert.ok(w.b.ground && Math.abs(w.b.pos[1] - floorAt(st, s - st.C, 0, 0, {}).top) < 1e-3 && w.kb === Math.floor(s / st.C) - 1, `through the gap onto the turn under it: ${w.b.pos[1] - PLAT_Y}`);
  // a ledge's outside: the same
  if (ledge) {
    const s2 = ledge.s0 + ledge.len / 2, [x2, z2] = routeXZ(st, s2, st.w - 1.2);
    put(g, 0, x2, z2, { y: PLAT_Y + hAt(st, s2) + 0.2, ground: false });
    for (let k = 0; k < 300 && !g.v.partier(0).ground; k++) g.step();
    w = at(g, 0);
    assert.ok(w.b.ground && w.kb === Math.floor(s2 / st.C) - 1, 'off a ledge\'s outside onto the turn under it');
  }
  // a slider's gap: the platform's top where it is, nothing beside it
  const t = g.v.party().t, o = slide(slider, t);
  assert.ok(floorAt(st, slider.s0 + slider.a + o + 1, 0, t, {}).top > 0 && floorAt(st, slider.s0 + slider.a + o + MC.LV_SL_L + 0.1, 0, t, {}).top < -999 === (o < slider.d - 0.2));
  // the shelf to its rim, nothing past it
  const a = 0.5 * TAU;
  put(g, 0, C + (st.ro + 4) * Math.cos(a), C + (st.ro + 4) * Math.sin(a), { y: PLAT_Y + 1, ground: false });
  for (let k = 0; k < 100 && !g.v.partier(0).ground; k++) g.step();
  assert.equal(g.v.partier(0).pos[1], PLAT_Y, 'the shelf');
  assert.equal(g.v.hole().state, L.H_PLAY);
});

test('the walls: the tower, a riser (a hop climbs it from a standstill), the first turn\'s face from the shelf and its end behind the start, the rail', async () => {
  const g = await room(2, { seed: 12 });
  park(g, 1);
  const st = stage(g.v);
  const ramp = st.secs.find((Q) => Q.kind === MC.LV_RAMP && Q.s0 > st.C);
  // the tower: a ball rolling into it is held off it, bounced
  onRoute(g, 0, ramp.s0 + 10, -st.w + 1.03, { vr: -9 });
  g.step();
  let w = at(g, 0);
  assert.ok(Math.abs(w.rho - (MC.LV_RT + 1)) < 1e-3, `held off the tower: ${w.rho}`);
  assert.ok((w.b.vel[0] * (w.b.pos[0] - C) + w.b.vel[2] * (w.b.pos[2] - C)) / w.rho > 0, 'bounced off it');
  // the rail: rolling out at the outer edge, kept on
  onRoute(g, 0, ramp.s0 + 10, st.w - 1.03, { vr: 9 });
  g.step();
  w = at(g, 0);
  assert.ok(Math.abs(w.rho - (st.ro - 1)) < 1e-3 && w.b.ground, `held in by the rail: ${(w.rho - st.ro).toFixed(3)}`);
  // a riser: rolling into it with no hop, held on the tread under it
  const steps = st.secs.find((Q) => Q.kind === MC.LV_STEPS);
  const riser = steps.s0 + steps.a;
  onRoute(g, 0, riser - 2.5, 0, { vt: 4 });
  for (let k = 0; k < 60; k++) g.step([[L.EV_INPUT, 0, upWord(g, 0, 1)]]);
  w = at(g, 0);
  const rs = st.rm / w.rho;
  assert.ok(w.sb <= riser - rs + 1e-3 && w.sb > riser - rs - 0.5 && Math.abs(w.b.pos[1] - (PLAT_Y + steps.h0)) < 1e-4, `held at the riser: ${(riser - w.sb).toFixed(3)} short`);
  // a hop from there, no run at it: up on the tread over it
  let up = false;
  for (let k = 0; k < 150 && !up; k++) {
    g.step([[L.EV_INPUT, 0, upWord(g, 0, 1, k < 4 ? 1 : 0)]]);
    w = at(g, 0);
    up = w.b.ground && Math.abs(w.b.pos[1] - (PLAT_Y + steps.h0 + MC.LV_STEP_H)) < 1e-4;
  }
  assert.ok(up, 'a hop climbs the step');
  g.step([[L.EV_INPUT, 0, partyWord({ yaw: 0 })]]);
  // the first turn's outer face: a ball on the shelf rolling in at it, where the turn is a few metres up
  const sf = st.secs[1].s0 + st.secs[1].len * 0.6, af = (sf / st.C) * TAU;
  assert.ok(hAt(st, sf) > 2, 'the first turn up a way there');
  put(g, 0, C + (st.ro + 1.2) * Math.cos(af), C + (st.ro + 1.2) * Math.sin(af), { vx: -Math.cos(af) * 8, vz: -Math.sin(af) * 8 });
  for (let k = 0; k < 10; k++) g.step();
  w = at(g, 0);
  assert.ok(w.rho >= st.ro + 1 - 1e-3 && w.b.pos[1] === PLAT_Y, `kept out of its rock: ${(w.rho - st.ro).toFixed(3)}`);
  // its end behind the start: rolling back off the start into it, held at the face
  put(g, 0, C + st.rm, C + 1.6, { vz: -7 });
  for (let k = 0; k < 15; k++) g.step();
  const b = g.v.partier(0);
  assert.ok(b.pos[2] - C >= 1 - 1e-4 && b.pos[1] === PLAT_Y && b.vel[2] >= 0, `held at the first turn's end: ${(b.pos[2] - C).toFixed(3)}`);
});

test('a slider\'s platform goes to and fro on its schedule and carries a ball standing on it', async () => {
  const g = await room(2, { seed: 13 });
  park(g, 1);
  const st = stage(g.v);
  const S = st.secs.find((Q) => Q.kind === MC.LV_SLIDER);
  // the schedule: still at each end LV_SL_DW, across in between, back
  const os = Array.from({ length: S.p }, (_, t) => slide(S, t));
  assert.ok(Math.max(...os) === S.d && Math.min(...os) === 0);
  assert.equal(os.filter((o) => o === 0).length, MC.LV_SL_DW + 1, 'still at the near end (and the tick it turns)');
  assert.equal(os.filter((o) => o === S.d).length, MC.LV_SL_DW + 1);
  // a ball on the platform, still, no keys: it goes where the platform goes
  let t = g.v.party().t;
  const near = S.s0 + S.a;
  onRoute(g, 0, near + slide(S, t) + MC.LV_SL_L / 2, -1);
  const off0 = at(g, 0).sb - (near + slide(S, t));
  let moved = 0;
  for (let k = 0; k < S.p; k++) {
    g.step();
    t = g.v.party().t;
    const w = at(g, 0);
    assert.ok(w.b.ground && Math.abs(w.b.pos[1] - (PLAT_Y + S.h0)) < 1e-4, `on it at ${k}`);
    const off = w.sb - (near + slide(S, t));
    assert.ok(Math.abs(off - off0) < 0.03, `with it: ${(off - off0).toFixed(3)} at ${k}`);
    moved = Math.max(moved, Math.abs(w.sb - near - MC.LV_SL_L / 2));
  }
  assert.ok(moved > S.d * 0.9, `carried ${moved.toFixed(2)} m`);
});

test('boulders roll down the ramps past the first turn where the schedule has them; one knocks a ball in its lane back down, up, out of it', async () => {
  const g = await room(2, { seed: 14 });
  park(g, 1);
  const st = stage(g.v);
  const R = st.secs.find((Q) => Q.kind === MC.LV_RAMP && Q.fl & MC.LV_F_BOULDERS);
  assert.ok(R && R.p >= 1 && R.p <= MC.LV_BLMAX && R.s0 >= st.C);
  // the first one past its drop, well up the ramp: a ball still in its lane a few metres under it
  let B = null;
  for (let i = 0; i < 4000 && !B; i++) {
    g.step();
    B = boulders(st, R, g.v.party().t).find((x) => x.drop === 0 && x.s > R.s0 + R.len * 0.6);
  }
  assert.ok(B, 'a boulder rolling');
  assert.ok(B.v >= MC.LV_BV0 && B.v <= MC.LV_BV0 + MC.LV_BVK && Math.abs(B.u) <= st.w);
  onRoute(g, 0, B.s - 5, B.u);
  const n0 = g.v.fxCount();
  let hit = null;
  for (let i = 0; i < 200 && !hit; i++) {
    onRoute(g, 0, at(g, 0).sb, B.u);
    g.step();
    hit = fxs(g.v, MC.LV_FX_HIT, n0).find((x) => x.owner === 0);
  }
  assert.ok(hit, 'hit');
  assert.equal(hit.shot >> 8, R.j, 'by a boulder of that ramp');
  const w = at(g, 0);
  const vt = (w.b.vel[0] * -(w.b.pos[2] - C) + w.b.vel[2] * (w.b.pos[0] - C)) / w.rho;
  assert.ok(vt < -MC.LV_BKICK * 0.8, `knocked down the ramp at ${vt.toFixed(1)} m/s`);
  assert.equal(w.b.vel[1], f(MC.LV_BPOP));
  assert.ok(!w.b.ground);
  // out of the boulder as the client's mirror has it on the tick it hit
  const H = boulders(st, R, hit.tick - g.v.party().start).find((x) => x.l === ((hit.shot >> 4) & 15) && (x.k & 15) === (hit.shot & 15));
  assert.ok(H, 'the mirror has it');
  const d = Math.hypot(w.b.pos[0] - H.x, w.b.pos[1] + 1 - H.y, w.b.pos[2] - H.z);
  assert.ok(d >= MC.LV_BR + 1 - 0.02, `out of it: ${d.toFixed(3)}`);
  assert.ok(Math.abs(Math.hypot(hit.pos[0] - H.x, hit.pos[2] - H.z) - MC.LV_BR) < 0.02, 'the FX on its skin');
  assert.ok(hit.size >= MC.LV_BKICK, `kicked ${hit.size.toFixed(1)} m/s`);
});

test('the lava: still till LV_STILL, then up through its table, the pace said each phase; a ball whose centre goes under is out, scored the tick, credited', async () => {
  const g = await room(3, { seed: 15 });
  const st = stage(g.v);
  for (const p of [1, 2]) park(g, p);
  // into it off the shelf's rim, knocked by P2 a moment ago
  const a = 0.25 * TAU;
  put(g, 0, C + (st.rb + 2) * Math.cos(a), C + (st.rb + 2) * Math.sin(a), { y: PLAT_Y, ground: false });
  g.dv.setUint8(rec(0) + L.B_HITBY, 1);
  g.dv.setUint16(rec(0) + L.B_HITT, 200, true);
  const n0 = g.v.fxCount();
  let k = 0;
  while (!g.v.partier(0).out && k++ < 300) g.step();
  const b = g.v.partier(0), t = (b.outAt - g.v.party().start) | 0;
  assert.ok(b.out && b.pos[1] + 1 < st.lav[0] && b.pos[1] + 1 + 0.2 > st.lav[0], `out as its centre went under: ${b.pos[1] + 1 - st.lav[0]}`);
  assert.deepEqual([b.score, b.m, b.vel], [t, MC.LV_M_BURN | t, [0, 0, 0]]);
  const burn = fxs(g.v, MC.LV_FX_BURN, n0);
  assert.deepEqual(burn.map((x) => [x.owner, x.shot]), [[0, 1]], 'P2 knocked it in');
  assert.equal(g.v.partier(1).kos, 1);
  assert.equal(g.dv.getUint32(L.PG_H + MC.LV_BURN, true), 1);
  // the lava's top, tick by tick, as its table says (the client's mirror the same)
  const lavaFx = [];
  let seen = g.v.fxCount();
  while (g.v.party().t < MC.LV_STILL + 2 * MC.LV_PH + 5) {
    for (const p of [1, 2]) park(g, p);
    g.step();
    for (; seen < g.v.fxCount(); seen++) { const x = g.v.fx(seen); if (x.kind === MC.LV_FX_LAVA) lavaFx.push(x); }
  }
  assert.deepEqual(lavaFx.map((x) => [x.shot, x.tick - g.v.party().start]), [[0, MC.LV_STILL], [1, MC.LV_STILL + MC.LV_PH], [2, MC.LV_STILL + 2 * MC.LV_PH]]);
  assert.ok(Math.abs(lavaFx[1].size - st.rate[1] * 125) < 1e-4 && lavaFx[2].size > lavaFx[1].size * 0.5);
  assert.equal(lavaAt(st, 0), lavaAt(st, MC.LV_STILL));
  assert.ok(lavaAt(st, MC.LV_STILL + 10) > lavaAt(st, MC.LV_STILL) && Math.abs(lavaAt(st, MC.LV_STILL + MC.LV_PH) - st.lav[1]) < 1e-3);
  assert.equal(g.v.hole().state, L.H_PLAY, 'two still in');
});

test('the crown: home in the order touched (a tick\'s share it), parked over the summit; the end: home, then the climbers by height, then the lava\'s, the last in first', async () => {
  const g = await room(6, { seed: 16 });
  const st = stage(g.v);
  // P1 and P2 at the crown on the same tick, P3 the next
  put(g, 0, C + 1, C);
  put(g, 1, C - 1, C + 0.5);
  for (const p of [2, 3, 4, 5]) park(g, p);
  const n0 = g.v.fxCount();
  g.step();
  const t1 = g.v.tick - 1;
  for (const p of [0, 1]) {
    const b = g.v.partier(p);
    assert.ok(b.out, `P${p + 1} home`);
    assert.deepEqual([b.m, b.score, b.outAt], [MC.LV_M_FIN | 1, MC.LV_SC_FIN, t1]);
    assert.ok(Math.abs(b.pos[1] - (st.ht + MC.LV_PARK_Y)) < 1e-4 && b.vel.every((x) => x === 0), 'parked over the summit');
    assert.deepEqual(fateOf(b.m), { kind: 'home', n: 1 });
  }
  assert.notDeepEqual(g.v.partier(0).pos, g.v.partier(1).pos);
  put(g, 2, C, C - 2);
  g.step();
  assert.deepEqual([g.v.partier(2).m, g.v.partier(2).score], [MC.LV_M_FIN | 3, MC.LV_SC_FIN - 2]);
  assert.deepEqual(fxs(g.v, MC.LV_FX_CROWN, n0).map((x) => [x.owner, x.shot]), [[0, 1], [1, 1], [2, 3]]);
  assert.equal(g.dv.getUint32(L.PG_H + MC.LV_FIN, true), 3);
  // P4 into the lava, P5 a while later; P6 climbing, up a ramp past the first turn
  const into = (p) => { const a = 0.3 * TAU; put(g, p, C + (st.rb + 2) * Math.cos(a), C + (st.rb + 2) * Math.sin(a), { y: PLAT_Y - 1, ground: false }); };
  into(3);
  for (let k = 0; k < 120; k++) { park(g, 4); g.step(); }
  into(4);
  for (let k = 0; k < 120; k++) g.step();
  assert.ok(g.v.partier(3).out && g.v.partier(4).out && g.v.partier(4).score > g.v.partier(3).score, 'the later the higher');
  const ramp = st.secs.find((Q) => Q.kind === MC.LV_RAMP && Q.s0 > st.C);
  onRoute(g, 5, ramp.s0 + 1, 0);
  g.dv.setUint32(rec(5) + L.PG_M, 0, true);
  for (let k = 0; k < 3; k++) g.step();
  const m = g.v.partier(5).m;
  assert.ok(Math.abs(m - (g.v.partier(5).pos[1] - PLAT_Y) * 100) < 30, `its best height ${m} cm`);
  // the clock: placed and paid
  g.dv.setUint32(L.HDR_UNTIL, g.v.tick, true);
  g.step();
  const r = g.v.party();
  assert.equal(r.state, L.H_OVER);
  assert.equal(g.v.partier(5).score, MC.LV_SC_IN + g.v.partier(5).m);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((p) => g.v.partier(p).place), [1, 1, 3, 6, 5, 4]);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((p) => g.v.partier(p).pts), [10, 10, 6, 1, 2, 4]);
  assert.equal(r.winner, 255, 'a shared win');
});

test('over when nobody is climbing; a ball in late comes in over the start', async () => {
  const g = await room(2, { seed: 17 });
  g.step([[L.EV_JOIN, 4]]);
  const st = stage(g.v);
  const b = g.v.partier(4), w = where(st, b.pos[0], b.pos[1], b.pos[2], {});
  assert.ok(b.live && !b.out && w.th < st.ths && w.rho > MC.LV_RT && w.rho < st.rb, 'in over the start');
  for (let k = 0; k < 200 && !g.v.partier(4).ground; k++) g.step();
  assert.equal(g.v.partier(4).pos[1], PLAT_Y);
  // all three home: over
  put(g, 0, C + 1, C); put(g, 1, C - 1, C); put(g, 4, C, C + 1.5);
  g.step();
  assert.equal(g.v.party().state, L.H_OVER);
  assert.deepEqual([0, 1, 4].map((p) => g.v.partier(p).place), [1, 1, 1]);
});

test('the prediction matches the confirmed ball bit for bit: up a ramp into boulders, up steps hopping, over a gap, onto the slider, along the walls', async () => {
  const g = await room(2, { seed: 18 });
  park(g, 1);
  const st = stage(g.v);
  const R = st.secs.find((Q) => Q.kind === MC.LV_RAMP && Q.fl & MC.LV_F_BOULDERS);
  const n0 = g.v.fxCount();
  // up a boulder ramp in a lane, hitting what comes down it
  let B = null;
  for (let i = 0; i < 4000 && !B; i++) { park(g, 1); g.step(); B = boulders(st, R, g.v.party().t).find((x) => x.drop === 0 && x.s > R.s0 + R.len * 0.5); }
  const s0 = Math.max(R.s0 + 2, B.s - 12);
  onRoute(g, 0, s0, B.u);
  const word = (move = 1, hop = 0) => upWord(g, 0, move, hop);
  // along the chord to where they'll meet, about
  const [mx, mz] = routeXZ(st, (s0 + B.s) / 2 + 1, B.u), b0 = g.v.partier(0);
  const chord = partyWord({ yaw: Math.round((Math.atan2(mz - b0.pos[2], mx - b0.pos[0]) / TAU) * 16384) & 16383, move: 1 });
  let compared = predicted(g, Array.from({ length: 250 }, (_, k) => (k % 90 < 70 ? chord : partyWord({ yaw: 0 }))));
  assert.ok(fxs(g.v, MC.LV_FX_HIT, n0).some((x) => x.owner === 0), 'hit by a boulder');
  // up steps, hopping now and then
  const S = st.secs.find((Q) => Q.kind === MC.LV_STEPS && Q.s0 > st.C) || st.secs.find((Q) => Q.kind === MC.LV_STEPS);
  onRoute(g, 0, S.s0 + 0.5, 0);
  compared += predicted(g, Array.from({ length: 200 }, (_, k) => word(1, k % 40 < 3 ? 1 : 0)));
  assert.ok(at(g, 0).b.pos[1] > PLAT_Y + S.h0 + 0.5, 'up a step or more');
  // a run at a gap, a hop over it (or not)
  const G = st.secs.find((Q) => Q.kind === MC.LV_GAP);
  if (G) {
    onRoute(g, 0, G.s0 + 0.5, -st.w + 2);
    compared += predicted(g, Array.from({ length: 160 }, (_, k) => word(1, k > 60 && k < 66 ? 1 : 0)));
  }
  // onto the slider and along its platform, into the rail
  const P = st.secs.find((Q) => Q.kind === MC.LV_SLIDER);
  onRoute(g, 0, P.s0 + P.a + slide(P, g.v.party().t) + 2, 0);
  compared += predicted(g, Array.from({ length: 160 }, (_, k) => (k < 80 ? partyWord({ yaw: 0 }) : word(1))));
  assert.ok(compared >= 900, `${compared} compared`);
  assert.equal(g.v.hole().state, L.H_PLAY);
});

for (const [balls, ticks] of [[8, 11000], [64, 13000]]) {
  test(`a round of ${balls} AI balls on the debug build: no trap, they climb, the crown taken in order, the round ends, the rest placed; equal on 1 and 4 threads`, async () => {
    const bytes = partyBytes(true);
    const st = { start: -1, over: -1, crowns: [], burns: [], hits: 0, mirror: 0, places: null, pts: null, best: 0 };
    let seen = 0;
    const r = await playParty({ bytes, seed: balls + 3, mg: L.MG_LAVA, bots: balls, ticks, onTick: (t, sim, v) => {
      const h = v.hole();
      if (st.over >= 0) return;
      if (st.start < 0 && h.state === L.H_PLAY) st.start = h.start;
      for (; seen < v.fxCount(); seen++) {
        const x = v.fx(seen);
        if (st.start < 0) continue;
        if (x.kind === MC.LV_FX_CROWN) st.crowns.push([x.owner, x.shot, x.size]);
        if (x.kind === MC.LV_FX_BURN) st.burns.push([x.owner, (x.tick - st.start) * TICK]);
        if (x.kind === MC.LV_FX_HIT) {
          st.hits++;
          // the client's mirror of the schedule has the boulder where the sim hit it
          const s = stage(v), R = s.secs[x.shot >> 8];
          const B = boulders(s, R, x.tick - st.start).find((y) => y.l === ((x.shot >> 4) & 15) && (y.k & 15) === (x.shot & 15));
          if (B && Math.abs(Math.hypot(x.pos[0] - B.x, x.pos[2] - B.z) - MC.LV_BR) < 0.02) st.mirror++;
        }
      }
      if (h.state === L.H_PLAY && (t & 63) === 0) for (let p = 0; p < balls; p++) st.best = Math.max(st.best, v.partier(p).m & 0xfffffff);
      if (h.state === L.H_OVER) {
        st.over = t;
        st.places = [...Array(balls).keys()].map((p) => v.partier(p).place);
        st.pts = [...Array(balls).keys()].map((p) => v.partier(p).pts);
      }
    } });
    assert.equal(r.sim.error().code, 0);
    assert.ok(st.over > 0, 'the round ended');
    assert.ok(st.crowns.length >= Math.ceil(balls / 4), `${st.crowns.length} of ${balls} home`);
    assert.ok(st.crowns[0][2] > 30, `the first home in ${st.crowns[0][2].toFixed(1)} s`);
    assert.ok(st.crowns.every(([, n], i) => n <= i + 1 && (i === 0 || n >= st.crowns[i - 1][1])), 'in order');
    assert.ok(st.burns.every(([, s]) => s > 3), `none in the lava at once: ${st.burns.map((x) => x[1].toFixed(0))}`);
    assert.ok(st.hits > 0 && st.mirror === st.hits, `${st.hits} boulder hits, ${st.mirror} where the client draws it`);
    assert.ok(st.places.every((x) => x >= 1 && x <= balls), `places ${st.places}`);
    assert.ok(st.pts.every((x) => x >= 1 && x <= 10) && st.pts.includes(10), `points ${st.pts}`);
    const parsed = parseLog(r.log);
    const a = await replay({ bytes: partyBytes(), log: parsed, ticks, threads: 1, tag: 'l1' });
    const b = await replay({ bytes: partyBytes(), log: parsed, ticks, threads: 4, tag: 'l4', startWorkers });
    const d = await replay({ bytes, log: parsed, ticks, threads: 1, tag: 'ld' });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(d.trace).tickHashes], 'the debug build steps the same bits');
  });
}

test('the client module: draws the stage through the countdown and play, frames it, writes its HUD lines, its brain sees the drops, the lava and the way up', async () => {
  const { Scene } = await import('../client/party-render.mjs');
  const g = await room(3, { play: false, seed: 21 });
  const out = { scene: new Scene(24000), solid: [], glow: [], beams: [], decals: [], casters: [], paint: null };
  const lines = [];
  const hctx = { put: (x, y, str, c) => lines.push([y, str, c, x]), centre: (y, str, c) => lines.push([y, str, c, 0]), right: (y, str, c) => lines.push([y, str, c, 79 - String(str).length]), rows: 44, C: {}, slot: 0, now: 0 };
  for (let k = 0; k < 2400; k++) {
    if (k % 600 === 100) {
      for (const a of [out.solid, out.glow, out.decals, out.casters]) a.length = 0;
      out.scene.clear();
      lines.length = 0;
      lava.draw(g.v, { tick: g.v.tick, dt: 0, now: k * 8, slot: 0, cam: [C + 30, PLAT_Y + 10, C] }, out);
      assert.ok(out.scene.count > 400, `${out.scene.count} solids`);
      for (let i = 0; i < out.scene.count * 16; i++) assert.ok(Number.isFinite(out.scene.data[i]), 'finite');
      lava.hud(g.v, { ...hctx, me: g.v.partier(0) });
      for (const l of lines) assert.ok(l[3] + l[1].length <= 80, l[1]);
      if (g.v.hole().state === L.H_PLAY) assert.ok(lines.some((l) => /M UP/.test(l[1])) && lines.some((l) => /LAVA/.test(l[1])), lines.map((l) => l[1]).join(' | '));
    }
    g.step();
  }
  const st = stage(g.v);
  const fr = lava.frame(g.v);
  assert.equal(fr.shape, 'disc');
  assert.equal(fr.radius, st.rb);
  assert.ok(lava.hint.length <= 70 && lava.rules.length <= 70 && lava.ownScore && lava.outForGood);
  // facing up the route round the tower
  const b = g.v.partier(0), a = Math.atan2(b.pos[2] - C, b.pos[0] - C), fy = lava.facing(g.v, 0);
  assert.ok(Math.abs(Math.cos(fy) * -Math.sin(a) + Math.sin(fy) * Math.cos(a) - 1) < 1e-9);
  // the brain: off the shelf deadly, a gap deadly, the route ahead clear; the goal ahead up the route
  const T = g.v.tick;
  const [ox, oz] = [C + (st.rb + 1), C];
  assert.equal(lava.brain.danger(g.v, ox, oz, T, b), 1);
  const ramp = st.secs.find((Q) => Q.kind === MC.LV_RAMP && Q.s0 > st.C), G = st.secs.find((Q) => Q.kind === MC.LV_GAP || Q.kind === MC.LV_SLIDER);
  onRoute(g, 1, G.s0 + 1, 0);
  const me = g.v.partier(1);
  const [gx, gz] = routeXZ(st, G.s0 + G.a + 0.5, 0);
  assert.ok(G.kind === MC.LV_SLIDER || lava.brain.danger(g.v, gx, gz, T, me) === 1, 'the gap');
  const goal = lava.brain.goal(g.v, me, { mem: {}, pos: [me.pos[0], me.pos[2]], vel: [0, 0] });
  const wg = where(st, goal[0], me.pos[1], goal[1], {}), wm = where(st, me.pos[0], me.pos[1], me.pos[2], {});
  let sg = (wg.th + wm.kb) * st.C;
  if (sg - wm.sb > st.C / 2) sg -= st.C; else if (wm.sb - sg > st.C / 2) sg += st.C;
  assert.ok(sg > wm.sb + 3, `the goal up the route from it: ${(sg - wm.sb).toFixed(1)} m`);
  onRoute(g, 1, ramp.s0 + 4, 0);
  const [rx, rz] = routeXZ(st, ramp.s0 + 6, 0);
  assert.ok(lava.brain.danger(g.v, rx, rz, T, g.v.partier(1)) < 1, 'up the ramp');
  // fx: no throw for each kind
  const ctx = { slot: 0, glow: () => {}, banner: () => {}, feed: () => {}, name: (p) => `P${p + 1}`, dist: 10, sound: {}, C: {}, now: 0 };
  lava.fx({ kind: MC.LV_FX_BURN, owner: 0, shot: 1, pos: [C, PLAT_Y, C], size: 12 }, ctx);
  lava.fx({ kind: MC.LV_FX_CROWN, owner: 1, shot: 1, pos: [C, st.ht, C], size: 44 }, ctx);
  lava.fx({ kind: MC.LV_FX_HIT, owner: 2, shot: 0x210, pos: [C, PLAT_Y, C], size: 8 }, ctx);
  lava.fx({ kind: MC.LV_FX_LAVA, owner: 255, shot: 1, pos: [C, PLAT_Y, C], size: 0.4 }, ctx);
});
