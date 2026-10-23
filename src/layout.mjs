// The one memory map. tools/asm.mjs folds these into the WAT as @NAME;
// every harness and runtime imports the same file, so nothing drifts.

export const PAGES = 64; // 4 MiB, shared, never grows

// CTRL: thread control, error slot, inbox. Never hashed, never snapshotted.
export const CTRL = 0x000000;
export const BAR_COUNT = 0x040; // own cache lines for the barrier
export const BAR_GEN = 0x080;
export const JOB_QUIT = 0x0c0;
export const JOB_NA = 0x0c4; // awake balls this tick
export const JOB_NB = 0x0c8; // 4-ball blocks with an awake ball
export const JOB_ABORT = 0x0cc; // set by any thread that fails; every barrier gives up
export const ERR_CODE = 0x240;
export const ERR_INDEX = 0x244;
export const ERR_TICK = 0x248;
export const INTERVAL_HASH = 0x300; // u64, written when slice 127 closes
export const INTERVAL_TICK = 0x308;
// The ball grid (HEAD, NEXT, CELLOF) lives outside the region and is kept up
// to date tick by tick. It is rebuilt from the region whole when GRID_OK is 0
// (init, restore, the regrid export after any outside write to the region) or
// when the tick or the ball count it was kept for is not the region's.
export const GRID_TICK = 0x310;
export const GRID_N = 0x314;
export const GRID_OK = 0x318;
export const SORT_ON = 0x31c; // 1 when tick_begin built this tick's sorted copy (SBOUND...) for contacts
export const DIGESTS = 0x400; // u64[128], slice s digested at tick K+s+1; the interval closes at K+128
export const INBOX = 0x1000; // u32 count, then records
export const INBOX_REC = 0x1010;
export const INBOX_MAX = 1024;
export const FULLDIG = 0x6000; // u64[128] scratch for the full region hash
// FX ring: blasts, shots and sinks for the renderer and the sound. Written by
// the sim, read by the main thread, never hashed. u32 count, then records:
// u32 tick | u8 kind | u8 owner | u16 shot | f32 x | f32 y | f32 z | f32 size | 8 B zero
export const FX = 0x8000;
export const FX_REC = 0x8010;
export const FX_MAX = 256;
export const FX_BLAST = 1;
export const FX_SINK = 2;
export const FX_SHOT = 3;

// REGION: all gameplay state. Hashed in 128 slices of 4 KiB, snapshotted whole.
export const REGION = 0x010000;
export const REGION_SIZE = 0x80000;
export const SLICE = 4096;
export const NSLICE = 128;
export const HDR_TICK = REGION + 0;
export const HDR_RNG = REGION + 4;
export const HDR_SEED = REGION + 8;
export const HDR_NBALLS = REGION + 12;
export const HDR_HOLE = REGION + 16; // holes started in this room
export const HDR_STATE = REGION + 20; // H_*
export const HDR_UNTIL = REGION + 24; // tick the current state ends
export const HDR_START = REGION + 28; // tick play began
export const HDR_TEE = REGION + 32; // f32 x, y, z
export const HDR_CUP = REGION + 44; // f32 x, y, z
export const HDR_DIR = REGION + 56; // f32 x, z: unit vector, tee to cup
export const HDR_PAR = REGION + 64;
export const HDR_LIVE = REGION + 68; // live players, counted every tick
export const PLAYERS = REGION + 0x100; // 256 x 64 B
export const PROJ = REGION + 0x4100; // 1024 x 32 B
export const PX = REGION + 0x10000; // f32[16384] each, structure of arrays
export const PY = REGION + 0x20000;
export const PZ = REGION + 0x30000;
export const VX = REGION + 0x40000;
export const VY = REGION + 0x50000;
export const VZ = REGION + 0x60000;
export const FLAGS = REGION + 0x70000; // u8
export const SLEEP = REGION + 0x74000; // u8
export const OWNER = REGION + 0x78000; // u16

// The prediction layer (predict.wat) writes only here. Keyframe slots.
export const PRED = 0x090000;
export const SNAP0 = 0x0a0000;
export const SNAP1 = 0x120000;

// Per-tick scratch, rebuilt every tick, never hashed.
export const DVX = 0x1a0000;
export const DVY = 0x1b0000;
export const DVZ = 0x1c0000;
export const WAKE = 0x1d0000; // u8
export const AWAKE = 0x1d4000; // u16 list
export const BLOCKS = 0x1dc000; // u16 list of 4-ball blocks
// The ball grid, kept from tick to tick (GRID_OK): each bucket a list of the
// balls in it in ascending index, the order a stable sort by bucket gives.
export const HEAD = 0x1e0000; // u16[NCELL], the bucket's first ball, 0xffff for none
export const NEXT = 0x1f0000; // u16[BALL_CAP], the next ball in the same bucket: always a higher index, or 0xffff
export const CELLOF = 0x1f8000; // u16[BALL_CAP], the ball's bucket, 0xffff for none (sunk, or not yet spawned)

// The live balls sorted by bucket, rebuilt by tick_begin when SORT_MIN or more
// are awake, never hashed: bucket b's balls are SI[SBOUND[b], SBOUND[b + 1]),
// in ascending index, with their positions copied beside them. Buckets number
// x fastest, so a row of three cells is one run of the arrays. It sits past
// the client's slots at NET, which use its first 2 KiB.
export const SBOUND = 0x300000; // u16[NCELL + 2]
export const SX = 0x320000; // f32[BALL_CAP] each, by sorted position
export const SY = 0x330000;
export const SZ = 0x340000;
export const SI = 0x350000; // u16[BALL_CAP], the ball at each sorted position
export const SORT_MIN = 768;
// Per thread, the touching balls (sorted positions) one awake ball has met so
// far: contacts take them four at a time. u16[HIT_CAP] for each of 32 threads.
export const HITS = 0x358000;
export const HIT_CAP = 64;

// Terrain, regenerated from the seed.
export const TERRAIN_H = 0x220000; // u16[512 * 512], 1/256 m
export const TERRAIN_S = 0x2a0000; // u8[512 * 512] surface type
export const TERRAIN_END = 0x2e0000;
export const NET = 0x2e0000; // the client's threads talk here; init never clears it

// The client's shared slots (main thread, net worker, sim worker, bot).
// Input, written by the main thread or a bot, sampled by the net worker every tick:
export const CL_MOVE = NET + 0; // u32 move bits (forward 1, back 2, left 4, right 8) | jump 16
export const CL_YAW = NET + 4; // u32, 1/16384 turn
export const CL_PITCH = NET + 8; // u32, 10 bits, 512 level
export const CL_PRESSES = NET + 12; // u32 shots asked for; the word's counter follows it a step a tick
export const CL_WEAPON = NET + 16; // u32 0 rocket, 1 grenade
export const CL_MOVEAT = NET + 24; // f64 epoch ms the move bits last changed, for the latency figures
// Session, written by the net worker:
export const CL_SLOT = NET + 32; // i32, -1 until the welcome
export const CL_ROOM = NET + 36; // u32 server tick of sim tick 0
export const CL_LEAD = NET + 40; // f32 ticks of input lead
export const CL_PING = NET + 44; // f32 ms, bundle slack seen by the relay (negative = late)
export const CL_DELAY = NET + 48; // f32 ticks the playout clock aims to run behind the server's: the earliest arrival, 2, the jitter
export const CL_JITTER = NET + 52; // f32 ticks, p95 of first arrivals past the earliest
export const CL_NEXT = NET + 56; // u32 one past the newest sampled input tick (server ticks)
export const CL_REPAIRS = NET + 60; // u32 ticks that came in repair datagrams
export const CL_SENT = NET + 80; // u32 shots sampled into words so far (CL_PRESSES runs ahead of it)
export const CL_MOVETICK = NET + 84; // u32 the first sampled tick with the move bits CL_MOVESEEN's change made
export const CL_MOVESEEN = NET + 88; // f64 that change's CL_MOVEAT
// Sim, written by the sim worker:
export const CL_STATE = NET + 64; // u32 0 connecting, 1 catching up, 2 playing, 3 failed
export const CL_SEQ = NET + 68; // u32, odd while the sim worker is stepping or restoring
export const CL_QUEUED = NET + 72; // u32 ticks received, not yet stepped
export const CL_KEYS = NET + 76; // u32 keyframes restored: the join's, then one per resync
// The arena's input, written by the main thread (presses counted like CL_PRESSES):
export const CL_MELEE = NET + 96; // u32 melee presses
export const CL_GREN = NET + 100; // u32 grenade presses
export const CL_RELOAD = NET + 104; // u32 reload presses
export const CL_USE = NET + 108; // u32 pickup presses
export const CL_AUTO = NET + 112; // u32 1 while an automatic's trigger is held: a shot asked for every tick
// and by the net worker, for the prediction's word in progress:
export const CL_MSENT = NET + 116; // u32 melee presses sampled; its bit is the low bit
export const CL_GSENT = NET + 120; // u32 grenade presses sampled
export const CL_FRAME = NET + 124; // u32 the frame being sent, a bit a tick
// Clocks (client/clock.mjs), 32 B each, written by the net worker:
export const CL_PLAY = NET + 128; // the playout clock, in server ticks: the confirmed world steps up to it
export const CL_PRED = NET + 160; // the predicted clock: the server tick plus the input lead
// Traffic, for the net graph (client/netgraph.mjs), counted by the net worker:
export const CL_RX_BUNDLE = NET + 192; // u32 bytes of bundle datagrams received
export const CL_RX_REPAIR = NET + 196; // u32 bytes of repair datagrams received
export const CL_RX_STREAM = NET + 200; // u32 bytes of keyframes and fills received
export const CL_TX = NET + 204; // u32 bytes of input datagrams sent
export const CL_HEARD = NET + 208; // u32 closed ticks heard, by any of them
// Input words by server tick (& 255), written by the net worker as it samples them:
export const CL_WORDS = NET + 1024;
export const PLAY_BASE = 2; // ticks of playout delay past the earliest arrival, before jitter

export const BALL_CAP = 16384;
export const NCELL = 32768; // 64 x 8 x 64 modular grid: 27 neighbours never alias, and a 26 m pit does not wrap
export const GRID = 512;
export const SPACING = 2; // metres per heightfield sample
export const WORLD = GRID * SPACING;

// Ball flags. A sunk ball has gone through the slipgate: out of the grid, never moves again.
export const F_LIVE = 1;
export const F_AWAKE = 2;
export const F_SUNK = 4;

// Players: 256 x 64 B. Position is the feet.
export const NPLAYER = 256;
export const PSIZE = 64;
export const P_PX = 0;
export const P_PY = 4;
export const P_PZ = 8;
export const P_VX = 12;
export const P_VY = 16;
export const P_VZ = 20;
export const P_IN = 24; // u32 input word, last applied
export const P_FL = 28; // u8 PF_*
export const P_FIRED = 30; // u8 shot counter of the last shot taken
export const P_REFIRE = 32; // u16 ticks until the next shot
export const P_STROKES = 34; // u16
export const P_BALL = 36; // u32 this hole's ball
export const P_DONE = 40; // u32 tick the ball went in
export const P_SCORE = 44; // u16 last hole's score
export const P_HOLES = 46; // u16 holes scored
export const P_TOTAL = 48; // u32 sum of scores
export const P_SHOTS = 52; // u16 shots fired, ever; keys flashes and sounds
export const PF_LIVE = 1;
export const PF_GROUND = 2;
export const PF_DONE = 4;

// Projectiles: 1024 x 32 B.
export const NPROJ = 1024;
export const JSIZE = 32;
export const J_PX = 0;
export const J_PY = 4;
export const J_PZ = 8;
export const J_VX = 12;
export const J_VY = 16;
export const J_VZ = 20;
export const J_AGE = 24; // u16 ticks in flight
export const J_KIND = 26; // u8 K_*, 0 = free slot
export const J_OWNER = 28; // u8
export const J_SHOT = 30; // u16 owner's shot number, keys flashes and sounds
export const K_ROCKET = 1;
export const K_GRENADE = 2;
export const ROCKET_REFIRE = 100; // 0.8 s
export const GREN_REFIRE = 75; // 0.6 s
export const FUSE = 312; // 2.5 s
export const ROCKET_LIFE = 1000;

// The prediction layer: a copy of the header, players and projectiles at PRED,
// stepped ahead for one player by the main thread's own instance. Record
// addresses carry a bank offset, 0 for the confirmed world and PRED_D here,
// so PLAYERS + PRED_D + 64p is slot p's predicted record. Only the main thread
// reads or writes PRED.
export const PRED_D = PRED - REGION;
export const PRED_COPY = PROJ + NPROJ * JSIZE - REGION; // 48.25 KiB
export const PFX = PRED + 0xc200; // ghost shots and blasts, laid out as FX
export const PTRACK = PRED + 0xe400; // after predicted tick k: f32 x, y, z, u32 tick reached
export const PWORDS = PRED + 0xf400; // u32 input word for each tick to predict
export const PRED_MAX = 256;

// Hole clock. A join starts a countdown; play ends when every live player
// is in or the limit passes; the scoreboard shows, then the hole restarts.
export const H_IDLE = 0;
export const H_COUNT = 1;
export const H_PLAY = 2;
export const H_OVER = 3;
export const COUNT_TICKS = 375; // 3 s
export const LIMIT_TICKS = 30000; // 4 min
export const OVER_TICKS = 1250; // 10 s
export const PENALTY = 2; // strokes added for not finishing
export const GREEN_R = 15; // m
export const TEE_R = 14; // m

// Event log records (16 B): u32 tick | u8 kind | u8 a | u16 b | u16 x | i16 y | u16 z | i16 c
export const EV_SPAWN = 1;
export const EV_EXPLODE = 2;
export const EV_EXPLODE_BALL = 3;
export const EV_INPUT = 4; // a = slot, u32 word at offset 8
export const EV_JOIN = 5; // a = slot
export const EV_LEAVE = 6; // a = slot
export const REC = 16;

// Physics, as the f32 literals the module inlines.
export const PHYS = {
  DT: '0.008', // 1/125 s
  G_DT: '0.07848', // 9.81 * DT
  R: '0.2',
  D2: '0.16', // (2R)^2
  TWO_R: '0.4',
  INV_CELL: '2.5', // 1 / (2R)
  E_BB: '0.2',
  PUSH: '4.0', // m/s per metre of overlap
  BOUNCE_MIN: '0.5', // below this approach speed, no restitution
  WAKE_V: '0.3',
  SLEEP_V2: '0.0144', // (0.12 m/s)^2, above one tick of gravity
  VMAX2: '3600', // (60 m/s)^2
  CEIL: '400',
  LO: '0.2',
  HI: '1021.8',
  // players, scaled from Quake at 32 units a metre
  P_R: '0.5', // radius
  P_EYE: '1.6',
  P_TOP: '1.8',
  RUN: '10', // sv_maxspeed 320
  STOP: '3', // sv_stopspeed 100
  FRIC_DT: '0.032', // sv_friction 4, per tick
  ACCEL_DT: '0.08', // sv_accelerate 10, per tick
  AIRCAP: '1', // Quake's 30-unit air wishspeed cap
  GP_DT: '0.16', // 20 m/s^2 on players, per tick
  JUMP: '7',
  SNAP: '0.25', // the ground follows walking feet within this
  PVMAX2: '6400', // (80 m/s)^2
  // weapons
  ROCKET_V: '40',
  ROCKET_S: '50', // ball impulse at the centre, m/s
  ROCKET_RAD: '5',
  GREN_V: '18',
  GREN_UP: '3',
  GREN_S: '20',
  GREN_RAD: '4',
  KNOCK: '0.5', // players take this share of a blast
  ROCKET_HIT: '0.3', // rocket centre to ball centre at contact
  GREN_R: '0.12',
  GREN_HIT: '0.32', // GREN_R + R
  // the cup
  CUP_R2: '0.25', // (0.5 m)^2
  CUP_V2: '64', // (8 m/s)^2
};
export const SLEEP_TICKS = 30;

// Every field a slice of the region overlaps, with the element range inside
// each, for compare.mjs.
export function describeSlice(s) {
  const lo = REGION + s * SLICE;
  const hi = lo + SLICE;
  const fields = [
    ['HDR', REGION, PLAYERS, 1],
    ['PLAYERS', PLAYERS, PROJ, 64],
    ['PROJ', PROJ, PROJ + 0x8000, 32],
    ['PAD', PROJ + 0x8000, PX, 1],
    ['PX', PX, PY, 4], ['PY', PY, PZ, 4], ['PZ', PZ, VX, 4],
    ['VX', VX, VY, 4], ['VY', VY, VZ, 4], ['VZ', VZ, FLAGS, 4],
    ['FLAGS', FLAGS, SLEEP, 1], ['SLEEP', SLEEP, OWNER, 1], ['OWNER', OWNER, REGION + REGION_SIZE, 2],
  ];
  const parts = [];
  for (const [name, a, b, size] of fields) {
    const from = Math.max(lo, a);
    const to = Math.min(hi, b);
    if (from < to) parts.push(`${name}[${Math.floor((from - a) / size)}..${Math.ceil((to - a) / size) - 1}]`);
  }
  return parts.join(' + ');
}

// ---- The arena: src/ built with ARENA (build/arena/game.wasm). The same
// world, netcode and lockstep, a deathmatch on it: shields and health, two
// guns carried, frag grenades, melee, pickups on pads, respawns. Golf's
// balls, cup and hole clock are left out; the hole states run the match
// (H_COUNT before it, H_PLAY during it, H_OVER for the scoreboard).
//
// Its input word, laid on golf's fields so wire v4 codes it as tightly (a
// small turn is a small yaw delta, pitch is golf's, the high byte holds what
// changes least): yaw b0-10 (1/2048 turn) | melee b11 and grenade b12 (each
// flips once a press) | gun slot b13 | pitch b14-23 (512 level) | move
// b24-27 (forward, back, left, right) | jump b28 | shot counter b29-30 |
// b31 one bit of an 8-tick frame, bit (tick & 7), the frame starting on a
// tick that is a multiple of 8. A frame's b0 says one is sent: then b1-5
// are the view lag in ticks, b6 asks for a reload, b7 a pickup. A client
// sends one only when it has news (or once a second), so between them its
// word stays put and costs nothing on the wire.
export const AW_PITCH = 14;
export const AW_MOVE = 24;
export const AW_JUMP = 28;
export const AW_SHOT = 29;
export const AW_MELEE = 11;
export const AW_GREN = 12;
export const AW_SLOT = 13;
export const AW_SERIAL = 31;
export const AF_SENT = 1; // the frame's bits
export const AF_LAG_SHIFT = 1;
export const AF_RELOAD = 64;
export const AF_USE = 128;
export const FRAME_EVERY = 128; // ticks: an unchanged lag is sent again this often
export const LAG_MAX = 31;

// A fighter's fields in the player record, where golf keeps its own.
export const A_NEEDT = 29; // u8 ticks until stuck needles fall out
export const A_RELOAD = 31; // u8 ticks of reload left
export const A_HP = 34; // u8 health, 0..100
export const A_SH = 35; // u8 shields, 0..100
export const A_SHT = 36; // u16 ticks until the shields recharge
export const A_GUN = 38; // u8 x 2, the weapon in each slot (W_*), 0 for none
export const A_MAG = 40; // u8 x 2, rounds in each
export const A_RES = 42; // u16 x 2, rounds in reserve
export const A_GRENS = 46; // u8 frag grenades
export const A_ACT = 47; // u8 AB_*: the last melee and grenade bits, the slot, a pending use
export const A_KILLS = 48; // u16
export const A_DEATHS = 50; // u16
export const A_RESPAWN = 54; // u16 ticks until a dead fighter comes back
export const A_COOL = 56; // u16 ticks until the next melee or grenade
export const A_BURST = 58; // u8 rounds left in a burst
export const A_LAG = 59; // u8 view lag in ticks, from the last whole frame
export const A_FRAME = 60; // u8 the frame so far
export const A_NEEDLES = 61; // u8 needles stuck in this fighter
export const A_NEEDLER = 62; // u8 whose
export const A_HITBY = 63; // u8 who hit this fighter last
export const AB_MELEE = 1;
export const AB_GREN = 2;
export const AB_SLOT = 4;
export const AB_USE = 8;
export const PF_DEAD = 8;
export const J_TGT = 27; // u8 a needle's target
export const J_HOME = 29; // u8 1 when it has one
export const K_BOLT = 3;
export const K_NEEDLE = 4;

// Arena state past the projectiles (not in the prediction's copy): weapon
// pads and spawn points, laid out at init from the map.
export const ARENA = REGION + 0xc100;
export const NPAD = 12;
export const PAD = ARENA; // 12 x 16 B: f32 x, y, z | u8 weapon | u8 0 | u16 ticks until it's back
export const PAD_SIZE = 16;
export const NSPAWN = 32;
export const SPAWNS = ARENA + 0x100; // 32 x 16 B: f32 x, y, z | u32 0
export const SPAWN_SIZE = 16;
// Where every fighter stood after each of the last 32 ticks, for shots
// checked where the shooter saw their target: 32 x 256 x 16 B (f32 x, y, z,
// u32 0), slot tick & 31. It takes the balls' place.
export const HIST = REGION + 0x10000;
export const HIST_TICK = NPLAYER * 16;

// The match. FIESTA 1: ten minutes, everyone spawning with two guns drawn at
// random and two frags, no guns on the map, the most kills at the end wins.
// FIESTA 0 (slayer): an assault rifle and a magnum, guns on pads, first to
// FRAG_LIMIT kills or the most at the end. A build-time switch (#if FIESTA).
export const FIESTA = 1;
export const FRAG_LIMIT = 25;
export const MATCH_TICKS = 75000; // 10 min
export const RESPAWN_TICKS = 375; // 3 s
export const SHIELD_DELAY = 625; // 5 s without a hit before the shields come back
export const NEEDLE_TICKS = 250; // 2 s
export const SUPERCOMBINE = 7; // needles in one fighter at once
export const COOL_TICKS = 80;
export const SWAP_TICKS = 40;
export const A_FUSE = 225; // 1.8 s

// The map (tools/map.mjs builds it from maps/<name>/ into the arena's wasm, as
// a passive data segment that init copies out): static, the same on every
// machine, outside the region like the terrain, so never hashed or
// snapshotted. Its height and surface images go straight into TERRAIN_H and
// TERRAIN_S; the rest lands here. The structures are axis-aligned boxes in
// groups, each group with the box that bounds it, so a query skips whole
// buildings; teleporters are one-way, from a pad to a point.
export const MAP = 0x200000;
export const MAP_NBOX = MAP + 0; // u32
export const MAP_NGROUP = MAP + 4;
export const MAP_NTELE = MAP + 8;
export const MAP_NSPAWN = MAP + 12;
export const MAP_NPAD = MAP + 16;
export const MAP_BOUNDS = MAP + 32; // f32 x0, x1, z0, z1: where fighters can go
export const MAP_SPAWN = MAP + 0x40; // 32 x 8 B: f32 x, z; a fighter spawns on what is under (x, z) from MAP_SPAWNY up
export const MAP_SPAWNY = MAP + 0x140; // 32 x f32: the highest feet a spawn may stand at (-1000: the ground)
export const MAP_PADS = MAP + 0x1c0; // 12 x 16 B: f32 x, z, top (as MAP_SPAWNY) | u32 weapon
export const MAP_TELE = MAP + 0x280; // 16 x 32 B: f32 x, y, z, radius, to x, y, z | u32 0
export const MAP_HEAD = 0x480; // the bytes above, copied whole
export const MAP_GROUPS = MAP + 0x480; // 64 x 32 B: f32 x0, y0, z0, x1, y1, z1 | u32 first box, count
export const MAP_BOXES = MAP + 0xc80; // 512 x 32 B: f32 x0, y0, z0, x1, y1, z1 | u32 material, group
export const MAP_END = MAP + 0x4c80;
export const NBOX = 512;
export const NGROUP = 64;
export const NTELE = 16;
export const BOX_SIZE = 32;
export const TELE_SIZE = 32;
export const STEP = '0.5'; // a fighter walks up onto a box this much higher than its feet
export const MAPS = 'maps';
export const MAP_NAME = 'bloodgulch'; // the arena's map unless the build is given another

// Weapons, by W_* (index 0 is none). Reloads fit a u8 of ticks. type: 0 hitscan, 1 projectile, 2 sword.
// head: 0 none, 1 a headshot kills once the shields are down, 2 it always
// kills. spread in yaw units (1/16384 turn). The sim reads this through the
// (!arm field w) macro, the client for the HUD.
export const W_AR = 1;
export const W_BR = 2;
export const W_MAGNUM = 3;
export const W_SNIPER = 4;
export const W_SHOTGUN = 5;
export const W_ROCKET = 6;
export const W_PLASMA = 7;
export const W_NEEDLER = 8;
export const W_SWORD = 9;
export const ARMS = [
  null,
  { name: 'ASSAULT RIFLE', type: 0, auto: 1, refire: 11, mag: 32, res: 192, dmg: 8, head: 0, spread: 40, pellets: 1, range: 90, reload: 220, zoom: 1 },
  { name: 'BATTLE RIFLE', type: 0, auto: 0, refire: 44, mag: 36, res: 108, dmg: 9, head: 1, spread: 6, pellets: 1, range: 160, reload: 220, zoom: 2, burst: 3 },
  { name: 'MAGNUM', type: 0, auto: 0, refire: 22, mag: 8, res: 40, dmg: 28, head: 1, spread: 4, pellets: 1, range: 110, reload: 160, zoom: 2 },
  { name: 'SNIPER RIFLE', type: 0, auto: 0, refire: 75, mag: 4, res: 20, dmg: 120, head: 2, spread: 0, pellets: 1, range: 420, reload: 240, zoom: 5 },
  { name: 'SHOTGUN', type: 0, auto: 0, refire: 105, mag: 6, res: 18, dmg: 15, head: 0, spread: 260, pellets: 15, range: 28, reload: 250, zoom: 1 },
  { name: 'ROCKET LAUNCHER', type: 1, auto: 0, refire: 110, mag: 2, res: 6, dmg: 230, head: 0, spread: 0, pellets: 1, range: 0, reload: 250, zoom: 2, kind: 1, speed: 36 },
  { name: 'PLASMA RIFLE', type: 1, auto: 1, refire: 13, mag: 100, res: 0, dmg: 10, head: 0, spread: 40, pellets: 1, range: 0, reload: 0, zoom: 1, kind: 3, speed: 70 },
  { name: 'NEEDLER', type: 1, auto: 1, refire: 14, mag: 20, res: 60, dmg: 6, head: 0, spread: 70, pellets: 1, range: 0, reload: 230, zoom: 1, kind: 4, speed: 34 },
  { name: 'ENERGY SWORD', type: 2, auto: 0, refire: 70, mag: 10, res: 0, dmg: 255, head: 0, spread: 0, pellets: 1, range: 5, reload: 0, zoom: 1 },
];
export const MELEE_DMG = 70;
export const GREN_DMG = 150;
export const SUPER_DMG = 250;
// kill feed causes past the weapons
export const KILL_GREN = 10;
export const KILL_MELEE = 11;
export const KILL_BEHIND = 12;
export const KILL_SUPER = 13;
export const KILL_FALL = 14;

// More FX kinds, for the arena. A tracer's record is its end (the hit, or
// where the ray gave out), the weapon as its size, the shot number; a hit's is
// where it landed, the victim as `shot`, and what it struck as its size
// (1 shields, 2 health, 3 the head); a kill's, the killer as owner, the victim
// as `shot`, the cause (W_* or KILL_*) as its size.
export const FX_TRACER = 4;
export const FX_HIT = 5;
export const FX_KILL = 6;
export const FX_SPAWN = 7;
export const FX_PICKUP = 8;
export const FX_MELEE = 9;
export const FX_TELE = 10; // a fighter through a teleporter: where it came out, the slot as owner
