;; Bumper balls: every player a ball, built when BUMPER is set
;; (build/bumper/game.wasm). A wheel of Swiss cheese floats at PLAT_Y over
;; the sea, its holes the golf cup made big and many: a ball whose centre
;; rolls over one, or off the rim, drops through and is out. Balls bump, and
;; the last one rolling wins the round. The rim crumbles in and the holes
;; widen as the round goes on; power-ups fall from the sky. Everything here
;; runs serially, by slot, in the same order on every machine.
;;
;; $b_move and $b_use run on either bank d (0 the confirmed world, PRED_D the
;; prediction) and touch only the ball's own record and its bank's FX ring;
;; bumps, blasts, rockets, orbs and the round are the confirmed world's.

;; ---- the cheese

;; How far the round has squeezed the cheese, 0 to 1: the rim in to B_RMIN,
;; the holes half as wide again. Nothing before the round starts.
(func $b_squeeze (param $d i32) (result f32)
  (if (i32.lt_u (i32.load offset=@HDR_STATE (local.get $d)) (i32.const @H_PLAY)) (then (return (f32.const 0))))
  (f32.min (f32.mul (f32.convert_i32_s (i32.sub (i32.load offset=@HDR_TICK (local.get $d)) (i32.load offset=@HDR_START (local.get $d))))
                    (f32.const @(1 / SHRINK_TICKS)))
           (f32.const 1)))

;; The rim's radius now.
(func $b_rim (param $d i32) (result f32)
  (local $r0 f32)
  (local.set $r0 (f32.load offset=@BH_R0 (local.get $d)))
  (f32.sub (local.get $r0) (f32.mul (f32.max (f32.sub (local.get $r0) (f32.const @B_RMIN)) (f32.const 0)) (call $b_squeeze (local.get $d)))))

;; Hole k's radius now.
(func $b_hole_r (param $d i32) (param $k i32) (result f32)
  (f32.mul (f32.load offset=@(B_HOLES + 8) (i32.shl (local.get $k) (i32.const 4)))
           (!madd (call $b_squeeze (local.get $d)) (f32.const 0.5) (f32.const 1))))

;; What is under (x, z): -1 cheese, k the hole it is over, 255 past the rim.
(func $b_floor (param $d i32) (param $x f32) (param $z f32) (result i32)
  (local $f f32) (local $r f32) (local $g f32) (local $dx f32) (local $dz f32) (local $k i32) (local $h i32)
  (local.set $f (call $b_squeeze (local.get $d)))
  (local.set $r (call $b_rim (local.get $d)))
  (local.set $dx (f32.sub (local.get $x) (f32.const @B_CX)))
  (local.set $dz (f32.sub (local.get $z) (f32.const @B_CX)))
  (if (f32.ge (f32.add (f32.mul (local.get $dx) (local.get $dx)) (f32.mul (local.get $dz) (local.get $dz))) (f32.mul (local.get $r) (local.get $r)))
    (then (return (i32.const 255))))
  (local.set $g (!madd (local.get $f) (f32.const 0.5) (f32.const 1)))
  (!for $k (i32.const 0) (i32.load offset=@BH_NHOLE (local.get $d))
    (local.set $h (i32.add (i32.const @B_HOLES) (i32.shl (local.get $k) (i32.const 4))))
    (local.set $dx (f32.sub (local.get $x) (f32.load (local.get $h))))
    (local.set $dz (f32.sub (local.get $z) (f32.load offset=4 (local.get $h))))
    (local.set $r (f32.mul (f32.load offset=8 (local.get $h)) (local.get $g)))
    (if (f32.lt (f32.add (f32.mul (local.get $dx) (local.get $dx)) (f32.mul (local.get $dz) (local.get $dz))) (f32.mul (local.get $r) (local.get $r)))
      (then (return (local.get $k)))))
  (i32.const -1))

;; A ball's radius and weight, MEGA or not.
(func $b_rad (param $pb i32) (result f32)
  (select (f32.const @MEGA_RAD) (f32.const @B_RAD) (!at u16 @(PLAYERS + B_MEGA) (local.get $pb))))
(func $b_mass (param $pb i32) (result f32)
  (select (f32.const @MEGA_M) (f32.const 1) (!at u16 @(PLAYERS + B_MEGA) (local.get $pb))))

;; Uniform in [0, 1).
(func $b_unit (result f32)
  (f32.mul (f32.convert_i32_u (i32.shr_u (call $rand) (i32.const 8))) (f32.const 0x1p-24)))

;; Spawn candidate i of m: a sunflower spiral over most of the wheel.
(func $b_spot (param $i i32) (param $m i32) (param $r0 f32) (result f32 f32)
  (local $rr f32) (local $s f32) (local $c f32)
  (local.set $rr (f32.mul (f32.mul (local.get $r0) (f32.const 0.86))
                          (f32.sqrt (f32.div (f32.add (f32.convert_i32_u (local.get $i)) (f32.const 0.5)) (f32.convert_i32_u (local.get $m))))))
  (call $sincos (i32.mul (local.get $i) (i32.const 6258))) ;; the golden angle, in 1/16384 turn
  (local.set $c) (local.set $s)
  (!madd (local.get $c) (local.get $rr) (f32.const @B_CX))
  (!madd (local.get $s) (local.get $rr) (f32.const @B_CX)))

(func $bumper_gen (param $seed i32)
  ;; the sea, flat, far under the cheese
  (memory.fill (i32.const @TERRAIN_H) (i32.const 0) (i32.const @(TERRAIN_END - TERRAIN_H)))
  (f32.store (i32.const @BH_R0) (f32.const 16))
  (i32.store (i32.const @BH_WINNER) (i32.const 255)))

;; A new round: the wheel sized for the balls in the room, fresh holes, no
;; orbs or rockets, and every ball on a spot of its own clear of the holes.
(func $b_round
  (local $p i32) (local $pb i32) (local $n i32) (local $k i32) (local $tries i32) (local $nh i32) (local $i i32) (local $m i32)
  (local $nclear i32) (local $ok i32) (local $h i32) (local $q i32)
  (local $r0 f32) (local $rmax f32) (local $r f32) (local $rad f32) (local $s f32) (local $c f32) (local $x f32) (local $z f32)
  (local $dx f32) (local $dz f32) (local $lim f32)
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (if (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $p) (i32.const 6))) (i32.const @PF_LIVE)) (then (!inc $n))))
  (i32.store (i32.const @BH_N0) (local.get $n))
  (local.set $r0 (f32.min (!madd (f32.sqrt (f32.convert_i32_u (local.get $n))) (f32.const 3.5) (f32.const 16)) (f32.const 80)))
  (f32.store (i32.const @BH_R0) (local.get $r0))
  (local.set $rmax (f32.min (!madd (local.get $r0) (f32.const 0.12) (f32.const 1.6)) (f32.const 6)))
  (local.set $nh (i32.add (i32.const 4) (i32.trunc_sat_f32_u (f32.mul (f32.mul (local.get $r0) (local.get $r0)) (f32.const 0.01428)))))
  (if (i32.gt_u (local.get $nh) (i32.const @NHOLE)) (then (local.set $nh (i32.const @NHOLE))))
  (memory.fill (i32.const @B_HOLES) (i32.const 0) (i32.const @(NHOLE * HOLE_SIZE + NORB * ORB_SIZE)))
  (memory.fill (i32.const @PROJ) (i32.const 0) (i32.const @(NPROJ * JSIZE)))
  ;; the holes: anywhere on the wheel, biting into the rim if they like, but
  ;; never within 7 m of the middle, so the last stand has cheese under it
  (block $done
    (loop $more
      (br_if $done (i32.or (i32.ge_u (local.get $k) (local.get $nh)) (i32.ge_u (local.get $tries) (i32.shl (local.get $nh) (i32.const 3)))))
      (!inc $tries)
      (local.set $r (!madd (call $b_unit) (f32.sub (local.get $rmax) (f32.const 2.6)) (f32.const 2.6)))
      (local.set $rad (f32.mul (local.get $r0) (f32.sqrt (call $b_unit))))
      (call $sincos (call $rand))
      (local.set $c) (local.set $s)
      (if (f32.ge (local.get $rad) (f32.add (local.get $r) (f32.const 7)))
        (then
          (local.set $h (i32.add (i32.const @B_HOLES) (i32.shl (local.get $k) (i32.const 4))))
          (f32.store (local.get $h) (!madd (local.get $c) (local.get $rad) (f32.const @B_CX)))
          (f32.store offset=4 (local.get $h) (!madd (local.get $s) (local.get $rad) (f32.const @B_CX)))
          (f32.store offset=8 (local.get $h) (local.get $r))
          (!inc $k)))
      (br $more)))
  (i32.store (i32.const @BH_NHOLE) (local.get $k))
  ;; spawn spots: the spiral's points clear of every hole, then n of them spread evenly
  (local.set $m (i32.add (i32.shl (local.get $n) (i32.const 1)) (i32.const 16)))
  (!for $i (i32.const 0) (local.get $m)
    (call $b_spot (local.get $i) (local.get $m) (local.get $r0))
    (local.set $z) (local.set $x)
    (local.set $ok (i32.const 1))
    (!for $q (i32.const 0) (i32.load (i32.const @BH_NHOLE))
      (local.set $h (i32.add (i32.const @B_HOLES) (i32.shl (local.get $q) (i32.const 4))))
      (local.set $dx (f32.sub (local.get $x) (f32.load (local.get $h))))
      (local.set $dz (f32.sub (local.get $z) (f32.load offset=4 (local.get $h))))
      (local.set $lim (f32.add (f32.load offset=8 (local.get $h)) (f32.const 1.8)))
      (if (f32.lt (f32.add (f32.mul (local.get $dx) (local.get $dx)) (f32.mul (local.get $dz) (local.get $dz))) (f32.mul (local.get $lim) (local.get $lim)))
        (then (local.set $ok (i32.const 0)))))
    (if (local.get $ok)
      (then (!st u16 @B_SCR (local.get $nclear) (local.get $i)) (!inc $nclear))))
  (local.set $k (i32.const 0))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (if (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_LIVE))
      (then
        (local.set $x (f32.const @B_CX))
        (local.set $z (f32.const @B_CX))
        (if (local.get $nclear)
          (then
            (call $b_spot (!ld u16 @B_SCR (i32.div_u (i32.mul (local.get $k) (local.get $nclear)) (local.get $n))) (local.get $m) (local.get $r0))
            (local.set $z) (local.set $x)))
        (call $b_place (local.get $p) (local.get $x) (local.get $z))
        (!inc $k)))))

;; Slot p's ball on the cheese at (x, z), still, everything from last round gone.
(func $b_place (param $p i32) (param $x f32) (param $z f32)
  (local $pb i32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (!put f32 @(PLAYERS + P_PX) (local.get $pb) (local.get $x))
  (!put f32 @(PLAYERS + P_PY) (local.get $pb) (f32.const @PLAT_Y))
  (!put f32 @(PLAYERS + P_PZ) (local.get $pb) (local.get $z))
  (!put f32 @(PLAYERS + P_VX) (local.get $pb) (f32.const 0))
  (!put f32 @(PLAYERS + P_VY) (local.get $pb) (f32.const 0))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (f32.const 0))
  (!put u8 @(PLAYERS + P_FL) (local.get $pb) (i32.const @(PF_LIVE | PF_GROUND)))
  (!put u8 @(PLAYERS + P_FIRED) (local.get $pb) (i32.and (i32.shr_u (!at i32 @(PLAYERS + P_IN) (local.get $pb)) (i32.const 29)) (i32.const 3)))
  (!put u16 @(PLAYERS + P_REFIRE) (local.get $pb) (i32.const 0))
  (!put u8 @(PLAYERS + B_ITEM) (local.get $pb) (i32.const 0))
  (!put u8 @(PLAYERS + B_HOLE) (local.get $pb) (i32.const 0))
  (!put u16 @(PLAYERS + B_MEGA) (local.get $pb) (i32.const 0))
  (!put u16 @(PLAYERS + B_DASH) (local.get $pb) (i32.const 0))
  (!put u8 @(PLAYERS + B_HITBY) (local.get $pb) (i32.const 255))
  (!put u16 @(PLAYERS + B_HITT) (local.get $pb) (i32.const 0))
  (!put u8 @(PLAYERS + B_PLACE) (local.get $pb) (i32.const 0)))

;; A join: before the round starts, the round is laid out again with the new
;; ball in it; once it's under way, the new ball watches until the next.
(func $b_join (param $p i32)
  (local $pb i32) (local $t i32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (local.set $t (i32.load (i32.const @HDR_TICK)))
  (if (i32.eq (i32.load (i32.const @HDR_STATE)) (i32.const @H_IDLE))
    (then
      (i32.store (i32.const @HDR_STATE) (i32.const @H_COUNT))
      (i32.store (i32.const @HDR_UNTIL) (i32.add (local.get $t) (i32.const @B_COUNT)))))
  (if (i32.eq (i32.load (i32.const @HDR_STATE)) (i32.const @H_COUNT)) (then (call $b_round) (return)))
  (call $b_place (local.get $p) (f32.const @B_CX) (f32.const @B_CX))
  (!put f32 @(PLAYERS + P_PY) (local.get $pb) (f32.const @(+PLAT_Y + 20)))
  (!put u8 @(PLAYERS + P_FL) (local.get $pb) (i32.const @(PF_LIVE | PF_DEAD))))

;; ---- a ball's own tick, on bank d

(func $b_move (param $p i32) (param $d i32)
  (local $pb i32) (local $in i32) (local $fl i32) (local $ctr i32) (local $re i32) (local $item i32) (local $n i32) (local $k i32)
  (local $s f32) (local $c f32) (local $fwd f32) (local $side f32) (local $wx f32) (local $wz f32) (local $len f32) (local $acc f32) (local $drag f32)
  (local $px f32) (local $py f32) (local $pz f32) (local $vx f32) (local $vy f32) (local $vz f32) (local $rad f32) (local $sp f32) (local $scale f32)
  (local $hx f32) (local $hz f32) (local $dx f32) (local $dz f32) (local $dist f32) (local $lim f32) (local $vr f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
  (local.set $in (!at i32 @(PLAYERS + P_IN) (local.get $pb)))
  (local.set $ctr (i32.and (i32.shr_u (local.get $in) (i32.const 29)) (i32.const 3)))
  ;; out, or the round not rolling (the countdown, the result): nothing moves, a press is dropped
  (if (i32.or (i32.and (local.get $fl) (i32.const @PF_DEAD)) (i32.ne (i32.load offset=@HDR_STATE (local.get $d)) (i32.const @H_PLAY)))
    (then (!put u8 @(PLAYERS + P_FIRED) (local.get $pb) (local.get $ctr)) (return)))
  (local.set $re (!at u16 @(PLAYERS + P_REFIRE) (local.get $pb)))
  (if (local.get $re)
    (then (local.set $re (i32.sub (local.get $re) (i32.const 1))) (!put u16 @(PLAYERS + P_REFIRE) (local.get $pb) (local.get $re))))
  (local.set $n (!at u16 @(PLAYERS + B_MEGA) (local.get $pb)))
  (if (local.get $n) (then (!put u16 @(PLAYERS + B_MEGA) (local.get $pb) (i32.sub (local.get $n) (i32.const 1)))))
  (local.set $n (!at u16 @(PLAYERS + B_DASH) (local.get $pb)))
  (if (local.get $n) (then (!put u16 @(PLAYERS + B_DASH) (local.get $pb) (i32.sub (local.get $n) (i32.const 1)))))
  (call $sincos (local.get $in))
  (local.set $c) (local.set $s)
  ;; a press with a power-up held and the refire clear uses it; a press with none is dropped
  (if (i32.ne (local.get $ctr) (!at u8 @(PLAYERS + P_FIRED) (local.get $pb)))
    (then
      (local.set $item (!at u8 @(PLAYERS + B_ITEM) (local.get $pb)))
      (if (i32.eqz (local.get $item))
        (then (!put u8 @(PLAYERS + P_FIRED) (local.get $pb) (local.get $ctr)))
        (else
          (if (i32.eqz (local.get $re))
            (then
              (!put u8 @(PLAYERS + P_FIRED) (local.get $pb) (local.get $ctr))
              (!put u16 @(PLAYERS + P_REFIRE) (local.get $pb) (i32.const @USE_REFIRE))
              (call $b_use (local.get $p) (local.get $d) (local.get $item) (local.get $s) (local.get $c))))))))
  (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
  (local.set $rad (call $b_rad (local.get $pb)))
  ;; where the keys push it: forward (c, s), right (-s, c)
  (local.set $fwd (f32.convert_i32_s (i32.sub (i32.and (i32.shr_u (local.get $in) (i32.const 24)) (i32.const 1))
                                              (i32.and (i32.shr_u (local.get $in) (i32.const 25)) (i32.const 1)))))
  (local.set $side (f32.convert_i32_s (i32.sub (i32.and (i32.shr_u (local.get $in) (i32.const 27)) (i32.const 1))
                                               (i32.and (i32.shr_u (local.get $in) (i32.const 26)) (i32.const 1)))))
  (local.set $wx (f32.sub (f32.mul (local.get $c) (local.get $fwd)) (f32.mul (local.get $s) (local.get $side))))
  (local.set $wz (f32.add (f32.mul (local.get $s) (local.get $fwd)) (f32.mul (local.get $c) (local.get $side))))
  (local.set $len (f32.sqrt (f32.add (f32.mul (local.get $wx) (local.get $wx)) (f32.mul (local.get $wz) (local.get $wz)))))
  (if (f32.gt (local.get $len) (f32.const 0))
    (then
      (local.set $wx (f32.div (local.get $wx) (local.get $len)))
      (local.set $wz (f32.div (local.get $wz) (local.get $len)))))
  (local.set $px (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (local.set $py (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
  (local.set $pz (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (local.set $vx (!at f32 @(PLAYERS + P_VX) (local.get $pb)))
  (local.set $vy (!at f32 @(PLAYERS + P_VY) (local.get $pb)))
  (local.set $vz (!at f32 @(PLAYERS + P_VZ) (local.get $pb)))
  ;; rolling: a push and a drag that make 10 m/s flat out; in the air, a third of the push
  (local.set $acc (select (f32.const @B_ACC_DT) (f32.const @B_AIR_DT) (i32.and (local.get $fl) (i32.const @PF_GROUND))))
  (if (!at u16 @(PLAYERS + B_MEGA) (local.get $pb)) (then (local.set $acc (f32.mul (local.get $acc) (f32.const 0.8)))))
  (local.set $drag (select (f32.const @B_DRAG) (f32.const @B_AIR_DRAG) (i32.and (local.get $fl) (i32.const @PF_GROUND))))
  (local.set $vx (!madd (local.get $wx) (local.get $acc) (f32.mul (local.get $vx) (local.get $drag))))
  (local.set $vz (!madd (local.get $wz) (local.get $acc) (f32.mul (local.get $vz) (local.get $drag))))
  (if (i32.and (i32.ne (i32.and (local.get $fl) (i32.const @PF_GROUND)) (i32.const 0)) (i32.ne (i32.and (local.get $in) (i32.const 0x10000000)) (i32.const 0)))
    (then
      (local.set $vy (f32.const @B_HOP))
      (local.set $fl (i32.and (local.get $fl) (i32.const @(255 ^ PF_GROUND))))))
  (if (i32.eqz (i32.and (local.get $fl) (i32.const @PF_GROUND))) (then (local.set $vy (f32.sub (local.get $vy) (f32.const @GP_DT)))))
  (local.set $sp (!dot3 (local.get $vx) (local.get $vy) (local.get $vz) (local.get $vx) (local.get $vy) (local.get $vz)))
  (if (f32.gt (local.get $sp) (f32.const @PVMAX2))
    (then
      (local.set $scale (f32.div (f32.const 80) (f32.sqrt (local.get $sp))))
      (local.set $vx (f32.mul (local.get $vx) (local.get $scale)))
      (local.set $vy (f32.mul (local.get $vy) (local.get $scale)))
      (local.set $vz (f32.mul (local.get $vz) (local.get $scale)))))
  (local.set $px (!madd (local.get $vx) (f32.const @DT) (local.get $px)))
  (local.set $py (!madd (local.get $vy) (f32.const @DT) (local.get $py)))
  (local.set $pz (!madd (local.get $vz) (f32.const @DT) (local.get $pz)))
  ;; the cheese under its centre holds it up; over a hole or past the rim it
  ;; drops, and a little way down it is going through
  (if (i32.eqz (i32.and (local.get $fl) (i32.const @PF_FALL)))
    (then
      (local.set $k (call $b_floor (local.get $d) (local.get $px) (local.get $pz)))
      (if (i32.lt_s (local.get $k) (i32.const 0))
        (then
          (if (f32.le (local.get $py) (f32.const @PLAT_Y))
            (then
              (if (i32.and (local.get $fl) (i32.const @PF_STOMP))
                (then
                  (local.set $fl (i32.and (local.get $fl) (i32.const @(255 ^ PF_STOMP))))
                  (if (i32.eqz (local.get $d))
                    (then (call $b_blast (local.get $px) (f32.const @PLAT_Y) (local.get $pz) (f32.const @STOMP_R) (f32.const @STOMP_S) (local.get $p))))))
              (local.set $py (f32.const @PLAT_Y))
              (local.set $vy (f32.const 0))
              (local.set $fl (i32.or (local.get $fl) (i32.const @PF_GROUND))))
            (else (local.set $fl (i32.and (local.get $fl) (i32.const @(255 ^ PF_GROUND)))))))
        (else
          (local.set $fl (i32.and (local.get $fl) (i32.const @(255 ^ PF_GROUND))))
          (if (f32.lt (local.get $py) (f32.const @(PLAT_Y - 0.4)))
            (then
              (local.set $fl (i32.or (local.get $fl) (i32.const @PF_FALL)))
              (!put u8 @(PLAYERS + B_HOLE) (local.get $pb) (local.get $k))))))))
  ;; going through: the hole's wall (or the rim, from outside) keeps it in
  ;; its shaft until it is out under the cheese
  (if (i32.and (i32.ne (i32.and (local.get $fl) (i32.const @PF_FALL)) (i32.const 0))
               (f32.gt (local.get $py) (f32.sub (f32.const @(PLAT_Y - PLAT_T)) (local.get $rad))))
    (then
      (local.set $k (!at u8 @(PLAYERS + B_HOLE) (local.get $pb)))
      (if (i32.eq (local.get $k) (i32.const 255))
        (then
          (local.set $hx (f32.const @B_CX))
          (local.set $hz (f32.const @B_CX))
          (local.set $lim (f32.add (call $b_rim (local.get $d)) (local.get $rad))))
        (else
          (local.set $hx (f32.load offset=@B_HOLES (i32.shl (local.get $k) (i32.const 4))))
          (local.set $hz (f32.load offset=@(B_HOLES + 4) (i32.shl (local.get $k) (i32.const 4))))
          (local.set $lim (f32.max (f32.sub (call $b_hole_r (local.get $d) (local.get $k)) (local.get $rad)) (f32.const 0)))))
      (local.set $dx (f32.sub (local.get $px) (local.get $hx)))
      (local.set $dz (f32.sub (local.get $pz) (local.get $hz)))
      (local.set $dist (f32.sqrt (f32.max (f32.add (f32.mul (local.get $dx) (local.get $dx)) (f32.mul (local.get $dz) (local.get $dz))) (f32.const 1e-6))))
      (local.set $dx (f32.div (local.get $dx) (local.get $dist)))
      (local.set $dz (f32.div (local.get $dz) (local.get $dist)))
      (local.set $vr (f32.add (f32.mul (local.get $vx) (local.get $dx)) (f32.mul (local.get $vz) (local.get $dz))))
      (if (i32.eq (local.get $k) (i32.const 255))
        (then
          (if (f32.lt (local.get $dist) (local.get $lim))
            (then
              (local.set $px (!madd (local.get $dx) (local.get $lim) (local.get $hx)))
              (local.set $pz (!madd (local.get $dz) (local.get $lim) (local.get $hz)))
              (local.set $vr (f32.min (local.get $vr) (f32.const 0))))
            (else (local.set $vr (f32.const 0)))))
        (else
          (if (f32.gt (local.get $dist) (local.get $lim))
            (then
              (local.set $px (!madd (local.get $dx) (local.get $lim) (local.get $hx)))
              (local.set $pz (!madd (local.get $dz) (local.get $lim) (local.get $hz)))
              (local.set $vr (f32.max (local.get $vr) (f32.const 0))))
            (else (local.set $vr (f32.const 0))))))
      ;; off the wall, a little bounce
      (local.set $vx (f32.sub (local.get $vx) (f32.mul (local.get $dx) (f32.mul (local.get $vr) (f32.const 1.3)))))
      (local.set $vz (f32.sub (local.get $vz) (f32.mul (local.get $dz) (f32.mul (local.get $vr) (f32.const 1.3)))))))
  (!chk (local.get $px) 21 (local.get $p))
  (!chk (local.get $py) 22 (local.get $p))
  (!chk (local.get $pz) 23 (local.get $p))
  (!chk (local.get $vx) 24 (local.get $p))
  (!chk (local.get $vy) 25 (local.get $p))
  (!chk (local.get $vz) 26 (local.get $p))
  (!put f32 @(PLAYERS + P_PX) (local.get $pb) (local.get $px))
  (!put f32 @(PLAYERS + P_PY) (local.get $pb) (local.get $py))
  (!put f32 @(PLAYERS + P_PZ) (local.get $pb) (local.get $pz))
  (!put f32 @(PLAYERS + P_VX) (local.get $pb) (local.get $vx))
  (!put f32 @(PLAYERS + P_VY) (local.get $pb) (local.get $vy))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (local.get $vz))
  (!put u8 @(PLAYERS + P_FL) (local.get $pb) (local.get $fl)))

;; Slot p uses the power-up it holds, facing (c, s). What it does to itself
;; runs on either bank; what it does to others only on the confirmed world.
(func $b_use (param $p i32) (param $d i32) (param $item i32) (param $s f32) (param $c f32)
  (local $pb i32) (local $fl i32) (local $shots i32) (local $rad f32) (local $j i32) (local $jb i32)
  (local $px f32) (local $py f32) (local $pz f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
  (local.set $rad (call $b_rad (local.get $pb)))
  (local.set $px (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (local.set $py (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
  (local.set $pz (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (!put u8 @(PLAYERS + B_ITEM) (local.get $pb) (i32.const 0))
  (local.set $shots (i32.and (i32.add (!at u16 @(PLAYERS + P_SHOTS) (local.get $pb)) (i32.const 1)) (i32.const 0xffff)))
  (!put u16 @(PLAYERS + P_SHOTS) (local.get $pb) (local.get $shots))
  (call $fx (local.get $d) (i32.const @FX_USE) (local.get $p) (local.get $shots) (local.get $px) (local.get $py) (local.get $pz) (f32.convert_i32_u (local.get $item)))
  (if (i32.eq (local.get $item) (i32.const @PU_MEGA))
    (then (!put u16 @(PLAYERS + B_MEGA) (local.get $pb) (i32.const @MEGA_TICKS))))
  (if (i32.eq (local.get $item) (i32.const @PU_DASH))
    (then
      (!put f32 @(PLAYERS + P_VX) (local.get $pb) (f32.mul (local.get $c) (f32.const @DASH_V)))
      (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (f32.mul (local.get $s) (f32.const @DASH_V)))
      (!put u16 @(PLAYERS + B_DASH) (local.get $pb) (i32.const @DASH_TICKS))))
  ;; a spring works while you're still above the cheese: it can save a ball tipping in
  (if (i32.and (i32.eq (local.get $item) (i32.const @PU_SPRING)) (i32.eqz (i32.and (local.get $fl) (i32.const @PF_FALL))))
    (then
      (!put f32 @(PLAYERS + P_VY) (local.get $pb) (f32.const @SPRING_V))
      (!put u8 @(PLAYERS + P_FL) (local.get $pb) (i32.and (i32.or (local.get $fl) (i32.const @PF_STOMP)) (i32.const @(255 ^ PF_GROUND))))))
  (if (local.get $d) (then (return)))
  (if (i32.eq (local.get $item) (i32.const @PU_POW))
    (then (call $b_blast (local.get $px) (f32.add (local.get $py) (local.get $rad)) (local.get $pz) (f32.const @POW_R) (f32.const @POW_S) (local.get $p))))
  (if (i32.eq (local.get $item) (i32.const @PU_ROCKET))
    (then
      (block $found
        (!for $j (i32.const 0) (i32.const @NPROJ)
          (local.set $jb (i32.shl (local.get $j) (i32.const 5)))
          (br_if $found (i32.eqz (!at u8 @(PROJ + J_KIND) (local.get $jb)))))
        (return))
      (!put f32 @(PROJ + J_PX) (local.get $jb) (!madd (local.get $c) (f32.add (local.get $rad) (f32.const 0.8)) (local.get $px)))
      (!put f32 @(PROJ + J_PY) (local.get $jb) (f32.add (local.get $py) (local.get $rad)))
      (!put f32 @(PROJ + J_PZ) (local.get $jb) (!madd (local.get $s) (f32.add (local.get $rad) (f32.const 0.8)) (local.get $pz)))
      (!put f32 @(PROJ + J_VX) (local.get $jb) (f32.mul (local.get $c) (f32.const @ROCKET_BV)))
      (!put f32 @(PROJ + J_VY) (local.get $jb) (f32.const 0))
      (!put f32 @(PROJ + J_VZ) (local.get $jb) (f32.mul (local.get $s) (f32.const @ROCKET_BV)))
      (!put u16 @(PROJ + J_AGE) (local.get $jb) (i32.const 0))
      (!put u8 @(PROJ + J_KIND) (local.get $jb) (i32.const @K_ROCKET))
      (!put u8 @(PROJ + J_OWNER) (local.get $jb) (local.get $p))
      (!put u16 @(PROJ + J_SHOT) (local.get $jb) (local.get $shots)))))

;; ---- the confirmed world: blasts, rockets, bumps, orbs, the round

;; Is slot q a ball on the cheese (in, and not going through)?
(func $b_in (param $qb i32) (result i32)
  (i32.eq (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $qb)) (i32.const @(PF_LIVE | PF_DEAD | PF_FALL))) (i32.const @PF_LIVE)))

;; Golf's blast, on balls: everyone but the owner within r of (x, y, z) shoved
;; away and up, s m/s at the centre falling to nothing at r, less for heavy balls.
(func $b_blast (param $x f32) (param $y f32) (param $z f32) (param $r f32) (param $s f32) (param $owner i32)
  (local $q i32) (local $qb i32) (local $rq f32) (local $dx f32) (local $dy f32) (local $dz f32) (local $d2 f32) (local $hd f32) (local $f f32)
  (!for $q (i32.const 0) (i32.const @NPLAYER)
    (local.set $qb (i32.shl (local.get $q) (i32.const 6)))
    (if (i32.and (call $b_in (local.get $qb)) (i32.ne (local.get $q) (local.get $owner)))
      (then
        (local.set $rq (call $b_rad (local.get $qb)))
        (local.set $dx (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $qb)) (local.get $x)))
        (local.set $dy (f32.sub (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $qb)) (local.get $rq)) (local.get $y)))
        (local.set $dz (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $qb)) (local.get $z)))
        (local.set $hd (f32.add (f32.mul (local.get $dx) (local.get $dx)) (f32.mul (local.get $dz) (local.get $dz))))
        (local.set $d2 (!madd (local.get $dy) (local.get $dy) (local.get $hd)))
        (if (f32.lt (local.get $d2) (f32.mul (local.get $r) (local.get $r)))
          (then
            (local.set $hd (f32.sqrt (f32.max (local.get $hd) (f32.const 1e-6))))
            (local.set $f (f32.div (f32.mul (local.get $s) (f32.sub (f32.const 1) (f32.div (f32.sqrt (local.get $d2)) (local.get $r))))
                                   (call $b_mass (local.get $qb))))
            (!put f32 @(PLAYERS + P_VX) (local.get $qb) (!madd (f32.div (local.get $dx) (local.get $hd)) (local.get $f) (!at f32 @(PLAYERS + P_VX) (local.get $qb))))
            (!put f32 @(PLAYERS + P_VZ) (local.get $qb) (!madd (f32.div (local.get $dz) (local.get $hd)) (local.get $f) (!at f32 @(PLAYERS + P_VZ) (local.get $qb))))
            (!put f32 @(PLAYERS + P_VY) (local.get $qb) (!madd (local.get $f) (f32.const @BLAST_UP) (!at f32 @(PLAYERS + P_VY) (local.get $qb))))
            (!put u8 @(PLAYERS + P_FL) (local.get $qb) (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $qb)) (i32.const @(255 ^ PF_GROUND))))
            (if (i32.ge_s (local.get $owner) (i32.const 0))
              (then
                (!put u8 @(PLAYERS + B_HITBY) (local.get $qb) (local.get $owner))
                (!put u16 @(PLAYERS + B_HITT) (local.get $qb) (i32.const @CREDIT_TICKS)))))))))
  (call $fx (i32.const 0) (i32.const @FX_BLAST) (local.get $owner) (i32.const 0) (local.get $x) (local.get $y) (local.get $z) (local.get $r)))

;; Rockets fly level in two half steps a tick and go off on the first ball they
;; meet, never their owner's; one that meets nobody in 3 s fizzles.
(func $b_rockets
  (local $j i32) (local $jb i32) (local $k i32) (local $q i32) (local $qb i32) (local $owner i32)
  (local $x f32) (local $y f32) (local $z f32) (local $rq f32) (local $dx f32) (local $dy f32) (local $dz f32)
  (!for $j (i32.const 0) (i32.const @NPROJ)
    (local.set $jb (i32.shl (local.get $j) (i32.const 5)))
    (if (i32.eq (!at u8 @(PROJ + J_KIND) (local.get $jb)) (i32.const @K_ROCKET))
      (then (block $gone
        (!put u16 @(PROJ + J_AGE) (local.get $jb) (i32.add (!at u16 @(PROJ + J_AGE) (local.get $jb)) (i32.const 1)))
        (if (i32.gt_u (!at u16 @(PROJ + J_AGE) (local.get $jb)) (i32.const 375))
          (then (memory.fill (i32.add (i32.const @PROJ) (local.get $jb)) (i32.const 0) (i32.const @JSIZE)) (br $gone)))
        (local.set $owner (!at u8 @(PROJ + J_OWNER) (local.get $jb)))
        (!for $k (i32.const 0) (i32.const 2)
          (local.set $x (!madd (!at f32 @(PROJ + J_VX) (local.get $jb)) (f32.const @(DT / 2)) (!at f32 @(PROJ + J_PX) (local.get $jb))))
          (local.set $y (!at f32 @(PROJ + J_PY) (local.get $jb)))
          (local.set $z (!madd (!at f32 @(PROJ + J_VZ) (local.get $jb)) (f32.const @(DT / 2)) (!at f32 @(PROJ + J_PZ) (local.get $jb))))
          (!put f32 @(PROJ + J_PX) (local.get $jb) (local.get $x))
          (!put f32 @(PROJ + J_PZ) (local.get $jb) (local.get $z))
          (!for $q (i32.const 0) (i32.const @NPLAYER)
            (local.set $qb (i32.shl (local.get $q) (i32.const 6)))
            (if (i32.and (call $b_in (local.get $qb)) (i32.ne (local.get $q) (local.get $owner)))
              (then
                (local.set $rq (call $b_rad (local.get $qb)))
                (local.set $dx (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $qb)) (local.get $x)))
                (local.set $dy (f32.sub (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $qb)) (local.get $rq)) (local.get $y)))
                (local.set $dz (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $qb)) (local.get $z)))
                (local.set $rq (f32.add (local.get $rq) (f32.const 0.35)))
                (if (f32.lt (!dot3 (local.get $dx) (local.get $dy) (local.get $dz) (local.get $dx) (local.get $dy) (local.get $dz)) (f32.mul (local.get $rq) (local.get $rq)))
                  (then
                    (memory.fill (i32.add (i32.const @PROJ) (local.get $jb)) (i32.const 0) (i32.const @JSIZE))
                    (call $b_blast (local.get $x) (local.get $y) (local.get $z) (f32.const @BROCKET_R) (f32.const @BROCKET_S) (local.get $owner))
                    (br $gone))))))))))))

;; Every pair of balls on the cheese, in slot order: out of each other's way
;; (the lighter one more) and, if they were closing, an elastic bump with a
;; kick on top. Each remembers who hit it, for the KO.
(func $b_bumps
  (local $n i32) (local $a i32) (local $b i32) (local $i i32) (local $j i32) (local $ib i32) (local $jb i32) (local $p i32)
  (local $ri f32) (local $rj f32) (local $rs f32) (local $dx f32) (local $dy f32) (local $dz f32) (local $d2 f32) (local $d f32)
  (local $nx f32) (local $ny f32) (local $nz f32) (local $mi f32) (local $mj f32) (local $w f32) (local $vrel f32) (local $over f32) (local $jj f32)
  (local $ui f32) (local $uj f32) (local $si f32) (local $sj f32)
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (if (call $b_in (i32.shl (local.get $p) (i32.const 6)))
      (then (!st u8 @B_SCR (local.get $n) (local.get $p)) (!inc $n))))
  (!for $a (i32.const 0) (local.get $n)
    (local.set $i (!ld u8 @B_SCR (local.get $a)))
    (local.set $ib (i32.shl (local.get $i) (i32.const 6)))
    (local.set $ri (call $b_rad (local.get $ib)))
    (!for $b (i32.add (local.get $a) (i32.const 1)) (local.get $n)
      (local.set $j (!ld u8 @B_SCR (local.get $b)))
      (local.set $jb (i32.shl (local.get $j) (i32.const 6)))
      (local.set $rj (call $b_rad (local.get $jb)))
      (local.set $rs (f32.add (local.get $ri) (local.get $rj)))
      (local.set $dx (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $jb)) (!at f32 @(PLAYERS + P_PX) (local.get $ib))))
      (local.set $dz (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $jb)) (!at f32 @(PLAYERS + P_PZ) (local.get $ib))))
      (if (i32.and (f32.lt (f32.abs (local.get $dx)) (local.get $rs)) (f32.lt (f32.abs (local.get $dz)) (local.get $rs)))
        (then
          (local.set $dy (f32.sub (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $jb)) (local.get $rj))
                                  (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $ib)) (local.get $ri))))
          (local.set $d2 (!dot3 (local.get $dx) (local.get $dy) (local.get $dz) (local.get $dx) (local.get $dy) (local.get $dz)))
          (if (f32.lt (local.get $d2) (f32.mul (local.get $rs) (local.get $rs)))
            (then
              (local.set $d (f32.sqrt (f32.max (local.get $d2) (f32.const 1e-6))))
              ;; dead on top of each other: apart along x
              (if (f32.lt (local.get $d2) (f32.const 1e-6)) (then (local.set $dx (local.get $d)) (local.set $dy (f32.const 0)) (local.set $dz (f32.const 0))))
              (local.set $nx (f32.div (local.get $dx) (local.get $d)))
              (local.set $ny (f32.div (local.get $dy) (local.get $d)))
              (local.set $nz (f32.div (local.get $dz) (local.get $d)))
              (local.set $mi (call $b_mass (local.get $ib)))
              (local.set $mj (call $b_mass (local.get $jb)))
              (local.set $ui (f32.div (f32.const 1) (local.get $mi)))
              (local.set $uj (f32.div (f32.const 1) (local.get $mj)))
              (local.set $w (f32.add (local.get $ui) (local.get $uj)))
              (local.set $over (f32.div (f32.sub (local.get $rs) (local.get $d)) (local.get $w)))
              (!put f32 @(PLAYERS + P_PX) (local.get $ib) (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $ib)) (f32.mul (local.get $nx) (f32.mul (local.get $over) (local.get $ui)))))
              (!put f32 @(PLAYERS + P_PZ) (local.get $ib) (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $ib)) (f32.mul (local.get $nz) (f32.mul (local.get $over) (local.get $ui)))))
              (!put f32 @(PLAYERS + P_PX) (local.get $jb) (!madd (local.get $nx) (f32.mul (local.get $over) (local.get $uj)) (!at f32 @(PLAYERS + P_PX) (local.get $jb))))
              (!put f32 @(PLAYERS + P_PZ) (local.get $jb) (!madd (local.get $nz) (f32.mul (local.get $over) (local.get $uj)) (!at f32 @(PLAYERS + P_PZ) (local.get $jb))))
              (local.set $vrel (!dot3 (f32.sub (!at f32 @(PLAYERS + P_VX) (local.get $jb)) (!at f32 @(PLAYERS + P_VX) (local.get $ib)))
                                      (f32.sub (!at f32 @(PLAYERS + P_VY) (local.get $jb)) (!at f32 @(PLAYERS + P_VY) (local.get $ib)))
                                      (f32.sub (!at f32 @(PLAYERS + P_VZ) (local.get $jb)) (!at f32 @(PLAYERS + P_VZ) (local.get $ib)))
                                      (local.get $nx) (local.get $ny) (local.get $nz)))
              (if (f32.lt (local.get $vrel) (f32.const 0))
                (then
                  ;; how fast each was going into the other, before the bump
                  (local.set $si (f32.add (f32.mul (!at f32 @(PLAYERS + P_VX) (local.get $ib)) (local.get $nx)) (f32.mul (!at f32 @(PLAYERS + P_VZ) (local.get $ib)) (local.get $nz))))
                  (local.set $sj (f32.neg (f32.add (f32.mul (!at f32 @(PLAYERS + P_VX) (local.get $jb)) (local.get $nx)) (f32.mul (!at f32 @(PLAYERS + P_VZ) (local.get $jb)) (local.get $nz)))))
                  (local.set $jj (f32.div (f32.sub (f32.const @B_KICK) (f32.mul (local.get $vrel) (f32.const @(1 + +B_E)))) (local.get $w)))
                  (!put f32 @(PLAYERS + P_VX) (local.get $ib) (f32.sub (!at f32 @(PLAYERS + P_VX) (local.get $ib)) (f32.mul (local.get $nx) (f32.mul (local.get $jj) (local.get $ui)))))
                  (!put f32 @(PLAYERS + P_VY) (local.get $ib) (f32.sub (!at f32 @(PLAYERS + P_VY) (local.get $ib)) (f32.mul (local.get $ny) (f32.mul (local.get $jj) (local.get $ui)))))
                  (!put f32 @(PLAYERS + P_VZ) (local.get $ib) (f32.sub (!at f32 @(PLAYERS + P_VZ) (local.get $ib)) (f32.mul (local.get $nz) (f32.mul (local.get $jj) (local.get $ui)))))
                  (!put f32 @(PLAYERS + P_VX) (local.get $jb) (!madd (local.get $nx) (f32.mul (local.get $jj) (local.get $uj)) (!at f32 @(PLAYERS + P_VX) (local.get $jb))))
                  (!put f32 @(PLAYERS + P_VY) (local.get $jb) (!madd (local.get $ny) (f32.mul (local.get $jj) (local.get $uj)) (!at f32 @(PLAYERS + P_VY) (local.get $jb))))
                  (!put f32 @(PLAYERS + P_VZ) (local.get $jb) (!madd (local.get $nz) (f32.mul (local.get $jj) (local.get $uj)) (!at f32 @(PLAYERS + P_VZ) (local.get $jb))))
                  (!put u8 @(PLAYERS + B_HITBY) (local.get $ib) (local.get $j))
                  (!put u16 @(PLAYERS + B_HITT) (local.get $ib) (i32.const @CREDIT_TICKS))
                  (!put u8 @(PLAYERS + B_HITBY) (local.get $jb) (local.get $i))
                  (!put u16 @(PLAYERS + B_HITT) (local.get $jb) (i32.const @CREDIT_TICKS))
                  ;; a hard one: the faster into it gets the bump
                  (if (f32.le (local.get $vrel) (f32.const -4)) (then
                  (if (f32.ge (local.get $si) (local.get $sj))
                    (then (!put u16 @(PLAYERS + B_BUMPS) (local.get $ib) (i32.add (!at u16 @(PLAYERS + B_BUMPS) (local.get $ib)) (i32.const 1))))
                    (else (!put u16 @(PLAYERS + B_BUMPS) (local.get $jb) (i32.add (!at u16 @(PLAYERS + B_BUMPS) (local.get $jb)) (i32.const 1)))))
                  (call $fx (i32.const 0) (i32.const @FX_BUMP) (local.get $i) (local.get $j)
                            (!madd (local.get $nx) (local.get $ri) (!at f32 @(PLAYERS + P_PX) (local.get $ib)))
                            (!madd (local.get $ny) (local.get $ri) (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $ib)) (local.get $ri)))
                            (!madd (local.get $nz) (local.get $ri) (!at f32 @(PLAYERS + P_PZ) (local.get $ib)))
                            (f32.neg (local.get $vrel))))))))))))))

;; An orb in a free slot, high over a random spot of cheese (eight tries).
(func $b_drop
  (local $k i32) (local $o i32) (local $tries i32) (local $rad f32) (local $s f32) (local $c f32) (local $x f32) (local $z f32)
  (block $found
    (!for $k (i32.const 0) (i32.const @NORB)
      (local.set $o (i32.add (i32.const @B_ORBS) (i32.shl (local.get $k) (i32.const 4))))
      (br_if $found (i32.eqz (i32.load8_u offset=12 (local.get $o)))))
    (return))
  (!for $tries (i32.const 0) (i32.const 8)
    (local.set $rad (f32.mul (f32.mul (call $b_rim (i32.const 0)) (f32.const 0.85)) (f32.sqrt (call $b_unit))))
    (call $sincos (call $rand))
    (local.set $c) (local.set $s)
    (local.set $x (!madd (local.get $c) (local.get $rad) (f32.const @B_CX)))
    (local.set $z (!madd (local.get $s) (local.get $rad) (f32.const @B_CX)))
    (if (i32.lt_s (call $b_floor (i32.const 0) (local.get $x) (local.get $z)) (i32.const 0))
      (then
        (f32.store (local.get $o) (local.get $x))
        (f32.store offset=4 (local.get $o) (f32.const @(+PLAT_Y + ORB_Y)))
        (f32.store offset=8 (local.get $o) (local.get $z))
        (i32.store8 offset=12 (local.get $o) (i32.add (i32.rem_u (call $rand) (i32.const @NPU)) (i32.const 1)))
        (i32.store8 offset=13 (local.get $o) (i32.const 1))
        (i32.store16 offset=14 (local.get $o) (i32.const 0))
        (call $fx (i32.const 0) (i32.const @FX_DROP) (i32.const 0) (local.get $k) (local.get $x) (f32.const @PLAT_Y) (local.get $z)
                  (f32.convert_i32_u (i32.load8_u offset=12 (local.get $o))))
        (return)))))

;; The orbs: drops on the clock, falling, lying on the cheese until their
;; time is up or the cheese goes from under them, and picked up by the first
;; ball, in slot order, to roll into one with its hands free.
(func $b_orbs
  (local $t i32) (local $m i32) (local $k i32) (local $o i32) (local $p i32) (local $pb i32) (local $life i32)
  (local $y f32) (local $rad f32) (local $dx f32) (local $dy f32) (local $dz f32) (local $lim f32)
  (local.set $t (i32.load (i32.const @HDR_TICK)))
  (if (i32.ge_u (local.get $t) (i32.load (i32.const @BH_DROP)))
    (then
      (i32.store (i32.const @BH_DROP) (i32.add (local.get $t) (i32.const @DROP_TICKS)))
      (!for $m (i32.const 0) (i32.add (i32.const 1) (i32.div_u (i32.load (i32.const @BH_LEFT)) (i32.const 24)))
        (call $b_drop))))
  (!for $k (i32.const 0) (i32.const @NORB)
    (local.set $o (i32.add (i32.const @B_ORBS) (i32.shl (local.get $k) (i32.const 4))))
    (if (i32.load8_u offset=12 (local.get $o))
      (then (block $gone
        (if (i32.eq (i32.load8_u offset=13 (local.get $o)) (i32.const 1))
          (then
            (local.set $y (f32.sub (f32.load offset=4 (local.get $o)) (f32.const @ORB_FALL)))
            (f32.store offset=4 (local.get $o) (local.get $y))
            (if (f32.le (local.get $y) (f32.const @(+PLAT_Y + 0.6)))
              (then
                (if (i32.and (i32.lt_s (call $b_floor (i32.const 0) (f32.load (local.get $o)) (f32.load offset=8 (local.get $o))) (i32.const 0))
                             (f32.gt (local.get $y) (f32.const @(PLAT_Y - 0.2))))
                  (then
                    (f32.store offset=4 (local.get $o) (f32.const @(+PLAT_Y + 0.6)))
                    (i32.store8 offset=13 (local.get $o) (i32.const 2))
                    (i32.store16 offset=14 (local.get $o) (i32.const @ORB_LIFE))))
                (if (f32.lt (local.get $y) (f32.const @(PLAT_Y - 12)))
                  (then (memory.fill (local.get $o) (i32.const 0) (i32.const @ORB_SIZE)) (br $gone))))))
          (else
            (local.set $life (i32.sub (i32.load16_u offset=14 (local.get $o)) (i32.const 1)))
            (i32.store16 offset=14 (local.get $o) (local.get $life))
            (if (i32.eqz (local.get $life)) (then (memory.fill (local.get $o) (i32.const 0) (i32.const @ORB_SIZE)) (br $gone)))
            (if (i32.ge_s (call $b_floor (i32.const 0) (f32.load (local.get $o)) (f32.load offset=8 (local.get $o))) (i32.const 0))
              (then (i32.store8 offset=13 (local.get $o) (i32.const 1))))))
        (!for $p (i32.const 0) (i32.const @NPLAYER)
          (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
          (if (i32.and (call $b_in (local.get $pb)) (i32.eqz (!at u8 @(PLAYERS + B_ITEM) (local.get $pb))))
            (then
              (local.set $rad (call $b_rad (local.get $pb)))
              (local.set $dx (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (f32.load (local.get $o))))
              (local.set $dy (f32.sub (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (local.get $rad)) (f32.load offset=4 (local.get $o))))
              (local.set $dz (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $pb)) (f32.load offset=8 (local.get $o))))
              (local.set $lim (f32.add (local.get $rad) (f32.const @ORB_R)))
              (if (f32.lt (!dot3 (local.get $dx) (local.get $dy) (local.get $dz) (local.get $dx) (local.get $dy) (local.get $dz)) (f32.mul (local.get $lim) (local.get $lim)))
                (then
                  (!put u8 @(PLAYERS + B_ITEM) (local.get $pb) (i32.load8_u offset=12 (local.get $o)))
                  (call $fx (i32.const 0) (i32.const @FX_PICKUP) (local.get $p) (local.get $k)
                            (f32.load (local.get $o)) (f32.load offset=4 (local.get $o)) (f32.load offset=8 (local.get $o)) (f32.convert_i32_u (i32.load8_u offset=12 (local.get $o))))
                  (memory.fill (local.get $o) (i32.const 0) (i32.const @ORB_SIZE))
                  (br $gone)))))))))))

;; The round, at the end of every tick: bumps and orbs while it rolls, balls
;; that have gone through counted out (a KO for whoever bumped them last, if
;; it was lately), and the clock: a countdown, play until one ball is left
;; (or none, or the time is up), the result, a new wheel.
(func $bumper
  (local $p i32) (local $pb i32) (local $fl i32) (local $live i32) (local $left i32) (local $prev i32) (local $t i32) (local $state i32)
  (local $n i32) (local $hb i32) (local $win i32) (local $credit i32)
  (local.set $t (i32.load (i32.const @HDR_TICK)))
  (local.set $state (i32.load (i32.const @HDR_STATE)))
  (if (i32.eq (local.get $state) (i32.const @H_PLAY))
    (then (call $b_bumps) (call $b_orbs)))
  (local.set $prev (i32.load (i32.const @BH_LEFT)))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
    (if (i32.and (local.get $fl) (i32.const @PF_LIVE))
      (then
        (!inc $live)
        (if (i32.eqz (i32.and (local.get $fl) (i32.const @PF_DEAD)))
          (then
            (local.set $n (!at u16 @(PLAYERS + B_HITT) (local.get $pb)))
            (if (local.get $n) (then (!put u16 @(PLAYERS + B_HITT) (local.get $pb) (i32.sub (local.get $n) (i32.const 1)))))
            (if (i32.and (i32.and (i32.ne (i32.and (local.get $fl) (i32.const @PF_FALL)) (i32.const 0)) (i32.eq (local.get $state) (i32.const @H_PLAY)))
                         (f32.lt (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (f32.const @(PLAT_Y - OUT_DEPTH))))
              (then
                ;; out: everyone going out on one tick shares the place
                (!put u8 @(PLAYERS + P_FL) (local.get $pb) (i32.or (local.get $fl) (i32.const @PF_DEAD)))
                (!put u8 @(PLAYERS + B_PLACE) (local.get $pb) (local.get $prev))
                (!put i32 @(PLAYERS + B_OUTAT) (local.get $pb) (local.get $t))
                (!put u16 @(PLAYERS + B_ROUNDS) (local.get $pb) (i32.add (!at u16 @(PLAYERS + B_ROUNDS) (local.get $pb)) (i32.const 1)))
                (!put f32 @(PLAYERS + P_VX) (local.get $pb) (f32.const 0))
                (!put f32 @(PLAYERS + P_VY) (local.get $pb) (f32.const 0))
                (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (f32.const 0))
                (local.set $hb (!at u8 @(PLAYERS + B_HITBY) (local.get $pb)))
                (local.set $credit (i32.const 255))
                (if (i32.and (i32.and (i32.ne (local.get $n) (i32.const 0)) (i32.ne (local.get $hb) (local.get $p)))
                             (i32.lt_u (local.get $hb) (i32.const @NPLAYER)))
                  (then
                    (if (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $hb) (i32.const 6))) (i32.const @PF_LIVE))
                      (then
                        (local.set $credit (local.get $hb))
                        (!put u16 @(PLAYERS + B_KOS) (i32.shl (local.get $hb) (i32.const 6))
                          (i32.add (!at u16 @(PLAYERS + B_KOS) (i32.shl (local.get $hb) (i32.const 6))) (i32.const 1)))))))
                (call $fx (i32.const 0) (i32.const @FX_SINK) (local.get $p) (local.get $credit)
                          (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (f32.const @PLAT_Y) (!at f32 @(PLAYERS + P_PZ) (local.get $pb))
                          (f32.convert_i32_u (local.get $prev))))
              (else (!inc $left))))))))
  (i32.store (i32.const @HDR_LIVE) (local.get $live))
  (i32.store (i32.const @BH_LEFT) (local.get $left))
  (if (i32.eqz (local.get $live))
    (then (i32.store (i32.const @HDR_STATE) (i32.const @H_IDLE)) (return)))
  (if (i32.eq (local.get $state) (i32.const @H_COUNT))
    (then
      (if (i32.ge_u (local.get $t) (i32.load (i32.const @HDR_UNTIL)))
        (then
          (i32.store (i32.const @HDR_STATE) (i32.const @H_PLAY))
          (i32.store (i32.const @HDR_START) (local.get $t))
          (i32.store (i32.const @HDR_UNTIL) (i32.add (local.get $t) (i32.const @ROUND_TICKS)))
          (i32.store (i32.const @BH_DROP) (i32.add (local.get $t) (i32.const @DROP_FIRST)))))
      (return)))
  (if (i32.eq (local.get $state) (i32.const @H_PLAY))
    (then
      ;; a round of two or more ends with one ball left; a ball alone plays until it falls
      (if (i32.or (i32.or (i32.eqz (local.get $left)) (i32.ge_u (local.get $t) (i32.load (i32.const @HDR_UNTIL))))
                  (i32.and (i32.ge_u (i32.load (i32.const @BH_N0)) (i32.const 2)) (i32.le_u (local.get $left) (i32.const 1))))
        (then
          (local.set $win (i32.const 255))
          (!for $p (i32.const 0) (i32.const @NPLAYER)
            (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
            (if (i32.eq (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE))
              (then
                (!put u16 @(PLAYERS + B_WINS) (local.get $pb) (i32.add (!at u16 @(PLAYERS + B_WINS) (local.get $pb)) (i32.const 1)))
                (!put u16 @(PLAYERS + B_ROUNDS) (local.get $pb) (i32.add (!at u16 @(PLAYERS + B_ROUNDS) (local.get $pb)) (i32.const 1)))
                (!put u8 @(PLAYERS + B_PLACE) (local.get $pb) (i32.const 1))
                (if (i32.eq (local.get $left) (i32.const 1)) (then (local.set $win (local.get $p)))))))
          (i32.store (i32.const @BH_WINNER) (local.get $win))
          (i32.store (i32.const @HDR_STATE) (i32.const @H_OVER))
          (i32.store (i32.const @HDR_UNTIL) (i32.add (local.get $t) (i32.const @B_OVER)))))
      (return)))
  (if (i32.and (i32.eq (local.get $state) (i32.const @H_OVER)) (i32.ge_u (local.get $t) (i32.load (i32.const @HDR_UNTIL))))
    (then
      (i32.store (i32.const @HDR_HOLE) (i32.add (i32.load (i32.const @HDR_HOLE)) (i32.const 1)))
      (call $b_round)
      (i32.store (i32.const @HDR_STATE) (i32.const @H_COUNT))
      (i32.store (i32.const @HDR_UNTIL) (i32.add (local.get $t) (i32.const @B_COUNT))))))
