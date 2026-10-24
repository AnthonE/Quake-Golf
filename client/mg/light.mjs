// RED LIGHT, as drawn and as the AI ball sees it. A mown lawn floating over
// the sea between wooden rails, the grid on sand behind the start line, a
// chequered line between two chequered pylons at the finish, and past it
// the pen, a tree and the doll, giant: orange dress, black pigtails, her
// back to the field while she sings (the music plays), her head coming round
// (the last RL_TURN ticks of every green) to stare with red eyes. Traffic
// lights by her and lamps along the rails show the light; on red her eyes
// sweep the field, and a ball caught moving is zapped and left grey where it
// stopped. Finishers bounce in the pen in their order.
// The lights are the sim's own schedule ($rl_when: the round's seed and the
// tick into play), worked out here on the prediction's clock, so the doll
// turns as your own predicted ball rolls: what you see is what the judge sees.
import * as L from '../../src/layout.mjs';
import { PLAT_Y, hash32 } from '../../src/party-view.mjs';
import { LOOK, SPRITE, DECAL, COLS } from '../party-render.mjs';
import { C } from '../font.mjs';

const TICK = 0.008;
const N = (k) => Math.fround(Number(L.BPHYS[k]));
const ACC = N('B_ACC_DT'), DRAG = N('B_DRAG'), IDLE = Math.fround(L.RL_IDLE);
const DOLL = 30; // m past the finish line to the doll
const DOLL_K = 1.6; // her scale: her head 20 m up, over everything, seen from the start line
const LAMPS = 25; // m between the lamps along the rails
const GRASS = [[0.36, 0.64, 0.25], [0.3, 0.56, 0.21]];
const SAND = [0.86, 0.76, 0.56];
const EARTH = [0.5, 0.36, 0.24];
const WOOD = [0.7, 0.5, 0.3];
const SKIN = [1, 0.84, 0.7];
const DRESS = [0.98, 0.5, 0.1];
const SHIRT = [1, 0.85, 0.3];
const HAIR = [0.08, 0.06, 0.05];
const LIGHTS = { green: [0.2, 1, 0.35], turn: [1, 0.7, 0.1], red: [1, 0.12, 0.1] };
// slot colours as the frontend has them (client/party-game.mjs's slotColor)
const slotColor = (s) => { const h = (s * 0.618034) % 1; return [0, 0.33, 0.67].map((o) => 0.55 + 0.4 * Math.cos(6.2832 * (h + o))); };
const ordinal = (n) => `${n}${[, 'ST', 'ND', 'RD'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'TH'}`;

// ---- the field and the lights, as the sim has them

let memo = null;
// This round's field on the view's bank (PG_H), and its schedule as it's worked out.
export function stage(view) {
  const dv = view.dv, o = view.bank || 0;
  const hw = dv.getFloat32(L.PG_H + L.RL_HW + o, true), zs = dv.getFloat32(L.PG_H + L.RL_ZS + o, true);
  const zf = dv.getFloat32(L.PG_H + L.RL_ZF + o, true), zb = dv.getFloat32(L.PG_H + L.RL_ZB + o, true);
  const cx = dv.getFloat32(L.PG_CX + o, true), s = dv.getUint32(L.HDR_SEED + o, true), h = dv.getUint32(L.HDR_HOLE + o, true);
  const m = memo;
  if (m && m.hw === hw && m.zs === zs && m.zf === zf && m.zb === zb && m.cx === cx && m.s === s && m.h === h) return m;
  memo = { hw, zs, zf, zb, cx, s, h, cols: dv.getUint32(L.PG_H + L.RL_COLS + o, true), starts: [0], last: 0 };
  return memo;
}
// Cycle c's green and red in ticks ($rl_green, $rl_red).
export function greenOf(st, c) {
  const h = hash32(st.s, st.h, L.RL_KG + c);
  if (c === 0) return L.RL_G0A + h % L.RL_G0N;
  return c >= L.RL_PEEK0 && h >>> 28 < L.RL_PEEKS ? L.RL_PA + h % L.RL_PN : L.RL_GA + h % L.RL_GN;
}
// Is cycle c's green a peek?
export const peekOf = (st, c) => greenOf(st, c) < L.RL_GA;
export const redOf = (st, c) => L.RL_RA + hash32(st.s, st.h, L.RL_KR + c) % L.RL_RN;
// Cycle c's first tick into play.
export function startOf(st, c) {
  while (st.starts.length <= c) { const k = st.starts.length - 1; st.starts.push(st.starts[k] + greenOf(st, k) + redOf(st, k)); }
  return st.starts[c];
}
// The cycle on tick t into play (fractions dropped), as $rl_when has it: c,
// its green's start s, the turn's w, red's r0, the look's j (red, past its
// grace) and its end e.
export function when(st, t) {
  t = Math.max(0, Math.floor(t));
  let c = startOf(st, st.last) <= t ? st.last : 0;
  while (startOf(st, c + 1) <= t) c++;
  st.last = c;
  const s = startOf(st, c), r0 = s + greenOf(st, c);
  return { c, s, w: r0 - L.RL_TURN, r0, j: r0 + L.RL_GRACE, e: startOf(st, c + 1) };
}
// green: the doll sings, its back to you; turn: it's turning round, stop; grace: red, not looking yet; red: looking.
export const phaseOf = (w, t) => (t < w.w ? 'green' : t < w.r0 ? 'turn' : t < w.j ? 'grace' : 'red');
// What became of a ball, from its PG_M: racing, fin (with its order) or caught.
export const fateOf = (m) => ({ kind: (m >>> 16) === 1 ? 'fin' : (m >>> 16) === 2 ? 'caught' : 'racing', n: m & 0xffff });
// Metres to the finish line from z.
export const toGo = (st, z) => Math.max(0, z - st.zf);

// Ticks into play to draw at, fractional: the prediction's clock in play,
// where the round ended through the result, -1 in the countdown.
function playTick(view, ctx) {
  const g = view.party();
  if (g.state === L.H_PLAY) {
    // the sim's i32 subtraction: it wraps
    const tk = ctx?.ptick ?? (ctx?.tick ?? g.tick) + (ctx?.dt ?? 0) / TICK, whole = Math.floor(tk);
    return Math.max(0, ((whole - g.start) | 0) + (tk - whole));
  }
  if (g.state === L.H_OVER) return (g.until - L.P_OVER - g.start) | 0;
  return -1;
}

// ---- the AI ball

// Every ball racing, once a world tick: positions and speeds, in a grid of 4 m squares.
function racers(view) {
  if (view._rl?.tick === view.tick && view._rl.bank === view.bank) return view._rl;
  const grid = new Map(), all = [];
  for (let p = 0; p < L.NPLAYER; p++) {
    const a = L.PLAYERS + view.bank + p * L.PSIZE;
    if ((view.u8[a + L.P_FL] & (L.PF_LIVE | L.PF_DEAD | L.PF_FALL)) !== L.PF_LIVE) continue;
    const b = { slot: p, x: view.dv.getFloat32(a + L.P_PX, true), z: view.dv.getFloat32(a + L.P_PZ, true), vx: view.dv.getFloat32(a + L.P_VX, true), vz: view.dv.getFloat32(a + L.P_VZ, true) };
    all.push(b);
    const k = Math.floor(b.x / 4) * 4096 + Math.floor(b.z / 4);
    const list = grid.get(k);
    if (list) list.push(b); else grid.set(k, [b]);
  }
  view._rl = { tick: view.tick, bank: view.bank, grid, all };
  return view._rl;
}
// The racers ahead of (x, z) (toward the finish) within `aheadM` m and `side`
// m across, but slot, where they'll be `dt` s on (the world seen is that old):
// [{ dz, dx, vz }].
function ahead(w, x, z, slot, aheadM, side, dt) {
  const out = [];
  const reach = 12 * dt;
  for (let i = Math.floor((x - side - reach) / 4); i <= Math.floor((x + side + reach) / 4); i++) {
    for (let j = Math.floor((z - aheadM - reach) / 4); j <= Math.floor((z + reach) / 4); j++) {
      const list = w.grid.get(i * 4096 + j);
      if (!list) continue;
      for (const b of list) {
        if (b.slot === slot) continue;
        const dz = z - (b.z + b.vz * dt), dx = b.x + b.vx * dt - x;
        if (dz > 0 && dz < aheadM && Math.abs(dx) < side) out.push({ dz, dx, vz: b.vz });
      }
    }
  }
  return out;
}
// Speed after n ticks of a push from v (along the way it rolls), and after n ticks of none.
const pushed = (v, n) => { const d = DRAG ** n; return v * d + ACC * (1 - d) / (1 - DRAG); };
const pushedDist = (v, n) => { const s = DRAG * (1 - DRAG ** n) / (1 - DRAG); return TICK * (v * s + ACC / (1 - DRAG) * (n - s)); };
// A number in [0, 1) for this ball, this cycle and k, when the bot brings no PRNG of its own.
const luck = (st, slot, c, k) => hash32(slot * 977 + k, c, st.s ^ 0x5bd1e995) / 2 ** 32;

// What the ball does on tick `tick`: on green, roll for the line in a lane
// clear of the balls ahead, and let go in time to be under RL_VMAX (with a
// margin its skill sets) when red looks, unless it can be over the line
// first; on red, no keys. Now and then a clumsy one lets go late (its luck,
// a cycle at a time) and is caught. Following close behind another it lets
// go sooner (the one ahead may brake first, and it sees that a round trip
// late), and closing on a slower one it lets go at once rather than hit it.
function plan(view, me, bot, tick) {
  const o = view.bank || 0;
  if (view.dv.getUint32(L.HDR_STATE + o, true) !== L.H_PLAY) return null;
  const b = typeof me === 'number' ? view.partier(me) : me;
  if (!b || !b.live || b.out) return null;
  const st = stage(view);
  if (!(st.hw > 0)) return null;
  const slot = b.slot;
  const t = Math.max(0, (tick - view.dv.getUint32(L.HDR_START + o, true)) | 0);
  const w = when(st, t);
  const x = bot?.pos?.[0] ?? b.pos[0], z = bot?.pos?.[1] ?? b.pos[2];
  const vx = bot?.vel?.[0] ?? b.vel[0], vz = bot?.vel?.[1] ?? b.vel[2];
  const v = Math.hypot(vx, vz);
  const skill = bot?.skill ?? 0.6;
  const mem = bot?.mem ? (bot.mem.rl ||= {}) : {};
  const rand = (k) => (bot?.rand ? bot.rand() : luck(st, slot, w.c, k));
  if (mem.c !== w.c) {
    mem.c = w.c;
    mem.margin = 5 + Math.round((1 - skill) * 14 * rand(1));
    mem.late = rand(2) < 0.16 * (1 - skill) ** 1.5 ? Math.round(14 + 34 * rand(3)) : 0;
  }
  // the lane: the way ahead along the field, clear of the balls in it
  const R = racers(view);
  const dt = Math.max(0, Math.min(40, (tick - view.tick) | 0)) * TICK;
  if (mem.lane === undefined || Math.abs(mem.lane - x) > 6) mem.lane = x;
  const lim = st.hw - 2;
  const cost = (lx) => {
    let s = Math.abs(lx - x) * 0.3 + (Math.abs(lx - st.cx) > lim ? 50 : 0);
    for (const r of ahead(R, lx, z, slot, 12, 2.4, dt)) s += (12 - r.dz) * (r.vz < vz - 1 ? 1 : 0.5);
    return s;
  };
  if (!mem.at || t - mem.at >= 20) {
    mem.at = t;
    let best = Infinity;
    for (const dx of [0, -1.25, 1.25, -2.5, 2.5, -3.75, 3.75, -5, 5]) { const s = cost(mem.lane + dx); if (s < best) { best = s; mem.next = mem.lane + dx; } }
    mem.lane = Math.max(st.cx - lim, Math.min(st.cx + lim, mem.next));
  }
  const yaw = Math.atan2(-8, mem.lane - x);
  if (t >= w.r0 && t < w.e - 10) return { yaw, move: 0 };
  // on green: can it be over before red looks?
  const look = (t < w.r0 ? w.j : startOf(st, w.c + 1) + greenOf(st, w.c + 1) + L.RL_GRACE) - t;
  if (pushedDist(v, look - 2) > z - st.zf + 1.5) return { yaw, move: 1 };
  // once it has let go this green it stays off (what it reckons of its speed
  // after letting go runs low: the words in flight aren't all its last)
  if (mem.off === w.c && t < w.r0) return { yaw, move: 0 };
  // a slower ball ahead in the lane it would reach within the second: don't run into it
  let follow = 0;
  for (const r of ahead(R, x, z, slot, 8, 2.3, dt)) {
    const close = -vz + r.vz;
    if (close > 0.5 && (r.dz - 2) / close < 0.8) return { yaw, move: 0 };
    follow = 24;
  }
  // push on while a push to the next think and braking from there gets under the limit in time
  const hold = 4;
  const left = look - hold - mem.margin - follow + mem.late;
  const ok = left > 0 && pushed(v, hold) * IDLE ** left < L.RL_VMAX * 0.92;
  if (!ok && t < w.r0) mem.off = w.c;
  return { yaw, move: ok ? 1 : 0 };
}

// ---- drawing

// The doll, giant (DOLL_K times a girl of 15 m), her body facing away down
// the yard, her head turned to `a` (radians, atan2(dz, dx): -pi/2 her back to
// the field, pi/2 staring at it), her eyes lit red by `eye` 0..1. Returns where
// her eyes are, for what they sweep and zap.
function doll(sc, out, x0, z0, a, eye) {
  const k = DOLL_K, y0 = PLAT_Y;
  const cyl = (x, y, z, r, hh, c, look) => sc.cyl(x0 + x * k, y0 + y * k, z0 + z * k, r * k, hh * k, ...c, look);
  const ball = (x, y, z, r, c, look, la = 0) => sc.sphere(x0 + x * k, y0 + y * k, z0 + z * k, r * k, ...c, look, la);
  for (const s of [-1, 1]) {
    sc.box(x0 + s * k, y0 + 0.35 * k, z0 - 0.3 * k, 0.55 * k, 0.35 * k, 0.95 * k, 0, 0.13, 0.1, 0.1, LOOK.PLASTIC);
    cyl(s, 1.3, 0, 0.58, 0.6, [0.98, 0.98, 0.96], LOOK.MATTE);
    cyl(s, 3.1, 0, 0.5, 1.6, SKIN, LOOK.MATTE);
    cyl(s * 2.3, 8.0, 0, 0.6, 1.2, SHIRT, LOOK.PLASTIC);
    cyl(s * 2.35, 6.2, 0, 0.46, 0.75, SKIN, LOOK.MATTE);
    ball(s * 2.35, 5.3, 0, 0.56, SKIN, LOOK.MATTE);
  }
  // the pinafore: a skirt and its bodice; the shirt's shoulders, the neck
  cyl(0, 5.6, 0, 2.7, 1.3, DRESS, LOOK.PLASTIC);
  cyl(0, 7.9, 0, 1.95, 1.0, DRESS, LOOK.PLASTIC);
  cyl(0, 9.1, 0, 2.05, 0.35, SHIRT, LOOK.PLASTIC);
  cyl(0, 9.75, 0, 0.72, 0.35, SKIN, LOOK.MATTE);
  // the head: skin, the hair a sphere a little behind the face, bangs, pigtails
  const fx = Math.cos(a), fz = Math.sin(a), sx = -fz, sz = fx, hy = 12.4;
  ball(0, hy, 0, 2.4, SKIN, LOOK.MATTE);
  ball(-fx * 0.55, hy + 0.3, -fz * 0.55, 2.45, HAIR, LOOK.PLASTIC);
  sc.box(x0 + fx * 1.25 * k, y0 + (hy + 1.55) * k, z0 + fz * 1.25 * k, 1.75 * k, 0.55 * k, 0.75 * k, a + Math.PI / 2, ...HAIR, LOOK.PLASTIC);
  let eyes = null;
  for (const s of [-1, 1]) {
    ball(sx * s * 2.45 - fx * 0.3, hy - 0.7, sz * s * 2.45 - fz * 0.3, 1.0, HAIR, LOOK.PLASTIC);
    ball(sx * s * 2.0, hy - 0.1, sz * s * 2.0, 0.42, [1, 0.82, 0.2], LOOK.PLASTIC);
    // the eyes, black, or lit red when she looks; the cheeks
    const ex = fx * 2.15 + sx * s * 0.8, ez = fz * 2.15 + sz * s * 0.8;
    if (eye > 0) ball(ex, hy + 0.25, ez, 0.36, [1, 0.15 + 0.2 * (1 - eye), 0.1], LOOK.GLOW, 0.4 + 1.4 * eye);
    else ball(ex, hy + 0.25, ez, 0.34, [0.06, 0.05, 0.05], LOOK.PLASTIC);
    ball(fx * 2.05 + sx * s * 1.35, hy - 0.55, fz * 2.05 + sz * s * 1.35, 0.36, [1, 0.62, 0.6], LOOK.MATTE);
    const at = [x0 + (ex + fx * 0.3) * k, y0 + (hy + 0.25) * k, z0 + (ez + fz * 0.3) * k];
    if (eye > 0) out.glow.push({ pos: at, size: (1.2 + 1.4 * eye) * k, color: [1, 0.15, 0.1, 0.7 * eye], kind: SPRITE.FLASH, minpx: 2 });
    eyes = eyes ? [(eyes[0] + at[0]) / 2, at[1], (eyes[2] + at[2]) / 2] : at;
  }
  sc.box(x0 + fx * 2.3 * k, y0 + (hy - 0.95) * k, z0 + fz * 2.3 * k, 0.38 * k, 0.12 * k, 0.1 * k, a + Math.PI / 2, 0.85, 0.2, 0.2, LOOK.MATTE);
  return eyes;
}

// A traffic light: red over amber over green, the lit one glowing.
function signal(sc, out, x, z, on) {
  sc.cyl(x, PLAT_Y + 6, z, 0.3, 6, 0.6, 0.62, 0.66, LOOK.METAL);
  sc.box(x, PLAT_Y + 15.2, z, 1.35, 3.9, 0.8, 0, 0.1, 0.1, 0.12, LOOK.PLASTIC);
  const lamps = [['red', 17.7], ['turn', 15.2], ['green', 12.7]];
  for (const [k, y] of lamps) {
    const c = LIGHTS[k];
    if (on === k) {
      sc.sphere(x, PLAT_Y + y, z + 0.65, 1.05, ...c, LOOK.GLOW, 1.6);
      out.glow.push({ pos: [x, PLAT_Y + y, z + 1.4], size: 5, color: [...c, 0.55], kind: SPRITE.FLASH, minpx: 3 });
    } else sc.sphere(x, PLAT_Y + y, z + 0.65, 1.05, c[0] * 0.22, c[1] * 0.22, c[2] * 0.22, LOOK.PLASTIC);
  }
}

// the zaps of balls caught lately, for the doll's eyes to draw: { pos, born (ms) }
const zaps = [];
// the prediction's tick into play as last drawn, for the HUD's lines that frame
let drawn = { now: -1, t: -1 };
// the light as last drawn, for its sounds
let heard = { c: -1, ph: '' };

export default {
  id: L.MG_LIGHT, key: 'light', name: 'RED LIGHT',
  hint: 'ROLL ON GREEN  LET GO OF THE KEYS BEFORE SHE TURNS ROUND',
  rules: 'FIRST OVER THE LINE WINS  CAUGHT MOVING ON RED AND YOU ARE OUT',
  ownScore: true,
  env: 'day',

  draw(view, ctx, out) {
    const st = stage(view);
    if (!(st.hw > 0)) return;
    const g = view.party();
    const sc = out.scene;
    const { cx, hw, zs, zf, zb } = st;
    const now = ctx?.now ?? 0;
    const tp = playTick(view, ctx);
    drawn = { now, t: tp };
    const w = tp >= 0 ? when(st, tp) : null;
    const ph = w ? phaseOf(w, tp) : 'red';
    // the light's moments as sounds, on the prediction's clock; the music only while she sings
    if (w && g.state === L.H_PLAY) {
      if (heard.c !== w.c || heard.ph !== ph) {
        if (ph === 'turn' && heard.ph === 'green') ctx.sound?.count?.(1);
        else if (ph === 'grace' && heard.ph === 'turn') ctx.sound?.count?.(0);
        else if (ph === 'green' && heard.ph === 'red') ctx.sound?.jump?.();
        heard = { c: w.c, ph };
      }
      out.music = ph === 'green' || ph === 'turn';
    } else heard = { c: -1, ph: '' };

    // the floor: the grid on sand, the lawn in mown stripes, the yard on sand, earth under it all
    const z1 = zf - L.RL_YARD, wide = hw + 2.6;
    sc.box(cx, PLAT_Y - 2.2, (zb + 2 + z1) / 2, wide, 1.6, (zb + 2 - z1) / 2, 0, ...EARTH, LOOK.MATTE);
    sc.box(cx, PLAT_Y - 0.3, (zb + 2 + zs) / 2, wide, 0.3, (zb + 2 - zs) / 2, 0, ...SAND, LOOK.MATTE);
    sc.box(cx, PLAT_Y - 0.3, (zf + z1) / 2, wide, 0.3, (zf - z1) / 2, 0, ...SAND, LOOK.MATTE);
    const bands = Math.round((zs - zf) / 5);
    for (let k = 0; k < bands; k++) {
      const za = zs - (k * (zs - zf)) / bands, zc = zs - ((k + 1) * (zs - zf)) / bands;
      sc.box(cx, PLAT_Y - 0.3, (za + zc) / 2, wide, 0.3, (za - zc) / 2, 0, ...GRASS[k & 1], LOOK.MATTE);
    }
    // the lines: the start, every 25 m, the finish chequered between two chequered pylons (no bar over it: nothing hides the doll)
    sc.box(cx, PLAT_Y + 0.01, zs, hw, 0.02, 0.3, 0, 0.97, 0.97, 0.95, LOOK.MATTE);
    for (let d = LAMPS; d < L.RL_FIELD; d += LAMPS) sc.box(cx, PLAT_Y + 0.005, zs - d, hw, 0.015, 0.1, 0, 0.95, 0.95, 0.9, LOOK.MATTE, 0, 0, 0.65);
    sc.box(cx, PLAT_Y + 0.01, zf, hw, 0.02, 1, 0, 0.97, 0.97, 0.97, LOOK.CHECKER, 1);
    for (const s of [-1, 1]) {
      sc.box(cx + s * (hw + 1), PLAT_Y + 3.5, zf, 0.7, 3.5, 0.7, 0, 0.97, 0.97, 0.97, LOOK.CHECKER, 0.7);
      sc.sphere(cx + s * (hw + 1), PLAT_Y + 7.6, zf, 0.7, 1, 0.85, 0.25, LOOK.GLOW, 1.2);
    }
    // the rails: posts and two bars down each side, round the back and the yard's end
    const fence = (xa, za, xb, zb2) => {
      const len = Math.hypot(xb - xa, zb2 - za), yaw = Math.atan2(zb2 - za, xb - xa), mx = (xa + xb) / 2, mz = (za + zb2) / 2;
      for (const y of [0.55, 1.05]) sc.box(mx, PLAT_Y + y, mz, len / 2, 0.07, 0.07, yaw, ...WOOD, LOOK.WOOD);
      const n = Math.max(1, Math.round(len / 4));
      for (let k = 0; k <= n; k++) sc.box(xa + ((xb - xa) * k) / n, PLAT_Y + 0.65, za + ((zb2 - za) * k) / n, 0.12, 0.65, 0.12, yaw, WOOD[0] * 0.85, WOOD[1] * 0.85, WOOD[2] * 0.85, LOOK.WOOD);
    };
    const xl = cx - hw - 0.15, xr = cx + hw + 0.15, zbk = zb + 0.15, zy = z1 - 0.15;
    fence(xl, zbk, xl, zy);
    fence(xr, zbk, xr, zy);
    fence(xl, zbk, xr, zbk);
    fence(xl, zy, xr, zy);
    // lamps along the rails in the light's colour: the whole field sees it
    const lit = ph === 'turn' ? (Math.floor(tp / 10) & 1 ? 'turn' : 'green') : ph === 'grace' || ph === 'red' ? 'red' : 'green';
    const lc = LIGHTS[lit];
    for (let d = 0; d <= L.RL_FIELD; d += LAMPS) {
      for (const x of [xl, xr]) {
        sc.cyl(x, PLAT_Y + 1.6, zs - d, 0.1, 1.6, 0.55, 0.57, 0.6, LOOK.METAL);
        sc.sphere(x, PLAT_Y + 3.4, zs - d, 0.45, ...lc, LOOK.GLOW, 1.3);
        out.glow.push({ pos: [x, PLAT_Y + 3.4, zs - d], size: 1.8, color: [...lc, 0.45], kind: SPRITE.FLASH, minpx: 2 });
      }
    }

    // the yard: the tree, the traffic lights, the doll
    const zd = zf - DOLL;
    sc.cyl(cx + 13, PLAT_Y + 6, zd - 9, 1.2, 6, 0.42, 0.3, 0.2, LOOK.WOOD);
    for (const [dx, dy, dz, r] of [[0, 13, 0, 5.4], [-3.2, 11.2, 1.4, 3.8], [3.4, 11.6, -1.2, 4], [0.6, 16, -0.6, 3.6]]) sc.sphere(cx + 13 + dx, PLAT_Y + dy, zd - 9 + dz, r, 0.26, 0.52, 0.2, LOOK.MATTE);
    signal(sc, out, cx - 9, zd + 2, lit);
    signal(sc, out, cx + 9 + 4, zd + 2, lit);
    // the head comes round through the turn (easing in, snapping round at the end) and back as green starts
    let a = -Math.PI / 2, eye = 0;
    if (!w) { a = Math.PI / 2; eye = 0.6; }
    else if (ph === 'turn') { const u = (tp - w.w) / L.RL_TURN; a = -Math.PI / 2 + Math.PI * u * u * (3 - 2 * u); }
    else if (ph === 'grace' || ph === 'red') { a = Math.PI / 2; eye = ph === 'red' ? 1 : 0.5; }
    else if (w.c > 0 && tp - w.s < 40) { const u = (tp - w.s) / 40; a = Math.PI / 2 - Math.PI * u * u * (3 - 2 * u); }
    const eyes = doll(sc, out, cx, zd, a, eye);
    // on red her eyes sweep the field
    if (eye > 0 && w) {
      const s = tp * TICK;
      for (const k of [0, 1]) {
        const u = Math.sin(s * (1.1 + 0.4 * k) + k * 2.1), v = 0.5 + 0.5 * Math.sin(s * 0.7 + k * 1.3);
        const at = [cx + u * (hw - 2), PLAT_Y + 0.05, zf + 8 + v * (zs - zf - 8)];
        out.beams.push({ a: eyes, b: at, width: 0.18 + 0.1 * eye, color: [1, 0.15, 0.1, 0.25 + 0.3 * eye] });
        out.decals.push({ pos: at, radius: 5, width: 1, color: [1, 0.15, 0.1, 0.3 + 0.3 * eye], kind: DECAL.ZONE });
      }
    }
    // zaps: the eyes to a ball caught, for a moment
    for (let k = zaps.length - 1; k >= 0; k--) {
      const age = (now - zaps[k].born) / 600;
      if (age >= 1 || age < -1) { zaps.splice(k, 1); continue; }
      const p = zaps[k].pos;
      out.beams.push({ a: eyes, b: [p[0], p[1] + 1, p[2]], width: 0.5 * (1 - age), color: [1, 0.25, 0.15, 0.9 * (1 - age)] });
    }

    // balls out of play, the frontend draws none of them: finishers bouncing in the pen, the caught grey where they stopped
    for (let p = 0; p < L.NPLAYER; p++) {
      const a0 = L.PLAYERS + view.bank + p * L.PSIZE;
      if ((view.u8[a0 + L.P_FL] & (L.PF_LIVE | L.PF_DEAD)) !== (L.PF_LIVE | L.PF_DEAD)) continue;
      const fate = fateOf(view.dv.getUint32(a0 + L.PG_M, true));
      if (fate.kind === 'racing') continue;
      const x = view.dv.getFloat32(a0 + L.P_PX, true), y = view.dv.getFloat32(a0 + L.P_PY, true), z = view.dv.getFloat32(a0 + L.P_PZ, true);
      if (fate.kind === 'fin') {
        const bob = Math.abs(Math.sin(now / 260 + p * 1.7)) * 0.8;
        const col = slotColor(p);
        out.solid.push({ pos: [x, y + 1 + bob, z], size: 1, color: [...col, 1], kind: SPRITE.BALL, minpx: 1, roll: now / 400 + p, seed: p });
        out.solid.push({ pos: [x, y + 2.22 + bob, z], size: 0.34, color: [...col, 1], kind: SPRITE.BODY, minpx: 1 });
        out.solid.push({ pos: [x, y + 2.78 + bob, z], size: 0.3, color: [...col, 1], kind: SPRITE.HEAD, minpx: 1, vel: [0, 0, 1] });
        out.casters.push([x, y + 1 + bob, z, -1]);
        if (fate.n <= 3) out.decals.push({ pos: [x, PLAT_Y + 0.02, z], radius: 1.4, width: 0.3, color: [...[[1, 0.85, 0.2], [0.85, 0.88, 0.95], [0.85, 0.55, 0.3]][fate.n - 1], 0.9], kind: DECAL.RING });
      } else {
        out.solid.push({ pos: [x, y + 1, z], size: 1, color: [0.42, 0.42, 0.46, 1], kind: SPRITE.BALL, minpx: 1, seed: p });
        out.solid.push({ pos: [x + 0.25, y + 2.1, z], size: 0.32, color: [0.5, 0.5, 0.54, 1], kind: SPRITE.BODY, minpx: 1 });
        out.solid.push({ pos: [x + 0.55, y + 2.35, z], size: 0.28, color: [0.5, 0.5, 0.54, 1], kind: SPRITE.HEAD, minpx: 1, vel: [1, 0, 0] });
        out.casters.push([x, y + 1, z, -1]);
        out.decals.push({ pos: [x, PLAT_Y + 0.02, z], radius: 1.5, width: 0.3, color: [0.9, 0.15, 0.1, 0.55], kind: DECAL.RING });
      }
    }
    // your own ball, too fast to stop in time: a red ring round it
    const pme = ctx?.pme, pv = ctx?.pview;
    if (pme && !pme.out && w && ph !== 'green') {
      const v = Math.hypot(pme.vel[0], pme.vel[2]);
      if (v > L.RL_VMAX) {
        const dt = pv ? Math.max(0, Math.min(0.05, ((ctx.ptick ?? pv.tick) - pv.tick) * TICK)) : 0;
        out.glow.push({ pos: [pme.pos[0] + pme.vel[0] * dt, pme.pos[1] + 1, pme.pos[2] + pme.vel[2] * dt], size: 1.7 + 0.25 * Math.sin(now / 50), color: [1, 0.15, 0.1, 0.8], kind: SPRITE.RING, minpx: 2 });
      }
    }
  },

  // the whole field, back wall to the yard's end, north up on the minimap
  frame(view) {
    const st = stage(view);
    if (!(st.hw > 0)) { const g = view.party(); return { centre: [g.cx, PLAT_Y, g.cx], radius: g.size, shape: 'square' }; }
    const z1 = st.zf - L.RL_YARD;
    return { centre: [st.cx, PLAT_Y, (st.zb + z1) / 2], radius: (st.zb - z1) / 2, shape: 'square' };
  },

  // down the field, toward the doll
  facing() { return -Math.PI / 2; },

  fx(f, ctx) {
    const d = typeof ctx.dist === 'function' ? ctx.dist(f.pos) : ctx.dist ?? 0;
    const name = (p) => (ctx.name ? ctx.name(p) : `P${p + 1}`);
    if (f.kind === L.RL_FX_CAUGHT) {
      zaps.push({ pos: f.pos, born: ctx.now ?? 0 });
      ctx.glow?.({ pos: [f.pos[0], f.pos[1] + 1, f.pos[2]], size: 2.6, color: [1, 0.25, 0.15, 1], kind: SPRITE.FLASH, life: 450 });
      ctx.glow?.({ pos: [f.pos[0], f.pos[1] + 1, f.pos[2]], size: 3, color: [1, 0.3, 0.2, 0.9], kind: SPRITE.RING, life: 600, grow: true });
      ctx.sound?.gun?.(7, f.owner === ctx.slot ? 0 : d);
      const by = f.shot !== 255 ? `  BUMPED BY ${name(f.shot)}` : '';
      ctx.feed?.(`${name(f.owner)} CAUGHT MOVING${by}`, f.owner === ctx.slot ? C.RED : f.shot === ctx.slot ? C.GREEN : C.WHITE);
      if (f.owner === ctx.slot) ctx.banner?.(`CAUGHT  ${Math.ceil(f.size)} M SHORT`, C.RED, 3500);
      else if (f.shot === ctx.slot) ctx.banner?.(`YOU GOT ${name(f.owner)} CAUGHT`, C.GREEN, 2000);
    } else if (f.kind === L.RL_FX_FINISH) {
      const n = f.shot;
      ctx.glow?.({ pos: [f.pos[0], f.pos[1] + 1, f.pos[2]], size: 3.5, color: [1, 0.85, 0.3, 1], kind: SPRITE.RING, life: 700, grow: true });
      ctx.glow?.({ pos: [f.pos[0], f.pos[1] + 2, f.pos[2]], size: 1.2, color: [1, 1, 0.7, 1], kind: SPRITE.SPARK, life: 400 });
      ctx.feed?.(`${name(f.owner)} OVER THE LINE ${ordinal(n)}  ${f.size.toFixed(1)} S`, f.owner === ctx.slot ? C.YELLOW : C.WHITE);
      if (f.owner === ctx.slot) { ctx.banner?.(`OVER THE LINE  ${ordinal(n)}!`, C.YELLOW, 3500); ctx.sound?.holed?.(); }
      else {
        if (n === 1) ctx.banner?.(`${name(f.owner)} IS OVER  ${Math.round(L.RL_RUSH / 125)} SECONDS LEFT`, C.ORANGE, 2500);
        if (d < 40) ctx.sound?.pickup?.();
      }
    }
  },

  // where you are (rows 0 and 1, the frontend leaves them to ownScore), the light big across rows 2 to 4, your speed on red
  hud(view, ctx) {
    const g = view.party();
    if (g.state !== L.H_PLAY) return;
    const st = stage(view);
    if (!(st.hw > 0)) return;
    const t = drawn.now === ctx.now && drawn.t >= 0 ? drawn.t : typeof ctx.t === 'number' ? ctx.t / TICK : g.t;
    const w = when(st, t), ph = phaseOf(w, t);
    const me = ctx.me ?? (ctx.slot >= 0 ? view.partier(ctx.slot) : null);
    // who's where
    let fin = 0, caught = 0, racing = 0;
    for (let p = 0; p < L.NPLAYER; p++) {
      const a = L.PLAYERS + view.bank + p * L.PSIZE;
      const fl = view.u8[a + L.P_FL];
      if (!(fl & L.PF_LIVE)) continue;
      if (!(fl & L.PF_DEAD)) { racing++; continue; }
      const k = fateOf(view.dv.getUint32(a + L.PG_M, true)).kind;
      if (k === 'fin') fin++; else if (k === 'caught') caught++;
    }
    if (me?.live) {
      const fate = fateOf(me.m);
      if (fate.kind === 'fin') ctx.put(1, 0, `OVER THE LINE ${ordinal(fate.n)}`, C.GREEN);
      else if (fate.kind === 'caught') ctx.put(1, 0, `CAUGHT ${Math.ceil(toGo(st, me.pos[2]))} M SHORT`, C.RED);
      else if (!me.out) ctx.put(1, 0, `${Math.ceil(toGo(st, (ctx.pme ?? me).pos[2]))} M TO GO`, C.YELLOW);
    }
    ctx.put(1, 1, `${fin} OVER  ${caught} CAUGHT  ${racing} RACING`, C.GREY);
    // the light: a panel in its colour, its words, how long it has
    const x0 = (COLS / 2 - 16) * 4, x1 = (COLS / 2 + 16) * 4;
    const blink = Math.floor(t / 12) & 1;
    const [r, gg, b] = ph === 'green' ? [0.06, 0.55, 0.18] : ph === 'turn' ? (blink ? [0.9, 0.55, 0.05] : [0.6, 0.3, 0.02]) : [0.75, 0.06, 0.05];
    ctx.rect?.(x0, 12, x1, 31, r, gg, b, 0.8);
    const words = ph === 'green' ? (peekOf(st, w.c) ? 'QUICK GREEN  SHE WILL PEEK' : 'GREEN LIGHT  ROLL') : ph === 'turn' ? 'SHE IS TURNING  LET GO' : ph === 'grace' ? 'RED LIGHT  STOP' : 'RED LIGHT  DO NOT MOVE';
    ctx.centre(2, words, C.WHITE);
    // the song's bar: how much of it is left before she turns; on red, how long she looks
    const n = 30, u = ph === 'green' ? 1 - (t - w.s) / (w.w - w.s) : ph === 'turn' ? 0 : (w.e - t) / (w.e - w.r0);
    const fill = Math.max(0, Math.min(n, Math.round(u * n)));
    const bx = Math.floor((COLS - n) / 2);
    if (ph === 'turn') ctx.put(bx, 4, '!'.repeat(n), blink ? C.YELLOW : C.RED);
    else {
      if (fill) ctx.put(bx, 4, '='.repeat(fill), ph === 'green' ? C.GREEN : C.RED);
      if (fill < n) ctx.put(bx + fill, 4, '-'.repeat(n - fill), C.GREY);
    }
    // your speed, while it counts
    const mine = ctx.pme ?? me;
    if (mine?.live && !mine.out && ph !== 'green') {
      const v = Math.hypot(mine.vel[0], mine.vel[2]);
      ctx.centre(6, v > L.RL_VMAX ? `${v.toFixed(1)} M/S  TOO FAST` : 'STILL', v > L.RL_VMAX ? C.RED : C.GREEN);
    } else if (mine?.live && !mine.out && w.c === 0 && t < 250) ctx.centre(6, 'LET GO OF THE KEYS TO STOP', C.WHITE);
  },

  brain: {
    // off the field is the only place that's deadly; the light is think's
    danger(view, x, z) {
      const st = stage(view);
      return Math.abs(x - st.cx) > st.hw - 1 || z > st.zb ? 1 : 0;
    },
    // straight down the field, past the line
    goal(view, me) {
      const st = stage(view);
      const b = typeof me === 'number' ? view.partier(me) : me;
      return b ? [b.pos[0], st.zf - 10] : null;
    },
    hop() { return false; },
    // all of it: the lane and when to let go (yaw in radians, as Partier reads it)
    think(view, me, bot, tick = view.tick) {
      return plan(view, me, bot, tick);
    },
  },
};
