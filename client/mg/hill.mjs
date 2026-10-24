// KING OF THE HILL, as drawn and as the AI ball sees it. A grassy island
// over the sea; the hill is a mown lawn swelling out of it (the top of an
// ellipsoid, drawn as one, so what is drawn is what the sim rolls on), the
// zone a ring of gold dashes round its top and the top itself a glowing
// disc, with a big gold crown turning over it; 4 s into a zone a power-up
// falls onto each top, a target marking where. When the zone is about to
// move the next hill swells where a cyan ring and a beam mark it, and the
// crown flies over to it; the old hill sinks back after. The leader wears a
// little crown. The hills' heights are the sim's (src/mg/hill.wat) worked
// again here from PG_H and the tick, so the bots steer by what the sim does.
import * as L from '../../src/layout.mjs';
import { PLAT_Y } from '../../src/party-view.mjs';
import { LOOK, SPRITE, DECAL, SHAPE } from '../party-render.mjs';
import { C } from '../font.mjs';

const TICK = 0.008;
const GRASS = [0.25, 0.5, 0.2];
const LAWN = [0.56, 0.8, 0.3];
const EARTH = [0.42, 0.3, 0.2];
const ROCK = [0.36, 0.33, 0.31];
const GOLD = [1, 0.78, 0.24];
const NEXT = [0.35, 0.9, 1];
// the power-ups' colours, by PU_* (bumper's)
const PU_RGB = [[1, 1, 1], [1, 0.3, 0.25], [0.3, 0.8, 1], [1, 0.85, 0.2], [1, 0.55, 0.15], [0.5, 1, 0.45]];
const CROWN_UP = 7.5; // m over the hill's top the big crown turns: over the chase camera, seen from afar

// ---- the stage, as the sim has it (PG_H, read once a world tick)

export function stage(view) {
  const o = view.bank || 0;
  if (view._kh && view._kh.tick === view.tick && view._kh.o === o) return view._kh;
  const dv = view.dv, h = L.PG_H + o;
  const g = (k) => dv.getFloat32(h + k, true);
  const cx = dv.getFloat32(L.PG_CX + o, true);
  const nh = Math.max(1, Math.min(L.KH_HMAX, dv.getUint32(h + L.KH_NH, true)));
  // spots[zone][hill] = [x, z], as $kh_spot has them (1/64 m from the middle, f32)
  const spots = [];
  for (let j = 0; j < L.KH_ZONES; j++) {
    const zone = [];
    for (let i = 0; i < nh; i++) {
      const a = h + L.KH_SPOT + 4 * (j * L.KH_HMAX + i);
      zone.push([Math.fround(dv.getInt16(a, true) * 0.015625 + cx), Math.fround(dv.getInt16(a + 2, true) * 0.015625 + cx)]);
    }
    spots.push(zone);
  }
  const F = g(L.KH_F);
  view._kh = {
    tick: view.tick, o, cx, nh,
    rad: g(L.KH_RAD), z: g(L.KH_Z), top: g(L.KH_TOP), F, H: g(L.KH_H), ia2: g(L.KH_IA2), A: F / Math.sqrt(0.75),
    lead: dv.getUint32(h + L.KH_LEAD, true), spots,
  };
  return view._kh;
}

// The zone open on tick t into play ($kh_zone).
export const zoneAt = (t) => Math.min(L.KH_ZONES - 1, Math.floor(Math.max(0, t) / L.KH_PERIOD));
const ease = (s) => s * s * (3 - 2 * s);
// How far zone j's hills have risen on tick t into play, t fractional for drawing ($kh_up).
export function up(j, t) {
  let a = t - (j * L.KH_PERIOD - L.KH_RISE);
  if (a < 0) return 0;
  if (a < L.KH_RISE) return ease(a / L.KH_RISE);
  a -= L.KH_RISE + L.KH_PERIOD;
  if (a < 0 || j === L.KH_ZONES - 1) return 1;
  return a < L.KH_RISE ? 1 - ease(a / L.KH_RISE) : 0;
}
// A hill's top at (x, z), its centre (sx, sz), risen u, or -Infinity past its foot ($kh_hill).
export function hillAt(st, [sx, sz], u, x, z) {
  if (u <= 0) return -Infinity;
  const dx = x - sx, dz = z - sz;
  const q = 1 - (dx * dx + dz * dz) * st.ia2;
  return q <= 0.25 ? -Infinity : PLAT_Y + st.H * u * (2 * Math.sqrt(q) - 1);
}
// The ground at (x, z) on tick t into play: -Infinity off the disc ($kh_surface).
export function groundAt(st, t, x, z) {
  const dx = x - st.cx, dz = z - st.cx;
  if (dx * dx + dz * dz > st.rad * st.rad) return -Infinity;
  const k = zoneAt(t);
  let top = PLAT_Y;
  for (let j = Math.max(0, k - 1); j <= Math.min(L.KH_ZONES - 1, k + 1); j++) {
    const u = up(j, t);
    for (const s of st.spots[j]) top = Math.max(top, hillAt(st, s, u, x, z));
  }
  return top;
}
// The open zone's radius on tick t into play, shrinking as it goes ($kh_reach).
export const reach = (st, t) => st.z * (1 - L.KH_SHRINK * Math.min(1, (t - zoneAt(t) * L.KH_PERIOD) / L.KH_PERIOD));
// What (x, z) scores on tick t into play: 2 on a top, 1 in the zone, else 0 (on the ground).
export function worth(st, t, x, z) {
  const r = reach(st, t);
  let w = 0;
  for (const [sx, sz] of st.spots[zoneAt(t)]) {
    const d2 = (x - sx) ** 2 + (z - sz) ** 2;
    if (d2 <= r * r) w = d2 <= st.top * st.top ? 2 : 1;
  }
  return w;
}
// Ticks into play to draw at (fractional), frozen where the round ended; -1 before play.
function playTime(view, g, ctx) {
  if (g.state === L.H_COUNT) return 0;
  if (g.state !== L.H_PLAY && g.state !== L.H_OVER) return -1;
  let t = typeof ctx?.pt === 'number' && ctx.pt > 0 ? ctx.pt / TICK : typeof ctx?.t === 'number' && ctx.t > 0 ? ctx.t / TICK : g.t;
  if (g.state === L.H_OVER) t = Math.min(t, L.KH_LEN);
  return Math.max(0, t);
}

// A crown of gold: a band, five points with a gem on each, turned by spin; s its size (1: the big one's 1.3 m band).
function crown(sc, x, y, z, s, spin, alpha = 1) {
  sc.cyl(x, y, z, 1.3 * s, 0.38 * s, ...GOLD, LOOK.METAL, 0, 0, alpha);
  for (let i = 0; i < 5; i++) {
    const a = spin + (i * 2 * Math.PI) / 5, px = x + Math.cos(a) * 1.12 * s, pz = z + Math.sin(a) * 1.12 * s;
    sc.cyl(px, y + 0.62 * s, pz, 0.2 * s, 0.32 * s, ...GOLD, LOOK.METAL, 0, 0, alpha);
    sc.sphere(px, y + 1.02 * s, pz, 0.22 * s, 1, 0.16, 0.2, LOOK.GLOW, 0.9, 0, alpha);
  }
}

// A ring of n glowing dashes round (x, z) at radius r, height y, turning with spin.
function dashes(sc, x, y, z, r, rgb, glow, spin, alpha = 1) {
  const n = Math.max(18, Math.round((2 * Math.PI * r) / 1.15));
  const half = (Math.PI * r) / n * 0.6;
  for (let i = 0; i < n; i++) {
    const a = spin + (i * 2 * Math.PI) / n;
    sc.box(x + Math.cos(a) * r, y, z + Math.sin(a) * r, half, 0.07, 0.17, a + Math.PI / 2, ...rgb, LOOK.GLOW, glow, 0.3, alpha);
  }
}

// the prediction's ball as last drawn, for the HUD (which gets the confirmed one)
let mine = null;

// ---- the AI ball

const MINDS = new WeakMap();
const mindOf = (bot) => { if (!bot || typeof bot !== 'object') return {}; let m = MINDS.get(bot); if (!m) MINDS.set(bot, (m = {})); return m; };
const ball = (view, me) => (typeof me === 'number' ? view.partier(me) : me);
// A number in [0, 1) for this ball and k, its own and the same every time.
const luck = (slot, k) => { let h = Math.imul(slot + 1, 0x9e3779b1) ^ Math.imul(k + 7, 0x85ebca6b); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 13; return (h >>> 0) / 2 ** 32; };

// Balls in within a zone's radius of each of the open zone's hills (now) and
// the next's (next), once a world tick: what a ball sees of where the crowd is.
function crowds(view, st) {
  const k = zoneAt(view.party().t);
  const c = view._khc;
  if (c && c.tick === view.tick && c.o === st.o && c.k === k) return c;
  const n = { tick: view.tick, o: st.o, k, now: new Float64Array(L.KH_HMAX), next: new Float64Array(L.KH_HMAX), all: 0 };
  if (st.nh > 1) {
    const z2 = st.z * st.z, a = st.spots[k], b = st.spots[Math.min(L.KH_ZONES - 1, k + 1)];
    for (let p = 0; p < L.NPLAYER; p++) {
      const r = L.PLAYERS + view.bank + p * L.PSIZE;
      if ((view.u8[r + L.P_FL] & (L.PF_LIVE | L.PF_DEAD | L.PF_FALL)) !== L.PF_LIVE) continue;
      const x = view.dv.getFloat32(r + L.P_PX, true), z = view.dv.getFloat32(r + L.P_PZ, true);
      n.all++;
      for (let i = 0; i < st.nh; i++) {
        if ((x - a[i][0]) ** 2 + (z - a[i][1]) ** 2 < z2) n.now[i]++;
        if ((x - b[i][0]) ** 2 + (z - b[i][1]) ** 2 < z2) n.next[i]++;
      }
    }
  }
  view._khc = n;
  return n;
}

// Which of zone j's hills the ball makes for, from (x, z): the nearest in
// seconds, less so the more crowded it is than the others, by its own luck a
// little; kept a while (a second and a half) once chosen.
function hillFor(st, mind, slot, j, x, z, crowd, all, t) {
  if (st.nh === 1) return 0;
  const kept = mind.hills?.[j];
  if (kept && t - kept.at < 190) return kept.i;
  const mean = Math.max(1, all / st.nh);
  let best = Infinity, pick = 0;
  for (let i = 0; i < st.nh; i++) {
    const [sx, sz] = st.spots[j][i];
    const s = Math.hypot(sx - x, sz - z) / 8 + 2 * crowd[i] / mean + 0.6 * luck(slot, 300 + j * 7 + i);
    if (s < best) { best = s; pick = i; }
  }
  (mind.hills ||= {})[j] = { i: pick, at: t };
  return pick;
}

// Where the ball wants to be on tick `tick`: the top of one of the open
// zone's hills, or of the next's once the trip there takes about as long as
// the zone has left (a clumsy ball leaves late), a little off the very top by
// its own luck so a crowd spreads over it rather than queueing for one point.
function plan(view, me, bot, tick) {
  const b = ball(view, me);
  const o = view.bank || 0;
  if (!b || !b.live || b.out || view.dv.getUint32(L.HDR_STATE + o, true) !== L.H_PLAY) return null;
  const st = stage(view);
  if (!(st.rad > 0)) return null;
  const t = Math.max(0, (tick - view.dv.getUint32(L.HDR_START + o, true)) | 0);
  const k = zoneAt(t);
  const pos = bot?.pos ?? [b.pos[0], b.pos[2]];
  const vel = bot?.vel ?? [b.vel[0], b.vel[2]];
  const skill = bot?.skill ?? 0.6;
  const mind = mindOf(bot);
  const crowd = crowds(view, st);
  let j = k, i = hillFor(st, mind, b.slot, k, pos[0], pos[1], crowd.k === k ? crowd.now : crowd.next, crowd.all, t);
  if (k + 1 < L.KH_ZONES) {
    const n = hillFor(st, mind, b.slot, k + 1, pos[0], pos[1], crowd.k === k ? crowd.next : crowd.now, crowd.all, t);
    const [nx, nz] = st.spots[k + 1][n];
    const trip = Math.hypot(nx - pos[0], nz - pos[1]) / 8 + 0.3 + 1.2 * (1 - skill) * luck(b.slot, k);
    if (((k + 1) * L.KH_PERIOD - t) * TICK < trip) { j = k + 1; i = n; }
  }
  const [sx, sz] = st.spots[j][i];
  const r = st.top * 0.6 * luck(b.slot, 100 + j), a = 2 * Math.PI * luck(b.slot, 200 + j);
  return { goal: [sx + Math.cos(a) * r, sz + Math.sin(a) * r], zone: j, hill: i, pos, vel, st, t, mind };
}

// Push for the velocity that gets to the goal and stops there, against the
// slope's pull as it comes: full speed while far, braking as it closes (yaw
// in radians, as the planner reads it).
function steer(p, last) {
  const dx = p.goal[0] - p.pos[0], dz = p.goal[1] - p.pos[1], d = Math.hypot(dx, dz);
  const want = Math.min(10, Math.sqrt(2 * 6 * Math.max(0, d - 0.3)));
  const vx = d > 1e-6 ? (dx / d) * want : 0, vz = d > 1e-6 ? (dz / d) * want : 0;
  const ax = vx - p.vel[0], az = vz - p.vel[1];
  if (Math.hypot(ax, az) < 0.35) return { yaw: last ?? 0, move: 0 };
  return { yaw: Math.atan2(az, ax), move: 1 };
}

export default {
  id: L.MG_HILL, key: 'hill', name: 'KING OF THE HILL',
  hint: 'HOLD THE TOP OF THE HILL  A POINT A TICK  TWO ON THE VERY TOP',
  env: 'day',

  draw(view, ctx, out) {
    const st = stage(view);
    if (!(st.rad > 0)) return;
    const g = view.party();
    const sc = out.scene;
    const { cx, rad } = st;
    const depth = Math.max(5, 3.4 * st.H);
    // the island: a skin of grass, the earth under it deep enough to hide a hill's lower half, a rocky root
    sc.cyl(cx, PLAT_Y - 0.3, cx, rad, 0.3, ...GRASS, LOOK.MATTE);
    sc.cyl(cx, PLAT_Y - 0.6 - depth / 2, cx, rad - 0.15, depth / 2, ...EARTH, LOOK.MATTE);
    sc.cyl(cx, PLAT_Y - 0.6 - depth - 2, cx, rad * 0.72, 2, ...ROCK, LOOK.RUBBER);
    sc.cyl(cx, PLAT_Y - 0.6 - depth - 5.5, cx, rad * 0.4, 1.5, ...ROCK, LOOK.RUBBER);
    out.decals?.push({ pos: [cx, PLAT_Y + 0.02, cx], radius: rad, width: 0.35, color: [1, 1, 1, 0.3], kind: DECAL.RING });
    const tp = playTime(view, g, ctx);
    if (tp < 0) return;
    const now = (ctx?.now ?? 0) / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(now * 6);
    const k = zoneAt(tp);
    const next = k + 1 < L.KH_ZONES && tp >= (k + 1) * L.KH_PERIOD - L.KH_RISE ? k + 1 : -1;
    // the hills up: the last zone's sinking (a duller lawn as they go), the open one's, the next's swelling
    for (let j = Math.max(0, k - 1); j <= Math.min(L.KH_ZONES - 1, k + 1); j++) {
      const u = up(j, tp);
      if (u <= 0.002) continue;
      const h = st.H * u;
      const fade = j < k ? 1 - u : 0;
      const col = LAWN.map((c, i) => c + (GRASS[i] - c) * fade);
      for (const [sx, sz] of st.spots[j]) sc.put(SHAPE.SPHERE, sx, PLAT_Y - h, sz, st.A, 2 * h, st.A, 0, ...col, LOOK.CHECKER, 1.6, 0.6, 1);
    }
    // a hill's top risen h, and its height r out from its centre
    const rim = (h, r) => PLAT_Y + h * (2 * Math.sqrt(Math.max(0.25, 1 - r * r * st.ia2)) - 1);
    const hz = st.H * up(k, tp);
    const rz = reach(st, tp);
    const hn = next >= 0 ? st.H * up(next, tp) : 0;
    // the crowns fly over to the next zone's hills in its last second
    const fly = next >= 0 ? ease(Math.max(0, Math.min(1, (tp - (next * L.KH_PERIOD - 125)) / 125))) : 0;
    for (let i = 0; i < st.nh; i++) {
      // the open zone: gold dashes round it, the top aglow, a faint beam
      const [sx, sz] = st.spots[k][i];
      const y0 = PLAT_Y + hz;
      if (g.state === L.H_PLAY || g.state === L.H_COUNT) {
        dashes(sc, sx, rim(hz, rz) + 0.05, sz, rz, GOLD, 0.9 + 0.4 * pulse, now * 0.25 + i);
        out.decals?.push({ pos: [sx, y0 + 0.04, sz], radius: st.top, width: 0.3, color: [1, 0.85, 0.3, 0.85], kind: DECAL.ZONE });
      }
      if (g.state === L.H_PLAY) out.beams?.push({ a: [sx, PLAT_Y + 45, sz], b: [sx, y0 + 0.2, sz], width: 0.35, color: [1, 0.85, 0.35, 0.18] });
      let cx1 = sx, cz1 = sz, cy1 = y0;
      if (next >= 0) {
        // the next: its foot ringed on the floor as it swells, its zone in cyan dashes, a beam onto it
        const [nx, nz] = st.spots[next][i];
        out.decals?.push({ pos: [nx, PLAT_Y + 0.03, nz], radius: st.F, width: 0.5, color: [...NEXT, 0.45 + 0.4 * pulse], kind: DECAL.RING });
        dashes(sc, nx, rim(hn, st.z) + 0.05, nz, st.z, NEXT, 0.5 + 0.6 * pulse, -now * 0.25 - i);
        out.beams?.push({ a: [nx, PLAT_Y + 45, nz], b: [nx, PLAT_Y + hn + 0.3, nz], width: 0.6 + 0.4 * pulse, color: [...NEXT, 0.4] });
        cx1 = sx + (nx - sx) * fly; cz1 = sz + (nz - sz) * fly;
        cy1 = y0 + (PLAT_Y + hn - y0) * fly + 4 * Math.sin(Math.PI * fly);
      }
      crown(sc, cx1, cy1 + CROWN_UP + 0.4 * Math.sin(now * 1.7 + i), cz1, 0.9, now * 0.8 + i);
      out.glow?.push({ pos: [cx1, cy1 + CROWN_UP + 0.6, cz1], size: 4.5, color: [1, 0.85, 0.35, 0.35], kind: SPRITE.FLASH });
    }
    // the leader's crown, over its rider as the frontend draws it
    mine = ctx?.pme && ctx.pme.live && !ctx.pme.out ? ctx.pme : null;
    if (st.lead < L.NPLAYER && (g.state === L.H_PLAY || g.state === L.H_OVER)) {
      const own = mine && st.lead === ctx.slot;
      const b = own ? mine : view.partier(st.lead);
      if (b.live && !b.out) {
        const dt = own ? Math.max(-0.02, Math.min(0.03, (ctx.ptick - (ctx.pview?.tick ?? ctx.ptick)) * TICK)) : ctx?.dt || 0;
        const x = b.pos[0] + b.vel[0] * dt, y = b.pos[1] + b.vel[1] * dt, z = b.pos[2] + b.vel[2] * dt;
        crown(sc, x, y + 2 * b.radius + 1.22, z, 0.3, now * 2);
      }
    }
    // the power-ups: a target where one will land and a streak as it falls, then on the top, bobbing
    for (let i = 0; i < st.nh; i++) {
      const o = L.PG_S + L.KH_ORBS + 16 * i;
      const kind = view.u8[o + 12];
      if (!kind || !PU_RGB[kind]) continue;
      const x = view.dv.getFloat32(o, true), z = view.dv.getFloat32(o + 8, true);
      const falling = view.u8[o + 13] === 1;
      const ground = groundAt(st, tp, x, z) + 0.6;
      const y = falling ? Math.max(ground, view.dv.getFloat32(o + 4, true) - 10 * (ctx?.dt || 0)) : ground + 0.15 * Math.sin(now * 3 + i);
      const rgb = PU_RGB[kind];
      out.casters?.push([x, y, z, -0.6]);
      out.solid?.push({ pos: [x, y, z], size: 0.6, color: [...rgb, 1], kind: SPRITE.ORB, minpx: 2 });
      out.glow?.push({ pos: [x, y, z], size: 1.5 + 0.3 * pulse, color: [...rgb, 0.5], kind: SPRITE.FLASH, minpx: 2 });
      if (falling) {
        out.beams?.push({ a: [x, y + 5, z], b: [x, y, z], width: 0.12, color: [...rgb, 0.35] });
        out.decals?.push({ pos: [x, ground - 0.5, z], radius: 1.4, width: 0.25, color: [...rgb, 0.85], kind: DECAL.TARGET });
      }
    }
    // under your own ball while it scores: a gold ring, brighter on a top
    if (mine && mine.ground && g.state === L.H_PLAY) {
      const w = worth(st, tp, mine.pos[0], mine.pos[2]);
      const dt = Math.max(-0.02, Math.min(0.03, (ctx.ptick - (ctx.pview?.tick ?? ctx.ptick)) * TICK));
      if (w) out.decals?.push({ pos: [mine.pos[0] + mine.vel[0] * dt, mine.pos[1] + 0.05, mine.pos[2] + mine.vel[2] * dt], radius: 1.6, width: 0.3, color: [1, 0.85, 0.3, w === 2 ? 0.95 : 0.55], kind: DECAL.RING });
    }
  },

  frame(view) {
    const st = stage(view);
    const g = view.party();
    return { centre: [st.cx || g.cx, PLAT_Y, st.cx || g.cx], radius: st.rad || g.size, shape: 'disc' };
  },

  fx(f, ctx) {
    const d = typeof ctx.dist === 'function' ? ctx.dist(f.pos) : ctx.dist ?? 0;
    if (f.kind === L.KH_FX_NEXT) {
      ctx.banner?.('THE HILL MOVES', C.ORANGE, 1500);
      ctx.sound?.tick?.();
      ctx.glow?.({ pos: [f.pos[0], f.pos[1] + 0.3, f.pos[2]], size: 6, color: [...NEXT, 0.8], kind: SPRITE.RING, life: 700, grow: true });
    } else if (f.kind === L.KH_FX_MOVE) {
      if (f.shot > 0) { ctx.banner?.('NEW HILL', C.YELLOW, 1200); ctx.sound?.pickup?.(); }
      ctx.glow?.({ pos: [f.pos[0], f.pos[1] + 0.3, f.pos[2]], size: 8, color: [1, 0.85, 0.3, 0.9], kind: SPRITE.RING, life: 800, grow: true });
    } else if (f.kind === L.KH_FX_ORB) {
      if (f.shot === 0) ctx.feed?.(`${L.PU_NAMES[f.size] || 'A POWER-UP'} DROPPING ON THE TOP${ctx.view && stage(ctx.view).nh > 1 ? 'S' : ''}`, C.CYAN);
      if (d < 50 && f.shot === 0) ctx.sound?.tick?.();
    } else if (f.kind === L.KH_FX_LEAD) {
      if (f.owner === ctx.slot) { ctx.banner?.('YOU TAKE THE LEAD', C.GREEN, 1500); ctx.sound?.pickup?.(); }
      else if (f.shot === ctx.slot) ctx.banner?.(`${ctx.name?.(f.owner) ?? `P${f.owner + 1}`} TAKES THE LEAD`, C.RED, 1500);
      else ctx.feed?.(`${ctx.name?.(f.owner) ?? `P${f.owner + 1}`} TAKES THE LEAD`, C.YELLOW);
      if (d < 60) ctx.glow?.({ pos: [f.pos[0], f.pos[1] + 3.4, f.pos[2]], size: 1.6, color: [1, 0.85, 0.3, 0.9], kind: SPRITE.FLASH, life: 500, grow: true });
    }
  },

  // which hill and when it moves, and what you're scoring
  hud(view, ctx) {
    const g = view.party();
    if (g.state !== L.H_PLAY) return;
    const st = stage(view);
    if (!(st.rad > 0)) return;
    const t = typeof ctx.t === 'number' ? ctx.t / TICK : g.t;
    const k = zoneAt(t);
    const row = Math.max(3, Math.floor((ctx.rows || 40) * 0.18));
    const left = k + 1 < L.KH_ZONES ? (k + 1) * L.KH_PERIOD - t : -1;
    ctx.right(3, left >= 0 ? `HILL ${k + 1} OF ${L.KH_ZONES}  MOVES IN ${Math.ceil(left * TICK)}` : `LAST HILL`, C.GREY);
    const me = mine && mine.slot === ctx.slot ? mine : ctx.me;
    if (me && me.live && !me.out) {
      const w = me.ground ? worth(st, t, me.pos[0], me.pos[2]) : 0;
      ctx.centre(row, w === 2 ? 'ON TOP  +2' : w === 1 ? 'IN THE ZONE  +1' : 'GET TO THE HILL', w === 2 ? C.YELLOW : w === 1 ? C.GREEN : C.WHITE);
    }
    if (left >= 0 && left <= L.KH_RISE) ctx.centre(row + 1, `THE HILL MOVES  ${Math.ceil(left * TICK)}`, C.ORANGE);
  },

  brain: {
    // off the disc is a fall; its last 2.5 m a warning
    danger(view, x, z) {
      const st = stage(view);
      const e = st.rad - Math.hypot(x - st.cx, z - st.cx);
      return e <= 0 ? 1 : e < 2.5 ? ((2.5 - e) / 2.5) * 0.7 : 0;
    },
    goal(view, me, bot) {
      const p = plan(view, me, bot, bot?.at ?? view.tick);
      return p ? p.goal : null;
    },
    hop() { return false; },
    // straight for the goal and holding there, braking and pushing back up
    // against the slope, into the crowd if there is one (the disc is round,
    // so the way to a hill never crosses the rim); near the rim, where a
    // bump has sent it, the planner steers it in
    think(view, me, bot, tick = view.tick) {
      const p = plan(view, me, bot, tick);
      if (!p) return null;
      if (Math.hypot(p.pos[0] - p.st.cx, p.pos[1] - p.st.cx) > p.st.rad - 4) return null;
      const s = steer(p, p.mind.yaw);
      p.mind.yaw = s.yaw;
      return s;
    },
  },
};
