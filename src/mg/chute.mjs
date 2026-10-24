// FRUIT CHUTE (MG_CHUTE, prefix fc): a conveyor belt sloping up along +x to a
// finish line, walls down both sides, a dispenser over its top dropping giant
// fruit that roll down it in lanes. The belt carries a ball on it down at
// FC_BELT; a fruit that meets a ball knocks it back down. Nobody falls out:
// knocked off the foot you land on the catch floor and climb again. Over the
// line and you're out of play, placed by the order you crossed in; the rest
// by how far up they stood at the end.
export const FC_RUN = 100; // m the belt runs, foot to top, along +x
export const FC_SLOPE = 0.2; // its rise a metre run: the top FC_RISE over the foot
export const FC_RISE = 20;
export const FC_W0 = 14; // wall to wall: 14 m plus FC_WK times the root of the balls in, at most FC_WMAX
export const FC_WK = 2.2;
export const FC_WMAX = 50;
export const FC_LANE = 4; // m between fruit lanes, about: they span the chute evenly
export const FC_LEDGE = 2.3; // m in from a wall to the outermost lane's centre: a melon's radius, so a lane reaches every wall
export const FC_BELT = 3; // m/s the belt carries a ball on it down
export const FC_BELT_DT = 0.024; // the same a tick
export const FC_SP = 2.4; // m between balls on the start grid, across and back (and in the pen)
export const FC_EDGE = 1.6; // m in from a wall to the outermost centres on the grid
export const FC_GRID0 = 3; // m back from the belt's foot to the grid's front row
export const FC_BACK = 3; // m behind the last row to the back wall (and in the pen)
export const FC_CATCH = 12; // m at least from the foot back to the back wall
export const FC_PEN0 = 5; // m past the line to the pen's front row
export const FC_LEN = 15000; // 120 s
export const FC_RUSH = 3750; // once one in FC_RUSHN of the balls is over the line, 30 s left at most
export const FC_RUSHN = 8;
export const FC_DOWN = 250; // ticks a ball that fell anyway waits to come back (none can: walls all round)
export const FC_SNAP = 0.15; // m: a ball this little over the floor and not rising is on it, so it rolls down a slope without leaving it
export const FC_BOUNCE = 0.3; // what a wall gives back of a ball's speed into it
// The fruit. Each drops out of the dispenser FC_DROPX m short of the line,
// FC_DROPH m in FC_DROPT ticks, then rolls down at its own speed and bursts
// on a grate FC_GRATE m up from the foot (the belt below it is clear: a ball
// knocked down gets its footing back there). Kinds: radius (m), roll speed (m/s), what a hit gives back of
// the speed into it and the least it leaves (m/s), the hop it gives (m/s).
export const FC_DROPX = 5;
export const FC_DROPH = 5;
export const FC_DROPT = 88; // 0.7 s: 5 m at about 20 m/s^2
export const FC_GRATE = 8;
export const FC_KINDS = 4;
export const FC_GRAPE = 0;
export const FC_APPLE = 1;
export const FC_ORANGE = 2; // bounces down: FC_HOPH m high every FC_HOPT ticks, a ball rolls under at the top of one
export const FC_MELON = 3;
export const FC_R_GRAPE = 0.8;
export const FC_R_APPLE = 1.25;
export const FC_R_ORANGE = 1.4;
export const FC_R_MELON = 2.3;
export const FC_V_GRAPE = 12;
export const FC_V_APPLE = 9.5;
export const FC_V_ORANGE = 8.5;
export const FC_V_MELON = 6.5;
export const FC_E_SMALL = 0.35; // grapes, apples, oranges
export const FC_E_MELON = 0.9;
export const FC_KICK = 4; // m/s apart at least, after any hit
export const FC_SIDE = 0.3; // of a hit's kick, aside too: the way the ball is off the fruit's middle
export const FC_POP = 3; // m/s up a hit gives (a melon's FC_POPM)
export const FC_POPM = 4.5;
export const FC_HOPH = 2.6;
export const FC_HOPT = 100;
// The schedule, made by setup from the PRNG (ticks into play): each lane's
// next fruit FC_I0 ticks apart at first, down to FC_I1 by FC_T1, every gap
// stretched by a random 0.65 to 1.35; a share of melons rising from FC_M0 to
// FC_M0 + FC_MK by FC_T1. A wave every FC_WAVEI from FC_WAVE0: one fruit in
// every lane but a gap (two lanes from FC_GAP2 lanes up), apples for the
// first FC_WAVEA, melons after; announced FC_WARN before it drops.
export const FC_I0 = 560;
export const FC_I1 = 360;
export const FC_T1 = 9375;
export const FC_GRAPES = 30; // % of the rest grapes, then oranges, then apples
export const FC_ORANGES = 18;
export const FC_M0 = 0.12;
export const FC_MK = 0.18;
export const FC_WAVE0 = 2500;
export const FC_WAVEI = 1875;
export const FC_WAVES = 7; // at most (FC_LEN - FC_WAVE0) / FC_WAVEI
export const FC_WAVEA = 3;
export const FC_GAP2 = 6;
export const FC_WARN = 188; // 1.5 s
export const FC_LMAX = 16; // lanes at most
// The schedule's clock runs FC_PRE ahead of play's: from the countdown's
// start, so fruit are rolling down by GO (and drawn rolling through the title card).
export const FC_PRE = 750;
// Records in PG_BIG, in the order they drop (t0 never falls), FC_REC bytes each:
// f32 z (the lane's centre), f32 radius, f32 roll speed, u16 t0 (the tick on
// the schedule's clock it starts to drop), u8 kind, u8 wave (1 + the wave it's in, 0 none).
export const FC_FRUIT = 0;
export const FC_REC = 16;
export const FC_NMAX = 4096;
// u16 per FC_BUCKET ticks of the schedule's clock: the first fruit dropping in it or later.
export const FC_IDX = 0x10000;
export const FC_BUCKET = 125;
export const FC_NB = 136;
// The longest a fruit lives (a melon from the dispenser to the grate), a few ticks over.
export const FC_LIFE = 1920;
// Its header, byte offsets in PG_H.
export const FC_HW = 0; // f32 the half-width, wall to wall
export const FC_X0 = 4; // f32 the belt's foot, x
export const FC_XT = 8; // f32 the belt's top: the finish line
export const FC_XB = 12; // f32 the back wall, behind the catch floor
export const FC_XE = 16; // f32 the pen's far wall
export const FC_NL = 20; // u32 lanes
export const FC_NF = 24; // u32 fruit in the schedule
export const FC_COLS = 28; // u32 balls a row on the grid (and in the pen)
export const FC_FIN = 32; // u32 balls over the line
export const FC_FIRST = 36; // u32 tick into play the first ball crossed
export const FC_LZ0 = 40; // f32 the first lane's centre, z
export const FC_LSP = 44; // f32 from one lane's centre to the next
// In PG_S: the lanes' next fruit while setup lays the schedule (u32 each, zeroed after),
// then each wave's gap (u8: its first lane), for the warning.
export const FC_NEXT = 0;
export const FC_GAPS = 64;
// PG_M: 0 climbing, or over the line, FC_M_FIN | its order from 1 (balls over on one tick share it).
export const FC_M_FIN = 0x10000;
// PG_SCORE: over the line, FC_SCORE_FIN less the balls over before it; the
// rest, cm from the back wall where it stood at the end.
export const FC_SCORE_FIN = 60000;
export const FC_SCORE_MAX = 49999;
// FX kinds, FX_MG + 4 * MG_CHUTE + k.
export const FC_FX_FINISH = 80; // owner over the line, shot its order, where it crossed, size its time into play in s
export const FC_FX_HIT = 81; // a fruit hit a ball: owner the ball, shot the fruit's index, the contact point, size the kick in m/s
export const FC_FX_WAVE = 82; // a wave FC_WARN off: owner 255, shot the gap's first lane | lanes in it << 8, the dispenser, size the wave from 1
