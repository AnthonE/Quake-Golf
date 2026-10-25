;; KING OF THE HILL (M_HILL, prefix hl; constants and AO's fields in
;; src/am/hill.mjs): one hill at a time, a circle at one of the map's hill
;; points (MAP_NHILL of them at MAP_HILLS: f32 x, z, top, radius). The first
;; is drawn by $rand as play starts, then the map's order (it lists them
;; alternating sides), one every HL_MOVE. A fighter is on it with its feet
;; within the radius across and HL_H up or down of the point's height, which
;; keeps a roof apart from the room under it. The side with more live
;; fighters on it holds it (none: nobody; as many each and some: contested);
;; every HL_POINT ticks a side holds it, counted per side and kept across a
;; contest and a move, is a point for the side and for each of its fighters
;; on it then (MR_POINTS). The core ends the match at AH_TARGET or the clock.
;; Its news says who has it as that changes, at most one every HL_NEWSGAP.

;; Hill k comes up: its index, its centre (the feet height $stand gives its
;; point) and radius in AO, and the tick it moves on.
(func $hl_put (param $k i32)
  (local $a i32) (local $x f32) (local $z f32)
  (local.set $a (i32.add (i32.const @MAP_HILLS) (i32.shl (local.get $k) (i32.const 4))))
  (local.set $x (f32.load (local.get $a)))
  (local.set $z (f32.load offset=4 (local.get $a)))
  (i32.store (i32.const @(AO + HL_AT)) (local.get $k))
  (i32.store (i32.const @(AO + HL_MOVES)) (i32.add (i32.load (i32.const @HDR_TICK)) (i32.const @HL_MOVE)))
  (f32.store (i32.const @(AO + HL_X)) (local.get $x))
  (f32.store (i32.const @(AO + HL_Y)) (call $stand (local.get $x) (local.get $z) (f32.load offset=8 (local.get $a))))
  (f32.store (i32.const @(AO + HL_Z)) (local.get $z))
  (f32.store (i32.const @(AO + HL_R)) (f32.load offset=12 (local.get $a))))

;; Its news (owner nobody, at the hill's centre).
(func $hl_news (param $what i32) (param $shot i32)
  (call $fx (i32.const 0) (i32.const @FX_MODE) (i32.const 255) (local.get $shot)
            (f32.load (i32.const @(AO + HL_X))) (f32.load (i32.const @(AO + HL_Y))) (f32.load (i32.const @(AO + HL_Z)))
            (f32.convert_i32_u (local.get $what))))

;; 1 if slot p is alive and on the hill.
(func $hl_on (param $p i32) (result i32)
  (i32.and (call $a_alive (local.get $p))
           (call $a_near (local.get $p) (f32.load (i32.const @(AO + HL_X))) (f32.load (i32.const @(AO + HL_Y))) (f32.load (i32.const @(AO + HL_Z)))
                         (f32.load (i32.const @(AO + HL_R))) (f32.const @HL_H))))

;; Play begins: the first hill, drawn.
(func $hl_start
  (call $hl_put (i32.rem_u (call $rand) (i32.load (i32.const @MAP_NHILL))))
  (i32.store (i32.const @AH_TARGET) (i32.const @HL_TARGET)))

;; A tick of play: the hill moves on when its time is up (not on the clock's
;; last tick: the match is over), a new hill the news hasn't named a holder
;; for; each side's fighters on it counted, in slot order; who holds it, and
;; news of it; the holder's tick counted toward its point.
(func $hl_tick (result i32)
  (local $p i32) (local $t i32) (local $red i32) (local $blue i32) (local $hold i32) (local $s i32) (local $a i32) (local $n i32)
  (local.set $t (i32.load (i32.const @HDR_TICK)))
  (if (i32.and (i32.ge_u (local.get $t) (i32.load (i32.const @(AO + HL_MOVES)))) (i32.lt_u (local.get $t) (i32.load (i32.const @HDR_UNTIL))))
    (then
      (call $hl_put (i32.rem_u (i32.add (i32.load (i32.const @(AO + HL_AT))) (i32.const 1)) (i32.load (i32.const @MAP_NHILL))))
      (i32.store (i32.const @(AO + HL_SAID)) (i32.const 0))
      (call $hl_news (i32.const @HL_MX_MOVE) (i32.load (i32.const @(AO + HL_AT))))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (if (call $hl_on (local.get $p))
      (then (if (call $a_team (local.get $p)) (then (!inc $blue)) (else (!inc $red))))))
  (i32.store (i32.const @(AO + HL_ON)) (local.get $red))
  (i32.store (i32.const @(AO + HL_ON + 4)) (local.get $blue))
  (local.set $hold (select (i32.const 1)
                           (select (i32.const 2) (select (i32.const 3) (i32.const 0) (local.get $red)) (i32.gt_u (local.get $blue) (local.get $red)))
                           (i32.gt_u (local.get $red) (local.get $blue))))
  (i32.store (i32.const @(AO + HL_HOLD)) (local.get $hold))
  ;; news when a side has it, or it's contested, and the news last said
  ;; otherwise (an empty hill isn't news), HL_NEWSGAP since the last: one held
  ;; back goes out as the gap is up if it still stands
  (if (i32.and (i32.and (i32.ne (local.get $hold) (i32.const 0)) (i32.ne (local.get $hold) (i32.load (i32.const @(AO + HL_SAID)))))
               (i32.ge_u (i32.sub (local.get $t) (i32.load (i32.const @(AO + HL_SAIDAT)))) (i32.const @HL_NEWSGAP)))
    (then
      (call $hl_news (select (i32.const @HL_MX_CONTEST) (i32.const @HL_MX_TAKE) (i32.eq (local.get $hold) (i32.const 3))) (local.get $hold))
      (i32.store (i32.const @(AO + HL_SAID)) (local.get $hold))
      (i32.store (i32.const @(AO + HL_SAIDAT)) (local.get $t))))
  ;; s: the holding side (0 red, 1 blue); a full second of it a point for the
  ;; side and for each of its fighters on it
  (local.set $s (i32.sub (local.get $hold) (i32.const 1)))
  (if (i32.lt_u (local.get $s) (i32.const 2))
    (then
      (local.set $a (i32.add (i32.const @(AO + HL_HELD)) (i32.shl (local.get $s) (i32.const 1))))
      (local.set $n (i32.add (i32.load16_u (local.get $a)) (i32.const 1)))
      (if (i32.ge_u (local.get $n) (i32.const @HL_POINT))
        (then
          (local.set $n (i32.const 0))
          (call $a_score (local.get $s) (i32.const 1))
          (!for $p (i32.const 0) (i32.const @NPLAYER)
            (if (i32.and (call $hl_on (local.get $p)) (i32.eq (call $a_team (local.get $p)) (local.get $s)))
              (then (i32.store16 offset=@(MODE_REC + MR_POINTS) (i32.shl (local.get $p) (i32.const 3))
                                 (i32.add (i32.load16_u offset=@(MODE_REC + MR_POINTS) (i32.shl (local.get $p) (i32.const 3))) (i32.const 1))))))))
      (i32.store16 (local.get $a) (local.get $n))))
  (i32.const 0))

;; A death just leaves the hill.
(func $hl_kill (param $q i32) (param $a i32) (param $cause i32))
