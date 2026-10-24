// MUSICAL PADS (MG_PADS, prefix mp): a round floor, a giant record, over the
// sea. The music plays; when it stops pads light up, fewer than the balls in;
// MP_WIN ticks later each pad is held by the ball nearest its centre and every
// other ball is out. The floor closes in to fit the balls left; again.
export const MP_R0 = 10; // the floor: MP_R0 m plus MP_RK times the root of the balls in, at most MP_RMAX
export const MP_RK = 2.8;
export const MP_RMAX = 60;
export const MP_SPAWN = 0.7; // balls start on a spiral over this much of the floor
export const MP_LEN = 18750; // 150 s
export const MP_IDLE = 0.975; // rolling drag a tick with no keys: from 10 m/s to a stop in about 3 m, onto a pad
export const MP_PAD_R = 2; // a pad's radius: a ball whose centre is within it is on it
export const MP_GAP = 5.5; // m at least between two pads' centres, where the floor has room
export const MP_EDGE = 2.5; // m a pad's centre keeps in from the rim
export const MP_HIGH = 1.2; // a ball's bottom at most this over the floor to hold a pad (a hop's top is 0.9)
export const MP_TRIES = 24; // spots tried for a pad, the one furthest from the rest kept
export const MP_NMAX = 128; // pads at most (256 balls: 128)
// A cycle, in ticks into play: the music (MP_M0 .. MP_M1, from $p_seed), the
// scramble (MP_WIN, MP_WIN1 under MP_FEW balls), the claim, MP_PAUSE, again.
export const MP_M0 = 500; // 4 s
export const MP_M1 = 1125; // 9 s
export const MP_WIN = 500; // 4 s
export const MP_WIN1 = 375; // 3 s
export const MP_FEW = 16;
export const MP_PAUSE = 125; // 1 s from the claim to the music
export const MP_SHRINK0 = 125; // the rim starts closing in this long after a claim
export const MP_SHRINKT = 500; // and takes this long (3.3 m/s at 256 balls)
export const MP_CHAIRS = 6; // up to this many balls in, one pad fewer than balls; over it, half as many, rounded up
export const MP_GLIDEN = 8; // up to this many balls in, the pads glide through the scramble
export const MP_GLIDE = 5; // m a gliding pad goes
export const MP_FINALS = 2; // the last two play for this many claims of the one pad: the final's a best of three
export const MP_KMUSIC = 0x30000; // $p_seed key: cycle c's music from MP_KMUSIC + c
// Its header, byte offsets in PG_H (in the prediction's copy).
export const MP_R = 0; // f32 the floor's radius at the start
export const MP_RIMA = 4; // f32 the rim before it last closed in
export const MP_RIMB = 8; // f32 the rim after
export const MP_RIMT = 12; // u32 tick into play it starts closing in, over MP_SHRINKT
export const MP_CYCLE = 16; // u32 the cycle now, from 0
export const MP_START = 20; // u32 tick into play its music started
export const MP_STOP = 24; // u32 tick into play its music stops and the pads light
export const MP_CLAIM = 28; // u32 tick into play of its claim
export const MP_NEXT = 32; // u32 tick into play the next cycle's music starts
export const MP_NPAD = 36; // u32 its pads
export const MP_GOLD = 40; // u32 the gold pad's index, 255 none
export const MP_GLIDES = 44; // u32 1 if its pads glide
export const MP_N = 48; // u32 balls in as it started
export const MP_HELD = 52; // u32 pads held at the last claim
export const MP_LOST = 56; // u32 balls out at the last claim
// In PG_S.
export const MP_PADS = 0; // MP_NMAX x 16 B: f32 x0, z0 (where it lights), x1, z1 (where it is at the claim)
export const MP_HOLD = 2048; // u8 a pad: who held it at the last claim, 255 nobody
export const MP_PADOF = 2176; // u8 a slot: the pad it held at the last claim, 255 none
export const MP_WON = 2432; // u8 a slot: claims it has lived through this round
export const MP_FINAL = 2688; // u8 a slot: claims of the final it has won
// FX kinds, FX_MG + 4 * MG_PADS + k: owner 255 (but a final's point), at the stage's centre. The gold
// pad's power-up is bumper's FX_PICKUP (owner its holder, shot the pad, at the pad).
export const MP_FX_MUSIC = 56; // the music starts: shot the cycle, size the pads to come
export const MP_FX_STOP = 57; // the music stops, the pads light: shot the cycle, size the scramble in ticks
export const MP_FX_CLAIM = 58; // the claim: shot the pads held, size the balls out (0 held: nobody is out); owner a final's point's winner
export const MP_FX_CLOSE = 59; // the rim starts closing in: shot the cycle, size the rim it closes to
