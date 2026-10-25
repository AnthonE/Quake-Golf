// KING OF THE HILL (M_HILL, prefix hl): one hill at a time, a circle at one of
// the map's hill points (MAP_HILLS), the first drawn as play starts, then the
// map's order (it lists them alternating sides), moving every HL_MOVE. The
// side with more fighters on it holds it (as many each: contested, nobody);
// every full second a side holds it is a point for the side and for each of
// its fighters on it. HL_TARGET points win; the most at the clock wins.
export const HL_TARGET = 100;
export const HL_MOVE = 7500; // ticks a hill lasts: 60 s
export const HL_H = '2'; // m up or down of the hill's point a fighter's feet may be and count (a roof and the room under it are 4.8 m apart)
export const HL_POINT = 125; // ticks a side holds it for a point: 1 s, counted per side, kept across a contest and a move
export const HL_NEWSGAP = 125; // ticks at least between two HL_MX_TAKE / HL_MX_CONTEST: a crowd on the rim doesn't flood the ring
// Its news, FX_MODE with these as size (MX_AM + 8 * 3 ..), owner 255 (nobody),
// at the hill's centre.
export const HL_MX_MOVE = 40; // the hill moved: shot its index (HL_AT)
export const HL_MX_TAKE = 41; // a side holds it that the news didn't last name: shot 1 red, 2 blue
export const HL_MX_CONTEST = 42; // it's contested, and the news didn't last say so: shot 3
// Its state in AO, byte offsets:
export const HL_AT = 0; // u32 the hill now: its index in MAP_HILLS
export const HL_MOVES = 4; // u32 the tick it moves on
export const HL_X = 8; // f32 x, y, z: its centre, y its point's feet height ($stand with its top)
export const HL_Y = 12;
export const HL_Z = 16;
export const HL_R = 20; // f32 its radius
export const HL_HOLD = 24; // u32 who holds it: 0 nobody, 1 red, 2 blue, 3 contested
export const HL_ON = 28; // u32 x 2: each side's live fighters on it this tick, red's then blue's
export const HL_HELD = 36; // u16 x 2: each side's ticks held toward its next point
export const HL_SAID = 40; // u32 who holds it as the news last said (HL_HOLD's codes; 0 as a hill comes up)
export const HL_SAIDAT = 44; // u32 the tick of that news
export const HL_SIZE = 48;
