;; CANNONADE: a disc of hex tiles over the sea, sized for the crowd, ringed
;; with cannons on posts past its rim. Volleys of cannonballs roll straight
;; across it and off the far side; each shot shows as a red stripe down its
;; lane and its cannon's muzzle glowing CN_TELE ticks before it fires, and a
;; cannonball knocks what it meets on along its own path. Volleys grow and
;; come closer together; from CN_LOBFROM some shots are lobbed onto a marked
;; ring and roll on from there; from CN_CRUMBLE the rim crumbles in to
;; CN_RMIN. Balls bump each other too. Last ball on wins.
;;
;; Everything a ball meets is laid by setup, before the countdown: each tile
;; with the tick into play the rim takes it, and the whole round's shots (which
;; cannon, the lane, size, speed, lobbed or not, from the round's random
;; numbers), in PG_BIG, in the order they fire, with a bucket index over the
;; round's clock. A cannonball is where the tick puts it on its line: flying
;; from the muzzle to where it touches down, rolling, then falling past the
;; far rim. So ground and push on either bank read only what was fixed long
;; before, against the bank's own tick, and the prediction rolls your ball
;; through every shot exactly as the confirmed world will.

;; Cell (q, r)'s byte offset in the tiles, -1 off the grid.
(func $cn_cell (param $q i32) (param $r i32) (result i32)
  (if (i32.or (i32.gt_u (i32.add (local.get $q) (i32.const @CN_N)) (i32.const @(2 * CN_N)))
              (i32.gt_u (i32.add (local.get $r) (i32.const @CN_N)) (i32.const @(2 * CN_N))))
    (then (return (i32.const -1))))
  (i32.shl (i32.add (i32.mul (i32.add (local.get $r) (i32.const @CN_N)) (i32.const @CN_W)) (i32.add (local.get $q) (i32.const @CN_N)))
           (i32.const 1)))

;; The rim on tick tp into play: the disc's own until CN_CRUMBLE, then in to
;; CN_RMIN over CN_SHRINK. (A tile goes by its cell; this is where the shots
;; aim and run off.) Setup's.
(func $cn_rim (param $tp i32) (result f32)
  (local $r0 f32) (local $k i32)
  (local.set $r0 (f32.load (i32.const @(PG_H + CN_RAD))))
  (local.set $k (i32.sub (local.get $tp) (i32.const @CN_CRUMBLE)))
  (if (i32.le_s (local.get $k) (i32.const 0)) (then (return (local.get $r0))))
  (if (i32.ge_s (local.get $k) (i32.const @CN_SHRINK)) (then (return (f32.const @CN_RMIN))))
  (f32.sub (local.get $r0) (f32.mul (f32.sub (local.get $r0) (f32.const @CN_RMIN))
                                    (f32.div (f32.convert_i32_s (local.get $k)) (f32.const @CN_SHRINK)))))

;; The round's random number for k, as a unit in [0, 1).
(func $cn_unit (param $k i32) (result f32)
  (f32.mul (f32.convert_i32_u (i32.shr_u (call $p_seed (local.get $k)) (i32.const 8))) (f32.const 0x1p-24)))

;; Every tile whose centre is on the disc, each with the tick into play the
;; rim takes it: the first past CN_CRUMBLE plus its share of CN_SHRINK (its
;; distance in from the rim over the rim's way to CN_RMIN) plus up to CN_JIT;
;; never inside CN_RMIN.
(func $cn_tiles (param $rad f32)
  (local $q i32) (local $r i32) (local $count i32) (local $drop i32)
  (local $x f32) (local $z f32) (local $dx f32) (local $dz f32) (local $rho f32)
  (!for $r (i32.const 0) (i32.const @CN_W)
    (!for $q (i32.const 0) (i32.const @CN_W)
      (call $p_hexc (i32.sub (local.get $q) (i32.const @CN_N)) (i32.sub (local.get $r) (i32.const @CN_N)) (f32.const @CN_S))
      (local.set $z) (local.set $x)
      (local.set $dx (f32.sub (local.get $x) (f32.load (i32.const @PG_CX))))
      (local.set $dz (f32.sub (local.get $z) (f32.load (i32.const @PG_CX))))
      (local.set $rho (f32.sqrt (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz)))))
      (if (f32.le (local.get $rho) (local.get $rad))
        (then
          (!inc $count)
          (local.set $drop (i32.const @CN_NEVER))
          (if (f32.gt (local.get $rho) (f32.const @CN_RMIN))
            (then
              (local.set $drop
                (i32.add (i32.add (i32.const @(CN_CRUMBLE + 1))
                                  (i32.trunc_sat_f32_s (f32.mul (f32.div (f32.sub (local.get $rad) (local.get $rho)) (f32.sub (local.get $rad) (f32.const @CN_RMIN)))
                                                                (f32.const @CN_SHRINK))))
                         (i32.rem_u (call $p_seed (i32.add (i32.const 0x10000) (i32.add (i32.mul (local.get $r) (i32.const @CN_W)) (local.get $q))))
                                    (i32.const @CN_JIT))))))
          (i32.store16 offset=@(PG_BIG + CN_TILES)
            (i32.shl (i32.add (i32.mul (local.get $r) (i32.const @CN_W)) (local.get $q)) (i32.const 1)) (local.get $drop))))))
  (i32.store (i32.const @(PG_H + CN_COUNT)) (local.get $count)))

;; Shot k (volley vi of n shots, the first of it if first), from cannon c,
;; firing on tick tf into play, lobbed if lob. Its lane passes the centre up
;; to CN_AIM of the rim as it stands then either side; it leaves the muzzle,
;; touches down CN_IN inside the rim (a lob, part way across), rolls, and
;; leaves the floor where it meets the rim as that will stand when it gets
;; there (worked out three times over, the rim moving as it rolls).
(func $cn_shot (param $k i32) (param $c i32) (param $tf i32) (param $lob i32) (param $first i32) (param $vi i32) (param $n i32)
  (local $a i32) (local $tt i32) (local $te i32) (local $it i32) (local $fl i32)
  (local $cx f32) (local $s f32) (local $co f32) (local $ccx f32) (local $ccz f32) (local $reff f32) (local $off f32)
  (local $ux f32) (local $uz f32) (local $len f32) (local $mx f32) (local $mz f32) (local $wx f32) (local $wz f32)
  (local $b f32) (local $ww f32) (local $sq f32) (local $sin f32) (local $st f32) (local $sout f32) (local $rx f32)
  (local $rc f32) (local $v f32) (local $u f32) (local $arc f32) (local $vdt f32) (local $ft f32)
  (local.set $a (i32.mul (local.get $k) (i32.const @CN_REC)))
  (local.set $cx (f32.load (i32.const @PG_CX)))
  ;; the cannon, on its ring, and the lane through the middle
  (call $sincos (i32.add (i32.load (i32.const @(PG_H + CN_ROT)))
                         (i32.div_u (i32.mul (local.get $c) (i32.const 16384)) (i32.load (i32.const @(PG_H + CN_NC))))))
  (local.set $co) (local.set $s)
  (local.set $len (f32.load (i32.const @(PG_H + CN_RC))))
  (local.set $ccx (!madd (local.get $co) (local.get $len) (local.get $cx)))
  (local.set $ccz (!madd (local.get $s) (local.get $len) (local.get $cx)))
  (local.set $reff (call $cn_rim (local.get $tf)))
  (local.set $off (f32.mul (f32.sub (f32.mul (call $cn_unit (i32.add (i32.const 0x20000) (i32.shl (local.get $k) (i32.const 2)))) (f32.const 2)) (f32.const 1))
                           (f32.mul (local.get $reff) (f32.const @CN_AIM))))
  ;; heading from the cannon to the point off the centre across its bearing (-sin, cos)
  (local.set $ux (f32.sub (f32.sub (local.get $cx) (f32.mul (local.get $s) (local.get $off))) (local.get $ccx)))
  (local.set $uz (f32.sub (!madd (local.get $co) (local.get $off) (local.get $cx)) (local.get $ccz)))
  (local.set $len (f32.sqrt (!madd (local.get $ux) (local.get $ux) (f32.mul (local.get $uz) (local.get $uz)))))
  (local.set $ux (f32.div (local.get $ux) (local.get $len)))
  (local.set $uz (f32.div (local.get $uz) (local.get $len)))
  (local.set $mx (!madd (local.get $ux) (f32.const @CN_BARREL) (local.get $ccx)))
  (local.set $mz (!madd (local.get $uz) (f32.const @CN_BARREL) (local.get $ccz)))
  ;; where the lane crosses the rim, in distance from the muzzle: s = -b -+ sqrt(b^2 - (w.w - R^2))
  (local.set $wx (f32.sub (local.get $mx) (local.get $cx)))
  (local.set $wz (f32.sub (local.get $mz) (local.get $cx)))
  (local.set $b (!madd (local.get $wx) (local.get $ux) (f32.mul (local.get $wz) (local.get $uz))))
  (local.set $ww (!madd (local.get $wx) (local.get $wx) (f32.mul (local.get $wz) (local.get $wz))))
  (local.set $rx (f32.sub (local.get $reff) (f32.const @CN_IN)))
  (local.set $sq (f32.sqrt (f32.max (f32.sub (f32.mul (local.get $b) (local.get $b)) (f32.sub (local.get $ww) (f32.mul (local.get $rx) (local.get $rx))))
                                    (f32.const 0))))
  (local.set $sin (f32.sub (f32.neg (local.get $b)) (local.get $sq)))
  ;; its size, small ones more often, and its speed, big ones slower, a little faster as the round goes
  (local.set $u (call $cn_unit (i32.add (i32.const 0x20001) (i32.shl (local.get $k) (i32.const 2)))))
  (local.set $u (f32.mul (local.get $u) (local.get $u)))
  (local.set $rc (!madd (local.get $u) (f32.const @(CN_RC1 - CN_RC0)) (f32.const @CN_RC0)))
  (local.set $v (!madd (local.get $u) (f32.const @(CN_V1 - CN_V0)) (f32.const @CN_V0)))
  (local.set $v (!madd (f32.sub (f32.mul (call $cn_unit (i32.add (i32.const 0x20002) (i32.shl (local.get $k) (i32.const 2)))) (f32.const 2)) (f32.const 1))
                       (f32.const @CN_VJ) (local.get $v)))
  (local.set $v (!madd (f32.div (f32.convert_i32_u (local.get $tf)) (f32.const @CN_LEN)) (f32.const @CN_VUP) (local.get $v)))
  (local.set $vdt (f32.mul (local.get $v) (f32.const @DT)))
  (if (local.get $lob)
    (then
      ;; up and over to a point part way across
      (local.set $st (!madd (f32.mul (local.get $sq) (f32.const 2))
                            (!madd (call $cn_unit (i32.add (i32.const 0x20003) (i32.shl (local.get $k) (i32.const 2)))) (f32.const @CN_LOBB) (f32.const @CN_LOBA))
                            (local.get $sin)))
      (local.set $tt (i32.add (i32.add (local.get $tf) (i32.const @CN_LOBT0))
                              (i32.trunc_sat_f32_u (f32.mul (local.get $st) (f32.const @CN_LOBTK)))))
      (local.set $arc (f32.const @CN_LOBH)))
    (else
      ;; down onto the rim at its rolling speed, over a low arc
      (local.set $st (local.get $sin))
      (local.set $tt (i32.add (i32.add (local.get $tf) (i32.const 1)) (i32.trunc_sat_f32_u (f32.div (local.get $st) (local.get $vdt)))))
      (local.set $arc (f32.mul (local.get $st) (f32.const @CN_ARC)))))
  (local.set $ft (f32.div (local.get $st) (f32.mul (f32.convert_i32_u (i32.sub (local.get $tt) (local.get $tf))) (f32.const @DT))))
  ;; off the far side, where the rim will be by then
  (local.set $te (local.get $tt))
  (!for $it (i32.const 0) (i32.const 3)
    (local.set $rx (call $cn_rim (local.get $te)))
    (local.set $sout (f32.sub (f32.sqrt (f32.max (f32.sub (f32.mul (local.get $b) (local.get $b)) (f32.sub (local.get $ww) (f32.mul (local.get $rx) (local.get $rx))))
                                                 (f32.const 0)))
                              (local.get $b)))
    (local.set $sout (f32.max (local.get $sout) (local.get $st)))
    (local.set $te (i32.add (local.get $tt) (i32.trunc_sat_f32_u (f32.div (f32.sub (local.get $sout) (local.get $st)) (local.get $vdt))))))
  (!chk (local.get $mx) 120 (local.get $k))
  (!chk (local.get $mz) 120 (local.get $k))
  (!chk (local.get $ux) 121 (local.get $k))
  (!chk (local.get $uz) 121 (local.get $k))
  (!chk (local.get $st) 122 (local.get $k))
  (!chk (local.get $sout) 122 (local.get $k))
  (!chk (local.get $ft) 123 (local.get $k))
  (local.set $fl (i32.or (i32.ne (local.get $lob) (i32.const 0)) (select (i32.const 2) (i32.const 0) (local.get $first))))
  (i32.store offset=@(PG_BIG + CN_SHOTS) (local.get $a) (local.get $tf))
  (i32.store offset=@(PG_BIG + CN_SHOTS + 24) (local.get $a) (local.get $tt))
  (i32.store offset=@(PG_BIG + CN_SHOTS + 4) (local.get $a) (local.get $te))
  (i32.store8 offset=@(PG_BIG + CN_SHOTS + 60) (local.get $a) (local.get $c))
  (i32.store8 offset=@(PG_BIG + CN_SHOTS + 61) (local.get $a) (local.get $fl))
  (i32.store16 offset=@(PG_BIG + CN_SHOTS + 62) (local.get $a) (local.get $vi))
  (f32.store offset=@(PG_BIG + CN_SHOTS + 28) (local.get $a) (local.get $mx))
  (f32.store offset=@(PG_BIG + CN_SHOTS + 32) (local.get $a) (local.get $mz))
  (f32.store offset=@(PG_BIG + CN_SHOTS + 8) (local.get $a) (local.get $ux))
  (f32.store offset=@(PG_BIG + CN_SHOTS + 12) (local.get $a) (local.get $uz))
  (f32.store offset=@(PG_BIG + CN_SHOTS + 16) (local.get $a) (f32.sub (f32.mul (local.get $mx) (local.get $uz)) (f32.mul (local.get $mz) (local.get $ux))))
  (f32.store offset=@(PG_BIG + CN_SHOTS + 36) (local.get $a) (local.get $st))
  (f32.store offset=@(PG_BIG + CN_SHOTS + 40) (local.get $a) (local.get $sout))
  (f32.store offset=@(PG_BIG + CN_SHOTS + 44) (local.get $a) (local.get $v))
  (f32.store offset=@(PG_BIG + CN_SHOTS + 20) (local.get $a) (local.get $rc))
  (f32.store offset=@(PG_BIG + CN_SHOTS + 48) (local.get $a) (local.get $arc))
  (f32.store offset=@(PG_BIG + CN_SHOTS + 52) (local.get $a) (local.get $ft))
  (i32.store offset=@(PG_BIG + CN_SHOTS + 56) (local.get $a) (local.get $n)))

;; The round's shots, in the order they fire: a volley CN_FIRST in, then every
;; gap, closing from CN_GAP0 to CN_GAP1 over CN_RAMP; each of 1 + radius /
;; CN_PER shots and one more every CN_MORE, at most a cannon each, from
;; cannons spread evenly round from one the round's numbers pick, CN_STAG
;; ticks apart; from CN_LOBFROM one in CN_LOBONE lobbed. Then the buckets.
(func $cn_schedule (param $rad f32)
  (local $tp i32) (local $k i32) (local $vi i32) (local $n i32) (local $j i32) (local $nc i32) (local $c0 i32) (local $lob i32)
  (local $b i32) (local $lo i32) (local $hi i32)
  (local.set $nc (i32.load (i32.const @(PG_H + CN_NC))))
  (local.set $tp (i32.const @CN_FIRST))
  (block $done
    (loop $more
      (br_if $done (i32.ge_u (local.get $tp) (i32.const @CN_LEN)))
      (local.set $n (i32.add (i32.add (i32.const 1) (i32.trunc_sat_f32_u (f32.div (local.get $rad) (f32.const @CN_PER))))
                             (i32.div_u (local.get $tp) (i32.const @CN_MORE))))
      (if (i32.gt_u (local.get $n) (local.get $nc)) (then (local.set $n (local.get $nc))))
      (br_if $done (i32.gt_u (i32.add (local.get $k) (local.get $n)) (i32.const @CN_NMAX)))
      (br_if $done (i32.ge_u (i32.add (local.get $tp) (i32.mul (local.get $n) (i32.const @CN_STAG))) (i32.const @CN_LEN)))
      (local.set $c0 (i32.rem_u (call $p_seed (i32.add (i32.const 0x30000) (local.get $vi))) (local.get $nc)))
      (!for $j (i32.const 0) (local.get $n)
        (local.set $lob (i32.const 0))
        (if (i32.ge_u (local.get $tp) (i32.const @CN_LOBFROM))
          (then (local.set $lob (i32.eqz (i32.rem_u (call $p_seed (i32.add (i32.const 0x40000) (local.get $k))) (i32.const @CN_LOBONE))))))
        (call $cn_shot (local.get $k)
          (i32.rem_u (i32.add (local.get $c0) (i32.div_u (i32.mul (local.get $j) (local.get $nc)) (local.get $n))) (local.get $nc))
          (i32.add (local.get $tp) (i32.mul (local.get $j) (i32.const @CN_STAG)))
          (local.get $lob) (i32.eqz (local.get $j)) (local.get $vi) (local.get $n))
        (!inc $k))
      (!inc $vi)
      (local.set $tp (i32.add (local.get $tp)
        (i32.sub (i32.const @CN_GAP0)
                 (i32.div_u (i32.mul (i32.const @(CN_GAP0 - CN_GAP1)) (select (local.get $tp) (i32.const @CN_RAMP) (i32.lt_u (local.get $tp) (i32.const @CN_RAMP))))
                            (i32.const @CN_RAMP)))))
      (br $more)))
  (i32.store (i32.const @(PG_H + CN_NS)) (local.get $k))
  (i32.store (i32.const @(PG_H + CN_NV)) (local.get $vi))
  ;; per bucket: every shot before lo gone (past the far rim and CN_FALLT) by its start, every one from hi not fired by its end
  (!for $b (i32.const 0) (i32.const @CN_NB)
    (block $l
      (loop $lp
        (br_if $l (i32.ge_u (local.get $lo) (local.get $k)))
        (br_if $l (i32.ge_u (i32.add (i32.load offset=@(PG_BIG + CN_SHOTS + 4) (i32.mul (local.get $lo) (i32.const @CN_REC))) (i32.const @CN_FALLT))
                            (i32.mul (local.get $b) (i32.const @CN_BUCKET))))
        (!inc $lo)
        (br $lp)))
    (block $h
      (loop $hp
        (br_if $h (i32.ge_u (local.get $hi) (local.get $k)))
        (br_if $h (i32.ge_u (i32.load offset=@(PG_BIG + CN_SHOTS) (i32.mul (local.get $hi) (i32.const @CN_REC)))
                            (i32.mul (i32.add (local.get $b) (i32.const 1)) (i32.const @CN_BUCKET))))
        (!inc $hi)
        (br $hp)))
    (!st u16 @(PG_BIG + CN_LO) (local.get $b) (local.get $lo))
    (!st u16 @(PG_BIG + CN_HI) (local.get $b) (local.get $hi))))

;; The platform for n balls, its cannons, its tiles and the round's shots.
(func $cn_setup (param $n i32)
  (local $rad f32) (local $nc i32)
  (local.set $rad (f32.min (!madd (f32.sqrt (f32.convert_i32_u (local.get $n))) (f32.const @CN_RK) (f32.const @CN_R0)) (f32.const @CN_RMAX)))
  (!chk (local.get $rad) 124 (local.get $n))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_OUT))
  (i32.store (i32.const @PG_LEN) (i32.const @CN_LEN))
  (f32.store (i32.const @PG_SIZE) (local.get $rad))
  (f32.store (i32.const @PG_IDLE) (f32.const @CN_IDLE))
  (f32.store (i32.const @PG_HOP) (f32.const @CN_HOP))
  (f32.store (i32.const @(PG_H + CN_RAD)) (local.get $rad))
  (local.set $nc (i32.add (i32.const @CN_NC0)
                          (i32.trunc_sat_f32_u (f32.div (f32.max (f32.sub (local.get $rad) (f32.const @CN_NCR)) (f32.const 0)) (f32.const @CN_NCK)))))
  (if (i32.gt_u (local.get $nc) (i32.const @CN_NCMAX)) (then (local.set $nc (i32.const @CN_NCMAX))))
  (i32.store (i32.const @(PG_H + CN_NC)) (local.get $nc))
  (i32.store (i32.const @(PG_H + CN_ROT)) (i32.and (call $p_seed (i32.const 0x50000)) (i32.const 16383)))
  (f32.store (i32.const @(PG_H + CN_RC)) (f32.add (local.get $rad) (f32.const @CN_MOUNT)))
  (call $cn_tiles (local.get $rad))
  (call $cn_schedule (local.get $rad)))

;; A sunflower spiral over the middle of the disc.
(func $cn_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $x f32) (local $z f32)
  (call $p_disc (local.get $i) (local.get $n) (f32.mul (f32.load (i32.const @(PG_H + CN_RAD))) (f32.const @CN_SPAWN)))
  (local.set $z) (local.set $x)
  (local.get $x) (f32.const @PLAT_Y) (local.get $z))

(func $cn_start)
(func $cn_begin (param $p i32) (param $d i32))

;; The floor's top if the tile under (x, z) holds on bank d's tick: there is
;; one, and the rim hasn't taken it.
(func $cn_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (local $q i32) (local $r i32) (local $a i32)
  (if (f32.lt (local.get $y) (f32.const @PLAT_Y)) (then (return (f32.const -1000))))
  (call $p_hex (local.get $x) (local.get $z) (f32.const @CN_S))
  (local.set $r) (local.set $q)
  (local.set $a (call $cn_cell (local.get $q) (local.get $r)))
  (if (i32.lt_s (local.get $a) (i32.const 0)) (then (return (f32.const -1000))))
  (if (i32.ge_u (call $p_t (local.get $d)) (i32.load16_u offset=@(PG_BIG + CN_TILES) (local.get $a))) (then (return (f32.const -1000))))
  (f32.const @PLAT_Y))

;; Shot record a (byte offset) on tick tp into play, once fired and until
;; CN_FALLT past the far rim: how far along its line from the muzzle its
;; centre is, the centre's height, its speed along the line and its speed up.
;; Flying, along the line at its speed across, from the muzzle's height down
;; to its rolling height over an arc; rolling at its own speed; past the far
;; rim, on at that speed and falling.
(func $cn_at (param $a i32) (param $tp i32) (result f32 f32 f32 f32)
  (local $tf i32) (local $tt i32) (local $te i32) (local $st f32) (local $rc f32) (local $arc f32) (local $n f32) (local $s f32)
  (local $v f32) (local $e f32)
  (local.set $tf (i32.load offset=@(PG_BIG + CN_SHOTS) (local.get $a)))
  (local.set $tt (i32.load offset=@(PG_BIG + CN_SHOTS + 24) (local.get $a)))
  (local.set $te (i32.load offset=@(PG_BIG + CN_SHOTS + 4) (local.get $a)))
  (local.set $st (f32.load offset=@(PG_BIG + CN_SHOTS + 36) (local.get $a)))
  (local.set $rc (f32.load offset=@(PG_BIG + CN_SHOTS + 20) (local.get $a)))
  (if (i32.lt_s (i32.sub (local.get $tp) (local.get $tt)) (i32.const 0))
    (then
      (local.set $arc (f32.mul (f32.load offset=@(PG_BIG + CN_SHOTS + 48) (local.get $a)) (f32.const 4)))
      (local.set $n (f32.convert_i32_s (i32.sub (local.get $tt) (local.get $tf))))
      (local.set $s (f32.div (f32.convert_i32_s (i32.sub (local.get $tp) (local.get $tf))) (local.get $n)))
      (return
        (f32.mul (local.get $st) (local.get $s))
        (!madd (f32.sub (local.get $rc) (f32.const @CN_MZY)) (local.get $s)
               (!madd (local.get $arc) (f32.mul (local.get $s) (f32.sub (f32.const 1) (local.get $s))) (f32.const @(+PLAT_Y + CN_MZY))))
        (f32.load offset=@(PG_BIG + CN_SHOTS + 52) (local.get $a))
        (f32.div (!madd (local.get $arc) (f32.sub (f32.const 1) (f32.mul (local.get $s) (f32.const 2))) (f32.sub (local.get $rc) (f32.const @CN_MZY)))
                 (f32.mul (local.get $n) (f32.const @DT))))))
  (local.set $v (f32.load offset=@(PG_BIG + CN_SHOTS + 44) (local.get $a)))
  (local.set $s (!madd (f32.convert_i32_s (i32.sub (local.get $tp) (local.get $tt))) (f32.mul (local.get $v) (f32.const @DT)) (local.get $st)))
  (if (i32.lt_s (i32.sub (local.get $tp) (local.get $te)) (i32.const 0))
    (then (return (local.get $s) (f32.add (f32.const @PLAT_Y) (local.get $rc)) (local.get $v) (f32.const 0))))
  (local.set $e (f32.mul (f32.convert_i32_s (i32.sub (local.get $tp) (local.get $te))) (f32.const @DT)))
  (local.get $s)
  (f32.sub (f32.add (f32.const @PLAT_Y) (local.get $rc)) (f32.mul (f32.mul (local.get $e) (local.get $e)) (f32.const @(CN_G / 2))))
  (local.get $v)
  (f32.mul (local.get $e) (f32.const @(-CN_G))))

;; Every cannonball out on bank d's tick meets ball p as a sphere moving on
;; its line, which no ball moves: the ball is put back out of it across the
;; floor (never into it), sent off it at what it came in at times CN_E and at
;; least CN_KICK, CN_SHOVE more along the cannonball's path, and up at CN_POP.
;; A ball going out is past it. Each shot's lane is tried first, from the
;; muzzle: across it (perp) and along it (al).
(func $cn_push (param $p i32) (param $d i32)
  (local $pb i32) (local $fl i32) (local $tp i32) (local $b i32) (local $k i32) (local $k1 i32) (local $a i32)
  (local $px f32) (local $py f32) (local $pz f32) (local $vx f32) (local $vy f32) (local $vz f32) (local $r f32) (local $by f32)
  (local $ux f32) (local $uz f32) (local $wx f32) (local $wz f32) (local $al f32) (local $pe f32) (local $rc f32) (local $rr f32)
  (local $ak f32) (local $yk f32) (local $sp f32) (local $vky f32) (local $dx f32) (local $dy f32) (local $h f32) (local $hn f32)
  (local $nx f32) (local $nz f32) (local $mx f32) (local $mz f32) (local $kx f32) (local $kz f32)
  (local $ex f32) (local $ey f32) (local $ez f32) (local $rel f32) (local $dv f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
  (if (i32.ne (i32.and (local.get $fl) (i32.const @(PF_LIVE | PF_DEAD | PF_FALL))) (i32.const @PF_LIVE)) (then (return)))
  (local.set $tp (call $p_t (local.get $d)))
  (local.set $b (i32.div_u (local.get $tp) (i32.const @CN_BUCKET)))
  (if (i32.ge_u (local.get $b) (i32.const @CN_NB)) (then (return)))
  (local.set $k (!ld u16 @(PG_BIG + CN_LO) (local.get $b)))
  (local.set $k1 (!ld u16 @(PG_BIG + CN_HI) (local.get $b)))
  (if (i32.ge_u (local.get $k) (local.get $k1)) (then (return)))
  (local.set $px (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (local.set $py (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
  (local.set $pz (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (local.set $vx (!at f32 @(PLAYERS + P_VX) (local.get $pb)))
  (local.set $vy (!at f32 @(PLAYERS + P_VY) (local.get $pb)))
  (local.set $vz (!at f32 @(PLAYERS + P_VZ) (local.get $pb)))
  (local.set $r (call $b_rad (local.get $pb)))
  (local.set $by (f32.add (local.get $py) (local.get $r)))
  (block $done
    (loop $next
      (br_if $done (i32.ge_u (local.get $k) (local.get $k1)))
      (local.set $a (i32.mul (local.get $k) (i32.const @CN_REC)))
      (if (i32.and (i32.ge_s (i32.sub (local.get $tp) (i32.load offset=@(PG_BIG + CN_SHOTS) (local.get $a))) (i32.const 0))
                   (i32.lt_s (i32.sub (local.get $tp) (i32.load offset=@(PG_BIG + CN_SHOTS + 4) (local.get $a))) (i32.const @CN_FALLT)))
        (then
          (local.set $ux (f32.load offset=@(PG_BIG + CN_SHOTS + 8) (local.get $a)))
          (local.set $uz (f32.load offset=@(PG_BIG + CN_SHOTS + 12) (local.get $a)))
          (local.set $rc (f32.load offset=@(PG_BIG + CN_SHOTS + 20) (local.get $a)))
          (local.set $pe (f32.sub (f32.sub (f32.mul (local.get $px) (local.get $uz)) (f32.mul (local.get $pz) (local.get $ux)))
                                  (f32.load offset=@(PG_BIG + CN_SHOTS + 16) (local.get $a))))
          (local.set $rr (f32.add (local.get $r) (local.get $rc)))
          (if (f32.lt (f32.abs (local.get $pe)) (local.get $rr))
            (then
              (local.set $mx (f32.load offset=@(PG_BIG + CN_SHOTS + 28) (local.get $a)))
              (local.set $mz (f32.load offset=@(PG_BIG + CN_SHOTS + 32) (local.get $a)))
              (local.set $wx (f32.sub (local.get $px) (local.get $mx)))
              (local.set $wz (f32.sub (local.get $pz) (local.get $mz)))
              (local.set $al (!madd (local.get $wx) (local.get $ux) (f32.mul (local.get $wz) (local.get $uz))))
              (call $cn_at (local.get $a) (local.get $tp))
              (local.set $vky) (local.set $sp) (local.set $yk) (local.set $ak)
              (local.set $dx (f32.sub (local.get $al) (local.get $ak)))
              (local.set $dy (f32.sub (local.get $by) (local.get $yk)))
              (if (f32.lt (!madd (local.get $dx) (local.get $dx) (!madd (local.get $pe) (local.get $pe) (f32.mul (local.get $dy) (local.get $dy))))
                          (f32.mul (local.get $rr) (local.get $rr)))
                (then
                  ;; out of it across the floor: as far from its centre as touching takes at this height
                  (local.set $hn (f32.sqrt (f32.max (f32.sub (f32.mul (local.get $rr) (local.get $rr)) (f32.mul (local.get $dy) (local.get $dy))) (f32.const 0))))
                  (local.set $h (f32.sqrt (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $pe) (local.get $pe)))))
                  (if (f32.gt (local.get $h) (f32.const 0.001))
                    (then
                      (local.set $nx (f32.div (!madd (local.get $dx) (local.get $ux) (f32.mul (local.get $pe) (local.get $uz))) (local.get $h)))
                      (local.set $nz (f32.div (f32.sub (f32.mul (local.get $dx) (local.get $uz)) (f32.mul (local.get $pe) (local.get $ux))) (local.get $h))))
                    (else
                      ;; dead on its line: aside, to its right
                      (local.set $nx (local.get $uz))
                      (local.set $nz (f32.neg (local.get $ux)))))
                  (local.set $kx (!madd (local.get $ux) (local.get $ak) (local.get $mx)))
                  (local.set $kz (!madd (local.get $uz) (local.get $ak) (local.get $mz)))
                  (local.set $px (!madd (local.get $nx) (local.get $hn) (local.get $kx)))
                  (local.set $pz (!madd (local.get $nz) (local.get $hn) (local.get $kz)))
                  ;; the normal on the touching sphere; for a ball on the floor, never down into it
                  (local.set $ex (f32.div (f32.mul (local.get $nx) (local.get $hn)) (local.get $rr)))
                  (local.set $ey (f32.div (local.get $dy) (local.get $rr)))
                  (local.set $ez (f32.div (f32.mul (local.get $nz) (local.get $hn)) (local.get $rr)))
                  (if (i32.and (i32.ne (i32.and (local.get $fl) (i32.const @PF_GROUND)) (i32.const 0)) (f32.lt (local.get $ey) (f32.const 0)))
                    (then (local.set $ex (local.get $nx)) (local.set $ey (f32.const 0)) (local.set $ez (local.get $nz))))
                  (local.set $rel (!madd (f32.sub (local.get $vx) (f32.mul (local.get $ux) (local.get $sp))) (local.get $ex)
                                         (!madd (f32.sub (local.get $vy) (local.get $vky)) (local.get $ey)
                                                (f32.mul (f32.sub (local.get $vz) (f32.mul (local.get $uz) (local.get $sp))) (local.get $ez)))))
                  (if (f32.lt (local.get $rel) (f32.const @CN_KICK))
                    (then
                      (local.set $dv (f32.sub (f32.max (f32.mul (f32.neg (local.get $rel)) (f32.const @CN_E)) (f32.const @CN_KICK)) (local.get $rel)))
                      (local.set $vx (!madd (local.get $dv) (local.get $ex) (!madd (local.get $ux) (f32.const @CN_SHOVE) (local.get $vx))))
                      (local.set $vy (f32.max (!madd (local.get $dv) (local.get $ey) (local.get $vy)) (f32.const @CN_POP)))
                      (local.set $vz (!madd (local.get $dv) (local.get $ez) (!madd (local.get $uz) (f32.const @CN_SHOVE) (local.get $vz))))
                      (local.set $fl (i32.and (local.get $fl) (i32.const @(255 ^ PF_GROUND))))
                      (if (f32.ge (local.get $dv) (f32.const 2))
                        (then (call $fx (local.get $d) (i32.const @CN_FX_HIT) (local.get $p) (local.get $k)
                                        (!madd (local.get $nx) (local.get $rc) (local.get $kx)) (local.get $yk)
                                        (!madd (local.get $nz) (local.get $rc) (local.get $kz)) (local.get $dv))))))))))))
      (!inc $k)
      (br $next)))
  (!chk (local.get $px) 125 (local.get $p))
  (!chk (local.get $pz) 125 (local.get $p))
  (!chk (local.get $vx) 126 (local.get $p))
  (!chk (local.get $vy) 126 (local.get $p))
  (!chk (local.get $vz) 126 (local.get $p))
  (!put f32 @(PLAYERS + P_PX) (local.get $pb) (local.get $px))
  (!put f32 @(PLAYERS + P_PZ) (local.get $pb) (local.get $pz))
  (!put f32 @(PLAYERS + P_VX) (local.get $pb) (local.get $vx))
  (!put f32 @(PLAYERS + P_VY) (local.get $pb) (local.get $vy))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (local.get $vz))
  (!put u8 @(PLAYERS + P_FL) (local.get $pb) (local.get $fl)))

;; The confirmed world's calls, as FX: every cannon firing this tick (at its
;; muzzle), every lob touching down, a volley's stripes showing (its first
;; shot CN_TELE out), and CN_WARN before the lobs and the crumbling, a call.
(func $cn_tick
  (local $tp i32) (local $b i32) (local $k i32) (local $k1 i32) (local $a i32) (local $tf i32) (local $st f32)
  (local.set $tp (call $p_t (i32.const 0)))
  (local.set $b (i32.div_u (local.get $tp) (i32.const @CN_BUCKET)))
  (if (i32.lt_u (local.get $b) (i32.const @CN_NB))
    (then
      (local.set $k1 (!ld u16 @(PG_BIG + CN_HI) (local.get $b)))
      (!for $k (!ld u16 @(PG_BIG + CN_LO) (local.get $b)) (local.get $k1)
        (local.set $a (i32.mul (local.get $k) (i32.const @CN_REC)))
        (if (i32.eq (i32.load offset=@(PG_BIG + CN_SHOTS) (local.get $a)) (local.get $tp))
          (then (call $fx (i32.const 0) (i32.const @CN_FX_FIRE) (i32.const 255) (local.get $k)
                          (f32.load offset=@(PG_BIG + CN_SHOTS + 28) (local.get $a)) (f32.const @(+PLAT_Y + CN_MZY))
                          (f32.load offset=@(PG_BIG + CN_SHOTS + 32) (local.get $a)) (f32.load offset=@(PG_BIG + CN_SHOTS + 20) (local.get $a)))))
        (if (i32.and (i32.and (i32.load8_u offset=@(PG_BIG + CN_SHOTS + 61) (local.get $a)) (i32.const 1))
                     (i32.eq (i32.load offset=@(PG_BIG + CN_SHOTS + 24) (local.get $a)) (local.get $tp)))
          (then
            (local.set $st (f32.load offset=@(PG_BIG + CN_SHOTS + 36) (local.get $a)))
            (call $fx (i32.const 0) (i32.const @CN_FX_LAND) (i32.const 255) (local.get $k)
                      (!madd (f32.load offset=@(PG_BIG + CN_SHOTS + 8) (local.get $a)) (local.get $st) (f32.load offset=@(PG_BIG + CN_SHOTS + 28) (local.get $a)))
                      (f32.const @PLAT_Y)
                      (!madd (f32.load offset=@(PG_BIG + CN_SHOTS + 12) (local.get $a)) (local.get $st) (f32.load offset=@(PG_BIG + CN_SHOTS + 32) (local.get $a)))
                      (f32.load offset=@(PG_BIG + CN_SHOTS + 20) (local.get $a))))))))
  (local.set $tf (i32.add (local.get $tp) (i32.const @CN_TELE)))
  (local.set $b (i32.div_u (local.get $tf) (i32.const @CN_BUCKET)))
  (if (i32.lt_u (local.get $b) (i32.const @CN_NB))
    (then
      (local.set $k1 (!ld u16 @(PG_BIG + CN_HI) (local.get $b)))
      (!for $k (!ld u16 @(PG_BIG + CN_LO) (local.get $b)) (local.get $k1)
        (local.set $a (i32.mul (local.get $k) (i32.const @CN_REC)))
        (if (i32.and (i32.eq (i32.load offset=@(PG_BIG + CN_SHOTS) (local.get $a)) (local.get $tf))
                     (i32.ne (i32.and (i32.load8_u offset=@(PG_BIG + CN_SHOTS + 61) (local.get $a)) (i32.const 2)) (i32.const 0)))
          (then (call $fx (i32.const 0) (i32.const @CN_FX_CALL) (i32.const 255) (i32.load16_u offset=@(PG_BIG + CN_SHOTS + 62) (local.get $a))
                          (f32.load (i32.const @PG_CX)) (f32.const @PLAT_Y) (f32.load (i32.const @PG_CX))
                          (f32.convert_i32_u (i32.load offset=@(PG_BIG + CN_SHOTS + 56) (local.get $a)))))))))
  (if (i32.eq (local.get $tp) (i32.const @(CN_LOBFROM - CN_WARN)))
    (then (call $fx (i32.const 0) (i32.const @CN_FX_CALL) (i32.const 255) (i32.const 0x8001)
                    (f32.load (i32.const @PG_CX)) (f32.const @PLAT_Y) (f32.load (i32.const @PG_CX)) (f32.const 0))))
  (if (i32.eq (local.get $tp) (i32.const @(CN_CRUMBLE - CN_WARN)))
    (then (call $fx (i32.const 0) (i32.const @CN_FX_CALL) (i32.const 255) (i32.const 0x8002)
                    (f32.load (i32.const @PG_CX)) (f32.const @PLAT_Y) (f32.load (i32.const @PG_CX)) (f32.const 0)))))

;; Two or more still on, every one of them falling, and all since the same
;; tick (one cannonball took them all at once): over now, and they share the
;; win rather than all sharing last. One that went off before the rest goes
;; out first, in its place. Each ball's first tick falling is noted here (CN_FELL).
(func $cn_over (result i32)
  (local $p i32) (local $fl i32) (local $t i32) (local $at i32)
  (local.set $t (i32.add (call $p_t (i32.const 0)) (i32.const 1)))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $fl (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $p) (i32.const 6))) (i32.const @(PF_LIVE | PF_DEAD | PF_FALL))))
    (if (i32.and (i32.eq (local.get $fl) (i32.const @(PF_LIVE | PF_FALL))) (i32.eqz (!ld u16 @(PG_S + CN_FELL) (local.get $p))))
      (then (!st u16 @(PG_S + CN_FELL) (local.get $p) (local.get $t)))))
  (if (i32.lt_u (i32.load (i32.const @BH_LEFT)) (i32.const 2)) (then (return (i32.const 0))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $fl (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $p) (i32.const 6))) (i32.const @(PF_LIVE | PF_DEAD | PF_FALL))))
    (if (i32.eq (local.get $fl) (i32.const @PF_LIVE)) (then (return (i32.const 0))))
    (if (i32.eq (local.get $fl) (i32.const @(PF_LIVE | PF_FALL)))
      (then
        (if (i32.eqz (local.get $at)) (then (local.set $at (!ld u16 @(PG_S + CN_FELL) (local.get $p)))))
        (if (i32.ne (!ld u16 @(PG_S + CN_FELL) (local.get $p)) (local.get $at)) (then (return (i32.const 0)))))))
  (i32.const 1))

(func $cn_out (param $p i32))
