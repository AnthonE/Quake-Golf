;; RISING LAVA: a rock tower of radius LV_RT in a crater of lava, and a route
;; winding up round it, a helix of turns each a pitch over the one before:
;; from a shelf at its foot (PLAT_Y), a flat start, then sections laid from
;; the round's seed (ramps, most with boulders rolling down them, steps a hop
;; high, gaps to hop, platforms sliding to and fro across wider gaps, narrow
;; ledges) to the summit, flush with the tower's top, and the crown in its
;; middle. The route is a band on the tower's side, LV_W wide, a rail along
;; its outer edge but at the start and on the ledges; its first turn is rock
;; down to the shelf, the turns over it slabs, so a ball through a gap or off
;; a ledge lands on the turn below, and one over the edge on the shelf. A hop
;; at the foot of a step climbs it. The lava starts under the shelf (deeper
;; for a bigger crowd), still for LV_STILL, then rises faster every phase; a
;; ball whose centre goes under it is out. A ball that touches the crown is
;; home, out of play, parked on a ring over the summit. Placed by PG_SCORE:
;; the order home, then the climbers still in by the best height they stood
;; at, then the lava's victims, the last first.
;;
;; The route is sections along its middle line (s, metres from the start;
;; a turn is LV_C of it), each a height over the shelf running along it, in
;; PG_S, laid in setup and fixed for the round. A point (x, z) is a radius
;; and an angle round the tower ($lv_turns: atan in f32, the octants folded),
;; and on the band one s a turn: (angle + k) LV_C. ground and push read the
;; sections, the slider's place and the boulders against $p_t on their own
;; bank (both functions of the tick and the seed), so the prediction is exact;
;; what a ball has made of the climb (its best height) is its own, in PG_M on
;; either bank. The lava, homecomings and their order are the confirmed
;; world's (tick), a round trip late like any out.

;; ---- where things are

;; The angle of (dx, dz) from +x toward +z, in turns [0, 1): atan's
;; polynomial on [0, 1] (to 1e-5 rad), folded out to the octant.
(func $lv_turns (param $dx f32) (param $dz f32) (result f32)
  (local $ax f32) (local $az f32) (local $mx f32) (local $t f32) (local $t2 f32) (local $a f32)
  (local.set $ax (f32.abs (local.get $dx)))
  (local.set $az (f32.abs (local.get $dz)))
  (local.set $mx (f32.max (local.get $ax) (local.get $az)))
  (if (f32.eq (local.get $mx) (f32.const 0)) (then (return (f32.const 0))))
  (local.set $t (f32.div (f32.min (local.get $ax) (local.get $az)) (local.get $mx)))
  (local.set $t2 (f32.mul (local.get $t) (local.get $t)))
  (local.set $a (f32.mul (local.get $t)
    (!madd (local.get $t2)
      (!madd (local.get $t2)
        (!madd (local.get $t2)
          (!madd (local.get $t2)
            (!madd (local.get $t2) (f32.const -0.0117212) (f32.const 0.05265332))
            (f32.const -0.11643287))
          (f32.const 0.19354346))
        (f32.const -0.33262347))
      (f32.const 0.99997726))))
  (if (f32.gt (local.get $az) (local.get $ax)) (then (local.set $a (f32.sub (f32.const 1.5707964) (local.get $a)))))
  (if (f32.lt (local.get $dx) (f32.const 0)) (then (local.set $a (f32.sub (f32.const 3.1415927) (local.get $a)))))
  (if (f32.lt (local.get $dz) (f32.const 0)) (then (local.set $a (f32.sub (f32.const 6.2831855) (local.get $a)))))
  (local.set $a (f32.mul (local.get $a) (f32.const 0.15915494)))
  (if (f32.ge (local.get $a) (f32.const 1)) (then (local.set $a (f32.sub (local.get $a) (f32.const 1)))))
  (local.get $a))

;; Section j's record.
(func $lv_sa (param $j i32) (result i32)
  (i32.add (i32.const @(PG_S + LV_SEC)) (i32.mul (local.get $j) (i32.const @LV_SSIZE))))

;; The section holding s on the route (the index's, or the next if s is past
;; it), -1 off either end.
(func $lv_sec (param $d i32) (param $s f32) (result i32)
  (local $j i32) (local $a i32)
  (if (i32.or (f32.lt (local.get $s) (f32.const 0)) (f32.ge (local.get $s) (f32.load offset=@(PG_H + LV_SEND) (local.get $d))))
    (then (return (i32.const -1))))
  (local.set $j (!ld u8 @(PG_S + LV_IDX) (i32.trunc_sat_f32_u (local.get $s))))
  (local.set $a (call $lv_sa (local.get $j)))
  (if (f32.ge (local.get $s) (f32.add (f32.load offset=@LV_S_S0 (local.get $a)) (f32.load offset=@LV_S_LEN (local.get $a))))
    (then (local.set $j (i32.add (local.get $j) (i32.const 1)))))
  (local.get $j))

;; A slider's platform on tick t into play: how far into its gap its near end
;; is. Still at the near end for LV_SL_DW, across to the far end, still, back.
(func $lv_slide (param $a i32) (param $t i32) (result f32)
  (local $per i32) (local $half i32) (local $mv i32) (local $q i32) (local $dd f32)
  (local.set $per (i32.load offset=@LV_S_P (local.get $a)))
  (local.set $half (i32.shr_u (local.get $per) (i32.const 1)))
  (local.set $mv (i32.sub (local.get $half) (i32.const @LV_SL_DW)))
  (local.set $q (i32.rem_u (i32.add (local.get $t) (i32.load offset=@LV_S_PH (local.get $a))) (local.get $per)))
  (local.set $dd (f32.load offset=@LV_S_D (local.get $a)))
  (if (i32.lt_u (local.get $q) (i32.const @LV_SL_DW)) (then (return (f32.const 0))))
  (if (i32.lt_u (local.get $q) (local.get $half))
    (then (return (f32.mul (local.get $dd) (f32.div (f32.convert_i32_u (i32.sub (local.get $q) (i32.const @LV_SL_DW))) (f32.convert_i32_u (local.get $mv)))))))
  (if (i32.lt_u (local.get $q) (i32.add (local.get $half) (i32.const @LV_SL_DW))) (then (return (local.get $dd))))
  (f32.sub (local.get $dd)
           (f32.mul (local.get $dd) (f32.div (f32.convert_i32_u (i32.sub (local.get $q) (i32.add (local.get $half) (i32.const @LV_SL_DW))))
                                             (f32.convert_i32_u (local.get $mv))))))

;; The route at s, u across its middle line (-LV_W / 2 at the tower), on bank
;; d's tick: the floor's top there (-1000 where there's none: a gap, the
;; outside of a ledge, a slider's gap but its platform), its height over the
;; shelf as if it were floored (1000 past either end), and the section.
(func $lv_floor (param $d i32) (param $s f32) (param $u f32) (result f32 f32 i32)
  (local $j i32) (local $a i32) (local $kind i32) (local $k i32) (local $on i32)
  (local $f f32) (local $h f32) (local $len f32) (local $wd f32) (local $wl f32) (local $g f32)
  (local.set $j (call $lv_sec (local.get $d) (local.get $s)))
  (if (i32.lt_s (local.get $j) (i32.const 0)) (then (return (f32.const -1000) (f32.const 1000) (i32.const -1))))
  (local.set $a (call $lv_sa (local.get $j)))
  (local.set $kind (i32.load offset=@LV_S_KIND (local.get $a)))
  (local.set $f (f32.sub (local.get $s) (f32.load offset=@LV_S_S0 (local.get $a))))
  (local.set $len (f32.load offset=@LV_S_LEN (local.get $a)))
  (local.set $h (f32.load offset=@LV_S_H0 (local.get $a)))
  (local.set $on (i32.const 1))
  (if (i32.or (i32.eq (local.get $kind) (i32.const @LV_RAMP)) (i32.eq (local.get $kind) (i32.const @LV_LEDGE)))
    (then (local.set $h (!madd (f32.sub (f32.load offset=@LV_S_H1 (local.get $a)) (local.get $h)) (f32.div (local.get $f) (local.get $len)) (local.get $h)))))
  (if (i32.eq (local.get $kind) (i32.const @LV_STEPS))
    (then
      (local.set $k (i32.trunc_sat_f32_u (f32.div (local.get $f) (f32.load offset=@LV_S_A (local.get $a)))))
      (if (i32.gt_u (local.get $k) (i32.trunc_sat_f32_u (f32.load offset=@LV_S_G (local.get $a))))
        (then (local.set $k (i32.trunc_sat_f32_u (f32.load offset=@LV_S_G (local.get $a))))))
      (local.set $h (!madd (f32.convert_i32_u (local.get $k)) (f32.const @LV_STEP_H) (local.get $h)))))
  (if (i32.or (i32.eq (local.get $kind) (i32.const @LV_GAP)) (i32.eq (local.get $kind) (i32.const @LV_SLIDER)))
    (then
      (local.set $g (f32.sub (local.get $f) (f32.load offset=@LV_S_A (local.get $a))))
      (if (i32.and (f32.ge (local.get $g) (f32.const 0)) (f32.lt (local.get $g) (f32.load offset=@LV_S_G (local.get $a))))
        (then
          (local.set $on (i32.const 0))
          (if (i32.eq (local.get $kind) (i32.const @LV_SLIDER))
            (then
              ;; but the platform where it is now
              (local.set $g (f32.sub (local.get $g) (call $lv_slide (local.get $a) (call $p_t (local.get $d)))))
              (local.set $on (i32.and (f32.ge (local.get $g) (f32.const 0)) (f32.lt (local.get $g) (f32.const @LV_SL_L))))))))))
  (if (i32.eq (local.get $kind) (i32.const @LV_LEDGE))
    (then
      ;; the width left from the tower: the whole route's at its ends, narrowing to the ledge's over LV_TAPER
      (local.set $wd (f32.load offset=@(PG_H + LV_W) (local.get $d)))
      (local.set $wl (!madd (f32.sub (f32.load offset=@LV_S_A (local.get $a)) (local.get $wd))
                            (f32.min (f32.const 1) (f32.div (f32.min (local.get $f) (f32.sub (local.get $len) (local.get $f))) (f32.const @LV_TAPER)))
                            (local.get $wd)))
      (local.set $on (f32.le (!madd (local.get $wd) (f32.const 0.5) (local.get $u)) (local.get $wl)))))
  (select (f32.add (f32.const @PLAT_Y) (local.get $h)) (f32.const -1000) (local.get $on))
  (local.get $h)
  (local.get $j))

;; The lava's top on tick t into play: LV_L0 under the shelf till LV_STILL,
;; then up through each phase at its pace.
(func $lv_lava (param $t i32) (result f32)
  (local $j i32) (local $k i32)
  (if (i32.lt_s (local.get $t) (i32.const @LV_STILL)) (then (return (f32.load (i32.const @(PG_S + LV_LAV))))))
  (local.set $k (i32.sub (local.get $t) (i32.const @LV_STILL)))
  (local.set $j (i32.div_u (local.get $k) (i32.const @LV_PH)))
  (if (i32.ge_u (local.get $j) (i32.const @LV_NPH)) (then (local.set $j (i32.const @(LV_NPH - 1)))))
  (!madd (!ld f32 @(PG_S + LV_RATE) (local.get $j)) (f32.convert_i32_u (i32.sub (local.get $k) (i32.mul (local.get $j) (i32.const @LV_PH))))
         (!ld f32 @(PG_S + LV_LAV) (local.get $j))))

;; ---- laying the route out (setup)

;; The route's k-th random number in [0, 1).
(func $lv_rnd (param $k i32) (result f32)
  (f32.mul (f32.convert_i32_u (i32.shr_u (call $hash32 (local.get $k) (i32.const 0x1a7a) (call $p_seed (i32.const @LV_KROUTE))) (i32.const 8)))
           (f32.const 0x1p-24)))

;; A section on the end of the route, from s0 at h0, len long rising dh;
;; its index.
(func $lv_add (param $kind i32) (param $fl i32) (param $s0 f32) (param $len f32) (param $h0 f32) (param $dh f32) (param $pa f32) (param $pg f32) (result i32)
  (local $j i32) (local $a i32)
  (local.set $j (i32.load (i32.const @(PG_H + LV_NSEC))))
  (local.set $a (call $lv_sa (local.get $j)))
  (i32.store offset=@LV_S_KIND (local.get $a) (local.get $kind))
  (i32.store offset=@LV_S_FL (local.get $a) (local.get $fl))
  (f32.store offset=@LV_S_S0 (local.get $a) (local.get $s0))
  (f32.store offset=@LV_S_LEN (local.get $a) (local.get $len))
  (f32.store offset=@LV_S_H0 (local.get $a) (local.get $h0))
  (f32.store offset=@LV_S_H1 (local.get $a) (f32.add (local.get $h0) (local.get $dh)))
  (f32.store offset=@LV_S_A (local.get $a) (local.get $pa))
  (f32.store offset=@LV_S_G (local.get $a) (local.get $pg))
  (i32.store (i32.const @(PG_H + LV_NSEC)) (i32.add (local.get $j) (i32.const 1)))
  (local.get $j))

;; The last section's end: where the next starts, and its height there.
(func $lv_end (result f32 f32)
  (local $a i32)
  (local.set $a (call $lv_sa (i32.sub (i32.load (i32.const @(PG_H + LV_NSEC))) (i32.const 1))))
  (f32.add (f32.load offset=@LV_S_S0 (local.get $a)) (f32.load offset=@LV_S_LEN (local.get $a)))
  (f32.load offset=@LV_S_H1 (local.get $a)))

;; A climb on the end of the route, from random number q: a ramp (its
;; boulders in lanes across it, unless calm) or steps.
(func $lv_climb (param $q i32) (param $ramp i32) (param $calm i32)
  (local $s f32) (local $h f32) (local $len f32) (local $n i32) (local $j i32) (local $a i32) (local $m i32)
  (call $lv_end)
  (local.set $h) (local.set $s)
  (if (local.get $ramp)
    (then
      (local.set $len (!madd (call $lv_rnd (local.get $q)) (f32.const @LV_RAMP_LK) (f32.const @LV_RAMP_L0)))
      (local.set $j (call $lv_add (i32.const @LV_RAMP) (select (i32.const 0) (i32.const @LV_F_BOULDERS) (local.get $calm))
        (local.get $s) (local.get $len) (local.get $h)
        (f32.mul (local.get $len) (!madd (call $lv_rnd (i32.add (local.get $q) (i32.const 1))) (f32.const @LV_RAMP_SK) (f32.const @LV_RAMP_S0)))
        (f32.const 0) (f32.const 0)))
      (local.set $a (call $lv_sa (local.get $j)))
      ;; boulder lanes LV_BLANE wide or so across it, LV_BLMAX at most; its key
      (local.set $m (i32.trunc_sat_f32_u (f32.div (f32.load (i32.const @(PG_H + LV_W))) (f32.const @LV_BLANE))))
      (if (i32.lt_u (local.get $m) (i32.const 1)) (then (local.set $m (i32.const 1))))
      (if (i32.gt_u (local.get $m) (i32.const @LV_BLMAX)) (then (local.set $m (i32.const @LV_BLMAX))))
      (i32.store offset=@LV_S_P (local.get $a) (local.get $m))
      (i32.store offset=@LV_S_PH (local.get $a) (call $p_seed (i32.add (i32.const @LV_KBOULDER) (local.get $j)))))
    (else
      (local.set $n (i32.add (i32.const @LV_STEPS0) (i32.trunc_sat_f32_u (f32.mul (call $lv_rnd (local.get $q)) (f32.const @LV_STEPSK)))))
      (drop (call $lv_add (i32.const @LV_STEPS) (i32.const 0) (local.get $s)
        (f32.mul (f32.convert_i32_u (i32.add (local.get $n) (i32.const 1))) (f32.const @LV_TREAD)) (local.get $h)
        (f32.mul (f32.convert_i32_u (local.get $n)) (f32.const @LV_STEP_H))
        (f32.const @LV_TREAD) (f32.convert_i32_u (local.get $n)))))))

;; A feature on the end of the route, from random number q: a gap, a slider
;; or a ledge.
(func $lv_feature (param $q i32) (param $kind i32)
  (local $s f32) (local $h f32) (local $g f32) (local $j i32) (local $a i32) (local $per i32)
  (call $lv_end)
  (local.set $h) (local.set $s)
  (if (i32.eq (local.get $kind) (i32.const @LV_GAP))
    (then
      (local.set $g (!madd (call $lv_rnd (local.get $q)) (f32.const @LV_GAPK) (f32.const @LV_GAP0)))
      (drop (call $lv_add (i32.const @LV_GAP) (i32.const 0) (local.get $s) (f32.add (local.get $g) (f32.const @(LV_GAP_A + LV_GAP_B))) (local.get $h)
        (f32.const 0) (f32.const @LV_GAP_A) (local.get $g)))))
  (if (i32.eq (local.get $kind) (i32.const @LV_SLIDER))
    (then
      (local.set $j (call $lv_add (i32.const @LV_SLIDER) (i32.const 0) (local.get $s) (f32.const @(LV_SL_A + LV_SL_L + LV_SL_D + LV_SL_B)) (local.get $h)
        (f32.const 0) (f32.const @LV_SL_A) (f32.const @(LV_SL_L + LV_SL_D))))
      (local.set $a (call $lv_sa (local.get $j)))
      (local.set $per (i32.and (i32.add (i32.const @LV_SL_P0) (i32.trunc_sat_f32_u (f32.mul (call $lv_rnd (local.get $q)) (f32.const @LV_SL_PK)))) (i32.const -2)))
      (i32.store offset=@LV_S_P (local.get $a) (local.get $per))
      (i32.store offset=@LV_S_PH (local.get $a) (i32.trunc_sat_f32_u (f32.mul (call $lv_rnd (i32.add (local.get $q) (i32.const 1))) (f32.convert_i32_u (local.get $per)))))
      (f32.store offset=@LV_S_D (local.get $a) (f32.const @LV_SL_D))))
  (if (i32.eq (local.get $kind) (i32.const @LV_LEDGE))
    (then
      (drop (call $lv_add (i32.const @LV_LEDGE) (i32.const 0) (local.get $s)
        (!madd (call $lv_rnd (local.get $q)) (f32.const @LV_LEDGE_LK) (f32.const @LV_LEDGE_L0)) (local.get $h) (f32.const @LV_LEDGE_RISE)
        (f32.max (f32.const @LV_LEDGE_MIN) (f32.mul (f32.load (i32.const @(PG_H + LV_W))) (f32.const @LV_LEDGE_K))) (f32.const 0))))))

;; The stage for n balls: the route as wide as the crowd wants and its start
;; as long, the shelf as wide; round the first turn climbs only (ramps and
;; steps: it is rock down to the shelf) and calm ones (the crowd is thick
;; there), then a gap, a slider or a ledge (in an order of the seed's) and a
;; climb by turns till the route is LV_HMIN up, then the summit. The lava's
;; heights and paces, deeper and slower the bigger the crowd. A scoring
;; round nobody comes back into (PK_SCORE, placed by PG_SCORE), braking with
;; no keys, bumps without their kick.
(func $lv_setup (param $n i32)
  (local $sq f32) (local $w f32) (local $rm f32) (local $c f32) (local $st f32) (local $s f32) (local $h f32) (local $u f32)
  (local $q i32) (local $k i32) (local $f i32) (local $j i32) (local $b i32) (local $t i32) (local $a i32) (local $first i32)
  (local.set $sq (f32.sqrt (f32.convert_i32_u (select (local.get $n) (i32.const 1) (local.get $n)))))
  (local.set $w (f32.min (!madd (local.get $sq) (f32.const @LV_WK) (f32.const @LV_W0)) (f32.const @LV_WMAX)))
  (!chk (local.get $w) 160 (local.get $n))
  (local.set $rm (!madd (local.get $w) (f32.const 0.5) (f32.const @LV_RT)))
  (local.set $c (f32.mul (local.get $rm) (f32.const 6.2831855)))
  (local.set $st (!madd (local.get $sq) (f32.const @LV_STK) (f32.const @LV_ST0)))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_SCORE))
  (i32.store (i32.const @PG_LEN) (i32.const @LV_LEN))
  (i32.store (i32.const @PG_RESPAWN) (i32.const 0x7fffffff))
  (f32.store (i32.const @PG_IDLE) (f32.const @LV_IDLE))
  ;; bumps without bumper's kick: in a crowd on a ramp the kicks pile up and throw balls off the tower
  (i32.store (i32.const @PG_FLAGS) (i32.const @(PGF_BUMPS | PGF_NOKICK)))
  (f32.store (i32.const @(PG_H + LV_W)) (local.get $w))
  (f32.store (i32.const @(PG_H + LV_RM)) (local.get $rm))
  (f32.store (i32.const @(PG_H + LV_C)) (local.get $c))
  (f32.store (i32.const @(PG_H + LV_RB))
    (f32.add (f32.add (f32.const @LV_RT) (local.get $w)) (!madd (local.get $sq) (f32.const @LV_SHK) (f32.const @LV_SH0))))
  (f32.store (i32.const @PG_SIZE) (f32.load (i32.const @(PG_H + LV_RB))))
  (f32.store (i32.const @(PG_H + LV_THS)) (f32.div (local.get $st) (local.get $c)))
  ;; the start, then climbs round the first turn
  (drop (call $lv_add (i32.const @LV_START) (i32.const 0) (f32.const 0) (local.get $st) (f32.const 0) (f32.const 0) (f32.const 0) (f32.const 0)))
  (local.set $q (i32.const 10))
  (local.set $first (i32.const 1))
  (block $turned
    (loop $more
      (call $lv_end)
      (local.set $h) (local.set $s)
      (br_if $turned (f32.ge (local.get $s) (local.get $c)))
      ;; a ramp first; after it, a ramp more often than steps; no boulders
      (call $lv_climb (local.get $q) (i32.or (local.get $first) (f32.lt (call $lv_rnd (i32.add (local.get $q) (i32.const 7))) (f32.const 0.55)))
                      (i32.const 1))
      (local.set $first (i32.const 0))
      (local.set $q (i32.add (local.get $q) (i32.const 8)))
      (br $more)))
  ;; the features' order (bytes in LV_IDX for now): two sliders, a gap and a ledge shuffled, then a gap and a
  ;; ledge shuffled, and round again
  (i32.store (i32.const @(PG_S + LV_IDX)) (i32.const @(LV_SLIDER | (LV_SLIDER << 8) | (LV_GAP << 16) | (LV_LEDGE << 24))))
  (i32.store16 (i32.const @(PG_S + LV_IDX + 4)) (i32.const @(LV_GAP | (LV_LEDGE << 8))))
  (!for $j (i32.const 0) (i32.const 5)
    (local.set $b (select (i32.const 4) (i32.const 6) (i32.lt_u (local.get $j) (i32.const 4))))
    (local.set $k (i32.add (local.get $j) (i32.trunc_sat_f32_u (f32.mul (call $lv_rnd (i32.add (i32.const 3) (local.get $j))) (f32.convert_i32_u (i32.sub (local.get $b) (local.get $j)))))))
    (if (i32.ge_u (local.get $k) (local.get $b)) (then (local.set $k (i32.sub (local.get $b) (i32.const 1)))))
    (local.set $t (!ld u8 @(PG_S + LV_IDX) (local.get $k)))
    (!st u8 @(PG_S + LV_IDX) (local.get $k) (!ld u8 @(PG_S + LV_IDX) (local.get $j)))
    (!st u8 @(PG_S + LV_IDX) (local.get $j) (local.get $t)))
  (block $high
    (loop $more
      (call $lv_end)
      (local.set $h) (local.set $s)
      (br_if $high (i32.or (f32.ge (local.get $h) (f32.const @LV_HMIN)) (i32.ge_u (i32.load (i32.const @(PG_H + LV_NSEC))) (i32.const @(LV_NS - 3)))))
      (call $lv_feature (local.get $q) (!ld u8 @(PG_S + LV_IDX) (i32.rem_u (local.get $f) (i32.const 6))))
      (call $lv_climb (i32.add (local.get $q) (i32.const 3)) (f32.lt (call $lv_rnd (i32.add (local.get $q) (i32.const 7))) (f32.const 0.55)) (i32.const 0))
      (local.set $f (i32.add (local.get $f) (i32.const 1)))
      (local.set $q (i32.add (local.get $q) (i32.const 8)))
      (br $more)))
  (drop (call $lv_add (i32.const @LV_SUMMIT) (i32.const 0) (local.get $s) (f32.const @LV_SUM_L) (local.get $h) (f32.const 0) (f32.const 0) (f32.const 0)))
  (call $lv_end)
  (local.set $h) (local.set $s)
  (f32.store (i32.const @(PG_H + LV_HT)) (local.get $h))
  (f32.store (i32.const @(PG_H + LV_SEND)) (local.get $s))
  ;; the index: the section holding each metre
  (local.set $j (i32.const 0))
  (!for $b (i32.const 0) (i32.const @LV_NIDX)
    (block $found
      (loop $next
        (br_if $found (i32.ge_u (local.get $j) (i32.sub (i32.load (i32.const @(PG_H + LV_NSEC))) (i32.const 1))))
        (local.set $a (call $lv_sa (local.get $j)))
        (br_if $found (f32.lt (f32.convert_i32_u (local.get $b)) (f32.add (f32.load offset=@LV_S_S0 (local.get $a)) (f32.load offset=@LV_S_LEN (local.get $a)))))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $next)))
    (!st u8 @(PG_S + LV_IDX) (local.get $b) (local.get $j)))
  ;; the first turn's top end, behind the start
  (call $lv_floor (i32.const 0) (f32.sub (local.get $c) (f32.const 0.001)) (f32.const 0))
  (drop) (local.set $h) (drop)
  (f32.store (i32.const @(PG_H + LV_HEND0)) (local.get $h))
  ;; the lava: deeper and slower for a bigger crowd; each phase's pace from the seed, and where it stands as each starts
  (f32.store (i32.const @(PG_S + LV_LAV)) (f32.sub (f32.const @PLAT_Y) (!madd (local.get $sq) (f32.const @LV_L0K) (f32.const @LV_L0))))
  (local.set $st (f32.div (f32.const @LV_VN0) (!madd (local.get $sq) (f32.const @LV_VNK) (f32.const 1))))
  (!for $j (i32.const 0) (i32.const @LV_NPH)
    (local.set $u (f32.mul (f32.convert_i32_u (i32.shr_u (call $p_seed (i32.add (i32.const @LV_KLAVA) (local.get $j))) (i32.const 8))) (f32.const 0x1p-24)))
    (!st f32 @(PG_S + LV_RATE) (local.get $j)
      (f32.mul (f32.mul (!madd (f32.convert_i32_u (local.get $j)) (f32.const @LV_VK) (f32.const @LV_V0)) (local.get $st))
               (!madd (local.get $u) (f32.const @LV_VJ) (f32.const @(1 - LV_VJ / 2)))))
    (!st f32 @(PG_S + LV_LAV) (i32.add (local.get $j) (i32.const 1))
      (!madd (!ld f32 @(PG_S + LV_RATE) (local.get $j)) (f32.const @LV_PH) (!ld f32 @(PG_S + LV_LAV) (local.get $j))))))

;; Start spot k: arcs LV_SP apart round the tower from LV_EDGE off it to
;; LV_EDGE short of the shelf's rim, over the start's span (LV_EDGE in from
;; its ends), filled a row at a time back from the start's end (spot q of
;; every arc long enough, then q + 1). (x, z).
(func $lv_spot (param $k i32) (result f32 f32)
  (local $q i32) (local $j i32) (local $m i32) (local $na i32) (local $rho f32) (local $ths f32) (local $rb f32) (local $s f32) (local $c f32)
  (local.set $ths (f32.load (i32.const @(PG_H + LV_THS))))
  (local.set $rb (f32.sub (f32.load (i32.const @(PG_H + LV_RB))) (f32.const @LV_EDGE)))
  (block $found
    (loop $row
      (local.set $na (i32.const 0))
      (local.set $j (i32.const 0))
      (block $arcs
        (loop $arc
          (local.set $rho (!madd (f32.convert_i32_u (local.get $j)) (f32.const @LV_SP) (f32.const @(LV_RT + LV_EDGE))))
          (br_if $arcs (f32.gt (local.get $rho) (local.get $rb)))
          ;; the spots this arc holds
          (local.set $m (i32.add (i32.trunc_sat_f32_s (f32.div (f32.sub (f32.mul (f32.mul (local.get $ths) (f32.const 6.2831855)) (local.get $rho)) (f32.const @(2 * LV_EDGE)))
                                                         (f32.const @LV_SP)))
                                 (i32.const 1)))
          (if (i32.lt_s (local.get $q) (local.get $m))
            (then
              (!inc $na)
              (br_if $found (i32.eqz (local.get $k)))
              (local.set $k (i32.sub (local.get $k) (i32.const 1)))))
          (!inc $j)
          (br $arc)))
      ;; every arc full: past the last row (a crowd too big for its start) start again at the front
      (if (i32.eqz (local.get $na)) (then (local.set $q (i32.const -1))))
      (!inc $q)
      (br $row)))
  (call $sincos (i32.trunc_sat_f32_s (f32.mul (f32.sub (local.get $ths) (f32.div (!madd (f32.convert_i32_u (local.get $q)) (f32.const @LV_SP) (f32.const @LV_EDGE))
                                                                             (f32.mul (local.get $rho) (f32.const 6.2831855))))
                                           (f32.const 16384))))
  (local.set $c) (local.set $s)
  (!madd (local.get $c) (local.get $rho) (f32.load (i32.const @PG_CX)))
  (!madd (local.get $s) (local.get $rho) (f32.load (i32.const @PG_CX))))

(func $lv_gcd (param $a i32) (param $b i32) (result i32)
  (local $t i32)
  (block $done
    (loop $next
      (br_if $done (i32.eqz (local.get $b)))
      (local.set $t (i32.rem_u (local.get $a) (local.get $b)))
      (local.set $a (local.get $b))
      (local.set $b (local.get $t))
      (br $next)))
  (local.get $a))

;; Ball i of n on its start spot, in an order the round's seed shuffles (i
;; times a stride prime to n, plus an offset); a ball in late (n 1024)
;; anywhere over the start.
(func $lv_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $seed i32) (local $stride i32) (local $x f32) (local $z f32) (local $rho f32) (local $s f32) (local $c f32)
  (if (i32.ge_u (local.get $n) (i32.const 1024))
    (then
      (local.set $rho (!madd (f32.mul (f32.convert_i32_u (i32.and (local.get $i) (i32.const 31))) (f32.const 0.032258064))
                             (f32.sub (f32.load (i32.const @(PG_H + LV_RB))) (f32.const @(LV_RT + 2 * LV_EDGE)))
                             (f32.const @(LV_RT + LV_EDGE))))
      (call $sincos (i32.trunc_sat_f32_s (f32.mul (f32.load (i32.const @(PG_H + LV_THS)))
                                                  (!madd (f32.convert_i32_u (i32.and (i32.shr_u (local.get $i) (i32.const 5)) (i32.const 31))) (f32.const 361.29032) (f32.const 2457.6)))))
      (local.set $c) (local.set $s)
      (return (!madd (local.get $c) (local.get $rho) (f32.load (i32.const @PG_CX))) (f32.const @PLAT_Y)
              (!madd (local.get $s) (local.get $rho) (f32.load (i32.const @PG_CX))))))
  (local.set $seed (call $p_seed (i32.const @LV_KSPAWN)))
  (local.set $stride (i32.add (i32.and (local.get $seed) (i32.const 127)) (i32.const 1)))
  (block $prime
    (loop $next
      (br_if $prime (i32.eq (call $lv_gcd (local.get $stride) (local.get $n)) (i32.const 1)))
      (local.set $stride (i32.add (local.get $stride) (i32.const 1)))
      (br $next)))
  (call $lv_spot (i32.rem_u (i32.add (i32.mul (local.get $i) (local.get $stride)) (i32.shr_u (local.get $seed) (i32.const 8))) (select (local.get $n) (i32.const 1) (local.get $n))))
  (local.set $z) (local.set $x)
  (local.get $x) (f32.const @PLAT_Y) (local.get $z))

(func $lv_start)
(func $lv_begin (param $p i32) (param $d i32))

;; ---- a ball's own tick, on bank d

;; The highest top no higher than y under (x, z) on bank d: the summit on the
;; tower; on the band each turn's floor there, from the first up while it's
;; no higher than y; the shelf past the band to its rim. -1000 for none.
(func $lv_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (local $dx f32) (local $dz f32) (local $rho f32) (local $ro f32) (local $th f32) (local $u f32) (local $c f32) (local $s f32)
  (local $top f32) (local $h f32) (local $best f32) (local $k i32)
  (local.set $dx (f32.sub (local.get $x) (f32.load offset=@PG_CX (local.get $d))))
  (local.set $dz (f32.sub (local.get $z) (f32.load offset=@PG_CX (local.get $d))))
  (local.set $rho (f32.sqrt (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz)))))
  (if (f32.lt (local.get $rho) (f32.const @LV_RT))
    (then
      (local.set $top (f32.add (f32.const @PLAT_Y) (f32.load offset=@(PG_H + LV_HT) (local.get $d))))
      (return (select (local.get $top) (f32.const -1000) (f32.le (local.get $top) (local.get $y))))))
  (local.set $ro (f32.add (f32.const @LV_RT) (f32.load offset=@(PG_H + LV_W) (local.get $d))))
  (if (f32.gt (local.get $rho) (local.get $ro))
    (then
      (return (select (f32.const @PLAT_Y) (f32.const -1000)
                      (i32.and (f32.le (local.get $rho) (f32.load offset=@(PG_H + LV_RB) (local.get $d))) (f32.le (f32.const @PLAT_Y) (local.get $y)))))))
  (local.set $th (call $lv_turns (local.get $dx) (local.get $dz)))
  (local.set $u (f32.sub (local.get $rho) (f32.load offset=@(PG_H + LV_RM) (local.get $d))))
  (local.set $c (f32.load offset=@(PG_H + LV_C) (local.get $d)))
  (local.set $best (f32.const -1000))
  (block $done
    (loop $turn
      (local.set $s (f32.mul (f32.add (local.get $th) (f32.convert_i32_u (local.get $k))) (local.get $c)))
      (call $lv_floor (local.get $d) (local.get $s) (local.get $u))
      (drop) (local.set $h) (local.set $top)
      (br_if $done (f32.gt (f32.add (f32.const @PLAT_Y) (local.get $h)) (local.get $y)))
      (if (f32.le (local.get $top) (local.get $y)) (then (local.set $best (f32.max (local.get $best) (local.get $top)))))
      (!inc $k)
      (br $turn)))
  (local.get $best))

;; After the ball's roll, on bank d's tick. The walls: the tower up to the
;; summit; the first turn's top end behind the start; on the band, the riser
;; over the tread a ball stands on, a gap's faces to a ball down in it, the
;; summit's far end, and the first turn's outer face to a ball on the shelf
;; under its top (each puts it back against the wall, LV_BOUNCE of what it hit
;; with given back). Then on its floor: kept on it rolling down a ramp, pulled
;; down a ramp or a ledge, carried by a slider's platform; the boulders on its
;; ramp, where the schedule and the tick have them (out of one, sent off it);
;; its best height. Writes only its own record and the FX on bank d.
(func $lv_push (param $p i32) (param $d i32)
  (local $pb i32) (local $fl i32) (local $k i32) (local $kb i32) (local $j i32) (local $a i32) (local $kind i32) (local $t i32) (local $lev i32)
  (local $m i32) (local $l i32) (local $per i32) (local $base i32) (local $t0 i32) (local $age i32) (local $key i32) (local $bk i32) (local $inb i32)
  (local $px f32) (local $py f32) (local $pz f32) (local $vx f32) (local $vy f32) (local $vz f32) (local $r f32)
  (local $cx f32) (local $dx f32) (local $dz f32) (local $rho f32) (local $ex f32) (local $ez f32) (local $tx f32) (local $tz f32)
  (local $w f32) (local $rm f32) (local $c f32) (local $ro f32) (local $ht f32) (local $th f32) (local $u f32) (local $s f32) (local $sb f32)
  (local $h f32) (local $h0 f32) (local $top f32) (local $rs f32) (local $q f32) (local $vt f32) (local $vr f32) (local $e f32) (local $s0 f32)
  (local $len f32) (local $v f32) (local $sbo f32) (local $yb f32) (local $ds f32) (local $ub f32) (local $rb f32) (local $an f32) (local $a2 f32)
  (local $cs f32) (local $sn f32) (local $bx f32) (local $bz f32) (local $ddx f32) (local $ddy f32) (local $ddz f32) (local $rr f32)
  (local $hn f32) (local $hh f32) (local $nx f32) (local $nz f32) (local $vbs f32) (local $rel f32) (local $dv f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
  (if (i32.and (local.get $fl) (i32.const @(PF_FALL | PF_DEAD))) (then (return)))
  (local.set $px (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (local.set $py (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
  (local.set $pz (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (local.set $vx (!at f32 @(PLAYERS + P_VX) (local.get $pb)))
  (local.set $vy (!at f32 @(PLAYERS + P_VY) (local.get $pb)))
  (local.set $vz (!at f32 @(PLAYERS + P_VZ) (local.get $pb)))
  (local.set $r (call $b_rad (local.get $pb)))
  (local.set $e (f32.const @(1 + LV_BOUNCE)))
  (local.set $cx (f32.load offset=@PG_CX (local.get $d)))
  (local.set $w (f32.mul (f32.load offset=@(PG_H + LV_W) (local.get $d)) (f32.const 0.5)))
  (local.set $rm (f32.load offset=@(PG_H + LV_RM) (local.get $d)))
  (local.set $c (f32.load offset=@(PG_H + LV_C) (local.get $d)))
  (local.set $ro (f32.add (f32.const @LV_RT) (f32.load offset=@(PG_H + LV_W) (local.get $d))))
  (local.set $ht (f32.add (f32.const @PLAT_Y) (f32.load offset=@(PG_H + LV_HT) (local.get $d))))
  (local.set $t (call $p_t (local.get $d)))
  (local.set $dx (f32.sub (local.get $px) (local.get $cx)))
  (local.set $dz (f32.sub (local.get $pz) (local.get $cx)))
  (local.set $rho (f32.sqrt (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz)))))
  (local.set $ex (f32.const 1)) (local.set $ez (f32.const 0))
  (if (f32.gt (local.get $rho) (f32.const 0.0001))
    (then (local.set $ex (f32.div (local.get $dx) (local.get $rho))) (local.set $ez (f32.div (local.get $dz) (local.get $rho)))))

  ;; the tower, under the summit
  (if (i32.and (f32.lt (local.get $rho) (f32.add (f32.const @LV_RT) (local.get $r))) (f32.lt (local.get $py) (f32.sub (local.get $ht) (f32.const @P_STEP))))
    (then
      (local.set $rho (f32.add (f32.const @LV_RT) (local.get $r)))
      (local.set $px (!madd (local.get $ex) (local.get $rho) (local.get $cx)))
      (local.set $pz (!madd (local.get $ez) (local.get $rho) (local.get $cx)))
      (local.set $vr (!madd (local.get $vx) (local.get $ex) (f32.mul (local.get $vz) (local.get $ez))))
      (if (f32.lt (local.get $vr) (f32.const 0))
        (then
          (local.set $vx (f32.sub (local.get $vx) (f32.mul (local.get $ex) (f32.mul (local.get $vr) (local.get $e)))))
          (local.set $vz (f32.sub (local.get $vz) (f32.mul (local.get $ez) (f32.mul (local.get $vr) (local.get $e)))))))))
  ;; the first turn's top end, the plane z = cx on the +x side, the start in front of it: a ball under its
  ;; top touching it from the start's side, or in its rock (under the turn's top there) nearer that side than
  ;; the outer face, back out to the start
  (if (i32.and (i32.and (f32.gt (local.get $dx) (f32.const 0)) (i32.and (f32.ge (local.get $rho) (f32.const @LV_RT)) (f32.le (local.get $rho) (local.get $ro))))
               (i32.and (f32.lt (local.get $dz) (local.get $r)) (f32.gt (local.get $dz) (f32.const @(-LV_ENDD)))))
    (then
      (local.set $h (f32.load offset=@(PG_H + LV_HEND0) (local.get $d)))
      (if (f32.lt (local.get $dz) (f32.const 0))
        (then
          (call $lv_floor (local.get $d) (f32.mul (call $lv_turns (local.get $dx) (local.get $dz)) (local.get $c)) (f32.const 0))
          (drop) (local.set $h) (drop)))
      (if (i32.and (f32.lt (local.get $py) (f32.sub (f32.add (f32.const @PLAT_Y) (local.get $h)) (f32.const @P_STEP)))
                   (i32.or (f32.ge (local.get $dz) (f32.const 0)) (f32.lt (f32.sub (local.get $r) (local.get $dz)) (f32.sub (f32.add (local.get $ro) (local.get $r)) (local.get $rho)))))
        (then
          (local.set $dz (local.get $r))
          (local.set $pz (f32.add (local.get $cx) (local.get $r)))
          (if (f32.lt (local.get $vz) (f32.const 0)) (then (local.set $vz (f32.mul (local.get $vz) (f32.const @(-LV_BOUNCE))))))
          (local.set $rho (f32.sqrt (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz)))))
          (local.set $ex (f32.div (local.get $dx) (local.get $rho)))
          (local.set $ez (f32.div (local.get $dz) (local.get $rho)))))))
  ;; the way up the route here, and round the tower
  (local.set $tx (f32.neg (local.get $ez)))
  (local.set $tz (local.get $ex))

  (if (i32.and (f32.ge (local.get $rho) (f32.const @LV_RT)) (f32.lt (local.get $rho) (f32.add (local.get $ro) (local.get $r))))
    (then
      ;; on the band or by it: its turn (the highest whose floor's top it's no more than LV_DEEP under), where along
      (local.set $th (call $lv_turns (local.get $dx) (local.get $dz)))
      (local.set $u (f32.sub (local.get $rho) (local.get $rm)))
      (local.set $kb (i32.const -1))
      (block $done
        (loop $turn
          (local.set $s (f32.mul (f32.add (local.get $th) (f32.convert_i32_u (local.get $k))) (local.get $c)))
          (br_if $done (f32.ge (local.get $s) (f32.load offset=@(PG_H + LV_SEND) (local.get $d))))
          (call $lv_floor (local.get $d) (local.get $s) (local.get $u))
          (drop) (local.set $h) (drop)
          (br_if $done (f32.gt (f32.sub (f32.add (f32.const @PLAT_Y) (local.get $h)) (f32.const @LV_DEEP)) (local.get $py)))
          (local.set $kb (local.get $k))
          (local.set $sb (local.get $s))
          (!inc $k)
          (br $turn)))
      ;; under the first turn's top: beside it on the shelf, or in its rock
      (if (i32.lt_s (local.get $kb) (i32.const 0)) (then (local.set $kb (i32.const 0)) (local.set $sb (f32.mul (local.get $th) (local.get $c)))))
      (local.set $j (call $lv_sec (local.get $d) (local.get $sb)))
      (if (i32.ge_s (local.get $j) (i32.const 0))
        (then
          (local.set $a (call $lv_sa (local.get $j)))
          (local.set $kind (i32.load offset=@LV_S_KIND (local.get $a)))
          (local.set $s0 (f32.load offset=@LV_S_S0 (local.get $a)))
          (local.set $h0 (f32.add (f32.const @PLAT_Y) (f32.load offset=@LV_S_H0 (local.get $a))))
          (local.set $rs (f32.div (f32.mul (local.get $r) (local.get $rm)) (local.get $rho)))
          (local.set $q (f32.const -1))
          (local.set $inb (f32.le (local.get $rho) (local.get $ro)))
          ;; steps: the riser over the highest tread it can stand on, if it is into it
          (if (i32.and (local.get $inb) (i32.eq (local.get $kind) (i32.const @LV_STEPS)))
            (then
              (local.set $lev (i32.trunc_sat_f32_s (f32.floor (f32.div (f32.sub (f32.add (local.get $py) (f32.const @P_STEP)) (local.get $h0)) (f32.const @LV_STEP_H)))))
              (if (i32.lt_s (local.get $lev) (i32.const 0)) (then (local.set $lev (i32.const 0))))
              (if (i32.lt_s (local.get $lev) (i32.trunc_sat_f32_s (f32.load offset=@LV_S_G (local.get $a))))
                (then
                  (local.set $s (!madd (f32.convert_i32_s (i32.add (local.get $lev) (i32.const 1))) (f32.load offset=@LV_S_A (local.get $a)) (local.get $s0)))
                  (if (i32.and (f32.gt (local.get $sb) (f32.sub (local.get $s) (local.get $rs)))
                               (i32.or (i32.eqz (local.get $kb))
                                       (f32.gt (local.get $py) (f32.sub (!madd (f32.convert_i32_s (i32.add (local.get $lev) (i32.const 1))) (f32.const @LV_STEP_H) (local.get $h0)) (f32.const @LV_DEEP)))))
                    (then (local.set $q (f32.sub (local.get $s) (local.get $rs)))))))
              ;; rising off a tread with the riser just ahead of it, a step up from it: up the way onto the tread
              ;; over it at LV_STEP_V at least (a hop climbs a step from a standstill)
              (if (i32.and (i32.and (i32.eqz (i32.and (local.get $fl) (i32.const @PF_GROUND))) (f32.gt (local.get $vy) (f32.const 0)))
                           (i32.and (i32.gt_s (local.get $lev) (i32.const 0))
                                    (i32.le_s (local.get $lev) (i32.trunc_sat_f32_s (f32.load offset=@LV_S_G (local.get $a))))))
                (then
                  (local.set $s (!madd (f32.convert_i32_s (local.get $lev)) (f32.load offset=@LV_S_A (local.get $a)) (local.get $s0)))
                  (if (i32.and (f32.lt (local.get $sb) (local.get $s)) (f32.gt (local.get $sb) (f32.sub (f32.sub (local.get $s) (local.get $rs)) (f32.const @LV_STEP_D))))
                    (then
                      (local.set $vt (!madd (local.get $vx) (local.get $tx) (f32.mul (local.get $vz) (local.get $tz))))
                      (if (i32.and (f32.lt (local.get $vt) (f32.const @LV_STEP_V)) (f32.gt (local.get $vt) (f32.const -0.5)))
                        (then
                          (local.set $vx (!madd (local.get $tx) (f32.sub (f32.const @LV_STEP_V) (local.get $vt)) (local.get $vx)))
                          (local.set $vz (!madd (local.get $tz) (f32.sub (f32.const @LV_STEP_V) (local.get $vt)) (local.get $vz)))))))))))
          ;; a gap's faces (a slider's pads too), to a ball down in it
          (if (i32.and (i32.and (local.get $inb) (i32.or (i32.eq (local.get $kind) (i32.const @LV_GAP)) (i32.eq (local.get $kind) (i32.const @LV_SLIDER))))
                       (i32.and (f32.lt (local.get $py) (f32.sub (local.get $h0) (f32.const @P_STEP))) (f32.gt (local.get $py) (f32.sub (local.get $h0) (f32.const @LV_DEEP)))))
            (then
              (local.set $s (f32.add (local.get $s0) (f32.load offset=@LV_S_A (local.get $a))))
              (if (i32.and (f32.lt (local.get $sb) (f32.add (local.get $s) (local.get $rs))) (f32.gt (local.get $sb) (f32.sub (local.get $s) (f32.const 2))))
                (then (local.set $q (f32.add (local.get $s) (local.get $rs)))))
              (local.set $s (f32.add (local.get $s) (f32.load offset=@LV_S_G (local.get $a))))
              (if (i32.and (f32.gt (local.get $sb) (f32.sub (local.get $s) (local.get $rs))) (f32.lt (local.get $sb) (f32.add (local.get $s) (f32.const 2))))
                (then (local.set $q (f32.sub (local.get $s) (local.get $rs)))))))
          ;; the summit's far end
          (if (i32.and (i32.and (local.get $inb) (i32.eq (local.get $kind) (i32.const @LV_SUMMIT)))
                       (i32.and (f32.gt (local.get $py) (f32.sub (local.get $h0) (f32.const @LV_DEEP)))
                                (f32.gt (local.get $sb) (f32.sub (f32.load offset=@(PG_H + LV_SEND) (local.get $d)) (local.get $rs)))))
            (then (local.set $q (f32.sub (f32.load offset=@(PG_H + LV_SEND) (local.get $d)) (local.get $rs)))))
          ;; put back along the way to q (s), what it had into the wall given back
          (if (f32.ge (local.get $q) (f32.const 0))
            (then
              (local.set $s (f32.div (f32.mul (f32.sub (local.get $q) (local.get $sb)) (local.get $rho)) (local.get $rm)))
              (local.set $px (!madd (local.get $tx) (local.get $s) (local.get $px)))
              (local.set $pz (!madd (local.get $tz) (local.get $s) (local.get $pz)))
              (local.set $vt (!madd (local.get $vx) (local.get $tx) (f32.mul (local.get $vz) (local.get $tz))))
              (if (f32.lt (f32.mul (local.get $vt) (local.get $s)) (f32.const 0))
                (then
                  (local.set $vx (f32.sub (local.get $vx) (f32.mul (local.get $tx) (f32.mul (local.get $vt) (local.get $e)))))
                  (local.set $vz (f32.sub (local.get $vz) (f32.mul (local.get $tz) (f32.mul (local.get $vt) (local.get $e)))))))
              (local.set $sb (local.get $q))))
          ;; the rail along the outer edge (none on the start, a ledge or over a gap): a ball under its top, its centre
          ;; over the route, kept on it
          (if (i32.and (i32.and (local.get $inb) (f32.gt (local.get $rho) (f32.sub (local.get $ro) (local.get $r))))
                       (i32.and (i32.ne (local.get $kind) (i32.const @LV_START)) (i32.ne (local.get $kind) (i32.const @LV_LEDGE))))
            (then
              (call $lv_floor (local.get $d) (local.get $sb) (local.get $w))
              (drop) (drop) (local.set $top)
              (if (i32.and (f32.gt (local.get $top) (f32.const -999))
                           (i32.and (f32.lt (local.get $py) (f32.add (local.get $top) (f32.const @LV_RAIL)))
                                    (i32.or (i32.eqz (local.get $kb)) (f32.gt (local.get $py) (f32.sub (local.get $top) (f32.const @LV_DEEP))))))
                (then
                  (local.set $rho (f32.sub (local.get $ro) (local.get $r)))
                  (local.set $px (!madd (local.get $ex) (local.get $rho) (local.get $cx)))
                  (local.set $pz (!madd (local.get $ez) (local.get $rho) (local.get $cx)))
                  (local.set $vr (!madd (local.get $vx) (local.get $ex) (f32.mul (local.get $vz) (local.get $ez))))
                  (if (f32.gt (local.get $vr) (f32.const 0))
                    (then
                      (local.set $vx (f32.sub (local.get $vx) (f32.mul (local.get $ex) (f32.mul (local.get $vr) (local.get $e)))))
                      (local.set $vz (f32.sub (local.get $vz) (f32.mul (local.get $ez) (f32.mul (local.get $vr) (local.get $e)))))))))))
          ;; the first turn's outer face: a ball under its top here is on the shelf beside it (or in it), out it goes
          (if (i32.eqz (local.get $kb))
            (then
              (call $lv_floor (local.get $d) (local.get $sb) (f32.const 0))
              (drop) (local.set $h) (drop)
              (if (f32.lt (local.get $py) (f32.sub (f32.add (f32.const @PLAT_Y) (local.get $h)) (f32.const @P_STEP)))
                (then
                  (local.set $rho (f32.add (local.get $ro) (local.get $r)))
                  (local.set $px (!madd (local.get $ex) (local.get $rho) (local.get $cx)))
                  (local.set $pz (!madd (local.get $ez) (local.get $rho) (local.get $cx)))
                  (local.set $vr (!madd (local.get $vx) (local.get $ex) (f32.mul (local.get $vz) (local.get $ez))))
                  (if (f32.lt (local.get $vr) (f32.const 0))
                    (then
                      (local.set $vx (f32.sub (local.get $vx) (f32.mul (local.get $ex) (f32.mul (local.get $vr) (local.get $e)))))
                      (local.set $vz (f32.sub (local.get $vz) (f32.mul (local.get $ez) (f32.mul (local.get $vr) (local.get $e)))))))))))
          (local.set $u (f32.sub (local.get $rho) (local.get $rm)))
          (local.set $inb (f32.le (local.get $rho) (local.get $ro)))

          ;; its floor now: the route's on its turn, or the shelf's by it
          (local.set $top (f32.const @PLAT_Y))
          (if (local.get $inb)
            (then
              (call $lv_floor (local.get $d) (local.get $sb) (local.get $u))
              (drop) (drop) (local.set $top)))
          ;; just over it and not rising (rolling down a ramp leaves it by a hair a tick), or a step's
          ;; height into it (put back off a riser): on it
          (if (i32.and (i32.eqz (i32.and (local.get $fl) (i32.const @PF_GROUND)))
                       (i32.and (f32.le (local.get $vy) (f32.const 0))
                                (i32.and (f32.ge (local.get $py) (f32.sub (local.get $top) (f32.const @P_STEP))) (f32.le (local.get $py) (f32.add (local.get $top) (f32.const @LV_SNAP))))))
            (then
              (local.set $py (local.get $top))
              (local.set $vy (f32.const 0))
              (local.set $fl (i32.or (local.get $fl) (i32.const @PF_GROUND)))))
          (if (i32.and (i32.and (local.get $inb) (i32.ne (i32.and (local.get $fl) (i32.const @PF_GROUND)) (i32.const 0))) (f32.gt (local.get $top) (f32.const -999)))
            (then
              (local.set $len (f32.load offset=@LV_S_LEN (local.get $a)))
              ;; a ramp's or a ledge's slope pulls it down (steeper on the inside of the turn)
              (if (i32.or (i32.eq (local.get $kind) (i32.const @LV_RAMP)) (i32.eq (local.get $kind) (i32.const @LV_LEDGE)))
                (then
                  (local.set $q (f32.mul (f32.div (f32.mul (f32.div (f32.sub (f32.load offset=@LV_S_H1 (local.get $a)) (f32.load offset=@LV_S_H0 (local.get $a))) (local.get $len)) (local.get $rm))
                                                  (local.get $rho))
                                         (f32.const @(LV_PULL * DT))))
                  (local.set $vx (f32.sub (local.get $vx) (f32.mul (local.get $tx) (local.get $q))))
                  (local.set $vz (f32.sub (local.get $vz) (f32.mul (local.get $tz) (local.get $q))))))
              ;; on a slider's platform: carried with it to where it is next tick
              (if (i32.eq (local.get $kind) (i32.const @LV_SLIDER))
                (then
                  (local.set $q (f32.sub (f32.sub (local.get $sb) (local.get $s0)) (f32.load offset=@LV_S_A (local.get $a))))
                  (if (i32.and (f32.ge (local.get $q) (f32.const 0)) (f32.lt (local.get $q) (f32.load offset=@LV_S_G (local.get $a))))
                    (then
                      (local.set $q (f32.div (f32.mul (f32.sub (call $lv_slide (local.get $a) (i32.add (local.get $t) (i32.const 1))) (call $lv_slide (local.get $a) (local.get $t)))
                                                      (local.get $rho))
                                             (local.get $rm)))
                      (local.set $px (!madd (local.get $tx) (local.get $q) (local.get $px)))
                      (local.set $pz (!madd (local.get $tz) (local.get $q) (local.get $pz)))))))
              ;; its best height
              (local.set $l (i32.trunc_sat_f32_u (f32.mul (f32.sub (local.get $top) (f32.const @PLAT_Y)) (f32.const 100))))
              (if (i32.gt_u (local.get $l) (!at i32 @(PLAYERS + PG_M) (local.get $pb))) (then (!put i32 @(PLAYERS + PG_M) (local.get $pb) (local.get $l))))))

          ;; the boulders down its ramp, as they are on this tick: each lane's own schedule; one dropping in at
          ;; the top (LV_BDH in LV_BDROP), then rolling down to the foot, gone there. Where one is, from this
          ;; ball's side of the tower: ds along the route is an angle round it, worked from the ball's own
          ;; radius and way round (cos and sin in series: ds is a few metres at most)
          (if (i32.and (i32.and (local.get $inb) (i32.eq (local.get $kind) (i32.const @LV_RAMP)))
                       (i32.ne (i32.and (i32.load offset=@LV_S_FL (local.get $a)) (i32.const @LV_F_BOULDERS)) (i32.const 0)))
            (then
              (local.set $m (i32.load offset=@LV_S_P (local.get $a)))
              (local.set $key (i32.load offset=@LV_S_PH (local.get $a)))
              (local.set $len (f32.load offset=@LV_S_LEN (local.get $a)))
              (local.set $rr (f32.add (local.get $r) (f32.const @LV_BR)))
              (!for $l (i32.const 0) (local.get $m)
                (local.set $per (i32.add (i32.const @LV_BP0) (i32.rem_u (call $hash32 (local.get $l) (i32.const 1) (local.get $key)) (i32.const @LV_BPN))))
                (local.set $base (i32.add (i32.const @LV_B0) (i32.rem_u (call $hash32 (local.get $l) (i32.const 2) (local.get $key)) (local.get $per))))
                (if (i32.ge_s (local.get $t) (local.get $base))
                  (then
                    (local.set $bk (i32.div_u (i32.sub (local.get $t) (local.get $base)) (local.get $per)))
                    (!for $k (select (i32.sub (local.get $bk) (i32.const 2)) (i32.const 0) (i32.ge_u (local.get $bk) (i32.const 2))) (i32.add (local.get $bk) (i32.const 1))
                      (local.set $t0 (i32.add (i32.add (local.get $base) (i32.mul (local.get $k) (local.get $per)))
                                              (i32.rem_u (call $hash32 (local.get $l) (local.get $k) (i32.xor (local.get $key) (i32.const 0x5bd1))) (i32.const @LV_BJ))))
                      (local.set $age (i32.sub (local.get $t) (local.get $t0)))
                      (if (i32.ge_s (local.get $age) (i32.const 0))
                        (then
                          (local.set $v (f32.mul (!madd (f32.mul (f32.convert_i32_u (i32.shr_u (call $hash32 (local.get $k) (local.get $l) (i32.xor (local.get $key) (i32.const 0x7e3a))) (i32.const 8)))
                                                                 (f32.const 0x1p-24))
                                                        (f32.const @LV_BVK) (f32.const @LV_BV0))
                                                 (f32.const @DT)))
                          (local.set $sbo (f32.sub (f32.add (local.get $s0) (local.get $len)) (f32.const @LV_BR)))
                          (local.set $yb (f32.const 0))
                          (local.set $vbs (f32.const 0))
                          (if (i32.lt_s (local.get $age) (i32.const @LV_BDROP))
                            (then
                              (local.set $q (f32.mul (f32.convert_i32_s (local.get $age)) (f32.const @(1 / LV_BDROP))))
                              (local.set $yb (f32.mul (f32.const @LV_BDH) (f32.sub (f32.const 1) (f32.mul (local.get $q) (local.get $q))))))
                            (else
                              (local.set $sbo (f32.sub (local.get $sbo) (f32.mul (f32.convert_i32_s (i32.sub (local.get $age) (i32.const @LV_BDROP))) (local.get $v))))
                              (local.set $vbs (f32.mul (local.get $v) (f32.const @(1 / DT))))))
                          (local.set $ds (f32.sub (local.get $sbo) (local.get $sb)))
                          (if (i32.and (f32.ge (local.get $sbo) (local.get $s0)) (f32.lt (f32.abs (local.get $ds)) (f32.const 4)))
                            (then
                              (local.set $ub (!madd (f32.div (f32.add (f32.convert_i32_u (local.get $l)) (f32.const 0.5)) (f32.convert_i32_u (local.get $m))) (f32.mul (local.get $w) (f32.const 2))
                                                    (f32.neg (local.get $w))))
                              (local.set $rb (f32.add (local.get $rm) (local.get $ub)))
                              (local.set $an (f32.div (local.get $ds) (local.get $rm)))
                              (local.set $a2 (f32.mul (local.get $an) (local.get $an)))
                              (local.set $cs (!madd (local.get $a2) (!madd (local.get $a2) (f32.const 0.041666668) (f32.const -0.5)) (f32.const 1)))
                              (local.set $sn (f32.mul (local.get $an) (!madd (local.get $a2) (!madd (local.get $a2) (f32.const 0.008333334) (f32.const -0.16666667)) (f32.const 1))))
                              ;; the boulder's centre: rb round at the angle an on from the ball's
                              (local.set $q (f32.sub (f32.mul (local.get $rb) (local.get $cs)) (local.get $rho)))
                              (local.set $hh (f32.mul (local.get $rb) (local.get $sn)))
                              (local.set $bx (!madd (local.get $tx) (local.get $hh) (!madd (local.get $ex) (local.get $q) (local.get $px))))
                              (local.set $bz (!madd (local.get $tz) (local.get $hh) (!madd (local.get $ez) (local.get $q) (local.get $pz))))
                              (local.set $ddx (f32.sub (local.get $px) (local.get $bx)))
                              (local.set $ddz (f32.sub (local.get $pz) (local.get $bz)))
                              (local.set $ddy (f32.sub (f32.add (local.get $py) (local.get $r))
                                                       (f32.add (f32.add (f32.add (local.get $h0)
                                                                                  (f32.mul (f32.sub (f32.load offset=@LV_S_H1 (local.get $a)) (f32.load offset=@LV_S_H0 (local.get $a)))
                                                                                           (f32.div (f32.sub (local.get $sbo) (local.get $s0)) (local.get $len))))
                                                                         (f32.const @LV_BR))
                                                                (local.get $yb))))
                              (if (f32.lt (!dot3 (local.get $ddx) (local.get $ddy) (local.get $ddz) (local.get $ddx) (local.get $ddy) (local.get $ddz)) (f32.mul (local.get $rr) (local.get $rr)))
                                (then
                                  ;; out of it across the floor, as far from its centre as touching takes at this height
                                  (local.set $hn (f32.sqrt (f32.max (f32.sub (f32.mul (local.get $rr) (local.get $rr)) (f32.mul (local.get $ddy) (local.get $ddy))) (f32.const 0))))
                                  (local.set $hh (f32.sqrt (!madd (local.get $ddx) (local.get $ddx) (f32.mul (local.get $ddz) (local.get $ddz)))))
                                  (if (f32.gt (local.get $hh) (f32.const 0.001))
                                    (then (local.set $nx (f32.div (local.get $ddx) (local.get $hh))) (local.set $nz (f32.div (local.get $ddz) (local.get $hh))))
                                    (else (local.set $nx (f32.neg (local.get $tx))) (local.set $nz (f32.neg (local.get $tz)))))
                                  (local.set $px (!madd (local.get $nx) (local.get $hn) (local.get $bx)))
                                  (local.set $pz (!madd (local.get $nz) (local.get $hn) (local.get $bz)))
                                  ;; and off it: its way down the ramp at its speed there (rb out), round to its angle
                                  (local.set $vbs (f32.div (f32.mul (local.get $vbs) (local.get $rb)) (local.get $rm)))
                                  (local.set $q (f32.sub (f32.mul (local.get $tx) (local.get $cs)) (f32.mul (local.get $ex) (local.get $sn))))
                                  (local.set $hh (f32.sub (f32.mul (local.get $tz) (local.get $cs)) (f32.mul (local.get $ez) (local.get $sn))))
                                  (local.set $rel (!madd (!madd (local.get $q) (local.get $vbs) (local.get $vx)) (local.get $nx)
                                                         (f32.mul (!madd (local.get $hh) (local.get $vbs) (local.get $vz)) (local.get $nz))))
                                  (if (f32.lt (local.get $rel) (f32.const @LV_BKICK))
                                    (then
                                      (local.set $dv (f32.sub (f32.max (f32.mul (local.get $rel) (f32.const @(-LV_BE))) (f32.const @LV_BKICK)) (local.get $rel)))
                                      (local.set $vx (!madd (local.get $dv) (local.get $nx) (local.get $vx)))
                                      (local.set $vz (!madd (local.get $dv) (local.get $nz) (local.get $vz)))
                                      (local.set $vy (f32.max (local.get $vy) (f32.const @LV_BPOP)))
                                      (local.set $fl (i32.and (local.get $fl) (i32.const @(255 ^ PF_GROUND))))
                                      (if (f32.ge (local.get $dv) (f32.const 2))
                                        (then (call $fx (local.get $d) (i32.const @LV_FX_HIT) (local.get $p)
                                                        (i32.or (i32.shl (local.get $j) (i32.const 8)) (i32.or (i32.shl (local.get $l) (i32.const 4)) (i32.and (local.get $k) (i32.const 15))))
                                                        (!madd (local.get $nx) (f32.const @LV_BR) (local.get $bx)) (f32.add (local.get $py) (local.get $r))
                                                        (!madd (local.get $nz) (f32.const @LV_BR) (local.get $bz)) (local.get $dv)))))))))))))))))))))
    (else
      ;; on the summit: its height the best there is
      (if (i32.and (f32.lt (local.get $rho) (f32.const @LV_RT)) (i32.ne (i32.and (local.get $fl) (i32.const @PF_GROUND)) (i32.const 0)))
        (then
          (local.set $l (i32.trunc_sat_f32_u (f32.mul (f32.sub (local.get $ht) (f32.const @PLAT_Y)) (f32.const 100))))
          (if (i32.gt_u (local.get $l) (!at i32 @(PLAYERS + PG_M) (local.get $pb))) (then (!put i32 @(PLAYERS + PG_M) (local.get $pb) (local.get $l))))))))

  (!chk (local.get $px) 161 (local.get $p))
  (!chk (local.get $py) 162 (local.get $p))
  (!chk (local.get $pz) 163 (local.get $p))
  (!chk (local.get $vx) 164 (local.get $p))
  (!chk (local.get $vy) 165 (local.get $p))
  (!chk (local.get $vz) 166 (local.get $p))
  (!put f32 @(PLAYERS + P_PX) (local.get $pb) (local.get $px))
  (!put f32 @(PLAYERS + P_PY) (local.get $pb) (local.get $py))
  (!put f32 @(PLAYERS + P_PZ) (local.get $pb) (local.get $pz))
  (!put f32 @(PLAYERS + P_VX) (local.get $pb) (local.get $vx))
  (!put f32 @(PLAYERS + P_VY) (local.get $pb) (local.get $vy))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (local.get $vz))
  (!put u8 @(PLAYERS + P_FL) (local.get $pb) (local.get $fl)))

;; ---- the confirmed world's

;; Home spot k, over the summit: a sunflower spiral round the crown.
(func $lv_park (param $k i32) (result f32 f32)
  (local $rr f32) (local $s f32) (local $c f32)
  (local.set $rr (!madd (f32.sqrt (f32.add (f32.convert_i32_u (local.get $k)) (f32.const 0.5))) (f32.const @LV_PARK_RK) (f32.const @LV_PARK_R0)))
  (call $sincos (i32.mul (local.get $k) (i32.const 6258)))
  (local.set $c) (local.set $s)
  (!madd (local.get $c) (local.get $rr) (f32.load (i32.const @PG_CX)))
  (!madd (local.get $s) (local.get $rr) (f32.load (i32.const @PG_CX))))

;; In slot order, every ball still climbing: its centre under the lava, out
;; (its score the tick it went, credit to whoever knocked it in lately);
;; else on the summit touching the crown, home: out of play, its order (the
;; balls home before this tick, so a tick's share it) and score, parked over
;; the summit. The lava's pace said as each phase starts.
(func $lv_tick
  (local $p i32) (local $pb i32) (local $fl i32) (local $t i32) (local $tick i32) (local $fin0 i32) (local $nfin i32) (local $nburn i32) (local $by i32)
  (local $lava f32) (local $ht f32) (local $cx f32) (local $x f32) (local $y f32) (local $z f32) (local $dx f32) (local $dz f32)
  (local.set $t (call $p_t (i32.const 0)))
  (local.set $tick (i32.load (i32.const @HDR_TICK)))
  (local.set $lava (call $lv_lava (local.get $t)))
  (local.set $ht (f32.add (f32.const @PLAT_Y) (f32.load (i32.const @(PG_H + LV_HT)))))
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (local.set $fin0 (i32.load (i32.const @(PG_H + LV_FIN))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
    (if (i32.eq (i32.and (local.get $fl) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE))
      (then
        (local.set $x (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
        (local.set $y (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
        (local.set $z (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
        (local.set $dx (f32.sub (local.get $x) (local.get $cx)))
        (local.set $dz (f32.sub (local.get $z) (local.get $cx)))
        (if (f32.lt (f32.add (local.get $y) (call $b_rad (local.get $pb))) (local.get $lava))
          (then
            (local.set $by (call $p_credit (local.get $p)))
            (call $fx (i32.const 0) (i32.const @LV_FX_BURN) (local.get $p) (local.get $by) (local.get $x) (local.get $lava) (local.get $z)
                      (f32.mul (f32.convert_i32_u (i32.and (!at i32 @(PLAYERS + PG_M) (local.get $pb)) (i32.const 0xffffff))) (f32.const 0.01)))
            (!put u8 @(PLAYERS + P_FL) (local.get $pb) (i32.or (local.get $fl) (i32.const @PF_DEAD)))
            (!put i32 @(PLAYERS + B_OUTAT) (local.get $pb) (local.get $tick))
            (!put f32 @(PLAYERS + P_VX) (local.get $pb) (f32.const 0))
            (!put f32 @(PLAYERS + P_VY) (local.get $pb) (f32.const 0))
            (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (f32.const 0))
            (!put u16 @(PLAYERS + PG_SCORE) (local.get $pb) (select (local.get $t) (i32.const @(LV_SC_IN - 1)) (i32.lt_u (local.get $t) (i32.const @LV_SC_IN))))
            (!put i32 @(PLAYERS + PG_M) (local.get $pb) (i32.or (i32.const @LV_M_BURN) (local.get $t)))
            (!inc $nburn))
          (else
            (if (i32.and (i32.and (i32.eqz (i32.and (local.get $fl) (i32.const @PF_FALL))) (f32.ge (local.get $y) (f32.sub (local.get $ht) (f32.const 0.5))))
                         (f32.lt (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))) (f32.const @(LV_CROWN_R * LV_CROWN_R))))
              (then
                (call $fx (i32.const 0) (i32.const @LV_FX_CROWN) (local.get $p) (i32.add (local.get $fin0) (i32.const 1)) (local.get $x) (local.get $y) (local.get $z)
                          (f32.mul (f32.convert_i32_u (local.get $t)) (f32.const @DT)))
                (!put u16 @(PLAYERS + PG_SCORE) (local.get $pb) (i32.sub (i32.const @LV_SC_FIN) (local.get $fin0)))
                (!put i32 @(PLAYERS + PG_M) (local.get $pb) (i32.or (i32.const @LV_M_FIN) (i32.add (local.get $fin0) (i32.const 1))))
                (call $lv_park (i32.add (local.get $fin0) (local.get $nfin)))
                (local.set $z) (local.set $x)
                (!chk (local.get $x) 167 (local.get $p))
                (!chk (local.get $z) 168 (local.get $p))
                (call $p_place (local.get $p) (local.get $x) (f32.add (local.get $ht) (f32.const @LV_PARK_Y)) (local.get $z))
                (!put u8 @(PLAYERS + P_FL) (local.get $pb) (i32.const @(PF_LIVE | PF_GROUND | PF_DEAD)))
                (!put i32 @(PLAYERS + B_OUTAT) (local.get $pb) (local.get $tick))
                (!inc $nfin))))))))
  (i32.store (i32.const @(PG_H + LV_FIN)) (i32.add (local.get $fin0) (local.get $nfin)))
  (i32.store (i32.const @(PG_H + LV_BURN)) (i32.add (i32.load (i32.const @(PG_H + LV_BURN))) (local.get $nburn)))
  ;; the lava starts, and picks up its pace every phase: said, with the pace
  (if (i32.and (i32.ge_s (local.get $t) (i32.const @LV_STILL))
               (i32.eqz (i32.rem_u (i32.sub (local.get $t) (i32.const @LV_STILL)) (i32.const @LV_PH))))
    (then
      (local.set $p (i32.div_u (i32.sub (local.get $t) (i32.const @LV_STILL)) (i32.const @LV_PH)))
      (if (i32.lt_u (local.get $p) (i32.const @LV_NPH))
        (then
          (call $fx (i32.const 0) (i32.const @LV_FX_LAVA) (i32.const 255) (local.get $p) (local.get $cx) (local.get $lava) (local.get $cx)
                    (f32.mul (!ld f32 @(PG_S + LV_RATE) (local.get $p)) (f32.const 125))))))))

;; Over when nobody is climbing. On the round's last tick (this, or the
;; clock's), the climbers still in are scored by the best height they stood
;; at: kept out of their records till then, so the prediction's copy of them
;; stays the confirmed one's.
(func $lv_over (result i32)
  (local $p i32) (local $pb i32) (local $end i32) (local $m i32)
  (local.set $end (i32.eqz (i32.load (i32.const @BH_LEFT))))
  (if (i32.or (local.get $end) (i32.ge_u (i32.load (i32.const @HDR_TICK)) (i32.load (i32.const @HDR_UNTIL))))
    (then
      (!for $p (i32.const 0) (i32.const @NPLAYER)
        (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
        (if (i32.eq (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE))
          (then
            (local.set $m (!at i32 @(PLAYERS + PG_M) (local.get $pb)))
            (if (i32.gt_u (local.get $m) (i32.const @(LV_SC_FIN - LV_SC_IN - 1000))) (then (local.set $m (i32.const @(LV_SC_FIN - LV_SC_IN - 1000)))))
            (!put u16 @(PLAYERS + PG_SCORE) (local.get $pb) (i32.add (i32.const @LV_SC_IN) (local.get $m))))))))
  (local.get $end))

(func $lv_out (param $p i32))
