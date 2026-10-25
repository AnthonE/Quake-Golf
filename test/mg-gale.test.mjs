// GALE FORCE (src/mg/gale.wat): the course laid out for the crowd, its floors
// (bridges, decks, stairs, gaps and their faces, the upper deck), the wind on
// its clock (a fan's gusts and its warning, a tunnel's headwind, a vent's
// lift, a windmill's blades), downs and comebacks, home and the places, the
// prediction through all of it, and rounds of AI balls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty, partyBytes, predicted } from './helpers.mjs';
import { View, partyWord } from '../src/party-view.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { playParty, partySeed } from '../tools/genparty.mjs';
import gale, { course, mainAt, mainh, under, floorAt, pieceAt, fanA, fanNext, fanWarn, tunA, ventOn, ventNext, ventLeft, bladeGap, standings } from '../client/mg/gale.mjs';
import * as L from '../src/layout.mjs';
import * as MC from '../src/mg/gale.mjs'; // GF_*: the minigame's own constants

const TICK = 0.008;
const TURN = 16384;
const f32 = Math.fround;
const P_STEP = Number(L.P_STEP);

// A room of n balls on Gale Force, on the debug build (a NaN traps), stepped into play unless asked not to.
async function room(n = 2, { play = true, seed = 7 } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_GALE + 1, true);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); assert.equal(sim.error().code, 0, 'no trap'); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  while (play && v.hole().state !== L.H_PLAY) step();
  return { sim, v, dv, step, c: course(v) };
}
const rec = (p) => L.PLAYERS + p * L.PSIZE;
// Ball p at (x, y, z) (y its bottom), moving v, on the ground or not; its best place along `best` m.
function put(g, p, [x, y, z], { v = [0, 0, 0], ground = true, best = null } = {}) {
  const a = rec(p);
  [x, y, z].forEach((q, i) => g.dv.setFloat32(a + L.P_PX + 4 * i, q, true));
  v.forEach((q, i) => g.dv.setFloat32(a + L.P_VX + 4 * i, q, true));
  g.dv.setUint8(a + L.P_FL, L.PF_LIVE | (ground ? L.PF_GROUND : 0));
  if (best !== null) g.dv.setUint32(a + L.PG_M, Math.round(Math.max(0, best) * 100), true);
}
// Out of the way: on the start pad, at rest.
const park = (g, p, u = 0) => { const S = g.c.main[0]; put(g, p, [S.x0 + 4, S.h, S.z + u], { best: 0 }); };
const fxs = (v, kind, from = 0) => { const out = []; for (let k = from; k < v.fxCount(); k++) { const f = v.fx(k); if (f.kind === kind) out.push(f); } return out; };
const word = (yaw, o = {}) => partyWord({ yaw: Math.round(yaw / (2 * Math.PI) * TURN) & (TURN - 1), move: 1, ...o });
const still = partyWord({ yaw: 0, move: 0 });
const of = (c, sec) => c.main.filter((P) => P.sec === sec);
const hz = (c, kind) => c.hazards.filter((H) => H.kind === kind);
// Ticks into play (as $p_t counts the tick about to be stepped).
const tp = (g) => g.v.party().t;
// Steps until tick t into play.
function until(g, t, recs = []) { while (tp(g) < t) g.step(recs); }

test('the course for 1, 8, 64 and 256: one run of pieces along +x from the start pad to the pen, every joint closed, every section in it, 300 to 400 m, a grid for the crowd', async () => {
  let lastW = 0;
  for (const n of [1, 8, 64, 256]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party();
    const c = g.c;
    const w = f32(Math.min(f32(f32(f32(Math.sqrt(n)) * f32(MC.GF_WK)) + f32(MC.GF_W0)), MC.GF_WMAX));
    assert.equal(c.w, w, `${n}: a bridge's half-width`);
    assert.equal(c.wd, f32(w * f32(MC.GF_DECKK)), 'a deck\'s');
    assert.ok(c.w > lastW, 'wider for a crowd');
    lastW = c.w;
    assert.deepEqual([r.kind, r.len, r.respawn, r.flags], [L.PK_SCORE, MC.GF_LEN, MC.GF_BACK, L.PGF_BUMPS | L.PGF_NOKICK]);
    assert.equal(r.idle, f32(MC.GF_IDLE));
    // the sections: two fan bridges, the rest once each, a deck before all but the first, the start pad and the finish
    const secs = c.main.map((P) => P.sec);
    assert.equal(secs[0], MC.GF_S_START);
    assert.deepEqual(secs.slice(-2), [MC.GF_S_FINISH, MC.GF_S_FINISH]);
    assert.equal(of(c, MC.GF_S_DECK).length, 7, 'seven decks');
    assert.equal(of(c, MC.GF_S_FANS).length, 2);
    for (const s of [MC.GF_S_MILL, MC.GF_S_TUNNEL, MC.GF_S_VENT]) assert.equal(of(c, s).length, 1, `${n}: section ${s}`);
    assert.equal(of(c, MC.GF_S_STAIRS).length, 3, 'a flight up, the top, a flight down');
    assert.equal(of(c, MC.GF_S_GAPS).filter((P) => P.fl & MC.GF_F_GAP).length, 2, 'two gaps');
    assert.ok(![MC.GF_S_GAPS, MC.GF_S_MILL].includes(secs[1]), 'never the gaps or the windmills first');
    assert.equal(c.upper.length, 1);
    for (const P of of(c, MC.GF_S_DECK)) assert.ok(P.fl & MC.GF_F_CHECK && P.w === c.wd, 'a deck: a checkpoint, wide');
    // the main way: each piece where the last ended, its floor a step up at most (a landing past a gap lower), held across
    for (let k = 1; k < c.main.length; k++) {
      const A = c.main[k - 1], B = c.main[k];
      assert.equal(B.x0, A.x1, `${n}: piece ${B.k} starts where ${A.k} ends`);
      const rise = floorAt(B, B.x0) - floorAt(A, A.x1 - 1e-3);
      if (B.fl & MC.GF_F_FACE) assert.ok(Math.abs(rise + MC.GF_GAPDROP) < 1e-4, 'a landing GF_GAPDROP lower');
      else if (B.fl & MC.GF_F_GAP) assert.equal(B.h, A.h);
      else assert.ok(rise <= P_STEP && rise >= -2.5, `${n}: ${rise} m from ${A.k} to ${B.k}`);
      if (!(A.fl & MC.GF_F_GAP) && !(B.fl & MC.GF_F_GAP)) {
        const [lo, hi] = A.w <= B.w ? [A, B] : [B, A];
        assert.ok(Math.abs(lo.z - hi.z) + lo.w <= hi.w + 1e-3, `${n}: the narrower of ${A.k} and ${B.k} is within the wider`);
      }
    }
    for (const P of c.main) if (P.sl > 0) assert.ok(Math.abs(P.sh) <= P_STEP && P.ns === MC.GF_STAIR_N, 'stairs a ball rolls up');
    const len = c.fin - c.x0line;
    assert.ok(len > 300 && len < 400, `${n}: the line ${len.toFixed(0)} m on`);
    assert.ok(c.pieces.every((P) => Math.abs(P.z - c.main[0].z) <= MC.GF_ZMAX + 1e-3), 'within GF_ZMAX across');
    // centred on the stage's centre, PG_SIZE its half span, PG_FLOOR its lowest floor
    const [x0, z0, x1, z1] = c.box;
    assert.ok(Math.abs((x0 + x1) / 2 - L.B_CX) < 0.01 && Math.abs((z0 + z1) / 2 - L.B_CX) < 0.01, 'centred');
    assert.ok(Math.abs(r.size - Math.max(x1 - x0, z1 - z0) / 2) < 0.01);
    assert.equal(r.floor, Math.min(...c.pieces.map((P) => Math.min(P.h, floorAt(P, P.x1)))));
    // the grid: every ball on the start pad, on its floor, inside its walls, apart
    const S = c.main[0];
    const spots = [];
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p);
      assert.ok(b.pos[0] > S.x0 + 4 && b.pos[0] < S.x1 && Math.abs(b.pos[2] - S.z) < S.w - 1, `${n}: P${p + 1} on the pad`);
      assert.equal(b.pos[1], S.h);
      assert.ok(b.ground && !b.out);
      spots.push([b.pos[0], b.pos[2]]);
    }
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) assert.ok(Math.hypot(spots[i][0] - spots[j][0], spots[i][1] - spots[j][1]) > 2.4, `${n}: ${i} and ${j} apart`);
  }
});

test('courses from many seeds and crowds: the fans by their bridges, zones apart and in reach of nothing else; each windmill\'s blades sweep the whole width; the vents just short of the upper deck, GF_VENT_UP over the fan bridge it short cuts', async () => {
  for (let seed = 1; seed <= 24; seed++) {
    const n = [1, 16, 100, 256][seed % 4];
    const g = await room(n, { play: false, seed: seed * 7919 });
    const c = g.c;
    assert.ok(![MC.GF_S_GAPS, MC.GF_S_MILL].includes(c.main[1].sec), `seed ${seed}: not first`);
    const len = c.fin - c.x0line;
    assert.ok(len > 300 && len < 400, `seed ${seed}: ${len.toFixed(0)} m`);
    const fans = hz(c, MC.GF_HZ_FAN);
    assert.ok(fans.length >= 10 && fans.length <= 13, `${fans.length} fans`);
    for (const H of fans) {
      const P = H.piece;
      assert.ok(H.x - H.l >= P.x0 && H.x + H.l <= P.x1 && H.z === P.z && H.w === f32(P.w + 1), 'a fan\'s zone on its bridge');
      assert.ok(H.dir === 1 || H.dir === -1);
      assert.ok(H.per >= MC.GF_FAN_P0 && H.per < MC.GF_FAN_P0 + MC.GF_FAN_PK && H.ph >= 0 && H.ph < H.per);
      assert.ok(MC.GF_FAN_D1 + MC.GF_WARN <= H.per, 'a gust and its warning fit a period');
      for (const K of fans) if (K !== H) assert.ok(Math.abs(K.x - H.x) >= 2 * H.l + 4, 'zones apart');
    }
    // fans on a bridge blow by turns
    for (const P of of(c, MC.GF_S_FANS)) {
      const on = fans.filter((H) => H.piece === P).sort((a, b) => a.x - b.x);
      assert.ok(on.length === 3 || on.length === 4);
      for (let k = 1; k < on.length; k++) assert.equal(on[k].dir, -on[k - 1].dir);
    }
    for (const H of hz(c, MC.GF_HZ_MILL)) {
      const P = H.piece;
      assert.equal(P.sec, MC.GF_S_MILL);
      assert.equal(P.w, f32(c.w * f32(MC.GF_MILL_WK)));
      assert.ok(Math.abs(H.per) >= MC.GF_MILL_V0 && Math.abs(H.per) <= MC.GF_MILL_V0 + MC.GF_MILL_VK);
      // a blade pointing at either edge, level with a ball's middle, reaches past it
      for (const s of [1, -1]) {
        const a = Math.atan2(1 - H.w, s * P.w);
        const t = (a / (2 * Math.PI) * TURN - H.ph) / H.per;
        assert.ok(bladeGap(H, P.z + s * (P.w + 0.2), H.y + 1, t) < 0, `seed ${seed}: the blade reaches ${s > 0 ? 'left' : 'right'}`);
      }
    }
    const [m0, m1] = hz(c, MC.GF_HZ_MILL);
    assert.ok(Math.sign(m0.per) === -Math.sign(m1.per), 'the two turn opposite ways');
    const U = c.upper[0], V = of(c, MC.GF_S_VENT)[0];
    assert.ok(U.x0 > V.x0 && U.x1 < V.x1 && U.z === V.z && U.w === V.w && Math.abs(U.h - V.h - MC.GF_VENT_UP) < 1e-4, 'over the vent bridge');
    for (const H of hz(c, MC.GF_HZ_VENT)) {
      assert.ok(H.x + H.l < U.x0 && H.x - H.l > V.x0, 'a vent\'s column clear of the deck, on the bridge');
      assert.ok(Math.abs(H.y + H.w - (U.h + MC.GF_VENT_TOP)) < 1e-4, 'its top over the deck');
    }
    assert.equal(hz(c, MC.GF_HZ_VENT).length, c.w > MC.GF_VENT_R * 1.6 ? 2 : 1);
    for (const H of fans.filter((F) => F.piece === V)) assert.ok(H.y + MC.GF_FAN_TOP < U.h - MC.GF_THICK, 'the fans under the upper deck reach none of it');
  }
});

test('floors: up and down the stairs a ball rolls on every step; a gap taken fast with a hop is cleared; rolled off slowly, the landing\'s face stops it and it\'s down in the gap', async () => {
  const g = await room(2);
  const c = g.c;
  park(g, 1);
  const [up, top, down] = of(c, MC.GF_S_STAIRS);
  // (with the fan on the top still while it rolls by: its gusts are the next test's)
  const fan = hz(c, MC.GF_HZ_FAN).find((H) => H.piece === top);
  const calm = (t) => { for (let k = 100; k < 500; k++) if (fanA(fan, t + k) > 0) return false; return true; };
  while (!calm(tp(g))) g.step();
  put(g, 0, [up.x0 - 3, floorAt(c.main[up.m - 1], up.x0 - 3), up.z], { v: [7, 0, 0], best: up.x0 - 3 - c.x0line });
  let air = 0, highest = -1e9;
  while (g.v.partier(0).pos[0] < down.x1 + 2) {
    g.step([[L.EV_INPUT, 0, word(0)]]);
    const b = g.v.partier(0);
    if (!b.ground) air++;
    const P = mainAt(c, b.pos[0]);
    if (b.ground) assert.ok(Math.abs(b.pos[1] - floorAt(P, b.pos[0])) < 1e-3, `on the floor at ${b.pos[0].toFixed(2)}`);
    highest = Math.max(highest, b.pos[1]);
    assert.ok(!b.out);
  }
  assert.ok(Math.abs(highest - top.h) < 1e-3, 'up to the top');
  assert.ok(air < 12, `${air} ticks off a step`);
  // the gaps: fast and hopping at the lip, over both
  const gaps = c.main.filter((P) => P.fl & MC.GF_F_GAP);
  const run = c.main[gaps[0].m - 1];
  for (const [v0, hop, clears] of [[10, true, true], [5, false, false]]) {
    put(g, 0, [gaps[0].x0 - 6, run.h, run.z], { v: [v0, 0, 0], best: gaps[0].x0 - 6 - c.x0line });
    let k = 0;
    for (; k < 400 && !g.v.partier(0).out; k++) {
      const b = g.v.partier(0);
      const lip = gaps.find((G) => G.x0 > b.pos[0] - 0.2 && G.x0 - b.pos[0] < 0.9);
      g.step([[L.EV_INPUT, 0, word(0, { hop: hop && lip && b.ground ? 1 : 0 })]]);
      if (g.v.partier(0).pos[0] > gaps[1].x1 + 4) break;
    }
    const b = g.v.partier(0);
    if (clears) assert.ok(!b.out && b.pos[0] > gaps[1].x1 + 4 && b.ground, `cleared both: at ${(b.pos[0] - gaps[1].x1).toFixed(1)} past the second`);
    else {
      assert.ok(b.out, 'down');
      assert.ok(b.pos[0] > gaps[0].x0 - 1 && b.pos[0] < gaps[0].x1, `down in the gap, not past its face (${(b.pos[0] - gaps[0].x1).toFixed(2)})`);
      assert.ok(b.pos[1] < run.h - MC.GF_DEEP, 'GF_DEEP under');
    }
    while (g.v.partier(0).out) g.step();
  }
});

test('a fan gusts across its zone on its schedule: GF_FAN_D0 ticks a period at GF_FAN_A0 at first, GF_FAN_D1 at GF_FAN_A1 from GF_RAMP on; still otherwise; its light warns GF_WARN ahead; a ball off its zone, or over its reach, feels none of it', async () => {
  const g = await room(2);
  const c = g.c;
  park(g, 1);
  const H = hz(c, MC.GF_HZ_FAN)[2];
  const at = [H.x, H.y, H.z];
  // a ball at rest in its zone every tick, no keys: what it gets across is the gust
  const sample = (ticks, where = at) => {
    const out = [];
    for (let k = 0; k < ticks; k++) {
      const t = tp(g);
      put(g, 0, where, { best: H.x - c.x0line });
      g.step([[L.EV_INPUT, 0, still]]);
      const b = g.v.partier(0);
      out.push({ t, vz: b.vel[2], vx: b.vel[0], want: fanA(H, t) });
    }
    return out;
  };
  const early = sample(H.per + 5);
  let blowing = 0;
  for (const s of early) {
    assert.equal(s.vx, 0);
    if (s.want > 0) {
      blowing++;
      assert.ok(Math.abs(s.vz - H.dir * s.want * TICK) < 2e-5, `tick ${s.t}: ${s.vz} for ${s.want}`);
    } else assert.equal(s.vz, 0, `still on ${s.t}`);
  }
  assert.ok(blowing >= MC.GF_FAN_D0 && blowing <= MC.GF_FAN_D0 + 15, `${blowing} ticks blowing in the first period`);
  assert.ok(early.some((s) => s.want > 0) && Math.max(...early.map((s) => Math.abs(s.vz))) < f32(MC.GF_FAN_A0 + 0.2) * TICK, 'at about GF_FAN_A0');
  // its light: on for GF_WARN before every gust starts, and not before that
  for (let t = 0; t < 3 * H.per; t++) {
    if (fanA(H, t) > 0 && fanA(H, t - 1) === 0 && t > MC.GF_WARN + 1) {
      for (let k = 1; k <= MC.GF_WARN; k++) assert.ok(fanWarn(H, t - k), `warning ${k} before ${t}`);
      assert.ok(!fanWarn(H, t - MC.GF_WARN - 1));
    }
  }
  // early, a ball caught in a gust holds on pushing into it (GF_FAN_A0 is less than its push), and lets go when it stops
  while (fanA(H, tp(g)) > 0) g.step();
  while (fanA(H, tp(g)) === 0) g.step();
  put(g, 0, at, { best: H.x - c.x0line });
  for (let k = 0; k < MC.GF_FAN_D0 + 60; k++) g.step([[L.EV_INPUT, 0, fanA(H, tp(g)) > 0 ? word(-H.dir * Math.PI / 2) : still]]);
  const held = g.v.partier(0);
  assert.ok(!held.out && held.ground && Math.abs(held.pos[2] - H.z) < H.piece.w - 1, `held on (${(held.pos[2] - H.z).toFixed(2)} across)`);
  // late in the round: the clock moved on past GF_RAMP
  g.dv.setUint32(L.HDR_START, g.v.hole().tick - MC.GF_RAMP - 2 * H.per, true);
  const late = sample(H.per);
  const lateOn = late.filter((s) => s.vz !== 0);
  assert.equal(lateOn.length, MC.GF_FAN_D1, 'GF_FAN_D1 ticks a period');
  for (const s of lateOn) assert.ok(Math.abs(s.vz - H.dir * MC.GF_FAN_A1 * TICK) < 2e-5, 'at GF_FAN_A1');
  // out of its zone along the bridge, and over its top: nothing
  while (fanA(H, tp(g)) === 0) g.step();
  const off = sample(5, [H.x + H.l + 0.3, H.y, H.z]);
  assert.ok(off.every((s) => s.vz === 0), 'past its zone');
  put(g, 0, [H.x, H.y + MC.GF_FAN_TOP + 0.5, H.z], { ground: false, best: H.x - c.x0line });
  const t0 = tp(g);
  g.step([[L.EV_INPUT, 0, still]]);
  assert.ok(fanA(H, t0) > 0 && g.v.partier(0).vel[2] === 0, 'over its top');
  // late, a ball sitting in a gust is blown off the bridge downwind and down
  while (fanA(H, tp(g)) > 0) g.step();
  while (fanA(H, tp(g)) === 0) g.step();
  put(g, 0, at, { best: H.x - c.x0line });
  let gone = -1;
  for (let k = 0; k < MC.GF_FAN_D1 + 150 && gone < 0; k++) { g.step([[L.EV_INPUT, 0, still]]); if (g.v.partier(0).out) gone = k; }
  assert.ok(gone > 0 && (g.v.partier(0).pos[2] - H.z) * H.dir > H.piece.w, `blown off downwind (${((g.v.partier(0).pos[2] - H.z) * H.dir).toFixed(1)} m across)`);
});

test('a tunnel blows against the way on, GF_TUN_A0 and its gusts on top; its walls keep a ball in', async () => {
  const g = await room(2);
  const c = g.c;
  park(g, 1);
  const H = hz(c, MC.GF_HZ_TUNNEL)[0];
  const T = H.piece;
  assert.ok(T.fl & MC.GF_F_WALLS);
  let gust = 0;
  for (let k = 0; k < H.per + 3; k++) {
    const t = tp(g);
    put(g, 0, [H.x, H.y, H.z], { best: H.x - c.x0line });
    g.step([[L.EV_INPUT, 0, still]]);
    const b = g.v.partier(0);
    assert.ok(Math.abs(b.vel[0] + tunA(H, t) * TICK) < 2e-5, `tick ${t}: ${b.vel[0]}`);
    if (tunA(H, t) > MC.GF_TUN_A0) gust++;
  }
  assert.ok(gust >= MC.GF_TUN_D && gust <= MC.GF_TUN_D + 3, `${gust} ticks of gust in a period`);
  // shoved at a wall at 12 m/s: kept in, bounced back
  for (const s of [1, -1]) {
    put(g, 0, [H.x, H.y, H.z + s * (T.w - 2)], { v: [0, 0, 12 * s], best: H.x - c.x0line });
    for (let k = 0; k < 40; k++) g.step([[L.EV_INPUT, 0, still]]);
    const b = g.v.partier(0);
    assert.ok(!b.out && Math.abs(b.pos[2] - T.z) <= T.w - 1 + 1e-3, `kept in: ${(b.pos[2] - T.z).toFixed(2)}`);
  }
  // rolling flat out through it takes longer than through as much open bridge
  put(g, 0, [T.x0 + 0.5, T.h, T.z], { v: [8, 0, 0], best: T.x0 - c.x0line });
  let k = 0;
  while (g.v.partier(0).pos[0] < T.x1 && k++ < 2000) g.step([[L.EV_INPUT, 0, word(0)]]);
  assert.ok(k * TICK > 26 / 10 + 0.4 && k < 2000, `${(k * TICK).toFixed(2)} s through 26 m`);
});

test('a vent lifts a ball in its column while it blows, to float at its top; pushed on, it lands on the upper deck; still, the vent leaves it be; the deck stops a ball from below', async () => {
  const g = await room(2);
  const c = g.c;
  park(g, 1);
  const H = hz(c, MC.GF_HZ_VENT)[0];
  const U = c.upper[0];
  // off: a ball on it stays on the floor
  while (ventOn(H, tp(g)) || ventNext(H, tp(g)) < 40) g.step();
  put(g, 0, [H.x, H.y, H.z], { best: H.x - c.x0line });
  for (let k = 0; k < 30; k++) g.step([[L.EV_INPUT, 0, still]]);
  assert.ok(g.v.partier(0).ground && g.v.partier(0).pos[1] === H.y, 'stays down while it\'s still');
  // on: up off the floor (once, its FX), floating at the top, then down again as it stops
  const fresh = () => { while (!(ventOn(H, tp(g)) && ventLeft(H, tp(g)) >= H.on - 2)) g.step([[L.EV_INPUT, 0, still]]); put(g, 0, [H.x, H.y, H.z], { best: H.x - c.x0line }); };
  fresh();
  const fx0 = g.v.fxCount();
  const top = H.y + H.w;
  for (let k = 0; k < 250; k++) g.step([[L.EV_INPUT, 0, still]]);
  const b = g.v.partier(0);
  assert.ok(Math.abs(b.pos[1] - top) < 0.15 && Math.abs(b.vel[1]) < 0.3, `floating at ${(b.pos[1] - top).toFixed(2)} m from its top`);
  const lifts = fxs(g.v, MC.GF_FX_LIFT, fx0);
  assert.deepEqual(lifts.map((f) => [f.owner, f.shot]), [[0, H.j]], 'lifted once');
  while (ventOn(H, tp(g))) g.step([[L.EV_INPUT, 0, still]]);
  for (let k = 0; k < 150; k++) g.step([[L.EV_INPUT, 0, still]]);
  assert.ok(g.v.partier(0).ground && g.v.partier(0).pos[1] === H.y, 'back on the bridge once it stops');
  // pushed on from the start: up and over onto the deck, on the ground there, its progress counted
  fresh();
  let k = 0;
  while (!(g.v.partier(0).ground && g.v.partier(0).pos[0] > U.x0) && k++ < 400) g.step([[L.EV_INPUT, 0, word(0)]]);
  const on = g.v.partier(0);
  assert.ok(on.ground && on.pos[1] === U.h && on.pos[0] > U.x0, `on the upper deck at ${on.pos[1]}`);
  assert.equal(pieceAt(c, on.pos[0], on.pos[2], on.pos[1]), U);
  for (let n = 0; n < 50; n++) g.step([[L.EV_INPUT, 0, word(0)]]);
  assert.ok(g.v.partier(0).m >= Math.floor((on.pos[0] - c.x0line) * 100));
  // from below: a ball thrown up under the deck is stopped by its slab and falls back
  const V = H.piece;
  put(g, 0, [U.x0 + 13.7, V.h, U.z], { v: [0, 14, 0], ground: false, best: U.x0 + 13.7 - c.x0line });
  let peak = -1e9;
  for (let n = 0; n < 200; n++) { g.step([[L.EV_INPUT, 0, still]]); peak = Math.max(peak, g.v.partier(0).pos[1]); }
  assert.ok(peak <= U.h - MC.GF_THICK - 2 + 1e-4 && peak > V.h + 2, `stopped under it: its top reached ${(peak + 2 - U.h).toFixed(2)} from the deck's floor`);
  assert.ok(g.v.partier(0).ground && g.v.partier(0).pos[1] === V.h, 'back on the bridge');
});

test('a windmill\'s blade bats a ball it meets aside and up (its FX, the mill as shot), where the mirror says the blade will be; between blades a ball goes by untouched', async () => {
  const g = await room(2);
  const c = g.c;
  park(g, 1);
  const M = hz(c, MC.GF_HZ_MILL)[0];
  const z0 = M.z + 1.5;
  // a tick when a blade is 0.6 m clear of a ball there, closing: the hit comes within half a second
  let t = tp(g) + 5;
  while (!(bladeGap(M, z0, M.y + 1, t) > 0.6 && bladeGap(M, z0, M.y + 1, t + 30) < -0.2)) t++;
  until(g, t);
  put(g, 0, [M.x, M.y, z0], { best: M.x - c.x0line });
  const fx0 = g.v.fxCount();
  let hitAt = -1;
  for (let k = 0; k < 60 && hitAt < 0; k++) {
    const t1 = tp(g);
    g.step([[L.EV_INPUT, 0, still]]);
    if (fxs(g.v, MC.GF_FX_MILL, fx0).length) hitAt = t1;
  }
  const f = fxs(g.v, MC.GF_FX_MILL, fx0)[0];
  assert.ok(f && f.owner === 0 && f.shot === M.j, 'its FX');
  assert.ok(bladeGap(M, z0, M.y + 1, hitAt) < 0.02 && bladeGap(M, z0, M.y + 1, hitAt - 1) > -0.15, `met when the mirror says (gap ${bladeGap(M, z0, M.y + 1, hitAt).toFixed(3)})`);
  const b = g.v.partier(0);
  assert.ok(Math.hypot(b.vel[0], b.vel[2]) > MC.GF_MILL_KICK && !b.ground && b.vel[1] >= MC.GF_MILL_POP - 0.2, `batted at ${b.vel[2].toFixed(1)} across, ${b.vel[1].toFixed(1)} up`);
  // the blade's turning way: aside the way the blade at the bottom moves
  assert.ok(b.vel[2] * Math.sign(M.per) > 0, 'aside the way it sweeps');
  // a quiet window: no blade within reach for 40 ticks
  while (g.v.partier(0).out) g.step();
  t = tp(g) + 5;
  const clear = (s) => { for (let k = 0; k < 40; k++) if (bladeGap(M, z0, M.y + 1, s + k) < 0.3) return false; return true; };
  while (!clear(t)) t++;
  until(g, t);
  put(g, 0, [M.x, M.y, z0], { best: M.x - c.x0line });
  const fx1 = g.v.fxCount();
  for (let k = 0; k < 40; k++) g.step([[L.EV_INPUT, 0, still]]);
  assert.equal(fxs(g.v, MC.GF_FX_MILL, fx1).length, 0, 'untouched');
  assert.deepEqual(g.v.partier(0).vel, [0, 0, 0]);
});

test('off the course: down once GF_DEEP under the main way\'s floor, back on its last deck GF_BACK ticks later, 3 m in, its best kept; off an upper deck it only drops to the bridge', async () => {
  const g = await room(2);
  const c = g.c;
  park(g, 1);
  const F = of(c, MC.GF_S_FANS)[1];
  const deck = c.main[F.m - 1];
  put(g, 0, [F.x0 + 20, F.h, F.z + F.w - 0.3], { v: [0, 0, 6], best: F.x0 + 25 - c.x0line });
  const best = g.v.partier(0).m;
  let k = 0;
  while (!g.v.partier(0).out && k++ < 400) g.step([[L.EV_INPUT, 0, still]]);
  const t0 = g.v.tick - 1;
  assert.ok(g.v.partier(0).out && k > 20 && k < 120, `down ${k} ticks after going over`);
  assert.equal(fxs(g.v, L.FX_SINK).at(-1).owner, 0);
  const y = g.v.partier(0).pos[1];
  assert.ok(y < F.h - MC.GF_DEEP && y > F.h - MC.GF_DEEP - 0.6, `GF_DEEP under: ${(y - F.h).toFixed(2)}`);
  assert.equal(g.v.partier(0).m, best, 'its best stands');
  while (g.v.partier(0).out) g.step();
  assert.equal(g.v.tick - 1 - t0, MC.GF_BACK - 1, 'back a tick before the framework would send it to the start');
  const b = g.v.partier(0);
  assert.ok(Math.abs(b.pos[0] - deck.x0 - 3) < 1e-3 && Math.abs(b.pos[2] - deck.z) < deck.w - 1 && b.pos[1] > deck.h + 1, 'on the deck before the bridge, falling in');
  assert.equal(b.m, best);
  for (let n = 0; n < 80; n++) g.step();
  assert.ok(g.v.partier(0).ground && !g.v.partier(0).out && g.v.partier(0).pos[1] === deck.h, 'and on it');
  // off the upper deck's end: onto the bridge under it, still in
  const U = c.upper[0];
  put(g, 0, [U.x1 - 1.5, U.h, U.z], { v: [9, 0, 0], best: U.x1 - 1.5 - c.x0line });
  for (let n = 0; n < 250; n++) g.step([[L.EV_INPUT, 0, still]]);
  const d = g.v.partier(0);
  assert.ok(!d.out && d.ground && Math.abs(d.pos[1] - (U.h - MC.GF_VENT_UP)) < 1e-4, `dropped to the bridge: ${d.pos[1]}`);
});

test('home: in the pen a ball scores GF_WIN plus the ticks it had left and takes its place; the first cuts the clock to GF_LATE; everyone home ends it, placed by finishing order', async () => {
  const g = await room(3);
  const c = g.c;
  const R = mainAt(c, c.fin - 1);
  const shove = (p, u, v = 8) => put(g, p, [c.fin - 1.5, R.h, R.z + u], { v: [v, 0, 0], best: c.fin - 1.5 - c.x0line });
  shove(0, -1);
  park(g, 1, -3);
  park(g, 2, 3);
  const fx0 = g.v.fxCount();
  let k = 0;
  while (g.v.partier(0).score < MC.GF_WIN && k++ < 60) g.step();
  const t0 = g.v.party().t - 1;
  assert.equal(g.v.partier(0).score, MC.GF_WIN + MC.GF_LEN - t0, 'GF_WIN and the ticks it had left');
  g.step();
  const home = fxs(g.v, MC.GF_FX_HOME, fx0);
  assert.deepEqual([home.length, home[0].owner, home[0].size], [1, 0, 1], 'home 1st');
  const late = fxs(g.v, MC.GF_FX_LATE, fx0)[0];
  assert.equal(late.owner, 0);
  assert.equal(g.v.hole().until, g.v.party().start + t0 + MC.GF_LATE, 'the clock cut');
  assert.equal(late.size, MC.GF_LATE / 125);
  // in the pen it stays: its walls and the mouth's push keep it in
  for (let n = 0; n < 300; n++) g.step([[L.EV_INPUT, 0, word(n < 150 ? Math.PI : Math.PI / 2)]]);
  const b0 = g.v.partier(0);
  assert.ok(pieceAt(c, b0.pos[0], b0.pos[2], b0.pos[1])?.fl & MC.GF_F_PEN, 'still in the pen');
  shove(1, 1);
  shove(2, -2.5);
  while (g.v.partier(1).score < MC.GF_WIN) g.step();
  assert.equal(g.v.partier(1).score, g.v.partier(2).score, 'the same tick, the same score');
  assert.deepEqual(standings(g.v).map((e) => [e.slot, e.rank]), [[0, 1], [1, 2], [2, 2]]);
  const r = g.v.party();
  assert.equal(r.state, L.H_OVER, 'everyone home: over on that tick');
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).place), [1, 2, 2]);
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).pts), [10, 5, 5], '10 for 1st, 2nd of 3 shared');
  assert.equal(r.winner, 0);
});

test('the clock: nobody home, the round ends at PG_LEN, placed by how far along; a newcomer in play drops onto the start pad', async () => {
  const g = await room(3);
  const c = g.c;
  for (const [p, s] of [[0, 120.4], [1, 300.9], [2, 300.2]]) { park(g, p, (p - 1) * 3); g.dv.setUint32(rec(p) + L.PG_M, Math.round(s * 100), true); }
  g.step([[L.EV_JOIN, 3]]);
  const b = g.v.partier(3), S = c.main[0];
  assert.ok(b.pos[0] > S.x0 && b.pos[0] < S.x1 && b.pos[1] > S.h + 5 && !b.out, 'a newcomer drops onto the pad');
  while (g.v.party().state === L.H_PLAY) g.step();
  const r = g.v.party();
  assert.equal(r.state, L.H_OVER);
  assert.equal(r.tick - 1 - r.start, MC.GF_LEN, 'at PG_LEN');
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).score), [120, 300, 300]);
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.partier(p).place), [3, 1, 1, 4], 'by metres, ties shared');
});

test('the prediction matches the confirmed ball bit for bit along the course: stairs, gaps and faces, fans gusting, the tunnel, the windmills, the vent\'s lift onto the upper deck', async () => {
  const g = await room(2);
  const c = g.c;
  park(g, 1);
  let compared = 0;
  const stats = { gust: 0, lift: 0, mill: 0 };
  const watch = (n) => {
    const t = tp(g);
    for (const H of c.hazards) {
      const b = g.v.partier(0);
      if (Math.abs(b.pos[0] - H.x) > H.l + 1) continue;
      if (H.kind === MC.GF_HZ_FAN && fanA(H, t) > 0 && Math.abs(b.pos[2] - H.z) < H.w) stats.gust += n;
      if (H.kind === MC.GF_HZ_VENT && ventOn(H, t) && !b.ground) stats.lift += n;
    }
  };
  // each section from its start, rolling on with a wobble across and a hop now and then; late in the round, the gusts hardest
  g.dv.setUint32(L.HDR_START, g.v.hole().tick - MC.GF_RAMP, true);
  for (const sec of [MC.GF_S_STAIRS, MC.GF_S_GAPS, MC.GF_S_FANS, MC.GF_S_TUNNEL, MC.GF_S_MILL]) {
    const P = of(c, sec)[0];
    for (const lane of [-0.4, 0.3]) {
      put(g, 0, [P.x0 - 2, floorAt(c.main[P.m - 1], P.x0 - 2), P.z + lane * P.w], { v: [8, 0, 0], best: P.x0 - 2 - c.x0line });
      const fx0 = g.v.fxCount();
      for (let n = 0; n < 14; n++) {
        const b = g.v.partier(0);
        if (b.out || b.falling || b.pos[0] > P.x1 + 25) break;
        const words = Array.from({ length: 10 }, (_, i) => word(0.5 * Math.sin((n * 10 + i) * 0.07), { hop: (n * 10 + i) % 60 === 30 ? 1 : 0 }));
        watch(10);
        compared += predicted(g, words);
      }
      stats.mill += fxs(g.v, MC.GF_FX_MILL, fx0).length;
      while (g.v.partier(0).out) g.step();
    }
  }
  // in a fan's zone as a gust comes, holding into it; on a windmill bridge as a blade comes
  for (const F of hz(c, MC.GF_HZ_FAN).slice(0, 3)) {
    while (fanNext(F, tp(g)) !== 3) g.step();
    put(g, 0, [F.x, F.y, F.z], { best: F.x - c.x0line });
    for (let n = 0; n < 25 && !g.v.partier(0).out && !g.v.partier(0).falling; n++) {
      watch(10);
      compared += predicted(g, Array.from({ length: 10 }, (_, i) => word(-F.dir * Math.PI / 2 + 0.3 * Math.sin(n + i), { move: (n + i) % 3 ? 1 : 0 })));
    }
    while (g.v.partier(0).out) g.step();
  }
  for (const M of hz(c, MC.GF_HZ_MILL)) {
    let t = tp(g) + 40;
    while (!(bladeGap(M, M.z, M.y + 1, t) > 0.5 && bladeGap(M, M.z, M.y + 1, t + 30) < -0.2)) t++;
    until(g, t - 10);
    put(g, 0, [M.x, M.y, M.z], { best: M.x - c.x0line });
    const fx0 = g.v.fxCount();
    for (let n = 0; n < 6; n++) compared += predicted(g, Array.from({ length: 10 }, () => word(0, { move: 0 })));
    stats.mill += fxs(g.v, MC.GF_FX_MILL, fx0).length;
    while (g.v.partier(0).out) g.step();
  }
  // the vent: from on its grille as it blows, up and on over the deck
  const H = hz(c, MC.GF_HZ_VENT)[0];
  while (!(ventOn(H, tp(g)) && ventLeft(H, tp(g)) >= H.on - 2)) g.step();
  put(g, 0, [H.x - 0.5, H.y, H.z], { v: [1, 0, 0], best: H.x - c.x0line });
  for (let n = 0; n < 40; n++) {
    const words = Array.from({ length: 10 }, (_, i) => word(n < 8 ? 0.3 * Math.sin(n + i) : 0.2 * Math.sin(i), { move: n < 8 ? 0 : 1 }));
    watch(10);
    compared += predicted(g, words);
  }
  const up = g.v.partier(0);
  assert.ok(up.ground && up.pos[1] === c.upper[0].h, `up on the deck: ${up.pos[1]}`);
  assert.ok(compared > 900, `${compared} predictions compared`);
  assert.ok(stats.gust > 200 && stats.lift > 100 && stats.mill >= 2, `through ${stats.gust} ticks of gust, ${stats.lift} of lift, ${stats.mill} blades`);
});

for (const [balls, ticks] of [[8, 11000], [64, 11500]]) {
  test(`a round of ${balls} AI balls on the debug build: no trap, through the wind, many of them home, the round over and placed; equal on 1 and 4 threads`, async () => {
    let start = -1, over = -1, places = null, pts = null, home = 0, downs = 0, lifts = 0, seen = 0;
    const { log, sim, view } = await playParty({ bytes: partyBytes(true), seed: balls + 3, mg: L.MG_GALE, bots: balls, ticks, onTick: (t, s, v) => {
      if (s.error().code) throw new Error(`trap ${JSON.stringify(s.error())}`);
      const g = v.party();
      if (start < 0 && g.state === L.H_PLAY) start = t;
      for (; seen < v.fxCount(); seen++) {
        const f = v.fx(seen);
        if (over >= 0 || start < 0) continue;
        home += f.kind === MC.GF_FX_HOME;
        downs += f.kind === L.FX_SINK;
        lifts += f.kind === MC.GF_FX_LIFT;
      }
      if (over < 0 && start >= 0 && g.state === L.H_OVER) {
        over = t;
        places = [...Array(balls).keys()].map((p) => v.partier(p).place);
        pts = [...Array(balls).keys()].map((p) => v.partier(p).pts);
      }
    } });
    assert.equal(sim.error().code, 0);
    assert.ok(over > 0, 'the round ended');
    const secs = (over - start) * TICK;
    assert.ok(secs > 35 && secs <= MC.GF_LEN * TICK, `${secs.toFixed(1)} s of play`);
    assert.ok(home >= balls * (balls > 8 ? 0.3 : 0.6), `${home} of ${balls} home`);
    assert.ok(downs > 0 && lifts > 0, `${downs} downs, ${lifts} lifts`);
    assert.ok(places.every((x) => x >= 1 && x <= balls), `places ${places}`);
    assert.ok(pts.every((x) => x >= 1 && x <= 10), `points ${pts}`);
    assert.ok(places.includes(1) && pts.includes(10), 'somebody won');
    assert.equal(view.party().game, L.MG_GALE);
    const parsed = parseLog(log);
    const n = over + 50;
    const a = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 1, tag: 't1' });
    const b = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 4, tag: 't4', startWorkers });
    const d = await replay({ bytes: partyBytes(true), log: parsed, ticks: n, threads: 1, tag: 'd1' });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(d.trace).tickHashes], 'the debug build steps the same bits');
    assert.equal(partySeed(balls + 3, L.MG_GALE) >>> 24, 0xa7);
  });
}

test('the client module: the course as the sim has it (a ball dropped anywhere on it lands on the floor the mirror says), drawn, framed, its HUD lines and its brain', async () => {
  const { Scene } = await import('../client/party-render.mjs');
  const g = await room(4, { seed: 99 });
  const c = g.c;
  let k = 0;
  for (const P of c.pieces) {
    if (P.fl & MC.GF_F_GAP) continue;
    for (const gg of [0.2, 0.6]) {
      const x = P.x0 + gg * P.len, z = P.z + (((k++ * 37) % 11) - 5) / 6 * P.w * 0.9;
      const h = floorAt(P, x);
      put(g, 1, [x, h + 0.25, z], { ground: false, best: x - c.x0line });
      g.step();
      const b = g.v.partier(1);
      const u = under(c, b.pos[0], b.pos[1] + P_STEP, b.pos[2]);
      assert.ok(b.ground && u && Math.abs(b.pos[1] - u.h) < 1e-4, `piece ${P.k}: on the floor at ${b.pos[1]} (${u?.h})`);
      assert.equal(mainh(c, x), floorAt(P.fl & MC.GF_F_UPPER ? mainAt(c, x) : P, x));
    }
  }
  const out = { scene: new Scene(24000), solid: [], glow: [], beams: [], decals: [], casters: [], paint: null };
  gale.draw(g.v, { tick: g.v.tick, dt: 0, t: g.v.party().t * TICK, ptick: g.v.tick, now: 0, ms: 16, cam: [c.box[0], 60, c.box[1]], slot: 0 }, out);
  assert.ok(out.scene.count > 300 && out.scene.count < 8000, `${out.scene.count} solids`);
  for (let i = 0; i < out.scene.count * 16; i++) assert.ok(Number.isFinite(out.scene.data[i]), 'finite');
  assert.ok(out.beams.length <= 200 && out.decals.length >= 1);
  const fr = gale.frame(g.v);
  assert.equal(fr.shape, 'square');
  assert.ok(Math.abs(fr.radius - g.v.party().size) < 0.01);
  assert.equal(gale.facing(g.v, 0), 0);
  const lines = [];
  const hctx = { put: (x, y, s, col) => lines.push([y, s, col]), centre: (y, s, col) => lines.push([y, s, col]), right: (y, s, col) => lines.push([y, s, col]), rows: 44, C: {}, slot: 0, me: g.v.partier(0), now: 0 };
  gale.hud(g.v, hctx);
  const text = lines.map((l) => l[1]).join(' | ');
  assert.ok(/(\d+)(ST|ND|RD|TH) OF 4/.test(text) && /M TO GO/.test(text), text);
  for (const l of lines) assert.ok(l[1].length <= 40, l[1]);
  assert.ok(gale.hint.length <= 70);
  // danger: off the course deadly, a deck's middle fine, a fan's zone while it blows, a blade where it will be
  const me = g.v.partier(0);
  const D = of(c, MC.GF_S_DECK)[2];
  assert.equal(gale.brain.danger(g.v, D.x0 + D.len / 2, D.z, g.v.tick, me), 0);
  assert.equal(gale.brain.danger(g.v, D.x0 + D.len / 2, D.z + D.w + 3, g.v.tick, me), 1);
  const F = hz(c, MC.GF_HZ_FAN)[0];
  let t = g.v.party().t;
  while (fanA(F, t) === 0) t++;
  assert.ok(gale.brain.danger(g.v, F.x, F.z, g.v.party().start + t, me) > 0.8, 'in a gust');
  const M = hz(c, MC.GF_HZ_MILL)[0];
  t = g.v.party().t;
  while (bladeGap(M, M.z + 1, M.y + 1, t) > -0.3) t++;
  assert.ok(gale.brain.danger(g.v, M.x, M.z + 1, g.v.party().start + t, me) > 0.9, 'on a blade');
  // its goal is on along the course from it
  const goal = gale.brain.goal(g.v, me, { mem: {}, skill: 0.6 });
  assert.ok(goal && goal[0] > me.pos[0], 'ahead');
});
