;; FRUIT CHUTE: a conveyor belt FC_RUN m long sloping up along +x, from a
;; catch floor at PLAT_Y to a finish line FC_RISE m up, walls down both sides.
;; The belt carries every ball on it down at FC_BELT; a dispenser over its top
;; drops giant fruit (grapes, apples, bouncing oranges, melons) that roll
;; down it in lanes, knocking back any ball they meet, and burst on a grate
;; a little above its foot. Nobody falls out: there are walls all round, and
;; the foot runs onto the catch floor. Over the line a ball is out of play,
;; placed by the order it crossed in and parked in the pen past the line; the
;; rest are placed by how far up they stood at the end.
;;
;; The schedule (every fruit's lane, kind, speed and the tick it drops) is
;; laid by setup from the PRNG, in PG_BIG, before the countdown: long before
;; any of it matters, so ground and push on either bank read it against the
;; bank's own tick, and a fruit is exactly where it is on every client. The
;; belt, the walls and the floor are the header's (PG_H). Only the finish and
;; its order are the confirmed world's, a round trip late, as a bump is.

;; The floor's top at x on bank d: the catch floor, the belt rising FC_SLOPE a
;; metre from its foot, the top past the line.
(func $fc_surf (param $d i32) (param $x f32) (result f32)
  (!madd (f32.min (f32.max (f32.sub (local.get $x) (f32.load offset=@(PG_H + FC_X0) (local.get $d))) (f32.const 0)) (f32.const @FC_RUN))
         (f32.const @FC_SLOPE) (f32.const @PLAT_Y)))

;; Lane l's centre, z.
(func $fc_lane (param $l i32) (result f32)
  (!madd (f32.convert_i32_u (local.get $l)) (f32.load (i32.const @(PG_H + FC_LSP))) (f32.load (i32.const @(PG_H + FC_LZ0)))))

;; One fruit on the end of the schedule, unless it's full: its record, and the
;; buckets up to its tick pointed at it.
(func $fc_emit (param $l i32) (param $t0 i32) (param $kind i32) (param $wave i32)
  (local $nf i32) (local $a i32) (local $b i32)
  (local.set $nf (i32.load (i32.const @(PG_H + FC_NF))))
  (if (i32.ge_u (local.get $nf) (i32.const @FC_NMAX)) (then (return)))
  (local.set $a (i32.add (i32.const @(PG_BIG + FC_FRUIT)) (i32.mul (local.get $nf) (i32.const @FC_REC))))
  (f32.store offset=0 (local.get $a) (call $fc_lane (local.get $l)))
  (f32.store offset=4 (local.get $a)
    (select (f32.const @FC_R_GRAPE) (select (f32.const @FC_R_APPLE) (select (f32.const @FC_R_ORANGE) (f32.const @FC_R_MELON)
      (i32.eq (local.get $kind) (i32.const @FC_ORANGE))) (i32.eq (local.get $kind) (i32.const @FC_APPLE))) (i32.eq (local.get $kind) (i32.const @FC_GRAPE))))
  (f32.store offset=8 (local.get $a)
    (select (f32.const @FC_V_GRAPE) (select (f32.const @FC_V_APPLE) (select (f32.const @FC_V_ORANGE) (f32.const @FC_V_MELON)
      (i32.eq (local.get $kind) (i32.const @FC_ORANGE))) (i32.eq (local.get $kind) (i32.const @FC_APPLE))) (i32.eq (local.get $kind) (i32.const @FC_GRAPE))))
  (i32.store16 offset=12 (local.get $a) (local.get $t0))
  (i32.store8 offset=14 (local.get $a) (local.get $kind))
  (i32.store8 offset=15 (local.get $a) (local.get $wave))
  ;; FC_FIRST holds the next bucket to fill while the schedule is laid
  (local.set $b (i32.load (i32.const @(PG_H + FC_FIRST))))
  (block $done
    (loop $fill
      (br_if $done (i32.or (i32.ge_u (local.get $b) (i32.const @FC_NB))
                           (i32.gt_u (local.get $b) (i32.div_u (local.get $t0) (i32.const @FC_BUCKET)))))
      (!st u16 @(PG_BIG + FC_IDX) (local.get $b) (local.get $nf))
      (!inc $b)
      (br $fill)))
  (i32.store (i32.const @(PG_H + FC_FIRST)) (local.get $b))
  (i32.store (i32.const @(PG_H + FC_NF)) (i32.add (local.get $nf) (i32.const 1))))

;; The round's fruit, from the PRNG, in the order they drop, on the
;; schedule's clock (FC_PRE ahead of play's, so the belt is busy by GO): each
;; lane's next fruit after a gap that shortens as the round goes, a kind drawn
;; (melons more often later), and a wave every FC_WAVEI, all lanes but a gap
;; at once.
(func $fc_schedule
  (local $nl i32) (local $l i32) (local $best i32) (local $tmin i32) (local $tw i32) (local $wv i32) (local $gap i32) (local $gl i32)
  (local $kind i32) (local $b i32) (local $k f32)
  (local.set $nl (i32.load (i32.const @(PG_H + FC_NL))))
  (!for $l (i32.const 0) (local.get $nl)
    (!st i32 @(PG_S + FC_NEXT) (local.get $l) (i32.trunc_sat_f32_u (f32.mul (call $p_unit) (f32.const @FC_I0)))))
  (local.set $tw (i32.const @(FC_WAVE0 + FC_PRE)))
  (block $done
    (loop $more
      (local.set $best (i32.const 0))
      (!for $l (i32.const 1) (local.get $nl)
        (if (i32.lt_u (!ld i32 @(PG_S + FC_NEXT) (local.get $l)) (!ld i32 @(PG_S + FC_NEXT) (local.get $best)))
          (then (local.set $best (local.get $l)))))
      (local.set $tmin (!ld i32 @(PG_S + FC_NEXT) (local.get $best)))
      (br_if $done (i32.ge_u (i32.load (i32.const @(PG_H + FC_NF))) (i32.const @FC_NMAX)))
      (if (i32.and (i32.le_u (local.get $tw) (local.get $tmin)) (i32.lt_u (local.get $tw) (i32.const @(FC_LEN + FC_PRE))))
        (then
          ;; a wave: one in every lane but the gap, apples and then melons
          (local.set $gl (select (i32.const 2) (i32.const 1) (i32.ge_u (local.get $nl) (i32.const @FC_GAP2))))
          (local.set $gap (i32.rem_u (call $rand) (i32.add (i32.sub (local.get $nl) (local.get $gl)) (i32.const 1))))
          (!st u8 @(PG_S + FC_GAPS) (local.get $wv) (local.get $gap))
          (local.set $kind (select (i32.const @FC_APPLE) (i32.const @FC_MELON) (i32.lt_u (local.get $wv) (i32.const @FC_WAVEA))))
          (!for $l (i32.const 0) (local.get $nl)
            (if (i32.or (i32.lt_u (local.get $l) (local.get $gap)) (i32.ge_u (local.get $l) (i32.add (local.get $gap) (local.get $gl))))
              (then (call $fc_emit (local.get $l) (local.get $tw) (local.get $kind) (i32.add (local.get $wv) (i32.const 1)))))
            ;; nothing else in any lane for half a second either side
            (if (i32.lt_u (!ld i32 @(PG_S + FC_NEXT) (local.get $l)) (i32.add (local.get $tw) (i32.const 60)))
              (then (!st i32 @(PG_S + FC_NEXT) (local.get $l) (i32.add (local.get $tw) (i32.const 60))))))
          (!inc $wv)
          (local.set $tw (i32.add (local.get $tw) (i32.const @FC_WAVEI)))
          (br $more)))
      (br_if $done (i32.ge_u (local.get $tmin) (i32.const @(FC_LEN + FC_PRE))))
      ;; a fruit in the lane due: melons a rising share, then grapes, oranges, apples
      (local.set $k (f32.min (f32.div (f32.convert_i32_s (i32.sub (local.get $tmin) (i32.const @FC_PRE))) (f32.const @FC_T1)) (f32.const 1)))
      (local.set $k (f32.max (local.get $k) (f32.const 0)))
      (if (f32.lt (call $p_unit) (!madd (local.get $k) (f32.const @FC_MK) (f32.const @FC_M0)))
        (then (local.set $kind (i32.const @FC_MELON)))
        (else
          (local.set $kind (i32.const @FC_APPLE))
          (local.set $b (i32.trunc_sat_f32_u (f32.mul (call $p_unit) (f32.const 100))))
          (if (i32.lt_u (local.get $b) (i32.const @(FC_GRAPES + FC_ORANGES))) (then (local.set $kind (i32.const @FC_ORANGE))))
          (if (i32.lt_u (local.get $b) (i32.const @FC_GRAPES)) (then (local.set $kind (i32.const @FC_GRAPE))))))
      (call $fc_emit (local.get $best) (local.get $tmin) (local.get $kind) (i32.const 0))
      (!st i32 @(PG_S + FC_NEXT) (local.get $best)
        (i32.add (local.get $tmin)
                 (i32.trunc_sat_f32_u (f32.mul (f32.sub (f32.const @FC_I0) (f32.mul (local.get $k) (f32.const @(FC_I0 - FC_I1))))
                                               (!madd (call $p_unit) (f32.const 0.7) (f32.const 0.65))))))
      (br $more)))
  ;; the buckets past the last fruit point past it
  (local.set $b (i32.load (i32.const @(PG_H + FC_FIRST))))
  (!for $b (local.get $b) (i32.const @FC_NB)
    (!st u16 @(PG_BIG + FC_IDX) (local.get $b) (i32.load (i32.const @(PG_H + FC_NF)))))
  (i32.store (i32.const @(PG_H + FC_FIRST)) (i32.const 0))
  (memory.fill (i32.const @(PG_S + FC_NEXT)) (i32.const 0) (i32.const @(FC_LMAX * 4))))

;; The chute for n balls: as wide as the crowd wants, the catch floor deep
;; enough for its grid, the pen for all of it; lanes across; the schedule.
(func $fc_setup (param $n i32)
  (local $w f32) (local $cols i32) (local $rows i32) (local $x0 f32) (local $xt f32) (local $nl i32)
  (local.set $w (f32.min (!madd (f32.sqrt (f32.convert_i32_u (local.get $n))) (f32.const @FC_WK) (f32.const @FC_W0)) (f32.const @FC_WMAX)))
  (!chk (local.get $w) 112 (local.get $n))
  (local.set $cols (i32.add (i32.trunc_sat_f32_u (f32.div (f32.sub (local.get $w) (f32.const @(2 * FC_EDGE))) (f32.const @FC_SP))) (i32.const 1)))
  (local.set $rows (i32.div_u (i32.add (local.get $n) (i32.sub (local.get $cols) (i32.const 1))) (local.get $cols)))
  (if (i32.eqz (local.get $rows)) (then (local.set $rows (i32.const 1))))
  ;; lanes about FC_LANE apart from FC_LEDGE off one wall to FC_LEDGE off the other: no way up the side is safe
  (local.set $nl (i32.add (i32.trunc_sat_f32_u (f32.nearest (f32.div (f32.sub (local.get $w) (f32.const @(2 * FC_LEDGE))) (f32.const @FC_LANE)))) (i32.const 1)))
  (if (i32.lt_u (local.get $nl) (i32.const 2)) (then (local.set $nl (i32.const 2))))
  (if (i32.gt_u (local.get $nl) (i32.const @FC_LMAX)) (then (local.set $nl (i32.const @FC_LMAX))))
  (f32.store (i32.const @(PG_H + FC_LZ0)) (f32.add (f32.sub (f32.load (i32.const @PG_CX)) (f32.mul (local.get $w) (f32.const 0.5))) (f32.const @FC_LEDGE)))
  (f32.store (i32.const @(PG_H + FC_LSP)) (f32.div (f32.sub (local.get $w) (f32.const @(2 * FC_LEDGE))) (f32.convert_i32_u (i32.sub (local.get $nl) (i32.const 1)))))
  (local.set $x0 (f32.sub (f32.load (i32.const @PG_CX)) (f32.const @(FC_RUN / 2))))
  (local.set $xt (f32.add (local.get $x0) (f32.const @FC_RUN)))
  (f32.store (i32.const @(PG_H + FC_HW)) (f32.mul (local.get $w) (f32.const 0.5)))
  (f32.store (i32.const @(PG_H + FC_X0)) (local.get $x0))
  (f32.store (i32.const @(PG_H + FC_XT)) (local.get $xt))
  (f32.store (i32.const @(PG_H + FC_XB))
    (f32.sub (local.get $x0) (f32.max (f32.const @FC_CATCH)
                                      (!madd (f32.convert_i32_u (i32.sub (local.get $rows) (i32.const 1))) (f32.const @FC_SP) (f32.const @(FC_GRID0 + FC_BACK))))))
  (f32.store (i32.const @(PG_H + FC_XE))
    (f32.add (local.get $xt) (!madd (f32.convert_i32_u (local.get $rows)) (f32.const @FC_SP) (f32.const @(FC_PEN0 + FC_BACK)))))
  (i32.store (i32.const @(PG_H + FC_NL)) (local.get $nl))
  (i32.store (i32.const @(PG_H + FC_COLS)) (local.get $cols))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_SCORE))
  (i32.store (i32.const @PG_LEN) (i32.const @FC_LEN))
  (i32.store (i32.const @PG_RESPAWN) (i32.const 0x7fffffff))
  (f32.store (i32.const @PG_SIZE) (f32.mul (f32.sub (f32.load (i32.const @(PG_H + FC_XE))) (f32.load (i32.const @(PG_H + FC_XB)))) (f32.const 0.5)))
  (call $fc_schedule))

;; Ball i of n on the grid over the catch floor, rows of FC_COLS back from the
;; foot, a short last row centred; a respawn (n 1024) anywhere on the catch floor.
(func $fc_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $cols i32) (local $row i32) (local $m i32) (local $x0 f32) (local $hw f32) (local $cx f32)
  (local.set $x0 (f32.sub (f32.load (i32.const @(PG_H + FC_X0))) (f32.const @FC_GRID0)))
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (if (i32.ge_u (local.get $n) (i32.const 1024))
    (then
      (local.set $hw (f32.sub (f32.load (i32.const @(PG_H + FC_HW))) (f32.const @FC_EDGE)))
      (return
        (f32.sub (local.get $x0) (f32.mul (f32.convert_i32_u (i32.shr_u (i32.and (local.get $i) (i32.const 1023)) (i32.const 5)))
                                          (f32.div (f32.sub (local.get $x0) (f32.add (f32.load (i32.const @(PG_H + FC_XB))) (f32.const @FC_BACK))) (f32.const 31))))
        (f32.const @PLAT_Y)
        (!madd (f32.sub (f32.div (f32.convert_i32_u (i32.and (local.get $i) (i32.const 31))) (f32.const 15.5)) (f32.const 1)) (local.get $hw) (local.get $cx)))))
  (local.set $cols (i32.load (i32.const @(PG_H + FC_COLS))))
  (local.set $row (i32.div_u (local.get $i) (local.get $cols)))
  (local.set $m (i32.sub (local.get $n) (i32.mul (local.get $row) (local.get $cols))))
  (if (i32.gt_u (local.get $m) (local.get $cols)) (then (local.set $m (local.get $cols))))
  (f32.sub (local.get $x0) (f32.mul (f32.convert_i32_u (local.get $row)) (f32.const @FC_SP)))
  (f32.const @PLAT_Y)
  (!madd (f32.convert_i32_s (i32.sub (i32.shl (i32.rem_u (local.get $i) (local.get $cols)) (i32.const 1)) (i32.sub (local.get $m) (i32.const 1))))
         (f32.const @(FC_SP / 2)) (local.get $cx)))

(func $fc_start)
(func $fc_begin (param $p i32) (param $d i32))

;; Inside the walls, the floor's top under (x, z), whatever y: the chute is
;; one surface, nothing to go under, so a ball pushed a hair into it is put
;; back on it rather than through it. Outside, nothing.
(func $fc_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (if (i32.or (i32.or (f32.lt (local.get $x) (f32.load offset=@(PG_H + FC_XB) (local.get $d)))
                      (f32.gt (local.get $x) (f32.load offset=@(PG_H + FC_XE) (local.get $d))))
              (f32.gt (f32.abs (f32.sub (local.get $z) (f32.load offset=@PG_CX (local.get $d)))) (f32.load offset=@(PG_H + FC_HW) (local.get $d))))
    (then (return (f32.const -1000))))
  (call $fc_surf (local.get $d) (local.get $x)))

;; After the ball's roll, on bank d's tick: kept on the slope as it rolls down
;; it, carried down by the belt, knocked by any fruit it meets, kept inside the
;; walls. Every fruit is where the schedule and the tick put it: dropping out
;; of the dispenser (FC_DROPH in FC_DROPT, falling faster as it goes), then
;; rolling down at its speed (an orange bouncing), gone at the grate. A ball
;; that meets one is put back out of it across the floor (never into it) and
;; sent off it at least FC_KICK, more the harder it came in, and up a little.
(func $fc_push (param $p i32) (param $d i32)
  (local $pb i32) (local $fl i32) (local $t i32) (local $k i32) (local $k1 i32) (local $a i32) (local $age i32) (local $kind i32) (local $b i32)
  (local $px f32) (local $py f32) (local $pz f32) (local $vx f32) (local $vy f32) (local $vz f32) (local $r f32) (local $s f32)
  (local $x0 f32) (local $xt f32) (local $xd f32) (local $yd f32) (local $cz f32) (local $hw f32) (local $lo f32) (local $hi f32)
  (local $fx f32) (local $fy f32) (local $fz f32) (local $fr f32) (local $fv f32) (local $rr f32) (local $u f32)
  (local $dx f32) (local $dy f32) (local $dz f32) (local $h f32) (local $hn f32) (local $nx f32) (local $nz f32) (local $rel f32) (local $dv f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
  (local.set $px (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (local.set $py (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
  (local.set $pz (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (local.set $vx (!at f32 @(PLAYERS + P_VX) (local.get $pb)))
  (local.set $vy (!at f32 @(PLAYERS + P_VY) (local.get $pb)))
  (local.set $vz (!at f32 @(PLAYERS + P_VZ) (local.get $pb)))
  (local.set $r (call $b_rad (local.get $pb)))
  (local.set $x0 (f32.load offset=@(PG_H + FC_X0) (local.get $d)))
  (local.set $xt (f32.load offset=@(PG_H + FC_XT) (local.get $d)))
  (local.set $cz (f32.load offset=@PG_CX (local.get $d)))
  (local.set $hw (f32.load offset=@(PG_H + FC_HW) (local.get $d)))
  ;; rolling down a slope it leaves the floor by a hair each tick: back on it
  (local.set $s (call $fc_surf (local.get $d) (local.get $px)))
  (if (i32.and (i32.eqz (i32.and (local.get $fl) (i32.const @(PF_GROUND | PF_FALL))))
               (i32.and (f32.le (local.get $vy) (f32.const 0)) (f32.le (f32.sub (local.get $py) (local.get $s)) (f32.const @FC_SNAP))))
    (then
      (local.set $py (local.get $s))
      (local.set $vy (f32.const 0))
      (local.set $fl (i32.or (local.get $fl) (i32.const @PF_GROUND)))))
  ;; on the belt, carried down with it
  (if (i32.and (i32.ne (i32.and (local.get $fl) (i32.const @PF_GROUND)) (i32.const 0))
               (i32.and (f32.ge (local.get $px) (local.get $x0)) (f32.le (local.get $px) (local.get $xt))))
    (then
      (local.set $px (f32.sub (local.get $px) (f32.const @FC_BELT_DT)))
      (local.set $py (call $fc_surf (local.get $d) (local.get $px)))))
  ;; the fruit out now, on the schedule's clock (from the countdown's start): those dropped in the last FC_LIFE ticks, by the buckets
  (local.set $t (i32.add (call $p_t (local.get $d)) (i32.const @FC_PRE)))
  (local.set $xd (f32.sub (local.get $xt) (f32.const @FC_DROPX)))
  (local.set $yd (call $fc_surf (local.get $d) (local.get $xd)))
  (local.set $b (i32.div_u (local.get $t) (i32.const @FC_BUCKET)))
  (local.set $k (i32.const 0))
  (if (i32.gt_u (local.get $t) (i32.const @FC_LIFE))
    (then (local.set $k (!ld u16 @(PG_BIG + FC_IDX) (i32.div_u (i32.sub (local.get $t) (i32.const @FC_LIFE)) (i32.const @FC_BUCKET))))))
  (local.set $k1 (!ld u16 @(PG_BIG + FC_IDX) (select (i32.add (local.get $b) (i32.const 1)) (i32.const @(FC_NB - 1)) (i32.lt_u (local.get $b) (i32.const @(FC_NB - 2))))))
  (block $none
    (br_if $none (i32.ne (i32.load offset=@HDR_STATE (local.get $d)) (i32.const @H_PLAY)))
    (loop $next
      (br_if $none (i32.ge_u (local.get $k) (local.get $k1)))
      (local.set $a (i32.add (i32.const @(PG_BIG + FC_FRUIT)) (i32.mul (local.get $k) (i32.const @FC_REC))))
      (local.set $fz (f32.load offset=0 (local.get $a)))
      (local.set $fr (f32.load offset=4 (local.get $a)))
      (local.set $rr (f32.add (local.get $r) (local.get $fr)))
      (local.set $dz (f32.sub (local.get $pz) (local.get $fz)))
      (local.set $age (i32.sub (local.get $t) (i32.load16_u offset=12 (local.get $a))))
      (if (i32.and (f32.lt (f32.abs (local.get $dz)) (local.get $rr)) (i32.ge_s (local.get $age) (i32.const 0)))
        (then
          (local.set $kind (i32.load8_u offset=14 (local.get $a)))
          (if (i32.lt_s (local.get $age) (i32.const @FC_DROPT))
            (then
              ;; dropping out of the dispenser
              (local.set $fx (local.get $xd))
              (local.set $fv (f32.const 0))
              (local.set $u (f32.div (f32.convert_i32_s (local.get $age)) (f32.const @FC_DROPT)))
              (local.set $fy (f32.add (f32.add (local.get $yd) (local.get $fr))
                                      (f32.mul (f32.const @FC_DROPH) (f32.sub (f32.const 1) (f32.mul (local.get $u) (local.get $u)))))))
            (else
              ;; rolling down, an orange bouncing as it goes
              (local.set $age (i32.sub (local.get $age) (i32.const @FC_DROPT)))
              (local.set $fv (f32.load offset=8 (local.get $a)))
              (local.set $fx (f32.sub (local.get $xd) (f32.mul (f32.convert_i32_s (local.get $age)) (f32.mul (local.get $fv) (f32.const @DT)))))
              (local.set $fv (f32.neg (local.get $fv)))
              (local.set $fy (f32.add (call $fc_surf (local.get $d) (local.get $fx)) (local.get $fr)))
              (if (i32.eq (local.get $kind) (i32.const @FC_ORANGE))
                (then
                  (local.set $u (f32.div (f32.convert_i32_u (i32.rem_u (local.get $age) (i32.const @FC_HOPT))) (f32.const @FC_HOPT)))
                  (local.set $fy (!madd (f32.mul (local.get $u) (f32.sub (f32.const 1) (local.get $u))) (f32.const @(4 * FC_HOPH)) (local.get $fy)))))))
          (local.set $dx (f32.sub (local.get $px) (local.get $fx)))
          (local.set $dy (f32.sub (f32.add (local.get $py) (local.get $r)) (local.get $fy)))
          ;; burst at the grate near the foot: none past it
          (if (i32.and (f32.gt (local.get $fx) (f32.add (local.get $x0) (f32.const @FC_GRATE)))
                       (f32.lt (!dot3 (local.get $dx) (local.get $dy) (local.get $dz) (local.get $dx) (local.get $dy) (local.get $dz)) (f32.mul (local.get $rr) (local.get $rr))))
            (then
              ;; out of it across the floor: as far from its centre as touching takes at this height
              (local.set $hn (f32.sqrt (f32.sub (f32.mul (local.get $rr) (local.get $rr)) (f32.mul (local.get $dy) (local.get $dy)))))
              (local.set $h (f32.sqrt (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz)))))
              (if (f32.gt (local.get $h) (f32.const 0.001))
                (then
                  (local.set $nx (f32.div (local.get $dx) (local.get $h)))
                  (local.set $nz (f32.div (local.get $dz) (local.get $h))))
                (else
                  (local.set $nx (f32.const -1))
                  (local.set $nz (f32.const 0))))
              (local.set $px (!madd (local.get $nx) (local.get $hn) (local.get $fx)))
              (local.set $pz (!madd (local.get $nz) (local.get $hn) (local.get $fz)))
              ;; and off it: what it came in at, given back, at least FC_KICK, and a share of that aside
              (local.set $rel (!madd (f32.sub (local.get $vx) (local.get $fv)) (local.get $nx) (f32.mul (local.get $vz) (local.get $nz))))
              (if (f32.lt (local.get $rel) (f32.const @FC_KICK))
                (then
                  (local.set $dv (f32.sub (f32.max (f32.mul (f32.neg (local.get $rel)) (select (f32.const @FC_E_MELON) (f32.const @FC_E_SMALL) (i32.eq (local.get $kind) (i32.const @FC_MELON))))
                                                   (f32.const @FC_KICK))
                                          (local.get $rel)))
                  (local.set $vx (!madd (local.get $dv) (local.get $nx) (local.get $vx)))
                  (local.set $vz (!madd (local.get $dv) (local.get $nz) (local.get $vz)))
                  ;; and aside, the way it's off the fruit's middle: batted out of the lane, not down it
                  (local.set $vz (!madd (f32.mul (local.get $dv) (f32.const @FC_SIDE)) (select (f32.const -1) (f32.const 1) (f32.lt (local.get $dz) (f32.const 0))) (local.get $vz)))
                  (local.set $vy (f32.max (local.get $vy) (select (f32.const @FC_POPM) (f32.const @FC_POP) (i32.eq (local.get $kind) (i32.const @FC_MELON)))))
                  (local.set $fl (i32.and (local.get $fl) (i32.const @(255 ^ PF_GROUND))))
                  (if (f32.ge (local.get $dv) (f32.const 2))
                    (then (call $fx (local.get $d) (i32.const @FC_FX_HIT) (local.get $p) (local.get $k)
                                    (!madd (local.get $nx) (local.get $fr) (local.get $fx)) (f32.add (local.get $py) (local.get $r))
                                    (!madd (local.get $nz) (local.get $fr) (local.get $fz)) (local.get $dv))))))))))
      (!inc $k)
      (br $next)))
  ;; the walls: down both sides, behind the catch floor, past the pen
  (local.set $lo (f32.add (f32.sub (local.get $cz) (local.get $hw)) (local.get $r)))
  (local.set $hi (f32.sub (f32.add (local.get $cz) (local.get $hw)) (local.get $r)))
  (if (f32.lt (local.get $pz) (local.get $lo))
    (then (local.set $pz (local.get $lo)) (if (f32.lt (local.get $vz) (f32.const 0)) (then (local.set $vz (f32.mul (local.get $vz) (f32.const @(-FC_BOUNCE))))))))
  (if (f32.gt (local.get $pz) (local.get $hi))
    (then (local.set $pz (local.get $hi)) (if (f32.gt (local.get $vz) (f32.const 0)) (then (local.set $vz (f32.mul (local.get $vz) (f32.const @(-FC_BOUNCE))))))))
  (local.set $lo (f32.add (f32.load offset=@(PG_H + FC_XB) (local.get $d)) (local.get $r)))
  (local.set $hi (f32.sub (f32.load offset=@(PG_H + FC_XE) (local.get $d)) (local.get $r)))
  (if (f32.lt (local.get $px) (local.get $lo))
    (then (local.set $px (local.get $lo)) (if (f32.lt (local.get $vx) (f32.const 0)) (then (local.set $vx (f32.mul (local.get $vx) (f32.const @(-FC_BOUNCE))))))))
  (if (f32.gt (local.get $px) (local.get $hi))
    (then (local.set $px (local.get $hi)) (if (f32.gt (local.get $vx) (f32.const 0)) (then (local.set $vx (f32.mul (local.get $vx) (f32.const @(-FC_BOUNCE))))))))
  ;; never under the floor
  (local.set $s (call $fc_surf (local.get $d) (local.get $px)))
  (if (f32.lt (local.get $py) (local.get $s))
    (then
      (local.set $py (local.get $s))
      (if (f32.lt (local.get $vy) (f32.const 0)) (then (local.set $vy (f32.const 0))))
      (local.set $fl (i32.or (local.get $fl) (i32.const @PF_GROUND)))))
  (!chk (local.get $px) 113 (local.get $p))
  (!chk (local.get $py) 114 (local.get $p))
  (!chk (local.get $pz) 115 (local.get $p))
  (!chk (local.get $vx) 116 (local.get $p))
  (!chk (local.get $vy) 117 (local.get $p))
  (!chk (local.get $vz) 118 (local.get $p))
  (!put f32 @(PLAYERS + P_PX) (local.get $pb) (local.get $px))
  (!put f32 @(PLAYERS + P_PY) (local.get $pb) (local.get $py))
  (!put f32 @(PLAYERS + P_PZ) (local.get $pb) (local.get $pz))
  (!put f32 @(PLAYERS + P_VX) (local.get $pb) (local.get $vx))
  (!put f32 @(PLAYERS + P_VY) (local.get $pb) (local.get $vy))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (local.get $vz))
  (!put u8 @(PLAYERS + P_FL) (local.get $pb) (local.get $fl)))

;; Spot s in the pen past the line: rows of FC_COLS from FC_PEN0 on, the last
;; against the far wall if it ever fills.
(func $fc_pen (param $s i32) (result f32 f32)
  (local $cols i32)
  (local.set $cols (i32.load (i32.const @(PG_H + FC_COLS))))
  (f32.min (!madd (f32.convert_i32_u (i32.div_u (local.get $s) (local.get $cols))) (f32.const @FC_SP) (f32.add (f32.load (i32.const @(PG_H + FC_XT))) (f32.const @FC_PEN0)))
           (f32.sub (f32.load (i32.const @(PG_H + FC_XE))) (f32.const @FC_BACK)))
  (!madd (f32.convert_i32_s (i32.sub (i32.shl (i32.rem_u (local.get $s) (local.get $cols)) (i32.const 1)) (i32.sub (local.get $cols) (i32.const 1))))
         (f32.const @(FC_SP / 2)) (f32.load (i32.const @PG_CX))))

;; Every ball still climbing: its score how far up it stands, cm from the back wall.
(func $fc_progress
  (local $p i32) (local $pb i32) (local $v i32) (local $xb f32)
  (local.set $xb (f32.load (i32.const @(PG_H + FC_XB))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (if (i32.and (i32.ne (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_LIVE)) (i32.const 0))
                 (i32.eqz (i32.and (!at i32 @(PLAYERS + PG_M) (local.get $pb)) (i32.const @FC_M_FIN))))
      (then
        (local.set $v (i32.trunc_sat_f32_s (f32.mul (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (local.get $xb)) (f32.const 100))))
        (if (i32.lt_s (local.get $v) (i32.const 0)) (then (local.set $v (i32.const 0))))
        (if (i32.gt_s (local.get $v) (i32.const @FC_SCORE_MAX)) (then (local.set $v (i32.const @FC_SCORE_MAX))))
        (!put u16 @(PLAYERS + PG_SCORE) (local.get $pb) (local.get $v))))))

;; Over the line, in slot order: out of play, its order (shared by everyone
;; over on one tick) and score, parked still in the pen. Once one in
;; FC_RUSHN of the starters is over (the first, in a room of eight or fewer),
;; the round has FC_RUSH more. A ball that fell somehow comes back on the catch
;; floor FC_DOWN later. A wave is announced FC_WARN before it drops. On the
;; round's last tick, everyone still climbing scored by how far up they are.
(func $fc_tick
  (local $p i32) (local $pb i32) (local $fl i32) (local $tick i32) (local $t i32) (local $fin0 i32) (local $nfin i32) (local $w i32)
  (local $x f32) (local $z f32) (local $xt f32)
  (local.set $tick (i32.load (i32.const @HDR_TICK)))
  (local.set $t (call $p_t (i32.const 0)))
  (local.set $xt (f32.load (i32.const @(PG_H + FC_XT))))
  (local.set $fin0 (i32.load (i32.const @(PG_H + FC_FIN))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (local.set $fl (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @(PF_LIVE | PF_DEAD))))
    (if (i32.and (i32.eq (local.get $fl) (i32.const @PF_LIVE)) (f32.ge (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (local.get $xt)))
      (then
        (call $fx (i32.const 0) (i32.const @FC_FX_FINISH) (local.get $p) (i32.add (local.get $fin0) (i32.const 1))
                  (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (!at f32 @(PLAYERS + P_PZ) (local.get $pb))
                  (f32.mul (f32.convert_i32_u (local.get $t)) (f32.const @DT)))
        (!put i32 @(PLAYERS + PG_M) (local.get $pb) (i32.or (i32.const @FC_M_FIN) (i32.add (local.get $fin0) (i32.const 1))))
        (!put u16 @(PLAYERS + PG_SCORE) (local.get $pb) (i32.sub (i32.const @FC_SCORE_FIN) (local.get $fin0)))
        (call $fc_pen (i32.add (local.get $fin0) (local.get $nfin)))
        (local.set $z) (local.set $x)
        (call $p_place (local.get $p) (local.get $x) (f32.const @(+PLAT_Y + FC_RISE)) (local.get $z))
        (!put u8 @(PLAYERS + P_FL) (local.get $pb) (i32.const @(PF_LIVE | PF_GROUND | PF_DEAD)))
        (!put i32 @(PLAYERS + B_OUTAT) (local.get $pb) (local.get $tick))
        (!inc $nfin))
      (else
        (if (i32.and (i32.and (i32.eq (local.get $fl) (i32.const @(PF_LIVE | PF_DEAD)))
                              (i32.eqz (i32.and (!at i32 @(PLAYERS + PG_M) (local.get $pb)) (i32.const @FC_M_FIN))))
                     (i32.ge_u (i32.sub (local.get $tick) (!at i32 @(PLAYERS + B_OUTAT) (local.get $pb))) (i32.const @FC_DOWN)))
          (then (call $p_respawn (local.get $p)))))))
  (if (local.get $nfin)
    (then
      (i32.store (i32.const @(PG_H + FC_FIN)) (i32.add (local.get $fin0) (local.get $nfin)))
      (if (i32.eqz (local.get $fin0)) (then (i32.store (i32.const @(PG_H + FC_FIRST)) (local.get $t))))
      ;; one in FC_RUSHN of the balls that started over the line: FC_RUSH left
      (local.set $w (i32.div_u (i32.add (i32.load (i32.const @BH_N0)) (i32.const @(FC_RUSHN - 1))) (i32.const @FC_RUSHN)))
      (if (i32.and (i32.lt_u (local.get $fin0) (local.get $w)) (i32.ge_u (i32.add (local.get $fin0) (local.get $nfin)) (local.get $w)))
        (then
          (if (i32.gt_u (i32.load (i32.const @HDR_UNTIL)) (i32.add (local.get $tick) (i32.const @FC_RUSH)))
            (then (i32.store (i32.const @HDR_UNTIL) (i32.add (local.get $tick) (i32.const @FC_RUSH)))))))))
  (local.set $w (i32.sub (i32.add (local.get $t) (i32.const @FC_WARN)) (i32.const @FC_WAVE0)))
  (if (i32.and (i32.ge_s (local.get $w) (i32.const 0)) (i32.eqz (i32.rem_u (local.get $w) (i32.const @FC_WAVEI))))
    (then
      (local.set $w (i32.div_u (local.get $w) (i32.const @FC_WAVEI)))
      (if (i32.lt_u (i32.add (i32.const @FC_WAVE0) (i32.mul (local.get $w) (i32.const @FC_WAVEI))) (i32.const @FC_LEN))
        (then
          (call $fx (i32.const 0) (i32.const @FC_FX_WAVE) (i32.const 255)
                    (i32.or (!ld u8 @(PG_S + FC_GAPS) (local.get $w))
                            (i32.shl (select (i32.const 2) (i32.const 1) (i32.ge_u (i32.load (i32.const @(PG_H + FC_NL))) (i32.const @FC_GAP2))) (i32.const 8)))
                    (f32.sub (local.get $xt) (f32.const @FC_DROPX)) (f32.const @(+PLAT_Y + FC_RISE)) (f32.load (i32.const @PG_CX))
                    (f32.convert_i32_u (i32.add (local.get $w) (i32.const 1))))))))
  (if (i32.ge_u (local.get $tick) (i32.load (i32.const @HDR_UNTIL))) (then (call $fc_progress))))

;; Everyone over the line (the round's own ends besides: the time, the rush).
(func $fc_over (result i32)
  (local $p i32) (local $pb i32)
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (if (i32.and (i32.ne (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_LIVE)) (i32.const 0))
                 (i32.eqz (i32.and (!at i32 @(PLAYERS + PG_M) (local.get $pb)) (i32.const @FC_M_FIN))))
      (then (return (i32.const 0)))))
  (i32.const 1))

(func $fc_out (param $p i32))
