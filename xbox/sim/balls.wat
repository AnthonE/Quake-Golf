;; Balls: a modular 3D grid, Jacobi contacts, SIMD integration, terrain, sleep.
;;
;; Phase A (contacts) reads only start-of-tick state and writes only dv[i] for
;; its own awake balls (plus idempotent wake bytes). Phase B (integrate) writes
;; only its own balls. So any split of the work across threads gives the same bits.

;; Cell coordinates; cells are one ball diameter.
(func $cell (param $x f32) (param $y f32) (param $z f32) (result i32 i32 i32)
  (i32.trunc_sat_f32_s (f32.floor (f32.mul (local.get $x) (f32.const @INV_CELL))))
  (i32.trunc_sat_f32_s (f32.floor (f32.mul (local.get $y) (f32.const @INV_CELL))))
  (i32.trunc_sat_f32_s (f32.floor (f32.mul (local.get $z) (f32.const @INV_CELL)))))

;; 64 x 8 x 64 buckets, wrapping. Any cell's 27 neighbours land in 27 distinct
;; buckets, so no pair is ever visited twice; far cells alias, distance filters them.
(func $bucket (param $cx i32) (param $cy i32) (param $cz i32) (result i32)
  (i32.or (i32.or (i32.and (local.get $cx) (i32.const 63))
                  (i32.shl (i32.and (local.get $cy) (i32.const 7)) (i32.const 6)))
          (i32.shl (i32.and (local.get $cz) (i32.const 63)) (i32.const 9))))

;; The grid. Each bucket is a list of its balls through NEXT, in ascending
;; index, so a scan meets a cell's balls in the order a stable sort would
;; give. The lists are a function of the region alone (positions and flags),
;; however they were reached, and every store keeps NEXT[j] > j, so a reader
;; on another thread (the prediction) always reaches the end of a list.

;; The bucket ball i belongs in now: its cell's, or none once out of play.
(func $bucket_of (param $i i32) (result i32)
  (if (result i32) (i32.and (!ld u8 @FLAGS (local.get $i)) (i32.const @F_LIVE))
    (then (call $bucket (call $cell (!ld f32 @PX (local.get $i)) (!ld f32 @PY (local.get $i)) (!ld f32 @PZ (local.get $i)))))
    (else (i32.const 0xffff))))

;; Moves ball i into the bucket it belongs in, if it is not there already.
;; Called wherever a ball's position or liveness changes outside integrate:
;; a spawn, a new ball on the tee, a sink; and by tick_end for every ball integrate moved.
(func $regrid_ball (param $i i32)
  (local $old i32) (local $new i32) (local $at i32) (local $j i32)
  (local.set $new (call $bucket_of (local.get $i)))
  (local.set $old (!ld u16 @CELLOF (local.get $i)))
  (if (i32.eq (local.get $new) (local.get $old)) (then (return)))
  (if (i32.ne (local.get $old) (i32.const 0xffff))
    (then
      ;; out of the old list: $at is the link that points at i
      (local.set $at (i32.add (i32.const @HEAD) (i32.shl (local.get $old) (i32.const 1))))
      (block $found
        (loop $walk
          (local.set $j (i32.load16_u (local.get $at)))
          (br_if $found (i32.eq (local.get $j) (local.get $i)))
#if DEBUG
          (if (i32.eq (local.get $j) (i32.const 0xffff))
            (then (i32.store (i32.const @ERR_CODE) (i32.const 91)) (i32.store (i32.const @ERR_INDEX) (local.get $i)) (unreachable)))
#endif
          (local.set $at (i32.add (i32.const @NEXT) (i32.shl (local.get $j) (i32.const 1))))
          (br $walk)))
      (i32.store16 (local.get $at) (!ld u16 @NEXT (local.get $i)))))
  (!st u16 @CELLOF (local.get $i) (local.get $new))
  (if (i32.ne (local.get $new) (i32.const 0xffff))
    (then
      ;; into the new list before the first higher index (0xffff, the end, is higher than any)
      (local.set $at (i32.add (i32.const @HEAD) (i32.shl (local.get $new) (i32.const 1))))
      (block $here
        (loop $walk
          (local.set $j (i32.load16_u (local.get $at)))
          (br_if $here (i32.gt_u (local.get $j) (local.get $i)))
          (local.set $at (i32.add (i32.const @NEXT) (i32.shl (local.get $j) (i32.const 1))))
          (br $walk)))
      (!st u16 @NEXT (local.get $i) (local.get $j))
      (i32.store16 (local.get $at) (local.get $i)))))

;; The whole grid from the region, highest index first so each list comes out ascending.
(func $grid_build
  (local $i i32) (local $b i32)
  (memory.fill (i32.const @HEAD) (i32.const 0xff) (i32.const @(NCELL * 2)))
  (memory.fill (i32.const @CELLOF) (i32.const 0xff) (i32.const @(BALL_CAP * 2)))
  (local.set $i (i32.load (i32.const @HDR_NBALLS)))
  (block $done
    (loop $down
      (br_if $done (i32.eqz (local.get $i)))
      (local.set $i (i32.sub (local.get $i) (i32.const 1)))
      (local.set $b (call $bucket_of (local.get $i)))
      (if (i32.ne (local.get $b) (i32.const 0xffff))
        (then
          (!st u16 @CELLOF (local.get $i) (local.get $b))
          (!st u16 @NEXT (local.get $i) (!ld u16 @HEAD (local.get $b)))
          (!st u16 @HEAD (local.get $b) (local.get $i))))
      (br $down)))
  (i32.store (i32.const @GRID_OK) (i32.const 1)))

;; The region was written from outside (a keyframe, a planner's snapshot):
;; rebuild the grid before the next tick.
(func (export "regrid")
  (i32.store (i32.const @GRID_OK) (i32.const 0)))

#if DEBUG
;; Every live ball in exactly the bucket it belongs in, every list ascending.
(func $grid_check
  (local $b i32) (local $j i32) (local $prev i32) (local $count i32) (local $live i32) (local $i i32) (local $n i32)
  (!for $b (i32.const 0) (i32.const @NCELL)
    (local.set $prev (i32.const -1))
    (local.set $j (!ld u16 @HEAD (local.get $b)))
    (block $end
      (loop $walk
        (br_if $end (i32.eq (local.get $j) (i32.const 0xffff)))
        (if (i32.or (i32.le_s (local.get $j) (local.get $prev)) (i32.ne (!ld u16 @CELLOF (local.get $j)) (local.get $b)))
          (then (i32.store (i32.const @ERR_CODE) (i32.const 92)) (i32.store (i32.const @ERR_INDEX) (local.get $j)) (unreachable)))
        (!inc $count)
        (local.set $prev (local.get $j))
        (local.set $j (!ld u16 @NEXT (local.get $j)))
        (br $walk))))
  (local.set $n (i32.load (i32.const @HDR_NBALLS)))
  (!for $i (i32.const 0) (local.get $n)
    (if (i32.ne (!ld u16 @CELLOF (local.get $i)) (call $bucket_of (local.get $i)))
      (then (i32.store (i32.const @ERR_CODE) (i32.const 93)) (i32.store (i32.const @ERR_INDEX) (local.get $i)) (unreachable)))
    (if (i32.and (!ld u8 @FLAGS (local.get $i)) (i32.const @F_LIVE)) (then (!inc $live))))
  (if (i32.ne (local.get $count) (local.get $live))
    (then (i32.store (i32.const @ERR_CODE) (i32.const 94)) (i32.store (i32.const @ERR_INDEX) (local.get $count)) (unreachable))))
#endif

;; Serial: the grid checked (rebuilt if the region came from outside), events,
;; players and projectiles (which look balls up in the grid), then the awake
;; list and blocks, a 4-ball word at a time.
(func $tick_begin (export "tick_begin") (result i32)
  (local $n i32) (local $i i32) (local $m i32)
  (local $na i32) (local $nb i32) (local $blk i32) (local $nblk i32)
  (if (i32.or (i32.eqz (i32.load (i32.const @GRID_OK)))
              (i32.or (i32.ne (i32.load (i32.const @GRID_TICK)) (i32.load (i32.const @HDR_TICK)))
                      (i32.ne (i32.load (i32.const @GRID_N)) (i32.load (i32.const @HDR_NBALLS)))))
    (then (call $grid_build)))
  (call $apply_events)
  (local.set $n (i32.load (i32.const @HDR_NBALLS)))
  (call $players)
  (call $push_balls)
  (call $projectiles (i32.const 0) (i32.const -1))
  (local.set $nblk (i32.shr_u (i32.add (local.get $n) (i32.const 3)) (i32.const 2)))
  (!for $blk (i32.const 0) (local.get $nblk)
    (if (i32.and (i32.load offset=@FLAGS (i32.shl (local.get $blk) (i32.const 2))) (i32.const @(F_AWAKE * 0x01010101)))
      (then
        (!st u16 @BLOCKS (local.get $nb) (local.get $blk)) (!inc $nb)
        (!for $m (i32.const 0) (i32.const 4)
          (local.set $i (i32.add (i32.shl (local.get $blk) (i32.const 2)) (local.get $m)))
          (if (i32.and (!ld u8 @FLAGS (local.get $i)) (i32.const @F_AWAKE))
            (then (!st u16 @AWAKE (local.get $na) (local.get $i)) (!inc $na)))))))
  (i32.store (i32.const @JOB_NA) (local.get $na))
  (i32.store (i32.const @JOB_NB) (local.get $nb))
  (local.get $na))

;; Phase A over AWAKE[lo, hi).
(func $contacts (export "contacts") (param $lo i32) (param $hi i32)
  (local $k i32) (local $i i32) (local $j i32) (local $s i32) (local $b i32)
  (local $cx i32) (local $cy i32) (local $cz i32) (local $oz i32)
  (local $px f32) (local $py f32) (local $pz f32) (local $vx f32) (local $vy f32) (local $vz f32)
  (local $dx f32) (local $dy f32) (local $dz f32) (local $d2 f32) (local $dist f32) (local $inv f32)
  (local $nx f32) (local $ny f32) (local $nz f32) (local $vrel f32) (local $pen f32) (local $coef f32)
  (local $ax f32) (local $ay f32) (local $az f32) (local $bz i32) (local $byz i32) (local $h0 i32) (local $h1 i32) (local $h2 i32)
  (!for $k (local.get $lo) (local.get $hi)
    (local.set $i (!ld u16 @AWAKE (local.get $k)))
    (local.set $px (!ld f32 @PX (local.get $i)))
    (local.set $py (!ld f32 @PY (local.get $i)))
    (local.set $pz (!ld f32 @PZ (local.get $i)))
    (local.set $vx (!ld f32 @VX (local.get $i)))
    (local.set $vy (!ld f32 @VY (local.get $i)))
    (local.set $vz (!ld f32 @VZ (local.get $i)))
    ;; $cell and $bucket written out: V8 does not inline them, and a call in
    ;; this loop spills the sums around it. The rows and their three buckets
    ;; are unrolled, so each of the 27 short walks has branches of its own to
    ;; predict, and a row's three heads are loaded together before any walk.
    ;; The order is the loop's: by cell offset (z, y, x), then by index
    (local.set $cx (i32.trunc_sat_f32_s (f32.floor (f32.mul (local.get $px) (f32.const @INV_CELL)))))
    (local.set $cy (i32.trunc_sat_f32_s (f32.floor (f32.mul (local.get $py) (f32.const @INV_CELL)))))
    (local.set $cz (i32.trunc_sat_f32_s (f32.floor (f32.mul (local.get $pz) (f32.const @INV_CELL)))))
    (local.set $ax (f32.const 0))
    (local.set $ay (f32.const 0))
    (local.set $az (f32.const 0))
    (local.set $oz (i32.const -1))
    (loop $lz
      (local.set $bz (i32.shl (i32.and (i32.add (local.get $cz) (local.get $oz)) (i32.const 63)) (i32.const 9)))
      (!unroll $oy (-1 0 1)
        (local.set $byz (i32.or (local.get $bz)
                                (i32.shl (i32.and (i32.add (local.get $cy) (local.get $oy)) (i32.const 7)) (i32.const 6))))
        (local.set $h0 (!ld u16 @HEAD (i32.or (local.get $byz) (i32.and (i32.add (local.get $cx) (i32.const -1)) (i32.const 63)))))
        (local.set $h1 (!ld u16 @HEAD (i32.or (local.get $byz) (i32.and (local.get $cx) (i32.const 63)))))
        (local.set $h2 (!ld u16 @HEAD (i32.or (local.get $byz) (i32.and (i32.add (local.get $cx) (i32.const 1)) (i32.const 63)))))
        (!unroll $ox (-1 0 1)
          (local.set $s (select (local.get $h0) (select (local.get $h1) (local.get $h2) (i32.eqz (local.get $ox))) (i32.lt_s (local.get $ox) (i32.const 0))))
          (block $done
            (loop $scan
              (br_if $done (i32.eq (local.get $s) (i32.const 0xffff)))
              (local.set $j (local.get $s))
              (local.set $s (!ld u16 @NEXT (local.get $j)))
              (br_if $scan (i32.eq (local.get $j) (local.get $i)))
              (local.set $dx (f32.sub (!ld f32 @PX (local.get $j)) (local.get $px)))
              (local.set $dy (f32.sub (!ld f32 @PY (local.get $j)) (local.get $py)))
              (local.set $dz (f32.sub (!ld f32 @PZ (local.get $j)) (local.get $pz)))
              (local.set $d2 (!dot3 (local.get $dx) (local.get $dy) (local.get $dz) (local.get $dx) (local.get $dy) (local.get $dz)))
              (br_if $scan (i32.eqz (f32.lt (local.get $d2) (f32.const @D2))))
              (br_if $scan (i32.eqz (f32.gt (local.get $d2) (f32.const 1e-12))))
              (local.set $dist (f32.sqrt (local.get $d2)))
              (local.set $inv (f32.div (f32.const 1) (local.get $dist)))
              (local.set $nx (f32.mul (local.get $dx) (local.get $inv)))
              (local.set $ny (f32.mul (local.get $dy) (local.get $inv)))
              (local.set $nz (f32.mul (local.get $dz) (local.get $inv)))
              (local.set $pen (f32.sub (f32.const @TWO_R) (local.get $dist)))
              (if (i32.and (!ld u8 @FLAGS (local.get $j)) (i32.const @F_AWAKE))
                (then
                  ;; equal masses: each side takes half, so i and j get exact negatives
                  (local.set $vrel (!dot3 (f32.sub (!ld f32 @VX (local.get $j)) (local.get $vx))
                                          (f32.sub (!ld f32 @VY (local.get $j)) (local.get $vy))
                                          (f32.sub (!ld f32 @VZ (local.get $j)) (local.get $vz))
                                          (local.get $nx) (local.get $ny) (local.get $nz)))
                  (local.set $coef (f32.neg (f32.mul (f32.mul (local.get $pen) (f32.const @PUSH)) (f32.const 0.5))))
                  (if (f32.lt (local.get $vrel) (f32.const 0))
                    (then
                      (local.set $coef (!madd (local.get $vrel)
                                              (select (f32.const @((1 + Number(E_BB)) * 0.5)) (f32.const 0.5)
                                                      (f32.lt (local.get $vrel) (f32.const @(-Number(BOUNCE_MIN)))))
                                              (local.get $coef))))))
                (else
                  ;; a sleeping neighbour is static; hit it hard enough and it wakes next tick
                  (local.set $vrel (f32.neg (!dot3 (local.get $vx) (local.get $vy) (local.get $vz)
                                                   (local.get $nx) (local.get $ny) (local.get $nz))))
                  (local.set $coef (f32.neg (f32.mul (local.get $pen) (f32.const @PUSH))))
                  (if (f32.lt (local.get $vrel) (f32.const 0))
                    (then
                      (local.set $coef (!madd (local.get $vrel)
                                              (select (f32.const @(1 + Number(E_BB))) (f32.const 1)
                                                      (f32.lt (local.get $vrel) (f32.const @(-Number(BOUNCE_MIN)))))
                                              (local.get $coef)))))
                  (if (f32.lt (local.get $vrel) (f32.const @(-Number(WAKE_V))))
                    (then (i32.atomic.store8 offset=@WAKE (local.get $j) (i32.const 1))))))
              (local.set $ax (!madd (local.get $nx) (local.get $coef) (local.get $ax)))
              (local.set $ay (!madd (local.get $ny) (local.get $coef) (local.get $ay)))
              (local.set $az (!madd (local.get $nz) (local.get $coef) (local.get $az)))
              (br $scan)))))
      (local.set $oz (i32.add (local.get $oz) (i32.const 1)))
      (br_if $lz (i32.le_s (local.get $oz) (i32.const 1))))
    (!st f32 @DVX (local.get $i) (local.get $ax))
    (!st f32 @DVY (local.get $i) (local.get $ay))
    (!st f32 @DVZ (local.get $i) (local.get $az))))

;; Phase B over BLOCKS[lo, hi): four balls per instruction, then per-lane ground.
(func $integrate (export "integrate") (param $lo i32) (param $hi i32)
  (local $k i32) (local $base i32) (local $off i32) (local $m i32) (local $i i32)
  (local $mask v128) (local $vx v128) (local $vy v128) (local $vz v128) (local $dt v128)
  (local.set $dt (!splat @DT))
  (!for $k (local.get $lo) (local.get $hi)
    (local.set $base (i32.shl (!ld u16 @BLOCKS (local.get $k)) (i32.const 2)))
    (local.set $off (i32.shl (local.get $base) (i32.const 2)))
    (local.set $mask
      (i32x4.ne (v128.and (i32x4.extend_low_i16x8_u (i16x8.extend_low_i8x16_u (v128.load32_zero offset=@FLAGS (local.get $base))))
                          (i32x4.splat (i32.const @F_AWAKE)))
                (v128.const i32x4 0 0 0 0)))
    (local.set $vx (f32x4.add (v128.load offset=@VX (local.get $off)) (v128.load offset=@DVX (local.get $off))))
    (local.set $vy (f32x4.sub (f32x4.add (v128.load offset=@VY (local.get $off)) (v128.load offset=@DVY (local.get $off)))
                              (!splat @G_DT)))
    (local.set $vz (f32x4.add (v128.load offset=@VZ (local.get $off)) (v128.load offset=@DVZ (local.get $off))))
    (v128.store offset=@PX (local.get $off)
      (v128.bitselect (f32x4.add (v128.load offset=@PX (local.get $off)) (f32x4.mul (local.get $vx) (local.get $dt)))
                      (v128.load offset=@PX (local.get $off)) (local.get $mask)))
    (v128.store offset=@PY (local.get $off)
      (v128.bitselect (f32x4.add (v128.load offset=@PY (local.get $off)) (f32x4.mul (local.get $vy) (local.get $dt)))
                      (v128.load offset=@PY (local.get $off)) (local.get $mask)))
    (v128.store offset=@PZ (local.get $off)
      (v128.bitselect (f32x4.add (v128.load offset=@PZ (local.get $off)) (f32x4.mul (local.get $vz) (local.get $dt)))
                      (v128.load offset=@PZ (local.get $off)) (local.get $mask)))
    (v128.store offset=@VX (local.get $off) (v128.bitselect (local.get $vx) (v128.load offset=@VX (local.get $off)) (local.get $mask)))
    (v128.store offset=@VY (local.get $off) (v128.bitselect (local.get $vy) (v128.load offset=@VY (local.get $off)) (local.get $mask)))
    (v128.store offset=@VZ (local.get $off) (v128.bitselect (local.get $vz) (v128.load offset=@VZ (local.get $off)) (local.get $mask)))
    (!for $m (i32.const 0) (i32.const 4)
      (local.set $i (i32.add (local.get $base) (local.get $m)))
      (if (i32.and (!ld u8 @FLAGS (local.get $i)) (i32.const @F_AWAKE))
        (then (call $settle (local.get $i)))))))

;; One awake ball after integration: walls, ground contact, speed cap, sleep.
(func $settle (param $i i32)
  (local $px f32) (local $py f32) (local $pz f32) (local $vx f32) (local $vy f32) (local $vz f32)
  (local $h f32) (local $nx f32) (local $ny f32) (local $nz f32) (local $surf i32)
  (local $vn f32) (local $e f32) (local $mu f32) (local $sp f32) (local $scale f32) (local $sl i32)
  (local $rr f32) (local $tx f32) (local $ty f32) (local $tz f32) (local $ts f32) (local $keep f32)
  (local.set $px (!ld f32 @PX (local.get $i)))
  (local.set $py (!ld f32 @PY (local.get $i)))
  (local.set $pz (!ld f32 @PZ (local.get $i)))
  (local.set $vx (!ld f32 @VX (local.get $i)))
  (local.set $vy (!ld f32 @VY (local.get $i)))
  (local.set $vz (!ld f32 @VZ (local.get $i)))
  (if (f32.lt (local.get $px) (f32.const @LO)) (then (local.set $px (f32.const @LO)) (local.set $vx (f32.abs (local.get $vx)))))
  (if (f32.gt (local.get $px) (f32.const @HI)) (then (local.set $px (f32.const @HI)) (local.set $vx (f32.neg (f32.abs (local.get $vx))))))
  (if (f32.lt (local.get $pz) (f32.const @LO)) (then (local.set $pz (f32.const @LO)) (local.set $vz (f32.abs (local.get $vz)))))
  (if (f32.gt (local.get $pz) (f32.const @HI)) (then (local.set $pz (f32.const @HI)) (local.set $vz (f32.neg (f32.abs (local.get $vz))))))
  (call $ground (local.get $px) (local.get $pz))
  (local.set $surf) (local.set $nz) (local.set $ny) (local.set $nx) (local.set $h)
  (if (f32.lt (local.get $py) (f32.add (local.get $h) (f32.const @R)))
    (then
      (local.set $py (f32.add (local.get $h) (f32.const @R)))
      ;; fairway, rough, sand, green
      (local.set $e (select (f32.const 0.35) (select (f32.const 0.2) (select (f32.const 0.05) (f32.const 0.25)
                      (i32.eq (local.get $surf) (i32.const 2))) (i32.eq (local.get $surf) (i32.const 1))) (i32.eqz (local.get $surf))))
      (local.set $mu (select (f32.const 0.004) (select (f32.const 0.016) (select (f32.const 0.08) (f32.const 0.0027)
                      (i32.eq (local.get $surf) (i32.const 2))) (i32.eq (local.get $surf) (i32.const 1))) (i32.eqz (local.get $surf))))
      (local.set $vn (!dot3 (local.get $vx) (local.get $vy) (local.get $vz) (local.get $nx) (local.get $ny) (local.get $nz)))
      (if (f32.lt (local.get $vn) (f32.const 0))
        (then
          (local.set $e (select (local.get $e) (f32.const 0) (f32.lt (local.get $vn) (f32.const @(-Number(BOUNCE_MIN))))))
          (local.set $vn (f32.mul (local.get $vn) (f32.add (f32.const 1) (local.get $e))))
          (local.set $vx (f32.sub (local.get $vx) (f32.mul (local.get $nx) (local.get $vn))))
          (local.set $vy (f32.sub (local.get $vy) (f32.mul (local.get $ny) (local.get $vn))))
          (local.set $vz (f32.sub (local.get $vz) (f32.mul (local.get $nz) (local.get $vn))))))
      ;; rolling resistance on the tangential part: a constant deceleration per
      ;; surface (so a ball stops on a gentle slope) plus a proportional drag.
      ;; Per second: fairway 2.5 m/s^2 and 2 s, rough 5 and 0.5 s, sand 10 and
      ;; 0.1 s, green 1 and 3 s, so a 3 m/s putt rolls about 3 m
      (local.set $rr (select (f32.const 0.02) (select (f32.const 0.04) (select (f32.const 0.08) (f32.const 0.008)
                       (i32.eq (local.get $surf) (i32.const 2))) (i32.eq (local.get $surf) (i32.const 1))) (i32.eqz (local.get $surf))))
      (local.set $vn (!dot3 (local.get $vx) (local.get $vy) (local.get $vz) (local.get $nx) (local.get $ny) (local.get $nz)))
      (local.set $tx (f32.sub (local.get $vx) (f32.mul (local.get $nx) (local.get $vn))))
      (local.set $ty (f32.sub (local.get $vy) (f32.mul (local.get $ny) (local.get $vn))))
      (local.set $tz (f32.sub (local.get $vz) (f32.mul (local.get $nz) (local.get $vn))))
      (local.set $ts (f32.sqrt (!dot3 (local.get $tx) (local.get $ty) (local.get $tz) (local.get $tx) (local.get $ty) (local.get $tz))))
      (local.set $keep (select (f32.max (f32.sub (f32.sub (f32.const 1) (local.get $mu)) (f32.div (local.get $rr) (local.get $ts))) (f32.const 0))
                               (f32.const 0)
                               (f32.gt (local.get $ts) (local.get $rr))))
      (local.set $vx (!madd (local.get $tx) (local.get $keep) (f32.mul (local.get $nx) (local.get $vn))))
      (local.set $vy (!madd (local.get $ty) (local.get $keep) (f32.mul (local.get $ny) (local.get $vn))))
      (local.set $vz (!madd (local.get $tz) (local.get $keep) (f32.mul (local.get $nz) (local.get $vn))))))
  (if (f32.gt (local.get $py) (f32.const @CEIL))
    (then (local.set $py (f32.const @CEIL)) (local.set $vy (f32.min (local.get $vy) (f32.const 0)))))
  (local.set $sp (!dot3 (local.get $vx) (local.get $vy) (local.get $vz) (local.get $vx) (local.get $vy) (local.get $vz)))
  (if (f32.gt (local.get $sp) (f32.const @VMAX2))
    (then
      (local.set $scale (f32.div (f32.const 60) (f32.sqrt (local.get $sp))))
      (local.set $vx (f32.mul (local.get $vx) (local.get $scale)))
      (local.set $vy (f32.mul (local.get $vy) (local.get $scale)))
      (local.set $vz (f32.mul (local.get $vz) (local.get $scale)))))
  (local.set $sl (select (i32.add (!ld u8 @SLEEP (local.get $i)) (i32.const 1)) (i32.const 0)
                         (f32.lt (local.get $sp) (f32.const @SLEEP_V2))))
  (if (i32.ge_u (local.get $sl) (i32.const @SLEEP_TICKS))
    (then
      (local.set $sl (i32.const 0))
      (local.set $vx (f32.const 0))
      (local.set $vy (f32.const 0))
      (local.set $vz (f32.const 0))
      (!st u8 @FLAGS (local.get $i) (i32.and (!ld u8 @FLAGS (local.get $i)) (i32.const @(255 ^ F_AWAKE))))))
  (!chk (local.get $px) 1 (local.get $i))
  (!chk (local.get $py) 2 (local.get $i))
  (!chk (local.get $pz) 3 (local.get $i))
  (!chk (local.get $vx) 4 (local.get $i))
  (!chk (local.get $vy) 5 (local.get $i))
  (!chk (local.get $vz) 6 (local.get $i))
  (!st u8 @SLEEP (local.get $i) (local.get $sl))
  (!st f32 @PX (local.get $i) (local.get $px))
  (!st f32 @PY (local.get $i) (local.get $py))
  (!st f32 @PZ (local.get $i) (local.get $pz))
  (!st f32 @VX (local.get $i) (local.get $vx))
  (!st f32 @VY (local.get $i) (local.get $vy))
  (!st f32 @VZ (local.get $i) (local.get $vz)))
