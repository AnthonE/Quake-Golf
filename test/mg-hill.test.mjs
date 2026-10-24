import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty, partyBytes, predicted } from './helpers.mjs';
import { View, partyWord, PLAT_Y } from '../src/party-view.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { playParty } from '../tools/genparty.mjs';
import * as L from '../src/layout.mjs';
import hill, { stage, zoneAt, up, groundAt, reach, worth } from '../client/mg/hill.mjs';

const C = L.B_CX;
const TICK = 0.008;
const P = L.KH_PERIOD;

// A room of n balls on King of the Hill, on the debug build (a NaN traps),
// stepped into play unless asked not to.
async function room(n = 2, { play = true, seed = 7 } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_HILL + 1, true);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); assert.equal(sim.error().code, 0, 'no trap'); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  while (play && v.hole().state !== L.H_PLAY) step();
  return { sim, v, dv, step };
}
const rec = (p) => L.PLAYERS + p * L.PSIZE;
// The next step plays tick t into play (the clock moved, the round's end with it).
function at(g, t) {
  const now = g.v.tick;
  g.dv.setUint32(L.HDR_START, now - t, true);
  g.dv.setUint32(L.HDR_UNTIL, now - t + L.KH_LEN, true);
}
// Ball p at (x, z) on the ground the next step plays on (or at y), rolling at (vx, vz).
function put(g, p, x, z, { y = null, vx = 0, vz = 0, ground = true } = {}) {
  const st = stage(g.v);
  const top = groundAt(st, g.v.party().t, x, z);
  g.dv.setFloat32(rec(p) + L.P_PX, x, true);
  g.dv.setFloat32(rec(p) + L.P_PY, y ?? top, true);
  g.dv.setFloat32(rec(p) + L.P_PZ, z, true);
  g.dv.setFloat32(rec(p) + L.P_VX, vx, true);
  g.dv.setFloat32(rec(p) + L.P_VY, 0, true);
  g.dv.setFloat32(rec(p) + L.P_VZ, vz, true);
  g.dv.setUint8(rec(p) + L.P_FL, L.PF_LIVE | (ground ? L.PF_GROUND : 0));
}
const score = (g, p) => g.dv.getUint16(rec(p) + L.PG_SCORE, true);
const setScore = (g, p, s) => g.dv.setUint16(rec(p) + L.PG_SCORE, s, true);
const fxs = (v, kind) => { const out = []; for (let k = 0; k < v.fxCount(); k++) { const f = v.fx(k); if (f.kind === kind) out.push(f); } return out; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test('the stage for 1, 8, 64 and 256: a disc and its hills sized for the crowd, more hills for more balls, every ball on the floor off the first hills, apart', async () => {
  let last = 0;
  for (const [n, nh] of [[1, 1], [8, 1], [64, 2], [256, 3]]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party();
    const st = stage(g.v);
    assert.deepEqual([r.kind, r.len, r.respawn], [L.PK_SCORE, L.KH_LEN, L.KH_RESPAWN]);
    const rad = Math.min(L.KH_R0 + L.KH_RK * Math.sqrt(n), L.KH_RMAX), z = L.KH_Z0 + L.KH_ZK * Math.sqrt(n);
    assert.ok(Math.abs(r.size - rad) < 1e-4 && Math.abs(st.rad - rad) < 1e-4, `${r.size} m for ${n}`);
    assert.ok(Math.abs(st.z - z) < 1e-4 && Math.abs(st.F - L.KH_FOOT * z) < 1e-4 && Math.abs(st.H - L.KH_HIGH * st.F) < 1e-4);
    assert.ok(Math.abs(st.top - L.KH_TOPK * z) < 1e-4);
    assert.ok(r.size > last, 'grows with the crowd');
    last = r.size;
    assert.equal(st.nh, nh, `${nh} hills a zone for ${n}`);
    // every hill near enough the middle that its hidden half stays under the floor
    const rs = Math.max(0, rad - 1.2 * st.F - 1);
    for (let j = 0; j < L.KH_ZONES; j++) {
      for (const s of st.spots[j]) assert.ok(dist(s, [C, C]) <= rs + 0.02, `${n}: zone ${j}'s hill ${dist(s, [C, C]).toFixed(2)} m out, at most ${rs.toFixed(2)}`);
      for (let i = 0; i < nh; i++) for (let q = i + 1; q < nh; q++) assert.ok(dist(st.spots[j][i], st.spots[j][q]) >= 1.69 * st.F, `${n}: zone ${j}'s hills apart`);
      if (j > 0) {
        const near = Math.min(...st.spots[j].flatMap((a) => st.spots[j - 1].map((b) => dist(a, b))));
        assert.ok(near > 0.25 * rs, `${n}: zone ${j} moved ${near.toFixed(1)} m`);
      }
    }
    if (nh === 1) assert.deepEqual(st.spots[0][0], [C, C], 'one hill: the first in the middle');
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p);
      assert.ok(b.ground && b.vel.every((x) => x === 0), `${n}: P${p + 1} still on the ground`);
      assert.ok(dist([b.pos[0], b.pos[2]], [C, C]) <= rad - 1.5 + 1e-3, `${n}: P${p + 1} on the disc`);
      assert.equal(b.pos[1], PLAT_Y, 'on the floor');
      for (const s of st.spots[0]) assert.ok(dist([b.pos[0], b.pos[2]], s) >= st.F + 1.5 - 1e-3, `${n}: P${p + 1} off the hill`);
      for (let q = 0; q < p; q++) assert.ok(dist([b.pos[0], b.pos[2]], [g.v.partier(q).pos[0], g.v.partier(q).pos[2]]) > 2, `${n}: P${p + 1} apart`);
    }
  }
});

test('the first hill stands from the countdown: the top of an ellipsoid sunk half its height, a ball rolled at it climbs it and stays on it', async () => {
  const g = await room(2);
  const st = stage(g.v);
  const [sx, sz] = st.spots[0][0];
  assert.ok(Math.abs(groundAt(st, 10, sx, sz) - (PLAT_Y + st.H)) < 1e-4, 'the top');
  assert.ok(Math.abs(groundAt(st, 10, sx + st.F + 0.01, sz) - PLAT_Y) < 1e-6, 'the floor past its foot');
  assert.equal(groundAt(st, 10, C + st.rad + 0.5, C), -Infinity, 'off the disc');
  put(g, 0, sx - st.F - 2, sz, { vx: 7 });
  put(g, 1, C + st.rad - 2, C);
  let top = 0;
  for (let k = 0; k < 180; k++) {
    g.step([[L.EV_INPUT, 0, partyWord({ yaw: 0, move: 1 })]]);
    const b = g.v.partier(0);
    assert.ok(b.ground, `on the ground ${k} ticks on`);
    const y = groundAt(st, g.v.party().t - 1, b.pos[0], b.pos[2]);
    assert.ok(Math.abs(b.pos[1] - y) < 2e-3, `on the hill's top: ${b.pos[1]} for ${y}`);
    top = Math.max(top, b.pos[1]);
  }
  assert.ok(top > PLAT_Y + st.H - 0.05, `up to ${(top - PLAT_Y).toFixed(2)} of ${st.H.toFixed(2)} m`);
});

test('the slope pulls: a still ball on its side rolls down and off, gripping the ground all the way, and so does one rolled over the top', async () => {
  const g = await room(2);
  const st = stage(g.v);
  const [sx, sz] = st.spots[0][0];
  put(g, 0, sx, sz + 0.55 * st.F);
  put(g, 1, C - st.rad + 2, C);
  let d0 = dist([g.v.partier(0).pos[0], g.v.partier(0).pos[2]], [sx, sz]), k = 0;
  for (; k < 400 && d0 < st.F + 0.5; k++) {
    g.step();
    const b = g.v.partier(0);
    const d = dist([b.pos[0], b.pos[2]], [sx, sz]);
    assert.ok(b.ground, `gripping, ${k} ticks on`);
    assert.ok(d >= d0 - 1e-5, 'down it, never back up');
    assert.ok(Math.abs(b.pos[0] - sx) < 1e-3, 'straight down');
    d0 = d;
  }
  assert.ok(k < 400 && k > 30, `off it in ${k} ticks`);
  assert.ok(g.v.partier(0).vel[2] > 1.5, `at ${g.v.partier(0).vel[2].toFixed(2)} m/s`);
  // over the top at speed: on the ground going down the far side (its roll would leave it in the air every other tick)
  put(g, 0, sx - 2, sz, { vx: 9 });
  for (let n = 0; n < 150; n++) {
    g.step([[L.EV_INPUT, 0, partyWord({ yaw: 0, move: 1 })]]);
    assert.ok(g.v.partier(0).ground, `over the top and down, ${n} ticks on`);
  }
  assert.ok(g.v.partier(0).pos[0] > sx + st.F, 'and off it');
});

test('a point a tick on the ground in the zone, two on its top, none outside it or in the air; the zone shrinks as it goes', async () => {
  const g = await room(4);
  const st = stage(g.v);
  const [sx, sz] = st.spots[0][0];
  at(g, 100);
  put(g, 0, sx, sz);
  put(g, 1, sx + 0.7 * st.z, sz);
  put(g, 2, sx, sz - st.z - 0.5);
  put(g, 3, sx, sz + 0.5 * st.z, { y: groundAt(st, 100, sx, sz + 0.5 * st.z) + 1, ground: false });
  const before = [0, 1, 2, 3].map((p) => score(g, p));
  g.step();
  assert.deepEqual([0, 1, 2, 3].map((p) => score(g, p) - before[p]), [2, 1, 0, 0]);
  assert.deepEqual([worth(st, 100, sx, sz), worth(st, 100, sx + 0.7 * st.z, sz), worth(st, 100, sx, sz - st.z - 0.5)], [2, 1, 0]);
  // 0.8 of the zone out: in as it opens, out once it has shrunk past it
  assert.ok(Math.abs(reach(st, P - 1) - st.z * (1 - L.KH_SHRINK * (P - 1) / P)) < 1e-4);
  for (const [t, want] of [[5, 1], [P - 10, 0]]) {
    at(g, t);
    put(g, 0, sx + 0.8 * st.z, sz);
    for (let p = 1; p < 4; p++) put(g, p, C + (st.rad - 2) * Math.cos(p * 2), C + (st.rad - 2) * Math.sin(p * 2));
    const s0 = score(g, 0);
    g.step();
    assert.equal(score(g, 0) - s0, want, `0.8 of the zone out ${t} ticks into it`);
  }
});

test('every 15 s the zone moves on: the next hill swells 3 s ahead, the old one sinks after with a ball riding it down; FX mark both', async () => {
  const g = await room(2);
  const st = stage(g.v);
  const [ax, az] = st.spots[0][0], [bx, bz] = st.spots[1][0];
  assert.ok(groundAt(st, P, bx, bz) - groundAt(st, P - L.KH_RISE - 1, bx, bz) > 0.2 * st.H, 'the next swells');
  assert.ok(Math.abs(groundAt(st, P, bx, bz) - (PLAT_Y + st.H)) < 1e-4);
  assert.equal(up(1, P - L.KH_RISE), 0);
  assert.equal(up(1, P), 1);
  assert.equal(up(0, P + L.KH_RISE), 0);
  assert.ok(up(1, P - L.KH_RISE / 2) > 0.45 && up(1, P - L.KH_RISE / 2) < 0.55);
  at(g, P - L.KH_RISE - 2);
  put(g, 0, ax, az);
  put(g, 1, C + st.rad - 2, C);
  const fx0 = g.v.fxCount();
  let rode = true, y0 = Infinity;
  for (let t = P - L.KH_RISE - 2; t < P + L.KH_RISE + 5; t++) {
    g.step([[L.EV_INPUT, 0, partyWord({ yaw: 0 })]]);
    const b = g.v.partier(0);
    if (t >= P) { rode &&= b.ground; assert.ok(b.pos[1] <= y0 + 1e-4, 'down with it'); y0 = b.pos[1]; }
  }
  assert.ok(rode, 'on the ground as its hill sank');
  assert.ok(g.v.partier(0).pos[1] < PLAT_Y + 0.5 * st.H, 'down off its top');
  assert.ok(g.v.fxCount() > fx0);
  const next = fxs(g.v, L.KH_FX_NEXT).filter((f) => f.size === 1);
  const move = fxs(g.v, L.KH_FX_MOVE).filter((f) => f.size === 1);
  assert.equal(next.length, 1);
  assert.equal(move.length, 1);
  const T = g.v.party().start;
  // (the clock was moved back past tick 0: the sim's u32 ticks wrap)
  assert.deepEqual([(next[0].tick - T) | 0, next[0].pos[0], next[0].pos[2], next[0].pos[1]], [P - L.KH_RISE, bx, bz, PLAT_Y]);
  assert.equal((move[0].tick - T) | 0, P);
  assert.ok(Math.abs(move[0].pos[1] - (PLAT_Y + st.H)) < 1e-4, 'on the new top');
  assert.equal(zoneAt(P - 1), 0);
  assert.equal(zoneAt(P), 1);
  assert.equal(zoneAt(L.KH_LEN + 5), L.KH_ZONES - 1);
});

test('off the rim a ball is down 2 s, then back on the disc off the open hills, falling in, its points kept', async () => {
  const g = await room(2);
  const st = stage(g.v);
  at(g, 300);
  put(g, 0, C + st.rad + 0.5, C, { y: PLAT_Y, vx: 4, ground: false });
  put(g, 1, C - st.rad + 3, C);
  setScore(g, 0, 321);
  let k = 0;
  while (!g.v.partier(0).out && k++ < 400) g.step();
  const sink = fxs(g.v, L.FX_SINK).pop();
  assert.ok(g.v.partier(0).out && sink && sink.owner === 0, 'down');
  const down = g.v.partier(0).outAt;
  while (g.v.partier(0).out && k++ < 800) g.step();
  const b = g.v.partier(0);
  assert.equal(g.v.tick - 1 - down, L.KH_RESPAWN, 'back after 2 s');
  assert.equal(score(g, 0), 321, 'its points kept');
  assert.ok(dist([b.pos[0], b.pos[2]], [C, C]) <= st.rad - 1.5 + 1e-3, 'on the disc');
  for (const s of st.spots[zoneAt(g.v.party().t)]) assert.ok(dist([b.pos[0], b.pos[2]], s) >= st.F + 1.5 - 1e-3, 'off the open hill');
  assert.ok(!b.ground && b.pos[1] > PLAT_Y + 5, 'falling in');
});

test('the leader: the most points of the room, a tie keeping who had it; KH_FX_LEAD at most every second', async () => {
  const g = await room(3);
  const st = stage(g.v);
  for (let p = 0; p < 3; p++) put(g, p, C + (p - 1) * 6, C + st.rad - 3);
  const lead = () => g.v.dv.getUint32(L.PG_H + L.KH_LEAD, true);
  assert.equal(lead(), 255, 'nobody before a point');
  const n0 = fxs(g.v, L.KH_FX_LEAD).length;
  setScore(g, 0, 10); setScore(g, 1, 5);
  g.step();
  assert.equal(lead(), 0);
  let f = fxs(g.v, L.KH_FX_LEAD);
  assert.equal(f.length, n0 + 1);
  assert.deepEqual([f.at(-1).owner, f.at(-1).shot, f.at(-1).size], [0, 255, 10]);
  setScore(g, 1, 10);
  g.step();
  assert.equal(lead(), 0, 'a tie keeps it');
  setScore(g, 1, 11);
  g.step();
  assert.equal(lead(), 1, 'past it takes it');
  assert.equal(fxs(g.v, L.KH_FX_LEAD).length, n0 + 1, 'but no FX within a second of the last');
  for (let k = 0; k < L.KH_LEADGAP; k++) g.step();
  setScore(g, 2, 50);
  g.step();
  f = fxs(g.v, L.KH_FX_LEAD);
  assert.equal(lead(), 2);
  assert.deepEqual([f.length, f.at(-1).owner, f.at(-1).shot], [n0 + 2, 2, 1]);
});

test('the round ends at 90 s placed by points: the most wins, ties share', async () => {
  for (const [s, places, pts, winner] of [[[300, 200, 100], [1, 2, 3], [10, 5, 1], 0], [[300, 300, 100], [1, 1, 3], [10, 10, 1], 255]]) {
    const g = await room(3);
    const st = stage(g.v);
    at(g, L.KH_LEN - 3);
    for (let p = 0; p < 3; p++) { put(g, p, C + (p - 1) * 6, C + st.rad - 3); setScore(g, p, s[p]); }
    let k = 0;
    while (g.v.hole().state === L.H_PLAY && k++ < 10) g.step();
    assert.equal(g.v.hole().state, L.H_OVER);
    assert.equal(k, 4, 'on the 90th second');
    assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).place), places);
    assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).pts), pts);
    assert.equal(g.v.party().winner, winner);
    assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).wins), places.map((x) => (x === 1 ? 1 : 0)));
  }
});

test('the prediction matches the confirmed ball bit for bit, its score too: up a hill, over its top, through the zone moving on, onto a hill swelling under it', async () => {
  const g = await room(2);
  const st = stage(g.v);
  const [ax, az] = st.spots[0][0];
  put(g, 1, C + st.rad - 2, C);
  // from the floor up the first hill and over its top, scoring on the way
  put(g, 0, ax - st.F - 1, az, { vx: 6 });
  assert.ok(predicted(g, Array.from({ length: 200 }, () => partyWord({ yaw: 0, move: 1 }))) >= 200);
  assert.ok(score(g, 0) > 50, `scored ${score(g, 0)}`);
  // sitting on its top as the zone moves on: the next hill swelling, this one sinking under it
  at(g, P - 40);
  put(g, 0, ax, az);
  assert.ok(predicted(g, Array.from({ length: 160 }, () => partyWord({ yaw: 0 }))) >= 160);
  // standing on the floor where the next hill swells: lifted as it rises
  at(g, 2 * P - L.KH_RISE - 20);
  const [cx2, cz2] = st.spots[2][0];
  const t0 = 2 * P - L.KH_RISE - 20;
  const spot = [0.3, 0.5, 0.7, 0.9].flatMap((f) => [0, 1, 2, 3, 4, 5].map((a) => [cx2 + f * st.z * Math.cos(a), cz2 + f * st.z * Math.sin(a)]))
    .find(([x, z]) => groundAt(st, t0, x, z) === PLAT_Y && dist([x, z], [C + st.rad - 2, C]) > 3);
  assert.ok(spot, 'floor on the next hill\'s top');
  put(g, 0, spot[0], spot[1]);
  assert.ok(predicted(g, Array.from({ length: 300 }, () => partyWord({ yaw: 0 }))) >= 300);
  assert.ok(g.v.partier(0).pos[1] > PLAT_Y + 0.3 * st.H, `lifted to ${(g.v.partier(0).pos[1] - PLAT_Y).toFixed(2)} m`);
});

for (const [balls, sd] of [[8, 3], [64, 5]]) {
  test(`a round of ${balls} AI balls (the Partier, this brain) on the debug build: no trap, played to the clock, the points spread, a winner; equal on 1 and 4 threads`, async () => {
    let start = -1, over = -1, places = null, pts = null, scores = null, maxIn = 0, trap = 0;
    const ticks = L.P_COUNT + L.KH_LEN + 80 + balls;
    const { log, sim } = await playParty({ bytes: partyBytes(true), seed: sd, mg: L.MG_HILL, bots: balls, ticks, delay: 6, onTick: (t, s, v) => {
      if (s.error().code) trap = s.error().code;
      const g = v.party();
      if (start < 0 && g.state === L.H_PLAY) start = t;
      if (g.state === L.H_PLAY && g.t % 250 === 0) {
        const st = stage(v);
        let n = 0;
        for (let p = 0; p < balls; p++) { const b = v.partier(p); if (b.live && !b.out && b.ground && worth(st, g.t, b.pos[0], b.pos[2])) n++; }
        maxIn = Math.max(maxIn, n);
      }
      if (over < 0 && start >= 0 && g.state === L.H_OVER) {
        over = t;
        places = [...Array(balls).keys()].map((p) => v.partier(p).place);
        pts = [...Array(balls).keys()].map((p) => v.partier(p).pts);
        scores = [...Array(balls).keys()].map((p) => v.partier(p).score);
      }
    } });
    assert.equal(trap, 0, 'no trap');
    assert.ok(over > 0, 'the round ended');
    assert.equal(over - start, L.KH_LEN, 'on the clock');
    assert.ok(places.every((x) => x >= 1 && x <= balls), `places ${places}`);
    assert.ok(pts.every((x) => x >= 1 && x <= 10), `points ${pts}`);
    assert.ok(places.includes(1) && pts.includes(10), 'somebody won');
    const hi = Math.max(...scores), lo = Math.min(...scores), mean = scores.reduce((a, b) => a + b, 0) / balls;
    assert.ok(hi > 1.3 * mean && mean > 0.08 * L.KH_LEN, `scores ${lo}..${hi}, mean ${mean.toFixed(0)}`);
    assert.ok(maxIn >= Math.min(balls, 4), `${maxIn} in a zone at once`);
    const v = new View(sim.memory.buffer);
    assert.equal(v.party().game, L.MG_HILL);
    const parsed = parseLog(log);
    const n = over + 40;
    const a = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 1, tag: 't1' });
    const b = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 4, tag: 't4', startWorkers });
    const d = await replay({ bytes: partyBytes(true), log: parsed, ticks: n, threads: 1, tag: 'd1' });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(d.trace).tickHashes], 'the debug build steps the same bits');
  });
}

test('the client module: draws every moment of a zone, frames the disc, writes its HUD lines, and its brain keeps off the rim and makes for a hill', async () => {
  const { Scene } = await import('../client/party-render.mjs');
  for (const n of [3, 140]) {
    const g = await room(n, { seed: 41 + n });
    const st = stage(g.v);
    const out = { scene: new Scene(24000), solid: [], glow: [], beams: [], decals: [], casters: [], paint: null };
    const lines = [];
    const hctx = { put: (x, y, s, c) => lines.push([y, s, c]), centre: (y, s, c) => lines.push([y, s, c]), right: (y, s, c) => lines.push([y, s, c]), rows: 44, C: {}, slot: 0, now: 0 };
    for (const t of [10, P / 2, P - L.KH_RISE + 100, P - 60, P + 100, 3 * P + 10, L.KH_LEN - 5]) {
      at(g, t);
      g.step();
      out.scene.clear(); out.decals.length = 0; out.beams.length = 0; out.glow.length = 0; lines.length = 0;
      hill.draw(g.v, { tick: g.v.tick, t: t * TICK, pt: t * TICK, dt: 0, now: 0, slot: 0, me: g.v.partier(0), pme: g.v.partier(0), ptick: g.v.tick, pview: g.v }, out);
      assert.ok(out.scene.count > 20 && out.scene.count < 3000, `${out.scene.count} solids`);
      for (let k = 0; k < out.scene.count * 16; k++) assert.ok(Number.isFinite(out.scene.data[k]), 'finite');
      assert.ok(out.decals.length >= 1 + st.nh);
      hill.hud(g.v, { ...hctx, me: g.v.partier(0), t: t * TICK });
      const text = lines.map((l) => l[1]).join(' | ');
      assert.ok(/HILL|LAST HILL/.test(text), text);
      for (const l of lines) assert.ok(l[1].length <= 80, l[1]);
      const fr = hill.frame(g.v);
      assert.equal(fr.shape, 'disc');
      assert.ok(Math.abs(fr.radius - st.rad) < 1e-4);
      // its goal is a top: of the open zone's hills, or the next's near the switch
      const goal = hill.brain.goal(g.v, g.v.partier(0), { slot: 0, skill: 0.9, pos: [g.v.partier(0).pos[0], g.v.partier(0).pos[2]], vel: [0, 0], at: g.v.tick });
      const k = zoneAt(t);
      const tops = [...st.spots[k], ...(st.spots[k + 1] || [])];
      assert.ok(tops.some((s) => dist(goal, s) <= st.top), `goal ${goal} near a top`);
    }
    assert.equal(hill.brain.danger(g.v, C + st.rad + 1, C), 1);
    assert.equal(hill.brain.danger(g.v, C, C), 0);
    assert.ok(hill.brain.danger(g.v, C + st.rad - 1, C) > 0.3);
  }
  assert.ok(hill.hint.length <= 70);
});
