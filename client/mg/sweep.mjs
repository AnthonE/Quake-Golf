// SWEEPER, as drawn and as the AI ball sees it. The platform is a target of
// concentric rings round a candy-striped post; yellow and black bars turn
// round it at ball height, a glow at each tip and a faint smear behind; a bar
// that's coming shows as a flashing ghost first. The ring that drops next
// flashes red and shakes, a red line on the floor where the edge will be,
// and falls away. Under your own ball a ring closes in as the next bar comes,
// green while a hop now clears it. All of it is the sim's own schedule
// (src/mg/sweep.wat): the bars' angle in 2^-24 turn worked again here in
// i32, the rim in f32, so what is drawn and what the bots steer by is what
// the sim does.
import * as L from '../../src/layout.mjs';
import { PLAT_Y } from '../../src/party-view.mjs';
import { LOOK, SPRITE, DECAL } from '../party-render.mjs';
import { C } from '../font.mjs';

const f = Math.fround;
const TICK = 0.008;
const TAU = 2 * Math.PI;
const TURN24 = 2 ** 24;
const R = 1; // a ball's radius (no power-ups here)
const REACH = R + L.SW_BW; // a ball's centre touches a bar's axis within this
const AXIS = PLAT_Y + L.SW_BY;
const BAND = Math.sqrt(REACH * REACH - (R - L.SW_BY) ** 2); // how near the axis a ball on the floor touches, across
const HOP_G = f(Number(L.PHYS.GP_DT)); // gravity a tick in the air
const HUB = 5; // m from the centre in which a bar is too slow to hop
// The AI ball's luck with a bar: it misses seeing one MISS0 plus MISS times
// its clumsiness squared of the time, and hops too late LATE times its
// clumsiness (clumsiness: 1 - skill).
const MISS0 = 0.01, MISS = 0.1, LATE = 0.06;
const PLATE = 0.6; // the platform's half thickness, m
const RING_COL = [[0.96, 0.91, 0.8], [0.08, 0.52, 0.6]]; // cream and teal, outermost first
const MID_COL = [0.86, 0.3, 0.22]; // the middle disc
const BAR_COL = [1, 0.78, 0.08];

// ---- the schedule, as $sw_f, $sw_angle, $sw_drops and $sw_rim have it

// Ticks 0..t-1 of the bars' speed, in 2^-24 turn (i32, wrapping).
const F = (t) => (Math.imul(t, L.SW_S0) + Math.imul(Math.imul(t, t - 1) >>> 1, L.SW_SK)) | 0;
// The first bar's angle on tick t into play (integer t), i32.
export function angleAt(a0, dir, t) {
  t = Math.max(0, Math.min(L.SW_TMAX, t | 0));
  let a = a0 | 0;
  if (t < L.SW_GRACE) return a;
  let from = L.SW_GRACE;
  for (let k = 0; k < 3; k++) {
    const tk = L.SW_TS[k];
    if (t < tk) return (a + Math.imul(dir, (F(t) - F(from)) | 0)) | 0;
    a = (a + Math.imul(dir, (F(tk) - F(from)) | 0)) | 0;
    from = tk + L.SW_PAUSE;
    if (t < from) return a;
    dir = -dir;
  }
  return (a + Math.imul(dir, (F(t) - F(from)) | 0)) | 0;
}
// The rings dropped by tick t into play.
export const dropsAt = (t) => (t < L.SW_TR0 ? 0 : Math.min(L.SW_RINGS, Math.floor((t - L.SW_TR0) / L.SW_TRI) + 1));
// The rim after k drops, in f32 as the sim has it.
export const rimOf = (r0, k) => f(r0 - f(f(r0 - L.SW_RMIN) * f(k / L.SW_RINGS)));
// Is bar k solid on tick t? A ghost (coming) from SW_WARN before.
export const solidAt = (k, t) => k === 0 || t >= L.SW_TS[k - 1];
const ghostAt = (k, t) => k > 0 && t < L.SW_TS[k - 1] && t >= L.SW_TS[k - 1] - L.SW_WARN;
// Bars turning (solid) on tick t.
export const barsAt = (t) => 1 + L.SW_TS.filter((tk) => t >= tk).length;

// This round's platform and bars, on the view's bank.
export function stage(view) {
  const dv = view.dv, o = view.bank || 0;
  const g = view.party();
  return {
    r0: dv.getFloat32(L.PG_H + L.SW_RAD + o, true), a0: dv.getUint32(L.PG_H + L.SW_A0 + o, true) | 0, dir: dv.getInt32(L.PG_H + L.SW_DIR + o, true) || 1,
    cx: dv.getFloat32(L.PG_CX + o, true), start: dv.getUint32(L.HDR_START + o, true), state: g.state, tick: g.tick,
  };
}
// The first bar's angle in radians at tick t into play, t fractional (drawing).
function radAt(st, t) {
  const i = Math.floor(t), a = angleAt(st.a0, st.dir, i), b = angleAt(st.a0, st.dir, i + 1);
  return ((a >>> 0) + (t - i) * ((b - a) | 0)) / TURN24 * TAU;
}
// How fast the bars turned into tick t, rad/s signed (+: x towards z).
export const spinAt = (st, t) => ((angleAt(st.a0, st.dir, t) - angleAt(st.a0, st.dir, t - 1)) | 0) * L.SW_RAD_TICK;
const quarter = (k) => L.SW_QUARTER[k] * Math.PI / 2;
export const rimAt = (st, t) => rimOf(st.r0, dropsAt(t));
// The first bar's cos and sin on tick t (the others a quarter turn or two
// on: (c, s), (-s, c), (-c, -s), (s, -c)), remembered by tick for the round:
// every bot asks about the same few hundred ticks.
const TRIG = { a0: 0, dir: 0, tag: new Int32Array(1024).fill(-1), c: new Float64Array(1024), s: new Float64Array(1024) };
function trig(st, t) {
  if (TRIG.a0 !== st.a0 || TRIG.dir !== st.dir) { TRIG.a0 = st.a0; TRIG.dir = st.dir; TRIG.tag.fill(-1); }
  const i = t & 1023;
  if (TRIG.tag[i] !== t) {
    const a = angleAt(st.a0, st.dir, t) / TURN24 * TAU;
    TRIG.tag[i] = t; TRIG.c[i] = Math.cos(a); TRIG.s[i] = Math.sin(a);
  }
  return i;
}
const QC = [[1, 0], [0, -1], [-1, 0], [0, 1]]; // (c, s) turned q quarters: c' = c qc[0] + s qc[1], s' = s qc[0] - c qc[1]

// Does a ball whose bottom is y over the floor, centred over (x, z), touch a bar on tick t into play?
export function touches(st, x, z, y, t) {
  const dy = y + R - L.SW_BY;
  if (Math.abs(dy) >= REACH) return false;
  const i = trig(st, t), c0 = TRIG.c[i], s0 = TRIG.s[i], len = rimAt(st, t) + L.SW_OVER, dx = x - st.cx, dz = z - st.cx;
  for (let k = 0; k < 4; k++) {
    if (!solidAt(k, t)) continue;
    const q = QC[L.SW_QUARTER[k]], c = c0 * q[0] + s0 * q[1], s = s0 * q[0] - c0 * q[1];
    const along = dx * c + dz * s, h = dz * c - dx * s;
    if (along > 0 && along < len && h * h + dy * dy < REACH * REACH) return true;
  }
  return false;
}

// ---- the hop: when the next bar meets a ball on the floor, and the hops that clear it

// A hop's bottom over the floor i ticks after it starts (as party's $b_move rolls it), till it lands.
const HOP = (() => {
  const v0 = L.SW_HOP;
  const out = [];
  let y = 0, vy = v0;
  for (;;) { vy = f(vy - HOP_G); y = f(y + f(vy * f(TICK))); if (y <= 0) break; out.push(y); }
  return out;
})();
// How near a bar's axis, across, the ball touches it i ticks into a hop (0 clear above it).
const HOP_BAND = HOP.map((y) => { const dy = y + R - L.SW_BY; return dy >= REACH ? 0 : Math.sqrt(REACH * REACH - dy * dy); });
export const AIR = HOP.length + 1; // ticks a hop is in the air

// From tick t0 into play, the ball rolling from (x, z) at (vx, vz) on the
// floor, its speed times drag a tick: how far across the nearest bar each
// tick for n ticks (|h|, 1e9 for none near), when it first meets a bar on
// the floor and when that stops.
const SCR = { h: new Float64Array(256) };
function across(st, t0, x, z, vx, vz, n, drag) {
  const h = SCR.h;
  let first = -1, last = -1, run = 0, keep = 1;
  for (let i = 0; i < n; i++) {
    const t = t0 + i, px = x + vx * run * TICK - st.cx, pz = z + vz * run * TICK - st.cx;
    keep *= drag;
    run += keep;
    const j = trig(st, t), c0 = TRIG.c[j], s0 = TRIG.s[j], len = rimAt(st, t) + L.SW_OVER;
    let best = 1e9;
    for (let k = 0; k < 4; k++) {
      if (!solidAt(k, t)) continue;
      const q = QC[L.SW_QUARTER[k]], c = c0 * q[0] + s0 * q[1], s = s0 * q[0] - c0 * q[1];
      const along = px * c + pz * s;
      if (along <= 0 || along >= len) continue;
      best = Math.min(best, Math.abs(pz * c - px * s));
    }
    h[i] = best;
    if (best < BAND) { if (first < 0) first = i; last = i; } else if (first >= 0 && last >= 0 && i > last + 2) break;
  }
  return { first, last };
}
// Does a hop starting j ticks from t0 keep clear of the bar through the ticks [first, last]?
function clears(j, first, last) {
  if (j > first) return false;
  for (let i = first; i <= last; i++) {
    const k = i - j;
    const band = k < HOP.length ? HOP_BAND[k] : BAND;
    if (SCR.h[i] < band) return false;
  }
  return true;
}
// The next bar for a ball on the floor at (x, z) rolling (vx, vz) on tick t0
// into play (its speed times drag a tick): { meet (ticks till it touches),
// until (the last tick it would), early, late (the first and last ticks from
// t0 a hop may start and clear it; late < 0: none does) }, or null.
export function nextBar(st, t0, x, z, vx = 0, vz = 0, horizon = 160, drag = 1) {
  const { first, last } = across(st, t0, x, z, vx, vz, Math.min(256, horizon), drag);
  if (first < 0) return null;
  let early = -1, late = -1;
  for (let j = first; j >= Math.max(0, first - AIR); j--) {
    if (clears(j, first, last)) { if (late < 0) late = j; early = j; } else if (late >= 0) break;
  }
  return { meet: first, until: last, early, late };
}

// ---- the AI ball

const ball = (view, me) => (typeof me === 'number' ? view.partier(me) : me);
let cue = null; // your ball's next bar as draw last saw it: { at (ms), go (a hop now clears it), ready (it's near) }
let sound = null; // the page's sound, as the last FX handed it: a click as the hop's moment comes
const tickIn = (st, tick) => (tick - st.start) | 0;

// The AI ball and the next bar. It means to hop in the middle of the
// moments that clear it, give or take: off by luck (more the clumsier it is),
// now and then too late, now and then not at all. The window is reckoned in
// ticks into play while it's all still to come, and moved with the bar once
// the ball is in it; it hops at the tick it means to or as the window closes,
// whichever is first, so a think that comes late or a word that lands late
// still clears. Its luck for a bar is fixed when it first sees it (bot.mem).
// With a bar within SETTLE ticks and room to stand (between the hub and the
// last 3 m to the rim, the edge not about to drop) it stands still, braking,
// so the bar comes when it reckoned. -> { hop, still } or null
const SETTLE = 70;
function plan(view, me, bot, coast) {
  const b = ball(view, me);
  if (!b || !b.ground || b.out) return null;
  const st = stage(view);
  if (st.state !== L.H_PLAY) return null;
  const t0 = tickIn(st, bot?.at ?? view.tick);
  const x = bot?.pos?.[0] ?? b.pos[0], z = bot?.pos?.[1] ?? b.pos[2];
  const vx = bot?.vel?.[0] ?? b.vel[0], vz = bot?.vel?.[1] ?? b.vel[2];
  const rho = Math.hypot(x - st.cx, z - st.cx), k = dropsAt(t0 + SETTLE);
  const room = rho > HUB && rho < rimAt(st, t0 + SETTLE) - 3
    && !(k < L.SW_RINGS && t0 + SETTLE >= L.SW_TR0 + k * L.SW_TRI - L.SW_RWARN && rho > rimOf(st.r0, k + 1) - 1.5);
  const nb = nextBar(st, t0, x, z, vx, vz, 140, coast && room ? view.dv.getFloat32(L.PG_IDLE + (view.bank || 0), true) : 1);
  if (!nb) return null;
  const still = coast && room && nb.meet <= SETTLE;
  const mem = bot?.mem || {};
  const skill = bot?.skill ?? 0.6, clumsy = 1 - skill;
  const pass = t0 + nb.meet;
  if (!mem.sw || Math.abs(mem.sw.pass - pass) > 20) {
    const r1 = bot?.rand ? bot.rand() : 0.5, r2 = bot?.rand ? bot.rand() : 0.5;
    mem.sw = { pass, miss: r1 < MISS0 + MISS * clumsy * clumsy, late: r1 > 1 - LATE * clumsy, off: (r2 - 0.5) * 0.8 * clumsy, from: -1, to: -1 };
    if (bot) bot.mem = mem;
  }
  const sw = mem.sw;
  sw.pass = pass;
  if (sw.miss) return { hop: false, still };
  // too late: once no hop clears it, before it gets here
  if (sw.late) return { hop: nb.late < 0 && nb.meet < 40, still };
  if (nb.late < 0) return { hop: false, still };
  if (sw.from < 0 || nb.early > 0) sw.from = t0 + nb.early;
  else sw.from += t0 + nb.late - sw.to;
  sw.to = t0 + nb.late;
  const at = Math.round((sw.from + sw.to) / 2 + sw.off * (sw.to - sw.from));
  return { hop: at - t0 <= 3 || nb.late <= 6, still };
}

export default {
  id: L.MG_SWEEP, key: 'sweep', name: 'SWEEPER',
  hint: 'HOP THE BARS AS THEY SWEEP ROUND  KEEP ON THE PLATFORM',
  env: 'sunset',

  draw(view, ctx, out) {
    const st = stage(view);
    if (!(st.r0 > 0)) return;
    const sc = out.scene;
    const playing = st.state === L.H_PLAY || st.state === L.H_OVER;
    // on the prediction's clock: a bar meets your ball where it's drawn
    let t = 0;
    if (playing) {
      const pt = ctx.ptick ?? ctx.tick + (ctx.dt || 0) / TICK, pi = Math.floor(pt);
      t = Math.max(0, ((pi - st.start) | 0) + pt - pi); // the sim's i32 subtraction: it wraps
      if (st.state === L.H_OVER) t = Math.min(t, (view.party().until - L.P_OVER - st.start) | 0);
    }
    const ti = Math.floor(t);
    const k = dropsAt(ti);
    const now = (ctx.now ?? 0) / 1000;
    // the rings, outermost first, each a disc under the next (4 mm lower): the next to go shakes and reddens
    for (let j = 0; j <= L.SW_RINGS; j++) {
      const rj = rimOf(st.r0, j);
      const col = j === L.SW_RINGS ? MID_COL : RING_COL[j & 1];
      let y = PLAT_Y - PLATE + 0.004 * j, x = st.cx, z = st.cx, alpha = 1, rr = col[0], gg = col[1], bb = col[2];
      if (j < k) {
        // gone: falling away from the moment it dropped, fading
        const a = (t - (L.SW_TR0 + j * L.SW_TRI)) * TICK;
        if (a > 1.6) continue;
        y -= 0.5 * 30 * a * a;
        alpha = 1 - a / 1.6;
      } else if (j === k && j < L.SW_RINGS) {
        const drop = L.SW_TR0 + j * L.SW_TRI, w = (t - (drop - L.SW_RWARN)) / L.SW_RWARN;
        if (w > 0) {
          // red, flashing faster as it goes, and shaking
          const pulse = 0.5 + 0.5 * Math.sin(now * (10 + 14 * w));
          const red = 0.65 + 0.35 * pulse;
          rr += (1 - rr) * red; gg += (0.22 - gg) * red; bb += (0.1 - bb) * red;
          const sh = 0.03 + 0.07 * w;
          x += sh * Math.sin(now * 37); z += sh * Math.sin(now * 29 + 1);
        }
      }
      sc.cyl(x, y, z, rj, PLATE, rr, gg, bb, j === L.SW_RINGS ? LOOK.RUBBER : LOOK.PLASTIC, 0, 0, alpha);
    }
    // the edge to come, during a ring's warning
    if (k < L.SW_RINGS) {
      const drop = L.SW_TR0 + k * L.SW_TRI;
      if (t >= drop - L.SW_RWARN) {
        const pulse = 0.5 + 0.5 * Math.sin(now * 14);
        out.decals?.push({ pos: [st.cx, PLAT_Y + 0.04, st.cx], radius: rimOf(st.r0, k + 1), width: 0.35, color: [1, 0.2, 0.1, 0.6 + 0.4 * pulse], kind: DECAL.RING });
      }
    }
    // the post: a candy-striped pole, a steel collar where the bars meet it, a lamp on top (green turning, amber still)
    const spin = playing ? spinAt(st, ti) : 0;
    const lamp = spin ? [0.3, 1, 0.4] : [1, 0.7, 0.15];
    const band = L.SW_POSTH / 6;
    for (let i = 0; i < 6; i++) {
      const red = i & 1;
      sc.cyl(st.cx, PLAT_Y + band * (i + 0.5), st.cx, L.SW_POST, band / 2, red ? 0.9 : 0.97, red ? 0.16 : 0.95, red ? 0.14 : 0.9, LOOK.PLASTIC);
    }
    sc.cyl(st.cx, AXIS, st.cx, L.SW_POST + 0.22, L.SW_BW + 0.12, 0.3, 0.3, 0.33, LOOK.METAL);
    sc.cyl(st.cx, PLAT_Y + L.SW_POSTH + 0.06, st.cx, L.SW_POST + 0.12, 0.08, 0.3, 0.3, 0.33, LOOK.METAL);
    sc.sphere(st.cx, PLAT_Y + L.SW_POSTH + 0.7, st.cx, 0.75, ...lamp, LOOK.GLOW, 1.2);
    out.glow?.push({ pos: [st.cx, PLAT_Y + L.SW_POSTH + 0.7, st.cx], size: 3, color: [...lamp, 0.5], kind: SPRITE.FLASH });
    // the bars: solid ones hazard-striped with a glowing tip and a smear behind, coming ones a pulsing ghost
    const a = radAt(st, t);
    const len = rimAt(st, ti) + L.SW_OVER;
    const half = (len - L.SW_POST) / 2, mid = L.SW_POST + half;
    const smear = playing ? spinAt(st, ti + 1) * 0.06 : 0; // radians the bar turns in 0.06 s
    for (let b = 0; b < 4; b++) {
      const solid = solidAt(b, ti), ghost = !solid && ghostAt(b, ti);
      if (!solid && !ghost) continue;
      const ang = a + quarter(b), c = Math.cos(ang), s = Math.sin(ang);
      const x = st.cx + c * mid, z = st.cx + s * mid;
      if (ghost) {
        // a bar coming: a flashing ghost where it will be, and its line on the floor
        const pulse = 0.5 + 0.5 * Math.sin(now * 12);
        sc.box(x, AXIS, z, half, L.SW_BW, L.SW_BW, ang, 1, 0.92, 0.6, LOOK.GLOW, 1 + pulse, 0.3, 0.4 + 0.3 * pulse, 30 + b);
        sc.box(x, PLAT_Y + 0.02, z, half, 0.02, L.SW_BW + 0.9, ang, 1, 0.85, 0.3, LOOK.GLOW, 0.6 + 0.6 * pulse, 0.6, 0.3 + 0.2 * pulse, 34 + b);
        continue;
      }
      sc.box(x, AXIS, z, half, L.SW_BW, L.SW_BW, ang, ...BAR_COL, LOOK.HAZARD, 0.7, 0, 1, 7 + b);
      const tx = st.cx + c * len, tz = st.cx + s * len;
      sc.sphere(tx, AXIS, tz, L.SW_BW * 1.5, 1, 0.45, 0.15, LOOK.GLOW, 1.3);
      out.glow?.push({ pos: [tx, AXIS, tz], size: 1.6, color: [1, 0.55, 0.2, 0.6], kind: SPRITE.FLASH });
      for (let i = 1; i <= 3 && Math.abs(smear) > 0.004; i++) {
        const sa = ang - smear * i, sx = st.cx + Math.cos(sa) * mid, sz = st.cx + Math.sin(sa) * mid;
        sc.box(sx, AXIS, sz, half, L.SW_BW * 0.9, L.SW_BW * 0.9, sa, 1, 0.85, 0.5, LOOK.GLOW, 0.5, 0, 0.22 / i, 20 + b * 4 + i);
      }
    }
    // under your own ball, the next bar's coming: a ring closing in, green while a hop now clears it
    const me = ctx.pme ?? ctx.me;
    const nb = st.state === L.H_PLAY && me && me.live && !me.out && me.ground && ctx.slot >= 0 ? nextBar(st, ti, me.pos[0], me.pos[2], me.vel[0], me.vel[2], 160) : null;
    const go = !!nb && nb.late >= 0 && nb.early === 0;
    if (go && !cue?.go) sound?.tick?.();
    cue = { at: ctx.now ?? 0, go, ready: !!nb && nb.late >= 0 && nb.meet < 125 };
    if (nb) {
      const u = Math.min(1, nb.meet / 150);
      out.decals?.push({ pos: [me.pos[0], PLAT_Y + 0.04, me.pos[2]], radius: 1.15 + 2.6 * u, width: 0.22,
        color: go ? [0.3, 1, 0.35, 0.95] : nb.late < 0 ? [1, 0.3, 0.2, 0.7 * (1 - u) + 0.15] : [1, 0.95, 0.6, 0.85 * (1 - u) + 0.15], kind: DECAL.RING });
    }
  },

  // the platform as it stands
  frame(view) {
    const st = stage(view);
    const g = view.party();
    const t = g.state === L.H_PLAY ? g.t : 0;
    const r = (st.r0 > 0 ? rimAt(st, t) : g.size) + 1;
    return { centre: [st.cx || g.cx, PLAT_Y, st.cx || g.cx], radius: r, shape: 'disc' };
  },

  fx(fx, ctx) {
    sound = ctx.sound || sound;
    const d = typeof ctx.dist === 'function' ? ctx.dist(fx.pos) : ctx.dist ?? 0;
    if (fx.kind === L.SW_FX_HIT) {
      const mine = fx.owner === ctx.slot;
      ctx.sound?.boing?.(Math.min(30, fx.size), mine ? 0 : d);
      if (mine || d < 40) {
        ctx.glow?.({ pos: [fx.pos[0], fx.pos[1] + 0.8, fx.pos[2]], size: 1.2 + fx.size * 0.05, color: [1, 0.85, 0.3, 1], kind: SPRITE.SPARK, life: 260 });
        ctx.glow?.({ pos: [fx.pos[0], fx.pos[1] + 0.8, fx.pos[2]], size: 2.2, color: [1, 0.7, 0.2, 0.8], kind: SPRITE.RING, life: 380, grow: true });
      }
      if (mine) ctx.banner?.('WHACK!', C.ORANGE, 700);
    } else if (fx.kind === L.SW_FX_BEAM) {
      ctx.banner?.(`BAR ${fx.shot + 1} COMING  THEN THEY TURN BACK`, C.YELLOW, 2200);
      ctx.sound?.tick?.();
    } else if (fx.kind === L.SW_FX_GO) {
      if (fx.shot & 16) ctx.banner?.(`REVERSE!  ${fx.shot & 15} BARS`, C.ORANGE, 1400);
      else ctx.banner?.('HOP THE BAR!', C.GREEN, 1400);
      ctx.sound?.count?.(0);
    } else if (fx.kind === L.SW_FX_RING) {
      if (fx.shot === 0) ctx.sound?.count?.(1);
      else ctx.sound?.land?.(28);
    }
  },

  // the bars and how fast, a bar or a ring coming, and HOP! when a hop now clears the next bar
  hud(view, ctx) {
    const st = stage(view);
    if (st.state !== L.H_PLAY || !(st.r0 > 0)) return;
    const t = Math.max(0, (typeof ctx.t === 'number' ? Math.floor(ctx.t / TICK) : view.party().t) | 0);
    const row = Math.max(3, Math.floor((ctx.rows || 40) * 0.18));
    const me = ctx.me ?? (ctx.slot >= 0 ? view.partier(ctx.slot) : null);
    const playing = me && me.live && !me.out;
    const w = Math.abs(spinAt(st, t + 1));
    ctx.right(3, `BARS ${barsAt(t)}  ${w ? `SPEED ${(w / (L.SW_S0 * L.SW_RAD_TICK)).toFixed(1)}X` : 'STILL'}` + (playing ? `  WHACKED ${me.m}` : ''), C.GREY);
    if (t < L.SW_GRACE) { ctx.centre(row, `HOP OVER THE BAR  IT TURNS IN ${((L.SW_GRACE - t) * TICK).toFixed(1)}`, C.YELLOW); return; }
    for (const tk of L.SW_TS) {
      if (t >= tk - L.SW_WARN && t < tk + L.SW_PAUSE) { ctx.centre(row, `NEW BAR  TURNING BACK IN ${((tk + L.SW_PAUSE - t) * TICK).toFixed(1)}`, C.YELLOW); break; }
    }
    const k = dropsAt(t);
    if (k < L.SW_RINGS) {
      const drop = L.SW_TR0 + k * L.SW_TRI;
      if (t >= drop - L.SW_RWARN) {
        ctx.centre(row + 1, `THE EDGE DROPS IN ${((drop - t) * TICK).toFixed(1)}`, C.ORANGE);
        if (playing && Math.hypot(me.pos[0] - st.cx, me.pos[2] - st.cx) > rimOf(st.r0, k + 1) - 0.5) ctx.centre(row + 2, 'GET IN!', C.RED);
      }
    }
    // the cue draw worked out for your ball as you see it (the prediction's)
    if (playing && cue && (ctx.now ?? 0) - cue.at < 120 && cue.ready) ctx.centre(row + 3, cue.go ? 'HOP!' : 'READY', cue.go ? C.GREEN : C.WHITE);
  },

  brain: {
    // off the rim (as it stands on that tick) is a fall; the ring that drops
    // next, once it's shaking, nearly as bad; the last 3 m to the edge a
    // little, and the hub, where the bars are too slow to hop, a little
    danger(view, x, z, tick) {
      const st = stage(view);
      if (st.state !== L.H_PLAY) return 0;
      const t = tickIn(st, tick);
      const rho = Math.hypot(x - st.cx, z - st.cx);
      const k = dropsAt(t), rim = rimOf(st.r0, k);
      if (rho > rim - 0.3) return 1;
      let d = 0;
      if (k < L.SW_RINGS && t >= L.SW_TR0 + k * L.SW_TRI - L.SW_RWARN - 125 && rho > rimOf(st.r0, k + 1) - 1.5) d = 0.8;
      if (rho > rim - 3) d = Math.max(d, 0.5 * (1 - (rim - rho) / 3));
      if (rho < L.SW_POST + R + 0.3) d = Math.max(d, 0.6);
      else if (rho < HUB) d = Math.max(d, 0.2 * (1 - (rho - L.SW_POST) / (HUB - L.SW_POST)));
      return d;
    },

    // somewhere between the hub and the edge to come, on the bearing it's
    // on, a little spread by its slot so a crowd makes a band, not a ring
    goal(view, me, bot) {
      const b = ball(view, me);
      if (!b || !b.live || b.out) return null;
      const st = stage(view);
      const t = tickIn(st, bot?.at ?? view.tick);
      const x = bot?.pos?.[0] ?? b.pos[0], z = bot?.pos?.[1] ?? b.pos[2];
      const rim = rimAt(st, t + 500);
      const lo = Math.min(HUB + 1, rim * 0.5), hi = Math.max(lo, rim - 4);
      const want = lo + (hi - lo) * (0.15 + 0.7 * (((b.slot ?? 0) * 37) % 100) / 100);
      const dx = x - st.cx, dz = z - st.cx, rho = Math.hypot(dx, dz) || 1;
      if (Math.abs(rho - want) < 1.5) return [x, z];
      return [st.cx + (dx / rho) * want, st.cx + (dz / rho) * want];
    },

    // what plan() says about hopping, steering as the planner likes
    hop(view, me, bot) { return plan(view, me, bot, false)?.hop ?? false; },

    // a bar on its way and room to stand: still, to hop it from where it is
    think(view, me, bot) {
      const p = plan(view, me, bot, true);
      return p?.still ? { yaw: (bot?.yaw ?? 0) / 16384 * TAU, move: 0, hop: p.hop } : null;
    },
  },
};
