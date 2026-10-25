// KING OF THE HILL (M_HILL, prefix hl): one hill at a time, a circle at one of
// the map's hill points (MAP_HILLS), moving every HL_MOVE in an order drawn as
// play starts. The side with more fighters on it holds it (as many each:
// contested, nobody); every full second held is a point for the side and for
// each of its fighters on it. HL_TARGET points win; the most at the clock wins.
export const HL_TARGET = 100;
export const HL_MOVE = 7500; // ticks a hill lasts: 60 s
export const HL_H = '3'; // m up or down of the hill's point a fighter's feet may be and count
// Its news, FX_MODE with these as size (MX_AM + 8 * 3 ..).
export const HL_MX_MOVE = 40;
export const HL_MX_TAKE = 41;
export const HL_MX_CONTEST = 42;
