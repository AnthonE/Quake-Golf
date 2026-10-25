// MAZE RUN, as drawn and as the AI ball sees it. The maze is read straight
// from the sim (src/mg/maze.mjs's layout: a byte a cell in PG_S, the doors'
// table beside it) and built once a layout into runs of hedge: boxes in a
// hedge green with a lighter top, on a gravel floor over the sea. The doors
// are striped boxes drawn as they stand on the prediction's clock (shut,
// sunk, rising or sinking), their tops flashing for the MZ_WARN ticks
// before they move; the pad in the middle glows under a beam that shows
// from anywhere in the maze. The paths are worked here as the sim works
// them ($mz_bfs, in doubles: the brain steers by them, nothing is fed
// back): the AI ball follows the cells nearer the middle, takes the one
// fewer balls are in where two are as near, and only goes through a door
// that will still be open when it gets there.
import * as L from '../../src/layout.mjs';
import * as MC from '../../src/mg/maze.mjs'; // MZ_*: the minigame's own constants
import { PLAT_Y } from '../../src/party-view.mjs';
import { LOOK, SPRITE, DECAL } from '../party-render.mjs';
import { C } from '../font.mjs';

const TICK = 0.008;
const CELL = MC.MZ_C, HT = MC.MZ_HT, HIGH = MC.MZ_HIGH;
const NONE = 0xffff;
const CAP = 0.14; // the lighter top's depth, m
const HEDGE = [0.2, 0.42, 0.16], TOP = [0.46, 0.7, 0.3]; // the hedge, its clipped top
const DOOR = [0.95, 0.66, 0.16]; // a door's stripes, with black
const FLOOR = [0.8, 0.73, 0.56]; // the gravel
const SLIDE = 40; // ticks a door takes to rise or sink, from the tick it moves
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const ordinal = (n) => `${n}${[, 'ST', 'ND', 'RD'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'TH'}`;

// ---- the maze, as the sim's table has it

let memo = null;
// This round's maze (the confirmed world's PG_S, fixed from the layout on):
// n a side, its low corner x0, each cell's east and south edge kinds, the
// doors' table, and its hedges and doors as lists to draw; read once a
// layout (a join in the countdown lays it out again), checked once a tick.
export function maze(view) {
  if (memo && view._mzTick === view.tick && view._mzMemo === memo) return memo;
  const dv = view.dv;
  const n = dv.getUint32(L.PG_H + MC.MZ_N, true);
  view._mzTick = view.tick;
  if (!(n >= 3 && n <= MC.MZ_NMAX && n & 1)) { view._mzMemo = null; return null; }
  const a0 = L.PG_S + MC.MZ_CELLS;
  const bytes = view.u8.subarray(a0, a0 + n * n);
  let sig = 0x811c9dc5;
  for (let c = 0; c < bytes.length; c++) sig = Math.imul(sig ^ bytes[c], 16777619);
  const masks = [];
  for (let e = 0; e < MC.MZ_NE; e++) masks.push(dv.getUint32(L.PG_S + MC.MZ_MASKS + 4 * e, true));
  const x0 = dv.getFloat32(L.PG_H + MC.MZ_X0, true);
  const key = `${n} ${x0} ${sig >>> 0} ${masks.join(',')}`;
  if (memo?.key === key) { view._mzMemo = memo; return memo; }
  const E = new Uint8Array(n * n), S = new Uint8Array(n * n);
  for (let c = 0; c < n * n; c++) { E[c] = bytes[c] & 15; S[c] = bytes[c] >> 4; }
  memo = { key, n, x0, half: n * CELL / 2, cx: x0 + n * CELL / 2, E, S, masks, mid: (n * n) >> 1, paths: new Map(), runs: null, doors: null };
  build(memo);
  view._mzMemo = memo;
  return memo;
}

// The kind of the line x = i between cells (i - 1, j) and (i, j) ($mz_v), and z = j between (i, j - 1) and (i, j) ($mz_h).
export function kindV(M, i, j) {
  if (j < 0 || j >= M.n) return MC.MZ_OPEN;
  if (i <= 0 || i >= M.n) return MC.MZ_WALL;
  return M.E[j * M.n + i - 1];
}
export function kindH(M, i, j) {
  if (i < 0 || i >= M.n) return MC.MZ_OPEN;
  if (j <= 0 || j >= M.n) return MC.MZ_WALL;
  return M.S[(j - 1) * M.n + i];
}
// Is an edge of kind k shut with the doors' groups in mask open? ($mz_shut)
export const shut = (k, mask) => (k < MC.MZ_DOOR ? k === MC.MZ_WALL : !((mask >>> (k - MC.MZ_DOOR)) & 1));
// The doors' groups open in epoch e, and on tick t into play ($mz_mask).
export const maskOf = (M, e) => M.masks[e & (MC.MZ_NE - 1)];
export const epochAt = (t) => Math.floor(Math.max(0, t) / MC.MZ_PERIOD);
export const maskAt = (M, t) => maskOf(M, epochAt(t));
// The cell holding (x, z), held to the maze, as $mz_at finds it.
export function cellOf(M, x, z) {
  const i = clamp(Math.floor(Math.fround(Math.fround(x - M.x0) / CELL)), 0, M.n - 1);
  const j = clamp(Math.floor(Math.fround(Math.fround(z - M.x0) / CELL)), 0, M.n - 1);
  return [i, j];
}
// Cell c's centre [x, z].
export const centreOf = (M, c) => [M.x0 + ((c % M.n) + 0.5) * CELL, M.x0 + (Math.floor(c / M.n) + 0.5) * CELL];
// The kind of the edge from cell c the way k goes (0 east, 1 south, 2 west, 3 north), and the cell there (-1 off the maze).
const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
export function edge(M, c, k) {
  const n = M.n, i = c % n, j = (c / n) | 0;
  if (k === 0) return i + 1 < n ? [M.E[c], c + 1] : [MC.MZ_WALL, -1];
  if (k === 1) return j + 1 < n ? [M.S[c], c + n] : [MC.MZ_WALL, -1];
  if (k === 2) return i > 0 ? [M.E[c - 1], c - 1] : [MC.MZ_WALL, -1];
  return j > 0 ? [M.S[c - n], c - n] : [MC.MZ_WALL, -1];
}

// Every cell's distance in cells along the open paths to the middle ($mz_bfs), and the search's order.
export function bfs(M, mask) {
  const n = M.n, dist = new Uint16Array(n * n).fill(NONE), order = new Uint16Array(n * n);
  dist[M.mid] = 0;
  order[0] = M.mid;
  let tail = 1;
  for (let head = 0; head < tail; head++) {
    const c = order[head], k1 = dist[c] + 1;
    for (let k = 0; k < 4; k++) {
      const [kind, nb] = edge(M, c, k);
      if (nb >= 0 && dist[nb] === NONE && !shut(kind, mask)) { dist[nb] = k1; order[tail++] = nb; }
    }
  }
  return { dist, order: order.subarray(0, tail), mask };
}

// The paths for epoch e, worked once: now (the doors as they stand), next
// (as they will), safe (only the doors open now and still open next epoch),
// and along now's way (the first of east, south, west, north a cell nearer)
// how many cells on a ball meets a door that shuts as the epoch ends (-1:
// none on its way) and the cell it would meet it from.
export function paths(M, e) {
  let P = M.paths.get(e);
  if (P) return P;
  if (M.paths.size > 8) M.paths.clear();
  const m0 = maskOf(M, e), m1 = maskOf(M, e + 1);
  const now = bfs(M, m0), next = bfs(M, m1), safe = bfs(M, m0 & m1);
  const ahead = new Int16Array(M.n * M.n).fill(-1), gate = new Int32Array(M.n * M.n).fill(-1);
  for (const c of now.order) {
    const d = now.dist[c];
    if (!d) continue;
    for (let k = 0; k < 4; k++) {
      const [kind, nb] = edge(M, c, k);
      if (nb < 0 || now.dist[nb] !== d - 1 || shut(kind, m0)) continue;
      if (shut(kind, m1)) { ahead[c] = 0; gate[c] = c; } else if (ahead[nb] >= 0) { ahead[c] = ahead[nb] + 1; gate[c] = gate[nb]; }
      break;
    }
  }
  P = { e, now, next, safe, ahead, gate };
  M.paths.set(e, P);
  return P;
}

// Metres along the open paths from (x, z) to the middle, by a search's dist
// ($mz_score's: its cell's distance less how far across it toward the next
// cell on the way), Infinity off every path.
export function pathLen(M, S, x, z) {
  const [i, j] = cellOf(M, x, z);
  const c = j * M.n + i, k = S.dist[c];
  if (k === NONE) return Infinity;
  if (!k) return 0;
  for (let w = 0; w < 4; w++) {
    const [kind, nb] = edge(M, c, w);
    if (nb < 0 || S.dist[nb] !== k - 1 || shut(kind, S.mask)) continue;
    const [ccx, ccz] = centreOf(M, c);
    return k * CELL - clamp((x - ccx) * DX[w] + (z - ccz) * DZ[w], -CELL / 2, CELL / 2);
  }
  return k * CELL;
}

// How far (x, z) is from the nearest hedge or door shut with the doors' groups
// in mask open, of the twelve lines $mz_push looks at round its cell (negative inside one).
export function clearance(M, x, z, mask) {
  const [i, j] = cellOf(M, x, z);
  const u = x - M.x0, w = z - M.x0;
  let best = Infinity;
  const box = (xa, xb, za, zb) => {
    const dx = u - clamp(u, xa, xb), dz = w - clamp(w, za, zb);
    const d = Math.hypot(dx, dz);
    best = Math.min(best, d > 0 ? d : -Math.min(u - xa, xb - u, w - za, zb - w));
  };
  for (let a = 0; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    if (shut(kindV(M, i + a, j + b), mask)) box((i + a) * CELL - HT, (i + a) * CELL + HT, (j + b) * CELL - HT, (j + b + 1) * CELL + HT);
  }
  for (let b = 0; b <= 1; b++) for (let a = -1; a <= 1; a++) {
    if (shut(kindH(M, i + a, j + b), mask)) box((i + a) * CELL - HT, (i + a + 1) * CELL + HT, (j + b) * CELL - HT, (j + b) * CELL + HT);
  }
  return best;
}

// Everyone in, ranked as the end will place them: home by the order they got
// there, then the rest by their way to the middle now (the confirmed view's).
export function standings(view) {
  if (view._mz?.tick === view.tick) return view._mz.list;
  const M = maze(view);
  const g = view.hole();
  const list = [];
  if (M) {
    const P = paths(M, epochAt(g.state >= L.H_PLAY ? (g.tick - g.start) | 0 : 0));
    for (let p = 0; p < L.NPLAYER; p++) {
      const a = L.PLAYERS + p * L.PSIZE;
      if (!(view.u8[a + L.P_FL] & L.PF_LIVE)) continue;
      const m = view.dv.getUint32(a + L.PG_M, true), home = (m & MC.MZ_M_FIN) !== 0;
      const path = home ? 0 : pathLen(M, P.now, view.dv.getFloat32(a + L.P_PX, true), view.dv.getFloat32(a + L.P_PZ, true));
      list.push({ slot: p, home, place: home ? m & 0xffff : 0, path });
    }
  }
  list.sort((a, b) => (b.home - a.home) || (a.home ? a.place - b.place : a.path - b.path) || a.slot - b.slot);
  list.forEach((e, i) => {
    const q = list[i - 1];
    e.rank = q && q.home === e.home && (e.home ? q.place === e.place : q.path === e.path) ? q.rank : i + 1;
  });
  view._mz = { tick: view.tick, list };
  return list;
}

// ---- drawing

// The hedges that never move, merged into runs along their lines, and every door.
function build(M) {
  const n = M.n, runs = [], doors = [];
  const run = (horiz, line, a, b) => {
    // cells a to b along line `line` (z = line C across, or x = line C down), past both ends by HT
    const lo = a * CELL - HT, hi = (b + 1) * CELL + HT, l = line * CELL;
    runs.push(horiz ? [M.x0 + (lo + hi) / 2, M.x0 + l, (hi - lo) / 2, HT] : [M.x0 + l, M.x0 + (lo + hi) / 2, HT, (hi - lo) / 2]);
  };
  for (let j = 0; j <= n; j++) {
    let a = -1;
    for (let i = 0; i <= n; i++) {
      const k = i < n ? kindH(M, i, j) : MC.MZ_OPEN;
      if (k === MC.MZ_WALL) { if (a < 0) a = i; } else if (a >= 0) { run(true, j, a, i - 1); a = -1; }
      if (k >= MC.MZ_DOOR) doors.push({ horiz: true, x: M.x0 + (i + 0.5) * CELL, z: M.x0 + j * CELL, g: k - MC.MZ_DOOR });
    }
  }
  for (let i = 0; i <= n; i++) {
    let a = -1;
    for (let j = 0; j <= n; j++) {
      const k = j < n ? kindV(M, i, j) : MC.MZ_OPEN;
      if (k === MC.MZ_WALL) { if (a < 0) a = j; } else if (a >= 0) { run(false, i, a, j - 1); a = -1; }
      if (k >= MC.MZ_DOOR) doors.push({ horiz: false, x: M.x0 + i * CELL, z: M.x0 + (j + 0.5) * CELL, g: k - MC.MZ_DOOR });
    }
  }
  M.runs = runs;
  M.doors = doors;
}

// Ticks into play to draw at (fractional): the prediction's clock in play, 0
// through the countdown, frozen where the round ended through the result.
function playTime(view, g, ctx) {
  if (g.state === L.H_COUNT) return 0;
  if (g.state !== L.H_PLAY && g.state !== L.H_OVER) return -1;
  let t = typeof ctx?.ptick === 'number' ? ctx.ptick - g.start : typeof ctx?.t === 'number' && ctx.t > 0 ? ctx.t / TICK : g.t + (ctx?.dt || 0) / TICK;
  if (g.state === L.H_OVER) t = Math.min(t, (g.until - L.P_OVER - g.start) | 0);
  return Math.max(0, t);
}

// How far up door D stands t ticks into play, 0 sunk to 1 shut: it moves on
// the epoch's first tick (solid from then, or open), rising or sinking over SLIDE ticks.
export function doorUp(M, D, t) {
  const e = epochAt(t), up = !(maskOf(M, e) >>> D.g & 1);
  if (e === 0) return up ? 1 : 0;
  const was = !(maskOf(M, e - 1) >>> D.g & 1);
  if (up === was) return up ? 1 : 0;
  const k = clamp((t - e * MC.MZ_PERIOD) / SLIDE, 0, 1);
  return up ? k : 1 - k;
}
// Will door D move at the end of the epoch t is in, and is it in its warning?
export function doorWarn(M, D, t) {
  const e = epochAt(t);
  const moves = ((maskOf(M, e) ^ maskOf(M, e + 1)) >>> D.g & 1) === 1;
  return moves && (e + 1) * MC.MZ_PERIOD - t <= MC.MZ_WARN;
}

// What the HUD knows of your ball between frames: the prediction's, as draw last saw it.
let seen = { pme: null, ptick: 0, at: -1 };

// ---- the AI ball

const MINDS = new WeakMap();
const SLOT_MINDS = [];
function mindOf(bot, slot) {
  if (bot && typeof bot === 'object') {
    let m = MINDS.get(bot);
    if (!m) MINDS.set(bot, (m = { round: -1 }));
    return m;
  }
  return (SLOT_MINDS[slot] ||= { round: -1 });
}
// A number in [0, 1) for slot p and k, the same on every machine that asks.
const luck = (p, k) => (((Math.imul(p + 1, 0x9e3779b1) ^ Math.imul(k + 7, 0x85ebca6b)) >>> 0) % 10007) / 10007;

// The balls in, once a world tick: how many are in each cell, and where.
function crowdOf(view, M) {
  const c = view._mzc;
  if (c && c.tick === view.tick && c.bank === view.bank && c.M === M) return c;
  const count = new Uint16Array(M.n * M.n), xs = [], zs = [], slots = [];
  for (let p = 0; p < L.NPLAYER; p++) {
    const b = L.PLAYERS + view.bank + p * L.PSIZE;
    if ((view.u8[b + L.P_FL] & (L.PF_LIVE | L.PF_DEAD | L.PF_FALL)) !== L.PF_LIVE) continue;
    const x = view.dv.getFloat32(b + L.P_PX, true), z = view.dv.getFloat32(b + L.P_PZ, true);
    const [i, j] = cellOf(M, x, z);
    count[j * M.n + i]++;
    xs.push(x); zs.push(z); slots.push(p);
  }
  view._mzc = { tick: view.tick, bank: view.bank, M, count, xs, zs, slots };
  return view._mzc;
}

// The way to the middle round the crowds, by search S's open edges: each
// cell's cost from the middle where a cell costs 1 plus CROWD for every ball
// in it (a Dijkstra out from the pad's cell), worked again every FLOW world
// ticks from that tick's balls and shared by every bot. Of two ways as short,
// the one with no queue down it.
const CROWD = 0.4, FLOW = 32;
function flowOf(M, S, crowd, tick) {
  const at = Math.floor(tick / FLOW);
  if (S.flow && S.flow.at === at && S.flow.M === M) return S.flow.F;
  const n2 = M.n * M.n, F = new Float32Array(n2).fill(Infinity), count = crowd.count;
  const hc = new Float32Array(4 * n2 + 4), hi = new Int32Array(4 * n2 + 4);
  let size = 0;
  const push = (f, c) => {
    let k = size++;
    while (k > 0) { const up = (k - 1) >> 1; if (hc[up] < f || (hc[up] === f && hi[up] < c)) break; hc[k] = hc[up]; hi[k] = hi[up]; k = up; }
    hc[k] = f; hi[k] = c;
  };
  const pop = () => {
    const f = hc[0], c = hi[0], lf = hc[--size], lc = hi[size];
    let k = 0;
    for (;;) {
      let m = 2 * k + 1;
      if (m >= size) break;
      if (m + 1 < size && (hc[m + 1] < hc[m] || (hc[m + 1] === hc[m] && hi[m + 1] < hi[m]))) m++;
      if (hc[m] > lf || (hc[m] === lf && hi[m] > lc)) break;
      hc[k] = hc[m]; hi[k] = hi[m]; k = m;
    }
    hc[k] = lf; hi[k] = lc;
    return [f, c];
  };
  F[M.mid] = 0;
  push(0, M.mid);
  while (size) {
    const [f, c] = pop();
    if (f > F[c]) continue;
    for (let k = 0; k < 4; k++) {
      const [kind, nb] = edge(M, c, k);
      if (nb < 0 || shut(kind, S.mask)) continue;
      const g = f + 1 + CROWD * count[nb];
      if (g < F[nb]) { F[nb] = g; push(g, nb); }
    }
  }
  S.flow = { at, M, F };
  return F;
}

// The cell the ball goes to next from c: a neighbour one nearer the middle
// by S through an open edge; where two are as near, the one the flow F
// makes cheaper (fewer balls on the way on from it), a little of its own
// luck in it so a crowd splits where the ways are as good.
function nextCell(M, S, c, slot, F) {
  const d = S.dist[c];
  if (d === NONE || d === 0) return -1;
  let best = -1, bs = Infinity;
  for (let k = 0; k < 4; k++) {
    const [kind, nb] = edge(M, c, k);
    if (nb < 0 || S.dist[nb] !== d - 1 || shut(kind, S.mask)) continue;
    const s = (F ? F[nb] : 0) + 0.3 * luck(slot, nb * 4 + k);
    if (s < bs) { bs = s; best = nb; }
  }
  return best;
}

// What the ball wants on tick `tick`, seen from a world `tick - view.tick`
// old: where it will be, the search to go by (now's, or the safe one when
// now's way meets a door that will have shut before it gets there), the
// next cell, and how far on its way runs straight.
function plan(view, me, bot, tick) {
  const dv = view.dv, o = view.bank || 0;
  const slot = typeof me === 'number' ? me : me?.slot;
  if (dv.getUint32(L.HDR_STATE + o, true) !== L.H_PLAY || !(slot >= 0)) return null;
  const rb = L.PLAYERS + o + slot * L.PSIZE;
  if ((view.u8[rb + L.P_FL] & (L.PF_LIVE | L.PF_DEAD | L.PF_FALL)) !== L.PF_LIVE) return null;
  const M = maze(view);
  if (!M) return null;
  const rolled = !!(bot?.pos && bot.at === tick);
  const ahead = rolled ? clamp(bot.lag | 0, 0, 90) : clamp((tick - view.tick) | 0, 0, 90);
  const t = Math.max(0, (view.tick + ahead - dv.getUint32(L.HDR_START + o, true)) | 0);
  const lag = ahead * TICK, more = rolled ? Math.max(0, ahead - 40) * TICK : 0;
  const vel = rolled ? [bot.vel[0], bot.vel[1]] : [dv.getFloat32(rb + L.P_VX, true), dv.getFloat32(rb + L.P_VZ, true)];
  const pos = rolled ? [bot.pos[0] + vel[0] * more, bot.pos[1] + vel[1] * more] : [dv.getFloat32(rb + L.P_PX, true) + vel[0] * lag, dv.getFloat32(rb + L.P_PZ, true) + vel[1] * lag];
  const skill = bot?.skill ?? 0.6;
  const mind = mindOf(bot, slot);
  const round = dv.getUint32(L.HDR_HOLE + o, true);
  const e = epochAt(t);
  if (mind.round !== round) { mind.round = round; mind.e = -1; }
  if (mind.e !== e) { mind.e = e; mind.safe = false; }
  const P = paths(M, e);
  const [i, j] = cellOf(M, pos[0], pos[1]);
  const c = j * M.n + i;
  const crowd = crowdOf(view, M);
  // a door on now's way that shuts before it gets there (a cell a second, roughly): the safe way till the doors
  // move, unless going on to the door and round from there by the next epoch's ways is no longer
  const left = ((e + 1) * MC.MZ_PERIOD - t) * TICK;
  const k = P.ahead[c];
  if (!mind.safe && k >= 0 && (k + 1) * (1.1 - 0.3 * skill) + 0.6 > left && P.safe.dist[c] < k + P.next.dist[P.gate[c]]) mind.safe = true;
  const S = mind.safe ? P.safe : P.now;
  if (c === M.mid || S.dist[c] === 0) return { pos, vel, slot, crowd, goal: [M.cx, M.cx], dir: null, run: 0, pad: true, c, S, M, skill };
  const F = flowOf(M, S, crowd, view.tick);
  const nb = nextCell(M, S, c, slot, F);
  if (nb < 0) return { pos, vel, slot, crowd, goal: [M.cx, M.cx], dir: null, run: 0, pad: false, c, S, M, skill };
  // the way, and how many cells on it holds that way (to 4)
  const w = nb === c + 1 ? 0 : nb === c + M.n ? 1 : nb === c - 1 ? 2 : 3;
  let run = 1, at = nb, pad = nb === M.mid;
  while (run < 4 && !pad) {
    const nx = nextCell(M, S, at, slot, F);
    if (nx < 0 || nx - at !== nb - c) break;
    at = nx; run++; pad = at === M.mid;
  }
  return { pos, vel, slot, crowd, goal: centreOf(M, nb), dir: w, run, pad, c, S, M, skill, end: at };
}

// The velocity that follows the way: along it, braking for the turn at its
// straight run's end (none into the pad); across it, back onto the middle
// of the cells' line; a little room from the balls round it. Pushed for
// (the keys toward what's missing), or coasting when it's there.
const ROOM = 2.6;
function steer(p, last) {
  const vmax = 7.5 + 2 * p.skill;
  let wx, wz;
  if (p.dir === null) {
    const dx = p.goal[0] - p.pos[0], dz = p.goal[1] - p.pos[1], d = Math.hypot(dx, dz) || 1;
    const v = Math.min(vmax, 2 + Math.sqrt(14 * d));
    wx = (dx / d) * v; wz = (dz / d) * v;
  } else {
    const ux = DX[p.dir], uz = DZ[p.dir];
    const [ccx, ccz] = centreOf(p.M, p.c);
    const ox = p.pos[0] - ccx, oz = p.pos[1] - ccz;
    const along = ox * ux + oz * uz, lat = oz * ux - ox * uz; // + to the right of the way
    const toTurn = p.run * CELL - along;
    const vturn = 2.8 + 1.2 * p.skill;
    const va = p.pad ? vmax : Math.min(vmax, Math.sqrt(vturn * vturn + 2 * 6.5 * Math.max(0, toTurn - 0.8)));
    const vl = clamp(-2.4 * lat, -4, 4);
    wx = ux * va - uz * vl; wz = uz * va + ux * vl;
  }
  if (p.crowd) {
    const { xs, zs, slots } = p.crowd;
    for (let i = 0; i < xs.length; i++) {
      if (slots[i] === p.slot) continue;
      const ox = p.pos[0] - xs[i], oz = p.pos[1] - zs[i];
      if (Math.abs(ox) > ROOM || Math.abs(oz) > ROOM) continue;
      const od = Math.hypot(ox, oz);
      if (od >= ROOM || od < 1e-6) continue;
      const k = (2.5 * (ROOM - od)) / ROOM / od;
      wx += ox * k; wz += oz * k;
    }
  }
  const ax = wx - p.vel[0], az = wz - p.vel[1];
  if (Math.hypot(ax, az) < 0.5) {
    if (Math.hypot(wx, wz) + 0.2 < Math.hypot(p.vel[0], p.vel[1])) return { yaw: last ?? 0, move: 0, hop: 0, use: 0 };
    return { yaw: Math.atan2(wz, wx), move: 1, hop: 0, use: 0 };
  }
  return { yaw: Math.atan2(az, ax), move: 1, hop: 0, use: 0 };
}

export default {
  id: L.MG_MAZE, key: 'maze', name: 'MAZE RUN',
  hint: 'FIND THE WAY TO THE PAD IN THE MIDDLE  THE DOORS MOVE EVERY 15 S',
  rules: 'FIRST ON THE PAD WINS  THE REST BY HOW FAR THEY GOT',
  env: 'day',
  ownScore: true,

  draw(view, ctx, out) {
    const M = maze(view);
    if (!M) return;
    const g = view.party();
    const tp = playTime(view, g, ctx);
    if (ctx?.pme) seen = { pme: ctx.pme, ptick: tp, at: ctx.now };
    const sc = out.scene;
    const now = (ctx?.now ?? 0) / 1000;
    const cx = M.cx, h = M.half + HT;
    // the floor, an island of gravel
    sc.box(cx, PLAT_Y - 1.5, cx, h + 0.6, 1.5, h + 0.6, 0, FLOOR[0], FLOOR[1], FLOOR[2], LOOK.MATTE, 0, 0, 1, 7);
    // the hedges, a lighter clipped top on each
    const yb = PLAT_Y + (HIGH - CAP) / 2, yt = PLAT_Y + HIGH - CAP / 2;
    for (const [x, z, hx, hz] of M.runs) {
      sc.box(x, yb, z, hx, (HIGH - CAP) / 2, hz, 0, HEDGE[0], HEDGE[1], HEDGE[2], LOOK.RUBBER);
      sc.box(x, yt, z, hx + 0.04, CAP / 2, hz + 0.04, 0, TOP[0], TOP[1], TOP[2], LOOK.RUBBER);
    }
    // the doors, striped; their tops flash before they move
    const t = Math.max(0, tp);
    const flash = 0.5 + 0.5 * Math.sin(now * 14);
    for (const D of M.doors) {
      const up = doorUp(M, D, t), warn = tp >= 0 && g.state === L.H_PLAY && doorWarn(M, D, t);
      const hx = D.horiz ? CELL / 2 - HT : HT * 0.8, hz = D.horiz ? HT * 0.8 : CELL / 2 - HT;
      // its sill in the floor, where it sinks to
      sc.box(D.x, PLAT_Y + 0.02, D.z, hx + 0.05, 0.03, hz + 0.05, 0, DOOR[0] * 0.5, DOOR[1] * 0.5, DOOR[2] * 0.5, LOOK.HAZARD, 0.5);
      if (up > 0.01) {
        const dy = -(1 - up) * HIGH;
        sc.box(D.x, yb + dy, D.z, hx, (HIGH - CAP) / 2, hz, 0, DOOR[0], DOOR[1], DOOR[2], LOOK.HAZARD, 0.5);
        if (warn) sc.box(D.x, yt + dy, D.z, hx + 0.05, CAP / 2 + 0.02, hz + 0.05, 0, 1, 0.35 + 0.5 * flash, 0.15, LOOK.GLOW, 0.6 + 1.6 * flash, 0.4);
        else sc.box(D.x, yt + dy, D.z, hx + 0.03, CAP / 2, hz + 0.03, 0, 0.2, 0.18, 0.15, LOOK.PLASTIC);
      } else if (warn) {
        // open, about to shut: its sill flashes
        sc.box(D.x, PLAT_Y + 0.05, D.z, hx + 0.08, 0.04, hz + 0.08, 0, 1, 0.35 + 0.5 * flash, 0.15, LOOK.GLOW, 0.6 + 1.6 * flash, 0.4);
      }
    }
    // the pad: a glowing disc under a beam, the room round it lit
    const beat = 0.5 + 0.5 * Math.sin(now * 3);
    sc.cyl(cx, PLAT_Y + 0.04, cx, MC.MZ_PAD_R, 0.04, 1, 0.82, 0.3, LOOK.GLOW, 1.2 + 0.5 * beat, 0.5);
    out.decals.push({ pos: [cx, PLAT_Y + 0.1, cx], radius: MC.MZ_PAD_R + 0.9, width: 0.9, color: [1, 0.85, 0.35, 0.35 + 0.25 * beat], kind: DECAL.ZONE });
    out.beams.push({ a: [cx, PLAT_Y + 70, cx], b: [cx, PLAT_Y + 0.2, cx], width: 1.2 + 0.4 * beat, color: [1, 0.85, 0.4, 0.3 + 0.15 * beat] });
    out.glow.push({ pos: [cx, PLAT_Y + 3, cx], size: 4 + beat, color: [1, 0.8, 0.35, 0.35], kind: SPRITE.FLASH, minpx: 2 });
  },

  frame(view) {
    const M = maze(view), g = view.party();
    if (!M) return { centre: [g.cx, PLAT_Y, g.cx], radius: g.size, shape: 'square' };
    return { centre: [M.cx, PLAT_Y, M.cx], radius: M.half + 1, shape: 'square' };
  },

  fx(f, ctx) {
    const mine = f.owner === ctx.slot;
    const d = typeof ctx.dist === 'function' ? ctx.dist(f.pos) : ctx.dist ?? 0;
    if (f.kind === MC.MZ_FX_HOME) {
      const place = f.shot;
      const g = ctx.view?.party();
      if (mine) { ctx.banner?.(`HOME ${ordinal(place)}!`, place === 1 ? C.YELLOW : C.GREEN, 3000); ctx.sound?.holed?.(); }
      else if (place === 1) {
        const left = g ? Math.max(0, Math.round((g.until - g.tick) / 125)) : 0;
        ctx.banner?.(`${ctx.name?.(f.owner) ?? `P${f.owner + 1}`} FOUND THE MIDDLE  ${left} S LEFT`, C.YELLOW, 3000);
        ctx.sound?.count?.(0);
      } else ctx.feed?.(`${ctx.name?.(f.owner) ?? `P${f.owner + 1}`} HOME ${ordinal(place)}`, C.WHITE);
      for (let i = 0; i < 6; i++) {
        const a = i * 1.047 + f.owner;
        ctx.glow?.({ pos: [f.pos[0] + Math.cos(a) * 1.5, f.pos[1] + 2 + (i & 1), f.pos[2] + Math.sin(a) * 1.5], size: 0.9, color: [[1, 0.85, 0.2], [0.4, 1, 0.4], [1, 0.95, 0.6]][i % 3].concat(1), kind: SPRITE.SPARK, life: 700 });
      }
    } else if (f.kind === MC.MZ_FX_BONK) {
      if (mine || d < 20) ctx.sound?.land?.(Math.min(12, f.size * 1.5));
    } else if (f.kind === MC.MZ_FX_WARN) {
      if (f.shot) { ctx.banner?.('THE DOORS ARE ABOUT TO MOVE', C.ORANGE, 1600); ctx.sound?.tick?.(); }
    } else if (f.kind === MC.MZ_FX_DOORS) {
      ctx.sound?.count?.(1);
    }
  },

  // Where you stand (rows 0 and 1, which ownScore leaves to it): your place
  // as it would end now and your way to the middle, or home; the doors'
  // clock; how many are home.
  hud(view, ctx) {
    const M = maze(view), g = view.party();
    if (!M || g.state !== L.H_PLAY) return;
    const list = standings(view);
    const me = ctx.me ?? (ctx.slot >= 0 ? view.partier(ctx.slot) : null);
    const mine = me?.live ? list.find((e) => e.slot === me.slot) : null;
    if (mine) {
      if (mine.home) {
        ctx.put(1, 0, `HOME ${ordinal(mine.place)} OF ${list.length}`, C.GREEN);
        ctx.put(1, 1, mine.place === 1 ? 'YOU FOUND IT FIRST' : 'WAIT FOR THE REST', C.GREY);
      } else {
        // your ball as the prediction has it, if draw has just seen it
        const fresh = seen.pme && seen.at === ctx.now;
        const p = fresh ? seen.pme : me;
        const P = paths(M, epochAt(fresh ? seen.ptick : g.t));
        const len = pathLen(M, P.now, p.pos[0], p.pos[2]);
        ctx.put(1, 0, `${ordinal(mine.rank)} OF ${list.length}`, mine.rank === 1 ? C.YELLOW : C.WHITE);
        if (Number.isFinite(len)) ctx.put(1, 1, `${Math.max(0, Math.ceil(len))} M TO THE MIDDLE`, C.GREY);
      }
    } else if (list[0]) ctx.put(1, 0, list[0].home ? `P${list[0].slot + 1} WON IT` : `LEADER P${list[0].slot + 1}`, C.WHITE);
    const t = g.t, e = epochAt(t), left = ((e + 1) * MC.MZ_PERIOD - t) * TICK;
    const moving = ((maskOf(M, e) ^ maskOf(M, e + 1)) & 0xff) !== 0;
    if (moving && left <= MC.MZ_WARN * TICK) ctx.right(3, 'DOORS MOVING', Math.floor((ctx.now ?? 0) / 150) & 1 ? C.ORANGE : C.YELLOW);
    else ctx.right(3, `DOORS MOVE IN ${Math.ceil(left)}`, C.GREY);
    const home = list.filter((x) => x.home).length;
    if (home) ctx.right(4, `${home} OF ${list.length} HOME`, C.CYAN);
  },

  brain: {
    // against a hedge or a shut door on that tick (a ball's radius from it), a knock that stops it; brushing one, a little;
    // off the maze, a fall (think steers, so this is for whoever else asks)
    danger(view, x, z, tick) {
      const M = maze(view);
      if (!M) return 0;
      if (Math.abs(x - M.cx) > M.half || Math.abs(z - M.cx) > M.half) return 1;
      const o = view.bank || 0;
      const d = clearance(M, x, z, maskAt(M, ((tick - view.dv.getUint32(L.HDR_START + o, true)) | 0)));
      return d < 1 ? 0.9 : d < 1.5 ? 0.3 : 0;
    },
    goal(view, me, bot) {
      const p = plan(view, me, bot, view.tick);
      return p ? p.goal : null;
    },
    hop() { return false; },
    // all of it, as a word's fields (yaw in radians, as client/party-bot.mjs takes it)
    think(view, me, bot, tick = view.tick) {
      const p = plan(view, me, bot, tick);
      if (!p) return null;
      const mind = mindOf(bot, p.slot);
      const s = steer(p, mind.yaw);
      mind.yaw = s.yaw;
      return s;
    },
  },
};
