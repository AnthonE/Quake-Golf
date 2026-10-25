;; TEAM SLAYER (M_SLAYER, prefix ts; constants in src/am/slayer.mjs): red
;; against blue, every kill of an enemy a point for the killer's side, a death
;; by your own hand (a suicide, your own frag or rocket) a point off yours,
;; never below 0. The core ends the match at AH_TARGET or the clock and says
;; who won; the scores are AH_SCORE and each fighter's kills its A_KILLS, so
;; it keeps nothing in AO. The kit's worked example (arena.wat's modes
;; section): three hooks, on the confirmed world, serial.

;; Play begins: the target, TS_PER for each fighter on the larger side (as
;; the core counted them this tick, AH_TEAMN), at least TS_MIN.
(func $ts_start
  (local $n i32)
  (local.set $n (i32.load (i32.const @AH_TEAMN)))
  (if (i32.gt_u (i32.load (i32.const @(AH_TEAMN + 4))) (local.get $n)) (then (local.set $n (i32.load (i32.const @(AH_TEAMN + 4))))))
  (local.set $n (i32.mul (local.get $n) (i32.const @TS_PER)))
  (i32.store (i32.const @AH_TARGET) (select (local.get $n) (i32.const @TS_MIN) (i32.gt_u (local.get $n) (i32.const @TS_MIN)))))

;; Nothing runs between kills.
(func $ts_tick (result i32)
  (i32.const 0))

;; q died at a's hand: a point for a's side (none if a has left since its
;; shot), or one off q's own by its own hand; news when that puts a side
;; ahead that wasn't (owner whoever did it).
(func $ts_kill (param $q i32) (param $a i32) (param $cause i32)
  (local $was i32) (local $lead i32)
  (local.set $was (call $a_lead))
  (if (i32.eq (local.get $a) (local.get $q))
    (then (call $a_score (call $a_team (local.get $q)) (i32.const -1)))
    (else
      (if (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $a) (i32.const 6))) (i32.const @PF_LIVE))
        (then (call $a_score (call $a_team (local.get $a)) (i32.const 1))))))
  (local.set $lead (call $a_lead))
  (if (i32.and (i32.ne (local.get $lead) (i32.const 0)) (i32.ne (local.get $lead) (local.get $was)))
    (then (call $a_news (i32.const @TS_MX_LEAD) (local.get $a) (local.get $lead)))))

;; No spawn point is barred.
(func $ts_bar (param $x f32) (param $y f32) (param $z f32) (result i32)
  (i32.const 0))
