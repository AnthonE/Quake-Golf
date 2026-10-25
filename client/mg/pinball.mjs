// PINBALL, as drawn and as the AI ball sees it. A giant table at night: a
// blue checkered playfield tilted down to the drains, chrome rails round it on
// a wooden cabinet over the sea; red pop bumpers that flash white as they
// kick, yellow slingshots with white rubber, drop targets glowing in their
// banks' colours (white while one hit waits to drop, sunk once down), the
// spinner's plate turning as the sim turns it, the top lanes' lights lit for
// a while after a ball rolls through, flippers in hazard stripes, the
// plunger lane's striped rod. Everything is read from the sim (src/mg/
// pinball.mjs's layout: the table in PG_H, its solids in PG_S) and placed as
// it stands on the clock your own ball is drawn at: a flipper's angle is
// $pn_ang worked again here in integers, a target's standing $pn_stands.
// The AI ball steers by the same reading; nothing is fed back.
import * as L from '../../src/layout.mjs';
import * as MC from '../../src/mg/pinball.mjs'; // PN_*: the minigame's own constants
import { PLAT_Y } from '../../src/party-view.mjs';
import { LOOK, SPRITE, DECAL } from '../party-render.mjs';
import { C } from '../font.mjs';

const TICK = 0.008;
const TURN = 16384;
const RAD = (2 * Math.PI) / TURN;
const S = Number(MC.PN_SLOPE);
const PHI = Math.atan(S); // the table's tilt
const PULL = Number(MC.PN_PULL);
const BATR = Number(MC.PN_BATR), BATH = Number(MC.PN_BATH);
const WALL_H = 1.8; // a wall's height, drawn
const POST_H = 1.1; // a top lane's post
const DECK = 0.8; // the playfield's half thickness
const BANK_COL = [[1, 0.55, 0.12], [0.25, 0.95, 0.45], [0.95, 0.3, 0.85], [0.3, 0.8, 1]];
const LANE_COL = [1, 0.85, 0.25];
const NAMES = ['BUMPER', 'LANE', 'TARGET', 'BANK', 'SPINNER'];
const ordinal = (n) => `${n}${[, 'ST', 'ND', 'RD'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'TH'}`;

// ---- the table, read from the sim

// A flipper's angle tb ticks into its own clock, as $pn_ang: 1/16384 turn below level.
export function batAng(tb) {
  if (tb < 0) return MC.PN_REST;
  const ph = tb % MC.PN_FPER;
  if (ph < MC.PN_FUP) return MC.PN_REST + Math.trunc(((MC.PN_UP - MC.PN_REST) * ph) / MC.PN_FUP);
  if (ph < MC.PN_FUP + MC.PN_FHOLD) return MC.PN_UP;
  if (ph < MC.PN_FUP + MC.PN_FHOLD + MC.PN_FDOWN) return MC.PN_UP + Math.trunc(((MC.PN_REST - MC.PN_UP) * (ph - MC.PN_FUP - MC.PN_FHOLD)) / MC.PN_FDOWN);
  return MC.PN_REST;
}
// Flipper side's (0 left, 1 right) own clock tp ticks into play.
export const batClock = (tp, side) => tp - MC.PN_FWAIT - side * MC.PN_FHALF;

let memo = null;
// This round's table as the confirmed world laid it out (it never moves), or null.
export function table(view) {
  if (memo && view._pnTick === view.tick && view._pnMemo === memo) return memo;
  const dv = view.dv;
  const f = (o) => dv.getFloat32(L.PG_H + o, true), u = (o) => dv.getUint32(L.PG_H + o, true);
  const hw = f(MC.PN_HW), hl = f(MC.PN_HL), nseg = u(MC.PN_NSEG);
  view._pnTick = view.tick;
  if (!(hw > 0) || !nseg || nseg > MC.PN_NSEGMAX) return null;
  const key = `${hw} ${hl} ${nseg} ${dv.getUint32(L.HDR_SEED, true)} ${dv.getUint32(L.HDR_HOLE, true)}`;
  if (memo?.key === key) { view._pnMemo = memo; return memo; }
  const segs = [];
  for (let i = 0; i < nseg; i++) {
    const a = L.PG_S + MC.PN_SEG + i * MC.PN_SEGSIZE;
    segs.push({ i, u: dv.getFloat32(a + MC.PN_S_U, true), w: dv.getFloat32(a + MC.PN_S_W, true), eu: dv.getFloat32(a + MC.PN_S_EU, true), ew: dv.getFloat32(a + MC.PN_S_EW, true),
      len: dv.getFloat32(a + MC.PN_S_LEN, true), rad: dv.getFloat32(a + MC.PN_S_RAD, true), kind: view.u8[a + MC.PN_S_KIND], idx: view.u8[a + MC.PN_S_IDX] });
  }
  const T = {
    key, cx: dv.getFloat32(L.PG_CX, true), hw, hl, m: u(MC.PN_M), f: f(MC.PN_F), lb: f(MC.PN_LBAT), ap: f(MC.PN_AP), wp: f(MC.PN_WP), wt: f(MC.PN_WT), wg: f(MC.PN_WG),
    kb: f(MC.PN_KB), kg: f(MC.PN_KG), plu: f(MC.PN_PLU), plt: f(MC.PN_PLTW), plb: f(MC.PN_PLBW), ltop: f(MC.PN_LTOP), lbot: f(MC.PN_LBOT), ul: f(MC.PN_UL), sw0: f(MC.PN_SW0),
    segs, geom: null,
  };
  T.bumpers = segs.filter((s) => s.kind === MC.PN_KBUMP).map((s) => ({ i: s.idx, u: s.u, w: s.w }));
  T.targets = [];
  for (let j = 0; j < u(MC.PN_NT); j++) {
    const a = L.PG_S + MC.PN_TGT + 8 * j, s = segs[view.u8[a + 5]];
    T.targets.push({ j, bank: view.u8[a + 4], seg: s, u: s.u, w: s.w + s.len / 2, side: s.u > 0 ? 1 : 0 });
  }
  T.banks = [];
  for (let b = 0; b < u(MC.PN_NBANK); b++) {
    const a = L.PG_S + MC.PN_BANK + 16 * b;
    T.banks.push({ b, first: view.u8[a + 4], n: view.u8[a + 5], side: view.u8[a + 6] });
  }
  T.spinners = [];
  for (let i = 0; i < u(MC.PN_NSP); i++) {
    const a = L.PG_S + MC.PN_SPIN + 32 * i;
    T.spinners.push({ i, u: dv.getFloat32(a, true), w: dv.getFloat32(a + 4, true), half: dv.getFloat32(a + 8, true) });
  }
  T.lanes = [];
  for (let j = 0; j < u(MC.PN_NL); j++) T.lanes.push({ j, u: dv.getFloat32(L.PG_S + MC.PN_LANE + 16 * j, true) });
  T.pivots = []; // [funnel][side]: { u, w, sd }
  for (let k = 0; k < T.m; k++) {
    const uc = (k + 0.5) * T.f - hw;
    T.pivots.push([{ u: uc - T.ap, w: T.wp, sd: 1, uc }, { u: uc + T.ap, w: T.wp, sd: -1, uc }]);
  }
  memo = T;
  view._pnMemo = memo;
  return memo;
}

// The plane's height under w.
export const planeY = (T, w) => PLAT_Y + S * (T.hl - w);
// The funnel over u and its middle.
export function funnel(T, u) {
  const k = Math.max(0, Math.min(T.m - 1, Math.floor((u + T.hw) / T.f)));
  return [k, (k + 0.5) * T.f - T.hw];
}
// The floor's edge at the bottom across u ($pn_edge).
export function edge(T, u) {
  const a = Math.abs(u - funnel(T, u)[1]);
  if (a <= MC.PN_GAP) return T.wt;
  if (a <= T.ap) return T.wp + (T.ap - a) * T.kb;
  return T.wp - (a - T.ap) * T.kg;
}
// Is there floor at (u, w)?
export const onFloor = (T, u, w) => Math.abs(u) <= T.hw && Math.abs(w) <= T.hl && (w < T.wg || w <= edge(T, u));
// Does target j stand on tick t ($pn_stands)?
export function stands(view, j, t) {
  const dv = view.dv;
  const hit = dv.getUint32(L.PG_S + MC.PN_TGT + 8 * j, true);
  if (!hit) return true;
  if (((t - hit) | 0) < MC.PN_DROPT) return true;
  const at = dv.getUint32(L.PG_S + MC.PN_BANK + 16 * view.u8[L.PG_S + MC.PN_TGT + 8 * j + 4], true);
  return at !== 0 && ((t - at) | 0) >= 0;
}
const hitAt = (view, j) => view.dv.getUint32(L.PG_S + MC.PN_TGT + 8 * j, true);
// Flipper (funnel k, side) on tick t into play (fractional): its pivot, angle (radians below level) and unit way out.
export function bat(T, k, side, tp) {
  const P = T.pivots[k][side];
  const i = Math.floor(tp), x = tp - i;
  const a0 = batAng(batClock(i, side)), a1 = batAng(batClock(i + 1, side));
  const th = (a0 + (a1 - a0) * x) * RAD;
  return { u: P.u, w: P.w, th, eu: P.sd * Math.cos(th), ew: Math.sin(th), len: T.lb };
}
// Ticks into play at tick T (fractional) of a round started on tick start: the sim's i32 subtraction wraps.
const since = (T0, start) => ((Math.floor(T0) - start) | 0) + (T0 - Math.floor(T0));

// ---- drawing

// A slab on the table's plane over u0..u1, w0..w1, hy half thick, its top lift over the plane.
function slab(sc, T, u0, u1, w0, w1, hy, lift, rgb, look, a = 0, b = 0, alpha = 1, seed) {
  const um = (u0 + u1) / 2, wm = (w0 + w1) / 2, y = planeY(T, wm) + lift;
  sc.box(T.cx + um, y - hy * Math.cos(PHI), T.cx + wm - hy * Math.sin(PHI), (u1 - u0) / 2, hy, (w1 - w0) / 2 / Math.cos(PHI), 0, ...rgb, look, a, b, alpha, seed, PHI);
}
// A bar standing on the plane along a capsule (from (u, w) along (eu, ew) len, rad thick), height tall, its foot lift over the plane.
function bar(sc, T, u, w, eu, ew, len, rad, height, rgb, look, a = 0, b = 0, alpha = 1, seed, lift = 0) {
  const um = u + eu * len / 2, wm = w + ew * len / 2;
  sc.box(T.cx + um, planeY(T, wm) + lift + height / 2, T.cx + wm, rad, height / 2, len / 2 + rad, Math.atan2(-eu, ew), ...rgb, look, a, b, alpha, seed, Math.atan(S * ew));
}
// The floor's half-width across a funnel at w (the drain's edge, turned round).
function halfAt(T, w) {
  if (w <= T.wp) return Math.min(T.f / 2, T.ap + (T.wp - w) / T.kg);
  return Math.max(MC.PN_GAP, T.ap - (w - T.wp) / T.kb);
}

// What never moves, as Scene calls, built once a table.
function build(T) {
  const out = [];
  const box = (...a) => out.push(['box', a]);
  const cyl = (...a) => out.push(['cyl', a]);
  const proxy = { box, cyl };
  const { hw, hl } = T;
  // the cabinet: a wooden body under the deck, chrome legs down to the sea
  const mid = planeY(T, 0);
  box(T.cx, mid - 3.2, T.cx, hw + 0.9, 2, hl / Math.cos(PHI) + 0.9, 0, 0.36, 0.2, 0.1, LOOK.WOOD, 0, 0, 1, 7, PHI);
  for (const su of [-1, 1]) for (const sw of [-1, 1]) {
    const lu = su * (hw - 2), lw = sw * (hl - 3), top = planeY(T, lw) - 5;
    cyl(T.cx + lu, (top - 12) / 2, T.cx + lw, 1.2, (top + 12) / 2, 0.75, 0.77, 0.8, LOOK.METAL);
  }
  // the playfield, down to the flippers' tips; over it in each funnel, strip by strip, the aprons outside its floor
  slab(proxy, T, -hw, hw, -hl, T.wt, DECK, 0, [0.1, 0.24, 0.72], LOOK.CHECKER, 3, 0.5, 1, 11);
  const N = 8;
  for (let k = 0; k < T.m; k++) {
    const uc = (k + 0.5) * T.f - hw;
    for (let i = 0; i < N; i++) {
      const w0 = T.wg + (T.wt - T.wg) * i / N, w1 = T.wg + (T.wt - T.wg) * (i + 1) / N, half = halfAt(T, (w0 + w1) / 2);
      if (half < T.f / 2 - 0.05) for (const sd of [-1, 1]) slab(proxy, T, sd > 0 ? uc + half : uc - T.f / 2, sd > 0 ? uc + T.f / 2 : uc - half, w0, w1, 0.3, 0.25, [0.62, 0.06, 0.1], LOOK.PLASTIC);
    }
    // under the tips: the aprons either side of the drain, and the drain's red line across the gap
    for (const sd of [-1, 1]) slab(proxy, T, sd > 0 ? uc + MC.PN_GAP - BATR : uc - T.f / 2, sd > 0 ? uc + T.f / 2 : uc - MC.PN_GAP + BATR, T.wt, hl, DECK, 0.25, [0.62, 0.06, 0.1], LOOK.PLASTIC);
    slab(proxy, T, uc - MC.PN_GAP + BATR, uc + MC.PN_GAP - BATR, T.wt + 0.1, T.wt + 0.35, 0.05, 0.02, [1, 0.15, 0.1], LOOK.GLOW, 1.2, 0.3);
    // a pivot post at each flipper
    for (const P of T.pivots[k]) cyl(T.cx + P.u, planeY(T, P.w) + BATH / 2 + 0.1, T.cx + P.w, BATR + 0.15, BATH / 2 + 0.12, 0.8, 0.82, 0.86, LOOK.METAL);
  }
  // the solids that don't move: walls in chrome, the deflectors glowing, the slingshots, the lanes' posts
  for (const s of T.segs) {
    if (s.kind === MC.PN_KWALL) {
      const post = s.w >= T.ltop - 0.01 && s.w <= T.ltop + 0.01 && Math.abs(s.eu) < 1e-3 && Math.abs(s.len - MC.PN_LLEN) < 0.01;
      bar(proxy, T, s.u, s.w, s.eu, s.ew, s.len, s.rad, post ? POST_H : WALL_H, post ? [1, 0.85, 0.3] : [0.86, 0.88, 0.92], post ? LOOK.PLASTIC : LOOK.METAL, 0, 0, 1, s.i * 5 + 1);
    } else if (s.kind === MC.PN_KDEF) {
      bar(proxy, T, s.u, s.w, s.eu, s.ew, s.len, s.rad, WALL_H, [1, 0.45, 0.15], LOOK.GLOW, 0.8, 0.5, 1, s.i * 5 + 2);
    } else if (s.kind === MC.PN_KSLING) {
      // the slingshot: a yellow body behind its white rubber, out from the funnel's middle
      const [, uc] = funnel(T, s.u + s.eu * s.len / 2);
      const out = Math.sign(s.u + s.eu * s.len / 2 - uc) || 1;
      const nu = s.ew * out, nw = -s.eu * out;
      bar(proxy, T, s.u + nu * 0.95, s.w + nw * 0.95, s.eu, s.ew, s.len, 0.7, 1.1, [1, 0.8, 0.12], LOOK.PLASTIC, 0, 0, 1, s.i * 5 + 3);
    }
  }
  // the plunger lane's floor stripe and the cabinet's back panel over the top wall
  slab(proxy, T, T.plu + 0.4, hw - 0.4, T.plt, T.plb, 0.05, 0.02, [1, 0.3, 0.2], LOOK.GLOW, 0.25, 0.8, 0.6);
  box(T.cx, planeY(T, -hl) + 4, T.cx - hl - 0.6, hw + 0.9, 4, 0.3, 0, 0.08, 0.06, 0.12, LOOK.PLASTIC);
  return out;
}

const flashAt = new Map(); // 'b3' (bumper 3), 's1' (slingshot 1), 'p' (the plunger) -> ms of its last kick

// Ticks into play to draw at (fractional): the prediction's clock, frozen through the result.
function playTime(view, ctx) {
  const g = view.party();
  if (g.state !== L.H_PLAY && g.state !== L.H_OVER) return 0;
  let t = ctx?.ptick !== undefined ? since(ctx.ptick, g.start) : g.t + (ctx?.dt || 0) / TICK;
  if (g.state === L.H_OVER) t = Math.min(t, (g.until - L.P_OVER - g.start) | 0);
  return Math.max(0, t);
}

function draw(view, ctx, out) {
  const T = table(view);
  if (!T) return;
  if (!T.geom) T.geom = build(T);
  const sc = out.scene;
  for (const [k, a] of T.geom) sc[k](...a);
  const g = view.party();
  const now = ctx?.now ?? 0;
  const tp = playTime(view, ctx);
  const tick = g.start + Math.floor(tp);
  const playing = g.state === L.H_PLAY;
  const dbl = playing && tp >= MC.PN_LEN - MC.PN_DOUBLE;
  const pulse = 0.5 + 0.5 * Math.sin(now / 180);
  // the pop bumpers: a red skirt, a ring glowing (white-hot as it kicks), a white cap
  for (const B of T.bumpers) {
    const fl = Math.max(0, 1 - (now - (flashAt.get(`b${B.i}`) ?? -1e9)) / 220);
    const y = planeY(T, B.w), x = T.cx + B.u, z = T.cx + B.w;
    sc.cyl(x, y + 0.25, z, MC.PN_BR + 0.25, 0.25, 0.9, 0.12, 0.14, LOOK.PLASTIC);
    sc.cyl(x, y + 0.85, z, MC.PN_BR * 0.92, 0.35, 1, 0.3 + 0.6 * fl, 0.25 + 0.6 * fl, LOOK.GLOW, 0.7 + 0.25 * pulse * (dbl ? 2 : 1) + 2.5 * fl, 0.4);
    sc.cyl(x, y + MC.PN_BH - 0.1, z, MC.PN_BR, 0.12, 0.97, 0.96, 0.92, LOOK.PLASTIC);
    if (fl > 0) out.glow.push({ pos: [x, y + MC.PN_BH + 0.4, z], size: 3 * fl + 1, color: [1, 0.9, 0.6, 0.6 * fl], kind: SPRITE.FLASH, minpx: 1 });
  }
  // the slingshots' rubber, flashing as it throws
  for (const s of T.segs) {
    if (s.kind !== MC.PN_KSLING) continue;
    const fl = Math.max(0, 1 - (now - (flashAt.get(`s${s.idx}`) ?? -1e9)) / 200);
    bar(sc, T, s.u, s.w, s.eu, s.ew, s.len, s.rad + 0.05, 1.0, [1, 1, 1], LOOK.GLOW, 0.5 + 2 * fl, 0.2, 1, s.i * 5 + 4);
  }
  // the drop targets: standing in the bank's colour; hit and waiting to drop, flashing white, sinking its last quarter second; down, a slot
  for (const Tg of T.targets) {
    const col = BANK_COL[Tg.bank % BANK_COL.length], s = Tg.seg, hit = hitAt(view, Tg.j);
    const up = stands(view, Tg.j, tick);
    let sink = 0, lit = 0.8 + 0.3 * pulse * (dbl ? 1.5 : 0.5), c = col;
    if (hit && up && ((tick - hit) | 0) < MC.PN_DROPT) {
      const left = MC.PN_DROPT - ((tick - hit) | 0);
      c = Math.sin(now / 50) > 0 ? [1, 1, 1] : col;
      lit = 1.6;
      if (left < 32) sink = (1 - left / 32) * MC.PN_TH;
    }
    if (!up) sink = MC.PN_TH - 0.08;
    bar(sc, T, s.u, s.w, s.eu, s.ew, s.len, s.rad + 0.1, MC.PN_TH, c, up || sink < MC.PN_TH - 0.1 ? LOOK.GLOW : LOOK.PLASTIC, up ? lit : 0.2, 0.4, 1, s.i * 5 + 4, -sink);
  }
  // the spinners: a metal plate across its lane turning about the lane's width, on two posts
  const dv = view.dv;
  for (const Sp of T.spinners) {
    const a = L.PG_S + MC.PN_SPIN + 32 * Sp.i;
    const ang = dv.getUint32(a + 12, true) + dv.getUint32(a + 16, true) * Math.max(0, Math.min(1, tp - Math.floor(tp)));
    const y = planeY(T, Sp.w) + 1.6, x = T.cx + Sp.u, z = T.cx + Sp.w;
    sc.box(x, y, z, Sp.half - 0.35, 0.75, 0.06, 0, 0.9, 0.92, 0.96, LOOK.METAL, 0, 0, 1, 900 + Sp.i, (ang % TURN) * RAD);
    for (const sd of [-1, 1]) sc.cyl(x + sd * (Sp.half - 0.2), y - 0.6, z, 0.12, 1.1, 0.85, 0.2, 0.2, LOOK.PLASTIC);
    out.decals.push({ pos: [x, planeY(T, Sp.w) + 0.05, z], radius: Sp.half - 0.3, width: 0.2, color: [0.6, 0.9, 1, 0.5], kind: DECAL.RING });
  }
  // the top lanes: a light down each, lit while it's lit
  for (const Ln of T.lanes) {
    const until = dv.getUint32(L.PG_S + MC.PN_LANE + 16 * Ln.j + 4, true);
    const on = playing && ((until - tick) | 0) > 0;
    const blink = on && ((until - tick) | 0) < 60 && Math.sin(now / 60) < 0;
    const w = (T.ltop + T.lbot) / 2;
    slab(sc, T, Ln.u - 0.55, Ln.u + 0.55, w - 1.2, w + 1.2, 0.06, 0.03, on && !blink ? LANE_COL : [0.4, 0.32, 0.12], LOOK.GLOW, on && !blink ? 1.6 : 0.3, 0.3, 1, 700 + Ln.j);
    if (on && !blink) out.glow.push({ pos: [T.cx + Ln.u, planeY(T, w) + 0.6, T.cx + w], size: 2.2, color: [1, 0.85, 0.3, 0.45], kind: SPRITE.FLASH, minpx: 1 });
  }
  // the flippers in hazard stripes, as they stand
  for (let k = 0; k < T.m; k++) for (let side = 0; side < 2; side++) {
    const B = bat(T, k, side, tp);
    bar(sc, T, B.u, B.w, B.eu, B.ew, B.len, BATR, BATH, [1, 0.8, 0.08], LOOK.HAZARD, 0.5, 0, 1, 800 + k * 2 + side, 0.05);
    sc.cyl(T.cx + B.u + B.eu * B.len, planeY(T, B.w + B.ew * B.len) + BATH / 2 + 0.05, T.cx + B.w + B.ew * B.len, BATR * 0.9, BATH / 2, 0.15, 0.15, 0.15, LOOK.RUBBER);
  }
  // the plunger: a striped rod at the lane's bottom, drawn back and shot as it fires
  const pk = Math.max(0, 1 - (now - (flashAt.get('p') ?? -1e9)) / 300);
  const pu = (T.plu + T.hw) / 2, pw = T.plb - 1.6 - 1.2 * pk;
  sc.cyl(T.cx + pu, planeY(T, pw) + 0.9, T.cx + pw, 0.55, 1.2, 0.95, 0.15, 0.12, LOOK.HAZARD, 0.4, 0, 1, 990, Math.PI / 2, 0);
  if (pk > 0) out.glow.push({ pos: [T.cx + pu, planeY(T, pw) + 1, T.cx + pw - 1.5], size: 2.5 * pk + 0.5, color: [1, 0.5, 0.3, 0.6 * pk], kind: SPRITE.FLASH, minpx: 1 });
  // double time: the rails' lights blink
  if (dbl) for (const sd of [-1, 1]) out.decals.push({ pos: [T.cx + sd * (T.hw - 1), planeY(T, 0) + 0.1, T.cx], radius: 1.2, width: 1.2, color: [1, 0.4, 0.2, 0.3 + 0.5 * pulse], kind: DECAL.DISC });
}

// ---- the AI ball

// A number in [0, 1) for slot p and k, the same on every machine that asks.
const luck = (p, k) => (((Math.imul(p + 1, 0x9e3779b1) ^ Math.imul(k + 7, 0x85ebca6b)) >>> 0) % 10007) / 10007;
const UP_V = 3, DOWN_V = 12; // m/s it reckons it makes up and down the table
const ball = (view, me) => (typeof me === 'number' ? view.partier(me) : me);
// A lane's last pay to slot p, the tick into play + 1 (0 never), as the confirmed world has it.
const lanePaid = (view, p, j) => view.dv.getUint16(L.PG_S + MC.PN_BALL + 16 * p + 2 + 2 * j, true);

// The balls in, once a world tick, in a grid of 6 m cells: for crowding.
function crowdOf(view) {
  if (view._pnCrowd?.tick === view.tick) return view._pnCrowd;
  const grid = new Map();
  for (let p = 0; p < L.NPLAYER; p++) {
    const a = L.PLAYERS + p * L.PSIZE;
    if ((view.u8[a + L.P_FL] & (L.PF_LIVE | L.PF_DEAD | L.PF_FALL)) !== L.PF_LIVE) continue;
    const x = view.dv.getFloat32(a + L.P_PX, true), z = view.dv.getFloat32(a + L.P_PZ, true);
    const k = Math.floor(x / 6) * 4096 + Math.floor(z / 6);
    const list = grid.get(k);
    if (list) list.push([p, x, z]); else grid.set(k, [[p, x, z]]);
  }
  view._pnCrowd = { tick: view.tick, grid };
  return view._pnCrowd;
}
// Rivals of slot within r of (x, z), at most 6 counted.
function crowd(view, x, z, r, slot) {
  const { grid } = crowdOf(view);
  let n = 0;
  for (let i = Math.floor((x - r) / 6); i <= Math.floor((x + r) / 6); i++) for (let j = Math.floor((z - r) / 6); j <= Math.floor((z + r) / 6); j++) {
    for (const [p, bx, bz] of grid.get(i * 4096 + j) || []) if (p !== slot && (bx - x) ** 2 + (bz - z) ** 2 < r * r && ++n >= 6) return n;
  }
  return n;
}

// How much (u, w) is the drain's: past the floor's edge 1, in a funnel's gap
// by the tips' line 0.8, in a funnel under its pivots 0.3.
function drainy(T, u, w) {
  if (w < T.wg - 1) return 0;
  if (!onFloor(T, u, w)) return 1;
  const a = Math.abs(u - funnel(T, u)[1]);
  if (a < MC.PN_GAP + 0.3 && w > T.wt - 1.5) return 0.8;
  return w > T.wp ? 0.3 : 0;
}
// Where a ball rides flipper (k, side) up: on its top, 60% of the way out
// from its pivot, as it rests.
function sweet(T, k, side) {
  const P = T.pivots[k][side];
  const c = Math.cos(MC.PN_REST * RAD), s = Math.sin(MC.PN_REST * RAD);
  const along = 0.6 * T.lb, off = 1 + BATR + 0.2;
  return [P.u + P.sd * c * along + P.sd * s * off, P.w + s * along - c * off];
}

// What the ball goes for, thought again every think (kept in bot.mem): a top
// lane that will pay it (from above, rolling down through it), a drop
// target standing unhit (most for a bank's last), the spinner (down through
// its lane), a bumper; each worth its points over the time to get there,
// less for the rivals round it, more for the one it's after already. The
// time up the table is the quicker of rolling up it against the pull and
// riding a flipper: down to one, batted up at about 18 m/s. If riding is
// quicker it makes for the flipper's top (its own funnel's, its own side's)
// and waits there to be batted.
const FLY_V = 18;
function plan(view, me, bot) {
  const T = table(view);
  const b = ball(view, me);
  const g = view.party();
  if (!T || !b || !b.live || b.out || g.state !== L.H_PLAY) return null;
  const mem = bot?.mem || {};
  const when = bot?.at ?? view.tick;
  if (mem.plan && mem.planAt === when) return mem.plan;
  const slot = b.slot ?? 0;
  const skill = bot?.skill ?? 0.6;
  const lag = Math.max(0, Math.min(40, bot?.lag ?? 0)) * TICK;
  const x = bot?.pos?.[0] ?? b.pos[0], z = (bot?.pos?.[1] ?? b.pos[2]) + 0.5 * PULL * lag * lag;
  const vx = bot?.vel?.[0] ?? b.vel[0], vz = (bot?.vel?.[1] ?? b.vel[2]) + PULL * lag;
  const u = x - T.cx, w = z - T.cx;
  const tp = (when - g.start) | 0;
  const mult = tp >= MC.PN_LEN - MC.PN_DOUBLE ? 2 : 1;
  const upv = Math.max(UP_V, -vz * 0.8);
  const toBat = Math.max(0, T.wp - 2 - w) / 7 + 0.7;
  let rides = false;
  const eta = (gu, gw) => {
    const du = gu - u, dw = gw - w, d = Math.hypot(du, dw) || 1e-6;
    if (dw >= -3) return [d / DOWN_V + 0.3, false];
    const direct = d / (upv + (DOWN_V - upv) * (1 + dw / d) / 2) + 0.3;
    const ride = toBat + Math.hypot(du, gw - T.wp) / FLY_V + 0.6;
    return ride < direct ? [ride, true] : [direct, false];
  };
  const cand = [];
  const add = (kind, key, gu, gw, worth, aim) => {
    const [e, ride] = eta(gu, gw);
    let s = worth / (e + 0.6);
    s /= 1 + 0.5 * crowd(view, T.cx + gu, T.cx + gw, 4, slot);
    s *= 0.75 + 0.5 * luck(slot, key * 31 + kind);
    if (mem.kind === kind && mem.key === key) s *= 1.4 + 0.5 * (1 - skill);
    cand.push({ kind, key, gu, gw, s, aim, ride });
  };
  // the top lanes: in from above (the lanes' top), then down through
  for (const Ln of T.lanes) {
    const last = lanePaid(view, slot, Ln.j);
    if (last && tp + 1 - last < MC.PN_LANECD) continue;
    add(0, Ln.j, Ln.u, T.ltop - 1.8, MC.PN_LANEPAY * mult, [Ln.u, T.lbot + 2.5]);
  }
  // the drop targets: into its face, from in front
  for (const B of T.banks) {
    let unhit = 0;
    for (let j = B.first; j < B.first + B.n; j++) if (!hitAt(view, j)) unhit++;
    for (let j = B.first; j < B.first + B.n; j++) {
      if (hitAt(view, j)) continue;
      const Tg = T.targets[j], sd = Tg.side ? 1 : -1;
      add(1, j, Tg.u - sd * 2.2, Tg.w, (MC.PN_TGTPAY + (unhit === 1 ? MC.PN_BANKPAY : 0)) * mult, [Tg.u + sd * 1, Tg.w]);
    }
  }
  // the spinners: into the top of its lane, then down through it
  for (const Sp of T.spinners) add(2, Sp.i, Sp.u, Sp.w - MC.PN_SPL / 2 - 1.5, 6 * mult, [Sp.u, Sp.w + MC.PN_SPL / 2 + 1]);
  // the bumpers, from under them
  for (const B of T.bumpers) add(3, B.i, B.u, B.w + MC.PN_BR + 1.4, 1.6 * mult, [B.u, B.w]);
  let best = null;
  for (const c of cand) if (!best || c.s > best.s) best = c;
  mem.kind = best?.kind;
  mem.key = best?.key;
  // once at its way in (above a lane, over the spinner's lane, in front of a target or a bumper), it goes through
  let goal = best ? [best.gu, best.gw] : [T.ul, (T.wg - T.hl) / 2];
  if (best) {
    const near = Math.hypot(u - best.gu, w - best.gw);
    if (best.kind === 0 && w < T.ltop + 0.5 && Math.abs(u - best.gu) < 1.1) goal = best.aim;
    else if (best.kind === 2 && Math.abs(u - best.gu) < 1.2 && w > best.gw - 1 && w < best.aim[1]) goal = best.aim;
    else if ((best.kind === 1 || best.kind === 3) && near < 2.5) goal = best.aim;
    else if (mem.through === `${best.kind}:${best.key}` && near < 6) goal = best.aim;
    mem.through = goal === best.aim ? `${best.kind}:${best.key}` : null;
    rides = best.ride && goal !== best.aim;
  }
  if (rides) {
    const [k, uc] = funnel(T, u);
    goal = sweet(T, k, u < uc ? 0 : 1);
  }
  const p = { T, u, w, vu: vx, vw: vz, goal, rides, tp, slot, skill, ground: b.ground };
  mem.plan = p;
  mem.planAt = when;
  return p;
}

// Should the ball hop now? A flipper of its funnel about to swing back
// down through it, 20 to 25 ticks from now: a hop's top (over the bar from
// 21 to 54 ticks in) clears the whole of its swing, which would else sweep
// the ball off the floor's edge into the drain.
function hopNow(p) {
  const { T, u, w, tp } = p;
  if (!p.ground || w < T.wg - 2) return false;
  const [k] = funnel(T, u);
  for (let side = 0; side < 2; side++) {
    const P = T.pivots[k][side];
    const du = (u - P.u) * P.sd, dw = w - P.w, d = Math.hypot(du, dw);
    if (d > T.lb + 1 + BATR || d < 0.3) continue;
    const thb = Math.atan2(dw, du) / RAD; // the ball's angle from the pivot, as a flipper's
    const reach = (d <= 1 + BATR ? Math.PI / 2 : Math.asin((1 + BATR) / d)) / RAD;
    for (let i = 1; i <= 30; i++) {
      const a0 = batAng(batClock(tp + i - 1, side)), a1 = batAng(batClock(tp + i, side));
      if (a1 <= a0) continue;
      // it starts down on tick i: does it come down through the ball?
      if (a0 < thb + reach && MC.PN_REST > thb - reach) return i >= 20 && i <= 25;
      break;
    }
  }
  return false;
}

// The word: for the goal, flat out but arriving at no more than it can
// steer, the table's pull taken off the keys' push; up the table and out
// from the gap when where it would coast to is the drain's; a hop over a
// flipper coming down on it.
function think(view, me, bot) {
  const p = plan(view, me, bot);
  if (!p) return null;
  const { T, u, w, vu, vw, goal, skill } = p;
  const look = 0.45 + 0.4 * skill;
  // where it coasts to with no keys
  const fu = u + vu * look, fw = w + vw * look + 0.5 * PULL * look * look;
  let du = goal[0] - u, dw = goal[1] - w;
  const d = Math.hypot(du, dw) || 1e-6;
  // riding, it stops on the flipper; else it arrives rolling
  const want = p.rides ? Math.min(11, 1.6 * d) : Math.min(11, 2.5 + 1.6 * d);
  let au = (du / d) * want - vu, aw = (dw / d) * want - vw;
  const risk = Math.max(drainy(T, fu, fw), drainy(T, u, w));
  if (risk > 0.5) {
    // the drain: up the table hard, and away from the gap toward a flipper
    const [, uc] = funnel(T, u);
    const side = Math.sign(u - uc) || (luck(p.slot, 5) < 0.5 ? -1 : 1);
    au = side * 4 - vu * 0.3;
    aw = -14 - Math.max(0, vw) * 0.5;
  }
  // the keys push where the wanted change is, less the table's pull
  const ku = au, kw = aw - PULL;
  return { yaw: Math.atan2(kw, ku), move: 1, hop: hopNow(p) ? 1 : 0 };
}

export default {
  id: L.MG_PINBALL, key: 'pinball', name: 'PINBALL',
  hint: 'HIT BUMPERS TARGETS LANES  RIDE THE FLIPPERS  A DRAIN COSTS A FIFTH',
  env: 'night',

  draw,

  // the whole table, north up
  frame(view) {
    const T = table(view);
    const g = view.party();
    if (!T) return { centre: [g.cx, g.floor, g.cx], radius: g.size, shape: 'square' };
    return { centre: [T.cx, planeY(T, 0), T.cx], radius: T.hl, shape: 'square' };
  },

  // a new round faces you up the table
  facing() { return -Math.PI / 2; },

  sink(f, name) { return `${name(f.owner)} DRAINED${f.shot !== 255 ? ` BY ${name(f.shot)}` : ''}`; },

  fx(f, ctx) {
    const mine = f.owner === ctx.slot;
    const d = typeof ctx.dist === 'function' ? ctx.dist(f.pos) : ctx.dist ?? 0;
    const now = ctx.now ?? 0;
    if (f.kind === MC.PN_FX_SCORE) {
      const what = f.shot >> 8;
      const big = what === MC.PN_WTGT || what === MC.PN_WBANK;
      ctx.glow?.({ pos: f.pos, size: big ? 2.4 : 1.2, color: what === MC.PN_WBANK ? [1, 0.85, 0.3, 1] : [1, 0.95, 0.6, 0.9], kind: big ? SPRITE.RING : SPRITE.SPARK, life: big ? 500 : 280, grow: big });
      if (mine) {
        if (what === MC.PN_WBANK) { ctx.banner?.(`BANK DOWN  +${f.size}`, C.YELLOW, 1800); ctx.sound?.holed?.(); }
        else if (what === MC.PN_WTGT) { ctx.banner?.(`TARGET  +${f.size}`, C.ORANGE, 900); ctx.sound?.kill?.(); }
        else if (what === MC.PN_WLANE) { ctx.banner?.(`LANE  +${f.size}`, C.CYAN, 800); ctx.sound?.pickup?.(); }
        else if (what === MC.PN_WSPIN) ctx.sound?.tick?.();
      } else if (what === MC.PN_WBANK) ctx.feed?.(`${ctx.name?.(f.owner) ?? `P${f.owner + 1}`} DOWNED A BANK  +${f.size}`, C.YELLOW);
      return;
    }
    if (f.kind === MC.PN_FX_KICK) {
      const what = f.shot >> 8, j = f.shot & 255;
      if (what === MC.PN_JBUMP) { flashAt.set(`b${j}`, now); ctx.sound?.boing?.(Math.max(8, f.size), mine ? 0 : d); }
      else if (what === MC.PN_JSLING) { flashAt.set(`s${j}`, now); ctx.sound?.boing?.(Math.max(6, f.size), mine ? 0 : d); }
      else if (what === MC.PN_JBAT) { if (mine || d < 25) ctx.sound?.land?.(Math.min(30, f.size)); }
      else if (what === MC.PN_JPLUNGE) { flashAt.set('p', now); if (mine) ctx.sound?.jump?.(); }
      ctx.glow?.({ pos: f.pos, size: 1.6, color: [1, 0.95, 0.75, 0.8], kind: SPRITE.RING, life: 220, grow: true });
      return;
    }
    if (f.kind === MC.PN_FX_DRAIN) {
      if (mine) ctx.banner?.(f.shot ? `DRAINED  -${f.shot}` : 'DRAINED', C.RED, 1800);
      else if (f.shot >= 20) ctx.feed?.(`${ctx.name?.(f.owner) ?? `P${f.owner + 1}`} DRAINED  -${f.shot}`, C.GREY);
      return;
    }
    if (f.kind === MC.PN_FX_CALL) {
      if (f.shot === 0) { ctx.banner?.('DOUBLE SCORE!', C.ORANGE, 2200); ctx.sound?.holed?.(); }
      else if (f.shot === 1) ctx.sound?.count?.(1);
    }
  },

  // double time on the clock, the banks' targets standing, where you stand
  hud(view, ctx) {
    const g = view.party();
    if (g.state !== L.H_PLAY) return;
    const T = table(view);
    if (!T) return;
    const tp = typeof ctx.t === 'number' && ctx.t > 0 ? ctx.t / TICK : g.t;
    const now = ctx.now ?? 0;
    if (tp >= MC.PN_LEN - MC.PN_DOUBLE) ctx.right(3, 'DOUBLE SCORE', Math.floor(now / 250) % 2 ? C.ORANGE : C.YELLOW);
    else ctx.right(3, `DOUBLE IN ${Math.ceil((MC.PN_LEN - MC.PN_DOUBLE - tp) * TICK)}`, C.GREY);
    const banks = T.banks.map((B) => { let s = ''; for (let j = B.first; j < B.first + B.n; j++) s += hitAt(view, j) ? '_' : 'I'; return s; });
    ctx.right(4, `TARGETS ${banks.join(' ')}`, C.WHITE);
    const me = ctx.me ?? (ctx.slot >= 0 ? view.partier(ctx.slot) : null);
    if (me?.live) {
      let place = 1, n = 0;
      for (let p = 0; p < L.NPLAYER; p++) {
        const a = L.PLAYERS + p * L.PSIZE;
        if (!(view.u8[a + L.P_FL] & L.PF_LIVE)) continue;
        n++;
        if (view.dv.getUint16(a + L.PG_SCORE, true) > me.score) place++;
      }
      ctx.right(5, `${ordinal(place)} OF ${n}`, place === 1 ? C.GREEN : C.WHITE);
    }
  },

  brain: {
    // the drain, and the bottom of the table leading into it
    danger(view, x, z) {
      const T = table(view);
      return T ? drainy(T, x - T.cx, z - T.cx) : 0;
    },
    goal(view, me, bot) {
      const p = plan(view, me, bot);
      return p ? [p.T.cx + p.goal[0], p.T.cx + p.goal[1]] : null;
    },
    hop(view, me, bot) {
      const p = plan(view, me, bot);
      return p ? hopNow(p) : false;
    },
    think,
  },
};
