// TILT TABLE (MG_TILT, prefix tt): a square table over the sea on a pivot
// at its middle, sized for the crowd. It tips on a schedule laid out from the
// round's seed: each move is shown TT_WARN ticks ahead, tips the table over
// TT_TIP ticks to a slope toward one of its four sides (or back to level),
// and holds. The slopes grow from TT_S0 to TT_S1 and the holds lengthen as
// the round goes; from TT_CHAIN0 a tilt may swing straight over to the other
// side without levelling. The slope pulls a ball down it; from TT_CR0 the
// edges crumble in. Off the table and you're out; the last ball on wins.
// Literal numbers only: the sim reads them through layout.mjs's MG_CONSTS,
// the client imports this file itself.
export const TT_H0 = 6; // the table's half-width: TT_H0 m plus TT_HK times the root of the balls in, at most TT_HMAX
export const TT_HK = 2;
export const TT_HMAX = 40;
export const TT_HMIN = 5; // its half-width once every edge has crumbled
export const TT_SPAWN = 0.7; // balls start on a spiral over this much of the half-width
export const TT_LEN = 12500; // 100 s
// The schedule, in ticks into play: the first tip at TT_FIRST, each move
// shown TT_WARN before its tip starts; a tip takes TT_TIP (a swing over to
// the other side, TT_SWING); a tilt holds from TT_HOLD0 at the start to
// TT_HOLD1 at TT_LEN, and the table rests level TT_REST0 to TT_REST1.
export const TT_FIRST = 400; // 3.2 s
export const TT_WARN = 150; // 1.2 s
export const TT_TIP = 125; // 1 s
export const TT_SWING = 220; // 1.76 s
export const TT_HOLD0 = 250; // 2 s
export const TT_HOLD1 = 500; // 4 s
export const TT_REST0 = 190; // 1.52 s
export const TT_REST1 = 75; // 0.6 s
// A tilt's slope (the fall a metre toward its side): from TT_S0 (8 degrees)
// to TT_S1 (25) by TT_RAMP, give or take TT_SJIT from the seed.
export const TT_S0 = 0.1405;
export const TT_S1 = 0.4663;
export const TT_SJIT = 0.03;
export const TT_RAMP = 9375; // 75 s
export const TT_CHAIN0 = 5000; // 40 s: from here half the tilts swing over to the other side before levelling
export const TT_NMAX = 96; // moves the schedule holds at most (about 40 fill 100 s)
export const TT_KSEED = 0x7417; // $p_seed key for the schedule
// A ball on the table: the slope pulls it TT_PULL m/s^2 a unit of slope
// (gravity's 20, a rolling ball's 5/7 of it); a ball within TT_SNAP over
// the table, leaving it no faster than TT_SNAPV, is put back on it; one
// within TT_GRIP under its top is lifted onto it (it rose past the ball);
// a ball off the table TT_DROP under the table's plane is out.
export const TT_PULL = 14;
export const TT_SNAP = 0.5;
export const TT_SNAPV = 1.5;
export const TT_GRIP = 1.5;
export const TT_DROP = 5;
// The edges: from TT_CR0 every TT_CRI ticks the outer band crumbles, in
// TT_CRN even steps from the half-width at the start to TT_HMIN, cracking
// for TT_CRWARN before it goes.
export const TT_CR0 = 5625; // 45 s
export const TT_CRI = 500; // 4 s: the last at 73 s
export const TT_CRN = 8;
export const TT_CRWARN = 250; // 2 s
// Its header, byte offsets in PG_H.
export const TT_HALF = 0; // f32 the half-width at the start
export const TT_NMOVE = 4; // u32 the moves in the schedule
// In PG_S: the moves, TT_MSIZE bytes each from TT_MOVES: u32 the tick into
// play its tip starts, f32 the slope it tips to along x and along z (the
// table's top falls that much a metre toward +x and toward +z), u16 the
// tip's ticks, u8 the side it tips toward (TT_LEVEL, or 1 +x, 2 -x, 3 +z,
// 4 -z), u8 its kind (TT_K_*). Fixed at setup for the round.
export const TT_MOVES = 0;
export const TT_MSIZE = 16;
export const TT_M_T = 0;
export const TT_M_GX = 4;
export const TT_M_GZ = 8;
export const TT_M_TIP = 12;
export const TT_M_DIR = 14;
export const TT_M_KIND = 15;
export const TT_LEVEL = 0;
export const TT_K_LEVEL = 0;
export const TT_K_TILT = 1;
export const TT_K_SWING = 2;
// Then u16 per slot, the tick into play it left the table, plus 1 (0: on
// it; over's); u8 per slot, the tilts it has ridden out (counted as each levels).
export const TT_FELL = 1536;
export const TT_SURV = 2048;
// FX kinds, FX_MG + 4 * MG_TILT + k: owner 255, at the table's middle.
export const TT_FX_WARN = 92; // a move is coming: shot side | kind << 3 | move << 8, size its slope
export const TT_FX_TIP = 93; // its tip starts: the same
export const TT_FX_CRACK = 94; // an edge is about to crumble: shot the step (1..TT_CRN), size the half-width it leaves
export const TT_FX_DROP = 95; // it crumbles: the same
