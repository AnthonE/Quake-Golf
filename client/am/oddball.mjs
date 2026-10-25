// ODDBALL (M_ODDBALL), as drawn and as the AI fighter plays it. A stub for
// now: the frontend's team HUD, board and colours already work for it.
// To fill (the contract is client/am/index.mjs's; the rules
// src/am/oddball.mjs's, the state in AO as src/am/oddball.wat lays it out):
//   draw: the skull (kind 8, white, with a glow) at its spot or dropped, over
//     its carrier when carried (not your own); a marker on it (SKULL free,
//     KILL on an enemy carrier, GUARD on your side's).
//   hud: who holds it, your side's seconds, and when carrying, YOU HAVE THE
//     SKULL  STAY ALIVE.
//   news: OB_MX_TAKE, OB_MX_DROP, OB_MX_RESET.
//   cols: SKULL (o.points, seconds held).
//   goal: the carrier keeps away from enemies (hold); everyone else goes for
//     a free skull (hurry 1), hunts an enemy carrier (0.8), escorts their own.
import * as L from '../../src/layout.mjs';

export default {
  mode: L.M_ODDBALL,
  key: 'oddball',
  carry: 'skull',
  hud() {},
  news() {},
  draw() {},
  cols: [],
  goal: () => null,
};
