// An arena fighter's brain: reads the world it has (a View of its own copy,
// a round trip old like anyone's) and answers with one input word a tick.
// It finds the nearest enemy it can see, turns onto them with a human's
// lag and wobble, strafes, picks the gun that suits the range, throws a
// frag now and then, butts anyone too close, and when nobody is in sight
// walks to a weapon pad and picks up what's on it. Under a mode with sides
// (layout.mjs, TEAM_MODES) it leaves its own side alone; a zombie or the
// juggernaut runs straight at the nearest enemy, seen or not, jumping, and
// swings the sword; Infection's humans keep their distance and shoot.
// Deterministic from its seed and what it sees, so a match of bots is an
// ordinary event log. Walls it can't see through; one in its way it goes
// round, sidling and jumping until it moves again.
import * as L from '../src/layout.mjs';
import { arenaWord, arenaFrame, frameDue, boxClear } from '../src/arena-view.mjs';
import { aimAt } from './bot.mjs';

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
    this.target = -1; this.err = [0, 0];
    this.goal = null; this.goalUntil = 0;
    this.frame = 0;
    this.sent = {}; // the last frame's lag and tick
    this.lastFire = -1e9;
    this.wantUse = false; this.wantReload = false;
    this.lag = 0;
    this.stuck = 0; this.detour = 0; this.detourUntil = 0; this.was = null;
    this.prey = -1; this.buddy = -1;
  }

  rand() { let x = this.rng; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.rng = x >>> 0; return this.rng / 4294967296; }

  // The word for sim tick t. lag: how many ticks old the bot's view is.
  think(view, t, lag = 0) {
    const me = view.fighter(this.slot);
    const h = view.hole();
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
    const mode = view.dv.getUint32(L.AH_MODE, true);
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
      // Infection's humans keep together: the nearest other one
      this.buddy = -1;
      if (mode === L.M_INFECTION && !hunter) {
        let bd = 1e9;
        for (let q = 0; q < L.NPLAYER; q++) {
          if (q === this.slot || !human(q)) continue;
          const c = chest(q), d = Math.hypot(c[0] - me.pos[0], c[2] - me.pos[2]);
          if (d < bd) { bd = d; this.buddy = q; }
        }
      }
      best = -1;
      for (const [, q] of near.slice(0, 6)) if (sees(view, eye, chest(q))) { best = q; break; }
    } else if (((t + this.slot) & 3) === 0 && !sees(view, eye, chest(best))) best = -1;
    if (best !== this.target) {
      this.target = best;
      // a new target: the aim starts off by up to 20 degrees and settles
      this.err = [(this.rand() - 0.5) * 900, (this.rand() - 0.5) * 120];
    }
    let move = 0, jump = 0;
    // a gun worth having underfoot: pick it up, in place of the worse one
    const pads = view.pads().filter((p) => !p.wait && !me.gun.includes(p.weapon) && (POWER.has(p.weapon) || me.gun.includes(L.W_AR)));
    const here = pads.find((p) => Math.hypot(p.pos[0] - me.pos[0], p.pos[2] - me.pos[2]) < 1.4);
    if (here) {
      this.slotOut = POWER.has(me.gun[0]) && !POWER.has(me.gun[1]) ? 1 : POWER.has(me.gun[1]) && !POWER.has(me.gun[0]) ? 0 : me.gun[0] === L.W_AR ? 0 : 1;
      this.wantUse = true;
    }
    const near = pads.find((p) => Math.hypot(p.pos[0] - me.pos[0], p.pos[2] - me.pos[2]) < 18);
    if (best >= 0) {
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
      if (near && !here) {
        const a = Math.atan2(near.pos[2] - me.pos[2], near.pos[0] - me.pos[0]) - this.yaw / TURN * 2 * Math.PI;
        const fw = Math.cos(a), rt = Math.sin(a);
        move = (fw > 0.3 ? 1 : fw < -0.3 ? 2 : 0) | (rt > 0.3 ? 8 : rt < -0.3 ? 4 : 0);
      }
      if (this.rand() < 0.01) jump = 1;
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
      else this.turnTo(this.yaw + 400, 512, 0.25);
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
      if (me.mag[this.slotOut] < (L.ARMS[me.weapon]?.mag || 0) / 2 && me.res[this.slotOut] > 0 && !me.reload) this.wantReload = true;
      if (this.rand() < 0.003) jump = 1;
    }
    // walking into something: sidle one way, jumping, for a while
    const ran = this.was && Math.hypot(me.pos[0] - this.was[0], me.pos[2] - this.was[2]);
    this.was = me.pos;
    this.stuck = (move & 3) && ran < 0.02 ? this.stuck + 1 : 0;
    if (this.stuck > 20 && t >= this.detourUntil) { this.detour = this.rand() < 0.5 ? 4 : 8; this.detourUntil = t + 80 + Math.floor(this.rand() * 80); this.stuck = 0; }
    if (t < this.detourUntil) { move = this.detour | (this.rand() < 0.6 ? 2 : 0); if (this.rand() < 0.04) jump = 1; }
    return this.word({ move, jump, serial });
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
