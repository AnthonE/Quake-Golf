// SNOWBALL (src/mg/snowball.wat): the field for the crowd and its pines, the
// rim crumbling in, a snowball's size (fresh snow, packed tracks, standing
// still), its weight in the bumps and on the keys, the edge's tip, the pines,
// swallowing, the prediction bit for bit through all of it, rounds of AI
// balls, and the client module.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty, partyBytes, predicted } from './helpers.mjs';
import { View, partyWord, PLAT_Y } from '../src/party-view.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { playParty } from '../tools/genparty.mjs';
import snowball, { stage, rimAt, swallows, eatkAt, rimIn, tracks, cellAt, freshAt } from '../client/mg/snowball.mjs';
import * as L from '../src/layout.mjs';
import * as MC from '../src/mg/snowball.mjs'; // SB_*: the minigame's own constants

const C = L.B_CX;
const TICK = 0.008;
const f = Math.fround;
const DT = f(Number(L.PHYS.DT));
const N = (k) => f(Number(L.BPHYS[k]));
const GN = MC.SB_GN;

// A room of n balls in SNOWBALL, on the debug build (a NaN traps), stepped
// into play unless asked not to; with clean, no pines.
async function room(n = 3, { play = true, seed = 7, clean = false } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_SNOWBALL + 1, true);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); assert.equal(sim.error().code, 0, 'no trap'); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  while (play && v.hole().state !== L.H_PLAY) step();
  if (clean) dv.setUint32(L.PG_H + MC.SB_NP, 0, true);
  return { sim, v, dv, step };
}
const rec = (p) => L.PLAYERS + p * L.PSIZE;
const setR = (g, p, r) => g.dv.setFloat32(rec(p) + L.PG_M, r, true);
const rOf = (g, p) => g.v.partier(p).radius;
// Ball p at (x, z) on the snow (or y), rolling at (vx, vz), radius r if given.
function put(g, p, x, z, { y = PLAT_Y, vx = 0, vz = 0, ground = true, r } = {}) {
  g.dv.setFloat32(rec(p) + L.P_PX, x, true);
  g.dv.setFloat32(rec(p) + L.P_PY, y, true);
  g.dv.setFloat32(rec(p) + L.P_PZ, z, true);
  g.dv.setFloat32(rec(p) + L.P_VX, vx, true);
  g.dv.setFloat32(rec(p) + L.P_VY, 0, true);
  g.dv.setFloat32(rec(p) + L.P_VZ, vz, true);
  g.dv.setUint8(rec(p) + L.P_FL, L.PF_LIVE | (ground ? L.PF_GROUND : 0));
  if (r !== undefined) setR(g, p, r);
}
// The next step plays tick t into play (the clock moved, the round's end with it).
function at(g, t) {
  const now = g.v.tick;
  g.dv.setUint32(L.HDR_START, now - t, true);
  g.dv.setUint32(L.HDR_UNTIL, now - t + MC.SB_LEN, true);
}
const playT = (g) => g.v.party().t;
const fxs = (v, kind) => { const out = []; for (let k = 0; k < v.fxCount(); k++) { const x = v.fx(k); if (x.kind === kind) out.push(x); } return out; };
const pines = (g) => Array.from({ length: g.dv.getUint32(L.PG_H + MC.SB_NP, true) }, (_, k) => [g.dv.getFloat32(L.PG_S + MC.SB_PINE + 8 * k, true), g.dv.getFloat32(L.PG_S + MC.SB_PINE + 8 * k + 4, true)]);
// The snow grid: cell c's stamp, and every cell stamped as rolled `ago` ticks back (packed from SB_PACK).
const stampOf = (g, c) => g.dv.getUint32(L.PG_BIG + MC.SB_GRID + 4 * c, true);
const stampAt = (g, c, t) => g.dv.setUint32(L.PG_BIG + MC.SB_GRID + 4 * c, t, true);
function packAll(g, ago = MC.SB_PACK + 10) { const t = ago < 0 ? 0 : (g.v.tick - ago) >>> 0; for (let c = 0; c < GN * GN; c++) stampAt(g, c, t); }
// $sb_push's size step, in f32 as the sim works it, for a ball of radius r
// whose roll and push left it at (vx, vz): still, it melts; on the ground it
// grows on fresh snow and wears on packed (not once the rim is in).
function sized(r, vx, vz, ground, fresh, wear = true) {
  const sp = f(Math.sqrt(f(f(vx * vx) + f(vz * vz))));
  if (sp < MC.SB_STILL) return Math.max(f(r - f(MC.SB_MELT)), MC.SB_B0);
  if (!ground) return r;
  return Math.min(Math.max(f(f(f(sp * DT) * (fresh ? f(MC.SB_GROW) : wear ? f(-MC.SB_WEAR) : 0)) + r), MC.SB_B0), MC.SB_BMAX);
}
// The largest f32 under x > 0.
const below = (x) => { const a = new Float32Array([x]); new Uint32Array(a.buffer)[0]--; return a[0]; };
const eatenBy = (g, q) => g.dv.getUint16(L.PG_S + MC.SB_EATEN + 2 * q, true);

test('the field for 1, 8, 64 and 256: sized for the crowd, sized balls bumping, its pines clear of every spawn, a snowball of 1 m from play', async () => {
  let last = 0;
  for (const n of [1, 8, 64, 256]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party();
    const rad = f(Math.min(f(f(f(Math.sqrt(n)) * MC.SB_RK) + MC.SB_R0), MC.SB_RMAX));
    assert.equal(r.game, L.MG_SNOWBALL);
    assert.equal(r.size, rad, `${r.size} m for ${n}`);
    assert.ok(r.size > last || r.size === MC.SB_RMAX, 'grows with the crowd');
    last = r.size;
    assert.deepEqual([r.kind, r.len, r.floor, r.flags, r.idle], [L.PK_OUT, MC.SB_LEN, PLAT_Y, L.PGF_BUMPS | L.PGF_SIZE, f(MC.SB_IDLE)]);
    assert.equal(g.dv.getFloat32(L.PG_H + MC.SB_RAD, true), r.size);
    const ps = pines(g), want = Math.min(MC.SB_PMAX, MC.SB_PN + Math.floor(f(rad * rad) / MC.SB_PAREA));
    assert.ok(ps.length >= Math.min(want, 3) && ps.length <= want, `${n}: ${ps.length} pines of ${want}`);
    for (const [x, z] of ps) {
      const d = Math.hypot(x - C, z - C);
      assert.ok(d >= rad * MC.SB_PIN - 1e-3 && d <= rad * MC.SB_POUT + 1e-3, `a pine ${d.toFixed(1)} m out`);
    }
    for (let i = 0; i < ps.length; i++) for (let j = 0; j < i; j++) assert.ok(Math.hypot(ps[i][0] - ps[j][0], ps[i][1] - ps[j][1]) >= 8 - 1e-3, 'pines 8 m apart');
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p);
      assert.ok(b.ground && !b.out && b.pos[1] === PLAT_Y, `${n}: P${p + 1} on the snow`);
      assert.ok(Math.hypot(b.pos[0] - C, b.pos[2] - C) <= rad * MC.SB_SPAWN + 1e-3, `${n}: P${p + 1} on the spiral`);
      assert.equal(b.radius, MC.SB_B0, 'a snowball of SB_B0 before play (PG_M 0)');
      for (const [x, z] of ps) assert.ok(Math.hypot(b.pos[0] - x, b.pos[2] - z) >= MC.SB_PR + MC.SB_B0 + 0.5 - 1e-3, `${n}: P${p + 1} clear of the pines`);
      for (let q = 0; q < p; q++) {
        const o = g.v.partier(q);
        assert.ok(Math.hypot(b.pos[0] - o.pos[0], b.pos[2] - o.pos[2]) >= 2.2, `${n}: P${p + 1} and P${q + 1} apart`);
      }
    }
    while (g.v.hole().state !== L.H_PLAY) g.step();
    for (let p = 0; p < n; p++) assert.equal(g.dv.getFloat32(rec(p) + L.PG_M, true), MC.SB_B0, 'PG_M is the radius from play');
  }
});

test('every other minigame leaves the balls bumper\'s size: no PGF_SIZE, a radius of B_RAD', async () => {
  for (const m of L.MINIGAMES) {
    if (m.key === 'snowball') continue;
    const sim = await newParty();
    sim.init(3);
    const v = new View(sim.memory.buffer);
    v.dv.setUint32(L.PG_FORCE, L.MINIGAMES.indexOf(m) + 1, true);
    sim.feedPlayers([[L.EV_JOIN, 0], [L.EV_JOIN, 1]]);
    sim.x.step();
    assert.equal(v.party().flags & L.PGF_SIZE, 0, m.key);
    v.dv.setFloat32(L.PLAYERS + L.PG_M, 2.5, true);
    assert.equal(v.partier(0).radius, N('B_RAD'), `${m.key}: PG_M is the minigame's own`);
  }
});

test('the rim: the field\'s own till SB_CALM, then in to SB_RMIN over SB_SHRINK; snow under a ball inside it, none past it; the client\'s rim the same', async () => {
  const g = await room(2, { clean: true });
  const r0 = g.v.party().size;
  for (const tp of [0, MC.SB_CALM, MC.SB_CALM + MC.SB_SHRINK / 3, MC.SB_CALM + MC.SB_SHRINK / 2, MC.SB_CALM + MC.SB_SHRINK, MC.SB_LEN - 10]) {
    const rim = rimAt(r0, tp);
    for (const [off, holds] of [[-0.05, true], [0.05, false]]) {
      at(g, tp);
      put(g, 0, C + rim + off, C);
      put(g, 1, C - 3, C);
      g.step();
      assert.equal(g.v.partier(0).ground, holds, `${tp} ticks in: ${off > 0 ? 'past' : 'inside'} the rim at ${rim.toFixed(2)} m`);
    }
  }
  assert.equal(rimAt(r0, MC.SB_CALM + MC.SB_SHRINK / 2), (r0 + MC.SB_RMIN) / 2);
  // past it a ball goes out
  at(g, MC.SB_CALM + MC.SB_SHRINK);
  put(g, 0, C + MC.SB_RMIN + 1, C);
  for (let k = 0; k < 300 && !g.v.partier(0).out; k++) g.step();
  assert.ok(g.v.partier(0).out && !g.v.partier(1).out);
  assert.equal(g.v.party().state, L.H_OVER, 'one left of two: over');
  assert.equal(g.v.partier(1).place, 1);
});

test('a snowball grows SB_GROW a metre of fresh snow it covers, wears SB_WEAR a metre of packed, melts standing still; SB_B0 to SB_BMAX', async () => {
  const g = await room(3, { clean: true });
  put(g, 1, C - 12, C + 12);
  put(g, 2, C + 12, C + 12);
  const fwd = partyWord({ yaw: 0, move: 1 });
  // fresh: rolling flat out along x, growing, to the cap
  // (a lap of the lane, then back to its start on fresh snow)
  const lap = () => { const b = g.v.partier(0); if (b.pos[0] > C + 8) { put(g, 0, C - 14, C - 6, { vx: b.vel[0] }); packAll(g, -1); } };
  packAll(g, -1);
  put(g, 0, C - 14, C - 6, { vx: 6 });
  let grew = 0;
  for (let k = 0; k < 300; k++) {
    const r = rOf(g, 0);
    g.step(k ? [] : [[L.EV_INPUT, 0, fwd]]);
    const b = g.v.partier(0);
    assert.equal(b.radius, sized(r, b.vel[0], b.vel[2], b.ground, true), `tick ${k}`);
    if (b.radius > r) grew++;
    lap();
  }
  assert.ok(grew === 300 && rOf(g, 0) > 1.25, `grew to ${rOf(g, 0).toFixed(2)} m`);
  setR(g, 0, 2.99);
  for (let k = 0; k < 100; k++) { g.step(); lap(); }
  assert.equal(rOf(g, 0), MC.SB_BMAX, 'no more than SB_BMAX');
  // packed: wearing down, to SB_B0
  packAll(g);
  put(g, 0, C - 14, C - 6, { vx: 9, r: 2 });
  for (let k = 0; k < 200; k++) {
    const r = rOf(g, 0);
    g.step();
    const b = g.v.partier(0);
    assert.equal(b.radius, sized(r, b.vel[0], b.vel[2], b.ground, false), `packed, tick ${k}`);
    assert.ok(b.radius < r || b.radius === 1);
  }
  setR(g, 0, 1.01);
  for (let k = 0; k < 60; k++) g.step();
  assert.equal(rOf(g, 0), MC.SB_B0, 'no less than SB_B0');
  // rolled under SB_PACK ago: fresh still; rolled SB_REFILL ago: snowed over, fresh again
  for (const ago of [MC.SB_PACK - 40, MC.SB_REFILL]) {
    packAll(g, ago);
    put(g, 0, C - 14, C - 6, { vx: 9, r: 1.5 });
    g.step();
    const b = g.v.partier(0);
    assert.equal(b.radius, sized(1.5, b.vel[0], b.vel[2], true, true), `rolled ${ago} ticks ago`);
    assert.ok(b.radius > 1.5);
  }
  // still (under SB_STILL), no keys: melting, SB_MELT a tick
  g.step([[L.EV_INPUT, 0, partyWord({ yaw: 0, move: 0 })]]);
  put(g, 0, C - 4, C - 6, { r: 2.5 });
  for (let k = 0; k < 125; k++) {
    const r = rOf(g, 0);
    g.step();
    assert.equal(rOf(g, 0), sized(r, 0, 0, true, true));
  }
  assert.ok(Math.abs(rOf(g, 0) - (2.5 - 125 * MC.SB_MELT)) < 1e-3, `melted to ${rOf(g, 0).toFixed(3)} m`);
  // in the air: no growing, no wearing
  put(g, 0, C - 4, C - 6, { y: PLAT_Y + 3, vx: 5, ground: false, r: 2 });
  g.step();
  assert.equal(rOf(g, 0), 2);
});

test('the snow: a ball on the ground rolls the cells within SB_FOOT of its radius, and the one under it, with the tick; once till SB_REFILL; in the air none', async () => {
  const g = await room(3, { clean: true });
  put(g, 1, C - 12, C + 12);
  put(g, 2, C + 12, C + 12);
  const x0 = f(C - GN / 2);
  for (const r of [1, 2.6]) {
    put(g, 0, C - 4.3, C + 2.7, { vx: 0, r });
    g.step();
    const t = g.v.tick - 1, b = g.v.partier(0), reach = f(b.radius * MC.SB_FOOT);
    let n = 0;
    for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
      const c = j * GN + i, dx = x0 + i + 0.5 - b.pos[0], dz = x0 + j + 0.5 - b.pos[2];
      const under = c === cellAt(C, b.pos[0], b.pos[2]);
      const want = under || dx * dx + dz * dz < reach * reach - 1e-4 ? t : dx * dx + dz * dz > reach * reach + 1e-4 ? 0 : stampOf(g, c);
      if (Math.abs(dx) > 4 || Math.abs(dz) > 4) continue;
      if (stampOf(g, c) === t) n++;
      assert.equal(stampOf(g, c), want, `r ${r}: cell ${i - GN / 2}, ${j - GN / 2}`);
    }
    assert.ok(n >= (r > 2 ? 9 : 1) && n <= Math.ceil(Math.PI * (reach + 0.75) ** 2), `${n} cells`);
    // the next tick it doesn't roll them again
    g.step();
    assert.equal(stampOf(g, cellAt(C, b.pos[0], b.pos[2])), t, 'rolled once');
    for (let c = 0; c < GN * GN; c++) stampAt(g, c, 0);
  }
  // packed or not, a cell rolled SB_REFILL ago is rolled again
  const c0 = cellAt(C, C - 4.3, C + 2.7);
  stampAt(g, c0, (g.v.tick - MC.SB_REFILL + 1) >>> 0);
  put(g, 0, C - 4.3, C + 2.7, { r: 1 });
  g.step();
  assert.equal(stampOf(g, c0), (g.v.tick - 1 - MC.SB_REFILL + 1) >>> 0, 'not yet');
  g.step();
  assert.equal(stampOf(g, c0), g.v.tick - 1, 'snowed over and rolled again');
  // in the air, nothing
  for (let c = 0; c < GN * GN; c++) stampAt(g, c, 0);
  put(g, 0, C - 4.3, C + 2.7, { y: PLAT_Y + 3, ground: false, vx: 3 });
  g.step();
  for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) assert.equal(stampOf(g, cellAt(C, C - 4.3 + dx, C + 2.7 + dz)), 0);
  // the client's cell and freshness are the sim's
  stampAt(g, c0, (g.v.tick - MC.SB_PACK - 1) >>> 0);
  assert.equal(freshAt(g.v, c0, g.v.tick), false);
  assert.equal(freshAt(g.v, c0, g.v.tick - 2), true);
  assert.equal(freshAt(g.v, c0, g.v.tick - MC.SB_PACK - 1 + MC.SB_REFILL), true);
  assert.equal(cellAt(C, C - 200, C), -1);
});

test('bigger is heavier: r cubed in a bump, and on the keys slower to get going and quicker flat out', async () => {
  const g = await room(3, { clean: true });
  // two in the air closing, 1.6 m and 2 m (not small enough to swallow): momentum kept, the light one turned more
  put(g, 0, C - 1.79, C - 8, { y: PLAT_Y + 5, vx: 5, ground: false, r: 1.6 });
  put(g, 1, C + 1.79, C - 8, { y: PLAT_Y + 5, vx: -5, ground: false, r: 2 });
  put(g, 2, C - 10, C + 10);
  const v0 = f(5 * N('B_AIR_DRAG'));
  g.step();
  const a = g.v.partier(0), b = g.v.partier(1);
  assert.ok(!a.out && !b.out, 'no swallow at 0.8');
  const da = a.vel[0] - v0, db = b.vel[0] + v0, ma = 1.6 ** 3, mb = 8;
  assert.ok(Math.abs(ma * da + mb * db) < 1e-3, 'momentum kept');
  assert.ok(Math.abs(Math.abs(da) / Math.abs(db) - mb / ma) < 1e-3, `${(Math.abs(da) / Math.abs(db)).toFixed(4)} against ${(mb / ma).toFixed(4)}`);
  assert.ok(da < -5, 'the light one sent back');
  // keys from still, 1 m and 3 m side by side on packed snow (sizes held)
  packAll(g);
  put(g, 0, C - 12, C - 4, { r: 1 });
  put(g, 1, C - 12, C + 4, { r: 3 });
  const fwd = partyWord({ yaw: 0, move: 1 });
  const D = N('B_DRAG'), A = N('B_ACC_DT');
  let v1 = 0, v3 = 0;
  const k = 3, fa = 1 - 1 / k, fd = 1 - 1 / (k * (1 + MC.SB_FAST * (k - 1)));
  for (let t = 0; t < 2500; t++) {
    setR(g, 0, 1); setR(g, 1, 3);
    if (g.v.partier(0).pos[0] > C + 8 || g.v.partier(1).pos[0] > C + 8) { put(g, 0, C - 12, C - 4, { vx: g.v.partier(0).vel[0], r: 1 }); put(g, 1, C - 12, C + 4, { vx: g.v.partier(1).vel[0], r: 3 }); }
    g.step(t ? [] : [[L.EV_INPUT, 0, fwd], [L.EV_INPUT, 1, fwd]]);
    v1 = v1 * D + A;
    const u = v3 * D + A;
    v3 = u + fd * (1 - D) * u - fa * A;
    if (t === 100) {
      const s1 = g.v.partier(0).vel[0], s3 = g.v.partier(1).vel[0];
      assert.ok(Math.abs(s1 - v1) < 1e-3 && Math.abs(s3 - v3) < 1e-3, `0.8 s in: ${s1.toFixed(3)} and ${s3.toFixed(3)} m/s`);
      assert.ok(s3 < 0.5 * s1, 'the big one slower to get going');
    }
  }
  const s1 = g.v.partier(0).vel[0], s3 = g.v.partier(1).vel[0];
  assert.ok(Math.abs(s1 - A / (1 - D)) < 0.05, `flat out ${s1.toFixed(2)} m/s`);
  assert.ok(Math.abs(s3 / s1 - (1 + MC.SB_FAST * (k - 1))) < 0.03, `3 m flat out ${s3.toFixed(2)} m/s`);
});

test('the edge: a ball on the snow whose skin hangs over the rim tips out, SB_TIP a tick at most, by its overhang over its radius', async () => {
  const g = await room(3, { clean: true });
  packAll(g);
  const R = g.v.party().size;
  put(g, 1, C - 4, C);
  put(g, 2, C - 4, C + 6);
  for (const [r, over] of [[1, 0.5], [3, 1.5], [3, 2.9], [2, -0.1]]) {
    at(g, 200);
    put(g, 0, C + R - r + over, C, { r });
    g.step();
    const b = g.v.partier(0);
    const want = over > 0 ? f(MC.SB_TIP * Math.min(over / r, 1)) : 0;
    assert.ok(Math.abs(b.vel[0] - want) < 1e-6 && b.vel[2] === 0, `r ${r}, over ${over}: ${b.vel[0]} m/s out`);
  }
});

test('pines: a ball is never in one; into one it bounces back at SB_PE of its speed and a kick; once the rim has passed one it\'s gone', async () => {
  const g = await room(3);
  packAll(g);
  at(g, 300);
  const ps = pines(g);
  const [x, z] = ps.reduce((a, b) => (Math.hypot(a[0] - C, a[1] - C) < Math.hypot(b[0] - C, b[1] - C) ? a : b));
  const reach = MC.SB_PR + 1;
  const clear = (px, pz) => ps.every(([ox, oz]) => Math.hypot(px - ox, pz - oz) > reach + 0.5 || (ox === x && oz === z));
  assert.ok(clear(x - 3.2, z) && clear(x - 2.5, z), 'a clear run at it');
  put(g, 0, x - 3.2, z, { vx: 9, r: 1 });
  // the others still, across the middle from it
  const sz = z < C ? 1 : -1;
  put(g, 1, C - 4, C + sz * 9, { r: 1 });
  put(g, 2, C + 4, C + sz * 9, { r: 1 });
  let hit = -1, vin = 0, out = 0;
  for (let k = 0; k < 60; k++) {
    const v0 = g.v.partier(0).vel[0];
    g.step();
    const b = g.v.partier(0);
    assert.ok(Math.hypot(b.pos[0] - x, b.pos[2] - z) >= reach - 1e-3, 'never in it');
    if (hit < 0 && b.vel[0] < 0) { hit = k; vin = f(v0 * f(MC.SB_IDLE)); out = -b.vel[0]; }
  }
  assert.ok(hit > 0 && vin > 5, `into it at ${vin} m/s`);
  assert.ok(Math.abs(out - (MC.SB_PE * vin + MC.SB_PKICK)) < 0.01, `in at ${vin.toFixed(2)}, out at ${out.toFixed(2)} m/s`);
  assert.equal(g.v.partier(0).vel[2], 0, 'straight back');
  // the one furthest out, the rim just inside it: a ball by it rolls through where it stood
  const [fx, fz] = ps.reduce((a, b) => (Math.hypot(a[0] - C, a[1] - C) > Math.hypot(b[0] - C, b[1] - C) ? a : b));
  const rho = Math.hypot(fx - C, fz - C), ux = (fx - C) / rho, uz = (fz - C) / rho;
  assert.ok(rho > MC.SB_RMIN + 2);
  const r0 = g.v.party().size;
  at(g, Math.ceil(MC.SB_CALM + (r0 - (rho - 0.3)) / (r0 - MC.SB_RMIN) * MC.SB_SHRINK));
  put(g, 0, fx - ux * 1.6, fz - uz * 1.6, { vx: ux * 2, vz: uz * 2, r: 1 });
  g.step();
  const b = g.v.partier(0);
  assert.ok(Math.hypot(b.pos[0] - fx, b.pos[2] - fz) < 1.6, 'through it');
  assert.ok(b.vel[0] * ux + b.vel[2] * uz > 1.9, 'not bounced');
});

test('swallowing: touching, one under 3/4 of the other: out, the big one grows by SB_EAT of its square, a swallow and a KO to its name; not at 3/4, not a skin apart, not over its head', async () => {
  // two in the air side by side, alike in speed (no bump, no growing): sizes as set
  const pair = async (ra, rb, gap, { above = false } = {}) => {
    const g = await room(3, { clean: true });
    put(g, 2, C - 10, C + 10);
    const y = PLAT_Y + 4;
    put(g, 0, C, C, { y, vx: 2, ground: false, r: ra });
    if (above) put(g, 1, C, C, { y: y + 2 * ra + gap, vx: 2, ground: false, r: rb });
    else {
      const dy = rb - ra, d = Math.sqrt(Math.max(0, (ra + rb + gap) ** 2 - dy * dy));
      put(g, 1, C + d, C, { y, vx: 2, ground: false, r: rb });
    }
    g.step();
    return g;
  };
  let g = await pair(2, 1.4, 0.1);
  const big = g.v.partier(0), small = g.v.partier(1);
  assert.ok(small.out && !big.out, 'P2 swallowed');
  assert.equal(big.radius, f(Math.sqrt(f(f(1.4 * f(1.4 * MC.SB_EAT)) + 4))));
  assert.deepEqual([big.score, big.kos, small.place], [1, 1, 3]);
  assert.equal(eatenBy(g, 1), 1, 'swallowed by P1');
  const e = fxs(g.v, MC.SB_FX_EAT).at(-1);
  assert.deepEqual([e.owner, e.shot, e.size], [0, 1, big.radius]);
  assert.ok(Math.abs(e.pos[1] - (small.pos[1] + 1.4)) < 1e-3, 'where it was, its centre');
  assert.equal(fxs(g.v, L.FX_SINK).at(-1).shot, 0, 'the KO to P1');
  assert.equal(snowball.sink(fxs(g.v, L.FX_SINK).at(-1), (p) => `P${p + 1}`, g.v), 'P1 SWALLOWED P2');
  assert.equal(snowball.sink({ owner: 2 }, (p) => `P${p + 1}`, g.v), null, 'a fall is the frontend\'s');
  // the other way round: the small one in the lower slot
  g = await pair(1.2, 1.7, 0.1);
  assert.equal(eatenBy(g, 0), 2, 'swallowed by P2');
  assert.ok(g.v.partier(0).out && !g.v.partier(1).out);
  // at 3/4 exactly, no; a skin and a half apart, no; over its head with a gap, no; in touch over it, yes
  for (const [ra, rb, gap, above, eaten] of [[2, 1.5, 0.1, false, false], [2, 1.4, 0.2, false, false], [2, 1.4, 0.3, true, false], [2, 1.4, 0.1, true, true]]) {
    g = await pair(ra, rb, gap, { above });
    assert.equal(g.v.partier(1).out, eaten, `${ra} and ${rb}, ${gap} apart${above ? ' over it' : ''}`);
  }
  // capped at SB_BMAX
  g = await pair(2.9, 2.1, 0.1);
  assert.equal(g.v.partier(0).radius, MC.SB_BMAX);
  assert.ok(swallows(2.9, 2.1) && !swallows(2, 1.5) && swallows(2, 1.49));
});

test('the endgame: once the rim is in its tracks don\'t wear and the line rises from SB_EATK to SB_EATK1 at the clock (the client\'s the same); at the clock all but the biggest melt, the most swallows breaking a tie', async () => {
  const END = MC.SB_CALM + MC.SB_SHRINK;
  // the line, in f32 as $sb_eatk works it
  assert.deepEqual([eatkAt(0), eatkAt(END), eatkAt(END + 1375), eatkAt(MC.SB_LEN)], [MC.SB_EATK, MC.SB_EATK, MC.SB_EATK + (MC.SB_EATK1 - MC.SB_EATK) / 2, MC.SB_EATK1]);
  assert.ok(!rimIn(END - 1) && rimIn(END));
  // a pair touching in the air, the bigger 2 m, the smaller just under the line and on it
  for (const tp of [END - 500, END, END + 1, END + 1000, END + 2000, MC.SB_LEN - 1]) {
    const k = eatkAt(tp), line = f(f(2) * f(k));
    for (const [rb, eaten] of [[below(line), true], [line, false]]) {
      const g = await room(3, { clean: true });
      at(g, tp);
      const y = PLAT_Y + 4, d = Math.sqrt((2 + rb + 0.1) ** 2 - (rb - 2) ** 2);
      put(g, 2, C, C + 5);
      put(g, 0, C - d / 2, C, { y, vx: 2, ground: false, r: 2 });
      put(g, 1, C + d / 2, C, { y, vx: 2, ground: false, r: rb });
      g.step();
      assert.equal(g.v.partier(1).out, eaten, `${tp} into play, the line ${k}: ${rb} of 2 ${eaten ? '' : 'not '}swallowed`);
    }
  }
  // packed tracks: wearing till the rim is in, then not
  const g = await room(3, { clean: true });
  put(g, 1, C + 3, C + 4);
  put(g, 2, C - 3, C + 4);
  at(g, END - 6);
  packAll(g);
  put(g, 0, C - 5, C - 2, { vx: 9, r: 2 });
  for (let k = 0; k < 16; k++) {
    const r = rOf(g, 0), worn = playT(g) < END;
    g.step();
    const b = g.v.partier(0);
    assert.equal(b.radius, sized(r, b.vel[0], b.vel[2], b.ground, false, worn), `tick ${playT(g)}`);
    assert.ok(worn ? b.radius < r : b.radius === r, `${playT(g)} into play: ${r} to ${b.radius}`);
  }
  // the clock: four on the snow apart, P3 the biggest (as big as P2, but a swallow more)
  const clock = async (sizes, scores) => {
    const h = await room(4, { clean: true });
    at(h, MC.SB_LEN);
    sizes.forEach((r, p) => {
      put(h, p, C + Math.cos(p * Math.PI / 2) * 3.5, C + Math.sin(p * Math.PI / 2) * 3.5, { vx: 0.5 * Math.cos(p * Math.PI / 2), vz: 0.5 * Math.sin(p * Math.PI / 2), r });
      h.dv.setUint16(rec(p) + L.PG_SCORE, scores[p], true);
    });
    h.step();
    return h;
  };
  let h = await clock([1.5, 2, 2, 1.2], [0, 0, 1, 0]);
  assert.deepEqual([0, 1, 2, 3].map((p) => h.v.partier(p).out), [true, true, false, true]);
  assert.deepEqual([h.v.party().state, h.v.party().winner], [L.H_OVER, 2]);
  assert.deepEqual([0, 1, 2, 3].map((p) => h.v.partier(p).place), [4, 4, 1, 4], 'the melted share a place');
  assert.deepEqual([0, 1, 3].map((p) => eatenBy(h, p)), [MC.SB_MELTED, MC.SB_MELTED, MC.SB_MELTED]);
  assert.equal(snowball.sink({ owner: 1 }, (p) => `P${p + 1}`, h.v), 'P2 MELTED AT THE CLOCK');
  // as big and as many swallows: both stay, a shared 1st
  h = await clock([1.5, 2, 2, 1.2], [0, 1, 1, 0]);
  assert.deepEqual([0, 1, 2, 3].map((p) => h.v.partier(p).out), [true, false, false, true]);
  assert.deepEqual([h.v.party().state, h.v.party().winner, h.v.partier(1).place, h.v.partier(2).place], [L.H_OVER, 255, 1, 1]);
  // a tick before the clock: nobody melts
  h = await room(4, { clean: true });
  at(h, MC.SB_LEN - 1);
  [1.5, 2, 2.5, 1.2].forEach((r, p) => put(h, p, C + Math.cos(p * Math.PI / 2) * 3.5, C + Math.sin(p * Math.PI / 2) * 3.5, { vx: 1.5, r }));
  h.step();
  assert.ok([0, 1, 2, 3].every((p) => !h.v.partier(p).out) && h.v.party().state === L.H_PLAY);
});

test('in slot order: a ball swallowed this tick swallows no more, one that grew is weighed at its size; the last one in wins', async () => {
  const g = await room(4, { clean: true });
  put(g, 3, C - 12, C + 12);
  const y = PLAT_Y + 4;
  // P1 (1.45) touches P2 (2) and P3 (1): P2 swallows P1 first, so P3 lives (P1 would have had it)
  put(g, 0, C, C, { y, vx: 2, ground: false, r: 1.45 });
  const side = (ra, rb) => Math.sqrt((ra + rb + 0.1) ** 2 - (rb - ra) ** 2);
  put(g, 1, C + side(1.45, 2), C, { y, vx: 2, ground: false, r: 2 });
  put(g, 2, C - side(1.45, 1), C, { y, vx: 2, ground: false, r: 1 });
  g.step();
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).out), [true, false, false]);
  assert.equal(g.v.partier(1).score, 1);
  // two left of a room of two: the swallow ends it
  const h = await room(2, { clean: true });
  put(h, 0, C, C, { y, vx: 2, ground: false, r: 2.5 });
  put(h, 1, C + side(2.5, 1.5), C, { y, vx: 2, ground: false, r: 1.5 });
  h.step();
  const r = h.v.party();
  assert.equal(r.state, L.H_OVER);
  assert.equal(r.winner, 0);
  assert.deepEqual([h.v.partier(0).place, h.v.partier(1).place, h.v.partier(0).pts], [1, 2, 10]);
});

test('the prediction matches the confirmed ball bit for bit: growing on fresh snow, wearing on packed, into a pine, heavy on the keys, tipping at the rim as it crumbles, standing still, hopping, on the final ring\'s tracks', async () => {
  const g = await room(3, { seed: 31 });
  const R = g.v.party().size;
  const ps = pines(g);
  const yawTo = (x, z) => { const b = g.v.partier(0); return Math.round(Math.atan2(z - b.pos[2], x - b.pos[0]) / (2 * Math.PI) * 16384) & 16383; };
  // round the middle at rad m, a quarter turn ahead of where it is
  const circle = (rad) => () => { const b = g.v.partier(0), a = Math.atan2(b.pos[2] - C, b.pos[0] - C) + 0.6; return partyWord({ yaw: yawTo(C + Math.cos(a) * rad, C + Math.sin(a) * rad), move: 1 }); };
  let pill = Infinity, skin = 0;
  const run = (word, n) => {
    for (let k = 0; k < n; k += 10) {
      assert.ok(predicted(g, Array(10).fill(typeof word === 'function' ? word(k) : word)) >= 10);
      const b = g.v.partier(0);
      for (const [x, z] of ps) pill = Math.min(pill, Math.hypot(b.pos[0] - x, b.pos[2] - z));
      skin = Math.max(skin, Math.hypot(b.pos[0] - C, b.pos[2] - C) + b.radius);
    }
  };
  // the others still, out of its way
  const aside = (deg, d1 = 5, d2 = 9) => { const a = deg * Math.PI / 180; put(g, 1, C + Math.cos(a) * d1, C + Math.sin(a) * d1); put(g, 2, C + Math.cos(a) * d2, C + Math.sin(a) * d2); };
  // A: fresh snow, at the pine nearest the middle from 7 m in, and off it
  const [px, pz] = ps.reduce((a, b) => (Math.hypot(a[0] - C, a[1] - C) < Math.hypot(b[0] - C, b[1] - C) ? a : b));
  const pr = Math.hypot(px - C, pz - C);
  put(g, 0, px + (C - px) / pr * 7, pz + (C - pz) / pr * 7);
  aside(Math.atan2(C - pz, C - px) * 180 / Math.PI + 90);
  const r0 = rOf(g, 0);
  run(partyWord({ yaw: yawTo(px, pz), move: 1 }), 200);
  assert.ok(pill < MC.SB_PR + rOf(g, 0) + 0.3, `against the pine (${pill.toFixed(2)} m)`);
  assert.ok(rOf(g, 0) > r0, 'it grew');
  // B: round the middle through a ring of packed snow and one rolled a moment ago, packing as it goes
  aside(0, -2.5, 2.5);
  put(g, 0, C, C - 10);
  for (let c = 0; c < GN * GN; c++) {
    const x = C - GN / 2 + (c % GN) + 0.5, z = C - GN / 2 + Math.floor(c / GN) + 0.5;
    if (Math.hypot(x - C, z - C) > 7) stampAt(g, c, x < C ? g.v.tick - MC.SB_PACK - 30 : g.v.tick - MC.SB_PACK + 60);
  }
  const before = rOf(g, 0);
  run(circle(10), 300);
  assert.ok(rOf(g, 0) !== before, 'worn and grown');
  // C: big and heavy on the keys, round the middle
  setR(g, 0, 2.6);
  run(circle(9), 200);
  // D: the rim crumbling: from just inside it, out till its skin hangs over (tipping), then back in and round inside it
  setR(g, 0, 1.3);
  at(g, MC.SB_CALM + 2000);
  const rim = rimAt(R, MC.SB_CALM + 2000);
  const o = g.v.partier(0).pos, oa = Math.atan2(o[2] - C, o[0] - C);
  aside(oa * 180 / Math.PI + 180);
  put(g, 0, C + Math.cos(oa) * (rim - 1.7), C + Math.sin(oa) * (rim - 1.7));
  const away = yawTo(C + Math.cos(oa) * 100, C + Math.sin(oa) * 100), home = (away + 8192) & 16383;
  run((k) => (k < 40 ? partyWord({ yaw: away, move: 1 }) : k < 150 ? partyWord({ yaw: home, move: 1 }) : circle(rim - 4)()), 300);
  assert.ok(skin > rim, `its skin over the rim (${skin.toFixed(2)} m of ${rim.toFixed(2)})`);
  assert.ok(!g.v.partier(0).out && !g.v.partier(0).falling, 'and back in');
  // E: still, melting; then a hop
  run(partyWord({ yaw: 0, move: 0 }), 200);
  run((k) => partyWord({ yaw: 8192, move: 1, hop: k === 20 ? 1 : 0 }), 100);
  assert.ok(!g.v.partier(0).out);
  // F: the rim in, on packed snow round the final ring: no wear
  at(g, MC.SB_CALM + MC.SB_SHRINK - 40);
  aside(0, -1.5, 1.5);
  packAll(g);
  put(g, 0, C, C - 4.5, { r: 1.6 });
  const worn = rOf(g, 0);
  run(circle(4.5), 200);
  assert.ok(!g.v.partier(0).out, 'still in the final ring');
  assert.ok(rOf(g, 0) >= worn - 40 * 0.1 * MC.SB_WEAR, 'worn only till the rim is in');
});

test('the prediction across the countdown\'s end: its own ball a snowball of SB_B0 from play\'s first tick', async () => {
  const g = await room(2, { play: false, seed: 5 });
  while (g.v.hole().until - g.v.tick > 10) g.step();
  assert.ok(predicted(g, Array(40).fill(partyWord({ yaw: 0, move: 1 }))) >= 40);
  assert.equal(g.v.hole().state, L.H_PLAY);
  assert.ok(rOf(g, 0) > MC.SB_B0, 'growing');
});

// A round of Partier balls on the debug build: no trap, a round played to
// its end, equal on every tick on 1 and 4 threads.
// Seed 7's 8 go to the clock, and melt.
for (const [balls, ticks, seed, eats] of [[8, 12500, 2, 1], [8, 12500, 7, 1], [64, 12500, 1, 12]]) {
  test(`a round of ${balls} AI balls (seed ${seed}) on the debug build: no trap, they grow, swallow and fall, half last 25 s, the round ends with one winner; equal on 1 and 4 threads`, async () => {
    const bytes = partyBytes(true);
    const stats = { start: -1, over: -1, eats: 0, outs: [], big: 0, places: null };
    let seen = 0;
    const r = await playParty({ bytes, seed, mg: L.MG_SNOWBALL, bots: balls, ticks, onTick: (t, sim, v) => {
      const g = v.party();
      if (stats.start < 0 && g.state === L.H_PLAY) stats.start = t;
      for (; seen < v.fxCount(); seen++) {
        const x = v.fx(seen);
        if (stats.over >= 0) continue;
        if (x.kind === MC.SB_FX_EAT) stats.eats++;
        if (x.kind === L.FX_SINK) stats.outs.push((t - stats.start) * TICK);
      }
      if (g.state === L.H_PLAY) for (let p = 0; p < balls; p++) stats.big = Math.max(stats.big, v.partier(p).radius);
      if (stats.over < 0 && stats.start >= 0 && g.state === L.H_OVER) { stats.over = t; stats.winner = g.winner; stats.places = [...Array(balls).keys()].map((p) => v.partier(p).place); }
    } });
    assert.equal(r.sim.error().code, 0);
    assert.ok(stats.over > 0, 'the round ended');
    const secs = (stats.over - stats.start) * TICK;
    assert.ok(secs > 30 && secs <= MC.SB_LEN * TICK, `${secs.toFixed(1)} s of play`);
    assert.ok(stats.eats >= eats, `${stats.eats} swallowed`);
    assert.ok(stats.big > 1.5, `the biggest ${stats.big.toFixed(2)} m`);
    assert.ok(stats.outs.filter((s) => s < 25).length <= balls / 2, `outs at ${stats.outs.map((s) => s.toFixed(0))}`);
    assert.ok(stats.places.every((x) => x >= 1 && x <= balls) && stats.places.filter((x) => x === 1).length === 1, `places ${stats.places}`);
    assert.ok(stats.winner < balls, `one winner, P${stats.winner + 1}`);
    const parsed = parseLog(r.log);
    const n = stats.over + 50;
    const a = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 1, tag: 't1' });
    const b = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 4, tag: 't4', startWorkers });
    const d = await replay({ bytes, log: parsed, ticks: n, threads: 1, tag: 'd1' });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(d.trace).tickHashes], 'the debug build steps the same bits');
  });
}

test('the client module: draws the countdown, play and the result and its balls, frames the field, lays the tracks, its HUD lines fit, its brain flees, hunts and seeks fresh snow', async () => {
  const { Scene } = await import('../client/party-render.mjs');
  const g = await room(4, { play: false, seed: 41 });
  const out = { scene: new Scene(24000), solid: [], glow: [], beams: [], decals: [], casters: [], paint: null };
  const lines = [];
  const hctx = { put: (x, y, s, c) => lines.push([y, s, c]), centre: (y, s, c) => lines.push([y, s, c]), right: (y, s, c) => lines.push([y, s, c]), rows: 44, C: {}, now: 0 };
  const draw = () => {
    out.scene.clear(); out.decals.length = 0; out.glow.length = 0; lines.length = 0;
    snowball.draw(g.v, { tick: g.v.tick, t: g.v.party().t * TICK, pt: g.v.party().t * TICK, dt: 0.004, now: 1000, ms: 16, cam: [C, PLAT_Y + 30, C - 40], slot: 0, me: g.v.partier(0) }, out);
    for (let k = 0; k < out.scene.count * 16; k++) assert.ok(Number.isFinite(out.scene.data[k]), 'finite');
    for (let s = 0; s < 4; s++) { lines.length = 0; snowball.hud(g.v, { ...hctx, slot: s, me: g.v.partier(s) }); for (const l of lines) assert.ok(l[1].length <= 80, l[1]); }
    return out.scene.count;
  };
  assert.ok(draw() > 4 * 3 + 10, 'the field, its pines and four snowballs in the countdown');
  assert.equal(snowball.drawsBalls, true);
  while (g.v.hole().state !== L.H_PLAY) g.step();
  for (let k = 0; k < 200; k++) g.step();
  draw();
  assert.ok(out.paint && out.paint.n === GN && out.paint.cells.length === GN * GN, 'the tracks as the paint layer');
  const b = g.v.partier(0), c = cellAt(C, b.pos[0], b.pos[2]);
  assert.equal(out.paint.cells[c], 1, 'just rolled under P1');
  stampAt(g, c, g.v.tick - MC.SB_PACK - 1);
  assert.ok(tracks(g.v, stage(g.v), g.v.tick + 1).cells[c] >= 2, 'packed');
  const fr = snowball.frame(g.v);
  assert.equal(fr.shape, 'disc');
  assert.ok(Math.abs(fr.radius - rimAt(g.v.party().size, g.v.party().t) - 1) < 1e-3);
  for (const s of [snowball.hint, snowball.rules]) assert.ok(s.length <= 70 && /^[ -_]*$/.test(s), `the title card's line in the 3x5 font: ${s}`);
  // the last ring and the clock's last 10 s: their HUD lines
  for (const [tp, want] of [[MC.SB_CALM + MC.SB_SHRINK + 100, 'LAST RING'], [MC.SB_LEN - 200, 'AT THE CLOCK']]) {
    at(g, tp);
    g.step();
    for (let p = 0; p < 4; p++) put(g, p, C + Math.cos(p * 1.57) * 3.5, C + Math.sin(p * 1.57) * 3.5, { vx: 3, r: 1 + 0.2 * p });
    draw();
    lines.length = 0;
    snowball.hud(g.v, { ...hctx, slot: 0, me: g.v.partier(0) });
    assert.ok(lines.some((l) => l[1].startsWith(want)), lines.map((l) => l[1]).join(' / '));
  }
  // the result
  g.dv.setUint32(L.HDR_UNTIL, g.v.tick, true);
  for (let k = 0; k < 3; k++) g.step();
  draw();
  // the brain: off the rim is a fall; a ball that can swallow you near is a danger, far it isn't
  const h = await room(3, { clean: true, seed: 9 });
  put(h, 0, C, C, { r: 1 });
  put(h, 1, C + 4.5, C, { r: 2.2 });
  put(h, 2, C - 12, C + 6, { r: 1 });
  h.step();
  const me = h.v.partier(0), R = h.v.party().size;
  const bot = { slot: 0, skill: 0.8, mem: {}, pos: [me.pos[0], me.pos[2]], vel: [0, 0], at: h.v.tick };
  assert.equal(snowball.brain.danger(h.v, C + R + 1, C, h.v.tick, me), 1, 'off the rim');
  assert.ok(snowball.brain.danger(h.v, C + 3, C, h.v.tick, me) > 0.8, 'into the big one');
  assert.equal(snowball.brain.danger(h.v, C - 6, C - 6, h.v.tick, me), 0, 'open snow');
  const flee = snowball.brain.goal(h.v, me, bot);
  assert.ok(flee[0] < me.pos[0] + 1, `away from the big one: ${flee.map((x) => (x - C).toFixed(1))}`);
  // the big one hunts the one it can swallow
  const big = h.v.partier(1);
  const hunt = snowball.brain.goal(h.v, big, { slot: 1, skill: 0.8, mem: {}, pos: [big.pos[0], big.pos[2]], vel: [0, 0], at: h.v.tick });
  assert.ok(Math.hypot(hunt[0] - me.pos[0], hunt[1] - me.pos[2]) < 3, 'at its prey');
  // alone, it makes for fresh snow: everything packed but the way to +z
  put(h, 1, C + 12, C - 12, { r: 1 });
  h.step();
  for (let c2 = 0; c2 < GN * GN; c2++) { const i = c2 % GN, j = Math.floor(c2 / GN); const x = C - GN / 2 + i, z = C - GN / 2 + j; stampAt(h, c2, z > C + 1 && Math.abs(x - C) < 3 ? 0 : h.v.tick - MC.SB_PACK - 5); }
  const lone = h.v.partier(0);
  const grow = snowball.brain.goal(h.v, lone, { slot: 0, skill: 0.9, mem: {}, pos: [lone.pos[0], lone.pos[2]], vel: [0, 0], at: h.v.tick });
  assert.ok(grow[1] > C + 6 && Math.abs(grow[0] - C) < 6, `fresh snow ahead: ${grow.map((x) => (x - C).toFixed(1))}`);
  assert.ok(stage(h.v).np === 0);
});
