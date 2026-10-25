// VIP (M_VIP), as drawn and as the AI fighter plays it. A stub for now: the
// frontend's team HUD, board and colours already work for it.
// To fill (the contract is client/am/index.mjs's; the rules src/am/vip.mjs's,
// the state in AO as src/am/vip.wat lays it out):
//   draw: a crown over each VIP's head in its side's colour; markers on both
//     (PROTECT your own, KILL theirs).
//   hud: both VIPs (P5, or the next in so many seconds), and YOU ARE THE VIP.
//   news: VP_MX_DRAW and VP_MX_KILL as feed lines, a banner when you're drawn.
//   cols: VIP KILLS (o.points).
//   goal: a VIP keeps near its own side's fighters; attackers hunt the other
//     side's VIP; defenders stay near their own.
import * as L from '../../src/layout.mjs';

export default {
  mode: L.M_VIP,
  key: 'vip',
  hud() {},
  news() {},
  draw() {},
  cols: [],
  goal: () => null,
};
