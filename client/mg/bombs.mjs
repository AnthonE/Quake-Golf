// BOMB RAIN, as drawn and as the AI ball sees it. The disc is hex tiles in
// rings of colour round a gold core (the part the rim never takes); tiles the
// rim is about to take darken and shake, then drop and tumble away. Each bomb
// shows as a red zone on the floor with a ring closing on its spot while the
// bomb falls into it from high up, its shadow growing; it goes off as the ring
// closes. A big one's zone is orange, the tiles it will take glow, and they
// fly when it lands, the hole there until the tiles rise back. Everything is
// read from the sim's own records (src/mg/bombs.mjs's layout) and timed on
// the prediction's clock, so a blast is drawn on the tick your ball feels it.
import * as L from '../../src/layout.mjs';
import { PLAT_Y, hexAt, hexCentre } from '../../src/party-view.mjs';
import { LOOK, SPRITE, DECAL } from '../party-render.mjs';
import { C } from '../font.mjs';

const f = Math.fround;
const S = f(L.BO_S); // the sim's f32 circumradius: hexAt and hexCentre take it, not 1.6
const TICK = 0.008;
const HH = 0.45; // a tile's half height, m
const DRAWN = 0.95; // a tile's drawn circumradius over the sim's: a seam between tiles
const WARN = 375; // ticks before the rim takes a tile that it darkens (and shakes, the last 60)
const FALL = 1.5; // s a tile is drawn falling
const RISE = 60; // ticks a crater's tiles take to rise back
const BLAST = 70; // ticks a blast is drawn
const BAND = 2 * 1.5 * L.BO_S; // m a ring of colour is wide: two tiles
// the rings' colours, out from the core, and the core's: cool, so the red of a bomb's zone stands out on them
const RINGS = [[0.82, 0.88, 0.95], [0.26, 0.46, 0.74]];
const CORE = [[0.96, 0.96, 0.92], [0.3, 0.68, 0.7]];
const DOOM = [0.22, 0.2, 0.24]; // a tile the rim is about to take
const HOT = [1, 0.5, 0.12]; // a tile a big bomb is about to take

const BOMB0 = L.PG_S + L.BO_BOMBS;
const TILE0 = L.PG_BIG + L.BO_TILES;

// ---- what the sim says: the rim, the waves, the tiles, the bombs

// The rim on tick tp into play ($bo_rim, in doubles: for drawing and steering).
export function rimAt(r0, tp) {
  const k = tp - L.BO_CALM;
  if (k <= 0) return r0;
  if (k >= L.BO_SHRINK) return L.BO_RMIN;
  return r0 - (r0 - L.BO_RMIN) * (k / L.BO_SHRINK);
}
// $bo_ramp: a to b as tp goes through the shrink.
export const ramp = (tp, a, b) => a - Math.trunc(((a - b) * Math.max(0, Math.min(L.BO_SHRINK, tp - L.BO_CALM))) / L.BO_SHRINK);
// A cell's byte offset in the tiles ($bo_cell), -1 off the grid.
export const cellOf = (q, r) => (Math.abs(q) > L.BO_N || Math.abs(r) > L.BO_N ? -1 : ((r + L.BO_N) * L.BO_W + q + L.BO_N) * 8);
// The tick into play the rim takes the tile at cell a (0 no tile, BO_NEVER never), and the tick its crater opens (0 none).
export const rimOf = (view, a) => view.dv.getUint16(TILE0 + a + 4, true);
export const craterOf = (view, a) => view.dv.getUint32(TILE0 + a, true);
// Does the tile at cell a hold on tick t (HDR_TICK's count) with tp ticks into play? As $bo_ground has it.
export function holds(view, a, t, tp) {
  if (a < 0 || tp >= rimOf(view, a)) return false;
  const c = craterOf(view, a);
  return !c || ((t - c) >>> 0) >= L.BO_HOLE;
}
// The bombs on the board: { k, x, z, land, fall, big, who (slot aimed at or -1), r }.
export function bombsOf(view) {
  const out = [];
  for (let k = 0; k < L.BO_NB; k++) {
    const a = BOMB0 + k * L.BO_BSIZE;
    const kind = view.u8[a + 14];
    if (!kind) continue;
    const big = kind === 2;
    out.push({ k, x: view.dv.getFloat32(a, true), z: view.dv.getFloat32(a + 4, true), land: view.dv.getUint32(a + 8, true), fall: view.dv.getUint16(a + 12, true),
      big, who: view.u8[a + 15] - 1, r: big ? L.BO_BIGR : L.BO_R });
  }
  return out;
}
// The round's disc on the view's bank: its radius at the start, its centre, its tiles (worked out once a round).
let memo = null;
export function stage(view) {
  const dv = view.dv, o = view.bank || 0;
  const r0 = dv.getFloat32(L.PG_H + L.BO_RAD + o, true), cx = dv.getFloat32(L.PG_CX + o, true);
  const s = dv.getUint32(L.HDR_SEED + o, true), h = dv.getUint32(L.HDR_HOLE + o, true);
  const m = memo;
  if (m && m.r0 === r0 && m.cx === cx && m.s === s && m.h === h && m.tiles.length) return m;
  const tiles = [];
  if (r0 > 0) {
    for (let r = -L.BO_N; r <= L.BO_N; r++) for (let q = -L.BO_N; q <= L.BO_N; q++) {
      const a = cellOf(q, r);
      const rim = rimOf(view, a);
      if (!rim) continue;
      const [x, z] = hexCentre(q, r, S, cx);
      const rho = Math.hypot(x - cx, z - cx);
      const band = Math.floor(rho / BAND) & 1;
      tiles.push({ q, r, a, x, z, rho, rim, ang: Math.atan2(z - cx, x - cx), wob: ((q * 7 + r * 13) & 15) / 16, rgb: rho <= L.BO_RMIN ? CORE[band] : RINGS[band] });
    }
  }
  memo = { r0, cx, s, h, tiles };
  return memo;
}
// The tick (HDR_TICK's count, fractional) to draw at, and ticks into play then; frozen where the round ended.
function clock(view, ctx) {
  const g = view.party();
  let now = ctx?.ptick ?? (g.tick + (ctx?.dt || 0) / TICK);
  if (g.state === L.H_OVER) now = Math.min(now, (g.until - L.P_OVER) | 0);
  const tp = g.state === L.H_PLAY || g.state === L.H_OVER ? Math.max(0, now - g.start) : -1;
  return { g, now, tp };
}

// ---- drawing

const shade = (rgb, to, k) => [rgb[0] + (to[0] - rgb[0]) * k, rgb[1] + (to[1] - rgb[1]) * k, rgb[2] + (to[2] - rgb[2]) * k];
function tile(sc, x, y, z, yaw, rgb, look = LOOK.PLASTIC, a = 0, b = 0, alpha = 1) {
  sc.hex(x, y, z, S * DRAWN, HH, yaw, rgb[0], rgb[1], rgb[2], look, a, b, alpha);
}

// ---- the AI ball

// Once a world tick: the bombs and the balls in, each in a grid of CELL m
// squares over the disc (flat lists: head per square, next per item), for
// the brain's many reads round a spot.
const CELL = 8;
const G = 18; // squares a side: 144 m, the biggest disc and a margin
const DC = 2.5; // m a side of the crowd's squares
const DG = Math.ceil((G * CELL) / DC);
function world(view) {
  if (view._bo?.tick === view.tick && view._bo.bank === view.bank) return view._bo;
  const g = view.party();
  const st = stage(view);
  const o = (st.cx || g.cx) - (G * CELL) / 2;
  const sq = (x, z) => {
    const i = Math.floor((x - o) / CELL), j = Math.floor((z - o) / CELL);
    return i < 0 || j < 0 || i >= G || j >= G ? -1 : i * G + j;
  };
  const bombs = bombsOf(view);
  const nb = bombs.length;
  const bx = new Float64Array(nb), bz = new Float64Array(nb), br = new Float64Array(nb), bw = new Float64Array(nb);
  const land = new Int32Array(nb), shown = new Int32Array(nb), head = new Int16Array(G * G).fill(-1), next = new Int16Array(nb);
  bombs.forEach((b, k) => {
    bx[k] = b.x; bz[k] = b.z; br[k] = b.r; bw[k] = b.big ? 1.6 : 1; land[k] = b.land; shown[k] = b.land - b.fall;
    const c = sq(b.x, b.z);
    if (c >= 0) { next[k] = head[c]; head[c] = k; }
  });
  const dense = new Uint8Array(DG * DG);
  for (let p = 0; p < L.NPLAYER; p++) {
    const a = L.PLAYERS + view.bank + p * L.PSIZE;
    if ((view.u8[a + L.P_FL] & (L.PF_LIVE | L.PF_DEAD | L.PF_FALL)) !== L.PF_LIVE) continue;
    const i = Math.floor((view.dv.getFloat32(a + L.P_PX, true) - o) / DC), j = Math.floor((view.dv.getFloat32(a + L.P_PZ, true) - o) / DC);
    if (i >= 0 && j >= 0 && i < DG && j < DG && dense[i * DG + j] < 255) dense[i * DG + j]++;
  }
  const buf = view.dv.buffer;
  view._bo = { tick: view.tick, bank: view.bank, o, bombs, bx, bz, br, bw, land, shown, head, next, dense,
    u16: new Uint16Array(buf, TILE0, L.BO_W * L.BO_W * 4), u32: new Uint32Array(buf, TILE0, L.BO_W * L.BO_W * 2),
    start: g.start, playing: g.state === L.H_PLAY, st };
  return view._bo;
}
// The balls round (x, z): those in its crowd square count 1, those in the
// eight round it a half, less the asker itself where it stands (x0, z0).
function crowd(w, x, z, x0, z0) {
  const i = Math.floor((x - w.o) / DC), j = Math.floor((z - w.o) / DC);
  const si = Math.floor((x0 - w.o) / DC), sj = Math.floor((z0 - w.o) / DC);
  let n = 0;
  for (let a = Math.max(0, i - 1); a <= Math.min(DG - 1, i + 1); a++) for (let b = Math.max(0, j - 1); b <= Math.min(DG - 1, j + 1); b++) {
    const k = a === i && b === j ? 1 : 0.5;
    n += k * (w.dense[a * DG + b] - (a === si && b === sj ? 1 : 0));
  }
  return n;
}
// A ball as the brain is handed it: a slot or a record.
const slotOf = (me) => (typeof me === 'number' ? me : me?.slot ?? -1);
// how long after a ring shows each AI ball notices it, by slot (its goal() keeps it from its skill)
const REACT = new Uint8Array(L.NPLAYER).fill(20);
// The tile cell under (x, z), in doubles (steering never minds a point right on an edge picking its neighbour).
function cellAt(x, z, cx) {
  const u = (x - cx) / L.BO_S, w = (z - cx) / L.BO_S;
  const fq = u * 0.5773502691896258 - w / 3, fr = w * 0.6666666666666666, fs = -fq - fr;
  let q = Math.round(fq), r = Math.round(fr);
  const s = Math.round(fs), dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return cellOf(q, r);
}
// How bad being at (x, z) on tick t is: a fall where no tile holds then (or
// is about to stop), a blast landing round then, a little the rim coming.
// Asked 90 times a think: a few array reads.
function danger(view, x, z, t, slot) {
  const w = world(view);
  if (!w.playing) return 0;
  const cx = w.st.cx, tp = (t - w.start) | 0;
  const a = cellAt(x, z, cx);
  // holds(), from the world's own views of the tiles
  const rim = a < 0 ? 0 : w.u16[(a >> 1) + 2], c = a < 0 ? 0 : w.u32[a >> 2];
  if (tp >= rim || (c && ((t - c) >>> 0) < L.BO_HOLE)) return 1;
  let d = 0;
  if (rim - tp < 40) d = 0.7;
  if (c && c - t > 0 && c - t < 40) d = Math.max(d, 0.8);
  const seen = view.tick - (REACT[slot] ?? 20);
  const i0 = Math.max(0, Math.floor((x - CELL - w.o) / CELL)), i1 = Math.min(G - 1, Math.floor((x + CELL - w.o) / CELL));
  const j0 = Math.max(0, Math.floor((z - CELL - w.o) / CELL)), j1 = Math.min(G - 1, Math.floor((z + CELL - w.o) / CELL));
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    for (let k = w.head[i * G + j]; k >= 0; k = w.next[k]) {
      const dt = w.land[k] - t;
      if (dt < -8 || dt > 40 || w.shown[k] > seen) continue;
      const R = w.br[k] + 1.2, e = Math.hypot(w.bx[k] - x, w.bz[k] - z);
      if (e < R) d = Math.max(d, 0.45 + 0.55 * (1 - e / R));
    }
  }
  const rho = Math.hypot(x - cx, z - cx), edge = rimAt(w.st.r0, tp + 60);
  if (rho > edge - 2.5) d = Math.max(d, 0.25);
  return d;
}
// How much the bombs seen by tick `seen` and still to land in the 1.4 s
// after t threaten (x, z), each by how hard it would shove.
function threat(w, x, z, t, seen) {
  let s = 0;
  const i0 = Math.max(0, Math.floor((x - CELL - w.o) / CELL)), i1 = Math.min(G - 1, Math.floor((x + CELL - w.o) / CELL));
  const j0 = Math.max(0, Math.floor((z - CELL - w.o) / CELL)), j1 = Math.min(G - 1, Math.floor((z + CELL - w.o) / CELL));
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    for (let k = w.head[i * G + j]; k >= 0; k = w.next[k]) {
      const dt = w.land[k] - t;
      if (dt < 0 || dt > 175 || w.shown[k] > seen) continue;
      const e = Math.hypot(w.bx[k] - x, w.bz[k] - z), R = w.br[k] + 1.5;
      if (e < R) s += (1 - e / R) * w.bw[k];
    }
  }
  return s;
}

export default {
  id: L.MG_BOMBS, key: 'bombs', name: 'BOMB RAIN',
  hint: 'BOMBS LAND IN THE RED RINGS  GET OUT  THE EDGE CRUMBLES  LAST ONE ON',
  env: 'sunset',

  draw(view, ctx, out) {
    const st = stage(view);
    if (!(st.r0 > 0)) return;
    const { now, tp } = clock(view, ctx);
    const sc = out.scene;
    const y0 = PLAT_Y - HH;
    // the column the disc stands on, down into the sea
    sc.cyl(st.cx, PLAT_Y - 2 * HH - 22, st.cx, L.BO_RMIN * 0.62, 22, 0.42, 0.36, 0.36, LOOK.MATTE);
    sc.cyl(st.cx, PLAT_Y - 2 * HH - 1.2, st.cx, L.BO_RMIN * 0.9, 1.2, 0.5, 0.42, 0.4, LOOK.MATTE);
    // the big bombs on their way: the tiles they'll take glow, pulsing faster as they fall
    const hot = new Map();
    const bombs = tp >= 0 ? bombsOf(view) : [];
    for (const b of bombs) {
      if (!b.big || now >= b.land) continue;
      const u = 1 - (b.land - now) / b.fall;
      hot.set(b.k, u);
    }
    for (const T of st.tiles) {
      if (tp < 0) { tile(sc, T.x, y0, T.z, 0, T.rgb); continue; }
      // taken by the rim: falling, tumbling, fading
      const left = T.rim - tp;
      if (left <= 0) {
        const a = -left * TICK;
        if (a < FALL) tile(sc, T.x, y0 - 0.5 * 30 * a * a, T.z, a * (T.wob - 0.5) * 3, shade(T.rgb, DOOM, 0.8), LOOK.MATTE, 0, 0, 1 - a / FALL);
        continue;
      }
      const c = craterOf(view, T.a);
      const since = c ? now - c : -1e9;
      if (since >= 0 && since < L.BO_HOLE) {
        // blown out from the blast, then gone, then rising back in the last RISE ticks
        if (since * TICK < FALL) {
          const a = since * TICK, b = bombs.find((o) => o.big && o.land === c);
          const ox = b ? T.x - b.x : 0, oz = b ? T.z - b.z : 0, n = Math.hypot(ox, oz) || 1;
          const vh = 5 + 3 * T.wob, vu = 9 + 4 * T.wob;
          tile(sc, T.x + (ox / n) * vh * a, y0 + vu * a - 0.5 * 30 * a * a, T.z + (oz / n) * vh * a, a * (T.wob - 0.5) * 9, shade(T.rgb, DOOM, 0.6), LOOK.MATTE, 0, 0, 1 - a / FALL);
        }
        const up = (L.BO_HOLE - since) / RISE;
        if (up < 1) tile(sc, T.x, y0 - 4 * up * up, T.z, 0, T.rgb, LOOK.PLASTIC, 0, 0, 1 - 0.8 * up);
        continue;
      }
      let rgb = T.rgb, look = LOOK.PLASTIC, ga = 0, dx = 0, dz = 0, dy = 0;
      if (left < WARN) {
        // about to go with the rim: darker, sinking a little, shaking in the last half second
        const k = 1 - left / WARN;
        rgb = shade(rgb, DOOM, 0.75 * k);
        dy = -0.12 * k;
        const sh = left < 60 ? 0.07 * (1 - left / 60) : 0;
        dx = sh * Math.sin(now * 2.3 + T.q * 5.1 + T.r * 2.7);
        dz = sh * Math.sin(now * 2.9 + T.q * 3.3 - T.r * 4.1);
      }
      if (c && since < 0 && -since <= 260) {
        // a big bomb's crater on its way: the tile glows hot, faster as it nears
        const k = Math.max(0, 1 + since / 200);
        const pulse = 0.5 + 0.5 * Math.sin(now * TICK * Math.PI * 2 * (2 + 5 * k));
        rgb = shade(rgb, HOT, 0.35 + 0.5 * k);
        look = LOOK.GLOW;
        ga = 0.25 + 0.6 * k * pulse;
      }
      tile(sc, T.x + dx, y0 + dy, T.z + dz, 0, rgb, look, ga, look === LOOK.GLOW ? 0.3 : 0);
    }
    // the bombs: falling into their zones, then going off
    for (const b of bombs) {
      const left = b.land - now;
      if (left > 0) {
        const u = Math.max(0, Math.min(1, 1 - left / b.fall));
        const r = b.big ? 0.95 : 0.6;
        const y = PLAT_Y + L.BO_HEIGHT * (1 - u * u);
        const zone = b.big ? [1, 0.55, 0.1] : [1, 0.16, 0.12];
        out.decals?.push({ pos: [b.x, PLAT_Y + 0.04, b.z], radius: b.r, width: 0.35, color: [...zone, 0.35 + 0.55 * u], kind: DECAL.ZONE });
        out.decals?.push({ pos: [b.x, PLAT_Y + 0.06, b.z], radius: Math.max(0.5, b.r * (1 - u)), width: 0.28, color: [1, 0.95, 0.75, 0.5 + 0.5 * u], kind: DECAL.RING });
        if (b.big) out.decals?.push({ pos: [b.x, PLAT_Y + 0.08, b.z], radius: L.BO_CRATER + S * 0.8, width: 0.2, color: [1, 0.8, 0.3, 0.4 + 0.5 * u], kind: DECAL.TARGET });
        // black until its last 0.3 s, then red-hot as it comes down
        const hotness = Math.max(0, 1 - left / 38);
        out.solid.push({ pos: [b.x, y + r, b.z], size: r, color: b.big ? [0.22, 0.2, 0.24, 1] : [0.1, 0.1, 0.12, 1], kind: SPRITE.BOMB, roll: hotness, minpx: 2 });
        out.casters?.push([b.x, y + r, b.z, -r]);
        continue;
      }
      const a = -left / BLAST;
      if (a >= 1) continue;
      // a fireball, quick: white-hot for a moment, then orange going out; the shock running over the floor to
      // the blast's reach; chips of floor and sparks thrown out and falling; a scorch fading
      const big = b.big ? 1.3 : 1, s = -left * TICK;
      const fire = Math.max(0, 1 - a * 1.6);
      if (fire > 0) {
        out.glow.push({ pos: [b.x, PLAT_Y + 1.4 * big + 2 * s, b.z], size: b.r * (0.5 + 0.5 * Math.min(1, a * 5)) * big, color: [1, 0.4, 0.06, fire], kind: SPRITE.FLASH, minpx: 2 });
        if (a < 0.2) out.glow.push({ pos: [b.x, PLAT_Y + 1, b.z], size: b.r * 0.6 * big, color: [1, 0.92, 0.7, 1 - a / 0.2], kind: SPRITE.FLASH, minpx: 2 });
      }
      const shock = Math.min(1, a * 3.5);
      if (shock < 1) out.decals?.push({ pos: [b.x, PLAT_Y + 0.07, b.z], radius: b.r * (0.25 + 0.75 * shock), width: 0.5 + 0.5 * big, color: [1, 0.7, 0.3, 0.9 * (1 - shock)], kind: DECAL.RING });
      out.decals?.push({ pos: [b.x, PLAT_Y + 0.05, b.z], radius: b.r * 0.7, width: b.r * 0.7, color: [0.04, 0.02, 0.02, 0.5 * (1 - a)], kind: DECAL.DISC });
      for (let i = 0; i < 8; i++) {
        const ang = b.k * 2.4 + i * 0.785 + ((i * 5) % 3) * 0.2, sp = (5 + ((b.k * 7 + i * 3) % 5)) * big, up = 7 + ((b.k + i * 11) % 4) * 1.5;
        const y = PLAT_Y + 0.8 + up * s - 15 * s * s;
        if (y < PLAT_Y - 3) continue;
        const pos = [b.x + Math.cos(ang) * sp * s, y, b.z + Math.sin(ang) * sp * s];
        if (i & 1) out.glow.push({ pos, size: 0.4, color: [1, 0.65, 0.25, 1 - a], kind: SPRITE.SPARK, minpx: 1 });
        else out.solid.push({ pos, size: 0.22 * big, color: [0.25, 0.22, 0.24, 1], kind: SPRITE.CRUMB, minpx: 1, seed: b.k * 8 + i });
      }
    }
  },

  // the disc as it stands
  frame(view) {
    const st = stage(view);
    const g = view.party();
    const r0 = st.r0 > 0 ? st.r0 : g.size;
    const tp = g.state === L.H_PLAY ? g.t : 0;
    return { centre: [st.cx || g.cx, PLAT_Y, st.cx || g.cx], radius: rimAt(r0, tp) + S, shape: 'disc' };
  },

  fx(fx, ctx) {
    const mine = fx.owner === ctx.slot && ctx.slot >= 0;
    const d = typeof ctx.dist === 'function' ? ctx.dist(fx.pos) : ctx.dist ?? 0;
    if (fx.kind === L.BO_FX_BOOM) {
      ctx.sound?.blast?.(d, fx.size);
    } else if (fx.kind === L.BO_FX_BIG) {
      if (mine) ctx.banner?.('BIG BOMB ON YOU  RUN', C.RED, 1400);
      else if (d < 18) ctx.banner?.('BIG BOMB', C.ORANGE, 1000);
    } else if (fx.kind === L.BO_FX_WAVE) {
      if (d < 120) ctx.sound?.tick?.();
      const g = ctx.view?.party?.();
      const tp = g ? (fx.tick - g.start) | 0 : 0;
      const gap = ramp(tp, L.BO_GAP0, L.BO_GAP1);
      if (tp >= L.BO_CALM && tp - ramp(tp, L.BO_GAP0, L.BO_GAP1) < L.BO_CALM) ctx.banner?.('THE EDGE IS CRUMBLING', C.ORANGE, 1800);
      else if (tp >= L.BO_BIGFROM && tp - gap < L.BO_BIGFROM) ctx.banner?.('BIG BOMBS BLOW HOLES', C.ORANGE, 1800);
    }
  },

  // the waves, and whether you're under a bomb
  hud(view, ctx) {
    const g = view.party();
    if (g.state !== L.H_PLAY) return;
    const st = stage(view);
    if (!(st.r0 > 0)) return;
    const w = view.dv.getUint32(L.PG_H + L.BO_WAVE, true), n = view.dv.getUint32(L.PG_H + L.BO_LAST, true);
    const gap = view.dv.getUint32(L.PG_H + L.BO_GAP, true) || L.BO_GAP0;
    ctx.right(3, `WAVE ${w}  ${n} ${n === 1 ? 'BOMB' : 'BOMBS'}  EVERY ${(gap * TICK).toFixed(1)}S`, C.GREY);
    const me = ctx.me ?? (ctx.slot >= 0 ? view.partier(ctx.slot) : null);
    if (!me || !me.live || me.out || me.falling) return;
    const row = Math.max(3, Math.floor((ctx.rows || 40) * 0.18));
    let soon = Infinity, big = false;
    for (const b of bombsOf(view)) {
      const left = b.land - g.tick;
      if (left <= 0 || Math.hypot(b.x - me.pos[0], b.z - me.pos[2]) > b.r + 0.6) continue;
      if (left < soon) { soon = left; big = b.big; }
    }
    if (soon < Infinity) ctx.centre(row, `${big ? 'BIG BOMB' : 'BOMB'}  MOVE!  ${(soon * TICK).toFixed(1)}`, big ? C.ORANGE : C.RED);
    else {
      const a = cellAt(me.pos[0], me.pos[2], st.cx);
      if (a >= 0 && rimOf(view, a) - g.t < WARN) ctx.centre(row, 'THE EDGE IS GOING  GET IN', C.ORANGE);
    }
  },

  brain: {
    danger(view, x, z, tick, me) { return danger(view, x, z, tick, slotOf(me)); },

    // Somewhere near that no bomb landing in the next 1.4 s reaches, in off
    // the rim as it will be, on floor that holds, not in the crowd's thick;
    // kept (in bot.mem) unless somewhere is clearly better.
    goal(view, me, bot) {
      const w = world(view);
      const slot = slotOf(me);
      if (!w.playing || slot < 0) return null;
      const skill = bot?.skill ?? 0.6;
      REACT[slot] = Math.round(12 + 45 * (1 - skill));
      const b = typeof me === 'number' ? view.partier(me) : me;
      const x0 = bot?.pos?.[0] ?? b.pos[0], z0 = bot?.pos?.[1] ?? b.pos[2];
      const t = bot?.at ?? view.tick;
      const tp = (t - w.start) | 0, cx = w.st.cx;
      const edge = rimAt(w.st.r0, tp + 190);
      const seen = view.tick - REACT[slot];
      const score = (x, z) => {
        const rho = Math.hypot(x - cx, z - cx);
        let s = 3 * threat(w, x, z, t, seen) + 0.04 * Math.hypot(x - x0, z - z0) + 0.03 * rho + 0.35 * crowd(w, x, z, x0, z0);
        if (rho > edge - 3) s += 2 + (rho - edge + 3);
        if (!holds(view, cellAt(x, z, cx), t + 60, tp + 60)) s += 6;
        return s;
      };
      const mem = bot?.mem || {};
      let best = null, bs = Infinity;
      if (mem.bo) { bs = score(mem.bo[0], mem.bo[1]) - 0.4; best = mem.bo; }
      const cand = [[x0, z0], [cx, cx]];
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * 2 * Math.PI + (bot?.rand ? bot.rand() * 0.5 : 0);
        for (const r of [4, 8]) cand.push([x0 + Math.cos(a) * r, z0 + Math.sin(a) * r]);
      }
      for (const [x, z] of cand) {
        const s = score(x, z);
        if (s < bs) { bs = s; best = [x, z]; }
      }
      mem.bo = best;
      return best;
    },

    // a hole just ahead and floor where a hop would come down: over it
    hop(view, me, bot) {
      const b = typeof me === 'number' ? view.partier(me) : me;
      if (!b || !b.ground || b.out) return false;
      const w = world(view);
      const cx = w.st.cx;
      const x0 = bot?.pos?.[0] ?? b.pos[0], z0 = bot?.pos?.[1] ?? b.pos[2];
      const vx = bot?.vel?.[0] ?? b.vel[0], vz = bot?.vel?.[1] ?? b.vel[2];
      const sp = Math.hypot(vx, vz);
      if (sp < 4) return false;
      const t = bot?.at ?? view.tick, tp = (t - w.start) | 0;
      let hole = false;
      for (let d = 0.8; d <= 2.4 && !hole; d += 0.8) {
        const k = Math.round(d / sp / TICK);
        hole = !holds(view, cellAt(x0 + (vx / sp) * d, z0 + (vz / sp) * d, cx), t + k, tp + k);
      }
      if (!hole) return false;
      const air = (2 * view.dv.getFloat32(L.PG_HOP + view.bank, true)) / 20;
      const k = Math.round(air / TICK) + 10;
      return holds(view, cellAt(x0 + vx * air, z0 + vz * air, cx), t + k, tp + k);
    },
  },
};
