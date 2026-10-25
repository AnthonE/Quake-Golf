;; TERRITORIES (M_TERRITORY, prefix tr; constants and AO's fields in
;; src/am/territories.mjs): every one of the map's hill points (MAP_NHILL of
;; them at MAP_HILLS: f32 x, z, top, radius) a territory, all up at once. A
;; fighter is on one with its feet strictly within TR_R across of its point
;; and TR_H up or down of the point's height, as on King of the Hill's hill;
;; on the first in the map's order if it were on two. Each tick, after every
;; fighter's own, each side's live fighters on each are counted in slot
;; order, and each territory's gauge moves a step: toward the side with more
;; of them on it, still for as many each, and with nobody on it back toward
;; its holder's end (a nobody's toward neutral). A neutral one is a side's
;; when its gauge reaches that side's end (TR_CAP); a held one is nobody's
;; again when the other side has pushed its gauge back to neutral, and only
;; then can it be taken: so turning one takes 2 TR_CAP ticks. News at each.
;; Every TR_POINT ticks of play each side scores a point for each one it
;; holds; each fighter's ticks on one its side holds are counted (MR_AUX, to
;; TR_SEC) into its whole seconds (MR_POINTS). The core ends the match at
;; AH_TARGET or the clock. Nothing is barred to spawns, and a death leaves
;; a territory as a step off it does.

;; Territory k's record in AO (TR_TSIZE, 32 bytes, apart).
(func $tr_rec (param $k i32) (result i32)
  (i32.add (i32.const @(AO + TR_T)) (i32.shl (local.get $k) (i32.const 5))))

;; Its news (owner nobody, at territory k's centre): the side, 1 red or 2 blue, and k.
(func $tr_news (param $k i32) (param $what i32) (param $side i32)
  (local $a i32)
  (local.set $a (call $tr_rec (local.get $k)))
  (call $fx (i32.const 0) (i32.const @FX_MODE) (i32.const 255) (i32.or (local.get $side) (i32.shl (local.get $k) (i32.const 2)))
            (f32.load (local.get $a)) (f32.load offset=4 (local.get $a)) (f32.load offset=8 (local.get $a))
            (f32.convert_i32_u (local.get $what))))

;; Play begins: every territory laid out, neutral (AO is clear), its centre
;; at the feet height $stand gives its point; the target.
(func $tr_start
  (local $k i32) (local $n i32) (local $h i32) (local $a i32) (local $x f32) (local $z f32)
  (local.set $n (i32.load (i32.const @MAP_NHILL)))
  (local.set $n (select (local.get $n) (i32.const @NHILL) (i32.lt_u (local.get $n) (i32.const @NHILL))))
  (i32.store (i32.const @(AO + TR_N)) (local.get $n))
  (!for $k (i32.const 0) (local.get $n)
    (local.set $h (i32.add (i32.const @MAP_HILLS) (i32.shl (local.get $k) (i32.const 4))))
    (local.set $a (call $tr_rec (local.get $k)))
    (local.set $x (f32.load (local.get $h)))
    (local.set $z (f32.load offset=4 (local.get $h)))
    (f32.store offset=@TR_X (local.get $a) (local.get $x))
    (f32.store offset=@TR_Y (local.get $a) (call $stand (local.get $x) (local.get $z) (f32.load offset=8 (local.get $h))))
    (f32.store offset=@TR_Z (local.get $a) (local.get $z)))
  (i32.store (i32.const @AH_TARGET) (i32.const @TR_TARGET)))

;; A tick of play: who stands where, each territory's step, who holds what,
;; the points, each fighter's time.
(func $tr_tick (result i32)
  (local $p i32) (local $k i32) (local $n i32) (local $a i32) (local $at i32) (local $r i32)
  (local $red i32) (local $blue i32) (local $g i32) (local $hold i32) (local $d i32) (local $hr i32) (local $hb i32)
  (local.set $n (i32.load (i32.const @(AO + TR_N))))
  (!for $k (i32.const 0) (local.get $n)
    (i32.store offset=@TR_ON (call $tr_rec (local.get $k)) (i32.const 0)))
  ;; each live fighter on the first territory whose circle and band hold its
  ;; feet, counted for its side; where it stood kept for its time below
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $at (i32.const 0))
    (if (call $a_alive (local.get $p))
      (then
        (block $found
          (!for $k (i32.const 0) (local.get $n)
            (local.set $a (call $tr_rec (local.get $k)))
            (if (call $a_near (local.get $p) (f32.load (local.get $a)) (f32.load offset=4 (local.get $a)) (f32.load offset=8 (local.get $a))
                              (f32.const @TR_R) (f32.const @TR_H))
              (then
                (local.set $at (i32.add (local.get $k) (i32.const 1)))
                (local.set $a (i32.add (i32.add (local.get $a) (i32.const @TR_ON)) (i32.shl (call $a_team (local.get $p)) (i32.const 1))))
                (i32.store16 (local.get $a) (i32.add (i32.load16_u (local.get $a)) (i32.const 1)))
                (br $found)))))))
    (i32.store8 offset=@(AO + TR_AT) (local.get $p) (local.get $at)))
  ;; each territory a step
  (!for $k (i32.const 0) (local.get $n)
    (local.set $a (call $tr_rec (local.get $k)))
    (local.set $red (i32.load16_u offset=@TR_ON (local.get $a)))
    (local.set $blue (i32.load16_u offset=@(TR_ON + 2) (local.get $a)))
    (local.set $g (i32.load offset=@TR_GAUGE (local.get $a)))
    (local.set $hold (i32.load offset=@TR_HOLD (local.get $a)))
    ;; d: toward the side with more on it; as many each (and some), still;
    ;; nobody, toward its holder's end, or a nobody's toward neutral
    (local.set $d
      (if (result i32) (i32.ne (local.get $red) (local.get $blue))
        (then (select (i32.const 1) (i32.const -1) (i32.gt_u (local.get $red) (local.get $blue))))
        (else
          (if (result i32) (local.get $red)
            (then (i32.const 0))
            (else
              (select (i32.const 1)
                      (select (i32.const -1)
                              (i32.sub (i32.lt_s (local.get $g) (i32.const 0)) (i32.gt_s (local.get $g) (i32.const 0)))
                              (i32.eq (local.get $hold) (i32.const 2)))
                      (i32.eq (local.get $hold) (i32.const 1))))))))
    (local.set $g (i32.add (local.get $g) (local.get $d)))
    (local.set $g (select (i32.const @TR_CAP) (local.get $g) (i32.gt_s (local.get $g) (i32.const @TR_CAP))))
    (local.set $g (select (i32.const @(-TR_CAP)) (local.get $g) (i32.lt_s (local.get $g) (i32.const @(-TR_CAP)))))
    ;; a held one pushed back to neutral is nobody's; a nobody's at a side's end is that side's
    (if (i32.or (i32.and (i32.eq (local.get $hold) (i32.const 1)) (i32.le_s (local.get $g) (i32.const 0)))
                (i32.and (i32.eq (local.get $hold) (i32.const 2)) (i32.ge_s (local.get $g) (i32.const 0))))
      (then
        (call $tr_news (local.get $k) (i32.const @TR_MX_LOSE) (local.get $hold))
        (local.set $hold (i32.const 0))))
    (if (i32.and (i32.eqz (local.get $hold)) (i32.eq (local.get $g) (i32.const @TR_CAP)))
      (then (local.set $hold (i32.const 1)) (call $tr_news (local.get $k) (i32.const @TR_MX_TAKE) (i32.const 1))))
    (if (i32.and (i32.eqz (local.get $hold)) (i32.eq (local.get $g) (i32.const @(-TR_CAP))))
      (then (local.set $hold (i32.const 2)) (call $tr_news (local.get $k) (i32.const @TR_MX_TAKE) (i32.const 2))))
    (i32.store offset=@TR_GAUGE (local.get $a) (local.get $g))
    (i32.store offset=@TR_HOLD (local.get $a) (local.get $hold))
    (if (i32.eq (local.get $hold) (i32.const 1)) (then (!inc $hr)))
    (if (i32.eq (local.get $hold) (i32.const 2)) (then (!inc $hb))))
  (i32.store (i32.const @(AO + TR_HELD)) (local.get $hr))
  (i32.store (i32.const @(AO + TR_HELD + 4)) (local.get $hb))
  ;; every TR_POINT ticks of play, a point for each territory a side holds
  (if (i32.eqz (i32.rem_u (i32.sub (i32.load (i32.const @HDR_TICK)) (i32.load (i32.const @HDR_START))) (i32.const @TR_POINT)))
    (then
      (call $a_score (i32.const 0) (local.get $hr))
      (call $a_score (i32.const 1) (local.get $hb))))
  ;; a fighter's tick on a territory its side holds now, toward its seconds
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $at (i32.load8_u offset=@(AO + TR_AT) (local.get $p)))
    (if (local.get $at)
      (then
        (if (i32.eq (i32.load offset=@TR_HOLD (call $tr_rec (i32.sub (local.get $at) (i32.const 1))))
                    (i32.add (call $a_team (local.get $p)) (i32.const 1)))
          (then
            (local.set $r (i32.shl (local.get $p) (i32.const 3)))
            (local.set $d (i32.add (i32.load16_u offset=@(MODE_REC + MR_AUX) (local.get $r)) (i32.const 1)))
            (if (i32.ge_u (local.get $d) (i32.const @TR_SEC))
              (then
                (local.set $d (i32.const 0))
                (i32.store16 offset=@(MODE_REC + MR_POINTS) (local.get $r)
                             (i32.add (i32.load16_u offset=@(MODE_REC + MR_POINTS) (local.get $r)) (i32.const 1)))))
            (i32.store16 offset=@(MODE_REC + MR_AUX) (local.get $r) (local.get $d)))))))
  (i32.const 0))

;; A death just leaves the territory.
(func $tr_kill (param $q i32) (param $a i32) (param $cause i32))

;; Nothing barred: a side may spawn on a territory (its roof's) and start taking it.
(func $tr_bar (param $x f32) (param $y f32) (param $z f32) (result i32)
  (i32.const 0))
