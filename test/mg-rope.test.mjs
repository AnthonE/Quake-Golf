// JUMP ROPE (src/mg/rope.wat): the stage for the crowd, the rope's schedule
// and what it does to a ball, hops that clear it, the ends dropping, the
// end, the prediction through all of it, and rounds of AI balls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty, partyBytes, predicted } from './helpers.mjs';
import { View, partyWord, PLAT_Y, seed as pseed } from '../src/party-view.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { playParty } from '../tools/genparty.mjs';
import { Partier } from '../client/party-bot.mjs';
import * as L from '../src/layout.mjs';
import * as MC from '../src/mg/rope.mjs'; // JR_*: the minigame's own constants
import rope, { stage, angleAt, spinAt, ropesAt, dropsAt, reachOf, reachAt, switches, passed, crossings, nextPass, AIR } from '../client/mg/rope.mjs';

const C = L.B_CX;
const TICK = 0.008;
const TAU = 2 * Math.PI;
const f = Math.fround;

// A room of n balls in JUMP ROPE, on the debug build (a NaN traps), stepped into play unless asked not to.
async function room(n = 2, { play = true, seed = 7 } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_ROPE + 1, true);
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
  g.dv.setUint32(rec(p) + L.PG_M, 0, true);
}
// The next step plays tick t into play (the clock moved; the round's end with it).
function at(g, t) {
  const now = g.v.tick;
  g.dv.setUint32(L.HDR_START, now - t, true);
  g.dv.setUint32(L.HDR_UNTIL, now - t + MC.JR_LEN, true);
}
const playT = (g) => g.v.party().t; // the tick into play the next step plays
const fxs = (v, kind, from = 0) => { const out = []; for (let k = from; k < v.fxCount(); k++) { const x = v.fx(k); if (x.kind === kind) out.push(x); } return out; };
const hop = partyWord({ hop: 1 }), still = partyWord({});
// A ball's hops at the middle of each window the mirror gives it as it
// stands, planned a pass at a time: (stage, tick into play, its z from the
// middle line, on the ground) -> its word.
function hopper() {
  let first = -1, when = -1;
  return (st, t, dz, ground) => {
    if (ground && first < t) {
      const nb = nextPass(st, t, dz);
      if (nb && nb.late >= t) { first = nb.first; when = Math.max(t, Math.round((nb.early + nb.late) / 2)); }
    }
    return t === when ? hop : still;
  };
}
// Steps n ticks, balls ps hopping the rope as the mirror says.
function hopping(g, n, ps = [0]) {
  const plans = ps.map(() => hopper());
  for (let i = 0; i < n; i++) {
    const st = stage(g.v), t = playT(g);
    g.step(ps.map((p, k) => { const b = g.v.partier(p); return [L.EV_INPUT, p, plans[k](st, t, b.pos[2] - C, b.ground)]; }));
  }
}
// A tick into play near T with no pass going on: 25 after the last rope to pass the bottom before it.
function quiet(st, T) {
  const cr = crossings(st);
  const i = cr.findIndex((t) => t >= T);
  return cr[i - 1] + 25;
}

test('the stage for 1, 8, 64 and 256: long enough for the crowd in rows of three, its knobs, every ball on it, apart; the schedule from the seed', async () => {
  let last = 0;
  for (const n of [1, 8, 64, 256]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party();
    const cols = Math.ceil(n / 3);
    const hl = Math.max(MC.JR_HLMIN, (cols - 1) * MC.JR_SP / 2 + MC.JR_END);
    assert.equal(r.game, L.MG_ROPE);
    assert.ok(Math.abs(r.size - hl) < 1e-4, `${r.size} m for ${n}`);
    assert.ok(r.size >= last, 'grows with the crowd');
    last = r.size;
    assert.deepEqual([r.kind, r.len, r.floor, r.hop, r.idle, r.flags], [L.PK_OUT, MC.JR_LEN, PLAT_Y, MC.JR_HOP, f(MC.JR_IDLE), 0], 'no bumps: the rope is the only hazard');
    const st = stage(g.v);
    assert.equal(st.hl, r.size);
    assert.equal(st.seg[1].dir, pseed(g.v, MC.JR_KSEED) >>> 31 ? -1 : 1, 'the way it turns from the round\'s seed');
    const pos = [];
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p);
      assert.ok(b.ground && !b.out && b.pos[1] === PLAT_Y, 'on the floor');
      const dz = b.pos[2] - C, dx = b.pos[0] - C;
      assert.ok([0, -MC.JR_ROWW, MC.JR_ROWW].some((z) => Math.abs(dz - z) < 1e-4), `${n}: P${p + 1} in a row (${dz})`);
      assert.ok(Math.abs(dx) <= hl - MC.JR_END + 1e-3, `${n}: P${p + 1} ${dx.toFixed(2)} m along, inside the ends`);
      for (const [x, z] of pos) assert.ok(Math.hypot(b.pos[0] - x, b.pos[2] - z) >= 2.4 - 1e-3, `${n}: P${p + 1} apart`);
      pos.push([b.pos[0], b.pos[2]]);
    }
  }
});

test('the schedule: held overhead for the grace, one rope ever faster, double dutch from the first pass at the bottom from 30 s, switches held at a side from 60 s', async () => {
  for (const seed of [3, 4, 5, 6]) {
    const g = await room(1, { play: false, seed });
    const st = stage(g.v);
    const sg = st.seg;
    assert.deepEqual([sg[0].t0, sg[0].law, sg[0].a0, sg[1].t0, sg[1].law, sg[1].a0], [0, 0, 0x800000, MC.JR_GRACE, 1, 0x800000], 'overhead, then turning');
    for (let t = 0; t <= MC.JR_GRACE; t++) assert.equal(angleAt(st, t), 0x800000, 'held in the grace');
    const dir = sg[1].dir;
    // the one rope: S1 into the first tick, K1 more each tick after
    for (const t of [MC.JR_GRACE + 1, 1000, 3000]) assert.equal((angleAt(st, t) - angleAt(st, t - 1)) | 0, dir * (MC.JR_S1 + MC.JR_K1 * (t - 1 - MC.JR_GRACE)), `into tick ${t}`);
    assert.ok(Math.abs(Math.abs(spinAt(st, MC.JR_GRACE + 1)) - TAU / 1.8) < 0.01, 'a turn in 1.8 s');
    // double dutch: on the first tick from JR_T2 the first rope has passed the bottom, at the speed of a turn in 2 s
    assert.ok(st.td >= MC.JR_T2 && st.td < MC.JR_T2 + 130, `double dutch from ${st.td}`);
    for (let t = MC.JR_T2; t < st.td; t++) assert.ok(!passed(angleAt(st, t - 1), angleAt(st, t), 0));
    assert.ok(passed(angleAt(st, st.td - 1), angleAt(st, st.td), 0), 'the first rope under the balls, the second over them');
    assert.deepEqual([sg[2].t0, sg[2].law, sg[2].dir], [st.td, 2, dir]);
    assert.deepEqual([ropesAt(st, st.td - 1), ropesAt(st, st.td)], [1, 2]);
    assert.equal((angleAt(st, st.td + 1) - angleAt(st, st.td)) | 0, dir * MC.JR_S2);
    assert.ok(Math.abs(Math.abs(spinAt(st, MC.JR_LEN)) - TAU / 1.5) < 0.05, `a turn in 1.5 s at the clock: ${spinAt(st, MC.JR_LEN)}`);
    // each segment's angle is where the one before had the rope on its first tick: the mirror's laws are the sim's
    for (let k = 2; k < sg.length; k++) assert.equal(sg[k].a0, angleAt({ ...st, seg: sg.slice(0, k) }, sg[k].t0), `segment ${k}`);
    // the switches: from JR_TR0, each held where the first rope passes a side, JR_PA..JR_PA+JR_PN ticks, then back the other way
    const sw = switches(st);
    assert.ok(sw.length >= 3 && sw.length <= MC.JR_NREV, `${sw.length} switches`);
    assert.equal(sg.length, 3 + 2 * sw.length);
    let prev = MC.JR_TR0, way = dir;
    for (const [k, s] of sw.entries()) {
      assert.ok(s.hold >= prev && s.hold < prev + MC.JR_RA + MC.JR_RN + 130, `switch ${k} at ${s.hold}`);
      assert.ok(passed(angleAt(st, s.hold - 1), angleAt(st, s.hold), 1), 'held at a side');
      const a = angleAt(st, s.hold) << 8;
      assert.ok(Math.abs(Math.abs(a) - 2 ** 30) < 2 ** 26, 'level with the axle');
      assert.ok(s.go - s.hold >= MC.JR_PA && s.go - s.hold < MC.JR_PA + MC.JR_PN, 'held a while');
      for (let t = s.hold; t <= s.go; t++) assert.equal(angleAt(st, t), angleAt(st, s.hold));
      way = -way;
      assert.equal(Math.sign(spinAt(st, s.go + 1)), way, 'and back the other way');
      assert.ok(s.go < MC.JR_LEN);
      prev = s.go + MC.JR_RA;
    }
    // the ends: JR_STEPS steps from JR_TC0, JR_TCI apart, to (1 - JR_CUT) of the reach
    assert.deepEqual([0, MC.JR_TC0 - 1, MC.JR_TC0, MC.JR_TC0 + MC.JR_TCI, MC.JR_TC0 + 4 * MC.JR_TCI, MC.JR_LEN].map(dropsAt), [0, 0, 1, 2, 5, 5]);
    assert.equal(reachOf(st.hl, 0), st.hl);
    assert.ok(Math.abs(reachOf(st.hl, MC.JR_STEPS) - st.hl * (1 - MC.JR_CUT)) < 1e-4);
  }
  assert.deepEqual([MC.JR_FX_HIT, MC.JR_FX_CALL, MC.JR_FX_GO, MC.JR_FX_END], [0, 1, 2, 3].map((k) => L.FX_MG + 4 * L.MG_ROPE + k));
});

test('the schedule\'s moments as FX on time: the rope setting off, double dutch and each switch called and setting off, a step shaking and going', async () => {
  const g = await room(1, { seed: 5 });
  const st = stage(g.v);
  const kinds = [MC.JR_FX_GO, MC.JR_FX_CALL, MC.JR_FX_END];
  const seen = (t) => { at(g, t); put(g, 0, C, C, { y: PLAT_Y + 30, ground: false }); const k = g.v.fxCount(); g.step(); return kinds.flatMap((kind) => fxs(g.v, kind, k)); };
  let [x] = seen(MC.JR_GRACE);
  assert.deepEqual([x.kind, x.owner, x.shot, x.pos[0], x.pos[1], x.pos[2]], [MC.JR_FX_GO, 255, 0, C, PLAT_Y, C]);
  assert.ok(Math.abs(x.size - spinAt(st, MC.JR_GRACE + 1)) < 1e-4);
  [x] = seen(st.td - MC.JR_WARN);
  assert.deepEqual([x.kind, x.shot, x.size], [MC.JR_FX_CALL, 1, MC.JR_WARN]);
  [x] = seen(st.td);
  assert.deepEqual([x.kind, x.shot], [MC.JR_FX_GO, 1]);
  for (const s of switches(st)) {
    [x] = seen(s.hold - MC.JR_WARN);
    assert.deepEqual([x.kind, x.shot, x.size], [MC.JR_FX_CALL, 2, MC.JR_WARN]);
    [x] = seen(s.go);
    assert.deepEqual([x.kind, x.shot], [MC.JR_FX_GO, 2]);
    assert.equal(Math.sign(x.size), Math.sign(spinAt(st, s.go + 1)));
  }
  for (let j = 0; j < MC.JR_STEPS; j++) {
    const tj = MC.JR_TC0 + j * MC.JR_TCI;
    [x] = seen(tj - MC.JR_CWARN);
    assert.deepEqual([x.kind, x.shot, x.size], [MC.JR_FX_END, 0, reachOf(st.hl, j + 1)]);
    [x] = seen(tj);
    assert.deepEqual([x.kind, x.shot, x.size], [MC.JR_FX_END, 1, reachOf(st.hl, j + 1)]);
  }
  assert.equal(seen(1000).length, 0, 'and nothing between');
});

test('the rope meeting a ball on the floor knocks it across the way it goes and up, on the tick the mirror says, anywhere along the stage; PG_M counts it', async () => {
  for (const [T, dz, dx] of [[1500, 0, 0], [2400, -3, 5], [5200, 2.4, -8], [9000, 1, 3]]) {
    const g = await room(1, { seed: 3 });
    const st = stage(g.v);
    const t0 = quiet(st, T);
    at(g, t0);
    put(g, 0, C + dx, C + dz);
    const nb = nextPass(st, t0, dz);
    assert.ok(nb && nb.first > t0, `the rope comes ${nb.first - t0} ticks on`);
    const k0 = g.v.fxCount();
    let hit = null;
    while (!hit && playT(g) <= nb.first + 2) {
      const t = playT(g);
      g.step();
      hit = fxs(g.v, MC.JR_FX_HIT, k0)[0];
      if (hit) {
        assert.ok(Math.abs(t - nb.first) <= 1, `knocked on tick ${t}, the mirror says ${nb.first}`);
        const b = g.v.partier(0);
        const way = Math.sign(spinAt(st, t));
        const u = Math.abs(spinAt(st, t)) * MC.JR_RR;
        const want = f(Math.min(MC.JR_KZ0 + MC.JR_KZK * u, MC.JR_KZMAX));
        assert.ok(way * b.vel[2] >= want - 0.05, `across at ${b.vel[2].toFixed(2)} the way the rope goes (${way})`);
        assert.equal(b.vel[1], MC.JR_UP, 'and up');
        assert.ok(!b.ground && b.pos[1] > PLAT_Y, 'off the floor');
        assert.ok(Math.abs(b.pos[0] - (C + dx)) < 1e-4, 'not moved along');
        assert.ok(Math.abs(hit.size - want) < 0.01);
        assert.deepEqual([hit.owner, hit.shot], [0, 0]);
        assert.equal(b.m >>> 16, 1, 'PG_M: knocked once');
      } else assert.ok(g.v.partier(0).ground, 'on the floor till then');
    }
    assert.ok(hit, 'knocked');
    // and it goes on past it: no second knock on the way up
    for (let i = 0; i < 30; i++) g.step();
    assert.equal(fxs(g.v, MC.JR_FX_HIT, k0).length, 1);
  }
});

test('a hop the mirror says clears the rope clears it in the sim, a jump in PG_M; one too early or none is knocked; out at the sides none clears', async () => {
  for (const [T, dz, when] of [[1000, 0, 'mid'], [3000, 2.4, 'mid'], [6000, -3.5, 'mid'], [10000, 0, 'mid'], [1000, 0, 'early'], [6000, 1, 'none']]) {
    const g = await room(1, { seed: 4 });
    const st = stage(g.v);
    const t0 = quiet(st, T);
    at(g, t0);
    put(g, 0, C, C + dz);
    const nb = nextPass(st, t0, dz);
    assert.ok(nb && nb.late >= nb.early && nb.early >= t0, `a window: ${JSON.stringify(nb)}`);
    const j = when === 'none' ? -1 : when === 'early' ? Math.max(t0, nb.early - 25) : Math.round((nb.early + nb.late) / 2);
    if (when === 'early') assert.ok(j < nb.early);
    const k0 = g.v.fxCount();
    while (playT(g) < nb.last + 20) { const t = playT(g); g.step([[L.EV_INPUT, 0, t === j ? hop : still]]); }
    const hit = fxs(g.v, MC.JR_FX_HIT, k0).length > 0;
    const b = g.v.partier(0);
    if (when === 'mid') {
      assert.ok(!hit, `${dz} m across at ${t0}: cleared, hopping at ${j} (${nb.early}..${nb.late})`);
      assert.equal(b.m, 1, 'a jump');
      while (!g.v.partier(0).ground) g.step();
      assert.ok(Math.abs(g.v.partier(0).pos[2] - (C + dz)) < 0.01, 'down where it was');
    } else assert.ok(hit, `${when}: knocked`);
  }
  // out at the side the rope comes in at a ball's height: no hop clears it
  const g = await room(1, { seed: 4 });
  const nb = nextPass(stage(g.v), quiet(stage(g.v), 1000), 4.2);
  assert.ok(nb && nb.late < 0, 'no window at the side');
});

test('double dutch: the second rope comes in overhead and down half a turn after the first; a ball hopping each in turn clears both', async () => {
  const g = await room(1, { seed: 6 });
  const st = stage(g.v);
  at(g, st.td - 150);
  put(g, 0, C + 2, C);
  const k0 = g.v.fxCount();
  hopping(g, 700);
  const jumps = g.v.partier(0).m & 0xffff;
  assert.equal(fxs(g.v, MC.JR_FX_HIT, k0).length, 0, 'never knocked');
  const cr = crossings(st).filter((t) => t >= st.td - 150 && t < st.td + 550);
  assert.ok(cr.length >= 5, `${cr.length} passes`);
  assert.equal(jumps, cr.length, `a jump for each pass (${jumps})`);
  // the second rope is half a turn from the first: at the tick it joins it's overhead
  const a2 = ((angleAt(st, st.td) + 0x800000) & 0xffffff) / 2 ** 24;
  assert.ok(Math.abs(a2 - 0.5) < 0.02, `the second rope at the top (${a2.toFixed(3)} turn)`);
});

test('a switch: the rope held at a side, high over the sea, then back the other way; the ball hopping on the old beat early, on the new one clear', async () => {
  const g = await room(1, { seed: 3 });
  const st = stage(g.v);
  const [s] = switches(st);
  at(g, s.hold - 120);
  put(g, 0, C, C);
  const k0 = g.v.fxCount();
  hopping(g, 400);
  assert.equal(fxs(g.v, MC.JR_FX_HIT, k0).length, 0, 'the mirror\'s windows clear it through the switch');
  // the held rope is level with the axle: nothing near the floor
  const a = (angleAt(st, s.hold) & 0xffffff) / 2 ** 24 * TAU;
  assert.ok(Math.abs(Math.cos(a)) < 0.05, 'at a side');
  // the beat skips: the pass after the hold is the hold's length later than the beat would have it
  const cr = crossings(st);
  const i = cr.findIndex((t) => t > s.hold);
  const gap = cr[i] - cr[i - 1], beat = cr[i - 1] - cr[i - 2];
  assert.ok(gap - beat > MC.JR_PA - 12, `the pass across the hold ${gap} ticks after the last, the beat ${beat}`);
});

test('the ends: a step drops on its tick and takes a ball on it; inside the next it stays up; at the last JR_CUT of the reach is gone', async () => {
  for (let j = 0; j < MC.JR_STEPS; j += 2) {
    const g = await room(3, { seed: 9 + j });
    const st = stage(g.v);
    const tj = MC.JR_TC0 + j * MC.JR_TCI;
    at(g, tj - 30);
    const r0 = reachOf(st.hl, j), r1 = reachOf(st.hl, j + 1);
    put(g, 0, C + (r0 + r1) / 2, C);
    put(g, 1, C - r1 + 1.2, C);
    put(g, 2, C, C);
    // all three hop the rope as the mirror says, till the drop
    hopping(g, 30, [0, 1, 2]);
    assert.equal(playT(g), tj);
    assert.ok(!g.v.partier(0).falling && !g.v.partier(0).out, 'held up till the drop');
    let n = 0;
    while (!g.v.partier(0).falling && n++ < 150) hopping(g, 1, [0, 1, 2]);
    assert.ok(g.v.partier(0).falling, `step ${j + 1} gone from under it`);
    assert.equal(reachAt(st, playT(g)), r1);
    assert.ok(!g.v.partier(1).falling && !g.v.partier(2).falling, 'inside the next reach: still up');
  }
  const st = { hl: f(40) };
  assert.ok(Math.abs(reachAt(st, MC.JR_TC0 + (MC.JR_STEPS - 1) * MC.JR_TCI) - 40 * (1 - MC.JR_CUT)) < 1e-4);
});

test('the end: the last ball on wins; two knocked off together share the win; one off before them is out in its place', async () => {
  let g = await room(2, { seed: 10 });
  at(g, 20);
  put(g, 0, C, C + MC.JR_HW + 1.5, { y: PLAT_Y + 0.5, ground: false });
  put(g, 1, C, C);
  let n = 0;
  while (g.v.party().state === L.H_PLAY && n++ < 400) g.step();
  assert.equal(g.v.party().state, L.H_OVER);
  assert.equal(g.v.party().winner, 1);
  assert.deepEqual([0, 1].map((p) => g.v.partier(p).place), [2, 1]);
  assert.deepEqual([0, 1].map((p) => g.v.partier(p).pts), [1, 10]);
  g = await room(3, { seed: 11 });
  at(g, 20);
  put(g, 2, C, C - MC.JR_HW - 1.5, { ground: false });
  for (const p of [0, 1]) put(g, p, C + 3 * p, C);
  n = 0;
  while (!g.v.partier(2).out && n++ < 400) g.step();
  put(g, 0, C, C - MC.JR_HW - 1.5, { ground: false });
  put(g, 1, C, C + MC.JR_HW + 1.5, { ground: false });
  n = 0;
  while (g.v.party().state === L.H_PLAY && n++ < 400) g.step();
  const r = g.v.party();
  assert.equal(r.state, L.H_OVER);
  assert.equal(r.winner, 255, 'shared');
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).place), [1, 1, 3]);
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).pts), [10, 10, 1]);
});

test('the prediction matches the confirmed ball bit for bit: knocked, hopping, into double dutch, through a switch, on a step as it drops, roaming the fast end', async () => {
  // one ball alone, so nothing else is in it
  const g = await room(1, { seed: 12 });
  const st = stage(g.v);
  const words = (n, fn = () => still) => Array.from({ length: n }, (_, i) => fn(i));
  // A: knocked, standing in the middle
  at(g, 1200);
  put(g, 0, C, C);
  assert.ok(predicted(g, words(160)) >= 160);
  assert.ok(g.v.partier(0).m >>> 16 >= 1, 'knocked, predicted all the way');
  // B: a hop over it, off the middle
  let t0 = 2600;
  at(g, t0);
  put(g, 0, C - 4, C + 1.5);
  let nb = nextPass(st, t0, 1.5);
  const j = Math.round((nb.early + nb.late) / 2) - t0;
  assert.ok(predicted(g, words(nb.last - t0 + 30, (i) => (i === j ? hop : still))) > 100);
  assert.equal(g.v.partier(0).m, 1, 'cleared');
  // C: into double dutch, hopping at random, rolling
  at(g, st.td - 60);
  put(g, 0, C + 3, C);
  const roam = (n, k) => words(n, (i) => partyWord({ yaw: (i * k) & 16383, move: (i >> 4) & 1, hop: i % 37 === 0 ? 1 : 0 }));
  let w = roam(240, 61), k = 0;
  for (; k < w.length && !g.v.partier(0).falling; k += 30) assert.ok(predicted(g, w.slice(k, k + 30)) >= 1);
  // D: through a switch's hold and back the other way
  const [s] = switches(st);
  at(g, s.hold - 50);
  put(g, 0, C - 2, C - 1);
  w = roam(240, 133);
  for (k = 0; k < w.length && !g.v.partier(0).falling; k += 30) assert.ok(predicted(g, w.slice(k, k + 30)) >= 1);
  // E: on a step as it drops, hopping the rope the while
  t0 = MC.JR_TC0 - 40;
  at(g, t0);
  put(g, 0, C + (reachOf(st.hl, 0) + reachOf(st.hl, 1)) / 2, C);
  const plan = hopper();
  w = words(300, (i) => plan(st, t0 + i, 0, true));
  for (k = 0; k < w.length && !g.v.partier(0).falling; k += 30) assert.ok(predicted(g, w.slice(k, k + 30)) >= 1);
  assert.ok(k > 40 && g.v.partier(0).falling && !g.v.partier(0).out, `dropped with the step, ${k} ticks on`);
  // F: the fast end, rolling and hopping round inside the last reach
  at(g, MC.JR_TC0 + 4 * MC.JR_TCI + 10);
  put(g, 0, C + 1, C);
  w = roam(300, 211);
  for (k = 0; k < w.length && !g.v.partier(0).falling; k += 30) assert.ok(predicted(g, w.slice(k, k + 30)) >= 1);
});

// A round of Partier balls steered by this minigame's brain (tools/genparty.mjs), recorded as a log.
async function aiRound(balls, ticks, seed) {
  let start = -1, over = -1, seen = 0, hits = 0, at15 = -1, jumps = 0;
  let places = null, pts = null, winner = -1;
  const { log, sim } = await playParty({ bytes: partyBytes(true), seed, mg: L.MG_ROPE, bots: balls, ticks, onTick: (t, s, v) => {
    const g = v.party();
    for (; seen < v.fxCount(); seen++) hits += v.fx(seen).kind === MC.JR_FX_HIT;
    if (start < 0 && g.state === L.H_PLAY) start = t;
    if (start >= 0 && at15 < 0 && t - start >= 15 / TICK) at15 = g.left;
    if (start >= 0 && over < 0 && g.state === L.H_OVER) {
      over = t;
      winner = g.winner;
      places = [...Array(balls).keys()].map((p) => v.partier(p).place);
      pts = [...Array(balls).keys()].map((p) => v.partier(p).pts);
      jumps = [...Array(balls).keys()].reduce((a, p) => a + (v.partier(p).m & 0xffff), 0);
    }
  } });
  return { log, sim, start, over, hits, at15, places, pts, winner, jumps };
}

for (const [balls, ticks, seed] of [[8, 13000, 21], [64, 13000, 22]]) {
  test(`a round of ${balls} AI balls on the debug build: no trap, most of them hopping a while, a winner or the clock; equal on 1 and 4 threads`, async () => {
    const r = await aiRound(balls, ticks, seed);
    assert.equal(r.sim.error().code, 0);
    assert.ok(r.over > 0, 'the round ended');
    const secs = (r.over - r.start) * TICK;
    assert.ok(secs > 30 && secs <= MC.JR_LEN * TICK + 0.01, `${secs.toFixed(1)} s of play`);
    assert.ok(r.at15 >= balls * 0.7, `${r.at15} of ${balls} still on 15 s in`);
    assert.ok(r.hits >= balls - 1, `${r.hits} knocked`);
    assert.ok(r.jumps >= balls * 20, `${r.jumps} jumps`);
    assert.ok(r.places.every((x) => x >= 1 && x <= balls), `places ${r.places}`);
    assert.ok(r.pts.every((x) => x >= 1 && x <= 10), `points ${r.pts}`);
    assert.ok(r.places.includes(1) && r.pts.includes(10), 'somebody won');
    const v = new View(r.sim.memory.buffer);
    assert.equal(v.party().game, L.MG_ROPE);
    const parsed = parseLog(r.log);
    const n = r.over + 50;
    const a = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 1, tag: 't1' });
    const b = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 4, tag: 't4', startWorkers });
    const d = await replay({ bytes: partyBytes(true), log: parsed, ticks: n, threads: 1, tag: 'd1' });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(d.trace).tickHashes], 'the debug build steps the same bits');
  });
}

test('the client module: draws every phase, frames the stage, writes its HUD lines; its brain sees the edges and the ends, and its hops clear the rope in the sim', async () => {
  const { Scene } = await import('../client/party-render.mjs');
  const g = await room(3, { seed: 41 });
  const st = stage(g.v);
  const out = { scene: new Scene(24000), solid: [], glow: [], beams: [], decals: [], paint: null };
  const lines = [];
  const hctx = { put: (x, y, s, c) => lines.push([y, s, c]), centre: (y, s, c) => lines.push([y, s, c]), right: (y, s, c) => lines.push([y, s, c]), rows: 44, C: {}, slot: 0, now: 0 };
  const sw = switches(st)[0];
  for (const t of [10, 600, st.td - 100, st.td + 50, sw.hold - 100, sw.hold + 5, MC.JR_TC0 - 100, MC.JR_TC0 + 10, MC.JR_TC0 + 4 * MC.JR_TCI + 100]) {
    at(g, t);
    [0, 1, 2].forEach((p) => put(g, p, C + 3 * p, C));
    g.step();
    out.scene.clear(); out.decals.length = 0; out.glow.length = 0; lines.length = 0;
    const me = g.v.partier(0);
    rope.draw(g.v, { tick: g.v.tick, ptick: g.v.tick, dt: 0, now: 1000, slot: 0, me, pme: me }, out);
    assert.ok(out.scene.count > 30 && out.scene.count < 2000, `${out.scene.count} solids at ${t}`);
    for (let k = 0; k < out.scene.count * 16; k++) assert.ok(Number.isFinite(out.scene.data[k]), 'finite');
    rope.hud(g.v, { ...hctx, me, t: (t + 1) * TICK + 1e-6 });
    for (const l of lines) assert.ok(l[1].length <= 80, l[1]);
    const text = lines.map((l) => l[1]).join(' | ');
    assert.ok(text.includes(ropesAt(st, t + 1) === 2 ? 'DOUBLE DUTCH' : 'ONE ROPE'), `${t}: ${text} (${g.v.party().state})`);
    if (t + 1 >= st.td - MC.JR_WARN && t + 1 < st.td) assert.ok(text.includes('DOUBLE DUTCH IN'), text);
    if (t + 1 >= sw.hold - MC.JR_WARN && t + 1 < sw.go) assert.ok(text.includes('SWITCH'), text);
    if (t + 1 >= MC.JR_TC0 - MC.JR_CWARN && t + 1 < MC.JR_TC0) assert.ok(text.includes('THE ENDS DROP'), text);
    const fr = rope.frame(g.v);
    assert.equal(fr.shape, 'square');
    assert.ok(Math.abs(fr.radius - (reachAt(st, playT(g)) + 2)) < 1e-3);
  }
  assert.ok(rope.hint.length <= 70);
  assert.equal(rope.facing(g.v), st.seg[1].dir > 0 ? -Math.PI / 2 : Math.PI / 2, 'facing the way the rope comes along the floor from');
  // danger: off the sides and the ends, a step about to drop, the sides' last metres, and fine in the middle
  at(g, MC.JR_TC0 - 300);
  g.step();
  const T = g.v.party().start;
  const tk = T + MC.JR_TC0 - 100;
  assert.equal(rope.brain.danger(g.v, C, C + MC.JR_HW, tk), 1);
  assert.equal(rope.brain.danger(g.v, C + st.hl, C, tk), 1);
  assert.ok(rope.brain.danger(g.v, C + (st.hl + reachOf(st.hl, 1)) / 2, C, tk) >= 0.8);
  assert.ok(rope.brain.danger(g.v, C, C + 3.6, T + 2000) >= 0.4);
  assert.equal(rope.brain.danger(g.v, C + 2, C + 1, T + 2000), 0);
  assert.equal(rope.brain.danger(g.v, C + reachOf(st.hl, 1) + 0.5, C, T + MC.JR_TC0 + 1), 1, 'past the reach the drop left');
  // its hop, asked every 4th tick as the bot asks, clears the rope in the sim, pass after pass
  const g2 = await room(1, { seed: 42 });
  at(g2, 4000);
  put(g2, 0, C, C + 0.8);
  const bot = { skill: 1, rand: () => 0.5, mem: {}, at: 0, pos: null, vel: [0, 0] };
  const k0 = g2.v.fxCount();
  let hops = 0, word = still;
  for (let i = 0; i < 600; i++) {
    if (i % 4 === 0) {
      const b = g2.v.partier(0);
      Object.assign(bot, { at: g2.v.tick, pos: [b.pos[0], b.pos[2]], vel: [b.vel[0], b.vel[2]] });
      const h = rope.brain.hop(g2.v, b, bot);
      if (h && word === still) hops++;
      word = h ? hop : still;
    }
    g2.step([[L.EV_INPUT, 0, word]]);
  }
  assert.ok(hops >= 4, `${hops} hops`);
  assert.equal(fxs(g2.v, MC.JR_FX_HIT, k0).length, 0, 'and cleared the rope each time');
  assert.ok(g2.v.partier(0).m >= 4 && !g2.v.partier(0).out);
  // and the whole AI ball (client/party-bot.mjs, its words landing 8 ticks late) alone in double dutch for 10 s: it stands, hops, stays on
  const g3 = await room(1, { seed: 43 });
  at(g3, stage(g3.v).td + 200);
  const ai = new Partier(0, 5, 1);
  const k1 = g3.v.fxCount(), late = [];
  for (let i = 0; i < 1250; i++) {
    late.push(ai.think(g3.v, g3.v.tick + 8, 8));
    const wd = late.length > 8 ? late.shift() : still;
    g3.step([[L.EV_INPUT, 0, wd]]);
  }
  assert.equal(fxs(g3.v, MC.JR_FX_HIT, k1).length, 0, 'never knocked');
  assert.ok((g3.v.partier(0).m & 0xffff) >= 8, `${g3.v.partier(0).m & 0xffff} jumps`);
  assert.ok(!g3.v.partier(0).out);
});
