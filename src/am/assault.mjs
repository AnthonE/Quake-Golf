// ASSAULT (M_ASSAULT, prefix as): one bomb, at the map's mid spot
// (MAP_BALL). Anyone takes it by touching it and carries it as the skull is
// carried (PF_CARRY: no guns, a swing that kills). A carrier standing within
// AS_PLATE_R of the other side's stand (MAP_FLAGS) for AS_ARM plants it
// there; a planted bomb goes off AS_FUSE later, a point for the side that
// planted it, unless one of the stand's own side stands on it AS_DEFUSE
// first. A carrier who dies drops it; left alone AS_RETURN it goes back to
// the middle, as it does after it goes off or is defused. AS_TARGET points
// win; the most at the clock wins.
export const AS_TARGET = 3;
export const AS_ARM = 375; // ticks on the plate to plant: 3 s
export const AS_FUSE = 625; // ticks a planted bomb burns: 5 s
export const AS_DEFUSE = 250; // ticks on it to defuse: 2 s
export const AS_RETURN = 1875; // ticks a dropped bomb lies before it goes back: 15 s
export const AS_TOUCH_R = '1.5'; // m across (and AS_TOUCH_H up or down) to take it, or to stand on it
export const AS_TOUCH_H = '2';
export const AS_PLATE_R = '2.5'; // m across from the stand to plant
// Its news, FX_MODE with these as size (MX_AM + 8 * 7 ..).
export const AS_MX_TAKE = 72; // owner took the bomb: shot its side, 1 red / 2 blue
export const AS_MX_PLANT = 73; // owner planted it
export const AS_MX_BOOM = 74; // it went off: owner who planted it, shot the side scoring, 1 / 2
export const AS_MX_DEFUSE = 75; // owner defused it
