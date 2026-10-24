// SWEEPER (MG_SWEEP, prefix sw): a round platform over the sea, a post in
// the middle and bars at ball height turning round it, out past the rim. A
// bar that meets a ball flings it on round, out and up; hop to let it pass
// under. One bar at first, another every 20 s (the bars stop a second and go
// the other way when one is added), all of them turning faster as the round
// goes; from SW_TR0 the rings of the platform drop one by one to SW_RMIN.
export const SW_R0 = 10; // the platform: SW_R0 m plus SW_RK times the root of the balls in, at most SW_RMAX
export const SW_RK = 3;
export const SW_RMAX = 56;
export const SW_RMIN = 9; // the platform once every ring has dropped
export const SW_LEN = 15000; // 120 s
export const SW_HOP = 7; // hop speed, m/s: a ball's bottom 1.2 m up, 0.7 s in the air
export const SW_IDLE = 0.98; // rolling drag a tick with no keys: from 10 m/s to a stop in about 4 m
export const SW_POST = 1.3; // the post's radius, m
export const SW_POSTH = 3; // its height over the floor
export const SW_SPAWN0 = 2.5; // balls start on a spiral from this far out from the post's side...
export const SW_SPAWN1 = 0.85; // ...to this much of the platform's radius,
export const SW_CLEAR = 1.7; // and at least this far across from the first bar, m (a ball on the floor touches it within 1.07)
// The bars: an axis SW_BY over the floor, SW_BW thick either side (a ball
// touches one within its radius plus SW_BW of the axis, so a ball's bottom
// clears it from SW_BY + SW_BW = 0.6 m up), reaching SW_OVER past the rim.
export const SW_BY = 0.35;
export const SW_BW = 0.25;
export const SW_OVER = 2;
// The bars' angle in 2^-24 turn, from the round's seed; they turn SW_S0 a
// tick at the round's start (0.8 rad/s), SW_SK more every tick (+0.59 rad/s
// every 100 s), still for the first SW_GRACE ticks and for SW_PAUSE ticks
// from each SW_TS, when bar k + 1 joins (seen coming SW_WARN ticks before)
// and they set off again the other way.
export const SW_S0 = 17089;
export const SW_SK = 2;
export const SW_GRACE = 250; // 2 s
export const SW_TS = [2000, 4500, 7000]; // 16 s, 36 s, 56 s: the second, third and fourth bars
export const SW_PAUSE = 125; // 1 s
export const SW_WARN = 250; // 2 s
export const SW_TMAX = 60000; // ticks the schedule runs to (it holds still past it)
export const SW_RAD_TICK = 0.00004681338; // rad/s for a speed of one (2^-24 turn a tick)
// The bars' order round the post: bar k at SW_QUARTER[k] quarter turns from
// the first (two opposite, then the quarters between: uneven gaps with three).
export const SW_QUARTER = [0, 2, 1, 3];
// A ball flung by a bar: on round at SW_KICK times the bar's speed where it
// met it plus SW_KICK0 (at most SW_VMAX), SW_OUT m/s more outward, SW_UP up.
export const SW_KICK = 1.3;
export const SW_KICK0 = 4;
export const SW_VMAX = 30;
export const SW_OUT = 3;
export const SW_UP = 5.5;
// The rings: from SW_TR0 every SW_TRI ticks the outermost of SW_RINGS even
// rings drops, shaking and red for SW_RWARN ticks before it goes.
export const SW_RINGS = 5;
export const SW_TR0 = 8250; // 66 s
export const SW_TRI = 875; // 7 s: the last at 94 s
export const SW_RWARN = 312; // 2.5 s
export const SW_KSEED = 0x5357; // $p_seed key for the first bar's angle and the way it turns
// Its header, byte offsets in PG_H.
export const SW_RAD = 0; // f32 the platform's radius at the start
export const SW_A0 = 4; // u32 the first bar's angle at the start, 2^-24 turn
export const SW_DIR = 8; // i32 1 or -1: the way the bars turn at first (1: x towards z)
// A ball's PG_M: the times a bar flung it this round.
// FX kinds, FX_MG + 4 * MG_SWEEP + k.
export const SW_FX_HIT = 40; // a bar flings a ball: owner the ball, shot the bar, at the ball, size how fast (m/s)
export const SW_FX_BEAM = 41; // a bar is coming: shot its number (1..3), at the centre, size the ticks till it moves
export const SW_FX_GO = 42; // the bars set off: shot the bars turning | 16 the other way from before, at the centre, size rad/s
export const SW_FX_RING = 43; // a ring: shot 0 shaking, 1 gone; at the centre, size the rim it leaves
