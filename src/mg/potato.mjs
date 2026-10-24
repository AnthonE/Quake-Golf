// HOT POTATO (MG_POTATO, prefix hp): a disc sized for the crowd; bombs, one
// for every three balls in, dealt at random; a holder that touches a ball
// without one passes it on. When the wave's fuse runs out every holder blows
// up (out, with a blast round it), the edge falls in for the balls left, and
// after a rest the next bombs are dealt, on a shorter fuse.
export const HP_R0 = 10; // the disc: 10 m plus HP_RK times the root of the balls in, at most HP_RMAX
export const HP_RK = 2.6;
export const HP_RMAX = 48;
export const HP_SPAWN = 0.8; // balls start on a spiral over this much of the disc
export const HP_LEN = 18750; // 150 s
// The waves, in ticks into play: the first deal; then a wave's fuse runs out
// (the boom), its holders blow, the edge holds HP_SHRINK0 and falls in to the
// next wave's radius by the deal, HP_REST after the boom.
export const HP_DEAL0 = 125; // 1 s: the first bombs are picked as the round is laid out, lit a second into play
export const HP_REST = 250; // 2 s from a boom to the next deal
export const HP_SHRINK0 = 63; // the edge holds 0.5 s after a boom before it falls in
export const HP_FUSE0 = 1500; // the first fuse, 12 s, HP_FUSEK shorter each wave down to HP_FUSE1
export const HP_FUSEK = 125;
export const HP_FUSE1 = 750; // 6 s
export const HP_PER = 3; // a bomb for every HP_PER balls in, rounded ((n + 1) / 3), at least 1, at most HP_BMAX
export const HP_BMAX = 64;
export const HP_COOL = 94; // ticks a bomb just got sticks before it can be passed on: 0.75 s, so it doesn't bounce straight back
export const HP_TOUCH = 0.3; // m past the two radii that counts as touching
export const HP_HASTE = 0.15; // a holder's push on the ground, over a ball's: the fuse lights a fire under it
export const HP_BLAST_R = 6; // a holder going off: bumper's stomp
export const HP_BLAST_S = 14;
// Its header, byte offsets in PG_H.
export const HP_RAD = 0; // f32 the disc's radius at the last boom (as laid out, before any)
export const HP_RNEXT = 4; // f32 the radius it falls in to by the deal
export const HP_WAVE = 8; // u32 the wave (0 the first): dealt at HP_DEAL, gone off at HP_BOOM
export const HP_DEAL = 12; // u32 tick into play its bombs are lit
export const HP_BOOM = 16; // u32 tick into play its fuse runs out (at most the round's length)
export const HP_LAST = 20; // u32 tick into play of the last boom (0 before any)
export const HP_BOMBS = 24; // u32 bombs dealt this wave
export const HP_FUSE = 28; // u32 this wave's fuse, ticks from HP_DEAL to HP_BOOM
// In PG_S: u8 per slot, the wave + 1 whose deal hands it a bomb (picked a wave ahead, or as the round is laid out).
export const HP_NEXT = 0;
// In the ball's record, PG_M's four bytes (PG_M = 60; src/mg/*.mjs can't import the layout).
export const HP_FL = 60; // u8 HP_HOLD | HP_BLOWN
export const HP_BY = 61; // u8 the slot that passed it on, 255 the deal
export const HP_AT = 62; // u16 tick into play it got the bomb
export const HP_HOLD = 1; // holds a bomb
export const HP_BLOWN = 2; // went off this tick (the boom's own mark, between its two passes)
// FX kinds, FX_MG + 4 * MG_POTATO + k.
export const HP_FX_PASS = 64; // a bomb passed: owner the one who has it now, shot the one who had it, at its centre, size the fuse's ticks left
export const HP_FX_BOOM = 65; // a wave goes off: owner 255, shot the holders blown, the stage's centre, size the wave
export const HP_FX_DEAL = 66; // a wave's bombs lit: owner 255, shot the bombs, the stage's centre, size the fuse in ticks
