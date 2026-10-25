// HEADHUNTER (M_HEADHUNT, prefix hh): every death drops the skulls its
// fighter carried and one more, in a pile at its feet; anyone, either side,
// takes a pile by touching it, and keeps its guns. One drop zone at a time,
// at one of the map's hill points (MAP_HILLS, the hill's own radius), moving
// every HH_MOVE: a fighter standing in it banks every skull it carries, a
// point each for its side and for itself. A pile left HH_LIFE vanishes. The
// target is HH_PER a fighter on the larger side as play starts, at least
// HH_MIN; the most at the clock wins.
export const HH_MIN = 40;
export const HH_PER = 5;
export const HH_MOVE = 5625; // ticks a zone lasts: 45 s
export const HH_LIFE = 3750; // ticks a pile lies untouched before it's gone: 30 s, from the tick it's laid or added to
export const HH_TOUCH_R = '1.5'; // m across (and HH_TOUCH_H up or down) to take a pile
export const HH_TOUCH_H = '2';
export const HH_MERGE_R = '2'; // m across (and HH_TOUCH_H up or down) from a pile a death adds to it instead of laying its own
export const HH_ZONE_H = '2'; // m up or down of the zone's point a fighter's feet may be and bank (a roof and the room under it are 4.8 m apart)
// Its news, FX_MODE with these as size (MX_AM + 8 * 4 ..).
export const HH_MX_BANK = 48; // owner banked shot skulls, at its feet
export const HH_MX_MOVE = 49; // the zone moved: owner 255, shot its index in MAP_HILLS, at its centre
export const HH_MX_TAKE = 50; // owner took a pile of shot skulls, at the pile
// Its state in AO, byte offsets:
export const HH_AT = 0; // u32 the zone now: its index in MAP_HILLS
export const HH_MOVES = 4; // u32 the tick it moves on
export const HH_X = 8; // f32 x, y, z: its centre, y its point's feet height ($stand with its top)
export const HH_Y = 12;
export const HH_Z = 16;
export const HH_R = 20; // f32 its radius (the hill's)
export const HH_PILES = 32; // HH_NPILE piles of HH_PILE_SIZE B: f32 x, y, z (where it lies) | u16 skulls (0: none) | u16 ticks to go
export const HH_NPILE = 30;
export const HH_PILE_SIZE = 16;
// u16 x 256, to AO's end: the skulls each slot carries, MR_AUX's twin. A
// join clears the record, so this copy is what says a slot that left (and
// was perhaps taken again on the same tick) had skulls to drop.
export const HH_CARRY = 512;
