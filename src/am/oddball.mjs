// ODDBALL (M_ODDBALL, prefix ob): one skull at the map's spot (MAP_BALL). The
// first to touch it takes it, either side; every full second a side holds it
// is a point for the side and for its carrier. A carrier who dies drops it;
// left alone OB_RESET it goes back to its spot. OB_TARGET points win; the
// most at the clock wins.
export const OB_TARGET = 100;
export const OB_RESET = 1875; // ticks a dropped skull lies before it goes back: 15 s
export const OB_TOUCH_R = '1.5'; // m across (and OB_TOUCH_H up or down) to take it
export const OB_TOUCH_H = '2';
// Its news, FX_MODE with these as size (MX_AM + 8 * 2 ..).
export const OB_MX_TAKE = 32;
export const OB_MX_DROP = 33;
export const OB_MX_RESET = 34;
