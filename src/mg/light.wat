;; RED LIGHT: a long field over the sea, rails down its sides, the balls on a
;; grid behind the start line and a doll past the finish. Green: roll; the
;; doll sings, then turns round to face the field for the last RL_TURN ticks.
;; Red: once RL_GRACE is up, a ball still rolling faster than RL_VMAX across
;; the ground is caught (out of play, placed by how far it got). A ball whose
;; centre is over the finish line is out of play too, parked in the pen past
;; it, placed by the order it crossed in (balls over on one tick share it);
;; the first over leaves the rest RL_RUSH. Over when nobody is racing.
;;
;; The lights are a function of the tick into play and the round's seed
;; ($rl_when), worked out again by every client; but nothing the ball's move
;; does depends on them: the field (ground) and its rails (push) are fixed by
;; PG_H for the round, so the prediction is exact. Being caught and finishing
;; are the confirmed world's, a round trip late like any out; your own speed
;; is predicted exactly, so you see what the judge sees.

;; Cycle c's green and red, in ticks: from the round's seed. From cycle
;; RL_PEEK0, RL_PEEKS greens in 16 are a peek: she has barely turned away
;; before she turns back.
(func $rl_green (param $c i32) (result i32)
  (local $h i32)
  (local.set $h (call $p_seed (i32.add (i32.const @RL_KG) (local.get $c))))
  (if (i32.eqz (local.get $c)) (then (return (i32.add (i32.const @RL_G0A) (i32.rem_u (local.get $h) (i32.const @RL_G0N))))))
  (if (i32.and (i32.ge_u (local.get $c) (i32.const @RL_PEEK0)) (i32.lt_u (i32.shr_u (local.get $h) (i32.const 28)) (i32.const @RL_PEEKS)))
    (then (return (i32.add (i32.const @RL_PA) (i32.rem_u (local.get $h) (i32.const @RL_PN))))))
  (i32.add (i32.const @RL_GA) (i32.rem_u (local.get $h) (i32.const @RL_GN))))

(func $rl_red (param $c i32) (result i32)
  (i32.add (i32.const @RL_RA) (i32.rem_u (call $p_seed (i32.add (i32.const @RL_KR) (local.get $c))) (i32.const @RL_RN))))

;; The cycle on tick t into play: c, the tick its red starts, the tick it ends.
(func $rl_when (param $t i32) (result i32 i32 i32)
  (local $c i32) (local $s i32) (local $r i32) (local $e i32)
  (loop $next
    (local.set $r (i32.add (local.get $s) (call $rl_green (local.get $c))))
    (local.set $e (i32.add (local.get $r) (call $rl_red (local.get $c))))
    (if (i32.ge_u (local.get $t) (local.get $e))
      (then (local.set $s (local.get $e)) (!inc $c) (br $next))))
  (local.get $c)
  (local.get $r)
  (local.get $e))

;; How far a ball at z has got: cm from the back wall, under RL_SCORE_FIN's.
(func $rl_progress (param $z f32) (result i32)
  (local $v i32)
  (local.set $v (i32.trunc_sat_f32_s (f32.mul (f32.sub (f32.load (i32.const @(PG_H + RL_ZB))) (local.get $z)) (f32.const 100))))
  (select (i32.const 0) (select (i32.const @RL_SCORE_MAX) (local.get $v) (i32.gt_s (local.get $v) (i32.const @RL_SCORE_MAX)))
          (i32.lt_s (local.get $v) (i32.const 0))))

;; Spot k in rows of cols, RL_SP apart, centred on the field, the first row at
;; z0 and the rest on toward dz (+1 back from the start line, -1 on past the finish).
(func $rl_spot (param $k i32) (param $n i32) (param $z0 f32) (param $dz f32) (result f32 f32)
  (local $cols i32) (local $row i32) (local $col i32) (local $in i32)
  (local.set $cols (i32.load (i32.const @(PG_H + RL_COLS))))
  (local.set $row (i32.div_u (local.get $k) (local.get $cols)))
  (local.set $col (i32.rem_u (local.get $k) (local.get $cols)))
  ;; a row not full is centred
  (local.set $in (i32.sub (local.get $n) (i32.mul (local.get $row) (local.get $cols))))
  (if (i32.gt_u (local.get $in) (local.get $cols)) (then (local.set $in (local.get $cols))))
  (!madd (f32.sub (f32.convert_i32_u (local.get $col)) (f32.mul (f32.convert_i32_u (i32.sub (local.get $in) (i32.const 1))) (f32.const 0.5)))
         (f32.const @RL_SP) (f32.load (i32.const @PG_CX)))
  (!madd (f32.mul (f32.convert_i32_u (local.get $row)) (f32.const @RL_SP)) (local.get $dz) (local.get $z0)))

;; The field for n balls, its lines and walls in PG_H, and the grid's order:
;; the fewest party points in front, ties by a per-round hash of the slot.
;; Scoring by place, nobody comes back; no hops; braking hard (RL_IDLE).
(func $rl_setup (param $n i32)
  (local $hw f32) (local $cx f32) (local $zs f32) (local $cols i32) (local $rows i32)
  (local $p i32) (local $k i32) (local $i i32) (local $j i32) (local $key i32) (local $rank i32)
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (local.set $hw (f32.mul (f32.min (!madd (f32.convert_i32_u (local.get $n)) (f32.const @RL_WK) (f32.const @RL_W0)) (f32.const @RL_WMAX)) (f32.const 0.5)))
  (!chk (local.get $hw) 51 (local.get $n))
  ;; as many a row as fit RL_SP apart, RL_EDGE in from either rail
  (local.set $cols (i32.add (i32.trunc_sat_f32_u (f32.div (f32.sub (f32.add (local.get $hw) (local.get $hw)) (f32.const @(2 * RL_EDGE))) (f32.const @RL_SP))) (i32.const 1)))
  (local.set $rows (i32.div_u (i32.add (local.get $n) (i32.sub (local.get $cols) (i32.const 1))) (local.get $cols)))
  (if (i32.eqz (local.get $rows)) (then (local.set $rows (i32.const 1))))
  (local.set $zs (f32.add (local.get $cx) (f32.const @(RL_FIELD / 2))))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_SCORE))
  (i32.store (i32.const @PG_LEN) (i32.const @RL_LEN))
  (f32.store (i32.const @PG_SIZE) (local.get $hw))
  (f32.store (i32.const @PG_IDLE) (f32.const @RL_IDLE))
  (f32.store (i32.const @PG_HOP) (f32.const 0))
  (i32.store (i32.const @PG_RESPAWN) (i32.const 0x7fffffff))
  (f32.store (i32.const @(PG_H + RL_HW)) (local.get $hw))
  (f32.store (i32.const @(PG_H + RL_ZS)) (local.get $zs))
  (f32.store (i32.const @(PG_H + RL_ZF)) (f32.sub (local.get $cx) (f32.const @(RL_FIELD / 2))))
  (f32.store (i32.const @(PG_H + RL_ZB))
    (f32.add (local.get $zs) (!madd (f32.convert_i32_u (i32.sub (local.get $rows) (i32.const 1))) (f32.const @RL_SP) (f32.const @(2 * RL_GRID0)))))
  (i32.store (i32.const @(PG_H + RL_COLS)) (local.get $cols))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (if (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $p) (i32.const 6))) (i32.const @PF_LIVE))
      (then
        (!st i32 @(PG_S + RL_KEY) (local.get $k)
          (i32.or (i32.shl (!at u16 @(PLAYERS + PG_PTS) (i32.shl (local.get $p) (i32.const 6))) (i32.const 16))
                  (i32.and (call $p_seed (i32.add (i32.const @RL_KGRID) (local.get $p))) (i32.const 0xffff))))
        (!inc $k))))
  (!for $i (i32.const 0) (local.get $k)
    (local.set $key (!ld i32 @(PG_S + RL_KEY) (local.get $i)))
    (local.set $rank (i32.const 0))
    (!for $j (i32.const 0) (local.get $k)
      (if (i32.or (i32.lt_u (!ld i32 @(PG_S + RL_KEY) (local.get $j)) (local.get $key))
                  (i32.and (i32.eq (!ld i32 @(PG_S + RL_KEY) (local.get $j)) (local.get $key)) (i32.lt_u (local.get $j) (local.get $i))))
        (then (!inc $rank))))
    (!st u16 @(PG_S + RL_RANK) (local.get $i) (local.get $rank))))

;; Ball i of n on its spot on the grid; a ball coming in late (n 1024) at the
;; back, across it by i.
(func $rl_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $x f32) (local $z f32) (local $hw f32)
  (if (i32.ge_u (local.get $n) (i32.const 1024))
    (then
      (local.set $hw (f32.sub (f32.load (i32.const @(PG_H + RL_HW))) (f32.const @RL_EDGE)))
      (return
        (!madd (f32.mul (f32.convert_i32_u (i32.and (local.get $i) (i32.const 1023))) (f32.const 0.001953125)) ;; 2^-9: [0, 2) across
               (local.get $hw) (f32.sub (f32.load (i32.const @PG_CX)) (local.get $hw)))
        (f32.const @PLAT_Y)
        (f32.sub (f32.load (i32.const @(PG_H + RL_ZB))) (f32.const @RL_GRID0)))))
  (call $rl_spot (!ld u16 @(PG_S + RL_RANK) (local.get $i)) (local.get $n)
                 (f32.add (f32.load (i32.const @(PG_H + RL_ZS))) (f32.const @RL_GRID0)) (f32.const 1))
  (local.set $z) (local.set $x)
  (local.get $x) (f32.const @PLAT_Y) (local.get $z))

(func $rl_start)
(func $rl_begin (param $p i32) (param $d i32))

;; The field's floor, from the back wall to the yard's end, rail to rail and a
;; little past them: the rails keep every ball on it.
(func $rl_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (if (f32.gt (f32.const @PLAT_Y) (local.get $y)) (then (return (f32.const -1000))))
  (if (result f32)
      (i32.and (f32.le (f32.abs (f32.sub (local.get $x) (f32.load offset=@PG_CX (local.get $d))))
                       (f32.add (f32.load offset=@(PG_H + RL_HW) (local.get $d)) (f32.const 2)))
               (i32.and (f32.le (local.get $z) (f32.add (f32.load offset=@(PG_H + RL_ZB) (local.get $d)) (f32.const 2)))
                        (f32.ge (local.get $z) (f32.sub (f32.load offset=@(PG_H + RL_ZF) (local.get $d)) (f32.const @RL_YARD)))))
    (then (f32.const @PLAT_Y))
    (else (f32.const -1000))))

;; The rails, the back wall and the yard's far end: a ball over one is put
;; back against it, and what it had into it given back as RL_BOUNCE.
(func $rl_push (param $p i32) (param $d i32)
  (local $pb i32) (local $r f32) (local $x f32) (local $z f32) (local $vx f32) (local $vz f32) (local $lo f32) (local $hi f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (local.set $r (call $b_rad (local.get $pb)))
  (local.set $x (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (local.set $z (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (local.set $vx (!at f32 @(PLAYERS + P_VX) (local.get $pb)))
  (local.set $vz (!at f32 @(PLAYERS + P_VZ) (local.get $pb)))
  (local.set $hi (f32.sub (f32.load offset=@(PG_H + RL_HW) (local.get $d)) (local.get $r)))
  (local.set $lo (f32.sub (f32.load offset=@PG_CX (local.get $d)) (local.get $hi)))
  (local.set $hi (f32.add (f32.load offset=@PG_CX (local.get $d)) (local.get $hi)))
  (if (f32.lt (local.get $x) (local.get $lo))
    (then
      (local.set $x (local.get $lo))
      (if (f32.lt (local.get $vx) (f32.const 0)) (then (local.set $vx (f32.mul (local.get $vx) (f32.const @(-RL_BOUNCE))))))))
  (if (f32.gt (local.get $x) (local.get $hi))
    (then
      (local.set $x (local.get $hi))
      (if (f32.gt (local.get $vx) (f32.const 0)) (then (local.set $vx (f32.mul (local.get $vx) (f32.const @(-RL_BOUNCE))))))))
  (local.set $hi (f32.sub (f32.load offset=@(PG_H + RL_ZB) (local.get $d)) (local.get $r)))
  (local.set $lo (f32.add (f32.sub (f32.load offset=@(PG_H + RL_ZF) (local.get $d)) (f32.const @RL_YARD)) (local.get $r)))
  (if (f32.gt (local.get $z) (local.get $hi))
    (then
      (local.set $z (local.get $hi))
      (if (f32.gt (local.get $vz) (f32.const 0)) (then (local.set $vz (f32.mul (local.get $vz) (f32.const @(-RL_BOUNCE))))))))
  (if (f32.lt (local.get $z) (local.get $lo))
    (then
      (local.set $z (local.get $lo))
      (if (f32.lt (local.get $vz) (f32.const 0)) (then (local.set $vz (f32.mul (local.get $vz) (f32.const @(-RL_BOUNCE))))))))
  (!chk (local.get $x) 52 (local.get $p))
  (!chk (local.get $z) 53 (local.get $p))
  (!chk (local.get $vx) 54 (local.get $p))
  (!chk (local.get $vz) 55 (local.get $p))
  (!put f32 @(PLAYERS + P_PX) (local.get $pb) (local.get $x))
  (!put f32 @(PLAYERS + P_PZ) (local.get $pb) (local.get $z))
  (!put f32 @(PLAYERS + P_VX) (local.get $pb) (local.get $vx))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (local.get $vz)))

;; Every ball racing, in slot order: over the finish line, out of play into
;; the pen (its order the balls over before this tick, so a tick's finishers
;; share it; the first over cuts the clock to RL_RUSH); else, on red once
;; RL_GRACE is up, caught if it rolls faster than RL_VMAX across the ground
;; (credit to whoever bumped it lately). On red a bump has no kick; while
;; she looks there are none.
(func $rl_tick
  (local $t i32) (local $tick i32) (local $c i32) (local $r0 i32) (local $e i32) (local $judge i32)
  (local $p i32) (local $pb i32) (local $fin0 i32) (local $fin i32) (local $x f32) (local $z f32) (local $vx f32) (local $vz f32)
  (local $f i32)
  (local.set $t (call $p_t (i32.const 0)))
  (local.set $tick (i32.load (i32.const @HDR_TICK)))
  (call $rl_when (local.get $t))
  (local.set $e) (local.set $r0) (local.set $c)
  (local.set $judge (i32.and (i32.ge_u (local.get $t) (i32.add (local.get $r0) (i32.const @RL_GRACE))) (i32.lt_u (local.get $t) (local.get $e))))
  (local.set $fin0 (i32.load (i32.const @(PG_H + RL_FIN))))
  (local.set $fin (local.get $fin0))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (if (call $p_in (local.get $pb))
      (then
        (local.set $x (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
        (local.set $z (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
        (local.set $vx (!at f32 @(PLAYERS + P_VX) (local.get $pb)))
        (local.set $vz (!at f32 @(PLAYERS + P_VZ) (local.get $pb)))
        (if (f32.lt (local.get $z) (f32.load (i32.const @(PG_H + RL_ZF))))
          (then
            (if (i32.eqz (local.get $fin))
              (then (i32.store (i32.const @HDR_UNTIL)
                      (select (i32.add (local.get $tick) (i32.const @RL_RUSH)) (i32.load (i32.const @HDR_UNTIL))
                              (i32.lt_u (i32.add (local.get $tick) (i32.const @RL_RUSH)) (i32.load (i32.const @HDR_UNTIL)))))))
            (!put u8 @(PLAYERS + P_FL) (local.get $pb) (i32.or (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_DEAD)))
            (!put i32 @(PLAYERS + B_OUTAT) (local.get $pb) (local.get $tick))
            (!put u16 @(PLAYERS + PG_SCORE) (local.get $pb) (i32.sub (i32.const @RL_SCORE_FIN) (local.get $fin0)))
            (!put i32 @(PLAYERS + PG_M) (local.get $pb) (i32.or (i32.const @RL_M_FIN) (i32.add (local.get $fin0) (i32.const 1))))
            (call $fx (i32.const 0) (i32.const @RL_FX_FINISH) (local.get $p) (i32.add (local.get $fin0) (i32.const 1))
                      (local.get $x) (f32.const @PLAT_Y) (local.get $z) (f32.mul (f32.convert_i32_u (local.get $t)) (f32.const @DT)))
            ;; into the pen, the next spot in it, still
            (call $rl_spot (local.get $fin) (i32.const 0x7fffffff) (f32.sub (f32.load (i32.const @(PG_H + RL_ZF))) (f32.const @RL_PEN0)) (f32.const -1))
            (local.set $z) (local.set $x)
            (!chk (local.get $x) 56 (local.get $p))
            (!chk (local.get $z) 57 (local.get $p))
            (call $p_place (local.get $p) (local.get $x) (f32.const @PLAT_Y) (local.get $z))
            (!put u8 @(PLAYERS + P_FL) (local.get $pb) (i32.const @(PF_LIVE | PF_GROUND | PF_DEAD)))
            (!inc $fin))
          (else
            (if (i32.and (local.get $judge)
                         (f32.gt (!madd (local.get $vx) (local.get $vx) (f32.mul (local.get $vz) (local.get $vz))) (f32.const @RL_VMAX2)))
              (then
                (!put u8 @(PLAYERS + P_FL) (local.get $pb) (i32.or (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_DEAD)))
                (!put i32 @(PLAYERS + B_OUTAT) (local.get $pb) (local.get $tick))
                (!put f32 @(PLAYERS + P_VX) (local.get $pb) (f32.const 0))
                (!put f32 @(PLAYERS + P_VY) (local.get $pb) (f32.const 0))
                (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (f32.const 0))
                (!put u16 @(PLAYERS + PG_SCORE) (local.get $pb) (call $rl_progress (local.get $z)))
                (!put i32 @(PLAYERS + PG_M) (local.get $pb) (i32.or (i32.const @RL_M_CAUGHT) (local.get $c)))
                (i32.store (i32.const @(PG_H + RL_OUT)) (i32.add (i32.load (i32.const @(PG_H + RL_OUT))) (i32.const 1)))
                (call $fx (i32.const 0) (i32.const @RL_FX_CAUGHT) (local.get $p) (call $p_credit (local.get $p))
                          (local.get $x) (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (local.get $z)
                          (f32.sub (local.get $z) (f32.load (i32.const @(PG_H + RL_ZF))))))))))))
  (i32.store (i32.const @(PG_H + RL_FIN)) (local.get $fin))
  ;; on red a bump has no kick (PGF_NOKICK), only what the balls bring: a ram
  ;; still shoves its momentum on, but two all but still that touch don't kick
  ;; each other into being caught; and while she looks the balls don't bump.
  ;; For the next tick, both back with the green
  (local.set $t (i32.add (local.get $t) (i32.const 1)))
  (local.set $f (i32.and (i32.load (i32.const @PG_FLAGS)) (i32.const @(~(PGF_BUMPS | PGF_NOKICK)))))
  (if (i32.eqz (i32.and (i32.ge_u (local.get $t) (i32.add (local.get $r0) (i32.const @RL_GRACE))) (i32.lt_u (local.get $t) (local.get $e))))
    (then (local.set $f (i32.or (local.get $f) (i32.const @PGF_BUMPS)))))
  (if (i32.and (i32.ge_u (local.get $t) (local.get $r0)) (i32.lt_u (local.get $t) (local.get $e)))
    (then (local.set $f (i32.or (local.get $f) (i32.const @PGF_NOKICK)))))
  (i32.store (i32.const @PG_FLAGS) (local.get $f)))

;; Over when nobody is racing. On the round's last tick (this, or the
;; clock's), the balls still racing are scored by how far they got: kept out
;; of their records till then, so the prediction's copy of them stays the
;; confirmed one's.
(func $rl_over (result i32)
  (local $p i32) (local $pb i32) (local $end i32)
  (local.set $end (i32.eqz (i32.load (i32.const @BH_LEFT))))
  (if (i32.or (local.get $end) (i32.ge_u (i32.load (i32.const @HDR_TICK)) (i32.load (i32.const @HDR_UNTIL))))
    (then
      (!for $p (i32.const 0) (i32.const @NPLAYER)
        (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
        (if (i32.eq (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE))
          (then (!put u16 @(PLAYERS + PG_SCORE) (local.get $pb) (call $rl_progress (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))))))))
  (local.get $end))

(func $rl_out (param $p i32))
