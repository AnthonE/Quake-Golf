// The arena's readers, on top of src/view.mjs: its input word and frames, a
// player record read as a fighter, the weapon pads. Kept apart from view.mjs,
// which the Xbox's sim shares (test/fork.test.mjs).
import * as L from './layout.mjs';
import { View } from './view.mjs';

export { View };
// The arena's input word (layout.mjs). yaw in 1/16384 turn like golf's,
// rounded to the word's 1/2048; serial is this tick's bit of the frame.
export function arenaWord({ yaw = 0, pitch = 512, move = 0, jump = 0, shot = 0, melee = 0, gren = 0, slot = 0, serial = 0 }) {
  return ((((yaw + 4) >> 3) & 0x7ff) | ((pitch & 0x3ff) << L.AW_PITCH) | ((move & 0xf) << L.AW_MOVE) | ((jump & 1) << L.AW_JUMP)
    | ((shot & 3) << L.AW_SHOT) | ((melee & 1) << L.AW_MELEE) | ((gren & 1) << L.AW_GREN) | ((slot & 1) << L.AW_SLOT) | ((serial & 1) << L.AW_SERIAL)) >>> 0;
}

// The frame a fighter sends over 8 ticks, a bit a tick (bit tick & 7).
export const arenaFrame = ({ lag = 0, reload = 0, use = 0 }) => (Math.max(0, Math.min(L.LAG_MAX, Math.round(lag))) | (reload ? L.AF_RELOAD : 0) | (use ? L.AF_USE : 0));

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
  };
};

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
