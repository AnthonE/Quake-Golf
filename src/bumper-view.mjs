// Bumper balls' readers, on top of src/view.mjs: a player record read as a
// ball, the round, the cheese (its rim and holes as they are now) and the
// orbs. Kept apart from view.mjs, which the Xbox's sim shares (test/fork.test.mjs).
// The squeeze is computed here as the sim computes it, in doubles: close
// enough to draw and to steer by, never fed back into the sim.
import * as L from './layout.mjs';
import { View, inputWord } from './view.mjs';

export { View, inputWord };
const N = (k) => Number(L.BPHYS[k]);
export const PLAT_Y = N('PLAT_Y');
export const PLAT_T = N('PLAT_T');
export const B_RAD = N('B_RAD');
export const MEGA_RAD = N('MEGA_RAD');
export const B_RMIN = N('B_RMIN');

// A ball: a player record read as bumper's.
View.prototype.bumper = function bumper(p) {
  const d = this.dv;
  const b = L.PLAYERS + this.bank + p * L.PSIZE;
  const pl = this.player(p);
  const fl = d.getUint8(b + L.P_FL);
  const mega = d.getUint16(b + L.B_MEGA, true);
  return {
    ...pl, out: !!(fl & L.PF_DEAD), falling: !!(fl & L.PF_FALL), stomp: !!(fl & L.PF_STOMP),
    item: d.getUint8(b + L.B_ITEM), mega, dash: d.getUint16(b + L.B_DASH, true), radius: mega ? MEGA_RAD : B_RAD,
    wins: d.getUint16(b + L.B_WINS, true), kos: d.getUint16(b + L.B_KOS, true), bumps: d.getUint16(b + L.B_BUMPS, true),
    hitBy: d.getUint8(b + L.B_HITBY), hitFor: d.getUint16(b + L.B_HITT, true), place: d.getUint8(b + L.B_PLACE),
    rounds: d.getUint16(b + L.B_ROUNDS, true), outAt: d.getUint32(b + L.B_OUTAT, true),
    yaw: (pl.input & 0x3fff) / 16384 * 2 * Math.PI,
  };
};

// The round and the cheese as they are on this bank's tick.
View.prototype.wheel = function wheel() {
  const d = this.dv;
  const o = this.bank;
  const h = this.hole();
  // the sim's i32 subtraction: it wraps
  const f = h.state >= L.H_PLAY ? Math.min(1, Math.max(0, ((h.tick - h.start) | 0) / L.SHRINK_TICKS)) : 0;
  const r0 = d.getFloat32(L.BH_R0 + o, true);
  const grow = 1 + 0.5 * f;
  const holes = [];
  for (let k = 0; k < d.getUint32(L.BH_NHOLE + o, true); k++) {
    const a = L.B_HOLES + k * L.HOLE_SIZE;
    holes.push({ x: d.getFloat32(a, true), z: d.getFloat32(a + 4, true), r0: d.getFloat32(a + 8, true), r: d.getFloat32(a + 8, true) * grow });
  }
  return {
    ...h, squeeze: f, r0, rim: r0 - Math.max(0, r0 - B_RMIN) * f, holes,
    n0: d.getUint32(L.BH_N0 + o, true), left: d.getUint32(L.BH_LEFT + o, true), winner: d.getUint32(L.BH_WINNER + o, true), drop: d.getUint32(L.BH_DROP + o, true),
  };
};

// What is under (x, z) on a wheel: -1 cheese, k the hole, 255 past the rim.
export function floorAt(w, x, z) {
  const dx = x - L.B_CX, dz = z - L.B_CX;
  if (dx * dx + dz * dz >= w.rim * w.rim) return 255;
  for (let k = 0; k < w.holes.length; k++) {
    const h = w.holes[k];
    if ((x - h.x) ** 2 + (z - h.z) ** 2 < h.r * h.r) return k;
  }
  return -1;
}

// How far (x, z) is from the nearest drop: a hole's edge or the rim (negative over one).
export function edgeDistance(w, x, z) {
  let best = w.rim - Math.hypot(x - L.B_CX, z - L.B_CX);
  for (const h of w.holes) best = Math.min(best, Math.hypot(x - h.x, z - h.z) - h.r);
  return best;
}

// The orbs: falling or lying on the cheese.
View.prototype.orbs = function orbs() {
  const out = [];
  for (let k = 0; k < L.NORB; k++) {
    const a = L.B_ORBS + k * L.ORB_SIZE;
    const kind = this.u8[a + 12];
    if (!kind) continue;
    out.push({ k, kind, pos: [this.dv.getFloat32(a, true), this.dv.getFloat32(a + 4, true), this.dv.getFloat32(a + 8, true)],
      falling: this.u8[a + 13] === 1, life: this.dv.getUint16(a + 14, true) });
  }
  return out;
};

// Golf's input word, as bumper reads it: yaw, the keys, a hop, the use counter.
export const bumperWord = ({ yaw = 0, move = 0, hop = 0, use = 0 }) => inputWord({ yaw, pitch: 512, move, jump: hop, shot: use });
