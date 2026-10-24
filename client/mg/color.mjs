// COLOR CALL, as drawn and as the AI ball sees it. The board is hex tiles of
// bright plastic in K colours; each cycle they flip to new colours in a wave
// from the middle, a colour is called (its tiles pulse and glow, the rest
// darken and shake as the warning runs out, a halo round the board and the
// lantern over it take the colour), then every other tile drops away fast,
// sinks, and rises back in the next cycle's colours as the drop ends. The
// ring a drop takes for good is grey through the cycle before; sudden death
// lights its one tile with a beam. All of it is the sim's own schedule
// (src/mg/color.wat) worked again here in f32 where the sim works in f32, so
// what is drawn and what the bots steer by is what the sim does.
import * as L from '../../src/layout.mjs';
import { PLAT_Y, hexAt, hexCentre, hash32 } from '../../src/party-view.mjs';
import { LOOK, SPRITE, DECAL } from '../party-render.mjs';
import { C } from '../font.mjs';

const f = Math.fround;
const S = f(L.CC_S); // the sim's f32 circumradius: hexAt and hexCentre must divide by it, not by 2.2
const TICK = 0.008;
const TURN = 16384;
const HH = 0.4; // a tile's half height, m
const DRAWN = 0.94; // a tile's drawn circumradius over the sim's: a seam between tiles
const FALL_G = 45; // m/s^2 a dropped tile falls at: faster than a ball, so it falls away from you
const DOWN = 7; // m a dropped tile sinks to
const RISE = 45; // ticks it takes to come back, ending as the drop ends
const LIFE = 1.6; // s a tile gone for good is drawn falling
const FLIP = 40; // ticks the new colours take to sweep from the middle to the rim
const LANTERN = 15; // m over the floor

// The colours, by index: the first four always, purple over CC_KN5 balls, orange over CC_KN6.
export const COLORS = [
  { name: 'RED', rgb: [0.93, 0.15, 0.13], hud: C.RED },
  { name: 'YELLOW', rgb: [1, 0.8, 0.08], hud: C.YELLOW },
  { name: 'GREEN', rgb: [0.15, 0.75, 0.24], hud: C.GREEN },
  { name: 'BLUE', rgb: [0.13, 0.4, 0.96], hud: C.CYAN },
  { name: 'PURPLE', rgb: [0.62, 0.24, 0.9], hud: C.PURPLE },
  { name: 'ORANGE', rgb: [1, 0.47, 0.05], hud: C.ORANGE },
];
const GREY = [0.45, 0.45, 0.49];

// ---- the schedule, as $cc_cycle_at, $cc_warn, $cc_when and $cc_rim have it

const LEN0 = L.CC_REST + L.CC_DROP + L.CC_WARN0;
const LEN1 = L.CC_REST + L.CC_DROP + L.CC_WARN1;
const LENSD = L.CC_REST + L.CC_DROP + L.CC_WARNSD;
export const warnOf = (c) => (c < L.CC_FULL ? L.CC_WARN0 - L.CC_WARNK * c : c < L.CC_SD ? L.CC_WARN1 : L.CC_WARNSD);
// Cycle c's first tick into play.
export function cycleAt(c) {
  if (c <= L.CC_FULL) return c * LEN0 - (L.CC_WARNK * c * (c - 1)) / 2;
  if (c <= L.CC_SD) return L.CC_T_FULL + (c - L.CC_FULL) * LEN1;
  return L.CC_T_SD + (c - L.CC_SD) * LENSD;
}
// The cycle on tick t into play (fractions dropped): c, its start s, the
// warning's w0, the drop's d0 and its end e (the next cycle's start).
export function when(t) {
  t = Math.max(0, Math.floor(t));
  let c = 0;
  if (t >= L.CC_T_SD) c = L.CC_SD + Math.floor((t - L.CC_T_SD) / LENSD);
  else if (t >= L.CC_T_FULL) c = L.CC_FULL + Math.floor((t - L.CC_T_FULL) / LEN1);
  else while (cycleAt(c + 1) <= t) c++;
  const s = cycleAt(c), w0 = s + L.CC_REST, d0 = w0 + warnOf(c);
  return { c, s, w0, d0, e: d0 + L.CC_DROP };
}
// The rim cycle c's drop leaves, in f32 as the sim has it.
export function rimOf(r0, c) {
  const k = c - (L.CC_SHRINK - 1);
  if (k <= 0) return r0;
  if (k >= L.CC_SHRINKN) return L.CC_RMIN;
  return f(r0 - f(f(r0 - L.CC_RMIN) * f(k / L.CC_SHRINKN)));
}

// ---- the board: the round's seed, radius and colours, read once a round

let memo = null;
// This round's board on the view's bank, its colours and calls worked out once.
export function stage(view) {
  const dv = view.dv, o = view.bank || 0;
  const r0 = dv.getFloat32(L.PG_H + L.CC_RAD + o, true), k = dv.getUint32(L.PG_H + L.CC_K + o, true) || 4;
  const cx = dv.getFloat32(L.PG_CX + o, true), s = dv.getUint32(L.HDR_SEED + o, true), h = dv.getUint32(L.HDR_HOLE + o, true);
  const m = memo;
  if (m && m.r0 === r0 && m.k === k && m.cx === cx && m.s === s && m.h === h) return m;
  memo = { r0, k, cx, s, h, seeds: new Map(), calls: new Map(), colours: new Map(), tiles: null, at: null, crowd: null };
  return memo;
}
const boardSeed = (st, c) => {
  let v = st.seeds.get(c);
  if (v === undefined) st.seeds.set(c, (v = hash32(st.s, st.h, L.CC_KBOARD + c)));
  return v;
};
// Tile (q, r)'s colour in cycle c ($cc_colour).
export const colourOf = (st, q, r, c) => hash32(q, r, boardSeed(st, c)) % st.k;
// Tile (q, r)'s centre's squared distance from the stage's centre, in f32 ($cc_in).
function d2Of(st, q, r) {
  const [x, z] = hexCentre(q, r, S, st.cx);
  const dx = f(x - st.cx), dz = f(z - st.cx);
  return f(f(dx * dx) + f(dz * dz));
}
const inside = (d2, rim) => d2 <= f(rim * rim);

// $cc_pick: a tile for cycle c's call whose colour is neither a nor b.
function pick(st, c, a, b) {
  const rim = rimOf(st.r0, c), sc = f(rim * 2 ** -15), base = hash32(st.s, st.h, L.CC_KCALL + c);
  for (let j = 0; j < L.CC_TRIES; j++) {
    const h = hash32(j, c, base);
    const x = f(f(((h & 0xffff) - 32768) * sc) + st.cx), z = f(f(((h >>> 16) - 32768) * sc) + st.cx);
    const [q, r] = hexAt(x, z, S, st.cx);
    if (!inside(d2Of(st, q, r), rim)) continue;
    const colour = colourOf(st, q, r, c);
    if (colour !== a && colour !== b) return { q, r, colour };
  }
  return { q: 0, r: 0, colour: colourOf(st, 0, 0, c) };
}
// Cycle c's call ($cc_call): its tile and colour.
export function callOf(st, c) {
  let v = st.calls.get(c);
  if (v) return v;
  v = c & 1 ? pick(st, c, callOf(st, c - 1).colour, callOf(st, c + 1).colour) : pick(st, c, -1, -1);
  st.calls.set(c, v);
  return v;
}
// Does tile (q, r) hold on tick t into play ($cc_ground, past the height test)?
export function holds(st, q, r, t, w = when(t)) {
  const d2 = d2Of(st, q, r);
  if (!inside(d2, rimOf(st.r0, w.c - 1))) return false;
  if (t < w.d0) return true;
  if (!inside(d2, rimOf(st.r0, w.c))) return false;
  const call = callOf(st, w.c);
  return w.c >= L.CC_SD ? q === call.q && r === call.r : colourOf(st, q, r, w.c) === call.colour;
}
// The calls slot p has lived through this round (CC_SURV, the confirmed world's).
export const survived = (view, p) => view.u8[L.PG_S + L.CC_SURV + p];
// Is there floor under (x, z) on tick t into play?
export function solidAt(st, x, z, t) {
  const [q, r] = hexAt(x, z, S, st.cx);
  return holds(st, q, r, Math.floor(t));
}

// Every tile the disc started with, and their colours a cycle at a time.
function tilesOf(st) {
  if (st.tiles) return st.tiles;
  const n = Math.ceil(st.r0 / S) + 2, r2 = f(st.r0 * st.r0), out = [];
  st.at = new Map();
  for (let r = -n; r <= n; r++) for (let q = -n; q <= n; q++) {
    const d2 = d2Of(st, q, r);
    if (d2 > r2) continue;
    const [x, z] = hexCentre(q, r, S, st.cx);
    st.at.set(key(q, r), out.length);
    out.push({ q, r, x, z, d2, rho: Math.sqrt(d2), wob: ((q * 7 + r * 13) & 15) / 16 });
  }
  st.tiles = out;
  return out;
}
const key = (q, r) => (q + 1024) * 2048 + r + 1024;
function coloursOf(st, c) {
  let v = st.colours.get(c);
  if (v) return v;
  const tiles = tilesOf(st);
  v = new Uint8Array(tiles.length);
  for (let i = 0; i < tiles.length; i++) v[i] = colourOf(st, tiles[i].q, tiles[i].r, c);
  if (st.colours.size > 8) st.colours.clear();
  st.colours.set(c, v);
  return v;
}

// Ticks into play to draw at (fractional), or -1 before play. Frozen where
// the round ended through the result.
function playTime(view, g, ctx) {
  if (g.state !== L.H_PLAY && g.state !== L.H_OVER) return -1;
  let t = typeof ctx?.t === 'number' && ctx.t > 0 ? ctx.t / TICK : g.t + (ctx?.dt || 0) / TICK;
  if (g.state === L.H_OVER) t = Math.min(t, (g.until - L.P_OVER - g.start) | 0);
  return Math.max(0, t);
}

const lift = (rgb, k) => [rgb[0] + (1 - rgb[0]) * k, rgb[1] + (1 - rgb[1]) * k, rgb[2] + (1 - rgb[2]) * k];
const dim = (rgb, k) => [rgb[0] * k, rgb[1] * k, rgb[2] * k];

// ---- the AI ball

const ball = (view, me) => (typeof me === 'number' ? view.partier(me) : me);
// Balls in, counted by the tile they're over, once per world tick.
function crowdOf(view, st) {
  if (st.crowd?.tick === view.tick && st.crowd.bank === view.bank) return st.crowd.count;
  const count = new Map();
  for (let p = 0; p < L.NPLAYER; p++) {
    const b = L.PLAYERS + view.bank + p * L.PSIZE;
    if ((view.u8[b + L.P_FL] & (L.PF_LIVE | L.PF_DEAD | L.PF_FALL)) !== L.PF_LIVE) continue;
    const [q, r] = hexAt(view.dv.getFloat32(b + L.P_PX, true), view.dv.getFloat32(b + L.P_PZ, true), S, st.cx);
    const k = key(q, r);
    count.set(k, (count.get(k) || 0) + 1);
  }
  st.crowd = { tick: view.tick, bank: view.bank, count };
  return count;
}
const NEAR = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
const MINDS = new WeakMap();
const SLOT_MINDS = [];
function mindOf(bot, slot) {
  if (bot && typeof bot === 'object') {
    let m = MINDS.get(bot);
    if (!m) MINDS.set(bot, (m = { c: -1 }));
    return m;
  }
  return (SLOT_MINDS[slot] ||= { c: -1 });
}
// A number in [0, 1) for this ball, this cycle and k: its own luck, from what anyone can see.
const luck = (st, slot, c, k) => hash32(slot * 977 + k, c, st.s ^ 0x5bd1e995) / 2 ** 32;

// What the ball wants on tick `tick` (the one its word is for): where to be,
// how fast to get there, whether to hop. Seen from a world `tick - view.tick` old.
function plan(view, me, bot, tick) {
  const g = view.party();
  const b = ball(view, me);
  if (!b || !b.live || b.out || g.state !== L.H_PLAY) return null;
  const st = stage(view);
  const t = Math.max(0, (tick - g.start) | 0);
  const w = when(t);
  const mind = mindOf(bot, b.slot);
  const skill = bot?.skill ?? 0.6;
  const lag = Math.max(0, Math.min(40, (tick - view.tick) | 0)) * TICK;
  const pos = [b.pos[0] + b.vel[0] * lag, b.pos[2] + b.vel[2] * lag];
  const vel = [b.vel[0], b.vel[2]];
  if (mind.c !== w.c) {
    // a new cycle: when it sees the call, and whether it reads it wrong at first
    mind.c = w.c;
    mind.react = w.w0 + Math.round((0.15 + 0.5 * (1 - skill) * luck(st, b.slot, w.c, 1)) / TICK);
    mind.misread = luck(st, b.slot, w.c, 2) < 0.22 * (1 - skill) && w.c < L.CC_SD;
    mind.target = null;
    mind.at = -1e9;
  }
  const rimP = rimOf(st.r0, w.c - 1), rimN = rimOf(st.r0, w.c);
  const rho = Math.hypot(pos[0] - st.cx, pos[1] - st.cx);
  if (t < mind.react) {
    // the rest: drift in off the grey ring and out of the crowd, and wait
    const keep = Math.max(1.5, Math.min(rimN - 2.5, rimP * 0.75));
    let gx = pos[0], gz = pos[1];
    if (rho > keep) { gx = st.cx + ((pos[0] - st.cx) / rho) * keep; gz = st.cx + ((pos[1] - st.cx) / rho) * keep; }
    const crowd = crowdOf(view, st);
    const [mq, mr] = hexAt(pos[0], pos[1], S, st.cx);
    if ((crowd.get(key(mq, mr)) || 0) > 1) {
      // someone on my tile: to the emptiest neighbour inside the rim
      let best = Infinity;
      for (const [a, c] of NEAR) {
        const [x, z] = hexCentre(mq + a, mr + c, S, st.cx);
        const s = (crowd.get(key(mq + a, mr + c)) || 0) + (Math.hypot(x - st.cx, z - st.cx) > keep ? 2 : 0) + luck(st, b.slot, w.c, 10 + a * 3 + c) * 0.5;
        if (s < best) { best = s; gx = x; gz = z; }
      }
    }
    return { goal: [gx, gz], vmax: 3, hop: false, pos, vel, w, st };
  }
  // the call: a tile that holds through the drop, near, not crowded, away from the rim
  const misled = mind.misread && t < mind.react + 50;
  if (!mind.target || t - mind.at >= 8) {
    mind.at = t;
    const call = callOf(st, w.c);
    const crowd = crowdOf(view, st);
    // the tiles the other AI balls are making for (what a player sees of where everyone is heading)
    if (st.claimC !== w.c) { st.claimC = w.c; st.claims = new Map(); }
    const claims = st.claims;
    const mine = mind.target && mind.claimC === w.c ? key(mind.target.q, mind.target.r) : -1;
    const ahead = [pos[0] + vel[0] * 0.25, pos[1] + vel[1] * 0.25];
    const [mq, mr] = hexAt(ahead[0], ahead[1], S, st.cx);
    const left = Math.max(0.05, (w.d0 - t) * TICK);
    let best = Infinity, pickT = null;
    const consider = (q, r) => {
      const ok = misled ? colourOf(st, q, r, w.c) !== call.colour && inside(d2Of(st, q, r), rimN) : holds(st, q, r, w.d0, w);
      if (!ok) return;
      const [x, z] = hexCentre(q, r, S, st.cx);
      const dist = Math.hypot(x - ahead[0], z - ahead[1]);
      const eta = dist / 6.5 + 0.15;
      const kk = key(q, r), own = kk === mine;
      const here = Math.hypot(pos[0] - x, pos[1] - z) < S;
      let s = eta + 0.9 * Math.max(0, (crowd.get(kk) || 0) - (here ? 1 : 0)) + 0.7 * Math.max(0, (claims.get(kk) || 0) - (own ? 1 : 0)) - (own ? 0.45 : 0);
      if (own && here) s -= 0.6; // already on it: mine
      if (eta > left + 0.2) s += 3 + eta;
      if (Math.hypot(x - st.cx, z - st.cx) > rimN - S) s += 0.25;
      s += luck(st, b.slot, w.c, 100 + ((q * 31 + r) & 63)) * 0.3 * (1 - skill);
      if (s < best) { best = s; pickT = { q, r, x, z }; }
    };
    if (w.c >= L.CC_SD && !misled) consider(call.q, call.r);
    else for (let dr = -5; dr <= 5; dr++) for (let dq = -5; dq <= 5; dq++) if (Math.abs(dq + dr) <= 5) consider(mq + dq, mr + dr);
    if (!pickT && !misled) consider(call.q, call.r);
    if (pickT) {
      const kk = key(pickT.q, pickT.r);
      if (kk !== mine) {
        if (mine >= 0) claims.set(mine, (claims.get(mine) || 1) - 1);
        claims.set(kk, (claims.get(kk) || 0) + 1);
      }
      mind.target = pickT;
      mind.claimC = w.c;
    }
  }
  const tg = mind.target;
  if (!tg) return { goal: [st.cx, st.cx], vmax: 6, hop: false, pos, vel, w, st };
  // a hop just before the drop, off a tile that won't hold, lands on the one that will
  let hop = false;
  if (t < w.d0 && w.d0 - t <= 40 && !misled && !solidAt(st, pos[0], pos[1], w.d0)) {
    const air = 2 * g.hop / 20;
    const land = [pos[0] + vel[0] * air, pos[1] + vel[1] * air];
    if (g.hop > 0 && solidAt(st, land[0], land[1], t + Math.round(air / TICK) + 2) && Math.hypot(vel[0], vel[1]) > 3) hop = true;
  }
  return { goal: [tg.x, tg.z], vmax: 10, hop, pos, vel, w, st };
}

// Push for the velocity that gets to goal and stops there: full speed while
// far, braking as it closes, no keys (the strong idle drag) once it's there.
function steer(p, last) {
  const dx = p.goal[0] - p.pos[0], dz = p.goal[1] - p.pos[1], d = Math.hypot(dx, dz);
  const want = Math.min(p.vmax, Math.sqrt(2 * 7 * Math.max(0, d - 0.2)));
  const vx = d > 1e-6 ? (dx / d) * want : 0, vz = d > 1e-6 ? (dz / d) * want : 0;
  const ax = vx - p.vel[0], az = vz - p.vel[1];
  if (Math.hypot(ax, az) < 0.7) return { yaw: last ?? 0, move: 0, hop: p.hop ? 1 : 0, use: 0 };
  return { yaw: Math.round((Math.atan2(az, ax) / (2 * Math.PI)) * TURN) & (TURN - 1), move: 1, hop: p.hop ? 1 : 0, use: 0 };
}

// The lantern over the middle: a hex of light, white until the call, then the call's colour.
function lantern(st, out, rgb, t, pulse) {
  const y = PLAT_Y + LANTERN;
  const col = rgb || [0.95, 0.95, 0.92];
  out.scene.hex(st.cx, y, st.cx, 2.6, 0.5, t * 0.5, ...col, LOOK.GLOW, rgb ? 1 + 0.4 * pulse : 0.25, 0.4);
  out.scene.cyl(st.cx, y + 2.6, st.cx, 0.08, 2.1, 0.3, 0.3, 0.33, LOOK.METAL);
  if (rgb) out.glow?.push({ pos: [st.cx, y, st.cx], size: 7 + 2 * pulse, color: [...rgb, 0.45], kind: SPRITE.FLASH });
}

export default {
  id: L.MG_COLOR, key: 'color', name: 'COLOR CALL',
  hint: 'GET ON THE COLOR CALLED  THE REST DROP  HOP THE GAPS  LAST ONE UP',
  env: 'day',

  draw(view, ctx, out) {
    const st = stage(view);
    if (!(st.r0 > 0)) return;
    const g = view.party();
    const tiles = tilesOf(st);
    const tp = playTime(view, g, ctx);
    const sc = out.scene;
    const rad = S * DRAWN;
    const y0 = PLAT_Y - HH;
    const now = (ctx?.now ?? 0) / 1000;
    if (tp < 0) {
      // the countdown: the first board, a slow shimmer running round it
      const cols = coloursOf(st, 0);
      for (let i = 0; i < tiles.length; i++) {
        const T = tiles[i];
        const k = 0.5 + 0.5 * Math.sin(now * 2 - T.rho * 0.35 + Math.atan2(T.z - st.cx, T.x - st.cx));
        sc.hex(T.x, y0, T.z, rad, HH, 0, ...lift(COLORS[cols[i]].rgb, 0.12 * k), LOOK.PLASTIC);
      }
      lantern(st, out, null, now, 0);
      return;
    }
    const w = when(tp);
    const c = w.c, sd = c >= L.CC_SD;
    const phase = tp < w.w0 ? 0 : tp < w.d0 ? 1 : 2;
    const call = callOf(st, c);
    const prev = c > 0 ? callOf(st, c - 1) : null;
    const prevD0 = c > 0 ? when(w.s - 1).d0 : -1e9;
    const r2A = f(rimOf(st.r0, c - 2) ** 2), r2P = f(rimOf(st.r0, c - 1) ** 2), r2N = f(rimOf(st.r0, c) ** 2), r2X = f(rimOf(st.r0, c + 1) ** 2);
    const cols = coloursOf(st, c);
    const colsP = c > 0 ? coloursOf(st, c - 1) : cols;
    const colsX = phase === 2 ? coloursOf(st, c + 1) : cols;
    const k = phase === 1 ? (tp - w.w0) / (w.d0 - w.w0) : 0;
    const pulse = 0.5 + 0.5 * Math.sin(tp * TICK * Math.PI * 2 * (2 + 3 * k));
    const shake = phase === 1 ? Math.max(0, 1 - (w.d0 - tp) / 56) : 0;
    const tau = (tp - w.d0) * TICK;
    for (let i = 0; i < tiles.length; i++) {
      const T = tiles[i];
      if (T.d2 > r2A) continue;
      if (T.d2 > r2P) {
        // gone for good at the last drop: still falling, tumbling, fading
        const a = (tp - prevD0) * TICK;
        if (a < LIFE) sc.hex(T.x, y0 - 0.5 * FALL_G * a * a, T.z, rad, HH, a * (T.wob - 0.5) * 3, ...GREY, LOOK.MATTE, 0, 0, 1 - a / LIFE);
        continue;
      }
      const doomed = T.d2 > r2N;
      const safe = !doomed && (sd ? T.q === call.q && T.r === call.r : cols[i] === call.colour);
      if (phase === 0) {
        // the new colours sweep out from the middle; a tile that held through the last drop flips with a hop
        const at = w.s + 6 + FLIP * (T.rho / st.r0);
        const held = c > 0 && T.d2 <= r2P && (c - 1 >= L.CC_SD ? T.q === prev.q && T.r === prev.r : colsP[i] === prev.colour);
        const flipped = !held || tp >= at;
        const u = held ? Math.min(1, Math.max(0, (tp - at) / 14)) : 1;
        const rgb = !flipped ? COLORS[colsP[i]].rgb : doomed ? GREY : COLORS[cols[i]].rgb;
        sc.hex(T.x, y0 + 0.35 * Math.sin(Math.PI * u), T.z, rad, HH, 0, ...lift(rgb, held && u < 1 ? 0.25 * Math.sin(Math.PI * u) : 0), doomed && flipped ? LOOK.MATTE : LOOK.PLASTIC);
      } else if (phase === 1) {
        if (safe) {
          sc.hex(T.x, y0 + 0.04 + 0.06 * pulse, T.z, rad, HH, 0, ...lift(COLORS[cols[i]].rgb, 0.1 * pulse), LOOK.GLOW, 0.15 + 0.3 * pulse, 0.55);
        } else {
          const j = shake * 0.08;
          const dx = j * Math.sin(tp * 2.3 + T.q * 5.1 + T.r * 2.7), dz = j * Math.sin(tp * 2.9 + T.q * 3.3 - T.r * 4.1);
          sc.hex(T.x + dx, y0, T.z + dz, rad, HH, 0, ...dim(doomed ? GREY : COLORS[cols[i]].rgb, 1 - 0.5 * k * k), doomed ? LOOK.MATTE : LOOK.PLASTIC);
        }
      } else if (safe) {
        sc.hex(T.x, y0, T.z, rad, HH, 0, ...COLORS[cols[i]].rgb, LOOK.GLOW, 0.4 + 0.1 * pulse, 0.55);
      } else if (doomed) {
        if (tau < LIFE) sc.hex(T.x, y0 - 0.5 * FALL_G * tau * tau, T.z, rad, HH, tau * (T.wob - 0.5) * 3, ...GREY, LOOK.MATTE, 0, 0, 1 - tau / LIFE);
      } else {
        // dropped: away fast, down a while, back up in the next cycle's colours as the drop ends
        const up = (w.e - tp) / RISE;
        let y = -Math.min(DOWN, 0.5 * FALL_G * tau * tau), rgb = dim(COLORS[cols[i]].rgb, 0.6);
        if (up < 1) { y = -DOWN * up * up; rgb = T.d2 > r2X ? GREY : COLORS[colsX[i]].rgb; }
        sc.hex(T.x, y0 + y, T.z, rad, HH, 0, ...rgb, LOOK.PLASTIC);
      }
    }
    // the call over the board: the halo round it, and in sudden death the one tile's beam and target
    const callRgb = phase > 0 ? COLORS[call.colour].rgb : null;
    const edge = Math.sqrt(r2P) + S * 1.05;
    if (callRgb) out.decals?.push({ pos: [st.cx, PLAT_Y + 0.03, st.cx], radius: edge, width: 0.8, color: [...callRgb, 0.65 + 0.3 * pulse], kind: DECAL.RING });
    else out.decals?.push({ pos: [st.cx, PLAT_Y + 0.03, st.cx], radius: edge, width: 0.4, color: [1, 1, 1, 0.22], kind: DECAL.RING });
    if (sd && phase > 0) {
      const [x, z] = hexCentre(call.q, call.r, S, st.cx);
      out.decals?.push({ pos: [x, PLAT_Y + 0.12, z], radius: S * 0.85, width: 0.25, color: [1, 0.95, 0.6, 0.9], kind: DECAL.TARGET });
      out.beams?.push({ a: [x, PLAT_Y + 40, z], b: [x, PLAT_Y + 0.2, z], width: 0.5 + 0.3 * pulse, color: [1, 0.93, 0.6, 0.55] });
    }
    lantern(st, out, callRgb, tp * TICK, pulse);
  },

  // the board as it stands, the rim the last drop left
  frame(view) {
    const st = stage(view);
    const g = view.party();
    const c = g.state === L.H_PLAY ? when(g.t).c : 0;
    const r = (st.r0 > 0 ? rimOf(st.r0, c - 1) : g.size) + S;
    return { centre: [st.cx || g.cx, PLAT_Y, st.cx || g.cx], radius: r, shape: 'disc' };
  },

  fx(fx, ctx) {
    const colour = COLORS[fx.shot & 15] || COLORS[0];
    const c = fx.shot >> 4;
    if (fx.kind === L.CC_FX_CALL) {
      if (c >= L.CC_SD) ctx.banner?.(c === L.CC_SD ? 'SUDDEN DEATH  ONE TILE HOLDS' : `ONE TILE  ${colour.name}`, C.YELLOW, 1600);
      else ctx.banner?.(`${colour.name}!`, colour.hud, 1300);
      ctx.sound?.pickup?.();
      ctx.glow?.({ pos: [fx.pos[0], fx.pos[1] + 0.1, fx.pos[2]], size: 3, color: [...colour.rgb, 0.8], kind: SPRITE.RING, life: 500, grow: true });
    } else if (fx.kind === L.CC_FX_DROP) {
      ctx.sound?.land?.(28);
      ctx.sound?.count?.(0);
    } else if (fx.kind === L.CC_FX_RISE) {
      ctx.sound?.tick?.();
      if (c === L.CC_SHRINK) ctx.banner?.('GREY TILES FALL FOR GOOD', C.ORANGE, 1800);
      if (c === L.CC_SD) ctx.banner?.('SUDDEN DEATH', C.YELLOW, 1800);
    }
  },

  // the call, big, with the time it leaves and whether you're on it
  hud(view, ctx) {
    const g = view.party();
    if (g.state !== L.H_PLAY) return;
    const st = stage(view);
    const tp = playTime(view, g, ctx);
    if (tp < 0 || !(st.r0 > 0)) return;
    const w = when(tp);
    const c = w.c, sd = c >= L.CC_SD;
    const call = callOf(st, c), col = COLORS[call.colour];
    const row = Math.max(3, Math.floor((ctx.rows || 40) * 0.18));
    const bar = (u, n = 24) => '#'.repeat(Math.max(0, Math.min(n, Math.round(u * n)))).padEnd(n, '.');
    const me = ctx.me ?? (ctx.slot >= 0 ? view.partier(ctx.slot) : null);
    const playing = me && me.live && !me.out;
    if (tp < w.w0) {
      ctx.centre(row, c === 0 ? 'GET READY' : sd ? 'SUDDEN DEATH' : `CALL ${c + 1}`, sd ? C.YELLOW : C.WHITE);
      if (rimOf(st.r0, c) < rimOf(st.r0, c - 1)) ctx.centre(row + 1, sd ? 'ONE TILE WILL HOLD' : 'GREY TILES FALL FOR GOOD', C.ORANGE);
    } else if (tp < w.d0) {
      ctx.centre(row, sd ? `ONE TILE  ${col.name}` : `>>  ${col.name}  <<`, col.hud);
      ctx.centre(row + 1, `${bar((w.d0 - tp) / (w.d0 - w.w0))} ${((w.d0 - tp) * TICK).toFixed(1)}`, col.hud);
      if (playing) {
        const ok = solidAt(st, me.pos[0], me.pos[2], w.d0);
        ctx.centre(row + 2, ok ? 'SAFE' : 'MOVE!', ok ? C.GREEN : C.RED);
      }
    } else {
      ctx.centre(row, `HOLD ON  ${col.name}`, col.hud);
      ctx.centre(row + 1, bar((w.e - tp) / L.CC_DROP), C.GREY);
    }
    const right = `CALL ${c + 1}  ${(warnOf(c) * TICK).toFixed(1)}S` + (playing ? `  SURVIVED ${survived(view, me.slot)}` : '');
    ctx.right(3, right, C.GREY);
  },

  brain: {
    // no floor at (x, z) on tick `tick` is a fall; through the warning, a
    // tile that won't hold is worse the nearer the drop; the grey ring and
    // the edge a little
    danger(view, x, z, tick) {
      const g = view.party();
      if (g.state !== L.H_PLAY) return 0;
      const st = stage(view);
      const t = Math.max(0, (tick - g.start) | 0);
      const w = when(t);
      const [q, r] = hexAt(x, z, S, st.cx);
      if (!holds(st, q, r, t, w)) return 1;
      if (t >= w.w0 && t < w.d0 && !holds(st, q, r, w.d0, w)) return 0.3 + 0.65 * ((t - w.w0) / (w.d0 - w.w0));
      const d2 = d2Of(st, q, r);
      if (!inside(d2, rimOf(st.r0, w.c))) return 0.45;
      return Math.sqrt(d2) > rimOf(st.r0, w.c - 1) - S ? 0.15 : 0;
    },
    // in the rest, in off the grey ring and out of the crowd; once the call
    // is seen, the near, uncrowded tile that holds
    goal(view, me, bot) {
      const p = plan(view, me, bot, view.tick);
      return p ? p.goal : null;
    },
    hop(view, me, bot) {
      const p = plan(view, me, bot, view.tick);
      return !!p?.hop;
    },
    // all of it, as a word's fields (yaw in 1/16384 turn, as partyWord takes it)
    think(view, me, bot, tick = view.tick) {
      const p = plan(view, me, bot, tick);
      if (!p) return null;
      const mind = mindOf(bot, ball(view, me).slot);
      const s = steer(p, mind.yaw);
      mind.yaw = s.yaw;
      return s;
    },
  },
};
