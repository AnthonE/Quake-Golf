;; Tick orchestration, threads, init, keyframes.

;; Serial: apply wakes, the cup and hole clock, advance the tick, digest one slice. Slice s of the
;; interval that starts at tick K is digested at tick K+s+1, and the interval
;; closes at K+128. So every digest of an interval is taken after its boundary,
;; and a keyframe at a multiple of 128 restarts the sliced hash cleanly.
(func $tick_end (export "tick_end")
  (local $n i32) (local $i i32) (local $t i32) (local $s i32)
  (local.set $n (i32.load (i32.const @HDR_NBALLS)))
  (!for $i (i32.const 0) (local.get $n)
    (if (!ld u8 @WAKE (local.get $i))
      (then
        (!st u8 @FLAGS (local.get $i) (i32.or (!ld u8 @FLAGS (local.get $i)) (i32.const @F_AWAKE)))
        (!st u8 @SLEEP (local.get $i) (i32.const 0))
        (!st u8 @WAKE (local.get $i) (i32.const 0)))))
  (call $hole)
  (local.set $t (i32.add (i32.load (i32.const @HDR_TICK)) (i32.const 1)))
  (i32.store (i32.const @HDR_TICK) (local.get $t))
  (local.set $s (i32.and (i32.sub (local.get $t) (i32.const 1)) (i32.const @(NSLICE - 1))))
  (call $hash_slice (local.get $s))
  (if (i32.eq (local.get $s) (i32.const @(NSLICE - 1)))
    (then
      (i64.store (i32.const @INTERVAL_HASH) (call $xxh64 (i32.const @DIGESTS) (i32.const @(NSLICE * 8)) (i64.const 0)))
      (i32.store (i32.const @INTERVAL_TICK) (local.get $t)))))

;; One thread's share of a list: [total*id/n, total*(id+1)/n).
(func $range (param $total i32) (param $id i32) (param $n i32) (result i32 i32)
  (i32.div_u (i32.mul (local.get $total) (local.get $id)) (local.get $n))
  (i32.div_u (i32.mul (local.get $total) (i32.add (local.get $id) (i32.const 1))) (local.get $n)))

(func (export "step")
  (drop (call $tick_begin))
  (call $contacts (i32.const 0) (i32.load (i32.const @JOB_NA)))
  (call $integrate (i32.const 0) (i32.load (i32.const @JOB_NB)))
  (call $tick_end))

;; Generation barrier: spin briefly, then sleep on the generation word in
;; 50 ms naps. Returns 0, or 1 if any thread raised JOB_ABORT, so a trap on
;; one thread fails the run instead of hanging the others.
(func $barrier (export "barrier") (param $n i32) (result i32)
  (local $gen i32) (local $spin i32)
  (local.set $gen (i32.atomic.load (i32.const @BAR_GEN)))
  (if (i32.eq (i32.add (i32.atomic.rmw.add (i32.const @BAR_COUNT) (i32.const 1)) (i32.const 1)) (local.get $n))
    (then
      (i32.atomic.store (i32.const @BAR_COUNT) (i32.const 0))
      (drop (i32.atomic.rmw.add (i32.const @BAR_GEN) (i32.const 1)))
      (drop (memory.atomic.notify (i32.const @BAR_GEN) (i32.const 0x7fffffff)))
      (return (i32.atomic.load (i32.const @JOB_ABORT)))))
  (block $go
    (loop $spinning
      (br_if $go (i32.ne (i32.atomic.load (i32.const @BAR_GEN)) (local.get $gen)))
      (local.set $spin (i32.add (local.get $spin) (i32.const 1)))
      (br_if $spinning (i32.lt_u (local.get $spin) (i32.const 4000))))
    (loop $waiting
      (br_if $go (i32.ne (i32.atomic.load (i32.const @BAR_GEN)) (local.get $gen)))
      (if (i32.atomic.load (i32.const @JOB_ABORT)) (then (return (i32.const 1))))
      (drop (memory.atomic.wait32 (i32.const @BAR_GEN) (local.get $gen) (i64.const 50000000)))
      (br $waiting)))
  (i32.atomic.load (i32.const @JOB_ABORT)))

;; Thread 0, one tick across n threads. Returns 1 if the run was aborted.
(func (export "step_mt") (param $n i32) (result i32)
  (local $lo i32) (local $hi i32)
  (drop (call $tick_begin))
  (if (call $barrier (local.get $n)) (then (return (i32.const 1))))
  (call $range (i32.load (i32.const @JOB_NA)) (i32.const 0) (local.get $n))
  (local.set $hi) (local.set $lo)
  (call $contacts (local.get $lo) (local.get $hi))
  (if (call $barrier (local.get $n)) (then (return (i32.const 1))))
  (call $range (i32.load (i32.const @JOB_NB)) (i32.const 0) (local.get $n))
  (local.set $hi) (local.set $lo)
  (call $integrate (local.get $lo) (local.get $hi))
  (if (call $barrier (local.get $n)) (then (return (i32.const 1))))
  (call $tick_end)
  (i32.const 0))

;; Threads 1..n-1: the same three barriers, until JOB_QUIT or JOB_ABORT.
(func (export "worker_run") (param $id i32) (param $n i32)
  (local $lo i32) (local $hi i32)
  (loop $tick
    (if (call $barrier (local.get $n)) (then (return)))
    (if (i32.atomic.load (i32.const @JOB_QUIT)) (then (return)))
    (call $range (i32.load (i32.const @JOB_NA)) (local.get $id) (local.get $n))
    (local.set $hi) (local.set $lo)
    (call $contacts (local.get $lo) (local.get $hi))
    (if (call $barrier (local.get $n)) (then (return)))
    (call $range (i32.load (i32.const @JOB_NB)) (local.get $id) (local.get $n))
    (local.set $hi) (local.set $lo)
    (call $integrate (local.get $lo) (local.get $hi))
    (if (call $barrier (local.get $n)) (then (return)))
    (br $tick)))

(func (export "init") (param $seed i32)
  (memory.fill (i32.const @INTERVAL_HASH) (i32.const 0) (i32.const @(INBOX_REC - INTERVAL_HASH)))
  (memory.fill (i32.const @FX) (i32.const 0) (i32.const @(FX_REC - FX + FX_MAX * 32)))
  (memory.fill (i32.const @REGION) (i32.const 0) (i32.const @(PAGES * 65536 - REGION)))
  (i32.store (i32.const @HDR_SEED) (local.get $seed))
  (i32.store (i32.const @HDR_RNG)
    (select (i32.xor (local.get $seed) (i32.const 0x9e3779b9)) (i32.const 1)
            (i32.xor (local.get $seed) (i32.const 0x9e3779b9))))
  (call $terrain_gen (local.get $seed))
  (call $course_gen (local.get $seed)))

;; Keyframes only at interval boundaries (a multiple of 128), right after an
;; interval closes, so the next interval's digests all come from restored state.
(func (export "snapshot") (param $k i32)
#if DEBUG
  (if (i32.and (i32.load (i32.const @HDR_TICK)) (i32.const @(NSLICE - 1)))
    (then (i32.store (i32.const @ERR_CODE) (i32.const 90)) (unreachable)))
#endif
  (memory.copy (select (i32.const @SNAP1) (i32.const @SNAP0) (local.get $k)) (i32.const @REGION) (i32.const @REGION_SIZE)))

(func (export "restore") (param $k i32)
  (memory.copy (i32.const @REGION) (select (i32.const @SNAP1) (i32.const @SNAP0) (local.get $k)) (i32.const @REGION_SIZE)))
