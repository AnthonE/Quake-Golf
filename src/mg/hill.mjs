// KING OF THE HILL (MG_HILL, prefix kh): a grassy disc, and on it a hill that
// swells out of the ground (two from KH_N2 balls, three from KH_N3, so a
// crowd has room); a hill's top is the zone, a point a tick for every ball on
// the ground in it, two on the very top, and it shrinks as it goes. Every
// KH_PERIOD the zone moves: the next hills swell KH_RISE ahead where the next
// zone will be, and the old ones sink back after. A hill's slope pulls a
// rolling ball down it. Off the disc and you're down KH_RESPAWN; most points
// at the end wins.
export const KH_R0 = 14; // the disc: 14 m plus KH_RK times the root of the balls in, at most KH_RMAX
export const KH_RK = 2.6;
export const KH_RMAX = 56;
export const KH_Z0 = 3.6; // a zone as it opens: 3.6 m plus KH_ZK times the root of the balls in
export const KH_ZK = 0.5;
export const KH_TOPK = 0.25; // the top (two points a tick): this much of the zone's radius, so in a small room one ball holds it
export const KH_SHRINK = 0.4; // a zone's radius shrinks by this much of itself over its KH_PERIOD
export const KH_FOOT = 2; // a hill's foot, round its zone: twice the zone's radius
export const KH_HIGH = 0.19; // a hill's height over its foot's radius: a 30 degree slope at the foot
// A hill is the top of an upright ellipsoid sunk half its height into the
// floor, its half extents F / sqrt(0.75) across and 2 h up for a foot F and a
// height h: it swells and sinks by h alone, its foot fixed.
export const KH_PULL = 0.08; // the slope's pull, m/s a tick at a slope of 1: 10 m/s^2 of gravity along it
export const KH_SNAP = 0.15; // m: a ball this close over the ground and not rising is on it (over a crest, on a sinking hill)
export const KH_PERIOD = 1875; // ticks a zone lasts: 15 s
export const KH_ZONES = 6;
export const KH_LEN = 11250; // KH_ZONES * KH_PERIOD: 90 s
export const KH_RISE = 375; // ticks a hill takes to swell (before its zone opens) and to sink (after): 3 s
export const KH_RESPAWN = 250; // ticks a ball that fell waits: 2 s
export const KH_HMAX = 3; // hills a zone at most
export const KH_N2 = 48; // two hills a zone from this many balls in
export const KH_N3 = 128; // three from this many
export const KH_SPREAD = 0.85; // a zone's hills stand round the middle this far apart in feet, at least: a little overlap at most
export const KH_TRIES = 8; // spots tried for each zone after the first: the one farthest from the last zone's hills
export const KH_LEADGAP = 125; // ticks between two KH_FX_LEAD: a tight race doesn't flood the ring
export const KH_ORB_AT = 500; // ticks into a zone a power-up drops onto each of its tops (4 s), from KH_ORB_Y over it at bumper's ORB_FALL
export const KH_ORB_Y = 20; // m: it lands 2 s later, 6 s into the zone
// Its power-ups, by $rand % 8: POW three in eight (it clears a top), MEGA three (it holds one), DASH and SPRING one each
export const KH_PU = [3, 3, 3, 1, 1, 1, 2, 5];
// Its header, byte offsets in PG_H.
export const KH_RAD = 0; // f32 the disc's radius
export const KH_Z = 4; // f32 a zone's radius as it opens
export const KH_TOP = 8; // f32 the top's radius
export const KH_F = 12; // f32 a hill's foot's radius
export const KH_H = 16; // f32 a hill's height, risen
export const KH_IA2 = 20; // f32 1 / A^2, A the ellipsoid's half width: 0.75 / F^2
export const KH_NH = 24; // u32 hills a zone, 1 to KH_HMAX
export const KH_LEAD = 28; // u32 the slot with the most points (255 none): the crown over its rider
export const KH_LEADT = 32; // u32 ticks into play of the last KH_FX_LEAD
// i16 x, z of zone k's hill i from the stage's centre, in 1/64 m, at
// KH_SPOT + 4 (k KH_HMAX + i): KH_ZONES * KH_HMAX of them (to 108)
export const KH_SPOT = 36;
// In PG_S, where the round's balls start (the confirmed world's, for the layout):
export const KH_SN = 0; // u32 the balls laid out for
export const KH_SK = 4; // u32 the spots found for them
export const KH_SPAWN = 8; // f32 x, z of each, to 8 + 8 * 256
// The power-ups on the open zone's tops, one a hill: f32 x, y (its centre), z | u8 PU_* (0 none) | u8 1 falling, 2 landed | u16 0
export const KH_ORBS = 2064;
// FX kinds, FX_MG + 4 * MG_HILL + k, owner 255 unless said.
export const KH_FX_NEXT = 60; // the next zone's hills start to swell: its first's spot, shot and size the zone (1..)
export const KH_FX_MOVE = 61; // a zone opens: its first hill's top, shot and size the zone (0..)
export const KH_FX_LEAD = 62; // a new leader: owner the slot, shot the last (255 none), size its points
export const KH_FX_ORB = 63; // a power-up drops: where it will land (the top), shot the hill, size its PU_*
