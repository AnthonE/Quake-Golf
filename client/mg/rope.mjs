// JUMP ROPE, as drawn and as the AI ball sees it. The stage is a long gym
// floor of planks over the sea, a red middle line where the rope crosses and
// its end steps in alternating colours; a turner stands past either end, a
// big round figure on a striped tower working a crank, and the rope runs
// from crank to crank, a thick braid of beads, a smear behind it as it goes
// fast. The second rope shows as a flashing ghost before it joins; a step
// about to drop shakes and reddens. Under your own ball a ring closes in as
// the rope comes, green while a hop now clears it, and a tick sounds the
// moment to hop. All of it is the sim's own schedule (src/mg/rope.wat): the
// rope's angle worked again here in i32 from the segments setup wrote into
// PG_H, the ends' reach in f32, so what is drawn and what the bots hop by is
// what the sim does.
import * as L from '../../src/layout.mjs';
import * as MC from '../../src/mg/rope.mjs'; // JR_*: the minigame's own constants
import { PLAT_Y } from '../../src/party-view.mjs';
import { LOOK, SPRITE, DECAL } from '../party-render.mjs';
import { C } from '../font.mjs';

const f = Math.fround;
const TICK = 0.008;
const TAU = 2 * Math.PI;
const TURN24 = 2 ** 24;
const R = 1; // a ball's radius (no power-ups here)
const REACH = R + MC.JR_RW; // a ball's centre touches the rope's within this
const RR = MC.JR_RR;
const AXLE = PLAT_Y + MC.JR_AY;
const FLOOR_WY = R - MC.JR_AY; // a ball on the floor's centre, up from the axle
const HOP_G = f(Number(L.PHYS.GP_DT)); // gravity a tick in the air
const PLATE = 0.5; // the stage's half thickness, m
const LEAD = 55; // ticks before the rope meets your ball that the tick sounds: hop on it
// The AI ball's luck with a pass: it misses seeing one MISS0 plus MISS times
// its clumsiness squared of the time (clumsiness: 1 - skill), and hops off
// the middle of the moments that clear it by a normal spread of NOISE0 plus
// NOISE times its clumsiness ticks: a slow rope leaves room for that, a fast
// one, the next hop due as it lands, hardly any.
const MISS0 = 0.002, MISS = 0.03, NOISE0 = 3, NOISE = 12;

// ---- the schedule, as $jr_f, $jr_angle, $jr_drops and $jr_reach have it

const F = (s, k, n) => (Math.imul(n, s) + Math.imul(Math.imul(n, n - 1) >>> 1, k)) | 0;

// This round's stage and schedule, on the view's bank, read again only when
// the tick or the round has moved on (the bots' brains ask for it 90 times
// a think).
export function stage(view) {
  const dv = view.dv, o = view.bank || 0, h = L.PG_H + o;
  const tick = dv.getUint32(L.HDR_TICK + o, true), start = dv.getUint32(L.HDR_START + o, true), state = dv.getUint32(L.HDR_STATE + o, true);
  const hole = dv.getUint32(L.HDR_HOLE + o, true), n = Math.min(MC.JR_NSEGMAX, dv.getUint32(h + MC.JR_NSEG, true));
  const td = dv.getUint32(h + MC.JR_TD, true), hl = dv.getFloat32(h + MC.JR_HL, true), cx = dv.getFloat32(L.PG_CX + o, true);
  const c = view._jr;
  if (c && c.tick === tick && c.start === start && c.state === state && c.hole === hole && c.seg.length === n && c.td === td && c.hl === hl && c.cx === cx) return c;
  const seg = [];
  let key = (Math.imul(n + 1, 0x9e3779b9) ^ td) >>> 0;
  for (let k = 0; k < n; k++) {
    const e = h + MC.JR_SEG + 8 * k;
    const sg = { t0: dv.getUint16(e, true), law: dv.getUint8(e + 2), dir: dv.getInt8(e + 3), a0: dv.getInt32(e + 4, true) };
    seg.push(sg);
    key = (Math.imul(key ^ sg.t0, 0x85ebca6b) ^ sg.a0 ^ (sg.dir << 8) ^ sg.law) >>> 0;
  }
  const st = { hl, td, seg, key, cx, start, state, tick, hole };
  view._jr = st;
  return st;
}
// The first rope's angle on tick t into play (integer t), i32, 2^-24 turn: 0 at the bottom.
export function angleAt(st, t) {
  t = Math.max(0, Math.min(MC.JR_TMAX, t | 0));
  const n = st.seg.length;
  if (!n) return 0x800000;
  let k = n - 1;
  while (k > 0 && st.seg[k].t0 > t) k--;
  const s = st.seg[k];
  if (s.law === 0) return s.a0;
  const [o, sp, kk] = s.law === 1 ? [MC.JR_GRACE, MC.JR_S1, MC.JR_K1] : [st.td, MC.JR_S2, MC.JR_K2];
  return (s.a0 + Math.imul(s.dir, (F(sp, kk, t - o) - F(sp, kk, s.t0 - o)) | 0)) | 0;
}
// How fast the rope goes round into tick t, rad/s (+: the bottom towards +z; 0 held).
export const spinAt = (st, t) => ((angleAt(st, t) - angleAt(st, t - 1)) | 0) * MC.JR_RAD_TICK;
// The ropes turning on tick t.
export const ropesAt = (st, t) => (t >= st.td ? 2 : 1);
// The steps dropped by tick t into play, and the reach either way after k of them, in f32 as the sim has it.
export const dropsAt = (t) => (t < MC.JR_TC0 ? 0 : Math.min(MC.JR_STEPS, Math.floor((t - MC.JR_TC0) / MC.JR_TCI) + 1));
export const reachOf = (hl, k) => f(hl - f(f(hl * f(MC.JR_CUT)) * f(k / MC.JR_STEPS)));
export const reachAt = (st, t) => reachOf(st.hl, dropsAt(t));
// The switches: the tick each holds the rope and the tick it sets off the other way.
export const switches = (st) => {
  const out = [];
  for (let k = 3; k + 1 < st.seg.length; k += 2) out.push({ hold: st.seg[k].t0, go: st.seg[k + 1].t0 });
  return out;
};
// $jr_passed: the first rope going from angle a to b passed the bottom (side 0) or a side (1).
export function passed(a, b, side) {
  a = a << 8; b = b << 8;
  if (side) return ((a + 0x40000000) ^ (b + 0x40000000)) < 0;
  return (a ^ b) < 0 && ((b + 0x40000000) >>> 0) < 0x80000000;
}

// The first rope's angle, sine and cosine by tick for the round, worked out
// once and shared: every ball and every bot asks about the same few hundred
// ticks; and the ticks a rope passes the bottom.
const N_T = MC.JR_LEN + 1024;
const TL = { key: -1, a: new Int32Array(N_T), s: new Float64Array(N_T), c: new Float64Array(N_T), ok: new Uint8Array(N_T), cross: null };
function tl(st) {
  if (TL.key !== st.key) { TL.key = st.key; TL.ok.fill(0); TL.cross = null; }
  return TL;
}
function trig(st, t) {
  const T = tl(st);
  const i = Math.max(0, Math.min(N_T - 1, t | 0));
  if (!T.ok[i]) {
    const a = angleAt(st, i);
    T.a[i] = a; T.ok[i] = 1;
    const r = ((a & 0xffffff) / TURN24) * TAU;
    T.s[i] = Math.sin(r); T.c[i] = Math.cos(r);
  }
  return i;
}
// Every tick a rope passes the bottom, in order.
export function crossings(st) {
  const T = tl(st);
  if (T.cross) return T.cross;
  const out = [];
  for (let t = 1; t < N_T; t++) {
    const a = T.a[trig(st, t - 1)], b = T.a[trig(st, t)];
    if (passed(a, b, 0) || (t >= st.td && passed(a + 0x800000, b + 0x800000, 0))) out.push(t);
  }
  T.cross = Int32Array.from(out);
  return T.cross;
}

// The ropes and a ball whose centre is (wz across, wy up) from the axle, on
// tick t into play, as $jr_push has it: 1 touching, 2 swept past it clear (a
// jump), 0 neither.
export function contact(st, wz, wy, t) {
  const ip = trig(st, t - 1), ic = trig(st, t);
  const spin = (TL.a[ic] - TL.a[ip]) | 0;
  const wl = Math.hypot(wz, wy);
  let jump = 0;
  for (let k = 0; k < ropesAt(st, t); k++) {
    const m = k ? -1 : 1;
    const sp = TL.s[ip] * m, cp = TL.c[ip] * m, sn = TL.s[ic] * m, cn = TL.c[ic] * m;
    const crp = wz * cp + wy * sp, crn = wz * cn + wy * sn;
    const arc = spin !== 0 && wz * sp - wy * cp > 0 && (spin > 0 ? crp >= 0 && crn <= 0 : crp <= 0 && crn >= 0);
    const dist = arc ? Math.abs(wl - RR) : Math.hypot(wz - RR * sn, wy + RR * cn);
    if (dist < REACH) return 1;
    if (arc && wl > RR - MC.JR_JBAND) jump = 2;
  }
  return jump;
}

// ---- the hop: when the rope next meets a ball on the floor, and the hops that clear it

// A hop's bottom over the floor i ticks after it starts (as party's $b_move rolls it), till it lands.
const HOP = (() => {
  const out = [];
  let y = 0, vy = MC.JR_HOP;
  for (;;) { vy = f(vy - HOP_G); y = f(y + f(vy * f(TICK))); if (y <= 0) break; out.push(y); }
  return out;
})();
export const AIR = HOP.length + 1; // ticks a hop is in the air
const PROBE = [0, 0.4, 0.8, 1.25]; // bottoms a hop passes through, for which ticks the rope is near

// From tick t0 into play, a ball at z across (from the middle line) rolling
// vz, its speed times drag a tick: the next time the rope meets it on the
// floor, { first, last (ticks into play it would touch), early, late (the
// first and last ticks a hop may start and clear it; late < 0: none does) },
// or null if none comes within horizon ticks. A rope meets a ball within a
// few ticks of passing the bottom, so it looks round each such tick.
export function nextPass(st, t0, z, vz = 0, drag = 1, horizon = 260) {
  const cr = crossings(st);
  let lo = 0, hi = cr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (cr[m] < t0 - 30) lo = m + 1; else hi = m; }
  // where it is across i ticks on, coasting
  const n = horizon + 60, zs = ZS.length >= n ? ZS : (ZS = new Float64Array(n));
  for (let i = 0, run = 0, keep = 1; i < n; i++) { zs[i] = z + vz * run * TICK; keep *= drag; run += keep; }
  const zAt = (i) => zs[Math.min(n - 1, i)];
  for (let c = lo; c < cr.length && cr[c] - 30 < t0 + horizon; c++) {
    let first = -1, last = -1;
    for (let t = Math.max(t0, cr[c] - 30); t <= cr[c] + 30; t++) {
      if (contact(st, zAt(t - t0), FLOOR_WY, t) === 1) { if (first < 0) first = t; last = t; } else if (first >= 0 && t > last + 2) break;
    }
    if (first < 0) continue;
    // the ticks the rope comes near the ball at any height of a hop
    const near = [];
    for (let t = Math.max(t0, first - 12); t <= last + 12; t++) {
      const zz = zAt(t - t0);
      if (PROBE.some((y) => contact(st, zz, y + FLOOR_WY, t) === 1)) near.push(t);
    }
    let early = -1, late = -1;
    for (let j = first; j >= Math.max(t0, first - AIR); j--) {
      let ok = true;
      for (const t of near) {
        const k = t - j, y = k >= 0 && k < HOP.length ? HOP[k] : 0;
        if (contact(st, zAt(t - t0), y + FLOOR_WY, t) === 1) { ok = false; break; }
      }
      if (ok) { if (late < 0) late = j; early = j; } else if (late >= 0) break;
    }
    return { first, last, early, late };
  }
  return null;
}
let ZS = new Float64Array(400);

// ---- the AI ball

const ball = (view, me) => (typeof me === 'number' ? view.partier(me) : me);
let cue = null; // your ball's next pass as draw last saw it: { at (ms), go (a hop now clears it), ready (it's near), first }
let sound = null; // the page's sound, as the last FX handed it
let ticked = -1; // the pass the tick last sounded for
const tickIn = (st, tick) => (tick - st.start) | 0;

// The AI ball and the next pass. It means to hop in the middle of the
// moments that clear it, give or take its timing (more off the clumsier it
// is), and now and then misses one altogether. The window is worked out
// once a pass (bot.mem) from where it reckons it is on the tick its word
// lands, and again if it has moved since; it hops at the tick it means to,
// in time or not (its thinks come every 4th tick: at the last of them before
// that tick). With a pass within SETTLE ticks and room to stand (off the
// sides and the ends' steps) it stands still, braking, so the rope comes
// when it reckoned. -> { hop, still } or null
const SETTLE = 70;
function plan(view, me, bot, coast) {
  const b = ball(view, me);
  if (!b || !b.ground || b.out) return null;
  const st = stage(view);
  if (st.state !== L.H_PLAY || !st.seg.length) return null;
  const t0 = tickIn(st, bot?.at ?? view.tick);
  const x = bot?.pos?.[0] ?? b.pos[0], z = (bot?.pos?.[1] ?? b.pos[2]) - st.cx;
  const vz = bot?.vel?.[1] ?? b.vel[2];
  const dx = Math.abs(x - st.cx);
  const room = Math.abs(z) < MC.JR_HW - 1.2 && dx < reachAt(st, t0 + SETTLE + MC.JR_CWARN) - 1.5;
  // braking where it stands, as it will once the rope is near
  const drag = room ? view.dv.getFloat32(L.PG_IDLE + (view.bank || 0), true) : 1;
  const mem = bot?.mem || {};
  let w = mem.jr;
  if (!w || w.first < t0 || w.key !== st.key || Math.abs(w.z - z) > 0.25) {
    const nb = nextPass(st, t0, z, vz, drag);
    if (!nb) return null;
    const fresh = !w || Math.abs(w.first - nb.first) > 20;
    w = { ...(fresh ? {} : w), ...nb, z, key: st.key };
    if (fresh) {
      const skill = bot?.skill ?? 0.6, clumsy = 1 - skill;
      const r1 = bot?.rand ? bot.rand() : 0.5, r2 = bot?.rand ? bot.rand() : 0.5, r3 = bot?.rand ? bot.rand() : 0.5;
      const gauss = Math.sqrt(-2 * Math.log(1 - r2 * 0.999999)) * Math.cos(TAU * r3);
      Object.assign(w, { miss: r1 < MISS0 + MISS * clumsy * clumsy, off: gauss * (NOISE0 + NOISE * clumsy) });
    }
    w.at = Math.round((w.early + w.late) / 2 + w.off);
    mem.jr = w;
    if (bot) bot.mem = mem;
  }
  const still = coast && room && w.first - t0 <= SETTLE;
  if (w.miss || w.late < 0) return { hop: false, still };
  return { hop: w.at - t0 <= 3 && w.at - t0 > -4, still };
}

// ---- drawing

const WOOD = [0.86, 0.66, 0.42];
const STEP_COL = [[0.95, 0.52, 0.2], [0.98, 0.9, 0.72]]; // the ends' steps, outermost first
const ROPE_COL = [[0.95, 0.24, 0.2], [0.2, 0.55, 0.95]]; // the first rope, the second
const BEAD_COL = [[1, 0.86, 0.3], [0.95, 0.95, 0.95]];
const TOWER = [0.3, 0.32, 0.38];
const SKIN = [[0.98, 0.72, 0.3], [0.45, 0.78, 0.5]];

// A turner past the end at x0 (side -1 or 1), working the crank at angle a (radians) for each rope in.
function turner(sc, out, st, x0, side, a, ropes, lamp, now) {
  const hub = AXLE, cz = st.cx;
  const bx = x0 + side * 3.2; // the body, behind the crank's turn
  // the tower from the sea to the axle, hazard-striped, and its foot
  const top = hub - 1, foot = PLAT_Y - 30;
  sc.box(bx, (top + foot) / 2, cz, 1.6, (top - foot) / 2, 1.6, 0, ...TOWER, LOOK.HAZARD, 0.8);
  // the body: a fat round figure on top of it, its head and eyes on the stage
  const skin = SKIN[side > 0 ? 1 : 0];
  sc.cyl(bx, hub + 1.2, cz, 2.6, 2.2, ...skin, LOOK.PLASTIC);
  sc.sphere(bx, hub + 5.4, cz, 2.6, ...skin, LOOK.PLASTIC);
  for (const s of [-1, 1]) {
    sc.sphere(bx - side * 2.15, hub + 5.9, cz + s * 0.95, 0.62, 1, 1, 1, LOOK.PLASTIC);
    sc.sphere(bx - side * 2.6, hub + 5.9, cz + s * 0.95, 0.3, 0.05, 0.05, 0.06, LOOK.PLASTIC);
  }
  sc.box(bx - side * 2.45, hub + 4.5, cz, 0.12, 0.18, 0.9, 0, 0.75, 0.18, 0.16, LOOK.MATTE);
  // the lamp on its head: green turning, amber held, red flashing as a switch comes
  sc.sphere(bx, hub + 8.4, cz, 0.7, ...lamp, LOOK.GLOW, 1.3);
  out.glow?.push({ pos: [bx, hub + 8.4, cz], size: 3, color: [...lamp, 0.5], kind: SPRITE.FLASH });
  // the axle out to the hub, and the cranks: an arm from the hub to each rope's end, a knob there
  sc.cyl((bx + x0) / 2, hub, cz, 0.55, 1.6, 0.6, 0.62, 0.66, LOOK.METAL, 0, 0, 1, undefined, Math.PI / 2, -Math.PI / 2);
  sc.cyl(x0, hub, cz, 1.1, 0.5, 0.3, 0.3, 0.33, LOOK.METAL, 0, 0, 1, undefined, Math.PI / 2, -Math.PI / 2);
  for (let k = 0; k < ropes; k++) {
    const ak = a + k * Math.PI, s = Math.sin(ak), c = Math.cos(ak);
    sc.box(x0 - side * 0.4, hub - c * RR / 2, cz + s * RR / 2, 0.3, RR / 2, 0.35, 0, ...ROPE_COL[k].map((v) => v * 0.7), LOOK.METAL, 0, 0, 1, 60 + k, Math.PI - ak);
    sc.sphere(x0, hub - c * RR, cz + s * RR, 0.55, 0.3, 0.3, 0.33, LOOK.METAL);
  }
}

// A rope at angle a (radians) from crank to crank: a core and a braid of beads.
function rope(sc, st, a, k, alpha = 1, look = LOOK.PLASTIC, glow = 0) {
  const len = st.hl + MC.JR_XT, s = Math.sin(a), c = Math.cos(a);
  const y = AXLE - c * RR, z = st.cx + s * RR;
  const col = ROPE_COL[k];
  sc.cyl(st.cx, y, z, MC.JR_RW * 0.85, len, ...col, look, glow, 0, alpha, 80 + k, Math.PI / 2, -Math.PI / 2);
  if (alpha < 1) return;
  const n = Math.max(2, Math.round(len / 0.75));
  for (let i = 0; i < 2 * n; i++) {
    const x = st.cx - len + (i + 0.5) * (len / n);
    const bc = BEAD_COL[(i + k) & 1];
    sc.sphere(x, y, z, MC.JR_RW * 1.12, ...bc, LOOK.PLASTIC, 0, 0, 1, 200 + (i & 7));
  }
}

export default {
  id: L.MG_ROPE, key: 'rope', name: 'JUMP ROPE',
  hint: 'HOP THE ROPE AS IT COMES UNDER YOU  KEEP TO THE MIDDLE',
  env: 'day',

  draw(view, ctx, out) {
    const st = stage(view);
    if (!(st.hl > 0) || !st.seg.length) return;
    const sc = out.scene;
    const playing = st.state === L.H_PLAY || st.state === L.H_OVER;
    // on the prediction's clock: the rope meets your ball where it's drawn
    let t = 0;
    if (playing) {
      const pt = ctx.ptick ?? ctx.tick + (ctx.dt || 0) / TICK, pi = Math.floor(pt);
      t = Math.max(0, ((pi - st.start) | 0) + pt - pi); // the sim's i32 subtraction: it wraps
      if (st.state === L.H_OVER) t = Math.min(t, (view.party().until - L.P_OVER - st.start) | 0);
    }
    const ti = Math.floor(t);
    const now = (ctx.now ?? 0) / 1000;
    const k = dropsAt(ti);
    const hw = MC.JR_HW;
    // the stage: the middle that stays, then the steps either end, outermost first: a gone step falls away, fading; the next to go shakes and reddens
    const inner = reachOf(st.hl, MC.JR_STEPS);
    sc.box(st.cx, PLAT_Y - PLATE, st.cx, inner, PLATE, hw, 0, ...WOOD, LOOK.WOOD);
    for (let j = 0; j < MC.JR_STEPS; j++) {
      const r0 = reachOf(st.hl, j), r1 = reachOf(st.hl, j + 1), half = (r0 - r1) / 2, mid = (r0 + r1) / 2;
      let y = PLAT_Y - PLATE, alpha = 1, [rr, gg, bb] = STEP_COL[j & 1], dx = 0, dz = 0;
      if (j < k) {
        const a = (t - (MC.JR_TC0 + j * MC.JR_TCI)) * TICK;
        if (a > 1.6) continue;
        y -= 0.5 * 30 * a * a;
        alpha = 1 - a / 1.6;
      } else if (j === k) {
        const w = (t - (MC.JR_TC0 + j * MC.JR_TCI - MC.JR_CWARN)) / MC.JR_CWARN;
        if (w > 0) {
          const red = 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(now * (10 + 14 * w)));
          rr += (1 - rr) * red; gg += (0.22 - gg) * red; bb += (0.1 - bb) * red;
          const sh = 0.03 + 0.07 * w;
          dx = sh * Math.sin(now * 37); dz = sh * Math.sin(now * 29 + 1);
        }
      }
      for (const s of [-1, 1]) sc.box(st.cx + s * mid + dx, y, st.cx + dz, half, PLATE, hw, 0, rr, gg, bb, LOOK.PLASTIC, 0, 0, alpha, 40 + j * 2 + (s > 0));
    }
    // the lines: the middle one, lit as the rope comes; the sides
    const reach = reachAt(st, ti);
    const cr = crossings(st);
    let next = -1;
    for (let lo = 0, hi = cr.length; lo < hi;) { const m = (lo + hi) >> 1; if (cr[m] < ti) lo = m + 1; else { next = cr[m]; hi = m; } }
    const soon = st.state === L.H_PLAY && next >= 0 ? Math.max(0, 1 - (next - t) / 60) : 0;
    sc.box(st.cx, PLAT_Y + 0.015, st.cx, reach, 0.015, 0.16, 0, 0.9, 0.12, 0.1, soon > 0 ? LOOK.GLOW : LOOK.MATTE, 0.3 + 1.2 * soon * soon, 0, 1, 30);
    for (const s of [-1, 1]) sc.box(st.cx, PLAT_Y + 0.015, st.cx + s * (hw - 0.2), reach, 0.015, 0.08, 0, 0.97, 0.97, 0.95, LOOK.MATTE, 0, 0, 1, 31 + (s > 0));
    // the ropes, the turners and their cranks; a rope coming is a flashing ghost first
    const ia = Math.floor(t), fa = t - ia;
    const a0 = angleAt(st, ia), a1 = angleAt(st, ia + 1);
    const a = (((a0 & 0xffffff) + fa * ((a1 - a0) | 0)) / TURN24) * TAU;
    const ropes = playing ? ropesAt(st, ti) : 1;
    const spin = playing ? spinAt(st, ti + 1) : 0;
    const sw = switches(st).find((s) => ti >= s.hold - MC.JR_WARN && ti < s.go);
    const lamp = sw ? (Math.sin(now * 16) > 0 ? [1, 0.2, 0.15] : [0.4, 0.06, 0.05]) : spin ? [0.3, 1, 0.4] : [1, 0.7, 0.15];
    for (let r = 0; r < ropes; r++) {
      rope(sc, st, a + r * Math.PI, r);
      // a smear behind a fast rope
      for (let i = 1; i <= 3 && Math.abs(spin) > 2; i++) rope(sc, st, a + r * Math.PI - spin * 0.012 * i, r, 0.22 / i, LOOK.GLOW, 0.5);
    }
    if (ropes === 1 && playing && ti >= st.td - MC.JR_WARN) {
      const pulse = 0.5 + 0.5 * Math.sin(now * 12);
      rope(sc, st, a + Math.PI, 1, 0.3 + 0.3 * pulse, LOOK.GLOW, 1 + pulse);
    }
    for (const s of [-1, 1]) turner(sc, out, st, st.cx + s * (st.hl + MC.JR_XT), s, a, ropes, lamp, now);
    // under your own ball, the rope's coming: a ring closing in, green while a hop now clears it; a tick on the moment to hop
    const me = ctx.pme ?? ctx.me;
    const live = st.state === L.H_PLAY && me && me.live && !me.out && ctx.slot >= 0;
    const nb = live && me.ground ? nextPass(st, ti, me.pos[2] - st.cx, me.vel[2], 1, 200) : null;
    const go = !!nb && nb.late >= ti && nb.early <= ti;
    if (nb && nb.late >= ti && ticked !== nb.first && nb.first - ti <= LEAD) { ticked = nb.first; sound?.tick?.(); }
    cue = { at: ctx.now ?? 0, go, ready: !!nb && nb.late >= ti && nb.first - ti < 125 };
    if (nb) {
      const u = Math.min(1, (nb.first - t) / 150);
      out.decals?.push({ pos: [me.pos[0], PLAT_Y + 0.04, me.pos[2]], radius: 1.15 + 2.6 * Math.max(0, u), width: 0.22,
        color: go ? [0.3, 1, 0.35, 0.95] : nb.late < ti ? [1, 0.3, 0.2, 0.7 * (1 - u) + 0.15] : [1, 0.95, 0.6, 0.85 * (1 - u) + 0.15], kind: DECAL.RING });
    }
  },

  // the stage as it stands
  frame(view) {
    const st = stage(view);
    const g = view.party();
    const t = g.state === L.H_PLAY ? g.t : 0;
    return { centre: [st.cx || g.cx, PLAT_Y, st.cx || g.cx], radius: (st.hl > 0 ? reachAt(st, t) : g.size) + 2, shape: 'square' };
  },

  // facing the way the rope comes along the floor from
  facing(view) {
    const st = stage(view);
    const dir = st.seg[1]?.dir ?? 1;
    return dir > 0 ? -Math.PI / 2 : Math.PI / 2;
  },

  fx(fx, ctx) {
    sound = ctx.sound || sound;
    const d = typeof ctx.dist === 'function' ? ctx.dist(fx.pos) : ctx.dist ?? 0;
    if (fx.kind === MC.JR_FX_HIT) {
      const mine = fx.owner === ctx.slot;
      ctx.sound?.boing?.(Math.min(30, fx.size * 2), mine ? 0 : d);
      if (mine || d < 40) {
        ctx.glow?.({ pos: [fx.pos[0], fx.pos[1] + 0.8, fx.pos[2]], size: 1.4, color: [1, 0.5, 0.3, 1], kind: SPRITE.SPARK, life: 260 });
        ctx.glow?.({ pos: [fx.pos[0], fx.pos[1] + 0.8, fx.pos[2]], size: 2.2, color: [1, 0.4, 0.25, 0.8], kind: SPRITE.RING, life: 380, grow: true });
      }
      if (mine) ctx.banner?.('WHIPPED!', C.ORANGE, 700);
    } else if (fx.kind === MC.JR_FX_CALL) {
      ctx.banner?.(fx.shot === 1 ? 'DOUBLE DUTCH COMING' : 'THE TURNERS SWITCH', C.YELLOW, 1800);
      ctx.sound?.tick?.();
    } else if (fx.kind === MC.JR_FX_GO) {
      ctx.banner?.(['JUMP!', 'DOUBLE DUTCH!', 'THE OTHER WAY!'][fx.shot] || 'JUMP!', fx.shot ? C.ORANGE : C.GREEN, 1400);
      ctx.sound?.count?.(0);
    } else if (fx.kind === MC.JR_FX_END) {
      if (fx.shot === 0) ctx.sound?.count?.(1);
      else ctx.sound?.land?.(28);
    }
  },

  // the ropes and how fast, what's coming, and HOP! when a hop now clears the rope
  hud(view, ctx) {
    const st = stage(view);
    if (st.state !== L.H_PLAY || !(st.hl > 0) || !st.seg.length) return;
    const t = Math.max(0, (typeof ctx.t === 'number' ? Math.floor(ctx.t / TICK) : view.party().t) | 0);
    const row = Math.max(3, Math.floor((ctx.rows || 40) * 0.18));
    const me = ctx.me ?? (ctx.slot >= 0 ? view.partier(ctx.slot) : null);
    const playing = me && me.live && !me.out;
    const w = Math.abs(spinAt(st, t + 1));
    const n = ropesAt(st, t);
    ctx.right(3, `${n === 2 ? 'DOUBLE DUTCH' : 'ONE ROPE'}  ${w ? `${(w / TAU).toFixed(2)} TURNS/S` : 'HELD'}` + (playing ? `  JUMPS ${me.m & 0xffff}` : ''), C.GREY);
    if (t < MC.JR_GRACE) { ctx.centre(row, `HOP THE ROPE  IT TURNS IN ${((MC.JR_GRACE - t) * TICK).toFixed(1)}`, C.YELLOW); return; }
    if (t >= st.td - MC.JR_WARN && t < st.td) ctx.centre(row, `DOUBLE DUTCH IN ${((st.td - t) * TICK).toFixed(1)}`, C.YELLOW);
    for (const s of switches(st)) {
      if (t >= s.hold - MC.JR_WARN && t < s.go) { ctx.centre(row, t < s.hold ? `SWITCH IN ${((s.hold - t) * TICK).toFixed(1)}` : 'SWITCH: THE OTHER WAY', C.ORANGE); break; }
    }
    const k = dropsAt(t);
    if (k < MC.JR_STEPS) {
      const drop = MC.JR_TC0 + k * MC.JR_TCI;
      if (t >= drop - MC.JR_CWARN) {
        ctx.centre(row + 1, `THE ENDS DROP IN ${((drop - t) * TICK).toFixed(1)}`, C.ORANGE);
        if (playing && Math.abs(me.pos[0] - st.cx) > reachOf(st.hl, k + 1) - 0.5) ctx.centre(row + 2, 'GET IN!', C.RED);
      }
    }
    // the cue draw worked out for your ball as you see it (the prediction's)
    if (playing && cue && (ctx.now ?? 0) - cue.at < 120 && cue.ready) ctx.centre(row + 3, cue.go ? 'HOP!' : 'READY', cue.go ? C.GREEN : C.WHITE);
  },

  brain: {
    // off the stage (as it stands on that tick) is a fall; a step about to
    // drop, nearly as bad; the sides, where the rope comes in at a ball's
    // height and no hop clears it, bad, and the last metres to the ends a little
    danger(view, x, z, tick) {
      const st = stage(view);
      if (st.state !== L.H_PLAY || !st.seg.length) return 0;
      const t = tickIn(st, tick);
      const dx = Math.abs(x - st.cx), dz = Math.abs(z - st.cx);
      const k = dropsAt(t), reach = reachOf(st.hl, k);
      if (dx > reach - 0.3 || dz > MC.JR_HW - 0.3) return 1;
      let d = 0;
      if (k < MC.JR_STEPS && t >= MC.JR_TC0 + k * MC.JR_TCI - MC.JR_CWARN - 125 && dx > reachOf(st.hl, k + 1) - 1.5) d = 0.8;
      if (dz > MC.JR_HW - 1.6) d = Math.max(d, 0.7 * (1 - (MC.JR_HW - 0.3 - dz) / 1.3));
      else if (dz > 2.6) d = Math.max(d, 0.12);
      if (dx > reach - 3) d = Math.max(d, 0.4 * (1 - (reach - dx) / 3));
      return d;
    },

    // where it is along the stage (inside the ends to come), in the middle band across
    goal(view, me, bot) {
      const b = ball(view, me);
      if (!b || !b.live || b.out) return null;
      const st = stage(view);
      const t = tickIn(st, bot?.at ?? view.tick);
      const x = bot?.pos?.[0] ?? b.pos[0], z = bot?.pos?.[1] ?? b.pos[2];
      const lim = Math.max(0.5, reachAt(st, t + 500) - 3);
      return [st.cx + Math.max(-lim, Math.min(lim, x - st.cx)), st.cx + Math.max(-2, Math.min(2, z - st.cx))];
    },

    // what plan() says about hopping, steering as the planner likes
    hop(view, me, bot) { return plan(view, me, bot, false)?.hop ?? false; },

    // the rope on its way and room to stand: still, to hop it from where it is
    think(view, me, bot) {
      const p = plan(view, me, bot, true);
      return p?.still ? { yaw: (bot?.yaw ?? 0) / 16384 * TAU, move: 0, hop: p.hop } : null;
    },
  },
};
