// HOOPLA (MG_HOOPS, prefix ho): a wide round court over the sea, three low
// ramps in its hub aimed out, bounce pads on the floor, and hoops riding
// orbits round the hub, each orbit at its own speed and the next one the
// other way round. Roll through a hoop's ring for a point (hop the raised
// ones); gold hoops bob up and down, spin faster and are worth 3. The same
// ball scores the same hoop again only HO_AGAIN later; the last 15 s every
// hoop is worth double. Off the rim and you're down 2 s; most points at 90 s
// wins.
// Literal numbers only: the sim reads them through layout.mjs's MG_CONSTS,
// the client imports this file itself.
export const HO_R0 = 22; // the court: HO_R0 m plus HO_RK times the root of the balls in, at most HO_RMAX
export const HO_RK = 3;
export const HO_RMAX = 64;
export const HO_LEN = 11250; // 90 s
export const HO_DOUBLE = 9375; // ticks into play every hoop starts paying double: the last 15 s
export const HO_IDLE = 0.985; // rolling drag a tick with no keys: from 10 m/s to a stop in about 5 m
export const HO_HOP = 8; // hop speed, m/s: a ball's bottom 1.6 m up, 0.8 s in the air
export const HO_RESPAWN = 250; // ticks a ball that fell waits: 2 s
// The orbits: the first HO_ORB0 m out, one every HO_GAP m while it stays
// HO_EDGE in from the rim, at most HO_OMAX; an orbit's hoops ride it at HO_V0
// to HO_V1 m/s (the next orbit out turning the other way), each wobbling
// HO_WOB m in and out of it.
export const HO_ORB0 = 11.5;
export const HO_GAP = 7;
export const HO_EDGE = 4.5;
export const HO_OMAX = 8;
export const HO_V0 = 1.6;
export const HO_V1 = 2.8;
export const HO_WOB = 1;
// The hoops: HO_N0 plus one for every HO_NK balls in, at most HO_NMAX, shared
// over the orbits by their length and evenly round each; one in HO_GOLDK gold
// (one at least), one in HO_RAISEK of the rest raised.
export const HO_N0 = 6;
export const HO_NK = 8;
export const HO_NMAX = 40;
export const HO_GOLDK = 6;
export const HO_RAISEK = 3;
// A hoop's ring: radius HO_RMID plus HO_RVAR times a slow sine (2.5 to 3.9 m
// across), a gold one's HO_GMID and HO_GVAR; its bottom HO_FOOT over the
// floor, a raised one's HO_LIFT (a rolling ball's centre passes under it, a
// hop's goes through), a gold one's bobbing from HO_FOOT to HO_GOLDB.
export const HO_RMID = 1.6;
export const HO_RVAR = 0.35;
export const HO_GMID = 1.45;
export const HO_GVAR = 0.2;
export const HO_FOOT = 0.15;
export const HO_LIFT = 1.3;
export const HO_GOLDB = 2.4;
// The rates its angles turn at, 2^-24 turn a tick (2^24 / (seconds * 125)):
// its facing (from the way out from the centre) once round in 40 to 20 s, a
// gold one's in 12 to 8 s, either way; its size breathing over 14 to 8 s;
// its wobble over 18 to 10 s, a gold one's (and its bob) over 6 to 4 s.
export const HO_SPIN0 = 3355;
export const HO_SPIN1 = 6711;
export const HO_GSPIN0 = 11185;
export const HO_GSPIN1 = 16777;
export const HO_SZ0 = 9586;
export const HO_SZ1 = 16777;
export const HO_WB0 = 7457;
export const HO_WB1 = 13422;
export const HO_GB0 = 22369;
export const HO_GB1 = 33554;
// Scoring, the confirmed world's: a ball in whose centre crosses a hoop's
// plane from the last tick to this one (the hoop as it was on each), moving
// itself through it at HO_MOVE m a tick or more, inside its radius there.
export const HO_MOVE = 0.01; // 1.25 m/s: a hoop drifting over a still ball scores it nothing
export const HO_AGAIN = 375; // ticks before the same ball scores the same hoop again: 3 s
export const HO_GOLDV = 3; // a gold hoop's worth (the rest 1), twice it from HO_DOUBLE
export const HO_BAND = 4.5; // m either side of an orbit a ball's centre may be to cross one of its hoops (wobble, radius, a tick's roll)
export const HO_LEADGAP = 125; // ticks between two HO_FX_LEAD: a tight race doesn't flood the feed
// The ramps: HO_NR wedges in the hub, toe HO_RT0 out from the centre, rising
// HO_RH over HO_RL toward the rim, HO_RW either side of their middle; their
// sides and back are walls. A ball on one is pulled down it at HO_PULL m/s^2
// a unit of slope and rises HO_RISE of the slope's rate (so it leaves the lip
// flying); one just over it, not rising faster than HO_SNAPV, is put back on it.
export const HO_NR = 3;
export const HO_RT0 = 2;
export const HO_RL = 4.5;
export const HO_RH = 1.2;
export const HO_RW = 1.6;
export const HO_PULL = 14;
export const HO_RISE = 0.9;
export const HO_SNAP = 0.4;
export const HO_SNAPV = 1.5;
export const HO_WALLE = 0.4; // what of a ball's speed into a ramp's wall it bounces back with
// The pads: one on each orbit's line, a second on every orbit from the third
// out, where its hoops pass over; a ball rolling onto one (its centre within
// HO_PADR) is thrown up at HO_PADV (its bottom 3.6 m up).
export const HO_PADR = 1.4;
export const HO_PADV = 12;
export const HO_NPMAX = 14;
// Where the balls start: a sunflower over the ring from HO_SP0 m out to
// HO_SP1 of the radius, at least HO_PADGAP from a pad's middle.
export const HO_SP0 = 8.5;
export const HO_SP1 = 0.85;
export const HO_PADGAP = 2.4;
// Its header, byte offsets in PG_H (112 B, in the prediction's copy).
export const HO_RAD = 0; // f32 the court's radius
export const HO_NH = 4; // u32 hoops
export const HO_NRAMP = 8; // u32 ramps
export const HO_NP = 12; // u32 pads
export const HO_NO = 16; // u32 orbits
export const HO_LEAD = 20; // u32 the slot with the most points (0xffff none: 255 is a slot), for the crown
export const HO_LEADT = 24; // u32 ticks into play of the last HO_FX_LEAD
// In PG_S, fixed for the round at setup (the prediction reads the ramps and the pads):
export const HO_RAMPS = 0; // a ramp, 16 B: f32 x, z of its toe's middle | f32 cos, sin of its way up
export const HO_PADS = 64; // a pad, 8 B: f32 x, z
export const HO_ORBS = 192; // an orbit, 16 B: f32 radius | u32 its first hoop | u32 its hoops | i32 their rate round, 2^-24 turn a tick
export const HO_HOOPS = 320; // a hoop, HO_HSIZE B
export const HO_HSIZE = 48;
export const HO_H_RHO = 0; // f32 its orbit's radius
export const HO_H_A0 = 4; // u32 its angle round the centre as play starts, 2^-24 turn
export const HO_H_W = 8; // i32 that angle's rate
export const HO_H_F0 = 12; // u32 its facing from the way out, as play starts
export const HO_H_FW = 16; // i32
export const HO_H_S0 = 20; // u32 its size's phase
export const HO_H_SW = 24; // i32
export const HO_H_B0 = 28; // u32 its wobble's (and a gold one's bob's) phase
export const HO_H_BW = 32; // i32
export const HO_H_KIND = 36; // u32 HO_K*
export const HO_H_ORB = 40; // u32 its orbit
export const HO_H_HITS = 44; // u32 times scored this round (the confirmed world's)
export const HO_KFLOOR = 0;
export const HO_KRAISED = 1;
export const HO_KGOLD = 2;
// f32 x, y, z a slot: its ball's centre at the last tick's end (the confirmed world's).
export const HO_PREV = 2304;
// In PG_BIG: u16 a slot and hoop (slot * HO_NMAX + hoop), the tick into play
// plus 1 that the slot last scored it (0 never); then the hoops on the last
// tick and on this one, 32 B each (f32 x, z, centre y, radius, normal x, z),
// worked out again at the start of every tick.
export const HO_LAST = 0;
export const HO_NOW = 0x5000;
// Its FX kinds are FX_MG + 4 * MG_HOOPS + k, k 0 to 3: 108 to 111.
export const HO_FX_SCORE = 108; // a ball through a hoop: owner the ball, shot the hoop, where it crossed, size the points
export const HO_FX_PAD = 109; // a pad throws a ball up (on its own bank's ring): owner the ball, shot the pad, at the pad, size the speed
export const HO_FX_CALL = 110; // the stage: shot 0 double points from now; owner 255, at the centre
export const HO_FX_LEAD = 111; // a new leader: owner the slot, shot the last (0xffff none), size its points
