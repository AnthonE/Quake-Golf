;; ODDBALL (M_ODDBALL, prefix ob; constants and the skull's fields in AO in
;; src/am/oddball.mjs): one skull, at its spot (MAP_BALL, at its feet height
;; by $stand) as play starts. The first fighter alive to touch it takes it,
;; either side ($a_carry: no guns, a swing that kills); it rides at its
;; carrier's feet and every tick carried counts for the carrier's side, each
;; OB_POINT ticks a point for the side and one for the carrier (MR_POINTS).
;; A side's count is kept while the skull changes hands, so 100 ticks, a drop
;; and 25 more of its own are a point. A carrier who dies or leaves drops it
;; on whatever is under its feet; dropped, it goes back to its spot after
;; OB_RESET unless someone takes it first. The core ends the match at
;; AH_TARGET or the clock. News (FX_MODE at the skull, owner who did it or
;; 255, shot that one's side): taken, dropped, back at its spot.

;; Play begins: the skull at its spot (AO was zeroed at the pick, so both
;; sides' counts are 0); the target.
(func $ob_start
  (local $x f32) (local $z f32)
  (local.set $x (f32.load (i32.const @MAP_BALL)))
  (local.set $z (f32.load (i32.const @(MAP_BALL + 4))))
  (f32.store (i32.const @(AO + OB_SPOT)) (local.get $x))
  (f32.store (i32.const @(AO + OB_SPOT + 4)) (call $stand (local.get $x) (local.get $z) (f32.load (i32.const @(MAP_BALL + 8)))))
  (f32.store (i32.const @(AO + OB_SPOT + 8)) (local.get $z))
  (call $ob_home)
  (i32.store (i32.const @AH_TARGET) (i32.const @OB_TARGET)))

;; Every tick of play, in this order: a carrier no longer live, alive or
;; carrying (it left, a slot rejoined, a death the kill hook didn't see)
;; drops it where it last had it; carried, it follows its carrier and the
;; tick counts for its side; dropped, it counts down and at 0 goes back to its
;; spot; at its spot or dropped, the first fighter in slot order alive and
;; not carrying with its feet within OB_TOUCH_R across and OB_TOUCH_H up or
;; down takes it.
(func $ob_tick (result i32)
  (local $c i32) (local $cb i32) (local $side i32) (local $a i32) (local $n i32) (local $p i32) (local $r i32)
  (local.set $c (i32.load8_u (i32.const @(AO + OB_CARRIER))))
  (local.set $cb (i32.shl (local.get $c) (i32.const 6)))
  (if (i32.eq (i32.load8_u (i32.const @(AO + OB_STATE))) (i32.const @OB_CARRIED))
    (then
      (if (i32.ne (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $cb)) (i32.const @(PF_LIVE | PF_DEAD | PF_CARRY))) (i32.const @(PF_LIVE | PF_CARRY)))
        (then
          (call $a_carry (local.get $c) (i32.const 0))
          (call $ob_drop (f32.load (i32.const @(AO + OB_POS))) (f32.load (i32.const @(AO + OB_POS + 4))) (f32.load (i32.const @(AO + OB_POS + 8))) (local.get $c)))
        (else
          (f32.store (i32.const @(AO + OB_POS)) (!at f32 @(PLAYERS + P_PX) (local.get $cb)))
          (f32.store (i32.const @(AO + OB_POS + 4)) (!at f32 @(PLAYERS + P_PY) (local.get $cb)))
          (f32.store (i32.const @(AO + OB_POS + 8)) (!at f32 @(PLAYERS + P_PZ) (local.get $cb)))
          (local.set $side (i32.load8_u (i32.const @(AO + OB_SIDE))))
          (local.set $a (i32.add (i32.const @(AO + OB_HELD)) (i32.shl (local.get $side) (i32.const 1))))
          (local.set $n (i32.add (i32.load16_u (local.get $a)) (i32.const 1)))
          (if (i32.ge_u (local.get $n) (i32.const @OB_POINT))
            (then
              (local.set $n (i32.const 0))
              (call $a_score (local.get $side) (i32.const 1))
              (local.set $r (i32.shl (local.get $c) (i32.const 3)))
              (i32.store16 offset=@(MODE_REC + MR_POINTS) (local.get $r)
                (i32.add (i32.load16_u offset=@(MODE_REC + MR_POINTS) (local.get $r)) (i32.const 1)))))
          (i32.store16 (local.get $a) (local.get $n))))))
  (if (i32.eq (i32.load8_u (i32.const @(AO + OB_STATE))) (i32.const @OB_DROPPED))
    (then
      (local.set $n (i32.sub (i32.load16_u (i32.const @(AO + OB_LEFT))) (i32.const 1)))
      (if (i32.gt_s (local.get $n) (i32.const 0))
        (then (i32.store16 (i32.const @(AO + OB_LEFT)) (local.get $n)))
        (else
          (call $ob_home)
          (call $ob_news (i32.const @OB_MX_RESET) (i32.const 255) (i32.const 0))))))
  (if (i32.ne (i32.load8_u (i32.const @(AO + OB_STATE))) (i32.const @OB_CARRIED))
    (then
      (block $took
        (!for $p (i32.const 0) (i32.const @NPLAYER)
          (if (i32.eq (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $p) (i32.const 6))) (i32.const @(PF_LIVE | PF_DEAD | PF_CARRY))) (i32.const @PF_LIVE))
            (then
              (if (call $a_near (local.get $p) (f32.load (i32.const @(AO + OB_POS))) (f32.load (i32.const @(AO + OB_POS + 4))) (f32.load (i32.const @(AO + OB_POS + 8)))
                                (f32.const @OB_TOUCH_R) (f32.const @OB_TOUCH_H))
                (then (call $ob_take (local.get $p)) (br $took)))))))))
  (i32.const 0))

;; q died at a's hand: if q had the skull, it drops on whatever is under q's
;; feet (the core clears q's PF_CARRY after).
(func $ob_kill (param $q i32) (param $a i32) (param $cause i32)
  (local $qb i32)
  (if (i32.and (i32.eq (i32.load8_u (i32.const @(AO + OB_STATE))) (i32.const @OB_CARRIED))
               (i32.eq (i32.load8_u (i32.const @(AO + OB_CARRIER))) (local.get $q)))
    (then
      (local.set $qb (i32.shl (local.get $q) (i32.const 6)))
      (call $ob_drop (!at f32 @(PLAYERS + P_PX) (local.get $qb)) (!at f32 @(PLAYERS + P_PY) (local.get $qb)) (!at f32 @(PLAYERS + P_PZ) (local.get $qb))
                     (local.get $q)))))

;; Slot p takes the skull where it lies: carried, on p's side, at p's feet.
(func $ob_take (param $p i32)
  (local $pb i32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (i32.store8 (i32.const @(AO + OB_STATE)) (i32.const @OB_CARRIED))
  (i32.store8 (i32.const @(AO + OB_CARRIER)) (local.get $p))
  (i32.store8 (i32.const @(AO + OB_SIDE)) (call $a_team (local.get $p)))
  (i32.store16 (i32.const @(AO + OB_LEFT)) (i32.const 0))
  (call $a_carry (local.get $p) (i32.const 1))
  (call $ob_news (i32.const @OB_MX_TAKE) (local.get $p) (i32.load8_u (i32.const @(AO + OB_SIDE))))
  (f32.store (i32.const @(AO + OB_POS)) (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (f32.store (i32.const @(AO + OB_POS + 4)) (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
  (f32.store (i32.const @(AO + OB_POS + 8)) (!at f32 @(PLAYERS + P_PZ) (local.get $pb))))

;; The skull put down at (x, y, z), on what it would land on falling from
;; there (the ground or a box top, as $move finds it), OB_RESET ticks to go;
;; owner p had it.
(func $ob_drop (param $x f32) (param $y f32) (param $z f32) (param $p i32)
  (f32.store (i32.const @(AO + OB_POS)) (local.get $x))
  (f32.store (i32.const @(AO + OB_POS + 4)) (call $stand (local.get $x) (local.get $z) (f32.add (local.get $y) (f32.const 0.01))))
  (f32.store (i32.const @(AO + OB_POS + 8)) (local.get $z))
  (i32.store8 (i32.const @(AO + OB_STATE)) (i32.const @OB_DROPPED))
  (i32.store16 (i32.const @(AO + OB_LEFT)) (i32.const @OB_RESET))
  (call $ob_news (i32.const @OB_MX_DROP) (local.get $p) (i32.load8_u (i32.const @(AO + OB_SIDE)))))

;; The skull back at its spot.
(func $ob_home
  (memory.copy (i32.const @(AO + OB_POS)) (i32.const @(AO + OB_SPOT)) (i32.const 12))
  (i32.store8 (i32.const @(AO + OB_STATE)) (i32.const @OB_HOME))
  (i32.store16 (i32.const @(AO + OB_LEFT)) (i32.const 0)))

;; News for the feed, at the skull.
(func $ob_news (param $what i32) (param $owner i32) (param $shot i32)
  (call $fx (i32.const 0) (i32.const @FX_MODE) (local.get $owner) (local.get $shot)
            (f32.load (i32.const @(AO + OB_POS))) (f32.load (i32.const @(AO + OB_POS + 4))) (f32.load (i32.const @(AO + OB_POS + 8)))
            (f32.convert_i32_u (local.get $what))))

;; No spawn point is barred.
(func $ob_bar (param $x f32) (param $y f32) (param $z f32) (result i32)
  (i32.const 0))
