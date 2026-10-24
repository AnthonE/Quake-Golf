// THE WALL (MG_WALL, prefix wl): a square stage; walls sweep across it from
// its sides, each a row of blocks with gaps in it, faster, narrower and fewer
// as the round goes, and from 40 s every other one swaying side to side. A
// block shoves what it meets along with it, off the far edge; be in a gap.
// The round's walls are drawn up at setup into a table in PG_S, so where
// every wall is on any tick is a function of that tick.
export const WL_H0 = 12; // the square's half-width: 12 m plus WL_HK times the root of the balls in, at most WL_HMAX
export const WL_HK = 2.4;
export const WL_HMAX = 50;
export const WL_SPREAD = 0.8; // balls start on a grid over this much of the square
export const WL_LEN = 15000; // 120 s
export const WL_IDLE = 0.975; // rolling drag a tick with no keys: from 10 m/s to a stop in about 3 m, so a ball can hold a gap's lane
// A wall: a slab WL_T thick from WL_DEEP under the floor to WL_HIGH over it (no hop clears it), as wide as the square.
export const WL_T = 1;
export const WL_HIGH = 3;
export const WL_DEEP = 2;
export const WL_LEAD = 1.5; // m off the near edge its face waits at while it shows, out of reach of a ball on the edge
export const WL_PAST = 3; // m past the far edge its back face goes before it's gone
export const WL_WARN = 125; // ticks a wall shows at its edge, still, before it moves
export const WL_GO0 = 250; // the first wall moves 2 s into play (it shows from the countdown on)
// Every wall's speed, gap width and gaps from the tick it moves (tau, s into play):
export const WL_V0 = 5; // m/s, WL_VK more every second, at most WL_VMAX (from 87.5 s)
export const WL_VK = 0.08;
export const WL_VMAX = 12;
export const WL_G0 = 3.6; // a gap's width, m, WL_GK less every second, at least WL_GMIN (from 80 s): a ball is 2
export const WL_GK = 0.0125;
export const WL_GMIN = 2.6;
export const WL_SPAN = 10; // a gap for every WL_SPAN m of the wall's width and one more, at most WL_KMAX
export const WL_KMAX = 11;
export const WL_KEND = 100; // the gaps fall in even steps from that to one at WL_KEND s
export const WL_MARGIN = 1; // m of block at least between a gap and the next, or the edge (each gap jitters in its own slot)
export const WL_NEXT = 0.6; // the next wall moves when this one is WL_NEXT across (of at most WL_CAD m), and never before this one moves
export const WL_CAD = 60;
export const WL_SWAY = 5000; // ticks into play from which every other wall that moves sways: its gaps slide together,
export const WL_SWAYA = 2.4; // m either way at most (within their slots),
export const WL_SWAYK = 32; // 1/16384 turn a tick: a sway every 512 ticks (4.1 s), as fast as 3.7 m/s across
export const WL_NMAX = 88; // walls in a round's table, past the 120 s even on the smallest stage
// Its header, byte offsets in PG_H.
export const WL_HALF = 0; // f32 the square's half-width
export const WL_NW = 4; // u32 walls in the table
export const WL_LIVE = 8; // u32 the first wall not yet gone (walls go in order), as of the confirmed tick
// In PG_S: the walls, WL_WSIZE bytes each from WL_TABLE, in the order they move; ticks are into play.
export const WL_TABLE = 0;
export const WL_WSIZE = 80;
export const WL_START = 0; // u32 it shows, still, its face WL_LEAD off the near edge (0 for the first: it shows through the countdown)
export const WL_GO = 4; // u32 it moves
export const WL_END = 8; // u32 it's gone, its back face WL_PAST past the far edge
export const WL_SIDE = 12; // u32 the side it comes from: 0 -x (moving +x), 1 -z (+z), 2 +x (-x), 3 +z (-z); never facing one still on the stage
export const WL_V = 16; // f32 its speed, m/s
export const WL_G = 20; // f32 its gaps' width, m
export const WL_K = 24; // u32 its gaps
export const WL_A = 28; // f32 how far its gaps sway either way, 0 for a wall that doesn't
export const WL_PH = 32; // u32 the sway's phase as it moves, 1/16384 turn: the gaps are WL_A sin(phase) off their centres, the phase WL_SWAYK more a tick
export const WL_GAPS = 36; // f32 x WL_KMAX (to the record's end): its gaps' centres across its way (v = z for side 0, then turning with it), ascending
export const WL_PASSED = 7040; // WL_NMAX * WL_WSIZE: u8 per slot, the walls it saw go by this round
export const WL_FELL = 7296; // WL_PASSED + 256: u16 per slot, the tick into play it started going out, plus 1 (0 not yet: over's)
// A ball's PG_M: bit w mod 32 set once wall w's moving face has met it (so WL_FX_PIN comes once a wall),
// cleared on the tick the wall is gone (push's, on either bank: wall w + 32 has the same bit).
// FX kinds, FX_MG + 4 * MG_WALL + k; shot = the wall's index (| its side << 8 for SHOW), at the wall's middle.
export const WL_FX_SHOW = 52; // a wall shows at its edge: size its speed
export const WL_FX_GO = 53; // it moves: size its speed
export const WL_FX_PIN = 54; // a moving block meets a ball the first time (from the ball's move, on its bank): the ball as owner, at it
export const WL_FX_GONE = 55; // it's gone past the far edge: size the balls still in
