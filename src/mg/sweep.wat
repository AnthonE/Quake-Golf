;; SWEEPER: a round platform over the sea, a post in the middle, and bars at
;; ball height turning round it out past the rim. A bar that meets a ball
;; flings it on round, out and up; a ball hops to let one pass under. One bar
;; at first, another at each of SW_TS (the bars stop for a second and set off
;; the other way), all turning faster as the round goes; from SW_TR0 the
;; platform's outer rings drop one by one. Off the edge and you're out; the
;; last ball on wins.
;;
;; The bars' angle and speed, the bars there are and the platform's rim are
;; functions of the tick into play and the round's seed (in PG_H): $sw_angle,
;; $sw_rim. ground and push work them out on their own bank's tick, so the
;; prediction is exact however far ahead it runs; a bar meeting a ball is the
;; ball's own business (push), and only ball against ball is late.

;; Ticks 0..t-1 of the bars' speed added up (2^-24 turn): SW_S0 a tick, SW_SK more each tick.
(func $sw_f (param $t i32) (result i32)
  (i32.add (i32.mul (local.get $t) (i32.const @SW_S0))
           (i32.mul (i32.shr_u (i32.mul (local.get $t) (i32.sub (local.get $t) (i32.const 1))) (i32.const 1)) (i32.const @SW_SK))))

;; The first bar's angle on tick t into play, on bank d, in 2^-24 turn (the
;; others are quarter turns from it): still through the grace and each pause,
;; turning between, the other way after every pause. i32 arithmetic wraps,
;; and a turn is the low 24 bits.
(func $sw_angle (param $d i32) (param $t i32) (result i32)
  (local $a i32) (local $dir i32) (local $from i32) (local $k i32) (local $tk i32)
  (if (i32.lt_s (local.get $t) (i32.const 0)) (then (local.set $t (i32.const 0))))
  (if (i32.gt_s (local.get $t) (i32.const @SW_TMAX)) (then (local.set $t (i32.const @SW_TMAX))))
  (local.set $a (i32.load offset=@(PG_H + SW_A0) (local.get $d)))
  (local.set $dir (i32.load offset=@(PG_H + SW_DIR) (local.get $d)))
  (if (i32.lt_u (local.get $t) (i32.const @SW_GRACE)) (then (return (local.get $a))))
  (local.set $from (i32.const @SW_GRACE))
  (!for $k (i32.const 0) (i32.const 3)
    (local.set $tk (!tab SW_TS (local.get $k)))
    (if (i32.lt_u (local.get $t) (local.get $tk))
      (then (return (i32.add (local.get $a) (i32.mul (local.get $dir) (i32.sub (call $sw_f (local.get $t)) (call $sw_f (local.get $from))))))))
    (local.set $a (i32.add (local.get $a) (i32.mul (local.get $dir) (i32.sub (call $sw_f (local.get $tk)) (call $sw_f (local.get $from))))))
    (local.set $from (i32.add (local.get $tk) (i32.const @SW_PAUSE)))
    (if (i32.lt_u (local.get $t) (local.get $from)) (then (return (local.get $a))))
    (local.set $dir (i32.sub (i32.const 0) (local.get $dir))))
  (i32.add (local.get $a) (i32.mul (local.get $dir) (i32.sub (call $sw_f (local.get $t)) (call $sw_f (local.get $from))))))

;; The rings dropped by tick t into play.
(func $sw_drops (param $t i32) (result i32)
  (if (i32.lt_s (local.get $t) (i32.const @SW_TR0)) (then (return (i32.const 0))))
  (select (i32.const @SW_RINGS) (local.tee $t (i32.add (i32.div_u (i32.sub (local.get $t) (i32.const @SW_TR0)) (i32.const @SW_TRI)) (i32.const 1)))
          (i32.gt_u (local.get $t) (i32.const @SW_RINGS))))

;; The platform's rim on tick t into play, on bank d: in from its radius at
;; the start to SW_RMIN in SW_RINGS even steps.
(func $sw_rim (param $d i32) (param $t i32) (result f32)
  (local $r0 f32)
  (local.set $r0 (f32.load offset=@(PG_H + SW_RAD) (local.get $d)))
  (f32.sub (local.get $r0) (f32.mul (f32.sub (local.get $r0) (f32.const @SW_RMIN))
                                    (f32.div (f32.convert_i32_u (call $sw_drops (local.get $t))) (f32.const @SW_RINGS)))))

;; Is bar k solid on tick t into play? The first always; bar k from SW_TS[k - 1].
(func $sw_solid (param $k i32) (param $t i32) (result i32)
  (if (result i32) (local.get $k)
    (then (i32.ge_s (local.get $t) (!tab SW_TS (i32.sub (local.get $k) (i32.const 1)))))
    (else (i32.const 1))))

;; The platform for the crowd; a strong hop and good brakes.
(func $sw_setup (param $n i32)
  (local $rad f32) (local $h i32)
  (local.set $rad (f32.min (!madd (f32.sqrt (f32.convert_i32_u (local.get $n))) (f32.const @SW_RK) (f32.const @SW_R0)) (f32.const @SW_RMAX)))
  (!chk (local.get $rad) 57 (local.get $n))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_OUT))
  (i32.store (i32.const @PG_LEN) (i32.const @SW_LEN))
  (f32.store (i32.const @PG_SIZE) (local.get $rad))
  (f32.store (i32.const @PG_HOP) (f32.const @SW_HOP))
  (f32.store (i32.const @PG_IDLE) (f32.const @SW_IDLE))
  (f32.store (i32.const @(PG_H + SW_RAD)) (local.get $rad))
  (local.set $h (call $p_seed (i32.const @SW_KSEED)))
  (i32.store (i32.const @(PG_H + SW_A0)) (i32.and (local.get $h) (i32.const 0xffffff)))
  (i32.store (i32.const @(PG_H + SW_DIR)) (select (i32.const -1) (i32.const 1) (i32.shr_u (local.get $h) (i32.const 31)))))

;; A sunflower spiral over the ring between the post and most of the rim,
;; turned an eighth of a turn off the first bar.
(func $sw_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $a f32) (local $b f32) (local $rho f32) (local $s f32) (local $c f32) (local $cx f32)
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (local.set $a (f32.const @(SW_POST + SW_SPAWN0)))
  (local.set $b (f32.mul (f32.load (i32.const @(PG_H + SW_RAD))) (f32.const @SW_SPAWN1)))
  (local.set $rho (f32.sqrt (!madd (f32.sub (f32.mul (local.get $b) (local.get $b)) (f32.mul (local.get $a) (local.get $a)))
                                   (f32.div (f32.add (f32.convert_i32_u (local.get $i)) (f32.const 0.5))
                                            (f32.convert_i32_u (select (local.get $n) (i32.const 1) (local.get $n))))
                                   (f32.mul (local.get $a) (local.get $a)))))
  (call $sincos (i32.add (i32.add (i32.mul (local.get $i) (i32.const 6258)) (i32.const 2048))
                         (i32.shr_u (i32.load (i32.const @(PG_H + SW_A0))) (i32.const 10))))
  (local.set $c) (local.set $s)
  (!madd (local.get $c) (local.get $rho) (local.get $cx))
  (f32.const @PLAT_Y)
  (!madd (local.get $s) (local.get $rho) (local.get $cx)))

(func $sw_start)

;; The floor's top under (x, z) if it's within the rim on bank d's tick.
(func $sw_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (local $r f32) (local $dx f32) (local $dz f32)
  (if (f32.lt (local.get $y) (f32.const @PLAT_Y)) (then (return (f32.const -1000))))
  (local.set $r (call $sw_rim (local.get $d) (call $p_t (local.get $d))))
  (local.set $dx (f32.sub (local.get $x) (f32.load offset=@PG_CX (local.get $d))))
  (local.set $dz (f32.sub (local.get $z) (f32.load offset=@PG_CX (local.get $d))))
  (if (result f32) (f32.le (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))) (f32.mul (local.get $r) (local.get $r)))
    (then (f32.const @PLAT_Y))
    (else (f32.const -1000))))

;; The post and the bars on ball p, on bank d. Against the post: back out at
;; its side, bouncing off at half the speed it hit. Touching a bar (the ball's
;; centre within its radius plus SW_BW of the bar's axis): out of it along the
;; way from the axis to the centre, what of its velocity goes into the bar
;; (as the bar moves there) taken away; and a ball in front of a moving bar is
;; flung, on round at SW_KICK times the bar's speed there plus SW_KICK0, out
;; and up off the floor.
(func $sw_push (param $p i32) (param $d i32)
  (local $pb i32) (local $fl i32) (local $t i32) (local $a i32) (local $spin i32) (local $k i32) (local $q i32) (local $hits i32)
  (local $px f32) (local $py f32) (local $pz f32) (local $vx f32) (local $vy f32) (local $vz f32)
  (local $r f32) (local $rr f32) (local $cx f32) (local $dx f32) (local $dz f32) (local $d2 f32) (local $hd f32) (local $nx f32) (local $nz f32) (local $vr f32)
  (local $s0 f32) (local $c0 f32) (local $s f32) (local $c f32) (local $len f32) (local $along f32) (local $h f32) (local $dy f32) (local $dist f32)
  (local $nh f32) (local $ny f32) (local $va f32) (local $vh f32) (local $vn f32) (local $u f32) (local $want f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
  (if (i32.and (local.get $fl) (i32.const @(PF_FALL | PF_DEAD))) (then (return)))
  (local.set $t (call $p_t (local.get $d)))
  (local.set $px (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (local.set $py (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
  (local.set $pz (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (local.set $vx (!at f32 @(PLAYERS + P_VX) (local.get $pb)))
  (local.set $vy (!at f32 @(PLAYERS + P_VY) (local.get $pb)))
  (local.set $vz (!at f32 @(PLAYERS + P_VZ) (local.get $pb)))
  (local.set $r (call $b_rad (local.get $pb)))
  (local.set $cx (f32.load offset=@PG_CX (local.get $d)))
  (local.set $dx (f32.sub (local.get $px) (local.get $cx)))
  (local.set $dz (f32.sub (local.get $pz) (local.get $cx)))
  ;; the post
  (local.set $rr (f32.add (local.get $r) (f32.const @SW_POST)))
  (local.set $d2 (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))))
  (if (i32.and (f32.lt (local.get $d2) (f32.mul (local.get $rr) (local.get $rr))) (f32.lt (local.get $py) (f32.const @(+PLAT_Y + SW_POSTH))))
    (then
      (local.set $nx (f32.const 1))
      (local.set $nz (f32.const 0))
      (if (f32.gt (local.get $d2) (f32.const 1e-6))
        (then
          (local.set $hd (f32.sqrt (local.get $d2)))
          (local.set $nx (f32.div (local.get $dx) (local.get $hd)))
          (local.set $nz (f32.div (local.get $dz) (local.get $hd)))))
      (local.set $px (!madd (local.get $nx) (local.get $rr) (local.get $cx)))
      (local.set $pz (!madd (local.get $nz) (local.get $rr) (local.get $cx)))
      (local.set $vr (!madd (local.get $vx) (local.get $nx) (f32.mul (local.get $vz) (local.get $nz))))
      (if (f32.lt (local.get $vr) (f32.const 0))
        (then
          (local.set $vx (f32.sub (local.get $vx) (f32.mul (local.get $nx) (f32.mul (local.get $vr) (f32.const 1.5)))))
          (local.set $vz (f32.sub (local.get $vz) (f32.mul (local.get $nz) (f32.mul (local.get $vr) (f32.const 1.5)))))))
      (local.set $dx (f32.sub (local.get $px) (local.get $cx)))
      (local.set $dz (f32.sub (local.get $pz) (local.get $cx)))))
  ;; the bars: the first's angle and how far it turned this tick, the others a quarter turn or two from it
  (local.set $a (call $sw_angle (local.get $d) (local.get $t)))
  (local.set $spin (i32.sub (local.get $a) (call $sw_angle (local.get $d) (i32.sub (local.get $t) (i32.const 1)))))
  (call $sincos (i32.shr_u (local.get $a) (i32.const 10)))
  (local.set $c0) (local.set $s0)
  (local.set $len (f32.add (call $sw_rim (local.get $d) (local.get $t)) (f32.const @SW_OVER)))
  (local.set $rr (f32.add (local.get $r) (f32.const @SW_BW)))
  (local.set $dy (f32.sub (f32.add (local.get $py) (local.get $r)) (f32.const @(+PLAT_Y + SW_BY))))
  (if (f32.lt (f32.abs (local.get $dy)) (local.get $rr))
    (then
      (!for $k (i32.const 0) (i32.const 4)
        (if (call $sw_solid (local.get $k) (local.get $t))
          (then
            ;; (c, s) turned q quarter turns: (c, s), (-s, c), (-c, -s), (s, -c)
            (local.set $q (!tab SW_QUARTER (local.get $k)))
            (local.set $c (select (local.get $c0) (f32.neg (local.get $s0)) (i32.eqz (i32.and (local.get $q) (i32.const 1)))))
            (local.set $s (select (local.get $s0) (local.get $c0) (i32.eqz (i32.and (local.get $q) (i32.const 1)))))
            (if (i32.ge_u (local.get $q) (i32.const 2))
              (then (local.set $c (f32.neg (local.get $c))) (local.set $s (f32.neg (local.get $s)))))
            ;; along the bar from the post, and across it (+ the way it turns when it turns x towards z)
            (local.set $along (!madd (local.get $dx) (local.get $c) (f32.mul (local.get $dz) (local.get $s))))
            (local.set $h (f32.sub (f32.mul (local.get $dz) (local.get $c)) (f32.mul (local.get $dx) (local.get $s))))
            (if (i32.and (i32.and (f32.gt (local.get $along) (f32.const 0)) (f32.lt (local.get $along) (local.get $len)))
                         (f32.lt (!madd (local.get $h) (local.get $h) (f32.mul (local.get $dy) (local.get $dy))) (f32.mul (local.get $rr) (local.get $rr))))
              (then
                ;; dead on the axis: out on the side it's coming from (or +)
                (if (f32.lt (f32.abs (local.get $h)) (f32.const 1e-3))
                  (then (local.set $h (select (f32.const -1e-3) (f32.const 1e-3) (i32.lt_s (local.get $spin) (i32.const 0))))))
                ;; the way out of the bar, across and up, and the centre put that far out along it
                (local.set $dist (f32.sqrt (!madd (local.get $h) (local.get $h) (f32.mul (local.get $dy) (local.get $dy)))))
                (local.set $nh (f32.div (local.get $h) (local.get $dist)))
                (local.set $ny (f32.div (local.get $dy) (local.get $dist)))
                (local.set $h (f32.mul (local.get $nh) (f32.add (local.get $rr) (f32.const 0.01))))
                (local.set $dy (f32.mul (local.get $ny) (f32.add (local.get $rr) (f32.const 0.01))))
                (local.set $px (f32.sub (!madd (local.get $c) (local.get $along) (local.get $cx)) (f32.mul (local.get $s) (local.get $h))))
                (local.set $pz (!madd (local.get $c) (local.get $h) (!madd (local.get $s) (local.get $along) (local.get $cx))))
                (local.set $py (f32.sub (f32.add (local.get $dy) (f32.const @(+PLAT_Y + SW_BY))) (local.get $r)))
                (local.set $dx (f32.sub (local.get $px) (local.get $cx)))
                (local.set $dz (f32.sub (local.get $pz) (local.get $cx)))
                (local.set $fl (i32.and (local.get $fl) (i32.const @(255 ^ PF_GROUND))))
                ;; the velocity along the bar and across it, and what of it goes into the bar (moving at u there) taken
                ;; away: a ball on a still bar rolls off it, one behind a moving bar can't catch it
                (local.set $va (!madd (local.get $vx) (local.get $c) (f32.mul (local.get $vz) (local.get $s))))
                (local.set $vh (f32.sub (f32.mul (local.get $vz) (local.get $c)) (f32.mul (local.get $vx) (local.get $s))))
                (local.set $u (f32.mul (f32.mul (f32.convert_i32_s (local.get $spin)) (f32.const @SW_RAD_TICK)) (local.get $along)))
                (local.set $vn (!madd (f32.sub (local.get $vh) (local.get $u)) (local.get $nh) (f32.mul (local.get $vy) (local.get $ny))))
                (if (f32.lt (local.get $vn) (f32.const 0))
                  (then
                    (local.set $vh (f32.sub (local.get $vh) (f32.mul (local.get $vn) (local.get $nh))))
                    (local.set $vy (f32.sub (local.get $vy) (f32.mul (local.get $vn) (local.get $ny))))))
                ;; in front of a moving bar: flung
                (if (f32.gt (f32.mul (local.get $h) (local.get $u)) (f32.const 0))
                  (then
                    (local.set $want (f32.min (!madd (f32.abs (local.get $u)) (f32.const @SW_KICK) (f32.const @SW_KICK0)) (f32.const @SW_VMAX)))
                    (local.set $vh (select (f32.max (local.get $vh) (local.get $want)) (f32.min (local.get $vh) (f32.neg (local.get $want))) (f32.gt (local.get $h) (f32.const 0))))
                    (local.set $va (f32.add (local.get $va) (f32.const @SW_OUT)))
                    (local.set $vy (f32.max (local.get $vy) (f32.const @SW_UP)))
                    (local.set $hits (i32.add (local.get $hits) (i32.const 1)))
                    (call $fx (local.get $d) (i32.const @SW_FX_HIT) (local.get $p) (local.get $k) (local.get $px) (local.get $py) (local.get $pz) (local.get $want))))
                (local.set $vx (f32.sub (f32.mul (local.get $va) (local.get $c)) (f32.mul (local.get $vh) (local.get $s))))
                (local.set $vz (!madd (local.get $va) (local.get $s) (f32.mul (local.get $vh) (local.get $c)))))))))))
  (!chk (local.get $px) 51 (local.get $p))
  (!chk (local.get $py) 52 (local.get $p))
  (!chk (local.get $pz) 53 (local.get $p))
  (!chk (local.get $vx) 54 (local.get $p))
  (!chk (local.get $vy) 55 (local.get $p))
  (!chk (local.get $vz) 56 (local.get $p))
  (!put f32 @(PLAYERS + P_PX) (local.get $pb) (local.get $px))
  (!put f32 @(PLAYERS + P_PY) (local.get $pb) (local.get $py))
  (!put f32 @(PLAYERS + P_PZ) (local.get $pb) (local.get $pz))
  (!put f32 @(PLAYERS + P_VX) (local.get $pb) (local.get $vx))
  (!put f32 @(PLAYERS + P_VY) (local.get $pb) (local.get $vy))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (local.get $vz))
  (!put u8 @(PLAYERS + P_FL) (local.get $pb) (local.get $fl))
  (if (local.get $hits)
    (then (!put i32 @(PLAYERS + PG_M) (local.get $pb) (i32.add (!at i32 @(PLAYERS + PG_M) (local.get $pb)) (local.get $hits))))))

;; The schedule's moments as FX, at the centre: the bars setting off (after
;; the grace and each pause), a bar coming, a ring shaking and going.
(func $sw_tick
  (local $t i32) (local $k i32) (local $tk i32) (local $cx f32)
  (local.set $t (call $p_t (i32.const 0)))
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (if (i32.eq (local.get $t) (i32.const @SW_GRACE))
    (then (call $fx (i32.const 0) (i32.const @SW_FX_GO) (i32.const 255) (i32.const 1) (local.get $cx) (f32.const @PLAT_Y) (local.get $cx)
                    (call $sw_speed (local.get $t)))))
  (!for $k (i32.const 0) (i32.const 3)
    (local.set $tk (!tab SW_TS (local.get $k)))
    (if (i32.eq (local.get $t) (i32.sub (local.get $tk) (i32.const @SW_WARN)))
      (then (call $fx (i32.const 0) (i32.const @SW_FX_BEAM) (i32.const 255) (i32.add (local.get $k) (i32.const 1)) (local.get $cx) (f32.const @PLAT_Y) (local.get $cx)
                      (f32.const @(SW_WARN + SW_PAUSE)))))
    (if (i32.eq (local.get $t) (i32.add (local.get $tk) (i32.const @SW_PAUSE)))
      (then (call $fx (i32.const 0) (i32.const @SW_FX_GO) (i32.const 255) (i32.or (i32.add (local.get $k) (i32.const 2)) (i32.const 16))
                      (local.get $cx) (f32.const @PLAT_Y) (local.get $cx) (call $sw_speed (local.get $t))))))
  (!for $k (i32.const 0) (i32.const @SW_RINGS)
    (local.set $tk (i32.add (i32.const @SW_TR0) (i32.mul (local.get $k) (i32.const @SW_TRI))))
    (if (i32.or (i32.eq (local.get $t) (local.get $tk)) (i32.eq (local.get $t) (i32.sub (local.get $tk) (i32.const @SW_RWARN))))
      (then (call $fx (i32.const 0) (i32.const @SW_FX_RING) (i32.const 255) (i32.eq (local.get $t) (local.get $tk)) (local.get $cx) (f32.const @PLAT_Y) (local.get $cx)
                      (call $sw_rim (i32.const 0) (local.get $tk)))))))

;; How fast the bars turn on tick t into play, rad/s (0 while they're still).
(func $sw_speed (param $t i32) (result f32)
  (f32.mul (f32.convert_i32_s (i32.sub (call $sw_angle (i32.const 0) (i32.add (local.get $t) (i32.const 1))) (call $sw_angle (i32.const 0) (local.get $t))))
           (f32.const @SW_RAD_TICK)))

;; Two or more still on and every one of them falling: over now, and they
;; share the win rather than all sharing last.
(func $sw_over (result i32)
  (local $p i32)
  (if (i32.lt_u (i32.load (i32.const @BH_LEFT)) (i32.const 2)) (then (return (i32.const 0))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (if (call $p_in (i32.shl (local.get $p) (i32.const 6))) (then (return (i32.const 0)))))
  (i32.const 1))

(func $sw_out (param $p i32))
