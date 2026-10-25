;; KING OF THE HILL (M_HILL, prefix hl; constants in src/am/hill.mjs). A stub
;; for now: its hooks are correct no-ops, so a match of it is red against blue
;; to the clock with AH_TARGET set and no hill.
;;
;; What it will do (the design's section): one hill at a time, a circle at one
;; of the map's hill points (MAP_NHILL of them at MAP_HILLS: x, z, top,
;; radius; $stand gives the point's height), moving every HL_MOVE ticks in an
;; order drawn by $rand as play starts (each once before any twice, never the
;; same twice running), laid out in AO (its fields in hill.mjs). Hooks to fill:
;;   $hl_start: the order and the first hill; AH_TARGET = HL_TARGET (done).
;;   $hl_tick, every tick of play: the hill moves on when its time is up
;;     (news); each side's $a_alive fighters on it ($a_near within its radius
;;     across, HL_H up or down of its height); the side with more holds it
;;     (none on it: nobody; as many each and some: contested, nobody scores;
;;     news as it changes hands); the holder counts ticks, and each full
;;     second $a_score 1 and MR_POINTS + 1 for each of its fighters on it. 0
;;     (the core ends the match at AH_TARGET and the clock).
;;   $hl_kill: nothing (a death just leaves the hill).

(func $hl_start
  (i32.store (i32.const @AH_TARGET) (i32.const @HL_TARGET)))

(func $hl_tick (result i32)
  (i32.const 0))

(func $hl_kill (param $q i32) (param $a i32) (param $cause i32))
