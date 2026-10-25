;; HOOPLA: a wide round court over the sea, sized for the crowd. Its hub
;; holds HO_NR low ramps aimed out at the rim; round the hub the hoops ride
;; orbits, an orbit's hoops spaced evenly round it at its own speed, the next
;; orbit out turning the other way; bounce pads lie on the orbits' lines,
;; where the hoops pass over. Roll through a hoop's ring for a point (hop the
;; raised ones, a ramp's lip or a pad for the high ones); a gold hoop bobs up
;; and down as it wobbles, spins faster and is worth HO_GOLDV. The same ball
;; scores the same hoop again only HO_AGAIN later, so a crowd shares a hoop
;; but nobody camps one; from HO_DOUBLE every hoop pays double. Bumps on;
;; off the rim and a ball is down HO_RESPAWN. Most points at 90 s wins.
;;
;; The court, the ramps and the pads are laid out with the round (the radius
;; and the counts in PG_H, the rest in PG_S) and fixed for it, so ground and
;; push read only them and the ball's own record and the prediction is exact.
;; The hoops are functions of the tick into play and what setup drew for them
;; ($ho_at: i32 angles, $sincos), so every machine has them where the sim
;; does; they are not solid, and scoring is the confirmed world's (tick, in
;; slot order, from where each ball's centre was a tick ago to where it is),
;; a round trip late as a bump is.

;; Ramp j's record, pad k's, orbit o's, hoop i's; hoop i in HO_NOW on the
;; last tick (k 0) or this one (k 1).
(func $ho_ra (param $j i32) (result i32) (i32.add (i32.const @(PG_S + HO_RAMPS)) (i32.shl (local.get $j) (i32.const 4))))
(func $ho_pa (param $k i32) (result i32) (i32.add (i32.const @(PG_S + HO_PADS)) (i32.shl (local.get $k) (i32.const 3))))
(func $ho_oa (param $o i32) (result i32) (i32.add (i32.const @(PG_S + HO_ORBS)) (i32.shl (local.get $o) (i32.const 4))))
(func $ho_ha (param $i i32) (result i32) (i32.add (i32.const @(PG_S + HO_HOOPS)) (i32.mul (local.get $i) (i32.const @HO_HSIZE))))
(func $ho_na (param $k i32) (param $i i32) (result i32)
  (i32.add (i32.const @(PG_BIG + HO_NOW)) (i32.shl (i32.add (i32.mul (local.get $k) (i32.const @HO_NMAX)) (local.get $i)) (i32.const 5))))

;; lo + a uniform draw of 0 .. hi - lo, from the PRNG (setup's).
(func $ho_pick (param $lo i32) (param $hi i32) (result i32)
  (i32.add (local.get $lo) (i32.rem_u (call $rand) (i32.add (i32.sub (local.get $hi) (local.get $lo)) (i32.const 1)))))

;; Hoop i on tick t into play: its ring's centre (x, z, y), its radius, and
;; the normal to its plane (nx, nz). It rides its orbit round the court's
;; centre wobbling HO_WOB in and out of it, faces its angle round plus its
;; own spin, breathes between its sizes; its bottom HO_FOOT up, HO_LIFT
;; raised, a gold one's bobbing between HO_FOOT and HO_GOLDB with its wobble
;; (so it loops). Angles are 2^-24 turn in i32, wrapping; $sincos takes
;; their top 14 bits.
(func $ho_at (param $i i32) (param $t i32) (result f32 f32 f32 f32 f32 f32)
  (local $a i32) (local $ang i32) (local $kind i32)
  (local $s f32) (local $c f32) (local $sb f32) (local $cb f32) (local $ss f32) (local $cs f32) (local $sf f32) (local $cf f32)
  (local $rho f32) (local $r f32) (local $bot f32) (local $cx f32)
  (local.set $a (call $ho_ha (local.get $i)))
  (local.set $kind (i32.load offset=@HO_H_KIND (local.get $a)))
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (local.set $ang (i32.add (i32.load offset=@HO_H_A0 (local.get $a)) (i32.mul (i32.load offset=@HO_H_W (local.get $a)) (local.get $t))))
  (call $sincos (i32.shr_u (local.get $ang) (i32.const 10)))
  (local.set $c) (local.set $s)
  (call $sincos (i32.shr_u (i32.add (i32.load offset=@HO_H_B0 (local.get $a)) (i32.mul (i32.load offset=@HO_H_BW (local.get $a)) (local.get $t))) (i32.const 10)))
  (local.set $cb) (local.set $sb)
  (call $sincos (i32.shr_u (i32.add (i32.load offset=@HO_H_S0 (local.get $a)) (i32.mul (i32.load offset=@HO_H_SW (local.get $a)) (local.get $t))) (i32.const 10)))
  (local.set $cs) (local.set $ss)
  (call $sincos (i32.shr_u (i32.add (local.get $ang) (i32.add (i32.load offset=@HO_H_F0 (local.get $a)) (i32.mul (i32.load offset=@HO_H_FW (local.get $a)) (local.get $t))))
                           (i32.const 10)))
  (local.set $cf) (local.set $sf)
  (local.set $rho (!madd (local.get $sb) (f32.const @HO_WOB) (f32.load offset=@HO_H_RHO (local.get $a))))
  (local.set $r (!madd (local.get $ss) (f32.const @HO_RVAR) (f32.const @HO_RMID)))
  (local.set $bot (select (f32.const @HO_LIFT) (f32.const @HO_FOOT) (i32.eq (local.get $kind) (i32.const @HO_KRAISED))))
  (if (i32.eq (local.get $kind) (i32.const @HO_KGOLD))
    (then
      (local.set $r (!madd (local.get $ss) (f32.const @HO_GVAR) (f32.const @HO_GMID)))
      (local.set $bot (!madd (f32.sub (f32.const 1) (local.get $cb)) (f32.const @((HO_GOLDB - HO_FOOT) / 2)) (f32.const @HO_FOOT)))))
  (!madd (local.get $c) (local.get $rho) (local.get $cx))
  (!madd (local.get $s) (local.get $rho) (local.get $cx))
  (f32.add (f32.add (local.get $bot) (local.get $r)) (f32.const @PLAT_Y))
  (local.get $r)
  (local.get $cf)
  (local.get $sf))

;; Every hoop on tick t into play, into HO_NOW's slot k.
(func $ho_now (param $k i32) (param $t i32)
  (local $i i32) (local $o i32)
  (local $x f32) (local $z f32) (local $y f32) (local $r f32) (local $nx f32) (local $nz f32)
  (!for $i (i32.const 0) (i32.load (i32.const @(PG_H + HO_NH)))
    (call $ho_at (local.get $i) (local.get $t))
    (local.set $nz) (local.set $nx) (local.set $r) (local.set $y) (local.set $z) (local.set $x)
    (!chk (local.get $x) 150 (local.get $i))
    (!chk (local.get $z) 150 (local.get $i))
    (!chk (local.get $y) 150 (local.get $i))
    (local.set $o (call $ho_na (local.get $k) (local.get $i)))
    (f32.store (local.get $o) (local.get $x))
    (f32.store offset=4 (local.get $o) (local.get $z))
    (f32.store offset=8 (local.get $o) (local.get $y))
    (f32.store offset=12 (local.get $o) (local.get $r))
    (f32.store offset=16 (local.get $o) (local.get $nx))
    (f32.store offset=20 (local.get $o) (local.get $nz))))

;; The court for the crowd, a gentle brake and a strong hop; the ramps round
;; the hub, the first's way out from the PRNG; the orbits out to HO_EDGE from
;; the rim, and the hoops shared over them by their length (each orbit the
;; running share rounded down, the last the rest), evenly round each orbit,
;; at a speed of its own and the next orbit the other way; which hoops are
;; gold and which raised; every hoop's phases and rates; the pads on the
;; orbits' lines.
(func $ho_setup (param $n i32)
  (local $no i32) (local $nh i32) (local $np i32) (local $o i32) (local $i i32) (local $j i32) (local $m i32) (local $first i32)
  (local $dir i32) (local $phase i32) (local $w i32) (local $a i32) (local $k i32) (local $kind i32) (local $want i32) (local $lo i32) (local $hi i32)
  (local $rad f32) (local $rho f32) (local $sum f32) (local $acc f32) (local $v f32) (local $s f32) (local $c f32) (local $cx f32)
  (local.set $rad (f32.min (!madd (f32.sqrt (f32.convert_i32_u (local.get $n))) (f32.const @HO_RK) (f32.const @HO_R0)) (f32.const @HO_RMAX)))
  (!chk (local.get $rad) 151 (local.get $n))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_SCORE))
  (i32.store (i32.const @PG_LEN) (i32.const @HO_LEN))
  (i32.store (i32.const @PG_RESPAWN) (i32.const @HO_RESPAWN))
  (f32.store (i32.const @PG_SIZE) (local.get $rad))
  (f32.store (i32.const @PG_IDLE) (f32.const @HO_IDLE))
  (f32.store (i32.const @PG_HOP) (f32.const @HO_HOP))
  (f32.store (i32.const @(PG_H + HO_RAD)) (local.get $rad))
  (i32.store (i32.const @(PG_H + HO_LEAD)) (i32.const 0xffff))
  (local.set $cx (f32.load (i32.const @PG_CX)))
  ;; the ramps, toe in, evenly round the hub
  (local.set $a (i32.and (call $rand) (i32.const 16383)))
  (!for $j (i32.const 0) (i32.const @HO_NR)
    (call $sincos (i32.add (local.get $a) (i32.div_u (i32.mul (local.get $j) (i32.const 16384)) (i32.const @HO_NR))))
    (local.set $c) (local.set $s)
    (local.set $k (call $ho_ra (local.get $j)))
    (f32.store (local.get $k) (!madd (local.get $c) (f32.const @HO_RT0) (local.get $cx)))
    (f32.store offset=4 (local.get $k) (!madd (local.get $s) (f32.const @HO_RT0) (local.get $cx)))
    (f32.store offset=8 (local.get $k) (local.get $c))
    (f32.store offset=12 (local.get $k) (local.get $s)))
  (i32.store (i32.const @(PG_H + HO_NRAMP)) (i32.const @HO_NR))
  ;; the orbits that fit, and their lengths' sum
  (block $fit
    (loop $more
      (br_if $fit (i32.ge_u (local.get $no) (i32.const @HO_OMAX)))
      (local.set $rho (!madd (f32.convert_i32_u (local.get $no)) (f32.const @HO_GAP) (f32.const @HO_ORB0)))
      (br_if $fit (f32.gt (local.get $rho) (f32.sub (local.get $rad) (f32.const @HO_EDGE))))
      (local.set $sum (f32.add (local.get $sum) (local.get $rho)))
      (!inc $no)
      (br $more)))
  (if (i32.eqz (local.get $no)) (then (local.set $no (i32.const 1)) (local.set $sum (f32.const @HO_ORB0))))
  (i32.store (i32.const @(PG_H + HO_NO)) (local.get $no))
  (local.set $nh (i32.add (i32.const @HO_N0) (i32.div_u (local.get $n) (i32.const @HO_NK))))
  (if (i32.gt_u (local.get $nh) (i32.const @HO_NMAX)) (then (local.set $nh (i32.const @HO_NMAX))))
  (i32.store (i32.const @(PG_H + HO_NH)) (local.get $nh))
  ;; each orbit's hoops: evenly round it from a phase of its own, at its speed, the next orbit the other way
  (local.set $dir (select (i32.const -1) (i32.const 1) (i32.shr_u (call $rand) (i32.const 31))))
  (!for $o (i32.const 0) (local.get $no)
    (local.set $rho (!madd (f32.convert_i32_u (local.get $o)) (f32.const @HO_GAP) (f32.const @HO_ORB0)))
    (local.set $acc (f32.add (local.get $acc) (local.get $rho)))
    (local.set $m (i32.sub (i32.trunc_sat_f32_u (f32.div (f32.mul (f32.convert_i32_u (local.get $nh)) (local.get $acc)) (local.get $sum))) (local.get $first)))
    (if (i32.eq (local.get $o) (i32.sub (local.get $no) (i32.const 1))) (then (local.set $m (i32.sub (local.get $nh) (local.get $first)))))
    (local.set $v (!madd (call $p_unit) (f32.const @(HO_V1 - HO_V0)) (f32.const @HO_V0)))
    (local.set $w (i32.mul (local.get $dir) (i32.trunc_sat_f32_u (f32.div (f32.mul (local.get $v) (f32.const @(DT * 16777216 / (2 * Math.PI)))) (local.get $rho)))))
    (local.set $phase (call $rand))
    (local.set $k (call $ho_oa (local.get $o)))
    (f32.store (local.get $k) (local.get $rho))
    (i32.store offset=4 (local.get $k) (local.get $first))
    (i32.store offset=8 (local.get $k) (local.get $m))
    (i32.store offset=12 (local.get $k) (local.get $w))
    (!for $j (i32.const 0) (local.get $m)
      (local.set $k (call $ho_ha (i32.add (local.get $first) (local.get $j))))
      (f32.store offset=@HO_H_RHO (local.get $k) (local.get $rho))
      (i32.store offset=@HO_H_A0 (local.get $k) (i32.add (local.get $phase) (i32.div_u (i32.mul (local.get $j) (i32.const 16777216)) (local.get $m))))
      (i32.store offset=@HO_H_W (local.get $k) (local.get $w))
      (i32.store offset=@HO_H_ORB (local.get $k) (local.get $o)))
    (local.set $first (i32.add (local.get $first) (local.get $m)))
    (local.set $dir (i32.sub (i32.const 0) (local.get $dir))))
  ;; the gold ones (one in HO_GOLDK, one at least), then the raised (one in HO_RAISEK of the rest)
  (local.set $want (select (i32.div_u (local.get $nh) (i32.const @HO_GOLDK)) (i32.const 1) (i32.ge_u (local.get $nh) (i32.const @HO_GOLDK))))
  (call $ho_kinds (local.get $nh) (local.get $want) (i32.const @HO_KGOLD))
  (call $ho_kinds (local.get $nh) (i32.div_u (i32.sub (local.get $nh) (local.get $want)) (i32.const @HO_RAISEK)) (i32.const @HO_KRAISED))
  ;; every hoop's spin (either way), breathing and wobble, a gold one's quicker
  (!for $i (i32.const 0) (local.get $nh)
    (local.set $k (call $ho_ha (local.get $i)))
    (local.set $kind (i32.eq (i32.load offset=@HO_H_KIND (local.get $k)) (i32.const @HO_KGOLD)))
    (i32.store offset=@HO_H_F0 (local.get $k) (call $rand))
    (local.set $lo (select (i32.const @HO_GSPIN0) (i32.const @HO_SPIN0) (local.get $kind)))
    (local.set $hi (select (i32.const @HO_GSPIN1) (i32.const @HO_SPIN1) (local.get $kind)))
    (local.set $w (call $ho_pick (local.get $lo) (local.get $hi)))
    (i32.store offset=@HO_H_FW (local.get $k) (select (i32.sub (i32.const 0) (local.get $w)) (local.get $w) (i32.shr_u (call $rand) (i32.const 31))))
    (i32.store offset=@HO_H_S0 (local.get $k) (call $rand))
    (i32.store offset=@HO_H_SW (local.get $k) (call $ho_pick (i32.const @HO_SZ0) (i32.const @HO_SZ1)))
    (i32.store offset=@HO_H_B0 (local.get $k) (call $rand))
    (local.set $lo (select (i32.const @HO_GB0) (i32.const @HO_WB0) (local.get $kind)))
    (local.set $hi (select (i32.const @HO_GB1) (i32.const @HO_WB1) (local.get $kind)))
    (i32.store offset=@HO_H_BW (local.get $k) (call $ho_pick (local.get $lo) (local.get $hi))))
  ;; the pads: one on each orbit's line at an angle from the PRNG, a second opposite it from the third orbit out
  (!for $o (i32.const 0) (local.get $no)
    (local.set $rho (f32.load (call $ho_oa (local.get $o))))
    (local.set $a (i32.and (call $rand) (i32.const 16383)))
    (!for $j (i32.const 0) (select (i32.const 2) (i32.const 1) (i32.ge_u (local.get $o) (i32.const 2)))
      (if (i32.lt_u (local.get $np) (i32.const @HO_NPMAX))
        (then
          (call $sincos (i32.add (local.get $a) (i32.mul (local.get $j) (i32.const 8192))))
          (local.set $c) (local.set $s)
          (local.set $k (call $ho_pa (local.get $np)))
          (f32.store (local.get $k) (!madd (local.get $c) (local.get $rho) (local.get $cx)))
          (f32.store offset=4 (local.get $k) (!madd (local.get $s) (local.get $rho) (local.get $cx)))
          (!inc $np)))))
  (i32.store (i32.const @(PG_H + HO_NP)) (local.get $np)))

;; want of the nh hoops made kind: each a draw of a hoop, the first still on
;; the floor from there on (round past the last).
(func $ho_kinds (param $nh i32) (param $want i32) (param $kind i32)
  (local $q i32) (local $i i32) (local $k i32)
  (if (i32.gt_u (local.get $want) (local.get $nh)) (then (local.set $want (local.get $nh))))
  (!for $q (i32.const 0) (local.get $want)
    (local.set $i (i32.rem_u (call $rand) (local.get $nh)))
    (block $found
      (!for $k (i32.const 0) (local.get $nh)
        (br_if $found (i32.eqz (i32.load offset=@HO_H_KIND (call $ho_ha (local.get $i)))))
        (local.set $i (i32.rem_u (i32.add (local.get $i) (i32.const 1)) (local.get $nh)))))
    (i32.store offset=@HO_H_KIND (call $ho_ha (local.get $i)) (local.get $kind))))

;; A sunflower spiral over the ring from HO_SP0 m out (clear of the ramps) to
;; HO_SP1 of the radius, each point moved out to HO_PADGAP from any pad's
;; middle it is nearer than that (the pads stand apart, so one move clears it).
(func $ho_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $k i32) (local $q i32) (local $a f32) (local $b f32) (local $rho f32) (local $s f32) (local $c f32) (local $cx f32)
  (local $x f32) (local $z f32) (local $dx f32) (local $dz f32) (local $d f32)
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (local.set $a (f32.const @HO_SP0))
  (local.set $b (f32.mul (f32.load (i32.const @(PG_H + HO_RAD))) (f32.const @HO_SP1)))
  (local.set $rho (f32.sqrt (!madd (f32.sub (f32.mul (local.get $b) (local.get $b)) (f32.mul (local.get $a) (local.get $a)))
                                   (f32.div (f32.add (f32.convert_i32_u (local.get $i)) (f32.const 0.5))
                                            (f32.convert_i32_u (select (local.get $n) (i32.const 1) (local.get $n))))
                                   (f32.mul (local.get $a) (local.get $a)))))
  (call $sincos (i32.mul (local.get $i) (i32.const 6258))) ;; the golden angle, in 1/16384 turn
  (local.set $c) (local.set $s)
  (local.set $x (!madd (local.get $c) (local.get $rho) (local.get $cx)))
  (local.set $z (!madd (local.get $s) (local.get $rho) (local.get $cx)))
  (!for $k (i32.const 0) (i32.load (i32.const @(PG_H + HO_NP)))
    (local.set $q (call $ho_pa (local.get $k)))
    (local.set $dx (f32.sub (local.get $x) (f32.load (local.get $q))))
    (local.set $dz (f32.sub (local.get $z) (f32.load offset=4 (local.get $q))))
    (local.set $d (f32.sqrt (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz)))))
    (if (f32.lt (local.get $d) (f32.const @HO_PADGAP))
      (then
        (if (f32.lt (local.get $d) (f32.const 0.01)) (then (local.set $dx (f32.const 1)) (local.set $dz (f32.const 0)) (local.set $d (f32.const 1))))
        (local.set $x (!madd (f32.div (local.get $dx) (local.get $d)) (f32.const @HO_PADGAP) (f32.load (local.get $q))))
        (local.set $z (!madd (f32.div (local.get $dz) (local.get $d)) (f32.const @HO_PADGAP) (f32.load offset=4 (local.get $q)))))))
  (local.get $x) (f32.const @PLAT_Y) (local.get $z))

;; Slot p's ball's centre now, kept for the next tick's crossings.
(func $ho_keep (param $p i32)
  (local $pb i32) (local $q i32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (local.set $q (i32.add (i32.const @(PG_S + HO_PREV)) (i32.mul (local.get $p) (i32.const 12))))
  (f32.store (local.get $q) (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (f32.store offset=4 (local.get $q) (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (call $b_rad (local.get $pb))))
  (f32.store offset=8 (local.get $q) (!at f32 @(PLAYERS + P_PZ) (local.get $pb))))

;; Every ball's centre as play starts, for the first tick's crossings.
(func $ho_start
  (local $p i32)
  (!for $p (i32.const 0) (i32.const @NPLAYER) (call $ho_keep (local.get $p))))

(func $ho_begin (param $p i32) (param $d i32))

;; The top of ramp j under (x, z) over the floor (0 at its toe, HO_RH at its
;; lip), or -1 if (x, z) is off it.
(func $ho_rise (param $j i32) (param $x f32) (param $z f32) (result f32)
  (local $o i32) (local $dx f32) (local $dz f32) (local $a f32) (local $w f32)
  (local.set $o (call $ho_ra (local.get $j)))
  (local.set $dx (f32.sub (local.get $x) (f32.load (local.get $o))))
  (local.set $dz (f32.sub (local.get $z) (f32.load offset=4 (local.get $o))))
  (local.set $a (!madd (local.get $dx) (f32.load offset=8 (local.get $o)) (f32.mul (local.get $dz) (f32.load offset=12 (local.get $o)))))
  (local.set $w (f32.sub (f32.mul (local.get $dz) (f32.load offset=8 (local.get $o))) (f32.mul (local.get $dx) (f32.load offset=12 (local.get $o)))))
  (if (result f32) (i32.and (i32.and (f32.ge (local.get $a) (f32.const 0)) (f32.le (local.get $a) (f32.const @HO_RL)))
                            (f32.le (f32.abs (local.get $w)) (f32.const @HO_RW)))
    (then (f32.mul (local.get $a) (f32.const @(HO_RH / HO_RL))))
    (else (f32.const -1))))

;; The court's top under (x, z) no higher than y on bank d: a ramp's if it is
;; on one and that is no higher than y, else the floor; none off the rim or
;; under the floor's top.
(func $ho_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (local $j i32) (local $r f32) (local $dx f32) (local $dz f32) (local $top f32) (local $h f32)
  (if (f32.lt (local.get $y) (f32.const @PLAT_Y)) (then (return (f32.const -1000))))
  (local.set $r (f32.load offset=@(PG_H + HO_RAD) (local.get $d)))
  (local.set $dx (f32.sub (local.get $x) (f32.load offset=@PG_CX (local.get $d))))
  (local.set $dz (f32.sub (local.get $z) (f32.load offset=@PG_CX (local.get $d))))
  (if (f32.gt (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))) (f32.mul (local.get $r) (local.get $r)))
    (then (return (f32.const -1000))))
  (local.set $top (f32.const @PLAT_Y))
  (!for $j (i32.const 0) (i32.load offset=@(PG_H + HO_NRAMP) (local.get $d))
    (local.set $h (f32.add (call $ho_rise (local.get $j) (local.get $x) (local.get $z)) (f32.const @PLAT_Y)))
    (if (f32.le (local.get $h) (local.get $y)) (then (local.set $top (f32.max (local.get $top) (local.get $h))))))
  (local.get $top))

;; After ball p's roll on bank d: the ramps and the pads. On a ramp the slope
;; pulls a ball back down and it rises with it (a little slower, so it leaves
;; the lip flying), and one just over it and not rising fast goes back onto
;; it; beside one, its sides and its back are walls wherever their top is
;; more than a step over the ball's bottom (the ball's sphere against the
;; wall's face, or its top edge), and a ball found inside one (only at speeds
;; past any roll) goes out its nearest wall. A ball on the floor whose centre
;; is on a pad is thrown up. Writes only its own record and bank d's FX.
(func $ho_push (param $p i32) (param $d i32)
  (local $pb i32) (local $fl i32) (local $j i32) (local $o i32) (local $ch i32) (local $n i32)
  (local $px f32) (local $py f32) (local $pz f32) (local $vx f32) (local $vy f32) (local $vz f32) (local $r f32)
  (local $c f32) (local $s f32) (local $rx f32) (local $rz f32) (local $a f32) (local $w f32) (local $qa f32) (local $qw f32)
  (local $h f32) (local $top f32) (local $da f32) (local $dw f32) (local $dd f32) (local $e f32) (local $dy f32)
  (local $na f32) (local $nw f32) (local $nx f32) (local $nz f32) (local $vn f32) (local $va f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
  (if (i32.and (local.get $fl) (i32.const @(PF_FALL | PF_DEAD))) (then (return)))
  (local.set $px (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (local.set $py (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
  (local.set $pz (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (local.set $vx (!at f32 @(PLAYERS + P_VX) (local.get $pb)))
  (local.set $vy (!at f32 @(PLAYERS + P_VY) (local.get $pb)))
  (local.set $vz (!at f32 @(PLAYERS + P_VZ) (local.get $pb)))
  (local.set $r (call $b_rad (local.get $pb)))
  (!for $j (i32.const 0) (i32.load offset=@(PG_H + HO_NRAMP) (local.get $d))
    (local.set $o (call $ho_ra (local.get $j)))
    (local.set $rx (f32.load (local.get $o)))
    (local.set $rz (f32.load offset=4 (local.get $o)))
    (local.set $c (f32.load offset=8 (local.get $o)))
    (local.set $s (f32.load offset=12 (local.get $o)))
    ;; along its way up from the toe, and across it
    (local.set $a (!madd (f32.sub (local.get $px) (local.get $rx)) (local.get $c) (f32.mul (f32.sub (local.get $pz) (local.get $rz)) (local.get $s))))
    (local.set $w (f32.sub (f32.mul (f32.sub (local.get $pz) (local.get $rz)) (local.get $c)) (f32.mul (f32.sub (local.get $px) (local.get $rx)) (local.get $s))))
    (if (i32.and (i32.and (f32.gt (local.get $a) (f32.neg (f32.add (local.get $r) (f32.const 0.5))))
                          (f32.lt (local.get $a) (f32.add (local.get $r) (f32.const @(HO_RL + 0.5)))))
                 (f32.lt (f32.abs (local.get $w)) (f32.add (local.get $r) (f32.const @(HO_RW + 0.5)))))
      (then
        (if (i32.and (i32.and (f32.ge (local.get $a) (f32.const 0)) (f32.le (local.get $a) (f32.const @HO_RL)))
                     (f32.le (f32.abs (local.get $w)) (f32.const @HO_RW)))
          (then
            ;; over it
            (local.set $top (!madd (local.get $a) (f32.const @(HO_RH / HO_RL)) (f32.const @PLAT_Y)))
            (if (f32.lt (local.get $py) (f32.sub (local.get $top) (f32.const @P_STEP)))
              (then
                ;; inside it: out its nearer side, or its back
                (local.set $na (f32.const 0))
                (local.set $nw (select (f32.const 1) (f32.const -1) (f32.ge (local.get $w) (f32.const 0))))
                (if (f32.lt (f32.sub (f32.const @HO_RL) (local.get $a)) (f32.sub (f32.const @HO_RW) (f32.abs (local.get $w))))
                  (then
                    (local.set $na (f32.const 1))
                    (local.set $nw (f32.const 0))
                    (local.set $a (f32.add (f32.const @HO_RL) (local.get $r))))
                  (else (local.set $w (f32.mul (local.get $nw) (f32.add (f32.const @HO_RW) (local.get $r))))))
                (call $ho_wall (local.get $rx) (local.get $rz) (local.get $c) (local.get $s) (local.get $a) (local.get $w) (local.get $na) (local.get $nw)
                               (local.get $vx) (local.get $vz))
                (local.set $vz) (local.set $vx) (local.set $pz) (local.set $px)
                (local.set $ch (i32.const 1)))
              (else
                ;; the grip, then the slope
                (if (i32.and (i32.and (i32.eqz (i32.and (local.get $fl) (i32.const @PF_GROUND))) (f32.le (local.get $vy) (f32.const @HO_SNAPV)))
                             (i32.and (f32.ge (local.get $py) (local.get $top)) (f32.le (local.get $py) (f32.add (local.get $top) (f32.const @HO_SNAP)))))
                  (then
                    (local.set $py (local.get $top))
                    (local.set $fl (i32.or (local.get $fl) (i32.const @PF_GROUND)))
                    (local.set $ch (i32.const 1))))
                (if (i32.and (local.get $fl) (i32.const @PF_GROUND))
                  (then
                    (local.set $vx (f32.sub (local.get $vx) (f32.mul (local.get $c) (f32.const @(HO_PULL * HO_RH / HO_RL * DT)))))
                    (local.set $vz (f32.sub (local.get $vz) (f32.mul (local.get $s) (f32.const @(HO_PULL * HO_RH / HO_RL * DT)))))
                    (local.set $va (!madd (local.get $vx) (local.get $c) (f32.mul (local.get $vz) (local.get $s))))
                    (local.set $vy (f32.mul (local.get $va) (select (f32.const @(HO_RH / HO_RL * HO_RISE)) (f32.const @(HO_RH / HO_RL)) (f32.gt (local.get $va) (f32.const 0)))))
                    (local.set $ch (i32.const 1)))))))
          (else
            ;; beside it: the nearest point of its footprint, and its wall's top there
            (local.set $qa (f32.min (f32.max (local.get $a) (f32.const 0)) (f32.const @HO_RL)))
            (local.set $qw (f32.min (f32.max (local.get $w) (f32.const @(-HO_RW))) (f32.const @HO_RW)))
            (local.set $h (!madd (local.get $qa) (f32.const @(HO_RH / HO_RL)) (f32.const @PLAT_Y)))
            (if (f32.gt (local.get $h) (f32.add (local.get $py) (f32.const @P_STEP)))
              (then
                ;; how near its centre may come: its radius under the top edge, less above it
                (local.set $dy (f32.sub (f32.add (local.get $py) (local.get $r)) (local.get $h)))
                (local.set $e (local.get $r))
                (if (f32.gt (local.get $dy) (f32.const 0))
                  (then (local.set $e (f32.sqrt (f32.max (f32.const 0) (f32.sub (f32.mul (local.get $r) (local.get $r)) (f32.mul (local.get $dy) (local.get $dy))))))))
                (local.set $da (f32.sub (local.get $a) (local.get $qa)))
                (local.set $dw (f32.sub (local.get $w) (local.get $qw)))
                (local.set $dd (f32.sqrt (!madd (local.get $da) (local.get $da) (f32.mul (local.get $dw) (local.get $dw)))))
                (if (f32.lt (local.get $dd) (local.get $e))
                  (then
                    (local.set $na (f32.div (local.get $da) (f32.max (local.get $dd) (f32.const 1e-6))))
                    (local.set $nw (f32.div (local.get $dw) (f32.max (local.get $dd) (f32.const 1e-6))))
                    (call $ho_wall (local.get $rx) (local.get $rz) (local.get $c) (local.get $s)
                                   (!madd (local.get $na) (local.get $e) (local.get $qa)) (!madd (local.get $nw) (local.get $e) (local.get $qw))
                                   (local.get $na) (local.get $nw) (local.get $vx) (local.get $vz))
                    (local.set $vz) (local.set $vx) (local.set $pz) (local.set $px)
                    (local.set $ch (i32.const 1)))))))))))
  ;; the pads: a ball rolling on the floor onto one is thrown up
  (if (i32.and (i32.ne (i32.and (local.get $fl) (i32.const @PF_GROUND)) (i32.const 0)) (f32.le (local.get $py) (f32.const @PLAT_Y)))
    (then
      (local.set $n (i32.load offset=@(PG_H + HO_NP) (local.get $d)))
      (block $thrown
        (!for $j (i32.const 0) (local.get $n)
          (local.set $o (call $ho_pa (local.get $j)))
          (local.set $da (f32.sub (local.get $px) (f32.load (local.get $o))))
          (local.set $dw (f32.sub (local.get $pz) (f32.load offset=4 (local.get $o))))
          (if (f32.lt (!madd (local.get $da) (local.get $da) (f32.mul (local.get $dw) (local.get $dw))) (f32.const @(HO_PADR * HO_PADR)))
            (then
              (local.set $vy (f32.const @HO_PADV))
              (local.set $fl (i32.and (local.get $fl) (i32.const @(255 ^ PF_GROUND))))
              (local.set $ch (i32.const 1))
              (call $fx (local.get $d) (i32.const @HO_FX_PAD) (local.get $p) (local.get $j)
                        (f32.load (local.get $o)) (f32.const @PLAT_Y) (f32.load offset=4 (local.get $o)) (f32.const @HO_PADV))
              (br $thrown)))))))
  (if (i32.eqz (local.get $ch)) (then (return)))
  (!chk (local.get $px) 152 (local.get $p))
  (!chk (local.get $py) 152 (local.get $p))
  (!chk (local.get $pz) 152 (local.get $p))
  (!chk (local.get $vx) 153 (local.get $p))
  (!chk (local.get $vy) 153 (local.get $p))
  (!chk (local.get $vz) 153 (local.get $p))
  (!put f32 @(PLAYERS + P_PX) (local.get $pb) (local.get $px))
  (!put f32 @(PLAYERS + P_PY) (local.get $pb) (local.get $py))
  (!put f32 @(PLAYERS + P_PZ) (local.get $pb) (local.get $pz))
  (!put f32 @(PLAYERS + P_VX) (local.get $pb) (local.get $vx))
  (!put f32 @(PLAYERS + P_VY) (local.get $pb) (local.get $vy))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (local.get $vz))
  (!put u8 @(PLAYERS + P_FL) (local.get $pb) (local.get $fl)))

;; A ball put at (a, w) in the frame of the ramp whose toe's middle is (rx,
;; rz) and whose way up is (c, s), off a wall whose outward normal there is
;; (na, nw) in that frame: its place in the world, and its velocity (vx, vz)
;; with what went into the wall turned back at HO_WALLE.
(func $ho_wall (param $rx f32) (param $rz f32) (param $c f32) (param $s f32) (param $a f32) (param $w f32) (param $na f32) (param $nw f32)
               (param $vx f32) (param $vz f32) (result f32 f32 f32 f32)
  (local $nx f32) (local $nz f32) (local $vn f32)
  (local.set $nx (f32.sub (f32.mul (local.get $c) (local.get $na)) (f32.mul (local.get $s) (local.get $nw))))
  (local.set $nz (!madd (local.get $s) (local.get $na) (f32.mul (local.get $c) (local.get $nw))))
  (local.set $vn (!madd (local.get $vx) (local.get $nx) (f32.mul (local.get $vz) (local.get $nz))))
  (if (f32.lt (local.get $vn) (f32.const 0))
    (then
      (local.set $vx (f32.sub (local.get $vx) (f32.mul (local.get $nx) (f32.mul (local.get $vn) (f32.const @(1 + HO_WALLE))))))
      (local.set $vz (f32.sub (local.get $vz) (f32.mul (local.get $nz) (f32.mul (local.get $vn) (f32.const @(1 + HO_WALLE))))))))
  (f32.sub (!madd (local.get $c) (local.get $a) (local.get $rx)) (f32.mul (local.get $s) (local.get $w)))
  (!madd (local.get $c) (local.get $w) (!madd (local.get $s) (local.get $a) (local.get $rz)))
  (local.get $vx)
  (local.get $vz))

;; Slot p's score plus k, held to a u16.
(func $ho_add (param $p i32) (param $k i32)
  (local $pb i32) (local $s i32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (local.set $s (i32.add (!at u16 @(PLAYERS + PG_SCORE) (local.get $pb)) (local.get $k)))
  (!put u16 @(PLAYERS + PG_SCORE) (local.get $pb) (select (local.get $s) (i32.const 65535) (i32.lt_u (local.get $s) (i32.const 65535)))))

;; The round's world, a tick of it: the hoops as they were on the last tick
;; and are on this one; then, in slot order, each ball in through every hoop
;; of the orbits near it whose plane its centre crossed since the last tick,
;; moving itself through it, inside its ring there (a ball moved further than
;; a roll can, a respawn, crosses nothing), scoring it unless it did within
;; HO_AGAIN; every ball's centre kept; the double points called; and the
;; leader (the most points of anyone in the room, a tie keeping the one who
;; had it: HO_LEAD, for the crown; HO_FX_LEAD at most every HO_LEADGAP).
(func $ho_tick
  (local $t i32) (local $p i32) (local $pb i32) (local $o i32) (local $ob i32) (local $no i32) (local $i i32) (local $e i32)
  (local $h0 i32) (local $h1 i32) (local $q i32) (local $l i32) (local $pts i32) (local $double i32)
  (local $lead i32) (local $who i32) (local $best i32) (local $s i32)
  (local $x0 f32) (local $y0 f32) (local $z0 f32) (local $x1 f32) (local $y1 f32) (local $z1 f32) (local $cx f32) (local $rb f32)
  (local $ex f32) (local $ey f32) (local $ez f32) (local $r f32) (local $s0 f32) (local $s1 f32) (local $mv f32) (local $u f32)
  (local $w0 f32) (local $w1 f32) (local $v0 f32) (local $v1 f32) (local $wu f32) (local $vu f32) (local $nx0 f32) (local $nz0 f32) (local $nx1 f32) (local $nz1 f32)
  (local.set $t (call $p_t (i32.const 0)))
  (local.set $double (i32.ge_u (local.get $t) (i32.const @HO_DOUBLE)))
  (call $ho_now (i32.const 0) (select (i32.sub (local.get $t) (i32.const 1)) (i32.const 0) (local.get $t)))
  (call $ho_now (i32.const 1) (local.get $t))
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (local.set $no (i32.load (i32.const @(PG_H + HO_NO))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (if (call $p_in (local.get $pb))
      (then (block $ball
        (local.set $q (i32.add (i32.const @(PG_S + HO_PREV)) (i32.mul (local.get $p) (i32.const 12))))
        (local.set $x0 (f32.load (local.get $q)))
        (local.set $y0 (f32.load offset=4 (local.get $q)))
        (local.set $z0 (f32.load offset=8 (local.get $q)))
        (local.set $x1 (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
        (local.set $y1 (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (call $b_rad (local.get $pb))))
        (local.set $z1 (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
        (local.set $ex (f32.sub (local.get $x1) (local.get $x0)))
        (local.set $ey (f32.sub (local.get $y1) (local.get $y0)))
        (local.set $ez (f32.sub (local.get $z1) (local.get $z0)))
        (br_if $ball (f32.ge (!dot3 (local.get $ex) (local.get $ey) (local.get $ez) (local.get $ex) (local.get $ey) (local.get $ez)) (f32.const 1)))
        (local.set $ex (f32.sub (local.get $x1) (local.get $cx)))
        (local.set $ez (f32.sub (local.get $z1) (local.get $cx)))
        (local.set $rb (f32.sqrt (!madd (local.get $ex) (local.get $ex) (f32.mul (local.get $ez) (local.get $ez)))))
        (!for $o (i32.const 0) (local.get $no)
          (local.set $ob (call $ho_oa (local.get $o)))
          (if (f32.lt (f32.abs (f32.sub (local.get $rb) (f32.load (local.get $ob)))) (f32.const @HO_BAND))
            (then
              (local.set $i (i32.load offset=4 (local.get $ob)))
              (local.set $e (i32.add (local.get $i) (i32.load offset=8 (local.get $ob))))
              (block $hoops (loop $hoop
                (br_if $hoops (i32.ge_u (local.get $i) (local.get $e)))
                (block $next
                  (local.set $h1 (call $ho_na (i32.const 1) (local.get $i)))
                  (local.set $r (f32.load offset=12 (local.get $h1)))
                  (local.set $ex (f32.sub (local.get $x1) (f32.load (local.get $h1))))
                  (local.set $ey (f32.sub (local.get $y1) (f32.load offset=8 (local.get $h1))))
                  (local.set $ez (f32.sub (local.get $z1) (f32.load offset=4 (local.get $h1))))
                  (br_if $next (f32.gt (!dot3 (local.get $ex) (local.get $ey) (local.get $ez) (local.get $ex) (local.get $ey) (local.get $ez))
                                       (f32.mul (f32.add (local.get $r) (f32.const 1.5)) (f32.add (local.get $r) (f32.const 1.5)))))
                  (local.set $nx1 (f32.load offset=16 (local.get $h1)))
                  (local.set $nz1 (f32.load offset=20 (local.get $h1)))
                  (local.set $h0 (call $ho_na (i32.const 0) (local.get $i)))
                  (local.set $nx0 (f32.load offset=16 (local.get $h0)))
                  (local.set $nz0 (f32.load offset=20 (local.get $h0)))
                  ;; either side of its plane, on the last tick and on this one
                  (local.set $s1 (!madd (local.get $nx1) (local.get $ex) (f32.mul (local.get $nz1) (local.get $ez))))
                  (local.set $w1 (f32.sub (f32.mul (local.get $nx1) (local.get $ez)) (f32.mul (local.get $nz1) (local.get $ex))))
                  (local.set $v1 (local.get $ey))
                  (local.set $ex (f32.sub (local.get $x0) (f32.load (local.get $h0))))
                  (local.set $ez (f32.sub (local.get $z0) (f32.load offset=4 (local.get $h0))))
                  (local.set $s0 (!madd (local.get $nx0) (local.get $ex) (f32.mul (local.get $nz0) (local.get $ez))))
                  (local.set $w0 (f32.sub (f32.mul (local.get $nx0) (local.get $ez)) (f32.mul (local.get $nz0) (local.get $ex))))
                  (local.set $v0 (f32.sub (local.get $y0) (f32.load offset=8 (local.get $h0))))
                  (br_if $next (i32.eq (f32.lt (local.get $s0) (f32.const 0)) (f32.lt (local.get $s1) (f32.const 0))))
                  ;; through it its own way, fast enough: its own move along the normal, the way it crossed
                  (local.set $mv (!madd (local.get $nx1) (f32.sub (local.get $x1) (local.get $x0)) (f32.mul (local.get $nz1) (f32.sub (local.get $z1) (local.get $z0)))))
                  (br_if $next (f32.lt (f32.mul (local.get $mv) (select (f32.const 1) (f32.const -1) (f32.gt (local.get $s1) (local.get $s0)))) (f32.const @HO_MOVE)))
                  ;; where it crossed, in the ring's plane: inside it?
                  (local.set $u (f32.div (local.get $s0) (f32.sub (local.get $s0) (local.get $s1))))
                  (local.set $wu (!madd (f32.sub (local.get $w1) (local.get $w0)) (local.get $u) (local.get $w0)))
                  (local.set $vu (!madd (f32.sub (local.get $v1) (local.get $v0)) (local.get $u) (local.get $v0)))
                  (br_if $next (f32.ge (!madd (local.get $wu) (local.get $wu) (f32.mul (local.get $vu) (local.get $vu))) (f32.mul (local.get $r) (local.get $r))))
                  ;; not again so soon
                  (local.set $l (i32.add (i32.const @(PG_BIG + HO_LAST)) (i32.shl (i32.add (i32.mul (local.get $p) (i32.const @HO_NMAX)) (local.get $i)) (i32.const 1))))
                  (local.set $s (i32.load16_u (local.get $l)))
                  (br_if $next (i32.and (i32.ne (local.get $s) (i32.const 0))
                                        (i32.lt_u (i32.sub (local.get $t) (i32.sub (local.get $s) (i32.const 1))) (i32.const @HO_AGAIN))))
                  (i32.store16 (local.get $l) (i32.add (local.get $t) (i32.const 1)))
                  (local.set $pts (select (i32.const @HO_GOLDV) (i32.const 1)
                                          (i32.eq (i32.load offset=@HO_H_KIND (call $ho_ha (local.get $i))) (i32.const @HO_KGOLD))))
                  (local.set $pts (i32.shl (local.get $pts) (local.get $double)))
                  (call $ho_add (local.get $p) (local.get $pts))
                  (local.set $q (call $ho_ha (local.get $i)))
                  (i32.store offset=@HO_H_HITS (local.get $q) (i32.add (i32.load offset=@HO_H_HITS (local.get $q)) (i32.const 1)))
                  (call $fx (i32.const 0) (i32.const @HO_FX_SCORE) (local.get $p) (local.get $i)
                            (!madd (f32.sub (local.get $x1) (local.get $x0)) (local.get $u) (local.get $x0))
                            (!madd (f32.sub (local.get $y1) (local.get $y0)) (local.get $u) (local.get $y0))
                            (!madd (f32.sub (local.get $z1) (local.get $z0)) (local.get $u) (local.get $z0))
                            (f32.convert_i32_u (local.get $pts))))
                (!inc $i)
                (br $hoop))))))))))
  (!for $p (i32.const 0) (i32.const @NPLAYER) (call $ho_keep (local.get $p)))
  (if (i32.eq (local.get $t) (i32.const @HO_DOUBLE))
    (then (call $fx (i32.const 0) (i32.const @HO_FX_CALL) (i32.const 255) (i32.const 0) (local.get $cx) (f32.const @PLAT_Y) (local.get $cx) (f32.const 2))))
  ;; the leader
  (local.set $lead (i32.load (i32.const @(PG_H + HO_LEAD))))
  (local.set $who (i32.const 0xffff))
  (local.set $best (i32.const 0))
  (if (i32.lt_u (local.get $lead) (i32.const @NPLAYER))
    (then
      (if (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $lead) (i32.const 6))) (i32.const @PF_LIVE))
        (then
          (local.set $who (local.get $lead))
          (local.set $best (!at u16 @(PLAYERS + PG_SCORE) (i32.shl (local.get $lead) (i32.const 6))))))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (if (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_LIVE))
      (then
        (local.set $s (!at u16 @(PLAYERS + PG_SCORE) (local.get $pb)))
        (if (i32.gt_u (local.get $s) (local.get $best))
          (then (local.set $best (local.get $s)) (local.set $who (local.get $p)))))))
  (if (i32.eqz (local.get $best)) (then (local.set $who (i32.const 0xffff))))
  (if (i32.ne (local.get $who) (local.get $lead))
    (then
      (i32.store (i32.const @(PG_H + HO_LEAD)) (local.get $who))
      (if (i32.and (i32.lt_u (local.get $who) (i32.const @NPLAYER))
                   (i32.or (i32.eqz (i32.load (i32.const @(PG_H + HO_LEADT))))
                           (i32.ge_u (i32.sub (local.get $t) (i32.load (i32.const @(PG_H + HO_LEADT)))) (i32.const @HO_LEADGAP))))
        (then
          (i32.store (i32.const @(PG_H + HO_LEADT)) (local.get $t))
          (local.set $pb (i32.shl (local.get $who) (i32.const 6)))
          (call $fx (i32.const 0) (i32.const @HO_FX_LEAD) (local.get $who) (local.get $lead)
                    (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (!at f32 @(PLAYERS + P_PZ) (local.get $pb))
                    (f32.convert_i32_u (local.get $best))))))))

(func $ho_over (result i32) (i32.const 0))
(func $ho_out (param $p i32))
