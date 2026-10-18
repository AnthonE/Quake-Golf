;; The cup and the hole clock. Serial, at the end of a tick, after the balls
;; move and their wakes land.
;;
;; idle -> (a join) countdown -> play -> (everyone in, or the limit) scoreboard
;; -> countdown on a fresh ball each ... and back to idle when the room empties.

(func $hole
  (local $p i32) (local $pb i32) (local $fl i32) (local $b i32) (local $live i32) (local $done i32)
  (local $state i32) (local $t i32) (local $dx f32) (local $dz f32) (local $score i32)
  (local.set $state (i32.load (i32.const @HDR_STATE)))
  (local.set $t (i32.load (i32.const @HDR_TICK)))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
    (if (i32.and (local.get $fl) (i32.const @PF_LIVE))
      (then
        (!inc $live)
        (local.set $b (!at i32 @(PLAYERS + P_BALL) (local.get $pb)))
        (if (i32.and (i32.eq (local.get $state) (i32.const @H_PLAY))
                     (i32.and (i32.eqz (i32.and (local.get $fl) (i32.const @PF_DONE))) (i32.ge_s (local.get $b) (i32.const 0))))
          (then
            ;; through the slipgate: inside the capture radius, low, and slow enough
            (local.set $dx (f32.sub (!ld f32 @PX (local.get $b)) (f32.load (i32.const @HDR_CUP))))
            (local.set $dz (f32.sub (!ld f32 @PZ (local.get $b)) (f32.load (i32.const @(HDR_CUP + 8)))))
            (if (i32.and (i32.and (i32.and (!ld u8 @FLAGS (local.get $b)) (i32.const @F_LIVE))
                                  (f32.lt (f32.add (f32.mul (local.get $dx) (local.get $dx)) (f32.mul (local.get $dz) (local.get $dz))) (f32.const @CUP_R2)))
                         (i32.and (f32.lt (!ld f32 @PY (local.get $b)) (f32.add (f32.load (i32.const @(HDR_CUP + 4))) (f32.const 0.7)))
                                  (f32.lt (!dot3 (!ld f32 @VX (local.get $b)) (!ld f32 @VY (local.get $b)) (!ld f32 @VZ (local.get $b))
                                                 (!ld f32 @VX (local.get $b)) (!ld f32 @VY (local.get $b)) (!ld f32 @VZ (local.get $b)))
                                          (f32.const @CUP_V2))))
              (then
                (call $fx (i32.const 0) (i32.const @FX_SINK) (local.get $p) (!at u16 @(PLAYERS + P_STROKES) (local.get $pb))
                          (f32.load (i32.const @HDR_CUP)) (f32.load (i32.const @(HDR_CUP + 4))) (f32.load (i32.const @(HDR_CUP + 8))) (f32.const 1))
                (!st u8 @FLAGS (local.get $b) (i32.const @F_SUNK))
                (!st u8 @SLEEP (local.get $b) (i32.const 0))
                (!st f32 @PX (local.get $b) (f32.load (i32.const @HDR_CUP)))
                (!st f32 @PY (local.get $b) (f32.sub (f32.load (i32.const @(HDR_CUP + 4))) (f32.const 1)))
                (!st f32 @PZ (local.get $b) (f32.load (i32.const @(HDR_CUP + 8))))
                (!st f32 @VX (local.get $b) (f32.const 0))
                (!st f32 @VY (local.get $b) (f32.const 0))
                (!st f32 @VZ (local.get $b) (f32.const 0))
                (local.set $fl (i32.or (local.get $fl) (i32.const @PF_DONE)))
                (!put u8 @(PLAYERS + P_FL) (local.get $pb) (local.get $fl))
                (!put i32 @(PLAYERS + P_DONE) (local.get $pb) (local.get $t))))))
        (if (i32.and (local.get $fl) (i32.const @PF_DONE)) (then (!inc $done))))))
  (i32.store (i32.const @HDR_LIVE) (local.get $live))
  (if (i32.eqz (local.get $live))
    (then (i32.store (i32.const @HDR_STATE) (i32.const @H_IDLE)) (return)))
  (if (i32.eq (local.get $state) (i32.const @H_COUNT))
    (then
      (if (i32.ge_u (local.get $t) (i32.load (i32.const @HDR_UNTIL)))
        (then
          (i32.store (i32.const @HDR_STATE) (i32.const @H_PLAY))
          (i32.store (i32.const @HDR_START) (local.get $t))
          (i32.store (i32.const @HDR_UNTIL) (i32.add (local.get $t) (i32.const @LIMIT_TICKS)))))
      (return)))
  (if (i32.eq (local.get $state) (i32.const @H_PLAY))
    (then
      (if (i32.or (i32.eq (local.get $done) (local.get $live)) (i32.ge_u (local.get $t) (i32.load (i32.const @HDR_UNTIL))))
        (then
          ;; the scoreboard: strokes, plus the penalty for anyone not in
          (!for $p (i32.const 0) (i32.const @NPLAYER)
            (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
            (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
            (if (i32.and (local.get $fl) (i32.const @PF_LIVE))
              (then
                (local.set $score (i32.add (!at u16 @(PLAYERS + P_STROKES) (local.get $pb))
                                           (select (i32.const 0) (i32.const @PENALTY) (i32.and (local.get $fl) (i32.const @PF_DONE)))))
                (!put u16 @(PLAYERS + P_SCORE) (local.get $pb) (local.get $score))
                (!put u16 @(PLAYERS + P_HOLES) (local.get $pb) (i32.add (!at u16 @(PLAYERS + P_HOLES) (local.get $pb)) (i32.const 1)))
                (!put i32 @(PLAYERS + P_TOTAL) (local.get $pb) (i32.add (!at i32 @(PLAYERS + P_TOTAL) (local.get $pb)) (local.get $score))))))
          (i32.store (i32.const @HDR_STATE) (i32.const @H_OVER))
          (i32.store (i32.const @HDR_UNTIL) (i32.add (local.get $t) (i32.const @OVER_TICKS)))))
      (return)))
  (if (i32.and (i32.eq (local.get $state) (i32.const @H_OVER)) (i32.ge_u (local.get $t) (i32.load (i32.const @HDR_UNTIL))))
    (then
      (i32.store (i32.const @HDR_HOLE) (i32.add (i32.load (i32.const @HDR_HOLE)) (i32.const 1)))
      (!for $p (i32.const 0) (i32.const @NPLAYER)
        (if (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $p) (i32.const 6))) (i32.const @PF_LIVE))
          (then (call $to_tee (local.get $p) (i32.const 1)))))
      (i32.store (i32.const @HDR_STATE) (i32.const @H_COUNT))
      (i32.store (i32.const @HDR_UNTIL) (i32.add (local.get $t) (i32.const @COUNT_TICKS))))))
