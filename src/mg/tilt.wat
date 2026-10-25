;; TILT TABLE: a square table over the sea on a pivot at its middle, sized
;; for the crowd. It tips on a schedule laid out from the round's seed: each
;; move is shown coming TT_WARN ticks ahead, then tips the table over TT_TIP
;; ticks toward one of its four sides (or back to level) and holds. The
;; slopes grow from 8 to 25 degrees and the holds lengthen as the round goes;
;; from TT_CHAIN0 half the tilts swing straight over to the other side before
;; the table levels. The slope pulls a ball down it; from TT_CR0 the edges
;; crumble in, TT_CRN steps to TT_HMIN. A ball off the table and TT_DROP
;; under its plane is out; the last ball on wins.
;;
;; The table is a plane through its pivot (the middle of its top, PLAT_Y),
;; over the square of its half-width: its top falls gx a metre toward +x and
;; gz toward +z, one of them 0 (it tips about one axis at a time, so it draws
;; as one box turned by a yaw and a roll). The moves are fixed in PG_S at
;; setup; the slope ($tt_grad) and the half-width ($tt_half) are functions of
;; the tick into play, which ground and push read on their own bank, so the
;; prediction rolls a ball over the table exactly as the confirmed world
;; will; only ball against ball comes a round trip late.

;; Move k's record (PG_S + TT_MOVES).
(func $tt_ma (param $k i32) (result i32)
  (i32.add (i32.const @(PG_S + TT_MOVES)) (i32.shl (local.get $k) (i32.const 4))))

;; The move in force on tick t into play: the last whose tip starts by t, -1
;; before the first.
(func $tt_move (param $t i32) (result i32)
  (local $lo i32) (local $hi i32) (local $mid i32)
  (local.set $hi (i32.load (i32.const @(PG_H + TT_NMOVE))))
  (block $done
    (loop $halve
      (br_if $done (i32.ge_u (local.get $lo) (local.get $hi)))
      (local.set $mid (i32.shr_u (i32.add (local.get $lo) (local.get $hi)) (i32.const 1)))
      (if (i32.le_s (i32.load offset=@TT_M_T (call $tt_ma (local.get $mid))) (local.get $t))
        (then (local.set $lo (i32.add (local.get $mid) (i32.const 1))))
        (else (local.set $hi (local.get $mid))))
      (br $halve)))
  (i32.sub (local.get $lo) (i32.const 1)))

;; The table's slope on tick t into play, (gx, gz): from the last move's to
;; this one's over its tip, eased in and out (3u^2 - 2u^3), then held.
(func $tt_grad (param $t i32) (result f32 f32)
  (local $k i32) (local $a i32) (local $b i32) (local $u f32) (local $e f32) (local $px f32) (local $pz f32)
  (local.set $k (call $tt_move (local.get $t)))
  (if (i32.lt_s (local.get $k) (i32.const 0)) (then (return (f32.const 0) (f32.const 0))))
  (local.set $a (call $tt_ma (local.get $k)))
  (local.set $u (f32.div (f32.convert_i32_s (i32.sub (local.get $t) (i32.load offset=@TT_M_T (local.get $a))))
                         (f32.convert_i32_u (i32.load16_u offset=@TT_M_TIP (local.get $a)))))
  (if (f32.ge (local.get $u) (f32.const 1))
    (then (return (f32.load offset=@TT_M_GX (local.get $a)) (f32.load offset=@TT_M_GZ (local.get $a)))))
  (if (local.get $k)
    (then
      (local.set $b (call $tt_ma (i32.sub (local.get $k) (i32.const 1))))
      (local.set $px (f32.load offset=@TT_M_GX (local.get $b)))
      (local.set $pz (f32.load offset=@TT_M_GZ (local.get $b)))))
  (local.set $e (f32.mul (f32.mul (local.get $u) (local.get $u)) (f32.sub (f32.const 3) (f32.add (local.get $u) (local.get $u)))))
  (!madd (f32.sub (f32.load offset=@TT_M_GX (local.get $a)) (local.get $px)) (local.get $e) (local.get $px))
  (!madd (f32.sub (f32.load offset=@TT_M_GZ (local.get $a)) (local.get $pz)) (local.get $e) (local.get $pz)))

;; The table's top at (dx, dz) from its middle, sloping (gx, gz).
(func $tt_plane (param $gx f32) (param $gz f32) (param $dx f32) (param $dz f32) (result f32)
  (f32.sub (f32.const @PLAT_Y) (!madd (local.get $gx) (local.get $dx) (f32.mul (local.get $gz) (local.get $dz)))))

;; The edges crumbled by tick t into play.
(func $tt_drops (param $t i32) (result i32)
  (if (i32.lt_s (local.get $t) (i32.const @TT_CR0)) (then (return (i32.const 0))))
  (select (i32.const @TT_CRN) (local.tee $t (i32.add (i32.div_u (i32.sub (local.get $t) (i32.const @TT_CR0)) (i32.const @TT_CRI)) (i32.const 1)))
          (i32.gt_u (local.get $t) (i32.const @TT_CRN))))

;; The half-width once k edges have crumbled, on bank d: in even steps from
;; the start's to TT_HMIN.
(func $tt_halfk (param $d i32) (param $k i32) (result f32)
  (local $h0 f32)
  (local.set $h0 (f32.load offset=@(PG_H + TT_HALF) (local.get $d)))
  (f32.sub (local.get $h0) (f32.mul (f32.sub (local.get $h0) (f32.const @TT_HMIN))
                                    (f32.div (f32.convert_i32_u (local.get $k)) (f32.const @TT_CRN)))))

;; The half-width on tick t into play, on bank d.
(func $tt_half (param $d i32) (param $t i32) (result f32)
  (call $tt_halfk (local.get $d) (call $tt_drops (local.get $t))))

;; The round's moves into PG_S, from its seed. From level, a tilt toward any
;; side but the last tilt's; after a tilt, level, or from TT_CHAIN0 as often
;; as not a swing over to the other side (then level). A tilt's slope from
;; the clock (TT_S0 to TT_S1 by TT_RAMP), give or take TT_SJIT; a tilt holds
;; TT_HOLD0 to TT_HOLD1 and the table rests level TT_REST0 to TT_REST1, as
;; the clock goes. Each move's tip starts as the last one's wait ends.
(func $tt_plan
  (local $k i32) (local $t i32) (local $h i32) (local $base i32) (local $a i32) (local $dir i32) (local $last i32)
  (local $kind i32) (local $prev i32) (local $tip i32) (local $wait i32) (local $s f32)
  (local.set $base (call $p_seed (i32.const @TT_KSEED)))
  (local.set $t (i32.const @TT_FIRST))
  (block $full
    (loop $next
      (br_if $full (i32.ge_u (local.get $k) (i32.const @TT_NMAX)))
      (br_if $full (i32.ge_u (local.get $t) (i32.const @TT_LEN)))
      (local.set $h (call $hash32 (local.get $k) (i32.const @TT_KSEED) (local.get $base)))
      (local.set $s (!madd (f32.const @(TT_S1 - TT_S0)) (f32.min (f32.div (f32.convert_i32_u (local.get $t)) (f32.const @TT_RAMP)) (f32.const 1))
                           (f32.const @TT_S0)))
      (local.set $s (!madd (f32.sub (f32.mul (f32.convert_i32_u (i32.and (i32.shr_u (local.get $h) (i32.const 8)) (i32.const 255))) (f32.const @(2 / 255)))
                                    (f32.const 1))
                           (f32.const @TT_SJIT) (local.get $s)))
      (local.set $kind (i32.const @TT_K_TILT))
      (local.set $tip (i32.const @TT_TIP))
      (local.set $wait (i32.add (i32.const @TT_HOLD0) (i32.div_u (i32.mul (local.get $t) (i32.const @(TT_HOLD1 - TT_HOLD0))) (i32.const @TT_LEN))))
      (if (i32.eq (local.get $prev) (i32.const @TT_K_LEVEL))
        (then
          (local.set $dir (i32.add (i32.rem_u (i32.add (local.get $last) (select (i32.rem_u (local.get $h) (i32.const 3)) (i32.and (local.get $h) (i32.const 3)) (local.get $last)))
                                              (i32.const 4))
                                   (i32.const 1))))
        (else
          (if (i32.and (i32.and (i32.eq (local.get $prev) (i32.const @TT_K_TILT)) (i32.ge_u (local.get $t) (i32.const @TT_CHAIN0)))
                       (i32.and (i32.shr_u (local.get $h) (i32.const 16)) (i32.const 1)))
            (then
              ;; over to the other side of the same axis: 1 and 2, 3 and 4
              (local.set $kind (i32.const @TT_K_SWING))
              (local.set $tip (i32.const @TT_SWING))
              (local.set $dir (i32.add (i32.xor (i32.sub (local.get $last) (i32.const 1)) (i32.const 1)) (i32.const 1))))
            (else
              (local.set $kind (i32.const @TT_K_LEVEL))
              (local.set $dir (i32.const @TT_LEVEL))
              (local.set $s (f32.const 0))
              (local.set $wait (i32.sub (i32.const @TT_REST0) (i32.div_u (i32.mul (local.get $t) (i32.const @(TT_REST0 - TT_REST1))) (i32.const @TT_LEN))))))))
      (!chk (local.get $s) 151 (local.get $k))
      (local.set $a (call $tt_ma (local.get $k)))
      (i32.store offset=@TT_M_T (local.get $a) (local.get $t))
      (f32.store offset=@TT_M_GX (local.get $a) (select (local.get $s) (select (f32.neg (local.get $s)) (f32.const 0) (i32.eq (local.get $dir) (i32.const 2)))
                                                        (i32.eq (local.get $dir) (i32.const 1))))
      (f32.store offset=@TT_M_GZ (local.get $a) (select (local.get $s) (select (f32.neg (local.get $s)) (f32.const 0) (i32.eq (local.get $dir) (i32.const 4)))
                                                        (i32.eq (local.get $dir) (i32.const 3))))
      (i32.store16 offset=@TT_M_TIP (local.get $a) (local.get $tip))
      (i32.store8 offset=@TT_M_DIR (local.get $a) (local.get $dir))
      (i32.store8 offset=@TT_M_KIND (local.get $a) (local.get $kind))
      (if (local.get $dir) (then (local.set $last (local.get $dir))))
      (local.set $prev (local.get $kind))
      (local.set $t (i32.add (local.get $t) (i32.add (local.get $tip) (local.get $wait))))
      (!inc $k)
      (br $next)))
  (i32.store (i32.const @(PG_H + TT_NMOVE)) (local.get $k)))

;; The table for the crowd, the lowest floor where its edge gets tipped its
;; steepest (and a little under), its schedule.
(func $tt_setup (param $n i32)
  (local $h f32)
  (local.set $h (f32.min (!madd (f32.sqrt (f32.convert_i32_u (local.get $n))) (f32.const @TT_HK) (f32.const @TT_H0)) (f32.const @TT_HMAX)))
  (!chk (local.get $h) 150 (local.get $n))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_OUT))
  (i32.store (i32.const @PG_LEN) (i32.const @TT_LEN))
  (f32.store (i32.const @PG_SIZE) (local.get $h))
  (f32.store (i32.const @PG_FLOOR) (f32.sub (f32.const @PLAT_Y) (!madd (local.get $h) (f32.const @(TT_S1 + TT_SJIT)) (f32.const 2))))
  (f32.store (i32.const @(PG_H + TT_HALF)) (local.get $h))
  (call $tt_plan))

;; A sunflower spiral over the middle of the table.
(func $tt_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $x f32) (local $z f32)
  (call $p_disc (local.get $i) (local.get $n) (f32.mul (f32.load (i32.const @(PG_H + TT_HALF))) (f32.const @TT_SPAWN)))
  (local.set $z) (local.set $x)
  (local.get $x) (f32.const @PLAT_Y) (local.get $z))

(func $tt_start)
(func $tt_begin (param $p i32) (param $d i32))

;; The table's top under (x, z) on bank d's tick, if (x, z) is over it and y
;; no more than TT_GRIP under it (a table tipping up past a ball lifts it).
(func $tt_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (local $t i32) (local $h f32) (local $dx f32) (local $dz f32) (local $gx f32) (local $gz f32) (local $top f32)
  (local.set $t (call $p_t (local.get $d)))
  (local.set $h (call $tt_half (local.get $d) (local.get $t)))
  (local.set $dx (f32.sub (local.get $x) (f32.load offset=@PG_CX (local.get $d))))
  (local.set $dz (f32.sub (local.get $z) (f32.load offset=@PG_CX (local.get $d))))
  (if (i32.or (f32.gt (f32.abs (local.get $dx)) (local.get $h)) (f32.gt (f32.abs (local.get $dz)) (local.get $h)))
    (then (return (f32.const -1000))))
  (call $tt_grad (local.get $t))
  (local.set $gz) (local.set $gx)
  (local.set $top (call $tt_plane (local.get $gx) (local.get $gz) (local.get $dx) (local.get $dz)))
  (if (result f32) (f32.lt (local.get $y) (f32.sub (local.get $top) (f32.const @TT_GRIP)))
    (then (f32.const -1000))
    (else (local.get $top))))

;; After the ball's roll on bank d, over the table and not under it: its grip
;; (a ball a hair over the top, not leaving it faster than TT_SNAPV, is on
;; it, so it rides a table tipping away under it), and on it the slope's pull
;; down it, and the table's own motion: its vertical speed is what takes its
;; bottom to the top where it will be next tick. Writes only its own record.
(func $tt_push (param $p i32) (param $d i32)
  (local $pb i32) (local $fl i32) (local $t i32)
  (local $py f32) (local $vx f32) (local $vy f32) (local $vz f32)
  (local $h f32) (local $dx f32) (local $dz f32) (local $gx f32) (local $gz f32) (local $nx f32) (local $nz f32) (local $top f32) (local $next f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
  (if (i32.and (local.get $fl) (i32.const @(PF_FALL | PF_DEAD))) (then (return)))
  (local.set $t (call $p_t (local.get $d)))
  (local.set $h (call $tt_half (local.get $d) (local.get $t)))
  (local.set $dx (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (f32.load offset=@PG_CX (local.get $d))))
  (local.set $dz (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $pb)) (f32.load offset=@PG_CX (local.get $d))))
  (if (i32.or (f32.gt (f32.abs (local.get $dx)) (local.get $h)) (f32.gt (f32.abs (local.get $dz)) (local.get $h))) (then (return)))
  (call $tt_grad (local.get $t))
  (local.set $gz) (local.set $gx)
  (local.set $top (call $tt_plane (local.get $gx) (local.get $gz) (local.get $dx) (local.get $dz)))
  (local.set $py (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
  (if (f32.lt (local.get $py) (f32.sub (local.get $top) (f32.const @TT_GRIP))) (then (return)))
  (local.set $vx (!at f32 @(PLAYERS + P_VX) (local.get $pb)))
  (local.set $vy (!at f32 @(PLAYERS + P_VY) (local.get $pb)))
  (local.set $vz (!at f32 @(PLAYERS + P_VZ) (local.get $pb)))
  ;; next tick's slope, and the top under where the ball rolls to by then
  (call $tt_grad (i32.add (local.get $t) (i32.const 1)))
  (local.set $nz) (local.set $nx)
  (local.set $next (call $tt_plane (local.get $nx) (local.get $nz) (!madd (local.get $vx) (f32.const @DT) (local.get $dx)) (!madd (local.get $vz) (f32.const @DT) (local.get $dz))))
  (if (i32.and (i32.eqz (i32.and (local.get $fl) (i32.const @PF_GROUND)))
               (i32.and (i32.and (f32.ge (local.get $py) (local.get $top)) (f32.le (f32.sub (local.get $py) (local.get $top)) (f32.const @TT_SNAP)))
                        (f32.le (local.get $vy) (!madd (f32.sub (local.get $next) (local.get $top)) (f32.const 125) (f32.const @TT_SNAPV)))))
    (then
      (local.set $py (local.get $top))
      (local.set $fl (i32.or (local.get $fl) (i32.const @PF_GROUND)))))
  (if (i32.and (local.get $fl) (i32.const @PF_GROUND))
    (then
      (local.set $vx (!madd (local.get $gx) (f32.const @(TT_PULL * DT)) (local.get $vx)))
      (local.set $vz (!madd (local.get $gz) (f32.const @(TT_PULL * DT)) (local.get $vz)))
      (local.set $next (call $tt_plane (local.get $nx) (local.get $nz) (!madd (local.get $vx) (f32.const @DT) (local.get $dx)) (!madd (local.get $vz) (f32.const @DT) (local.get $dz))))
      (local.set $vy (f32.mul (f32.sub (local.get $next) (local.get $py)) (f32.const 125)))))
  (!chk (local.get $py) 152 (local.get $p))
  (!chk (local.get $vx) 153 (local.get $p))
  (!chk (local.get $vy) 154 (local.get $p))
  (!chk (local.get $vz) 155 (local.get $p))
  (!put f32 @(PLAYERS + P_PY) (local.get $pb) (local.get $py))
  (!put f32 @(PLAYERS + P_VX) (local.get $pb) (local.get $vx))
  (!put f32 @(PLAYERS + P_VY) (local.get $pb) (local.get $vy))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (local.get $vz))
  (!put u8 @(PLAYERS + P_FL) (local.get $pb) (local.get $fl)))

;; Move k as an FX of kind: owner 255, shot its side | its kind << 3 | k << 8,
;; at the table's middle, size its slope.
(func $tt_fx (param $kind i32) (param $k i32)
  (local $a i32)
  (local.set $a (call $tt_ma (local.get $k)))
  (call $fx (i32.const 0) (local.get $kind) (i32.const 255)
            (i32.or (i32.or (i32.load8_u offset=@TT_M_DIR (local.get $a)) (i32.shl (i32.load8_u offset=@TT_M_KIND (local.get $a)) (i32.const 3)))
                    (i32.shl (local.get $k) (i32.const 8)))
            (f32.load (i32.const @PG_CX)) (f32.const @PLAT_Y) (f32.load (i32.const @PG_CX))
            (f32.add (f32.abs (f32.load offset=@TT_M_GX (local.get $a))) (f32.abs (f32.load offset=@TT_M_GZ (local.get $a))))))

;; The schedule's moments as FX: a move shown coming and its tip starting,
;; an edge cracking and crumbling (PG_SIZE in with it). As the table levels,
;; a tilt ridden out for every ball still in (TT_SURV: outside the ball's
;; record, so the prediction's copy of it stays the confirmed one's). Then
;; the outs: a ball off the table a metre under its plane has left it
;; (TT_FELL, for over; back on it, it hasn't), and TT_DROP under it is out.
(func $tt_tick
  (local $t i32) (local $k i32) (local $a i32) (local $j i32) (local $p i32) (local $pb i32) (local $fl i32)
  (local $cx f32) (local $h f32) (local $gx f32) (local $gz f32) (local $dx f32) (local $dz f32) (local $top f32) (local $py f32)
  (local.set $t (call $p_t (i32.const 0)))
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (local.set $k (call $tt_move (i32.add (local.get $t) (i32.const @TT_WARN))))
  (if (i32.ge_s (local.get $k) (i32.const 0))
    (then
      (if (i32.eq (i32.load offset=@TT_M_T (call $tt_ma (local.get $k))) (i32.add (local.get $t) (i32.const @TT_WARN)))
        (then (call $tt_fx (i32.const @TT_FX_WARN) (local.get $k))))))
  (local.set $k (call $tt_move (local.get $t)))
  (if (i32.ge_s (local.get $k) (i32.const 0))
    (then
      (local.set $a (call $tt_ma (local.get $k)))
      (if (i32.eq (i32.load offset=@TT_M_T (local.get $a)) (local.get $t))
        (then
          (call $tt_fx (i32.const @TT_FX_TIP) (local.get $k))
          (if (i32.eq (i32.load8_u offset=@TT_M_KIND (local.get $a)) (i32.const @TT_K_LEVEL))
            (then
              (!for $p (i32.const 0) (i32.const @NPLAYER)
                (if (call $p_in (i32.shl (local.get $p) (i32.const 6)))
                  (then (!st u8 @(PG_S + TT_SURV) (local.get $p) (i32.add (!ld u8 @(PG_S + TT_SURV) (local.get $p)) (i32.const 1))))))))))))
  ;; an edge: its crack TT_CRWARN before it crumbles, then the crumble
  (local.set $j (i32.sub (i32.add (local.get $t) (i32.const @TT_CRWARN)) (i32.const @TT_CR0)))
  (if (i32.and (i32.ge_s (local.get $j) (i32.const 0)) (i32.eqz (i32.rem_u (local.get $j) (i32.const @TT_CRI))))
    (then
      (local.set $j (i32.add (i32.div_u (local.get $j) (i32.const @TT_CRI)) (i32.const 1)))
      (if (i32.le_u (local.get $j) (i32.const @TT_CRN))
        (then (call $fx (i32.const 0) (i32.const @TT_FX_CRACK) (i32.const 255) (local.get $j) (local.get $cx) (f32.const @PLAT_Y) (local.get $cx)
                        (call $tt_halfk (i32.const 0) (local.get $j)))))))
  (local.set $j (i32.sub (local.get $t) (i32.const @TT_CR0)))
  (if (i32.and (i32.ge_s (local.get $j) (i32.const 0)) (i32.eqz (i32.rem_u (local.get $j) (i32.const @TT_CRI))))
    (then
      (local.set $j (i32.add (i32.div_u (local.get $j) (i32.const @TT_CRI)) (i32.const 1)))
      (if (i32.le_u (local.get $j) (i32.const @TT_CRN))
        (then
          (f32.store (i32.const @PG_SIZE) (call $tt_halfk (i32.const 0) (local.get $j)))
          (call $fx (i32.const 0) (i32.const @TT_FX_DROP) (i32.const 255) (local.get $j) (local.get $cx) (f32.const @PLAT_Y) (local.get $cx)
                    (call $tt_halfk (i32.const 0) (local.get $j)))))))
  ;; the outs
  (local.set $h (call $tt_half (i32.const 0) (local.get $t)))
  (call $tt_grad (local.get $t))
  (local.set $gz) (local.set $gx)
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
    (if (i32.eq (i32.and (local.get $fl) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE))
      (then
        (local.set $dx (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (local.get $cx)))
        (local.set $dz (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $pb)) (local.get $cx)))
        (local.set $py (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
        (local.set $top (call $tt_plane (local.get $gx) (local.get $gz) (local.get $dx) (local.get $dz)))
        (if (i32.or (i32.or (f32.gt (f32.abs (local.get $dx)) (local.get $h)) (f32.gt (f32.abs (local.get $dz)) (local.get $h)))
                    (i32.ne (i32.and (local.get $fl) (i32.const @PF_FALL)) (i32.const 0)))
          (then
            (if (i32.and (f32.lt (local.get $py) (f32.sub (local.get $top) (f32.const 1))) (i32.eqz (!ld u16 @(PG_S + TT_FELL) (local.get $p))))
              (then (!st u16 @(PG_S + TT_FELL) (local.get $p) (i32.add (local.get $t) (i32.const 1)))))
            (if (f32.lt (local.get $py) (f32.sub (local.get $top) (f32.const @TT_DROP)))
              (then (call $p_out (local.get $p)))))
          (else
            (if (i32.and (local.get $fl) (i32.const @PF_GROUND))
              (then (!st u16 @(PG_S + TT_FELL) (local.get $p) (i32.const 0))))))))))

;; Two or more still in, every one of them off the table, and all since the
;; same tick (a tilt took them all at once): over now, and they share the win
;; rather than all sharing last. One that left before the rest goes out
;; first, in its place.
(func $tt_over (result i32)
  (local $p i32) (local $f i32) (local $at i32)
  (if (i32.lt_u (i32.load (i32.const @BH_LEFT)) (i32.const 2)) (then (return (i32.const 0))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (if (i32.eq (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $p) (i32.const 6))) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE))
      (then
        (local.set $f (!ld u16 @(PG_S + TT_FELL) (local.get $p)))
        (if (i32.eqz (local.get $f)) (then (return (i32.const 0))))
        (if (i32.eqz (local.get $at)) (then (local.set $at (local.get $f))))
        (if (i32.ne (local.get $f) (local.get $at)) (then (return (i32.const 0)))))))
  (i32.const 1))

(func $tt_out (param $p i32))
