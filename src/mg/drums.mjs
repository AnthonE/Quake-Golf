// DRUM ROLL (MG_DRUMS, prefix dr): a row of big drums over the sea, their
// axes level along x, side by side across z with narrow gaps between. Every
// drum spins, neighbours the opposite way, faster as the round goes, and one
// reverses as each phase after the first begins; a ball on top is carried
// toward a gap unless it rolls against the spin. Slots (cells of the drums'
// slats) open as the round goes and go round with their drum: one coming
// under a ball drops it in. The last ball on a drum wins.
// Literal numbers only: the sim reads them through layout.mjs's MG_CONSTS,
// the client imports this file itself.
export const DR_LEN = 11250; // 90 s
// The drums: shells DR_R m in radius, a ball's centre DR_RC from the axis
// on them (DR_RC2 its square), DR_P m apart axis to axis (a gap of 2.6 m
// between two), the axes DR_R under PLAT_Y so the tops are at PLAT_Y. A ball
// stands on one while its centre is within DR_ZS of the axis across it (64
// degrees round from the top); past that, or over a slot, it falls.
export const DR_R = 6;
export const DR_RC = 7;
export const DR_RC2 = 49;
export const DR_P = 14.6;
export const DR_ZS = 6.3;
// How many and how long: 2 drums plus one for every DR_KN of the root of the
// balls in (at most DR_KMAX), each long enough for its share in rows of two
// DR_SPX apart along it, DR_SPZ either side of its top, DR_ENDS clear of
// each end, in whole cells of DR_SEG m (DR_MMIN to DR_MMAX of them).
export const DR_KN = 2.5;
export const DR_KMAX = 8;
export const DR_SEG = 3;
export const DR_MMIN = 4;
export const DR_MMAX = 18;
export const DR_SPX = 2.6;
export const DR_SPZ = 1.3;
export const DR_ENDS = 4.5;
// A drum's shell: DR_N slats round, each a column of cells DR_SEG long. A
// cell is a slot from its tick on (u16 ticks into play, 0xffff never).
export const DR_N = 24;
// The spin: phases of DR_PH ticks (DR_NPH of them in the tables, the last
// running on), a drum's surface DR_V0 to DR_V0 + DR_VR m/s from the PRNG,
// times 1 + DR_VK a phase; neighbours opposite; as each phase after the
// first begins, one drum drawn from the PRNG reverses, seen DR_WARN ahead.
// DR_RT: 2^-32 turn a tick for a surface at 1 m/s; DR_U, m/s for one.
export const DR_PH = 750; // 6 s
export const DR_NPH = 16;
export const DR_V0 = 1.8;
export const DR_VR = 0.8;
export const DR_VK = 0.05;
export const DR_RT = 911420.4;
export const DR_U = 0.0000010971886;
export const DR_WARN = 125; // 1 s
// The slots: a cell opens with chance DR_SLOTF, at a tick from DR_SLOT0 to
// the round's end (uniform: as many each second, and the faster the drums
// the more often each comes round), and only once it's round under its drum (its middle 0.3 to 0.7 turn from the
// top, DR_LO to DR_HI in 2^-32 turn): so it comes up the far side and over
// the top, never opening under a ball.
export const DR_SLOT0 = 375; // 3 s
export const DR_SLOTF = 0.3;
export const DR_LO = 1288490189;
export const DR_HI = 3006477107;
// A ball on a drum: the round's knobs (a quicker grip than bumper's, so a
// drum carries what stands on it), its drag relative to the surface, a share
// of gravity down the slope, kept on as it rolls over (within DR_SNAP);
// off it, held out of the shells (bouncing DR_E), and into a slot past
// DR_IN of its radius it's gone (PF_FALL).
export const DR_ACC = 1.5;
export const DR_DRAG = 0.985; // keys held: 8.8 m/s flat out over the surface
export const DR_IDLE = 0.97; // no keys: still on the surface in about 0.3 s
export const DR_HOP = 7.5; // a hop clears a slot and, flat out, a gap
export const DR_GRAV = 0.4;
export const DR_SNAP = 0.12;
export const DR_E = 0.2;
export const DR_IN = 0.5;
// Its header, byte offsets in PG_H (112 B, in the prediction's copy).
export const DR_K = 0; // u32 drums
export const DR_M = 4; // u32 cells along each
export const DR_X0 = 8; // f32 the drums' near end, x
export const DR_X1 = 12; // f32 their far end
export const DR_Z0 = 16; // f32 the first drum's axis, z
export const DR_YA = 20; // f32 the axes' height
// In PG_S: i32 [DR_KMAX][DR_NPH] each drum's angle as each phase begins
// (2^-32 turn from the top toward +z, so a growing angle moves its top
// toward +z), and its spin a tick through it; f32 [DR_KMAX] its base speed;
// u16 per slot the tick into play it started going out, plus 1 (over's).
export const DR_ANG = 0;
export const DR_RATE = 512;
export const DR_BASE = 1024;
export const DR_FELL = 1056;
// In PG_BIG: u16 [DR_KMAX][DR_MMAX][DR_N] the tick each cell opens, by
// drum, cell along x and slat round (from the drum's angle 0).
export const DR_CELLS = 0;
// FX kinds, FX_MG + 4 * MG_DRUMS + k: 104 to 107.
export const DR_FX_WARN = 104; // a drum reverses in DR_WARN: shot the drum, at its top's middle, size the ticks
export const DR_FX_FLIP = 105; // it reverses: shot the drum, at its top's middle, size its surface's new speed (m/s, + toward +z)
export const DR_FX_FAST = 106; // a phase begins: shot the phase, at the centre, size the fastest surface (m/s)
export const DR_FX_DROP = 107; // a ball drops through a slot: owner the ball, shot the drum, at the ball
