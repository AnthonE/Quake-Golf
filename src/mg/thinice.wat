;; THIN ICE: three layers of hex ice over the sea, TI_GAP apart, each a disc
;; sized for the crowd. A ball on the ground cracks the tile under its
;; centre; the tile holds TI_HOLD ticks more, then drops. Through all three
;; and you're out; the last ball up wins.
;;
;; A cell is 0 (no tile), 1 (intact) or the tick the tile stops holding, so
;; whether a tile holds is a function of the tick: $ti_ground reads the
;; confirmed cells against bank d's own tick. The prediction is exact while
;; it runs at most TI_HOLD ticks ahead of the confirmed world: a crack the
;; confirmed world hasn't made yet holds on every tick the prediction reaches.

;; Cell (q, r) of layer k, an index across the layers; -1 off the grid.
(func $ti_cell (param $q i32) (param $r i32) (param $k i32) (result i32)
  (if (i32.or (i32.gt_u (i32.add (local.get $q) (i32.const @TI_N)) (i32.const @(2 * TI_N)))
              (i32.gt_u (i32.add (local.get $r) (i32.const @TI_N)) (i32.const @(2 * TI_N))))
    (then (return (i32.const -1))))
  (i32.add (i32.add (i32.mul (local.get $k) (i32.const @TI_CELLS))
                    (i32.mul (i32.add (local.get $r) (i32.const @TI_N)) (i32.const @TI_W)))
           (i32.add (local.get $q) (i32.const @TI_N))))

;; Layer k's top.
(func $ti_top (param $k i32) (result f32)
  (f32.sub (f32.const @PLAT_Y) (f32.mul (f32.convert_i32_u (local.get $k)) (f32.const @TI_GAP))))

;; Every tile whose centre is on the disc, on all three layers.
(func $ti_setup (param $n i32)
  (local $q i32) (local $r i32) (local $k i32) (local $count i32) (local $rad f32) (local $x f32) (local $z f32) (local $dx f32) (local $dz f32)
  (local.set $rad (f32.min (!madd (f32.sqrt (f32.convert_i32_u (local.get $n))) (f32.const @TI_RK) (f32.const @TI_R0)) (f32.const @TI_RMAX)))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_OUT))
  (i32.store (i32.const @PG_LEN) (i32.const @TI_LEN))
  (f32.store (i32.const @PG_FLOOR) (f32.const @(PLAT_Y - TI_GAP * (TI_LAYERS - 1))))
  (f32.store (i32.const @PG_SIZE) (local.get $rad))
  (f32.store (i32.const @(PG_H + TI_RAD)) (local.get $rad))
  (!for $r (i32.const 0) (i32.const @TI_W)
    (!for $q (i32.const 0) (i32.const @TI_W)
      (call $p_hexc (i32.sub (local.get $q) (i32.const @TI_N)) (i32.sub (local.get $r) (i32.const @TI_N)) (f32.const @TI_S))
      (local.set $z) (local.set $x)
      (local.set $dx (f32.sub (local.get $x) (f32.load (i32.const @PG_CX))))
      (local.set $dz (f32.sub (local.get $z) (f32.load (i32.const @PG_CX))))
      (if (f32.le (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))) (f32.mul (local.get $rad) (local.get $rad)))
        (then
          (!inc $count)
          (!for $k (i32.const 0) (i32.const @TI_LAYERS)
            (i32.store offset=@(PG_BIG + TI_TILES)
              (i32.shl (i32.add (i32.add (i32.mul (local.get $k) (i32.const @TI_CELLS)) (i32.mul (local.get $r) (i32.const @TI_W))) (local.get $q)) (i32.const 2))
              (i32.const 1)))))))
  (i32.store (i32.const @(PG_H + TI_COUNT)) (local.get $count)))

;; On the top layer, a sunflower spiral over the middle of the disc.
(func $ti_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $x f32) (local $z f32)
  (call $p_disc (local.get $i) (local.get $n) (f32.mul (f32.load (i32.const @(PG_H + TI_RAD))) (f32.const 0.8)))
  (local.set $z) (local.set $x)
  (local.get $x) (f32.const @PLAT_Y) (local.get $z))

(func $ti_start)

;; The highest layer no higher than y whose tile under (x, z) holds on bank d's tick.
(func $ti_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (local $q i32) (local $r i32) (local $k i32) (local $c i32) (local $v i32) (local $t i32) (local $top f32)
  (call $p_hex (local.get $x) (local.get $z) (f32.const @TI_S))
  (local.set $r) (local.set $q)
  (local.set $t (i32.load offset=@HDR_TICK (local.get $d)))
  (!for $k (i32.const 0) (i32.const @TI_LAYERS)
    (local.set $top (call $ti_top (local.get $k)))
    (if (f32.le (local.get $top) (local.get $y))
      (then
        (local.set $c (call $ti_cell (local.get $q) (local.get $r) (local.get $k)))
        (if (i32.ge_s (local.get $c) (i32.const 0))
          (then
            (local.set $v (i32.load offset=@(PG_BIG + TI_TILES) (i32.shl (local.get $c) (i32.const 2))))
            (if (i32.or (i32.eq (local.get $v) (i32.const 1)) (i32.lt_u (local.get $t) (local.get $v)))
              (then (return (local.get $top)))))))))
  (f32.const -1000))

(func $ti_push (param $p i32) (param $d i32))

;; Every ball on the ice, in slot order, cracks the tile under its centre;
;; then the tiles that stop holding next tick go (their FX, in crack order).
(func $ti_tick
  (local $p i32) (local $pb i32) (local $k i32) (local $q i32) (local $r i32) (local $c i32) (local $a i32) (local $t i32)
  (local $head i32) (local $tail i32) (local $top f32) (local $x f32) (local $z f32)
  (local.set $t (i32.load (i32.const @HDR_TICK)))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (if (i32.and (call $p_in (local.get $pb)) (i32.ne (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_GROUND)) (i32.const 0)))
      (then
        (call $p_hex (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (!at f32 @(PLAYERS + P_PZ) (local.get $pb)) (f32.const @TI_S))
        (local.set $r) (local.set $q)
        (!for $k (i32.const 0) (i32.const @TI_LAYERS)
          (local.set $top (call $ti_top (local.get $k)))
          (if (f32.lt (f32.abs (f32.sub (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (local.get $top))) (f32.const 0.05))
            (then
              (local.set $c (call $ti_cell (local.get $q) (local.get $r) (local.get $k)))
              (if (i32.ge_s (local.get $c) (i32.const 0))
                (then
                  (local.set $a (i32.add (i32.const @(PG_BIG + TI_TILES)) (i32.shl (local.get $c) (i32.const 2))))
                  (if (i32.eq (i32.load (local.get $a)) (i32.const 1))
                    (then
                      (i32.store (local.get $a) (i32.add (local.get $t) (i32.const @TI_HOLD)))
                      (local.set $tail (i32.load (i32.const @(PG_H + TI_QTAIL))))
                      (if (i32.lt_u (local.get $tail) (i32.const @TI_QMAX))
                        (then
                          (!st u16 @(PG_BIG + TI_QUEUE) (local.get $tail) (local.get $c))
                          (i32.store (i32.const @(PG_H + TI_QTAIL)) (i32.add (local.get $tail) (i32.const 1)))))
                      (call $p_hexc (local.get $q) (local.get $r) (f32.const @TI_S))
                      (local.set $z) (local.set $x)
                      (call $fx (i32.const 0) (i32.const @TI_FX_CRACK) (local.get $p) (local.get $c)
                                (local.get $x) (local.get $top) (local.get $z) (f32.convert_i32_u (local.get $k)))))))))))))
  (local.set $head (i32.load (i32.const @(PG_H + TI_QHEAD))))
  (local.set $tail (i32.load (i32.const @(PG_H + TI_QTAIL))))
  (block $held
    (loop $next
      (br_if $held (i32.ge_u (local.get $head) (local.get $tail)))
      (local.set $c (!ld u16 @(PG_BIG + TI_QUEUE) (local.get $head)))
      (br_if $held (i32.lt_u (i32.add (local.get $t) (i32.const 1))
                             (i32.load offset=@(PG_BIG + TI_TILES) (i32.shl (local.get $c) (i32.const 2)))))
      (local.set $k (i32.div_u (local.get $c) (i32.const @TI_CELLS)))
      (local.set $a (i32.rem_u (local.get $c) (i32.const @TI_CELLS)))
      (call $p_hexc (i32.sub (i32.rem_u (local.get $a) (i32.const @TI_W)) (i32.const @TI_N))
                    (i32.sub (i32.div_u (local.get $a) (i32.const @TI_W)) (i32.const @TI_N)) (f32.const @TI_S))
      (local.set $z) (local.set $x)
      (call $fx (i32.const 0) (i32.const @TI_FX_DROP) (i32.const 255) (local.get $c)
                (local.get $x) (call $ti_top (local.get $k)) (local.get $z) (f32.convert_i32_u (local.get $k)))
      (local.set $head (i32.add (local.get $head) (i32.const 1)))
      (br $next)))
  (i32.store (i32.const @(PG_H + TI_QHEAD)) (local.get $head)))

(func $ti_over (result i32) (i32.const 0))

(func $ti_out (param $p i32))
