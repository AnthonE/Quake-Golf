// BOMB RAIN (MG_BOMBS, prefix bo): a disc of hex tiles over the sea whose rim
// crumbles in, and bombs falling on it in waves, each where a ring on the
// floor says, blasting what's near when it lands; big ones blow a crater
// that fills in again. Last ball on wins.
export const BO_S = 1.6; // a tile's circumradius, m (pointy-top hexes, axial q, r)
export const BO_R0 = 12; // the disc: 12 m plus BO_RK times the root of the balls in, at most BO_RMAX
export const BO_RK = 3;
export const BO_RMAX = 64;
export const BO_RMIN = 10; // the disc at its smallest: the rim crumbles in to here
export const BO_CALM = 500; // ticks into play before the rim starts to crumble (4 s)
export const BO_SHRINK = 7500; // ticks from the whole disc to BO_RMIN (60 s)
export const BO_LEN = 15000; // 120 s
export const BO_IDLE = 0.98; // rolling drag a tick with no keys: from 10 m/s to a stop in about 4 m
export const BO_SPAWN = 0.75; // balls start on a spiral over this much of the disc
// The tiles, in PG_BIG: 8 B a cell, (r + BO_N) * BO_W + (q + BO_N):
// u32 the tick a crater opens there (0 none: the tile is gone from then for
// BO_HOLE ticks), u16 the tick into play the rim takes it (0 no tile,
// BO_NEVER inside BO_RMIN), u16 0.
export const BO_N = 38;
export const BO_W = 77; // 2 BO_N + 1
export const BO_TILES = 0; // byte offset in PG_BIG
export const BO_NEVER = 0xffff;
// The waves, from play's start: the first BO_FIRST in, then one every
// BO_GAP0 ticks closing to BO_GAP1 as the rim comes in (from BO_CALM, over
// BO_SHRINK), each of 1 + left / BO_PER bombs (one more every BO_MORE ticks
// into play); a bomb lands BO_FALL0 ticks after its ring shows, BO_FALL1 once the rim is in.
export const BO_FIRST = 125;
export const BO_GAP0 = 200; // 1.6 s
export const BO_GAP1 = 100; // 0.8 s
export const BO_FALL0 = 200; // 1.6 s
export const BO_FALL1 = 150; // 1.2 s
export const BO_PER = 10;
export const BO_MORE = 3750; // 30 s
// Aimed bombs: the first of every wave and one in BO_AIM after it, where a
// ball in would be BO_LEAD s on if it kept rolling, give or take BO_SCATTER m.
export const BO_AIM = 2;
export const BO_LEAD = 0.4;
export const BO_SCATTER = 1.5;
// Big bombs, from BO_BIGFROM ticks into play, one in BO_BIGONE.
export const BO_BIGFROM = 1250; // 10 s
export const BO_BIGONE = 6;
export const BO_HEIGHT = 32; // m over the floor a bomb is first seen, falling (drawn only)
// Blasts: radius (m) and shove at the centre (m/s), bumper's blast on balls.
export const BO_R = 4.5;
export const BO_STR = 16;
export const BO_BIGR = 7;
export const BO_BIGSTR = 22;
export const BO_CRATER = 3; // m: a big bomb takes every tile whose centre is this near where it lands
export const BO_HOLE = 1250; // ticks a crater stays open (10 s)
export const BO_KEEP = 100; // ticks a bomb's record lasts past its blast (drawn going off)
// The bombs, in PG_S: BO_NB records of BO_BSIZE B: f32 x, z where it lands |
// u32 the tick it lands | u16 ticks it falls | u8 kind (0 none, 1 a bomb, 2 a
// big one) | u8 the slot it was aimed at plus 1 (0 none).
export const BO_BOMBS = 0; // byte offset in PG_S
export const BO_NB = 160;
export const BO_BSIZE = 16;
export const BO_FELL = 2560; // in PG_S past the bombs: u16 per slot, the tick into play it started going out, plus 1 (0 not yet: over's)
// Its header, byte offsets in PG_H.
export const BO_RAD = 0; // f32 the disc's radius at the start
export const BO_NEXT = 4; // u32 the tick into play of the next wave
export const BO_WAVE = 8; // u32 waves so far
export const BO_COUNT = 12; // u32 tiles at the start
export const BO_LAST = 16; // u32 bombs in the last wave
export const BO_GAP = 20; // u32 ticks from the last wave to the next
// FX kinds, FX_MG + 4 * MG_BOMBS + k.
export const BO_FX_BOOM = 48; // a bomb goes off: where it landed, size its blast's radius, shot its kind, owner who it was aimed at (255 none)
export const BO_FX_WAVE = 49; // a wave's rings show: the stage's centre, size how many, shot the wave's number, owner 255
export const BO_FX_BIG = 50; // a big bomb's ring shows: where it lands, size its fall in ticks, shot its record | 256 if aimed, owner who it's aimed at (255 none)
