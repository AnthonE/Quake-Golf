// Party's readers, on top of src/bumper-view.mjs: the round (the minigame on,
// its knobs, the clock), a ball's party fields, the hex grid the minigames
// share ($p_hex, $p_hexc) and the per-round random numbers ($p_seed). For
// drawing and steering only, never fed back into the sim; the hex grid is
// worked in f32 as the sim works it, so a point picks the cell the sim picks.
import * as L from './layout.mjs';
import { View, inputWord, bumperWord, PLAT_Y, PLAT_T, B_RAD, MEGA_RAD } from './bumper-view.mjs';

export { View, inputWord, PLAT_Y, PLAT_T, B_RAD, MEGA_RAD };
export const P_STEP = Number(L.P_STEP);

// The round on this bank: the minigame, its knobs, who's in, the clock.
View.prototype.party = function party() {
  const d = this.dv;
  const o = this.bank;
  const u = (a) => d.getUint32(a + o, true);
  const f = (a) => d.getFloat32(a + o, true);
  const h = this.hole();
  const game = u(L.PG_GAME);
  const prev = u(L.PG_PREV);
  return {
    ...h, game, name: L.MINIGAMES[game]?.name ?? '', kind: u(L.PG_KIND), len: u(L.PG_LEN), floor: f(L.PG_FLOOR), size: f(L.PG_SIZE), cx: f(L.PG_CX),
    acc: f(L.PG_ACC), drag: f(L.PG_DRAG), idle: f(L.PG_IDLE), hop: f(L.PG_HOP), respawn: u(L.PG_RESPAWN), flags: u(L.PG_FLAGS), force: u(L.PG_FORCE),
    prev: [prev & 255, (prev >>> 8) & 255], n0: u(L.BH_N0), left: u(L.BH_LEFT), winner: u(L.BH_WINNER),
    // ticks into play, as $p_t counts them: the sim's i32 subtraction wraps
    t: h.state >= L.H_PLAY ? (h.tick - h.start) | 0 : 0,
    round: h.hole,
  };
};

// A ball, with this round's score, its party points and the minigame's own field.
View.prototype.partier = function partier(p) {
  const b = L.PLAYERS + this.bank + p * L.PSIZE;
  return { ...this.bumper(p), score: this.dv.getUint16(b + L.PG_SCORE, true), pts: this.dv.getUint16(b + L.PG_PTS, true), m: this.dv.getUint32(b + L.PG_M, true) };
};

const f = Math.fround;
// f32.nearest: to the nearest integer, ties to even.
function nearest(v) {
  const r = Math.round(v);
  return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

// $p_hex: the axial hex [q, r] holding (x, z), pointy-top cells of
// circumradius s (a corner on +z), cell (0, 0) centred on (cx, cx), q along
// +x, r at 60 degrees from +x towards +z.
export function hexAt(x, z, s, cx = L.B_CX) {
  const u = f(f(x - cx) / s);
  const w = f(f(z - cx) / s);
  const fq = f(f(u * f(0.57735026)) - f(w * f(0.33333334)));
  const fr = f(w * f(0.6666667));
  const fs = f(-fq - fr);
  let rq = nearest(fq);
  let rr = nearest(fr);
  const rs = nearest(fs);
  const dq = Math.abs(f(rq - fq)), dr = Math.abs(f(rr - fr)), ds = Math.abs(f(rs - fs));
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return [rq + 0, rr + 0];
}

// $p_hexc: hex (q, r)'s centre [x, z].
export function hexCentre(q, r, s, cx = L.B_CX) {
  return [f(f(f(f(q * f(1.7320508)) + f(r * f(0.8660254))) * s) + cx), f(f(f(r * 1.5) * s) + cx)];
}

// Golf's input word, as party reads it (bumper's): yaw, the keys, a hop, the use counter.
export const partyWord = bumperWord;

// $hash32: murmur3's finaliser over (x, z) and a seed.
export function hash32(x, z, s) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1) ^ s;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// $p_seed: the round's random number for k (the room's seed, the round, k), unsigned.
export function seed(view, k) {
  return hash32(view.dv.getUint32(L.HDR_SEED + view.bank, true), view.dv.getUint32(L.HDR_HOLE + view.bank, true), k);
}
