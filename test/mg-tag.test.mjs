import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty, partyBytes, predicted } from './helpers.mjs';
import { View, partyWord, PLAT_Y } from '../src/party-view.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { playParty } from '../tools/genparty.mjs';
import tag, { stage, isIt } from '../client/mg/tag.mjs';
import * as L from '../src/layout.mjs';

const C = L.B_CX;
const TICK = 0.008;
const IT = L.TG_M_IT | L.TG_M_IN, FREE = L.TG_M_IN;
const N = (k) => Math.fround(Number(L.BPHYS[k]));

// A room of n balls on Tag, on the debug build (a NaN traps), stepped into
// play unless asked not to; with clean, no pillars (a bare walled disc).
async function room(n = 3, { play = true, seed = 7, clean = false } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_TAG + 1, true);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); assert.equal(sim.error().code, 0, 'no trap'); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  while (play && v.hole().state !== L.H_PLAY) step();
  if (clean) dv.setUint32(L.PG_H + L.TG_NP, 0, true);
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
// Slot p's PG_M (it or free, and the tick of its last tag), and its points.
const mark = (g, p, m, at = 0) => g.dv.setUint32(rec(p) + L.PG_M, m | (at << 8), true);
const role = (g, p) => g.v.partier(p).m & IT;
// The next step plays tick t into play (the clock moved, the round's end with it).
function at(g, t) {
  const now = g.v.tick;
  g.dv.setUint32(L.HDR_START, now - t, true);
  g.dv.setUint32(L.HDR_UNTIL, now - t + L.TG_LEN, true);
}
const playT = (g) => g.v.party().t;
const fxs = (v, kind) => { const out = []; for (let k = 0; k < v.fxCount(); k++) { const f = v.fx(k); if (f.kind === kind) out.push(f); } return out; };
const pillars = (g) => Array.from({ length: g.dv.getUint32(L.PG_H + L.TG_NP, true) }, (_, k) => [g.dv.getFloat32(L.PG_S + L.TG_PILL + 8 * k, true), g.dv.getFloat32(L.PG_S + L.TG_PILL + 8 * k + 4, true)]);

test('the stage for 1, 8, 64 and 256: a walled disc sized for the crowd, its pillars, one it in 16 in the middle, the free round them', async () => {
  let last = 0;
  for (const n of [1, 8, 64, 256]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party();
    const rad = Math.min(L.TG_R0 + L.TG_RK * Math.sqrt(n), L.TG_RMAX);
    assert.equal(r.game, L.MG_TAG);
    assert.ok(Math.abs(r.size - rad) < 1e-4, `${r.size} m for ${n}`);
    assert.ok(r.size > last, 'grows with the crowd');
    last = r.size;
    assert.deepEqual([r.kind, r.len, r.floor], [L.PK_SCORE, L.TG_LEN, PLAT_Y]);
    assert.equal(g.dv.getFloat32(L.PG_H + L.TG_RAD, true), r.size);
    const ps = pillars(g);
    assert.equal(ps.length, Math.min(L.TG_PMAX, Math.floor(Math.fround(r.size * r.size) / L.TG_PAREA)));
    for (const [x, z] of ps) {
      const d = Math.hypot(x - C, z - C);
      assert.ok(d > r.size * L.TG_PIN - 1e-3 && d < r.size * L.TG_POUT + 1e-3, `a pillar ${d.toFixed(1)} m out`);
    }
    const its = n < 2 ? 0 : Math.max(1, Math.round(n / L.TG_PER));
    assert.equal(g.dv.getUint32(L.PG_H + L.TG_NIT, true), its);
    let dealt = 0;
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p);
      const it = g.v.u8[L.PG_S + L.TG_ROLE + p] === 1;
      dealt += it;
      assert.equal(isIt(g.v, p), it, 'the client reads the deal in the countdown');
      assert.ok(b.ground && !b.out && b.pos[1] === PLAT_Y, 'on the floor');
      assert.equal(b.m, 0, 'nobody marked before play');
      const d = Math.hypot(b.pos[0] - C, b.pos[2] - C);
      if (it) assert.ok(d <= r.size * L.TG_ITR + 1e-3, `${n}: an it in the middle (${d.toFixed(1)} m)`);
      else assert.ok(d >= r.size * L.TG_FIN - 1e-3 && d <= r.size * L.TG_FOUT + 1e-3, `${n}: a free ball round them (${d.toFixed(1)} m)`);
      for (const [x, z] of ps) assert.ok(Math.hypot(b.pos[0] - x, b.pos[2] - z) >= L.TG_PR + 2 - 1e-3, `${n}: P${p + 1} clear of the pillars`);
      for (let q = 0; q < p; q++) {
        const o = g.v.partier(q);
        assert.ok(Math.hypot(b.pos[0] - o.pos[0], b.pos[2] - o.pos[2]) >= 2.2, `${n}: P${p + 1} and P${q + 1} apart`);
      }
    }
    assert.equal(dealt, its, `${n}: ${its} its dealt`);
    // into play: each marked in the round, it or free as dealt
    while (g.v.hole().state !== L.H_PLAY) g.step();
    for (let p = 0; p < n; p++) assert.equal(g.v.partier(p).m, g.v.u8[L.PG_S + L.TG_ROLE + p] ? IT : FREE);
  }
});

test('an it that touches a free ball makes it it: after the first second, not for a second after either tags or is tagged', async () => {
  const g = await room(4, { clean: true });
  for (let p = 0; p < 4; p++) mark(g, p, FREE);
  mark(g, 0, IT);
  // P2 a skin from P1 (no bump: 2.1 m apart), P3 and P4 well away
  put(g, 0, C - 6, C);
  put(g, 1, C - 6 + 2.1, C);
  put(g, 2, C + 6, C - 6);
  put(g, 3, C + 6, C + 6);
  at(g, L.TG_FRESH - 2);
  g.step();
  assert.equal(role(g, 1), FREE, 'nobody tags in the first second');
  g.step();
  assert.equal(role(g, 1), FREE);
  const before = g.v.fxCount();
  g.step();
  const t = playT(g) - 1;
  assert.equal(t, L.TG_FRESH);
  assert.equal(g.v.partier(1).m, IT | (t << 8), 'tagged on the first tick it can be');
  assert.equal(g.v.partier(0).m, IT | (t << 8), 'the tagger marked too');
  assert.equal(g.v.partier(0).kos, 1, 'a tag');
  const f = fxs(g.v, L.TG_FX_TAG).at(-1);
  assert.ok(g.v.fxCount() > before && f);
  assert.deepEqual([f.owner, f.shot & 255, f.shot >> 8, f.size], [1, 0, 2, Math.floor(t / L.TG_SEC)]);
  // P3 a skin from the tagger, P4 a skin from the new it: neither tags for TG_FRESH
  const p0 = g.v.partier(0).pos, p1 = g.v.partier(1).pos;
  put(g, 2, p0[0], p0[2] - 2.1);
  put(g, 3, p1[0], p1[2] + 2.1);
  for (let k = 1; k < L.TG_FRESH; k++) {
    g.step();
    assert.deepEqual([role(g, 2), role(g, 3)], [FREE, FREE], `${k} ticks after`);
  }
  g.step();
  assert.deepEqual([role(g, 2), role(g, 3)], [IT, IT], 'then both');
  assert.deepEqual([g.v.partier(0).kos, g.v.partier(1).kos], [2, 1]);
});

test('a touch is ball to ball in 3D, skins within TG_TOUCH: over its head is clear, and the lowest slot\'s it gets the tag', async () => {
  const g = await room(4, { clean: true });
  at(g, 400);
  for (let p = 0; p < 4; p++) mark(g, p, FREE);
  mark(g, 1, IT);
  mark(g, 2, IT);
  // P1 free between two its, each a skin away: P2 (the lower slot) tags it
  put(g, 0, C, C);
  put(g, 1, C - 2.15, C);
  put(g, 2, C + 2.15, C);
  put(g, 3, C + 10, C + 10, { y: PLAT_Y + 2.3, ground: false });
  g.step();
  assert.equal(role(g, 0), IT);
  assert.deepEqual([g.v.partier(1).kos, g.v.partier(2).kos], [1, 0]);
  // P4 in the air 2.3 m over P3's centre: no touch
  const p2 = g.v.partier(2).pos;
  put(g, 3, p2[0], p2[2], { y: p2[1] + 2.3, ground: false });
  g.dv.setFloat32(rec(3) + L.P_VY, 2, true);
  mark(g, 2, IT, 0);
  g.step();
  assert.equal(role(g, 3), FREE, 'clear over its head');
});

test('a point a second while free, frozen once it; springs to the free at 2 s and every 10 s, none to an it, gone when tagged', async () => {
  const g = await room(3, { clean: true });
  for (let p = 0; p < 3; p++) mark(g, p, FREE);
  mark(g, 0, IT);
  put(g, 0, C - 8, C);
  put(g, 1, C + 8, C - 4);
  put(g, 2, C + 8, C + 4);
  while (playT(g) < L.TG_GIVE0) {
    g.step();
    const t = playT(g) - 1;
    assert.equal(g.v.partier(1).score, Math.floor(t / L.TG_SEC), 'a point a second');
    assert.equal(g.v.partier(0).score, 0, 'an it scores nothing');
    assert.equal(g.v.partier(1).item, 0, 'no spring before 2 s');
  }
  g.step();
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).item), [0, L.PU_SPRING, L.PU_SPRING], 'springs for the free at 2 s');
  // P2 springs: up, and a new one at the next give; P3 keeps its own and gets no second
  g.step([[L.EV_INPUT, 1, partyWord({ use: 1 })]]);
  assert.equal(g.v.partier(1).item, 0);
  assert.ok(g.v.partier(1).vel[1] > 10 && !g.v.partier(1).ground, 'up it goes');
  let n = 0;
  while (!g.v.partier(1).ground && n++ < 400) g.step();
  assert.ok(n > 100, `${n} ticks in the air`);
  assert.equal(fxs(g.v, L.FX_BLAST).length, 1, 'a stomp where it lands');
  at(g, L.TG_GIVE0 + L.TG_GIVE - 1);
  g.step();
  assert.equal(g.v.partier(1).item, 0, 'not yet');
  g.step();
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).item), [0, L.PU_SPRING, L.PU_SPRING], 'again at 12 s');
  // tagged: the spring goes, the points stop
  const p0 = g.v.partier(0).pos;
  put(g, 2, p0[0] + 2.1, p0[2]);
  g.step();
  const s = g.v.partier(2).score;
  assert.deepEqual([role(g, 2), g.v.partier(2).item], [IT, 0]);
  for (let k = 0; k < 300; k++) g.step();
  assert.equal(g.v.partier(2).score, s, 'frozen');
  assert.equal(g.v.partier(1).score, Math.floor((playT(g) - 1) / L.TG_SEC));
});

test('an it rolls 6% faster: the keys push it TG_BOOST more on the ground; in the air no more', async () => {
  const g = await room(3, { clean: true });
  at(g, 300);
  for (let p = 0; p < 3; p++) mark(g, p, FREE);
  mark(g, 0, IT);
  put(g, 0, C - 15, C - 3);
  put(g, 1, C - 15, C + 3);
  put(g, 2, C + 12, C + 12);
  const fwd = partyWord({ yaw: 0, move: 1 });
  for (let k = 0; k < 200; k++) g.step(k ? [] : [[L.EV_INPUT, 0, fwd], [L.EV_INPUT, 1, fwd]]);
  const a = g.v.partier(0).vel[0], b = g.v.partier(1).vel[0];
  const acc = N('B_ACC_DT');
  assert.ok(Math.abs(a / b - (acc + L.TG_BOOST) / acc) < 1e-3, `${a.toFixed(3)} against ${b.toFixed(3)} m/s`);
  // flat out: v = push / (1 - drag)
  assert.ok(Math.abs(Math.fround(acc + Math.fround(L.TG_BOOST)) / (1 - N('B_DRAG')) - 10.6) < 0.05);
  // the same two in the air, side by side: the same speed
  put(g, 0, C - 15, C - 3, { y: PLAT_Y + 4, vx: 5, ground: false });
  put(g, 1, C - 15, C + 3, { y: PLAT_Y + 4, vx: 5, ground: false });
  for (let k = 0; k < 40; k++) g.step();
  assert.ok(!g.v.partier(0).ground && !g.v.partier(1).ground);
  assert.equal(g.v.partier(0).vel[0], g.v.partier(1).vel[0], 'no more in the air');
});

test('pillars: a ball is never in one; into one it bounces back at TG_PE of its speed and a kick; over one\'s top it passes', async () => {
  const g = await room(3);
  at(g, 300);
  const ps = pillars(g);
  for (let p = 0; p < 3; p++) mark(g, p, FREE);
  // the pillar nearest the middle, P1 rolling at it along x from 6 m off, the others far
  const [x, z] = ps.reduce((a, b) => (Math.hypot(a[0] - C, a[1] - C) < Math.hypot(b[0] - C, b[1] - C) ? a : b));
  const clear = (px, pz) => ps.every(([ox, oz]) => Math.hypot(px - ox, pz - oz) > L.TG_PR + 1.5 || (ox === x && oz === z));
  assert.ok(clear(x - 4, z) && clear(x - 3, z), 'a clear run at it');
  // coasting (no keys: the drag only), 1.7 m off its skin at 8 m/s
  put(g, 0, x - 4, z, { vx: 8 });
  put(g, 1, C + 0.1, C + 0.1);
  put(g, 2, C - 0.1, C + 30);
  let hit = -1, vin = 0, out = 0;
  for (let k = 0; k < 60; k++) {
    const v0 = g.v.partier(0).vel[0];
    g.step();
    const b = g.v.partier(0);
    assert.ok(Math.hypot(b.pos[0] - x, b.pos[2] - z) >= L.TG_PR + 1 - 1e-3, 'never in it');
    if (hit < 0 && b.vel[0] < 0) { hit = k; vin = Math.fround(v0 * N('B_DRAG')); out = -b.vel[0]; }
  }
  assert.ok(hit > 0, 'it came back');
  assert.ok(vin > 5, `into it at ${vin} m/s`);
  assert.ok(Math.abs(out - (L.TG_PE * vin + L.TG_KICK)) < 0.01, `in at ${vin.toFixed(2)}, out at ${out.toFixed(2)} m/s`);
  assert.equal(g.v.partier(0).vel[2], 0, 'straight back');
  // over the top of one: no bounce
  put(g, 0, x - 1.5 - L.TG_PR, z, { y: PLAT_Y + L.TG_PH + 0.5, vx: 6, ground: false });
  g.dv.setFloat32(rec(0) + L.P_VY, 4, true);
  g.step();
  assert.ok(g.v.partier(0).vel[0] > 5, 'over it');
});

test('the rim keeps every ball in and bounces it softly; the floor has no edge to fall off', async () => {
  const g = await room(3, { clean: true });
  at(g, 300);
  const R = g.v.party().size;
  for (let p = 0; p < 3; p++) mark(g, p, FREE);
  put(g, 0, C + R - 4, C, { vx: 10 });
  put(g, 1, C - 4, C);
  put(g, 2, C + 4, C);
  let bounced = false;
  for (let k = 0; k < 200; k++) {
    g.step([[L.EV_INPUT, 0, partyWord({ yaw: 0, move: 1 })]]);
    const b = g.v.partier(0);
    assert.ok(Math.hypot(b.pos[0] - C, b.pos[2] - C) <= R - 1 + 1e-3, 'inside');
    assert.ok(b.ground && !b.falling && !b.out);
    if (b.vel[0] < -3) bounced = true;
  }
  assert.ok(bounced || g.v.partier(0).vel[0] < 1, 'off the rim');
  // a ball (after a bump, say) past the rim is put back on it, still on the floor
  put(g, 1, C - R - 3, C, { vx: -4 });
  g.step();
  const b = g.v.partier(1);
  assert.ok(Math.abs(Math.hypot(b.pos[0] - C, b.pos[2] - C) - (R - 1)) < 1e-3 && b.ground);
  assert.ok(b.vel[0] > 0, 'coming back in');
});

test('catch the last one free and win, a point over it; it comes 2nd, the rest by their time free', async () => {
  const g = await room(3, { clean: true });
  for (let p = 0; p < 3; p++) mark(g, p, FREE);
  mark(g, 0, IT);
  put(g, 0, C - 10, C);
  put(g, 1, C + 8, C - 6);
  put(g, 2, C + 8, C + 6);
  at(g, 20 * L.TG_SEC);
  // P3 first, at 20 s
  put(g, 2, C - 10 + 2.1, C);
  g.step();
  assert.equal(role(g, 2), IT);
  assert.equal(g.v.party().state, L.H_PLAY, 'one free still');
  const f = fxs(g.v, L.TG_FX_TAG).at(-1);
  assert.deepEqual([f.shot >> 8, f.size], [1, 20]);
  // then P2 at 35 s
  at(g, 35 * L.TG_SEC);
  mark(g, 0, IT, 0);
  const p0 = g.v.partier(0).pos;
  put(g, 1, p0[0], p0[2] + 2.1);
  g.step();
  const r = g.v.party();
  assert.equal(r.state, L.H_OVER, 'nobody free: over');
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).score), [36, 35, 20]);
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).place), [1, 2, 3]);
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).pts), [10, 5, 1]);
  assert.equal(r.winner, 0);
  assert.equal(fxs(g.v, L.TG_FX_TAG).at(-1).shot, 0, 'P1 caught the last one: none left');
});

test('at the clock the free share the win; a lone ball plays on free to it', async () => {
  const g = await room(3, { clean: true });
  for (let p = 0; p < 3; p++) mark(g, p, FREE);
  mark(g, 0, IT);
  put(g, 0, C - 10, C);
  put(g, 1, C + 8, C - 6);
  put(g, 2, C + 8, C + 6);
  at(g, L.TG_LEN - 3);
  for (let k = 0; k < 4; k++) g.step();
  const r = g.v.party();
  assert.equal(r.state, L.H_OVER);
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).place), [3, 1, 1]);
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).wins), [0, 1, 1]);
  assert.equal(r.winner, 255, 'shared');
  // one ball: nobody it, a point a second, the round to the clock
  const s = await room(1, { clean: true });
  assert.equal(s.v.partier(0).m, FREE);
  for (let k = 0; k < 500; k++) s.step();
  assert.equal(s.v.party().state, L.H_PLAY);
  assert.equal(s.v.partier(0).score, Math.floor((playT(s) - 1) / L.TG_SEC));
  assert.equal(s.v.partier(0).score, 4);
});

test('a ball joining in play is it; when the its have all left, one of the free is made it', async () => {
  const g = await room(3, { clean: true });
  at(g, 600);
  for (let p = 0; p < 3; p++) mark(g, p, FREE);
  mark(g, 0, IT);
  put(g, 0, C - 10, C);
  put(g, 1, C + 8, C - 6);
  put(g, 2, C + 8, C + 6);
  g.step([[L.EV_JOIN, 3]]);
  const b = g.v.partier(3);
  assert.deepEqual([b.live, b.m & IT, b.score], [true, IT, 0]);
  assert.ok(b.pos[1] > PLAT_Y + 4, 'falling in');
  let f = fxs(g.v, L.TG_FX_TAG).at(-1);
  assert.deepEqual([f.owner, f.shot & 255, f.shot >> 8], [3, 255, 2]);
  // the its leave: the PRNG deals one of P2, P3
  g.step([[L.EV_LEAVE, 0], [L.EV_LEAVE, 3]]);
  const its = [1, 2].filter((p) => role(g, p) === IT);
  assert.equal(its.length, 1, 'one of them it');
  f = fxs(g.v, L.TG_FX_TAG).at(-1);
  assert.deepEqual([f.owner, f.shot & 255, f.shot >> 8], [its[0], 254, 1]);
  assert.equal(g.v.party().state, L.H_PLAY);
});

test('the prediction matches the confirmed ball bit for bit: into a pillar and off it, off the rim, its points and its spring, as an it pushing harder', async () => {
  const g = await room(3, { seed: 31 });
  const R = g.v.party().size;
  const ps = pillars(g);
  for (let p = 0; p < 3; p++) mark(g, p, FREE);
  // the others still, far off
  put(g, 1, C, C - R + 2);
  put(g, 2, C, C + R - 2);
  const yawTo = (x, z) => { const b = g.v.partier(0); return Math.round(Math.atan2(z - b.pos[2], x - b.pos[0]) / (2 * Math.PI) * 16384) & 16383; };
  // in tens of ticks, the nearest a pillar's centre and the rim came
  const run = (word, n) => {
    let pill = Infinity, rim = 0;
    for (let k = 0; k < n; k += 10) {
      assert.ok(predicted(g, Array(10).fill(typeof word === 'function' ? word(k) : word)) >= 10);
      const b = g.v.partier(0);
      for (const [x, z] of ps) pill = Math.min(pill, Math.hypot(b.pos[0] - x, b.pos[2] - z));
      rim = Math.max(rim, Math.hypot(b.pos[0] - C, b.pos[2] - C));
    }
    return { pill, rim };
  };
  // A: free, from 6 m off the pillar nearest the middle, at it flat out; off it; on into the warning of a spring
  const [px, pz] = ps.reduce((a, b) => (Math.hypot(a[0] - C, a[1] - C) < Math.hypot(b[0] - C, b[1] - C) ? a : b));
  put(g, 0, px - 6, pz);
  at(g, L.TG_GIVE0 - 150);
  const a = run(partyWord({ yaw: yawTo(px, pz), move: 1 }), 120);
  assert.ok(a.pill < L.TG_PR + 1.6, `against the pillar (${a.pill.toFixed(2)} m)`);
  // B: out to the rim and along it
  const out = g.v.partier(0).pos, away = yawTo(C + (out[0] - C) * 10, C + (out[2] - C) * 10);
  const b = run((k) => partyWord({ yaw: k < 300 ? away : (away + 4096) & 16383, move: 1 }), 450);
  assert.ok(b.rim > R - 1.5, `against the rim (${b.rim.toFixed(2)} m)`);
  assert.equal(g.v.partier(0).item, L.PU_SPRING, 'a spring came');
  // C: up on it, down again, rolling on
  const c = run((k) => partyWord({ yaw: 8192, move: 1, use: k >= 20 ? 1 : 0 }), 300);
  assert.ok(fxs(g.v, L.FX_USE).length >= 1 && g.v.partier(0).item === 0, 'it sprang');
  assert.ok(c.rim > 0);
  assert.equal(g.v.partier(0).score, Math.floor((playT(g) - 1) / L.TG_SEC), 'its points, a second at a time');
  // D: as an it, the push and the pillars
  mark(g, 0, IT, 0);
  put(g, 0, px + 6, pz, { vx: -3 });
  const d = run((k) => partyWord({ yaw: k < 150 ? yawTo(px, pz) : (k * 131) & 16383, move: 1 }), 400);
  assert.ok(d.pill < L.TG_PR + 1.6, `an it against the pillar (${d.pill.toFixed(2)} m)`);
  assert.equal(g.v.partier(0).m & IT, IT);
});

// A round of Partier balls on the debug build: no trap, a round played to
// its end, equal on every tick on 1 and 4 threads.
for (const [balls, ticks] of [[8, 9000], [64, 7000]]) {
  test(`a round of ${balls} AI balls on the debug build: no trap, it spreads, the round ends; equal on 1 and 4 threads`, async () => {
    const bytes = partyBytes(true);
    const stats = { start: -1, over: -1, tags: 0, first: -1, places: null };
    let seen = 0;
    const r = await playParty({ bytes, seed: balls, mg: L.MG_TAG, bots: balls, ticks, onTick: (t, sim, v) => {
      const g = v.party();
      if (stats.start < 0 && g.state === L.H_PLAY) stats.start = t;
      for (; seen < v.fxCount(); seen++) if (v.fx(seen).kind === L.TG_FX_TAG && (v.fx(seen).shot & 255) < 254) { stats.tags++; if (stats.first < 0) stats.first = t; }
      if (stats.over < 0 && stats.start >= 0 && g.state === L.H_OVER) { stats.over = t; stats.places = [...Array(balls).keys()].map((p) => v.partier(p).place); }
    } });
    assert.equal(r.sim.error().code, 0);
    assert.ok(stats.over > 0, 'the round ended');
    const secs = (stats.over - stats.start) * TICK;
    assert.ok(secs > 15 && secs <= L.TG_LEN * TICK, `${secs.toFixed(1)} s of play`);
    assert.ok((stats.first - stats.start) * TICK > 1, 'nobody tagged in the first second');
    assert.ok(stats.tags >= balls / 2, `${stats.tags} tags`);
    assert.ok(stats.places.every((x) => x >= 1 && x <= balls) && stats.places.includes(1), `places ${stats.places}`);
    const parsed = parseLog(r.log);
    const n = stats.over + 50;
    const a = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 1, tag: 't1' });
    const b = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 4, tag: 't4', startWorkers });
    const d = await replay({ bytes, log: parsed, ticks: n, threads: 1, tag: 'd1' });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(d.trace).tickHashes], 'the debug build steps the same bits');
  });
}

test('the client module: draws the countdown, play and the result, frames the disc, its HUD lines fit, its brain hunts and flees', async () => {
  const { Scene } = await import('../client/party-render.mjs');
  const g = await room(4, { play: false, seed: 41 });
  const out = { scene: new Scene(24000), solid: [], glow: [], beams: [], decals: [], paint: null };
  const lines = [];
  const hctx = { put: (x, y, s, c) => lines.push([y, s, c]), centre: (y, s, c) => lines.push([y, s, c]), right: (y, s, c) => lines.push([y, s, c]), rows: 44, C: {}, now: 0 };
  const draw = () => {
    out.scene.clear(); out.decals.length = 0; out.beams.length = 0; out.glow.length = 0; lines.length = 0;
    tag.draw(g.v, { tick: g.v.tick, t: g.v.party().t * TICK, dt: 0.004, now: 1000, ms: 16, cam: [C, PLAT_Y + 30, C - 40], slot: 0 }, out);
    for (let k = 0; k < out.scene.count * 16; k++) assert.ok(Number.isFinite(out.scene.data[k]), 'finite');
    assert.ok(out.scene.count > 10);
    for (let s = 0; s < 4; s++) { lines.length = 0; tag.hud(g.v, { ...hctx, slot: s, me: g.v.partier(s) }); for (const l of lines) assert.ok(l[1].length <= 80, l[1]); }
  };
  draw();
  const its = (n) => { let k = 0; for (let i = 0; i < out.scene.count; i++) if (out.scene.data[i * 16 + 3] === 3) k++; return k; };
  assert.equal(its(), 1, 'the dealt it in its shell in the countdown');
  while (g.v.hole().state !== L.H_PLAY) g.step();
  for (let k = 0; k < 300; k++) g.step();
  draw();
  const fr = tag.frame(g.v);
  assert.equal(fr.shape, 'disc');
  assert.ok(Math.abs(fr.radius - g.v.party().size - 0.6) < 1e-3);
  assert.ok(tag.hint.length <= 70);
  assert.ok(typeof tag.rules === 'string' && tag.rules.length <= 70 && /^[ -_]*$/.test(tag.rules), 'the title card\'s rules line in the 3x5 font');
  // the brain: an it makes for a free ball; a free ball fears an it near, not far
  const it = [0, 1, 2, 3].find((p) => isIt(g.v, p)), free = [0, 1, 2, 3].find((p) => !isIt(g.v, p));
  const bot = { slot: it, skill: 0.8, mem: {}, pos: [g.v.partier(it).pos[0], g.v.partier(it).pos[2]] };
  const w = tag.brain.think(g.v, it, bot, g.v.tick);
  assert.ok(w && typeof w.yaw === 'number' && w.move === 1);
  const fb = g.v.partier(free), ib = g.v.partier(it);
  assert.ok(tag.brain.danger(g.v, ib.pos[0], ib.pos[2], g.v.tick, fb) > 0.9, 'an it\'s spot is a tag');
  const away = [C + (C - ib.pos[0]) * 0.5, C + (C - ib.pos[2]) * 0.5];
  if (Math.hypot(away[0] - ib.pos[0], away[1] - ib.pos[2]) < 8) { away[0] = C; away[1] = C - 10; }
  assert.ok(tag.brain.danger(g.v, away[0], away[1], g.v.tick, fb) < 0.3, 'far from it');
  assert.equal(tag.brain.danger(g.v, fb.pos[0], fb.pos[2], g.v.tick, ib), 0, 'an it fears nothing');
  assert.ok(stage(g.v).np > 0);
});
