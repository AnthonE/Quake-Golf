// HEADHUNTER (M_HEADHUNT, prefix hh): every death drops the skulls its
// fighter carried and one more, in a pile at its feet; anyone, either side,
// takes a pile by touching it, and keeps its guns. One drop zone at a time,
// at one of the map's hill points (MAP_HILLS), moving every HH_MOVE: a
// carrier standing in it banks every skull it holds, a point each for its
// side and for itself. A pile left HH_LIFE vanishes. The target is HH_PER a
// fighter on the larger side as play starts, at least HH_MIN; the most at the
// clock wins.
export const HH_MIN = 25;
export const HH_PER = 3;
export const HH_MOVE = 5625; // ticks a zone lasts: 45 s
export const HH_LIFE = 3750; // ticks a pile lies before it's gone: 30 s
export const HH_TOUCH_R = '1.5'; // m across (and HH_TOUCH_H up or down) to take a pile
export const HH_TOUCH_H = '2';
export const HH_ZONE_R = '4'; // the zone's radius, m (and HH_ZONE_H up or down of its point)
export const HH_ZONE_H = '2';
// Its news, FX_MODE with these as size (MX_AM + 8 * 4 ..).
export const HH_MX_BANK = 48; // owner banked shot skulls
export const HH_MX_MOVE = 49; // the zone moved: owner 255, shot its index in MAP_HILLS
