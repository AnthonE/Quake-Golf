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
export const ERR_CODE = 0x240;
export const ERR_INDEX = 0x244;
export const ERR_TICK = 0x248;
export const INTERVAL_HASH = 0x300; // u64, written when slice 127 closes
export const INTERVAL_TICK = 0x308;
export const DIGESTS = 0x400; // u64[128], slice s digested at tick K+s
export const INBOX = 0x1000; // u32 count, then records
export const INBOX_REC = 0x1010;
export const INBOX_MAX = 1024;
export const FULLDIG = 0x6000; // u64[128] scratch for the full region hash

// REGION: all gameplay state. Hashed in 128 slices of 4 KiB, snapshotted whole.
export const REGION = 0x010000;
export const REGION_SIZE = 0x80000;
export const SLICE = 4096;
export const NSLICE = 128;
export const HDR_TICK = REGION + 0;
export const HDR_RNG = REGION + 4;
export const HDR_SEED = REGION + 8;
export const HDR_NBALLS = REGION + 12;
export const PLAYERS = REGION + 0x100; // 256 x 64 B, M2
export const PROJ = REGION + 0x4100; // 1024 x 32 B, M2
export const PX = REGION + 0x10000; // f32[16384] each, structure of arrays
export const PY = REGION + 0x20000;
export const PZ = REGION + 0x30000;
export const VX = REGION + 0x40000;
export const VY = REGION + 0x50000;
export const VZ = REGION + 0x60000;
export const FLAGS = REGION + 0x70000; // u8
export const SLEEP = REGION + 0x74000; // u8
export const OWNER = REGION + 0x78000; // u16

// Prediction writes only here (M2). Keyframe slots.
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
export const CELLSTART = 0x1e0000; // u32[NCELL + 1]
export const CURSOR = 0x1f1000; // u32[NCELL]
export const SORTED = 0x201000; // u16[BALL_CAP]
export const CELLOF = 0x209000; // u16[BALL_CAP]

// Terrain, regenerated from the seed.
export const TERRAIN_H = 0x220000; // u16[512 * 512], 1/256 m
export const TERRAIN_S = 0x2a0000; // u8[512 * 512] surface type
export const TERRAIN_END = 0x2e0000;
export const NET = 0x2e0000; // M0 rings

export const BALL_CAP = 16384;
export const NCELL = 16384; // 32 x 16 x 32 modular grid: 27 neighbours never alias
export const GRID = 512;
export const SPACING = 2; // metres per heightfield sample
export const WORLD = GRID * SPACING;

// Flags
export const F_LIVE = 1;
export const F_AWAKE = 2;

// Event log records (16 B): u32 tick | u8 kind | u8 a | u16 b | u16 x | i16 y | u16 z | i16 c
export const EV_SPAWN = 1;
export const EV_EXPLODE = 2;
export const EV_EXPLODE_BALL = 3;
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
};
export const SLEEP_TICKS = 30;

// The slice of the region a byte offset falls in, for compare.mjs.
export function describeSlice(s) {
  const off = REGION + s * SLICE;
  const fields = [
    ['HDR', REGION, REGION + 0x100, 1],
    ['PLAYERS', PLAYERS, PROJ, 64],
    ['PROJ', PROJ, PROJ + 0x8000, 32],
    ['PAD', PROJ + 0x8000, PX, 1],
    ['PX', PX, PY, 4], ['PY', PY, PZ, 4], ['PZ', PZ, VX, 4],
    ['VX', VX, VY, 4], ['VY', VY, VZ, 4], ['VZ', VZ, FLAGS, 4],
    ['FLAGS', FLAGS, SLEEP, 1], ['SLEEP', SLEEP, OWNER, 1], ['OWNER', OWNER, REGION + REGION_SIZE, 2],
  ];
  for (const [name, a, b, size] of fields) {
    if (off >= a && off < b) {
      const first = (off - a) / size;
      return `${name}[${first}..${first + SLICE / size - 1}]`;
    }
  }
  return `offset 0x${off.toString(16)}`;
}
