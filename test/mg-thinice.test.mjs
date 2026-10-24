import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty, partyBytes, scriptedParty, predicted } from './helpers.mjs';
import { View, partyWord, hexAt, hexCentre, PLAT_Y } from '../src/party-view.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import * as L from '../src/layout.mjs';

const C = L.B_CX;

// A room of n balls on Thin Ice, on the debug build (a NaN traps), stepped
// into play and through its grace (nothing cracks for TI_GRACE) unless asked not to.
async function room(n = 2, { play = true, seed = 7 } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_THINICE + 1, true);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  while (play && (v.hole().state !== L.H_PLAY || v.party().t < L.TI_GRACE)) step();
  return { sim, v, dv, step };
}
const rec = (p) => L.PLAYERS + p * L.PSIZE;
// Ball p at (x, z) on layer k's top (or y), rolling at vx along x.
function put(g, p, x, z, { y = PLAT_Y, vx = 0, ground = true } = {}) {
  g.dv.setFloat32(rec(p) + L.P_PX, x, true);
  g.dv.setFloat32(rec(p) + L.P_PY, y, true);
  g.dv.setFloat32(rec(p) + L.P_PZ, z, true);
  g.dv.setFloat32(rec(p) + L.P_VX, vx, true);
  g.dv.setFloat32(rec(p) + L.P_VY, 0, true);
  g.dv.setFloat32(rec(p) + L.P_VZ, 0, true);
  g.dv.setUint8(rec(p) + L.P_FL, L.PF_LIVE | (ground ? L.PF_GROUND : 0));
}
// Cell (q, r) of layer k: its index across the layers, and what it holds.
const index = (q, r, k) => k * L.TI_CELLS + (r + L.TI_N) * L.TI_W + q + L.TI_N;
const cell = (g, q, r, k) => g.dv.getUint32(L.PG_BIG + L.TI_TILES + 4 * index(q, r, k), true);
const top = (k) => PLAT_Y - k * L.TI_GAP;
const fxs = (v, kind) => { const out = []; for (let k = 0; k < v.fxCount(); k++) { const f = v.fx(k); if (f.kind === kind) out.push(f); } return out; };

test('the stage for 1, 8, 64 and 256: three layers of one disc of hex tiles, sized for the crowd, every ball on a tile of its own', async () => {
  let last = 0;
  for (const n of [1, 8, 64, 256]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party();
    const rad = Math.min(L.TI_R0 + L.TI_RK * Math.sqrt(n), L.TI_RMAX);
    assert.ok(Math.abs(r.size - rad) < 1e-4, `${r.size} m for ${n}`);
    assert.ok(r.size > last, 'grows with the crowd');
    last = r.size;
    assert.equal(g.dv.getFloat32(L.PG_H + L.TI_RAD, true), r.size);
    assert.deepEqual([r.kind, r.len, r.floor], [L.PK_OUT, L.TI_LEN, top(L.TI_LAYERS - 1)]);
    let tiles = 0;
    for (let rr = -L.TI_N; rr <= L.TI_N; rr++) for (let q = -L.TI_N; q <= L.TI_N; q++) {
      const [x, z] = hexCentre(q, rr, L.TI_S);
      const on = Math.hypot(x - C, z - C) <= r.size + 1e-4;
      for (let k = 0; k < L.TI_LAYERS; k++) assert.equal(cell(g, q, rr, k), on ? 1 : 0, `${n}: tile ${q},${rr} on layer ${k}`);
      tiles += on;
    }
    assert.equal(g.dv.getUint32(L.PG_H + L.TI_COUNT, true), tiles);
    const area = Math.PI * r.size * r.size / (1.5 * Math.sqrt(3) * L.TI_S * L.TI_S);
    assert.ok(Math.abs(tiles / area - 1) < 0.12, `${tiles} tiles in a disc of ${r.size} m, about ${area.toFixed(0)}`);
    const used = new Set();
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p);
      assert.equal(b.pos[1], PLAT_Y, 'on the top layer');
      const [q, rr] = hexAt(b.pos[0], b.pos[2], L.TI_S);
      assert.equal(cell(g, q, rr, 0), 1, `${n}: P${p + 1} on ice`);
      assert.ok(!used.has(`${q},${rr}`), `${n}: P${p + 1} alone on its tile`);
      used.add(`${q},${rr}`);
    }
  }
});

test('nothing cracks in the countdown, nor under a ball in the air: it cracks where it lands', async () => {
  const g = await room(2, { play: false });
  for (let k = 0; k < 200; k++) g.step();
  for (let p = 0; p < 2; p++) {
    const b = g.v.partier(p);
    const [q, r] = hexAt(b.pos[0], b.pos[2], L.TI_S);
    assert.equal(cell(g, q, r, 0), 1, `P${p + 1}'s tile whole`);
  }
  while (g.v.hole().state !== L.H_PLAY || g.v.party().t < L.TI_GRACE) g.step();
  const [x, z] = hexCentre(3, -2, L.TI_S);
  put(g, 0, x, z, { y: PLAT_Y + 2, ground: false });
  let k = 0;
  for (; k < 200 && !g.v.partier(0).ground; k++) {
    assert.equal(cell(g, 3, -2, 0), 1, 'still whole under a ball in the air');
    g.step();
  }
  assert.ok(k > 50, `fell 2 m in ${k} ticks`);
  assert.equal(cell(g, 3, -2, 0), g.v.tick - 1 + L.TI_HOLD, 'cracked on the tick it landed');
});

test('the ice holds for the first second of play: a ball at rest cracks nothing till TI_GRACE, then its tile', async () => {
  const g = await room(2, { play: false });
  while (g.v.hole().state !== L.H_PLAY) g.step();
  const tiles = (p) => { const b = g.v.partier(p); const [q, r] = hexAt(b.pos[0], b.pos[2], L.TI_S); return cell(g, q, r, 0); };
  // the round's tick hook sees the tick before the step's end: TI_GRACE of them pass whole
  while (g.v.party().t < L.TI_GRACE) {
    g.step();
    assert.deepEqual([tiles(0), tiles(1)], [1, 1], `whole ${g.v.party().t} ticks in`);
  }
  g.step();
  assert.ok(tiles(0) > 1 && tiles(1) > 1, 'cracked on the next');
  assert.equal(tiles(0), g.v.tick - 1 + L.TI_HOLD);
});

test('a ball on the ice cracks the tile under its centre; it holds TI_HOLD (0.64 s) more, then drops, and the ball falls to the layer below and stays in', async () => {
  const g = await room(2);
  const [x, z] = hexCentre(2, 1, L.TI_S);
  put(g, 0, x, z);
  const before = g.v.fxCount();
  g.step();
  const t0 = g.v.tick - 1;
  assert.equal(cell(g, 2, 1, 0), t0 + L.TI_HOLD, 'cracked, holding till then');
  assert.equal(cell(g, 2, 1, 1), 1, 'the layer below whole');
  const crack = fxs(g.v, L.TI_FX_CRACK).find((f) => f.shot === index(2, 1, 0));
  assert.ok(g.v.fxCount() > before && crack);
  assert.deepEqual([crack.owner, crack.tick, crack.pos[0], crack.pos[1], crack.pos[2], crack.size], [0, t0, x, PLAT_Y, z, 0]);
  // held up through tick t0 + TI_HOLD - 1, gone on the next
  while (g.v.tick < t0 + L.TI_HOLD) { g.step(); assert.ok(g.v.partier(0).ground, `held at ${g.v.tick - 1 - t0}`); }
  const drop = fxs(g.v, L.TI_FX_DROP).find((f) => f.shot === index(2, 1, 0));
  assert.ok(drop, 'its drop FX, the tick before it goes');
  assert.deepEqual([drop.owner, drop.tick, drop.size], [255, t0 + L.TI_HOLD - 1, 0]);
  g.step();
  assert.ok(!g.v.partier(0).ground, 'gone from under it');
  let k = 0;
  while (!g.v.partier(0).ground && k++ < 400) g.step();
  const b = g.v.partier(0);
  assert.ok(b.ground && !b.out && !b.falling, 'landed, still in');
  assert.equal(b.pos[1], top(1));
  assert.ok(k > 120 && k < 160, `12 m in ${k} ticks`);
  g.step();
  const [q, r] = hexAt(b.pos[0], b.pos[2], L.TI_S);
  assert.ok(cell(g, q, r, 1) > 1, 'and cracks the layer below where it landed');
  assert.equal(g.v.hole().state, L.H_PLAY);
});

test('through all three layers and you\'re out: the other ball is the last one up and wins', async () => {
  const g = await room(2);
  const [x, z] = hexCentre(-3, 0, L.TI_S);
  const [x1, z1] = hexCentre(4, 0, L.TI_S);
  put(g, 0, x, z);
  put(g, 1, x1, z1);
  for (let k = 0; k < L.TI_LAYERS; k++) g.dv.setUint32(L.PG_BIG + L.TI_TILES + 4 * index(-3, 0, k), 0, true);
  let n = 0;
  while (!g.v.partier(0).out && n++ < 600) {
    g.step();
    const b = g.v.partier(0);
    if (!b.out) assert.ok(!b.ground, 'nothing under it');
  }
  assert.ok(g.v.partier(0).out);
  assert.ok(n > 200, `out ${n} ticks later, ${L.TI_GAP * (L.TI_LAYERS - 1) + L.OUT_DEPTH} m down`);
  const r = g.v.party();
  assert.equal(r.state, L.H_OVER);
  assert.equal(r.winner, 1);
  assert.deepEqual([g.v.partier(0).place, g.v.partier(1).place], [2, 1]);
  assert.deepEqual([g.v.partier(0).pts, g.v.partier(1).pts], [1, 10]);
});

test('the prediction matches the confirmed ball bit for bit as it rolls onto ice another ball cracked and drops through', async () => {
  const g = await room(2);
  // P2 rolls along z = C at 10 m/s; P1 follows 8 m (0.8 s) behind, where the ice P2 cracked has gone
  put(g, 1, C - 8, C, { vx: 10 });
  put(g, 0, C - 16, C, { vx: 10 });
  g.step([[L.EV_INPUT, 1, partyWord({ yaw: 0, move: 1 })]]);
  assert.ok(predicted(g, Array.from({ length: 150 }, () => partyWord({ yaw: 0, move: 1 }))) >= 150);
  const a = g.v.partier(0), b = g.v.partier(1);
  assert.ok(a.pos[1] < PLAT_Y - 1 && !a.out, `P1 through, at ${a.pos[1]}`);
  assert.equal(b.pos[1], PLAT_Y, 'P2 rolled on over it');
  // then still on the layer below: its tile cracks, holds and drops under it, predicted all the way
  while (!g.v.partier(0).ground) g.step([[L.EV_INPUT, 0, partyWord({ yaw: 0 })], [L.EV_INPUT, 1, partyWord({ yaw: 8192, move: 1 })]]);
  for (let n = 0; n < 40 && g.v.partier(0).pos[1] > top(1) - 1; n++) assert.ok(predicted(g, Array.from({ length: 10 }, () => partyWord({ yaw: 0 }))) >= 10);
  assert.ok(g.v.partier(0).pos[1] < top(1) - 1, 'through the second layer');
});

test('a long scripted round of 16 balls on the debug build: no trap, tiles crack and drop, every ball placed; equal on 1 and 4 threads', async () => {
  const seed = (0xa7000000 | (L.MG_THINICE << 16) | 21) >>> 0;
  let cracks = 0, drops = 0, seen = 0, over = -1, start = -1, pts = null, places = null;
  const ticks = 4000;
  const { log, sim } = await scriptedParty({ bytes: partyBytes(true), seed, balls: 16, ticks, onTick: (t, s) => {
    const v = new View(s.memory.buffer);
    for (; seen < v.fxCount(); seen++) { const f = v.fx(seen); cracks += f.kind === L.TI_FX_CRACK; drops += f.kind === L.TI_FX_DROP; }
    if (start < 0 && v.hole().state === L.H_PLAY) start = t;
    if (over < 0 && start >= 0 && v.hole().state === L.H_OVER) {
      over = t;
      pts = [...Array(16).keys()].map((p) => v.partier(p).pts);
      places = [...Array(16).keys()].map((p) => v.partier(p).place);
    }
  } });
  assert.equal(sim.error().code, 0);
  assert.ok(over > 0, 'the round ended');
  assert.ok(over - start > 500, `${over - start} ticks of play`);
  assert.ok(cracks > 100 && drops > 100, `${cracks} cracks, ${drops} drops`);
  const v = new View(sim.memory.buffer);
  assert.equal(v.party().game, L.MG_THINICE);
  assert.ok(v.hole().hole >= 1, 'on to the next round');
  assert.ok(places.every((x) => x >= 1 && x <= 16), `places ${places}`);
  assert.ok(pts.every((x) => x >= 1 && x <= 10), `points ${pts}`);
  assert.ok(places.includes(1) && pts.includes(10), 'somebody won');
  const parsed = parseLog(log);
  const a = await replay({ bytes: partyBytes(), log: parsed, ticks, threads: 1, tag: 't1' });
  const b = await replay({ bytes: partyBytes(), log: parsed, ticks, threads: 4, tag: 't4', startWorkers });
  const d = await replay({ bytes: partyBytes(true), log: parsed, ticks, threads: 1, tag: 'd1' });
  assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
  assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(d.trace).tickHashes], 'the debug build steps the same bits');
});
