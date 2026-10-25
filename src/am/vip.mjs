// VIP (M_VIP, prefix vp): each side has a VIP, drawn from its live fighters
// as play starts and VP_REDRAW after its VIP dies or leaves (another fighter
// if the side has one alive), with an overshield (OVERSHIELD) as it's drawn.
// Killing the other side's VIP scores a point for your side, and one for you
// (MR_POINTS); a VIP's death by its own hand scores for the other side; any
// other kill scores nothing. VP_TARGET points win; the most at the clock wins.
export const VP_TARGET = 10;
export const VP_REDRAW = 375; // ticks after a VIP dies or leaves before its side's next is drawn: 3 s
// The VIPs, in AO (byte offsets from it), red's then blue's, all zero until play starts:
// u16s, as slot + 1 runs to NPLAYER (256):
export const VP_VIP = 0; // u16 x 2: each side's VIP, its slot + 1 (0: none now)
export const VP_LAST = 4; // u16 x 2: each side's last VIP, slot + 1 (a draw passes over it if anyone else is alive)
export const VP_LEFT = 8; // u16 x 2: ticks before a side with no VIP draws its next (0: as soon as one is alive)
// Its news, FX_MODE with these as size (MX_AM + 8 * 6 ..), at the VIP's feet:
export const VP_MX_DRAW = 64; // owner is its side's VIP now: shot its side (0 red, 1 blue)
export const VP_MX_KILL = 65; // owner killed a VIP: shot the VIP's slot, + 256 for blue's (owner == the VIP: by its own hand)
export const VP_MX_GONE = 66; // owner, its side's VIP, left the room: shot its side
