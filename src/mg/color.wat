;; COLOR CALL: one floor of hex tiles in CC_K colours over the sea. Every
;; cycle the board takes new colours (CC_REST), a colour is called (the
;; warning, 3 s shrinking to 1.2 s), and then every tile of any other colour
;; drops away for CC_DROP ticks and comes back. From cycle CC_SHRINK each drop
;; also takes the outer ring for good, greyed through the cycle before it
;; goes, down to the middle tile and its ring; from cycle CC_SD only the one
;; tile called holds. Last ball up wins.
;;
;; Everything is a function of the tick into play and the round's seed: the
;; cycle and its phase ($cc_when), the board's colours ($cc_colour), the rim
;; ($cc_rim) and the call ($cc_call). ground works them out on its own bank's
;; tick, so the prediction is exact however far ahead it runs. The only state
;; is the disc's radius and the number of colours, in PG_H.

;; Cycle c's first tick, in ticks into play.
(func $cc_cycle_at (param $c i32) (result i32)
  (if (i32.le_u (local.get $c) (i32.const @CC_FULL))
    (then
      (return (i32.sub (i32.mul (local.get $c) (i32.const @(CC_REST + CC_DROP + CC_WARN0)))
                       (i32.div_u (i32.mul (i32.mul (local.get $c) (i32.sub (local.get $c) (i32.const 1))) (i32.const @CC_WARNK)) (i32.const 2))))))
  (if (i32.le_u (local.get $c) (i32.const @CC_SD))
    (then
      (return (i32.add (i32.const @CC_T_FULL)
                       (i32.mul (i32.sub (local.get $c) (i32.const @CC_FULL)) (i32.const @(CC_REST + CC_DROP + CC_WARN1)))))))
  (i32.add (i32.const @CC_T_SD) (i32.mul (i32.sub (local.get $c) (i32.const @CC_SD)) (i32.const @(CC_REST + CC_DROP + CC_WARNSD)))))

;; Cycle c's warning, in ticks.
(func $cc_warn (param $c i32) (result i32)
  (if (result i32) (i32.lt_u (local.get $c) (i32.const @CC_FULL))
    (then (i32.sub (i32.const @CC_WARN0) (i32.mul (local.get $c) (i32.const @CC_WARNK))))
    (else (select (i32.const @CC_WARNSD) (i32.const @CC_WARN1) (i32.ge_u (local.get $c) (i32.const @CC_SD))))))

;; The cycle on tick t into play, and the ticks its warning and its drop begin.
(func $cc_when (param $t i32) (result i32 i32 i32)
  (local $c i32) (local $w0 i32)
  (if (i32.ge_u (local.get $t) (i32.const @CC_T_SD))
    (then (local.set $c (i32.add (i32.const @CC_SD)
                                 (i32.div_u (i32.sub (local.get $t) (i32.const @CC_T_SD)) (i32.const @(CC_REST + CC_DROP + CC_WARNSD))))))
    (else
      (if (i32.ge_u (local.get $t) (i32.const @CC_T_FULL))
        (then (local.set $c (i32.add (i32.const @CC_FULL)
                                     (i32.div_u (i32.sub (local.get $t) (i32.const @CC_T_FULL)) (i32.const @(CC_REST + CC_DROP + CC_WARN1))))))
        (else
          (block $found
            (loop $next
              (br_if $found (i32.gt_u (call $cc_cycle_at (i32.add (local.get $c) (i32.const 1))) (local.get $t)))
              (!inc $c)
              (br $next)))))))
  (local.set $w0 (i32.add (call $cc_cycle_at (local.get $c)) (i32.const @CC_REST)))
  (local.get $c)
  (local.get $w0)
  (i32.add (local.get $w0) (call $cc_warn (local.get $c))))

;; The rim cycle c's drop leaves (the disc's own before any, c < 0 included):
;; from cycle CC_SHRINK in even steps to CC_RMIN at cycle CC_SD - 1.
(func $cc_rim (param $d i32) (param $c i32) (result f32)
  (local $k i32) (local $r0 f32)
  (local.set $r0 (f32.load offset=@(PG_H + CC_RAD) (local.get $d)))
  (local.set $k (i32.sub (local.get $c) (i32.const @(CC_SHRINK - 1))))
  (if (i32.le_s (local.get $k) (i32.const 0)) (then (return (local.get $r0))))
  (if (i32.ge_s (local.get $k) (i32.const @CC_SHRINKN)) (then (return (f32.const @CC_RMIN))))
  (f32.sub (local.get $r0) (f32.mul (f32.sub (local.get $r0) (f32.const @CC_RMIN))
                                    (f32.div (f32.convert_i32_s (local.get $k)) (f32.const @CC_SHRINKN)))))

;; Is tile (q, r)'s centre within rim of the stage's centre?
(func $cc_in (param $q i32) (param $r i32) (param $rim f32) (result i32)
  (local $x f32) (local $z f32)
  (call $p_hexc (local.get $q) (local.get $r) (f32.const @CC_S))
  (local.set $z) (local.set $x)
  (local.set $x (f32.sub (local.get $x) (f32.load (i32.const @PG_CX))))
  (local.set $z (f32.sub (local.get $z) (f32.load (i32.const @PG_CX))))
  (f32.le (!madd (local.get $x) (local.get $x) (f32.mul (local.get $z) (local.get $z))) (f32.mul (local.get $rim) (local.get $rim))))

;; Tile (q, r)'s colour in cycle c, of k: the board shuffles every cycle.
(func $cc_colour (param $q i32) (param $r i32) (param $c i32) (param $k i32) (result i32)
  (i32.rem_u (call $hash32 (local.get $q) (local.get $r) (call $p_seed (i32.add (i32.const @CC_KBOARD) (local.get $c)))) (local.get $k)))

;; A tile for cycle c's call, (q, r) and its colour: the first of CC_TRIES
;; points over the square round the disc whose tile is still on the board
;; after the drop and whose colour is neither a nor b; else the middle tile.
;; A call is a tile, so its colour is always somewhere to stand.
(func $cc_pick (param $d i32) (param $c i32) (param $a i32) (param $b i32) (result i32 i32 i32)
  (local $rim f32) (local $sc f32) (local $base i32) (local $h i32) (local $j i32) (local $q i32) (local $r i32) (local $col i32) (local $k i32)
  (local.set $rim (call $cc_rim (local.get $d) (local.get $c)))
  (local.set $sc (f32.mul (local.get $rim) (f32.const 0.000030517578125))) ;; 2^-15: a u16 over [-rim, rim)
  (local.set $k (i32.load offset=@(PG_H + CC_K) (local.get $d)))
  (local.set $base (call $p_seed (i32.add (i32.const @CC_KCALL) (local.get $c))))
  (!for $j (i32.const 0) (i32.const @CC_TRIES)
    (local.set $h (call $hash32 (local.get $j) (local.get $c) (local.get $base)))
    (call $p_hex
      (!madd (f32.convert_i32_s (i32.sub (i32.and (local.get $h) (i32.const 0xffff)) (i32.const 32768))) (local.get $sc) (f32.load (i32.const @PG_CX)))
      (!madd (f32.convert_i32_s (i32.sub (i32.shr_u (local.get $h) (i32.const 16)) (i32.const 32768))) (local.get $sc) (f32.load (i32.const @PG_CX)))
      (f32.const @CC_S))
    (local.set $r) (local.set $q)
    (if (call $cc_in (local.get $q) (local.get $r) (local.get $rim))
      (then
        (local.set $col (call $cc_colour (local.get $q) (local.get $r) (local.get $c) (local.get $k)))
        (if (i32.and (i32.ne (local.get $col) (local.get $a)) (i32.ne (local.get $col) (local.get $b)))
          (then (return (local.get $q) (local.get $r) (local.get $col)))))))
  (i32.const 0)
  (i32.const 0)
  (call $cc_colour (i32.const 0) (i32.const 0) (local.get $c) (local.get $k)))

;; Cycle c's call: its tile (q, r) and colour. An even cycle's is its first
;; pick; an odd one's avoids both neighbours' colours, so no colour is called
;; twice running.
(func $cc_call (param $d i32) (param $c i32) (result i32 i32 i32)
  (local $q i32) (local $r i32) (local $a i32) (local $b i32)
  (if (i32.eqz (i32.and (local.get $c) (i32.const 1)))
    (then (return (call $cc_pick (local.get $d) (local.get $c) (i32.const -1) (i32.const -1)))))
  (call $cc_pick (local.get $d) (i32.sub (local.get $c) (i32.const 1)) (i32.const -1) (i32.const -1))
  (local.set $a) (local.set $r) (local.set $q)
  (call $cc_pick (local.get $d) (i32.add (local.get $c) (i32.const 1)) (i32.const -1) (i32.const -1))
  (local.set $b) (local.set $r) (local.set $q)
  (call $cc_pick (local.get $d) (local.get $c) (local.get $a) (local.get $b)))

;; The disc for the crowd, its colours: 4, 5 over CC_KN5 balls. Braking is
;; strong (CC_IDLE): stopping on a tile is half the game.
(func $cc_setup (param $n i32)
  (local $rad f32)
  (local.set $rad (f32.min (!madd (f32.sqrt (f32.convert_i32_u (local.get $n))) (f32.const @CC_RK) (f32.const @CC_R0)) (f32.const @CC_RMAX)))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_OUT))
  (i32.store (i32.const @PG_LEN) (i32.const @CC_LEN))
  (f32.store (i32.const @PG_SIZE) (local.get $rad))
  (f32.store (i32.const @PG_IDLE) (f32.const @CC_IDLE))
  (f32.store (i32.const @(PG_H + CC_RAD)) (local.get $rad))
  (i32.store (i32.const @(PG_H + CC_K)) (select (i32.const 5) (i32.const 4) (i32.gt_u (local.get $n) (i32.const @CC_KN5)))))

;; A sunflower spiral over the middle of the disc.
(func $cc_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $x f32) (local $z f32)
  (call $p_disc (local.get $i) (local.get $n) (f32.mul (f32.load (i32.const @(PG_H + CC_RAD))) (f32.const @CC_SPAWN)))
  (local.set $z) (local.set $x)
  (local.get $x) (f32.const @PLAT_Y) (local.get $z))

(func $cc_start)

;; The floor's top if the tile under (x, z) holds on bank d's tick: on the
;; board the last drop left, and through a drop of the colour called and
;; inside the rim it leaves (in sudden death, the tile called itself).
(func $cc_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (local $t i32) (local $c i32) (local $w0 i32) (local $d0 i32) (local $q i32) (local $r i32) (local $cq i32) (local $cr i32) (local $col i32)
  (if (f32.gt (f32.const @PLAT_Y) (local.get $y)) (then (return (f32.const -1000))))
  (local.set $t (call $p_t (local.get $d)))
  (call $cc_when (local.get $t))
  (local.set $d0) (local.set $w0) (local.set $c)
  (call $p_hex (local.get $x) (local.get $z) (f32.const @CC_S))
  (local.set $r) (local.set $q)
  (if (i32.eqz (call $cc_in (local.get $q) (local.get $r) (call $cc_rim (local.get $d) (i32.sub (local.get $c) (i32.const 1)))))
    (then (return (f32.const -1000))))
  (if (i32.ge_u (local.get $t) (local.get $d0))
    (then
      (if (i32.eqz (call $cc_in (local.get $q) (local.get $r) (call $cc_rim (local.get $d) (local.get $c))))
        (then (return (f32.const -1000))))
      (call $cc_call (local.get $d) (local.get $c))
      (local.set $col) (local.set $cr) (local.set $cq)
      (if (i32.ge_u (local.get $c) (i32.const @CC_SD))
        (then
          (if (i32.or (i32.ne (local.get $q) (local.get $cq)) (i32.ne (local.get $r) (local.get $cr)))
            (then (return (f32.const -1000)))))
        (else
          (if (i32.ne (call $cc_colour (local.get $q) (local.get $r) (local.get $c) (i32.load offset=@(PG_H + CC_K) (local.get $d))) (local.get $col))
            (then (return (f32.const -1000))))))))
  (f32.const @PLAT_Y))

(func $cc_push (param $p i32) (param $d i32))

;; The cycle's moments as FX: the tiles back in new colours (a call survived,
;; counted in CC_SURV for every ball still up: outside the ball's record, so
;; the prediction's copy of it stays the confirmed one's), the call, the drop.
(func $cc_tick
  (local $t i32) (local $c i32) (local $w0 i32) (local $d0 i32) (local $p i32) (local $pb i32) (local $q i32) (local $r i32) (local $col i32)
  (local $x f32) (local $z f32)
  (local.set $t (call $p_t (i32.const 0)))
  (call $cc_when (local.get $t))
  (local.set $d0) (local.set $w0) (local.set $c)
  (if (i32.and (i32.ne (local.get $c) (i32.const 0)) (i32.eq (local.get $t) (i32.sub (local.get $w0) (i32.const @CC_REST))))
    (then
      (!for $p (i32.const 0) (i32.const @NPLAYER)
        (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
        (if (call $p_in (local.get $pb))
          (then (!st u8 @(PG_S + CC_SURV) (local.get $p) (i32.add (!ld u8 @(PG_S + CC_SURV) (local.get $p)) (i32.const 1))))))
      (call $fx (i32.const 0) (i32.const @CC_FX_RISE) (i32.const 255) (i32.shl (local.get $c) (i32.const 4))
                (f32.load (i32.const @PG_CX)) (f32.const @PLAT_Y) (f32.load (i32.const @PG_CX)) (call $cc_rim (i32.const 0) (local.get $c)))))
  (if (i32.or (i32.eq (local.get $t) (local.get $w0)) (i32.eq (local.get $t) (local.get $d0)))
    (then
      (call $cc_call (i32.const 0) (local.get $c))
      (local.set $col) (local.set $r) (local.set $q)
      (call $p_hexc (local.get $q) (local.get $r) (f32.const @CC_S))
      (local.set $z) (local.set $x)
      (call $fx (i32.const 0) (select (i32.const @CC_FX_CALL) (i32.const @CC_FX_DROP) (i32.eq (local.get $t) (local.get $w0)))
                (i32.const 255) (i32.or (local.get $col) (i32.shl (local.get $c) (i32.const 4)))
                (local.get $x) (f32.const @PLAT_Y) (local.get $z)
                (select (f32.convert_i32_u (call $cc_warn (local.get $c))) (call $cc_rim (i32.const 0) (local.get $c)) (i32.eq (local.get $t) (local.get $w0)))))))

;; Two or more still in and every one of them falling (a drop took them all
;; at once): over now, and they share the win rather than all sharing last.
(func $cc_over (result i32)
  (local $p i32) (local $pb i32)
  (if (i32.lt_u (i32.load (i32.const @BH_LEFT)) (i32.const 2)) (then (return (i32.const 0))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (if (call $p_in (local.get $pb)) (then (return (i32.const 0)))))
  (i32.const 1))

(func $cc_out (param $p i32))
