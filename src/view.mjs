// Reads gameplay state out of the sim's shared memory, by the one layout.
// The client (renderer, HUD, bot) and the tests use the same readers.
import * as L from './layout.mjs';

export class View {
  constructor(buffer) {
    this.dv = new DataView(buffer);
    this.f32 = new Float32Array(buffer);
    this.u8 = new Uint8Array(buffer);
    this.i32 = new Int32Array(buffer);
  }

  get tick() { return this.dv.getUint32(L.HDR_TICK, true); }
  get nballs() { return this.dv.getUint32(L.HDR_NBALLS, true); }

  hole() {
    const d = this.dv;
    const f = (a) => d.getFloat32(a, true);
    return {
      tick: this.tick, hole: d.getUint32(L.HDR_HOLE, true), state: d.getUint32(L.HDR_STATE, true),
      until: d.getUint32(L.HDR_UNTIL, true), start: d.getUint32(L.HDR_START, true),
      tee: [f(L.HDR_TEE), f(L.HDR_TEE + 4), f(L.HDR_TEE + 8)], cup: [f(L.HDR_CUP), f(L.HDR_CUP + 4), f(L.HDR_CUP + 8)],
      dir: [f(L.HDR_DIR), f(L.HDR_DIR + 4)], par: d.getUint32(L.HDR_PAR, true), live: d.getUint32(L.HDR_LIVE, true),
    };
  }

  player(p) {
    const d = this.dv;
    const b = L.PLAYERS + p * L.PSIZE;
    const f = (o) => d.getFloat32(b + o, true);
    const fl = d.getUint8(b + L.P_FL);
    return {
      slot: p, live: !!(fl & L.PF_LIVE), ground: !!(fl & L.PF_GROUND), done: !!(fl & L.PF_DONE),
      pos: [f(L.P_PX), f(L.P_PY), f(L.P_PZ)], vel: [f(L.P_VX), f(L.P_VY), f(L.P_VZ)],
      input: d.getUint32(b + L.P_IN, true), fired: d.getUint8(b + L.P_FIRED), refire: d.getUint16(b + L.P_REFIRE, true),
      strokes: d.getUint16(b + L.P_STROKES, true), ball: d.getInt32(b + L.P_BALL, true), doneTick: d.getUint32(b + L.P_DONE, true),
      score: d.getUint16(b + L.P_SCORE, true), holes: d.getUint16(b + L.P_HOLES, true), total: d.getUint32(b + L.P_TOTAL, true),
      shots: d.getUint16(b + L.P_SHOTS, true),
    };
  }

  ball(i) {
    const f = this.f32;
    return {
      index: i, pos: [f[(L.PX >> 2) + i], f[(L.PY >> 2) + i], f[(L.PZ >> 2) + i]], vel: [f[(L.VX >> 2) + i], f[(L.VY >> 2) + i], f[(L.VZ >> 2) + i]],
      flags: this.u8[L.FLAGS + i], owner: this.dv.getUint16(L.OWNER + 2 * i, true),
    };
  }

  projectiles() {
    const out = [];
    for (let j = 0; j < L.NPROJ; j++) {
      const b = L.PROJ + j * L.JSIZE;
      const kind = this.u8[b + L.J_KIND];
      if (!kind) continue;
      const f = (o) => this.dv.getFloat32(b + o, true);
      out.push({ slot: j, kind, pos: [f(L.J_PX), f(L.J_PY), f(L.J_PZ)], vel: [f(L.J_VX), f(L.J_VY), f(L.J_VZ)],
        age: this.dv.getUint16(b + L.J_AGE, true), owner: this.u8[b + L.J_OWNER], shot: this.dv.getUint16(b + L.J_SHOT, true) });
    }
    return out;
  }

  // FX records from index `from` (a running count) up to the newest; the ring keeps the last FX_MAX.
  fxCount() { return Atomics.load(this.i32, L.FX >> 2); }
  fx(k) {
    const r = L.FX_REC + (k & (L.FX_MAX - 1)) * 32;
    const d = this.dv;
    return { tick: d.getUint32(r, true), kind: d.getUint8(r + 4), owner: d.getUint8(r + 5), shot: d.getUint16(r + 6, true),
      pos: [d.getFloat32(r + 8, true), d.getFloat32(r + 12, true), d.getFloat32(r + 16, true)], size: d.getFloat32(r + 20, true) };
  }

  // Ground height under (x, z), bilinear, the way the sim's $ground computes it (for drawing and bots, not the sim).
  height(x, z) {
    const gx = Math.min(Math.max(x * 0.5, 0), 510.99);
    const gz = Math.min(Math.max(z * 0.5, 0), 510.99);
    const ix = Math.trunc(gx), iz = Math.trunc(gz);
    const fx = gx - ix, fz = gz - iz;
    const h = (a, b) => this.dv.getUint16(L.TERRAIN_H + 2 * ((iz + b) * 512 + ix + a), true) / 256;
    const h00 = h(0, 0), h10 = h(1, 0), h01 = h(0, 1), h11 = h(1, 1);
    return h00 + (h10 - h00) * fx + (h01 - h00) * fz + (h00 - h10 - h01 + h11) * fx * fz;
  }

  surface(x, z) {
    const ix = Math.trunc(Math.min(Math.max(x * 0.5, 0), 510.99));
    const iz = Math.trunc(Math.min(Math.max(z * 0.5, 0), 510.99));
    return this.u8[L.TERRAIN_S + iz * 512 + ix];
  }
}

// Input words (net/wire.mjs packs the same layout for the wire).
export const MOVE = { FORWARD: 1, BACK: 2, LEFT: 4, RIGHT: 8 };
export function inputWord({ yaw = 0, pitch = 512, move = 0, jump = 0, shot = 0, weapon = 0 }) {
  return ((yaw & 0x3fff) | ((pitch & 0x3ff) << 14) | ((move & 0xf) << 24) | ((jump & 1) << 28) | ((shot & 3) << 29) | ((weapon & 1) << 31)) >>> 0;
}
