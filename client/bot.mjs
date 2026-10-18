// A golf bot. It plans each shot by trying it on a private copy of the sim
// (the same game.wasm, so the try comes out exactly as the real shot would
// if nothing else moved), walks to the spot behind its ball, aims a rocket at
// the ground there and fires. The nearer the blast to the ball, the harder
// and higher the shot. It reads only confirmed state, so it plays the same in
// Node and in the browser, one round trip behind.
import * as L from '../src/layout.mjs';

const STANDOFF = 1.0; // stand this far behind the blast point
const EYE = 1.6;
const DH = [0.3, 0.5, 0.7, 1.0, 1.3, 1.6, 1.9, 2.2, 2.6, 3.0, 3.4, 3.8, 4.1, 4.4, 4.6, 4.8];
const TURNS = [-4, -2, 2, 4].map((deg) => deg * Math.PI / 180);
const LIE = [0, 5, 10, 0]; // metres of penalty for ending on fairway, rough, sand, green

// Yaw (14 bits) and pitch (10 bits) from one point towards another.
export function aimAt(from, to) {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  return {
    yaw: Math.round(Math.atan2(dz, dx) / (2 * Math.PI) * 16384) & 0x3fff,
    pitch: Math.max(0, Math.min(1023, Math.round(512 + Math.atan2(dy, Math.hypot(dx, dz)) / Math.PI * 1024))),
  };
}

export function word({ yaw = 0, pitch = 512, move = 0, jump = 0, shot = 0, weapon = 0 }) {
  return ((yaw & 0x3fff) | ((pitch & 0x3ff) << 14) | ((move & 0xf) << 24) | ((jump & 1) << 28) | ((shot & 3) << 29) | ((weapon & 1) << 31)) >>> 0;
}

// Where a shot is taken from: blast `dh` behind the ball on a line `turn`
// radians off the line to the cup, standing STANDOFF behind that.
function shotGeometry(view, ball, cup, dh, turn) {
  const a = Math.atan2(cup[2] - ball[2], cup[0] - ball[0]) + turn;
  const dir = [Math.cos(a), Math.sin(a)];
  const bp = [ball[0] - dir[0] * dh, 0, ball[2] - dir[1] * dh];
  bp[1] = view.height(bp[0], bp[2]);
  const sx = bp[0] - dir[0] * STANDOFF, sz = bp[2] - dir[1] * STANDOFF;
  const stand = [sx, view.height(sx, sz), sz];
  return { dh, turn, bp, stand, aim: aimAt([stand[0], stand[1] + EYE, stand[2]], bp) };
}

// A private sim to try shots on.
export class Planner {
  static async create(module) {
    const memory = new WebAssembly.Memory({ initial: L.PAGES, maximum: L.PAGES, shared: true });
    const { exports } = await WebAssembly.instantiate(module, { env: { mem: memory } });
    return new Planner(exports, memory);
  }

  constructor(x, memory) {
    this.x = x;
    this.u8 = new Uint8Array(memory.buffer);
    this.dv = new DataView(memory.buffer);
    this.seed = null;
    this.snap = new Uint8Array(L.REGION_SIZE);
  }

  // Copies the confirmed region out of `src` (the shared memory's bytes).
  load(src) {
    const seed = new DataView(src.buffer, src.byteOffset).getUint32(L.HDR_SEED, true);
    if (seed !== this.seed) { this.x.init(seed); this.seed = seed; }
    this.snap.set(src.subarray(L.REGION, L.REGION + L.REGION_SIZE));
  }

  // Runs one shot by `slot` to its end: { sunk, end, ticks }.
  try(slot, shot, cup, maxTicks = 1600) {
    const { u8, dv, x } = this;
    u8.set(this.snap, L.REGION);
    u8.fill(0, L.INBOX, L.INBOX + 4);
    const pb = L.PLAYERS + slot * L.PSIZE;
    const ball = dv.getInt32(pb + L.P_BALL, true);
    dv.setFloat32(pb + L.P_PX, shot.stand[0], true);
    dv.setFloat32(pb + L.P_PY, shot.stand[1], true);
    dv.setFloat32(pb + L.P_PZ, shot.stand[2], true);
    for (const o of [L.P_VX, L.P_VY, L.P_VZ]) dv.setFloat32(pb + o, 0, true);
    u8[pb + L.P_FL] |= L.PF_GROUND;
    dv.setUint16(pb + L.P_REFIRE, 0, true);
    const fired = u8[pb + L.P_FIRED];
    dv.setUint32(pb + L.P_IN, word({ ...shot.aim, shot: fired + 1 }), true);
    let t = 0;
    for (; t < maxTicks; t++) {
      x.step();
      const fl = u8[L.FLAGS + ball];
      if (fl & L.F_SUNK) return { sunk: true, ticks: t, end: cup };
      if (t > 60 && !(fl & L.F_AWAKE)) break;
    }
    const f = (a) => dv.getFloat32(a + 4 * ball, true);
    return { sunk: false, ticks: t, end: [f(L.PX), f(L.PY), f(L.PZ)] };
  }
}

export class GolfBot {
  // lag: ticks from deciding an input to seeing its effect in confirmed state
  constructor(slot, planner, { lag = 6 } = {}) {
    this.slot = slot;
    this.planner = planner;
    this.lag = lag;
    this.presses = 0; // shots asked for; the input's 2-bit counter is this mod 4
    this.input = { yaw: 0, pitch: 512, move: 0, jump: 0, weapon: 0 };
    this.plan = null; // { from, shot, score }
    this.firedAt = -1;
    this.aimTicks = 0;
    this.log = [];
  }

  // The input for the next tick, from the confirmed state in `view`.
  think(view) {
    const h = view.hole();
    const me = view.player(this.slot);
    const inp = this.input;
    inp.move = 0;
    inp.jump = 0;
    if (!me.live || me.done || h.state !== L.H_PLAY || me.ball < 0) {
      this.plan = null;
      return this.word();
    }
    const ball = view.ball(me.ball);
    const moving = (ball.flags & L.F_AWAKE) && Math.hypot(...ball.vel) > 0.02;
    const mine = view.projectiles().some((j) => j.owner === this.slot);
    // after a shot, wait for it to land and the refire to clear
    if (moving || mine || me.refire > 0 || h.tick - this.firedAt < 2 * this.lag + 10) return this.word();
    if (!this.plan || Math.hypot(ball.pos[0] - this.plan.from[0], ball.pos[2] - this.plan.from[2]) > 0.01) {
      this.plan = this.choose(view, ball.pos, h.cup);
      this.log.push({ tick: h.tick, from: ball.pos, dh: this.plan.shot.dh, turn: this.plan.shot.turn, expect: this.plan.score });
    }
    const { stand, aim } = this.plan.shot;
    // steer from where we will be when this input lands
    const ahead = this.lag * 0.008;
    const ex = stand[0] - (me.pos[0] + me.vel[0] * ahead), ez = stand[2] - (me.pos[2] + me.vel[2] * ahead);
    const away = Math.hypot(ex, ez);
    if (away > 0.5 || !me.ground) {
      // walk there, braking early: friction takes about 2 m to stop from a run
      this.aimTicks = 0;
      if (away > 0.3) inp.yaw = aimAt(me.pos, [me.pos[0] + ex, me.pos[1], me.pos[2] + ez]).yaw;
      inp.pitch = 512;
      const along = (me.vel[0] * ex + me.vel[2] * ez) / Math.max(away, 1e-3);
      if (me.ground && along < Math.min(10, away * 2)) inp.move = 1;
      return this.word();
    }
    if (Math.hypot(me.vel[0], me.vel[2]) > 0.5) return this.word();
    // on the spot and still: aim from where we really stand, hold it, fire
    const a = aimAt([me.pos[0], me.pos[1] + EYE, me.pos[2]], this.plan.shot.bp);
    inp.yaw = a.yaw;
    inp.pitch = a.pitch;
    inp.weapon = 0;
    if (++this.aimTicks < this.lag + 2) return this.word();
    this.presses++;
    this.aimTicks = 0;
    this.firedAt = h.tick;
    this.plan = null;
    return this.word();
  }

  // Tries every blast distance on the straight line, then the best few turned
  // a little, and keeps the one that ends nearest the cup on the best lie.
  choose(view, ball, cup) {
    const p = this.planner;
    p.load(view.u8);
    const rate = (shot) => {
      const r = p.try(this.slot, shot, cup);
      if (r.sunk) return -1000 + r.ticks / 100;
      return Math.hypot(r.end[0] - cup[0], r.end[2] - cup[2]) + LIE[view.surface(r.end[0], r.end[2])];
    };
    let best = null;
    const consider = (dh, turn) => {
      const shot = shotGeometry(view, ball, cup, dh, turn);
      const score = rate(shot);
      if (!best || score < best.score) best = { from: ball.slice(), shot, score };
    };
    for (const dh of DH) consider(dh, 0);
    const dh0 = best.shot.dh;
    for (const turn of TURNS) consider(dh0, turn);
    for (const d of [-0.12, -0.06, 0.06, 0.12]) consider(Math.max(0.25, dh0 + d), best.shot.turn);
    return best;
  }

  word() {
    return word({ ...this.input, shot: this.presses });
  }
}
