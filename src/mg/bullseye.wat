;; BULLSEYE: an icy disc over the sea, sized for the crowd, and the house
;; painted in its middle: the bull (BE_R1) and three rings out to its edge
;; (BE_R2, BE_R3, BE_R4), scaled up past 100 balls. Every BE_END the bell
;; rings an end: each ball in then, in slot order, scores by the ring its
;; centre is in (BE_PTS: 5 the bull down to 1 the blue; twice that the last
;; BE_DOUBLE ends), and from the next tick a shove wave runs out from the
;; middle and slides every ball in the house out past its edge, so each end
;; opens with a rush back in. The ice barely grips (PG_ACC, PG_DRAG,
;; PG_IDLE: balls slide and coast), a hard bump kicks the harder the
;; harder it hits (BE_KICKK), and a ball off the edge is down BE_RESPAWN and
;; back at the rim. Most points after BE_ENDS ends wins; the last bell ends
;; the round.
;;
;; The wave is a function of the tick into play and the ball's own place,
;; worked in push on either bank, so the prediction slides your ball out of
;; the house exactly as the confirmed world will. The scores and the bumps'
;; kick are the confirmed world's (tick; the kicks' ticks in PG_S), a round
;; trip late on a page as any bump is.

;; (x, z) from the stage's centre on bank d.
(func $be_off (param $d i32) (param $x f32) (param $z f32) (result f32 f32)
  (f32.sub (local.get $x) (f32.load offset=@PG_CX (local.get $d)))
  (f32.sub (local.get $z) (f32.load offset=@PG_CX (local.get $d))))

;; The ice for the crowd, and the house on it.
(func $be_setup (param $n i32)
  (local $rn f32) (local $hs f32) (local $r4 f32) (local $rad f32)
  (local.set $rn (f32.sqrt (f32.convert_i32_u (local.get $n))))
  (local.set $hs (f32.max (f32.const 1) (f32.mul (local.get $rn) (f32.const @BE_HS))))
  (local.set $r4 (f32.mul (f32.const @BE_R4) (local.get $hs)))
  (local.set $rad (f32.min (f32.add (local.get $r4) (!madd (local.get $rn) (f32.const @BE_MK) (f32.const @BE_M0))) (f32.const @BE_RMAX)))
  (!chk (local.get $rad) 120 (local.get $n))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_SCORE))
  (i32.store (i32.const @PG_LEN) (i32.const @BE_LEN))
  (i32.store (i32.const @PG_RESPAWN) (i32.const @BE_RESPAWN))
  (i32.store (i32.const @PG_FLAGS) (i32.const @(PGF_BUMPS | PGF_NOKICK)))
  (f32.store (i32.const @PG_SIZE) (local.get $rad))
  (f32.store (i32.const @PG_ACC) (f32.const @BE_ACC))
  (f32.store (i32.const @PG_DRAG) (f32.const @BE_DRAG))
  (f32.store (i32.const @PG_IDLE) (f32.const @BE_IDLE))
  (f32.store (i32.const @(PG_H + BE_RAD)) (local.get $rad))
  (f32.store (i32.const @(PG_H + BE_RING)) (f32.mul (f32.const @BE_R1) (local.get $hs)))
  (f32.store (i32.const @(PG_H + BE_RING + 4)) (f32.mul (f32.const @BE_R2) (local.get $hs)))
  (f32.store (i32.const @(PG_H + BE_RING + 8)) (f32.mul (f32.const @BE_R3) (local.get $hs)))
  (f32.store (i32.const @(PG_H + BE_RING + 12)) (local.get $r4)))

;; Ball i of n on a sunflower spiral over the ice round the house (from
;; BE_SPAWN past its edge to BE_SPAWN in from the rim), so the first end
;; opens with a rush in; a respawn (i of 1024) at the rim, BE_SPAWN in.
(func $be_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $r0 f32) (local $r1 f32) (local $rr f32) (local $s f32) (local $c f32) (local $cx f32)
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (local.set $r1 (f32.sub (f32.load (i32.const @(PG_H + BE_RAD))) (f32.const @BE_SPAWN)))
  (if (i32.eq (local.get $n) (i32.const 1024))
    (then
      (call $sincos (i32.shl (local.get $i) (i32.const 4)))
      (local.set $c) (local.set $s)
      (return (!madd (local.get $c) (local.get $r1) (local.get $cx)) (f32.const @PLAT_Y) (!madd (local.get $s) (local.get $r1) (local.get $cx)))))
  (local.set $r0 (f32.add (f32.load (i32.const @(PG_H + BE_RING + 12))) (f32.const @BE_SPAWN)))
  (local.set $rr (f32.sqrt (!madd (f32.sub (f32.mul (local.get $r1) (local.get $r1)) (f32.mul (local.get $r0) (local.get $r0)))
                                  (f32.div (f32.add (f32.convert_i32_u (local.get $i)) (f32.const 0.5))
                                           (f32.convert_i32_u (select (local.get $n) (i32.const 1) (local.get $n))))
                                  (f32.mul (local.get $r0) (local.get $r0)))))
  (call $sincos (i32.mul (local.get $i) (i32.const 6258))) ;; the golden angle, in 1/16384 turn
  (local.set $c) (local.set $s)
  (!madd (local.get $c) (local.get $rr) (local.get $cx))
  (f32.const @PLAT_Y)
  (!madd (local.get $s) (local.get $rr) (local.get $cx)))

(func $be_start)
(func $be_begin (param $p i32) (param $d i32))

;; The ice's top under (x, z) if (x, z) is on it, on bank d.
(func $be_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (local $r f32) (local $dx f32) (local $dz f32)
  (if (f32.lt (local.get $y) (f32.const @PLAT_Y)) (then (return (f32.const -1000))))
  (local.set $r (f32.load offset=@(PG_H + BE_RAD) (local.get $d)))
  (call $be_off (local.get $d) (local.get $x) (local.get $z))
  (local.set $dz) (local.set $dx)
  (if (result f32) (f32.le (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))) (f32.mul (local.get $r) (local.get $r)))
    (then (f32.const @PLAT_Y))
    (else (f32.const -1000))))

;; The shove wave, on bank d: a ticks after end k's bell (k from 1, the last
;; one's ending the round) its front is a BE_WAVEDT out from the middle;
;; ball p within BE_BAND inside it, and not past the house's edge by more
;; than BE_CLR, goes out at least BE_WK (edge + BE_WM - its distance) m/s,
;; its way round kept, and is popped off the ice (once: in the air it isn't
;; popped again). Dead on the middle it goes out its slot's way round.
(func $be_push (param $p i32) (param $d i32)
  (local $pb i32) (local $fl i32) (local $t i32) (local $k i32) (local $a i32)
  (local $f f32) (local $lo f32) (local $r4 f32) (local $dx f32) (local $dz f32) (local $r2 f32) (local $r f32)
  (local $nx f32) (local $nz f32) (local $vx f32) (local $vz f32) (local $vo f32) (local $w f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
  (if (i32.and (local.get $fl) (i32.const @(PF_DEAD | PF_FALL))) (then (return)))
  (local.set $t (call $p_t (local.get $d)))
  (local.set $k (i32.div_u (local.get $t) (i32.const @BE_END)))
  (local.set $a (i32.sub (local.get $t) (i32.mul (local.get $k) (i32.const @BE_END))))
  (if (i32.or (i32.or (i32.eqz (local.get $k)) (i32.ge_u (local.get $k) (i32.const @BE_ENDS))) (i32.eqz (local.get $a))) (then (return)))
  (local.set $f (f32.mul (f32.convert_i32_u (local.get $a)) (f32.const @BE_WAVEDT)))
  (local.set $lo (f32.sub (local.get $f) (f32.const @BE_BAND)))
  (local.set $r4 (f32.load offset=@(PG_H + BE_RING + 12) (local.get $d)))
  (if (f32.gt (local.get $lo) (f32.add (local.get $r4) (f32.const @BE_CLR))) (then (return)))
  (call $be_off (local.get $d) (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (local.set $dz) (local.set $dx)
  (local.set $r2 (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))))
  (if (f32.gt (local.get $r2) (f32.mul (local.get $f) (local.get $f))) (then (return)))
  (if (i32.and (f32.gt (local.get $lo) (f32.const 0)) (f32.lt (local.get $r2) (f32.mul (local.get $lo) (local.get $lo)))) (then (return)))
  (local.set $r (f32.sqrt (local.get $r2)))
  (if (f32.gt (local.get $r) (f32.add (local.get $r4) (f32.const @BE_CLR))) (then (return)))
  (if (f32.lt (local.get $r) (f32.const 0.01))
    (then
      (call $sincos (i32.mul (local.get $p) (i32.const 6258)))
      (local.set $nx) (local.set $nz))
    (else
      (local.set $nx (f32.div (local.get $dx) (local.get $r)))
      (local.set $nz (f32.div (local.get $dz) (local.get $r)))))
  (local.set $w (f32.mul (f32.const @BE_WK) (f32.sub (f32.add (local.get $r4) (f32.const @BE_WM)) (local.get $r))))
  (local.set $vx (!at f32 @(PLAYERS + P_VX) (local.get $pb)))
  (local.set $vz (!at f32 @(PLAYERS + P_VZ) (local.get $pb)))
  (local.set $vo (!madd (local.get $vx) (local.get $nx) (f32.mul (local.get $vz) (local.get $nz))))
  (if (f32.lt (local.get $vo) (local.get $w))
    (then
      (local.set $vx (!madd (local.get $nx) (f32.sub (local.get $w) (local.get $vo)) (local.get $vx)))
      (local.set $vz (!madd (local.get $nz) (f32.sub (local.get $w) (local.get $vo)) (local.get $vz)))
      (!chk (local.get $vx) 121 (local.get $p))
      (!chk (local.get $vz) 121 (local.get $p))
      (!put f32 @(PLAYERS + P_VX) (local.get $pb) (local.get $vx))
      (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (local.get $vz))))
  (if (i32.and (local.get $fl) (i32.const @PF_GROUND))
    (then
      (!put f32 @(PLAYERS + P_VY) (local.get $pb) (f32.max (!at f32 @(PLAYERS + P_VY) (local.get $pb)) (f32.const @BE_POP)))
      (!put u8 @(PLAYERS + P_FL) (local.get $pb) (i32.and (local.get $fl) (i32.const @(255 ^ PF_GROUND)))))))

;; End k's bell: every ball in (not down, not going down), in slot order,
;; scores by the ring its centre is in, doubled for the last BE_DOUBLE ends;
;; a scorer's PG_M says what it took. BE_FX_BULL for each ball in the bull,
;; then BE_FX_BELL.
(func $be_bell (param $k i32)
  (local $p i32) (local $pb i32) (local $ring i32) (local $pts i32) (local $s i32) (local $n i32) (local $best i32) (local $who i32) (local $dbl i32)
  (local $dx f32) (local $dz f32) (local $r2 f32)
  (local.set $dbl (i32.gt_u (local.get $k) (i32.const @(BE_ENDS - BE_DOUBLE))))
  (local.set $who (i32.const 255))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (if (call $p_in (local.get $pb))
      (then
        (call $be_off (i32.const 0) (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
        (local.set $dz) (local.set $dx)
        (local.set $r2 (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))))
        ;; the innermost ring it's in: 1 the bull .. 4 the blue, 0 none
        (local.set $ring (i32.const 0))
        (block $found
          (!for $s (i32.const 0) (i32.const 4)
            (if (f32.le (local.get $r2) (call $be_sq (f32.load offset=@(PG_H + BE_RING) (i32.shl (local.get $s) (i32.const 2)))))
              (then (local.set $ring (i32.add (local.get $s) (i32.const 1))) (br $found)))))
        (if (local.get $ring)
          (then
            (local.set $pts (i32.shl (!tab BE_PTS (i32.sub (local.get $ring) (i32.const 1))) (local.get $dbl)))
            (local.set $s (i32.add (!at u16 @(PLAYERS + PG_SCORE) (local.get $pb)) (local.get $pts)))
            (!put u16 @(PLAYERS + PG_SCORE) (local.get $pb) (select (local.get $s) (i32.const 65535) (i32.lt_u (local.get $s) (i32.const 65535))))
            (!put i32 @(PLAYERS + PG_M) (local.get $pb)
              (i32.or (i32.or (i32.shl (local.get $k) (i32.const 16)) (i32.shl (local.get $ring) (i32.const 8))) (local.get $pts)))
            (!inc $n)
            (if (i32.gt_u (local.get $pts) (local.get $best)) (then (local.set $best (local.get $pts)) (local.set $who (local.get $p))))
            (if (i32.eq (local.get $ring) (i32.const 1))
              (then (call $fx (i32.const 0) (i32.const @BE_FX_BULL) (local.get $p) (local.get $k)
                              (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (!at f32 @(PLAYERS + P_PZ) (local.get $pb))
                              (f32.convert_i32_u (local.get $pts))))))))))
  (call $fx (i32.const 0) (i32.const @BE_FX_BELL) (local.get $who) (local.get $k)
            (f32.load (i32.const @PG_CX)) (f32.const @PLAT_Y) (f32.load (i32.const @PG_CX)) (f32.convert_i32_u (local.get $n))))

(func $be_sq (param $x f32) (result f32) (f32.mul (local.get $x) (local.get $x)))

;; Once a tick in play: the bumps' kick, then the bell on the tick an end
;; ends. $b_bumps has just bounced every pair that met, elastic (PGF_NOKICK),
;; and set both balls' B_HITBY to each other and B_HITT to CREDIT_TICKS (the
;; round's loop counts it down after this). Each such pair, once, parting
;; at BE_KMIN m/s or more (the speed they met at, the bounce given back),
;; and neither of them kicked in the last BE_KGAP ticks, is kicked BE_KICKK
;; times that speed more apart, at most BE_KMAX, shared by weight. A ball
;; that met two on one tick keeps only its last.
(func $be_tick
  (local $t i32) (local $now i32) (local $p i32) (local $pb i32) (local $q i32) (local $qb i32)
  (local $dx f32) (local $dz f32) (local $dd f32) (local $up f32) (local $uq f32) (local $s f32) (local $kick f32)
  (local.set $now (i32.load (i32.const @HDR_TICK)))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (local.set $q (!at u8 @(PLAYERS + B_HITBY) (local.get $pb)))
    (local.set $qb (i32.shl (local.get $q) (i32.const 6)))
    (if (i32.and (i32.and (i32.gt_u (local.get $q) (local.get $p)) (i32.eq (!at u16 @(PLAYERS + B_HITT) (local.get $pb)) (i32.const @CREDIT_TICKS)))
                 (i32.and (i32.eq (!at u8 @(PLAYERS + B_HITBY) (local.get $qb)) (local.get $p)) (i32.eq (!at u16 @(PLAYERS + B_HITT) (local.get $qb)) (i32.const @CREDIT_TICKS))))
      (then
        (if (i32.and (i32.and (call $p_in (local.get $pb)) (call $p_in (local.get $qb)))
                     (i32.and (i32.ge_u (i32.sub (local.get $now) (!ld i32 @(PG_S + BE_KAT) (local.get $p))) (i32.const @BE_KGAP))
                              (i32.ge_u (i32.sub (local.get $now) (!ld i32 @(PG_S + BE_KAT) (local.get $q))) (i32.const @BE_KGAP))))
          (then
            (local.set $dx (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $qb)) (!at f32 @(PLAYERS + P_PX) (local.get $pb))))
            (local.set $dz (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $qb)) (!at f32 @(PLAYERS + P_PZ) (local.get $pb))))
            (local.set $dd (f32.sqrt (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz)))))
            (if (f32.gt (local.get $dd) (f32.const 0.01))
              (then
                (local.set $dx (f32.div (local.get $dx) (local.get $dd)))
                (local.set $dz (f32.div (local.get $dz) (local.get $dd)))
                (local.set $s (!madd (f32.sub (!at f32 @(PLAYERS + P_VX) (local.get $qb)) (!at f32 @(PLAYERS + P_VX) (local.get $pb))) (local.get $dx)
                                     (f32.mul (f32.sub (!at f32 @(PLAYERS + P_VZ) (local.get $qb)) (!at f32 @(PLAYERS + P_VZ) (local.get $pb))) (local.get $dz))))
                (if (f32.ge (local.get $s) (f32.const @BE_KMIN))
                  (then
                    (local.set $up (f32.div (f32.const 1) (call $b_mass (local.get $pb))))
                    (local.set $uq (f32.div (f32.const 1) (call $b_mass (local.get $qb))))
                    (local.set $kick (f32.div (f32.min (f32.mul (local.get $s) (f32.const @BE_KICKK)) (f32.const @BE_KMAX)) (f32.add (local.get $up) (local.get $uq))))
                    (!chk (local.get $kick) 122 (local.get $p))
                    (!put f32 @(PLAYERS + P_VX) (local.get $pb) (f32.sub (!at f32 @(PLAYERS + P_VX) (local.get $pb)) (f32.mul (local.get $dx) (f32.mul (local.get $kick) (local.get $up)))))
                    (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (f32.sub (!at f32 @(PLAYERS + P_VZ) (local.get $pb)) (f32.mul (local.get $dz) (f32.mul (local.get $kick) (local.get $up)))))
                    (!put f32 @(PLAYERS + P_VX) (local.get $qb) (!madd (local.get $dx) (f32.mul (local.get $kick) (local.get $uq)) (!at f32 @(PLAYERS + P_VX) (local.get $qb))))
                    (!put f32 @(PLAYERS + P_VZ) (local.get $qb) (!madd (local.get $dz) (f32.mul (local.get $kick) (local.get $uq)) (!at f32 @(PLAYERS + P_VZ) (local.get $qb))))
                    (!st i32 @(PG_S + BE_KAT) (local.get $p) (local.get $now))
                    (!st i32 @(PG_S + BE_KAT) (local.get $q) (local.get $now)))))))))))
  (local.set $t (call $p_t (i32.const 0)))
  (if (i32.and (i32.ne (local.get $t) (i32.const 0)) (i32.eqz (i32.rem_u (local.get $t) (i32.const @BE_END))))
    (then
      (if (i32.le_u (i32.div_u (local.get $t) (i32.const @BE_END)) (i32.const @BE_ENDS))
        (then (call $be_bell (i32.div_u (local.get $t) (i32.const @BE_END))))))))

(func $be_over (result i32) (i32.const 0))
(func $be_out (param $p i32))
