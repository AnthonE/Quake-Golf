import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty, partyBytes, predicted } from './helpers.mjs';
import { View, partyWord, PLAT_Y, seed as pseed } from '../src/party-view.mjs';
import { replay, parseLog, encodeLog, decodeTrace, newMemory, instantiate, Sim } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { Partier } from '../client/party-bot.mjs';
import * as L from '../src/layout.mjs';
import pads, { stage, padsFor, rimAt, phaseOf, PHASE, padsOf, padAt, claims, survived } from '../client/mg/pads.mjs';

const C = L.B_CX;
const TICK = 0.008;
const f = Math.fround;
const rad = (n) => f(Math.min(f(f(f(Math.sqrt(n)) * f(L.MP_RK)) + L.MP_R0), L.MP_RMAX));

// A room of n balls on Musical Pads, on the debug build (a NaN traps), stepped into play.
async function room(n = 2, { play = true, seed = 7 } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_PADS + 1, true);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); assert.equal(sim.error().code, 0, 'no trap'); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  while (play && v.hole().state !== L.H_PLAY) step();
  return { sim, v, dv, step };
}
const rec = (p) => L.PLAYERS + p * L.PSIZE;
// Ball p still at (x, z) on the floor (or y), rolling at vx along x.
function put(g, p, x, z, { y = PLAT_Y, vx = 0, ground = true } = {}) {
  g.dv.setFloat32(rec(p) + L.P_PX, x, true);
  g.dv.setFloat32(rec(p) + L.P_PY, y, true);
  g.dv.setFloat32(rec(p) + L.P_PZ, z, true);
  g.dv.setFloat32(rec(p) + L.P_VX, vx, true);
  g.dv.setFloat32(rec(p) + L.P_VY, 0, true);
  g.dv.setFloat32(rec(p) + L.P_VZ, 0, true);
  g.dv.setUint8(rec(p) + L.P_FL, L.PF_LIVE | (ground ? L.PF_GROUND : 0));
}
const playT = (g) => g.v.party().t; // the tick into play the next step plays
const stepTo = (g, t, recs) => { while (playT(g) < t) g.step(recs?.()); };
const fxs = (v, kind, from = 0) => { const out = []; for (let k = from; k < v.fxCount(); k++) { const x = v.fx(k); if (x.kind === kind) out.push(x); } return out; };
const ends = (g) => padsOf(g.v, stage(g.v)).map((p) => [p.x1, p.z1]);
const won = (g, p) => g.v.u8[L.PG_S + L.MP_FINAL + p];
// A spot on the floor at least `pad` m from every pad's end and `gap` m from each of `away`, nearest (x, z).
function offPads(g, away = [], { pad = L.MP_PAD_R + 1.5, gap = 3, x = C, z = C } = {}) {
  const list = ends(g), r = stage(g.v).rimB - 2;
  let best = null, bd = Infinity;
  for (let k = 0; k < 2000; k++) {
    const a = k * 2.399963, rr = r * Math.sqrt((k + 0.5) / 2000), px = C + Math.cos(a) * rr, pz = C + Math.sin(a) * rr;
    if (!list.every(([qx, qz]) => Math.hypot(qx - px, qz - pz) >= pad) || !away.every(([qx, qz]) => Math.hypot(qx - px, qz - pz) >= gap)) continue;
    const d = Math.hypot(px - x, pz - z);
    if (d < bd) { bd = d; best = [px, pz]; }
  }
  assert.ok(best, 'a spot off the pads');
  return best;
}
// The balls the claim on the step just played judged, as the JS has it: those in before it, where they are now
// (a claim moves nobody; an out only stops it), not falling.
function judged(g, before) {
  return (p) => {
    const b = g.v.partier(p);
    return before.has(p) && !b.falling ? b.pos : null;
  };
}
const inNow = (v) => new Set([...Array(L.NPLAYER).keys()].filter((p) => { const b = v.partier(p); return b.live && !b.out && !b.falling; }));

test('the stage for 1, 8, 64 and 256: a floor sized for the crowd, every ball on it apart, the first song laid out with play', async () => {
  let last = 0;
  for (const n of [1, 8, 64, 256]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party();
    assert.equal(r.game, L.MG_PADS);
    assert.equal(r.size, rad(n), `${r.size} m for ${n}`);
    assert.ok(r.size > last, 'grows with the crowd');
    last = r.size;
    assert.deepEqual([r.kind, r.len, r.floor, r.idle, r.hop], [L.PK_OUT, L.MP_LEN, PLAT_Y, f(L.MP_IDLE), 6]);
    const st = stage(g.v);
    assert.deepEqual([st.r0, st.rimA, st.rimB, st.rimT], [r.size, r.size, r.size, 0]);
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p);
      assert.ok(b.ground && !b.out && b.pos[1] === PLAT_Y);
      assert.ok(Math.hypot(b.pos[0] - C, b.pos[2] - C) <= r.size * L.MP_SPAWN + 1e-3, 'on the middle of the floor');
      for (let q = 0; q < p; q++) {
        const o = g.v.partier(q);
        assert.ok(Math.hypot(b.pos[0] - o.pos[0], b.pos[2] - o.pos[2]) >= 2, `${n}: P${p + 1} and P${q + 1} apart`);
      }
    }
    // play: the first song and its pads
    const k0 = g.v.fxCount();
    while (g.v.hole().state !== L.H_PLAY) g.step();
    const s = stage(g.v);
    const m = s.stop - s.start;
    assert.equal(s.start, 0);
    assert.equal(m, L.MP_M0 + pseed(g.v, L.MP_KMUSIC) % (L.MP_M1 - L.MP_M0 + 1), 'the song\'s length from $p_seed');
    assert.equal(s.claim - s.stop, n >= L.MP_FEW ? L.MP_WIN : L.MP_WIN1);
    assert.equal(s.next, s.claim + L.MP_PAUSE);
    assert.equal(s.npad, padsFor(n));
    assert.equal(s.n, n);
    assert.equal(s.glides, n <= L.MP_GLIDEN ? 1 : 0);
    assert.ok(s.npad >= 2 ? s.gold < s.npad : s.gold === 255, `gold ${s.gold}`);
    const list = padsOf(g.v, s);
    const ru = r.size - L.MP_EDGE + 1e-3;
    let near = Infinity;
    for (const p of list) {
      assert.ok(Math.hypot(p.x0 - C, p.z0 - C) <= ru && Math.hypot(p.x1 - C, p.z1 - C) <= ru, 'in from the rim');
      const glide = Math.hypot(p.x1 - p.x0, p.z1 - p.z0);
      if (s.glides) assert.ok(glide <= L.MP_GLIDE + 1e-3 && glide > 0.5, `glides ${glide.toFixed(2)} m`);
      else assert.equal(glide, 0);
      for (const o of list) if (o !== p) near = Math.min(near, Math.hypot(p.x0 - o.x0, p.z0 - o.z0));
    }
    if (list.length > 1) assert.ok(near >= L.MP_GAP, `${n}: pads ${near.toFixed(2)} m apart at least`);
    const music = fxs(g.v, L.MP_FX_MUSIC, k0);
    assert.equal(music.length, 1);
    assert.deepEqual([music[0].owner, music[0].shot, music[0].size], [255, 0, s.npad]);
  }
});

test('pads for the balls in: one fewer up to six, then half, rounded up', async () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 16, 17, 255, 256].map(padsFor), [1, 1, 2, 3, 4, 5, 4, 4, 5, 8, 9, 128, 128]);
  for (const n of [2, 3, 6, 7]) {
    const g = await room(n, { seed: 40 + n });
    assert.equal(stage(g.v).npad, padsFor(n), `${n} balls`);
  }
});

test('the music, then the pads light (laid out a song before, unchanged), the scramble, the claim, a pause, the next song', async () => {
  const g = await room(10, { seed: 3 });
  const s = stage(g.v);
  const before = g.sim.u8.slice(L.PG_S, L.PG_S + 16 * s.npad);
  const k0 = g.v.fxCount();
  stepTo(g, s.stop - 1);
  assert.equal(pads.music(g.v, g.v.tick), true);
  g.step();
  assert.equal(fxs(g.v, L.MP_FX_STOP, k0).length, 0, 'quiet through the music');
  g.step();
  const stop = fxs(g.v, L.MP_FX_STOP, k0);
  assert.equal(stop.length, 1);
  assert.deepEqual([stop[0].tick - g.v.party().start, stop[0].shot, stop[0].size], [s.stop, 0, s.claim - s.stop]);
  assert.equal(pads.music(g.v, g.v.tick), false, 'the music stops with it');
  assert.equal(phaseOf(stage(g.v), playT(g)), PHASE.SCRAMBLE);
  assert.deepEqual(g.sim.u8.slice(L.PG_S, L.PG_S + 16 * s.npad), before, 'the pads as laid out');
  // three still on pads (one of them two balls' worth off its middle), the rest off them
  stepTo(g, s.claim);
  const list = ends(g), spots = [];
  for (let p = 0; p < 10; p++) {
    if (p < 3) put(g, p, list[p][0] + (p === 2 ? 1.5 : 0), list[p][1]);
    else { spots.push(offPads(g, spots)); put(g, p, ...spots.at(-1)); }
  }
  const was = inNow(g.v);
  g.step();
  const holdJs = claims(padsOf(g.v), ends(g), judged(g, was));
  const claim = fxs(g.v, L.MP_FX_CLAIM, k0);
  assert.equal(claim.length, 1);
  const hold = g.sim.u8.slice(L.PG_S + L.MP_HOLD, L.PG_S + L.MP_HOLD + s.npad);
  assert.deepEqual([...hold], [...holdJs], 'the JS claims as the sim makes them');
  const held = [...hold].filter((h) => h !== 255).length;
  assert.deepEqual([...hold].slice(0, 3), [0, 1, 2]);
  assert.deepEqual([claim[0].shot, claim[0].size, held], [3, 7, 3]);
  assert.equal(phaseOf(stage(g.v), playT(g)), PHASE.PAUSE);
  stepTo(g, s.next);
  g.step();
  const t = stage(g.v);
  assert.equal(t.cycle, 1);
  assert.equal(t.start, s.next);
  assert.equal(pads.music(g.v, g.v.tick), true);
  assert.equal(fxs(g.v, L.MP_FX_MUSIC, k0).length, 1);
});

test('the claim: each pad to the ball nearest its centre, on it, near the floor; the rest out together, sharing the place', async () => {
  const g = await room(4, { seed: 5 });
  const s = stage(g.v);
  assert.equal(s.npad, 3);
  stepTo(g, s.claim);
  const [a, b, c] = ends(g);
  put(g, 0, a[0], a[1]); // on pad 0's middle
  put(g, 2, b[0] + 0.5, b[1]); // on pad 1, nearer its middle
  put(g, 1, b[0] - 1.6, b[1]); // on pad 1 too, further out (2.1 m from P3: not touching)
  put(g, 3, c[0], c[1], { y: PLAT_Y + 3, ground: false }); // over pad 2, too high
  const k0 = g.v.fxCount();
  g.step();
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.partier(p).out), [false, true, false, true]);
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.partier(p).place), [0, 4, 0, 4], 'out on one tick: one place');
  assert.deepEqual([...g.sim.u8.slice(L.PG_S + L.MP_HOLD, L.PG_S + L.MP_HOLD + 3)], [0, 2, 255]);
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.u8[L.PG_S + L.MP_PADOF + p]), [0, 255, 1, 255]);
  assert.deepEqual([0, 1, 2, 3].map((p) => survived(g.v, p)), [1, 0, 1, 0]);
  const claim = fxs(g.v, L.MP_FX_CLAIM, k0)[0];
  assert.deepEqual([claim.owner, claim.shot, claim.size], [255, 2, 2]);
  assert.equal(fxs(g.v, L.FX_SINK, k0).length, 2);
  assert.deepEqual([stage(g.v).held, stage(g.v).lost, g.v.party().left], [2, 2, 2]);
  assert.equal(g.v.party().state, L.H_PLAY);
});

test('a gliding pad is claimed where it has glided to; the gold pad\'s holder gets a power-up', async () => {
  const g = await room(5, { seed: 11 });
  let s = stage(g.v);
  assert.equal(s.glides, 1);
  // find a song whose gold pad there is (four pads for five balls: always one)
  assert.ok(s.gold < s.npad);
  stepTo(g, s.claim);
  const list = padsOf(g.v, s);
  const glide = (p) => Math.hypot(p.x1 - p.x0, p.z1 - p.z0);
  const others = [0, 1, 2, 3].filter((i) => i !== s.gold).sort((a, b) => glide(list[a]) - glide(list[b]));
  put(g, 0, list[s.gold].x1, list[s.gold].z1);
  put(g, 1, list[others[0]].x1, list[others[0]].z1);
  put(g, 2, list[others[1]].x1, list[others[1]].z1);
  put(g, 3, list[others[2]].x0, list[others[2]].z0); // where the pad that glid furthest lit, not where it went
  put(g, 4, C + 200, C, { y: PLAT_Y - 5, ground: false }); // gone over the edge, falling
  g.dv.setUint8(rec(4) + L.P_FL, L.PF_LIVE | L.PF_FALL);
  assert.ok(Math.hypot(list[others[2]].x1 - list[others[2]].x0, list[others[2]].z1 - list[others[2]].z0) > L.MP_PAD_R + 1, 'it glided off');
  const k0 = g.v.fxCount();
  g.step();
  assert.deepEqual([0, 1, 2, 3, 4].map((p) => g.v.partier(p).out), [false, false, false, true, true]);
  const item = g.v.partier(0).item;
  assert.ok(item >= 1 && item <= L.NPU, `P1 got ${item}`);
  const pick = fxs(g.v, L.FX_PICKUP, k0);
  assert.equal(pick.length, 1);
  assert.deepEqual([pick[0].owner, pick[0].shot, pick[0].size, pick[0].pos[0], pick[0].pos[2]], [0, s.gold, item, list[s.gold].x1, list[s.gold].z1]);
  s = stage(g.v);
  assert.equal(s.held, 3);
});

test('nobody on a pad: nobody is out, and the song plays again', async () => {
  const g = await room(3, { seed: 13 });
  const s = stage(g.v);
  stepTo(g, s.claim);
  const spots = [];
  for (let p = 0; p < 3; p++) { spots.push(offPads(g, spots)); put(g, p, ...spots[p]); }
  const k0 = g.v.fxCount();
  g.step();
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).out), [false, false, false]);
  assert.deepEqual([fxs(g.v, L.MP_FX_CLAIM, k0)[0].shot, fxs(g.v, L.MP_FX_CLAIM, k0)[0].size], [0, 0]);
  assert.equal(stage(g.v).rimB, stage(g.v).r0, 'the floor stays');
  stepTo(g, s.next + 1);
  assert.equal(stage(g.v).npad, s.npad, 'the same again');
});

test('the final: the last two play for two claims of the one pad', async () => {
  const g = await room(2, { seed: 17 });
  const tally = [];
  for (const who of [0, 1, 0]) {
    const s = stage(g.v);
    assert.equal(s.npad, 1);
    stepTo(g, s.claim);
    const [[x, z]] = ends(g);
    // the other 6 m from it, toward the middle (or past it): on the floor
    const d = Math.hypot(x - C, z - C) || 1;
    put(g, who, x, z);
    put(g, 1 - who, C + (x - C) / d * (d - 6), C + (z - C) / d * (d - 6));
    const k0 = g.v.fxCount();
    g.step();
    const claim = fxs(g.v, L.MP_FX_CLAIM, k0)[0];
    assert.deepEqual([claim.owner, claim.shot], [who, 1]);
    tally.push([won(g, 0), won(g, 1), g.v.partier(0).out, g.v.partier(1).out]);
    if (g.v.party().state !== L.H_PLAY) break;
    stepTo(g, stage(g.v).next + 1);
  }
  assert.deepEqual(tally, [[1, 0, false, false], [1, 1, false, false], [2, 1, false, true]]);
  const r = g.v.party();
  assert.equal(r.state, L.H_OVER);
  assert.equal(r.winner, 0);
  assert.deepEqual([g.v.partier(0).place, g.v.partier(1).place, g.v.partier(0).pts, g.v.partier(1).pts, g.v.partier(0).wins], [1, 2, 10, 1, 1]);
});

test('fewer balls at the stop than at the song\'s start: fewer pads light', async () => {
  const g = await room(8, { seed: 19 });
  const s = stage(g.v);
  assert.deepEqual([s.npad, s.glides], [4, 1]);
  stepTo(g, s.stop - 10);
  g.step([4, 5, 6, 7, 3].map((p) => [L.EV_LEAVE, p]));
  stepTo(g, s.stop + 1);
  assert.equal(stage(g.v).npad, padsFor(3));
  assert.ok(stage(g.v).gold < 2 || stage(g.v).gold === 255);
});

test('the floor closes in after a claim to fit the balls left: a ball on the ring it loses falls and is out', async () => {
  const g = await room(16, { seed: 23 });
  let s = stage(g.v);
  stepTo(g, s.claim);
  const list = ends(g);
  for (let p = 0; p < 16; p++) put(g, p, p < 8 ? list[p][0] : C + 300 + 3 * p, p < 8 ? list[p][1] : C, { ground: p < 8 });
  const k0 = g.v.fxCount();
  g.step();
  s = stage(g.v);
  assert.equal(g.v.party().left, 8);
  assert.deepEqual([s.rimA, s.rimB, s.rimT], [rad(16), rad(8), s.claim + L.MP_SHRINK0]);
  assert.equal(g.v.party().size, rad(8));
  // P1 still on the ring the floor loses, P2 inside the rim to come, both away from the rest
  const rr = (rad(16) + rad(8)) / 2;
  let a0 = 0;
  for (let k = 0; k < 64; k++) {
    const a = k / 64 * 2 * Math.PI;
    const far = (r) => list.slice(2, 8).every(([x, z]) => Math.hypot(x - (C + Math.cos(a) * r), z - (C + Math.sin(a) * r)) > 4);
    if (far(rr) && far(rad(8) - 2)) { a0 = a; break; }
  }
  put(g, 0, C + Math.cos(a0) * rr, C + Math.sin(a0) * rr);
  put(g, 1, C + Math.cos(a0) * (rad(8) - 2), C + Math.sin(a0) * (rad(8) - 2));
  let fell = -1;
  for (let k = 0; k < L.MP_SHRINK0 + L.MP_SHRINKT + 20; k++) {
    const t = playT(g);
    g.step();
    if (fell < 0 && !g.v.partier(0).ground) fell = t;
    assert.ok(g.v.partier(1).ground, 'inside it stays up');
  }
  const passed = s.rimT + L.MP_SHRINKT * (s.rimA - rr) / (s.rimA - s.rimB);
  assert.ok(Math.abs(fell - passed) <= 2, `fell at ${fell}, the rim passed at ${passed.toFixed(1)}`);
  for (let t = s.rimT - 3; t < s.rimT + L.MP_SHRINKT + 3; t++) assert.ok(rimAt(s, t) <= s.rimA && rimAt(s, t) >= s.rimB);
  const close = fxs(g.v, L.MP_FX_CLOSE, k0);
  assert.equal(close.length, 1);
  assert.deepEqual([close[0].tick - g.v.party().start, close[0].size], [s.rimT, rad(8)]);
  for (let k = 0; k < 200 && !g.v.partier(0).out; k++) g.step();
  assert.ok(g.v.partier(0).out, 'out');
  // the next song's pads inside the floor it closed to
  for (const p of padsOf(g.v)) assert.ok(Math.hypot(p.x0 - C, p.z0 - C) <= rad(8) - L.MP_EDGE + 1e-3);
});

test('the prediction matches the confirmed ball bit for bit: rolling through the music and the scramble, a claim it survives, the rim closing in under it', async () => {
  const g = await room(16, { seed: 29 });
  let s = stage(g.v);
  // four balls left of sixteen (three pads at the stop): P1 makes for pad 0, P2 holds the pad furthest from it,
  // P3 and P4 wait off the pads far from both, and go out at the claim
  stepTo(g, s.stop - 200);
  g.step([...Array(12).keys()].map((k) => [L.EV_LEAVE, k + 4]));
  const list = ends(g).slice(0, 3);
  const [x0, z0] = list[0];
  const far = list[1][0] === undefined || Math.hypot(list[1][0] - x0, list[1][1] - z0) > Math.hypot(list[2][0] - x0, list[2][1] - z0) ? list[1] : list[2];
  const a = offPads(g, [[x0, z0], far], { gap: 9, x: 2 * C - x0, z: 2 * C - z0 });
  const b = offPads(g, [[x0, z0], far, a], { gap: 9, x: 2 * C - x0, z: 2 * C - z0 });
  const park = () => { put(g, 1, ...far); put(g, 2, ...a); put(g, 3, ...b); };
  park();
  put(g, 0, x0, z0);
  // A: short pushes every way round pad 0 through the music's end and into the scramble, then still on it
  const roll = Array.from({ length: 260 }, (_, k) => partyWord({ yaw: (k * 2477) & 16383, move: (k >> 4) & 1, hop: k % 90 === 30 ? 1 : 0 }));
  assert.ok(predicted(g, roll) >= roll.length);
  assert.equal(phaseOf(stage(g.v), playT(g)), PHASE.SCRAMBLE);
  put(g, 0, x0, z0);
  park();
  assert.ok(predicted(g, Array(s.claim - playT(g)).fill(partyWord({}))) > 0);
  assert.equal(playT(g), s.claim);
  g.step([[L.EV_INPUT, 0, partyWord({})]]);
  assert.ok(!g.v.partier(0).out && !g.v.partier(1).out && g.v.partier(2).out && g.v.partier(3).out, 'P1 and P2 held theirs');
  s = stage(g.v);
  assert.ok(s.rimB < s.rimA - 4, `closing in from ${s.rimA} to ${s.rimB}`);
  // B: across the floor from P2, still on the ring the floor loses, then rolling along it as the rim comes in, off and down
  const af = Math.atan2(far[1] - C, far[0] - C) + Math.PI, rr = s.rimB + 1.2;
  put(g, 0, C + Math.cos(af) * rr, C + Math.sin(af) * rr);
  const along = Math.round((af + Math.PI / 2) / (2 * Math.PI) * 16384) & 16383;
  const words = [...Array(160).fill(partyWord({})), ...Array.from({ length: 300 }, (_, k) => partyWord({ yaw: (along + (k & 64 ? 300 : -300)) & 16383, move: 1 }))];
  assert.ok(predicted(g, words) >= words.length);
  assert.ok(g.v.partier(0).falling || g.v.partier(0).out, 'went down with the rim');
});

// A round of AI balls (client/party-bot.mjs's Partier, steered by this
// minigame's brain), each word landing `delay` ticks after it's decided,
// recorded as a log: { log, sim, stats }.
async function aiRound({ bytes, seed, balls, ticks, delay = 8 }) {
  const memory = newMemory();
  const sim = new Sim(await instantiate(await WebAssembly.compile(bytes), memory), memory);
  sim.init(seed);
  const v = new View(memory.buffer);
  const bots = Array.from({ length: balls }, (_, k) => ({ r: new Partier(k, seed, 0.3 + 0.6 * ((k * 7) % 10) / 9), queue: [], last: -1 }));
  const recs = [];
  const stats = { start: -1, over: -1, claims: [], places: null, pts: null, winner: -1, mirror: 0 };
  let seen = 0;
  for (let t = 0; t < ticks; t++) {
    const now = [];
    if (t === 0) for (const b of bots) now.push([L.EV_JOIN, b.r.slot]);
    for (const b of bots) {
      b.queue.push(b.r.think(v, t + delay, 2 * delay));
      if (b.queue.length > delay) {
        const w = b.queue.shift();
        if (w !== b.last) { now.push([L.EV_INPUT, b.r.slot, w]); b.last = w; }
      }
    }
    for (const [kind, slot, word] of now) recs.push([t, kind, slot, word]);
    // the claim this step makes, as the JS has it: the balls in before it, where it leaves them
    const g0 = v.party(), st = stage(v);
    const was = g0.state === L.H_PLAY && g0.t === st.claim ? inNow(v) : null;
    sim.feedPlayers(now);
    sim.x.step();
    if (sim.error().code) break;
    if (was) {
      const list = padsOf(v, st);
      const js = claims(list, list.map((p) => padAt(st, p, st.claim)), (p) => { const b = v.partier(p); return was.has(p) && !b.falling ? b.pos : null; });
      assert.deepEqual([...sim.u8.slice(L.PG_S + L.MP_HOLD, L.PG_S + L.MP_HOLD + js.length)], [...js]);
      stats.mirror++;
    }
    const g = v.party();
    for (; seen < v.fxCount(); seen++) { const x = v.fx(seen); if (x.kind === L.MP_FX_CLAIM) stats.claims.push([x.shot, x.size]); }
    if (stats.start < 0 && g.state === L.H_PLAY) stats.start = t;
    if (stats.over < 0 && stats.start >= 0 && g.state === L.H_OVER) {
      stats.over = t;
      stats.winner = g.winner;
      stats.places = bots.map((b) => v.partier(b.r.slot).place);
      stats.pts = bots.map((b) => v.partier(b.r.slot).pts);
    }
  }
  return { log: encodeLog({ courseSeed: seed, ticks, recs }), sim, stats };
}

for (const [balls, ticks] of [[8, 8000], [64, 16000]]) {
  test(`a round of ${balls} AI balls on the debug build: no trap, every claim taking about half, a winner; equal on 1 and 4 threads`, async () => {
    const seed = (0xa7000000 | (L.MG_PADS << 16) | balls) >>> 0;
    const { log, sim, stats } = await aiRound({ bytes: partyBytes(true), seed, balls, ticks });
    assert.equal(sim.error().code, 0);
    assert.ok(stats.over > 0, 'the round ended');
    const secs = (stats.over - stats.start) * TICK;
    assert.ok(secs > (balls > 8 ? 40 : 20) && secs < L.MP_LEN * TICK, `${secs.toFixed(1)} s of play`);
    assert.ok(stats.claims.length >= 4, `${stats.claims.length} claims`);
    assert.ok(stats.mirror === stats.claims.length, 'every claim as the JS has it');
    const pads0 = padsFor(balls);
    assert.ok(stats.claims[0][0] >= pads0 * 0.75, `the first claim: ${stats.claims[0][0]} of ${pads0} pads held`);
    assert.ok(stats.places.every((x) => x >= 1 && x <= balls), `places ${stats.places}`);
    assert.ok(stats.pts.every((x) => x >= 1 && x <= 10), `points ${stats.pts}`);
    assert.ok(stats.winner !== 255 && stats.places.filter((x) => x === 1).length === 1, 'one winner');
    const v = new View(sim.memory.buffer);
    assert.equal(v.party().game, L.MG_PADS);
    assert.ok(v.hole().hole >= 1, 'on to the next round');
    const parsed = parseLog(log);
    const n = stats.over + 50;
    const a = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 1, tag: 't1' });
    const b = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 4, tag: 't4', startWorkers });
    const d = await replay({ bytes: partyBytes(true), log: parsed, ticks: n, threads: 1, tag: 'd1' });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(d.trace).tickHashes], 'the debug build steps the same bits');
  });
}

test('the client module: draws every phase, frames the floor, writes its HUD lines, hushes the music, its brain keeps on the floor', async () => {
  const { Scene } = await import('../client/party-render.mjs');
  const g = await room(12, { seed: 41 });
  const out = { scene: new Scene(24000), solid: [], glow: [], beams: [], decals: [], paint: null };
  const lines = [];
  const hctx = { put: (x, y, s, c) => lines.push([y, s, c]), centre: (y, s, c) => lines.push([y, s, c]), right: (y, s, c) => lines.push([y, s, c]), rows: 44, C: {}, slot: 0, now: 0 };
  const s = stage(g.v);
  const shots = [[s.stop - 100, PHASE.MUSIC, 'MUSIC'], [s.stop + 60, PHASE.SCRAMBLE, 'GET ON A PAD'], [s.claim + 20, PHASE.PAUSE, 'OUT'], [s.next + 200, PHASE.MUSIC, 'MUSIC']];
  for (const [t, ph, word] of shots) {
    stepTo(g, Math.min(t, s.claim));
    if (playT(g) === s.claim) { const list = ends(g); for (let p = 0; p < 4; p++) put(g, p, ...list[p]); }
    stepTo(g, t);
    if (t === s.claim + 20) assert.ok(stage(g.v).rimB < stage(g.v).rimA, 'the floor about to close in');
    out.scene.clear(); out.decals.length = 0; out.beams.length = 0; out.glow.length = 0; out.solid.length = 0; lines.length = 0;
    const tick = g.v.tick;
    pads.draw(g.v, { tick, dt: 0, t: playT(g) * TICK, ptick: tick, now: t * 8, ms: 16, slot: 0, me: g.v.partier(0), pme: null }, out);
    assert.equal(phaseOf(stage(g.v), playT(g)), ph);
    assert.ok(out.scene.count > 5, `${out.scene.count} solids`);
    for (let k = 0; k < out.scene.count * 16; k++) assert.ok(Number.isFinite(out.scene.data[k]), 'finite');
    for (const d of out.decals) assert.ok(d.pos.every(Number.isFinite) && Number.isFinite(d.radius));
    if (ph === PHASE.SCRAMBLE) assert.ok(out.beams.length >= 1 && out.decals.length >= stage(g.v).npad, 'the pads lit, under spotlights');
    pads.hud(g.v, { ...hctx, now: t * 8, me: g.v.partier(0) });
    const text = lines.map((l) => l[1]).join(' | ');
    assert.ok(text.includes(word), text);
    for (const l of lines) assert.ok(l[1].length <= 80, l[1]);
    assert.equal(pads.music(g.v, g.v.tick), ph === PHASE.MUSIC);
    const fr = pads.frame(g.v);
    assert.equal(fr.shape, 'disc');
    assert.ok(Math.abs(fr.radius - (rimAt(stage(g.v), playT(g)) + 1)) < 1e-3);
  }
  assert.ok(pads.hint.length <= 70);
  const T = g.v.party().start;
  assert.equal(pads.brain.danger(g.v, C + 100, C, T + playT(g)), 1, 'off the floor');
  assert.equal(pads.brain.danger(g.v, C, C, T + playT(g)), 0);
});
