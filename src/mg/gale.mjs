// GALE FORCE (MG_GALE, prefix gf): a course over the sea from a start pad to
// a finish gate, run along +x: narrow bridges and wide decks between them,
// stairs up and down, gaps to hop, and wind. Fans along the bridges' sides
// gust across them, a light on each warning a second ahead; headwind tunnels
// slow you; updraft vents lift a ball to an upper deck over a fan bridge (a
// short cut); big windmills turn across the way and bat balls aside. Every
// gust, vent and blade runs on the tick and the round's seed. Off the course
// a ball is down, back at its last deck GF_BACK ticks later. Placed by
// finishing order, the rest by how far along they got.
// Literal numbers only: the sim reads them through layout.mjs's MG_CONSTS,
// the client imports this file itself.
export const GF_LEN = 15000; // 120 s
export const GF_LATE = 3750; // 30 s after the first ball home the round ends
export const GF_WIN = 2000; // PG_SCORE of a ball home: GF_WIN + the ticks of PG_LEN it had left; the rest: metres along
export const GF_H0 = 46; // m: the start pad's floor (the sea far below)
export const GF_W0 = 2.6; // a bridge's half-width: GF_W0 plus GF_WK times the root of the balls in, at most GF_WMAX
export const GF_WK = 0.34;
export const GF_WMAX = 8.5;
export const GF_DECKK = 2.2; // a deck's half-width, times a bridge's
export const GF_STEP = 2.6; // m between balls on the start grid
export const GF_IDLE = 0.975; // rolling drag a tick with no keys: 3.2/s, a brake to wait on
export const GF_BACK = 250; // ticks a ball off the course waits before it's back (PG_RESPAWN)
export const GF_DEEP = 5; // m under the course's floor where it is a falling ball is down
export const GF_WALL = 3; // m: a wall's height (the start pad's, a tunnel's, the pen's)
export const GF_THICK = 1; // m: an upper deck's slab, solid from below
export const GF_SNAP = 0.3; // m: a ball this little over the floor and not rising is on it (so it rolls down stairs)
export const GF_DECK0 = 10; // a deck between sections: 10 to 14 m long
export const GF_DECKL = 4;
export const GF_ZMAX = 30; // m the course's middle line keeps within either side of where it started
export const GF_PEN0 = 14; // m: the pen past the line, and GF_PENK more a ball
export const GF_PENK = 0.12;
// Fans: a zone GF_FAN_L either side of the fan along the bridge, as wide as
// the bridge and a metre more, up to GF_FAN_TOP over the floor. A fan blows
// GF_FAN_D0 ticks of every period at first, GF_FAN_D1 by GF_RAMP, at
// GF_FAN_A0 m/s^2 rising to GF_FAN_A1; its light warns GF_WARN ahead.
export const GF_FAN_L = 3;
export const GF_FAN_TOP = 5;
export const GF_FAN_OUT = 1.6; // m past the bridge's edge a fan stands
export const GF_FAN_A0 = 8;
export const GF_FAN_A1 = 14;
export const GF_FAN_D0 = 110; // 0.9 s
export const GF_FAN_D1 = 260; // 2.1 s
export const GF_FAN_P0 = 450; // a fan's period: 450 to 650 ticks (3.6 to 5.2 s)
export const GF_FAN_PK = 200;
export const GF_WARN = 125; // 1 s
export const GF_RAMP = 11250; // 90 s: the gusts their strongest and longest from here
// Headwind tunnels: GF_TUN_L either side of the middle, wall to wall, a
// steady GF_TUN_A0 m/s^2 against the way on and gusts of GF_TUN_G0 more
// (GF_TUN_G1 by GF_RAMP) for GF_TUN_D ticks of every period.
export const GF_TUN_L = 10;
export const GF_TUN_TOP = 4;
export const GF_TUN_A0 = 3;
export const GF_TUN_G0 = 4;
export const GF_TUN_G1 = 6;
export const GF_TUN_D = 140;
export const GF_TUN_P0 = 300;
export const GF_TUN_PK = 150;
// Windmills: GF_MILL_NB blades turning across the way about a hub GF_MILL_H
// over the floor, each a bar GF_MILL_T thick either way, long enough that its
// tip sweeps past the bridge's edge; GF_MILL_V0 to GF_MILL_V0 + GF_MILL_VK
// (1/16384 turn a tick: 0.96 to 1.25 rad/s), the two on a bridge opposite ways.
// A blade that meets a ball bats it off at half its speed into the blade more,
// GF_MILL_KICK on top, and up.
export const GF_MILL_H = 6.5;
export const GF_MILL_T = 0.55;
export const GF_MILL_NB = 4;
export const GF_MILL_V0 = 20;
export const GF_MILL_VK = 6;
export const GF_MILL_KICK = 3;
export const GF_MILL_POP = 2.5;
export const GF_MILL_WK = 1.25; // a mill bridge's half-width, times a bridge's
// Updraft vents: a column GF_VENT_R round, from the floor to GF_VENT_TOP over
// the upper deck GF_VENT_UP up; while it blows a ball in it rises at up to
// GF_VENT_V to its top and floats there, its roll damped, GF_VENT_ON ticks of
// every period.
export const GF_VENT_R = 2.4;
export const GF_VENT_UP = 7;
export const GF_VENT_TOP = 1.2;
export const GF_VENT_V = 10;
export const GF_VENT_K = 0.08; // of the way to its rise a tick
export const GF_VENT_DAMP = 0.985; // a ball's roll across, kept a tick in the column
export const GF_VENT_ON = 400; // 3.2 s
export const GF_VENT_P0 = 560; // 4.5 to 5.4 s
export const GF_VENT_PK = 120;
// Gaps: GF_GAP0 to GF_GAP0 + GF_GAPK m, each landing GF_GAPDROP lower
export const GF_GAP0 = 2.6;
export const GF_GAPK = 1.2;
export const GF_GAPDROP = 0.6;
// Stairs: GF_STAIR_N steps GF_STAIR_L long, GF_STAIR_H a step (under P_STEP: a ball rolls up them)
export const GF_STAIR_N = 8;
export const GF_STAIR_L = 1.5;
export const GF_STAIR_H = 0.25;
// $p_seed keys
export const GF_KCOURSE = 0x31100; // the course: $hash32 of this and a counter
export const GF_KGRID = 0x31101; // the start grid's order
// The course in PG_S: GF_NP pieces, GF_PSIZE bytes each, then GF_NH hazards,
// GF_HSIZE each, then a byte per slot, then the layout's scratch.
export const GF_PIECES = 0;
export const GF_NP = 40;
export const GF_PSIZE = 48;
export const GF_HAZ = 1920; // GF_PIECES + GF_NP * GF_PSIZE
export const GF_NH = 32;
export const GF_HSIZE = 40;
export const GF_PLACE = 3200; // GF_HAZ + GF_NH * GF_HSIZE: u8 per slot, where it came home (0 not yet)
export const GF_CUR = 3456; // GF_PLACE + 256: the layout's cursor (x, z, height) and the sections' order (8 bytes)
// A piece: a box along +x from X0 to X1, Z its middle, W its half-width, its
// floor H (stairs: NS steps SL long, each SH over the one before, H the
// first's); FL its flags, SEC the section it belongs to.
export const GF_P_FL = 0; // u32 GF_F_*
export const GF_P_SEC = 4; // u32 GF_S_*
export const GF_P_X0 = 8;
export const GF_P_X1 = 12;
export const GF_P_Z = 16;
export const GF_P_W = 20;
export const GF_P_H = 24;
export const GF_P_SH = 28;
export const GF_P_SL = 32; // f32, 0 flat
export const GF_P_NS = 36; // u32
// piece flags
export const GF_F_CHECK = 1; // a checkpoint: a ball down comes back here
export const GF_F_START = 2; // the start pad: walled behind and both sides
export const GF_F_PEN = 4; // past the finish line: walled all round, home
export const GF_F_GAP = 8; // no floor
export const GF_F_UPPER = 16; // an upper deck: off the main way, solid from below
export const GF_F_WALLS = 32; // walls both sides (a tunnel)
export const GF_F_FACE = 64; // after a gap: its front face stops a ball under its top
export const GF_F_DECK = 128; // a wide deck between sections
// sections (GF_P_SEC), for the client's looks and the HUD
export const GF_S_START = 0;
export const GF_S_DECK = 1;
export const GF_S_FANS = 2;
export const GF_S_MILL = 3;
export const GF_S_TUNNEL = 4;
export const GF_S_STAIRS = 5;
export const GF_S_GAPS = 6;
export const GF_S_VENT = 7;
export const GF_S_FINISH = 8;
// A hazard: kind; its middle (X, Z) and the floor's height Y; L its reach
// along x (a fan's zone, a tunnel's half-length, a vent's radius, a blade's
// length); W its reach across (a fan's zone, a tunnel's) or its height (a
// vent's top over the floor, a mill's hub); PER its period (a mill: its turn
// a tick, signed), PH its phase (ticks; a mill: its angle); DIR the way a fan
// blows (+1 toward +z); ON a vent's ticks on a period.
export const GF_H_KIND = 0; // u32 GF_HZ_*
export const GF_H_X = 4;
export const GF_H_Z = 8;
export const GF_H_Y = 12;
export const GF_H_L = 16;
export const GF_H_W = 20;
export const GF_H_PER = 24; // i32
export const GF_H_PH = 28; // i32
export const GF_H_DIR = 32; // i32
export const GF_H_ON = 36; // i32
export const GF_HZ_FAN = 1;
export const GF_HZ_TUNNEL = 2;
export const GF_HZ_MILL = 3;
export const GF_HZ_VENT = 4;
// Its header, byte offsets in PG_H (112 B, in the prediction's copy).
export const GF_NPIECE = 0; // u32 pieces laid
export const GF_NHAZ = 4; // u32 hazards
export const GF_X0 = 8; // f32 the start line's x: metres along are x less this
export const GF_FIN = 12; // f32 the finish line's x
export const GF_W = 16; // f32 a bridge's half-width
export const GF_WD = 20; // f32 a deck's
export const GF_FIRST = 24; // u32 the tick the first ball came home, 0 none yet
export const GF_HOME = 28; // u32 balls home
export const GF_ROW = 32; // u32 balls a row on the grid
// Its FX kinds are FX_MG + 4 * MG_GALE + k, k 0 to 3: 100 to 103.
export const GF_FX_HOME = 100; // a ball over the line: owner, size its place
export const GF_FX_LATE = 101; // the first ball home: owner, size the seconds the rest have left
export const GF_FX_MILL = 102; // a blade bats a ball: owner, the hazard as shot, size the speed it leaves at
export const GF_FX_LIFT = 103; // a vent lifts a ball off the floor: owner, the vent as shot
