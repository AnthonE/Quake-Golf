import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty, partyBytes, predicted } from './helpers.mjs';
import { View, partyWord, hexAt, hexCentre, PLAT_Y } from '../src/party-view.mjs';
import { replay, parseLog, encodeLog, decodeTrace, newMemory, instantiate, Sim } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import * as L from '../src/layout.mjs';
import color, { when, cycleAt, warnOf, rimOf, stage, callOf, colourOf, holds, solidAt, survived } from '../client/mg/color.mjs';

const C = L.B_CX;
const S = Math.fround(L.CC_S);
const TICK = 0.008;

// A room of n balls on Color Call, on the debug build (a NaN traps).
async function room(n = 2, { play = true, seed = 7 } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_COLOR + 1, true);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); assert.equal(sim.error().code, 0, 'no trap'); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  while (play && v.hole().state !== L.H_PLAY) step();
  return { sim, v, dv, step };
}
const rec = (p) => L.PLAYERS + p * L.PSIZE;
// Ball p at (x, z) on the floor (or y), rolling at vx along x.
function put(g, p, x, z, { y = PLAT_Y, vx = 0, ground = true } = {}) {
  g.dv.setFloat32(rec(p) + L.P_PX, x, true);
  g.dv.setFloat32(rec(p) + L.P_PY, y, true);
  g.dv.setFloat32(rec(p) + L.P_PZ, z, true);
  g.dv.setFloat32(rec(p) + L.P_VX, vx, true);
  g.dv.setFloat32(rec(p) + L.P_VY, 0, true);
  g.dv.setFloat32(rec(p) + L.P_VZ, 0, true);
  g.dv.setUint8(rec(p) + L.P_FL, L.PF_LIVE | (ground ? L.PF_GROUND : 0));
}
// Balls ps still on the tile round (x, z), 2 m or more apart: one in the middle, two across it, three in a triangle.
function park(g, ps, x, z) {
  const at = ps.length === 1 ? [[0, 0]] : ps.length === 2 ? [[-1.05, 0], [1.05, 0]] : [[0, 1.2], [-1.04, -0.6], [1.04, -0.6]];
  ps.forEach((p, k) => put(g, p, x + at[k][0], z + at[k][1]));
}
// The next step plays tick t into play (the clock moved; the round's end with it).
function at(g, t) {
  const now = g.v.tick;
  g.dv.setUint32(L.HDR_START, now - t, true);
  g.dv.setUint32(L.HDR_UNTIL, now - t + L.CC_LEN, true);
}
const playT = (g) => g.v.party().t; // the tick into play the next step plays
const fxs = (v, kind) => { const out = []; for (let k = 0; k < v.fxCount(); k++) { const f = v.fx(k); if (f.kind === kind) out.push(f); } return out; };
// Tiles of the board within rim, as [q, r, x, z].
function tilesIn(st, rim) {
  const out = [], n = Math.ceil(st.r0 / S) + 2, r2 = Math.fround(rim * rim);
  for (let r = -n; r <= n; r++) for (let q = -n; q <= n; q++) {
    const [x, z] = hexCentre(q, r, S, st.cx);
    const dx = Math.fround(x - st.cx), dz = Math.fround(z - st.cx);
    if (Math.fround(Math.fround(dx * dx) + Math.fround(dz * dz)) <= r2) out.push([q, r, x, z]);
  }
  return out;
}
// A tile of cycle c that holds through its drop (want true) or doesn't, inside rim, at least `away` m from (ax, az).
function tile(st, c, want, { rim = rimOf(st.r0, c), away = 0, ax = C, az = C } = {}) {
  const w = { ...when(cycleAt(c)) };
  return tilesIn(st, rim).find(([q, r, x, z]) => holds(st, q, r, w.d0, w) === want && Math.hypot(x - ax, z - az) >= away);
}

test('the stage for 1, 8, 64 and 256: a disc of hex tiles sized for the crowd, 4 colours or 5, every ball on it apart', async () => {
  let last = 0;
  for (const n of [1, 8, 64, 256]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party();
    const rad = Math.min(L.CC_R0 + L.CC_RK * Math.sqrt(n), L.CC_RMAX);
    assert.equal(r.game, L.MG_COLOR);
    assert.ok(Math.abs(r.size - rad) < 1e-4, `${r.size} m for ${n}`);
    assert.ok(r.size > last, 'grows with the crowd');
    last = r.size;
    const st = stage(g.v);
    assert.equal(st.r0, r.size);
    assert.equal(st.k, n > L.CC_KN5 ? 5 : 4);
    assert.deepEqual([r.kind, r.len, r.floor, r.idle, r.drag, r.hop], [L.PK_OUT, L.CC_LEN, PLAT_Y, Math.fround(L.CC_IDLE), Math.fround(Number(L.BPHYS.B_DRAG)), 6]);
    const tiles = tilesIn(st, st.r0);
    const area = Math.PI * r.size * r.size / (1.5 * Math.sqrt(3) * S * S);
    assert.ok(Math.abs(tiles.length / area - 1) < 0.12, `${tiles.length} tiles in a disc of ${r.size} m, about ${area.toFixed(0)}`);
    // every colour on the board, about evenly
    const count = new Array(st.k).fill(0);
    for (const [q, rr] of tiles) count[colourOf(st, q, rr, 0)]++;
    for (const k of count) assert.ok(k > tiles.length / st.k * 0.6, `colours ${count}`);
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p);
      assert.equal(b.pos[1], PLAT_Y, 'on the floor');
      assert.ok(b.ground && !b.out);
      assert.ok(Math.hypot(b.pos[0] - C, b.pos[2] - C) <= r.size * L.CC_SPAWN + 1e-3, 'on the middle of the disc');
      for (let q = 0; q < p; q++) {
        const o = g.v.partier(q);
        assert.ok(Math.hypot(b.pos[0] - o.pos[0], b.pos[2] - o.pos[2]) >= 2, `${n}: P${p + 1} and P${q + 1} apart`);
      }
    }
  }
});

test('the schedule: a rest, a warning from 2.6 s down to 1.2 s, a 1.52 s drop; sudden death\'s warning 1.6 s', () => {
  assert.equal(L.CC_FULL, (L.CC_WARN0 - L.CC_WARN1) / L.CC_WARNK);
  assert.equal(L.CC_SD, L.CC_SHRINK + L.CC_SHRINKN);
  assert.equal(cycleAt(L.CC_FULL), L.CC_T_FULL);
  assert.equal(cycleAt(L.CC_SD), L.CC_T_SD);
  assert.equal(L.CC_FX_CALL, L.FX_MG + 4 * L.MG_COLOR);
  assert.deepEqual([L.CC_FX_DROP, L.CC_FX_RISE], [L.CC_FX_CALL + 1, L.CC_FX_CALL + 2]);
  assert.deepEqual([warnOf(0), warnOf(1), warnOf(6), warnOf(7), warnOf(17), warnOf(18), warnOf(40)], [325, 300, 175, 150, 150, 200, 200]);
  let t = 0;
  for (let c = 0; c < 40; c++) {
    assert.equal(cycleAt(c), t, `cycle ${c} starts where the last ended`);
    const w = when(t);
    assert.deepEqual(w, { c, s: t, w0: t + L.CC_REST, d0: t + L.CC_REST + warnOf(c), e: t + L.CC_REST + warnOf(c) + L.CC_DROP });
    assert.equal(when(w.e - 1).c, c);
    assert.equal(when(w.d0 - 1).d0, w.d0);
    t = w.e;
  }
  assert.ok(cycleAt(L.CC_SD) * TICK > 65 && cycleAt(L.CC_SD) * TICK < 85, `sudden death from ${cycleAt(L.CC_SD) * TICK} s`);
  assert.ok(when(L.CC_LEN).c > L.CC_SD + 4, 'and a few of them before the clock');
  // the rim: the disc's own to cycle CC_SHRINK - 1, then in even steps to CC_RMIN
  const r0 = Math.fround(50);
  assert.equal(rimOf(r0, -1), r0);
  assert.equal(rimOf(r0, L.CC_SHRINK - 1), r0);
  for (let c = L.CC_SHRINK; c < L.CC_SD; c++) assert.ok(rimOf(r0, c) < rimOf(r0, c - 1), `shrinks at ${c}`);
  assert.equal(rimOf(r0, L.CC_SD - 1), L.CC_RMIN);
  assert.equal(rimOf(r0, 60), L.CC_RMIN);
});

test('every call is a tile still on the board through its drop, and no colour is called twice running unless every tile the drop leaves has one of the two', async () => {
  for (const [n, seed] of [[2, 3], [40, 4], [100, 5], [256, 6]]) {
    const g = await room(n, { play: false, seed });
    const st = stage(g.v);
    let repeats = 0;
    for (let c = 0; c < 40; c++) {
      const call = callOf(st, c);
      const w = when(cycleAt(c));
      assert.ok(call.colour >= 0 && call.colour < st.k);
      assert.equal(colourOf(st, call.q, call.r, c), call.colour, 'the tile is the colour called');
      assert.ok(holds(st, call.q, call.r, w.d0, w), `${n}: cycle ${c}'s call holds through the drop`);
      assert.ok(holds(st, call.q, call.r, w.e - 1, w));
      if (c > 0 && call.colour === callOf(st, c - 1).colour) repeats++;
    }
    assert.equal(repeats, 0, `${n}: ${repeats} repeats`);
  }
  // 2500 boards at 4 colours and at 5 (the room's seed rewritten): an odd cycle repeats a
  // neighbour's colour only when every tile its drop leaves is one of theirs, on the middle tile
  for (const n of [2, 100]) {
    const g = await room(n, { play: false, seed: 9 });
    let forced = 0, odd = 0;
    for (let s = 1; s <= 2500; s++) {
      g.dv.setUint32(L.HDR_SEED, s, true);
      const st = stage(g.v);
      for (let c = 1; c < 30; c += 2, odd++) {
        const call = callOf(st, c), a = callOf(st, c - 1).colour, b = callOf(st, c + 1).colour;
        assert.equal(colourOf(st, call.q, call.r, c), call.colour);
        if (call.colour !== a && call.colour !== b) continue;
        forced++;
        const left = tilesIn(st, rimOf(st.r0, c)).map(([q, r]) => colourOf(st, q, r, c));
        assert.ok(left.every((k) => k === a || k === b), `${n}, seed ${s}: cycle ${c} repeats with a tile of another colour left`);
        assert.deepEqual([call.q, call.r], [0, 0], 'the middle tile');
      }
    }
    assert.ok(forced > 0 && forced / odd < (n > L.CC_KN5 ? 0.004 : 0.01), `${n}: ${forced} of ${odd} odd cycles repeat`);
  }
  // the sim's calls are the mirror's: every odd cycle's of 300 boards, ten or so of them past the tries
  const g = await room(2, { seed: 9 });
  for (let s = 1; s <= 300; s++) {
    g.dv.setUint32(L.HDR_SEED, s, true);
    const st = stage(g.v);
    for (let c = 1; c < 30; c += 2) {
      at(g, when(cycleAt(c)).w0);
      park(g, [0, 1], C, C);
      const k0 = g.v.fxCount();
      g.step();
      const fx = [];
      for (let k = k0; k < g.v.fxCount(); k++) if (g.v.fx(k).kind === L.CC_FX_CALL) fx.push(g.v.fx(k));
      const call = callOf(st, c), [x, z] = hexCentre(call.q, call.r, S, st.cx);
      assert.equal(fx.length, 1, `seed ${s}: cycle ${c}'s call`);
      assert.deepEqual([fx[0].shot, fx[0].pos[0], fx[0].pos[2]], [call.colour | (c << 4), x, z], `seed ${s}: cycle ${c}'s call, its tile`);
    }
  }
});

test('the board shuffles every cycle, and during a drop only the colour called holds', async () => {
  const g = await room(2, { play: false, seed: 9 });
  const st = stage(g.v);
  const tiles = tilesIn(st, st.r0);
  for (let c = 0; c < 4; c++) {
    let same = 0;
    for (const [q, r] of tiles) same += colourOf(st, q, r, c) === colourOf(st, q, r, c + 1);
    assert.ok(same < tiles.length * 0.45, `cycle ${c + 1}: ${same} of ${tiles.length} tiles kept their colour`);
    const w = when(cycleAt(c));
    let held = 0;
    for (const [q, r] of tiles) {
      assert.ok(holds(st, q, r, w.d0 - 1, w), 'every tile up through the warning');
      const h = holds(st, q, r, w.d0, w);
      assert.equal(h, colourOf(st, q, r, c) === callOf(st, c).colour);
      held += h;
    }
    assert.ok(held > tiles.length / 8 && held < tiles.length / 2, `${held} of ${tiles.length} hold`);
  }
});

test('the drop in the sim: a ball on the colour called stays up, one on another colour falls and is out; the tiles come back as the drop ends', async () => {
  const g = await room(3);
  const st = stage(g.v);
  const c = 1, w = when(cycleAt(c));
  at(g, w.d0 - 20);
  const call = callOf(st, c);
  const [cx, cz] = hexCentre(call.q, call.r, S, st.cx);
  const safe = tile(st, c, true, { away: 6, ax: cx, az: cz });
  const bad = tile(st, c, false, { away: 6, ax: cx, az: cz });
  put(g, 0, safe[2], safe[3]);
  put(g, 1, bad[2], bad[3]);
  put(g, 2, cx, cz);
  const before = g.v.fxCount();
  while (playT(g) < w.d0) { g.step(); assert.ok(g.v.partier(1).ground, 'every tile up through the warning'); }
  let fell = -1;
  while (playT(g) < w.e && !g.v.partier(1).out) {
    g.step();
    assert.ok(g.v.partier(0).ground && g.v.partier(2).ground, `the colour called holds at ${playT(g) - 1 - w.d0}`);
    if (fell < 0 && !g.v.partier(1).ground) fell = playT(g) - 1;
  }
  assert.equal(fell, w.d0, 'gone on the drop\'s first tick');
  const b = g.v.partier(1);
  assert.ok(b.out, 'out before the tiles come back');
  assert.equal(b.place, 3);
  assert.ok((playT(g) - w.d0) * TICK < 1.3, `out ${(playT(g) - w.d0) * TICK} s into the drop`);
  const drop = fxs(g.v, L.CC_FX_DROP).find((f) => f.tick >= g.v.tick - (playT(g) - w.d0));
  assert.ok(drop && g.v.fxCount() > before);
  assert.deepEqual([drop.owner, drop.shot, drop.pos[0], drop.pos[1], drop.pos[2]], [255, call.colour | (c << 4), cx, PLAT_Y, cz]);
  // a ball over a dropped tile, high enough to land after the drop's end, lands on it come back
  const gone = tile(st, c, false, { away: 6, ax: cx, az: cz });
  while (playT(g) < w.e - 40) g.step();
  put(g, 0, gone[2], gone[3], { y: PLAT_Y + 3, ground: false });
  assert.ok(!holds(st, gone[0], gone[1], playT(g)));
  let k = 0;
  while (!g.v.partier(0).ground && k++ < 200) g.step();
  assert.ok(g.v.partier(0).ground && !g.v.partier(0).out, 'landed');
  assert.equal(g.v.partier(0).pos[1], PLAT_Y);
  assert.ok(playT(g) - 1 >= w.e, 'after the drop\'s end');
  assert.equal(g.v.party().state, L.H_PLAY);
});

test('rolling off a held tile in the drop falls; rolling back onto one within the step\'s 0.3 m is caught', async () => {
  const g = await room(3);
  const st = stage(g.v);
  const c = 2, w = when(cycleAt(c));
  at(g, w.d0 + 5);
  const call = callOf(st, c);
  const [cx, cz] = hexCentre(call.q, call.r, S, st.cx);
  park(g, [1, 2], cx, cz);
  // a held tile next to a dropped one, in a line along x: roll from the held one over the gap
  const pair = tilesIn(st, rimOf(st.r0, c) - 4).find(([q, r, x, z]) => holds(st, q, r, w.d0, w) && !holds(st, q + 1, r, w.d0, w) && Math.hypot(x - cx, z - cz) > 6);
  const [q, r, x, z] = pair;
  put(g, 0, x, z, { vx: 9 });
  let n = 0;
  while (!g.v.partier(0).falling && n++ < 120) g.step([[L.EV_INPUT, 0, partyWord({ yaw: 0, move: 1 })]]);
  assert.ok(g.v.partier(0).falling, 'off the edge, falling');
  const [q1, r1] = hexAt(g.v.partier(0).pos[0], g.v.partier(0).pos[2], S, st.cx);
  assert.ok(!(q1 === q && r1 === r), 'past its own tile');
  // a ball just off a held tile's edge, 0.2 m under its top, rolling onto it: back up
  const [hx, hz] = hexCentre(q, r, S, st.cx);
  const edge = hx + S * 0.866 + 0.05; // past the flat side toward +x, over the dropped tile
  put(g, 0, edge, hz, { y: PLAT_Y - 0.2, vx: -6, ground: false });
  g.dv.setFloat32(rec(0) + L.P_VY, -0.5, true);
  n = 0;
  while (!g.v.partier(0).ground && n++ < 10) g.step();
  assert.ok(g.v.partier(0).ground && g.v.partier(0).pos[1] === PLAT_Y, 'caught by the step');
});

test('from cycle CC_SHRINK the ring outside the coming rim drops whatever the colour, and stays gone', async () => {
  const g = await room(3, { seed: 12 });
  const st = stage(g.v);
  // the first shrinking cycle with a tile of the colour called in the ring its drop takes
  let c = L.CC_SHRINK, ring = null;
  for (; c < L.CC_SD && !ring; c++) {
    const rimP = rimOf(st.r0, c - 1), rimN = rimOf(st.r0, c);
    assert.ok(rimN < rimP, `shrinks at ${c}`);
    ring = tilesIn(st, rimP).find(([q, r, x, z]) => colourOf(st, q, r, c) === callOf(st, c).colour && !holds(st, q, r, when(cycleAt(c)).d0));
  }
  c--;
  assert.ok(ring, 'a tile of the colour called in the doomed ring');
  const w = when(cycleAt(c)), rimN = rimOf(st.r0, c);
  at(g, w.w0 + 10);
  const call = callOf(st, c);
  const [cx, cz] = hexCentre(call.q, call.r, S, st.cx);
  park(g, [1, 2], cx, cz);
  put(g, 0, ring[2], ring[3]);
  while (playT(g) < w.d0) { g.step(); assert.ok(g.v.partier(0).ground); }
  g.step();
  assert.ok(!g.v.partier(0).ground, 'dropped with the ring');
  const fx = fxs(g.v, L.CC_FX_DROP).at(-1);
  assert.equal(fx.size, rimN, 'the drop\'s FX: the rim it leaves');
  // the next cycle: the tile isn't there in the rest either
  while (playT(g) < w.e + 5) g.step();
  assert.ok(!holds(st, ring[0], ring[1], playT(g)));
  put(g, 0, ring[2], ring[3]);
  g.step();
  assert.ok(!g.v.partier(0).ground, 'gone for good');
  const rise = fxs(g.v, L.CC_FX_RISE).at(-1);
  assert.deepEqual([rise.shot, rise.size], [(c + 1) << 4, rimOf(st.r0, c + 1)]);
});

test('sudden death: one tile holds, the one called, with the board at its smallest', async () => {
  const g = await room(3, { seed: 13 });
  const st = stage(g.v);
  const c = L.CC_SD + 1, w = when(cycleAt(c));
  at(g, w.w0 - 5);
  const call = callOf(st, c);
  const [cx, cz] = hexCentre(call.q, call.r, S, st.cx);
  const board = tilesIn(st, L.CC_RMIN);
  assert.equal(board.length, 7, 'the middle tile and its ring');
  const other = board.find(([q, r]) => q !== call.q || r !== call.r);
  put(g, 0, other[2], other[3]);
  park(g, [1, 2], cx, cz);
  while (playT(g) < w.d0) g.step();
  g.step();
  assert.ok(!g.v.partier(0).ground, 'any other tile drops');
  assert.ok(g.v.partier(1).ground && g.v.partier(2).ground, 'the one called holds');
  const callFx = fxs(g.v, L.CC_FX_CALL).at(-1);
  assert.deepEqual([callFx.shot, callFx.pos[0], callFx.pos[2], callFx.size], [call.colour | (c << 4), cx, cz, L.CC_WARNSD]);
});

test('the last balls up all falling to one drop share the win, rather than all sharing last', async () => {
  const g = await room(3, { seed: 14 });
  const st = stage(g.v);
  // P1 goes first, alone, at cycle 1's drop
  let w = when(cycleAt(1));
  at(g, w.d0 - 5);
  let call = callOf(st, 1);
  let [cx, cz] = hexCentre(call.q, call.r, S, st.cx);
  park(g, [1, 2], cx, cz);
  const bad = tile(st, 1, false, { away: 6, ax: cx, az: cz });
  put(g, 0, bad[2], bad[3]);
  while (!g.v.partier(0).out) g.step();
  assert.equal(g.v.partier(0).place, 3);
  // then P2 and P3 both on tiles cycle 2's drop takes
  w = when(cycleAt(2));
  at(g, w.d0 - 5);
  call = callOf(st, 2);
  [cx, cz] = hexCentre(call.q, call.r, S, st.cx);
  const a = tile(st, 2, false, { away: 6, ax: cx, az: cz });
  const b = tile(st, 2, false, { away: 6, ax: a[2], az: a[3] });
  put(g, 1, a[2], a[3]);
  put(g, 2, b[2], b[3]);
  let n = 0;
  while (g.v.party().state === L.H_PLAY && n++ < 300) g.step();
  const r = g.v.party();
  assert.equal(r.state, L.H_OVER, 'over');
  assert.ok((r.t - w.d0) * TICK < 0.5, `as soon as both were falling (${((r.t - w.d0) * TICK).toFixed(2)} s)`);
  assert.equal(r.winner, 255, 'shared');
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).place), [3, 1, 1]);
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).pts), [1, 10, 10]);
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).wins), [0, 1, 1]);
});

test('balls that went over ticks apart don\'t share the win: the first is out in its place, the last up wins alone (or the two that went together share it)', async () => {
  for (const n of [2, 3]) {
    const g = await room(n, { seed: 15 });
    const r = g.v.party().size;
    // P1 off the board, falling; 40 ticks on the rest go off, on one tick
    put(g, 0, C + r + 3, C, { y: PLAT_Y - 0.5, ground: false });
    for (let k = 0; k < 40; k++) g.step();
    assert.ok(g.v.partier(0).falling && !g.v.partier(0).out, 'going out');
    for (let p = 1; p < n; p++) put(g, p, C - r - 3, C + 3 * p, { y: PLAT_Y - 0.5, ground: false });
    let k = 0;
    while (g.v.party().state === L.H_PLAY && k++ < 400) {
      g.step();
      if (g.v.party().state === L.H_PLAY) assert.ok(!g.v.partier(1).out, 'not over while P1 falls');
    }
    const p = g.v.party();
    assert.equal(p.state, L.H_OVER);
    const ps = Array.from({ length: n }, (_, q) => q);
    if (n === 2) {
      assert.deepEqual(ps.map((q) => g.v.partier(q).place), [2, 1]);
      assert.equal(p.winner, 1, 'the last up wins alone');
      assert.deepEqual(ps.map((q) => g.v.partier(q).wins), [0, 1]);
    } else {
      assert.deepEqual(ps.map((q) => g.v.partier(q).place), [3, 1, 1]);
      assert.equal(p.winner, 255, 'the two that went together share it');
      assert.deepEqual(ps.map((q) => g.v.partier(q).pts), [1, 10, 10]);
    }
    assert.ok(g.v.partier(0).out && ps.slice(1).every((q) => !g.v.partier(q).out));
  }
});

test('braking: with no keys a ball stops from 10 m/s in about 3 m; with keys held it rolls on', async () => {
  const g = await room(2);
  at(g, 2);
  put(g, 0, C - 6, C - 3, { vx: 10 });
  put(g, 1, C - 6, C + 3, { vx: 10 });
  const x0 = g.v.partier(0).pos[0];
  for (let k = 0; k < 100; k++) g.step([[L.EV_INPUT, 1, partyWord({ yaw: 0, move: 1 })]]);
  assert.ok(g.v.partier(1).vel[0] > 9, `rolling: ${g.v.partier(1).vel[0]} m/s`);
  for (let k = 0; k < 150; k++) g.step([[L.EV_INPUT, 1, partyWord({ yaw: 0 })]]);
  const a = g.v.partier(0);
  assert.ok(Math.abs(a.vel[0]) < 0.25, `coasting: ${a.vel[0]} m/s left`);
  assert.ok(a.pos[0] - x0 > 2.5 && a.pos[0] - x0 < 3.5, `stopped in ${(a.pos[0] - x0).toFixed(2)} m`);
});

test('CC_SURV counts the calls a ball lived through; the FX mark each call, drop and rise on time', async () => {
  const g = await room(3, { seed: 21 });
  const st = stage(g.v);
  const seen = { call: [], drop: [], rise: [] };
  let k0 = g.v.fxCount();
  // keep every ball on the call's tile, so all three live through four cycles
  for (let c = 0; c < 4; c++) {
    const w = when(cycleAt(c));
    const call = callOf(st, c);
    const [x, z] = hexCentre(call.q, call.r, S, st.cx);
    while (playT(g) < w.e) {
      if (playT(g) === w.d0 - 30) park(g, [0, 1, 2], x, z);
      g.step();
      for (; k0 < g.v.fxCount(); k0++) {
        const f = g.v.fx(k0);
        const t = f.tick - g.v.party().start;
        if (f.kind === L.CC_FX_CALL) seen.call.push([t, f.shot, f.size]);
        if (f.kind === L.CC_FX_DROP) seen.drop.push([t, f.shot]);
        if (f.kind === L.CC_FX_RISE) seen.rise.push([t, f.shot]);
      }
    }
  }
  g.step();
  for (; k0 < g.v.fxCount(); k0++) { const f = g.v.fx(k0); if (f.kind === L.CC_FX_RISE) seen.rise.push([f.tick - g.v.party().start, f.shot]); }
  assert.deepEqual(seen.call, [0, 1, 2, 3].map((c) => [when(cycleAt(c)).w0, callOf(st, c).colour | (c << 4), warnOf(c)]));
  assert.deepEqual(seen.drop, [0, 1, 2, 3].map((c) => [when(cycleAt(c)).d0, callOf(st, c).colour | (c << 4)]));
  assert.deepEqual(seen.rise, [1, 2, 3, 4].map((c) => [cycleAt(c), c << 4]));
  assert.deepEqual([0, 1, 2].map((p) => survived(g.v, p)), [4, 4, 4]);
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).score), [0, 0, 0], 'nothing in the record the prediction would miss');
});

test('the prediction matches the confirmed ball bit for bit: held through a drop, rolling off into the gap, landing on tiles come back, sudden death', async () => {
  const g = await room(3, { seed: 31 });
  const st = stage(g.v);
  // A: still on a held tile through the drop's start, then off it into a dropped one
  let c = 1, w = when(cycleAt(c));
  at(g, w.d0 - 40);
  let call = callOf(st, c);
  let [cx, cz] = hexCentre(call.q, call.r, S, st.cx);
  park(g, [1, 2], cx, cz);
  const held = tilesIn(st, rimOf(st.r0, c) - 3).find(([q, r, x, z]) => holds(st, q, r, w.d0, w) && !holds(st, q + 1, r, w.d0, w) && Math.hypot(x - cx, z - cz) > 8);
  put(g, 0, held[2], held[3]);
  const words = [...Array(80).fill(partyWord({})), ...Array(140).fill(partyWord({ yaw: 0, move: 1 }))];
  let k = 0;
  for (; k < 80; k += 10) {
    assert.ok(predicted(g, words.slice(k, k + 10)) >= 10);
    assert.ok(g.v.partier(0).ground, 'held through the drop\'s start');
  }
  assert.ok(playT(g) > w.d0 + 30);
  assert.ok(predicted(g, words.slice(k)) >= words.length - k);
  assert.ok(g.v.partier(0).falling || g.v.partier(0).out, 'went through');
  // B: in the air over a dropped tile through the drop's end, onto it come back, rolling on into the rest and the warning
  c = 3; w = when(cycleAt(c));
  at(g, w.e - 60);
  call = callOf(st, c);
  [cx, cz] = hexCentre(call.q, call.r, S, st.cx);
  park(g, [1, 2], cx, cz);
  const gone = tile(st, c, false, { away: 8, ax: cx, az: cz, rim: rimOf(st.r0, c) - 6 });
  put(g, 0, gone[2], gone[3], { y: PLAT_Y + 4, ground: false });
  const roll = [...Array(70).fill(partyWord({})), ...Array(120).fill(partyWord({ yaw: 4096, move: 1 })), ...Array(60).fill(partyWord({ yaw: 12288, move: 1 }))];
  assert.ok(predicted(g, roll) >= roll.length);
  assert.ok(!g.v.partier(0).out, 'landed and rolled on');
  // C: sudden death, rolling round the smallest board
  c = L.CC_SD; w = when(cycleAt(c));
  at(g, w.w0);
  call = callOf(st, c);
  [cx, cz] = hexCentre(call.q, call.r, S, st.cx);
  park(g, [1, 2], cx, cz);
  const other = tilesIn(st, L.CC_RMIN).find(([q, r]) => q !== call.q || r !== call.r);
  put(g, 0, other[2], other[3]);
  const sd = Array.from({ length: 360 }, (_, k) => partyWord({ yaw: (k * 97) & 16383, move: (k >> 4) & 1, hop: k % 50 === 0 ? 1 : 0 }));
  assert.ok(predicted(g, sd) >= sd.length);
});

// A round of AI balls, each steered by this minigame's brain (think, every
// 4th tick, its word landing `delay` ticks later as over a network), recorded
// as a log: { log, sim, stats }.
async function aiRound({ bytes, seed, balls, ticks, delay = 8 }) {
  const memory = newMemory();
  const sim = new Sim(await instantiate(await WebAssembly.compile(bytes), memory), memory);
  sim.init(seed);
  const v = new View(memory.buffer);
  const bots = Array.from({ length: balls }, (_, k) => ({ slot: k, skill: 0.3 + 0.6 * ((k * 7) % 10) / 9, queue: [], last: -1, word: partyWord({}) }));
  const recs = [];
  const stats = { start: -1, over: -1, calls: [], places: null, pts: null, winner: -1 };
  let seen = 0;
  for (let t = 0; t < ticks; t++) {
    const now = [];
    if (t === 0) for (const b of bots) now.push([L.EV_JOIN, b.slot]);
    for (const b of bots) {
      if ((t + b.slot) % 4 === 0) {
        const o = color.brain.think(v, b.slot, b, v.tick + delay);
        b.word = o ? partyWord(o) : partyWord({ yaw: b.word & 16383 });
      }
      b.queue.push(b.word);
      if (b.queue.length > delay) {
        const w = b.queue.shift();
        if (w !== b.last) { now.push([L.EV_INPUT, b.slot, w]); b.last = w; }
      }
    }
    for (const [kind, slot, word] of now) recs.push([t, kind, slot, word]);
    sim.feedPlayers(now);
    sim.x.step();
    if (sim.error().code) break;
    const g = v.party();
    for (; seen < v.fxCount(); seen++) if (v.fx(seen).kind === L.CC_FX_CALL) stats.calls.push(g.left);
    if (stats.start < 0 && g.state === L.H_PLAY) stats.start = t;
    if (stats.over < 0 && stats.start >= 0 && g.state === L.H_OVER) {
      stats.over = t;
      stats.winner = g.winner;
      stats.places = bots.map((b) => v.partier(b.slot).place);
      stats.pts = bots.map((b) => v.partier(b.slot).pts);
    }
  }
  return { log: encodeLog({ courseSeed: seed, ticks, recs }), sim, stats };
}

for (const [balls, ticks] of [[8, 13000], [64, 13000]]) {
  test(`a round of ${balls} AI balls on the debug build: no trap, a while before most are out, a winner; equal on 1 and 4 threads`, async () => {
    const seed = (0xa7000000 | (L.MG_COLOR << 16) | balls) >>> 0;
    const { log, sim, stats } = await aiRound({ bytes: partyBytes(true), seed, balls, ticks });
    assert.equal(sim.error().code, 0);
    assert.ok(stats.over > 0, 'the round ended');
    const secs = (stats.over - stats.start) * TICK;
    assert.ok(secs > 25 && secs < L.CC_LEN * TICK, `${secs.toFixed(1)} s of play`);
    assert.ok(stats.calls.length >= 6, `${stats.calls.length} calls`);
    assert.ok(stats.calls[3] > balls / 2, `still ${stats.calls[3]} of ${balls} up at the fourth call (${stats.calls})`);
    assert.ok(stats.places.every((x) => x >= 1 && x <= balls), `places ${stats.places}`);
    assert.ok(stats.pts.every((x) => x >= 1 && x <= 10), `points ${stats.pts}`);
    assert.ok(stats.places.includes(1) && stats.pts.includes(10), 'somebody won');
    const v = new View(sim.memory.buffer);
    assert.equal(v.party().game, L.MG_COLOR);
    assert.ok(v.hole().hole >= 1, 'on to the next round');
    const parsed = parseLog(log);
    const n = stats.over + 50;
    const a = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 1, tag: 't1' });
    const b = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 4, tag: 't4', startWorkers });
    const d = await replay({ bytes: partyBytes(true), log: parsed, ticks: n, threads: 1, tag: 'd1' });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(d.trace).tickHashes], 'the debug build steps the same bits');
  });
}

test('the client module: draws every phase, frames the board, writes its HUD lines, and its brain sees what the sim does', async () => {
  const { Scene } = await import('../client/party-render.mjs');
  const g = await room(3, { seed: 41 });
  const st = stage(g.v);
  const out = { scene: new Scene(24000), solid: [], glow: [], beams: [], decals: [], paint: null };
  const lines = [];
  const hctx = { put: (x, y, s, c) => lines.push([y, s, c]), centre: (y, s, c) => lines.push([y, s, c]), right: (y, s, c) => lines.push([y, s, c]), rows: 44, C: {}, slot: 0, now: 0 };
  const tiles = tilesIn(st, st.r0).length;
  for (const [c, dt] of [[0, 10], [0, 200], [1, 400], [L.CC_SHRINK, 50], [L.CC_SHRINK, 300], [L.CC_SD, 50], [L.CC_SD, 140], [L.CC_SD, 360]]) {
    const w = when(cycleAt(c));
    at(g, w.s + dt);
    g.step();
    out.scene.clear(); out.decals.length = 0; out.beams.length = 0; out.glow.length = 0; lines.length = 0;
    const t = g.v.party().t;
    color.draw(g.v, { tick: g.v.tick, t: t * TICK, dt: 0, now: 0, slot: 0 }, out);
    assert.ok(out.scene.count > 0 && out.scene.count <= tiles + 2, `${out.scene.count} solids`);
    for (let k = 0; k < out.scene.count * 16; k++) assert.ok(Number.isFinite(out.scene.data[k]), 'finite');
    assert.ok(out.decals.length >= 1);
    if (c >= L.CC_SD && t >= w.w0) assert.ok(out.beams.length === 1, 'sudden death\'s beam');
    color.hud(g.v, hctx);
    const text = lines.map((l) => l[1]).join(' | ');
    if (t >= w.w0 && t < w.d0) assert.ok(text.includes(c >= L.CC_SD ? 'ONE TILE' : ['RED', 'YELLOW', 'GREEN', 'BLUE', 'PURPLE'][callOf(st, c).colour]), text);
    // the rest before the first grey ring and before sudden death says what's coming
    if (t < w.w0 && c === L.CC_SHRINK) assert.ok(text.includes('GREY TILES FALL FOR GOOD'), text);
    if (t < w.w0 && c === L.CC_SD) assert.ok(text.includes('SUDDEN DEATH') && text.includes('ONE TILE WILL HOLD'), text);
    for (const l of lines) assert.ok(l[1].length <= 80, l[1]);
    const fr = color.frame(g.v);
    assert.equal(fr.shape, 'disc');
    assert.ok(Math.abs(fr.radius - (rimOf(st.r0, c - 1) + S)) < 1e-3);
  }
  assert.ok(color.hint.length <= 70);
  // danger: 1 where the sim has no floor, 0 on the call's tile
  const c = 2, w = when(cycleAt(c));
  const call = callOf(st, c);
  const [cx, cz] = hexCentre(call.q, call.r, S, st.cx);
  at(g, w.w0 + 10);
  g.step();
  const T = g.v.party().start;
  assert.equal(color.brain.danger(g.v, cx, cz, T + w.d0 + 5), 0);
  const bad = tile(st, c, false, { away: 3, ax: cx, az: cz });
  assert.equal(color.brain.danger(g.v, bad[2], bad[3], T + w.d0 + 5), 1);
  assert.ok(color.brain.danger(g.v, bad[2], bad[3], T + w.d0 - 20) > 0.5, 'a tile about to drop');
  assert.equal(color.brain.danger(g.v, C + 200, C, T + w.w0), 1, 'off the board');
  assert.equal(solidAt(st, cx, cz, w.d0), true);
});
