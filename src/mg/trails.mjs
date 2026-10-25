// LIGHT TRAILS (MG_TRAILS, prefix lt): a dark square floor over the sea,
// sized for the crowd, its edges closing in over the round. Every ball lays a
// trail of light behind it into a grid of LT_CS cells, each holding the slot
// that laid it and the tick: soft for LT_HARD, then a wall no ball may roll
// into (its own included), gone LT_LIFE0 after it was laid (longer as the
// round goes, so the floor fills with light). A ball whose bottom is more
// than LT_WALL over the floor passes over. Bumps on, without bumper's kick.
// The last ball in wins.
// Literal numbers only: the sim reads them through layout.mjs's MG_CONSTS,
// the client imports this file itself.
export const LT_H0 = 12; // the floor's half-side: LT_H0 m plus LT_HK times the root of the balls in, at most LT_HMAX
export const LT_HK = 4;
export const LT_HMAX = 76; // 304 cells a side, 361 KiB of grid
export const LT_HEND = 0.3; // the edges close in to this much of it, at least LT_HMIN
export const LT_HMIN = 9;
export const LT_CLOSE0 = 1875; // from 15 s into play
export const LT_CLOSE1 = 8750; // to 70 s, in a straight line
export const LT_SPAWN = 0.7; // balls start on a sunflower spiral over this much of the half-side
export const LT_LEN = 11250; // 90 s
export const LT_ACC = 1.6; // the push, times bumper's: 17.6 m/s^2,
export const LT_DRAG = '0.9824'; // and 8 m/s flat out (a turn of 3.6 m at speed)
export const LT_CS = 0.5; // m a cell's side
export const LT_HARD = 201; // ticks a cell is soft after it's laid (1.6 s: the host's prediction runs 201 ahead)
export const LT_LIFE0 = 1250; // ticks a cell laid as play starts lasts (10 s)
export const LT_LIFED = 16; // and a tick longer for every LT_LIFED into play it was laid (15.6 s by the end)
export const LT_WALL = 0.6; // m a trail stands: a ball whose bottom is higher passes over (a hop clears it for 0.35 s)
export const LT_WALK = 16; // cells a ball's centre may cross in a tick, at most (80 m/s is 2)
// Its header, byte offsets in PG_H (112 B, in the prediction's copy).
export const LT_HALF0 = 0; // f32 the floor's half-side as play starts
export const LT_HALF1 = 4; // f32 and once the edges have closed in
export const LT_X0 = 8; // f32 the grid's low corner, x and z (PG_CX - LT_HALF0)
export const LT_SIDE = 12; // u32 cells a side, ceil(2 LT_HALF0 / LT_CS)
// In PG_S: per slot, where its centre was at the end of the last tick (f32 x, f32 z).
export const LT_PREV = 0;
// In PG_BIG: u32 a cell, row-major (j * LT_SIDE + i covers x0 + i cs .. x0 + (i + 1) cs, z the same with j):
// 0 none, else (the tick into play it was laid, at least 1) << 8 | the slot that laid it.
export const LT_CELLS = 0;
// PG_M, once a ball is out on a trail: the slot + 1 whose light it hit (its own included); 0 for a fall.
// FX kinds, FX_MG + 4 * MG_TRAILS + k.
export const LT_FX_CRASH = 116; // a ball hits a hard cell: owner the ball, shot whose light, pos the ball, size the cell's age in ticks
export const LT_FX_CLOSE = 117; // the edges start closing in: owner 255, pos the centre, size the half-side they close to
