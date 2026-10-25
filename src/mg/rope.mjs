// JUMP ROPE (MG_ROPE, prefix jr): a long stage over the sea, a turner at
// either end and a rope between them going round the stage's long axis,
// overhead on one side and along the floor at ball height on the other.
// Hop it as it comes under: a rope that meets a ball not high enough knocks
// it hard the way the rope is going and up, often off the stage. Faster as
// it goes; from 30 s a second rope half a turn behind the first (double
// dutch), from 60 s the turners switch direction now and then, from 70 s
// the stage's ends crumble in. Off it and you're out; the last ball on wins.
// Literal numbers only: the sim reads them through layout.mjs's MG_CONSTS,
// the client imports this file itself.
// The stage: its long axis along x through the centre, JR_HW either side of
// it across; long enough for the balls in rows of JR_ROWS, JR_SP apart
// along it, with JR_END past the first and last, JR_HLMIN either way at least.
export const JR_HW = 4.25; // m from the middle line to either side: a ball's centre past it is off
export const JR_ROWS = 3; // balls start in rows of three across: the middle line, then either side
export const JR_ROWW = 2.4; // m from the middle line to the side rows
export const JR_SP = 2.5; // m between balls along the stage
export const JR_END = 5; // m of stage past the first and last balls
export const JR_HLMIN = 10; // m the stage reaches either way from the centre, at least
export const JR_XT = 3; // m past the stage's ends the rope reaches, at the turners' cranks
export const JR_LEN = 11250; // 90 s
export const JR_HOP = 7; // hop speed, m/s: a ball's bottom 1.2 m up, 0.69 s in the air
export const JR_IDLE = 0.98; // rolling drag a tick with no keys: from 10 m/s to a stop in about 4 m
// The rope: a line along x, JR_RW thick either side of its centre, which
// turns JR_RR round an axle JR_AY over the floor, so at the bottom of its
// turn it is JR_BY over the floor. A ball touches it within its radius plus
// JR_RW: on the floor at the middle line, within 0.83 m of it across; a hop
// clears it there once the ball's bottom is 0.4 m up, and on up to 4 m from
// the line (out at the sides it comes in at the ball's height).
export const JR_RR = 12;
export const JR_BY = 0.2;
export const JR_AY = 12.2; // JR_RR + JR_BY
export const JR_RW = 0.2;
export const JR_JBAND = 3.5; // the rope sweeping past a ball whose centre is within this inside its circle, clear of it: a jump
// The first rope's angle in 2^-24 turn, 0 at the bottom (the second's half
// a turn on), rising as it goes from -z through the bottom to +z. Still,
// overhead, for JR_GRACE ticks; then JR_S1 a tick (a turn in 1.8 s) and
// JR_K1 more each tick (a turn in 0.91 s by 30 s). On the first tick from
// JR_T2 that it passes the bottom, the second joins at the top, and the two
// turn JR_S2 a tick (a turn in 2 s) and JR_K2 more each tick from then (a
// turn in 1.5 s by 90 s).
export const JR_GRACE = 250; // 2 s
export const JR_S1 = 74565;
export const JR_K1 = 21;
export const JR_T2 = 3750; // 30 s
export const JR_S2 = 67109;
export const JR_K2 = 3;
export const JR_TMAX = 60000; // ticks the schedule runs to (it holds still past it)
export const JR_RAD_TICK = 0.00004681338; // rad/s for a speed of one (2^-24 turn a tick)
// The switches: from JR_TR0 + (a seed mod JR_RN0), on the first tick the
// first rope passes a side (both ropes level with the axle, high over the
// sea), the turners hold it there JR_PA + (a seed mod JR_PN) ticks and turn
// it back the other way; the next JR_RA + (a seed mod JR_RN) ticks after;
// JR_NREV at most, none ending past the clock. Each called JR_WARN ahead.
export const JR_TR0 = 7500; // 60 s
export const JR_RN0 = 250;
export const JR_PA = 40; // 0.32 to 0.71 s
export const JR_PN = 50;
export const JR_RA = 625; // 5 to 8 s apart
export const JR_RN = 375;
export const JR_NREV = 4;
export const JR_WARN = 250; // 2 s
// A ball the rope knocks goes across at JR_KZ0 plus JR_KZK times the
// rope's speed (at most JR_KZMAX), the way the rope goes, and JR_UP up.
export const JR_KZ0 = 6;
export const JR_KZK = 0.08;
export const JR_KZMAX = 14;
export const JR_UP = 6;
// The ends: from JR_TC0, every JR_TCI ticks a step of the stage drops at
// either end, shaking and red for JR_CWARN ticks before; JR_STEPS of them
// take JR_CUT of its reach.
export const JR_TC0 = 8750; // 70 s
export const JR_TCI = 500; // 4 s: the last at 86 s
export const JR_STEPS = 5;
export const JR_CUT = 0.6;
export const JR_CWARN = 250; // 2 s
export const JR_KSEED = 0x4a52; // $p_seed keys: this, the way it turns; + 1 the first switch; + 16 + k switch k's hold; + 32 + k the gap after it
// Its header, byte offsets in PG_H (112 B, in the prediction's copy).
export const JR_HL = 0; // f32 the stage's reach either way along it at the start (PG_SIZE)
export const JR_NSEG = 4; // u32 the schedule's segments
export const JR_TD = 8; // u32 the tick into play the second rope joins (its speed's origin)
export const JR_SEG = 16; // the schedule, 8 B a segment, in order of the tick into play it starts:
export const JR_NSEGMAX = 12; // u16 that tick, u8 its law (0 still, 1 one rope's, 2 double dutch's), i8 the way (1, -1), i32 the first rope's angle then
// PG_M: the jumps this round (the rope sweeping past it, clear) in the low
// 16 bits, the times it was knocked in the high 16.
// In PG_S: u16 per slot, the tick into play it started going out, plus 1 (0 not yet: over's).
export const JR_FELL = 0;
// FX kinds, FX_MG + 4 * MG_ROPE + k.
export const JR_FX_HIT = 132; // the rope knocks a ball: owner the ball, shot the rope (0, 1), at the ball, size how hard (m/s)
export const JR_FX_CALL = 133; // coming: shot 1 the second rope, 2 a switch; at the centre, size the ticks till
export const JR_FX_GO = 134; // the rope sets off: shot 0 the first, 1 double dutch, 2 the other way; at the centre, size its rad/s
export const JR_FX_END = 135; // the ends: shot 0 shaking, 1 gone; at the centre, size the reach they leave
