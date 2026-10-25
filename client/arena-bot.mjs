// An arena fighter's brain: reads the world it has (a View of its own copy,
// a round trip old like anyone's) and answers with one input word a tick.
// It finds the nearest enemy it can see, turns onto them with a human's
// lag and wobble, strafes, picks the gun that suits the range, throws a
// frag now and then, butts anyone too close, and when nobody is in sight
// walks to a weapon pad and picks up what's on it. Under a mode with sides
// (layout.mjs, TEAM_MODES) it leaves its own side alone; a zombie or the
// juggernaut runs straight at the nearest enemy, seen or not, jumping, and
// swings the sword; Infection's humans keep their distance and shoot.
// Under a team mode (TEAMED) it plays the objective its kit module names
// (client/am/<key>.mjs goal(): a flag, the skull, a hill, a hunt), as an
// attacker or, every third of its side by slot, a defender, routed round the
// map's buildings through their doors; carrying the flag or the skull it has
// no gun, so it runs its goal and swings at whoever gets close in front.
// Deterministic from its seed and what it sees, so a match of bots is an
// ordinary event log. Walls it can't see through; one in its way it goes
// round, sidling and jumping until it moves again.
import * as L from '../src/layout.mjs';
import { arenaWord, arenaFrame, frameDue, boxClear, boxRay, slab } from '../src/arena-view.mjs';
import { aimAt } from './bot.mjs';
import { AMC } from './am/index.mjs';

const EYE = 1.6;
const TURN = 16384;

// Can an eye at a see a point at b over the ground and past the map's boxes? Steps of a metre.
export function sees(view, a, b) {
  if (!boxClear(view.map(), a, b)) return false;
  const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const n = Math.ceil(d);
  for (let k = 1; k < n; k++) {
    const t = k / n;
    const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
    if (y < view.height(x, z) + 0.1) return false;
  }
  return true;
}

// ---- routes round the map's buildings. Each box group gets a ring: its
// bounds pushed out RING m, a rectangle a fighter can walk round outside it.
// Its doors are found once per world by probing in from the ring every
// RING_STEP m, square to its side, at knee and chest height: a door is a
// stretch a body fits through where the probes go on at least a metre and a
// half past a wall on both sides of it (a doorway, the gap in a roof's
// parapet a bridge comes through), each kept as the ring point in front of
// it (out) and a point just past the wall (in). A goal inside a group is
// reached by the cheapest door whose inside sees it, a fighter inside leaves
// by the cheapest door it can see, a building in the way is walked round on
// its ring, corner to corner. "Sees" is walkable(): no box across the way at
// knee, chest or head height, nor across a body's width. All of it is kept
// beside view.map() (map.nav).
const KNEE = 0.5, CHEST = 1.4, HEAD = Number(L.PHYS.P_TOP) - 0.1;
const RING = 1.5, RING_STEP = 0.5;
// The body's width walkable() wants clear, WIDE to either side of the centre
// line at waist and chest height: under its radius, so the 1 m openings
// findDoors takes still pass their doors' legs and a leg along a wall to a
// door's in (0.4 m off the wall's face) isn't refused (a body's edge only
// brushing a jamb slides by it); from the waist up, so a leg off the slab it
// stands on (dipping into its top as it goes down) isn't taken for one into
// a wall.
const WIDE = Number(L.PHYS.P_R) - 0.15, WAIST = 0.9;

// The rays walkable() casts from feet a to feet b: the centre line at knee,
// chest and head height, then the body's width.
function rays(a, b) {
  const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1, px = -dz / l * WIDE, pz = dx / l * WIDE;
  const out = [KNEE, CHEST, HEAD].map((h) => [[a[0], a[1] + h, a[2]], [b[0], b[1] + h, b[2]]]);
  for (const s of [-1, 1]) for (const h of [WAIST, CHEST]) out.push([[a[0] + s * px, a[1] + h, a[2] + s * pz], [b[0] + s * px, b[1] + h, b[2] + s * pz]]);
  return out;
}

// Nothing of the map's boxes across the walk from feet a to feet b at knee,
// chest or head height, nor across the body's width (a leg that grazes a
// door's jamb catches the body on it). Where the straight line digs more
// than a metre into the ground the feet go over it instead, so the two halves
// are tried from the ground there (off a hill and under a bridge, the knees
// meet the bridge).
export function walkable(view, a, b, depth = 0) {
  if (depth < 2) {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 2);
    let dig = 1, at = null;
    for (let k = 1; k < n; k++) {
      const t = k / n, x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t, g = view.height(x, z);
      if (g - (a[1] + (b[1] - a[1]) * t) > dig) { dig = g - (a[1] + (b[1] - a[1]) * t); at = [x, g, z]; }
    }
    if (at) return walkable(view, a, at, depth + 1) && walkable(view, at, b, depth + 1);
  }
  const map = view.map();
  for (const [o, e] of rays(a, b)) if (!boxClear(map, o, e)) return false;
  return true;
}

// A ring's point at arc length s, from its (x0, z0) corner round by +x first, and the way in from there: [x, z, nx, nz].
function ringXZ(r, s) {
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  s = ((s % r.len) + r.len) % r.len;
  if (s < w) return [r.x0 + s, r.z0, 0, 1];
  if (s < w + d) return [r.x1, r.z0 + s - w, -1, 0];
  if (s < 2 * w + d) return [r.x1 - (s - w - d), r.z1, 0, -1];
  return [r.x0, r.z1 - (s - 2 * w - d), 1, 0];
}

// The arc length of the ring's point nearest (x, z).
function ringS(r, x, z) {
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  const cx = Math.max(r.x0, Math.min(r.x1, x)), cz = Math.max(r.z0, Math.min(r.z1, z));
  const sides = [[Math.abs(cz - r.z0), cx - r.x0], [Math.abs(cx - r.x1), w + cz - r.z0], [Math.abs(cz - r.z1), w + d + r.x1 - cx], [Math.abs(cx - r.x0), 2 * w + d + r.z1 - cz]];
  let best = sides[0];
  for (const sd of sides) if (sd[0] < best[0]) best = sd;
  return best[1];
}

// A group's doors, probed for from each side of its ring r.
function findDoors(view, map, r) {
  const doors = [];
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  for (const [s0, len] of [[0, w], [w, d], [w + d, w], [2 * w + d, d]]) {
    const deep = (len === w ? d : w) + RING;
    const probe = [];
    for (let s = s0 + RING_STEP; s < s0 + len - RING_STEP / 2; s += RING_STEP) {
      const [x, z, nx, nz] = ringXZ(r, s);
      const y = view.height(x, z);
      const ray = (h) => boxRay(map, [x, y + h, z], [nx * deep, 0, nz * deep], 1) * deep;
      probe.push({ s, x, y, z, nx, nz, depth: Math.min(ray(KNEE), ray(CHEST)) });
    }
    // a door: a run of probes 1 m wide or more, each going on 1.5 m past the
    // two probes either side of the run (a wall a metre wide each side, or a
    // rail with the wall behind it: not a post with open ground past it)
    const n = probe.length, depth = (i) => probe[i].depth;
    for (let i = 2; i < n - 2; i++) {
      const lo = Math.max(depth(i - 1), depth(i - 2));
      if (depth(i) < lo + 1.5) continue;
      let j = i;
      while (j + 1 < n && depth(j + 1) >= lo + 1.5) j++;
      if (j + 2 >= n) break;
      const hi = Math.max(depth(j + 1), depth(j + 2));
      let min = Infinity;
      for (let k = i; k <= j; k++) min = Math.min(min, depth(k));
      if (min >= hi + 1.5 && (j - i + 1) * RING_STEP >= 1) {
        const c = probe[(i + j) >> 1], past = Math.max(lo, hi) + 1.2;
        const ix = c.x + c.nx * past, iz = c.z + c.nz * past;
        doors.push({ s: c.s, out: [c.x, c.y, c.z], in: [ix, view.stand(ix, iz, c.y + 1), iz] });
      }
      i = j;
    }
  }
  return doors;
}

// The map's rings and their doors, once per world.
export function navOf(view) {
  const map = view.map();
  if (map.nav) return map.nav;
  map.nav = {
    rings: map.groups.map((g) => {
      const [x0, y0, z0, x1, y1, z1] = g.box;
      const r = { box: g.box, x0: x0 - RING, z0: z0 - RING, x1: x1 + RING, z1: z1 + RING, y0, y1 };
      r.len = 2 * (r.x1 - r.x0 + r.z1 - r.z0);
      r.doors = findDoors(view, map, r);
      return r;
    }),
  };
  return map.nav;
}

// The group feet p are in, or -1: within its bounds (across, and no higher
// than its top) with one of its boxes over them or under them (under a
// building's roof or a cave's, or up on it; not the open ground a bridge
// stretches the bounds over).
function groupAt(map, nav, p) {
  for (let k = 0; k < nav.rings.length; k++) {
    const b = nav.rings[k].box;
    if (!(p[0] > b[0] && p[0] < b[3] && p[2] > b[2] && p[2] < b[5] && p[1] < b[4] + 0.5)) continue;
    const g = map.groups[k];
    for (let i = g.first; i < g.first + g.count; i++) {
      const [x0, y0, z0, x1, y1, z1] = map.boxes[i].box;
      if (p[0] > x0 && p[0] < x1 && p[2] > z0 && p[2] < z1 && (y0 > p[1] || Math.abs(p[1] - y1) < 0.5)) return k;
    }
  }
  return -1;
}

// The group of the first box across feet a to feet b on walkable()'s rays, or -1.
function blocker(map, a, b) {
  let best = 2, gi = -1;
  for (const [o, e] of rays(a, b)) {
    const dir = [e[0] - o[0], e[1] - o[1], e[2] - o[2]];
    for (let g = 0; g < map.groups.length; g++) {
      const gr = map.groups[g];
      if (slab(gr.box, o, dir, best) > best) continue;
      for (let k = gr.first; k < gr.first + gr.count; k++) { const t = slab(map.boxes[k].box, o, dir, Math.min(best, 1)); if (t <= 1 && t < best) { best = t; gi = g; } }
    }
  }
  return gi;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const ringDist = (r, a, b) => { const d = Math.abs(a - b) % r.len; return Math.min(d, r.len - d); };

// The next corner of ring r from feet p toward arc length s the shorter way, or the point at s itself.
function ringStep(view, r, p, s) {
  const sf = ringS(r, p[0], p[2]);
  let ds = (s - sf) % r.len;
  if (ds > r.len / 2) ds -= r.len;
  if (ds < -r.len / 2) ds += r.len;
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  let next = s, nd = Math.abs(ds);
  for (const c of [0, w, w + d, 2 * w + d]) {
    const dc = ((((ds > 0 ? c - sf : sf - c) % r.len) + r.len) % r.len);
    if (dc > 0.75 && dc < nd) { nd = dc; next = c; }
  }
  const [x, z] = ringXZ(r, next);
  return [x, view.height(x, z), z];
}

// Where feet `from` should walk next on the way to feet `goal`: the goal when
// nothing of the map stands between; out of the building it's in by the
// cheapest door it sees (round to another door when the goal is in the same
// building out of sight: up to its roof, say; off a roof with no door on it,
// the cave's, round its ring as from outside); into the goal's building by
// the cheapest door whose inside sees the goal, walking the ring to it if it
// can't be walked to straight; round a building in the way on its ring. A
// leg that would meet a wall gives way to a door out of the yard it's in, or
// to a corner round what's in the way.
export function route(view, from, goal) {
  const map = view.map();
  if (walkable(view, from, goal)) return goal;
  const nav = navOf(view);
  const gi = groupAt(map, nav, goal), fi = groupAt(map, nav, from);
  if (fi >= 0) {
    const r = nav.rings[fi];
    let best = null, bc = Infinity;
    for (const e of r.doors) {
      const out = walkable(view, from, e.out);
      if (!out && !walkable(view, from, e.in)) continue;
      let c = dist(from, e.in) + dist(e.out, goal);
      if (gi === fi) {
        c = Infinity;
        for (const d of r.doors) if (d !== e && walkable(view, d.in, goal)) c = Math.min(c, dist(from, e.in) + ringDist(r, e.s, d.s) + dist(d.in, goal));
      }
      if (c < bc) { bc = c; best = { e, out }; }
    }
    if (best) return best.out ? best.e.out : best.e.in;
    // no door in sight: up on its roof over a goal under it (the cave's, over
    // the hill in it), off the roof's end and in by a door as from outside;
    // anywhere else, straight at the goal
    if (gi !== fi || from[1] < goal[1] + 2) return goal;
  }
  let leg;
  if (gi >= 0 && nav.rings[gi].doors.length) {
    const r = nav.rings[gi];
    let best = null, bc = Infinity;
    for (const d of r.doors) {
      const c = dist(from, d.out) + dist(d.in, goal) + (walkable(view, d.in, goal) ? 0 : 1000);
      if (c < bc) { bc = c; best = d; }
    }
    if (walkable(view, from, best.out)) return walkable(view, from, best.in) ? best.in : best.out;
    leg = ringStep(view, r, from, best.s);
  } else {
    // out in the open, or for a goal on the rocks (no doors: straight at it,
    // hopping): round whatever else stands between, toward its ring's point nearest the goal
    const bi = blocker(map, from, goal);
    if (bi < 0 || bi === gi) return goal;
    const r = nav.rings[bi];
    leg = ringStep(view, r, from, ringS(r, goal[0], goal[2]));
  }
  if (walkable(view, from, leg)) return leg;
  // that leg runs into a wall. Feet within a building's bounds with nothing
  // over them (the yard behind each base, walled off from the field) leave by
  // the door point in sight that's most on the way; else round whatever is in
  // the leg's way, to its ring's next corner if that's in sight
  for (const r of nav.rings) {
    const b = r.box;
    if (!(from[0] > b[0] && from[0] < b[3] && from[2] > b[2] && from[2] < b[5] && from[1] < b[4] + 0.5)) continue;
    let best = null, bc = Infinity;
    for (const d of r.doors) {
      for (const p of [d.out, d.in]) { const c = dist(from, p) + dist(p, goal); if (c < bc && walkable(view, from, p)) { bc = c; best = p; } }
    }
    if (best) return best;
  }
  const ci = blocker(map, from, leg);
  if (ci >= 0) {
    const r = nav.rings[ci];
    const w = ringStep(view, r, from, ringS(r, leg[0], leg[2]));
    if (walkable(view, from, w)) return w;
  }
  return leg;
}

// Slot p's rank among its side's fighters in the room, in slot order, and the
// role that gives it (every third, from the third, defends): from the
// confirmed world alone, so every bot agrees with no messages.
export function roleOf(view, p) {
  let rank = 0;
  for (let q = 0; q < p; q++) if (view.u8[L.PLAYERS + q * L.PSIZE + L.P_FL] & L.PF_LIVE && view.ally(p, q)) rank++;
  return { rank, role: rank % 3 === 2 ? 'defend' : 'attack' };
}

// How much a weapon wants to be used at a range, for the slot choice.
function suits(w, d) {
  switch (w) {
    case L.W_SHOTGUN: case L.W_SWORD: return d < 12 ? 10 : d < 25 ? 3 : 0;
    case L.W_SNIPER: return d > 30 ? 9 : 3;
    case L.W_ROCKET: return d > 8 && d < 60 ? 8 : 1;
    case L.W_BR: return d > 15 ? 7 : 5;
    case L.W_MAGNUM: return d > 20 ? 5 : 3;
    case L.W_AR: return d < 40 ? 6 : 2;
    case L.W_PLASMA: case L.W_NEEDLER: return d < 35 ? 6 : 2;
    default: return 0;
  }
}
const POWER = new Set([L.W_SNIPER, L.W_ROCKET, L.W_SHOTGUN, L.W_SWORD, L.W_BR, L.W_NEEDLER]);

export class Fighter {
  // skill 0..1: how fast it settles its aim and how steady it holds it
  constructor(slot, seed = 1, skill = 0.6) {
    this.slot = slot;
    this.rng = (seed * 2654435761 + slot * 40503) >>> 0 || 1;
    this.skill = skill;
    this.shot = 0; this.melee = 0; this.gren = 0;
    this.slotOut = 0;
    this.yaw = 0; this.pitch = 512;
    this.strafe = 4; this.strafeUntil = 0;
    this.frame = 0;
    this.sent = {}; // the last frame's lag and tick
    this.lastFire = -1e9;
    this.wantUse = false; this.wantReload = false;
    this.lag = 0;
    this.match = -1; this.modeSeen = -1;
    this.forget();
  }

  // What it knew of a match: who it was after, where it was going, how it was stuck.
  forget() {
    this.target = -1; this.err = [0, 0];
    this.goal = null; this.goalUntil = 0;
    this.stuck = 0; this.detour = 0; this.detourUntil = 0; this.was = null; this.seenTick = -1;
    this.prey = -1; this.buddy = -1; this.look = 0; this.lookUntil = 0;
    this.obj = null; this.way = null; this.rank = -1;
  }

  rand() { let x = this.rng; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.rng = x >>> 0; return this.rng / 4294967296; }

  // The word for sim tick t. lag: how many ticks old the bot's view is.
  think(view, t, lag = 0) {
    const me = view.fighter(this.slot);
    const h = view.hole();
    const mode = view.dv.getUint32(L.AH_MODE, true);
    // a new mode, or a team mode's new match: what it knew of the last one goes
    // (a free-for-all's next match of the same mode keeps it, as it always has)
    if (h.hole !== this.match || mode !== this.modeSeen) {
      if (this.match >= 0 && (mode !== this.modeSeen || AMC[mode])) this.forget();
      this.match = h.hole; this.modeSeen = mode;
    }
    // the frame: latched every 8 ticks, a bit a tick, when there's news
    if ((t & 7) === 0) {
      const ask = this.wantReload || this.wantUse;
      this.frame = frameDue(this.sent, t, lag, ask) ? arenaFrame({ lag, reload: this.wantReload, use: this.wantUse }) : 0;
      this.wantReload = this.wantUse = false;
    }
    const serial = (this.frame >> (t & 7)) & 1;
    if (!me.live || me.dead || h.state === L.H_OVER) return this.word({ serial });
    const eye = [me.pos[0], me.pos[1] + EYE, me.pos[2]];

    // the nearest enemy in sight, looked for every 16 ticks (each bot on its own
    // tick of the 16, so a room of them spreads the work); between looks the
    // one chosen is kept while it lives and, checked every 4 ticks, is in sight
    const alive = (q) => q >= 0 && (view.u8[L.PLAYERS + q * L.PSIZE + L.P_FL] & (L.PF_LIVE | L.PF_DEAD)) === L.PF_LIVE && !view.ally(this.slot, q);
    const chest = (q) => { const b = L.PLAYERS + q * L.PSIZE; return [view.dv.getFloat32(b + L.P_PX, true), view.dv.getFloat32(b + L.P_PY, true) + 1.2, view.dv.getFloat32(b + L.P_PZ, true)]; };
    // a sword with legs (a zombie, the juggernaut) hunts; so does everyone after the juggernaut
    const hunter = me.zombie || me.jugg;
    const human = (q) => (view.u8[L.PLAYERS + q * L.PSIZE + L.P_FL] & (L.PF_LIVE | L.PF_DEAD | L.PF_ZOMBIE)) === L.PF_LIVE;
    const hunts = hunter || mode === L.M_JUGGERNAUT;
    let best = this.target;
    if (((t + this.slot) & 15) === 0 || !alive(best)) {
      const near = [];
      this.prey = -1;
      for (let q = 0; q < L.NPLAYER; q++) {
        if (q === this.slot || !alive(q)) continue;
        const c = chest(q);
        const d = Math.hypot(c[0] - me.pos[0], c[2] - me.pos[2]) - (q === this.target ? 15 : 0);
        if (d < 150) near.push([d, q]);
      }
      near.sort((a, b) => a[0] - b[0]);
      if (hunts && near.length) this.prey = near[0][1];
      // Infection's humans keep together: the nearest other one in sight, within 60 m
      this.buddy = -1;
      if (mode === L.M_INFECTION && !hunter) {
        const pals = [];
        for (let q = 0; q < L.NPLAYER; q++) {
          if (q === this.slot || !human(q)) continue;
          const c = chest(q), d = Math.hypot(c[0] - me.pos[0], c[2] - me.pos[2]);
          if (d < 60) pals.push([d, q]);
        }
        pals.sort((a, b) => a[0] - b[0]);
        for (const [, q] of pals.slice(0, 4)) if (sees(view, eye, chest(q))) { this.buddy = q; break; }
      }
      best = -1;
      for (const [, q] of near.slice(0, 6)) if (sees(view, eye, chest(q))) { best = q; break; }
    } else if (((t + this.slot) & 3) === 0 && !sees(view, eye, chest(best))) best = -1;
    if (best !== this.target) {
      this.target = best;
      // a new target: the aim starts off by up to 20 degrees and settles
      this.err = [(this.rand() - 0.5) * 900, (this.rand() - 0.5) * 120];
    }

    // a team mode's objective, asked of its kit module every 8 ticks (each bot on its own tick of the 8)
    const kit = AMC[mode];
    if (kit && (((t + this.slot) & 7) === 0 || this.rank < 0)) {
      if (((t + this.slot) & 15) === 0 || this.rank < 0) this.rank = roleOf(view, this.slot).rank;
      const obj = kit.goal(view, me, { role: this.rank % 3 === 2 ? 'defend' : 'attack', rank: this.rank, view, ally: (p, q) => view.ally(p, q), slot: this.slot, t });
      if (!obj || !this.obj || dist(obj.pos, this.obj.pos) > 1) this.way = null;
      this.obj = obj;
    }
    const obj = kit ? this.obj : null;
    const hurry = obj?.hurry ?? 0;
    // there: near enough across, and on the same floor (a roof over the flag isn't home)
    const there = obj && Math.hypot(obj.pos[0] - me.pos[0], obj.pos[2] - me.pos[2]) < (obj.r ?? 2) && Math.abs(obj.pos[1] - me.pos[1]) < 2;
    const going = obj && !(there && !obj.hold);

    let move = 0, jump = 0;
    // a gun worth having underfoot: pick it up, in place of the worse one (a carrier has no hands)
    const pads = me.carry ? [] : view.pads().filter((p) => !p.wait && !me.gun.includes(p.weapon) && (POWER.has(p.weapon) || me.gun.includes(L.W_AR)));
    const here = pads.find((p) => Math.hypot(p.pos[0] - me.pos[0], p.pos[2] - me.pos[2]) < 1.4);
    if (here) {
      this.slotOut = POWER.has(me.gun[0]) && !POWER.has(me.gun[1]) ? 1 : POWER.has(me.gun[1]) && !POWER.has(me.gun[0]) ? 0 : me.gun[0] === L.W_AR ? 0 : 1;
      this.wantUse = true;
    }
    const near = pads.find((p) => Math.hypot(p.pos[0] - me.pos[0], p.pos[2] - me.pos[2]) < 18);
    // toward the objective by the route, the move bits for that heading as faced now
    const toward = (p) => {
      const a = Math.atan2(p[2] - me.pos[2], p[0] - me.pos[0]) - this.yaw / TURN * 2 * Math.PI;
      const fw = Math.cos(a), rt = Math.sin(a);
      return (fw > 0.3 ? 1 : fw < -0.3 ? 2 : 0) | (rt > 0.3 ? 8 : rt < -0.3 ? 4 : 0);
    };
    if (best >= 0 && !me.carry && hurry < 0.9) {
      const f = view.player(best);
      const d = Math.hypot(f.pos[0] - me.pos[0], f.pos[2] - me.pos[2]);
      // lead a running target a little, by the round trip it is old
      const lead = (lag + 4) * 0.008;
      const aim = aimAt(eye, [f.pos[0] + f.vel[0] * lead, f.pos[1] + 1.15 + f.vel[1] * lead, f.pos[2] + f.vel[2] * lead]);
      const settle = 0.9 - 0.12 * this.skill;
      this.err = this.err.map((e) => e * settle + (this.rand() - 0.5) * (1 - this.skill) * 40);
      this.turnTo(aim.yaw + this.err[0], aim.pitch + this.err[1] / 8, 0.35 + 0.4 * this.skill);
      // the gun for the range
      const want = suits(me.gun[1], d) > suits(me.gun[0], d) + 1 ? 1 : suits(me.gun[0], d) > suits(me.gun[1], d) + 1 ? 0 : this.slotOut;
      if ((me.mag[want] > 0 || me.res[want] > 0) || (me.mag[this.slotOut] === 0 && me.res[this.slotOut] === 0)) this.slotOut = want;
      const off = Math.abs(((aim.yaw - this.yaw + TURN / 2) % TURN + TURN) % TURN - TURN / 2);
      const arm = L.ARMS[me.weapon] || L.ARMS[L.W_AR];
      const inRange = arm.type === 1 || d < arm.range * 0.9;
      if (inRange && off < 120 + 2000 / Math.max(d, 1)) {
        if (arm.auto) this.shot = (this.shot + 1) & 3;
        else if (t - this.lastFire > arm.refire + 2) { this.shot = (this.shot + 1) & 3; this.lastFire = t; }
      }
      if (d < 2.2 && me.cool === 0) this.melee ^= 1;
      else if (me.weapon === L.W_SWORD && d < 4.5 && t - this.lastFire > arm.refire) { this.shot = (this.shot + 1) & 3; this.lastFire = t; }
      if (d > 10 && d < 30 && me.grens > 0 && me.cool === 0 && this.rand() < 0.004) this.gren ^= 1;
      // strafe, close in or back off
      if (t >= this.strafeUntil) { this.strafe = this.rand() < 0.5 ? 4 : 8; this.strafeUntil = t + 60 + Math.floor(this.rand() * 120); }
      const close = me.weapon === L.W_SWORD || me.weapon === L.W_SHOTGUN;
      move = this.strafe | (d > (close ? 2 : 35) ? 1 : d < 8 && !close ? 2 : 0);
      // a hunter runs straight in, jumping; Infection's humans back away from a zombie inside 14 m
      if (hunter) { move = 1 | (d > 10 || d < 6 ? this.strafe : 0); if (this.rand() < (d < 9 ? 0.05 : 0.02)) jump = 1; }
      else if (mode === L.M_INFECTION && d < 14) move = this.strafe | 2;
      // a gun nearby: sidle to it, still shooting
      if (near && !here) move = toward(near.pos);
      // an objective that won't wait: sidle on to it (or side to side on it), still shooting
      if (going && hurry >= 0.5) move = there ? this.aside(view, me, obj, toward) : toward(this.waypoint(view, me, obj, t));
      if (this.rand() < 0.01) jump = 1;
    } else if (going) {
      // the objective: by the route, facing the way, a hop where it climbs
      if (there) {
        // holding: a look somewhere new every second or so, a step aside now and then
        if (t >= this.lookUntil) {
          this.look = (this.yaw + (this.rand() - 0.5) * TURN * 0.7 + TURN) % TURN; this.lookUntil = t + 100 + Math.floor(this.rand() * 100);
          this.strafe = this.rand() < 0.3 ? (this.rand() < 0.5 ? 4 : 8) : 0;
        }
        if (Math.abs(((this.look - this.yaw + TURN / 2) % TURN + TURN) % TURN - TURN / 2) > 40) this.turnTo(this.look, 512, 0.1);
        move = this.aside(view, me, obj, toward);
        // there by the count but below its middle (at a rock's foot, under its top): a hop up onto it
        if (obj.pos[1] - me.pos[1] > 0.5 && this.rand() < 0.15) jump = 1;
      } else {
        const w = this.waypoint(view, me, obj, t);
        this.turnTo(aimAt(eye, [w[0], eye[1], w[2]]).yaw, 512, 0.25);
        move = 1;
        // a hop where the way climbs, or where something low is in the way (a roof's parapet, a rock)
        if ((w[1] - me.pos[1] > 0.6 && Math.hypot(w[0] - me.pos[0], w[2] - me.pos[2]) < 4) || this.stuck > 8) { if (this.rand() < 0.15) jump = 1; }
        else if (this.rand() < 0.003) jump = 1;
      }
      if (!me.carry && me.mag[this.slotOut] < (L.ARMS[me.weapon]?.mag || 0) / 2 && me.res[this.slotOut] > 0 && !me.reload) this.wantReload = true;
    } else if (hunts && alive(this.prey)) {
      // nobody in sight, but someone to hunt: straight at them, jumping
      const c = chest(this.prey);
      const aim = aimAt(eye, [c[0], eye[1], c[2]]);
      this.turnTo(aim.yaw, 512, 0.2);
      move = 1;
      if (this.rand() < (hunter ? 0.02 : 0.004)) jump = 1;
    } else if (mode === L.M_INFECTION && !hunter && this.buddy >= 0 && human(this.buddy)) {
      // no zombie in sight: to the nearest other human, then stand by them looking round
      const c = chest(this.buddy);
      if (Math.hypot(c[0] - me.pos[0], c[2] - me.pos[2]) > 6) { this.turnTo(aimAt(eye, [c[0], eye[1], c[2]]).yaw, 512, 0.15); move = 1; }
      else {
        // a look somewhere new every second or so, held still between (a still word costs nothing on the wire)
        if (t >= this.lookUntil) { this.look = (this.yaw + (this.rand() - 0.5) * TURN * 0.6 + TURN) % TURN; this.lookUntil = t + 100 + Math.floor(this.rand() * 100); }
        if (Math.abs(((this.look - this.yaw + TURN / 2) % TURN + TURN) % TURN - TURN / 2) > 40) this.turnTo(this.look, 512, 0.1);
      }
      if (me.mag[this.slotOut] < (L.ARMS[me.weapon]?.mag || 0) / 2 && me.res[this.slotOut] > 0 && !me.reload) this.wantReload = true;
    } else {
      // nobody in sight: a pad with something better, else a spawn point, and on
      if (!this.goal || t >= this.goalUntil || Math.hypot(this.goal[0] - me.pos[0], this.goal[2] - me.pos[2]) < 1.2) {
        if (pads.length && this.rand() < 0.7) {
          pads.sort((a, b) => Math.hypot(a.pos[0] - me.pos[0], a.pos[2] - me.pos[2]) - Math.hypot(b.pos[0] - me.pos[0], b.pos[2] - me.pos[2]));
          const p = pads[Math.floor(this.rand() * Math.min(3, pads.length))];
          this.goal = p.pos;
        } else {
          const spawns = view.map().spawns;
          this.goal = spawns[Math.floor(this.rand() * spawns.length)];
        }
        this.goalUntil = t + 1500;
      }
      const aim = aimAt(eye, [this.goal[0], eye[1], this.goal[2]]);
      this.turnTo(aim.yaw, 512, 0.15);
      move = 1;
      if (!me.carry && me.mag[this.slotOut] < (L.ARMS[me.weapon]?.mag || 0) / 2 && me.res[this.slotOut] > 0 && !me.reload) this.wantReload = true;
      if (this.rand() < 0.003) jump = 1;
    }
    // carrying: no gun, but a swing that kills at an enemy close in front (within 2.4 m, about 40 degrees either side)
    if (me.carry && me.cool === 0) {
      for (let q = 0; q < L.NPLAYER; q++) {
        if (q === this.slot || !alive(q)) continue;
        const c = chest(q), d = Math.hypot(c[0] - me.pos[0], c[2] - me.pos[2]);
        if (d > 2.4 || Math.abs(c[1] - eye[1]) > 2) continue;
        const a = Math.atan2(c[2] - me.pos[2], c[0] - me.pos[0]) * TURN / (2 * Math.PI);
        if (Math.abs(((a - this.yaw + TURN / 2) % TURN + TURN) % TURN - TURN / 2) < TURN / 9) { this.melee ^= 1; break; }
      }
    }
    // walking into something: sidle one way, jumping, for a while (counted in the world's ticks, not calls: a page or the bot host may ask twice of one)
    if (view.tick !== this.seenTick) {
      this.seenTick = view.tick;
      const ran = this.was && Math.hypot(me.pos[0] - this.was[0], me.pos[2] - this.was[2]);
      this.was = me.pos;
      this.stuck = (move & 3) && ran < 0.02 ? this.stuck + 1 : 0;
    }
    if (this.stuck > 20 && t >= this.detourUntil) { this.detour = this.rand() < 0.5 ? 4 : 8; this.detourUntil = t + 80 + Math.floor(this.rand() * 80); this.stuck = 0; this.way = null; }
    if (t < this.detourUntil) { move = this.detour | (this.rand() < 0.6 ? 2 : 0); if (this.rand() < 0.04) jump = 1; }
    return this.word({ move, jump, serial });
  }

  // A holder's step aside (this.strafe, as it faces), kept on the objective:
  // only inside half its r across and onto ground at its height a metre on
  // (not up a wall of the cave's trench or off a rock); past half its r, back
  // toward its middle.
  aside(view, me, obj, toward) {
    if (Math.hypot(obj.pos[0] - me.pos[0], obj.pos[2] - me.pos[2]) > (obj.r ?? 2) / 2) return toward(obj.pos);
    if (!this.strafe) return 0;
    const a = this.yaw / TURN * 2 * Math.PI + (this.strafe === 8 ? Math.PI / 2 : -Math.PI / 2);
    const x = me.pos[0] + Math.cos(a), z = me.pos[2] + Math.sin(a);
    return Math.abs(view.stand(x, z, me.pos[1] + 0.6) - obj.pos[1]) < 0.5 ? this.strafe : 0;
  }

  // The next point on the way to the objective: routed every 8 ticks (each bot
  // on its own tick of the 8), and again on reaching the last one.
  waypoint(view, me, obj, t) {
    const w = this.way;
    if (!w || ((t + this.slot) & 7) === 0 || (w !== obj.pos && Math.hypot(w[0] - me.pos[0], w[2] - me.pos[2]) < 1.2)) this.way = route(view, me.pos, obj.pos);
    return this.way;
  }

  turnTo(yaw, pitch, rate) {
    const dy = ((yaw - this.yaw + TURN / 2) % TURN + TURN) % TURN - TURN / 2;
    this.yaw = (this.yaw + dy * rate + TURN) % TURN;
    this.pitch += (pitch - this.pitch) * rate;
  }

  word({ move = 0, jump = 0, serial = 0 }) {
    return arenaWord({ yaw: Math.round(this.yaw) & 0x3fff, pitch: Math.max(16, Math.min(1008, Math.round(this.pitch))), move, jump, shot: this.shot,
      melee: this.melee, gren: this.gren, slot: this.slotOut, serial });
  }
}
