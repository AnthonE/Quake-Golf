// ASSAULT (M_ASSAULT), as drawn and as the AI fighter plays it (the rules are
// src/am/assault.wat's, the state AO's as src/am/assault.mjs lays it out).
// The bomb is a dark sphere with a red light blinking on top: hovering in the
// middle or where it lies, over its carrier's head (your own is your HUD's:
// the frontend's carry rects), or sitting on a plate with a pillar of light
// over it and its light blinking faster as its fuse burns. Each plate is a
// ring of lights on its base's floor in its side's colour, and the one the
// bomb is on or headed for a disc painted under it. Waypoints say what to
// do: TAKE it, ESCORT your carrier or KILL theirs (and the plate it's going
// to, PLANT or DEFEND), DEFUSE it on your plate or GUARD it on theirs, with
// its seconds. The HUD says where it is (HOME, P5 HAS IT, DROPPED 0:12,
// PLANTED 0:04) and how a plant or a defuse is coming on; the feed every
// take, plant, blast, defuse and drop; the board's BOMBS and DEFUSES are
// MR_POINTS and MR_AUX.
// The brain: its carrier goes round by a flank and on to their plate
// zigzagging, and holds on it till it's planted; attackers take the bomb
// (the nearest few) or wait for it out front, shield their carrier and clear
// the plate ahead of it, hunt theirs, and guard a bomb planted on their
// plate; defenders (every third of a side, five at most) hold their own
// plate, go for an enemy carrier once it's near it, and defuse.
import * as L from '../../src/layout.mjs';
import * as AC from '../../src/am/consts.mjs';
import { C } from '../font.mjs';
import { SIDE, SIDE_C, SIDE_RGB } from './sides.mjs';

const BOMB_RGB = [0.24, 0.24, 0.27];
const LIGHT_RGB = [1, 0.18, 0.1];
const PLATE_R = Number(AC.AS_PLATE_R);
// The brain's distances (m), tuned on AI fighters over 20,000 ticks, seeds
// 7 to 16 for eight and 7 to 12 for sixteen. A carrier running straight at
// the plate with its escorts beside it, hunted by everyone on the other side
// shooting on the run, never reached it in five runs: one enemy on its back
// kills it in two seconds. Its hunters stopping to fight whoever they meet
// first: 4 plants in 10 runs of eight, 1 in 6 of sixteen. Going by a flank
// and zigzagging too, its escorts standing in the way of the shots and
// clearing the plate as it comes: 19 plants among eight, both sides
// scoring in 5 runs of 10; 8 among sixteen, both sides in 1 of 6.
// In rooms of 64 and 256 (30,000 ticks, two seeds each), every attacker
// running for a free bomb and the rest of the field firing at whoever had
// it, it changed hands in the middle about once a second and nobody ever
// planted: carriers lived 1.5 s on average, shot mostly from 50 to 100 m
// off. Now only the three of a side nearest it run for it, the rest of each
// side's attackers wait for it out front at a run that doesn't shoot (as
// CTF's attackers cross the field), and only the five nearest an enemy
// carrier hunt it: over 30,000 ticks 3 plants in each run of 64 and 5 and 4
// in the two of 256, both sides scoring in all four; whole matches of 64
// (seeds 6, 11) and 128 (11) end at 3 bombs before the clock. Eight plant 15
// times in 10 runs (seeds 7 to 16), both sides in 4; sixteen 13 in 6 (7 to
// 12), both sides in 1. A defender 30 m off gets onto a planted bomb and
// defuses it with 12 ticks to spare (AS_FUSE less AS_DEFUSE leaves 3 s to
// get there), so most bombs go off.
const CLOSE = 30; // from its plate: a defender leaves it for an enemy carrier this near it
const DASH = 40; // from a bomb planted on its plate: an attacker goes to defuse it too (farther, it can't get there in AS_FUSE)
const FLANK = 45; // a carrier's flank off the line between the bases
const ZIG = 8, ZIG_T = 40, ZIG_IN = 25; // its zigzag: m to each side, ticks a leg, m from the plate where it stops
const SHIELD = 4, SHIELD_SEE = 50; // an escort's place toward the enemy nearest its carrier, for enemies this near it
const CLEAR = 25; // the carrier this near their plate: its escorts go onto the plate first
// The few of a side nearest a free bomb run for it and the rest of its
// attackers wait out front, STAGE m from the middle toward their plate, at a
// run that doesn't stop to shoot, so a carrier breaking out runs into its
// own side; the HUNTERS of a side nearest an enemy carrier hunt it, the rest
// wait out front; a side keeps at most DEFENDERS at home. (In eight, every
// attacker is one of the nearest; the brain asks only every 8 ticks.)
const TAKERS = 3, HUNTERS = 5, DEFENDERS = 5, STAGE = 30;

// The bomb as AO holds it: state (AC.AS_*), where it is (feet), the middle,
// both plates (red's, blue's), its carrier (-1 unless carried), by (carrier,
// dropper or planter), gone (its planter has left), the side that has it, the
// plate it's planted on (-1), ticks left (dropped: to go back; planted: to go
// off), its plant's and defuse's counts. In the countdown AO is clear: the
// middle and the plates are the map's, where $stand puts them.
export function bombOf(view) {
  const d = view.dv, f = (o) => d.getFloat32(L.AO + o, true), map = view.map();
  const at = (o, [x, z, top]) => (f(o) === 0 && f(o + 8) === 0 ? [x, view.stand(x, z, top), z] : [f(o), f(o + 4), f(o + 8)]);
  const spot = at(AC.AS_SPOT, map.ball);
  const plates = [0, 1].map((k) => at(AC.AS_PLATE + 12 * k, map.flags[k]));
  const state = view.u8[L.AO + AC.AS_STATE], by = view.u8[L.AO + AC.AS_BY], side = view.u8[L.AO + AC.AS_SIDE];
  return {
    state, spot, plates, gone: view.u8[L.AO + AC.AS_GONE] === 1, pos: state === AC.AS_HOME ? spot : [f(AC.AS_POS), f(AC.AS_POS + 4), f(AC.AS_POS + 8)],
    carrier: state === AC.AS_CARRIED ? by : -1, by, side, at: state === AC.AS_PLANTED ? 1 - side : -1,
    left: d.getUint16(L.AO + AC.AS_LEFT, true), arming: d.getUint16(L.AO + AC.AS_ARMING, true), defusing: d.getUint16(L.AO + AC.AS_DEFUSING, true),
  };
}

// Slot p's feet, moved on by its velocity dt s (drawing only).
function feet(view, p, dt = 0) {
  const b = L.PLAYERS + p * L.PSIZE, f = (o) => view.dv.getFloat32(b + o, true);
  return [f(L.P_PX) + f(L.P_VX) * dt, f(L.P_PY) + f(L.P_VY) * dt, f(L.P_PZ) + f(L.P_VZ) * dt];
}
const across = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const clock = (ticks) => { const s = Math.ceil(ticks / 125); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const secs = (ticks) => Math.ceil(ticks / 125);
// Where an escort goes: a point near p, offset by rank round it (escorts spread out).
const beside = (p, rank, r) => { const a = rank * 2.4; return [p[0] + Math.cos(a) * r, p[1], p[2] + Math.sin(a) * r]; };

// Whether b is within BEHIND of a's direction as seen from the eye.
const BEHIND = Math.cos((8 * Math.PI) / 180);
function behind(eye, a, b) {
  const u = a.map((v, i) => v - eye[i]), w = b.map((v, i) => v - eye[i]);
  return u[0] * w[0] + u[1] * w[1] + u[2] * w[2] > BEHIND * Math.hypot(...u) * Math.hypot(...w);
}

// The bomb's state in words, for the HUD's line: HOME, P5 HAS IT (YOU HAVE IT), DROPPED 0:12, PLANTED 0:04.
function says(b, slot) {
  if (b.state === AC.AS_CARRIED) return b.carrier === slot ? 'YOU HAVE IT' : `P${b.carrier + 1} HAS IT`;
  if (b.state === AC.AS_DROPPED) return `DROPPED ${clock(b.left)}`;
  if (b.state === AC.AS_PLANTED) return `PLANTED ${clock(b.left)}`;
  return 'HOME';
}

// The plates' rims: lights round each, on its floor, worked out once a world.
let rimKey = '', rims = [];
function rimsOf(b) {
  const key = b.plates.flat().join(',');
  if (key === rimKey) return rims;
  rimKey = key;
  rims = b.plates.map((p) => Array.from({ length: 12 }, (_, k) => {
    const a = (k / 12) * 2 * Math.PI;
    return [p[0] + Math.cos(a) * PLATE_R, p[1] + 0.15, p[2] + Math.sin(a) * PLATE_R, k];
  }));
  return rims;
}

// Live fighters other than slot `me` (feet), as [slot, pos, ally].
function others(view, me, ally) {
  const out = [];
  for (let q = 0; q < L.NPLAYER; q++) {
    const o = L.PLAYERS + q * L.PSIZE;
    if (q === me || (view.u8[o + L.P_FL] & (L.PF_LIVE | L.PF_DEAD)) !== L.PF_LIVE) continue;
    out.push([q, feet(view, q), ally(me, q)]);
  }
  return out;
}

// Whether fewer than n of me's side alive are nearer `pos` across than me
// (the nearest n go).
function among(view, me, pos, n, ally) {
  const d = across(me.pos, pos);
  let k = 0;
  for (let q = 0; q < L.NPLAYER; q++) {
    if (q === me.slot || (view.u8[L.PLAYERS + q * L.PSIZE + L.P_FL] & (L.PF_LIVE | L.PF_DEAD)) !== L.PF_LIVE || !ally(me.slot, q)) continue;
    if (across(feet(view, q), pos) < d && ++k >= n) return false;
  }
  return true;
}

// The carrier's way to their plate: first to a flank, FLANK m off the line
// between the bases, halfway from the middle (the side by its slot), round
// the fight in the middle; then on to the plate zigzagging, a point 12 m on
// and ZIG m to one side then the other every ZIG_T ticks, till ZIG_IN m off;
// then onto the plate, and on it till it's planted.
function run(view, me, b, theirs, t) {
  const d = across(me.pos, theirs);
  const fx = (b.spot[0] + theirs[0]) / 2, fz = theirs[2] + (me.slot & 1 ? FLANK : -FLANK);
  const flank = [fx, view.stand(fx, fz), fz];
  if (d > across(flank, theirs) + 5 && across(me.pos, flank) > 6) return { pos: flank, r: 4, hurry: 1, hold: false };
  if (d > ZIG_IN) {
    const ux = (theirs[0] - me.pos[0]) / d, uz = (theirs[2] - me.pos[2]) / d;
    const side = (Math.floor((t + me.slot * 13) / ZIG_T) & 1 ? 1 : -1) * ZIG;
    const x = me.pos[0] + ux * 12 - uz * side, z = me.pos[2] + uz * 12 + ux * side;
    return { pos: [x, view.stand(x, z), z], r: 1.2, hurry: 1, hold: false };
  }
  return { pos: theirs, r: 1.2, hurry: 1, hold: true };
}

export default {
  mode: L.M_ASSAULT,
  key: 'assault',
  carry: 'bomb',

  // (26 cells a line: the shield bar starts at the 28th)
  hud(view, ctx) {
    const b = bombOf(view), team = ctx.team;
    if (ctx.me?.carry && !ctx.me.dead && b.carrier === ctx.slot) {
      ctx.put(1, 2, 'YOU HAVE THE BOMB', ctx.C.YELLOW);
      if (b.arming) ctx.put(1, 3, `PLANTING  ${secs(AC.AS_ARM - b.arming)}`, ctx.C.YELLOW);
      else ctx.put(1, 3, 'RUN TO THEIR BASE', (ctx.now >> 8) & 1 ? ctx.C.YELLOW : ctx.C.WHITE);
      return;
    }
    const color = b.state === AC.AS_CARRIED || b.state === AC.AS_PLANTED ? SIDE_C[b.side] : ctx.C.WHITE;
    ctx.put(1, 2, `BOMB  ${says(b, ctx.slot)}`, color);
    if (b.state === AC.AS_CARRIED && b.arming) ctx.put(1, 3, `P${b.carrier + 1} IS PLANTING  ${secs(AC.AS_ARM - b.arming)}`, SIDE_C[b.side]);
    else if (b.state === AC.AS_PLANTED) {
      if (b.defusing) ctx.put(1, 3, `DEFUSING  ${secs(AC.AS_DEFUSE - b.defusing)}`, SIDE_C[b.at]);
      else if (team < 0) ctx.put(1, 3, `AT ${SIDE[b.at]} BASE`, SIDE_C[b.at]);
      else ctx.put(1, 3, b.at === team ? 'AT YOUR BASE  DEFUSE IT' : 'AT THEIR BASE  GUARD IT', b.at === team ? ctx.C.YELLOW : SIDE_C[team]);
    }
  },

  // The feed in the doer's side's colour; a banner for your own side's news
  // and for a bomb planted on your plate.
  news(f, ctx) {
    const side = f.shot === 0 || f.shot === 1 ? f.shot : -1;
    if (side < 0) return;
    const mine = ctx.slot >= 0 && ctx.me ? ctx.team(ctx.slot) : -1;
    const who = ctx.name(f.owner), you = f.owner === ctx.slot && ctx.slot >= 0, ours = mine === side;
    const col = SIDE_C[side];
    const at = [f.pos[0], f.pos[1] + 0.5, f.pos[2]];
    switch (f.size) {
      case AC.AS_MX_TAKE:
        ctx.feed(`${who} TOOK THE BOMB`, col);
        if (you) { ctx.banner('YOU HAVE THE BOMB  RUN TO THEIR BASE', ctx.C.YELLOW, 2500); ctx.sound?.pickup?.(); }
        else if (ours) ctx.banner('YOUR SIDE HAS THE BOMB', col, 2000);
        ctx.glow({ pos: at, size: 1.6, color: [...LIGHT_RGB, 0.9], kind: 6, life: 500, grow: true });
        break;
      case AC.AS_MX_PLANT:
        ctx.feed(`${who} PLANTED THE BOMB`, col);
        if (you) ctx.banner('YOU PLANTED IT  GUARD IT', ctx.C.YELLOW, 2500);
        else if (ours) ctx.banner('BOMB PLANTED  GUARD IT', col, 2500);
        else if (mine >= 0) ctx.banner('BOMB PLANTED  DEFUSE IT', ctx.C.YELLOW, 2500);
        ctx.sound?.count?.(1);
        ctx.glow({ pos: at, size: 2.5, color: [...SIDE_RGB[side], 0.9], kind: 6, life: 600, grow: true });
        break;
      case AC.AS_MX_BOOM:
      case AC.AS_MX_LONE:
        // (its planter gone, the news is nobody's: 255 can be a slot)
        ctx.feed(f.size === AC.AS_MX_LONE ? `THE BOMB WENT OFF IN ${SIDE[1 - side]} BASE` : `${who} BLEW UP ${SIDE[1 - side]} BASE`, col);
        if (you && f.size === AC.AS_MX_BOOM) ctx.banner('YOU SCORED', ctx.C.YELLOW, 3000);
        else if (ours) ctx.banner('YOUR SIDE SCORES', col, 3000);
        else if (mine >= 0) ctx.banner(`${SIDE[side]} SCORES`, col, 3000);
        ctx.sound?.blast?.(ctx.dist ?? 0, Number(AC.AS_BLAST_R));
        ctx.glow({ pos: [f.pos[0], f.pos[1] + 1, f.pos[2]], size: Number(AC.AS_BLAST_R), color: [1, 0.6, 0.2, 1], kind: 3, life: 900, grow: true });
        ctx.glow({ pos: [f.pos[0], f.pos[1] + 0.3, f.pos[2]], size: Number(AC.AS_BLAST_R) * 1.4, color: [1, 0.85, 0.5, 0.9], kind: 6, life: 700, grow: true });
        break;
      case AC.AS_MX_DEFUSE:
        ctx.feed(`${who} DEFUSED THE BOMB`, col);
        if (you) ctx.banner('YOU DEFUSED IT', ctx.C.YELLOW, 2500);
        else if (ours) ctx.banner('YOUR SIDE DEFUSED IT', col, 2500);
        ctx.sound?.pickup?.();
        ctx.glow({ pos: at, size: 2, color: [...SIDE_RGB[side], 0.9], kind: 6, life: 600, grow: true });
        break;
      case AC.AS_MX_DROP:
        ctx.feed(`${who} DROPPED THE BOMB`, col);
        ctx.glow({ pos: at, size: 1.2, color: [...LIGHT_RGB, 0.8], kind: 6, life: 400, grow: true });
        break;
      case AC.AS_MX_HOME:
        ctx.feed('THE BOMB IS BACK', ctx.C.WHITE);
        ctx.glow({ pos: at, size: 2, color: [...LIGHT_RGB, 0.8], kind: 6, life: 700, grow: true });
        break;
      default:
    }
  },

  draw(view, ctx, out) {
    const b = bombOf(view);
    // the side of the fighter shown (a spectator's watched one), as the HUD's lines
    const eye = ctx.shown >= 0 ? view.fighter(ctx.shown) : null;
    const team = eye?.live && view.teamed() ? eye.team : -1;
    // each plate: a ring of lights on its floor in its side's colour, chasing
    // faster with the bomb on it; the one it's on or headed for painted too
    const hot = b.state === AC.AS_PLANTED ? b.at : b.state === AC.AS_CARRIED ? 1 - b.side : -1;
    rimsOf(b).forEach((rim, k) => {
      for (const [x, y, z, i] of rim) {
        const a = 0.35 + 0.45 * Math.max(0, Math.sin(ctx.now / (k === b.at ? 70 : 220) - i * 0.9));
        out.glow.push({ pos: [x, y, z], size: 0.3, color: [...SIDE_RGB[k], a], kind: 3, minpx: 1 });
      }
    });
    if (hot >= 0) {
      const p = b.plates[hot];
      out.zone = { x: p[0], z: p[2], r: PLATE_R, y: p[1], h: 2, color: SIDE_RGB[hot], pulse: b.state === AC.AS_PLANTED ? 1 : 0.4 };
    }
    // the bomb: over its carrier's head (not the one shown: it's in its hands), else where it lies or sits
    let pos;
    if (b.carrier >= 0) {
      if (b.carrier !== ctx.shown) pos = feet(view, b.carrier, ctx.dt).map((v, i) => v + (i === 1 ? 2.25 : 0));
    } else if (b.state === AC.AS_PLANTED) pos = [b.pos[0], b.pos[1] + 0.32, b.pos[2]];
    else pos = [b.pos[0], b.pos[1] + 0.5 + 0.08 * Math.sin(ctx.now / 300), b.pos[2]];
    // its light: a blink a second in the middle, faster dropped, and planted from twice a second to ten as it burns
    const period = b.state === AC.AS_PLANTED ? 100 + 400 * Math.min(1, b.left / AC.AS_FUSE) : b.state === AC.AS_DROPPED ? 400 : 1000;
    const on = (ctx.now % period) < period * 0.45;
    if (pos) {
      out.solid.push({ pos, size: 0.32, aspect: 1, color: [...BOMB_RGB, 1], kind: 0, minpx: 2 });
      out.glow.push({ pos: [pos[0], pos[1] + 0.34, pos[2]], size: on ? 0.32 : 0.14, color: [...LIGHT_RGB, on ? 1 : 0.4], kind: 5, minpx: 1 });
    }
    if (b.state === AC.AS_PLANTED) {
      // a pillar of light over it in the planters' colour, flashing with its light
      const d = Math.hypot(ctx.cam[0] - b.pos[0], ctx.cam[2] - b.pos[2]);
      const far = Math.min(1, Math.max(0, (d - 8) / 25));
      if (far > 0) out.beams.push({ a: [b.pos[0], b.pos[1] + 1.5, b.pos[2]], b: [b.pos[0], b.pos[1] + 30, b.pos[2]], width: 0.35, color: [...SIDE_RGB[b.side], (on ? 0.45 : 0.2) * far] });
    }
    // waypoints, well over what they mark so their distance doesn't hide it
    const up = (p, h) => [p[0], p[1] + h, p[2]];
    const plate = (k, label, color) => out.markers.push({ pos: up(b.plates[k], 2.9), label, color });
    if (team < 0) {
      if (pos) out.markers.push({ pos: up(pos, 1.6), label: b.carrier >= 0 ? SIDE[b.side] : b.state === AC.AS_PLANTED ? `BOMB ${secs(b.left)}` : 'BOMB', color: b.carrier >= 0 ? SIDE_C[b.side] : C.YELLOW });
      return;
    }
    if (b.state === AC.AS_PLANTED) {
      if (b.at === team) out.markers.push({ pos: up(pos, 1.6), label: `DEFUSE ${secs(b.left)}`, color: C.YELLOW });
      else out.markers.push({ pos: up(pos, 1.6), label: `GUARD ${secs(b.left)}`, color: SIDE_C[team] });
    } else if (b.carrier < 0) out.markers.push({ pos: up(pos, 1.6), label: 'TAKE', color: C.YELLOW });
    else if (b.side === team) {
      // your side has it: ESCORT it (unless it's the one shown), and the plate
      // it's headed for, unless that's right behind ESCORT as seen from here
      // (following it there, the two labels would print over each other)
      if (pos) out.markers.push({ pos: up(pos, 1.6), label: 'ESCORT', color: SIDE_C[team] });
      if (!pos || !behind(ctx.cam, up(pos, 1.6), up(b.plates[1 - team], 2.9))) plate(1 - team, 'PLANT', b.carrier === ctx.shown ? C.YELLOW : SIDE_C[1 - team]);
    } else {
      if (pos) out.markers.push({ pos: up(pos, 1.6), label: 'KILL', color: SIDE_C[1 - team] });
      plate(team, 'DEFEND', SIDE_C[team]);
    }
  },

  cols: [{ head: 'BOMBS', get: (o) => String(o.points) }, { head: 'DEFUSES', get: (o) => String(o.aux) }],

  // The carrier: out by a flank, then on to their plate zigzagging, and on
  // it; attackers: the three nearest a free bomb run for it, the rest wait
  // out front; for their own carrier, between it and the enemies nearest it,
  // and once it's near their plate, onto the plate to clear it; an enemy
  // carrier, hunted by the five nearest, fighting what they meet on the way,
  // the rest out front. Defenders (at most DEFENDERS): hold their plate, go
  // for an enemy carrier near it, defuse. A bomb planted on your plate:
  // everyone near enough runs onto it; on theirs, the attackers near it
  // guard it. The rest wait in the middle.
  goal(view, me, ctx) {
    const team = me.team;
    if (team !== 0 && team !== 1) return null;
    const b = bombOf(view), mine = b.plates[team], theirs = b.plates[1 - team];
    if (me.carry && b.carrier === me.slot) return run(view, me, b, theirs, ctx.t);
    const defend = ctx.role === 'defend' && ctx.rank < 3 * DEFENDERS;
    if (b.state === AC.AS_PLANTED) {
      if (b.at === team) return defend || across(me.pos, b.pos) < DASH ? { pos: b.pos, r: 0.8, hurry: 1, hold: true } : { pos: b.spot, r: 6, hurry: 0.3, hold: true };
      if (defend) return { pos: mine, r: 4, hurry: 0, hold: true };
      return across(me.pos, b.pos) < DASH ? { pos: beside(b.pos, ctx.rank, 3), r: 3, hurry: 0.2, hold: true } : { pos: b.spot, r: 6, hurry: 0.3, hold: true };
    }
    const enemy = b.carrier >= 0 && b.side !== team;
    if (defend) {
      if (enemy) { const c = feet(view, b.carrier); if (across(c, mine) < CLOSE) return { pos: c, r: 2, hurry: 0.5, hold: false }; }
      return { pos: mine, r: 4, hurry: 0, hold: true };
    }
    // out front: STAGE m from the middle toward their plate, spread out, not shooting
    const front = () => {
      const k = STAGE / (across(b.spot, theirs) || 1), fx = b.spot[0] + (theirs[0] - b.spot[0]) * k, fz = b.spot[2] + (theirs[2] - b.spot[2]) * k;
      return { pos: beside([fx, view.stand(fx, fz), fz], ctx.rank, 4 + (ctx.rank % 5) * 2), r: 4, hurry: 1, hold: true };
    };
    if (b.carrier < 0) return among(view, me, b.pos, TAKERS, ctx.ally) ? { pos: b.pos, r: 1, hurry: 1, hold: false } : front();
    const c = feet(view, b.carrier);
    // (under 0.5 it fights whoever it sees first: its escorts, as often as not)
    if (enemy) return among(view, me, c, HUNTERS, ctx.ally) ? { pos: c, r: 2, hurry: 0.3, hold: false } : front();
    const clear = { pos: beside(theirs, ctx.rank, 3 + (ctx.rank % 4) * 1.5), r: 4, hurry: across(me.pos, theirs) > 30 ? 0.6 : 0.1, hold: true };
    if (across(c, theirs) < CLEAR) return clear;
    // a shield: SHIELD m from it toward the enemy nearest it (every other
    // escort the next nearest), not stopping to shoot, where a bullet meant
    // for it stops on a teammate; none near, beside it
    const foes = others(view, me.slot, ctx.ally).filter((o) => !o[2] && across(o[1], c) < SHIELD_SEE).map((o) => o[1]).sort((a, z) => across(a, c) - across(z, c));
    if (foes.length) {
      const f = foes[ctx.rank % Math.min(foes.length, 6)], d = across(f, c) || 1, k = Math.min(SHIELD + (Math.floor(ctx.rank / 6) % 3) * 2, d / 2) / d;
      return { pos: [c[0] + (f[0] - c[0]) * k, c[1], c[2] + (f[2] - c[2]) * k], r: 1, hurry: 0.9, hold: false };
    }
    return { pos: beside(c, ctx.rank, 3), r: 3, hurry: 0.9, hold: false };
  },

  state(view) {
    const b = bombOf(view);
    return { score: view.mode().score, target: view.mode().target,
      bomb: { state: b.state, carrier: b.carrier, by: b.by, gone: b.gone, side: b.side, at: b.at, left: b.left, arming: b.arming, defusing: b.defusing } };
  },
};
