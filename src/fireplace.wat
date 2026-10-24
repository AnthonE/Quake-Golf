;; Fireplace: every game in one module, a playlist the room plays through.
;; tools/asm.mjs builds golf, the arena and bumper balls each as its own build
;; would be, puts each under a prefix ($g., $a., $b.) with its exports made
;; internal, and appends this file: the module's exports, each sent to the game
;; on now (FP_GAME), and the playlist, run at the end of every tick.
;;
;; A game plays its matches as it always does. When its last one ends, the
;; room's marshmallows are handed out by how everyone placed, the result is
;; held FP_HOLD ticks, and then the world is wiped and the next game's built on
;; a seed drawn from the room's PRNG, with everyone in the room joined into it
;; on that tick. What lasts from game to game (the marshmallows) lives in a part
;; of the region no game touches. The games' static worlds (terrain, the
;; arena's map) are outside the region: FP_WORLD says which is built, and a
;; keyframe from another game rebuilds it under the restored region.

;; ---- the exports

(func (export "init") (param $seed i32)
  (call $g.init (local.get $seed))
  (call $fp_switch (i32.const @(PLAYLIST[0])) (local.get $seed)))

(func (export "step")
  (!pick none (call $g.step) (call $a.step) (call $b.step))
  (call $fp_after))

(func (export "step_mt") (param $n i32) (result i32)
  (local $r i32)
  (local.set $r (!pick i32 (call $g.step_mt (local.get $n)) (call $a.step_mt (local.get $n)) (call $b.step_mt (local.get $n))))
  (if (i32.eqz (local.get $r)) (then (call $fp_after)))
  (local.get $r))

;; The ball phases and the barrier are the same code in every game (balls.wat,
;; tick.wat): one copy serves them all, so a worker thread never changes games.
(func (export "worker_run") (param $id i32) (param $n i32) (call $g.worker_run (local.get $id) (local.get $n)))
(func (export "barrier") (param $n i32) (result i32) (call $g.barrier (local.get $n)))
(func (export "contacts") (param $lo i32) (param $hi i32) (call $g.contacts (local.get $lo) (local.get $hi)))
(func (export "integrate") (param $lo i32) (param $hi i32) (call $g.integrate (local.get $lo) (local.get $hi)))

(func (export "tick_begin") (result i32)
  (!pick i32 (call $g.tick_begin) (call $a.tick_begin) (call $b.tick_begin)))

(func (export "tick_end")
  (!pick none (call $g.tick_end) (call $a.tick_end) (call $b.tick_end))
  (call $fp_after))

(func (export "predict") (param $p i32) (param $n i32)
  (!pick none (call $g.predict (local.get $p) (local.get $n)) (call $a.predict (local.get $p) (local.get $n)) (call $b.predict (local.get $p) (local.get $n))))

(func (export "snapshot") (param $k i32) (call $g.snapshot (local.get $k)))

(func (export "restore") (param $k i32)
  (call $g.restore (local.get $k))
  (call $fp_world_check))

;; Anything that writes the region from outside (a keyframe) calls this.
(func (export "regrid")
  (call $fp_world_check)
  (call $g.regrid))

(func (export "hash_slice") (param $s i32) (call $g.hash_slice (local.get $s)))
(func (export "hash_region") (result i64) (call $g.hash_region))
(func (export "terrain_hash") (result i64) (call $g.terrain_hash))
(func (export "xxh64") (param $p i32) (param $len i32) (param $seed i64) (result i64) (call $g.xxh64 (local.get $p) (local.get $len) (local.get $seed)))
(func (export "sincos") (param $u i32) (result f32 f32) (call $g.sincos (local.get $u)))

;; ---- the static world

;; Builds game's terrain (and the arena's map) for seed. Each game's own gen,
;; which writes parts of the region as well: callers keep what they need.
(func $fp_world (param $game i32) (param $seed i32)
  (if (i32.eq (local.get $game) (i32.const @G_GOLF))
    (then (call $g.terrain_gen (local.get $seed)) (call $g.course_gen (local.get $seed))))
  (if (i32.eq (local.get $game) (i32.const @G_ARENA))
    (then (call $a.terrain_gen (local.get $seed)) (call $a.arena_gen (local.get $seed))))
  (if (i32.eq (local.get $game) (i32.const @G_BUMPER))
    (then (call $b.terrain_gen (local.get $seed)) (call $b.bumper_gen (local.get $seed))))
  (i32.store (i32.const @FP_WORLD) (i32.add (local.get $game) (i32.const 1)))
  (i32.store (i32.const @(FP_WORLD + 4)) (local.get $seed)))

;; The region came from somewhere else: if it is another game's, or the same
;; game's on another seed, build that world under it, the region kept as it is.
(func $fp_world_check
  (if (i32.and (i32.eq (i32.load (i32.const @FP_WORLD)) (i32.add (i32.load (i32.const @FP_GAME)) (i32.const 1)))
               (i32.eq (i32.load (i32.const @(FP_WORLD + 4))) (i32.load (i32.const @HDR_SEED))))
    (then (return)))
  (memory.copy (i32.const @FP_STASH) (i32.const @REGION) (i32.const @REGION_SIZE))
  (call $fp_world (i32.load (i32.const @FP_GAME)) (i32.load (i32.const @HDR_SEED)))
  (memory.copy (i32.const @REGION) (i32.const @FP_STASH) (i32.const @REGION_SIZE))
  (i32.store (i32.const @GRID_OK) (i32.const 0)))

;; ---- the playlist

;; Everyone into game `next` on seed: the world wiped but for the tick, the
;; PRNG and the playlist's own state; the next game's built; the players in
;; the room joined into it in slot order, keeping their input words when the
;; two games read the same word (golf's), else starting from none.
(func $fp_switch (param $next i32) (param $seed i32)
  (local $p i32) (local $pb i32) (local $t i32) (local $rng i32) (local $played i32) (local $keep i32) (local $last i32) (local $rec i32)
  ;; the playlist's arena plays its own rotation: never a seed that forces a mode
  (if (i32.and (i32.eq (local.get $next) (i32.const @G_ARENA)) (i32.eq (i32.shr_u (local.get $seed) (i32.const 24)) (i32.const @FORCE_MODE)))
    (then (local.set $seed (i32.xor (local.get $seed) (i32.const 0x01000000)))))
  (local.set $t (i32.load (i32.const @HDR_TICK)))
  (local.set $rng (i32.load (i32.const @HDR_RNG)))
  (local.set $played (i32.load16_u (i32.const @(FP_COUNT + 2))))
  (local.set $keep (i32.eq (i32.eq (i32.load (i32.const @FP_GAME)) (i32.const @G_ARENA)) (i32.eq (local.get $next) (i32.const @G_ARENA))))
  ;; who's in, and their words, into the stash (scratch for the length of this call)
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (i32.store8 offset=@(FP_STASH + 0x400) (local.get $p) (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_LIVE)))
    (i32.store offset=@FP_STASH (i32.shl (local.get $p) (i32.const 2))
      (select (!at i32 @(PLAYERS + P_IN) (local.get $pb)) (i32.const 0) (local.get $keep))))
  (memory.fill (i32.const @REGION) (i32.const 0) (i32.const @(FP_GAME - REGION)))
  (memory.fill (i32.const @PLAYERS) (i32.const 0) (i32.const @(FP - PLAYERS)))
  (memory.fill (i32.const @(FP + 0x2000)) (i32.const 0) (i32.const @(REGION + REGION_SIZE - FP - 0x2000)))
  (i32.store (i32.const @HDR_TICK) (local.get $t))
  (i32.store (i32.const @HDR_RNG) (local.get $rng))
  (i32.store (i32.const @HDR_SEED) (local.get $seed))
  (i32.store (i32.const @FP_GAME) (local.get $next))
  (i32.store (i32.const @FP_STAGE) (i32.const 0))
  (i32.store (i32.const @FP_AT) (i32.const 0))
  (i32.store (i32.const @FP_COUNT) (i32.shl (i32.add (local.get $played) (i32.const 1)) (i32.const 16)))
  (i32.store (i32.const @GRID_OK) (i32.const 0))
  (call $fp_world (local.get $next) (local.get $seed))
  (local.set $rec (i32.const @(FP_STASH + 0x500)))
  (local.set $last (i32.const -1))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (if (i32.load8_u offset=@(FP_STASH + 0x400) (local.get $p))
      (then
        (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
        (if (i32.eq (local.get $next) (i32.const @G_BUMPER))
          ;; bumper lays its round out once, for everyone in, below
          (then (!put u8 @(PLAYERS + P_FL) (local.get $pb) (i32.const @PF_LIVE)) (local.set $last (local.get $p)))
          (else
            (memory.fill (local.get $rec) (i32.const 0) (i32.const @REC))
            (i32.store8 offset=4 (local.get $rec) (i32.const @EV_JOIN))
            (i32.store8 offset=5 (local.get $rec) (local.get $p))
            (if (i32.eq (local.get $next) (i32.const @G_GOLF))
              (then (call $g.ev_join (local.get $rec)))
              (else (call $a.ev_join (local.get $rec))))))
        (!put i32 @(PLAYERS + P_IN) (local.get $pb) (i32.load offset=@FP_STASH (i32.shl (local.get $p) (i32.const 2)))))))
  (if (i32.ge_s (local.get $last) (i32.const 0)) (then (call $b.b_join (local.get $last))))
  (memory.fill (i32.const @FP_STASH) (i32.const 0) (i32.const 0x510)))

;; After every tick: a slot that's empty keeps no marshmallows; matches cut to
;; the playlist's length; a match that just ended counted, the game's last one
;; scored and held; a held result, once its time is up, the next game.
(func $fp_after
  (local $game i32) (local $state i32) (local $t i32) (local $p i32) (local $n i32)
  (local.set $game (i32.load (i32.const @FP_GAME)))
  (local.set $state (i32.load (i32.const @HDR_STATE)))
  (local.set $t (i32.load (i32.const @HDR_TICK)))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (if (i32.eqz (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $p) (i32.const 6))) (i32.const @PF_LIVE)))
      (then
        (!st u16 @FP_MALLOWS (local.get $p) (i32.const 0))
        (!st u8 @FP_LAST (local.get $p) (i32.const 0))
        (!st u8 @FP_GOT (local.get $p) (i32.const 0)))))
  (if (i32.load (i32.const @FP_STAGE))
    (then
      (if (i32.ge_u (local.get $t) (i32.load (i32.const @FP_AT)))
        (then (call $fp_switch (!fpnext (local.get $game))
                               (call $g.hash32 (i32.load (i32.const @HDR_RNG)) (i32.load16_u (i32.const @(FP_COUNT + 2))) (i32.const 0x46495245)))))
      (return)))
  (if (i32.eq (local.get $state) (i32.const @H_PLAY))
    (then
      (if (i32.eq (local.get $game) (i32.const @G_ARENA))
        (then (call $fp_cut (i32.const @FP_ARENA_TICKS))))
      (if (i32.eq (local.get $game) (i32.const @G_GOLF))
        (then (call $fp_cut (i32.const @FP_GOLF_TICKS))))))
  (if (i32.and (i32.eq (local.get $state) (i32.const @H_OVER))
               (i32.ne (i32.load8_u (i32.const @(FP_COUNT + 1))) (i32.const @H_OVER)))
    (then
      (local.set $n (i32.add (i32.load8_u (i32.const @FP_COUNT)) (i32.const 1)))
      (i32.store8 (i32.const @FP_COUNT) (local.get $n))
      (if (i32.ge_u (local.get $n) (!fpmatches (local.get $game)))
        (then
          (call $fp_award (local.get $game))
          (i32.store (i32.const @FP_STAGE) (i32.const 1))
          (i32.store (i32.const @FP_AT) (i32.add (local.get $t) (i32.const @FP_HOLD)))
          ;; the game's own scoreboard would start it again: it waits for us instead
          (i32.store (i32.const @HDR_UNTIL) (i32.const -1))))))
  (i32.store8 (i32.const @(FP_COUNT + 1)) (local.get $state)))

;; A match no longer than `len` ticks from its start.
(func $fp_cut (param $len i32)
  (if (i32.gt_u (i32.sub (i32.load (i32.const @HDR_UNTIL)) (i32.load (i32.const @HDR_START))) (local.get $len))
    (then (i32.store (i32.const @HDR_UNTIL) (i32.add (i32.load (i32.const @HDR_START)) (local.get $len))))))

;; How well slot p did in this game, higher is better, or -1 if it wasn't in it:
;; golf, fewest strokes on the hole (with the penalty for not finishing);
;; the arena, most kills, then fewest deaths; bumper, most rounds won, then
;; KOs, then hard bumps (a ball that only watched isn't placed).
(func $fp_score (param $game i32) (param $p i32) (result i32)
  (local $pb i32) (local $k i32) (local $b i32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (if (i32.eqz (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_LIVE))) (then (return (i32.const -1))))
  (if (i32.eq (local.get $game) (i32.const @G_GOLF))
    (then (return (i32.sub (i32.const 0xffff) (!at u16 @(PLAYERS + P_SCORE) (local.get $pb))))))
  (if (i32.eq (local.get $game) (i32.const @G_ARENA))
    (then (return (i32.sub (i32.mul (!at u16 @(PLAYERS + A_KILLS) (local.get $pb)) (i32.const 0x10000)) (!at u16 @(PLAYERS + A_DEATHS) (local.get $pb))))))
  (if (i32.eqz (!at u16 @(PLAYERS + B_ROUNDS) (local.get $pb))) (then (return (i32.const -1))))
  (local.set $k (!at u16 @(PLAYERS + B_KOS) (local.get $pb)))
  (local.set $b (!at u16 @(PLAYERS + B_BUMPS) (local.get $pb)))
  (i32.add (i32.add (i32.mul (!at u16 @(PLAYERS + B_WINS) (local.get $pb)) (i32.const 0x100000))
                    (i32.mul (select (local.get $k) (i32.const 0xff) (i32.lt_u (local.get $k) (i32.const 0xff))) (i32.const 0x1000)))
           (select (local.get $b) (i32.const 0xfff) (i32.lt_u (local.get $b) (i32.const 0xfff)))))

;; Places for everyone who played (ties share the better one), and
;; marshmallows: 3 for first, 2 for second, 1 for third.
(func $fp_award (param $game i32)
  (local $p i32) (local $q i32) (local $s i32) (local $rank i32) (local $got i32)
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $s (call $fp_score (local.get $game) (local.get $p)))
    (!st u8 @FP_LAST (local.get $p) (i32.const 0))
    (!st u8 @FP_GOT (local.get $p) (i32.const 0))
    (if (i32.ge_s (local.get $s) (i32.const 0))
      (then
        (local.set $rank (i32.const 1))
        (!for $q (i32.const 0) (i32.const @NPLAYER)
          (if (i32.gt_s (call $fp_score (local.get $game) (local.get $q)) (local.get $s)) (then (!inc $rank))))
        (local.set $got (select (i32.sub (i32.const 4) (local.get $rank)) (i32.const 0) (i32.le_u (local.get $rank) (i32.const 3))))
        (!st u8 @FP_LAST (local.get $p) (select (local.get $rank) (i32.const 255) (i32.lt_u (local.get $rank) (i32.const 255))))
        (!st u8 @FP_GOT (local.get $p) (local.get $got))
        (!st u16 @FP_MALLOWS (local.get $p) (i32.add (!ld u16 @FP_MALLOWS (local.get $p)) (local.get $got)))))))
