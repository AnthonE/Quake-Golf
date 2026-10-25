// PAINT PARTY, as drawn and as the AI ball sees it. The stage is the lid of
// a giant paint tin: a white floor (LOOK.PAINT) with the sim's grid laid
// over it as the renderer's paint layer, each slot in its ball's colour, the
// tin's metal side under it with paint run down it where the rim is painted.
// Your own ball paints ahead of the confirmed world along its predicted path
// (drawing only: the next confirmed grid takes over). The paint bombs are
// glossy spheres on a ring the size of their burst; one coming shows its
// spot and drops in from the sky. The HUD's bar is the floor shared out:
// the leaders' colours, yours, the rest. The grid, counts and bombs are read
// straight from the sim (src/mg/paint.mjs's layout).
import * as L from '../../src/layout.mjs';
import * as MC from '../../src/mg/paint.mjs'; // PP_*: the minigame's own constants
import { PLAT_Y } from '../../src/party-view.mjs';
import { LOOK, SPRITE, DECAL } from '../party-render.mjs';
import { C } from '../font.mjs';

const TICK = 0.008;
const N = MC.PP_N;
const LID = 0.6; // the floor's half height, m
const TIN = 7; // the tin's side, m down from the lid
const DRIPS = 40; // runs of paint round the tin's side
const FALL = 0.7; // s a bomb is seen dropping in before it lands
// a slot's colour, as client/party-game.mjs gives its ball
export const slotColor = (s) => { const h = (s * 0.618034) % 1; return [0, 0.33, 0.67].map((o) => 0.55 + 0.4 * Math.cos(6.2832 * (h + o))); };
const ordinal = (n) => `${n}${[, 'ST', 'ND', 'RD'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'TH'}`;
const ball = (view, me) => (typeof me === 'number' ? view.partier(me) : me);

// ---- the round as the sim laid it out (PG_H on the view's bank, the grid and the bombs confirmed)

export function stage(view) {
  const dv = view.dv, o = view.bank || 0;
  return {
    rad: dv.getFloat32(L.PG_H + MC.PP_RAD + o, true), x0: dv.getFloat32(L.PG_H + MC.PP_X0 + o, true), cs: dv.getFloat32(L.PG_H + MC.PP_CS + o, true),
    total: dv.getUint32(L.PG_H + MC.PP_TOTAL + o, true), orbs: dv.getUint32(L.PG_H + MC.PP_ORBS + o, true), cx: dv.getFloat32(L.PG_CX + o, true),
    len: dv.getUint32(L.PG_LEN + o, true),
  };
}
// The grid as u16s over the view's memory: 0 unpainted, slot + 1, PP_OFF off the disc.
const GRIDS = new WeakMap();
export function grid(view) {
  const buf = view.dv.buffer;
  let g = GRIDS.get(buf);
  if (!g) GRIDS.set(buf, (g = new Uint16Array(buf, L.PG_BIG + MC.PP_CELLS, N * N)));
  return g;
}
// The cell under (x, z), or -1 off the grid.
export function cellAt(st, x, z) {
  const i = Math.floor((x - st.x0) / st.cs), j = Math.floor((z - st.x0) / st.cs);
  return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
}
// The cells slot p holds (PP_CNT, of which PG_SCORE is the copy).
export const cells = (view, p) => view.dv.getUint16(L.PG_S + MC.PP_CNT + 2 * p, true);
// Bomb j: where it is, the tick into play it lands, its bursts so far.
export function orb(view, j) {
  const o = L.PG_S + MC.PP_ORB + j * MC.PP_ORB_SIZE, dv = view.dv;
  return { x: dv.getFloat32(o, true), z: dv.getFloat32(o + 4, true), at: dv.getUint32(o + 8, true), bursts: dv.getUint32(o + 12, true) };
}
// Is the round in its rush on tick t into play?
export const rushing = (st, t) => t >= st.len - MC.PP_RUSH;

// Ticks into play to draw at (fractional), or -1 before play; frozen where the round ended.
function playTime(view, g, ctx, pred) {
  if (g.state !== L.H_PLAY && g.state !== L.H_OVER) return -1;
  const s = pred ? ctx?.pt : ctx?.t;
  let t = typeof s === 'number' && s > 0 ? s / TICK : g.t + (ctx?.dt || 0) / TICK;
  if (g.state === L.H_OVER) t = Math.min(t, (g.until - L.P_OVER - g.start) | 0);
  return Math.max(0, t);
}

// ---- the paint layer the renderer lays over the floor

// The grid as palette indices (src), and drawn at twice its size by Scale2x
// (layer.cells): a cell's four quarters take a neighbour's colour where two
// neighbours agree across that corner, so a stripe's stepped edge comes out
// as a run of half steps and its diagonals smooth. Only what changed since
// the last frame is worked again.
const SN = 2 * N;
const src = new Uint8Array(N * N), was = new Uint8Array(N * N);
const layer = { cells: new Uint8Array(SN * SN), n: SN, origin: [0, 0], size: 1, palette: new Float32Array(1024), version: 0, me: -2 };
// palette index of slot s: 1..255 (slots 254 and 255 share the last, which shows yours if you're one of them)
const idx = (s) => (s < 255 ? s + 1 : 255);
// (everyone's paint a little toward grey but your own, so yours stands out in a crowd of near colours)
function palette(me) {
  if (layer.me === me) return;
  layer.me = me;
  const P = layer.palette;
  P.fill(0);
  for (let s = 0; s < 255; s++) {
    const who = s === 254 && me === 255 ? 255 : s, c = slotColor(who), k = who === me ? 1 : 0.86;
    P.set([c[0] * k + 0.5 * (1 - k), c[1] * k + 0.5 * (1 - k), c[2] * k + 0.5 * (1 - k), 1], 4 * idx(s));
  }
}
// slot p's brush over (x, z) into src: drawing only, as $pp_brush paints
function stamp(st, g, p, x, z, r) {
  const i0 = Math.max(0, Math.floor((x - r - st.x0) / st.cs)), i1 = Math.min(N - 1, Math.floor((x + r - st.x0) / st.cs));
  const j0 = Math.max(0, Math.floor((z - r - st.x0) / st.cs)), j1 = Math.min(N - 1, Math.floor((z + r - st.x0) / st.cs));
  const r2 = r * r, v = idx(p);
  for (let j = j0; j <= j1; j++) {
    const dz = (j + 0.5) * st.cs + st.x0 - z;
    for (let i = i0; i <= i1; i++) {
      const dx = (i + 0.5) * st.cs + st.x0 - x;
      if (dx * dx + dz * dz <= r2 && g[j * N + i] !== MC.PP_OFF) src[j * N + i] = v;
    }
  }
}
// Cell (i, j)'s four quarters, Scale2x: A above, B right, C left, D below.
function quarters(i, j) {
  const c = j * N + i, P = src[c], out = layer.cells;
  const A = j > 0 ? src[c - N] : P, D = j < N - 1 ? src[c + N] : P, C = i > 0 ? src[c - 1] : P, B = i < N - 1 ? src[c + 1] : P;
  const o = 2 * j * SN + 2 * i;
  out[o] = C === A && C !== D && A !== B ? A : P;
  out[o + 1] = A === B && A !== C && B !== D ? B : P;
  out[o + SN] = D === C && D !== B && C !== A ? C : P;
  out[o + SN + 1] = B === D && B !== A && D !== C ? D : P;
}
export function paintLayer(view, st, ctx, play) {
  palette(ctx?.slot ?? -1);
  const g = grid(view);
  for (let c = 0; c < N * N; c++) { const v = g[c]; src[c] = v === 0 || v === MC.PP_OFF ? 0 : idx(v - 1); }
  // your ball's paint on the ticks it has rolled that the confirmed world hasn't yet (the prediction's track)
  if (play && ctx?.pme && !ctx.pme.out && ctx.pview && ctx.slot >= 0) {
    const t0 = view.tick, t1 = ctx.pview.tick, start = view.dv.getUint32(L.HDR_START, true);
    for (let k = 0; k < L.PRED_MAX; k++) {
      const o = L.PTRACK + 16 * k;
      const tk = view.dv.getUint32(o + 12, true);
      if (tk <= t0 || tk > t1) break;
      const y = view.dv.getFloat32(o + 4, true);
      if (Math.abs(y - PLAT_Y) > 0.01) continue;
      stamp(st, g, ctx.slot, view.dv.getFloat32(o, true), view.dv.getFloat32(o + 8, true), rushing(st, (tk - start) | 0) ? MC.PP_RUSH_BRUSH : MC.PP_BRUSH);
    }
  }
  let changed = 0;
  for (let c = 0; c < N * N; c++) {
    if (src[c] === was[c]) continue;
    was[c] = src[c];
    changed++;
    const i = c % N, j = (c - i) / N;
    quarters(i, j);
    if (i > 0) quarters(i - 1, j);
    if (i < N - 1) quarters(i + 1, j);
    if (j > 0) quarters(i, j - 1);
    if (j < N - 1) quarters(i, j + 1);
  }
  layer.origin[0] = layer.origin[1] = st.x0;
  layer.size = st.cs * N;
  if (changed) layer.version++;
  return layer;
}

// Is your predicted ball within a bomb's reach ($pp_orbs's test)?
function reach(ctx, b) {
  const m = ctx?.pme;
  if (!m || m.out || !m.live) return false;
  const dx = m.pos[0] - b.x, dy = m.pos[1] + m.radius - (PLAT_Y + MC.PP_ORB_Y), dz = m.pos[2] - b.z, lim = m.radius + MC.PP_ORB_R;
  return dx * dx + dy * dy + dz * dz < lim * lim;
}

// Paint tins standing in the sea round the stage, open, full and running over.
const CANS = [[0.93, 0.15, 0.13], [1, 0.8, 0.08], [0.15, 0.75, 0.24], [0.13, 0.4, 0.96], [0.62, 0.24, 0.9], [1, 0.47, 0.05]];
function cans(sc, cx, R) {
  for (let k = 0; k < CANS.length; k++) {
    const a = (k / CANS.length) * 2 * Math.PI + 0.45;
    const D = R + 16 + 7 * (k % 2), rc = 4.5 + (k % 3), h = 15 + 4 * ((k * 3) % 4);
    const x = cx + Math.cos(a) * D, z = cx + Math.sin(a) * D, [r, g, b] = CANS[k];
    sc.cyl(x, h / 2, z, rc, h / 2, 0.74, 0.76, 0.8, LOOK.METAL);
    sc.cyl(x, h * 0.55, z, rc + 0.06, h * 0.18, r, g, b, LOOK.PLASTIC);
    sc.cyl(x, h + 0.15, z, rc + 0.25, 0.3, 0.8, 0.81, 0.85, LOOK.METAL);
    sc.cyl(x, h + 0.25, z, rc - 0.15, 0.3, r, g, b, LOOK.PLASTIC);
    // runs down the metal above the label, each a rounded end at its foot
    for (let d = 0; d < 7; d++) {
      const u = a + Math.PI + (d - 3) * 0.32, len = h * (0.06 + 0.16 * (((k * 7 + d * 13) % 11) / 11));
      const dx = x + Math.cos(u) * (rc + 0.05), dz = z + Math.sin(u) * (rc + 0.05);
      sc.cyl(dx, h - len / 2 + 0.3, dz, 0.28, len / 2, r, g, b, LOOK.PLASTIC);
      sc.sphere(dx, h - len + 0.3, dz, 0.36, r, g, b, LOOK.PLASTIC);
    }
  }
}

// ---- what the bots share each world tick: every ball in, and each bomb's two nearest

function world(view, st) {
  if (view._pp?.tick === view.tick && view._pp.bank === view.bank) return view._pp;
  const balls = [];
  for (let p = 0; p < L.NPLAYER; p++) {
    const a = L.PLAYERS + view.bank + p * L.PSIZE;
    if ((view.u8[a + L.P_FL] & (L.PF_LIVE | L.PF_DEAD | L.PF_FALL)) !== L.PF_LIVE) continue;
    balls.push([p, view.dv.getFloat32(a + L.P_PX, true), view.dv.getFloat32(a + L.P_PZ, true)]);
  }
  const orbs = [];
  for (let j = 0; j < st.orbs; j++) {
    const b = orb(view, j);
    let n1 = [-1, Infinity], n2 = [-1, Infinity];
    for (const [p, x, z] of balls) {
      const d = Math.hypot(x - b.x, z - b.z);
      if (d < n1[1]) { n2 = n1; n1 = [p, d]; } else if (d < n2[1]) n2 = [p, d];
    }
    orbs.push({ ...b, n1, n2 });
  }
  view._pp = { tick: view.tick, bank: view.bank, balls, orbs };
  return view._pp;
}
const HEADS = 12;
const WIN = [-1.2, 0, 1.2];

// what a point is worth painting for slot p: the cells round it that aren't its own (a rival's a little more)
function worth(st, g, p, x, z) {
  let s = 0;
  const mine = p + 1;
  for (const dz of WIN) for (const dx of WIN) {
    const c = cellAt(st, x + dx, z + dz);
    if (c < 0) continue;
    const v = g[c];
    if (v === MC.PP_OFF || v === mine) continue;
    s += v ? 1.25 : 1;
  }
  return s;
}

export default {
  id: L.MG_PAINT, key: 'paint', name: 'PAINT PARTY',
  seatColors: true, // the floor is painted in the seat's colour, so balls keep theirs here (a look's hat still shows)
  hint: 'ROLL TO PAINT THE FLOOR  BURST PAINT BOMBS  THE MOST FLOOR WINS',
  env: 'day',

  draw(view, ctx, out) {
    const st = stage(view);
    if (!(st.rad > 0)) return;
    const g = view.party();
    const sc = out.scene, cx = st.cx, R = st.rad;
    const now = (ctx?.now ?? 0) / 1000;
    // the lid, the tin's rim round it and its side under
    sc.cyl(cx, PLAT_Y - LID, cx, R, LID, 0.95, 0.94, 0.9, LOOK.PAINT);
    sc.cyl(cx, PLAT_Y - LID - 0.25, cx, R + 0.35, LID, 0.78, 0.8, 0.84, LOOK.METAL);
    sc.cyl(cx, PLAT_Y - 2 * LID - TIN / 2, cx, R * 0.985, TIN / 2, 0.7, 0.72, 0.76, LOOK.METAL);
    out.paint = paintLayer(view, st, ctx, g.state === L.H_PLAY);
    // runs of paint down the side, where the rim is painted
    const gr = grid(view);
    for (let k = 0; k < DRIPS; k++) {
      const a = (k / DRIPS) * 2 * Math.PI + 0.37;
      const c = cellAt(st, cx + Math.cos(a) * (R - 0.6), cx + Math.sin(a) * (R - 0.6));
      const v = c >= 0 ? gr[c] : 0;
      if (!v || v === MC.PP_OFF) continue;
      const col = slotColor(v - 1);
      const len = 0.8 + 2.2 * (((k * 2654435761) >>> 0) % 97) / 97;
      const rr = R * 0.985 + 0.05, x = cx + Math.cos(a) * rr, z = cx + Math.sin(a) * rr;
      sc.cyl(x, PLAT_Y - 2 * LID - len / 2 + 0.2, z, 0.2, len / 2, col[0], col[1], col[2], LOOK.PLASTIC);
      sc.sphere(x, PLAT_Y - 2 * LID - len + 0.2, z, 0.26, col[0], col[1], col[2], LOOK.PLASTIC);
    }
    // the bombs: down, on their burst's ring; coming, the spot marked and the last FALL s dropping in
    const tp = playTime(view, g, ctx, true);
    const t = Math.max(0, tp);
    const rush = tp >= 0 && rushing(st, t);
    const splat = rush ? MC.PP_RUSH_SPLAT : MC.PP_SPLAT;
    for (let j = 0; j < st.orbs; j++) {
      const b = orb(view, j);
      const left = (b.at - t) * TICK;
      const hue = (now * 0.25 + j * 0.37) % 1;
      const rgb = [0, 0.33, 0.67].map((o) => 0.55 + 0.45 * Math.cos(6.2832 * (hue + o)));
      if (left > 0) {
        const pulse = 0.5 + 0.5 * Math.sin(now * (6 + 10 / (left + 0.5)));
        out.decals?.push({ pos: [b.x, PLAT_Y + 0.04, b.z], radius: splat, width: 0.3, color: [1, 1, 1, 0.25 + 0.35 * pulse * Math.min(1, 3 / (left + 0.5))], kind: DECAL.TARGET });
        if (left < FALL) {
          const y = PLAT_Y + MC.PP_ORB_Y + 70 * left * left;
          sc.sphere(b.x, y, b.z, 0.75, ...rgb, LOOK.PLASTIC);
          out.casters?.push([b.x, y, b.z, -0.75]);
        }
        continue;
      }
      const bob = 0.15 * Math.sin(now * 3 + j);
      const y = PLAT_Y + MC.PP_ORB_Y + bob;
      // your own ball in reach of it: gone at once (the confirmed world bursts it a round trip on)
      if (reach(ctx, b)) continue;
      sc.sphere(b.x, y, b.z, 0.75, ...rgb, LOOK.PLASTIC);
      out.casters?.push([b.x, y, b.z, -0.75]);
      out.glow?.push({ pos: [b.x, y + 0.95, b.z], size: 0.3 + 0.08 * Math.sin(now * 17 + j), color: [1, 0.9, 0.5, 1], kind: SPRITE.SPARK });
      out.glow?.push({ pos: [b.x, y, b.z], size: 1.8, color: [...rgb, 0.25], kind: SPRITE.FLASH });
      out.decals?.push({ pos: [b.x, PLAT_Y + 0.04, b.z], radius: splat, width: 0.35, color: [...rgb, 0.55], kind: DECAL.ZONE });
    }
    // the rim, faintly lit: where the floor ends
    out.decals?.push({ pos: [cx, PLAT_Y + 0.03, cx], radius: R, width: 0.35, color: rush ? [1, 0.6, 0.2, 0.7] : [1, 1, 1, 0.3], kind: DECAL.RING });
    // the leader, ringed in gold
    if (g.state === L.H_PLAY) {
      let lead = -1, most = 0;
      for (let p = 0; p < L.NPLAYER; p++) {
        const c = cells(view, p);
        if (c > most && view.u8[L.PLAYERS + p * L.PSIZE + L.P_FL] & L.PF_LIVE) { most = c; lead = p; }
      }
      if (lead >= 0) {
        const own = lead === ctx?.slot && ctx?.pme && !ctx.pme.out;
        const b = own ? ctx.pme : view.bumper(lead);
        const dt = own ? Math.max(0, (ctx.ptick ?? 0) - ctx.pview.tick) * TICK : ctx?.dt || 0;
        if (b.live && !b.out && b.pos[1] > PLAT_Y - 1) {
          out.decals?.push({ pos: [b.pos[0] + b.vel[0] * dt, PLAT_Y + 0.05, b.pos[2] + b.vel[2] * dt], radius: b.radius + 0.55, width: 0.3, color: [1, 0.82, 0.25, 0.9], kind: DECAL.RING });
        }
      }
    }
    cans(sc, cx, R);
  },

  frame(view) {
    const st = stage(view);
    const g = view.party();
    return { centre: [st.cx || g.cx, PLAT_Y, st.cx || g.cx], radius: st.rad > 0 ? st.rad : g.size, shape: 'disc' };
  },

  fx(f, ctx) {
    const d = typeof ctx.dist === 'function' ? ctx.dist(f.pos) : ctx.dist ?? 0;
    if (f.kind === MC.PP_FX_SPLAT) {
      const col = slotColor(f.owner);
      const mine = f.owner === ctx.slot;
      ctx.glow?.({ pos: [f.pos[0], f.pos[1] + 0.3, f.pos[2]], size: f.size * 1.2, color: [...col, 0.9], kind: SPRITE.RING, life: 600, grow: true });
      ctx.glow?.({ pos: [f.pos[0], f.pos[1] + 1, f.pos[2]], size: 3, color: [...col, 1], kind: SPRITE.FLASH, life: 350, grow: true });
      if (mine || d < 30) ctx.sound?.blast?.(mine ? 0 : d, 4);
      if (mine) { ctx.banner?.('SPLAT!', C.GREEN, 1200); ctx.sound?.pickup?.(); }
    } else if (f.kind === MC.PP_FX_ORB) {
      ctx.glow?.({ pos: [f.pos[0], f.pos[1] + 0.2, f.pos[2]], size: 2.2, color: [1, 1, 1, 0.6], kind: SPRITE.RING, life: 400, grow: true });
      if (d < 25) ctx.sound?.land?.(Math.min(14, 160 / (d + 10)));
    } else if (f.kind === MC.PP_FX_RUSH) {
      ctx.banner?.('FINAL 10 SECONDS  BIGGER BRUSHES', C.ORANGE, 2500);
      ctx.sound?.count?.(0);
    } else if (f.kind === MC.PP_FX_LEAD) {
      if (f.owner === ctx.slot) ctx.banner?.('YOU TAKE THE LEAD', C.GREEN, 1500);
      else if (f.shot === ctx.slot) ctx.banner?.(`P${f.owner + 1} TAKES THE LEAD`, C.RED, 1500);
    }
  },

  // the floor shared out: a bar of the leaders' colours (and yours), your share and place, the leader's
  hud(view, ctx) {
    const g = view.party();
    if (g.state !== L.H_PLAY) return;
    const st = stage(view);
    if (!(st.total > 0)) return;
    const live = [];
    let painted = 0;
    for (let p = 0; p < L.NPLAYER; p++) {
      if (!(view.u8[L.PLAYERS + p * L.PSIZE + L.P_FL] & L.PF_LIVE)) continue;
      const c = cells(view, p);
      painted += c;
      live.push([p, c]);
    }
    live.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const me = ctx.slot;
    const pct = (c) => `${((100 * c) / st.total).toFixed(1)}%`;
    const top = live.slice(0, 5);
    const at = live.findIndex(([p]) => p === me);
    if (at >= 5) top.push(live[at]);
    // the bar, 40 cells wide, centred on row 2 (HUD pixels: a cell is 4 x 6)
    if (ctx.rect) {
      const W = 160, x0 = (80 * 4 - W) / 2, y0 = 2 * 6 + 1, y1 = y0 + 4;
      ctx.rect(x0 - 1, y0 - 1, x0 + W + 1, y1 + 1, 0.02, 0.03, 0.07, 0.75);
      let x = x0, shown = 0;
      for (const [p, c] of top) {
        const w = (W * c) / st.total;
        if (w <= 0) continue;
        const col = slotColor(p);
        ctx.rect(x, y0, x + w, y1, col[0], col[1], col[2], 1);
        if (p === me) ctx.rect(x, y1, x + w, y1 + 1, 1, 1, 1, 1);
        x += w;
        shown += c;
      }
      const rest = (W * (painted - shown)) / st.total;
      if (rest > 0) ctx.rect(x, y0, x + rest, y1, 0.45, 0.45, 0.5, 1);
    }
    const lead = live[0];
    const rush = rushing(st, g.t);
    if (at >= 0) {
      const mine = live[at][1];
      const place = 1 + live.filter(([, c]) => c > mine).length;
      const s = `YOU ${pct(mine)}  ${ordinal(place)}` + (lead && lead[0] !== me ? `   P${lead[0] + 1} ${pct(lead[1])}` : '');
      ctx.centre(3, s, place === 1 ? C.GREEN : C.WHITE);
    } else if (lead) ctx.centre(3, `P${lead[0] + 1} LEADS ${pct(lead[1])}`, C.WHITE);
    const free = st.total - painted;
    ctx.right(4, rush ? 'BIG BRUSHES' : `${pct(free)} UNPAINTED`, rush ? C.ORANGE : C.GREY);
  },

  brain: {
    // off the floor is a fall; its last 2.5 m a growing warning
    danger(view, x, z) {
      const st = stage(view);
      const e = st.rad - Math.hypot(x - st.cx, z - st.cx);
      return e <= 0 ? 1 : e < 2.5 ? 0.4 * (2.5 - e) / 2.5 : 0;
    },
    // A bomb near enough and not nearer anyone else, else the most floor not
    // its own: 12 ways out 3.5 m and 7 m, each spot scored by the cells round
    // it, a little for keeping its line, nothing past the rim. Kept 0.3 s or
    // until it's within 2.5 m of it.
    goal(view, me, bot) {
      const b = ball(view, me);
      if (!b || !b.live || b.out) return null;
      const st = stage(view);
      if (!(st.rad > 0)) return null;
      const mem = bot?.mem || {};
      const t = view.tick, tp = view.party().t;
      const x0 = bot?.pos?.[0] ?? b.pos[0], z0 = bot?.pos?.[1] ?? b.pos[2];
      const vx = bot?.vel?.[0] ?? b.vel[0], vz = bot?.vel?.[1] ?? b.vel[2];
      const w = world(view, st);
      const old = mem.pp;
      if (old && t - old.at < 38 && Math.hypot(old.x - x0, old.z - z0) > 2.5) {
        if (old.orb < 0) return [old.x, old.z];
        const o = w.orbs[old.orb];
        if (o && o.bursts === old.bursts) return [old.x, old.z];
      }
      const skill = bot?.skill ?? 0.6;
      const rand = () => (bot?.rand ? bot.rand() : 0.5);
      const sp = Math.hypot(vx, vz);
      let best = null, score = -Infinity, pickOrb = -1, bursts = 0;
      for (let j = 0; j < w.orbs.length; j++) {
        const o = w.orbs[j];
        const d = Math.hypot(o.x - x0, o.z - z0);
        const eta = d / 9;
        const lands = (o.at - tp) * TICK;
        if (d > 30 || lands > eta + 0.6) continue;
        // someone nearer gets there first
        const rival = o.n1[0] === b.slot ? o.n2 : o.n1;
        let s = 16 * 10 / (d + 10);
        if (rival[0] >= 0 && rival[1] < d - 1.5) s *= 0.25;
        s += (rand() - 0.5) * 6 * (1 - skill);
        if (s > score) { score = s; best = [o.x, o.z]; pickOrb = j; bursts = o.bursts; }
      }
      const g = grid(view);
      const rim = st.rad - 1.3;
      for (let k = 0; k < HEADS; k++) {
        const a = (k / HEADS) * 2 * Math.PI;
        const ux = Math.cos(a), uz = Math.sin(a);
        const keep = sp > 2 ? 1.5 * Math.min(1, sp / 6) * (ux * vx + uz * vz) / sp : 0;
        for (const dd of [3.5, 7]) {
          const x = x0 + ux * dd, z = z0 + uz * dd;
          if ((x - st.cx) ** 2 + (z - st.cx) ** 2 > rim * rim) break;
          const s = worth(st, g, b.slot, x, z) + keep + (rand() - 0.5) * 4 * (1 - skill);
          if (s > score) { score = s; best = [x, z]; pickOrb = -1; }
        }
      }
      if (!best) best = [st.cx, st.cx];
      mem.pp = { x: best[0], z: best[1], at: t, orb: pickOrb, bursts };
      return best;
    },
    // in the air paints nothing
    hop() { return false; },
  },
};
