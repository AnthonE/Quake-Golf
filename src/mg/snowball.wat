;; SNOWBALL: a round snowfield over the sea, sized for the crowd, its rim
;; crumbling in from SB_CALM into play to SB_RMIN over SB_SHRINK ticks, a few
;; pines on it that the balls bounce off. Every ball is a snowball (PGF_SIZE:
;; its radius is its PG_M, which $b_rad and $b_mass read, so the bumps weigh
;; it): SB_B0 to start, up SB_GROW for every metre it rolls on fresh snow
;; and down SB_WEAR on packed, SB_B0 to SB_BMAX, and melting back while it
;; stands still. The snow is a grid in PG_BIG: a ball on the ground
;; rolls the cells under it (the tick it did), which pack SB_PACK ticks later
;; and are fresh again SB_REFILL after. On the ground a big ball is slower to
;; get going and quicker flat out, and its skin hanging over the rim tips it
;; out. Two balls touching, after the bumps, one under SB_EATK of the other's
;; radius: the big one swallows the small one, which is out, and grows by
;; SB_EAT of its square. Last one in wins.
;;
;; The field and its pines are the confirmed world's from setup on (the pines
;; in PG_S), the rim a function of bank d's clock, and what push does to a
;; ball (the weight, the tip, the pines, the growing, wearing and melting) a
;; function of its own record, that clock and the snow grid. A cell the
;; confirmed world rolls after the prediction's copy reads fresh to it, and
;; is: it packs SB_PACK later, longer than the prediction runs ahead. So the
;; prediction rolls your ball, and sizes it, exactly as the confirmed world
;; will; a bump or a swallow, ball against ball, comes a round trip late.

;; The rim on bank d's tick: the field's own until SB_CALM into play, then in
;; to SB_RMIN over SB_SHRINK.
(func $sb_rim (param $d i32) (result f32)
  (local $r0 f32) (local $k i32)
  (local.set $r0 (f32.load offset=@(PG_H + SB_RAD) (local.get $d)))
  (local.set $k (i32.sub (call $p_t (local.get $d)) (i32.const @SB_CALM)))
  (if (i32.le_s (local.get $k) (i32.const 0)) (then (return (local.get $r0))))
  (if (i32.ge_s (local.get $k) (i32.const @SB_SHRINK)) (then (return (f32.const @SB_RMIN))))
  (f32.sub (local.get $r0) (f32.mul (f32.sub (local.get $r0) (f32.const @SB_RMIN))
                                    (f32.div (f32.convert_i32_s (local.get $k)) (f32.const @SB_SHRINK)))))

;; The snow's cell under (x, z), -1 off the grid.
(func $sb_cell (param $x f32) (param $z f32) (result i32)
  (local $i i32) (local $j i32) (local $x0 f32)
  (local.set $x0 (f32.sub (f32.load (i32.const @PG_CX)) (f32.const @(SB_GN / 2))))
  (local.set $i (i32.trunc_sat_f32_s (f32.floor (f32.sub (local.get $x) (local.get $x0)))))
  (local.set $j (i32.trunc_sat_f32_s (f32.floor (f32.sub (local.get $z) (local.get $x0)))))
  (if (i32.or (i32.ge_u (local.get $i) (i32.const @SB_GN)) (i32.ge_u (local.get $j) (i32.const @SB_GN))) (then (return (i32.const -1))))
  (i32.add (i32.mul (local.get $j) (i32.const @SB_GN)) (local.get $i)))

;; Is cell c fresh snow on tick t: never rolled, rolled under SB_PACK ago
;; (not packed yet), or snowed over SB_REFILL after? Off the grid, fresh.
(func $sb_fresh (param $c i32) (param $t i32) (result i32)
  (local $v i32) (local $a i32)
  (if (i32.lt_s (local.get $c) (i32.const 0)) (then (return (i32.const 1))))
  (local.set $v (i32.load offset=@(PG_BIG + SB_GRID) (i32.shl (local.get $c) (i32.const 2))))
  (local.set $a (i32.sub (local.get $t) (local.get $v)))
  (i32.or (i32.eqz (local.get $v)) (i32.or (i32.lt_u (local.get $a) (i32.const @SB_PACK)) (i32.ge_u (local.get $a) (i32.const @SB_REFILL)))))

;; The ball at record pb rolls the snow on tick t: every cell whose centre is
;; within SB_FOOT of its radius of its centre, and the one under it, stamped
;; with t unless it's rolled already (SB_REFILL hasn't passed).
(func $sb_roll (param $pb i32) (param $t i32)
  (local $x f32) (local $z f32) (local $reach f32) (local $dx f32) (local $dz f32) (local $x0 f32)
  (local $i i32) (local $j i32) (local $i1 i32) (local $j0 i32) (local $j1 i32) (local $i0 i32) (local $c i32) (local $cc i32) (local $v i32)
  (local.set $x0 (f32.sub (f32.load (i32.const @PG_CX)) (f32.const @(SB_GN / 2))))
  (local.set $x (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (local.get $x0)))
  (local.set $z (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $pb)) (local.get $x0)))
  (local.set $reach (f32.mul (call $b_rad (local.get $pb)) (f32.const @SB_FOOT)))
  (local.set $cc (call $sb_cell (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (!at f32 @(PLAYERS + P_PZ) (local.get $pb))))
  (local.set $i0 (i32.trunc_sat_f32_s (f32.floor (f32.sub (local.get $x) (local.get $reach)))))
  (local.set $i1 (i32.trunc_sat_f32_s (f32.floor (f32.add (local.get $x) (local.get $reach)))))
  (local.set $j0 (i32.trunc_sat_f32_s (f32.floor (f32.sub (local.get $z) (local.get $reach)))))
  (local.set $j1 (i32.trunc_sat_f32_s (f32.floor (f32.add (local.get $z) (local.get $reach)))))
  (if (i32.lt_s (local.get $i0) (i32.const 0)) (then (local.set $i0 (i32.const 0))))
  (if (i32.lt_s (local.get $j0) (i32.const 0)) (then (local.set $j0 (i32.const 0))))
  (if (i32.gt_s (local.get $i1) (i32.const @(SB_GN - 1))) (then (local.set $i1 (i32.const @(SB_GN - 1)))))
  (if (i32.gt_s (local.get $j1) (i32.const @(SB_GN - 1))) (then (local.set $j1 (i32.const @(SB_GN - 1)))))
  (if (i32.or (i32.gt_s (local.get $i0) (local.get $i1)) (i32.gt_s (local.get $j0) (local.get $j1))) (then (return)))
  (!for $j (local.get $j0) (i32.add (local.get $j1) (i32.const 1))
    (local.set $dz (f32.sub (f32.add (f32.convert_i32_s (local.get $j)) (f32.const 0.5)) (local.get $z)))
    (!for $i (local.get $i0) (i32.add (local.get $i1) (i32.const 1))
      (local.set $dx (f32.sub (f32.add (f32.convert_i32_s (local.get $i)) (f32.const 0.5)) (local.get $x)))
      (local.set $c (i32.add (i32.mul (local.get $j) (i32.const @SB_GN)) (local.get $i)))
      (if (i32.or (f32.lt (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))) (f32.mul (local.get $reach) (local.get $reach)))
                  (i32.eq (local.get $c) (local.get $cc)))
        (then
          (local.set $v (i32.load offset=@(PG_BIG + SB_GRID) (i32.shl (local.get $c) (i32.const 2))))
          (if (i32.or (i32.eqz (local.get $v)) (i32.ge_u (i32.sub (local.get $t) (local.get $v)) (i32.const @SB_REFILL)))
            (then (i32.store offset=@(PG_BIG + SB_GRID) (i32.shl (local.get $c) (i32.const 2)) (local.get $t)))))))))

;; The field for the crowd, sized balls bumping, the spawns on a sunflower
;; (in PG_S by index), and the pines from the PRNG, each clear of every spawn
;; and of the pines before it (eight tries a pine).
(func $sb_setup (param $n i32)
  (local $rad f32) (local $m i32) (local $i i32) (local $k i32) (local $tries i32) (local $ok i32)
  (local $x f32) (local $z f32) (local $dx f32) (local $dz f32) (local $r f32) (local $s f32) (local $co f32) (local $cx f32)
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (local.set $rad (f32.min (!madd (f32.sqrt (f32.convert_i32_u (local.get $n))) (f32.const @SB_RK) (f32.const @SB_R0)) (f32.const @SB_RMAX)))
  (!chk (local.get $rad) 150 (local.get $n))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_OUT))
  (i32.store (i32.const @PG_LEN) (i32.const @SB_LEN))
  (i32.store (i32.const @PG_FLAGS) (i32.const @(PGF_BUMPS | PGF_SIZE)))
  (f32.store (i32.const @PG_SIZE) (local.get $rad))
  (f32.store (i32.const @PG_IDLE) (f32.const @SB_IDLE))
  (f32.store (i32.const @(PG_H + SB_RAD)) (local.get $rad))
  (!for $i (i32.const 0) (local.get $n)
    (call $p_disc (local.get $i) (local.get $n) (f32.mul (local.get $rad) (f32.const @SB_SPAWN)))
    (local.set $z) (local.set $x)
    (!st f32 @(PG_S + SB_SPOT) (i32.shl (local.get $i) (i32.const 1)) (local.get $x))
    (!st f32 @(PG_S + SB_SPOT + 4) (i32.shl (local.get $i) (i32.const 1)) (local.get $z)))
  (local.set $m (i32.add (i32.const @SB_PN) (i32.trunc_sat_f32_u (f32.div (f32.mul (local.get $rad) (local.get $rad)) (f32.const @SB_PAREA)))))
  (if (i32.gt_u (local.get $m) (i32.const @SB_PMAX)) (then (local.set $m (i32.const @SB_PMAX))))
  (block $done
    (loop $more
      (br_if $done (i32.or (i32.ge_u (local.get $k) (local.get $m)) (i32.ge_u (local.get $tries) (i32.shl (local.get $m) (i32.const 3)))))
      (!inc $tries)
      ;; uniform over the ring between SB_PIN and SB_POUT of the radius
      (local.set $r (f32.mul (local.get $rad) (f32.sqrt (!madd (call $p_unit) (f32.const @(SB_POUT * SB_POUT - SB_PIN * SB_PIN)) (f32.const @(SB_PIN * SB_PIN))))))
      (call $sincos (call $rand))
      (local.set $co) (local.set $s)
      (local.set $x (!madd (local.get $co) (local.get $r) (local.get $cx)))
      (local.set $z (!madd (local.get $s) (local.get $r) (local.get $cx)))
      (!chk (local.get $x) 151 (local.get $k))
      (!chk (local.get $z) 152 (local.get $k))
      (local.set $ok (i32.const 1))
      (!for $i (i32.const 0) (local.get $n)
        (local.set $dx (f32.sub (local.get $x) (!ld f32 @(PG_S + SB_SPOT) (i32.shl (local.get $i) (i32.const 1)))))
        (local.set $dz (f32.sub (local.get $z) (!ld f32 @(PG_S + SB_SPOT + 4) (i32.shl (local.get $i) (i32.const 1)))))
        (if (f32.lt (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))) (f32.const @((SB_PR + SB_B0 + 0.5) * (SB_PR + SB_B0 + 0.5))))
          (then (local.set $ok (i32.const 0)))))
      (!for $i (i32.const 0) (local.get $k)
        (local.set $dx (f32.sub (local.get $x) (!ld f32 @(PG_S + SB_PINE) (i32.shl (local.get $i) (i32.const 1)))))
        (local.set $dz (f32.sub (local.get $z) (!ld f32 @(PG_S + SB_PINE + 4) (i32.shl (local.get $i) (i32.const 1)))))
        (if (f32.lt (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))) (f32.const 64))
          (then (local.set $ok (i32.const 0)))))
      (if (local.get $ok)
        (then
          (!st f32 @(PG_S + SB_PINE) (i32.shl (local.get $k) (i32.const 1)) (local.get $x))
          (!st f32 @(PG_S + SB_PINE + 4) (i32.shl (local.get $k) (i32.const 1)) (local.get $z))
          (!inc $k)))
      (br $more)))
  (i32.store (i32.const @(PG_H + SB_NP)) (local.get $k)))

;; Ball i of n where setup put it; past them (n 1024), anywhere on the spiral.
(func $sb_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $x f32) (local $z f32)
  (if (i32.lt_u (local.get $i) (i32.and (local.get $n) (i32.const 1023)))
    (then
      (return (!ld f32 @(PG_S + SB_SPOT) (i32.shl (local.get $i) (i32.const 1))) (f32.const @PLAT_Y)
              (!ld f32 @(PG_S + SB_SPOT + 4) (i32.shl (local.get $i) (i32.const 1))))))
  (call $p_disc (local.get $i) (local.get $n) (f32.mul (f32.load (i32.const @(PG_H + SB_RAD))) (f32.const @SB_SPAWN)))
  (local.set $z) (local.set $x)
  (local.get $x) (f32.const @PLAT_Y) (local.get $z))

(func $sb_start)

;; Play starts for ball p on bank d: a snowball of SB_B0.
(func $sb_begin (param $p i32) (param $d i32)
  (!put f32 @(PLAYERS + PG_M) (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)) (f32.const @SB_B0)))

;; The snow's top under (x, z) inside the rim on bank d's tick.
(func $sb_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (local $r f32) (local $dx f32) (local $dz f32)
  (if (f32.lt (local.get $y) (f32.const @PLAT_Y)) (then (return (f32.const -1000))))
  (local.set $r (call $sb_rim (local.get $d)))
  (local.set $dx (f32.sub (local.get $x) (f32.load offset=@PG_CX (local.get $d))))
  (local.set $dz (f32.sub (local.get $z) (f32.load offset=@PG_CX (local.get $d))))
  (select (f32.const @PLAT_Y) (f32.const -1000)
    (f32.le (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))) (f32.mul (local.get $r) (local.get $r)))))

;; Ball p in on bank d after its roll. On the snow: its weight, k = r / SB_B0:
;; 1 - 1/k of this tick's push given back (taken as bumper's) and a little
;; more of its drag (the round's for the keys it holds), so it gets going k
;; times slower and runs on faster; then, its skin over the rim, a tip
;; outward. A pine the rim hasn't reached, below its top: put on its skin and
;; bounced off. Then its size: melting under SB_STILL, growing as it rolls on
;; the snow by the ground it covered this tick.
(func $sb_push (param $p i32) (param $d i32)
  (local $pb i32) (local $fl i32) (local $in i32) (local $k i32) (local $np i32)
  (local $px f32) (local $py f32) (local $pz f32) (local $vx f32) (local $vz f32) (local $r f32)
  (local $f f32) (local $drag f32) (local $acc f32) (local $s f32) (local $c f32) (local $fwd f32) (local $side f32)
  (local $wx f32) (local $wz f32) (local $len f32) (local $cx f32) (local $rim f32) (local $sp f32)
  (local $dx f32) (local $dz f32) (local $d2 f32) (local $dist f32) (local $nx f32) (local $nz f32) (local $over f32)
  (local $reach f32) (local $ox f32) (local $oz f32) (local $vn f32) (local $j f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
  (if (i32.ne (i32.and (local.get $fl) (i32.const @(PF_LIVE | PF_DEAD | PF_FALL))) (i32.const @PF_LIVE)) (then (return)))
  (local.set $r (call $b_rad (local.get $pb)))
  (local.set $px (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (local.set $py (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
  (local.set $pz (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (local.set $vx (!at f32 @(PLAYERS + P_VX) (local.get $pb)))
  (local.set $vz (!at f32 @(PLAYERS + P_VZ) (local.get $pb)))
  (local.set $cx (f32.load offset=@PG_CX (local.get $d)))
  (local.set $rim (call $sb_rim (local.get $d)))
  (if (i32.and (local.get $fl) (i32.const @PF_GROUND))
    (then
      (local.set $f (f32.div (local.get $r) (f32.const @SB_B0)))
      (if (f32.gt (local.get $f) (f32.const 1))
        (then
          (local.set $in (!at i32 @(PLAYERS + P_IN) (local.get $pb)))
          (local.set $drag (f32.load offset=@PG_IDLE (local.get $d)))
          (if (i32.and (local.get $in) (i32.const 0x0f000000))
            (then
              (local.set $drag (f32.load offset=@PG_DRAG (local.get $d)))
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
                  (local.set $wx (f32.div (local.get $wx) (local.get $len)))
                  (local.set $wz (f32.div (local.get $wz) (local.get $len)))))))
          ;; of the push, 1 - 1/k given back; of the drag, 1 - 1/(k (1 + SB_FAST (k - 1)))
          (local.set $acc (f32.mul (f32.mul (f32.const @B_ACC_DT) (f32.load offset=@PG_ACC (local.get $d)))
                                   (f32.sub (f32.const 1) (f32.div (f32.const 1) (local.get $f)))))
          (local.set $drag (f32.mul (f32.sub (f32.const 1) (local.get $drag))
                                    (f32.sub (f32.const 1) (f32.div (f32.const 1) (f32.mul (local.get $f) (!madd (f32.sub (local.get $f) (f32.const 1)) (f32.const @SB_FAST) (f32.const 1)))))))
          (local.set $vx (!madd (local.get $drag) (local.get $vx) (f32.sub (local.get $vx) (f32.mul (local.get $wx) (local.get $acc)))))
          (local.set $vz (!madd (local.get $drag) (local.get $vz) (f32.sub (local.get $vz) (f32.mul (local.get $wz) (local.get $acc)))))))
      (local.set $dx (f32.sub (local.get $px) (local.get $cx)))
      (local.set $dz (f32.sub (local.get $pz) (local.get $cx)))
      (local.set $dist (f32.sqrt (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz)))))
      (local.set $over (f32.sub (f32.add (local.get $dist) (local.get $r)) (local.get $rim)))
      (if (i32.and (f32.gt (local.get $over) (f32.const 0)) (f32.gt (local.get $dist) (f32.const 0.001)))
        (then
          (local.set $j (f32.mul (f32.const @SB_TIP) (f32.min (f32.div (local.get $over) (local.get $r)) (f32.const 1))))
          (local.set $vx (!madd (f32.div (local.get $dx) (local.get $dist)) (local.get $j) (local.get $vx)))
          (local.set $vz (!madd (f32.div (local.get $dz) (local.get $dist)) (local.get $j) (local.get $vz)))))))
  (if (f32.lt (local.get $py) (f32.const @(+PLAT_Y + SB_PH)))
    (then
      (local.set $reach (f32.add (f32.const @SB_PR) (local.get $r)))
      (local.set $np (i32.load (i32.const @(PG_H + SB_NP))))
      (!for $k (i32.const 0) (local.get $np)
        (local.set $ox (!ld f32 @(PG_S + SB_PINE) (i32.shl (local.get $k) (i32.const 1))))
        (local.set $oz (!ld f32 @(PG_S + SB_PINE + 4) (i32.shl (local.get $k) (i32.const 1))))
        (local.set $dx (f32.sub (local.get $px) (local.get $ox)))
        (local.set $dz (f32.sub (local.get $pz) (local.get $oz)))
        (if (i32.and (f32.lt (f32.abs (local.get $dx)) (local.get $reach)) (f32.lt (f32.abs (local.get $dz)) (local.get $reach)))
          (then
            (local.set $d2 (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))))
            (local.set $nx (f32.sub (local.get $ox) (local.get $cx)))
            (local.set $nz (f32.sub (local.get $oz) (local.get $cx)))
            ;; still standing: the rim is past it
            (if (i32.and (f32.lt (local.get $d2) (f32.mul (local.get $reach) (local.get $reach)))
                         (f32.lt (!madd (local.get $nx) (local.get $nx) (f32.mul (local.get $nz) (local.get $nz))) (f32.mul (local.get $rim) (local.get $rim))))
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
                    (local.set $j (f32.mul (local.get $vn) (f32.const @(-1 - SB_PE))))
                    (if (f32.lt (local.get $vn) (f32.const @(-SB_PKMIN))) (then (local.set $j (f32.add (local.get $j) (f32.const @SB_PKICK)))))
                    (local.set $vx (!madd (local.get $nx) (local.get $j) (local.get $vx)))
                    (local.set $vz (!madd (local.get $nz) (local.get $j) (local.get $vz))))))))))))
  (local.set $sp (f32.sqrt (!madd (local.get $vx) (local.get $vx) (f32.mul (local.get $vz) (local.get $vz)))))
  (if (f32.lt (local.get $sp) (f32.const @SB_STILL))
    (then (local.set $r (f32.max (f32.sub (local.get $r) (f32.const @SB_MELT)) (f32.const @SB_B0))))
    (else
      (if (i32.and (local.get $fl) (i32.const @PF_GROUND))
        (then
          (local.set $j (select (f32.const @SB_GROW) (f32.const @(-SB_WEAR))
                          (call $sb_fresh (call $sb_cell (local.get $px) (local.get $pz)) (i32.load offset=@HDR_TICK (local.get $d)))))
          (local.set $r (f32.min (f32.max (!madd (f32.mul (local.get $sp) (f32.const @DT)) (local.get $j) (local.get $r)) (f32.const @SB_B0))
                                 (f32.const @SB_BMAX)))))))
  (!chk (local.get $px) 153 (local.get $p))
  (!chk (local.get $pz) 154 (local.get $p))
  (!chk (local.get $vx) 155 (local.get $p))
  (!chk (local.get $vz) 156 (local.get $p))
  (!chk (local.get $r) 157 (local.get $p))
  (!put f32 @(PLAYERS + P_PX) (local.get $pb) (local.get $px))
  (!put f32 @(PLAYERS + P_PZ) (local.get $pb) (local.get $pz))
  (!put f32 @(PLAYERS + P_VX) (local.get $pb) (local.get $vx))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (local.get $vz))
  (!put f32 @(PLAYERS + PG_M) (local.get $pb) (local.get $r)))

;; Ball p swallows ball q: p's square up SB_EAT of q's (to SB_BMAX), a
;; swallow to its score and the KO to its name; who swallowed q, the FX, and
;; q out.
(func $sb_eat (param $p i32) (param $q i32)
  (local $pb i32) (local $qb i32) (local $rp f32) (local $rq f32) (local $r f32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (local.set $qb (i32.shl (local.get $q) (i32.const 6)))
  (local.set $rp (call $b_rad (local.get $pb)))
  (local.set $rq (call $b_rad (local.get $qb)))
  (local.set $r (f32.min (f32.sqrt (!madd (local.get $rq) (f32.mul (local.get $rq) (f32.const @SB_EAT)) (f32.mul (local.get $rp) (local.get $rp))))
                         (f32.const @SB_BMAX)))
  (!chk (local.get $r) 158 (local.get $p))
  (!put f32 @(PLAYERS + PG_M) (local.get $pb) (local.get $r))
  (!put u16 @(PLAYERS + PG_SCORE) (local.get $pb) (i32.add (!at u16 @(PLAYERS + PG_SCORE) (local.get $pb)) (i32.const 1)))
  (!put u8 @(PLAYERS + B_HITBY) (local.get $qb) (local.get $p))
  (!put u16 @(PLAYERS + B_HITT) (local.get $qb) (i32.const @CREDIT_TICKS))
  (!st u8 @(PG_S + SB_EATEN) (local.get $q) (i32.add (local.get $p) (i32.const 1)))
  (call $fx (i32.const 0) (i32.const @SB_FX_EAT) (local.get $p) (local.get $q)
            (!at f32 @(PLAYERS + P_PX) (local.get $qb))
            (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $qb)) (local.get $rq))
            (!at f32 @(PLAYERS + P_PZ) (local.get $qb))
            (local.get $r))
  (call $p_out (local.get $q)))

;; After the bumps, every pair of balls in, in slot order, touching (skins
;; within SB_TOUCH, in 3D), one under SB_EATK of the other's radius: the big
;; one swallows the small one. A ball swallowed this tick swallows no more;
;; one that grew is weighed at its new size. Then the balls left on the
;; ground roll the snow. The balls in, their radii and where they are, in
;; B_SCR as this tick's swallowing starts (a radius 0 once swallowed).
(func $sb_tick
  (local $t i32) (local $n i32) (local $a i32) (local $b i32) (local $i i32) (local $j i32) (local $ib i32) (local $jb i32) (local $p i32)
  (local $ri f32) (local $rj f32) (local $rs f32) (local $dx f32) (local $dy f32) (local $dz f32) (local $xi f32) (local $zi f32)
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $ib (i32.shl (local.get $p) (i32.const 6)))
    (if (call $p_in (local.get $ib))
      (then
        (!st u8 @B_SCR (local.get $n) (local.get $p))
        (!st f32 @(B_SCR + 0x400) (local.get $n) (call $b_rad (local.get $ib)))
        (!st f32 @(B_SCR + 0x800) (local.get $n) (!at f32 @(PLAYERS + P_PX) (local.get $ib)))
        (!st f32 @(B_SCR + 0xc00) (local.get $n) (!at f32 @(PLAYERS + P_PZ) (local.get $ib)))
        (!inc $n))))
  (!for $a (i32.const 0) (local.get $n)
    (local.set $ri (!ld f32 @(B_SCR + 0x400) (local.get $a)))
    (if (f32.gt (local.get $ri) (f32.const 0))
      (then
        (local.set $i (!ld u8 @B_SCR (local.get $a)))
        (local.set $ib (i32.shl (local.get $i) (i32.const 6)))
        (local.set $xi (!ld f32 @(B_SCR + 0x800) (local.get $a)))
        (local.set $zi (!ld f32 @(B_SCR + 0xc00) (local.get $a)))
        (block $gone
          (!for $b (i32.add (local.get $a) (i32.const 1)) (local.get $n)
            (local.set $rj (!ld f32 @(B_SCR + 0x400) (local.get $b)))
            (if (i32.and (f32.gt (local.get $rj) (f32.const 0))
                         (i32.or (f32.lt (local.get $rj) (f32.mul (local.get $ri) (f32.const @SB_EATK)))
                                 (f32.lt (local.get $ri) (f32.mul (local.get $rj) (f32.const @SB_EATK)))))
              (then
                (local.set $rs (f32.add (f32.add (local.get $ri) (local.get $rj)) (f32.const @SB_TOUCH)))
                (local.set $dx (f32.sub (!ld f32 @(B_SCR + 0x800) (local.get $b)) (local.get $xi)))
                (local.set $dz (f32.sub (!ld f32 @(B_SCR + 0xc00) (local.get $b)) (local.get $zi)))
                (if (i32.and (f32.lt (f32.abs (local.get $dx)) (local.get $rs)) (f32.lt (f32.abs (local.get $dz)) (local.get $rs)))
                  (then
                    (local.set $j (!ld u8 @B_SCR (local.get $b)))
                    (local.set $jb (i32.shl (local.get $j) (i32.const 6)))
                    (local.set $dy (f32.sub (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $jb)) (local.get $rj))
                                            (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $ib)) (local.get $ri))))
                    (if (f32.lt (!dot3 (local.get $dx) (local.get $dy) (local.get $dz) (local.get $dx) (local.get $dy) (local.get $dz)) (f32.mul (local.get $rs) (local.get $rs)))
                      (then
                        (if (f32.lt (local.get $rj) (local.get $ri))
                          (then
                            (call $sb_eat (local.get $i) (local.get $j))
                            (!st f32 @(B_SCR + 0x400) (local.get $b) (f32.const 0))
                            (local.set $ri (call $b_rad (local.get $ib)))
                            (!st f32 @(B_SCR + 0x400) (local.get $a) (local.get $ri)))
                          (else
                            (call $sb_eat (local.get $j) (local.get $i))
                            (!st f32 @(B_SCR + 0x400) (local.get $a) (f32.const 0))
                            (!st f32 @(B_SCR + 0x400) (local.get $b) (call $b_rad (local.get $jb)))
                            (br $gone))))))))))))))
  ;; then every ball in on the ground rolls the snow under it
  (local.set $t (i32.load (i32.const @HDR_TICK)))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $ib (i32.shl (local.get $p) (i32.const 6)))
    (if (i32.and (call $p_in (local.get $ib)) (i32.ne (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $ib)) (i32.const @PF_GROUND)) (i32.const 0)))
      (then (call $sb_roll (local.get $ib) (local.get $t))))))

(func $sb_over (result i32) (i32.const 0))
(func $sb_out (param $p i32))
