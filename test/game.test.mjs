import test from 'node:test';
import assert from 'node:assert/strict';
import { newSim, wasmBytes } from './helpers.mjs';
import { View, inputWord, MOVE } from '../src/view.mjs';
import { aimAt } from '../client/bot.mjs';
import { playHoles } from '../tools/gengame.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { compareTraces } from '../tools/compare.mjs';
import * as L from '../src/layout.mjs';

async function game(seed = 7) {
  const sim = await newSim(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = new DataView(sim.memory.buffer);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); };
  const until = (pred, max = 5000, recs = () => []) => { for (let i = 0; i < max && !pred(); i++) step(recs()); };
  return { sim, v, dv, step, until };
}

// Joins slot 0 and runs out the countdown.
async function playing(seed = 7) {
  const g = await game(seed);
  g.step([[L.EV_JOIN, 0]]);
  g.until(() => g.v.hole().state === L.H_PLAY);
  return g;
}

function teleport(g, p, x, z) {
  const b = L.PLAYERS + p * L.PSIZE;
  g.dv.setFloat32(b + L.P_PX, x, true);
  g.dv.setFloat32(b + L.P_PY, g.v.height(x, z), true);
  g.dv.setFloat32(b + L.P_PZ, z, true);
}

function fxKinds(v) {
  const out = [];
  for (let k = 0; k < v.fxCount(); k++) out.push(v.fx(k));
  return out;
}

test('sin and cos from add and multiply stay within 2e-7 of Math', async () => {
  const sim = await newSim();
  let worst = 0;
  for (let u = 0; u < 16384; u++) {
    const [s, c] = sim.x.sincos(u);
    const a = u / 16384 * 2 * Math.PI;
    worst = Math.max(worst, Math.abs(s - Math.sin(a)), Math.abs(c - Math.cos(a)));
  }
  assert.ok(worst < 2e-7, `error ${worst}`);
});

test('every seed lays out a hole: cup 160-300 m from the tee, a flat tee and green', async () => {
  const { sim, v } = await game();
  for (const seed of [1, 2, 3, 7, 99, 12345, 0xdeadbeef]) {
    sim.init(seed);
    const h = v.hole();
    const d = Math.hypot(h.cup[0] - h.tee[0], h.cup[2] - h.tee[2]);
    assert.ok(d >= 159.9 && d <= 300.1, `seed ${seed}: ${d} m`);
    for (const p of [h.tee, h.cup]) assert.ok(p[0] > 100 && p[0] < 924 && p[2] > 100 && p[2] < 924, `seed ${seed}: off the course`);
    assert.equal(v.surface(h.cup[0], h.cup[2]), 3, 'green under the cup');
    assert.equal(v.surface(h.tee[0], h.tee[2]), 0, 'fairway under the tee');
    assert.equal(h.par, d < 220 ? 3 : 4);
    // the green slopes less than 1.5% within 12 m of the cup
    for (const [dx, dz] of [[12, 0], [0, 12], [-8, -8], [8, -8]]) {
      const s = Math.abs(v.height(h.cup[0] + dx, h.cup[2] + dz) - h.cup[1]) / Math.hypot(dx, dz);
      assert.ok(s < 0.015, `seed ${seed}: green slope ${s}`);
      assert.ok(Math.abs(v.height(h.tee[0] + dx, h.tee[2] + dz) - h.tee[1]) < 0.02, `seed ${seed}: tee not flat`);
    }
  }
});

test('a join puts the player on the tee with a ball, and the countdown runs', async () => {
  const g = await game();
  g.step([[L.EV_JOIN, 3]]);
  const h = g.v.hole();
  const p = g.v.player(3);
  assert.equal(h.state, L.H_COUNT);
  assert.ok(p.live && p.ground);
  assert.ok(Math.hypot(p.pos[0] - h.tee[0], p.pos[2] - h.tee[2]) < 14);
  const b = g.v.ball(p.ball);
  assert.equal(b.owner, 3);
  assert.equal(b.flags, L.F_LIVE);
  assert.ok(Math.abs(b.pos[1] - (g.v.height(b.pos[0], b.pos[2]) + 0.2)) < 1e-3);
  g.until(() => g.v.hole().state === L.H_PLAY);
  assert.equal(g.v.tick, L.COUNT_TICKS + 1);
});

test('running: 10 m/s on the ground, feet on the slope, 0.7 s jumps', async () => {
  const g = await playing();
  const yaw = 4096; // facing +z
  const p0 = g.v.player(0).pos;
  let airborne = 0;
  for (let t = 0; t < 375; t++) {
    g.step([[L.EV_INPUT, 0, inputWord({ yaw, move: MOVE.FORWARD })]]);
    if (!g.v.player(0).ground) airborne++;
  }
  const p = g.v.player(0);
  assert.equal(airborne, 0, 'left the ground while walking');
  assert.ok(Math.abs(Math.hypot(...p.vel) - 10) < 0.05, `speed ${Math.hypot(...p.vel)}`);
  assert.ok(p.pos[2] - p0[2] > 28 && Math.abs(p.pos[0] - p0[0]) < 0.01, `moved ${p.pos[2] - p0[2]}`);
  let air = 0;
  for (let t = 0; t < 200; t++) {
    g.step([[L.EV_INPUT, 0, inputWord({ yaw, jump: t === 0 ? 1 : 0 })]]);
    if (!g.v.player(0).ground) air++;
  }
  // 2 x 7 / 20 = 0.7 s on the flat; less here, still running up a slope
  assert.ok(air >= 75 && air <= 90, `${air} ticks in the air`);
});

test('a rocket at your feet is a stroke and a rocket jump', async () => {
  const g = await playing();
  const word = (shot) => inputWord({ yaw: 0, pitch: 0, shot });
  g.step([[L.EV_INPUT, 0, word(0)]]);
  let vy = 0;
  for (let t = 0; t < 30; t++) { g.step([[L.EV_INPUT, 0, word(1)]]); vy = Math.max(vy, g.v.player(0).vel[1]); }
  assert.ok(vy > 10, `peak vy ${vy}`);
  assert.equal(g.v.player(0).strokes, 1);
  assert.deepEqual(fxKinds(g.v).map((f) => f.kind), [L.FX_SHOT, L.FX_BLAST]);
  // the counter doesn't move again: no second shot, whatever the refire
  for (let t = 0; t < 200; t++) g.step();
  assert.equal(g.v.player(0).strokes, 1);
});

test('no shots in the countdown, and a press there never fires later', async () => {
  const g = await game();
  g.step([[L.EV_JOIN, 0]]);
  g.step([[L.EV_INPUT, 0, inputWord({ shot: 1 })]]);
  g.until(() => g.v.hole().state === L.H_PLAY);
  for (let t = 0; t < 50; t++) g.step();
  assert.equal(g.v.fxCount(), 0);
  assert.equal(g.v.player(0).strokes, 0);
});

test('a blast just behind the ball drives it at the cup', async () => {
  const g = await playing();
  const h = g.v.hole();
  const me = g.v.player(0);
  const b0 = g.v.ball(me.ball).pos;
  const dir = [h.cup[0] - b0[0], h.cup[2] - b0[2]];
  const len = Math.hypot(...dir);
  const bp = [b0[0] - dir[0] / len * 0.6, 0, b0[2] - dir[1] / len * 0.6];
  bp[1] = g.v.height(bp[0], bp[2]);
  teleport(g, 0, bp[0] - dir[0] / len, bp[2] - dir[1] / len);
  const p = g.v.player(0).pos;
  const a = aimAt([p[0], p[1] + 1.6, p[2]], bp);
  g.step([[L.EV_INPUT, 0, inputWord({ ...a, shot: 1 })]]);
  g.until(() => g.v.tick > 600 && !(g.v.ball(me.ball).flags & L.F_AWAKE), 3000);
  const b1 = g.v.ball(me.ball).pos;
  const along = ((b1[0] - b0[0]) * dir[0] + (b1[2] - b0[2]) * dir[1]) / len;
  assert.ok(along > 100, `went ${along} m`);
  assert.ok(Math.abs(((b1[0] - b0[0]) * dir[1] - (b1[2] - b0[2]) * dir[0]) / len) < 0.05 * along, 'off line');
});

test('a grenade bounces and goes off on its 2.5 s fuse', async () => {
  const g = await playing();
  const w = (shot) => inputWord({ yaw: 0, pitch: 600, weapon: 1, shot });
  g.step([[L.EV_INPUT, 0, w(0)]]);
  g.step([[L.EV_INPUT, 0, w(1)]]);
  let low = Infinity;
  g.until(() => {
    const j = g.v.projectiles()[0];
    if (j) low = Math.min(low, j.pos[1] - g.v.height(j.pos[0], j.pos[2]));
    return !j;
  }, 500, () => [[L.EV_INPUT, 0, w(1)]]);
  const fx = fxKinds(g.v);
  assert.deepEqual(fx.map((f) => f.kind), [L.FX_SHOT, L.FX_BLAST]);
  // the tick it is fired counts as its first
  assert.equal(fx[1].tick - fx[0].tick, L.FUSE - 1);
  assert.ok(low < 0.2, 'never touched the ground');
  assert.ok(Math.hypot(fx[1].pos[0] - fx[0].pos[0], fx[1].pos[2] - fx[0].pos[2]) > 10, 'went nowhere');
});

test('players push other balls but walk through their own', async () => {
  const g = await game();
  g.step([[L.EV_JOIN, 0], [L.EV_JOIN, 1]]);
  g.until(() => g.v.hole().state === L.H_PLAY);
  const mine = g.v.ball(g.v.player(0).ball);
  const theirs = g.v.ball(g.v.player(1).ball);
  const walk = (ball) => {
    teleport(g, 0, ball.pos[0] - 3, ball.pos[2]);
    for (let t = 0; t < 100; t++) g.step([[L.EV_INPUT, 0, inputWord({ yaw: 0, move: MOVE.FORWARD })]]);
    for (let t = 0; t < 400; t++) g.step([[L.EV_INPUT, 0, inputWord({ yaw: 0 })]]);
    return g.v.ball(ball.index).pos;
  };
  assert.deepEqual(walk(mine), mine.pos);
  const after = walk(theirs);
  assert.ok(after[0] - theirs.pos[0] > 0.3, `pushed ${after[0] - theirs.pos[0]} m`);
});

test('a slow ball over the cup is sunk: the hole scores, then restarts on a new ball', async () => {
  const g = await playing();
  const h = g.v.hole();
  const me = g.v.player(0);
  // roll the ball at the cup from 2 m out (the test moves it by hand)
  const f32 = g.v.f32;
  const i = me.ball;
  f32[(L.PX >> 2) + i] = h.cup[0] - 2;
  f32[(L.PZ >> 2) + i] = h.cup[2];
  f32[(L.PY >> 2) + i] = g.v.height(h.cup[0] - 2, h.cup[2]) + 0.2;
  f32[(L.VX >> 2) + i] = 3;
  g.v.u8[L.FLAGS + i] = L.F_LIVE | L.F_AWAKE;
  g.until(() => g.v.player(0).done, 500);
  const p = g.v.player(0);
  assert.ok(p.done);
  assert.equal(g.v.ball(i).flags, L.F_SUNK);
  assert.equal(g.v.hole().state, L.H_OVER, 'the only player is in, so the hole is over');
  assert.equal(p.score, 0);
  assert.equal(p.holes, 1);
  assert.equal(fxKinds(g.v).at(-1).kind, L.FX_SINK);
  g.until(() => g.v.hole().state === L.H_COUNT, L.OVER_TICKS + 2);
  const q = g.v.player(0);
  assert.equal(g.v.hole().hole, 1);
  assert.ok(!q.done && q.ball !== i && q.strokes === 0);
  assert.equal(g.v.ball(q.ball).flags, L.F_LIVE);
  // a sunk ball is out of play: no blast moves it
  g.until(() => g.v.hole().state === L.H_PLAY);
  assert.deepEqual(g.v.ball(i).pos, [h.cup[0], h.cup[1] - 1, h.cup[2]].map(Math.fround));
});

test('the time limit ends the hole with a penalty, and an empty room goes idle', async () => {
  const g = await playing();
  g.until(() => g.v.hole().state === L.H_OVER, L.LIMIT_TICKS + 2);
  assert.equal(g.v.player(0).score, L.PENALTY);
  const ball = g.v.player(0).ball;
  g.step([[L.EV_LEAVE, 0]]);
  assert.equal(g.v.hole().state, L.H_IDLE);
  assert.equal(g.v.player(0).live, false);
  assert.equal(g.v.ball(ball).flags & L.F_LIVE, L.F_LIVE, 'the ball stays');
});

test('a bot-played match replays to the same hash, on 1, 2 and 4 threads and random splits', async () => {
  const bytes = wasmBytes();
  const live = await playHoles({ bytes, courseSeed: 8, bots: 3, ticks: 4000 });
  assert.ok(live.fx.filter((f) => f.kind === L.FX_BLAST).length >= 3, 'the bots barely played');
  const log = parseLog(live.log);
  const run = async (threads, salt = 0) => decodeTrace((await replay({ bytes, log, ticks: 4000, threads, salt, tag: `t${threads}`, startWorkers })).trace);
  const one = await run(1);
  assert.equal(one.tickHashes[3999], live.hash, 'the replay ends where the live game did');
  for (const [n, salt] of [[2, 0], [4, 0], [1, 777]]) {
    const r = compareTraces(one, await run(n, salt));
    assert.ok(r.ok, `${n} threads, salt ${salt}: ${r.what}`);
  }
});
