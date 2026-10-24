;; Players: Quake movement on the heightfield, shots, and pushes on balls.
;; Serial, by slot, after the grid is built and before projectiles move.
;;
;; Input word: yaw b0-13 (1/16384 turn, 0 faces +x, growing turns right) |
;; pitch b14-23 (512 level, up is more) | move b24-27 (forward, back, left,
;; right) | jump b28 | shot counter b29-30 | weapon b31 (0 rocket, 1 grenade)

;; Where slot p stands on the tee: 8 x 8 places 2.5 m apart behind the tee
;; line, facing the cup; slots past 64 stand between them.
(func $tee_spot (param $p i32) (result f32 f32)
  (local $back f32) (local $side f32) (local $dx f32) (local $dz f32)
  (local.set $back (f32.add (f32.mul (f32.convert_i32_u (i32.and (i32.shr_u (local.get $p) (i32.const 3)) (i32.const 7))) (f32.const 2.5))
                            (f32.add (f32.const 1.5) (f32.mul (f32.convert_i32_u (i32.shr_u (local.get $p) (i32.const 6))) (f32.const 0.6)))))
  (local.set $side (f32.add (f32.mul (f32.sub (f32.convert_i32_u (i32.and (local.get $p) (i32.const 7))) (f32.const 3.5)) (f32.const 2.5))
                            (f32.mul (f32.convert_i32_u (i32.shr_u (local.get $p) (i32.const 6))) (f32.const 0.6))))
  (local.set $dx (f32.load (i32.const @HDR_DIR)))
  (local.set $dz (f32.load (i32.const @(HDR_DIR + 4))))
  (f32.sub (f32.sub (f32.load (i32.const @HDR_TEE)) (f32.mul (local.get $dx) (local.get $back))) (f32.mul (local.get $dz) (local.get $side)))
  (f32.add (f32.sub (f32.load (i32.const @(HDR_TEE + 8))) (f32.mul (local.get $dz) (local.get $back))) (f32.mul (local.get $dx) (local.get $side))))

;; Puts slot p on its tee spot for a new hole, with a new ball 1.5 m ahead
;; (unless `ball` is 0). Strokes reset; a shot counter already advanced
;; doesn't fire.
(func $to_tee (param $p i32) (param $ball i32)
  (local $pb i32) (local $x f32) (local $z f32) (local $h f32) (local $n i32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (call $tee_spot (local.get $p))
  (local.set $z) (local.set $x)
  (call $ground (local.get $x) (local.get $z))
  (drop) (drop) (drop) (drop)
  (local.set $h)
  (!put f32 @(PLAYERS + P_PX) (local.get $pb) (local.get $x))
  (!put f32 @(PLAYERS + P_PY) (local.get $pb) (local.get $h))
  (!put f32 @(PLAYERS + P_PZ) (local.get $pb) (local.get $z))
  (!put f32 @(PLAYERS + P_VX) (local.get $pb) (f32.const 0))
  (!put f32 @(PLAYERS + P_VY) (local.get $pb) (f32.const 0))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (f32.const 0))
  (!put u8 @(PLAYERS + P_FL) (local.get $pb) (i32.const @(PF_LIVE | PF_GROUND)))
  (!put u8 @(PLAYERS + P_FIRED) (local.get $pb) (i32.and (i32.shr_u (!at i32 @(PLAYERS + P_IN) (local.get $pb)) (i32.const 29)) (i32.const 3)))
  (!put u16 @(PLAYERS + P_REFIRE) (local.get $pb) (i32.const 0))
  (!put u16 @(PLAYERS + P_STROKES) (local.get $pb) (i32.const 0))
  (!put i32 @(PLAYERS + P_DONE) (local.get $pb) (i32.const 0))
  (!put i32 @(PLAYERS + P_BALL) (local.get $pb) (i32.const -1))
  (local.set $n (i32.load (i32.const @HDR_NBALLS)))
  (if (i32.and (local.get $ball) (i32.lt_u (local.get $n) (i32.const @BALL_CAP)))
    (then
      (local.set $x (!madd (f32.load (i32.const @HDR_DIR)) (f32.const 1.5) (local.get $x)))
      (local.set $z (!madd (f32.load (i32.const @(HDR_DIR + 4))) (f32.const 1.5) (local.get $z)))
      (call $ground (local.get $x) (local.get $z))
      (drop) (drop) (drop) (drop)
      (local.set $h)
      (!st f32 @PX (local.get $n) (local.get $x))
      (!st f32 @PY (local.get $n) (f32.add (local.get $h) (f32.const @R)))
      (!st f32 @PZ (local.get $n) (local.get $z))
      (!st f32 @VX (local.get $n) (f32.const 0))
      (!st f32 @VY (local.get $n) (f32.const 0))
      (!st f32 @VZ (local.get $n) (f32.const 0))
      (!st u8 @FLAGS (local.get $n) (i32.const @F_LIVE))
      (!st u8 @SLEEP (local.get $n) (i32.const 0))
      (!st u16 @OWNER (local.get $n) (local.get $p))
      (call $regrid_ball (local.get $n))
      (!put i32 @(PLAYERS + P_BALL) (local.get $pb) (local.get $n))
      (i32.store (i32.const @HDR_NBALLS) (i32.add (local.get $n) (i32.const 1))))))

;; Quake's accelerate: add speed along wish (a unit vector) up to cap, at
;; most ACCEL_DT * wishspeed this tick.
(func $accel (param $vx f32) (param $vz f32) (param $wx f32) (param $wz f32) (param $cap f32) (param $wish f32) (result f32 f32)
  (local $add f32) (local $acc f32)
  (local.set $add (f32.sub (local.get $cap) (f32.add (f32.mul (local.get $vx) (local.get $wx)) (f32.mul (local.get $vz) (local.get $wz)))))
  (if (f32.gt (local.get $add) (f32.const 0))
    (then
      (local.set $acc (f32.min (f32.mul (f32.const @ACCEL_DT) (local.get $wish)) (local.get $add)))
      (local.set $vx (!madd (local.get $wx) (local.get $acc) (local.get $vx)))
      (local.set $vz (!madd (local.get $wz) (local.get $acc) (local.get $vz)))))
  (local.get $vx)
  (local.get $vz))

(func $players
  (local $p i32)
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (if (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $p) (i32.const 6))) (i32.const @PF_LIVE))
#if BUMPER
      (then (call $b_move (local.get $p) (i32.const 0))))))
#else
      (then (call $move (local.get $p) (i32.const 0))))))
#endif

;; One live player's tick. Every player and projectile record address carries
;; the bank offset d: 0 for the confirmed world, PRED_D for the prediction
;; layer, which runs this same code on its copy (predict.wat).
(func $move (param $p i32) (param $d i32)
  (local $pb i32) (local $in i32) (local $fl i32)
  (local $s f32) (local $c f32) (local $fwd f32) (local $side f32) (local $wx f32) (local $wz f32) (local $len f32) (local $wish f32)
  (local $px f32) (local $py f32) (local $pz f32) (local $vx f32) (local $vy f32) (local $vz f32)
  (local $speed f32) (local $drop f32) (local $h f32) (local $sp f32) (local $scale f32)
#if ARENA
  (local $t f32) (local $lo f32) (local $floor f32) (local $ceil f32) (local $went i32)
#endif
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
  (local.set $in (!at i32 @(PLAYERS + P_IN) (local.get $pb)))
#if ARENA
  ;; the arena's word (layout.mjs): an 11-bit yaw, the bits after it moved down
  (if (i32.and (local.get $fl) (i32.const @PF_DEAD)) (then (call $a_dead (local.get $p) (local.get $d) (local.get $in)) (return)))
  (call $sincos (i32.shl (i32.and (local.get $in) (i32.const 0x7ff)) (i32.const 3)))
  (local.set $c) (local.set $s)
  (call $a_shoot (local.get $p) (local.get $d) (local.get $in) (local.get $s) (local.get $c))
  (local.set $in (i32.or (i32.and (local.get $in) (i32.const 0x7ff))
                         (i32.shl (i32.and (i32.shr_u (local.get $in) (i32.const @AW_MOVE)) (i32.const 31)) (i32.const 24))))
#else
  (call $sincos (local.get $in))
  (local.set $c) (local.set $s)
  (call $shoot (local.get $p) (local.get $d) (local.get $in) (local.get $s) (local.get $c))
#endif
  (local.set $fwd (f32.convert_i32_s (i32.sub (i32.and (i32.shr_u (local.get $in) (i32.const 24)) (i32.const 1))
                                              (i32.and (i32.shr_u (local.get $in) (i32.const 25)) (i32.const 1)))))
  (local.set $side (f32.convert_i32_s (i32.sub (i32.and (i32.shr_u (local.get $in) (i32.const 27)) (i32.const 1))
                                               (i32.and (i32.shr_u (local.get $in) (i32.const 26)) (i32.const 1)))))
  ;; forward (c, s), right (-s, c)
  (local.set $wx (f32.sub (f32.mul (local.get $c) (local.get $fwd)) (f32.mul (local.get $s) (local.get $side))))
  (local.set $wz (f32.add (f32.mul (local.get $s) (local.get $fwd)) (f32.mul (local.get $c) (local.get $side))))
  (local.set $len (f32.sqrt (f32.add (f32.mul (local.get $wx) (local.get $wx)) (f32.mul (local.get $wz) (local.get $wz)))))
  (local.set $wish (f32.const 0))
  (if (f32.gt (local.get $len) (f32.const 0))
    (then
      (local.set $wx (f32.div (local.get $wx) (local.get $len)))
      (local.set $wz (f32.div (local.get $wz) (local.get $len)))
      (local.set $wish (f32.const @RUN))))
  (local.set $px (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (local.set $py (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
  (local.set $pz (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (local.set $vx (!at f32 @(PLAYERS + P_VX) (local.get $pb)))
  (local.set $vy (!at f32 @(PLAYERS + P_VY) (local.get $pb)))
  (local.set $vz (!at f32 @(PLAYERS + P_VZ) (local.get $pb)))
  (if (i32.and (local.get $fl) (i32.const @PF_GROUND))
    (then
      (local.set $speed (f32.sqrt (f32.add (f32.mul (local.get $vx) (local.get $vx)) (f32.mul (local.get $vz) (local.get $vz)))))
      (if (f32.gt (local.get $speed) (f32.const 0))
        (then
          (local.set $drop (f32.mul (f32.max (local.get $speed) (f32.const @STOP)) (f32.const @FRIC_DT)))
          (local.set $scale (f32.div (f32.max (f32.sub (local.get $speed) (local.get $drop)) (f32.const 0)) (local.get $speed)))
          (local.set $vx (f32.mul (local.get $vx) (local.get $scale)))
          (local.set $vz (f32.mul (local.get $vz) (local.get $scale)))))
      (call $accel (local.get $vx) (local.get $vz) (local.get $wx) (local.get $wz) (local.get $wish) (local.get $wish))
      (local.set $vz) (local.set $vx)
      (if (i32.and (local.get $in) (i32.const 0x10000000))
        (then
          (local.set $vy (f32.const @JUMP))
          (local.set $fl (i32.and (local.get $fl) (i32.const @(255 ^ PF_GROUND)))))))
    (else
      (call $accel (local.get $vx) (local.get $vz) (local.get $wx) (local.get $wz)
                   (f32.min (local.get $wish) (f32.const @AIRCAP)) (local.get $wish))
      (local.set $vz) (local.set $vx)
      (local.set $vy (f32.sub (local.get $vy) (f32.const @GP_DT)))))
  (local.set $sp (!dot3 (local.get $vx) (local.get $vy) (local.get $vz) (local.get $vx) (local.get $vy) (local.get $vz)))
  (if (f32.gt (local.get $sp) (f32.const @PVMAX2))
    (then
      (local.set $scale (f32.div (f32.const 80) (f32.sqrt (local.get $sp))))
      (local.set $vx (f32.mul (local.get $vx) (local.get $scale)))
      (local.set $vy (f32.mul (local.get $vy) (local.get $scale)))
      (local.set $vz (f32.mul (local.get $vz) (local.get $scale)))))
#if ARENA
  ;; through the map's boxes an axis at a time: x, z, then up or down. On the
  ;; ground the body's band starts a step up, so it walks onto what is lower
  ;; and is kept from stepping where its head wouldn't fit.
  (local.set $lo (f32.add (local.get $py) (select (f32.const @STEP) (f32.const 0) (i32.and (local.get $fl) (i32.const @PF_GROUND)))))
  (local.set $t (!madd (local.get $vx) (f32.const @DT) (local.get $px)))
  (local.set $px (call $hull_axis (i32.const 0) (local.get $px) (local.get $t) (local.get $pz) (local.get $lo) (f32.add (local.get $lo) (f32.const @P_TOP))))
  (if (f32.ne (local.get $px) (local.get $t)) (then (local.set $vx (f32.const 0))))
  (if (f32.lt (local.get $px) (f32.load (i32.const @MAP_BOUNDS))) (then (local.set $px (f32.load (i32.const @MAP_BOUNDS))) (local.set $vx (f32.max (local.get $vx) (f32.const 0)))))
  (if (f32.gt (local.get $px) (f32.load (i32.const @(MAP_BOUNDS + 4)))) (then (local.set $px (f32.load (i32.const @(MAP_BOUNDS + 4)))) (local.set $vx (f32.min (local.get $vx) (f32.const 0)))))
  (local.set $t (!madd (local.get $vz) (f32.const @DT) (local.get $pz)))
  (local.set $pz (call $hull_axis (i32.const 8) (local.get $pz) (local.get $t) (local.get $px) (local.get $lo) (f32.add (local.get $lo) (f32.const @P_TOP))))
  (if (f32.ne (local.get $pz) (local.get $t)) (then (local.set $vz (f32.const 0))))
  (if (f32.lt (local.get $pz) (f32.load (i32.const @(MAP_BOUNDS + 8)))) (then (local.set $pz (f32.load (i32.const @(MAP_BOUNDS + 8)))) (local.set $vz (f32.max (local.get $vz) (f32.const 0)))))
  (if (f32.gt (local.get $pz) (f32.load (i32.const @(MAP_BOUNDS + 12)))) (then (local.set $pz (f32.load (i32.const @(MAP_BOUNDS + 12)))) (local.set $vz (f32.min (local.get $vz) (f32.const 0)))))
  ;; what it can land on (a box top it was over, or a step up from the ground) and hit its head on
  (call $hull_y (local.get $px) (local.get $pz)
                (f32.add (local.get $py) (select (f32.const @STEP) (f32.const 0.01) (i32.and (local.get $fl) (i32.const @PF_GROUND))))
                (f32.sub (f32.add (local.get $py) (f32.const @P_TOP)) (f32.const 0.01)))
  (local.set $ceil) (local.set $floor)
  (local.set $py (!madd (local.get $vy) (f32.const @DT) (local.get $py)))
  (if (f32.gt (f32.add (local.get $py) (f32.const @P_TOP)) (local.get $ceil))
    (then (local.set $py (f32.sub (local.get $ceil) (f32.const @P_TOP))) (local.set $vy (f32.min (local.get $vy) (f32.const 0)))))
#else
  (local.set $px (!madd (local.get $vx) (f32.const @DT) (local.get $px)))
  (local.set $py (!madd (local.get $vy) (f32.const @DT) (local.get $py)))
  (local.set $pz (!madd (local.get $vz) (f32.const @DT) (local.get $pz)))
  (if (f32.lt (local.get $px) (f32.const 1)) (then (local.set $px (f32.const 1)) (local.set $vx (f32.max (local.get $vx) (f32.const 0)))))
  (if (f32.gt (local.get $px) (f32.const 1021)) (then (local.set $px (f32.const 1021)) (local.set $vx (f32.min (local.get $vx) (f32.const 0)))))
  (if (f32.lt (local.get $pz) (f32.const 1)) (then (local.set $pz (f32.const 1)) (local.set $vz (f32.max (local.get $vz) (f32.const 0)))))
  (if (f32.gt (local.get $pz) (f32.const 1021)) (then (local.set $pz (f32.const 1021)) (local.set $vz (f32.min (local.get $vz) (f32.const 0)))))
#endif
  (if (f32.gt (local.get $py) (f32.const @CEIL)) (then (local.set $py (f32.const @CEIL)) (local.set $vy (f32.min (local.get $vy) (f32.const 0)))))
  (call $ground (local.get $px) (local.get $pz))
  (drop) (drop) (drop) (drop)
  (local.set $h)
#if ARENA
  (local.set $h (f32.max (local.get $h) (local.get $floor)))
#endif
  ;; walking feet follow the ground; a fall or a blast lifts them off it
  (if (i32.and (i32.ne (i32.and (local.get $fl) (i32.const @PF_GROUND)) (i32.const 0)) (f32.le (local.get $vy) (f32.const 0)))
    (then
      (if (f32.lt (f32.sub (local.get $py) (local.get $h)) (f32.const @SNAP))
        (then (local.set $py (local.get $h)) (local.set $vy (f32.const 0)))
        (else (local.set $fl (i32.and (local.get $fl) (i32.const @(255 ^ PF_GROUND)))))))
    (else
      (if (f32.le (local.get $py) (local.get $h))
        (then
          (local.set $py (local.get $h))
          (local.set $vy (f32.const 0))
          (local.set $fl (i32.or (local.get $fl) (i32.const @PF_GROUND))))
        (else (local.set $fl (i32.and (local.get $fl) (i32.const @(255 ^ PF_GROUND))))))))
#if ARENA
  (call $a_tele (local.get $p) (local.get $d) (local.get $px) (local.get $py) (local.get $pz))
  (local.set $went) (local.set $pz) (local.set $py) (local.set $px)
  (if (local.get $went) (then (local.set $fl (i32.and (local.get $fl) (i32.const @(255 ^ PF_GROUND))))))
#endif
  (!chk (local.get $px) 11 (local.get $p))
  (!chk (local.get $py) 12 (local.get $p))
  (!chk (local.get $pz) 13 (local.get $p))
  (!chk (local.get $vx) 14 (local.get $p))
  (!chk (local.get $vy) 15 (local.get $p))
  (!chk (local.get $vz) 16 (local.get $p))
  (!put f32 @(PLAYERS + P_PX) (local.get $pb) (local.get $px))
  (!put f32 @(PLAYERS + P_PY) (local.get $pb) (local.get $py))
  (!put f32 @(PLAYERS + P_PZ) (local.get $pb) (local.get $pz))
  (!put f32 @(PLAYERS + P_VX) (local.get $pb) (local.get $vx))
  (!put f32 @(PLAYERS + P_VY) (local.get $pb) (local.get $vy))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (local.get $vz))
  (!put u8 @(PLAYERS + P_FL) (local.get $pb) (local.get $fl)))

;; A shot when the counter has moved since the last one and the refire timer
;; is clear; an advance during the timer waits for it. No shots in the
;; countdown, and a shot is a stroke only in play, before your ball is in.
(func $shoot (param $p i32) (param $d i32) (param $in i32) (param $s f32) (param $c f32)
  (local $pb i32) (local $ctr i32) (local $re i32) (local $state i32) (local $wpn i32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (local.set $ctr (i32.and (i32.shr_u (local.get $in) (i32.const 29)) (i32.const 3)))
  (local.set $wpn (i32.shr_u (local.get $in) (i32.const 31)))
  (local.set $re (!at u16 @(PLAYERS + P_REFIRE) (local.get $pb)))
  (if (local.get $re)
    (then
      (local.set $re (i32.sub (local.get $re) (i32.const 1)))
      (!put u16 @(PLAYERS + P_REFIRE) (local.get $pb) (local.get $re))))
  (local.set $state (i32.load offset=@HDR_STATE (local.get $d)))
  (if (i32.le_u (local.get $state) (i32.const @H_COUNT))
    (then (!put u8 @(PLAYERS + P_FIRED) (local.get $pb) (local.get $ctr)) (return)))
  (if (i32.or (local.get $re) (i32.eq (local.get $ctr) (!at u8 @(PLAYERS + P_FIRED) (local.get $pb)))) (then (return)))
  (!put u8 @(PLAYERS + P_FIRED) (local.get $pb) (local.get $ctr))
  (!put u16 @(PLAYERS + P_REFIRE) (local.get $pb) (select (i32.const @GREN_REFIRE) (i32.const @ROCKET_REFIRE) (local.get $wpn)))
  (!put u16 @(PLAYERS + P_SHOTS) (local.get $pb) (i32.add (!at u16 @(PLAYERS + P_SHOTS) (local.get $pb)) (i32.const 1)))
  (if (i32.and (i32.eq (local.get $state) (i32.const @H_PLAY))
               (i32.eqz (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_DONE))))
    (then (!put u16 @(PLAYERS + P_STROKES) (local.get $pb) (i32.add (!at u16 @(PLAYERS + P_STROKES) (local.get $pb)) (i32.const 1)))))
  (call $fire (local.get $p) (local.get $d) (local.get $wpn) (local.get $s) (local.get $c)
              (i32.shl (i32.sub (i32.and (i32.shr_u (local.get $in) (i32.const 14)) (i32.const 0x3ff)) (i32.const 512)) (i32.const 3))))

;; Players push the balls they walk into, never stand on them, and pass
;; through their own ball so it can't be dribbled to the cup. Changes
;; velocities only, so the grid stays valid.
(func $push_balls
  (local $p i32) (local $pb i32) (local $own i32) (local $j i32) (local $s i32)
  (local $x0 i32) (local $x1 i32) (local $y0 i32) (local $y1 i32) (local $z0 i32) (local $z1 i32)
  (local $cx i32) (local $cy i32) (local $cz i32) (local $b i32)
  (local $px f32) (local $py f32) (local $pz f32) (local $dx f32) (local $dz f32) (local $d2 f32) (local $d f32)
  (local $nx f32) (local $nz f32) (local $dv f32) (local $by f32)
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (if (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_LIVE))
      (then
        (local.set $own (!at i32 @(PLAYERS + P_BALL) (local.get $pb)))
        (local.set $px (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
        (local.set $py (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
        (local.set $pz (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
        ;; the cells under the body, 0.7 m around and from 0.2 m under the feet
        ;; to 0.2 m over the head: at most 5 x 7 x 5, so no bucket twice
        (local.set $x0 (i32.trunc_sat_f32_s (f32.floor (f32.mul (f32.sub (local.get $px) (f32.const 0.7)) (f32.const @INV_CELL)))))
        (local.set $x1 (i32.trunc_sat_f32_s (f32.floor (f32.mul (f32.add (local.get $px) (f32.const 0.7)) (f32.const @INV_CELL)))))
        (local.set $y0 (i32.trunc_sat_f32_s (f32.floor (f32.mul (f32.sub (local.get $py) (f32.const 0.2)) (f32.const @INV_CELL)))))
        (local.set $y1 (i32.trunc_sat_f32_s (f32.floor (f32.mul (f32.add (local.get $py) (f32.const 2.0)) (f32.const @INV_CELL)))))
        (local.set $z0 (i32.trunc_sat_f32_s (f32.floor (f32.mul (f32.sub (local.get $pz) (f32.const 0.7)) (f32.const @INV_CELL)))))
        (local.set $z1 (i32.trunc_sat_f32_s (f32.floor (f32.mul (f32.add (local.get $pz) (f32.const 0.7)) (f32.const @INV_CELL)))))
        (local.set $cz (local.get $z0))
        (loop $lz
          (local.set $cy (local.get $y0))
          (loop $ly
            (local.set $cx (local.get $x0))
            (loop $lx
              (local.set $b (call $bucket (local.get $cx) (local.get $cy) (local.get $cz)))
              (local.set $s (!ld u16 @HEAD (local.get $b)))
              (block $done
                (loop $scan
                  (br_if $done (i32.eq (local.get $s) (i32.const 0xffff)))
                  (local.set $j (local.get $s))
                  (local.set $s (!ld u16 @NEXT (local.get $j)))
                  (br_if $scan (i32.eq (local.get $j) (local.get $own)))
                  (local.set $by (!ld f32 @PY (local.get $j)))
                  (br_if $scan (f32.lt (local.get $by) (f32.sub (local.get $py) (f32.const @R))))
                  (br_if $scan (f32.gt (local.get $by) (f32.add (local.get $py) (f32.const 2.0))))
                  (local.set $dx (f32.sub (!ld f32 @PX (local.get $j)) (local.get $px)))
                  (local.set $dz (f32.sub (!ld f32 @PZ (local.get $j)) (local.get $pz)))
                  (local.set $d2 (f32.add (f32.mul (local.get $dx) (local.get $dx)) (f32.mul (local.get $dz) (local.get $dz))))
                  (br_if $scan (i32.eqz (f32.lt (local.get $d2) (f32.const 0.49))))
                  (local.set $d (f32.sqrt (f32.max (local.get $d2) (f32.const 1e-6))))
                  (local.set $nx (f32.div (local.get $dx) (local.get $d)))
                  (local.set $nz (f32.div (local.get $dz) (local.get $d)))
                  ;; match the body's speed along the normal, plus a spring out of the overlap
                  (local.set $dv (f32.add
                    (f32.max (f32.sub (f32.add (f32.mul (!at f32 @(PLAYERS + P_VX) (local.get $pb)) (local.get $nx))
                                               (f32.mul (!at f32 @(PLAYERS + P_VZ) (local.get $pb)) (local.get $nz)))
                                      (f32.add (f32.mul (!ld f32 @VX (local.get $j)) (local.get $nx))
                                               (f32.mul (!ld f32 @VZ (local.get $j)) (local.get $nz))))
                             (f32.const 0))
                    (f32.mul (f32.sub (f32.const 0.7) (local.get $d)) (f32.const @PUSH))))
                  (!st f32 @VX (local.get $j) (!madd (local.get $nx) (local.get $dv) (!ld f32 @VX (local.get $j))))
                  (!st f32 @VZ (local.get $j) (!madd (local.get $nz) (local.get $dv) (!ld f32 @VZ (local.get $j))))
                  (!st u8 @FLAGS (local.get $j) (i32.or (!ld u8 @FLAGS (local.get $j)) (i32.const @F_AWAKE)))
                  (!st u8 @SLEEP (local.get $j) (i32.const 0))
                  (br $scan)))
              (local.set $cx (i32.add (local.get $cx) (i32.const 1)))
              (br_if $lx (i32.le_s (local.get $cx) (local.get $x1))))
            (local.set $cy (i32.add (local.get $cy) (i32.const 1)))
            (br_if $ly (i32.le_s (local.get $cy) (local.get $y1))))
          (local.set $cz (i32.add (local.get $cz) (i32.const 1)))
          (br_if $lz (i32.le_s (local.get $cz) (local.get $z1))))))))
