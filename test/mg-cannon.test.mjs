// CANNONADE (src/mg/cannon.wat): the disc of tiles for the crowd and its
// cannons, the round's shots as setup lays them, the crumbling rim, a
// cannonball's knock on whatever it meets (head on, glancing, a lob coming
// down, hopped over), the calls, a shared win, the prediction through all of
// it, rounds of AI balls, and the client module.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty, partyBytes, predicted } from './helpers.mjs';
import { View, partyWord, hexAt, hexCentre, PLAT_Y } from '../src/party-view.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { playParty } from '../tools/genparty.mjs';
import { Partier } from '../client/party-bot.mjs';
import * as L from '../src/layout.mjs';
import * as MC from '../src/mg/cannon.mjs'; // CN_*: the minigame's own constants
import cannon, { rimAt, cellOf, dropOf, holds, stage, span, shotAt, volleyAt } from '../client/mg/cannon.mjs';

const C = L.B_CX;
const S = Math.fround(MC.CN_S);
const TICK = 0.008;
const f = Math.fround;
const LO0 = L.PG_BIG + MC.CN_LO, HI0 = L.PG_BIG + MC.CN_HI, SH0 = L.PG_BIG + MC.CN_SHOTS;

// A room of n balls on Cannonade, on the debug build (a NaN traps), stepped
// into play unless asked not to; quiet: no shots (every bucket empty), so a
// test lays its own.
async function room(n = 2, { play = true, seed = 7, quiet = false } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_CANNON + 1, true);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); assert.equal(sim.error().code, 0, 'no trap'); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  if (quiet) for (let b = 0; b < MC.CN_NB; b++) { dv.setUint16(LO0 + 2 * b, 0, true); dv.setUint16(HI0 + 2 * b, 0, true); }
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
// A shot in record k, scanned on every tick: from a muzzle at (x, z) heading
// yaw (radians), firing tf ticks into play; it touches down st m along after
// `flight` ticks (over an arc of `arc` m), rolls at v and leaves the floor at
// sout. Its fields as $cn_shot writes them.
function lay(g, k, { x, z, yaw = 0, tf, rc = 1.5, v = 15, st = 0, flight = 1, sout = 80, arc = 0, lob = false }) {
  const a = SH0 + k * MC.CN_REC, dv = g.dv;
  const ux = f(Math.cos(yaw)), uz = f(Math.sin(yaw)), vdt = f(f(v) * f(0.008));
  const tt = tf + flight, te = tt + Math.trunc(f(f(f(sout) - f(st)) / vdt));
  dv.setUint32(a, tf, true); dv.setUint32(a + 4, te, true);
  dv.setFloat32(a + 8, ux, true); dv.setFloat32(a + 12, uz, true);
  dv.setFloat32(a + 16, f(f(f(x) * uz) - f(f(z) * ux)), true); dv.setFloat32(a + 20, rc, true);
  dv.setUint32(a + 24, tt, true); dv.setFloat32(a + 28, x, true); dv.setFloat32(a + 32, z, true);
  dv.setFloat32(a + 36, st, true); dv.setFloat32(a + 40, sout, true); dv.setFloat32(a + 44, v, true);
  dv.setFloat32(a + 48, arc, true); dv.setFloat32(a + 52, f(f(st) / f(f(flight) * f(0.008))), true); dv.setUint32(a + 56, 1, true);
  dv.setUint8(a + 60, 0); dv.setUint8(a + 61, (lob ? 1 : 0) | 2); dv.setUint16(a + 62, k, true);
  for (let b = 0; b < MC.CN_NB; b++) dv.setUint16(HI0 + 2 * b, Math.max(k + 1, dv.getUint16(HI0 + 2 * b, true)), true);
  stage(g.v, true); // the client reads it again
  return { tf, tt, te, ux, uz };
}
// The next step plays tick t into play (the clock moved; the round's end with it).
function at(g, t) {
  const now = g.v.tick;
  g.dv.setUint32(L.HDR_START, now - t, true);
  g.dv.setUint32(L.HDR_UNTIL, now - t + MC.CN_LEN, true);
}
const fxs = (v, kind, from = 0) => { const out = []; for (let k = from; k < v.fxCount(); k++) { const x = v.fx(k); if (x.kind === kind) out.push(x); } return out; };
// Every tile of the disc: [q, r, x, z, a (cell), rho]
function tiles(v) {
  const out = [];
  for (let r = -MC.CN_N; r <= MC.CN_N; r++) for (let q = -MC.CN_N; q <= MC.CN_N; q++) {
    const a = cellOf(q, r);
    if (!dropOf(v, a)) continue;
    const [x, z] = hexCentre(q, r, S);
    out.push([q, r, x, z, a, Math.hypot(x - C, z - C)]);
  }
  return out;
}
const vel = (v, p) => v.partier(p).vel;

test('the stage for 1, 8, 64 and 256: a disc of hex tiles sized for the crowd, each with the tick the rim takes it, 8 to 16 cannons round it, every ball on it apart', async () => {
  let last = 0;
  assert.deepEqual([MC.CN_FX_FIRE, MC.CN_FX_HIT, MC.CN_FX_LAND, MC.CN_FX_CALL], [0, 1, 2, 3].map((k) => L.FX_MG + 4 * L.MG_CANNON + k));
  assert.ok(MC.CN_W === 2 * MC.CN_N + 1 && MC.CN_LO + 2 * MC.CN_NB <= MC.CN_HI && MC.CN_HI + 2 * MC.CN_NB <= MC.CN_SHOTS);
  assert.ok(MC.CN_SHOTS + MC.CN_NMAX * MC.CN_REC <= L.PG_BIG_SIZE && 2 * MC.CN_W * MC.CN_W <= MC.CN_LO && MC.CN_FELL + 2 * L.NPLAYER <= L.PG_S_SIZE);
  assert.ok(MC.CN_NB * MC.CN_BUCKET > MC.CN_LEN + MC.CN_TELE, 'the buckets run past the round');
  for (const n of [1, 8, 64, 256]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party();
    const rad = Math.min(MC.CN_R0 + MC.CN_RK * Math.sqrt(n), MC.CN_RMAX);
    assert.equal(r.game, L.MG_CANNON);
    assert.ok(Math.abs(r.size - rad) < 1e-4, `${r.size} m for ${n}`);
    assert.ok(r.size > last, 'grows with the crowd');
    last = r.size;
    assert.equal(g.dv.getFloat32(L.PG_H + MC.CN_RAD, true), r.size);
    assert.deepEqual([r.kind, r.len, r.floor, r.idle, r.hop, r.flags & L.PGF_BUMPS], [L.PK_OUT, MC.CN_LEN, PLAT_Y, f(MC.CN_IDLE), f(MC.CN_HOP), L.PGF_BUMPS]);
    // the cannons: 8, one more every 5 m of radius past 20, at most 16, on a ring 4 m out
    const nc = g.dv.getUint32(L.PG_H + MC.CN_NC, true);
    assert.equal(nc, Math.min(MC.CN_NCMAX, MC.CN_NC0 + Math.floor(Math.max(0, r.size - MC.CN_NCR) / MC.CN_NCK)));
    assert.ok(nc >= 8 && nc <= 16);
    assert.equal(g.dv.getFloat32(L.PG_H + MC.CN_RC, true), f(r.size + MC.CN_MOUNT));
    assert.ok(g.dv.getUint32(L.PG_H + MC.CN_ROT, true) < 16384);
    const all = tiles(g.v);
    assert.equal(g.dv.getUint32(L.PG_H + MC.CN_COUNT, true), all.length);
    const area = Math.PI * r.size * r.size / (1.5 * Math.sqrt(3) * S * S);
    assert.ok(Math.abs(all.length / area - 1) < 0.12, `${all.length} tiles in a disc of ${r.size} m, about ${area.toFixed(0)}`);
    // every cell: a tile if its centre is on the disc; the rim takes it later the further in it is, never inside CN_RMIN
    for (let rr = -MC.CN_N; rr <= MC.CN_N; rr++) for (let q = -MC.CN_N; q <= MC.CN_N; q++) {
      const [x, z] = hexCentre(q, rr, S);
      const rho = Math.hypot(x - C, z - C);
      const drop = dropOf(g.v, cellOf(q, rr));
      if (rho > r.size + 1e-3) { assert.equal(drop, 0, `${n}: no tile at ${q},${rr}`); continue; }
      if (rho < r.size - 1e-3) assert.ok(drop > 0, `${n}: a tile at ${q},${rr}`);
      if (rho <= MC.CN_RMIN - 1e-3) assert.equal(drop, MC.CN_NEVER, 'the core stays');
      else if (rho > MC.CN_RMIN + 1e-3 && drop) {
        const want = MC.CN_CRUMBLE + 1 + (r.size - rho) / (r.size - MC.CN_RMIN) * MC.CN_SHRINK;
        assert.ok(drop >= want - 1.01 && drop <= want + MC.CN_JIT + 0.01, `${n}: tile at ${rho.toFixed(2)} m goes at ${drop}, from about ${want.toFixed(0)}`);
      }
    }
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p);
      assert.equal(b.pos[1], PLAT_Y, 'on the floor');
      assert.ok(b.ground && !b.out);
      const [q, rr] = hexAt(b.pos[0], b.pos[2], S);
      assert.equal(dropOf(g.v, cellOf(q, rr)) > 0, true, 'on a tile');
      assert.ok(Math.hypot(b.pos[0] - C, b.pos[2] - C) <= r.size * MC.CN_SPAWN + 1e-3, 'on the middle of the disc');
      for (let o = 0; o < p; o++) {
        const c = g.v.partier(o);
        assert.ok(Math.hypot(b.pos[0] - c.pos[0], b.pos[2] - c.pos[2]) >= 2, `${n}: P${p + 1} and P${o + 1} apart`);
      }
    }
  }
});

test('the round\'s shots: in the order they fire, a volley CN_FIRST in and every gap closing to CN_GAP1, growing with the radius and the clock, a cannon each spread round; every lane through the disc as it stands, lobs from CN_LOBFROM; the buckets hold every shot out', async () => {
  for (const n of [1, 64, 256]) {
    const g = await room(n, { play: false, seed: 30 + n });
    const s = stage(g.v, true);
    const rad = s.r0, nc = s.nc;
    assert.equal(s.ns, g.dv.getUint32(L.PG_H + MC.CN_NS, true));
    assert.ok(s.ns > 200 && s.ns <= MC.CN_NMAX, `${s.ns} shots`);
    // the volleys
    const vols = [];
    for (let k = 0; k < s.ns; k++) {
      if (k) assert.ok(s.tf[k] > s.tf[k - 1], 'in the order they fire');
      if (s.fl[k] & 2) vols.push({ k, tf: s.tf[k], n: s.n[k] });
      else assert.equal(s.vol[k], s.vol[k - 1]);
    }
    assert.equal(vols.length, g.dv.getUint32(L.PG_H + MC.CN_NV, true));
    assert.equal(vols[0].tf, MC.CN_FIRST);
    let lobs = 0, late = 0;
    vols.forEach((vo, i) => {
      assert.equal(s.vol[vo.k], i);
      const want = Math.min(nc, 1 + Math.floor(f(rad / MC.CN_PER)) + Math.floor(vo.tf / MC.CN_MORE));
      assert.equal(vo.n, want, `volley ${i} at ${vo.tf}: ${vo.n} shots`);
      if (i + 1 < vols.length) {
        assert.equal(vols[i + 1].k, vo.k + vo.n);
        assert.equal(vols[i + 1].tf - vo.tf, MC.CN_GAP0 - Math.floor(((MC.CN_GAP0 - MC.CN_GAP1) * Math.min(vo.tf, MC.CN_RAMP)) / MC.CN_RAMP));
      } else assert.equal(s.ns, vo.k + vo.n);
      assert.ok(vo.tf + vo.n * MC.CN_STAG < MC.CN_LEN, 'all fired before the end');
      const cans = new Set();
      for (let j = 0; j < vo.n; j++) {
        const k = vo.k + j;
        assert.equal(s.tf[k], vo.tf + j * MC.CN_STAG);
        assert.equal(s.n[k], vo.n);
        assert.equal(s.can[k], (s.can[vo.k] + Math.floor((j * nc) / vo.n)) % nc, 'spread evenly round');
        cans.add(s.can[k]);
        if (s.fl[k] & 1) { lobs++; assert.ok(vo.tf >= MC.CN_LOBFROM, 'lobs only from 30 s'); }
        if (vo.tf >= MC.CN_LOBFROM) late++;
      }
      assert.equal(cans.size, vo.n, 'a cannon each');
    });
    assert.ok(lobs > late * 0.2 && lobs < late * 0.47, `${lobs} lobs of ${late}`);
    // each shot: from its cannon's muzzle, its lane through the middle, the sizes and speeds, where it lands and leaves
    for (let k = 0; k < s.ns; k++) {
      const can = s.cannons[s.can[k]];
      assert.ok(Math.hypot(s.mx[k] - can.x - s.ux[k] * MC.CN_BARREL, s.mz[k] - can.z - s.uz[k] * MC.CN_BARREL) < 0.01, `shot ${k} from its muzzle`);
      assert.ok(Math.abs(Math.hypot(s.ux[k], s.uz[k]) - 1) < 1e-5);
      const rim = rimAt(rad, s.tf[k]);
      const perp = Math.abs((C - s.mx[k]) * s.uz[k] - (C - s.mz[k]) * s.ux[k]);
      assert.ok(perp <= MC.CN_AIM * rim + 1e-3, `shot ${k}'s lane ${perp.toFixed(2)} m off the middle`);
      assert.ok(s.rc[k] >= MC.CN_RC0 - 1e-5 && s.rc[k] <= MC.CN_RC1 + 1e-5);
      assert.ok(s.v[k] >= MC.CN_V1 - MC.CN_VJ - 1e-4 && s.v[k] <= MC.CN_V0 + MC.CN_VJ + MC.CN_VUP + 1e-4, `${s.v[k]} m/s`);
      const tx = s.mx[k] + s.ux[k] * s.st[k] - C, tz = s.mz[k] + s.uz[k] * s.st[k] - C;
      if (s.fl[k] & 1) {
        assert.ok(Math.hypot(tx, tz) < rim - MC.CN_IN, 'a lob lands on the disc');
        assert.ok(s.arc[k] === MC.CN_LOBH && s.tt[k] - s.tf[k] === MC.CN_LOBT0 + Math.trunc(f(s.st[k] * MC.CN_LOBTK)));
      } else {
        assert.ok(Math.abs(Math.hypot(tx, tz) - (rim - MC.CN_IN)) < 0.02, `shot ${k} touches down at the rim: ${Math.hypot(tx, tz).toFixed(2)} of ${rim.toFixed(2)}`);
        assert.ok(Math.abs(s.tt[k] - s.tf[k] - s.st[k] / (s.v[k] * TICK)) <= 1.01, 'at its own speed');
      }
      // off where the rim stands as it gets there (the rim moves under a metre while it rolls the last of the way)
      const ex = s.mx[k] + s.ux[k] * s.sout[k] - C, ez = s.mz[k] + s.uz[k] * s.sout[k] - C;
      if (s.sout[k] > s.st[k] + 1e-3) assert.ok(Math.abs(Math.hypot(ex, ez) - rimAt(rad, s.te[k])) < 0.6, `shot ${k} leaves at ${Math.hypot(ex, ez).toFixed(2)}, the rim ${rimAt(rad, s.te[k]).toFixed(2)}`);
      assert.ok(Math.abs(s.te[k] - s.tt[k] - (s.sout[k] - s.st[k]) / (s.v[k] * TICK)) <= 1.01);
    }
    // the buckets: every shot out on a tick (fired, not CN_FALLT past the far rim) is in its bucket's span
    for (let tp = 0; tp < MC.CN_LEN; tp += 7) {
      const b = Math.floor(tp / MC.CN_BUCKET);
      for (let k = 0; k < s.ns; k++) {
        if (tp >= s.tf[k] && tp < s.te[k] + MC.CN_FALLT) assert.ok(k >= s.lo[b] && k < s.hi[b], `shot ${k} at ${tp} in [${s.lo[b]}, ${s.hi[b]})`);
      }
      assert.ok(s.hi[b] - s.lo[b] <= 100, `${s.hi[b] - s.lo[b]} to scan at ${tp}`);
    }
  }
});

test('the rim: nothing goes before CN_CRUMBLE, then a tile holds through the tick before its own and drops a ball on it; the core never goes', async () => {
  const g = await room(3, { quiet: true });
  const all = tiles(g.v);
  const outer = all.filter((T) => T[5] > MC.CN_RMIN + 2).sort((a, b) => b[5] - a[5]);
  const edge = outer[0], mid = outer[Math.floor(outer.length / 2)];
  put(g, 0, edge[2], edge[3]);
  put(g, 1, C, C);
  put(g, 2, mid[2], mid[3]);
  at(g, MC.CN_CRUMBLE - 20);
  const drop = dropOf(g.v, edge[4]);
  assert.ok(drop > MC.CN_CRUMBLE && drop <= MC.CN_CRUMBLE + 1 + MC.CN_JIT + 200);
  while (g.v.party().t < drop) {
    g.step();
    assert.ok(g.v.partier(0).ground, `held ${g.v.party().t} ticks in`);
  }
  g.step();
  assert.ok(!g.v.partier(0).ground && !g.v.partier(0).out, 'gone from under it');
  const drop2 = dropOf(g.v, mid[4]);
  assert.ok(drop2 > drop);
  at(g, drop2 - 3);
  for (let k = 0; k < 3; k++) { g.step(); assert.ok(g.v.partier(2).ground); }
  g.step();
  assert.ok(!g.v.partier(2).ground, 'and the next one in at its tick');
  at(g, MC.CN_CRUMBLE + MC.CN_SHRINK + MC.CN_JIT + 100);
  for (let k = 0; k < 20; k++) g.step();
  assert.ok(g.v.partier(1).ground && !g.v.partier(1).out);
  const tp = g.v.party().t;
  for (const T of all) assert.equal(holds(g.v, T[4], tp), T[5] <= MC.CN_RMIN, `${T[0]},${T[1]} at ${T[5].toFixed(1)} m`);
  assert.ok(Math.abs(rimAt(g.v.party().size, MC.CN_CRUMBLE + MC.CN_SHRINK / 2) - (g.v.party().size + MC.CN_RMIN) / 2) < 1e-6);
});

test('a cannonball knocks a ball head on hard along its own path, a glancing one aside, none out of its lane or going out', async () => {
  const g = await room(3, { quiet: true, seed: 3 });
  const t0 = g.v.party().t;
  // P1 dead ahead of a shot rolling +x from 25 m out; the others far off its line
  const sh = lay(g, 0, { x: C - 25, z: C, tf: t0 + 2, v: 15, rc: 1.5 });
  put(g, 0, C - 8, C);
  put(g, 1, C + 4, C + 12);
  put(g, 2, C + 4, C - 12);
  let seen = g.v.fxCount(), hit = null;
  for (let k = 0; k < 300 && !hit; k++) {
    g.step();
    hit = fxs(g.v, MC.CN_FX_HIT, seen)[0] || null;
    if (!hit) assert.ok(Math.hypot(...vel(g.v, 0)) < 1e-6, 'still till it gets there');
  }
  assert.ok(hit && hit.owner === 0 && hit.shot === 0, 'P1 knocked');
  let b = g.v.partier(0);
  const along = b.vel[0], side = b.vel[2];
  const want = 15 * (1 + MC.CN_E) + MC.CN_SHOVE;
  assert.ok(Math.abs(along - want) < 1.5, `sent on at ${along.toFixed(2)} m/s, about ${want}`);
  assert.ok(Math.abs(side) < 0.2 && b.vel[1] >= MC.CN_POP - 1e-4 && !b.ground, 'along its path, and up');
  assert.ok(Math.abs(hit.size - (along - MC.CN_SHOVE)) < 0.3, `the knock ${hit.size.toFixed(2)} m/s`);
  // put back out of it, touching
  const p = shotAt(stage(g.v, true), 0, g.v.party().t - 1);
  assert.ok(Math.abs(Math.hypot(b.pos[0] - p.x, b.pos[1] + 1 - p.y, b.pos[2] - p.z) - 2.5) < 0.01, 'touching');
  assert.ok(Math.hypot(...vel(g.v, 1)) < 1e-6 && Math.hypot(...vel(g.v, 2)) < 1e-6, 'the others untouched');
  // glancing: off its line by most of the reach, aside more than along
  const g2 = await room(3, { quiet: true, seed: 4 });
  const t2 = g2.v.party().t;
  lay(g2, 0, { x: C - 25, z: C, tf: t2 + 2, v: 15, rc: 1.5 });
  put(g2, 0, C - 8, C + 2.2);
  put(g2, 1, C - 8, C - 2.62); // out of its reach (2.5 m) by a little
  put(g2, 2, C + 4, C - 12);
  seen = g2.v.fxCount();
  let glance = null;
  for (let k = 0; k < 300 && g2.v.partier(0).ground; k++) {
    g2.step();
    glance ??= fxs(g2.v, MC.CN_FX_HIT, seen)[0];
  }
  b = g2.v.partier(0);
  assert.ok(!b.ground && b.vel[2] > MC.CN_KICK * 0.7, `aside at ${b.vel[2].toFixed(2)} m/s`);
  assert.ok(b.vel[0] < 15 && b.vel[0] > 0, `and on along its path at ${b.vel[0].toFixed(2)}`);
  assert.ok(glance && glance.owner === 0);
  for (let k = 0; k < 120; k++) g2.step();
  assert.ok(g2.v.partier(1).ground && Math.hypot(...vel(g2.v, 1)) < 1e-6, 'a hair out of its lane: untouched');
  // a ball going out is past it: one falling in a lane, at the cannonball, and one on the floor in another
  const g3 = await room(3, { quiet: true, seed: 5 });
  const t3 = g3.v.party().t;
  lay(g3, 0, { x: C - 25, z: C + 10, tf: t3 - 100, v: 15, rc: 1.5 });
  lay(g3, 1, { x: C - 25, z: C - 10, tf: t3 - 100, v: 15, rc: 1.5 });
  const now = shotAt(stage(g3.v, true), 0, t3);
  put(g3, 0, now.x + 0.5, C + 10, { y: PLAT_Y - 0.4, ground: false });
  g3.dv.setUint8(rec(0) + L.P_FL, L.PF_LIVE | L.PF_FALL);
  put(g3, 1, now.x + 0.5, C - 10);
  put(g3, 2, C + 4, C);
  seen = g3.v.fxCount();
  g3.step();
  assert.deepEqual(fxs(g3.v, MC.CN_FX_HIT, seen).map((x) => [x.owner, x.shot]), [[1, 1]]);
  assert.ok(Math.abs(vel(g3.v, 0)[0]) < 1e-6 && vel(g3.v, 1)[0] > 15, 'the falling one untouched');
});

test('a lob flies over the balls between and comes down on its ring, then rolls on; the call as it lands', async () => {
  const g = await room(3, { quiet: true, seed: 8 });
  const t0 = g.v.party().t;
  const sh = lay(g, 0, { x: C - 25, z: C, tf: t0 + 2, v: 15, rc: 1.5, st: 18, flight: 150, arc: MC.CN_LOBH, lob: true });
  put(g, 0, C - 25 + 9, C); // under its arc
  put(g, 1, C - 25 + 18, C + 4); // by its ring, off its lane
  put(g, 2, C - 25 + 30, C); // down its lane past the ring
  let seen = g.v.fxCount();
  const hits = [];
  let land = null;
  for (let k = 0; k < 260; k++) {
    g.step();
    for (const x of fxs(g.v, MC.CN_FX_HIT, seen)) hits.push([x.owner, x.tick - g.v.party().start]);
    land ??= fxs(g.v, MC.CN_FX_LAND, seen)[0];
    seen = g.v.fxCount();
  }
  assert.ok(land && land.shot === 0 && (land.tick - g.v.party().start) === sh.tt, 'the call on the tick it lands');
  assert.ok(Math.hypot(land.pos[0] - (C - 25 + 18), land.pos[2] - C) < 1e-3 && land.pos[1] === PLAT_Y);
  assert.ok(!hits.some(([p]) => p === 0) && g.v.partier(0).ground, 'over P1');
  const h2 = hits.find(([p]) => p === 2);
  assert.ok(h2 && h2[1] > sh.tt, `P3 down its lane, after it lands: ${hits}`);
  // with P2 moved onto the ring as it comes down: under it
  const g2 = await room(3, { quiet: true, seed: 9 });
  const t2 = g2.v.party().t;
  const s2 = lay(g2, 0, { x: C - 25, z: C, tf: t2 + 2, v: 15, rc: 1.5, st: 18, flight: 150, arc: MC.CN_LOBH, lob: true });
  put(g2, 0, C - 25 + 18, C);
  put(g2, 1, C + 4, C + 12);
  put(g2, 2, C + 4, C - 12);
  seen = g2.v.fxCount();
  let first = null;
  for (let k = 0; k < 200 && !first; k++) { g2.step(); first = fxs(g2.v, MC.CN_FX_HIT, seen)[0]; }
  const tp = first.tick - g2.v.party().start;
  assert.ok(first.owner === 0 && tp >= s2.tt - 12 && tp <= s2.tt, `on it as it comes down: ${tp} of ${s2.tt}`);
  assert.ok(g2.v.partier(0).vel[1] > 0 && Math.abs(g2.v.partier(0).vel[0]) > 3);
});

test('a hop clears a small cannonball and the AI ball hops it when it can\'t get clear; a big one it can\'t, and doesn\'t try', async () => {
  for (const [rc, clears] of [[MC.CN_RC0, true], [MC.CN_RC1, false]]) {
    const g = await room(3, { quiet: true, seed: 13 });
    const t0 = g.v.party().t;
    lay(g, 0, { x: C - 25, z: C, tf: t0 + 2, v: 16, rc });
    put(g, 0, C - 5, C);
    put(g, 1, C + 4, C + 12);
    put(g, 2, C + 4, C - 12);
    const seen = g.v.fxCount();
    let hopped = -1;
    for (let k = 0; k < 220; k++) {
      const me = g.v.partier(0);
      const bot = { slot: 0, skill: 1, mem: {}, pos: [me.pos[0], me.pos[2]], vel: [me.vel[0], me.vel[2]], at: g.v.tick };
      const hop = hopped < 0 && cannon.brain.hop(g.v, me, bot);
      if (hop) hopped = g.v.party().t;
      g.step([[L.EV_INPUT, 0, partyWord({ yaw: 0, move: 0, hop: hop ? 1 : 0 })]]);
    }
    const hits = fxs(g.v, MC.CN_FX_HIT, seen).filter((x) => x.owner === 0);
    if (clears) {
      assert.ok(hopped > 0, 'it hops');
      assert.equal(hits.length, 0, 'clear over it');
      assert.ok(g.v.partier(0).ground && Math.abs(g.v.partier(0).pos[0] - (C - 5)) < 0.01, 'and down where it was');
    } else {
      assert.equal(hopped, -1, 'no hop for a big one');
      assert.ok(hits.length > 0);
    }
  }
});

test('the calls: a volley\'s as its stripes show, every cannon firing at its muzzle on its tick, and the lobs\' and the rim\'s CN_WARN ahead', async () => {
  const g = await room(3, { seed: 15 });
  const s = stage(g.v, true);
  const seen = g.v.fxCount();
  for (let k = 0; k < MC.CN_FIRST + 200; k++) { for (let p = 0; p < 3; p++) put(g, p, C - 3 + 3 * p, C); g.step(); }
  const start = g.v.party().start;
  const calls = fxs(g.v, MC.CN_FX_CALL, seen), fires = fxs(g.v, MC.CN_FX_FIRE, seen);
  const vols = [];
  for (let k = 0; k < s.ns; k++) if (s.fl[k] & 2 && s.tf[k] - MC.CN_TELE < MC.CN_FIRST + 200) vols.push(k);
  assert.ok(vols.length >= 2);
  assert.equal(calls.length, vols.length);
  calls.forEach((x, i) => {
    assert.equal(x.tick - start, s.tf[vols[i]] - MC.CN_TELE);
    assert.deepEqual([x.shot, x.size, x.owner], [s.vol[vols[i]], s.n[vols[i]], 255]);
  });
  const want = [];
  for (let k = 0; k < s.ns && s.tf[k] < MC.CN_FIRST + 200; k++) want.push(k);
  assert.deepEqual(fires.map((x) => x.shot), want);
  for (const x of fires) {
    const k = x.shot;
    assert.equal(x.tick - start, s.tf[k]);
    assert.ok(Math.hypot(x.pos[0] - s.mx[k], x.pos[2] - s.mz[k]) < 1e-3 && Math.abs(x.pos[1] - PLAT_Y - MC.CN_MZY) < 1e-3);
    assert.ok(Math.abs(x.size - s.rc[k]) < 1e-5);
  }
  for (const [tp, code] of [[MC.CN_LOBFROM - MC.CN_WARN, 0x8001], [MC.CN_CRUMBLE - MC.CN_WARN, 0x8002]]) {
    at(g, tp - 3);
    const from = g.v.fxCount();
    for (let k = 0; k < 6; k++) { for (let p = 0; p < 3; p++) put(g, p, C - 3 + 3 * p, C); g.step(); }
    const c = fxs(g.v, MC.CN_FX_CALL, from).filter((x) => x.shot === code);
    assert.equal(c.length, 1);
    assert.equal((c[0].tick - g.v.party().start) | 0, tp);
  }
});

test('the last balls on all knocked off at once share the win, rather than all sharing last; ticks apart, the last on wins', async () => {
  const g = await room(3, { quiet: true });
  put(g, 0, C, C);
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
  const g2 = await room(2, { quiet: true, seed: 12 });
  const r2 = g2.v.party().size;
  put(g2, 0, C + r2 + 3, C, { y: PLAT_Y - 0.5, ground: false });
  for (let k = 0; k < 40; k++) g2.step();
  put(g2, 1, C - r2 - 3, C, { y: PLAT_Y - 0.5, ground: false });
  for (let k = 0; k < 400 && g2.v.party().state === L.H_PLAY; k++) g2.step();
  assert.equal(g2.v.party().state, L.H_OVER);
  assert.deepEqual([0, 1].map((q) => g2.v.partier(q).place), [2, 1]);
  assert.equal(g2.v.party().winner, 1);
});

test('the prediction matches the confirmed ball bit for bit: through a cannonball head on and glancing, a lob coming down on it, the crumbling rim, and the real volleys', async () => {
  // one ball a room (a ball alone plays till it falls): nobody to bump it, which the prediction leaves to the confirmed world
  // A: rolling across two lanes as shots come down them
  const g = await room(1, { quiet: true, seed: 23 });
  const t = g.v.party().t;
  lay(g, 0, { x: C - 25, z: C, tf: t + 2, v: 16, rc: 1.4 });
  lay(g, 1, { x: C - 4, z: C - 25, yaw: Math.PI / 2, tf: t + 30, v: 14, rc: 2.2 });
  put(g, 0, C - 6, C - 1);
  let seen = g.v.fxCount();
  const roll = Array.from({ length: 220 }, (_, k) => partyWord({ yaw: k < 150 ? 0 : 4096, move: k > 90 ? 1 : 0, hop: k === 190 ? 1 : 0 }));
  assert.ok(predicted(g, roll) >= roll.length);
  assert.ok(fxs(g.v, MC.CN_FX_HIT, seen).length >= 1, 'knocked');
  // B: a lob coming down on it, the ball edging off its ring
  const gb = await room(1, { quiet: true, seed: 26 });
  const tb = gb.v.party().t;
  lay(gb, 0, { x: C - 25, z: C, tf: tb + 2, v: 15, rc: 1.8, st: 20, flight: 120, arc: MC.CN_LOBH, lob: true });
  put(gb, 0, C - 5, C + 1);
  seen = gb.v.fxCount();
  const sit = Array.from({ length: 160 }, (_, k) => partyWord({ yaw: 4096, move: k > 110 && k < 116 ? 1 : 0 }));
  assert.ok(predicted(gb, sit) >= sit.length);
  assert.ok(fxs(gb.v, MC.CN_FX_HIT, seen).length >= 1, 'under it');
  // C: on the rim as it crumbles, rolling round it
  const g2 = await room(1, { quiet: true, seed: 24 });
  const edge = tiles(g2.v).filter((T) => T[5] > MC.CN_RMIN + 3).sort((a, b) => dropOf(g2.v, a[4]) - dropOf(g2.v, b[4]))[5];
  at(g2, dropOf(g2.v, edge[4]) - 40);
  put(g2, 0, edge[2], edge[3]);
  const round = Array.from({ length: 110 }, (_, k) => partyWord({ yaw: (k * 120) & 16383, move: (k >> 3) & 1 }));
  assert.ok(predicted(g2, round) >= round.length);
  // D: the real volleys, lobs among them, the AI ball steering (a chunk at a time, from the world as the chunk
  // begins) while it can't be going out
  const g3 = await room(1, { seed: 25 });
  at(g3, MC.CN_LOBFROM + 100);
  seen = g3.v.fxCount();
  const bot = new Partier(0, 25, 1);
  let chunks = 0, hops = 0;
  for (let k = 0; k < 40; k++) {
    const b = g3.v.partier(0);
    if (b.out || b.falling || b.pos[1] < PLAT_Y - 0.5 || g3.v.hole().state !== L.H_PLAY) break;
    const words = Array.from({ length: 30 }, (_, i) => bot.think(g3.v, g3.v.tick + i, i));
    hops += words.filter((w) => w & 0x10000000).length;
    assert.ok(predicted(g3, words) >= 30);
    chunks++;
  }
  const fired = fxs(g3.v, MC.CN_FX_FIRE, seen);
  assert.ok(chunks >= 16 && fired.length >= 8, `${chunks} chunks, ${fired.length} shots fired, ${hops} hops`);
});

// A round of AI balls (client/party-bot.mjs, this minigame's brain), as
// tools/genparty.mjs plays them: { log, sim, stats }.
async function aiRound({ bytes, seed, balls, ticks }) {
  const stats = { start: -1, over: -1, outs: [], places: null, pts: null, winner: -1, fires: 0, hits: 0, hops: 0, knocked: 0 };
  const lastHit = new Map();
  let seen = 0;
  const { log, sim } = await playParty({ bytes, seed, mg: L.MG_CANNON, bots: balls, ticks, delay: 6, onTick: (t, s, v) => {
    if (s.error().code) return;
    const g = v.party();
    for (; seen < v.fxCount(); seen++) {
      const x = v.fx(seen);
      if (x.kind === MC.CN_FX_FIRE) stats.fires++;
      if (x.kind === MC.CN_FX_HIT) { stats.hits++; lastHit.set(x.owner, x.tick); }
      if (x.kind === L.FX_SINK && stats.start >= 0 && stats.over < 0) {
        stats.outs.push((x.tick - g.start) * TICK);
        if (x.tick - (lastHit.get(x.owner) ?? -1e9) < 400) stats.knocked++;
      }
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
  test(`a round of ${balls} AI balls on the debug build: no trap, a while before most are out, knocked off by the cannonballs, a winner or the clock; equal on 1 and 4 threads`, async () => {
    const { log, sim, stats } = await aiRound({ bytes: partyBytes(true), seed: balls + 3, balls, ticks });
    assert.equal(sim.error().code, 0);
    assert.ok(stats.over > 0, 'the round ended');
    const secs = (stats.over - stats.start) * TICK;
    assert.ok(secs > 40 && secs <= MC.CN_LEN * TICK + 0.01, `${secs.toFixed(1)} s of play`);
    assert.ok(stats.fires > 150, `${stats.fires} shots`);
    const early = stats.outs.filter((s) => s < 20).length;
    assert.ok(early < balls / 4, `${early} of ${balls} out in the first 20 s (${stats.outs.map((s) => s.toFixed(0))})`);
    assert.ok(stats.knocked >= stats.outs.length / 3, `${stats.knocked} of ${stats.outs.length} outs knocked off by a cannonball`);
    assert.ok(stats.places.every((x) => x >= 1 && x <= balls), `places ${stats.places}`);
    assert.ok(stats.pts.every((x) => x >= 1 && x <= 10), `points ${stats.pts}`);
    assert.ok(stats.places.includes(1) && stats.pts.includes(10), 'somebody won');
    const v = new View(sim.memory.buffer);
    assert.equal(v.party().game, L.MG_CANNON);
    const parsed = parseLog(log);
    const n = stats.over + 50;
    const a = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 1, tag: 't1' });
    const b = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 4, tag: 't4', startWorkers });
    const d = await replay({ bytes: partyBytes(true), log: parsed, ticks: n, threads: 1, tag: 'd1' });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(d.trace).tickHashes], 'the debug build steps the same bits');
  });
}

test('the client module: draws the countdown and the round, frames the disc, writes its HUD lines, and its brain sees what the sim does', async () => {
  const { Scene } = await import('../client/party-render.mjs');
  const g = await room(3, { play: false, seed: 41 });
  const out = { scene: new Scene(24000), solid: [], glow: [], beams: [], decals: [], casters: [], paint: null };
  const lines = [];
  const hctx = { put: (x, y, s, c) => lines.push([y, s, c]), centre: (y, s, c) => lines.push([y, s, c]), right: (y, s, c) => lines.push([y, s, c]), rows: 44, C: {}, slot: 0, now: 0 };
  const clear = () => { out.scene.clear(); out.decals.length = 0; out.glow.length = 0; out.solid.length = 0; out.casters.length = 0; lines.length = 0; };
  const finite = () => { for (let k = 0; k < out.scene.count * 16; k++) assert.ok(Number.isFinite(out.scene.data[k]), 'finite'); };
  const n = tiles(g.v).length, nc = g.dv.getUint32(L.PG_H + MC.CN_NC, true);
  cannon.draw(g.v, { tick: g.v.tick, dt: 0, now: 0, slot: 0 }, out);
  assert.equal(out.scene.count, n + 2 + 8 * nc, 'every tile, the column, and each cannon');
  finite();
  while (g.v.hole().state !== L.H_PLAY) g.step();
  for (const tp of [300, 1500, 4000, 8000, 11000, 14000]) {
    at(g, tp);
    for (let k = 0; k < 140; k++) { for (let p = 0; p < 3; p++) put(g, p, C - 3 + 3 * p, C); g.step(); }
    assert.equal(g.v.hole().state, L.H_PLAY);
    clear();
    const tick = g.v.tick;
    cannon.draw(g.v, { tick, dt: 0, ptick: tick + 3.5, now: 0, slot: 0 }, out);
    finite();
    assert.ok(out.scene.count > 2 + 8 * nc && out.scene.count <= 24000, `${out.scene.count} solids`);
    const s = stage(g.v);
    const t = g.v.party().t + 3.5;
    let live = 0;
    for (let k = 0; k < s.ns; k++) if (t >= s.tf[k] && t <= s.te[k] + 200) live++;
    assert.ok(out.casters.length >= live * 0.8, `${out.casters.length} cannonballs drawn of ${live} out`);
    for (const x of [...out.solid, ...out.glow]) assert.ok(x.pos.every(Number.isFinite) && Number.isFinite(x.size));
    for (const x of out.decals) assert.ok(x.pos.every(Number.isFinite) && Number.isFinite(x.radius));
    cannon.hud(g.v, hctx);
    const text = lines.map((l) => l[1]).join(' | ');
    assert.ok(text.includes('VOLLEY') || text.includes('STRIPES'), text);
    for (const l of lines) assert.ok(l[1].length <= 80, l[1]);
    const fr = cannon.frame(g.v);
    assert.equal(fr.shape, 'disc');
    assert.ok(Math.abs(fr.radius - (rimAt(g.v.party().size, g.v.party().t) + S)) < 1e-3);
  }
  assert.ok(cannon.hint.length <= 70 && cannon.rules.length <= 70);
  // danger: 1 off the disc, high in front of a cannonball rolling at it, none in a quiet spot
  const g2 = await room(2, { quiet: true, seed: 42 });
  const t2 = g2.v.party().t;
  lay(g2, 0, { x: C - 25, z: C, tf: t2 - 150, v: 15, rc: 1.6 });
  g2.step();
  const s2 = stage(g2.v, true);
  const now = shotAt(s2, 0, g2.v.party().t);
  const T = g2.v.tick;
  assert.equal(cannon.brain.danger(g2.v, C + 500, C, T + 10, 0), 1, 'off the disc');
  assert.ok(cannon.brain.danger(g2.v, now.x, C, T, 0) >= 0.75, 'on it');
  assert.ok(cannon.brain.danger(g2.v, now.x + 6, C + 0.5, T, 0) > 0.4, 'just ahead of it');
  assert.equal(cannon.brain.danger(g2.v, now.x + 6, C + 8, T, 0), 0, 'well off its lane');
  assert.equal(cannon.brain.danger(g2.v, now.x - 6, C, T, 0), 0, 'behind it');
  // the goal: out of its lane
  const goal = cannon.brain.goal(g2.v, 0, { skill: 1, mem: {}, pos: [now.x + 8, C], vel: [0, 0], at: T });
  assert.ok(Math.abs(goal[1] - C) > 2.6, `out of the lane: ${goal}`);
  // the HUD sees it coming at you
  lines.length = 0;
  put(g2, 0, now.x + 8, C);
  cannon.hud(g2.v, { ...hctx, me: g2.v.partier(0) });
  assert.ok(lines.some((l) => l[1].startsWith('CANNONBALL')), lines.map((l) => l[1]).join(' | '));
  // the volley on now
  const vo = volleyAt(stage(g.v), 0);
  assert.equal(vo.vol, 0);
  assert.ok(span(stage(g.v), 0, 10)[1] >= 0);
});
