// BULLSEYE (MG_BULLSEYE, prefix be): an icy disc over the sea with a target
// painted in its middle, the house: the bull and three rings. Every BE_END
// the bell rings an end: every ball then in the house scores by its ring
// (BE_PTS, twice that the last BE_DOUBLE ends), and a shove wave runs out
// from the middle and slides the house clear for the next. The ice barely
// grips, a bump kicks harder the harder it hits, and a ball off the edge
// is down BE_RESPAWN and back at the rim. Most points after BE_ENDS ends wins.
// Literal numbers only: the sim reads them through layout.mjs's MG_CONSTS,
// the client imports this file itself.
// The house: the bull and the three rings out from the middle, m, all times
// the house's scale, the root of the balls in times BE_HS (at least 1, so up
// to 64 balls play these sizes; 256 play them twice as big).
export const BE_R1 = 1.5; // the bull
export const BE_R2 = 4; // the red ring
export const BE_R3 = 7; // the white
export const BE_R4 = 10; // the blue: the house's edge
export const BE_HS = 0.125;
export const BE_PTS = [5, 3, 2, 1]; // what a ball in the bull, the red, the white, the blue scores at a bell
// The ice: the house's edge plus BE_M0 plus BE_MK times the root of the balls in, at most BE_RMAX.
export const BE_M0 = 8;
export const BE_MK = 1;
export const BE_RMAX = 52;
export const BE_SPAWN = 2; // balls start on a spiral from this far past the house's edge to this far in from the ice's; back at the rim this far in
// How the ice rolls (PG_ACC, PG_DRAG, PG_IDLE): 5 m/s^2 of push, 10 m/s flat
// out after 2 s; let go at 10 m/s and a ball slides 16 m.
export const BE_ACC = 0.45;
export const BE_DRAG = 0.996;
export const BE_IDLE = 0.995;
// The bumps: bumper's without its flat kick (PGF_NOKICK: elastic), and a
// hard one (the two meeting at BE_KMIN m/s or more) kicked BE_KICKK times
// that speed more apart, at most BE_KMAX, shared by weight as bumper's is:
// a ram throws a ball a long way across the ice. Neither ball of a pair is
// kicked again for BE_KGAP ticks, so a crowd leaning on itself doesn't
// feed its own kicks back.
export const BE_KMIN = 2;
export const BE_KICKK = 0.8;
export const BE_KMAX = 10;
export const BE_KGAP = 32; // 0.256 s
export const BE_RESPAWN = 188; // ticks a ball that slid off waits: 1.5 s
// The ends.
export const BE_END = 1250; // ticks an end: 10 s
export const BE_ENDS = 9;
export const BE_LEN = 11250; // BE_ENDS * BE_END: the last bell ends the round
export const BE_DOUBLE = 3; // the last three ends score double
export const BE_WARN = 250; // the last 2 s before a bell the rings pulse and a count shows (the page's)
// The shove wave: from the tick after a bell, a front runs out from the middle
// BE_WAVEDT m a tick (30 m/s); every ball within BE_BAND inside it, and no
// further out than BE_CLR past the house's edge, is sent out at least
// BE_WK (the house's edge + BE_WM - its distance out) m/s, enough to slide
// past the edge, and popped up BE_POP m/s off the ice.
export const BE_WAVEDT = 0.24;
export const BE_BAND = 1.2;
export const BE_CLR = 0.5;
export const BE_WK = 0.75;
export const BE_WM = 3;
export const BE_POP = 2;
// Its header, byte offsets in PG_H (112 B, in the prediction's copy).
export const BE_RAD = 0; // f32 the ice's radius
export const BE_RING = 4; // f32 x 4: the bull's radius and the three rings', scaled, at 4, 8, 12, 16
// In PG_S: u32 a slot, the HDR_TICK its last kick was given on.
export const BE_KAT = 0;
// A ball's PG_M, written as a bell scores it (a ball that scores nothing
// keeps its last): the end << 16 | its ring (1 the bull .. 4 the blue) << 8 | its points.
// FX kinds, FX_MG + 4 * MG_BULLSEYE + k.
export const BE_FX_BELL = 124; // the bell, at the middle: shot the end (1..), owner the first by slot of its best (255 none), size the balls that scored
export const BE_FX_BULL = 125; // a ball in the bull at a bell: owner the slot, shot the end, size its points, at the ball
