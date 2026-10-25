// CANNONADE (MG_CANNON, prefix cn): a round platform of hex tiles over the
// sea, sized for the crowd, ringed with cannons. Volleys of cannonballs roll
// straight across it and off the far side, each shown by a red stripe along
// its lane and its cannon's muzzle glowing CN_TELE ticks before it fires; a
// cannonball knocks what it meets along its own path. Volleys grow and come
// closer together; from CN_LOBFROM some shots are lobbed onto a marked ring
// and roll on from there; from CN_CRUMBLE the rim crumbles in. Last ball on wins.
// Literal numbers only: the sim reads them through layout.mjs's MG_CONSTS,
// the client imports this file itself.
export const CN_S = 2; // a tile's circumradius, m (pointy-top hexes, axial q, r)
export const CN_R0 = 16; // the platform: CN_R0 m plus CN_RK times the root of the balls in, at most CN_RMAX
export const CN_RK = 3;
export const CN_RMAX = 60;
export const CN_RMIN = 12; // the platform at its smallest: the rim crumbles in to here
export const CN_LEN = 15000; // 120 s
export const CN_IDLE = 0.98; // rolling drag a tick with no keys: from 10 m/s to a stop in about 4 m
export const CN_HOP = 10.5; // hop speed, m/s: 2.75 m up, over a cannonball of CN_RC0 but not much bigger
export const CN_SPAWN = 0.7; // balls start on a spiral over this much of the platform
// The tiles, in PG_BIG: a u16 a cell, (r + CN_N) * CN_W + (q + CN_N): the tick
// into play the rim takes it (0 no tile, CN_NEVER inside CN_RMIN), from
// CN_CRUMBLE + 1 at the rim to CN_CRUMBLE + CN_SHRINK at CN_RMIN, plus up to
// CN_JIT more from the round's random numbers, so the rim goes ragged.
export const CN_N = 28;
export const CN_W = 57; // 2 CN_N + 1
export const CN_TILES = 0; // byte offset in PG_BIG
export const CN_NEVER = 0xffff;
export const CN_CRUMBLE = 7500; // 60 s
export const CN_SHRINK = 5000; // 40 s
export const CN_JIT = 250;
// The cannons: CN_NC0, one more every CN_NCK m of radius past CN_NCR, at most
// CN_NCMAX, evenly round a ring CN_MOUNT m past the rim (turned by the round's
// random numbers), each a barrel CN_BARREL m long whose muzzle is CN_MZY m
// over the floor.
export const CN_NC0 = 8;
export const CN_NCR = 20;
export const CN_NCK = 5;
export const CN_NCMAX = 16;
export const CN_MOUNT = 4;
export const CN_BARREL = 2.4;
export const CN_MZY = 2.6;
// The volleys, from play's start: the first fires CN_FIRST in, then one every
// CN_GAP0 ticks closing to CN_GAP1 over CN_RAMP, each of 1 + radius / CN_PER
// shots (one more every CN_MORE ticks into play, at most a cannon each), from
// cannons spread evenly round the ring, CN_STAG ticks apart. Each shot is
// shown CN_TELE ticks before it fires.
export const CN_FIRST = 375; // 3 s
export const CN_TELE = 188; // 1.5 s
export const CN_GAP0 = 375; // 3 s
export const CN_GAP1 = 150; // 1.2 s
export const CN_RAMP = 9000; // 72 s
export const CN_PER = 7;
export const CN_MORE = 2500; // 20 s
export const CN_STAG = 6;
// A shot: its lane passes the centre at up to CN_AIM of the rim (as the rim
// stands when it fires) either side, touching down CN_IN inside it; radius
// CN_RC0 to CN_RC1 (small ones more often), speed CN_V0 for the smallest to
// CN_V1 for the biggest, give or take CN_VJ, and CN_VUP more by the round's end.
// A direct shot arcs CN_ARC m a metre of its flight from the muzzle down to
// the floor; a lob (one in CN_LOBONE from CN_LOBFROM) climbs CN_LOBH m over
// CN_LOBT0 ticks plus CN_LOBTK a metre and touches down from CN_LOBA to
// CN_LOBA + CN_LOBB of the way across. Past the far rim it falls (CN_G m/s^2)
// and is gone from the sim CN_FALLT ticks on.
export const CN_AIM = 0.8;
export const CN_IN = 0.5;
export const CN_RC0 = 1.2;
export const CN_RC1 = 2.5;
export const CN_V0 = 19;
export const CN_V1 = 13;
export const CN_VJ = 2;
export const CN_VUP = 3;
export const CN_ARC = 0.06;
export const CN_LOBFROM = 3750; // 30 s
export const CN_LOBONE = 3;
export const CN_LOBH = 10;
export const CN_LOBT0 = 125;
export const CN_LOBTK = 2;
export const CN_LOBA = 0.2;
export const CN_LOBB = 0.35;
export const CN_G = 20;
export const CN_FALLT = 75;
export const CN_WARN = 250; // ticks before the lobs and the crumbling a call says they're coming
// A cannonball meeting a ball: the ball out of it across the floor, sent off
// it at what it came in at times CN_E (at least CN_KICK), CN_SHOVE m/s more
// along the cannonball's path, and up at CN_POP.
export const CN_E = 0.5;
export const CN_KICK = 4;
export const CN_SHOVE = 4;
export const CN_POP = 4;
// The schedule, in PG_BIG: per CN_BUCKET ticks into play, u16 the first shot
// not gone by the bucket's start (CN_LO) and the first not fired by its end
// (CN_HI); then CN_NMAX shots of CN_REC B in the order they fire, what every
// ball's push reads first up front: u32 the tick into play it fires, it
// leaves the floor past the far rim | f32 its heading's x, z (a unit vector) |
// f32 its line (muzzle x * heading z - muzzle z * heading x), its radius |
// u32 the tick into play it touches down | f32 the muzzle's x, z | f32 how far
// from the muzzle it touches down, and leaves the floor | f32 its speed
// rolling, the arc's height, its speed across in flight | u32 shots in its
// volley | u8 its cannon, u8 1 lobbed + 2 the first of its volley, u16 its volley.
export const CN_BUCKET = 64;
export const CN_NB = 256;
export const CN_LO = 8192;
export const CN_HI = 8704;
export const CN_SHOTS = 9216;
export const CN_REC = 64;
export const CN_NMAX = 1024;
export const CN_FELL = 0; // in PG_S: u16 per slot, the tick into play it started going out, plus 1 (0 not yet: over's)
// Its header, byte offsets in PG_H.
export const CN_RAD = 0; // f32 the platform's radius at the start
export const CN_NC = 4; // u32 cannons
export const CN_NS = 8; // u32 shots in the schedule
export const CN_ROT = 12; // u32 the first cannon's bearing, 1/16384 turn
export const CN_RC = 16; // f32 the cannons' ring's radius
export const CN_NV = 20; // u32 volleys in the schedule
export const CN_COUNT = 24; // u32 tiles at the start
// FX kinds, FX_MG + 4 * MG_CANNON + k.
export const CN_FX_FIRE = 128; // a cannon fires: its muzzle, size the shot's radius, shot its record
export const CN_FX_HIT = 129; // a cannonball knocks a ball: where they touch, owner the ball, shot the record, size the knock (m/s); on the ball's bank
export const CN_FX_LAND = 130; // a lob touches down: where, size its radius, shot its record
export const CN_FX_CALL = 131; // a volley's stripes show (shot its volley, size how many), or 0x8001 lobs coming, 0x8002 the rim going (size 0)
