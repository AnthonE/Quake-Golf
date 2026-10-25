;; JUMP ROPE: a long stage over the sea, sized for the crowd along its length,
;; and a rope from a turner's crank at one end to the other's, going round
;; the stage's long axis: overhead on one side, along the floor at ball
;; height on the other, so as it comes round every ball has to hop it at
;; once. A rope that meets a ball not high enough knocks it the way the rope
;; is going and up, often off the stage. It turns faster as the round goes;
;; from 30 s a second rope turns half a turn behind the first (double
;; dutch), from 60 s the turners hold it at a side now and then and turn it
;; back the other way, and from 70 s the stage's ends drop away in steps.
;; Off the stage and you're out; the last ball on wins.
;;
;; The rope's angle is a function of the tick into play and the schedule
;; setup writes into PG_H from the round's seed ($jr_angle), the stage's
;; reach of the tick ($jr_reach): ground and push work them out on their own
;; bank's tick, so the prediction is exact however far ahead it runs. The
;; rope meeting a ball is the ball's own business (push), and balls don't
;; bump here: only a ball going out is the confirmed world's, a round trip late.

;; Ticks 0..n-1 of a speed of s a tick and k more each tick, added up (2^-24
;; turn; i32 arithmetic wraps, and a turn is the low 24 bits).
(func $jr_f (param $s i32) (param $k i32) (param $n i32) (result i32)
  (i32.add (i32.mul (local.get $n) (local.get $s))
           (i32.mul (i32.shr_u (i32.mul (local.get $n) (i32.sub (local.get $n) (i32.const 1))) (i32.const 1)) (local.get $k))))

;; The first rope's angle on tick t into play, on bank d, in 2^-24 turn (0 at
;; the bottom, the second rope half a turn on): the last of the schedule's
;; segments begun by t, its angle then turned on by its law since. Law 1 is
;; the one rope's speed, from the grace's end; law 2 double dutch's, from
;; the tick the second rope joins.
(func $jr_angle (param $d i32) (param $t i32) (result i32)
  (local $k i32) (local $e i32) (local $t0 i32) (local $law i32) (local $o i32) (local $s i32) (local $kk i32)
  (if (i32.lt_s (local.get $t) (i32.const 0)) (then (local.set $t (i32.const 0))))
  (if (i32.gt_s (local.get $t) (i32.const @JR_TMAX)) (then (local.set $t (i32.const @JR_TMAX))))
  (local.set $k (i32.load offset=@(PG_H + JR_NSEG) (local.get $d)))
  (if (i32.eqz (local.get $k)) (then (return (i32.const 0x800000))))
  (local.set $e (i32.add (local.get $d) (i32.shl (local.get $k) (i32.const 3))))
  (loop $back
    (local.set $e (i32.sub (local.get $e) (i32.const 8)))
    (local.set $k (i32.sub (local.get $k) (i32.const 1)))
    (local.set $t0 (i32.load16_u offset=@(PG_H + JR_SEG) (local.get $e)))
    (br_if $back (i32.and (i32.gt_u (local.get $t0) (local.get $t)) (i32.ne (local.get $k) (i32.const 0)))))
  (local.set $law (i32.load8_u offset=@(PG_H + JR_SEG + 2) (local.get $e)))
  (if (i32.eqz (local.get $law)) (then (return (i32.load offset=@(PG_H + JR_SEG + 4) (local.get $e)))))
  (if (i32.eq (local.get $law) (i32.const 1))
    (then (local.set $o (i32.const @JR_GRACE)) (local.set $s (i32.const @JR_S1)) (local.set $kk (i32.const @JR_K1)))
    (else (local.set $o (i32.load offset=@(PG_H + JR_TD) (local.get $d))) (local.set $s (i32.const @JR_S2)) (local.set $kk (i32.const @JR_K2))))
  (i32.add (i32.load offset=@(PG_H + JR_SEG + 4) (local.get $e))
           (i32.mul (i32.load8_s offset=@(PG_H + JR_SEG + 3) (local.get $e))
                    (i32.sub (call $jr_f (local.get $s) (local.get $kk) (i32.sub (local.get $t) (local.get $o)))
                             (call $jr_f (local.get $s) (local.get $kk) (i32.sub (local.get $t0) (local.get $o)))))))

;; How fast the rope goes round into tick t into play, rad/s (+: the bottom towards +z; 0 held).
(func $jr_speed (param $t i32) (result f32)
  (f32.mul (f32.convert_i32_s (i32.sub (call $jr_angle (i32.const 0) (local.get $t)) (call $jr_angle (i32.const 0) (i32.sub (local.get $t) (i32.const 1)))))
           (f32.const @JR_RAD_TICK)))

;; Segment k of the schedule: from tick t0 into play, its law, the way it
;; turns, the first rope's angle then; the schedule is k + 1 long.
(func $jr_seg (param $k i32) (param $t0 i32) (param $law i32) (param $dir i32) (param $a i32)
  (local $e i32)
  (local.set $e (i32.shl (local.get $k) (i32.const 3)))
  (i32.store16 offset=@(PG_H + JR_SEG) (local.get $e) (local.get $t0))
  (i32.store8 offset=@(PG_H + JR_SEG + 2) (local.get $e) (local.get $law))
  (i32.store8 offset=@(PG_H + JR_SEG + 3) (local.get $e) (local.get $dir))
  (i32.store offset=@(PG_H + JR_SEG + 4) (local.get $e) (local.get $a))
  (i32.store (i32.const @(PG_H + JR_NSEG)) (i32.add (local.get $k) (i32.const 1))))

;; Did the first rope pass the bottom (side 0) or a side (side 1) going from
;; angle a to b? As 2^-32 turn the angle's sign flips at the bottom and the
;; top, and a quarter turn on from the angle, at the sides.
(func $jr_passed (param $a i32) (param $b i32) (param $side i32) (result i32)
  (local.set $a (i32.shl (local.get $a) (i32.const 8)))
  (local.set $b (i32.shl (local.get $b) (i32.const 8)))
  (if (result i32) (local.get $side)
    (then (i32.lt_s (i32.xor (i32.add (local.get $a) (i32.const 0x40000000)) (i32.add (local.get $b) (i32.const 0x40000000))) (i32.const 0)))
    (else (i32.and (i32.lt_s (i32.xor (local.get $a) (local.get $b)) (i32.const 0))
                   (i32.lt_u (i32.add (local.get $b) (i32.const 0x40000000)) (i32.const 0x80000000))))))

;; The first tick from t on that the first rope passes the bottom (side 0)
;; or a side (1), on the schedule so far (the confirmed world's).
(func $jr_next (param $t i32) (param $side i32) (result i32)
  (loop $on
    (if (i32.and (i32.lt_u (local.get $t) (i32.const @JR_TMAX))
                 (i32.eqz (call $jr_passed (call $jr_angle (i32.const 0) (i32.sub (local.get $t) (i32.const 1)))
                                           (call $jr_angle (i32.const 0) (local.get $t)) (local.get $side))))
      (then (local.set $t (i32.add (local.get $t) (i32.const 1))) (br $on))))
  (local.get $t))

;; The ends' steps dropped by tick t into play.
(func $jr_drops (param $t i32) (result i32)
  (if (i32.lt_s (local.get $t) (i32.const @JR_TC0)) (then (return (i32.const 0))))
  (select (i32.const @JR_STEPS) (local.tee $t (i32.add (i32.div_u (i32.sub (local.get $t) (i32.const @JR_TC0)) (i32.const @JR_TCI)) (i32.const 1)))
          (i32.gt_u (local.get $t) (i32.const @JR_STEPS))))

;; The stage's reach either way along it once k steps have dropped, on bank d.
(func $jr_reach (param $d i32) (param $k i32) (result f32)
  (local $h f32)
  (local.set $h (f32.load offset=@(PG_H + JR_HL) (local.get $d)))
  (f32.sub (local.get $h) (f32.mul (f32.mul (local.get $h) (f32.const @JR_CUT)) (f32.div (f32.convert_i32_u (local.get $k)) (f32.const @JR_STEPS)))))

;; The stage for the crowd, a strong hop and good brakes, no bumps (the
;; rope is the hazard: a ball it knocks flying across would take its row
;; with it), and the rope's schedule: held overhead through the grace, one
;; rope turning the way the seed says, double dutch from the first time it
;; passes the bottom from JR_T2 (the second rope comes in at the top), and
;; from JR_TR0 the switches, each held where the first rope passes a side.
(func $jr_setup (param $n i32)
  (local $cols i32) (local $hl f32) (local $dir i32) (local $t i32) (local $s i32) (local $k i32) (local $nseg i32) (local $hold i32) (local $a i32)
  (local.set $cols (i32.div_u (i32.add (local.get $n) (i32.const @(JR_ROWS - 1))) (i32.const @JR_ROWS)))
  (if (i32.eqz (local.get $cols)) (then (local.set $cols (i32.const 1))))
  (local.set $hl (f32.max (!madd (f32.convert_i32_u (i32.sub (local.get $cols) (i32.const 1))) (f32.const @(JR_SP / 2)) (f32.const @JR_END))
                          (f32.const @JR_HLMIN)))
  (!chk (local.get $hl) 57 (local.get $n))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_OUT))
  (i32.store (i32.const @PG_LEN) (i32.const @JR_LEN))
  (f32.store (i32.const @PG_SIZE) (local.get $hl))
  (f32.store (i32.const @PG_HOP) (f32.const @JR_HOP))
  (f32.store (i32.const @PG_IDLE) (f32.const @JR_IDLE))
  (f32.store (i32.const @(PG_H + JR_HL)) (local.get $hl))
  (i32.store (i32.const @PG_FLAGS) (i32.const 0))
  (local.set $dir (select (i32.const -1) (i32.const 1) (i32.shr_u (call $p_seed (i32.const @JR_KSEED)) (i32.const 31))))
  (call $jr_seg (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0x800000))
  (call $jr_seg (i32.const 1) (i32.const @JR_GRACE) (i32.const 1) (local.get $dir) (i32.const 0x800000))
  (local.set $t (call $jr_next (i32.const @JR_T2) (i32.const 0)))
  (i32.store (i32.const @(PG_H + JR_TD)) (local.get $t))
  (call $jr_seg (i32.const 2) (local.get $t) (i32.const 2) (local.get $dir) (call $jr_angle (i32.const 0) (local.get $t)))
  (local.set $s (i32.add (i32.const @JR_TR0) (i32.rem_u (call $p_seed (i32.const @(JR_KSEED + 1))) (i32.const @JR_RN0))))
  (local.set $nseg (i32.const 3))
  (block $done
    (!for $k (i32.const 0) (i32.const @JR_NREV)
      (local.set $t (call $jr_next (local.get $s) (i32.const 1)))
      (local.set $hold (i32.add (i32.const @JR_PA) (i32.rem_u (call $p_seed (i32.add (i32.const @(JR_KSEED + 16)) (local.get $k))) (i32.const @JR_PN))))
      (br_if $done (i32.ge_u (i32.add (local.get $t) (local.get $hold)) (i32.const @JR_LEN)))
      (local.set $a (call $jr_angle (i32.const 0) (local.get $t)))
      (local.set $dir (i32.sub (i32.const 0) (local.get $dir)))
      (call $jr_seg (local.get $nseg) (local.get $t) (i32.const 0) (i32.const 0) (local.get $a))
      (call $jr_seg (i32.add (local.get $nseg) (i32.const 1)) (i32.add (local.get $t) (local.get $hold)) (i32.const 2) (local.get $dir) (local.get $a))
      (local.set $nseg (i32.add (local.get $nseg) (i32.const 2)))
      (local.set $s (i32.add (i32.add (local.get $t) (local.get $hold))
                             (i32.add (i32.const @JR_RA) (i32.rem_u (call $p_seed (i32.add (i32.const @(JR_KSEED + 32)) (local.get $k))) (i32.const @JR_RN))))))))

;; Rows of three along the stage, JR_SP apart, the middle line's first.
(func $jr_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $cols i32) (local $row i32) (local $cx f32)
  (local.set $cols (i32.div_u (i32.add (local.get $n) (i32.const @(JR_ROWS - 1))) (i32.const @JR_ROWS)))
  (if (i32.eqz (local.get $cols)) (then (local.set $cols (i32.const 1))))
  (local.set $row (i32.rem_u (local.get $i) (i32.const @JR_ROWS)))
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (!madd (f32.sub (f32.convert_i32_u (i32.div_u (local.get $i) (i32.const @JR_ROWS))) (f32.mul (f32.convert_i32_u (i32.sub (local.get $cols) (i32.const 1))) (f32.const 0.5)))
         (f32.const @JR_SP) (local.get $cx))
  (f32.const @PLAT_Y)
  (f32.add (local.get $cx) (select (f32.const 0) (select (f32.const @(-JR_ROWW)) (f32.const @JR_ROWW) (i32.eq (local.get $row) (i32.const 1)))
                                   (i32.eqz (local.get $row)))))

(func $jr_start)
(func $jr_begin (param $p i32) (param $d i32))

;; The stage's top under (x, z) if it's on what's left of it on bank d's tick.
(func $jr_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (local $cx f32)
  (if (f32.lt (local.get $y) (f32.const @PLAT_Y)) (then (return (f32.const -1000))))
  (local.set $cx (f32.load offset=@PG_CX (local.get $d)))
  (if (result f32) (i32.and (f32.le (f32.abs (f32.sub (local.get $z) (local.get $cx))) (f32.const @JR_HW))
                            (f32.le (f32.abs (f32.sub (local.get $x) (local.get $cx)))
                                    (call $jr_reach (local.get $d) (call $jr_drops (call $p_t (local.get $d))))))
    (then (f32.const @PLAT_Y))
    (else (f32.const -1000))))

;; The ropes on ball p, on bank d, anywhere between the cranks. In the ball's
;; cross-section (z across, y up, from the axle) a rope at angle a is at JR_RR
;; (sin a, -cos a): it touches the ball if, this tick, it swept past the
;; ball's own angle within the ball's radius plus JR_RW of the ball's centre
;; (so a fast rope can't jump a ball between ticks), or is that near it now.
;; Then the ball is put out across the rope's circle (lifted over it from
;; inside, as a ball on the stage is), so the rope goes on past it; a rope
;; that swept through it, or is coming at it, knocks it across the way the
;; rope goes and up, and one going away only takes off what of the ball's
;; velocity goes into it. A rope sweeping past a ball's centre clear of it,
;; with the ball near the rope's circle, is a jump.
(func $jr_push (param $p i32) (param $d i32)
  (local $pb i32) (local $fl i32) (local $t i32) (local $an i32) (local $ap i32) (local $spin i32) (local $k i32) (local $off i32)
  (local $hits i32) (local $jumps i32) (local $arc i32) (local $knock i32) (local $side f32)
  (local $px f32) (local $py f32) (local $pz f32) (local $vy f32) (local $vz f32) (local $r f32) (local $reach f32) (local $cx f32)
  (local $wz f32) (local $wy f32) (local $wl f32) (local $sp f32) (local $cp f32) (local $sn f32) (local $cn f32) (local $crp f32) (local $crn f32)
  (local $dist f32) (local $nz f32) (local $ny f32) (local $tz f32) (local $ty f32) (local $rz f32) (local $ry f32) (local $u f32) (local $vn f32) (local $want f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
  (if (i32.and (local.get $fl) (i32.const @(PF_FALL | PF_DEAD))) (then (return)))
  (local.set $cx (f32.load offset=@PG_CX (local.get $d)))
  (local.set $px (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (if (f32.gt (f32.abs (f32.sub (local.get $px) (local.get $cx))) (f32.add (f32.load offset=@(PG_H + JR_HL) (local.get $d)) (f32.const @JR_XT)))
    (then (return)))
  (local.set $t (call $p_t (local.get $d)))
  (local.set $py (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
  (local.set $pz (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (local.set $vy (!at f32 @(PLAYERS + P_VY) (local.get $pb)))
  (local.set $vz (!at f32 @(PLAYERS + P_VZ) (local.get $pb)))
  (local.set $r (call $b_rad (local.get $pb)))
  (local.set $reach (f32.add (local.get $r) (f32.const @JR_RW)))
  (local.set $wz (f32.sub (local.get $pz) (local.get $cx)))
  (local.set $wy (f32.sub (f32.add (local.get $py) (local.get $r)) (f32.const @(+PLAT_Y + JR_AY))))
  (local.set $wl (f32.sqrt (!madd (local.get $wz) (local.get $wz) (f32.mul (local.get $wy) (local.get $wy)))))
  (if (f32.lt (local.get $wl) (f32.const 0.001)) (then (return)))
  (local.set $an (call $jr_angle (local.get $d) (local.get $t)))
  (local.set $ap (call $jr_angle (local.get $d) (i32.sub (local.get $t) (i32.const 1))))
  (local.set $spin (i32.sub (local.get $an) (local.get $ap)))
  ;; the rope's speed round, m/s (+: the bottom towards +z)
  (local.set $u (f32.mul (f32.mul (f32.convert_i32_s (local.get $spin)) (f32.const @JR_RAD_TICK)) (f32.const @JR_RR)))
  (block $ropes
    (!for $k (i32.const 0) (select (i32.const 2) (i32.const 1) (i32.ge_u (local.get $t) (i32.load offset=@(PG_H + JR_TD) (local.get $d))))
      (local.set $off (i32.shl (local.get $k) (i32.const 23)))
      (call $sincos (i32.shr_u (i32.add (local.get $ap) (local.get $off)) (i32.const 10)))
      (local.set $cp) (local.set $sp)
      (call $sincos (i32.shr_u (i32.add (local.get $an) (local.get $off)) (i32.const 10)))
      (local.set $cn) (local.set $sn)
      ;; wz cos a + wy sin a is the ball's centre's lead on the rope at a, times its distance from the axle
      (local.set $crp (!madd (local.get $wz) (local.get $cp) (f32.mul (local.get $wy) (local.get $sp))))
      (local.set $crn (!madd (local.get $wz) (local.get $cn) (f32.mul (local.get $wy) (local.get $sn))))
      ;; swept past its angle this tick: ahead of the rope a tick ago (on the same side of the axle), not now
      (local.set $arc (i32.and (i32.and (i32.ne (local.get $spin) (i32.const 0))
                                        (f32.gt (f32.sub (f32.mul (local.get $wz) (local.get $sp)) (f32.mul (local.get $wy) (local.get $cp))) (f32.const 0)))
                               (select (i32.and (f32.ge (local.get $crp) (f32.const 0)) (f32.le (local.get $crn) (f32.const 0)))
                                       (i32.and (f32.le (local.get $crp) (f32.const 0)) (f32.ge (local.get $crn) (f32.const 0)))
                                       (i32.gt_s (local.get $spin) (i32.const 0)))))
      (if (local.get $arc)
        (then
          ;; the rope where it crossed the ball's angle: as far from the ball as the circle is; along it (cos, sin) of that angle
          (local.set $tz (f32.neg (f32.div (local.get $wy) (local.get $wl))))
          (local.set $ty (f32.div (local.get $wz) (local.get $wl)))
          (local.set $nz (f32.const 0))
          (local.set $ny (f32.const 0))
          (local.set $dist (f32.abs (f32.sub (local.get $wl) (f32.const @JR_RR)))))
        (else
          ;; the rope where it is now
          (local.set $rz (f32.mul (local.get $sn) (f32.const @JR_RR)))
          (local.set $ry (f32.mul (f32.neg (local.get $cn)) (f32.const @JR_RR)))
          (local.set $tz (local.get $cn))
          (local.set $ty (local.get $sn))
          (local.set $nz (f32.sub (local.get $wz) (local.get $rz)))
          (local.set $ny (f32.sub (local.get $wy) (local.get $ry)))
          (local.set $dist (f32.sqrt (!madd (local.get $nz) (local.get $nz) (f32.mul (local.get $ny) (local.get $ny)))))
          (if (f32.gt (local.get $dist) (f32.const 0.0001))
            (then (local.set $nz (f32.div (local.get $nz) (local.get $dist))) (local.set $ny (f32.div (local.get $ny) (local.get $dist))))
            (else (local.set $nz (f32.const 0)) (local.set $ny (f32.const 1))))))
      (if (f32.lt (local.get $dist) (local.get $reach))
        (then
          ;; swept through it, or coming at it (the rope's way along it there towards the ball): a knock
          (local.set $knock (i32.or (local.get $arc)
                                    (f32.gt (f32.mul (local.get $u) (!madd (local.get $tz) (local.get $nz) (f32.mul (local.get $ty) (local.get $ny)))) (f32.const 0))))
          ;; out across the rope's circle, so the rope goes on past it: lifted over it from inside, put under it from outside;
          ;; the floor holds a ball put down into it
          (local.set $side (select (f32.const -1) (f32.const 1) (f32.lt (local.get $wl) (f32.const @JR_RR))))
          (local.set $nz (f32.div (local.get $wz) (local.get $wl)))
          (local.set $ny (f32.div (local.get $wy) (local.get $wl)))
          (local.set $want (!madd (local.get $side) (f32.add (local.get $reach) (f32.const 0.01)) (f32.const @JR_RR)))
          (local.set $pz (!madd (local.get $nz) (local.get $want) (local.get $cx)))
          (local.set $py (f32.sub (!madd (local.get $ny) (local.get $want) (f32.const @(+PLAT_Y + JR_AY))) (local.get $r)))
          (if (f32.lt (local.get $py) (f32.const @PLAT_Y))
            (then
              (if (f32.ge (call $jr_ground (local.get $d) (local.get $px) (f32.const @PLAT_Y) (local.get $pz)) (f32.const @PLAT_Y))
                (then (local.set $py (f32.const @PLAT_Y))))))
          (local.set $fl (i32.and (local.get $fl) (i32.const @(255 ^ PF_GROUND))))
          (if (local.get $knock)
            (then
              ;; across the way the rope goes there, and up
              (local.set $want (f32.min (!madd (f32.abs (local.get $u)) (f32.const @JR_KZK) (f32.const @JR_KZ0)) (f32.const @JR_KZMAX)))
              (local.set $vz (select (f32.max (local.get $vz) (local.get $want)) (f32.min (local.get $vz) (f32.neg (local.get $want)))
                                     (f32.ge (f32.mul (local.get $u) (local.get $tz)) (f32.const 0))))
              (local.set $vy (f32.max (local.get $vy) (f32.const @JR_UP)))
              (!inc $hits)
              (call $fx (local.get $d) (i32.const @JR_FX_HIT) (local.get $p) (local.get $k) (local.get $px) (local.get $py) (local.get $pz) (local.get $want)))
            (else
              ;; a rope going away: only what of the ball's own velocity goes into its circle taken away
              (local.set $vn (!madd (local.get $vz) (local.get $nz) (f32.mul (local.get $vy) (local.get $ny))))
              (if (f32.lt (f32.mul (local.get $vn) (local.get $side)) (f32.const 0))
                (then
                  (local.set $vz (f32.sub (local.get $vz) (f32.mul (local.get $vn) (local.get $nz))))
                  (local.set $vy (f32.sub (local.get $vy) (f32.mul (local.get $vn) (local.get $ny))))))))
          (br $ropes)))
      (if (i32.and (local.get $arc) (f32.gt (local.get $wl) (f32.const @(JR_RR - JR_JBAND))))
        (then (!inc $jumps)))))
  (!chk (local.get $py) 52 (local.get $p))
  (!chk (local.get $pz) 53 (local.get $p))
  (!chk (local.get $vy) 55 (local.get $p))
  (!chk (local.get $vz) 56 (local.get $p))
  (!put f32 @(PLAYERS + P_PY) (local.get $pb) (local.get $py))
  (!put f32 @(PLAYERS + P_PZ) (local.get $pb) (local.get $pz))
  (!put f32 @(PLAYERS + P_VY) (local.get $pb) (local.get $vy))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (local.get $vz))
  (!put u8 @(PLAYERS + P_FL) (local.get $pb) (local.get $fl))
  (if (i32.or (local.get $hits) (local.get $jumps))
    (then (!put i32 @(PLAYERS + PG_M) (local.get $pb)
            (i32.add (!at i32 @(PLAYERS + PG_M) (local.get $pb)) (i32.add (local.get $jumps) (i32.shl (local.get $hits) (i32.const 16))))))))

;; The schedule's moments as FX, at the centre: the rope setting off, the
;; second rope and each switch called ahead and setting off, a step of the
;; ends shaking and going.
(func $jr_tick
  (local $t i32) (local $k i32) (local $n i32) (local $tk i32) (local $cx f32)
  (local.set $t (call $p_t (i32.const 0)))
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (if (i32.eq (local.get $t) (i32.const @JR_GRACE))
    (then (call $fx (i32.const 0) (i32.const @JR_FX_GO) (i32.const 255) (i32.const 0) (local.get $cx) (f32.const @PLAT_Y) (local.get $cx)
                    (call $jr_speed (i32.add (local.get $t) (i32.const 1))))))
  (local.set $tk (i32.load (i32.const @(PG_H + JR_TD))))
  (if (i32.eq (local.get $t) (i32.sub (local.get $tk) (i32.const @JR_WARN)))
    (then (call $fx (i32.const 0) (i32.const @JR_FX_CALL) (i32.const 255) (i32.const 1) (local.get $cx) (f32.const @PLAT_Y) (local.get $cx) (f32.const @JR_WARN))))
  (if (i32.eq (local.get $t) (local.get $tk))
    (then (call $fx (i32.const 0) (i32.const @JR_FX_GO) (i32.const 255) (i32.const 1) (local.get $cx) (f32.const @PLAT_Y) (local.get $cx)
                    (call $jr_speed (i32.add (local.get $t) (i32.const 1))))))
  ;; the switches: segment k holds, k + 1 sets off the other way
  (local.set $n (i32.load (i32.const @(PG_H + JR_NSEG))))
  (local.set $k (i32.const 3))
  (block $sw
    (loop $next
      (br_if $sw (i32.ge_u (i32.add (local.get $k) (i32.const 1)) (local.get $n)))
      (local.set $tk (i32.load16_u (i32.add (i32.const @(PG_H + JR_SEG)) (i32.shl (local.get $k) (i32.const 3)))))
      (if (i32.eq (local.get $t) (i32.sub (local.get $tk) (i32.const @JR_WARN)))
        (then (call $fx (i32.const 0) (i32.const @JR_FX_CALL) (i32.const 255) (i32.const 2) (local.get $cx) (f32.const @PLAT_Y) (local.get $cx) (f32.const @JR_WARN))))
      (local.set $tk (i32.load16_u (i32.add (i32.const @(PG_H + JR_SEG)) (i32.shl (i32.add (local.get $k) (i32.const 1)) (i32.const 3)))))
      (if (i32.eq (local.get $t) (local.get $tk))
        (then (call $fx (i32.const 0) (i32.const @JR_FX_GO) (i32.const 255) (i32.const 2) (local.get $cx) (f32.const @PLAT_Y) (local.get $cx)
                        (call $jr_speed (i32.add (local.get $t) (i32.const 1))))))
      (local.set $k (i32.add (local.get $k) (i32.const 2)))
      (br $next)))
  (!for $k (i32.const 0) (i32.const @JR_STEPS)
    (local.set $tk (i32.add (i32.const @JR_TC0) (i32.mul (local.get $k) (i32.const @JR_TCI))))
    (if (i32.or (i32.eq (local.get $t) (local.get $tk)) (i32.eq (local.get $t) (i32.sub (local.get $tk) (i32.const @JR_CWARN))))
      (then (call $fx (i32.const 0) (i32.const @JR_FX_END) (i32.const 255) (i32.eq (local.get $t) (local.get $tk)) (local.get $cx) (f32.const @PLAT_Y) (local.get $cx)
                      (call $jr_reach (i32.const 0) (i32.add (local.get $k) (i32.const 1))))))))

;; Two or more still on, every one of them falling, and all since the same
;; tick (knocked off together): over now, and they share the win rather than
;; all sharing last. One that went off before the rest goes out first, in its
;; place. Each ball's first tick falling is noted here (JR_FELL).
(func $jr_over (result i32)
  (local $p i32) (local $fl i32) (local $t i32) (local $at i32)
  (local.set $t (i32.add (call $p_t (i32.const 0)) (i32.const 1)))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $fl (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $p) (i32.const 6))) (i32.const @(PF_LIVE | PF_DEAD | PF_FALL))))
    (if (i32.and (i32.eq (local.get $fl) (i32.const @(PF_LIVE | PF_FALL))) (i32.eqz (!ld u16 @(PG_S + JR_FELL) (local.get $p))))
      (then (!st u16 @(PG_S + JR_FELL) (local.get $p) (local.get $t)))))
  (if (i32.lt_u (i32.load (i32.const @BH_LEFT)) (i32.const 2)) (then (return (i32.const 0))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $fl (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $p) (i32.const 6))) (i32.const @(PF_LIVE | PF_DEAD | PF_FALL))))
    (if (i32.eq (local.get $fl) (i32.const @PF_LIVE)) (then (return (i32.const 0))))
    (if (i32.eq (local.get $fl) (i32.const @(PF_LIVE | PF_FALL)))
      (then
        (if (i32.eqz (local.get $at)) (then (local.set $at (!ld u16 @(PG_S + JR_FELL) (local.get $p)))))
        (if (i32.ne (!ld u16 @(PG_S + JR_FELL) (local.get $p)) (local.get $at)) (then (return (i32.const 0)))))))
  (i32.const 1))

(func $jr_out (param $p i32))
