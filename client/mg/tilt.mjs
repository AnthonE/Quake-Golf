// TILT TABLE, as drawn and as the AI ball sees it. The table is one big box
// of orange and brown checks on a steel pivot, turned by a yaw and a roll
// (it tips about one axis at a time), its edge a red and white curb. The
// move coming glows on it from TT_WARN before it starts and through its tip:
// orange arrows sliding toward the side it will tip to and that side's curb
// lit (red for a swing over), green bars for levelling. The band that
// crumbles next glows red and shakes for
// TT_CRWARN, then falls away in chunks. All of it is the sim's own schedule
// (src/mg/tilt.wat): the moves read from PG_S, the slope and the half-width
// worked in f32 as the sim works them, so what is drawn and what the bots
// steer by is what the sim does.
import * as L from '../../src/layout.mjs';
import * as MC from '../../src/mg/tilt.mjs'; // TT_*: the minigame's own constants
import { PLAT_Y } from '../../src/party-view.mjs';
import { LOOK } from '../party-render.mjs';
import { C } from '../font.mjs';

const f = Math.fround;
const TICK = 0.008;
const HY = 0.6; // the table's half thickness, m
const CHECK = [0.95, 0.56, 0.2]; // its checks (the renderer pairs a colour this light with a dark one)
const CURB = [[0.92, 0.16, 0.13], [0.97, 0.95, 0.9]];
const CURB_W = 0.5; // the curb's width, m, inside the edge
const STEEL = [0.55, 0.58, 0.62];
const FALL = 1.4; // s a crumbled chunk is drawn falling
const SIDES = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]; // a move's side: the way down, in x and z

// ---- the schedule, as $tt_move, $tt_grad, $tt_drops and $tt_halfk have it

const memo = new WeakMap();
// The round's moves (PG_S, fixed at setup) and the table (PG_H, on the view's
// bank), the moves read once a round: [{ t, gx, gz, tip, dir, kind }].
export function stage(view) {
  const dv = view.dv, o = view.bank || 0;
  const h0 = dv.getFloat32(L.PG_H + MC.TT_HALF + o, true), n = Math.min(MC.TT_NMAX, dv.getUint32(L.PG_H + MC.TT_NMOVE + o, true));
  const key = `${dv.getUint32(L.HDR_SEED + o, true)}:${dv.getUint32(L.HDR_HOLE + o, true)}:${n}`;
  let m = memo.get(dv.buffer);
  if (!m || m.key !== key) {
    const moves = [];
    for (let k = 0; k < n; k++) {
      const a = L.PG_S + MC.TT_MOVES + k * MC.TT_MSIZE;
      moves.push({ t: dv.getUint32(a + MC.TT_M_T, true), gx: dv.getFloat32(a + MC.TT_M_GX, true), gz: dv.getFloat32(a + MC.TT_M_GZ, true),
        tip: dv.getUint16(a + MC.TT_M_TIP, true), dir: dv.getUint8(a + MC.TT_M_DIR), kind: dv.getUint8(a + MC.TT_M_KIND) });
    }
    m = { key, moves };
    memo.set(dv.buffer, m);
  }
  const g = view.party();
  return { h0, n, moves: m.moves, cx: dv.getFloat32(L.PG_CX + o, true), start: dv.getUint32(L.HDR_START + o, true), state: g.state, tick: g.tick, until: g.until };
}
// The move in force on tick t into play (integer): the last whose tip starts by t, -1 before the first.
export function moveAt(st, t) {
  let lo = 0, hi = st.n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if ((st.moves[mid].t | 0) <= t) lo = mid + 1; else hi = mid; }
  return lo - 1;
}
// The slope on tick t into play (integer), [gx, gz] in f32: the table's top falls gx a metre toward +x, gz toward +z.
export function gradAt(st, t) {
  const k = moveAt(st, t);
  if (k < 0) return [0, 0];
  const m = st.moves[k];
  const u = f((t - m.t) / m.tip);
  if (u >= 1) return [m.gx, m.gz];
  const px = k ? st.moves[k - 1].gx : 0, pz = k ? st.moves[k - 1].gz : 0;
  const e = f(f(u * u) * f(3 - f(u + u)));
  return [f(f(f(m.gx - px) * e) + px), f(f(f(m.gz - pz) * e) + pz)];
}
// The top at (dx, dz) from the middle, sloping (gx, gz), as $tt_plane.
export const planeAt = (gx, gz, dx, dz) => f(f(PLAT_Y) - f(f(gx * dx) + f(gz * dz)));
// The edges crumbled by tick t into play, and the half-width after k of them.
export const dropsAt = (t) => (t < MC.TT_CR0 ? 0 : Math.min(MC.TT_CRN, Math.floor((t - MC.TT_CR0) / MC.TT_CRI) + 1));
export const halfOf = (h0, k) => f(h0 - f(f(h0 - MC.TT_HMIN) * f(k / MC.TT_CRN)));
export const halfAt = (st, t) => halfOf(st.h0, dropsAt(t));
// Is (x, z) over the table on tick t into play?
export const onTable = (st, x, z, t) => { const h = halfAt(st, t); return Math.abs(f(x - st.cx)) <= h && Math.abs(f(z - st.cx)) <= h; };
// The slope's angle in degrees, rounded.
export const degOf = (gx, gz) => Math.round(Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI);

// Ticks into play, fractional, on the given clock (the prediction's when drawing), held at the end through the result.
function playT(st, view, tick) {
  if (st.state !== L.H_PLAY && st.state !== L.H_OVER) return 0;
  const i = Math.floor(tick);
  let t = ((i - st.start) | 0) + tick - i; // the sim's i32 subtraction: it wraps
  if (st.state === L.H_OVER) t = Math.min(t, (st.until - L.P_OVER - st.start) | 0);
  return Math.max(0, t);
}
// The slope at fractional t, between its ticks (drawing).
function gradSmooth(st, t) {
  const i = Math.floor(t), a = gradAt(st, i), b = gradAt(st, i + 1), w = t - i;
  return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
}

// ---- the table's frame: a slope along z is a roll with yaw 0, along x a
// roll with yaw pi / 2 (the renderer turns a solid by its roll about its own
// x, then its yaw). Parts lying in the table are boxes in its frame, given
// in plan (x, z from the middle, half extents ex, ez) and stretched along
// the slope so their plan is what's given, as the sim's table is a square in
// plan.
function frameOf(gx, gz) {
  const alongX = Math.abs(gx) > Math.abs(gz);
  const roll = alongX ? Math.atan(-gx) : Math.atan(gz);
  return { alongX, yaw: alongX ? Math.PI / 2 : 0, roll, c: Math.cos(roll), s: Math.sin(roll) };
}
// A box in the table at plan (px, pz), plan half extents (ex, ez), its centre ly over the top along the table's
// up and dy more in the world's y, half height hy.
function tbox(sc, F, cx, px, pz, ex, ez, ly, hy, rgb, look, a = 0, b = 0, alpha = 1, seed = 0, dy = 0) {
  const lx = F.alongX ? pz : px, lz = F.alongX ? -px / F.c : pz / F.c;
  const hx = F.alongX ? ez : ex, hz = (F.alongX ? ex : ez) / F.c;
  const y1 = F.c * ly - F.s * lz, z1 = F.s * ly + F.c * lz;
  const wx = F.alongX ? -z1 : lx, wz = F.alongX ? lx : z1;
  sc.box(cx + wx, PLAT_Y + y1 + dy, cx + wz, hx, hy, hz, F.yaw, rgb[0], rgb[1], rgb[2], look, a, b, alpha, seed, F.roll);
}
// An arrow lying on the table at plan (px, pz), length len, pointing the way (ux, uz) (a world axis): a shaft and a stepped head.
function arrow(sc, F, cx, px, pz, ux, uz, len, rgb, lit, alpha, seed) {
  const w = len * 0.1;
  const part = (along, half, across) => {
    const x = px + ux * along, z = pz + uz * along;
    tbox(sc, F, cx, x, z, ux ? half : across, ux ? across : half, 0.1, 0.06, rgb, LOOK.GLOW, lit, 0.5, alpha, seed);
  };
  part(-len / 6, len / 3, w);
  for (let i = 0; i < 4; i++) part(len / 6 + (i + 0.5) * len / 12, len / 24, w * (4 - i));
}

// ---- the AI ball

const DRIFT = 0.8; // how much of the slope's pull a rolling ball keeps over a second (its drag takes the rest)
const ball = (view, me) => (typeof me === 'number' ? view.partier(me) : me);
// The slope a ball should be ready for at tick t into play: the next move's once it's shown (or nearly), else the one in force.
function comingGrad(st, t) {
  const k = moveAt(st, t + MC.TT_WARN + 40);
  return k < 0 ? [0, 0] : [st.moves[k].gx, st.moves[k].gz];
}
// Where the slope's pull takes a ball in tau s (from now), sloping (gx, gz): m along each.
const drift = (tau) => 0.5 * MC.TT_PULL * DRIFT * tau * tau;

export default {
  id: L.MG_TILT, key: 'tilt', name: 'TILT TABLE',
  hint: 'THE TABLE TIPS  GET UPHILL BEFORE IT DOES  LAST ONE ON WINS',
  env: 'day',

  draw(view, ctx, out) {
    const st = stage(view);
    if (!(st.h0 > 0)) return;
    const sc = out.scene;
    // on the prediction's clock: the table your ball rides is where it's drawn
    const t = playT(st, view, ctx.ptick ?? ctx.tick + (ctx.dt || 0) / TICK);
    const ti = Math.floor(t);
    const now = (ctx.now ?? 0) / 1000;
    const [gx, gz] = gradSmooth(st, t);
    const F = frameOf(gx, gz);
    const cx = st.cx;
    const k = dropsAt(ti), h = halfOf(st.h0, k);
    // the band that crumbles next: red and shaking through its warning
    const next = k < MC.TT_CRN ? MC.TT_CR0 + k * MC.TT_CRI : Infinity, w = (t - (next - MC.TT_CRWARN)) / MC.TT_CRWARN;
    const hn = halfOf(st.h0, k + 1);
    let shx = 0, shz = 0;
    if (w > 0 && w < 1) { const sh = 0.02 + 0.06 * w; shx = sh * Math.sin(now * 37); shz = sh * Math.sin(now * 29 + 1); }
    // the move coming, from its warning through its tip
    const j = st.state === L.H_PLAY ? moveAt(st, ti + MC.TT_WARN) : -1;
    const mv = j >= 0 && ti >= st.moves[j].t - MC.TT_WARN && ti < st.moves[j].t + st.moves[j].tip ? st.moves[j] : null;
    const u = mv ? Math.min(1, Math.max(0, (t - (mv.t - MC.TT_WARN)) / MC.TT_WARN)) : 0;
    const pulse = 0.5 + 0.5 * Math.sin(now * (6 + 12 * u)), tipping = mv && ti >= mv.t;
    const hot = mv && mv.dir ? (mv.kind === MC.TT_K_SWING ? [1, 0.2, 0.15] : [1, 0.6, 0.12]) : null;
    // the slab, its checks 2 m in the world's plan
    tbox(sc, F, cx, 0, 0, h, h, -HY, HY, CHECK, LOOK.CHECKER, 2, 0, 1, 7);
    // the curb, in segments round the edge; the side the move coming tips down lit
    const n = Math.max(4, Math.round(h / 0.8)), seg = (2 * h) / n;
    const sides = [[1, 0, 11], [-1, 0, 12], [0, 1, 13], [0, -1, 14]];
    for (const [sx, sz, seed] of sides) {
      const lit = hot && SIDES[mv.dir][0] === sx && SIDES[mv.dir][1] === sz;
      for (let i = 0; i < n; i++) {
        const along = -h + (i + 0.5) * seg, x = sx ? sx * (h - CURB_W / 2) : along, z = sz ? sz * (h - CURB_W / 2) : along;
        const ex = sx ? CURB_W / 2 : seg / 2, ez = sz ? CURB_W / 2 : seg / 2;
        if (lit) tbox(sc, F, cx, x, z, ex, ez, 0.04, 0.05, i & 1 ? hot : [1, 0.95, 0.7], LOOK.GLOW, tipping ? 1.6 : 0.5 + 1.1 * pulse, 0.3, 1, seed);
        else tbox(sc, F, cx, x, z, ex, ez, 0.02, 0.03, CURB[i & 1], LOOK.PLASTIC, 0, 0, 1, seed);
      }
    }
    if (w > 0 && w < 1) {
      const pulse = 0.5 + 0.5 * Math.sin(now * (9 + 14 * w)), band = (h - hn) / 2, mid = (h + hn) / 2;
      const red = [1, 0.22, 0.1];
      for (const [px, pz, ex, ez] of [[mid, 0, band, h], [-mid, 0, band, h], [0, mid, hn, band], [0, -mid, hn, band]]) {
        tbox(sc, F, cx, px + shx, pz + shz, ex, ez, 0.07, 0.04, red, LOOK.GLOW, 0.5 + 0.9 * pulse, 0.6, 0.5 + 0.3 * pulse, 21);
      }
    }
    // a band that just crumbled, in chunks falling away
    if (k > 0) {
      const a = (t - (MC.TT_CR0 + (k - 1) * MC.TT_CRI)) * TICK;
      if (a >= 0 && a < FALL) {
        const ho = halfOf(st.h0, k - 1), band = (ho - h) / 2, mid = (ho + h) / 2;
        const m = Math.max(2, Math.round(ho / 2.5)), len = (2 * ho) / m, drop = -0.5 * 26 * a * a;
        for (let i = 0; i < m; i++) {
          // each chunk drifting out a little as it drops, at its own pace
          const along = -ho + (i + 0.5) * len, out1 = mid + a * (1.5 + ((i * 7) % 5) * 0.5), fade = 1 - a / FALL;
          tbox(sc, F, cx, out1, along, band, len / 2 * 0.94, -HY, HY, CHECK, LOOK.CHECKER, 2, 0, fade, 30 + i, drop * (1 + 0.1 * (i % 3)));
          tbox(sc, F, cx, -out1, along, band, len / 2 * 0.94, -HY, HY, CHECK, LOOK.CHECKER, 2, 0, fade, 31 + i, drop * (1 + 0.1 * ((i + 1) % 3)));
          tbox(sc, F, cx, along, out1, len / 2 * 0.94, band, -HY, HY, CHECK, LOOK.CHECKER, 2, 0, fade, 32 + i, drop * (1 + 0.1 * ((i + 2) % 3)));
          tbox(sc, F, cx, along, -out1, len / 2 * 0.94, band, -HY, HY, CHECK, LOOK.CHECKER, 2, 0, fade, 33 + i, drop * (1 + 0.1 * (i % 3)));
        }
      }
    }
    // and on the table: arrows sliding toward the side it tips down, or bars for level, three
    // by three on a big table, two by two on a smaller, one on the smallest
    if (mv) {
      const lit = tipping ? 1.5 : 0.7 + 0.8 * pulse, alpha = tipping ? 0.95 : 0.6 + 0.3 * pulse;
      const g = h >= 14 ? 3 : h >= 6 ? 2 : 1, sp = g > 1 ? (2 * h) / (g + 0.6) : 0;
      const len = Math.min(Math.max(2.4, h * 0.36), sp ? sp * 0.8 : h * 1.2), [ux, uz] = SIDES[mv.dir];
      const slide = ((now * 0.9) % 1 - 0.5) * len * 0.3;
      for (let a = 0; a < g; a++) for (let b = 0; b < g; b++) {
        const px = (a - (g - 1) / 2) * sp, pz = (b - (g - 1) / 2) * sp;
        if (!hot) {
          for (const o of [-0.18, 0.18]) tbox(sc, F, cx, px, pz + o * len, len * 0.3, len * 0.07, 0.1, 0.06, [0.3, 1, 0.4], LOOK.GLOW, lit, 0.5, alpha, 40);
        } else arrow(sc, F, cx, px + ux * slide, pz + uz * slide, ux, uz, len, hot, lit, alpha, 41);
      }
    }
    // the pivot: a steel column out of the sea and a ball joint under the middle
    const pr = 0.9 + st.h0 * 0.025, jr = pr * 1.3, top = PLAT_Y - 2 * HY - jr - 0.15;
    sc.sphere(cx, top, cx, jr, ...STEEL, LOOK.METAL);
    sc.cyl(cx, top / 2, cx, pr, top / 2, ...STEEL, LOOK.METAL);
  },

  // the table as it stands
  frame(view) {
    const st = stage(view);
    const g = view.party();
    const h = st.h0 > 0 ? halfAt(st, g.state === L.H_PLAY ? g.t : 0) : g.size;
    return { centre: [st.cx || g.cx, PLAT_Y, st.cx || g.cx], radius: h + 1, shape: 'square' };
  },

  fx(fx, ctx) {
    if (fx.kind === MC.TT_FX_WARN) {
      const dir = fx.shot & 7, kind = (fx.shot >> 3) & 3;
      if (dir === MC.TT_LEVEL) ctx.sound?.tick?.();
      else { ctx.sound?.count?.(1); if (kind === MC.TT_K_SWING) ctx.banner?.('IT SWINGS OVER!', C.RED, 1200); }
    } else if (fx.kind === MC.TT_FX_TIP) {
      if ((fx.shot & 7) !== MC.TT_LEVEL) ctx.sound?.land?.(20);
    } else if (fx.kind === MC.TT_FX_CRACK) {
      ctx.sound?.tick?.();
    } else if (fx.kind === MC.TT_FX_DROP) {
      ctx.sound?.land?.(28);
    }
  },

  // the slope now and the tilts you've ridden out; the move coming (which
  // side, as you face, how steep, how soon); an edge about to crumble
  hud(view, ctx) {
    const st = stage(view);
    if (st.state !== L.H_PLAY || !(st.h0 > 0)) return;
    const t = Math.max(0, typeof ctx.t === 'number' ? ctx.t / TICK : view.party().t);
    const ti = Math.floor(t);
    const row = Math.max(3, Math.floor((ctx.rows || 40) * 0.18));
    const me = ctx.me ?? (ctx.slot >= 0 ? view.partier(ctx.slot) : null);
    const playing = me && me.live && !me.out;
    const [gx, gz] = gradAt(st, ti);
    const surv = playing && ctx.slot >= 0 ? view.dv.getUint8(L.PG_S + MC.TT_SURV + ctx.slot) : 0;
    ctx.right(3, `TILT ${degOf(gx, gz)} DEG` + (playing ? `  RODE OUT ${surv}` : ''), C.GREY);
    // which side of you a move's way down is: ahead, behind, left or right
    const side = (dir) => {
      if (!playing) return '';
      const [ux, uz] = SIDES[dir], c = Math.cos(me.yaw), s = Math.sin(me.yaw);
      const fw = ux * c + uz * s, rt = -ux * s + uz * c;
      return Math.abs(fw) >= Math.abs(rt) ? (fw > 0 ? 'AHEAD' : 'BEHIND') : rt > 0 ? 'RIGHT' : 'LEFT';
    };
    const UP = { AHEAD: 'BACK', BEHIND: 'FORWARD', RIGHT: 'LEFT', LEFT: 'RIGHT' };
    const j = moveAt(st, ti + MC.TT_WARN);
    const m = j >= 0 ? st.moves[j] : null;
    if (m && ti >= m.t - MC.TT_WARN && ti < m.t + m.tip) {
      const secs = (m.t - t) * TICK, soon = secs >= 0.05;
      if (m.dir === MC.TT_LEVEL) ctx.centre(row, soon ? `LEVELLING IN ${secs.toFixed(1)}` : 'LEVELLING', C.GREEN);
      else {
        const sd = side(m.dir), verb = m.kind === MC.TT_K_SWING ? 'SWINGS' : 'TIPS';
        ctx.centre(row, soon ? `${verb}${sd ? ` ${sd}` : ''}  ${degOf(m.gx, m.gz)} DEG  IN ${secs.toFixed(1)}` : `TIPPING${sd ? ` ${sd}` : ''}!`, m.kind === MC.TT_K_SWING ? C.RED : C.ORANGE);
        if (sd) ctx.centre(row + 1, `GET UPHILL: GO ${UP[sd]}`, C.YELLOW);
      }
    }
    const k = dropsAt(ti);
    if (k < MC.TT_CRN) {
      const drop = MC.TT_CR0 + k * MC.TT_CRI;
      if (ti >= drop - MC.TT_CRWARN) {
        ctx.centre(row + 2, `THE EDGE CRUMBLES IN ${((drop - t) * TICK).toFixed(1)}`, C.ORANGE);
        const hn = halfOf(st.h0, k + 1);
        if (playing && Math.max(Math.abs(me.pos[0] - st.cx), Math.abs(me.pos[2] - st.cx)) > hn - 0.5) ctx.centre(row + 3, 'GET IN!', C.RED);
      }
    }
  },

  brain: {
    // off the table (as it stands on that tick, where the slope's pull will
    // have taken the ball by then) is a fall; the band that crumbles next,
    // once it cracks, nearly as bad; near the edge the slope runs down to, a
    // risk by how steep; near any edge a little
    danger(view, x, z, tick, me) {
      const st = stage(view);
      if (st.state !== L.H_PLAY) return 0;
      const t = (tick - st.start) | 0;
      const from = ((me?.from ?? view.tick) - st.start) | 0;
      const tau = Math.max(0, (t - from) * TICK);
      const [mx, mz] = gradAt(st, (t + from) >> 1);
      const dd = drift(tau);
      const dx = x + mx * dd - st.cx, dz = z + mz * dd - st.cx;
      const k = dropsAt(t), h = halfOf(st.h0, k);
      const far = Math.max(Math.abs(dx), Math.abs(dz));
      if (far > h - 0.4) return 1;
      let d = 0;
      if (k < MC.TT_CRN && t >= MC.TT_CR0 + k * MC.TT_CRI - MC.TT_CRWARN - 60 && far > halfOf(st.h0, k + 1) - 1.2) d = 0.85;
      const [gx, gz] = gradAt(st, t), s = Math.hypot(gx, gz);
      if (s > 1e-4) {
        const down = h - (dx * gx + dz * gz) / s, margin = 2 + 16 * s;
        if (down < margin) d = Math.max(d, 0.75 * (1 - down / margin));
      }
      if (far > h - 2.5) d = Math.max(d, 0.35 * (1 - (h - far) / 2.5));
      return d;
    },

    // uphill of the slope coming (the next move's once it's shown, else the
    // one in force), out from the middle by how steep, in a band spread by
    // its slot so a crowd doesn't make one heap; across the slope where it
    // is, off the side edges; on the level, toward the middle. Then back up
    // the slope by what its pull takes off the planner's reckoning.
    goal(view, me, bot) {
      const b = ball(view, me);
      if (!b || !b.live || b.out) return null;
      const st = stage(view);
      if (st.state !== L.H_PLAY) return null;
      const now = ((bot?.at ?? view.tick) - st.start) | 0;
      const x = (bot?.pos?.[0] ?? b.pos[0]) - st.cx, z = (bot?.pos?.[1] ?? b.pos[2]) - st.cx;
      const h = halfAt(st, now + MC.TT_CRWARN + 60);
      const lim = Math.max(0.5, h - 3);
      const [gx, gz] = comingGrad(st, now), s = Math.hypot(gx, gz);
      const spot = (((b.slot ?? 0) * 0.618034) % 1);
      let ax, az;
      if (s < 1e-4) {
        const r = Math.min(lim, 2 + h * 0.3);
        ax = Math.max(-r, Math.min(r, x * 0.6));
        az = Math.max(-r, Math.min(r, z * 0.6));
      } else {
        const ux = gx / s, uz = gz / s;
        const back = Math.min(lim, 1.5 + 10 * s + spot * Math.min(h * 0.3, 2 + h * 0.15));
        const across = Math.max(-lim * 0.8, Math.min(lim * 0.8, -x * uz + z * ux));
        ax = -ux * back - uz * across;
        az = -uz * back + ux * across;
      }
      const [nx, nz] = gradAt(st, now), dd = drift(0.45 + 0.4 * (bot?.skill ?? 0.6));
      return [st.cx + ax - nx * dd, st.cx + az - nz * dd];
    },

    hop() { return false; },

    // nothing to say outright: it notes on its record the tick it thinks
    // for, which danger reckons the slope's drift from
    think(view, me, bot, t) {
      if (me && typeof me === 'object') me.from = t;
      return null;
    },
  },
};
