;; The arena: a deathmatch on the golf engine, built when ARENA is set
;; (build/arena/game.wasm). Fighters carry two guns, frag grenades and a
;; melee; shields soak damage and come back after five quiet seconds, health
;; under them comes back once they're full. Hitscan shots are checked where
;; the shooter saw their targets: each fighter's input word carries its view
;; lag a bit a tick, and every fighter's position after each of the last 32
;; ticks is kept in HIST. Everything here runs serially, by slot, in the
;; same order on every machine, so a match is as deterministic as a hole.
;;
;; Code that $move reaches runs on either bank d (0 the confirmed world,
;; PRED_D the prediction); damage, kills, pickups and spawns happen only on
;; the confirmed world, so the prediction never writes outside PRED.
;;
;; A match plays one of the modes (layout.mjs, M_*; the last section here),
;; picked at run time as its countdown starts. A Fiesta leaves every mode
;; field at 0; the others put fighters on sides (P_FL's PF_ZOMBIE, PF_JUGG,
;; which the prediction reads for a zombie's legs) and keep a record per
;; fighter in MODE_REC.

;; ---- the map, built from maps/<name>/ by tools/map.mjs into this passive
;; segment: its head, its structures (boxes in groups), then its height and
;; surface images. Init copies them out; past the images the generated
;; terrain becomes the mountains round it, climbing from the images' edge.
(!mapdata)

(func $arena_gen (param $seed i32)
  (local $x i32) (local $z i32) (local $k i32) (local $i i32) (local $ex i32) (local $ez i32) (local $dx i32) (local $dz i32)
  (local $d f32) (local $h f32) (local $a i32) (local $sx f32) (local $sz f32)
  (memory.init $map (i32.const @MAP) (i32.const 0) (i32.const @MAP_HEAD))
  (memory.init $map (i32.const @MAP_GROUPS) (i32.const @MAPSEG_GROUPS) (i32.const @MAPSEG_NGROUPB))
  (memory.init $map (i32.const @MAP_BOXES) (i32.const @MAPSEG_BOXES) (i32.const @MAPSEG_NBOXB))
  (!for $z (i32.const 0) (i32.const @MAPIMG_H)
    (local.set $k (i32.add (i32.mul (i32.add (local.get $z) (i32.const @MAPIMG_Z0)) (i32.const @GRID)) (i32.const @MAPIMG_X0)))
    (memory.init $map (i32.add (i32.const @TERRAIN_H) (i32.shl (local.get $k) (i32.const 1)))
                      (i32.add (i32.const @MAPSEG_H) (i32.mul (local.get $z) (i32.const @(MAPIMG_W * 2)))) (i32.const @(MAPIMG_W * 2)))
    (memory.init $map (i32.add (i32.const @TERRAIN_S) (local.get $k))
                      (i32.add (i32.const @MAPSEG_S) (i32.mul (local.get $z) (i32.const @MAPIMG_W))) (i32.const @MAPIMG_W)))
  ;; outside the images: the nearest edge sample, plus half the noise's relief
  ;; faded in over 40 m, plus a rise of a quarter metre a sample
  (!for $z (i32.const 0) (i32.const @GRID)
    (!for $x (i32.const 0) (i32.const @GRID)
      (local.set $ex (select (i32.const @MAPIMG_X0) (local.get $x) (i32.lt_s (local.get $x) (i32.const @MAPIMG_X0))))
      (local.set $ex (select (i32.const @(MAPIMG_X0 + MAPIMG_W - 1)) (local.get $ex) (i32.gt_s (local.get $ex) (i32.const @(MAPIMG_X0 + MAPIMG_W - 1)))))
      (local.set $ez (select (i32.const @MAPIMG_Z0) (local.get $z) (i32.lt_s (local.get $z) (i32.const @MAPIMG_Z0))))
      (local.set $ez (select (i32.const @(MAPIMG_Z0 + MAPIMG_H - 1)) (local.get $ez) (i32.gt_s (local.get $ez) (i32.const @(MAPIMG_Z0 + MAPIMG_H - 1)))))
      (local.set $dx (i32.sub (local.get $x) (local.get $ex)))
      (local.set $dz (i32.sub (local.get $z) (local.get $ez)))
      (if (i32.or (local.get $dx) (local.get $dz))
        (then
          (local.set $k (i32.add (i32.shl (local.get $z) (i32.const 9)) (local.get $x)))
          (local.set $d (f32.sqrt (f32.convert_i32_s (i32.add (i32.mul (local.get $dx) (local.get $dx)) (i32.mul (local.get $dz) (local.get $dz))))))
          (local.set $h (f32.add (f32.add (f32.convert_i32_u (!ld u16 @TERRAIN_H (i32.add (i32.shl (local.get $ez) (i32.const 9)) (local.get $ex))))
                                          (f32.mul (f32.mul (f32.convert_i32_u (i32.sub (!ld u16 @TERRAIN_H (local.get $k)) (i32.const 4096))) (f32.const 0.5))
                                                   (f32.min (f32.mul (local.get $d) (f32.const 0.05)) (f32.const 1))))
                                 (f32.mul (local.get $d) (f32.const 64))))
          (!st u16 @TERRAIN_H (local.get $k) (i32.trunc_sat_f32_u (f32.min (f32.add (local.get $h) (f32.const 0.5)) (f32.const 65535))))
          (!st u8 @TERRAIN_S (local.get $k) (i32.const 0))))))
  ;; spawn points: on whatever is under them, up to the map's top for each
  (!for $i (i32.const 0) (i32.load (i32.const @MAP_NSPAWN))
    (local.set $sx (f32.load (i32.add (i32.const @MAP_SPAWN) (i32.shl (local.get $i) (i32.const 3)))))
    (local.set $sz (f32.load offset=4 (i32.add (i32.const @MAP_SPAWN) (i32.shl (local.get $i) (i32.const 3)))))
    (local.set $a (i32.add (i32.const @SPAWNS) (i32.shl (local.get $i) (i32.const 4))))
    (f32.store (local.get $a) (local.get $sx))
    (f32.store offset=4 (local.get $a) (call $stand (local.get $sx) (local.get $sz) (f32.load (i32.add (i32.const @MAP_SPAWNY) (i32.shl (local.get $i) (i32.const 2))))))
    (f32.store offset=8 (local.get $a) (local.get $sz)))
#if !FIESTA
  (!for $i (i32.const 0) (i32.load (i32.const @MAP_NPAD))
    (local.set $a (i32.add (i32.const @MAP_PADS) (i32.shl (local.get $i) (i32.const 4))))
    (call $pad (local.get $i) (i32.load offset=12 (local.get $a)) (f32.load (local.get $a)) (f32.load offset=4 (local.get $a)) (f32.load offset=8 (local.get $a))))
#endif
  (f32.store (i32.const @HDR_TEE) (f32.const 512))
  (f32.store (i32.const @(HDR_TEE + 8)) (f32.const 512))
  (f32.store (i32.const @HDR_DIR) (f32.const 1)))

(func $pad (param $k i32) (param $w i32) (param $x f32) (param $z f32) (param $top f32)
  (local $a i32)
  (local.set $a (i32.add (i32.const @PAD) (i32.shl (local.get $k) (i32.const 4))))
  (f32.store (local.get $a) (local.get $x))
  (f32.store offset=4 (local.get $a) (call $stand (local.get $x) (local.get $z) (local.get $top)))
  (f32.store offset=8 (local.get $a) (local.get $z))
  (i32.store8 offset=12 (local.get $a) (local.get $w))
  (i32.store16 offset=14 (local.get $a) (i32.const 0)))

;; Where feet at (x, z) stand: the ground, or the highest box top under the
;; body no higher than `top`.
(func $stand (param $x f32) (param $z f32) (param $top f32) (result f32)
  (call $ground (local.get $x) (local.get $z))
  (drop) (drop) (drop) (drop)
  (call $hull_y (local.get $x) (local.get $z) (local.get $top) (f32.const 1e9))
  (drop)
  (f32.max))

;; ---- the boxes. Every query walks the groups in order and, in a group whose
;; bounds it touches, the group's boxes in order, so it meets them in the
;; same order on every machine. A box or group record starts with its
;; bounds: f32 x0, y0, z0, x1, y1, z1.

;; Does the record at b overlap the box (x0, y0, z0)..(x1, y1, z1)? Touching isn't overlapping.
(func $touch (param $b i32) (param $x0 f32) (param $y0 f32) (param $z0 f32) (param $x1 f32) (param $y1 f32) (param $z1 f32) (result i32)
  (i32.and (i32.and (i32.and (f32.lt (local.get $x0) (f32.load offset=12 (local.get $b))) (f32.gt (local.get $x1) (f32.load (local.get $b))))
                    (i32.and (f32.lt (local.get $y0) (f32.load offset=16 (local.get $b))) (f32.gt (local.get $y1) (f32.load offset=4 (local.get $b)))))
           (i32.and (f32.lt (local.get $z0) (f32.load offset=20 (local.get $b))) (f32.gt (local.get $z1) (f32.load offset=8 (local.get $b))))))

;; A body moving along one axis (a: 0 for x, 8 for z, the byte offset of its
;; field) from `from` to `to`, the other axis at o, its feet-to-head band
;; [lo, hi): how far it gets. A box it was clear of on that side stops it a
;; body's radius short; one it already overlaps doesn't.
(func $hull_axis (param $a i32) (param $from f32) (param $to f32) (param $o f32) (param $lo f32) (param $hi f32) (result f32)
  (local $g i32) (local $ga i32) (local $k i32) (local $end i32) (local $b i32) (local $mn f32) (local $mx f32)
  (local $x0 f32) (local $x1 f32) (local $z0 f32) (local $z1 f32)
  (!for $g (i32.const 0) (i32.load (i32.const @MAP_NGROUP))
    (local.set $x0 (select (f32.sub (local.get $to) (f32.const @P_R)) (f32.sub (local.get $o) (f32.const @P_R)) (i32.eqz (local.get $a))))
    (local.set $x1 (select (f32.add (local.get $to) (f32.const @P_R)) (f32.add (local.get $o) (f32.const @P_R)) (i32.eqz (local.get $a))))
    (local.set $z0 (select (f32.sub (local.get $o) (f32.const @P_R)) (f32.sub (local.get $to) (f32.const @P_R)) (i32.eqz (local.get $a))))
    (local.set $z1 (select (f32.add (local.get $o) (f32.const @P_R)) (f32.add (local.get $to) (f32.const @P_R)) (i32.eqz (local.get $a))))
    (local.set $ga (i32.add (i32.const @MAP_GROUPS) (i32.shl (local.get $g) (i32.const 5))))
    (if (call $touch (local.get $ga) (local.get $x0) (local.get $lo) (local.get $z0) (local.get $x1) (local.get $hi) (local.get $z1))
      (then
        (local.set $end (i32.add (i32.load offset=24 (local.get $ga)) (i32.load offset=28 (local.get $ga))))
        (!for $k (i32.load offset=24 (local.get $ga)) (local.get $end)
          (local.set $b (i32.add (i32.const @MAP_BOXES) (i32.shl (local.get $k) (i32.const 5))))
          (if (call $touch (local.get $b) (local.get $x0) (local.get $lo) (local.get $z0) (local.get $x1) (local.get $hi) (local.get $z1))
            (then
              (local.set $mn (f32.load (i32.add (local.get $b) (local.get $a))))
              (local.set $mx (f32.load offset=12 (i32.add (local.get $b) (local.get $a))))
              (if (f32.le (f32.add (local.get $from) (f32.const @P_R)) (f32.add (local.get $mn) (f32.const 0.001)))
                (then (local.set $to (f32.sub (local.get $mn) (f32.const @P_R))))
                (else
                  (if (f32.ge (f32.sub (local.get $from) (f32.const @P_R)) (f32.sub (local.get $mx) (f32.const 0.001)))
                    (then (local.set $to (f32.add (local.get $mx) (f32.const @P_R)))))))
              ;; the clamp moved the body: the rest of the boxes see where it is now
              (local.set $x0 (select (f32.sub (local.get $to) (f32.const @P_R)) (local.get $x0) (i32.eqz (local.get $a))))
              (local.set $x1 (select (f32.add (local.get $to) (f32.const @P_R)) (local.get $x1) (i32.eqz (local.get $a))))
              (local.set $z0 (select (local.get $z0) (f32.sub (local.get $to) (f32.const @P_R)) (i32.eqz (local.get $a))))
              (local.set $z1 (select (local.get $z1) (f32.add (local.get $to) (f32.const @P_R)) (i32.eqz (local.get $a))))))))))
  (local.get $to))

;; Under and over a body at (x, z): the highest box top no higher than
;; `reach`, and the lowest box bottom no lower than `top` (-1e9 and 1e9 for none).
(func $hull_y (param $x f32) (param $z f32) (param $reach f32) (param $top f32) (result f32 f32)
  (local $g i32) (local $ga i32) (local $k i32) (local $end i32) (local $b i32) (local $floor f32) (local $ceil f32) (local $v f32)
  (local.set $floor (f32.const -1e9))
  (local.set $ceil (f32.const 1e9))
  (!for $g (i32.const 0) (i32.load (i32.const @MAP_NGROUP))
    (local.set $ga (i32.add (i32.const @MAP_GROUPS) (i32.shl (local.get $g) (i32.const 5))))
    (if (call $touch (local.get $ga) (f32.sub (local.get $x) (f32.const @P_R)) (f32.const -1e9) (f32.sub (local.get $z) (f32.const @P_R))
                                     (f32.add (local.get $x) (f32.const @P_R)) (f32.const 1e9) (f32.add (local.get $z) (f32.const @P_R)))
      (then
        (local.set $end (i32.add (i32.load offset=24 (local.get $ga)) (i32.load offset=28 (local.get $ga))))
        (!for $k (i32.load offset=24 (local.get $ga)) (local.get $end)
          (local.set $b (i32.add (i32.const @MAP_BOXES) (i32.shl (local.get $k) (i32.const 5))))
          (if (call $touch (local.get $b) (f32.sub (local.get $x) (f32.const @P_R)) (f32.const -1e9) (f32.sub (local.get $z) (f32.const @P_R))
                                          (f32.add (local.get $x) (f32.const @P_R)) (f32.const 1e9) (f32.add (local.get $z) (f32.const @P_R)))
            (then
              (local.set $v (f32.load offset=16 (local.get $b)))
              (if (f32.le (local.get $v) (local.get $reach)) (then (local.set $floor (f32.max (local.get $floor) (local.get $v)))))
              (local.set $v (f32.load offset=4 (local.get $b)))
              (if (f32.ge (local.get $v) (local.get $top)) (then (local.set $ceil (f32.min (local.get $ceil) (local.get $v)))))))))))
  (local.get $floor)
  (local.get $ceil))

;; One axis of a ray's slab test: the span [t0, t1] narrowed to where the ray
;; is between mn and mx on it (an empty span, t0 > t1, for a miss).
(func $slab1 (param $mn f32) (param $mx f32) (param $o f32) (param $d f32) (param $t0 f32) (param $t1 f32) (result f32 f32)
  (local $ta f32) (local $tb f32) (local $inv f32)
  (if (f32.lt (f32.abs (local.get $d)) (f32.const 1e-9))
    (then
      (if (i32.or (f32.le (local.get $o) (local.get $mn)) (f32.ge (local.get $o) (local.get $mx)))
        (then (return (f32.const 1) (f32.const 0))))
      (return (local.get $t0) (local.get $t1))))
  (local.set $inv (f32.div (f32.const 1) (local.get $d)))
  (local.set $ta (f32.mul (f32.sub (local.get $mn) (local.get $o)) (local.get $inv)))
  (local.set $tb (f32.mul (f32.sub (local.get $mx) (local.get $o)) (local.get $inv)))
  (f32.max (local.get $t0) (f32.min (local.get $ta) (local.get $tb)))
  (f32.min (local.get $t1) (f32.max (local.get $ta) (local.get $tb))))

;; Where the ray o + t d enters the record at b, t in [0, tmax]; tmax + 1 for a miss.
;; A ray that starts inside it enters at 0.
(func $slab (param $b i32) (param $ox f32) (param $oy f32) (param $oz f32) (param $dx f32) (param $dy f32) (param $dz f32) (param $tmax f32) (result f32)
  (local $t0 f32) (local $t1 f32)
  (call $slab1 (f32.load (local.get $b)) (f32.load offset=12 (local.get $b)) (local.get $ox) (local.get $dx) (f32.const 0) (local.get $tmax))
  (local.set $t1) (local.set $t0)
  (call $slab1 (f32.load offset=4 (local.get $b)) (f32.load offset=16 (local.get $b)) (local.get $oy) (local.get $dy) (local.get $t0) (local.get $t1))
  (local.set $t1) (local.set $t0)
  (call $slab1 (f32.load offset=8 (local.get $b)) (f32.load offset=20 (local.get $b)) (local.get $oz) (local.get $dz) (local.get $t0) (local.get $t1))
  (local.set $t1) (local.set $t0)
  (select (local.get $t0) (f32.add (local.get $tmax) (f32.const 1)) (f32.le (local.get $t0) (local.get $t1))))

;; How far the ray o + t d goes before a box, out to tmax.
(func $box_ray (param $ox f32) (param $oy f32) (param $oz f32) (param $dx f32) (param $dy f32) (param $dz f32) (param $tmax f32) (result f32)
  (local $g i32) (local $ga i32) (local $k i32) (local $end i32) (local $best f32)
  (local.set $best (local.get $tmax))
  (!for $g (i32.const 0) (i32.load (i32.const @MAP_NGROUP))
    (local.set $ga (i32.add (i32.const @MAP_GROUPS) (i32.shl (local.get $g) (i32.const 5))))
    (if (f32.le (call $slab (local.get $ga) (local.get $ox) (local.get $oy) (local.get $oz) (local.get $dx) (local.get $dy) (local.get $dz) (local.get $best)) (local.get $best))
      (then
        (local.set $end (i32.add (i32.load offset=24 (local.get $ga)) (i32.load offset=28 (local.get $ga))))
        (!for $k (i32.load offset=24 (local.get $ga)) (local.get $end)
          (local.set $best (f32.min (local.get $best)
            (call $slab (i32.add (i32.const @MAP_BOXES) (i32.shl (local.get $k) (i32.const 5)))
                        (local.get $ox) (local.get $oy) (local.get $oz) (local.get $dx) (local.get $dy) (local.get $dz) (local.get $best))))))))
  (local.get $best))

;; 1 if nothing stands between a and b.
(func $clear (param $ax f32) (param $ay f32) (param $az f32) (param $bx f32) (param $by f32) (param $bz f32) (result i32)
  (f32.ge (call $box_ray (local.get $ax) (local.get $ay) (local.get $az)
                         (f32.sub (local.get $bx) (local.get $ax)) (f32.sub (local.get $by) (local.get $ay)) (f32.sub (local.get $bz) (local.get $az)) (f32.const 1))
          (f32.const 1)))

;; The first box (its address) that the point is inside, grown by r on every side, or 0.
(func $box_in (param $x f32) (param $y f32) (param $z f32) (param $r f32) (result i32)
  (local $g i32) (local $ga i32) (local $k i32) (local $end i32) (local $b i32)
  (!for $g (i32.const 0) (i32.load (i32.const @MAP_NGROUP))
    (local.set $ga (i32.add (i32.const @MAP_GROUPS) (i32.shl (local.get $g) (i32.const 5))))
    (if (call $touch (local.get $ga) (f32.sub (local.get $x) (local.get $r)) (f32.sub (local.get $y) (local.get $r)) (f32.sub (local.get $z) (local.get $r))
                                     (f32.add (local.get $x) (local.get $r)) (f32.add (local.get $y) (local.get $r)) (f32.add (local.get $z) (local.get $r)))
      (then
        (local.set $end (i32.add (i32.load offset=24 (local.get $ga)) (i32.load offset=28 (local.get $ga))))
        (!for $k (i32.load offset=24 (local.get $ga)) (local.get $end)
          (local.set $b (i32.add (i32.const @MAP_BOXES) (i32.shl (local.get $k) (i32.const 5))))
          (if (call $touch (local.get $b) (f32.sub (local.get $x) (local.get $r)) (f32.sub (local.get $y) (local.get $r)) (f32.sub (local.get $z) (local.get $r))
                                          (f32.add (local.get $x) (local.get $r)) (f32.add (local.get $y) (local.get $r)) (f32.add (local.get $z) (local.get $r)))
            (then (return (local.get $b))))))))
  (i32.const 0))

;; A fighter of bank d whose feet reach a teleporter's pad comes out at its
;; other end, moving as it was: the position, and 1 if it went through.
(func $a_tele (param $p i32) (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32 f32 f32 i32)
  (local $k i32) (local $a i32) (local $dx f32) (local $dz f32) (local $r f32)
  (!for $k (i32.const 0) (i32.load (i32.const @MAP_NTELE))
    (local.set $a (i32.add (i32.const @MAP_TELE) (i32.shl (local.get $k) (i32.const 5))))
    (local.set $dx (f32.sub (local.get $x) (f32.load (local.get $a))))
    (local.set $dz (f32.sub (local.get $z) (f32.load offset=8 (local.get $a))))
    (local.set $r (f32.load offset=12 (local.get $a)))
    (if (i32.and (f32.lt (f32.add (f32.mul (local.get $dx) (local.get $dx)) (f32.mul (local.get $dz) (local.get $dz))) (f32.mul (local.get $r) (local.get $r)))
                 (f32.lt (f32.abs (f32.sub (local.get $y) (f32.load offset=4 (local.get $a)))) (f32.const 2)))
      (then
        (call $fx (local.get $d) (i32.const @FX_TELE) (local.get $p) (local.get $k)
                  (f32.load offset=16 (local.get $a)) (f32.load offset=20 (local.get $a)) (f32.load offset=24 (local.get $a)) (f32.const 1))
        (return (f32.load offset=16 (local.get $a)) (f32.load offset=20 (local.get $a)) (f32.load offset=24 (local.get $a)) (i32.const 1)))))
  (local.get $x) (local.get $y) (local.get $z) (i32.const 0))

;; ---- fighters

;; Slot p comes (back) into the fight at the spawn point farthest from the
;; nearest enemy (for a zombie, the one nearest 40 m from it), of four
;; drawn at random: full shields and health, two frags, and in Fiesta two
;; different guns drawn at random (in slayer an assault rifle out and a
;; magnum on the back). The match's mode may say otherwise: a zombie has the
;; sword and nothing else, Infection's humans a shotgun and a magnum, gun
;; game the gun of the fighter's rung.
(func $a_spawn (param $p i32)
  (local $pb i32) (local $k i32) (local $i i32) (local $q i32) (local $qb i32) (local $in i32)
  (local $best i32) (local $bestd f32) (local $md f32) (local $sx f32) (local $sz f32) (local $dx f32) (local $dz f32) (local $h f32)
  (local $g0 i32) (local $g1 i32) (local $mode i32) (local $zed i32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (local.set $mode (i32.load (i32.const @AH_MODE)))
  ;; a zombie stays one; a juggernaut that died is anyone again
  (local.set $zed (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_ZOMBIE)))
  (local.set $bestd (select (f32.const -1e30) (f32.const -1) (local.get $zed)))
  (!for $k (i32.const 0) (i32.const 4)
    (local.set $i (i32.rem_u (call $rand) (i32.load (i32.const @MAP_NSPAWN))))
    (local.set $sx (f32.load (i32.add (i32.const @SPAWNS) (i32.shl (local.get $i) (i32.const 4)))))
    (local.set $sz (f32.load offset=8 (i32.add (i32.const @SPAWNS) (i32.shl (local.get $i) (i32.const 4)))))
    (local.set $md (f32.const 1e9))
    (!for $q (i32.const 0) (i32.const @NPLAYER)
      (local.set $qb (i32.shl (local.get $q) (i32.const 6)))
      (if (i32.and (i32.and (i32.eq (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $qb)) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE))
                            (i32.ne (local.get $q) (local.get $p)))
                   (i32.eqz (call $a_ally (local.get $p) (local.get $q))))
        (then
          (local.set $dx (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $qb)) (local.get $sx)))
          (local.set $dz (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $qb)) (local.get $sz)))
          (local.set $md (f32.min (local.get $md) (f32.add (f32.mul (local.get $dx) (local.get $dx)) (f32.mul (local.get $dz) (local.get $dz))))))))
    ;; a zombie hunts: the point whose nearest human is nearest 40 m
    (if (local.get $zed) (then (local.set $md (f32.neg (f32.abs (f32.sub (local.get $md) (f32.const 1600)))))))
    (if (f32.gt (local.get $md) (local.get $bestd))
      (then (local.set $bestd (local.get $md)) (local.set $best (local.get $i)))))
  (local.set $sx (f32.load (i32.add (i32.const @SPAWNS) (i32.shl (local.get $best) (i32.const 4)))))
  (local.set $h (f32.load offset=4 (i32.add (i32.const @SPAWNS) (i32.shl (local.get $best) (i32.const 4)))))
  (local.set $sz (f32.load offset=8 (i32.add (i32.const @SPAWNS) (i32.shl (local.get $best) (i32.const 4)))))
  (local.set $in (!at i32 @(PLAYERS + P_IN) (local.get $pb)))
  (!put f32 @(PLAYERS + P_PX) (local.get $pb) (local.get $sx))
  (!put f32 @(PLAYERS + P_PY) (local.get $pb) (local.get $h))
  (!put f32 @(PLAYERS + P_PZ) (local.get $pb) (local.get $sz))
  (!put f32 @(PLAYERS + P_VX) (local.get $pb) (f32.const 0))
  (!put f32 @(PLAYERS + P_VY) (local.get $pb) (f32.const 0))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (f32.const 0))
  (!put u8 @(PLAYERS + P_FL) (local.get $pb) (i32.or (i32.const @(PF_LIVE | PF_GROUND)) (local.get $zed)))
  ;; a shot, melee or throw already asked for doesn't happen on arrival
  (!put u8 @(PLAYERS + P_FIRED) (local.get $pb) (i32.and (i32.shr_u (local.get $in) (i32.const @AW_SHOT)) (i32.const 3)))
  (!put u8 @(PLAYERS + A_ACT) (local.get $pb) (i32.and (i32.shr_u (local.get $in) (i32.const @AW_MELEE)) (i32.const 7)))
  (!put u16 @(PLAYERS + P_REFIRE) (local.get $pb) (i32.const 0))
  (!put u8 @(PLAYERS + A_HP) (local.get $pb) (i32.const 100))
  (!put u8 @(PLAYERS + A_SH) (local.get $pb) (select (i32.const 0) (i32.const 100) (local.get $zed)))
  (!put u16 @(PLAYERS + A_SHT) (local.get $pb) (i32.const 0))
  (if (i32.or (i32.eq (local.get $mode) (i32.const @M_FIESTA)) (i32.eq (local.get $mode) (i32.const @M_JUGGERNAUT)))
    (then
#if FIESTA
      ;; two different guns at random, full
      (local.set $g0 (i32.add (i32.rem_u (call $rand) (i32.const @(ARMS.length - 1))) (i32.const 1)))
      (local.set $g1 (i32.add (i32.rem_u (call $rand) (i32.const @(ARMS.length - 2))) (i32.const 1)))
      (if (i32.ge_u (local.get $g1) (local.get $g0)) (then (local.set $g1 (i32.add (local.get $g1) (i32.const 1)))))
#else
      (local.set $g0 (i32.const @W_AR))
      (local.set $g1 (i32.const @W_MAGNUM))
#endif
      ))
  (if (i32.eq (local.get $mode) (i32.const @M_INFECTION))
    (then
      (local.set $g0 (select (i32.const @W_SWORD) (i32.const @W_SHOTGUN) (local.get $zed)))
      (local.set $g1 (select (i32.const @W_SWORD) (i32.const @W_MAGNUM) (local.get $zed)))))
  (if (i32.eq (local.get $mode) (i32.const @M_GUNGAME))
    (then
      (local.set $g0 (i32.load8_u offset=@(MODE_REC + MR_RUNG) (i32.shl (local.get $p) (i32.const 3))))
      (local.set $g0 (!tab LADDER (local.get $g0)))
      (local.set $g1 (local.get $g0))))
  (call $a_arm (local.get $p) (local.get $g0) (local.get $g1))
  (!put u8 @(PLAYERS + A_GRENS) (local.get $pb) (select (i32.const 0) (i32.const 2) (local.get $zed)))
  (!put u16 @(PLAYERS + A_COOL) (local.get $pb) (i32.const 0))
  (!put u16 @(PLAYERS + A_RESPAWN) (local.get $pb) (i32.const 0))
  (!put u8 @(PLAYERS + A_NEEDLES) (local.get $pb) (i32.const 0))
  (!put u8 @(PLAYERS + A_NEEDT) (local.get $pb) (i32.const 0))
  (call $fx (i32.const 0) (i32.const @FX_SPAWN) (local.get $p) (i32.const 0) (local.get $sx) (local.get $h) (local.get $sz) (f32.const 1)))

;; Slot p's two guns, g0 and g1 (the same gun twice is one gun in either
;; hand), full, with no reload or burst under way.
(func $a_arm (param $p i32) (param $g0 i32) (param $g1 i32)
  (local $pb i32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (!put u8 @(PLAYERS + A_GUN) (local.get $pb) (local.get $g0))
  (!put u8 @(PLAYERS + A_GUN + 1) (local.get $pb) (local.get $g1))
  (!put u8 @(PLAYERS + A_MAG) (local.get $pb) (!arm mag (local.get $g0)))
  (!put u8 @(PLAYERS + A_MAG + 1) (local.get $pb) (!arm mag (local.get $g1)))
  (!put u16 @(PLAYERS + A_RES) (local.get $pb) (!arm res (local.get $g0)))
  (!put u16 @(PLAYERS + A_RES + 2) (local.get $pb) (!arm res (local.get $g1)))
  (!put u8 @(PLAYERS + A_RELOAD) (local.get $pb) (i32.const 0))
  (!put u8 @(PLAYERS + A_BURST) (local.get $pb) (i32.const 0)))

;; The frame's bit for this tick (bit tick & 7 of b31): a whole frame, if one
;; was sent, sets the view lag and asks for a reload or a pickup.
(func $a_frame (param $pb i32) (param $d i32) (param $in i32)
  (local $idx i32) (local $fr i32) (local $w i32) (local $slot i32) (local $mag i32)
  (local.set $idx (i32.and (i32.load offset=@HDR_TICK (local.get $d)) (i32.const 7)))
  (local.set $fr (i32.or (!at u8 @(PLAYERS + A_FRAME) (local.get $pb))
                         (i32.shl (i32.shr_u (local.get $in) (i32.const @AW_SERIAL)) (local.get $idx))))
  (if (i32.ne (local.get $idx) (i32.const 7))
    (then (!put u8 @(PLAYERS + A_FRAME) (local.get $pb) (local.get $fr)) (return)))
  (!put u8 @(PLAYERS + A_FRAME) (local.get $pb) (i32.const 0))
  ;; no frame this time: nothing new
  (if (i32.eqz (i32.and (local.get $fr) (i32.const @AF_SENT))) (then (return)))
  (!put u8 @(PLAYERS + A_LAG) (local.get $pb) (i32.and (i32.shr_u (local.get $fr) (i32.const @AF_LAG_SHIFT)) (i32.const @LAG_MAX)))
  (if (i32.and (local.get $fr) (i32.const @AF_USE))
    (then (!put u8 @(PLAYERS + A_ACT) (local.get $pb) (i32.or (!at u8 @(PLAYERS + A_ACT) (local.get $pb)) (i32.const @AB_USE)))))
  (if (i32.and (i32.ne (i32.and (local.get $fr) (i32.const @AF_RELOAD)) (i32.const 0))
               (i32.eqz (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_DEAD))))
    (then
      (local.set $slot (i32.and (i32.shr_u (!at u8 @(PLAYERS + A_ACT) (local.get $pb)) (i32.const 2)) (i32.const 1)))
      (local.set $w (i32.load8_u offset=@(PLAYERS + A_GUN) (i32.add (local.get $pb) (local.get $slot))))
      (local.set $mag (i32.load8_u offset=@(PLAYERS + A_MAG) (i32.add (local.get $pb) (local.get $slot))))
      (if (i32.and (i32.and (i32.lt_u (local.get $mag) (!arm mag (local.get $w))) (i32.ne (!arm reload (local.get $w)) (i32.const 0)))
                   (i32.and (i32.ne (i32.load16_u offset=@(PLAYERS + A_RES) (i32.add (local.get $pb) (i32.shl (local.get $slot) (i32.const 1)))) (i32.const 0))
                            (i32.eqz (!at u8 @(PLAYERS + A_RELOAD) (local.get $pb)))))
        (then
          (!put u8 @(PLAYERS + A_RELOAD) (local.get $pb) (!arm reload (local.get $w)))
          (!put u8 @(PLAYERS + A_BURST) (local.get $pb) (i32.const 0)))))))

;; A dead fighter's tick: no moving, nothing fires; the counters it would act
;; on follow the input so nothing is waiting on arrival.
(func $a_dead (param $p i32) (param $d i32) (param $in i32)
  (local $pb i32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (call $a_frame (local.get $pb) (local.get $d) (local.get $in))
  (!put u8 @(PLAYERS + P_FIRED) (local.get $pb) (i32.and (i32.shr_u (local.get $in) (i32.const @AW_SHOT)) (i32.const 3)))
  (!put u8 @(PLAYERS + A_ACT) (local.get $pb)
    (i32.or (i32.and (!at u8 @(PLAYERS + A_ACT) (local.get $pb)) (i32.const @(255 ^ (AB_MELEE | AB_GREN))))
            (i32.and (i32.shr_u (local.get $in) (i32.const @AW_MELEE)) (i32.const @(AB_MELEE | AB_GREN))))))

;; One live fighter's weapons for this tick, before it moves: swapping guns,
;; reloading, melee, grenades and the trigger. No shots in the countdown.
(func $a_shoot (param $p i32) (param $d i32) (param $in i32) (param $s f32) (param $c f32)
  (local $pb i32) (local $act i32) (local $slot i32) (local $w i32) (local $re i32) (local $rl i32) (local $cool i32)
  (local $ctr i32) (local $mag i32) (local $res i32) (local $take i32) (local $state i32) (local $u i32) (local $bit i32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (call $a_frame (local.get $pb) (local.get $d) (local.get $in))
  (local.set $act (!at u8 @(PLAYERS + A_ACT) (local.get $pb)))
  (local.set $slot (i32.and (i32.shr_u (local.get $in) (i32.const @AW_SLOT)) (i32.const 1)))
  (local.set $re (!at u16 @(PLAYERS + P_REFIRE) (local.get $pb)))
  (if (i32.ne (local.get $slot) (i32.and (i32.shr_u (local.get $act) (i32.const 2)) (i32.const 1)))
    (then
      (local.set $act (i32.xor (local.get $act) (i32.const @AB_SLOT)))
      (local.set $re (select (local.get $re) (i32.const @SWAP_TICKS) (i32.gt_u (local.get $re) (i32.const @SWAP_TICKS))))
      (!put u8 @(PLAYERS + A_BURST) (local.get $pb) (i32.const 0))
      (!put u8 @(PLAYERS + A_RELOAD) (local.get $pb) (i32.const 0))))
  (local.set $w (i32.load8_u offset=@(PLAYERS + A_GUN) (i32.add (local.get $pb) (local.get $slot))))
  (if (local.get $re) (then (local.set $re (i32.sub (local.get $re) (i32.const 1)))))
  (!put u16 @(PLAYERS + P_REFIRE) (local.get $pb) (local.get $re))
  ;; a reload ends: the magazine takes what the reserve has
  (local.set $rl (!at u8 @(PLAYERS + A_RELOAD) (local.get $pb)))
  (if (local.get $rl)
    (then
      (local.set $rl (i32.sub (local.get $rl) (i32.const 1)))
      (!put u8 @(PLAYERS + A_RELOAD) (local.get $pb) (local.get $rl))
      (if (i32.eqz (local.get $rl))
        (then
          (local.set $mag (i32.load8_u offset=@(PLAYERS + A_MAG) (i32.add (local.get $pb) (local.get $slot))))
          (local.set $res (i32.load16_u offset=@(PLAYERS + A_RES) (i32.add (local.get $pb) (i32.shl (local.get $slot) (i32.const 1)))))
          (local.set $take (i32.sub (!arm mag (local.get $w)) (local.get $mag)))
          (if (i32.gt_u (local.get $take) (local.get $res)) (then (local.set $take (local.get $res))))
          (i32.store8 offset=@(PLAYERS + A_MAG) (i32.add (local.get $pb) (local.get $slot)) (i32.add (local.get $mag) (local.get $take)))
          (i32.store16 offset=@(PLAYERS + A_RES) (i32.add (local.get $pb) (i32.shl (local.get $slot) (i32.const 1))) (i32.sub (local.get $res) (local.get $take)))))))
  (local.set $cool (!at u16 @(PLAYERS + A_COOL) (local.get $pb)))
  (if (local.get $cool) (then (local.set $cool (i32.sub (local.get $cool) (i32.const 1)))))
  (local.set $ctr (i32.and (i32.shr_u (local.get $in) (i32.const @AW_SHOT)) (i32.const 3)))
  (local.set $state (i32.load offset=@HDR_STATE (local.get $d)))
  (if (i32.le_u (local.get $state) (i32.const @H_COUNT))
    (then
      (!put u8 @(PLAYERS + P_FIRED) (local.get $pb) (local.get $ctr))
      (!put u8 @(PLAYERS + A_ACT) (local.get $pb)
        (i32.or (i32.and (local.get $act) (i32.const @(255 ^ (AB_MELEE | AB_GREN))))
                (i32.and (i32.shr_u (local.get $in) (i32.const @AW_MELEE)) (i32.const @(AB_MELEE | AB_GREN)))))
      (!put u16 @(PLAYERS + A_COOL) (local.get $pb) (local.get $cool))
      (return)))
  (local.set $u (i32.shl (i32.sub (i32.and (i32.shr_u (local.get $in) (i32.const @AW_PITCH)) (i32.const 0x3ff)) (i32.const 512)) (i32.const 3)))
  ;; melee: the sword swings, anything else is a rifle butt
  (local.set $bit (i32.and (i32.shr_u (local.get $in) (i32.const @AW_MELEE)) (i32.const 1)))
  (if (i32.ne (local.get $bit) (i32.and (local.get $act) (i32.const @AB_MELEE)))
    (then
      (local.set $act (i32.xor (local.get $act) (i32.const @AB_MELEE)))
      (if (i32.eqz (local.get $cool))
        (then
          (!put u16 @(PLAYERS + P_SHOTS) (local.get $pb) (i32.add (!at u16 @(PLAYERS + P_SHOTS) (local.get $pb)) (i32.const 1)))
          (call $a_melee (local.get $p) (local.get $d) (local.get $s) (local.get $c) (i32.eq (local.get $w) (i32.const @W_SWORD)))
          (local.set $cool (i32.const @COOL_TICKS))
          (!put u8 @(PLAYERS + A_BURST) (local.get $pb) (i32.const 0))
          (!put u8 @(PLAYERS + A_RELOAD) (local.get $pb) (i32.const 0))
          (if (i32.lt_u (local.get $re) (i32.const @(COOL_TICKS / 2)))
            (then (local.set $re (i32.const @(COOL_TICKS / 2))) (!put u16 @(PLAYERS + P_REFIRE) (local.get $pb) (local.get $re))))))))
  ;; a frag: thrown along the view, a little up
  (local.set $bit (i32.and (i32.shr_u (local.get $in) (i32.const @AW_GREN)) (i32.const 1)))
  (if (i32.ne (local.get $bit) (i32.and (i32.shr_u (local.get $act) (i32.const 1)) (i32.const 1)))
    (then
      (local.set $act (i32.xor (local.get $act) (i32.const @AB_GREN)))
      (if (i32.and (i32.eqz (local.get $cool)) (i32.ne (!at u8 @(PLAYERS + A_GRENS) (local.get $pb)) (i32.const 0)))
        (then
          (!put u8 @(PLAYERS + A_GRENS) (local.get $pb) (i32.sub (!at u8 @(PLAYERS + A_GRENS) (local.get $pb)) (i32.const 1)))
          (!put u16 @(PLAYERS + P_SHOTS) (local.get $pb) (i32.add (!at u16 @(PLAYERS + P_SHOTS) (local.get $pb)) (i32.const 1)))
          (call $a_launch (local.get $p) (local.get $d) (i32.const @K_GRENADE) (local.get $s) (local.get $c) (local.get $u) (f32.const @GREN_V) (f32.const @GREN_UP) (i32.const 0))
          (local.set $cool (i32.const @COOL_TICKS))))))
  (!put u8 @(PLAYERS + A_ACT) (local.get $pb) (local.get $act))
  (!put u16 @(PLAYERS + A_COOL) (local.get $pb) (local.get $cool))
  (if (i32.or (local.get $re) (!at u8 @(PLAYERS + A_RELOAD) (local.get $pb))) (then (return)))
  ;; the rest of a burst fires on its own, four ticks apart
  (if (!at u8 @(PLAYERS + A_BURST) (local.get $pb))
    (then
      (!put u8 @(PLAYERS + A_BURST) (local.get $pb) (i32.sub (!at u8 @(PLAYERS + A_BURST) (local.get $pb)) (i32.const 1)))
      (call $a_round (local.get $p) (local.get $d) (local.get $slot) (local.get $w) (local.get $in) (local.get $s) (local.get $c) (local.get $u))
      (return)))
  (if (i32.eq (local.get $ctr) (!at u8 @(PLAYERS + P_FIRED) (local.get $pb))) (then (return)))
  (!put u8 @(PLAYERS + P_FIRED) (local.get $pb) (local.get $ctr))
  (if (i32.eqz (local.get $w)) (then (return)))
  (if (i32.eqz (i32.load8_u offset=@(PLAYERS + A_MAG) (i32.add (local.get $pb) (local.get $slot))))
    (then
      ;; dry: start a reload if there's anything to load
      (if (i32.and (i32.ne (!arm reload (local.get $w)) (i32.const 0))
                   (i32.ne (i32.load16_u offset=@(PLAYERS + A_RES) (i32.add (local.get $pb) (i32.shl (local.get $slot) (i32.const 1)))) (i32.const 0)))
        (then (!put u8 @(PLAYERS + A_RELOAD) (local.get $pb) (!arm reload (local.get $w)))))
      (return)))
  (if (i32.gt_u (!arm burst (local.get $w)) (i32.const 1))
    (then (!put u8 @(PLAYERS + A_BURST) (local.get $pb) (i32.sub (!arm burst (local.get $w)) (i32.const 1)))))
  (call $a_round (local.get $p) (local.get $d) (local.get $slot) (local.get $w) (local.get $in) (local.get $s) (local.get $c) (local.get $u)))

;; One round of weapon w from slot `slot`: the magazine, the refire, the shot.
(func $a_round (param $p i32) (param $d i32) (param $slot i32) (param $w i32) (param $in i32) (param $s f32) (param $c f32) (param $u i32)
  (local $pb i32) (local $mag i32) (local $k i32) (local $type i32) (local $shots i32) (local $px f32) (local $py f32) (local $pz f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  ;; a zombie's sword, or the juggernaut's, never runs out
  (local.set $mag (i32.sub (i32.load8_u offset=@(PLAYERS + A_MAG) (i32.add (local.get $pb) (local.get $slot)))
                           (i32.eqz (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @(PF_ZOMBIE | PF_JUGG))))))
  (i32.store8 offset=@(PLAYERS + A_MAG) (i32.add (local.get $pb) (local.get $slot)) (local.get $mag))
  (!put u16 @(PLAYERS + P_REFIRE) (local.get $pb)
    (select (i32.const 4) (!arm refire (local.get $w)) (i32.ne (!at u8 @(PLAYERS + A_BURST) (local.get $pb)) (i32.const 0))))
  (local.set $shots (i32.and (i32.add (!at u16 @(PLAYERS + P_SHOTS) (local.get $pb)) (i32.const 1)) (i32.const 0xffff)))
  (!put u16 @(PLAYERS + P_SHOTS) (local.get $pb) (local.get $shots))
  (local.set $px (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (local.set $py (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (f32.const @P_EYE)))
  (local.set $pz (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (call $fx (local.get $d) (i32.const @FX_SHOT) (local.get $p) (local.get $shots) (local.get $px) (local.get $py) (local.get $pz) (f32.convert_i32_u (local.get $w)))
  (local.set $type (!arm type (local.get $w)))
  (if (i32.eqz (local.get $type))
    (then
      (!for $k (i32.const 0) (!arm pellets (local.get $w))
        (call $a_hitscan (local.get $p) (local.get $d) (local.get $w) (local.get $in) (local.get $u) (local.get $k) (local.get $shots)))))
  (if (i32.eq (local.get $type) (i32.const 1))
    (then
      (call $a_aim (local.get $p) (local.get $in) (local.get $u) (local.get $shots) (i32.const 0) (!arm spread (local.get $w)))
      (local.set $c) (local.set $s) (local.set $u)
      (call $a_launch (local.get $p) (local.get $d) (!arm kind (local.get $w)) (local.get $s) (local.get $c) (local.get $u) (!arm speed (local.get $w)) (f32.const 0)
                      (i32.eq (local.get $w) (i32.const @W_NEEDLER)))))
  (if (i32.eq (local.get $type) (i32.const 2))
    (then (call $a_melee (local.get $p) (local.get $d) (local.get $s) (local.get $c) (i32.const 1))))
  ;; empty, and something to load: reload now
  (if (i32.and (i32.eqz (local.get $mag)) (i32.ne (!arm reload (local.get $w)) (i32.const 0)))
    (then
      (if (i32.ne (i32.load16_u offset=@(PLAYERS + A_RES) (i32.add (local.get $pb) (i32.shl (local.get $slot) (i32.const 1)))) (i32.const 0))
        (then
          (!put u8 @(PLAYERS + A_BURST) (local.get $pb) (i32.const 0))
          (!put u8 @(PLAYERS + A_RELOAD) (local.get $pb) (!arm reload (local.get $w))))))))

;; The aim of pellet k of shot `shots`, spread up to `spread` yaw units each
;; way by a hash of the fighter, the shot and the pellet (never the room's
;; PRNG, which only serial phases may draw from, so the prediction spreads
;; its shots exactly as the confirmed world will): pitch in yaw units, and
;; the yaw's sine and cosine.
(func $a_aim (param $p i32) (param $in i32) (param $u i32) (param $shots i32) (param $k i32) (param $spread i32) (result i32 f32 f32)
  (local $h i32) (local $yaw i32)
  (local.set $yaw (i32.shl (i32.and (local.get $in) (i32.const 0x7ff)) (i32.const 3)))
  (if (local.get $spread)
    (then
      (local.set $h (call $hash32 (i32.or (local.get $p) (i32.shl (local.get $shots) (i32.const 8))) (local.get $k) (i32.const 0x2545f491)))
      (local.set $yaw (i32.add (local.get $yaw)
        (i32.sub (i32.shr_u (i32.mul (i32.and (local.get $h) (i32.const 0xffff)) (i32.shl (local.get $spread) (i32.const 1))) (i32.const 16)) (local.get $spread))))
      (local.set $u (i32.add (local.get $u)
        (i32.sub (i32.shr_u (i32.mul (i32.shr_u (local.get $h) (i32.const 16)) (i32.shl (local.get $spread) (i32.const 1))) (i32.const 16)) (local.get $spread))))))
  (local.get $u)
  (call $sincos (local.get $yaw)))

;; Where slot q stood after tick rt, as far as the confirmed world knows: from
;; HIST if rt is one of its last 31 ticks, else where it stands now.
(func $a_where (param $q i32) (param $rt i32) (result f32 f32 f32)
  (local $now i32) (local $a i32)
  (local.set $now (i32.load (i32.const @HDR_TICK)))
  (if (i32.and (i32.lt_s (local.get $rt) (local.get $now)) (i32.le_s (i32.sub (local.get $now) (local.get $rt)) (i32.const @LAG_MAX)))
    (then
      (local.set $a (i32.add (i32.add (i32.const @HIST) (i32.mul (i32.and (local.get $rt) (i32.const 31)) (i32.const @HIST_TICK)))
                             (i32.shl (local.get $q) (i32.const 4))))
      (return (f32.load (local.get $a)) (f32.load offset=4 (local.get $a)) (f32.load offset=8 (local.get $a)))))
  (local.set $a (i32.add (i32.const @PLAYERS) (i32.shl (local.get $q) (i32.const 6))))
  (f32.load offset=@P_PX (local.get $a)) (f32.load offset=@P_PY (local.get $a)) (f32.load offset=@P_PZ (local.get $a)))

;; The tick slot p (of bank d) saw the others at: this tick less its view lag.
(func $a_seen (param $p i32) (param $d i32) (result i32)
  (i32.sub (i32.load offset=@HDR_TICK (local.get $d))
           (!at u8 @(PLAYERS + A_LAG) (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))))

;; A ray from (ox, oy, oz) along the unit (dx, dy, dz), out to `range`, against
;; the ground, the map's boxes and every live fighter but p where it stood at tick rt: the
;; fighter it hits first (or -1), how far, and 1 if it took them in the head.
;; A body is an upright cylinder 0.45 m across from the feet to 1.45 m, a
;; head a ball of 0.22 m at 1.62 m.
(func $a_ray (param $p i32) (param $ox f32) (param $oy f32) (param $oz f32) (param $dx f32) (param $dy f32) (param $dz f32) (param $range f32) (param $rt i32)
  (result i32 f32 i32)
  (local $t f32) (local $lo f32) (local $hi f32) (local $m f32) (local $k i32) (local $best f32) (local $who i32) (local $head i32)
  (local $q i32) (local $qx f32) (local $qy f32) (local $qz f32) (local $fx f32) (local $fz f32) (local $fy f32)
  (local $a f32) (local $b f32) (local $cc f32) (local $disc f32) (local $sq f32) (local $t1 f32) (local $t2 f32) (local $ta f32) (local $tb f32)
  ;; the ground: half-metre steps, then bisection
  (local.set $best (local.get $range))
  (local.set $t (f32.const 0.5))
  (block $out
    (loop $march
      (br_if $out (f32.gt (local.get $t) (local.get $range)))
      (call $ground (!madd (local.get $dx) (local.get $t) (local.get $ox)) (!madd (local.get $dz) (local.get $t) (local.get $oz)))
      (drop) (drop) (drop) (drop)
      (if (f32.gt (!madd (local.get $dy) (local.get $t) (local.get $oy)))
        (then
          (local.set $lo (f32.sub (local.get $t) (f32.const 0.5)))
          (local.set $hi (local.get $t))
          (!for $k (i32.const 0) (i32.const 6)
            (local.set $m (f32.mul (f32.add (local.get $lo) (local.get $hi)) (f32.const 0.5)))
            (call $ground (!madd (local.get $dx) (local.get $m) (local.get $ox)) (!madd (local.get $dz) (local.get $m) (local.get $oz)))
            (drop) (drop) (drop) (drop)
            (if (f32.gt (!madd (local.get $dy) (local.get $m) (local.get $oy)))
              (then (local.set $hi (local.get $m)))
              (else (local.set $lo (local.get $m)))))
          (local.set $best (local.get $hi))
          (br $out)))
      (local.set $t (f32.add (local.get $t) (f32.const 0.5)))
      (br $march)))
  ;; the map's boxes: walls, roofs, rock
  (local.set $best (call $box_ray (local.get $ox) (local.get $oy) (local.get $oz) (local.get $dx) (local.get $dy) (local.get $dz) (local.get $best)))
  (local.set $who (i32.const -1))
  (local.set $a (f32.add (f32.mul (local.get $dx) (local.get $dx)) (f32.mul (local.get $dz) (local.get $dz))))
  (!for $q (i32.const 0) (i32.const @NPLAYER)
    (if (i32.and (i32.eq (i32.and (i32.load8_u offset=@(PLAYERS + P_FL) (i32.shl (local.get $q) (i32.const 6))) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE))
                 (i32.ne (local.get $q) (local.get $p)))
      (then
        (call $a_where (local.get $q) (local.get $rt))
        (local.set $qz) (local.set $qy) (local.set $qx)
        (local.set $fx (f32.sub (local.get $ox) (local.get $qx)))
        (local.set $fz (f32.sub (local.get $oz) (local.get $qz)))
        ;; the head
        (local.set $fy (f32.sub (local.get $oy) (f32.add (local.get $qy) (f32.const 1.62))))
        (local.set $b (!dot3 (local.get $fx) (local.get $fy) (local.get $fz) (local.get $dx) (local.get $dy) (local.get $dz)))
        (local.set $cc (f32.sub (!dot3 (local.get $fx) (local.get $fy) (local.get $fz) (local.get $fx) (local.get $fy) (local.get $fz)) (f32.const 0.0484)))
        (local.set $disc (f32.sub (f32.mul (local.get $b) (local.get $b)) (local.get $cc)))
        (if (f32.ge (local.get $disc) (f32.const 0))
          (then
            (local.set $t1 (f32.max (f32.sub (f32.neg (local.get $b)) (f32.sqrt (local.get $disc))) (f32.const 0)))
            (if (i32.and (f32.lt (local.get $t1) (local.get $best)) (f32.gt (f32.add (f32.neg (local.get $b)) (f32.sqrt (local.get $disc))) (f32.const 0)))
              (then (local.set $best (local.get $t1)) (local.set $who (local.get $q)) (local.set $head (i32.const 1))))))
        ;; the body: where the ray is inside the circle, and where it is between the feet and the shoulders
        (if (f32.gt (local.get $a) (f32.const 1e-8))
          (then
            (local.set $b (f32.add (f32.mul (local.get $fx) (local.get $dx)) (f32.mul (local.get $fz) (local.get $dz))))
            (local.set $cc (f32.sub (f32.add (f32.mul (local.get $fx) (local.get $fx)) (f32.mul (local.get $fz) (local.get $fz))) (f32.const 0.2025)))
            (local.set $disc (f32.sub (f32.mul (local.get $b) (local.get $b)) (f32.mul (local.get $a) (local.get $cc))))
            (if (f32.ge (local.get $disc) (f32.const 0))
              (then
                (local.set $sq (f32.sqrt (local.get $disc)))
                (local.set $t1 (f32.div (f32.sub (f32.neg (local.get $b)) (local.get $sq)) (local.get $a)))
                (local.set $t2 (f32.div (f32.add (f32.neg (local.get $b)) (local.get $sq)) (local.get $a)))
                (local.set $ta (f32.const -1e9))
                (local.set $tb (f32.const 1e9))
                (if (f32.ne (local.get $dy) (f32.const 0))
                  (then
                    (local.set $lo (f32.div (f32.sub (local.get $qy) (local.get $oy)) (local.get $dy)))
                    (local.set $hi (f32.div (f32.sub (f32.add (local.get $qy) (f32.const 1.45)) (local.get $oy)) (local.get $dy)))
                    (local.set $ta (f32.min (local.get $lo) (local.get $hi)))
                    (local.set $tb (f32.max (local.get $lo) (local.get $hi))))
                  (else
                    (if (i32.or (f32.lt (local.get $oy) (local.get $qy)) (f32.gt (local.get $oy) (f32.add (local.get $qy) (f32.const 1.45))))
                      (then (local.set $tb (f32.const -1e9))))))
                (local.set $lo (f32.max (f32.max (local.get $t1) (local.get $ta)) (f32.const 0)))
                (local.set $hi (f32.min (local.get $t2) (local.get $tb)))
                (if (i32.and (f32.le (local.get $lo) (local.get $hi)) (f32.lt (local.get $lo) (local.get $best)))
                  (then (local.set $best (local.get $lo)) (local.set $who (local.get $q)) (local.set $head (i32.const 0)))))))))))
  (local.get $who)
  (local.get $best)
  (local.get $head))

;; Pellet k of a hitscan shot: its ray, its tracer, and on the confirmed
;; world its damage. A shotgun's pellets lose damage past 8 m, to a fifth by 28.
(func $a_hitscan (param $p i32) (param $d i32) (param $w i32) (param $in i32) (param $u i32) (param $k i32) (param $shots i32)
  (local $pb i32) (local $s f32) (local $c f32) (local $sp f32) (local $cp f32) (local $dx f32) (local $dy f32) (local $dz f32)
  (local $ex f32) (local $ey f32) (local $ez f32) (local $q i32) (local $t f32) (local $head i32) (local $dmg f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (call $a_aim (local.get $p) (local.get $in) (local.get $u) (local.get $shots) (local.get $k) (!arm spread (local.get $w)))
  (local.set $c) (local.set $s) (local.set $u)
  (call $sincos (local.get $u))
  (local.set $cp) (local.set $sp)
  (local.set $dx (f32.mul (local.get $cp) (local.get $c)))
  (local.set $dy (local.get $sp))
  (local.set $dz (f32.mul (local.get $cp) (local.get $s)))
  (local.set $ex (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (local.set $ey (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (f32.const @P_EYE)))
  (local.set $ez (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (call $a_ray (local.get $p) (local.get $ex) (local.get $ey) (local.get $ez) (local.get $dx) (local.get $dy) (local.get $dz)
               (f32.convert_i32_u (!arm range (local.get $w))) (call $a_seen (local.get $p) (local.get $d)))
  (local.set $head) (local.set $t) (local.set $q)
  (call $fx (local.get $d) (i32.const @FX_TRACER) (local.get $p) (local.get $shots)
            (!madd (local.get $dx) (local.get $t) (local.get $ex)) (!madd (local.get $dy) (local.get $t) (local.get $ey)) (!madd (local.get $dz) (local.get $t) (local.get $ez))
            (f32.convert_i32_u (local.get $w)))
  (if (i32.and (i32.eqz (local.get $d)) (i32.ge_s (local.get $q) (i32.const 0)))
    (then
      (local.set $dmg (f32.convert_i32_u (!arm dmg (local.get $w))))
      (if (i32.eq (local.get $w) (i32.const @W_SHOTGUN))
        (then (local.set $dmg (f32.mul (local.get $dmg) (!clamp (f32.sub (f32.const 1.4) (f32.mul (local.get $t) (f32.const 0.05))) (f32.const 0.2) (f32.const 1))))))
      (call $a_hurt (local.get $q) (local.get $p) (i32.trunc_sat_f32_u (f32.add (local.get $dmg) (f32.const 0.5)))
                    (select (!arm head (local.get $w)) (i32.const 0) (local.get $head)) (local.get $w)
                    (!madd (local.get $dx) (local.get $t) (local.get $ex)) (!madd (local.get $dy) (local.get $t) (local.get $ey)) (!madd (local.get $dz) (local.get $t) (local.get $ez))))))

;; Damage to slot q from slot a (the confirmed world only). Shields take it
;; first; `head` 2 kills outright, 1 kills once the shields are through.
(func $a_hurt (param $q i32) (param $a i32) (param $dmg i32) (param $head i32) (param $cause i32) (param $x f32) (param $y f32) (param $z f32)
  (local $qb i32) (local $sh i32) (local $hp i32) (local $over i32)
  (local.set $qb (i32.shl (local.get $q) (i32.const 6)))
  (if (i32.ne (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $qb)) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE)) (then (return)))
  (if (i32.ne (i32.load (i32.const @HDR_STATE)) (i32.const @H_PLAY)) (then (return)))
  (if (call $a_ally (local.get $q) (local.get $a)) (then (return)))
  (!put u16 @(PLAYERS + A_SHT) (local.get $qb) (i32.const @SHIELD_DELAY))
  (!put u8 @(PLAYERS + A_HITBY) (local.get $qb) (local.get $a))
  (local.set $sh (!at u8 @(PLAYERS + A_SH) (local.get $qb)))
  (local.set $hp (!at u8 @(PLAYERS + A_HP) (local.get $qb)))
  (if (i32.eq (local.get $head) (i32.const 2))
    (then
      (call $fx (i32.const 0) (i32.const @FX_HIT) (local.get $a) (local.get $q) (local.get $x) (local.get $y) (local.get $z) (f32.const 3))
      (call $a_kill (local.get $q) (local.get $a) (local.get $cause))
      (return)))
  (if (i32.le_u (local.get $dmg) (local.get $sh))
    (then
      (!put u8 @(PLAYERS + A_SH) (local.get $qb) (i32.sub (local.get $sh) (local.get $dmg)))
      (call $fx (i32.const 0) (i32.const @FX_HIT) (local.get $a) (local.get $q) (local.get $x) (local.get $y) (local.get $z) (f32.const 1))
      (return)))
  (local.set $over (i32.sub (local.get $dmg) (local.get $sh)))
  (!put u8 @(PLAYERS + A_SH) (local.get $qb) (i32.const 0))
  (call $fx (i32.const 0) (i32.const @FX_HIT) (local.get $a) (local.get $q) (local.get $x) (local.get $y) (local.get $z)
            (select (f32.const 3) (f32.const 2) (local.get $head)))
  (if (i32.or (local.get $head) (i32.ge_s (local.get $over) (local.get $hp)))
    (then (call $a_kill (local.get $q) (local.get $a) (local.get $cause)) (return)))
  (!put u8 @(PLAYERS + A_HP) (local.get $qb) (i32.sub (local.get $hp) (local.get $over))))

;; Slot q dies at a's hand (or its own): a kill for a and a grenade back
;; (none for a zombie or the juggernaut), a death for q, three seconds to
;; respawn; and whatever the match's mode makes of it.
(func $a_kill (param $q i32) (param $a i32) (param $cause i32)
  (local $qb i32) (local $ab i32)
  (local.set $qb (i32.shl (local.get $q) (i32.const 6)))
  (!put u8 @(PLAYERS + P_FL) (local.get $qb) (i32.or (!at u8 @(PLAYERS + P_FL) (local.get $qb)) (i32.const @PF_DEAD)))
  (!put u16 @(PLAYERS + A_RESPAWN) (local.get $qb) (i32.const @RESPAWN_TICKS))
  (!put u16 @(PLAYERS + A_DEATHS) (local.get $qb) (i32.add (!at u16 @(PLAYERS + A_DEATHS) (local.get $qb)) (i32.const 1)))
  (!put u8 @(PLAYERS + A_HP) (local.get $qb) (i32.const 0))
  (!put u8 @(PLAYERS + A_SH) (local.get $qb) (i32.const 0))
  (!put u8 @(PLAYERS + A_NEEDLES) (local.get $qb) (i32.const 0))
  (!put u8 @(PLAYERS + A_RELOAD) (local.get $qb) (i32.const 0))
  (!put u8 @(PLAYERS + A_BURST) (local.get $qb) (i32.const 0))
  (!put f32 @(PLAYERS + P_VX) (local.get $qb) (f32.const 0))
  (!put f32 @(PLAYERS + P_VZ) (local.get $qb) (f32.const 0))
  (call $fx (i32.const 0) (i32.const @FX_KILL) (local.get $a) (local.get $q)
            (!at f32 @(PLAYERS + P_PX) (local.get $qb)) (!at f32 @(PLAYERS + P_PY) (local.get $qb)) (!at f32 @(PLAYERS + P_PZ) (local.get $qb))
            (f32.convert_i32_u (local.get $cause)))
  (if (i32.load (i32.const @AH_MODE)) (then (call $a_mode_kill (local.get $q) (local.get $a) (local.get $cause))))
  (if (i32.eq (local.get $a) (local.get $q))
    (then
      (if (!at u16 @(PLAYERS + A_KILLS) (local.get $qb))
        (then (!put u16 @(PLAYERS + A_KILLS) (local.get $qb) (i32.sub (!at u16 @(PLAYERS + A_KILLS) (local.get $qb)) (i32.const 1)))))
      (return)))
  (local.set $ab (i32.shl (local.get $a) (i32.const 6)))
  (!put u16 @(PLAYERS + A_KILLS) (local.get $ab) (i32.add (!at u16 @(PLAYERS + A_KILLS) (local.get $ab)) (i32.const 1)))
  (if (i32.and (i32.lt_u (!at u8 @(PLAYERS + A_GRENS) (local.get $ab)) (i32.const 4))
               (i32.eqz (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $ab)) (i32.const @(PF_ZOMBIE | PF_JUGG)))))
    (then (!put u8 @(PLAYERS + A_GRENS) (local.get $ab) (i32.add (!at u8 @(PLAYERS + A_GRENS) (local.get $ab)) (i32.const 1))))))

;; The nearest live enemy of p within `reach` metres, inside a cone of the
;; given cosine about its facing (s, c), where p saw them; and how far.
(func $a_reach (param $p i32) (param $d i32) (param $s f32) (param $c f32) (param $reach f32) (param $cone f32) (result i32 f32)
  (local $pb i32) (local $q i32) (local $rt i32) (local $px f32) (local $py f32) (local $pz f32)
  (local $qx f32) (local $qy f32) (local $qz f32) (local $dx f32) (local $dz f32) (local $dist f32) (local $best f32) (local $who i32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (local.set $px (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (local.set $py (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
  (local.set $pz (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (local.set $rt (call $a_seen (local.get $p) (local.get $d)))
  (local.set $best (local.get $reach))
  (local.set $who (i32.const -1))
  (!for $q (i32.const 0) (i32.const @NPLAYER)
    (if (i32.and (i32.and (i32.eq (i32.and (i32.load8_u offset=@(PLAYERS + P_FL) (i32.shl (local.get $q) (i32.const 6))) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE))
                          (i32.ne (local.get $q) (local.get $p)))
                 (i32.eqz (call $a_ally (local.get $p) (local.get $q))))
      (then
        (call $a_where (local.get $q) (local.get $rt))
        (local.set $qz) (local.set $qy) (local.set $qx)
        (local.set $dx (f32.sub (local.get $qx) (local.get $px)))
        (local.set $dz (f32.sub (local.get $qz) (local.get $pz)))
        (local.set $dist (f32.sqrt (f32.add (f32.mul (local.get $dx) (local.get $dx)) (f32.mul (local.get $dz) (local.get $dz)))))
        (if (i32.and (i32.and (f32.lt (local.get $dist) (local.get $best)) (f32.lt (f32.abs (f32.sub (local.get $qy) (local.get $py))) (f32.const 2)))
                     (f32.ge (f32.add (f32.mul (local.get $dx) (local.get $c)) (f32.mul (local.get $dz) (local.get $s)))
                             (f32.mul (local.get $cone) (f32.max (local.get $dist) (f32.const 0.01)))))
          (then
            ;; not through a wall
            (if (call $clear (local.get $px) (f32.add (local.get $py) (f32.const 1.2)) (local.get $pz) (local.get $qx) (f32.add (local.get $qy) (f32.const 1.2)) (local.get $qz))
              (then (local.set $best (local.get $dist)) (local.set $who (local.get $q)))))))))
  (local.get $who)
  (local.get $best))

;; A melee: a rifle butt reaches 2.4 m, a sword 5 m and kills. Either lunges
;; at what it reaches (on both banks, so your own lunge is predicted); a butt
;; to the back kills.
(func $a_melee (param $p i32) (param $d i32) (param $s f32) (param $c f32) (param $sword i32)
  (local $pb i32) (local $q i32) (local $dist f32) (local $qb i32) (local $dx f32) (local $dz f32) (local $lunge f32)
  (local $qs f32) (local $qc f32) (local $x f32) (local $y f32) (local $z f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (call $a_reach (local.get $p) (local.get $d) (local.get $s) (local.get $c)
                 (select (f32.const 5) (f32.const 2.4) (local.get $sword)) (select (f32.const 0.9) (f32.const 0.77) (local.get $sword)))
  (local.set $dist) (local.set $q)
  (local.set $x (!madd (local.get $c) (f32.const 1.2) (!at f32 @(PLAYERS + P_PX) (local.get $pb))))
  (local.set $y (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (f32.const 1.2)))
  (local.set $z (!madd (local.get $s) (f32.const 1.2) (!at f32 @(PLAYERS + P_PZ) (local.get $pb))))
  (call $fx (local.get $d) (i32.const @FX_MELEE) (local.get $p) (!at u16 @(PLAYERS + P_SHOTS) (local.get $pb)) (local.get $x) (local.get $y) (local.get $z)
            (f32.convert_i32_u (local.get $sword)))
  (if (i32.lt_s (local.get $q) (i32.const 0)) (then (return)))
  (local.set $lunge (select (f32.const 14) (f32.const 5) (local.get $sword)))
  (!put f32 @(PLAYERS + P_VX) (local.get $pb) (!madd (local.get $c) (local.get $lunge) (!at f32 @(PLAYERS + P_VX) (local.get $pb))))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (!madd (local.get $s) (local.get $lunge) (!at f32 @(PLAYERS + P_VZ) (local.get $pb))))
  (if (local.get $d) (then (return)))
  (local.set $qb (i32.shl (local.get $q) (i32.const 6)))
  (local.set $x (!at f32 @(PLAYERS + P_PX) (local.get $qb)))
  (local.set $y (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $qb)) (f32.const 1.2)))
  (local.set $z (!at f32 @(PLAYERS + P_PZ) (local.get $qb)))
  (if (local.get $sword)
    (then (call $a_hurt (local.get $q) (local.get $p) (i32.const 255) (i32.const 2) (i32.const @W_SWORD) (local.get $x) (local.get $y) (local.get $z)) (return)))
  ;; from behind: they face away from you, within 60 degrees
  (call $sincos (i32.shl (i32.and (!at i32 @(PLAYERS + P_IN) (local.get $qb)) (i32.const 0x7ff)) (i32.const 3)))
  (local.set $qc) (local.set $qs)
  (local.set $dx (f32.sub (local.get $x) (!at f32 @(PLAYERS + P_PX) (local.get $pb))))
  (local.set $dz (f32.sub (local.get $z) (!at f32 @(PLAYERS + P_PZ) (local.get $pb))))
  (if (f32.gt (f32.add (f32.mul (local.get $dx) (local.get $qc)) (f32.mul (local.get $dz) (local.get $qs))) (f32.mul (f32.const 0.5) (f32.max (local.get $dist) (f32.const 0.01))))
    (then (call $a_hurt (local.get $q) (local.get $p) (i32.const 255) (i32.const 2) (i32.const @KILL_BEHIND) (local.get $x) (local.get $y) (local.get $z)) (return)))
  (call $a_hurt (local.get $q) (local.get $p) (i32.const @MELEE_DMG) (i32.const 0) (i32.const @KILL_MELEE) (local.get $x) (local.get $y) (local.get $z)))

;; A projectile of `kind` from the eye of slot p along pitch u (yaw units) and
;; the yaw's (s, c), at `speed` plus `up` m/s upward. A needle homes on the
;; enemy nearest its line within 12 degrees and 60 m, if any.
(func $a_launch (param $p i32) (param $d i32) (param $kind i32) (param $s f32) (param $c f32) (param $u i32) (param $speed f32) (param $up f32) (param $seek i32)
  (local $pb i32) (local $j i32) (local $jb i32) (local $sp f32) (local $cp f32) (local $fx f32) (local $fy f32) (local $fz f32)
  (local $ex f32) (local $ey f32) (local $ez f32) (local $q i32) (local $rt i32) (local $qx f32) (local $qy f32) (local $qz f32)
  (local $dx f32) (local $dy f32) (local $dz f32) (local $dist f32) (local $best f32) (local $who i32) (local $cos f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (local.set $j (i32.const 0))
  (block $found
    (loop $find
      (br_if $found (i32.eqz (!at u8 @(PROJ + J_KIND) (i32.add (i32.shl (local.get $j) (i32.const 5)) (local.get $d)))))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br_if $find (i32.lt_u (local.get $j) (i32.const @NPROJ)))
      (return)))
  (local.set $jb (i32.add (i32.shl (local.get $j) (i32.const 5)) (local.get $d)))
  (call $sincos (local.get $u))
  (local.set $cp) (local.set $sp)
  (local.set $fx (f32.mul (local.get $cp) (local.get $c)))
  (local.set $fy (local.get $sp))
  (local.set $fz (f32.mul (local.get $cp) (local.get $s)))
  (local.set $ex (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (local.set $ey (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (f32.const @P_EYE)))
  (local.set $ez (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (!put f32 @(PROJ + J_PX) (local.get $jb) (!madd (local.get $fx) (f32.const 0.5) (local.get $ex)))
  (!put f32 @(PROJ + J_PY) (local.get $jb) (!madd (local.get $fy) (f32.const 0.5) (local.get $ey)))
  (!put f32 @(PROJ + J_PZ) (local.get $jb) (!madd (local.get $fz) (f32.const 0.5) (local.get $ez)))
  (!put f32 @(PROJ + J_VX) (local.get $jb) (f32.mul (local.get $fx) (local.get $speed)))
  (!put f32 @(PROJ + J_VY) (local.get $jb) (!madd (local.get $fy) (local.get $speed) (local.get $up)))
  (!put f32 @(PROJ + J_VZ) (local.get $jb) (f32.mul (local.get $fz) (local.get $speed)))
  (!put u16 @(PROJ + J_AGE) (local.get $jb) (i32.const 0))
  (!put u8 @(PROJ + J_KIND) (local.get $jb) (local.get $kind))
  (!put u8 @(PROJ + J_TGT) (local.get $jb) (i32.const 0))
  (!put u8 @(PROJ + J_OWNER) (local.get $jb) (local.get $p))
  (!put u8 @(PROJ + J_HOME) (local.get $jb) (i32.const 0))
  (!put u16 @(PROJ + J_SHOT) (local.get $jb) (!at u16 @(PLAYERS + P_SHOTS) (local.get $pb)))
  (if (i32.eqz (local.get $seek)) (then (return)))
  (local.set $rt (call $a_seen (local.get $p) (local.get $d)))
  (local.set $who (i32.const -1))
  (local.set $best (f32.const 0.978)) ;; cos 12 degrees
  (!for $q (i32.const 0) (i32.const @NPLAYER)
    (if (i32.and (i32.and (i32.eq (i32.and (i32.load8_u offset=@(PLAYERS + P_FL) (i32.shl (local.get $q) (i32.const 6))) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE))
                          (i32.ne (local.get $q) (local.get $p)))
                 (i32.eqz (call $a_ally (local.get $p) (local.get $q))))
      (then
        (call $a_where (local.get $q) (local.get $rt))
        (local.set $qz) (local.set $qy) (local.set $qx)
        (local.set $dx (f32.sub (local.get $qx) (local.get $ex)))
        (local.set $dy (f32.sub (f32.add (local.get $qy) (f32.const 1)) (local.get $ey)))
        (local.set $dz (f32.sub (local.get $qz) (local.get $ez)))
        (local.set $dist (f32.sqrt (f32.max (!dot3 (local.get $dx) (local.get $dy) (local.get $dz) (local.get $dx) (local.get $dy) (local.get $dz)) (f32.const 1e-6))))
        (local.set $cos (f32.div (!dot3 (local.get $dx) (local.get $dy) (local.get $dz) (local.get $fx) (local.get $fy) (local.get $fz)) (local.get $dist)))
        (if (i32.and (f32.gt (local.get $cos) (local.get $best)) (f32.lt (local.get $dist) (f32.const 60)))
          (then (local.set $best (local.get $cos)) (local.set $who (local.get $q)))))))
  (if (i32.ge_s (local.get $who) (i32.const 0))
    (then
      (!put u8 @(PROJ + J_TGT) (local.get $jb) (local.get $who))
      (!put u8 @(PROJ + J_HOME) (local.get $jb) (i32.const 1)))))

;; Splash on every live fighter, centred on the middle of the body: the
;; whole of it within 35% of r, falling linearly to nothing at r (half to
;; its owner).
(func $a_splash (param $x f32) (param $y f32) (param $z f32) (param $dmg f32) (param $r f32) (param $owner i32) (param $cause i32)
  (local $q i32) (local $qb i32) (local $dx f32) (local $dy f32) (local $dz f32) (local $dist f32) (local $f f32)
  (!for $q (i32.const 0) (i32.const @NPLAYER)
    (local.set $qb (i32.shl (local.get $q) (i32.const 6)))
    (if (i32.eq (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $qb)) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE))
      (then
        (local.set $dx (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $qb)) (local.get $x)))
        (local.set $dy (f32.sub (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $qb)) (f32.const 0.9)) (local.get $y)))
        (local.set $dz (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $qb)) (local.get $z)))
        (local.set $dist (f32.sqrt (!dot3 (local.get $dx) (local.get $dy) (local.get $dz) (local.get $dx) (local.get $dy) (local.get $dz))))
        ;; a wall between the blast and the body takes it all
        (if (i32.and (f32.lt (local.get $dist) (local.get $r))
                     (call $clear (local.get $x) (local.get $y) (local.get $z)
                                  (!at f32 @(PLAYERS + P_PX) (local.get $qb)) (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $qb)) (f32.const 0.9)) (!at f32 @(PLAYERS + P_PZ) (local.get $qb))))
          (then
            ;; full within the inner 35%, falling to nothing at the edge
            (local.set $f (f32.mul (local.get $dmg) (!clamp (f32.div (f32.sub (local.get $r) (local.get $dist)) (f32.mul (local.get $r) (f32.const 0.65))) (f32.const 0) (f32.const 1))))
            (if (i32.eq (local.get $q) (local.get $owner)) (then (local.set $f (f32.mul (local.get $f) (f32.const 0.5)))))
            (if (f32.ge (local.get $f) (f32.const 1))
              (then (call $a_hurt (local.get $q) (local.get $owner) (i32.trunc_sat_f32_u (local.get $f)) (i32.const 0) (local.get $cause)
                                  (!at f32 @(PLAYERS + P_PX) (local.get $qb)) (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $qb)) (f32.const 1)) (!at f32 @(PLAYERS + P_PZ) (local.get $qb)))))))))))

;; A plasma bolt or a needle, in two half steps a tick like a rocket. A needle
;; turns toward its target's chest, keeping its speed. Either is spent on the
;; ground, a box or a body: a bolt burns, a needle sticks; seven in one fighter at
;; once go off together.
(func $a_bolt (param $jb i32) (param $d i32)
  (local $px f32) (local $py f32) (local $pz f32) (local $vx f32) (local $vy f32) (local $vz f32) (local $h f32) (local $k i32)
  (local $q i32) (local $qb i32) (local $tx f32) (local $ty f32) (local $tz f32) (local $sp f32) (local $len f32) (local $owner i32) (local $needle i32)
  (local.set $px (!at f32 @(PROJ + J_PX) (local.get $jb)))
  (local.set $py (!at f32 @(PROJ + J_PY) (local.get $jb)))
  (local.set $pz (!at f32 @(PROJ + J_PZ) (local.get $jb)))
  (local.set $vx (!at f32 @(PROJ + J_VX) (local.get $jb)))
  (local.set $vy (!at f32 @(PROJ + J_VY) (local.get $jb)))
  (local.set $vz (!at f32 @(PROJ + J_VZ) (local.get $jb)))
  (local.set $owner (!at u8 @(PROJ + J_OWNER) (local.get $jb)))
  (local.set $needle (i32.eq (!at u8 @(PROJ + J_KIND) (local.get $jb)) (i32.const @K_NEEDLE)))
  (if (i32.and (local.get $needle) (i32.ne (!at u8 @(PROJ + J_HOME) (local.get $jb)) (i32.const 0)))
    (then
      (local.set $qb (i32.shl (!at u8 @(PROJ + J_TGT) (local.get $jb)) (i32.const 6)))
      (if (i32.eq (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $qb)) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE))
        (then
          (local.set $sp (f32.const @(ARMS[W_NEEDLER].speed)))
          (local.set $tx (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $qb)) (local.get $px)))
          (local.set $ty (f32.sub (f32.add (!at f32 @(PLAYERS + P_PY) (local.get $qb)) (f32.const 1)) (local.get $py)))
          (local.set $tz (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $qb)) (local.get $pz)))
          (local.set $len (f32.div (local.get $sp) (f32.sqrt (f32.max (!dot3 (local.get $tx) (local.get $ty) (local.get $tz) (local.get $tx) (local.get $ty) (local.get $tz)) (f32.const 1e-6)))))
          (local.set $vx (!madd (f32.sub (f32.mul (local.get $tx) (local.get $len)) (local.get $vx)) (f32.const 0.07) (local.get $vx)))
          (local.set $vy (!madd (f32.sub (f32.mul (local.get $ty) (local.get $len)) (local.get $vy)) (f32.const 0.07) (local.get $vy)))
          (local.set $vz (!madd (f32.sub (f32.mul (local.get $tz) (local.get $len)) (local.get $vz)) (f32.const 0.07) (local.get $vz)))
          (local.set $len (f32.div (local.get $sp) (f32.sqrt (f32.max (!dot3 (local.get $vx) (local.get $vy) (local.get $vz) (local.get $vx) (local.get $vy) (local.get $vz)) (f32.const 1e-6)))))
          (local.set $vx (f32.mul (local.get $vx) (local.get $len)))
          (local.set $vy (f32.mul (local.get $vy) (local.get $len)))
          (local.set $vz (f32.mul (local.get $vz) (local.get $len))))
        (else (!put u8 @(PROJ + J_HOME) (local.get $jb) (i32.const 0))))))
  (!for $k (i32.const 0) (i32.const 2)
    (if (call $box_in (!madd (local.get $vx) (f32.const 0.004) (local.get $px)) (!madd (local.get $vy) (f32.const 0.004) (local.get $py))
                      (!madd (local.get $vz) (f32.const 0.004) (local.get $pz)) (f32.const 0))
      (then
        (call $fx (local.get $d) (i32.const @FX_BLAST) (local.get $owner) (!at u16 @(PROJ + J_SHOT) (local.get $jb)) (local.get $px) (local.get $py) (local.get $pz) (f32.const 0.4))
        (memory.fill (i32.add (i32.const @PROJ) (local.get $jb)) (i32.const 0) (i32.const @JSIZE))
        (return)))
    (local.set $px (!madd (local.get $vx) (f32.const 0.004) (local.get $px)))
    (local.set $py (!madd (local.get $vy) (f32.const 0.004) (local.get $py)))
    (local.set $pz (!madd (local.get $vz) (f32.const 0.004) (local.get $pz)))
    (if (i32.or (i32.or (f32.lt (local.get $px) (f32.const 0)) (f32.gt (local.get $px) (f32.const @WORLD)))
                (i32.or (i32.or (f32.lt (local.get $pz) (f32.const 0)) (f32.gt (local.get $pz) (f32.const @WORLD)))
                        (f32.gt (local.get $py) (f32.const @CEIL))))
      (then (memory.fill (i32.add (i32.const @PROJ) (local.get $jb)) (i32.const 0) (i32.const @JSIZE)) (return)))
    (call $ground (local.get $px) (local.get $pz))
    (drop) (drop) (drop) (drop)
    (local.set $h)
    (if (f32.le (local.get $py) (local.get $h))
      (then
        (call $fx (local.get $d) (i32.const @FX_BLAST) (local.get $owner) (!at u16 @(PROJ + J_SHOT) (local.get $jb)) (local.get $px) (local.get $h) (local.get $pz) (f32.const 0.4))
        (memory.fill (i32.add (i32.const @PROJ) (local.get $jb)) (i32.const 0) (i32.const @JSIZE))
        (return)))
    (local.set $q (call $hit_player (local.get $px) (local.get $py) (local.get $pz) (f32.const 0.15) (local.get $owner)))
    (if (i32.ge_s (local.get $q) (i32.const 0))
      (then
        (if (i32.eqz (local.get $d))
          (then
            (if (local.get $needle)
              (then (call $a_stick (local.get $q) (local.get $owner) (local.get $px) (local.get $py) (local.get $pz)))
              (else (call $a_hurt (local.get $q) (local.get $owner) (i32.const @(ARMS[W_PLASMA].dmg)) (i32.const 0) (i32.const @W_PLASMA)
                              (local.get $px) (local.get $py) (local.get $pz))))))
        (memory.fill (i32.add (i32.const @PROJ) (local.get $jb)) (i32.const 0) (i32.const @JSIZE))
        (return))))
  (!put f32 @(PROJ + J_PX) (local.get $jb) (local.get $px))
  (!put f32 @(PROJ + J_PY) (local.get $jb) (local.get $py))
  (!put f32 @(PROJ + J_PZ) (local.get $jb) (local.get $pz))
  (!put f32 @(PROJ + J_VX) (local.get $jb) (local.get $vx))
  (!put f32 @(PROJ + J_VY) (local.get $jb) (local.get $vy))
  (!put f32 @(PROJ + J_VZ) (local.get $jb) (local.get $vz))
  (if (i32.gt_u (!at u16 @(PROJ + J_AGE) (local.get $jb)) (select (i32.const 300) (i32.const 250) (local.get $needle)))
    (then (memory.fill (i32.add (i32.const @PROJ) (local.get $jb)) (i32.const 0) (i32.const @JSIZE)))))

(func $a_stick (param $q i32) (param $a i32) (param $x f32) (param $y f32) (param $z f32)
  (local $qb i32) (local $n i32)
  (local.set $qb (i32.shl (local.get $q) (i32.const 6)))
  ;; a needle from your own side doesn't stick
  (if (call $a_ally (local.get $q) (local.get $a)) (then (return)))
  (call $a_hurt (local.get $q) (local.get $a) (i32.const @(ARMS[W_NEEDLER].dmg)) (i32.const 0) (i32.const @W_NEEDLER) (local.get $x) (local.get $y) (local.get $z))
  (if (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $qb)) (i32.const @PF_DEAD)) (then (return)))
  (local.set $n (i32.add (!at u8 @(PLAYERS + A_NEEDLES) (local.get $qb)) (i32.const 1)))
  (!put u8 @(PLAYERS + A_NEEDLER) (local.get $qb) (local.get $a))
  (!put u8 @(PLAYERS + A_NEEDT) (local.get $qb) (i32.const @NEEDLE_TICKS))
  (if (i32.lt_u (local.get $n) (i32.const @SUPERCOMBINE))
    (then (!put u8 @(PLAYERS + A_NEEDLES) (local.get $qb) (local.get $n)) (return)))
  (!put u8 @(PLAYERS + A_NEEDLES) (local.get $qb) (i32.const 0))
  (call $fx (i32.const 0) (i32.const @FX_BLAST) (local.get $a) (i32.const 0) (local.get $x) (local.get $y) (local.get $z) (f32.const 2.5))
  (call $a_hurt (local.get $q) (local.get $a) (i32.const @SUPER_DMG) (i32.const 2) (i32.const @KILL_SUPER) (local.get $x) (local.get $y) (local.get $z)))

;; Walking over a pad: ammo for a gun you carry, or with a use, its gun in
;; place of the one in your hands. A pad comes back 30 s after (60 s for the
;; sniper, the rocket and the sword).
(func $a_pickup (param $p i32)
  (local $pb i32) (local $k i32) (local $a i32) (local $w i32) (local $slot i32) (local $have i32) (local $dx f32) (local $dz f32) (local $took i32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (!for $k (i32.const 0) (i32.const @NPAD)
    (local.set $a (i32.add (i32.const @PAD) (i32.shl (local.get $k) (i32.const 4))))
    (local.set $w (i32.load8_u offset=12 (local.get $a)))
    (local.set $dx (f32.sub (!at f32 @(PLAYERS + P_PX) (local.get $pb)) (f32.load (local.get $a))))
    (local.set $dz (f32.sub (!at f32 @(PLAYERS + P_PZ) (local.get $pb)) (f32.load offset=8 (local.get $a))))
    (if (i32.and (i32.and (i32.ne (local.get $w) (i32.const 0)) (i32.eqz (i32.load16_u offset=14 (local.get $a))))
                 (i32.and (f32.lt (f32.add (f32.mul (local.get $dx) (local.get $dx)) (f32.mul (local.get $dz) (local.get $dz))) (f32.const 2.25))
                          (f32.lt (f32.abs (f32.sub (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (f32.load offset=4 (local.get $a)))) (f32.const 2))))
      (then
        (local.set $took (i32.const 0))
        (local.set $have (i32.const -1))
        (if (i32.eq (!at u8 @(PLAYERS + A_GUN + 1) (local.get $pb)) (local.get $w)) (then (local.set $have (i32.const 1))))
        (if (i32.eq (!at u8 @(PLAYERS + A_GUN) (local.get $pb)) (local.get $w)) (then (local.set $have (i32.const 0))))
        (if (i32.ge_s (local.get $have) (i32.const 0))
          (then
            ;; ammo, if short of it
            (if (i32.lt_u (i32.load16_u offset=@(PLAYERS + A_RES) (i32.add (local.get $pb) (i32.shl (local.get $have) (i32.const 1)))) (!arm res (local.get $w)))
              (then
                (i32.store16 offset=@(PLAYERS + A_RES) (i32.add (local.get $pb) (i32.shl (local.get $have) (i32.const 1))) (!arm res (local.get $w)))
                (local.set $took (i32.const 1)))))
          (else
            (if (i32.and (!at u8 @(PLAYERS + A_ACT) (local.get $pb)) (i32.const @AB_USE))
              (then
                (local.set $slot (i32.and (i32.shr_u (!at u8 @(PLAYERS + A_ACT) (local.get $pb)) (i32.const 2)) (i32.const 1)))
                (i32.store8 offset=@(PLAYERS + A_GUN) (i32.add (local.get $pb) (local.get $slot)) (local.get $w))
                (i32.store8 offset=@(PLAYERS + A_MAG) (i32.add (local.get $pb) (local.get $slot)) (!arm mag (local.get $w)))
                (i32.store16 offset=@(PLAYERS + A_RES) (i32.add (local.get $pb) (i32.shl (local.get $slot) (i32.const 1))) (!arm res (local.get $w)))
                (!put u8 @(PLAYERS + A_RELOAD) (local.get $pb) (i32.const 0))
                (!put u8 @(PLAYERS + A_BURST) (local.get $pb) (i32.const 0))
                (!put u16 @(PLAYERS + P_REFIRE) (local.get $pb) (i32.const @SWAP_TICKS))
                (local.set $took (i32.const 1))))))
        (if (local.get $took)
          (then
            (i32.store16 offset=14 (local.get $a)
              (select (i32.const 7500) (i32.const 3750)
                      (i32.or (i32.or (i32.eq (local.get $w) (i32.const @W_SNIPER)) (i32.eq (local.get $w) (i32.const @W_ROCKET)))
                              (i32.eq (local.get $w) (i32.const @W_SWORD)))))
            (call $fx (i32.const 0) (i32.const @FX_PICKUP) (local.get $p) (local.get $w)
                      (f32.load (local.get $a)) (f32.load offset=4 (local.get $a)) (f32.load offset=8 (local.get $a)) (f32.convert_i32_u (local.get $w)))))))))

;; The match, at the end of every tick: where everyone stood (for the
;; shots of the next 31 ticks), respawns, shields and health coming back,
;; needles falling out, pickups, and the clock: a countdown, play until the
;; time is up (or in slayer someone has FRAG_LIMIT kills, or the mode says
;; so), the scoreboard, again.
(func $arena
  (local $p i32) (local $pb i32) (local $fl i32) (local $live i32) (local $best i32) (local $t i32) (local $state i32)
  (local $h i32) (local $n i32) (local $k i32) (local $a i32) (local $mode i32) (local $over i32)
  (local.set $t (i32.load (i32.const @HDR_TICK)))
  (local.set $state (i32.load (i32.const @HDR_STATE)))
  (local.set $h (i32.add (i32.const @HIST) (i32.mul (i32.and (local.get $t) (i32.const 31)) (i32.const @HIST_TICK))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
    (f32.store (i32.add (local.get $h) (i32.shl (local.get $p) (i32.const 4))) (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
    (f32.store offset=4 (i32.add (local.get $h) (i32.shl (local.get $p) (i32.const 4))) (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
    (f32.store offset=8 (i32.add (local.get $h) (i32.shl (local.get $p) (i32.const 4))) (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
    (if (i32.and (local.get $fl) (i32.const @PF_LIVE))
      (then
        (!inc $live)
        (if (i32.gt_u (!at u16 @(PLAYERS + A_KILLS) (local.get $pb)) (local.get $best)) (then (local.set $best (!at u16 @(PLAYERS + A_KILLS) (local.get $pb)))))
        (if (i32.and (local.get $fl) (i32.const @PF_DEAD))
          (then
            (local.set $n (!at u16 @(PLAYERS + A_RESPAWN) (local.get $pb)))
            (if (i32.gt_u (local.get $n) (i32.const 1))
              (then (!put u16 @(PLAYERS + A_RESPAWN) (local.get $pb) (i32.sub (local.get $n) (i32.const 1))))
              (else (call $a_spawn (local.get $p)))))
          (else
            (local.set $n (!at u16 @(PLAYERS + A_SHT) (local.get $pb)))
            (if (local.get $n)
              (then (!put u16 @(PLAYERS + A_SHT) (local.get $pb) (i32.sub (local.get $n) (i32.const 1))))
              (else
                (if (i32.and (i32.lt_u (!at u8 @(PLAYERS + A_SH) (local.get $pb)) (i32.const 100))
                             (i32.eqz (i32.and (local.get $fl) (i32.const @PF_ZOMBIE))))
                  (then
                    (if (i32.eqz (i32.and (local.get $t) (i32.const 1)))
                      (then (!put u8 @(PLAYERS + A_SH) (local.get $pb) (i32.add (!at u8 @(PLAYERS + A_SH) (local.get $pb)) (i32.const 1))))))
                  (else
                    (if (i32.and (i32.lt_u (!at u8 @(PLAYERS + A_HP) (local.get $pb)) (i32.const 100)) (i32.eqz (i32.and (local.get $t) (i32.const 3))))
                      (then (!put u8 @(PLAYERS + A_HP) (local.get $pb) (i32.add (!at u8 @(PLAYERS + A_HP) (local.get $pb)) (i32.const 1)))))))))
            (local.set $n (!at u8 @(PLAYERS + A_NEEDT) (local.get $pb)))
            (if (local.get $n)
              (then
                (!put u8 @(PLAYERS + A_NEEDT) (local.get $pb) (i32.sub (local.get $n) (i32.const 1)))
                (if (i32.eq (local.get $n) (i32.const 1)) (then (!put u8 @(PLAYERS + A_NEEDLES) (local.get $pb) (i32.const 0))))))
            (if (i32.eqz (i32.and (i32.shl (i32.const 1) (i32.load (i32.const @AH_MODE))) (i32.const @((1 << M_INFECTION) | (1 << M_GUNGAME)))))
              (then (call $a_pickup (local.get $p))))))
        (!put u8 @(PLAYERS + A_ACT) (local.get $pb) (i32.and (!at u8 @(PLAYERS + A_ACT) (local.get $pb)) (i32.const @(255 ^ AB_USE)))))))
  (!for $k (i32.const 0) (i32.const @NPAD)
    (local.set $a (i32.add (i32.const @PAD) (i32.shl (local.get $k) (i32.const 4))))
    (if (i32.load16_u offset=14 (local.get $a))
      (then (i32.store16 offset=14 (local.get $a) (i32.sub (i32.load16_u offset=14 (local.get $a)) (i32.const 1))))))
  (i32.store (i32.const @HDR_LIVE) (local.get $live))
  (if (i32.eqz (local.get $live))
    (then (i32.store (i32.const @HDR_STATE) (i32.const @H_IDLE)) (return)))
  (if (i32.eq (local.get $state) (i32.const @H_COUNT))
    (then
      (if (i32.ge_u (local.get $t) (i32.load (i32.const @HDR_UNTIL)))
        (then
          (local.set $mode (i32.load (i32.const @AH_MODE)))
          (i32.store (i32.const @HDR_STATE) (i32.const @H_PLAY))
          (i32.store (i32.const @HDR_START) (local.get $t))
          (i32.store (i32.const @HDR_UNTIL) (i32.add (local.get $t) (!tab MODE_TICKS (local.get $mode))))
          ;; Infection's zombies, one for every ten (at least one); the juggernaut
          (if (i32.eq (local.get $mode) (i32.const @M_INFECTION))
            (then (call $a_draw (select (i32.div_u (local.get $live) (i32.const 10)) (i32.const 1) (i32.ge_u (local.get $live) (i32.const 20))))))
          (if (i32.eq (local.get $mode) (i32.const @M_JUGGERNAUT)) (then (call $a_draw (i32.const 1))))))
      (return)))
  (if (i32.eq (local.get $state) (i32.const @H_PLAY))
    (then
      (local.set $mode (i32.load (i32.const @AH_MODE)))
      (local.set $over (i32.ge_u (local.get $t) (i32.load (i32.const @HDR_UNTIL))))
#if !FIESTA
      (if (i32.eqz (local.get $mode)) (then (local.set $over (i32.or (local.get $over) (i32.ge_u (local.get $best) (i32.const @FRAG_LIMIT))))))
#endif
      (if (local.get $mode) (then (local.set $over (i32.or (local.get $over) (call $a_mode_play)))))
      (if (local.get $over)
        (then
          (if (local.get $mode) (then (call $a_places)))
          (i32.store (i32.const @HDR_STATE) (i32.const @H_OVER))
          (i32.store (i32.const @HDR_UNTIL) (i32.add (local.get $t) (i32.const @OVER_TICKS)))))
      (return)))
  (if (i32.and (i32.eq (local.get $state) (i32.const @H_OVER)) (i32.ge_u (local.get $t) (i32.load (i32.const @HDR_UNTIL))))
    (then
      ;; a new match, its mode picked: scores cleared, sides gone, everyone respawned, every pad back
      (i32.store (i32.const @HDR_HOLE) (i32.add (i32.load (i32.const @HDR_HOLE)) (i32.const 1)))
      (call $a_mode_pick)
      (!for $p (i32.const 0) (i32.const @NPLAYER)
        (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
        (if (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_LIVE))
          (then
            (!put u8 @(PLAYERS + P_FL) (local.get $pb) (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @(255 ^ (PF_ZOMBIE | PF_JUGG)))))
            (!put u16 @(PLAYERS + A_KILLS) (local.get $pb) (i32.const 0))
            (!put u16 @(PLAYERS + A_DEATHS) (local.get $pb) (i32.const 0))
            (call $a_spawn (local.get $p)))))
      (!for $k (i32.const 0) (i32.const @NPAD)
        (i32.store16 offset=14 (i32.add (i32.const @PAD) (i32.shl (local.get $k) (i32.const 4))) (i32.const 0)))
      (i32.store (i32.const @HDR_STATE) (i32.const @H_COUNT))
      (i32.store (i32.const @HDR_UNTIL) (i32.add (local.get $t) (i32.const @COUNT_TICKS))))))

;; ---- modes (layout.mjs, M_*): the rules a match plays by, picked as its
;; countdown starts. All of it the confirmed world's, serial, by slot; only
;; $a_ally is also asked by code the prediction runs, and it reads nothing
;; the prediction changes.

;; The mode of the match about to count down (match HDR_HOLE of the room): the
;; rotation's, or the seed's if its top byte is FORCE_MODE (one past the
;; modes is a Fiesta). Every mode's state starts from zero.
(func $a_mode_pick
  (local $seed i32) (local $k i32) (local $m i32)
  (local.set $seed (i32.load (i32.const @HDR_SEED)))
  (local.set $k (i32.rem_u (i32.load (i32.const @HDR_HOLE)) (i32.const @(ARENA_MODES.length))))
  (local.set $m (!tab ARENA_MODES (local.get $k)))
  (if (i32.eq (i32.shr_u (local.get $seed) (i32.const 24)) (i32.const @FORCE_MODE))
    (then (local.set $m (i32.and (i32.shr_u (local.get $seed) (i32.const 16)) (i32.const 0xff)))))
  (if (i32.ge_u (local.get $m) (i32.const @(MODES.length))) (then (local.set $m (i32.const @M_FIESTA))))
  (memory.fill (i32.const @AH_MODE) (i32.const 0) (i32.const @(AH_WINNER + 4 - AH_MODE)))
  (i32.store (i32.const @AH_MODE) (local.get $m))
  (memory.fill (i32.const @MODE_REC) (i32.const 0) (i32.const @(NPLAYER * MR_SIZE))))

;; Slot p joins (its record cleared, live). A join that starts the countdown
;; picks the match's mode first; a join into Infection's play is a zombie.
(func $a_join (param $p i32)
  (if (i32.eq (i32.load (i32.const @HDR_STATE)) (i32.const @H_IDLE)) (then (call $a_mode_pick)))
  (memory.fill (i32.add (i32.const @MODE_REC) (i32.shl (local.get $p) (i32.const 3))) (i32.const 0) (i32.const @MR_SIZE))
  (if (i32.and (i32.eq (i32.load (i32.const @AH_MODE)) (i32.const @M_INFECTION)) (i32.eq (i32.load (i32.const @HDR_STATE)) (i32.const @H_PLAY)))
    (then (!put u8 @(PLAYERS + P_FL) (i32.shl (local.get $p) (i32.const 6)) (i32.const @(PF_LIVE | PF_ZOMBIE)))))
  (call $a_spawn (local.get $p)))

;; 1 if slots p and q are on one side in a mode that has sides (TEAM_MODES):
;; Infection's humans, or its zombies; everyone but the juggernaut. Never p and p.
(func $a_ally (param $p i32) (param $q i32) (result i32)
  (if (i32.or (i32.eq (local.get $p) (local.get $q))
              (i32.eqz (i32.and (i32.shl (i32.const 1) (i32.load (i32.const @AH_MODE))) (i32.const @TEAM_MODES))))
    (then (return (i32.const 0))))
  (i32.eqz (i32.and (i32.xor (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $p) (i32.const 6)))
                             (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $q) (i32.const 6))))
                    (i32.const @(PF_ZOMBIE | PF_JUGG)))))

;; 1 if slot q is alive and on no side yet.
(func $a_free (param $q i32) (result i32)
  (i32.eq (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $q) (i32.const 6))) (i32.const @(PF_LIVE | PF_DEAD | PF_ZOMBIE | PF_JUGG)))
          (i32.const @PF_LIVE)))

;; Ticks since play began, at most 0xffff.
(func $a_played (result i32)
  (local $n i32)
  (local.set $n (i32.sub (i32.load (i32.const @HDR_TICK)) (i32.load (i32.const @HDR_START))))
  (select (local.get $n) (i32.const 0xffff) (i32.lt_u (local.get $n) (i32.const 0xffff))))

;; A mode's news for the feed (FX_MODE: what as its size), at owner's feet.
(func $a_news (param $what i32) (param $owner i32) (param $shot i32)
  (local $b i32)
  (local.set $b (i32.shl (local.get $owner) (i32.const 6)))
  (call $fx (i32.const 0) (i32.const @FX_MODE) (local.get $owner) (local.get $shot)
            (!at f32 @(PLAYERS + P_PX) (local.get $b)) (!at f32 @(PLAYERS + P_PY) (local.get $b)) (!at f32 @(PLAYERS + P_PZ) (local.get $b))
            (f32.convert_i32_u (local.get $what))))

;; Slot q goes over to the other side where it stands: a zombie in Infection
;; (the sword, no shields, its ticks as a human counted), the juggernaut in
;; Juggernaut (the sword, the overshield). Neither throws frags.
(func $a_turn (param $q i32)
  (local $qb i32) (local $jugg i32)
  (local.set $qb (i32.shl (local.get $q) (i32.const 6)))
  (local.set $jugg (i32.eq (i32.load (i32.const @AH_MODE)) (i32.const @M_JUGGERNAUT)))
  (!put u8 @(PLAYERS + P_FL) (local.get $qb)
    (i32.or (!at u8 @(PLAYERS + P_FL) (local.get $qb)) (select (i32.const @PF_JUGG) (i32.const @PF_ZOMBIE) (local.get $jugg))))
  (call $a_arm (local.get $q) (i32.const @W_SWORD) (i32.const @W_SWORD))
  (!put u8 @(PLAYERS + A_SH) (local.get $qb) (select (i32.const @OVERSHIELD) (i32.const 0) (local.get $jugg)))
  (!put u8 @(PLAYERS + A_HP) (local.get $qb) (i32.const 100))
  (!put u16 @(PLAYERS + A_SHT) (local.get $qb) (i32.const 0))
  (!put u8 @(PLAYERS + A_GRENS) (local.get $qb) (i32.const 0))
  (!put u8 @(PLAYERS + A_NEEDLES) (local.get $qb) (i32.const 0))
  (!put u16 @(PLAYERS + P_REFIRE) (local.get $qb) (i32.const @SWAP_TICKS))
  (if (local.get $jugg)
    (then (i32.store (i32.const @AH_LEADER) (i32.add (local.get $q) (i32.const 1))))
    (else (i32.store16 offset=@(MODE_REC + MR_HUMAN) (i32.shl (local.get $q) (i32.const 3)) (call $a_played))))
  (call $a_news (select (i32.const @MX_JUGG) (i32.const @MX_ZOMBIE) (local.get $jugg)) (local.get $q) (local.get $q)))

;; n fighters on no side yet, each drawn by $rand from those alive in slot
;; order and turned; never the last one left on no side.
(func $a_draw (param $n i32)
  (local $k i32) (local $q i32) (local $c i32) (local $pick i32)
  (!for $k (i32.const 0) (local.get $n)
    (local.set $c (i32.const 0))
    (!for $q (i32.const 0) (i32.const @NPLAYER)
      (if (call $a_free (local.get $q)) (then (!inc $c))))
    (if (i32.lt_u (local.get $c) (i32.const 2)) (then (return)))
    (local.set $pick (i32.rem_u (call $rand) (local.get $c)))
    (local.set $c (i32.const 0))
    (block $found
      (!for $q (i32.const 0) (i32.const @NPLAYER)
        (if (call $a_free (local.get $q))
          (then
            (if (i32.eq (local.get $c) (local.get $pick)) (then (call $a_turn (local.get $q)) (br $found)))
            (!inc $c)))))))

;; Live humans and zombies (Infection's sides), and the last human in slot order.
(func $a_sides (result i32 i32 i32)
  (local $p i32) (local $fl i32) (local $h i32) (local $z i32) (local $last i32)
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $fl (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $p) (i32.const 6))))
    (if (i32.and (local.get $fl) (i32.const @PF_LIVE))
      (then
        (if (i32.and (local.get $fl) (i32.const @PF_ZOMBIE))
          (then (!inc $z))
          (else (!inc $h) (local.set $last (local.get $p)))))))
  (local.get $h) (local.get $z) (local.get $last))

;; How slot p stands under the match's mode, higher is better (unsigned).
;; Infection: a human still alive above everyone, then ticks lived as a
;; human, then infections. Gun game: the rung, then kills. Juggernaut:
;; points, then kills.
(func $a_key (param $p i32) (result i32)
  (local $m i32) (local $r i32) (local $n i32)
  (local.set $m (i32.load (i32.const @AH_MODE)))
  (local.set $r (i32.shl (local.get $p) (i32.const 3)))
  (if (i32.eq (local.get $m) (i32.const @M_INFECTION))
    (then
      (if (i32.eqz (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $p) (i32.const 6))) (i32.const @PF_ZOMBIE)))
        (then (return (i32.const 0x80000000))))
      (local.set $n (!at u16 @(MODE_REC + MR_HUMAN) (local.get $r)))
      (return (i32.or (i32.shl (select (local.get $n) (i32.const 0x7fff) (i32.lt_u (local.get $n) (i32.const 0x7fff))) (i32.const 16))
                      (!at u16 @(MODE_REC + MR_POINTS) (local.get $r))))))
  (i32.or (i32.shl (select (!at u8 @(MODE_REC + MR_RUNG) (local.get $r)) (!at u16 @(MODE_REC + MR_POINTS) (local.get $r))
                           (i32.eq (local.get $m) (i32.const @M_GUNGAME)))
                   (i32.const 16))
          (!at u16 @(PLAYERS + A_KILLS) (i32.shl (local.get $p) (i32.const 6)))))

;; A tick of play under the match's mode, after everyone's own. Gun game
;; finds its leader; Juggernaut draws a juggernaut if there is none (it
;; died by its own hand, or left); Infection draws a zombie if they all left,
;; and counts its sides. 1 if that ends the match: a winner, or no human left.
(func $a_mode_play (result i32)
  (local $m i32) (local $p i32) (local $h i32) (local $z i32) (local $last i32) (local $key i32) (local $best i32) (local $lead i32)
  (local.set $m (i32.load (i32.const @AH_MODE)))
  (if (i32.eq (local.get $m) (i32.const @M_GUNGAME))
    (then
      ;; the highest rung, then the most kills, then the lowest slot
      (!for $p (i32.const 0) (i32.const @NPLAYER)
        (if (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $p) (i32.const 6))) (i32.const @PF_LIVE))
          (then
            (local.set $key (call $a_key (local.get $p)))
            (if (i32.or (i32.eqz (local.get $lead)) (i32.gt_u (local.get $key) (local.get $best)))
              (then (local.set $best (local.get $key)) (local.set $lead (i32.add (local.get $p) (i32.const 1))))))))
      (i32.store (i32.const @AH_LEADER) (local.get $lead))
      (return (i32.ne (i32.load (i32.const @AH_WINNER)) (i32.const 0)))))
  (if (i32.eq (local.get $m) (i32.const @M_JUGGERNAUT))
    (then
      (local.set $lead (i32.load (i32.const @AH_LEADER)))
      (if (i32.or (i32.eqz (local.get $lead))
                  (i32.eqz (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (i32.sub (local.get $lead) (i32.const 1)) (i32.const 6))) (i32.const @PF_JUGG))))
        (then (i32.store (i32.const @AH_LEADER) (i32.const 0)) (call $a_draw (i32.const 1))))
      (return (i32.ne (i32.load (i32.const @AH_WINNER)) (i32.const 0)))))
  (call $a_sides)
  (local.set $last) (local.set $z) (local.set $h)
  (if (i32.and (i32.eqz (local.get $z)) (i32.ge_u (local.get $h) (i32.const 2)))
    (then
      (call $a_draw (i32.const 1))
      (call $a_sides)
      (local.set $last) (local.set $z) (local.set $h)))
  (if (i32.and (i32.eq (local.get $h) (i32.const 1)) (i32.gt_u (i32.load (i32.const @AH_HUMANS)) (i32.const 1)))
    (then (call $a_news (i32.const @MX_LAST) (local.get $last) (local.get $last))))
  (i32.store (i32.const @AH_HUMANS) (local.get $h))
  (i32.store (i32.const @AH_ZOMBIES) (local.get $z))
  (i32.eqz (local.get $h)))

;; As a mode's match ends: Infection's survivors were human to the end; then
;; everyone's place by $a_key (MR_PLACE, ties share the better one).
(func $a_places
  (local $p i32) (local $q i32) (local $key i32) (local $rank i32)
  (if (i32.eq (i32.load (i32.const @AH_MODE)) (i32.const @M_INFECTION))
    (then
      (!for $p (i32.const 0) (i32.const @NPLAYER)
        (if (i32.eq (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $p) (i32.const 6))) (i32.const @(PF_LIVE | PF_ZOMBIE))) (i32.const @PF_LIVE))
          (then (i32.store16 offset=@(MODE_REC + MR_HUMAN) (i32.shl (local.get $p) (i32.const 3)) (call $a_played)))))))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (if (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $p) (i32.const 6))) (i32.const @PF_LIVE))
      (then
        (local.set $key (call $a_key (local.get $p)))
        (local.set $rank (i32.const 1))
        (!for $q (i32.const 0) (i32.const @NPLAYER)
          (if (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $q) (i32.const 6))) (i32.const @PF_LIVE))
            (then (if (i32.gt_u (call $a_key (local.get $q)) (local.get $key)) (then (!inc $rank))))))
        (i32.store8 offset=@(MODE_REC + MR_PLACE) (i32.shl (local.get $p) (i32.const 3))
                    (select (local.get $rank) (i32.const 255) (i32.lt_u (local.get $rank) (i32.const 255))))))))

;; A kill under the match's mode (from $a_kill: the confirmed world, in play).
;; Infection: a human who dies is a zombie, an infection for the zombie that
;; did it, and a zombie comes back sooner. Gun game: an assassination moves
;; its victim down a rung; any kill of another moves the killer up one, its
;; new gun in its hands at once; the first kill with the sword wins.
;; Juggernaut: whoever kills the juggernaut becomes it; its kills are points.
(func $a_mode_kill (param $q i32) (param $a i32) (param $cause i32)
  (local $m i32) (local $qb i32) (local $ab i32) (local $r i32) (local $by i32) (local $w i32)
  (local.set $m (i32.load (i32.const @AH_MODE)))
  (local.set $qb (i32.shl (local.get $q) (i32.const 6)))
  (local.set $ab (i32.shl (local.get $a) (i32.const 6)))
  (local.set $by (i32.ne (local.get $a) (local.get $q)))
  (if (i32.eq (local.get $m) (i32.const @M_INFECTION))
    (then
      (if (i32.eqz (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $qb)) (i32.const @PF_ZOMBIE)))
        (then
          (!put u8 @(PLAYERS + P_FL) (local.get $qb) (i32.or (!at u8 @(PLAYERS + P_FL) (local.get $qb)) (i32.const @PF_ZOMBIE)))
          (i32.store16 offset=@(MODE_REC + MR_HUMAN) (i32.shl (local.get $q) (i32.const 3)) (call $a_played))
          (local.set $by (i32.and (local.get $by) (i32.ne (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $ab)) (i32.const @PF_ZOMBIE)) (i32.const 0))))
          (if (local.get $by)
            (then (i32.store16 offset=@(MODE_REC + MR_POINTS) (i32.shl (local.get $a) (i32.const 3))
                    (i32.add (i32.load16_u offset=@(MODE_REC + MR_POINTS) (i32.shl (local.get $a) (i32.const 3))) (i32.const 1)))))
          (call $a_news (i32.const @MX_INFECT) (select (local.get $a) (local.get $q) (local.get $by)) (local.get $q))))
      (!put u16 @(PLAYERS + A_RESPAWN) (local.get $qb) (i32.const @ZRESPAWN_TICKS))
      (return)))
  (if (i32.eq (local.get $m) (i32.const @M_GUNGAME))
    (then
      (local.set $r (i32.load8_u offset=@(MODE_REC + MR_RUNG) (i32.shl (local.get $q) (i32.const 3))))
      (if (i32.and (i32.eq (local.get $cause) (i32.const @KILL_BEHIND)) (i32.lt_u (i32.sub (local.get $r) (i32.const 1)) (i32.const @(LADDER.length - 1))))
        (then
          (i32.store8 offset=@(MODE_REC + MR_RUNG) (i32.shl (local.get $q) (i32.const 3)) (i32.sub (local.get $r) (i32.const 1)))
          (call $a_news (i32.const @MX_DEMOTE) (local.get $q) (i32.sub (local.get $r) (i32.const 1)))))
      (if (i32.eqz (local.get $by)) (then (return)))
      (local.set $r (i32.load8_u offset=@(MODE_REC + MR_RUNG) (i32.shl (local.get $a) (i32.const 3))))
      (if (i32.eq (local.get $r) (i32.const @(LADDER.length - 1)))
        (then
          (if (i32.and (i32.eq (local.get $cause) (i32.const @W_SWORD)) (i32.eqz (i32.load (i32.const @AH_WINNER))))
            (then
              (i32.store8 offset=@(MODE_REC + MR_RUNG) (i32.shl (local.get $a) (i32.const 3)) (i32.const @(LADDER.length)))
              (i32.store (i32.const @AH_WINNER) (i32.add (local.get $a) (i32.const 1)))
              (call $a_news (i32.const @MX_WIN) (local.get $a) (local.get $q))))))
      (if (i32.ge_u (local.get $r) (i32.const @(LADDER.length - 1))) (then (return)))
      (local.set $r (i32.add (local.get $r) (i32.const 1)))
      (i32.store8 offset=@(MODE_REC + MR_RUNG) (i32.shl (local.get $a) (i32.const 3)) (local.get $r))
      (call $a_news (i32.const @MX_RUNG) (local.get $a) (local.get $r))
      ;; the new gun now, if the killer is alive to hold it (else it comes with the respawn)
      (if (i32.eq (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $ab)) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE))
        (then
          (local.set $w (!tab LADDER (local.get $r)))
          (call $a_arm (local.get $a) (local.get $w) (local.get $w))
          (!put u16 @(PLAYERS + P_REFIRE) (local.get $ab) (i32.const @SWAP_TICKS))))
      (return)))
  (if (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $qb)) (i32.const @PF_JUGG))
    (then
      (!put u8 @(PLAYERS + P_FL) (local.get $qb) (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $qb)) (i32.const @(255 ^ PF_JUGG))))
      (i32.store (i32.const @AH_LEADER) (i32.const 0))
      (if (i32.and (local.get $by) (i32.eq (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $ab)) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE)))
        (then (call $a_turn (local.get $a))))
      (return)))
  (if (i32.and (local.get $by) (i32.ne (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $ab)) (i32.const @PF_JUGG)) (i32.const 0)))
    (then
      (local.set $r (i32.add (i32.load16_u offset=@(MODE_REC + MR_POINTS) (i32.shl (local.get $a) (i32.const 3))) (i32.const 1)))
      (i32.store16 offset=@(MODE_REC + MR_POINTS) (i32.shl (local.get $a) (i32.const 3)) (local.get $r))
      (if (i32.and (i32.ge_u (local.get $r) (i32.const @JUGG_POINTS)) (i32.eqz (i32.load (i32.const @AH_WINNER))))
        (then
          (i32.store (i32.const @AH_WINNER) (i32.add (local.get $a) (i32.const 1)))
          (call $a_news (i32.const @MX_WIN) (local.get $a) (local.get $q)))))))
