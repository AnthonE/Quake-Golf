;; ASSAULT (M_ASSAULT, prefix as; constants and the bomb's fields in AO in
;; src/am/assault.mjs): one bomb, in the middle (MAP_BALL, at its feet height
;; by $stand) as play starts, and a plate for each side at its stand
;; (MAP_FLAGS', as CTF's flags stand). The first fighter alive in slot order
;; to touch it takes it, either side ($a_carry: no guns, a swing that kills),
;; and it rides at its carrier's feet. A carrier with its feet on the other
;; side's plate (within AS_PLATE_R across, AS_TOUCH_H up or down) for AS_ARM
;; ticks in a row plants it there, on the stand; the count starts over as it
;; steps off, and dies with it. A planted bomb goes off AS_FUSE ticks after
;; the plant's: a point for the side that planted it and one for its planter
;; (MR_POINTS), and the other side's fighters alive within AS_BLAST_R across
;; and AS_BLAST_H up or down are killed by its planter, in slot order (its
;; own side is spared, as from any of its fire; a planter who has left takes
;; the blast with it, the point still its side's). Unless, first, one of the
;; plate's own side stands on it (as on a skull to take it) for AS_DEFUSE
;; ticks in a row, one or another: then it's defused, MR_AUX for the first
;; of them in slot order on it then; the count starts over when none is on
;; it, and a defuse on what would be its last tick comes first. Gone off or
;; defused, it's back in the middle. A carrier who dies or leaves drops it on
;; whatever is under its feet; dropped, it goes back to the middle after
;; AS_RETURN ticks (counting the one it fell on) unless someone takes it
;; first. The core ends the match at AH_TARGET or the clock. Each event is
;; news (FX_MODE, AS_MX_*: owner who did it or 255, shot a side).

;; Plate k (0 red's, 1 blue's) in AO: f32 x, y, z.
(func $as_plate (param $k i32) (result i32)
  (i32.add (i32.const @(AO + AS_PLATE)) (i32.mul (local.get $k) (i32.const 12))))

;; Play begins: the middle and both plates resolved from the map, the bomb in
;; the middle; the target.
(func $as_start
  (local $k i32) (local $m i32) (local $a i32) (local $x f32) (local $z f32)
  (local.set $x (f32.load (i32.const @MAP_BALL)))
  (local.set $z (f32.load (i32.const @(MAP_BALL + 4))))
  (f32.store (i32.const @(AO + AS_SPOT)) (local.get $x))
  (f32.store (i32.const @(AO + AS_SPOT + 4)) (call $stand (local.get $x) (local.get $z) (f32.load (i32.const @(MAP_BALL + 8)))))
  (f32.store (i32.const @(AO + AS_SPOT + 8)) (local.get $z))
  (!for $k (i32.const 0) (i32.const 2)
    (local.set $m (i32.add (i32.const @MAP_FLAGS) (i32.shl (local.get $k) (i32.const 4))))
    (local.set $a (call $as_plate (local.get $k)))
    (f32.store (local.get $a) (f32.load (local.get $m)))
    (f32.store offset=4 (local.get $a) (call $stand (f32.load (local.get $m)) (f32.load offset=4 (local.get $m)) (f32.load offset=8 (local.get $m))))
    (f32.store offset=8 (local.get $a) (f32.load offset=4 (local.get $m))))
  (call $as_home)
  (i32.store (i32.const @AH_TARGET) (i32.const @AS_TARGET)))

;; Every tick of play, in this order: planted, it burns (a planter gone is
;; forgotten; the plate's side on it defuses it, else the fuse runs down and
;; it goes off); carried, a carrier no longer live, alive or carrying (it
;; left, its slot rejoined, a death the kill hook didn't see) drops it where
;; it last had it, else it follows its carrier and arms on their plate;
;; dropped, it counts down and at 0 goes back to the middle; in the middle
;; or dropped, the first fighter in slot order alive and not carrying with
;; its feet within AS_TOUCH_R across and AS_TOUCH_H up or down takes it.
;; Planted first, so a plant's own tick burns none of its fuse.
(func $as_tick (result i32)
  (local $c i32) (local $cb i32) (local $side i32) (local $a i32) (local $n i32) (local $p i32)
  (local.set $side (i32.load8_u (i32.const @(AO + AS_SIDE))))
  (if (i32.eq (i32.load8_u (i32.const @(AO + AS_STATE))) (i32.const @AS_PLANTED))
    (then (call $as_burn (local.get $side))))
  (local.set $c (i32.load8_u (i32.const @(AO + AS_BY))))
  (local.set $cb (i32.shl (local.get $c) (i32.const 6)))
  (if (i32.eq (i32.load8_u (i32.const @(AO + AS_STATE))) (i32.const @AS_CARRIED))
    (then
      (if (i32.ne (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $cb)) (i32.const @(PF_LIVE | PF_DEAD | PF_CARRY))) (i32.const @(PF_LIVE | PF_CARRY)))
        (then
          (call $a_carry (local.get $c) (i32.const 0))
          (call $as_drop (f32.load (i32.const @(AO + AS_POS))) (f32.load (i32.const @(AO + AS_POS + 4))) (f32.load (i32.const @(AO + AS_POS + 8))) (local.get $c)))
        (else
          (f32.store (i32.const @(AO + AS_POS)) (!at f32 @(PLAYERS + P_PX) (local.get $cb)))
          (f32.store (i32.const @(AO + AS_POS + 4)) (!at f32 @(PLAYERS + P_PY) (local.get $cb)))
          (f32.store (i32.const @(AO + AS_POS + 8)) (!at f32 @(PLAYERS + P_PZ) (local.get $cb)))
          ;; on their plate: a tick nearer the plant; off it, from 0 again
          (local.set $a (call $as_plate (i32.sub (i32.const 1) (local.get $side))))
          (local.set $n (i32.const 0))
          (if (call $a_near (local.get $c) (f32.load (local.get $a)) (f32.load offset=4 (local.get $a)) (f32.load offset=8 (local.get $a))
                            (f32.const @AS_PLATE_R) (f32.const @AS_TOUCH_H))
            (then (local.set $n (i32.add (i32.load16_u (i32.const @(AO + AS_ARMING))) (i32.const 1)))))
          (i32.store16 (i32.const @(AO + AS_ARMING)) (local.get $n))
          (if (i32.ge_u (local.get $n) (i32.const @AS_ARM)) (then (call $as_plant (local.get $c))))))))
  (if (i32.eq (i32.load8_u (i32.const @(AO + AS_STATE))) (i32.const @AS_DROPPED))
    (then
      (local.set $n (i32.sub (i32.load16_u (i32.const @(AO + AS_LEFT))) (i32.const 1)))
      (if (i32.gt_s (local.get $n) (i32.const 0))
        (then (i32.store16 (i32.const @(AO + AS_LEFT)) (local.get $n)))
        (else
          (call $as_home)
          (call $as_news (i32.const @AS_MX_HOME) (i32.const 255) (local.get $side))))))
  (local.set $n (i32.load8_u (i32.const @(AO + AS_STATE))))
  (if (i32.or (i32.eq (local.get $n) (i32.const @AS_HOME)) (i32.eq (local.get $n) (i32.const @AS_DROPPED)))
    (then
      (block $took
        (!for $p (i32.const 0) (i32.const @NPLAYER)
          (if (i32.eq (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $p) (i32.const 6))) (i32.const @(PF_LIVE | PF_DEAD | PF_CARRY))) (i32.const @PF_LIVE))
            (then
              (if (call $a_near (local.get $p) (f32.load (i32.const @(AO + AS_POS))) (f32.load (i32.const @(AO + AS_POS + 4))) (f32.load (i32.const @(AO + AS_POS + 8)))
                                (f32.const @AS_TOUCH_R) (f32.const @AS_TOUCH_H))
                (then (call $as_take (local.get $p)) (br $took)))))))))
  (i32.const 0))

;; A planted bomb's tick (side planted it): its planter forgotten if it has
;; left (its slot empty, or someone's on the other side); the defuse count, a
;; tick on with one of the plate's side alive on it (and on its last, the
;; defuse) or from 0 again with none; then, still planted, its fuse.
(func $as_burn (param $side i32)
  (local $by i32) (local $p i32) (local $who i32) (local $n i32)
  (local.set $by (i32.load8_u (i32.const @(AO + AS_BY))))
  (if (i32.ne (local.get $by) (i32.const 255))
    (then
      (if (i32.or (i32.eqz (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $by) (i32.const 6))) (i32.const @PF_LIVE)))
                  (i32.ne (call $a_team (local.get $by)) (local.get $side)))
        (then (i32.store8 (i32.const @(AO + AS_BY)) (i32.const 255))))))
  (local.set $who (i32.const -1))
  (block $found
    (!for $p (i32.const 0) (i32.const @NPLAYER)
      (if (i32.and (i32.and (call $a_alive (local.get $p)) (i32.ne (call $a_team (local.get $p)) (local.get $side)))
                   (call $a_near (local.get $p) (f32.load (i32.const @(AO + AS_POS))) (f32.load (i32.const @(AO + AS_POS + 4))) (f32.load (i32.const @(AO + AS_POS + 8)))
                                 (f32.const @AS_TOUCH_R) (f32.const @AS_TOUCH_H)))
        (then (local.set $who (local.get $p)) (br $found)))))
  (local.set $n (i32.const 0))
  (if (i32.ge_s (local.get $who) (i32.const 0)) (then (local.set $n (i32.add (i32.load16_u (i32.const @(AO + AS_DEFUSING))) (i32.const 1)))))
  (i32.store16 (i32.const @(AO + AS_DEFUSING)) (local.get $n))
  (if (i32.ge_u (local.get $n) (i32.const @AS_DEFUSE))
    (then
      (i32.store16 offset=@(MODE_REC + MR_AUX) (i32.shl (local.get $who) (i32.const 3))
        (i32.add (i32.load16_u offset=@(MODE_REC + MR_AUX) (i32.shl (local.get $who) (i32.const 3))) (i32.const 1)))
      (call $as_news (i32.const @AS_MX_DEFUSE) (local.get $who) (i32.sub (i32.const 1) (local.get $side)))
      (call $as_home)
      (return)))
  (local.set $n (i32.sub (i32.load16_u (i32.const @(AO + AS_LEFT))) (i32.const 1)))
  (if (i32.gt_s (local.get $n) (i32.const 0))
    (then (i32.store16 (i32.const @(AO + AS_LEFT)) (local.get $n)))
    (else (call $as_boom (local.get $side)))))

;; It goes off (side planted it): a point for the side and for its planter,
;; news, then the blast: the other side's fighters alive within AS_BLAST_R
;; across and AS_BLAST_H up or down of it killed by its planter, in slot
;; order (none if its planter has left); then back to the middle.
(func $as_boom (param $side i32)
  (local $by i32) (local $q i32) (local $r i32) (local $x f32) (local $y f32) (local $z f32)
  (local.set $by (i32.load8_u (i32.const @(AO + AS_BY))))
  (local.set $x (f32.load (i32.const @(AO + AS_POS))))
  (local.set $y (f32.load (i32.const @(AO + AS_POS + 4))))
  (local.set $z (f32.load (i32.const @(AO + AS_POS + 8))))
  (call $a_score (local.get $side) (i32.const 1))
  (call $as_news (i32.const @AS_MX_BOOM) (local.get $by) (local.get $side))
  (if (i32.ne (local.get $by) (i32.const 255))
    (then
      (local.set $r (i32.shl (local.get $by) (i32.const 3)))
      (i32.store16 offset=@(MODE_REC + MR_POINTS) (local.get $r) (i32.add (i32.load16_u offset=@(MODE_REC + MR_POINTS) (local.get $r)) (i32.const 1)))
      (!for $q (i32.const 0) (i32.const @NPLAYER)
        (if (i32.and (i32.and (call $a_alive (local.get $q)) (i32.ne (call $a_team (local.get $q)) (local.get $side)))
                     (call $a_near (local.get $q) (local.get $x) (local.get $y) (local.get $z) (f32.const @AS_BLAST_R) (f32.const @AS_BLAST_H)))
          (then (call $a_kill (local.get $q) (local.get $by) (i32.const @KILL_CARRY)))))))
  (call $as_home))

;; q died at a's hand: if q had the bomb, it drops on whatever is under q's
;; feet (the core clears q's PF_CARRY after).
(func $as_kill (param $q i32) (param $a i32) (param $cause i32)
  (local $qb i32)
  (if (i32.and (i32.eq (i32.load8_u (i32.const @(AO + AS_STATE))) (i32.const @AS_CARRIED))
               (i32.eq (i32.load8_u (i32.const @(AO + AS_BY))) (local.get $q)))
    (then
      (local.set $qb (i32.shl (local.get $q) (i32.const 6)))
      (call $as_drop (!at f32 @(PLAYERS + P_PX) (local.get $qb)) (!at f32 @(PLAYERS + P_PY) (local.get $qb)) (!at f32 @(PLAYERS + P_PZ) (local.get $qb))
                     (local.get $q)))))

;; Slot p takes the bomb where it lies: carried, on p's side, at p's feet.
(func $as_take (param $p i32)
  (local $pb i32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (i32.store8 (i32.const @(AO + AS_STATE)) (i32.const @AS_CARRIED))
  (i32.store8 (i32.const @(AO + AS_BY)) (local.get $p))
  (i32.store8 (i32.const @(AO + AS_SIDE)) (call $a_team (local.get $p)))
  (i32.store16 (i32.const @(AO + AS_LEFT)) (i32.const 0))
  (i32.store16 (i32.const @(AO + AS_ARMING)) (i32.const 0))
  (call $a_carry (local.get $p) (i32.const 1))
  (call $as_news (i32.const @AS_MX_TAKE) (local.get $p) (i32.load8_u (i32.const @(AO + AS_SIDE))))
  (f32.store (i32.const @(AO + AS_POS)) (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (f32.store (i32.const @(AO + AS_POS + 4)) (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
  (f32.store (i32.const @(AO + AS_POS + 8)) (!at f32 @(PLAYERS + P_PZ) (local.get $pb))))

;; Slot c, its carrier, plants it: on the stand of the plate it stands on
;; (the other side's), AS_FUSE to burn; c's hands its guns again.
(func $as_plant (param $c i32)
  (local $side i32)
  (local.set $side (i32.load8_u (i32.const @(AO + AS_SIDE))))
  (call $a_carry (local.get $c) (i32.const 0))
  (memory.copy (i32.const @(AO + AS_POS)) (call $as_plate (i32.sub (i32.const 1) (local.get $side))) (i32.const 12))
  (i32.store8 (i32.const @(AO + AS_STATE)) (i32.const @AS_PLANTED))
  (i32.store16 (i32.const @(AO + AS_LEFT)) (i32.const @AS_FUSE))
  (i32.store16 (i32.const @(AO + AS_ARMING)) (i32.const 0))
  (i32.store16 (i32.const @(AO + AS_DEFUSING)) (i32.const 0))
  (call $as_news (i32.const @AS_MX_PLANT) (local.get $c) (local.get $side)))

;; The bomb put down at (x, y, z), on what it would land on falling from
;; there (the ground or a box top, as $move finds it), AS_RETURN ticks to go;
;; owner p had it.
(func $as_drop (param $x f32) (param $y f32) (param $z f32) (param $p i32)
  (f32.store (i32.const @(AO + AS_POS)) (local.get $x))
  (f32.store (i32.const @(AO + AS_POS + 4)) (call $stand (local.get $x) (local.get $z) (f32.add (local.get $y) (f32.const 0.01))))
  (f32.store (i32.const @(AO + AS_POS + 8)) (local.get $z))
  (i32.store8 (i32.const @(AO + AS_STATE)) (i32.const @AS_DROPPED))
  (i32.store16 (i32.const @(AO + AS_LEFT)) (i32.const @AS_RETURN))
  (i32.store16 (i32.const @(AO + AS_ARMING)) (i32.const 0))
  (call $as_news (i32.const @AS_MX_DROP) (local.get $p) (i32.load8_u (i32.const @(AO + AS_SIDE)))))

;; The bomb back in the middle, its counts clear.
(func $as_home
  (memory.copy (i32.const @(AO + AS_POS)) (i32.const @(AO + AS_SPOT)) (i32.const 12))
  (i32.store8 (i32.const @(AO + AS_STATE)) (i32.const @AS_HOME))
  (i32.store16 (i32.const @(AO + AS_LEFT)) (i32.const 0))
  (i32.store16 (i32.const @(AO + AS_ARMING)) (i32.const 0))
  (i32.store16 (i32.const @(AO + AS_DEFUSING)) (i32.const 0)))

;; News for the feed, at the bomb.
(func $as_news (param $what i32) (param $owner i32) (param $shot i32)
  (call $fx (i32.const 0) (i32.const @FX_MODE) (local.get $owner) (local.get $shot)
            (f32.load (i32.const @(AO + AS_POS))) (f32.load (i32.const @(AO + AS_POS + 4))) (f32.load (i32.const @(AO + AS_POS + 8)))
            (f32.convert_i32_u (local.get $what))))

;; No spawn point is barred.
(func $as_bar (param $x f32) (param $y f32) (param $z f32) (result i32)
  (i32.const 0))
