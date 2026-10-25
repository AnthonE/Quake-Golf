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
// Its state in AO, byte offsets: a record of CF_FSIZE B for each flag, k 0
// red's and 1 blue's, at CF_FLAG + CF_FSIZE * k. All 0 until play starts.
export const CF_FLAG = 0;
export const CF_FSIZE = 32;
export const CF_POS = 0; // f32 x, y, z: where it is (carried: its carrier's feet)
export const CF_STATE = 12; // u8 CF_HOME, CF_CARRIED or CF_DROPPED
export const CF_BY = 13; // u8 its carrier's slot (carried; dropped, the one who dropped it)
export const CF_LEFT = 14; // u16 a dropped flag's ticks to lie: CF_RETURN as it drops, one off every tick of play, home on the tick that finds 0 (CF_RETURN after the drop's)
export const CF_STAND = 16; // f32 x, y, z: its stand, MAP_FLAGS' point resolved by $stand as play starts
export const CF_HOME = 0;
export const CF_CARRIED = 1;
export const CF_DROPPED = 2;
// Its news, FX_MODE with these as size (MX_AM + 8 * 1 ..): owner the fighter
// (255 nobody), shot the flag's side (0 red's, 1 blue's), at where the flag
// was as it happened (a capture at the carrier's feet, before it goes home).
export const CF_MX_TAKE = 24; // owner took it, from its stand or where it lay
export const CF_MX_CAP = 25; // owner captured it
export const CF_MX_RETURN = 26; // owner, of its own side, sent it home from where it lay
export const CF_MX_HOME = 27; // it lay CF_RETURN and went home by itself: owner 255
export const CF_MX_DROP = 28; // owner, its carrier, died or left: it lies here
