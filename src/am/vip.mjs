// VIP (M_VIP, prefix vp): each side has a VIP, drawn from its live fighters
// as play starts and VP_REDRAW after its VIP dies (another fighter if the
// side has one), with an overshield (OVERSHIELD) as it's drawn. Killing the
// other side's VIP scores a point for your side; any other kill scores
// nothing. VP_TARGET points win; the most at the clock wins.
export const VP_TARGET = 10;
export const VP_REDRAW = 375; // ticks after a VIP dies before its side's next is drawn: 3 s
// Its news, FX_MODE with these as size (MX_AM + 8 * 6 ..).
export const VP_MX_DRAW = 64; // owner is its side's VIP now: shot its side, 1 red / 2 blue
export const VP_MX_KILL = 65; // owner killed shot, the other side's VIP
