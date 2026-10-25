;; HEADHUNTER (M_HEADHUNT, prefix hh; constants and AO's fields in
;; src/am/headhunter.mjs). Every death drops what its fighter carried and one
;; skull more, in a pile at its feet on whatever is under them; a death within
;; HH_MERGE_R across and HH_TOUCH_H up or down of a pile adds to the nearest
;; one instead. A pile is a place, a count and its ticks to go: HH_LIFE as it
;; is laid or added to, counting that tick. There are HH_NPILE places for
;; them; with every one taken the oldest pile (fewest ticks to go, the lower
;; index on a tie) gives way. A fighter alive with its feet within HH_TOUCH_R
;; across and HH_TOUCH_H up or down takes a whole pile, either side, the first
;; in slot order, and keeps its guns: carrying skulls is no PF_CARRY, so
;; nothing of it reaches the prediction. One drop zone at a time, at one of
;; the map's hill points (MAP_HILLS: its radius, and HH_ZONE_H up or down of
;; its point's feet height): the first drawn by $rand as play starts, then the
;; map's order, one every HH_MOVE. A fighter alive in it banks every skull it
;; carries, a point each for its side ($a_score) and its own MR_POINTS. What
;; a fighter carries is HH_CARRY in AO and MR_AUX in its record; a join clears
;; the record, so a slot whose two differ, or that is out of the fight with
;; skulls, had some it never dropped (it left, its slot was taken again, it
;; died unseen), and they go down where it stood the tick before (HIST). The
;; core ends the match at AH_TARGET or the clock. News (FX_MODE): banked
;; (owner who, shot how many, at its feet), a pile taken (the same, at the
;; pile), the zone moved (owner 255, shot its index, at its centre).

;; Zone k comes up: its index, its centre (the feet height $stand gives its
;; point) and radius in AO, and the tick it moves on.
(func $hh_put (param $k i32)
  (local $a i32) (local $x f32) (local $z f32)
  (local.set $a (i32.add (i32.const @MAP_HILLS) (i32.shl (local.get $k) (i32.const 4))))
  (local.set $x (f32.load (local.get $a)))
  (local.set $z (f32.load offset=4 (local.get $a)))
  (i32.store (i32.const @(AO + HH_AT)) (local.get $k))
  (i32.store (i32.const @(AO + HH_MOVES)) (i32.add (i32.load (i32.const @HDR_TICK)) (i32.const @HH_MOVE)))
  (f32.store (i32.const @(AO + HH_X)) (local.get $x))
  (f32.store (i32.const @(AO + HH_Y)) (call $stand (local.get $x) (local.get $z) (f32.load offset=8 (local.get $a))))
  (f32.store (i32.const @(AO + HH_Z)) (local.get $z))
  (f32.store (i32.const @(AO + HH_R)) (f32.load offset=12 (local.get $a))))

;; Play begins: the first zone, drawn; the target, HH_PER for each fighter on
;; the larger side, at least HH_MIN.
(func $hh_start
  (local $n i32)
  (call $hh_put (i32.rem_u (call $rand) (i32.load (i32.const @MAP_NHILL))))
  (local.set $n (i32.load (i32.const @AH_TEAMN)))
  (if (i32.gt_u (i32.load (i32.const @(AH_TEAMN + 4))) (local.get $n)) (then (local.set $n (i32.load (i32.const @(AH_TEAMN + 4))))))
  (local.set $n (i32.mul (local.get $n) (i32.const @HH_PER)))
  (i32.store (i32.const @AH_TARGET) (select (local.get $n) (i32.const @HH_MIN) (i32.gt_u (local.get $n) (i32.const @HH_MIN)))))

;; The skulls slot p carries, as AO has them.
(func $hh_has (param $p i32) (result i32)
  (i32.load16_u offset=@(AO + HH_CARRY) (i32.shl (local.get $p) (i32.const 1))))

;; Slot p carries n skulls now (at most 0xffff): HH_CARRY and MR_AUX.
(func $hh_set (param $p i32) (param $n i32)
  (local.set $n (select (local.get $n) (i32.const 0xffff) (i32.lt_u (local.get $n) (i32.const 0xffff))))
  (i32.store16 offset=@(AO + HH_CARRY) (i32.shl (local.get $p) (i32.const 1)) (local.get $n))
  (i32.store16 offset=@(MODE_REC + MR_AUX) (i32.shl (local.get $p) (i32.const 3)) (local.get $n)))

;; The address of pile k.
(func $hh_pile (param $k i32) (result i32)
  (i32.add (i32.const @(AO + HH_PILES)) (i32.mul (local.get $k) (i32.const @HH_PILE_SIZE))))

;; n skulls put down at (x, y, z), on what they would land on falling from
;; there (the ground or a box top, as $move finds it): onto the nearest pile
;; strictly within HH_MERGE_R across and HH_TOUCH_H up or down of where they
;; land (the lower index on a tie), else a pile of their own in the first
;; free place, else in the oldest pile's; HH_LIFE ticks to go.
(func $hh_lay (param $x f32) (param $y f32) (param $z f32) (param $n i32)
  (local $k i32) (local $a i32) (local $at i32) (local $left i32) (local $dx f32) (local $dz f32) (local $d f32) (local $best f32)
  (local.set $y (call $stand (local.get $x) (local.get $z) (f32.add (local.get $y) (f32.const 0.01))))
  (local.set $at (i32.const -1))
  (local.set $best (f32.mul (f32.const @HH_MERGE_R) (f32.const @HH_MERGE_R)))
  (!for $k (i32.const 0) (i32.const @HH_NPILE)
    (local.set $a (call $hh_pile (local.get $k)))
    (if (i32.load16_u offset=12 (local.get $a))
      (then
        (local.set $dx (f32.sub (f32.load (local.get $a)) (local.get $x)))
        (local.set $dz (f32.sub (f32.load offset=8 (local.get $a)) (local.get $z)))
        (local.set $d (f32.add (f32.mul (local.get $dx) (local.get $dx)) (f32.mul (local.get $dz) (local.get $dz))))
        (if (i32.and (f32.lt (local.get $d) (local.get $best))
                     (f32.lt (f32.abs (f32.sub (f32.load offset=4 (local.get $a)) (local.get $y))) (f32.const @HH_TOUCH_H)))
          (then (local.set $best (local.get $d)) (local.set $at (local.get $k)))))))
  (if (i32.lt_s (local.get $at) (i32.const 0))
    (then
      ;; the first free place; failing one, the oldest pile's
      (local.set $left (i32.const 0x10000))
      (block $free
        (!for $k (i32.const 0) (i32.const @HH_NPILE)
          (local.set $a (call $hh_pile (local.get $k)))
          (if (i32.eqz (i32.load16_u offset=12 (local.get $a))) (then (local.set $at (local.get $k)) (br $free)))
          (if (i32.lt_u (i32.load16_u offset=14 (local.get $a)) (local.get $left))
            (then (local.set $left (i32.load16_u offset=14 (local.get $a))) (local.set $at (local.get $k))))))
      (local.set $a (call $hh_pile (local.get $at)))
      (f32.store (local.get $a) (local.get $x))
      (f32.store offset=4 (local.get $a) (local.get $y))
      (f32.store offset=8 (local.get $a) (local.get $z))
      (i32.store16 offset=12 (local.get $a) (i32.const 0)))
    (else (local.set $a (call $hh_pile (local.get $at)))))
  (local.set $n (i32.add (i32.load16_u offset=12 (local.get $a)) (local.get $n)))
  (i32.store16 offset=12 (local.get $a) (select (local.get $n) (i32.const 0xffff) (i32.lt_u (local.get $n) (i32.const 0xffff))))
  (i32.store16 offset=14 (local.get $a) (i32.const @HH_LIFE)))

;; What slot p carried by AO's count, down where it stood the tick before
;; (HIST: a slot taken again has a fresh record); it carries nothing now.
(func $hh_drop (param $p i32)
  (local $a i32)
  (local.set $a (i32.add (i32.add (i32.const @HIST) (i32.shl (local.get $p) (i32.const 4)))
                         (i32.mul (i32.and (i32.sub (i32.load (i32.const @HDR_TICK)) (i32.const 1)) (i32.const 31)) (i32.const @HIST_TICK))))
  (call $hh_lay (f32.load (local.get $a)) (f32.load offset=4 (local.get $a)) (f32.load offset=8 (local.get $a)) (call $hh_has (local.get $p)))
  (call $hh_set (local.get $p) (i32.const 0)))

;; A tick of play, in this order: the zone moves on when its time is up (not
;; on the clock's last tick: the match is over); skulls a slot never dropped
;; go down; every pile counts down, and at 0 is gone; each fighter alive, in
;; slot order, takes every pile its feet are at; each fighter alive in the
;; zone with skulls banks them.
(func $hh_tick (result i32)
  (local $t i32) (local $p i32) (local $k i32) (local $a i32) (local $n i32) (local $r i32) (local $any i32)
  (local.set $t (i32.load (i32.const @HDR_TICK)))
  (if (i32.and (i32.ge_u (local.get $t) (i32.load (i32.const @(AO + HH_MOVES)))) (i32.lt_u (local.get $t) (i32.load (i32.const @HDR_UNTIL))))
    (then
      (call $hh_put (i32.rem_u (i32.add (i32.load (i32.const @(AO + HH_AT))) (i32.const 1)) (i32.load (i32.const @MAP_NHILL))))
      (call $fx (i32.const 0) (i32.const @FX_MODE) (i32.const 255) (i32.load (i32.const @(AO + HH_AT)))
                (f32.load (i32.const @(AO + HH_X))) (f32.load (i32.const @(AO + HH_Y))) (f32.load (i32.const @(AO + HH_Z)))
                (f32.const @HH_MX_MOVE))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $n (call $hh_has (local.get $p)))
    (if (local.get $n)
      (then
        (if (i32.or (i32.eqz (call $a_alive (local.get $p)))
                    (i32.ne (i32.load16_u offset=@(MODE_REC + MR_AUX) (i32.shl (local.get $p) (i32.const 3))) (local.get $n)))
          (then (call $hh_drop (local.get $p)))))))
  (!for $k (i32.const 0) (i32.const @HH_NPILE)
    (local.set $a (call $hh_pile (local.get $k)))
    (if (i32.load16_u offset=12 (local.get $a))
      (then
        (local.set $n (i32.sub (i32.load16_u offset=14 (local.get $a)) (i32.const 1)))
        (i32.store16 offset=14 (local.get $a) (local.get $n))
        (if (local.get $n) (then (local.set $any (i32.const 1))) (else (i32.store16 offset=12 (local.get $a) (i32.const 0)))))))
  (if (local.get $any)
    (then
      (!for $p (i32.const 0) (i32.const @NPLAYER)
        (if (call $a_alive (local.get $p))
          (then
            (!for $k (i32.const 0) (i32.const @HH_NPILE)
              (local.set $a (call $hh_pile (local.get $k)))
              (local.set $n (i32.load16_u offset=12 (local.get $a)))
              (if (local.get $n)
                (then
                  (if (call $a_near (local.get $p) (f32.load (local.get $a)) (f32.load offset=4 (local.get $a)) (f32.load offset=8 (local.get $a))
                                    (f32.const @HH_TOUCH_R) (f32.const @HH_TOUCH_H))
                    (then
                      (call $hh_set (local.get $p) (i32.add (call $hh_has (local.get $p)) (local.get $n)))
                      (i32.store (i32.add (local.get $a) (i32.const 12)) (i32.const 0))
                      (call $fx (i32.const 0) (i32.const @FX_MODE) (local.get $p) (local.get $n)
                                (f32.load (local.get $a)) (f32.load offset=4 (local.get $a)) (f32.load offset=8 (local.get $a))
                                (f32.const @HH_MX_TAKE))))))))))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $n (call $hh_has (local.get $p)))
    (if (local.get $n)
      (then
        (if (call $a_alive (local.get $p))
          (then
            (if (call $a_near (local.get $p) (f32.load (i32.const @(AO + HH_X))) (f32.load (i32.const @(AO + HH_Y))) (f32.load (i32.const @(AO + HH_Z)))
                              (f32.load (i32.const @(AO + HH_R))) (f32.const @HH_ZONE_H))
              (then
                (call $a_score (call $a_team (local.get $p)) (local.get $n))
                (local.set $r (i32.shl (local.get $p) (i32.const 3)))
                (local.set $k (i32.add (i32.load16_u offset=@(MODE_REC + MR_POINTS) (local.get $r)) (local.get $n)))
                (i32.store16 offset=@(MODE_REC + MR_POINTS) (local.get $r) (select (local.get $k) (i32.const 0xffff) (i32.lt_u (local.get $k) (i32.const 0xffff))))
                (call $a_news (i32.const @HH_MX_BANK) (local.get $p) (local.get $n))
                (call $hh_set (local.get $p) (i32.const 0)))))))))
  (i32.const 0))

;; q died at a's hand (or its own): what it carried and one more, in a pile
;; at its feet. (A slot taken again this tick, before its new fighter died:
;; what the last one carried goes down where that one stood.)
(func $hh_kill (param $q i32) (param $a i32) (param $cause i32)
  (local $qb i32) (local $n i32)
  (local.set $n (i32.load16_u offset=@(MODE_REC + MR_AUX) (i32.shl (local.get $q) (i32.const 3))))
  (if (i32.ne (local.get $n) (call $hh_has (local.get $q))) (then (call $hh_drop (local.get $q))))
  (local.set $qb (i32.shl (local.get $q) (i32.const 6)))
  (call $hh_lay (!at f32 @(PLAYERS + P_PX) (local.get $qb)) (!at f32 @(PLAYERS + P_PY) (local.get $qb)) (!at f32 @(PLAYERS + P_PZ) (local.get $qb))
                (i32.add (local.get $n) (i32.const 1)))
  (call $hh_set (local.get $q) (i32.const 0)))

;; No spawn point is barred.
(func $hh_bar (param $x f32) (param $y f32) (param $z f32) (result i32)
  (i32.const 0))
