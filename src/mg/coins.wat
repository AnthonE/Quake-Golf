;; COIN RUSH: coins rain onto a disc over the sea, and a ball that rolls into
;; one takes it (PG_SCORE, placed by it at the time). A ball bumped hard loses
;; up to CR_KNOCK of them, knocked loose for anyone to take; a ball that falls
;; off spills half its coins back in over the rim. Bumpers stand on the disc:
;; they throw a ball off, and a lit one pays it CR_BPAY. Every CR_JACKP a
;; jackpot is called CR_JACKW ahead and erupts a fountain of coins; the last
;; 15 s are a frenzy, the rain twice as fast and richer.
;;
;; The ball's roll only ever meets the disc and the bumpers, fixed at setup
;; (the radius in PG_H, the posts in PG_S), so the prediction is exact. The
;; coins are the confirmed world's: tick() rains them ($rand), throws them,
;; and hands each to the first ball by slot within reach of it; a coin's
;; flight is a function of the tick from its record, so every client draws it
;; where the sim has it. Taking, hits and spills arrive a round trip late, as
;; any bump does.

;; The stage's centre, x and z alike.
(func $cr_c (result f32) (f32.load (i32.const @PG_CX)))

;; Coin record a (its byte offset in CR_COINS) on tick t: flying from its
;; launch to where it lies, then lying there.
(func $cr_at (param $a i32) (param $t i32) (result f32 f32 f32)
  (local $tau i32) (local $air i32) (local $u f32) (local $x f32) (local $z f32) (local $x0 f32) (local $y0 f32) (local $z0 f32)
  (local.set $x (f32.load offset=@(PG_BIG + CR_COINS + CR_C_X) (local.get $a)))
  (local.set $z (f32.load offset=@(PG_BIG + CR_COINS + CR_C_Z) (local.get $a)))
  (local.set $tau (i32.sub (local.get $t) (i32.load offset=@(PG_BIG + CR_COINS + CR_C_T0) (local.get $a))))
  (local.set $air (i32.load16_u offset=@(PG_BIG + CR_COINS + CR_C_AIR) (local.get $a)))
  (if (i32.ge_s (local.get $tau) (local.get $air))
    (then (return (local.get $x) (f32.const @(+PLAT_Y + CR_CY)) (local.get $z))))
  (local.set $u (f32.div (f32.convert_i32_s (local.get $tau)) (f32.convert_i32_u (local.get $air))))
  (local.set $x0 (f32.load offset=@(PG_BIG + CR_COINS + CR_C_X0) (local.get $a)))
  (local.set $y0 (f32.load offset=@(PG_BIG + CR_COINS + CR_C_Y0) (local.get $a)))
  (local.set $z0 (f32.load offset=@(PG_BIG + CR_COINS + CR_C_Z0) (local.get $a)))
  (!madd (f32.sub (local.get $x) (local.get $x0)) (local.get $u) (local.get $x0))
  (f32.add (!madd (f32.sub (f32.const @(+PLAT_Y + CR_CY)) (local.get $y0)) (local.get $u) (local.get $y0))
           (f32.mul (f32.mul (f32.mul (f32.load offset=@(PG_BIG + CR_COINS + CR_C_H) (local.get $a)) (f32.const 4)) (local.get $u))
                    (f32.sub (f32.const 1) (local.get $u))))
  (!madd (f32.sub (local.get $z) (local.get $z0)) (local.get $u) (local.get $z0)))

;; A coin in the first free record from the cursor on: thrown from (x0, y0,
;; z0) on tick t0 to lie at (x, z) air ticks later, h m of arc, worth v. 0 if
;; every record is taken (the coin isn't made).
(func $cr_coin (param $x0 f32) (param $y0 f32) (param $z0 f32) (param $x f32) (param $z f32) (param $h f32) (param $t0 i32) (param $air i32) (param $v i32) (param $kind i32) (result i32)
  (local $k i32) (local $c i32) (local $a i32)
  (!chk (local.get $x0) 90 (local.get $kind))
  (!chk (local.get $y0) 90 (local.get $kind))
  (!chk (local.get $z0) 90 (local.get $kind))
  (!chk (local.get $x) 91 (local.get $kind))
  (!chk (local.get $z) 91 (local.get $kind))
  (!chk (local.get $h) 91 (local.get $kind))
  (local.set $c (i32.load (i32.const @(PG_H + CR_CURSOR))))
  (!for $k (i32.const 0) (i32.const @CR_MAX)
    (local.set $a (i32.shl (local.get $c) (i32.const 5)))
    (local.set $c (i32.and (i32.add (local.get $c) (i32.const 1)) (i32.const @(CR_MAX - 1))))
    (if (i32.eqz (i32.load8_u offset=@(PG_BIG + CR_COINS + CR_C_V) (local.get $a)))
      (then
        (f32.store offset=@(PG_BIG + CR_COINS + CR_C_X) (local.get $a) (local.get $x))
        (f32.store offset=@(PG_BIG + CR_COINS + CR_C_Z) (local.get $a) (local.get $z))
        (f32.store offset=@(PG_BIG + CR_COINS + CR_C_X0) (local.get $a) (local.get $x0))
        (f32.store offset=@(PG_BIG + CR_COINS + CR_C_Y0) (local.get $a) (local.get $y0))
        (f32.store offset=@(PG_BIG + CR_COINS + CR_C_Z0) (local.get $a) (local.get $z0))
        (f32.store offset=@(PG_BIG + CR_COINS + CR_C_H) (local.get $a) (local.get $h))
        (i32.store offset=@(PG_BIG + CR_COINS + CR_C_T0) (local.get $a) (local.get $t0))
        (i32.store16 offset=@(PG_BIG + CR_COINS + CR_C_AIR) (local.get $a) (local.get $air))
        (i32.store8 offset=@(PG_BIG + CR_COINS + CR_C_V) (local.get $a) (local.get $v))
        (i32.store8 offset=@(PG_BIG + CR_COINS + CR_C_KIND) (local.get $a) (local.get $kind))
        (i32.store (i32.const @(PG_H + CR_CURSOR)) (local.get $c))
        (i32.store (i32.const @(PG_H + CR_LIVE)) (i32.add (i32.load (i32.const @(PG_H + CR_LIVE))) (i32.const 1)))
        (return (i32.const 1)))))
  (i32.const 0))

;; (x, z) brought in to lie at least CR_RIM inside the rim.
(func $cr_in (param $x f32) (param $z f32) (result f32 f32)
  (local $dx f32) (local $dz f32) (local $d f32) (local $m f32)
  (local.set $dx (f32.sub (local.get $x) (call $cr_c)))
  (local.set $dz (f32.sub (local.get $z) (call $cr_c)))
  (local.set $m (f32.sub (f32.load (i32.const @(PG_H + CR_RAD))) (f32.const @CR_RIM)))
  (local.set $d (f32.sqrt (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz)))))
  (if (f32.gt (local.get $d) (local.get $m))
    (then
      (local.set $m (f32.div (local.get $m) (local.get $d)))
      (local.set $x (!madd (local.get $dx) (local.get $m) (call $cr_c)))
      (local.set $z (!madd (local.get $dz) (local.get $m) (call $cr_c)))))
  (local.get $x)
  (local.get $z))

;; (x, z) moved out of every bumper to at least m from its axis, radially.
(func $cr_clear (param $x f32) (param $z f32) (param $m f32) (result f32 f32)
  (local $i i32) (local $b i32) (local $dx f32) (local $dz f32) (local $d f32)
  (!for $i (i32.const 0) (i32.load (i32.const @(PG_H + CR_NB)))
    (local.set $b (i32.shl (local.get $i) (i32.const 4)))
    (local.set $dx (f32.sub (local.get $x) (f32.load offset=@(PG_S + CR_BUMP) (local.get $b))))
    (local.set $dz (f32.sub (local.get $z) (f32.load offset=@(PG_S + CR_BUMP + 4) (local.get $b))))
    (local.set $d (f32.sqrt (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz)))))
    (if (f32.lt (local.get $d) (local.get $m))
      (then
        (if (f32.lt (local.get $d) (f32.const 0.001)) (then (local.set $dx (f32.const 1)) (local.set $dz (f32.const 0)) (local.set $d (f32.const 1))))
        (local.set $x (!madd (f32.div (local.get $dx) (local.get $d)) (local.get $m) (f32.load offset=@(PG_S + CR_BUMP) (local.get $b))))
        (local.set $z (!madd (f32.div (local.get $dz) (local.get $d)) (local.get $m) (f32.load offset=@(PG_S + CR_BUMP + 4) (local.get $b)))))))
  (local.get $x)
  (local.get $z))

;; The disc for the crowd, a gentle brake, and the bumpers on a sunflower.
(func $cr_setup (param $n i32)
  (local $rad f32) (local $nb i32) (local $i i32) (local $x f32) (local $z f32)
  (local.set $rad (f32.min (!madd (f32.sqrt (f32.convert_i32_u (local.get $n))) (f32.const @CR_RK) (f32.const @CR_R0)) (f32.const @CR_RMAX)))
  (!chk (local.get $rad) 92 (local.get $n))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_SCORE))
  (i32.store (i32.const @PG_LEN) (i32.const @CR_LEN))
  (f32.store (i32.const @PG_SIZE) (local.get $rad))
  (f32.store (i32.const @PG_IDLE) (f32.const @CR_IDLE))
  (f32.store (i32.const @(PG_H + CR_RAD)) (local.get $rad))
  (local.set $nb (i32.trunc_sat_f32_u (f32.div (f32.mul (local.get $rad) (local.get $rad)) (f32.const @CR_BAREA))))
  (if (i32.lt_u (local.get $nb) (i32.const @CR_NBMIN)) (then (local.set $nb (i32.const @CR_NBMIN))))
  (if (i32.gt_u (local.get $nb) (i32.const @CR_NBMAX)) (then (local.set $nb (i32.const @CR_NBMAX))))
  (i32.store (i32.const @(PG_H + CR_NB)) (local.get $nb))
  (!for $i (i32.const 0) (local.get $nb)
    (call $p_disc (i32.add (local.get $i) (i32.const 1)) (i32.add (local.get $nb) (i32.const 1)) (f32.mul (local.get $rad) (f32.const @CR_BRING)))
    (local.set $z) (local.set $x)
    (!chk (local.get $x) 96 (local.get $i))
    (!chk (local.get $z) 96 (local.get $i))
    (f32.store offset=@(PG_S + CR_BUMP) (i32.shl (local.get $i) (i32.const 4)) (local.get $x))
    (f32.store offset=@(PG_S + CR_BUMP + 4) (i32.shl (local.get $i) (i32.const 4)) (local.get $z))))

;; A sunflower spiral over the middle of the disc, clear of the bumpers.
(func $cr_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $x f32) (local $z f32)
  (call $p_disc (local.get $i) (local.get $n) (f32.mul (f32.load (i32.const @(PG_H + CR_RAD))) (f32.const @CR_SPAWN)))
  (local.set $z) (local.set $x)
  (call $cr_clear (local.get $x) (local.get $z) (f32.const @(CR_BR + 1.5)))
  (local.set $z) (local.set $x)
  (local.get $x) (f32.const @PLAT_Y) (local.get $z))

;; Every ball's velocity and hard bumps as play starts, for the first tick's hits.
(func $cr_start
  (local $p i32)
  (!for $p (i32.const 0) (i32.const @NPLAYER) (call $cr_keep (local.get $p))))

(func $cr_begin (param $p i32) (param $d i32))

;; Slot p's velocity and hard bumps kept for the next tick's hit test.
(func $cr_keep (param $p i32)
  (local $pb i32) (local $s i32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (local.set $s (i32.shl (local.get $p) (i32.const 4)))
  (f32.store offset=@(PG_S + CR_BALL + CR_B_VX) (local.get $s) (!at f32 @(PLAYERS + P_VX) (local.get $pb)))
  (f32.store offset=@(PG_S + CR_BALL + CR_B_VZ) (local.get $s) (!at f32 @(PLAYERS + P_VZ) (local.get $pb)))
  (i32.store16 offset=@(PG_S + CR_BALL + CR_B_BUMPS) (local.get $s) (!at u16 @(PLAYERS + B_BUMPS) (local.get $pb))))

;; The disc's top, if (x, z) is on it.
(func $cr_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (local $r f32) (local $dx f32) (local $dz f32)
  (if (f32.lt (local.get $y) (f32.const @PLAT_Y)) (then (return (f32.const -1000))))
  (local.set $r (f32.load offset=@(PG_H + CR_RAD) (local.get $d)))
  (local.set $dx (f32.sub (local.get $x) (f32.load offset=@PG_CX (local.get $d))))
  (local.set $dz (f32.sub (local.get $z) (f32.load offset=@PG_CX (local.get $d))))
  (if (result f32) (f32.le (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))) (f32.mul (local.get $r) (local.get $r)))
    (then (f32.const @PLAT_Y))
    (else (f32.const -1000))))

;; The bumpers on ball p (bank d): one it rolls into puts it back on its
;; surface and throws it off, its speed into the post turned round and made
;; at least CR_KICK, and marks the ball's PG_M with the tick and the post
;; (tick() pays from it). The posts are fixed for the round, so either bank's
;; ball meets the same ones and is marked alike.
(func $cr_push (param $p i32) (param $d i32)
  (local $pb i32) (local $i i32) (local $b i32) (local $nb i32) (local $hit i32)
  (local $px f32) (local $py f32) (local $pz f32) (local $vx f32) (local $vz f32) (local $rr f32)
  (local $bx f32) (local $bz f32) (local $dx f32) (local $dz f32) (local $d2 f32) (local $dd f32) (local $nx f32) (local $nz f32) (local $vn f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (if (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_FALL)) (then (return)))
  (local.set $py (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
  (if (f32.ge (local.get $py) (f32.const @(+PLAT_Y + CR_BH))) (then (return)))
  (local.set $px (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (local.set $pz (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (local.set $vx (!at f32 @(PLAYERS + P_VX) (local.get $pb)))
  (local.set $vz (!at f32 @(PLAYERS + P_VZ) (local.get $pb)))
  (local.set $rr (f32.add (f32.const @CR_BR) (call $b_rad (local.get $pb))))
  (local.set $nb (i32.load offset=@(PG_H + CR_NB) (local.get $d)))
  (!for $i (i32.const 0) (local.get $nb)
    (local.set $b (i32.shl (local.get $i) (i32.const 4)))
    (local.set $bx (f32.load offset=@(PG_S + CR_BUMP) (local.get $b)))
    (local.set $bz (f32.load offset=@(PG_S + CR_BUMP + 4) (local.get $b)))
    (local.set $dx (f32.sub (local.get $px) (local.get $bx)))
    (local.set $dz (f32.sub (local.get $pz) (local.get $bz)))
    (local.set $d2 (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))))
    (if (f32.lt (local.get $d2) (f32.mul (local.get $rr) (local.get $rr)))
      (then
        (local.set $dd (f32.sqrt (f32.max (local.get $d2) (f32.const 1e-6))))
        ;; dead on its axis: out along x
        (if (f32.lt (local.get $d2) (f32.const 1e-6)) (then (local.set $dx (local.get $dd)) (local.set $dz (f32.const 0))))
        (local.set $nx (f32.div (local.get $dx) (local.get $dd)))
        (local.set $nz (f32.div (local.get $dz) (local.get $dd)))
        (local.set $px (!madd (local.get $nx) (f32.add (local.get $rr) (f32.const 0.01)) (local.get $bx)))
        (local.set $pz (!madd (local.get $nz) (f32.add (local.get $rr) (f32.const 0.01)) (local.get $bz)))
        (local.set $vn (!madd (local.get $vx) (local.get $nx) (f32.mul (local.get $vz) (local.get $nz))))
        (if (f32.lt (local.get $vn) (f32.const 0))
          (then
            (local.set $vx (f32.sub (local.get $vx) (f32.mul (local.get $nx) (f32.mul (local.get $vn) (f32.const 2)))))
            (local.set $vz (f32.sub (local.get $vz) (f32.mul (local.get $nz) (f32.mul (local.get $vn) (f32.const 2)))))
            (local.set $vn (f32.neg (local.get $vn)))))
        (if (f32.lt (local.get $vn) (f32.const @CR_KICK))
          (then
            (local.set $vx (!madd (local.get $nx) (f32.sub (f32.const @CR_KICK) (local.get $vn)) (local.get $vx)))
            (local.set $vz (!madd (local.get $nz) (f32.sub (f32.const @CR_KICK) (local.get $vn)) (local.get $vz)))
            (local.set $vn (f32.const @CR_KICK))))
        (call $fx (local.get $d) (i32.const @CR_FX_BUMP) (local.get $p) (local.get $i)
                  (!madd (local.get $nx) (f32.const @CR_BR) (local.get $bx)) (f32.add (local.get $py) (f32.const 1))
                  (!madd (local.get $nz) (f32.const @CR_BR) (local.get $bz)) (local.get $vn))
        (local.set $hit (i32.add (local.get $i) (i32.const 1))))))
  (if (i32.eqz (local.get $hit)) (then (return)))
  (!chk (local.get $px) 93 (local.get $p))
  (!chk (local.get $pz) 93 (local.get $p))
  (!chk (local.get $vx) 94 (local.get $p))
  (!chk (local.get $vz) 94 (local.get $p))
  (!put f32 @(PLAYERS + P_PX) (local.get $pb) (local.get $px))
  (!put f32 @(PLAYERS + P_PZ) (local.get $pb) (local.get $pz))
  (!put f32 @(PLAYERS + P_VX) (local.get $pb) (local.get $vx))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (local.get $vz))
  ;; the tick and the bumper (its index + 1) it was last thrown off, for the confirmed world's pay
  (!put i32 @(PLAYERS + PG_M) (local.get $pb) (i32.or (i32.shl (i32.load offset=@HDR_TICK (local.get $d)) (i32.const 4)) (local.get $hit))))

;; Slot p's score less k (at least 0), or more.
(func $cr_add (param $p i32) (param $k i32)
  (local $pb i32) (local $s i32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (local.set $s (i32.add (!at u16 @(PLAYERS + PG_SCORE) (local.get $pb)) (local.get $k)))
  (if (i32.lt_s (local.get $s) (i32.const 0)) (then (local.set $s (i32.const 0))))
  (if (i32.gt_s (local.get $s) (i32.const 65535)) (then (local.set $s (i32.const 65535))))
  (!put u16 @(PLAYERS + PG_SCORE) (local.get $pb) (local.get $s)))

;; A point at a random spot within r of (x, z), brought in off the rim and
;; out of the bumpers.
(func $cr_near (param $x f32) (param $z f32) (param $r f32) (result f32 f32)
  (local $s f32) (local $c f32)
  (local.set $r (f32.mul (local.get $r) (f32.sqrt (call $p_unit))))
  (call $sincos (call $rand))
  (local.set $c) (local.set $s)
  (call $cr_in (!madd (local.get $c) (local.get $r) (local.get $x)) (!madd (local.get $s) (local.get $r) (local.get $z)))
  (call $cr_land))

;; A coin's spot (x, z) moved out of every bumper to CR_BR + 0.5 from its
;; axis: a post holds a ball's centre 2.3 m off it, so a coin nearer than
;; about 0.8 m could never be taken, and one under 1.3 m lies inside it,
;; unseen. Posts stand far apart (9.8 m at least) and well inside the rim,
;; so the point stays clear of the rest and on the disc.
(func $cr_land (param $x f32) (param $z f32) (result f32 f32)
  (call $cr_clear (local.get $x) (local.get $z) (f32.const @(CR_BR + 0.5))))

;; A wave of rain: a coin for every CR_RAINN balls in the room and one more,
;; each at a random spot of the disc, falling from rest; none past CR_RAINCAP
;; coins in.
(func $cr_rain (param $t i32) (param $frenzy i32)
  (local $n i32) (local $k i32) (local $x f32) (local $z f32)
  (local.set $n (i32.add (i32.const 1) (i32.div_u (i32.load (i32.const @HDR_LIVE)) (i32.const @CR_RAINN))))
  (!for $k (i32.const 0) (local.get $n)
    (if (i32.ge_u (i32.load (i32.const @(PG_H + CR_LIVE))) (i32.const @CR_RAINCAP)) (then (return)))
    (call $cr_near (call $cr_c) (call $cr_c) (f32.load (i32.const @(PG_H + CR_RAD))))
    (local.set $z) (local.set $x)
    (drop (call $cr_coin (local.get $x) (f32.const @(+PLAT_Y + CR_RAINH)) (local.get $z) (local.get $x) (local.get $z)
                         (f32.const @((CR_RAINH - CR_CY) / 4)) (local.get $t) (i32.const @CR_RAINAIR)
                         (select (i32.const @CR_BIGV) (i32.const 1)
                                 (i32.eqz (i32.rem_u (call $rand) (select (i32.const @CR_BIGF) (i32.const @CR_BIG) (local.get $frenzy)))))
                         (i32.const @CR_KRAIN)))))

;; The jackpot called last erupts: its coins thrown up from its spot over
;; CR_JACKSPAN ticks to land round it, every CR_JACKBIG-th one big.
(func $cr_erupt (param $t i32)
  (local $n i32) (local $k i32) (local $jx f32) (local $jz f32) (local $x f32) (local $z f32) (local $r f32)
  (local.set $n (i32.add (i32.const @CR_JACKN0) (i32.div_u (i32.load (i32.const @HDR_LIVE)) (i32.const @CR_JACKNK))))
  (if (i32.gt_u (local.get $n) (i32.const @CR_JACKMAX)) (then (local.set $n (i32.const @CR_JACKMAX))))
  (local.set $jx (f32.load (i32.const @(PG_H + CR_JX))))
  (local.set $jz (f32.load (i32.const @(PG_H + CR_JZ))))
  (local.set $r (!madd (f32.sqrt (f32.convert_i32_u (local.get $n))) (f32.const @CR_JACKRK) (f32.const @CR_JACKR0)))
  (!for $k (i32.const 0) (local.get $n)
    (call $cr_near (local.get $jx) (local.get $jz) (local.get $r))
    (local.set $z) (local.set $x)
    (drop (call $cr_coin (local.get $jx) (f32.const @(+PLAT_Y + 0.8)) (local.get $jz) (local.get $x) (local.get $z)
                         (!madd (call $p_unit) (f32.const 2) (f32.const 3))
                         (i32.add (local.get $t) (i32.div_u (i32.mul (local.get $k) (i32.const @CR_JACKSPAN)) (local.get $n)))
                         (i32.add (i32.const 70) (i32.rem_u (call $rand) (i32.const 50)))
                         (select (i32.const @CR_BIGV) (i32.const 1) (i32.eq (i32.rem_u (local.get $k) (i32.const @CR_JACKBIG)) (i32.const @(CR_JACKBIG - 1))))
                         (i32.const @CR_KJACK))))
  (call $fx (i32.const 0) (i32.const @CR_FX_CALL) (i32.const 255) (i32.const 1) (local.get $jx) (f32.const @PLAT_Y) (local.get $jz) (f32.convert_i32_u (local.get $n))))

;; Ball p bumped hard: k of its coins knocked loose, flying off it in every
;; direction to land a few metres away (as many as there are records for).
(func $cr_knock (param $p i32) (param $k i32) (param $t i32)
  (local $pb i32) (local $i i32) (local $m i32) (local $px f32) (local $py f32) (local $pz f32) (local $x f32) (local $z f32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (local.set $px (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (local.set $py (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (f32.const 1)))
  (local.set $pz (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (!for $i (i32.const 0) (local.get $k)
    (call $sincos (call $rand))
    (local.set $z) (local.set $x)
    (local.set $x (!madd (local.get $x) (!madd (call $p_unit) (f32.const @CR_KNOCKRK) (f32.const @CR_KNOCKR0)) (local.get $px)))
    (local.set $z (!madd (local.get $z) (!madd (call $p_unit) (f32.const @CR_KNOCKRK) (f32.const @CR_KNOCKR0)) (local.get $pz)))
    (call $cr_land (call $cr_in (local.get $x) (local.get $z)))
    (local.set $z) (local.set $x)
    (if (call $cr_coin (local.get $px) (local.get $py) (local.get $pz) (local.get $x) (local.get $z) (f32.const 2.2) (local.get $t)
                       (i32.add (i32.const 60) (i32.rem_u (call $rand) (i32.const 30))) (i32.const 1) (i32.const @CR_KLOOSE))
      (then (!inc $m))))
  (if (i32.eqz (local.get $m)) (then (return)))
  (call $cr_add (local.get $p) (i32.sub (i32.const 0) (local.get $m)))
  (call $fx (i32.const 0) (i32.const @CR_FX_LOSE) (local.get $p) (local.get $m) (local.get $px) (local.get $py) (local.get $pz) (f32.const 0)))

;; Ball p off the rim: half its coins gone, spilled back in over the rim
;; where it went, as big coins and then small, at most CR_SPILLMAX of them;
;; what doesn't fit is the sea's.
(func $cr_spill (param $p i32) (param $t i32)
  (local $pb i32) (local $lost i32) (local $n5 i32) (local $n1 i32) (local $k i32)
  (local $dx f32) (local $dz f32) (local $d f32) (local $ex f32) (local $ez f32) (local $r f32) (local $w f32) (local $x f32) (local $z f32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (local.set $lost (i32.shr_u (!at u16 @(PLAYERS + PG_SCORE) (local.get $pb)) (i32.const 1)))
  (if (i32.eqz (local.get $lost)) (then (return)))
  (call $cr_add (local.get $p) (i32.sub (i32.const 0) (local.get $lost)))
  (local.set $n5 (i32.div_u (local.get $lost) (i32.const @CR_BIGV)))
  (if (i32.gt_u (local.get $n5) (i32.const @CR_SPILLMAX)) (then (local.set $n5 (i32.const @CR_SPILLMAX))))
  (local.set $n1 (i32.sub (local.get $lost) (i32.mul (local.get $n5) (i32.const @CR_BIGV))))
  (if (i32.gt_u (local.get $n1) (i32.sub (i32.const @CR_SPILLMAX) (local.get $n5))) (then (local.set $n1 (i32.sub (i32.const @CR_SPILLMAX) (local.get $n5)))))
  ;; the way out from the centre to the ball, and the rim's point that way
  (local.set $dx (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (call $cr_c)))
  (local.set $dz (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $pb)) (call $cr_c)))
  (local.set $d (f32.sqrt (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz)))))
  (if (f32.lt (local.get $d) (f32.const 0.001)) (then (local.set $dx (f32.const 1)) (local.set $dz (f32.const 0)) (local.set $d (f32.const 1))))
  (local.set $dx (f32.div (local.get $dx) (local.get $d)))
  (local.set $dz (f32.div (local.get $dz) (local.get $d)))
  (local.set $r (f32.load (i32.const @(PG_H + CR_RAD))))
  (local.set $ex (!madd (local.get $dx) (f32.sub (local.get $r) (f32.const 0.3)) (call $cr_c)))
  (local.set $ez (!madd (local.get $dz) (f32.sub (local.get $r) (f32.const 0.3)) (call $cr_c)))
  (!for $k (i32.const 0) (i32.add (local.get $n5) (local.get $n1))
    ;; in from the rim 0 to 6 m, 4 m either side
    (local.set $d (f32.sub (f32.sub (local.get $r) (f32.const @CR_RIM)) (f32.mul (call $p_unit) (f32.const 6))))
    (local.set $w (f32.mul (f32.sub (call $p_unit) (f32.const 0.5)) (f32.const 8)))
    (local.set $x (f32.sub (!madd (local.get $dx) (local.get $d) (call $cr_c)) (f32.mul (local.get $dz) (local.get $w))))
    (local.set $z (!madd (local.get $dx) (local.get $w) (!madd (local.get $dz) (local.get $d) (call $cr_c))))
    (call $cr_land (call $cr_in (local.get $x) (local.get $z)))
    (local.set $z) (local.set $x)
    (drop (call $cr_coin (local.get $ex) (f32.const @(+PLAT_Y + 0.5)) (local.get $ez) (local.get $x) (local.get $z) (f32.const 3) (local.get $t)
                         (i32.add (i32.const 70) (i32.rem_u (call $rand) (i32.const 40)))
                         (select (i32.const @CR_BIGV) (i32.const 1) (i32.lt_u (local.get $k) (local.get $n5))) (i32.const @CR_KLOOSE))))
  (call $fx (i32.const 0) (i32.const @CR_FX_LOSE) (local.get $p) (local.get $lost) (local.get $ex) (f32.const @(+PLAT_Y + 0.5)) (local.get $ez) (f32.const 1)))

;; The round's world, a tick of it, in slot order: each ball's hits, its fall
;; and the lit bumpers it touches; the rain, the jackpots and the frenzy on
;; the clock; then every coin, gone when old, else taken by the first ball by
;; slot within reach of it (a grid of the balls in, by cell, slots ascending).
(func $cr_tick
  (local $t i32) (local $tp i32) (local $frenzy i32) (local $p i32) (local $pb i32) (local $s i32) (local $fl i32) (local $k i32)
  (local $i i32) (local $b i32) (local $nb i32) (local $c i32) (local $a i32) (local $v i32) (local $tau i32) (local $air i32) (local $wait i32)
  (local $m i32) (local $thrown i32) (local $gx i32) (local $gz i32) (local $cx i32) (local $cz i32) (local $q i32) (local $qb i32) (local $best i32) (local $cell i32)
  (local $dx f32) (local $dz f32) (local $dy f32) (local $dv f32) (local $rr f32) (local $x f32) (local $y f32) (local $z f32) (local $o f32)
  (local.set $t (i32.load (i32.const @HDR_TICK)))
  (local.set $tp (call $p_t (i32.const 0)))
  (local.set $frenzy (i32.ge_u (local.get $tp) (i32.const @CR_FRENZY)))
  (local.set $nb (i32.load (i32.const @(PG_H + CR_NB))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (local.set $s (i32.shl (local.get $p) (i32.const 4)))
    (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
    (if (i32.and (local.get $fl) (i32.const @PF_LIVE))
      (then
        (if (call $p_in (local.get $pb))
          (then
            (i32.store8 offset=@(PG_S + CR_BALL + CR_B_FL) (local.get $s) (i32.const 0))
            ;; thrown off a bumper this tick (its push marked PG_M with the tick and the post)
            (local.set $m (!at i32 @(PLAYERS + PG_M) (local.get $pb)))
            (local.set $thrown (i32.and (i32.ne (i32.and (local.get $m) (i32.const 15)) (i32.const 0))
                                        (i32.eq (i32.and (local.get $m) (i32.const -16)) (i32.shl (local.get $t) (i32.const 4)))))
            ;; bumped this tick (the hit's credit fresh), not the one doing the bumping, not just knocked, and its speed
            ;; jumped, not by a post's throw (that would make a graze on the same tick a hard bump)
            (if (i32.and (i32.and (i32.and (i32.eq (!at u16 @(PLAYERS + B_HITT) (local.get $pb)) (i32.const @CREDIT_TICKS))
                                           (i32.eq (!at u16 @(PLAYERS + B_BUMPS) (local.get $pb)) (i32.load16_u offset=@(PG_S + CR_BALL + CR_B_BUMPS) (local.get $s))))
                                  (i32.ge_s (i32.sub (local.get $t) (i32.load offset=@(PG_S + CR_BALL + CR_B_SAFE) (local.get $s))) (i32.const 0)))
                         (i32.eqz (local.get $thrown)))
              (then
                (local.set $dx (f32.sub (!at f32 @(PLAYERS + P_VX) (local.get $pb)) (f32.load offset=@(PG_S + CR_BALL + CR_B_VX) (local.get $s))))
                (local.set $dz (f32.sub (!at f32 @(PLAYERS + P_VZ) (local.get $pb)) (f32.load offset=@(PG_S + CR_BALL + CR_B_VZ) (local.get $s))))
                (local.set $dv (f32.sqrt (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz)))))
                (if (f32.gt (local.get $dv) (f32.const @CR_HARD))
                  (then
                    (local.set $k (i32.add (i32.const 1) (i32.trunc_sat_f32_u (f32.div (f32.sub (local.get $dv) (f32.const @CR_HARD)) (f32.const @CR_HARDK)))))
                    (if (i32.gt_u (local.get $k) (i32.const @CR_KNOCK)) (then (local.set $k (i32.const @CR_KNOCK))))
                    (if (i32.gt_u (local.get $k) (!at u16 @(PLAYERS + PG_SCORE) (local.get $pb))) (then (local.set $k (!at u16 @(PLAYERS + PG_SCORE) (local.get $pb)))))
                    (if (local.get $k)
                      (then
                        (call $cr_knock (local.get $p) (local.get $k) (local.get $t))
                        (i32.store offset=@(PG_S + CR_BALL + CR_B_SAFE) (local.get $s) (i32.add (local.get $t) (i32.const @CR_GRACE)))))))))
            ;; thrown off a bumper this tick: a lit one pays, and goes dark
            (if (local.get $thrown)
              (then
                (local.set $i (i32.sub (i32.and (local.get $m) (i32.const 15)) (i32.const 1)))
                (local.set $b (i32.shl (local.get $i) (i32.const 4)))
                (if (i32.ge_u (local.get $tp) (i32.load offset=@(PG_S + CR_BUMP + 8) (local.get $b)))
                  (then
                    (call $cr_add (local.get $p) (i32.const @CR_BPAY))
                    (i32.store offset=@(PG_S + CR_BUMP + 8) (local.get $b) (i32.add (local.get $tp) (i32.const @CR_BDARK)))
                    (i32.store offset=@(PG_S + CR_BUMP + 12) (local.get $b) (i32.add (i32.load offset=@(PG_S + CR_BUMP + 12) (local.get $b)) (i32.const 1)))
                    (call $fx (i32.const 0) (i32.const @CR_FX_TAKE) (local.get $p) (i32.add (i32.const @CR_MAX) (local.get $i))
                              (f32.load offset=@(PG_S + CR_BUMP) (local.get $b)) (f32.const @(+PLAT_Y + CR_BH))
                              (f32.load offset=@(PG_S + CR_BUMP + 4) (local.get $b)) (f32.const @CR_BPAY)))))))
          (else
            ;; going over the rim: the spill, once a fall
            (if (i32.and (i32.eq (i32.and (local.get $fl) (i32.const @(PF_FALL | PF_DEAD))) (i32.const @PF_FALL))
                         (i32.eqz (i32.and (i32.load8_u offset=@(PG_S + CR_BALL + CR_B_FL) (local.get $s)) (i32.const @CR_FSPILT))))
              (then
                (call $cr_spill (local.get $p) (local.get $t))
                (i32.store8 offset=@(PG_S + CR_BALL + CR_B_FL) (local.get $s) (i32.const @CR_FSPILT))))))
        (call $cr_keep (local.get $p)))))
  ;; the clock: the rain, a jackpot called, a jackpot erupting, the frenzy
  (if (i32.eqz (i32.rem_u (local.get $tp) (select (i32.const @CR_EVERYF) (i32.const @CR_EVERY) (local.get $frenzy))))
    (then (call $cr_rain (local.get $t) (local.get $frenzy))))
  (if (i32.ge_u (local.get $tp) (i32.const @(CR_JACK0 - CR_JACKW)))
    (then
      (local.set $k (i32.sub (local.get $tp) (i32.const @(CR_JACK0 - CR_JACKW))))
      (if (i32.and (i32.eqz (i32.rem_u (local.get $k) (i32.const @CR_JACKP)))
                   (i32.lt_u (i32.add (local.get $tp) (i32.const @CR_JACKW)) (i32.load (i32.const @PG_LEN))))
        (then
          (call $cr_near (call $cr_c) (call $cr_c) (f32.mul (f32.load (i32.const @(PG_H + CR_RAD))) (f32.const @CR_JACKIN)))
          (local.set $z) (local.set $x)
          (call $cr_clear (local.get $x) (local.get $z) (f32.const @(CR_BR + 2)))
          (local.set $z) (local.set $x)
          (!chk (local.get $x) 95 (local.get $tp))
          (!chk (local.get $z) 95 (local.get $tp))
          (f32.store (i32.const @(PG_H + CR_JX)) (local.get $x))
          (f32.store (i32.const @(PG_H + CR_JZ)) (local.get $z))
          (i32.store (i32.const @(PG_H + CR_JK)) (i32.add (i32.div_u (local.get $k) (i32.const @CR_JACKP)) (i32.const 1)))
          (call $fx (i32.const 0) (i32.const @CR_FX_CALL) (i32.const 255) (i32.const 0) (local.get $x) (f32.const @PLAT_Y) (local.get $z) (f32.const 0))))
      ;; (only one called: a clock moved by hand may skip a call)
      (if (i32.and (i32.ge_u (local.get $tp) (i32.const @CR_JACK0)) (i32.eqz (i32.rem_u (i32.sub (local.get $tp) (i32.const @CR_JACK0)) (i32.const @CR_JACKP))))
        (then
          (if (i32.eq (i32.load (i32.const @(PG_H + CR_JK))) (i32.add (i32.div_u (i32.sub (local.get $tp) (i32.const @CR_JACK0)) (i32.const @CR_JACKP)) (i32.const 1)))
            (then (call $cr_erupt (local.get $t))))))))
  (if (i32.eq (local.get $tp) (i32.const @CR_FRENZY))
    (then (call $fx (i32.const 0) (i32.const @CR_FX_CALL) (i32.const 255) (i32.const 2) (call $cr_c) (f32.const @PLAT_Y) (call $cr_c) (f32.const 0))))
  ;; the grid: slots in descending, so each cell's list ascends
  (memory.fill (i32.const @(PG_BIG + CR_GRID)) (i32.const 0xff) (i32.const @(CR_GN * CR_GN * 2)))
  (local.set $o (f32.sub (call $cr_c) (f32.const @(CR_GN * CR_CELL / 2))))
  (local.set $p (i32.const @NPLAYER))
  (block $built
    (loop $next
      (br_if $built (i32.eqz (local.get $p)))
      (local.set $p (i32.sub (local.get $p) (i32.const 1)))
      (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
      (if (call $p_in (local.get $pb))
        (then
          (local.set $gx (i32.trunc_sat_f32_s (f32.floor (f32.mul (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (local.get $o)) (f32.const @(1 / CR_CELL))))))
          (local.set $gz (i32.trunc_sat_f32_s (f32.floor (f32.mul (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $pb)) (local.get $o)) (f32.const @(1 / CR_CELL))))))
          (if (i32.and (i32.lt_u (local.get $gx) (i32.const @CR_GN)) (i32.lt_u (local.get $gz) (i32.const @CR_GN)))
            (then
              (local.set $cell (i32.add (i32.mul (local.get $gz) (i32.const @CR_GN)) (local.get $gx)))
              (!st u16 @(PG_BIG + CR_GNEXT) (local.get $p) (!ld u16 @(PG_BIG + CR_GRID) (local.get $cell)))
              (!st u16 @(PG_BIG + CR_GRID) (local.get $cell) (local.get $p))))))
      (br $next)))
  ;; the coins
  (!for $c (i32.const 0) (i32.const @CR_MAX)
    (local.set $a (i32.shl (local.get $c) (i32.const 5)))
    (local.set $v (i32.load8_u offset=@(PG_BIG + CR_COINS + CR_C_V) (local.get $a)))
    (if (local.get $v)
      (then (block $done
        (local.set $tau (i32.sub (local.get $t) (i32.load offset=@(PG_BIG + CR_COINS + CR_C_T0) (local.get $a))))
        (br_if $done (i32.lt_s (local.get $tau) (i32.const 0)))
        (local.set $air (i32.load16_u offset=@(PG_BIG + CR_COINS + CR_C_AIR) (local.get $a)))
        (if (i32.ge_s (local.get $tau) (i32.add (local.get $air) (i32.const @CR_LIFE)))
          (then
            (i32.store8 offset=@(PG_BIG + CR_COINS + CR_C_V) (local.get $a) (i32.const 0))
            (i32.store (i32.const @(PG_H + CR_LIVE)) (i32.sub (i32.load (i32.const @(PG_H + CR_LIVE))) (i32.const 1)))
            (br $done)))
        (local.set $wait (i32.load8_u offset=@(PG_BIG + CR_COINS + CR_C_KIND) (local.get $a)))
        (local.set $wait (select (i32.const @CR_LOOSE) (select (i32.const @CR_JWAIT) (i32.const 0) (i32.eq (local.get $wait) (i32.const @CR_KJACK)))
                                 (i32.eq (local.get $wait) (i32.const @CR_KLOOSE))))
        (br_if $done (i32.lt_s (local.get $tau) (local.get $wait)))
        (call $cr_at (local.get $a) (local.get $t))
        (local.set $z) (local.set $y) (local.set $x)
        (br_if $done (f32.gt (local.get $y) (f32.const @(+PLAT_Y + CR_GRABH))))
        (local.set $gx (i32.trunc_sat_f32_s (f32.floor (f32.mul (f32.sub (local.get $x) (local.get $o)) (f32.const @(1 / CR_CELL))))))
        (local.set $gz (i32.trunc_sat_f32_s (f32.floor (f32.mul (f32.sub (local.get $z) (local.get $o)) (f32.const @(1 / CR_CELL))))))
        (local.set $best (i32.const @NPLAYER))
        (!for $i (i32.const 0) (i32.const 9)
          (local.set $cx (i32.add (local.get $gx) (i32.sub (i32.rem_u (local.get $i) (i32.const 3)) (i32.const 1))))
          (local.set $cz (i32.add (local.get $gz) (i32.sub (i32.div_u (local.get $i) (i32.const 3)) (i32.const 1))))
          (if (i32.and (i32.lt_u (local.get $cx) (i32.const @CR_GN)) (i32.lt_u (local.get $cz) (i32.const @CR_GN)))
            (then
              (local.set $q (!ld u16 @(PG_BIG + CR_GRID) (i32.add (i32.mul (local.get $cz) (i32.const @CR_GN)) (local.get $cx))))
              (block $cellDone
                (loop $balls
                  (br_if $cellDone (i32.ge_u (local.get $q) (local.get $best)))
                  (local.set $qb (i32.shl (local.get $q) (i32.const 6)))
                  (local.set $rr (f32.add (call $b_rad (local.get $qb)) (f32.const @CR_REACH)))
                  (local.set $dx (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $qb)) (local.get $x)))
                  (local.set $dy (f32.sub (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $qb)) (call $b_rad (local.get $qb))) (local.get $y)))
                  (local.set $dz (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $qb)) (local.get $z)))
                  (if (f32.lt (!dot3 (local.get $dx) (local.get $dy) (local.get $dz) (local.get $dx) (local.get $dy) (local.get $dz)) (f32.mul (local.get $rr) (local.get $rr)))
                    (then (local.set $best (local.get $q)) (br $cellDone)))
                  (local.set $q (!ld u16 @(PG_BIG + CR_GNEXT) (local.get $q)))
                  (br $balls))))))
        (br_if $done (i32.ge_u (local.get $best) (i32.const @NPLAYER)))
        (call $cr_add (local.get $best) (local.get $v))
        (i32.store8 offset=@(PG_BIG + CR_COINS + CR_C_V) (local.get $a) (i32.const 0))
        (i32.store (i32.const @(PG_H + CR_LIVE)) (i32.sub (i32.load (i32.const @(PG_H + CR_LIVE))) (i32.const 1)))
        (call $fx (i32.const 0) (i32.const @CR_FX_TAKE) (local.get $best) (local.get $c) (local.get $x) (local.get $y) (local.get $z) (f32.convert_i32_u (local.get $v))))))))

(func $cr_over (result i32) (i32.const 0))

(func $cr_out (param $p i32))
