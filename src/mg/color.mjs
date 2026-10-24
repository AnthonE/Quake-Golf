// COLOR CALL (MG_COLOR, prefix cc): one floor of hex tiles in CC_K colours.
// Every cycle the board takes new colours, a colour is called, and when its
// warning runs out every tile of any other colour drops away for CC_DROP
// ticks and comes back. The warning shrinks; from cycle CC_SHRINK the outer
// ring goes grey and drops for good; from cycle CC_SD one tile holds.
export const CC_S = 2.2; // a tile's circumradius, m (pointy-top hexes, axial q, r)
export const CC_R0 = 10; // the disc: 12 m plus CC_RK times the root of the balls in, at most CC_RMAX
export const CC_RK = 4.2;
export const CC_RMAX = 80;
export const CC_RMIN = 6; // the board at its smallest: the middle tile and its ring
export const CC_SPAWN = 0.8; // balls start on a spiral over this much of the disc
export const CC_LEN = 15000; // 120 s
export const CC_IDLE = 0.975; // rolling drag a tick with no keys: from 10 m/s to a stop in about 3 m
export const CC_KN5 = 64; // 4 colours, 5 over this many balls
// A cycle, in ticks into play: the rest (every tile up, in the cycle's new
// colours), the warning (the colour called), the drop (only the call holds).
export const CC_REST = 125; // 1 s
export const CC_WARN0 = 325; // the first warning, 2.6 s, CC_WARNK shorter each cycle
export const CC_WARNK = 25;
export const CC_WARN1 = 150; // the shortest, 1.2 s, from cycle CC_FULL
export const CC_FULL = 7; // (CC_WARN0 - CC_WARN1) / CC_WARNK
export const CC_DROP = 190; // 1.52 s
export const CC_SHRINK = 5; // the first cycle whose drop takes the outer ring for good
export const CC_SHRINKN = 13; // cycles from the full disc to CC_RMIN
export const CC_SD = 18; // CC_SHRINK + CC_SHRINKN: sudden death from here, one tile holds
export const CC_WARNSD = 200; // a sudden death's warning, 1.6 s
export const CC_T_FULL = 3955; // cycle CC_FULL's first tick: CC_FULL * (CC_REST + CC_DROP + CC_WARN0) - CC_WARNK * CC_FULL * (CC_FULL - 1) / 2
export const CC_T_SD = 9070; // cycle CC_SD's: CC_T_FULL + (CC_SD - CC_FULL) * (CC_REST + CC_DROP + CC_WARN1)
// $p_seed keys: the board's colours in cycle c from CC_KBOARD + c, the call's tries from CC_KCALL + c
export const CC_KBOARD = 0x10000;
export const CC_KCALL = 0x20000;
export const CC_TRIES = 16; // points tried for the call's tile before the middle one
// Its header, byte offsets in PG_H.
export const CC_RAD = 0; // f32 the disc's radius at the start
export const CC_K = 4; // u32 colours
// In PG_S: u8 per slot, the calls it lived through this round.
export const CC_SURV = 0;
// FX kinds, FX_MG + 4 * MG_COLOR + k: owner 255, shot = colour | cycle << 4.
export const CC_FX_CALL = 36; // a call: the called tile's top centre, size the warning in ticks
export const CC_FX_DROP = 37; // the drop: the called tile, size the rim it leaves
export const CC_FX_RISE = 38; // the tiles back, new colours: the stage's centre, size this cycle's rim
