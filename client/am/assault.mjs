// ASSAULT (M_ASSAULT), as drawn and as the AI fighter plays it. A stub for
// now: the frontend's team HUD, board and colours already work for it.
// To fill (the contract is client/am/index.mjs's; the rules src/am/assault.mjs's,
// the state in AO as src/am/assault.wat lays it out):
//   draw: the bomb at home, dropped, carried (not your own: yours is your
//     HUD's) or planted with its fuse; both plates; markers on the bomb
//     (TAKE, ESCORT, DEFUSE) and the plate it's going to.
//   hud: where the bomb is (HOME, P5 HAS IT, DROPPED 0:12, PLANTED 0:04),
//     and when carrying, YOU HAVE THE BOMB  RUN TO THEIR BASE.
//   news: AS_MX_TAKE, AS_MX_PLANT, AS_MX_BOOM, AS_MX_DEFUSE as feed lines in
//     the sides' colours, a banner for your own side's.
//   cols: BOMBS (o.points), DEFUSES (o.aux).
//   goal: a carrier runs to the other side's plate (hurry 1) and holds it;
//     attackers take the bomb or escort its carrier; defenders hold their
//     plate and defuse.
import * as L from '../../src/layout.mjs';

export default {
  mode: L.M_ASSAULT,
  key: 'assault',
  carry: 'bomb',
  hud() {},
  news() {},
  draw() {},
  cols: [],
  goal: () => null,
};
