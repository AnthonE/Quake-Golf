// TERRITORIES (M_TERRITORY, prefix tr): every hill point of the map
// (MAP_HILLS) is a territory, all of them up at once, a circle of TR_R with a
// height band of TR_H as King of the Hill's. A side with more live fighters
// on one than the other pushes its capture toward itself, a tick a tick (as
// many each: it holds still; nobody on it: it drifts back toward its
// holder's end, or a nobody's toward neutral), TR_CAP of them to take a
// neutral one; one taken stays its side's until the other side pushes it
// back to neutral, and only then can take it. Every TR_POINT ticks of play a
// side scores a point for each territory it holds; a fighter's MR_POINTS is
// its whole seconds on territories its side held. TR_TARGET points win; the
// most at the clock wins. Spawns aren't barred.
export const TR_TARGET = 300; // points: holding half of Box Canyon's six, 200 s
export const TR_CAP = 625; // ticks of more of you on it to take a neutral territory: 5 s (twice that to turn one of theirs)
export const TR_POINT = 250; // ticks of play between points: 2 s
export const TR_SEC = 125; // ticks a second, for a fighter's seconds on its side's territories
export const TR_R = '5'; // a territory's radius, m: feet strictly within it across count
export const TR_H = '2'; // and strictly within this up or down of its point's feet height (a roof and the room under it are 4.8 m apart)
// Its news, FX_MODE with these as size (MX_AM + 8 * 5 ..), owner 255 (nobody),
// at the territory's centre, shot the side (1 red, 2 blue) + 4 x its index.
export const TR_MX_TAKE = 56; // a side took a neutral territory: the side that took it
export const TR_MX_LOSE = 57; // a side's territory was pushed back to neutral: the side that lost it
// Its state in AO, byte offsets:
export const TR_N = 0; // u32 how many territories: MAP_NHILL
export const TR_HELD = 4; // u32 x 2: how many each side holds, red's then blue's, as of this tick
export const TR_T = 16; // the territories, in the map's order, TR_TSIZE bytes each:
export const TR_TSIZE = 32;
export const TR_X = 0; // f32 x, y, z: its centre, y its point's feet height ($stand with its top)
export const TR_Y = 4;
export const TR_Z = 8;
export const TR_GAUGE = 12; // i32 its capture: TR_CAP red's end, -TR_CAP blue's, 0 neutral
export const TR_HOLD = 16; // u32 who holds it: 0 nobody, 1 red, 2 blue
export const TR_ON = 20; // u16 x 2: each side's live fighters on it this tick, red's then blue's
export const TR_AT = 272; // u8 x NPLAYER: the territory each slot stood on this tick, + 1 (0: none, dead, or out)
export const TR_SIZE = 528;
