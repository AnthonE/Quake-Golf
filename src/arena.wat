;; The arena: a deathmatch on the golf engine, built when ARENA is set
;; (build/arena/game.wasm). Fighters carry two guns, frag grenades and a
;; melee; shields soak damage and come back after five quiet seconds, health
;; under them comes back once they're full. Hitscan shots are checked where
;; the shooter saw their targets: each fighter's input word carries its view
;; lag a bit a tick, and every fighter's position after each of the last 32
;; ticks is kept in HIST. Everything here runs serially, by slot, in the
;; same order on every machine, so a match is as deterministic as a hole.
;;
;; Code that $move reaches runs on either bank d (0 the confirmed world,
;; PRED_D the prediction); damage, kills, pickups and spawns happen only on
;; the confirmed world, so the prediction never writes outside PRED.

;; ---- the map: a gulch along x, walled on both sides and both ends, a base
;; at each end on a raised pad, rocks for cover. Runs once at init, after
;; $terrain_gen. The noise keeps a fifth of its relief inside.
(func $arena_gen (param $seed i32)
  (local $x i32) (local $z i32) (local $k i32) (local $i i32)
  (local $wx f32) (local $wz f32) (local $u f32) (local $v f32) (local $h f32) (local $hc f32)
  (local $wall f32) (local $t f32) (local $surf i32) (local $bx f32) (local $bz f32) (local $r i32) (local $d f32)
  (local $sx f32) (local $sz f32)
  (local.set $hc (f32.convert_i32_u (!ld u16 @TERRAIN_H (i32.const @(256 * 512 + 256)))))
  (!for $z (i32.const 0) (i32.const @GRID)
    (!for $x (i32.const 0) (i32.const @GRID)
      (local.set $k (i32.add (i32.shl (local.get $z) (i32.const 9)) (local.get $x)))
      (local.set $wx (f32.convert_i32_u (i32.shl (local.get $x) (i32.const 1))))
      (local.set $wz (f32.convert_i32_u (i32.shl (local.get $z) (i32.const 1))))
      ;; u along the gulch, v across it: -1 and 1 at the walls' feet
      (local.set $u (f32.div (f32.sub (local.get $wx) (f32.const 512)) (f32.const @((A_SPAN[1] - A_SPAN[0]) / 2 - 8))))
      (local.set $v (f32.div (f32.sub (local.get $wz) (f32.const 512)) (f32.const @((A_SPAN[3] - A_SPAN[2]) / 2 - 8))))
      (local.set $h (f32.mul (f32.sub (f32.convert_i32_u (!ld u16 @TERRAIN_H (local.get $k))) (local.get $hc)) (f32.const 0.2)))
      ;; walls: from the feet of the slope, up 30 m over a sixth of the span, then level
      (local.set $wall (f32.max (f32.sub (f32.abs (local.get $u)) (f32.const 0.9)) (f32.sub (f32.abs (local.get $v)) (f32.const 0.82))))
      (local.set $t (!clamp (f32.mul (local.get $wall) (f32.const 6)) (f32.const 0) (f32.const 1)))
      (local.set $h (f32.add (local.get $h) (f32.mul (f32.mul (local.get $t) (local.get $t)) (f32.const @(30 * 256)))))
      (local.set $surf (select (i32.const 1) (i32.const 0) (f32.gt (local.get $wall) (f32.const 0.02))))
      ;; a sandy track down the middle
      (if (i32.and (f32.lt (f32.abs (local.get $v)) (f32.const 0.1)) (f32.lt (f32.abs (local.get $u)) (f32.const 0.72)))
        (then (local.set $surf (i32.const 2))))
      ;; the bases: a pad 3 m up, 14 m across, its edge a ramp 6 m wide
      (local.set $bx (select (f32.const @(512 - 0.78 * ((A_SPAN[1] - A_SPAN[0]) / 2 - 8))) (f32.const @(512 + 0.78 * ((A_SPAN[1] - A_SPAN[0]) / 2 - 8)))
                             (f32.lt (local.get $u) (f32.const 0))))
      (local.set $d (call $dist2d (local.get $wx) (local.get $wz) (local.get $bx) (f32.const 512)))
      (local.set $t (!clamp (f32.mul (f32.sub (f32.const 20) (local.get $d)) (f32.const 0.1666667)) (f32.const 0) (f32.const 1)))
      (if (f32.gt (local.get $t) (f32.const 0))
        (then
          (local.set $h (!madd (f32.sub (f32.const @(3 * 256)) (local.get $h)) (local.get $t) (local.get $h)))
          (if (f32.ge (local.get $t) (f32.const 1)) (then (local.set $surf (i32.const 3))))))
      ;; rocks: eight humps, 3 to 6 m high and 5 to 9 m across, off the track
      (!for $i (i32.const 0) (i32.const 8)
        (local.set $r (call $hash32 (local.get $i) (i32.const 77) (local.get $seed)))
        (local.set $sx (f32.add (f32.const 512) (f32.mul (f32.convert_i32_s (i32.sub (i32.and (local.get $r) (i32.const 255)) (i32.const 128))) (f32.const 0.95))))
        (local.set $sz (f32.mul (f32.convert_i32_u (i32.add (i32.and (i32.shr_u (local.get $r) (i32.const 8)) (i32.const 31)) (i32.const 14))) (f32.const 1)))
        (local.set $sz (f32.add (f32.const 512) (select (local.get $sz) (f32.neg (local.get $sz)) (i32.and (local.get $i) (i32.const 1)))))
        (local.set $d (call $dist2d (local.get $wx) (local.get $wz) (local.get $sx) (local.get $sz)))
        (local.set $bz (f32.convert_i32_u (i32.add (i32.and (i32.shr_u (local.get $r) (i32.const 13)) (i32.const 3)) (i32.const 5))))
        (local.set $t (!clamp (f32.sub (f32.const 1) (f32.div (local.get $d) (local.get $bz))) (f32.const 0) (f32.const 1)))
        (if (f32.gt (local.get $t) (f32.const 0))
          (then
            (local.set $h (f32.add (local.get $h)
              (f32.mul (f32.mul (f32.sqrt (local.get $t)) (f32.convert_i32_u (i32.add (i32.and (i32.shr_u (local.get $r) (i32.const 16)) (i32.const 3)) (i32.const 3))))
                       (f32.const 256))))
            (local.set $surf (i32.const 1)))))
      (!st u8 @TERRAIN_S (local.get $k) (local.get $surf))
      (!st u16 @TERRAIN_H (local.get $k) (i32.trunc_sat_f32_u (f32.add (f32.add (local.get $h) (f32.const @(24 * 256))) (f32.const 0.5))))))
  ;; spawn points: four at each base, the rest anywhere on the floor
  (!for $i (i32.const 0) (i32.const @NSPAWN)
    (local.set $r (call $hash32 (local.get $i) (i32.const 91) (local.get $seed)))
    (if (i32.lt_u (local.get $i) (i32.const 8))
      (then
        (local.set $sx (f32.add (select (f32.const @(512 - 0.78 * ((A_SPAN[1] - A_SPAN[0]) / 2 - 8))) (f32.const @(512 + 0.78 * ((A_SPAN[1] - A_SPAN[0]) / 2 - 8))) (i32.and (local.get $i) (i32.const 1)))
                                (f32.mul (f32.convert_i32_s (i32.sub (i32.and (local.get $r) (i32.const 15)) (i32.const 8))) (f32.const 1))))
        (local.set $sz (f32.add (f32.const 512) (f32.mul (f32.convert_i32_s (i32.sub (i32.and (i32.shr_u (local.get $r) (i32.const 4)) (i32.const 15)) (i32.const 8))) (f32.const 1)))))
      (else
        (local.set $sx (f32.add (f32.const 512) (f32.mul (f32.convert_i32_s (i32.sub (i32.and (local.get $r) (i32.const 1023)) (i32.const 512))) (f32.const 0.25))))
        (local.set $sz (f32.add (f32.const 512) (f32.mul (f32.convert_i32_s (i32.sub (i32.and (i32.shr_u (local.get $r) (i32.const 10)) (i32.const 1023)) (i32.const 512))) (f32.const 0.1))))))
    (f32.store (i32.add (i32.const @SPAWNS) (i32.shl (local.get $i) (i32.const 3))) (local.get $sx))
    (f32.store offset=4 (i32.add (i32.const @SPAWNS) (i32.shl (local.get $i) (i32.const 3))) (local.get $sz)))
#if !FIESTA
  ;; the pads: snipers on the bases, the rocket in the middle, the rest about the field
  (call $pad (i32.const 0) (i32.const @W_SNIPER) (f32.const @(512 - 0.78 * ((A_SPAN[1] - A_SPAN[0]) / 2 - 8))) (f32.const 518))
  (call $pad (i32.const 1) (i32.const @W_SNIPER) (f32.const @(512 + 0.78 * ((A_SPAN[1] - A_SPAN[0]) / 2 - 8))) (f32.const 506))
  (call $pad (i32.const 2) (i32.const @W_ROCKET) (f32.const 512) (f32.const 512))
  (call $pad (i32.const 3) (i32.const @W_SHOTGUN) (f32.const 418) (f32.const 548))
  (call $pad (i32.const 4) (i32.const @W_SHOTGUN) (f32.const 606) (f32.const 476))
  (call $pad (i32.const 5) (i32.const @W_SWORD) (f32.const 512) (f32.const 558))
  (call $pad (i32.const 6) (i32.const @W_BR) (f32.const 452) (f32.const 478))
  (call $pad (i32.const 7) (i32.const @W_BR) (f32.const 572) (f32.const 546))
  (call $pad (i32.const 8) (i32.const @W_NEEDLER) (f32.const 482) (f32.const 556))
  (call $pad (i32.const 9) (i32.const @W_PLASMA) (f32.const 542) (f32.const 468))
  (call $pad (i32.const 10) (i32.const @W_BR) (f32.const 512) (f32.const 458))
  (call $pad (i32.const 11) (i32.const @W_PLASMA) (f32.const 436) (f32.const 500))
#endif
  (f32.store (i32.const @HDR_TEE) (f32.const 512))
  (f32.store (i32.const @(HDR_TEE + 8)) (f32.const 512))
  (f32.store (i32.const @HDR_DIR) (f32.const 1)))

(func $pad (param $k i32) (param $w i32) (param $x f32) (param $z f32)
  (local $a i32) (local $h f32)
  (local.set $a (i32.add (i32.const @PAD) (i32.shl (local.get $k) (i32.const 4))))
  (call $ground (local.get $x) (local.get $z))
  (drop) (drop) (drop) (drop)
  (local.set $h)
  (f32.store (local.get $a) (local.get $x))
  (f32.store offset=4 (local.get $a) (local.get $h))
  (f32.store offset=8 (local.get $a) (local.get $z))
  (i32.store8 offset=12 (local.get $a) (local.get $w))
  (i32.store16 offset=14 (local.get $a) (i32.const 0)))

;; ---- fighters

;; Slot p comes (back) into the fight at the spawn point farthest from the
;; nearest enemy, of four drawn at random: full shields and health, two
;; frags, and in Fiesta two different guns drawn at random (in slayer an
;; assault rifle out and a magnum on the back).
(func $a_spawn (param $p i32)
  (local $pb i32) (local $k i32) (local $i i32) (local $q i32) (local $qb i32) (local $in i32)
  (local $best i32) (local $bestd f32) (local $md f32) (local $sx f32) (local $sz f32) (local $dx f32) (local $dz f32) (local $h f32)
  (local $g0 i32) (local $g1 i32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (local.set $bestd (f32.const -1))
  (!for $k (i32.const 0) (i32.const 4)
    (local.set $i (i32.rem_u (call $rand) (i32.const @NSPAWN)))
    (local.set $sx (f32.load (i32.add (i32.const @SPAWNS) (i32.shl (local.get $i) (i32.const 3)))))
    (local.set $sz (f32.load offset=4 (i32.add (i32.const @SPAWNS) (i32.shl (local.get $i) (i32.const 3)))))
    (local.set $md (f32.const 1e9))
    (!for $q (i32.const 0) (i32.const @NPLAYER)
      (local.set $qb (i32.shl (local.get $q) (i32.const 6)))
      (if (i32.and (i32.eq (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $qb)) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE))
                   (i32.ne (local.get $q) (local.get $p)))
        (then
          (local.set $dx (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $qb)) (local.get $sx)))
          (local.set $dz (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $qb)) (local.get $sz)))
          (local.set $md (f32.min (local.get $md) (f32.add (f32.mul (local.get $dx) (local.get $dx)) (f32.mul (local.get $dz) (local.get $dz))))))))
    (if (f32.gt (local.get $md) (local.get $bestd))
      (then (local.set $bestd (local.get $md)) (local.set $best (local.get $i)))))
  (local.set $sx (f32.load (i32.add (i32.const @SPAWNS) (i32.shl (local.get $best) (i32.const 3)))))
  (local.set $sz (f32.load offset=4 (i32.add (i32.const @SPAWNS) (i32.shl (local.get $best) (i32.const 3)))))
  (call $ground (local.get $sx) (local.get $sz))
  (drop) (drop) (drop) (drop)
  (local.set $h)
  (local.set $in (!at i32 @(PLAYERS + P_IN) (local.get $pb)))
  (!put f32 @(PLAYERS + P_PX) (local.get $pb) (local.get $sx))
  (!put f32 @(PLAYERS + P_PY) (local.get $pb) (local.get $h))
  (!put f32 @(PLAYERS + P_PZ) (local.get $pb) (local.get $sz))
  (!put f32 @(PLAYERS + P_VX) (local.get $pb) (f32.const 0))
  (!put f32 @(PLAYERS + P_VY) (local.get $pb) (f32.const 0))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (f32.const 0))
  (!put u8 @(PLAYERS + P_FL) (local.get $pb) (i32.const @(PF_LIVE | PF_GROUND)))
  ;; a shot, melee or throw already asked for doesn't happen on arrival
  (!put u8 @(PLAYERS + P_FIRED) (local.get $pb) (i32.and (i32.shr_u (local.get $in) (i32.const @AW_SHOT)) (i32.const 3)))
  (!put u8 @(PLAYERS + A_ACT) (local.get $pb) (i32.and (i32.shr_u (local.get $in) (i32.const @AW_MELEE)) (i32.const 7)))
  (!put u16 @(PLAYERS + P_REFIRE) (local.get $pb) (i32.const 0))
  (!put u8 @(PLAYERS + A_HP) (local.get $pb) (i32.const 100))
  (!put u8 @(PLAYERS + A_SH) (local.get $pb) (i32.const 100))
  (!put u16 @(PLAYERS + A_SHT) (local.get $pb) (i32.const 0))
#if FIESTA
  ;; two different guns at random, full
  (local.set $g0 (i32.add (i32.rem_u (call $rand) (i32.const @(ARMS.length - 1))) (i32.const 1)))
  (local.set $g1 (i32.add (i32.rem_u (call $rand) (i32.const @(ARMS.length - 2))) (i32.const 1)))
  (if (i32.ge_u (local.get $g1) (local.get $g0)) (then (local.set $g1 (i32.add (local.get $g1) (i32.const 1)))))
#else
  (local.set $g0 (i32.const @W_AR))
  (local.set $g1 (i32.const @W_MAGNUM))
#endif
  (!put u8 @(PLAYERS + A_GUN) (local.get $pb) (local.get $g0))
  (!put u8 @(PLAYERS + A_GUN + 1) (local.get $pb) (local.get $g1))
  (!put u8 @(PLAYERS + A_MAG) (local.get $pb) (!arm mag (local.get $g0)))
  (!put u8 @(PLAYERS + A_MAG + 1) (local.get $pb) (!arm mag (local.get $g1)))
  (!put u16 @(PLAYERS + A_RES) (local.get $pb) (!arm res (local.get $g0)))
  (!put u16 @(PLAYERS + A_RES + 2) (local.get $pb) (!arm res (local.get $g1)))
  (!put u8 @(PLAYERS + A_GRENS) (local.get $pb) (i32.const 2))
  (!put u8 @(PLAYERS + A_RELOAD) (local.get $pb) (i32.const 0))
  (!put u8 @(PLAYERS + A_BURST) (local.get $pb) (i32.const 0))
  (!put u16 @(PLAYERS + A_COOL) (local.get $pb) (i32.const 0))
  (!put u16 @(PLAYERS + A_RESPAWN) (local.get $pb) (i32.const 0))
  (!put u8 @(PLAYERS + A_NEEDLES) (local.get $pb) (i32.const 0))
  (!put u8 @(PLAYERS + A_NEEDT) (local.get $pb) (i32.const 0))
  (call $fx (i32.const 0) (i32.const @FX_SPAWN) (local.get $p) (i32.const 0) (local.get $sx) (local.get $h) (local.get $sz) (f32.const 1)))

;; The frame's bit for this tick (bit tick & 7 of b31): a whole frame, if one
;; was sent, sets the view lag and asks for a reload or a pickup.
(func $a_frame (param $pb i32) (param $d i32) (param $in i32)
  (local $idx i32) (local $fr i32) (local $w i32) (local $slot i32) (local $mag i32)
  (local.set $idx (i32.and (i32.load offset=@HDR_TICK (local.get $d)) (i32.const 7)))
  (local.set $fr (i32.or (!at u8 @(PLAYERS + A_FRAME) (local.get $pb))
                         (i32.shl (i32.shr_u (local.get $in) (i32.const @AW_SERIAL)) (local.get $idx))))
  (if (i32.ne (local.get $idx) (i32.const 7))
    (then (!put u8 @(PLAYERS + A_FRAME) (local.get $pb) (local.get $fr)) (return)))
  (!put u8 @(PLAYERS + A_FRAME) (local.get $pb) (i32.const 0))
  ;; no frame this time: nothing new
  (if (i32.eqz (i32.and (local.get $fr) (i32.const @AF_SENT))) (then (return)))
  (!put u8 @(PLAYERS + A_LAG) (local.get $pb) (i32.and (i32.shr_u (local.get $fr) (i32.const @AF_LAG_SHIFT)) (i32.const @LAG_MAX)))
  (if (i32.and (local.get $fr) (i32.const @AF_USE))
    (then (!put u8 @(PLAYERS + A_ACT) (local.get $pb) (i32.or (!at u8 @(PLAYERS + A_ACT) (local.get $pb)) (i32.const @AB_USE)))))
  (if (i32.and (i32.ne (i32.and (local.get $fr) (i32.const @AF_RELOAD)) (i32.const 0))
               (i32.eqz (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_DEAD))))
    (then
      (local.set $slot (i32.and (i32.shr_u (!at u8 @(PLAYERS + A_ACT) (local.get $pb)) (i32.const 2)) (i32.const 1)))
      (local.set $w (i32.load8_u offset=@(PLAYERS + A_GUN) (i32.add (local.get $pb) (local.get $slot))))
      (local.set $mag (i32.load8_u offset=@(PLAYERS + A_MAG) (i32.add (local.get $pb) (local.get $slot))))
      (if (i32.and (i32.and (i32.lt_u (local.get $mag) (!arm mag (local.get $w))) (i32.ne (!arm reload (local.get $w)) (i32.const 0)))
                   (i32.and (i32.ne (i32.load16_u offset=@(PLAYERS + A_RES) (i32.add (local.get $pb) (i32.shl (local.get $slot) (i32.const 1)))) (i32.const 0))
                            (i32.eqz (!at u8 @(PLAYERS + A_RELOAD) (local.get $pb)))))
        (then
          (!put u8 @(PLAYERS + A_RELOAD) (local.get $pb) (!arm reload (local.get $w)))
          (!put u8 @(PLAYERS + A_BURST) (local.get $pb) (i32.const 0)))))))

;; A dead fighter's tick: no moving, nothing fires; the counters it would act
;; on follow the input so nothing is waiting on arrival.
(func $a_dead (param $p i32) (param $d i32) (param $in i32)
  (local $pb i32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (call $a_frame (local.get $pb) (local.get $d) (local.get $in))
  (!put u8 @(PLAYERS + P_FIRED) (local.get $pb) (i32.and (i32.shr_u (local.get $in) (i32.const @AW_SHOT)) (i32.const 3)))
  (!put u8 @(PLAYERS + A_ACT) (local.get $pb)
    (i32.or (i32.and (!at u8 @(PLAYERS + A_ACT) (local.get $pb)) (i32.const @(255 ^ (AB_MELEE | AB_GREN))))
            (i32.and (i32.shr_u (local.get $in) (i32.const @AW_MELEE)) (i32.const @(AB_MELEE | AB_GREN))))))

;; One live fighter's weapons for this tick, before it moves: swapping guns,
;; reloading, melee, grenades and the trigger. No shots in the countdown.
(func $a_shoot (param $p i32) (param $d i32) (param $in i32) (param $s f32) (param $c f32)
  (local $pb i32) (local $act i32) (local $slot i32) (local $w i32) (local $re i32) (local $rl i32) (local $cool i32)
  (local $ctr i32) (local $mag i32) (local $res i32) (local $take i32) (local $state i32) (local $u i32) (local $bit i32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (call $a_frame (local.get $pb) (local.get $d) (local.get $in))
  (local.set $act (!at u8 @(PLAYERS + A_ACT) (local.get $pb)))
  (local.set $slot (i32.and (i32.shr_u (local.get $in) (i32.const @AW_SLOT)) (i32.const 1)))
  (local.set $re (!at u16 @(PLAYERS + P_REFIRE) (local.get $pb)))
  (if (i32.ne (local.get $slot) (i32.and (i32.shr_u (local.get $act) (i32.const 2)) (i32.const 1)))
    (then
      (local.set $act (i32.xor (local.get $act) (i32.const @AB_SLOT)))
      (local.set $re (select (local.get $re) (i32.const @SWAP_TICKS) (i32.gt_u (local.get $re) (i32.const @SWAP_TICKS))))
      (!put u8 @(PLAYERS + A_BURST) (local.get $pb) (i32.const 0))
      (!put u8 @(PLAYERS + A_RELOAD) (local.get $pb) (i32.const 0))))
  (local.set $w (i32.load8_u offset=@(PLAYERS + A_GUN) (i32.add (local.get $pb) (local.get $slot))))
  (if (local.get $re) (then (local.set $re (i32.sub (local.get $re) (i32.const 1)))))
  (!put u16 @(PLAYERS + P_REFIRE) (local.get $pb) (local.get $re))
  ;; a reload ends: the magazine takes what the reserve has
  (local.set $rl (!at u8 @(PLAYERS + A_RELOAD) (local.get $pb)))
  (if (local.get $rl)
    (then
      (local.set $rl (i32.sub (local.get $rl) (i32.const 1)))
      (!put u8 @(PLAYERS + A_RELOAD) (local.get $pb) (local.get $rl))
      (if (i32.eqz (local.get $rl))
        (then
          (local.set $mag (i32.load8_u offset=@(PLAYERS + A_MAG) (i32.add (local.get $pb) (local.get $slot))))
          (local.set $res (i32.load16_u offset=@(PLAYERS + A_RES) (i32.add (local.get $pb) (i32.shl (local.get $slot) (i32.const 1)))))
          (local.set $take (i32.sub (!arm mag (local.get $w)) (local.get $mag)))
          (if (i32.gt_u (local.get $take) (local.get $res)) (then (local.set $take (local.get $res))))
          (i32.store8 offset=@(PLAYERS + A_MAG) (i32.add (local.get $pb) (local.get $slot)) (i32.add (local.get $mag) (local.get $take)))
          (i32.store16 offset=@(PLAYERS + A_RES) (i32.add (local.get $pb) (i32.shl (local.get $slot) (i32.const 1))) (i32.sub (local.get $res) (local.get $take)))))))
  (local.set $cool (!at u16 @(PLAYERS + A_COOL) (local.get $pb)))
  (if (local.get $cool) (then (local.set $cool (i32.sub (local.get $cool) (i32.const 1)))))
  (local.set $ctr (i32.and (i32.shr_u (local.get $in) (i32.const @AW_SHOT)) (i32.const 3)))
  (local.set $state (i32.load offset=@HDR_STATE (local.get $d)))
  (if (i32.le_u (local.get $state) (i32.const @H_COUNT))
    (then
      (!put u8 @(PLAYERS + P_FIRED) (local.get $pb) (local.get $ctr))
      (!put u8 @(PLAYERS + A_ACT) (local.get $pb)
        (i32.or (i32.and (local.get $act) (i32.const @(255 ^ (AB_MELEE | AB_GREN))))
                (i32.and (i32.shr_u (local.get $in) (i32.const @AW_MELEE)) (i32.const @(AB_MELEE | AB_GREN)))))
      (!put u16 @(PLAYERS + A_COOL) (local.get $pb) (local.get $cool))
      (return)))
  (local.set $u (i32.shl (i32.sub (i32.and (i32.shr_u (local.get $in) (i32.const @AW_PITCH)) (i32.const 0x3ff)) (i32.const 512)) (i32.const 3)))
  ;; melee: the sword swings, anything else is a rifle butt
  (local.set $bit (i32.and (i32.shr_u (local.get $in) (i32.const @AW_MELEE)) (i32.const 1)))
  (if (i32.ne (local.get $bit) (i32.and (local.get $act) (i32.const @AB_MELEE)))
    (then
      (local.set $act (i32.xor (local.get $act) (i32.const @AB_MELEE)))
      (if (i32.eqz (local.get $cool))
        (then
          (!put u16 @(PLAYERS + P_SHOTS) (local.get $pb) (i32.add (!at u16 @(PLAYERS + P_SHOTS) (local.get $pb)) (i32.const 1)))
          (call $a_melee (local.get $p) (local.get $d) (local.get $s) (local.get $c) (i32.eq (local.get $w) (i32.const @W_SWORD)))
          (local.set $cool (i32.const @COOL_TICKS))
          (!put u8 @(PLAYERS + A_BURST) (local.get $pb) (i32.const 0))
          (!put u8 @(PLAYERS + A_RELOAD) (local.get $pb) (i32.const 0))
          (if (i32.lt_u (local.get $re) (i32.const @(COOL_TICKS / 2)))
            (then (local.set $re (i32.const @(COOL_TICKS / 2))) (!put u16 @(PLAYERS + P_REFIRE) (local.get $pb) (local.get $re))))))))
  ;; a frag: thrown along the view, a little up
  (local.set $bit (i32.and (i32.shr_u (local.get $in) (i32.const @AW_GREN)) (i32.const 1)))
  (if (i32.ne (local.get $bit) (i32.and (i32.shr_u (local.get $act) (i32.const 1)) (i32.const 1)))
    (then
      (local.set $act (i32.xor (local.get $act) (i32.const @AB_GREN)))
      (if (i32.and (i32.eqz (local.get $cool)) (i32.ne (!at u8 @(PLAYERS + A_GRENS) (local.get $pb)) (i32.const 0)))
        (then
          (!put u8 @(PLAYERS + A_GRENS) (local.get $pb) (i32.sub (!at u8 @(PLAYERS + A_GRENS) (local.get $pb)) (i32.const 1)))
          (!put u16 @(PLAYERS + P_SHOTS) (local.get $pb) (i32.add (!at u16 @(PLAYERS + P_SHOTS) (local.get $pb)) (i32.const 1)))
          (call $a_launch (local.get $p) (local.get $d) (i32.const @K_GRENADE) (local.get $s) (local.get $c) (local.get $u) (f32.const @GREN_V) (f32.const @GREN_UP) (i32.const 0))
          (local.set $cool (i32.const @COOL_TICKS))))))
  (!put u8 @(PLAYERS + A_ACT) (local.get $pb) (local.get $act))
  (!put u16 @(PLAYERS + A_COOL) (local.get $pb) (local.get $cool))
  (if (i32.or (local.get $re) (!at u8 @(PLAYERS + A_RELOAD) (local.get $pb))) (then (return)))
  ;; the rest of a burst fires on its own, four ticks apart
  (if (!at u8 @(PLAYERS + A_BURST) (local.get $pb))
    (then
      (!put u8 @(PLAYERS + A_BURST) (local.get $pb) (i32.sub (!at u8 @(PLAYERS + A_BURST) (local.get $pb)) (i32.const 1)))
      (call $a_round (local.get $p) (local.get $d) (local.get $slot) (local.get $w) (local.get $in) (local.get $s) (local.get $c) (local.get $u))
      (return)))
  (if (i32.eq (local.get $ctr) (!at u8 @(PLAYERS + P_FIRED) (local.get $pb))) (then (return)))
  (!put u8 @(PLAYERS + P_FIRED) (local.get $pb) (local.get $ctr))
  (if (i32.eqz (local.get $w)) (then (return)))
  (if (i32.eqz (i32.load8_u offset=@(PLAYERS + A_MAG) (i32.add (local.get $pb) (local.get $slot))))
    (then
      ;; dry: start a reload if there's anything to load
      (if (i32.and (i32.ne (!arm reload (local.get $w)) (i32.const 0))
                   (i32.ne (i32.load16_u offset=@(PLAYERS + A_RES) (i32.add (local.get $pb) (i32.shl (local.get $slot) (i32.const 1)))) (i32.const 0)))
        (then (!put u8 @(PLAYERS + A_RELOAD) (local.get $pb) (!arm reload (local.get $w)))))
      (return)))
  (if (i32.gt_u (!arm burst (local.get $w)) (i32.const 1))
    (then (!put u8 @(PLAYERS + A_BURST) (local.get $pb) (i32.sub (!arm burst (local.get $w)) (i32.const 1)))))
  (call $a_round (local.get $p) (local.get $d) (local.get $slot) (local.get $w) (local.get $in) (local.get $s) (local.get $c) (local.get $u)))

;; One round of weapon w from slot `slot`: the magazine, the refire, the shot.
(func $a_round (param $p i32) (param $d i32) (param $slot i32) (param $w i32) (param $in i32) (param $s f32) (param $c f32) (param $u i32)
  (local $pb i32) (local $mag i32) (local $k i32) (local $type i32) (local $shots i32) (local $px f32) (local $py f32) (local $pz f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (local.set $mag (i32.sub (i32.load8_u offset=@(PLAYERS + A_MAG) (i32.add (local.get $pb) (local.get $slot))) (i32.const 1)))
  (i32.store8 offset=@(PLAYERS + A_MAG) (i32.add (local.get $pb) (local.get $slot)) (local.get $mag))
  (!put u16 @(PLAYERS + P_REFIRE) (local.get $pb)
    (select (i32.const 4) (!arm refire (local.get $w)) (i32.ne (!at u8 @(PLAYERS + A_BURST) (local.get $pb)) (i32.const 0))))
  (local.set $shots (i32.and (i32.add (!at u16 @(PLAYERS + P_SHOTS) (local.get $pb)) (i32.const 1)) (i32.const 0xffff)))
  (!put u16 @(PLAYERS + P_SHOTS) (local.get $pb) (local.get $shots))
  (local.set $px (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (local.set $py (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (f32.const @P_EYE)))
  (local.set $pz (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (call $fx (local.get $d) (i32.const @FX_SHOT) (local.get $p) (local.get $shots) (local.get $px) (local.get $py) (local.get $pz) (f32.convert_i32_u (local.get $w)))
  (local.set $type (!arm type (local.get $w)))
  (if (i32.eqz (local.get $type))
    (then
      (!for $k (i32.const 0) (!arm pellets (local.get $w))
        (call $a_hitscan (local.get $p) (local.get $d) (local.get $w) (local.get $in) (local.get $u) (local.get $k) (local.get $shots)))))
  (if (i32.eq (local.get $type) (i32.const 1))
    (then
      (call $a_aim (local.get $p) (local.get $in) (local.get $u) (local.get $shots) (i32.const 0) (!arm spread (local.get $w)))
      (local.set $c) (local.set $s) (local.set $u)
      (call $a_launch (local.get $p) (local.get $d) (!arm kind (local.get $w)) (local.get $s) (local.get $c) (local.get $u) (!arm speed (local.get $w)) (f32.const 0)
                      (i32.eq (local.get $w) (i32.const @W_NEEDLER)))))
  (if (i32.eq (local.get $type) (i32.const 2))
    (then (call $a_melee (local.get $p) (local.get $d) (local.get $s) (local.get $c) (i32.const 1))))
  ;; empty, and something to load: reload now
  (if (i32.and (i32.eqz (local.get $mag)) (i32.ne (!arm reload (local.get $w)) (i32.const 0)))
    (then
      (if (i32.ne (i32.load16_u offset=@(PLAYERS + A_RES) (i32.add (local.get $pb) (i32.shl (local.get $slot) (i32.const 1)))) (i32.const 0))
        (then
          (!put u8 @(PLAYERS + A_BURST) (local.get $pb) (i32.const 0))
          (!put u8 @(PLAYERS + A_RELOAD) (local.get $pb) (!arm reload (local.get $w))))))))

;; The aim of pellet k of shot `shots`, spread up to `spread` yaw units each
;; way by a hash of the fighter, the shot and the pellet (never the room's
;; PRNG, which only serial phases may draw from, so the prediction spreads
;; its shots exactly as the confirmed world will): pitch in yaw units, and
;; the yaw's sine and cosine.
(func $a_aim (param $p i32) (param $in i32) (param $u i32) (param $shots i32) (param $k i32) (param $spread i32) (result i32 f32 f32)
  (local $h i32) (local $yaw i32)
  (local.set $yaw (i32.shl (i32.and (local.get $in) (i32.const 0x7ff)) (i32.const 3)))
  (if (local.get $spread)
    (then
      (local.set $h (call $hash32 (i32.or (local.get $p) (i32.shl (local.get $shots) (i32.const 8))) (local.get $k) (i32.const 0x2545f491)))
      (local.set $yaw (i32.add (local.get $yaw)
        (i32.sub (i32.shr_u (i32.mul (i32.and (local.get $h) (i32.const 0xffff)) (i32.shl (local.get $spread) (i32.const 1))) (i32.const 16)) (local.get $spread))))
      (local.set $u (i32.add (local.get $u)
        (i32.sub (i32.shr_u (i32.mul (i32.shr_u (local.get $h) (i32.const 16)) (i32.shl (local.get $spread) (i32.const 1))) (i32.const 16)) (local.get $spread))))))
  (local.get $u)
  (call $sincos (local.get $yaw)))

;; Where slot q stood after tick rt, as far as the confirmed world knows: from
;; HIST if rt is one of its last 31 ticks, else where it stands now.
(func $a_where (param $q i32) (param $rt i32) (result f32 f32 f32)
  (local $now i32) (local $a i32)
  (local.set $now (i32.load (i32.const @HDR_TICK)))
  (if (i32.and (i32.lt_s (local.get $rt) (local.get $now)) (i32.le_s (i32.sub (local.get $now) (local.get $rt)) (i32.const @LAG_MAX)))
    (then
      (local.set $a (i32.add (i32.add (i32.const @HIST) (i32.mul (i32.and (local.get $rt) (i32.const 31)) (i32.const @HIST_TICK)))
                             (i32.shl (local.get $q) (i32.const 4))))
      (return (f32.load (local.get $a)) (f32.load offset=4 (local.get $a)) (f32.load offset=8 (local.get $a)))))
  (local.set $a (i32.add (i32.const @PLAYERS) (i32.shl (local.get $q) (i32.const 6))))
  (f32.load offset=@P_PX (local.get $a)) (f32.load offset=@P_PY (local.get $a)) (f32.load offset=@P_PZ (local.get $a)))

;; The tick slot p (of bank d) saw the others at: this tick less its view lag.
(func $a_seen (param $p i32) (param $d i32) (result i32)
  (i32.sub (i32.load offset=@HDR_TICK (local.get $d))
           (!at u8 @(PLAYERS + A_LAG) (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))))

;; A ray from (ox, oy, oz) along the unit (dx, dy, dz), out to `range`, against
;; the ground and every live fighter but p where it stood at tick rt: the
;; fighter it hits first (or -1), how far, and 1 if it took them in the head.
;; A body is an upright cylinder 0.45 m across from the feet to 1.45 m, a
;; head a ball of 0.22 m at 1.62 m.
(func $a_ray (param $p i32) (param $ox f32) (param $oy f32) (param $oz f32) (param $dx f32) (param $dy f32) (param $dz f32) (param $range f32) (param $rt i32)
  (result i32 f32 i32)
  (local $t f32) (local $lo f32) (local $hi f32) (local $m f32) (local $k i32) (local $best f32) (local $who i32) (local $head i32)
  (local $q i32) (local $qx f32) (local $qy f32) (local $qz f32) (local $fx f32) (local $fz f32) (local $fy f32)
  (local $a f32) (local $b f32) (local $cc f32) (local $disc f32) (local $sq f32) (local $t1 f32) (local $t2 f32) (local $ta f32) (local $tb f32)
  ;; the ground: half-metre steps, then bisection
  (local.set $best (local.get $range))
  (local.set $t (f32.const 0.5))
  (block $out
    (loop $march
      (br_if $out (f32.gt (local.get $t) (local.get $range)))
      (call $ground (!madd (local.get $dx) (local.get $t) (local.get $ox)) (!madd (local.get $dz) (local.get $t) (local.get $oz)))
      (drop) (drop) (drop) (drop)
      (if (f32.gt (!madd (local.get $dy) (local.get $t) (local.get $oy)))
        (then
          (local.set $lo (f32.sub (local.get $t) (f32.const 0.5)))
          (local.set $hi (local.get $t))
          (!for $k (i32.const 0) (i32.const 6)
            (local.set $m (f32.mul (f32.add (local.get $lo) (local.get $hi)) (f32.const 0.5)))
            (call $ground (!madd (local.get $dx) (local.get $m) (local.get $ox)) (!madd (local.get $dz) (local.get $m) (local.get $oz)))
            (drop) (drop) (drop) (drop)
            (if (f32.gt (!madd (local.get $dy) (local.get $m) (local.get $oy)))
              (then (local.set $hi (local.get $m)))
              (else (local.set $lo (local.get $m)))))
          (local.set $best (local.get $hi))
          (br $out)))
      (local.set $t (f32.add (local.get $t) (f32.const 0.5)))
      (br $march)))
  (local.set $who (i32.const -1))
  (local.set $a (f32.add (f32.mul (local.get $dx) (local.get $dx)) (f32.mul (local.get $dz) (local.get $dz))))
  (!for $q (i32.const 0) (i32.const @NPLAYER)
    (if (i32.and (i32.eq (i32.and (i32.load8_u offset=@(PLAYERS + P_FL) (i32.shl (local.get $q) (i32.const 6))) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE))
                 (i32.ne (local.get $q) (local.get $p)))
      (then
        (call $a_where (local.get $q) (local.get $rt))
        (local.set $qz) (local.set $qy) (local.set $qx)
        (local.set $fx (f32.sub (local.get $ox) (local.get $qx)))
        (local.set $fz (f32.sub (local.get $oz) (local.get $qz)))
        ;; the head
        (local.set $fy (f32.sub (local.get $oy) (f32.add (local.get $qy) (f32.const 1.62))))
        (local.set $b (!dot3 (local.get $fx) (local.get $fy) (local.get $fz) (local.get $dx) (local.get $dy) (local.get $dz)))
        (local.set $cc (f32.sub (!dot3 (local.get $fx) (local.get $fy) (local.get $fz) (local.get $fx) (local.get $fy) (local.get $fz)) (f32.const 0.0484)))
        (local.set $disc (f32.sub (f32.mul (local.get $b) (local.get $b)) (local.get $cc)))
        (if (f32.ge (local.get $disc) (f32.const 0))
          (then
            (local.set $t1 (f32.max (f32.sub (f32.neg (local.get $b)) (f32.sqrt (local.get $disc))) (f32.const 0)))
            (if (i32.and (f32.lt (local.get $t1) (local.get $best)) (f32.gt (f32.add (f32.neg (local.get $b)) (f32.sqrt (local.get $disc))) (f32.const 0)))
              (then (local.set $best (local.get $t1)) (local.set $who (local.get $q)) (local.set $head (i32.const 1))))))
        ;; the body: where the ray is inside the circle, and where it is between the feet and the shoulders
        (if (f32.gt (local.get $a) (f32.const 1e-8))
          (then
            (local.set $b (f32.add (f32.mul (local.get $fx) (local.get $dx)) (f32.mul (local.get $fz) (local.get $dz))))
            (local.set $cc (f32.sub (f32.add (f32.mul (local.get $fx) (local.get $fx)) (f32.mul (local.get $fz) (local.get $fz))) (f32.const 0.2025)))
            (local.set $disc (f32.sub (f32.mul (local.get $b) (local.get $b)) (f32.mul (local.get $a) (local.get $cc))))
            (if (f32.ge (local.get $disc) (f32.const 0))
              (then
                (local.set $sq (f32.sqrt (local.get $disc)))
                (local.set $t1 (f32.div (f32.sub (f32.neg (local.get $b)) (local.get $sq)) (local.get $a)))
                (local.set $t2 (f32.div (f32.add (f32.neg (local.get $b)) (local.get $sq)) (local.get $a)))
                (local.set $ta (f32.const -1e9))
                (local.set $tb (f32.const 1e9))
                (if (f32.ne (local.get $dy) (f32.const 0))
                  (then
                    (local.set $lo (f32.div (f32.sub (local.get $qy) (local.get $oy)) (local.get $dy)))
                    (local.set $hi (f32.div (f32.sub (f32.add (local.get $qy) (f32.const 1.45)) (local.get $oy)) (local.get $dy)))
                    (local.set $ta (f32.min (local.get $lo) (local.get $hi)))
                    (local.set $tb (f32.max (local.get $lo) (local.get $hi))))
                  (else
                    (if (i32.or (f32.lt (local.get $oy) (local.get $qy)) (f32.gt (local.get $oy) (f32.add (local.get $qy) (f32.const 1.45))))
                      (then (local.set $tb (f32.const -1e9))))))
                (local.set $lo (f32.max (f32.max (local.get $t1) (local.get $ta)) (f32.const 0)))
                (local.set $hi (f32.min (local.get $t2) (local.get $tb)))
                (if (i32.and (f32.le (local.get $lo) (local.get $hi)) (f32.lt (local.get $lo) (local.get $best)))
                  (then (local.set $best (local.get $lo)) (local.set $who (local.get $q)) (local.set $head (i32.const 0)))))))))))
  (local.get $who)
  (local.get $best)
  (local.get $head))

;; Pellet k of a hitscan shot: its ray, its tracer, and on the confirmed
;; world its damage. A shotgun's pellets lose damage past 8 m, to a fifth by 28.
(func $a_hitscan (param $p i32) (param $d i32) (param $w i32) (param $in i32) (param $u i32) (param $k i32) (param $shots i32)
  (local $pb i32) (local $s f32) (local $c f32) (local $sp f32) (local $cp f32) (local $dx f32) (local $dy f32) (local $dz f32)
  (local $ex f32) (local $ey f32) (local $ez f32) (local $q i32) (local $t f32) (local $head i32) (local $dmg f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (call $a_aim (local.get $p) (local.get $in) (local.get $u) (local.get $shots) (local.get $k) (!arm spread (local.get $w)))
  (local.set $c) (local.set $s) (local.set $u)
  (call $sincos (local.get $u))
  (local.set $cp) (local.set $sp)
  (local.set $dx (f32.mul (local.get $cp) (local.get $c)))
  (local.set $dy (local.get $sp))
  (local.set $dz (f32.mul (local.get $cp) (local.get $s)))
  (local.set $ex (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (local.set $ey (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (f32.const @P_EYE)))
  (local.set $ez (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (call $a_ray (local.get $p) (local.get $ex) (local.get $ey) (local.get $ez) (local.get $dx) (local.get $dy) (local.get $dz)
               (f32.convert_i32_u (!arm range (local.get $w))) (call $a_seen (local.get $p) (local.get $d)))
  (local.set $head) (local.set $t) (local.set $q)
  (call $fx (local.get $d) (i32.const @FX_TRACER) (local.get $p) (local.get $shots)
            (!madd (local.get $dx) (local.get $t) (local.get $ex)) (!madd (local.get $dy) (local.get $t) (local.get $ey)) (!madd (local.get $dz) (local.get $t) (local.get $ez))
            (f32.convert_i32_u (local.get $w)))
  (if (i32.and (i32.eqz (local.get $d)) (i32.ge_s (local.get $q) (i32.const 0)))
    (then
      (local.set $dmg (f32.convert_i32_u (!arm dmg (local.get $w))))
      (if (i32.eq (local.get $w) (i32.const @W_SHOTGUN))
        (then (local.set $dmg (f32.mul (local.get $dmg) (!clamp (f32.sub (f32.const 1.4) (f32.mul (local.get $t) (f32.const 0.05))) (f32.const 0.2) (f32.const 1))))))
      (call $a_hurt (local.get $q) (local.get $p) (i32.trunc_sat_f32_u (f32.add (local.get $dmg) (f32.const 0.5)))
                    (select (!arm head (local.get $w)) (i32.const 0) (local.get $head)) (local.get $w)
                    (!madd (local.get $dx) (local.get $t) (local.get $ex)) (!madd (local.get $dy) (local.get $t) (local.get $ey)) (!madd (local.get $dz) (local.get $t) (local.get $ez))))))

;; Damage to slot q from slot a (the confirmed world only). Shields take it
;; first; `head` 2 kills outright, 1 kills once the shields are through.
(func $a_hurt (param $q i32) (param $a i32) (param $dmg i32) (param $head i32) (param $cause i32) (param $x f32) (param $y f32) (param $z f32)
  (local $qb i32) (local $sh i32) (local $hp i32) (local $over i32)
  (local.set $qb (i32.shl (local.get $q) (i32.const 6)))
  (if (i32.ne (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $qb)) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE)) (then (return)))
  (if (i32.ne (i32.load (i32.const @HDR_STATE)) (i32.const @H_PLAY)) (then (return)))
  (!put u16 @(PLAYERS + A_SHT) (local.get $qb) (i32.const @SHIELD_DELAY))
  (!put u8 @(PLAYERS + A_HITBY) (local.get $qb) (local.get $a))
  (local.set $sh (!at u8 @(PLAYERS + A_SH) (local.get $qb)))
  (local.set $hp (!at u8 @(PLAYERS + A_HP) (local.get $qb)))
  (if (i32.eq (local.get $head) (i32.const 2))
    (then
      (call $fx (i32.const 0) (i32.const @FX_HIT) (local.get $a) (local.get $q) (local.get $x) (local.get $y) (local.get $z) (f32.const 3))
      (call $a_kill (local.get $q) (local.get $a) (local.get $cause))
      (return)))
  (if (i32.le_u (local.get $dmg) (local.get $sh))
    (then
      (!put u8 @(PLAYERS + A_SH) (local.get $qb) (i32.sub (local.get $sh) (local.get $dmg)))
      (call $fx (i32.const 0) (i32.const @FX_HIT) (local.get $a) (local.get $q) (local.get $x) (local.get $y) (local.get $z) (f32.const 1))
      (return)))
  (local.set $over (i32.sub (local.get $dmg) (local.get $sh)))
  (!put u8 @(PLAYERS + A_SH) (local.get $qb) (i32.const 0))
  (call $fx (i32.const 0) (i32.const @FX_HIT) (local.get $a) (local.get $q) (local.get $x) (local.get $y) (local.get $z)
            (select (f32.const 3) (f32.const 2) (local.get $head)))
  (if (i32.or (local.get $head) (i32.ge_s (local.get $over) (local.get $hp)))
    (then (call $a_kill (local.get $q) (local.get $a) (local.get $cause)) (return)))
  (!put u8 @(PLAYERS + A_HP) (local.get $qb) (i32.sub (local.get $hp) (local.get $over))))

;; Slot q dies at a's hand (or its own): a kill for a and a grenade back,
;; a death for q, three seconds to respawn.
(func $a_kill (param $q i32) (param $a i32) (param $cause i32)
  (local $qb i32) (local $ab i32)
  (local.set $qb (i32.shl (local.get $q) (i32.const 6)))
  (!put u8 @(PLAYERS + P_FL) (local.get $qb) (i32.or (!at u8 @(PLAYERS + P_FL) (local.get $qb)) (i32.const @PF_DEAD)))
  (!put u16 @(PLAYERS + A_RESPAWN) (local.get $qb) (i32.const @RESPAWN_TICKS))
  (!put u16 @(PLAYERS + A_DEATHS) (local.get $qb) (i32.add (!at u16 @(PLAYERS + A_DEATHS) (local.get $qb)) (i32.const 1)))
  (!put u8 @(PLAYERS + A_HP) (local.get $qb) (i32.const 0))
  (!put u8 @(PLAYERS + A_SH) (local.get $qb) (i32.const 0))
  (!put u8 @(PLAYERS + A_NEEDLES) (local.get $qb) (i32.const 0))
  (!put u8 @(PLAYERS + A_RELOAD) (local.get $qb) (i32.const 0))
  (!put u8 @(PLAYERS + A_BURST) (local.get $qb) (i32.const 0))
  (!put f32 @(PLAYERS + P_VX) (local.get $qb) (f32.const 0))
  (!put f32 @(PLAYERS + P_VZ) (local.get $qb) (f32.const 0))
  (call $fx (i32.const 0) (i32.const @FX_KILL) (local.get $a) (local.get $q)
            (!at f32 @(PLAYERS + P_PX) (local.get $qb)) (!at f32 @(PLAYERS + P_PY) (local.get $qb)) (!at f32 @(PLAYERS + P_PZ) (local.get $qb))
            (f32.convert_i32_u (local.get $cause)))
  (if (i32.eq (local.get $a) (local.get $q))
    (then
      (if (!at u16 @(PLAYERS + A_KILLS) (local.get $qb))
        (then (!put u16 @(PLAYERS + A_KILLS) (local.get $qb) (i32.sub (!at u16 @(PLAYERS + A_KILLS) (local.get $qb)) (i32.const 1)))))
      (return)))
  (local.set $ab (i32.shl (local.get $a) (i32.const 6)))
  (!put u16 @(PLAYERS + A_KILLS) (local.get $ab) (i32.add (!at u16 @(PLAYERS + A_KILLS) (local.get $ab)) (i32.const 1)))
  (if (i32.lt_u (!at u8 @(PLAYERS + A_GRENS) (local.get $ab)) (i32.const 4))
    (then (!put u8 @(PLAYERS + A_GRENS) (local.get $ab) (i32.add (!at u8 @(PLAYERS + A_GRENS) (local.get $ab)) (i32.const 1))))))

;; The nearest live enemy of p within `reach` metres, inside a cone of the
;; given cosine about its facing (s, c), where p saw them; and how far.
(func $a_reach (param $p i32) (param $d i32) (param $s f32) (param $c f32) (param $reach f32) (param $cone f32) (result i32 f32)
  (local $pb i32) (local $q i32) (local $rt i32) (local $px f32) (local $py f32) (local $pz f32)
  (local $qx f32) (local $qy f32) (local $qz f32) (local $dx f32) (local $dz f32) (local $dist f32) (local $best f32) (local $who i32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (local.set $px (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (local.set $py (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
  (local.set $pz (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (local.set $rt (call $a_seen (local.get $p) (local.get $d)))
  (local.set $best (local.get $reach))
  (local.set $who (i32.const -1))
  (!for $q (i32.const 0) (i32.const @NPLAYER)
    (if (i32.and (i32.eq (i32.and (i32.load8_u offset=@(PLAYERS + P_FL) (i32.shl (local.get $q) (i32.const 6))) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE))
                 (i32.ne (local.get $q) (local.get $p)))
      (then
        (call $a_where (local.get $q) (local.get $rt))
        (local.set $qz) (local.set $qy) (local.set $qx)
        (local.set $dx (f32.sub (local.get $qx) (local.get $px)))
        (local.set $dz (f32.sub (local.get $qz) (local.get $pz)))
        (local.set $dist (f32.sqrt (f32.add (f32.mul (local.get $dx) (local.get $dx)) (f32.mul (local.get $dz) (local.get $dz)))))
        (if (i32.and (i32.and (f32.lt (local.get $dist) (local.get $best)) (f32.lt (f32.abs (f32.sub (local.get $qy) (local.get $py))) (f32.const 2)))
                     (f32.ge (f32.add (f32.mul (local.get $dx) (local.get $c)) (f32.mul (local.get $dz) (local.get $s)))
                             (f32.mul (local.get $cone) (f32.max (local.get $dist) (f32.const 0.01)))))
          (then (local.set $best (local.get $dist)) (local.set $who (local.get $q)))))))
  (local.get $who)
  (local.get $best))

;; A melee: a rifle butt reaches 2.4 m, a sword 5 m and kills. Either lunges
;; at what it reaches (on both banks, so your own lunge is predicted); a butt
;; to the back kills.
(func $a_melee (param $p i32) (param $d i32) (param $s f32) (param $c f32) (param $sword i32)
  (local $pb i32) (local $q i32) (local $dist f32) (local $qb i32) (local $dx f32) (local $dz f32) (local $lunge f32)
  (local $qs f32) (local $qc f32) (local $x f32) (local $y f32) (local $z f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (call $a_reach (local.get $p) (local.get $d) (local.get $s) (local.get $c)
                 (select (f32.const 5) (f32.const 2.4) (local.get $sword)) (select (f32.const 0.9) (f32.const 0.77) (local.get $sword)))
  (local.set $dist) (local.set $q)
  (local.set $x (!madd (local.get $c) (f32.const 1.2) (!at f32 @(PLAYERS + P_PX) (local.get $pb))))
  (local.set $y (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (f32.const 1.2)))
  (local.set $z (!madd (local.get $s) (f32.const 1.2) (!at f32 @(PLAYERS + P_PZ) (local.get $pb))))
  (call $fx (local.get $d) (i32.const @FX_MELEE) (local.get $p) (!at u16 @(PLAYERS + P_SHOTS) (local.get $pb)) (local.get $x) (local.get $y) (local.get $z)
            (f32.convert_i32_u (local.get $sword)))
  (if (i32.lt_s (local.get $q) (i32.const 0)) (then (return)))
  (local.set $lunge (select (f32.const 14) (f32.const 5) (local.get $sword)))
  (!put f32 @(PLAYERS + P_VX) (local.get $pb) (!madd (local.get $c) (local.get $lunge) (!at f32 @(PLAYERS + P_VX) (local.get $pb))))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (!madd (local.get $s) (local.get $lunge) (!at f32 @(PLAYERS + P_VZ) (local.get $pb))))
  (if (local.get $d) (then (return)))
  (local.set $qb (i32.shl (local.get $q) (i32.const 6)))
  (local.set $x (!at f32 @(PLAYERS + P_PX) (local.get $qb)))
  (local.set $y (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $qb)) (f32.const 1.2)))
  (local.set $z (!at f32 @(PLAYERS + P_PZ) (local.get $qb)))
  (if (local.get $sword)
    (then (call $a_hurt (local.get $q) (local.get $p) (i32.const 255) (i32.const 2) (i32.const @W_SWORD) (local.get $x) (local.get $y) (local.get $z)) (return)))
  ;; from behind: they face away from you, within 60 degrees
  (call $sincos (i32.shl (i32.and (!at i32 @(PLAYERS + P_IN) (local.get $qb)) (i32.const 0x7ff)) (i32.const 3)))
  (local.set $qc) (local.set $qs)
  (local.set $dx (f32.sub (local.get $x) (!at f32 @(PLAYERS + P_PX) (local.get $pb))))
  (local.set $dz (f32.sub (local.get $z) (!at f32 @(PLAYERS + P_PZ) (local.get $pb))))
  (if (f32.gt (f32.add (f32.mul (local.get $dx) (local.get $qc)) (f32.mul (local.get $dz) (local.get $qs))) (f32.mul (f32.const 0.5) (f32.max (local.get $dist) (f32.const 0.01))))
    (then (call $a_hurt (local.get $q) (local.get $p) (i32.const 255) (i32.const 2) (i32.const @KILL_BEHIND) (local.get $x) (local.get $y) (local.get $z)) (return)))
  (call $a_hurt (local.get $q) (local.get $p) (i32.const @MELEE_DMG) (i32.const 0) (i32.const @KILL_MELEE) (local.get $x) (local.get $y) (local.get $z)))

;; A projectile of `kind` from the eye of slot p along pitch u (yaw units) and
;; the yaw's (s, c), at `speed` plus `up` m/s upward. A needle homes on the
;; enemy nearest its line within 12 degrees and 60 m, if any.
(func $a_launch (param $p i32) (param $d i32) (param $kind i32) (param $s f32) (param $c f32) (param $u i32) (param $speed f32) (param $up f32) (param $seek i32)
  (local $pb i32) (local $j i32) (local $jb i32) (local $sp f32) (local $cp f32) (local $fx f32) (local $fy f32) (local $fz f32)
  (local $ex f32) (local $ey f32) (local $ez f32) (local $q i32) (local $rt i32) (local $qx f32) (local $qy f32) (local $qz f32)
  (local $dx f32) (local $dy f32) (local $dz f32) (local $dist f32) (local $best f32) (local $who i32) (local $cos f32)
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
  (!put f32 @(PROJ + J_PX) (local.get $jb) (!madd (local.get $fx) (f32.const 0.5) (local.get $ex)))
  (!put f32 @(PROJ + J_PY) (local.get $jb) (!madd (local.get $fy) (f32.const 0.5) (local.get $ey)))
  (!put f32 @(PROJ + J_PZ) (local.get $jb) (!madd (local.get $fz) (f32.const 0.5) (local.get $ez)))
  (!put f32 @(PROJ + J_VX) (local.get $jb) (f32.mul (local.get $fx) (local.get $speed)))
  (!put f32 @(PROJ + J_VY) (local.get $jb) (!madd (local.get $fy) (local.get $speed) (local.get $up)))
  (!put f32 @(PROJ + J_VZ) (local.get $jb) (f32.mul (local.get $fz) (local.get $speed)))
  (!put u16 @(PROJ + J_AGE) (local.get $jb) (i32.const 0))
  (!put u8 @(PROJ + J_KIND) (local.get $jb) (local.get $kind))
  (!put u8 @(PROJ + J_TGT) (local.get $jb) (i32.const 0))
  (!put u8 @(PROJ + J_OWNER) (local.get $jb) (local.get $p))
  (!put u8 @(PROJ + J_HOME) (local.get $jb) (i32.const 0))
  (!put u16 @(PROJ + J_SHOT) (local.get $jb) (!at u16 @(PLAYERS + P_SHOTS) (local.get $pb)))
  (if (i32.eqz (local.get $seek)) (then (return)))
  (local.set $rt (call $a_seen (local.get $p) (local.get $d)))
  (local.set $who (i32.const -1))
  (local.set $best (f32.const 0.978)) ;; cos 12 degrees
  (!for $q (i32.const 0) (i32.const @NPLAYER)
    (if (i32.and (i32.eq (i32.and (i32.load8_u offset=@(PLAYERS + P_FL) (i32.shl (local.get $q) (i32.const 6))) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE))
                 (i32.ne (local.get $q) (local.get $p)))
      (then
        (call $a_where (local.get $q) (local.get $rt))
        (local.set $qz) (local.set $qy) (local.set $qx)
        (local.set $dx (f32.sub (local.get $qx) (local.get $ex)))
        (local.set $dy (f32.sub (f32.add (local.get $qy) (f32.const 1)) (local.get $ey)))
        (local.set $dz (f32.sub (local.get $qz) (local.get $ez)))
        (local.set $dist (f32.sqrt (f32.max (!dot3 (local.get $dx) (local.get $dy) (local.get $dz) (local.get $dx) (local.get $dy) (local.get $dz)) (f32.const 1e-6))))
        (local.set $cos (f32.div (!dot3 (local.get $dx) (local.get $dy) (local.get $dz) (local.get $fx) (local.get $fy) (local.get $fz)) (local.get $dist)))
        (if (i32.and (f32.gt (local.get $cos) (local.get $best)) (f32.lt (local.get $dist) (f32.const 60)))
          (then (local.set $best (local.get $cos)) (local.set $who (local.get $q)))))))
  (if (i32.ge_s (local.get $who) (i32.const 0))
    (then
      (!put u8 @(PROJ + J_TGT) (local.get $jb) (local.get $who))
      (!put u8 @(PROJ + J_HOME) (local.get $jb) (i32.const 1)))))

;; Splash on every live fighter, centred on the middle of the body: the
;; whole of it within 35% of r, falling linearly to nothing at r (half to
;; its owner).
(func $a_splash (param $x f32) (param $y f32) (param $z f32) (param $dmg f32) (param $r f32) (param $owner i32) (param $cause i32)
  (local $q i32) (local $qb i32) (local $dx f32) (local $dy f32) (local $dz f32) (local $dist f32) (local $f f32)
  (!for $q (i32.const 0) (i32.const @NPLAYER)
    (local.set $qb (i32.shl (local.get $q) (i32.const 6)))
    (if (i32.eq (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $qb)) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE))
      (then
        (local.set $dx (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $qb)) (local.get $x)))
        (local.set $dy (f32.sub (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $qb)) (f32.const 0.9)) (local.get $y)))
        (local.set $dz (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $qb)) (local.get $z)))
        (local.set $dist (f32.sqrt (!dot3 (local.get $dx) (local.get $dy) (local.get $dz) (local.get $dx) (local.get $dy) (local.get $dz))))
        (if (f32.lt (local.get $dist) (local.get $r))
          (then
            ;; full within the inner 35%, falling to nothing at the edge
            (local.set $f (f32.mul (local.get $dmg) (!clamp (f32.div (f32.sub (local.get $r) (local.get $dist)) (f32.mul (local.get $r) (f32.const 0.65))) (f32.const 0) (f32.const 1))))
            (if (i32.eq (local.get $q) (local.get $owner)) (then (local.set $f (f32.mul (local.get $f) (f32.const 0.5)))))
            (if (f32.ge (local.get $f) (f32.const 1))
              (then (call $a_hurt (local.get $q) (local.get $owner) (i32.trunc_sat_f32_u (local.get $f)) (i32.const 0) (local.get $cause)
                                  (!at f32 @(PLAYERS + P_PX) (local.get $qb)) (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $qb)) (f32.const 1)) (!at f32 @(PLAYERS + P_PZ) (local.get $qb)))))))))))

;; A plasma bolt or a needle, in two half steps a tick like a rocket. A needle
;; turns toward its target's chest, keeping its speed. Either is spent on the
;; ground or a body: a bolt burns, a needle sticks; seven in one fighter at
;; once go off together.
(func $a_bolt (param $jb i32) (param $d i32)
  (local $px f32) (local $py f32) (local $pz f32) (local $vx f32) (local $vy f32) (local $vz f32) (local $h f32) (local $k i32)
  (local $q i32) (local $qb i32) (local $tx f32) (local $ty f32) (local $tz f32) (local $sp f32) (local $len f32) (local $owner i32) (local $needle i32)
  (local.set $px (!at f32 @(PROJ + J_PX) (local.get $jb)))
  (local.set $py (!at f32 @(PROJ + J_PY) (local.get $jb)))
  (local.set $pz (!at f32 @(PROJ + J_PZ) (local.get $jb)))
  (local.set $vx (!at f32 @(PROJ + J_VX) (local.get $jb)))
  (local.set $vy (!at f32 @(PROJ + J_VY) (local.get $jb)))
  (local.set $vz (!at f32 @(PROJ + J_VZ) (local.get $jb)))
  (local.set $owner (!at u8 @(PROJ + J_OWNER) (local.get $jb)))
  (local.set $needle (i32.eq (!at u8 @(PROJ + J_KIND) (local.get $jb)) (i32.const @K_NEEDLE)))
  (if (i32.and (local.get $needle) (i32.ne (!at u8 @(PROJ + J_HOME) (local.get $jb)) (i32.const 0)))
    (then
      (local.set $qb (i32.shl (!at u8 @(PROJ + J_TGT) (local.get $jb)) (i32.const 6)))
      (if (i32.eq (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $qb)) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE))
        (then
          (local.set $sp (f32.const @(ARMS[W_NEEDLER].speed)))
          (local.set $tx (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $qb)) (local.get $px)))
          (local.set $ty (f32.sub (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $qb)) (f32.const 1)) (local.get $py)))
          (local.set $tz (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $qb)) (local.get $pz)))
          (local.set $len (f32.div (local.get $sp) (f32.sqrt (f32.max (!dot3 (local.get $tx) (local.get $ty) (local.get $tz) (local.get $tx) (local.get $ty) (local.get $tz)) (f32.const 1e-6)))))
          (local.set $vx (!madd (f32.sub (f32.mul (local.get $tx) (local.get $len)) (local.get $vx)) (f32.const 0.07) (local.get $vx)))
          (local.set $vy (!madd (f32.sub (f32.mul (local.get $ty) (local.get $len)) (local.get $vy)) (f32.const 0.07) (local.get $vy)))
          (local.set $vz (!madd (f32.sub (f32.mul (local.get $tz) (local.get $len)) (local.get $vz)) (f32.const 0.07) (local.get $vz)))
          (local.set $len (f32.div (local.get $sp) (f32.sqrt (f32.max (!dot3 (local.get $vx) (local.get $vy) (local.get $vz) (local.get $vx) (local.get $vy) (local.get $vz)) (f32.const 1e-6)))))
          (local.set $vx (f32.mul (local.get $vx) (local.get $len)))
          (local.set $vy (f32.mul (local.get $vy) (local.get $len)))
          (local.set $vz (f32.mul (local.get $vz) (local.get $len))))
        (else (!put u8 @(PROJ + J_HOME) (local.get $jb) (i32.const 0))))))
  (!for $k (i32.const 0) (i32.const 2)
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
      (then
        (call $fx (local.get $d) (i32.const @FX_BLAST) (local.get $owner) (!at u16 @(PROJ + J_SHOT) (local.get $jb)) (local.get $px) (local.get $h) (local.get $pz) (f32.const 0.4))
        (memory.fill (i32.add (i32.const @PROJ) (local.get $jb)) (i32.const 0) (i32.const @JSIZE))
        (return)))
    (local.set $q (call $hit_player (local.get $px) (local.get $py) (local.get $pz) (f32.const 0.15) (local.get $owner)))
    (if (i32.ge_s (local.get $q) (i32.const 0))
      (then
        (if (i32.eqz (local.get $d))
          (then
            (if (local.get $needle)
              (then (call $a_stick (local.get $q) (local.get $owner) (local.get $px) (local.get $py) (local.get $pz)))
              (else (call $a_hurt (local.get $q) (local.get $owner) (i32.const @(ARMS[W_PLASMA].dmg)) (i32.const 0) (i32.const @W_PLASMA)
                              (local.get $px) (local.get $py) (local.get $pz))))))
        (memory.fill (i32.add (i32.const @PROJ) (local.get $jb)) (i32.const 0) (i32.const @JSIZE))
        (return))))
  (!put f32 @(PROJ + J_PX) (local.get $jb) (local.get $px))
  (!put f32 @(PROJ + J_PY) (local.get $jb) (local.get $py))
  (!put f32 @(PROJ + J_PZ) (local.get $jb) (local.get $pz))
  (!put f32 @(PROJ + J_VX) (local.get $jb) (local.get $vx))
  (!put f32 @(PROJ + J_VY) (local.get $jb) (local.get $vy))
  (!put f32 @(PROJ + J_VZ) (local.get $jb) (local.get $vz))
  (if (i32.gt_u (!at u16 @(PROJ + J_AGE) (local.get $jb)) (select (i32.const 300) (i32.const 250) (local.get $needle)))
    (then (memory.fill (i32.add (i32.const @PROJ) (local.get $jb)) (i32.const 0) (i32.const @JSIZE)))))

(func $a_stick (param $q i32) (param $a i32) (param $x f32) (param $y f32) (param $z f32)
  (local $qb i32) (local $n i32)
  (local.set $qb (i32.shl (local.get $q) (i32.const 6)))
  (call $a_hurt (local.get $q) (local.get $a) (i32.const @(ARMS[W_NEEDLER].dmg)) (i32.const 0) (i32.const @W_NEEDLER) (local.get $x) (local.get $y) (local.get $z))
  (if (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $qb)) (i32.const @PF_DEAD)) (then (return)))
  (local.set $n (i32.add (!at u8 @(PLAYERS + A_NEEDLES) (local.get $qb)) (i32.const 1)))
  (!put u8 @(PLAYERS + A_NEEDLER) (local.get $qb) (local.get $a))
  (!put u8 @(PLAYERS + A_NEEDT) (local.get $qb) (i32.const @NEEDLE_TICKS))
  (if (i32.lt_u (local.get $n) (i32.const @SUPERCOMBINE))
    (then (!put u8 @(PLAYERS + A_NEEDLES) (local.get $qb) (local.get $n)) (return)))
  (!put u8 @(PLAYERS + A_NEEDLES) (local.get $qb) (i32.const 0))
  (call $fx (i32.const 0) (i32.const @FX_BLAST) (local.get $a) (i32.const 0) (local.get $x) (local.get $y) (local.get $z) (f32.const 2.5))
  (call $a_hurt (local.get $q) (local.get $a) (i32.const @SUPER_DMG) (i32.const 2) (i32.const @KILL_SUPER) (local.get $x) (local.get $y) (local.get $z)))

;; Walking over a pad: ammo for a gun you carry, or with a use, its gun in
;; place of the one in your hands. A pad comes back 30 s after (60 s for the
;; sniper, the rocket and the sword).
(func $a_pickup (param $p i32)
  (local $pb i32) (local $k i32) (local $a i32) (local $w i32) (local $slot i32) (local $have i32) (local $dx f32) (local $dz f32) (local $took i32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (!for $k (i32.const 0) (i32.const @NPAD)
    (local.set $a (i32.add (i32.const @PAD) (i32.shl (local.get $k) (i32.const 4))))
    (local.set $w (i32.load8_u offset=12 (local.get $a)))
    (local.set $dx (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (f32.load (local.get $a))))
    (local.set $dz (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $pb)) (f32.load offset=8 (local.get $a))))
    (if (i32.and (i32.and (i32.ne (local.get $w) (i32.const 0)) (i32.eqz (i32.load16_u offset=14 (local.get $a))))
                 (i32.and (f32.lt (f32.add (f32.mul (local.get $dx) (local.get $dx)) (f32.mul (local.get $dz) (local.get $dz))) (f32.const 2.25))
                          (f32.lt (f32.abs (f32.sub (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (f32.load offset=4 (local.get $a)))) (f32.const 2))))
      (then
        (local.set $took (i32.const 0))
        (local.set $have (i32.const -1))
        (if (i32.eq (!at u8 @(PLAYERS + A_GUN + 1) (local.get $pb)) (local.get $w)) (then (local.set $have (i32.const 1))))
        (if (i32.eq (!at u8 @(PLAYERS + A_GUN) (local.get $pb)) (local.get $w)) (then (local.set $have (i32.const 0))))
        (if (i32.ge_s (local.get $have) (i32.const 0))
          (then
            ;; ammo, if short of it
            (if (i32.lt_u (i32.load16_u offset=@(PLAYERS + A_RES) (i32.add (local.get $pb) (i32.shl (local.get $have) (i32.const 1)))) (!arm res (local.get $w)))
              (then
                (i32.store16 offset=@(PLAYERS + A_RES) (i32.add (local.get $pb) (i32.shl (local.get $have) (i32.const 1))) (!arm res (local.get $w)))
                (local.set $took (i32.const 1)))))
          (else
            (if (i32.and (!at u8 @(PLAYERS + A_ACT) (local.get $pb)) (i32.const @AB_USE))
              (then
                (local.set $slot (i32.and (i32.shr_u (!at u8 @(PLAYERS + A_ACT) (local.get $pb)) (i32.const 2)) (i32.const 1)))
                (i32.store8 offset=@(PLAYERS + A_GUN) (i32.add (local.get $pb) (local.get $slot)) (local.get $w))
                (i32.store8 offset=@(PLAYERS + A_MAG) (i32.add (local.get $pb) (local.get $slot)) (!arm mag (local.get $w)))
                (i32.store16 offset=@(PLAYERS + A_RES) (i32.add (local.get $pb) (i32.shl (local.get $slot) (i32.const 1))) (!arm res (local.get $w)))
                (!put u8 @(PLAYERS + A_RELOAD) (local.get $pb) (i32.const 0))
                (!put u8 @(PLAYERS + A_BURST) (local.get $pb) (i32.const 0))
                (!put u16 @(PLAYERS + P_REFIRE) (local.get $pb) (i32.const @SWAP_TICKS))
                (local.set $took (i32.const 1))))))
        (if (local.get $took)
          (then
            (i32.store16 offset=14 (local.get $a)
              (select (i32.const 7500) (i32.const 3750)
                      (i32.or (i32.or (i32.eq (local.get $w) (i32.const @W_SNIPER)) (i32.eq (local.get $w) (i32.const @W_ROCKET)))
                              (i32.eq (local.get $w) (i32.const @W_SWORD)))))
            (call $fx (i32.const 0) (i32.const @FX_PICKUP) (local.get $p) (local.get $w)
                      (f32.load (local.get $a)) (f32.load offset=4 (local.get $a)) (f32.load offset=8 (local.get $a)) (f32.convert_i32_u (local.get $w)))))))))

;; The match, at the end of every tick: where everyone stood (for the
;; shots of the next 31 ticks), respawns, shields and health coming back,
;; needles falling out, pickups, and the clock: a countdown, play until the
;; time is up (or in slayer someone has FRAG_LIMIT kills), the scoreboard, again.
(func $arena
  (local $p i32) (local $pb i32) (local $fl i32) (local $live i32) (local $best i32) (local $t i32) (local $state i32)
  (local $h i32) (local $n i32) (local $k i32) (local $a i32)
  (local.set $t (i32.load (i32.const @HDR_TICK)))
  (local.set $state (i32.load (i32.const @HDR_STATE)))
  (local.set $h (i32.add (i32.const @HIST) (i32.mul (i32.and (local.get $t) (i32.const 31)) (i32.const @HIST_TICK))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
    (f32.store (i32.add (local.get $h) (i32.shl (local.get $p) (i32.const 4))) (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
    (f32.store offset=4 (i32.add (local.get $h) (i32.shl (local.get $p) (i32.const 4))) (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
    (f32.store offset=8 (i32.add (local.get $h) (i32.shl (local.get $p) (i32.const 4))) (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
    (if (i32.and (local.get $fl) (i32.const @PF_LIVE))
      (then
        (!inc $live)
        (if (i32.gt_u (!at u16 @(PLAYERS + A_KILLS) (local.get $pb)) (local.get $best)) (then (local.set $best (!at u16 @(PLAYERS + A_KILLS) (local.get $pb)))))
        (if (i32.and (local.get $fl) (i32.const @PF_DEAD))
          (then
            (local.set $n (!at u16 @(PLAYERS + A_RESPAWN) (local.get $pb)))
            (if (i32.gt_u (local.get $n) (i32.const 1))
              (then (!put u16 @(PLAYERS + A_RESPAWN) (local.get $pb) (i32.sub (local.get $n) (i32.const 1))))
              (else (call $a_spawn (local.get $p)))))
          (else
            (local.set $n (!at u16 @(PLAYERS + A_SHT) (local.get $pb)))
            (if (local.get $n)
              (then (!put u16 @(PLAYERS + A_SHT) (local.get $pb) (i32.sub (local.get $n) (i32.const 1))))
              (else
                (if (i32.lt_u (!at u8 @(PLAYERS + A_SH) (local.get $pb)) (i32.const 100))
                  (then
                    (if (i32.eqz (i32.and (local.get $t) (i32.const 1)))
                      (then (!put u8 @(PLAYERS + A_SH) (local.get $pb) (i32.add (!at u8 @(PLAYERS + A_SH) (local.get $pb)) (i32.const 1))))))
                  (else
                    (if (i32.and (i32.lt_u (!at u8 @(PLAYERS + A_HP) (local.get $pb)) (i32.const 100)) (i32.eqz (i32.and (local.get $t) (i32.const 3))))
                      (then (!put u8 @(PLAYERS + A_HP) (local.get $pb) (i32.add (!at u8 @(PLAYERS + A_HP) (local.get $pb)) (i32.const 1)))))))))
            (local.set $n (!at u8 @(PLAYERS + A_NEEDT) (local.get $pb)))
            (if (local.get $n)
              (then
                (!put u8 @(PLAYERS + A_NEEDT) (local.get $pb) (i32.sub (local.get $n) (i32.const 1)))
                (if (i32.eq (local.get $n) (i32.const 1)) (then (!put u8 @(PLAYERS + A_NEEDLES) (local.get $pb) (i32.const 0))))))
            (call $a_pickup (local.get $p))))
        (!put u8 @(PLAYERS + A_ACT) (local.get $pb) (i32.and (!at u8 @(PLAYERS + A_ACT) (local.get $pb)) (i32.const @(255 ^ AB_USE)))))))
  (!for $k (i32.const 0) (i32.const @NPAD)
    (local.set $a (i32.add (i32.const @PAD) (i32.shl (local.get $k) (i32.const 4))))
    (if (i32.load16_u offset=14 (local.get $a))
      (then (i32.store16 offset=14 (local.get $a) (i32.sub (i32.load16_u offset=14 (local.get $a)) (i32.const 1))))))
  (i32.store (i32.const @HDR_LIVE) (local.get $live))
  (if (i32.eqz (local.get $live))
    (then (i32.store (i32.const @HDR_STATE) (i32.const @H_IDLE)) (return)))
  (if (i32.eq (local.get $state) (i32.const @H_COUNT))
    (then
      (if (i32.ge_u (local.get $t) (i32.load (i32.const @HDR_UNTIL)))
        (then
          (i32.store (i32.const @HDR_STATE) (i32.const @H_PLAY))
          (i32.store (i32.const @HDR_START) (local.get $t))
          (i32.store (i32.const @HDR_UNTIL) (i32.add (local.get $t) (i32.const @MATCH_TICKS)))))
      (return)))
  (if (i32.eq (local.get $state) (i32.const @H_PLAY))
    (then
#if FIESTA
      (if (i32.ge_u (local.get $t) (i32.load (i32.const @HDR_UNTIL)))
#else
      (if (i32.or (i32.ge_u (local.get $best) (i32.const @FRAG_LIMIT)) (i32.ge_u (local.get $t) (i32.load (i32.const @HDR_UNTIL))))
#endif
        (then
          (i32.store (i32.const @HDR_STATE) (i32.const @H_OVER))
          (i32.store (i32.const @HDR_UNTIL) (i32.add (local.get $t) (i32.const @OVER_TICKS)))))
      (return)))
  (if (i32.and (i32.eq (local.get $state) (i32.const @H_OVER)) (i32.ge_u (local.get $t) (i32.load (i32.const @HDR_UNTIL))))
    (then
      ;; a new match: scores cleared, everyone respawned, every pad back
      (i32.store (i32.const @HDR_HOLE) (i32.add (i32.load (i32.const @HDR_HOLE)) (i32.const 1)))
      (!for $p (i32.const 0) (i32.const @NPLAYER)
        (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
        (if (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_LIVE))
          (then
            (!put u16 @(PLAYERS + A_KILLS) (local.get $pb) (i32.const 0))
            (!put u16 @(PLAYERS + A_DEATHS) (local.get $pb) (i32.const 0))
            (call $a_spawn (local.get $p)))))
      (!for $k (i32.const 0) (i32.const @NPAD)
        (i32.store16 offset=14 (i32.add (i32.const @PAD) (i32.shl (local.get $k) (i32.const 4))) (i32.const 0)))
      (i32.store (i32.const @HDR_STATE) (i32.const @H_COUNT))
      (i32.store (i32.const @HDR_UNTIL) (i32.add (local.get $t) (i32.const @COUNT_TICKS))))))
