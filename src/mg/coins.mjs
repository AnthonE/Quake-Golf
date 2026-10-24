// COIN RUSH (MG_COINS, prefix cr): coins rain onto a disc over the sea, and a
// ball that rolls into one takes it (PG_SCORE). A ball bumped hard loses
// coins, knocked loose for anyone; a ball that falls off spills half of them
// back over the rim. Lit bumpers pay; a jackpot, called 3 s ahead, erupts a
// fountain of coins; the last 15 s are a frenzy. Most coins at the time wins.
export const CR_R0 = 12; // the disc: 12 m plus CR_RK times the root of the balls in, at most CR_RMAX
export const CR_RK = 3;
export const CR_RMAX = 60;
export const CR_SPAWN = 0.7; // balls start on a spiral over this much of the disc
export const CR_LEN = 9375; // 75 s
export const CR_IDLE = 0.985; // rolling drag a tick with no keys: from 10 m/s to a stop in about 5 m
// The rain: a wave every CR_EVERY ticks (every CR_EVERYF in the frenzy) of
// 1 + (balls in the room) / CR_RAINN coins at spots on the disc, each falling
// from CR_RAINH m for CR_RAINAIR ticks; 1 in CR_BIG is big (1 in CR_BIGF in the frenzy).
export const CR_EVERY = 32; // 0.256 s
export const CR_EVERYF = 16;
export const CR_RAINN = 10;
export const CR_RAINH = 18;
export const CR_RAINAIR = 125; // 1 s
export const CR_BIG = 16;
export const CR_BIGF = 6;
export const CR_BIGV = 5; // a big coin's worth
export const CR_FRENZY = 7500; // ticks into play the frenzy starts: the last 15 s
// A coin.
export const CR_MAX = 512; // records in PG_BIG (a power of two: the allocator's cursor wraps by mask)
export const CR_RAINCAP = 384; // no rain while this many are in: the rest kept for coins knocked loose, spilled and thrown up by a jackpot
export const CR_LIFE = 1250; // ticks a coin lies before it goes: 10 s
export const CR_CY = 0.55; // a lying coin's centre over the floor, m
export const CR_REACH = 0.6; // taken by the first ball (by slot) whose centre comes within its radius and this
export const CR_GRABH = 3.2; // m over the floor a coin comes within reach (a hop's top)
export const CR_RIM = 1.5; // no coin lies nearer the rim than this
export const CR_LOOSE = 40; // ticks a coin knocked or spilled loose flies before anyone may take it
export const CR_JWAIT = 25; // and a jackpot's
// Hits: a ball bumped (not the one that did the bumping) whose speed jumps by
// more than CR_HARD m/s loses a coin, one more each CR_HARDK m/s past it, at
// most CR_KNOCK; they land CR_KNOCKR0 to CR_KNOCKR0 + CR_KNOCKRK m off. A bump
// changes each ball's speed by B_KICK / 2 plus the speed they closed at, and
// bumper's hard bump (whose hitter it counts in B_BUMPS) closes at 4 m/s or
// more: so only hard bumps knock coins loose, and only the hit ball's.
export const CR_HARD = 6.6;
export const CR_HARDK = 2.5;
export const CR_KNOCK = 3;
export const CR_GRACE = 75; // ticks after a knock that the next hit knocks nothing loose: a pile-up drains no one

export const CR_KNOCKR0 = 2.5;
export const CR_KNOCKRK = 3.5;
// A fall loses half: spilled back in over the rim, CR_BIGV a coin and then 1s, at most CR_SPILLMAX coins.
export const CR_SPILLMAX = 12;
// Jackpots: number j erupts CR_JACK0 + j * CR_JACKP ticks into play (while
// the round lasts), called CR_JACKW before at a spot within CR_JACKIN of the
// disc; CR_JACKN0 + (balls in the room) / CR_JACKNK coins, at most
// CR_JACKMAX, every CR_JACKBIG-th one big, thrown out over CR_JACKSPAN ticks to
// land within CR_JACKR0 + CR_JACKRK * sqrt(coins) m.
export const CR_JACK0 = 1250; // 10 s
export const CR_JACKP = 1750; // 14 s
export const CR_JACKW = 375; // 3 s
export const CR_JACKIN = 0.55;
export const CR_JACKN0 = 10;
export const CR_JACKNK = 5;
export const CR_JACKMAX = 64;
export const CR_JACKBIG = 6;
export const CR_JACKSPAN = 100;
export const CR_JACKR0 = 1.5;
export const CR_JACKRK = 0.8;
// Bumpers: posts that throw a ball off at CR_KICK m/s at least; a lit one
// pays the ball that hits it CR_BPAY and goes dark for CR_BDARK ticks. Their
// number is the disc's area over CR_BAREA m^2, CR_NBMIN to CR_NBMAX, on a
// sunflower over CR_BRING of the disc.
export const CR_BR = 1.3; // radius, m
export const CR_BH = 1.4; // height over the floor, m: a hop doesn't clear it
export const CR_KICK = 8;
export const CR_BPAY = 3;
export const CR_BDARK = 625; // 5 s
export const CR_BAREA = 110;
export const CR_NBMIN = 3;
export const CR_NBMAX = 10;
export const CR_BRING = 0.62;
// The balls' grid for the takes, rebuilt every tick: CR_GN x CR_GN cells of
// CR_CELL m from the stage's centre less CR_GN * CR_CELL / 2.
export const CR_CELL = 4;
export const CR_GN = 32;

// Its header, byte offsets in PG_H.
export const CR_RAD = 0; // f32 the disc's radius
export const CR_NB = 4; // u32 bumpers
export const CR_CURSOR = 8; // u32 the next coin record the allocator tries
export const CR_JX = 12; // f32 the last jackpot called: its spot, x
export const CR_JZ = 16; // f32 and z
export const CR_JK = 20; // u32 jackpots called so far
export const CR_LIVE = 24; // u32 coins in the records
// In PG_S: the bumpers (16 B each: f32 x, z | u32 the tick into play it's lit from | u32 hits),
// then a record per slot (CR_BSIZE B).
export const CR_BUMP = 0;
export const CR_BALL = 256;
export const CR_BSIZE = 16;
export const CR_B_VX = 0; // f32 its velocity at the last tick's end, x
export const CR_B_VZ = 4; // f32 and z
export const CR_B_BUMPS = 8; // u16 its B_BUMPS then
export const CR_B_FL = 10; // u8 CR_F*
export const CR_B_SAFE = 12; // u32 the HDR_TICK till which a hit knocks nothing more loose
export const CR_FSPILT = 1; // this fall's coins spilled
// A ball's PG_M: the HDR_TICK it was last thrown off a bumper, shifted 4 up, or'd with the bumper's index + 1
// (written by the ball's own push on either bank, so the prediction's record has it too).
// In PG_BIG: the coins (CR_CSIZE B each), then the grid's heads (u16 a cell, 0xffff empty) and its links (u16 a slot).
export const CR_COINS = 0;
export const CR_GRID = 0x4000;
export const CR_GNEXT = 0x4800;
// A coin: flying from (x0, y0, z0) on tick t0 to lie at (x, z) after air ticks,
// h m of arc over the straight line between (y = y0 + (yl - y0) u + 4 h u (1 - u),
// u the share of air gone); worth v (0: a free record); its kind (CR_K*).
export const CR_CSIZE = 32;
export const CR_C_X = 0; // f32
export const CR_C_Z = 4; // f32
export const CR_C_X0 = 8; // f32
export const CR_C_Y0 = 12; // f32
export const CR_C_Z0 = 16; // f32
export const CR_C_H = 20; // f32
export const CR_C_T0 = 24; // u32 HDR_TICK
export const CR_C_AIR = 28; // u16 ticks
export const CR_C_V = 30; // u8
export const CR_C_KIND = 31; // u8
export const CR_KRAIN = 0; // from the sky
export const CR_KLOOSE = 1; // knocked loose or spilled: CR_LOOSE ticks before it's anyone's
export const CR_KJACK = 2; // a jackpot's: CR_JWAIT
// FX kinds, FX_MG + 4 * MG_COINS + k.
export const CR_FX_TAKE = 68; // a take: the taker as owner, the coin's record as shot (CR_MAX + i: bumper i's pay), the worth as size
export const CR_FX_LOSE = 69; // coins lost: the loser as owner, how many as shot, where they burst from, size 0 a knock, 1 a fall
export const CR_FX_CALL = 70; // the stage: shot 0 a jackpot called, 1 it erupts (size its coins), 2 the frenzy; owner 255
export const CR_FX_BUMP = 71; // a bumper throws a ball off: the ball as owner, the bumper as shot, the speed out as size
