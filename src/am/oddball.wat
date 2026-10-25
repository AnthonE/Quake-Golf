;; ODDBALL (M_ODDBALL, prefix ob; constants in src/am/oddball.mjs). A stub for
;; now: its hooks are correct no-ops, so a match of it is red against blue to
;; the clock with AH_TARGET set and no skull.
;;
;; What it will do (the design's section): one skull at the map's spot
;; (MAP_BALL: x, z, top; $stand gives its height), home, carried by a slot, or
;; dropped (where, and OB_RESET ticks before it goes back), laid out in AO
;; (its fields in oddball.mjs). Hooks to fill:
;;   $ob_start: the skull at its spot; AH_TARGET = OB_TARGET (done).
;;   $ob_tick, every tick of play: a carried skull follows its carrier and
;;     counts a tick for the carrier's side; each full second (125 ticks, per
;;     side) $a_score 1 and the carrier's MR_POINTS + 1; a home or dropped
;;     skull is taken ($a_carry on, news) by the first $a_alive fighter in
;;     slot order to touch it ($a_near within OB_TOUCH_R across, OB_TOUCH_H
;;     up or down), either side; a dropped one whose OB_RESET runs out goes
;;     back; a carrier no longer live or carrying (it left) drops it where it
;;     was. 0 (the core ends the match at AH_TARGET and the clock).
;;   $ob_kill: a carrier (PF_CARRY still set; the core clears it after)
;;     drops the skull at its feet, OB_RESET to go.

(func $ob_start
  (i32.store (i32.const @AH_TARGET) (i32.const @OB_TARGET)))

(func $ob_tick (result i32)
  (i32.const 0))

(func $ob_kill (param $q i32) (param $a i32) (param $cause i32))
