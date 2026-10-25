// CANNONADE, as drawn and as the AI ball sees it. The disc is hex tiles of
// pale stone in rings round a sandstone core (the part the rim never takes),
// standing on a column in the sea; tiles the rim is about to take darken and
// shake, then drop and tumble away. Round it, on posts out of the sea, the
// cannons: an iron drum and a square barrel banded in bronze, turning to
// aim down each shot's lane as its red stripe shows on the floor, the muzzle
// glowing hotter till it fires in a flash and a puff of smoke, the barrel
// kicking back. The cannonballs are dark iron spheres rolling down their
// stripes (the stripe ahead of each shrinking as it passes), lobs climbing
// high onto a target ring before they roll, all falling past the far rim into
// the sea with a splash. Every shot is read from the sim's own schedule
// (src/mg/cannon.mjs's layout, in PG_BIG) and worked to the frame's tick on
// the prediction's clock, so a cannonball is drawn where your ball meets it.
import * as L from '../../src/layout.mjs';
import * as MC from '../../src/mg/cannon.mjs'; // CN_*: the minigame's own constants
import { PLAT_Y, hexCentre } from '../../src/party-view.mjs';
import { LOOK, SPRITE, DECAL } from '../party-render.mjs';
import { C } from '../font.mjs';

const f = Math.fround;
const S = f(MC.CN_S); // the sim's f32 circumradius
const TICK = 0.008;
const RB = 1; // a ball's radius
const HH = 0.45; // a tile's half height, m
const DRAWN = 0.95; // a tile's drawn circumradius over the sim's: a seam between tiles
const WARN = 375; // ticks before the rim takes a tile that it darkens (and shakes, the last 60)
const FALL = 1.5; // s a tile is drawn falling
const SEA = 275; // ticks past the far rim a cannonball is drawn falling, into the sea
const SMOKE = 110; // ticks a shot's smoke lasts
const AIM = 45; // ticks a cannon takes to swing onto its next lane
const HOT1 = 1, HOT2 = 2.5; // s: a stripe is bright where its cannonball gets within HOT1, dimmer within HOT2
const BAND = 2 * 1.5 * MC.CN_S; // m a ring of colour is wide: two tiles
const RINGS = [[0.86, 0.84, 0.78], [0.66, 0.68, 0.72]];
const CORE = [[0.93, 0.83, 0.6], [0.84, 0.7, 0.48]];
const DOOM = [0.24, 0.22, 0.22];
const IRON = [0.15, 0.15, 0.17];
const BRONZE = [0.34, 0.3, 0.24];
const STONE = [0.5, 0.48, 0.45];
const RED = [1, 0.12, 0.06];

const TILE0 = L.PG_BIG + MC.CN_TILES;
const SHOT0 = L.PG_BIG + MC.CN_SHOTS;

// ---- what the sim says: the rim, the tiles, the cannons, the shots

// The rim on tick tp into play ($cn_rim, in doubles: for drawing and steering).
export function rimAt(r0, tp) {
  const k = tp - MC.CN_CRUMBLE;
  if (k <= 0) return r0;
  if (k >= MC.CN_SHRINK) return MC.CN_RMIN;
  return r0 - (r0 - MC.CN_RMIN) * (k / MC.CN_SHRINK);
}
// A cell's byte offset in the tiles ($cn_cell), -1 off the grid.
export const cellOf = (q, r) => (Math.abs(q) > MC.CN_N || Math.abs(r) > MC.CN_N ? -1 : ((r + MC.CN_N) * MC.CN_W + q + MC.CN_N) * 2);
// The tick into play the rim takes the tile at cell a (0 no tile, CN_NEVER never).
export const dropOf = (view, a) => (a < 0 ? 0 : view.dv.getUint16(TILE0 + a, true));
// Does the tile at cell a hold tp ticks into play? As $cn_ground has it.
export const holds = (view, a, tp) => a >= 0 && tp < dropOf(view, a);
// The tile cell under (x, z), in doubles (steering never minds a point right on an edge picking its neighbour).
export function cellAt(x, z, cx) {
  const u = (x - cx) / MC.CN_S, w = (z - cx) / MC.CN_S;
  const fq = u * 0.5773502691896258 - w / 3, fr = w * 0.6666666666666666, fs = -fq - fr;
  let q = Math.round(fq), r = Math.round(fr);
  const s = Math.round(fs), dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return cellOf(q, r);
}

// The round's stage on the view's bank: its radius, centre, cannons, tiles
// and the schedule's shots (flat arrays by record), read once a round (and
// again when asked `again`). Setup lays it all from the seed, the round and
// the radius, so those and the header's counts say when the countdown has
// laid it out again (for a crowd of another size).
let memo = null;
export function stage(view, again = false) {
  const dv = view.dv, o = view.bank || 0;
  const r0 = dv.getFloat32(L.PG_H + MC.CN_RAD + o, true), cx = dv.getFloat32(L.PG_CX + o, true);
  const seed = dv.getUint32(L.HDR_SEED + o, true), hole = dv.getUint32(L.HDR_HOLE + o, true), state = dv.getUint32(L.HDR_STATE + o, true);
  const ns = Math.min(dv.getUint32(L.PG_H + MC.CN_NS + o, true), MC.CN_NMAX);
  const fixed = state === L.H_PLAY || state === L.H_OVER;
  const nc = Math.min(dv.getUint32(L.PG_H + MC.CN_NC + o, true), MC.CN_NCMAX), rot = dv.getUint32(L.PG_H + MC.CN_ROT + o, true);
  const m = memo;
  if (!again && m && m.r0 === r0 && m.cx === cx && m.seed === seed && m.hole === hole && m.ns === ns && m.nc === nc && m.rot === rot) return m;
  const ring = dv.getFloat32(L.PG_H + MC.CN_RC + o, true);
  const s = {
    r0, cx, seed, hole, ns, nc, rot, ring, fixed, tiles: [], cannons: [],
    tf: new Int32Array(ns), tt: new Int32Array(ns), te: new Int32Array(ns), can: new Uint8Array(ns), fl: new Uint8Array(ns), vol: new Uint16Array(ns),
    mx: new Float64Array(ns), mz: new Float64Array(ns), ux: new Float64Array(ns), uz: new Float64Array(ns), st: new Float64Array(ns), sout: new Float64Array(ns),
    v: new Float64Array(ns), rc: new Float64Array(ns), arc: new Float64Array(ns), n: new Uint8Array(ns), b: new Float64Array(ns), ww: new Float64Array(ns),
    lo: new Uint16Array(MC.CN_NB), hi: new Uint16Array(MC.CN_NB), byCannon: [],
  };
  if (r0 > 0) {
    for (let r = -MC.CN_N; r <= MC.CN_N; r++) for (let q = -MC.CN_N; q <= MC.CN_N; q++) {
      const a = cellOf(q, r);
      const drop = dropOf(view, a);
      if (!drop) continue;
      const [x, z] = hexCentre(q, r, S, cx);
      const rho = Math.hypot(x - cx, z - cx);
      const band = Math.floor(rho / BAND) & 1;
      s.tiles.push({ q, r, a, x, z, rho, drop, wob: ((q * 7 + r * 13) & 15) / 16, rgb: rho <= MC.CN_RMIN ? CORE[band] : RINGS[band] });
    }
    for (let c = 0; c < nc; c++) {
      const ang = (((rot + Math.floor((c * 16384) / nc)) & 16383) / 16384) * 2 * Math.PI;
      s.cannons.push({ c, x: cx + Math.cos(ang) * ring, z: cx + Math.sin(ang) * ring, home: ang + Math.PI });
      s.byCannon.push([]);
    }
  }
  for (let k = 0; k < ns; k++) {
    const a = SHOT0 + k * MC.CN_REC;
    s.tf[k] = dv.getUint32(a, true); s.te[k] = dv.getUint32(a + 4, true); s.tt[k] = dv.getUint32(a + 24, true);
    s.ux[k] = dv.getFloat32(a + 8, true); s.uz[k] = dv.getFloat32(a + 12, true); s.rc[k] = dv.getFloat32(a + 20, true);
    s.mx[k] = dv.getFloat32(a + 28, true); s.mz[k] = dv.getFloat32(a + 32, true);
    s.st[k] = dv.getFloat32(a + 36, true); s.sout[k] = dv.getFloat32(a + 40, true); s.v[k] = dv.getFloat32(a + 44, true);
    s.arc[k] = dv.getFloat32(a + 48, true); s.n[k] = dv.getUint32(a + 56, true);
    s.can[k] = view.u8[a + 60]; s.fl[k] = view.u8[a + 61]; s.vol[k] = dv.getUint16(a + 62, true);
    const wx = s.mx[k] - cx, wz = s.mz[k] - cx;
    s.b[k] = wx * s.ux[k] + wz * s.uz[k]; s.ww[k] = wx * wx + wz * wz;
    s.byCannon[s.can[k]]?.push(k);
  }
  for (let b = 0; b < MC.CN_NB; b++) { s.lo[b] = dv.getUint16(L.PG_BIG + MC.CN_LO + 2 * b, true); s.hi[b] = dv.getUint16(L.PG_BIG + MC.CN_HI + 2 * b, true); }
  memo = s;
  return s;
}
// The shots whose records may matter from tick ta to tb into play: [k0, k1).
export function span(s, ta, tb) {
  const b0 = Math.max(0, Math.min(MC.CN_NB - 1, Math.floor(ta / MC.CN_BUCKET))), b1 = Math.max(0, Math.min(MC.CN_NB - 1, Math.floor(tb / MC.CN_BUCKET)));
  return [s.lo[b0], s.hi[b1]];
}
// Shot k on tick tp into play (fractional: drawn between ticks), as $cn_at
// has it: into out { a (along its line from the muzzle), x, y, z, phase: -1
// not fired, 0 flying, 1 rolling, 2 past the far rim, falling }.
const SH = { a: 0, x: 0, y: 0, z: 0, phase: -1 };
export function shotAt(s, k, tp, out = SH) {
  const tf = s.tf[k], tt = s.tt[k], te = s.te[k], rc = s.rc[k];
  if (tp < tf) { out.phase = -1; out.a = 0; out.y = PLAT_Y + MC.CN_MZY; }
  else if (tp < tt) {
    const u = (tp - tf) / (tt - tf);
    out.phase = 0; out.a = s.st[k] * u;
    out.y = PLAT_Y + MC.CN_MZY + (rc - MC.CN_MZY) * u + 4 * s.arc[k] * u * (1 - u);
  } else {
    out.a = s.st[k] + (tp - tt) * s.v[k] * TICK;
    if (tp < te) { out.phase = 1; out.y = PLAT_Y + rc; } else { const e = (tp - te) * TICK; out.phase = 2; out.y = PLAT_Y + rc - 0.5 * MC.CN_G * e * e; }
  }
  out.x = s.mx[k] + s.ux[k] * out.a;
  out.z = s.mz[k] + s.uz[k] * out.a;
  return out;
}
// How far along shot k's line from its muzzle it crosses a rim of radius R
// on the far side (where its stripe ends), or its own exit if that's sooner.
const farCross = (s, k, R) => Math.min(s.sout[k], -s.b[k] + Math.sqrt(Math.max(0, s.b[k] * s.b[k] - (s.ww[k] - R * R))));
// The tick (HDR_TICK's count, fractional) to draw at, and ticks into play then; frozen where the round ended.
function clock(view, ctx) {
  const g = view.party();
  let now = ctx?.ptick ?? (g.tick + (ctx?.dt || 0) / TICK);
  if (g.state === L.H_OVER) now = Math.min(now, (g.until - L.P_OVER) | 0);
  // ticks into play as the sim counts them (its i32 subtraction wraps), and the fraction past
  const tp = g.state === L.H_PLAY || g.state === L.H_OVER ? Math.max(0, ((now - g.start) | 0) + (now % 1)) : -1;
  return { g, now, tp };
}
// The volley on now (or next) on tick tp into play: { vol, n, fire (its first shot's tick), gap (to the one after) } or null.
export function volleyAt(s, tp) {
  let k = -1;
  for (let j = 0; j < s.ns; j++) if (s.fl[j] & 2) { if (s.tf[j] + MC.CN_STAG * (s.n[j] - 1) >= tp) { k = j; break; } }
  if (k < 0) return null;
  let next = -1;
  for (let j = k + 1; j < s.ns; j++) if (s.fl[j] & 2) { next = j; break; }
  return { vol: s.vol[k], n: s.n[k], fire: s.tf[k], gap: next >= 0 ? s.tf[next] - s.tf[k] : 0 };
}

// ---- drawing

const shade = (rgb, to, k) => [rgb[0] + (to[0] - rgb[0]) * k, rgb[1] + (to[1] - rgb[1]) * k, rgb[2] + (to[2] - rgb[2]) * k];
function tile(sc, x, y, z, yaw, rgb, look = LOOK.MATTE, a = 0, b = 0, alpha = 1) {
  sc.hex(x, y, z, S * DRAWN, HH, yaw, rgb[0], rgb[1], rgb[2], look, a, b, alpha);
}
const wrapA = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

// A cannon on tick tp into play: its post out of the sea, its drum, and the
// barrel turned onto its lane (eased from the last over AIM ticks as the next
// shows), glowing at the muzzle as it nears firing, kicked back as it fires.
function cannon(sc, out, s, can, tp, now) {
  const list = s.byCannon[can.c] || [];
  let cur = -1, prev = -1, fired = -1;
  for (const k of list) {
    if (s.tf[k] - MC.CN_TELE <= tp) { prev = cur; cur = k; }
    if (s.tf[k] <= tp) fired = k;
  }
  const head = (k) => (k < 0 ? can.home : Math.atan2(s.uz[k], s.ux[k]));
  let yaw = head(cur);
  if (cur >= 0) {
    const u = Math.min(1, (tp - (s.tf[cur] - MC.CN_TELE)) / AIM), a0 = head(prev);
    yaw = a0 + wrapA(yaw - a0) * (u * u * (3 - 2 * u));
  }
  const rc = cur >= 0 ? s.rc[cur] : MC.CN_RC0;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const top = PLAT_Y - 0.5;
  sc.cyl(can.x, top / 2, can.z, 1.6, top / 2, ...STONE, LOOK.MATTE);
  sc.cyl(can.x, top - 0.25, can.z, 2.9, 0.25, ...STONE, LOOK.MATTE);
  sc.cyl(can.x, PLAT_Y + 0.55, can.z, 2.3, 0.8, ...IRON, LOOK.METAL);
  const kick = fired >= 0 && tp - s.tf[fired] < 40 ? 0.7 * (1 - (tp - s.tf[fired]) / 40) : 0;
  const bore = rc * 0.8 + 0.35, len = MC.CN_BARREL + 1.7, back = 1.7 + kick;
  const bx = can.x + cy * (len / 2 - back), bz = can.z + sy * (len / 2 - back), by = PLAT_Y + MC.CN_MZY;
  sc.box(bx, by, bz, len / 2, bore, bore, yaw, ...IRON, LOOK.METAL);
  const mx = can.x + cy * (MC.CN_BARREL - kick), mz = can.z + sy * (MC.CN_BARREL - kick);
  sc.box(mx - cy * 0.25, by, mz - sy * 0.25, 0.25, bore + 0.2, bore + 0.2, yaw, ...BRONZE, LOOK.METAL);
  sc.box(can.x - cy * (back - 0.3), by, can.z - sy * (back - 0.3), 0.3, bore + 0.12, bore + 0.12, yaw, ...BRONZE, LOOK.METAL);
  sc.sphere(can.x - cy * back, by, can.z - sy * back, bore * 0.75, ...IRON, LOOK.METAL);
  // the bore: dark, hot as it nears firing
  if (cur >= 0 && tp < s.tf[cur]) {
    const u = Math.max(0, Math.min(1, (tp - (s.tf[cur] - MC.CN_TELE)) / MC.CN_TELE));
    const pulse = 0.75 + 0.25 * Math.sin(now * TICK * Math.PI * 2 * (2 + 6 * u));
    sc.sphere(mx + cy * 0.05, by, mz + sy * 0.05, rc * 0.8, 1, 0.3 + 0.4 * u, 0.1, LOOK.GLOW, (0.3 + 1.6 * u) * pulse, 0.4);
    out.glow.push({ pos: [mx + cy * 0.4, by, mz + sy * 0.4], size: 1.4 + 2.2 * u, color: [1, 0.35 + 0.3 * u, 0.1, (0.25 + 0.55 * u) * pulse], kind: SPRITE.FLASH, minpx: 2 });
  } else sc.sphere(mx + cy * 0.05, by, mz + sy * 0.05, rc * 0.8, 0.03, 0.03, 0.035, LOOK.MATTE);
}

// Shot k on tick tp: its stripe (shown CN_TELE before it fires, ahead of it
// as it rolls, to the rim as it stands), a lob's target ring, the ball, the
// muzzle's flash and smoke, and a splash as it hits the sea.
function shot(sc, out, s, k, tp, now) {
  const tf = s.tf[k], rc = s.rc[k], lob = s.fl[k] & 1;
  const yaw = Math.atan2(s.uz[k], s.ux[k]);
  const p = shotAt(s, k, tp, { a: 0, x: 0, y: 0, z: 0, phase: -1 });
  const rim = rimAt(s.r0, tp);
  // the stripe, by how soon the cannonball gets to each part of it: what it
  // reaches in the next second bright, in the next HOT2 s dimmer, the rest of
  // the lane faint, so a crowded floor still says which lanes are coming now
  if (p.phase < 2) {
    const a0 = Math.max(s.st[k], p.phase === 1 ? p.a : 0), a1 = farCross(s, k, rim + 0.5 * S);
    if (a1 > a0 + 0.2) {
      const u = Math.max(0, Math.min(1, (tp - (tf - MC.CN_TELE)) / MC.CN_TELE));
      const pulse = p.phase < 0 ? 0.8 + 0.2 * Math.sin(now * TICK * Math.PI * 2 * (1.5 + 4 * u)) : 1;
      const wait = p.phase < 1 ? Math.max(0, (s.tt[k] - tp) * TICK) : 0, front = p.phase === 1 ? p.a : s.st[k];
      const reach = (secs) => Math.min(a1, Math.max(a0, front + s.v[k] * (secs - wait)));
      const hot = reach(HOT1), warm = reach(HOT2);
      const band = (a, b, glow, alpha, w = rc, rgb = RED, y = PLAT_Y + 0.04) => {
        if (b - a < 0.05) return;
        const am = (a + b) / 2;
        sc.box(s.mx[k] + s.ux[k] * am, y, s.mz[k] + s.uz[k] * am, (b - a) / 2, 0.025, w, yaw, ...rgb, LOOK.GLOW, glow * pulse, w === rc ? 0.25 : 0, alpha);
      };
      band(a0, hot, 1.2, 0.62);
      band(hot, warm, 0.8, 0.36);
      band(warm, a1, 0.45 + 0.3 * u, 0.12 + 0.08 * u);
      // a brighter line down the middle of what's coming, the way it rolls
      band(a0, warm, 0.9, 0.5, 0.12, [1, 0.55, 0.3], PLAT_Y + 0.05);
    }
    if (lob && p.phase < 1) {
      const tx = s.mx[k] + s.ux[k] * s.st[k], tz = s.mz[k] + s.uz[k] * s.st[k];
      const u = p.phase === 0 ? (tp - tf) / (s.tt[k] - tf) : 0;
      out.decals?.push({ pos: [tx, PLAT_Y + 0.07, tz], radius: rc + 1.2, width: 0.3, color: [1, 0.3, 0.12, 0.6 + 0.35 * u], kind: DECAL.TARGET });
      if (p.phase === 0) out.decals?.push({ pos: [tx, PLAT_Y + 0.08, tz], radius: Math.max(0.6, (rc + 1.2) * 2.2 * (1 - u)), width: 0.25, color: [1, 0.9, 0.7, 0.4 + 0.5 * u], kind: DECAL.RING });
    }
  }
  if (p.phase < 0) return;
  // the ball, down to the sea
  if (p.y > -rc) {
    sc.sphere(p.x, p.y, p.z, rc, ...IRON, LOOK.METAL, 0, 0, 1, k & 4095);
    out.casters?.push([p.x, p.y, p.z, -rc]);
  }
  // a lob's thump as it lands
  if (lob && tp >= s.tt[k] && tp - s.tt[k] < 50) {
    const u = (tp - s.tt[k]) / 50;
    const tx = s.mx[k] + s.ux[k] * s.st[k], tz = s.mz[k] + s.uz[k] * s.st[k];
    out.decals?.push({ pos: [tx, PLAT_Y + 0.07, tz], radius: rc + 0.5 + 4 * u, width: 0.5, color: [0.9, 0.8, 0.65, 0.8 * (1 - u)], kind: DECAL.RING });
  }
  // the muzzle's flash, then smoke rolling out of it and rising
  const age = tp - tf;
  if (age < SMOKE) {
    const mx = s.mx[k], mz = s.mz[k], my = PLAT_Y + MC.CN_MZY;
    if (age < 16) out.glow.push({ pos: [mx + s.ux[k] * 0.8, my, mz + s.uz[k] * 0.8], size: 2.5 + rc * 1.6, color: [1, 0.85 - age * 0.02, 0.5, 1 - age / 16], kind: SPRITE.FLASH, minpx: 2 });
    for (let i = 0; i < 3; i++) {
      const u = age / SMOKE, d = (0.6 + i * 1.1) * (0.4 + 0.6 * Math.sqrt(u));
      const side = (((k * 5 + i * 3) % 7) - 3) * 0.25 * u;
      sc.sphere(mx + s.ux[k] * d - s.uz[k] * side, my + 0.4 + 2.2 * u + i * 0.3, mz + s.uz[k] * d + s.ux[k] * side, (0.9 + 0.5 * rc) * (0.5 + 1.1 * u),
        0.72, 0.7, 0.68, LOOK.MATTE, 0, 0, 0.55 * (1 - u) * (1 - u), (k * 3 + i) & 4095);
    }
  }
  // into the sea
  if (p.phase === 2 && p.y < 2 && p.y > -6) {
    const u = Math.min(1, (2 - p.y) / 8);
    out.glow.push({ pos: [p.x, 1, p.z], size: rc * (2 + 2 * u), color: [0.85, 0.92, 1, 0.7 * (1 - u)], kind: SPRITE.FLASH, minpx: 2 });
  }
}

// ---- the AI ball

// The shots it can see on tick `t` into play, seen by tick `seen` into play
// (their stripes shown by then): those not yet past, by record.
function shown(s, seen, t) {
  const [k0, k1] = span(s, Math.max(0, t - 40), seen + MC.CN_TELE);
  const out = [];
  for (let k = k0; k < k1; k++) if (s.tf[k] - MC.CN_TELE <= seen && t < s.te[k] + MC.CN_FALLT) out.push(k);
  return out;
}
// how long after a stripe shows each AI ball notices it, by slot (its goal() sets it from its skill)
const REACT = new Uint8Array(L.NPLAYER).fill(20);
// what each ball's last think kept of the shots near it: { at (view tick), x, z, list }
const NEAR = [];
// The shots near (x, z) (lanes within reach) that ball slot can see, from the
// view's tick: kept a think (the planner asks 90 times round one spot) for
// points within NEAR_R of the first. A lane within NEAR_LANE of that one is
// within NEAR_LANE - NEAR_R of any of them: past what danger() looks for
// (rc + RB + 0.95) and what goal()'s ring of candidates 11 m out does (rc + RB
// + 1.6 from 11 m).
const NEAR_R = 10, NEAR_LANE = 13;
function nearShots(view, s, slot, x, z) {
  const g = view.party();
  const c = slot >= 0 ? NEAR[slot] : null;
  if (c && c.at === view.tick && c.bank === view.bank && (c.x - x) * (c.x - x) + (c.z - z) * (c.z - z) < NEAR_R * NEAR_R) return c.list;
  const t = g.t, seen = t - (slot >= 0 ? REACT[slot] : 20);
  const list = [];
  for (const k of shown(s, seen, t)) {
    const pe = (x - s.mx[k]) * s.uz[k] - (z - s.mz[k]) * s.ux[k];
    if (Math.abs(pe) < s.rc[k] + RB + NEAR_LANE) list.push(k);
  }
  if (slot >= 0) NEAR[slot] = { at: view.tick, bank: view.bank, x, z, list };
  return list;
}
const P = { a: 0, x: 0, y: 0, z: 0, phase: -1 };
// How bad being at (x, z) on tick t (HDR_TICK's count) is: a fall where no
// tile holds then; a cannonball there then; one coming down this lane soon;
// a little the rim coming in.
function danger(view, x, z, t, slot) {
  const g = view.party();
  if (g.state !== L.H_PLAY) return 0;
  const s = stage(view);
  const cx = s.cx, tp = (t - g.start) | 0;
  const drop = dropOf(view, cellAt(x, z, cx));
  if (tp >= drop) return 1;
  let d = drop - tp < 60 ? 0.7 : 0;
  for (const k of nearShots(view, s, slot, x, z)) {
    const wx = x - s.mx[k], wz = z - s.mz[k];
    const pe = Math.abs(wx * s.uz[k] - wz * s.ux[k]), rr = s.rc[k] + RB + 0.35;
    if (pe >= rr + 0.6) continue;
    const al = wx * s.ux[k] + wz * s.uz[k];
    const p = shotAt(s, k, tp, P);
    const side = Math.max(0, 1 - Math.max(0, pe - 0.4 * rr) / (rr + 0.6 - 0.4 * rr));
    if (p.phase >= 0 && Math.abs(p.y - PLAT_Y - RB) < rr && Math.abs(al - p.a) < rr) return Math.max(d, 0.75 + 0.25 * side);
    // coming: how soon its front gets here, rolling
    if (al + rr < s.st[k] || al - rr > s.sout[k]) continue;
    let eta;
    if (p.phase < 1) eta = (s.tt[k] - tp) * TICK + Math.max(0, al - rr - s.st[k]) / s.v[k];
    else eta = (al - rr - p.a) / s.v[k];
    if (eta < -0.05 || eta > 1.2) continue;
    d = Math.max(d, (0.35 + 0.4 * (1 - Math.max(0, eta) / 1.2)) * side);
  }
  const rho = Math.sqrt((x - cx) * (x - cx) + (z - cx) * (z - cx)), edge = rimAt(s.r0, tp + 90);
  if (rho > edge - 2.5) d = Math.max(d, 0.25 + 0.3 * Math.min(1, (rho - edge + 2.5) / 2.5));
  return d;
}
// How much the shots threaten (x, z) over the next 2.5 s from tick t into
// play, each by how near its lane runs and how soon it gets there.
function threat(s, list, x, z, t) {
  let sum = 0;
  for (const k of list) {
    const wx = x - s.mx[k], wz = z - s.mz[k];
    const rr = s.rc[k] + RB + 1.6;
    const pe = Math.abs(wx * s.uz[k] - wz * s.ux[k]);
    if (pe >= rr) continue;
    const al = wx * s.ux[k] + wz * s.uz[k];
    if (al + rr < s.st[k] || al - rr > s.sout[k]) continue;
    const p = shotAt(s, k, t, P);
    if (p.phase >= 1 && p.a > al + rr) continue; // gone by
    const eta = p.phase < 1 ? (s.tt[k] - t) * TICK + Math.max(0, al - s.st[k]) / s.v[k] : Math.max(0, al - p.a) / s.v[k];
    if (eta > 2.5) continue;
    sum += (1 - pe / rr) * (1.3 - eta / 2.5);
  }
  return sum;
}
// A ball as the brain is handed it: a slot or a record.
const slotOf = (me) => (typeof me === 'number' ? me : me?.slot ?? -1);
const CROWD = new Map(); // per view tick and bank: balls in by 3 m square
function crowdOf(view) {
  const key = view.bank;
  const c = CROWD.get(key);
  if (c && c.tick === view.tick) return c.grid;
  const grid = new Map();
  for (let p = 0; p < L.NPLAYER; p++) {
    const a = L.PLAYERS + view.bank + p * L.PSIZE;
    if ((view.u8[a + L.P_FL] & (L.PF_LIVE | L.PF_DEAD | L.PF_FALL)) !== L.PF_LIVE) continue;
    const k = Math.floor(view.dv.getFloat32(a + L.P_PX, true) / 3) * 4096 + Math.floor(view.dv.getFloat32(a + L.P_PZ, true) / 3);
    grid.set(k, (grid.get(k) || 0) + 1);
  }
  CROWD.set(key, { tick: view.tick, grid });
  return grid;
}
let lastBoom = -1e9; // ms, the last cannon heard
// The biggest cannonball a hop clears dead on: its top under the hop's peak
// (hop^2 / 2g, g 20 m/s^2), less a margin for the hop's timing.
export const hopClears = (hop) => (hop * hop) / 80 - 0.05;
// The ticks before going out a cannonball's hit (PG_M) still gets the credit:
// CN_SHARE to start falling, then the fall itself.
const BLAST = MC.CN_SHARE + 250;
const crowdAt = (grid, x, z) => grid.get(Math.floor(x / 3) * 4096 + Math.floor(z / 3)) || 0;

export default {
  id: L.MG_CANNON, key: 'cannon', name: 'CANNONADE',
  hint: 'CANNONS FIRE DOWN THE RED STRIPES  GET OUT OF THE LANES',
  rules: 'LAST ONE IN WINS  HOP A SMALL ONE  THE EDGE GOES AT 60 S',
  env: 'day',

  draw(view, ctx, out) {
    const s = stage(view);
    if (!(s.r0 > 0)) return;
    const { now, tp } = clock(view, ctx);
    const sc = out.scene;
    const y0 = PLAT_Y - HH;
    // the column the disc stands on, down into the sea
    sc.cyl(s.cx, PLAT_Y - 2 * HH - 22, s.cx, MC.CN_RMIN * 0.62, 22, 0.5, 0.46, 0.42, LOOK.MATTE);
    sc.cyl(s.cx, PLAT_Y - 2 * HH - 1.2, s.cx, MC.CN_RMIN * 0.9, 1.2, 0.56, 0.5, 0.45, LOOK.MATTE);
    for (const T of s.tiles) {
      if (tp < 0) { tile(sc, T.x, y0, T.z, 0, T.rgb); continue; }
      const left = T.drop - tp;
      if (left <= 0) {
        const a = -left * TICK;
        if (a < FALL) tile(sc, T.x, y0 - 0.5 * 30 * a * a, T.z, a * (T.wob - 0.5) * 3, shade(T.rgb, DOOM, 0.8), LOOK.MATTE, 0, 0, 1 - a / FALL);
        continue;
      }
      let rgb = T.rgb, dx = 0, dz = 0, dy = 0;
      if (left < WARN) {
        const k = 1 - left / WARN;
        rgb = shade(rgb, DOOM, 0.75 * k);
        dy = -0.12 * k;
        const sh = left < 60 ? 0.07 * (1 - left / 60) : 0;
        dx = sh * Math.sin(now * 2.3 + T.q * 5.1 + T.r * 2.7);
        dz = sh * Math.sin(now * 2.9 + T.q * 3.3 - T.r * 4.1);
      }
      tile(sc, T.x + dx, y0 + dy, T.z + dz, 0, rgb);
    }
    for (const can of s.cannons) cannon(sc, out, s, can, Math.max(0, tp), now);
    if (tp < 0) return;
    const [k0, k1] = span(s, tp - SEA, tp + MC.CN_TELE);
    for (let k = k0; k < k1; k++) {
      if (tp < s.tf[k] - MC.CN_TELE || tp > s.te[k] + SEA) continue;
      shot(sc, out, s, k, tp, now);
    }
  },

  // the disc as it stands
  frame(view) {
    const s = stage(view);
    const g = view.party();
    const r0 = s.r0 > 0 ? s.r0 : g.size;
    const tp = g.state === L.H_PLAY ? g.t : g.state === L.H_OVER ? Math.max(0, ((g.until - L.P_OVER) - g.start) | 0) : 0;
    return { centre: [s.cx || g.cx, PLAT_Y, s.cx || g.cx], radius: rimAt(r0, tp) + S, shape: 'disc' };
  },

  fx(fx, ctx) {
    const d = typeof ctx.dist === 'function' ? ctx.dist(fx.pos) : ctx.dist ?? 0;
    if (fx.kind === MC.CN_FX_FIRE) {
      // a volley's booms ripple round the ring, one heard every 70 ms at most
      const now = ctx.now ?? 0;
      if (d < 140 && !(now - lastBoom < 70)) { lastBoom = now; ctx.sound?.blast?.(d + 4, 6); }
    } else if (fx.kind === MC.CN_FX_HIT) {
      ctx.glow?.({ pos: fx.pos, size: 1.2 + fx.size * 0.06, color: [1, 0.75, 0.4, 0.9], kind: SPRITE.SPARK, life: 320 });
      ctx.glow?.({ pos: fx.pos, size: 1.5 + fx.size * 0.05, color: [1, 0.6, 0.3, 0.5], kind: SPRITE.FLASH, life: 260, grow: true });
      ctx.sound?.boing?.(Math.min(30, fx.size), fx.owner === ctx.slot ? 0 : d);
      if (fx.owner === ctx.slot && fx.size > 6) ctx.banner?.('CANNONBALL!', C.RED, 900);
    } else if (fx.kind === MC.CN_FX_LAND) {
      if (d < 90) ctx.sound?.land?.(Math.min(30, 600 / (d + 20)));
    } else if (fx.kind === MC.CN_FX_CALL) {
      if (fx.shot === 0x8001) ctx.banner?.('LOBBED SHOTS  KEEP OFF THE TARGET RINGS', C.ORANGE, 2200);
      else if (fx.shot === 0x8002) ctx.banner?.('THE RIM IS CRUMBLING  GET IN', C.ORANGE, 2200);
      else ctx.sound?.tick?.();
    }
  },

  // a ball out off a cannonball's knock (its PG_M, on the confirmed world)
  sink(f, name, view) {
    if (f.shot !== 255) return null;
    const m = view.dv.getUint32(L.PLAYERS + f.owner * L.PSIZE + L.PG_M, true);
    if (!(m & 0xffff)) return null;
    const out = (f.tick - view.party().start) | 0;
    return out - (m >>> 16) <= BLAST ? `${name(f.owner)} CANNONBALLED` : null;
  },

  // the volleys, the next turn of the round, and whether you're in a lane
  hud(view, ctx) {
    const g = view.party();
    if (g.state !== L.H_PLAY) return;
    const s = stage(view);
    if (!(s.r0 > 0)) return;
    const tp = g.t;
    const vo = volleyAt(s, tp);
    if (!vo || vo.vol === 0 && vo.fire - tp > MC.CN_TELE) ctx.right(3, 'CANNONS FIRE DOWN THE RED STRIPES', C.ORANGE);
    else ctx.right(3, `VOLLEY ${vo.vol + 1}  ${vo.n} ${vo.n === 1 ? 'SHOT' : 'SHOTS'}${vo.gap ? `  EVERY ${(vo.gap * TICK).toFixed(1)}S` : ''}`, C.GREY);
    if (tp < MC.CN_LOBFROM) ctx.right(4, `LOBS IN ${Math.ceil((MC.CN_LOBFROM - tp) * TICK)}S`, C.GREY);
    else if (tp < MC.CN_CRUMBLE) ctx.right(4, `THE RIM CRUMBLES IN ${Math.ceil((MC.CN_CRUMBLE - tp) * TICK)}S`, tp > MC.CN_CRUMBLE - 1250 ? C.ORANGE : C.GREY);
    else ctx.right(4, rimAt(s.r0, tp) > MC.CN_RMIN ? 'THE RIM IS CRUMBLING' : 'THE RIM HAS STOPPED AT 12 M', C.ORANGE);
    const me = ctx.me ?? (ctx.slot >= 0 ? view.partier(ctx.slot) : null);
    if (!me || !me.live || me.out || me.falling) return;
    const row = Math.max(3, Math.floor((ctx.rows || 40) * 0.18));
    // the soonest cannonball down a lane you're in
    let soon = Infinity, small = false;
    const clear = hopClears(view.dv.getFloat32(L.PG_HOP + (view.bank || 0), true));
    const [k0, k1] = span(s, tp, tp + MC.CN_TELE);
    for (let k = k0; k < k1; k++) {
      if (s.tf[k] - MC.CN_TELE > tp) continue;
      const wx = me.pos[0] - s.mx[k], wz = me.pos[2] - s.mz[k];
      const rr = s.rc[k] + RB;
      if (Math.abs(wx * s.uz[k] - wz * s.ux[k]) >= rr) continue;
      const al = wx * s.ux[k] + wz * s.uz[k];
      if (al + rr < s.st[k] || al - rr > s.sout[k]) continue;
      const p = shotAt(s, k, tp, P);
      if (p.phase >= 1 && p.a > al + rr) continue;
      const eta = p.phase < 1 ? (s.tt[k] - tp) * TICK + Math.max(0, al - rr - s.st[k]) / s.v[k] : Math.max(0, al - rr - p.a) / s.v[k];
      if (eta < soon) { soon = eta; small = s.rc[k] <= clear; }
    }
    if (soon < 3) ctx.centre(row, `CANNONBALL  ${small ? 'HOP IT OR MOVE' : 'MOVE!'}  ${soon.toFixed(1)}`, soon < 1 ? C.RED : C.ORANGE);
    else {
      const a = cellAt(me.pos[0], me.pos[2], s.cx);
      if (a >= 0 && dropOf(view, a) - tp < WARN) ctx.centre(row, 'THE EDGE IS GOING  GET IN', C.ORANGE);
    }
  },

  brain: {
    danger(view, x, z, tick, me) { return danger(view, x, z, tick, slotOf(me)); },

    // Somewhere near no shot it has seen comes down soon, in off the rim as
    // it will be, on floor that holds, out of the crowd's thick; kept (in
    // bot.mem) unless somewhere is clearly better.
    goal(view, me, bot) {
      const g = view.party();
      const slot = slotOf(me);
      if (g.state !== L.H_PLAY || slot < 0) return null;
      const s = stage(view);
      const skill = bot?.skill ?? 0.6;
      REACT[slot] = Math.round(10 + 40 * (1 - skill));
      const b = typeof me === 'number' ? view.partier(me) : me;
      const x0 = bot?.pos?.[0] ?? b.pos[0], z0 = bot?.pos?.[1] ?? b.pos[2];
      const t = ((bot?.at ?? view.tick) - g.start) | 0, cx = s.cx;
      const edge = rimAt(s.r0, t + 250);
      const list = nearShots(view, s, slot, x0, z0);
      const grid = crowdOf(view);
      const score = (x, z) => {
        const rho = Math.hypot(x - cx, z - cx);
        let v = 3 * threat(s, list, x, z, t) + 0.05 * Math.hypot(x - x0, z - z0) + 0.025 * rho + 0.3 * crowdAt(grid, x, z);
        if (rho > edge - 4) v += 2 + (rho - edge + 4);
        if (!holds(view, cellAt(x, z, cx), t + 90)) v += 6;
        return v;
      };
      const mem = bot?.mem || {};
      let best = null, bs = Infinity;
      if (mem.cn) { bs = score(mem.cn[0], mem.cn[1]) - 0.4; best = mem.cn; }
      const cand = [[x0, z0], [cx, cx]];
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * 2 * Math.PI + (bot?.rand ? bot.rand() * 0.5 : 0);
        for (const r of [3.5, 7, 11]) cand.push([x0 + Math.cos(a) * r, z0 + Math.sin(a) * r]);
      }
      for (const [x, z] of cand) {
        const v = score(x, z);
        if (v < bs) { bs = v; best = [x, z]; }
      }
      mem.cn = best;
      return best;
    },

    // a small cannonball about to roll into it that a hop now clears (and
    // that standing still would not): over it
    hop(view, me, bot) {
      const b = typeof me === 'number' ? view.partier(me) : me;
      if (!b || !b.ground || b.out || b.falling) return false;
      const g = view.party();
      if (g.state !== L.H_PLAY) return false;
      const s = stage(view);
      const slot = slotOf(me);
      const x0 = bot?.pos?.[0] ?? b.pos[0], z0 = bot?.pos?.[1] ?? b.pos[2];
      const vx = bot?.vel?.[0] ?? b.vel[0], vz = bot?.vel?.[1] ?? b.vel[2];
      const t = ((bot?.at ?? view.tick) - g.start) | 0;
      const hopV = view.dv.getFloat32(L.PG_HOP + view.bank, true);
      if (!(hopV > 0)) return false;
      const air = (2 * hopV) / 20;
      const q = { a: 0, x: 0, y: 0, z: 0, phase: -1 };
      let want = false;
      for (const k of nearShots(view, s, slot, x0, z0)) {
        const rr = s.rc[k] + RB;
        // would it meet the ball where it is, in the next 0.6 s, staying put?
        let meets = false, clears = true;
        for (let i = 0; i <= 15 && !meets; i++) {
          const tau = i * 0.04;
          const p = shotAt(s, k, t + tau / TICK, q);
          if (p.phase < 0) continue;
          const dx = p.x - (x0 + vx * tau), dz = p.z - (z0 + vz * tau), dy = p.y - (PLAT_Y + RB);
          if (dx * dx + dz * dz + dy * dy < rr * rr) meets = true;
        }
        if (!meets) continue;
        // and hopping now: up at hopV, coming down over the air time
        for (let i = 0; i <= 30 && clears; i++) {
          const tau = (i / 30) * (air + 0.15);
          const h = Math.max(0, hopV * tau - 10 * tau * tau);
          const p = shotAt(s, k, t + tau / TICK, q);
          if (p.phase < 0) continue;
          const dx = p.x - (x0 + vx * tau), dz = p.z - (z0 + vz * tau), dy = p.y - (PLAT_Y + RB + h);
          if (dx * dx + dz * dz + dy * dy < (rr + 0.15) * (rr + 0.15)) clears = false;
        }
        if (!clears) return false;
        want = true;
      }
      if (!want) return false;
      // and somewhere to come down
      return holds(view, cellAt(x0 + vx * air, z0 + vz * air, s.cx), t + Math.round(air / TICK));
    },
  },
};
