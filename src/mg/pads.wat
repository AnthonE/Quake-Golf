;; MUSICAL PADS: a round floor over the sea, drawn as a giant record. The
;; music plays (MP_M0 to MP_M1 ticks, from $p_seed); when it stops pads light
;; up over the floor, one fewer than the balls in up to MP_CHAIRS of them,
;; else half as many, rounded up. MP_WIN ticks later (MP_WIN1 under MP_FEW
;; balls) each pad is held by the ball nearest its centre with its own centre
;; on it, and every other ball is out, unless nobody holds one (then nobody
;; is). The floor closes in to fit the balls left and the music plays again.
;; The last two play for MP_FINALS claims of the one pad. A gold pad's holder
;; gets a power-up; up to MP_GLIDEN balls the pads glide through the scramble.
;;
;; The floor is all that's solid: a disc whose rim (MP_RIMA, MP_RIMB, MP_RIMT
;; in PG_H) starts closing in MP_SHRINK0 ticks after the claim that set it, so
;; ground on either bank is a function of its own tick and header, exact while
;; the prediction runs less than MP_SHRINK0 ahead of the confirmed world. The
;; pads are laid out from $rand as the music starts, a whole song before they
;; light (PG_S); nothing solid, they matter only to the claim, the confirmed
;; world's, like any bump.

;; The floor's radius for n balls.
(func $mp_rad (param $n i32) (result f32)
  (f32.min (!madd (f32.sqrt (f32.convert_i32_u (local.get $n))) (f32.const @MP_RK) (f32.const @MP_R0)) (f32.const @MP_RMAX)))

;; The rim on bank d's tick: MP_RIMA, closing in to MP_RIMB over MP_SHRINKT ticks from MP_RIMT.
(func $mp_rim (param $d i32) (result f32)
  (local $t i32) (local $t0 i32) (local $a f32) (local $k f32)
  (local.set $t (call $p_t (local.get $d)))
  (local.set $t0 (i32.load offset=@(PG_H + MP_RIMT) (local.get $d)))
  (local.set $a (f32.load offset=@(PG_H + MP_RIMA) (local.get $d)))
  (if (i32.le_u (local.get $t) (local.get $t0)) (then (return (local.get $a))))
  (if (i32.ge_u (i32.sub (local.get $t) (local.get $t0)) (i32.const @MP_SHRINKT))
    (then (return (f32.load offset=@(PG_H + MP_RIMB) (local.get $d)))))
  (local.set $k (f32.div (f32.convert_i32_u (i32.sub (local.get $t) (local.get $t0))) (f32.const @MP_SHRINKT)))
  (!madd (f32.sub (f32.load offset=@(PG_H + MP_RIMB) (local.get $d)) (local.get $a)) (local.get $k) (local.get $a)))

;; Balls in now (live, not out, not going out).
(func $mp_in (result i32)
  (local $p i32) (local $n i32)
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (if (call $p_in (i32.shl (local.get $p) (i32.const 6))) (then (!inc $n))))
  (local.get $n))

;; Pads for n balls: one fewer up to MP_CHAIRS, else half, rounded up; at least one.
(func $mp_pads (param $n i32) (result i32)
  (if (i32.le_u (local.get $n) (i32.const @MP_CHAIRS))
    (then (return (select (i32.sub (local.get $n) (i32.const 1)) (i32.const 1) (i32.gt_u (local.get $n) (i32.const 1))))))
  (i32.shr_u (i32.add (local.get $n) (i32.const 1)) (i32.const 1)))

;; Cycle c from tick t into play: the music's length from $p_seed, the
;; scramble's for the balls in, and its pads, laid out now from $rand inside
;; the rim the floor is closing to, each the furthest of MP_TRIES spots from
;; those before it; a gold one among two or more; gliding ones' ends MP_GLIDE
;; off a random way (pulled back in onto the pads' circle).
(func $mp_cycle (param $t i32) (param $c i32)
  (local $n i32) (local $k i32) (local $i i32) (local $j i32) (local $q i32) (local $a i32) (local $stop i32) (local $claim i32)
  (local $ru f32) (local $cx f32) (local $r f32) (local $s f32) (local $co f32) (local $x f32) (local $z f32) (local $dx f32) (local $dz f32)
  (local $d f32) (local $md f32) (local $bd f32) (local $bx f32) (local $bz f32) (local $ex f32) (local $ez f32) (local $gap2 f32)
  (local.set $n (call $mp_in))
  (local.set $k (call $mp_pads (local.get $n)))
  (local.set $stop (i32.add (i32.add (local.get $t) (i32.const @MP_M0))
                            (i32.rem_u (call $p_seed (i32.add (i32.const @MP_KMUSIC) (local.get $c))) (i32.const @(MP_M1 - MP_M0 + 1)))))
  (local.set $claim (i32.add (local.get $stop) (select (i32.const @MP_WIN) (i32.const @MP_WIN1) (i32.ge_u (local.get $n) (i32.const @MP_FEW)))))
  (i32.store (i32.const @(PG_H + MP_CYCLE)) (local.get $c))
  (i32.store (i32.const @(PG_H + MP_START)) (local.get $t))
  (i32.store (i32.const @(PG_H + MP_STOP)) (local.get $stop))
  (i32.store (i32.const @(PG_H + MP_CLAIM)) (local.get $claim))
  (i32.store (i32.const @(PG_H + MP_NEXT)) (i32.add (local.get $claim) (i32.const @MP_PAUSE)))
  (i32.store (i32.const @(PG_H + MP_NPAD)) (local.get $k))
  (i32.store (i32.const @(PG_H + MP_N)) (local.get $n))
  (i32.store (i32.const @(PG_H + MP_GLIDES)) (i32.le_u (local.get $n) (i32.const @MP_GLIDEN)))
  (i32.store (i32.const @(PG_H + MP_GOLD)) (i32.const 255))
  (if (i32.ge_u (local.get $k) (i32.const 2))
    (then (i32.store (i32.const @(PG_H + MP_GOLD)) (i32.rem_u (call $rand) (local.get $k)))))
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (local.set $ru (f32.max (f32.sub (f32.load (i32.const @(PG_H + MP_RIMB))) (f32.const @MP_EDGE)) (f32.const 1)))
  (local.set $gap2 (f32.mul (f32.const @MP_GAP) (f32.const @MP_GAP)))
  (!for $i (i32.const 0) (local.get $k)
    (local.set $bd (f32.const -1))
    (block $spread
      (!for $j (i32.const 0) (i32.const @MP_TRIES)
        (local.set $r (f32.mul (local.get $ru) (f32.sqrt (call $p_unit))))
        (call $sincos (i32.and (call $rand) (i32.const 16383)))
        (local.set $co) (local.set $s)
        (local.set $x (!madd (local.get $co) (local.get $r) (local.get $cx)))
        (local.set $z (!madd (local.get $s) (local.get $r) (local.get $cx)))
        ;; its squared distance to the nearest pad before it, given up once it can't beat the best spot yet
        (local.set $md (f32.const 1e9))
        (block $near
          (!for $q (i32.const 0) (local.get $i)
            (local.set $a (i32.add (i32.const @(PG_S + MP_PADS)) (i32.shl (local.get $q) (i32.const 4))))
            (local.set $dx (f32.sub (local.get $x) (f32.load (local.get $a))))
            (local.set $dz (f32.sub (local.get $z) (f32.load offset=4 (local.get $a))))
            (local.set $md (f32.min (local.get $md) (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz)))))
            (br_if $near (f32.le (local.get $md) (local.get $bd)))))
        (if (f32.gt (local.get $md) (local.get $bd))
          (then (local.set $bd (local.get $md)) (local.set $bx (local.get $x)) (local.set $bz (local.get $z))))
        (br_if $spread (f32.ge (local.get $bd) (local.get $gap2)))))
    (local.set $ex (local.get $bx))
    (local.set $ez (local.get $bz))
    (if (i32.load (i32.const @(PG_H + MP_GLIDES)))
      (then
        (call $sincos (i32.and (call $rand) (i32.const 16383)))
        (local.set $co) (local.set $s)
        (local.set $dx (!madd (local.get $co) (f32.const @MP_GLIDE) (f32.sub (local.get $bx) (local.get $cx))))
        (local.set $dz (!madd (local.get $s) (f32.const @MP_GLIDE) (f32.sub (local.get $bz) (local.get $cx))))
        (local.set $d (f32.sqrt (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz)))))
        (if (f32.gt (local.get $d) (local.get $ru))
          (then
            (local.set $dx (f32.mul (local.get $dx) (f32.div (local.get $ru) (local.get $d))))
            (local.set $dz (f32.mul (local.get $dz) (f32.div (local.get $ru) (local.get $d))))))
        (local.set $ex (f32.add (local.get $cx) (local.get $dx)))
        (local.set $ez (f32.add (local.get $cx) (local.get $dz)))))
    (!chk (local.get $bx) 63 (local.get $i))
    (!chk (local.get $bz) 64 (local.get $i))
    (!chk (local.get $ex) 65 (local.get $i))
    (!chk (local.get $ez) 66 (local.get $i))
    (local.set $a (i32.add (i32.const @(PG_S + MP_PADS)) (i32.shl (local.get $i) (i32.const 4))))
    (f32.store (local.get $a) (local.get $bx))
    (f32.store offset=4 (local.get $a) (local.get $bz))
    (f32.store offset=8 (local.get $a) (local.get $ex))
    (f32.store offset=12 (local.get $a) (local.get $ez)))
  (call $fx (i32.const 0) (i32.const @MP_FX_MUSIC) (i32.const 255) (local.get $c)
            (local.get $cx) (f32.const @PLAT_Y) (local.get $cx) (f32.convert_i32_u (local.get $k))))

;; The music stops: the pads laid out light, fewer if balls have gone since
;; (the last ones dropped, a gold one with them).
(func $mp_stop (param $t i32)
  (local $k i32)
  (local.set $k (call $mp_pads (call $mp_in)))
  (if (i32.lt_u (local.get $k) (i32.load (i32.const @(PG_H + MP_NPAD))))
    (then
      (i32.store (i32.const @(PG_H + MP_NPAD)) (local.get $k))
      (if (i32.or (i32.lt_u (local.get $k) (i32.const 2)) (i32.ge_u (i32.load (i32.const @(PG_H + MP_GOLD))) (local.get $k)))
        (then (i32.store (i32.const @(PG_H + MP_GOLD)) (i32.const 255))))))
  (call $fx (i32.const 0) (i32.const @MP_FX_STOP) (i32.const 255) (i32.load (i32.const @(PG_H + MP_CYCLE)))
            (f32.load (i32.const @PG_CX)) (f32.const @PLAT_Y) (f32.load (i32.const @PG_CX))
            (f32.convert_i32_u (i32.sub (i32.load (i32.const @(PG_H + MP_CLAIM))) (local.get $t)))))

;; The claim: each pad in turn to the ball nearest its centre, with its own
;; centre on it, its bottom near the floor and no pad yet; every other ball
;; out, unless nobody holds one, or it's a point of the final short of the
;; last. The gold pad's holder gets a power-up, and the floor closes in to fit
;; the balls left.
(func $mp_claim (param $t i32)
  (local $i i32) (local $p i32) (local $pb i32) (local $a i32) (local $best i32) (local $held i32) (local $lost i32) (local $g i32) (local $item i32)
  (local $alive i32) (local $owner i32) (local $spare i32)
  (local $x f32) (local $z f32) (local $dx f32) (local $dz f32) (local $d2 f32) (local $bd f32) (local $r f32)
  (memory.fill (i32.const @(PG_S + MP_HOLD)) (i32.const 255) (i32.const @MP_NMAX))
  (memory.fill (i32.const @(PG_S + MP_PADOF)) (i32.const 255) (i32.const @NPLAYER))
  (!for $i (i32.const 0) (i32.load (i32.const @(PG_H + MP_NPAD)))
    (local.set $a (i32.add (i32.const @(PG_S + MP_PADS)) (i32.shl (local.get $i) (i32.const 4))))
    (local.set $x (f32.load offset=8 (local.get $a)))
    (local.set $z (f32.load offset=12 (local.get $a)))
    (local.set $best (i32.const -1))
    (local.set $bd (f32.mul (f32.const @MP_PAD_R) (f32.const @MP_PAD_R)))
    (!for $p (i32.const 0) (i32.const @NPLAYER)
      (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
      (if (i32.and (call $p_in (local.get $pb))
                   (i32.and (i32.eq (!ld u8 @(PG_S + MP_PADOF) (local.get $p)) (i32.const 255))
                            (f32.le (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (f32.const @(+PLAT_Y + MP_HIGH)))))
        (then
          (local.set $dx (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (local.get $x)))
          (local.set $dz (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $pb)) (local.get $z)))
          (local.set $d2 (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))))
          (if (f32.lt (local.get $d2) (local.get $bd))
            (then (local.set $bd (local.get $d2)) (local.set $best (local.get $p)))))))
    (if (i32.ge_s (local.get $best) (i32.const 0))
      (then
        (!st u8 @(PG_S + MP_HOLD) (local.get $i) (local.get $best))
        (!st u8 @(PG_S + MP_PADOF) (local.get $best) (local.get $i))
        (!inc $held))))
  ;; the final, two balls in and the one pad lit held: a point to its holder,
  ;; and only its MP_FINALS-th puts the other out (two lit, a ball lost since
  ;; the stop, is no final: the one that missed had a pad)
  (local.set $owner (i32.const 255))
  (if (i32.and (i32.eq (local.get $held) (i32.const 1)) (i32.eq (i32.load (i32.const @(PG_H + MP_NPAD))) (i32.const 1)))
    (then
      (!for $p (i32.const 0) (i32.const @NPLAYER)
        (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
        (if (i32.eq (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE))
          (then
            (!inc $alive)
            (if (i32.ne (!ld u8 @(PG_S + MP_PADOF) (local.get $p)) (i32.const 255)) (then (local.set $owner (local.get $p)))))))
      (if (i32.eq (local.get $alive) (i32.const 2))
        (then
          (local.set $item (i32.add (!ld u8 @(PG_S + MP_FINAL) (local.get $owner)) (i32.const 1)))
          (!st u8 @(PG_S + MP_FINAL) (local.get $owner) (local.get $item))
          (if (i32.lt_u (local.get $item) (i32.const @MP_FINALS)) (then (local.set $spare (i32.const 1)))))
        (else (local.set $owner (i32.const 255))))))
  (if (i32.and (i32.ne (local.get $held) (i32.const 0)) (i32.eqz (local.get $spare)))
    (then
      (!for $p (i32.const 0) (i32.const @NPLAYER)
        (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
        (if (i32.eq (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE))
          (then
            (if (i32.eq (!ld u8 @(PG_S + MP_PADOF) (local.get $p)) (i32.const 255))
              (then (call $p_out (local.get $p)) (!inc $lost))
              (else (!st u8 @(PG_S + MP_WON) (local.get $p) (i32.add (!ld u8 @(PG_S + MP_WON) (local.get $p)) (i32.const 1))))))))
      (local.set $g (i32.load (i32.const @(PG_H + MP_GOLD))))
      (if (i32.lt_u (local.get $g) (i32.load (i32.const @(PG_H + MP_NPAD))))
        (then
          (local.set $p (!ld u8 @(PG_S + MP_HOLD) (local.get $g)))
          (if (i32.ne (local.get $p) (i32.const 255))
            (then
              (local.set $item (i32.add (i32.rem_u (call $rand) (i32.const @NPU)) (i32.const 1)))
              (!put u8 @(PLAYERS + B_ITEM) (i32.shl (local.get $p) (i32.const 6)) (local.get $item))
              (local.set $a (i32.add (i32.const @(PG_S + MP_PADS)) (i32.shl (local.get $g) (i32.const 4))))
              (call $fx (i32.const 0) (i32.const @FX_PICKUP) (local.get $p) (local.get $g)
                        (f32.load offset=8 (local.get $a)) (f32.const @PLAT_Y) (f32.load offset=12 (local.get $a))
                        (f32.convert_i32_u (local.get $item)))))))
      (local.set $r (f32.min (f32.load (i32.const @(PG_H + MP_RIMB))) (call $mp_rad (local.get $held))))
      (!chk (local.get $r) 62 (local.get $held))
      (f32.store (i32.const @(PG_H + MP_RIMA)) (f32.load (i32.const @(PG_H + MP_RIMB))))
      (f32.store (i32.const @(PG_H + MP_RIMB)) (local.get $r))
      (i32.store (i32.const @(PG_H + MP_RIMT)) (i32.add (local.get $t) (i32.const @MP_SHRINK0)))
      (f32.store (i32.const @PG_SIZE) (local.get $r))))
  (i32.store (i32.const @(PG_H + MP_HELD)) (local.get $held))
  (i32.store (i32.const @(PG_H + MP_LOST)) (local.get $lost))
  (call $fx (i32.const 0) (i32.const @MP_FX_CLAIM) (local.get $owner) (local.get $held)
            (f32.load (i32.const @PG_CX)) (f32.const @PLAT_Y) (f32.load (i32.const @PG_CX)) (f32.convert_i32_u (local.get $lost))))

;; The floor for the crowd; strong braking (MP_IDLE), stopping on a pad being half the game.
(func $mp_setup (param $n i32)
  (local $rad f32)
  (local.set $rad (call $mp_rad (local.get $n)))
  (!chk (local.get $rad) 61 (local.get $n))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_OUT))
  (i32.store (i32.const @PG_LEN) (i32.const @MP_LEN))
  (f32.store (i32.const @PG_SIZE) (local.get $rad))
  (f32.store (i32.const @PG_IDLE) (f32.const @MP_IDLE))
  (f32.store (i32.const @(PG_H + MP_R)) (local.get $rad))
  (f32.store (i32.const @(PG_H + MP_RIMA)) (local.get $rad))
  (f32.store (i32.const @(PG_H + MP_RIMB)) (local.get $rad))
  (i32.store (i32.const @(PG_H + MP_GOLD)) (i32.const 255))
  (memory.fill (i32.const @(PG_S + MP_HOLD)) (i32.const 255) (i32.const @MP_NMAX))
  (memory.fill (i32.const @(PG_S + MP_PADOF)) (i32.const 255) (i32.const @NPLAYER)))

;; A sunflower spiral over the middle of the floor.
(func $mp_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $x f32) (local $z f32)
  (call $p_disc (local.get $i) (local.get $n) (f32.mul (f32.load (i32.const @(PG_H + MP_R))) (f32.const @MP_SPAWN)))
  (local.set $z) (local.set $x)
  (local.get $x) (f32.const @PLAT_Y) (local.get $z))

;; The first song starts with play.
(func $mp_start
  (call $mp_cycle (call $p_t (i32.const 0)) (i32.const 0)))

(func $mp_begin (param $p i32) (param $d i32))

;; The floor's top under (x, z) if it's inside the rim on bank d's tick.
(func $mp_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (local $r f32) (local $dx f32) (local $dz f32)
  (if (f32.lt (local.get $y) (f32.const @PLAT_Y)) (then (return (f32.const -1000))))
  (local.set $r (call $mp_rim (local.get $d)))
  (local.set $dx (f32.sub (local.get $x) (f32.load offset=@PG_CX (local.get $d))))
  (local.set $dz (f32.sub (local.get $z) (f32.load offset=@PG_CX (local.get $d))))
  (if (result f32) (f32.le (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))) (f32.mul (local.get $r) (local.get $r)))
    (then (f32.const @PLAT_Y))
    (else (f32.const -1000))))

(func $mp_push (param $p i32) (param $d i32))

;; The cycle's moments, on their ticks: the music stops, the claim, the rim
;; starting in (an FX), the next song.
(func $mp_tick
  (local $t i32)
  (local.set $t (call $p_t (i32.const 0)))
  (if (i32.eq (local.get $t) (i32.load (i32.const @(PG_H + MP_STOP)))) (then (call $mp_stop (local.get $t))))
  (if (i32.eq (local.get $t) (i32.load (i32.const @(PG_H + MP_CLAIM)))) (then (call $mp_claim (local.get $t))))
  (if (i32.and (i32.eq (local.get $t) (i32.load (i32.const @(PG_H + MP_RIMT))))
               (f32.lt (f32.load (i32.const @(PG_H + MP_RIMB))) (f32.load (i32.const @(PG_H + MP_RIMA)))))
    (then
      (call $fx (i32.const 0) (i32.const @MP_FX_CLOSE) (i32.const 255) (i32.load (i32.const @(PG_H + MP_CYCLE)))
                (f32.load (i32.const @PG_CX)) (f32.const @PLAT_Y) (f32.load (i32.const @PG_CX)) (f32.load (i32.const @(PG_H + MP_RIMB))))))
  (if (i32.eq (local.get $t) (i32.load (i32.const @(PG_H + MP_NEXT))))
    (then (call $mp_cycle (local.get $t) (i32.add (i32.load (i32.const @(PG_H + MP_CYCLE))) (i32.const 1))))))

(func $mp_over (result i32) (i32.const 0))

(func $mp_out (param $p i32))
