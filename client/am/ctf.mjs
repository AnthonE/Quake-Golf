// CAPTURE THE FLAG (M_CTF), as drawn and as the AI fighter plays it. A stub
// for now: the frontend's team HUD, board and colours already work for it.
// To fill (the contract is client/am/index.mjs's; the rules src/am/ctf.mjs's,
// the state in AO as src/am/ctf.wat lays it out):
//   draw: both flags (kind 7, in the flag's side's colour, SIDE_RGB) at home
//     and dropped, a carried one over its carrier (not your own: your carry is
//     your HUD's), a glow at each stand; markers on the enemy flag (TAKE, or
//     ESCORT when your side carries it) and on your own when it isn't home
//     (RETURN dropped, KILL carried).
//   hud: your flag and theirs (HOME / TAKEN BY P5 / DROPPED 0:12), and when
//     carrying, YOU HAVE THE FLAG  RUN HOME.
//   news: CF_MX_TAKE, CF_MX_CAP, CF_MX_RETURN, CF_MX_HOME, CF_MX_DROP as feed
//     lines in the sides' colours, a banner for your own side's.
//   cols: CAPS (o.points), RETURNS (o.aux).
//   goal: a carrier runs home (hurry 1); defenders hold their stand, return
//     their dropped flag, chase their flag's carrier; attackers go for the
//     enemy flag (hurry 0.7) or escort their own carrier.
import * as L from '../../src/layout.mjs';

export default {
  mode: L.M_CTF,
  key: 'ctf',
  carry: 'flag',
  hud() {},
  news() {},
  draw() {},
  cols: [],
  goal: () => null,
};
