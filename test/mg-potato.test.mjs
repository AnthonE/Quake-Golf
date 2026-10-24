import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty, partyBytes, predicted } from './helpers.mjs';
import { View, partyWord, PLAT_Y } from '../src/party-view.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { playParty } from '../tools/genparty.mjs';
import * as L from '../src/layout.mjs';
import potato, { sched, rimAt, holds, picked } from '../client/mg/potato.mjs';

const C = L.B_CX;
const f = Math.fround;
const TICK = 0.008;
const size = (n) => Math.min(L.HP_R0 + L.HP_RK * Math.sqrt(n), L.HP_RMAX);
const bombs = (n) => Math.min(n, Math.min(L.HP_BMAX, Math.max(1, Math.floor((n + 1) / L.HP_PER))));
const fuse = (w) => Math.max(L.HP_FUSE1, L.HP_FUSE0 - w * L.HP_FUSEK);

// A room of n balls on Hot Potato, on the debug build (a NaN traps), stepped into play unless asked not to.
async function room(n = 2, { play = true, seed = 7 } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_POTATO + 1, true);
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
const held = (g, p) => (g.dv.getUint8(rec(p) + L.HP_FL) & L.HP_HOLD) !== 0;
// Slot p holds a bomb passed by `by` (255 the deal), got on tick `at` into play; or none.
function give(g, p, at, by = 255) {
  g.dv.setUint8(rec(p) + L.HP_FL, L.HP_HOLD);
  g.dv.setUint8(rec(p) + L.HP_BY, by);
  g.dv.setUint16(rec(p) + L.HP_AT, at, true);
}
const take = (g, p) => g.dv.setUint8(rec(p) + L.HP_FL, 0);
const pick = (g, p) => g.dv.getUint8(L.PG_S + L.HP_NEXT + p);
// The next step plays tick t into play (the clock moved; the round's end with it).
function at(g, t) {
  const now = g.v.tick;
  g.dv.setUint32(L.HDR_START, now - t, true);
  g.dv.setUint32(L.HDR_UNTIL, now - t + L.HP_LEN, true);
}
const playT = (g) => g.v.party().t; // the tick into play the next step plays
const hdr = (g, k) => g.dv.getUint32(L.PG_H + k, true);
const setHdr = (g, k, v) => g.dv.setUint32(L.PG_H + k, v, true);
// The FX since count `from`, of a kind.
const fxs = (v, from, kind) => { const out = []; for (let k = from; k < v.fxCount(); k++) { const x = v.fx(k); if (x.kind === kind) out.push(x); } return out; };
// Every bomb and pick cleared, and the wave's deal behind it (play past the first deal and the stickiness).
async function clear(n, opts) {
  const g = await room(n, opts);
  while (playT(g) <= L.HP_DEAL0 + L.HP_COOL) g.step();
  for (let p = 0; p < L.NPLAYER; p++) { take(g, p); g.dv.setUint8(L.PG_S + L.HP_NEXT + p, 0); }
  return g;
}

test('the stage for 1, 8, 64 and 256: a disc sized for the crowd, a third of the balls picked for the first bombs, every ball on it apart', async () => {
  let last = 0;
  for (const n of [1, 8, 64, 256]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party();
    assert.equal(r.game, L.MG_POTATO);
    assert.ok(Math.abs(r.size - size(n)) < 1e-4, `${r.size} m for ${n}`);
    assert.ok(r.size > last, 'grows with the crowd');
    last = r.size;
    assert.deepEqual([r.kind, r.len, r.floor, r.acc, r.hop], [L.PK_OUT, L.HP_LEN, PLAT_Y, 1, 6]);
    const s = sched(g.v);
    assert.deepEqual([s.rad, s.rnext, s.wave, s.last, s.deal, s.boom, s.fuse, s.bombs],
      [r.size, r.size, 0, 0, L.HP_DEAL0, L.HP_DEAL0 + L.HP_FUSE0, L.HP_FUSE0, bombs(n)]);
    const picks = [...Array(L.NPLAYER).keys()].filter((p) => pick(g, p));
    assert.equal(picks.length, bombs(n), `${picks.length} picked of ${n}`);
    assert.ok(picks.every((p) => p < n && pick(g, p) === 1), 'from the balls in, for wave 0');
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p);
      assert.equal(b.pos[1], PLAT_Y);
      assert.ok(Math.hypot(b.pos[0] - C, b.pos[2] - C) <= r.size * L.HP_SPAWN + 1e-3, `P${p + 1} in the middle`);
      assert.equal(b.m, 0, 'no bomb in the countdown');
      for (let q = 0; q < p; q++) {
        const o = g.v.partier(q);
        assert.ok(Math.hypot(b.pos[0] - o.pos[0], b.pos[2] - o.pos[2]) > 2 * 1 + L.HP_TOUCH, `P${p + 1} and P${q + 1} apart`);
      }
    }
  }
  assert.equal(bombs(2), 1);
  assert.equal(bombs(8), 3);
  assert.equal(bombs(256), L.HP_BMAX);
});

test('the first bombs are lit HP_DEAL0 into play, to the balls picked as the round was laid out, and nobody holds one before', async () => {
  const g = await room(9, { play: false });
  const picks = [...Array(9).keys()].filter((p) => pick(g, p) === 1);
  assert.equal(picks.length, 3);
  while (g.v.hole().state !== L.H_PLAY || playT(g) < L.HP_DEAL0) {
    g.step();
    for (let p = 0; p < 9; p++) assert.ok(!held(g, p), `nothing held ${playT(g)} ticks in`);
  }
  const from = g.v.fxCount();
  g.step();
  assert.deepEqual([...Array(9).keys()].filter((p) => held(g, p)), picks, 'the picked hold theirs');
  for (const p of picks) assert.deepEqual([g.dv.getUint8(rec(p) + L.HP_BY), g.dv.getUint16(rec(p) + L.HP_AT, true)], [255, L.HP_DEAL0]);
  const deal = fxs(g.v, from, L.HP_FX_DEAL);
  assert.equal(deal.length, 1);
  assert.deepEqual([deal[0].owner, deal[0].shot, deal[0].size], [255, 3, L.HP_FUSE0]);
  for (const p of picks) assert.ok(holds(g.v, p), 'the client sees it');
  g.step();
  assert.deepEqual([...Array(9).keys()].filter((p) => held(g, p)), picks, 'once only');
});

test('a holder rolls HP_HASTE faster: on the ground its push is 1.15 times a ball\'s, in the air the same', async () => {
  const g = await clear(4);
  give(g, 0, playT(g) - L.HP_COOL);
  put(g, 0, C - 10, C - 4);
  put(g, 1, C - 10, C + 4);
  put(g, 2, C + 8, C + 8);
  put(g, 3, C + 8, C - 8);
  const go = partyWord({ yaw: 0, move: 1 });
  for (let k = 0; k < 100; k++) g.step([[L.EV_INPUT, 0, go], [L.EV_INPUT, 1, go]]);
  const a = g.v.partier(0).vel[0], b = g.v.partier(1).vel[0];
  assert.ok(b > 5, `rolling at ${b}`);
  assert.ok(Math.abs(a / b - (1 + L.HP_HASTE)) < 2e-3, `${a} against ${b}`);
  // both hop: in the air the push is a ball's own
  g.step([[L.EV_INPUT, 0, partyWord({ yaw: 0, move: 1, hop: 1 })], [L.EV_INPUT, 1, partyWord({ yaw: 0, move: 1, hop: 1 })]]);
  const a0 = g.v.partier(0).vel[0], b0 = g.v.partier(1).vel[0];
  for (let k = 0; k < 10; k++) g.step();
  assert.ok(!g.v.partier(0).ground && !g.v.partier(1).ground);
  const da = g.v.partier(0).vel[0] - a0 * 0.998 ** 10, db = g.v.partier(1).vel[0] - b0 * 0.998 ** 10;
  assert.ok(Math.abs(da - db) < 1e-3, `in the air ${da} and ${db}`);
});

test('a holder touching a ball without one passes it on; the bomb sticks HP_COOL to the one that took it, then can go back', async () => {
  const g = await clear(4);
  const t0 = playT(g);
  give(g, 0, t0 - L.HP_COOL, 255);
  put(g, 0, C - 1.1, C);
  put(g, 1, C + 1.1, C);
  put(g, 2, C + 10, C + 10);
  put(g, 3, C - 10, C - 10);
  const from = g.v.fxCount();
  g.step();
  assert.deepEqual([held(g, 0), held(g, 1)], [false, true], 'passed');
  assert.deepEqual([g.dv.getUint8(rec(1) + L.HP_BY), g.dv.getUint16(rec(1) + L.HP_AT, true)], [0, t0]);
  const pass = fxs(g.v, from, L.HP_FX_PASS);
  assert.equal(pass.length, 1);
  assert.deepEqual([pass[0].owner, pass[0].shot, pass[0].size], [1, 0, hdr(g, L.HP_BOOM) - t0]);
  assert.deepEqual(pass[0].pos, [g.v.partier(1).pos[0], PLAT_Y + 1, C].map(f));
  // still touching: it sticks to P2 through HP_COOL, then goes back
  for (let k = 1; k < L.HP_COOL; k++) {
    put(g, 0, C - 1.1, C);
    put(g, 1, C + 1.1, C);
    g.step();
    assert.ok(held(g, 1) && !held(g, 0), `stuck ${k} ticks on`);
  }
  put(g, 0, C - 1.1, C);
  put(g, 1, C + 1.1, C);
  g.step();
  assert.deepEqual([held(g, 0), held(g, 1)], [true, false], 'and back');
  assert.equal(g.dv.getUint8(rec(0) + L.HP_BY), 1);
  // not touching: nothing passes
  put(g, 0, C - 1.3, C);
  put(g, 1, C + 1.3, C);
  for (let k = 0; k < L.HP_COOL + 5; k++) g.step();
  assert.deepEqual([held(g, 0), held(g, 1)], [true, false], '2.6 m apart is not a touch');
});

test('one pass a holder a tick, to the lowest slot it touches; holders touching keep theirs; a ball going out takes nothing', async () => {
  const g = await clear(6);
  const t = playT(g);
  give(g, 2, t - L.HP_COOL);
  put(g, 2, C, C);
  put(g, 0, C - 2.1, C);
  put(g, 1, C + 2.1, C);
  give(g, 3, t - L.HP_COOL);
  give(g, 4, t - L.HP_COOL);
  put(g, 3, C, C + 10);
  put(g, 4, C + 2.1, C + 10);
  // P6 falling out (PF_FALL) right by P4
  put(g, 5, C - 2.1, C + 10);
  g.dv.setUint8(rec(5) + L.P_FL, L.PF_LIVE | L.PF_FALL);
  g.step();
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((p) => held(g, p)), [true, false, false, true, true, false]);
});

test('the fuse runs out: every holder out where it stands, sharing the place, a blast round each, the KO to whoever passed it; then the next wave', async () => {
  const g = await clear(6);
  give(g, 1, 300, 4);
  give(g, 3, 300, 255);
  put(g, 0, C + 3, C);
  put(g, 1, C, C);
  put(g, 2, C - 12, C);
  put(g, 3, C, C + 12);
  put(g, 4, C, C - 12);
  put(g, 5, C + 10, C - 10);
  const boom = hdr(g, L.HP_BOOM);
  at(g, boom);
  const from = g.v.fxCount();
  const tick = g.v.tick;
  g.step();
  for (const p of [1, 3]) {
    const b = g.v.partier(p);
    assert.ok(b.out && !held(g, p), `P${p + 1} blown`);
    assert.deepEqual([b.place, b.outAt], [6, tick], 'sharing the place');
  }
  assert.equal(g.v.party().left, 4);
  const a = g.v.partier(0);
  assert.ok(!a.out && a.vel[0] > 2 && a.vel[1] > 0, `P1 shoved away and up: ${a.vel}`);
  assert.deepEqual([a.hitBy, g.v.partier(2).vel[0]], [1, 0], 'by the blast at P2; P3 too far');
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((p) => g.v.partier(p).kos), [0, 0, 0, 0, 1, 0], 'the KO to P5, who passed it; none for a bomb dealt');
  const sinks = fxs(g.v, from, L.FX_SINK);
  assert.deepEqual(sinks.map((x) => [x.owner, x.shot]), [[1, 4], [3, 255]]);
  assert.equal(fxs(g.v, from, L.FX_BLAST).length, 2);
  const bm = fxs(g.v, from, L.HP_FX_BOOM);
  assert.deepEqual(bm.map((x) => [x.owner, x.shot, x.size]), [[255, 2, 0]]);
  // the feed says so
  assert.equal(potato.sink(sinks[0], (p) => `P${p + 1}`, g.v), 'P2 BLEW UP  P5 PASSED IT');
  assert.equal(potato.sink(sinks[1], (p) => `P${p + 1}`, g.v), 'P4 BLEW UP');
  // the next wave: a bomb for the 4 left, the edge in for them, lit HP_REST on, a second shorter
  const s = sched(g.v);
  assert.deepEqual([s.wave, s.last, s.deal, s.boom, s.fuse, s.bombs], [1, boom, boom + L.HP_REST, boom + L.HP_REST + fuse(1), fuse(1), 1]);
  assert.equal(s.rad, f(size(6)));
  assert.equal(s.rnext, f(size(4)));
  assert.equal(g.v.party().size, s.rnext);
  const picks = [...Array(6).keys()].filter((p) => pick(g, p) === 2);
  assert.equal(picks.length, 1);
  assert.ok(!g.v.partier(picks[0]).out, 'picked from the balls in');
  assert.ok(picked(g.v, s, picks[0], playT(g)));
  // and lit at the deal
  while (playT(g) <= s.deal) g.step();
  assert.ok(held(g, picks[0]));
});

test('a pass whose passer has left is forgotten: no KO for a newcomer in its slot; one knocked out but still in the room keeps it', async () => {
  const g = await clear(5);
  give(g, 0, 300, 2); // passed by P3, who leaves; a newcomer takes the slot
  give(g, 1, 300, 3); // passed by P4, out already but watching
  put(g, 0, C - 6, C);
  put(g, 1, C + 6, C);
  put(g, 3, C, C + 6);
  put(g, 4, C, C - 6);
  g.dv.setUint8(rec(3) + L.P_FL, L.PF_LIVE | L.PF_DEAD);
  g.step([[L.EV_LEAVE, 2]]);
  g.step([[L.EV_JOIN, 2]]);
  assert.equal(g.v.partier(2).live, true, 'the newcomer in slot 3');
  assert.deepEqual([g.dv.getUint8(rec(0) + L.HP_BY), g.dv.getUint8(rec(1) + L.HP_BY)], [255, 3]);
  at(g, hdr(g, L.HP_BOOM));
  const from = g.v.fxCount();
  g.step();
  assert.ok(g.v.partier(0).out && g.v.partier(1).out, 'both blown');
  assert.deepEqual(fxs(g.v, from, L.FX_SINK).map((x) => [x.owner, x.shot]), [[0, 255], [1, 3]]);
  assert.deepEqual([g.v.partier(2).kos, g.v.partier(3).kos], [0, 1]);
  assert.equal(potato.sink(fxs(g.v, from, L.FX_SINK)[0], (p) => `P${p + 1}`, g.v), 'P1 BLEW UP');
});

test('a ball that falls out on the boom\'s tick didn\'t blow up: no feed line, no fireball; a later boom blasts only its own', async () => {
  const { Scene } = await import('../client/party-render.mjs');
  const g = await clear(6);
  give(g, 1, 300);
  give(g, 3, 300);
  put(g, 0, C + 14, C + 14);
  put(g, 1, C, C);
  put(g, 2, C - 12, C, { y: g.v.party().floor - L.OUT_DEPTH - 0.5, ground: false }); // under the floor: out this tick
  put(g, 3, C, C + 12);
  put(g, 4, C, C - 12);
  put(g, 5, C + 12, C - 12);
  g.dv.setUint8(rec(2) + L.B_HITBY, 4); // bumped off by P5 a moment ago
  g.dv.setUint16(rec(2) + L.B_HITT, 100, true);
  const boom = hdr(g, L.HP_BOOM);
  at(g, boom);
  const from = g.v.fxCount();
  g.step();
  const sinks = fxs(g.v, from, L.FX_SINK);
  assert.deepEqual(sinks.map((x) => [x.owner, x.shot]), [[1, 255], [3, 255], [2, 4]]);
  assert.ok(sinks.every((x) => x.tick === sinks[0].tick && g.v.partier(x.owner).outAt === x.tick), 'all out on the boom\'s tick');
  const blown = (p) => (g.dv.getUint8(rec(p) + L.HP_FL) & L.HP_BLOWN) !== 0;
  assert.deepEqual([1, 2, 3].map(blown), [true, false, true]);
  const said = sinks.map((x) => potato.sink(x, (p) => `P${p + 1}`, g.v));
  assert.deepEqual(said, ['P2 BLEW UP', 'P4 BLEW UP', null]);
  assert.equal(fxs(g.v, from, L.FX_BLAST).length, 2);
  // fireballs where the two holders went off, none where P3 sank
  const o = { scene: new Scene(24000), solid: [], glow: [], beams: [], decals: [], casters: [], paint: null };
  potato.draw(g.v, { tick: g.v.tick, t: (boom + 2) * TICK, dt: 0, now: 0, slot: 0 }, o);
  const near = (p) => o.glow.filter((x) => Math.hypot(x.pos[0] - g.v.partier(p).pos[0], x.pos[2] - g.v.partier(p).pos[2]) < 0.5).length;
  assert.deepEqual([near(1), near(2), near(3)].map((n) => n > 0), [true, false, true]);
  // the next boom: one holder, one blast; the marks from the last stay
  give(g, 0, playT(g));
  at(g, hdr(g, L.HP_BOOM));
  const from2 = g.v.fxCount();
  g.step();
  assert.ok(g.v.partier(0).out);
  assert.equal(fxs(g.v, from2, L.FX_BLAST).length, 1, 'only the holder blown now');
  assert.deepEqual([0, 1, 2, 3].map(blown), [true, true, false, true]);
  assert.equal(potato.sink(fxs(g.v, from2, L.FX_SINK)[0], (p) => `P${p + 1}`, g.v), 'P1 BLEW UP');
});

test('a lit fuse\'s last three seconds are ticked off, 3, 2, 1, and none in the rest', async () => {
  const g = await clear(4);
  const boom = hdr(g, L.HP_BOOM);
  at(g, boom - 400);
  const from = g.v.fxCount();
  while (playT(g) < boom) g.step();
  assert.deepEqual(fxs(g.v, from, L.HP_FX_TICK).map((x) => [x.shot, x.size, (x.tick - g.v.party().start) | 0]),
    [[3, 375, boom - 375], [2, 250, boom - 250], [1, 125, boom - 125]]);
  g.step();
  const s = sched(g.v);
  const mark = g.v.fxCount();
  while (playT(g) < s.deal) g.step();
  assert.equal(fxs(g.v, mark, L.HP_FX_TICK).length, 0);
});

test('the edge: as the boom left it for HP_SHRINK0, then in a straight line to the next radius by the deal; a ball past it falls, rimAt as the sim has it', async () => {
  const g = await clear(8);
  for (const p of [4, 5, 6, 7]) { give(g, p, 300); put(g, p, C - 8 + 2.5 * (p - 4), C + 6); }
  const boom = hdr(g, L.HP_BOOM);
  at(g, boom);
  g.step();
  const s = sched(g.v);
  assert.ok(s.rnext < s.rad - 1, `${s.rad} in to ${s.rnext}`);
  // still balls between the two radii (on the +x, -z and -x axes) and one just inside the new edge (+z)
  const radii = [s.rad - 0.05, (s.rad + s.rnext) / 2, s.rnext + 0.3, s.rnext - 0.2];
  const sign = [1, -1, -1, 1];
  radii.forEach((r, k) => put(g, k, k & 1 ? C : f(C + sign[k] * r), k & 1 ? f(C + sign[k] * r) : C));
  const fell = radii.map(() => -1);
  while (playT(g) < s.deal + 10) {
    const t = playT(g);
    g.step();
    for (let k = 0; k < radii.length; k++) {
      if (fell[k] >= 0) continue;
      const b = g.v.partier(k);
      const d = k & 1 ? f(b.pos[2] - C) : f(b.pos[0] - C);
      assert.ok(Math.abs(Math.abs(d) - radii[k]) < 1e-4, 'still');
      const R = rimAt(s, t);
      const inside = f(d * d) <= f(R * R);
      assert.equal(b.ground, inside, `P${k + 1} at ${radii[k].toFixed(2)} m on tick ${t}: rim ${R}`);
      if (!b.ground) fell[k] = t;
    }
  }
  assert.ok(fell[0] > boom + L.HP_SHRINK0 && fell[0] < fell[1] && fell[1] < fell[2] && fell[2] <= s.deal, `fell at ${fell}`);
  assert.equal(fell[3], -1, 'inside the new edge, still up');
  assert.equal(rimAt(s, boom + L.HP_SHRINK0), s.rad);
  assert.equal(rimAt(s, s.deal), s.rnext);
  assert.equal(potato.frame(g.v).radius, s.rnext + 0.3);
});

test('a holder off the edge takes its bomb with it; a wave whose holders all fell blows nobody', async () => {
  const g = await clear(4);
  give(g, 0, 300);
  const R = sched(g.v).rnext;
  put(g, 0, C + R + 0.5, C, { vx: 3 });
  put(g, 1, C - 4, C);
  put(g, 2, C + 4, C + 4);
  put(g, 3, C - 4, C - 4);
  let n = 0;
  while (!g.v.partier(0).out && n++ < 400) g.step();
  assert.ok(g.v.partier(0).out && !held(g, 0), 'out, the bomb gone');
  assert.equal(g.v.partier(0).hitBy, 255);
  at(g, hdr(g, L.HP_BOOM));
  const from = g.v.fxCount();
  g.step();
  assert.deepEqual(fxs(g.v, from, L.HP_FX_BOOM).map((x) => x.shot), [0]);
  assert.equal(g.v.party().left, 3);
});

test('the round\'s end: a fuse that would run past it goes off on the last tick, the holders out, the rest share the win', async () => {
  const g = await clear(4);
  give(g, 0, 300);
  put(g, 0, C - 6, C);
  put(g, 1, C + 6, C);
  put(g, 2, C, C + 6);
  put(g, 3, C, C - 6);
  // a boom 400 ticks from the end: the next deal 150 from it, its fuse cut to the end
  setHdr(g, L.HP_BOOM, L.HP_LEN - 400);
  at(g, L.HP_LEN - 400);
  g.step();
  assert.ok(g.v.partier(0).out);
  assert.deepEqual([hdr(g, L.HP_DEAL), hdr(g, L.HP_BOOM), hdr(g, L.HP_FUSE)], [L.HP_LEN - 150, L.HP_LEN, 150]);
  for (const p of [1, 2, 3]) put(g, p, [0, C + 6, C, C][p], [0, C, C + 6, C - 6][p]);
  while (playT(g) <= L.HP_LEN - 150) g.step();
  const holder = [1, 2, 3].find((p) => held(g, p));
  assert.ok(holder !== undefined, 'one of the three lit');
  while (g.v.hole().state === L.H_PLAY) g.step();
  const r = g.v.party();
  assert.equal(r.state, L.H_OVER);
  assert.equal((r.tick - 1 - r.start) | 0, L.HP_LEN, 'on the clock\'s last tick');
  assert.equal(r.winner, 255, 'shared');
  const others = [1, 2, 3].filter((p) => p !== holder);
  assert.ok(g.v.partier(holder).out);
  assert.equal(g.v.partier(holder).place, 3);
  for (const p of others) assert.deepEqual([g.v.partier(p).place, g.v.partier(p).wins], [1, 1]);
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.partier(p).place), [4, 1, 2, 3].map((x, p) => (p === 0 ? 4 : p === holder ? 3 : 1)));
});

test('the prediction matches the confirmed ball bit for bit: lit at the deal and rolling with its haste, and through the edge falling in under it', async () => {
  const g = await room(3, { play: false });
  for (let p = 0; p < 3; p++) g.dv.setUint8(L.PG_S + L.HP_NEXT + p, p === 0 ? 1 : 0);
  while (g.v.hole().state !== L.H_PLAY || playT(g) < L.HP_DEAL0 - 40) g.step();
  put(g, 1, C - 11, C + 9);
  put(g, 2, C - 11, C - 9);
  // P1 rolls round the middle, across the deal: its bomb lit, the haste on, on both banks
  const words = Array.from({ length: 260 }, (_, k) => partyWord({ yaw: (2000 + k * 37) & 16383, move: k % 90 < 70 ? 1 : 0, hop: k === 200 ? 1 : 0 }));
  assert.ok(predicted(g, words) >= words.length);
  assert.ok(held(g, 0), 'P1 holds the bomb');
  // now P2's (far off), and P1 near the edge as it goes off: the next wave's edge falls in under P1
  take(g, 0);
  give(g, 1, 300);
  const R = sched(g.v).rnext;
  put(g, 0, C + R - 0.4, C);
  put(g, 1, C - 10, C);
  put(g, 2, C, C - 9);
  const boom = hdr(g, L.HP_BOOM);
  at(g, boom - 20);
  const still = Array(60).fill(partyWord({ yaw: 4096 }));
  assert.ok(predicted(g, still) >= still.length);
  assert.ok(g.v.partier(1).out, 'P2 blown');
  assert.ok(sched(g.v).rnext < R - 0.5, 'the edge to come in');
  // creeping along the edge as it comes in, till it goes from under P1
  const creep = (k) => partyWord({ yaw: 4096, move: k % 60 < 3 ? 1 : 0 });
  for (let n = 0; n < 60 && g.v.partier(0).pos[1] > PLAT_Y - 5; n++) assert.ok(predicted(g, Array.from({ length: 10 }, (_, k) => creep(n * 10 + k))) >= 10);
  assert.ok(g.v.partier(0).pos[1] < PLAT_Y - 1 && !g.v.partier(0).out, 'P1 went over the edge, predicted all the way');
});

// A round of AI balls (client/party-bot.mjs) steered by this minigame's brain on the debug build, stats from it.
async function aiRound(balls, ticks, seed) {
  const stats = { start: -1, over: -1, booms: [], passes: 0, places: null, pts: null, winner: -1 };
  let seen = 0;
  const r = await playParty({ bytes: partyBytes(true), mg: L.MG_POTATO, bots: balls, ticks, seed, onTick: (t, sim, v) => {
    const g = v.party();
    for (; seen < v.fxCount(); seen++) {
      const x = v.fx(seen);
      if (stats.over >= 0) continue;
      if (x.kind === L.HP_FX_PASS) stats.passes++;
      if (x.kind === L.HP_FX_BOOM) stats.booms.push({ t, blown: x.shot, left: g.left });
    }
    if (stats.start < 0 && g.state === L.H_PLAY) stats.start = t;
    if (stats.over < 0 && stats.start >= 0 && g.state === L.H_OVER) {
      stats.over = t;
      stats.winner = g.winner;
      stats.places = [...Array(balls).keys()].map((p) => v.partier(p).place);
      stats.pts = [...Array(balls).keys()].map((p) => v.partier(p).pts);
    }
  } });
  return { ...r, stats };
}

for (const [balls, ticks, seed] of [[8, 8000, 3], [64, 13000, 5]]) {
  test(`a round of ${balls} AI balls on the debug build: no trap, waves till one is left, bombs passed; equal on 1 and 4 threads`, async () => {
    const { log, sim, stats, games } = await aiRound(balls, ticks, seed);
    assert.equal(sim.error().code, 0);
    assert.ok(games.every((x) => x === L.MG_POTATO));
    assert.ok(stats.over > 0, 'the round ended');
    const secs = (stats.over - stats.start) * TICK;
    assert.ok(secs > 25 && secs < L.HP_LEN * TICK, `${secs.toFixed(1)} s of play`);
    assert.ok(stats.booms.length >= 3, `${stats.booms.length} waves`);
    assert.ok(stats.booms[0].left >= balls / 3, `${stats.booms[0].left} of ${balls} still in after the first (${stats.booms.map((b) => b.left)})`);
    assert.ok(stats.passes >= 2 * stats.booms.length, `${stats.passes} passes`);
    assert.ok(stats.places.every((x) => x >= 1 && x <= balls), `places ${stats.places}`);
    assert.ok(stats.pts.every((x) => x >= 1 && x <= 10), `points ${stats.pts}`);
    assert.ok(stats.places.includes(1) && stats.pts.includes(10), 'somebody won');
    const parsed = parseLog(log);
    const n = stats.over + 50;
    const a = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 1, tag: 't1' });
    const b = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 4, tag: 't4', startWorkers });
    const d = await replay({ bytes: partyBytes(true), log: parsed, ticks: n, threads: 1, tag: 'd1' });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(d.trace).tickHashes], 'the debug build steps the same bits');
  });
}

test('the client module: draws the countdown, a wave, a boom and the edge falling; frames the stage; its HUD lines; its brain flees bombs and chases with one', async () => {
  const { Scene } = await import('../client/party-render.mjs');
  const g = await room(6, { play: false, seed: 41 });
  const out = () => ({ scene: new Scene(24000), solid: [], glow: [], beams: [], decals: [], casters: [], paint: null });
  const lines = [];
  const hctx = { put: (x, y, s, c) => lines.push([y, s, c]), centre: (y, s, c) => lines.push([y, s, c]), right: (y, s, c) => lines.push([y, s, c]),
    rect: () => {}, rows: 44, C: {}, slot: 0, now: 0 };
  const draw = (t) => {
    const o = out();
    potato.draw(g.v, { tick: g.v.tick, t: t * TICK, dt: 0, now: 0, slot: 0 }, o);
    for (let k = 0; k < o.scene.count * 16; k++) assert.ok(Number.isFinite(o.scene.data[k]), 'finite');
    return o;
  };
  // the countdown: the stage, the sign, the picks' unlit bombs
  let o = draw(-1);
  const picks = [...Array(6).keys()].filter((p) => pick(g, p) === 1).length;
  assert.equal(o.solid.filter((x) => x.kind === 11).length, 1 + picks, 'the sign and the picks\' bombs');
  while (g.v.hole().state !== L.H_PLAY || playT(g) <= L.HP_DEAL0 + 500) g.step();
  o = draw(playT(g));
  assert.equal(o.solid.filter((x) => x.kind === 11 && x.size < 1).length, [...Array(6).keys()].filter((p) => holds(g.v, p)).length, 'a bomb over every holder');
  assert.ok(o.solid.every((x) => x.kind !== 11 || (x.roll > 0 && x.roll < 1)), 'heating');
  lines.length = 0;
  potato.hud(g.v, { ...hctx, t: playT(g) * TICK });
  assert.ok(lines.some((l) => l[1].startsWith('BOOM IN')), lines.map((l) => l[1]).join(' | '));
  for (const l of lines) assert.ok(l[1].length <= 80, l[1]);
  // the brain: a ball without a bomb fears a holder near, and the edge; a holder chases
  const w = [...Array(6).keys()];
  const h = w.find((p) => holds(g.v, p)), q = w.find((p) => !holds(g.v, p) && !g.v.partier(p).out);
  const hb = g.v.partier(h);
  const tick = g.v.tick;
  assert.ok(potato.brain.danger(g.v, hb.pos[0] + 1.5, hb.pos[2], tick, q) > 0.4, 'by a holder');
  assert.equal(potato.brain.danger(g.v, hb.pos[0] + 1.5, hb.pos[2], tick, h), 0, 'nothing to a holder');
  const R = sched(g.v).rnext;
  assert.equal(potato.brain.danger(g.v, C + R + 1, C, tick, q), 1, 'past the edge');
  const qb = g.v.partier(q);
  const word = potato.brain.think(g.v, hb, { slot: h, mem: {}, skill: 1, pos: [hb.pos[0], hb.pos[2]], vel: [0, 0] }, tick);
  assert.ok(word && Math.abs(word.yaw) <= Math.PI + 1e-9 && word.move === 1, 'a holder steers itself');
  assert.equal(potato.brain.think(g.v, qb, { slot: q, mem: {}, skill: 1, pos: [qb.pos[0], qb.pos[2]], vel: [0, 0] }, tick), null, 'the rest leave it to the planner');
  const goal = potato.brain.goal(g.v, qb, { slot: q, mem: {}, pos: [qb.pos[0], qb.pos[2]], rand: () => 0.5 });
  assert.ok(Math.hypot(goal[0] - C, goal[1] - C) <= R - 3 + 1e-6, 'kept off the edge');
  // a boom: fireballs where the holders stood, the edge going in pieces
  const boom = hdr(g, L.HP_BOOM);
  at(g, boom);
  g.step();
  const s = sched(g.v);
  o = draw(boom + 2);
  assert.ok(o.glow.length >= 2, 'a fireball');
  o = draw(boom + L.HP_SHRINK0 + 60);
  const ring = o.scene.count;
  assert.ok(ring > 20, `${ring} solids with the edge in pieces`);
  o = draw(s.deal + 400);
  assert.ok(o.scene.count < ring, 'gone after');
  const fr = potato.frame(g.v);
  assert.equal(fr.shape, 'disc');
  assert.ok(potato.hint.length <= 70);
});
