// RED LIGHT (MG_LIGHT, prefix rl): a long field to a finish line, a doll past
// it by a traffic light. Green: roll; the doll sings, then turns round to
// face the field (RL_TURN, the warning). Red: once RL_GRACE is up, a ball
// still rolling faster than RL_VMAX is caught, out of the round. Over the
// line and you're out of play too, placed by the order you crossed in; the
// rest by how far they got.
export const RL_W0 = 30; // the field's width, rail to rail: 30 m plus RL_WK a ball, at most RL_WMAX
export const RL_WK = 0.25;
export const RL_WMAX = 90;
export const RL_FIELD = 170; // m from the start line to the finish line
export const RL_YARD = 40; // m of floor past the finish line: the finishers' pen, the doll
export const RL_SP = 2.4; // m between balls on the start grid, across and back (and in the pen)
export const RL_EDGE = 1.6; // m in from a rail to the outermost centres on the grid
export const RL_GRID0 = 1.4; // m behind the start line to the front row's centres; the back wall as far behind the last row
export const RL_PEN0 = 4; // m past the finish line to the pen's front row
export const RL_LEN = 11250; // 90 s
export const RL_RUSH = 3750; // once the first ball is over the line, 30 s left (if there were more)
export const RL_IDLE = 0.975; // rolling drag a tick with no keys: 10 m/s to under RL_VMAX in 0.67 s
export const RL_VMAX = 1.2; // m/s across the ground: faster on red, once RL_GRACE is up, and you're caught
export const RL_VMAX2 = 1.44; // its square
export const RL_TURN = 88; // ticks the doll takes to turn round, the end of every green: 0.7 s
export const RL_GRACE = 44; // ticks of red before it looks: 0.35 s
export const RL_BOUNCE = 0.3; // what a rail gives back of a ball's speed into it
// The schedule, in ticks from play's start, from $p_seed: cycle c is a green
// of RL_GA + (its seed mod RL_GN) ticks (the first, RL_G0A + mod RL_G0N),
// then a red of RL_RA + (mod RL_RN).
export const RL_G0A = 500; // the first green, 4 to 5.5 s: everyone gets going
export const RL_G0N = 188;
export const RL_GA = 225; // the rest, 1.8 to 5.5 s
export const RL_GN = 463;
export const RL_RA = 250; // red, 2 to 3.5 s
export const RL_RN = 188;
export const RL_KG = 0x30000; // $p_seed keys: green c from RL_KG + c, red c from RL_KR + c, ball p's grid tie-break from RL_KGRID + p
export const RL_KR = 0x31000;
export const RL_KGRID = 0x32000;
// Its header, byte offsets in PG_H.
export const RL_HW = 0; // f32 the field's half-width, rail to rail
export const RL_ZS = 4; // f32 the start line's z (the balls roll toward -z)
export const RL_ZF = 8; // f32 the finish line's z
export const RL_ZB = 12; // f32 the back wall's, behind the grid
export const RL_FIN = 16; // u32 balls over the line
export const RL_OUT = 20; // u32 balls caught
export const RL_COLS = 24; // u32 balls a row on the grid (and in the pen)
// In PG_S, the grid's order, worked out by setup: by a ball's index among those in.
export const RL_KEY = 0; // u32 its party points << 16 | a per-round tie-break
export const RL_RANK = 1024; // u16 its spot on the grid: the fewest points in front
// PG_M: 0 racing, else what became of it.
export const RL_M_FIN = 0x10000; // | its finishing order, from 1 (balls over on one tick share it)
export const RL_M_CAUGHT = 0x20000; // | the cycle it was caught in
// PG_SCORE: over the line, RL_SCORE_FIN less the balls over before it; the
// rest, cm from the back wall where it was caught or stood at the end.
export const RL_SCORE_FIN = 60000;
export const RL_SCORE_MAX = 49999;
// FX kinds, FX_MG + 4 * MG_LIGHT + k.
export const RL_FX_CAUGHT = 44; // owner the ball caught, shot the ball that bumped it lately (255 none), its centre, size m it had to go
export const RL_FX_FINISH = 45; // owner the ball over the line, shot its order, where it crossed, size its time in s
