// TILT TABLE (src/mg/tilt.wat): the table for the crowd, its schedule of
// tilts from the seed, the plane a ball rides and the pull down it, the
// edges crumbling, the outs and the end, the prediction through all of it,
// and rounds of AI balls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty, partyBytes, predicted } from './helpers.mjs';
import { View, partyWord, PLAT_Y, hash32, seed as pseed } from '../src/party-view.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { playParty } from '../tools/genparty.mjs';
import { Partier } from '../client/party-bot.mjs';
import * as L from '../src/layout.mjs';
import * as MC from '../src/mg/tilt.mjs'; // TT_*: the minigame's own constants
import tilt, { stage, moveAt, gradAt, planeAt, dropsAt, halfOf, halfAt, onTable, degOf } from '../client/mg/tilt.mjs';

const C = L.B_CX;
const TICK = 0.008;
const TURN = 16384;
const f = Math.fround;

// A room of n balls on Tilt Table, on the debug build (a NaN traps), stepped into play unless asked not to.
async function room(n = 2, { play = true, seed = 7 } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_TILT + 1, true);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); assert.equal(sim.error().code, 0, 'no trap'); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  while (play && v.hole().state !== L.H_PLAY) step();
  return { sim, v, dv, step };
}
const rec = (p) => L.PLAYERS + p * L.PSIZE;
// The next step plays tick t into play (the clock moved; the round's end with it).
function at(g, t) {
  const now = g.v.tick;
  g.dv.setUint32(L.HDR_START, now - t, true);
  g.dv.setUint32(L.HDR_UNTIL, now - t + MC.TT_LEN, true);
}
const playT = (g) => g.v.party().t; // the tick into play the next step plays
// Ball p at (x, z) from the middle on the table's top as it stands on tick t (or y over it), rolling at (vx, vz).
function put(g, p, x, z, t, { y = 0, vx = 0, vz = 0, ground = true } = {}) {
  const st = stage(g.v);
  g.dv.setFloat32(rec(p) + L.P_PX, f(C + x), true);
  g.dv.setFloat32(rec(p) + L.P_PY, f(planeAt(...gradAt(st, t), f(C + x) - C, f(C + z) - C) + y), true);
  g.dv.setFloat32(rec(p) + L.P_PZ, f(C + z), true);
  g.dv.setFloat32(rec(p) + L.P_VX, vx, true);
  g.dv.setFloat32(rec(p) + L.P_VY, 0, true);
  g.dv.setFloat32(rec(p) + L.P_VZ, vz, true);
  g.dv.setUint8(rec(p) + L.P_FL, L.PF_LIVE | (ground ? L.PF_GROUND : 0));
}
// Ball p out of the way: on the table, still, at (x, z) from the middle.
const park = (g, p, x, z) => put(g, p, x, z, playT(g));
const fxs = (v, kind, from = 0) => { const out = []; for (let k = from; k < v.fxCount(); k++) { const x = v.fx(k); if (x.kind === kind) out.push(x); } return out; };
// The top under ball p as the table stands on tick t, and how far over it the ball is.
const over = (g, p, t) => { const b = g.v.partier(p); return f(b.pos[1] - planeAt(...gradAt(stage(g.v), t), f(b.pos[0] - C), f(b.pos[2] - C))); };
// The yaw word for the way (x, z).
const yawTo = (x, z) => Math.round((Math.atan2(z, x) / (2 * Math.PI)) * TURN) & (TURN - 1);
// The first move from k0 of a kind (and, if given, slope along x), and its index.
const find = (st, pred, k0 = 0) => { for (let k = k0; k < st.n; k++) if (pred(st.moves[k], k)) return k; return -1; };

// $tt_plan worked again here: the moves the round's seed lays out, in f32 where the sim works in f32.
function planOf(v) {
  const base = pseed(v, MC.TT_KSEED);
  const out = [];
  let t = MC.TT_FIRST, prev = MC.TT_K_LEVEL, last = 0;
  for (let k = 0; k < MC.TT_NMAX && t < MC.TT_LEN; k++) {
    const h = hash32(k, MC.TT_KSEED, base);
    let s = f(f(f(MC.TT_S1 - MC.TT_S0) * Math.min(f(t / MC.TT_RAMP), 1)) + f(MC.TT_S0));
    s = f(f(f(f(f((h >>> 8) & 255) * f(2 / 255)) - 1) * f(MC.TT_SJIT)) + s);
    let kind = MC.TT_K_TILT, tip = MC.TT_TIP, dir;
    let wait = MC.TT_HOLD0 + Math.floor((t * (MC.TT_HOLD1 - MC.TT_HOLD0)) / MC.TT_LEN);
    if (prev === MC.TT_K_LEVEL) dir = ((last + (last ? h % 3 : h & 3)) % 4) + 1;
    else if (prev === MC.TT_K_TILT && t >= MC.TT_CHAIN0 && (h >>> 16) & 1) { kind = MC.TT_K_SWING; tip = MC.TT_SWING; dir = ((last - 1) ^ 1) + 1; }
    else { kind = MC.TT_K_LEVEL; dir = MC.TT_LEVEL; s = 0; wait = MC.TT_REST0 - Math.floor((t * (MC.TT_REST0 - MC.TT_REST1)) / MC.TT_LEN); }
    out.push({ t, gx: dir === 1 ? s : dir === 2 ? -s : 0, gz: dir === 3 ? s : dir === 4 ? -s : 0, tip, dir, kind });
    if (dir) last = dir;
    prev = kind;
    t += tip + wait;
  }
  return out;
}

test('the stage for 1, 8, 64 and 256: a table sized for the crowd, its knobs and lowest floor, every ball on it, apart, still', async () => {
  let last = 0;
  for (const n of [1, 8, 64, 256]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party();
    const h = f(Math.min(f(f(f(Math.sqrt(n)) * MC.TT_HK) + MC.TT_H0), MC.TT_HMAX));
    assert.equal(r.game, L.MG_TILT);
    assert.equal(r.size, h, `${r.size} m for ${n}`);
    assert.ok(r.size >= last, 'grows with the crowd');
    last = r.size;
    assert.deepEqual([r.kind, r.len, r.flags], [L.PK_OUT, MC.TT_LEN, L.PGF_BUMPS]);
    assert.equal(r.floor, f(f(PLAT_Y) - f(f(h * f(MC.TT_S1 + MC.TT_SJIT)) + 2)), 'the lowest floor: under the edge tipped its steepest');
    assert.equal(stage(g.v).h0, h);
    const pos = [];
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p);
      assert.ok(b.ground && !b.out && b.pos[1] === PLAT_Y, `${n}: P${p + 1} on the table`);
      assert.ok(Math.hypot(b.pos[0] - C, b.pos[2] - C) <= h * MC.TT_SPAWN + 1e-3, `${n}: P${p + 1} over the middle`);
      for (const [x, z] of pos) assert.ok(Math.hypot(b.pos[0] - x, b.pos[2] - z) > 2, `${n}: P${p + 1} apart`);
      pos.push([b.pos[0], b.pos[2]]);
    }
    if (n === 8) {
      while (g.v.hole().state !== L.H_PLAY) g.step();
      for (let k = 0; k < 300; k++) g.step();
      for (let p = 0; p < n; p++) assert.deepEqual(g.v.partier(p).pos.map((x, i) => (i === 1 ? x : f(x))), [...pos[p].slice(0, 1), PLAT_Y, pos[p][1]], 'level till the first tilt: still');
    }
  }
});

test('the schedule: from the seed, a tilt toward any side but the last, level between, a swing over only from TT_CHAIN0 and then level; slopes 8 to 25 degrees, holds lengthening; the client reads it as laid out', async () => {
  let swings = 0, sides = new Set();
  for (const seed of [3, 4, 5, 6, 7, 8]) {
    const g = await room(2, { seed });
    const st = stage(g.v);
    const plan = planOf(g.v);
    assert.equal(st.n, plan.length);
    assert.deepEqual(st.moves, plan, 'PG_S is $tt_plan as worked here');
    assert.ok(st.n > 20 && st.n <= MC.TT_NMAX, `${st.n} moves`);
    assert.equal(st.moves[0].t, MC.TT_FIRST);
    let lastSide = 0;
    for (let k = 0; k < st.n; k++) {
      const m = st.moves[k], p = st.moves[k - 1];
      if (k) {
        const wait = m.t - p.t - p.tip;
        const want = p.kind === MC.TT_K_LEVEL ? MC.TT_REST0 - Math.floor((p.t * (MC.TT_REST0 - MC.TT_REST1)) / MC.TT_LEN)
          : MC.TT_HOLD0 + Math.floor((p.t * (MC.TT_HOLD1 - MC.TT_HOLD0)) / MC.TT_LEN);
        assert.equal(wait, want, `move ${k}'s wait`);
        assert.ok(m.t - MC.TT_WARN >= p.t, 'shown after the last one starts');
      }
      assert.ok(m.t < MC.TT_LEN);
      assert.equal(m.tip, m.kind === MC.TT_K_SWING ? MC.TT_SWING : MC.TT_TIP);
      if (m.kind === MC.TT_K_LEVEL) { assert.deepEqual([m.dir, m.gx, m.gz], [MC.TT_LEVEL, 0, 0]); assert.ok(k > 0 && p.kind !== MC.TT_K_LEVEL, 'a level follows a tilt'); continue; }
      const s = Math.abs(m.gx) + Math.abs(m.gz);
      assert.ok(m.gx === 0 || m.gz === 0, 'about one axis');
      const [ux, uz] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]][m.dir];
      assert.equal(m.gx, f(ux * s));
      assert.equal(m.gz, f(uz * s));
      const want = MC.TT_S0 + (MC.TT_S1 - MC.TT_S0) * Math.min(1, m.t / MC.TT_RAMP);
      assert.ok(Math.abs(s - want) <= MC.TT_SJIT + 1e-6, `slope ${s} at ${m.t}, ${want} give or take`);
      if (m.kind === MC.TT_K_TILT) {
        assert.ok(k === 0 || p.kind === MC.TT_K_LEVEL, 'a tilt from level');
        assert.notEqual(m.dir, lastSide, 'not toward the last tilt\'s side');
      } else {
        assert.ok(p.kind === MC.TT_K_TILT && m.t >= MC.TT_CHAIN0, 'a swing straight from a tilt, from 40 s');
        assert.equal(m.dir, ((p.dir - 1) ^ 1) + 1, 'over to the other side of the same axis');
        swings++;
      }
      lastSide = m.dir;
      sides.add(m.dir);
    }
    assert.ok(degOf(st.moves[0].gx, st.moves[0].gz) <= 10, 'the first gentle');
    const late = st.moves.filter((m) => m.t > MC.TT_RAMP && m.dir);
    assert.ok(late.every((m) => degOf(m.gx, m.gz) >= 23 && degOf(m.gx, m.gz) <= 27), 'the last about 25 degrees');
  }
  assert.ok(swings >= 6, `${swings} swings in six rounds`);
  assert.equal(sides.size, 4, 'every side');
  // the slope between moves: eased from the last move's to this one's over its tip, then held
  const st = { n: 2, moves: [{ t: 100, gx: f(0.2), gz: 0, tip: 125, dir: 1, kind: 1 }, { t: 400, gx: f(-0.4), gz: 0, tip: 220, dir: 2, kind: 2 }] };
  assert.deepEqual([gradAt(st, 99), gradAt(st, 100), gradAt(st, 225), gradAt(st, 399), gradAt(st, 620), gradAt(st, 5000)], [[0, 0], [0, 0], [f(0.2), 0], [f(0.2), 0], [f(-0.4), 0], [f(-0.4), 0]]);
  const mid = gradAt(st, 510)[0];
  assert.ok(Math.abs(mid - -0.1) < 1e-6, `half way through the swing: ${mid}`);
  for (let t = 101; t < 620; t++) assert.ok(gradAt(st, t)[0] !== gradAt(st, t - 1)[0] || (t > 225 && t <= 400), 'moving through each tip');
  // the edges: TT_CRN steps from TT_CR0, every TT_CRI, to TT_HMIN
  assert.deepEqual([0, MC.TT_CR0 - 1, MC.TT_CR0, MC.TT_CR0 + MC.TT_CRI - 1, MC.TT_CR0 + MC.TT_CRI, MC.TT_CR0 + 7 * MC.TT_CRI, MC.TT_LEN].map(dropsAt), [0, 0, 1, 1, 2, 8, 8]);
  assert.equal(halfOf(f(30), MC.TT_CRN), MC.TT_HMIN);
  assert.ok(MC.TT_CR0 + (MC.TT_CRN - 1) * MC.TT_CRI < MC.TT_LEN - 2000, 'the last edge well before the clock');
  assert.equal(MC.TT_FX_WARN, L.FX_MG + 4 * L.MG_TILT);
  assert.deepEqual([MC.TT_FX_TIP, MC.TT_FX_CRACK, MC.TT_FX_DROP], [MC.TT_FX_WARN + 1, MC.TT_FX_WARN + 2, MC.TT_FX_WARN + 3]);
  assert.ok(MC.TT_FELL >= MC.TT_MOVES + MC.TT_NMAX * MC.TT_MSIZE && MC.TT_SURV >= MC.TT_FELL + 2 * L.NPLAYER && MC.TT_SURV + L.NPLAYER <= L.PG_S_SIZE, 'PG_S holds it all');
});

test('the moves\' moments as FX on time: each shown TT_WARN ahead and its tip starting; an edge cracking and crumbling, PG_SIZE in with it', async () => {
  const g = await room(2, { seed: 5 });
  const st = stage(g.v);
  const seen = (t) => { at(g, t); const k = g.v.fxCount(); g.step(); return [MC.TT_FX_WARN, MC.TT_FX_TIP, MC.TT_FX_CRACK, MC.TT_FX_DROP].flatMap((kind) => fxs(g.v, kind, k)); };
  for (const k of [0, 1, 2, find(st, (m) => m.kind === MC.TT_K_SWING), st.n - 1]) {
    const m = st.moves[k];
    const shot = m.dir | (m.kind << 3) | (k << 8), size = Math.abs(m.gx) + Math.abs(m.gz);
    let [x, y] = seen(m.t - MC.TT_WARN);
    assert.equal(y, undefined);
    assert.deepEqual([x.kind, x.owner, x.shot, x.size, x.pos[0], x.pos[1], x.pos[2]], [MC.TT_FX_WARN, 255, shot, size, C, PLAT_Y, C], `move ${k} shown`);
    [x, y] = seen(m.t);
    assert.equal(y, undefined);
    assert.deepEqual([x.kind, x.shot, x.size], [MC.TT_FX_TIP, shot, size], `move ${k} tips`);
  }
  for (let j = 1; j <= MC.TT_CRN; j++) {
    const tj = MC.TT_CR0 + (j - 1) * MC.TT_CRI;
    let [x] = seen(tj - MC.TT_CRWARN).filter((e) => e.kind === MC.TT_FX_CRACK);
    assert.deepEqual([x.shot, x.size], [j, halfOf(st.h0, j)], `edge ${j} cracks`);
    [x] = seen(tj).filter((e) => e.kind === MC.TT_FX_DROP);
    assert.deepEqual([x.shot, x.size], [j, halfOf(st.h0, j)], `edge ${j} crumbles`);
    assert.equal(g.v.party().size, halfOf(st.h0, j));
  }
  assert.equal(seen(st.moves[3].t + 50).length, 0, 'and nothing between');
});

test('a ball rides the table: still on the level, on the top every tick as it tips, sliding down a tilt with no keys, climbing it with them', async () => {
  const g = await room(2, { seed: 9 });
  const st = stage(g.v);
  // through the first tip and its hold, no keys: on the top every tick, sliding the way down
  const m = st.moves[0], [ux, uz] = [Math.sign(m.gx), Math.sign(m.gz)];
  at(g, m.t - 20);
  put(g, 0, 0, 0, playT(g));
  park(g, 1, -uz * 6, ux * 6);
  let speed = 0;
  for (let i = 0; i < m.tip + 150; i++) {
    const t = playT(g);
    g.step();
    const b = g.v.partier(0);
    assert.ok(b.ground, `on the table into ${t}`);
    assert.equal(over(g, 0, t), 0, `on its top into ${t}`);
    const along = b.vel[0] * ux + b.vel[2] * uz;
    if (t < m.t) assert.equal(along, 0, 'still while it\'s level');
    else if (t > m.t + 2) { assert.ok(along > speed, `faster down it into ${t}`); speed = along; }
  }
  // the pull on the slope held: TT_PULL a unit of slope, less the rolling drag
  const s = Math.abs(m.gx + m.gz), v0 = speed;
  g.step();
  const v1 = g.v.partier(0).vel[0] * ux + g.v.partier(0).vel[2] * uz;
  assert.ok(Math.abs(v1 - (v0 * Number(L.BPHYS.B_DRAG) + MC.TT_PULL * TICK * s)) < 1e-4, `${v0} to ${v1} a tick at ${s}`);
  // a 25 degree slope: with the keys a ball climbs it; it slides down it with none
  const k = find(st, (q) => q.kind === MC.TT_K_TILT && q.t > MC.TT_RAMP);
  const q = st.moves[k], [qx, qz] = [Math.sign(q.gx), Math.sign(q.gz)];
  for (const keys of [true, false]) {
    at(g, q.t + q.tip + 5);
    put(g, 0, qx * 2, qz * 2, playT(g));
    park(g, 1, -qz * 3, qx * 3);
    const word = partyWord({ yaw: yawTo(-qx, -qz), move: keys ? 1 : 0 });
    for (let i = 0; i < 200; i++) g.step([[L.EV_INPUT, 0, word]]);
    const b = g.v.partier(0), d = (b.pos[0] - C) * qx + (b.pos[2] - C) * qz;
    assert.ok(keys ? b.ground && d < -1.5 : d > 3.5, `${keys ? 'climbs' : 'slides'}: ${d.toFixed(2)} m down from the middle after 1.6 s at ${degOf(q.gx, q.gz)} degrees`);
  }
});

test('a swing over: a ball near the edge that rises rides it up and stays on; one near the edge that drops stays on the top as it falls away', async () => {
  const g = await room(3, { seed: 7 });
  const st = stage(g.v);
  const k = find(st, (q) => q.kind === MC.TT_K_SWING);
  const m = st.moves[k], p = st.moves[k - 1], [ux, uz] = [Math.sign(p.gx), Math.sign(p.gz)];
  const h = halfAt(st, m.t);
  at(g, m.t - 5);
  // P1 on the low side (it rises), P2 on the high side (it drops), P3 across the axis
  put(g, 0, ux * (h - 2), uz * (h - 2), playT(g));
  put(g, 1, -ux * (h - 2), -uz * (h - 2), playT(g));
  park(g, 2, uz * (h - 2), -ux * (h - 2));
  let top = -Infinity, low = Infinity;
  for (let i = 0; i < m.tip + 10; i++) {
    const t = playT(g);
    g.step();
    for (const q of [0, 1]) {
      const b = g.v.partier(q);
      assert.ok(b.ground && Math.abs(over(g, q, t)) < 1e-4, `P${q + 1} on the top into ${t}: ${over(g, q, t)}`);
    }
    top = Math.max(top, g.v.partier(0).vel[1]);
    low = Math.min(low, g.v.partier(1).vel[1]);
  }
  assert.ok(top > 3 && low < -2.5, `rode up at ${top.toFixed(1)} m/s, down at ${low.toFixed(1)}`);
  assert.ok(!g.v.partier(0).out && !g.v.partier(1).out);
});

test('off the table: a ball over the edge falls and is out once TT_DROP under its plane; under the top by TT_GRIP or less it is lifted onto it, more and it falls through', async () => {
  const g = await room(3, { seed: 11 });
  const st = stage(g.v);
  const h = st.h0;
  at(g, 50);
  park(g, 1, 0, 0);
  park(g, 2, 3, 3);
  // just past the edge, in the air
  put(g, 0, h + 0.5, 0, 50, { ground: false });
  let n = 0;
  while (!g.v.partier(0).out && n++ < 200) {
    const t = playT(g), b0 = g.v.partier(0);
    const was = b0.pos[1];
    g.step();
    const b = g.v.partier(0);
    if (!b.out) assert.ok(over(g, 0, t) >= -MC.TT_DROP, 'in till TT_DROP under');
    else assert.ok(f(f(b.pos[1] + 0) - PLAT_Y) < -MC.TT_DROP && was > PLAT_Y - MC.TT_DROP - 1, `out at ${b.pos[1]}`);
  }
  assert.ok(g.v.partier(0).out && !g.v.partier(1).out && !g.v.partier(2).out, `out after ${n} ticks`);
  const sink = fxs(g.v, L.FX_SINK).at(-1);
  assert.deepEqual([sink.owner, sink.shot], [0, 255]);
  // under the top inside the edge: within TT_GRIP lifted onto it, past it falls on through
  const g2 = await room(3, { seed: 12 });
  at(g2, 50);
  park(g2, 2, 4, 4);
  put(g2, 0, 1, 1, 50, { y: -(MC.TT_GRIP - 0.4), ground: false });
  put(g2, 1, -1, -1, 50, { y: -(MC.TT_GRIP + 0.5), ground: false });
  g2.step();
  assert.ok(g2.v.partier(0).ground && g2.v.partier(0).pos[1] === PLAT_Y, 'lifted onto the top');
  assert.ok(!g2.v.partier(1).ground, 'under the table: no floor');
  for (let i = 0; i < 100; i++) g2.step();
  assert.ok(g2.v.partier(1).falling && !g2.v.partier(0).out, 'falling on through');
});

test('the edges crumble: a ball on the band that goes falls on its tick, one inside the new edge stays up; the last leaves TT_HMIN', async () => {
  for (const j of [1, 4, MC.TT_CRN]) {
    const g = await room(3, { seed: 20 + j });
    const st = stage(g.v);
    const tj = MC.TT_CR0 + (j - 1) * MC.TT_CRI;
    const ho = halfOf(st.h0, j - 1), hn = halfOf(st.h0, j);
    at(g, tj - 3);
    // on the band, just inside the new edge, and well in (on the level or the slope: the band is checked across it)
    const [gx, gz] = gradAt(st, tj), along = Math.abs(gx) > Math.abs(gz) ? [0, 1] : [1, 0];
    put(g, 0, along[0] * (ho + hn) / 2, along[1] * (ho + hn) / 2, playT(g));
    put(g, 1, along[0] * (hn - 1.2), along[1] * (hn - 1.2), playT(g));
    put(g, 2, -along[0] * (hn - 2.5), -along[1] * (hn - 2.5), playT(g));
    while (playT(g) < tj) { g.step(); assert.ok(g.v.partier(0).ground, 'held up till it crumbles'); }
    g.step();
    assert.ok(!g.v.partier(0).ground, `edge ${j} gone from under it`);
    assert.ok(g.v.partier(1).ground && g.v.partier(2).ground, 'inside the new edge: still up');
    assert.equal(halfAt(st, playT(g)), hn);
    assert.ok(!onTable(st, g.v.partier(0).pos[0], g.v.partier(0).pos[2], playT(g)) && onTable(st, g.v.partier(1).pos[0], g.v.partier(1).pos[2], playT(g)));
  }
});

test('balls that left the table ticks apart don\'t share the win: the first is out in its place, the last off wins alone (or the two that left together share it)', async () => {
  for (const n of [2, 3]) {
    const g = await room(n, { seed: 13 });
    const st = stage(g.v);
    at(g, 30);
    put(g, 0, st.h0 + 0.8, 0, 30, { ground: false });
    for (let k = 0; k < 15; k++) g.step();
    assert.ok(!g.v.partier(0).out, 'P1 going out');
    for (let p = 1; p < n; p++) put(g, p, -st.h0 - 0.8, 3 * p - 3, playT(g), { ground: false });
    let k = 0;
    while (g.v.party().state === L.H_PLAY && k++ < 400) g.step();
    const r = g.v.party();
    assert.equal(r.state, L.H_OVER);
    const ps = Array.from({ length: n }, (_, q) => q);
    assert.ok(g.v.partier(0).out, 'P1 out first');
    if (n === 2) {
      assert.deepEqual(ps.map((q) => g.v.partier(q).place), [2, 1]);
      assert.equal(r.winner, 1, 'the last off wins alone');
    } else {
      assert.deepEqual(ps.map((q) => g.v.partier(q).place), [3, 1, 1]);
      assert.equal(r.winner, 255, 'the two that left together share it');
    }
  }
});

test('the end: the last ball on wins, 10 points to 1; at the clock every ball still on shares it; TT_SURV counts the tilts each rode out', async () => {
  const g = await room(2, { seed: 14 });
  const st = stage(g.v);
  at(g, 40);
  put(g, 0, st.h0 + 0.8, 0, 40, { ground: false });
  park(g, 1, 0, 0);
  let n = 0;
  while (g.v.party().state === L.H_PLAY && n++ < 400) g.step();
  assert.equal(g.v.party().winner, 1);
  assert.deepEqual([0, 1].map((p) => g.v.partier(p).place), [2, 1]);
  assert.deepEqual([0, 1].map((p) => g.v.partier(p).pts), [1, 10]);
  // two balls held in the middle (pushing uphill as it tips) to the clock
  const g2 = await room(2, { seed: 15 });
  const st2 = stage(g2.v);
  const levels = st2.moves.filter((m) => m.kind === MC.TT_K_LEVEL && m.t < MC.TT_LEN - 400).length;
  at(g2, MC.TT_LEN - 400);
  park(g2, 0, -1.2, 0);
  park(g2, 1, 1.2, 0);
  // and TT_SURV as it stood: every level so far, ridden out
  for (const p of [0, 1]) g2.dv.setUint8(L.PG_S + MC.TT_SURV + p, levels);
  n = 0;
  while (g2.v.party().state === L.H_PLAY && n++ < 600) {
    const t = playT(g2), [gx, gz] = gradAt(st2, t + 10), recs = [];
    for (const p of [0, 1]) {
      const b = g2.v.partier(p), dx = b.pos[0] - C + (p ? -1.2 : 1.2), dz = b.pos[2] - C;
      const wx = -gx * 6 - dx, wz = -gz * 6 - dz;
      recs.push([L.EV_INPUT, p, partyWord({ yaw: yawTo(wx, wz), move: Math.hypot(wx, wz) > 0.3 ? 1 : 0 })]);
    }
    g2.step(recs);
  }
  const r = g2.v.party();
  assert.equal(r.state, L.H_OVER);
  assert.ok(!g2.v.partier(0).out && !g2.v.partier(1).out, 'both still on at the clock');
  assert.equal(r.winner, 255, 'shared');
  assert.deepEqual([0, 1].map((p) => [g2.v.partier(p).place, g2.v.partier(p).pts, g2.v.partier(p).wins]), [[1, 10, 1], [1, 10, 1]]);
  const all = st2.moves.filter((m) => m.kind === MC.TT_K_LEVEL).length;
  assert.deepEqual([0, 1].map((p) => g2.dv.getUint8(L.PG_S + MC.TT_SURV + p)), [all, all], 'a tilt for every level');
});

test('the prediction matches the confirmed ball bit for bit: through a tip, sliding a hold, climbing, a swing over, hopping, a crumble, off the edge', async () => {
  // one ball alone, so nothing bumps it (bumps are the confirmed world's)
  const g = await room(1, { seed: 16 });
  const st = stage(g.v);
  const roam = (n, seed) => Array.from({ length: n }, (_, i) => partyWord({ yaw: (i * seed) & 16383, move: (i >> 4) % 3 === 0 ? 0 : 1, hop: i % 61 === 0 ? 1 : 0 }));
  // in chunks until it's off the table (an out is the confirmed world's)
  const run = (words) => {
    let k = 0, n = 0;
    for (; k < words.length; k += 30) {
      const b = g.v.partier(0);
      if (b.out || !onTable(st, b.pos[0], b.pos[2], playT(g))) break;
      n += predicted(g, words.slice(k, k + 30));
    }
    return [k, n];
  };
  for (const [t0, words, x, z] of [
    [st.moves[0].t - 30, roam(330, 97), 2, -1], // the first tip and its hold
    [st.moves[find(st, (m) => m.kind === MC.TT_K_TILT && m.t > MC.TT_RAMP)].t - 10, Array(240).fill(partyWord({})), 1, 1], // a steep one, sliding
    [st.moves[find(st, (m) => m.kind === MC.TT_K_SWING)].t - 40, roam(330, 211), -1.5, 2], // a swing over, roaming
    [MC.TT_CR0 + 3 * MC.TT_CRI - 60, roam(300, 61), 0, 0], // an edge crumbling, roaming
  ]) {
    at(g, t0);
    put(g, 0, x, z, t0);
    const [k, n] = run(words);
    assert.ok(n >= 150, `${n} compared from ${t0} over ${k} ticks`);
  }
  // off the low edge of a steep tilt, with no keys: predicted all the way to the edge
  const m = st.moves[find(st, (q) => q.kind === MC.TT_K_TILT && q.t > MC.TT_RAMP)];
  const [ux, uz] = [Math.sign(m.gx), Math.sign(m.gz)];
  at(g, m.t + m.tip);
  put(g, 0, ux * 2, uz * 2, m.t + m.tip);
  const [k, n] = run(Array(600).fill(partyWord({})));
  assert.ok(k < 600 && n > 100, `slid off after ${k} ticks, ${n} compared`);
  for (let i = 0; i < 200 && !g.v.partier(0).out; i++) g.step();
  assert.ok(g.v.partier(0).out, 'and out');
});

// A round of Partier balls steered by this minigame's brain (tools/genparty.mjs), recorded as a log.
async function aiRound(balls, ticks, seed) {
  let start = -1, over = -1, seen = 0, outs = 0, at20 = -1, at60 = -1;
  let places = null, pts = null, winner = -1;
  const { log, sim } = await playParty({ bytes: partyBytes(true), seed, mg: L.MG_TILT, bots: balls, ticks, onTick: (t, s, v) => {
    const g = v.party();
    for (; seen < v.fxCount(); seen++) outs += v.fx(seen).kind === L.FX_SINK;
    if (start < 0 && g.state === L.H_PLAY) start = t;
    if (start >= 0 && at20 < 0 && t - start >= 20 / TICK) at20 = g.left;
    if (start >= 0 && at60 < 0 && t - start >= 60 / TICK) at60 = g.left;
    if (start >= 0 && over < 0 && g.state === L.H_OVER) {
      over = t;
      winner = g.winner;
      places = [...Array(balls).keys()].map((p) => v.partier(p).place);
      pts = [...Array(balls).keys()].map((p) => v.partier(p).pts);
    }
  } });
  return { log, sim, start, over, outs, at20, at60, places, pts, winner };
}

for (const [balls, ticks, seed] of [[8, 13400, 21], [64, 13400, 22]]) {
  test(`a round of ${balls} AI balls on the debug build: no trap, every one up 20 s in, some off by the end, a winner or the clock; equal on 1 and 4 threads`, async () => {
    const r = await aiRound(balls, ticks, seed);
    assert.equal(r.sim.error().code, 0);
    assert.ok(r.over > 0, 'the round ended');
    const secs = (r.over - r.start) * TICK;
    assert.ok(secs > 45 && secs <= MC.TT_LEN * TICK + 0.01, `${secs.toFixed(1)} s of play`);
    assert.ok(r.at20 >= balls - 2, `${r.at20} of ${balls} still on 20 s in`);
    assert.ok(r.outs >= balls / 4 && r.outs < balls, `${r.outs} off`);
    assert.ok(r.places.every((x) => x >= 1 && x <= balls), `places ${r.places}`);
    assert.ok(r.pts.every((x) => x >= 1 && x <= 10), `points ${r.pts}`);
    assert.ok(r.places.includes(1) && r.pts.includes(10), 'somebody won');
    const v = new View(r.sim.memory.buffer);
    assert.equal(v.party().game, L.MG_TILT);
    const parsed = parseLog(r.log);
    const n = r.over + 50;
    const a = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 1, tag: 't1' });
    const b = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 4, tag: 't4', startWorkers });
    const d = await replay({ bytes: partyBytes(true), log: parsed, ticks: n, threads: 1, tag: 'd1' });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(d.trace).tickHashes], 'the debug build steps the same bits');
  });
}

test('the client module: draws every phase, frames the table, writes its HUD lines; its brain sees the edges, the way down and the tilt coming, and keeps its ball on', async () => {
  const { Scene } = await import('../client/party-render.mjs');
  const g = await room(3, { seed: 41 });
  const st = stage(g.v);
  const out = { scene: new Scene(24000), solid: [], glow: [], beams: [], decals: [], paint: null };
  const lines = [];
  const hctx = { put: (x, y, s, c) => lines.push([y, s, c]), centre: (y, s, c) => lines.push([y, s, c]), right: (y, s, c) => lines.push([y, s, c]), rows: 44, C: {}, slot: 0, now: 0 };
  const sw = find(st, (m) => m.kind === MC.TT_K_SWING), lv = find(st, (m) => m.kind === MC.TT_K_LEVEL);
  for (const t of [10, st.moves[0].t - 60, st.moves[0].t + 30, st.moves[lv].t - 40, st.moves[sw].t - 50, st.moves[sw].t + 100, MC.TT_CR0 - 100, MC.TT_CR0 + 40, MC.TT_CR0 + 8 * MC.TT_CRI]) {
    at(g, t);
    g.step();
    out.scene.clear(); lines.length = 0;
    const me = g.v.partier(0);
    tilt.draw(g.v, { tick: g.v.tick, ptick: g.v.tick, dt: 0, now: 1000, slot: 0, me, pme: me }, out);
    const tp = t + 1;
    assert.ok(out.scene.count > 20 && out.scene.count < 1200, `${out.scene.count} solids at ${tp}`);
    for (let k = 0; k < out.scene.count * 16; k++) assert.ok(Number.isFinite(out.scene.data[k]), 'finite');
    // the slab: turned as the sim's slope has it, its top through the middle
    const [gx, gz] = gradAt(st, tp), d = out.scene.data, roll = ((d[3] >> 2) / 65536) * 2 * Math.PI;
    const tan = Math.tan(roll > Math.PI ? roll - 2 * Math.PI : roll);
    assert.ok(Math.abs(tan - (Math.abs(gx) > Math.abs(gz) ? -gx : gz)) < 1e-3, `the slab's roll at ${tp}`);
    tilt.hud(g.v, { ...hctx, me, t: tp * TICK + 1e-6 });
    for (const l of lines) assert.ok(l[1].length <= 80, l[1]);
    const text = lines.map((l) => l[1]).join(' | ');
    assert.ok(text.includes(`TILT ${degOf(gx, gz)} DEG`), text);
    const j = moveAt(st, tp + MC.TT_WARN), m = st.moves[j];
    if (m && tp >= m.t - MC.TT_WARN && tp < m.t + m.tip) assert.ok(m.dir ? /TIPS|SWINGS|TIPPING/.test(text) && text.includes('GET UPHILL') : text.includes('LEVELLING'), text);
    if (tp >= MC.TT_CR0 - MC.TT_CRWARN && tp < MC.TT_CR0) assert.ok(text.includes('THE EDGE CRUMBLES'), text);
    const fr = tilt.frame(g.v);
    assert.equal(fr.shape, 'square');
    assert.ok(Math.abs(fr.radius - (halfAt(st, playT(g)) + 1)) < 1e-3);
  }
  assert.ok(tilt.hint.length <= 70);
  // the HUD names the side as you face: a tilt toward +x seen facing +x is ahead, facing +z it's on the left
  const k = find(st, (m) => m.dir === 1);
  at(g, st.moves[k].t - 50);
  g.step();
  for (const [yaw, side, go] of [[0, 'AHEAD', 'BACK'], [Math.PI / 2, 'LEFT', 'RIGHT'], [Math.PI, 'BEHIND', 'FORWARD']]) {
    lines.length = 0;
    tilt.hud(g.v, { ...hctx, me: { ...g.v.partier(0), yaw }, t: (st.moves[k].t - 49) * TICK + 1e-6 });
    const text = lines.map((l) => l[1]).join(' | ');
    assert.ok(text.includes(`TIPS ${side}`) && text.includes(`GO ${go}`), text);
  }
  // danger: off the table; on a tilt, the edge the slope runs down to worse than the one it rises to; the middle fine
  const q = st.moves[find(st, (m) => m.kind === MC.TT_K_TILT && m.t > 3000)], [ux, uz] = [Math.sign(q.gx), Math.sign(q.gz)];
  at(g, q.t + q.tip + 10);
  g.step();
  const T = g.v.party().start, tk = T + q.t + q.tip + 40, h = st.h0;
  const me = { ...g.v.partier(0), from: tk };
  assert.equal(tilt.brain.danger(g.v, C + h + 1, C, tk, me), 1);
  const lo = tilt.brain.danger(g.v, C + ux * (h - 2.5), C + uz * (h - 2.5), tk, me), hi = tilt.brain.danger(g.v, C - ux * (h - 2.5), C - uz * (h - 2.5), tk, me);
  assert.ok(lo > 0.3 && hi < 0.1, `near the low edge ${lo.toFixed(2)}, the high ${hi.toFixed(2)}`);
  assert.equal(tilt.brain.danger(g.v, C - ux, C - uz, tk, me), 0, 'uphill of the middle');
  // goal: uphill of the tilt coming, once it's shown
  const p = st.moves[find(st, (m) => m.kind === MC.TT_K_TILT && m.t > 2000)], [px, pz] = [Math.sign(p.gx), Math.sign(p.gz)];
  at(g, p.t - 100);
  g.step();
  const gl = tilt.brain.goal(g.v, g.v.partier(0), { at: g.v.tick, pos: [C, C], skill: 0.8, slot: 0 });
  assert.ok((gl[0] - C) * px + (gl[1] - C) * pz < -1, `the goal ${gl.map((x) => (x - C).toFixed(1))} uphill of ${p.dir}`);
  // and the whole AI ball (client/party-bot.mjs, its words landing 8 ticks late) alone through 25 s of steep tilts and swings: it stays on
  const g3 = await room(1, { seed: 43 });
  at(g3, MC.TT_CHAIN0);
  park(g3, 0, 0, 0);
  const ai = new Partier(0, 5, 0.8);
  const late = [];
  for (let i = 0; i < 3125; i++) {
    late.push(ai.think(g3.v, g3.v.tick + 8, 8));
    g3.step([[L.EV_INPUT, 0, late.length > 8 ? late.shift() : partyWord({})]]);
  }
  assert.ok(!g3.v.partier(0).out && g3.v.party().state === L.H_PLAY, 'still on');
});
