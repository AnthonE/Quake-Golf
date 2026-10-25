// KING OF THE HILL (M_HILL), as drawn and as the AI fighter plays it. A stub
// for now: the frontend's team HUD, board and colours already work for it.
// To fill (the contract is client/am/index.mjs's; the rules src/am/hill.mjs's,
// the state in AO as src/am/hill.wat lays it out):
//   draw: the hill as out.zone (its disc and rim on the ground or a roof: y
//     the hill's resolved height, h HL_H), coloured by who holds it (SIDE_RGB,
//     white for nobody, flashing between the two when contested), glows round
//     its rim so it reads from afar; a marker on it (HILL, or HOLD when your
//     side has it).
//   hud: who holds it and when it moves (HILL: RED  MOVES IN 0:23, CONTESTED).
//   news: HL_MX_MOVE, HL_MX_TAKE, HL_MX_CONTEST.
//   cols: HILL (o.points, seconds).
//   goal: everyone to the hill (hurry 0.6), holding inside about two thirds
//     of its radius.
import * as L from '../../src/layout.mjs';

export default {
  mode: L.M_HILL,
  key: 'hill',
  hud() {},
  news() {},
  draw() {},
  cols: [],
  goal: () => null,
};
