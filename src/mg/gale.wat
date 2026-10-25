;; GALE FORCE: a course over the sea run along +x, from a start pad to a
;; finish gate and a pen walled all round: seven sections in an order of the
;; seed's, a wide deck (a checkpoint) between each and the next, its middle
;; jogged across. Two fan bridges, a mill bridge with two windmills, a headwind
;; tunnel, stairs up and down with a fan on top, a run of gaps to hop, and a
;; fan bridge with an upper deck over it that only the updraft vents at its
;; start reach. The wind is the hazard and all of it is on the clock: a fan
;; gusts across its bridge for part of its period (longer and harder as the
;; round goes), its light warning GF_WARN ahead; a tunnel blows against the way
;; on, harder in its gusts; a vent lifts a ball in its column to float over the
;; upper deck for part of its period; a windmill's blades turn across the way
;; and bat a ball they meet aside and up. Off the course and GF_DEEP under it a
;; ball is down (PK_SCORE), back on its last deck GF_BACK ticks later. The
;; first ball home cuts the clock to GF_LATE; everyone is placed by PG_SCORE:
;; GF_WIN plus the ticks it had left for a ball home, else the metres it got.
;;
;; The course (pieces and hazards in PG_S) is laid out in setup and fixed for
;; the round; ground and push read it and the clock ($p_t on their own bank:
;; a gust, a vent, a blade's angle), so the prediction is exact. A ball's best
;; place along (PG_M, cm) and its score are its own, kept by push on either
;; bank. Downs, comebacks and who came home in what place are the confirmed
;; world's (tick).

;; Piece k's record; hazard j's.
(func $gf_pa (param $k i32) (result i32)
  (i32.add (i32.const @(PG_S + GF_PIECES)) (i32.mul (local.get $k) (i32.const @GF_PSIZE))))
(func $gf_ha (param $j i32) (result i32)
  (i32.add (i32.const @(PG_S + GF_HAZ)) (i32.mul (local.get $j) (i32.const @GF_HSIZE))))

;; Piece a's floor at x: its first step's height, and a step's rise more for every step past it.
(func $gf_floor (param $a i32) (param $x f32) (result f32)
  (local $sl f32) (local $k i32) (local $ns i32)
  (local.set $sl (f32.load offset=@GF_P_SL (local.get $a)))
  (if (f32.le (local.get $sl) (f32.const 0)) (then (return (f32.load offset=@GF_P_H (local.get $a)))))
  (local.set $ns (i32.load offset=@GF_P_NS (local.get $a)))
  (local.set $k (i32.trunc_sat_f32_s (f32.div (f32.sub (local.get $x) (f32.load offset=@GF_P_X0 (local.get $a))) (local.get $sl))))
  (if (i32.lt_s (local.get $k) (i32.const 0)) (then (local.set $k (i32.const 0))))
  (if (i32.ge_s (local.get $k) (local.get $ns)) (then (local.set $k (i32.sub (local.get $ns) (i32.const 1)))))
  (!madd (f32.convert_i32_s (local.get $k)) (f32.load offset=@GF_P_SH (local.get $a)) (f32.load offset=@GF_P_H (local.get $a))))

;; The piece whose floor is the highest under (x, z) no higher than y, and
;; that floor: -1 and -1000 for none (a gap has none).
(func $gf_under (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result i32 f32)
  (local $k i32) (local $n i32) (local $a i32) (local $best i32) (local $top f32) (local $h f32)
  (local.set $best (i32.const -1))
  (local.set $top (f32.const -1000))
  (local.set $n (i32.load offset=@(PG_H + GF_NPIECE) (local.get $d)))
  (!for $k (i32.const 0) (local.get $n)
    (local.set $a (call $gf_pa (local.get $k)))
    (if (i32.and (i32.and (f32.ge (local.get $x) (f32.load offset=@GF_P_X0 (local.get $a)))
                          (f32.lt (local.get $x) (f32.load offset=@GF_P_X1 (local.get $a))))
                 (i32.and (f32.le (f32.abs (f32.sub (local.get $z) (f32.load offset=@GF_P_Z (local.get $a)))) (f32.load offset=@GF_P_W (local.get $a)))
                          (i32.eqz (i32.and (i32.load offset=@GF_P_FL (local.get $a)) (i32.const @GF_F_GAP)))))
      (then
        (local.set $h (call $gf_floor (local.get $a) (local.get $x)))
        (if (i32.and (f32.le (local.get $h) (local.get $y)) (f32.gt (local.get $h) (local.get $top)))
          (then (local.set $top (local.get $h)) (local.set $best (local.get $k)))))))
  (local.get $best) (local.get $top))

;; The main way's floor at x (a gap's: the floor before it; before the start
;; and past the end, the first's and the last's), the upper decks left out.
(func $gf_mainh (param $x f32) (result f32)
  (local $k i32) (local $n i32) (local $a i32) (local $last i32)
  (local.set $n (i32.load (i32.const @(PG_H + GF_NPIECE))))
  (if (i32.eqz (local.get $n)) (then (return (f32.const @GF_H0))))
  (local.set $last (call $gf_pa (i32.const 0)))
  (!for $k (i32.const 0) (local.get $n)
    (local.set $a (call $gf_pa (local.get $k)))
    (if (i32.eqz (i32.and (i32.load offset=@GF_P_FL (local.get $a)) (i32.const @GF_F_UPPER)))
      (then
        (local.set $last (local.get $a))
        (if (f32.lt (local.get $x) (f32.load offset=@GF_P_X1 (local.get $a)))
          (then (return (call $gf_floor (local.get $a) (local.get $x))))))))
  (call $gf_floor (local.get $last) (local.get $x)))

;; ---- the clock: every hazard's state on tick t into play

;; How far the round's ramp is when the period holding t began (o ticks ago): 0 to 1.
(func $gf_ramp (param $t i32) (param $o i32) (result f32)
  (!clamp (f32.div (f32.convert_i32_s (i32.sub (local.get $t) (local.get $o))) (f32.const @GF_RAMP)) (f32.const 0) (f32.const 1)))

;; Where tick t is in hazard h's period.
(func $gf_phase (param $h i32) (param $t i32) (result i32)
  (i32.rem_u (i32.add (local.get $t) (i32.load offset=@GF_H_PH (local.get $h))) (i32.load offset=@GF_H_PER (local.get $h))))

;; Fan h's push on tick t, m/s^2 (0 when it's still): it blows for the first
;; GF_FAN_D0 to GF_FAN_D1 ticks of its period, at GF_FAN_A0 to GF_FAN_A1.
(func $gf_fan_a (param $h i32) (param $t i32) (result f32)
  (local $o i32) (local $f f32)
  (local.set $o (call $gf_phase (local.get $h) (local.get $t)))
  (local.set $f (call $gf_ramp (local.get $t) (local.get $o)))
  (if (result f32) (i32.lt_u (local.get $o) (i32.add (i32.const @GF_FAN_D0) (i32.trunc_sat_f32_u (f32.mul (local.get $f) (f32.const @(GF_FAN_D1 - GF_FAN_D0))))))
    (then (!madd (local.get $f) (f32.const @(GF_FAN_A1 - GF_FAN_A0)) (f32.const @GF_FAN_A0)))
    (else (f32.const 0))))

;; Tunnel h's push against the way on, m/s^2: GF_TUN_A0, and its gust on top for the first GF_TUN_D ticks of its period.
(func $gf_tun_a (param $h i32) (param $t i32) (result f32)
  (local $o i32)
  (local.set $o (call $gf_phase (local.get $h) (local.get $t)))
  (if (result f32) (i32.lt_u (local.get $o) (i32.const @GF_TUN_D))
    (then (f32.add (f32.const @GF_TUN_A0)
                   (!madd (call $gf_ramp (local.get $t) (local.get $o)) (f32.const @(GF_TUN_G1 - GF_TUN_G0)) (f32.const @GF_TUN_G0))))
    (else (f32.const @GF_TUN_A0))))

;; Is vent h blowing on tick t: the first GF_H_ON ticks of its period.
(func $gf_vent_on (param $h i32) (param $t i32) (result i32)
  (i32.lt_u (call $gf_phase (local.get $h) (local.get $t)) (i32.load offset=@GF_H_ON (local.get $h))))

;; ---- laying the course out (setup): a cursor at PG_S + GF_CUR (x, z, the
;; floor's height, the way's half-width), the sections' order 16 bytes on

(func $gf_cx (result f32) (f32.load (i32.const @(PG_S + GF_CUR))))
(func $gf_cz (result f32) (f32.load (i32.const @(PG_S + GF_CUR + 4))))
(func $gf_ch (result f32) (f32.load (i32.const @(PG_S + GF_CUR + 8))))
(func $gf_cw (result f32) (f32.load (i32.const @(PG_S + GF_CUR + 12))))

;; The course's k-th random number in [0, 1).
(func $gf_rnd (param $k i32) (result f32)
  (f32.mul (f32.convert_i32_u (i32.shr_u (call $hash32 (local.get $k) (i32.const 0x6a1e) (call $p_seed (i32.const @GF_KCOURSE))) (i32.const 8)))
           (f32.const 0x1p-24)))

;; A piece from x0, len along, its middle z, half-width w, floor h; the
;; cursor to its end unless it's an upper deck. Its index.
(func $gf_piece (param $x0 f32) (param $len f32) (param $z f32) (param $w f32) (param $h f32) (param $fl i32) (param $sec i32) (result i32)
  (local $k i32) (local $a i32)
  (local.set $k (i32.load (i32.const @(PG_H + GF_NPIECE))))
  (local.set $a (call $gf_pa (local.get $k)))
  (i32.store offset=@GF_P_FL (local.get $a) (local.get $fl))
  (i32.store offset=@GF_P_SEC (local.get $a) (local.get $sec))
  (f32.store offset=@GF_P_X0 (local.get $a) (local.get $x0))
  (f32.store offset=@GF_P_X1 (local.get $a) (f32.add (local.get $x0) (local.get $len)))
  (f32.store offset=@GF_P_Z (local.get $a) (local.get $z))
  (f32.store offset=@GF_P_W (local.get $a) (local.get $w))
  (f32.store offset=@GF_P_H (local.get $a) (local.get $h))
  (i32.store (i32.const @(PG_H + GF_NPIECE)) (i32.add (local.get $k) (i32.const 1)))
  (if (i32.eqz (i32.and (local.get $fl) (i32.const @GF_F_UPPER)))
    (then
      (f32.store (i32.const @(PG_S + GF_CUR)) (f32.add (local.get $x0) (local.get $len)))
      (f32.store (i32.const @(PG_S + GF_CUR + 4)) (local.get $z))
      (f32.store (i32.const @(PG_S + GF_CUR + 8)) (local.get $h))
      (f32.store (i32.const @(PG_S + GF_CUR + 12)) (local.get $w))))
  (local.get $k))

;; A hazard's record. None past GF_NH.
(func $gf_haz (param $kind i32) (param $x f32) (param $z f32) (param $y f32) (param $l f32) (param $w f32)
              (param $per i32) (param $ph i32) (param $dir i32) (param $on i32)
  (local $j i32) (local $h i32)
  (local.set $j (i32.load (i32.const @(PG_H + GF_NHAZ))))
  (if (i32.ge_u (local.get $j) (i32.const @GF_NH)) (then (return)))
  (local.set $h (call $gf_ha (local.get $j)))
  (i32.store offset=@GF_H_KIND (local.get $h) (local.get $kind))
  (f32.store offset=@GF_H_X (local.get $h) (local.get $x))
  (f32.store offset=@GF_H_Z (local.get $h) (local.get $z))
  (f32.store offset=@GF_H_Y (local.get $h) (local.get $y))
  (f32.store offset=@GF_H_L (local.get $h) (local.get $l))
  (f32.store offset=@GF_H_W (local.get $h) (local.get $w))
  (i32.store offset=@GF_H_PER (local.get $h) (local.get $per))
  (i32.store offset=@GF_H_PH (local.get $h) (local.get $ph))
  (i32.store offset=@GF_H_DIR (local.get $h) (local.get $dir))
  (i32.store offset=@GF_H_ON (local.get $h) (local.get $on))
  (i32.store (i32.const @(PG_H + GF_NHAZ)) (i32.add (local.get $j) (i32.const 1))))

;; A ticks count for something periodic: lo plus up to k more, from q.
(func $gf_ticks (param $q i32) (param $lo i32) (param $k f32) (result i32)
  (i32.add (local.get $lo) (i32.trunc_sat_f32_u (f32.mul (call $gf_rnd (local.get $q)) (local.get $k)))))

;; A fan along metres down piece k, on the side it blows away from (dir +1: toward +z); its period and phase from q.
(func $gf_fan (param $k i32) (param $along f32) (param $dir i32) (param $q i32)
  (local $a i32) (local $per i32) (local $x f32)
  (local.set $a (call $gf_pa (local.get $k)))
  (local.set $per (call $gf_ticks (local.get $q) (i32.const @GF_FAN_P0) (f32.const @GF_FAN_PK)))
  (local.set $x (f32.add (f32.load offset=@GF_P_X0 (local.get $a)) (local.get $along)))
  (call $gf_haz (i32.const @GF_HZ_FAN) (local.get $x) (f32.load offset=@GF_P_Z (local.get $a)) (call $gf_floor (local.get $a) (local.get $x))
    (f32.const @GF_FAN_L) (f32.add (f32.load offset=@GF_P_W (local.get $a)) (f32.const 1))
    (local.get $per) (call $gf_ticks (i32.add (local.get $q) (i32.const 1)) (i32.const 0) (f32.convert_i32_u (local.get $per)))
    (local.get $dir) (i32.const 0)))

;; +1 or -1, from q.
(func $gf_side (param $q i32) (result i32)
  (select (i32.const 1) (i32.const -1) (f32.lt (call $gf_rnd (local.get $q)) (f32.const 0.5))))

;; z moved across by up to room less half a metre either way, from q; the
;; other way if that would take it past GF_ZMAX from the start's middle.
(func $gf_jog (param $z f32) (param $room f32) (param $q i32) (result f32)
  (local $j f32)
  (local.set $j (f32.mul (f32.sub (call $gf_rnd (local.get $q)) (f32.const 0.5))
                         (f32.mul (f32.const 2) (f32.max (f32.sub (local.get $room) (f32.const 0.5)) (f32.const 0)))))
  (if (f32.gt (f32.abs (f32.add (local.get $z) (local.get $j))) (f32.const @GF_ZMAX)) (then (local.set $j (f32.neg (local.get $j)))))
  (f32.add (local.get $z) (local.get $j)))

;; A deck from the cursor, GF_DECK0 to GF_DECK0 + GF_DECKL long, half-width
;; wd, a checkpoint, its middle jogged as far as it still holds the way in.
(func $gf_deck (param $q i32) (param $wd f32)
  (drop (call $gf_piece (call $gf_cx) (f32.add (f32.const @GF_DECK0) (f32.mul (call $gf_rnd (i32.add (local.get $q) (i32.const 1))) (f32.const @GF_DECKL)))
                        (call $gf_jog (call $gf_cz) (f32.sub (local.get $wd) (call $gf_cw)) (local.get $q)) (local.get $wd) (call $gf_ch)
                        (i32.const @(GF_F_CHECK | GF_F_DECK)) (i32.const @GF_S_DECK))))

;; FANS: a bridge of 42 to 52 m, three fans down its sides by turns (four on one over 47 m), 8 m in from either end.
(func $gf_fans (param $q i32) (param $z f32) (param $w f32)
  (local $k i32) (local $len f32) (local $m i32) (local $j i32) (local $dir i32) (local $sp f32)
  (local.set $len (f32.add (f32.const 42) (f32.mul (call $gf_rnd (local.get $q)) (f32.const 10))))
  (local.set $k (call $gf_piece (call $gf_cx) (local.get $len) (local.get $z) (local.get $w) (call $gf_ch) (i32.const 0) (i32.const @GF_S_FANS)))
  (local.set $m (select (i32.const 4) (i32.const 3) (f32.gt (local.get $len) (f32.const 47))))
  (local.set $dir (call $gf_side (i32.add (local.get $q) (i32.const 1))))
  (local.set $sp (f32.div (f32.sub (local.get $len) (f32.const 16)) (f32.convert_i32_u (i32.sub (local.get $m) (i32.const 1)))))
  (!for $j (i32.const 0) (local.get $m)
    (call $gf_fan (local.get $k) (!madd (f32.convert_i32_u (local.get $j)) (local.get $sp) (f32.const 8)) (local.get $dir)
                  (i32.add (local.get $q) (i32.add (i32.const 2) (i32.shl (local.get $j) (i32.const 1)))))
    (local.set $dir (i32.sub (i32.const 0) (local.get $dir)))))

;; MILL: a bridge GF_MILL_WK as wide, 30 m, two windmills 9 and 21 m in
;; turning opposite ways, each blade long enough that its tip, with a ball's
;; radius and its own thickness, reaches 0.3 m past the edge level with a
;; ball's middle.
(func $gf_mill (param $q i32) (param $z f32) (param $w f32)
  (local $k i32) (local $a i32) (local $j i32) (local $wm f32) (local $lb f32) (local $spd i32)
  (local.set $wm (f32.mul (local.get $w) (f32.const @GF_MILL_WK)))
  (local.set $k (call $gf_piece (call $gf_cx) (f32.const 30) (local.get $z) (local.get $wm) (call $gf_ch) (i32.const 0) (i32.const @GF_S_MILL)))
  (local.set $a (call $gf_pa (local.get $k)))
  (local.set $lb (f32.sub (f32.sqrt (!madd (f32.add (local.get $wm) (f32.const 0.3)) (f32.add (local.get $wm) (f32.const 0.3))
                                           (f32.const @((GF_MILL_H - 1) * (GF_MILL_H - 1)))))
                          (f32.const @(1 + GF_MILL_T))))
  (local.set $spd (call $gf_side (local.get $q)))
  (!for $j (i32.const 0) (i32.const 2)
    (call $gf_haz (i32.const @GF_HZ_MILL)
      (f32.add (f32.load offset=@GF_P_X0 (local.get $a)) (select (f32.const 21) (f32.const 9) (local.get $j)))
      (local.get $z) (call $gf_ch) (local.get $lb) (f32.const @GF_MILL_H)
      (i32.mul (local.get $spd) (call $gf_ticks (i32.add (local.get $q) (i32.add (i32.const 1) (local.get $j))) (i32.const @GF_MILL_V0) (f32.const @GF_MILL_VK)))
      (call $gf_ticks (i32.add (local.get $q) (i32.add (i32.const 3) (local.get $j))) (i32.const 0) (f32.const 16384))
      (i32.const 0) (i32.const 0))
    (local.set $spd (i32.sub (i32.const 0) (local.get $spd)))))

;; TUNNEL: a walled bridge of 26 m, its middle 20 blowing against the way on.
(func $gf_tunnel (param $q i32) (param $z f32) (param $w f32)
  (local $k i32) (local $per i32)
  (local.set $k (call $gf_piece (call $gf_cx) (f32.const 26) (local.get $z) (local.get $w) (call $gf_ch) (i32.const @GF_F_WALLS) (i32.const @GF_S_TUNNEL)))
  (local.set $per (call $gf_ticks (local.get $q) (i32.const @GF_TUN_P0) (f32.const @GF_TUN_PK)))
  (call $gf_haz (i32.const @GF_HZ_TUNNEL) (f32.add (f32.load offset=@GF_P_X0 (call $gf_pa (local.get $k))) (f32.const 13)) (local.get $z) (call $gf_ch)
    (f32.const @GF_TUN_L) (local.get $w) (local.get $per)
    (call $gf_ticks (i32.add (local.get $q) (i32.const 1)) (i32.const 0) (f32.convert_i32_u (local.get $per)))
    (i32.const 0) (i32.const 0)))

;; A flight of GF_STAIR_N stairs from the cursor, each dh over the last.
(func $gf_flight (param $z f32) (param $w f32) (param $dh f32)
  (local $a i32) (local $h0 f32)
  (local.set $h0 (f32.add (call $gf_ch) (local.get $dh)))
  (local.set $a (call $gf_pa (call $gf_piece (call $gf_cx) (f32.const @(GF_STAIR_N * GF_STAIR_L)) (local.get $z) (local.get $w) (local.get $h0)
                                             (i32.const 0) (i32.const @GF_S_STAIRS))))
  (f32.store offset=@GF_P_SH (local.get $a) (local.get $dh))
  (f32.store offset=@GF_P_SL (local.get $a) (f32.const @GF_STAIR_L))
  (i32.store offset=@GF_P_NS (local.get $a) (i32.const @GF_STAIR_N))
  (f32.store (i32.const @(PG_S + GF_CUR + 8)) (!madd (f32.const @(GF_STAIR_N - 1)) (local.get $dh) (local.get $h0))))

;; STAIRS: a flight up, a top of 10 m with a fan halfway, a flight down.
(func $gf_stairs (param $q i32) (param $z f32) (param $w f32)
  (local $k i32)
  (call $gf_flight (local.get $z) (local.get $w) (f32.const @GF_STAIR_H))
  (local.set $k (call $gf_piece (call $gf_cx) (f32.const 10) (local.get $z) (local.get $w) (call $gf_ch) (i32.const 0) (i32.const @GF_S_STAIRS)))
  (call $gf_fan (local.get $k) (f32.const 5) (call $gf_side (local.get $q)) (i32.add (local.get $q) (i32.const 1)))
  (call $gf_flight (local.get $z) (local.get $w) (f32.const @(-GF_STAIR_H))))

;; GAPS: 9 m of bridge, then twice a gap of GF_GAP0 to GF_GAP0 + GF_GAPK and
;; a landing GF_GAPDROP lower whose front face stops a ball that falls short.
(func $gf_gaps (param $q i32) (param $z f32) (param $w f32)
  (local $j i32)
  (drop (call $gf_piece (call $gf_cx) (f32.const 9) (local.get $z) (local.get $w) (call $gf_ch) (i32.const 0) (i32.const @GF_S_GAPS)))
  (!for $j (i32.const 0) (i32.const 2)
    (drop (call $gf_piece (call $gf_cx) (f32.add (f32.const @GF_GAP0) (f32.mul (call $gf_rnd (i32.add (local.get $q) (local.get $j))) (f32.const @GF_GAPK)))
                          (local.get $z) (local.get $w) (call $gf_ch) (i32.const @GF_F_GAP) (i32.const @GF_S_GAPS)))
    (drop (call $gf_piece (call $gf_cx) (select (f32.const 8) (f32.const 9) (local.get $j)) (local.get $z) (local.get $w)
                          (f32.sub (call $gf_ch) (f32.const @GF_GAPDROP)) (i32.const @GF_F_FACE) (i32.const @GF_S_GAPS)))))

;; VENT: a bridge of 46 m with three fans; at its start one vent (two side by
;; side on a bridge wide enough), and from just past them to 3 m short of its
;; end an upper deck GF_VENT_UP over it, as wide, clear of the fans' reach.
(func $gf_vent (param $q i32) (param $z f32) (param $w f32)
  (local $k i32) (local $x0 f32) (local $h f32) (local $vx f32) (local $per i32) (local $nv i32) (local $j i32) (local $dir i32)
  (local.set $x0 (call $gf_cx))
  (local.set $h (call $gf_ch))
  (local.set $k (call $gf_piece (local.get $x0) (f32.const 46) (local.get $z) (local.get $w) (local.get $h) (i32.const 0) (i32.const @GF_S_VENT)))
  (local.set $dir (call $gf_side (local.get $q)))
  (!for $j (i32.const 0) (i32.const 3)
    (call $gf_fan (local.get $k) (!madd (f32.convert_i32_u (local.get $j)) (f32.const 11) (f32.const 14)) (local.get $dir)
                  (i32.add (local.get $q) (i32.add (i32.const 2) (i32.shl (local.get $j) (i32.const 1)))))
    (local.set $dir (i32.sub (i32.const 0) (local.get $dir))))
  (local.set $vx (f32.add (local.get $x0) (f32.const @(GF_VENT_R + 0.6))))
  (local.set $nv (select (i32.const 2) (i32.const 1) (f32.gt (local.get $w) (f32.const @(GF_VENT_R * 1.6)))))
  (!for $j (i32.const 0) (local.get $nv)
    (local.set $per (call $gf_ticks (i32.add (local.get $q) (i32.add (i32.const 10) (local.get $j))) (i32.const @GF_VENT_P0) (f32.const @GF_VENT_PK)))
    (call $gf_haz (i32.const @GF_HZ_VENT) (local.get $vx)
      (select (local.get $z)
              (!madd (f32.convert_i32_s (i32.sub (i32.shl (local.get $j) (i32.const 1)) (i32.const 1))) (f32.mul (local.get $w) (f32.const 0.5)) (local.get $z))
              (i32.eq (local.get $nv) (i32.const 1)))
      (local.get $h) (f32.const @GF_VENT_R) (f32.const @(GF_VENT_UP + GF_VENT_TOP))
      (local.get $per) (call $gf_ticks (i32.add (local.get $q) (i32.add (i32.const 12) (local.get $j))) (i32.const 0) (f32.convert_i32_u (local.get $per)))
      (i32.const 0) (i32.const @GF_VENT_ON)))
  (drop (call $gf_piece (f32.add (local.get $vx) (f32.const @(GF_VENT_R + 0.3))) (f32.const @(43 - 2 * GF_VENT_R - 0.9)) (local.get $z) (local.get $w)
                        (f32.add (local.get $h) (f32.const @GF_VENT_UP)) (i32.const @GF_F_UPPER) (i32.const @GF_S_VENT))))

;; The course for n balls, from the round's seed: the start pad (a grid for
;; them, walled behind and at its sides), the seven sections in an order of
;; the seed's (never the gaps or the windmills first) with a deck before all
;; but the first, a last deck, a 12 m run in
;; to the line and the pen past it; then moved so it's centred on the stage's
;; centre. A scoring round, braking hard with no keys, bumps with no kick,
;; GF_BACK down.
(func $gf_setup (param $n i32)
  (local $w f32) (local $wd f32) (local $m i32) (local $rows i32) (local $glen f32) (local $j i32) (local $k i32) (local $t i32) (local $q i32)
  (local $z f32) (local $a i32) (local $x1 f32) (local $z0 f32) (local $z1 f32) (local $dx f32) (local $dz f32) (local $lo f32)
  (local.set $n (select (local.get $n) (i32.const 1) (local.get $n)))
  (local.set $w (f32.min (!madd (f32.sqrt (f32.convert_i32_u (local.get $n))) (f32.const @GF_WK) (f32.const @GF_W0)) (f32.const @GF_WMAX)))
  (local.set $wd (f32.mul (local.get $w) (f32.const @GF_DECKK)))
  (!chk (local.get $w) 70 (local.get $n))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_SCORE))
  (i32.store (i32.const @PG_LEN) (i32.const @GF_LEN))
  (f32.store (i32.const @PG_IDLE) (f32.const @GF_IDLE))
  (i32.store (i32.const @PG_RESPAWN) (i32.const @GF_BACK))
  ;; bumps without bumper's kick: on a bridge a shove is what the balls bring
  (i32.store (i32.const @PG_FLAGS) (i32.const @(PGF_BUMPS | PGF_NOKICK)))
  (f32.store (i32.const @(PG_H + GF_W)) (local.get $w))
  (f32.store (i32.const @(PG_H + GF_WD)) (local.get $wd))
  ;; the start pad: rows GF_STEP apart, as many a row as it takes
  (local.set $m (i32.trunc_sat_f32_u (f32.max (f32.const 1) (f32.div (f32.sub (f32.mul (local.get $wd) (f32.const 2)) (f32.const 2)) (f32.const @GF_STEP)))))
  (local.set $rows (i32.div_u (i32.add (local.get $n) (i32.sub (local.get $m) (i32.const 1))) (local.get $m)))
  (i32.store (i32.const @(PG_H + GF_ROW)) (local.get $m))
  (local.set $glen (!madd (f32.convert_i32_u (local.get $rows)) (f32.const @GF_STEP) (f32.const 6)))
  (drop (call $gf_piece (f32.const 0) (local.get $glen) (f32.const 0) (local.get $wd) (f32.const @GF_H0) (i32.const @(GF_F_START | GF_F_CHECK)) (i32.const @GF_S_START)))
  (f32.store (i32.const @(PG_H + GF_X0)) (local.get $glen))
  ;; the sections' order: bytes at GF_CUR + 16, shuffled
  (i32.store (i32.const @(PG_S + GF_CUR + 16)) (i32.const @(GF_S_FANS | (GF_S_FANS << 8) | (GF_S_MILL << 16) | (GF_S_TUNNEL << 24))))
  (i32.store (i32.const @(PG_S + GF_CUR + 20)) (i32.const @(GF_S_STAIRS | (GF_S_GAPS << 8) | (GF_S_VENT << 16))))
  (!for $j (i32.const 0) (i32.const 6)
    (local.set $k (i32.add (local.get $j) (i32.trunc_sat_f32_u (f32.mul (call $gf_rnd (i32.add (i32.const 20) (local.get $j))) (f32.convert_i32_u (i32.sub (i32.const 7) (local.get $j)))))))
    (local.set $t (!ld u8 @(PG_S + GF_CUR + 16) (local.get $k)))
    (!st u8 @(PG_S + GF_CUR + 16) (local.get $k) (!ld u8 @(PG_S + GF_CUR + 16) (local.get $j)))
    (!st u8 @(PG_S + GF_CUR + 16) (local.get $j) (local.get $t)))
  ;; never the gaps or the windmills first: the crowd off the grid gets a run at those
  (local.set $t (i32.load8_u (i32.const @(PG_S + GF_CUR + 16))))
  (if (i32.or (i32.eq (local.get $t) (i32.const @GF_S_GAPS)) (i32.eq (local.get $t) (i32.const @GF_S_MILL)))
    (then
      (block $first
        (!for $j (i32.const 1) (i32.const 7)
          (local.set $k (!ld u8 @(PG_S + GF_CUR + 16) (local.get $j)))
          (if (i32.and (i32.ne (local.get $k) (i32.const @GF_S_GAPS)) (i32.ne (local.get $k) (i32.const @GF_S_MILL)))
            (then
              (i32.store8 (i32.const @(PG_S + GF_CUR + 16)) (local.get $k))
              (!st u8 @(PG_S + GF_CUR + 16) (local.get $j) (local.get $t))
              (br $first)))))))
  (!for $j (i32.const 0) (i32.const 7)
    (local.set $q (i32.add (i32.const 100) (i32.mul (local.get $j) (i32.const 32))))
    (if (local.get $j) (then (call $gf_deck (local.get $q) (local.get $wd))))
    (local.set $t (!ld u8 @(PG_S + GF_CUR + 16) (local.get $j)))
    (local.set $z (call $gf_jog (call $gf_cz)
                                (f32.sub (local.get $wd) (select (f32.mul (local.get $w) (f32.const @GF_MILL_WK)) (local.get $w) (i32.eq (local.get $t) (i32.const @GF_S_MILL))))
                                (i32.add (local.get $q) (i32.const 5))))
    (local.set $q (i32.add (local.get $q) (i32.const 8)))
    (if (i32.eq (local.get $t) (i32.const @GF_S_FANS)) (then (call $gf_fans (local.get $q) (local.get $z) (local.get $w))))
    (if (i32.eq (local.get $t) (i32.const @GF_S_MILL)) (then (call $gf_mill (local.get $q) (local.get $z) (local.get $w))))
    (if (i32.eq (local.get $t) (i32.const @GF_S_TUNNEL)) (then (call $gf_tunnel (local.get $q) (local.get $z) (local.get $w))))
    (if (i32.eq (local.get $t) (i32.const @GF_S_STAIRS)) (then (call $gf_stairs (local.get $q) (local.get $z) (local.get $w))))
    (if (i32.eq (local.get $t) (i32.const @GF_S_GAPS)) (then (call $gf_gaps (local.get $q) (local.get $z) (local.get $w))))
    (if (i32.eq (local.get $t) (i32.const @GF_S_VENT)) (then (call $gf_vent (local.get $q) (local.get $z) (local.get $w)))))
  ;; the last deck, the run in to the line, the pen past it
  (call $gf_deck (i32.const 400) (local.get $wd))
  (local.set $z (call $gf_jog (call $gf_cz) (f32.sub (local.get $wd) (local.get $w)) (i32.const 405)))
  (drop (call $gf_piece (call $gf_cx) (f32.const 12) (local.get $z) (local.get $w) (call $gf_ch) (i32.const 0) (i32.const @GF_S_FINISH)))
  (f32.store (i32.const @(PG_H + GF_FIN)) (call $gf_cx))
  (drop (call $gf_piece (call $gf_cx) (!madd (f32.convert_i32_u (local.get $n)) (f32.const @GF_PENK) (f32.const @GF_PEN0)) (local.get $z) (local.get $wd) (call $gf_ch)
                        (i32.const @GF_F_PEN) (i32.const @GF_S_FINISH)))
  ;; centred on the stage's centre: the box round every piece; the lowest floor
  (local.set $x1 (call $gf_cx))
  (local.set $z0 (f32.const 1e9)) (local.set $z1 (f32.const -1e9)) (local.set $lo (f32.const 1e9))
  (!for $k (i32.const 0) (i32.load (i32.const @(PG_H + GF_NPIECE)))
    (local.set $a (call $gf_pa (local.get $k)))
    (local.set $z0 (f32.min (local.get $z0) (f32.sub (f32.load offset=@GF_P_Z (local.get $a)) (f32.load offset=@GF_P_W (local.get $a)))))
    (local.set $z1 (f32.max (local.get $z1) (f32.add (f32.load offset=@GF_P_Z (local.get $a)) (f32.load offset=@GF_P_W (local.get $a)))))
    (local.set $lo (f32.min (local.get $lo) (f32.min (f32.load offset=@GF_P_H (local.get $a)) (call $gf_floor (local.get $a) (f32.load offset=@GF_P_X1 (local.get $a)))))))
  (local.set $dx (f32.sub (f32.load (i32.const @PG_CX)) (f32.mul (local.get $x1) (f32.const 0.5))))
  (local.set $dz (f32.sub (f32.load (i32.const @PG_CX)) (f32.mul (f32.add (local.get $z0) (local.get $z1)) (f32.const 0.5))))
  (!for $k (i32.const 0) (i32.load (i32.const @(PG_H + GF_NPIECE)))
    (local.set $a (call $gf_pa (local.get $k)))
    (f32.store offset=@GF_P_X0 (local.get $a) (f32.add (f32.load offset=@GF_P_X0 (local.get $a)) (local.get $dx)))
    (f32.store offset=@GF_P_X1 (local.get $a) (f32.add (f32.load offset=@GF_P_X1 (local.get $a)) (local.get $dx)))
    (f32.store offset=@GF_P_Z (local.get $a) (f32.add (f32.load offset=@GF_P_Z (local.get $a)) (local.get $dz))))
  (!for $j (i32.const 0) (i32.load (i32.const @(PG_H + GF_NHAZ)))
    (local.set $a (call $gf_ha (local.get $j)))
    (f32.store offset=@GF_H_X (local.get $a) (f32.add (f32.load offset=@GF_H_X (local.get $a)) (local.get $dx)))
    (f32.store offset=@GF_H_Z (local.get $a) (f32.add (f32.load offset=@GF_H_Z (local.get $a)) (local.get $dz))))
  (f32.store (i32.const @(PG_H + GF_X0)) (f32.add (f32.load (i32.const @(PG_H + GF_X0))) (local.get $dx)))
  (f32.store (i32.const @(PG_H + GF_FIN)) (f32.add (f32.load (i32.const @(PG_H + GF_FIN))) (local.get $dx)))
  (f32.store (i32.const @PG_FLOOR) (local.get $lo))
  (f32.store (i32.const @PG_SIZE) (f32.mul (f32.max (local.get $x1) (f32.sub (local.get $z1) (local.get $z0))) (f32.const 0.5))))

;; Ball i of n on the grid, rows across the start pad from its front back, in
;; an order the round's seed shuffles (i times a stride prime to n, plus an
;; offset); a newcomer or a respawn (n 1024) anywhere on it.
(func $gf_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $a i32) (local $m i32) (local $k i32) (local $row i32) (local $cnt i32) (local $stride i32) (local $seed i32)
  (local $along f32) (local $u f32) (local $w f32) (local $len f32)
  (local.set $a (call $gf_pa (i32.const 0)))
  (local.set $w (f32.load offset=@GF_P_W (local.get $a)))
  (local.set $len (f32.sub (f32.load offset=@GF_P_X1 (local.get $a)) (f32.load offset=@GF_P_X0 (local.get $a))))
  (local.set $m (select (i32.load (i32.const @(PG_H + GF_ROW))) (i32.const 1) (i32.load (i32.const @(PG_H + GF_ROW)))))
  (if (i32.ge_u (local.get $n) (i32.const 1024))
    (then
      (local.set $along (!madd (f32.convert_i32_u (i32.and (local.get $i) (i32.const 15))) (f32.mul (f32.sub (local.get $len) (f32.const 4)) (f32.const 0.0625)) (f32.const 2)))
      (local.set $u (f32.mul (f32.sub (f32.mul (f32.convert_i32_u (i32.shr_u (local.get $i) (i32.const 4))) (f32.const 0.015625)) (f32.const 0.5))
                             (f32.mul (f32.const 2) (f32.max (f32.sub (local.get $w) (f32.const 2)) (f32.const 0))))))
    (else
      (local.set $seed (call $p_seed (i32.const @GF_KGRID)))
      (local.set $stride (i32.add (i32.and (local.get $seed) (i32.const 127)) (i32.const 1)))
      (block $prime
        (loop $next
          (br_if $prime (i32.eq (call $gf_gcd (local.get $stride) (local.get $n)) (i32.const 1)))
          (local.set $stride (i32.add (local.get $stride) (i32.const 1)))
          (br $next)))
      (local.set $k (i32.rem_u (i32.add (i32.mul (local.get $i) (local.get $stride)) (i32.shr_u (local.get $seed) (i32.const 8))) (local.get $n)))
      (local.set $row (i32.div_u (local.get $k) (local.get $m)))
      (local.set $cnt (i32.sub (local.get $n) (i32.mul (local.get $row) (local.get $m))))
      (if (i32.gt_u (local.get $cnt) (local.get $m)) (then (local.set $cnt (local.get $m))))
      (local.set $along (f32.sub (f32.sub (local.get $len) (f32.const 2.5)) (f32.mul (f32.convert_i32_u (local.get $row)) (f32.const @GF_STEP))))
      (local.set $u (f32.mul (f32.sub (f32.convert_i32_u (i32.rem_u (local.get $k) (local.get $m)))
                                      (f32.mul (f32.convert_i32_u (i32.sub (local.get $cnt) (i32.const 1))) (f32.const 0.5)))
                             (f32.const @GF_STEP)))))
  (f32.add (f32.load offset=@GF_P_X0 (local.get $a)) (local.get $along))
  (f32.load offset=@GF_P_H (local.get $a))
  (f32.add (f32.load offset=@GF_P_Z (local.get $a)) (local.get $u)))

(func $gf_gcd (param $a i32) (param $b i32) (result i32)
  (local $t i32)
  (block $done
    (loop $next
      (br_if $done (i32.eqz (local.get $b)))
      (local.set $t (i32.rem_u (local.get $a) (local.get $b)))
      (local.set $a (local.get $b))
      (local.set $b (local.get $t))
      (br $next)))
  (local.get $a))

(func $gf_start)
(func $gf_begin (param $p i32) (param $d i32))

;; The highest floor under (x, z) no higher than y, on bank d.
(func $gf_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (local $k i32)
  (call $gf_under (local.get $d) (local.get $x) (local.get $y) (local.get $z))
  (local.set $y) (local.set $k)
  (local.get $y))

;; After a ball's move, on bank d: on a floor, its best place along and its
;; score (home in the pen), and a ball just over a floor and not rising is put
;; on it; the start pad's walls, a tunnel's, the pen's (its mouth carries a
;; ball in), a landing's face, an upper deck from below; then the wind as it
;; blows on this bank's tick: a fan's gust across, a tunnel's against the way,
;; a vent's lift, a windmill's blades. Writes only its own record and the FX
;; on bank d.
(func $gf_push (param $p i32) (param $d i32)
  (local $pb i32) (local $fl i32) (local $k i32) (local $a i32) (local $pfl i32) (local $j i32) (local $n i32) (local $ha i32) (local $kind i32)
  (local $t i32) (local $sc i32) (local $b i32)
  (local $px f32) (local $py f32) (local $pz f32) (local $vx f32) (local $vy f32) (local $vz f32) (local $r f32) (local $top f32)
  (local $s f32) (local $best f32) (local $h f32) (local $u f32) (local $w f32) (local $l f32) (local $acc f32)
  (local $hx f32) (local $hz f32) (local $hy f32) (local $ez f32) (local $ey f32) (local $qz f32) (local $qy f32) (local $tt f32)
  (local $d2 f32) (local $dd f32) (local $nz f32) (local $ny f32) (local $rr f32) (local $om f32) (local $vn f32)
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
  (local.set $t (call $p_t (local.get $d)))

  ;; what it stands on, or is just over: put on it if it's falling onto it or rolling off a step
  (call $gf_under (local.get $d) (local.get $px) (f32.add (local.get $py) (f32.const @P_STEP)) (local.get $pz))
  (local.set $top) (local.set $k)
  (if (i32.and (i32.and (i32.ge_s (local.get $k) (i32.const 0)) (i32.eqz (i32.and (local.get $fl) (i32.const @PF_GROUND))))
               (i32.and (f32.le (local.get $vy) (f32.const 0)) (f32.le (local.get $py) (f32.add (local.get $top) (f32.const @GF_SNAP)))))
    (then
      (local.set $py (local.get $top))
      (local.set $vy (f32.const 0))
      (local.set $fl (i32.or (local.get $fl) (i32.const @PF_GROUND)))))

  ;; how far along, from where it stands: its best, and home in the pen
  (if (i32.and (i32.ge_s (local.get $k) (i32.const 0)) (i32.ne (i32.and (local.get $fl) (i32.const @PF_GROUND)) (i32.const 0)))
    (then
      (local.set $sc (!at u16 @(PLAYERS + PG_SCORE) (local.get $pb)))
      (if (i32.lt_u (local.get $sc) (i32.const @GF_WIN))
        (then
          (local.set $s (f32.sub (local.get $px) (f32.load offset=@(PG_H + GF_X0) (local.get $d))))
          (local.set $best (f32.mul (f32.convert_i32_u (!at i32 @(PLAYERS + PG_M) (local.get $pb))) (f32.const 0.01)))
          (if (f32.gt (local.get $s) (local.get $best))
            (then
              (local.set $best (local.get $s))
              (!put i32 @(PLAYERS + PG_M) (local.get $pb) (i32.trunc_sat_f32_u (f32.mul (local.get $s) (f32.const 100))))))
          (local.set $sc (i32.trunc_sat_f32_u (local.get $best)))
          (if (i32.and (i32.load offset=@GF_P_FL (call $gf_pa (local.get $k))) (i32.const @GF_F_PEN))
            (then (local.set $sc (i32.add (i32.const @GF_WIN) (select (i32.sub (i32.load offset=@PG_LEN (local.get $d)) (local.get $t)) (i32.const 0)
                                                                      (i32.gt_s (i32.sub (i32.load offset=@PG_LEN (local.get $d)) (local.get $t)) (i32.const 0)))))))
          (!put u16 @(PLAYERS + PG_SCORE) (local.get $pb) (local.get $sc))))))

  ;; the walls, faces and ceilings of the pieces that have them
  (local.set $n (i32.load offset=@(PG_H + GF_NPIECE) (local.get $d)))
  (!for $j (i32.const 0) (local.get $n)
    (local.set $a (call $gf_pa (local.get $j)))
    (local.set $pfl (i32.load offset=@GF_P_FL (local.get $a)))
    (if (i32.and (local.get $pfl) (i32.const @(GF_F_START | GF_F_PEN | GF_F_WALLS | GF_F_FACE | GF_F_UPPER)))
      (then
        (local.set $h (f32.load offset=@GF_P_H (local.get $a)))
        (local.set $w (f32.load offset=@GF_P_W (local.get $a)))
        (local.set $u (f32.sub (local.get $pz) (f32.load offset=@GF_P_Z (local.get $a))))
        (local.set $s (f32.sub (local.get $px) (f32.load offset=@GF_P_X0 (local.get $a))))
        (local.set $l (f32.sub (f32.load offset=@GF_P_X1 (local.get $a)) (f32.load offset=@GF_P_X0 (local.get $a))))
        ;; side walls, over the piece (and a little past its edge), below their top
        (if (i32.and (i32.and (i32.ne (i32.and (local.get $pfl) (i32.const @(GF_F_START | GF_F_PEN | GF_F_WALLS))) (i32.const 0))
                              (i32.and (f32.ge (local.get $s) (f32.const 0)) (f32.lt (local.get $s) (local.get $l))))
                     (i32.and (f32.lt (f32.abs (local.get $u)) (f32.add (local.get $w) (f32.const 0.5)))
                              (i32.and (f32.ge (local.get $py) (f32.sub (local.get $h) (f32.const 1.5))) (f32.lt (local.get $py) (f32.add (local.get $h) (f32.const @GF_WALL))))))
          (then
            (local.set $w (f32.sub (local.get $w) (local.get $r)))
            (if (f32.gt (local.get $u) (local.get $w))
              (then
                (local.set $pz (f32.sub (local.get $pz) (f32.sub (local.get $u) (local.get $w))))
                (if (f32.gt (local.get $vz) (f32.const 0)) (then (local.set $vz (f32.mul (local.get $vz) (f32.const -0.3)))))))
            (if (f32.lt (local.get $u) (f32.neg (local.get $w)))
              (then
                (local.set $pz (f32.sub (local.get $pz) (f32.add (local.get $u) (local.get $w))))
                (if (f32.lt (local.get $vz) (f32.const 0)) (then (local.set $vz (f32.mul (local.get $vz) (f32.const -0.3)))))))
            ;; the start pad's back wall; the pen's far wall, and its mouth carrying a ball in
            (if (i32.and (i32.ne (i32.and (local.get $pfl) (i32.const @GF_F_START)) (i32.const 0)) (f32.lt (local.get $s) (local.get $r)))
              (then
                (local.set $px (f32.add (local.get $px) (f32.sub (local.get $r) (local.get $s))))
                (if (f32.lt (local.get $vx) (f32.const 0)) (then (local.set $vx (f32.mul (local.get $vx) (f32.const -0.3)))))))
            (if (i32.and (local.get $pfl) (i32.const @GF_F_PEN))
              (then
                (if (f32.gt (local.get $s) (f32.sub (local.get $l) (local.get $r)))
                  (then
                    (local.set $px (f32.sub (local.get $px) (f32.sub (local.get $s) (f32.sub (local.get $l) (local.get $r)))))
                    (if (f32.gt (local.get $vx) (f32.const 0)) (then (local.set $vx (f32.mul (local.get $vx) (f32.const -0.3)))))))
                (if (i32.and (f32.lt (local.get $s) (f32.const 4)) (f32.lt (local.get $vx) (f32.const 2)))
                  (then (local.set $vx (f32.const 2))))))))
        ;; a landing's face: a ball over the gap before it, under its top, stops against it
        (if (i32.and (i32.and (i32.ne (i32.and (local.get $pfl) (i32.const @GF_F_FACE)) (i32.const 0))
                              (i32.and (f32.ge (local.get $s) (f32.neg (local.get $r))) (f32.lt (local.get $s) (f32.const 1))))
                     (i32.and (f32.le (f32.abs (local.get $u)) (local.get $w))
                              (i32.and (f32.lt (local.get $py) (f32.sub (local.get $h) (f32.const @P_STEP))) (f32.gt (local.get $py) (f32.sub (local.get $h) (f32.const 4))))))
          (then
            (local.set $px (f32.sub (local.get $px) (f32.add (local.get $s) (local.get $r))))
            (if (f32.gt (local.get $vx) (f32.const 0)) (then (local.set $vx (f32.mul (local.get $vx) (f32.const -0.3)))))))
        ;; an upper deck from below: its slab stops a ball rising into it
        (if (i32.and (i32.and (i32.ne (i32.and (local.get $pfl) (i32.const @GF_F_UPPER)) (i32.const 0))
                              (i32.and (f32.ge (local.get $s) (f32.const 0)) (f32.lt (local.get $s) (local.get $l))))
                     (i32.and (f32.le (f32.abs (local.get $u)) (local.get $w))
                              (i32.and (f32.lt (local.get $py) (f32.sub (local.get $h) (f32.const @P_STEP)))
                                       (f32.gt (!madd (local.get $r) (f32.const 2) (local.get $py)) (f32.sub (local.get $h) (f32.const @GF_THICK))))))
          (then
            (local.set $py (f32.sub (f32.sub (local.get $h) (f32.const @GF_THICK)) (f32.mul (local.get $r) (f32.const 2))))
            (if (f32.gt (local.get $vy) (f32.const 0)) (then (local.set $vy (f32.const 0)))))))))

  ;; the wind on this bank's tick
  (local.set $n (i32.load offset=@(PG_H + GF_NHAZ) (local.get $d)))
  (!for $j (i32.const 0) (local.get $n)
    (local.set $ha (call $gf_ha (local.get $j)))
    (local.set $hx (f32.load offset=@GF_H_X (local.get $ha)))
    (if (f32.lt (f32.abs (f32.sub (local.get $px) (local.get $hx))) (f32.const 12))
      (then
        (local.set $kind (i32.load offset=@GF_H_KIND (local.get $ha)))
        (local.set $hz (f32.load offset=@GF_H_Z (local.get $ha)))
        (local.set $hy (f32.load offset=@GF_H_Y (local.get $ha)))
        (local.set $l (f32.load offset=@GF_H_L (local.get $ha)))
        (local.set $w (f32.load offset=@GF_H_W (local.get $ha)))
        (if (i32.and (i32.eq (local.get $kind) (i32.const @GF_HZ_FAN))
                     (i32.and (i32.and (f32.le (f32.abs (f32.sub (local.get $px) (local.get $hx))) (local.get $l)) (f32.le (f32.abs (f32.sub (local.get $pz) (local.get $hz))) (local.get $w)))
                              (i32.and (f32.ge (local.get $py) (f32.sub (local.get $hy) (f32.const 3))) (f32.le (local.get $py) (f32.add (local.get $hy) (f32.const @GF_FAN_TOP))))))
          (then
            (local.set $acc (call $gf_fan_a (local.get $ha) (local.get $t)))
            (local.set $vz (!madd (f32.convert_i32_s (i32.load offset=@GF_H_DIR (local.get $ha))) (f32.mul (local.get $acc) (f32.const @DT)) (local.get $vz)))))
        (if (i32.and (i32.eq (local.get $kind) (i32.const @GF_HZ_TUNNEL))
                     (i32.and (i32.and (f32.le (f32.abs (f32.sub (local.get $px) (local.get $hx))) (local.get $l)) (f32.le (f32.abs (f32.sub (local.get $pz) (local.get $hz))) (local.get $w)))
                              (i32.and (f32.ge (local.get $py) (f32.sub (local.get $hy) (f32.const 1))) (f32.le (local.get $py) (f32.add (local.get $hy) (f32.const @GF_TUN_TOP))))))
          (then (local.set $vx (f32.sub (local.get $vx) (f32.mul (call $gf_tun_a (local.get $ha) (local.get $t)) (f32.const @DT))))))
        (if (i32.eq (local.get $kind) (i32.const @GF_HZ_VENT))
          (then
            (local.set $qz (f32.sub (local.get $pz) (local.get $hz)))
            (local.set $tt (f32.sub (local.get $px) (local.get $hx)))
            (if (i32.and (i32.and (f32.le (!madd (local.get $tt) (local.get $tt) (f32.mul (local.get $qz) (local.get $qz))) (f32.mul (local.get $l) (local.get $l)))
                                  (call $gf_vent_on (local.get $ha) (local.get $t)))
                         (i32.and (f32.ge (local.get $py) (f32.sub (local.get $hy) (f32.const 0.5))) (f32.le (local.get $py) (f32.add (f32.add (local.get $hy) (local.get $w)) (f32.const 2)))))
              (then
                ;; up toward its top at up to GF_VENT_V, gravity held off, floating there; the roll across damped
                (local.set $acc (f32.min (f32.const @GF_VENT_V) (f32.mul (f32.sub (f32.add (local.get $hy) (local.get $w)) (local.get $py)) (f32.const 3))))
                (local.set $vy (f32.add (!madd (f32.sub (local.get $acc) (local.get $vy)) (f32.const @GF_VENT_K) (local.get $vy)) (f32.const @GP_DT)))
                (local.set $vx (f32.mul (local.get $vx) (f32.const @GF_VENT_DAMP)))
                (local.set $vz (f32.mul (local.get $vz) (f32.const @GF_VENT_DAMP)))
                (if (i32.and (local.get $fl) (i32.const @PF_GROUND))
                  (then (call $fx (local.get $d) (i32.const @GF_FX_LIFT) (local.get $p) (local.get $j) (local.get $px) (local.get $py) (local.get $pz) (f32.const 0))))
                (local.set $fl (i32.and (local.get $fl) (i32.const @(255 ^ PF_GROUND))))))))
        (if (i32.and (i32.eq (local.get $kind) (i32.const @GF_HZ_MILL))
                     (f32.lt (f32.abs (f32.sub (local.get $px) (local.get $hx))) (f32.add (local.get $r) (f32.const @GF_MILL_T))))
          (then
            ;; the blades in the plane across the way through the hub, W over the floor: each a bar from the hub
            ;; L long, GF_MILL_T thick, turning PER a tick from +z toward +y
            (local.set $om (f32.mul (f32.convert_i32_s (i32.load offset=@GF_H_PER (local.get $ha))) (f32.const @(2 * Math.PI / 16384 / DT))))
            (local.set $rr (f32.add (local.get $r) (f32.const @GF_MILL_T)))
            (!for $b (i32.const 0) (i32.const @GF_MILL_NB)
              (call $sincos (i32.add (i32.add (i32.load offset=@GF_H_PH (local.get $ha)) (i32.mul (i32.load offset=@GF_H_PER (local.get $ha)) (local.get $t)))
                                     (i32.mul (local.get $b) (i32.const @(16384 / GF_MILL_NB)))))
              (local.set $ez) (local.set $ey)
              (local.set $qz (f32.sub (local.get $pz) (local.get $hz)))
              (local.set $qy (f32.sub (f32.add (local.get $py) (local.get $r)) (f32.add (local.get $hy) (local.get $w))))
              (local.set $tt (!clamp (!madd (local.get $qz) (local.get $ez) (f32.mul (local.get $qy) (local.get $ey))) (f32.const 0) (local.get $l)))
              (local.set $qz (f32.sub (local.get $qz) (f32.mul (local.get $ez) (local.get $tt))))
              (local.set $qy (f32.sub (local.get $qy) (f32.mul (local.get $ey) (local.get $tt))))
              (local.set $d2 (!madd (local.get $qz) (local.get $qz) (f32.mul (local.get $qy) (local.get $qy))))
              (if (f32.lt (local.get $d2) (f32.mul (local.get $rr) (local.get $rr)))
                (then
                  (if (f32.lt (local.get $d2) (f32.const 1e-6))
                    (then
                      ;; dead on its line: out the way it turns
                      (local.set $nz (select (f32.neg (local.get $ey)) (local.get $ey) (f32.ge (local.get $om) (f32.const 0))))
                      (local.set $ny (select (local.get $ez) (f32.neg (local.get $ez)) (f32.ge (local.get $om) (f32.const 0)))))
                    (else
                      (local.set $dd (f32.sqrt (local.get $d2)))
                      (local.set $nz (f32.div (local.get $qz) (local.get $dd)))
                      (local.set $ny (f32.div (local.get $qy) (local.get $dd)))))
                  (local.set $pz (!madd (local.get $nz) (local.get $rr) (!madd (local.get $ez) (local.get $tt) (local.get $hz))))
                  (local.set $py (f32.sub (!madd (local.get $ny) (local.get $rr) (!madd (local.get $ey) (local.get $tt) (f32.add (local.get $hy) (local.get $w)))) (local.get $r)))
                  ;; into the blade faster than the blade comes on: batted off at half that more, the kick on top, and up
                  (local.set $vn (!madd (f32.add (local.get $vz) (f32.mul (local.get $ey) (f32.mul (local.get $om) (local.get $tt)))) (local.get $nz)
                                        (f32.mul (f32.sub (local.get $vy) (f32.mul (local.get $ez) (f32.mul (local.get $om) (local.get $tt)))) (local.get $ny))))
                  (if (f32.lt (local.get $vn) (f32.const 0))
                    (then
                      (local.set $vn (f32.sub (f32.const @GF_MILL_KICK) (f32.mul (local.get $vn) (f32.const 1.5))))
                      (local.set $vz (!madd (local.get $nz) (local.get $vn) (local.get $vz)))
                      (local.set $vy (f32.max (!madd (local.get $ny) (local.get $vn) (local.get $vy)) (f32.const @GF_MILL_POP)))
                      (local.set $fl (i32.and (local.get $fl) (i32.const @(255 ^ PF_GROUND))))
                      (call $fx (local.get $d) (i32.const @GF_FX_MILL) (local.get $p) (local.get $j) (local.get $px) (f32.add (local.get $py) (local.get $r)) (local.get $pz)
                                (f32.sqrt (!madd (local.get $vz) (local.get $vz) (f32.mul (local.get $vy) (local.get $vy))))))))))
            ;; never through the floor it stood over
            (if (i32.and (i32.ge_s (local.get $k) (i32.const 0)) (f32.lt (local.get $py) (local.get $top))) (then (local.set $py (local.get $top)))))))))

  (!chk (local.get $px) 71 (local.get $p))
  (!chk (local.get $py) 72 (local.get $p))
  (!chk (local.get $pz) 73 (local.get $p))
  (!chk (local.get $vx) 74 (local.get $p))
  (!chk (local.get $vy) 75 (local.get $p))
  (!chk (local.get $vz) 76 (local.get $p))
  (!put f32 @(PLAYERS + P_PX) (local.get $pb) (local.get $px))
  (!put f32 @(PLAYERS + P_PY) (local.get $pb) (local.get $py))
  (!put f32 @(PLAYERS + P_PZ) (local.get $pb) (local.get $pz))
  (!put f32 @(PLAYERS + P_VX) (local.get $pb) (local.get $vx))
  (!put f32 @(PLAYERS + P_VY) (local.get $pb) (local.get $vy))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (local.get $vz))
  (!put u8 @(PLAYERS + P_FL) (local.get $pb) (local.get $fl)))

;; Ball p back on the course at its last checkpoint: the last deck (or the
;; start pad) no further along than its best, 3 m in, across from the middle
;; by its slot, a little up and falling in. Its best stands.
(func $gf_back (param $p i32)
  (local $pb i32) (local $k i32) (local $n i32) (local $a i32) (local $c i32) (local $fl i32) (local $best f32) (local $x0 f32) (local $u f32) (local $w f32) (local $x f32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (local.set $best (f32.mul (f32.convert_i32_u (!at i32 @(PLAYERS + PG_M) (local.get $pb))) (f32.const 0.01)))
  (local.set $x0 (f32.load (i32.const @(PG_H + GF_X0))))
  (local.set $n (i32.load (i32.const @(PG_H + GF_NPIECE))))
  (!for $k (i32.const 0) (local.get $n)
    (local.set $a (call $gf_pa (local.get $k)))
    (local.set $fl (i32.load offset=@GF_P_FL (local.get $a)))
    (if (i32.and (i32.eq (i32.and (local.get $fl) (i32.const @(GF_F_CHECK | GF_F_UPPER))) (i32.const @GF_F_CHECK))
                 (f32.le (f32.sub (f32.load offset=@GF_P_X0 (local.get $a)) (local.get $x0)) (local.get $best)))
      (then (local.set $c (local.get $k)))))
  (local.set $a (call $gf_pa (local.get $c)))
  (local.set $w (f32.load offset=@GF_P_W (local.get $a)))
  (local.set $x (f32.add (f32.load offset=@GF_P_X0 (local.get $a)) (f32.const 3)))
  (local.set $u (f32.mul (f32.sub (f32.mul (f32.convert_i32_u (i32.and (call $hash32 (local.get $p) (i32.load (i32.const @HDR_HOLE)) (i32.const 0x6a1f)) (i32.const 1023)))
                                           (f32.const 0.0009765625))
                                  (f32.const 0.5))
                         (f32.mul (f32.const 2) (f32.max (f32.sub (local.get $w) (f32.const 2)) (f32.const 0)))))
  (call $p_place (local.get $p) (local.get $x) (f32.add (call $gf_floor (local.get $a) (local.get $x)) (f32.const 1.5)) (f32.add (f32.load offset=@GF_P_Z (local.get $a)) (local.get $u)))
  (!put u8 @(PLAYERS + P_FL) (local.get $pb) (i32.const @PF_LIVE))
  (!put u8 @(PLAYERS + B_HITBY) (local.get $pb) (i32.const 255))
  (!put u16 @(PLAYERS + B_HITT) (local.get $pb) (i32.const 0)))

;; In slot order: a ball newly home takes its place (those home on one tick
;; share it), the first one cuts the clock; a ball down comes back on its
;; checkpoint a tick before the framework would send it to the start; a ball
;; GF_DEEP under the main way's floor where it is is down.
(func $gf_tick
  (local $p i32) (local $pb i32) (local $fl i32) (local $t i32) (local $home i32) (local $new i32) (local $sc i32) (local $place i32)
  (local.set $t (i32.load (i32.const @HDR_TICK)))
  (local.set $home (i32.load (i32.const @(PG_H + GF_HOME))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
    (if (i32.and (local.get $fl) (i32.const @PF_LIVE))
      (then
        (local.set $sc (!at u16 @(PLAYERS + PG_SCORE) (local.get $pb)))
        (local.set $place (!ld u8 @(PG_S + GF_PLACE) (local.get $p)))
        ;; a newcomer in a slot someone home has left
        (if (i32.and (i32.ne (local.get $place) (i32.const 0)) (i32.lt_u (local.get $sc) (i32.const @GF_WIN)))
          (then (local.set $place (i32.const 0)) (!st u8 @(PG_S + GF_PLACE) (local.get $p) (i32.const 0))))
        (if (i32.and (i32.ge_u (local.get $sc) (i32.const @GF_WIN)) (i32.eqz (local.get $place)))
          (then
            (local.set $place (select (i32.add (local.get $home) (i32.const 1)) (i32.const 255) (i32.lt_u (local.get $home) (i32.const 255))))
            (!st u8 @(PG_S + GF_PLACE) (local.get $p) (local.get $place))
            (!inc $new)
            (call $fx (i32.const 0) (i32.const @GF_FX_HOME) (local.get $p) (i32.const 0)
                      (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (!at f32 @(PLAYERS + P_PZ) (local.get $pb))
                      (f32.convert_i32_u (local.get $place)))
            (if (i32.eqz (i32.load (i32.const @(PG_H + GF_FIRST))))
              (then
                (i32.store (i32.const @(PG_H + GF_FIRST)) (local.get $t))
                (if (i32.gt_u (i32.load (i32.const @HDR_UNTIL)) (i32.add (local.get $t) (i32.const @GF_LATE)))
                  (then (i32.store (i32.const @HDR_UNTIL) (i32.add (local.get $t) (i32.const @GF_LATE)))))
                (call $fx (i32.const 0) (i32.const @GF_FX_LATE) (local.get $p) (i32.const 0)
                          (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (!at f32 @(PLAYERS + P_PZ) (local.get $pb))
                          (f32.convert_i32_u (i32.div_u (i32.sub (i32.load (i32.const @HDR_UNTIL)) (local.get $t)) (i32.const 125))))))))
        (if (i32.and (local.get $fl) (i32.const @PF_DEAD))
          (then
            (if (i32.and (i32.lt_u (local.get $sc) (i32.const @GF_WIN))
                         (i32.ge_u (i32.add (i32.sub (local.get $t) (!at i32 @(PLAYERS + B_OUTAT) (local.get $pb))) (i32.const 1)) (i32.load (i32.const @PG_RESPAWN))))
              (then (call $gf_back (local.get $p)))))
          (else
            (if (i32.and (i32.lt_u (local.get $sc) (i32.const @GF_WIN))
                         (f32.lt (!at f32 @(PLAYERS + P_PY) (local.get $pb))
                                 (f32.sub (call $gf_mainh (!at f32 @(PLAYERS + P_PX) (local.get $pb))) (f32.const @GF_DEEP))))
              (then (call $p_down (local.get $p)))))))))
  (i32.store (i32.const @(PG_H + GF_HOME)) (i32.add (local.get $home) (local.get $new))))

;; Over when every ball in the room is home.
(func $gf_over (result i32)
  (local $p i32) (local $pb i32) (local $n i32)
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (if (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_LIVE))
      (then
        (if (i32.lt_u (!at u16 @(PLAYERS + PG_SCORE) (local.get $pb)) (i32.const @GF_WIN)) (then (return (i32.const 0))))
        (!inc $n))))
  (i32.ne (local.get $n) (i32.const 0)))

(func $gf_out (param $p i32))
