// FRUIT CHUTE, as drawn and as the AI ball sees it. The belt is slats of
// dark rubber stepping up the slope, every fifth one yellow, all of them
// sliding down at the belt's speed; foam walls down both sides; a red
// dispenser across its top whose hatch over a lane lights, and a lamp on its
// face takes the fruit's colour, the second before a fruit drops there (all
// of them but the gap before a wave); the fruit as big glossy spheres rolling
// down, a leaf turning with them, bursting into juice on the grate above the
// foot. Past the line, a gold pen where the finishers bounce in the order
// they came. Every fruit is the sim's schedule (src/mg/chute.wat, in PG_BIG)
// worked forward to the frame's tick, so what is drawn and what the bots
// dodge is what the sim does.
import * as L from '../../src/layout.mjs';
import { PLAT_Y } from '../../src/party-view.mjs';
import { LOOK, SPRITE, DECAL } from '../party-render.mjs';
import { C } from '../font.mjs';

const TICK = 0.008;
const RB = 1; // a ball's radius
const TOP = PLAT_Y + L.FC_RISE;
const SLAT = 0.5; // m of belt a slat
const WALL_H = 1.8; // m a wall stands over the floor
const GANTRY = 6.8; // m from the belt's top at the dispenser to the gantry's middle: its underside just over a fruit's first drop
const BURST = 0.5; // s a fruit's juice is drawn after it bursts

// The fruit by kind, as the sim's constants have them, and how they look.
export const KINDS = [
  { name: 'GRAPE', r: L.FC_R_GRAPE, v: L.FC_V_GRAPE, rgb: [0.52, 0.2, 0.76], leaf: [0.32, 0.62, 0.16], look: LOOK.PLASTIC },
  { name: 'APPLE', r: L.FC_R_APPLE, v: L.FC_V_APPLE, rgb: [0.9, 0.14, 0.1], leaf: [0.34, 0.7, 0.16], look: LOOK.PLASTIC },
  { name: 'ORANGE', r: L.FC_R_ORANGE, v: L.FC_V_ORANGE, rgb: [1, 0.52, 0.05], leaf: [0.26, 0.58, 0.14], look: LOOK.PLASTIC },
  { name: 'MELON', r: L.FC_R_MELON, v: L.FC_V_MELON, rgb: [0.2, 0.6, 0.2], leaf: null, look: LOOK.HAZARD },
];
const JUICE = [[0.7, 0.3, 0.95], [1, 0.3, 0.25], [1, 0.7, 0.2], [1, 0.35, 0.4]];

// ---- the chute: its header and its schedule, read once a round

let memo = null;
// This round's chute on the view's bank (PG_H) and the fruit schedule (PG_BIG,
// the confirmed world's): re-read while the countdown may still lay it again.
export function stage(view) {
  const dv = view.dv, o = view.bank || 0;
  const hf = (k) => dv.getFloat32(L.PG_H + k + o, true), hu = (k) => dv.getUint32(L.PG_H + k + o, true);
  const seed = dv.getUint32(L.HDR_SEED + o, true), hole = dv.getUint32(L.HDR_HOLE + o, true), state = dv.getUint32(L.HDR_STATE + o, true);
  const nf = Math.min(hu(L.FC_NF), L.FC_NMAX), hw = hf(L.FC_HW), start = dv.getUint32(L.HDR_START + o, true);
  const m = memo;
  if (m && m.seed === seed && m.hole === hole && m.nf === nf && m.hw === hw && (state === L.H_PLAY || state === L.H_OVER) && m.fixed) { m.start = start; return m; }
  const cx = dv.getFloat32(L.PG_CX + o, true);
  const s = {
    seed, hole, nf, hw, cx, start, fixed: state === L.H_PLAY || state === L.H_OVER,
    x0: hf(L.FC_X0), xt: hf(L.FC_XT), xb: hf(L.FC_XB), xe: hf(L.FC_XE), nl: hu(L.FC_NL), cols: hu(L.FC_COLS) || 1,
    lz0: hf(L.FC_LZ0), lsp: hf(L.FC_LSP),
    z: new Float32Array(nf), r: new Float32Array(nf), v: new Float32Array(nf), t0: new Int32Array(nf), kind: new Uint8Array(nf), wave: new Uint8Array(nf),
    idx: new Int32Array(L.FC_NB), gaps: [],
  };
  s.xd = s.xt - L.FC_DROPX;
  s.xg = s.x0 + L.FC_GRATE;
  s.yd = surf(s, s.xd);
  for (let k = 0; k < nf; k++) {
    const a = L.PG_BIG + L.FC_FRUIT + k * L.FC_REC;
    s.z[k] = dv.getFloat32(a, true); s.r[k] = dv.getFloat32(a + 4, true); s.v[k] = dv.getFloat32(a + 8, true);
    s.t0[k] = dv.getUint16(a + 12, true); s.kind[k] = dv.getUint8(a + 14); s.wave[k] = dv.getUint8(a + 15);
  }
  for (let b = 0; b < L.FC_NB; b++) s.idx[b] = dv.getUint16(L.PG_BIG + L.FC_IDX + 2 * b, true);
  for (let w = 0; w < L.FC_WAVES; w++) s.gaps.push(view.u8[L.PG_S + L.FC_GAPS + w]);
  s.gl = s.nl >= L.FC_GAP2 ? 2 : 1;
  memo = s;
  return s;
}
// The floor's top at x ($fc_surf).
export const surf = (s, x) => PLAT_Y + Math.min(Math.max(x - s.x0, 0), L.FC_RUN) * L.FC_SLOPE;
export const laneZ = (s, l) => s.lz0 + l * s.lsp;
// The fruit out on tick tt of the schedule's clock (fractional: drawn
// between ticks): the window the buckets give.
function window(s, tt) {
  const b = Math.max(0, Math.floor(tt / L.FC_BUCKET));
  const k0 = tt > L.FC_LIFE ? s.idx[Math.min(L.FC_NB - 1, Math.floor((tt - L.FC_LIFE) / L.FC_BUCKET))] : 0;
  return [k0, s.idx[Math.min(L.FC_NB - 1, b + 1)] ?? s.nf];
}
// Fruit k on tick tt of the schedule's clock, as $fc_push has it: into out
// (x, y, z, vx, the distance rolled, the phase: 0 dropping, 1 rolling), or
// false if it isn't out (not dropped yet, or burst on the grate: then
// out.burst is the seconds since).
const F = { x: 0, y: 0, z: 0, vx: 0, rolled: 0, phase: 0, burst: -1 };
export function fruitAt(s, k, tt, out = F) {
  const age = tt - s.t0[k];
  out.burst = -1;
  if (age < 0) return false;
  const r = s.r[k];
  out.z = s.z[k];
  if (age < L.FC_DROPT) {
    const u = age / L.FC_DROPT;
    out.x = s.xd; out.vx = 0; out.rolled = 0; out.phase = 0;
    out.y = s.yd + r + L.FC_DROPH * (1 - u * u);
    return true;
  }
  const e = age - L.FC_DROPT, v = s.v[k];
  out.x = s.xd - e * v * TICK;
  if (out.x <= s.xg) { out.burst = (s.xg - out.x) / v; return false; }
  out.vx = -v; out.rolled = e * v * TICK; out.phase = 1;
  out.y = surf(s, out.x) + r;
  if (s.kind[k] === L.FC_ORANGE) { const p = (e % L.FC_HOPT) / L.FC_HOPT; out.y += 4 * L.FC_HOPH * p * (1 - p); }
  return true;
}
// The schedule's clock to draw at (fractional), on the prediction's where
// there is one, a tick back (the move that put your ball where it's drawn met
// the fruit a tick before): from the countdown's start, so the fruit roll
// through the title card; frozen where the round ended through the result;
// -1 with the room idle.
function schedTicks(view, g, ctx) {
  if (g.state === L.H_COUNT) return Math.max(0, L.FC_PRE - (g.until - g.tick) + (ctx?.dt || 0) / TICK);
  if (g.state !== L.H_PLAY && g.state !== L.H_OVER) return -1;
  let t = typeof ctx?.pt === 'number' && ctx.pt > 0 ? ctx.pt / TICK : typeof ctx?.t === 'number' && ctx.t > 0 ? ctx.t / TICK : g.t + (ctx?.dt || 0) / TICK;
  if (g.state === L.H_OVER) t = Math.min(t, (g.until - L.P_OVER - g.start) | 0);
  return Math.max(0, t - 1) + L.FC_PRE;
}
// Where slot p stands: racing (place 0) or over the line (its order), from the confirmed world.
const finOf = (view, p) => { const m = view.dv.getUint32(L.PLAYERS + p * L.PSIZE + L.PG_M, true); return m & L.FC_M_FIN ? m & 0xffff : 0; };
// The next wave on tick t into play: its index, the tick it drops; null past the last.
function nextWave(t) {
  const w = Math.max(0, Math.ceil((t - L.FC_WAVE0) / L.FC_WAVEI));
  const at = L.FC_WAVE0 + w * L.FC_WAVEI;
  return w < L.FC_WAVES && at < L.FC_LEN ? { w, at } : null;
}
const sideOf = (s, l, gl) => { const z = laneZ(s, l + (gl - 1) / 2) - s.cx; return z > s.hw / 3 ? 'RIGHT' : z < -s.hw / 3 ? 'LEFT' : 'MIDDLE'; };
const ordinal = (n) => `${n}${[, 'ST', 'ND', 'RD'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'TH'}`;
const slotColor = (s) => { const h = (s * 0.618034) % 1; return [0, 0.33, 0.67].map((o) => 0.55 + 0.4 * Math.cos(6.2832 * (h + o))); };

// ---- the AI ball

// Fruit out on tick t of the schedule's clock, worked once a tick for every
// ball that asks: x now, z, reach (its radius and a ball's), speed down, the
// ticks till it lands (0 rolling), its kind.
function fruitNow(s, t) {
  if (s.now?.t === t) return s.now.list;
  const list = [];
  const [k0, k1] = window(s, t);
  const o = { x: 0, y: 0, z: 0, vx: 0, rolled: 0, phase: 0, burst: -1 };
  for (let k = k0; k < k1; k++) {
    if (!fruitAt(s, k, t, o)) continue;
    list.push({ k, x: o.x, z: o.z, reach: s.r[k] + RB, v: s.v[k], land: o.phase ? 0 : L.FC_DROPT - (t - s.t0[k]), kind: s.kind[k] });
  }
  // and those about to drop, seen at the dispenser's hatch
  for (let k = k1; k < s.nf && s.t0[k] <= t + 90; k++) list.push({ k, x: s.xd, z: s.z[k], reach: s.r[k] + RB, v: s.v[k], land: L.FC_DROPT + s.t0[k] - t, kind: s.kind[k] });
  s.now = { t, list };
  return list;
}
// Balls in, by 4 m of x and 2 m of z, once a world tick.
function crowdOf(view, s) {
  if (s.crowd?.tick === view.tick && s.crowd.bank === view.bank) return s.crowd.grid;
  const grid = new Map();
  for (let p = 0; p < L.NPLAYER; p++) {
    const b = L.PLAYERS + view.bank + p * L.PSIZE;
    if ((view.u8[b + L.P_FL] & (L.PF_LIVE | L.PF_DEAD)) !== L.PF_LIVE) continue;
    const key = Math.floor(view.dv.getFloat32(b + L.P_PX, true) / 4) * 1024 + Math.floor(view.dv.getFloat32(b + L.P_PZ, true) / 2);
    grid.set(key, (grid.get(key) || 0) + 1);
  }
  s.crowd = { tick: view.tick, bank: view.bank, grid };
  return grid;
}
const MINDS = new WeakMap();
const SLOT_MINDS = [];
const mindOf = (bot, slot) => {
  if (bot && typeof bot === 'object') { let m = MINDS.get(bot); if (!m) MINDS.set(bot, (m = { zc: null, at: -1e9, yaw: 0 })); return m; }
  return (SLOT_MINDS[slot] ||= { zc: null, at: -1e9, yaw: 0 });
};

// What the ball wants on tick `tick` (the one its word is for), seen from a
// world `tick - view.tick` old: up the chute, across to the line up it that
// meets the least fruit, the soonest worst. It reckons its own x a tenth of a
// second at a time over its horizon two ways, climbing flat out or holding
// still over the ground against the belt; every fruit down its own (one
// dropping waits at the dispenser till it lands); where the two overlap in
// x, the ball sliding across at about 6 m/s from where it is to a line must
// be a reach (and a little) clear of the fruit across. Every lane, every gap
// between two and where it is now are scored so, each way, with the crowd up
// them and the way across; it keeps its last choice unless another is better.
const NS = 26, STEP = 0.1;
const CROWD = 0.3; // what a rival up a line costs it, against 4 for a fruit sure to hit
const SC = { xs: [new Float64Array(NS), new Float64Array(NS)], zs: new Float64Array(NS), hits: [], cand: new Float64Array(64) };
function plan(view, me, bot, tick) {
  const dv = view.dv, o = view.bank || 0;
  const slot = typeof me === 'number' ? me : me?.slot;
  if (dv.getUint32(L.HDR_STATE + o, true) !== L.H_PLAY || !(slot >= 0)) return null;
  const rb = L.PLAYERS + o + slot * L.PSIZE;
  if ((view.u8[rb + L.P_FL] & (L.PF_LIVE | L.PF_DEAD)) !== L.PF_LIVE) return null;
  const s = stage(view);
  if (!(s.hw > 0)) return null;
  const t = Math.max(0, (tick - dv.getUint32(L.HDR_START + o, true)) | 0), ts = t + L.FC_PRE;
  const skill = bot?.skill ?? 0.6;
  const lag = Math.max(0, Math.min(40, (tick - view.tick) | 0)) * TICK;
  const vx = dv.getFloat32(rb + L.P_VX, true), vz = dv.getFloat32(rb + L.P_VZ, true);
  const belt = (x) => (x >= s.x0 && x <= s.xt ? L.FC_BELT : 0);
  let x = dv.getFloat32(rb + L.P_PX, true), z = dv.getFloat32(rb + L.P_PZ, true);
  x += (vx - belt(x)) * lag; z += vz * lag;
  const mind = mindOf(bot, slot);
  const H = 1.2 + 1.3 * skill; // s it looks ahead
  const ns = Math.min(NS, Math.ceil(H / STEP) + 1);
  const react = Math.round((0.35 - 0.25 * skill) / TICK); // a fruit's hatch lit this lately it hasn't seen
  const side = 9 * (0.75 + 0.25 * skill); // m/s^2 it gets going sideways
  const zs = SC.zs;
  // its x each tenth of a second: flat out (10 m/s, drag 1.1/s), or holding against the belt
  const b0 = belt(x);
  for (let j = 0; j < ns; j++) {
    const tau = j * STEP, e = Math.exp(-1.1 * tau), e2 = Math.exp(-2 * tau);
    SC.xs[0][j] = x + 10 * tau - (10 - vx) * (1 - e) / 1.1 - b0 * tau;
    SC.xs[1][j] = x + b0 * tau - (b0 - vx) * (1 - e2) / 2 - b0 * tau;
  }
  // every fruit's overlaps in x with either way: [way, sample, its z, reach, weight]
  const hits = SC.hits;
  hits.length = 0;
  for (const F of fruitNow(s, ts)) {
    if (ts - s.t0[F.k] < react - 90) continue;
    if (F.x - x < -F.reach || F.x - x > (F.v + 10) * H + F.reach) continue;
    const land = F.land * TICK;
    const w0 = F.kind === L.FC_MELON ? 1.4 : F.kind === L.FC_ORANGE ? 0.8 : 1;
    for (let way = 0; way < 2; way++) {
      const xs = SC.xs[way];
      for (let j = 0; j < ns; j++) {
        const tau = j * STEP;
        const fx = tau < land ? F.x : F.x - F.v * (tau - land);
        if (fx <= s.xg) break; // burst at the grate
        if (Math.abs(fx - xs[j]) < F.reach) hits.push(way, j, F.z, F.reach, w0 * (1.2 - tau / H) ** 2, F.k);
      }
    }
  }
  // the lines up: every lane, between every two, where it is, its last choice
  const lo = s.cx - s.hw + RB + 0.3, hi = s.cx + s.hw - RB - 0.3;
  const cand = SC.cand;
  let nc = 0;
  cand[nc++] = z;
  for (let l = 0; l < s.nl && nc < 60; l++) { cand[nc++] = laneZ(s, l); if (l + 1 < s.nl) cand[nc++] = laneZ(s, l + 0.5); }
  if (mind.zc !== null) cand[nc++] = mind.zc;
  // a wave on its way down (or about to drop): its gap, wanted the more the nearer it is
  let gapZ = null, gapPull = 0;
  for (let w = 0; w < L.FC_WAVES; w++) {
    const at = L.FC_WAVE0 + w * L.FC_WAVEI;
    if (at >= L.FC_LEN || at > t + 125) break;
    const kind = w < L.FC_WAVEA ? L.FC_APPLE : L.FC_MELON, K = KINDS[kind];
    const age = t - at, fx = age < L.FC_DROPT ? s.xd : s.xd - (age - L.FC_DROPT) * K.v * TICK;
    if (fx <= s.x0 || fx < x - K.r - RB) continue;
    const eta = Math.max(0, fx - x - K.r) / (K.v + 6.5) + Math.max(0, L.FC_DROPT - age) * TICK;
    if (eta > 6) continue;
    gapZ = laneZ(s, s.gaps[w] + (s.gl - 1) / 2);
    gapPull = 3 * (1 - eta / 6) * (0.5 + 0.5 * skill);
    cand[nc++] = gapZ;
    break;
  }
  const grid = crowdOf(view, s);
  let best = Infinity, bestZ = z, bestWay = 0;
  for (let c = 0; c < nc; c++) {
    const zc = Math.max(lo, Math.min(hi, cand[c]));
    // the balls up this line, 8 m ahead and 1.5 m either side (not counting itself)
    let crowd = 0;
    const gx0 = Math.floor(x / 4), gx1 = Math.floor((x + 8) / 4), gz0 = Math.floor((zc - 1.5) / 2), gz1 = Math.floor((zc + 1.5) / 2);
    for (let i = gx0; i <= gx1; i++) for (let j = gz0; j <= gz1; j++) crowd += grid.get(i * 1024 + j) || 0;
    const mz = Math.floor(z / 2);
    if (mz >= gz0 && mz <= gz1) crowd--;
    // where across it gets each tenth: from its sideways speed now, pushing for zc at `side`, at most 7 m/s
    const sg = zc >= z ? 1 : -1, dist = Math.abs(zc - z), u0 = vz * sg, tc = Math.max(0, (7 - u0) / side);
    for (let j = 0; j < ns; j++) {
      const tau = j * STEP;
      const p = tau <= tc ? u0 * tau + 0.5 * side * tau * tau : u0 * tc + 0.5 * side * tc * tc + 7 * (tau - tc);
      zs[j] = z + sg * Math.min(dist, p);
    }
    for (let way = 0; way < 2; way++) {
      let risk = 0, last = -1;
      for (let i = 0; i < hits.length; i += 6) {
        if (hits[i] !== way || hits[i + 5] === last) continue;
        const zt = zs[hits[i + 1]];
        const clear = Math.abs(zt - hits[i + 2]) - hits[i + 3] - 0.35;
        if (clear < 0) { risk += hits[i + 4] * Math.min(1, 0.5 - clear / 1.5); last = hits[i + 5]; }
      }
      let score = risk * 4 + 0.08 * Math.abs(zc - z) + CROWD * crowd + (way ? 2 : 0);
      if (gapZ !== null) score += gapPull * Math.min(1, Math.abs(zc - gapZ) / (s.lsp * 0.75));
      if (mind.zc !== null && Math.abs(zc - mind.zc) < 0.5) score -= 0.5;
      score += ((Math.imul(slot + 1, 2654435761) ^ Math.imul(c * 2 + way + 1, 40503) ^ (t >> 7)) >>> 0) / 2 ** 32 * 0.3 * (1 - skill);
      if (score < best) { best = score; bestZ = zc; bestWay = way; }
    }
  }
  mind.zc = bestZ;
  // steer by the velocity it wants: up flat out (or holding still over the ground), across to the line
  const dz = bestZ - z;
  const wantX = bestWay ? b0 : 9;
  const wantZ = Math.max(-8, Math.min(8, dz * 2.4));
  let ax = bestWay ? wantX - vx : Math.max(0.3, wantX - vx + 2), az = wantZ - vz;
  if (x > s.xt - 1) { ax = 1; az = 0; }
  return { yaw: Math.atan2(az, ax), pos: [x, z], slot, way: bestWay };
}

// ---- drawing

// The belt's slats from foot to top, sliding down: a step of the slope each, every fifth yellow.
function belt(sc, s, tt) {
  const off = ((L.FC_BELT * tt * TICK) % (SLAT * 5) + SLAT * 5) % (SLAT * 5);
  const n = Math.ceil(L.FC_RUN / SLAT) + 1;
  const w = s.hw;
  for (let i = -1; i < n; i++) {
    const x = s.x0 + i * SLAT + SLAT / 2 - (off % SLAT);
    if (x < s.x0 - SLAT / 2 || x > s.xt + SLAT / 2) continue;
    const xc = Math.max(s.x0 + 0.25 * SLAT, Math.min(s.xt - 0.25 * SLAT, x));
    const y = surf(s, xc);
    const ring = (Math.round((x - s.x0 + off) / SLAT) % 5 + 5) % 5 === 0;
    const k = i & 1 ? 0.18 : 0.22;
    if (ring) sc.box(xc, y - 0.2, s.cx, SLAT * 0.46, 0.2, w, 0, 1, 0.78, 0.1, LOOK.PLASTIC, 0, 0, 1, i * 7 + 1);
    else sc.box(xc, y - 0.2, s.cx, SLAT * 0.46, 0.2, w, 0, k, k + 0.02, k + 0.06, LOOK.RUBBER, 0, 0, 1, i * 7 + 1);
  }
  // the frame under it and the legs down to the sea
  for (let x = s.x0; x < s.xt; x += 5) {
    const y = surf(s, x + 2.5);
    sc.box(x + 2.5, y - 1.4, s.cx, 2.5, 1, w + 0.8, 0, 0.32, 0.34, 0.4, LOOK.METAL);
  }
  for (let x = s.x0 + 10; x < s.xt; x += 20) {
    const y = surf(s, x) - 2.4;
    for (const side of [-1, 1]) sc.cyl(x, y / 2, s.cx + side * (w - 1.5), 0.9, y / 2, 0.75, 0.75, 0.8, LOOK.METAL);
  }
}

// The walls: foam panels down both sides, stepping up with the belt; round the catch floor and the pen.
function walls(sc, s) {
  const t = 0.35;
  const col = (i) => (i & 1 ? [0.96, 0.42, 0.72] : [0.62, 0.36, 0.95]);
  for (let x = s.x0, i = 0; x < s.xt; x += 4, i++) {
    const y = surf(s, x + 2);
    const c = col(i);
    for (const side of [-1, 1]) sc.box(x + 2, y + WALL_H / 2 - 0.6, s.cx + side * (s.hw + t), 1.98, WALL_H / 2 + 0.6, t, 0, ...c, LOOK.PLASTIC);
  }
  const flat = (xa, xb, y, c) => {
    const hx = (xb - xa) / 2;
    for (const side of [-1, 1]) sc.box(xa + hx, y + WALL_H / 2 - 0.6, s.cx + side * (s.hw + t), hx, WALL_H / 2 + 0.6, t, 0, ...c, LOOK.PLASTIC);
  };
  flat(s.xb - 2 * t, s.x0, PLAT_Y, [0.62, 0.36, 0.95]);
  flat(s.xt, s.xe + 2 * t, TOP, [1, 0.8, 0.2]);
  sc.box(s.xb - t, PLAT_Y + WALL_H / 2 - 0.6, s.cx, t, WALL_H / 2 + 0.6, s.hw + 2 * t, 0, 0.96, 0.42, 0.72, LOOK.PLASTIC);
  sc.box(s.xe + t, TOP + WALL_H / 2 - 0.6, s.cx, t, WALL_H / 2 + 0.6, s.hw + 2 * t, 0, 1, 0.8, 0.2, LOOK.PLASTIC);
}

// The dispenser over the belt's top: a gantry, and over each lane a hatch
// that lights, and a lamp on its face in the colour of the fruit, for the
// second before a fruit drops there.
function dispenser(sc, out, s, tt, now) {
  const y = s.yd + GANTRY;
  sc.box(s.xd, y, s.cx, 2.6, 1.6, s.hw + 1.2, 0, 1, 0.3, 0.24, LOOK.PLASTIC);
  sc.box(s.xd, y + 1.75, s.cx, 2.2, 0.15, s.hw + 1, 0, 1, 1, 1, LOOK.CHECKER, 1);
  sc.box(s.xd - 2.62, y + 0.9, s.cx, 0.04, 0.22, s.hw + 1.1, 0, 1, 0.85, 0.3, LOOK.GLOW, 0.7 + 0.2 * Math.sin(now / 250), 0.4);
  for (const side of [-1, 1]) sc.box(s.xd, (y + s.yd) / 2 - 0.5, s.cx + side * (s.hw + 0.9), 0.9, (y - s.yd) / 2 + 0.5, 0.5, 0, 0.92, 0.92, 0.95, LOOK.METAL);
  // what's due in each lane in the next second, and which kind
  const due = new Float32Array(s.nl).fill(1e9), kind = new Int8Array(s.nl).fill(-1);
  const [k0] = window(s, tt);
  for (let k = Math.max(0, k0); k < s.nf && s.t0[k] <= tt + 125; k++) {
    const l = Math.round((s.z[k] - s.lz0) / (s.lsp || 1));
    if (l >= 0 && l < s.nl && s.t0[k] + L.FC_DROPT * 0.5 > tt && s.t0[k] - tt < due[l]) { due[l] = s.t0[k] - tt; kind[l] = s.kind[k]; }
  }
  for (let l = 0; l < s.nl; l++) {
    const z = laneZ(s, l);
    const d = due[l];
    const lit = d < 125 ? (d < 0 ? 1 : 0.35 + 0.65 * (1 - d / 125) * (0.6 + 0.4 * Math.sin(now / 60))) : 0.08;
    sc.box(s.xd, y - 1.62, z, 1.7, 0.06, Math.min(1.7, s.lsp * 0.42), 0, 1, 0.85, 0.3, LOOK.GLOW, lit, 0.3);
    const rgb = kind[l] >= 0 ? KINDS[kind[l]].rgb : [0.4, 0.4, 0.45];
    sc.sphere(s.xd - 2.6, y - 0.4, z, 0.55, ...rgb, LOOK.GLOW, kind[l] >= 0 ? 0.4 + lit : 0.05);
    if (lit > 0.3) out.glow.push({ pos: [s.xd, y - 1.9, z], size: 2.4, color: [1, 0.8, 0.3, 0.5 * lit], kind: SPRITE.FLASH, minpx: 2 });
  }
}

// The finish: a chequered strip on the line, an arch over it, the pen's gold floor.
function finish(sc, out, s, now) {
  sc.box(s.xt + 0.6, TOP + 0.02, s.cx, 0.6, 0.04, s.hw, 0, 1, 1, 1, LOOK.CHECKER, 0.6);
  const h = 8;
  for (const side of [-1, 1]) sc.box(s.xt + 0.6, TOP + h / 2, s.cx + side * (s.hw + 0.9), 0.5, h / 2, 0.5, 0, 0.95, 0.95, 0.98, LOOK.PLASTIC);
  sc.box(s.xt + 0.6, TOP + h + 0.6, s.cx, 0.6, 0.6, s.hw + 1.4, 0, 1, 1, 1, LOOK.CHECKER, 0.6);
  sc.box(s.xt + 0.6, TOP + h - 0.2, s.cx, 0.2, 0.18, s.hw + 1.2, 0, 1, 0.85, 0.2, LOOK.GLOW, 0.8 + 0.3 * Math.sin(now / 300), 0.4);
  const len = s.xe - s.xt;
  sc.box(s.xt + len / 2, TOP - 1, s.cx, len / 2, 1, s.hw, 0, 1, 0.82, 0.28, LOOK.CHECKER, L.FC_SP, 0.6);
  out.glow.push({ pos: [s.xt + 0.6, TOP + h + 0.6, s.cx], size: 6, color: [1, 0.9, 0.5, 0.25], kind: SPRITE.FLASH, minpx: 2 });
}

// The finishers in the pen (the frontend draws no ball out of play): bouncing in their colours, the first three ringed.
function finishers(view, out, s, now) {
  for (let p = 0; p < L.NPLAYER; p++) {
    const a = L.PLAYERS + p * L.PSIZE;
    if ((view.u8[a + L.P_FL] & (L.PF_LIVE | L.PF_DEAD)) !== (L.PF_LIVE | L.PF_DEAD)) continue;
    const n = finOf(view, p);
    if (!n) continue;
    const x = view.dv.getFloat32(a + L.P_PX, true), y = view.dv.getFloat32(a + L.P_PY, true), z = view.dv.getFloat32(a + L.P_PZ, true);
    const bob = Math.abs(Math.sin(now / 260 + p * 1.7)) * (n <= 3 ? 0.9 : 0.45);
    const col = slotColor(p);
    out.solid.push({ pos: [x, y + 1 + bob, z], size: 1, color: [...col, 1], kind: SPRITE.BALL, minpx: 1, roll: now / 400 + p, seed: p });
    out.solid.push({ pos: [x, y + 2.22 + bob, z], size: 0.34, color: [...col, 1], kind: SPRITE.BODY, minpx: 1 });
    out.solid.push({ pos: [x, y + 2.78 + bob, z], size: 0.3, color: [...col, 1], kind: SPRITE.HEAD, minpx: 1, vel: [-1, 0, 0] });
    out.casters.push([x, y + 1 + bob, z, -1]);
    if (n <= 3) out.decals.push({ pos: [x, TOP + 0.03, z], radius: 1.4, width: 0.3, color: [...[[1, 0.85, 0.2], [0.85, 0.88, 0.95], [0.85, 0.55, 0.3]][n - 1], 0.9], kind: DECAL.RING });
  }
}

export default {
  id: L.MG_CHUTE, key: 'chute', name: 'FRUIT CHUTE',
  hint: 'UP THE BELT TO THE LINE  DODGE THE FRUIT ROLLING DOWN',
  rules: 'FIRST OVER THE LINE WINS  KNOCKED DOWN AND YOU CLIMB AGAIN',
  ownScore: true,
  env: 'day',

  draw(view, ctx, out) {
    const s = stage(view);
    if (!(s.hw > 0)) return;
    const g = view.party();
    const tt = schedTicks(view, g, ctx);
    const now = ctx?.now ?? 0;
    const sc = out.scene;
    // the catch floor, chequered
    sc.box((s.xb + s.x0) / 2, PLAT_Y - 1, s.cx, (s.x0 - s.xb) / 2, 1, s.hw, 0, 0.55, 0.82, 1, LOOK.CHECKER, 2, 0.55);
    // the grate the fruit burst on, across the belt above its foot, and the juice under it
    sc.box(s.xg, surf(s, s.xg) + 0.03, s.cx, 0.35, 0.06, s.hw, 0, 0.78, 0.8, 0.85, LOOK.METAL);
    for (let i = 0; i < 2; i++) sc.box(s.xg - 0.9 + 1.8 * i, surf(s, s.xg) + 0.02, s.cx, 0.12, 0.05, s.hw, 0, 0.9, 0.3, 0.35, LOOK.GLOW, 0.5, 0.2);
    belt(sc, s, Math.max(0, tt));
    walls(sc, s);
    dispenser(sc, out, s, Math.max(0, tt), now);
    finish(sc, out, s, now);
    finishers(view, out, s, now);
    if (tt < 0) return;
    // the fruit, and the juice where they burst; when the round's over, every one pops
    let pop = 1;
    if (g.state === L.H_OVER) pop = 1 - (g.tick + (ctx?.dt || 0) / TICK - (g.until - L.P_OVER)) * TICK / 0.35;
    if (pop <= 0) return;
    const o = { x: 0, y: 0, z: 0, vx: 0, rolled: 0, phase: 0, burst: -1 };
    const [k0, k1] = window(s, tt);
    for (let k = Math.max(0, k0 - 40); k < k1; k++) {
      const K = KINDS[s.kind[k]] || KINDS[1];
      const r = s.r[k];
      if (!fruitAt(s, k, tt, o)) {
        if (o.burst >= 0 && o.burst < BURST) {
          const a = o.burst / BURST, j = JUICE[s.kind[k]] || JUICE[1];
          out.glow.push({ pos: [s.xg, surf(s, s.xg) + r * 0.5, o.z], size: r * (1.4 + 2 * a), color: [...j, 0.8 * (1 - a)], kind: SPRITE.FLASH, minpx: 2 });
        }
        continue;
      }
      // inside the gantry till its middle drops out of the hatch
      if (o.phase === 0 && o.y > s.yd + GANTRY - 1.6) continue;
      if (pop < 1) out.glow.push({ pos: [o.x, o.y, o.z], size: r * (2.2 - pop), color: [...(JUICE[s.kind[k]] || JUICE[1]), 0.8 * (1 - pop)], kind: SPRITE.FLASH, minpx: 2 });
      sc.sphere(o.x, o.y, o.z, r * pop, ...K.rgb, K.look, K.look === LOOK.HAZARD ? 0.7 : 0, 0, 1, k & 4095);
      out.casters.push([o.x, o.y, o.z, -r * pop]);
      if (K.leaf) {
        // a leaf at the top of it, turning over as it rolls downhill
        const a = o.rolled / r;
        sc.sphere(o.x - Math.sin(a) * r * 0.92 * pop, o.y + Math.cos(a) * r * 0.92 * pop, o.z, r * 0.22 * pop, ...K.leaf, LOOK.PLASTIC, 0, 0, 1, k & 4095);
      }
    }
  },

  // the whole chute, from the back wall to the pen
  frame(view) {
    const s = stage(view);
    if (!(s.hw > 0)) { const g = view.party(); return { centre: [g.cx, PLAT_Y, g.cx], radius: g.size, shape: 'square' }; }
    return { centre: [(s.xb + s.xe) / 2, PLAT_Y + L.FC_RISE / 2, s.cx], radius: (s.xe - s.xb) / 2, shape: 'square' };
  },

  // up the chute
  facing() { return 0; },

  fx(fx, ctx) {
    const d = typeof ctx.dist === 'function' ? ctx.dist(fx.pos) : ctx.dist ?? 0;
    if (fx.kind === L.FC_FX_FINISH) {
      const mine = fx.owner === ctx.slot;
      ctx.glow?.({ pos: [fx.pos[0], fx.pos[1] + 1, fx.pos[2]], size: 4, color: [1, 0.9, 0.4, 0.9], kind: SPRITE.FLASH, life: 600, grow: true });
      if (mine) {
        ctx.banner?.(`YOU FINISHED ${ordinal(fx.shot)}!`, fx.shot === 1 ? C.YELLOW : C.GREEN, 4000);
        ctx.sound?.holed?.();
      } else {
        ctx.feed?.(`${ctx.name(fx.owner)} OVER THE LINE ${ordinal(fx.shot)}`, fx.shot === 1 ? C.YELLOW : C.WHITE);
        if (fx.shot === 1) ctx.banner?.(`${ctx.name(fx.owner)} IS OVER THE LINE FIRST`, C.ORANGE, 2500);
        if (d < 30) ctx.sound?.pickup?.();
      }
    } else if (fx.kind === L.FC_FX_HIT) {
      const s = memo;
      const kind = s && fx.shot < s.nf ? s.kind[fx.shot] : L.FC_APPLE;
      const j = JUICE[kind] || JUICE[1];
      ctx.glow?.({ pos: fx.pos, size: 1 + fx.size * 0.08, color: [...j, 0.9], kind: SPRITE.SPARK, life: 300 });
      ctx.glow?.({ pos: fx.pos, size: 1.2 + fx.size * 0.05, color: [...j, 0.5], kind: SPRITE.FLASH, life: 260, grow: true });
      ctx.sound?.boing?.(Math.min(30, fx.size), fx.owner === ctx.slot ? 0 : d);
      if (fx.owner === ctx.slot && fx.size > 12) ctx.banner?.(`${KINDS[kind]?.name ?? 'FRUIT'}!`, C.RED, 700);
    } else if (fx.kind === L.FC_FX_WAVE) {
      const s = memo;
      const side = s ? sideOf(s, fx.shot & 255, fx.shot >> 8) : '';
      ctx.banner?.(`FRUIT WAVE  THE GAP IS ${side}`, C.ORANGE, 2200);
      ctx.sound?.count?.(1);
    }
  },

  // where you stand (rows 0 and 1), the next wave and your height up the chute
  hud(view, ctx) {
    const g = view.party();
    if (g.state !== L.H_PLAY) return;
    const s = stage(view);
    if (!(s.hw > 0)) return;
    const me = ctx.me ?? (ctx.slot >= 0 ? view.partier(ctx.slot) : null);
    let fin = 0, n = 0, ahead = 0;
    const mx = me ? me.pos[0] : 0;
    for (let p = 0; p < L.NPLAYER; p++) {
      const a = L.PLAYERS + p * L.PSIZE;
      if (!(view.u8[a + L.P_FL] & L.PF_LIVE)) continue;
      n++;
      if (finOf(view, p)) fin++;
      else if (me && p !== me.slot && view.dv.getFloat32(a + L.P_PX, true) > mx) ahead++;
    }
    if (me?.live) {
      const mine = finOf(view, me.slot);
      if (mine) ctx.put(1, 0, `FINISHED ${ordinal(mine)} OF ${n}`, C.GREEN);
      else {
        const togo = Math.max(0, Math.ceil(s.xt - me.pos[0]));
        ctx.put(1, 0, `${ordinal(fin + ahead + 1)} OF ${n}  ${togo} M TO GO`, C.YELLOW);
      }
    }
    ctx.put(1, 1, fin ? `${fin} OVER THE LINE` : 'NOBODY OVER YET', fin ? C.WHITE : C.GREY);
    // once one in FC_RUSHN is over, the line closes FC_RUSH later (the clock says when)
    const quota = Math.max(1, Math.ceil(g.n0 / L.FC_RUSHN));
    if (fin >= quota) ctx.right(4, `THE LINE CLOSES IN ${Math.max(0, Math.floor((g.until - g.tick) / 125))}`, C.RED);
    else if (fin) ctx.right(4, `${quota - fin} MORE OVER AND THE LINE CLOSES IN ${L.FC_RUSH / 125}`, C.GREY);
    // your height up the chute, a bar
    if (me?.live && !finOf(view, me.slot)) {
      const u = Math.max(0, Math.min(1, (me.pos[0] - s.x0) / L.FC_RUN)), N = 20, lit = Math.round(u * N);
      ctx.put(1, 2, `[${'='.repeat(lit)}${'-'.repeat(N - lit)}]`, u > 0.8 ? C.GREEN : C.CYAN);
    }
    const tt = schedTicks(view, g, ctx) - L.FC_PRE;
    const wv = nextWave(tt);
    if (wv && wv.at - tt < L.FC_WARN + 60 && wv.at >= tt) {
      ctx.right(3, `WAVE ${wv.w + 1} IN ${((wv.at - tt) * TICK).toFixed(1)}  GAP ${sideOf(s, s.gaps[wv.w] ?? 0, s.gl)}`, C.ORANGE);
    } else ctx.right(3, `BELT ${L.FC_BELT} M/S  ${s.nl} LANES`, C.GREY);
  },

  brain: {
    // a fruit there on that tick (its reach and a little), the walls a little
    danger(view, x, z, tick) {
      const o = view.bank || 0;
      if (view.dv.getUint32(L.HDR_STATE + o, true) !== L.H_PLAY) return 0;
      const s = stage(view);
      const t = Math.max(0, (tick - view.dv.getUint32(L.HDR_START + o, true)) | 0) + L.FC_PRE;
      let d = 0;
      for (const F of fruitNow(s, t)) {
        if (F.land > 0) continue;
        const dx = x - F.x, dz = z - F.z, r = F.reach + 0.3;
        if (dx * dx + dz * dz < r * r) return 1;
        if (dx < 0 && dx > -6 && Math.abs(dz) < r) d = Math.max(d, 0.5); // just under one coming down
      }
      return Math.max(d, Math.abs(z - s.cx) > s.hw - 1.4 ? 0.1 : 0);
    },
    goal(view, me, bot) {
      const p = plan(view, me, bot, bot?.at ?? view.tick);
      return p ? [p.pos[0] + 8, mindOf(bot, p.slot).zc] : null;
    },
    hop() { return false; },
    think(view, me, bot, tick = view.tick) {
      const p = plan(view, me, bot, tick);
      if (!p) return null;
      return { yaw: p.yaw, move: 1 };
    },
  },
};
