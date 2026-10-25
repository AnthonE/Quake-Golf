;; DRUM ROLL: a row of big drums over the sea, DR_R m in radius, their axes
;; level along x and DR_P apart across z, the gaps between them narrow. Every
;; drum spins, neighbours the opposite way, faster as the round goes, and as
;; each phase after the first begins one of them reverses. A ball on a drum
;; is carried with its surface (its drag is the surface's: it stands still
;; on it with no keys) and pulled down the slope a little, so it rides toward
;; a gap unless it rolls against the spin; past DR_ZS round from the top, or
;; off an end, it falls. The drums are slats, DR_N round and cells DR_SEG
;; long, and cells open into slots as the round goes, going round with their
;; drum: a slot coming under a ball drops it in. The last ball on wins.
;;
;; All of it is the tables setup lays from the PRNG before the countdown:
;; each drum's angle and spin by phase (PG_S) and the tick each cell opens
;; (PG_BIG), read against bank d's own tick, so ground and push give the
;; prediction exactly what the confirmed world will. A cell opens only once
;; it's round under its drum, so a slot is always seen coming up the far
;; side and over the top. Only ball against ball is late, as everywhere.

;; Drum i's axis, z, on bank d.
(func $dr_za (param $d i32) (param $i i32) (result f32)
  (!madd (f32.convert_i32_u (local.get $i)) (f32.const @DR_P) (f32.load offset=@(PG_H + DR_Z0) (local.get $d))))

;; The drum whose axis is nearest z across, on bank d.
(func $dr_drum (param $d i32) (param $z f32) (result i32)
  (local $i i32)
  (local.set $i (i32.trunc_sat_f32_s (f32.nearest (f32.div (f32.sub (local.get $z) (f32.load offset=@(PG_H + DR_Z0) (local.get $d))) (f32.const @DR_P)))))
  (if (i32.lt_s (local.get $i) (i32.const 0)) (then (local.set $i (i32.const 0))))
  (if (i32.ge_s (local.get $i) (i32.load offset=@(PG_H + DR_K) (local.get $d)))
    (then (local.set $i (i32.sub (i32.load offset=@(PG_H + DR_K) (local.get $d)) (i32.const 1)))))
  (local.get $i))

;; The way (s, c) points from the top round toward +z, in 2^-32 turn (i32,
;; wrapping): atan2 from the octant and a polynomial in add and multiply
;; only (A&S 4.4.49, 1e-5 rad), so every engine gets the same bits.
(func $dr_turn (param $s f32) (param $c f32) (result i32)
  (local $ax f32) (local $ay f32) (local $mx f32) (local $a f32) (local $a2 f32) (local $r f32)
  (local.set $ax (f32.abs (local.get $c)))
  (local.set $ay (f32.abs (local.get $s)))
  (local.set $mx (f32.max (local.get $ax) (local.get $ay)))
  (if (f32.gt (local.get $mx) (f32.const 0))
    (then (local.set $a (f32.div (f32.min (local.get $ax) (local.get $ay)) (local.get $mx)))))
  (local.set $a2 (f32.mul (local.get $a) (local.get $a)))
  (local.set $r (f32.mul (local.get $a)
    (!madd (local.get $a2)
      (!madd (local.get $a2)
        (!madd (local.get $a2)
          (!madd (local.get $a2) (f32.const 0.0208351) (f32.const -0.0851330))
          (f32.const 0.1801410))
        (f32.const -0.3302995))
      (f32.const 0.9998660))))
  (if (f32.gt (local.get $ay) (local.get $ax)) (then (local.set $r (f32.sub (f32.const 1.5707964) (local.get $r)))))
  (if (f32.lt (local.get $c) (f32.const 0)) (then (local.set $r (f32.sub (f32.const 3.1415927) (local.get $r)))))
  (if (f32.lt (local.get $s) (f32.const 0)) (then (local.set $r (f32.neg (local.get $r)))))
  ;; radians to 2^-16 turn, then 2^-32
  (i32.shl (i32.trunc_sat_f32_s (f32.mul (local.get $r) (f32.const 10430.378))) (i32.const 16)))

;; Drum i's phase-table index for tick t into play (the last phase runs on).
(func $dr_q (param $i i32) (param $t i32) (result i32)
  (local $j i32)
  (local.set $j (i32.div_u (local.get $t) (i32.const @DR_PH)))
  (if (i32.gt_u (local.get $j) (i32.const @(DR_NPH - 1))) (then (local.set $j (i32.const @(DR_NPH - 1)))))
  (i32.add (i32.mul (local.get $i) (i32.const @DR_NPH)) (local.get $j)))

;; Drum i's angle on tick t into play, 2^-32 turn: its phase's start and its
;; spin since (i32 wraps, and a turn is 2^32).
(func $dr_phi (param $i i32) (param $t i32) (result i32)
  (local $q i32)
  (local.set $q (call $dr_q (local.get $i) (local.get $t)))
  (i32.add (!ld i32 @(PG_S + DR_ANG) (local.get $q))
           (i32.mul (!ld i32 @(PG_S + DR_RATE) (local.get $q))
                    (i32.sub (local.get $t) (i32.mul (i32.rem_u (local.get $q) (i32.const @DR_NPH)) (i32.const @DR_PH))))))

;; Drum i's surface on tick t into play, m/s (+: its top toward +z).
(func $dr_speed (param $i i32) (param $t i32) (result f32)
  (f32.mul (f32.convert_i32_s (!ld i32 @(PG_S + DR_RATE) (call $dr_q (local.get $i) (local.get $t)))) (f32.const @DR_U)))

;; Is drum i's shell a slot the way (s, c) points from its axis, at x along
;; it, on bank d's tick? The cell along x, the slat round from the drum's own
;; angle 0, its tick.
(func $dr_hole (param $d i32) (param $i i32) (param $x f32) (param $s f32) (param $c f32) (result i32)
  (local $m i32) (local $t i32) (local $a i32)
  (local.set $m (i32.trunc_sat_f32_s (f32.div (f32.sub (local.get $x) (f32.load offset=@(PG_H + DR_X0) (local.get $d))) (f32.const @DR_SEG))))
  (if (i32.lt_s (local.get $m) (i32.const 0)) (then (local.set $m (i32.const 0))))
  (if (i32.ge_s (local.get $m) (i32.load offset=@(PG_H + DR_M) (local.get $d)))
    (then (local.set $m (i32.sub (i32.load offset=@(PG_H + DR_M) (local.get $d)) (i32.const 1)))))
  (local.set $t (call $p_t (local.get $d)))
  (local.set $a (i32.sub (call $dr_turn (local.get $s) (local.get $c)) (call $dr_phi (local.get $i) (local.get $t))))
  (i32.ge_u (local.get $t)
    (!ld u16 @(PG_BIG + DR_CELLS)
      (i32.add (i32.mul (i32.add (i32.mul (local.get $i) (i32.const @DR_MMAX)) (local.get $m)) (i32.const @DR_N))
               (i32.shr_u (i32.mul (i32.shr_u (local.get $a) (i32.const 16)) (i32.const @DR_N)) (i32.const 16))))))

;; The first tick from t on that slat c of drum i has its middle round under
;; the drum (DR_LO to DR_HI from the top), worked phase by phase: where it
;; is, else the ticks till it gets there at the phase's spin, else the next
;; phase. 0xffff if that's past what a u16 holds.
(func $dr_under (param $i i32) (param $c i32) (param $t i32) (result i32)
  (local $k i32) (local $q i32) (local $r i32) (local $a i32) (local $end i32) (local $n i64) (local $ar i64)
  (!for $k (i32.const 0) (i32.const @(DR_NPH + 4))
    (if (i32.ge_u (local.get $t) (i32.const 0xfffe)) (then (return (i32.const 0xffff))))
    (local.set $q (call $dr_q (local.get $i) (local.get $t)))
    (local.set $r (!ld i32 @(PG_S + DR_RATE) (local.get $q)))
    (local.set $a (i32.add (call $dr_phi (local.get $i) (local.get $t))
                           (i32.mul (i32.add (i32.shl (local.get $c) (i32.const 1)) (i32.const 1)) (i32.const @(Math.floor(2 ** 32 / (2 * DR_N)))))))
    (if (i32.lt_u (i32.sub (local.get $a) (i32.const @DR_LO)) (i32.const @(DR_HI - DR_LO))) (then (return (local.get $t))))
    (if (i32.eqz (local.get $r)) (then (return (i32.const 0xffff))))
    ;; how far round to the near edge of the span, the way it turns, and the ticks that takes
    (local.set $ar (i64.extend_i32_u (select (local.get $r) (i32.sub (i32.const 0) (local.get $r)) (i32.gt_s (local.get $r) (i32.const 0)))))
    (local.set $n (i64.div_u (i64.add (i64.extend_i32_u (select (i32.sub (i32.const @DR_LO) (local.get $a))
                                                                (i32.sub (local.get $a) (i32.const @(DR_HI - 1)))
                                                                (i32.gt_s (local.get $r) (i32.const 0))))
                                      (i64.sub (local.get $ar) (i64.const 1)))
                             (local.get $ar)))
    (local.set $end (select (i32.const 0x7fffffff) (i32.mul (i32.add (i32.div_u (local.get $t) (i32.const @DR_PH)) (i32.const 1)) (i32.const @DR_PH))
                            (i32.ge_u (i32.div_u (local.get $t) (i32.const @DR_PH)) (i32.const @(DR_NPH - 1)))))
    (if (i64.lt_u (i64.add (i64.extend_i32_u (local.get $t)) (local.get $n)) (i64.extend_i32_u (local.get $end)))
      (then (local.set $t (i32.add (local.get $t) (i32.wrap_i64 (local.get $n)))))
      (else (local.set $t (local.get $end)))))
  (select (local.get $t) (i32.const 0xffff) (i32.lt_u (local.get $t) (i32.const 0xffff))))

;; The drums for n balls: as many as the crowd needs, long enough for its
;; share each; the round's knobs; the spin's tables and every cell's tick.
;; The slots open at an even rate, and the faster the drums the more often
;; each comes round.
(func $dr_setup (param $n i32)
  (local $k i32) (local $m i32) (local $rows i32) (local $i i32) (local $j i32) (local $c i32) (local $q i32)
  (local $sgn i32) (local $flip i32) (local $dir i32) (local $t i32) (local $len f32) (local $u f32)
  (local.set $k (i32.add (i32.const 2) (i32.trunc_sat_f32_u (f32.div (f32.sqrt (f32.convert_i32_u (local.get $n))) (f32.const @DR_KN)))))
  (if (i32.gt_u (local.get $k) (i32.const @DR_KMAX)) (then (local.set $k (i32.const @DR_KMAX))))
  ;; rows of two along each, its share of the crowd
  (local.set $rows (i32.shr_u (i32.add (i32.div_u (i32.add (local.get $n) (i32.sub (local.get $k) (i32.const 1))) (local.get $k)) (i32.const 1)) (i32.const 1)))
  (if (i32.eqz (local.get $rows)) (then (local.set $rows (i32.const 1))))
  (local.set $m (i32.trunc_sat_f32_u (f32.ceil (f32.div (!madd (f32.convert_i32_u (i32.sub (local.get $rows) (i32.const 1))) (f32.const @DR_SPX) (f32.const @(2 * DR_ENDS)))
                                                        (f32.const @DR_SEG)))))
  (if (i32.lt_u (local.get $m) (i32.const @DR_MMIN)) (then (local.set $m (i32.const @DR_MMIN))))
  (if (i32.gt_u (local.get $m) (i32.const @DR_MMAX)) (then (local.set $m (i32.const @DR_MMAX))))
  (local.set $len (f32.mul (f32.convert_i32_u (local.get $m)) (f32.const @DR_SEG)))
  (!chk (local.get $len) 181 (local.get $n))
  (i32.store (i32.const @(PG_H + DR_K)) (local.get $k))
  (i32.store (i32.const @(PG_H + DR_M)) (local.get $m))
  (f32.store (i32.const @(PG_H + DR_X0)) (f32.sub (f32.load (i32.const @PG_CX)) (f32.mul (local.get $len) (f32.const 0.5))))
  (f32.store (i32.const @(PG_H + DR_X1)) (f32.add (f32.load (i32.const @(PG_H + DR_X0))) (local.get $len)))
  (f32.store (i32.const @(PG_H + DR_Z0))
    (f32.sub (f32.load (i32.const @PG_CX)) (f32.mul (f32.convert_i32_u (i32.sub (local.get $k) (i32.const 1))) (f32.const @(DR_P / 2)))))
  (f32.store (i32.const @(PG_H + DR_YA)) (f32.const @(PLAT_Y - DR_R)))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_OUT))
  (i32.store (i32.const @PG_LEN) (i32.const @DR_LEN))
  (f32.store (i32.const @PG_FLOOR) (f32.const @(PLAT_Y - DR_R)))
  (f32.store (i32.const @PG_SIZE)
    (f32.max (f32.mul (local.get $len) (f32.const 0.5))
             (!madd (f32.convert_i32_u (i32.sub (local.get $k) (i32.const 1))) (f32.const @(DR_P / 2)) (f32.const @DR_RC))))
  (f32.store (i32.const @PG_ACC) (f32.const @DR_ACC))
  (f32.store (i32.const @PG_DRAG) (f32.const @DR_DRAG))
  (f32.store (i32.const @PG_IDLE) (f32.const @DR_IDLE))
  (f32.store (i32.const @PG_HOP) (f32.const @DR_HOP))
  ;; the spin: each drum's speed and angle, the first's way from the PRNG and its neighbours' opposite;
  ;; then phase by phase, faster, one reversing as each after the first begins
  (local.set $sgn (select (i32.const 1) (i32.const -1) (i32.and (call $rand) (i32.const 1))))
  (!for $i (i32.const 0) (local.get $k)
    (!st f32 @(PG_S + DR_BASE) (local.get $i) (!madd (call $p_unit) (f32.const @DR_VR) (f32.const @DR_V0)))
    (!st i32 @(PG_S + DR_ANG) (i32.mul (local.get $i) (i32.const @DR_NPH)) (call $rand)))
  (!for $j (i32.const 0) (i32.const @DR_NPH)
    (local.set $flip (i32.const -1))
    (if (local.get $j) (then (local.set $flip (i32.rem_u (call $rand) (local.get $k)))))
    (!for $i (i32.const 0) (local.get $k)
      (local.set $q (i32.add (i32.mul (local.get $i) (i32.const @DR_NPH)) (local.get $j)))
      (if (local.get $j)
        (then
          (local.set $dir (select (i32.const 1) (i32.const -1) (i32.gt_s (!ld i32 @(PG_S + DR_RATE) (i32.sub (local.get $q) (i32.const 1))) (i32.const 0))))
          (if (i32.eq (local.get $i) (local.get $flip)) (then (local.set $dir (i32.sub (i32.const 0) (local.get $dir)))))
          (!st i32 @(PG_S + DR_ANG) (local.get $q)
            (i32.add (!ld i32 @(PG_S + DR_ANG) (i32.sub (local.get $q) (i32.const 1)))
                     (i32.mul (!ld i32 @(PG_S + DR_RATE) (i32.sub (local.get $q) (i32.const 1))) (i32.const @DR_PH)))))
        (else (local.set $dir (select (i32.sub (i32.const 0) (local.get $sgn)) (local.get $sgn) (i32.and (local.get $i) (i32.const 1))))))
      (!st i32 @(PG_S + DR_RATE) (local.get $q)
        (i32.mul (local.get $dir)
                 (i32.trunc_sat_f32_s (f32.mul (f32.mul (!ld f32 @(PG_S + DR_BASE) (local.get $i)) (!madd (f32.convert_i32_u (local.get $j)) (f32.const @DR_VK) (f32.const 1)))
                                               (f32.const @DR_RT)))))))
  ;; the slots: a share of the cells, evenly through the round, each once it's round under its drum
  (!for $i (i32.const 0) (local.get $k)
    (!for $j (i32.const 0) (local.get $m)
      (!for $c (i32.const 0) (i32.const @DR_N)
        (local.set $u (call $p_unit))
        (local.set $t (i32.const 0xffff))
        (if (f32.lt (local.get $u) (f32.const @DR_SLOTF))
          (then
            (local.set $t (i32.add (i32.const @DR_SLOT0)
                                   (i32.trunc_sat_f32_u (f32.mul (local.get $u) (f32.const @((DR_LEN - DR_SLOT0) / DR_SLOTF))))))
            (local.set $t (call $dr_under (local.get $i) (local.get $c) (local.get $t)))))
        (!st u16 @(PG_BIG + DR_CELLS)
          (i32.add (i32.mul (i32.add (i32.mul (local.get $i) (i32.const @DR_MMAX)) (local.get $j)) (i32.const @DR_N)) (local.get $c))
          (local.get $t))))))

;; Ball i of n on the drums' tops: dealt round them, on each in rows of two
;; DR_SPX apart along it, DR_SPZ either side of the top (a last one alone on
;; it), the rows centred; its bottom on the surface as ground has it there.
(func $dr_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $k i32) (local $dr i32) (local $j i32) (local $cnt i32) (local $rows i32) (local $row i32)
  (local $dz f32) (local $za f32) (local $z f32)
  (local.set $k (i32.load (i32.const @(PG_H + DR_K))))
  (local.set $dr (i32.rem_u (local.get $i) (local.get $k)))
  (local.set $j (i32.div_u (local.get $i) (local.get $k)))
  (local.set $cnt (i32.add (i32.div_u (local.get $n) (local.get $k)) (i32.lt_u (local.get $dr) (i32.rem_u (local.get $n) (local.get $k)))))
  (local.set $rows (i32.shr_u (i32.add (local.get $cnt) (i32.const 1)) (i32.const 1)))
  (local.set $row (i32.shr_u (local.get $j) (i32.const 1)))
  (local.set $dz (select (f32.const @DR_SPZ) (f32.const @(-DR_SPZ)) (i32.and (local.get $j) (i32.const 1))))
  (if (i32.and (i32.eq (local.get $row) (i32.sub (local.get $rows) (i32.const 1))) (i32.and (local.get $cnt) (i32.const 1)))
    (then (local.set $dz (f32.const 0))))
  (local.set $za (call $dr_za (i32.const 0) (local.get $dr)))
  (local.set $z (f32.add (local.get $za) (local.get $dz)))
  (local.set $dz (f32.sub (local.get $z) (local.get $za)))
  (!madd (f32.sub (f32.convert_i32_u (local.get $row)) (f32.mul (f32.convert_i32_u (i32.sub (local.get $rows) (i32.const 1))) (f32.const 0.5)))
         (f32.const @DR_SPX) (f32.load (i32.const @PG_CX)))
  (f32.add (f32.load (i32.const @(PG_H + DR_YA))) (f32.sub (f32.sqrt (f32.sub (f32.const @DR_RC2) (f32.mul (local.get $dz) (local.get $dz)))) (f32.const @B_RAD)))
  (local.get $z))

(func $dr_start)
(func $dr_begin (param $p i32) (param $d i32))

;; The drum under (x, z) on bank d, if it holds a ball there no higher than
;; y: its centre within DR_ZS of the axis across, between the ends, its
;; bottom on the shell (the centre DR_RC out from the axis), no slot there.
(func $dr_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (local $i i32) (local $dz f32) (local $h f32) (local $top f32)
  (if (i32.or (f32.lt (local.get $x) (f32.load offset=@(PG_H + DR_X0) (local.get $d)))
              (f32.ge (local.get $x) (f32.load offset=@(PG_H + DR_X1) (local.get $d))))
    (then (return (f32.const -1000))))
  (local.set $i (call $dr_drum (local.get $d) (local.get $z)))
  (local.set $dz (f32.sub (local.get $z) (call $dr_za (local.get $d) (local.get $i))))
  (if (f32.ge (f32.abs (local.get $dz)) (f32.const @DR_ZS)) (then (return (f32.const -1000))))
  (local.set $h (f32.sqrt (f32.sub (f32.const @DR_RC2) (f32.mul (local.get $dz) (local.get $dz)))))
  (local.set $top (f32.add (f32.load offset=@(PG_H + DR_YA) (local.get $d)) (f32.sub (local.get $h) (f32.const @B_RAD))))
  (if (f32.gt (local.get $top) (local.get $y)) (then (return (f32.const -1000))))
  (if (call $dr_hole (local.get $d) (local.get $i) (local.get $x) (local.get $dz) (local.get $h)) (then (return (f32.const -1000))))
  (local.get $top))

;; Ball p after its roll, on bank d. A hair off the shell coming over the
;; top: back on it. On a drum: its velocity across pulled toward the
;; surface's there as its drag pulls it toward still (so the drag is the
;; surface's), and gravity's share down the slope. Off one, over the upper
;; half: held out of the shell along the way from the axis (its velocity in
;; taken away, DR_E of it back), or, over a slot, let in, and past DR_IN of
;; its radius gone (PF_FALL, an FX in bank d's ring).
(func $dr_push (param $p i32) (param $d i32)
  (local $pb i32) (local $fl i32) (local $i i32) (local $t i32)
  (local $px f32) (local $py f32) (local $pz f32) (local $vx f32) (local $vy f32) (local $vz f32) (local $rad f32)
  (local $ya f32) (local $za f32) (local $dz f32) (local $dy f32) (local $h f32) (local $top f32) (local $dist f32) (local $rr f32)
  (local $nz f32) (local $ny f32) (local $vn f32) (local $k f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
  (if (i32.and (local.get $fl) (i32.const @(PF_FALL | PF_DEAD))) (then (return)))
  (local.set $px (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (local.set $py (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
  (local.set $pz (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (local.set $vx (!at f32 @(PLAYERS + P_VX) (local.get $pb)))
  (local.set $vy (!at f32 @(PLAYERS + P_VY) (local.get $pb)))
  (local.set $vz (!at f32 @(PLAYERS + P_VZ) (local.get $pb)))
  (local.set $rad (call $b_rad (local.get $pb)))
  (local.set $ya (f32.load offset=@(PG_H + DR_YA) (local.get $d)))
  (local.set $t (call $p_t (local.get $d)))
  (local.set $i (call $dr_drum (local.get $d) (local.get $pz)))
  (local.set $za (call $dr_za (local.get $d) (local.get $i)))
  (local.set $dz (f32.sub (local.get $pz) (local.get $za)))
  ;; rolling over the top it leaves the shell by a hair: back on it
  (if (i32.and (i32.eqz (i32.and (local.get $fl) (i32.const @PF_GROUND))) (f32.le (local.get $vy) (f32.const 0)))
    (then
      (local.set $top (call $dr_ground (local.get $d) (local.get $px) (f32.add (local.get $py) (f32.const @DR_SNAP)) (local.get $pz)))
      (if (f32.ge (local.get $top) (f32.sub (local.get $py) (f32.const @DR_SNAP)))
        (then
          (local.set $py (local.get $top))
          (local.set $vy (f32.const 0))
          (local.set $fl (i32.or (local.get $fl) (i32.const @PF_GROUND)))))))
  (if (i32.and (local.get $fl) (i32.const @PF_GROUND))
    (then
      (if (f32.lt (f32.abs (local.get $dz)) (f32.const @DR_ZS))
        (then
          ;; the surface there moves across at its speed times cos (h / DR_RC): what the drag
          ;; took toward still it gives back toward that; and the slope, g sin cos
          (local.set $h (f32.sqrt (f32.sub (f32.const @DR_RC2) (f32.mul (local.get $dz) (local.get $dz)))))
          (local.set $k (f32.sub (f32.const 1)
                                 (select (f32.load offset=@PG_DRAG (local.get $d)) (f32.load offset=@PG_IDLE (local.get $d))
                                         (i32.and (!at i32 @(PLAYERS + P_IN) (local.get $pb)) (i32.const 0x0f000000)))))
          (local.set $vz (!madd (f32.mul (local.get $k) (call $dr_speed (local.get $i) (local.get $t))) (f32.div (local.get $h) (f32.const @DR_RC))
                                (!madd (f32.mul (local.get $dz) (local.get $h)) (f32.const @(DR_GRAV * GP_DT / DR_RC2)) (local.get $vz)))))))
    (else
      (if (i32.and (f32.ge (local.get $px) (f32.load offset=@(PG_H + DR_X0) (local.get $d)))
                   (f32.lt (local.get $px) (f32.load offset=@(PG_H + DR_X1) (local.get $d))))
        (then
          (local.set $dy (f32.sub (f32.add (local.get $py) (local.get $rad)) (local.get $ya)))
          (local.set $dist (f32.sqrt (!madd (local.get $dz) (local.get $dz) (f32.mul (local.get $dy) (local.get $dy)))))
          (local.set $rr (f32.add (f32.const @DR_R) (local.get $rad)))
          (if (i32.and (f32.lt (local.get $dist) (local.get $rr)) (f32.gt (local.get $dist) (f32.const 0.001)))
            (then
              (if (call $dr_hole (local.get $d) (local.get $i) (local.get $px) (local.get $dz) (local.get $dy))
                (then
                  (if (f32.lt (local.get $dist) (f32.sub (local.get $rr) (f32.mul (local.get $rad) (f32.const @DR_IN))))
                    (then
                      (local.set $fl (i32.or (local.get $fl) (i32.const @PF_FALL)))
                      (call $fx (local.get $d) (i32.const @DR_FX_DROP) (local.get $p) (local.get $i)
                                (local.get $px) (local.get $py) (local.get $pz) (f32.const 0)))))
                (else
                  (local.set $nz (f32.div (local.get $dz) (local.get $dist)))
                  (local.set $ny (f32.div (local.get $dy) (local.get $dist)))
                  (local.set $pz (!madd (local.get $nz) (local.get $rr) (local.get $za)))
                  (local.set $py (f32.sub (!madd (local.get $ny) (local.get $rr) (local.get $ya)) (local.get $rad)))
                  (local.set $vn (!madd (local.get $vz) (local.get $nz) (f32.mul (local.get $vy) (local.get $ny))))
                  (if (f32.lt (local.get $vn) (f32.const 0))
                    (then
                      (local.set $vn (f32.mul (local.get $vn) (f32.const @(1 + DR_E))))
                      (local.set $vz (f32.sub (local.get $vz) (f32.mul (local.get $vn) (local.get $nz))))
                      (local.set $vy (f32.sub (local.get $vy) (f32.mul (local.get $vn) (local.get $ny))))))))))))))
  (!chk (local.get $py) 182 (local.get $p))
  (!chk (local.get $pz) 183 (local.get $p))
  (!chk (local.get $vy) 184 (local.get $p))
  (!chk (local.get $vz) 185 (local.get $p))
  (!put f32 @(PLAYERS + P_PY) (local.get $pb) (local.get $py))
  (!put f32 @(PLAYERS + P_PZ) (local.get $pb) (local.get $pz))
  (!put f32 @(PLAYERS + P_VX) (local.get $pb) (local.get $vx))
  (!put f32 @(PLAYERS + P_VY) (local.get $pb) (local.get $vy))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (local.get $vz))
  (!put u8 @(PLAYERS + P_FL) (local.get $pb) (local.get $fl)))

;; The schedule's moments as FX: a drum about to reverse (DR_WARN ahead) and
;; reversing, at its top's middle; each phase's start, at the centre.
(func $dr_tick
  (local $t i32) (local $j i32) (local $i i32) (local $k i32) (local $q i32) (local $kind i32) (local $u f32) (local $top f32)
  (local.set $t (call $p_t (i32.const 0)))
  (local.set $k (i32.load (i32.const @(PG_H + DR_K))))
  (!for $kind (i32.const 0) (i32.const 2)
    ;; kind 0: the phase DR_WARN ahead; 1: the phase beginning now
    (local.set $j (i32.add (local.get $t) (select (i32.const @DR_WARN) (i32.const 0) (i32.eqz (local.get $kind)))))
    (if (i32.eqz (i32.rem_u (local.get $j) (i32.const @DR_PH)))
      (then
        (local.set $j (i32.div_u (local.get $j) (i32.const @DR_PH)))
        (if (i32.and (i32.ge_u (local.get $j) (i32.const 1)) (i32.lt_u (local.get $j) (i32.const @DR_NPH)))
          (then
            (local.set $top (f32.const 0))
            (!for $i (i32.const 0) (local.get $k)
              (local.set $q (i32.add (i32.mul (local.get $i) (i32.const @DR_NPH)) (local.get $j)))
              (local.set $u (f32.mul (f32.convert_i32_s (!ld i32 @(PG_S + DR_RATE) (local.get $q))) (f32.const @DR_U)))
              (local.set $top (f32.max (local.get $top) (f32.abs (local.get $u))))
              (if (i32.ne (i32.gt_s (!ld i32 @(PG_S + DR_RATE) (local.get $q)) (i32.const 0))
                          (i32.gt_s (!ld i32 @(PG_S + DR_RATE) (i32.sub (local.get $q) (i32.const 1))) (i32.const 0)))
                (then
                  (call $fx (i32.const 0) (i32.add (i32.const @DR_FX_WARN) (local.get $kind)) (i32.const 255) (local.get $i)
                            (f32.load (i32.const @PG_CX)) (f32.const @PLAT_Y) (call $dr_za (i32.const 0) (local.get $i))
                            (select (f32.const @DR_WARN) (local.get $u) (i32.eqz (local.get $kind)))))))
            (if (local.get $kind)
              (then
                (call $fx (i32.const 0) (i32.const @DR_FX_FAST) (i32.const 255) (local.get $j)
                          (f32.load (i32.const @PG_CX)) (f32.const @PLAT_Y) (f32.load (i32.const @PG_CX)) (local.get $top))))))))))

;; Two or more still on, every one of them falling, and all since the same
;; tick (dropped together): over now, and they share the win rather than
;; all sharing last. Each ball's first tick falling is noted here (DR_FELL).
(func $dr_over (result i32)
  (local $p i32) (local $fl i32) (local $t i32) (local $at i32)
  (local.set $t (i32.add (call $p_t (i32.const 0)) (i32.const 1)))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $fl (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $p) (i32.const 6))) (i32.const @(PF_LIVE | PF_DEAD | PF_FALL))))
    (if (i32.and (i32.eq (local.get $fl) (i32.const @(PF_LIVE | PF_FALL))) (i32.eqz (!ld u16 @(PG_S + DR_FELL) (local.get $p))))
      (then (!st u16 @(PG_S + DR_FELL) (local.get $p) (local.get $t)))))
  (if (i32.lt_u (i32.load (i32.const @BH_LEFT)) (i32.const 2)) (then (return (i32.const 0))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $fl (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $p) (i32.const 6))) (i32.const @(PF_LIVE | PF_DEAD | PF_FALL))))
    (if (i32.eq (local.get $fl) (i32.const @PF_LIVE)) (then (return (i32.const 0))))
    (if (i32.eq (local.get $fl) (i32.const @(PF_LIVE | PF_FALL)))
      (then
        (if (i32.eqz (local.get $at)) (then (local.set $at (!ld u16 @(PG_S + DR_FELL) (local.get $p)))))
        (if (i32.ne (!ld u16 @(PG_S + DR_FELL) (local.get $p)) (local.get $at)) (then (return (i32.const 0)))))))
  (i32.const 1))

(func $dr_out (param $p i32))
