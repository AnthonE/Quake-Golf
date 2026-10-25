// MAZE RUN (MG_MAZE, prefix mz): a hedge maze over the sea, laid out from the
// round's seed for the crowd, everyone starting the same number of cells from
// a glowing pad in the middle. Every MZ_PERIOD ticks some of its doors slide
// open and others shut, their tops flashing MZ_WARN ticks ahead. The first
// onto the pad wins; the rest place by the order they got there, then by
// how far they were along the maze's paths from the middle at the end.
// Literal numbers only: the sim reads them through layout.mjs's MG_CONSTS,
// the client imports this file itself.
export const MZ_C = 5; // m, a cell's side
export const MZ_HT = 0.35; // m, half a hedge's thickness: 4.3 m clear between two
export const MZ_HIGH = 2.5; // m, a hedge's height over the floor (a hop's top is 0.9 m)
export const MZ_N0 = 6.33; // cells a side: the odd number nearest MZ_N0 + MZ_NK times the root of the balls in,
export const MZ_NK = 2.1667; // 15 for 16 balls, 23 for 64, 41 for 256; from MZ_NMIN to MZ_NMAX
export const MZ_NMIN = 11;
export const MZ_NMAX = 41;
export const MZ_PLOOP = 4; // in 256, plus half the cells a side: a hedge the perfect maze left standing comes down for a loop
export const MZ_PDOOR = 26; // (more in a bigger maze, so a crowd has ways round), or is a door
export const MZ_NG = 8; // the doors' groups: each epoch some groups are open, the rest shut
export const MZ_HALL = 6; // one wide hall (two cells by MZ_HALL0 to MZ_HALL0 + 3) for every MZ_HALL cells a side
export const MZ_HALL0 = 4;
export const MZ_PERIOD = 1875; // 15 s an epoch of the doors
export const MZ_WARN = 250; // 2 s before the doors move, their tops flash
export const MZ_NE = 16; // epochs in the doors' table, round again past it
export const MZ_LEN0 = 7500; // the round: 60 s plus MZ_LENK a cell a side (82 s for 16 balls, 121 s for 256)
export const MZ_LENK = 187;
export const MZ_LATE = 3750; // once the first ball is home, 30 s left (if there were more)
export const MZ_PAD_R = 2.2; // m round the middle a ball's centre is home
export const MZ_BOUNCE = 0.45; // what a hedge gives back of a ball's speed into it
export const MZ_BONK = 3; // m/s into a hedge that makes an FX
export const MZ_SPOT = 1.05; // m off a cell's centre each of up to four balls starts, once there are more balls than start cells
export const MZ_SPREAD = 8; // start cells at the least (or one a ball, if fewer), up to four balls a cell past that
export const MZ_IDLE = 0.975; // rolling drag a tick with no keys: a brake for the corners
// Edge kinds, a nibble each in MZ_CELLS: open, a hedge, or a door of group k - MZ_DOOR.
export const MZ_OPEN = 0;
export const MZ_WALL = 1;
export const MZ_DOOR = 2;
// Its header, byte offsets in PG_H (112 B, in the prediction's copy).
export const MZ_N = 0; // u32 cells a side (odd: the middle cell is the pad's)
export const MZ_X0 = 4; // f32 the maze's low corner, x and z (PG_CX - MZ_HALF)
export const MZ_HALF = 8; // f32 half its side, MZ_N * MZ_C / 2
export const MZ_FIN = 12; // u32 balls home
export const MZ_FIRST = 16; // u32 the tick into play the first came home (0 none yet)
export const MZ_NST = 20; // u32 start cells in MZ_STARTS
export const MZ_SD = 24; // u32 their distance to the middle by the first epoch's doors, MZ_SD to MZ_SD + MZ_SW - 1 cells
export const MZ_SW = 28; // u32 (1 when there are enough cells at one distance)
// In PG_S: the doors' table, then the maze, a byte a cell (j * MZ_N + i: x0 + i MZ_C .. x0 + (i + 1) MZ_C,
// z the same with j), its east edge in the low nibble and its south edge in the high (an edge kind each);
// the west and north edges are its neighbours', and the maze's rim a hedge.
export const MZ_MASKS = 0; // u32 a group's bit set: open, for epoch e mod MZ_NE
export const MZ_CELLS = 64;
// In PG_BIG: the paths, worked by the confirmed world at the layout (the first epoch's) and as the doors move.
export const MZ_DIST = 0; // u16 a cell: cells along the open paths to the middle, 0xffff none
export const MZ_QUEUE = 4096; // u16 a cell: the search's queue (and the layout's stack)
export const MZ_SEEN = 8192; // u8 a cell: the layout's marks
export const MZ_HIST = 12288; // u16 a distance: how many cells are that far, at the layout
export const MZ_STARTS = 16384; // u16 a start cell, in scan order
// PG_M: 0 racing; home, MZ_M_FIN | its place (balls home on one tick share it).
export const MZ_M_FIN = 0x10000;
// PG_SCORE: home, MZ_SFIN less the balls home before it; the rest, at the end,
// MZ_SFAR less twice the metres along the paths to the middle.
export const MZ_SFIN = 30000;
export const MZ_SFAR = 20000;
// FX kinds, FX_MG + 4 * MG_MAZE + k.
export const MZ_FX_HOME = 120; // owner home, shot its place, at the ball, size s into play (the first: s left after the cut)
export const MZ_FX_BONK = 121; // owner into a hedge (its bank's ring), shot 0, at the ball, size m/s into it
export const MZ_FX_WARN = 122; // the doors move in MZ_WARN ticks: shot how many will, at the middle, size the epoch to come
export const MZ_FX_DOORS = 123; // the doors moved: shot how many are open now, at the middle, size the epoch
