// HEADHUNTER (M_HEADHUNT), as drawn and as the AI fighter plays it (the rules
// are src/am/headhunter.wat's, the state AO's as src/am/headhunter.mjs lays
// it out). The drop zone: a gold disc on the ground or a roof, lights chasing
// round its rim, a pillar of light that reads across the map, and a ZONE
// waypoint with its distance (not over the head of the fighter shown while
// it stands in it). Each pile of skulls: a heap of up to three where it lies,
// glowing, the nearest few with a +N waypoint. A carrier's skulls stacked over
// its head (up to five), the nearest few with their count in its side's
// colour; your own are your HUD's. The HUD: what you carry, the zone's
// distance and when it moves; the board's SKULLS (banked) and CARRIED. The
// brain: a fighter carrying skulls runs to the zone, hurrying more the more
// it carries, taking piles on its way; the rest go for a pile near them,
// defenders (every third of a side) guard the zone, attackers hunt an enemy
// carrying skulls near them, else the nearest enemy (kills are skulls).
import * as L from '../../src/layout.mjs';
import * as AC from '../../src/am/consts.mjs';
import { C } from '../font.mjs';
import { SIDE, SIDE_C, SIDE_RGB } from './sides.mjs';

const ZONE_H = Number(AC.HH_ZONE_H);
const ZONE_RGB = [1, 0.78, 0.22];
const SKULL_RGB = [0.95, 0.92, 0.82];
const PILE_MARKS = 3; // the nearest piles with a waypoint, within PILE_SEEN m
const PILE_SEEN = 30;
const CARRY_MARKS = 3; // the nearest carriers with their count, within CARRY_SEEN m
const CARRY_SEEN = 35;
const SPRITES = 120; // at most, of the renderer's 256 (MAX_SPRITE) shared with the pads and every FX's glow
// m across a pile may be for a fighter with nothing to carry to go for it:
// PILE_NEAR, and PILE_MORE for each skull in it past the first, at most PILE_FAR
const PILE_NEAR = 30;
const PILE_MORE = 5;
const PILE_FAR = 50;
const ON_THE_WAY = 10; // m across a pile may be for a carrier to take it on its way to the zone
const HUNT = 45; // m an attacker goes after an enemy carrying skulls

// The zone as AO holds it, or null before one is up (a countdown: AO is 0).
export function zoneOf(view) {
  if (!view) return null;
  const d = view.dv, f = (o) => d.getFloat32(L.AO + o, true);
  const r = f(AC.HH_R);
  if (!(r > 0)) return null;
  return { at: d.getUint32(L.AO + AC.HH_AT, true), moves: d.getUint32(L.AO + AC.HH_MOVES, true), pos: [f(AC.HH_X), f(AC.HH_Y), f(AC.HH_Z)], r };
}

// The piles lying now: { k (its place), pos (where it lies), n (skulls), left (ticks to go) }.
export function pilesOf(view) {
  const d = view.dv, out = [];
  for (let k = 0; k < AC.HH_NPILE; k++) {
    const a = L.AO + AC.HH_PILES + k * AC.HH_PILE_SIZE;
    const n = d.getUint16(a + 12, true);
    if (n) out.push({ k, pos: [d.getFloat32(a, true), d.getFloat32(a + 4, true), d.getFloat32(a + 8, true)], n, left: d.getUint16(a + 14, true) });
  }
  return out;
}

// Feet at pos in zone z, as $a_near has it (for drawing and steering: the sim banks on its own).
export const inZone = (z, pos) => (pos[0] - z.pos[0]) ** 2 + (pos[2] - z.pos[2]) ** 2 < z.r * z.r && Math.abs(pos[1] - z.pos[1]) < ZONE_H;

const across = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const clock = (n) => `${Math.floor(n / 125 / 60)}:${String(Math.floor(n / 125) % 60).padStart(2, '0')}`;
const skulls = (n) => `${n} SKULL${n === 1 ? '' : 'S'}`;

// Live fighters in the fight carrying skulls, but slot `but`: [slot, feet, vel, n, side].
function carriers(view, but) {
  const out = [], d = view.dv;
  for (let q = 0; q < L.NPLAYER; q++) {
    const b = L.PLAYERS + q * L.PSIZE;
    const fl = view.u8[b + L.P_FL];
    if (q === but || (fl & (L.PF_LIVE | L.PF_DEAD)) !== L.PF_LIVE) continue;
    const n = d.getUint16(L.MODE_REC + q * L.MR_SIZE + L.MR_AUX, true);
    if (!n) continue;
    out.push([q, [d.getFloat32(b + L.P_PX, true), d.getFloat32(b + L.P_PY, true), d.getFloat32(b + L.P_PZ, true)],
      [d.getFloat32(b + L.P_VX, true), d.getFloat32(b + L.P_VY, true), d.getFloat32(b + L.P_VZ, true)], n, fl & L.PF_BLUE ? 1 : 0]);
  }
  return out;
}

// The feet of the nearest enemy of slot `me` (at feet `pos`) within `within`
// m across, carrying skulls (`carrying`) or any: read straight off the
// records, the other side by its bit (256 AI fighters ask it every 8 ticks).
function enemy(view, me, pos, within, carrying) {
  const u8 = view.u8, d = view.dv, side = u8[L.PLAYERS + me * L.PSIZE + L.P_FL] & L.PF_BLUE;
  let best = null, bd = within;
  for (let q = 0; q < L.NPLAYER; q++) {
    const b = L.PLAYERS + q * L.PSIZE, fl = u8[b + L.P_FL];
    if ((fl & (L.PF_LIVE | L.PF_DEAD)) !== L.PF_LIVE || (fl & L.PF_BLUE) === side) continue;
    if (carrying && !d.getUint16(L.MODE_REC + q * L.MR_SIZE + L.MR_AUX, true)) continue;
    const x = d.getFloat32(b + L.P_PX, true), z = d.getFloat32(b + L.P_PZ, true);
    const dd = Math.hypot(x - pos[0], z - pos[2]);
    if (dd < bd) { bd = dd; best = [x, d.getFloat32(b + L.P_PY, true), z]; }
  }
  return best;
}

// The rim's lights: where the zone's own surface is under each point round
// it (a cave's wall or a roof's edge drops some), worked out once a zone.
let rimKey = '', rim = [];
function rimOf(view, z) {
  const key = `${z.at}:${z.pos.join(',')}:${z.r}`;
  if (key === rimKey) return rim;
  rimKey = key;
  rim = [];
  const n = Math.max(8, Math.min(16, Math.round(z.r * 2)));
  for (let k = 0; k < n; k++) {
    const a = (k / n) * 2 * Math.PI;
    const x = z.pos[0] + Math.cos(a) * z.r * 0.97, zz = z.pos[2] + Math.sin(a) * z.r * 0.97;
    const y = view.stand(x, zz, z.pos[1] + ZONE_H);
    if (Math.abs(y - z.pos[1]) < ZONE_H) rim.push([x, y, zz, k]);
  }
  return rim;
}

// A heap of up to three skulls lying at p (feet): one on the ground, then one
// beside it, then one on top; and a stack of up to five over a head at p.
const HEAP = [[0, 0.24, 0], [0.34, 0.2, 0.1], [0.16, 0.5, 0.05]];
const heap = (p, n, bob) => HEAP.slice(0, Math.min(3, n)).map(([dx, dy, dz]) => [p[0] + dx, p[1] + dy + bob, p[2] + dz]);
const stack = (p, n) => Array.from({ length: Math.min(5, n) }, (_, i) => [p[0], p[1] + 2.2 + 0.36 * i, p[2]]);

export default {
  mode: L.M_HEADHUNT,
  key: 'headhunter',
  hud(view, ctx) {
    // (26 cells a line: the shield bar starts at the 28th)
    const z = zoneOf(view);
    // (the distance from where you are, dead or alive; in the zone only alive)
    const me = ctx.me?.live ? ctx.me : null;
    const n = ctx.me?.aux ?? 0;
    ctx.put(1, 2, n ? `CARRYING ${skulls(n)}` : 'NO SKULLS  KILL FOR THEM', n ? C.YELLOW : C.GREY);
    if (!z) return;
    const hd = view.hole(), md = view.mode();
    const here = me && !me.dead && inZone(z, me.pos);
    const where = here ? 'IN THE ZONE' : me ? `ZONE ${Math.round(across(me.pos, z.pos))}M` : 'ZONE';
    // when it moves; the last zone of a match never does (the clock ends it first), so the target in its place
    const when = hd.state === L.H_PLAY && z.moves < hd.until ? `MOVES IN ${clock(Math.max(0, z.moves - hd.tick))}` : md.target ? `FIRST TO ${md.target}` : '';
    ctx.put(1, 3, when ? `${where}  ${when}` : where, here ? C.YELLOW : C.GREY);
    if (n && me && !me.dead && !here && hd.state === L.H_PLAY) ctx.put(1, 4, 'BANK THEM IN THE ZONE', (ctx.now >> 8) & 1 ? C.YELLOW : C.WHITE);
  },
  news(f, ctx) {
    const at = [f.pos[0], f.pos[1] + 0.5, f.pos[2]];
    switch (f.size) {
      case AC.HH_MX_BANK: {
        const side = ctx.team(f.owner);
        const color = SIDE_C[side] ?? C.WHITE;
        ctx.feed(`${ctx.name(f.owner)} BANKED ${skulls(f.shot)}`, color);
        ctx.glow({ pos: at, size: 2.4, color: [...(SIDE_RGB[side] ?? ZONE_RGB), 0.9], kind: 6, life: 700, grow: true });
        if (f.owner === ctx.slot) { ctx.banner(`BANKED ${skulls(f.shot)}`, color, 2200); ctx.sound?.pickup?.(); }
        break;
      }
      case AC.HH_MX_TAKE:
        // a pile taken: a glint where it lay; your own, a word and a sound
        ctx.glow({ pos: at, size: 1.2, color: [...SKULL_RGB, 0.8], kind: 6, life: 350, grow: true });
        if (f.owner === ctx.slot) { ctx.banner(`+${skulls(f.shot)}`, C.YELLOW, 1200); ctx.sound?.pickup?.(); }
        break;
      case AC.HH_MX_MOVE:
        ctx.feed('THE ZONE MOVED', C.YELLOW);
        ctx.banner('THE ZONE MOVED', C.YELLOW, 2000);
        ctx.glow({ pos: [f.pos[0], f.pos[1] + 0.3, f.pos[2]], size: zoneOf(ctx.view)?.r ?? 4, color: [...ZONE_RGB, 0.8], kind: 6, life: 900, grow: true });
        break;
      default:
    }
  },
  draw(view, ctx, out) {
    const z = zoneOf(view);
    const eye = ctx.shown >= 0 ? view.fighter(ctx.shown) : null;
    const me = eye?.live && !eye.dead ? eye : null;
    const from = me ? me.pos : ctx.cam;
    const dt = ctx.dt || 0;
    let room = SPRITES;
    if (z) {
      const [x, y, zz] = z.pos;
      // brighter while the fighter shown has skulls to bank
      const pulse = me?.aux ? 0.75 + 0.25 * Math.sin(ctx.now / 150) : 0.5;
      out.zone = { x, z: zz, r: z.r, y, h: ZONE_H, color: ZONE_RGB, pulse };
      for (const [px, py, pz, k] of rimOf(view, z)) {
        const a = 0.45 + 0.45 * Math.max(0, Math.sin(ctx.now / 180 - k * 0.8));
        out.glow.push({ pos: [px, py + 0.35, pz], size: 0.4, color: [...ZONE_RGB, a], kind: 3, minpx: 1 });
      }
      // (the pillar fades out as you come close, where it would only fog the view)
      const d = Math.hypot(ctx.cam[0] - x, ctx.cam[2] - zz);
      const far = Math.min(1, Math.max(0, (d - 12) / 30));
      if (far > 0) out.beams.push({ a: [x, y + 2, zz], b: [x, y + 30, zz], width: 0.3, color: [...ZONE_RGB, 0.3 * far] });
      // the waypoint, rising with the distance (3 m up to 30 m away, 8 m from 80) so its distance line stays clear of the disc
      if (!me || !inZone(z, me.pos)) out.markers.push({ pos: [x, y + Math.min(8, Math.max(3, d / 10)), zz], label: 'ZONE', color: C.YELLOW, kind: 'hill' });
    }
    // the piles, nearest first: a heap each and a glow under it, the nearest few with a +N waypoint
    const bob = 0.06 * Math.sin(ctx.now / 300);
    const piles = pilesOf(view).map((p) => ({ ...p, d: Math.hypot(p.pos[0] - from[0], p.pos[1] - from[1], p.pos[2] - from[2]) })).sort((a, b) => a.d - b.d || a.k - b.k);
    let marks = 0;
    for (const p of piles) {
      const at = heap(p.pos, p.n, bob);
      if (at.length > room) break;
      room -= at.length;
      for (const pos of at) out.solid.push({ pos, size: 0.24, aspect: 1, color: [...SKULL_RGB, 1], kind: 8, minpx: 2 });
      // fading as it runs out: its last 5 s it blinks
      const fade = p.left < 625 ? 0.25 + 0.25 * Math.sin(ctx.now / 90) : 0.45;
      out.glow.push({ pos: [p.pos[0], p.pos[1] + 0.3, p.pos[2]], size: 0.8, color: [1, 0.95, 0.7, fade], kind: 3, minpx: 1 });
      if (marks < PILE_MARKS && p.d < PILE_SEEN) { marks++; out.markers.push({ pos: [p.pos[0], p.pos[1] + 1.3, p.pos[2]], label: `+${p.n}`, color: C.WHITE, kind: 'skull' }); }
    }
    // the carriers but the fighter shown, nearest first: a stack over each head, where the renderer draws it (the confirmed world run on by dt)
    const cs = carriers(view, ctx.shown).map(([q, pos, vel, n, side]) => ({ q, pos: [0, 1, 2].map((k) => pos[k] + vel[k] * dt), n, side }))
      .map((c) => ({ ...c, d: Math.hypot(c.pos[0] - from[0], c.pos[1] - from[1], c.pos[2] - from[2]) })).sort((a, b) => a.d - b.d || a.q - b.q);
    marks = 0;
    for (const c of cs) {
      const at = stack(c.pos, c.n);
      if (at.length > room) break;
      room -= at.length;
      for (const pos of at) out.solid.push({ pos, size: 0.17, aspect: 1, color: [...SKULL_RGB, 1], kind: 8, minpx: 2 });
      if (marks < CARRY_MARKS && c.d < CARRY_SEEN) { marks++; out.markers.push({ pos: [c.pos[0], at[at.length - 1][1] + 0.9, c.pos[2]], label: String(c.n), color: SIDE_C[c.side], kind: 'skull' }); }
    }
  },
  cols: [{ head: 'SKULLS', get: (o) => String(o.points) }, { head: 'CARRIED', get: (o) => String(o.aux) }],
  // carrying: to the zone, hurrying more the more it carries (one at a run
  // that still shoots back, three or more past everyone); else a pile near
  // it (bigger ones from farther), fighting whoever it meets; else defenders
  // guard the zone and attackers go after the nearest enemy carrier
  goal(view, me, ctx) {
    if (view.hole().state !== L.H_PLAY) return null;
    const z = zoneOf(view);
    if (!z) return null;
    const n = me.aux;
    let best = null, bs = Infinity;
    for (const p of pilesOf(view)) {
      const d = across(p.pos, me.pos);
      if (Math.abs(p.pos[1] - me.pos[1]) > 4 || d > (n ? Math.min(ON_THE_WAY, across(z.pos, me.pos)) : Math.min(PILE_FAR, PILE_NEAR + PILE_MORE * (p.n - 1)))) continue;
      const s = d - PILE_MORE * (p.n - 1);
      if (s < bs) { bs = s; best = p; }
    }
    const hurry = Math.min(0.95, 0.45 + 0.15 * n);
    if (n) return best ? { pos: best.pos, r: 1, hurry, hold: false } : { pos: z.pos, r: z.r * (2 / 3), hurry, hold: false };
    if (best) return { pos: best.pos, r: 1, hurry: 0.55, hold: false };
    if (ctx.role === 'defend') return { pos: z.pos, r: z.r * (2 / 3), hurry: 0.3, hold: true };
    const prey = enemy(view, me.slot, me.pos, HUNT, true);
    if (prey) return { pos: prey, r: 2, hurry: 0.3, hold: false };
    // nobody carrying near: the nearest enemy, as Team Slayer's hunt (kills are skulls)
    const foe = enemy(view, me.slot, me.pos, Infinity, false);
    return foe && { pos: foe, r: 2, hurry: 0, hold: false };
  },
  state(view) {
    const z = zoneOf(view), piles = pilesOf(view), carry = [0, 0];
    for (const [, , , n, side] of carriers(view, -1)) carry[side] += n;
    return { score: view.mode().score, target: view.mode().target, zone: z?.at ?? -1, moves: z?.moves ?? 0, piles: piles.length, lying: piles.reduce((n, p) => n + p.n, 0), carry };
  },
};
