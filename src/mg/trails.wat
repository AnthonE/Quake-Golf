;; LIGHT TRAILS: a dark square floor over the sea, sized for the crowd, its
;; edges closing in from LT_CLOSE0 to LT_CLOSE1. Every ball in lays a trail of
;; light: each tick, the cells of an LT_CS grid its centre crossed since the
;; last (walked side by side along the segment, so a fast ball skips none)
;; that are free take its slot and the tick. A cell is soft for LT_HARD, then
;; a wall: a ball whose centre crosses a hard cell (anyone's, its own too)
;; with its bottom under LT_WALL is out, in slot order. A cell fades LT_LIFE0
;; after it was laid, a tick later for every LT_LIFED into play it was laid,
;; so the floor fills as the round goes; then it is free again. Bumps on,
;; without bumper's kick. The last ball in wins.
;;
;; Ground is the square on bank d's tick, a function of the header alone, so
;; the prediction rolls its ball off the closing edge exactly. The trails are
;; the confirmed world's (PG_BIG), and so is an out on one, a round trip late
;; like a bump; but a cell stays soft for LT_HARD, as far as the prediction
;; runs ahead, so every wall a predicted ball can meet was laid before the
;; world it was predicted from, and the client finds the crash on the
;; prediction's track as the confirmed world will.

;; The floor's half-side on tick t into play on bank d: LT_HALF0 until
;; LT_CLOSE0, then in a straight line to LT_HALF1 by LT_CLOSE1.
(func $lt_half (param $d i32) (param $t i32) (result f32)
  (local $h0 f32) (local $h1 f32)
  (local.set $h0 (f32.load offset=@(PG_H + LT_HALF0) (local.get $d)))
  (local.set $h1 (f32.load offset=@(PG_H + LT_HALF1) (local.get $d)))
  (if (i32.le_s (local.get $t) (i32.const @LT_CLOSE0)) (then (return (local.get $h0))))
  (if (i32.ge_s (local.get $t) (i32.const @LT_CLOSE1)) (then (return (local.get $h1))))
  (!madd (f32.sub (local.get $h1) (local.get $h0))
         (f32.div (f32.convert_i32_s (i32.sub (local.get $t) (i32.const @LT_CLOSE0))) (f32.const @(LT_CLOSE1 - LT_CLOSE0)))
         (local.get $h0)))

;; Ticks a cell laid tl into play lasts.
(func $lt_life (param $tl i32) (result i32)
  (i32.add (i32.const @LT_LIFE0) (i32.div_u (local.get $tl) (i32.const @LT_LIFED))))

;; The floor for the crowd and its grid, the edges' end, bumps without kick,
;; a quicker push to a lower top speed (a tighter turn).
(func $lt_setup (param $n i32)
  (local $h f32)
  (local.set $h (f32.min (!madd (f32.sqrt (f32.convert_i32_u (local.get $n))) (f32.const @LT_HK) (f32.const @LT_H0)) (f32.const @LT_HMAX)))
  (!chk (local.get $h) 210 (local.get $n))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_OUT))
  (i32.store (i32.const @PG_LEN) (i32.const @LT_LEN))
  (i32.store (i32.const @PG_FLAGS) (i32.const @(PGF_BUMPS | PGF_NOKICK)))
  (f32.store (i32.const @PG_SIZE) (local.get $h))
  (f32.store (i32.const @PG_ACC) (f32.const @LT_ACC))
  (f32.store (i32.const @PG_DRAG) (f32.const @LT_DRAG))
  (f32.store (i32.const @PG_IDLE) (f32.const @LT_DRAG))
  (f32.store (i32.const @(PG_H + LT_HALF0)) (local.get $h))
  (f32.store (i32.const @(PG_H + LT_HALF1)) (f32.max (f32.mul (local.get $h) (f32.const @LT_HEND)) (f32.const @LT_HMIN)))
  (f32.store (i32.const @(PG_H + LT_X0)) (f32.sub (f32.load (i32.const @PG_CX)) (local.get $h)))
  (i32.store (i32.const @(PG_H + LT_SIDE)) (i32.trunc_sat_f32_u (f32.ceil (f32.div (f32.add (local.get $h) (local.get $h)) (f32.const @LT_CS))))))

;; A sunflower spiral over the middle of the floor.
(func $lt_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $x f32) (local $z f32)
  (call $p_disc (local.get $i) (local.get $n) (f32.mul (f32.load (i32.const @(PG_H + LT_HALF0))) (f32.const @LT_SPAWN)))
  (local.set $z) (local.set $x)
  (local.get $x) (f32.const @PLAT_Y) (local.get $z))

;; Where every ball's centre starts its first walk.
(func $lt_start
  (local $p i32) (local $pb i32) (local $o i32)
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (local.set $o (i32.add (i32.const @(PG_S + LT_PREV)) (i32.shl (local.get $p) (i32.const 3))))
    (f32.store (local.get $o) (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
    (f32.store offset=4 (local.get $o) (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))))

(func $lt_begin (param $p i32) (param $d i32))

;; The floor's top under (x, z) if that is inside the square as it is on bank d's tick.
(func $lt_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (local $h f32) (local $cx f32)
  (if (f32.lt (local.get $y) (f32.const @PLAT_Y)) (then (return (f32.const -1000))))
  (local.set $h (call $lt_half (local.get $d) (call $p_t (local.get $d))))
  (local.set $cx (f32.load offset=@PG_CX (local.get $d)))
  (if (result f32) (i32.and (f32.le (f32.abs (f32.sub (local.get $x) (local.get $cx))) (local.get $h))
                            (f32.le (f32.abs (f32.sub (local.get $z) (local.get $cx))) (local.get $h)))
    (then (f32.const @PLAT_Y))
    (else (f32.const -1000))))

(func $lt_push (param $p i32) (param $d i32))

;; Cell (i, j) as slot p's centre crosses it on tick t into play: off the grid,
;; nothing; alive (laid less than its life ago), its value if it is hard and
;; the ball low, else nothing; free (none, or faded), laid its own.
(func $lt_visit (param $p i32) (param $t i32) (param $low i32) (param $i i32) (param $j i32) (result i32)
  (local $side i32) (local $a i32) (local $v i32) (local $age i32)
  (local.set $side (i32.load (i32.const @(PG_H + LT_SIDE))))
  (if (i32.or (i32.ge_u (local.get $i) (local.get $side)) (i32.ge_u (local.get $j) (local.get $side))) (then (return (i32.const 0))))
  (local.set $a (i32.add (i32.const @(PG_BIG + LT_CELLS)) (i32.shl (i32.add (i32.mul (local.get $j) (local.get $side)) (local.get $i)) (i32.const 2))))
  (local.set $v (i32.load (local.get $a)))
  (if (local.get $v)
    (then
      (local.set $age (i32.sub (local.get $t) (i32.shr_u (local.get $v) (i32.const 8))))
      (if (i32.lt_s (local.get $age) (call $lt_life (i32.shr_u (local.get $v) (i32.const 8))))
        (then
          (if (i32.and (local.get $low) (i32.ge_s (local.get $age) (i32.const @LT_HARD))) (then (return (local.get $v))))
          (return (i32.const 0))))))
  (i32.store (local.get $a) (i32.or (i32.shl (local.get $t) (i32.const 8)) (local.get $p)))
  (i32.const 0))

;; Slot p's centre from (x0, z0) to (x1, z1) on tick t, through every cell
;; the segment crosses: the side it reaches first each step (ex / du against
;; ez / dw, cross-multiplied), at most LT_WALK steps, each cell visited. The
;; hard cell that stops it, or 0.
(func $lt_walk (param $p i32) (param $t i32) (param $low i32) (param $x0 f32) (param $z0 f32) (param $x1 f32) (param $z1 f32) (result i32)
  (local $g f32) (local $u0 f32) (local $w0 f32) (local $u1 f32) (local $w1 f32) (local $du f32) (local $dw f32) (local $ex f32) (local $ez f32)
  (local $i i32) (local $j i32) (local $si i32) (local $sj i32) (local $ni i32) (local $nj i32) (local $k i32) (local $v i32)
  (local.set $g (f32.load (i32.const @(PG_H + LT_X0))))
  (local.set $u0 (f32.div (f32.sub (local.get $x0) (local.get $g)) (f32.const @LT_CS)))
  (local.set $w0 (f32.div (f32.sub (local.get $z0) (local.get $g)) (f32.const @LT_CS)))
  (local.set $u1 (f32.div (f32.sub (local.get $x1) (local.get $g)) (f32.const @LT_CS)))
  (local.set $w1 (f32.div (f32.sub (local.get $z1) (local.get $g)) (f32.const @LT_CS)))
  (!chk (local.get $u1) 211 (local.get $p))
  (!chk (local.get $w1) 212 (local.get $p))
  (local.set $i (i32.trunc_sat_f32_s (f32.floor (local.get $u0))))
  (local.set $j (i32.trunc_sat_f32_s (f32.floor (local.get $w0))))
  (local.set $ni (i32.sub (i32.trunc_sat_f32_s (f32.floor (local.get $u1))) (local.get $i)))
  (local.set $nj (i32.sub (i32.trunc_sat_f32_s (f32.floor (local.get $w1))) (local.get $j)))
  (local.set $si (select (i32.const -1) (i32.const 1) (i32.lt_s (local.get $ni) (i32.const 0))))
  (local.set $sj (select (i32.const -1) (i32.const 1) (i32.lt_s (local.get $nj) (i32.const 0))))
  (local.set $ni (i32.mul (local.get $ni) (local.get $si)))
  (local.set $nj (i32.mul (local.get $nj) (local.get $sj)))
  (local.set $du (f32.abs (f32.sub (local.get $u1) (local.get $u0))))
  (local.set $dw (f32.abs (f32.sub (local.get $w1) (local.get $w0))))
  (local.set $v (call $lt_visit (local.get $p) (local.get $t) (local.get $low) (local.get $i) (local.get $j)))
  (block $done
    (loop $next
      (br_if $done (i32.or (local.get $v) (i32.ge_u (local.get $k) (i32.const @LT_WALK))))
      (br_if $done (i32.eqz (i32.add (local.get $ni) (local.get $nj))))
      ;; from the start to the next side across x, and across z, in cells
      (local.set $ex (f32.abs (f32.sub (f32.convert_i32_s (i32.add (local.get $i) (i32.gt_s (local.get $si) (i32.const 0)))) (local.get $u0))))
      (local.set $ez (f32.abs (f32.sub (f32.convert_i32_s (i32.add (local.get $j) (i32.gt_s (local.get $sj) (i32.const 0)))) (local.get $w0))))
      (if (i32.or (i32.eqz (local.get $nj))
                  (i32.and (i32.ne (local.get $ni) (i32.const 0)) (f32.lt (f32.mul (local.get $ex) (local.get $dw)) (f32.mul (local.get $ez) (local.get $du)))))
        (then
          (local.set $i (i32.add (local.get $i) (local.get $si)))
          (local.set $ni (i32.sub (local.get $ni) (i32.const 1))))
        (else
          (local.set $j (i32.add (local.get $j) (local.get $sj)))
          (local.set $nj (i32.sub (local.get $nj) (i32.const 1)))))
      (local.set $v (call $lt_visit (local.get $p) (local.get $t) (local.get $low) (local.get $i) (local.get $j)))
      (!inc $k)
      (br $next)))
  (local.get $v))

;; Slot p out on hard cell v on tick t: the KO to whoever laid it (unless a
;; bump sent it there: the bumper's), PG_M the slot + 1 whose light, the FX.
(func $lt_crash (param $p i32) (param $v i32) (param $t i32)
  (local $pb i32) (local $q i32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (local.set $q (i32.and (local.get $v) (i32.const 255)))
  (if (i32.and (i32.ne (local.get $q) (local.get $p)) (i32.eqz (!at u16 @(PLAYERS + B_HITT) (local.get $pb))))
    (then
      (!put u8 @(PLAYERS + B_HITBY) (local.get $pb) (local.get $q))
      (!put u16 @(PLAYERS + B_HITT) (local.get $pb) (i32.const 1))))
  (!put i32 @(PLAYERS + PG_M) (local.get $pb) (i32.add (local.get $q) (i32.const 1)))
  (call $fx (i32.const 0) (i32.const @LT_FX_CRASH) (local.get $p) (local.get $q)
            (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (!at f32 @(PLAYERS + P_PZ) (local.get $pb))
            (f32.convert_i32_s (i32.sub (local.get $t) (i32.shr_u (local.get $v) (i32.const 8)))))
  (call $p_out (local.get $p)))

;; A play tick: the edges' FX as they start in, PG_SIZE the half-side now;
;; then every ball in, in slot order, walks its centre from where it was:
;; laying its light, or out on a wall. Every slot's centre kept for the next.
(func $lt_tick
  (local $t i32) (local $p i32) (local $pb i32) (local $o i32) (local $v i32) (local $x f32) (local $z f32)
  (local.set $t (call $p_t (i32.const 0)))
  (if (i32.eq (local.get $t) (i32.const @LT_CLOSE0))
    (then (call $fx (i32.const 0) (i32.const @LT_FX_CLOSE) (i32.const 255) (i32.const 0)
                    (f32.load (i32.const @PG_CX)) (f32.const @PLAT_Y) (f32.load (i32.const @PG_CX)) (f32.load (i32.const @(PG_H + LT_HALF1))))))
  (f32.store (i32.const @PG_SIZE) (call $lt_half (i32.const 0) (local.get $t)))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (local.set $o (i32.add (i32.const @(PG_S + LT_PREV)) (i32.shl (local.get $p) (i32.const 3))))
    (local.set $x (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
    (local.set $z (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
    (if (call $p_in (local.get $pb))
      (then
        (local.set $v (call $lt_walk (local.get $p) (local.get $t)
                                     (f32.lt (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (f32.const @(+PLAT_Y + LT_WALL)))
                                     (f32.load (local.get $o)) (f32.load offset=4 (local.get $o)) (local.get $x) (local.get $z)))
        (if (local.get $v) (then (call $lt_crash (local.get $p) (local.get $v) (local.get $t))))))
    (f32.store (local.get $o) (local.get $x))
    (f32.store offset=4 (local.get $o) (local.get $z))))

(func $lt_over (result i32) (i32.const 0))

(func $lt_out (param $p i32))
