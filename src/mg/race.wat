;; DOWNHILL: a course winding down from high over the sea to a finish far
;; below, laid out from the round's seed: the start grid, a drop, then six
;; bends each into a section (a jump over a gap, a funnel, a bumper field,
;; spinning bars, sliding sweepers, a last drop), the finish line and a pen
;; walled all round. Power-up boxes halfway down the first drop and early in
;; the last hand out bumper's power-ups ($b_use; rockets fly in tick_begin). The
;; track pulls a ball downhill; off its edge and RC_DEEP under where it had
;; got to, a ball is down (PK_SCORE), back at its last checkpoint RC_BACK
;; ticks later. The first ball home cuts the clock to RC_LATE; home or not,
;; everyone is placed by PG_SCORE: RC_WIN plus the ticks it had left for a
;; ball home, else the metres it got down the course.
;;
;; The course is pieces (straights and arcs, the centre line's height and the
;; half-width running linearly over each) and hazards on the straights, in
;; PG_S, laid out in setup and fixed for the round. ground and push read them
;; and the clock ($p_t on their own bank: a spinner's angle, a sweeper's
;; place), so the prediction is exact. What a ball has made of the course is
;; its own: push keeps its best place in PG_M (cm down the course) and its
;; score in PG_SCORE on either bank. Downs, comebacks and who came home in
;; what place are the confirmed world's (tick).

;; Piece k's record.
(func $rc_pa (param $k i32) (result i32)
  (i32.add (i32.const @(PG_S + RC_PIECES)) (i32.mul (local.get $k) (i32.const @RC_PSIZE))))
;; Hazard j's record.
(func $rc_ha (param $j i32) (result i32)
  (i32.add (i32.const @(PG_S + RC_HAZ)) (i32.mul (local.get $j) (i32.const @RC_HSIZE))))

;; The piece over (x, z): its index (-1 none), how far along it (0 to 1), the
;; offset across from its middle line (+ to the left of the way down), the
;; middle line's height there, the unit way down (tx, tz) and the slope that
;; way (rise a metre). A point counts within RC_MARGIN past the edge.
(func $rc_at (param $x f32) (param $z f32) (result i32 f32 f32 f32 f32 f32 f32)
  (local $k i32) (local $n i32) (local $a i32) (local $px f32) (local $pz f32) (local $f f32) (local $u f32) (local $c f32)
  (local $rho f32) (local $turn f32) (local $tx f32) (local $tz f32) (local $sl f32) (local $dh f32) (local $sh f32)
  (local.set $n (i32.load (i32.const @(PG_H + RC_NPIECE))))
  (!for $k (i32.const 0) (local.get $n)
    (local.set $a (call $rc_pa (local.get $k)))
    (local.set $px (f32.sub (local.get $x) (f32.load offset=@RC_P_BX (local.get $a))))
    (local.set $pz (f32.sub (local.get $z) (f32.load offset=@RC_P_BZ (local.get $a))))
    (if (f32.le (!madd (local.get $px) (local.get $px) (f32.mul (local.get $pz) (local.get $pz))) (f32.load offset=@RC_P_BR2 (local.get $a)))
      (then
        (local.set $px (f32.sub (local.get $x) (f32.load offset=@RC_P_X (local.get $a))))
        (local.set $pz (f32.sub (local.get $z) (f32.load offset=@RC_P_Z (local.get $a))))
        (local.set $dh (f32.sub (f32.load offset=@RC_P_H1 (local.get $a)) (f32.load offset=@RC_P_H0 (local.get $a))))
        (local.set $f (f32.const -1))
        (if (i32.eqz (i32.load offset=@RC_P_KIND (local.get $a)))
          (then
            ;; a straight: along and across its way
            (local.set $tx (f32.load offset=@RC_P_DX (local.get $a)))
            (local.set $tz (f32.load offset=@RC_P_DZ (local.get $a)))
            (local.set $f (f32.div (!madd (local.get $tx) (local.get $px) (f32.mul (local.get $tz) (local.get $pz))) (f32.load offset=@RC_P_LEN (local.get $a))))
            (local.set $u (f32.sub (f32.mul (local.get $tx) (local.get $pz)) (f32.mul (local.get $tz) (local.get $px))))
            (local.set $sl (f32.div (local.get $dh) (f32.load offset=@RC_P_LEN (local.get $a)))))
          (else
            ;; an arc: on the near side of its centre, the sine of the angle from its middle ray against
            ;; that of half its sweep says how far along (0 to 1, smooth and monotone); across is the radius
            (local.set $c (!madd (f32.load offset=@RC_P_DX (local.get $a)) (local.get $px) (f32.mul (f32.load offset=@RC_P_DZ (local.get $a)) (local.get $pz))))
            (if (f32.gt (local.get $c) (f32.const 0))
              (then
                (local.set $rho (f32.sqrt (!madd (local.get $px) (local.get $px) (f32.mul (local.get $pz) (local.get $pz)))))
                (local.set $turn (f32.load offset=@RC_P_TURN (local.get $a)))
                (local.set $sh (f32.load offset=@RC_P_SH (local.get $a)))
                (local.set $f (!madd (f32.mul (f32.const 0.5) (local.get $turn))
                                     (f32.div (f32.sub (f32.mul (f32.load offset=@RC_P_DX (local.get $a)) (local.get $pz))
                                                       (f32.mul (f32.load offset=@RC_P_DZ (local.get $a)) (local.get $px)))
                                              (f32.mul (local.get $rho) (local.get $sh)))
                                     (f32.const 0.5)))
                (local.set $u (f32.mul (local.get $turn) (f32.sub (f32.load offset=@RC_P_R (local.get $a)) (local.get $rho))))
                (local.set $tx (f32.div (f32.mul (local.get $turn) (f32.neg (local.get $pz))) (local.get $rho)))
                (local.set $tz (f32.div (f32.mul (local.get $turn) (local.get $px)) (local.get $rho)))
                (local.set $sl (f32.div (f32.mul (f32.mul (local.get $dh) (f32.const 0.5)) (f32.div (local.get $c) (local.get $rho)))
                                        (f32.mul (local.get $sh) (local.get $rho))))))))
        (if (i32.and (f32.ge (local.get $f) (f32.const 0)) (f32.lt (local.get $f) (f32.const 1)))
          (then
            (if (f32.le (f32.abs (local.get $u))
                        (f32.add (!madd (f32.sub (f32.load offset=@RC_P_W1 (local.get $a)) (f32.load offset=@RC_P_W0 (local.get $a))) (local.get $f)
                                        (f32.load offset=@RC_P_W0 (local.get $a)))
                                 (f32.const @RC_MARGIN)))
              (then
                (return (local.get $k) (local.get $f) (local.get $u)
                        (!madd (local.get $dh) (local.get $f) (f32.load offset=@RC_P_H0 (local.get $a)))
                        (local.get $tx) (local.get $tz) (local.get $sl)))))))))
  (i32.const -1) (f32.const 0) (f32.const 0) (f32.const 0) (f32.const 1) (f32.const 0) (f32.const 0))

;; Piece a's half-width f of the way along it.
(func $rc_w (param $a i32) (param $f f32) (result f32)
  (!madd (f32.sub (f32.load offset=@RC_P_W1 (local.get $a)) (f32.load offset=@RC_P_W0 (local.get $a))) (local.get $f) (f32.load offset=@RC_P_W0 (local.get $a))))

;; The middle line's height s metres down the course (the last piece's end past it).
(func $rc_height (param $s f32) (result f32)
  (local $k i32) (local $n i32) (local $a i32) (local $s0 f32) (local $len f32)
  (local.set $n (i32.load (i32.const @(PG_H + RC_NPIECE))))
  (if (i32.eqz (local.get $n)) (then (return (f32.const @RC_TOP))))
  (!for $k (i32.const 0) (local.get $n)
    (local.set $a (call $rc_pa (local.get $k)))
    (local.set $s0 (f32.load offset=@RC_P_S0 (local.get $a)))
    (local.set $len (f32.load offset=@RC_P_LEN (local.get $a)))
    (if (f32.lt (local.get $s) (f32.add (local.get $s0) (local.get $len)))
      (then
        (return (!madd (f32.sub (f32.load offset=@RC_P_H1 (local.get $a)) (f32.load offset=@RC_P_H0 (local.get $a)))
                       (f32.div (f32.max (f32.sub (local.get $s) (local.get $s0)) (f32.const 0)) (local.get $len))
                       (f32.load offset=@RC_P_H0 (local.get $a)))))))
  (f32.load offset=@RC_P_H1 (call $rc_pa (i32.sub (local.get $n) (i32.const 1)))))

;; ---- laying the course out (setup), a cursor at PG_S + RC_CUR: x, z, the
;; heading (i32, 1/16384 turn, signed), metres down, height

(func $rc_cur_x (result f32) (f32.load (i32.const @(PG_S + RC_CUR))))
(func $rc_cur_z (result f32) (f32.load (i32.const @(PG_S + RC_CUR + 4))))
(func $rc_cur_yaw (result i32) (i32.load (i32.const @(PG_S + RC_CUR + 8))))
(func $rc_cur_s (result f32) (f32.load (i32.const @(PG_S + RC_CUR + 12))))
(func $rc_cur_h (result f32) (f32.load (i32.const @(PG_S + RC_CUR + 16))))

;; A piece's common fields, from the cursor; its index.
(func $rc_piece (param $kind i32) (param $len f32) (param $dh f32) (param $w0 f32) (param $w1 f32) (param $fl i32) (param $sec i32) (result i32)
  (local $k i32) (local $a i32)
  (local.set $k (i32.load (i32.const @(PG_H + RC_NPIECE))))
  (local.set $a (call $rc_pa (local.get $k)))
  (i32.store offset=@RC_P_KIND (local.get $a) (local.get $kind))
  (i32.store offset=@RC_P_FL (local.get $a) (local.get $fl))
  (f32.store offset=@RC_P_S0 (local.get $a) (call $rc_cur_s))
  (f32.store offset=@RC_P_LEN (local.get $a) (local.get $len))
  (f32.store offset=@RC_P_H0 (local.get $a) (call $rc_cur_h))
  (f32.store offset=@RC_P_H1 (local.get $a) (f32.add (call $rc_cur_h) (local.get $dh)))
  (f32.store offset=@RC_P_W0 (local.get $a) (local.get $w0))
  (f32.store offset=@RC_P_W1 (local.get $a) (local.get $w1))
  (i32.store offset=@RC_P_HZ0 (local.get $a) (i32.load (i32.const @(PG_H + RC_NHAZ))))
  (i32.store offset=@RC_P_YAW (local.get $a) (call $rc_cur_yaw))
  (i32.store offset=@RC_P_SEC (local.get $a) (local.get $sec))
  (i32.store (i32.const @(PG_H + RC_NPIECE)) (i32.add (local.get $k) (i32.const 1)))
  (f32.store (i32.const @(PG_S + RC_CUR + 12)) (f32.add (call $rc_cur_s) (local.get $len)))
  (f32.store (i32.const @(PG_S + RC_CUR + 16)) (f32.add (call $rc_cur_h) (local.get $dh)))
  (local.get $k))

;; A straight of len from the cursor, falling dh, its half-width w0 to w1; the
;; cursor to its end.
(func $rc_straight (param $len f32) (param $dh f32) (param $w0 f32) (param $w1 f32) (param $fl i32) (param $sec i32) (result i32)
  (local $k i32) (local $a i32) (local $s f32) (local $c f32) (local $x f32) (local $z f32) (local $half f32) (local $wm f32)
  (call $sincos (call $rc_cur_yaw))
  (local.set $c) (local.set $s)
  (local.set $x (call $rc_cur_x))
  (local.set $z (call $rc_cur_z))
  (local.set $k (call $rc_piece (i32.const @RC_STRAIGHT) (local.get $len) (local.get $dh) (local.get $w0) (local.get $w1) (local.get $fl) (local.get $sec)))
  (local.set $a (call $rc_pa (local.get $k)))
  (f32.store offset=@RC_P_X (local.get $a) (local.get $x))
  (f32.store offset=@RC_P_Z (local.get $a) (local.get $z))
  (f32.store offset=@RC_P_DX (local.get $a) (local.get $c))
  (f32.store offset=@RC_P_DZ (local.get $a) (local.get $s))
  (local.set $half (f32.mul (local.get $len) (f32.const 0.5)))
  (local.set $wm (f32.add (f32.max (local.get $w0) (local.get $w1)) (f32.const @(RC_MARGIN + 1))))
  (f32.store offset=@RC_P_BX (local.get $a) (!madd (local.get $c) (local.get $half) (local.get $x)))
  (f32.store offset=@RC_P_BZ (local.get $a) (!madd (local.get $s) (local.get $half) (local.get $z)))
  (f32.store offset=@RC_P_BR2 (local.get $a) (!madd (local.get $half) (local.get $half) (f32.mul (local.get $wm) (local.get $wm))))
  (f32.store (i32.const @(PG_S + RC_CUR)) (!madd (local.get $c) (local.get $len) (local.get $x)))
  (f32.store (i32.const @(PG_S + RC_CUR + 4)) (!madd (local.get $s) (local.get $len) (local.get $z)))
  (local.get $k))

;; An arc of radius r from the cursor, turning sweep (1/16384 turn, even) the
;; way turn says (+1: the heading grows), falling dh, half-width w; the cursor
;; to its end, heading on.
(func $rc_arc (param $r f32) (param $sweep i32) (param $turn i32) (param $dh f32) (param $w f32) (param $fl i32) (param $sec i32) (result i32)
  (local $k i32) (local $a i32) (local $yaw i32) (local $phi i32) (local $s f32) (local $c f32) (local $tf f32) (local $ox f32) (local $oz f32)
  (local $sh f32) (local $ch f32) (local $wm f32) (local $ro f32) (local $ri f32) (local $d2 f32) (local $len f32)
  (local.set $yaw (call $rc_cur_yaw))
  (local.set $tf (f32.convert_i32_s (local.get $turn)))
  (call $sincos (local.get $yaw))
  (local.set $c) (local.set $s)
  ;; the centre: a quarter turn from the heading, the way it turns
  (local.set $ox (f32.sub (call $rc_cur_x) (f32.mul (f32.mul (local.get $tf) (local.get $r)) (local.get $s))))
  (local.set $oz (!madd (f32.mul (local.get $tf) (local.get $r)) (local.get $c) (call $rc_cur_z)))
  (local.set $len (f32.mul (local.get $r) (f32.mul (f32.convert_i32_u (local.get $sweep)) (f32.const 0.00038349519697141))))
  (local.set $k (call $rc_piece (i32.const @RC_ARC) (local.get $len) (local.get $dh) (local.get $w) (local.get $w) (local.get $fl) (local.get $sec)))
  (local.set $a (call $rc_pa (local.get $k)))
  ;; the start ray's angle, then the middle's
  (local.set $phi (i32.sub (local.get $yaw) (i32.mul (local.get $turn) (i32.const 4096))))
  (call $sincos (i32.add (local.get $phi) (i32.mul (local.get $turn) (i32.shr_u (local.get $sweep) (i32.const 1)))))
  (local.set $c) (local.set $s)
  (f32.store offset=@RC_P_X (local.get $a) (local.get $ox))
  (f32.store offset=@RC_P_Z (local.get $a) (local.get $oz))
  (f32.store offset=@RC_P_DX (local.get $a) (local.get $c))
  (f32.store offset=@RC_P_DZ (local.get $a) (local.get $s))
  (f32.store offset=@RC_P_R (local.get $a) (local.get $r))
  (f32.store offset=@RC_P_TURN (local.get $a) (local.get $tf))
  (i32.store offset=@RC_P_SWEEP (local.get $a) (local.get $sweep))
  (call $sincos (i32.shr_u (local.get $sweep) (i32.const 1)))
  (local.set $ch) (local.set $sh)
  (f32.store offset=@RC_P_SH (local.get $a) (local.get $sh))
  ;; the circle round it: centred on the middle of its arc, out to the farthest of its corners
  (f32.store offset=@RC_P_BX (local.get $a) (!madd (local.get $c) (local.get $r) (local.get $ox)))
  (f32.store offset=@RC_P_BZ (local.get $a) (!madd (local.get $s) (local.get $r) (local.get $oz)))
  (local.set $wm (f32.add (local.get $w) (f32.const @RC_MARGIN)))
  (local.set $ro (f32.add (local.get $r) (local.get $wm)))
  (local.set $ri (f32.max (f32.sub (local.get $r) (local.get $wm)) (f32.const 0)))
  (local.set $d2 (f32.sub (!madd (local.get $ro) (local.get $ro) (f32.mul (local.get $r) (local.get $r)))
                          (f32.mul (f32.mul (f32.mul (f32.const 2) (local.get $r)) (local.get $ro)) (local.get $ch))))
  (local.set $d2 (f32.max (local.get $d2)
                          (f32.sub (!madd (local.get $ri) (local.get $ri) (f32.mul (local.get $r) (local.get $r)))
                                   (f32.mul (f32.mul (f32.mul (f32.const 2) (local.get $r)) (local.get $ri)) (local.get $ch)))))
  (local.set $d2 (f32.add (f32.sqrt (f32.max (local.get $d2) (f32.mul (local.get $wm) (local.get $wm)))) (f32.const 1)))
  (f32.store offset=@RC_P_BR2 (local.get $a) (f32.mul (local.get $d2) (local.get $d2)))
  ;; the end
  (call $sincos (i32.add (local.get $phi) (i32.mul (local.get $turn) (local.get $sweep))))
  (local.set $c) (local.set $s)
  (f32.store (i32.const @(PG_S + RC_CUR)) (!madd (local.get $c) (local.get $r) (local.get $ox)))
  (f32.store (i32.const @(PG_S + RC_CUR + 4)) (!madd (local.get $s) (local.get $r) (local.get $oz)))
  (i32.store (i32.const @(PG_S + RC_CUR + 8)) (i32.add (local.get $yaw) (i32.mul (local.get $turn) (local.get $sweep))))
  (local.get $k))

;; A hazard on straight k, along metres in and u across (+ left): its spot and
;; the track's height there; counted on the piece. None past RC_NH.
(func $rc_haz (param $k i32) (param $kind i32) (param $along f32) (param $u f32) (param $l f32) (param $spd i32) (param $ph i32) (param $amp f32)
  (local $j i32) (local $a i32) (local $h i32) (local $dx f32) (local $dz f32)
  (local.set $j (i32.load (i32.const @(PG_H + RC_NHAZ))))
  (if (i32.ge_u (local.get $j) (i32.const @RC_NH)) (then (return)))
  (local.set $a (call $rc_pa (local.get $k)))
  (local.set $h (call $rc_ha (local.get $j)))
  (local.set $dx (f32.load offset=@RC_P_DX (local.get $a)))
  (local.set $dz (f32.load offset=@RC_P_DZ (local.get $a)))
  (i32.store offset=@RC_H_KIND (local.get $h) (local.get $kind))
  (f32.store offset=@RC_H_X (local.get $h)
    (f32.sub (!madd (local.get $dx) (local.get $along) (f32.load offset=@RC_P_X (local.get $a))) (f32.mul (local.get $dz) (local.get $u))))
  (f32.store offset=@RC_H_Z (local.get $h)
    (!madd (local.get $dx) (local.get $u) (!madd (local.get $dz) (local.get $along) (f32.load offset=@RC_P_Z (local.get $a)))))
  (f32.store offset=@RC_H_Y (local.get $h)
    (!madd (f32.sub (f32.load offset=@RC_P_H1 (local.get $a)) (f32.load offset=@RC_P_H0 (local.get $a)))
           (f32.div (local.get $along) (f32.load offset=@RC_P_LEN (local.get $a))) (f32.load offset=@RC_P_H0 (local.get $a))))
  (f32.store offset=@RC_H_L (local.get $h) (local.get $l))
  (i32.store offset=@RC_H_SPD (local.get $h) (local.get $spd))
  (i32.store offset=@RC_H_PH (local.get $h) (local.get $ph))
  (f32.store offset=@RC_H_A (local.get $h) (local.get $amp))
  (i32.store offset=@RC_P_HZN (local.get $a) (i32.add (i32.load offset=@RC_P_HZN (local.get $a)) (i32.const 1)))
  (i32.store (i32.const @(PG_H + RC_NHAZ)) (i32.add (local.get $j) (i32.const 1))))

;; The course's k-th random number in [0, 1).
(func $rc_rnd (param $k i32) (result f32)
  (f32.mul (f32.convert_i32_u (i32.shr_u (call $hash32 (local.get $k) (i32.const 0x2545) (call $p_seed (i32.const @RC_KCOURSE))) (i32.const 8)))
           (f32.const 0x1p-24)))

;; A bend: a random radius and sweep, either way but never heading more than
;; RC_YAWMAX off the start's way; a rail on its outside.
(func $rc_bend (param $q i32) (param $w f32)
  (local $sweep i32) (local $turn i32) (local $yaw i32)
  (local.set $sweep (i32.and (i32.add (i32.const @RC_SWEEP0) (i32.trunc_f32_u (f32.mul (call $rc_rnd (local.get $q)) (f32.const @RC_SWEEPK))))
                             (i32.const -64)))
  (local.set $turn (select (i32.const 1) (i32.const -1) (f32.lt (call $rc_rnd (i32.add (local.get $q) (i32.const 1))) (f32.const 0.5))))
  (local.set $yaw (call $rc_cur_yaw))
  (if (i32.gt_s (i32.add (local.get $yaw) (i32.mul (local.get $turn) (local.get $sweep))) (i32.const @RC_YAWMAX)) (then (local.set $turn (i32.const -1))))
  (if (i32.lt_s (i32.add (local.get $yaw) (i32.mul (local.get $turn) (local.get $sweep))) (i32.const @(-RC_YAWMAX))) (then (local.set $turn (i32.const 1))))
  (drop (call $rc_arc
    (f32.add (f32.add (local.get $w) (f32.const @RC_BENDR0)) (f32.mul (call $rc_rnd (i32.add (local.get $q) (i32.const 2))) (f32.const @RC_BENDRK)))
    (local.get $sweep) (local.get $turn)
    (f32.const 0) (local.get $w)
    (select (i32.const @RCF_RAIL_R) (i32.const @RCF_RAIL_L) (i32.eq (local.get $turn) (i32.const 1)))
    (i32.const @RCS_BEND)))
  ;; its fall, now its length is known: RC_BENDSL of it
  (call $rc_fall (f32.mul (f32.load offset=@RC_P_LEN (call $rc_pa (i32.sub (i32.load (i32.const @(PG_H + RC_NPIECE))) (i32.const 1))))
                          (f32.const @RC_BENDSL))))

;; The last piece laid falls dh more (its end and the cursor lower).
(func $rc_fall (param $dh f32)
  (local $a i32)
  (local.set $a (call $rc_pa (i32.sub (i32.load (i32.const @(PG_H + RC_NPIECE))) (i32.const 1))))
  (f32.store offset=@RC_P_H1 (local.get $a) (f32.sub (f32.load offset=@RC_P_H1 (local.get $a)) (local.get $dh)))
  (f32.store (i32.const @(PG_S + RC_CUR + 16)) (f32.sub (call $rc_cur_h) (local.get $dh))))

;; A drop: a long steep straight, boost pads down it; rails if fl says (the
;; first, so the crowd off the grid doesn't shove its edge off).
(func $rc_drop (param $q i32) (param $w f32) (param $fl i32)
  (local $k i32) (local $len f32) (local $u f32)
  (local.set $len (f32.add (f32.const @RC_DROPL) (f32.mul (call $rc_rnd (local.get $q)) (f32.const 10))))
  (local.set $k (call $rc_straight (local.get $len)
    (f32.neg (f32.mul (local.get $len) (f32.add (f32.const @RC_DROPSL) (f32.mul (call $rc_rnd (i32.add (local.get $q) (i32.const 1))) (f32.const 0.1)))))
    (local.get $w) (local.get $w) (i32.or (i32.const @RCF_CHECK) (local.get $fl)) (i32.const @RCS_DROP)))
  ;; a pair of pads (one in the middle on a narrow track), a third and two thirds down
  (local.set $u (select (f32.mul (local.get $w) (f32.const 0.45)) (f32.const 0) (f32.gt (local.get $w) (f32.const 7))))
  (call $rc_haz (local.get $k) (i32.const @RCH_PAD) (f32.mul (local.get $len) (f32.const 0.35)) (local.get $u) (f32.const @RC_PAD_L) (i32.const 0) (i32.const 0) (f32.const @RC_PAD_W))
  (call $rc_haz (local.get $k) (i32.const @RCH_PAD) (f32.mul (local.get $len) (f32.const 0.65)) (f32.neg (local.get $u)) (f32.const @RC_PAD_L) (i32.const 0) (i32.const 0) (f32.const @RC_PAD_W)))

;; A jump: a short run in, a kicker, a gap, a landing lower down whose front
;; face is a wall to a ball that falls short.
(func $rc_jump (param $q i32) (param $w f32)
  (drop (call $rc_straight (f32.const @RC_RUNIN) (f32.const @(-0.15 * RC_RUNIN)) (local.get $w) (local.get $w) (i32.const @RCF_CHECK) (i32.const @RCS_JUMP)))
  (drop (call $rc_straight (f32.const @RC_KICKL) (f32.const @(RC_KICKL * RC_KICKSL)) (local.get $w) (local.get $w) (i32.const 0) (i32.const @RCS_JUMP)))
  (drop (call $rc_straight (f32.add (f32.const @RC_GAP0) (f32.mul (call $rc_rnd (local.get $q)) (f32.const @RC_GAPK)))
    (f32.const @(-RC_GAPDROP)) (local.get $w) (local.get $w) (i32.const @RCF_GAP) (i32.const @RCS_JUMP)))
  (drop (call $rc_straight (f32.const 16) (f32.const -2) (local.get $w) (local.get $w) (i32.const @RCF_FACE) (i32.const @RCS_JUMP))))

;; A row of power-up boxes across straight k, along metres in, one every RC_BOX_SP or so.
(func $rc_boxes (param $k i32) (param $along f32)
  (local $a i32) (local $m i32) (local $j i32) (local $w f32) (local $sp f32)
  (local.set $a (call $rc_pa (local.get $k)))
  (local.set $w (call $rc_w (local.get $a) (f32.div (local.get $along) (f32.load offset=@RC_P_LEN (local.get $a)))))
  (local.set $m (i32.trunc_f32_u (f32.max (f32.const 2) (f32.div (f32.mul (local.get $w) (f32.const 2)) (f32.const @RC_BOX_SP)))))
  (local.set $sp (f32.div (f32.mul (local.get $w) (f32.const 2)) (f32.convert_i32_u (local.get $m))))
  (!for $j (i32.const 0) (local.get $m)
    (call $rc_haz (local.get $k) (i32.const @RCH_BOX) (local.get $along)
      (!madd (f32.add (f32.convert_i32_u (local.get $j)) (f32.const 0.5)) (local.get $sp) (f32.neg (local.get $w)))
      (f32.const @RC_BOX_R) (i32.const 0) (i32.const 0) (f32.const 0))))

;; The power-up box j hands slot p this round: a dash most often, then a
;; rocket, a pow, a spring, a mega. A hash, not the PRNG: push takes it on
;; either bank.
(func $rc_item (param $p i32) (param $j i32) (result i32)
  (local $h i32)
  (local.set $h (i32.rem_u (call $hash32 (local.get $p) (local.get $j) (call $p_seed (i32.const @RC_KITEM))) (i32.const 100)))
  (if (i32.lt_u (local.get $h) (i32.const 30)) (then (return (i32.const @PU_DASH))))
  (if (i32.lt_u (local.get $h) (i32.const 55)) (then (return (i32.const @PU_ROCKET))))
  (if (i32.lt_u (local.get $h) (i32.const 70)) (then (return (i32.const @PU_POW))))
  (if (i32.lt_u (local.get $h) (i32.const 85)) (then (return (i32.const @PU_SPRING))))
  (i32.const @PU_MEGA))

;; A funnel: the track narrowing to a neck and opening again, no rails.
(func $rc_funnel (param $q i32) (param $w f32)
  (local $neck f32)
  (local.set $neck (f32.max (f32.const @RC_NECK0) (f32.mul (local.get $w) (f32.const @RC_NECKK))))
  (drop (call $rc_straight (f32.const 20) (f32.const -2.4) (local.get $w) (local.get $neck) (i32.const @RCF_CHECK) (i32.const @RCS_FUNNEL)))
  (drop (call $rc_straight (f32.const 14) (f32.const -1.6) (local.get $neck) (local.get $w) (i32.const 0) (i32.const @RCS_FUNNEL))))

;; A bumper field: posts in staggered rows that throw a ball off, rails each side.
(func $rc_bumpers (param $q i32) (param $w f32)
  (local $k i32) (local $row i32) (local $j i32) (local $u f32) (local $sp f32) (local $off f32)
  (local.set $k (call $rc_straight (f32.const 34) (f32.const -4) (local.get $w) (local.get $w) (i32.const @(RCF_CHECK | RCF_RAIL_L | RCF_RAIL_R)) (i32.const @RCS_BUMPERS)))
  (local.set $sp (f32.const @RC_BUMP_SP))
  (local.set $off (f32.mul (call $rc_rnd (local.get $q)) (local.get $sp)))
  (!for $row (i32.const 0) (i32.const 4)
    ;; posts every RC_BUMP_SP across, each row shifted half of it, none within 2.4 m of an edge
    (local.set $u (f32.sub (f32.add (f32.neg (local.get $w)) (local.get $off))
                           (f32.mul (f32.convert_i32_u (i32.and (local.get $row) (i32.const 1))) (f32.mul (local.get $sp) (f32.const 0.5)))))
    (!for $j (i32.const 0) (i32.const 24)
      (if (i32.and (f32.ge (local.get $u) (f32.sub (f32.const @RC_BUMP_EDGE) (local.get $w)))
                   (f32.le (local.get $u) (f32.sub (local.get $w) (f32.const @RC_BUMP_EDGE))))
        (then
          (call $rc_haz (local.get $k) (i32.const @RCH_BUMPER) (f32.add (f32.const 8) (f32.mul (f32.convert_i32_u (local.get $row)) (f32.const 6)))
                        (local.get $u) (f32.const @RC_BUMP_R) (i32.const 0) (i32.const 0) (f32.const 0))))
      (local.set $u (f32.add (local.get $u) (local.get $sp))))))

;; Spinners: two rows of bars turning on posts, each in its own lane, the next
;; one round the other way; the second row between the first's.
(func $rc_spinners (param $q i32) (param $w f32)
  (local $k i32) (local $m i32) (local $j i32) (local $row i32) (local $lane f32) (local $l f32) (local $spd i32) (local $u f32)
  (local.set $k (call $rc_straight (f32.const 36) (f32.const -1.8) (local.get $w) (local.get $w) (i32.const @(RCF_CHECK | RCF_RAIL_L | RCF_RAIL_R)) (i32.const @RCS_SPINNERS)))
  (local.set $m (i32.trunc_f32_u (f32.max (f32.const 1) (f32.nearest (f32.div (f32.mul (local.get $w) (f32.const 2)) (f32.const @RC_SPIN_LANE))))))
  (local.set $lane (f32.div (f32.mul (local.get $w) (f32.const 2)) (f32.convert_i32_u (local.get $m))))
  (local.set $l (f32.min (f32.const @RC_SPIN_LMAX) (f32.mul (local.get $lane) (f32.const @RC_SPIN_LK))))
  (!for $row (i32.const 0) (i32.const 2)
    (!for $j (i32.const 0) (i32.sub (local.get $m) (i32.and (local.get $row) (i32.gt_u (local.get $m) (i32.const 1))))
      (local.set $u (!madd (f32.add (f32.convert_i32_u (local.get $j)) (select (f32.const 1) (f32.const 0.5) (i32.and (local.get $row) (i32.gt_u (local.get $m) (i32.const 1)))))
                           (local.get $lane) (f32.neg (local.get $w))))
      (local.set $spd (i32.add (i32.const @RC_SPIN0) (i32.trunc_f32_u (f32.mul (call $rc_rnd (i32.add (local.get $q) (i32.add (local.get $j) (i32.mul (local.get $row) (i32.const 8))))) (f32.const @RC_SPINK)))))
      (if (i32.and (i32.add (local.get $j) (local.get $row)) (i32.const 1)) (then (local.set $spd (i32.sub (i32.const 0) (local.get $spd)))))
      (call $rc_haz (local.get $k) (i32.const @RCH_SPINNER) (select (f32.const 24) (f32.const 11) (local.get $row)) (local.get $u) (local.get $l)
                    (local.get $spd) (i32.trunc_f32_u (f32.mul (call $rc_rnd (i32.add (local.get $q) (i32.add (local.get $j) (i32.mul (local.get $row) (i32.const 8))))) (f32.const 16384)))
                    (f32.const 0)))))

;; Sweepers: bars along the track sliding from side to side across their lanes, two rows.
(func $rc_sweepers (param $q i32) (param $w f32)
  (local $k i32) (local $m i32) (local $j i32) (local $row i32) (local $lane f32) (local $r f32)
  (local.set $k (call $rc_straight (f32.const 32) (f32.const -2) (local.get $w) (local.get $w) (i32.const @RCF_CHECK) (i32.const @RCS_SWEEPERS)))
  (local.set $m (i32.trunc_f32_u (f32.max (f32.const 1) (f32.nearest (f32.div (local.get $w) (f32.const @RC_SWEEP_LANE))))))
  (local.set $lane (f32.div (f32.mul (local.get $w) (f32.const 2)) (f32.convert_i32_u (local.get $m))))
  (!for $row (i32.const 0) (i32.const 2)
    (!for $j (i32.const 0) (local.get $m)
      (local.set $r (call $rc_rnd (i32.add (local.get $q) (i32.add (local.get $j) (i32.mul (local.get $row) (i32.const 8))))))
      (call $rc_haz (local.get $k) (i32.const @RCH_SWEEPER) (select (f32.const 22) (f32.const 10) (local.get $row))
                    (!madd (f32.add (f32.convert_i32_u (local.get $j)) (f32.const 0.5)) (local.get $lane) (f32.neg (local.get $w)))
                    (f32.const @RC_SWEEP_L)
                    (i32.add (i32.const @RC_SWEEPV0) (i32.trunc_f32_u (f32.mul (local.get $r) (f32.const @RC_SWEEPVK))))
                    (i32.trunc_f32_u (f32.mul (local.get $r) (f32.const 16384)))
                    (f32.max (f32.const 0.5) (f32.sub (f32.mul (local.get $lane) (f32.const 0.5)) (f32.const @RC_SWEEP_KEEP)))))))

;; The course for n balls, from the round's seed: the start grid sized for
;; them, a drop, six bends each into a section (the jump, the funnel, the
;; bumpers, the spinners and the sweepers in an order of the seed's, a last
;; drop), the finish and its pen; then moved so it's centred on the stage's
;; centre. The round's knobs: a scoring round, a lighter push and drag, a
;; brake with no keys, RC_BACK down.
(func $rc_setup (param $n i32)
  (local $w f32) (local $m i32) (local $rows i32) (local $glen f32) (local $k i32) (local $j i32) (local $q i32) (local $a i32)
  (local $x0 f32) (local $x1 f32) (local $z0 f32) (local $z1 f32) (local $r f32) (local $dx f32) (local $dz f32) (local $t i32)
  (local.set $n (select (local.get $n) (i32.const 1) (local.get $n)))
  (local.set $w (f32.min (!madd (f32.convert_i32_u (local.get $n)) (f32.const @RC_WK) (f32.const @RC_W0)) (f32.const @RC_WMAX)))
  (!chk (local.get $w) 60 (local.get $n))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_SCORE))
  (i32.store (i32.const @PG_LEN) (i32.const @RC_LEN))
  (f32.store (i32.const @PG_ACC) (f32.const @RC_ACC))
  (f32.store (i32.const @PG_DRAG) (f32.const @RC_DRAG))
  (f32.store (i32.const @PG_IDLE) (f32.const @RC_IDLE))
  (i32.store (i32.const @PG_RESPAWN) (i32.const @RC_BACK))
  (f32.store (i32.const @(PG_H + RC_W)) (local.get $w))
  (f32.store (i32.const @(PG_S + RC_CUR)) (f32.const 0))
  (f32.store (i32.const @(PG_S + RC_CUR + 4)) (f32.const 0))
  (i32.store (i32.const @(PG_S + RC_CUR + 8)) (i32.const 0))
  (f32.store (i32.const @(PG_S + RC_CUR + 12)) (f32.const 0))
  (f32.store (i32.const @(PG_S + RC_CUR + 16)) (f32.const @RC_TOP))
  ;; the grid: rows of RC_STEP apart, as many a row as the track takes
  (local.set $m (i32.trunc_f32_u (f32.max (f32.const 1) (f32.div (f32.sub (f32.mul (local.get $w) (f32.const 2)) (f32.const 2)) (f32.const @RC_STEP)))))
  (local.set $rows (i32.div_u (i32.add (local.get $n) (i32.sub (local.get $m) (i32.const 1))) (local.get $m)))
  (i32.store (i32.const @(PG_H + RC_ROW)) (local.get $m))
  (local.set $glen (!madd (f32.convert_i32_u (local.get $rows)) (f32.const @RC_STEP) (f32.const 6)))
  (drop (call $rc_straight (local.get $glen) (f32.const 0) (local.get $w) (local.get $w) (i32.const @(RCF_START | RCF_CHECK | RCF_RAIL_L | RCF_RAIL_R)) (i32.const @RCS_START)))
  (f32.store (i32.const @(PG_H + RC_GRID)) (local.get $glen))
  (call $rc_drop (i32.const 10) (local.get $w) (i32.const @(RCF_RAIL_L | RCF_RAIL_R)))
  (call $rc_boxes (i32.sub (i32.load (i32.const @(PG_H + RC_NPIECE))) (i32.const 1))
    (f32.mul (f32.load offset=@RC_P_LEN (call $rc_pa (i32.sub (i32.load (i32.const @(PG_H + RC_NPIECE))) (i32.const 1)))) (f32.const 0.5)))
  ;; the sections' order: the jump second, the four others shuffled round it (bytes at RC_CUR + 20), a drop last
  (i32.store (i32.const @(PG_S + RC_CUR + 20)) (i32.const 0x04030201))
  (!for $j (i32.const 0) (i32.const 3)
    (local.set $k (i32.add (local.get $j) (i32.trunc_f32_u (f32.mul (call $rc_rnd (i32.add (i32.const 20) (local.get $j))) (f32.convert_i32_u (i32.sub (i32.const 4) (local.get $j)))))))
    (local.set $t (!ld u8 @(PG_S + RC_CUR + 20) (local.get $k)))
    (!st u8 @(PG_S + RC_CUR + 20) (local.get $k) (!ld u8 @(PG_S + RC_CUR + 20) (local.get $j)))
    (!st u8 @(PG_S + RC_CUR + 20) (local.get $j) (local.get $t)))
  (!for $j (i32.const 0) (i32.const 6)
    (local.set $q (i32.add (i32.const 100) (i32.mul (local.get $j) (i32.const 32))))
    (call $rc_bend (local.get $q) (local.get $w))
    (local.set $t (select (i32.const 0) (select (i32.const 5)
                                                (!ld u8 @(PG_S + RC_CUR + 20) (i32.sub (local.get $j) (i32.gt_u (local.get $j) (i32.const 1))))
                                                (i32.eq (local.get $j) (i32.const 5)))
                          (i32.eq (local.get $j) (i32.const 1))))
    (local.set $q (i32.add (local.get $q) (i32.const 8)))
    (if (i32.eq (local.get $t) (i32.const 0)) (then (call $rc_jump (local.get $q) (local.get $w))))
    (if (i32.eq (local.get $t) (i32.const 1)) (then (call $rc_funnel (local.get $q) (local.get $w))))
    (if (i32.eq (local.get $t) (i32.const 2)) (then (call $rc_bumpers (local.get $q) (local.get $w))))
    (if (i32.eq (local.get $t) (i32.const 3)) (then (call $rc_spinners (local.get $q) (local.get $w))))
    (if (i32.eq (local.get $t) (i32.const 4)) (then (call $rc_sweepers (local.get $q) (local.get $w))))
    (if (i32.eq (local.get $t) (i32.const 5))
      (then
        (call $rc_drop (local.get $q) (local.get $w) (i32.const 0))
        (call $rc_boxes (i32.sub (i32.load (i32.const @(PG_H + RC_NPIECE))) (i32.const 1)) (f32.const 6)))))
  ;; the run in to the line, and the pen past it
  (drop (call $rc_straight (f32.const 14) (f32.const -0.6) (local.get $w) (local.get $w) (i32.const @(RCF_CHECK | RCF_RAIL_L | RCF_RAIL_R)) (i32.const @RCS_FINISH)))
  (f32.store (i32.const @(PG_H + RC_FIN)) (call $rc_cur_s))
  (drop (call $rc_straight (f32.const @RC_PEN) (f32.const 0) (local.get $w) (local.get $w) (i32.const @(RCF_PEN | RCF_RAIL_L | RCF_RAIL_R)) (i32.const @RCS_FINISH)))
  (f32.store (i32.const @PG_FLOOR) (call $rc_cur_h))
  ;; centred on the stage's centre: the box round every piece's circle
  (local.set $x0 (f32.const 1e9)) (local.set $z0 (f32.const 1e9)) (local.set $x1 (f32.const -1e9)) (local.set $z1 (f32.const -1e9))
  (!for $k (i32.const 0) (i32.load (i32.const @(PG_H + RC_NPIECE)))
    (local.set $a (call $rc_pa (local.get $k)))
    (local.set $r (f32.sqrt (f32.load offset=@RC_P_BR2 (local.get $a))))
    (local.set $x0 (f32.min (local.get $x0) (f32.sub (f32.load offset=@RC_P_BX (local.get $a)) (local.get $r))))
    (local.set $x1 (f32.max (local.get $x1) (f32.add (f32.load offset=@RC_P_BX (local.get $a)) (local.get $r))))
    (local.set $z0 (f32.min (local.get $z0) (f32.sub (f32.load offset=@RC_P_BZ (local.get $a)) (local.get $r))))
    (local.set $z1 (f32.max (local.get $z1) (f32.add (f32.load offset=@RC_P_BZ (local.get $a)) (local.get $r)))))
  (local.set $dx (f32.sub (f32.load (i32.const @PG_CX)) (f32.mul (f32.add (local.get $x0) (local.get $x1)) (f32.const 0.5))))
  (local.set $dz (f32.sub (f32.load (i32.const @PG_CX)) (f32.mul (f32.add (local.get $z0) (local.get $z1)) (f32.const 0.5))))
  (!for $k (i32.const 0) (i32.load (i32.const @(PG_H + RC_NPIECE)))
    (local.set $a (call $rc_pa (local.get $k)))
    (f32.store offset=@RC_P_X (local.get $a) (f32.add (f32.load offset=@RC_P_X (local.get $a)) (local.get $dx)))
    (f32.store offset=@RC_P_Z (local.get $a) (f32.add (f32.load offset=@RC_P_Z (local.get $a)) (local.get $dz)))
    (f32.store offset=@RC_P_BX (local.get $a) (f32.add (f32.load offset=@RC_P_BX (local.get $a)) (local.get $dx)))
    (f32.store offset=@RC_P_BZ (local.get $a) (f32.add (f32.load offset=@RC_P_BZ (local.get $a)) (local.get $dz))))
  (!for $j (i32.const 0) (i32.load (i32.const @(PG_H + RC_NHAZ)))
    (local.set $a (call $rc_ha (local.get $j)))
    (f32.store offset=@RC_H_X (local.get $a) (f32.add (f32.load offset=@RC_H_X (local.get $a)) (local.get $dx)))
    (f32.store offset=@RC_H_Z (local.get $a) (f32.add (f32.load offset=@RC_H_Z (local.get $a)) (local.get $dz))))
  (f32.store (i32.const @PG_SIZE) (f32.mul (f32.max (f32.sub (local.get $x1) (local.get $x0)) (f32.sub (local.get $z1) (local.get $z0))) (f32.const 0.5))))

;; Ball i of n on the grid, rows across the start piece from the line back,
;; in an order the round's seed shuffles (i times a stride prime to n, plus an
;; offset); a newcomer or a respawn (n 1024) anywhere on it.
(func $rc_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $a i32) (local $m i32) (local $k i32) (local $row i32) (local $cnt i32) (local $stride i32) (local $seed i32)
  (local $along f32) (local $u f32) (local $w f32) (local $len f32)
  (local.set $a (call $rc_pa (i32.const 0)))
  (local.set $w (f32.load (i32.const @(PG_H + RC_W))))
  (local.set $len (f32.load offset=@RC_P_LEN (local.get $a)))
  (local.set $m (select (i32.load (i32.const @(PG_H + RC_ROW))) (i32.const 1) (i32.load (i32.const @(PG_H + RC_ROW)))))
  (if (i32.ge_u (local.get $n) (i32.const 1024))
    (then
      (local.set $along (!madd (f32.convert_i32_u (i32.and (local.get $i) (i32.const 15))) (f32.mul (f32.sub (local.get $len) (f32.const 4)) (f32.const 0.0625)) (f32.const 2)))
      (local.set $u (f32.mul (f32.sub (f32.mul (f32.convert_i32_u (i32.shr_u (local.get $i) (i32.const 4))) (f32.const 0.015625)) (f32.const 0.5))
                             (f32.mul (f32.const 2) (f32.max (f32.sub (local.get $w) (f32.const 2)) (f32.const 0))))))
    (else
      (local.set $seed (call $p_seed (i32.const @(RC_KCOURSE + 1))))
      (local.set $stride (i32.add (i32.and (local.get $seed) (i32.const 127)) (i32.const 1)))
      (block $prime
        (loop $next
          (br_if $prime (i32.eq (call $rc_gcd (local.get $stride) (local.get $n)) (i32.const 1)))
          (local.set $stride (i32.add (local.get $stride) (i32.const 1)))
          (br $next)))
      (local.set $k (i32.rem_u (i32.add (i32.mul (local.get $i) (local.get $stride)) (i32.shr_u (local.get $seed) (i32.const 8))) (local.get $n)))
      (local.set $row (i32.div_u (local.get $k) (local.get $m)))
      (local.set $cnt (i32.sub (local.get $n) (i32.mul (local.get $row) (local.get $m))))
      (if (i32.gt_u (local.get $cnt) (local.get $m)) (then (local.set $cnt (local.get $m))))
      (local.set $along (f32.sub (f32.sub (local.get $len) (f32.const 2.5)) (f32.mul (f32.convert_i32_u (local.get $row)) (f32.const @RC_STEP))))
      (local.set $u (f32.mul (f32.sub (f32.convert_i32_u (i32.rem_u (local.get $k) (local.get $m)))
                                      (f32.mul (f32.convert_i32_u (i32.sub (local.get $cnt) (i32.const 1))) (f32.const 0.5)))
                             (f32.const @RC_STEP)))))
  (f32.sub (!madd (f32.load offset=@RC_P_DX (local.get $a)) (local.get $along) (f32.load offset=@RC_P_X (local.get $a)))
           (f32.mul (f32.load offset=@RC_P_DZ (local.get $a)) (local.get $u)))
  (f32.load offset=@RC_P_H0 (local.get $a))
  (!madd (f32.load offset=@RC_P_DX (local.get $a)) (local.get $u)
         (!madd (f32.load offset=@RC_P_DZ (local.get $a)) (local.get $along) (f32.load offset=@RC_P_Z (local.get $a)))))

(func $rc_gcd (param $a i32) (param $b i32) (result i32)
  (local $t i32)
  (block $done
    (loop $next
      (br_if $done (i32.eqz (local.get $b)))
      (local.set $t (i32.rem_u (local.get $a) (local.get $b)))
      (local.set $a (local.get $b))
      (local.set $b (local.get $t))
      (br $next)))
  (local.get $a))

(func $rc_start)

;; The track's top under (x, z) if it's no higher than y: the floor of the
;; piece there, none over a gap or past an edge.
(func $rc_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (local $k i32) (local $f f32) (local $u f32) (local $h f32) (local $tx f32) (local $tz f32) (local $sl f32) (local $a i32)
  (call $rc_at (local.get $x) (local.get $z))
  (local.set $sl) (local.set $tz) (local.set $tx) (local.set $h) (local.set $u) (local.set $f) (local.set $k)
  (if (i32.lt_s (local.get $k) (i32.const 0)) (then (return (f32.const -1000))))
  (local.set $a (call $rc_pa (local.get $k)))
  (if (i32.and (i32.load offset=@RC_P_FL (local.get $a)) (i32.const @RCF_GAP)) (then (return (f32.const -1000))))
  (if (f32.gt (f32.abs (local.get $u)) (call $rc_w (local.get $a) (local.get $f))) (then (return (f32.const -1000))))
  (if (result f32) (f32.le (local.get $h) (local.get $y)) (then (local.get $h)) (else (f32.const -1000))))

;; A round thing (a ball of radius r at (px, pz) moving (vx, vz)) against a
;; bar from (cx, cz) along the unit (ex, ez) l either way, of radius br,
;; moving (bvx, bvz): out of it and, if closing, bounced off it at half its
;; speed into it plus kick. The ball's place and speed after, and 1 if they met.
(func $rc_bar (param $px f32) (param $pz f32) (param $vx f32) (param $vz f32) (param $r f32)
              (param $cx f32) (param $cz f32) (param $ex f32) (param $ez f32) (param $l f32) (param $br f32) (param $bvx f32) (param $bvz f32) (param $kick f32)
              (result f32 f32 f32 f32 i32)
  (local $qx f32) (local $qz f32) (local $t f32) (local $d2 f32) (local $d f32) (local $nx f32) (local $nz f32) (local $rr f32) (local $vn f32)
  (local.set $qx (f32.sub (local.get $px) (local.get $cx)))
  (local.set $qz (f32.sub (local.get $pz) (local.get $cz)))
  (local.set $t (!clamp (!madd (local.get $qx) (local.get $ex) (f32.mul (local.get $qz) (local.get $ez))) (f32.neg (local.get $l)) (local.get $l)))
  (local.set $qx (f32.sub (local.get $qx) (f32.mul (local.get $ex) (local.get $t))))
  (local.set $qz (f32.sub (local.get $qz) (f32.mul (local.get $ez) (local.get $t))))
  (local.set $d2 (!madd (local.get $qx) (local.get $qx) (f32.mul (local.get $qz) (local.get $qz))))
  (local.set $rr (f32.add (local.get $r) (local.get $br)))
  (if (f32.ge (local.get $d2) (f32.mul (local.get $rr) (local.get $rr)))
    (then (return (local.get $px) (local.get $pz) (local.get $vx) (local.get $vz) (i32.const 0))))
  (if (f32.lt (local.get $d2) (f32.const 1e-6))
    (then
      ;; dead on its line: out across it
      (local.set $nx (f32.neg (local.get $ez)))
      (local.set $nz (local.get $ex)))
    (else
      (local.set $d (f32.sqrt (local.get $d2)))
      (local.set $nx (f32.div (local.get $qx) (local.get $d)))
      (local.set $nz (f32.div (local.get $qz) (local.get $d)))))
  (local.set $px (!madd (local.get $nx) (local.get $rr) (!madd (local.get $ex) (local.get $t) (local.get $cx))))
  (local.set $pz (!madd (local.get $nz) (local.get $rr) (!madd (local.get $ez) (local.get $t) (local.get $cz))))
  (local.set $vn (!madd (f32.sub (local.get $vx) (local.get $bvx)) (local.get $nx) (f32.mul (f32.sub (local.get $vz) (local.get $bvz)) (local.get $nz))))
  (if (f32.lt (local.get $vn) (f32.const 0))
    (then
      (local.set $vn (f32.sub (local.get $kick) (f32.mul (local.get $vn) (f32.const 1.5))))
      (local.set $vx (!madd (local.get $nx) (local.get $vn) (local.get $vx)))
      (local.set $vz (!madd (local.get $nz) (local.get $vn) (local.get $vz)))))
  (local.get $px) (local.get $pz) (local.get $vx) (local.get $vz) (i32.const 1))

;; After a ball's move, on bank d: its best place down the course and its
;; score; on the floor the slope pulls it and it rises and falls with it (so
;; it leaves a kicker's lip flying), and a ball just over the floor and not
;; rising goes back onto it (so it keeps its grip over a crest); rails and the
;; pen's walls keep it in, a landing's face stops one that falls short; then
;; the piece's hazards. Writes only its own record and the FX on bank d.
(func $rc_push (param $p i32) (param $d i32)
  (local $pb i32) (local $fl i32) (local $k i32) (local $a i32) (local $pfl i32) (local $j i32) (local $h0 i32) (local $hn i32) (local $hit i32)
  (local $ha i32) (local $kind i32) (local $t i32) (local $sc i32)
  (local $px f32) (local $py f32) (local $pz f32) (local $vx f32) (local $vy f32) (local $vz f32) (local $r f32)
  (local $f f32) (local $u f32) (local $h f32) (local $tx f32) (local $tz f32) (local $sl f32) (local $w f32) (local $len f32)
  (local $s f32) (local $best f32) (local $nx f32) (local $nz f32) (local $vl f32) (local $vt f32) (local $lim f32) (local $along f32)
  (local $sn f32) (local $cs f32) (local $l f32) (local $hx f32) (local $hz f32) (local $om f32) (local $q f32) (local $amp f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
  (if (i32.and (local.get $fl) (i32.const @(PF_FALL | PF_DEAD))) (then (return)))
  (local.set $px (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (local.set $pz (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (call $rc_at (local.get $px) (local.get $pz))
  (local.set $sl) (local.set $tz) (local.set $tx) (local.set $h) (local.set $u) (local.set $f) (local.set $k)
  (if (i32.lt_s (local.get $k) (i32.const 0)) (then (return)))
  (local.set $a (call $rc_pa (local.get $k)))
  (local.set $pfl (i32.load offset=@RC_P_FL (local.get $a)))
  (local.set $py (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
  (local.set $vx (!at f32 @(PLAYERS + P_VX) (local.get $pb)))
  (local.set $vy (!at f32 @(PLAYERS + P_VY) (local.get $pb)))
  (local.set $vz (!at f32 @(PLAYERS + P_VZ) (local.get $pb)))
  (local.set $r (call $b_rad (local.get $pb)))
  (local.set $w (call $rc_w (local.get $a) (local.get $f)))
  (local.set $len (f32.load offset=@RC_P_LEN (local.get $a)))
  (local.set $along (f32.mul (local.get $f) (local.get $len)))
  (local.set $nx (f32.neg (local.get $tz)))
  (local.set $nz (local.get $tx))
  (local.set $t (call $p_t (local.get $d)))

  ;; how far down: its best only from where it may be (a cut counts nothing), home in the pen
  (local.set $s (f32.add (f32.load offset=@RC_P_S0 (local.get $a)) (local.get $along)))
  (local.set $best (f32.mul (f32.convert_i32_u (!at i32 @(PLAYERS + PG_M) (local.get $pb))) (f32.const 0.01)))
  (local.set $lim (f32.add (f32.max (local.get $best) (f32.load (i32.const @(PG_H + RC_GRID)))) (f32.const @RC_SKIP)))
  (local.set $sc (!at u16 @(PLAYERS + PG_SCORE) (local.get $pb)))
  (if (i32.and (f32.le (local.get $s) (local.get $lim)) (i32.lt_u (local.get $sc) (i32.const @RC_WIN)))
    (then
      (if (f32.gt (local.get $s) (local.get $best))
        (then
          (local.set $best (local.get $s))
          (!put i32 @(PLAYERS + PG_M) (local.get $pb) (i32.trunc_sat_f32_u (f32.mul (local.get $s) (f32.const 100))))))
      (local.set $sc (i32.trunc_sat_f32_u (local.get $best)))
      (if (i32.and (local.get $pfl) (i32.const @RCF_PEN))
        (then (local.set $sc (i32.add (i32.const @RC_WIN) (select (i32.sub (i32.load offset=@PG_LEN (local.get $d)) (local.get $t)) (i32.const 0)
                                                                   (i32.gt_s (i32.sub (i32.load offset=@PG_LEN (local.get $d)) (local.get $t)) (i32.const 0)))))))
      (!put u16 @(PLAYERS + PG_SCORE) (local.get $pb) (local.get $sc))))

  ;; the floor
  (if (i32.and (i32.eqz (i32.and (local.get $pfl) (i32.const @RCF_GAP))) (f32.le (f32.abs (local.get $u)) (local.get $w)))
    (then
      (if (i32.and (i32.eqz (i32.and (local.get $fl) (i32.const @PF_GROUND)))
                   (i32.and (i32.and (f32.ge (local.get $py) (local.get $h)) (f32.le (local.get $py) (f32.add (local.get $h) (f32.const @RC_SNAP))))
                            (f32.le (local.get $vy) (f32.const @RC_SNAPV))))
        (then
          (local.set $py (local.get $h))
          (local.set $fl (i32.or (local.get $fl) (i32.const @PF_GROUND)))))
      (if (i32.and (local.get $fl) (i32.const @PF_GROUND))
        (then
          (local.set $q (f32.mul (local.get $sl) (f32.const @(RC_PULL * DT))))
          (local.set $vx (f32.sub (local.get $vx) (f32.mul (local.get $q) (local.get $tx))))
          (local.set $vz (f32.sub (local.get $vz) (f32.mul (local.get $q) (local.get $tz))))
          (local.set $vy (f32.mul (local.get $sl) (!madd (local.get $vx) (local.get $tx) (f32.mul (local.get $vz) (local.get $tz)))))
          (if (f32.gt (local.get $vy) (f32.const 0)) (then (local.set $vy (f32.mul (local.get $vy) (f32.const @RC_RISE)))))))))

  ;; rails (a ball over one hops it), the pen's walls (no hopping those)
  (local.set $l (f32.sub (local.get $w) (local.get $r)))
  (if (i32.or (i32.ne (i32.and (local.get $pfl) (i32.const @RCF_PEN)) (i32.const 0)) (f32.lt (local.get $py) (f32.add (local.get $h) (f32.const @RC_RAIL))))
    (then
      (if (i32.and (i32.ne (i32.and (local.get $pfl) (i32.const @RCF_RAIL_L)) (i32.const 0)) (f32.gt (local.get $u) (local.get $l)))
        (then
          (local.set $px (f32.sub (local.get $px) (f32.mul (local.get $nx) (f32.sub (local.get $u) (local.get $l)))))
          (local.set $pz (f32.sub (local.get $pz) (f32.mul (local.get $nz) (f32.sub (local.get $u) (local.get $l)))))
          (local.set $vl (!madd (local.get $vx) (local.get $nx) (f32.mul (local.get $vz) (local.get $nz))))
          (if (f32.gt (local.get $vl) (f32.const 0))
            (then
              (local.set $vx (f32.sub (local.get $vx) (f32.mul (local.get $nx) (f32.mul (local.get $vl) (f32.const 1.3)))))
              (local.set $vz (f32.sub (local.get $vz) (f32.mul (local.get $nz) (f32.mul (local.get $vl) (f32.const 1.3)))))))))
      (if (i32.and (i32.ne (i32.and (local.get $pfl) (i32.const @RCF_RAIL_R)) (i32.const 0)) (f32.lt (local.get $u) (f32.neg (local.get $l))))
        (then
          (local.set $px (f32.sub (local.get $px) (f32.mul (local.get $nx) (f32.add (local.get $u) (local.get $l)))))
          (local.set $pz (f32.sub (local.get $pz) (f32.mul (local.get $nz) (f32.add (local.get $u) (local.get $l)))))
          (local.set $vl (!madd (local.get $vx) (local.get $nx) (f32.mul (local.get $vz) (local.get $nz))))
          (if (f32.lt (local.get $vl) (f32.const 0))
            (then
              (local.set $vx (f32.sub (local.get $vx) (f32.mul (local.get $nx) (f32.mul (local.get $vl) (f32.const 1.3)))))
              (local.set $vz (f32.sub (local.get $vz) (f32.mul (local.get $nz) (f32.mul (local.get $vl) (f32.const 1.3)))))))))))
  ;; the ends: the wall behind the grid, the pen's far wall, and its mouth carries a ball in
  (local.set $vt (!madd (local.get $vx) (local.get $tx) (f32.mul (local.get $vz) (local.get $tz))))
  (if (i32.and (i32.ne (i32.and (local.get $pfl) (i32.const @RCF_START)) (i32.const 0)) (f32.lt (local.get $along) (local.get $r)))
    (then
      (local.set $px (!madd (local.get $tx) (f32.sub (local.get $r) (local.get $along)) (local.get $px)))
      (local.set $pz (!madd (local.get $tz) (f32.sub (local.get $r) (local.get $along)) (local.get $pz)))
      (if (f32.lt (local.get $vt) (f32.const 0))
        (then
          (local.set $vx (f32.sub (local.get $vx) (f32.mul (local.get $tx) (f32.mul (local.get $vt) (f32.const 1.3)))))
          (local.set $vz (f32.sub (local.get $vz) (f32.mul (local.get $tz) (f32.mul (local.get $vt) (f32.const 1.3)))))))))
  (if (i32.and (local.get $pfl) (i32.const @RCF_PEN))
    (then
      (if (f32.gt (local.get $along) (f32.sub (local.get $len) (local.get $r)))
        (then
          (local.set $px (f32.sub (local.get $px) (f32.mul (local.get $tx) (f32.sub (local.get $along) (f32.sub (local.get $len) (local.get $r))))))
          (local.set $pz (f32.sub (local.get $pz) (f32.mul (local.get $tz) (f32.sub (local.get $along) (f32.sub (local.get $len) (local.get $r))))))
          (if (f32.gt (local.get $vt) (f32.const 0))
            (then
              (local.set $vx (f32.sub (local.get $vx) (f32.mul (local.get $tx) (f32.mul (local.get $vt) (f32.const 1.3)))))
              (local.set $vz (f32.sub (local.get $vz) (f32.mul (local.get $tz) (f32.mul (local.get $vt) (f32.const 1.3)))))))))
      (if (i32.and (f32.lt (local.get $along) (f32.const 4)) (f32.lt (local.get $vt) (f32.const 2)))
        (then
          (local.set $vx (!madd (local.get $tx) (f32.sub (f32.const 2) (local.get $vt)) (local.get $vx)))
          (local.set $vz (!madd (local.get $tz) (f32.sub (f32.const 2) (local.get $vt)) (local.get $vz)))))))
  ;; over a gap, under the landing's top: its face
  (if (i32.and (i32.and (i32.ne (i32.and (local.get $pfl) (i32.const @RCF_GAP)) (i32.const 0))
                        (f32.gt (local.get $along) (f32.sub (local.get $len) (local.get $r))))
               (f32.lt (local.get $py) (f32.sub (f32.load offset=@RC_P_H1 (local.get $a)) (f32.const @P_STEP))))
    (then
      (local.set $px (f32.sub (local.get $px) (f32.mul (local.get $tx) (f32.sub (local.get $along) (f32.sub (local.get $len) (local.get $r))))))
      (local.set $pz (f32.sub (local.get $pz) (f32.mul (local.get $tz) (f32.sub (local.get $along) (f32.sub (local.get $len) (local.get $r))))))
      (if (f32.gt (local.get $vt) (f32.const 0))
        (then
          (local.set $vx (f32.sub (local.get $vx) (f32.mul (local.get $tx) (f32.mul (local.get $vt) (f32.const 1.3)))))
          (local.set $vz (f32.sub (local.get $vz) (f32.mul (local.get $tz) (f32.mul (local.get $vt) (f32.const 1.3)))))))))

  ;; the piece's hazards, as they stand on this bank's tick
  (local.set $h0 (i32.load offset=@RC_P_HZ0 (local.get $a)))
  (local.set $hn (i32.add (local.get $h0) (i32.load offset=@RC_P_HZN (local.get $a))))
  (!for $j (local.get $h0) (local.get $hn)
    (local.set $ha (call $rc_ha (local.get $j)))
    (local.set $kind (i32.load offset=@RC_H_KIND (local.get $ha)))
    (local.set $hx (f32.load offset=@RC_H_X (local.get $ha)))
    (local.set $hz (f32.load offset=@RC_H_Z (local.get $ha)))
    (local.set $l (f32.load offset=@RC_H_L (local.get $ha)))
    (if (i32.and (i32.eq (local.get $kind) (i32.const @RCH_BUMPER)) (f32.lt (local.get $py) (f32.add (local.get $h) (f32.const @RC_BUMP_H))))
      (then
        (call $rc_bar (local.get $px) (local.get $pz) (local.get $vx) (local.get $vz) (local.get $r)
                      (local.get $hx) (local.get $hz) (local.get $tx) (local.get $tz) (f32.const 0) (local.get $l) (f32.const 0) (f32.const 0) (f32.const @RC_BUMP_KICK))
        (local.set $hit) (local.set $vz) (local.set $vx) (local.set $pz) (local.set $px)
        (if (local.get $hit)
          (then (call $fx (local.get $d) (i32.const @RC_FX_BUMP) (local.get $p) (local.get $j)
                          (local.get $hx) (f32.add (f32.load offset=@RC_H_Y (local.get $ha)) (f32.const @RC_BUMP_H)) (local.get $hz)
                          (f32.sqrt (!madd (local.get $vx) (local.get $vx) (f32.mul (local.get $vz) (local.get $vz)))))))))
    (if (i32.eq (local.get $kind) (i32.const @RCH_SPINNER))
      (then
        ;; its post, at any height, then its bar (low: a hop clears it), turning at om rad/s
        (call $rc_bar (local.get $px) (local.get $pz) (local.get $vx) (local.get $vz) (local.get $r)
                      (local.get $hx) (local.get $hz) (local.get $tx) (local.get $tz) (f32.const 0) (f32.const @RC_HUB_R) (f32.const 0) (f32.const 0) (f32.const 0))
        (local.set $hit) (local.set $vz) (local.set $vx) (local.set $pz) (local.set $px)
        (if (f32.lt (local.get $py) (f32.add (local.get $h) (f32.const @RC_BAR_HI)))
          (then
            (call $sincos (i32.add (i32.load offset=@RC_H_PH (local.get $ha)) (i32.mul (i32.load offset=@RC_H_SPD (local.get $ha)) (local.get $t))))
            (local.set $cs) (local.set $sn)
            (local.set $om (f32.mul (f32.convert_i32_s (i32.load offset=@RC_H_SPD (local.get $ha))) (f32.const @(2 * Math.PI / 16384 / DT))))
            ;; the bar's speed where the ball is along it
            (local.set $q (!clamp (!madd (f32.sub (local.get $px) (local.get $hx)) (local.get $cs) (f32.mul (f32.sub (local.get $pz) (local.get $hz)) (local.get $sn)))
                                  (f32.neg (local.get $l)) (local.get $l)))
            (call $rc_bar (local.get $px) (local.get $pz) (local.get $vx) (local.get $vz) (local.get $r)
                          (local.get $hx) (local.get $hz) (local.get $cs) (local.get $sn) (local.get $l) (f32.const @RC_BAR_R)
                          (f32.mul (f32.neg (local.get $sn)) (f32.mul (local.get $om) (local.get $q))) (f32.mul (local.get $cs) (f32.mul (local.get $om) (local.get $q)))
                          (f32.const @RC_BAR_KICK))
            (local.set $hit) (local.set $vz) (local.set $vx) (local.set $pz) (local.set $px)
            (if (local.get $hit)
              (then
                (local.set $vy (f32.max (local.get $vy) (f32.const @RC_BAR_POP)))
                (local.set $fl (i32.and (local.get $fl) (i32.const @(255 ^ PF_GROUND))))))))))
    (if (i32.and (i32.eq (local.get $kind) (i32.const @RCH_SWEEPER)) (f32.lt (local.get $py) (f32.add (local.get $h) (f32.const @RC_SWEEP_HI))))
      (then
        ;; its middle swings across its lane: A sin(phase + speed t), along the piece
        (call $sincos (i32.add (i32.load offset=@RC_H_PH (local.get $ha)) (i32.mul (i32.load offset=@RC_H_SPD (local.get $ha)) (local.get $t))))
        (local.set $cs) (local.set $sn)
        (local.set $amp (f32.load offset=@RC_H_A (local.get $ha)))
        (local.set $om (f32.mul (f32.mul (f32.convert_i32_s (i32.load offset=@RC_H_SPD (local.get $ha))) (f32.const @(2 * Math.PI / 16384 / DT))) (local.get $amp)))
        (call $rc_bar (local.get $px) (local.get $pz) (local.get $vx) (local.get $vz) (local.get $r)
                      (!madd (local.get $nx) (f32.mul (local.get $amp) (local.get $sn)) (local.get $hx))
                      (!madd (local.get $nz) (f32.mul (local.get $amp) (local.get $sn)) (local.get $hz))
                      (local.get $tx) (local.get $tz) (local.get $l) (f32.const @RC_BAR_R)
                      (f32.mul (local.get $nx) (f32.mul (local.get $om) (local.get $cs))) (f32.mul (local.get $nz) (f32.mul (local.get $om) (local.get $cs)))
                      (f32.const @RC_BAR_KICK))
        (local.set $hit) (local.set $vz) (local.set $vx) (local.set $pz) (local.set $px)
        (if (local.get $hit)
          (then
            (local.set $vy (f32.max (local.get $vy) (f32.const @RC_BAR_POP)))
            (local.set $fl (i32.and (local.get $fl) (i32.const @(255 ^ PF_GROUND))))))))
    (if (i32.and (i32.eq (local.get $kind) (i32.const @RCH_BOX)) (i32.eqz (!at u8 @(PLAYERS + B_ITEM) (local.get $pb))))
      (then
        ;; a box: what it hands this slot, if it holds nothing
        (local.set $q (f32.sub (local.get $px) (local.get $hx)))
        (local.set $amp (f32.sub (local.get $pz) (local.get $hz)))
        (local.set $l (f32.add (local.get $l) (local.get $r)))
        (if (i32.and (f32.lt (!madd (local.get $q) (local.get $q) (f32.mul (local.get $amp) (local.get $amp))) (f32.mul (local.get $l) (local.get $l)))
                     (f32.lt (local.get $py) (f32.add (f32.load offset=@RC_H_Y (local.get $ha)) (f32.const @RC_BOX_TOP))))
          (then
            (local.set $hit (call $rc_item (local.get $p) (local.get $j)))
            (!put u8 @(PLAYERS + B_ITEM) (local.get $pb) (local.get $hit))
            (call $fx (local.get $d) (i32.const @FX_PICKUP) (local.get $p) (local.get $j)
                      (local.get $hx) (f32.add (f32.load offset=@RC_H_Y (local.get $ha)) (f32.const @RC_BOX_Y)) (local.get $hz)
                      (f32.convert_i32_u (local.get $hit)))))))
    (if (i32.and (i32.eq (local.get $kind) (i32.const @RCH_PAD)) (i32.ne (i32.and (local.get $fl) (i32.const @PF_GROUND)) (i32.const 0)))
      (then
        ;; a pad: pushed down the track while over it, up to RC_PAD_V
        (local.set $q (!madd (f32.sub (local.get $px) (local.get $hx)) (local.get $tx) (f32.mul (f32.sub (local.get $pz) (local.get $hz)) (local.get $tz))))
        (local.set $amp (!madd (f32.sub (local.get $px) (local.get $hx)) (local.get $nx) (f32.mul (f32.sub (local.get $pz) (local.get $hz)) (local.get $nz))))
        (if (i32.and (i32.and (f32.lt (f32.abs (local.get $q)) (local.get $l)) (f32.lt (f32.abs (local.get $amp)) (f32.load offset=@RC_H_A (local.get $ha))))
                     (f32.lt (!madd (local.get $vx) (local.get $tx) (f32.mul (local.get $vz) (local.get $tz))) (f32.const @RC_PAD_V)))
          (then
            (local.set $vx (!madd (local.get $tx) (f32.const @(RC_PAD_A * DT)) (local.get $vx)))
            (local.set $vz (!madd (local.get $tz) (f32.const @(RC_PAD_A * DT)) (local.get $vz))))))))

  (!chk (local.get $px) 61 (local.get $p))
  (!chk (local.get $py) 62 (local.get $p))
  (!chk (local.get $pz) 63 (local.get $p))
  (!chk (local.get $vx) 64 (local.get $p))
  (!chk (local.get $vy) 65 (local.get $p))
  (!chk (local.get $vz) 66 (local.get $p))
  (!put f32 @(PLAYERS + P_PX) (local.get $pb) (local.get $px))
  (!put f32 @(PLAYERS + P_PY) (local.get $pb) (local.get $py))
  (!put f32 @(PLAYERS + P_PZ) (local.get $pb) (local.get $pz))
  (!put f32 @(PLAYERS + P_VX) (local.get $pb) (local.get $vx))
  (!put f32 @(PLAYERS + P_VY) (local.get $pb) (local.get $vy))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (local.get $vz))
  (!put u8 @(PLAYERS + P_FL) (local.get $pb) (local.get $fl)))

;; Ball p back on the course at its last checkpoint: the last start of a
;; checkpoint piece no further down than its best, 3 m in, across from the
;; middle by its slot, a little up and falling in. Its best stands.
(func $rc_back (param $p i32)
  (local $pb i32) (local $k i32) (local $n i32) (local $a i32) (local $c i32) (local $best f32) (local $u f32) (local $w f32) (local $along f32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (local.set $best (f32.mul (f32.convert_i32_u (!at i32 @(PLAYERS + PG_M) (local.get $pb))) (f32.const 0.01)))
  (local.set $n (i32.load (i32.const @(PG_H + RC_NPIECE))))
  (!for $k (i32.const 0) (local.get $n)
    (local.set $a (call $rc_pa (local.get $k)))
    (if (i32.and (i32.ne (i32.and (i32.load offset=@RC_P_FL (local.get $a)) (i32.const @RCF_CHECK)) (i32.const 0))
                 (f32.le (f32.load offset=@RC_P_S0 (local.get $a)) (local.get $best)))
      (then (local.set $c (local.get $k)))))
  (local.set $a (call $rc_pa (local.get $c)))
  (local.set $w (f32.load offset=@RC_P_W0 (local.get $a)))
  (local.set $along (f32.min (f32.const 3) (f32.mul (f32.load offset=@RC_P_LEN (local.get $a)) (f32.const 0.5))))
  (local.set $u (f32.mul (f32.sub (f32.mul (f32.convert_i32_u (i32.and (call $hash32 (local.get $p) (i32.load (i32.const @HDR_HOLE)) (i32.const 0x7ace)) (i32.const 1023)))
                                           (f32.const 0.0009765625))
                                  (f32.const 0.5))
                         (f32.mul (f32.const 2) (f32.max (f32.sub (local.get $w) (f32.const 2)) (f32.const 0)))))
  (call $p_place (local.get $p)
    (f32.sub (!madd (f32.load offset=@RC_P_DX (local.get $a)) (local.get $along) (f32.load offset=@RC_P_X (local.get $a))) (f32.mul (f32.load offset=@RC_P_DZ (local.get $a)) (local.get $u)))
    (f32.add (!madd (f32.sub (f32.load offset=@RC_P_H1 (local.get $a)) (f32.load offset=@RC_P_H0 (local.get $a)))
                    (f32.div (local.get $along) (f32.load offset=@RC_P_LEN (local.get $a))) (f32.load offset=@RC_P_H0 (local.get $a)))
             (f32.const 1.5))
    (!madd (f32.load offset=@RC_P_DX (local.get $a)) (local.get $u) (!madd (f32.load offset=@RC_P_DZ (local.get $a)) (local.get $along) (f32.load offset=@RC_P_Z (local.get $a)))))
  (!put u8 @(PLAYERS + P_FL) (local.get $pb) (i32.const @PF_LIVE))
  (!put u8 @(PLAYERS + B_HITBY) (local.get $pb) (i32.const 255))
  (!put u16 @(PLAYERS + B_HITT) (local.get $pb) (i32.const 0)))

;; In slot order: a ball newly home takes its place (those home on one tick
;; share it), the first one cuts the clock; a ball down comes back at its
;; checkpoint a tick before the framework would send it to the grid; a ball
;; fallen RC_DEEP under its best place is down, and so is one on the floor
;; further down than it may be (a cut).
(func $rc_tick
  (local $p i32) (local $pb i32) (local $fl i32) (local $t i32) (local $home i32) (local $new i32) (local $sc i32) (local $place i32)
  (local $k i32) (local $f f32) (local $u f32) (local $h f32) (local $tx f32) (local $tz f32) (local $sl f32) (local $best f32) (local $s f32)
  (local.set $t (i32.load (i32.const @HDR_TICK)))
  (local.set $home (i32.load (i32.const @(PG_H + RC_HOME))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
    (if (i32.and (local.get $fl) (i32.const @PF_LIVE))
      (then
        (local.set $sc (!at u16 @(PLAYERS + PG_SCORE) (local.get $pb)))
        (local.set $place (!ld u8 @(PG_S + RC_PLACE) (local.get $p)))
        ;; a newcomer in a slot someone home has left
        (if (i32.and (i32.ne (local.get $place) (i32.const 0)) (i32.lt_u (local.get $sc) (i32.const @RC_WIN)))
          (then (local.set $place (i32.const 0)) (!st u8 @(PG_S + RC_PLACE) (local.get $p) (i32.const 0))))
        (if (i32.and (i32.ge_u (local.get $sc) (i32.const @RC_WIN)) (i32.eqz (local.get $place)))
          (then
            (local.set $place (select (i32.add (local.get $home) (i32.const 1)) (i32.const 255) (i32.lt_u (local.get $home) (i32.const 255))))
            (!st u8 @(PG_S + RC_PLACE) (local.get $p) (local.get $place))
            (!inc $new)
            (call $fx (i32.const 0) (i32.const @RC_FX_HOME) (local.get $p) (i32.const 0)
                      (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (!at f32 @(PLAYERS + P_PZ) (local.get $pb))
                      (f32.convert_i32_u (local.get $place)))
            (if (i32.eqz (i32.load (i32.const @(PG_H + RC_FIRST))))
              (then
                (i32.store (i32.const @(PG_H + RC_FIRST)) (local.get $t))
                (if (i32.gt_u (i32.load (i32.const @HDR_UNTIL)) (i32.add (local.get $t) (i32.const @RC_LATE)))
                  (then (i32.store (i32.const @HDR_UNTIL) (i32.add (local.get $t) (i32.const @RC_LATE)))))
                (call $fx (i32.const 0) (i32.const @RC_FX_LATE) (local.get $p) (i32.const 0)
                          (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (!at f32 @(PLAYERS + P_PZ) (local.get $pb))
                          (f32.convert_i32_u (i32.div_u (i32.sub (i32.load (i32.const @HDR_UNTIL)) (local.get $t)) (i32.const 125))))))))
        (if (i32.and (local.get $fl) (i32.const @PF_DEAD))
          (then
            (if (i32.and (i32.lt_u (local.get $sc) (i32.const @RC_WIN))
                         (i32.ge_u (i32.add (i32.sub (local.get $t) (!at i32 @(PLAYERS + B_OUTAT) (local.get $pb))) (i32.const 1)) (i32.load (i32.const @PG_RESPAWN))))
              (then (call $rc_back (local.get $p)))))
          (else
            (if (i32.and (call $p_in (local.get $pb)) (i32.lt_u (local.get $sc) (i32.const @RC_WIN)))
              (then
                (local.set $best (f32.mul (f32.convert_i32_u (!at i32 @(PLAYERS + PG_M) (local.get $pb))) (f32.const 0.01)))
                (if (f32.lt (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (f32.sub (call $rc_height (local.get $best)) (f32.const @RC_DEEP)))
                  (then (call $p_down (local.get $p)))
                  (else
                    (if (i32.and (local.get $fl) (i32.const @PF_GROUND))
                      (then
                        (call $rc_at (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
                        (local.set $sl) (local.set $tz) (local.set $tx) (local.set $h) (local.set $u) (local.set $f) (local.set $k)
                        (if (i32.ge_s (local.get $k) (i32.const 0))
                          (then
                            (local.set $s (!madd (local.get $f) (f32.load offset=@RC_P_LEN (call $rc_pa (local.get $k))) (f32.load offset=@RC_P_S0 (call $rc_pa (local.get $k)))))
                            (if (f32.gt (local.get $s) (f32.add (f32.max (local.get $best) (f32.load (i32.const @(PG_H + RC_GRID)))) (f32.const @RC_SKIP)))
                              (then
                                (call $fx (i32.const 0) (i32.const @RC_FX_CUT) (local.get $p) (i32.const 0)
                                          (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (!at f32 @(PLAYERS + P_PZ) (local.get $pb)) (f32.const 0))
                                (call $p_down (local.get $p)))))))))))))))))
  (i32.store (i32.const @(PG_H + RC_HOME)) (i32.add (local.get $home) (local.get $new))))

;; Over when every ball in the room is home.
(func $rc_over (result i32)
  (local $p i32) (local $pb i32) (local $n i32)
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (if (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_LIVE))
      (then
        (if (i32.lt_u (!at u16 @(PLAYERS + PG_SCORE) (local.get $pb)) (i32.const @RC_WIN)) (then (return (i32.const 0))))
        (!inc $n))))
  (i32.ne (local.get $n) (i32.const 0)))

(func $rc_out (param $p i32))
