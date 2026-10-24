// TAG (MG_TAG, prefix tg): infection on a walled disc of bouncy pillars. A
// few balls start it; an it that touches a free ball makes it it too. A
// free ball scores a point a second and holds a spring (bumper's SPRING)
// handed out every TG_GIVE ticks; an it rolls a little faster. Nobody falls:
// the rim and the pillars bounce. Catch the last one free and you win with a
// point over it; at the clock the free share the win.
export const TG_R0 = 16; // the arena: 16 m plus TG_RK times the root of the balls in, at most TG_RMAX
export const TG_RK = 3;
export const TG_RMAX = 72;
export const TG_LEN = 11250; // 90 s
export const TG_PER = 16; // one it for every TG_PER balls, rounded, and at least one of two or more
export const TG_ITR = 0.16; // the its start on a spiral over this much of the radius, in the middle
export const TG_FIN = 0.4; // the free start on a spiral over the ring from TG_FIN to TG_FOUT of the radius
export const TG_FOUT = 0.92;
export const TG_BOOST = 0.0053; // m/s an it's keys add a tick on the ground on top of the roll: 6%, 10.6 m/s flat out
export const TG_TOUCH = 0.2; // m between two balls' skins that still counts as a touch
export const TG_FRESH = 125; // ticks an it can't tag after it tags or is tagged (and the first second of play)
export const TG_SEC = 125; // ticks a point, free
// The pillars: TG_PH tall (a spring clears 4.2 m: none), one for every TG_PAREA m^2 of
// arena (at most TG_PMAX), on a sunflower over the ring from TG_PIN to TG_POUT
// of the radius, clear of the middle where the its start.
export const TG_PR = 1.3;
export const TG_PH = 4.6;
export const TG_PAREA = 55;
export const TG_PMAX = 64;
export const TG_PIN = 0.3;
export const TG_POUT = 0.84;
export const TG_PE = 0.8; // a pillar's bounce: the speed into it comes back this much
export const TG_KICK = 3; // m/s more off a pillar hit harder than TG_KMIN
export const TG_KMIN = 2;
export const TG_WE = 0.5; // the rim's bounce
// Springs to the free: the first TG_GIVE0 ticks into play, then every TG_GIVE, to every free ball holding none.
export const TG_GIVE0 = 250; // 2 s
export const TG_GIVE = 1250; // 10 s
// Its header, byte offsets in PG_H.
export const TG_RAD = 0; // f32 the arena's radius
export const TG_NP = 4; // u32 pillars
export const TG_NIT = 8; // u32 its dealt at the start
// In PG_S: who starts it, by slot (for the countdown) and by spawn index;
// where each spawn index starts; the pillars.
export const TG_ROLE = 0; // u8 per slot: 1 starts it
export const TG_IDX = 256; // u8 per spawn index: 1 it
export const TG_SPOT = 512; // 256 x 8 B: f32 x, z
export const TG_PILL = 2560; // TG_PMAX x 8 B: f32 x, z
// PG_M, a ball's own: TG_M_IT it, TG_M_IN in the round (marked at the start, or
// as it joins in play: a newcomer is it), and above bit 8 the tick into play
// of its last tag, made or taken.
export const TG_M_IT = 1;
export const TG_M_IN = 2;
// FX kinds, FX_MG + 4 * MG_TAG + k.
export const TG_FX_TAG = 84; // a ball made it: owner the ball, shot the tagger (255 joined in play, 254 dealt when the its had all gone)
//                              | the free left << 8, at the ball's centre, size its points (its seconds free)
