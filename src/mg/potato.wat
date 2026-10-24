;; HOT POTATO: a disc over the sea, sized for the crowd, and bombs: one for
;; every HP_PER balls in, dealt at random, lit HP_DEAL0 into play. A holder
;; that touches a ball without one passes it on (a bomb just got sticks
;; HP_COOL first, so it can't bounce straight back), and a holder rolls a
;; little faster (HP_HASTE). When the wave's fuse runs out every holder blows
;; up: out where it stands, a blast round it, the KO to whoever passed it the
;; bomb. Then the edge falls in for the balls left and, HP_REST after the
;; boom, the next wave's bombs are lit, on a fuse a second shorter. Off the
;; edge is out too; the last ball in wins.
;;
;; Who holds a bomb is the confirmed world's (a pass is ball against ball, a
;; round trip late like a bump); everything else is scheduled ahead in PG_H.
;; The next wave's holders are picked at the boom (the first wave's as the
;; round is laid out) into PG_S, and each takes its bomb in its own move on
;; the deal's tick, on either bank: the confirmed world has the picks long
;; before any prediction reaches the deal, so a holder's haste is predicted
;; exactly from the tick it's lit. The edge is a function of the tick and the
;; header (from HP_RAD to HP_RNEXT between HP_SHRINK0 after the boom and the
;; deal), so ground is exact on both banks.

;; The disc for n balls.
(func $hp_size (param $n i32) (result f32)
  (f32.min (!madd (f32.sqrt (f32.convert_i32_u (local.get $n))) (f32.const @HP_RK) (f32.const @HP_R0)) (f32.const @HP_RMAX)))

;; Wave w's fuse, in ticks: HP_FUSE0, a second shorter each wave, at least HP_FUSE1.
(func $hp_fuse (param $w i32) (result i32)
  (local $f i32)
  (local.set $f (i32.sub (i32.const @HP_FUSE0) (i32.mul (select (local.get $w) (i32.const 64) (i32.lt_u (local.get $w) (i32.const 64))) (i32.const @HP_FUSEK))))
  (select (local.get $f) (i32.const @HP_FUSE1) (i32.gt_s (local.get $f) (i32.const @HP_FUSE1))))

;; Bombs for n balls in: one for every HP_PER, rounded, at least 1 (none for nobody), at most HP_BMAX.
(func $hp_bombs (param $n i32) (result i32)
  (local $k i32)
  (local.set $k (i32.div_u (i32.add (local.get $n) (i32.const 1)) (i32.const @HP_PER)))
  (if (i32.eqz (local.get $k)) (then (local.set $k (i32.const 1))))
  (if (i32.gt_u (local.get $k) (i32.const @HP_BMAX)) (then (local.set $k (i32.const @HP_BMAX))))
  (select (local.get $k) (local.get $n) (i32.lt_u (local.get $k) (local.get $n))))

;; The disc's radius on tick t into play on bank d: as the last boom left it
;; until HP_SHRINK0 after, then in a straight line to HP_RNEXT by the deal.
(func $hp_rim (param $d i32) (param $t i32) (result f32)
  (local $a i32) (local $b i32) (local $r0 f32) (local $r1 f32)
  (local.set $r0 (f32.load offset=@(PG_H + HP_RAD) (local.get $d)))
  (local.set $r1 (f32.load offset=@(PG_H + HP_RNEXT) (local.get $d)))
  (local.set $a (i32.add (i32.load offset=@(PG_H + HP_LAST) (local.get $d)) (i32.const @HP_SHRINK0)))
  (local.set $b (i32.load offset=@(PG_H + HP_DEAL) (local.get $d)))
  (if (i32.ge_s (local.get $t) (local.get $b)) (then (return (local.get $r1))))
  (if (i32.le_s (local.get $t) (local.get $a)) (then (return (local.get $r0))))
  (!madd (f32.sub (local.get $r1) (local.get $r0))
         (f32.div (f32.convert_i32_s (i32.sub (local.get $t) (local.get $a))) (f32.convert_i32_s (i32.sub (local.get $b) (local.get $a))))
         (local.get $r0)))

;; Does slot p hold a bomb (and is it in, not out)?
(func $hp_holds (param $pb i32) (result i32)
  (i32.and (i32.ne (i32.and (!at u8 @(PLAYERS + HP_FL) (local.get $pb)) (i32.const @HP_HOLD)) (i32.const 0))
           (i32.eq (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE))))

;; Is slot p a candidate for a bomb: in (as $p_in has it), or as the round is
;; laid out (all), in the room?
(func $hp_can (param $p i32) (param $all i32) (result i32)
  (local $pb i32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (if (result i32) (local.get $all)
    (then (i32.ne (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_LIVE)) (i32.const 0)))
    (else (call $p_in (local.get $pb)))))

;; k of the candidates, picked by the PRNG for wave w's deal (selection
;; sampling: each in slot order with the chance of the picks still wanted
;; over the candidates still to see).
(func $hp_pick (param $k i32) (param $w i32) (param $all i32)
  (local $p i32) (local $m i32)
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (if (call $hp_can (local.get $p) (local.get $all)) (then (!inc $m))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (if (call $hp_can (local.get $p) (local.get $all))
      (then
        (if (i32.lt_u (i32.rem_u (call $rand) (local.get $m)) (local.get $k))
          (then
            (!st u8 @(PG_S + HP_NEXT) (local.get $p) (i32.add (local.get $w) (i32.const 1)))
            (local.set $k (i32.sub (local.get $k) (i32.const 1)))))
        (local.set $m (i32.sub (local.get $m) (i32.const 1)))))))

;; The disc for the crowd and the first wave: its holders picked now (so they
;; show through the countdown), lit HP_DEAL0 into play.
(func $hp_setup (param $n i32)
  (local $r f32) (local $k i32)
  (local.set $r (call $hp_size (local.get $n)))
  (!chk (local.get $r) 81 (local.get $n))
  (local.set $k (call $hp_bombs (local.get $n)))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_OUT))
  (i32.store (i32.const @PG_LEN) (i32.const @HP_LEN))
  (f32.store (i32.const @PG_SIZE) (local.get $r))
  (f32.store (i32.const @(PG_H + HP_RAD)) (local.get $r))
  (f32.store (i32.const @(PG_H + HP_RNEXT)) (local.get $r))
  (i32.store (i32.const @(PG_H + HP_DEAL)) (i32.const @HP_DEAL0))
  (i32.store (i32.const @(PG_H + HP_BOOM)) (i32.add (i32.const @HP_DEAL0) (call $hp_fuse (i32.const 0))))
  (i32.store (i32.const @(PG_H + HP_FUSE)) (call $hp_fuse (i32.const 0)))
  (i32.store (i32.const @(PG_H + HP_BOMBS)) (local.get $k))
  (call $hp_pick (local.get $k) (i32.const 0) (i32.const 1)))

;; A sunflower spiral over the middle of the disc.
(func $hp_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $x f32) (local $z f32)
  (call $p_disc (local.get $i) (local.get $n) (f32.mul (f32.load (i32.const @(PG_H + HP_RAD))) (f32.const @HP_SPAWN)))
  (local.set $z) (local.set $x)
  (local.get $x) (f32.const @PLAT_Y) (local.get $z))

(func $hp_start)

;; The floor's top within the edge as it is on bank d's tick.
(func $hp_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (local $r f32) (local $dx f32) (local $dz f32)
  (if (f32.lt (local.get $y) (f32.const @PLAT_Y)) (then (return (f32.const -1000))))
  (local.set $r (call $hp_rim (local.get $d) (call $p_t (local.get $d))))
  (local.set $dx (f32.sub (local.get $x) (f32.load offset=@PG_CX (local.get $d))))
  (local.set $dz (f32.sub (local.get $z) (f32.load offset=@PG_CX (local.get $d))))
  (if (result f32) (f32.le (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))) (f32.mul (local.get $r) (local.get $r)))
    (then (f32.const @PLAT_Y))
    (else (f32.const -1000))))

;; On the deal's tick a ball picked for the wave takes its bomb; a holder on
;; the ground gets HP_HASTE more of its push, along the way its keys push it.
(func $hp_push (param $p i32) (param $d i32)
  (local $pb i32) (local $in i32) (local $t i32) (local $s f32) (local $c f32) (local $fwd f32) (local $side f32) (local $wx f32) (local $wz f32)
  (local $len f32) (local $a f32) (local $vx f32) (local $vz f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (local.set $t (call $p_t (local.get $d)))
  (if (i32.and (i32.eq (local.get $t) (i32.load offset=@(PG_H + HP_DEAL) (local.get $d)))
               (i32.eq (!ld u8 @(PG_S + HP_NEXT) (local.get $p)) (i32.add (i32.load offset=@(PG_H + HP_WAVE) (local.get $d)) (i32.const 1))))
    (then
      (!put u8 @(PLAYERS + HP_FL) (local.get $pb) (i32.or (!at u8 @(PLAYERS + HP_FL) (local.get $pb)) (i32.const @HP_HOLD)))
      (!put u8 @(PLAYERS + HP_BY) (local.get $pb) (i32.const 255))
      (!put u16 @(PLAYERS + HP_AT) (local.get $pb) (local.get $t))))
  (if (i32.eqz (i32.and (!at u8 @(PLAYERS + HP_FL) (local.get $pb)) (i32.const @HP_HOLD))) (then (return)))
  (if (i32.ne (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @(PF_GROUND | PF_FALL))) (i32.const @PF_GROUND)) (then (return)))
  ;; where the keys push it, as $b_move has it
  (local.set $in (!at i32 @(PLAYERS + P_IN) (local.get $pb)))
  (call $sincos (local.get $in))
  (local.set $c) (local.set $s)
  (local.set $fwd (f32.convert_i32_s (i32.sub (i32.and (i32.shr_u (local.get $in) (i32.const 24)) (i32.const 1))
                                              (i32.and (i32.shr_u (local.get $in) (i32.const 25)) (i32.const 1)))))
  (local.set $side (f32.convert_i32_s (i32.sub (i32.and (i32.shr_u (local.get $in) (i32.const 27)) (i32.const 1))
                                               (i32.and (i32.shr_u (local.get $in) (i32.const 26)) (i32.const 1)))))
  (local.set $wx (f32.sub (f32.mul (local.get $c) (local.get $fwd)) (f32.mul (local.get $s) (local.get $side))))
  (local.set $wz (f32.add (f32.mul (local.get $s) (local.get $fwd)) (f32.mul (local.get $c) (local.get $side))))
  (local.set $len (f32.sqrt (f32.add (f32.mul (local.get $wx) (local.get $wx)) (f32.mul (local.get $wz) (local.get $wz)))))
  (if (f32.eq (local.get $len) (f32.const 0)) (then (return)))
  (local.set $a (f32.div (f32.mul (f32.mul (f32.const @B_ACC_DT) (f32.const @HP_HASTE)) (f32.load offset=@PG_ACC (local.get $d))) (local.get $len)))
  (local.set $vx (!madd (local.get $wx) (local.get $a) (!at f32 @(PLAYERS + P_VX) (local.get $pb))))
  (local.set $vz (!madd (local.get $wz) (local.get $a) (!at f32 @(PLAYERS + P_VZ) (local.get $pb))))
  (!chk (local.get $vx) 82 (local.get $p))
  (!chk (local.get $vz) 83 (local.get $p))
  (!put f32 @(PLAYERS + P_VX) (local.get $pb) (local.get $vx))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (local.get $vz)))

;; The wave goes off: every holder out where it stands, the KO to whoever
;; passed it the bomb (none for a bomb dealt), then each a blast (those blown
;; are out already, so it shoves only the balls still in). Then the next
;; wave: its holders picked from the balls left, the edge in for them by the
;; deal, HP_REST from now, its fuse a second shorter (and gone off by the
;; round's end at the latest).
(func $hp_boom (param $t i32)
  (local $p i32) (local $pb i32) (local $by i32) (local $n i32) (local $m i32) (local $k i32) (local $w i32) (local $deal i32) (local $boom i32)
  (local $r f32)
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (if (call $hp_holds (local.get $pb))
      (then
        (local.set $by (!at u8 @(PLAYERS + HP_BY) (local.get $pb)))
        (!put u8 @(PLAYERS + B_HITBY) (local.get $pb) (local.get $by))
        (!put u16 @(PLAYERS + B_HITT) (local.get $pb) (i32.ne (local.get $by) (i32.const 255)))
        (!put u8 @(PLAYERS + HP_FL) (local.get $pb) (i32.or (!at u8 @(PLAYERS + HP_FL) (local.get $pb)) (i32.const @HP_BLOWN)))
        (call $p_out (local.get $p))
        (!inc $n))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (if (i32.and (!at u8 @(PLAYERS + HP_FL) (local.get $pb)) (i32.const @HP_BLOWN))
      (then
        (!put u8 @(PLAYERS + HP_FL) (local.get $pb) (i32.and (!at u8 @(PLAYERS + HP_FL) (local.get $pb)) (i32.const @(255 ^ HP_BLOWN))))
        (call $b_blast (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (call $b_rad (local.get $pb)))
                       (!at f32 @(PLAYERS + P_PZ) (local.get $pb)) (f32.const @HP_BLAST_R) (f32.const @HP_BLAST_S) (local.get $p)))))
  (local.set $w (i32.load (i32.const @(PG_H + HP_WAVE))))
  (call $fx (i32.const 0) (i32.const @HP_FX_BOOM) (i32.const 255) (local.get $n)
            (f32.load (i32.const @PG_CX)) (f32.const @PLAT_Y) (f32.load (i32.const @PG_CX)) (f32.convert_i32_u (local.get $w)))
  (local.set $w (i32.add (local.get $w) (i32.const 1)))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (if (call $hp_can (local.get $p) (i32.const 0)) (then (!inc $m))))
  (local.set $k (call $hp_bombs (local.get $m)))
  (call $hp_pick (local.get $k) (local.get $w) (i32.const 0))
  (local.set $r (f32.min (call $hp_size (local.get $m)) (f32.load (i32.const @(PG_H + HP_RNEXT)))))
  (!chk (local.get $r) 84 (local.get $m))
  (local.set $deal (i32.add (local.get $t) (i32.const @HP_REST)))
  (local.set $boom (i32.add (local.get $deal) (call $hp_fuse (local.get $w))))
  (if (i32.gt_u (local.get $boom) (i32.load (i32.const @PG_LEN))) (then (local.set $boom (i32.load (i32.const @PG_LEN)))))
  (i32.store (i32.const @(PG_H + HP_WAVE)) (local.get $w))
  (f32.store (i32.const @(PG_H + HP_RAD)) (f32.load (i32.const @(PG_H + HP_RNEXT))))
  (f32.store (i32.const @(PG_H + HP_RNEXT)) (local.get $r))
  (f32.store (i32.const @PG_SIZE) (local.get $r))
  (i32.store (i32.const @(PG_H + HP_LAST)) (local.get $t))
  (i32.store (i32.const @(PG_H + HP_DEAL)) (local.get $deal))
  (i32.store (i32.const @(PG_H + HP_BOOM)) (local.get $boom))
  (i32.store (i32.const @(PG_H + HP_FUSE)) (i32.sub (local.get $boom) (local.get $deal)))
  (i32.store (i32.const @(PG_H + HP_BOMBS)) (local.get $k)))

;; The deal's FX; every holder in, its bomb stuck no more, that touches a ball
;; in without one passes it on (in slot order, one pass a holder a tick, the
;; one that took it stuck now); then the fuse.
(func $hp_tick
  (local $t i32) (local $p i32) (local $q i32) (local $pb i32) (local $qb i32)
  (local $rp f32) (local $rs f32) (local $px f32) (local $py f32) (local $pz f32) (local $dx f32) (local $dy f32) (local $dz f32)
  (local.set $t (call $p_t (i32.const 0)))
  (if (i32.eq (local.get $t) (i32.load (i32.const @(PG_H + HP_DEAL))))
    (then (call $fx (i32.const 0) (i32.const @HP_FX_DEAL) (i32.const 255) (i32.load (i32.const @(PG_H + HP_BOMBS)))
                    (f32.load (i32.const @PG_CX)) (f32.const @PLAT_Y) (f32.load (i32.const @PG_CX)) (f32.convert_i32_u (i32.load (i32.const @(PG_H + HP_FUSE)))))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (if (i32.and (i32.and (call $hp_holds (local.get $pb)) (call $p_in (local.get $pb)))
                 (i32.ge_s (i32.sub (local.get $t) (!at u16 @(PLAYERS + HP_AT) (local.get $pb))) (i32.const @HP_COOL)))
      (then
        (local.set $rp (call $b_rad (local.get $pb)))
        (local.set $px (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
        (local.set $py (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (local.get $rp)))
        (local.set $pz (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
        (block $passed
          (!for $q (i32.const 0) (i32.const @NPLAYER)
            (local.set $qb (i32.shl (local.get $q) (i32.const 6)))
            (if (i32.and (call $p_in (local.get $qb)) (i32.eqz (i32.and (!at u8 @(PLAYERS + HP_FL) (local.get $qb)) (i32.const @HP_HOLD))))
              (then
                (local.set $rs (f32.add (f32.add (local.get $rp) (call $b_rad (local.get $qb))) (f32.const @HP_TOUCH)))
                (local.set $dx (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $qb)) (local.get $px)))
                (local.set $dz (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $qb)) (local.get $pz)))
                (if (i32.and (f32.lt (f32.abs (local.get $dx)) (local.get $rs)) (f32.lt (f32.abs (local.get $dz)) (local.get $rs)))
                  (then
                    (local.set $dy (f32.sub (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $qb)) (call $b_rad (local.get $qb))) (local.get $py)))
                    (if (f32.lt (!dot3 (local.get $dx) (local.get $dy) (local.get $dz) (local.get $dx) (local.get $dy) (local.get $dz)) (f32.mul (local.get $rs) (local.get $rs)))
                      (then
                        (!put u8 @(PLAYERS + HP_FL) (local.get $pb) (i32.and (!at u8 @(PLAYERS + HP_FL) (local.get $pb)) (i32.const @(255 ^ HP_HOLD))))
                        (!put u8 @(PLAYERS + HP_FL) (local.get $qb) (i32.or (!at u8 @(PLAYERS + HP_FL) (local.get $qb)) (i32.const @HP_HOLD)))
                        (!put u8 @(PLAYERS + HP_BY) (local.get $qb) (local.get $p))
                        (!put u16 @(PLAYERS + HP_AT) (local.get $qb) (local.get $t))
                        (call $fx (i32.const 0) (i32.const @HP_FX_PASS) (local.get $q) (local.get $p)
                                  (!at f32 @(PLAYERS + P_PX) (local.get $qb))
                                  (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $qb)) (call $b_rad (local.get $qb)))
                                  (!at f32 @(PLAYERS + P_PZ) (local.get $qb))
                                  (f32.convert_i32_s (i32.sub (i32.load (i32.const @(PG_H + HP_BOOM))) (local.get $t))))
                        (br $passed))))))))))))
  (if (i32.ge_s (local.get $t) (i32.load (i32.const @(PG_H + HP_BOOM))))
    (then (call $hp_boom (local.get $t)))))

(func $hp_over (result i32) (i32.const 0))

;; Out (off the edge, or blown): its bomb goes with it.
(func $hp_out (param $p i32)
  (local $pb i32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (!put u8 @(PLAYERS + HP_FL) (local.get $pb) (i32.and (!at u8 @(PLAYERS + HP_FL) (local.get $pb)) (i32.const @(255 ^ HP_HOLD)))))
