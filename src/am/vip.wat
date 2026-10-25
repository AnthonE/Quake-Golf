;; VIP (M_VIP, prefix vp; constants in src/am/vip.mjs). A stub for now: its
;; hooks are correct no-ops but the target, so a match of it is red against
;; blue to the clock with no VIP to kill.
;;
;; What it will do: each side's VIP (its slot + 1, 0 none) and when the next
;; is drawn laid out in AO; each fighter's VIP kills its MR_POINTS, its times
;; as VIP MR_AUX. Hooks to fill:
;;   $vp_start: each side's VIP drawn from its live fighters ($rand), its
;;     shields OVERSHIELD (news); the target (done).
;;   $vp_tick: a VIP gone (left, or dead) leaves its side without one; a side
;;     without one draws its next VP_REDRAW after (another fighter if it has
;;     one, news). 0.
;;   $vp_kill: the other side's VIP killed: a point for the killer's side
;;     (none for a death by its own hand), MR_POINTS (news).
;;   $vp_bar: nothing barred.

;; Play begins: the target.
(func $vp_start
  (i32.store (i32.const @AH_TARGET) (i32.const @VP_TARGET)))

(func $vp_tick (result i32)
  (i32.const 0))

(func $vp_kill (param $q i32) (param $a i32) (param $cause i32))

(func $vp_bar (param $x f32) (param $y f32) (param $z f32) (result i32)
  (i32.const 0))
