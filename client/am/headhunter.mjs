// HEADHUNTER (M_HEADHUNT), as drawn and as the AI fighter plays it. A stub
// for now: the frontend's team HUD, board and colours already work for it.
// To fill (the contract is client/am/index.mjs's; the rules src/am/headhunter.mjs's,
// the state in AO as src/am/headhunter.wat lays it out):
//   draw: the drop zone (a ground disc and a ZONE marker with its distance),
//     the piles of skulls (kind 8) with how many each holds, the skulls a
//     carrier holds over its head (not your own: yours are your HUD's).
//   hud: the skulls you carry, the zone's distance and when it moves.
//   news: HH_MX_BANK and HH_MX_MOVE as feed lines in the sides' colours, a
//     banner for your own bank.
//   cols: SKULLS (o.points), CARRIED (o.aux).
//   goal: a fighter carrying skulls runs to the zone (hurrying more the more
//     it carries); the rest fight, and take piles near them.
import * as L from '../../src/layout.mjs';

export default {
  mode: L.M_HEADHUNT,
  key: 'headhunter',
  hud() {},
  news() {},
  draw() {},
  cols: [],
  goal: () => null,
};
