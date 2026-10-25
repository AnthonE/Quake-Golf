;; HEADHUNTER (M_HEADHUNT, prefix hh; constants in src/am/headhunter.mjs). A
;; stub for now: its hooks are correct no-ops but the target, so a match of
;; it is red against blue to the clock with nothing to bank.
;;
;; What it will do: piles of skulls (where, how many, HH_LIFE to go) and the
;; zone (its index in MAP_HILLS, when it moves, its centre) laid out in AO;
;; the skulls each fighter carries in its MODE_REC (MR_AUX), its banked ones
;; MR_POINTS. Hooks to fill:
;;   $hh_start: the zone at a hill drawn from the PRNG; the target (done).
;;   $hh_tick: piles touched by the first $a_alive fighter in slot order go
;;     to it; a carrier in the zone banks ($a_score, MR_POINTS, news); piles
;;     run out; the zone moves on HH_MOVE (news). 0.
;;   $hh_kill: the dead fighter's skulls and one more in a pile at its feet.
;;   $hh_bar: nothing barred.

;; Play begins: the target, HH_PER for each fighter on the larger side, at least HH_MIN.
(func $hh_start
  (local $n i32)
  (local.set $n (i32.load (i32.const @AH_TEAMN)))
  (if (i32.gt_u (i32.load (i32.const @(AH_TEAMN + 4))) (local.get $n)) (then (local.set $n (i32.load (i32.const @(AH_TEAMN + 4))))))
  (local.set $n (i32.mul (local.get $n) (i32.const @HH_PER)))
  (i32.store (i32.const @AH_TARGET) (select (local.get $n) (i32.const @HH_MIN) (i32.gt_u (local.get $n) (i32.const @HH_MIN)))))

(func $hh_tick (result i32)
  (i32.const 0))

(func $hh_kill (param $q i32) (param $a i32) (param $cause i32))

(func $hh_bar (param $x f32) (param $y f32) (param $z f32) (result i32)
  (i32.const 0))
