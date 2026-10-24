// PAINT PARTY (MG_PAINT, prefix pp): a round floor over the sea, a grid of
// cells over its square. Every tick a ball rolling on it paints the cells
// round its centre its own; paint bombs land on a schedule and burst over
// whoever rolls into one first; the last PP_RUSH ticks paint wider. A fall is
// PP_RESPAWN ticks down, the paint staying. The most cells at the end wins.
export const PP_R0 = 12; // the disc: 12 m plus PP_RK times the root of the balls in, at most PP_RMAX
export const PP_RK = 2.8;
export const PP_RMAX = 56;
export const PP_SPAWN = 0.75; // balls start on a spiral over this much of the disc
export const PP_LEN = 9375; // 75 s
export const PP_RESPAWN = 250; // 2 s down after a fall
export const PP_IDLE = 0.98; // rolling drag a tick with no keys: from 10 m/s to a stop in about 4 m
export const PP_N = 256; // the grid: PP_N cells a side over the disc's square (0.125 m for 2 balls, 0.44 m for 256)
export const PP_BRUSH = 1.2; // m round a ball's centre it paints: a stripe 2.4 m wide
export const PP_RUSH = 1250; // the last 10 s: every brush PP_RUSH_BRUSH, every burst PP_RUSH_SPLAT
export const PP_RUSH_BRUSH = 1.8;
// The paint bombs: PP_ORB0 of them, one more for every PP_ORBN balls, at most
// PP_NORB. Bomb j first lands PP_FIRST + j * PP_STAGGER ticks into play; one
// burst, it lands again PP_BACK ticks later somewhere else, its spot known
// (and drawn) all that while: the confirmed world fixes it the tick it bursts.
export const PP_NORB = 12;
export const PP_ORB0 = 2;
export const PP_ORBN = 12;
export const PP_FIRST = 250; // 2 s
export const PP_STAGGER = 63;
export const PP_BACK = 375; // 3 s
export const PP_ORB_Y = 1; // its centre over the floor, m
export const PP_ORB_R = 0.8; // its reach past a ball's radius
export const PP_SPLAT = 4; // m a burst paints round the bomb
export const PP_RUSH_SPLAT = 5.5;
export const PP_ORB_SPREAD = 0.85; // bombs land within this much of the disc's radius
export const PP_KORB = 0x50000; // $p_seed key: bomb j's spot after b bursts from PP_KORB + j * 4096 + b
export const PP_LEADGAP = 250; // ticks between two of the lead's FX
// Its header, byte offsets in PG_H.
export const PP_RAD = 0; // f32 the disc's radius
export const PP_X0 = 4; // f32 the grid's low corner, x and z (PG_CX - PP_RAD)
export const PP_CS = 8; // f32 a cell's side, 2 PP_RAD / PP_N
export const PP_TOTAL = 12; // u32 cells on the disc
export const PP_ORBS = 16; // u32 bombs this round
export const PP_LEAD = 20; // u32 the leader's slot + 1 as the lead's FX last told it (0 none)
export const PP_LEADT = 24; // u32 the tick of that FX
// In PG_S: per slot, the cells it holds (u16; PG_SCORE is a copy, written
// every tick); a slot's wipe mark (u8, per-call); then the bombs.
export const PP_CNT = 0;
export const PP_WIPE = 512;
export const PP_ORB = 768; // 16 B a bomb: f32 x, f32 z, u32 the tick into play it lands, u32 its bursts so far
export const PP_ORB_SIZE = 16;
// In PG_BIG: u16 a cell, row-major (j * PP_N + i covers x0 + i cs .. x0 + (i + 1) cs, z the same with j):
// 0 unpainted, slot + 1 painted, PP_OFF off the disc (its centre further than PP_RAD from PG_CX).
export const PP_CELLS = 0;
export const PP_OFF = 0xffff;
// FX kinds, FX_MG + 4 * MG_PAINT + k.
export const PP_FX_SPLAT = 72; // a bomb bursts: owner the ball, shot the bomb, pos the bomb on the floor, size the burst's radius
export const PP_FX_ORB = 73; // a bomb lands: owner 255, shot the bomb, pos it on the floor
export const PP_FX_RUSH = 74; // the rush begins: owner 255, pos the centre, size the brush
export const PP_FX_LEAD = 75; // a new leader: owner it, shot the last one (255 none), pos its ball, size its cells
