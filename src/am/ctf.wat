;; CAPTURE THE FLAG (M_CTF, prefix cf; constants in src/am/ctf.mjs). A stub
;; for now: its hooks are correct no-ops, so a match of it is red against
;; blue to the clock with AH_TARGET set and nothing to capture.
;;
;; What it will do (the design's section): a flag on each side's stand
;; (MAP_FLAGS, red's then blue's: x, z, top; $stand gives its feet height),
;; each home, carried by a slot, or dropped (where, and CF_RETURN ticks to go),
;; laid out in AO (its fields in ctf.mjs). Hooks to fill:
;;   $cf_start: both flags home; AH_TARGET = CF_CAPS (done).
;;   $cf_tick, every tick of play, slot order: a carried flag follows its
;;     carrier; a carrier of the enemy flag within CF_CAP_R of its own stand
;;     while its own is home captures ($a_score 1, MR_POINTS + 1, both home,
;;     $a_carry off, news); a home or dropped flag touched ($a_near within
;;     CF_TOUCH_R across, CF_TOUCH_H up or down) by the first $a_alive
;;     fighter in slot order not carrying: an enemy takes it ($a_carry on,
;;     news), its own side returns a dropped one (MR_AUX + 1, news); a dropped
;;     flag whose CF_RETURN runs out goes home; a carrier no longer live or
;;     no longer carrying (it left: P_FL & (PF_LIVE | PF_DEAD | PF_CARRY) is
;;     not PF_LIVE | PF_CARRY) drops it where it was. 0 (the core ends the
;;     match at AH_TARGET and the clock).
;;   $cf_kill: a carrier (PF_CARRY still set; the core clears it after)
;;     drops its flag at its feet, CF_RETURN to go.

(func $cf_start
  (i32.store (i32.const @AH_TARGET) (i32.const @CF_CAPS)))

(func $cf_tick (result i32)
  (i32.const 0))

(func $cf_kill (param $q i32) (param $a i32) (param $cause i32))
