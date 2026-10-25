// RISING LAVA, as drawn and as the AI ball sees it. A crater of lava, glowing
// orange under a crust of dark plates drifting on it, sparks rising off it;
// in its middle a shelf of basalt and a tower of grey rock banded in strata,
// the route a band of warm brown stone winding up its side: the first turn
// a solid ramp of rock off the shelf, the turns over it slabs on the tower,
// ramps stepping up, steps in two tones, gaps and sliders with hazard lips,
// the slider's platform striped yellow, ledges with a red edge, boulders
// rolling down their ramps from the lips over them; on the summit a gold
// crown, and over it a gold ring where the balls home bob in their order.
// The route, the slider and the boulders are the sim's (src/mg/lava.wat):
// its sections read from PG_S, worked here in doubles at the prediction's
// tick, so what is drawn and what the bots dodge is what the sim does. The
// lava's heights are its table, at the same tick.
import * as L from '../../src/layout.mjs';
import * as MC from '../../src/mg/lava.mjs'; // LV_*: the minigame's own constants
import { PLAT_Y, P_STEP, hash32 } from '../../src/party-view.mjs';
import { LOOK, SPRITE, DECAL, COLS } from '../party-render.mjs';
import { C } from '../font.mjs';

const TICK = 0.008;
const TAU = 2 * Math.PI;
const BR = 1; // a ball's radius
const SLAB = 1.2; // m a slab of the turns over the first is thick
const PIECE = 1.1; // m of route a slab of a ramp
const ROCK = {
  shelf: [0.2, 0.17, 0.16], tower: [0.31, 0.28, 0.27], strata: [0.38, 0.32, 0.28], summit: [0.6, 0.54, 0.46],
  route: [0.47, 0.38, 0.31], boulderRamp: [0.52, 0.36, 0.27], step: [[0.56, 0.48, 0.39], [0.43, 0.37, 0.31]],
  pad: [0.42, 0.38, 0.35], ledge: [0.39, 0.35, 0.33], start: [0.3, 0.27, 0.27], rim: [0.17, 0.13, 0.12], boulder: [0.36, 0.3, 0.27],
  rail: [0.34, 0.29, 0.26],
};
const LAVA = [1, 0.42, 0.06];
const GOLD = [1, 0.78, 0.2];
const slotColor = (s) => { const h = (s * 0.618034) % 1; return [0, 0.33, 0.67].map((o) => 0.55 + 0.4 * Math.cos(6.2832 * (h + o))); };
const ordinal = (n) => `${n}${[, 'ST', 'ND', 'RD'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'TH'}`;

// ---- the stage, read once a layout

let memo = null;
// This round's tower and route on the view's bank (PG_H) and its sections and
// the lava's table (PG_S, the confirmed world's), or null before one is laid.
// Re-read when the countdown lays it again for a newcomer.
export function stage(view) {
  const dv = view.dv, o = view.bank || 0;
  const hf = (k) => dv.getFloat32(L.PG_H + k + o, true), hu = (k) => dv.getUint32(L.PG_H + k + o, true);
  const seed = dv.getUint32(L.HDR_SEED + o, true), hole = dv.getUint32(L.HDR_HOLE + o, true);
  const ns = hu(MC.LV_NSEC), W = hf(MC.LV_W), send = hf(MC.LV_SEND);
  if (memo && memo.seed === seed && memo.hole === hole && memo.ns === ns && memo.W === W && memo.send === send) return memo;
  if (!(ns > 0) || ns > MC.LV_NS || !(W > 0) || !(send > 0)) return null;
  const secs = [];
  for (let j = 0; j < ns; j++) {
    const a = L.PG_S + MC.LV_SEC + j * MC.LV_SSIZE;
    const f = (k) => dv.getFloat32(a + k, true), u = (k) => dv.getUint32(a + k, true);
    secs.push({ j, kind: u(MC.LV_S_KIND), fl: u(MC.LV_S_FL), s0: f(MC.LV_S_S0), len: f(MC.LV_S_LEN), h0: f(MC.LV_S_H0), h1: f(MC.LV_S_H1),
      a: f(MC.LV_S_A), g: f(MC.LV_S_G), p: u(MC.LV_S_P), ph: u(MC.LV_S_PH), d: f(MC.LV_S_D) });
  }
  const cx = dv.getFloat32(L.PG_CX + o, true);
  const rt = MC.LV_RT, rm = hf(MC.LV_RM), rb = hf(MC.LV_RB);
  const st = {
    seed, hole, ns, W, send, secs, cx, rt, rm, rb, w: W / 2, ro: rt + W, C: hf(MC.LV_C), ht: PLAT_Y + hf(MC.LV_HT), hTop: hf(MC.LV_HT),
    ths: hf(MC.LV_THS), hend0: hf(MC.LV_HEND0),
    idx: view.u8.slice(L.PG_S + MC.LV_IDX, L.PG_S + MC.LV_IDX + MC.LV_NIDX),
    lav: Array.from({ length: MC.LV_NPH + 1 }, (_, j) => dv.getFloat32(L.PG_S + MC.LV_LAV + 4 * j, true)),
    rate: Array.from({ length: MC.LV_NPH }, (_, j) => dv.getFloat32(L.PG_S + MC.LV_RATE + 4 * j, true)),
    rim: rb * 1.25 + 26, geom: null, bcache: new Map(),
  };
  st.startEnd = secs[0].len;
  memo = st;
  return st;
}

// The angle of (dx, dz) round the tower in turns [0, 1), as $lv_turns (to its 1e-5 rad).
export const turns = (dx, dz) => { const a = Math.atan2(dz, dx) / TAU; return a < 0 ? (a + 1 >= 1 ? 0 : a + 1) : a; };
// The section holding s along the route, or null off either end.
export function secAt(st, s) {
  if (!(s >= 0) || s >= st.send) return null;
  let j = st.idx[Math.floor(s)];
  if (j >= st.ns) j = st.ns - 1;
  if (s >= st.secs[j].s0 + st.secs[j].len && j + 1 < st.ns) j++;
  return st.secs[j];
}
// A slider's platform on tick t into play (fractional for drawing): how far into its gap its near end is ($lv_slide).
export function slide(S, t) {
  const half = S.p >> 1, mv = half - MC.LV_SL_DW;
  const q = (((t + S.ph) % S.p) + S.p) % S.p;
  if (q < MC.LV_SL_DW) return 0;
  if (q < half) return S.d * (q - MC.LV_SL_DW) / mv;
  if (q < half + MC.LV_SL_DW) return S.d;
  return S.d - S.d * (q - half - MC.LV_SL_DW) / mv;
}
// A ledge's width from the tower f along it: the route's at its ends, narrowing over LV_TAPER.
export const ledgeWidth = (st, S, f) => st.W + (S.a - st.W) * Math.min(1, Math.min(f, S.len - f) / MC.LV_TAPER);
// The route at s, u across its middle (-W/2 at the tower), on tick t: { top (-1000 none), h over the shelf (as if floored), S }.
const FL = { top: -1000, h: 1000, S: null };
export function floorAt(st, s, u, t, out = FL) {
  const S = secAt(st, s);
  out.S = S;
  if (!S) { out.top = -1000; out.h = 1000; return out; }
  const f = s - S.s0;
  let h = S.h0, on = true;
  if (S.kind === MC.LV_RAMP || S.kind === MC.LV_LEDGE) h = S.h0 + (S.h1 - S.h0) * f / S.len;
  else if (S.kind === MC.LV_STEPS) h = S.h0 + Math.min(Math.max(0, Math.floor(f / S.a)), S.g) * MC.LV_STEP_H;
  if (S.kind === MC.LV_GAP || S.kind === MC.LV_SLIDER) {
    let g = f - S.a;
    if (g >= 0 && g < S.g) {
      on = false;
      if (S.kind === MC.LV_SLIDER) { g -= slide(S, t); on = g >= 0 && g < MC.LV_SL_L; }
    }
  }
  if (S.kind === MC.LV_LEDGE) on = u + st.w <= ledgeWidth(st, S, f);
  out.h = h;
  out.top = on ? PLAT_Y + h : -1000;
  return out;
}
// The lava's top on tick t into play.
export function lavaAt(st, t) {
  if (t < MC.LV_STILL) return st.lav[0];
  const k = t - MC.LV_STILL;
  const j = Math.min(Math.floor(k / MC.LV_PH), MC.LV_NPH - 1);
  return st.lav[j] + st.rate[j] * (k - j * MC.LV_PH);
}
// The lava's pace on tick t into play, m/s (0 while it's still).
export const paceAt = (st, t) => (t < MC.LV_STILL ? 0 : st.rate[Math.min(Math.floor((t - MC.LV_STILL) / MC.LV_PH), MC.LV_NPH - 1)] / TICK);
// The point s along the route, u across: [x, z].
export function routeXZ(st, s, u) {
  const a = (s / st.C) * TAU, r = st.rm + u;
  return [st.cx + r * Math.cos(a), st.cx + r * Math.sin(a)];
}
// Where a ball at (x, y, z) is as $lv_push reckons it: its radius and angle round the tower, across, over the band,
// its turn (the highest whose floor's top it's no more than LV_DEEP under; the first if none), along on it, the section.
export function where(st, x, y, z, out = {}) {
  const dx = x - st.cx, dz = z - st.cx;
  out.rho = Math.hypot(dx, dz);
  out.th = turns(dx, dz);
  out.u = out.rho - st.rm;
  out.inb = out.rho >= st.rt && out.rho <= st.ro;
  out.band = out.rho >= st.rt && out.rho < st.ro + BR;
  out.kb = -1; out.sb = 0; out.S = null;
  if (!out.band) return out;
  const F = { top: 0, h: 0, S: null };
  for (let k = 0; ; k++) {
    const s = (out.th + k) * st.C;
    if (s >= st.send) break;
    floorAt(st, s, out.u, 0, F);
    if (PLAT_Y + F.h - MC.LV_DEEP > y) break;
    out.kb = k; out.sb = s;
  }
  if (out.kb < 0) { out.kb = 0; out.sb = out.th * st.C; }
  out.S = secAt(st, out.sb);
  return out;
}

// The boulders on boulder ramp S on tick t into play (fractional for drawing), as $lv_push has them:
// [{ l, k, s, u, x, y (its centre), z, v (m/s down), drop (1 to 0 while it drops in), rolled (m) }].
export function boulders(st, S, t) {
  if (!S || S.kind !== MC.LV_RAMP || !(S.fl & MC.LV_F_BOULDERS)) return [];
  const key = S.j * 1e7 + t;
  const hit = st.bcache.get(key);
  if (hit) return hit;
  const list = [];
  const m = S.p, kk = S.ph | 0;
  for (let l = 0; l < m; l++) {
    const per = MC.LV_BP0 + hash32(l, 1, kk) % MC.LV_BPN;
    const base = MC.LV_B0 + hash32(l, 2, kk) % per;
    if (t < base) continue;
    const bk = Math.floor((t - base) / per);
    for (let k = Math.max(0, bk - 2); k <= bk; k++) {
      const t0 = base + k * per + hash32(l, k, kk ^ 0x5bd1) % MC.LV_BJ;
      const age = t - t0;
      if (age < 0) continue;
      const v = (MC.LV_BV0 + MC.LV_BVK * ((hash32(k, l, kk ^ 0x7e3a) >>> 8) * 2 ** -24)) * TICK;
      let s = S.s0 + S.len - MC.LV_BR, yb = 0, drop = 0;
      if (age < MC.LV_BDROP) { const q = age / MC.LV_BDROP; yb = MC.LV_BDH * (1 - q * q); drop = 1 - q; } else s -= (age - MC.LV_BDROP) * v;
      if (s < S.s0) continue;
      const u = ((l + 0.5) / m) * st.W - st.w;
      const [x, z] = routeXZ(st, s, u);
      list.push({ l, k, s, u, x, z, y: PLAT_Y + S.h0 + (S.h1 - S.h0) * (s - S.s0) / S.len + MC.LV_BR + yb, v: drop > 0 ? 0 : v / TICK, drop, rolled: Math.max(0, age - MC.LV_BDROP) * v });
    }
  }
  if (st.bcache.size > 4000) st.bcache.clear();
  st.bcache.set(key, list);
  return list;
}

// Ticks into play to draw at, fractional: the prediction's clock in play, where the round ended through the result, 0 before.
function playTime(view, ctx) {
  const g = view.party();
  if (g.state !== L.H_PLAY && g.state !== L.H_OVER) return 0;
  let t = ctx?.ptick !== undefined ? ctx.ptick - g.start : g.t + (ctx?.dt || 0) / TICK;
  if (g.state === L.H_OVER) t = Math.min(t, (g.until - L.P_OVER - g.start) | 0);
  return Math.max(0, t);
}
// What became of a ball, from its PG_M: climbing (its best height in cm), home (its order) or burnt (the tick into play).
export const fateOf = (m) => (m & MC.LV_M_FIN ? { kind: 'home', n: m & 0xffffff } : m & MC.LV_M_BURN ? { kind: 'burnt', n: m & 0xffffff } : { kind: 'climbing', n: m });

// ---- the AI ball

// Where a ball is (its turn, along, its floor), once a world tick for each slot that asks.
const LEVELS = [];
function levelOf(view, st, b) {
  const slot = b.slot;
  const c = LEVELS[slot];
  if (c && c.tick === view.tick && c.bank === view.bank && c.st === st && c.y === b.pos[1]) return c;
  const w = where(st, b.pos[0], b.pos[1], b.pos[2], {});
  const F = w.inb ? floorAt(st, w.sb, w.u, 0, {}) : null;
  const lv = { tick: view.tick, bank: view.bank, st, y: b.pos[1], w, top: F ? F.top : w.rho < st.rt ? st.ht : PLAT_Y, summit: w.rho < st.rt || w.S?.kind === MC.LV_SUMMIT };
  // on the shelf, or the first turn's start level with it
  lv.shelf = (!w.inb && w.rho >= st.rt) || (w.inb && w.kb === 0 && w.sb < st.startEnd);
  LEVELS[slot] = lv;
  return lv;
}
const ballOf = (view, me) => (typeof me === 'number' ? view.partier(me) : me);
const playT = (view, tick) => Math.max(0, (tick - view.dv.getUint32(L.HDR_START + (view.bank || 0), true)) | 0);

// How deadly (x, z) is on tick `tick` for ball me, on its own turn: off the shelf, the lava, a gap or a ledge's outside
// (falling to the turn below), off the band's outer edge from it, a boulder there then; the tower or the first turn's
// rock from the shelf a little (walls).
const DF = { top: -1000, h: 1000, S: null };
function danger(view, x, z, tick, me) {
  const st = stage(view);
  const b = ballOf(view, me);
  if (!st || !b) return 0;
  const lv = levelOf(view, st, b);
  const t = playT(view, tick);
  const lava = lavaAt(st, t);
  const dx = x - st.cx, dz = z - st.cx, rho = Math.hypot(dx, dz);
  if (rho > st.rb - 0.7) return 1;
  if (rho < st.rt + 0.4) return lv.summit ? 0 : 0.3;
  if (rho > st.ro) return lv.shelf ? (lava > PLAT_Y + 0.4 ? 1 : 0) : 1;
  // along the route on its own turn: the s nearest its own (across the seam at angle 0 too)
  let s = (turns(dx, dz) + Math.max(0, lv.w.kb)) * st.C;
  if (s - lv.w.sb > st.C / 2) s -= st.C;
  else if (lv.w.sb - s > st.C / 2) s += st.C;
  const F = floorAt(st, s, rho - st.rm, t, DF);
  if (F.top < -999) return 1;
  if (F.top + 1 < lava + 0.5) return 1;
  // from the shelf beside it, the first turn's rock is a wall
  if (!lv.w.inb && F.top > PLAT_Y + P_STEP) return 0.25;
  for (const B of boulders(st, F.S, t)) {
    const d = Math.hypot(B.x - x, B.z - z);
    if (d < MC.LV_BR + BR + 1.1) return d < MC.LV_BR + BR + 0.3 ? 0.95 : 0.6;
  }
  return 0;
}

// Where it wants to be: on the summit, the crown; on the shelf, the start (round the tower the short way);
// on the route, a point ahead up it in its lane: a ledge's inside, near the tower over a gap (the short way
// over it), and on a boulder ramp the lane the boulders coming leave clearest.
function goal(view, me, bot) {
  const st = stage(view);
  const b = ballOf(view, me);
  if (!st || !b) return null;
  const lv = levelOf(view, st, b);
  const mem = bot?.mem ? (bot.mem.lv ||= {}) : {};
  if (mem.lane === undefined) mem.lane = ((hash32(b.slot, 77, st.seed ^ 0x2c1b) >>> 8) * 2 ** -24 * 1.2 - 0.7) * st.w;
  if (lv.summit) return [st.cx, st.cx];
  const w = lv.w;
  if (lv.shelf && !(w.inb && w.sb < st.startEnd)) {
    // round the shelf to the start's span, then in onto it
    let d = st.ths * 0.5 - w.th;
    d -= Math.round(d);
    if (Math.abs(d) < st.ths * 0.45) return routeXZ(st, Math.max(st.startEnd * 0.5, Math.min(st.startEnd - 2, w.th * st.C + 4)), 0);
    const a = (w.th + Math.sign(d) * Math.min(Math.abs(d), 0.06)) * TAU, r = st.ro + 2.5;
    return [st.cx + r * Math.cos(a), st.cx + r * Math.sin(a)];
  }
  const v = bot?.vel ? Math.hypot(bot.vel[0], bot.vel[1]) : Math.hypot(b.vel[0], b.vel[2]);
  const sg = Math.min(st.send - 2, w.sb + 7 + v * 0.4);
  let u = mem.lane;
  const S = w.S, N = secAt(st, sg);
  const t = playT(view, bot?.at ?? view.tick);
  const tight = (Q) => Q && (Q.kind === MC.LV_LEDGE || Q.kind === MC.LV_GAP || Q.kind === MC.LV_SLIDER);
  if (tight(S) || tight(N)) {
    const L0 = S?.kind === MC.LV_LEDGE ? S : N?.kind === MC.LV_LEDGE ? N : null;
    if (L0) u = -st.w + Math.max(1.3, Math.min(L0.a, st.W) * 0.45);
    else u = -st.w + 1.6 + Math.max(0, Math.min(1, (mem.lane + st.w) / st.W)) * Math.min(3, st.W * 0.25);
  } else if ((S && S.fl & MC.LV_F_BOULDERS) || (N && N.fl & MC.LV_F_BOULDERS)) {
    // the lane clearest of the boulders coming down at it over the next two seconds or so
    const R = S && S.fl & MC.LV_F_BOULDERS ? S : N;
    let best = Infinity;
    for (let i = 0; i <= 8; i++) {
      const cu = -st.w + 1.3 + (i / 8) * (st.W - 2.6);
      let sc = 0.15 * Math.abs(cu - mem.lane);
      for (const dt of [0, 40, 80, 120, 170]) {
        const sb = w.sb + v * dt * TICK;
        for (const B of boulders(st, R, t + dt)) {
          if (Math.abs(B.s - sb) > 6) continue;
          const lat = Math.abs(B.u - cu);
          if (lat < MC.LV_BR + BR + 1) sc += (MC.LV_BR + BR + 1 - lat) * (dt < 90 ? 2 : 1);
        }
      }
      if (sc < best) { best = sc; u = cu; }
    }
  }
  u = Math.max(-st.w + 1.2, Math.min(st.w - 1.2, u));
  return routeXZ(st, sg, u);
}

// The word outright where the planner can't see the way: straight over a gap or onto a slider's platform with a hop
// at the lip (waiting for the platform when it's out of reach), off the platform when it's flush or near enough; up
// steps, a hop timed so its centre is over the riser while it's a step up, backing off a riser it's stuck at.
function think(view, me, bot, tick = view.tick) {
  const st = stage(view);
  const b = ballOf(view, me);
  if (!st || !b || !b.live || b.out || !b.ground) return null;
  const x = bot?.pos?.[0] ?? b.pos[0], z = bot?.pos?.[1] ?? b.pos[2];
  const w = where(st, x, b.pos[1], z, {});
  if (!w.inb || !w.S) return null;
  const mem = bot?.mem ? (bot.mem.lv ||= {}) : {};
  const vx = bot?.vel?.[0] ?? b.vel[0], vz = bot?.vel?.[1] ?? b.vel[2];
  const tx = -(z - st.cx) / w.rho, tz = (x - st.cx) / w.rho;
  const vt = vx * tx + vz * tz;
  const k = w.rho / st.rm; // metres at its radius a metre along the middle
  const up = Math.atan2(tz, tx);
  const t = playT(view, tick);
  let S = w.S;
  // a gap or a slider here, or one whose lip is within 6 m
  const N = secAt(st, S.s0 + S.len + 0.01);
  if (!(S.kind === MC.LV_GAP || S.kind === MC.LV_SLIDER) && N && (N.kind === MC.LV_GAP || N.kind === MC.LV_SLIDER) && N.s0 + N.a - w.sb < 6) S = N;
  if (S.kind === MC.LV_GAP || S.kind === MC.LV_SLIDER) {
    const near = S.s0 + S.a, far = near + S.g;
    const yaw = up + (w.u > -st.w + 2.5 ? 0.25 : 0); // edging in toward the tower: the gap is shorter there
    const lip = Math.max(0.28, vt * 0.045);
    if (w.sb < near) {
      const dc = (near - w.sb) * k;
      if (S.kind === MC.LV_GAP) {
        if (dc < lip) return { yaw, move: 1, hop: 1 };
        // too slow to clear it from here: back up for a run at it
        if (dc < 2.5 && vt < 5.5 && S.g * k > vt * 0.55 - 0.6) { mem.run = t + 60; return { yaw, move: 2 }; }
        if (mem.run > t && dc < 4.5) return { yaw, move: 2 };
        return { yaw, move: 1 };
      }
      // a slider: rolled onto while it's flush, else a hop at the lip that lands on it (its 7 m and the 3.2 m it
      // moves: from a run-up most of the time), worked out for when it gets to the lip; braking short if not, and
      // back for a run at it
      const at = t + Math.ceil(Math.max(0, dc - lip) / Math.max(vt, 1) / TICK);
      const flush = slide(S, at) < 0.15 * Math.max(vt, 1) && slide(S, at + 8) < 0.15 * Math.max(vt, 1);
      const oLand = slide(S, at + 75), land = (vt * 0.58) / k;
      const onIt = land > oLand + 0.8 && land < oLand + MC.LV_SL_L - 0.8;
      if (dc < lip) return flush ? { yaw, move: 1 } : onIt ? { yaw, move: 1, hop: 1 } : { yaw, move: 2 };
      if (!flush && !onIt && dc < (vt * vt) / 20 + lip + 0.6) { mem.run = t + 50; return { yaw, move: vt > 0.3 ? 2 : 0 }; }
      if (mem.run > t && dc < 5) return { yaw, move: 2 };
      return { yaw, move: 1 };
    }
    if (S.kind === MC.LV_SLIDER && w.sb < far) {
      // on the platform: off its far end when it's flush with the far side, else a hop at its lip that clears the
      // gap left, else back along it for a run
      // on the platform: off its far end when it's flush with the far side, else a hop at its lip that clears the
      // gap left, else brake on it and ride it over
      const o = slide(S, t);
      const end = near + o + MC.LV_SL_L, dc = (end - w.sb) * k, gap = (far - end) * k;
      const at = t + Math.ceil(Math.max(0, dc - lip) / Math.max(vt, 1) / TICK);
      const gapAt = (far - near - slide(S, at) - MC.LV_SL_L) * k;
      if (gap < 0.12 * Math.max(vt, 1) && gapAt < 0.12 * Math.max(vt, 1)) return { yaw, move: 1 };
      const reach = vt * 0.58 > lip + gapAt + 0.8;
      if (dc < lip) return reach ? { yaw, move: 1, hop: 1 } : { yaw, move: 2 };
      if (!reach && dc < (vt * vt) / 20 + lip + 0.8) return { yaw, move: vt > 0.3 ? 2 : 0 };
      return { yaw, move: 1 };
    }
    return null;
  }
  // steps: the riser over the tread it stands on
  if (S.kind === MC.LV_STEPS || (N && N.kind === MC.LV_STEPS && N.s0 + N.a - w.sb < 4)) {
    const T = S.kind === MC.LV_STEPS ? S : N;
    const j = Math.max(0, Math.floor((b.pos[1] + P_STEP - (PLAT_Y + T.h0)) / MC.LV_STEP_H));
    if (j >= T.g) return null;
    const dc = (T.s0 + (j + 1) * T.a - w.sb) * k;
    if (dc < 0) return null;
    // a hop at the riser's foot climbs it whatever the speed (LV_STEP_V); rolling up to it, a hop timed to be
    // over it while still a step up
    if (dc < BR + 0.35 + 0.2 * Math.max(0, vt) && dc > BR - 0.1) return { yaw: up, move: 1, hop: 1 };
  }
  return null;
}

// ---- drawing

// The stage's solids that never move, built once a layout: the shelf, the tower in strata and its summit, the route's
// slabs, a lip over the top of each boulder ramp, the crater's rim. [shape, x, y, z, hx, hy, hz, yaw, r, g, b, look, a, b2, alpha].
function build(st) {
  const g = [];
  const box = (x, y, z, hx, hy, hz, yaw, c, look = LOOK.MATTE, a = 0, b2 = 0, alpha = 1) => g.push([0, x, y, z, hx, hy, hz, yaw, c[0], c[1], c[2], look, a, b2, alpha]);
  const cyl = (x, y, z, r, hh, c, look = LOOK.MATTE, a = 0, b2 = 0) => g.push([1, x, y, z, r, hh, r, 0, c[0], c[1], c[2], look, a, b2, 1]);
  const { cx, rt, ro, rm } = st;
  // the shelf, and the tower to its top: rock in bands
  cyl(cx, PLAT_Y - 2.5, cx, st.rb, 2.5, ROCK.shelf);
  cyl(cx, (PLAT_Y - 2 + st.ht) / 2, cx, rt, (st.ht - PLAT_Y + 2) / 2, ROCK.tower);
  for (let y = PLAT_Y + 3, i = 0; y < st.ht - 1.5; y += 3.6, i++) cyl(cx, y, cx, rt + 0.12, 0.35 + 0.25 * (i % 3 === 0), i & 1 ? ROCK.strata : [0.27, 0.24, 0.24]);
  cyl(cx, st.ht - 0.35, cx, rt + 0.1, 0.35, ROCK.summit);
  // a slab of the route from s0 to s1, from r0 to r1 round the tower, its top h over the shelf: on the first turn rock
  // down to the shelf, over it a slab
  const piece = (s0, s1, r0, r1, h, c, look = LOOK.MATTE, a = 0) => {
    const sm = (s0 + s1) / 2, ang = (sm / st.C) * TAU;
    const rc = (r0 + r1) / 2, top = PLAT_Y + h;
    const bot = sm < st.C ? PLAT_Y - 1 : top - SLAB;
    box(cx + rc * Math.cos(ang), (top + bot) / 2, cx + rc * Math.sin(ang), ((s1 - s0) / 2) * (r1 / rm) + 0.05, (top - bot) / 2, (r1 - r0) / 2, ang + Math.PI / 2, c, look, a);
  };
  // the rail along the outer edge, a low stone wall
  const rail = (s0, s1, h) => {
    const sm = (s0 + s1) / 2, ang = (sm / st.C) * TAU, r = ro - 0.18;
    box(cx + r * Math.cos(ang), PLAT_Y + h + MC.LV_RAIL / 2, cx + r * Math.sin(ang), ((s1 - s0) / 2) * (ro / rm) + 0.06, MC.LV_RAIL / 2, 0.18, ang + Math.PI / 2, ROCK.rail);
  };
  const lip = (s, r0, r1, h) => {
    const ang = (s / st.C) * TAU, rc = (r0 + r1) / 2;
    box(cx + rc * Math.cos(ang), PLAT_Y + h + 0.02, cx + rc * Math.sin(ang), 0.3, 0.04, (r1 - r0) / 2, ang + Math.PI / 2, [1, 0.8, 0.1], LOOK.HAZARD, 0.5);
  };
  for (const S of st.secs) {
    const e = S.s0 + S.len;
    if (S.kind === MC.LV_RAMP || S.kind === MC.LV_LEDGE) {
      const n = Math.max(1, Math.round(S.len / PIECE));
      for (let i = 0; i < n; i++) {
        const a = S.s0 + (S.len * i) / n, b = S.s0 + (S.len * (i + 1)) / n, f = (a + b) / 2 - S.s0;
        const h = S.h0 + (S.h1 - S.h0) * ((i + 1) / n);
        const tint = 1 + 0.05 * ((i * 7) % 3 - 1);
        const c = (S.kind === MC.LV_LEDGE ? ROCK.ledge : S.fl & MC.LV_F_BOULDERS ? ROCK.boulderRamp : ROCK.route).map((v) => v * tint);
        const r1 = S.kind === MC.LV_LEDGE ? rt + ledgeWidth(st, S, f) : ro;
        piece(a, b, rt, r1, h, c);
        if (S.kind === MC.LV_RAMP) rail(a, b, h);
        // a ledge's outer edge, red where it's narrow
        if (S.kind === MC.LV_LEDGE && r1 < ro - 0.5) {
          const ang = (((a + b) / 2) / st.C) * TAU;
          box(cx + (r1 - 0.12) * Math.cos(ang), PLAT_Y + h + 0.03, cx + (r1 - 0.12) * Math.sin(ang), ((b - a) / 2) * (r1 / rm) + 0.05, 0.04, 0.12, ang + Math.PI / 2, [0.95, 0.2, 0.1], LOOK.GLOW, 0.6);
        }
      }
      if (S.fl & MC.LV_F_BOULDERS) {
        // the lip the boulders drop from, over the ramp's top, and its post on the tower
        const ang = ((e - MC.LV_BR) / st.C) * TAU, y = PLAT_Y + S.h1 + MC.LV_BDH + MC.LV_BR * 2 + 0.6;
        box(cx + (rt + st.w) * Math.cos(ang), y, cx + (rt + st.w) * Math.sin(ang), 2.2 * (ro / rm), 0.5, st.w, ang + Math.PI / 2, [0.2, 0.17, 0.16]);
        box(cx + (rt + 0.6) * Math.cos(ang), (PLAT_Y + S.h1 + y) / 2, cx + (rt + 0.6) * Math.sin(ang), 2.2, (y - PLAT_Y - S.h1) / 2, 0.6, ang + Math.PI / 2, [0.2, 0.17, 0.16]);
      }
    } else if (S.kind === MC.LV_STEPS) {
      for (let i = 0; i <= S.g; i++) {
        piece(S.s0 + i * S.a, Math.min(e, S.s0 + (i + 1) * S.a), rt, ro, S.h0 + i * MC.LV_STEP_H, ROCK.step[i & 1]);
        rail(S.s0 + i * S.a, Math.min(e, S.s0 + (i + 1) * S.a), S.h0 + i * MC.LV_STEP_H);
      }
    } else if (S.kind === MC.LV_GAP || S.kind === MC.LV_SLIDER) {
      piece(S.s0, S.s0 + S.a, rt, ro, S.h0, ROCK.pad);
      piece(S.s0 + S.a + S.g, e, rt, ro, S.h0, ROCK.pad);
      rail(S.s0, S.s0 + S.a, S.h0);
      rail(S.s0 + S.a + S.g, e, S.h0);
      lip(S.s0 + S.a - 0.3, rt, ro, S.h0);
      lip(S.s0 + S.a + S.g + 0.3, rt, ro, S.h0);
    } else {
      const n = Math.max(1, Math.round(S.len / 2.5));
      for (let i = 0; i < n; i++) {
        piece(S.s0 + (S.len * i) / n, S.s0 + (S.len * (i + 1)) / n, rt, ro, S.h0, S.kind === MC.LV_SUMMIT ? ROCK.summit : ROCK.start);
        if (S.kind === MC.LV_SUMMIT) rail(S.s0 + (S.len * i) / n, S.s0 + (S.len * (i + 1)) / n, S.h0);
      }
    }
  }
  // the start's end: a glowing line across
  const a0 = (st.startEnd / st.C) * TAU;
  box(cx + (rt + st.w) * Math.cos(a0), PLAT_Y + 0.03, cx + (rt + st.w) * Math.sin(a0), 0.25, 0.04, st.w, a0 + Math.PI / 2, [1, 0.6, 0.2], LOOK.GLOW, 0.9);
  // the crater's rim: a ring of cliffs round the lava, ragged along the top
  const n = 44;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * TAU, jag = ((hash32(i, 5, 0x4a11) >>> 8) * 2 ** -24 - 0.5) * 12;
    const top = PLAT_Y + st.hTop + 6 + jag, half = (Math.PI * st.rim) / n + 1.2;
    box(cx + (st.rim + 3) * Math.cos(ang), top / 2, cx + (st.rim + 3) * Math.sin(ang), 4, top / 2, half, ang, ROCK.rim);
  }
  return g;
}

// The lava: the pool to its top, a crust of dark plates drifting round on it, sparks rising off it, a glow over it near you.
function lava(sc, out, st, top, now, cam) {
  const { cx } = st;
  sc.cyl(cx, top / 2, cx, st.rim + 0.5, top / 2, ...LAVA, LOOK.GLOW, 1.15, 0.9);
  const s = now / 1000;
  for (let i = 0; i < 150; i++) {
    const h1 = hash32(i, 1, 0x1a7a), h2 = hash32(i, 2, 0x1a7a);
    const r = Math.sqrt(st.rt * st.rt + ((h1 >>> 8) * 2 ** -24) * (st.rim * st.rim - st.rt * st.rt - 9));
    const ang = ((h2 >>> 8) * 2 ** -24) * TAU + s * 0.012 * (i & 1 ? 1 : -1) * (20 / r);
    const size = 1 + ((h1 & 255) / 255) * 2.4;
    sc.hex(cx + r * Math.cos(ang), top + 0.03, cx + r * Math.sin(ang), size, 0.06, ang * 2 + i, 0.13, 0.05, 0.03, LOOK.MATTE, 0, 0, 1, i);
  }
  // sparks: each rises off the surface and fades, then again somewhere else
  for (let i = 0; i < 110; i++) {
    const per = 1.4 + (i % 7) * 0.18, cyc = Math.floor((s + i * 0.37) / per), u = (s + i * 0.37) / per - cyc;
    const h = hash32(i, cyc, 0x5b2c);
    const r = st.rt + 1 + ((h >>> 8) * 2 ** -24) * (st.rim - st.rt - 3), ang = ((h & 0xffff) / 65536) * TAU;
    const x = cx + r * Math.cos(ang), z = cx + r * Math.sin(ang);
    if (cam && Math.hypot(x - cam[0], z - cam[2]) > 90) continue;
    out.glow.push({ pos: [x + Math.sin(u * 6 + i) * 0.4, top + 0.3 + u * (2.5 + (i % 5) * 0.6), z], size: 0.22 + (i % 3) * 0.08, color: [1, 0.55 + 0.3 * (1 - u), 0.15, 0.9 * Math.sin(u * Math.PI)], kind: SPRITE.SPARK, minpx: 1 });
  }
  // the heat over it near the camera: a few soft glows shimmering
  if (cam) {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + s * 0.05, d = 10 + (i % 4) * 7;
      const x = cam[0] + Math.cos(a) * d, z = cam[2] + Math.sin(a) * d;
      if (Math.hypot(x - cx, z - cx) < st.rb && top < PLAT_Y + 1) continue;
      out.glow.push({ pos: [x, top + 0.6, z], size: 7 + 2 * Math.sin(s * 1.7 + i), color: [1, 0.4, 0.08, 0.13 + 0.05 * Math.sin(s * 2.3 + i * 1.3)], kind: SPRITE.FLASH, minpx: 2 });
    }
  }
}

// a ball the lava took lately: { pos, born (ms) } for its plume
const plumes = [];
// the prediction's tick into play as last drawn, for the HUD that frame
let drawn = { now: -1, t: 0 };

export default {
  id: L.MG_LAVA, key: 'lava', name: 'RISING LAVA',
  hint: 'CLIMB THE TOWER BEFORE THE LAVA DOES  HOP THE STEPS AND GAPS',
  rules: 'FIRST TO THE CROWN WINS  UNDER THE LAVA AND YOU ARE OUT',
  ownScore: true,
  outForGood: true,
  env: 'sunset',

  draw(view, ctx, out) {
    const st = stage(view);
    if (!st) return;
    if (!st.geom) st.geom = build(st);
    const sc = out.scene;
    for (const s of st.geom) sc.put(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8], s[9], s[10], s[11], s[12], s[13], s[14]);
    const g = view.party();
    const tp = playTime(view, ctx);
    const now = ctx?.now ?? 0;
    drawn = { now, t: tp };
    const { cx, rt, ro, rm } = st;
    // the sliders' platforms where they are, their ends lit
    for (const S of st.secs) {
      if (S.kind !== MC.LV_SLIDER) continue;
      const o = slide(S, tp);
      const s0 = S.s0 + S.a + o, s1 = s0 + MC.LV_SL_L, ang = (((s0 + s1) / 2) / st.C) * TAU, rc = (rt + ro) / 2;
      sc.box(cx + rc * Math.cos(ang), PLAT_Y + S.h0 - 0.45, cx + rc * Math.sin(ang), ((s1 - s0) / 2) * (ro / rm), 0.45, st.w, ang + Math.PI / 2, 1, 0.78, 0.12, LOOK.HAZARD, 0.6, 0, 1, S.j * 13 + 5);
      const ar = (((s0 + s1) / 2) / st.C) * TAU, rr = ro - 0.18;
      sc.box(cx + rr * Math.cos(ar), PLAT_Y + S.h0 + MC.LV_RAIL / 2, cx + rr * Math.sin(ar), ((s1 - s0) / 2) * (ro / rm), MC.LV_RAIL / 2, 0.18, ar + Math.PI / 2, 0.55, 0.55, 0.58, LOOK.METAL, 0, 0, 1, S.j * 13 + 7);
      for (const e of [s0 + 0.25, s1 - 0.25]) {
        const a2 = (e / st.C) * TAU;
        sc.box(cx + rc * Math.cos(a2), PLAT_Y + S.h0 + 0.03, cx + rc * Math.sin(a2), 0.2, 0.04, st.w, a2 + Math.PI / 2, 1, 0.9, 0.5, LOOK.GLOW, 0.8, 0, 1, S.j * 13 + 6);
      }
    }
    // the boulders rolling (lumps turning with them), a shadow each
    if (g.state === L.H_PLAY || g.state === L.H_OVER) {
      for (const S of st.secs) {
        if (!(S.fl & MC.LV_F_BOULDERS)) continue;
        for (const B of boulders(st, S, tp)) {
          sc.sphere(B.x, B.y, B.z, MC.LV_BR, ...ROCK.boulder, LOOK.MATTE, 0, 0, 1, S.j * 97 + B.l * 13 + B.k);
          const roll = B.rolled / MC.LV_BR, ang = (B.s / st.C) * TAU;
          const tx = -Math.sin(ang), tz = Math.cos(ang), ex = Math.cos(ang), ez = Math.sin(ang);
          for (let i = 0; i < 3; i++) {
            const a = -roll + i * 2.1, lat = (i - 1) * 0.55;
            sc.sphere(B.x + tx * Math.cos(a) * MC.LV_BR * 0.85 + ex * lat, B.y + Math.sin(a) * MC.LV_BR * 0.85, B.z + tz * Math.cos(a) * MC.LV_BR * 0.85 + ez * lat, 0.42, 0.28, 0.24, 0.22, LOOK.MATTE);
          }
          out.casters.push([B.x, B.y, B.z, -MC.LV_BR]);
        }
      }
    }
    // the lava, at the tick your own ball is drawn at
    const top = lavaAt(st, g.state === L.H_PLAY || g.state === L.H_OVER ? tp : 0);
    lava(sc, out, st, top, now, ctx?.cam);
    // smoke where balls went in
    for (let k = plumes.length - 1; k >= 0; k--) {
      const age = (now - plumes[k].born) / 1400;
      if (age >= 1 || age < -1) { plumes.splice(k, 1); continue; }
      const p = plumes[k].pos;
      for (let i = 0; i < 4; i++) out.glow.push({ pos: [p[0] + Math.sin(i * 2.4) * age * 1.4, top + 0.5 + age * (2 + i), p[2] + Math.cos(i * 2.4) * age * 1.4], size: 1.2 + age * 2.5, color: [0.45, 0.4, 0.38, 0.5 * (1 - age)], kind: SPRITE.FLASH, minpx: 2 });
    }
    // the crown on the summit, turning, and its ring; over it the gold ring where the balls home bob in their order
    const s = now / 1000;
    sc.cyl(cx, st.ht + 0.35, cx, 2.1, 0.35, ...GOLD, LOOK.METAL);
    sc.cyl(cx, st.ht + 0.75, cx, 1.7, 0.08, 1, 0.9, 0.4, LOOK.GLOW, 1);
    for (let i = 0; i < 6; i++) {
      const a = s * 0.6 + (i / 6) * TAU;
      sc.box(cx + Math.cos(a) * 1.75, st.ht + 1.3, cx + Math.sin(a) * 1.75, 0.22, 0.6, 0.22, a, ...GOLD, LOOK.METAL);
      sc.sphere(cx + Math.cos(a) * 1.75, st.ht + 2.05, cx + Math.sin(a) * 1.75, 0.26, ...[[0.9, 0.12, 0.15], [0.15, 0.4, 0.9], [0.2, 0.75, 0.25]][i % 3], LOOK.PLASTIC);
    }
    out.glow.push({ pos: [cx, st.ht + 1.6, cx], size: 6 + 0.6 * Math.sin(s * 2), color: [1, 0.85, 0.4, 0.35], kind: SPRITE.FLASH, minpx: 3 });
    out.decals.push({ pos: [cx, st.ht + 0.02, cx], radius: MC.LV_CROWN_R + 0.2, width: 0.3, color: [1, 0.8, 0.3, 0.75], kind: DECAL.RING });
    let home = 0;
    for (let p = 0; p < L.NPLAYER; p++) {
      const a0 = L.PLAYERS + p * L.PSIZE;
      if ((view.u8[a0 + L.P_FL] & (L.PF_LIVE | L.PF_DEAD)) !== (L.PF_LIVE | L.PF_DEAD)) continue;
      const fate = fateOf(view.dv.getUint32(a0 + L.PG_M, true));
      if (fate.kind !== 'home') continue;
      home++;
      const x = view.dv.getFloat32(a0 + L.P_PX, true), y = view.dv.getFloat32(a0 + L.P_PY, true), z = view.dv.getFloat32(a0 + L.P_PZ, true);
      const bob = Math.abs(Math.sin(now / 260 + p * 1.7)) * (fate.n <= 3 ? 0.8 : 0.4);
      const col = slotColor(p);
      out.solid.push({ pos: [x, y + 1 + bob, z], size: 1, color: [...col, 1], kind: SPRITE.BALL, minpx: 1, roll: now / 400 + p, seed: p });
      out.solid.push({ pos: [x, y + 2.22 + bob, z], size: 0.34, color: [...col, 1], kind: SPRITE.BODY, minpx: 1 });
      out.solid.push({ pos: [x, y + 2.78 + bob, z], size: 0.3, color: [...col, 1], kind: SPRITE.HEAD, minpx: 1, vel: [cx - x, 0, cx - z] });
      out.casters.push([x, y + 1 + bob, z, -1]);
      if (fate.n <= 3) out.glow.push({ pos: [x, y + 1 + bob, z], size: 1.5, color: [...[[1, 0.85, 0.2], [0.85, 0.88, 0.95], [0.85, 0.55, 0.3]][fate.n - 1], 0.45], kind: SPRITE.RING, minpx: 1 });
    }
    if (home) {
      const R = MC.LV_PARK_R0 + MC.LV_PARK_RK * Math.sqrt(home + 0.5) + 1.4;
      sc.cyl(cx, st.ht + MC.LV_PARK_Y - 0.1, cx, R, 0.1, ...GOLD, LOOK.GLOW, 0.5, 0.2, 0.45);
    }
  },

  // the shelf, the tower and the route round it; the overview flies round above the summit
  frame(view) {
    const st = stage(view);
    const g = view.party();
    if (!st) return { centre: [g.cx, PLAT_Y, g.cx], radius: g.size || 30, shape: 'disc' };
    return { centre: [st.cx, PLAT_Y + st.hTop * 0.5, st.cx], radius: st.rb, shape: 'disc' };
  },

  // a new round faces you up the route, round the tower
  facing(view, slot) {
    const st = stage(view);
    if (!st || !(slot >= 0)) return null;
    const b = view.partier(slot);
    const a = Math.atan2(b.pos[2] - st.cx, b.pos[0] - st.cx);
    return Math.atan2(Math.cos(a), -Math.sin(a));
  },

  fx(f, ctx) {
    const d = typeof ctx.dist === 'function' ? ctx.dist(f.pos) : ctx.dist ?? 0;
    const name = (p) => (ctx.name ? ctx.name(p) : `P${p + 1}`);
    const mine = f.owner === ctx.slot;
    if (f.kind === MC.LV_FX_BURN) {
      plumes.push({ pos: f.pos, born: ctx.now ?? 0 });
      ctx.glow?.({ pos: [f.pos[0], f.pos[1] + 0.6, f.pos[2]], size: 3.4, color: [1, 0.55, 0.15, 1], kind: SPRITE.FLASH, life: 600, grow: true });
      ctx.glow?.({ pos: [f.pos[0], f.pos[1] + 0.2, f.pos[2]], size: 3.2, color: [1, 0.35, 0.05, 0.9], kind: SPRITE.RING, life: 700, grow: true });
      for (let i = 0; i < 6; i++) ctx.glow?.({ pos: [f.pos[0] + Math.cos(i) * 0.8, f.pos[1] + 1 + (i & 1), f.pos[2] + Math.sin(i) * 0.8], size: 0.5, color: [1, 0.75, 0.25, 1], kind: SPRITE.SPARK, life: 500 + i * 60 });
      ctx.sound?.blast?.(d, 3);
      ctx.sound?.crackle?.(2);
      const by = f.shot !== 255 ? `  KNOCKED IN BY ${name(f.shot)}` : '';
      ctx.feed?.(`${name(f.owner)} INTO THE LAVA AT ${Math.floor(f.size)} M${by}`, mine ? C.RED : f.shot === ctx.slot ? C.GREEN : C.WHITE);
      if (mine) ctx.banner?.(`INTO THE LAVA  ${Math.floor(f.size)} M UP`, C.RED, 3500);
      else if (f.shot === ctx.slot) ctx.banner?.(`YOU KNOCKED ${name(f.owner)} INTO THE LAVA`, C.GREEN, 2000);
    } else if (f.kind === MC.LV_FX_CROWN) {
      const n = f.shot;
      for (let i = 0; i < 8; i++) {
        const a = i * 0.785 + f.owner;
        ctx.glow?.({ pos: [f.pos[0] + Math.cos(a) * 1.6, f.pos[1] + 2 + (i & 1), f.pos[2] + Math.sin(a) * 1.6], size: 0.9, color: [[1, 0.85, 0.2], [1, 0.95, 0.6], [1, 0.6, 0.2]][i % 3].concat(1), kind: SPRITE.SPARK, life: 800 });
      }
      ctx.glow?.({ pos: [f.pos[0], f.pos[1] + 1.5, f.pos[2]], size: 4, color: [1, 0.85, 0.35, 1], kind: SPRITE.RING, life: 700, grow: true });
      ctx.feed?.(`${name(f.owner)} TAKES THE CROWN ${ordinal(n)}  ${f.size.toFixed(1)} S`, mine || n === 1 ? C.YELLOW : C.WHITE);
      if (mine) { ctx.banner?.(`THE CROWN  ${ordinal(n)}!`, C.YELLOW, 3500); ctx.sound?.holed?.(); }
      else if (n === 1) { ctx.banner?.(`${name(f.owner)} HAS THE CROWN`, C.ORANGE, 2500); ctx.sound?.count?.(0); }
    } else if (f.kind === MC.LV_FX_HIT) {
      ctx.glow?.({ pos: f.pos, size: 2.2, color: [0.75, 0.62, 0.5, 0.8], kind: SPRITE.FLASH, life: 300, grow: true });
      ctx.sound?.boing?.(Math.min(24, f.size), mine ? 0 : d);
      if (mine) ctx.sound?.land?.(f.size * 2);
    } else if (f.kind === MC.LV_FX_LAVA) {
      ctx.banner?.(f.shot === 0 ? 'THE LAVA IS RISING' : `THE LAVA RISES FASTER  ${f.size.toFixed(2)} M/S`, C.ORANGE, f.shot === 0 ? 2500 : 1800);
      ctx.sound?.count?.(1);
    }
  },

  // How high you are and how far over the lava (rows 0 and 1, the frontend leaves them to ownScore), who's where;
  // the lava's pace and what's coming up the route on the right; the climb as a line with the lava, you and the leader.
  hud(view, ctx) {
    const st = stage(view);
    const g = view.party();
    if (!st || g.state !== L.H_PLAY) return;
    const t = drawn.now === ctx.now ? drawn.t : g.t;
    const lava = lavaAt(st, t);
    const me = ctx.me ?? (ctx.slot >= 0 ? view.partier(ctx.slot) : null);
    let home = 0, burnt = 0, climbing = 0, leadH = -1;
    for (let p = 0; p < L.NPLAYER; p++) {
      const a = L.PLAYERS + view.bank + p * L.PSIZE;
      const fl = view.u8[a + L.P_FL];
      if (!(fl & L.PF_LIVE)) continue;
      const m = view.dv.getUint32(a + L.PG_M, true);
      if (!(fl & L.PF_DEAD)) { climbing++; leadH = Math.max(leadH, view.dv.getFloat32(a + L.P_PY, true)); continue; }
      if (m & MC.LV_M_FIN) home++; else if (m & MC.LV_M_BURN) burnt++;
    }
    const blank = ' '.repeat(34);
    ctx.put(1, 0, blank, C.WHITE);
    ctx.put(1, 1, blank, C.WHITE);
    const mine = ctx.pme ?? me;
    if (me?.live) {
      const fate = fateOf(me.m);
      if (fate.kind === 'home') ctx.put(1, 0, `THE CROWN ${ordinal(fate.n)}`, C.GREEN);
      else if (fate.kind === 'burnt') ctx.put(1, 0, `IN THE LAVA AT ${Math.floor(fate.n * TICK)} S`, C.RED);
      else if (!me.out) {
        const up = Math.max(0, mine.pos[1] - PLAT_Y), over = mine.pos[1] + BR - lava;
        ctx.put(1, 0, `${Math.floor(up)} M UP`, C.YELLOW);
        ctx.put(9, 0, over < 6 ? `LAVA ${over.toFixed(1)} M UNDER YOU` : `LAVA ${Math.floor(over)} M UNDER YOU`, over < 4 ? C.RED : over < 10 ? C.ORANGE : C.GREY);
      }
    }
    ctx.put(1, 1, `${home} HOME  ${burnt} IN THE LAVA  ${climbing} CLIMBING`, C.GREY);
    // the lava, on the right
    const pace = paceAt(st, t);
    if (t < MC.LV_STILL) ctx.right(2, `THE LAVA RISES IN ${Math.ceil((MC.LV_STILL - t) * TICK)}`, C.ORANGE);
    else ctx.right(2, `LAVA RISING ${pace.toFixed(2)} M/S`, pace > 0.6 ? C.RED : C.ORANGE);
    // what's ahead of you up the route
    if (mine?.live && !mine.out) {
      const w = where(st, mine.pos[0], mine.pos[1], mine.pos[2], {});
      if (w.rho < st.rt || w.S?.kind === MC.LV_SUMMIT) ctx.right(3, 'THE SUMMIT  TOUCH THE CROWN', C.YELLOW);
      else if (w.inb && w.S) {
        let S = w.S;
        if ((S.kind === MC.LV_RAMP && !(S.fl & MC.LV_F_BOULDERS)) || S.kind === MC.LV_START) S = secAt(st, S.s0 + S.len + 0.01) || S;
        const ahead = S !== w.S;
        const say = { [MC.LV_RAMP]: S.fl & MC.LV_F_BOULDERS ? 'BOULDERS' : '', [MC.LV_STEPS]: 'STEPS  HOP', [MC.LV_GAP]: 'A GAP  HOP IT', [MC.LV_SLIDER]: 'A SLIDER  RIDE IT', [MC.LV_LEDGE]: 'A LEDGE  KEEP IN', [MC.LV_SUMMIT]: 'THE SUMMIT', [MC.LV_START]: '' }[S.kind];
        if (say) ctx.right(3, ahead ? `${say.split('  ')[0]} AHEAD` : say, S.kind === MC.LV_SUMMIT ? C.GREEN : C.ORANGE);
      } else if (w.rho > st.ro) ctx.right(3, lava > PLAT_Y ? 'THE SHELF IS GOING' : 'BACK ROUND TO THE START', C.ORANGE);
    }
    // the climb: the lava's top, you, the highest still climbing
    const n = 30, x = COLS - 4 - n;
    const cell = (y) => Math.max(0, Math.min(n - 1, Math.floor(((y - PLAT_Y) / st.hTop) * n)));
    ctx.put(x - 2, 5, '0[', C.GREY);
    ctx.put(x, 5, '-'.repeat(n), C.GREY);
    if (lava >= PLAT_Y) ctx.put(x, 5, '~'.repeat(cell(lava) + 1), C.RED);
    ctx.put(x + n, 5, ']^', C.YELLOW);
    if (leadH >= 0) ctx.put(x + cell(leadH), 5, '*', C.YELLOW);
    if (mine?.live && !mine.out) ctx.put(x + cell(mine.pos[1]), 5, '>', C.GREEN);
    if (me?.live && me.out) ctx.centre(ctx.rows - 4, 'OUT OF THE CLIMB  WATCHING THE REST', C.GREY);
  },

  brain: { danger, goal, think, hop() { return false; } },
};
