// THIN ICE (MG_THINICE, prefix ti): three layers of hex ice over the sea. A
// ball on the ground cracks the tile under its centre; the tile holds
// TI_HOLD ticks more, then drops. Through all three and you're out.
export const TI_S = 2; // a tile's circumradius, m (pointy-top hexes, axial q, r)
export const TI_LAYERS = 3;
export const TI_GAP = 12; // m from one layer's top down to the next's: PLAT_Y, PLAT_Y - 12, PLAT_Y - 24
export const TI_R0 = 12; // the disc: 12 m plus TI_RK times the root of the balls in, at most TI_RMAX
export const TI_RK = 4.5;
export const TI_RMAX = 64;
export const TI_HOLD = 80; // ticks a cracked tile still holds: 0.64 s, time to cross one at 5.4 m/s
export const TI_GRACE = 125; // ticks into play before anything cracks: everyone rolling before the ice gives
export const TI_LEN = 15000; // 120 s
// The tiles, in PG_BIG: u32 per cell, layer by layer, (r + TI_N) * TI_W + (q + TI_N)
// within a layer. 0 no tile, 1 intact, else the tick it stops holding.
export const TI_N = 32;
export const TI_W = 65; // 2 TI_N + 1
export const TI_CELLS = 4225; // TI_W squared, a layer's cells
export const TI_TILES = 0; // byte offset in PG_BIG
// The cracks in the order they came (so in the order they drop), u16 cell
// indices: the tick's end pops the ones that went, for their FX.
export const TI_QUEUE = 0x10000; // byte offset in PG_BIG
export const TI_QMAX = 16384;
// Its header, byte offsets in PG_H.
export const TI_RAD = 0; // f32 the disc's radius
export const TI_QHEAD = 4; // u32 the queue's next to drop
export const TI_QTAIL = 8; // u32 the queue's end
export const TI_COUNT = 12; // u32 tiles in a layer at the start
// FX kinds, FX_MG + 4 * MG_THINICE + k: the cell index (across layers) as shot,
// the tile's top centre as the position, the layer as size.
export const TI_FX_CRACK = 32; // a tile cracks: the ball that did it as owner
export const TI_FX_DROP = 33; // a tile goes: owner 255
