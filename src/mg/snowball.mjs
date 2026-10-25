// SNOWBALL (MG_SNOWBALL, prefix sb): a round snowfield over the sea whose
// rim crumbles in to a small ring, a few pines on it. Every ball is a
// snowball: rolling on the snow grows it, standing still melts it; bigger is
// heavier, as quick flat out but slower to get going, and nearer the edge.
// One that touches a ball under SB_EATK of its size swallows it. Last one in wins.
// Literal numbers only: the sim reads them through layout.mjs's MG_CONSTS,
// the client imports this file itself.
export const SB_R0 = 10; // the field: SB_R0 m plus SB_RK times the root of the balls in, at most SB_RMAX
export const SB_RK = 5;
export const SB_RMAX = 64;
export const SB_RMIN = 7; // the ring the rim crumbles in to
export const SB_CALM = 1000; // ticks into play before the rim starts to crumble (8 s)
export const SB_SHRINK = 7500; // ticks from the whole field in to SB_RMIN (60 s)
export const SB_LEN = 11250; // 90 s
export const SB_SPAWN = 0.8; // balls start on a sunflower over this much of the field
export const SB_IDLE = 0.985; // rolling drag a tick with no keys: snow grips, 10 m/s to a stop in about 5 m
// A snowball: radius SB_B0 to start, up SB_GROW for every metre rolled on
// fresh snow, to SB_BMAX; under SB_STILL m/s it melts SB_MELT a tick, back
// to SB_B0. On the ground, k = r / SB_B0, the keys' push is 1/k of bumper's
// and the drag's bite 1/(k (1 + SB_FAST (k - 1))): k times slower to get
// going, SB_FAST more top speed for every metre (14 m/s at 3 m).
export const SB_FAST = 0.2;
export const SB_B0 = 1;
export const SB_BMAX = 3;
export const SB_GROW = 0.015; // m a metre of fresh snow: 1 m to 2 m in 67 m
export const SB_STILL = 1; // m/s
export const SB_MELT = 0.0006; // m a tick: 3 m to 2 m in 13 s still
// The snow: a grid of SB_GN x SB_GN cells of 1 m centred on the field (u32
// each in PG_BIG at SB_GRID: 0 fresh, else the tick a ball last rolled it
// fresh). A ball in on the ground rolls the cells within SB_FOOT of its
// radius of its centre (and the one under it); a rolled cell packs hard
// SB_PACK ticks later, longer than the prediction runs ahead, and is fresh
// again (snowed over) SB_REFILL ticks after it was rolled. Rolling packed
// snow wears a ball down SB_WEAR a metre (to SB_B0).
export const SB_GN = 128;
export const SB_GRID = 0;
export const SB_FOOT = 0.75;
export const SB_PACK = 300; // 2.4 s
export const SB_REFILL = 3000; // 20 s
export const SB_WEAR = 0.008;
// The edge: a ball on the ground whose skin hangs over the rim is pushed out,
// SB_TIP m/s a tick times the overhang over its radius (at most 1).
export const SB_TIP = 0.03;
// Swallowing: two balls in touching (skins within SB_TOUCH, after the bumps),
// one under SB_EATK of the other's radius: the small one is out, the big one's
// square up SB_EAT of the small one's (to SB_BMAX).
export const SB_EATK = 0.75;
export const SB_EAT = 0.5;
export const SB_TOUCH = 0.15;
// The pines: SB_PN plus the field's area over SB_PAREA, at most SB_PMAX, on
// the ring between SB_PIN and SB_POUT of the radius, clear of the spawns. A
// post SB_PR round and SB_PH tall that a ball bounces off at SB_PE of its
// speed in (and SB_PKICK more once it comes in faster than SB_PKMIN), while
// the rim hasn't reached it.
export const SB_PN = 3;
export const SB_PAREA = 350;
export const SB_PMAX = 20;
export const SB_PIN = 0.15;
export const SB_POUT = 0.9;
export const SB_PR = 1.2;
export const SB_PH = 9;
export const SB_PE = 0.5;
export const SB_PKICK = 1.5;
export const SB_PKMIN = 3;
// Its header, byte offsets in PG_H (112 B, in the prediction's copy).
export const SB_RAD = 0; // f32 the field's radius at the start
export const SB_NP = 4; // u32 pines
// PG_S (the confirmed world's, fixed at setup but SB_EATEN).
export const SB_PINE = 0; // f32 x, z a pine, SB_PMAX of them
export const SB_SPOT = 256; // f32 x, z where spawn index i starts, 256 of them
export const SB_EATEN = 2304; // u8 a slot: who swallowed it, plus 1 (0 nobody)
// A ball's PG_M is its radius, an f32 (PGF_SIZE: $b_rad reads it); PG_SCORE the balls it swallowed.
// Its FX kinds are FX_MG + 4 * MG_SNOWBALL + k, k 0 to 3: 88 to 91.
export const SB_FX_EAT = 88; // a swallow: owner the swallower, shot the swallowed, where it was (its centre), size the swallower's radius after
