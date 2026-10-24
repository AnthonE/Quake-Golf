;; KING OF THE HILL: a grassy disc over the sea, sized for the crowd, and on it
;; a hill swelling out of the ground (KH_NH of them for a big crowd, round the
;; middle). A hill's top is the zone: every ball on the ground in it scores a
;; point a tick, two within KH_TOP of the top; the zone shrinks as it goes,
;; from KH_Z by KH_SHRINK of it. Every KH_PERIOD the zone moves on to the
;; next of KH_ZONES (the first in the middle, each after it far from the
;; last): its hills swell over the KH_RISE ticks before, the old ones sink
;; back over the KH_RISE after. A hill's slope pulls a rolling ball down it,
;; so holding the top takes pushing; KH_ORB_AT into a zone a power-up drops
;; onto each top for whoever gets there first. Off the disc and a ball is
;; down KH_RESPAWN ticks. Most points at 90 s wins.
;;
;; The spots and the sizes are laid out with the round, in PG_H; how far each
;; hill has risen, and how far the zone has shrunk, are functions of the tick
;; into play. So ground and push (the pull, the grip on a slope, the score)
;; read only bank d's header and the ball's own record, and the prediction is
;; exact however far ahead it runs; the score is kept in push, on both banks
;; alike, so a predicted ball's record is the confirmed one's bit for bit.
;; Only the bumps, which knock balls off the top, and who takes a power-up
;; are the confirmed world's, a round trip late.
;;
;; Hill h is zone h / KH_HMAX's hill h % KH_HMAX.

;; The zone open on tick t into play.
(func $kh_zone (param $t i32) (result i32)
  (local $k i32)
  (local.set $k (i32.div_u (local.get $t) (i32.const @KH_PERIOD)))
  (select (local.get $k) (i32.const @(KH_ZONES - 1)) (i32.lt_u (local.get $k) (i32.const @KH_ZONES))))

;; The open zone's radius on tick t into play, bank d: KH_Z as it opens,
;; shrinking by KH_SHRINK of it to its end, so a hill held easily at first is
;; a crush by the time the next one swells.
(func $kh_reach (param $d i32) (param $t i32) (result f32)
  (local $a f32)
  (local.set $a (f32.min (f32.const 1)
                         (f32.div (f32.convert_i32_u (i32.sub (local.get $t) (i32.mul (call $kh_zone (local.get $t)) (i32.const @KH_PERIOD))))
                                  (f32.const @KH_PERIOD))))
  (f32.mul (f32.load offset=@(PG_H + KH_Z) (local.get $d)) (f32.sub (f32.const 1) (f32.mul (local.get $a) (f32.const @KH_SHRINK)))))

;; Smoothstep over a ticks of KH_RISE: 0 to 1, easing in and out.
(func $kh_ease (param $a i32) (result f32)
  (local $s f32)
  (local.set $s (f32.div (f32.convert_i32_s (local.get $a)) (f32.const @KH_RISE)))
  (f32.mul (f32.mul (local.get $s) (local.get $s)) (f32.sub (f32.const 3) (f32.mul (local.get $s) (f32.const 2)))))

;; How far zone j's hills have risen on tick t into play, 0 flat to 1: they
;; swell over the KH_RISE ticks before it opens, stand while it's open, and
;; sink over the KH_RISE after (the last zone's stand to the end).
(func $kh_up (param $j i32) (param $t i32) (result f32)
  (local $a i32)
  (local.set $a (i32.sub (local.get $t) (i32.sub (i32.mul (local.get $j) (i32.const @KH_PERIOD)) (i32.const @KH_RISE))))
  (if (i32.lt_s (local.get $a) (i32.const 0)) (then (return (f32.const 0))))
  (if (i32.lt_s (local.get $a) (i32.const @KH_RISE)) (then (return (call $kh_ease (local.get $a)))))
  (local.set $a (i32.sub (local.get $a) (i32.const @(KH_RISE + KH_PERIOD))))
  (if (i32.or (i32.lt_s (local.get $a) (i32.const 0)) (i32.eq (local.get $j) (i32.const @(KH_ZONES - 1)))) (then (return (f32.const 1))))
  (if (i32.lt_s (local.get $a) (i32.const @KH_RISE)) (then (return (f32.sub (f32.const 1) (call $kh_ease (local.get $a))))))
  (f32.const 0))

;; Hill h's centre (x, z) on bank d.
(func $kh_spot (param $d i32) (param $h i32) (result f32 f32)
  (local $a i32) (local $cx f32)
  (local.set $a (i32.add (local.get $d) (i32.shl (local.get $h) (i32.const 2))))
  (local.set $cx (f32.load offset=@PG_CX (local.get $d)))
  (!madd (f32.convert_i32_s (i32.load16_s offset=@(PG_H + KH_SPOT) (local.get $a))) (f32.const 0.015625) (local.get $cx))
  (!madd (f32.convert_i32_s (i32.load16_s offset=@(PG_H + KH_SPOT + 2) (local.get $a))) (f32.const 0.015625) (local.get $cx)))

;; Hill h's top at (x, z), risen u, on bank d's header, or -1000 past its foot:
;; PLAT_Y + h u (2 w - 1), w = sqrt(1 - d^2 / A^2), the ellipsoid's top.
(func $kh_hill (param $d i32) (param $h i32) (param $u f32) (param $x f32) (param $z f32) (result f32)
  (local $sx f32) (local $sz f32) (local $dx f32) (local $dz f32) (local $q f32)
  (if (f32.le (local.get $u) (f32.const 0)) (then (return (f32.const -1000))))
  (call $kh_spot (local.get $d) (local.get $h))
  (local.set $sz) (local.set $sx)
  (local.set $dx (f32.sub (local.get $x) (local.get $sx)))
  (local.set $dz (f32.sub (local.get $z) (local.get $sz)))
  (local.set $q (f32.sub (f32.const 1) (f32.mul (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz)))
                                                (f32.load offset=@(PG_H + KH_IA2) (local.get $d)))))
  (if (f32.le (local.get $q) (f32.const 0.25)) (then (return (f32.const -1000))))
  (!madd (f32.mul (f32.load offset=@(PG_H + KH_H) (local.get $d)) (local.get $u))
         (f32.sub (f32.mul (f32.sqrt (local.get $q)) (f32.const 2)) (f32.const 1))
         (f32.const @PLAT_Y)))

;; The ground at (x, z) on bank d's tick: its top (-1000 off the disc), the
;; hill it's on (-1 the floor) and how far that hill has risen. The hills up
;; are the open zone's, the last's (sinking) and the next's (swelling).
(func $kh_surface (param $d i32) (param $x f32) (param $z f32) (result f32 i32 f32)
  (local $t i32) (local $k i32) (local $j i32) (local $e i32) (local $i i32) (local $nh i32) (local $on i32)
  (local $dx f32) (local $dz f32) (local $r f32) (local $u f32) (local $h f32) (local $top f32) (local $up f32)
  (local.set $dx (f32.sub (local.get $x) (f32.load offset=@PG_CX (local.get $d))))
  (local.set $dz (f32.sub (local.get $z) (f32.load offset=@PG_CX (local.get $d))))
  (local.set $r (f32.load offset=@(PG_H + KH_RAD) (local.get $d)))
  (if (f32.gt (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))) (f32.mul (local.get $r) (local.get $r)))
    (then (return (f32.const -1000) (i32.const -1) (f32.const 0))))
  (local.set $top (f32.const @PLAT_Y))
  (local.set $on (i32.const -1))
  (local.set $nh (i32.load offset=@(PG_H + KH_NH) (local.get $d)))
  (local.set $t (call $p_t (local.get $d)))
  (local.set $k (call $kh_zone (local.get $t)))
  (local.set $e (i32.add (local.get $k) (i32.const 2)))
  (if (i32.gt_u (local.get $e) (i32.const @KH_ZONES)) (then (local.set $e (i32.const @KH_ZONES))))
  (!for $j (select (i32.sub (local.get $k) (i32.const 1)) (i32.const 0) (local.get $k)) (local.get $e)
    (local.set $u (call $kh_up (local.get $j) (local.get $t)))
    (if (f32.gt (local.get $u) (f32.const 0))
      (then
        (!for $i (i32.const 0) (local.get $nh)
          (local.set $h (call $kh_hill (local.get $d) (i32.add (i32.mul (local.get $j) (i32.const @KH_HMAX)) (local.get $i)) (local.get $u) (local.get $x) (local.get $z)))
          (if (f32.gt (local.get $h) (local.get $top))
            (then
              (local.set $top (local.get $h))
              (local.set $on (i32.add (i32.mul (local.get $j) (i32.const @KH_HMAX)) (local.get $i)))
              (local.set $up (local.get $u))))))))
  (local.get $top)
  (local.get $on)
  (local.get $up))

;; The disc, the zone and the hills for the crowd (one, two from KH_N2 balls,
;; three from KH_N3), and every zone's spots: a zone's hills evenly round the
;; middle, at least KH_SPREAD feet apart, all near enough the middle that a
;; hill's hidden half stays inside the floor. One hill's first zone is in the
;; middle; each zone after the first is the one of KH_TRIES whose hills are
;; farthest from the last zone's. Then where the balls start.
(func $kh_setup (param $n i32)
  (local $j i32) (local $k i32) (local $i i32) (local $q i32) (local $nh i32) (local $tries i32) (local $ang i32) (local $bang i32) (local $step i32) (local $h i32)
  (local $rn f32) (local $rad f32) (local $zr f32) (local $f f32) (local $rs f32) (local $r0 f32) (local $cx f32)
  (local $s f32) (local $c f32) (local $rr f32) (local $br f32) (local $x f32) (local $z f32) (local $px f32) (local $pz f32)
  (local $best f32) (local $near f32) (local $dd f32)
  (local.set $rn (f32.sqrt (f32.convert_i32_u (local.get $n))))
  (local.set $rad (f32.min (!madd (local.get $rn) (f32.const @KH_RK) (f32.const @KH_R0)) (f32.const @KH_RMAX)))
  (local.set $zr (!madd (local.get $rn) (f32.const @KH_ZK) (f32.const @KH_Z0)))
  (local.set $f (f32.mul (local.get $zr) (f32.const @KH_FOOT)))
  (!chk (local.get $rad) 71 (local.get $n))
  (!chk (local.get $zr) 72 (local.get $n))
  (local.set $nh (i32.add (i32.add (i32.const 1) (i32.ge_u (local.get $n) (i32.const @KH_N2))) (i32.ge_u (local.get $n) (i32.const @KH_N3))))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_SCORE))
  (i32.store (i32.const @PG_LEN) (i32.const @KH_LEN))
  (i32.store (i32.const @PG_RESPAWN) (i32.const @KH_RESPAWN))
  (f32.store (i32.const @PG_SIZE) (local.get $rad))
  (f32.store (i32.const @(PG_H + KH_RAD)) (local.get $rad))
  (f32.store (i32.const @(PG_H + KH_Z)) (local.get $zr))
  (f32.store (i32.const @(PG_H + KH_TOP)) (f32.mul (local.get $zr) (f32.const @KH_TOPK)))
  (f32.store (i32.const @(PG_H + KH_F)) (local.get $f))
  (f32.store (i32.const @(PG_H + KH_H)) (f32.mul (local.get $f) (f32.const @KH_HIGH)))
  (f32.store (i32.const @(PG_H + KH_IA2)) (f32.div (f32.const 0.75) (f32.mul (local.get $f) (local.get $f))))
  (i32.store (i32.const @(PG_H + KH_NH)) (local.get $nh))
  (i32.store (i32.const @(PG_H + KH_LEAD)) (i32.const 255))
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (local.set $rs (f32.max (f32.const 0) (f32.sub (f32.sub (local.get $rad) (f32.mul (local.get $f) (f32.const 1.2))) (f32.const 1))))
  ;; how far round the middle a zone's hills stand: no nearer than KH_SPREAD feet apart (one hill: anywhere)
  (local.set $r0 (f32.const 0))
  (if (i32.eq (local.get $nh) (i32.const 2)) (then (local.set $r0 (f32.mul (local.get $f) (f32.const @KH_SPREAD)))))
  (if (i32.eq (local.get $nh) (i32.const 3)) (then (local.set $r0 (f32.div (f32.mul (local.get $f) (f32.const @KH_SPREAD)) (f32.const 0.8660254)))))
  (local.set $r0 (f32.min (local.get $r0) (local.get $rs)))
  (local.set $step (i32.div_u (i32.const 16384) (local.get $nh)))
  (!for $j (i32.const 0) (i32.const @KH_ZONES)
    (local.set $best (f32.const -1))
    (local.set $tries (select (i32.const 1) (i32.const @KH_TRIES) (i32.eqz (local.get $j))))
    (!for $k (i32.const 0) (local.get $tries)
      (local.set $ang (i32.and (call $rand) (i32.const 16383)))
      (local.set $rr (!madd (f32.sub (local.get $rs) (local.get $r0)) (call $p_unit) (local.get $r0)))
      (if (i32.eq (local.get $nh) (i32.const 1))
        (then (local.set $rr (select (f32.const 0) (f32.mul (local.get $rs) (f32.sqrt (call $p_unit))) (i32.eqz (local.get $j))))))
      ;; the nearest any of its hills comes to any of the last zone's
      (local.set $near (f32.const 1e9))
      (if (local.get $j)
        (then
          (!for $i (i32.const 0) (local.get $nh)
            (call $sincos (i32.add (local.get $ang) (i32.mul (local.get $i) (local.get $step))))
            (local.set $c) (local.set $s)
            (local.set $x (!madd (local.get $c) (local.get $rr) (local.get $cx)))
            (local.set $z (!madd (local.get $s) (local.get $rr) (local.get $cx)))
            (!for $q (i32.const 0) (local.get $nh)
              (call $kh_spot (i32.const 0) (i32.add (i32.mul (i32.sub (local.get $j) (i32.const 1)) (i32.const @KH_HMAX)) (local.get $q)))
              (local.set $pz) (local.set $px)
              (local.set $dd (!madd (f32.sub (local.get $x) (local.get $px)) (f32.sub (local.get $x) (local.get $px))
                                    (f32.mul (f32.sub (local.get $z) (local.get $pz)) (f32.sub (local.get $z) (local.get $pz)))))
              (local.set $near (f32.min (local.get $near) (local.get $dd)))))))
      (if (f32.gt (local.get $near) (local.get $best))
        (then (local.set $best (local.get $near)) (local.set $bang (local.get $ang)) (local.set $br (local.get $rr)))))
    ;; kept to 1/64 m from the middle
    (!for $i (i32.const 0) (local.get $nh)
      (call $sincos (i32.add (local.get $bang) (i32.mul (local.get $i) (local.get $step))))
      (local.set $c) (local.set $s)
      (local.set $h (i32.shl (i32.add (i32.mul (local.get $j) (i32.const @KH_HMAX)) (local.get $i)) (i32.const 2)))
      (i32.store16 offset=@(PG_H + KH_SPOT) (local.get $h) (i32.trunc_sat_f32_s (f32.nearest (f32.mul (f32.mul (local.get $c) (local.get $br)) (f32.const 64)))))
      (i32.store16 offset=@(PG_H + KH_SPOT + 2) (local.get $h) (i32.trunc_sat_f32_s (f32.nearest (f32.mul (f32.mul (local.get $s) (local.get $br)) (f32.const 64)))))))
  (call $kh_spawns (local.get $n)))

;; Where the round's n balls start, in PG_S: the first n points of a
;; sunflower spiral over the disc that are off the foot of every first hill
;; (by 1.5 m), the spiral's points doubled until there are n of them; so the
;; balls start on the floor round the hills, apart, and the round opens with
;; a rush up them.
(func $kh_spawns (param $n i32)
  (local $m i32) (local $c i32) (local $k i32) (local $j i32) (local $nh i32) (local $free i32)
  (local $f f32) (local $r1 f32) (local $rr f32) (local $cx f32) (local $sn f32) (local $cs f32) (local $x f32) (local $z f32)
  (local $sx f32) (local $sz f32)
  (local.set $nh (i32.load (i32.const @(PG_H + KH_NH))))
  (local.set $f (f32.add (f32.load (i32.const @(PG_H + KH_F))) (f32.const 1.5)))
  (local.set $r1 (f32.sub (f32.load (i32.const @(PG_H + KH_RAD))) (f32.const 1.5)))
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (local.set $m (i32.add (i32.shl (local.get $n) (i32.const 1)) (i32.const 8)))
  (block $done
    (loop $more
      (local.set $k (i32.const 0))
      (!for $c (i32.const 0) (local.get $m)
        (if (i32.lt_u (local.get $k) (local.get $n))
          (then
            (local.set $rr (f32.mul (local.get $r1) (f32.sqrt (f32.div (f32.add (f32.convert_i32_u (local.get $c)) (f32.const 0.5)) (f32.convert_i32_u (local.get $m))))))
            (call $sincos (i32.mul (local.get $c) (i32.const 6258))) ;; the golden angle, in 1/16384 turn
            (local.set $cs) (local.set $sn)
            (local.set $x (!madd (local.get $cs) (local.get $rr) (local.get $cx)))
            (local.set $z (!madd (local.get $sn) (local.get $rr) (local.get $cx)))
            (local.set $free (i32.const 1))
            (!for $j (i32.const 0) (local.get $nh)
              (call $kh_spot (i32.const 0) (local.get $j))
              (local.set $sz) (local.set $sx)
              (if (f32.lt (!madd (f32.sub (local.get $x) (local.get $sx)) (f32.sub (local.get $x) (local.get $sx))
                                 (f32.mul (f32.sub (local.get $z) (local.get $sz)) (f32.sub (local.get $z) (local.get $sz))))
                          (f32.mul (local.get $f) (local.get $f)))
                (then (local.set $free (i32.const 0)))))
            (if (local.get $free)
              (then
                (f32.store offset=@(PG_S + KH_SPAWN) (i32.shl (local.get $k) (i32.const 3)) (local.get $x))
                (f32.store offset=@(PG_S + KH_SPAWN + 4) (i32.shl (local.get $k) (i32.const 3)) (local.get $z))
                (!inc $k))))))
      (br_if $done (i32.ge_u (local.get $k) (local.get $n)))
      (br_if $done (i32.ge_u (local.get $m) (i32.const 4096)))
      (local.set $m (i32.shl (local.get $m) (i32.const 1)))
      (br $more)))
  (i32.store (i32.const @(PG_S + KH_SN)) (local.get $n))
  (i32.store (i32.const @(PG_S + KH_SK)) (local.get $k)))

;; Ball i of n where $kh_spawns put it, on the floor. A respawn (i of 1024),
;; or a ball the spiral found no room for, is on a sunflower spiral over the
;; disc (one hill: the ring between its foot and the rim), moved out to the
;; foot of any of the open zone's hills it would be on, on whatever ground is
;; there.
(func $kh_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $j i32) (local $nh i32) (local $r0 f32) (local $r1 f32) (local $rr f32) (local $s f32) (local $c f32) (local $x f32) (local $z f32)
  (local $cx f32) (local $f f32) (local $sx f32) (local $sz f32) (local $dx f32) (local $dz f32) (local $d f32) (local $top f32)
  (if (i32.and (i32.eq (local.get $n) (i32.load (i32.const @(PG_S + KH_SN)))) (i32.lt_u (local.get $i) (i32.load (i32.const @(PG_S + KH_SK)))))
    (then
      (return (f32.load offset=@(PG_S + KH_SPAWN) (i32.shl (local.get $i) (i32.const 3)))
              (f32.const @PLAT_Y)
              (f32.load offset=@(PG_S + KH_SPAWN + 4) (i32.shl (local.get $i) (i32.const 3))))))
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (local.set $f (f32.add (f32.load (i32.const @(PG_H + KH_F))) (f32.const 1.5)))
  (local.set $nh (i32.load (i32.const @(PG_H + KH_NH))))
  (local.set $r1 (f32.sub (f32.load (i32.const @(PG_H + KH_RAD))) (f32.const 1.5)))
  (local.set $r0 (select (f32.min (local.get $f) (local.get $r1)) (f32.const 0) (i32.eq (local.get $nh) (i32.const 1))))
  (local.set $rr (f32.sqrt (!madd (f32.sub (f32.mul (local.get $r1) (local.get $r1)) (f32.mul (local.get $r0) (local.get $r0)))
                                  (f32.div (f32.add (f32.convert_i32_u (local.get $i)) (f32.const 0.5))
                                           (f32.convert_i32_u (select (local.get $n) (i32.const 1) (local.get $n))))
                                  (f32.mul (local.get $r0) (local.get $r0)))))
  (call $sincos (i32.mul (local.get $i) (i32.const 6258)))
  (local.set $c) (local.set $s)
  (local.set $x (!madd (local.get $c) (local.get $rr) (local.get $cx)))
  (local.set $z (!madd (local.get $s) (local.get $rr) (local.get $cx)))
  (!for $j (i32.const 0) (local.get $nh)
    (call $kh_spot (i32.const 0) (i32.add (i32.mul (call $kh_zone (call $p_t (i32.const 0))) (i32.const @KH_HMAX)) (local.get $j)))
    (local.set $sz) (local.set $sx)
    (local.set $dx (f32.sub (local.get $x) (local.get $sx)))
    (local.set $dz (f32.sub (local.get $z) (local.get $sz)))
    (local.set $d (f32.sqrt (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz)))))
    (if (f32.lt (local.get $d) (local.get $f))
      (then
        (if (f32.lt (local.get $d) (f32.const 0.01))
          (then (local.set $dx (f32.const 1)) (local.set $dz (f32.const 0)) (local.set $d (f32.const 1))))
        (local.set $x (!madd (f32.div (local.get $dx) (local.get $d)) (local.get $f) (local.get $sx)))
        (local.set $z (!madd (f32.div (local.get $dz) (local.get $d)) (local.get $f) (local.get $sz))))))
  ;; on the disc still
  (local.set $dx (f32.sub (local.get $x) (local.get $cx)))
  (local.set $dz (f32.sub (local.get $z) (local.get $cx)))
  (local.set $d (f32.sqrt (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz)))))
  (if (f32.gt (local.get $d) (local.get $r1))
    (then
      (local.set $x (!madd (f32.div (local.get $dx) (local.get $d)) (local.get $r1) (local.get $cx)))
      (local.set $z (!madd (f32.div (local.get $dz) (local.get $d)) (local.get $r1) (local.get $cx)))))
  (call $kh_surface (i32.const 0) (local.get $x) (local.get $z))
  (drop) (drop)
  (local.set $top)
  (local.get $x)
  (f32.max (local.get $top) (f32.const @PLAT_Y))
  (local.get $z))

;; Zone j opens (or its hills start to swell): FX kind at its first hill (on
;; its top, risen, if up).
(func $kh_mark (param $kind i32) (param $j i32) (param $up f32)
  (local $x f32) (local $z f32)
  (call $kh_spot (i32.const 0) (i32.mul (local.get $j) (i32.const @KH_HMAX)))
  (local.set $z) (local.set $x)
  (call $fx (i32.const 0) (local.get $kind) (i32.const 255) (local.get $j)
            (local.get $x) (f32.max (f32.const @PLAT_Y) (call $kh_hill (i32.const 0) (i32.mul (local.get $j) (i32.const @KH_HMAX)) (local.get $up) (local.get $x) (local.get $z)))
            (local.get $z) (f32.convert_i32_u (local.get $j))))

;; The first zone opens with play.
(func $kh_start (call $kh_mark (i32.const @KH_FX_MOVE) (i32.const 0) (f32.const 1)))
(func $kh_begin (param $p i32) (param $d i32))

;; The floor and the hills (a heightfield: a ball can't be under one), none
;; under the floor's top, where a ball that rolled off the rim falls past.
(func $kh_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (if (f32.lt (local.get $y) (f32.const @PLAT_Y)) (then (return (f32.const -1000))))
  (call $kh_surface (local.get $d) (local.get $x) (local.get $z))
  (drop) (drop))

;; After the ball's roll on bank d: its grip (a ball a hair over the ground
;; and not rising is on it, so it rolls down a slope and stays on a sinking
;; hill rather than skipping), the slope's pull down a hill (gravity along
;; the ellipsoid's top: m (dx, dz) w / (w^2 + m^2 d^2), m = 2 h u / A^2, times
;; KH_PULL), and its score: a point on the ground in the open zone, two on a
;; top.
(func $kh_push (param $p i32) (param $d i32)
  (local $pb i32) (local $fl i32) (local $on i32) (local $i i32) (local $nh i32) (local $sc i32) (local $w i32) (local $t i32) (local $k i32)
  (local $x f32) (local $y f32) (local $z f32) (local $vx f32) (local $vy f32) (local $vz f32) (local $sx f32) (local $sz f32)
  (local $top f32) (local $u f32) (local $dx f32) (local $dz f32) (local $d2 f32) (local $q f32) (local $m f32) (local $g f32) (local $zr f32) (local $tr f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
  (if (i32.and (local.get $fl) (i32.const @(PF_DEAD | PF_FALL))) (then (return)))
  (local.set $x (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (local.set $y (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
  (local.set $z (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (local.set $vy (!at f32 @(PLAYERS + P_VY) (local.get $pb)))
  (call $kh_surface (local.get $d) (local.get $x) (local.get $z))
  (local.set $u) (local.set $on) (local.set $top)
  (if (f32.lt (local.get $top) (f32.const -500)) (then (return)))
  (if (i32.and (i32.and (i32.eqz (i32.and (local.get $fl) (i32.const @(PF_GROUND | PF_STOMP)))) (f32.le (local.get $vy) (f32.const 0)))
               (i32.and (f32.ge (local.get $y) (local.get $top)) (f32.le (f32.sub (local.get $y) (local.get $top)) (f32.const @KH_SNAP))))
    (then
      (local.set $fl (i32.or (local.get $fl) (i32.const @PF_GROUND)))
      (!put f32 @(PLAYERS + P_PY) (local.get $pb) (local.get $top))
      (!put f32 @(PLAYERS + P_VY) (local.get $pb) (f32.const 0))
      (!put u8 @(PLAYERS + P_FL) (local.get $pb) (local.get $fl))))
  (if (i32.eqz (i32.and (local.get $fl) (i32.const @PF_GROUND))) (then (return)))
  (if (i32.ge_s (local.get $on) (i32.const 0))
    (then
      (call $kh_spot (local.get $d) (local.get $on))
      (local.set $sz) (local.set $sx)
      (local.set $dx (f32.sub (local.get $x) (local.get $sx)))
      (local.set $dz (f32.sub (local.get $z) (local.get $sz)))
      (local.set $d2 (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))))
      (local.set $q (f32.sub (f32.const 1) (f32.mul (local.get $d2) (f32.load offset=@(PG_H + KH_IA2) (local.get $d)))))
      (local.set $m (f32.mul (f32.mul (f32.mul (f32.load offset=@(PG_H + KH_H) (local.get $d)) (local.get $u)) (f32.const 2))
                             (f32.load offset=@(PG_H + KH_IA2) (local.get $d))))
      (local.set $g (f32.div (f32.mul (f32.mul (f32.const @KH_PULL) (local.get $m)) (f32.sqrt (local.get $q)))
                             (!madd (f32.mul (local.get $m) (local.get $m)) (local.get $d2) (local.get $q))))
      (local.set $vx (!madd (local.get $g) (local.get $dx) (!at f32 @(PLAYERS + P_VX) (local.get $pb))))
      (local.set $vz (!madd (local.get $g) (local.get $dz) (!at f32 @(PLAYERS + P_VZ) (local.get $pb))))
      (!chk (local.get $vx) 73 (local.get $p))
      (!chk (local.get $vz) 74 (local.get $p))
      (!put f32 @(PLAYERS + P_VX) (local.get $pb) (local.get $vx))
      (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (local.get $vz))))
  ;; the score: the best the open zone's hills give where it is
  (local.set $t (call $p_t (local.get $d)))
  (local.set $k (i32.mul (call $kh_zone (local.get $t)) (i32.const @KH_HMAX)))
  (local.set $zr (call $kh_reach (local.get $d) (local.get $t)))
  (local.set $zr (f32.mul (local.get $zr) (local.get $zr)))
  (local.set $tr (f32.load offset=@(PG_H + KH_TOP) (local.get $d)))
  (local.set $tr (f32.mul (local.get $tr) (local.get $tr)))
  (local.set $nh (i32.load offset=@(PG_H + KH_NH) (local.get $d)))
  (!for $i (i32.const 0) (local.get $nh)
    (call $kh_spot (local.get $d) (i32.add (local.get $k) (local.get $i)))
    (local.set $sz) (local.set $sx)
    (local.set $dx (f32.sub (local.get $x) (local.get $sx)))
    (local.set $dz (f32.sub (local.get $z) (local.get $sz)))
    (local.set $d2 (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))))
    (if (f32.le (local.get $d2) (local.get $zr)) (then (local.set $w (select (i32.const 2) (i32.const 1) (f32.le (local.get $d2) (local.get $tr)))))))
  (if (local.get $w)
    (then
      (local.set $sc (i32.add (!at u16 @(PLAYERS + PG_SCORE) (local.get $pb)) (local.get $w)))
      (!put u16 @(PLAYERS + PG_SCORE) (local.get $pb) (select (local.get $sc) (i32.const 65535) (i32.lt_u (local.get $sc) (i32.const 65535)))))))

;; The power-ups: KH_ORB_AT into a zone one drops onto each of its tops
;; (from KH_ORB_Y over it, at bumper's ORB_FALL), lands and rides its hill;
;; the first ball in, holding nothing, whose centre comes within its radius
;; and ORB_R of it takes it (in slot order), as bumper's orbs are taken. The
;; zone moving on takes whatever is left.
(func $kh_orbs (param $t i32)
  (local $k i32) (local $a i32) (local $i i32) (local $nh i32) (local $o i32) (local $p i32) (local $pb i32) (local $kind i32)
  (local $x f32) (local $y f32) (local $z f32) (local $top f32) (local $rad f32) (local $dx f32) (local $dy f32) (local $dz f32) (local $lim f32)
  (local.set $k (call $kh_zone (local.get $t)))
  (local.set $a (i32.sub (local.get $t) (i32.mul (local.get $k) (i32.const @KH_PERIOD))))
  (local.set $nh (i32.load (i32.const @(PG_H + KH_NH))))
  (if (i32.eqz (local.get $a)) (then (memory.fill (i32.const @(PG_S + KH_ORBS)) (i32.const 0) (i32.const @(16 * KH_HMAX)))))
  (if (i32.eq (local.get $a) (i32.const @KH_ORB_AT))
    (then
      (!for $i (i32.const 0) (local.get $nh)
        (local.set $o (i32.add (i32.const @(PG_S + KH_ORBS)) (i32.shl (local.get $i) (i32.const 4))))
        (call $kh_spot (i32.const 0) (i32.add (i32.mul (local.get $k) (i32.const @KH_HMAX)) (local.get $i)))
        (local.set $z) (local.set $x)
        (local.set $top (call $kh_hill (i32.const 0) (i32.add (i32.mul (local.get $k) (i32.const @KH_HMAX)) (local.get $i)) (call $kh_up (local.get $k) (local.get $t)) (local.get $x) (local.get $z)))
        (local.set $top (f32.max (local.get $top) (f32.const @PLAT_Y)))
        (local.set $kind (i32.and (call $rand) (i32.const 7)))
        (local.set $kind (!tab KH_PU (local.get $kind)))
        (f32.store (local.get $o) (local.get $x))
        (f32.store offset=4 (local.get $o) (f32.add (local.get $top) (f32.const @(KH_ORB_Y + 0.6))))
        (f32.store offset=8 (local.get $o) (local.get $z))
        (i32.store8 offset=12 (local.get $o) (local.get $kind))
        (i32.store8 offset=13 (local.get $o) (i32.const 1))
        (call $fx (i32.const 0) (i32.const @KH_FX_ORB) (i32.const 255) (local.get $i) (local.get $x) (local.get $top) (local.get $z) (f32.convert_i32_u (local.get $kind))))))
  (!for $i (i32.const 0) (local.get $nh)
    (local.set $o (i32.add (i32.const @(PG_S + KH_ORBS)) (i32.shl (local.get $i) (i32.const 4))))
    (if (i32.load8_u offset=12 (local.get $o))
      (then (block $gone
        (local.set $x (f32.load (local.get $o)))
        (local.set $z (f32.load offset=8 (local.get $o)))
        (call $kh_surface (i32.const 0) (local.get $x) (local.get $z))
        (drop) (drop)
        (local.set $top)
        (local.set $top (f32.add (local.get $top) (f32.const 0.6)))
        ;; falling till it meets the ground, then on it as the hill moves
        (local.set $y (f32.load offset=4 (local.get $o)))
        (if (i32.eq (i32.load8_u offset=13 (local.get $o)) (i32.const 1))
          (then (local.set $y (f32.sub (local.get $y) (f32.const @ORB_FALL)))))
        (if (i32.or (i32.eq (i32.load8_u offset=13 (local.get $o)) (i32.const 2)) (f32.le (local.get $y) (local.get $top)))
          (then (local.set $y (local.get $top)) (i32.store8 offset=13 (local.get $o) (i32.const 2))))
        (!chk (local.get $y) 75 (local.get $i))
        (f32.store offset=4 (local.get $o) (local.get $y))
        (!for $p (i32.const 0) (i32.const @NPLAYER)
          (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
          (if (i32.and (call $p_in (local.get $pb)) (i32.eqz (!at u8 @(PLAYERS + B_ITEM) (local.get $pb))))
            (then
              (local.set $rad (call $b_rad (local.get $pb)))
              (local.set $dx (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (local.get $x)))
              (local.set $dy (f32.sub (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (local.get $rad)) (local.get $y)))
              (local.set $dz (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $pb)) (local.get $z)))
              (local.set $lim (f32.add (local.get $rad) (f32.const @ORB_R)))
              (if (f32.lt (!dot3 (local.get $dx) (local.get $dy) (local.get $dz) (local.get $dx) (local.get $dy) (local.get $dz)) (f32.mul (local.get $lim) (local.get $lim)))
                (then
                  (!put u8 @(PLAYERS + B_ITEM) (local.get $pb) (i32.load8_u offset=12 (local.get $o)))
                  (call $fx (i32.const 0) (i32.const @FX_PICKUP) (local.get $p) (local.get $i)
                            (local.get $x) (local.get $y) (local.get $z) (f32.convert_i32_u (i32.load8_u offset=12 (local.get $o))))
                  (memory.fill (local.get $o) (i32.const 0) (i32.const 16))
                  (br $gone)))))))))))

;; The power-ups, the zones' moments as FX (the next hills swelling, a zone
;; opening), and the leader: the most points of anyone in the room, a tie
;; keeping the one who had it (KH_LEAD, for the crown; KH_FX_LEAD at most
;; every KH_LEADGAP).
(func $kh_tick
  (local $t i32) (local $j i32) (local $p i32) (local $pb i32) (local $lead i32) (local $who i32) (local $best i32) (local $s i32)
  (local.set $t (call $p_t (i32.const 0)))
  (call $kh_orbs (local.get $t))
  (local.set $j (i32.div_u (i32.add (local.get $t) (i32.const @KH_RISE)) (i32.const @KH_PERIOD)))
  (if (i32.and (i32.eqz (i32.rem_u (i32.add (local.get $t) (i32.const @KH_RISE)) (i32.const @KH_PERIOD)))
               (i32.and (i32.ge_u (local.get $j) (i32.const 1)) (i32.lt_u (local.get $j) (i32.const @KH_ZONES))))
    (then (call $kh_mark (i32.const @KH_FX_NEXT) (local.get $j) (f32.const 0))))
  (local.set $j (i32.div_u (local.get $t) (i32.const @KH_PERIOD)))
  (if (i32.and (i32.eqz (i32.rem_u (local.get $t) (i32.const @KH_PERIOD)))
               (i32.and (i32.ge_u (local.get $j) (i32.const 1)) (i32.lt_u (local.get $j) (i32.const @KH_ZONES))))
    (then (call $kh_mark (i32.const @KH_FX_MOVE) (local.get $j) (f32.const 1))))
  (local.set $lead (i32.load (i32.const @(PG_H + KH_LEAD))))
  (local.set $who (i32.const 255))
  (if (i32.lt_u (local.get $lead) (i32.const @NPLAYER))
    (then
      (if (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $lead) (i32.const 6))) (i32.const @PF_LIVE))
        (then
          (local.set $who (local.get $lead))
          (local.set $best (!at u16 @(PLAYERS + PG_SCORE) (i32.shl (local.get $lead) (i32.const 6))))))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (if (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_LIVE))
      (then
        (local.set $s (!at u16 @(PLAYERS + PG_SCORE) (local.get $pb)))
        (if (i32.gt_u (local.get $s) (local.get $best))
          (then (local.set $best (local.get $s)) (local.set $who (local.get $p)))))))
  (if (i32.eqz (local.get $best)) (then (local.set $who (i32.const 255))))
  (if (i32.ne (local.get $who) (local.get $lead))
    (then
      (i32.store (i32.const @(PG_H + KH_LEAD)) (local.get $who))
      (if (i32.and (i32.ne (local.get $who) (i32.const 255))
                   (i32.or (i32.eqz (i32.load (i32.const @(PG_H + KH_LEADT))))
                           (i32.ge_u (i32.sub (local.get $t) (i32.load (i32.const @(PG_H + KH_LEADT)))) (i32.const @KH_LEADGAP))))
        (then
          (i32.store (i32.const @(PG_H + KH_LEADT)) (local.get $t))
          (local.set $pb (i32.shl (local.get $who) (i32.const 6)))
          (call $fx (i32.const 0) (i32.const @KH_FX_LEAD) (local.get $who) (local.get $lead)
                    (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (!at f32 @(PLAYERS + P_PZ) (local.get $pb))
                    (f32.convert_i32_u (local.get $best))))))))

(func $kh_over (result i32) (i32.const 0))

(func $kh_out (param $p i32))
