import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty, partyBytes } from './helpers.mjs';
import { View, partyWord, PLAT_Y } from '../src/party-view.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { playParty } from '../tools/genparty.mjs';
import * as L from '../src/layout.mjs';
import coinsMg, { coins, coinAt, bumpers, jackpot, jackAt } from '../client/mg/coins.mjs';

const C = L.B_CX;
const TICK = 0.008;
const YL = Math.fround(PLAT_Y + L.CR_CY);

// A room of n balls on Coin Rush, on the debug build (a NaN traps), stepped into play unless asked not to.
async function room(n = 2, { play = true, seed = 7 } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_COINS + 1, true);
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
}
const score = (g, p) => g.dv.getUint16(rec(p) + L.PG_SCORE, true);
const setScore = (g, p, s) => g.dv.setUint16(rec(p) + L.PG_SCORE, s, true);
// The next step plays tick t into play (the clock moved; the round's end with it).
function at(g, t) {
  const now = g.v.tick;
  g.dv.setUint32(L.HDR_START, now - t, true);
  g.dv.setUint32(L.HDR_UNTIL, now - t + L.CR_LEN, true);
}
const playT = (g) => g.v.party().t;
const fxs = (v, kind, from = 0) => { const out = []; for (let k = from; k < v.fxCount(); k++) { const f = v.fx(k); if (f.kind === kind) out.push(f); } return out; };
const live = (g) => g.dv.getUint32(L.PG_H + L.CR_LIVE, true);
const R = (g) => g.dv.getFloat32(L.PG_H + L.CR_RAD, true);
// Coin record c as the sim keeps it.
const coinRec = (g, c) => {
  const a = L.PG_BIG + L.CR_COINS + c * L.CR_CSIZE, d = g.dv;
  return { c, x: d.getFloat32(a + L.CR_C_X, true), z: d.getFloat32(a + L.CR_C_Z, true), x0: d.getFloat32(a + L.CR_C_X0, true), y0: d.getFloat32(a + L.CR_C_Y0, true),
    z0: d.getFloat32(a + L.CR_C_Z0, true), h: d.getFloat32(a + L.CR_C_H, true), t0: d.getUint32(a + L.CR_C_T0, true), air: d.getUint16(a + L.CR_C_AIR, true),
    v: g.v.u8[a + L.CR_C_V], kind: g.v.u8[a + L.CR_C_KIND] };
};
const allCoins = (g) => { const out = []; for (let c = 0; c < L.CR_MAX; c++) { const k = coinRec(g, c); if (k.v) out.push(k); } return out; };
// Every coin gone, and coin c lying at (x, z) since a while, worth v (or as given).
function clearCoins(g) {
  g.sim.u8.fill(0, L.PG_BIG + L.CR_COINS, L.PG_BIG + L.CR_COINS + L.CR_MAX * L.CR_CSIZE);
  g.dv.setUint32(L.PG_H + L.CR_LIVE, 0, true);
}
// No more rain: the count of coins in told it's past CR_RAINCAP (nothing else reads it).
const noRain = (g) => g.dv.setUint32(L.PG_H + L.CR_LIVE, 1 << 20, true);
function putCoin(g, c, x, z, { v = 1, kind = L.CR_KRAIN, t0 = g.v.tick - 100, air = 10, x0 = x, y0 = YL, z0 = z, h = 0 } = {}) {
  const a = L.PG_BIG + L.CR_COINS + c * L.CR_CSIZE, d = g.dv;
  if (!g.v.u8[a + L.CR_C_V]) d.setUint32(L.PG_H + L.CR_LIVE, live(g) + 1, true);
  d.setFloat32(a + L.CR_C_X, x, true); d.setFloat32(a + L.CR_C_Z, z, true);
  d.setFloat32(a + L.CR_C_X0, x0, true); d.setFloat32(a + L.CR_C_Y0, y0, true); d.setFloat32(a + L.CR_C_Z0, z0, true); d.setFloat32(a + L.CR_C_H, h, true);
  d.setUint32(a + L.CR_C_T0, t0, true); d.setUint16(a + L.CR_C_AIR, air, true); d.setUint8(a + L.CR_C_V, v); d.setUint8(a + L.CR_C_KIND, kind);
}
// A way out from the centre to the rim clear of every bumper by 3 m: [ux, uz].
function clearWay(g) {
  const bs = bumpers(g.v), r = R(g);
  let best = null, room = -1;
  for (let a = 0; a < 360; a += 3) {
    const ux = Math.cos(a * Math.PI / 180), uz = Math.sin(a * Math.PI / 180);
    let m = Infinity;
    for (const b of bs) for (let s = 0; s <= r + 2; s += 0.5) m = Math.min(m, Math.hypot(C + ux * s - b.x, C + uz * s - b.z));
    if (m > room) { room = m; best = [ux, uz]; }
  }
  assert.ok(room > 4, `a clear way out (${room.toFixed(1)} m)`);
  return best;
}
// Does coin k lie at least CR_BR + 0.5 from every post's axis (where a ball can reach it, and it shows)?
const clearOfPosts = (g, k) => bumpers(g.v).every((b) => Math.hypot(k.x - b.x, k.z - b.z) >= L.CR_BR + 0.5 - 1e-3);
// The coins made on tick t of kind (rain coins land everywhere meanwhile).
const madeAt = (g, t, kind) => allCoins(g).filter((k) => k.t0 === t && k.kind === kind);
// The prediction against the confirmed world, as helpers.mjs's predicted(),
// for slot 0 of room g through `inputs`: its whole record bit for bit but
// PG_SCORE, which only the confirmed world's tick writes (a take or a loss
// arrives a round trip late, as a bump does) and the prediction carries as
// it found it. Returns how many it compared.
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

test('the stage for 1, 8, 64 and 256: a disc sized for the crowd, its bumpers on a sunflower, every ball on it clear of them', async () => {
  let last = 0;
  for (const n of [1, 8, 64, 256]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party();
    const rad = Math.min(L.CR_R0 + L.CR_RK * Math.sqrt(n), L.CR_RMAX);
    assert.equal(r.game, L.MG_COINS);
    assert.ok(Math.abs(r.size - rad) < 1e-4, `${r.size} m for ${n}`);
    assert.ok(r.size > last, 'grows with the crowd');
    last = r.size;
    assert.equal(R(g), r.size);
    assert.deepEqual([r.kind, r.len, r.floor, r.idle, r.drag, r.hop, r.respawn], [L.PK_SCORE, L.CR_LEN, PLAT_Y, Math.fround(L.CR_IDLE), Math.fround(Number(L.BPHYS.B_DRAG)), 6, 250]);
    const bs = bumpers(g.v);
    assert.equal(bs.length, Math.max(L.CR_NBMIN, Math.min(L.CR_NBMAX, Math.floor(Math.fround(r.size * r.size) / L.CR_BAREA))), `${bs.length} bumpers`);
    for (const b of bs) {
      assert.ok(Math.hypot(b.x - C, b.z - C) < r.size * L.CR_BRING, 'over the middle of the disc');
      assert.deepEqual([b.litAt, b.hits], [0, 0], 'lit');
      for (const o of bs) if (o !== b) assert.ok(Math.hypot(b.x - o.x, b.z - o.z) > 2 * L.CR_BR + 2.5, 'apart');
    }
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p);
      assert.equal(b.pos[1], PLAT_Y, 'on the floor');
      assert.ok(b.ground && !b.out);
      assert.ok(Math.hypot(b.pos[0] - C, b.pos[2] - C) <= r.size * L.CR_SPAWN + 1e-3, 'on the middle of the disc');
      for (const o of bs) assert.ok(Math.hypot(b.pos[0] - o.x, b.pos[2] - o.z) >= L.CR_BR + 1.5 - 1e-3, `${n}: P${p + 1} clear of the bumpers`);
    }
    assert.equal(live(g), 0, 'no coins before play');
  }
});

test('the rain: a wave every 0.256 s of a coin per 10 balls and one more, falling 18 m from rest onto the disc; 1 in 16 big', async () => {
  const g = await room(30, { seed: 3 });
  const waves = [];
  let seen = 0;
  const all = [];
  while (playT(g) <= 32 * 80) {
    const t = playT(g);
    g.step();
    const now = allCoins(g).filter((k) => k.t0 === g.v.tick - 1 && k.kind === L.CR_KRAIN);
    if (now.length) { waves.push([t, now.length]); all.push(...now); }
    seen++;
  }
  assert.ok(waves.length >= 79, `${waves.length} waves`);
  for (const [t, n] of waves) {
    assert.equal(t % L.CR_EVERY, 0, `a wave at ${t}`);
    assert.equal(n, 1 + Math.floor(30 / L.CR_RAINN));
  }
  for (const k of all) {
    assert.deepEqual([k.x0, k.z0, k.y0, k.air], [k.x, k.z, Math.fround(PLAT_Y + L.CR_RAINH), L.CR_RAINAIR]);
    assert.ok(Math.abs(k.h - (L.CR_RAINH - L.CR_CY) / 4) < 1e-5, 'falling from rest');
    assert.ok(Math.hypot(k.x - C, k.z - C) <= R(g) - L.CR_RIM + 1e-3, 'on the disc, in off the rim');
    assert.ok(clearOfPosts(g, k), 'out of the bumpers');
    assert.ok(k.v === 1 || k.v === L.CR_BIGV);
    // from rest: the first tenth of its fall is a hundredth of the height
    assert.ok(Math.abs(coinAt(k, k.t0 + k.air / 10)[1] - (k.y0 - (k.y0 - YL) / 100)) < 1e-3);
    assert.equal(coinAt(k, k.t0 + k.air)[1], YL);
  }
  const big = all.filter((k) => k.v === L.CR_BIGV).length / all.length;
  assert.ok(big > 1 / 40 && big < 1 / 8, `${(big * 100).toFixed(1)}% big`);
  // the frenzy: twice as often, richer
  at(g, L.CR_FRENZY);
  clearCoins(g);
  const fw = [], fall = [];
  while (playT(g) < L.CR_FRENZY + 16 * 60) {
    const t = playT(g);
    g.step();
    const now = allCoins(g).filter((k) => k.t0 === g.v.tick - 1 && k.kind === L.CR_KRAIN);
    if (now.length) { fw.push(t); fall.push(...now); }
  }
  assert.ok(fw.length >= 59 && fw.every((t) => t % L.CR_EVERYF === 0), `${fw.length} waves in the frenzy`);
  const fbig = fall.filter((k) => k.v === L.CR_BIGV).length / fall.length;
  assert.ok(fbig > 1 / 12 && fbig < 1 / 3, `${(fbig * 100).toFixed(1)}% big in the frenzy`);
  // no rain past CR_RAINCAP coins in: the rest kept for knocks, spills and jackpots
  clearCoins(g);
  for (let c = 0; c < L.CR_RAINCAP; c++) putCoin(g, c, C + 100, C, { t0: g.v.tick });
  for (let k = 0; k < 40; k++) g.step();
  assert.equal(allCoins(g).filter((k) => k.t0 > g.v.tick - 40).length, 0, 'none');
});

test('a coin lies 10 s where it fell, then goes', async () => {
  const g = await room(2);
  clearCoins(g);
  noRain(g);
  const t0 = g.v.tick;
  putCoin(g, 5, C + 3, C + 12, { t0, air: 50, x0: C + 3, y0: PLAT_Y + 10, z0: C + 12, h: 2 });
  while (g.v.tick < t0 + 50 + L.CR_LIFE) { g.step(); assert.equal(coinRec(g, 5).v, 1, `there ${g.v.tick - t0}`); }
  g.step();
  assert.equal(coinRec(g, 5).v, 0, 'gone');
});

test('taking: the first ball by slot that rolls within reach of a coin takes it, a big one worth 5; not one still high, nor one just knocked loose', async () => {
  const g = await room(3);
  clearCoins(g);
  noRain(g);
  const [ux, uz] = clearWay(g);
  const on = (s, side = 0) => [C + ux * s - uz * side, C + uz * s + ux * side];
  const r = R(g);
  // the other two parked by the rim at the far end
  put(g, 1, ...on(r - 3, 1.2));
  put(g, 2, ...on(r - 3, -1.2));
  // P1 rolls along the clear way at 6 m/s into a coin 5 m out
  const [cx, cz] = on(5);
  putCoin(g, 7, cx, cz);
  put(g, 0, ...on(1), { vx: ux * 6, vz: uz * 6 });
  const k0 = g.v.fxCount();
  let n = 0;
  while (coinRec(g, 7).v && n++ < 200) g.step([[L.EV_INPUT, 0, partyWord({ yaw: Math.round(Math.atan2(uz, ux) / (2 * Math.PI) * 16384) & 16383, move: 1 })]]);
  assert.equal(coinRec(g, 7).v, 0, 'taken');
  assert.equal(score(g, 0), 1);
  const b = g.v.partier(0);
  const d = Math.hypot(b.pos[0] - cx, b.pos[1] + 1 - YL, b.pos[2] - cz);
  assert.ok(d < 1 + L.CR_REACH && d > 1 + L.CR_REACH - 0.15, `taken at ${d.toFixed(2)} m, as it came within reach`);
  const [f] = fxs(g.v, L.CR_FX_TAKE, k0);
  assert.deepEqual([f.owner, f.shot, f.size, f.pos[1]], [0, 7, 1, YL]);
  assert.ok(Math.abs(f.pos[0] - cx) < 1e-4 && Math.abs(f.pos[2] - cz) < 1e-4);
  // two in reach on one tick: the lower slot's (P1 still now, its keys let go)
  put(g, 0, ...on(2));
  g.step([[L.EV_INPUT, 0, partyWord({})]]);
  put(g, 0, ...on(2));
  const [bx, bz] = on(8);
  putCoin(g, 9, bx, bz, { v: L.CR_BIGV });
  put(g, 2, ...on(8, 0.9));
  put(g, 1, ...on(8, -0.9));
  g.step();
  assert.deepEqual([coinRec(g, 9).v, score(g, 1), score(g, 2)], [0, L.CR_BIGV, 0], 'P2, not P3');
  // a coin falling over a ball isn't in reach till it's low
  put(g, 2, ...on(r - 3, -1.2));
  put(g, 1, bx, bz);
  const t0 = g.v.tick;
  putCoin(g, 11, bx, bz, { t0, air: L.CR_RAINAIR, y0: PLAT_Y + L.CR_RAINH, h: (L.CR_RAINH - L.CR_CY) / 4 });
  const drop = coinRec(g, 11);
  while (coinRec(g, 11).v) {
    g.step();
    if (coinRec(g, 11).v) assert.ok(coinAt(drop, g.v.tick - 1)[1] > PLAT_Y + 1 + 1 + L.CR_REACH - 0.01, 'still out of reach');
  }
  const caught = g.v.tick - 1 - t0;
  assert.ok(caught > L.CR_RAINAIR - 20 && caught < L.CR_RAINAIR, `caught ${caught} ticks into its fall`);
  assert.ok(coinAt(drop, g.v.tick - 1)[1] < PLAT_Y + 1 + 1 + L.CR_REACH, 'as it came within reach');
  assert.equal(score(g, 1), L.CR_BIGV + 1);
  // knocked loose: anyone's only CR_LOOSE ticks after it was thrown
  const t1 = g.v.tick;
  putCoin(g, 12, bx, bz, { t0: t1, air: 70, kind: L.CR_KLOOSE });
  while (coinRec(g, 12).v) g.step();
  assert.equal(g.v.tick - 1 - t1, L.CR_LOOSE);
});
test('a hard bump knocks up to 3 of the hit ball\'s coins loose to land a few metres off; the hitter keeps its own; a soft one, or one too soon after, knocks none', async () => {
  const g = await room(2);
  clearCoins(g);
  noRain(g);
  const [ux, uz] = clearWay(g);
  const on = (s) => [C + ux * s, C + uz * s];
  setScore(g, 0, 10);
  setScore(g, 1, 10);
  // P1 rams P2 at speed v in toward the middle along the clear way; P2 still, 6 m out
  const ram = (v, gap = 2.3) => {
    clearCoins(g);
    noRain(g);
    put(g, 1, ...on(6));
    put(g, 0, ...on(6 + gap), { vx: -ux * v, vz: -uz * v });
    const k = g.v.fxCount();
    for (let n = 0; n < 8; n++) g.step();
    return fxs(g.v, L.CR_FX_LOSE, k);
  };
  const [f, ...more] = ram(10);
  assert.equal(more.length, 0);
  assert.equal(score(g, 0), 10, 'the hitter keeps its coins');
  assert.equal(score(g, 1), 7, 'three knocked loose');
  assert.deepEqual([f.owner, f.shot, f.size], [1, 3, 0]);
  const loose = allCoins(g);
  assert.equal(loose.length, 3);
  for (const k of loose) {
    assert.deepEqual([k.kind, k.v, k.t0, k.x0, k.z0], [L.CR_KLOOSE, 1, f.tick, f.pos[0], f.pos[2]]);
    const d = Math.hypot(k.x - k.x0, k.z - k.z0);
    assert.ok(d >= L.CR_KNOCKR0 - 1e-3 && d <= Math.hypot(L.CR_KNOCKR0 + L.CR_KNOCKRK, L.CR_KNOCKR0 + L.CR_KNOCKRK), `${d.toFixed(2)} m off`);
  }
  // hit again at once: the grace
  assert.equal(ram(10).length, 0);
  assert.equal(score(g, 1), 7, 'nothing more inside CR_GRACE');
  for (let k = 0; k < L.CR_GRACE; k++) g.step();
  // 5 m/s: one coin
  assert.equal(ram(5, 2.1).length, 1);
  assert.equal(score(g, 1), 6, 'one at 5 m/s');
  for (let k = 0; k < L.CR_GRACE; k++) g.step();
  // 2.5 m/s: a bump, not a hard one: none
  const k1 = g.v.fxCount();
  assert.equal(ram(2.5, 2.05).length, 0);
  assert.equal(score(g, 1), 6, 'none at 2.5 m/s');
  assert.ok(fxs(g.v, L.FX_BUMP, k1).length === 0 && g.dv.getUint16(rec(1) + L.B_HITT, true) > 0, 'a bump, not a hard one');
  // a ball with no coins loses none and throws none
  for (let k = 0; k < L.CR_GRACE; k++) g.step();
  setScore(g, 1, 0);
  assert.equal(ram(10).length, 0);
  assert.equal(allCoins(g).length, 0);
});

test('a post\'s throw is no hard bump: a ball thrown off a post on the tick another touches it softly keeps its coins', async () => {
  const g = await room(3);
  clearCoins(g);
  noRain(g);
  const [b] = bumpers(g.v);
  g.dv.setUint32(L.PG_S + L.CR_BUMP + 8, 1 << 30, true); // dark: no pay
  const rr = L.CR_BR + 1;
  // P1 rolling into the post at 5 m/s, a hair off it; P2 alongside, rolling into P1 at 1 m/s
  const go = (v0, touch) => {
    put(g, 0, b.x - rr - 0.02, b.z, { vx: v0 });
    if (touch) put(g, 1, b.x - rr - 0.02, b.z + 1.98, { vz: -1 });
    else put(g, 1, b.x - 20, b.z + 20);
    put(g, 2, b.x - 20, b.z - 20);
    for (const p of [0, 1]) {
      const a = L.PG_S + L.CR_BALL + p * L.CR_BSIZE;
      g.dv.setFloat32(a + L.CR_B_VX, g.dv.getFloat32(rec(p) + L.P_VX, true), true);
      g.dv.setFloat32(a + L.CR_B_VZ, g.dv.getFloat32(rec(p) + L.P_VZ, true), true);
      g.dv.setUint16(a + L.CR_B_BUMPS, g.dv.getUint16(rec(p) + L.B_BUMPS, true), true);
      g.dv.setUint32(a + L.CR_B_SAFE, 0, true);
    }
    setScore(g, 0, 10);
    const bumps = [0, 1].map((p) => g.v.partier(p).bumps);
    const k = g.v.fxCount();
    g.step();
    return { lost: fxs(g.v, L.CR_FX_LOSE, k).length, thrown: (g.v.partier(0).m & 15) === 1 && g.v.partier(0).m >>> 4 === ((g.v.tick - 1) & 0x0fffffff),
      hit: g.v.partier(0).hitFor === L.CREDIT_TICKS - 1, hard: [0, 1].some((p) => g.v.partier(p).bumps !== bumps[p]) };
  };
  const both = go(5, true);
  assert.deepEqual([both.thrown, both.hit, both.hard], [true, true, false], 'thrown off the post, and a soft touch on the same tick');
  assert.deepEqual([both.lost, score(g, 0)], [0, 10], 'no coin knocked loose');
  const post = go(5, false);
  assert.deepEqual([post.thrown, post.hit, post.lost, score(g, 0)], [true, false, 0, 10], 'the post alone');
  const touch = go(0, true);
  assert.deepEqual([touch.hit, touch.lost, score(g, 0)], [true, 0, 10], 'the soft touch alone');
});

test('no coin lands in a bumper, where no ball reaches it or sees it: a jackpot\'s fountain over one, coins knocked loose against one', async () => {
  const g = await room(30, { seed: 9 });
  const bs = bumpers(g.v);
  // the fountain: a jackpot called right on a post's axis
  clearCoins(g);
  noRain(g);
  for (let p = 0; p < 30; p++) put(g, p, C + 300 + 3 * p, C, { y: PLAT_Y + 50, ground: false });
  g.dv.setFloat32(L.PG_H + L.CR_JX, bs[0].x, true);
  g.dv.setFloat32(L.PG_H + L.CR_JZ, bs[0].z, true);
  g.dv.setUint32(L.PG_H + L.CR_JK, 1, true);
  at(g, L.CR_JACK0);
  g.step();
  const jack = allCoins(g).filter((k) => k.kind === L.CR_KJACK);
  assert.equal(jack.length, L.CR_JACKN0 + 30 / L.CR_JACKNK);
  assert.ok(jack.every((k) => clearOfPosts(g, k)), 'the fountain\'s coins out of the post');
  // knocks: P1 still by bumper 1, rammed by P2 from outside it at 10 m/s, again and again
  const [b] = bs.slice(1);
  const ux = (b.x - C) / Math.hypot(b.x - C, b.z - C), uz = (b.z - C) / Math.hypot(b.x - C, b.z - C);
  assert.ok(Math.hypot(b.x - C, b.z - C) + L.CR_BR + 1 + 0.3 + 2.3 < R(g) - 2, 'room outside it');
  g.dv.setUint32(L.PG_S + L.CR_BUMP + 16 + 8, 1 << 30, true); // dark: no pay
  let knocked = 0;
  for (let k = 0; k < 20; k++) {
    clearCoins(g);
    noRain(g);
    const a = L.CR_BR + 1 + 0.3;
    for (let p = 2; p < 30; p++) put(g, p, C + 300 + 3 * p, C, { y: PLAT_Y + 50, ground: false });
    put(g, 0, b.x + ux * a, b.z + uz * a);
    put(g, 1, b.x + ux * (a + 2.3), b.z + uz * (a + 2.3), { vx: -ux * 10, vz: -uz * 10 });
    setScore(g, 0, 10);
    g.dv.setUint32(L.PG_S + L.CR_BALL + L.CR_B_SAFE, 0, true);
    for (let n = 0; n < 6; n++) g.step();
    const loose = allCoins(g).filter((c) => c.kind === L.CR_KLOOSE);
    knocked += loose.length;
    for (const c of loose) assert.ok(clearOfPosts(g, c), `knock ${k}: (${c.x.toFixed(2)}, ${c.z.toFixed(2)}) out of the posts`);
  }
  assert.ok(knocked >= 40, `${knocked} coins knocked loose`);
});

test('off the rim: half your coins gone, spilled back in where you went over as big coins and small; down 2 s, back with the rest', async () => {
  const g = await room(2);
  clearCoins(g);
  noRain(g);
  const [ux, uz] = clearWay(g);
  const r = R(g);
  setScore(g, 0, 23);
  put(g, 0, C + ux * (r - 1), C + uz * (r - 1), { vx: ux * 6, vz: uz * 6 });
  put(g, 1, C - ux * 3, C - uz * 3);
  const k0 = g.v.fxCount();
  let n = 0;
  while (!g.v.partier(0).falling && n++ < 100) g.step();
  assert.ok(g.v.partier(0).falling, 'over the rim');
  assert.equal(score(g, 0), 23 - 11, 'half gone (rounded down), on the tick it starts to fall');
  const [f] = fxs(g.v, L.CR_FX_LOSE, k0);
  assert.deepEqual([f.owner, f.shot, f.size], [0, 11, 1]);
  assert.ok(Math.abs(Math.hypot(f.pos[0] - C, f.pos[2] - C) - (r - 0.3)) < 1e-3, 'from the rim');
  assert.ok((f.pos[0] - C) * ux + (f.pos[2] - C) * uz > r - 0.4, 'where it went over');
  const spilt = allCoins(g);
  assert.deepEqual(spilt.map((k) => k.v).sort(), [1, 5, 5], 'two big and one small: all 11');
  for (const k of spilt) {
    assert.deepEqual([k.kind, k.t0, k.x0, k.z0], [L.CR_KLOOSE, f.tick, f.pos[0], f.pos[2]]);
    assert.ok(Math.hypot(k.x - C, k.z - C) <= r - L.CR_RIM + 1e-3, 'back on the disc');
    assert.ok(Math.hypot(k.x - f.pos[0], k.z - f.pos[2]) < 9, 'near where it went');
  }
  // one spill a fall
  for (let k = 0; k < 20; k++) g.step();
  assert.equal(fxs(g.v, L.CR_FX_LOSE, k0).length, 1);
  while (!g.v.partier(0).out) g.step();
  const t0 = g.v.tick - 1;
  while (g.v.partier(0).out) g.step();
  assert.equal(g.v.tick - 1 - t0, 250, 'down 2 s');
  assert.equal(score(g, 0), 12, 'back with the rest');
  // a rich ball: at most CR_SPILLMAX coins of it come back; one with 1 coin spills nothing
  clearCoins(g);
  noRain(g);
  setScore(g, 0, 200);
  put(g, 0, C + ux * (r - 1), C + uz * (r - 1), { vx: ux * 6, vz: uz * 6 });
  while (!g.v.partier(0).falling) g.step();
  assert.equal(score(g, 0), 100);
  assert.deepEqual(allCoins(g).map((k) => k.v), Array(L.CR_SPILLMAX).fill(5), '60 of the 100 back, the rest the sea\'s');
  while (g.v.partier(0).out || g.v.partier(0).falling || !g.v.partier(0).ground) g.step();
  clearCoins(g);
  noRain(g);
  setScore(g, 0, 1);
  put(g, 0, C + ux * (r - 1), C + uz * (r - 1), { vx: ux * 6, vz: uz * 6 });
  while (!g.v.partier(0).falling) g.step();
  assert.deepEqual([score(g, 0), allCoins(g).length], [1, 0]);
});

test('bumpers: one rolled into throws the ball off at 8 m/s or more; a lit one pays 3 once and goes dark for 5 s', async () => {
  const g = await room(2);
  clearCoins(g);
  noRain(g);
  const [b] = bumpers(g.v);
  const dx = b.x - C, dz = b.z - C, d = Math.hypot(dx, dz), ux = dx / d, uz = dz / d;
  const [wx, wz] = clearWay(g);
  put(g, 1, C + wx * 8, C + wz * 8);
  // P1 rolls at 5 m/s straight at bumper 0's middle
  const go = () => put(g, 0, b.x - ux * (L.CR_BR + 2), b.z - uz * (L.CR_BR + 2), { vx: ux * 5, vz: uz * 5 });
  go();
  const k0 = g.v.fxCount();
  let n = 0;
  while (!fxs(g.v, L.CR_FX_BUMP, k0).length && n++ < 60) g.step();
  const [f] = fxs(g.v, L.CR_FX_BUMP, k0);
  assert.deepEqual([f.owner, f.shot], [0, 0]);
  assert.ok(f.size >= L.CR_KICK);
  const p = g.v.partier(0);
  const out = Math.hypot(p.pos[0] - b.x, p.pos[2] - b.z);
  assert.ok(out >= L.CR_BR + 1, `outside it (${out.toFixed(3)} m)`);
  const vn = (p.vel[0] * (p.pos[0] - b.x) + p.vel[2] * (p.pos[2] - b.z)) / out;
  assert.ok(vn >= L.CR_KICK - 0.2, `thrown off at ${vn.toFixed(2)} m/s`);
  assert.equal(score(g, 0), L.CR_BPAY, 'paid');
  const tp = playT(g) - 1;
  assert.equal(bumpers(g.v)[0].litAt, tp + L.CR_BDARK, 'dark');
  assert.equal(bumpers(g.v)[0].hits, 1);
  const pay = fxs(g.v, L.CR_FX_TAKE, k0);
  assert.deepEqual(pay.map((x) => [x.owner, x.shot, x.size]), [[0, L.CR_MAX, L.CR_BPAY]]);
  // again at once: thrown, not paid
  go();
  n = 0;
  const k1 = g.v.fxCount();
  while (!fxs(g.v, L.CR_FX_BUMP, k1).length && n++ < 60) g.step();
  assert.ok(fxs(g.v, L.CR_FX_BUMP, k1).length);
  assert.equal(score(g, 0), L.CR_BPAY, 'dark: no pay');
  // lit again 5 s on
  while (playT(g) < tp + L.CR_BDARK) g.step();
  go();
  n = 0;
  while (score(g, 0) === L.CR_BPAY && n++ < 60) g.step();
  assert.equal(score(g, 0), 2 * L.CR_BPAY, 'paid again');
});

test('the clock: five jackpots called 3 s ahead at spots clear of the bumpers, each a fountain of coins; the frenzy at 60 s; placed by coins at 75 s', async () => {
  const g = await room(3, { seed: 5 });
  const calls = [];
  let seen = g.v.fxCount();
  let erupted = null;
  while (g.v.party().state === L.H_PLAY) {
    // nobody takes anything: the balls high over the stage, held there
    for (let p = 0; p < 3; p++) put(g, p, C + 30 * (p + 1), C, { y: PLAT_Y + 50, ground: false });
    const t = playT(g);
    g.step();
    for (; seen < g.v.fxCount(); seen++) {
      const f = g.v.fx(seen);
      if (f.kind !== L.CR_FX_CALL) continue;
      calls.push([t, f.shot, f.size]);
      if (f.shot === 0) {
        const r = R(g);
        assert.ok(Math.hypot(f.pos[0] - C, f.pos[2] - C) <= r * L.CR_JACKIN + 1e-3, 'over the middle');
        for (const b of bumpers(g.v)) assert.ok(Math.hypot(f.pos[0] - b.x, f.pos[2] - b.z) >= L.CR_BR + 2 - 1e-3, 'clear of the bumpers');
        assert.deepEqual([g.dv.getFloat32(L.PG_H + L.CR_JX, true), g.dv.getFloat32(L.PG_H + L.CR_JZ, true)], [f.pos[0], f.pos[2]]);
        const jp = jackpot(g.v, t);
        assert.ok(jp.called && jp.at === t + L.CR_JACKW, 'the client sees it called');
      }
      if (f.shot === 1 && !erupted) {
        erupted = allCoins(g).filter((k) => k.kind === L.CR_KJACK);
        const n = L.CR_JACKN0 + Math.floor(3 / L.CR_JACKNK);
        assert.equal(f.size, n);
        assert.equal(erupted.length, n);
        const r = L.CR_JACKR0 + L.CR_JACKRK * Math.sqrt(n);
        erupted.forEach((k, i) => {
          assert.deepEqual([k.x0, k.z0], [f.pos[0], f.pos[2]], 'thrown up from its spot');
          assert.ok(Math.hypot(k.x - f.pos[0], k.z - f.pos[2]) <= r + 1e-3, 'landing round it');
          assert.ok(k.t0 >= f.tick && k.t0 < f.tick + L.CR_JACKSPAN, 'over CR_JACKSPAN');
        });
        assert.equal(erupted.filter((k) => k.v === L.CR_BIGV).length, Math.floor(n / L.CR_JACKBIG));
      }
    }
  }
  const want = [];
  for (let j = 0; jackAt(j) < L.CR_LEN; j++) want.push([jackAt(j) - L.CR_JACKW, 0, 0], [jackAt(j), 1, L.CR_JACKN0]);
  want.push([L.CR_FRENZY, 2, 0]);
  want.sort((a, b) => a[0] - b[0]);
  assert.deepEqual(calls, want);
  assert.equal(want.filter((c) => c[1] === 1).length, 5, 'five jackpots');
  assert.equal(g.v.party().state, L.H_OVER, 'over at the time');
  assert.equal(g.v.party().t, L.CR_LEN + 1);
});

test('placing: by coins when the clock runs out, ties sharing', async () => {
  const g = await room(4);
  clearCoins(g);
  noRain(g);
  at(g, L.CR_LEN - 2);
  for (const [p, s] of [[0, 12], [1, 40], [2, 12], [3, 3]]) setScore(g, p, s);
  // still, in the middle, clear of the bumpers and each other
  for (let p = 0; p < 4; p++) put(g, p, C + 2.5 * Math.cos(p * Math.PI / 2), C + 2.5 * Math.sin(p * Math.PI / 2));
  while (g.v.party().state === L.H_PLAY) g.step();
  const r = g.v.party();
  assert.equal(r.state, L.H_OVER);
  assert.equal(r.winner, 1);
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.partier(p).place), [2, 1, 2, 4]);
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.partier(p).pts), [7, 10, 7, 1]);
});

test('the prediction matches the confirmed ball bit for bit (but its score): thrown off a bumper, hopping, rolling over coins, off the rim', async () => {
  const g = await room(2, { seed: 11 });
  const [b] = bumpers(g.v);
  const dx = b.x - C, dz = b.z - C, d = Math.hypot(dx, dz), ux = dx / d, uz = dz / d;
  const [wx, wz] = clearWay(g);
  const yaw = (x, z) => Math.round(Math.atan2(z, x) / (2 * Math.PI) * 16384) & 16383;
  // P2 out of everyone's way, far along the clear way
  put(g, 1, C + wx * (R(g) - 3), C + wz * (R(g) - 3));
  // A: from the middle at bumper 0 and thrown back off it, coasting (the brake), hopping, through the rain
  put(g, 0, C, C);
  const words = [...Array(110).fill(partyWord({ yaw: yaw(ux, uz), move: 1 })),
    ...Array.from({ length: 200 }, (_, k) => partyWord({ yaw: yaw(ux, uz), hop: k % 60 === 20 ? 1 : 0 }))];
  const k0 = g.v.fxCount();
  assert.ok(predicted(g, words) >= words.length);
  assert.ok(fxs(g.v, L.CR_FX_BUMP, k0).some((f) => f.owner === 0), 'thrown off a bumper');
  // B: coins strewn on its way along the clear way, taken as it rolls, hopping (the score the confirmed world's alone)
  clearCoins(g);
  noRain(g);
  put(g, 1, C - wx * 3, C - wz * 3);
  put(g, 0, C, C);
  for (let k = 0; k < 8; k++) putCoin(g, 20 + k, C + wx * (1.5 + 1.2 * k), C + wz * (1.5 + 1.2 * k));
  const s0 = score(g, 0);
  const go = partyWord({ yaw: yaw(wx, wz), move: 1 });
  const roll = Array.from({ length: 220 }, (_, k) => (k === 150 ? partyWord({ yaw: yaw(wx, wz), move: 1, hop: 1 }) : go));
  assert.ok(predicted(g, roll) >= roll.length);
  assert.equal(score(g, 0), s0 + 8, 'took all 8 on the way');
  // C: and on over the rim, falling (not yet down: the down, like a bump, is the confirmed world's)
  let n = 0;
  while (!g.v.partier(0).falling && n++ < 40) assert.ok(predicted(g, Array(10).fill(go)) >= 10);
  assert.ok(predicted(g, Array(60).fill(go)) >= 60);
  const p = g.v.partier(0);
  assert.ok(p.falling && !p.out, 'off the rim, falling');
  assert.equal(score(g, 0), (s0 + 8) - ((s0 + 8) >> 1), 'and half of it gone');
});

// Rounds of AI balls (client/party-bot.mjs, this brain), as tools/genparty.mjs plays them.
for (const [balls, ticks] of [[8, 10400], [64, 10500]]) {
  test(`a round of ${balls} AI balls on the debug build: no trap, coins taken all round, placed by them at the time; equal on 1 and 4 threads`, async () => {
    const stats = { start: -1, over: -1, takes: 0, takers: new Set(), lost: 0, pays: 0, jacks: 0, places: null, scores: null, pts: null };
    let seen = 0;
    const { log, sim, view } = await playParty({ bytes: partyBytes(true), mg: L.MG_COINS, seed: balls, bots: balls, ticks, delay: 8, onTick: (t, s, v) => {
      assert.equal(s.error().code, 0, 'no trap');
      for (; seen < v.fxCount(); seen++) {
        const f = v.fx(seen);
        if (f.kind === L.CR_FX_TAKE && f.shot < L.CR_MAX) { stats.takes++; stats.takers.add(f.owner); }
        if (f.kind === L.CR_FX_TAKE && f.shot >= L.CR_MAX) stats.pays++;
        if (f.kind === L.CR_FX_LOSE) stats.lost += f.shot;
        if (f.kind === L.CR_FX_CALL && f.shot === 1) stats.jacks++;
      }
      const g = v.party();
      if (stats.start < 0 && g.state === L.H_PLAY) stats.start = t;
      if (stats.over < 0 && stats.start >= 0 && g.state === L.H_OVER) {
        stats.over = t;
        const all = [...Array(balls).keys()].map((p) => v.partier(p));
        stats.places = all.map((b) => b.place);
        stats.scores = all.map((b) => b.score);
        stats.pts = all.map((b) => b.pts);
      }
    } });
    assert.equal(sim.error().code, 0);
    assert.ok(stats.over > 0, 'the round ended');
    assert.equal(stats.over - stats.start, L.CR_LEN, 'at the time');
    assert.ok(stats.takes > balls * 10, `${stats.takes} coins taken`);
    assert.equal(stats.takers.size, balls, 'by every ball');
    assert.equal(stats.jacks, 5);
    assert.ok(stats.pays > 5 && stats.lost > 0, `${stats.pays} bumper pays, ${stats.lost} coins lost`);
    const sorted = [...stats.scores].sort((a, b) => b - a);
    assert.ok(sorted[0] > sorted.at(-1) + 5, `scores ${sorted}`);
    stats.scores.forEach((s, p) => assert.equal(stats.places[p], 1 + stats.scores.filter((o) => o > s).length, 'placed by coins'));
    assert.ok(stats.pts.every((x) => x >= 1 && x <= 10) && stats.pts.includes(10), `points ${stats.pts}`);
    assert.equal(view.party().game, L.MG_COINS);
    const parsed = parseLog(log);
    const n = stats.over + 50;
    const a = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 1, tag: 't1' });
    const b = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 4, tag: 't4', startWorkers });
    const d = await replay({ bytes: partyBytes(true), log: parsed, ticks: n, threads: 1, tag: 'd1' });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(d.trace).tickHashes], 'the debug build steps the same bits');
  });
}

test('the client module: draws every phase, frames the disc, writes its HUD lines; its coins are where the sim takes them, its brain sees the rim', async () => {
  const { Scene } = await import('../client/party-render.mjs');
  assert.equal(L.CR_FX_TAKE, L.FX_MG + 4 * L.MG_COINS);
  assert.deepEqual([L.CR_FX_LOSE, L.CR_FX_CALL, L.CR_FX_BUMP], [L.CR_FX_TAKE + 1, L.CR_FX_TAKE + 2, L.CR_FX_TAKE + 3]);
  assert.ok(coinsMg.hint.length <= 70);
  assert.equal(coinsMg.id, L.MG_COINS);
  const g = await room(6, { seed: 41, play: false });
  const out = () => ({ scene: new Scene(24000), solid: [], glow: [], beams: [], decals: [], casters: [], paint: null });
  const lines = [];
  const hctx = (o = {}) => ({ put: (x, y, s, c) => lines.push([y, s, c]), centre: (y, s, c) => lines.push([y, s, c]), right: (y, s, c) => lines.push([y, s, c]), rows: 44, C: {}, slot: 0, now: 0, ...o });
  const check = (o) => {
    assert.ok(o.scene.count > 4, `${o.scene.count} solids`);
    for (let k = 0; k < o.scene.count * 16; k++) assert.ok(Number.isFinite(o.scene.data[k]), 'finite');
    for (const s of [...o.solid, ...o.glow]) assert.ok(s.pos.every(Number.isFinite) && Number.isFinite(s.size));
    for (const d of o.decals) assert.ok(d.pos.every(Number.isFinite) && d.radius > 0);
  };
  // the countdown
  let o = out();
  coinsMg.draw(g.v, { tick: g.v.tick, dt: 0, now: 0, slot: 0 }, o);
  check(o);
  assert.equal(coinsMg.env, 'sunset');
  while (g.v.hole().state !== L.H_PLAY) g.step();
  // play: a jackpot called, coins falling and lying
  at(g, L.CR_JACK0 - L.CR_JACKW - 1);
  for (let k = 0; k < 160; k++) g.step();
  o = out();
  lines.length = 0;
  coinsMg.draw(g.v, { tick: g.v.tick, dt: 0, ptick: g.v.tick, now: 1000, slot: 0, pme: g.v.partier(0) }, o);
  check(o);
  assert.ok(o.solid.filter((s) => s.kind === 10).length >= 4, 'coins');
  assert.equal(o.beams.length, 1, 'the jackpot\'s beam');
  assert.ok(o.casters.length > 0, 'falling coins\' shadows');
  coinsMg.hud(g.v, hctx({ t: g.v.party().t * TICK, me: g.v.partier(0) }));
  const text = lines.map((l) => l[1]).join(' | ');
  assert.ok(/JACKPOT IN \d\.\d/.test(text) && /FRENZY IN/.test(text) && /OF 6/.test(text), text);
  for (const l of lines) assert.ok(l[1].length <= 80);
  // the frenzy: night
  at(g, L.CR_FRENZY + 10);
  g.step();
  o = out();
  coinsMg.draw(g.v, { tick: g.v.tick, dt: 0, ptick: g.v.tick, now: 2000, slot: 0 }, o);
  assert.equal(coinsMg.env, 'night');
  const fr = coinsMg.frame(g.v);
  assert.deepEqual([fr.shape, fr.radius, fr.centre], ['disc', R(g), [C, PLAT_Y, C]]);
  // coinAt is $cr_at: a coin thrown at a still ball is taken in flight where the mirror has it on that tick
  clearCoins(g);
  at(g, 500);
  let seen = g.v.fxCount(), checked = 0;
  for (let round = 0; round < 5; round++) {
    const thrown = [];
    for (let p = 0; p < 6; p++) {
      const bx = C + 4 * Math.cos(p * 1.05), bz = C + 4 * Math.sin(p * 1.05);
      put(g, p, bx, bz);
      putCoin(g, 30 + p, bx + 0.4, bz, { t0: g.v.tick, air: 40 + 7 * p, x0: bx + 4, y0: PLAT_Y + 2.5 + round, z0: bz - 1, h: 1.5, kind: L.CR_KRAIN });
      thrown.push(coinRec(g, 30 + p));
    }
    for (let k = 0; k < 90; k++) g.step();
    for (; seen < g.v.fxCount(); seen++) {
      const f = g.v.fx(seen);
      if (f.kind !== L.CR_FX_TAKE || f.shot >= L.CR_MAX) continue;
      const k0 = thrown.find((c) => c.c === f.shot);
      if (!k0) continue;
      const p = coinAt(k0, f.tick);
      assert.ok(f.tick - k0.t0 < k0.air, 'in flight');
      for (let i = 0; i < 3; i++) assert.ok(Math.abs(p[i] - f.pos[i]) < 1e-3, `coin ${f.shot} at ${p} vs ${f.pos}`);
      checked++;
    }
  }
  assert.ok(checked >= 25, `${checked} takes checked`);
  // the brain: the sea past the rim, nothing in the middle
  const { danger, goal, think } = coinsMg.brain;
  const r = R(g);
  assert.equal(danger(g.v, C + r + 0.5, C), 1);
  assert.equal(danger(g.v, C, C + 0.2), 0);
  assert.ok(danger(g.v, C + r - 1, C) > 0.2);
  const word = think(g.v, 0, { slot: 0, skill: 0.8, at: g.v.tick, pos: [g.v.partier(0).pos[0], g.v.partier(0).pos[2]], vel: [0, 0] });
  assert.ok(word && Number.isFinite(word.yaw) && (word.move === 0 || word.move === 1));
  assert.ok(goal(g.v, 0, { slot: 0, skill: 0.8, at: g.v.tick + 4 }).every(Number.isFinite));
});
