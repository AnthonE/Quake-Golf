// BULLSEYE (src/mg/bullseye.wat): the ice and the house for the crowd, the
// bell's scores and their edges, the double ends, the shove wave, the
// bumps' kick, the edge, the end, the prediction through all of it, and
// rounds of AI balls playing it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty, partyBytes, predicted } from './helpers.mjs';
import { View, partyWord, PLAT_Y } from '../src/party-view.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { playParty } from '../tools/genparty.mjs';
import * as L from '../src/layout.mjs';
import * as MC from '../src/mg/bullseye.mjs'; // BE_*: the minigame's own constants
import be, { stage, ringAt, endOf, toBell, waveAt, pays } from '../client/mg/bullseye.mjs';

const C = L.B_CX;
const TICK = 0.008;
const E = MC.BE_END;
const f32 = Math.fround;
const Y = (a) => Math.round(a / (2 * Math.PI) * 16384) & 16383;

// A room of n balls in BULLSEYE, on the debug build (a NaN traps), stepped into play unless asked not to.
async function room(n = 2, { play = true, seed = 7 } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_BULLSEYE + 1, true);
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
  g.dv.setUint32(L.HDR_UNTIL, now - t + MC.BE_LEN, true);
}
// Ball p at (x, z) on the ice (or at y in the air), rolling at (vx, vz).
function put(g, p, x, z, { y = PLAT_Y, vx = 0, vz = 0, ground = true, fl = 0 } = {}) {
  g.dv.setFloat32(rec(p) + L.P_PX, x, true);
  g.dv.setFloat32(rec(p) + L.P_PY, y, true);
  g.dv.setFloat32(rec(p) + L.P_PZ, z, true);
  g.dv.setFloat32(rec(p) + L.P_VX, vx, true);
  g.dv.setFloat32(rec(p) + L.P_VY, 0, true);
  g.dv.setFloat32(rec(p) + L.P_VZ, vz, true);
  g.dv.setUint8(rec(p) + L.P_FL, L.PF_LIVE | (ground ? L.PF_GROUND : 0) | fl);
}
const score = (g, p) => g.dv.getUint16(rec(p) + L.PG_SCORE, true);
const setScore = (g, p, s) => g.dv.setUint16(rec(p) + L.PG_SCORE, s, true);
const fxs = (v, kind, from = 0) => { const out = []; for (let k = Math.max(from, v.fxCount() - L.FX_MAX); k < v.fxCount(); k++) { const f = v.fx(k); if (f.kind === kind) out.push(f); } return out; };
const off = (b) => Math.hypot(b.pos[0] - C, b.pos[2] - C);
// The rings' radii for n balls, and the ice's, as $be_setup lays them out.
function sizes(n) {
  const rn = f32(Math.sqrt(n)), hs = Math.max(1, f32(rn * MC.BE_HS));
  const ring = [MC.BE_R1, MC.BE_R2, MC.BE_R3, MC.BE_R4].map((r) => f32(r * hs));
  return { hs, ring, rad: Math.min(f32(ring[3] + f32(f32(rn * MC.BE_MK) + MC.BE_M0)), MC.BE_RMAX) };
}

test('the ice and the house for 1, 8, 64 and 256: sized for the crowd, every ball round the house on the ice, apart and still', async () => {
  let last = 0;
  for (const n of [1, 8, 64, 256]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party();
    const st = stage(g.v);
    const want = sizes(n);
    assert.equal(r.game, L.MG_BULLSEYE);
    assert.deepEqual([r.kind, r.len, r.respawn, r.flags], [L.PK_SCORE, MC.BE_LEN, MC.BE_RESPAWN, L.PGF_BUMPS | L.PGF_NOKICK]);
    assert.deepEqual([r.acc, r.drag, r.idle].map((x) => x.toFixed(4)), [MC.BE_ACC, MC.BE_DRAG, MC.BE_IDLE].map((x) => x.toFixed(4)));
    assert.equal(r.size, want.rad, `${r.size} m of ice for ${n}`);
    assert.equal(st.rad, want.rad);
    assert.deepEqual(st.ring, want.ring, `the house for ${n}`);
    assert.equal(want.hs, n === 256 ? 2 : 1, 'the house grows only past 64 balls, twice as big for 256');
    assert.ok(r.size > last, 'the ice grows with the crowd');
    last = r.size;
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p);
      assert.ok(b.ground && b.vel.every((x) => x === 0) && b.pos[1] === PLAT_Y, `${n}: P${p + 1} still on the ice`);
      const d = off(b);
      assert.ok(d >= st.ring[3] + MC.BE_SPAWN - 1e-3 && d <= st.rad - MC.BE_SPAWN + 1e-3, `${n}: P${p + 1} ${d.toFixed(2)} m out, round the house`);
      for (let q = 0; q < p; q++) assert.ok(Math.hypot(b.pos[0] - g.v.partier(q).pos[0], b.pos[2] - g.v.partier(q).pos[2]) > 2.2, `${n}: P${p + 1} and P${q + 1} apart`);
    }
  }
});

test('the ice: a push from rest makes 6.3 m/s in 2 s, near 10 flat out; let go and a ball slides on 10 m, where bumper\'s rubber stops it in under 6', async () => {
  const g = await room(2);
  put(g, 1, C - 15, C);
  put(g, 0, C, C + 15);
  for (let k = 0; k < 250; k++) g.step([[L.EV_INPUT, 0, partyWord({ yaw: Y(-Math.PI / 2), move: 1 })]]);
  let b = g.v.partier(0);
  assert.ok(Math.abs(-b.vel[2] - 6.27) < 0.05 && Math.abs(b.vel[0]) < 1e-3, `${(-b.vel[2]).toFixed(2)} m/s after 2 s`);
  // flat out: the push over the drag
  assert.ok(Math.abs(MC.BE_ACC * Number(L.BPHYS.B_ACC_DT) / (1 - MC.BE_DRAG) - 9.9) < 0.01);
  // let go at 6.3 m/s: it slides 10 m, where bumper's rubber (B_DRAG, keys or none) stops it in 4.5
  const z0 = b.pos[2];
  let k = 0;
  while (Math.abs(g.v.partier(0).vel[2]) > 0.1 && k++ < 2000) g.step([[L.EV_INPUT, 0, partyWord({ yaw: Y(-Math.PI / 2), move: 0 })]]);
  b = g.v.partier(0);
  const slid = z0 - b.pos[2];
  assert.ok(slid > 9.5 && slid < 10.5 && !b.out, `slid ${slid.toFixed(2)} m in ${k} ticks`);
  const rubber = 6.27 * Number(L.BPHYS.B_DRAG) / (1 - Number(L.BPHYS.B_DRAG)) * TICK;
  assert.ok(slid > 1.7 * rubber && rubber < 6, `${slid.toFixed(1)} m on ice, ${rubber.toFixed(1)} on rubber`);
});

test('the bell: every 10 s each ball in scores by the ring its centre is in, 5 the bull, 3 red, 2 white, 1 blue, each ring\'s edge in it; a ball down scores nothing; nothing between bells', async () => {
  const g = await room(8);
  const st = stage(g.v);
  assert.deepEqual(st.ring, [MC.BE_R1, MC.BE_R2, MC.BE_R3, MC.BE_R4]);
  at(g, E - 1);
  const spots = [[C, C], [C + 3, C], [C - 5.5, C], [C, C + 8.5], [C, C - 12], [C + 3, C + 3], [C - 0.9, C + 0.9], [C + st.rad - 3, C]];
  spots.forEach(([x, z], p) => put(g, p, x, z));
  // P7 is down in the bull, back long after the bell
  g.dv.setUint8(rec(6) + L.P_FL, L.PF_LIVE | L.PF_DEAD);
  g.dv.setUint32(rec(6) + L.B_OUTAT, g.v.tick + 500, true);
  const fx0 = g.v.fxCount();
  g.step();
  assert.deepEqual([...Array(8).keys()].map((p) => score(g, p)), [0, 0, 0, 0, 0, 0, 0, 0], 'nothing the tick before');
  g.step();
  assert.equal(g.v.party().t - 1, E, 'the bell\'s tick');
  assert.deepEqual([...Array(8).keys()].map((p) => score(g, p)), [5, 3, 2, 1, 0, 2, 0, 0]);
  assert.deepEqual([...Array(8).keys()].map((p) => g.v.partier(p).m), [0x10105, 0x10203, 0x10302, 0x10401, 0, 0x10302, 0, 0], 'a scorer\'s PG_M: the end, its ring, its points');
  assert.deepEqual(spots.map(([x, z]) => ringAt(st, x, z)), [0, 1, 2, 3, -1, 2, 0, -1], 'the client\'s rings are the sim\'s');
  const bull = fxs(g.v, MC.BE_FX_BULL, fx0), bell = fxs(g.v, MC.BE_FX_BELL, fx0);
  assert.equal(bull.length, 1);
  assert.deepEqual([bull[0].owner, bull[0].shot, bull[0].size, bull[0].pos], [0, 1, 5, [C, PLAT_Y, C]]);
  assert.equal(bell.length, 1);
  assert.deepEqual([bell[0].owner, bell[0].shot, bell[0].size, bell[0].pos], [0, 1, 5, [C, PLAT_Y, C]], 'the bell: P1 best, five scored');
  for (let k = 0; k < 40; k++) g.step();
  assert.deepEqual([...Array(8).keys()].map((p) => score(g, p)), [5, 3, 2, 1, 0, 2, 0, 0], 'nothing after it');
  // each ring's edge is in it, a hair past it the next ring's (or out)
  at(g, 2 * E);
  const edges = [[C + 1.5, C], [C - 4, C], [C, C + 7], [C, C - 10], [C + 4.02, C], [C - 7.02, C], [C, C + 10.02], [C, C - 1.52]];
  edges.forEach(([x, z], p) => put(g, p, x, z));
  for (let p = 0; p < 8; p++) setScore(g, p, 0);
  g.step();
  assert.deepEqual([...Array(8).keys()].map((p) => score(g, p)), [5, 3, 2, 1, 2, 1, 0, 3]);
  assert.deepEqual(edges.map(([x, z]) => ringAt(st, x, z)), [0, 1, 2, 3, 2, 3, -1, 1]);
  assert.equal(g.v.partier(6).m, 0, 'P7 out of the house: its PG_M as it was');
  assert.equal(fxs(g.v, MC.BE_FX_BELL).pop().shot, 2);
});

test('the last three ends score double; the ninth bell ends the round, placed by points, ties sharing', async () => {
  const g = await room(3);
  for (const [k, mul] of [[6, 1], [7, 2], [8, 2]]) {
    at(g, k * E);
    put(g, 0, C, C); put(g, 1, C + 3, C); put(g, 2, C, C + 15);
    for (let p = 0; p < 3; p++) setScore(g, p, 0);
    g.step();
    assert.deepEqual([0, 1, 2].map((p) => score(g, p)), [5 * mul, 3 * mul, 0], `end ${k}`);
    assert.deepEqual([pays(0, k), pays(1, k), pays(2, k), pays(3, k), pays(-1, k)], [5 * mul, 3 * mul, 2 * mul, 1 * mul, 0]);
  }
  for (const [s, spots, places, pts, winner] of [
    [[40, 45, 30], [[C + 3, C], [C, C + 15], [C, C]], [1, 2, 3], [10, 5, 1], 0], // 46, 45, 40: the ninth bell turns it
    [[40, 46, 30], [[C + 3, C], [C, C + 15], [C, C - 8]], [1, 1, 3], [10, 10, 1], 255],
  ]) {
    at(g, MC.BE_LEN - 1);
    spots.forEach(([x, z], p) => put(g, p, x, z));
    s.forEach((x, p) => setScore(g, p, x));
    const pts0 = [0, 1, 2].map((p) => g.v.partier(p).pts);
    g.step();
    assert.equal(g.v.hole().state, L.H_PLAY);
    g.step();
    assert.equal(g.v.hole().state, L.H_OVER, 'over on the ninth bell');
    assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).place), places);
    assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).pts - pts0[p]), pts);
    assert.equal(g.v.party().winner, winner);
    // back into a fresh round for the next case
    while (g.v.hole().state !== L.H_PLAY) g.step();
  }
});

test('the shove wave: from the tick after a bell a front runs out at 30 m/s and slides every ball in the house out past its edge, still on the ice; none before the first bell, between waves or past the house', async () => {
  const g = await room(7);
  const st = stage(g.v);
  // no wave before the first bell
  at(g, 1);
  for (let p = 0; p < 7; p++) put(g, p, C + 5 * Math.cos(p), C + 5 * Math.sin(p));
  for (let k = 0; k < 200; k++) g.step();
  for (let p = 0; p < 7; p++) assert.ok(g.v.partier(p).vel.every((x) => x === 0), 'still before the first bell');
  // round the house at the bell: the middle, 3, 5.9, 9.5, past the edge by 0.3 and by 1
  const rs = [0, 3, 5.9, 9.5, 10.3, 11, 7];
  at(g, E - 1);
  rs.forEach((r, p) => put(g, p, C + r * Math.cos(p * 0.9), C + r * Math.sin(p * 0.9)));
  // P7 rolling in at 4 m/s from 7 m: turned round, out at the wave's speed for where it is
  put(g, 6, C + 7 * Math.cos(5.4), C + 7 * Math.sin(5.4), { vx: -4 * Math.cos(5.4), vz: -4 * Math.sin(5.4) });
  g.step();
  g.step();
  const hit = Array(7).fill(-1);
  for (let a = 1; a < 450; a++) {
    g.step();
    assert.equal(g.v.party().t - 1, E + a);
    for (let p = 0; p < 7; p++) {
      const b = g.v.partier(p);
      if (hit[p] < 0 && p !== 6 && Math.hypot(b.vel[0], b.vel[2]) > 0) {
        hit[p] = a;
        const r = off(b), w = MC.BE_WK * (st.ring[3] + MC.BE_WM - rs[p]);
        const out = p === 0 ? b.vel[0] : (b.vel[0] * (b.pos[0] - C) + b.vel[2] * (b.pos[2] - C)) / r;
        assert.ok(Math.abs(out - w) < 1e-3, `P${p + 1} out at ${out.toFixed(3)} m/s, ${w.toFixed(3)} wanted`);
        assert.equal(b.vel[1], MC.BE_POP, 'popped off the ice');
        if (p === 0) assert.equal(b.vel[2], 0, 'dead on the middle: out along its slot\'s way, +x for P1');
      }
      if (p === 6 && hit[6] < 0) {
        const r = off(b), out = (b.vel[0] * (b.pos[0] - C) + b.vel[2] * (b.pos[2] - C)) / r;
        if (out > 0) hit[6] = a;
      }
    }
  }
  // the front reaches a ball as a BE_WAVEDT passes its distance
  assert.deepEqual(hit.slice(0, 5), [1, 13, 25, 40, 43], 'the ticks after the bell the front met each');
  assert.equal(hit[5], -1, 'past the edge by more than BE_CLR: untouched');
  assert.ok(hit[6] > 0 && hit[6] < 30, `the ball rolling in turned round ${hit[6]} ticks after the bell`);
  for (let p = 0; p < 7; p++) {
    const b = g.v.partier(p);
    const d = off(b);
    if (p === 5) assert.ok(Math.abs(d - 11) < 1e-4 && b.vel.every((x) => x === 0), 'P6 where it was');
    else assert.ok(d > st.ring[3] + 1 && d < st.rad - 2 && b.ground && !b.out, `P${p + 1} slid out to ${d.toFixed(2)} m, on the ice`);
  }
  assert.equal(waveAt(st, 0), -1);
  assert.equal(waveAt(st, E), -1);
  assert.ok(Math.abs(waveAt(st, E + 25) - 25 * MC.BE_WAVEDT) < 1e-9);
  assert.equal(waveAt(st, E + 60), -1, 'gone past the house');
  assert.equal(waveAt(st, MC.BE_LEN + 5), -1, 'none after the last bell');
  // and none between waves: a ball still in the red stays still
  at(g, E + 80);
  put(g, 0, C + 3, C);
  for (let k = 0; k < 300; k++) g.step();
  assert.ok(g.v.partier(0).vel.every((x) => x === 0), 'still between waves');
});

test('bumps: an elastic bounce, and a hard one kicked 0.8 times the speed it hit at more apart; a soft one only bounces; no second kick within BE_KGAP', async () => {
  const g = await room(2);
  const part = () => { const a = g.v.partier(0), b = g.v.partier(1); return b.vel[0] - a.vel[0]; };
  // P1 rolled at v into P2, still, 5 cm off it, out on the ice clear of the house (and a kick's gap since the last)
  const go = (v) => {
    for (let k = 0; k < MC.BE_KGAP + 2; k++) g.step();
    at(g, 300);
    put(g, 0, C - 6, C + 12, { vx: v });
    put(g, 1, C - 6 + 2.05, C + 12);
    let k = 0;
    while (g.v.partier(1).vel[0] === 0 && k++ < 100) g.step();
    return part();
  };
  for (const [v, want] of [[6, 6 * (1 + MC.BE_KICKK)], [4, 4 * (1 + MC.BE_KICKK)], [1.5, 1.5], [16, 16 + MC.BE_KMAX]]) {
    const s = go(v);
    // (a tick of drag and the push between: within a few percent)
    assert.ok(Math.abs(s - want) < 0.04 * want, `met at ${v} m/s: apart at ${s.toFixed(2)}, ${want.toFixed(2)} wanted`);
    // shared by weight: equal balls, equal shares about where they'd be with no kick
    const a = g.v.partier(0), b = g.v.partier(1);
    assert.ok(Math.abs(a.vel[0] + b.vel[0] - v) < 0.05 * v, 'its momentum kept');
  }
  // kicked: the pair's ticks in PG_S; met again at once, only the bounce
  const s1 = go(6);
  const now = g.v.tick - 1;
  assert.equal(g.dv.getUint32(L.PG_S + MC.BE_KAT, true), now);
  assert.equal(g.dv.getUint32(L.PG_S + MC.BE_KAT + 4, true), now);
  assert.ok(s1 > 10);
  put(g, 0, C - 6, C + 12, { vx: 6 });
  put(g, 1, C - 6 + 2.05, C + 12);
  g.step();
  g.step();
  assert.ok(Math.abs(part() - 6) < 0.3, `met again within BE_KGAP: apart at ${part().toFixed(2)}, the bounce alone`);
  // and a hard bump still counts for bumper's credit
  assert.equal(g.v.partier(1).hitBy, 0);
});

test('off the edge a ball is down 1.5 s, then back at the rim falling in, its points kept', async () => {
  const g = await room(2);
  const st = stage(g.v);
  at(g, 300);
  put(g, 0, C + st.rad - 0.5, C, { vx: 6 });
  put(g, 1, C - 6, C);
  setScore(g, 0, 17);
  let k = 0;
  while (!g.v.partier(0).out && k++ < 600) g.step();
  const sink = fxs(g.v, L.FX_SINK).pop();
  assert.ok(g.v.partier(0).out && sink && sink.owner === 0, 'down');
  const down = g.v.partier(0).outAt;
  while (g.v.partier(0).out && k++ < 1200) g.step();
  const b = g.v.partier(0);
  assert.equal(g.v.tick - 1 - down, MC.BE_RESPAWN, 'back after 1.5 s');
  assert.equal(score(g, 0), 17, 'its points kept');
  assert.ok(Math.abs(Math.hypot(b.pos[0] - C, b.pos[2] - C) - (st.rad - MC.BE_SPAWN)) < 1e-3, 'at the rim');
  assert.ok(!b.ground && b.pos[1] > PLAT_Y + 5, 'falling in');
  for (let j = 0; j < 150; j++) g.step();
  assert.ok(g.v.partier(0).ground && g.v.partier(0).pos[1] === PLAT_Y, 'on the ice');
});

// helpers.mjs's predicted, but its score and PG_M left out: a bell's points are the confirmed world's.
function predictedBut(g, inputs) {
  const due = new Map();
  let compared = 0;
  const blank = (u) => { u.fill(0, L.PG_SCORE, L.PG_SCORE + 2); u.fill(0, L.PG_M, L.PG_M + 4); return u; };
  for (let k = 0; k < inputs.length; k++) {
    for (const n of [1, 6, 30]) {
      if ((k % 7 !== 0 && n !== 1) || k + n > inputs.length) continue;
      for (let i = 0; i < n; i++) g.dv.setUint32(L.PWORDS + 4 * i, inputs[k + i], true);
      g.sim.x.predict(0, n);
      const list = due.get(k + n) || [];
      list.push({ n, from: k, player: blank(g.sim.u8.slice(L.PLAYERS + L.PRED_D, L.PLAYERS + L.PRED_D + L.PSIZE)) });
      due.set(k + n, list);
    }
    g.step([[L.EV_INPUT, 0, inputs[k]]]);
    for (const p of due.get(k + 1) || []) {
      assert.deepEqual(p.player, blank(g.sim.u8.slice(L.PLAYERS, L.PLAYERS + L.PSIZE)), `predicted ${p.n} from ${p.from}`);
      compared++;
    }
  }
  return compared;
}

test('the prediction matches the confirmed ball bit for bit: a slide over the house, to the edge and off it, through a bell and its wave; in the bull through a bell, all but the points', async () => {
  const g = await room(2);
  const st = stage(g.v);
  put(g, 1, C, C - st.rad + 3);
  // pushed across the house and on toward the far edge, braking, turning
  at(g, 200);
  put(g, 0, C - 14, C + 2);
  const across = Array.from({ length: 400 }, (_, k) => partyWord({ yaw: Y(k < 250 ? 0 : k < 330 ? Math.PI * 0.6 : Math.PI), move: k % 90 < 70 ? 1 : 0 }));
  assert.ok(predicted(g, across) >= 400);
  // off the edge: sliding out, over it, falling (till it's down: that's the confirmed world's)
  at(g, 600);
  put(g, 0, C + st.rad - 4, C + 1, { vx: 5 });
  assert.ok(predicted(g, Array.from({ length: 130 }, () => partyWord({ yaw: 0, move: 1 }))) >= 130);
  assert.ok(g.v.partier(0).falling, 'over the edge');
  // just out of the house as the bell rings (no points), rolling in through the wave, which throws it out again
  at(g, E - 20);
  put(g, 0, C + st.ring[3] + 0.6, C + 0.4, { vx: -1 });
  const wave = Array.from({ length: 160 }, (_, k) => partyWord({ yaw: Y(Math.PI), move: k < 100 ? 1 : 0 }));
  assert.ok(predicted(g, wave) >= 160);
  assert.equal(score(g, 0), 0, 'out of the house at the bell');
  // in the bull at the next bell, out with the wave, pushing back in against it
  at(g, 2 * E - 30);
  put(g, 0, C + 0.6, C - 0.2);
  const bull = Array.from({ length: 200 }, (_, k) => partyWord({ yaw: Y(Math.PI * 0.9), move: k > 40 ? 1 : 0 }));
  assert.ok(predictedBut(g, bull) >= 200);
  assert.equal(score(g, 0), 5, 'the bull at the bell');
  assert.ok(off(g.v.partier(0)) > 1.5, 'thrown out of it');
});

for (const [balls, sd] of [[8, 3], [64, 5]]) {
  test(`a round of ${balls} AI balls (the Partier, this brain) on the debug build: no trap, nine ends, the house full at the bells, the points spread, few falls; equal on 1 and 4 threads`, async () => {
    let start = -1, over = -1, places = null, pts = null, scores = null, trap = 0, downs = 0, inHouse = 0, bulls = 0;
    const was = [];
    const ticks = L.P_COUNT + MC.BE_LEN + 80 + balls;
    const { log, sim } = await playParty({ bytes: partyBytes(true), seed: sd, mg: L.MG_BULLSEYE, bots: balls, ticks, delay: 6, onTick: (t, s, v) => {
      if (s.error().code) trap = s.error().code;
      const g = v.party();
      if (start < 0 && g.state === L.H_PLAY) start = t;
      if (over < 0 && start >= 0 && g.state === L.H_OVER) {
        over = t;
        places = [...Array(balls).keys()].map((p) => v.partier(p).place);
        pts = [...Array(balls).keys()].map((p) => v.partier(p).pts);
        scores = [...Array(balls).keys()].map((p) => v.partier(p).score);
      }
      if (g.state !== L.H_PLAY) return;
      for (let p = 0; p < balls; p++) { const o = v.partier(p).out; if (o && !was[p]) downs++; was[p] = o; }
      if (g.t > 0 && g.t % E === 0) {
        const st = stage(v);
        let n = 0, bull = 0;
        for (let p = 0; p < balls; p++) { const b = v.partier(p); if (b.live && !b.out) { const k = ringAt(st, b.pos[0], b.pos[2]); if (k >= 0) n++; if (k === 0) bull++; } }
        inHouse += n;
        if (bull) bulls++;
      }
    } });
    assert.equal(trap, 0, 'no trap');
    assert.ok(over > 0, 'the round ended');
    assert.equal(over - start, MC.BE_LEN, 'on the ninth bell');
    assert.ok(places.every((x) => x >= 1 && x <= balls), `places ${places}`);
    assert.ok(pts.every((x) => x >= 1 && x <= 10), `points ${pts}`);
    assert.ok(places.includes(1) && pts.includes(10), 'somebody won');
    const hi = Math.max(...scores), mean = scores.reduce((a, b) => a + b, 0) / balls;
    const house = inHouse / MC.BE_ENDS / balls;
    assert.ok(house > (balls > 10 ? 0.55 : 0.85), `${(100 * house).toFixed(0)}% in the house at a bell`);
    assert.ok(bulls >= 6, `the bull taken at ${bulls} of the bells`);
    assert.ok(scores.filter((s) => s > 0).length >= 0.9 * balls, `scores ${scores}`);
    assert.ok(hi > 1.3 * mean && mean > (balls > 10 ? 8 : 20), `scores to ${hi}, mean ${mean.toFixed(1)}`);
    assert.ok(downs <= balls, `${downs} falls`);
    const v = new View(sim.memory.buffer);
    assert.equal(v.party().game, L.MG_BULLSEYE);
    const parsed = parseLog(log);
    const n = over + 40;
    const a = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 1, tag: 't1' });
    const b = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 4, tag: 't4', startWorkers });
    const d = await replay({ bytes: partyBytes(true), log: parsed, ticks: n, threads: 1, tag: 'd1' });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(d.trace).tickHashes], 'the debug build steps the same bits');
  });
}

test('the client module: draws every moment of an end, frames the ice, writes its HUD lines, and its brain makes for the house, brakes, rams the bull and keeps off the edge', async () => {
  const { Scene } = await import('../client/party-render.mjs');
  for (const n of [3, 140]) {
    const g = await room(n, { seed: 41 + n });
    const st = stage(g.v);
    const out = { scene: new Scene(24000), solid: [], glow: [], beams: [], decals: [], casters: [], paint: null };
    const lines = [];
    const hctx = { put: (x, y, s, c) => lines.push([y, s, c]), centre: (y, s, c) => lines.push([y, s, c]), right: (y, s, c) => lines.push([y, s, c]), rows: 44, C: {}, slot: 0, now: 0 };
    for (const t of [10, E - 200, E - 1, E + 10, E + 100, 7 * E - 5, MC.BE_LEN - 5]) {
      at(g, t);
      g.step();
      out.scene.clear(); out.decals.length = 0; out.beams.length = 0; out.glow.length = 0; lines.length = 0;
      be.draw(g.v, { tick: g.v.tick, t: (t + 0.5) * TICK, pt: (t + 0.5) * TICK, dt: 0, now: 0, slot: 0, me: g.v.partier(0), pme: g.v.partier(0), ptick: g.v.tick, pview: g.v }, out);
      assert.ok(out.scene.count > 20 && out.scene.count < 3000, `${out.scene.count} solids`);
      for (let k = 0; k < out.scene.count * 16; k++) assert.ok(Number.isFinite(out.scene.data[k]), 'finite');
      assert.ok(out.decals.length >= 9, 'the house');
      if (t === E + 10) assert.ok(out.decals.some((d) => Math.abs(d.radius - waveAt(st, t + 0.5)) < 1e-6), 'the wave');
      be.hud(g.v, { ...hctx, me: g.v.partier(0), t: (t + 0.5) * TICK });
      const text = lines.map((l) => l[1]).join(' | ');
      assert.ok(text.includes(`END ${endOf(t)} OF 9`) && text.includes('BULL '), text);
      if (endOf(t) >= 7) assert.ok(text.includes('DOUBLE') && text.includes('BULL 10'), text);
      if (toBell(t) <= MC.BE_WARN) assert.ok(text.includes(`BELL  ${Math.ceil(toBell(t) * TICK)}`), text);
      for (const l of lines) assert.ok(l[1].length <= 80, l[1]);
      const fr = be.frame(g.v);
      assert.equal(fr.shape, 'disc');
      assert.equal(fr.radius, st.rad);
    }
    assert.equal(be.brain.danger(g.v, C + st.rad + 1, C), 1);
    assert.equal(be.brain.danger(g.v, C, C), 0);
    assert.ok(be.brain.danger(g.v, C + st.rad - 1, C) > 0.3);
  }
  // the brain, on a room of 3 a few seconds into an end
  const g = await room(3, { seed: 9 });
  const st = stage(g.v);
  const think = (p, pos, vel, skill = 0.9) => be.brain.think(g.v, g.v.partier(p), { slot: p, skill, pos, vel, at: g.v.tick, mem: {} }, g.v.tick);
  const yawTo = (s, x, z) => Math.abs(((s.yaw - Math.atan2(z, x)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
  at(g, 300);
  put(g, 0, C, C + 14); put(g, 1, C - 14, C); put(g, 2, C + 14, C);
  g.step();
  // out on the ice and still: it pushes for the house
  let s = think(0, [C, C + 14], [0, 0]);
  assert.equal(s.move, 1);
  assert.ok(yawTo(s, 0, -1) < 0.6, `toward the house: ${s.yaw.toFixed(2)}`);
  const goal = be.brain.goal(g.v, g.v.partier(0), { slot: 0, skill: 0.9, pos: [C, C + 14], vel: [0, 0], at: g.v.tick, mem: {} });
  assert.ok(Math.hypot(goal[0] - C, goal[1] - C) <= st.ring[1], `its goal ${goal.map((x) => x.toFixed(1))} in the bull or the red`);
  // closing on its goal fast: it pushes back, braking
  s = think(0, [C, C + 2.5], [0, -8]);
  assert.ok(s.move === 1 && yawTo(s, 0, 1) < 0.8, `braking: ${s.yaw.toFixed(2)}`);
  // sliding at the edge: back in
  s = think(0, [C, C + st.rad - 2], [0, 6]);
  assert.ok(s.move === 1 && yawTo(s, 0, -1) < 0.6, `off the edge: back in, ${s.yaw.toFixed(2)}`);
  // a rival sits in the bull: a keen ball from out on the ice rams it, flat out
  put(g, 1, C + 0.3, C);
  g.step();
  let rammed = 0;
  for (let k = 0; k < 40; k++) {
    const b = { slot: 0, skill: 0.9, pos: [C, C + 9], vel: [0, -2], at: g.v.tick + k * 375, mem: {} };
    const plan = be.brain.goal(g.v, g.v.partier(0), b);
    if (Math.hypot(plan[0] - (C + 0.3), plan[1] - C) < 0.05) rammed++;
  }
  assert.ok(rammed > 0 && rammed < 40, `rammed the bull's ball on ${rammed} of 40 thinks`);
  assert.ok(be.hint.length <= 70 && be.rules.length <= 76);
});
