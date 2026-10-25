// LIGHT TRAILS, as drawn and as the AI ball sees it. The stage is a dark
// square floor (LOOK.PAINT) under a night sky, a faint grid of 4 m squares
// on it and a lit rim, as wide as the sim has it on the prediction's clock as
// its edges close in. The trails are the sim's grid laid over it as the
// paint layer, every cell in its layer's colour and glowing (a palette alpha
// past 1): dim while soft, bright once hard, dimmer again its last second.
// Near the focus a hard cell also stands as a wall of light LT_WALL high, the
// height a hop clears, sinking as it fades. Your own ball lays its light
// ahead of the confirmed world along its predicted path, and where that path
// runs into a wall the crash flashes at once (the confirmed world puts it out
// a round trip on). The grid and the floor are read straight from the sim
// (src/mg/trails.mjs's layout); a cell is soft, hard or gone by a comparison
// with the tick, so what is drawn and what the bots steer by is what the sim
// does.
import * as L from '../../src/layout.mjs';
import * as MC from '../../src/mg/trails.mjs'; // LT_*: the minigame's own constants
import { PLAT_Y } from '../../src/party-view.mjs';
import { LOOK, SPRITE, DECAL } from '../party-render.mjs';
import { C } from '../font.mjs';

const TICK = 0.008;
const f = Math.fround;
const FT = 1.2; // the floor's thickness, m
const LINES = 4; // m between the floor's grid lines
const FADE = 125; // ticks a cell is drawn fading before it goes
const WALLS = 30; // m round the focus a hard cell stands as a wall
const MAXWALL = 4096; // hard cells a frame stood up as walls, at most
const N = (k) => Math.fround(Number(L.BPHYS[k]));
const ACC = N('B_ACC_DT'), AIR = N('B_AIR_DT'), AIR_DRAG = N('B_AIR_DRAG'), HOP_G = Number(L.PHYS.GP_DT) / TICK;

// ---- the round as the sim laid it out (PG_H on the view's bank), and its grid

export function stage(view) {
  const dv = view.dv, o = view.bank || 0;
  return {
    half0: dv.getFloat32(L.PG_H + MC.LT_HALF0 + o, true), half1: dv.getFloat32(L.PG_H + MC.LT_HALF1 + o, true),
    x0: dv.getFloat32(L.PG_H + MC.LT_X0 + o, true), side: dv.getUint32(L.PG_H + MC.LT_SIDE + o, true), cx: dv.getFloat32(L.PG_CX + o, true),
  };
}
// $lt_half: the floor's half-side t ticks into play (t may be fractional: drawing), in f32 as the sim works it.
export function halfAt(st, t) {
  if (t <= MC.LT_CLOSE0) return st.half0;
  if (t >= MC.LT_CLOSE1) return st.half1;
  const k = Number.isInteger(t) ? f(f(t - MC.LT_CLOSE0) / (MC.LT_CLOSE1 - MC.LT_CLOSE0)) : (t - MC.LT_CLOSE0) / (MC.LT_CLOSE1 - MC.LT_CLOSE0);
  return f(f(f(st.half1 - st.half0) * k) + st.half0);
}
// $lt_life: ticks a cell laid tl into play lasts.
export const lifeOf = (tl) => MC.LT_LIFE0 + Math.floor(tl / MC.LT_LIFED);
// The grid as u32s over the view's memory: 0 none, else tick << 8 | slot.
const GRIDS = new WeakMap();
export function grid(view) {
  const buf = view.dv.buffer;
  let g = GRIDS.get(buf);
  if (!g) GRIDS.set(buf, (g = new Uint32Array(buf, L.PG_BIG + MC.LT_CELLS, (L.PG_BIG_SIZE - MC.LT_CELLS) >> 2)));
  return g;
}
// The cell under (x, z), or -1 off the grid.
export function cellAt(st, x, z) {
  const i = Math.floor((x - st.x0) / MC.LT_CS), j = Math.floor((z - st.x0) / MC.LT_CS);
  return i < 0 || j < 0 || i >= st.side || j >= st.side ? -1 : j * st.side + i;
}
// A cell holding v on tick T into play: 0 none (or gone), 1 soft, 2 hard ($lt_visit's test).
export function stateOf(v, T) {
  if (!v) return 0;
  const tl = v >>> 8, a = T - tl;
  if (a >= lifeOf(tl)) return 0;
  return a >= MC.LT_HARD ? 2 : 1;
}
// Ticks into play to draw at, on the prediction's clock if asked (fractional), or -1 before play; frozen where the round ended.
function playTime(view, g, ctx, pred) {
  if (g.state !== L.H_PLAY && g.state !== L.H_OVER) return -1;
  const s = pred ? ctx?.pt : ctx?.t;
  let t = typeof s === 'number' && s > 0 ? s / TICK : g.t + (ctx?.dt || 0) / TICK;
  if (g.state === L.H_OVER) t = Math.min(t, (g.until - L.P_OVER - g.start) | 0);
  return Math.max(0, t);
}

// ---- the colours: a light's hue is its ball's (client/party-game.mjs's slotColor), saturated

const hue = (s) => (s * 0.618034) % 1;
const light = (h) => [0, 0.33, 0.67].map((o) => 0.5 + 0.5 * Math.cos(6.2832 * (h + o)));
export const lightColor = (s) => light(hue(s));
const LIGHTS = Array.from({ length: 256 }, (_, s) => lightColor(s)); // the walls': a slot's light
const WHITER = LIGHTS.map((c) => c.map((x) => Math.min(1, x * 0.75 + 0.3))); // and your own, a little whiter
const NB = 80; // hues in the palette
const BIN = Uint8Array.from({ length: 256 }, (_, s) => Math.floor(hue(s) * NB) % NB);
// palette indices: soft, hard, fading by hue; then your own three
const P_SOFT = 1, P_HARD = 1 + NB, P_FADE = 1 + 2 * NB, P_OWN = 1 + 3 * NB;
const layer = { cells: new Uint8Array(1), n: 1, origin: [0, 0], size: 1, palette: new Float32Array(1024), version: 0 };
let next = new Uint8Array(1);
(function palette() {
  const P = layer.palette;
  const put = (k, c, m, a) => P.set([Math.min(1, c[0] * m[0] + m[1]), Math.min(1, c[1] * m[0] + m[1]), Math.min(1, c[2] * m[0] + m[1]), a], 4 * k);
  for (let b = 0; b < NB; b++) {
    const c = light((b + 0.5) / NB);
    put(P_SOFT + b, c, [0.75, 0], 1.3);
    put(P_HARD + b, c, [0.8, 0.2], 2.6);
    put(P_FADE + b, c, [0.75, 0.05], 1.55);
  }
})();
// your own lights: your colour, a little whiter (set again when you change slot)
let ownSlot = -2;
function ownPalette(me) {
  if (me === ownSlot) return;
  ownSlot = me;
  const c = me >= 0 ? lightColor(me) : [1, 1, 1];
  const P = layer.palette;
  const put = (k, m, a) => P.set([Math.min(1, c[0] * m[0] + m[1]), Math.min(1, c[1] * m[0] + m[1]), Math.min(1, c[2] * m[0] + m[1]), a], 4 * k);
  put(P_OWN, [0.8, 0.12], 1.4);
  put(P_OWN + 1, [0.75, 0.3], 2.9);
  put(P_OWN + 2, [0.8, 0.12], 1.6);
  layer.version++;
}
// Cell v's palette index on tick T into play, for viewer me.
function shade(v, T, me) {
  if (!v) return 0;
  const tl = v >>> 8, a = T - tl, life = lifeOf(tl);
  if (a >= life) return 0;
  const s = v & 255, k = a < MC.LT_HARD ? 0 : a >= life - FADE ? 2 : 1;
  return s === me ? P_OWN + k : (k === 0 ? P_SOFT : k === 1 ? P_HARD : P_FADE) + BIN[s];
}

// Your own ball on the prediction's track (PTRACK): every cell it crosses
// that the confirmed world hasn't laid yet, and the first wall it runs into
// there with its bottom low, as $lt_tick will find it. Drawing only.
export function ownTrack(view, st, me, ctx) {
  const out = { cells: [], crash: null };
  if (!(ctx?.pme && !ctx.pme.out && ctx.pview && me >= 0)) return out;
  const g = grid(view), dv = view.dv;
  const t0 = view.tick, t1 = ctx.pview.tick, start = dv.getUint32(L.HDR_START, true);
  for (let k = 0; k < L.PRED_MAX; k++) {
    const o = L.PTRACK + 16 * k;
    const tk = dv.getUint32(o + 12, true);
    if (tk <= t0 || tk > t1) break;
    const x = dv.getFloat32(o, true), y = dv.getFloat32(o + 4, true), z = dv.getFloat32(o + 8, true);
    const T = (tk - 1 - start) | 0;
    const c = cellAt(st, x, z);
    if (c < 0) continue;
    const s = stateOf(g[c], T);
    if (s === 2 && y < PLAT_Y + MC.LT_WALL) { out.crash = { pos: [x, y, z], tick: tk - 1 }; break; }
    if (s === 0) out.cells.push(c);
  }
  return out;
}

// The paint layer: every cell's index on tick T, your predicted cells soft and your own.
export function paintLayer(view, st, T, me, own) {
  ownPalette(me);
  const n = st.side, nn = n * n, g = grid(view);
  if (layer.n !== n) { layer.n = n; layer.cells = new Uint8Array(nn); next = new Uint8Array(nn); layer.version++; }
  for (let c = 0; c < nn; c++) next[c] = shade(g[c], T, me);
  for (const c of own) next[c] = P_OWN;
  const cells = layer.cells;
  let changed = false;
  for (let c = 0; c < nn; c++) if (cells[c] !== next[c]) { changed = true; break; }
  if (changed) { cells.set(next); layer.version++; }
  layer.origin[0] = layer.origin[1] = st.x0;
  layer.size = n * MC.LT_CS;
  return layer;
}

// Hard cells within R of (fx, fz) as walls of light LT_WALL high, sinking
// their last FADE ticks. Each light's cells are taken in the order it laid
// them (slot, then tick) and chained while each is near the last; a chain
// is drawn as the fewest straight slabs that pass within TOL of every cell's
// middle, so a trail on a slant stands as a smooth wall, not a staircase.
// At most MAXWALL cells, the rows nearest the focus first.
const KEYS = new Float64Array(MAXWALL);
const CX = new Float64Array(MAXWALL), CZ = new Float64Array(MAXWALL);
const TOL = 0.37; // m a slab may pass from a cell's middle: a staircase on the diagonal is 0.354 either side of it
const SPLIT = 2 ** 17; // a key: (slot * 16384 + tick) * SPLIT + cell
function walls(sc, st, g, T, fx, fz, R, me) {
  const n = st.side, cs = MC.LT_CS;
  const ci = Math.floor((fx - st.x0) / cs), cj = Math.floor((fz - st.x0) / cs), rc = Math.ceil(R / cs);
  let m = 0;
  for (let k = 0; k <= 2 * rc && m < MAXWALL; k++) {
    const j = cj + (k & 1 ? -((k + 1) >> 1) : k >> 1);
    if (j < 0 || j >= n) continue;
    const w = Math.floor(Math.sqrt(Math.max(0, rc * rc - (j - cj) * (j - cj))));
    for (let i = Math.max(0, ci - w); i <= Math.min(n - 1, ci + w) && m < MAXWALL; i++) {
      const v = g[j * n + i];
      if (stateOf(v, T) !== 2) continue;
      KEYS[m++] = ((v & 255) * 16384 + (v >>> 8)) * SPLIT + j * n + i;
    }
  }
  const keys = KEYS.subarray(0, m).sort();
  let boxes = 0, len = 0, ps = -1, ptl = 0, ph = 0, pi = 0, pj = 0;
  const flush = () => {
    if (!len) return;
    const c = ps === me ? WHITER[ps] : LIGHTS[ps], hy = (MC.LT_WALL / 2) * (ph / 4), glow = ph < 4 ? 1.1 : 1.6;
    // the fewest straight slabs: from a, on to the furthest cell that keeps every one between within TOL of the line
    const slab = (a, b) => {
      const dx = CX[b] - CX[a], dz = CZ[b] - CZ[a], l = Math.hypot(dx, dz);
      sc.box((CX[a] + CX[b]) / 2, PLAT_Y + hy, (CZ[a] + CZ[b]) / 2, l / 2 + cs * 0.5, hy, 0.17, l > 0 ? Math.atan2(dz, dx) : 0,
        c[0], c[1], c[2], LOOK.GLOW, glow, 0.6, 1, (ps * 16 + boxes) % 4096);
      boxes++;
    };
    if (len === 1) slab(0, 0);
    for (let a = 0; a < len - 1;) {
      let b = a + 1;
      for (let e = a + 2; e < len; e++) {
        const dx = CX[e] - CX[a], dz = CZ[e] - CZ[a], l = Math.hypot(dx, dz);
        let ok = true;
        for (let q = a + 1; q < e && ok; q++) ok = Math.abs((CX[q] - CX[a]) * dz - (CZ[q] - CZ[a]) * dx) <= TOL * l;
        if (!ok) break;
        b = e;
      }
      slab(a, b);
      a = b;
    }
    len = 0;
  };
  for (let q = 0; q < m; q++) {
    const key = keys[q], c = key % SPLIT, rest = (key - c) / SPLIT;
    const tl = rest % 16384, s = (rest - tl) / 16384, i = c % n, j = (c - i) / n;
    const left = lifeOf(tl) - (T - tl), h = left < FADE ? 1 + Math.min(2, Math.floor((left / FADE) * 3)) : 4;
    if (s !== ps || h !== ph || tl - ptl > 40 || Math.abs(i - pi) > 2 || Math.abs(j - pj) > 2) { flush(); ps = s; ph = h; }
    CX[len] = st.x0 + (i + 0.5) * cs; CZ[len] = st.x0 + (j + 0.5) * cs; len++;
    ptl = tl; pi = i; pj = j;
  }
  flush();
  return boxes;
}

// ---- what the bots share every 4th world tick: how lit each 4 m block of the floor is, and the balls in

const BLK = 8; // cells a block side
const CELL = 8; // m, the balls' buckets
const WORLDS = new WeakMap();
function world(view, st, g) {
  const key = `${view.bank}:${g.round}:${g.start}:${view.tick >> 2}`;
  const buf = view.dv.buffer;
  const old = WORLDS.get(buf);
  if (old && old.key === key) return old;
  const n = st.side, nb = Math.ceil(n / BLK), T = g.t;
  const lit = old && old.lit.length === nb * nb ? old.lit.fill(0) : new Float32Array(nb * nb);
  const cells = grid(view);
  for (let j = 0; j < n; j++) {
    const row = j * n, br = ((j / BLK) | 0) * nb;
    for (let i = 0; i < n; i++) {
      const v = cells[row + i];
      if (v && T - (v >>> 8) < lifeOf(v >>> 8)) lit[br + ((i / BLK) | 0)]++;
    }
  }
  for (let k = 0; k < lit.length; k++) lit[k] /= BLK * BLK;
  const balls = new Map();
  for (let p = 0; p < L.NPLAYER; p++) {
    const a = L.PLAYERS + view.bank + p * L.PSIZE;
    if ((view.u8[a + L.P_FL] & (L.PF_LIVE | L.PF_DEAD | L.PF_FALL)) !== L.PF_LIVE) continue;
    const b = { slot: p, x: view.dv.getFloat32(a + L.P_PX, true), z: view.dv.getFloat32(a + L.P_PZ, true), vx: view.dv.getFloat32(a + L.P_VX, true), vz: view.dv.getFloat32(a + L.P_VZ, true) };
    const k = Math.floor(b.x / CELL) * 4096 + Math.floor(b.z / CELL);
    const list = balls.get(k);
    if (list) list.push(b); else balls.set(k, [b]);
  }
  const w = { key, nb, lit, balls };
  WORLDS.set(buf, w);
  return w;
}
// How lit the floor is round (x, z), 0 dark to 1 (outside the grid: 1).
function litAt(st, w, x, z) {
  const bi = Math.floor((x - st.x0) / (MC.LT_CS * BLK)), bj = Math.floor((z - st.x0) / (MC.LT_CS * BLK));
  return bi < 0 || bj < 0 || bi >= w.nb || bj >= w.nb ? 1 : w.lit[bj * w.nb + bi];
}
// The balls in within r of (x, z) but slot.
function rivals(w, x, z, r, slot) {
  const out = [];
  for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
    for (const b of w.balls.get(i * 4096 + j) || []) if (b.slot !== slot && Math.hypot(b.x - x, b.z - z) < r) out.push(b);
  }
  return out;
}

// The open floor it heads for: of the 4 m blocks within 20 m whose middle
// will still be floor 3 s on, the darkest, nearer and fewer rivals better.
// Kept half a second.
function openFloor(view, st, w, g, bot, x, z, T) {
  const mem = bot?.mem || {};
  if (mem.lt && T - mem.lt.at < 62 && T >= mem.lt.at) return mem.lt.goal;
  const bs = MC.LT_CS * BLK, h = halfAt(st, T + 375) - 2, cx = st.cx;
  let best = null, score = Infinity;
  const bi0 = Math.floor((x - 20 - st.x0) / bs), bi1 = Math.floor((x + 20 - st.x0) / bs);
  const bj0 = Math.floor((z - 20 - st.x0) / bs), bj1 = Math.floor((z + 20 - st.x0) / bs);
  for (let bj = Math.max(0, bj0); bj <= Math.min(w.nb - 1, bj1); bj++) for (let bi = Math.max(0, bi0); bi <= Math.min(w.nb - 1, bi1); bi++) {
    const mx = st.x0 + (bi + 0.5) * bs, mz = st.x0 + (bj + 0.5) * bs;
    if (Math.abs(mx - cx) > h || Math.abs(mz - cx) > h) continue;
    const d = Math.hypot(mx - x, mz - z);
    if (d > 20) continue;
    const edge = h - Math.max(Math.abs(mx - cx), Math.abs(mz - cx));
    const s = 8 * w.lit[bj * w.nb + bi] + d / 12 + 1.5 * rivals(w, mx, mz, 4, bot?.slot ?? -1).length + 3 * Math.max(0, 1 - edge / 8) + (bot?.rand ? (bot.rand() - 0.5) * 0.6 : 0);
    if (s < score) { score = s; best = [mx, mz]; }
  }
  if (!best) best = [cx, cx];
  mem.lt = { at: T, goal: best };
  return best;
}

// Ball me's word for tick t, for its brain's think: 16 headings, the way it
// rolls and the way to open floor, each rolled ahead in closed form (bumper's
// v = wish * push + v * drag a tick, with the round's knobs) and sampled
// through the grid on the tick it would be there, every 3 ticks to 0.6 s and
// every 6 on to 1 to 1.6 s (its skill): the first hard cell or the edge ends
// the path. A path clear for 0.6 s is safe; past that, a longer one is out of
// a pocket. Then dark floor at its end, the way to open floor, the way it
// steered last (a ball swinging from side to side stops, and a stopped
// ball's own light hardens under it) and room from the rivals. When every
// way it can roll meets a wall within a second, a hop along its line, if
// that goes further before it comes down on one (or rolls on into one).
const HEADS = 16;
const SAFE = 75; // ticks clear that make a path safe
const SOON = 50; // ticks after it gets there a cell must stay soft (riding a soft trail ends in a wall)
const CROSS = 12; // and for the next 0.16 s, the ticks it takes to cross one
const COS = Float64Array.from({ length: HEADS }, (_, k) => Math.cos((2 * Math.PI * k) / HEADS));
const SIN = Float64Array.from({ length: HEADS }, (_, k) => Math.sin((2 * Math.PI * k) / HEADS));
const KS = [];
for (let k = 3; k <= SAFE; k += 3) KS.push(k);
for (let k = SAFE + 6; k <= 200; k += 6) KS.push(k);
const PX = new Float64Array(KS.length), PZ = new Float64Array(KS.length), PKS = new Float64Array(KS.length), HALF = new Float64Array(KS.length);
export function plan(view, me, bot, t) {
  const g = view.party();
  if (g.state !== L.H_PLAY || !me?.live || me.out) return null;
  const st = stage(view);
  if (!(st.half0 > 0) || !(st.side > 0)) return null;
  const T0 = (t - g.start) | 0;
  const w = world(view, st, g);
  const cells = grid(view), n = st.side, cx = st.cx;
  const px = bot?.pos?.[0] ?? me.pos[0], pz = bot?.pos?.[1] ?? me.pos[2];
  const vx = bot?.vel?.[0] ?? me.vel[0], vz = bot?.vel?.[1] ?? me.vel[2];
  const ground = me.ground && !me.falling;
  const acc = (ground ? ACC : AIR) * g.acc, d = ground ? g.drag : AIR_DRAG;
  const skill = bot?.skill ?? 0.6;
  const rand = () => (bot?.rand ? bot.rand() : 0.5);
  const far = Math.round((1 + 0.6 * skill) / TICK);
  let NS = 0;
  while (NS < KS.length && KS[NS] <= far) {
    const k = KS[NS];
    const s = Math.abs(1 - d) < 1e-7 ? k : (d * (1 - d ** k)) / (1 - d);
    PX[NS] = px + TICK * vx * s; PZ[NS] = pz + TICK * vz * s;
    PKS[NS] = Math.abs(1 - d) < 1e-7 ? TICK * acc * k * (k + 1) / 2 : (TICK * acc * (k - s)) / (1 - d);
    HALF[NS] = halfAt(st, T0 + k) - 0.6;
    NS++;
  }
  const KF = KS[NS - 1];
  const goal = openFloor(view, st, w, g, bot, px, pz, T0);
  const ga = Math.atan2(goal[1] - pz, goal[0] - px);
  const sp = Math.hypot(vx, vz), va = sp > 0.5 ? Math.atan2(vz, vx) : ga;
  const near = rivals(w, px, pz, sp * 0.6 + 6, me.slot ?? bot?.slot ?? -1);
  const mem = bot?.mem || {};
  const last = typeof mem.ltYaw === 'number' ? mem.ltYaw : va;
  const JR = [Math.min(NS - 1, 3), Math.min(NS - 1, 7), Math.min(NS - 1, 15)]; // 0.1, 0.19 and 0.38 s out: where it may meet a rival
  let best = -Infinity, pick = va, pickFree = 0;
  for (let h = 0; h <= HEADS + 1; h++) {
    const a = h < HEADS ? (2 * Math.PI * h) / HEADS : h === HEADS ? va : ga;
    const ca = h < HEADS ? COS[h] : Math.cos(a), sa = h < HEADS ? SIN[h] : Math.sin(a);
    const side = Math.abs(ca) > Math.abs(sa) ? n : 1; // the cells beside its line
    let free = KF, close = 0, crowd = 0, ex = px, ez = pz;
    for (let j = 0; j < NS; j++) {
      const x = PX[j] + ca * PKS[j], z = PZ[j] + sa * PKS[j];
      const k = KS[j];
      if (Math.abs(x - cx) > HALF[j] || Math.abs(z - cx) > HALF[j]) { free = k; break; }
      const i = Math.floor((x - st.x0) / MC.LT_CS), jj = Math.floor((z - st.x0) / MC.LT_CS);
      if (i < 0 || jj < 0 || i >= n || jj >= n) { free = k; break; }
      const c = jj * n + i, T = T0 + k;
      if (stateOf(cells[c], T + (k > 20 ? SOON : CROSS)) === 2) { free = k; break; }
      if (k <= SAFE && (stateOf(cells[c + side], T) === 2 || stateOf(cells[c - side], T) === 2)) close++;
      ex = x; ez = z;
    }
    for (const b of near) {
      for (const j of JR) {
        if (KS[j] >= free) break;
        const s = KS[j] * TICK * 0.7;
        if (Math.hypot(PX[j] + ca * PKS[j] - b.x - b.vx * s, PZ[j] + sa * PKS[j] - b.z - b.vz * s) < 2.9) crowd++;
      }
    }
    let score = 10 * Math.min(1, free / SAFE) + 4 * (free / KF) - 0.1 * close - 1.2 * crowd
      + 0.8 * Math.cos(a - ga) + (sp > 1 ? 0.5 * Math.cos(a - va) : 0) + 2 * Math.cos(a - last);
    if (free >= KF) score += 2 * (1 - litAt(st, w, ex, ez));
    score += (rand() - 0.5) * 1.6 * (1 - skill);
    if (score > best) { best = score; pick = a; pickFree = free; }
  }
  // a wall within a second whichever way it rolls: a hop, if that goes well further
  let hop = false;
  if (ground && g.hop > 0 && sp > 1.5 && pickFree < 120 && rand() < 0.5 + 0.5 * skill) {
    const hf = hopFree(st, cells, T0, px, pz, vx, vz, g.hop, cx, KF);
    hop = hf > pickFree + 40 || (pickFree < 56 && hf > pickFree + 24);
  }
  mem.ltYaw = hop ? va : pick;
  return { yaw: hop ? va : pick, move: 1, hop, free: pickFree };
}

// A hop now, along (vx, vz): the ticks until its centre is over a hard cell
// with its bottom under LT_WALL (taking off, coming down, rolling on), or
// off the floor once it's down; at most kf.
export function hopFree(st, cells, T0, px, pz, vx, vz, hop, cx, kf) {
  const land = (2 * hop) / HOP_G;
  for (let k = 1; k <= kf; k += 2) {
    const s = k * TICK, y = s < land ? hop * s - (HOP_G / 2) * s * s : 0;
    const x = px + vx * s, z = pz + vz * s, T = T0 + k;
    if (s >= land && (Math.abs(x - cx) > halfAt(st, T) - 0.6 || Math.abs(z - cx) > halfAt(st, T) - 0.6)) return k;
    if (y >= MC.LT_WALL) continue;
    const c = cellAt(st, x, z);
    if (c < 0 || stateOf(cells[c], T + CROSS) === 2) return k;
  }
  return kf;
}

export default {
  id: L.MG_TRAILS, key: 'trails', name: 'LIGHT TRAILS',
  hint: 'YOUR TRAIL HARDENS INTO A WALL  HIT ONE AND YOU ARE OUT  HOP OVER',
  env: 'night',

  draw(view, ctx, out) {
    const st = stage(view);
    if (!(st.half0 > 0) || !(st.side > 0)) return;
    const g = view.party();
    const sc = out.scene, cx = st.cx;
    const now = (ctx?.now ?? 0) / 1000;
    const tp = playTime(view, g, ctx, true);
    const T = Math.max(0, tp);
    const h = halfAt(st, T);
    const me = ctx?.slot ?? -1;
    // the floor, dark, the trails its paint
    sc.box(cx, PLAT_Y - FT / 2, cx, h, FT / 2, h, 0, 0.035, 0.04, 0.07, LOOK.PAINT, 0, 0, 1, 7);
    const own = tp >= 0 && g.state === L.H_PLAY ? ownTrack(view, st, me, ctx) : { cells: [], crash: null };
    out.paint = paintLayer(view, st, T, me, own.cells);
    // a faint grid every LINES m from the centre, out to the edge
    for (let k = -Math.floor(h / LINES); k <= Math.floor(h / LINES); k++) {
      const u = cx + k * LINES;
      sc.box(u, PLAT_Y + 0.004, cx, 0.025, 0.004, h, 0, 0.25, 0.42, 0.75, LOOK.GLOW, 0.35, 0, 1, 11);
      sc.box(cx, PLAT_Y + 0.004, u, h, 0.004, 0.025, 0, 0.25, 0.42, 0.75, LOOK.GLOW, 0.35, 0, 1, 13);
    }
    // the rim, lit; quick to pulse while the edges close in
    const closing = T > MC.LT_CLOSE0 && T < MC.LT_CLOSE1;
    const rim = closing ? 1.2 + 0.8 * (0.5 + 0.5 * Math.sin(now * 7)) : 1.2;
    const rc = closing ? [1, 0.55, 0.25] : [0.45, 0.85, 1];
    for (const [ox, oz, hx, hz] of [[0, -h, h + 0.12, 0.12], [0, h, h + 0.12, 0.12], [-h, 0, 0.12, h], [h, 0, 0.12, h]]) {
      sc.box(cx + ox, PLAT_Y + 0.05, cx + oz, hx, 0.06, hz, 0, rc[0], rc[1], rc[2], LOOK.GLOW, rim, 0.3);
    }
    // the floor's underside, a dark slab with a lit seam where it was
    sc.box(cx, PLAT_Y - FT - 1.5, cx, h * 0.96, 1.5, h * 0.96, 0, 0.03, 0.035, 0.05, LOOK.METAL);
    if (tp < 0) return;
    // the walls near the focus: your ball (or the one you watch), else the camera
    const foc = ctx?.pme && !ctx.pme.out ? ctx.pme.pos : ctx?.me && !ctx.me.out ? ctx.me.pos : ctx?.cam;
    if (foc) walls(sc, st, grid(view), T, foc[0], foc[2], WALLS, me);
    // your crash on the prediction's track, at once
    if (own.crash) {
      const [x, y, z] = own.crash.pos;
      out.glow?.push({ pos: [x, y + 1, z], size: 3.2 + 0.4 * Math.sin(now * 30), color: [1, 1, 1, 0.9], kind: SPRITE.FLASH });
      out.decals?.push({ pos: [x, PLAT_Y + 0.03, z], radius: 1.6, width: 0.3, color: [1, 0.35, 0.3, 0.9], kind: DECAL.RING });
    }
  },

  frame(view) {
    const st = stage(view), g = view.party();
    const h = st.half0 > 0 ? halfAt(st, g.state === L.H_PLAY ? g.t : 0) : g.size;
    return { centre: [st.cx || g.cx, PLAT_Y, st.cx || g.cx], radius: h, shape: 'square' };
  },

  // out from the middle, so the round opens like a flower
  facing(view, slot) {
    const b = view.partier(slot), cx = view.party().cx;
    const dx = b.pos[0] - cx, dz = b.pos[2] - cx;
    return Math.hypot(dx, dz) > 0.5 ? Math.atan2(dz, dx) : 0;
  },

  fx(f, ctx) {
    const d = typeof ctx.dist === 'function' ? ctx.dist(f.pos) : ctx.dist ?? 0;
    if (f.kind === MC.LT_FX_CRASH) {
      const col = lightColor(f.shot & 255);
      ctx.glow?.({ pos: [f.pos[0], f.pos[1] + 1, f.pos[2]], size: 4.5, color: [...col, 1], kind: SPRITE.FLASH, life: 450, grow: true });
      ctx.glow?.({ pos: [f.pos[0], f.pos[1] + 0.3, f.pos[2]], size: 5, color: [...col, 0.9], kind: SPRITE.RING, life: 700, grow: true });
      if (f.owner === ctx.slot || d < 40) ctx.sound?.blast?.(f.owner === ctx.slot ? 0 : d, 3);
      if (f.owner === ctx.slot) ctx.banner?.(f.shot === f.owner ? 'YOU HIT YOUR OWN LIGHT' : `YOU HIT P${f.shot + 1}'S LIGHT`, C.RED, 2500);
      else if (f.shot === ctx.slot) { ctx.banner?.(`P${f.owner + 1} HIT YOUR LIGHT`, C.GREEN, 2000); ctx.sound?.kill?.(); }
    } else if (f.kind === MC.LT_FX_CLOSE) {
      ctx.banner?.('THE EDGES CLOSE IN', C.ORANGE, 2500);
      ctx.sound?.count?.(0);
    }
  },

  // the feed: who hit whose light (and who bumped them into it)
  sink(f, name, view) {
    const m = view.partier(f.owner).m;
    if (!m) return null;
    const q = m - 1, who = name(f.owner);
    const whose = q === f.owner ? (who === 'YOU' ? 'YOUR OWN' : 'ITS OWN') : name(q) === 'YOU' ? 'YOUR' : `${name(q)}'S`;
    const by = f.shot !== 255 && f.shot !== q ? `  BUMPED BY ${name(f.shot)}` : '';
    return `${who} HIT ${whose} LIGHT${by}`;
  },

  // how long light lasts now, where the edges are, and a warning when you slow
  hud(view, ctx) {
    const g = view.party();
    if (g.state !== L.H_PLAY) return;
    const st = stage(view);
    if (!(st.half0 > 0)) return;
    const t = typeof ctx.t === 'number' && ctx.t > 0 ? ctx.t / TICK : g.t;
    ctx.right(2, `LIGHT LASTS ${(lifeOf(t) * TICK).toFixed(1)} S`, C.CYAN);
    const h = halfAt(st, t);
    if (t < MC.LT_CLOSE0) ctx.right(3, `EDGES CLOSE IN ${Math.ceil((MC.LT_CLOSE0 - t) * TICK)} S`, C.GREY);
    else ctx.right(3, `FLOOR ${Math.round(2 * h)} M${t < MC.LT_CLOSE1 ? '  CLOSING' : ''}`, t < MC.LT_CLOSE1 ? C.ORANGE : C.GREY);
    const me = ctx.me ?? (ctx.slot >= 0 ? view.partier(ctx.slot) : null);
    if (me && me.live && !me.out && t > 60 && Math.hypot(me.vel[0], me.vel[2]) < 2) ctx.centre(5, 'KEEP ROLLING  YOUR OWN LIGHT HARDENS UNDER YOU', C.RED);
  },

  brain: {
    // a hard cell or past the edge on that tick is a crash; beside one, a risk
    danger(view, x, z, tick) {
      const st = stage(view);
      if (!(st.side > 0)) return 0;
      const g = view.party(), T = (tick - g.start) | 0;
      const h = halfAt(st, T);
      if (Math.abs(x - st.cx) > h - 0.6 || Math.abs(z - st.cx) > h - 0.6) return 1;
      const c = cellAt(st, x, z);
      if (c < 0) return 1;
      const cells = grid(view);
      if (stateOf(cells[c], T) === 2) return 1;
      return stateOf(cells[c + 1], T) === 2 || stateOf(cells[c - 1], T) === 2 || stateOf(cells[c + st.side], T) === 2 || stateOf(cells[c - st.side], T) === 2 ? 0.4 : 0;
    },
    // the darkest floor near, where nobody is
    goal(view, me, bot) {
      const g = view.party(), st = stage(view);
      if (!(st.side > 0) || !me?.live || me.out) return null;
      return openFloor(view, st, world(view, st, g), g, bot, bot?.pos?.[0] ?? me.pos[0], bot?.pos?.[1] ?? me.pos[2], g.t);
    },
    // the whole word: its own look through the grid (plan), the hop with it
    think(view, me, bot, t) {
      const p = plan(view, me, bot, t);
      return p && { yaw: p.yaw, move: 1, hop: p.hop ? 1 : 0 };
    },
    // (think says when to hop)
    hop() { return false; },
  },
};
