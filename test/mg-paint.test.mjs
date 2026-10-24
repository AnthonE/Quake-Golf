import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty, partyBytes } from './helpers.mjs';
import { View, partyWord, PLAT_Y } from '../src/party-view.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { playParty } from '../tools/genparty.mjs';
import * as L from '../src/layout.mjs';
import paint, { stage, orb, cells as heldBy } from '../client/mg/paint.mjs';

const C = L.B_CX;
const f = Math.fround;
const N = L.PP_N;
const TICK = 0.008;

// A room of n balls on Paint Party, on the debug build (a NaN traps), stepped into play unless asked not to.
async function room(n = 2, { play = true, seed = 7 } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_PAINT + 1, true);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); assert.equal(sim.error().code, 0, 'no trap'); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  while (play && v.hole().state !== L.H_PLAY) step();
  return { sim, v, dv, step, grid: new Uint16Array(sim.memory.buffer, L.PG_BIG + L.PP_CELLS, N * N) };
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
// Ball p out of everyone's way for the test: so high over the floor it is still falling at the end, painting nothing.
const away = (g, p, k = 0) => put(g, p, C - 6 + 3 * k, C + 12, { y: PLAT_Y + 20000, ground: false });
// Bomb j kept off the floor (it lands only on tick t into play).
const hold = (g, j, t = 1e8) => g.dv.setUint32(L.PG_S + L.PP_ORB + j * L.PP_ORB_SIZE + 8, t, true);
// The next step plays tick t into play (the clock moved; the round's end with it).
function at(g, t) {
  const now = g.v.tick;
  g.dv.setUint32(L.HDR_START, now - t, true);
  g.dv.setUint32(L.HDR_UNTIL, now - t + L.PP_LEN, true);
}
const fxs = (v, kind) => { const out = []; for (let k = 0; k < v.fxCount(); k++) { const x = v.fx(k); if (x.kind === kind) out.push(x); } return out; };
// The disc as the sim lays it out, in f32 as the sim works it.
function disc(n) {
  const rad = Math.min(f(f(f(Math.sqrt(n)) * f(L.PP_RK)) + L.PP_R0), L.PP_RMAX);
  return { rad, x0: f(C - rad), cs: f(rad * f(2 / N)) };
}
const centre = (d, i) => f(f(f(i + 0.5) * d.cs) + d.x0);
// The cells whose centres are within r of (x, z), as $pp_brush finds them (on the disc or not).
function brush(d, x, z, r) {
  const out = new Set(), r2 = f(f(r) * f(r));
  for (let j = 0; j < N; j++) {
    const dz = f(centre(d, j) - f(z)), dz2 = f(dz * dz);
    if (dz2 > r2) continue;
    for (let i = 0; i < N; i++) { const dx = f(centre(d, i) - f(x)); if (f(f(dx * dx) + dz2) <= r2) out.add(j * N + i); }
  }
  return out;
}
const owned = (g, p) => { const out = new Set(); for (let c = 0; c < N * N; c++) if (g.grid[c] === p + 1) out.add(c); return out; };
// Every slot's PG_SCORE is its cells in the grid, and the counts add up to the painted cells.
function tally(g, n) {
  let painted = 0;
  const per = new Array(n).fill(0);
  for (let c = 0; c < N * N; c++) { const v = g.grid[c]; if (v && v !== L.PP_OFF) { painted++; if (v <= n) per[v - 1]++; } }
  for (let p = 0; p < n; p++) {
    const b = g.v.partier(p);
    if (b.live) assert.equal(b.score, per[p], `P${p + 1}'s score is its cells`);
    assert.equal(heldBy(g.v, p), per[p], `P${p + 1}'s count`);
  }
  return { painted, per };
}

test('the stage for 1, 8, 64 and 256: a disc sized for the crowd, a grid of PP_N cells a side over it, the bombs on it, every ball on it apart', async () => {
  let last = 0;
  for (const n of [1, 8, 64, 256]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party();
    const d = disc(n);
    assert.equal(r.size, d.rad, `${r.size} m for ${n}`);
    assert.ok(r.size > last, 'grows with the crowd');
    last = r.size;
    assert.deepEqual([r.kind, r.len, r.respawn, r.idle, r.floor], [L.PK_SCORE, L.PP_LEN, L.PP_RESPAWN, f(L.PP_IDLE), PLAT_Y]);
    const st = stage(g.v);
    assert.deepEqual([st.rad, st.x0, st.cs], [d.rad, d.x0, d.cs]);
    // every cell whose centre is on the disc unpainted, the rest off
    let on = 0, wrong = 0;
    const r2 = f(d.rad * d.rad);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const dx = f(centre(d, i) - C), dz = f(centre(d, j) - C);
      const inside = f(f(dx * dx) + f(dz * dz)) <= r2;
      wrong += g.grid[j * N + i] !== (inside ? 0 : L.PP_OFF);
      on += inside;
    }
    assert.equal(wrong, 0, `${n}: cells on the disc unpainted, the rest off`);
    assert.equal(st.total, on);
    assert.ok(Math.abs(on / (Math.PI * N * N / 4) - 1) < 0.01, `${on} cells on the disc`);
    // the bombs: 2, one more for every 12 balls, at most 12, on the disc, landing a quarter second apart from 2 s
    assert.equal(st.orbs, Math.min(L.PP_NORB, L.PP_ORB0 + Math.floor(n / L.PP_ORBN)));
    for (let j = 0; j < st.orbs; j++) {
      const b = orb(g.v, j);
      assert.ok(Math.hypot(b.x - C, b.z - C) <= d.rad * L.PP_ORB_SPREAD + 1e-3, `bomb ${j} on the disc`);
      assert.deepEqual([b.at, b.bursts], [L.PP_FIRST + j * L.PP_STAGGER, 0]);
    }
    // every ball on the floor, apart
    const pos = [];
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p);
      assert.equal(b.pos[1], PLAT_Y);
      assert.ok(Math.hypot(b.pos[0] - C, b.pos[2] - C) < d.rad * L.PP_SPAWN + 1e-3, `${n}: P${p + 1} on the disc`);
      pos.push(b.pos);
    }
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) assert.ok(Math.hypot(pos[a][0] - pos[b][0], pos[a][2] - pos[b][2]) > 2.2, `${n}: P${a + 1} and P${b + 1} apart`);
  }
});

test('a ball on the floor paints the cells within PP_BRUSH of its centre; nothing in the countdown, nothing in the air, and it paints where it lands', async () => {
  const g = await room(2, { play: false });
  for (let k = 0; k < 300; k++) g.step();
  assert.equal(g.v.hole().state, L.H_COUNT);
  assert.ok(g.grid.every((v) => v === 0 || v === L.PP_OFF), 'nothing painted in the countdown');
  while (g.v.hole().state !== L.H_PLAY) g.step();
  const d = disc(2);
  away(g, 1);
  put(g, 0, C + 3.1, C - 2.3);
  g.step();
  const want = brush(d, C + 3.1, C - 2.3, L.PP_BRUSH);
  assert.deepEqual(owned(g, 0), want);
  assert.ok(want.size > 50, `${want.size} cells`);
  assert.equal(g.v.partier(0).score, want.size);
  g.step();
  assert.equal(g.v.partier(0).score, want.size, 'its own paint again: nothing more');
  // in the air over fresh floor: nothing till it lands, then there
  put(g, 0, C - 4, C + 4, { y: PLAT_Y + 2, ground: false });
  let k = 0;
  for (; k < 200 && !g.v.partier(0).ground; k++) { g.step(); if (!g.v.partier(0).ground) assert.equal(owned(g, 0).size, want.size, 'nothing under a ball in the air'); }
  assert.ok(k > 40, `fell 2 m in ${k} ticks`);
  assert.equal(owned(g, 0).size, want.size + brush(d, C - 4, C + 4, L.PP_BRUSH).size, 'painted where it landed');
  assert.equal(g.v.partier(1).score, 0);
  tally(g, 2);
});

test('rolling over another\'s paint takes it: its count down by the cells, yours up; every count is the grid\'s', async () => {
  const g = await room(3);
  const d = disc(3);
  away(g, 2);
  put(g, 0, C, C);
  put(g, 1, C + 8, C);
  g.step();
  const a = brush(d, C, C, L.PP_BRUSH);
  assert.equal(g.v.partier(0).score, a.size);
  // P1 off elsewhere, P2 onto its paint
  put(g, 0, C - 8, C);
  put(g, 1, C + 0.5, C + 0.3);
  g.step();
  const b = brush(d, C + 0.5, C + 0.3, L.PP_BRUSH);
  const taken = [...a].filter((c) => b.has(c)).length;
  assert.ok(taken > 30, `${taken} taken`);
  assert.equal(g.v.partier(0).score, a.size - taken + brush(d, C - 8, C, L.PP_BRUSH).size);
  assert.equal(g.v.partier(1).score, brush(d, C + 8, C, L.PP_BRUSH).size + b.size);
  const { painted, per } = tally(g, 3);
  assert.equal(painted, per[0] + per[1] + per[2]);
  // rolling about for a while, bumping: still so
  const words = [partyWord({ yaw: 0, move: 1 }), partyWord({ yaw: 8192, move: 1 }), partyWord({ yaw: 4096, move: 1 })];
  for (let k = 0; k < 400; k++) {
    g.step(k % 60 === 0 ? [0, 1, 2].map((p) => [L.EV_INPUT, p, words[(p + k / 60) % 3]]) : []);
    if (k % 50 === 0) tally(g, 3);
  }
});

test('two balls on one cell take turns having it: the later of the tick\'s order has it, up on even ticks, down on odd', async () => {
  const g = await room(2);
  const d = disc(2);
  // 2.05 m apart: their brushes overlap, the balls don't touch
  put(g, 0, C - 1.025, C + 0.1);
  put(g, 1, C + 1.025, C + 0.1);
  const both = [...brush(d, C - 1.025, C + 0.1, L.PP_BRUSH)].filter((c) => brush(d, C + 1.025, C + 0.1, L.PP_BRUSH).has(c));
  assert.ok(both.length > 5, `${both.length} cells shared`);
  for (let k = 0; k < 6; k++) {
    g.step();
    const t = g.v.party().t - 1; // the tick the hook just played
    for (const c of both) assert.equal(g.grid[c], t & 1 ? 1 : 2, `tick ${t}: cell ${c}`);
  }
  tally(g, 2);
});

test('a fall is PP_RESPAWN ticks down, the paint staying; then back in, falling onto the floor', async () => {
  const g = await room(2);
  const d = disc(2);
  away(g, 1);
  put(g, 0, C + 2, C);
  g.step();
  const mine = g.v.partier(0).score;
  assert.ok(mine > 0);
  put(g, 0, C + d.rad + 1.5, C, { ground: false });
  let n = 0;
  while (!g.v.partier(0).out && n++ < 400) g.step();
  const b = g.v.partier(0);
  assert.ok(b.out && b.live, `down after ${n} ticks`);
  assert.ok(n > 100, `${n} ticks falling ${L.OUT_DEPTH} m`);
  const sink = fxs(g.v, L.FX_SINK).at(-1);
  assert.deepEqual([sink.owner, sink.size], [0, 0]);
  const downAt = b.outAt;
  for (let k = 0; k < L.PP_RESPAWN - 2; k++) { g.step(); assert.ok(g.v.partier(0).out, 'still down'); assert.equal(g.v.partier(0).score, mine, 'its paint stays'); }
  while (g.v.partier(0).out && g.v.tick < downAt + L.PP_RESPAWN + 5) g.step();
  const back = g.v.partier(0);
  assert.ok(!back.out && !back.ground, 'back in, in the air');
  assert.ok(back.pos[1] > PLAT_Y + 5, `${back.pos[1]} m up`);
  assert.ok(Math.hypot(back.pos[0] - C, back.pos[2] - C) < d.rad * L.PP_SPAWN + 1e-3, 'over the disc');
  assert.equal(g.v.party().state, L.H_PLAY);
  let k = 0;
  while (!g.v.partier(0).ground && k++ < 300) g.step();
  assert.ok(g.v.partier(0).ground && g.v.partier(0).pos[1] === PLAT_Y, 'landed on the floor');
  g.step();
  assert.ok(g.v.partier(0).score > mine, 'and paints');
  tally(g, 2);
});

test('a paint bomb lands on its tick; the first ball to it bursts it, PP_SPLAT round it its colour; it lands again PP_BACK later elsewhere', async () => {
  const g = await room(2);
  const d = disc(2);
  away(g, 1);
  const b0 = orb(g.v, 0);
  put(g, 0, b0.x, b0.z);
  // waiting on its spot: nothing till it lands
  while (g.v.party().t < b0.at) { g.step(); assert.equal(orb(g.v, 0).bursts, 0); }
  const before = g.v.fxCount();
  g.step();
  const t = g.v.party().t - 1;
  assert.equal(t, b0.at);
  const land = fxs(g.v, L.PP_FX_ORB).find((x) => x.shot === 0);
  assert.deepEqual([land.owner, land.pos[0], land.pos[1], land.pos[2]], [255, b0.x, PLAT_Y, b0.z]);
  const splat = fxs(g.v, L.PP_FX_SPLAT).find((x) => x.tick >= land.tick);
  assert.ok(g.v.fxCount() > before && splat, 'burst on landing');
  assert.deepEqual([splat.owner, splat.shot, splat.pos[0], splat.pos[2], splat.size], [0, 0, b0.x, b0.z, L.PP_SPLAT]);
  const burst = brush(d, b0.x, b0.z, L.PP_SPLAT);
  const mine = owned(g, 0);
  for (const c of burst) if (g.grid[c] !== L.PP_OFF) assert.ok(mine.has(c), `cell ${c} of the burst`);
  assert.ok(mine.size > 600, `${mine.size} cells`);
  const b1 = orb(g.v, 0);
  assert.equal(b1.bursts, 1);
  assert.equal(b1.at, t + L.PP_BACK);
  assert.ok(Math.hypot(b1.x - b0.x, b1.z - b0.z) > 0.5, 'somewhere else');
  assert.ok(Math.hypot(b1.x - C, b1.z - C) <= d.rad * L.PP_ORB_SPREAD + 1e-3);
  // on its new spot before it's back: nothing; as it lands, bursts again
  put(g, 0, b1.x, b1.z);
  while (g.v.party().t < b1.at) { g.step(); assert.equal(orb(g.v, 0).bursts, 1); }
  g.step();
  assert.equal(orb(g.v, 0).bursts, 2);
  tally(g, 2);
});

test('two balls at one bomb: the first of the tick\'s order bursts it (P1 on an even tick, P2 on an odd)', async () => {
  for (const odd of [0, 1]) {
    const g = await room(2);
    const b = orb(g.v, 0);
    // 1.5 m either side of it, both within its reach, 3 m apart
    put(g, 0, b.x - 1.5, b.z);
    put(g, 1, b.x + 1.5, b.z);
    hold(g, 1);
    at(g, b.at - 1 + odd);
    hold(g, 0, b.at + odd);
    g.step();
    g.step();
    const s = fxs(g.v, L.PP_FX_SPLAT);
    assert.equal(s.length, 1);
    assert.equal(s[0].owner, odd, `tick ${b.at + odd}`);
  }
});

test('the rush: the last PP_RUSH ticks paint PP_RUSH_BRUSH wide and burst PP_RUSH_SPLAT, told by its FX', async () => {
  const g = await room(2);
  const d = disc(2);
  away(g, 1);
  const k = L.PP_LEN - L.PP_RUSH;
  hold(g, 0);
  hold(g, 1);
  at(g, k - 1);
  put(g, 0, C + 3, C + 3);
  g.step();
  assert.deepEqual(owned(g, 0), brush(d, C + 3, C + 3, L.PP_BRUSH));
  assert.equal(fxs(g.v, L.PP_FX_RUSH).length, 0);
  put(g, 0, C - 4, C - 3);
  g.step();
  const rush = fxs(g.v, L.PP_FX_RUSH);
  assert.equal(rush.length, 1);
  assert.equal(rush[0].size, f(L.PP_RUSH_BRUSH));
  const wide = brush(d, C - 4, C - 3, L.PP_RUSH_BRUSH);
  assert.equal(owned(g, 0).size, brush(d, C + 3, C + 3, L.PP_BRUSH).size + wide.size);
  assert.ok(wide.size > 2 * brush(d, C - 4, C - 3, L.PP_BRUSH).size);
  // a bomb in the rush
  const b = orb(g.v, 1);
  hold(g, 1, g.v.party().t);
  put(g, 0, b.x, b.z);
  g.step();
  const s = fxs(g.v, L.PP_FX_SPLAT).at(-1);
  assert.deepEqual([s.owner, s.shot, s.size], [0, 1, L.PP_RUSH_SPLAT]);
  for (const c of brush(d, b.x, b.z, L.PP_RUSH_SPLAT)) if (g.grid[c] !== L.PP_OFF) assert.equal(g.grid[c], 1);
  tally(g, 2);
});

test('a ball that leaves takes its paint with it; one that joins in its slot, or leaves and joins on one tick, starts clean', async () => {
  const g = await room(3);
  away(g, 0);
  put(g, 1, C + 4, C);
  put(g, 2, C - 4, C);
  g.step();
  assert.ok(owned(g, 1).size > 0 && owned(g, 2).size > 0);
  const p3 = owned(g, 2).size;
  g.step([[L.EV_LEAVE, 1]]);
  assert.equal(owned(g, 1).size, 0, 'gone with it');
  assert.equal(heldBy(g.v, 1), 0);
  assert.equal(owned(g, 2).size, p3, 'the others\' stays');
  g.step([[L.EV_JOIN, 1]]);
  const b = g.v.partier(1);
  assert.ok(b.live && !b.out && !b.ground, 'in, falling in');
  assert.equal(b.score, 0);
  while (!g.v.partier(1).ground) g.step();
  g.step();
  assert.ok(g.v.partier(1).score > 0, 'painting for itself');
  // out and in again on one tick: the slot's paint is the old ball's, so it goes
  g.step([[L.EV_LEAVE, 2], [L.EV_JOIN, 2]]);
  assert.equal(owned(g, 2).size, 0);
  assert.equal(g.v.partier(2).score, 0);
  tally(g, 3);
});

test('the end, on the clock: placed by cells, most first, ties sharing; 10 points for 1st and a win, the rest by place', async () => {
  const g = await room(4);
  for (let p = 0; p < 4; p++) put(g, p, C - 6 + 4 * p, C, { y: PLAT_Y + 300, ground: false });
  g.step();
  // the counts as the last tick finds them (nobody on the floor to change them)
  // (and in PG_SCORE, as every tick leaves it: else the slot looks new and its paint is wiped)
  [500, 300, 300, 20].forEach((c, p) => { g.dv.setUint16(L.PG_S + L.PP_CNT + 2 * p, c, true); g.dv.setUint16(rec(p) + L.PG_SCORE, c, true); });
  g.dv.setUint32(L.HDR_UNTIL, g.v.tick, true);
  g.step();
  const r = g.v.party();
  assert.equal(r.state, L.H_OVER);
  assert.equal(r.winner, 0);
  const b = [0, 1, 2, 3].map((p) => g.v.partier(p));
  assert.deepEqual(b.map((x) => x.score), [500, 300, 300, 20]);
  assert.deepEqual(b.map((x) => x.place), [1, 2, 2, 4]);
  assert.deepEqual(b.map((x) => x.pts), [10, 7, 7, 1]);
  assert.deepEqual(b.map((x) => x.wins), [1, 0, 0, 0]);
});

// Predicts slot 0 of room g through `inputs` from every tick (1 ahead, and 6
// and 30 every 7th) and compares its whole record with the confirmed one when
// it gets there, all but PG_SCORE (the confirmed world's count of its cells,
// which the prediction never paints); and the round's end. Returns how many.
function predictedBall(g, inputs) {
  const due = new Map();
  let compared = 0;
  const S0 = L.PG_SCORE, S1 = L.PG_SCORE + 2;
  const strip = (r) => { const o = r.slice(); o.fill(0, S0, S1); return o; };
  for (let k = 0; k < inputs.length; k++) {
    for (const n of [1, 6, 30]) {
      if ((k % 7 !== 0 && n !== 1) || k + n > inputs.length) continue;
      for (let i = 0; i < n; i++) g.dv.setUint32(L.PWORDS + 4 * i, inputs[k + i], true);
      g.sim.x.predict(0, n);
      const list = due.get(k + n) || [];
      list.push({ n, from: k, player: strip(g.sim.u8.slice(L.PLAYERS + L.PRED_D, L.PLAYERS + L.PRED_D + L.PSIZE)), until: g.dv.getUint32(L.HDR_UNTIL + L.PRED_D, true) });
      due.set(k + n, list);
    }
    g.step([[L.EV_INPUT, 0, inputs[k]]]);
    for (const p of due.get(k + 1) || []) {
      assert.deepEqual(p.player, strip(g.sim.u8.slice(L.PLAYERS, L.PLAYERS + L.PSIZE)), `predicted ${p.n} from ${p.from}`);
      if (g.v.hole().state === L.H_PLAY) assert.equal(p.until, g.v.hole().until, 'the round\'s end, from PG_LEN');
      compared++;
    }
  }
  return compared;
}

test('the prediction matches the confirmed ball bit for bit (all but PG_SCORE): rolling and painting, braking, off the rim, back in and landing', async () => {
  const g = await room(2);
  const d = disc(2);
  away(g, 1);
  put(g, 0, C, C);
  // rolling round, a hop, braking with no keys, painting all the while
  const roll = Array.from({ length: 300 }, (_, k) => partyWord({ yaw: (k * 53) & 16383, move: k % 90 < 70 ? 1 : 0, hop: k === 120 ? 1 : 0 }));
  assert.ok(predictedBall(g, roll) >= roll.length);
  assert.ok(g.v.partier(0).score > 200, `it painted ${g.v.partier(0).score} cells, at ${g.v.partier(0).pos}`);
  // flat out over the rim and down to nearly out
  put(g, 0, C + d.rad - 5, C, { vx: 9 });
  const off = Array(170).fill(partyWord({ yaw: 0, move: 1 }));
  assert.ok(predictedBall(g, off) >= off.length);
  const b = g.v.partier(0);
  assert.ok(b.falling && !b.out && b.pos[1] < PLAT_Y - 4, `going down, at ${b.pos[1]}`);
  // down, then back in: the prediction from the moment it's back, falling and landing and rolling on
  while (!g.v.partier(0).out) g.step();
  while (g.v.partier(0).out) g.step();
  const back = Array.from({ length: 220 }, (_, k) => partyWord({ yaw: 4096 + k * 20, move: 1 }));
  assert.ok(predictedBall(g, back) >= back.length);
  assert.ok(g.v.partier(0).ground && !g.v.partier(0).out, 'landed and rolling');
});

for (const [balls, leaveAt] of [[8, 0], [64, 3000]]) {
  test(`a round of ${balls} AI balls on the debug build: no trap, every count the grid's, ended by the clock and placed; equal on 1 and 4 threads`, async () => {
    const ticks = L.P_COUNT + L.PP_LEN + 200;
    let start = -1, over = -1, places = null, pts = null, scores = null, splats = 0, seen = 0, checked = 0;
    const grid = (sim) => new Uint16Array(sim.memory.buffer, L.PG_BIG + L.PP_CELLS, N * N);
    const { log, sim } = await playParty({ bytes: partyBytes(true), mg: L.MG_PAINT, seed: balls, bots: balls, ticks, leaveAt, onTick: (t, s, v) => {
      const h = v.hole();
      for (; seen < v.fxCount(); seen++) splats += v.fx(seen).kind === L.PP_FX_SPLAT;
      if (start < 0 && h.state === L.H_PLAY) start = t;
      if (start >= 0 && over < 0 && t % 500 === 0) { tally({ grid: grid(s), v }, balls); checked++; }
      if (over < 0 && start >= 0 && h.state === L.H_OVER) {
        over = t;
        places = [...Array(balls).keys()].map((p) => v.partier(p).place);
        pts = [...Array(balls).keys()].map((p) => v.partier(p).pts);
        scores = [...Array(balls).keys()].map((p) => v.partier(p).score);
      }
    } });
    assert.equal(sim.error().code, 0);
    assert.ok(over > 0, 'the round ended');
    assert.equal(over - start, L.PP_LEN, 'on the clock');
    assert.ok(checked > 10);
    const total = new View(sim.memory.buffer).dv.getUint32(L.PG_H + L.PP_TOTAL, true);
    const painted = scores.reduce((a, b) => a + b, 0);
    assert.ok(painted > 0.6 * total, `${(100 * painted / total).toFixed(0)}% of the floor painted`);
    assert.ok(Math.max(...scores) < 4 * total / balls, `nobody runs away with it: ${scores}`);
    assert.ok(splats >= 10, `${splats} bombs burst`);
    // placed by cells: every ball one more than those with more
    for (let p = 0; p < balls; p++) assert.equal(places[p], 1 + scores.filter((s) => s > scores[p]).length);
    assert.ok(pts.every((x) => x >= 1 && x <= 10) && pts.includes(10), `points ${pts}`);
    const parsed = parseLog(log);
    const n = over + 50;
    const a = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 1, tag: 'pp1' });
    const b = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 4, tag: 'pp4', startWorkers });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
    if (balls === 8) {
      const dd = await replay({ bytes: partyBytes(true), log: parsed, ticks: n, threads: 1, tag: 'ppd' });
      assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(dd.trace).tickHashes], 'the debug build steps the same bits');
    }
  });
}

test('the client module: the floor drawn with the grid as its paint layer, the bombs, its frame and HUD lines; its brain keeps off the rim and makes for a bomb', async () => {
  const { Scene } = await import('../client/party-render.mjs');
  const g = await room(3, { seed: 11 });
  const d = disc(3);
  put(g, 0, C + 2, C - 1);
  put(g, 1, C - 5, C + 2);
  put(g, 2, C + 6, C + 6);
  for (let k = 0; k < 20; k++) g.step();
  const out = { scene: new Scene(24000), solid: [], glow: [], beams: [], decals: [], casters: [], paint: null };
  paint.draw(g.v, { tick: g.v.tick, t: g.v.party().t * TICK, dt: 0, now: 0, slot: 0 }, out);
  assert.ok(out.scene.count >= 3, `${out.scene.count} solids`);
  for (let k = 0; k < out.scene.count * 16; k++) assert.ok(Number.isFinite(out.scene.data[k]), 'finite');
  const pl = out.paint;
  assert.ok(pl && pl.n === N && pl.cells.length === N * N);
  assert.deepEqual([pl.origin[0], pl.origin[1], pl.size], [d.x0, d.x0, d.cs * N]);
  for (let c = 0; c < N * N; c++) {
    const v = g.grid[c];
    assert.equal(pl.cells[c], v === 0 || v === L.PP_OFF ? 0 : v, `cell ${c}`);
  }
  for (const p of [0, 1, 2]) assert.equal(pl.palette[4 * (p + 1) + 3], 1, 'a colour for each slot');
  assert.equal(pl.palette[3], 0, 'unpainted: the floor\'s own');
  assert.equal(out.decals.length, 2 + stage(g.v).orbs, 'the rim, a ring for every bomb, the leader\'s');
  const lead = [0, 1, 2].reduce((a, p) => (heldBy(g.v, p) > heldBy(g.v, a) ? p : a), 0);
  const ring = out.decals.at(-1), lb = g.v.partier(lead);
  assert.ok(Math.hypot(ring.pos[0] - lb.pos[0], ring.pos[2] - lb.pos[2]) < 1e-3, 'round the leader');
  const fr = paint.frame(g.v);
  assert.deepEqual([fr.shape, fr.radius, fr.centre[1]], ['disc', d.rad, PLAT_Y]);
  const lines = [], rects = [];
  const hctx = { put: (x, y, s, c) => lines.push([y, s, c]), centre: (y, s, c) => lines.push([y, s, c]), right: (y, s, c) => lines.push([y, s, c]),
    rect: (...r) => rects.push(r), rows: 44, C: {}, slot: 0, now: 0 };
  paint.hud(g.v, hctx);
  const text = lines.map((l) => l[1]).join(' | ');
  assert.ok(/YOU \d+\.\d% {2}\d(ST|ND|RD)/.test(text), text);
  assert.ok(rects.length >= 4, 'the bar');
  for (const l of lines) assert.ok(l[1].length <= 80 && l[0] >= 2 && l[0] <= 6, l[1]);
  assert.ok(paint.hint.length <= 70, paint.hint);
  // danger: none in the middle, a warning near the rim, a fall past it
  assert.equal(paint.brain.danger(g.v, C, C), 0);
  assert.ok(paint.brain.danger(g.v, C + d.rad - 1, C) > 0.1);
  assert.equal(paint.brain.danger(g.v, C + d.rad + 0.5, C), 1);
  // the goal: inside the disc, off its own paint; a bomb down next to it, that
  const bot = { mem: {}, skill: 1, rand: () => 0.5 };
  const goal = paint.brain.goal(g.v, g.v.partier(0), bot);
  assert.ok(Math.hypot(goal[0] - C, goal[1] - C) < d.rad - 1, `${goal}`);
  const b = orb(g.v, 0);
  hold(g, 0, 0);
  away(g, 1);
  away(g, 2, 1);
  put(g, 0, b.x + 3, b.z);
  g.step();
  const near = paint.brain.goal(g.v, g.v.partier(0), { mem: {}, skill: 1, rand: () => 0.5 });
  assert.ok(Math.hypot(near[0] - b.x, near[1] - b.z) < 1e-3, `for the bomb: ${near} vs ${b.x},${b.z}`);
  assert.equal(paint.brain.hop(), false);
});
