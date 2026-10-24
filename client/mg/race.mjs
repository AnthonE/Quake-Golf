// DOWNHILL, as drawn and as the AI ball sees it. The course is read straight
// from the sim (src/mg/race.mjs's layout: pieces and hazards in PG_S) and
// built once into a list of solids: the track as a run of slabs stepping down
// its slope, red and white kerbs, rails where it has them, pillars down to the
// sea, a start gate and a finish arch over a checkered pen. Each frame the
// slabs are copied into the Scene and the hazards added as they stand on the
// prediction's clock (a spinner's angle, a sweeper's place are functions of
// the tick, so what you dodge is where the sim has it). $rc_at is worked again
// here in doubles: the brain steers by it, nothing is fed back.
import * as L from '../../src/layout.mjs';
import { LOOK, SPRITE, DECAL, COLS } from '../party-render.mjs';
import { C } from '../font.mjs';

const TICK = 0.008;
const TURN = 16384;
const RAD = (2 * Math.PI) / TURN;
const STEP = 0.7; // m of track a slab, at its outer edge
const SLAB = 0.7; // a slab's half height
const KERB = 0.45; // a kerb's width, m
const KERB_L = 2; // m of kerb a colour
const RAIL_T = 0.16; // a rail's half thickness

// Each section's two tones, a band of slabs each; its kerbs stay red and white.
const TONE = {
  [L.RCS_START]: [[0.9, 0.9, 0.92], [0.78, 0.8, 0.84]],
  [L.RCS_DROP]: [[0.25, 0.55, 0.95], [0.2, 0.47, 0.86]],
  [L.RCS_BEND]: [[0.98, 0.62, 0.2], [0.93, 0.54, 0.16]],
  [L.RCS_JUMP]: [[0.6, 0.3, 0.9], [0.52, 0.25, 0.82]],
  [L.RCS_FUNNEL]: [[0.2, 0.75, 0.45], [0.16, 0.66, 0.38]],
  [L.RCS_BUMPERS]: [[0.95, 0.85, 0.3], [0.9, 0.78, 0.24]],
  [L.RCS_SPINNERS]: [[0.95, 0.4, 0.55], [0.88, 0.33, 0.48]],
  [L.RCS_SWEEPERS]: [[0.3, 0.8, 0.85], [0.24, 0.71, 0.77]],
  [L.RCS_FINISH]: [[0.9, 0.9, 0.92], [0.78, 0.8, 0.84]],
};
export const SECTION = ['START', 'DROP', 'BEND', 'JUMP', 'FUNNEL', 'BUMPERS', 'SPINNERS', 'SWEEPERS', 'FINISH'];

const pa = (k) => L.PG_S + L.RC_PIECES + k * L.RC_PSIZE;
const ha = (j) => L.PG_S + L.RC_HAZ + j * L.RC_HSIZE;

// ---- the course, read once a layout

let memo = null;
// This round's course, its pieces and hazards as the confirmed world has them, or null.
export function course(view) {
  // once a world tick: the brain asks thousands of times a tick
  if (memo && view._rcTick === view.tick && view._rcMemo === memo) return memo;
  const dv = view.dv;
  const np = dv.getUint32(L.PG_H + L.RC_NPIECE, true), nh = dv.getUint32(L.PG_H + L.RC_NHAZ, true);
  if (!np || np > L.RC_NP) return null;
  const f = (a) => dv.getFloat32(a, true), u = (a) => dv.getUint32(a, true);
  const last = pa(np - 1);
  const key = `${np} ${nh} ${f(L.PG_H + L.RC_W)} ${f(last + L.RC_P_X)} ${f(last + L.RC_P_Z)} ${f(last + L.RC_P_H0)} ${u(L.HDR_SEED)} ${u(L.HDR_HOLE)}`;
  view._rcTick = view.tick;
  if (memo?.key === key) { view._rcMemo = memo; return memo; }
  const pieces = [];
  for (let k = 0; k < np; k++) {
    const a = pa(k);
    const P = {
      k, kind: u(a + L.RC_P_KIND), fl: u(a + L.RC_P_FL), s0: f(a + L.RC_P_S0), len: f(a + L.RC_P_LEN), h0: f(a + L.RC_P_H0), h1: f(a + L.RC_P_H1),
      w0: f(a + L.RC_P_W0), w1: f(a + L.RC_P_W1), x: f(a + L.RC_P_X), z: f(a + L.RC_P_Z), dx: f(a + L.RC_P_DX), dz: f(a + L.RC_P_DZ), r: f(a + L.RC_P_R),
      sh: f(a + L.RC_P_SH), turn: f(a + L.RC_P_TURN), bx: f(a + L.RC_P_BX), bz: f(a + L.RC_P_BZ), br2: f(a + L.RC_P_BR2),
      hz0: u(a + L.RC_P_HZ0), hzn: u(a + L.RC_P_HZN), yaw: dv.getInt32(a + L.RC_P_YAW, true), sweep: u(a + L.RC_P_SWEEP), sec: u(a + L.RC_P_SEC),
    };
    if (P.kind === L.RC_ARC) {
      P.phiM = Math.atan2(P.dz, P.dx);
      P.phi = P.sweep * RAD;
      P.phi0 = P.phiM - P.turn * P.phi / 2;
    }
    pieces.push(P);
  }
  const hazards = [];
  for (let j = 0; j < nh; j++) {
    const a = ha(j);
    hazards.push({ j, kind: u(a + L.RC_H_KIND), x: f(a + L.RC_H_X), z: f(a + L.RC_H_Z), y: f(a + L.RC_H_Y), l: f(a + L.RC_H_L), spd: dv.getInt32(a + L.RC_H_SPD, true), ph: dv.getInt32(a + L.RC_H_PH, true), a: f(a + L.RC_H_A), hit: -1e9 });
  }
  for (const P of pieces) for (let j = P.hz0; j < P.hz0 + P.hzn && j < nh; j++) { hazards[j].piece = P; hazards[j].dx = P.dx; hazards[j].dz = P.dz; }
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const P of pieces) { const r = Math.sqrt(P.br2); x0 = Math.min(x0, P.bx - r); x1 = Math.max(x1, P.bx + r); z0 = Math.min(z0, P.bz - r); z1 = Math.max(z1, P.bz + r); }
  const checks = pieces.filter((P) => P.fl & L.RCF_CHECK);
  memo = {
    key, pieces, hazards, checks, w: f(L.PG_H + L.RC_W), grid: f(L.PG_H + L.RC_GRID), fin: f(L.PG_H + L.RC_FIN), floor: f(L.PG_FLOOR),
    top: pieces[0].h0, end: pieces[np - 1].s0 + pieces[np - 1].len, box: [x0, z0, x1, z1], geom: null, hint: 0,
  };
  view._rcMemo = memo;
  return memo;
}

// $rc_at in doubles: the piece over (x, z) within RC_MARGIN of its edge, how
// far along (0..1), across (+ left), the middle line's height, the way down
// and its slope; null over nothing.
export function at(c, x, z) {
  // the piece last found first, then its neighbours, then the rest: asked about nearby points, it's mostly one try
  const ps = c.pieces, n = ps.length, h = c.hint;
  let a = try1(ps[h], x, z) || (h + 1 < n && try1(ps[h + 1], x, z)) || (h > 0 && try1(ps[h - 1], x, z));
  if (!a) for (let k = 0; k < n && !a; k++) if (k < h - 1 || k > h + 1) a = try1(ps[k], x, z);
  if (a) c.hint = a.P.k;
  return a || null;
}
function try1(P, x, z) {
  let px = x - P.bx, pz = z - P.bz;
  if (px * px + pz * pz > P.br2) return null;
  px = x - P.x; pz = z - P.z;
  let f, u, tx, tz;
  if (P.kind === L.RC_STRAIGHT) {
    tx = P.dx; tz = P.dz;
    f = (tx * px + tz * pz) / P.len;
    u = tx * pz - tz * px;
  } else {
    const cc = P.dx * px + P.dz * pz;
    if (cc <= 0) return null;
    const rho = Math.sqrt(px * px + pz * pz);
    f = 0.5 * P.turn * (P.dx * pz - P.dz * px) / (rho * P.sh) + 0.5;
    u = P.turn * (P.r - rho);
    tx = -P.turn * pz / rho; tz = P.turn * px / rho;
  }
  if (!(f >= 0 && f < 1)) return null;
  const w = P.w0 + (P.w1 - P.w0) * f;
  if (Math.abs(u) > w + L.RC_MARGIN) return null;
  return { P, f, u, w, h: P.h0 + (P.h1 - P.h0) * f, tx, tz, s: P.s0 + f * P.len };
}

// The point g of the way along piece P (by angle on an arc) and u across: [x, y, z] on its middle line's height, and its heading.
export function along(P, g, u) {
  if (P.kind === L.RC_STRAIGHT) {
    const a = g * P.len;
    return [P.x + P.dx * a - P.dz * u, P.h0 + (P.h1 - P.h0) * g, P.z + P.dz * a + P.dx * u, Math.atan2(P.dz, P.dx)];
  }
  const th = g * P.phi, phi = P.phi0 + P.turn * th, rho = P.r - P.turn * u;
  const f = 0.5 + 0.5 * Math.sin(th - P.phi / 2) / Math.sin(P.phi / 2);
  return [P.x + Math.cos(phi) * rho, P.h0 + (P.h1 - P.h0) * f, P.z + Math.sin(phi) * rho, phi + P.turn * Math.PI / 2];
}
// The piece s metres down the course, and the point there (u across).
export function pointAt(c, s, u = 0) {
  let P = c.pieces[c.pieces.length - 1];
  for (const Q of c.pieces) if (s < Q.s0 + Q.len) { P = Q; break; }
  const g = Math.max(0, Math.min(1, (s - P.s0) / P.len));
  return { P, p: along(P, g, u), w: P.w0 + (P.w1 - P.w0) * g };
}

// ---- the solids that never move, built once a course

function build(c) {
  const out = []; // [shape, x, y, z, hx, hy, hz, yaw, r, g, b, look, a, b2, alpha]
  const box = (x, y, z, hx, hy, hz, yaw, rgb, look = LOOK.PLASTIC, a = 0, b = 0, alpha = 1) => out.push([0, x, y, z, hx, hy, hz, yaw, ...rgb, look, a, b, alpha]);
  const cyl = (x, y, z, r, hh, rgb, look = LOOK.MATTE, a = 0, b = 0, alpha = 1) => out.push([1, x, y, z, r, hh, r, 0, ...rgb, look, a, b, alpha]);
  let band = 0;
  for (const P of c.pieces) {
    const tones = TONE[P.sec] || TONE[L.RCS_DROP];
    const wmax = Math.max(P.w0, P.w1);
    const outer = P.kind === L.RC_ARC ? P.phi * (P.r + wmax) : P.len;
    const n = Math.max(1, Math.ceil(outer / STEP));
    const pen = P.fl & L.RCF_PEN, start = P.fl & L.RCF_START, gap = P.fl & L.RCF_GAP;
    for (let i = 0; i < n && !gap; i++) {
      const g = (i + 0.5) / n;
      const w = P.w0 + (P.w1 - P.w0) * g;
      const [x, y, z, yaw] = along(P, g, 0);
      // a slab as long as its step at the outer edge, so an arc's slabs overlap inside and meet outside
      const half = P.kind === L.RC_ARC ? (P.phi * (P.r + w) / n) / 2 + 0.03 : P.len / n / 2 + 0.03;
      const tone = tones[Math.floor(band / 3) & 1];
      band++;
      if (pen || start) box(x, y - SLAB, z, half, SLAB, w, yaw, tone, LOOK.CHECKER, 2, 0.35);
      else box(x, y - SLAB, z, half, SLAB, w - KERB, yaw, tone, LOOK.PLASTIC);
      if (!pen && !start) {
        // the kerbs, a colour every KERB_L along the course
        const s = P.s0 + g * P.len;
        const red = Math.floor(s / KERB_L) & 1;
        for (const side of [1, -1]) {
          const [kx, , kz] = along(P, g, side * (w - KERB / 2));
          box(kx, y - SLAB + 0.04, kz, half, SLAB, KERB / 2, yaw, red ? [0.9, 0.12, 0.1] : [0.96, 0.96, 0.96], LOOK.PLASTIC);
        }
      }
    }
    // rails (taller round the pen), a post at every other step
    const railH = pen ? 1.4 : L.RC_RAIL;
    for (const [flag, side] of [[L.RCF_RAIL_L, 1], [L.RCF_RAIL_R, -1]]) {
      if (!(P.fl & flag)) continue;
      const m = Math.max(1, Math.ceil(outer / 2));
      for (let i = 0; i < m; i++) {
        const g = (i + 0.5) / m;
        const w = P.w0 + (P.w1 - P.w0) * g;
        const [x, y, z, yaw] = along(P, g, side * (w + RAIL_T));
        const half = (P.kind === L.RC_ARC ? P.phi * (P.r + w) / m : P.len / m) / 2 + 0.02;
        box(x, y + railH / 2, z, half, railH / 2, RAIL_T, yaw, pen ? [0.75, 0.88, 1] : [0.96, 0.96, 0.98], pen ? LOOK.GLOW : LOOK.PLASTIC, pen ? 0.25 : 0, 0, pen ? 0.55 : 1);
        if (!pen && (i & 1) === 0) box(x, y + railH / 2, z, 0.2, railH / 2 + 0.05, 0.22, yaw, [0.85, 0.15, 0.12], LOOK.PLASTIC);
      }
    }
    if (start) {
      // the wall behind the grid
      const [x, y, z, yaw] = along(P, 0, 0);
      box(x - P.dx * RAIL_T, y + 0.7, z - P.dz * RAIL_T, RAIL_T, 0.7, P.w0 + 0.3, yaw, [0.96, 0.96, 0.98], LOOK.PLASTIC);
    }
    if (pen) {
      const [x, y, z, yaw] = along(P, 1, 0);
      box(x + P.dx * RAIL_T, y + 0.7, z + P.dz * RAIL_T, RAIL_T, 0.7, P.w1 + 0.3, yaw, [0.75, 0.88, 1], LOOK.GLOW, 0.25, 0, 0.55);
    }
    if (P.sec === L.RCS_JUMP && !gap && P.h1 > P.h0) {
      // the kicker's lip in hazard stripes
      const [x, y, z, yaw] = along(P, 1, 0);
      box(x - P.dx * 0.4, y - 0.12, z - P.dz * 0.4, 0.4, 0.14, P.w1, yaw, [1, 0.8, 0.1], LOOK.HAZARD, 0.5);
    }
    // a pillar down to the sea under every piece but the gaps, one more under a long one
    if (!gap) {
      const legs = Math.max(1, Math.round(P.len / 26));
      for (let i = 0; i < legs; i++) {
        const [x, y, z] = along(P, (i + 0.5) / legs, 0);
        const top = y - 2 * SLAB, bot = -12;
        cyl(x, (top + bot) / 2, z, Math.min(2.4, 0.8 + wmax * 0.06), (top - bot) / 2, [0.86, 0.85, 0.82], LOOK.MATTE);
      }
    }
    // a checkpoint: a line across and a flag each side
    if ((P.fl & L.RCF_CHECK) && !start) {
      const [x, y, z, yaw] = along(P, 0, 0);
      box(x, y + 0.02, z, 0.12, 0.03, P.w0 - KERB, yaw, [1, 1, 1], LOOK.GLOW, 0.5, 0, 0.8);
      for (const side of [1, -1]) {
        const [fx, fy, fz] = along(P, 0, side * (P.w0 + 0.6));
        cyl(fx, fy + 1.4, fz, 0.09, 1.4, [0.9, 0.9, 0.9], LOOK.METAL);
        box(fx + Math.cos(yaw) * 0.45, fy + 2.45, fz + Math.sin(yaw) * 0.45, 0.45, 0.3, 0.03, yaw, [0.2, 0.85, 0.35], LOOK.PLASTIC);
      }
    }
  }
  // the finish arch over the line
  const fin = pointAt(c, c.fin + 0.01, 0);
  const P = fin.P, w = fin.w, yaw = fin.p[3];
  for (const side of [1, -1]) {
    const [x, y, z] = along(P, 0, side * (w + 0.9));
    cyl(x, y + 3.5, z, 0.55, 3.5, [0.95, 0.95, 0.95], LOOK.PLASTIC);
  }
  const [ax, ay, az] = along(P, 0, 0);
  box(ax, ay + 7.3, az, 0.5, 0.8, w + 1.4, yaw, [0.15, 0.15, 0.15], LOOK.CHECKER, 0.8);
  box(ax, ay + 0.02, az, 0.3, 0.03, w, yaw, [0.1, 0.1, 0.1], LOOK.CHECKER, 0.3, 0, 1);
  // the start gate's frame
  const g0 = c.pieces[0], [sx, sy, sz] = along(g0, 1, 0);
  for (const side of [1, -1]) {
    const [x, y, z] = along(g0, 1, side * (g0.w1 + 0.7));
    cyl(x, y + 3.7, z, 0.45, 3.7, [0.2, 0.75, 0.3], LOOK.PLASTIC);
  }
  box(sx, sy + 7.4, sz, 0.3, 0.3, g0.w1 + 1.1, Math.atan2(g0.dz, g0.dx), [0.2, 0.75, 0.3], LOOK.GLOW, 0.6, 0.5);
  return out;
}

// ---- the hazards as they stand

const spinAngle = (H, tp) => (H.ph + H.spd * tp) * RAD;
const sweepOff = (H, tp) => H.a * Math.sin((H.ph + H.spd * tp) * RAD);

// Ticks into play to draw at (fractional): the prediction's clock, frozen through the result.
function playTime(view, ctx) {
  const g = view.party();
  if (g.state !== L.H_PLAY && g.state !== L.H_OVER) return 0;
  let t = ctx?.ptick !== undefined ? ctx.ptick - g.start : g.t + (ctx?.dt || 0) / TICK;
  if (g.state === L.H_OVER) t = Math.min(t, (g.until - L.P_OVER - g.start) | 0);
  return Math.max(0, t);
}

// ---- the race: who is where

// Every ball in, its place in the race: home first by score, then by how far down (PG_M), ties by slot.
export function standings(view) {
  if (view._rc?.tick === view.tick) return view._rc.list;
  const list = [];
  for (let p = 0; p < L.NPLAYER; p++) {
    const a = L.PLAYERS + p * L.PSIZE;
    if (!(view.u8[a + L.P_FL] & L.PF_LIVE)) continue;
    const score = view.dv.getUint16(a + L.PG_SCORE, true), m = view.dv.getUint32(a + L.PG_M, true);
    list.push({ slot: p, score, home: score >= L.RC_WIN, dist: m / 100 });
  }
  list.sort((a, b) => (b.home - a.home) || (a.home ? b.score - a.score : b.dist - a.dist) || a.slot - b.slot);
  list.forEach((e, i) => { e.rank = i > 0 && list[i - 1].home === e.home && (e.home ? list[i - 1].score === e.score : false) ? list[i - 1].rank : i + 1; });
  view._rc = { tick: view.tick, list };
  return list;
}
export const ordinal = (n) => `${n}${[, 'ST', 'ND', 'RD'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'TH'}`;

// ---- the AI ball

const ball = (view, me) => (typeof me === 'number' ? view.partier(me) : me);
// A number in [0, 1) for slot p and k, the same on every machine that asks.
const luck = (p, k) => (((Math.imul(p + 1, 0x9e3779b1) ^ Math.imul(k + 7, 0x85ebca6b)) >>> 0) % 10007) / 10007;

// How deadly (x, z) is on tick `tick` for a ball moving as me does.
function danger(view, x, z, tick, me) {
  const c = course(view);
  if (!c) return 0;
  const a = at(c, x, z);
  if (!a) return 1;
  const P = a.P, w = a.w;
  if (P.fl & L.RCF_GAP) {
    // a gap is the way on at speed; slow, it's a fall
    const b = ball(view, me);
    const v = b ? b.vel[0] * a.tx + b.vel[2] * a.tz : 0;
    return v > 9 ? 0 : v > 6.5 ? 0.4 : 0.85;
  }
  const edge = Math.abs(a.u) - w;
  if (edge > -0.3) return (a.u > 0 ? P.fl & L.RCF_RAIL_L : P.fl & L.RCF_RAIL_R) ? 0.1 : 1;
  let d = edge > -2.5 && !(P.fl & (a.u > 0 ? L.RCF_RAIL_L : L.RCF_RAIL_R)) ? 0.35 * (2.5 + edge) / 2.5 : 0;
  if (!P.hzn) return d;
  const g = view.party();
  const tp = (tick - g.start) | 0;
  for (let j = P.hz0; j < P.hz0 + P.hzn; j++) {
    const H = c.hazards[j];
    if (!H) continue;
    const hx = x - H.x, hz = z - H.z;
    if (H.kind === L.RCH_BUMPER) {
      const reach = H.l + 2.2;
      if (hx > reach || hx < -reach || hz > reach || hz < -reach) continue;
      const q = Math.sqrt(hx * hx + hz * hz);
      if (q < reach) d = Math.max(d, 0.55 * (1 - Math.max(0, q - H.l - 1) / 1.2));
    } else if (H.kind === L.RCH_SPINNER) {
      const q2 = hx * hx + hz * hz, reach = H.l + 1.6;
      if (q2 < 4) d = Math.max(d, 0.7);
      else if (q2 < reach * reach) {
        const an = spinAngle(H, tp), ex = Math.cos(an), ez = Math.sin(an);
        const off = Math.abs(hx * -ez + hz * ex);
        if (off < 2.2) d = Math.max(d, 0.9 - 0.25 * Math.max(0, off - 1.5));
      }
    } else if (H.kind === L.RCH_SWEEPER) {
      const o = sweepOff(H, tp), cx = hx + H.dz * o, cz = hz - H.dx * o;
      const al = cx * H.dx + cz * H.dz, ac = cx * -H.dz + cz * H.dx;
      if (Math.abs(al) < H.l + 1.6 && Math.abs(ac) < 2.4) d = Math.max(d, 0.9);
    }
  }
  return d;
}

// What it means to do, worked out once a think (kept in bot.mem): the point
// it makes for, on the middle line a little way down from where it is, out in
// its own lane (kept per piece) between a bumper field's posts; and before a
// row of spinners or sweepers, the spot across the row where no bar will be
// as it rolls past, or, if there's none, a wait short of the row.
function plan(view, me, bot) {
  const c = course(view);
  const b = ball(view, me);
  if (!c || !b || !b.live || b.out) return null;
  const mem = bot?.mem || {};
  const when = bot?.at ?? view.tick;
  if (mem.plan && mem.planAt === when) return mem.plan;
  const x = bot?.pos?.[0] ?? b.pos[0], z = bot?.pos?.[1] ?? b.pos[2];
  const vx = bot?.vel?.[0] ?? b.vel[0], vz = bot?.vel?.[1] ?? b.vel[2];
  const a = at(c, x, z);
  const s = a ? a.s : b.m / 100;
  const sp = Math.hypot(vx, vz);
  const skill = bot?.skill ?? 0.6;
  const ahead = 7 + sp * (0.45 + 0.25 * skill);
  const t = pointAt(c, Math.min(c.end - 2, s + ahead), 0);
  const P = t.P;
  if (mem.lanePiece !== P.k) {
    mem.lanePiece = P.k;
    // a lane: on a bend's inside, spread elsewhere
    const slot = b.slot ?? 0;
    let lane = (luck(slot, P.k) - 0.5) * 1.1;
    if (P.kind === L.RC_ARC) lane = P.turn * (0.15 + 0.3 * luck(slot, P.k + 50));
    // between the posts of a bumper field's first row
    if (P.sec === L.RCS_BUMPERS && P.hzn) {
      const H = c.hazards[P.hz0 + Math.floor(luck(slot, P.k + 9) * Math.max(1, P.hzn / 4 - 1))];
      if (H) lane = (((H.x - P.x) * -P.dz + (H.z - P.z) * P.dx) + L.RC_BUMP_SP / 2) / t.w;
    }
    mem.lane = lane;
  }
  let out = null;
  if (a && skill > 0.25) {
    for (const Q of [a.P, c.pieces[a.P.k + 1]]) {
      if (!Q || !Q.hzn || (Q.sec !== L.RCS_SPINNERS && Q.sec !== L.RCS_SWEEPERS)) continue;
      const mine = Q === a.P ? a.f * Q.len : -(Q.s0 - s);
      const v = Math.max(6, vx * Q.dx + vz * Q.dz);
      const row = rowAhead(c, Q, mine);
      if (!row || row.along - mine > 26) continue;
      const T = when + (row.along - mine) / v / TICK - view.party().start;
      const { u, clear } = clearest(c, Q, row, T, a.P === Q ? a.u : 0, skill);
      const wait = clear < 0.3 && row.along - mine > 4.5;
      const q = along(Q, Math.max(0, Math.min(1, (wait ? row.along - 8 : row.along + 2.5) / Q.len)), u);
      out = { goal: [q[0], q[2]], wait, dir: [Q.dx, Q.dz] };
      break;
    }
  }
  if (!out) {
    const u = Math.max(-0.85, Math.min(0.85, mem.lane)) * t.w;
    const q = along(P, Math.max(0, Math.min(1, (Math.min(c.end - 2, s + ahead) - P.s0) / P.len)), u);
    out = { goal: [q[0], q[2]], wait: false };
  }
  out.vel = [vx, vz];
  mem.plan = out;
  mem.planAt = when;
  return out;
}
const goal = (view, me, bot) => plan(view, me, bot)?.goal ?? null;
// Waiting for a way through a row: push back against its roll till it's
// all but stopped, then sit with no keys; else the planner steers.
function think(view, me, bot) {
  const p = plan(view, me, bot);
  if (!p?.wait) return null;
  const [vx, vz] = p.vel;
  const v = vx * p.dir[0] + vz * p.dir[1];
  if (v > 1.2) return { yaw: Math.atan2(-p.dir[1], -p.dir[0]), move: 1 };
  return { yaw: Math.atan2(p.dir[1], p.dir[0]), move: 0 };
}

// The first row of piece Q's hazards whose line is ahead of `mine` (metres along Q): its along and its hazards.
function rowAhead(c, Q, mine) {
  if (!Q.rows) {
    const rows = new Map();
    for (let j = Q.hz0; j < Q.hz0 + Q.hzn; j++) {
      const H = c.hazards[j];
      const al = Math.round((H.x - Q.x) * Q.dx + (H.z - Q.z) * Q.dz);
      if (!rows.has(al)) rows.set(al, []);
      rows.get(al).push({ H, u: (H.x - Q.x) * -Q.dz + (H.z - Q.z) * Q.dx });
    }
    Q.rows = [...rows].map(([along, hs]) => ({ along, hs })).sort((x, y) => x.along - y.along);
  }
  return Q.rows.find((r) => r.along + 1.5 > mine) || null;
}

// The spot across piece Q (u) at row's line clearest of its bars round play tick T: each of 15 spots
// scored by how far it stays from every bar from 0.45 s before to 0.45 s after (the time it takes to
// roll past a sweeper's length), a little for staying near u0; and how clear that is.
function clearest(c, Q, row, T, u0, skill) {
  const w = Q.w0 + (Q.w1 - Q.w0) * Math.min(1, row.along / Q.len);
  let best = u0, score = -Infinity, bestClear = -Infinity;
  for (let i = 0; i < 15; i++) {
    const u = -w + 1.8 + (i / 14) * (2 * w - 3.6);
    let clear = Infinity;
    for (const dt of [-56, -37, -19, 0, 19, 37, 56]) {
      for (const { H, u: hu } of row.hs) {
        if (H.kind === L.RCH_SWEEPER) clear = Math.min(clear, Math.abs(u - (hu + sweepOff(H, T + dt))) - 1.5);
        else if (H.kind === L.RCH_SPINNER) {
          // the bar's line through its post, seen across the row: where it crosses the row's line, near the post
          const an = spinAngle(H, T + dt), ex = Math.cos(an), ez = Math.sin(an);
          const ea = ex * Q.dx + ez * Q.dz;
          const du = u - hu;
          if (Math.abs(du) > H.l + 1.5) continue;
          // the distance from the spot to the bar's line (the spot on the row through the post)
          clear = Math.min(clear, Math.abs(du * ea) - 1.5, Math.abs(du) - L.RC_HUB_R - 1.2);
        }
      }
    }
    const sc = Math.min(clear, 4) - 0.08 * Math.abs(u - u0) * (1 - 0.5 * skill);
    if (sc > score) { score = sc; best = u; bestClear = clear; }
  }
  return { u: best, clear: bestClear };
}

// Hop at a kicker's lip, and over a spinner's bar or a sweeper about to meet it.
function hop(view, me, bot) {
  const c = course(view);
  const b = ball(view, me);
  if (!c || !b || !b.ground) return false;
  const x = bot?.pos?.[0] ?? b.pos[0], z = bot?.pos?.[1] ?? b.pos[2];
  const a = at(c, x, z);
  if (!a) return false;
  const next = c.pieces[a.P.k + 1];
  if (next && (next.fl & L.RCF_GAP) && a.P.h1 > a.P.h0) {
    const v = b.vel[0] * a.tx + b.vel[2] * a.tz;
    return (1 - a.f) * a.P.len < Math.max(0.8, v * 0.06);
  }
  if (a.P.hzn && (a.P.sec === L.RCS_SPINNERS || a.P.sec === L.RCS_SWEEPERS)) {
    const t = bot?.at ?? view.tick;
    const vx = bot?.vel?.[0] ?? b.vel[0], vz = bot?.vel?.[1] ?? b.vel[2];
    // a bar where it will be in a fifth of a second
    return danger(view, x + vx * 0.2, z + vz * 0.2, t + 25, b) > 0.8 && danger(view, x + vx * 0.5, z + vz * 0.5, t + 62, b) < 0.8;
  }
  return false;
}

export default {
  id: L.MG_RACE, key: 'race', name: 'DOWNHILL',
  hint: 'RACE DOWN TO THE FINISH  HOP THE GAP  DODGE THE BARS',
  env: 'day',

  draw(view, ctx, out) {
    const c = course(view);
    if (!c) return;
    if (!c.geom) c.geom = build(c);
    const sc = out.scene;
    for (const s of c.geom) sc.put(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8], s[9], s[10], s[11], s[12], s[13], s[14]);
    const tp = playTime(view, ctx);
    const now = (ctx?.now ?? 0) / 1000;
    const g = view.party();
    for (const H of c.hazards) {
      if (H.kind === L.RCH_BUMPER) {
        const lit = Math.max(0, 1 - ((ctx?.now ?? 0) - H.hit) / 300);
        sc.cyl(H.x, H.y + L.RC_BUMP_H / 2, H.z, H.l, L.RC_BUMP_H / 2, 0.92, 0.18 + 0.5 * lit, 0.2 + 0.4 * lit, LOOK.PLASTIC);
        sc.cyl(H.x, H.y + L.RC_BUMP_H + 0.08, H.z, H.l * 0.7, 0.1, 1, 0.85, 0.3, LOOK.GLOW, 0.6 + 1.4 * lit, 0.4);
      } else if (H.kind === L.RCH_SPINNER) {
        const an = spinAngle(H, tp);
        sc.cyl(H.x, H.y + 0.9, H.z, L.RC_HUB_R, 0.9, 0.7, 0.72, 0.76, LOOK.METAL);
        sc.cyl(H.x, H.y + 1.85, H.z, L.RC_HUB_R * 0.8, 0.08, 1, 0.3, 0.2, LOOK.GLOW, 0.8);
        const mid = (L.RC_BAR_LO + L.RC_BAR_HI) / 2;
        sc.box(H.x, H.y + mid, H.z, H.l, (L.RC_BAR_HI - L.RC_BAR_LO) / 2, L.RC_BAR_R, an, 1, 0.82, 0.1, LOOK.HAZARD, 0.5, 0, 1, H.j * 7 + 1);
        for (const e of [1, -1]) sc.sphere(H.x + Math.cos(an) * H.l * e, H.y + mid, H.z + Math.sin(an) * H.l * e, 0.5, 0.95, 0.2, 0.15, LOOK.PLASTIC);
      } else if (H.kind === L.RCH_SWEEPER) {
        const o = sweepOff(H, tp), x = H.x - H.dz * o, z = H.z + H.dx * o, yaw = Math.atan2(H.dz, H.dx);
        sc.box(x, H.y + L.RC_SWEEP_HI / 2, z, H.l, L.RC_SWEEP_HI / 2, L.RC_BAR_R, yaw, 0.95, 0.25, 0.2, LOOK.HAZARD, 0.4, 0, 1, H.j * 7 + 2);
        // its track across the lane
        sc.box(H.x, H.y + 0.015, H.z, 0.1, 0.02, H.a + 0.6, yaw, 0.95, 0.3, 0.25, LOOK.GLOW, 0.35, 0, 0.75);
      } else if (H.kind === L.RCH_PAD) {
        // chevrons pointing down the course, lit in a running wave
        const yaw = Math.atan2(H.dz, H.dx);
        for (let i = 0; i < 3; i++) {
          const a = (i - 1) * 1.4, wave = 0.5 + 0.5 * Math.sin(now * 9 - i * 1.6);
          for (const side of [1, -1]) {
            const cx = H.x + H.dx * (a - 0.5) - H.dz * side * 0.75, cz = H.z + H.dz * (a - 0.5) + H.dx * side * 0.75;
            sc.box(cx, H.y + 0.03, cz, 0.85, 0.03, 0.18, yaw - side * 0.62, 0.3, 1, 0.75, LOOK.GLOW, 0.5 + 0.9 * wave, 0, 0.9);
          }
        }
      }
    }
    // the gate: down through the countdown, up and away at GO
    const g0 = c.pieces[0];
    const up = g.state === L.H_COUNT || g.state === L.H_IDLE ? 0 : Math.min(1, tp / 60);
    if (up < 1) {
      const [sx, sy, sz] = along(g0, 1, 0);
      sc.box(sx, sy + 0.9 + up * 5, sz, 0.15, 0.9, g0.w1, Math.atan2(g0.dz, g0.dx), 0.2, 0.75, 0.3, LOOK.GLOW, 0.4, 0.6, 0.85 * (1 - up));
    }
  },

  // the whole course, north up
  frame(view) {
    const c = course(view);
    const g = view.party();
    if (!c) return { centre: [g.cx, g.floor, g.cx], radius: g.size, shape: 'square' };
    const [x0, z0, x1, z1] = c.box;
    return { centre: [(x0 + x1) / 2, (c.top + c.floor) / 2, (z0 + z1) / 2], radius: Math.max(x1 - x0, z1 - z0) / 2, shape: 'square' };
  },

  // a new round faces you down the start
  facing(view) {
    const c = course(view);
    return c ? Math.atan2(c.pieces[0].dz, c.pieces[0].dx) : null;
  },

  fx(f, ctx) {
    const d = typeof ctx.dist === 'function' ? ctx.dist(f.pos) : ctx.dist ?? 0;
    const mine = f.owner === ctx.slot;
    if (f.kind === L.RC_FX_HOME) {
      const place = Math.round(f.size);
      if (mine) { ctx.banner?.(`HOME ${ordinal(place)}!`, place === 1 ? C.YELLOW : C.GREEN, 3000); ctx.sound?.holed?.(); }
      else ctx.feed?.(`${ctx.name?.(f.owner) ?? `P${f.owner + 1}`} HOME ${ordinal(place)}`, place === 1 ? C.YELLOW : C.WHITE);
      for (let i = 0; i < 6; i++) {
        const a = i * 1.047 + f.owner;
        ctx.glow?.({ pos: [f.pos[0] + Math.cos(a) * 1.5, f.pos[1] + 2 + (i & 1), f.pos[2] + Math.sin(a) * 1.5], size: 0.9, color: [[1, 0.85, 0.2], [0.3, 0.9, 1], [1, 0.35, 0.5]][i % 3].concat(1), kind: SPRITE.SPARK, life: 700 });
      }
    } else if (f.kind === L.RC_FX_BUMP) {
      ctx.glow?.({ pos: f.pos, size: 2.2, color: [1, 0.85, 0.35, 0.9], kind: SPRITE.FLASH, life: 260, grow: true });
      ctx.sound?.boing?.(Math.min(24, f.size), mine ? 0 : d);
      const c = course(ctx.view);
      const H = c?.hazards[f.shot];
      if (H) H.hit = ctx.now ?? 0;
    } else if (f.kind === L.RC_FX_CUT) {
      if (mine) ctx.banner?.('NO SHORTCUTS  BACK TO THE CHECKPOINT', C.RED, 2200);
    } else if (f.kind === L.RC_FX_LATE) {
      const who = mine ? 'YOU WIN THE RACE' : `${ctx.name?.(f.owner) ?? `P${f.owner + 1}`} IS HOME`;
      ctx.banner?.(`${who}  ${Math.round(f.size)} S TO FINISH`, C.YELLOW, 3000);
      ctx.sound?.count?.(0);
    }
  },

  // Where you are in the race and how far to go, over the frontend's score
  // lines (a scoring round's SCORE and LEADER, which here would read RC_WIN
  // plus ticks); what's coming; the course as a line with you and the leader
  // on it; a checkpoint as you pass it.
  hud(view, ctx) {
    const c = course(view);
    const g = view.party();
    if (!c || g.state !== L.H_PLAY) return;
    const list = standings(view);
    const me = ctx.me ?? (ctx.slot >= 0 ? view.partier(ctx.slot) : null);
    const mine = me?.live ? list.find((e) => e.slot === me.slot) : null;
    const total = c.fin - c.grid;
    const now = ctx.now ?? 0;
    const blank = ' '.repeat(26);
    ctx.put(1, 0, blank, C.WHITE);
    ctx.put(1, 1, blank, C.WHITE);
    const lead = list[0];
    if (mine) {
      ctx.put(1, 0, mine.home ? `HOME ${ordinal(mine.rank)} OF ${list.length}` : `${ordinal(mine.rank)} OF ${list.length}`, mine.home ? C.GREEN : mine.rank === 1 ? C.YELLOW : C.WHITE);
      if (!mine.home) {
        ctx.put(1, 1, `${Math.max(0, Math.ceil(c.fin - mine.dist))} M TO GO`, C.GREY);
        // what you're on, or the next hazard coming
        const a = at(c, me.pos[0], me.pos[2]);
        if (a) {
          let P = a.P;
          if (P.sec === L.RCS_BEND || P.sec === L.RCS_DROP) P = c.pieces.slice(P.k + 1).find((Q) => Q.sec !== L.RCS_BEND && Q.sec !== L.RCS_DROP && Q.s0 - mine.dist < 45) ?? P;
          const name = SECTION[P.sec];
          if (P.sec !== L.RCS_BEND && P.sec !== L.RCS_DROP && P.sec !== L.RCS_START) ctx.right(3, P === a.P ? name : `${name} AHEAD`, P.sec === L.RCS_FINISH ? C.GREEN : C.ORANGE);
        }
        // a checkpoint passed: said for a second and a half
        const k = c.checks.reduce((n, P, i) => (P.s0 <= mine.dist ? i : n), 0);
        if (!c.hud || c.hud.slot !== me.slot) c.hud = { slot: me.slot, k, at: -1e9 };
        if (k > c.hud.k) { c.hud.k = k; c.hud.at = now; }
        if (k < c.hud.k) c.hud.k = k;
        if (now - c.hud.at < 1500 && k > 0) ctx.centre(4, 'CHECKPOINT', C.GREEN);
      } else ctx.put(1, 1, lead && lead.slot !== me.slot && lead.rank === 1 ? `P${lead.slot + 1} WON IT` : 'WAIT FOR THE REST', C.GREY);
    } else if (lead) ctx.put(1, 0, `LEADER P${lead.slot + 1}`, C.WHITE);
    // the course as a line: the leader, you
    const n = 36, x = COLS - 2 - n;
    const cell = (dist) => Math.max(0, Math.min(n - 1, Math.floor(((dist - c.grid) / total) * n)));
    ctx.put(x - 1, 5, '[', C.GREY);
    ctx.put(x, 5, '-'.repeat(n), C.GREY);
    ctx.put(x + n, 5, ']', C.WHITE);
    if (lead && !lead.home) ctx.put(x + cell(lead.dist), 5, '*', C.YELLOW);
    if (mine && !mine.home) ctx.put(x + cell(mine.dist), 5, '>', C.GREEN);
    const home = list.filter((e) => e.home).length;
    if (home) ctx.right(6, `${home} OF ${list.length} HOME`, C.CYAN);
  },

  brain: { danger, goal, hop, think },
};
