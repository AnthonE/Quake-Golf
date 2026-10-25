import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty, partyBytes, predicted } from './helpers.mjs';
import { View, partyWord, hexAt, hexCentre, PLAT_Y } from '../src/party-view.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { playParty } from '../tools/genparty.mjs';
import * as L from '../src/layout.mjs';
import * as MC from '../src/mg/bombs.mjs'; // BO_*: the minigame's own constants
import bombs, { rimAt, ramp, cellOf, rimOf, craterOf, holds, bombsOf, stage } from '../client/mg/bombs.mjs';

const C = L.B_CX;
const S = Math.fround(MC.BO_S);
const TICK = 0.008;
const f = Math.fround;

// A room of n balls on Bomb Rain, on the debug build (a NaN traps), stepped
// into play unless asked not to; quiet: no waves (BO_NEXT far off), so a test
// lays its own bombs.
async function room(n = 2, { play = true, seed = 7, quiet = false } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_BOMBS + 1, true);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); assert.equal(sim.error().code, 0, 'no trap'); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  if (quiet) dv.setUint32(L.PG_H + MC.BO_NEXT, 1e6, true);
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
// A bomb in record k landing on tick land at (x, z).
function lay(g, k, x, z, land, { big = false, fall = MC.BO_FALL0, who = 0 } = {}) {
  const a = L.PG_S + MC.BO_BOMBS + k * MC.BO_BSIZE;
  g.dv.setFloat32(a, x, true);
  g.dv.setFloat32(a + 4, z, true);
  g.dv.setUint32(a + 8, land, true);
  g.dv.setUint16(a + 12, fall, true);
  g.dv.setUint8(a + 14, big ? 2 : 1);
  g.dv.setUint8(a + 15, who);
}
// The next step plays tick t into play (the clock moved; the round's end with it).
function at(g, t) {
  const now = g.v.tick;
  g.dv.setUint32(L.HDR_START, now - t, true);
  g.dv.setUint32(L.HDR_UNTIL, now - t + MC.BO_LEN, true);
}
const fxs = (v, kind, from = 0) => { const out = []; for (let k = from; k < v.fxCount(); k++) { const x = v.fx(k); if (x.kind === kind) out.push(x); } return out; };
// Every tile of the disc: [q, r, x, z, a (cell), rho]
function tiles(v) {
  const out = [];
  for (let r = -MC.BO_N; r <= MC.BO_N; r++) for (let q = -MC.BO_N; q <= MC.BO_N; q++) {
    const a = cellOf(q, r);
    if (!rimOf(v, a)) continue;
    const [x, z] = hexCentre(q, r, S);
    out.push([q, r, x, z, a, Math.hypot(x - C, z - C)]);
  }
  return out;
}
// $bo_blast's shove on a still ball at (x, z) on the floor from a bomb at (bx, bz), in f32 as the sim works it.
function shove(x, z, bx, bz, r, s) {
  const dx = f(x - bx), dy = f(f(PLAT_Y + 1) - PLAT_Y), dz = f(z - bz);
  let hd = f(f(dx * dx) + f(dz * dz));
  const d2 = f(f(dy * dy) + hd);
  if (d2 >= f(r * r)) return null;
  hd = f(Math.sqrt(Math.max(hd, f(1e-6))));
  const k = f(f(s * f(1 - f(f(Math.sqrt(d2)) / r))) / 1);
  return [f(f(f(dx / hd) * k) + 0), f(f(k * f(0.35)) + 0), f(f(f(dz / hd) * k) + 0)];
}

test('the stage for 1, 8, 64 and 256: a disc of hex tiles sized for the crowd, each with the tick the rim takes it, every ball on it apart', async () => {
  let last = 0;
  for (const n of [1, 8, 64, 256]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party();
    const rad = Math.min(MC.BO_R0 + MC.BO_RK * Math.sqrt(n), MC.BO_RMAX);
    assert.equal(r.game, L.MG_BOMBS);
    assert.ok(Math.abs(r.size - rad) < 1e-4, `${r.size} m for ${n}`);
    assert.ok(r.size > last, 'grows with the crowd');
    last = r.size;
    assert.equal(g.dv.getFloat32(L.PG_H + MC.BO_RAD, true), r.size);
    assert.deepEqual([r.kind, r.len, r.floor, r.idle, r.hop], [L.PK_OUT, MC.BO_LEN, PLAT_Y, f(MC.BO_IDLE), 6]);
    const all = tiles(g.v);
    assert.equal(g.dv.getUint32(L.PG_H + MC.BO_COUNT, true), all.length);
    const area = Math.PI * r.size * r.size / (1.5 * Math.sqrt(3) * S * S);
    assert.ok(Math.abs(all.length / area - 1) < 0.1, `${all.length} tiles in a disc of ${r.size} m, about ${area.toFixed(0)}`);
    // every cell: a tile if its centre is on the disc; the rim takes it later the further in it is, never inside BO_RMIN
    let cells = 0;
    for (let rr = -MC.BO_N; rr <= MC.BO_N; rr++) for (let q = -MC.BO_N; q <= MC.BO_N; q++) {
      const [x, z] = hexCentre(q, rr, S);
      const rho = Math.hypot(x - C, z - C);
      const rim = rimOf(g.v, cellOf(q, rr));
      if (rho > r.size + 1e-3) { assert.equal(rim, 0, `${n}: no tile at ${q},${rr}`); continue; }
      cells++;
      assert.equal(craterOf(g.v, cellOf(q, rr)), 0);
      if (rho <= MC.BO_RMIN - 1e-3) assert.equal(rim, MC.BO_NEVER, 'the core stays');
      else if (rho > MC.BO_RMIN + 1e-3) {
        const want = MC.BO_CALM + 1 + (r.size - rho) / (r.size - MC.BO_RMIN) * MC.BO_SHRINK;
        assert.ok(Math.abs(rim - want) <= 1.01, `${n}: tile at ${rho.toFixed(2)} m goes at ${rim}, about ${want.toFixed(0)}`);
        assert.ok(rim > MC.BO_CALM && rim <= MC.BO_CALM + MC.BO_SHRINK + 1);
      }
    }
    assert.equal(cells, all.length);
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p);
      assert.equal(b.pos[1], PLAT_Y, 'on the floor');
      assert.ok(b.ground && !b.out);
      const [q, rr] = hexAt(b.pos[0], b.pos[2], S);
      assert.ok(rimOf(g.v, cellOf(q, rr)) > 0, 'on a tile');
      assert.ok(Math.hypot(b.pos[0] - C, b.pos[2] - C) <= r.size * MC.BO_SPAWN + 1e-3, 'on the middle of the disc');
      for (let o = 0; o < p; o++) {
        const c = g.v.partier(o);
        assert.ok(Math.hypot(b.pos[0] - c.pos[0], b.pos[2] - c.pos[2]) >= 2, `${n}: P${p + 1} and P${o + 1} apart`);
      }
    }
  }
});

test('the rim: nothing goes for BO_CALM, then a tile holds through the tick before its own and drops a ball on it; the core never goes', async () => {
  const g = await room(3, { quiet: true });
  const all = tiles(g.v);
  const outer = all.filter((T) => T[5] > MC.BO_RMIN + 2).sort((a, b) => b[5] - a[5]);
  const edge = outer[0], mid = outer[Math.floor(outer.length / 2)];
  assert.equal(edge[4] !== mid[4], true);
  // the outermost tile holds all through the calm
  put(g, 0, edge[2], edge[3]);
  put(g, 1, C, C);
  put(g, 2, mid[2], mid[3]);
  at(g, MC.BO_CALM - 20);
  const rim = rimOf(g.v, edge[4]);
  assert.equal(rim, MC.BO_CALM + 1 + Math.trunc(f(f(f(f(g.v.party().size) - f(edge[5])) / f(f(g.v.party().size) - MC.BO_RMIN)) * MC.BO_SHRINK)) || rim, 'its tick');
  while (g.v.party().t < rim) {
    g.step();
    assert.ok(g.v.partier(0).ground, `held ${g.v.party().t} ticks in`);
  }
  g.step();
  assert.ok(!g.v.partier(0).ground && !g.v.partier(0).out, 'gone from under it');
  // the middle one, later: the clock moved on to just before it goes
  const rim2 = rimOf(g.v, mid[4]);
  assert.ok(rim2 > rim);
  at(g, rim2 - 3);
  for (let k = 0; k < 3; k++) { g.step(); assert.ok(g.v.partier(2).ground); }
  g.step();
  assert.ok(!g.v.partier(2).ground, 'and the next one in at its tick');
  // late on, only the core: the ball in the middle still stands
  at(g, MC.BO_CALM + MC.BO_SHRINK + 2000);
  for (let k = 0; k < 20; k++) g.step();
  assert.ok(g.v.partier(1).ground && !g.v.partier(1).out);
  for (const T of all) {
    const [q, r, x, z, a, rho] = T;
    assert.equal(holds(g.v, a, g.v.tick, g.v.party().t), rho <= MC.BO_RMIN, `${q},${r} at ${rho.toFixed(1)} m`);
  }
  assert.ok(Math.abs(rimAt(g.v.party().size, MC.BO_CALM + MC.BO_SHRINK / 2) - (g.v.party().size + MC.BO_RMIN) / 2) < 1e-6);
});

test('the waves: the first BO_FIRST into play, closing in with the rim, 1 + left / BO_PER bombs and one more every BO_MORE; each lands its fall after its ring', async () => {
  assert.deepEqual([MC.BO_FX_BOOM, MC.BO_FX_WAVE, MC.BO_FX_BIG], [L.FX_MG + 4 * L.MG_BOMBS, L.FX_MG + 4 * L.MG_BOMBS + 1, L.FX_MG + 4 * L.MG_BOMBS + 2]);
  assert.deepEqual([ramp(0, 200, 70), ramp(MC.BO_CALM, 200, 70), ramp(MC.BO_CALM + MC.BO_SHRINK / 2, 200, 70), ramp(MC.BO_CALM + MC.BO_SHRINK, 200, 70), ramp(1e5, 200, 70)], [200, 200, 135, 70, 70]);
  const g = await room(30, { seed: 11 });
  const start = g.v.party().start;
  const waves = [];
  let seen = g.v.fxCount();
  const known = new Map();
  const spots = Array.from({ length: 30 }, (_, p) => g.v.partier(p).pos);
  while (g.v.party().t < 6000 && g.v.hole().state === L.H_PLAY) {
    // the balls held where they started, so the count stays put
    for (let p = 0; p < 30; p++) put(g, p, spots[p][0], spots[p][2]);
    g.step();
    const tp = g.v.party().t - 1; // the tick the hook played
    for (const w of fxs(g.v, MC.BO_FX_WAVE, seen)) waves.push({ tp: w.tick - start, n: w.size, no: w.shot, left: g.v.party().left });
    seen = g.v.fxCount();
    for (const b of bombsOf(g.v)) {
      if (known.has(b.k + ':' + b.land)) continue;
      known.set(b.k + ':' + b.land, b);
      assert.equal(b.land - b.fall, start + tp, 'its ring shows the tick it is laid');
      assert.equal(b.fall, ramp(tp, MC.BO_FALL0, MC.BO_FALL1));
      assert.ok(Math.hypot(b.x - C, b.z - C) <= rimAt(g.v.party().size, tp + b.fall) - 1 + 1e-3, 'inside the rim it lands on');
      assert.ok(!b.big || tp >= MC.BO_BIGFROM, 'no big ones before BO_BIGFROM');
    }
  }
  assert.ok(waves.length > 10);
  assert.equal(waves[0].tp, MC.BO_FIRST);
  for (let k = 0; k < waves.length; k++) {
    const w = waves[k];
    assert.equal(w.no, k + 1);
    assert.equal(w.n, 1 + Math.floor(30 / MC.BO_PER) + Math.floor(w.tp / MC.BO_MORE), `wave ${k + 1}: ${w.n} bombs`);
    if (k) assert.equal(w.tp - waves[k - 1].tp, ramp(waves[k - 1].tp, MC.BO_GAP0, MC.BO_GAP1), 'the gap');
  }
  assert.ok([...known.values()].some((b) => b.big), 'some big ones');
  assert.ok([...known.values()].filter((b) => b.who >= 0).length >= waves.length, 'the first of every wave aimed');
});

test('an aimed bomb lands where its ball would be BO_LEAD s on, give or take BO_SCATTER', async () => {
  const g = await room(1, { quiet: true });
  put(g, 0, C - 4, C, { vx: 5 });
  g.dv.setUint32(L.PG_H + MC.BO_NEXT, g.v.party().t, true);
  const x0 = g.v.partier(0).pos[0];
  g.step();
  const [b] = bombsOf(g.v);
  assert.equal(b.who, 0, 'aimed at P1');
  // where the ball was when the wave came (after its move this tick) plus 0.4 s of its roll
  const p = g.v.partier(0);
  assert.ok(Math.abs(b.x - (p.pos[0] + p.vel[0] * MC.BO_LEAD)) <= MC.BO_SCATTER + 1e-3, `${b.x} vs ${p.pos[0] + p.vel[0] * MC.BO_LEAD} (from ${x0})`);
  assert.ok(Math.abs(b.z - C) <= MC.BO_SCATTER + 1e-3);
});

test('a bomb blasts every ball near on the tick it lands, bumper\'s blast from the floor: away and up, harder near, none past its radius, none on a ball going out', async () => {
  const g = await room(5, { quiet: true });
  const T = g.v.tick + 10;
  lay(g, 0, C, C, T);
  lay(g, 1, C - 10, C + 8, T + 5, { big: true });
  put(g, 0, C + 1.5, C);
  put(g, 1, C, C - 3.5);
  put(g, 2, C - 6, C); // past 4.5 m
  put(g, 3, C - 9, C + 9); // the big one's
  put(g, 4, C, C + 2, { y: PLAT_Y - 2, ground: false });
  g.dv.setUint8(rec(4) + L.P_FL, L.PF_LIVE | L.PF_FALL);
  let seen = g.v.fxCount();
  while (g.v.tick < T) {
    g.step();
    for (let p = 0; p < 4; p++) assert.ok(g.v.partier(p).ground, `P${p + 1} untouched before`);
    for (let p = 0; p < 4; p++) put(g, p, ...[[C + 1.5, C], [C, C - 3.5], [C - 6, C], [C - 9, C + 9]][p]);
  }
  g.step(); // tick T: its blast in each ball's push, its FX at the tick's end
  const want0 = shove(C + 1.5, C, C, C, MC.BO_R, MC.BO_STR), want1 = shove(C, C - 3.5, C, C, MC.BO_R, MC.BO_STR);
  const b0 = g.v.partier(0), b1 = g.v.partier(1);
  assert.deepEqual(b0.vel, want0, 'P1 shoved');
  assert.deepEqual(b1.vel, want1, 'P2 less');
  assert.ok(want0[0] > 8 && want0[1] > 3, `${want0}`);
  assert.ok(Math.hypot(want1[0], want1[2]) < Math.hypot(want0[0], want0[2]) / 2);
  assert.ok(!b0.ground && !b1.ground, 'off the ground');
  assert.deepEqual(g.v.partier(2).vel, [0, 0, 0], 'P3 past its reach');
  assert.equal(g.v.partier(2).ground, true);
  assert.deepEqual([g.v.partier(4).vel[0], g.v.partier(4).vel[2]], [0, 0], 'P5, going out, is past it');
  const boom = fxs(g.v, MC.BO_FX_BOOM, seen);
  assert.equal(boom.length, 1);
  assert.deepEqual([boom[0].tick, boom[0].owner, boom[0].shot, boom[0].pos[0], boom[0].pos[1], boom[0].pos[2], boom[0].size], [T, 255, 1, C, PLAT_Y, C, MC.BO_R]);
  seen = g.v.fxCount();
  for (let k = 0; k < 5; k++) { put(g, 3, C - 9, C + 9); g.step(); }
  const want3 = shove(C - 9, C + 9, C - 10, C + 8, MC.BO_BIGR, MC.BO_BIGSTR);
  assert.deepEqual(g.v.partier(3).vel, want3, 'the big one: wider, harder');
  assert.ok(Math.hypot(want3[0], want3[2]) > 12, `${want3}`);
  assert.equal(fxs(g.v, MC.BO_FX_BOOM, seen)[0].size, MC.BO_BIGR);
  // the records last BO_KEEP past their blast (drawn going off), then go
  while (g.v.tick < T + MC.BO_KEEP) { g.step(); assert.equal(bombsOf(g.v).length, 2); }
  g.step();
  assert.deepEqual(bombsOf(g.v).map((b) => b.k), [1]);
  while (g.v.tick < T + 5 + MC.BO_KEEP + 1) g.step();
  assert.equal(bombsOf(g.v).length, 0);
});

test('a big bomb\'s crater: the tiles round where it lands are marked when its ring shows (keeping a crater open there), go on the tick it lands, and rise back BO_HOLE later', async () => {
  // one ball held still in the core: every wave's first bomb is aimed at it, so the big one comes down on it
  const g = await room(1, { seed: 5 });
  at(g, MC.BO_BIGFROM);
  const [q0, r0] = hexAt(C + 4, C + 2, S);
  const [x0, z0] = hexCentre(q0, r0, S);
  const ring = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]].map(([dq, dr]) => cellOf(q0 + dq, r0 + dr));
  let big = null, seen = g.v.fxCount();
  while (!big) {
    // round it, three tiles with a crater opened last tick, three with one long closed
    ring.forEach((a, k) => g.dv.setUint32(L.PG_BIG + MC.BO_TILES + a, k & 1 ? g.v.tick - 1 : g.v.tick - MC.BO_HOLE - 10, true));
    put(g, 0, x0, z0);
    g.step();
    const fx = fxs(g.v, MC.BO_FX_BIG, seen)[0];
    seen = g.v.fxCount();
    if (fx) { big = bombsOf(g.v).find((b) => b.k === (fx.shot & 0xff)); assert.deepEqual([fx.owner, fx.shot & 0x100], [0, 0x100], 'aimed at P1'); }
    assert.ok(g.v.party().t < MC.BO_BIGFROM + 8000, 'a big one came');
  }
  const t0 = g.v.tick - 1;
  assert.ok(big.big && big.who === 0);
  assert.equal(big.land, t0 + big.fall);
  assert.ok(Math.hypot(big.x - x0, big.z - z0) <= MC.BO_SCATTER * Math.SQRT2 + 1e-3, 'on the ball');
  let marked = 0;
  for (const T of tiles(g.v)) {
    const near = Math.hypot(T[2] - big.x, T[3] - big.z) <= MC.BO_CRATER + 1e-4;
    const k = ring.indexOf(T[4]);
    const want = (k >= 0 && (k & 1 || !near) ? (k & 1 ? t0 - 1 : t0 - MC.BO_HOLE - 10) : near ? big.land : 0) >>> 0;
    assert.equal(craterOf(g.v, T[4]), want, `${T[0]},${T[1]}${near ? ' (near)' : ''}${k >= 0 ? ` ring ${k}` : ''}`);
    marked += near;
  }
  assert.ok(marked >= 3, `${marked} tiles in reach`);
  // quiet now: the other bombs away; the ball held on its tile till the land tick, then the floor goes
  for (const b of bombsOf(g.v)) if (b.k !== big.k) g.dv.setUint8(L.PG_S + MC.BO_BOMBS + b.k * MC.BO_BSIZE + 14, 0);
  g.dv.setUint32(L.PG_H + MC.BO_NEXT, 1e6, true);
  const a0 = cellOf(q0, r0);
  assert.equal(craterOf(g.v, a0), big.land, 'its own tile in reach');
  while (g.v.tick < big.land) {
    put(g, 0, x0, z0);
    g.step();
    assert.ok(g.v.partier(0).ground, 'held');
  }
  g.step();
  assert.equal(holds(g.v, a0, g.v.tick, g.v.party().t), false);
  put(g, 0, x0, z0);
  g.step(); // off the ground on this tick, falling from the next
  g.step();
  const b = g.v.partier(0);
  assert.ok(!b.ground && b.pos[1] < PLAT_Y, 'through the floor where the crater is');
  // it rises back BO_HOLE after it opened
  while (g.v.tick < big.land + MC.BO_HOLE) {
    assert.equal(holds(g.v, a0, g.v.tick, g.v.party().t), false);
    put(g, 0, x0 + 3 * S, z0, { y: PLAT_Y + 20, ground: false }); // out of the way, in the air
    g.step();
  }
  assert.equal(holds(g.v, a0, g.v.tick, g.v.party().t), true, 'back');
  put(g, 0, x0, z0);
  g.step();
  assert.ok(g.v.partier(0).ground, 'and holds a ball again');
});

test('the last balls on all falling to one blast share the win, rather than all sharing last', async () => {
  const g = await room(3, { quiet: true });
  put(g, 0, C, C);
  // P2 and P3 alone out past the rim, falling: P1 goes out first, then the two left are both going out
  const r = g.v.party().size;
  put(g, 1, C + r + 3, C, { y: PLAT_Y - 0.5, ground: false });
  put(g, 2, C - r - 3, C, { y: PLAT_Y - 0.5, ground: false });
  g.dv.setUint8(rec(0) + L.P_FL, L.PF_LIVE | L.PF_DEAD);
  for (let k = 0; k < 100 && g.v.hole().state === L.H_PLAY; k++) {
    g.step();
    if (g.v.hole().state === L.H_PLAY) assert.ok(!g.v.partier(1).out && !g.v.partier(2).out);
  }
  const p = g.v.party();
  assert.equal(p.state, L.H_OVER, 'over at once');
  assert.equal(p.winner, 255, 'shared');
  assert.deepEqual([1, 2].map((k) => g.v.partier(k).place), [1, 1]);
});

test('balls that went off ticks apart don\'t share the win: the first is out in its place, the last on wins alone (or the two that went together share it)', async () => {
  for (const n of [2, 3]) {
    const g = await room(n, { quiet: true, seed: 12 });
    const r = g.v.party().size;
    // P1 off the disc, falling; 40 ticks on the rest go off, on one tick
    put(g, 0, C + r + 3, C, { y: PLAT_Y - 0.5, ground: false });
    for (let k = 0; k < 40; k++) g.step();
    assert.ok(g.v.partier(0).falling && !g.v.partier(0).out, 'going out');
    for (let p = 1; p < n; p++) put(g, p, C - r - 3, C + 3 * p, { y: PLAT_Y - 0.5, ground: false });
    let k = 0;
    while (g.v.party().state === L.H_PLAY && k++ < 400) g.step();
    const p = g.v.party();
    assert.equal(p.state, L.H_OVER);
    const ps = Array.from({ length: n }, (_, q) => q);
    assert.ok(g.v.partier(0).out, 'P1 out first');
    if (n === 2) {
      assert.deepEqual(ps.map((q) => g.v.partier(q).place), [2, 1]);
      assert.equal(p.winner, 1, 'the last on wins alone');
    } else {
      assert.deepEqual(ps.map((q) => g.v.partier(q).place), [3, 1, 1]);
      assert.equal(p.winner, 255, 'the two that went together share it');
    }
  }
});

test('the prediction matches the confirmed ball bit for bit: through blasts near and far, a crater opening under it, the crumbling rim, and the real waves', async () => {
  // one ball a room (a ball alone plays till it falls): nobody to bump it, which the prediction leaves to the confirmed world
  // A: rolling by two bombs going off, a big one ahead
  const g = await room(1, { quiet: true, seed: 23 });
  const T = g.v.tick + 25;
  lay(g, 0, C + 1, C + 1.5, T);
  lay(g, 1, C + 8, C - 2, T + 40, { big: true });
  put(g, 0, C - 3, C, { vx: 5 });
  const roll = Array.from({ length: 110 }, (_, k) => partyWord({ yaw: k < 50 ? 0 : 3000, move: 1, hop: k === 90 ? 1 : 0 }));
  assert.ok(predicted(g, roll) >= roll.length);
  assert.ok(!g.v.partier(0).ground || Math.abs(g.v.partier(0).vel[2]) > 0.5, 'shoved');
  // B: parked on a tile as a crater opens under it, keys down a little after
  const gb = await room(1, { quiet: true, seed: 26 });
  const [xb, zb] = hexCentre(2, -1, S);
  put(gb, 0, xb, zb);
  const [qb, rb] = hexAt(xb, zb, S);
  gb.dv.setUint32(L.PG_BIG + MC.BO_TILES + cellOf(qb, rb), gb.v.tick + 20, true);
  const sit = Array.from({ length: 70 }, (_, k) => partyWord({ yaw: 0, move: k > 15 ? 1 : 0 }));
  assert.ok(predicted(gb, sit) >= sit.length);
  assert.ok(gb.v.partier(0).pos[1] < PLAT_Y - 0.5 && !gb.v.partier(0).out, 'through');
  // C: on the rim as it crumbles, rolling round it
  const g2 = await room(1, { quiet: true, seed: 24 });
  const edge = tiles(g2.v).filter((t) => t[5] > MC.BO_RMIN + 3).sort((a, b) => a[4] - b[4])[5];
  at(g2, rimOf(g2.v, edge[4]) - 40);
  put(g2, 0, edge[2], edge[3]);
  const round = Array.from({ length: 110 }, (_, k) => partyWord({ yaw: (k * 120) & 16383, move: (k >> 3) & 1 }));
  assert.ok(predicted(g2, round) >= round.length);
  // D: the real waves (big ones among them), steering for the middle, a chunk at a time while the ball can't be going out
  const g3 = await room(1, { seed: 25 });
  at(g3, MC.BO_BIGFROM + 300);
  const seen = g3.v.fxCount();
  let chunks = 0;
  for (let k = 0; k < 40; k++) {
    const b = g3.v.partier(0);
    if (b.out || b.falling || b.pos[1] < PLAT_Y - 0.5 || g3.v.hole().state !== L.H_PLAY) break;
    const home = Math.atan2(C - b.pos[2], C - b.pos[0]) + Math.sin(k * 1.7) * 1.2;
    const words = Array.from({ length: 30 }, (_, i) => partyWord({ yaw: Math.round(home / (2 * Math.PI) * 16384 + i * 40) & 16383, move: i < 24 ? 1 : 0, hop: (k + i) % 47 === 0 ? 1 : 0 }));
    assert.ok(predicted(g3, words) >= 30);
    chunks++;
  }
  const booms = fxs(g3.v, MC.BO_FX_BOOM, seen);
  assert.ok(chunks >= 8 && booms.length > 5, `${chunks} chunks, ${booms.length} bombs went off`);
  assert.ok(booms.some((x) => Math.hypot(x.pos[0] - g3.v.partier(0).pos[0], x.pos[2] - g3.v.partier(0).pos[2]) < 30), 'near it');
});

// A round of AI balls (client/party-bot.mjs, this minigame's brain), as
// tools/genparty.mjs plays them: { log, sim, stats }.
async function aiRound({ bytes, seed, balls, ticks }) {
  const stats = { start: -1, over: -1, outs: [], places: null, pts: null, winner: -1, booms: 0 };
  let seen = 0;
  const { log, sim } = await playParty({ bytes, seed, mg: L.MG_BOMBS, bots: balls, ticks, delay: 6, onTick: (t, s, v) => {
    if (s.error().code) return;
    const g = v.party();
    for (; seen < v.fxCount(); seen++) {
      const x = v.fx(seen);
      if (x.kind === MC.BO_FX_BOOM) stats.booms++;
      if (x.kind === L.FX_SINK && stats.start >= 0 && stats.over < 0) stats.outs.push((x.tick - g.start) * TICK);
    }
    if (stats.start < 0 && g.state === L.H_PLAY) stats.start = t;
    if (stats.over < 0 && stats.start >= 0 && g.state === L.H_OVER) {
      stats.over = t;
      stats.winner = g.winner;
      stats.places = Array.from({ length: balls }, (_, p) => v.partier(p).place);
      stats.pts = Array.from({ length: balls }, (_, p) => v.partier(p).pts);
    }
  } });
  return { log, sim, stats };
}

for (const [balls, ticks] of [[8, 16500], [64, 16500]]) {
  test(`a round of ${balls} AI balls on the debug build: no trap, a while before most are out, a winner or the clock; equal on 1 and 4 threads`, async () => {
    const { log, sim, stats } = await aiRound({ bytes: partyBytes(true), seed: balls + 3, balls, ticks });
    assert.equal(sim.error().code, 0);
    assert.ok(stats.over > 0, 'the round ended');
    const secs = (stats.over - stats.start) * TICK;
    assert.ok(secs > 20 && secs <= MC.BO_LEN * TICK + 0.01, `${secs.toFixed(1)} s of play`);
    assert.ok(stats.booms > 50, `${stats.booms} bombs`);
    const early = stats.outs.filter((s) => s < 10).length;
    assert.ok(early < balls / 4, `${early} of ${balls} out in the first 10 s (${stats.outs.map((s) => s.toFixed(0))})`);
    assert.ok(stats.places.every((x) => x >= 1 && x <= balls), `places ${stats.places}`);
    assert.ok(stats.pts.every((x) => x >= 1 && x <= 10), `points ${stats.pts}`);
    assert.ok(stats.places.includes(1) && stats.pts.includes(10), 'somebody won');
    const v = new View(sim.memory.buffer);
    assert.equal(v.party().game, L.MG_BOMBS);
    const parsed = parseLog(log);
    const n = stats.over + 50;
    const a = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 1, tag: 't1' });
    const b = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 4, tag: 't4', startWorkers });
    const d = await replay({ bytes: partyBytes(true), log: parsed, ticks: n, threads: 1, tag: 'd1' });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(d.trace).tickHashes], 'the debug build steps the same bits');
  });
}

test('the client: a crater\'s tiles fly away from their own big bomb of a wave\'s several, on past its record; a big bomb is yours only if aimed at you, slot 255 too; the result frames the disc as it was left', async () => {
  const { Scene } = await import('../client/party-render.mjs');
  const g = await room(2, { quiet: true, seed: 43 });
  const land = g.v.tick + 40;
  const [x, z] = hexCentre(3, -1, S);
  // two big ones of a wave, landing together: the cell is the first's crater, the other far off
  lay(g, 0, x - 1.5, z, land, { big: true });
  lay(g, 1, x + 20, z, land, { big: true });
  g.dv.setUint32(L.PG_BIG + MC.BO_TILES + cellOf(3, -1), land, true);
  const out = { scene: new Scene(24000), solid: [], glow: [], beams: [], decals: [], casters: [], paint: null };
  const flying = (now) => {
    out.scene.clear(); out.solid.length = 0; out.glow.length = 0; out.decals.length = 0; out.casters.length = 0;
    bombs.draw(g.v, { tick: g.v.tick, dt: 0, ptick: now, now: 0, slot: 0 }, out);
    const d = out.scene.data, hits = [];
    for (let k = 0; k < out.scene.count; k++) if (d[k * 16 + 3] === 2 && d[k * 16 + 14] > 0 && d[k * 16 + 14] < 1) hits.push([d[k * 16] - x, d[k * 16 + 2] - z]);
    return hits;
  };
  let h = flying(land + 50);
  assert.equal(h.length, 1, 'one tile flying');
  assert.ok(h[0][0] > 1.5 && Math.abs(h[0][1]) < 1e-3, `away from its own bomb: ${h[0].map((v) => v.toFixed(2))}`);
  // both records freed BO_KEEP after they land, the tile still in the air: on out, not back over its cell
  for (const k of [0, 1]) g.dv.setUint8(L.PG_S + MC.BO_BOMBS + k * MC.BO_BSIZE + 14, 0);
  h = flying(land + 120);
  assert.equal(h.length, 1);
  assert.ok(h[0][0] > 4 && Math.abs(h[0][1]) < 1e-3, `${h[0][0].toFixed(2)} m on`);
  // the owner byte can't tell slot 255 from nobody: the shot says it's aimed
  const said = [];
  const ctx = (slot) => ({ slot, dist: 5, banner: (t) => said.push([slot, t]) });
  bombs.fx({ kind: MC.BO_FX_BIG, owner: 255, shot: 7, pos: [x, PLAT_Y, z] }, ctx(255));
  bombs.fx({ kind: MC.BO_FX_BIG, owner: 255, shot: 7 | 256, pos: [x, PLAT_Y, z] }, ctx(255));
  bombs.fx({ kind: MC.BO_FX_BIG, owner: 3, shot: 7 | 256, pos: [x, PLAT_Y, z] }, ctx(0));
  bombs.fx({ kind: MC.BO_FX_BIG, owner: 0, shot: 7 | 256, pos: [x, PLAT_Y, z] }, ctx(0));
  assert.deepEqual(said, [[255, 'BIG BOMB'], [255, 'BIG BOMB ON YOU  RUN'], [0, 'BIG BOMB'], [0, 'BIG BOMB ON YOU  RUN']]);
  // and the sim's waves say so: every big bomb's ring, aimed or not, as its record has it
  const g2 = await room(3, { seed: 44 });
  at(g2, MC.BO_MORE + 100); // two bombs a wave: the first aimed, the second not
  let seen = g2.v.fxCount(), bigs = 0, aimed = 0;
  for (let k = 0; k < 8000 && (aimed < 2 || bigs - aimed < 2); k++) {
    for (let p = 0; p < 3; p++) put(g2, p, C - 3 + 3 * p, C);
    g2.step();
    for (const fx of fxs(g2.v, MC.BO_FX_BIG, seen)) {
      const b = bombsOf(g2.v).find((e) => e.k === (fx.shot & 0xff));
      assert.ok(b && b.big);
      assert.deepEqual([fx.shot & 0x100, fx.owner], b.who >= 0 ? [0x100, b.who] : [0, 255]);
      bigs++;
      aimed += b.who >= 0;
    }
    seen = g2.v.fxCount();
  }
  assert.ok(aimed >= 2 && bigs - aimed >= 2, `${bigs} big ones, ${aimed} aimed`);
  // the result: the disc as the round left it, not as it began
  const g3 = await room(2, { quiet: true, seed: 45 });
  at(g3, 4000);
  put(g3, 1, C + 100, C, { y: PLAT_Y - 0.5, ground: false });
  for (let k = 0; k < 400 && g3.v.party().state === L.H_PLAY; k++) { put(g3, 0, C, C); g3.step(); }
  const p3 = g3.v.party();
  assert.equal(p3.state, L.H_OVER);
  const end = (p3.until - L.P_OVER - p3.start) | 0;
  assert.ok(end > 4000);
  assert.ok(Math.abs(bombs.frame(g3.v).radius - (rimAt(p3.size, end) + S)) < 1e-3, 'the rim it ended at');
  assert.ok(rimAt(p3.size, end) < p3.size - 2);
});

test('the client module: draws the countdown and the round, frames the disc, writes its HUD lines, and its brain sees what the sim does', async () => {
  const { Scene } = await import('../client/party-render.mjs');
  const g = await room(3, { play: false, seed: 41 });
  const out = { scene: new Scene(24000), solid: [], glow: [], beams: [], decals: [], casters: [], paint: null };
  const lines = [];
  const hctx = { put: (x, y, s, c) => lines.push([y, s, c]), centre: (y, s, c) => lines.push([y, s, c]), right: (y, s, c) => lines.push([y, s, c]), rows: 44, C: {}, slot: 0, now: 0 };
  const clear = () => { out.scene.clear(); out.decals.length = 0; out.glow.length = 0; out.solid.length = 0; out.casters.length = 0; lines.length = 0; };
  const finite = () => { for (let k = 0; k < out.scene.count * 16; k++) assert.ok(Number.isFinite(out.scene.data[k]), 'finite'); };
  const n = tiles(g.v).length;
  bombs.draw(g.v, { tick: g.v.tick, dt: 0, now: 0, slot: 0 }, out);
  assert.equal(out.scene.count, n + 2, 'every tile and the column');
  finite();
  while (g.v.hole().state !== L.H_PLAY) g.step();
  for (const tp of [300, 1500, 4000, 9000, 11000]) {
    at(g, tp);
    // kept in the core, so the round goes on
    for (let k = 0; k < 140; k++) { for (let p = 0; p < 3; p++) put(g, p, C - 3 + 3 * p, C); g.step(); }
    assert.equal(g.v.hole().state, L.H_PLAY);
    clear();
    const tick = g.v.tick;
    bombs.draw(g.v, { tick, dt: 0, ptick: tick + 3.5, now: 0, slot: 0 }, out);
    finite();
    assert.ok(out.scene.count > 2 && out.scene.count <= n + 2, `${out.scene.count} solids`);
    const live = bombsOf(g.v).filter((b) => b.land > tick + 3.5);
    assert.equal(out.solid.filter((s) => s.kind === 11).length, live.length, 'a bomb sprite each');
    assert.ok(out.decals.length >= 2 * live.length);
    for (const s of [...out.solid, ...out.glow]) assert.ok(s.pos.every(Number.isFinite) && Number.isFinite(s.size));
    bombs.hud(g.v, hctx);
    const text = lines.map((l) => l[1]).join(' | ');
    assert.ok(text.includes('WAVE'), text);
    for (const l of lines) assert.ok(l[1].length <= 80, l[1]);
    const fr = bombs.frame(g.v);
    assert.equal(fr.shape, 'disc');
    assert.ok(Math.abs(fr.radius - (rimAt(g.v.party().size, g.v.party().t) + S)) < 1e-3);
  }
  assert.ok(bombs.hint.length <= 70);
  // danger: 1 where no tile holds, high under a bomb about to land, 0 on a quiet middle
  const g2 = await room(2, { quiet: true, seed: 42 });
  const t = g2.v.tick;
  lay(g2, 0, C + 5, C, t + 30);
  g2.step();
  assert.equal(bombs.brain.danger(g2.v, C + 500, C, t + 10, 0), 1, 'off the disc');
  assert.ok(bombs.brain.danger(g2.v, C + 5.5, C, t + 30, 0) > 0.8, 'under a bomb');
  assert.equal(bombs.brain.danger(g2.v, C - 5, C - 3, t + 30, 0), 0, 'the quiet middle');
  const st = stage(g2.v);
  assert.equal(st.tiles.length, tiles(g2.v).length);
  const goal = bombs.brain.goal(g2.v, 0, { skill: 1, mem: {}, pos: [C + 5, C], vel: [0, 0], at: g2.v.tick });
  assert.ok(Math.hypot(goal[0] - C - 5, goal[1] - C) > MC.BO_R, `out of the blast: ${goal}`);
});
