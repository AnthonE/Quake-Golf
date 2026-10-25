// DRUM ROLL, as drawn and as the AI ball sees it. Each drum is its slats,
// DR_N boxes round turned on their side with the renderer's roll, candy
// striped in the drum's colour and cream so the spin shows, each slat cut
// into runs of whole cells so an open slot is a real hole into the dark
// drum inside (a ball dropped in goes into the dark); a cell about to open
// glows red for its last half second. Metal rims and spokes at the ends turn
// with it on an axle held up by an A-frame at each end standing in the sea,
// the rims glowing orange the second before the drum reverses. The HUD
// calls a drum by its colour. Every angle and every cell is
// the sim's tables (src/mg/drums.wat: PG_S, PG_BIG) worked to the frame's
// tick, so what is drawn and what the bots dodge is what the sim does.
import * as L from '../../src/layout.mjs';
import * as MC from '../../src/mg/drums.mjs'; // DR_*: the minigame's own constants
import { PLAT_Y } from '../../src/party-view.mjs';
import { LOOK, SPRITE } from '../party-render.mjs';
import { C } from '../font.mjs';

const TICK = 0.008;
const TAU = 2 * Math.PI;
const SLAT_T = 0.12; // a slat's half thickness, m: its outer face on the shell
const WARN_CELL = 62; // ticks a cell glows before it opens
const PALETTE = [[0.93, 0.25, 0.22], [0.2, 0.52, 0.95], [1, 0.76, 0.12], [0.3, 0.75, 0.32], [0.72, 0.38, 0.92], [1, 0.52, 0.12], [0.15, 0.74, 0.76], [0.95, 0.4, 0.62]];
export const NAMES = ['RED', 'BLUE', 'YELLOW', 'GREEN', 'PURPLE', 'ORANGE', 'TEAL', 'PINK'];
const CORE = MC.DR_R - 1.5; // the dark drum inside the slats: a slot is a hole into it
const CREAM = [0.97, 0.94, 0.86];
// the ball's knobs on a drum (src/mg/drums.mjs), per second
const A_PUSH = Number(L.BPHYS.B_ACC_DT) * MC.DR_ACC / TICK; // 16.5 m/s^2 flat out
const K_KEYS = (1 - MC.DR_DRAG) / TICK; // the surface's grip with keys held, 1/s
const K_IDLE = (1 - MC.DR_IDLE) / TICK; // and with none
const G = Number(L.PHYS.GP_DT) / TICK; // 20 m/s^2
const SLOPE = MC.DR_GRAV * G / MC.DR_RC2; // m/s^2 down the slope, times dz h

// ---- the drums: the header and the tables, read once a round

let memo = null;
// This round's drums on the view's bank (PG_H) with the spin and the cells
// (PG_S, PG_BIG, the confirmed world's): read again while the countdown may
// still lay them out again.
export function stage(view) {
  const dv = view.dv, o = view.bank || 0;
  const u = (a) => dv.getUint32(a + o, true), f = (a) => dv.getFloat32(a + o, true);
  const seed = u(L.HDR_SEED), hole = u(L.HDR_HOLE), state = u(L.HDR_STATE);
  const K = u(L.PG_H + MC.DR_K), M = u(L.PG_H + MC.DR_M), x0 = f(L.PG_H + MC.DR_X0);
  const fixed = state === L.H_PLAY || state === L.H_OVER;
  const m = memo;
  if (m && m.fixed && fixed && m.seed === seed && m.hole === hole && m.K === K && m.M === M && m.x0 === x0) { m.start = u(L.HDR_START); return m; }
  const s = {
    seed, hole, K, M, x0, fixed, start: u(L.HDR_START),
    x1: f(L.PG_H + MC.DR_X1), z0: f(L.PG_H + MC.DR_Z0), ya: f(L.PG_H + MC.DR_YA), cx: f(L.PG_CX), size: f(L.PG_SIZE),
    ang: new Int32Array(Math.max(1, K) * MC.DR_NPH), rate: new Int32Array(Math.max(1, K) * MC.DR_NPH), cells: new Uint16Array(Math.max(1, K * M) * MC.DR_N),
  };
  if (K > MC.DR_KMAX || M > MC.DR_MMAX) { s.K = 0; return s; }
  for (let q = 0; q < K * MC.DR_NPH; q++) {
    s.ang[q] = dv.getInt32(L.PG_S + MC.DR_ANG + 4 * q, true);
    s.rate[q] = dv.getInt32(L.PG_S + MC.DR_RATE + 4 * q, true);
  }
  for (let i = 0; i < K; i++) for (let mm = 0; mm < M; mm++) for (let c = 0; c < MC.DR_N; c++) {
    s.cells[(i * M + mm) * MC.DR_N + c] = dv.getUint16(L.PG_BIG + MC.DR_CELLS + 2 * ((i * MC.DR_MMAX + mm) * MC.DR_N + c), true);
  }
  memo = s;
  return s;
}
export const phaseOf = (t) => Math.min(Math.max(0, Math.floor(t / MC.DR_PH)), MC.DR_NPH - 1);
// Drum i's angle on tick t into play as $dr_phi has it, 2^-32 turn (i32).
export function phiAt(s, i, t) {
  const j = phaseOf(t), q = i * MC.DR_NPH + j;
  return (s.ang[q] + Math.imul(s.rate[q], t - j * MC.DR_PH)) | 0;
}
// The same in turns, 0 to 1, for a fractional tick (drawn between ticks).
export function angleAt(s, i, t) {
  const j = phaseOf(t), q = i * MC.DR_NPH + j;
  const a = (s.ang[q] >>> 0) / 2 ** 32 + s.rate[q] * (t - j * MC.DR_PH) / 2 ** 32;
  return a - Math.floor(a);
}
// Drum i's surface on tick t, m/s (+: its top toward +z).
export const speedAt = (s, i, t) => s.rate[i * MC.DR_NPH + phaseOf(t)] * MC.DR_U;
export const zOf = (s, i) => s.z0 + i * MC.DR_P;
export const drumOf = (s, z) => Math.max(0, Math.min(s.K - 1, Math.round((z - s.z0) / MC.DR_P)));
export const colOf = (s, x) => Math.max(0, Math.min(s.M - 1, Math.floor((x - s.x0) / MC.DR_SEG)));
// The tick cell (m along, slat c round from the drum's own 0) of drum i opens (0xffff never).
export const openAt = (s, i, m, c) => s.cells[(i * s.M + m) * MC.DR_N + c];
// The slat of drum i the way (dz, dy) points from its axis on tick t.
export function slatAt(s, i, dz, dy, t) {
  let a = Math.atan2(dz, dy) / TAU - angleAt(s, i, t);
  a -= Math.floor(a);
  return Math.min(MC.DR_N - 1, Math.floor(a * MC.DR_N));
}
// A slot there on tick t?
export const holeAt = (s, i, x, dz, dy, t) => t >= openAt(s, i, colOf(s, x), slatAt(s, i, dz, dy, t));
// $dr_ground for steering: the top under (x, z) on tick t, or -1000.
export function groundAt(s, x, z, t) {
  if (!(s.K > 0) || x < s.x0 || x >= s.x1) return -1000;
  const i = drumOf(s, z), dz = z - zOf(s, i);
  if (Math.abs(dz) >= MC.DR_ZS) return -1000;
  const h = Math.sqrt(MC.DR_RC2 - dz * dz);
  return holeAt(s, i, x, dz, h, t) ? -1000 : s.ya + h - 1;
}
// Does drum i reverse as phase j begins?
export const flips = (s, i, j) => j >= 1 && j < MC.DR_NPH && (s.rate[i * MC.DR_NPH + j] > 0) !== (s.rate[i * MC.DR_NPH + j - 1] > 0);
// Ticks till drum i next reverses from tick t (Infinity if it doesn't again).
export function nextFlip(s, i, t) {
  for (let j = phaseOf(t) + 1; j < MC.DR_NPH; j++) if (flips(s, i, j) && j * MC.DR_PH > t) return j * MC.DR_PH - t;
  return Infinity;
}
// Cells open on tick t, all drums.
export function openCount(s, t) {
  let n = 0;
  for (let k = 0; k < s.K * s.M * MC.DR_N; k++) if (s.cells[k] <= t) n++;
  return n;
}
// Ticks into play to draw at: the prediction's clock in play, the world's through the result, 0 before.
function drawTicks(view, g, ctx) {
  if (g.state === L.H_PLAY) return Math.max(0, (typeof ctx?.ptick === 'number' ? ctx.ptick : g.tick + (ctx?.dt || 0) / TICK) - g.start);
  if (g.state === L.H_OVER) return Math.max(0, g.tick + (ctx?.dt || 0) / TICK - g.start);
  return 0;
}

// ---- drawing

// Drum i at tick tt: its slats in runs of the cells that are there, the
// cells about to open glowing; rims, spokes, the axle; the stands.
function drum(sc, s, i, tt, now) {
  const z = zOf(s, i), ya = s.ya, R = MC.DR_R, N = MC.DR_N, M = s.M;
  const phi = angleAt(s, i, tt) * TAU;
  const col = PALETTE[i % PALETTE.length];
  const hw = 0.5 * (TAU * R / N) * 0.93, rs = R - SLAT_T;
  const blink = 0.6 + 0.4 * Math.sin(now / 70);
  for (let c = 0; c < N; c++) {
    const th = phi + (c + 0.5) / N * TAU;
    const y = ya + rs * Math.cos(th), zz = z + rs * Math.sin(th);
    const rgb = c & 1 ? CREAM : col;
    // runs along x of cells in one state: 0 there, 1 about to open
    let m = 0;
    while (m < M) {
      const st = (k) => { const o = openAt(s, i, k, c); return tt >= o ? 2 : o - tt < WARN_CELL ? 1 : 0; };
      const a = st(m);
      let b = m;
      while (b + 1 < M && st(b + 1) === a) b++;
      if (a !== 2) {
        const hx = (b - m + 1) * MC.DR_SEG / 2 - 0.05, xc = s.x0 + (m + b + 1) * MC.DR_SEG / 2;
        if (a === 0) sc.box(xc, y, zz, hx, SLAT_T, hw, 0, ...rgb, LOOK.PLASTIC, 0, 0, 1, i * 97 + c, th);
        else sc.box(xc, y, zz, hx, SLAT_T, hw, 0, 1, 0.22, 0.12, LOOK.GLOW, 0.5 + 0.7 * blink, 0.3, 1, i * 97 + c, th);
      }
      m = b + 1;
    }
  }
  // the ends: rims round the slats' ends, glowing the second before a reversal; spokes; the axle
  const flip = nextFlip(s, i, tt) < MC.DR_WARN;
  const rimH = 0.5 * (TAU * R / N) * 1.02;
  for (const xe of [s.x0 - 0.16, s.x1 + 0.16]) {
    for (let c = 0; c < N; c++) {
      const th = phi + (c + 0.5) / N * TAU;
      const y = ya + (R - 0.1) * Math.cos(th), zz = z + (R - 0.1) * Math.sin(th);
      if (flip) sc.box(xe, y, zz, 0.16, 0.24, rimH, 0, 1, 0.55, 0.1, LOOK.GLOW, 0.4 + 0.8 * blink, 0.4, 1, i * 31 + c, th);
      else sc.box(xe, y, zz, 0.16, 0.24, rimH, 0, 0.78, 0.8, 0.84, LOOK.METAL, 0, 0, 1, i * 31 + c, th);
    }
    for (let k = 0; k < 4; k++) {
      const th = phi + k / 4 * TAU;
      sc.box(xe, ya + R / 2 * Math.cos(th), z + R / 2 * Math.sin(th), 0.1, R / 2 - 0.2, 0.16, 0, 0.62, 0.64, 0.7, LOOK.METAL, 0, 0, 1, i * 7 + k, th);
    }
  }
  const len = s.x1 - s.x0;
  sc.cyl((s.x0 + s.x1) / 2, ya, z, 0.45, len / 2 + 1.6, 0.55, 0.57, 0.62, LOOK.METAL, 0, 0, 1, i, Math.PI / 2, -Math.PI / 2);
  sc.cyl((s.x0 + s.x1) / 2, ya, z, CORE, len / 2 - 0.1, 0.07, 0.07, 0.09, LOOK.MATTE, 0, 0, 1, i, Math.PI / 2, -Math.PI / 2);
  // an A-frame at each end, from the axle down into the sea
  const spread = 6, lean = Math.atan2(spread, ya), legH = Math.hypot(spread, ya) / 2;
  for (const xs of [s.x0 - 1.9, s.x1 + 1.9]) {
    sc.box(xs, ya, z, 0.5, 0.75, 0.75, 0, 0.36, 0.38, 0.44, LOOK.METAL, 0, 0, 1, i * 3);
    for (const side of [-1, 1]) sc.box(xs, ya / 2, z + side * spread / 2, 0.32, legH, 0.32, 0, 0.42, 0.44, 0.5, LOOK.METAL, 0, 0, 1, i * 5 + side + 1, -side * lean);
  }
}

// Which way a drum's top runs at u m/s, said from a ball facing yaw.
function runs(yaw, u) {
  const c = Math.cos(yaw), s = Math.sin(yaw), sg = Math.sign(u);
  const ahead = s * sg, right = c * sg; // the top along (0, sg): forward (c, s), right (-s, c)
  if (ahead > 0.6) return 'AWAY FROM YOU';
  if (ahead < -0.6) return 'TOWARD YOU';
  return right > 0 ? 'TO YOUR RIGHT' : 'TO YOUR LEFT';
}

// ---- the AI ball

// The ticks till a slot of drum i, cell m along, comes under a ball standing
// dz across from the axis (a margin of `pad` m either side round the shell),
// looking ahead h ticks from t in steps of 4; Infinity if none does.
function slotIn(s, i, m, dz, t, h, pad = 0.55) {
  const psi = Math.atan2(dz, Math.sqrt(Math.max(0, MC.DR_RC2 - dz * dz))) / TAU, dp = pad / (TAU * MC.DR_R);
  for (let k = 0, tau = t; tau <= t + h; tau += 4, k++) {
    const phi = angleAt(s, i, tau);
    let a = psi - dp - phi; a -= Math.floor(a);
    let b = psi + dp - phi; b -= Math.floor(b);
    const ca = Math.floor(a * MC.DR_N) % MC.DR_N, cb = Math.floor(b * MC.DR_N) % MC.DR_N;
    if (openAt(s, i, m, ca) <= tau || openAt(s, i, m, cb) <= tau) return tau - t;
  }
  return Infinity;
}
// Balls in by drum and cell along, once a world tick.
function crowdOf(view, s) {
  if (s.crowd?.tick === view.tick && s.crowd.bank === view.bank) return s.crowd.n;
  const n = new Uint16Array(Math.max(1, s.K * s.M));
  for (let p = 0; p < L.NPLAYER; p++) {
    const b = L.PLAYERS + view.bank + p * L.PSIZE;
    if ((view.u8[b + L.P_FL] & (L.PF_LIVE | L.PF_DEAD | L.PF_FALL)) !== L.PF_LIVE) continue;
    const x = view.dv.getFloat32(b + L.P_PX, true), z = view.dv.getFloat32(b + L.P_PZ, true);
    if (x < s.x0 || x >= s.x1) continue;
    n[drumOf(s, z) * s.M + colOf(s, x)]++;
  }
  s.crowd = { tick: view.tick, bank: view.bank, n };
  return n;
}
const ball = (view, me) => (typeof me === 'number' ? view.partier(me) : me);

// What the ball wants on tick `tick` (its word's), from a world `tick -
// view.tick` old. On its drum: the cell along it that no slot reaches
// soonest within its horizon (near ones first, a crowded one less), and
// over its top, as a velocity it steers for against the surface's pull and
// the slope, choosing keys or none by which gets nearer the push it wants.
// Cornered by a slot there's no stepping aside from: a hop over it as it
// comes. Carried far down a side, a drum about to reverse on it, or a crowd
// on its own drum and room on the next: across to that one, flat out, a hop
// at the edge, steering for its top in the air.
export function plan(view, me, bot, tick) {
  const g = view.party();
  if (g.state !== L.H_PLAY) return null;
  me = ball(view, me);
  if (!me?.live || me.out || me.falling) return null;
  const s = stage(view);
  if (!(s.K > 0)) return null;
  const mem = bot?.mem || {};
  const skill = bot?.skill ?? 0.6;
  const t = Math.max(0, (tick - g.start) | 0);
  const lag = Math.max(0, Math.min(40, (tick - view.tick) | 0)) * TICK;
  const vx = me.vel[0], vz = me.vel[2];
  const x = me.pos[0] + vx * lag, z = me.pos[2] + vz * lag;
  const i = drumOf(s, z), zc = zOf(s, i), dz = z - zc;
  const ground = me.ground;
  const u = speedAt(s, i, t);
  // a transfer under way: kept till it lands on the drum it was for, or gives up
  if (mem.to !== undefined && (t > mem.until || (ground && i === mem.to && Math.abs(dz) < 3))) mem.to = undefined;
  const crowd = crowdOf(view, s);
  const H = Math.round((0.6 + 0.9 * skill) / TICK);
  // the cell along to stand on: the latest slot within the horizon, near ones and quiet ones first
  const m0 = colOf(s, x);
  let best = -Infinity, bm = m0, hit0 = Infinity, hitBest = Infinity;
  for (let m = Math.max(0, m0 - 2); m <= Math.min(s.M - 1, m0 + 2); m++) {
    const hit = slotIn(s, i, m, 0, t, H);
    if (m === m0) hit0 = slotIn(s, i, m, dz, t, H);
    const xt = Math.max(s.x0 + 1.6, Math.min(s.x1 - 1.6, s.x0 + (m + 0.5) * MC.DR_SEG));
    const go = Math.abs(xt - x) / 6 + (m === m0 ? 0 : 0.15);
    const score = Math.min(hit, H) * TICK - 1.3 * go - 0.25 * Math.max(0, crowd[i * s.M + m] - (m === m0 ? 1 : 0)) + (mem.m === m ? 0.12 : 0);
    if (score > best) { best = score; bm = m; hitBest = hit; }
  }
  mem.m = bm;
  const xt = Math.max(s.x0 + 1.6, Math.min(s.x1 - 1.6, s.x0 + (bm + 0.5) * MC.DR_SEG));
  // across to a neighbour? (when it's on the ground and not already going)
  if (mem.to === undefined && ground) {
    const side = Math.sign(dz) || 1, down = Math.sign(u) || side;
    const total = (j) => { let n = 0; for (let k = j * s.M; k < (j + 1) * s.M; k++) n += crowd[k]; return n; };
    const clear = (j) => j >= 0 && j < s.K && slotIn(s, j, colOf(s, x), 0, t + 110, 200) > 200;
    let to = -1;
    // a slot coming and nowhere along this drum it doesn't: ahead of it, with the spin, to the next drum that way
    if (hit0 < Math.round(0.9 / TICK) && hitBest < hit0 + 40 && clear(i + down)) to = i + down;
    // carried far down a side and still going: the drum that way
    else if (Math.abs(dz) > 4.4 && dz * vz > 0 && Math.abs(vz) > 2) to = i + side;
    // a crowd here, room next door: now and then
    else if (((t + me.slot * 37) % 625) < 4) {
      const here = total(i);
      for (const j of [i - down, i + down]) if (j >= 0 && j < s.K && here - total(j) >= 3 && clear(j)) { to = j; break; }
    }
    if (to >= 0 && to < s.K) { mem.to = to; mem.until = t + 300; }
  }
  const T = mem.to ?? i;
  if (T !== i || !ground) {
    // across: flat out at the drum it's for (its top, against its spin), a hop at the edge
    const zt = zOf(s, T) - Math.sign(speedAt(s, T, t)) * 0.6;
    const sg = Math.sign(zt - z);
    const hop = ground && T !== i && Math.abs(dz) > 3.1 && dz * sg > 0 && vz * sg > 4.5;
    return { yaw: Math.atan2(ground && T !== i ? sg * 3 : zt - z, (xt - x) * (ground ? 0.3 : 1)), move: 1, hop, m: bm, to: T };
  }
  // a slot it can't step aside from in time: hop it as it comes
  const hopSlot = hit0 <= 14 && hit0 >= 2 && (bm === m0 || hitBest < 40);
  // over the top, a little upstream: the velocity it wants, and the push that gets it there
  const h = Math.sqrt(Math.max(0, MC.DR_RC2 - dz * dz));
  const want = (0.35 * skill + 0.25) * -Math.sign(u);
  const vzWant = Math.max(-5, Math.min(5, -2.6 * (dz - want)));
  const vxWant = Math.max(-6, Math.min(6, 2.2 * (xt - x)));
  const uh = u * h / MC.DR_RC, slope = SLOPE * dz * h;
  const axWant = (vxWant - vx) / 0.18, azWant = (vzWant - vz) / 0.18;
  // keys: the push toward what's left once the surface and the slope have had theirs
  let px = axWant + K_KEYS * vx, pz = azWant - K_KEYS * (uh - vz) - slope;
  const pl = Math.hypot(px, pz) || 1;
  const kx = A_PUSH * px / pl - K_KEYS * vx, kz = A_PUSH * pz / pl + K_KEYS * (uh - vz) + slope;
  const ix = -K_IDLE * vx, iz = K_IDLE * (uh - vz) + slope;
  const keys = Math.hypot(kx - axWant, kz - azWant) <= Math.hypot(ix - axWant, iz - azWant);
  return { yaw: Math.atan2(pz, px), move: keys ? 1 : 0, hop: hopSlot, m: bm, to: T };
}

export default {
  id: L.MG_DRUMS, key: 'drums', name: 'DRUM ROLL',
  hint: 'STAY ON THE SPINNING DRUMS  ROLL AGAINST THE SPIN  MIND THE SLOTS',
  rules: 'OFF A DRUM OR THROUGH A SLOT AND YOU ARE OUT  THE LAST ONE ON WINS',
  env: 'day',

  draw(view, ctx, out) {
    const s = stage(view);
    if (!(s.K > 0)) return;
    const g = view.party();
    const tt = drawTicks(view, g, ctx);
    const now = ctx?.now ?? 0;
    for (let i = 0; i < s.K; i++) drum(out.scene, s, i, tt, now);
  },

  // the row of drums
  frame(view) {
    const g = view.party();
    const s = stage(view);
    return { centre: [g.cx, PLAT_Y - MC.DR_R / 2, g.cx], radius: (s.K > 0 ? s.size : g.size) + 1, shape: 'square' };
  },

  // against your drum's spin: the slots come up over the top at you
  facing(view, slot) {
    const s = stage(view);
    if (!(s.K > 0) || slot < 0) return null;
    const b = view.partier(slot);
    const u = speedAt(s, drumOf(s, b.pos[2]), 0);
    return u > 0 ? -Math.PI / 2 : Math.PI / 2;
  },

  fx(f, ctx) {
    const d = typeof ctx.dist === 'function' ? ctx.dist(f.pos) : ctx.dist ?? 0;
    const s = memo;
    const me = ctx.slot >= 0 && ctx.view ? ctx.view.partier(ctx.slot) : null;
    const onIt = (i) => s && me?.live && !me.out && drumOf(s, me.pos[2]) === i;
    if (f.kind === MC.DR_FX_WARN) {
      if (onIt(f.shot)) { ctx.banner?.(`THE ${NAMES[f.shot % NAMES.length]} DRUM REVERSES!`, C.ORANGE, 1200); ctx.sound?.count?.(1); }
      else if (d < 40) ctx.sound?.tick?.();
    } else if (f.kind === MC.DR_FX_FLIP) {
      ctx.glow?.({ pos: [f.pos[0], f.pos[1] + 0.5, f.pos[2]], size: 5, color: [1, 0.6, 0.2, 0.6], kind: SPRITE.FLASH, life: 500, grow: true });
      if (onIt(f.shot) || d < 30) ctx.sound?.land?.(24);
    } else if (f.kind === MC.DR_FX_FAST) {
      if (f.shot % 3 === 0) ctx.feed?.(`THE DRUMS SPEED UP  ${f.size.toFixed(1)} M/S`, C.YELLOW);
    } else if (f.kind === MC.DR_FX_DROP) {
      ctx.glow?.({ pos: [f.pos[0], f.pos[1] + 1, f.pos[2]], size: 2.6, color: [1, 0.35, 0.2, 0.8], kind: SPRITE.RING, life: 450, grow: true });
      if (f.owner === ctx.slot) ctx.banner?.('THROUGH A SLOT!', C.RED, 1200);
      if (f.owner === ctx.slot || d < 30) ctx.sound?.land?.(30);
    }
  },

  // a ball out inside a drum went through a slot
  sink(f, name, view) {
    const s = stage(view);
    if (!(s.K > 0) || f.pos[0] < s.x0 || f.pos[0] >= s.x1) return null;
    const i = drumOf(s, f.pos[2]);
    if (Math.abs(f.pos[2] - zOf(s, i)) > MC.DR_R - 0.5) return null;
    return f.shot === 255 ? `${name(f.owner)} DROPPED THROUGH A SLOT` : `${name(f.owner)} KNOCKED INTO A SLOT BY ${name(f.shot)}`;
  },

  // the drums and the fastest, which way yours runs (said from the way you face) and when it turns, the slots open
  hud(view, ctx) {
    const g = view.party();
    if (g.state !== L.H_PLAY) return;
    const s = stage(view);
    if (!(s.K > 0)) return;
    const t = g.t;
    let top = 0;
    for (let i = 0; i < s.K; i++) top = Math.max(top, Math.abs(speedAt(s, i, t)));
    ctx.right(2, `${s.K} DRUMS  FASTEST ${top.toFixed(1)} M/S`, C.GREY);
    ctx.right(4, `${openCount(s, t)} SLOTS OPEN`, C.GREY);
    const me = ctx.me ?? (ctx.slot >= 0 ? view.partier(ctx.slot) : null);
    if (!me?.live || me.out || me.falling) return;
    const i = drumOf(s, me.pos[2]);
    if (Math.abs(me.pos[2] - zOf(s, i)) > MC.DR_RC) return;
    const u = speedAt(s, i, t), fl = nextFlip(s, i, t);
    if (fl < 2 * MC.DR_WARN) ctx.right(3, `THE ${NAMES[i % NAMES.length]} DRUM REVERSES IN ${(fl * TICK).toFixed(1)}`, C.ORANGE);
    else ctx.right(3, `THE ${NAMES[i % NAMES.length]} DRUM RUNS ${runs(me.yaw, u)}  ${Math.abs(u).toFixed(1)} M/S`, C.CYAN);
  },

  brain: {
    // off the drums, over a gap, past an end or over a slot on that tick: a fall; far down a side, a risk
    danger(view, x, z, tick) {
      const g = view.party();
      const s = stage(view);
      if (!(s.K > 0)) return 0;
      const t = Math.max(0, (tick - g.start) | 0);
      if (groundAt(s, x, z, t) < -999) return 1;
      const dz = Math.abs(z - zOf(s, drumOf(s, z)));
      return dz > 4.5 ? 0.4 : dz > 3 ? 0.15 : 0;
    },
    // the top of its drum over the cell it picked
    goal(view, me, bot) {
      const p = plan(view, me, bot, bot?.at ?? view.tick);
      if (!p) return null;
      const s = stage(view);
      return [Math.max(s.x0 + 1.6, Math.min(s.x1 - 1.6, s.x0 + (p.m + 0.5) * MC.DR_SEG)), zOf(s, p.to)];
    },
    hop() { return false; },
    think(view, me, bot, tick = view.tick) {
      const p = plan(view, me, bot, tick);
      return p ? { yaw: p.yaw, move: p.move, hop: p.hop } : null;
    },
  },
};
