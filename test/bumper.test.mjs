import test from 'node:test';
import assert from 'node:assert/strict';
import { newBumper, bumperBytes, wasmBytes, arenaBytes } from './helpers.mjs';
import { View, bumperWord, floorAt, edgeDistance, PLAT_Y, B_RAD, MEGA_RAD } from '../src/bumper-view.mjs';
import { playBumper } from '../tools/genbumper.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import * as L from '../src/layout.mjs';

const TURN = 16384;
const yawTo = (a, b) => Math.round(Math.atan2(b[2] - a[2], b[0] - a[0]) / (2 * Math.PI) * TURN) & (TURN - 1);

// A room of n balls, stepped into the round. Debug builds trap on a NaN.
async function room(seed = 7, n = 2, { play = true } = {}) {
  const sim = await newBumper(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = new DataView(sim.memory.buffer);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  while (play && v.hole().state !== L.H_PLAY) step();
  return { sim, v, dv, step };
}

// Puts ball p at (x, z) on the cheese, still; with no holes, if asked, so a test has the floor it wants.
function put(g, p, x, z, y = PLAT_Y) {
  const b = L.PLAYERS + p * L.PSIZE;
  g.dv.setFloat32(b + L.P_PX, x, true);
  g.dv.setFloat32(b + L.P_PY, y, true);
  g.dv.setFloat32(b + L.P_PZ, z, true);
  for (const o of [L.P_VX, L.P_VY, L.P_VZ]) g.dv.setFloat32(b + o, 0, true);
  g.dv.setUint8(b + L.P_FL, L.PF_LIVE | L.PF_GROUND);
}
const noHoles = (g) => g.dv.setUint32(L.BH_NHOLE, 0, true);
const wide = (g) => g.dv.setFloat32(L.BH_R0, 80, true);
function hole(g, k, x, z, r) {
  const a = L.B_HOLES + k * L.HOLE_SIZE;
  g.dv.setFloat32(a, x, true); g.dv.setFloat32(a + 4, z, true); g.dv.setFloat32(a + 8, r, true);
  g.dv.setUint32(L.BH_NHOLE, Math.max(k + 1, g.dv.getUint32(L.BH_NHOLE, true)), true);
}
const give = (g, p, item) => g.dv.setUint8(L.PLAYERS + p * L.PSIZE + L.B_ITEM, item);
const fxs = (v, kind) => { const out = []; for (let k = 0; k < v.fxCount(); k++) { const f = v.fx(k); if (f.kind === kind) out.push(f); } return out; };
const C = L.B_CX;

test('bumper balls is its own sim: another wasm, the same engine, golf and the arena untouched', async () => {
  const s = await newBumper();
  assert.notDeepEqual(bumperBytes(), wasmBytes());
  assert.notDeepEqual(bumperBytes(), arenaBytes());
  for (const name of ['init', 'step', 'step_mt', 'worker_run', 'predict', 'snapshot', 'restore', 'regrid', 'hash_region']) assert.equal(typeof s.x[name], 'function', name);
});

test('every round lays out a wheel of cheese for its crowd: holes clear of the middle, every ball on a spot of its own clear of them', async () => {
  let last = 0;
  for (const n of [1, 2, 8, 64, 256]) {
    const g = await room(n * 13 + 1, n, { play: false });
    const w = g.v.wheel();
    assert.equal(w.state, L.H_COUNT);
    assert.equal(w.n0, n);
    assert.ok(w.r0 > last, `the wheel grows with the crowd: ${w.r0} for ${n}`);
    last = w.r0;
    assert.ok(w.holes.length >= 4 && w.holes.length <= L.NHOLE, `${w.holes.length} holes`);
    for (const h of w.holes) {
      assert.ok(Math.hypot(h.x - C, h.z - C) >= h.r + 7 - 1e-3, 'the middle stays solid');
      assert.ok(h.r >= 2.6 - 1e-6 && h.r <= 6 + 1e-6, `a hole of ${h.r} m`);
    }
    const spots = [];
    for (let p = 0; p < n; p++) {
      const b = g.v.bumper(p);
      assert.equal(b.pos[1], PLAT_Y);
      assert.equal(floorAt(w, b.pos[0], b.pos[2]), -1, `P${p + 1} on cheese`);
      assert.ok(edgeDistance(w, b.pos[0], b.pos[2]) > 1.7, `P${p + 1} clear of the holes`);
      spots.push(b.pos);
    }
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) assert.ok(Math.hypot(spots[a][0] - spots[b][0], spots[a][2] - spots[b][2]) > 2 * B_RAD, 'apart');
  }
});

test('nothing rolls in the countdown; then a ball rolls up to 10 m/s where its keys push it', async () => {
  const g = await room(7, 1, { play: false });
  const p0 = g.v.bumper(0).pos;
  for (let k = 0; k < 100; k++) g.step([[L.EV_INPUT, 0, bumperWord({ yaw: 0, move: 1 })]]);
  assert.deepEqual(g.v.bumper(0).pos, p0, 'still in the countdown');
  while (g.v.hole().state !== L.H_PLAY) g.step();
  noHoles(g);
  wide(g);
  put(g, 0, C, C);
  for (let k = 0; k < 125 * 4; k++) g.step([[L.EV_INPUT, 0, bumperWord({ yaw: TURN / 4, move: 1 })]]);
  const b = g.v.bumper(0);
  assert.ok(b.vel[2] > 9.5 && b.vel[2] < 10.1, `flat out at ${b.vel[2]}`);
  assert.ok(Math.abs(b.vel[0]) < 1e-3, 'straight along +z');
});

test('a ball over a hole drops through it, down its shaft, and is out; the other ball wins the round', async () => {
  const g = await room(7, 2);
  noHoles(g);
  hole(g, 0, C + 12, C, 3);
  put(g, 0, C + 6, C);
  put(g, 1, C - 6, C);
  let fell = -1;
  for (let k = 0; k < 600 && !g.v.bumper(0).out; k++) {
    g.step([[L.EV_INPUT, 0, bumperWord({ yaw: 0, move: 1 })]]);
    const b = g.v.bumper(0);
    if (b.falling && fell < 0) fell = k;
    if (b.falling && b.pos[1] > PLAT_Y - 6 - 1) assert.ok(Math.hypot(b.pos[0] - (C + 12), b.pos[2] - C) <= g.v.wheel().holes[0].r - B_RAD + 1e-3, 'in the shaft');
  }
  const b = g.v.bumper(0);
  assert.ok(fell > 0, 'it went over');
  assert.ok(b.out, 'out');
  assert.equal(b.place, 2);
  const [sink] = fxs(g.v, L.FX_SINK);
  assert.equal(sink.owner, 0);
  assert.equal(sink.shot, 255, 'nobody bumped it');
  const w = g.v.wheel();
  assert.equal(w.state, L.H_OVER);
  assert.equal(w.winner, 1);
  assert.equal(g.v.bumper(1).wins, 1);
  assert.equal(g.v.bumper(1).place, 1);
  // then a new wheel, both back on it
  while (g.v.hole().state !== L.H_COUNT) g.step();
  assert.equal(g.v.hole().hole, 1);
  for (const p of [0, 1]) { const c = g.v.bumper(p); assert.ok(!c.out && !c.falling && c.pos[1] === PLAT_Y, `P${p + 1} back`); }
});

test('off the rim too; and the rim crumbles in and the holes widen as the round goes on', async () => {
  const g = await room(7, 2);
  hole(g, 0, C - 12, C, 4);
  g.dv.setUint32(L.BH_NHOLE, 1, true);
  const w0 = g.v.wheel();
  put(g, 0, C + w0.r0 - 1.2, C);
  for (let k = 0; k < 125 && !g.v.bumper(0).falling; k++) g.step([[L.EV_INPUT, 0, bumperWord({ yaw: 0, move: 1 })]]);
  assert.ok(g.v.bumper(0).falling, 'over the edge');
  assert.equal(g.dv.getUint8(L.PLAYERS + L.B_HOLE), 255, 'the rim, not a hole');
  g.dv.setUint32(L.HDR_START, g.v.tick - L.SHRINK_TICKS / 2, true);
  const w1 = g.v.wheel();
  assert.ok(Math.abs(w1.rim - (w0.r0 - (w0.r0 - 9) / 2)) < 0.05, `the rim at ${w1.rim}`);
  assert.ok(Math.abs(w1.holes[0].r / w0.holes[0].r - 1.25) < 1e-3);
  g.dv.setUint32(L.HDR_START, g.v.tick - 2 * L.SHRINK_TICKS, true);
  assert.equal(g.v.wheel().rim, 9, 'no smaller than 9 m');
  // a ball that was on cheese at the rim is past it once it has crumbled
  put(g, 1, C + 9.5, C);
  g.step();
  g.step();
  assert.ok(!g.v.bumper(1).ground);
});

test('a bump: a ball rolling into a still one sends it off, and a MEGA ball is shoved less', async () => {
  const run = async (mega) => {
    const g = await room(7, 2);
    noHoles(g);
    put(g, 0, C - 2.4, C);
    put(g, 1, C, C);
    if (mega) g.dv.setUint16(L.PLAYERS + L.PSIZE + L.B_MEGA, 5000, true);
    g.dv.setFloat32(L.PLAYERS + L.P_VX, 10, true);
    let k = 0;
    while (g.v.bumper(1).vel[0] < 0.1 && k++ < 200) g.step([[L.EV_INPUT, 0, bumperWord({ yaw: 0, move: 0 })]]);
    return { g, a: g.v.bumper(0), b: g.v.bumper(1) };
  };
  const { g, a, b } = await run(false);
  assert.ok(b.vel[0] > 10, `the still ball goes off at ${b.vel[0]}`);
  assert.ok(a.vel[0] < 1, `the hitter stops, ${a.vel[0]}`);
  assert.equal(b.hitBy, 0);
  assert.equal(a.hitBy, 1);
  assert.equal(b.hitFor, L.CREDIT_TICKS - 1, 'a bump counts for 3 s, from the tick it came');
  const [bump] = fxs(g.v, L.FX_BUMP);
  assert.ok(bump && bump.size > 9, 'a hard one');
  assert.equal(a.bumps, 1, 'the hitter gets the bump');
  const heavy = await run(true);
  assert.ok(heavy.b.vel[0] < b.vel[0] / 2, `MEGA moves off at ${heavy.b.vel[0]}`);
  assert.ok(heavy.a.vel[0] < -2, 'and the hitter bounces back');
});

test('a KO: bumped into a hole within 3 s is the bumper\'s; later is nobody\'s', async () => {
  for (const late of [false, true]) {
    const g = await room(7, 3);
    noHoles(g);
    hole(g, 0, C + 7, C, 3);
    put(g, 0, C - 4, C);
    put(g, 1, C + 1.5, C);
    put(g, 2, C - 20, C);
    g.dv.setFloat32(L.PLAYERS + L.P_VX, 10, true);
    for (let k = 0; k < 400 && !g.v.bumper(1).out; k++) {
      if (late && g.v.bumper(1).hitBy === 0) g.dv.setUint16(L.PLAYERS + L.PSIZE + L.B_HITT, 0, true);
      g.step();
    }
    assert.ok(g.v.bumper(1).out, 'into the hole');
    assert.equal(g.v.bumper(0).kos, late ? 0 : 1);
    assert.equal(fxs(g.v, L.FX_SINK)[0].shot, late ? 255 : 0);
  }
});

test('power-ups drop from the sky, land on cheese, wait 10 s, and the first ball to roll into one holds it', async () => {
  const g = await room(7, 2);
  const start = g.v.hole().start;
  while (g.v.tick < start + L.DROP_FIRST + 1) g.step();
  const drops = fxs(g.v, L.FX_DROP);
  assert.equal(drops.length, 1, 'one orb for two balls');
  let [o] = g.v.orbs();
  assert.ok(o.falling);
  assert.ok(Math.abs(o.pos[1] - (PLAT_Y + L.ORB_Y)) < 0.1);
  assert.equal(floorAt(g.v.wheel(), o.pos[0], o.pos[2]), -1, 'over cheese');
  while (g.v.orbs()[0].falling) g.step();
  [o] = g.v.orbs();
  assert.ok(Math.abs(o.pos[1] - (PLAT_Y + 0.6)) < 1e-4, 'on the cheese');
  assert.equal(o.life, L.ORB_LIFE);
  assert.ok(g.v.tick - start - L.DROP_FIRST > 400, 'about 4 s falling');
  put(g, 1, o.pos[0] - 1.2, o.pos[2]);
  g.step();
  assert.equal(g.v.bumper(1).item, o.kind);
  assert.equal(g.v.orbs().length, 0);
  assert.equal(fxs(g.v, L.FX_PICKUP)[0].owner, 1);
  // one held, no more: the next orb lies there
  while (!g.v.orbs().some((x) => !x.falling)) g.step();
  const [o2] = g.v.orbs();
  put(g, 1, o2.pos[0], o2.pos[2]);
  g.step();
  assert.equal(g.v.orbs().length, g.v.orbs().length);
  assert.ok(g.v.orbs().some((x) => x.k === o2.k), 'still there');
});

// Ball 0 uses what it holds, facing +x, with ball 1 placed where asked.
async function use(item, at = [C + 4, C]) {
  const g = await room(7, 2);
  noHoles(g);
  put(g, 0, C, C);
  put(g, 1, ...at);
  give(g, 0, item);
  g.step([[L.EV_INPUT, 0, bumperWord({ yaw: 0, use: 1 })]]);
  return g;
}

test('MEGA: twice the size and three times the weight for 8 s', async () => {
  const g = await use(L.PU_MEGA);
  assert.equal(g.v.bumper(0).item, 0);
  assert.equal(g.v.bumper(0).radius, MEGA_RAD);
  assert.equal(fxs(g.v, L.FX_USE)[0].size, L.PU_MEGA);
  for (let k = 0; k < L.MEGA_TICKS; k++) g.step([[L.EV_INPUT, 0, bumperWord({ yaw: 0, use: 1 })]]);
  assert.equal(g.v.bumper(0).radius, B_RAD);
});

test('DASH: 20 m/s where you face; POW: everyone near shoved away; a press with nothing held is dropped', async () => {
  const d = await use(L.PU_DASH);
  assert.ok(Math.abs(d.v.bumper(0).vel[0] - 20) < 0.2);
  const p = await use(L.PU_POW, [C + 4, C]);
  const b = p.v.bumper(1);
  assert.ok(b.vel[0] > 8 && b.vel[1] > 2, `shoved off at ${b.vel}`);
  assert.equal(b.hitBy, 0);
  assert.equal(fxs(p.v, L.FX_BLAST)[0].size, 11);
  // nothing held: the press goes nowhere, and a power-up picked up later waits for the next
  const n = await use(0);
  assert.equal(n.v.bumper(0).shots, 0);
  give(n, 0, L.PU_DASH);
  n.step([[L.EV_INPUT, 0, bumperWord({ yaw: 0, use: 1 })]]);
  assert.equal(n.v.bumper(0).item, L.PU_DASH);
  n.step([[L.EV_INPUT, 0, bumperWord({ yaw: 0, use: 2 })]]);
  assert.equal(n.v.bumper(0).item, 0);
});

test('ROCKET: golf\'s club, flying level, its blast shoving the ball it meets', async () => {
  const g = await use(L.PU_ROCKET, [C + 15, C]);
  assert.equal(g.v.projectiles().length, 1);
  let k = 0;
  while (g.v.projectiles().length && k++ < 200) g.step();
  assert.ok(k > 30 && k < 70, `${k} ticks to go 13 m`);
  const b = g.v.bumper(1);
  assert.ok(b.vel[0] > 10, `${b.vel[0]}`);
  assert.equal(b.hitBy, 0);
  assert.equal(fxs(g.v, L.FX_BLAST).length, 1);
});

test('SPRING: a high jump that can save a ball tipping into a hole, and a stomp where it lands', async () => {
  const g = await room(7, 2);
  noHoles(g);
  hole(g, 0, C + 3.4, C, 3);
  put(g, 0, C, C);
  put(g, 1, C - 4, C);
  give(g, 0, L.PU_SPRING);
  g.dv.setFloat32(L.PLAYERS + L.P_VX, 1.5, true);
  // over the hole and starting to drop, then the spring
  while (g.v.bumper(0).ground) g.step();
  g.step([[L.EV_INPUT, 0, bumperWord({ yaw: TURN / 2, move: 1, use: 1 })]]);
  assert.ok(g.v.bumper(0).vel[1] > 12);
  assert.ok(g.v.bumper(0).stomp);
  let top = 0;
  for (let k = 0; k < 400 && !g.v.bumper(0).ground; k++) { g.step([[L.EV_INPUT, 0, bumperWord({ yaw: TURN / 2, move: 1, use: 1 })]]); top = Math.max(top, g.v.bumper(0).pos[1]); }
  assert.ok(top > PLAT_Y + 3.5, `up ${top - PLAT_Y} m`);
  const a = g.v.bumper(0);
  assert.ok(a.ground && !a.falling && !a.out, 'saved: landed back on cheese');
  assert.ok(!a.stomp);
  assert.equal(fxs(g.v, L.FX_BLAST).length, 1, 'the stomp');
  assert.ok(Math.hypot(...g.v.bumper(1).vel) > 1, 'it shoved the ball beside it');
});

test('a late joiner watches the round and plays the next; a room alone plays till its ball falls', async () => {
  const g = await room(7, 2);
  g.step([[L.EV_JOIN, 2]]);
  assert.ok(g.v.bumper(2).out, 'watching');
  assert.equal(g.v.wheel().left, 2);
  for (const p of [0, 1]) g.dv.setUint8(L.PLAYERS + p * L.PSIZE + L.P_FL, L.PF_LIVE | L.PF_DEAD);
  g.step();
  assert.equal(g.v.wheel().state, L.H_OVER);
  assert.equal(g.v.wheel().winner, 255, 'nobody left: no winner');
  while (g.v.hole().state !== L.H_COUNT) g.step();
  assert.equal(g.v.wheel().n0, 3);
  assert.ok(!g.v.bumper(2).out, 'in the next round');
  const s = await room(9, 1);
  for (let k = 0; k < 1000; k++) s.step();
  assert.equal(s.v.hole().state, L.H_PLAY, 'alone, still playing');
});

// Predicts slot 0 through `inputs` from every tick (1 ahead, and 6 and 30 every
// 7th) and compares each with the confirmed world when it gets there.
function predicted(g, inputs) {
  const due = new Map();
  let compared = 0;
  for (let k = 0; k < inputs.length; k++) {
    for (const n of [1, 6, 30]) {
      if ((k % 7 !== 0 && n !== 1) || k + n > inputs.length) continue;
      for (let i = 0; i < n; i++) g.dv.setUint32(L.PWORDS + 4 * i, inputs[k + i], true);
      g.sim.x.predict(0, n);
      const list = due.get(k + n) || [];
      list.push({ n, from: k, player: g.sim.u8.slice(L.PLAYERS + L.PRED_D, L.PLAYERS + L.PRED_D + L.PSIZE) });
      due.set(k + n, list);
    }
    g.step([[L.EV_INPUT, 0, inputs[k]]]);
    for (const p of due.get(k + 1) || []) {
      assert.deepEqual(p.player, g.sim.u8.slice(L.PLAYERS, L.PLAYERS + L.PSIZE), `predicted ${p.n} from ${p.from}`);
      compared++;
    }
  }
  return compared;
}

test('the prediction matches the confirmed ball bit for bit: rolling, hops, MEGA, DASH, SPRING, over a hole and down it', async () => {
  const g = await room(7, 1);
  noHoles(g);
  wide(g);
  hole(g, 0, C + 40, C, 4);
  put(g, 0, C - 10, C);
  give(g, 0, L.PU_MEGA);
  const wobbly = Array.from({ length: 300 }, (_, k) => bumperWord({ yaw: Math.round(3000 * Math.sin(k / 20)) & (TURN - 1), move: k % 50 < 40 ? 1 : 2, hop: k === 80 || k === 81 ? 1 : 0, use: k >= 20 ? 1 : 0 }));
  assert.ok(predicted(g, wobbly) >= 300);
  assert.equal(g.v.bumper(0).radius, MEGA_RAD);
  give(g, 0, L.PU_DASH);
  assert.ok(predicted(g, Array.from({ length: 150 }, (_, k) => bumperWord({ yaw: TURN / 2, move: 4, use: k >= 10 ? 2 : 1 }))) >= 150);
  put(g, 0, C + 20, C);
  give(g, 0, L.PU_SPRING);
  assert.ok(predicted(g, Array.from({ length: 150 }, (_, k) => bumperWord({ yaw: 0, move: 1, use: k >= 5 ? 3 : 2 }))) >= 150);
  assert.ok(g.v.bumper(0).shots === 3, 'all three used');
  // on into the hole, and down it until just before it would be counted out
  const on = (n) => predicted(g, Array.from({ length: n }, () => bumperWord({ yaw: 0, move: 1, use: 3 })));
  for (let k = 0; k < 40 && !g.v.bumper(0).falling; k++) on(10);
  assert.ok(g.v.bumper(0).falling, 'over the hole and going through');
  assert.ok(on(110) >= 110);
  const b = g.v.bumper(0);
  assert.ok(b.falling && !b.out && b.pos[1] < PLAT_Y - 6, `down the shaft, at ${b.pos[1] - PLAT_Y} m`);
});

test('a round of AI balls replays to the same hash on every tick, on 1 and 4 threads', async () => {
  const bytes = bumperBytes();
  const { log, scores, rounds } = await playBumper({ bytes, bots: 8, ticks: 9000, leaveAt: 1000 });
  assert.ok(scores.reduce((s, b) => s + b.kos, 0) > 0, 'someone knocked someone out');
  assert.ok(rounds >= 1, `${rounds} rounds`);
  const parsed = parseLog(log);
  const a = await replay({ bytes, log: parsed, ticks: 9000, threads: 1, tag: 'b1' });
  const b = await replay({ bytes, log: parsed, ticks: 9000, threads: 4, tag: 'b4', startWorkers });
  assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
});

test("a spectator's camera on an AI ball: its heading eased, a cut to another ball panned", async () => {
  const { follower } = await import('../client/host.mjs');
  const f = follower();
  f.drive([0, 0, 0], 0);
  // an AI ball's word flipping between two headings a quarter turn apart every 3 frames, at 60 frames a second
  let prev = 0, most = 0, out;
  for (let i = 0; i < 120; i++) {
    out = f.update(5, [30 + i * 0.1, 0, 0], Math.floor(i / 3) % 2 ? Math.PI / 2 : 0, 1000 / 60);
    most = Math.max(most, Math.abs(out.yaw - prev));
    prev = out.yaw;
  }
  assert.ok(most <= 3 / 60 + 1e-9, `at most 3 rad/s: ${most * 60} rad/s`);
  assert.ok(Math.abs(out.yaw - Math.PI / 4) < 0.15, `settles between the two: ${out.yaw}`);
  // a cut from where your ball went out to a ball 30 m off: no jump, and on it within a second
  const g = follower();
  g.drive([0, 0, 0], 0);
  const first = g.update(9, [30, 0, 0], 0, 1000 / 60);
  assert.ok(first.at[0] < 3, `starts from the last ball shown: ${first.at[0]}`);
  for (let i = 0; i < 60; i++) out = g.update(9, [30, 0, 0], 0, 1000 / 60);
  assert.ok(Math.abs(out.at[0] - 30) < 1, `within a metre of it in a second: ${out.at[0]}`);
});
