;; TERRITORIES (M_TERRITORY, prefix tr; constants in src/am/territories.mjs).
;; A stub for now: its hooks are correct no-ops but the target, so a match of
;; it is red against blue to the clock with nothing to take.
;;
;; What it will do: each of MAP_HILLS's points a territory (its centre, its
;; capture from -TR_CAP blue's to +TR_CAP red's, who holds it, each side's
;; fighters on it this tick) laid out in AO; each fighter's ticks on a
;; territory its side held its MR_POINTS. Hooks to fill:
;;   $tr_start: every territory neutral; the target (done).
;;   $tr_tick: count each side's $a_alive fighters on each; the side with
;;     more pushes its capture a tick; at TR_CAP it's theirs (news), back
;;     through 0 it's nobody's (news); every TR_POINT a point a territory
;;     held ($a_score). 0.
;;   $tr_kill: nothing.
;;   $tr_bar: nothing barred.

;; Play begins: the target.
(func $tr_start
  (i32.store (i32.const @AH_TARGET) (i32.const @TR_TARGET)))

(func $tr_tick (result i32)
  (i32.const 0))

(func $tr_kill (param $q i32) (param $a i32) (param $cause i32))

(func $tr_bar (param $x f32) (param $y f32) (param $z f32) (result i32)
  (i32.const 0))
