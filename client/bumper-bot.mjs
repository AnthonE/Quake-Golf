// A bumper ball's brain: reads the world it has (a View of its own copy, a
// round trip old like anyone's) and answers with one input word a tick. It
// keeps its centre away from the holes and the rim first of all, steering
// for the velocity it wants rather than the way it wants to go, so it brakes
// before an edge instead of rolling over it. Then it hunts: an empty-handed
// ball goes for an orb nearby, and otherwise for the rival best placed to be
// knocked in, coming at them from the side away from their nearest drop.
// A power-up it holds it uses when it pays: MEGA or POW with rivals close,
// DASH and ROCKET at one lined up, SPRING to stomp a crowd or to jump clear
// of a hole it is tipping into. It thinks every few ticks (its slot spreads
// them out), so a host of 255 costs little. Deterministic from its seed and
// what it sees, so a round of bots is an ordinary event log.
import * as L from '../src/layout.mjs';
import { bumperWord, edgeDistance, floorAt } from '../src/bumper-view.mjs';

const TURN = 16384;
const DIRS = 16;
const THINK_EVERY = 4;

// One wheel per world tick, shared by every bot looking at that view.
function wheelOf(view) {
  const t = view.tick;
  if (view._bw?.tick !== t) view._bw = { tick: t, wheel: view.wheel(), balls: null };
  return view._bw;
}

// Every ball on the cheese, read once per world tick.
function ballsOf(view) {
  const c = wheelOf(view);
  if (!c.balls) {
    c.balls = [];
    for (let p = 0; p < L.NPLAYER; p++) {
      const b = view.bumper(p);
      if (b.live && !b.out && !b.falling) c.balls.push(b);
    }
  }
  return c.balls;
}

// The wheel with only the holes within r of (x, z).
function local(w, x, z, r) {
  return { ...w, holes: w.holes.filter((h) => Math.abs(h.x - x) < r + h.r && Math.abs(h.z - z) < r + h.r) };
}

export class Roller {
  // skill 0..1: how far ahead it looks, how steady it steers, how keen it is to fight
  constructor(slot, seed = 1, skill = 0.6) {
    this.slot = slot;
    this.rng = (seed * 2654435761 + slot * 40503) >>> 0 || 1;
    this.skill = skill;
    this.use = 0;
    this.yaw = 0;
    this.move = 0;
    this.hop = 0;
    this.target = -1;
    this.wobble = 0;
    this.word = 0;
    this.at = -1;
  }

  rand() {
    let x = this.rng;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.rng = x >>> 0;
    return this.rng / 2 ** 32;
  }

  // t: the tick the word is for; lag: ticks between the world it sees and t
  think(view, t = view.tick, lag = 0) {
    if ((t + this.slot) % THINK_EVERY && this.at >= 0) return this.word;
    this.at = t;
    const me = view.bumper(this.slot);
    if (!me.live || me.out || view.hole().state !== L.H_PLAY) {
      this.word = bumperWord({ yaw: this.yaw, move: 0, use: this.use & 3 });
      return this.word;
    }
    const dt = Math.min(lag, 40) * 0.008;
    const pos = [me.pos[0] + me.vel[0] * dt, me.pos[2] + me.vel[2] * dt];
    // only the holes it could reach matter; 64 of them a probe would be most of its time
    const w = local(wheelOf(view).wheel, pos[0], pos[1], 30);
    const vel = [me.vel[0], me.vel[2]];
    const speed = Math.hypot(...vel);
    const balls = ballsOf(view).filter((b) => b.slot !== this.slot);
    const reach = 0.35 + 0.5 * this.skill; // seconds it looks ahead

    // the goal: an orb, a rival, or the middle
    let goal = null, want = 6;
    const near = [];
    for (const b of balls) {
      const d = Math.hypot(b.pos[0] - pos[0], b.pos[2] - pos[1]);
      if (d < 14) near.push({ b, d });
    }
    if (!me.item) {
      let best = 26;
      for (const o of view.orbs()) {
        const d = Math.hypot(o.pos[0] - pos[0], o.pos[2] - pos[1]);
        if (d < best && edgeDistance(w, o.pos[0], o.pos[2]) > 1) { best = d; goal = [o.pos[0], o.pos[2]]; want = 9; }
      }
    }
    if (!goal && balls.length && this.rand() < 0.3 + 0.7 * this.skill) {
      // the rival nearest a drop, for its distance
      let best = Infinity, who = null;
      for (const { b, d } of near.length ? near : balls.map((b) => ({ b, d: Math.hypot(b.pos[0] - pos[0], b.pos[2] - pos[1]) }))) {
        const s = d + 3 * Math.max(0, edgeDistance(w, b.pos[0], b.pos[2])) + (b.slot === this.target ? -3 : 0);
        if (s < best) { best = s; who = b; }
      }
      if (who) {
        this.target = who.slot;
        // come at them from the side away from their nearest drop
        const away = this.safest(w, who.pos[0], who.pos[2], 3);
        goal = [who.pos[0] - away[0] * 1.2, who.pos[2] - away[1] * 1.2];
        want = 10;
      }
    }
    if (!goal) { goal = [L.B_CX, L.B_CX]; want = 4; }

    // every way it could steer, scored for where it would be in `reach` seconds
    let best = -Infinity, pick = [0, 0];
    const gx = goal[0] - pos[0], gz = goal[1] - pos[1], gd = Math.hypot(gx, gz) || 1;
    for (let k = 0; k < DIRS; k++) {
      const a = (k / DIRS) * 2 * Math.PI;
      const dx = Math.cos(a), dz = Math.sin(a);
      const vx = dx * want, vz = dz * want;
      // halfway between now and that velocity, over the look ahead
      const fx = pos[0] + (vel[0] + vx) * 0.5 * reach, fz = pos[1] + (vel[1] + vz) * 0.5 * reach;
      const safe = Math.min(edgeDistance(w, fx, fz), edgeDistance(w, pos[0] + dx * 2.5, pos[1] + dz * 2.5));
      let s = (dx * gx + dz * gz) / gd * 2 + Math.min(safe, 4) * 1.5;
      if (safe < 1.2) s -= 30 + (1.2 - safe) * 10;
      if (s > best) { best = s; pick = [vx, vz]; }
    }
    // push the way that turns our velocity into that one
    const ax = pick[0] - vel[0], az = pick[1] - vel[1];
    this.wobble += (this.rand() - 0.5) * 0.4 * (1 - this.skill);
    this.wobble *= 0.8;
    this.yaw = Math.round((Math.atan2(az, ax) + this.wobble) / (2 * Math.PI) * TURN) & (TURN - 1);
    this.move = Math.hypot(ax, az) > 0.5 ? 1 : 0;
    this.hop = 0;

    // the power-up
    if (me.item && me.refire === 0) {
      const ahead = (b, cone) => {
        const dx = b.pos[0] - pos[0], dz = b.pos[2] - pos[1], d = Math.hypot(dx, dz) || 1;
        return (dx * Math.cos(this.yaw / TURN * 2 * Math.PI) + dz * Math.sin(this.yaw / TURN * 2 * Math.PI)) / d > cone;
      };
      const close = near.filter(({ d }) => d < 6).length;
      const tipping = floorAt(w, pos[0] + vel[0] * 0.25, pos[1] + vel[1] * 0.25) >= 0 && edgeDistance(w, pos[0], pos[1]) < 0.6;
      let go = false;
      switch (me.item) {
        case L.PU_MEGA: go = close >= 1; break;
        case L.PU_POW: go = near.filter(({ d }) => d < 8).length >= 1 + (this.rand() < 0.5 ? 1 : 0); break;
        case L.PU_DASH: go = near.some(({ b, d }) => d < 10 && ahead(b, 0.95)) && edgeDistance(w, pos[0] + Math.cos(this.yaw / TURN * 2 * Math.PI) * 8, pos[1] + Math.sin(this.yaw / TURN * 2 * Math.PI) * 8) > 0; break;
        case L.PU_ROCKET: go = balls.some((b) => Math.hypot(b.pos[0] - pos[0], b.pos[2] - pos[1]) < 25 && ahead(b, 0.97)); break;
        case L.PU_SPRING: go = tipping || close >= 2; break;
        default:
      }
      if (go && this.rand() < 0.5 + 0.5 * this.skill) this.use++;
    }
    // now and then a hop, for the look of it
    if (speed > 4 && this.rand() < 0.01) this.hop = 1;
    this.word = bumperWord({ yaw: this.yaw, move: this.move, hop: this.hop, use: this.use & 3 });
    return this.word;
  }

  // The unit vector from (x, z) toward the most cheese, by r m probes.
  safest(w, x, z, r) {
    let best = -Infinity, out = [L.B_CX - x, L.B_CX - z];
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * 2 * Math.PI;
      const e = edgeDistance(w, x + Math.cos(a) * r, z + Math.sin(a) * r);
      if (e > best) { best = e; out = [Math.cos(a), Math.sin(a)]; }
    }
    return out;
  }
}
