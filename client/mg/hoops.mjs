// HOOPLA, as drawn and as the AI ball sees it. A round court of pale maple
// over the sea, a red band round its rim, its orbits faint rings on the
// boards; three orange ramps in the hub, lips out, black and yellow at the
// lip; bounce pads glowing cyan on the orbits' lines. The hoops are rings of
// short boxes turned by their yaw and roll, one bright colour each (a raised
// one striped white, a beam under it to the floor), the gold ones glowing
// and sparkling; a hoop you scored lately is drawn faint till it's yours
// again, and in the last 15 s they all pulse. The leader wears a crown. A
// hoop's place, facing and size are the sim's ($ho_at) worked again here
// from its record in PG_S and the tick into play, on the clock your own ball
// is drawn at, so it is drawn and steered by where the sim has it.
import * as L from '../../src/layout.mjs';
import * as MC from '../../src/mg/hoops.mjs'; // HO_*: the minigame's own constants
import { PLAT_Y } from '../../src/party-view.mjs';
import { LOOK, SPRITE, DECAL } from '../party-render.mjs';
import { C } from '../font.mjs';

const TICK = 0.008;
const TAU = 2 * Math.PI;
const T24 = 2 ** 24;
const SLOPE = MC.HO_RH / MC.HO_RL;
const SEGS = 18; // boxes a ring
const TUBE = 0.11; // a ring's half thickness, m
const MAPLE = [0.86, 0.68, 0.44];
const BAND = [0.78, 0.16, 0.12];
const GOLD = [1, 0.78, 0.2];
const PAD = [0.3, 0.95, 1];
const RAMP = [1, 0.5, 0.12];
const HUES = [[0.2, 0.8, 1], [1, 0.32, 0.66], [0.5, 0.95, 0.25], [1, 0.55, 0.12], [0.66, 0.45, 1], [1, 0.26, 0.24]];
const ordinal = (n) => `${n}${[, 'ST', 'ND', 'RD'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'TH'}`;
// Ticks into play at tick T (fractional) of a round started on tick start: the sim's i32 subtraction wraps.
const since = (T, start) => ((Math.floor(T) - start) | 0) + (T - Math.floor(T));

// ---- the stage, as the sim has it (its records are the confirmed world's: bank 0)

// The court, its ramps, pads, orbits and hoops, read once a world tick.
export function stage(view) {
  if (view._ho && view._ho.tick === view.tick) return view._ho;
  const dv = view.dv, h = L.PG_H;
  const u = (a) => dv.getUint32(a, true), i = (a) => dv.getInt32(a, true), f = (a) => dv.getFloat32(a, true);
  const nh = Math.min(MC.HO_NMAX, u(h + MC.HO_NH)), no = Math.min(MC.HO_OMAX, u(h + MC.HO_NO));
  const np = Math.min(MC.HO_NPMAX, u(h + MC.HO_NP)), nr = Math.min(MC.HO_NR, u(h + MC.HO_NRAMP));
  const ramps = [], pads = [], orbits = [], hoops = [];
  for (let j = 0; j < nr; j++) { const a = L.PG_S + MC.HO_RAMPS + 16 * j; ramps.push({ j, x: f(a), z: f(a + 4), c: f(a + 8), s: f(a + 12) }); }
  for (let k = 0; k < np; k++) { const a = L.PG_S + MC.HO_PADS + 8 * k; pads.push({ k, x: f(a), z: f(a + 4) }); }
  for (let o = 0; o < no; o++) { const a = L.PG_S + MC.HO_ORBS + 16 * o; orbits.push({ o, rho: f(a), first: u(a + 4), n: u(a + 8), w: i(a + 12) }); }
  for (let k = 0; k < nh; k++) {
    const a = L.PG_S + MC.HO_HOOPS + k * MC.HO_HSIZE;
    hoops.push({
      i: k, rho: f(a + MC.HO_H_RHO), a0: u(a + MC.HO_H_A0), w: i(a + MC.HO_H_W), f0: u(a + MC.HO_H_F0), fw: i(a + MC.HO_H_FW),
      s0: u(a + MC.HO_H_S0), sw: i(a + MC.HO_H_SW), b0: u(a + MC.HO_H_B0), bw: i(a + MC.HO_H_BW), kind: u(a + MC.HO_H_KIND), orb: u(a + MC.HO_H_ORB),
      hits: u(a + MC.HO_H_HITS),
    });
  }
  const g = view.party();
  view._ho = { tick: view.tick, rad: f(h + MC.HO_RAD), cx: f(L.PG_CX), lead: u(h + MC.HO_LEAD), ramps, pads, orbits, hoops, start: g.start, state: g.state, g };
  return view._ho;
}

// Hoop h on tick t into play: { x, z, y (its ring's centre), r, nx, nz (its
// plane's normal), yaw, bot (its bottom over the floor) }, as $ho_at has it.
// exact (t whole): the sim's angle steps, 1/16384 turn; else smooth, for
// drawing at a fractional tick.
export function hoopAt(st, h, t, exact = false) {
  const ang = (p, w, p2 = 0, w2 = 0) => (exact
    ? ((((p + Math.imul(w, t) + p2 + Math.imul(w2, t)) | 0) >>> 10) & 16383) / 16384 * TAU
    : ((p + w * t + p2 + w2 * t) / T24) * TAU);
  const th = ang(h.a0, h.w), b = ang(h.b0, h.bw), sz = ang(h.s0, h.sw), yaw = ang(h.a0, h.w, h.f0, h.fw);
  const gold = h.kind === MC.HO_KGOLD;
  const rho = h.rho + MC.HO_WOB * Math.sin(b);
  const r = gold ? MC.HO_GMID + MC.HO_GVAR * Math.sin(sz) : MC.HO_RMID + MC.HO_RVAR * Math.sin(sz);
  const bot = gold ? MC.HO_FOOT + (1 - Math.cos(b)) * (MC.HO_GOLDB - MC.HO_FOOT) / 2 : h.kind === MC.HO_KRAISED ? MC.HO_LIFT : MC.HO_FOOT;
  return { x: st.cx + Math.cos(th) * rho, z: st.cx + Math.sin(th) * rho, y: PLAT_Y + bot + r, r, nx: Math.cos(yaw), nz: Math.sin(yaw), yaw, bot };
}
export const worth = (h, tp) => (h.kind === MC.HO_KGOLD ? MC.HO_GOLDV : 1) * (tp >= MC.HO_DOUBLE ? 2 : 1);
// The tick into play slot last scored hoop i (-1 never), from the sim's table.
export function lastScored(view, slot, i) {
  const s = view.dv.getUint16(L.PG_BIG + MC.HO_LAST + 2 * (slot * MC.HO_NMAX + i), true);
  return s ? s - 1 : -1;
}
// A ramp's top over the floor at (x, z) (0 at its toe, HO_RH at its lip), or -1 off it: $ho_rise.
export function rise(rp, x, z) {
  const dx = x - rp.x, dz = z - rp.z, a = dx * rp.c + dz * rp.s, w = dz * rp.c - dx * rp.s;
  return a >= 0 && a <= MC.HO_RL && Math.abs(w) <= MC.HO_RW ? a * SLOPE : -1;
}
// Did a ball's centre go from p0 (tick t - 1 into play) to p1 (tick t) through hoop h, as $ho_tick scores it?
export function through(st, h, t, p0, p1) {
  const H0 = hoopAt(st, h, Math.max(0, t - 1), true), H1 = hoopAt(st, h, t, true);
  const s0 = H0.nx * (p0[0] - H0.x) + H0.nz * (p0[2] - H0.z), s1 = H1.nx * (p1[0] - H1.x) + H1.nz * (p1[2] - H1.z);
  if ((s0 < 0) === (s1 < 0)) return false;
  const mv = H1.nx * (p1[0] - p0[0]) + H1.nz * (p1[2] - p0[2]);
  if (mv * (s1 > s0 ? 1 : -1) < MC.HO_MOVE) return false;
  const u = s0 / (s0 - s1);
  const w0 = H0.nx * (p0[2] - H0.z) - H0.nz * (p0[0] - H0.x), w1 = H1.nx * (p1[2] - H1.z) - H1.nz * (p1[0] - H1.x);
  const v0 = p0[1] - H0.y, v1 = p1[1] - H1.y;
  const w = w0 + (w1 - w0) * u, v = v0 + (v1 - v0) * u;
  return w * w + v * v < H1.r * H1.r;
}

// ---- drawing

let env = 'day';
// hoops your own predicted ball has gone through, drawn faint at once: hoop -> the tick into play it went through
const passed = new Map();
let lastMe = null; // your predicted ball's centre and tick into play, last frame

function court(out, st, now) {
  const sc = out.scene, cx = st.cx, R = st.rad;
  sc.cyl(cx, PLAT_Y - 0.6, cx, R, 0.6, ...MAPLE, LOOK.WOOD, 0.34);
  sc.cyl(cx, PLAT_Y - 0.66, cx, R + 0.25, 0.62, ...BAND, LOOK.PLASTIC);
  sc.cyl(cx, PLAT_Y - 4.2, cx, R * 0.8, 3, 0.3, 0.32, 0.38, LOOK.METAL);
  sc.cyl(cx, PLAT_Y - 9, cx, R * 0.45, 2.2, 0.24, 0.26, 0.3, LOOK.METAL);
  out.decals.push({ pos: [cx, PLAT_Y + 0.02, cx], radius: R - 0.35, width: 0.25, color: [1, 1, 1, 0.7], kind: DECAL.RING });
  out.decals.push({ pos: [cx, PLAT_Y + 0.02, cx], radius: MC.HO_SP0 - 0.8, width: 0.2, color: [1, 1, 1, 0.45], kind: DECAL.RING });
  for (const o of st.orbits) {
    out.decals.push({ pos: [cx, PLAT_Y + 0.02, cx], radius: o.rho + 0.08, width: 0.16, color: [0.95, 0.5, 0.25, 0.3 + 0.06 * Math.sin(now / 700 + o.o)], kind: DECAL.RING });
  }
  // the ramps: a slab whose top is the slope (its foot under the floor), a stripe at the lip
  const T = 1.8, a = Math.atan(SLOPE), len = Math.hypot(MC.HO_RL, MC.HO_RH);
  for (const rp of st.ramps) {
    const yaw = Math.atan2(-rp.c, rp.s);
    const mx = rp.x + rp.c * MC.HO_RL / 2, mz = rp.z + rp.s * MC.HO_RL / 2, my = PLAT_Y + MC.HO_RH / 2;
    // the top face's normal: up, tipped back toward the toe
    const nx = -rp.c * Math.sin(a), ny = Math.cos(a), nz = -rp.s * Math.sin(a);
    sc.box(mx - nx * T / 2, my - ny * T / 2, mz - nz * T / 2, MC.HO_RW, T / 2, len / 2, yaw, ...RAMP, LOOK.PLASTIC, 0, 0, 1, 7 + rp.j, -a);
    const lx = rp.x + rp.c * (MC.HO_RL - 0.3), lz = rp.z + rp.s * (MC.HO_RL - 0.3);
    sc.box(lx - nx * 0.02, PLAT_Y + (MC.HO_RL - 0.3) * SLOPE + 0.02, lz - nz * 0.02, MC.HO_RW + 0.01, 0.03, 0.3, yaw, 1, 0.85, 0.1, LOOK.HAZARD, 0, 0, 1, 11 + rp.j, -a);
  }
  // the pads
  for (const p of st.pads) {
    const beat = 0.5 + 0.5 * Math.sin(now / 260 + p.k * 1.3);
    sc.cyl(p.x, PLAT_Y + 0.03, p.z, MC.HO_PADR, 0.04, ...PAD, LOOK.GLOW, 0.7 + 0.5 * beat, 0.4);
    out.decals.push({ pos: [p.x, PLAT_Y + 0.08, p.z], radius: MC.HO_PADR + 0.35, width: 0.18, color: [...PAD, 0.8], kind: DECAL.RING });
    out.decals.push({ pos: [p.x, PLAT_Y + 0.08, p.z], radius: 0.4 + 0.9 * ((now / 900 + p.k * 0.37) % 1), width: 0.12, color: [1, 1, 1, 0.6], kind: DECAL.RING });
  }
}

// Hoop H's ring (from hoopAt) in rgb, its look and glow; a raised one's every other box white.
function ring(sc, H, rgb, look, glow, alpha, striped, seed) {
  const ux = -H.nz, uz = H.nx, half = (Math.PI * H.r) / SEGS * 1.08;
  for (let k = 0; k < SEGS; k++) {
    const phi = (k * TAU) / SEGS, cp = Math.cos(phi), sp = Math.sin(phi);
    const x = H.x + H.r * ux * cp, y = H.y + H.r * sp, z = H.z + H.r * uz * cp;
    const white = striped && k % 2;
    const col = white ? [0.97, 0.97, 0.95] : rgb;
    sc.box(x, y, z, TUBE, TUBE, half, H.yaw, ...col, white ? LOOK.PLASTIC : look, white ? 0 : glow, 0.3, alpha, seed + k, Math.PI / 2 - phi);
  }
}

// A little crown over the leader's rider.
function crown(sc, x, y, z, spin) {
  sc.cyl(x, y, z, 0.4, 0.12, ...GOLD, LOOK.METAL);
  for (let i = 0; i < 5; i++) {
    const a = spin + (i * TAU) / 5;
    sc.sphere(x + Math.cos(a) * 0.36, y + 0.2, z + Math.sin(a) * 0.36, 0.08, 1, 0.2, 0.25, LOOK.GLOW, 0.9);
  }
}

// Has the slot scored hoop i within HO_AGAIN of tick tp into play (the
// confirmed world's table, and what its own predicted ball went through)?
function cooling(view, slot, i, tp) {
  if (!(slot >= 0)) return false;
  const l = lastScored(view, slot, i);
  if (l >= 0 && tp - l < MC.HO_AGAIN) return true;
  const p = passed.get(i);
  return p !== undefined && tp - p < MC.HO_AGAIN && tp >= p;
}

export default {
  id: L.MG_HOOPS, key: 'hoops', name: 'HOOPLA',
  hint: 'ROLL THROUGH THE HOOPS  HOP THE HIGH ONES  GOLD PAYS 3',
  get env() { return env; },

  draw(view, ctx, out) {
    const st = stage(view);
    if (!(st.rad > 0)) return;
    const g = st.g;
    const now = ctx.now ?? 0;
    const T = ctx.ptick ?? ctx.tick + (ctx.dt || 0) / TICK;
    const playing = g.state === L.H_PLAY || g.state === L.H_OVER;
    const tp = playing ? Math.max(0, since(T, g.start)) : 0;
    const double = g.state === L.H_PLAY && tp >= MC.HO_DOUBLE;
    env = double ? 'sunset' : 'day';
    court(out, st, now);
    // your predicted ball through a hoop: faint at once, before the confirmed world's word
    const me = ctx.pme && !ctx.pme.out ? ctx.pme : null;
    if (g.state !== L.H_PLAY) passed.clear();
    const tw = Math.floor(tp);
    if (me && g.state === L.H_PLAY) {
      const c = [me.pos[0], me.pos[1] + me.radius, me.pos[2]];
      if (lastMe && tw === lastMe.t + 1) for (const h of st.hoops) if (!cooling(view, ctx.slot, h.i, tw) && through(st, h, tw, lastMe.c, c)) passed.set(h.i, tw);
      if (!lastMe || tw !== lastMe.t) lastMe = { t: tw, c };
    } else lastMe = null;
    const pulse = 0.5 + 0.5 * Math.sin(now / 140);
    const sc = out.scene;
    for (const h of st.hoops) {
      const H = hoopAt(st, h, tp);
      const gold = h.kind === MC.HO_KGOLD;
      const cool = playing && cooling(view, ctx.slot, h.i, tp);
      const alpha = cool ? 0.35 : 1;
      const rgb = gold ? GOLD : HUES[h.i % HUES.length];
      const glow = gold ? 1.1 + 0.5 * Math.sin(now / 160 + h.i) + (double ? 0.6 * pulse : 0) : double ? 0.5 + 0.6 * pulse : 0.35;
      ring(sc, H, rgb, gold || double ? LOOK.GLOW : LOOK.PLASTIC, glow, alpha, h.kind === MC.HO_KRAISED, 64 * h.i);
      // where it stands: a mark on the floor; over it, a beam down from a ring that floats
      out.decals.push({ pos: [H.x, PLAT_Y + 0.03, H.z], radius: 0.5, width: 0.5, color: [...rgb, cool ? 0.15 : 0.45], kind: DECAL.DISC });
      if (H.bot > 0.5) out.beams.push({ a: [H.x, H.y - H.r - 0.1, H.z], b: [H.x, PLAT_Y + 0.05, H.z], width: 0.08, color: [...rgb, cool ? 0.12 : 0.35] });
      if (gold && !cool) {
        out.glow.push({ pos: [H.x, H.y, H.z], size: H.r * 1.6, color: [1, 0.85, 0.35, 0.22 + 0.1 * pulse], kind: SPRITE.FLASH, minpx: 1 });
        const a = now / 300 + h.i;
        out.glow.push({ pos: [H.x - H.nz * H.r * Math.cos(a), H.y + H.r * Math.sin(a), H.z + H.nx * H.r * Math.cos(a)], size: 0.5, color: [1, 0.95, 0.6, 0.9], kind: SPRITE.SPARK, minpx: 1 });
      }
      out.casters.push([H.x - H.nz * H.r * 0.7, H.y - H.r * 0.7, H.z + H.nx * H.r * 0.7, -0.25], [H.x + H.nz * H.r * 0.7, H.y - H.r * 0.7, H.z - H.nx * H.r * 0.7, -0.25]);
    }
    // the leader's crown, over its rider as the frontend draws it
    if (st.lead < L.NPLAYER && playing) {
      const own = me && st.lead === ctx.slot;
      const b = own ? me : view.partier(st.lead);
      if (b.live && !b.out) {
        const dt = own ? Math.max(-0.02, Math.min(0.03, (ctx.ptick - (ctx.pview?.tick ?? ctx.ptick)) * TICK)) : ctx.dt || 0;
        crown(sc, b.pos[0] + b.vel[0] * dt, b.pos[1] + b.vel[1] * dt + 2 * b.radius + 1.22, b.pos[2] + b.vel[2] * dt, now / 500);
      }
    }
  },

  frame(view) {
    const st = stage(view);
    const g = view.party();
    return { centre: [st.cx || g.cx, PLAT_Y, st.cx || g.cx], radius: st.rad || g.size, shape: 'disc' };
  },

  // a new round's countdown turns you to the nearest hoop
  facing(view, slot) {
    const st = stage(view), me = view.partier(slot);
    let best = null, bd = Infinity;
    for (const h of st.hoops) {
      const H = hoopAt(st, h, 0);
      const d = Math.hypot(H.x - me.pos[0], H.z - me.pos[2]);
      if (d < bd) { bd = d; best = H; }
    }
    return best ? Math.atan2(best.z - me.pos[2], best.x - me.pos[0]) : null;
  },

  fx(f, ctx) {
    const mine = f.owner === ctx.slot;
    const d = typeof ctx.dist === 'function' ? ctx.dist(f.pos) : ctx.dist ?? 0;
    if (f.kind === MC.HO_FX_SCORE) {
      const st = ctx.view ? stage(ctx.view) : null;
      const gold = st?.hoops[f.shot]?.kind === MC.HO_KGOLD;
      const rgb = gold ? GOLD : HUES[f.shot % HUES.length];
      ctx.glow?.({ pos: f.pos, size: gold ? 3.4 : 2.4, color: [...rgb, 0.95], kind: SPRITE.RING, life: 420, grow: true });
      ctx.glow?.({ pos: f.pos, size: gold ? 1.8 : 1.1, color: [1, 1, 0.85, 0.9], kind: SPRITE.SPARK, life: 300 });
      if (mine) {
        ctx.banner?.(gold ? `GOLD HOOP  +${f.size}` : `+${f.size}`, gold ? C.YELLOW : C.GREEN, gold ? 1100 : 600);
        if (gold) ctx.sound?.kill?.(); else ctx.sound?.pickup?.();
      } else if (d < 14) ctx.sound?.tick?.();
      return;
    }
    if (f.kind === MC.HO_FX_PAD) {
      ctx.glow?.({ pos: [f.pos[0], f.pos[1] + 0.3, f.pos[2]], size: 2.6, color: [...PAD, 0.9], kind: SPRITE.RING, life: 380, grow: true });
      ctx.sound?.boing?.(f.size, mine ? 0 : d);
      return;
    }
    if (f.kind === MC.HO_FX_CALL) {
      ctx.banner?.('DOUBLE POINTS!', C.ORANGE, 2200);
      ctx.sound?.holed?.();
      return;
    }
    if (f.kind === MC.HO_FX_LEAD) {
      if (mine) { ctx.banner?.('YOU TAKE THE LEAD', C.GREEN, 1500); ctx.sound?.pickup?.(); }
      else if (f.shot === ctx.slot) ctx.banner?.(`${ctx.name?.(f.owner) ?? `P${f.owner + 1}`} TAKES THE LEAD`, C.RED, 1500);
      else ctx.feed?.(`${ctx.name?.(f.owner) ?? `P${f.owner + 1}`} TAKES THE LEAD`, C.YELLOW);
    }
  },

  // the double points on the clock, and where you stand
  hud(view, ctx) {
    const g = view.party();
    if (g.state !== L.H_PLAY) return;
    const tp = typeof ctx.t === 'number' && ctx.t > 0 ? ctx.t / TICK : g.t;
    if (tp >= MC.HO_DOUBLE) ctx.right(3, 'DOUBLE POINTS', Math.floor((ctx.now ?? 0) / 250) % 2 ? C.ORANGE : C.YELLOW);
    else ctx.right(3, `DOUBLE POINTS IN ${Math.ceil((MC.HO_DOUBLE - tp) * TICK)}`, C.GREY);
    const me = ctx.me ?? (ctx.slot >= 0 ? view.partier(ctx.slot) : null);
    if (me?.live) {
      let place = 1, n = 0;
      for (let p = 0; p < L.NPLAYER; p++) {
        const a = L.PLAYERS + p * L.PSIZE;
        if (!(view.u8[a + L.P_FL] & L.PF_LIVE)) continue;
        n++;
        if (view.dv.getUint16(a + L.PG_SCORE, true) > me.score) place++;
      }
      ctx.right(4, `${ordinal(place)} OF ${n}`, place === 1 ? C.GREEN : C.WHITE);
    }
  },

  brain: {
    // off the rim is the sea, its last 3 m a warning; a pad or a ramp's wall throws you about
    danger(view, x, z) {
      const st = stage(view);
      const e = st.rad - Math.hypot(x - st.cx, z - st.cx);
      if (e <= 0) return 1;
      let d = e < 3 ? ((3 - e) / 3) * 0.7 : 0;
      for (const p of st.pads) if ((x - p.x) ** 2 + (z - p.z) ** 2 < (MC.HO_PADR + 0.6) ** 2) d = Math.max(d, 0.25);
      if (Math.hypot(x - st.cx, z - st.cx) < MC.HO_RT0 + MC.HO_RL + 1.5) for (const rp of st.ramps) if (wallNear(rp, x, z)) d = Math.max(d, 0.2);
      return d;
    },
    goal(view, me, bot) {
      const p = plan(view, me, bot);
      return p ? p.aim : null;
    },
    hop() { return false; },
    // The whole word: round the hub, onto the line through the hoop it's
    // after (square to its face, on the side it's on, or the side that
    // doesn't leave it heading off the rim), along it through the ring, a hop
    // timed for a raised one; near the rim the planner steers it in.
    think(view, me, bot, tick = view.tick) {
      const p = plan(view, me, bot, tick);
      if (!p) return null;
      if (p.rimNear) return null;
      return steer(p);
    },
  },
};

// Is (x, z) by ramp rp's side or back, where it's a wall?
function wallNear(rp, x, z) {
  const dx = x - rp.x, dz = z - rp.z, a = dx * rp.c + dz * rp.s, w = dz * rp.c - dx * rp.s;
  if (a < 0.8 || a > MC.HO_RL + 1.6) return false;
  return Math.abs(w) < MC.HO_RW + 1.6 && (Math.abs(w) > MC.HO_RW - 0.2 || a > MC.HO_RL);
}

// ---- the AI ball

// What a ball keeps from think to think: in the Partier's mem (cleared each round), else by the bot.
const MINDS = new WeakMap();
function mindOf(bot) {
  if (!bot || typeof bot !== 'object') return {};
  if (bot.mem) return (bot.mem.ho ||= {});
  let m = MINDS.get(bot);
  if (!m) MINDS.set(bot, (m = {}));
  return m;
}
const HOP_V = MC.HO_HOP, G = 20; // the hop, and gravity on a ball
const HOP_TOP = (HOP_V * HOP_V) / (2 * G); // 1.6 m
const len = (x, z) => Math.sqrt(x * x + z * z); // (Math.hypot is slow: the planner runs it thousands of times a tick)

// The hoop the ball goes for and how: each hoop not scored lately (by the
// sim's table, or by the ball's own reckoning since), where it will be when
// the ball could get there; worth over the time to get there, less for one a
// hop can't reach then, less for one by the rim whose near side sends it off
// the edge, less for every rival nearer it. It keeps what it's after unless
// something is clearly better. { aim [x, z], speed, hop, rimNear, ... } or null.
function plan(view, me, bot, tick) {
  const slot = typeof me === 'number' ? me : me?.slot;
  const st = stage(view);
  const g = st.g;
  if (g.state !== L.H_PLAY || !(slot >= 0) || !(st.rad > 0)) return null;
  const rec = L.PLAYERS + slot * L.PSIZE;
  if ((view.u8[rec + L.P_FL] & (L.PF_LIVE | L.PF_DEAD)) !== L.PF_LIVE) return null;
  const mind = mindOf(bot);
  const t = tick ?? bot?.at ?? view.tick;
  const tp = (t - g.start) | 0;
  const x0 = bot?.pos?.[0] ?? view.dv.getFloat32(rec + L.P_PX, true), z0 = bot?.pos?.[1] ?? view.dv.getFloat32(rec + L.P_PZ, true);
  const vx = bot?.vel?.[0] ?? view.dv.getFloat32(rec + L.P_VX, true), vz = bot?.vel?.[1] ?? view.dv.getFloat32(rec + L.P_VZ, true);
  const y0 = view.dv.getFloat32(rec + L.P_PY, true);
  const ground = (view.u8[rec + L.P_FL] & L.PF_GROUND) !== 0;
  const skill = bot?.skill ?? 0.6;
  const cx = st.cx, R = st.rad;
  const rb = len(x0 - cx, z0 - cx);
  const sp = len(vx, vz);
  mind.done ||= new Map();
  // its own reckoning: through the hoop it was after since the last think (the sim's word comes a round trip later)
  if (mind.target !== undefined && mind.last && tp > mind.last.tp) {
    const h = st.hoops[mind.target];
    if (h) {
      const H = hoopAt(st, h, tp);
      const s0 = mind.last.s, s1 = (x0 - H.x) * H.nx + (z0 - H.z) * H.nz;
      const w1 = (z0 - H.z) * H.nx - (x0 - H.x) * H.nz;
      if ((s0 < 0) !== (s1 < 0) && Math.abs(w1) < H.r + 0.3) { mind.done.set(mind.target, tp); mind.target = undefined; }
    }
  }
  const sp9 = Math.max(6, 9 - 2 * (1 - skill));
  const fld = fieldOf(view, st, tp);
  let best = null;
  for (const h of st.hoops) {
    const l = lastScored(view, slot, h.i);
    if (l >= 0 && tp - l < MC.HO_AGAIN - 40) continue;
    const dn = mind.done.get(h.i);
    if (dn !== undefined && tp - dn < MC.HO_AGAIN) continue;
    let H = fld.at[0][h.i];
    let d = len(H.x - x0, H.z - z0);
    if (d > 60) continue;
    let eta = d / sp9 + 0.4;
    H = fld.at[Math.min(LOOKS - 1, Math.round(eta / LOOK_S))][h.i];
    d = len(H.x - x0, H.z - z0);
    eta = d / sp9 + 0.5 + 0.5 * (1 - skill);
    // the side it's on, and whether that side sends it off the rim
    const s = (x0 - H.x) * H.nx + (z0 - H.z) * H.nz;
    const sg = s >= 0 ? 1 : -1;
    const hr = len(H.x - cx, H.z - cx);
    const out = -sg * (H.nx * (H.x - cx) + H.nz * (H.z - cx)) / (hr || 1); // the exit's way out from the centre
    let k = worth(h, tp) / (eta + 0.6);
    if (R - hr < 9 && out > 0.3) k *= 0.45;
    // too high to hop then
    if (H.bot > HOP_TOP + 0.55) k *= 0.15;
    else if (H.bot > 0.55) k *= 0.85;
    // rivals nearer it
    if (k > (best?.k ?? 0) * 0.5) k /= 1 + 0.25 * nearer(fld, H.x, H.z, Math.min(10, d * 0.84), slot);
    if (h.i === mind.target) k *= 1.35 + 0.5 * (1 - skill);
    if (!best || k > best.k) best = { k, h, H, eta };
  }
  mind.target = best?.h.i;
  const rimNear = R - rb < 3.5 && (vx * (x0 - cx) + vz * (z0 - cx)) / (rb || 1) > 0.5;
  if (!best) {
    mind.last = null;
    return { aim: [cx + (x0 - cx) * 0.6, cx + (z0 - cx) * 0.6], speed: 4, hop: false, rimNear, pos: [x0, z0], vel: [vx, vz], st, skill, ground, y0 };
  }
  // the hoop as it will be when the ball gets to its plane (worked out twice), and how fast it drifts then
  let tau = best.eta;
  let H = hoopAt(st, best.h, tp + tau / TICK);
  for (let k = 0; k < 2; k++) {
    const s = (x0 - H.x) * H.nx + (z0 - H.z) * H.nz, w = (z0 - H.z) * H.nx - (x0 - H.x) * H.nz;
    tau = Math.min(2.5, (Math.abs(s) + 0.6 * Math.max(0, Math.abs(w) - H.r)) / Math.max(5, sp) + 0.05);
    H = hoopAt(st, best.h, tp + tau / TICK);
  }
  const Hn = hoopAt(st, best.h, tp + tau / TICK + 10);
  const hvx = (Hn.x - H.x) / (10 * TICK), hvz = (Hn.z - H.z) / (10 * TICK);
  const H0 = hoopAt(st, best.h, tp);
  mind.last = { tp, s: (x0 - H0.x) * H0.nx + (z0 - H0.z) * H0.nz };
  const ex = x0 - H.x, ez = z0 - H.z;
  const s = ex * H.nx + ez * H.nz, w = ez * H.nx - ex * H.nz;
  const sg = s >= 0 ? 1 : -1, as = Math.abs(s), aw = Math.abs(w);
  // onto its centre line, square to its face, on the side it's on: a point a
  // look ahead (more the faster it rolls) along the line from level with it,
  // or, too near the plane for how far off the line it is, a point back out
  // to start from; held off while a gold one is up out of a hop's reach
  const hold = H.bot > HOP_TOP + 0.5;
  const look = 1.5 + 0.45 * sp;
  const need = Math.max(0, aw - 0.4 * H.r) * 1.2;
  let along;
  if (hold) along = Math.max(as, 5);
  else if (as >= need) along = Math.max(-6, as - look);
  else along = Math.max(as + 1, need * 0.7 + 1);
  let ax = H.x + H.nx * sg * along, az = H.z + H.nz * sg * along;
  // round the hub: a ball whose way crosses it goes round its edge
  const hub = MC.HO_RT0 + MC.HO_RL + 1.6;
  const mx = (x0 + ax) / 2 - cx, mz = (z0 + az) / 2 - cx, md = len(mx, mz);
  if (md < hub && len(ax - cx, az - cx) > hub) {
    const k = hub / Math.max(0.5, md);
    ax = cx + mx * k; az = cx + mz * k;
  }
  // the hop: a raised ring (or a gold one up) needs its centre up there as it crosses
  let hop = false;
  const approach = -(vx * H.nx + vz * H.nz) * sg; // speed toward its plane
  if (ground && !hold && H.bot > 0.55 && as < 7 && aw < H.r + 0.5 && approach > 2) {
    const t2 = as / approach;
    const want = Math.min(1 + HOP_TOP, Math.max(H.bot + 1 + 0.3, H.y - PLAT_Y - 0.3)) - (y0 - PLAT_Y);
    // the time a hop takes its centre up by want: the rising root, or its top
    const disc = HOP_V * HOP_V - 2 * G * (want - 1);
    const th = disc > 0 ? (HOP_V - Math.sqrt(disc)) / G : HOP_V / G;
    if (t2 <= th + 0.035 && t2 >= th - 0.08) hop = true;
  }
  const edge = R - len(H.x - cx, H.z - cx);
  const fast = edge < 8 ? 7 : 9.5;
  return { aim: [ax, az], speed: hold ? 3 : fast, hold, hop, rimNear, hv: [hvx, hvz], pos: [x0, z0], vel: [vx, vz], st, skill, ground, y0 };
}

// What every AI ball looking at one world tick shares: every hoop now and
// every LOOK_S s ahead (a think picks the nearest to when it could get
// there), and the balls in by CELL m square.
const LOOKS = 6, LOOK_S = 0.5, CELL = 8;
function fieldOf(view, st, tp) {
  if (st._fld && st._fld.tp === tp) return st._fld;
  const at = [];
  for (let k = 0; k < LOOKS; k++) at.push(st.hoops.map((h) => hoopAt(st, h, tp + k * LOOK_S / TICK)));
  const grid = new Map();
  for (let p = 0; p < L.NPLAYER; p++) {
    const b = L.PLAYERS + p * L.PSIZE;
    if ((view.u8[b + L.P_FL] & (L.PF_LIVE | L.PF_DEAD | L.PF_FALL)) !== L.PF_LIVE) continue;
    const x = view.dv.getFloat32(b + L.P_PX, true), z = view.dv.getFloat32(b + L.P_PZ, true);
    const key = Math.floor(x / CELL) * 4096 + Math.floor(z / CELL);
    const list = grid.get(key);
    if (list) list.push(p, x, z); else grid.set(key, [p, x, z]);
  }
  st._fld = { tp, at, grid };
  return st._fld;
}
// The balls but slot within r of (x, z).
function nearer(fld, x, z, r, slot) {
  let n = 0;
  const r2 = r * r;
  for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) {
    for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
      const list = fld.grid.get(i * 4096 + j);
      if (!list) continue;
      for (let k = 0; k < list.length; k += 3) if (list[k] !== slot && (list[k + 1] - x) ** 2 + (list[k + 2] - z) ** 2 < r2) n++;
    }
  }
  return n;
}

// Keys for the velocity that takes the ball to its aim at its speed (slowing
// as it nears an aim it should stop at), kept off the rim by where it would
// coast to, round the pads and the ramps' walls; no keys (the brake) when
// it's already going as it wants to.
const ACC = 9;
function steer(p) {
  const { st } = p;
  const dx = p.aim[0] - p.pos[0], dz = p.aim[1] - p.pos[1], d = len(dx, dz);
  // at its speed (slowing to a wait it should hold at), slower for a sharp turn at speed
  let want = p.hold ? Math.min(p.speed, Math.sqrt(2 * ACC * d + 1)) : p.speed;
  const sp = len(p.vel[0], p.vel[1]);
  if (sp > 6 && d > 1e-6) want *= Math.max(0.55, 0.75 + 0.25 * (p.vel[0] * dx + p.vel[1] * dz) / (sp * d));
  let wx = d > 1e-6 ? (dx / d) * want : 0, wz = d > 1e-6 ? (dz / d) * want : 0;
  if (p.hv) { wx += p.hv[0]; wz += p.hv[1]; }
  const ahead = 0.3 + 0.45 * p.skill;
  const fx = p.pos[0] + p.vel[0] * ahead, fz = p.pos[1] + p.vel[1] * ahead;
  const rx = fx - st.cx, rz = fz - st.cx, f = len(rx, rz);
  const over = f - (st.rad - 2 - 1.5 * p.skill);
  if (over > 0 && f > 1e-6) { wx -= (rx / f) * over * 4; wz -= (rz / f) * over * 4; }
  // a pad ahead: round it
  for (const q of st.pads) {
    const qx = fx - q.x, qz = fz - q.z, qd = len(qx, qz);
    if (qd < MC.HO_PADR + 1.4 && qd > 1e-6) { const k = (MC.HO_PADR + 1.4 - qd) * 3; wx += (qx / qd) * k; wz += (qz / qd) * k; }
  }
  // a ramp's wall ahead: off it
  for (const rp of st.ramps) {
    if (!wallNear(rp, fx, fz)) continue;
    const ox = fx - (rp.x + rp.c * MC.HO_RL / 2), oz = fz - (rp.z + rp.s * MC.HO_RL / 2), od = len(ox, oz) || 1;
    wx += (ox / od) * 3; wz += (oz / od) * 3;
  }
  const ax = wx - p.vel[0], az = wz - p.vel[1];
  if (len(ax, az) < 0.6) return { yaw: Math.atan2(p.vel[1], p.vel[0]), move: 0, hop: p.hop ? 1 : 0, use: 0 };
  return { yaw: Math.atan2(az, ax), move: 1, hop: p.hop ? 1 : 0, use: 0 };
}
