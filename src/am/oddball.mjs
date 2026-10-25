// ODDBALL (M_ODDBALL, prefix ob): one skull at the map's spot (MAP_BALL). The
// first to touch it takes it, either side; every full second a side holds it
// is a point for the side and for its carrier. A carrier who dies drops it;
// left alone OB_RESET it goes back to its spot. OB_TARGET points win; the
// most at the clock wins.
export const OB_TARGET = 100;
export const OB_RESET = 1875; // ticks a dropped skull lies before it goes back: 15 s
export const OB_TOUCH_R = '1.5'; // m across (and OB_TOUCH_H up or down) to take it
export const OB_TOUCH_H = '2';
export const OB_POINT = 125; // ticks a side holds it for a point (1 s), counted per side across carriers
// The skull, in AO (byte offsets from it), all zero until play starts:
export const OB_POS = 0; // f32 x, y, z: where it is (its carrier's feet while carried)
export const OB_STATE = 12; // u8 OB_HOME, OB_CARRIED or OB_DROPPED
export const OB_CARRIER = 13; // u8 the slot carrying it (the last one that did, after)
export const OB_LEFT = 14; // u16 ticks before a dropped skull goes back to its spot
export const OB_SPOT = 16; // f32 x, y, z: its spot, MAP_BALL at its feet height
export const OB_HELD = 28; // u16 x 2: red's and blue's ticks held toward their next point
export const OB_SIDE = 32; // u8 the carrier's side as it took it (0 red, 1 blue)
export const OB_HOME = 0; // OB_STATE: at its spot
export const OB_CARRIED = 1;
export const OB_DROPPED = 2;
// Its news, FX_MODE with these as size (MX_AM + 8 * 2 ..), at the skull:
// owner who took or dropped it (255 nobody), shot that one's side.
export const OB_MX_TAKE = 32;
export const OB_MX_DROP = 33;
export const OB_MX_RESET = 34; // back at its spot: owner 255
