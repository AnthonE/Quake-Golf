// CAPTURE THE FLAG (M_CTF, prefix cf): a flag on each side's stand (MAP_FLAGS,
// red's then blue's). Touch theirs to take it; bring it to your own stand
// while yours is home to capture. A carrier who dies drops it; your own side
// returns a dropped flag by touching it, or it goes home by itself after
// CF_RETURN. CF_CAPS captures win; the most at the clock wins.
export const CF_CAPS = 3;
export const CF_RETURN = 2500; // ticks a dropped flag lies before it goes home: 20 s
export const CF_TOUCH_R = '1.5'; // m across (and CF_TOUCH_H up or down) to take or return a flag
export const CF_TOUCH_H = '2';
export const CF_CAP_R = '2.5'; // m across from your own stand to capture
// Its news, FX_MODE with these as size (MX_AM + 8 * 1 ..).
export const CF_MX_TAKE = 24;
export const CF_MX_CAP = 25;
export const CF_MX_RETURN = 26;
export const CF_MX_HOME = 27;
export const CF_MX_DROP = 28;
