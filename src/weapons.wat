;; Rockets and grenades, the only clubs. Serial, by projectile slot, after
;; the players move. A blast changes velocities only, so the grid built at
;; the start of the tick stays valid for every later lookup in it.

;; One record on the FX ring of bank d: the confirmed ring, or the prediction's
;; own. The count is stored last, atomically, so a reader that sees it sees the record.
(func $fx (param $d i32) (param $kind i32) (param $owner i32) (param $shot i32) (param $x f32) (param $y f32) (param $z f32) (param $size f32)
  (local $ring i32) (local $n i32) (local $r i32)
  (local.set $ring (select (i32.const @PFX) (i32.const @FX) (local.get $d)))
  (local.set $n (i32.load (local.get $ring)))
  (local.set $r (i32.add (i32.add (local.get $ring) (i32.const 16)) (i32.shl (i32.and (local.get $n) (i32.const @(FX_MAX - 1))) (i32.const 5))))
  (i32.store (local.get $r) (i32.load offset=@HDR_TICK (local.get $d)))
  (i32.store8 offset=4 (local.get $r) (local.get $kind))
  (i32.store8 offset=5 (local.get $r) (local.get $owner))
  (i32.store16 offset=6 (local.get $r) (local.get $shot))
  (f32.store offset=8 (local.get $r) (local.get $x))
  (f32.store offset=12 (local.get $r) (local.get $y))
  (f32.store offset=16 (local.get $r) (local.get $z))
  (f32.store offset=20 (local.get $r) (local.get $size))
  (i32.atomic.store (local.get $ring) (i32.add (local.get $n) (i32.const 1))))

;; Launches a projectile from the eye of slot p along its view, in bank d; u is
;; pitch in yaw units (1/16384 turn), s and c the yaw's sine and cosine.
(func $fire (param $p i32) (param $d i32) (param $wpn i32) (param $s f32) (param $c f32) (param $u i32)
  (local $pb i32) (local $j i32) (local $jb i32) (local $sp f32) (local $cp f32)
  (local $fx f32) (local $fy f32) (local $fz f32) (local $ex f32) (local $ey f32) (local $ez f32) (local $v f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (local.set $j (i32.const 0))
  (block $found
    (loop $find
      (br_if $found (i32.eqz (!at u8 @(PROJ + J_KIND) (i32.add (i32.shl (local.get $j) (i32.const 5)) (local.get $d)))))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br_if $find (i32.lt_u (local.get $j) (i32.const @NPROJ)))
      (return)))
  (local.set $jb (i32.add (i32.shl (local.get $j) (i32.const 5)) (local.get $d)))
  (call $sincos (local.get $u))
  (local.set $cp) (local.set $sp)
  (local.set $fx (f32.mul (local.get $cp) (local.get $c)))
  (local.set $fy (local.get $sp))
  (local.set $fz (f32.mul (local.get $cp) (local.get $s)))
  (local.set $ex (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (local.set $ey (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (f32.const @P_EYE)))
  (local.set $ez (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (local.set $v (select (f32.const @GREN_V) (f32.const @ROCKET_V) (local.get $wpn)))
  (!put f32 @(PROJ + J_PX) (local.get $jb) (!madd (local.get $fx) (f32.const 0.5) (local.get $ex)))
  (!put f32 @(PROJ + J_PY) (local.get $jb) (!madd (local.get $fy) (f32.const 0.5) (local.get $ey)))
  (!put f32 @(PROJ + J_PZ) (local.get $jb) (!madd (local.get $fz) (f32.const 0.5) (local.get $ez)))
  (!put f32 @(PROJ + J_VX) (local.get $jb) (f32.mul (local.get $fx) (local.get $v)))
  (!put f32 @(PROJ + J_VY) (local.get $jb) (f32.add (f32.mul (local.get $fy) (local.get $v))
                                                    (select (f32.const @GREN_UP) (f32.const 0) (local.get $wpn))))
  (!put f32 @(PROJ + J_VZ) (local.get $jb) (f32.mul (local.get $fz) (local.get $v)))
  (!put u16 @(PROJ + J_AGE) (local.get $jb) (i32.const 0))
  (!put u8 @(PROJ + J_KIND) (local.get $jb) (select (i32.const @K_GRENADE) (i32.const @K_ROCKET) (local.get $wpn)))
  (!put u8 @(PROJ + J_OWNER) (local.get $jb) (local.get $p))
  (!put u16 @(PROJ + J_SHOT) (local.get $jb) (!at u16 @(PLAYERS + P_SHOTS) (local.get $pb)))
  (call $fx (local.get $d) (i32.const @FX_SHOT) (local.get $p) (!at u16 @(PLAYERS + P_SHOTS) (local.get $pb))
            (local.get $ex) (local.get $ey) (local.get $ez) (f32.convert_i32_u (local.get $wpn))))

;; The first ball, in grid order, whose centre is within d of (x, y, z), or
;; -1. d must not pass one cell (0.4 m), so the 27 neighbours cover it.
(func $hit_ball (param $x f32) (param $y f32) (param $z f32) (param $d f32) (result i32)
  (local $cx i32) (local $cy i32) (local $cz i32) (local $ox i32) (local $oy i32) (local $oz i32)
  (local $b i32) (local $s i32) (local $j i32) (local $dx f32) (local $dy f32) (local $dz f32) (local $d2 f32)
  (local.set $d2 (f32.mul (local.get $d) (local.get $d)))
  (call $cell (local.get $x) (local.get $y) (local.get $z))
  (local.set $cz) (local.set $cy) (local.set $cx)
  (local.set $oz (i32.const -1))
  (loop $lz
    (local.set $oy (i32.const -1))
    (loop $ly
      (local.set $ox (i32.const -1))
      (loop $lx
        (local.set $b (call $bucket (i32.add (local.get $cx) (local.get $ox)) (i32.add (local.get $cy) (local.get $oy)) (i32.add (local.get $cz) (local.get $oz))))
        (local.set $s (!ld u16 @HEAD (local.get $b)))
        (block $done
          (loop $scan
            (br_if $done (i32.eq (local.get $s) (i32.const 0xffff)))
            (local.set $j (local.get $s))
            (local.set $s (!ld u16 @NEXT (local.get $j)))
            (local.set $dx (f32.sub (!ld f32 @PX (local.get $j)) (local.get $x)))
            (local.set $dy (f32.sub (!ld f32 @PY (local.get $j)) (local.get $y)))
            (local.set $dz (f32.sub (!ld f32 @PZ (local.get $j)) (local.get $z)))
            (if (f32.lt (!dot3 (local.get $dx) (local.get $dy) (local.get $dz) (local.get $dx) (local.get $dy) (local.get $dz)) (local.get $d2))
              (then (return (local.get $j))))
            (br $scan)))
        (local.set $ox (i32.add (local.get $ox) (i32.const 1)))
        (br_if $lx (i32.le_s (local.get $ox) (i32.const 1))))
      (local.set $oy (i32.add (local.get $oy) (i32.const 1)))
      (br_if $ly (i32.le_s (local.get $oy) (i32.const 1))))
    (local.set $oz (i32.add (local.get $oz) (i32.const 1)))
    (br_if $lz (i32.le_s (local.get $oz) (i32.const 1))))
  (i32.const -1))

;; The first live player other than `skip` whose body (a cylinder of radius
;; P_R from the feet to P_TOP) is within r of the point, or -1.
(func $hit_player (param $x f32) (param $y f32) (param $z f32) (param $r f32) (param $skip i32) (result i32)
  (local $p i32) (local $pb i32) (local $dx f32) (local $dz f32) (local $py f32) (local $rr f32)
  (local.set $rr (f32.add (f32.const @P_R) (local.get $r)))
  (local.set $rr (f32.mul (local.get $rr) (local.get $rr)))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (if (i32.and (i32.eq (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE)) (i32.ne (local.get $p) (local.get $skip)))
      (then
        (local.set $py (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
        (local.set $dx (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (local.get $x)))
        (local.set $dz (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $pb)) (local.get $z)))
        (if (i32.and (f32.lt (f32.add (f32.mul (local.get $dx) (local.get $dx)) (f32.mul (local.get $dz) (local.get $dz))) (local.get $rr))
                     (i32.and (f32.gt (local.get $y) (f32.sub (local.get $py) (local.get $r)))
                              (f32.lt (local.get $y) (f32.add (f32.add (local.get $py) (f32.const @P_TOP)) (local.get $r)))))
          (then (return (local.get $p)))))))
  (i32.const -1))

;; Knockback on every live player of bank b from a blast at (x, y, z), pushing
;; from the blast to the middle of the body, so one at your feet lifts you: a rocket jump.
(func $blast_players (param $b i32) (param $x f32) (param $y f32) (param $z f32) (param $s f32) (param $r f32)
  (local $p i32) (local $pb i32) (local $dx f32) (local $dy f32) (local $dz f32) (local $d2 f32) (local $d f32) (local $f f32) (local $vy f32)
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $b)))
    (if (i32.eq (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE))
      (then
        (local.set $dx (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (local.get $x)))
        (local.set $dy (f32.sub (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (f32.const 0.9)) (local.get $y)))
        (local.set $dz (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $pb)) (local.get $z)))
        (local.set $d2 (!dot3 (local.get $dx) (local.get $dy) (local.get $dz) (local.get $dx) (local.get $dy) (local.get $dz)))
#if ARENA
        ;; not through a wall
        (if (i32.and (f32.lt (local.get $d2) (f32.mul (local.get $r) (local.get $r)))
                     (call $clear (local.get $x) (local.get $y) (local.get $z) (f32.add (local.get $x) (local.get $dx)) (f32.add (local.get $y) (local.get $dy)) (f32.add (local.get $z) (local.get $dz))))
#else
        (if (f32.lt (local.get $d2) (f32.mul (local.get $r) (local.get $r)))
#endif
          (then
            (local.set $d (f32.sqrt (f32.max (local.get $d2) (f32.const 1e-6))))
            (local.set $f (f32.div (f32.mul (f32.sub (f32.const 1) (f32.div (local.get $d) (local.get $r))) (local.get $s)) (local.get $d)))
            (!put f32 @(PLAYERS + P_VX) (local.get $pb) (!madd (local.get $dx) (local.get $f) (!at f32 @(PLAYERS + P_VX) (local.get $pb))))
            (local.set $vy (!madd (local.get $dy) (local.get $f) (!at f32 @(PLAYERS + P_VY) (local.get $pb))))
            (!put f32 @(PLAYERS + P_VY) (local.get $pb) (local.get $vy))
            (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (!madd (local.get $dz) (local.get $f) (!at f32 @(PLAYERS + P_VZ) (local.get $pb))))
            (if (f32.gt (local.get $vy) (f32.const 1))
              (then (!put u8 @(PLAYERS + P_FL) (local.get $pb)
                      (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @(255 ^ PF_GROUND))))))))))))

;; Projectile jb (in bank d) goes off at (x, y, z) and its slot is freed. A
;; predicted blast moves only the prediction's players: never a confirmed ball.
(func $explode (param $jb i32) (param $d i32) (param $x f32) (param $y f32) (param $z f32)
  (local $rocket i32) (local $s f32) (local $r f32)
  (local.set $rocket (i32.eq (!at u8 @(PROJ + J_KIND) (local.get $jb)) (i32.const @K_ROCKET)))
  (local.set $s (select (f32.const @ROCKET_S) (f32.const @GREN_S) (local.get $rocket)))
  (local.set $r (select (f32.const @ROCKET_RAD) (f32.const @GREN_RAD) (local.get $rocket)))
#if ARENA
  ;; the arena's blasts hurt: a rocket 230 at its centre over 5 m, a frag 150
  (local.set $r (f32.const 5))
  (if (i32.eqz (local.get $d))
    (then (call $a_splash (local.get $x) (local.get $y) (local.get $z)
                          (select (f32.const @(ARMS[W_ROCKET].dmg)) (f32.const @GREN_DMG) (local.get $rocket)) (local.get $r)
                          (!at u8 @(PROJ + J_OWNER) (local.get $jb)) (select (i32.const @W_ROCKET) (i32.const @KILL_GREN) (local.get $rocket)))))
#else
  (if (i32.eqz (local.get $d)) (then (call $blast (local.get $x) (local.get $y) (local.get $z) (local.get $s) (local.get $r))))
#endif
  (call $blast_players (local.get $d) (local.get $x) (local.get $y) (local.get $z) (f32.mul (local.get $s) (f32.const @KNOCK)) (local.get $r))
  (call $fx (local.get $d) (i32.const @FX_BLAST) (!at u8 @(PROJ + J_OWNER) (local.get $jb)) (!at u16 @(PROJ + J_SHOT) (local.get $jb))
            (local.get $x) (local.get $y) (local.get $z) (local.get $r))
  (memory.fill (i32.add (i32.const @PROJ) (local.get $jb)) (i32.const 0) (i32.const @JSIZE)))

;; Every projectile of bank d, or only those of slot `only` when it isn't -1.
(func $projectiles (param $d i32) (param $only i32)
  (local $j i32) (local $jb i32) (local $kind i32)
  (!for $j (i32.const 0) (i32.const @NPROJ)
    (local.set $jb (i32.add (i32.shl (local.get $j) (i32.const 5)) (local.get $d)))
    (local.set $kind (!at u8 @(PROJ + J_KIND) (local.get $jb)))
    (if (i32.and (i32.ne (local.get $kind) (i32.const 0))
                 (i32.or (i32.lt_s (local.get $only) (i32.const 0)) (i32.eq (!at u8 @(PROJ + J_OWNER) (local.get $jb)) (local.get $only))))
      (then (block $skip
        (!put u16 @(PROJ + J_AGE) (local.get $jb) (i32.add (!at u16 @(PROJ + J_AGE) (local.get $jb)) (i32.const 1)))
#if ARENA
        (if (i32.ge_u (local.get $kind) (i32.const @K_BOLT)) (then (call $a_bolt (local.get $jb) (local.get $d)) (br $skip)))
#endif
        (if (i32.eq (local.get $kind) (i32.const @K_ROCKET))
          (then (call $rocket (local.get $jb) (local.get $d)))
          (else (call $grenade (local.get $jb) (local.get $d)))))))))

;; Rockets fly straight in two half steps a tick (16 cm at 40 m/s), so they
;; can't pass through the ground, a ball or a body; the owner's own is never hit.
(func $rocket (param $jb i32) (param $d i32)
  (local $px f32) (local $py f32) (local $pz f32) (local $vx f32) (local $vy f32) (local $vz f32) (local $h f32) (local $k i32)
  (local.set $px (!at f32 @(PROJ + J_PX) (local.get $jb)))
  (local.set $py (!at f32 @(PROJ + J_PY) (local.get $jb)))
  (local.set $pz (!at f32 @(PROJ + J_PZ) (local.get $jb)))
  (local.set $vx (!at f32 @(PROJ + J_VX) (local.get $jb)))
  (local.set $vy (!at f32 @(PROJ + J_VY) (local.get $jb)))
  (local.set $vz (!at f32 @(PROJ + J_VZ) (local.get $jb)))
  (!for $k (i32.const 0) (i32.const 2)
#if ARENA
    ;; into a box: it goes off where it was, outside it
    (if (call $box_in (!madd (local.get $vx) (f32.const 0.004) (local.get $px)) (!madd (local.get $vy) (f32.const 0.004) (local.get $py))
                      (!madd (local.get $vz) (f32.const 0.004) (local.get $pz)) (f32.const 0))
      (then (call $explode (local.get $jb) (local.get $d) (local.get $px) (local.get $py) (local.get $pz)) (return)))
#endif
    (local.set $px (!madd (local.get $vx) (f32.const 0.004) (local.get $px)))
    (local.set $py (!madd (local.get $vy) (f32.const 0.004) (local.get $py)))
    (local.set $pz (!madd (local.get $vz) (f32.const 0.004) (local.get $pz)))
    (if (i32.or (i32.or (f32.lt (local.get $px) (f32.const 0)) (f32.gt (local.get $px) (f32.const @WORLD)))
                (i32.or (i32.or (f32.lt (local.get $pz) (f32.const 0)) (f32.gt (local.get $pz) (f32.const @WORLD)))
                        (f32.gt (local.get $py) (f32.const @CEIL))))
      (then (memory.fill (i32.add (i32.const @PROJ) (local.get $jb)) (i32.const 0) (i32.const @JSIZE)) (return)))
    (call $ground (local.get $px) (local.get $pz))
    (drop) (drop) (drop) (drop)
    (local.set $h)
    (if (f32.le (local.get $py) (local.get $h))
      (then (call $explode (local.get $jb) (local.get $d) (local.get $px) (local.get $h) (local.get $pz)) (return)))
    (if (i32.ge_s (call $hit_ball (local.get $px) (local.get $py) (local.get $pz) (f32.const @ROCKET_HIT)) (i32.const 0))
      (then (call $explode (local.get $jb) (local.get $d) (local.get $px) (local.get $py) (local.get $pz)) (return)))
    (if (i32.ge_s (call $hit_player (local.get $px) (local.get $py) (local.get $pz) (f32.const 0.1) (!at u8 @(PROJ + J_OWNER) (local.get $jb))) (i32.const 0))
      (then (call $explode (local.get $jb) (local.get $d) (local.get $px) (local.get $py) (local.get $pz)) (return))))
  (!put f32 @(PROJ + J_PX) (local.get $jb) (local.get $px))
  (!put f32 @(PROJ + J_PY) (local.get $jb) (local.get $py))
  (!put f32 @(PROJ + J_PZ) (local.get $jb) (local.get $pz))
  (if (i32.gt_u (!at u16 @(PROJ + J_AGE) (local.get $jb)) (i32.const @ROCKET_LIFE))
    (then (memory.fill (i32.add (i32.const @PROJ) (local.get $jb)) (i32.const 0) (i32.const @JSIZE)))))

;; Grenades fall, bounce off the ground (keeping 40% of the hit, losing a
;; tenth of their roll each tick in contact) and off balls, and go off on
;; their fuse or on touching someone else.
(func $grenade (param $jb i32) (param $d i32)
  (local $px f32) (local $py f32) (local $pz f32) (local $vx f32) (local $vy f32) (local $vz f32)
  (local $h f32) (local $nx f32) (local $ny f32) (local $nz f32) (local $vn f32) (local $b i32) (local $dist f32) (local $surf i32)
#if ARENA
  (local $ox f32) (local $oy f32) (local $oz f32)
#endif
  (local.set $px (!at f32 @(PROJ + J_PX) (local.get $jb)))
  (local.set $py (!at f32 @(PROJ + J_PY) (local.get $jb)))
  (local.set $pz (!at f32 @(PROJ + J_PZ) (local.get $jb)))
  (local.set $vx (!at f32 @(PROJ + J_VX) (local.get $jb)))
  (local.set $vy (f32.sub (!at f32 @(PROJ + J_VY) (local.get $jb)) (f32.const @G_DT)))
  (local.set $vz (!at f32 @(PROJ + J_VZ) (local.get $jb)))
  (local.set $px (!madd (local.get $vx) (f32.const @DT) (local.get $px)))
  (local.set $py (!madd (local.get $vy) (f32.const @DT) (local.get $py)))
  (local.set $pz (!madd (local.get $vz) (f32.const @DT) (local.get $pz)))
  (if (f32.lt (local.get $px) (f32.const @LO)) (then (local.set $px (f32.const @LO)) (local.set $vx (f32.abs (local.get $vx)))))
  (if (f32.gt (local.get $px) (f32.const @HI)) (then (local.set $px (f32.const @HI)) (local.set $vx (f32.neg (f32.abs (local.get $vx))))))
  (if (f32.lt (local.get $pz) (f32.const @LO)) (then (local.set $pz (f32.const @LO)) (local.set $vz (f32.abs (local.get $vz)))))
  (if (f32.gt (local.get $pz) (f32.const @HI)) (then (local.set $pz (f32.const @HI)) (local.set $vz (f32.neg (f32.abs (local.get $vz))))))
  (if (f32.gt (local.get $py) (f32.const @CEIL)) (then (local.set $py (f32.const @CEIL)) (local.set $vy (f32.min (local.get $vy) (f32.const 0)))))
#if ARENA
  ;; off a box: back on the side it came from, the speed across that face
  ;; turned and kept at 40%, along it at 90%
  (local.set $b (call $box_in (local.get $px) (local.get $py) (local.get $pz) (f32.const @GREN_R)))
  (if (local.get $b)
    (then
      (local.set $ox (!at f32 @(PROJ + J_PX) (local.get $jb)))
      (local.set $oy (!at f32 @(PROJ + J_PY) (local.get $jb)))
      (local.set $oz (!at f32 @(PROJ + J_PZ) (local.get $jb)))
      (if (i32.or (f32.le (local.get $ox) (f32.sub (f32.load (local.get $b)) (f32.const @GREN_R)))
                  (f32.ge (local.get $ox) (f32.add (f32.load offset=12 (local.get $b)) (f32.const @GREN_R))))
        (then (local.set $px (local.get $ox)) (local.set $vx (f32.mul (local.get $vx) (f32.const -0.4)))
              (local.set $vy (f32.mul (local.get $vy) (f32.const 0.9))) (local.set $vz (f32.mul (local.get $vz) (f32.const 0.9))))
        (else
          (if (i32.or (f32.le (local.get $oz) (f32.sub (f32.load offset=8 (local.get $b)) (f32.const @GREN_R)))
                      (f32.ge (local.get $oz) (f32.add (f32.load offset=20 (local.get $b)) (f32.const @GREN_R))))
            (then (local.set $pz (local.get $oz)) (local.set $vz (f32.mul (local.get $vz) (f32.const -0.4)))
                  (local.set $vx (f32.mul (local.get $vx) (f32.const 0.9))) (local.set $vy (f32.mul (local.get $vy) (f32.const 0.9))))
            (else
              ;; a top or an underside (or it was already in): out the nearer
              (local.set $py (select (f32.add (f32.load offset=16 (local.get $b)) (f32.const @GREN_R)) (f32.sub (f32.load offset=4 (local.get $b)) (f32.const @GREN_R))
                                     (f32.ge (local.get $oy) (f32.mul (f32.add (f32.load offset=4 (local.get $b)) (f32.load offset=16 (local.get $b))) (f32.const 0.5)))))
              (local.set $vy (f32.mul (local.get $vy) (f32.const -0.4)))
              (local.set $vx (f32.mul (local.get $vx) (f32.const 0.9))) (local.set $vz (f32.mul (local.get $vz) (f32.const 0.9)))))))))
#endif
  (call $ground (local.get $px) (local.get $pz))
  (local.set $surf) (local.set $nz) (local.set $ny) (local.set $nx) (local.set $h)
  (if (f32.lt (local.get $py) (f32.add (local.get $h) (f32.const @GREN_R)))
    (then
      (local.set $py (f32.add (local.get $h) (f32.const @GREN_R)))
      (local.set $vn (!dot3 (local.get $vx) (local.get $vy) (local.get $vz) (local.get $nx) (local.get $ny) (local.get $nz)))
      (if (f32.lt (local.get $vn) (f32.const 0))
        (then
          (local.set $vx (f32.sub (local.get $vx) (f32.mul (local.get $nx) (f32.mul (local.get $vn) (f32.const 1.4)))))
          (local.set $vy (f32.sub (local.get $vy) (f32.mul (local.get $ny) (f32.mul (local.get $vn) (f32.const 1.4)))))
          (local.set $vz (f32.sub (local.get $vz) (f32.mul (local.get $nz) (f32.mul (local.get $vn) (f32.const 1.4)))))))
      (local.set $vn (!dot3 (local.get $vx) (local.get $vy) (local.get $vz) (local.get $nx) (local.get $ny) (local.get $nz)))
      (local.set $vx (!madd (f32.sub (local.get $vx) (f32.mul (local.get $nx) (local.get $vn))) (f32.const 0.9) (f32.mul (local.get $nx) (local.get $vn))))
      (local.set $vy (!madd (f32.sub (local.get $vy) (f32.mul (local.get $ny) (local.get $vn))) (f32.const 0.9) (f32.mul (local.get $ny) (local.get $vn))))
      (local.set $vz (!madd (f32.sub (local.get $vz) (f32.mul (local.get $nz) (local.get $vn))) (f32.const 0.9) (f32.mul (local.get $nz) (local.get $vn))))))
  (local.set $b (call $hit_ball (local.get $px) (local.get $py) (local.get $pz) (f32.const @GREN_HIT)))
  (if (i32.ge_s (local.get $b) (i32.const 0))
    (then
      (local.set $nx (f32.sub (local.get $px) (!ld f32 @PX (local.get $b))))
      (local.set $ny (f32.sub (local.get $py) (!ld f32 @PY (local.get $b))))
      (local.set $nz (f32.sub (local.get $pz) (!ld f32 @PZ (local.get $b))))
      (local.set $dist (f32.sqrt (f32.max (!dot3 (local.get $nx) (local.get $ny) (local.get $nz) (local.get $nx) (local.get $ny) (local.get $nz)) (f32.const 1e-6))))
      (local.set $nx (f32.div (local.get $nx) (local.get $dist)))
      (local.set $ny (f32.div (local.get $ny) (local.get $dist)))
      (local.set $nz (f32.div (local.get $nz) (local.get $dist)))
      (local.set $vn (!dot3 (local.get $vx) (local.get $vy) (local.get $vz) (local.get $nx) (local.get $ny) (local.get $nz)))
      (if (f32.lt (local.get $vn) (f32.const 0))
        (then
          (local.set $vx (f32.sub (local.get $vx) (f32.mul (local.get $nx) (f32.mul (local.get $vn) (f32.const 1.5)))))
          (local.set $vy (f32.sub (local.get $vy) (f32.mul (local.get $ny) (f32.mul (local.get $vn) (f32.const 1.5)))))
          (local.set $vz (f32.sub (local.get $vz) (f32.mul (local.get $nz) (f32.mul (local.get $vn) (f32.const 1.5)))))))
      (local.set $px (!madd (local.get $nx) (f32.const @GREN_HIT) (!ld f32 @PX (local.get $b))))
      (local.set $py (!madd (local.get $ny) (f32.const @GREN_HIT) (!ld f32 @PY (local.get $b))))
      (local.set $pz (!madd (local.get $nz) (f32.const @GREN_HIT) (!ld f32 @PZ (local.get $b))))))
  (!chk (local.get $px) 21 (local.get $jb))
  (!chk (local.get $py) 22 (local.get $jb))
  (!chk (local.get $pz) 23 (local.get $jb))
  (!chk (local.get $vx) 24 (local.get $jb))
  (!chk (local.get $vy) 25 (local.get $jb))
  (!chk (local.get $vz) 26 (local.get $jb))
#if ARENA
  ;; a frag goes off on its fuse only
  (if (i32.ge_u (!at u16 @(PROJ + J_AGE) (local.get $jb)) (i32.const @A_FUSE))
#else
  (if (i32.or (i32.ge_u (!at u16 @(PROJ + J_AGE) (local.get $jb)) (i32.const @FUSE))
              (i32.ge_s (call $hit_player (local.get $px) (local.get $py) (local.get $pz) (f32.const @GREN_R) (!at u8 @(PROJ + J_OWNER) (local.get $jb))) (i32.const 0)))
#endif
    (then (call $explode (local.get $jb) (local.get $d) (local.get $px) (local.get $py) (local.get $pz)) (return)))
  (!put f32 @(PROJ + J_PX) (local.get $jb) (local.get $px))
  (!put f32 @(PROJ + J_PY) (local.get $jb) (local.get $py))
  (!put f32 @(PROJ + J_PZ) (local.get $jb) (local.get $pz))
  (!put f32 @(PROJ + J_VX) (local.get $jb) (local.get $vx))
  (!put f32 @(PROJ + J_VY) (local.get $jb) (local.get $vy))
  (!put f32 @(PROJ + J_VZ) (local.get $jb) (local.get $vz)))
