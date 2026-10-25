// SNOWBALL, as drawn and as the AI ball sees it. A round slab of snow on a
// berg of blue ice over a grey sea, in falling snow, the tracks the balls
// roll in it laid over it (the sim's snow grid as the paint layer): faint
// till they pack, then blue-grey, fading as the snow fills them. Once the rim
// starts to crumble its last metre greys and cracks, rings of chunks break
// off it and drop away, and the ring it stops at is marked. Pines in tiers
// of green with snow on each, until the rim reaches one and it goes down with
// the snow. Every ball is a white snowball with its rider's colour as a band
// round it and a few pebbles turning with it as it rolls (the module draws
// the balls: drawsBalls), its size the record's PG_M (src/mg/snowball.wat);
// in play a red ring round one that can swallow you, a green one round one
// you can swallow (the line rising once the rim is in). The brain: away from the balls that can swallow it (and
// their way), it hunts the one it can swallow that it reaches soonest,
// leading it; with neither near it rolls on the way with the most fresh snow
// (the more skilled, the keener), never standing still; once the rim is
// nearly in it rams a lighter ball by the edge from the inside; and it keeps
// off the rim by more the bigger and faster it is.
import * as L from '../../src/layout.mjs';
import * as MC from '../../src/mg/snowball.mjs'; // SB_*: the minigame's own constants
import { PLAT_Y } from '../../src/party-view.mjs';
import { LOOK, SPRITE, DECAL } from '../party-render.mjs';
import { C } from '../font.mjs';

const TICK = 0.008;
const SNOW = [0.93, 0.95, 0.99];
const LIP = [0.74, 0.79, 0.86]; // the metre of rim about to go
const BERG = [0.42, 0.7, 0.9];
const PINE = [[0.12, 0.36, 0.22], [0.15, 0.42, 0.25], [0.18, 0.47, 0.28], [0.2, 0.52, 0.3]];
const BARK = [0.38, 0.25, 0.16];
const THREAT = [1, 0.2, 0.15];
const PREY = [0.45, 1, 0.5];
const slotColor = (s) => { const h = (s * 0.618034) % 1; return [0, 0.33, 0.67].map((o) => 0.55 + 0.4 * Math.cos(6.2832 * (h + o))); };

// ---- what the sim says

// $sb_rim in doubles: the rim tp ticks into play on a field of r0.
export function rimAt(r0, tp) {
  const k = tp - MC.SB_CALM;
  if (k <= 0) return r0;
  if (k >= MC.SB_SHRINK) return MC.SB_RMIN;
  return r0 - (r0 - MC.SB_RMIN) * (k / MC.SB_SHRINK);
}
// A ball's radius on the view's bank, as $b_rad reads it in a sized round.
export const radiusOf = (view, p) => Math.max(view.dv.getFloat32(L.PLAYERS + (view.bank || 0) + p * L.PSIZE + L.PG_M, true), MC.SB_B0);
// $sb_eatk in f32: the swallowing line tp ticks into play, SB_EATK till the
// rim is in, then up to SB_EATK1 at the clock.
const f = Math.fround;
export function eatkAt(tp) {
  const k = tp - (MC.SB_CALM + MC.SB_SHRINK);
  if (k <= 0) return MC.SB_EATK;
  return Math.min(f(f(f(f(k) * f(MC.SB_EATK1 - MC.SB_EATK)) / f(MC.SB_LEN - MC.SB_CALM - MC.SB_SHRINK)) + f(MC.SB_EATK)), MC.SB_EATK1);
}
// Is the rim in (no more wear) tp ticks into play?
export const rimIn = (tp) => tp >= MC.SB_CALM + MC.SB_SHRINK;
// Can a ball of radius a swallow one of radius b, the line at k?
export const swallows = (a, b, k = MC.SB_EATK) => f(b) < f(f(a) * f(k));

// The snow's cell under (x, z) ($sb_cell), -1 off the grid; is it fresh on tick t ($sb_fresh)?
export function cellAt(cx, x, z) {
  const x0 = Math.fround(cx - MC.SB_GN / 2);
  const i = Math.floor(Math.fround(x - x0)), j = Math.floor(Math.fround(z - x0));
  return i < 0 || j < 0 || i >= MC.SB_GN || j >= MC.SB_GN ? -1 : j * MC.SB_GN + i;
}
export function freshAt(view, c, t) {
  if (c < 0) return true;
  const v = view.dv.getUint32(L.PG_BIG + MC.SB_GRID + 4 * c, true), a = (t - v) >>> 0;
  return v === 0 || a < MC.SB_PACK || a >= MC.SB_REFILL;
}

// The field on the view's bank, read once a round: its radius at the start, its centre, its pines.
const STAGES = new WeakMap();
export function stage(view) {
  const dv = view.dv, o = view.bank || 0;
  const r0 = dv.getFloat32(L.PG_H + MC.SB_RAD + o, true), np = dv.getUint32(L.PG_H + MC.SB_NP + o, true);
  const hole = dv.getUint32(L.HDR_HOLE + o, true), seed = dv.getUint32(L.HDR_SEED + o, true), cx = dv.getFloat32(L.PG_CX + o, true);
  let st = STAGES.get(dv.buffer);
  if (st && st.r0 === r0 && st.np === np && st.hole === hole && st.seed === seed && st.cx === cx) return st;
  const pines = [];
  for (let k = 0; k < np; k++) {
    const x = dv.getFloat32(L.PG_S + MC.SB_PINE + 8 * k, true), z = dv.getFloat32(L.PG_S + MC.SB_PINE + 8 * k + 4, true);
    pines.push({ x, z, rho: Math.hypot(x - cx, z - cx), yaw: k * 1.7 });
  }
  st = { r0, np, hole, seed, cx, pines };
  STAGES.set(dv.buffer, st);
  return st;
}
// Ticks into play on the view's bank at tick t (the sim's i32 subtraction wraps).
const tpOf = (view, t) => (view.dv.getUint32(L.HDR_STATE + (view.bank || 0), true) >= L.H_PLAY ? (t - view.dv.getUint32(L.HDR_START + (view.bank || 0), true)) | 0 : 0);
const playing = (view) => view.dv.getUint32(L.HDR_STATE + (view.bank || 0), true) === L.H_PLAY;

// Every ball in on the view's tick, with its size, in a grid of CELL m; once a tick (and bank).
const CELL = 8;
const WORLDS = new WeakMap();
function world(view) {
  const dv = view.dv, o = view.bank || 0, tick = dv.getUint32(L.HDR_TICK + o, true);
  let w = WORLDS.get(dv.buffer);
  if (w && w.tick === tick && w.bank === o) return w;
  const balls = [], grid = new Map();
  let big = null;
  for (let p = 0; p < L.NPLAYER; p++) {
    const a = L.PLAYERS + o + p * L.PSIZE;
    if ((view.u8[a + L.P_FL] & (L.PF_LIVE | L.PF_DEAD | L.PF_FALL)) !== L.PF_LIVE) continue;
    const b = { slot: p, x: dv.getFloat32(a + L.P_PX, true), y: dv.getFloat32(a + L.P_PY, true), z: dv.getFloat32(a + L.P_PZ, true),
      vx: dv.getFloat32(a + L.P_VX, true), vz: dv.getFloat32(a + L.P_VZ, true), r: Math.max(dv.getFloat32(a + L.PG_M, true), MC.SB_B0), ate: dv.getUint16(a + L.PG_SCORE, true) };
    balls.push(b);
    if (!big || b.r > big.r) big = b;
    const k = cellOf(b.x, b.z);
    const list = grid.get(k);
    if (list) list.push(b); else grid.set(k, [b]);
  }
  const tp = tpOf(view, tick);
  // the line now, and as a bot will meet it (a round trip on)
  w = { tick, bank: o, balls, grid, big, st: stage(view), start: dv.getUint32(L.HDR_START + o, true), claims: new Map(), tp, eatk: eatkAt(tp), eatkSoon: eatkAt(tp + 40) };
  WORLDS.set(dv.buffer, w);
  return w;
}
const cellOf = (x, z) => Math.floor(x / CELL) * 4096 + Math.floor(z / CELL);
// The balls within r of (x, z), but slot.
function within(w, x, z, r, slot, out = []) {
  out.length = 0;
  const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL), z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
  for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
    const list = w.grid.get(i * 4096 + j);
    if (list) for (const b of list) if (b.slot !== slot && (b.x - x) ** 2 + (b.z - z) ** 2 < r * r) out.push(b);
  }
  return out;
}
const ball = (view, me) => (typeof me === 'number' ? view.partier(me) : me);

// ---- the AI ball

// The balls near a bot that can swallow it (within 24 m, the nearest 8), and
// the ones it can swallow (within 30 m): once a think (danger is asked 90 times).
const NEAR = { slot: -1, w: null, threats: [], prey: [], r: 1 };
function sizeUp(me, w) {
  if (NEAR.slot === me.slot && NEAR.w === w) return NEAR;
  NEAR.slot = me.slot; NEAR.w = w; NEAR.r = me.radius;
  const x = me.pos[0], z = me.pos[2];
  const d2 = (b) => (b.x - x) ** 2 + (b.z - z) ** 2;
  const all = within(w, x, z, 30, me.slot, []);
  NEAR.threats = all.filter((b) => swallows(b.r, me.radius, w.eatkSoon) && d2(b) < 24 * 24).sort((a, b) => d2(a) - d2(b) || a.slot - b.slot).slice(0, 8);
  // a margin under the line: its size is a round trip old
  NEAR.prey = all.filter((b) => b.r < me.radius * w.eatk * 0.985);
  return NEAR;
}

// danger's memo for one think: the view and the record it was handed
const DANGER = { view: null, me: null, off: true, n: null, r: 1, m: 1, r0: 0, cx: 0, start: 0, tick: 0 };

// How far in off the rim a ball of radius r rolling at sp m/s wants to keep:
// its skin, and the more the heavier and faster (it turns and stops r times slower).
const margin = (r, sp) => r + 0.8 + 0.18 * (r - 1) * sp;

// A point inside the rim by m, on the way from the centre to (x, z) if it's past it.
function inside(st, rim, x, z, m) {
  const dx = x - st.cx, dz = z - st.cx, d = Math.hypot(dx, dz), lim = Math.max(0.5, rim - m);
  return d > lim ? [st.cx + dx / d * lim, st.cx + dz / d * lim] : [x, z];
}

// A bot's goal: the prey it gets to soonest (bigger prey a little keener, one
// another bot already hunts a little less), led by where it rolls; else the
// best of 12 points 9 m round it when a ball that can swallow it is near; else
// on round the field in open snow (each bot its own way round), growing.
function plan(view, me, bot, w) {
  const st = w.st;
  const x = bot?.pos?.[0] ?? me.pos[0], z = bot?.pos?.[1] ?? me.pos[2];
  const vx = bot?.vel?.[0] ?? me.vel[0], vz = bot?.vel?.[1] ?? me.vel[2];
  const sp = Math.hypot(vx, vz);
  const t = bot?.at ?? view.tick;
  const tp = tpOf(view, t);
  const rim = rimAt(st.r0, tp + 60);
  const r = me.radius;
  const mem = bot?.mem || {};
  const skill = bot?.skill ?? 0.6;
  const n = sizeUp(me, w);
  const keep = margin(r, sp) + 1;
  // run from what can swallow it, when one is close
  const close = n.threats.filter((b) => Math.hypot(b.x - x, b.z - z) < b.r + r + 3 + 9 * skill);
  if (close.length) {
    let best = null, score = -Infinity;
    for (let k = 0; k <= 12; k++) {
      const [cx, cz] = k === 12 ? [st.cx, st.cx] : inside(st, rim, x + Math.cos(k * Math.PI / 6) * 9, z + Math.sin(k * Math.PI / 6) * 9, keep);
      const ux = cx - x, uz = cz - z, len = Math.hypot(ux, uz) || 1;
      let s = 0;
      for (const e of close) {
        const ex = e.x + e.vx * 0.6, ez = e.z + e.vz * 0.6;
        s -= 6 / (Math.hypot(cx - ex, cz - ez) - e.r + 1.5);
        const along = ((ex - x) * ux + (ez - z) * uz) / len;
        if (along > 0 && along < len) {
          const off = Math.abs((ex - x) * uz - (ez - z) * ux) / len;
          if (off < e.r + r + 1) s -= (e.r + r + 1 - off) * 0.6;
        }
      }
      if (sp > 2 && k < 12) s += 0.3 * (ux * vx + uz * vz) / (len * sp);
      if (s > score) { score = s; best = [cx, cz]; }
    }
    mem.mode = 'flee';
    return best;
  }
  // hunt the prey it reaches soonest
  let pick = null, bs = Infinity;
  for (const b of n.prey) {
    const d = Math.hypot(b.x - x, b.z - z);
    const brho = Math.hypot(b.x - st.cx, b.z - st.cx);
    let s = d / 10 - 0.6 * b.r + 0.5 * (w.claims.get(b.slot) || 0);
    if (mem.prey === b.slot) s -= 0.5;
    if (brho > rim - keep) s += 1.5; // out by the rim: a chase that ends in the sea
    if (s < bs) { bs = s; pick = b; }
  }
  if (pick) {
    mem.prey = pick.slot;
    mem.mode = 'hunt';
    w.claims.set(pick.slot, (w.claims.get(pick.slot) || 0) + 1);
    const d = Math.hypot(pick.x - x, pick.z - z);
    const lead = Math.min(0.9, d / 11) * (0.4 + 0.6 * skill);
    return inside(st, rim, pick.x + pick.vx * lead, pick.z + pick.vz * lead, r + 0.6);
  }
  // the rim nearly in: a lighter ball near it, rammed outward from the inside
  if (rim < MC.SB_RMIN + 6) {
    let shove = null, sd = Infinity;
    for (const b of within(w, x, z, 12, me.slot, [])) {
      const brho = Math.hypot(b.x - st.cx, b.z - st.cx);
      if (b.r > r * 0.95 || brho < rim - b.r - 4 || brho < 1) continue;
      const d = Math.hypot(b.x - x, b.z - z);
      // from its inside only: a ball between it and the centre
      if (Math.hypot(x - st.cx, z - st.cx) > brho) continue;
      if (d < sd) { sd = d; shove = b; }
    }
    if (shove) {
      mem.mode = 'shove';
      const brho = Math.hypot(shove.x - st.cx, shove.z - st.cx);
      return [shove.x + (shove.x - st.cx) / brho * 3, shove.z + (shove.z - st.cx) / brho * 3];
    }
  }
  // grow: the way, of 12 round it, with the most fresh snow along the next
  // 12 m, in off the rim, away from the balls near that it can't swallow, a
  // little for keeping on as it goes; kept for half a second
  mem.mode = 'grow';
  if (mem.grow && t - mem.grow.at < 62 && Math.hypot(mem.grow.x - x, mem.grow.z - z) > 4) return [mem.grow.x, mem.grow.z];
  const near = within(w, x, z, 14, me.slot, []).filter((b) => !swallows(r, b.r, w.eatk));
  // how much it cares for fresh snow: a weak player rolls the tracks as often as not
  const fresh = 0.15 + 1.6 * skill * skill;
  let best = null, score = -Infinity;
  for (let k = 0; k < 12; k++) {
    const a = k * Math.PI / 6 + (bot?.rand ? (bot.rand() - 0.5) * 0.4 : 0), ux = Math.cos(a), uz = Math.sin(a);
    let s = 0;
    for (let d = 2; d <= 12; d += 2) {
      const px = x + ux * d, pz = z + uz * d;
      if (Math.hypot(px - st.cx, pz - st.cx) > rim - keep) { s -= 3; break; }
      if (freshAt(view, cellAt(st.cx, px, pz), view.tick)) s += fresh;
    }
    for (const b of near) {
      const dx = b.x - x, dz = b.z - z, d = Math.hypot(dx, dz) || 1;
      if ((dx * ux + dz * uz) / d > 0.5) s -= 2 * (b.r + r) / d;
    }
    if (sp > 2) s += 1.2 * (ux * vx + uz * vz) / sp;
    if (s > score) { score = s; best = inside(st, rim, x + ux * 12, z + uz * 12, keep); }
  }
  mem.grow = { x: best[0], z: best[1], at: t };
  return best;
}

// ---- drawing

// The tracks: the snow grid as the renderer's paint layer over the snow's
// top, worked again once a tick: rolled snow a faint grey till it packs,
// packed snow blue-grey with a sheen, fading as the snow covers it again.
const N = MC.SB_GN;
const TRACKS = { cells: new Uint8Array(N * N), n: N, origin: [0, 0], size: N, palette: new Float32Array(1024), version: -1, buf: null, grid: null };
TRACKS.palette.set([0.8, 0.85, 0.93, 0.35], 4);
for (let k = 0; k < 8; k++) TRACKS.palette.set([0.5, 0.61, 0.78, 0.72 - 0.075 * k], 4 * (2 + k));
export function tracks(view, st, t) {
  const T = TRACKS;
  if (T.buf !== view.dv.buffer) { T.buf = view.dv.buffer; T.grid = new Uint32Array(T.buf, L.PG_BIG + MC.SB_GRID, N * N); T.version = -1; }
  const x0 = Math.fround(st.cx - N / 2);
  if (T.version === t && T.origin[0] === x0) return T;
  T.origin = [x0, x0];
  const g = T.grid, c = T.cells, span = MC.SB_REFILL - MC.SB_PACK;
  for (let k = 0; k < N * N; k++) {
    const v = g[k];
    if (!v) { c[k] = 0; continue; }
    const a = (t - v) >>> 0;
    c[k] = a < MC.SB_PACK ? 1 : a >= MC.SB_REFILL ? 0 : 2 + Math.min(7, Math.floor((a - MC.SB_PACK) * 8 / span));
  }
  T.version = t;
  return T;
}

// Where ball p is drawn on this frame: [x, y (its bottom), z, r]; your own at the frontend's spot.
function drawnAt(view, ctx, p) {
  if (ctx.own && p === ctx.slot && ctx.pme && !ctx.pme.out) return [ctx.own[0], ctx.own[1], ctx.own[2], ctx.pme.radius];
  const d = view.dv, a = L.PLAYERS + p * L.PSIZE, dt = ctx.dt || 0;
  return [d.getFloat32(a + L.P_PX, true) + d.getFloat32(a + L.P_VX, true) * dt, d.getFloat32(a + L.P_PY, true) + d.getFloat32(a + L.P_VY, true) * dt,
    d.getFloat32(a + L.P_PZ, true) + d.getFloat32(a + L.P_VZ, true) * dt, radiusOf(view, p)];
}
// The pebbles in a snowball, in its own frame: they turn with it as it rolls.
const PEBBLES = [[0.62, 0.55, 0.56], [-0.7, 0.2, 0.68], [0.1, -0.75, -0.65], [-0.35, 0.8, -0.48], [0.85, -0.3, -0.42]].map((v) => { const n = Math.hypot(...v); return v.map((c) => c / n); });
const rolls = new Map(); // slot -> { frame }: its pebbles as it has turned them
// v turned by ang about the unit axis (ax, 0, az)
function turn(v, ax, az, ang) {
  const c = Math.cos(ang), s = Math.sin(ang), d = v[0] * ax + v[2] * az;
  // Rodrigues: v c + (k x v) s + k (k . v)(1 - c), k = (ax, 0, az)
  return [v[0] * c + (-az * v[1]) * s + ax * d * (1 - c), v[1] * c + (az * v[0] - ax * v[2]) * s, v[2] * c + (ax * v[1]) * s + az * d * (1 - c)];
}

export default {
  id: L.MG_SNOWBALL, key: 'snowball', name: 'SNOWBALL',
  hint: 'ROLL FRESH SNOW TO GROW  SWALLOW ANYONE UNDER 3/4 YOUR SIZE',
  rules: 'OLD TRACKS WEAR YOU DOWN  STILL, YOU MELT  THE RIM CRUMBLES IN',
  env: 'snow',
  drawsBalls: true,

  draw(view, ctx, out) {
    const st = stage(view);
    if (!(st.r0 > 0)) return;
    const g = view.party();
    const sc = out.scene, cx = st.cx;
    // the rim on the prediction's clock: your ball drops as the edge goes from under it
    const tp = g.state === L.H_PLAY ? (ctx.pt ?? ctx.t ?? 0) / TICK : g.state === L.H_OVER ? Math.max(0, ((g.until - L.P_OVER) - g.start) | 0) : 0;
    const R = rimAt(st.r0, tp);
    const going = tp > MC.SB_CALM - 250;
    // the berg under the snow, the snow, its last metre greying and cracked once the rim is going
    sc.cyl(cx, PLAT_Y - 4.2, cx, Math.max(1, R - 0.6), 2.6, ...BERG, LOOK.ICE, 0, 0.2, 1, 7);
    sc.cyl(cx, PLAT_Y - 9, cx, Math.max(1, R * 0.7), 2.4, ...BERG.map((c) => c * 0.8), LOOK.ICE, 0, 0, 1, 9);
    if (going && R > MC.SB_RMIN + 0.01) {
      sc.cyl(cx, PLAT_Y - 0.82, cx, R, 0.8, ...LIP, LOOK.ICE, 0.75, 0.9, 1, 3);
      sc.cyl(cx, PLAT_Y - 0.8, cx, Math.max(0.5, R - 1), 0.8, ...SNOW, LOOK.PAINT, 0, 0, 1, 5);
      out.decals?.push({ pos: [cx, PLAT_Y + 0.02, cx], radius: MC.SB_RMIN, width: 0.18, color: [0.35, 0.6, 1, 0.45], kind: DECAL.RING });
    } else sc.cyl(cx, PLAT_Y - 0.8, cx, R, 0.8, ...SNOW, LOOK.PAINT, 0, 0, 1, 5);
    out.paint = tracks(view, st, view.tick);
    // chunks: a ring breaks off every metre the rim comes in, and falls for 1.6 s
    if (going) {
      const per = MC.SB_SHRINK / Math.max(1, st.r0 - MC.SB_RMIN); // ticks a metre
      for (let k = 1; st.r0 - k >= MC.SB_RMIN; k++) {
        const at = MC.SB_CALM + k * per, s = (tp - at) * TICK;
        if (s > 1.6) continue;
        if (s < 0) break;
        const rr = st.r0 - k + 0.5, n = Math.max(12, Math.ceil(2 * Math.PI * rr / 1.4));
        for (let j = 0; j < n; j++) {
          const h = ((j * 2654435761 + k * 40503) >>> 0) / 2 ** 32;
          const a = (j + h * 0.6) / n * 2 * Math.PI, out2 = 0.3 + 1.5 * s * h;
          const y = PLAT_Y - 0.5 - (0.5 + 0.5 * h) * 12 * s * s;
          sc.box(cx + Math.cos(a) * (rr + out2), y, cx + Math.sin(a) * (rr + out2), 0.42 + 0.2 * h, 0.4, 0.5, a + s * (2 + 3 * h), ...(h > 0.5 ? SNOW : LIP), LOOK.MATTE, 0, 0, 1, j);
        }
      }
    }
    // the pines: standing till the rim reaches one, then down with the snow
    for (const p of st.pines) {
      let y0 = PLAT_Y;
      if (p.rho >= R) {
        // when the rim passed it, and how long it has been falling
        const passed = MC.SB_CALM + (st.r0 - p.rho) / Math.max(1e-3, st.r0 - MC.SB_RMIN) * MC.SB_SHRINK;
        const s = (tp - passed) * TICK;
        if (s > 2.5) continue;
        y0 -= 6 * s * s;
      }
      sc.cyl(p.x, y0 + 1.3, p.z, 0.32, 1.3, ...BARK, LOOK.WOOD, 0, 0, 1, 11);
      const tiers = [[2.0, 2.0], [1.6, 3.3], [1.15, 4.6], [0.7, 5.8]];
      tiers.forEach(([tr, ty], i) => {
        sc.hex(p.x, y0 + ty + 0.55, p.z, tr, 0.55, p.yaw + i * 0.5, ...PINE[i], LOOK.MATTE, 0, 0, 1, 13 + i);
        sc.hex(p.x, y0 + ty + 1.12, p.z, tr * 0.72, 0.08, p.yaw + i * 0.5 + 0.3, ...SNOW, LOOK.MATTE, 0, 0, 1, 17 + i);
      });
      sc.sphere(p.x, y0 + 7.3, p.z, 0.3, ...SNOW, LOOK.MATTE);
    }
    if (g.state !== L.H_COUNT && g.state !== L.H_PLAY && g.state !== L.H_OVER) return;
    // the snowballs: white, a band of the rider's colour, pebbles turning as it rolls
    const cam = ctx.cam || [cx, PLAT_Y + 50, cx];
    const ms = ctx.ms || 16;
    const myR = ctx.pme && !ctx.pme.out ? ctx.pme.radius : ctx.me && !ctx.me.out ? ctx.me.radius : 0;
    const kk = eatkAt(tp);
    for (let p = 0; p < L.NPLAYER; p++) {
      const a = L.PLAYERS + p * L.PSIZE;
      const fl = view.u8[a + L.P_FL];
      if ((fl & (L.PF_LIVE | L.PF_DEAD)) !== L.PF_LIVE) { rolls.delete(p); continue; }
      const [x, y, z, r] = drawnAt(view, ctx, p);
      const own = p === ctx.slot;
      const near = Math.hypot(x - cam[0], y + r - cam[1], z - cam[2]);
      if (!own && near < r + 2.5) continue;
      // a big one by the lens would hide the ball followed: see-through
      const alpha = !own && near < r * 1.5 + 5 ? 0.3 : 1;
      const vx = own && ctx.pme ? ctx.pme.vel[0] : view.dv.getFloat32(a + L.P_VX, true), vz = own && ctx.pme ? ctx.pme.vel[2] : view.dv.getFloat32(a + L.P_VZ, true);
      const sp = Math.hypot(vx, vz);
      let rl = rolls.get(p);
      if (!rl) { rl = { frame: [...PEBBLES] }; rolls.set(p, rl); }
      if (sp > 0.05) {
        // the axis it rolls about, (vz, 0, -vx) / sp, the pebbles carried round it
        const ax = vz / sp, az = -vx / sp, da = sp * ms / 1000 / r;
        rl.frame = rl.frame.map((v) => { const u = turn(v, ax, az, da), n = Math.hypot(...u); return [u[0] / n, u[1] / n, u[2] / n]; });
      }
      const col = slotColor(p);
      sc.sphere(x, y + r, z, r, ...SNOW, LOOK.MATTE, 0, 0, alpha, p);
      sc.cyl(x, y + r, z, r * 1.025, Math.max(0.1, r * 0.12), ...col, LOOK.PLASTIC, 0, 0, alpha, p);
      if (alpha < 1) continue;
      for (const v of rl.frame) {
        // (one under the band would hide in it)
        if (Math.abs(v[1]) < 0.16) continue;
        sc.sphere(x + v[0] * r * 0.97, y + r + v[1] * r * 0.97, z + v[2] * r * 0.97, Math.max(0.06, r * 0.055), 0.3, 0.3, 0.33, LOOK.MATTE, 0, 0, 1, p);
      }
      // in play: a ring on the snow round one that can swallow you (red) or that you can swallow (green)
      if (g.state === L.H_PLAY && !own && myR > 0 && (fl & L.PF_FALL) === 0) {
        if (swallows(r, myR, kk)) out.decals?.push({ pos: [x, PLAT_Y + 0.03, z], radius: r * 1.35, width: 0.22, color: [...THREAT, 0.7], kind: DECAL.RING });
        else if (swallows(myR, r, kk)) out.decals?.push({ pos: [x, PLAT_Y + 0.03, z], radius: r * 1.3, width: 0.16, color: [...PREY, 0.55], kind: DECAL.RING });
      }
    }
  },

  frame(view) {
    const st = stage(view);
    const g = view.party();
    const tp = g.state === L.H_PLAY ? g.t : g.state === L.H_OVER ? Math.max(0, ((g.until - L.P_OVER) - g.start) | 0) : 0;
    return { centre: [st.cx || g.cx, PLAT_Y, st.cx || g.cx], radius: (st.r0 > 0 ? rimAt(st.r0, tp) : g.size) + 1, shape: 'disc' };
  },

  fx(f, ctx) {
    if (f.kind !== MC.SB_FX_EAT) return;
    const p = f.owner, q = f.shot;
    const d = typeof ctx.dist === 'function' ? ctx.dist(f.pos) : ctx.dist ?? 0;
    const name = (s) => ctx.name?.(s) ?? `P${s + 1}`;
    ctx.glow?.({ pos: f.pos, size: 3 + f.size, color: [0.92, 0.96, 1, 0.9], kind: SPRITE.RING, life: 600, grow: true });
    ctx.glow?.({ pos: f.pos, size: 1.6 + f.size * 0.6, color: [1, 1, 1, 0.8], kind: SPRITE.FLASH, life: 300 });
    if (p === ctx.slot) { ctx.banner?.(`YOU SWALLOWED ${name(q)}  NOW ${f.size.toFixed(1)} M`, C.GREEN, 1800); ctx.sound?.kill?.(); }
    else if (q !== ctx.slot) ctx.sound?.boing?.(6, d);
  },

  // the feed's line for a ball swallowed (the rest fell)
  sink(f, name, view) {
    const by = view?.dv?.getUint16(L.PG_S + MC.SB_EATEN + 2 * f.owner, true);
    if (by === MC.SB_MELTED) return `${name(f.owner)} MELTED AT THE CLOCK`;
    return by ? `${name(by - 1)} SWALLOWED ${name(f.owner)}` : null;
  },

  hud(view, ctx) {
    const g = view.party();
    if (g.state !== L.H_PLAY) return;
    const w = world(view);
    const me = ctx.me ?? (ctx.slot >= 0 ? view.partier(ctx.slot) : null);
    const mine = me && me.live && !me.out;
    if (w.big) ctx.right(3, mine && w.big.slot === ctx.slot ? `YOU ARE THE BIGGEST  ${w.big.r.toFixed(1)} M` : `BIGGEST P${w.big.slot + 1}  ${w.big.r.toFixed(1)} M`, C.GREY);
    if (!mine) return;
    const r = me.radius, ate = me.score;
    ctx.right(4, `YOU ${r.toFixed(1)} M${ate ? `  SWALLOWED ${ate}` : ''}`, C.WHITE);
    const row = Math.max(5, Math.floor((ctx.rows || 40) * 0.18));
    const st = w.st, tp = g.t;
    const rho = Math.hypot(me.pos[0] - st.cx, me.pos[2] - st.cx), R = rimAt(st.r0, tp);
    let threat = null, td = Infinity;
    for (const b of w.balls) {
      if (b.slot === ctx.slot || !swallows(b.r, r, w.eatk)) continue;
      const d = Math.hypot(b.x - me.pos[0], b.z - me.pos[2]) - b.r - r;
      if (d < td) { td = d; threat = b; }
    }
    if (threat && td < 8) ctx.centre(row, `P${threat.slot + 1} CAN SWALLOW YOU  ${Math.max(0, Math.round(td))} M`, C.RED);
    else if (rho + r > R - 0.5) ctx.centre(row, 'THE EDGE  GET IN', C.ORANGE);
    else if (Math.hypot(me.vel[0], me.vel[2]) < MC.SB_STILL && tp > 125) ctx.centre(row, 'STANDING STILL  YOU MELT', C.CYAN);
    else if (me.ground && !rimIn(tp) && !freshAt(view, cellAt(st.cx, me.pos[0], me.pos[2]), view.tick)) ctx.centre(row, 'OLD TRACKS WEAR YOU DOWN  FIND FRESH SNOW', C.GREY);
    else if (tp < 500) ctx.centre(row, 'ROLL FRESH SNOW TO GROW', C.CYAN);
    else ctx.centre(row, `YOU CAN SWALLOW ANYONE UNDER ${(r * w.eatk).toFixed(2)} M`, C.GREEN);
    if (tp >= MC.SB_CALM - 250 && tp < MC.SB_CALM + 250) ctx.centre(row + 1, 'THE EDGE IS CRUMBLING', C.ORANGE);
    else if (rimIn(tp)) ctx.centre(row + 1, MC.SB_LEN - tp < 1250 ? 'AT THE CLOCK ALL BUT THE BIGGEST MELT' : 'LAST RING  ANY BIGGER BALL SWALLOWS BY THE CLOCK', C.ORANGE);
  },

  brain: {
    // off the rim on that tick is a fall; the skin over it, a tip; the margin
    // a big fast ball needs, a risk; near a ball that can swallow it, where
    // that one will be, worse the closer
    danger(view, x, z, tick, me) {
      // what doesn't change over one think's 90 asks, worked out at its first
      const D = DANGER;
      if (D.view !== view || D.me !== me) {
        D.view = view; D.me = me;
        const b = ball(view, me);
        D.off = !b || b.out || !playing(view);
        if (!D.off) {
          const w = world(view);
          D.n = sizeUp(b, w); D.r = b.radius; D.m = margin(b.radius, Math.hypot(b.vel[0], b.vel[2]));
          D.r0 = w.st.r0; D.cx = w.st.cx; D.start = w.start; D.tick = w.tick;
        }
      }
      if (D.off) return 0;
      const r = D.r, m = D.m, n = D.n;
      const R = rimAt(D.r0, (tick - D.start) | 0);
      const rho = Math.hypot(x - D.cx, z - D.cx);
      let v = 0;
      if (rho > R - 0.3) return 1;
      if (rho + m > R) v = Math.min(0.9, 0.35 + 0.55 * (rho + m - R) / m);
      const tau = Math.max(0, Math.min(1, (tick - D.tick) * TICK));
      for (let i = 0; i < n.threats.length; i++) {
        const e = n.threats[i];
        const reach = e.r + r + 2.5;
        const dx = e.x + e.vx * tau - x, dz = e.z + e.vz * tau - z, d2 = dx * dx + dz * dz;
        if (d2 < reach * reach) v = Math.max(v, Math.min(1, (reach - Math.sqrt(d2)) / 2.5));
      }
      return v;
    },
    goal(view, me, bot) {
      const b = ball(view, me);
      if (!b || b.out || !playing(view)) return null;
      return plan(view, b, bot, world(view));
    },
    hop() { return false; },
  },
};
