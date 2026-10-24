// DOWNHILL (MG_RACE, prefix rc): a course winding down from high over the sea
// to a finish far below, laid out from the round's seed: a start grid, a run
// of sections (slopes with boost pads, bends with a rail on the outside, a
// jump over a gap, a funnel, a bumper field, spinning bars, sliding sweepers)
// and a finish line into a walled pen. Its surface pulls a ball downhill; off
// its edge a ball is down, back at its last checkpoint RC_BACK ticks later.
// Placed by finishing order, the rest by how far down they got.
export const RC_LEN = 15000; // 120 s
export const RC_LATE = 3125; // 25 s after the first ball home the round ends
export const RC_W0 = 8; // the track's half-width: 8 m plus RC_WK a ball, at most RC_WMAX
export const RC_WK = 0.1;
export const RC_WMAX = 34;
export const RC_TOP = 100; // the start's height (PLAT_Y + 60)
export const RC_ACC = 0.8; // the push, times bumper's
export const RC_DRAG = 0.995; // rolling drag a tick, keys held: 0.63/s, 14 m/s flat out
export const RC_IDLE = 0.988; // no keys: 1.5/s, a brake
export const RC_BACK = 250; // ticks a ball off the course waits before it's back (PG_RESPAWN)
export const RC_PULL = 14; // m/s^2 a unit of slope pulls a ball on it (gravity's 20, a rolling ball's 5/7)
export const RC_SNAP = 0.5; // m: a ball this close over the track, not rising faster than RC_SNAPV, is put back on it
export const RC_SNAPV = 1.5;
export const RC_RISE = 0.9; // a ball rolling up a slope rises this much of the slope's rate (so it leaves a kicker's lip flying)
export const RC_DEEP = 8; // m under the height of its best place on the course a falling ball is down
export const RC_SKIP = 15; // m past its best a ball may come down (a jump, a hop over a corner); any further is a cut
export const RC_MARGIN = 2.5; // m past a piece's edge a ball still counts as over it (its rails, its fall)
export const RC_WIN = 2000; // PG_SCORE of a ball home: RC_WIN + the ticks of PG_LEN it had left; the rest: metres down the course
export const RC_RAIL = 0.8; // m: a rail's height
export const RC_BUMP_R = 1.1; // a bumper post's radius, m
export const RC_BUMP_H = 1.4; // its height
export const RC_BUMP_KICK = 9; // m/s it throws a ball off on top of the bounce
export const RC_BAR_R = 0.45; // a spinning bar's and a sweeper's radius, m
export const RC_BAR_LO = 0.05; // a spinning bar spans this to RC_BAR_HI over the track: a hop's apex (0.9) clears it
export const RC_BAR_HI = 0.55;
export const RC_BAR_KICK = 4; // m/s on top of the bar's own speed
export const RC_HUB_R = 0.8; // a spinner's post, m
export const RC_SWEEP_HI = 0.6; // a sweeper's top over the track
export const RC_SWEEP_L = 3; // a sweeper's half-length along the track
export const RC_PAD_L = 2.5; // a boost pad's half-length along the track and half-width across
export const RC_PAD_W = 2;
export const RC_PAD_A = 30; // m/s^2 along the track over a pad,
export const RC_PAD_V = 24; // up to this
export const RC_STEP = 2.6; // m between balls on the start grid
export const RC_PEN = 26; // m: the pen past the line
// $p_seed keys
export const RC_KCOURSE = 0x30000; // the course's sections, from $hash32 of this and a counter
// The course in PG_S: RC_NP pieces (straights and arcs), RC_PSIZE bytes each,
// then RC_NH hazards, RC_HSIZE each, then a byte per slot.
export const RC_PIECES = 0;
export const RC_NP = 40;
export const RC_PSIZE = 96;
export const RC_HAZ = 3840; // RC_PIECES + RC_NP * RC_PSIZE
export const RC_NH = 96;
export const RC_HSIZE = 32;
export const RC_PLACE = 6912; // RC_HAZ + RC_NH * RC_HSIZE: u8 per slot, where it came home (0 not yet)
// A piece's fields (byte offsets). A straight runs from (X, Z) along the unit (DX, DZ) for LEN; an arc goes
// round the centre (X, Z) at radius R, (DX, DZ) the unit from the centre to its middle, SH the sine of half its
// sweep, TURN +1 if its heading grows (towards +z from +x), -1 if it falls. Its height runs H0 to H1 and its
// half-width W0 to W1 over it; (BX, BZ) and BR2 the circle round it, squared; its hazards HZ0 .. HZ0 + HZN.
export const RC_P_KIND = 0; // u32 RC_STRAIGHT | RC_ARC
export const RC_P_FL = 4; // u32 RCF_*
export const RC_P_S0 = 8; // f32 metres down the course at its start
export const RC_P_LEN = 12; // f32 its length along the middle
export const RC_P_H0 = 16;
export const RC_P_H1 = 20;
export const RC_P_W0 = 24;
export const RC_P_W1 = 28;
export const RC_P_X = 32;
export const RC_P_Z = 36;
export const RC_P_DX = 40;
export const RC_P_DZ = 44;
export const RC_P_R = 48;
export const RC_P_SH = 52;
export const RC_P_TURN = 56; // f32
export const RC_P_BX = 60;
export const RC_P_BZ = 64;
export const RC_P_BR2 = 68;
export const RC_P_HZ0 = 72; // u32
export const RC_P_HZN = 76; // u32
export const RC_P_YAW = 80; // u32 its heading at the start, 1/16384 turn
export const RC_P_SWEEP = 84; // u32 an arc's sweep, 1/16384 turn
export const RC_P_SEC = 88; // u32 the section it belongs to (RCS_*)
export const RC_STRAIGHT = 0;
export const RC_ARC = 1;
// piece flags
export const RCF_RAIL_L = 1; // a rail on its left edge (+u)
export const RCF_RAIL_R = 2; // and its right
export const RCF_GAP = 4; // no floor: a jump's gap
export const RCF_CHECK = 8; // a checkpoint at its start: a ball down comes back here
export const RCF_START = 16; // the start grid (a wall behind it)
export const RCF_PEN = 32; // past the finish line: walled all round, home
export const RCF_FACE = 64; // after a gap: its front face is a wall to a ball under its top
// sections (RC_P_SEC), for the client's looks and the HUD
export const RCS_START = 0;
export const RCS_DROP = 1;
export const RCS_BEND = 2;
export const RCS_JUMP = 3;
export const RCS_FUNNEL = 4;
export const RCS_BUMPERS = 5;
export const RCS_SPINNERS = 6;
export const RCS_SWEEPERS = 7;
export const RCS_FINISH = 8;
// A hazard's fields: kind, where (x, z), the track's height there, its size (a post's radius, a bar's
// half-length, a pad's half-length), its turning (1/16384 turn a tick, signed) and phase, and A (a sweeper's
// reach either side, its lateral unit is the piece's left; a pad's half-width).
export const RC_H_KIND = 0; // u32 RCH_*
export const RC_H_X = 4;
export const RC_H_Z = 8;
export const RC_H_Y = 12;
export const RC_H_L = 16;
export const RC_H_SPD = 20; // i32
export const RC_H_PH = 24; // i32
export const RC_H_A = 28;
export const RCH_BUMPER = 1;
export const RCH_SPINNER = 2;
export const RCH_SWEEPER = 3;
export const RCH_PAD = 4;
// Its header, byte offsets in PG_H.
export const RC_NPIECE = 0; // u32 pieces laid
export const RC_NHAZ = 4; // u32 hazards
export const RC_FIN = 8; // f32 the finish line, metres down the course (the pen's start)
export const RC_GRID = 12; // f32 the start grid's end (the start line)
export const RC_W = 16; // f32 the track's half-width
export const RC_FIRST = 20; // u32 the tick the first ball came home, 0 none yet
export const RC_HOME = 24; // u32 balls home
export const RC_ROW = 28; // u32 balls a row on the grid
// FX kinds, FX_MG + 4 * MG_RACE + k
export const RC_FX_HOME = 76; // a ball over the line: owner, size its place
export const RC_FX_BUMP = 77; // a bumper post throws a ball: owner the ball, the post's top as the position, size the speed
export const RC_FX_CUT = 78; // a ball down for cutting the course: owner
export const RC_FX_LATE = 79; // the first ball home: owner, size the seconds the rest have left
// Laying it out: a cursor (x, z, heading, metres down, height) and the sections' order, scratch in PG_S.
export const RC_CUR = 7168; // RC_PLACE + 256
export const RC_YAWMAX = 3200; // the course never heads more than 70 degrees off the start's way
export const RC_SWEEP0 = 2048; // a bend turns 45 degrees and up to RC_SWEEPK (1/16384 turn) more
export const RC_SWEEPK = 1536;
export const RC_BENDR0 = 14; // a bend's radius: the half-width plus 14 to 28 m
export const RC_BENDRK = 14;
export const RC_BENDSL = 0.08; // its fall a metre
export const RC_DROPL = 28; // a drop: 28 to 38 m falling 0.22 to 0.32 a metre
export const RC_DROPSL = 0.22;
export const RC_KICKL = 7; // the kicker: 7 m rising 0.32 a metre
export const RC_KICKSL = 0.32;
export const RC_GAP0 = 5; // the gap: 5 to 7.5 m, its landing 3.5 m under the lip
export const RC_GAPK = 2.5;
export const RC_GAPDROP = 3.5;
export const RC_NECK0 = 4.5; // a funnel's neck: this half-width, or RC_NECKK of the track's
export const RC_NECKK = 0.38;
export const RC_BUMP_SP = 6.5; // m between posts across a row (rows 6 m apart)
export const RC_BUMP_EDGE = 2.4; // m a post keeps from an edge
export const RC_SPIN_LANE = 14; // m of track a spinner's lane
export const RC_SPIN_LMAX = 6.5; // a bar's half-length, at most, and of its lane
export const RC_SPIN_LK = 0.42;
export const RC_SPIN0 = 36; // a spinner turns 36 to 56 (1/16384 turn a tick: 1.7 to 2.7 rad/s)
export const RC_SPINK = 20;
export const RC_SWEEP_LANE = 12; // m of half-width a sweeper's lane
export const RC_SWEEP_KEEP = 2.4; // m short of its lane's edge a sweeper's middle turns back: a ball tight to the edge, or between two lanes, is clear
export const RC_SWEEPV0 = 20; // a sweeper's swing: 20 to 30 (1/16384 turn a tick: 1 to 1.4 rad/s)
export const RC_SWEEPVK = 10;
export const RC_BAR_POP = 2.5; // m/s up a bar's hit throws a ball
