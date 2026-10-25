// VIP (M_VIP), as drawn and as the AI fighter plays it (the rules are
// src/am/vip.wat's, the state AO's as src/am/vip.mjs lays it out). Each
// side's VIP wears a crown over its head in its side's colour (kind CROWN),
// with a waypoint on it: PROTECT your own, KILL theirs. The HUD has both
// VIPs, or when the next is drawn, and YOU ARE THE VIP; the feed every VIP
// drawn, killed or gone, a banner for the ones that are yours; the board's
// VIP KILLS column is MR_POINTS.
// The brain: the VIP keeps by its own side's fighters and out of the
// enemy's way, at no hurry, looking round; attackers hunt the other side's
// VIP, hurrying in once they see it; defenders (every third of a side) keep
// within GUARD of their own. With no VIP to hunt, the nearest enemy.
import * as L from '../../src/layout.mjs';
import * as AC from '../../src/am/consts.mjs';
import { boxClear } from '../../src/arena-view.mjs';
import { C } from '../font.mjs';
import { SIDE, SIDE_C, SIDE_RGB } from './sides.mjs';
import { nearestEnemy } from './slayer.mjs';

// the renderer's crown sprite (client/arena-render.mjs, fs_splat), and its place over a VIP's feet
export const CROWN = 10;
const OVER = 2.25;
// m: an enemy inside THREAT of the VIP moves it on; a defender's spot is 3 m
// off its VIP, held within 4 of it, and farther than GUARD - 4 from its VIP
// it keeps going while it shoots (at GUARD, half the time a defender was
// fighting it was 10 to 20 m off); an attacker hurries in once it sees
// their VIP inside SIGHT
const THREAT = 40;
const GUARD = 10;
const SIGHT = 90;

// Both sides' VIPs as AO holds them, red's then blue's: { side, slot (-1:
// none now), last (-1: none yet), left (ticks to the next draw) }. In the
// countdown AO is 0: nobody, and nobody waiting.
export function vipsOf(view) {
  const u8 = view.u8, dv = view.dv;
  return [0, 1].map((k) => ({ side: k, slot: u8[L.AO + AC.VP_VIP + k] - 1, last: u8[L.AO + AC.VP_LAST + k] - 1, left: dv.getUint16(L.AO + AC.VP_LEFT + 2 * k, true) }));
}

// A VIP in words: P5, NEXT IN 3 (seconds to its draw), or NONE YET (a side with nobody alive to draw).
export const says = (v) => (v.slot >= 0 ? `P${v.slot + 1}` : v.left > 0 ? `NEXT IN ${Math.ceil(v.left / 125)}` : 'NONE YET');

// Slot p's feet, and moved on by its velocity dt s (drawing only).
function feet(view, p, dt = 0) {
  const b = L.PLAYERS + p * L.PSIZE, f = (o) => view.dv.getFloat32(b + o, true);
  return [f(L.P_PX) + f(L.P_VX) * dt, f(L.P_PY) + f(L.P_VY) * dt, f(L.P_PZ) + f(L.P_VZ) * dt];
}
const alive = (view, q) => (view.u8[L.PLAYERS + q * L.PSIZE + L.P_FL] & (L.PF_LIVE | L.PF_DEAD)) === L.PF_LIVE;
const across = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

// Can an eye at a see a point at b, past the map's boxes and over the ground (steps of a metre)? As the bot's own.
function sees(view, a, b) {
  if (!boxClear(view.map(), a, b)) return false;
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  for (let k = 1; k < n; k++) {
    const t = k / n, x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t;
    if (a[1] + (b[1] - a[1]) * t < view.height(x, z) + 0.1) return false;
  }
  return true;
}

// Live fighters but slot `me`, by side from its bit: [friends, enemies], feet.
function sides(view, me) {
  const u8 = view.u8, mine = u8[L.PLAYERS + me * L.PSIZE + L.P_FL] & L.PF_BLUE, out = [[], []];
  for (let q = 0; q < L.NPLAYER; q++) {
    if (q === me || !alive(view, q)) continue;
    out[(u8[L.PLAYERS + q * L.PSIZE + L.P_FL] & L.PF_BLUE) === mine ? 0 : 1].push(feet(view, q));
  }
  return out;
}

// Where a VIP at `pos` goes with enemies near: of eight points 12 m round it
// it can walk to (no box across the way at knee or chest height, not in a
// building, not up or down a cliff, 20 m inside the map's bounds), the one
// farthest from the nearest enemy, less half a metre for each metre from
// `home` (where it keeps to); null if none is clear.
function away(view, pos, enemies, home) {
  const map = view.map(), [x0, x1, z0, z1] = map.bounds;
  let best = null, bs = -Infinity;
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    const x = pos[0] + 12 * Math.cos(a), z = pos[2] + 12 * Math.sin(a);
    if (x < x0 + 20 || x > x1 - 20 || z < z0 + 20 || z > z1 - 20) continue;
    const y = view.stand(x, z);
    if (Math.abs(y - pos[1]) > 3) continue;
    if (map.groups.some((g) => x > g.box[0] - 1 && x < g.box[3] + 1 && z > g.box[2] - 1 && z < g.box[5] + 1)) continue;
    if (![0.5, 1.4].every((h) => boxClear(map, [pos[0], pos[1] + h, pos[2]], [x, y + h, z]))) continue;
    const p = [x, y, z];
    const s = Math.min(Math.min(...enemies.map((e) => across(e, p))), 60) - 0.5 * across(home, p);
    if (s > bs) { bs = s; best = p; }
  }
  return best;
}

// A defender's spot by its VIP: 3 m off it, round by its rank (defenders spread out).
const beside = (p, rank) => { const a = rank * 2.4; return [p[0] + Math.cos(a) * 3, p[1], p[2] + Math.sin(a) * 3]; };

export default {
  mode: L.M_VIP,
  key: 'vip',

  // rows 2 and 3: your VIP (or YOU ARE THE VIP) and theirs; a spectator's, red's and blue's
  hud(view, ctx) {
    if (view.hole().state === L.H_COUNT) { ctx.put(1, 2, 'EACH SIDE DRAWS A VIP', ctx.C.WHITE); return; }
    const vs = vipsOf(view);
    if (ctx.team < 0) {
      vs.forEach((v, k) => ctx.put(1, 2 + k, `${SIDE[k]} VIP  ${says(v)}`, SIDE_C[k]));
      return;
    }
    const mine = vs[ctx.team], theirs = vs[1 - ctx.team];
    if (mine.slot === ctx.slot && ctx.slot >= 0) ctx.put(1, 2, 'YOU ARE THE VIP', (ctx.now >> 9) & 1 ? ctx.C.YELLOW : ctx.C.WHITE);
    else ctx.put(1, 2, `YOUR VIP  ${says(mine)}`, SIDE_C[ctx.team]);
    ctx.put(1, 3, `THEIR VIP  ${says(theirs)}`, SIDE_C[1 - ctx.team]);
  },

  // The feed in the side's colour (a kill's in the scoring side's), a banner for what's yours.
  news(f, ctx) {
    const mine = ctx.me ? ctx.team(ctx.slot) : -1;
    const you = ctx.slot >= 0 && f.owner === ctx.slot;
    const up = (h) => [f.pos[0], f.pos[1] + h, f.pos[2]];
    switch (f.size) {
      case AC.VP_MX_DRAW: {
        const side = f.shot;
        if (side !== 0 && side !== 1) return;
        ctx.feed(`${ctx.name(f.owner)} ${you ? 'ARE' : 'IS'} THE ${SIDE[side]} VIP`, SIDE_C[side]);
        ctx.glow({ pos: up(1.2), size: 1.8, color: [...SIDE_RGB[side], 0.9], kind: 6, life: 600, grow: true });
        if (you) { ctx.banner('YOU ARE THE VIP  STAY ALIVE', C.YELLOW, 3000); ctx.sound?.pickup?.(); }
        else if (mine === side) ctx.banner(`PROTECT P${f.owner + 1}  YOUR VIP`, SIDE_C[side], 2000);
        break;
      }
      case AC.VP_MX_KILL: {
        const vip = f.shot & 255, side = f.shot >> 8;
        if (side !== 0 && side !== 1) return;
        const by = 1 - side;
        ctx.feed(f.owner === vip ? `THE ${SIDE[side]} VIP DIED` : `${ctx.name(f.owner)} KILLED THE ${SIDE[side]} VIP`, SIDE_C[by]);
        ctx.glow({ pos: up(1), size: 3, color: [...SIDE_RGB[by], 0.9], kind: 3, life: 700, grow: true });
        if (you && f.owner !== vip) ctx.banner('YOU KILLED THEIR VIP', C.YELLOW, 3000);
        else if (mine === side) ctx.banner('YOUR VIP IS DOWN', SIDE_C[by], 2500);
        else if (mine === by) ctx.banner('THEIR VIP IS DOWN  A POINT', SIDE_C[by], 2500);
        ctx.sound?.holed?.();
        break;
      }
      case AC.VP_MX_GONE: {
        const side = f.shot;
        if (side !== 0 && side !== 1) return;
        ctx.feed(`THE ${SIDE[side]} VIP LEFT`, SIDE_C[side]);
        break;
      }
      default:
    }
  },

  // A crown over each live VIP's head where the renderer draws it (the
  // confirmed world run on by dt), but the one the camera's in; the
  // waypoints well over it, to the fighter shown's side (a spectator's watched one).
  draw(view, ctx, out) {
    const eye = ctx.shown >= 0 ? view.fighter(ctx.shown) : null;
    const team = eye?.live && view.teamed() ? eye.team : -1;
    for (const v of vipsOf(view)) {
      if (v.slot < 0 || v.slot === ctx.shown || !alive(view, v.slot)) continue;
      const p = feet(view, v.slot, ctx.dt);
      const bob = 0.05 * Math.sin(ctx.now / 260 + v.side * 2);
      out.solid.push({ pos: [p[0], p[1] + OVER + bob, p[2]], size: 0.34, aspect: 0.8, color: [...SIDE_RGB[v.side], 1], kind: CROWN, minpx: 3 });
      out.glow.push({ pos: [p[0], p[1] + OVER + bob, p[2]], size: 0.8, color: [...SIDE_RGB[v.side], 0.35 + 0.1 * Math.sin(ctx.now / 300)], kind: 3, minpx: 1 });
      if (team >= 0) out.markers.push({ pos: [p[0], p[1] + OVER + 1.4, p[2]], label: v.side === team ? 'PROTECT' : 'KILL', color: SIDE_C[v.side], kind: 'crown' });
    }
  },

  cols: [{ head: 'VIP KILLS', get: (o) => String(o.points) }],

  // the VIP: by its nearest friend on its own half, or at its own flag's
  // stand with none, and out of an enemy's way inside THREAT (following a
  // friend wherever it went took it after the attackers into the enemy's
  // half); a defender: its spot by its VIP; an attacker: their VIP,
  // hurrying once it sees it. With no VIP to hunt, the nearest enemy.
  goal(view, me, ctx) {
    if (view.hole().state !== L.H_PLAY) return null;
    const team = me.team;
    if (team !== 0 && team !== 1) return null;
    const vs = vipsOf(view), mine = vs[team], theirs = vs[1 - team];
    if (mine.slot === me.slot) {
      const [friends, enemies] = sides(view, me.slot);
      const fl = view.map().flags, off = (p, f) => (p[0] - f[0]) ** 2 + (p[2] - f[1]) ** 2;
      let home = null, hd = Infinity;
      for (const p of friends) {
        const d = across(p, me.pos);
        if (d < hd && off(p, fl[team]) < off(p, fl[1 - team])) { hd = d; home = p; }
      }
      if (!home) { const [x, z, top] = fl[team]; home = [x, view.stand(x, z, top), z]; }
      if (enemies.some((e) => across(e, me.pos) < THREAT)) return { pos: away(view, me.pos, enemies, home) || home, r: 3, hurry: 0.2, hold: true };
      return { pos: across(home, me.pos) > 6 ? home : me.pos, r: 4, hurry: 0.2, hold: true };
    }
    if (ctx.role === 'defend' && mine.slot >= 0) {
      const at = feet(view, mine.slot);
      return { pos: beside(at, ctx.rank), r: 4, hurry: across(at, me.pos) > GUARD - 4 ? 0.6 : 0.2, hold: true };
    }
    if (theirs.slot >= 0 && alive(view, theirs.slot)) {
      const at = feet(view, theirs.slot);
      const d = across(at, me.pos);
      const seen = d < SIGHT && sees(view, [me.pos[0], me.pos[1] + 1.6, me.pos[2]], [at[0], at[1] + 1.2, at[2]]);
      return { pos: at, r: seen ? 2 : 6, hurry: seen ? 0.8 : 0, hold: false };
    }
    const [q] = nearestEnemy(view, me);
    return q < 0 ? null : { pos: feet(view, q), r: 6, hurry: 0, hold: false };
  },

  state(view) {
    return { score: view.mode().score, target: view.mode().target, vips: vipsOf(view).map((v) => ({ slot: v.slot, last: v.last, left: v.left })) };
  },
};
