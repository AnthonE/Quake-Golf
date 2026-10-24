;; TAG: infection on a walled disc over the sea, with bouncy pillars to dodge
;; round. One ball in TG_PER starts it, in the middle; the rest start free
;; round them. An it that touches a free ball (after the bumps, slot order)
;; makes it it too. A free ball scores a point a second; every TG_GIVE ticks
;; a free ball is handed a spring, and half way between, an it a dash; an it
;; rolls a little faster.
;; Nobody falls (PK_SCORE, but the rim keeps every ball in). The round ends
;; when nobody is free, the one who caught the last free ball a point over
;; it and first, or at the clock with the free sharing first; the rest by
;; their time free.
;;
;; The stage is the confirmed world's from setup on (the pillars in PG_S),
;; and the rest of what push does to a ball is a function of its own record
;; and its bank's clock: the bounces, an it's push (its flag in PG_M), a free
;; ball's points, the springs and the dashes. So the prediction is exact;
;; what it can't know is a tag, ball against ball, which arrives a round trip
;; late like a bump.

;; The arena for the crowd, its pillars, who starts it, and where everyone
;; starts: the its on a spiral in the middle, the free on one round them,
;; skipping the spots too near a pillar.
(func $tg_setup (param $n i32)
  (local $rad f32) (local $m i32) (local $i i32) (local $k i32) (local $j i32) (local $p i32) (local $c i32) (local $tries i32)
  (local $nit i32) (local $nfree i32) (local $a2 f32) (local $b2 f32) (local $r f32) (local $s f32) (local $co f32) (local $x f32) (local $z f32)
  (local $dx f32) (local $dz f32) (local $ok i32) (local $cx f32)
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (local.set $rad (f32.min (!madd (f32.sqrt (f32.convert_i32_u (local.get $n))) (f32.const @TG_RK) (f32.const @TG_R0)) (f32.const @TG_RMAX)))
  (!chk (local.get $rad) 131 (local.get $n))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_SCORE))
  (i32.store (i32.const @PG_LEN) (i32.const @TG_LEN))
  (f32.store (i32.const @PG_SIZE) (local.get $rad))
  (f32.store (i32.const @(PG_H + TG_RAD)) (local.get $rad))
  ;; the pillars, on a sunflower over the ring between TG_PIN and TG_POUT of the radius
  (local.set $m (i32.trunc_sat_f32_u (f32.div (f32.mul (local.get $rad) (local.get $rad)) (f32.const @TG_PAREA))))
  (if (i32.gt_u (local.get $m) (i32.const @TG_PMAX)) (then (local.set $m (i32.const @TG_PMAX))))
  (i32.store (i32.const @(PG_H + TG_NP)) (local.get $m))
  (local.set $a2 (f32.mul (f32.const @TG_PIN) (f32.const @TG_PIN)))
  (local.set $b2 (f32.sub (f32.mul (f32.const @TG_POUT) (f32.const @TG_POUT)) (local.get $a2)))
  (!for $i (i32.const 0) (local.get $m)
    (local.set $r (f32.mul (local.get $rad)
      (f32.sqrt (!madd (local.get $b2) (f32.div (f32.add (f32.convert_i32_u (local.get $i)) (f32.const 0.5)) (f32.convert_i32_u (local.get $m))) (local.get $a2)))))
    (call $sincos (i32.add (i32.mul (local.get $i) (i32.const 6258)) (i32.const 3000)))
    (local.set $co) (local.set $s)
    (!st f32 @(PG_S + TG_PILL) (i32.shl (local.get $i) (i32.const 1)) (!madd (local.get $co) (local.get $r) (local.get $cx)))
    (!st f32 @(PG_S + TG_PILL + 4) (i32.shl (local.get $i) (i32.const 1)) (!madd (local.get $s) (local.get $r) (local.get $cx))))
  ;; the its: one in TG_PER, rounded, at least one of two or more; drawn from
  ;; the PRNG by spawn index, then marked by slot (the i-th ball in is index i)
  (local.set $nit (i32.div_u (i32.add (local.get $n) (i32.const @(TG_PER >> 1))) (i32.const @TG_PER)))
  (if (i32.and (i32.eqz (local.get $nit)) (i32.ge_u (local.get $n) (i32.const 2))) (then (local.set $nit (i32.const 1))))
  (i32.store (i32.const @(PG_H + TG_NIT)) (local.get $nit))
  (!for $k (i32.const 0) (local.get $nit)
    (block $dealt
      (loop $again
        (local.set $i (i32.rem_u (call $rand) (local.get $n)))
        (br_if $again (!ld u8 @(PG_S + TG_IDX) (local.get $i)))
        (!st u8 @(PG_S + TG_IDX) (local.get $i) (i32.const 1)))))
  (local.set $i (i32.const 0))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (if (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $p) (i32.const 6))) (i32.const @PF_LIVE))
      (then
        (!st u8 @(PG_S + TG_ROLE) (local.get $p) (!ld u8 @(PG_S + TG_IDX) (local.get $i)))
        (!inc $i))))
  ;; where each starts, by index
  (local.set $nfree (i32.sub (local.get $n) (local.get $nit)))
  (local.set $a2 (f32.mul (f32.const @TG_FIN) (f32.const @TG_FIN)))
  (local.set $b2 (f32.sub (f32.mul (f32.const @TG_FOUT) (f32.const @TG_FOUT)) (local.get $a2)))
  ;; the free spiral's points: a third more than the free, so the ones near a pillar can be skipped
  (local.set $tries (i32.add (i32.div_u (i32.mul (local.get $nfree) (i32.const 4)) (i32.const 3)) (i32.const 8)))
  (local.set $j (i32.const 0)) ;; the its placed
  (local.set $c (i32.const 0)) ;; the free spiral's next point
  (!for $i (i32.const 0) (local.get $n)
    (if (!ld u8 @(PG_S + TG_IDX) (local.get $i))
      (then
        (call $p_disc (local.get $j) (local.get $nit) (f32.mul (local.get $rad) (f32.const @TG_ITR)))
        (local.set $z) (local.set $x)
        (!inc $j))
      (else
        (block $found
          (loop $next
            (local.set $r (f32.mul (local.get $rad)
              (f32.sqrt (!madd (local.get $b2) (f32.min (f32.div (f32.add (f32.convert_i32_u (local.get $c)) (f32.const 0.5)) (f32.convert_i32_u (local.get $tries))) (f32.const 1)) (local.get $a2)))))
            (call $sincos (i32.mul (local.get $c) (i32.const 6258)))
            (local.set $co) (local.set $s)
            (local.set $x (!madd (local.get $co) (local.get $r) (local.get $cx)))
            (local.set $z (!madd (local.get $s) (local.get $r) (local.get $cx)))
            (!inc $c)
            ;; past the spiral's end, take what comes
            (br_if $found (i32.gt_u (local.get $c) (local.get $tries)))
            (local.set $ok (i32.const 1))
            (!for $k (i32.const 0) (local.get $m)
              (local.set $dx (f32.sub (local.get $x) (!ld f32 @(PG_S + TG_PILL) (i32.shl (local.get $k) (i32.const 1)))))
              (local.set $dz (f32.sub (local.get $z) (!ld f32 @(PG_S + TG_PILL + 4) (i32.shl (local.get $k) (i32.const 1)))))
              (if (f32.lt (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))) (f32.const @((TG_PR + 2) * (TG_PR + 2))))
                (then (local.set $ok (i32.const 0)))))
            (br_if $found (local.get $ok))
            (br $next)))))
    (!st f32 @(PG_S + TG_SPOT) (i32.shl (local.get $i) (i32.const 1)) (local.get $x))
    (!st f32 @(PG_S + TG_SPOT + 4) (i32.shl (local.get $i) (i32.const 1)) (local.get $z))))

;; Ball i of n where setup put it; a respawn or a newcomer in play (n 1024)
;; anywhere on a spiral over the arena, out of the pillars.
(func $tg_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $x f32) (local $z f32) (local $k i32) (local $dx f32) (local $dz f32) (local $d f32)
  (if (i32.lt_u (local.get $i) (i32.and (local.get $n) (i32.const 1023)))
    (then
      (return (!ld f32 @(PG_S + TG_SPOT) (i32.shl (local.get $i) (i32.const 1))) (f32.const @PLAT_Y)
              (!ld f32 @(PG_S + TG_SPOT + 4) (i32.shl (local.get $i) (i32.const 1))))))
  (call $p_disc (local.get $i) (local.get $n) (f32.mul (f32.load (i32.const @(PG_H + TG_RAD))) (f32.const 0.85)))
  (local.set $z) (local.set $x)
  (!for $k (i32.const 0) (i32.load (i32.const @(PG_H + TG_NP)))
    (local.set $dx (f32.sub (local.get $x) (!ld f32 @(PG_S + TG_PILL) (i32.shl (local.get $k) (i32.const 1)))))
    (local.set $dz (f32.sub (local.get $z) (!ld f32 @(PG_S + TG_PILL + 4) (i32.shl (local.get $k) (i32.const 1)))))
    (local.set $d (f32.sqrt (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz)))))
    (if (f32.lt (local.get $d) (f32.const @(TG_PR + 1.5)))
      (then
        (if (f32.lt (local.get $d) (f32.const 0.001)) (then (local.set $dx (f32.const 1)) (local.set $dz (f32.const 0)) (local.set $d (f32.const 1))))
        (local.set $x (!madd (f32.div (local.get $dx) (local.get $d)) (f32.const @(TG_PR + 1.5)) (!ld f32 @(PG_S + TG_PILL) (i32.shl (local.get $k) (i32.const 1)))))
        (local.set $z (!madd (f32.div (local.get $dz) (local.get $d)) (f32.const @(TG_PR + 1.5)) (!ld f32 @(PG_S + TG_PILL + 4) (i32.shl (local.get $k) (i32.const 1))))))))
  (local.get $x) (f32.const @PLAT_Y) (local.get $z))

;; Play starts: every ball in is marked in the round, it or free as dealt.
(func $tg_start
  (local $p i32) (local $pb i32)
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (if (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_LIVE))
      (then (!put i32 @(PLAYERS + PG_M) (local.get $pb) (i32.or (i32.const @TG_M_IN) (!ld u8 @(PG_S + TG_ROLE) (local.get $p))))))))

;; A floor without end: the rim (in push) is what keeps a ball on the arena.
(func $tg_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (select (f32.const @PLAT_Y) (f32.const -1000) (f32.ge (local.get $y) (f32.const @PLAT_Y))))

;; Ball p on bank d after its roll: an it's keys push a little more; a ball
;; in a pillar is put on its skin and bounces off (a hard hit with a kick);
;; one past the rim is put back on it and bounces off softly; a free ball's
;; points are its seconds in play; and on the schedule a spring comes to a
;; free ball, a dash to an it.
(func $tg_push (param $p i32) (param $d i32)
  (local $pb i32) (local $m i32) (local $fl i32) (local $in i32) (local $t i32) (local $k i32) (local $np i32)
  (local $px f32) (local $py f32) (local $pz f32) (local $vx f32) (local $vz f32) (local $rb f32) (local $reach f32)
  (local $s f32) (local $c f32) (local $fwd f32) (local $side f32) (local $wx f32) (local $wz f32) (local $len f32)
  (local $dx f32) (local $dz f32) (local $d2 f32) (local $dist f32) (local $nx f32) (local $nz f32) (local $vn f32) (local $j f32)
  (local $ox f32) (local $oz f32) (local $lim f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
  (local.set $m (!at i32 @(PLAYERS + PG_M) (local.get $pb)))
  (local.set $px (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (local.set $py (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
  (local.set $pz (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (local.set $vx (!at f32 @(PLAYERS + P_VX) (local.get $pb)))
  (local.set $vz (!at f32 @(PLAYERS + P_VZ) (local.get $pb)))
  (local.set $rb (call $b_rad (local.get $pb)))
  ;; an it on the ground with keys held: the push again along the same wish, TG_BOOST of it
  (local.set $in (!at i32 @(PLAYERS + P_IN) (local.get $pb)))
  (if (i32.and (i32.and (i32.ne (i32.and (local.get $m) (i32.const @TG_M_IT)) (i32.const 0)) (i32.ne (i32.and (local.get $fl) (i32.const @PF_GROUND)) (i32.const 0)))
               (i32.ne (i32.and (local.get $in) (i32.const 0x0f000000)) (i32.const 0)))
    (then
      (call $sincos (local.get $in))
      (local.set $c) (local.set $s)
      (local.set $fwd (f32.convert_i32_s (i32.sub (i32.and (i32.shr_u (local.get $in) (i32.const 24)) (i32.const 1))
                                                  (i32.and (i32.shr_u (local.get $in) (i32.const 25)) (i32.const 1)))))
      (local.set $side (f32.convert_i32_s (i32.sub (i32.and (i32.shr_u (local.get $in) (i32.const 27)) (i32.const 1))
                                                   (i32.and (i32.shr_u (local.get $in) (i32.const 26)) (i32.const 1)))))
      (local.set $wx (f32.sub (f32.mul (local.get $c) (local.get $fwd)) (f32.mul (local.get $s) (local.get $side))))
      (local.set $wz (f32.add (f32.mul (local.get $s) (local.get $fwd)) (f32.mul (local.get $c) (local.get $side))))
      (local.set $len (f32.sqrt (!madd (local.get $wx) (local.get $wx) (f32.mul (local.get $wz) (local.get $wz)))))
      (if (f32.gt (local.get $len) (f32.const 0))
        (then
          (local.set $vx (!madd (f32.div (local.get $wx) (local.get $len)) (f32.const @TG_BOOST) (local.get $vx)))
          (local.set $vz (!madd (f32.div (local.get $wz) (local.get $len)) (f32.const @TG_BOOST) (local.get $vz)))))))
  ;; the pillars, below their tops
  (if (f32.lt (local.get $py) (f32.const @(+PLAT_Y + TG_PH)))
    (then
      (local.set $reach (f32.add (f32.const @TG_PR) (local.get $rb)))
      (local.set $np (i32.load (i32.const @(PG_H + TG_NP))))
      (!for $k (i32.const 0) (local.get $np)
        (local.set $ox (!ld f32 @(PG_S + TG_PILL) (i32.shl (local.get $k) (i32.const 1))))
        (local.set $oz (!ld f32 @(PG_S + TG_PILL + 4) (i32.shl (local.get $k) (i32.const 1))))
        (local.set $dx (f32.sub (local.get $px) (local.get $ox)))
        (local.set $dz (f32.sub (local.get $pz) (local.get $oz)))
        (if (i32.and (f32.lt (f32.abs (local.get $dx)) (local.get $reach)) (f32.lt (f32.abs (local.get $dz)) (local.get $reach)))
          (then
            (local.set $d2 (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))))
            (if (f32.lt (local.get $d2) (f32.mul (local.get $reach) (local.get $reach)))
              (then
                (local.set $dist (f32.sqrt (local.get $d2)))
                (if (f32.lt (local.get $dist) (f32.const 0.001))
                  (then (local.set $nx (f32.const 1)) (local.set $nz (f32.const 0)))
                  (else
                    (local.set $nx (f32.div (local.get $dx) (local.get $dist)))
                    (local.set $nz (f32.div (local.get $dz) (local.get $dist)))))
                (local.set $px (!madd (local.get $nx) (local.get $reach) (local.get $ox)))
                (local.set $pz (!madd (local.get $nz) (local.get $reach) (local.get $oz)))
                (local.set $vn (!madd (local.get $vx) (local.get $nx) (f32.mul (local.get $vz) (local.get $nz))))
                (if (f32.lt (local.get $vn) (f32.const 0))
                  (then
                    (local.set $j (f32.mul (local.get $vn) (f32.const @(-1 - TG_PE))))
                    (if (f32.gt (local.get $vn) (f32.const @(-TG_KMIN))) (then) (else (local.set $j (f32.add (local.get $j) (f32.const @TG_KICK)))))
                    (local.set $vx (!madd (local.get $nx) (local.get $j) (local.get $vx)))
                    (local.set $vz (!madd (local.get $nz) (local.get $j) (local.get $vz))))))))))))
  ;; the rim
  (local.set $ox (f32.load (i32.const @PG_CX)))
  (local.set $lim (f32.sub (f32.load offset=@(PG_H + TG_RAD) (local.get $d)) (local.get $rb)))
  (local.set $dx (f32.sub (local.get $px) (local.get $ox)))
  (local.set $dz (f32.sub (local.get $pz) (local.get $ox)))
  (local.set $d2 (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))))
  (if (f32.gt (local.get $d2) (f32.mul (local.get $lim) (local.get $lim)))
    (then
      (local.set $dist (f32.sqrt (local.get $d2)))
      (local.set $nx (f32.div (local.get $dx) (local.get $dist)))
      (local.set $nz (f32.div (local.get $dz) (local.get $dist)))
      (local.set $px (!madd (local.get $nx) (local.get $lim) (local.get $ox)))
      (local.set $pz (!madd (local.get $nz) (local.get $lim) (local.get $ox)))
      (local.set $vn (!madd (local.get $vx) (local.get $nx) (f32.mul (local.get $vz) (local.get $nz))))
      (if (f32.gt (local.get $vn) (f32.const 0))
        (then
          (local.set $j (f32.mul (local.get $vn) (f32.const @(-1 - TG_WE))))
          (local.set $vx (!madd (local.get $nx) (local.get $j) (local.get $vx)))
          (local.set $vz (!madd (local.get $nz) (local.get $j) (local.get $vz)))))))
  (!chk (local.get $px) 132 (local.get $p))
  (!chk (local.get $pz) 133 (local.get $p))
  (!chk (local.get $vx) 134 (local.get $p))
  (!chk (local.get $vz) 135 (local.get $p))
  (!put f32 @(PLAYERS + P_PX) (local.get $pb) (local.get $px))
  (!put f32 @(PLAYERS + P_PZ) (local.get $pb) (local.get $pz))
  (!put f32 @(PLAYERS + P_VX) (local.get $pb) (local.get $vx))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (local.get $vz))
  ;; in the round: a free ball's points are its seconds; on the schedule, a
  ;; spring to a free ball holding nothing, and between, a dash to an it
  (if (i32.and (local.get $m) (i32.const @TG_M_IN))
    (then
      (local.set $t (call $p_t (local.get $d)))
      (if (i32.eqz (i32.and (local.get $m) (i32.const @TG_M_IT)))
        (then (!put u16 @(PLAYERS + PG_SCORE) (local.get $pb) (i32.div_u (local.get $t) (i32.const @TG_SEC)))))
      (local.set $k (select (i32.const @TG_DASH0) (i32.const @TG_GIVE0) (i32.and (local.get $m) (i32.const @TG_M_IT))))
      (if (i32.and (i32.eqz (!at u8 @(PLAYERS + B_ITEM) (local.get $pb)))
                   (i32.and (i32.ge_u (local.get $t) (local.get $k))
                            (i32.eqz (i32.rem_u (i32.sub (local.get $t) (local.get $k)) (i32.const @TG_GIVE)))))
        (then (!put u8 @(PLAYERS + B_ITEM) (local.get $pb)
                (select (i32.const @PU_DASH) (i32.const @PU_SPRING) (i32.and (local.get $m) (i32.const @TG_M_IT)))))))))

;; Slot q is it from this tick, by p (255 joined in play, 254 dealt): both
;; marked with the tick (neither tags for TG_FRESH), q's spring gone (a dash
;; comes at the next handing out), a tag for p; and if q
;; was the last one free, p caught it: a point over q's, the round's best.
;; The FX.
(func $tg_make (param $q i32) (param $p i32) (param $t i32) (param $free i32)
  (local $qb i32) (local $pb i32) (local $pts i32)
  (local.set $qb (i32.shl (local.get $q) (i32.const 6)))
  (!put i32 @(PLAYERS + PG_M) (local.get $qb) (i32.or (i32.const @(TG_M_IN | TG_M_IT)) (i32.shl (local.get $t) (i32.const 8))))
  (!put u8 @(PLAYERS + B_ITEM) (local.get $qb) (i32.const 0))
  (local.set $pts (!at u16 @(PLAYERS + PG_SCORE) (local.get $qb)))
  (if (i32.lt_u (local.get $p) (i32.const @NPLAYER))
    (then
      (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
      (!put u16 @(PLAYERS + B_KOS) (local.get $pb) (i32.add (!at u16 @(PLAYERS + B_KOS) (local.get $pb)) (i32.const 1)))
      (!put i32 @(PLAYERS + PG_M) (local.get $pb) (i32.or (i32.const @(TG_M_IN | TG_M_IT)) (i32.shl (local.get $t) (i32.const 8))))
      (if (i32.eqz (local.get $free))
        (then
          (if (i32.gt_u (i32.add (local.get $pts) (i32.const 1)) (!at u16 @(PLAYERS + PG_SCORE) (local.get $pb)))
            (then (!put u16 @(PLAYERS + PG_SCORE) (local.get $pb) (i32.add (local.get $pts) (i32.const 1)))))))))
  (call $fx (i32.const 0) (i32.const @TG_FX_TAG) (local.get $q)
            (i32.or (i32.and (local.get $p) (i32.const 255)) (i32.shl (select (i32.const 255) (local.get $free) (i32.gt_u (local.get $free) (i32.const 255))) (i32.const 8)))
            (!at f32 @(PLAYERS + P_PX) (local.get $qb))
            (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $qb)) (call $b_rad (local.get $qb)))
            (!at f32 @(PLAYERS + P_PZ) (local.get $qb))
            (f32.convert_i32_u (local.get $pts))))

;; After the bumps: a ball new to the round (joined in play) is it; if the
;; its have all left and two or more are free, the PRNG makes one of them it;
;; then every free ball in, in slot order, that an it in touches (the lowest
;; slot's; not one that tagged or was tagged in the last TG_FRESH) is it.
(func $tg_tick
  (local $t i32) (local $p i32) (local $q i32) (local $pb i32) (local $qb i32) (local $m i32) (local $free i32) (local $its i32) (local $k i32) (local $r i32)
  (local $rq f32) (local $rs f32) (local $dx f32) (local $dy f32) (local $dz f32) (local $qx f32) (local $qy f32) (local $qz f32)
  (local.set $t (call $p_t (i32.const 0)))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (if (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_LIVE))
      (then
        (local.set $m (i32.and (!at i32 @(PLAYERS + PG_M) (local.get $pb)) (i32.const @(TG_M_IN | TG_M_IT))))
        (if (i32.eq (local.get $m) (i32.const @TG_M_IN)) (then (!inc $free)) (else (!inc $its))))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (if (i32.and (i32.ne (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_LIVE)) (i32.const 0))
                 (i32.eqz (i32.and (!at i32 @(PLAYERS + PG_M) (local.get $pb)) (i32.const @TG_M_IN))))
      (then (call $tg_make (local.get $p) (i32.const 255) (local.get $t) (local.get $free)))))
  (if (i32.and (i32.eqz (local.get $its)) (i32.ge_u (local.get $free) (i32.const 2)))
    (then
      (local.set $r (i32.rem_u (call $rand) (local.get $free)))
      (local.set $free (i32.sub (local.get $free) (i32.const 1)))
      (block $dealt
        (!for $p (i32.const 0) (i32.const @NPLAYER)
          (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
          (if (i32.and (i32.ne (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_LIVE)) (i32.const 0))
                       (i32.eq (i32.and (!at i32 @(PLAYERS + PG_M) (local.get $pb)) (i32.const @(TG_M_IN | TG_M_IT))) (i32.const @TG_M_IN)))
            (then
              (if (i32.eqz (local.get $r))
                (then
                  (call $tg_make (local.get $p) (i32.const 254) (local.get $t) (local.get $free))
                  (br $dealt)))
              (local.set $r (i32.sub (local.get $r) (i32.const 1)))))))))
  ;; the its in that can tag, as this tick's tags begin (in B_SCR, rebuilt every tick)
  (local.set $its (i32.const 0))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (local.set $m (!at i32 @(PLAYERS + PG_M) (local.get $pb)))
    (if (i32.and (i32.and (call $p_in (local.get $pb)) (i32.ne (i32.and (local.get $m) (i32.const @TG_M_IT)) (i32.const 0)))
                 (i32.ge_u (i32.sub (local.get $t) (i32.shr_u (local.get $m) (i32.const 8))) (i32.const @TG_FRESH)))
      (then (!st u8 @B_SCR (local.get $its) (local.get $p)) (!inc $its))))
  (if (i32.eqz (local.get $its)) (then (return)))
  (!for $q (i32.const 0) (i32.const @NPLAYER)
    (local.set $qb (i32.shl (local.get $q) (i32.const 6)))
    (if (i32.and (call $p_in (local.get $qb)) (i32.eq (i32.and (!at i32 @(PLAYERS + PG_M) (local.get $qb)) (i32.const @(TG_M_IN | TG_M_IT))) (i32.const @TG_M_IN)))
      (then
        (local.set $rq (call $b_rad (local.get $qb)))
        (local.set $qx (!at f32 @(PLAYERS + P_PX) (local.get $qb)))
        (local.set $qy (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $qb)) (local.get $rq)))
        (local.set $qz (!at f32 @(PLAYERS + P_PZ) (local.get $qb)))
        (block $tagged
          (!for $k (i32.const 0) (local.get $its)
            (local.set $p (!ld u8 @B_SCR (local.get $k)))
            (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
            (local.set $rs (f32.add (f32.add (local.get $rq) (call $b_rad (local.get $pb))) (f32.const @TG_TOUCH)))
            (local.set $dx (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (local.get $qx)))
            (local.set $dz (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $pb)) (local.get $qz)))
            (if (i32.and (f32.lt (f32.abs (local.get $dx)) (local.get $rs)) (f32.lt (f32.abs (local.get $dz)) (local.get $rs)))
              (then
                (local.set $dy (f32.sub (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (call $b_rad (local.get $pb))) (local.get $qy)))
                (if (f32.lt (!dot3 (local.get $dx) (local.get $dy) (local.get $dz) (local.get $dx) (local.get $dy) (local.get $dz)) (f32.mul (local.get $rs) (local.get $rs)))
                  (then
                    (local.set $free (i32.sub (local.get $free) (i32.const 1)))
                    (call $tg_make (local.get $q) (local.get $p) (local.get $t) (local.get $free))
                    (br $tagged)))))))))))

;; Over when nobody in the round is free (once anyone is it).
(func $tg_over (result i32)
  (local $p i32) (local $pb i32) (local $its i32)
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (if (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_LIVE))
      (then
        (if (i32.eq (i32.and (!at i32 @(PLAYERS + PG_M) (local.get $pb)) (i32.const @(TG_M_IN | TG_M_IT))) (i32.const @TG_M_IN)) (then (return (i32.const 0))))
        (if (i32.and (!at i32 @(PLAYERS + PG_M) (local.get $pb)) (i32.const @TG_M_IT)) (then (!inc $its))))))
  (i32.ne (local.get $its) (i32.const 0)))

(func $tg_out (param $p i32))
