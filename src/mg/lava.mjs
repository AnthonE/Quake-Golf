// RISING LAVA (MG_LAVA, prefix lv): a rock tower in a crater of lava, a
// route winding up round it from a wide shelf at its foot to a crown on its
// summit. The route is a band LV_W wide on the tower's side, a helix: ramps
// (boulders rolling down most of them), broad steps a hop high, short gaps
// to hop, platforms sliding back and forth across longer ones, and narrow
// ledges, a turn of the tower above the one before. The lava is still for
// LV_STILL, then rises faster every LV_PH; a ball whose centre goes under it
// is out. The first to touch the crown wins; the rest place by the order
// they touched it, then the climbers by the height they reached, then the
// lava's victims, the last to go first.
// Literal numbers only: the sim reads them through layout.mjs's MG_CONSTS,
// the client imports this file itself.
export const LV_LEN = 15000; // 120 s at most: the lava is over the summit well before
export const LV_RT = 14; // m: the tower's radius, its top the summit
export const LV_W0 = 7.5; // the route's width: 7.5 m plus LV_WK times the root of the balls in, at most LV_WMAX
export const LV_WK = 0.55;
export const LV_WMAX = 17;
export const LV_SH0 = 6; // m of shelf past the route's outer edge: LV_SH0 plus LV_SHK times the root of the balls in
export const LV_SHK = 0.6;
export const LV_ST0 = 14; // m of flat start along the route's middle: LV_ST0 plus LV_STK times the root of the balls in
export const LV_STK = 1.6;
export const LV_SP = 2.4; // m between balls on the start, along and across
export const LV_EDGE = 1.3; // m a start spot keeps from the tower, the shelf's rim and the start's ends
export const LV_IDLE = 0.985; // rolling drag a tick with no keys: a brake for the ledges and the gaps
export const LV_HMIN = 40; // m: the route climbs at least this far before its summit
export const LV_DEEP = 3; // m under a floor's top a ball is still against its face (its slab and a ball's height); deeper, under it
export const LV_SNAP = 0.25; // m: a ball this little over its floor and not rising is on it (so it rolls down a ramp without leaving it)
export const LV_PULL = 8; // m/s^2 a unit of slope pulls a ball on a ramp down it
export const LV_BOUNCE = 0.3; // what a wall gives back of a ball's speed into it
export const LV_RAIL = 1.2; // m: the rail along the route's outer edge (not the start's, a ledge's or over a gap) over its floor
export const LV_ENDD = 3; // m behind the start's end the first turn's end face reaches (it is the first turn's top end, solid down to the shelf)
// The sections, laid from the round's seed: a ramp LV_RAMP_L0 to + LV_RAMP_LK m rising LV_RAMP_S0 to + LV_RAMP_SK a metre;
// steps of LV_STEP_H (a hop) on treads LV_TREAD long, LV_STEPS0 to + LV_STEPSK - 1 of them; a gap LV_GAP0 to + LV_GAPK
// with LV_GAP_A of run-up and LV_GAP_B of landing; a slider, a platform LV_SL_L long moving LV_SL_D across a gap of the
// two, back and forth every LV_SL_P0 to + LV_SL_PK ticks, still LV_SL_DW at each end; a ledge LV_LEDGE_L0 to + LV_LEDGE_LK
// long, the route narrowed to LV_LEDGE_K of its width (LV_LEDGE_MIN at least) by the tower over LV_TAPER at each end,
// rising LV_LEDGE_RISE; and the summit's LV_SUM_L, flush with the tower's top.
export const LV_RAMP_L0 = 30;
export const LV_RAMP_LK = 10;
export const LV_RAMP_S0 = 0.16;
export const LV_RAMP_SK = 0.08;
export const LV_STEP_H = 0.6;
export const LV_TREAD = 3.4;
export const LV_STEP_V = 3; // m/s up the way a ball rising off a tread within LV_STEP_D of the riser ahead is given at least: a hop climbs a step
export const LV_STEP_D = 0.5;
export const LV_STEPS0 = 5;
export const LV_STEPSK = 3;
export const LV_GAP_A = 6;
export const LV_GAP0 = 2.6;
export const LV_GAPK = 1;
export const LV_GAP_B = 5;
export const LV_SL_A = 5;
export const LV_SL_L = 7;
export const LV_SL_D = 3.2;
export const LV_SL_B = 5;
export const LV_SL_P0 = 400;
export const LV_SL_PK = 150;
export const LV_SL_DW = 70;
export const LV_LEDGE_L0 = 24;
export const LV_LEDGE_LK = 8;
export const LV_LEDGE_K = 0.38;
export const LV_LEDGE_MIN = 3.6;
export const LV_TAPER = 5;
export const LV_LEDGE_RISE = 1.2;
export const LV_SUM_L = 12;
export const LV_NS = 32; // sections at most
// section kinds
export const LV_START = 0;
export const LV_RAMP = 1;
export const LV_STEPS = 2;
export const LV_GAP = 3;
export const LV_SLIDER = 4;
export const LV_LEDGE = 5;
export const LV_SUMMIT = 6;
export const LV_F_BOULDERS = 1; // section flag: boulders roll down this ramp
// The crown on the summit's middle: touch it (a ball's centre within LV_CROWN_R of it, on the summit) and you're
// home, out of play, parked on a ring LV_PARK_Y over the summit, spot k LV_PARK_R0 + LV_PARK_RK sqrt(k + 0.5) out.
export const LV_CROWN_R = 3.2;
export const LV_PARK_Y = 7;
export const LV_PARK_R0 = 3;
export const LV_PARK_RK = 1.25;
// The lava: LV_L0 + LV_L0K times the root of the balls in under the shelf (a big crowd takes longer to get off it),
// still for LV_STILL ticks, then rising through phases of LV_PH ticks, phase j at (LV_V0 + j LV_VK) m a tick, times
// LV_VN0 / (1 + LV_VNK times the root of the balls in) (1 for 16 balls, 0.72 for 256), times 1 - LV_VJ / 2 to
// 1 + LV_VJ / 2 from the round's seed; the last phase on for good.
export const LV_L0 = 1.5;
export const LV_L0K = 0.45;
export const LV_VN0 = 1.15;
export const LV_VNK = 0.0375;
export const LV_STILL = 1000; // 8 s
export const LV_PH = 1250; // 10 s
export const LV_V0 = 0.0026; // 0.325 m/s
export const LV_VK = 0.0015; // 0.1875 m/s more a phase
export const LV_VJ = 0.5;
export const LV_NPH = 16;
// Boulders: on every ramp past the first turn, in lanes LV_BLANE wide across it (LV_BLMAX at most), each lane its own
// schedule: one every LV_BP0 to + LV_BPN ticks from LV_B0 and an offset, LV_BJ of jitter, LV_BV0 to + LV_BVK m/s down
// the ramp; dropped in at its top (LV_BDH m in LV_BDROP ticks), gone at its foot. A ball it meets is sent off it at
// least LV_BKICK, LV_BE of what it came in at, and up LV_BPOP.
export const LV_BR = 1.5;
export const LV_BLANE = 6;
export const LV_BLMAX = 3;
export const LV_B0 = 500;
export const LV_BP0 = 400;
export const LV_BPN = 220;
export const LV_BJ = 90;
export const LV_BV0 = 6.5;
export const LV_BVK = 3;
export const LV_BDROP = 50;
export const LV_BDH = 4;
export const LV_BKICK = 6;
export const LV_BE = 0.6;
export const LV_BPOP = 4;
// $p_seed keys
export const LV_KROUTE = 0x30000; // the sections, from $hash32 of this and a counter
export const LV_KLAVA = 0x31000; // phase j's pace, LV_KLAVA + j
export const LV_KBOULDER = 0x32000; // ramp j's boulders, LV_KBOULDER + j
export const LV_KSPAWN = 0x33000; // the start's order
// Its header, byte offsets in PG_H (112 B, in the prediction's copy).
export const LV_W = 0; // f32 the route's width
export const LV_RM = 4; // f32 the route's middle line's radius
export const LV_C = 8; // f32 a turn along the middle line, m
export const LV_RB = 12; // f32 the shelf's outer radius
export const LV_HT = 16; // f32 the summit's height over the shelf
export const LV_SEND = 20; // f32 the route's end, m along its middle (the summit section's end)
export const LV_NSEC = 24; // u32 sections
export const LV_FIN = 28; // u32 balls crowned
export const LV_BURN = 32; // u32 balls the lava took
export const LV_THS = 36; // f32 the start's end, in turns round from its beginning (on +x)
export const LV_HEND0 = 40; // f32 the first turn's top end, over the shelf (its end face, behind the start)
// In PG_S: the sections, LV_SSIZE bytes each; a section index by the metre; the lava's height at each phase's
// start (LV_NPH + 1 f32s) and its pace through each (LV_NPH f32s, m a tick).
export const LV_SEC = 0;
export const LV_SSIZE = 48;
export const LV_IDX = 1536; // LV_SEC + LV_NS * LV_SSIZE: u8 per metre along the route, the section holding it
export const LV_NIDX = 768;
export const LV_LAV = 2304; // LV_IDX + LV_NIDX
export const LV_RATE = 2372; // LV_LAV + 4 * (LV_NPH + 1)
// A section's fields (byte offsets). s along the route's middle line, h over the shelf.
export const LV_S_KIND = 0; // u32 the kind (LV_START ... LV_SUMMIT)
export const LV_S_FL = 4; // u32 flags (LV_F_BOULDERS)
export const LV_S_S0 = 8; // f32 where it starts
export const LV_S_LEN = 12; // f32 its length
export const LV_S_H0 = 16; // f32 its height at its start
export const LV_S_H1 = 20; // f32 and at its end
export const LV_S_A = 24; // f32 a gap's or slider's run-up; steps' tread; a ledge's width
export const LV_S_G = 28; // f32 a gap's or slider's gap; steps: how many
export const LV_S_P = 32; // u32 a slider's period; a boulder ramp's lanes
export const LV_S_PH = 36; // u32 a slider's phase; a boulder ramp's key
export const LV_S_D = 40; // f32 a slider's travel
// PG_M: a climber's best height over the shelf in cm; crowned, LV_M_FIN | its order from 1 (balls crowned on one
// tick share it); taken by the lava, LV_M_BURN | the tick into play it went.
export const LV_M_FIN = 0x10000000;
export const LV_M_BURN = 0x20000000;
// PG_SCORE: crowned, LV_SC_FIN less the balls crowned before it; climbing at the end, LV_SC_IN plus its best
// height in cm; taken by the lava, the tick into play it went.
export const LV_SC_FIN = 60000;
export const LV_SC_IN = 30000;
// Its FX kinds are FX_MG + 4 * MG_LAVA + k, k 0 to 3: 96 to 99.
export const LV_FX_BURN = 96; // a ball into the lava: owner, shot whoever knocked it in lately (255 none), where, size its best height
export const LV_FX_CROWN = 97; // a ball home: owner, shot its order, where, size its time into play in s
export const LV_FX_HIT = 98; // a boulder hit a ball (either bank): owner the ball, shot the ramp's section << 8 | lane << 4 | boulder & 15, the contact, size the kick
export const LV_FX_LAVA = 99; // the lava's pace changes: owner 255, shot the phase (0: it starts), the shelf's middle at the lava's height, size the pace in m/s
