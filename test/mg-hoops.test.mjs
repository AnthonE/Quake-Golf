// HOOPLA (src/mg/hoops.wat): the court, its orbits, ramps and pads laid out
// for the crowd; the hoops where their formula has them on every tick, as
// the client works them out too; a ball's centre crossing a hoop's plane
// inside its ring scores it (its own way through, either way, not again so
// soon, a gold one 3, double at the end), and nothing else does; the ramps
// and pads on the ball, and the prediction through all of it; placed by
// points at 90 s; rounds of AI balls that thread the hoops, equal on 1 and 4
// threads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty, partyBytes } from './helpers.mjs';
import { View, partyWord, PLAT_Y } from '../src/party-view.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { playParty } from '../tools/genparty.mjs';
import * as L from '../src/layout.mjs';
import * as MC from '../src/mg/hoops.mjs'; // HO_*: the minigame's own constants
import hoopsMg, { stage, hoopAt, through, rise, lastScored } from '../client/mg/hoops.mjs';

const C = L.B_CX;
const TICK = 0.008;
const Q = 4096 << 10; // a quarter turn, 2^-24 turn
const f = Math.fround;

// A room of n balls in HOOPLA, on the debug build (a NaN traps), stepped into play unless asked not to.
async function room(n = 2, { play = true, seed = 7 } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_HOOPS + 1, true);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); assert.equal(sim.error().code, 0, 'no trap'); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  while (play && v.hole().state !== L.H_PLAY) step();
  return { sim, v, dv, step };
}
const rec = (p) => L.PLAYERS + p * L.PSIZE;
// Ball p at (x, z) on the floor (or y), rolling at (vx, vz).
function put(g, p, x, z, { y = PLAT_Y, vx = 0, vy = 0, vz = 0, ground = true } = {}) {
  g.dv.setFloat32(rec(p) + L.P_PX, x, true);
  g.dv.setFloat32(rec(p) + L.P_PY, y, true);
  g.dv.setFloat32(rec(p) + L.P_PZ, z, true);
  g.dv.setFloat32(rec(p) + L.P_VX, vx, true);
  g.dv.setFloat32(rec(p) + L.P_VY, vy, true);
  g.dv.setFloat32(rec(p) + L.P_VZ, vz, true);
  g.dv.setUint8(rec(p) + L.P_FL, L.PF_LIVE | (ground ? L.PF_GROUND : 0));
}
// Ball p still on the floor 15 m out on the court's -x side, clear of the pads.
function park(g, p) {
  const st = stage(g.v);
  let z = C - 9 + 3 * p;
  while (st.pads.some((q) => Math.hypot(C - 15 - q.x, z - q.z) < 3)) z += 3;
  put(g, p, C - 15, z);
}
const score = (g, p) => g.dv.getUint16(rec(p) + L.PG_SCORE, true);
const setScore = (g, p, s) => g.dv.setUint16(rec(p) + L.PG_SCORE, s, true);
// The next step plays tick t into play (the clock moved; the round's end with it).
function at(g, t) {
  const now = g.v.tick;
  g.dv.setUint32(L.HDR_START, now - t, true);
  g.dv.setUint32(L.HDR_UNTIL, now - t + MC.HO_LEN, true);
}
const fxs = (v, kind, from = 0) => { const out = []; for (let k = from; k < v.fxCount(); k++) { const x = v.fx(k); if (x.kind === kind) out.push(x); } return out; };
const H32 = (g, k) => g.dv.getUint32(L.PG_H + k, true);
const hoopRec = (i) => L.PG_S + MC.HO_HOOPS + i * MC.HO_HSIZE;
const word = (ang, o = {}) => partyWord({ yaw: Math.round(ang / (2 * Math.PI) * 16384) & 16383, move: 1, ...o });
// Every hoop but orbit orb's first parked far off the court; that one still
// on its orbit's line (at angle a, 2^-24 turn from +x, or the first 1/64
// turn that keeps it 9 m from every pad), facing a + face (a quarter turn:
// along its orbit), its size its middle and its bob at b0, of kind: hoopAt's
// { i, x, z, y, r, nx, nz, ... }.
function pin(g, { orb = 1, a = null, face = Q, kind = MC.HO_KFLOOR, b0 = 0 } = {}) {
  const st = stage(g.v);
  const i = st.orbits[orb].first, rho = st.orbits[orb].rho;
  if (a === null) {
    a = 0;
    for (let k = 0; k < 64; k++) {
      const x = C + Math.cos(k / 64 * 2 * Math.PI) * rho, z = C + Math.sin(k / 64 * 2 * Math.PI) * rho;
      if (st.pads.every((q) => Math.hypot(x - q.x, z - q.z) > 9)) { a = k << 18; break; }
    }
  }
  for (const h of st.hoops) if (h.i !== i) g.dv.setFloat32(hoopRec(h.i) + MC.HO_H_RHO, 1000, true);
  const o = hoopRec(i);
  for (const [k, val] of [[MC.HO_H_A0, a], [MC.HO_H_W, 0], [MC.HO_H_F0, face], [MC.HO_H_FW, 0], [MC.HO_H_S0, 0], [MC.HO_H_SW, 0], [MC.HO_H_B0, b0], [MC.HO_H_BW, 0], [MC.HO_H_KIND, kind]]) {
    g.dv.setUint32(o + k, val >>> 0, true);
  }
  g.v._ho = null;
  const s2 = stage(g.v);
  return { i, ...hoopAt(s2, s2.hoops[i], 0, true) };
}
// Ball p rolled at speed v through the pinned hoop H's plane along its
// normal (dir -1 the other way), w across it and its bottom at y, from d m
// before it, keys held that way unless asked not to (a hop on the hop-th
// step); stepped till it is d m past. The score FX it made.
function roll(g, H, { w = 0, v = 6, d = 3, y = PLAT_Y, dir = 1, keys = true, p = 0, hop = -1 } = {}) {
  const nx = H.nx * dir, nz = H.nz * dir, ux = -H.nz, uz = H.nx;
  put(g, p, H.x - nx * d + ux * w, H.z - nz * d + uz * w, { y, vx: nx * v, vz: nz * v, ground: y === PLAT_Y });
  const k0 = g.v.fxCount();
  const ang = Math.atan2(nz, nx);
  let n = 0;
  while (((g.v.partier(p).pos[0] - H.x) * nx + (g.v.partier(p).pos[2] - H.z) * nz) < d && n++ < 600) {
    const o = n === hop ? { hop: 1 } : {};
    g.step([[L.EV_INPUT, p, keys ? word(ang, o) : partyWord({ yaw: Math.round(ang / (2 * Math.PI) * 16384) & 16383, ...o })]]);
  }
  g.step([[L.EV_INPUT, p, partyWord({})]]);
  return fxs(g.v, MC.HO_FX_SCORE, k0);
}
// Till slot p may score hoop i again.
function cool(g, p, i) {
  while (lastScored(g.v, p, i) >= 0 && g.v.party().t - lastScored(g.v, p, i) <= MC.HO_AGAIN) g.step();
}

test('the court for 1, 8, 64 and 256: sized for the crowd, its ramps in the hub, its orbits and hoops, pads on the orbits, every ball on the floor clear of them', async () => {
  let last = 0;
  for (const n of [1, 8, 64, 256]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party();
    const rad = Math.min(MC.HO_R0 + MC.HO_RK * Math.sqrt(n), MC.HO_RMAX);
    assert.equal(r.game, L.MG_HOOPS);
    assert.ok(Math.abs(r.size - rad) < 1e-4 && r.size > last, `${r.size} m for ${n}`);
    last = r.size;
    assert.deepEqual([r.kind, r.len, r.floor, r.idle, r.hop, r.respawn, r.flags], [L.PK_SCORE, MC.HO_LEN, PLAT_Y, f(MC.HO_IDLE), MC.HO_HOP, MC.HO_RESPAWN, L.PGF_BUMPS]);
    const st = stage(g.v);
    assert.equal(st.rad, r.size);
    // the orbits: from HO_ORB0 every HO_GAP while HO_EDGE in from the rim, turning alternate ways
    const no = Math.min(MC.HO_OMAX, Math.floor((rad - MC.HO_EDGE - MC.HO_ORB0) / MC.HO_GAP) + 1);
    assert.equal(st.orbits.length, no, `${no} orbits`);
    const nh = Math.min(MC.HO_NMAX, MC.HO_N0 + Math.floor(n / MC.HO_NK));
    assert.equal(st.hoops.length, nh, `${nh} hoops`);
    let first = 0;
    st.orbits.forEach((o, k) => {
      assert.equal(o.rho, MC.HO_ORB0 + k * MC.HO_GAP);
      assert.equal(o.first, first);
      first += o.n;
      if (k) assert.ok(Math.sign(o.w) === -Math.sign(st.orbits[k - 1].w), 'the next orbit the other way');
      const v = Math.abs(o.w) / (TICK * 2 ** 24) * 2 * Math.PI * o.rho;
      assert.ok(v >= MC.HO_V0 - 0.01 && v <= MC.HO_V1 + 0.01, `orbit ${k} at ${v.toFixed(2)} m/s`);
      // its hoops evenly round it, at its rate
      for (let j = 0; j < o.n; j++) {
        const h = st.hoops[o.first + j];
        assert.deepEqual([h.rho, h.w, h.orb], [o.rho, o.w, k]);
        assert.equal((h.a0 - st.hoops[o.first].a0) >>> 0, Math.floor(j * 2 ** 24 / o.n));
      }
    });
    assert.equal(first, nh, 'every hoop on an orbit');
    // shared by length: no orbit more than one over its share
    const sum = st.orbits.reduce((s, o) => s + o.rho, 0);
    for (const o of st.orbits) assert.ok(Math.abs(o.n - nh * o.rho / sum) < 1.01, `orbit ${o.o}: ${o.n} of ${nh}`);
    const kinds = [0, 0, 0];
    for (const h of st.hoops) kinds[h.kind]++;
    const gold = nh >= MC.HO_GOLDK ? Math.floor(nh / MC.HO_GOLDK) : 1;
    assert.deepEqual(kinds, [nh - gold - Math.floor((nh - gold) / MC.HO_RAISEK), Math.floor((nh - gold) / MC.HO_RAISEK), gold], `kinds for ${n}`);
    for (const h of st.hoops) {
      const lo = h.kind === MC.HO_KGOLD ? [MC.HO_GSPIN0, MC.HO_GSPIN1, MC.HO_GB0, MC.HO_GB1] : [MC.HO_SPIN0, MC.HO_SPIN1, MC.HO_WB0, MC.HO_WB1];
      assert.ok(Math.abs(h.fw) >= lo[0] && Math.abs(h.fw) <= lo[1] && h.bw >= lo[2] && h.bw <= lo[3] && h.sw >= MC.HO_SZ0 && h.sw <= MC.HO_SZ1, `hoop ${h.i}'s rates`);
    }
    // the ramps: toe HO_RT0 out, evenly round the hub, aimed out
    assert.equal(st.ramps.length, MC.HO_NR);
    for (const rp of st.ramps) {
      assert.ok(Math.abs(Math.hypot(rp.x - C, rp.z - C) - MC.HO_RT0) < 1e-4);
      assert.ok(Math.abs((rp.x - C) * rp.c + (rp.z - C) * rp.s - MC.HO_RT0) < 1e-4, 'aimed out');
    }
    // the pads: on the orbits' lines, one each, two from the third out
    const np = Math.min(MC.HO_NPMAX, st.orbits.reduce((s, o) => s + (o.o >= 2 ? 2 : 1), 0));
    assert.equal(st.pads.length, np);
    for (const p of st.pads) assert.ok(st.orbits.some((o) => Math.abs(Math.hypot(p.x - C, p.z - C) - o.rho) < 1e-3), 'on an orbit\'s line');
    // the hoops through the round: on their orbit's band, their rings on the court, clear of the ramps, sized 2.5 to 3.9 m across
    for (let t = 0; t <= MC.HO_LEN; t += 97) {
      for (const h of st.hoops) {
        const H = hoopAt(st, h, t, true);
        const d = Math.hypot(H.x - C, H.z - C);
        assert.ok(Math.abs(d - h.rho) <= MC.HO_WOB + 1e-4, 'on its band');
        assert.ok(d + H.r <= rad - MC.HO_EDGE + MC.HO_WOB + MC.HO_RMID + MC.HO_RVAR + 1e-3 && d + H.r < rad - 1, 'its ring on the court');
        assert.ok(d - H.r > MC.HO_RT0 + MC.HO_RL + 1, 'clear of the ramps');
        assert.ok(H.r >= 1.25 - 1e-4 && H.r <= 1.95 + 1e-4, `${H.r} m`);
      }
    }
    // the balls: on the floor, off the ramps, clear of the pads, inside the rim, apart
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p);
      assert.equal(b.pos[1], PLAT_Y, `${n}: P${p + 1} on the floor`);
      assert.ok(b.ground && !b.out);
      const d = Math.hypot(b.pos[0] - C, b.pos[2] - C);
      assert.ok(d >= MC.HO_SP0 - 1e-3 && d <= rad - 2, `${n}: P${p + 1} ${d.toFixed(1)} m out`);
      for (const q of st.pads) assert.ok(Math.hypot(b.pos[0] - q.x, b.pos[2] - q.z) >= MC.HO_PADGAP - 1e-3, `${n}: P${p + 1} clear of the pads`);
    }
    assert.equal(H32(g, MC.HO_LEAD), 0xffff);
  }
});

test('the hoops ride their orbits as their formula has them on every tick, and the client works out the same: place, facing, size, height', async () => {
  const g = await room(64, { seed: 21 });
  const st = stage(g.v);
  const now = (k, i) => { const a = L.PG_BIG + MC.HO_NOW + 32 * (k * MC.HO_NMAX + i); return [0, 4, 8, 12, 16, 20].map((o) => g.dv.getFloat32(a + o, true)); };
  let checked = 0;
  const bots = new Set();
  for (let n = 0; n < 400; n++) {
    if (n % 40 === 0) at(g, n * 27);
    g.step();
    const tp = g.v.party().t - 1; // the tick just played
    for (const h of st.hoops) {
      const [x, z, y, r, nx, nz] = now(1, h.i);
      const H = hoopAt(st, h, tp, true);
      assert.ok(Math.abs(H.x - x) < 2e-4 && Math.abs(H.z - z) < 2e-4 && Math.abs(H.y - y) < 2e-5, `hoop ${h.i} at ${tp}: ${[H.x, H.z, H.y]} vs ${[x, z, y]}`);
      assert.ok(Math.abs(H.r - r) < 2e-6 && Math.abs(H.nx - nx) < 2e-6 && Math.abs(H.nz - nz) < 2e-6);
      const [x0, z0] = now(0, h.i);
      const H0 = hoopAt(st, h, Math.max(0, tp - 1), true);
      assert.ok(Math.abs(H0.x - x0) < 2e-4 && Math.abs(H0.z - z0) < 2e-4, 'and on the tick before');
      const bot = H.y - H.r - PLAT_Y;
      if (h.kind === MC.HO_KFLOOR) assert.ok(Math.abs(bot - MC.HO_FOOT) < 1e-4);
      if (h.kind === MC.HO_KRAISED) assert.ok(Math.abs(bot - MC.HO_LIFT) < 1e-4);
      if (h.kind === MC.HO_KGOLD) { assert.ok(bot >= MC.HO_FOOT - 1e-4 && bot <= MC.HO_GOLDB + 1e-4 && r <= MC.HO_GMID + MC.HO_GVAR + 1e-5); bots.add(Math.round(bot * 2)); }
      checked++;
    }
  }
  assert.ok(checked >= 400 * 14);
  assert.ok(bots.size >= 4, 'a gold one bobs from the floor up');
  // a hoop drifts at its orbit's speed (and its wobble's), its facing turns at its own rate past its orbit's
  const h = st.hoops.find((x) => x.kind === MC.HO_KFLOOR);
  const A = hoopAt(st, h, 1000), B = hoopAt(st, h, 1125);
  const v = Math.hypot(B.x - A.x, B.z - A.z);
  const vo = Math.abs(h.w) / (TICK * 2 ** 24) * 2 * Math.PI * h.rho;
  assert.ok(Math.abs(v - vo) < 1.5, `${v.toFixed(2)} m in a second at ${vo.toFixed(2)} m/s`);
});

test('scoring: a ball rolled through a hoop\'s ring scores it, inside its radius and not outside it, either way, at the crossing; not twice within 3 s, but another ball may', async () => {
  const g = await room(3);
  park(g, 1); park(g, 2);
  const H = pin(g);
  assert.ok(Math.abs(Math.hypot(H.x - C, H.z - C) - 18.5) < 1e-3 && Math.abs(H.y - (PLAT_Y + MC.HO_FOOT + MC.HO_RMID)) < 1e-5 && Math.abs(H.r - MC.HO_RMID) < 1e-6);
  assert.ok(Math.abs(H.nx * (H.x - C) + H.nz * (H.z - C)) < 1e-3, 'facing along its orbit');
  // a rolling ball's centre is 1 m up: inside the ring within sqrt(r^2 - (y - 1)^2) of its middle across
  const reach = Math.sqrt(H.r ** 2 - (H.y - PLAT_Y - 1) ** 2);
  const ux = -H.nz, uz = H.nx;
  const s0 = score(g, 0);
  const [f1, ...more] = roll(g, H, { w: reach - 0.03 });
  assert.equal(more.length, 0);
  assert.ok(f1, 'through, just inside');
  assert.deepEqual([f1.owner, f1.shot, f1.size], [0, H.i, 1]);
  assert.equal(score(g, 0), s0 + 1);
  const at0 = [H.x + ux * (reach - 0.03), PLAT_Y + 1, H.z + uz * (reach - 0.03)];
  assert.ok(f1.pos.every((x, k) => Math.abs(x - at0[k]) < 1e-3), `at the crossing ${f1.pos} (${at0})`);
  assert.equal(lastScored(g.v, 0, H.i), (f1.tick - g.v.party().start) | 0, 'its tick into play in the table');
  assert.equal(g.dv.getUint32(hoopRec(H.i) + MC.HO_H_HITS, true), 1);
  // again at once, back the other way: too soon
  assert.equal(roll(g, H, { dir: -1 }).length, 0, 'not again within HO_AGAIN');
  // another ball meanwhile: its own
  park(g, 0);
  assert.equal(roll(g, H, { p: 1 }).length, 1, 'P2 through it too');
  park(g, 1);
  // 3 s on, the other way: again
  const t0 = f1.tick;
  while (g.v.tick < t0 + MC.HO_AGAIN - 40) g.step();
  const back = roll(g, H, { dir: -1, w: -0.4 });
  assert.equal(back.length, 1, 'through the other way, 3 s on');
  assert.ok(back[0].tick - t0 >= MC.HO_AGAIN);
  // just outside the ring: nothing; well outside the other side: nothing
  cool(g, 0, H.i);
  assert.equal(roll(g, H, { w: reach + 0.03 }).length, 0, 'just outside');
  assert.equal(roll(g, H, { w: -(reach + 0.5) }).length, 0, 'outside the other side');
  assert.equal(score(g, 0), s0 + 2);
});

test('only its own way through: a hoop drifting over a still ball or one creeping scores nothing, nor one put across it, nor one going out', async () => {
  const g = await room(2);
  park(g, 1);
  const H = pin(g);
  const i = H.i, o = hoopRec(i);
  // the hoop comes at a still ball face on, along its orbit at 2 m/s, and on past it
  const w = Math.round(2 * TICK * 2 ** 24 / (2 * Math.PI * 18.5));
  const a0 = g.dv.getUint32(o + MC.HO_H_A0, true);
  g.dv.setInt32(o + MC.HO_H_W, w, true);
  g.dv.setUint32(o + MC.HO_H_A0, (a0 - w * 125) >>> 0, true);
  at(g, 0);
  g.v._ho = null;
  const st = stage(g.v);
  const P = hoopAt(st, st.hoops[i], 125, true);
  put(g, 0, P.x, P.z);
  const k0 = g.v.fxCount();
  for (let n = 0; n < 250; n++) { g.step([[L.EV_INPUT, 0, partyWord({})]]); put(g, 0, P.x, P.z); }
  const H1 = hoopAt(st, st.hoops[i], g.v.party().t, true);
  assert.ok((P.x - H1.x) * H1.nx + (P.z - H1.z) * H1.nz < -1.5, 'the hoop went past it');
  assert.equal(fxs(g.v, MC.HO_FX_SCORE, k0).length, 0, 'a still ball scores nothing');
  // pinned again: a ball creeping through at 1 m/s (under HO_MOVE a tick) scores nothing; at 1.6 m/s it does
  const Hp = pin(g);
  park(g, 0);
  g.step();
  assert.equal(roll(g, Hp, { v: 1, keys: false, d: 0.05 }).length, 0, 'creeping');
  assert.equal(roll(g, Hp, { v: 1.6, keys: false, d: 0.05 }).length, 1, 'at 1.6 m/s');
  // put across its plane (a respawn, a hand): no roll moves a ball that far in a tick
  cool(g, 0, Hp.i);
  put(g, 0, Hp.x - Hp.nx * 0.6, Hp.z - Hp.nz * 0.6);
  g.step([[L.EV_INPUT, 0, partyWord({})]]);
  const k1 = g.v.fxCount();
  put(g, 0, Hp.x + Hp.nx * 0.6, Hp.z + Hp.nz * 0.6);
  g.step([[L.EV_INPUT, 0, partyWord({})]]);
  assert.equal(fxs(g.v, MC.HO_FX_SCORE, k1).length, 0, 'put across it');
  // a ball going out (falling, held at the ring's height) through it: nothing
  put(g, 0, Hp.x - Hp.nx * 3, Hp.z - Hp.nz * 3, { vx: Hp.nx * 6, vz: Hp.nz * 6 });
  g.dv.setUint8(rec(0) + L.P_FL, L.PF_LIVE | L.PF_FALL);
  const k2 = g.v.fxCount();
  for (let n = 0; n < 100; n++) { g.step(); g.dv.setFloat32(rec(0) + L.P_PY, PLAT_Y, true); g.dv.setFloat32(rec(0) + L.P_VY, 0, true); }
  assert.ok((g.v.partier(0).pos[0] - Hp.x) * Hp.nx + (g.v.partier(0).pos[2] - Hp.z) * Hp.nz > 1, 'past it');
  assert.equal(fxs(g.v, MC.HO_FX_SCORE, k2).length, 0, 'going out');
});

test('raised and gold: rolling under a raised ring misses, a hop through it scores; gold pays 3, up out of a roll\'s reach and just in a hop\'s; the last 15 s pay double', async () => {
  const g = await room(2);
  park(g, 1);
  let H = pin(g, { kind: MC.HO_KRAISED });
  assert.ok(Math.abs(H.y - H.r - PLAT_Y - MC.HO_LIFT) < 1e-5, 'raised');
  assert.equal(roll(g, H).length, 0, 'rolled under it');
  // a hop 0.66 m before its plane at 7.5 m/s: its centre 1.6 m up as it crosses
  const hopped = roll(g, H, { hop: 44 });
  assert.equal(hopped.length, 1, 'hopped through');
  assert.ok(hopped[0].pos[1] > PLAT_Y + MC.HO_LIFT && hopped[0].size === 1, `at ${hopped[0].pos[1] - PLAT_Y} m`);
  // gold, down: rolled through for 3
  H = pin(g, { kind: MC.HO_KGOLD });
  assert.ok(Math.abs(H.y - H.r - PLAT_Y - MC.HO_FOOT) < 1e-5 && Math.abs(H.r - MC.HO_GMID) < 1e-6, 'gold, down');
  cool(g, 0, H.i);
  const s0 = score(g, 0);
  const [gf] = roll(g, H, { w: 0.2 });
  assert.deepEqual([gf?.size, score(g, 0)], [MC.HO_GOLDV, s0 + MC.HO_GOLDV]);
  // gold, up (its bob at half a turn): over a rolling ball, and over a ball flying 0.15 m under a hop's top
  const Hu = pin(g, { kind: MC.HO_KGOLD, b0: 8192 << 10 });
  assert.ok(Math.abs(Hu.y - Hu.r - PLAT_Y - MC.HO_GOLDB) < 1e-5, 'gold, up');
  cool(g, 0, Hu.i);
  assert.equal(roll(g, Hu).length, 0, 'rolled under');
  const fly = (d, y, vy, v = 6) => {
    put(g, 0, Hu.x - Hu.nx * d, Hu.z - Hu.nz * d, { y, vy, vx: Hu.nx * v, vz: Hu.nz * v, ground: false });
    const k = g.v.fxCount();
    for (let n = 0; n < 50; n++) g.step();
    return fxs(g.v, MC.HO_FX_SCORE, k);
  };
  assert.equal(fly(0.6, PLAT_Y + 1.45, 0).length, 0, 'under it');
  assert.equal(fly(0.6, PLAT_Y + 1.6, 1).length, 1, 'a hop\'s top just reaches into it');
  // thrown up through its middle
  cool(g, 0, Hu.i);
  const [up] = fly(1.5, PLAT_Y + 2, 6);
  assert.ok(up && Math.abs(up.pos[1] - Hu.y) < 0.3, 'thrown up through it');
  // the last 15 s: double, called at HO_DOUBLE
  const Hf = pin(g);
  cool(g, 0, Hf.i);
  at(g, MC.HO_DOUBLE - 3);
  const k1 = g.v.fxCount();
  for (let n = 0; n < 5; n++) g.step();
  const call = fxs(g.v, MC.HO_FX_CALL, k1);
  assert.deepEqual(call.map((x) => [x.owner, x.shot, (x.tick - g.v.party().start) | 0]), [[255, 0, MC.HO_DOUBLE]]);
  const [df] = roll(g, Hf, { w: -0.3 });
  assert.equal(df?.size, 2, 'a hoop worth 2');
  const Hg = pin(g, { kind: MC.HO_KGOLD });
  cool(g, 0, Hg.i);
  const [dg] = roll(g, Hg);
  assert.equal(dg?.size, 2 * MC.HO_GOLDV, 'a gold one 6');
});

test('the ramps: up from the toe and off the lip flying, back down with no keys; their sides and back are walls; a step\'s height of the side climbs on', async () => {
  const g = await room(2);
  park(g, 1);
  const st = stage(g.v);
  const [rp] = st.ramps;
  const up = Math.atan2(rp.s, rp.c);
  const along = (a, w = 0) => [rp.x + rp.c * a - rp.s * w, rp.z + rp.s * a + rp.c * w];
  const local = (b) => { const dx = b.pos[0] - rp.x, dz = b.pos[2] - rp.z; return [dx * rp.c + dz * rp.s, dz * rp.c - dx * rp.s]; };
  // the ground: the slope's top on it, the floor off it
  for (const a of [0.5, 2, 4]) assert.ok(Math.abs(rise(rp, ...along(a)) - a * MC.HO_RH / MC.HO_RL) < 1e-5);
  assert.equal(rise(rp, ...along(5)), -1);
  // up it at 9 m/s, keys held: it rises with the slope, leaves the lip rising, lands beyond it
  put(g, 0, ...along(-3), { vx: rp.c * 9, vz: rp.s * 9 });
  let lipVy = null, n = 0, top = 0;
  while (n++ < 300) {
    g.step([[L.EV_INPUT, 0, word(up)]]);
    const b = g.v.partier(0);
    const [a] = local(b);
    if (a > 0.5 && a < MC.HO_RL - 0.3) assert.ok(Math.abs(b.pos[1] - (PLAT_Y + a * MC.HO_RH / MC.HO_RL)) < 0.05, `on the slope at ${a.toFixed(2)}`);
    if (lipVy === null && a > MC.HO_RL) lipVy = b.vel[1];
    top = Math.max(top, b.pos[1]);
    if (a > MC.HO_RL + 1 && b.ground) break;
  }
  assert.ok(lipVy > 1, `off the lip rising at ${lipVy?.toFixed(2)} m/s`);
  assert.ok(top > PLAT_Y + MC.HO_RH + 0.05, 'over the lip\'s height');
  const [aLand] = local(g.v.partier(0));
  assert.ok(aLand > MC.HO_RL + 2 && g.v.partier(0).pos[1] === PLAT_Y, `landed ${(aLand - MC.HO_RL).toFixed(1)} m past the lip`);
  // halfway up with no keys: it rolls back down off the toe
  put(g, 0, ...along(MC.HO_RL / 2), { y: PLAT_Y + MC.HO_RH / 2 });
  for (let k = 0; k < 250; k++) g.step([[L.EV_INPUT, 0, partyWord({})]]);
  assert.ok(local(g.v.partier(0))[0] < 0 && g.v.partier(0).pos[1] === PLAT_Y, 'rolled back off its toe');
  // into its side high up, at 7 m/s: turned back, its centre never over it
  for (const [a, w, vw, va] of [[3.5, MC.HO_RW + 2, -7, 0], [3, -(MC.HO_RW + 2), 7, 0], [MC.HO_RL + 2, 0, 0, -7], [MC.HO_RL + 1.6, 1, 0, -6]]) {
    const [x, z] = along(a, w);
    put(g, 0, x, z, { vx: rp.c * va - rp.s * vw, vz: rp.s * va + rp.c * vw });
    let inside = false;
    for (let k = 0; k < 90; k++) {
      g.step([[L.EV_INPUT, 0, partyWord({})]]);
      const [la, lw] = local(g.v.partier(0));
      if (la >= 0 && la <= MC.HO_RL && Math.abs(lw) <= MC.HO_RW) inside = true;
    }
    const [la, lw] = local(g.v.partier(0));
    assert.ok(!inside, `off its wall from (${a}, ${w})`);
    assert.ok(va ? la > MC.HO_RL + 0.9 : Math.abs(lw) > MC.HO_RW + 0.9, `turned back (${la.toFixed(2)}, ${lw.toFixed(2)})`);
    assert.equal(g.v.partier(0).pos[1], PLAT_Y);
  }
  // near the toe the side is under a step: a ball rolls on over it, and up
  put(g, 0, ...along(0.6, MC.HO_RW + 1.5), { vx: rp.s * 5, vz: -rp.c * 5 });
  let on = false;
  for (let k = 0; k < 80; k++) { g.step([[L.EV_INPUT, 0, partyWord({})]]); const [la, lw] = local(g.v.partier(0)); if (Math.abs(lw) < MC.HO_RW - 0.2 && la > 0 && g.v.partier(0).pos[1] > PLAT_Y) on = true; }
  assert.ok(on, 'on from the side by the toe');
});

test('the pads: a ball rolling onto one is thrown up at HO_PADV, its bottom 3.6 m up; one in the air over it is not', async () => {
  const g = await room(2);
  park(g, 1);
  const st = stage(g.v);
  const [pd] = st.pads;
  // along its orbit's line, clear of the hub
  const d = Math.hypot(pd.x - C, pd.z - C), tx = -(pd.z - C) / d, tz = (pd.x - C) / d;
  const k0 = g.v.fxCount();
  put(g, 0, pd.x - tx * 4, pd.z - tz * 4, { vx: tx * 6, vz: tz * 6 });
  let top = 0, n = 0;
  while (n++ < 200) { g.step([[L.EV_INPUT, 0, word(Math.atan2(tz, tx))]]); top = Math.max(top, g.v.partier(0).pos[1]); if (top > PLAT_Y + 1 && g.v.partier(0).ground) break; }
  const [fp, ...more] = fxs(g.v, MC.HO_FX_PAD, k0);
  assert.ok(fp && more.length === 0, 'thrown once');
  assert.deepEqual([fp.owner, fp.shot, fp.size, fp.pos[1]], [0, 0, MC.HO_PADV, PLAT_Y]);
  assert.ok(Math.abs(top - PLAT_Y - (MC.HO_PADV ** 2) / 40) < 0.15, `its bottom ${(top - PLAT_Y).toFixed(2)} m up`);
  // over it 3 m up, coming down past it: no throw
  const k1 = g.v.fxCount();
  put(g, 0, pd.x - tx, pd.z - tz, { y: PLAT_Y + 3, vx: tx * 6, vz: tz * 6, ground: false });
  for (let k = 0; k < 40; k++) g.step([[L.EV_INPUT, 0, partyWord({})]]);
  assert.equal(fxs(g.v, MC.HO_FX_PAD, k1).length, 0);
});

test('off the rim: down 2 s, back with its points; the leader holds the crown till passed; placed by points at 90 s, ties sharing', async () => {
  const g = await room(4);
  const st = stage(g.v);
  const ang = 0.37;
  setScore(g, 0, 9);
  put(g, 0, C + Math.cos(ang) * (st.rad - 1), C + Math.sin(ang) * (st.rad - 1), { vx: Math.cos(ang) * 6, vz: Math.sin(ang) * 6 });
  for (let p = 1; p < 4; p++) park(g, p);
  while (!g.v.partier(0).out) g.step();
  const t0 = g.v.tick - 1;
  while (g.v.partier(0).out) g.step();
  assert.equal(g.v.tick - 1 - t0, MC.HO_RESPAWN, 'down 2 s');
  assert.equal(score(g, 0), 9, 'back with its points');
  // the leader: P1 with 9; P3 passes it
  assert.equal(H32(g, MC.HO_LEAD), 0);
  const k0 = g.v.fxCount();
  setScore(g, 2, 10);
  g.step();
  assert.equal(H32(g, MC.HO_LEAD), 2);
  const [lf] = fxs(g.v, MC.HO_FX_LEAD, k0);
  assert.deepEqual([lf.owner, lf.shot, lf.size], [2, 0, 10]);
  setScore(g, 0, 10);
  g.step();
  assert.equal(H32(g, MC.HO_LEAD), 2, 'a tie keeps it');
  // the end
  at(g, MC.HO_LEN - 2);
  for (const [p, s] of [[0, 12], [1, 40], [2, 12], [3, 3]]) setScore(g, p, s);
  for (let p = 0; p < 4; p++) put(g, p, C + 12 * Math.cos(p * 1.6 + 0.3), C + 12 * Math.sin(p * 1.6 + 0.3));
  while (g.v.party().state === L.H_PLAY) g.step();
  const r = g.v.party();
  assert.equal(r.winner, 1);
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.partier(p).place), [2, 1, 2, 4]);
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.partier(p).pts), [7, 10, 7, 1]);
});

// The prediction against the confirmed world, as helpers.mjs's predicted(),
// for slot 0 of room g through `inputs`: its whole record bit for bit but
// PG_SCORE, which only the confirmed world's tick writes (a hoop scored
// arrives a round trip late, as a bump does) and the prediction carries as it
// found it. Returns how many it compared.
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

test('the prediction matches the confirmed ball bit for bit (but its score): up a ramp and off its lip with a hop, onto a pad, into a wall, through hoops, off the rim', async () => {
  const g = await room(2, { seed: 11 });
  park(g, 1);
  const st = stage(g.v);
  const [rp] = st.ramps;
  const up = Math.atan2(rp.s, rp.c);
  // A: from the hub up ramp 0, hopping at its lip, on out over the first orbit
  put(g, 0, rp.x - rp.c * 1.5, rp.z - rp.s * 1.5);
  const A = Array.from({ length: 200 }, (_, k) => word(up, { hop: k === 118 ? 1 : 0 }));
  const k0 = g.v.fxCount();
  assert.ok(predicted(g, A) >= A.length);
  // B: onto pad 0, flying, landing, rolling through the hoop pinned on its line
  const [pd] = st.pads;
  const pr = Math.hypot(pd.x - C, pd.z - C), tx = -(pd.z - C) / pr, tz = (pd.x - C) / pr;
  const H = pin(g);
  put(g, 0, pd.x - tx * 4, pd.z - tz * 4);
  assert.ok(predicted(g, Array(220).fill(word(Math.atan2(tz, tx)))) >= 220);
  assert.ok(fxs(g.v, MC.HO_FX_PAD, k0).some((x) => x.owner === 0), 'thrown up by a pad');
  put(g, 0, H.x - H.nx * 6 - H.nz * 0.3, H.z - H.nz * 6 + H.nx * 0.3);
  const s0 = score(g, 0);
  assert.ok(predicted(g, Array(220).fill(word(Math.atan2(H.nz, H.nx)))) >= 220);
  assert.equal(score(g, 0), s0 + 1, 'through the hoop');
  // C: into ramp 1's side, bounced off it, coasting (the brake)
  const r1 = st.ramps[1];
  put(g, 0, r1.x + r1.c * 3 + r1.s * 5, r1.z + r1.s * 3 - r1.c * 5);
  const side = Math.atan2(r1.c, -r1.s);
  assert.ok(predicted(g, [...Array(70).fill(word(side)), ...Array(60).fill(partyWord({ yaw: 0 }))]) >= 130);
  // D: and on over the rim, falling (not yet down: the down is the confirmed world's)
  const ang = 2.1;
  put(g, 0, C + Math.cos(ang) * (st.rad - 6), C + Math.sin(ang) * (st.rad - 6));
  let n = 0;
  while (!g.v.partier(0).falling && n++ < 40) assert.ok(predicted(g, Array(10).fill(word(ang))) >= 10);
  assert.ok(predicted(g, Array(40).fill(word(ang))) >= 40);
  assert.ok(g.v.partier(0).falling && !g.v.partier(0).out, 'off the rim, falling');
});

// Rounds of AI balls (client/party-bot.mjs, this brain), as tools/genparty.mjs plays them.
for (const [balls, ticks] of [[8, 12100], [64, 12150]]) {
  test(`a round of ${balls} AI balls on the debug build: no trap, every ball threading hoops (raised and gold too), few falls, placed by points at 90 s; equal on 1 and 4 threads`, async () => {
    const stats = { start: -1, over: -1, scores: 0, by: new Map(), kinds: [0, 0, 0], pads: 0, falls: 0, places: null, final: null, pts: null };
    let seen = 0;
    const { log, sim, view } = await playParty({ bytes: partyBytes(true), mg: L.MG_HOOPS, seed: balls, bots: balls, ticks, delay: 8, onTick: (t, s, v) => {
      assert.equal(s.error().code, 0, 'no trap');
      for (; seen < v.fxCount(); seen++) {
        const x = v.fx(seen);
        if (x.kind === MC.HO_FX_SCORE) {
          stats.scores++;
          stats.by.set(x.owner, (stats.by.get(x.owner) || 0) + 1);
          stats.kinds[v.dv.getUint32(hoopRec(x.shot) + MC.HO_H_KIND, true)]++;
        }
        if (x.kind === MC.HO_FX_PAD) stats.pads++;
        if (x.kind === L.FX_SINK) stats.falls++;
      }
      const g = v.party();
      if (stats.start < 0 && g.state === L.H_PLAY) stats.start = t;
      if (stats.over < 0 && stats.start >= 0 && g.state === L.H_OVER) {
        stats.over = t;
        const all = [...Array(balls).keys()].map((p) => v.partier(p));
        stats.places = all.map((b) => b.place);
        stats.final = all.map((b) => b.score);
        stats.pts = all.map((b) => b.pts);
      }
    } });
    assert.equal(sim.error().code, 0);
    assert.ok(stats.over > 0, 'the round ended');
    assert.equal(stats.over - stats.start, MC.HO_LEN, 'at the time');
    assert.equal(stats.by.size, balls, 'every ball through a hoop');
    assert.ok(stats.scores >= balls * 6, `${stats.scores} hoops threaded`);
    assert.ok(stats.kinds.every((k) => k > 0), `by kind ${stats.kinds}`);
    assert.ok(stats.falls < balls, `${stats.falls} falls`);
    const sorted = [...stats.final].sort((a, b) => b - a);
    assert.ok(sorted[0] > sorted.at(-1) + 3, `scores ${sorted}`);
    stats.final.forEach((s, p) => assert.equal(stats.places[p], 1 + stats.final.filter((o) => o > s).length, 'placed by points'));
    assert.ok(stats.pts.every((x) => x >= 1 && x <= 10) && stats.pts.includes(10), `points ${stats.pts}`);
    assert.equal(view.party().game, L.MG_HOOPS);
    const parsed = parseLog(log);
    const n = stats.over + 50;
    const a = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 1, tag: 't1' });
    const b = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 4, tag: 't4', startWorkers });
    const d = await replay({ bytes: partyBytes(true), log: parsed, ticks: n, threads: 1, tag: 'd1' });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(d.trace).tickHashes], 'the debug build steps the same bits');
  });
}

test('the client module: draws every phase, frames the court, writes its HUD lines; its crossing is the sim\'s; its brain sees the rim and threads a hoop', async () => {
  const { Scene } = await import('../client/party-render.mjs');
  assert.equal(MC.HO_FX_SCORE, L.FX_MG + 4 * L.MG_HOOPS);
  assert.deepEqual([MC.HO_FX_PAD, MC.HO_FX_CALL, MC.HO_FX_LEAD], [MC.HO_FX_SCORE + 1, MC.HO_FX_SCORE + 2, MC.HO_FX_SCORE + 3]);
  assert.ok(hoopsMg.hint.length <= 70);
  assert.equal(hoopsMg.id, L.MG_HOOPS);
  const g = await room(6, { seed: 41, play: false });
  const out = () => ({ scene: new Scene(24000), solid: [], glow: [], beams: [], decals: [], casters: [], paint: null });
  const lines = [];
  const hctx = (o = {}) => ({ put: (x, y, s, c) => lines.push([y, s, c]), centre: (y, s, c) => lines.push([y, s, c]), right: (y, s, c) => lines.push([y, s, c]), rows: 44, C: {}, slot: 0, now: 0, ...o });
  const check = (o) => {
    assert.ok(o.scene.count >= stage(g.v).hoops.length * 18 + 4, `${o.scene.count} solids`);
    for (let k = 0; k < o.scene.count * 16; k++) assert.ok(Number.isFinite(o.scene.data[k]), 'finite');
    for (const s of [...o.solid, ...o.glow]) assert.ok(s.pos.every(Number.isFinite) && Number.isFinite(s.size));
    for (const d of o.decals) assert.ok(d.pos.every(Number.isFinite) && d.radius > 0);
    for (const b of o.beams) assert.ok([...b.a, ...b.b].every(Number.isFinite));
  };
  let o = out();
  hoopsMg.draw(g.v, { tick: g.v.tick, dt: 0, now: 0, slot: 0 }, o);
  check(o);
  assert.equal(hoopsMg.env, 'day');
  const yaw = hoopsMg.facing(g.v, 0);
  assert.ok(Number.isFinite(yaw), 'faces a hoop');
  while (g.v.hole().state !== L.H_PLAY) g.step();
  for (let k = 0; k < 100; k++) g.step();
  o = out();
  lines.length = 0;
  hoopsMg.draw(g.v, { tick: g.v.tick, dt: 0, ptick: g.v.tick + 0.4, now: 1000, slot: 0, pme: g.v.partier(0) }, o);
  check(o);
  hoopsMg.hud(g.v, hctx({ t: g.v.party().t * TICK, me: g.v.partier(0) }));
  let text = lines.map((l) => l[1]).join(' | ');
  assert.ok(/DOUBLE POINTS IN \d+/.test(text) && /OF 6/.test(text), text);
  for (const l of lines) assert.ok(l[1].length <= 40, l[1]);
  // the double: the evening, every hoop aglow
  at(g, MC.HO_DOUBLE + 10);
  g.step();
  o = out();
  lines.length = 0;
  hoopsMg.draw(g.v, { tick: g.v.tick, dt: 0, ptick: g.v.tick, now: 2000, slot: 0 }, o);
  hoopsMg.hud(g.v, hctx({ t: g.v.party().t * TICK, me: g.v.partier(0) }));
  assert.equal(hoopsMg.env, 'sunset');
  assert.ok(lines.some((l) => l[1] === 'DOUBLE POINTS'));
  const fr = hoopsMg.frame(g.v);
  assert.deepEqual([fr.shape, fr.radius, fr.centre], ['disc', stage(g.v).rad, [C, PLAT_Y, C]]);
  // its crossing (through) is the sim's: for balls rolled past a pinned hoop at offsets across it
  at(g, 500);
  for (let p = 1; p < 6; p++) park(g, p);
  const H = pin(g);
  const st = stage(g.v);
  const ux = -H.nz, uz = H.nx, ang = Math.atan2(H.nz, H.nx);
  const reach = Math.sqrt(H.r ** 2 - (H.y - PLAT_Y - 1) ** 2);
  for (const w of [0, 0.6, reach - 0.05, reach + 0.05, -reach + 0.04, 2.5]) {
    cool(g, 0, H.i);
    put(g, 0, H.x - H.nx * 2 + ux * w, H.z - H.nz * 2 + uz * w, { vx: H.nx * 7, vz: H.nz * 7 });
    let mine = false, sims = 0;
    for (let k = 0; k < 70; k++) {
      const b0 = g.v.partier(0), p0 = [b0.pos[0], b0.pos[1] + 1, b0.pos[2]];
      const k0 = g.v.fxCount();
      g.step([[L.EV_INPUT, 0, word(ang)]]);
      const b1 = g.v.partier(0), p1 = [b1.pos[0], b1.pos[1] + 1, b1.pos[2]];
      if (through(st, st.hoops[H.i], g.v.party().t - 1, p0, p1)) mine = true;
      sims += fxs(g.v, MC.HO_FX_SCORE, k0).length;
    }
    assert.equal(mine, sims === 1, `across by ${w.toFixed(2)}`);
    assert.equal(sims, Math.abs(w) < reach ? 1 : 0);
  }
  // the brain: the sea past the rim, the open court fine; and a ball set before a hoop threads it
  const { danger, goal, think } = hoopsMg.brain;
  const R = st.rad;
  assert.equal(danger(g.v, C + R + 0.5, C), 1);
  assert.equal(danger(g.v, C + 15, C), 0);
  assert.ok(danger(g.v, C + R - 1, C) > 0.3);
  const bot = { slot: 0, skill: 0.8, mem: {} };
  cool(g, 0, H.i);
  put(g, 0, H.x - H.nx * 7 + ux * 4, H.z - H.nz * 7 + uz * 4);
  const k0 = g.v.fxCount();
  for (let k = 0; k < 400 && fxs(g.v, MC.HO_FX_SCORE, k0).length === 0; k++) {
    const b = g.v.partier(0);
    bot.at = g.v.tick; bot.pos = [b.pos[0], b.pos[2]]; bot.vel = [b.vel[0], b.vel[2]];
    const w = think(g.v, b, bot, g.v.tick);
    assert.ok(w && Number.isFinite(w.yaw) && (w.move === 0 || w.move === 1) && (w.hop === 0 || w.hop === 1));
    g.step([[L.EV_INPUT, 0, partyWord({ yaw: Math.round(w.yaw / (2 * Math.PI) * 16384) & 16383, move: w.move, hop: w.hop })]]);
  }
  assert.equal(fxs(g.v, MC.HO_FX_SCORE, k0).length, 1, 'the brain threads the hoop');
  assert.ok(goal(g.v, g.v.partier(0), bot).every(Number.isFinite));
});
