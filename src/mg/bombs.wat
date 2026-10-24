;; BOMB RAIN: a disc of hex tiles over the sea, sized for the crowd, whose rim
;; crumbles in to BO_RMIN over BO_SHRINK ticks. Bombs fall in waves, closer
;; together as the rim comes in: each shows as a ring where it will land,
;; BO_FALL0 ticks ahead (BO_FALL1 late on), and blasts every ball near when
;; it does; a big one blasts wider and takes the tiles round it for BO_HOLE
;; ticks. Some bombs are aimed where a ball is rolling. Last ball on wins.
;;
;; Everything a ball meets is known ahead. A tile holds per its cell: the
;; tick into play the rim takes it (fixed at setup) and the tick a crater
;; opens there (written when the big bomb's ring shows). A bomb's blast is
;; this file's push, on the ball's own record on either bank, on the tick
;; the bomb lands, from its record written when its ring showed. So the
;; prediction is exact while it runs less than BO_FALL1 ahead of the
;; confirmed world: everything it reads was fixed before it got there.

;; Cell (q, r)'s byte offset in the tiles, -1 off the grid.
(func $bo_cell (param $q i32) (param $r i32) (result i32)
  (if (i32.or (i32.gt_u (i32.add (local.get $q) (i32.const @BO_N)) (i32.const @(2 * BO_N)))
              (i32.gt_u (i32.add (local.get $r) (i32.const @BO_N)) (i32.const @(2 * BO_N))))
    (then (return (i32.const -1))))
  (i32.shl (i32.add (i32.mul (i32.add (local.get $r) (i32.const @BO_N)) (i32.const @BO_W)) (i32.add (local.get $q) (i32.const @BO_N)))
           (i32.const 3)))

;; The rim on tick tp into play: the disc's own until BO_CALM, then in to
;; BO_RMIN over BO_SHRINK. (What a tile does is its cell's; this is where to
;; aim and drop bombs.)
(func $bo_rim (param $tp i32) (result f32)
  (local $r0 f32) (local $k i32)
  (local.set $r0 (f32.load (i32.const @(PG_H + BO_RAD))))
  (local.set $k (i32.sub (local.get $tp) (i32.const @BO_CALM)))
  (if (i32.le_s (local.get $k) (i32.const 0)) (then (return (local.get $r0))))
  (if (i32.ge_s (local.get $k) (i32.const @BO_SHRINK)) (then (return (f32.const @BO_RMIN))))
  (f32.sub (local.get $r0) (f32.mul (f32.sub (local.get $r0) (f32.const @BO_RMIN))
                                    (f32.div (f32.convert_i32_s (local.get $k)) (f32.const @BO_SHRINK)))))

;; From a to b as tick tp into play goes from BO_CALM to BO_CALM + BO_SHRINK (integers).
(func $bo_ramp (param $tp i32) (param $a i32) (param $b i32) (result i32)
  (local $k i32)
  (local.set $k (i32.sub (local.get $tp) (i32.const @BO_CALM)))
  (if (i32.lt_s (local.get $k) (i32.const 0)) (then (local.set $k (i32.const 0))))
  (if (i32.gt_s (local.get $k) (i32.const @BO_SHRINK)) (then (local.set $k (i32.const @BO_SHRINK))))
  (i32.sub (local.get $a) (i32.div_s (i32.mul (i32.sub (local.get $a) (local.get $b)) (local.get $k)) (i32.const @BO_SHRINK))))

;; Every tile whose centre is on the disc, each with the tick into play the
;; rim takes it: the first past BO_CALM plus its share of BO_SHRINK, its
;; distance in from the rim over the rim's way to BO_RMIN; never inside BO_RMIN.
(func $bo_setup (param $n i32)
  (local $q i32) (local $r i32) (local $count i32) (local $rim i32)
  (local $rad f32) (local $x f32) (local $z f32) (local $dx f32) (local $dz f32) (local $rho f32)
  (local.set $rad (f32.min (!madd (f32.sqrt (f32.convert_i32_u (local.get $n))) (f32.const @BO_RK) (f32.const @BO_R0)) (f32.const @BO_RMAX)))
  (!chk (local.get $rad) 48 (local.get $n))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_OUT))
  (i32.store (i32.const @PG_LEN) (i32.const @BO_LEN))
  (f32.store (i32.const @PG_SIZE) (local.get $rad))
  (f32.store (i32.const @PG_IDLE) (f32.const @BO_IDLE))
  (f32.store (i32.const @(PG_H + BO_RAD)) (local.get $rad))
  (i32.store (i32.const @(PG_H + BO_NEXT)) (i32.const @BO_FIRST))
  (!for $r (i32.const 0) (i32.const @BO_W)
    (!for $q (i32.const 0) (i32.const @BO_W)
      (call $p_hexc (i32.sub (local.get $q) (i32.const @BO_N)) (i32.sub (local.get $r) (i32.const @BO_N)) (f32.const @BO_S))
      (local.set $z) (local.set $x)
      (local.set $dx (f32.sub (local.get $x) (f32.load (i32.const @PG_CX))))
      (local.set $dz (f32.sub (local.get $z) (f32.load (i32.const @PG_CX))))
      (local.set $rho (f32.sqrt (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz)))))
      (if (f32.le (local.get $rho) (local.get $rad))
        (then
          (!inc $count)
          (local.set $rim (i32.const @BO_NEVER))
          (if (f32.gt (local.get $rho) (f32.const @BO_RMIN))
            (then
              (local.set $rim (i32.add (i32.const @(BO_CALM + 1))
                (i32.trunc_sat_f32_s (f32.mul (f32.div (f32.sub (local.get $rad) (local.get $rho)) (f32.sub (local.get $rad) (f32.const @BO_RMIN)))
                                              (f32.const @BO_SHRINK)))))))
          (i32.store16 offset=@(PG_BIG + BO_TILES + 4)
            (i32.shl (i32.add (i32.mul (local.get $r) (i32.const @BO_W)) (local.get $q)) (i32.const 3)) (local.get $rim))))))
  (i32.store (i32.const @(PG_H + BO_COUNT)) (local.get $count)))

;; A sunflower spiral over the middle of the disc.
(func $bo_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $x f32) (local $z f32)
  (call $p_disc (local.get $i) (local.get $n) (f32.mul (f32.load (i32.const @(PG_H + BO_RAD))) (f32.const @BO_SPAWN)))
  (local.set $z) (local.set $x)
  (local.get $x) (f32.const @PLAT_Y) (local.get $z))

(func $bo_start)

;; The floor's top if the tile under (x, z) holds on bank d's tick: the rim
;; hasn't taken it, and no crater is open there.
(func $bo_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (local $q i32) (local $r i32) (local $a i32) (local $c i32)
  (if (f32.lt (local.get $y) (f32.const @PLAT_Y)) (then (return (f32.const -1000))))
  (call $p_hex (local.get $x) (local.get $z) (f32.const @BO_S))
  (local.set $r) (local.set $q)
  (local.set $a (call $bo_cell (local.get $q) (local.get $r)))
  (if (i32.lt_s (local.get $a) (i32.const 0)) (then (return (f32.const -1000))))
  ;; no tile (0), or the rim has taken it
  (if (i32.ge_u (call $p_t (local.get $d)) (i32.load16_u offset=@(PG_BIG + BO_TILES + 4) (local.get $a))) (then (return (f32.const -1000))))
  (local.set $c (i32.load offset=@(PG_BIG + BO_TILES) (local.get $a)))
  (if (i32.and (i32.ne (local.get $c) (i32.const 0))
               (i32.lt_u (i32.sub (i32.load offset=@HDR_TICK (local.get $d)) (local.get $c)) (i32.const @BO_HOLE)))
    (then (return (f32.const -1000))))
  (f32.const @PLAT_Y))

;; Every bomb that lands on bank d's tick blasts ball p: bumper's blast on
;; balls ($b_blast), on this one record, from the floor where it lands, with
;; nobody's credit. A ball going out is past it.
(func $bo_push (param $p i32) (param $d i32)
  (local $pb i32) (local $k i32) (local $kb i32) (local $kind i32) (local $t i32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (if (i32.ne (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @(PF_LIVE | PF_DEAD | PF_FALL))) (i32.const @PF_LIVE)) (then (return)))
  (local.set $t (i32.load offset=@HDR_TICK (local.get $d)))
  (!for $k (i32.const 0) (i32.const @BO_NB)
    (local.set $kb (i32.shl (local.get $k) (i32.const 4)))
    (local.set $kind (!at u8 @(PG_S + BO_BOMBS + 14) (local.get $kb)))
    (if (i32.and (i32.ne (local.get $kind) (i32.const 0)) (i32.eq (!at i32 @(PG_S + BO_BOMBS + 8) (local.get $kb)) (local.get $t)))
      (then
        (call $bo_blast (local.get $p) (local.get $pb)
          (!at f32 @(PG_S + BO_BOMBS) (local.get $kb)) (!at f32 @(PG_S + BO_BOMBS + 4) (local.get $kb))
          (select (f32.const @BO_BIGR) (f32.const @BO_R) (i32.eq (local.get $kind) (i32.const 2)))
          (select (f32.const @BO_BIGSTR) (f32.const @BO_STR) (i32.eq (local.get $kind) (i32.const 2))))))))

;; A blast from the floor at (x, z), radius r and s m/s at its centre, on
;; slot p's record at pb (bank-offset): away and up, less for heavy balls,
;; nothing past r, and off the ground.
(func $bo_blast (param $p i32) (param $pb i32) (param $x f32) (param $z f32) (param $r f32) (param $s f32)
  (local $rq f32) (local $dx f32) (local $dy f32) (local $dz f32) (local $hd f32) (local $d2 f32) (local $f f32)
  (local $vx f32) (local $vy f32) (local $vz f32)
  (local.set $rq (call $b_rad (local.get $pb)))
  (local.set $dx (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (local.get $x)))
  (local.set $dy (f32.sub (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (local.get $rq)) (f32.const @PLAT_Y)))
  (local.set $dz (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $pb)) (local.get $z)))
  (local.set $hd (f32.add (f32.mul (local.get $dx) (local.get $dx)) (f32.mul (local.get $dz) (local.get $dz))))
  (local.set $d2 (!madd (local.get $dy) (local.get $dy) (local.get $hd)))
  (if (f32.ge (local.get $d2) (f32.mul (local.get $r) (local.get $r))) (then (return)))
  (local.set $hd (f32.sqrt (f32.max (local.get $hd) (f32.const 1e-6))))
  (local.set $f (f32.div (f32.mul (local.get $s) (f32.sub (f32.const 1) (f32.div (f32.sqrt (local.get $d2)) (local.get $r))))
                         (call $b_mass (local.get $pb))))
  (local.set $vx (!madd (f32.div (local.get $dx) (local.get $hd)) (local.get $f) (!at f32 @(PLAYERS + P_VX) (local.get $pb))))
  (local.set $vy (!madd (local.get $f) (f32.const @BLAST_UP) (!at f32 @(PLAYERS + P_VY) (local.get $pb))))
  (local.set $vz (!madd (f32.div (local.get $dz) (local.get $hd)) (local.get $f) (!at f32 @(PLAYERS + P_VZ) (local.get $pb))))
  (!chk (local.get $vx) 49 (local.get $p))
  (!chk (local.get $vy) 49 (local.get $p))
  (!chk (local.get $vz) 49 (local.get $p))
  (!put f32 @(PLAYERS + P_VX) (local.get $pb) (local.get $vx))
  (!put f32 @(PLAYERS + P_VY) (local.get $pb) (local.get $vy))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (local.get $vz))
  (!put u8 @(PLAYERS + P_FL) (local.get $pb) (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @(255 ^ PF_GROUND)))))

;; Every tile whose centre is within BO_CRATER of (x, z) goes on tick land
;; for BO_HOLE ticks, unless a crater is already open or coming there (it
;; keeps that one): what a cell says only changes for ticks from land on.
(func $bo_crater (param $x f32) (param $z f32) (param $land i32) (param $t i32)
  (local $q0 i32) (local $r0 i32) (local $i i32) (local $j i32) (local $a i32) (local $c i32) (local $cx f32) (local $cz f32)
  (call $p_hex (local.get $x) (local.get $z) (f32.const @BO_S))
  (local.set $r0) (local.set $q0)
  (!for $j (i32.const 0) (i32.const 7)
    (!for $i (i32.const 0) (i32.const 7)
      (local.set $a (call $bo_cell (i32.add (local.get $q0) (i32.sub (local.get $i) (i32.const 3))) (i32.add (local.get $r0) (i32.sub (local.get $j) (i32.const 3)))))
      (if (i32.ge_s (local.get $a) (i32.const 0))
        (then
          (if (i32.load16_u offset=@(PG_BIG + BO_TILES + 4) (local.get $a))
            (then
              (call $p_hexc (i32.add (local.get $q0) (i32.sub (local.get $i) (i32.const 3))) (i32.add (local.get $r0) (i32.sub (local.get $j) (i32.const 3))) (f32.const @BO_S))
              (local.set $cz) (local.set $cx)
              (local.set $cx (f32.sub (local.get $cx) (local.get $x)))
              (local.set $cz (f32.sub (local.get $cz) (local.get $z)))
              (if (f32.le (!madd (local.get $cx) (local.get $cx) (f32.mul (local.get $cz) (local.get $cz))) (f32.const @(BO_CRATER * BO_CRATER)))
                (then
                  (local.set $c (i32.load offset=@(PG_BIG + BO_TILES) (local.get $a)))
                  (if (i32.or (i32.eqz (local.get $c)) (i32.ge_s (i32.sub (local.get $t) (local.get $c)) (i32.const @BO_HOLE)))
                    (then (i32.store offset=@(PG_BIG + BO_TILES) (local.get $a) (local.get $land)))))))))))))

;; A bomb's ring: in a free record, landing fall ticks from now, aimed where a
;; ball in is rolling (if aim and there is one) or anywhere on the disc as it
;; will be; inside the rim it lands on either way. Big from BO_BIGFROM, one
;; in BO_BIGONE, with its crater written now.
(func $bo_drop (param $t i32) (param $tp i32) (param $fall i32) (param $aim i32)
  (local $k i32) (local $kb i32) (local $p i32) (local $pb i32) (local $n i32) (local $who i32) (local $big i32) (local $a i32)
  (local $rim f32) (local $x f32) (local $z f32) (local $dx f32) (local $dz f32) (local $rr f32) (local $s f32) (local $c f32) (local $cx f32)
  (block $found
    (!for $k (i32.const 0) (i32.const @BO_NB)
      (local.set $kb (i32.shl (local.get $k) (i32.const 4)))
      (br_if $found (i32.eqz (!at u8 @(PG_S + BO_BOMBS + 14) (local.get $kb)))))
    (return))
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (local.set $rim (f32.sub (call $bo_rim (i32.add (local.get $tp) (local.get $fall))) (f32.const 1)))
  (if (local.get $aim)
    (then
      (!for $p (i32.const 0) (i32.const @NPLAYER)
        (if (call $p_in (i32.shl (local.get $p) (i32.const 6))) (then (!inc $n))))))
  (if (local.get $n)
    (then
      ;; the j-th ball in, where it would be BO_LEAD s on, give or take BO_SCATTER
      (local.set $a (i32.rem_u (call $rand) (local.get $n)))
      (block $picked
        (!for $p (i32.const 0) (i32.const @NPLAYER)
          (if (call $p_in (i32.shl (local.get $p) (i32.const 6)))
            (then
              (br_if $picked (i32.eqz (local.get $a)))
              (local.set $a (i32.sub (local.get $a) (i32.const 1)))))))
      (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
      (local.set $who (i32.add (local.get $p) (i32.const 1)))
      (local.set $x (!madd (!at f32 @(PLAYERS + P_VX) (local.get $pb)) (f32.const @BO_LEAD) (!at f32 @(PLAYERS + P_PX) (local.get $pb))))
      (local.set $z (!madd (!at f32 @(PLAYERS + P_VZ) (local.get $pb)) (f32.const @BO_LEAD) (!at f32 @(PLAYERS + P_PZ) (local.get $pb))))
      (local.set $x (!madd (f32.sub (call $p_unit) (f32.const 0.5)) (f32.const @(2 * BO_SCATTER)) (local.get $x)))
      (local.set $z (!madd (f32.sub (call $p_unit) (f32.const 0.5)) (f32.const @(2 * BO_SCATTER)) (local.get $z))))
    (else
      ;; anywhere on the disc, evenly
      (local.set $rr (f32.mul (local.get $rim) (f32.sqrt (call $p_unit))))
      (call $sincos (i32.and (call $rand) (i32.const 16383)))
      (local.set $c) (local.set $s)
      (local.set $x (!madd (local.get $c) (local.get $rr) (local.get $cx)))
      (local.set $z (!madd (local.get $s) (local.get $rr) (local.get $cx)))))
  ;; in off the rim it lands on
  (local.set $dx (f32.sub (local.get $x) (local.get $cx)))
  (local.set $dz (f32.sub (local.get $z) (local.get $cx)))
  (local.set $rr (f32.sqrt (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz)))))
  (if (f32.gt (local.get $rr) (local.get $rim))
    (then
      (local.set $x (!madd (local.get $dx) (f32.div (local.get $rim) (local.get $rr)) (local.get $cx)))
      (local.set $z (!madd (local.get $dz) (f32.div (local.get $rim) (local.get $rr)) (local.get $cx)))))
  (!chk (local.get $x) 50 (local.get $k))
  (!chk (local.get $z) 50 (local.get $k))
  (if (i32.ge_u (local.get $tp) (i32.const @BO_BIGFROM))
    (then (local.set $big (i32.eqz (i32.rem_u (call $rand) (i32.const @BO_BIGONE))))))
  (!put f32 @(PG_S + BO_BOMBS) (local.get $kb) (local.get $x))
  (!put f32 @(PG_S + BO_BOMBS + 4) (local.get $kb) (local.get $z))
  (!put i32 @(PG_S + BO_BOMBS + 8) (local.get $kb) (i32.add (local.get $t) (local.get $fall)))
  (!put u16 @(PG_S + BO_BOMBS + 12) (local.get $kb) (local.get $fall))
  (!put u8 @(PG_S + BO_BOMBS + 14) (local.get $kb) (i32.add (local.get $big) (i32.const 1)))
  (!put u8 @(PG_S + BO_BOMBS + 15) (local.get $kb) (local.get $who))
  (if (local.get $big)
    (then
      (call $bo_crater (local.get $x) (local.get $z) (i32.add (local.get $t) (local.get $fall)) (local.get $t))
      (call $fx (i32.const 0) (i32.const @BO_FX_BIG) (select (i32.sub (local.get $who) (i32.const 1)) (i32.const 255) (local.get $who)) (local.get $k)
                (local.get $x) (f32.const @PLAT_Y) (local.get $z) (f32.convert_i32_u (local.get $fall))))))

;; A wave: 1 + left / BO_PER bombs (and one more every BO_MORE into play),
;; the first and one in BO_AIM after it aimed; the next wave and how long
;; these fall both closing in with the rim.
(func $bo_wave (param $t i32) (param $tp i32)
  (local $n i32) (local $j i32) (local $fall i32) (local $gap i32) (local $w i32)
  (local.set $n (i32.add (i32.add (i32.const 1) (i32.div_u (i32.load (i32.const @BH_LEFT)) (i32.const @BO_PER)))
                         (i32.div_u (local.get $tp) (i32.const @BO_MORE))))
  (local.set $fall (call $bo_ramp (local.get $tp) (i32.const @BO_FALL0) (i32.const @BO_FALL1)))
  (local.set $gap (call $bo_ramp (local.get $tp) (i32.const @BO_GAP0) (i32.const @BO_GAP1)))
  (local.set $w (i32.add (i32.load (i32.const @(PG_H + BO_WAVE))) (i32.const 1)))
  (i32.store (i32.const @(PG_H + BO_WAVE)) (local.get $w))
  (i32.store (i32.const @(PG_H + BO_LAST)) (local.get $n))
  (i32.store (i32.const @(PG_H + BO_GAP)) (local.get $gap))
  (i32.store (i32.const @(PG_H + BO_NEXT)) (i32.add (local.get $tp) (local.get $gap)))
  (!for $j (i32.const 0) (local.get $n)
    (call $bo_drop (local.get $t) (local.get $tp) (local.get $fall) (i32.eqz (i32.rem_u (local.get $j) (i32.const @BO_AIM)))))
  (call $fx (i32.const 0) (i32.const @BO_FX_WAVE) (i32.const 255) (i32.and (local.get $w) (i32.const 0xffff))
            (f32.load (i32.const @PG_CX)) (f32.const @PLAT_Y) (f32.load (i32.const @PG_CX)) (f32.convert_i32_u (local.get $n))))

;; The bombs that land this tick (their blasts were each ball's push) as FX,
;; the records of those gone off BO_KEEP ago freed; then a wave, when due.
(func $bo_tick
  (local $t i32) (local $tp i32) (local $k i32) (local $kb i32) (local $kind i32) (local $land i32) (local $who i32)
  (local.set $t (i32.load (i32.const @HDR_TICK)))
  (local.set $tp (call $p_t (i32.const 0)))
  (!for $k (i32.const 0) (i32.const @BO_NB)
    (local.set $kb (i32.shl (local.get $k) (i32.const 4)))
    (local.set $kind (!at u8 @(PG_S + BO_BOMBS + 14) (local.get $kb)))
    (if (local.get $kind)
      (then
        (local.set $land (!at i32 @(PG_S + BO_BOMBS + 8) (local.get $kb)))
        (if (i32.eq (local.get $land) (local.get $t))
          (then
            (local.set $who (!at u8 @(PG_S + BO_BOMBS + 15) (local.get $kb)))
            (call $fx (i32.const 0) (i32.const @BO_FX_BOOM) (select (i32.sub (local.get $who) (i32.const 1)) (i32.const 255) (local.get $who)) (local.get $kind)
                      (!at f32 @(PG_S + BO_BOMBS) (local.get $kb)) (f32.const @PLAT_Y) (!at f32 @(PG_S + BO_BOMBS + 4) (local.get $kb))
                      (select (f32.const @BO_BIGR) (f32.const @BO_R) (i32.eq (local.get $kind) (i32.const 2))))))
        (if (i32.ge_s (i32.sub (local.get $t) (local.get $land)) (i32.const @BO_KEEP))
          (then (memory.fill (i32.add (i32.const @(PG_S + BO_BOMBS)) (local.get $kb)) (i32.const 0) (i32.const @BO_BSIZE)))))))
  (if (i32.ge_u (local.get $tp) (i32.load (i32.const @(PG_H + BO_NEXT))))
    (then (call $bo_wave (local.get $t) (local.get $tp)))))

;; Two or more still on and every one of them falling (a blast took them all
;; at once): over now, and they share the win rather than all sharing last.
(func $bo_over (result i32)
  (local $p i32)
  (if (i32.lt_u (i32.load (i32.const @BH_LEFT)) (i32.const 2)) (then (return (i32.const 0))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (if (call $p_in (i32.shl (local.get $p) (i32.const 6))) (then (return (i32.const 0)))))
  (i32.const 1))

(func $bo_out (param $p i32))
