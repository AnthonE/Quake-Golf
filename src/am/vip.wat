;; VIP (M_VIP, prefix vp; constants and the VIPs' fields in AO in
;; src/am/vip.mjs): each side has a VIP, its slot + 1 in AO (VP_VIP), drawn
;; by $rand from the side's fighters alive as play starts, with its shields
;; at OVERSHIELD and its health full (the shields recharge only to 100, as
;; the juggernaut's). The other side's VIP killed is a point for the
;; killer's side, and one for the killer (MR_POINTS) if it is still in the
;; room; a VIP's death by its own hand is a point for the other side; no
;; other kill scores. A side whose VIP died or left draws its next VP_REDRAW
;; ticks after, passing over the last one if anyone else on the side is
;; alive (MR_AUX counts each fighter's turns as VIP). None of it is in P_FL:
;; the prediction needs none (the overshield is just shields). The core ends
;; the match at AH_TARGET or the clock. News (FX_MODE at the VIP's feet): a
;; VIP drawn, a VIP killed, a VIP gone.

;; Play begins: red's VIP drawn, then blue's (AO was zeroed at the pick:
;; nobody's last, no wait); the target.
(func $vp_start
  (call $vp_draw (i32.const 0))
  (call $vp_draw (i32.const 1))
  (i32.store (i32.const @AH_TARGET) (i32.const @VP_TARGET)))

;; Every tick of play, red's side then blue's: a VIP no longer alive in the
;; room on its side as drawn (it left; its slot joined again, its record
;; cleared; a death the kill hook didn't see) is gone, VP_REDRAW to the
;; side's next; a side without one counts down, and draws on the tick the
;; count is 0 (VP_REDRAW ticks counting the one it lost its VIP on; a side
;; with nobody alive to draw tries every tick).
(func $vp_tick (result i32)
  (local $s i32) (local $v i32) (local $a i32) (local $n i32)
  (!for $s (i32.const 0) (i32.const 2)
    (local.set $v (i32.load8_u offset=@(AO + VP_VIP) (local.get $s)))
    (if (local.get $v)
      (then
        (local.set $v (i32.sub (local.get $v) (i32.const 1)))
        (if (i32.eqz (i32.and (call $a_alive (local.get $v)) (call $vp_was (local.get $v) (local.get $s))))
          (then
            (call $vp_lose (local.get $s) (local.get $v))
            (call $vp_news (i32.const @VP_MX_GONE) (local.get $v) (local.get $s) (local.get $v))))))
    (if (i32.eqz (i32.load8_u offset=@(AO + VP_VIP) (local.get $s)))
      (then
        (local.set $a (i32.add (i32.const @(AO + VP_LEFT)) (i32.shl (local.get $s) (i32.const 1))))
        (local.set $n (i32.load16_u (local.get $a)))
        (if (local.get $n)
          (then
            (local.set $n (i32.sub (local.get $n) (i32.const 1)))
            (i32.store16 (local.get $a) (local.get $n))))
        (if (i32.eqz (local.get $n)) (then (call $vp_draw (local.get $s)))))))
  (i32.const 0))

;; q died at a's hand: if q was its side's VIP, the side has none now and the
;; other side scores, by a's hand or q's own; a point of its own for a, if a
;; is someone else still in the room on the other side. News: owner a, shot
;; q (+ 256 for blue's). Any other death scores nothing.
(func $vp_kill (param $q i32) (param $a i32) (param $cause i32)
  (local $s i32) (local $r i32)
  (local.set $s (call $a_team (local.get $q)))
  (if (i32.or (i32.ne (i32.load8_u offset=@(AO + VP_VIP) (local.get $s)) (i32.add (local.get $q) (i32.const 1)))
              (i32.eqz (call $vp_was (local.get $q) (local.get $s))))
    (then (return)))
  (call $vp_lose (local.get $s) (local.get $q))
  (call $a_score (i32.sub (i32.const 1) (local.get $s)) (i32.const 1))
  (if (i32.and (i32.ne (local.get $a) (local.get $q))
               (i32.and (i32.ne (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $a) (i32.const 6))) (i32.const @PF_LIVE)) (i32.const 0))
                        (i32.ne (call $a_team (local.get $a)) (local.get $s))))
    (then
      (local.set $r (i32.shl (local.get $a) (i32.const 3)))
      (i32.store16 offset=@(MODE_REC + MR_POINTS) (local.get $r)
        (i32.add (i32.load16_u offset=@(MODE_REC + MR_POINTS) (local.get $r)) (i32.const 1)))))
  (call $vp_news (i32.const @VP_MX_KILL) (local.get $a) (i32.or (local.get $q) (i32.shl (local.get $s) (i32.const 8))) (local.get $q)))

;; Nothing barred.
(func $vp_bar (param $x f32) (param $y f32) (param $z f32) (result i32)
  (i32.const 0))

;; 1 if slot p, on side s, is the fighter drawn: a join since would have
;; cleared its record, and every VIP drawn has a turn in MR_AUX.
(func $vp_was (param $p i32) (param $s i32) (result i32)
  (i32.and (i32.eq (call $a_team (local.get $p)) (local.get $s))
           (i32.ne (i32.load16_u offset=@(MODE_REC + MR_AUX) (i32.shl (local.get $p) (i32.const 3))) (i32.const 0))))

;; Side s's VIP, slot p, is no more: none now, p its last, VP_REDRAW to the next.
(func $vp_lose (param $s i32) (param $p i32)
  (i32.store8 offset=@(AO + VP_VIP) (local.get $s) (i32.const 0))
  (i32.store8 offset=@(AO + VP_LAST) (local.get $s) (i32.add (local.get $p) (i32.const 1)))
  (i32.store16 offset=@(AO + VP_LEFT) (i32.shl (local.get $s) (i32.const 1)) (i32.const @VP_REDRAW)))

;; 1 if slot p could be side s's next VIP: alive, on s, and not slot `last` - 1.
(func $vp_can (param $p i32) (param $s i32) (param $last i32) (result i32)
  (i32.and (i32.and (call $a_alive (local.get $p)) (i32.eq (call $a_team (local.get $p)) (local.get $s)))
           (i32.ne (i32.add (local.get $p) (i32.const 1)) (local.get $last))))

;; Side s's next VIP: drawn by $rand from those that could be, in slot order,
;; passing over its last VIP if anyone else is alive; nobody alive, nobody
;; yet (the next tick tries again). Its shields OVERSHIELD, its health full,
;; its turn counted; news at its feet.
(func $vp_draw (param $s i32)
  (local $last i32) (local $c i32) (local $p i32) (local $pick i32) (local $pb i32) (local $r i32)
  (local.set $last (i32.load8_u offset=@(AO + VP_LAST) (local.get $s)))
  (block $counted
    (loop $again
      (local.set $c (i32.const 0))
      (!for $p (i32.const 0) (i32.const @NPLAYER)
        (if (call $vp_can (local.get $p) (local.get $s) (local.get $last)) (then (!inc $c))))
      (br_if $counted (i32.or (i32.ne (local.get $c) (i32.const 0)) (i32.eqz (local.get $last))))
      (local.set $last (i32.const 0))
      (br $again)))
  (if (i32.eqz (local.get $c)) (then (return)))
  (local.set $pick (i32.rem_u (call $rand) (local.get $c)))
  (block $found
    (!for $p (i32.const 0) (i32.const @NPLAYER)
      (if (call $vp_can (local.get $p) (local.get $s) (local.get $last))
        (then
          (br_if $found (i32.eqz (local.get $pick)))
          (local.set $pick (i32.sub (local.get $pick) (i32.const 1)))))))
  (i32.store8 offset=@(AO + VP_VIP) (local.get $s) (i32.add (local.get $p) (i32.const 1)))
  (local.set $r (i32.shl (local.get $p) (i32.const 3)))
  (i32.store16 offset=@(MODE_REC + MR_AUX) (local.get $r) (i32.add (i32.load16_u offset=@(MODE_REC + MR_AUX) (local.get $r)) (i32.const 1)))
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (!put u8 @(PLAYERS + A_SH) (local.get $pb) (i32.const @OVERSHIELD))
  (!put u8 @(PLAYERS + A_HP) (local.get $pb) (i32.const 100))
  (!put u16 @(PLAYERS + A_SHT) (local.get $pb) (i32.const 0))
  (call $vp_news (i32.const @VP_MX_DRAW) (local.get $p) (local.get $s) (local.get $p)))

;; News for the feed (FX_MODE: what as its size), at slot at's feet.
(func $vp_news (param $what i32) (param $owner i32) (param $shot i32) (param $at i32)
  (local $b i32)
  (local.set $b (i32.shl (local.get $at) (i32.const 6)))
  (call $fx (i32.const 0) (i32.const @FX_MODE) (local.get $owner) (local.get $shot)
            (!at f32 @(PLAYERS + P_PX) (local.get $b)) (!at f32 @(PLAYERS + P_PY) (local.get $b)) (!at f32 @(PLAYERS + P_PZ) (local.get $b))
            (f32.convert_i32_u (local.get $what))))
