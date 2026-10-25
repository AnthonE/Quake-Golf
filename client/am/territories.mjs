// TERRITORIES (M_TERRITORY), as drawn and as the AI fighter plays it. A stub
// for now: the frontend's team HUD, board and colours already work for it.
// To fill (the contract is client/am/index.mjs's; the rules src/am/territories.mjs's,
// the state in AO as src/am/territories.wat lays it out):
//   draw: each territory, its holder's colour (grey for nobody) and its
//     capture filling; markers on those your side doesn't hold.
//   hud: the territories in a row (who holds each), how many are your side's.
//   news: TR_MX_TAKE and TR_MX_LOSE as feed lines in the sides' colours.
//   cols: a fighter's time on its side's territories (o.points).
//   goal: attackers go for the nearest territory their side doesn't hold,
//     defenders hold the nearest it does.
import * as L from '../../src/layout.mjs';

export default {
  mode: L.M_TERRITORY,
  key: 'territories',
  hud() {},
  news() {},
  draw() {},
  cols: [],
  goal: () => null,
};
