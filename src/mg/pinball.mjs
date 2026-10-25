// PINBALL (MG_PINBALL, prefix pn): a giant table sloping down to its drains,
// walled round. Pop bumpers kick a ball away (1), the top lanes pay 3 rolled
// through, drop targets in banks on the sides 5 each and 25 more for the one
// who downs a bank's last, the spinner 1 a turn. Pairs of flippers at the
// bottom swing up on the clock, left then right, and bat balls back up; a
// ball through a drain is down, back in the plunger lane at the top a second
// later, a fifth of its points gone. The last 15 s score double. Most points
// wins. Literal numbers only: the sim reads them through layout.mjs's
// MG_CONSTS, the client imports this file itself.
export const PN_LEN = 10000; // 80 s
export const PN_DOUBLE = 1875; // the last 15 s score double
// The table: W = PN_W0 + PN_WK times the root of the balls in, PN_WMIN to
// PN_WMAX wide, PN_LK times that long, rising PN_SLOPE a metre from its
// bottom edge (at PLAT_Y) to its top. A ball on it is pulled down it PN_PULL
// m/s^2; just over it (within PN_SNAP) and not rising faster than PN_SNAPV
// it's put back on it.
export const PN_W0 = 24;
export const PN_WK = 2;
export const PN_WMIN = 32;
export const PN_WMAX = 56;
export const PN_LK = 1.7;
export const PN_SLOPE = '0.12';
export const PN_PULL = '4';
export const PN_SNAP = '0.5';
export const PN_SNAPV = '1.5';
export const PN_SINK = '0.5'; // m under the table's plane a ball meets nothing: it's falling through a drain
export const PN_ACC = '0.5'; // the push, times bumper's: 5.5 m/s^2, against the pull's 4
export const PN_DRAG = '0.996'; // rolling drag a tick, keys held: 11 m/s flat out, 3 up the table, 19 down it
export const PN_IDLE = '0.994'; // no keys: a ball coasts down at 5 m/s at most
export const PN_BACK = 125; // ticks a ball down a drain waits, under the table, before the plunger lane
// The bottom: PN_W3 wide and over, three funnels, else two, each a pair of
// flippers on pivots PN_GAP + (PN_LB times the funnel's width) cos 30 out
// from its middle, their tips PN_TIPB up from the bottom edge at rest; a
// guide wall up from each pivot to the funnel's edge (PN_GUIDEK up a metre
// across), its middle (PN_SL0 to PN_SL1 of it) a slingshot. The floor ends
// along the guides, the flippers at rest and across the gap between their
// tips: past that line is the drain.
export const PN_W3 = 50;
export const PN_GAP = 2.1; // m from a funnel's middle to its flippers' tips at rest, axis to axis
export const PN_LB = 0.27; // a flipper's length, times the funnel's width
export const PN_TIPB = 4.5;
export const PN_GUIDEK = 1.43; // tan 55 degrees
export const PN_SL0 = 0.2;
export const PN_SL1 = 0.8;
// A flipper: a bar PN_BATR in radius and PN_BATH tall (a hop's top clears
// it), at rest PN_REST below level (1/16384 turn), up at PN_UP. Each swings
// on its own clock: from PN_FWAIT into play (the right ones PN_FHALF later)
// every PN_FPER ticks, up over PN_FUP, held PN_FHOLD, back over PN_FDOWN; a
// ball it meets bounces off it at PN_BATE of how fast they met.
export const PN_BATR = '0.5';
export const PN_BATH = '0.75';
export const PN_REST = 1365; // 30 degrees down
export const PN_UP = -1138; // 25 degrees up
export const PN_FWAIT = 125;
export const PN_FPER = 150; // 1.2 s
export const PN_FHALF = 75;
export const PN_FUP = 25;
export const PN_FHOLD = 30;
export const PN_FDOWN = 25;
export const PN_BATE = '0.3';
// Walls PN_WALLR in radius bounce a ball off at PN_WALLE (a corner's
// deflector at PN_DEFE); a slingshot throws it off at PN_SLINGK m/s at
// least, a pop bumper (PN_BR in radius, PN_BH tall) at PN_KICK; a drop target
// bounces it at PN_TGTE.
export const PN_WALLR = '0.3';
export const PN_WALLE = '0.3';
export const PN_DEFE = '0.6';
export const PN_SLINGK = 11;
export const PN_TGTE = '0.4';
export const PN_BR = 1.4;
export const PN_BH = 1.6;
export const PN_KICK = 13;
export const PN_BUMPE = '0.5';
// The plunger lane down the right of the top, PN_PLW wide, from PN_PLT under
// the top to PN_PLLK of the table's length under it: a ball in it (its
// bottom within PN_PLH of the floor) is shot up at PN_PLUNGE m/s into the
// corner's deflector (PN_DEF across) and over the top. A ball down comes back
// in it.
export const PN_PLW = 4.5;
export const PN_PLT = 7;
export const PN_PLLK = 0.28;
export const PN_PLH = '1.5';
export const PN_PLUNGE = 22;
export const PN_DEF = 5;
// The top lanes: 3 under PN_W4 wide, 4 under PN_W5, else 5, PN_LANEW each,
// centred PN_PLW / 2 left of the middle (clear of the plunger lane), their
// posts from PN_LW0 to PN_LW0 + PN_LLEN under the top. A ball whose centre
// comes within PN_LANEW / 2 - PN_LSWM of a lane's middle and PN_LSWM in from
// the posts' ends, rolling down the table faster than PN_LANEV, has rolled
// over its switch: PN_LANEPAY, but a lane pays a ball once in PN_LANECD. It
// stays lit PN_LLIT.
export const PN_W4 = 40;
export const PN_W5 = 48;
export const PN_LANEW = 3.8;
export const PN_LW0 = 5;
export const PN_LLEN = 5;
export const PN_LSWM = 0.5;
export const PN_LANECD = 500; // 4 s
export const PN_LANEV = '1';
export const PN_LLIT = 250;
export const PN_LANEPAY = 3;
// Pop bumpers: a triangle pointing down, 2 rows under PN_W4 wide, 3 under
// PN_W5, else 4 (3, 6 or 10 of them), PN_BSP apart in a row and PN_BROW
// between rows, the top row PN_BW0 under the top; centred as the lanes are.
export const PN_BSP = 7.6;
export const PN_BROW = 6.6;
export const PN_BW0 = 16;
export const PN_BUMPPAY = 1;
// The spinner: a lane PN_SPW wide along the left wall (and the right, PN_W3
// wide and over), PN_SPL long from PN_SPF of the table's length under the
// top; its plate across the lane's middle. A ball through its middle (within
// PN_SPD) at more than 2 m/s along the lane spins it at PN_SPINK units a tick
// (1/16384 turn) a m/s, at most PN_SPINMAX, slowing by a 64th a tick; every
// turn pays whoever spun it last.
export const PN_SPW = 4.4;
export const PN_SPL = 8;
export const PN_SPF = 0.42;
export const PN_SPD = 0.9;
export const PN_SPINK = 136;
export const PN_SPINMAX = 4096;
// Drop targets: banks along the side walls, their faces PN_TD out from them,
// PN_TGAP under the spinner lanes; 2 banks (one a side) under PN_W3 wide,
// else 4 (PN_TROW apart down a side), of 3 targets under PN_W4, else 4, each
// PN_TLEN long and PN_TSTEP apart. A target hit drops PN_DROPT after (it
// stands till then: what a ball meets is fixed that far ahead, past the
// prediction's reach), paying PN_TGTPAY; the one who downs a bank's last is
// paid PN_BANKPAY more, and the bank stands again PN_RESETT after its last
// drops.
export const PN_TD = 1;
export const PN_TGAP = 3;
export const PN_TLEN = 2.4;
export const PN_TSTEP = 2.6;
export const PN_TROW = 4;
export const PN_TH = 1.4; // how tall a target stands, m (drawn)
export const PN_DROPT = 210;
export const PN_RESETT = 1000;
export const PN_TGTPAY = 5;
export const PN_BANKPAY = 25;
// Where the balls start: rows PN_SPACE apart from PN_SPAWN0 under the lowest
// bumpers' middles down to PN_SPAWN1 over the guides' tops, PN_SPAWNU in from
// the side walls.
export const PN_SPACE = 2.6;
export const PN_SPAWN0 = 4.4;
export const PN_SPAWN1 = 3;
export const PN_SPAWNU = 6;
export const PN_NSEGMAX = 64;
export const PN_NBAND = 16; // the table's length in bands, each listing the solids that reach into it
export const PN_BANDCAP = 32;
export const PN_NTMAX = 16;
// Its header, byte offsets in PG_H (112 B, in the prediction's copy): the
// table's shape, which ground and push read on their own bank. Across (u) is
// world x less PG_CX, down (w) world z less PG_CX: the top is at w = -HL,
// the bottom edge at +HL.
export const PN_HW = 0; // f32 half its width
export const PN_HL = 4; // f32 half its length
export const PN_M = 8; // u32 funnels (pairs of flippers)
export const PN_F = 12; // f32 a funnel's width
export const PN_LBAT = 16; // f32 a flipper's length
export const PN_AP = 20; // f32 a pivot's way across from its funnel's middle
export const PN_WP = 24; // f32 the pivots' w
export const PN_WT = 28; // f32 the tips' at rest
export const PN_WG = 32; // f32 the guides' tops'
export const PN_KB = 36; // f32 the floor's edge along a flipper at rest: down a metre in
export const PN_KG = 40; // f32 and along a guide: up a metre out
export const PN_NSEG = 44; // u32 solids
export const PN_BANDK = 48; // f32 bands a metre
export const PN_PLU = 52; // f32 the plunger lane's inner wall, across
export const PN_PLTW = 56; // f32 its top's w
export const PN_PLBW = 60; // f32 its bottom's
export const PN_NB = 64; // u32 pop bumpers
export const PN_NT = 68; // u32 drop targets
export const PN_NBANK = 72; // u32 banks
export const PN_NL = 76; // u32 top lanes
export const PN_NSP = 80; // u32 spinners
export const PN_LTOP = 84; // f32 the lanes' posts' top w
export const PN_LBOT = 88; // f32 their bottom's
export const PN_UL = 92; // f32 the lanes' and bumpers' middle, across
export const PN_SW0 = 96; // f32 the spinner lanes' top w
export const PN_SPAWNW = 100; // f32 the start's first row's w
// In PG_S. The solids (PN_SEGSIZE B each): a capsule from (u, w) along the
// unit (eu, ew) len, of radius rad (a bumper is one of len 0), its kind and
// the bumper's, target's or slingshot's number; the bands (PN_BANDCAP solids'
// u8 indices each, and their counts); then the targets, banks, spinners,
// lanes, bumpers and a record per slot.
export const PN_SEG = 0;
export const PN_SEGSIZE = 32;
export const PN_S_U = 0; // f32
export const PN_S_W = 4; // f32
export const PN_S_EU = 8; // f32
export const PN_S_EW = 12; // f32
export const PN_S_LEN = 16; // f32
export const PN_S_RAD = 20; // f32
export const PN_S_KIND = 24; // u8 PN_K*
export const PN_S_IDX = 25; // u8
export const PN_KWALL = 0;
export const PN_KSLING = 1;
export const PN_KTGT = 2;
export const PN_KBUMP = 3;
export const PN_KDEF = 4; // a corner's deflector: a wall that keeps more of the speed
export const PN_BANDS = 0x800; // PN_NBAND x PN_BANDCAP u8
export const PN_BANDN = 0xa00; // PN_NBAND u8
export const PN_TGT = 0xa40; // PN_NTMAX x 8 B: u32 the HDR_TICK it was hit (0 standing) | u8 its bank | u8 its solid
export const PN_BANK = 0xac0; // 4 x 16 B: u32 the HDR_TICK it stands again (0 none due) | u8 its first target | u8 targets | u8 side | u8 0 | u32 times downed
export const PN_SPIN = 0xb00; // 2 x 32 B: f32 u, w | f32 the lane's half-width | u32 angle (1/16384 turn, all it has turned) | u32 spin a tick | u32 turns paid | u32 who spun it last (255 none)
export const PN_LANE = 0xb40; // 6 x 16 B: f32 u | u32 the HDR_TICK it's lit till | u32 times rolled
export const PN_BUMP = 0xba0; // 10 x 16 B: f32 u, w | u32 hits | u32 0
export const PN_BALL = 0xc80; // 16 B a slot: u8 the lane it's over (+1, 0 none) | u8 0 | u16 a lane, 6 of them: the tick into play + 1 it last paid it (0 never)
// A ball's PG_M: what its own push met this tick, for the confirmed world's
// pay: the low 16 bits of HDR_TICK in its top half, the target (+1) in bits
// 8-15, the bumper (+1) in bits 0-7 (written on either bank, so the
// prediction's record has it too).
// FX kinds, FX_MG + 4 * MG_PINBALL + k.
export const PN_FX_SCORE = 112; // points: the ball as owner, shot what (PN_W*) << 8 | its number, the points as size
export const PN_FX_KICK = 113; // a kick (either bank): the ball as owner, shot what (PN_J*) << 8 | its number, the speed out as size
export const PN_FX_DRAIN = 114; // down a drain: the ball as owner, the points it lost as shot
export const PN_FX_CALL = 115; // the table: shot 0 double time, 1 a bank stands again (size the bank); owner 255
export const PN_WBUMP = 0;
export const PN_WLANE = 1;
export const PN_WTGT = 2;
export const PN_WBANK = 3;
export const PN_WSPIN = 4;
export const PN_JBUMP = 0;
export const PN_JSLING = 1;
export const PN_JBAT = 2;
export const PN_JPLUNGE = 3;
