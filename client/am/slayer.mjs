// TEAM SLAYER (M_SLAYER), as drawn and as the AI fighter plays it: no
// objective but the other side. Every kill of an enemy is a point for the
// killer's side and a death by your own hand one off yours (src/am/slayer.wat);
// AH_TARGET wins. The HUD says who leads and by how much, the news is a side
// taking the lead (TS_MX_LEAD), the board's KILLS and DEATHS are all it needs.
// The brain goes looking for a fight: with nobody in sight it heads for the
// nearest enemy, wherever they are, so the sides meet in the middle and not
// on the pads.
import * as L from '../../src/layout.mjs';
import { SIDE, SIDE_C } from './sides.mjs';

// The lead in words, from your side's point of view (team -1: a spectator's, by name).
export function lead([red, blue], team) {
  if (red === blue) return { text: red ? `TIED AT ${red}` : 'NO KILLS YET', side: -1 };
  const side = red > blue ? 0 : 1, by = Math.abs(red - blue);
  if (team < 0) return { text: `${SIDE[side]} LEADS BY ${by}`, side };
  return { text: side === team ? `YOUR SIDE LEADS BY ${by}` : `${SIDE[side]} LEADS BY ${by}`, side };
}

// The nearest live enemy of slot `me` by feet, across: [slot, distance], or [-1, Infinity].
export function nearestEnemy(view, me) {
  let best = -1, bd = Infinity;
  for (let q = 0; q < L.NPLAYER; q++) {
    const b = L.PLAYERS + q * L.PSIZE;
    if ((view.u8[b + L.P_FL] & (L.PF_LIVE | L.PF_DEAD)) !== L.PF_LIVE || q === me.slot || view.ally(me.slot, q)) continue;
    const d = Math.hypot(view.dv.getFloat32(b + L.P_PX, true) - me.pos[0], view.dv.getFloat32(b + L.P_PZ, true) - me.pos[2]);
    if (d < bd) { bd = d; best = q; }
  }
  return [best, bd];
}

export default {
  mode: L.M_SLAYER,
  key: 'slayer',
  hud(view, ctx) {
    const md = view.mode();
    const l = lead(md.score, ctx.team);
    ctx.put(1, 2, l.text, l.side < 0 ? ctx.C.GREY : SIDE_C[l.side]);
    if (md.target) ctx.put(1, 3, `FIRST TO ${md.target} KILLS`, ctx.C.GREY);
  },
  news(f, ctx) {
    if (f.size !== L.TS_MX_LEAD) return;
    const side = f.shot - 1;
    if (side !== 0 && side !== 1) return;
    ctx.feed(`${SIDE[side]} TAKES THE LEAD`, SIDE_C[side]);
    const me = ctx.team;
    if (me >= 0) ctx.banner(me === side ? 'YOUR SIDE TAKES THE LEAD' : 'YOUR SIDE LOST THE LEAD', me === side ? SIDE_C[side] : ctx.C.GREY, 2000);
  },
  draw() {},
  cols: [],
  // hunt: the nearest enemy's feet, at no hurry (whoever turns up first is fought)
  goal(view, me) {
    const [q] = nearestEnemy(view, me);
    if (q < 0) return null;
    const b = L.PLAYERS + q * L.PSIZE;
    return { pos: [view.dv.getFloat32(b + L.P_PX, true), view.dv.getFloat32(b + L.P_PY, true), view.dv.getFloat32(b + L.P_PZ, true)], r: 6, hurry: 0, hold: false };
  },
  state(view) { return { score: view.mode().score, target: view.mode().target }; },
};
