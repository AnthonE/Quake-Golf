// The arena's readers, on top of src/view.mjs: its input word and frames, a
// player record read as a fighter, the match's mode and sides, the weapon
// pads, the map and its objectives. Kept apart from view.mjs, which the
// Xbox's sim shares (test/fork.test.mjs).
import * as L from './layout.mjs';
import { View } from './view.mjs';

export { View };
// The arena's input word (layout.mjs). yaw in 1/16384 turn like golf's,
// rounded to the word's 1/2048; serial is this tick's bit of the frame.
// yaw in 1/16384 turn, rounded to the word's 1/2048
export function arenaWord({ yaw = 0, pitch = 512, move = 0, jump = 0, shot = 0, melee = 0, gren = 0, slot = 0, serial = 0 }) {
  return ((((yaw + 4) >> 3) & 0x7ff) | ((pitch & 0x3ff) << L.AW_PITCH) | ((move & 0xf) << L.AW_MOVE) | ((jump & 1) << L.AW_JUMP)
    | ((shot & 3) << L.AW_SHOT) | ((melee & 1) << L.AW_MELEE) | ((gren & 1) << L.AW_GREN) | ((slot & 1) << L.AW_SLOT) | ((serial & 1) << L.AW_SERIAL)) >>> 0;
}

// The frame a fighter sends over 8 ticks, a bit a tick (bit tick & 7).
export const arenaFrame = ({ lag = 0, reload = 0, use = 0 }) => (L.AF_SENT | (Math.max(0, Math.min(L.LAG_MAX, Math.round(lag))) << L.AF_LAG_SHIFT) | (reload ? L.AF_RELOAD : 0) | (use ? L.AF_USE : 0));

// Whether a frame is worth sending: a request, a lag 2 ticks off the last one
// sent, or FRAME_EVERY ticks since. keep: { lag, at }, updated when it says yes.
export function frameDue(keep, t, lag, ask) {
  if (!ask && keep.at !== undefined && Math.abs(lag - keep.lag) < 2 && t - keep.at < L.FRAME_EVERY) return false;
  keep.lag = lag;
  keep.at = t;
  return true;
}

export function unpackArena(w) {
  return { yaw: (w & 0x7ff) << 3, pitch: (w >>> L.AW_PITCH) & 0x3ff, move: (w >>> L.AW_MOVE) & 0xf, jump: (w >>> L.AW_JUMP) & 1, shot: (w >>> L.AW_SHOT) & 3,
    melee: (w >>> L.AW_MELEE) & 1, gren: (w >>> L.AW_GREN) & 1, slot: (w >>> L.AW_SLOT) & 1, serial: w >>> L.AW_SERIAL };
}

// A fighter: a player record read as the arena's.
View.prototype.fighter = function fighter(p) {
  const d = this.dv;
  const b = L.PLAYERS + this.bank + p * L.PSIZE;
  const pl = this.player(p);
  const fl = d.getUint8(b + L.P_FL);
  const act = d.getUint8(b + L.A_ACT);
  const slot = (act >> 2) & 1;
  const gun = [d.getUint8(b + L.A_GUN), d.getUint8(b + L.A_GUN + 1)];
  return {
    ...pl, dead: !!(fl & L.PF_DEAD), hp: d.getUint8(b + L.A_HP), sh: d.getUint8(b + L.A_SH), shieldIn: d.getUint16(b + L.A_SHT, true),
    gun, mag: [d.getUint8(b + L.A_MAG), d.getUint8(b + L.A_MAG + 1)], res: [d.getUint16(b + L.A_RES, true), d.getUint16(b + L.A_RES + 2, true)],
    hand: slot, weapon: gun[slot], grens: d.getUint8(b + L.A_GRENS), act, kills: d.getUint16(b + L.A_KILLS, true), deaths: d.getUint16(b + L.A_DEATHS, true),
    respawn: d.getUint16(b + L.A_RESPAWN, true), cool: d.getUint16(b + L.A_COOL, true), burst: d.getUint8(b + L.A_BURST), lag: d.getUint8(b + L.A_LAG),
    reload: d.getUint8(b + L.A_RELOAD), needles: d.getUint8(b + L.A_NEEDLES), hitBy: d.getUint8(b + L.A_HITBY),
    yaw: (pl.input & 0x7ff) / 2048 * 2 * Math.PI, pitch: (((pl.input >>> L.AW_PITCH) & 0x3ff) - 512) / 1024 * Math.PI,
    // the match's mode: a side, and the confirmed world's record (MODE_REC is not in the prediction's copy).
    // team is 0 red, 1 blue, -1 in a mode without them: red is PF_BLUE clear, so the bit alone would make every Fiesta fighter red
    zombie: !!(fl & L.PF_ZOMBIE), jugg: !!(fl & L.PF_JUGG), team: this.teamed() ? (fl & L.PF_BLUE ? 1 : 0) : -1, carry: !!(fl & L.PF_CARRY), ...this.modeRec(p),
  };
};

// Whether this match's mode is red against blue (layout.mjs, TEAMED), on the view's bank.
View.prototype.teamed = function teamed() {
  const m = this.dv.getUint32(L.AH_MODE + this.bank, true);
  return m < 32 && ((1 << m) & L.TEAMED) !== 0;
};

// Slot p's record under the match's mode (layout.mjs, MODE_REC), from the confirmed world.
View.prototype.modeRec = function modeRec(p) {
  const r = L.MODE_REC + p * L.MR_SIZE;
  // aux is human's bytes: a team mode's second stat (CTF's returns)
  const human = this.dv.getUint16(r + L.MR_HUMAN, true);
  return { rung: this.u8[r + L.MR_RUNG], place: this.u8[r + L.MR_PLACE], points: this.dv.getUint16(r + L.MR_POINTS, true), human, aux: this.dv.getUint16(r + L.MR_AUX, true) };
};

// The match's mode and its header fields (0 and -1s in a Fiesta). A team
// mode's: score and teamN [red, blue], target (0: none), teamWin (0 playing,
// 1 red won, 2 blue, 3 a draw).
View.prototype.mode = function mode() {
  const u = (a) => this.dv.getUint32(a + this.bank, true);
  const m = u(L.AH_MODE);
  return { mode: m, name: L.MODES[m]?.name || '?', rules: L.MODES[m]?.rules || '', humans: u(L.AH_HUMANS), zombies: u(L.AH_ZOMBIES), leader: u(L.AH_LEADER) - 1, winner: u(L.AH_WINNER) - 1,
    teamed: m < 32 && ((1 << m) & L.TEAMED) !== 0, score: [u(L.AH_SCORE), u(L.AH_SCORE + 4)], target: u(L.AH_TARGET), teamWin: u(L.AH_TEAMWIN), teamN: [u(L.AH_TEAMN), u(L.AH_TEAMN + 4)] };
};

// Whether slots p and q are on one side (the sim's $a_ally), in the confirmed
// world: Infection's and Juggernaut's sides, red and blue; never p and p, nobody in a Fiesta.
View.prototype.ally = function ally(p, q) {
  const m = this.dv.getUint32(L.AH_MODE, true);
  if (p === q || m >= 32 || !((1 << m) & L.TEAM_MODES)) return false;
  return !((this.u8[L.PLAYERS + p * L.PSIZE + L.P_FL] ^ this.u8[L.PLAYERS + q * L.PSIZE + L.P_FL]) & (L.PF_ZOMBIE | L.PF_JUGG | L.PF_BLUE));
};

// The arena mode a seed forces (layout.mjs, FORCE_MODE) by name, or null when it forces none.
export const modeName = (seed) => (seed >>> 24 === L.FORCE_MODE ? L.MODES[(seed >>> 16) & 0xff]?.name ?? '' : null);

// The seed that forces every match of a room to be mode m (layout.mjs, FORCE_MODE), from a base seed's low 16 bits.
export const forcedSeed = (m, seed = 7) => ((L.FORCE_MODE << 24) | ((m & 0xff) << 16) | (seed & 0xffff)) >>> 0;

// The arena's weapon pads: where, which gun, and whether it's there now.
View.prototype.pads = function pads() {
  const out = [];
  for (let k = 0; k < L.NPAD; k++) {
    const a = L.PAD + k * L.PAD_SIZE;
    const w = this.u8[a + 12];
    if (!w) continue;
    out.push({ k, pos: [this.dv.getFloat32(a, true), this.dv.getFloat32(a + 4, true), this.dv.getFloat32(a + 8, true)], weapon: w, wait: this.dv.getUint16(a + 14, true) });
  }
  return out;
};

// The map as init laid it out (layout.mjs, MAP): where fighters can go, the
// boxes in their groups, the teleporters, the spawn points and the team
// modes' objectives (MAP_OBJ: the flags' stands, red's then blue's, and the
// skull's spot as [x, z, top], the hills as [x, z, top, radius]; tops as
// spawns', -1000 the ground). Read once per world and kept: the map never
// changes after init.
View.prototype.map = function map() {
  const d = this.dv;
  const key = `${d.getUint32(L.HDR_SEED, true)}:${d.getUint32(L.MAP_NBOX, true)}:${d.getUint32(L.MAP_NGROUP, true)}`;
  if (this._map?.key === key) return this._map;
  const f = (a) => d.getFloat32(a, true);
  const box = (a) => [0, 1, 2, 3, 4, 5].map((k) => f(a + 4 * k));
  const groups = [], boxes = [], teleporters = [], spawns = [];
  for (let g = 0; g < d.getUint32(L.MAP_NGROUP, true); g++) {
    const a = L.MAP_GROUPS + 32 * g;
    groups.push({ box: box(a), first: d.getUint32(a + 24, true), count: d.getUint32(a + 28, true) });
  }
  for (let k = 0; k < d.getUint32(L.MAP_NBOX, true); k++) {
    const a = L.MAP_BOXES + L.BOX_SIZE * k;
    boxes.push({ box: box(a), material: d.getUint32(a + 24, true), group: d.getUint32(a + 28, true) });
  }
  for (let k = 0; k < d.getUint32(L.MAP_NTELE, true); k++) {
    const a = L.MAP_TELE + L.TELE_SIZE * k;
    teleporters.push({ from: [f(a), f(a + 4), f(a + 8)], radius: f(a + 12), to: [f(a + 16), f(a + 20), f(a + 24)] });
  }
  for (let k = 0; k < d.getUint32(L.MAP_NSPAWN, true); k++) {
    const a = L.SPAWNS + L.SPAWN_SIZE * k;
    spawns.push([f(a), f(a + 4), f(a + 8)]);
  }
  const flags = [0, 1].map((k) => [0, 4, 8].map((o) => f(L.MAP_FLAGS + 16 * k + o)));
  const ball = [0, 4, 8].map((o) => f(L.MAP_BALL + o));
  const hills = [];
  for (let k = 0; k < Math.min(L.NHILL, d.getUint32(L.MAP_NHILL, true)); k++) hills.push([0, 4, 8, 12].map((o) => f(L.MAP_HILLS + 16 * k + o)));
  this._map = { key, bounds: [0, 1, 2, 3].map((k) => f(L.MAP_BOUNDS + 4 * k)), groups, boxes, teleporters, spawns, flags, ball, hills };
  return this._map;
};

// Where a fighter put down at (x, z) stands: on the highest box top under its
// footprint no higher than `top`, else the ground (the sim's $stand, for drawing and steering).
View.prototype.stand = function stand(x, z, top = -1000) {
  const r = Number(L.PHYS.P_R);
  let y = this.height(x, z);
  for (const b of this.map().boxes) {
    const [x0, , z0, x1, y1, z1] = b.box;
    if (x - r < x1 && x + r > x0 && z - r < z1 && z + r > z0 && y1 <= top) y = Math.max(y, y1);
  }
  return y;
};

// Where the ray o + t dir enters box b (t in [0, tmax]), or Infinity: the sim's slab test.
export function slab(b, o, dir, tmax) {
  let t0 = 0, t1 = tmax;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(dir[k]) < 1e-9) { if (o[k] <= b[k] || o[k] >= b[k + 3]) return Infinity; continue; }
    const ta = (b[k] - o[k]) / dir[k], tb = (b[k + 3] - o[k]) / dir[k];
    t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb));
  }
  return t0 <= t1 ? t0 : Infinity;
}

// How far the ray o + t dir goes before one of the map's boxes, out to tmax.
export function boxRay(map, o, dir, tmax) {
  let best = tmax;
  for (const g of map.groups) {
    if (slab(g.box, o, dir, best) > best) continue;
    for (let k = g.first; k < g.first + g.count; k++) best = Math.min(best, slab(map.boxes[k].box, o, dir, best));
  }
  return best;
}

// Nothing of the map's boxes between a and b.
export const boxClear = (map, a, b) => boxRay(map, a, [b[0] - a[0], b[1] - a[1], b[2] - a[2]], 1) >= 1;
