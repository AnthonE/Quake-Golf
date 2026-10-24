// A party ball's brain, for any minigame: it reads the world it has (a View of
// its own copy, a round trip old like anyone's) and answers with one input
// word a tick, bumper's word. What the stage means it asks the minigame's own
// brain (client/mg/<key>.mjs): how deadly a spot is on a tick to come, where
// it wants to be, when to hop, or the whole word when the minigame knows
// better. The steering is the same for every stage: every 4th tick it rolls
// its own ball forward in closed form with the round's knobs (PG_ACC, PG_DRAG,
// PG_IDLE: bumper's v = wish * push + v * drag a tick) for each of 16 headings,
// the goal's own heading and coasting, samples the brain's danger along each
// path from 0.25 s out to 0.45-0.85 s (its skill), and takes the one with the
// least danger, then the most ground made on the goal, then the most room from
// the rivals near it. Deterministic from its seed and what it sees, so a round
// of bots is an ordinary event log; its slot spreads the thinking out, so 255
// of them cost a little over a quarter of that in thinks a tick.
//
// What it asks of a minigame's brain (client/mg/<key>.mjs, brain: {...}),
// handed a view whose party() and hole() are read once a world tick, `me`
// its partier() record, `bot` this Partier (slot, skill, rand(), mem: the
// brain's own, cleared each round; pos [x, z] and vel [vx, vz]: where it
// reckons it is on tick `at`, the tick its word is for; lag; goal; danger):
//   danger(view, x, z, tick, me) -> 0 fine .. 1 deadly, at (x, z) on that tick (ticks as HDR_TICK counts them);
//     asked 90 times a think (18 paths, 5 samples), so a few array reads
//   goal(view, me, bot) -> [x, z] or null (null: a weak pull to the stage's centre); asked every think, so keep it in bot.mem
//   hop(view, me, bot) -> true to hop now (on the ground, the round's PG_HOP over 0)
//   think(view, me, bot, tick) -> null, or { yaw, move, hop, use } for its word: yaw in radians (atan2(dz, dx); past
//     2 pi it is read as the word's 1/16384 turns), move the keys (1 forward, the default), hop and use truthy to do
//     them; without a yaw only hop and use count and the planner steers
import * as L from '../src/layout.mjs';
import { partyWord } from '../src/party-view.mjs';
import { MG } from './mg/index.mjs';

const TURN = 16384;
const DIRS = 16;
const THINK_EVERY = 4;
const DT = 0.008;
const N = (k) => Math.fround(Number(L.BPHYS[k]));
const ACC = N('B_ACC_DT'), AIR = N('B_AIR_DT'), AIR_DRAG = N('B_AIR_DRAG');
const ROOM = 2.6; // m between centres it likes to keep from a rival
const CELL = 8; // m, the rivals' grid
const NEAR_MAX = 12; // rivals it minds at once
// the planner's per-think arrays, shared: bots think one at a time
const SCRATCH = { coastX: new Float64Array(8), coastZ: new Float64Array(8), pushK: new Float64Array(8), idleX: new Float64Array(8), idleZ: new Float64Array(8),
  rx: new Float64Array(8 * NEAR_MAX), rz: new Float64Array(8 * NEAR_MAX) };

// What every bot looking at one world tick shares: the round, every ball in
// (not out, not falling) in a grid of CELL m squares, and the view the brains
// are handed: the same memory, with party() and hole() read once for the tick.
function worldOf(view) {
  const t = view.tick;
  if (view._pbot?.tick === t) return view._pbot;
  const g = view.party();
  const bv = Object.create(view);
  bv.party = () => g;
  bv.hole = () => g;
  const balls = [];
  const grid = new Map();
  for (let p = 0; p < L.NPLAYER; p++) {
    const a = L.PLAYERS + view.bank + p * L.PSIZE;
    if ((view.u8[a + L.P_FL] & (L.PF_LIVE | L.PF_DEAD | L.PF_FALL)) !== L.PF_LIVE) continue;
    const b = { slot: p, x: view.dv.getFloat32(a + L.P_PX, true), z: view.dv.getFloat32(a + L.P_PZ, true), vx: view.dv.getFloat32(a + L.P_VX, true), vz: view.dv.getFloat32(a + L.P_VZ, true) };
    balls.push(b);
    const k = Math.floor(b.x / CELL) * 4096 + Math.floor(b.z / CELL);
    const list = grid.get(k);
    if (list) list.push(b); else grid.set(k, [b]);
  }
  view._pbot = { tick: t, g, mg: MG[g.game] || MG[0], balls, grid, view: bv };
  return view._pbot;
}

// The balls within r of (x, z) but slot, nearest first (ties by slot), at
// most max of them: [{ b, d }], kept by insertion so a crowd costs no sort.
function near(w, x, z, r, slot, max = NEAR_MAX) {
  const out = [];
  const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL), z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
  let r2 = r * r;
  for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
    const list = w.grid.get(i * 4096 + j);
    if (!list) continue;
    for (const b of list) {
      if (b.slot === slot) continue;
      const dx = b.x - x, dz = b.z - z, d2 = dx * dx + dz * dz;
      if (d2 >= r2) continue;
      let k = out.length;
      while (k > 0 && (out[k - 1].d2 > d2 || (out[k - 1].d2 === d2 && out[k - 1].b.slot > b.slot))) k--;
      if (k >= max) continue;
      out.splice(k, 0, { b, d2, d: Math.sqrt(d2) });
      if (out.length > max) out.pop();
      if (out.length === max) r2 = out[max - 1].d2;
    }
  }
  return out;
}

// n ticks of v = wish * a + v * d from (x, v): where it is and how fast.
function roll(x, v, wish, a, d, n) {
  if (Math.abs(1 - d) < 1e-7) return [x + DT * (v * n + wish * a * n * (n + 1) / 2), v + wish * a * n];
  const dn = d ** n;
  const s = d * (1 - dn) / (1 - d); // the sum of d^k, k = 1..n
  const k = wish * a / (1 - d);
  return [x + DT * (v * s + k * (n - s)), v * dn + k * (1 - dn)];
}

export class Partier {
  // skill 0..1: how far ahead it looks, how steady it steers
  constructor(slot, seed = 1, skill = 0.6) {
    this.slot = slot;
    this.rng = (seed * 2654435761 + slot * 40503) >>> 0 || 1;
    this.skill = skill;
    this.use = 0;
    this.yaw = 0; // 1/16384 turn, as the word has it
    this.move = 0;
    this.hop = 0;
    this.wobble = 0;
    this.word = 0;
    this.at = -1;
    this.goal = null; // the brain's last goal, [x, z] or null
    this.round = -1;
    this.mem = {}; // the minigame's brain may keep what it likes here (cleared each round)
    this.danger = 0; // the danger it took, for whoever is curious
    this.pos = [0, 0]; // where it reckons it is on the tick it thinks for
    this.vel = [0, 0];
    this.lag = 0;
  }

  rand() {
    let x = this.rng;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.rng = x >>> 0;
    return this.rng / 2 ** 32;
  }

  // t: the tick the word is for; lag: ticks between the world it sees and t
  think(view, t = view.tick, lag = 0) {
    // (a page asks once a frame, two ticks or so apart: it thinks then too once its turn has gone by)
    if ((t + this.slot) % THINK_EVERY && this.at >= 0 && t - this.at < THINK_EVERY) return this.word;
    this.at = t;
    this.lag = lag;
    const w = worldOf(view);
    const g = w.g;
    view = w.view;
    const me = view.partier(this.slot);
    if (g.round !== this.round) { this.round = g.round; this.mem = {}; this.goal = null; }
    if (!me.live || me.out || g.state !== L.H_PLAY) {
      this.move = 0;
      this.hop = 0;
      this.word = partyWord({ yaw: this.yaw, move: 0, use: this.use & 3 });
      return this.word;
    }
    const brain = w.mg.brain || {};
    // the round's knobs: on the ground its own, in the air bumper's
    const ground = me.ground && !me.falling;
    const acc = me.falling ? 0 : (ground ? ACC : AIR) * g.acc * (me.mega ? 0.8 : 1);
    const dKeys = ground ? g.drag : AIR_DRAG, dIdle = ground ? g.idle : AIR_DRAG;
    // where it will be on tick t, still pushing as its last word did
    const n0 = Math.max(0, Math.min(40, lag));
    const a0 = this.move ? acc : 0, d0 = this.move ? dKeys : dIdle;
    const wx0 = this.move ? Math.cos(this.yaw / TURN * 2 * Math.PI) : 0, wz0 = this.move ? Math.sin(this.yaw / TURN * 2 * Math.PI) : 0;
    const [px, vx] = roll(me.pos[0], me.vel[0], wx0, a0, d0, n0);
    const [pz, vz] = roll(me.pos[2], me.vel[2], wz0, a0, d0, n0);
    this.pos = [px, pz];
    this.vel = [vx, vz];

    // the minigame may know the word it wants outright
    const over = brain.think ? brain.think(view, me, this, t) : null;
    let yaw = null, move = 1, hop = 0, use = false;
    if (over && over.yaw !== undefined && over.yaw !== null) {
      yaw = Math.abs(over.yaw) > 2 * Math.PI + 0.01 ? (over.yaw / TURN) * 2 * Math.PI : over.yaw;
      move = over.move === undefined ? 1 : over.move & 15;
    } else {
      // the goal: the brain's (asked every think: a brain keeps it cheap, in this.mem), else the stage's centre
      const goal = this.goal = brain.goal ? brain.goal(view, me, this) : null;
      const pull = goal ? 1.5 : 0.3;
      const gx = goal ? goal[0] : g.cx, gz = goal ? goal[1] : g.cx;
      const gd0 = Math.hypot(gx - px, gz - pz);
      // the samples: an eighth of a second out, then 0.25 s to its horizon
      const H = 0.45 + 0.4 * this.skill;
      const ticks = [0.12, 0.25, 0.25 + (H - 0.25) / 3, 0.25 + 2 * (H - 0.25) / 3, H].map((s) => Math.round(s / DT));
      const reach = Math.hypot(vx, vz) * H + 12 * H * H + ROOM;
      const rivals = near(w, px, pz, reach + ROOM, this.slot);
      const danger = brain.danger || (() => 0);
      const yaw0 = this.yaw / TURN * 2 * Math.PI;
      // per sample: where the ball coasts to and how far a push takes it on from there
      // (roll's closed form split: x = px + vx * DT * s + wish * a * DT * (n - s) / (1 - d)), and the rivals then
      const NS = ticks.length, nr = rivals.length;
      const { coastX, coastZ, pushK, idleX, idleZ, rx, rz } = SCRATCH;
      for (let j = 0; j < NS; j++) {
        const n = ticks[j];
        const sK = Math.abs(1 - dKeys) < 1e-7 ? n : dKeys * (1 - dKeys ** n) / (1 - dKeys);
        const sI = Math.abs(1 - dIdle) < 1e-7 ? n : dIdle * (1 - dIdle ** n) / (1 - dIdle);
        coastX[j] = px + DT * vx * sK; coastZ[j] = pz + DT * vz * sK;
        pushK[j] = Math.abs(1 - dKeys) < 1e-7 ? DT * acc * n * (n + 1) / 2 : DT * acc * (n - sK) / (1 - dKeys);
        idleX[j] = px + DT * vx * sI; idleZ[j] = pz + DT * vz * sI;
        const s = n * DT * 0.7;
        for (let i = 0; i < nr; i++) { const b = rivals[i].b; rx[j * nr + i] = b.x + b.vx * s; rz[j * nr + i] = b.z + b.vz * s; }
      }
      const ROOM2 = ROOM * ROOM;
      let best = -Infinity, bestRisk = 0, pick = 0, pickMove = 1;
      // 16 headings, the goal's, and coasting (no keys: PG_IDLE's brake)
      for (let k = 0; k <= DIRS + 1; k++) {
        const coast = k === DIRS + 1;
        const a = k < DIRS ? (k / DIRS) * 2 * Math.PI : k === DIRS ? Math.atan2(gz - pz, gx - px) : yaw0;
        const cx = coast ? 0 : Math.cos(a), cz = coast ? 0 : Math.sin(a);
        let risk = 0, crowd = 0, ex = px, ez = pz;
        for (let j = 0; j < NS; j++) {
          if (coast) { ex = idleX[j]; ez = idleZ[j]; } else { ex = coastX[j] + cx * pushK[j]; ez = coastZ[j] + cz * pushK[j]; }
          risk = Math.max(risk, danger(view, ex, ez, t + ticks[j], me) * (1 - 0.1 * j));
          for (let i = j * nr, e = i + nr; i < e; i++) {
            const dx = rx[i] - ex, dz = rz[i] - ez, d2 = dx * dx + dz * dz;
            if (d2 < ROOM2) crowd += (ROOM - Math.sqrt(d2)) / ROOM * (1 - 0.15 * j);
          }
        }
        const made = Math.max(-1, Math.min(1.5, (gd0 - Math.sqrt((gx - ex) * (gx - ex) + (gz - ez) * (gz - ez))) / (10 * H)));
        let score = -10 * risk + pull * made - 0.8 * crowd;
        if (!coast) score += 0.3 * Math.cos(a - yaw0);
        score += (this.rand() - 0.5) * 0.6 * (1 - this.skill);
        if (score > best) { best = score; bestRisk = risk; pick = a; pickMove = coast ? 0 : 1; }
      }
      this.danger = bestRisk;
      yaw = pick;
      move = pickMove;
    }
    if (over) { if (over.hop) hop = 1; if (over.use) use = true; }
    if (!hop && brain.hop && ground && g.hop > 0 && brain.hop(view, me, this)) hop = 1;

    // a power-up, if the minigame hands any out: used when it pays, as bumper's balls do
    if (!over?.use && me.item && me.refire === 0) {
      const close = near(w, px, pz, 8, this.slot);
      const ahead = (b, cone) => {
        const dx = b.x - px, dz = b.z - pz, d = Math.hypot(dx, dz) || 1;
        return (dx * Math.cos(yaw) + dz * Math.sin(yaw)) / d > cone;
      };
      switch (me.item) {
        case L.PU_MEGA: use = close.some(({ d }) => d < 6); break;
        case L.PU_POW: use = close.length >= 2; break;
        case L.PU_DASH: case L.PU_ROCKET: use = close.some(({ b }) => ahead(b, 0.95)); break;
        case L.PU_SPRING: use = this.danger > 0.6 || close.filter(({ d }) => d < 6).length >= 2; break;
        default:
      }
      if (use && this.rand() > 0.5 + 0.5 * this.skill) use = false;
    }
    if (use) this.use++;

    this.wobble += (this.rand() - 0.5) * 0.4 * (1 - this.skill);
    this.wobble *= 0.8;
    this.yaw = Math.round((yaw + this.wobble) / (2 * Math.PI) * TURN) & (TURN - 1);
    this.move = move;
    this.hop = hop;
    this.word = partyWord({ yaw: this.yaw, move, hop, use: this.use & 3 });
    return this.word;
  }
}
