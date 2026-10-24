;; THE WALL: a square stage over the sea, and walls sweeping across it from
;; its sides, each a row of blocks as wide as the stage with gaps in it. A
;; block shoves what it meets along with it, off the far edge; a ball in a
;; gap lets the wall go by. The walls come faster, their gaps narrower and
;; fewer, as the round goes on, and from WL_SWAY every other one sways, its
;; gaps sliding side to side together as it comes (so the way through is a
;; snake on the floor). A wall moves when the one before is WL_NEXT across,
;; so two or three are on the stage at once, crossing (never head on). Last
;; ball on wins.
;;
;; The round's walls are drawn up at setup from the PRNG into a table in PG_S
;; (when each shows, moves and is gone, its side, speed and gaps), fixed from
;; the round's layout on; a wall's face is a line in the tick from there. So
;; push, on either bank, works every wall out from that bank's own tick and a
;; table the confirmed world fixed long before, and the prediction is exact.

;; Wall w's record in the table.
(func $wl_rec (param $w i32) (result i32)
  (i32.add (i32.const @(PG_S + WL_TABLE)) (i32.mul (local.get $w) (i32.const @WL_WSIZE))))

;; The way wall a moves, (ux, uz), from its side: +x, +z, -x, -z.
(func $wl_way (param $a i32) (result f32 f32)
  (local $side i32)
  (local.set $side (i32.load offset=@WL_SIDE (local.get $a)))
  (select (f32.const 1) (select (f32.const -1) (f32.const 0) (i32.eq (local.get $side) (i32.const 2))) (i32.eqz (local.get $side)))
  (select (f32.const 1) (select (f32.const -1) (f32.const 0) (i32.eq (local.get $side) (i32.const 3))) (i32.eq (local.get $side) (i32.const 1))))

;; How far wall a's gaps are off their centres on tick t into play, and how
;; fast they slide (m/s): still until it moves, then swaying if it does.
(func $wl_sway (param $a i32) (param $t i32) (result f32 f32)
  (local $amp f32) (local $j i32) (local $s f32) (local $c f32)
  (local.set $amp (f32.load offset=@WL_A (local.get $a)))
  (if (f32.eq (local.get $amp) (f32.const 0)) (then (return (f32.const 0) (f32.const 0))))
  (local.set $j (i32.sub (local.get $t) (i32.load offset=@WL_GO (local.get $a))))
  (if (i32.lt_s (local.get $j) (i32.const 0)) (then (local.set $j (i32.const 0))))
  (call $sincos (i32.add (i32.load offset=@WL_PH (local.get $a)) (i32.mul (local.get $j) (i32.const @WL_SWAYK))))
  (local.set $c) (local.set $s)
  (f32.mul (local.get $amp) (local.get $s))
  (select (f32.mul (f32.mul (local.get $amp) (local.get $c)) (f32.const @(2 * Math.PI * WL_SWAYK / 16384 / DT))) (f32.const 0) (local.get $j)))

;; Wall a's leading face on tick t into play, in m along its way from the
;; stage's centre: WL_LEAD off the near edge until it moves, then at its speed.
(func $wl_face (param $a i32) (param $h f32) (param $t i32) (result f32)
  (local $go i32) (local $s0 f32)
  (local.set $go (i32.load offset=@WL_GO (local.get $a)))
  (local.set $s0 (f32.sub (f32.neg (local.get $h)) (f32.const @WL_LEAD)))
  (if (result f32) (i32.le_s (local.get $t) (local.get $go))
    (then (local.get $s0))
    (else (!madd (f32.mul (f32.convert_i32_s (i32.sub (local.get $t) (local.get $go))) (f32.const @DT)) (f32.load offset=@WL_V (local.get $a)) (local.get $s0)))))

;; The square for the crowd, and every wall of the round: wall w moves at a
;; time set by the one before it, with the speed, gap width and gap count of
;; that time (the gaps from one for every WL_SPAN m of its width down to one
;; at WL_KEND); from a side that doesn't face a wall still on the stage; its
;; gaps one to a slot across it, each jittered within its slot, and the sway
;; (from WL_SWAY, every other wall) within what's left of it.
(func $wl_setup (param $n i32)
  (local $h f32) (local $span f32) (local $tau f32) (local $v f32) (local $g f32) (local $sw f32) (local $jit f32) (local $amp f32)
  (local $w i32) (local $a i32) (local $go i32) (local $start i32) (local $k i32) (local $k0 i32) (local $j i32)
  (local $side i32) (local $mask i32) (local $r i32) (local $prev i32) (local $others i32) (local $q i32) (local $e i32) (local $last i32) (local $best i32)
  (local.set $h (f32.min (!madd (f32.sqrt (f32.convert_i32_u (local.get $n))) (f32.const @WL_HK) (f32.const @WL_H0)) (f32.const @WL_HMAX)))
  (!chk (local.get $h) 50 (local.get $n))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_OUT))
  (i32.store (i32.const @PG_LEN) (i32.const @WL_LEN))
  (f32.store (i32.const @PG_SIZE) (local.get $h))
  (f32.store (i32.const @PG_IDLE) (f32.const @WL_IDLE))
  (f32.store (i32.const @(PG_H + WL_HALF)) (local.get $h))
  (local.set $span (f32.add (local.get $h) (local.get $h)))
  (local.set $k0 (i32.add (i32.const 1) (i32.trunc_sat_f32_u (f32.div (local.get $span) (f32.const @WL_SPAN)))))
  (if (i32.gt_u (local.get $k0) (i32.const @WL_KMAX)) (then (local.set $k0 (i32.const @WL_KMAX))))
  (local.set $go (i32.const @WL_GO0))
  (block $full
    (loop $next
      (br_if $full (i32.ge_u (local.get $w) (i32.const @WL_NMAX)))
      (br_if $full (i32.ge_u (local.get $go) (i32.const @WL_LEN)))
      (local.set $start (select (i32.sub (local.get $go) (i32.const @WL_WARN)) (i32.const 0) (local.get $w)))
      (local.set $a (call $wl_rec (local.get $w)))
      (local.set $tau (f32.mul (f32.convert_i32_u (local.get $go)) (f32.const @DT)))
      (local.set $v (f32.min (!madd (local.get $tau) (f32.const @WL_VK) (f32.const @WL_V0)) (f32.const @WL_VMAX)))
      (local.set $g (f32.max (f32.sub (f32.const @WL_G0) (f32.mul (local.get $tau) (f32.const @WL_GK))) (f32.const @WL_GMIN)))
      (local.set $k (i32.sub (local.get $k0) (i32.trunc_sat_f32_u (f32.div (f32.mul (f32.convert_i32_u (i32.sub (local.get $k0) (i32.const 1))) (local.get $tau))
                                                                          (f32.const @WL_KEND)))))
      (if (i32.lt_s (local.get $k) (i32.const 1)) (then (local.set $k (i32.const 1))))
      ;; any side but one facing a wall still on the stage head on (there's always one: two such walls never are);
      ;; of those, half the time the last wall's again, else the one longest unused (one never used before any)
      (local.set $mask (i32.const 15))
      (!for $j (i32.const 0) (local.get $w)
        (if (i32.gt_u (i32.load offset=@WL_END (call $wl_rec (local.get $j))) (local.get $start))
          (then (local.set $mask (i32.and (local.get $mask)
                  (i32.xor (i32.const 15) (i32.shl (i32.const 1) (i32.and (i32.add (i32.load offset=@WL_SIDE (call $wl_rec (local.get $j))) (i32.const 2)) (i32.const 3)))))))))
      (local.set $r (call $rand))
      (local.set $side (i32.and (i32.shr_u (local.get $r) (i32.const 1)) (i32.const 3)))
      (if (local.get $w)
        (then
          (local.set $prev (i32.load offset=@WL_SIDE (call $wl_rec (i32.sub (local.get $w) (i32.const 1)))))
          (local.set $others (i32.and (local.get $mask) (i32.xor (i32.const 15) (i32.shl (i32.const 1) (local.get $prev)))))
          (if (i32.and (i32.ne (i32.and (local.get $mask) (i32.shl (i32.const 1) (local.get $prev))) (i32.const 0))
                       (i32.or (i32.and (local.get $r) (i32.const 1)) (i32.eqz (local.get $others))))
            (then (local.set $side (local.get $prev)))
            (else
              ;; from a side the PRNG picks, round: the first with the oldest last use wins, so ties go its way
              (local.set $best (i32.const 0x7fffffff))
              (!for $q (i32.const 0) (i32.const 4)
                (local.set $e (i32.and (i32.add (local.get $q) (i32.shr_u (local.get $r) (i32.const 1))) (i32.const 3)))
                (if (i32.and (local.get $others) (i32.shl (i32.const 1) (local.get $e)))
                  (then
                    (local.set $last (i32.const -1))
                    (!for $j (i32.const 0) (local.get $w)
                      (if (i32.eq (i32.load offset=@WL_SIDE (call $wl_rec (local.get $j))) (local.get $e)) (then (local.set $last (local.get $j)))))
                    (if (i32.lt_s (local.get $last) (local.get $best))
                      (then (local.set $best (local.get $last)) (local.set $side (local.get $e)))))))))))
      (i32.store offset=@WL_START (local.get $a) (local.get $start))
      (i32.store offset=@WL_GO (local.get $a) (local.get $go))
      (i32.store offset=@WL_END (local.get $a)
        (i32.add (local.get $go) (i32.add (i32.const 1) (i32.trunc_sat_f32_u (f32.div (f32.add (local.get $span) (f32.const @(WL_LEAD + WL_T + WL_PAST)))
                                                                                       (f32.mul (local.get $v) (f32.const @DT)))))))
      (i32.store offset=@WL_SIDE (local.get $a) (local.get $side))
      (!chk (local.get $v) 55 (local.get $w))
      (!chk (local.get $g) 56 (local.get $w))
      (f32.store offset=@WL_V (local.get $a) (local.get $v))
      (f32.store offset=@WL_G (local.get $a) (local.get $g))
      (i32.store offset=@WL_K (local.get $a) (local.get $k))
      ;; gap j in slot j of k across the wall, up to jit either way of the slot's middle, the sway's share of it first
      (local.set $sw (f32.div (local.get $span) (f32.convert_i32_u (local.get $k))))
      (local.set $jit (f32.max (f32.const 0) (f32.sub (f32.mul (f32.sub (local.get $sw) (local.get $g)) (f32.const 0.5)) (f32.const @WL_MARGIN))))
      (local.set $amp (f32.const 0))
      (if (i32.and (i32.and (local.get $w) (i32.const 1)) (i32.ge_u (local.get $go) (i32.const @WL_SWAY)))
        (then (local.set $amp (f32.min (local.get $jit) (f32.const @WL_SWAYA)))))
      (!chk (local.get $amp) 57 (local.get $w))
      (f32.store offset=@WL_A (local.get $a) (local.get $amp))
      (i32.store offset=@WL_PH (local.get $a) (i32.and (call $rand) (i32.const 16383)))
      (!for $j (i32.const 0) (local.get $k)
        (local.set $tau (!madd (f32.sub (f32.mul (call $p_unit) (f32.const 2)) (f32.const 1)) (f32.sub (local.get $jit) (local.get $amp))
                               (!madd (f32.add (f32.convert_i32_u (local.get $j)) (f32.const 0.5)) (local.get $sw) (f32.neg (local.get $h)))))
        (!chk (local.get $tau) 58 (local.get $j))
        (f32.store offset=@WL_GAPS (i32.add (local.get $a) (i32.shl (local.get $j) (i32.const 2))) (local.get $tau)))
      ;; the next moves when this one is WL_NEXT across (of at most WL_CAD m), and never before this one moves
      (local.set $j (i32.trunc_sat_f32_u (f32.div (f32.mul (f32.min (local.get $span) (f32.const @WL_CAD)) (f32.const @WL_NEXT))
                                                  (f32.mul (local.get $v) (f32.const @DT)))))
      (local.set $go (i32.add (local.get $go) (select (local.get $j) (i32.const @WL_WARN) (i32.gt_u (local.get $j) (i32.const @WL_WARN)))))
      (!inc $w)
      (br $next)))
  (i32.store (i32.const @(PG_H + WL_NW)) (local.get $w)))

;; On a grid over the middle of the square, a row at a time.
(func $wl_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $k i32) (local $rows i32) (local $sp f32) (local $cx f32)
  (local.set $k (i32.const 1))
  (block $wide (loop $more (br_if $wide (i32.ge_u (i32.mul (local.get $k) (local.get $k)) (local.get $n))) (!inc $k) (br $more)))
  (local.set $rows (i32.div_u (i32.add (local.get $n) (i32.sub (local.get $k) (i32.const 1))) (local.get $k)))
  (local.set $sp (f32.div (f32.mul (f32.load (i32.const @(PG_H + WL_HALF))) (f32.const @(2 * WL_SPREAD))) (f32.convert_i32_u (local.get $k))))
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (!madd (f32.sub (f32.convert_i32_u (i32.rem_u (local.get $i) (local.get $k))) (f32.mul (f32.convert_i32_u (i32.sub (local.get $k) (i32.const 1))) (f32.const 0.5)))
         (local.get $sp) (local.get $cx))
  (f32.const @PLAT_Y)
  (!madd (f32.sub (f32.convert_i32_u (i32.div_u (local.get $i) (local.get $k))) (f32.mul (f32.convert_i32_u (i32.sub (local.get $rows) (i32.const 1))) (f32.const 0.5)))
         (local.get $sp) (local.get $cx)))

;; Wall w's FX (kind, shot, size) at its middle as it stands on tick t.
(func $wl_fx (param $kind i32) (param $w i32) (param $shot i32) (param $size f32) (param $t i32)
  (local $a i32) (local $ux f32) (local $uz f32) (local $u f32) (local $cx f32)
  (local.set $a (call $wl_rec (local.get $w)))
  (call $wl_way (local.get $a))
  (local.set $uz) (local.set $ux)
  (local.set $u (f32.sub (call $wl_face (local.get $a) (f32.load (i32.const @(PG_H + WL_HALF))) (local.get $t)) (f32.const @(WL_T / 2))))
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (call $fx (i32.const 0) (local.get $kind) (i32.const 255) (local.get $shot)
            (!madd (local.get $u) (local.get $ux) (local.get $cx)) (f32.const @(+PLAT_Y + WL_HIGH / 2)) (!madd (local.get $u) (local.get $uz) (local.get $cx))
            (local.get $size)))

;; The first wall has shown since the countdown began: its FX as play starts.
(func $wl_start
  (if (i32.load (i32.const @(PG_H + WL_NW)))
    (then (call $wl_fx (i32.const @WL_FX_SHOW) (i32.const 0) (i32.shl (i32.load offset=@WL_SIDE (call $wl_rec (i32.const 0))) (i32.const 8))
                       (f32.load offset=@WL_V (call $wl_rec (i32.const 0))) (i32.const 0)))))

(func $wl_begin (param $p i32) (param $d i32))

;; The floor's top over the square, nothing past its edge.
(func $wl_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (local $h f32) (local $cx f32)
  (if (f32.lt (local.get $y) (f32.const @PLAT_Y)) (then (return (f32.const -1000))))
  (local.set $h (f32.load offset=@(PG_H + WL_HALF) (local.get $d)))
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (if (result f32) (i32.and (f32.le (f32.abs (f32.sub (local.get $x) (local.get $cx))) (local.get $h))
                            (f32.le (f32.abs (f32.sub (local.get $z) (local.get $cx))) (local.get $h)))
    (then (f32.const @PLAT_Y))
    (else (f32.const -1000))))

;; Every wall on the stage against ball p on bank d, in the table's order. In
;; a wall's frame (u along its way, v across it from the stage's centre, less
;; the sway: the gaps' stored centres hold) a
;; ball whose centre is in a gap's span can only touch the block past the
;; gap's nearer edge (a gap is wider than a ball), and is pushed off it, so
;; the corners funnel it in; a ball in a block's span ahead of the wall is
;; met by the face; one inside the slab goes out the nearest way (the face,
;; the back, or sideways into a gap). Its velocity into the block is held to
;; the block's own (the wall's speed along its way once it moves, the sway's
;; across it), so a ball on a face rides it; across the face it slides free. A moving face meeting
;; the ball the first time for that wall marks it (bit w mod 32 of PG_M, till
;; the wall is gone) and sends WL_FX_PIN on this bank.
(func $wl_push (param $p i32) (param $d i32)
  (local $pb i32) (local $fl i32) (local $t i32) (local $w i32) (local $nw i32) (local $a i32) (local $j i32) (local $k i32) (local $hit i32) (local $moved i32)
  (local $h f32) (local $cx f32) (local $r f32) (local $px f32) (local $py f32) (local $pz f32) (local $vx f32) (local $vz f32)
  (local $ux f32) (local $uz f32) (local $u f32) (local $v f32) (local $vu f32) (local $vv f32) (local $s f32) (local $back f32) (local $g2 f32) (local $gc f32)
  (local $cu f32) (local $cv f32) (local $du f32) (local $dv f32) (local $dd f32) (local $nu f32) (local $nv f32) (local $dep f32) (local $e f32) (local $vn f32) (local $want f32)
  (local $off f32) (local $vs f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
  (if (i32.and (local.get $fl) (i32.const @(PF_FALL | PF_DEAD))) (then (return)))
  (local.set $t (call $p_t (local.get $d)))
  (local.set $nw (i32.load offset=@(PG_H + WL_NW) (local.get $d)))
  ;; on the tick a wall is gone its bit in PG_M goes too (wall w + 32 has the
  ;; same bit), wherever the ball is, so either bank clears it alike
  (local.set $w (i32.load offset=@(PG_H + WL_LIVE) (local.get $d)))
  (block $kept
    (loop $gone
      (br_if $kept (i32.ge_u (local.get $w) (local.get $nw)))
      (local.set $a (call $wl_rec (local.get $w)))
      (br_if $kept (i32.gt_s (i32.load offset=@WL_START (local.get $a)) (local.get $t)))
      (if (i32.eq (local.get $t) (i32.load offset=@WL_END (local.get $a)))
        (then (!put i32 @(PLAYERS + PG_M) (local.get $pb) (i32.and (!at i32 @(PLAYERS + PG_M) (local.get $pb)) (i32.rotl (i32.const -2) (local.get $w))))))
      (!inc $w)
      (br $gone)))
  (local.set $py (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
  (local.set $r (call $b_rad (local.get $pb)))
  ;; over the walls, or under them falling
  (if (i32.or (f32.ge (local.get $py) (f32.const @(+PLAT_Y + WL_HIGH)))
              (f32.le (!madd (local.get $r) (f32.const 2) (local.get $py)) (f32.const @(PLAT_Y - WL_DEEP))))
    (then (return)))
  (local.set $h (f32.load offset=@(PG_H + WL_HALF) (local.get $d)))
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (local.set $px (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (local.set $pz (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (local.set $vx (!at f32 @(PLAYERS + P_VX) (local.get $pb)))
  (local.set $vz (!at f32 @(PLAYERS + P_VZ) (local.get $pb)))
  ;; the walls gone as of the confirmed tick are gone on this bank's (it's never behind it)
  (local.set $w (i32.load offset=@(PG_H + WL_LIVE) (local.get $d)))
  (block $done
    (loop $walls
      (br_if $done (i32.ge_u (local.get $w) (local.get $nw)))
      (local.set $a (call $wl_rec (local.get $w)))
      (br_if $done (i32.gt_s (i32.load offset=@WL_START (local.get $a)) (local.get $t)))
      (if (i32.lt_s (local.get $t) (i32.load offset=@WL_END (local.get $a)))
        (then (block $clear
          (call $wl_way (local.get $a))
          (local.set $uz) (local.set $ux)
          (local.set $u (f32.add (f32.mul (f32.sub (local.get $px) (local.get $cx)) (local.get $ux)) (f32.mul (f32.sub (local.get $pz) (local.get $cx)) (local.get $uz))))
          (call $wl_sway (local.get $a) (local.get $t))
          (local.set $vs) (local.set $off)
          (local.set $v (f32.sub (f32.sub (f32.mul (f32.sub (local.get $pz) (local.get $cx)) (local.get $ux)) (f32.mul (f32.sub (local.get $px) (local.get $cx)) (local.get $uz)))
                                 (local.get $off)))
          (local.set $s (call $wl_face (local.get $a) (local.get $h) (local.get $t)))
          (local.set $back (f32.sub (local.get $s) (f32.const @WL_T)))
          (br_if $clear (f32.ge (f32.sub (local.get $u) (local.get $r)) (local.get $s)))
          (br_if $clear (f32.le (f32.add (local.get $u) (local.get $r)) (local.get $back)))
          ;; the gap whose span holds the ball's centre, if any
          (local.set $g2 (f32.mul (f32.load offset=@WL_G (local.get $a)) (f32.const 0.5)))
          (local.set $k (i32.load offset=@WL_K (local.get $a)))
          (local.set $hit (i32.const -1))
          (!for $j (i32.const 0) (local.get $k)
            (if (f32.lt (f32.abs (f32.sub (local.get $v) (f32.load offset=@WL_GAPS (i32.add (local.get $a) (i32.shl (local.get $j) (i32.const 2)))))) (local.get $g2))
              (then (local.set $hit (local.get $j)))))
          (if (i32.ge_s (local.get $hit) (i32.const 0))
            (then
              ;; in a gap: off the block past its nearer edge, if it reaches it
              (local.set $gc (f32.load offset=@WL_GAPS (i32.add (local.get $a) (i32.shl (local.get $hit) (i32.const 2)))))
              (local.set $cv (select (f32.sub (local.get $gc) (local.get $g2)) (f32.add (local.get $gc) (local.get $g2)) (f32.lt (local.get $v) (local.get $gc))))
              (local.set $cu (f32.min (f32.max (local.get $u) (local.get $back)) (local.get $s)))
              (local.set $du (f32.sub (local.get $u) (local.get $cu)))
              (local.set $dv (f32.sub (local.get $v) (local.get $cv)))
              (local.set $dd (!madd (local.get $du) (local.get $du) (f32.mul (local.get $dv) (local.get $dv))))
              (br_if $clear (f32.ge (local.get $dd) (f32.mul (local.get $r) (local.get $r))))
              (local.set $dd (f32.sqrt (local.get $dd)))
              (if (f32.lt (local.get $dd) (f32.const 0.0001))
                (then
                  (local.set $nu (f32.const 0))
                  (local.set $nv (select (f32.const 1) (f32.const -1) (f32.lt (local.get $v) (local.get $gc)))))
                (else
                  (local.set $nu (f32.div (local.get $du) (local.get $dd)))
                  (local.set $nv (f32.div (local.get $dv) (local.get $dd)))))
              (local.set $dep (f32.sub (local.get $r) (local.get $dd))))
            (else
              (if (f32.gt (local.get $u) (local.get $s))
                (then
                  ;; ahead of a block: its face
                  (local.set $nu (f32.const 1))
                  (local.set $nv (f32.const 0))
                  (local.set $dep (f32.sub (f32.add (local.get $s) (local.get $r)) (local.get $u))))
                (else
                  (if (f32.lt (local.get $u) (local.get $back))
                    (then
                      ;; behind it, chasing it: its back
                      (local.set $nu (f32.const -1))
                      (local.set $nv (f32.const 0))
                      (local.set $dep (f32.sub (local.get $u) (f32.sub (local.get $back) (local.get $r)))))
                    (else
                      ;; in it (a bump put it there): out the nearest way, the face, the back or a gap's edge
                      (local.set $nu (f32.const 1))
                      (local.set $nv (f32.const 0))
                      (local.set $dep (f32.sub (f32.add (local.get $s) (local.get $r)) (local.get $u)))
                      (local.set $e (f32.add (f32.sub (local.get $u) (local.get $back)) (local.get $r)))
                      (if (f32.lt (local.get $e) (local.get $dep))
                        (then (local.set $nu (f32.const -1)) (local.set $dep (local.get $e))))
                      (!for $j (i32.const 0) (local.get $k)
                        ;; into gap j: past its low edge from below it, or its high edge from above
                        (local.set $gc (f32.load offset=@WL_GAPS (i32.add (local.get $a) (i32.shl (local.get $j) (i32.const 2)))))
                        (local.set $e (select (f32.add (f32.sub (local.get $v) (f32.add (local.get $gc) (local.get $g2))) (local.get $r))
                                              (f32.add (f32.sub (f32.sub (local.get $gc) (local.get $g2)) (local.get $v)) (local.get $r))
                                              (f32.gt (local.get $v) (local.get $gc))))
                        (if (f32.lt (local.get $e) (local.get $dep))
                          (then
                            (local.set $nu (f32.const 0))
                            (local.set $nv (select (f32.const -1) (f32.const 1) (f32.gt (local.get $v) (local.get $gc))))
                            (local.set $dep (local.get $e)))))))))))
          (local.set $u (!madd (local.get $nu) (local.get $dep) (local.get $u)))
          (local.set $v (f32.add (!madd (local.get $nv) (local.get $dep) (local.get $v)) (local.get $off)))
          ;; its speed into the block no more than the block's own
          (local.set $vu (f32.add (f32.mul (local.get $vx) (local.get $ux)) (f32.mul (local.get $vz) (local.get $uz))))
          (local.set $vv (f32.sub (f32.mul (local.get $vz) (local.get $ux)) (f32.mul (local.get $vx) (local.get $uz))))
          (local.set $want (select (!madd (local.get $nu) (f32.load offset=@WL_V (local.get $a)) (f32.mul (local.get $nv) (local.get $vs))) (f32.const 0)
                                   (i32.gt_s (local.get $t) (i32.load offset=@WL_GO (local.get $a)))))
          (local.set $vn (!madd (local.get $vv) (local.get $nv) (f32.mul (local.get $vu) (local.get $nu))))
          (if (f32.lt (local.get $vn) (local.get $want))
            (then
              (local.set $vu (!madd (local.get $nu) (f32.sub (local.get $want) (local.get $vn)) (local.get $vu)))
              (local.set $vv (!madd (local.get $nv) (f32.sub (local.get $want) (local.get $vn)) (local.get $vv)))))
          ;; back to x, z: x = u ux - v uz, z = u uz + v ux
          (local.set $px (f32.add (local.get $cx) (f32.sub (f32.mul (local.get $u) (local.get $ux)) (f32.mul (local.get $v) (local.get $uz)))))
          (local.set $pz (f32.add (local.get $cx) (f32.add (f32.mul (local.get $u) (local.get $uz)) (f32.mul (local.get $v) (local.get $ux)))))
          (local.set $vx (f32.sub (f32.mul (local.get $vu) (local.get $ux)) (f32.mul (local.get $vv) (local.get $uz))))
          (local.set $vz (f32.add (f32.mul (local.get $vu) (local.get $uz)) (f32.mul (local.get $vv) (local.get $ux))))
          (local.set $moved (i32.const 1))
          (local.set $j (!at i32 @(PLAYERS + PG_M) (local.get $pb)))
          (if (i32.and (i32.and (i32.gt_s (local.get $t) (i32.load offset=@WL_GO (local.get $a))) (f32.gt (local.get $nu) (f32.const 0.5)))
                       (i32.eqz (i32.and (local.get $j) (i32.shl (i32.const 1) (local.get $w)))))
            (then
              ;; wall w's bit set, till it's gone
              (!put i32 @(PLAYERS + PG_M) (local.get $pb) (i32.or (local.get $j) (i32.shl (i32.const 1) (local.get $w))))
              (call $fx (local.get $d) (i32.const @WL_FX_PIN) (local.get $p) (local.get $w) (local.get $px) (local.get $py) (local.get $pz) (local.get $want)))))))
      (!inc $w)
      (br $walls)))
  (if (local.get $moved)
    (then
      (!chk (local.get $px) 51 (local.get $p))
      (!chk (local.get $pz) 52 (local.get $p))
      (!chk (local.get $vx) 53 (local.get $p))
      (!chk (local.get $vz) 54 (local.get $p))
      (!put f32 @(PLAYERS + P_PX) (local.get $pb) (local.get $px))
      (!put f32 @(PLAYERS + P_PZ) (local.get $pb) (local.get $pz))
      (!put f32 @(PLAYERS + P_VX) (local.get $pb) (local.get $vx))
      (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (local.get $vz)))))

;; Each wall's moments as FX (it shows, it moves, it's gone: every ball still
;; in has seen it go by, counted in WL_PASSED); then the walls gone.
(func $wl_tick
  (local $t i32) (local $w i32) (local $nw i32) (local $a i32) (local $p i32) (local $n i32)
  (local.set $t (call $p_t (i32.const 0)))
  (local.set $nw (i32.load (i32.const @(PG_H + WL_NW))))
  (local.set $w (i32.load (i32.const @(PG_H + WL_LIVE))))
  (block $done
    (loop $walls
      (br_if $done (i32.ge_u (local.get $w) (local.get $nw)))
      (local.set $a (call $wl_rec (local.get $w)))
      (br_if $done (i32.gt_s (i32.load offset=@WL_START (local.get $a)) (local.get $t)))
      (if (i32.and (i32.eq (local.get $t) (i32.load offset=@WL_START (local.get $a))) (i32.ne (local.get $w) (i32.const 0)))
        (then (call $wl_fx (i32.const @WL_FX_SHOW) (local.get $w) (i32.or (local.get $w) (i32.shl (i32.load offset=@WL_SIDE (local.get $a)) (i32.const 8)))
                           (f32.load offset=@WL_V (local.get $a)) (local.get $t))))
      (if (i32.eq (local.get $t) (i32.load offset=@WL_GO (local.get $a)))
        (then (call $wl_fx (i32.const @WL_FX_GO) (local.get $w) (local.get $w) (f32.load offset=@WL_V (local.get $a)) (local.get $t))))
      (if (i32.eq (local.get $t) (i32.load offset=@WL_END (local.get $a)))
        (then
          (local.set $n (i32.const 0))
          (!for $p (i32.const 0) (i32.const @NPLAYER)
            (if (call $p_in (i32.shl (local.get $p) (i32.const 6)))
              (then
                (!st u8 @(PG_S + WL_PASSED) (local.get $p) (i32.add (!ld u8 @(PG_S + WL_PASSED) (local.get $p)) (i32.const 1)))
                (!inc $n))))
          (call $wl_fx (i32.const @WL_FX_GONE) (local.get $w) (local.get $w) (f32.convert_i32_u (local.get $n)) (local.get $t))))
      (!inc $w)
      (br $walls)))
  (local.set $w (i32.load (i32.const @(PG_H + WL_LIVE))))
  (block $gone
    (loop $more
      (br_if $gone (i32.ge_u (local.get $w) (local.get $nw)))
      (br_if $gone (i32.gt_s (i32.load offset=@WL_END (call $wl_rec (local.get $w))) (local.get $t)))
      (!inc $w)
      (br $more)))
  (i32.store (i32.const @(PG_H + WL_LIVE)) (local.get $w)))

;; Two or more still in, every one of them falling, and all since the same
;; tick (one wall took them all off at once): over now, and they share the
;; win rather than all sharing last. One that went off before the rest goes
;; out first, in its place. Each ball's first tick falling is noted here (WL_FELL).
(func $wl_over (result i32)
  (local $p i32) (local $fl i32) (local $t i32) (local $at i32)
  (local.set $t (i32.add (call $p_t (i32.const 0)) (i32.const 1)))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $fl (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $p) (i32.const 6))) (i32.const @(PF_LIVE | PF_DEAD | PF_FALL))))
    (if (i32.and (i32.eq (local.get $fl) (i32.const @(PF_LIVE | PF_FALL))) (i32.eqz (!ld u16 @(PG_S + WL_FELL) (local.get $p))))
      (then (!st u16 @(PG_S + WL_FELL) (local.get $p) (local.get $t)))))
  (if (i32.lt_u (i32.load (i32.const @BH_LEFT)) (i32.const 2)) (then (return (i32.const 0))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $fl (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $p) (i32.const 6))) (i32.const @(PF_LIVE | PF_DEAD | PF_FALL))))
    (if (i32.eq (local.get $fl) (i32.const @PF_LIVE)) (then (return (i32.const 0))))
    (if (i32.eq (local.get $fl) (i32.const @(PF_LIVE | PF_FALL)))
      (then
        (if (i32.eqz (local.get $at)) (then (local.set $at (!ld u16 @(PG_S + WL_FELL) (local.get $p)))))
        (if (i32.ne (!ld u16 @(PG_S + WL_FELL) (local.get $p)) (local.get $at)) (then (return (i32.const 0)))))))
  (i32.const 1))

(func $wl_out (param $p i32))
