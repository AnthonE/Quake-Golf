// MAZE RUN (src/mg/maze.wat): the maze laid out for the crowd, its hedges
// and doors as pushes on either bank, the doors' table and the paths the
// confirmed world works as they move, coming home and the places, the
// prediction through all of it, and rounds of AI balls finding the middle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty, partyBytes, predicted } from './helpers.mjs';
import { View, partyWord, PLAT_Y, B_RAD } from '../src/party-view.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { playParty } from '../tools/genparty.mjs';
import * as L from '../src/layout.mjs';
import * as MC from '../src/mg/maze.mjs'; // MZ_*: the minigame's own constants
import maze, { maze as mazeOf, kindV, kindH, shut, maskOf, maskAt, epochAt, bfs, paths, pathLen, standings, cellOf, centreOf, edge, doorUp, doorWarn } from '../client/mg/maze.mjs';

const C = L.B_CX;
const TICK = 0.008;
const CELL = MC.MZ_C, HT = MC.MZ_HT;
const f = Math.fround;

// A room of n balls in MAZE RUN, on the debug build (a NaN traps), stepped into play unless asked not to.
async function room(n = 2, { play = true, seed = 7 } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_MAZE + 1, true);
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
// The next step plays tick t into play (the clock moved; the round's end with it).
function at(g, t) {
  const now = g.v.tick;
  g.dv.setUint32(L.HDR_START, now - t, true);
  g.dv.setUint32(L.HDR_UNTIL, now - t + g.v.party().len, true);
}
const playT = (g) => g.v.party().t;
const fxs = (v, kind) => { const out = []; for (let k = 0; k < v.fxCount(); k++) { const x = v.fx(k); if (x.kind === kind) out.push(x); } return out; };
// The maze's side for n balls, as setup works it.
const side = (n) => Math.min(MC.MZ_NMAX, Math.max(MC.MZ_NMIN, 2 * Math.trunc(f(f(f(f(Math.sqrt(n)) * f(MC.MZ_NK)) + f(MC.MZ_N0)) * 0.5)) + 1));
// Every shut hedge box (the twelve the sim's push looks at) round (x, z), with the doors in mask open.
function boxes(M, x, z, mask) {
  const [i, j] = cellOf(M, x, z), out = [];
  for (let a = 0; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    if (shut(kindV(M, i + a, j + b), mask)) out.push([(i + a) * CELL - HT, (i + a) * CELL + HT, (j + b) * CELL - HT, (j + b + 1) * CELL + HT]);
  }
  for (let b = 0; b <= 1; b++) for (let a = -1; a <= 1; a++) {
    if (shut(kindH(M, i + a, j + b), mask)) out.push([(i + a) * CELL - HT, (i + a + 1) * CELL + HT, (j + b) * CELL - HT, (j + b) * CELL + HT]);
  }
  return out.map(([xa, xb, za, zb]) => [xa + M.x0, xb + M.x0, za + M.x0, zb + M.x0]);
}
// How far (x, z) is from the nearest of them (negative inside one).
function clearance(M, x, z, mask) {
  let best = Infinity;
  for (const [xa, xb, za, zb] of boxes(M, x, z, mask)) {
    const dx = x - Math.max(xa, Math.min(xb, x)), dz = z - Math.max(za, Math.min(zb, z));
    const d = Math.hypot(dx, dz);
    best = Math.min(best, d > 0 ? d : -Math.min(x - xa, xb - x, z - za, zb - z));
  }
  return best;
}
// A cell (not on the rim, not the room) and a way k out of it through an edge of the given kind test.
function findEdge(M, ok, from = 0) {
  for (let c = from; c < M.n * M.n; c++) {
    const i = c % M.n, j = (c / M.n) | 0;
    if (i < 1 || j < 1 || i > M.n - 2 || j > M.n - 2) continue;
    for (let k = 0; k < 4; k++) { const [kind, nb] = edge(M, c, k); if (nb >= 0 && ok(kind, c, k)) return { c, k, kind, nb }; }
  }
  return null;
}
const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
const yawTo = (dx, dz) => Math.round(Math.atan2(dz, dx) / (2 * Math.PI) * 16384) & 16383;
// Ball p's keys held toward (dx, dz) (or let go), as an input record for a step.
const keys = (p, dx, dz) => [L.EV_INPUT, p, partyWord(dx || dz ? { yaw: yawTo(dx, dz), move: 1 } : { yaw: 0 })];
// The countdown over on the next step.
const hurry = (g) => g.dv.setUint32(L.HDR_UNTIL, g.v.tick, true);

test('the maze for 1, 8, 64 and 256: sized for the crowd, every cell on a path to the middle with every door shut, the room round the pad, the rim a hedge; every ball on a start cell, as far from the middle as the rest, apart, clear of the hedges', async () => {
  let last = 0;
  for (const n of [1, 8, 64, 256]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party();
    const M = mazeOf(g.v);
    const N = side(n);
    assert.equal(r.game, L.MG_MAZE);
    assert.equal(M.n, N, `${N} a side for ${n}`);
    assert.ok(N >= last, 'grows with the crowd');
    last = N;
    assert.deepEqual([r.kind, r.len, r.size, r.floor, r.idle, r.hop, r.respawn, r.flags],
      [L.PK_SCORE, MC.MZ_LEN0 + MC.MZ_LENK * N, N * CELL / 2, PLAT_Y, f(MC.MZ_IDLE), 6, 0x7fffffff, L.PGF_BUMPS | L.PGF_NOKICK]);
    assert.equal(M.x0, C - N * CELL / 2);
    assert.equal(M.cx, C, 'the pad\'s cell is the middle one');
    // every cell reached with all doors shut (the dug maze alone), and more besides with them open
    const shutAll = bfs(M, 0), openAll = bfs(M, 0xff);
    assert.equal(shutAll.order.length, N * N, 'every cell on a path to the middle');
    for (let c = 0; c < N * N; c++) assert.ok(openAll.dist[c] <= shutAll.dist[c]);
    // the room: three by three round the pad, open inside
    const m = N >> 1;
    for (let j = m - 1; j <= m + 1; j++) for (let i = m - 1; i <= m + 1; i++) {
      if (i < m + 1) assert.equal(M.E[j * N + i], MC.MZ_OPEN, `room ${i},${j} east`);
      if (j < m + 1) assert.equal(M.S[j * N + i], MC.MZ_OPEN, `room ${i},${j} south`);
    }
    for (let k = 0; k < N; k++) {
      for (const kind of [kindV(M, 0, k), kindV(M, N, k), kindH(M, k, 0), kindH(M, k, N)]) assert.equal(kind, MC.MZ_WALL, 'the rim');
    }
    // every edge kind in range; doors in every maze but the smallest crowds' too
    let doors = 0, walls = 0;
    for (let c = 0; c < N * N; c++) for (const k of [M.E[c], M.S[c]]) { assert.ok(k <= MC.MZ_DOOR + MC.MZ_NG - 1); if (k >= MC.MZ_DOOR) doors++; if (k === MC.MZ_WALL) walls++; }
    assert.ok(doors >= 4 && walls > N * N / 3, `${doors} doors, ${walls} hedges in ${N} x ${N}`);
    assert.equal(M.doors.length, doors - [...Array(N)].reduce((s, _, k) => s + (M.E[k * N + N - 1] >= MC.MZ_DOOR) + (M.S[(N - 1) * N + k] >= MC.MZ_DOOR), 0));
    // the doors' table: a different set every epoch
    for (let e = 0; e < MC.MZ_NE; e++) {
      assert.ok(maskOf(M, e) <= 0xff);
      if (e) assert.notEqual(maskOf(M, e), maskOf(M, e - 1), `epoch ${e}`);
    }
    // the balls: on the start cells, every one the same way from the middle by the first epoch's doors
    // (a window of MZ_SW distances, 1 when there are cells enough at one), one to a cell while there
    // are cells enough, up to four once there are more
    const sd = g.dv.getUint32(L.PG_H + MC.MZ_SD, true), sw = g.dv.getUint32(L.PG_H + MC.MZ_SW, true), nst = g.dv.getUint32(L.PG_H + MC.MZ_NST, true);
    const P0 = bfs(M, maskOf(M, 0));
    assert.ok(sw >= 1 && sw <= 2, `${n}: starts ${sd} to ${sd + sw - 1} cells out`);
    assert.ok(nst >= Math.max(Math.ceil(n / 4), Math.min(n, MC.MZ_SPREAD)), `${n}: ${nst} start cells`);
    let cells = 0;
    for (let c = 0; c < N * N; c++) if (P0.dist[c] >= sd && P0.dist[c] < sd + sw) { assert.equal(g.dv.getUint16(L.PG_BIG + MC.MZ_STARTS + 2 * cells, true), c); cells++; }
    assert.equal(cells, nst, 'the start cells are every cell in the window, in scan order');
    // as far out as there are cells enough: no window as wide further out has as many
    const need = Math.max(Math.ceil(n / 4), Math.min(n, MC.MZ_SPREAD), 1);
    for (let d0 = sd + 1; d0 < N * N; d0++) assert.ok([...P0.dist].filter((d) => d >= d0 && d < d0 + sw).length < need, `${n}: none ${d0} out`);
    const spots = [];
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p);
      assert.equal(b.pos[1], PLAT_Y);
      const [i, j] = cellOf(M, b.pos[0], b.pos[2]);
      const d = P0.dist[j * N + i];
      assert.ok(d >= sd && d < sd + sw, `${n}: P${p + 1} ${d} cells out`);
      assert.ok(clearance(M, b.pos[0], b.pos[2], maskOf(M, 0)) >= B_RAD, `${n}: P${p + 1} clear of the hedges`);
      spots.push([b.pos[0], b.pos[2], j * N + i]);
    }
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      assert.ok(Math.hypot(spots[a][0] - spots[b][0], spots[a][1] - spots[b][1]) > 2 * B_RAD, `${n}: P${a + 1} and P${b + 1} apart`);
    }
    const per = new Map();
    for (const s of spots) per.set(s[2], (per.get(s[2]) || 0) + 1);
    assert.ok(Math.max(...per.values()) <= (n <= nst ? 1 : Math.min(4, Math.ceil(n / nst))), `${n} balls on ${nst} start cells`);
    // play: the paths the sim works are the client's
    hurry(g);
    g.step();
    g.step();
    const P = paths(M, 0).now;
    for (let c = 0; c < N * N; c++) assert.equal(g.dv.getUint16(L.PG_BIG + MC.MZ_DIST + 2 * c, true), P.dist[c]);
  }
});

test('mazes from many seeds and crowds: every one whole, its loops and halls and doors in proportion', async () => {
  let doors = 0, cells = 0, longest = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    for (const n of [3, 16, 100]) {
      const h = await room(n, { play: false, seed: seed * 101 + n });
      const M = mazeOf(h.v);
      const all = bfs(M, 0);
      assert.equal(all.order.length, M.n * M.n, `seed ${seed}, ${n}: whole`);
      const P = paths(M, 0);
      for (let c = 0; c < M.n * M.n; c++) assert.ok(P.safe.dist[c] !== 0xffff && P.now.dist[c] <= P.safe.dist[c]);
      for (let c = 0; c < M.n * M.n; c++) { doors += (M.E[c] >= MC.MZ_DOOR) + (M.S[c] >= MC.MZ_DOOR); }
      cells += M.n * M.n;
      longest = Math.max(longest, ...all.dist);
    }
  }
  assert.ok(doors / cells > 0.03 && doors / cells < 0.2, `${doors} doors in ${cells} cells`);
  assert.ok(longest > 15, `the longest way ${longest} cells`);
});

test('a hedge stops a ball: thrown at one it bounces back off and never gets into it, along one it stays clear, stuck in one it goes out the nearer side; open edges let it by; over the hedges nothing; the floor is the maze', async () => {
  const g = await room(2, { seed: 11 });
  const M = mazeOf(g.v);
  const mask = maskOf(M, 0);
  // a cell with a hedge east of it
  const h = findEdge(M, (kind, c, k) => k === 0 && kind === MC.MZ_WALL);
  const [x, z] = centreOf(M, h.c);
  put(g, 0, x, z, { vx: 12, vz: 0 });
  put(g, 1, C + 2, C, {});
  let minClear = Infinity, back = 0;
  for (let k = 0; k < 120; k++) {
    g.step();
    const b = g.v.partier(0);
    minClear = Math.min(minClear, clearance(M, b.pos[0], b.pos[2], mask));
    back = Math.min(back, b.vel[0]);
  }
  assert.ok(minClear > B_RAD - 0.02, `never into it: ${minClear.toFixed(3)} m clear`);
  assert.ok(back < -3, `bounced back at ${back.toFixed(2)} m/s`);
  assert.ok(fxs(g.v, MC.MZ_FX_BONK).some((x) => x.owner === 0 && x.size > 5), 'a knock');
  // along a hedge at an angle: it slides along, its speed along kept
  put(g, 0, x, z, { vx: 6, vz: 2 });
  for (let k = 0; k < 50; k++) g.step();
  assert.ok(clearance(M, g.v.partier(0).pos[0], g.v.partier(0).pos[2], mask) > B_RAD - 0.02);
  // an open edge: straight through to the next cell
  const o = findEdge(M, (kind, c, k) => kind === MC.MZ_OPEN && edge(M, c, k)[1] >= 0);
  const [ox, oz] = centreOf(M, o.c), [nx, nz] = centreOf(M, o.nb);
  put(g, 0, ox, oz, { vx: DX[o.k] * 6, vz: DZ[o.k] * 6 });
  g.step([keys(0, DX[o.k], DZ[o.k])]);
  for (let k = 0; k < 125 && Math.hypot(g.v.partier(0).pos[0] - nx, g.v.partier(0).pos[2] - nz) > 1; k++) g.step();
  assert.ok(Math.hypot(g.v.partier(0).pos[0] - nx, g.v.partier(0).pos[2] - nz) <= 1, 'through the open edge');
  g.step([keys(0, 0, 0)]);
  // over the hedges' top: no push
  put(g, 0, x + CELL / 2 - 0.2, z, { y: PLAT_Y + MC.MZ_HIGH + 0.5, vx: 0, ground: false });
  g.step();
  assert.equal(g.v.partier(0).pos[0], f(x + CELL / 2 - 0.2), 'over the hedge');
  // stuck in one (a bump put it there): out the nearest side
  put(g, 0, M.x0 + (h.c % M.n + 1) * CELL + 0.1, z);
  g.step();
  assert.ok(clearance(M, g.v.partier(0).pos[0], g.v.partier(0).pos[2], mask) > B_RAD - 0.02, 'out of it');
  assert.ok(g.v.partier(0).pos[0] > M.x0 + (h.c % M.n + 1) * CELL, 'the nearer side');
  // the floor: the whole maze and its rim, nothing past it
  const gr = (xx, zz) => {
    put(g, 0, xx, zz, { y: PLAT_Y + 0.05, ground: false });
    for (let k = 0; k < 20; k++) g.step();
    return g.v.partier(0).ground && g.v.partier(0).pos[1] === PLAT_Y;
  };
  assert.ok(gr(M.x0 + 2.5, M.x0 + 2.5));
  put(g, 0, M.x0 - 5, C, { y: PLAT_Y + 0.05, ground: false });
  for (let k = 0; k < 60; k++) g.step();
  assert.ok(g.v.partier(0).pos[1] < PLAT_Y - 1, 'off the maze, down it goes');
});

test('a ball thrown about every cell of a maze at every speed stays in its paths', async () => {
  const g = await room(1, { seed: 23 });
  const M = mazeOf(g.v);
  let worst = Infinity;
  for (let c = 0; c < M.n * M.n; c += 7) {
    const [x, z] = centreOf(M, c);
    const a = c * 2.399;
    put(g, 0, x, z, { vx: Math.cos(a) * 14, vz: Math.sin(a) * 14 });
    for (let k = 0; k < 60; k++) {
      g.step();
      const b = g.v.partier(0);
      worst = Math.min(worst, clearance(M, b.pos[0], b.pos[2], maskOf(M, epochAt(playT(g) - 1))));
    }
  }
  assert.ok(worst > B_RAD - 0.03, `${worst.toFixed(3)} m clear at worst`);
});

test('bumps on, without bumper\'s kick: two balls that meet trade what they bring, and one at rest is shoved on', async () => {
  const g = await room(2, { seed: 19 });
  const M = mazeOf(g.v);
  // two cells in a row with no hedge between them, well inside
  const o = findEdge(M, (kind, c, k) => k === 0 && kind === MC.MZ_OPEN);
  const [x, z] = centreOf(M, o.c);
  put(g, 0, x + 0.4, z, { vx: 0.5 });
  put(g, 1, x + 2.5, z, { vx: -0.5 });
  for (let k = 0; k < 20; k++) g.step();
  const a = g.v.partier(0), b = g.v.partier(1);
  assert.ok(Math.abs(a.vel[0]) < 1.5 && Math.abs(b.vel[0]) < 1.5, `no kick: ${a.vel[0].toFixed(2)}, ${b.vel[0].toFixed(2)} m/s`);
  assert.ok(b.pos[0] - a.pos[0] >= 2 * B_RAD - 0.05, 'apart');
  put(g, 0, x - 1.5, z, { vx: 8 });
  put(g, 1, x + 1.2, z);
  for (let k = 0; k < 15; k++) g.step();
  assert.ok(g.v.partier(1).vel[0] > 3, `a ram shoves it on: ${g.v.partier(1).vel[0].toFixed(2)} m/s`);
});

test('the doors: shut or open by the table and the tick; the paths worked again as they move; FX ahead and as they do', async () => {
  const g = await room(2, { seed: 5 });
  const M = mazeOf(g.v);
  // a door whose group is shut in some epoch and open in the next
  let D = null, e0 = -1;
  for (let e = 1; e < MC.MZ_NE - 1 && !D; e++) {
    const d = findEdge(M, (kind) => kind >= MC.MZ_DOOR && !(maskOf(M, e) >> (kind - MC.MZ_DOOR) & 1) && (maskOf(M, e + 1) >> (kind - MC.MZ_DOOR) & 1));
    if (d) { D = d; e0 = e; }
  }
  assert.ok(D, 'a door that opens');
  const [x, z] = centreOf(M, D.c), [nx, nz] = centreOf(M, D.nb);
  const roll = (t) => {
    at(g, t);
    put(g, 0, x, z, { vx: DX[D.k] * 7, vz: DZ[D.k] * 7 });
    put(g, 1, M.x0 + 2.5, M.x0 + 2.5);
    g.step([keys(0, DX[D.k], DZ[D.k])]);
    for (let k = 0; k < 100 && Math.hypot(g.v.partier(0).pos[0] - nx, g.v.partier(0).pos[2] - nz) >= 1; k++) g.step();
    const through = Math.hypot(g.v.partier(0).pos[0] - nx, g.v.partier(0).pos[2] - nz) < 1;
    g.step([keys(0, 0, 0)]);
    return through;
  };
  assert.equal(roll(e0 * MC.MZ_PERIOD + 10), false, 'shut: it stops the ball');
  assert.equal(roll((e0 + 1) * MC.MZ_PERIOD + 10), true, 'open: through it');
  // the warning MZ_WARN ahead, the move on the epoch's tick, the paths after it as the sim works them
  at(g, (e0 + 1) * MC.MZ_PERIOD - MC.MZ_WARN - 3);
  const n0 = g.v.fxCount();
  while (playT(g) < (e0 + 1) * MC.MZ_PERIOD + 2) g.step();
  const got = [];
  for (let k = n0; k < g.v.fxCount(); k++) { const x = g.v.fx(k); if (x.kind === MC.MZ_FX_WARN || x.kind === MC.MZ_FX_DOORS) got.push(x); }
  assert.equal(got.length, 2);
  const [w, mv] = got;
  assert.equal(mv.tick - w.tick, MC.MZ_WARN);
  assert.equal(w.size, e0 + 1);
  assert.equal(mv.size, e0 + 1);
  let moving = 0, open = 0;
  for (const X of M.doors) { if ((maskOf(M, e0) ^ maskOf(M, e0 + 1)) >> X.g & 1) moving++; if (maskOf(M, e0 + 1) >> X.g & 1) open++; }
  const inner = (pick) => { let k = 0; for (let c = 0; c < M.n * M.n; c++) for (const kind of [M.E[c], M.S[c]]) if (kind >= MC.MZ_DOOR && pick(kind - MC.MZ_DOOR)) k++; return k; };
  assert.equal(w.shot, inner((q) => (maskOf(M, e0) ^ maskOf(M, e0 + 1)) >> q & 1));
  assert.equal(mv.shot, inner((q) => maskOf(M, e0 + 1) >> q & 1));
  assert.ok(moving > 0 && open >= 0);
  const P = paths(M, e0 + 1).now;
  for (let c = 0; c < M.n * M.n; c++) assert.equal(g.dv.getUint16(L.PG_BIG + MC.MZ_DIST + 2 * c, true), P.dist[c]);
  // as drawn: sunk or shut by the epoch, one opening sinking from the move, its top flashing for MZ_WARN before
  const X = M.doors.find((Q) => Q.g === D.kind - MC.MZ_DOOR);
  assert.equal(doorUp(M, X, e0 * MC.MZ_PERIOD + 500), 1);
  assert.equal(doorUp(M, X, (e0 + 1) * MC.MZ_PERIOD + 500), 0);
  assert.ok(doorUp(M, X, (e0 + 1) * MC.MZ_PERIOD + 10) > 0 && doorUp(M, X, (e0 + 1) * MC.MZ_PERIOD + 10) < 1);
  assert.ok(doorWarn(M, X, (e0 + 1) * MC.MZ_PERIOD - 100) && !doorWarn(M, X, (e0 + 1) * MC.MZ_PERIOD - 400));
  // one shutting is drawn up by the tick it turns solid, rising through the end of its warning
  let Y = null, e1 = 0;
  for (let e = 0; e < MC.MZ_NE && !Y; e++) { Y = M.doors.find((Q) => (maskOf(M, e) >> Q.g & 1) && !(maskOf(M, e + 1) >> Q.g & 1)); e1 = e + 1; }
  assert.ok(Y, 'a door that shuts');
  assert.equal(doorUp(M, Y, e1 * MC.MZ_PERIOD), 1);
  assert.equal(doorUp(M, Y, e1 * MC.MZ_PERIOD - 100), 0);
  assert.ok(doorUp(M, Y, e1 * MC.MZ_PERIOD - 20) > 0 && doorUp(M, Y, e1 * MC.MZ_PERIOD - 20) < 1);
});

test('a door shutting on a ball in its gap shoves it out to the nearer side', async () => {
  const g = await room(2, { seed: 5 });
  const M = mazeOf(g.v);
  let D = null, e0 = -1;
  for (let e = 1; e < MC.MZ_NE - 1 && !D; e++) {
    const d = findEdge(M, (kind, c, k) => k === 0 && kind >= MC.MZ_DOOR && (maskOf(M, e) >> (kind - MC.MZ_DOOR) & 1) && !(maskOf(M, e + 1) >> (kind - MC.MZ_DOOR) & 1));
    if (d) { D = d; e0 = e; }
  }
  assert.ok(D, 'a door that shuts');
  const lx = M.x0 + (D.c % M.n + 1) * CELL, [, z] = centreOf(M, D.c);
  at(g, (e0 + 1) * MC.MZ_PERIOD - 1);
  put(g, 0, lx + 0.2, z);
  put(g, 1, M.x0 + 2.5, M.x0 + 2.5);
  g.step();
  assert.equal(g.v.partier(0).pos[0], f(lx + 0.2), 'open on the epoch\'s last tick');
  g.step();
  assert.ok(g.v.partier(0).pos[0] >= lx + HT + B_RAD - 0.001, `shoved east, to ${(g.v.partier(0).pos[0] - lx).toFixed(3)} m past the line`);
});

test('home: the first onto the pad wins and cuts the clock to MZ_LATE; balls home on one tick share a place; the rest at the end by their way to the middle; points 10 down to 1', async () => {
  const g = await room(6, { seed: 9 });
  const M = mazeOf(g.v);
  // the rest spread about the maze, still
  const far = [0, 7, 13, 31];
  far.forEach((c, k) => { const [x, z] = centreOf(M, c * 3 + k); put(g, 2 + k, x, z); });
  put(g, 0, C + 3.5, C);
  put(g, 1, C + 0.5, C + 0.5);
  const until0 = g.v.hole().until;
  g.step();
  const t1 = g.v.tick - 1;
  let b = g.v.partier(1);
  assert.ok(b.out, 'home: out of play');
  assert.deepEqual([b.score, b.m], [MC.MZ_SFIN, MC.MZ_M_FIN | 1]);
  assert.equal(g.v.hole().until, Math.min(until0, t1 + MC.MZ_LATE), 'the clock cut');
  const home = fxs(g.v, MC.MZ_FX_HOME);
  assert.deepEqual(home.map((x) => [x.owner, x.shot]), [[1, 1]]);
  // two onto it on one tick: both 2nd
  put(g, 0, C - 1, C);
  put(g, 3, C, C + 1);
  g.step();
  assert.deepEqual([g.v.partier(0).m, g.v.partier(3).m], [MC.MZ_M_FIN | 2, MC.MZ_M_FIN | 2]);
  assert.deepEqual([g.v.partier(0).score, g.v.partier(3).score], [MC.MZ_SFIN - 1, MC.MZ_SFIN - 1]);
  assert.equal(g.v.hole().until, Math.min(until0, t1 + MC.MZ_LATE), 'cut once');
  // a home ball stays out: it doesn't move, and isn't home again
  g.step();
  assert.equal(fxs(g.v, MC.MZ_FX_HOME).length, 3);
  // the end by the clock: the rest scored by their way to the middle, and placed by it
  const S = paths(M, epochAt(playT(g))).now;
  const want = [2, 4, 5].map((p) => { const q = g.v.partier(p); return [p, pathLen(M, S, q.pos[0], q.pos[2])]; });
  g.dv.setUint32(L.HDR_UNTIL, g.v.tick, true);
  g.step();
  assert.equal(g.v.hole().state, L.H_OVER);
  for (const [p, len] of want) assert.equal(g.v.partier(p).score, MC.MZ_SFAR - Math.trunc(f(f(len) * 2)), `P${p + 1}: ${len.toFixed(2)} m`);
  const place = (p) => g.v.partier(p).place;
  assert.deepEqual([place(1), place(0), place(3)], [1, 2, 2], 'home by the order they got there');
  assert.deepEqual(want.slice().sort((a, b) => a[1] - b[1]).map(([p]) => place(p)), [4, 5, 6], 'the rest by their way to the middle');
  assert.equal(g.v.party().winner, 1);
  assert.equal(g.v.partier(1).pts, 10);
  assert.ok([...Array(6).keys()].every((p) => g.v.partier(p).pts >= 1 && g.v.partier(p).pts <= 10));
});

test('everyone home ends it at once; a ball alone plays till it finds the middle', async () => {
  const g = await room(3, { seed: 4 });
  for (let p = 0; p < 3; p++) put(g, p, C + (p - 1) * 1.4, C);
  g.step();
  assert.equal(g.v.hole().state, L.H_OVER);
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).place), [1, 1, 1]);
  const h = await room(1, { seed: 4 });
  for (let k = 0; k < 500; k++) h.step();
  assert.equal(h.v.hole().state, L.H_PLAY, 'alone, still looking');
  put(h, 0, C, C);
  h.step();
  assert.equal(h.v.hole().state, L.H_OVER);
  assert.equal(h.v.partier(0).place, 1);
  assert.equal(h.v.party().winner, 0);
});

test('a fair start: for 2, 16 and 256 balls on four seeds each, every ball within a cell of the rest along the paths to the middle as play starts', async () => {
  for (const n of [2, 16, 256]) {
    for (let seed = 1; seed <= 4; seed++) {
      const g = await room(n, { play: false, seed: 100 * n + seed });
      const M = mazeOf(g.v), P0 = bfs(M, maskOf(M, 0));
      const ds = [];
      for (let p = 0; p < n; p++) { const b = g.v.partier(p); const [i, j] = cellOf(M, b.pos[0], b.pos[2]); ds.push(P0.dist[j * M.n + i]); }
      const lo = Math.min(...ds), hi = Math.max(...ds);
      assert.ok(hi - lo <= 1, `${n} balls, seed ${seed}: ${lo} to ${hi} cells`);
      assert.ok(lo >= M.n >> 1, `${n} balls, seed ${seed}: ${lo} cells out, at least half the side`);
    }
  }
});

test('a ball joining in play falls in at a start cell and races', async () => {
  const g = await room(2, { seed: 3 });
  const M = mazeOf(g.v);
  g.step([[L.EV_JOIN, 5]]);
  const b = g.v.partier(5);
  assert.ok(b.live && !b.out, 'in');
  const [i, j] = cellOf(M, b.pos[0], b.pos[2]);
  const sd = g.dv.getUint32(L.PG_H + MC.MZ_SD, true), sw = g.dv.getUint32(L.PG_H + MC.MZ_SW, true);
  const d = bfs(M, maskOf(M, 0)).dist[j * M.n + i];
  assert.ok(d >= sd && d < sd + sw, `${d} cells out, the others ${sd}`);
  for (let k = 0; k < 200; k++) g.step();
  assert.ok(g.v.partier(5).ground && g.v.partier(5).pos[1] === PLAT_Y, 'landed on the floor');
});

test('the prediction matches the confirmed ball bit for bit: into hedges, along them, round corners, through a door as it opens and against one as it shuts', async () => {
  const g = await room(2, { seed: 5 });
  const M = mazeOf(g.v);
  let D = null, e0 = -1;
  for (let e = 1; e < MC.MZ_NE - 1 && !D; e++) {
    const d = findEdge(M, (kind) => kind >= MC.MZ_DOOR && (maskOf(M, e) >> (kind - MC.MZ_DOOR) & 1) !== (maskOf(M, e + 1) >> (kind - MC.MZ_DOOR) & 1));
    if (d) { D = d; e0 = e; }
  }
  const [x, z] = centreOf(M, D.c);
  at(g, (e0 + 1) * MC.MZ_PERIOD - 300);
  put(g, 0, x, z);
  put(g, 1, M.x0 + 2.5, M.x0 + 2.5);
  const toward = yawTo(DX[D.k], DZ[D.k]);
  const words = Array.from({ length: 700 }, (_, k) => partyWord({ yaw: (toward + ((k * 211) % 5000) - 2500 + (k > 350 ? 8192 : 0)) & 16383, move: k % 50 < 38 ? 1 : 0, hop: k % 120 === 7 ? 1 : 0 }));
  assert.ok(predicted(g, words) >= 700);
  // flat out about a stretch of the maze (no door near the end of an epoch)
  at(g, 400);
  put(g, 0, ...centreOf(M, (M.n >> 1) * M.n + 2));
  const more = Array.from({ length: 600 }, (_, k) => partyWord({ yaw: (k * 389 + (k >> 6) * 3001) & 16383, move: 1 }));
  assert.ok(predicted(g, more) >= 600);
  assert.ok(fxs(g.v, MC.MZ_FX_BONK).some((q) => q.owner === 0), 'it knocked into the hedges');
});

// A round of Partier balls (client/party-bot.mjs, steered by this minigame's
// brain) on the debug build, as tools/genparty.mjs plays one: the log, how the
// round went.
async function aiRound(balls, seed) {
  const stats = { start: -1, over: -1, homes: [], first: -1, places: null, pts: null, winner: -1, bonks: 0 };
  let seen = 0;
  const { log } = await playParty({ bytes: partyBytes(true), seed, mg: L.MG_MAZE, bots: balls, ticks: 16000, delay: 6, onTick: (t, s, v) => {
    assert.equal(s.error().code, 0, 'no trap');
    const g = v.party();
    if (stats.start < 0 && g.state === L.H_PLAY) stats.start = t;
    if (stats.over < 0) {
      for (; seen < v.fxCount(); seen++) {
        const x = v.fx(seen);
        if (x.kind === MC.MZ_FX_HOME && stats.start >= 0) stats.homes.push((t - stats.start) * TICK);
        if (x.kind === MC.MZ_FX_BONK) stats.bonks++;
      }
    }
    if (stats.over < 0 && stats.start >= 0 && g.state === L.H_OVER) {
      stats.over = t;
      stats.winner = g.winner;
      stats.places = [...Array(balls).keys()].map((p) => v.partier(p).place);
      stats.pts = [...Array(balls).keys()].map((p) => v.partier(p).pts);
    }
  } });
  return { log, stats };
}

for (const [balls, seed] of [[8, 3], [64, 4]]) {
  test(`a round of ${balls} AI balls on the debug build: no trap, they find the middle, the first a while in, most home before the end, places and points for all; equal on 1 and 4 threads`, async () => {
    const { log, stats } = await aiRound(balls, seed);
    assert.ok(stats.over > 0, 'the round ended');
    const secs = (stats.over - stats.start) * TICK;
    assert.ok(stats.homes.length >= balls * 0.75, `${stats.homes.length} of ${balls} home in ${secs.toFixed(1)} s`);
    assert.ok(stats.homes[0] > 4, `the first home at ${stats.homes[0].toFixed(1)} s`);
    assert.ok(secs <= stats.homes[0] + MC.MZ_LATE * TICK + 0.01, 'over by the cut');
    assert.ok(stats.places.every((x) => x >= 1 && x <= balls), `places ${stats.places}`);
    assert.ok(stats.pts.every((x) => x >= 1 && x <= 10), `points ${stats.pts}`);
    assert.ok(stats.winner >= 0 && stats.winner < balls && stats.places[stats.winner] === 1, 'somebody won');
    const parsed = parseLog(log);
    const n = stats.over + 50;
    const a = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 1, tag: 't1' });
    const b = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 4, tag: 't4', startWorkers });
    const d = await replay({ bytes: partyBytes(true), log: parsed, ticks: n, threads: 1, tag: 'd1' });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(d.trace).tickHashes], 'the debug build steps the same bits');
  });
}

test('the AI ball takes the safe way when a door on its way will shut before it gets there', async () => {
  const g = await room(2, { seed: 5 });
  const M = mazeOf(g.v);
  // a cell whose way now runs through a door shutting at the epoch's end, a cell or two on
  let hit = null;
  for (let e = 0; e < MC.MZ_NE - 1 && !hit; e++) {
    const P = paths(M, e);
    for (let c = 0; c < M.n * M.n && !hit; c++) if (P.ahead[c] === 1 && P.safe.dist[c] !== P.now.dist[c]) hit = { e, c, P };
  }
  assert.ok(hit, 'a way through a door that shuts');
  const { e, c, P } = hit;
  const bot = { slot: 0, skill: 0.8, pos: centreOf(M, c), vel: [0, 0], lag: 0, at: -1 };
  const go = (t) => {
    at(g, t);
    put(g, 0, ...centreOf(M, c));
    g.step();
    bot.at = g.v.tick;
    bot.pos = centreOf(M, c);
    return maze.brain.goal(g.v, 0, bot);
  };
  const towardNow = (goal) => { const [gx, gz] = goal, [i, j] = cellOf(M, gx, gz); return P.now.dist[j * M.n + i] === P.now.dist[c] - 1; };
  const early = go(e * MC.MZ_PERIOD + 10);
  assert.ok(towardNow(early), 'plenty of time: the way now');
  const late = go((e + 1) * MC.MZ_PERIOD - 60);
  const [li, lj] = cellOf(M, late[0], late[1]);
  assert.equal(P.safe.dist[lj * M.n + li], P.safe.dist[c] - 1, 'too late for the door: the safe way');
});

test('the client module: draws every phase, frames the maze, writes its HUD lines; standings as the end will place them', async () => {
  const { Scene } = await import('../client/party-render.mjs');
  const g = await room(4, { seed: 41, play: false });
  const M = mazeOf(g.v);
  const out = { scene: new Scene(24000), solid: [], glow: [], beams: [], decals: [], casters: [], paint: null };
  const lines = [];
  const hctx = { put: (x, y, s, c) => lines.push([y, s, c]), centre: (y, s, c) => lines.push([y, s, c]), right: (y, s, c) => lines.push([y, s, c]), rows: 44, C: {}, slot: 0, now: 0 };
  const draw = () => {
    out.scene.clear(); lines.length = 0; out.beams.length = 0; out.decals.length = 0;
    const r = g.v.party();
    const t = r.state === L.H_PLAY ? r.t : 0;
    maze.draw(g.v, { tick: g.v.tick, ptick: g.v.tick, t: t * TICK, dt: 0, now: 0, slot: 0, me: g.v.partier(0) }, out);
    for (let k = 0; k < out.scene.count * 16; k++) assert.ok(Number.isFinite(out.scene.data[k]), 'finite');
    maze.hud(g.v, { ...hctx, me: g.v.partier(0), t: t * TICK });
    for (const l of lines) assert.ok(l[1].length <= 40, l[1]);
    return lines.map((l) => l[1]).join(' | ');
  };
  draw();
  assert.ok(out.scene.count >= M.runs.length * 2 + M.doors.length + 2, 'the floor, the hedges and the doors in the countdown');
  assert.equal(out.beams.length, 1, 'the pad\'s beam');
  while (g.v.hole().state !== L.H_PLAY) g.step();
  for (let k = 0; k < 10; k++) g.step();
  let text = draw();
  assert.match(text, /\d+(ST|ND|RD|TH) OF 4/);
  assert.match(text, /\d+ M TO THE MIDDLE/);
  assert.match(text, /DOORS MOVE IN 15/);
  at(g, MC.MZ_PERIOD - 100);
  g.step();
  text = draw();
  assert.equal(text.includes('DOORS MOVING'), M.doors.some((D) => ((maskOf(M, 0) ^ maskOf(M, 1)) >> D.g) & 1), text);
  put(g, 1, C, C);
  g.step();
  text = draw();
  assert.match(text, /1 OF 4 HOME/);
  const list = standings(g.v);
  assert.deepEqual([list[0].slot, list[0].home, list[0].rank], [1, true, 1]);
  for (let k = 2; k < list.length; k++) assert.ok(list[k].path >= list[k - 1].path);
  const fr = maze.frame(g.v);
  assert.deepEqual([fr.shape, fr.radius, fr.centre], ['square', M.half + 1, [C, PLAT_Y, C]]);
  assert.ok(maze.hint.length <= 70 && maze.rules.length <= 70);
  assert.equal(maze.ownScore, true);
  // the brain's danger: against a hedge or a shut door where the sim's push has one
  const tick = g.v.tick, mask = maskAt(M, playT(g));
  let near = 0;
  for (let k = 0; k < 4000; k++) {
    const x = M.x0 + ((k * 0.6180339) % 1) * M.n * CELL, z = M.x0 + ((k * 0.7548777) % 1) * M.n * CELL;
    const d = clearance(M, x, z, mask), w = maze.brain.danger(g.v, x, z, tick);
    assert.equal(w >= 0.9, d < B_RAD, `(${x.toFixed(2)}, ${z.toFixed(2)}): ${d.toFixed(3)} m clear, danger ${w}`);
    if (w >= 0.9) near++;
  }
  assert.ok(near > 400, `${near} of 4000 against a hedge`);
  assert.equal(maze.brain.danger(g.v, M.x0 - 3, C, tick), 1, 'off the maze');
  // the brain: a goal one cell nearer the middle, from anywhere on the ring
  const P = paths(M, epochAt(playT(g)));
  for (const c of [0, M.n - 1, M.n * M.n - 1, M.n * (M.n - 1)]) {
    put(g, 2, ...centreOf(M, c));
    g.step();
    const goal = maze.brain.goal(g.v, 2, null);
    const [i, j] = cellOf(M, goal[0], goal[1]);
    assert.equal(P.now.dist[j * M.n + i], P.now.dist[c] - 1, `from ${c}`);
    const s = maze.brain.think(g.v, 2, null, g.v.tick);
    assert.ok(Number.isFinite(s.yaw) && (s.move === 0 || s.move === 1));
  }
});
