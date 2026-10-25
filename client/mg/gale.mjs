// GALE FORCE, as drawn and as the AI ball sees it. The course is read
// straight from the sim (src/mg/gale.mjs's layout: pieces and hazards in
// PG_S) and built once into a list of solids: bridges in bands of their
// section's colours with white kerbs, wooden decks, stairs step by step, the
// upper deck in sky blue, pillars down to the sea, the tunnels' glass walls
// and hoops, the windmills' gantries, the fans' poles and housings, the
// vents' grilles, a start gate and a finish arch over a checkered pen. Each
// frame the moving parts go in as they stand on the prediction's clock (a
// fan's blades, its light, its gust zone on the floor and the streaks of wind
// across the bridge; a windmill's blades; a vent's column), so what you dodge
// is where the sim has it. The schedules are worked again here in doubles:
// the brain steers by them, nothing is fed back.
import * as L from '../../src/layout.mjs';
import * as MC from '../../src/mg/gale.mjs'; // GF_*: the minigame's own constants
import { LOOK, SPRITE, COLS, DECAL } from '../party-render.mjs';
import { C } from '../font.mjs';

const TICK = 0.008;
const TURN = 16384;
const RAD = (2 * Math.PI) / TURN;
const SLAB = 0.6; // a bridge's slab's half height
const BAND = 4; // m of bridge a colour
const SEA = -12; // where the pillars stand
const KERB = 0.3;
const P_STEP = Number(L.P_STEP);

// Each section's two tones, a band each.
const TONE = {
  [MC.GF_S_START]: [[0.92, 0.92, 0.94], [0.8, 0.82, 0.86]],
  [MC.GF_S_DECK]: [[0.72, 0.52, 0.32], [0.66, 0.47, 0.29]],
  [MC.GF_S_FANS]: [[0.25, 0.62, 0.95], [0.2, 0.54, 0.86]],
  [MC.GF_S_MILL]: [[0.98, 0.66, 0.22], [0.92, 0.57, 0.18]],
  [MC.GF_S_TUNNEL]: [[0.55, 0.35, 0.85], [0.48, 0.3, 0.77]],
  [MC.GF_S_STAIRS]: [[0.95, 0.85, 0.3], [0.88, 0.76, 0.24]],
  [MC.GF_S_GAPS]: [[0.95, 0.42, 0.5], [0.87, 0.35, 0.44]],
  [MC.GF_S_VENT]: [[0.25, 0.78, 0.6], [0.2, 0.69, 0.52]],
  [MC.GF_S_FINISH]: [[0.92, 0.92, 0.94], [0.8, 0.82, 0.86]],
};
export const SECTION = ['START', 'DECK', 'FANS', 'WINDMILLS', 'HEADWIND', 'STAIRS', 'GAPS', 'UPDRAFT', 'FINISH'];

const pa = (k) => L.PG_S + MC.GF_PIECES + k * MC.GF_PSIZE;
const ha = (j) => L.PG_S + MC.GF_HAZ + j * MC.GF_HSIZE;

// ---- the course, read once a layout

let memo = null;
// This round's course as the confirmed world has it: its pieces, the main way (in order along x), the upper
// decks, the hazards; or null.
export function course(view) {
  if (memo && view._gfTick === view.tick && view._gfMemo === memo) return memo;
  const dv = view.dv;
  const np = dv.getUint32(L.PG_H + MC.GF_NPIECE, true), nh = dv.getUint32(L.PG_H + MC.GF_NHAZ, true);
  if (!np || np > MC.GF_NP || nh > MC.GF_NH) return null;
  const f = (a) => dv.getFloat32(a, true), u = (a) => dv.getUint32(a, true), i = (a) => dv.getInt32(a, true);
  const key = `${np} ${nh} ${f(L.PG_H + MC.GF_X0)} ${f(L.PG_H + MC.GF_FIN)} ${f(L.PG_H + MC.GF_W)} ${f(pa(np - 1) + MC.GF_P_Z)} ${u(L.HDR_SEED)} ${u(L.HDR_HOLE)}`;
  view._gfTick = view.tick;
  if (memo?.key === key) { view._gfMemo = memo; return memo; }
  const pieces = [];
  for (let k = 0; k < np; k++) {
    const a = pa(k);
    const P = { k, fl: u(a + MC.GF_P_FL), sec: u(a + MC.GF_P_SEC), x0: f(a + MC.GF_P_X0), x1: f(a + MC.GF_P_X1), z: f(a + MC.GF_P_Z), w: f(a + MC.GF_P_W),
      h: f(a + MC.GF_P_H), sh: f(a + MC.GF_P_SH), sl: f(a + MC.GF_P_SL), ns: u(a + MC.GF_P_NS) };
    P.len = P.x1 - P.x0;
    pieces.push(P);
  }
  const main = pieces.filter((P) => !(P.fl & MC.GF_F_UPPER));
  main.forEach((P, m) => { P.m = m; });
  const upper = pieces.filter((P) => P.fl & MC.GF_F_UPPER);
  const hazards = [];
  for (let j = 0; j < nh; j++) {
    const a = ha(j);
    const H = { j, kind: u(a + MC.GF_H_KIND), x: f(a + MC.GF_H_X), z: f(a + MC.GF_H_Z), y: f(a + MC.GF_H_Y), l: f(a + MC.GF_H_L), w: f(a + MC.GF_H_W),
      per: i(a + MC.GF_H_PER), ph: i(a + MC.GF_H_PH), dir: i(a + MC.GF_H_DIR), on: i(a + MC.GF_H_ON), hit: -1e9, spin: (j * 1.7) % 6.28 };
    H.piece = main.find((P) => H.x >= P.x0 && H.x < P.x1) || main[0];
    hazards.push(H);
  }
  let z0 = Infinity, z1 = -Infinity, top = -Infinity;
  for (const P of pieces) { z0 = Math.min(z0, P.z - P.w); z1 = Math.max(z1, P.z + P.w); top = Math.max(top, P.h, floorAt(P, P.x1)); }
  const x0 = pieces[0].x0, x1 = main.at(-1).x1;
  // the hazards by 8 m of x they reach into, for the brain's thousands of questions a tick
  const buckets = [];
  for (const H of hazards) {
    const reach = H.kind === MC.GF_HZ_MILL ? 2 : H.l + 1;
    for (let b = Math.floor((H.x - reach - x0) / 8); b <= Math.floor((H.x + reach - x0) / 8); b++) (buckets[b] ||= []).push(H);
  }
  memo = {
    key, pieces, main, upper, hazards, buckets, x0line: f(L.PG_H + MC.GF_X0), fin: f(L.PG_H + MC.GF_FIN), w: f(L.PG_H + MC.GF_W), wd: f(L.PG_H + MC.GF_WD),
    floor: f(L.PG_FLOOR), top, box: [x0, z0, x1, z1], end: x1, geom: null, last: 0,
  };
  memo.checks = main.filter((P) => P.fl & MC.GF_F_CHECK);
  view._gfMemo = memo;
  return memo;
}

// The hazards that reach x.
const near = (c, x) => c.buckets[Math.floor((x - c.box[0]) / 8)] || [];

// Piece P's floor at x ($gf_floor).
export const floorAt = (P, x) => (P.sl > 0 ? P.h + Math.max(0, Math.min(P.ns - 1, Math.trunc((x - P.x0) / P.sl))) * P.sh : P.h);

// The main way's piece over x, or null before its start or past its end.
export function mainAt(c, x) {
  const ms = c.main;
  let k = Math.min(c.last, ms.length - 1);
  if (!(x >= ms[k].x0 && x < ms[k].x1)) {
    k = -1;
    for (let lo = 0, hi = ms.length - 1; lo <= hi;) {
      const m = (lo + hi) >> 1;
      if (x < ms[m].x0) hi = m - 1; else if (x >= ms[m].x1) lo = m + 1; else { k = m; break; }
    }
    if (k < 0) return null;
    c.last = k;
  }
  return ms[k];
}

// The main way's floor at x ($gf_mainh).
export function mainh(c, x) {
  const P = mainAt(c, x) ?? (x < c.main[0].x0 ? c.main[0] : c.main.at(-1));
  return floorAt(P, x);
}

// $gf_under: the piece with the highest floor under (x, z) no higher than y, and that floor; null off the course.
export function under(c, x, y, z) {
  let best = null, top = -1000;
  for (const P of c.pieces) {
    if (x < P.x0 || x >= P.x1 || Math.abs(z - P.z) > P.w || (P.fl & MC.GF_F_GAP)) continue;
    const h = floorAt(P, x);
    if (h <= y && h > top) { top = h; best = P; }
  }
  return best ? { P: best, h: top } : null;
}

// The piece holding (x, z) on the level of a ball whose bottom is at y: an upper deck it's up on, else the main way's; null off the course.
export function pieceAt(c, x, z, y) {
  for (const P of c.upper) if (x >= P.x0 && x < P.x1 && Math.abs(z - P.z) <= P.w && y > P.h - 1.5) return P;
  const P = mainAt(c, x);
  return P && Math.abs(z - P.z) <= P.w ? P : null;
}

// ---- the clock (t: ticks into play)

// (in f32, as the sim works them, so a gust starts and ends on the tick it does there)
const f32 = Math.fround;
const phase = (H, t) => (((Math.floor(t) + H.ph) % H.per) + H.per) % H.per;
const ramp = (t, o) => Math.max(0, Math.min(1, f32((Math.floor(t) - o) / MC.GF_RAMP)));
// $gf_fan_a: fan H's push on tick t, m/s^2, 0 when it's still.
export function fanA(H, t) {
  const o = phase(H, t), f = ramp(t, o);
  return o < MC.GF_FAN_D0 + Math.trunc(f32(f * (MC.GF_FAN_D1 - MC.GF_FAN_D0))) ? f32(f32(f * (MC.GF_FAN_A1 - MC.GF_FAN_A0)) + MC.GF_FAN_A0) : 0;
}
// Ticks until fan H next blows (0 while it does).
export const fanNext = (H, t) => (fanA(H, t) > 0 ? 0 : H.per - phase(H, t));
// Its light: it warns GF_WARN ahead.
export const fanWarn = (H, t) => fanA(H, t) === 0 && fanNext(H, t) <= MC.GF_WARN;
// $gf_tun_a: tunnel H's push against the way on.
export function tunA(H, t) {
  const o = phase(H, t);
  return o < MC.GF_TUN_D ? f32(MC.GF_TUN_A0 + f32(f32(ramp(t, o) * (MC.GF_TUN_G1 - MC.GF_TUN_G0)) + MC.GF_TUN_G0)) : MC.GF_TUN_A0;
}
// $gf_vent_on, and the ticks until vent H next blows (0 while it does) and until it stops (0 while it doesn't).
export const ventOn = (H, t) => phase(H, t) < H.on;
export const ventNext = (H, t) => (ventOn(H, t) ? 0 : H.per - phase(H, t));
export const ventLeft = (H, t) => (ventOn(H, t) ? H.on - phase(H, t) : 0);
// A windmill's angle on (fractional) tick t: blade b is this plus b quarter turns, from +z toward +y.
export const millAngle = (H, t) => (H.ph + H.per * t) * RAD;
// How far (z, yc) in mill H's plane (yc a ball's middle) is from its nearest blade on tick t, less a ball's radius and
// the blade's half thickness: under 0, a hit.
export function bladeGap(H, z, yc, t, r = 1) {
  const a0 = millAngle(H, t), hy = H.y + H.w, qz = z - H.z, qy = yc - hy;
  let best = Infinity;
  for (let b = 0; b < MC.GF_MILL_NB; b++) {
    const a = a0 + (b * 2 * Math.PI) / MC.GF_MILL_NB, ez = Math.cos(a), ey = Math.sin(a);
    const tt = Math.max(0, Math.min(H.l, qz * ez + qy * ey));
    best = Math.min(best, Math.hypot(qz - ez * tt, qy - ey * tt));
  }
  return best - r - MC.GF_MILL_T;
}

// Ticks into play to draw at (fractional): the prediction's clock, frozen through the result.
function playTime(view, ctx) {
  const g = view.party();
  if (g.state !== L.H_PLAY && g.state !== L.H_OVER) return 0;
  let t = ctx?.ptick !== undefined ? ctx.ptick - g.start : g.t + (ctx?.dt || 0) / TICK;
  if (g.state === L.H_OVER) t = Math.min(t, (g.until - L.P_OVER - g.start) | 0);
  return Math.max(0, t);
}

// Where fan H stands: beside its bridge, on the side it blows from.
const fanPos = (H) => [H.x, H.y + 2.4, H.z - H.dir * (H.w - 1 + MC.GF_FAN_OUT + 0.4)];

// ---- the solids that never move, built once a course

function build(c) {
  const out = []; // [shape, x, y, z, hx, hy, hz, yaw, r, g, b, look, a, b2, alpha, roll]
  const box = (x, y, z, hx, hy, hz, rgb, look = LOOK.PLASTIC, a = 0, b = 0, alpha = 1, yaw = 0, roll = 0) => out.push([0, x, y, z, hx, hy, hz, yaw, ...rgb, look, a, b, alpha, roll]);
  const cyl = (x, y, z, r, hh, rgb, look = LOOK.MATTE, a = 0, b = 0, alpha = 1, roll = 0) => out.push([1, x, y, z, r, hh, r, 0, ...rgb, look, a, b, alpha, roll]);
  const pillar = (x, z, top, r) => cyl(x, (top + SEA) / 2, z, r, (top - SEA) / 2, [0.86, 0.85, 0.82], LOOK.MATTE);
  const mills = c.hazards.filter((H) => H.kind === MC.GF_HZ_MILL);
  let band = 0;
  for (const P of c.pieces) {
    const tones = TONE[P.sec] || TONE[MC.GF_S_FANS];
    const deck = P.fl & MC.GF_F_DECK, upper = P.fl & MC.GF_F_UPPER, pen = P.fl & MC.GF_F_PEN, start = P.fl & MC.GF_F_START;
    if (P.fl & MC.GF_F_GAP) continue;
    if (P.sl > 0) {
      // stairs: a block a step, each down to the slab's depth under the lower of it and its neighbour
      for (let s = 0; s < P.ns; s++) {
        const h = P.h + s * P.sh, lo = Math.min(h, h - P.sh) - 2 * SLAB;
        box(P.x0 + (s + 0.5) * P.sl, (h + lo) / 2, P.z, P.sl / 2 + 0.01, (h - lo) / 2, P.w, tones[s & 1], LOOK.PLASTIC);
        box(P.x0 + (s + 1) * P.sl - 0.08, h + 0.02, P.z, 0.08, 0.03, P.w - 0.05, [1, 1, 1], LOOK.GLOW, 0.4, 0, 0.8);
      }
    } else if (upper) {
      box(P.x0 + P.len / 2, P.h - MC.GF_THICK / 2, P.z, P.len / 2, MC.GF_THICK / 2, P.w, [0.55, 0.82, 1], LOOK.PLASTIC);
      for (const s of [1, -1]) box(P.x0 + P.len / 2, P.h + 0.04, P.z + s * (P.w - 0.15), P.len / 2, 0.05, 0.15, [0.6, 0.95, 1], LOOK.GLOW, 0.9, 0.5);
      box(P.x1 - 0.15, P.h + 0.04, P.z, 0.15, 0.05, P.w, [1, 0.85, 0.3], LOOK.GLOW, 0.9, 0.5);
    } else if (deck) {
      box(P.x0 + P.len / 2, P.h - SLAB, P.z, P.len / 2, SLAB, P.w, tones[0], LOOK.WOOD, 0.4);
    } else if (start || pen) {
      box(P.x0 + P.len / 2, P.h - SLAB, P.z, P.len / 2, SLAB, P.w, tones[0], LOOK.CHECKER, 2, 0.35);
    } else {
      // a bridge in bands, a slot across it under each windmill for its blades
      const cuts = mills.filter((H) => H.x >= P.x0 && H.x < P.x1).map((H) => H.x).sort((a, b) => a - b);
      const n = Math.max(1, Math.round(P.len / BAND));
      for (let s = 0; s < n; s++) {
        let a = P.x0 + (s * P.len) / n, b = P.x0 + ((s + 1) * P.len) / n;
        const tone = tones[band++ & 1];
        for (const x of cuts) {
          if (x - 0.75 > a && x - 0.75 < b) { box((a + x - 0.75) / 2, P.h - SLAB, P.z, (x - 0.75 - a) / 2 + 0.01, SLAB, P.w - KERB, tone); a = x + 0.75; }
          else if (x + 0.75 > a && x - 0.75 <= a) a = x + 0.75;
        }
        if (b > a) box((a + b) / 2, P.h - SLAB, P.z, (b - a) / 2 + 0.01, SLAB, P.w - KERB, tone);
      }
      for (const x of cuts) box(x, P.h - 2 * SLAB + 0.1, P.z, 0.75, 0.1, P.w, [0.12, 0.12, 0.14], LOOK.METAL);
      // the kerbs
      for (const s of [1, -1]) box(P.x0 + P.len / 2, P.h - SLAB + 0.03, P.z + s * (P.w - KERB / 2), P.len / 2, SLAB, KERB / 2, [0.96, 0.96, 0.96], LOOK.PLASTIC);
    }
    // walls: the start pad's back and sides, a tunnel's sides (with hoops), the pen's sides and far end
    const wallH = MC.GF_WALL;
    if (start || pen || (P.fl & MC.GF_F_WALLS)) {
      const glass = pen ? [0.75, 0.88, 1] : P.fl & MC.GF_F_WALLS ? [0.8, 0.7, 1] : [0.96, 0.96, 0.98];
      for (const s of [1, -1]) box(P.x0 + P.len / 2, P.h + wallH / 2, P.z + s * (P.w + 0.15), P.len / 2, wallH / 2, 0.15, glass, LOOK.GLOW, 0.25, 0, 0.45);
      if (start) box(P.x0 - 0.15, P.h + wallH / 2, P.z, 0.15, wallH / 2, P.w + 0.3, glass, LOOK.GLOW, 0.25, 0, 0.45);
      if (pen) box(P.x1 + 0.15, P.h + wallH / 2, P.z, 0.15, wallH / 2, P.w + 0.3, glass, LOOK.GLOW, 0.25, 0, 0.45);
      if (P.fl & MC.GF_F_WALLS) {
        for (let x = P.x0 + 1; x < P.x1; x += 4) {
          for (const s of [1, -1]) box(x, P.h + wallH / 2 + 0.6, P.z + s * (P.w + 0.35), 0.25, wallH / 2 + 0.6, 0.2, [0.45, 0.3, 0.75], LOOK.PLASTIC);
          box(x, P.h + wallH + 1.3, P.z, 0.25, 0.2, P.w + 0.55, [0.45, 0.3, 0.75], LOOK.PLASTIC);
        }
      }
    }
    // pillars down to the sea (none under an upper deck: it floats over the bridge it short cuts)
    if (!upper) {
      const legs = Math.max(1, Math.round(P.len / 24));
      for (let s = 0; s < legs; s++) pillar(P.x0 + ((s + 0.5) * P.len) / legs, P.z, Math.min(P.h, floorAt(P, P.x1)) - 2 * SLAB, Math.min(2.2, 0.7 + P.w * 0.1));
    }
    // a deck is a checkpoint: a line across where it starts and a flag each side
    if (deck) {
      box(P.x0 + 0.4, P.h + 0.02, P.z, 0.12, 0.03, P.w - 0.2, [1, 1, 1], LOOK.GLOW, 0.5, 0, 0.8);
      for (const s of [1, -1]) {
        cyl(P.x0 + 0.4, P.h + 1.4, P.z + s * (P.w + 0.5), 0.09, 1.4, [0.9, 0.9, 0.9], LOOK.METAL);
        box(P.x0 + 0.85, P.h + 2.45, P.z + s * (P.w + 0.5), 0.45, 0.3, 0.03, [0.2, 0.85, 0.35], LOOK.PLASTIC);
      }
    }
  }
  // the fans' poles and housings, the windmills' gantries and hubs, the vents' grilles
  for (const H of c.hazards) {
    if (H.kind === MC.GF_HZ_FAN) {
      const [fx, fy, fz] = fanPos(H);
      cyl(fx, (fy + SEA) / 2, fz, 0.22, (fy - SEA) / 2, [0.5, 0.52, 0.56], LOOK.METAL);
      // a dark back plate in a striped rim, the blades in front of it (drawn as they turn)
      cyl(fx, fy, fz - H.dir * 0.3, 1.7, 0.1, [0.16, 0.17, 0.2], LOOK.METAL, 0, 0, 1, Math.PI / 2);
      cyl(fx, fy, fz - H.dir * 0.42, 1.95, 0.08, [1, 0.78, 0.1], LOOK.HAZARD, 0.4, 0, 1, Math.PI / 2);
      box(fx, fy + 1.97, fz - H.dir * 0.42, 0.3, 0.12, 0.25, [0.3, 0.32, 0.36], LOOK.METAL);
    } else if (H.kind === MC.GF_HZ_MILL) {
      const P = H.piece, hy = H.y + H.w, wz = Math.max(P.w + 0.9, 3);
      for (const s of [1, -1]) {
        box(H.x + 1.5, (hy + 1 + SEA) / 2, H.z + s * wz, 0.35, (hy + 1 - SEA) / 2, 0.35, [0.62, 0.42, 0.26], LOOK.WOOD);
      }
      box(H.x + 1.5, hy + 1, H.z, 0.4, 0.4, wz + 0.35, [0.62, 0.42, 0.26], LOOK.WOOD);
      box(H.x + 0.75, hy, H.z, 0.75, 0.22, 0.22, [0.4, 0.4, 0.44], LOOK.METAL);
      out.push([3, H.x, hy, H.z, 0.85, 0.85, 0.85, 0, 0.9, 0.2, 0.15, LOOK.PLASTIC, 0, 0, 1, 0]);
    } else if (H.kind === MC.GF_HZ_VENT) {
      cyl(H.x, H.y + 0.02, H.z, H.l + 0.25, 0.04, [0.18, 0.18, 0.2], LOOK.METAL);
      cyl(H.x, H.y + 0.05, H.z, H.l, 0.04, [0.55, 0.6, 0.62], LOOK.HAZARD, 0.35);
    }
  }
  // the finish arch over the line, the line on the floor
  const F = mainAt(c, c.fin + 0.01) || c.main.at(-1);
  for (const s of [1, -1]) cyl(c.fin, F.h + 3.5, F.z + s * (F.w + 0.9), 0.55, 3.5, [0.95, 0.95, 0.95], LOOK.PLASTIC);
  box(c.fin, F.h + 7.3, F.z, 0.5, 0.8, F.w + 1.4, [0.15, 0.15, 0.15], LOOK.CHECKER, 0.8);
  box(c.fin, F.h + 0.02, F.z, 0.3, 0.03, F.w, [0.1, 0.1, 0.1], LOOK.CHECKER, 0.3);
  // the start gate's frame
  const S = c.main[0];
  for (const s of [1, -1]) cyl(S.x1, S.h + 3.7, S.z + s * (S.w + 0.7), 0.45, 3.7, [0.2, 0.75, 0.3], LOOK.PLASTIC);
  box(S.x1, S.h + 7.4, S.z, 0.3, 0.3, S.w + 1.1, [0.2, 0.75, 0.3], LOOK.GLOW, 0.6, 0.5);
  return out;
}

// ---- the race: who is where

// Every ball in, its place in the race: home first by score, then by how far along (PG_M), ties by slot.
export function standings(view) {
  if (view._gf?.tick === view.tick) return view._gf.list;
  const list = [];
  for (let p = 0; p < L.NPLAYER; p++) {
    const a = L.PLAYERS + p * L.PSIZE;
    if (!(view.u8[a + L.P_FL] & L.PF_LIVE)) continue;
    const score = view.dv.getUint16(a + L.PG_SCORE, true), m = view.dv.getUint32(a + L.PG_M, true);
    list.push({ slot: p, score, home: score >= MC.GF_WIN, dist: m / 100 });
  }
  list.sort((a, b) => (b.home - a.home) || (a.home ? b.score - a.score : b.dist - a.dist) || a.slot - b.slot);
  list.forEach((e, i) => { e.rank = i > 0 && list[i - 1].home === e.home && (e.home ? list[i - 1].score === e.score : false) ? list[i - 1].rank : i + 1; });
  view._gf = { tick: view.tick, list };
  return list;
}
export const ordinal = (n) => `${n}${[, 'ST', 'ND', 'RD'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'TH'}`;

// ---- the AI ball

const ball = (view, me) => (typeof me === 'number' ? view.partier(me) : me);
// A number in [0, 1) for slot p and k, the same on every machine that asks.
const luck = (p, k) => (((Math.imul(p + 1, 0x9e3779b1) ^ Math.imul(k + 7, 0x85ebca6b)) >>> 0) % 10007) / 10007;

// How deadly (x, z) is on tick `tick` for a ball at me's height: off the course (a gap is the way on: think
// takes a ball over it), near a bare edge, in a fan's zone while it blows or is about to, where a blade will be.
function danger(view, x, z, tick, me) {
  const c = course(view);
  if (!c) return 0;
  const y = me?.pos?.[1] ?? c.top;
  const P = pieceAt(c, x, z, y);
  if (!P) {
    const M = mainAt(c, x);
    return M && (M.fl & MC.GF_F_GAP) && Math.abs(z - M.z) <= M.w ? 0 : 1;
  }
  let d = 0;
  if (!(P.fl & (MC.GF_F_START | MC.GF_F_PEN | MC.GF_F_WALLS))) {
    const edge = Math.abs(z - P.z) - P.w;
    if (edge > -0.6) d = 0.7;
    else if (edge > -1.8) d = 0.3 * (1.8 + edge) / 1.2;
  }
  const g = view.party();
  const tp = (tick - g.start) | 0;
  const h = floorAt(P, x);
  for (const H of near(c, x)) {
    if (Math.abs(H.y - h) > 2.5) continue;
    if (H.kind === MC.GF_HZ_FAN) {
      if (Math.abs(x - H.x) <= H.l + 1 && Math.abs(z - H.z) <= H.w && (fanA(H, tp) > 0 || fanNext(H, tp) < 30)) d = Math.max(d, 0.85);
    } else if (H.kind === MC.GF_HZ_MILL) {
      if (Math.abs(x - H.x) < 2 && bladeGap(H, z, h + 1, tp) < 0.4) d = Math.max(d, 0.95);
    }
  }
  return d;
}

// The vent it means to take, if any: within 18 m short of one on its way, blowing when it gets there and for
// 1.6 s after.
function ventFor(c, view, x, z, vx, tp, skill) {
  if (skill < 0.3) return null;
  let best = null;
  for (const H of c.hazards) {
    if (H.kind !== MC.GF_HZ_VENT || x > H.x + H.l * 0.5 || H.x - x > 18) continue;
    const eta = Math.max(0, H.x - x) / Math.max(3, vx) / TICK;
    const at = tp + eta;
    if (!(ventOn(H, at) && ventLeft(H, at) > 200) && !(ventNext(H, at) < 60)) continue;
    if (!best || Math.abs(H.z - z) < Math.abs(best.z - z)) best = H;
  }
  return best;
}

// What it means to do, worked out once a think (kept in bot.mem): the point it makes for, a little way along
// the way it's on (an upper deck it's up on, else the main way) out in its own lane across; on a deck, lined up
// with the way out of it; or the vent it's taking.
function plan(view, me, bot) {
  const c = course(view);
  const b = ball(view, me);
  if (!c || !b || !b.live || b.out) return null;
  const mem = bot?.mem || {};
  const when = bot?.at ?? view.tick;
  if (mem.plan && mem.planAt === when) return mem.plan;
  const x = bot?.pos?.[0] ?? b.pos[0], z = bot?.pos?.[1] ?? b.pos[2];
  const vx = bot?.vel?.[0] ?? b.vel[0];
  const y = b.pos[1];
  const skill = bot?.skill ?? 0.6;
  const g = view.party();
  const tp = when - g.start;
  const here = pieceAt(c, x, z, y);
  const up = here && here.fl & MC.GF_F_UPPER ? here : null;
  let out = null;
  const V = up ? null : ventFor(c, view, x, z, vx, tp, skill);
  if (V) out = { goal: [V.x, V.z], vent: V };
  if (!out) {
    const xa = Math.min(c.end - 2, x + 6 + Math.max(0, vx) * 0.5);
    let P = up && xa < up.x1 ? up : mainAt(c, xa) || c.main.at(-1);
    if (P.fl & MC.GF_F_GAP) P = c.main[P.m + 1] || P;
    if (P.fl & MC.GF_F_DECK) { const N = c.main[P.m + 1]; if (N && N.x0 - x < 12) P = N; }
    if (mem.lanePiece !== P.k) { mem.lanePiece = P.k; mem.lane = (luck(b.slot ?? 0, P.k) - 0.5) * 0.9; }
    out = { goal: [xa, P.z + mem.lane * Math.max(0, P.w - 1.4)] };
  }
  out.up = up;
  mem.plan = out;
  mem.planAt = when;
  return out;
}
const goal = (view, me, bot) => plan(view, me, bot)?.goal ?? null;

// Holding back: the back key against its roll till it's all but stopped; then, off the middle line zc of what
// it's on, across toward it; then no keys, facing on.
const wait = (vx, z, zc) => (vx > 1 ? { yaw: 0, move: 2 } : Math.abs(z - zc) > 0.7 ? { yaw: Math.sign(zc - z) * Math.PI / 2, move: 1 } : { yaw: 0, move: 0 });
// Seconds a ball rolling on at v0, keys held (bumper's push against its drag: on toward VMAX at K a second),
// takes to cover s metres.
const VMAX = Number(L.BPHYS.B_ACC_DT) / (1 - Number(L.BPHYS.B_DRAG)), K = -Math.log(Number(L.BPHYS.B_DRAG)) / TICK;
function eta(s, v0) {
  if (s <= 0) return 0;
  v0 = Math.max(0, Math.min(VMAX, v0));
  const x = (t) => VMAX * t - (VMAX - v0) * (1 - Math.exp(-K * t)) / K;
  let lo = 0, hi = s / Math.max(0.5, v0) + 1;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (x(m) < s) lo = m; else hi = m; }
  return hi;
}

// The word it wants outright, or null for the planner: in a vent's column, centred while it rises, then on
// over the upper deck; at a gap, flat out down the way and a hop at the lip; short of a fan's zone that will
// gust while it crosses, or a windmill whose blades will be where it crosses, a wait; in a gust, into the wind.
function think(view, me, bot) {
  const c = course(view);
  const b = ball(view, me);
  if (!c || !b || !b.live || b.out) return null;
  const x = bot?.pos?.[0] ?? b.pos[0], z = bot?.pos?.[1] ?? b.pos[2];
  const vx = bot?.vel?.[0] ?? b.vel[0];
  const y = b.pos[1];
  const g = view.party();
  const tp = (bot?.at ?? view.tick) - g.start;
  const p = plan(view, me, bot);
  const here = pieceAt(c, x, z, y);
  // a vent: in its column while it blows, ride it up and drift on over the upper deck
  for (const H of near(c, x)) {
    if (H.kind !== MC.GF_HZ_VENT) continue;
    const d = Math.hypot(x - H.x, z - H.z);
    if (d > H.l + 0.3) continue;
    const U = c.upper.find((P) => Math.abs(P.x0 - H.x) < H.l + 2);
    if (ventOn(H, tp) && y > H.y + 0.3) {
      if (U && y > U.h + 0.3) return { yaw: Math.atan2(U.z - z, 6), move: 1 };
      return { yaw: Math.atan2(H.z - z, H.x - x), move: d > 0.6 ? 1 : 0 };
    }
    if (p?.vent === H && !ventOn(H, tp) && ventNext(H, tp) < 90 && d < H.l - 0.5) return wait(vx, z, H.z);
  }
  if (p?.vent) return null;
  if (p?.up) return null;
  // a gap on the way: straight on, flat out, hopping at its lip
  const P = here ?? mainAt(c, x);
  if (P && !(P.fl & MC.GF_F_UPPER)) {
    let G = null;
    for (let m = P.m; m < Math.min(c.main.length, P.m + 3); m++) {
      const Q = c.main[m];
      if (Q.x0 - x > 7) break;
      if (Q.fl & MC.GF_F_GAP) { G = Q; break; }
    }
    if (G) {
      const Land = c.main[G.m + 1] || G;
      const tz = Math.max(Land.z - 0.5 * Land.w, Math.min(Land.z + 0.5 * Land.w, z));
      const lip = G.x0 - x;
      // too slow to clear it from this close (a hop carries it 0.6 s): back off for a run at it
      const mem = bot?.mem || {};
      const need = (G.len + 0.6) / 0.6;
      if (b.ground && lip > 0 && lip < 2.5 && vx < need - 1.5 && !(here && here.fl & MC.GF_F_DECK)) mem.runup = G.k;
      if (mem.runup === G.k) {
        if (lip < 5.5 && b.ground) return { yaw: Math.atan2(z - tz, -6), move: 1 };
        mem.runup = -1;
      }
      return { yaw: Math.atan2(tz - z, 6), move: 1, hop: b.ground && lip < Math.max(0.9, vx * 0.075) && lip > -0.5 ? 1 : 0 };
    }
  }
  // the next fan's zone or windmill along, on its level
  const h = P ? floorAt(P, x) : y;
  let F = null, M = null;
  for (const H of c.hazards) {
    if (Math.abs(H.y - h) > 2.5 || Math.abs(z - H.z) > Math.max(H.w, H.piece.w) + 1.5) continue;
    if (H.kind === MC.GF_HZ_FAN && H.x + H.l + 0.5 > x && H.x - H.l - x < 10 && (!F || H.x < F.x)) F = H;
    if (H.kind === MC.GF_HZ_MILL && H.x + 1.6 > x && H.x - x < 9 && (!M || H.x < M.x)) M = H;
  }
  if (F) {
    const entry = F.x - F.l - 1 - x, exit = F.x + F.l + 1.2 - x;
    if (entry < 0.3) {
      // in its zone: while it blows, roll on into the wind
      if (fanA(F, tp) > 0) return { yaw: Math.atan2(-F.dir * 0.75, 0.66), move: 1 };
    } else {
      // (as it would roll from here: the gust must hold off from its getting there to its getting clear, and a little more)
      let blocked = false;
      const t1 = eta(exit, vx) + 0.15;
      for (let s = eta(entry, vx) - 0.1; s <= t1 && !blocked; s += 0.04) if (fanA(F, tp + s / TICK) > 0) blocked = true;
      if (blocked && entry > 0.8) return wait(vx, z, F.piece.z);
    }
  }
  if (M) {
    const r = b.radius ?? 1, hw = r + MC.GF_MILL_T + 0.3;
    const entry = M.x - hw - x, exit = M.x + hw - x;
    if (entry > 0.4) {
      let blocked = false;
      const t1 = eta(exit, vx) + 0.06;
      for (let s = eta(entry, vx) - 0.06; s <= t1 && !blocked; s += 0.03) if (bladeGap(M, z, M.y + r, tp + s / TICK, r) < 0.15) blocked = true;
      if (blocked && entry > 1) return wait(vx, z, M.piece.z);
      if (!blocked) return { yaw: 0, move: 1 };
    }
  }
  return null;
}

export default {
  id: L.MG_GALE, key: 'gale', name: 'GALE FORCE',
  hint: 'RACE THE WIND  FANS GUST WHEN THEIR LIGHT FLASHES  RIDE THE UPDRAFT',
  rules: 'FIRST HOME WINS  FALL AND YOU GO BACK TO THE LAST DECK',
  env: 'day',

  draw(view, ctx, out) {
    const c = course(view);
    if (!c) return;
    if (!c.geom) c.geom = build(c);
    const sc = out.scene;
    for (const s of c.geom) sc.put(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8], s[9], s[10], s[11], s[12], s[13], s[14], undefined, s[15]);
    const tp = playTime(view, ctx);
    const now = ctx?.now ?? 0, secs = now / 1000, ms = ctx?.ms ?? 16;
    const g = view.party();
    const cam = ctx?.cam ?? [c.box[0], 0, c.box[1]];
    const playing = g.state === L.H_PLAY;
    for (const H of c.hazards) {
      const seen = Math.abs(H.x - cam[0]) < 170;
      if (H.kind === MC.GF_HZ_FAN) {
        const a = playing ? fanA(H, tp) : 0, warn = playing && fanWarn(H, tp);
        const [fx, fy, fz] = fanPos(H);
        H.spin = (H.spin + (a > 0 ? 24 : warn ? 6 : 1.2) * ms / 1000) % (2 * Math.PI);
        for (const k of [0, 1]) sc.box(fx, fy, fz, 0.06, 1.5, 0.3, Math.PI / 2, 0.96, 0.96, 0.98, LOOK.PLASTIC, 0, 0, 1, H.j * 7 + k, H.spin + k * Math.PI / 2);
        sc.sphere(fx, fy, fz + H.dir * 0.1, 0.34, 0.9, 0.2, 0.15, LOOK.PLASTIC);
        // its light: red while it blows, amber flashing for the second before, a dim green when still
        const blink = Math.floor(now / 110) & 1;
        const lz = fz - H.dir * 0.42;
        if (a > 0) sc.sphere(fx, fy + 2.35, lz, 0.36, 1, 0.2, 0.12, LOOK.GLOW, 2.2);
        else if (warn) sc.sphere(fx, fy + 2.35, lz, 0.36, 1, 0.72, 0.1, LOOK.GLOW, blink ? 2.4 : 0.3);
        else sc.sphere(fx, fy + 2.35, lz, 0.3, 0.3, 0.85, 0.35, LOOK.GLOW, 0.35);
        // its zone on the floor, and the wind across it
        const wp = H.w - 1;
        if (a > 0 || warn) sc.box(H.x, H.y + 0.03, H.z, H.l, 0.02, wp - 0.05, 0, ...(a > 0 ? [0.7, 0.92, 1] : [1, 0.75, 0.2]), LOOK.GLOW, a > 0 ? 0.7 : blink ? 0.9 : 0.3, 0, a > 0 ? 0.3 : 0.4);
        if (a > 0 && seen) {
          const span = 2 * wp + 4;
          for (let i = 0; i < 10; i++) {
            const u = (secs * (1.1 + 0.35 * (a / MC.GF_FAN_A1)) + i * 0.381) % 1;
            const sx = H.x - H.l + 0.4 + ((i * 0.618) % 1) * (2 * H.l - 0.8), sy = H.y + 0.35 + ((i * 0.37) % 1) * 3.2;
            const z0 = fz + H.dir * (0.6 + u * span);
            out.beams.push({ a: [sx, sy, z0], b: [sx, sy, z0 + H.dir * 3.2], width: 0.13 + 0.09 * (a / MC.GF_FAN_A1), color: [0.9, 0.97, 1, 0.8 * (1 - u)] });
          }
        }
      } else if (H.kind === MC.GF_HZ_TUNNEL) {
        if (!seen) continue;
        const a = playing ? tunA(H, tp) : MC.GF_TUN_A0, k = (a - MC.GF_TUN_A0) / MC.GF_TUN_G1;
        const n = 6 + Math.round(8 * k);
        for (let i = 0; i < n; i++) {
          const u = (secs * (0.5 + 0.08 * a) + i * 0.618) % 1;
          const sx = H.x + H.l - u * 2 * H.l, sz = H.z + (((i * 0.43) % 1) - 0.5) * 1.7 * H.w, sy = H.y + 0.3 + ((i * 0.71) % 1) * 2.8;
          out.beams.push({ a: [sx, sy, sz], b: [sx - 3, sy, sz], width: 0.06 + 0.05 * k, color: [0.9, 0.95, 1, (0.35 + 0.35 * k) * Math.sin(Math.PI * u)] });
        }
      } else if (H.kind === MC.GF_HZ_MILL) {
        const hy = H.y + H.w, an = millAngle(H, tp);
        const lit = Math.max(0, 1 - (now - H.hit) / 300);
        for (let k = 0; k < MC.GF_MILL_NB; k++) {
          const th = an + (k * 2 * Math.PI) / MC.GF_MILL_NB, ez = Math.cos(th), ey = Math.sin(th);
          // a spar from the hub, a sail on its outer two thirds (roll -th lays a solid's z along the blade)
          sc.box(H.x, hy + ey * H.l / 2, H.z + ez * H.l / 2, 0.2, 0.2, H.l / 2, 0, 0.55, 0.38, 0.24, LOOK.WOOD, 0, 0, 1, H.j * 9 + k, -th);
          const sail = k & 1 ? [0.95, 0.25 + 0.5 * lit, 0.2 + 0.5 * lit] : [0.96, 0.94, 0.88];
          const s0 = H.l * 0.62;
          sc.box(H.x - 0.05, hy + ey * s0, H.z + ez * s0, MC.GF_MILL_T * 0.35, 0.62, H.l * 0.37, 0, ...sail, LOOK.PLASTIC, 0, 0, 1, H.j * 9 + k + 4, -th);
        }
      } else if (H.kind === MC.GF_HZ_VENT) {
        const on = playing && ventOn(H, tp), soon = playing && !on && ventNext(H, tp) < MC.GF_WARN;
        const blink = Math.floor(now / 110) & 1;
        out.decals.push({ pos: [H.x, H.y + 0.1, H.z], radius: H.l + 0.2, width: 0.3, color: on ? [0.4, 1, 0.9, 0.9] : soon ? [1, 0.8, 0.25, blink ? 0.9 : 0.25] : [0.4, 0.6, 0.6, 0.3], kind: DECAL.RING });
        if (on) {
          sc.cyl(H.x, H.y + H.w / 2, H.z, H.l, H.w / 2, 0.5, 1, 0.92, LOOK.GLOW, 0.5, 0.9, 0.12);
          if (seen) for (let i = 0; i < 7; i++) {
            const u = (secs * 0.9 + i * 0.618) % 1, a = i * 2.4, r = H.l * (0.25 + ((i * 0.37) % 1) * 0.6);
            const y0 = H.y + 0.2 + u * (H.w + 1);
            out.beams.push({ a: [H.x + Math.cos(a) * r, y0, H.z + Math.sin(a) * r], b: [H.x + Math.cos(a) * r, y0 + 2.2, H.z + Math.sin(a) * r], width: 0.09, color: [0.7, 1, 0.95, 0.6 * Math.sin(Math.PI * u)] });
          }
        }
      }
    }
    // a star over the leader still racing: the one to catch
    if (playing) {
      const lead = standings(view).find((e) => !e.home);
      const b = lead && view.bumper(lead.slot);
      if (b && !b.out) {
        const dt = ctx?.dt || 0;
        out.glow.push({ pos: [b.pos[0] + b.vel[0] * dt, b.pos[1] + 2 * b.radius + 2.5 + 0.15 * Math.sin(secs * 4), b.pos[2] + b.vel[2] * dt], size: 0.75, color: [1, 0.85, 0.2, 0.95], kind: SPRITE.SPARK, minpx: 3 });
      }
    }
    // the gate: down through the countdown, up and away at GO
    const S = c.main[0];
    const up = g.state === L.H_COUNT || g.state === L.H_IDLE ? 0 : Math.min(1, tp / 60);
    if (up < 1) sc.box(S.x1, S.h + 0.9 + up * 5, S.z, 0.15, 0.9, S.w, 0, 0.2, 0.75, 0.3, LOOK.GLOW, 0.4, 0.6, 0.85 * (1 - up));
  },

  // the whole course, from above
  frame(view) {
    const c = course(view);
    const g = view.party();
    if (!c) return { centre: [g.cx, g.floor, g.cx], radius: g.size, shape: 'square' };
    const [x0, z0, x1, z1] = c.box;
    return { centre: [(x0 + x1) / 2, (c.top + c.floor) / 2, (z0 + z1) / 2], radius: Math.max(x1 - x0, z1 - z0) / 2, shape: 'square' };
  },

  // a new round faces you down the course
  facing() { return 0; },

  fx(f, ctx) {
    const d = typeof ctx.dist === 'function' ? ctx.dist(f.pos) : ctx.dist ?? 0;
    const mine = f.owner === ctx.slot;
    if (f.kind === MC.GF_FX_HOME) {
      const place = Math.round(f.size);
      if (mine) { ctx.banner?.(`HOME ${ordinal(place)}!`, place === 1 ? C.YELLOW : C.GREEN, 3000); ctx.sound?.holed?.(); }
      else ctx.feed?.(`${ctx.name?.(f.owner) ?? `P${f.owner + 1}`} HOME ${ordinal(place)}`, place === 1 ? C.YELLOW : C.WHITE);
      for (let i = 0; i < 6; i++) {
        const a = i * 1.047 + f.owner;
        ctx.glow?.({ pos: [f.pos[0] + Math.cos(a) * 1.5, f.pos[1] + 2 + (i & 1), f.pos[2] + Math.sin(a) * 1.5], size: 0.9, color: [[1, 0.85, 0.2], [0.3, 0.9, 1], [1, 0.35, 0.5]][i % 3].concat(1), kind: SPRITE.SPARK, life: 700 });
      }
    } else if (f.kind === MC.GF_FX_LATE) {
      const who = mine ? 'YOU WIN THE RACE' : `${ctx.name?.(f.owner) ?? `P${f.owner + 1}`} IS HOME`;
      ctx.banner?.(`${who}  ${Math.round(f.size)} S TO FINISH`, C.YELLOW, 3000);
      ctx.sound?.count?.(0);
    } else if (f.kind === MC.GF_FX_MILL) {
      ctx.glow?.({ pos: f.pos, size: 2.2, color: [1, 0.9, 0.5, 0.9], kind: SPRITE.FLASH, life: 260, grow: true });
      ctx.sound?.boing?.(Math.min(24, f.size), mine ? 0 : d);
      const H = course(ctx.view)?.hazards[f.shot];
      if (H) H.hit = ctx.now ?? 0;
      if (mine) ctx.banner?.('BATTED!', C.ORANGE, 900);
    } else if (f.kind === MC.GF_FX_LIFT) {
      ctx.glow?.({ pos: [f.pos[0], f.pos[1] + 1, f.pos[2]], size: 1.8, color: [0.5, 1, 0.9, 0.8], kind: SPRITE.RING, life: 500, grow: true });
      if (mine || d < 25) ctx.sound?.jump?.();
      if (mine) ctx.banner?.('UPDRAFT!', C.CYAN, 1000);
    }
  },

  // Where you are in the race and how far to go, over the frontend's score
  // lines (a scoring round's SCORE and LEADER, which here would read GF_WIN
  // plus ticks); the wind ahead (the next fan's gust or the next vent); what's
  // coming; the course as a line with you and the leader on it; a checkpoint
  // as you pass it.
  hud(view, ctx) {
    const c = course(view);
    const g = view.party();
    if (!c || g.state !== L.H_PLAY) return;
    const list = standings(view);
    const me = ctx.me ?? (ctx.slot >= 0 ? view.partier(ctx.slot) : null);
    const mine = me?.live ? list.find((e) => e.slot === me.slot) : null;
    const total = c.fin - c.x0line;
    const now = ctx.now ?? 0;
    const blank = ' '.repeat(26);
    ctx.put(1, 0, blank, C.WHITE);
    ctx.put(1, 1, blank, C.WHITE);
    const lead = list[0];
    if (mine) {
      ctx.put(1, 0, mine.home ? `HOME ${ordinal(mine.rank)} OF ${list.length}` : `${ordinal(mine.rank)} OF ${list.length}`, mine.home ? C.GREEN : mine.rank === 1 ? C.YELLOW : C.WHITE);
      if (!mine.home) {
        ctx.put(1, 1, `${Math.max(0, Math.ceil(total - mine.dist))} M TO GO`, C.GREY);
        const x = me.pos[0], z = me.pos[2], y = me.pos[1];
        const P = pieceAt(c, x, z, y) ?? mainAt(c, x);
        const h = P ? floorAt(P, x) : y;
        // the wind ahead: the next fan along on your level, or the next vent
        let F = null, V = null;
        for (const H of c.hazards) {
          if (Math.abs(H.y - h) > 2.5 || H.x + H.l < x - 0.5 || H.x - x > 30) continue;
          if (H.kind === MC.GF_HZ_FAN && (!F || H.x < F.x)) F = H;
          if (H.kind === MC.GF_HZ_VENT && (!V || Math.abs(H.z - z) < Math.abs(V.z - z))) V = H;
        }
        const tp = g.t;
        if (V && (!F || V.x < F.x)) {
          const on = ventOn(V, tp);
          ctx.right(2, on ? `UPDRAFT ON ${(ventLeft(V, tp) * TICK).toFixed(1)} S` : `UPDRAFT IN ${(ventNext(V, tp) * TICK).toFixed(1)} S`, on ? C.CYAN : C.GREY);
        } else if (F) {
          const a = fanA(F, tp);
          ctx.right(2, a > 0 ? 'GUSTING' : `GUST IN ${(fanNext(F, tp) * TICK).toFixed(1)} S`, a > 0 ? C.RED : fanWarn(F, tp) ? C.ORANGE : C.GREY);
        }
        // what you're on, or the next section coming
        if (P) {
          let Q = P;
          if (P.fl & (MC.GF_F_DECK | MC.GF_F_START)) Q = c.main.slice((P.m ?? 0) + 1).find((R) => !(R.fl & MC.GF_F_DECK) && R.x0 - x < 30) ?? P;
          if (!(Q.fl & (MC.GF_F_DECK | MC.GF_F_START))) ctx.right(3, Q === P ? SECTION[Q.sec] : `${SECTION[Q.sec]} AHEAD`, Q.sec === MC.GF_S_FINISH ? C.GREEN : C.ORANGE);
        }
        // a checkpoint passed: said for a second and a half
        const k = c.checks.reduce((n, Q, i) => (Q.x0 - c.x0line <= mine.dist ? i : n), 0);
        if (!c.hud || c.hud.slot !== me.slot) c.hud = { slot: me.slot, k, at: -1e9 };
        if (k > c.hud.k) { c.hud.k = k; c.hud.at = now; }
        if (k < c.hud.k) c.hud.k = k;
        if (now - c.hud.at < 1500 && k > 0) ctx.centre(4, 'CHECKPOINT', C.GREEN);
      } else ctx.put(1, 1, lead && lead.slot !== me.slot && lead.rank === 1 ? `P${lead.slot + 1} WON IT` : 'WAIT FOR THE REST', C.GREY);
    } else if (lead) ctx.put(1, 0, `LEADER P${lead.slot + 1}`, C.WHITE);
    // the course as a line: the leader, you
    const n = 36, x = COLS - 2 - n;
    const cell = (dist) => Math.max(0, Math.min(n - 1, Math.floor((dist / total) * n)));
    ctx.put(x - 1, 5, '[', C.GREY);
    ctx.put(x, 5, '-'.repeat(n), C.GREY);
    ctx.put(x + n, 5, ']', C.WHITE);
    if (lead && !lead.home) ctx.put(x + cell(lead.dist), 5, '*', C.YELLOW);
    if (mine && !mine.home) ctx.put(x + cell(mine.dist), 5, '>', C.GREEN);
    const home = list.filter((e) => e.home).length;
    if (home) ctx.right(6, `${home} OF ${list.length} HOME`, C.CYAN);
  },

  // (its hops are think's: at a gap's lip)
  brain: { danger, goal, think, hop: () => false },
};
