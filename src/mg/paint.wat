;; PAINT PARTY: a round floor over the sea, a PP_N x PP_N grid of cells over
;; its square. Every tick each ball rolling on it paints the cells within
;; PP_BRUSH of its centre its own, taking them from whoever had them; its
;; count goes up by what it took and theirs down. Paint bombs land on a
;; schedule and burst over the first ball to roll into one (PP_SPLAT round
;; the bomb its colour), then land again elsewhere PP_BACK later. The last
;; PP_RUSH ticks every brush and burst is wider. A fall is PP_RESPAWN ticks
;; down; the paint stays. The most cells when the clock runs out wins.
;;
;; The floor is a disc that never changes: ground reads only its radius in
;; PG_H on its own bank, and push does nothing, so the prediction is exact.
;; The grid, the counts and the bombs are the confirmed world's (PG_BIG,
;; PG_S), written by tick alone; a ball's PG_SCORE is its count, copied every
;; tick (so the prediction's copy of a record is a few ticks stale in that
;; field and that field only).

;; The cells a span of the floor [c - r, c + r] covers along one axis, first
;; and last, clamped to the grid (first > last: none).
(func $pp_span (param $c f32) (param $r f32) (result i32 i32)
  (local $x0 f32) (local $cs f32) (local $lo i32) (local $hi i32)
  (local.set $x0 (f32.load (i32.const @(PG_H + PP_X0))))
  (local.set $cs (f32.load (i32.const @(PG_H + PP_CS))))
  (local.set $lo (i32.trunc_sat_f32_s (f32.floor (f32.div (f32.sub (f32.sub (local.get $c) (local.get $r)) (local.get $x0)) (local.get $cs)))))
  (local.set $hi (i32.trunc_sat_f32_s (f32.floor (f32.div (f32.sub (f32.add (local.get $c) (local.get $r)) (local.get $x0)) (local.get $cs)))))
  (select (i32.const 0) (local.get $lo) (i32.lt_s (local.get $lo) (i32.const 0)))
  (select (i32.const @(PP_N - 1)) (local.get $hi) (i32.gt_s (local.get $hi) (i32.const @(PP_N - 1)))))

;; The k-th slot in tick t's order: up on even ticks, down on odd ones, so
;; of two balls on one cell (or at one bomb) neither always comes last (or first).
(func $pp_nth (param $k i32) (param $t i32) (result i32)
  (select (i32.sub (i32.const @(NPLAYER - 1)) (local.get $k)) (local.get $k) (i32.and (local.get $t) (i32.const 1))))

;; Slot p's brush over (x, z): every cell of the disc whose centre is within
;; r, its own; a cell another ball had is one off that ball's count. The
;; cells it took.
(func $pp_brush (param $p i32) (param $x f32) (param $z f32) (param $r f32) (result i32)
  (local $x0 f32) (local $cs f32) (local $r2 f32) (local $dz f32) (local $dx f32)
  (local $i0 i32) (local $i1 i32) (local $j0 i32) (local $j1 i32) (local $i i32) (local $j i32)
  (local $a i32) (local $v i32) (local $mine i32) (local $got i32)
  (local.set $x0 (f32.load (i32.const @(PG_H + PP_X0))))
  (local.set $cs (f32.load (i32.const @(PG_H + PP_CS))))
  (local.set $r2 (f32.mul (local.get $r) (local.get $r)))
  (local.set $mine (i32.add (local.get $p) (i32.const 1)))
  (call $pp_span (local.get $x) (local.get $r))
  (local.set $i1) (local.set $i0)
  (call $pp_span (local.get $z) (local.get $r))
  (local.set $j1) (local.set $j0)
  (if (i32.or (i32.gt_s (local.get $i0) (local.get $i1)) (i32.gt_s (local.get $j0) (local.get $j1))) (then (return (i32.const 0))))
  (!for $j (local.get $j0) (i32.add (local.get $j1) (i32.const 1))
    (local.set $dz (f32.sub (!madd (f32.add (f32.convert_i32_s (local.get $j)) (f32.const 0.5)) (local.get $cs) (local.get $x0)) (local.get $z)))
    (local.set $dz (f32.mul (local.get $dz) (local.get $dz)))
    (!for $i (local.get $i0) (i32.add (local.get $i1) (i32.const 1))
      (local.set $dx (f32.sub (!madd (f32.add (f32.convert_i32_s (local.get $i)) (f32.const 0.5)) (local.get $cs) (local.get $x0)) (local.get $x)))
      (if (f32.le (!madd (local.get $dx) (local.get $dx) (local.get $dz)) (local.get $r2))
        (then
          (local.set $a (i32.add (i32.const @(PG_BIG + PP_CELLS))
                                 (i32.shl (i32.add (i32.mul (local.get $j) (i32.const @PP_N)) (local.get $i)) (i32.const 1))))
          (local.set $v (i32.load16_u (local.get $a)))
          (if (i32.and (i32.ne (local.get $v) (local.get $mine)) (i32.ne (local.get $v) (i32.const @PP_OFF)))
            (then
              (if (local.get $v)
                (then
                  (local.set $v (i32.sub (local.get $v) (i32.const 1)))
                  (!st u16 @(PG_S + PP_CNT) (local.get $v) (i32.sub (!ld u16 @(PG_S + PP_CNT) (local.get $v)) (i32.const 1)))))
              (i32.store16 (local.get $a) (local.get $mine))
              (!inc $got)))))))
  (!st u16 @(PG_S + PP_CNT) (local.get $p) (i32.add (!ld u16 @(PG_S + PP_CNT) (local.get $p)) (local.get $got)))
  (local.get $got))

;; Bomb j's spot after b bursts: from the round's seed, anywhere within
;; PP_ORB_SPREAD of the disc's radius.
(func $pp_spot (param $j i32) (param $b i32) (result f32 f32)
  (local $h i32) (local $s f32) (local $c f32) (local $rr f32) (local $cx f32)
  (local.set $h (call $p_seed (i32.add (i32.const @PP_KORB) (i32.add (i32.shl (local.get $j) (i32.const 12)) (local.get $b)))))
  (call $sincos (local.get $h))
  (local.set $c) (local.set $s)
  (local.set $rr (f32.mul (f32.mul (f32.load (i32.const @(PG_H + PP_RAD))) (f32.const @PP_ORB_SPREAD))
                          (f32.sqrt (f32.mul (f32.convert_i32_u (i32.shr_u (local.get $h) (i32.const 16))) (f32.const 0.0000152587890625)))))
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (!madd (local.get $c) (local.get $rr) (local.get $cx))
  (!madd (local.get $s) (local.get $rr) (local.get $cx)))

;; Is cell i of a row dz2 (its centre's dz squared) on the disc of r2 round cx?
(func $pp_on (param $i i32) (param $dz2 f32) (param $cx f32) (param $r2 f32) (result i32)
  (local $dx f32)
  (local.set $dx (f32.sub (!madd (f32.add (f32.convert_i32_s (local.get $i)) (f32.const 0.5)) (f32.load (i32.const @(PG_H + PP_CS))) (f32.load (i32.const @(PG_H + PP_X0))))
                          (local.get $cx)))
  (f32.le (!madd (local.get $dx) (local.get $dx) (local.get $dz2)) (local.get $r2)))

;; The disc for the crowd, its grid (a cell whose centre is off the disc
;; marked PP_OFF), the bombs on their first spots. Braking is a little
;; stronger than bumper's. A row's cells on the disc are one run (the test is
;; monotone along it), found from where the circle says and walked to its
;; exact ends, so a lay-out costs a few tests a row, not one a cell.
(func $pp_setup (param $n i32)
  (local $rad f32) (local $cx f32) (local $x0 f32) (local $cs f32) (local $dz f32) (local $r2 f32) (local $w f32)
  (local $j i32) (local $lo i32) (local $hi i32) (local $total i32) (local $k i32) (local $o i32) (local $x f32) (local $z f32)
  (local.set $rad (f32.min (!madd (f32.sqrt (f32.convert_i32_u (local.get $n))) (f32.const @PP_RK) (f32.const @PP_R0)) (f32.const @PP_RMAX)))
  (!chk (local.get $rad) 50 (local.get $n))
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (local.set $x0 (f32.sub (local.get $cx) (local.get $rad)))
  (local.set $cs (f32.mul (local.get $rad) (f32.const @(2 / PP_N))))
  (local.set $r2 (f32.mul (local.get $rad) (local.get $rad)))
  (!chk (local.get $x0) 53 (local.get $n))
  (!chk (local.get $cs) 54 (local.get $n))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_SCORE))
  (i32.store (i32.const @PG_LEN) (i32.const @PP_LEN))
  (i32.store (i32.const @PG_RESPAWN) (i32.const @PP_RESPAWN))
  (f32.store (i32.const @PG_SIZE) (local.get $rad))
  (f32.store (i32.const @PG_IDLE) (f32.const @PP_IDLE))
  (f32.store (i32.const @(PG_H + PP_RAD)) (local.get $rad))
  (f32.store (i32.const @(PG_H + PP_X0)) (local.get $x0))
  (f32.store (i32.const @(PG_H + PP_CS)) (local.get $cs))
  (memory.fill (i32.const @(PG_BIG + PP_CELLS)) (i32.const 0xff) (i32.const @(PP_N * PP_N * 2)))
  (!for $j (i32.const 0) (i32.const @PP_N)
    (local.set $dz (f32.sub (!madd (f32.add (f32.convert_i32_s (local.get $j)) (f32.const 0.5)) (local.get $cs) (local.get $x0)) (local.get $cx)))
    (local.set $dz (f32.mul (local.get $dz) (local.get $dz)))
    (if (f32.le (local.get $dz) (local.get $r2))
      (then
        ;; the run's ends as the circle has them, then walked to where the test changes
        (local.set $w (f32.div (f32.sqrt (f32.sub (local.get $r2) (local.get $dz))) (local.get $cs)))
        (local.set $lo (i32.trunc_sat_f32_s (f32.sub (f32.const @(PP_N / 2)) (local.get $w))))
        (local.set $hi (i32.trunc_sat_f32_s (f32.add (f32.const @(PP_N / 2)) (local.get $w))))
        (if (i32.lt_s (local.get $lo) (i32.const 0)) (then (local.set $lo (i32.const 0))))
        (if (i32.gt_s (local.get $hi) (i32.const @(PP_N - 1))) (then (local.set $hi (i32.const @(PP_N - 1)))))
        (block $a (loop $l
          (br_if $a (i32.or (i32.ge_s (local.get $lo) (i32.const @PP_N)) (call $pp_on (local.get $lo) (local.get $dz) (local.get $cx) (local.get $r2))))
          (!inc $lo) (br $l)))
        (block $a (loop $l
          (br_if $a (i32.or (i32.le_s (local.get $lo) (i32.const 0))
                            (i32.eqz (call $pp_on (i32.sub (local.get $lo) (i32.const 1)) (local.get $dz) (local.get $cx) (local.get $r2)))))
          (local.set $lo (i32.sub (local.get $lo) (i32.const 1))) (br $l)))
        (block $a (loop $l
          (br_if $a (i32.or (i32.lt_s (local.get $hi) (local.get $lo)) (call $pp_on (local.get $hi) (local.get $dz) (local.get $cx) (local.get $r2))))
          (local.set $hi (i32.sub (local.get $hi) (i32.const 1))) (br $l)))
        (block $a (loop $l
          (br_if $a (i32.or (i32.ge_s (local.get $hi) (i32.const @(PP_N - 1)))
                            (i32.eqz (call $pp_on (i32.add (local.get $hi) (i32.const 1)) (local.get $dz) (local.get $cx) (local.get $r2)))))
          (!inc $hi) (br $l)))
        (if (i32.le_s (local.get $lo) (local.get $hi))
          (then
            (memory.fill (i32.add (i32.const @(PG_BIG + PP_CELLS)) (i32.shl (i32.add (i32.mul (local.get $j) (i32.const @PP_N)) (local.get $lo)) (i32.const 1)))
                         (i32.const 0) (i32.shl (i32.add (i32.sub (local.get $hi) (local.get $lo)) (i32.const 1)) (i32.const 1)))
            (local.set $total (i32.add (local.get $total) (i32.add (i32.sub (local.get $hi) (local.get $lo)) (i32.const 1)))))))))
  (i32.store (i32.const @(PG_H + PP_TOTAL)) (local.get $total))
  (local.set $n (i32.add (i32.const @PP_ORB0) (i32.div_u (local.get $n) (i32.const @PP_ORBN))))
  (if (i32.gt_u (local.get $n) (i32.const @PP_NORB)) (then (local.set $n (i32.const @PP_NORB))))
  (i32.store (i32.const @(PG_H + PP_ORBS)) (local.get $n))
  (!for $k (i32.const 0) (local.get $n)
    (local.set $o (i32.add (i32.const @(PG_S + PP_ORB)) (i32.mul (local.get $k) (i32.const @PP_ORB_SIZE))))
    (call $pp_spot (local.get $k) (i32.const 0))
    (local.set $z) (local.set $x)
    (!chk (local.get $x) 51 (local.get $k))
    (!chk (local.get $z) 52 (local.get $k))
    (f32.store (local.get $o) (local.get $x))
    (f32.store offset=4 (local.get $o) (local.get $z))
    (i32.store offset=8 (local.get $o) (i32.add (i32.const @PP_FIRST) (i32.mul (local.get $k) (i32.const @PP_STAGGER))))
    (i32.store offset=12 (local.get $o) (i32.const 0))))

;; A sunflower spiral over the middle of the disc (a respawn: a point of it at random).
(func $pp_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $x f32) (local $z f32)
  (call $p_disc (local.get $i) (local.get $n) (f32.mul (f32.load (i32.const @(PG_H + PP_RAD))) (f32.const @PP_SPAWN)))
  (local.set $z) (local.set $x)
  (local.get $x) (f32.const @PLAT_Y) (local.get $z))

(func $pp_start)
(func $pp_begin (param $p i32) (param $d i32))

;; The floor's top under (x, z) if that is on the disc.
(func $pp_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (local $r f32) (local $dx f32) (local $dz f32)
  (local.set $r (f32.load offset=@(PG_H + PP_RAD) (local.get $d)))
  (local.set $dx (f32.sub (local.get $x) (f32.load offset=@PG_CX (local.get $d))))
  (local.set $dz (f32.sub (local.get $z) (f32.load offset=@PG_CX (local.get $d))))
  (if (result f32) (i32.and (f32.ge (local.get $y) (f32.const @PLAT_Y))
                            (f32.le (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))) (f32.mul (local.get $r) (local.get $r))))
    (then (f32.const @PLAT_Y))
    (else (f32.const -1000))))

(func $pp_push (param $p i32) (param $d i32))

;; The paint of every slot marked in PP_WIPE gone from the grid (one pass for
;; them all), their counts zeroed, the marks cleared.
(func $pp_wipe
  (local $c i32) (local $a i32) (local $v i32) (local $p i32)
  (!for $c (i32.const 0) (i32.const @(PP_N * PP_N))
    (local.set $a (i32.add (i32.const @(PG_BIG + PP_CELLS)) (i32.shl (local.get $c) (i32.const 1))))
    (local.set $v (i32.load16_u (local.get $a)))
    (if (i32.and (i32.ne (local.get $v) (i32.const 0)) (i32.ne (local.get $v) (i32.const @PP_OFF)))
      (then
        (if (!ld u8 @(PG_S + PP_WIPE) (i32.sub (local.get $v) (i32.const 1)))
          (then (i32.store16 (local.get $a) (i32.const 0)))))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (if (!ld u8 @(PG_S + PP_WIPE) (local.get $p))
      (then
        (!st u16 @(PG_S + PP_CNT) (local.get $p) (i32.const 0))
        (!st u8 @(PG_S + PP_WIPE) (local.get $p) (i32.const 0))))))

;; Bomb j bursts over slot p: the burst's cells its own, the FX, and the bomb
;; to its next spot, landing PP_BACK ticks on.
(func $pp_splat (param $j i32) (param $p i32) (param $t i32) (param $s f32)
  (local $o i32) (local $b i32) (local $x f32) (local $z f32)
  (local.set $o (i32.add (i32.const @(PG_S + PP_ORB)) (i32.mul (local.get $j) (i32.const @PP_ORB_SIZE))))
  (local.set $x (f32.load (local.get $o)))
  (local.set $z (f32.load offset=4 (local.get $o)))
  (drop (call $pp_brush (local.get $p) (local.get $x) (local.get $z) (local.get $s)))
  (call $fx (i32.const 0) (i32.const @PP_FX_SPLAT) (local.get $p) (local.get $j) (local.get $x) (f32.const @PLAT_Y) (local.get $z) (local.get $s))
  (local.set $b (i32.add (i32.load offset=12 (local.get $o)) (i32.const 1)))
  (call $pp_spot (local.get $j) (local.get $b))
  (local.set $z) (local.set $x)
  (!chk (local.get $x) 51 (local.get $j))
  (!chk (local.get $z) 52 (local.get $j))
  (f32.store (local.get $o) (local.get $x))
  (f32.store offset=4 (local.get $o) (local.get $z))
  (i32.store offset=8 (local.get $o) (i32.add (local.get $t) (i32.const @PP_BACK)))
  (i32.store offset=12 (local.get $o) (local.get $b)))

;; The bombs down on the floor: each lands on its tick (its FX), and the
;; first ball in to reach it, in the tick's order, bursts it.
(func $pp_orbs (param $t i32) (param $s f32)
  (local $j i32) (local $o i32) (local $at i32) (local $k i32) (local $p i32) (local $pb i32)
  (local $rad f32) (local $dx f32) (local $dy f32) (local $dz f32) (local $lim f32)
  (!for $j (i32.const 0) (i32.load (i32.const @(PG_H + PP_ORBS)))
    (local.set $o (i32.add (i32.const @(PG_S + PP_ORB)) (i32.mul (local.get $j) (i32.const @PP_ORB_SIZE))))
    (local.set $at (i32.load offset=8 (local.get $o)))
    (if (i32.eq (local.get $t) (local.get $at))
      (then (call $fx (i32.const 0) (i32.const @PP_FX_ORB) (i32.const 255) (local.get $j)
                      (f32.load (local.get $o)) (f32.const @PLAT_Y) (f32.load offset=4 (local.get $o)) (f32.const 0))))
    (if (i32.ge_s (local.get $t) (local.get $at))
      (then
        (block $burst
          (!for $k (i32.const 0) (i32.const @NPLAYER)
            (local.set $p (call $pp_nth (local.get $k) (local.get $t)))
            (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
            (if (call $p_in (local.get $pb))
              (then
                (local.set $rad (call $b_rad (local.get $pb)))
                (local.set $dx (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (f32.load (local.get $o))))
                (local.set $dy (f32.sub (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (local.get $rad)) (f32.const @(+PLAT_Y + PP_ORB_Y))))
                (local.set $dz (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $pb)) (f32.load offset=4 (local.get $o))))
                (local.set $lim (f32.add (local.get $rad) (f32.const @PP_ORB_R)))
                (if (f32.lt (!dot3 (local.get $dx) (local.get $dy) (local.get $dz) (local.get $dx) (local.get $dy) (local.get $dz)) (f32.mul (local.get $lim) (local.get $lim)))
                  (then
                    (call $pp_splat (local.get $j) (local.get $p) (local.get $t) (local.get $s))
                    (br $burst)))))))))))

;; The leader, for its FX: the most cells (the one leading keeps it on a tie),
;; told at most once in PP_LEADGAP ticks.
(func $pp_lead (param $t i32)
  (local $p i32) (local $best i32) (local $bc i32) (local $c i32) (local $prev i32) (local $pb i32)
  (local.set $best (i32.const -1))
  (local.set $prev (i32.sub (i32.load (i32.const @(PG_H + PP_LEAD))) (i32.const 1)))
  (if (i32.ge_s (local.get $prev) (i32.const 0))
    (then
      (if (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $prev) (i32.const 6))) (i32.const @PF_LIVE))
        (then
          (local.set $best (local.get $prev))
          (local.set $bc (!ld u16 @(PG_S + PP_CNT) (local.get $prev)))))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (if (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $p) (i32.const 6))) (i32.const @PF_LIVE))
      (then
        (local.set $c (!ld u16 @(PG_S + PP_CNT) (local.get $p)))
        (if (i32.gt_u (local.get $c) (local.get $bc)) (then (local.set $best (local.get $p)) (local.set $bc (local.get $c)))))))
  (if (i32.or (i32.lt_s (local.get $best) (i32.const 0)) (i32.eq (local.get $best) (local.get $prev))) (then (return)))
  (if (i32.lt_u (i32.sub (local.get $t) (i32.load (i32.const @(PG_H + PP_LEADT)))) (i32.const @PP_LEADGAP)) (then (return)))
  (local.set $pb (i32.shl (local.get $best) (i32.const 6)))
  (call $fx (i32.const 0) (i32.const @PP_FX_LEAD) (local.get $best) (select (local.get $prev) (i32.const 255) (i32.ge_s (local.get $prev) (i32.const 0)))
            (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (!at f32 @(PLAYERS + P_PZ) (local.get $pb))
            (f32.convert_i32_u (local.get $bc)))
  (i32.store (i32.const @(PG_H + PP_LEAD)) (i32.add (local.get $best) (i32.const 1)))
  (i32.store (i32.const @(PG_H + PP_LEADT)) (local.get $t)))

;; A play tick: a slot that has left, or joined again, loses the paint still
;; under its number (a join zeroes the record, so a ball in whose PG_SCORE
;; isn't its count, which every tick here writes, is new in the slot); then
;; every ball on the floor paints, in the tick's order (two on one cell take
;; turns having it); the bombs; the counts into PG_SCORE; the lead.
(func $pp_tick
  (local $t i32) (local $p i32) (local $pb i32) (local $k i32) (local $c i32) (local $wipe i32) (local $rush i32) (local $r f32)
  (local.set $t (call $p_t (i32.const 0)))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (local.set $c (!ld u16 @(PG_S + PP_CNT) (local.get $p)))
    (if (i32.and (i32.ne (local.get $c) (i32.const 0))
                 (i32.or (i32.eqz (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_LIVE)))
                         (i32.ne (!at u16 @(PLAYERS + PG_SCORE) (local.get $pb)) (local.get $c))))
      (then (!st u8 @(PG_S + PP_WIPE) (local.get $p) (i32.const 1)) (local.set $wipe (i32.const 1)))))
  (if (local.get $wipe) (then (call $pp_wipe)))
  ;; the rush: the last PP_RUSH ticks paint wider
  (local.set $k (i32.sub (i32.load (i32.const @PG_LEN)) (i32.const @PP_RUSH)))
  (local.set $rush (i32.ge_s (local.get $t) (local.get $k)))
  (if (i32.eq (local.get $t) (local.get $k))
    (then (call $fx (i32.const 0) (i32.const @PP_FX_RUSH) (i32.const 255) (i32.const 0)
                    (f32.load (i32.const @PG_CX)) (f32.const @PLAT_Y) (f32.load (i32.const @PG_CX)) (f32.const @PP_RUSH_BRUSH))))
  (local.set $r (select (f32.const @PP_RUSH_BRUSH) (f32.const @PP_BRUSH) (local.get $rush)))
  (!for $k (i32.const 0) (i32.const @NPLAYER)
    (local.set $p (call $pp_nth (local.get $k) (local.get $t)))
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (if (i32.and (call $p_in (local.get $pb)) (i32.ne (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_GROUND)) (i32.const 0)))
      (then (drop (call $pp_brush (local.get $p) (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (!at f32 @(PLAYERS + P_PZ) (local.get $pb)) (local.get $r))))))
  (call $pp_orbs (local.get $t) (select (f32.const @PP_RUSH_SPLAT) (f32.const @PP_SPLAT) (local.get $rush)))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (if (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_LIVE))
      (then (!put u16 @(PLAYERS + PG_SCORE) (local.get $pb) (!ld u16 @(PG_S + PP_CNT) (local.get $p))))))
  (call $pp_lead (local.get $t)))

(func $pp_over (result i32) (i32.const 0))

(func $pp_out (param $p i32))
