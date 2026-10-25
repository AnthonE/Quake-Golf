;; ASSAULT (M_ASSAULT, prefix as; constants in src/am/assault.mjs). A stub
;; for now: its hooks are correct no-ops but the target, so a match of it is
;; red against blue to the clock with no bomb.
;;
;; What it will do: the bomb (where, home, carried, dropped or planted, its
;; carrier, the timers to plant, go off, defuse and return) laid out in AO;
;; each fighter's bombs gone off its MR_POINTS, its defuses MR_AUX. Hooks to
;; fill:
;;   $as_start: the bomb at its spot (MAP_BALL); the target (done).
;;   $as_tick: taken by the first $a_alive fighter in slot order to touch it
;;     ($a_carry on, news); a carrier on the other side's plate for AS_ARM
;;     plants it ($a_carry off, news); a planted bomb goes off after AS_FUSE
;;     ($a_score, news) unless one of the plate's side stands on it
;;     AS_DEFUSE (news); a carrier gone drops it; a dropped one goes home
;;     after AS_RETURN. 0.
;;   $as_kill: a carrier (PF_CARRY still set) drops it at its feet.
;;   $as_bar: nothing barred.

;; Play begins: the target.
(func $as_start
  (i32.store (i32.const @AH_TARGET) (i32.const @AS_TARGET)))

(func $as_tick (result i32)
  (i32.const 0))

(func $as_kill (param $q i32) (param $a i32) (param $cause i32))

(func $as_bar (param $x f32) (param $y f32) (param $z f32) (result i32)
  (i32.const 0))
