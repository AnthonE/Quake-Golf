// ASSAULT (M_ASSAULT, prefix as): one bomb, at the map's mid spot
// (MAP_BALL). Either side takes it by touching it and carries it as the skull
// is carried (PF_CARRY: no guns, a swing that kills). A carrier standing
// within AS_PLATE_R of the other side's stand (MAP_FLAGS, its plate) for
// AS_ARM ticks in a row plants it there; a planted bomb goes off AS_FUSE
// later, a point for the side that planted it and for its planter, and kills
// the other side's fighters within AS_BLAST_R, unless one of the plate's own
// side stands on it AS_DEFUSE ticks in a row first. A carrier who dies or
// leaves drops it; left alone AS_RETURN it goes back to the middle, as it
// does after it goes off or is defused. AS_TARGET points win; the most at the
// clock wins.
export const AS_TARGET = 3;
export const AS_ARM = 375; // ticks in a row on their plate to plant: 3 s
export const AS_FUSE = 625; // ticks a planted bomb burns: 5 s
export const AS_DEFUSE = 250; // ticks in a row on it to defuse: 2 s
export const AS_RETURN = 1875; // ticks a dropped bomb lies before it goes back: 15 s
export const AS_TOUCH_R = '1.5'; // m across (and AS_TOUCH_H up or down) to take it, or to stand on it planted
export const AS_TOUCH_H = '2';
export const AS_PLATE_R = '2.5'; // m across from their stand (and AS_TOUCH_H up or down) to plant
export const AS_BLAST_R = '5'; // m across (and AS_BLAST_H up or down) its blast kills: the room round a stand, not the roof over it
export const AS_BLAST_H = '3';
// The bomb, in AO (byte offsets from it), all zero until play starts:
export const AS_POS = 0; // f32 x, y, z: where it is (its carrier's feet while carried; planted, its plate's stand)
export const AS_STATE = 12; // u8 AS_HOME, AS_CARRIED, AS_DROPPED or AS_PLANTED
export const AS_BY = 13; // u8 its carrier; dropped, who dropped it; planted, its planter
export const AS_LEFT = 14; // u16 dropped: ticks before it goes back; planted: before it goes off (on the tick that takes this to 0)
export const AS_SPOT = 16; // f32 x, y, z: the middle, MAP_BALL at its feet height
export const AS_SIDE = 28; // u8 the side that took it (0 red, 1 blue): carrying it, or that planted it
export const AS_GONE = 29; // u8 planted: 1 once its planter has left (a slot can't say it: 255 is a fighter)
export const AS_ARMING = 30; // u16 its carrier's ticks in a row on their plate
export const AS_DEFUSING = 32; // u16 planted: ticks in a row with one of the plate's side on it
export const AS_PLATE = 36; // f32 x, y, z x 2: red's plate then blue's, MAP_FLAGS' stands at their feet height
export const AS_SIZE = 60;
export const AS_HOME = 0; // AS_STATE: in the middle
export const AS_CARRIED = 1;
export const AS_DROPPED = 2;
export const AS_PLANTED = 3; // on the plate of the side AS_SIDE isn't
// Its news, FX_MODE with these as size (MX_AM + 8 * 7 ..), at the bomb as it
// happens: owner who did it (255 nobody), shot a side (0 red, 1 blue).
export const AS_MX_TAKE = 72; // owner took it: shot its side
export const AS_MX_PLANT = 73; // owner planted it at the other side's plate: shot its side
export const AS_MX_BOOM = 74; // it went off: owner who planted it, shot the side scoring
export const AS_MX_DEFUSE = 75; // owner defused it: shot its side, the plate's
export const AS_MX_DROP = 76; // owner, its carrier, died or left: shot the side that had it
export const AS_MX_HOME = 77; // it lay AS_RETURN and went back to the middle: owner 255, shot the side that had it
export const AS_MX_LONE = 78; // it went off, its planter gone (AS_GONE): owner 255, shot the side scoring
