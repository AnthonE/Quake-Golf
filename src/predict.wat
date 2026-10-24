;; The prediction layer. The header, players and projectiles are copied to
;; PRED, then slot p and only its projectiles step through the n input words
;; at PWORDS, in the same order and by the same code as a confirmed tick (the
;; bank offset PRED_D points every record access at the copy). Balls and other
;; players stay as confirmed: a ghost reads them but never pushes or blasts
;; them, so this writes nothing outside PRED. After predicted tick k,
;; PTRACK[k] holds the player's position and the tick reached.
(func (export "predict") (param $p i32) (param $n i32)
  (local $k i32) (local $pb i32) (local $t i32) (local $o i32)
  (memory.copy (i32.const @PRED) (i32.const @REGION) (i32.const @PRED_COPY))
  (i32.store (i32.const @PFX) (i32.const 0))
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (i32.const @PRED_D)))
  (if (i32.eqz (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_LIVE))) (then (return)))
  (if (i32.gt_u (local.get $n) (i32.const @PRED_MAX)) (then (local.set $n (i32.const @PRED_MAX))))
  (!for $k (i32.const 0) (local.get $n)
    (!put i32 @(PLAYERS + P_IN) (local.get $pb) (!ld i32 @PWORDS (local.get $k)))
#if BUMPER
    ;; a ball's own roll and power-ups; bumps, blasts and rockets are the confirmed world's
    (call $b_move (local.get $p) (i32.const @PRED_D))
#else
    (call $move (local.get $p) (i32.const @PRED_D))
    (call $projectiles (i32.const @PRED_D) (local.get $p))
#endif
    ;; the countdown ends on time here too, so the first shot at tee-off is predicted
    (local.set $t (i32.load (i32.const @(HDR_TICK + PRED_D))))
    (if (i32.and (i32.eq (i32.load (i32.const @(HDR_STATE + PRED_D))) (i32.const @H_COUNT))
                 (i32.ge_u (local.get $t) (i32.load (i32.const @(HDR_UNTIL + PRED_D)))))
      (then
        (i32.store (i32.const @(HDR_STATE + PRED_D)) (i32.const @H_PLAY))
        (i32.store (i32.const @(HDR_START + PRED_D)) (local.get $t))
#if ARENA
        (i32.store (i32.const @(HDR_UNTIL + PRED_D)) (i32.add (local.get $t) (i32.const @MATCH_TICKS)))))
#else
#if BUMPER
        (i32.store (i32.const @(HDR_UNTIL + PRED_D)) (i32.add (local.get $t) (i32.const @ROUND_TICKS)))))
#else
        (i32.store (i32.const @(HDR_UNTIL + PRED_D)) (i32.add (local.get $t) (i32.const @LIMIT_TICKS)))))
#endif
#endif
    (local.set $t (i32.add (local.get $t) (i32.const 1)))
    (i32.store (i32.const @(HDR_TICK + PRED_D)) (local.get $t))
    (local.set $o (i32.add (i32.const @PTRACK) (i32.shl (local.get $k) (i32.const 4))))
    (f32.store (local.get $o) (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
    (f32.store offset=4 (local.get $o) (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
    (f32.store offset=8 (local.get $o) (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
    (i32.store offset=12 (local.get $o) (local.get $t))))
