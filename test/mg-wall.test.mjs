import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty, partyBytes, predicted } from './helpers.mjs';
import { View, partyWord, PLAT_Y } from '../src/party-view.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { playParty } from '../tools/genparty.mjs';
import * as L from '../src/layout.mjs';
import wall, { table, face, sway, over, laneAt, toWall, toWorld, gapAt, blocksAt, blocked, meet, passed } from '../client/mg/wall.mjs';

const C = L.B_CX;
const TICK = 0.008;
const f = Math.fround;

// A room of n balls on The Wall, on the debug build (a NaN traps).
async function room(n = 2, { play = true, seed = 7 } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_WALL + 1, true);
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
// Ball p at (u, v) in wall W's frame.
const putW = (g, p, W, u, v, o) => { const [x, z] = toWorld(table(g.v), W, u, v); put(g, p, x, z, o); };
// Where ball p is in wall W's frame.
const inW = (g, p, W) => { const b = g.v.partier(p); return toWall(table(g.v), W, b.pos[0], b.pos[2]); };
// The next step plays tick t into play (the clock moved; the round's end with it).
function at(g, t) {
  const now = g.v.tick;
  g.dv.setUint32(L.HDR_START, now - t, true);
  g.dv.setUint32(L.HDR_UNTIL, now - t + L.WL_LEN, true);
}
const playT = (g) => g.v.party().t; // the tick into play the step just played
const fxs = (v, kind) => { const out = []; for (let k = 0; k < v.fxCount(); k++) { const x = v.fx(k); if (x.kind === kind) out.push(x); } return out; };
// The half-width the stage has for n balls.
const half = (n) => f(Math.min(f(f(f(Math.sqrt(n)) * f(L.WL_HK)) + L.WL_H0), L.WL_HMAX));
// Steps until play reaches tick t into play.
const until = (g, t, recs) => { while (playT(g) < t) g.step(recs?.()); };
// Only wall w on the stage from now on: the table's walls before it gone, none after it.
function alone(g, w) {
  g.dv.setUint32(L.PG_H + L.WL_LIVE, w, true);
  g.dv.setUint32(L.PG_H + L.WL_NW, w + 1, true);
  return table(g.v).walls[w];
}

test('the stage for 1, 8, 64 and 256: a square sized for the crowd, every ball on its floor on a grid, apart; the round\'s walls in a table', async () => {
  let last = 0;
  for (const n of [1, 8, 64, 256]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party();
    const T = table(g.v);
    assert.equal(r.game, L.MG_WALL);
    assert.equal(r.size, half(n), `${r.size} m for ${n}`);
    assert.equal(T.h, r.size);
    assert.ok(r.size > last || r.size === L.WL_HMAX, 'grows with the crowd');
    last = r.size;
    assert.deepEqual([r.kind, r.len, r.floor, r.idle, r.drag, r.hop, r.flags], [L.PK_OUT, L.WL_LEN, PLAT_Y, f(L.WL_IDLE), f(Number(L.BPHYS.B_DRAG)), 6, L.PGF_BUMPS]);
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p);
      assert.equal(b.pos[1], PLAT_Y);
      assert.ok(Math.abs(b.pos[0] - C) <= L.WL_SPREAD * r.size && Math.abs(b.pos[2] - C) <= L.WL_SPREAD * r.size, `${n}: P${p + 1} on the middle of the square`);
      for (let q = 0; q < p; q++) {
        const o = g.v.partier(q);
        assert.ok(Math.hypot(o.pos[0] - b.pos[0], o.pos[2] - b.pos[2]) >= 4.9, `${n}: P${p + 1} and P${q + 1} apart`);
      }
    }
    // the table: walls in the order they move, their schedule, speed, gaps and sides
    assert.ok(T.walls.length >= 25 && T.walls.length <= L.WL_NMAX, `${T.walls.length} walls`);
    const span = f(r.size + r.size);
    const k0 = Math.min(L.WL_KMAX, 1 + Math.floor(span / L.WL_SPAN));
    T.walls.forEach((W, w) => {
      const tau = f(f(W.go) * f(0.008));
      assert.equal(W.go, w ? T.walls[w - 1].go + Math.max(L.WL_WARN, Math.floor(f(f(f(Math.min(span, L.WL_CAD)) * f(L.WL_NEXT)) / f(T.walls[w - 1].v * f(0.008))))) : L.WL_GO0);
      assert.ok(W.go < L.WL_LEN);
      assert.equal(W.start, w ? W.go - L.WL_WARN : 0);
      assert.equal(W.end, W.go + 1 + Math.floor(f(f(span + 5.5) / f(W.v * f(0.008)))));
      assert.equal(W.v, f(Math.min(f(f(tau * f(L.WL_VK)) + L.WL_V0), L.WL_VMAX)));
      assert.equal(W.g, f(Math.max(f(f(L.WL_G0) - f(tau * f(L.WL_GK))), f(L.WL_GMIN))));
      assert.equal(W.k, Math.max(1, k0 - Math.floor(f(f(f(k0 - 1) * tau) / L.WL_KEND))));
      // gaps one to a slot, ascending, a block of WL_MARGIN at least between them and at the edges, sway and all
      const sw = span / W.k;
      W.gaps.forEach((c, j) => {
        const mid = -r.size + sw * (j + 0.5);
        assert.ok(Math.abs(c - mid) + W.a <= Math.max(0, (sw - W.g) / 2 - L.WL_MARGIN) + 1e-4, `${n}: wall ${w} gap ${j} in its slot`);
      });
      assert.equal(W.a > 0, (w & 1) === 1 && W.go >= L.WL_SWAY && (sw - W.g) / 2 - L.WL_MARGIN > 0, `${n}: wall ${w} sways or not`);
      assert.ok(W.a <= f(L.WL_SWAYA));
      // never head on to a wall still on the stage; the last one's side again, or the one longest unused of the rest
      let mask = 15;
      for (let j = 0; j < w; j++) if (T.walls[j].end > W.start) mask &= ~(1 << ((T.walls[j].side + 2) & 3));
      assert.ok(mask & (1 << W.side), `${n}: wall ${w} head on to one still on the stage`);
      if (w) {
        assert.ok(T.walls[w - 1].end < W.end, 'walls go in the order they move');
        const prev = T.walls[w - 1].side;
        const last = (side) => T.walls.slice(0, w).map((X) => X.side).lastIndexOf(side);
        const others = [0, 1, 2, 3].filter((x) => x !== prev && mask & (1 << x));
        const oldest = Math.min(...others.map(last));
        assert.ok(W.side === prev || last(W.side) === oldest, `${n}: wall ${w} from ${W.side}, after ${prev}`);
      }
    });
    assert.equal(T.walls.at(-1).w + 1, T.walls.length);
    assert.equal(T.walls[0].k, k0);
    assert.ok(T.walls.at(-1).k <= 2 && T.walls.at(-1).v === L.WL_VMAX && T.walls.at(-1).g === f(L.WL_GMIN), 'the last walls the hardest');
    assert.ok(new Set(T.walls.map((W) => W.side)).size >= 3, `${n}: from all round`);
  }
});

test('the floor holds over the square and nothing past its edge: a ball rolling off falls and is out', async () => {
  const g = await room(2);
  const h = table(g.v).h;
  put(g, 0, C + h - 1.2, C, { vx: 6 });
  put(g, 1, C - 4, C - 4);
  let k = 0;
  while (g.v.partier(0).ground && k++ < 100) g.step();
  const b = g.v.partier(0);
  assert.ok(b.pos[0] - C > h && b.pos[0] - C < h + 0.2, `off the edge at ${b.pos[0] - C}`);
  assert.ok(g.v.partier(1).ground);
  while (!g.v.partier(0).out && k++ < 600) g.step();
  assert.ok(g.v.partier(0).out);
  assert.equal(g.v.party().state, L.H_OVER);
  assert.equal(g.v.party().winner, 1);
});

test('a wall shows at its edge, waits there WL_WARN ticks and then moves at its speed, and is gone past the far edge; its FX on time', async () => {
  const g = await room(2, { seed: 11 });
  const W = alone(g, 3), T = table(g.v);
  putW(g, 0, W, 0, W.gaps[0]);
  putW(g, 1, W, 4, W.gaps.at(-1));
  assert.equal(face(W, W.start), f(-T.h - L.WL_LEAD));
  assert.equal(face(W, W.go), f(-T.h - L.WL_LEAD));
  assert.ok(Math.abs(face(W, W.go + 125) - (face(W, W.go) + W.v)) < 1e-9, 'its speed a second');
  assert.ok(face(W, W.end) - L.WL_T >= T.h + L.WL_PAST && face(W, W.end - 1) - L.WL_T < T.h + L.WL_PAST);
  at(g, W.start - 2);
  const seen0 = g.v.fxCount();
  while (playT(g) < W.end + 2) g.step();
  const mine = (kind) => fxs(g.v, kind).filter((x) => (x.shot & 255) === W.w);
  const [show] = mine(L.WL_FX_SHOW), [go] = mine(L.WL_FX_GO), [gone] = mine(L.WL_FX_GONE);
  const start = g.v.party().start;
  assert.ok(g.v.fxCount() > seen0 && show && go && gone);
  assert.deepEqual([(show.tick - start) | 0, (go.tick - start) | 0, (gone.tick - start) | 0], [W.start, W.go, W.end]);
  assert.equal(show.shot, W.w | (W.side << 8));
  assert.deepEqual([show.owner, show.size, go.size], [255, W.v, W.v]);
  assert.equal(gone.size, 2, 'both balls still in');
  const [x, z] = toWorld(T, W, -T.h - L.WL_LEAD - L.WL_T / 2, 0);
  assert.ok(Math.abs(show.pos[0] - x) < 1e-3 && Math.abs(show.pos[2] - z) < 1e-3 && show.pos[1] === PLAT_Y + L.WL_HIGH / 2, 'at the wall\'s middle');
  // the first shows from the countdown: its FX as play starts
  const g2 = await room(2, { seed: 11, play: false });
  while (g2.v.hole().state !== L.H_PLAY) g2.step();
  const first = fxs(g2.v, L.WL_FX_SHOW);
  assert.equal(first.length, 1);
  assert.equal(first[0].shot, T.walls[0].side << 8);
  assert.equal(first[0].tick, g2.v.party().start);
});

test('a block meets a ball in its way with its face and carries it at the wall\'s speed, off the far edge: out; a ball in a gap\'s lane lets it by', async () => {
  const g = await room(3, { seed: 5 });
  const W = alone(g, 0), T = table(g.v);
  // two wide blocks away from gap 0, the furthest first
  const c = W.gaps[0], [blk, blk2] = blocksAt(T, W, 0).filter(([lo, hi]) => hi - lo > 3 && lo > c).sort((a, b) => Math.abs(b[0] - c) - Math.abs(a[0] - c));
  putW(g, 0, W, 0, c); // in gap 0's lane
  putW(g, 1, W, 0, (blk2[0] + blk2[1]) / 2); // in a block's way
  putW(g, 2, W, -T.h * 0.6, (blk[0] + blk[1]) / 2 + 0.4); // in another's, nearer the wall
  until(g, W.go - 1);
  for (const p of [0, 1, 2]) assert.ok(!g.v.partier(p).out);
  // the ball near the edge is met first, and rides the face
  let met = -1;
  while (playT(g) < W.end) {
    g.step();
    const t = playT(g);
    const [u2] = inW(g, 2, W);
    const s = face(W, t);
    if (met < 0 && u2 - 1 < s + 0.2) met = t;
    if (met >= 0 && t > met + 5 && !g.v.partier(2).falling && u2 < T.h - 1) {
      assert.ok(Math.abs(u2 - (s + 1)) < 0.1, `on the face: ${u2} against ${s + 1}`);
      const b = g.v.partier(2);
      assert.ok(b.vel[0] * W.ux + b.vel[2] * W.uz >= W.v * 0.97, 'carried at the wall\'s speed');
    }
    const [u0, v0] = inW(g, 0, W);
    assert.ok(Math.abs(v0 - c) < 1e-3 && Math.abs(u0) < 1e-3, `the ball in the gap never touched: ${u0} ${v0 - c} at ${playT(g)}`);
  }
  assert.ok(met > W.go, 'met');
  for (let k = 0; k < 400 && !(g.v.partier(1).out && g.v.partier(2).out); k++) g.step();
  assert.ok(g.v.partier(1).out && g.v.partier(2).out, 'both carried off the far edge');
  assert.ok(!g.v.partier(0).out);
  assert.equal(passed(g.v, 0), 1);
  assert.deepEqual([passed(g.v, 1), passed(g.v, 2)], [0, 0]);
  // each pinned once by it: its FX and PG_M's bit
  const pins = fxs(g.v, L.WL_FX_PIN);
  assert.deepEqual(pins.map((x) => x.owner).sort(), [1, 2]);
  assert.ok(pins.every((x) => x.shot === 0 && Math.abs(x.size - W.v) < 1e-5));
  assert.equal(g.v.partier(1).m & 1, 1);
  assert.equal(g.v.partier(0).m, 0);
  assert.equal(g.v.party().winner, 0);
});

test('a waiting wall touches nobody, even a ball on its edge; a ball over the wall\'s top lets it by', async () => {
  const g = await room(2, { seed: 5 });
  const W = alone(g, 0), T = table(g.v);
  const blk = blocksAt(T, W, 0).find(([lo, hi]) => hi - lo > 3);
  putW(g, 0, W, -T.h + 0.01, (blk[0] + blk[1]) / 2);
  const b0 = g.v.partier(0);
  until(g, W.go);
  const b = g.v.partier(0);
  assert.deepEqual([b.pos, b.vel], [b0.pos, b0.vel], 'still where it was');
  // over the top: up and held there, the wall goes under
  putW(g, 1, W, -T.h + 5, (blk[0] + blk[1]) / 2, { y: PLAT_Y + L.WL_HIGH + 0.01, ground: false });
  for (let k = 0; k < 260; k++) {
    g.dv.setFloat32(rec(1) + L.P_PY, PLAT_Y + L.WL_HIGH + 0.01, true);
    g.dv.setFloat32(rec(1) + L.P_VY, 0, true);
    g.step();
  }
  assert.ok(face(W, playT(g)) - L.WL_T > -T.h + 6, 'the wall went by under it');
  assert.ok(Math.abs(inW(g, 1, W)[0] - (-T.h + 5)) < 1e-4, 'not shoved');
});

test('a gap\'s corner turns a ball half over its edge aside into the gap; a pinned ball slides along the face into a gap and is through', async () => {
  const g = await room(3, { seed: 5 });
  const W = alone(g, 0), T = table(g.v);
  const c = W.gaps[1], c2 = W.gaps[2];
  // centre 0.7 m inside gap 1's span, the ball 0.3 m over its edge
  putW(g, 0, W, 0, c - W.g / 2 + 0.7);
  // pinned on a block a ball's width from gap 2, it steers across the face
  putW(g, 1, W, T.h * 0.3, c2 + W.g / 2 + 1.8);
  until(g, W.go);
  const across = Math.round(Math.atan2(-W.ux, W.uz) / (2 * Math.PI) * 16384) & 16383; // -v: toward the gap
  let k = 0, carried = 0, through = null;
  while (playT(g) < W.end && k++ < 4000) {
    const [u1, v1] = inW(g, 1, W), s = face(W, playT(g));
    if (!through && u1 + 1 < s - L.WL_T) through = v1;
    // across the face till it's over the gap, then no keys (the idle brake holds it there)
    const pushing = !through && s > u1 - 1.05 && v1 - c2 > W.g / 2 - 1.2;
    g.step([[L.EV_INPUT, 1, partyWord({ yaw: across, move: pushing ? 1 : 0 })]]);
    if (pushing && !g.v.partier(1).out) carried++;
  }
  const [u0, v0] = inW(g, 0, W);
  assert.ok(!g.v.partier(0).out, 'through');
  assert.ok(Math.abs(u0) < 1, `hardly shoved along: ${u0}`);
  assert.ok(v0 > c - W.g / 2 + 0.99 && v0 < c, `turned in off the corner: ${v0 - c}`);
  assert.ok(!g.v.partier(1).out, 'slid into the gap');
  assert.ok(carried > 10, `rode the face ${carried} ticks`);
  assert.ok(through !== null && Math.abs(through - c2) < W.g / 2, `through gap 2: ${through - c2}`);
  assert.equal(fxs(g.v, L.WL_FX_PIN).filter((x) => x.shot === 0 && x.owner === 1).length, 1, 'pinned once, its FX once');
});

test('the ramp: faster walls, narrower and fewer gaps, from WL_SWAY every other one swaying; a ball on a swaying wall\'s snake gets through', async () => {
  const g = await room(64, { seed: 21, play: false });
  const T = table(g.v);
  const at40 = T.walls.find((W) => W.go >= L.WL_SWAY);
  assert.ok(T.walls.filter((W) => W.a > 0).length >= 5);
  assert.ok(T.walls.slice(0, at40.w).every((W) => W.a === 0));
  // the sway: still till it moves, then a sine of the tick, a sway every 512 ticks
  const S = T.walls.find((W) => W.a > 0);
  assert.equal(sway(S, S.start), sway(S, S.go));
  assert.ok(Math.abs(sway(S, S.go + 512) - sway(S, S.go)) < 1e-9);
  assert.ok(Math.abs(sway(S, S.go + 128) - S.a * Math.cos(2 * Math.PI * S.ph / 16384)) < 1e-6);
  // in the sim: balls on the snake go through (the gap's sides nudging them along with it, never shoving them
  // on), one where the gap was when the wall moved is met by a block and carried off
  const g2 = await room(3, { seed: 21 });
  const S2 = alone(g2, table(g2.v).walls.find((W) => W.a > 0 && W.k >= 2).w), T2 = table(g2.v);
  at(g2, S2.go - 1);
  const us = [-T2.h * 0.5, T2.h * 0.3];
  us.forEach((u, p) => putW(g2, p, S2, u, laneAt(S2, 0, u)));
  // the third right on the lane's edge where the wall will pass it: half on the block
  const far = T2.h * 0.6;
  putW(g2, 2, S2, far, laneAt(S2, S2.k - 1, far) + S2.g / 2 + 0.9);
  g2.step();
  let shoved = 0;
  while (playT(g2) < S2.end) {
    g2.step();
    for (const p of [0, 1]) shoved += Math.abs(inW(g2, p, S2)[0] - us[p]) > 0.02;
  }
  assert.equal(shoved, 0, 'the snake is the way through');
  assert.ok(!g2.v.partier(0).out && !g2.v.partier(1).out);
  assert.ok(fxs(g2.v, L.WL_FX_PIN).some((x) => x.owner === 2), 'off it, met by a block');
});

test('the last ball on wins; two last balls both shoved off together share the win rather than last', async () => {
  const g = await room(3, { seed: 5 });
  const W = alone(g, 0), T = table(g.v);
  const blk = blocksAt(T, W, 0).find(([lo, hi]) => hi - lo > 6);
  putW(g, 0, W, 0, blk[0] + 1.5);
  putW(g, 1, W, 0, blk[0] + 4);
  putW(g, 2, W, 2, W.gaps[0]);
  // the one in the gap rolls itself off the edge first
  g.dv.setFloat32(rec(2) + L.P_PX, C + T.h + 0.5, true);
  g.dv.setFloat32(rec(2) + L.P_PZ, C + T.h + 0.5, true);
  while (!g.v.partier(2).out) g.step();
  assert.equal(g.v.partier(2).place, 3);
  while (g.v.party().state === L.H_PLAY) g.step();
  const r = g.v.party();
  assert.equal(r.winner, 255, 'shared');
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).place), [1, 1, 3]);
  assert.deepEqual([0, 1].map((p) => g.v.partier(p).wins), [1, 1]);
  assert.ok([0, 1].every((p) => g.v.partier(p).falling), 'they were both falling when it ended');
});

test('the prediction matches the confirmed ball bit for bit: met by a face, riding it, sliding across it, through a gap, a swaying wall, off the edge', async () => {
  const g = await room(2, { seed: 5 });
  const T = table(g.v);
  const W = T.walls[0];
  const blk = blocksAt(T, W, 0).find(([lo, hi]) => hi - lo > 3);
  putW(g, 1, W, -T.h * 0.8, W.gaps[0]);
  putW(g, 0, W, -T.h * 0.5, (blk[0] + blk[1]) / 2);
  until(g, W.go - 20);
  // keys every way while the wall comes and carries it
  const words = Array.from({ length: 700 }, (_, k) => partyWord({ yaw: (k * 389) & 16383, move: (k >> 5) & 1 ? 1 : (k >> 3) & 1 ? 4 : 0 }));
  assert.ok(predicted(g, words) >= 700);
  // a swaying wall, a ball on its face sliding toward a gap
  const g2 = await room(2, { seed: 21 });
  const S = alone(g2, table(g2.v).walls.find((V) => V.a > 0).w), T2 = table(g2.v);
  at(g2, S.go + 20);
  g2.step();
  const s = face(S, playT(g2));
  putW(g2, 0, S, s + 1.02, S.gaps[0] + sway(S, playT(g2)) + S.g / 2 + 1.2);
  putW(g2, 1, S, T2.h - 3, laneAt(S, S.k - 1, T2.h - 3));
  const across = Math.round(Math.atan2(S.ux, -S.uz) / (2 * Math.PI) * 16384) & 16383;
  const more = Array.from({ length: 500 }, (_, k) => partyWord({ yaw: (across + ((k * 97) % 3000) - 1500) & 16383, move: k % 40 < 30 ? 1 : 0, hop: k % 90 === 0 ? 1 : 0 }));
  assert.ok(predicted(g2, more) >= 500);
  assert.ok(fxs(g2.v, L.WL_FX_PIN).some((x) => x.owner === 0), 'it was pinned');
});

// A round of Partier balls (client/party-bot.mjs, steered by this minigame's
// brain) on the debug build, as tools/genparty.mjs plays one: the log, how the
// round went.
async function aiRound(balls, seed) {
  const stats = { start: -1, over: -1, left: [], places: null, pts: null, winner: -1 };
  const { log, sim } = await playParty({ bytes: partyBytes(true), seed, mg: L.MG_WALL, bots: balls, ticks: 16500, delay: 6, onTick: (t, s, v) => {
    assert.equal(s.error().code, 0, 'no trap');
    const g = v.party();
    if (stats.start < 0 && g.state === L.H_PLAY) stats.start = t;
    if (stats.start >= 0 && stats.over < 0 && (t - stats.start) % 1250 === 0) stats.left.push(g.left);
    if (stats.over < 0 && stats.start >= 0 && g.state === L.H_OVER) {
      stats.over = t;
      stats.winner = g.winner;
      stats.places = [...Array(balls).keys()].map((p) => v.partier(p).place);
      stats.pts = [...Array(balls).keys()].map((p) => v.partier(p).pts);
    }
  } });
  return { log, sim, stats };
}

for (const [balls, seed] of [[8, 3], [64, 4]]) {
  test(`a round of ${balls} AI balls on the debug build: no trap, outs spread over the round, someone wins; equal on 1 and 4 threads`, async () => {
    const { log, stats } = await aiRound(balls, seed);
    assert.ok(stats.over > 0, 'the round ended');
    const secs = (stats.over - stats.start) * TICK;
    assert.ok(secs > 40 && secs <= L.WL_LEN * TICK, `${secs.toFixed(1)} s of play (left every 10 s: ${stats.left})`);
    assert.ok(stats.left[2] > balls / 2, `still ${stats.left[2]} of ${balls} in at 20 s`);
    assert.ok(stats.left.at(-1) < balls / 2, `${stats.left.at(-1)} of ${balls} at the last count`);
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

test('the client module: draws every phase, frames the square, writes its HUD lines, and its brain sees the walls the sim pushes with', async () => {
  const { Scene } = await import('../client/party-render.mjs');
  const g = await room(3, { seed: 41, play: false });
  const T = table(g.v);
  const out = { scene: new Scene(24000), solid: [], glow: [], beams: [], decals: [], casters: [], paint: null };
  const lines = [];
  const hctx = { put: (x, y, s, c) => lines.push([y, s, c]), centre: (y, s, c) => lines.push([y, s, c]), right: (y, s, c) => lines.push([y, s, c]), rows: 44, C: {}, slot: 0, now: 0 };
  const draw = () => {
    out.scene.clear(); lines.length = 0;
    const r = g.v.party();
    const t = r.state === L.H_PLAY ? r.t : 0;
    wall.draw(g.v, { tick: g.v.tick, ptick: g.v.tick, t: t * TICK, dt: 0, now: 0, slot: 0, me: g.v.partier(0) }, out);
    for (let k = 0; k < out.scene.count * 16; k++) assert.ok(Number.isFinite(out.scene.data[k]), 'finite');
    wall.hud(g.v, { ...hctx, me: g.v.partier(0), t: t * TICK });
    for (const l of lines) assert.ok(l[1].length <= 80, l[1]);
    return lines.map((l) => l[1]).join(' | ');
  };
  draw();
  assert.ok(out.scene.count > 5, 'the floor and the first wall in the countdown');
  while (g.v.hole().state !== L.H_PLAY) g.step();
  const S = T.walls.find((W) => W.a > 0);
  for (const t of [10, T.walls[1].start + 5, T.walls[2].go + 100, S.go + 60]) {
    at(g, t);
    g.step();
    const text = draw();
    assert.ok(text.includes('WALL '), text);
  }
  // pinned and in a gap, as the HUD tells it
  const W = onAt(T, playT(g));
  putW(g, 0, W, face(W, playT(g) + 1) + 0.9, blocksAt(T, W, playT(g)).find(([lo, hi]) => hi - lo > 3)[0] + 1.5);
  g.step();
  assert.ok(draw().includes('PINNED'), 'pinned');
  putW(g, 0, W, face(W, playT(g)) + 6, laneAt(W, 0, face(W, playT(g)) + 6));
  g.step();
  assert.ok(draw().includes('IN A GAP'), 'in a gap');
  const fr = wall.frame(g.v);
  assert.deepEqual([fr.shape, fr.radius], ['square', T.h]);
  assert.ok(wall.hint.length <= 70);
  assert.equal(wall.facing(g.v), Math.atan2(-T.walls[0].uz, -T.walls[0].ux));
  // danger: where a block is on a tick, the sim's push says so too
  const start = g.v.party().start;
  for (const t of [W.go + 40, W.go + 200, S.go + 30]) {
    let hits = 0;
    for (const X of T.walls) {
      if (t < X.start || t >= X.end) continue;
      for (let v = -T.h; v <= T.h; v += 0.37) {
        const [x, z] = toWorld(T, X, face(X, t) - 0.3, v);
        if (Math.abs(x - C) > T.h || Math.abs(z - C) > T.h) continue;
        const b = blocked(T, X, x, z, t);
        if (b) { assert.equal(wall.brain.danger(g.v, x, z, start + t), 0.9); hits++; }
        else if (gapAt(X, toWall(T, X, x, z)[1], t) >= 0 && !onStage(T, t).some((Y) => Y !== X && blocked(T, Y, x, z, t))) assert.ok(wall.brain.danger(g.v, x, z, start + t) <= 0.5);
      }
    }
    assert.ok(hits > 5);
  }
  assert.equal(wall.brain.danger(g.v, C + T.h + 1, C, start + 10), 1, 'off the square');
  assert.equal(meet(T, W, ...toWorld(T, W, face(W, W.go) + 10, 0), W.go).eta, 10 / W.v - 1 / W.v);
  assert.ok(Math.abs(over(W, 0) - (W.go + (L.WL_T / 2 - W.s0) / (W.v * TICK))) < 1e-9);
});
// The wall on the stage that has moved furthest at t.
function onAt(T, t) {
  let best = null;
  for (const W of T.walls) if (W.start <= t && t < W.end && t > W.go && face(W, t) < T.h - 4 && face(W, t) > -T.h + 2) best = W;
  return best;
}
const onStage = (T, t) => T.walls.filter((W) => W.start <= t && t < W.end);
