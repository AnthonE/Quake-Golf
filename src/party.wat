;; Party: bumper balls' ball, and every round a different minigame on its own
;; stage, built when BUMPER and PARTY are set (build/party/game.wasm).
;; bumper.wat keeps the ball's power-ups, bumps, blasts and rockets; this is
;; the rest: the round and its rotation, joins, the ball's roll over whatever
;; the minigame says is solid, outs and downs, places and points.
;;
;; A minigame is a file of hooks, $<prefix>_<hook> (src/mg/<key>.wat), called
;; through (!mg type hook args...) on PG_GAME: setup, spawn, start, ground,
;; push, tick, over and out. ground and push run in the ball's move on either
;; bank; the rest are the confirmed world's, serial, in slot order. Its state
;; is PG_H (the header, in the prediction's copy), PG_S and PG_BIG (hashed, in
;; every keyframe, not copied), PG_M and PG_SCORE in each ball's record.

#include "mg/thinice.wat"
#include "mg/color.wat"
#include "mg/sweep.wat"
#include "mg/light.wat"
#include "mg/bombs.wat"
#include "mg/wall.wat"
#include "mg/pads.wat"
#include "mg/hill.wat"
#include "mg/potato.wat"
#include "mg/coins.wat"
#include "mg/paint.wat"
#include "mg/race.wat"
#include "mg/chute.wat"
#include "mg/tag.wat"

;; ---- the room and the round

(func $bumper_gen (param $seed i32)
  ;; the sea, flat, far under every stage
  (memory.fill (i32.const @TERRAIN_H) (i32.const 0) (i32.const @(TERRAIN_END - TERRAIN_H)))
  (i32.store (i32.const @BH_WINNER) (i32.const 255))
  (i32.store (i32.const @PG_PREV) (i32.const 0xffff))
  (call $p_defaults)
  ;; a dev and gate hook: a seed with 0xA7 in its top byte plays only the minigame in its next
  (if (i32.eq (i32.shr_u (local.get $seed) (i32.const 24)) (i32.const 0xa7))
    (then (i32.store (i32.const @PG_FORCE) (i32.add (i32.and (i32.shr_u (local.get $seed) (i32.const 16)) (i32.const 0xff)) (i32.const 1))))))

;; The knobs as a round starts, before the minigame's setup turns them.
(func $p_defaults
  (i32.store (i32.const @PG_KIND) (i32.const @PK_OUT))
  (i32.store (i32.const @PG_LEN) (i32.const @ROUND_TICKS))
  (f32.store (i32.const @PG_FLOOR) (f32.const @PLAT_Y))
  (f32.store (i32.const @PG_SIZE) (f32.const 20))
  (f32.store (i32.const @PG_ACC) (f32.const 1))
  (f32.store (i32.const @PG_DRAG) (f32.const @B_DRAG))
  (f32.store (i32.const @PG_IDLE) (f32.const @B_DRAG))
  (f32.store (i32.const @PG_HOP) (f32.const @B_HOP))
  (i32.store (i32.const @PG_RESPAWN) (i32.const 250))
  (i32.store (i32.const @PG_FLAGS) (i32.const @PGF_BUMPS))
  (f32.store (i32.const @PG_CX) (f32.const @B_CX))
  (memory.fill (i32.const @PG_H) (i32.const 0) (i32.const @PG_H_SIZE)))

;; The next round's minigame: PG_FORCE's, else any but the last two played,
;; from the PRNG. PG_PREV remembers it.
(func $p_pick (result i32)
  (local $prev i32) (local $f i32) (local $g i32) (local $m i32) (local $r i32)
  (local.set $prev (i32.load (i32.const @PG_PREV)))
  (local.set $f (i32.load (i32.const @PG_FORCE)))
  (if (i32.and (i32.ne (local.get $f) (i32.const 0)) (i32.le_u (local.get $f) (i32.const @NMG)))
    (then (local.set $g (i32.sub (local.get $f) (i32.const 1))))
    (else
      (!for $g (i32.const 0) (i32.const @NMG)
        (if (i32.and (i32.ne (local.get $g) (i32.and (local.get $prev) (i32.const 255)))
                     (i32.ne (local.get $g) (i32.and (i32.shr_u (local.get $prev) (i32.const 8)) (i32.const 255))))
          (then (!inc $m))))
      (local.set $r (i32.rem_u (call $rand) (local.get $m)))
      (block $found
        (!for $g (i32.const 0) (i32.const @NMG)
          (if (i32.and (i32.ne (local.get $g) (i32.and (local.get $prev) (i32.const 255)))
                       (i32.ne (local.get $g) (i32.and (i32.shr_u (local.get $prev) (i32.const 8)) (i32.const 255))))
            (then
              (br_if $found (i32.eqz (local.get $r)))
              (local.set $r (i32.sub (local.get $r) (i32.const 1)))))))))
  (i32.store (i32.const @PG_PREV) (i32.and (i32.or (i32.shl (local.get $prev) (i32.const 8)) (local.get $g)) (i32.const 0xffff)))
  (local.get $g))

;; Lays a round out for the balls in the room: a new minigame if pick (the
;; countdown's re-lays for a newcomer keep it), its state wiped, the knobs at
;; their defaults, the minigame's setup, and every ball on its spawn, still,
;; in slot order.
(func $p_round (param $pick i32)
  (local $p i32) (local $pb i32) (local $n i32) (local $k i32) (local $x f32) (local $y f32) (local $z f32)
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (!put u16 @(PLAYERS + PG_SCORE) (local.get $pb) (i32.const 0))
    (!put i32 @(PLAYERS + PG_M) (local.get $pb) (i32.const 0))
    (if (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_LIVE)) (then (!inc $n))))
  (i32.store (i32.const @BH_N0) (local.get $n))
  (if (local.get $pick) (then (i32.store (i32.const @PG_GAME) (call $p_pick))))
  (memory.fill (i32.const @PG_S) (i32.const 0) (i32.const @PG_S_SIZE))
  (memory.fill (i32.const @PG_BIG) (i32.const 0) (i32.const @PG_BIG_SIZE))
  (memory.fill (i32.const @PROJ) (i32.const 0) (i32.const @(NPROJ * JSIZE)))
  (call $p_defaults)
  (!mg none setup (local.get $n))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (if (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $p) (i32.const 6))) (i32.const @PF_LIVE))
      (then
        (!mg f32 f32 f32 spawn (local.get $k) (local.get $n))
        (local.set $z) (local.set $y) (local.set $x)
        (call $p_place (local.get $p) (local.get $x) (local.get $y) (local.get $z))
        (call $p_fresh (local.get $p))
        (!inc $k)))))

;; Slot p's ball still on the ground at (x, y, z), y its bottom; a press it
;; has already made doesn't fire.
(func $p_place (param $p i32) (param $x f32) (param $y f32) (param $z f32)
  (local $pb i32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (!put f32 @(PLAYERS + P_PX) (local.get $pb) (local.get $x))
  (!put f32 @(PLAYERS + P_PY) (local.get $pb) (local.get $y))
  (!put f32 @(PLAYERS + P_PZ) (local.get $pb) (local.get $z))
  (!put f32 @(PLAYERS + P_VX) (local.get $pb) (f32.const 0))
  (!put f32 @(PLAYERS + P_VY) (local.get $pb) (f32.const 0))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (f32.const 0))
  (!put u8 @(PLAYERS + P_FL) (local.get $pb) (i32.const @(PF_LIVE | PF_GROUND)))
  (!put u8 @(PLAYERS + P_FIRED) (local.get $pb) (i32.and (i32.shr_u (!at i32 @(PLAYERS + P_IN) (local.get $pb)) (i32.const 29)) (i32.const 3)))
  (!put u16 @(PLAYERS + P_REFIRE) (local.get $pb) (i32.const 0)))

;; Slot p's round fields cleared: nothing held, nobody's hit, no place, no score.
(func $p_fresh (param $p i32)
  (local $pb i32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (!put u8 @(PLAYERS + B_ITEM) (local.get $pb) (i32.const 0))
  (!put u8 @(PLAYERS + B_HOLE) (local.get $pb) (i32.const 0))
  (!put u16 @(PLAYERS + B_MEGA) (local.get $pb) (i32.const 0))
  (!put u16 @(PLAYERS + B_DASH) (local.get $pb) (i32.const 0))
  (!put u8 @(PLAYERS + B_HITBY) (local.get $pb) (i32.const 255))
  (!put u16 @(PLAYERS + B_HITT) (local.get $pb) (i32.const 0))
  (!put u8 @(PLAYERS + B_PLACE) (local.get $pb) (i32.const 0))
  (!put u16 @(PLAYERS + PG_SCORE) (local.get $pb) (i32.const 0))
  (!put i32 @(PLAYERS + PG_M) (local.get $pb) (i32.const 0)))

;; PK_SCORE: slot p back in (or in for the first time) at a spawn point 6 m
;; up, falling in.
(func $p_respawn (param $p i32)
  (local $pb i32) (local $x f32) (local $y f32) (local $z f32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (!mg f32 f32 f32 spawn (i32.and (call $rand) (i32.const 1023)) (i32.const 1024))
  (local.set $z) (local.set $y) (local.set $x)
  (call $p_place (local.get $p) (local.get $x) (f32.add (local.get $y) (f32.const 6)) (local.get $z))
  (!put u8 @(PLAYERS + P_FL) (local.get $pb) (i32.const @PF_LIVE))
  (!put u8 @(PLAYERS + B_HITBY) (local.get $pb) (i32.const 255))
  (!put u16 @(PLAYERS + B_HITT) (local.get $pb) (i32.const 0)))

;; A join. The first starts the countdown and picks the minigame; in the
;; countdown the round is laid out again with the newcomer in it; in play a
;; PK_SCORE game's newcomer falls straight in, and a PK_OUT game's watches
;; from high over the centre until the next round, as one does through the
;; result.
(func $b_join (param $p i32)
  (local $pb i32) (local $state i32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (local.set $state (i32.load (i32.const @HDR_STATE)))
  (if (i32.eq (local.get $state) (i32.const @H_IDLE))
    (then
      (i32.store (i32.const @HDR_STATE) (i32.const @H_COUNT))
      (i32.store (i32.const @HDR_UNTIL) (i32.add (i32.load (i32.const @HDR_TICK)) (i32.const @P_COUNT)))
      (call $p_round (i32.const 1))
      (return)))
  (if (i32.eq (local.get $state) (i32.const @H_COUNT)) (then (call $p_round (i32.const 0)) (return)))
  (call $p_fresh (local.get $p))
  (if (i32.and (i32.eq (local.get $state) (i32.const @H_PLAY)) (i32.eq (i32.load (i32.const @PG_KIND)) (i32.const @PK_SCORE)))
    (then (call $p_respawn (local.get $p)) (return)))
  (call $p_place (local.get $p) (f32.load (i32.const @PG_CX)) (f32.const @(+PLAT_Y + 20)) (f32.load (i32.const @PG_CX)))
  (!put u8 @(PLAYERS + P_FL) (local.get $pb) (i32.const @(PF_LIVE | PF_DEAD))))

;; ---- a ball's own tick, on bank d

;; Bumper's roll with the round's knobs (PG_ACC, PG_DRAG, PG_IDLE, PG_HOP),
;; held up by whatever the minigame's ground says is solid under its centre:
;; it rolls up onto anything within P_STEP of its bottom and lands on what it
;; falls onto. A ball under the lowest floor is going out (PF_FALL: no push,
;; no support, no bumps). Then the minigame's push on the ball.
(func $b_move (param $p i32) (param $d i32)
  (local $pb i32) (local $in i32) (local $fl i32) (local $ctr i32) (local $re i32) (local $item i32) (local $n i32)
  (local $s f32) (local $c f32) (local $fwd f32) (local $side f32) (local $wx f32) (local $wz f32) (local $len f32) (local $acc f32) (local $drag f32)
  (local $px f32) (local $py f32) (local $pz f32) (local $vx f32) (local $vy f32) (local $vz f32) (local $sp f32) (local $scale f32)
  (local $y0 f32) (local $top f32)
  (local.set $pb (i32.add (i32.shl (local.get $p) (i32.const 6)) (local.get $d)))
  (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
  (local.set $in (!at i32 @(PLAYERS + P_IN) (local.get $pb)))
  (local.set $ctr (i32.and (i32.shr_u (local.get $in) (i32.const 29)) (i32.const 3)))
  ;; out, or the round not rolling (the countdown, the result): nothing moves, a press is dropped
  (if (i32.or (i32.and (local.get $fl) (i32.const @PF_DEAD)) (i32.ne (i32.load offset=@HDR_STATE (local.get $d)) (i32.const @H_PLAY)))
    (then (!put u8 @(PLAYERS + P_FIRED) (local.get $pb) (local.get $ctr)) (return)))
  (local.set $re (!at u16 @(PLAYERS + P_REFIRE) (local.get $pb)))
  (if (local.get $re)
    (then (local.set $re (i32.sub (local.get $re) (i32.const 1))) (!put u16 @(PLAYERS + P_REFIRE) (local.get $pb) (local.get $re))))
  (local.set $n (!at u16 @(PLAYERS + B_MEGA) (local.get $pb)))
  (if (local.get $n) (then (!put u16 @(PLAYERS + B_MEGA) (local.get $pb) (i32.sub (local.get $n) (i32.const 1)))))
  (local.set $n (!at u16 @(PLAYERS + B_DASH) (local.get $pb)))
  (if (local.get $n) (then (!put u16 @(PLAYERS + B_DASH) (local.get $pb) (i32.sub (local.get $n) (i32.const 1)))))
  (call $sincos (local.get $in))
  (local.set $c) (local.set $s)
  ;; a press with a power-up held and the refire clear uses it; a press with none is dropped
  (if (i32.ne (local.get $ctr) (!at u8 @(PLAYERS + P_FIRED) (local.get $pb)))
    (then
      (local.set $item (!at u8 @(PLAYERS + B_ITEM) (local.get $pb)))
      (if (i32.eqz (local.get $item))
        (then (!put u8 @(PLAYERS + P_FIRED) (local.get $pb) (local.get $ctr)))
        (else
          (if (i32.eqz (local.get $re))
            (then
              (!put u8 @(PLAYERS + P_FIRED) (local.get $pb) (local.get $ctr))
              (!put u16 @(PLAYERS + P_REFIRE) (local.get $pb) (i32.const @USE_REFIRE))
              (call $b_use (local.get $p) (local.get $d) (local.get $item) (local.get $s) (local.get $c))))))))
  (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
  ;; where the keys push it: forward (c, s), right (-s, c)
  (local.set $fwd (f32.convert_i32_s (i32.sub (i32.and (i32.shr_u (local.get $in) (i32.const 24)) (i32.const 1))
                                              (i32.and (i32.shr_u (local.get $in) (i32.const 25)) (i32.const 1)))))
  (local.set $side (f32.convert_i32_s (i32.sub (i32.and (i32.shr_u (local.get $in) (i32.const 27)) (i32.const 1))
                                               (i32.and (i32.shr_u (local.get $in) (i32.const 26)) (i32.const 1)))))
  (local.set $wx (f32.sub (f32.mul (local.get $c) (local.get $fwd)) (f32.mul (local.get $s) (local.get $side))))
  (local.set $wz (f32.add (f32.mul (local.get $s) (local.get $fwd)) (f32.mul (local.get $c) (local.get $side))))
  (local.set $len (f32.sqrt (f32.add (f32.mul (local.get $wx) (local.get $wx)) (f32.mul (local.get $wz) (local.get $wz)))))
  (if (f32.gt (local.get $len) (f32.const 0))
    (then
      (local.set $wx (f32.div (local.get $wx) (local.get $len)))
      (local.set $wz (f32.div (local.get $wz) (local.get $len)))))
  (local.set $px (!at f32 @(PLAYERS + P_PX) (local.get $pb)))
  (local.set $py (!at f32 @(PLAYERS + P_PY) (local.get $pb)))
  (local.set $pz (!at f32 @(PLAYERS + P_PZ) (local.get $pb)))
  (local.set $vx (!at f32 @(PLAYERS + P_VX) (local.get $pb)))
  (local.set $vy (!at f32 @(PLAYERS + P_VY) (local.get $pb)))
  (local.set $vz (!at f32 @(PLAYERS + P_VZ) (local.get $pb)))
  ;; rolling: bumper's push times the round's; in the air a third of it; going out, none.
  ;; The drag on the ground is the round's, a lower one with no keys held (braking)
  (local.set $acc (f32.mul (select (f32.const @B_ACC_DT) (f32.const @B_AIR_DT) (i32.and (local.get $fl) (i32.const @PF_GROUND)))
                           (f32.load offset=@PG_ACC (local.get $d))))
  (if (!at u16 @(PLAYERS + B_MEGA) (local.get $pb)) (then (local.set $acc (f32.mul (local.get $acc) (f32.const 0.8)))))
  (if (i32.and (local.get $fl) (i32.const @PF_FALL)) (then (local.set $acc (f32.const 0))))
  (local.set $drag (f32.const @B_AIR_DRAG))
  (if (i32.and (local.get $fl) (i32.const @PF_GROUND))
    (then (local.set $drag (select (f32.load offset=@PG_DRAG (local.get $d)) (f32.load offset=@PG_IDLE (local.get $d))
                                   (i32.and (local.get $in) (i32.const 0x0f000000))))))
  (local.set $vx (!madd (local.get $wx) (local.get $acc) (f32.mul (local.get $vx) (local.get $drag))))
  (local.set $vz (!madd (local.get $wz) (local.get $acc) (f32.mul (local.get $vz) (local.get $drag))))
  (if (i32.and (i32.and (i32.ne (i32.and (local.get $fl) (i32.const @PF_GROUND)) (i32.const 0)) (i32.ne (i32.and (local.get $in) (i32.const 0x10000000)) (i32.const 0)))
               (f32.gt (f32.load offset=@PG_HOP (local.get $d)) (f32.const 0)))
    (then
      (local.set $vy (f32.load offset=@PG_HOP (local.get $d)))
      (local.set $fl (i32.and (local.get $fl) (i32.const @(255 ^ PF_GROUND))))))
  (if (i32.eqz (i32.and (local.get $fl) (i32.const @PF_GROUND))) (then (local.set $vy (f32.sub (local.get $vy) (f32.const @GP_DT)))))
  (local.set $sp (!dot3 (local.get $vx) (local.get $vy) (local.get $vz) (local.get $vx) (local.get $vy) (local.get $vz)))
  (if (f32.gt (local.get $sp) (f32.const @PVMAX2))
    (then
      (local.set $scale (f32.div (f32.const 80) (f32.sqrt (local.get $sp))))
      (local.set $vx (f32.mul (local.get $vx) (local.get $scale)))
      (local.set $vy (f32.mul (local.get $vy) (local.get $scale)))
      (local.set $vz (f32.mul (local.get $vz) (local.get $scale)))))
  (local.set $y0 (local.get $py))
  (local.set $px (!madd (local.get $vx) (f32.const @DT) (local.get $px)))
  (local.set $py (!madd (local.get $vy) (f32.const @DT) (local.get $py)))
  (local.set $pz (!madd (local.get $vz) (f32.const @DT) (local.get $pz)))
  ;; held up by the highest solid top within a step of where its bottom was;
  ;; else in the air, and under the lowest floor, going out
  (if (i32.eqz (i32.and (local.get $fl) (i32.const @PF_FALL)))
    (then
      (local.set $top (!mg f32 ground (local.get $d) (local.get $px) (f32.add (local.get $y0) (f32.const @P_STEP)) (local.get $pz)))
      (if (f32.le (local.get $py) (local.get $top))
        (then
          (if (i32.and (local.get $fl) (i32.const @PF_STOMP))
            (then
              (local.set $fl (i32.and (local.get $fl) (i32.const @(255 ^ PF_STOMP))))
              (if (i32.eqz (local.get $d))
                (then (call $b_blast (local.get $px) (local.get $top) (local.get $pz) (f32.const @STOMP_R) (f32.const @STOMP_S) (local.get $p))))))
          (local.set $py (local.get $top))
          (local.set $vy (f32.const 0))
          (local.set $fl (i32.or (local.get $fl) (i32.const @PF_GROUND))))
        (else
          (local.set $fl (i32.and (local.get $fl) (i32.const @(255 ^ PF_GROUND))))
          (if (f32.lt (local.get $py) (f32.sub (f32.load offset=@PG_FLOOR (local.get $d)) (f32.const 1)))
            (then (local.set $fl (i32.or (local.get $fl) (i32.const @PF_FALL)))))))))
  (!chk (local.get $px) 21 (local.get $p))
  (!chk (local.get $py) 22 (local.get $p))
  (!chk (local.get $pz) 23 (local.get $p))
  (!chk (local.get $vx) 24 (local.get $p))
  (!chk (local.get $vy) 25 (local.get $p))
  (!chk (local.get $vz) 26 (local.get $p))
  (!put f32 @(PLAYERS + P_PX) (local.get $pb) (local.get $px))
  (!put f32 @(PLAYERS + P_PY) (local.get $pb) (local.get $py))
  (!put f32 @(PLAYERS + P_PZ) (local.get $pb) (local.get $pz))
  (!put f32 @(PLAYERS + P_VX) (local.get $pb) (local.get $vx))
  (!put f32 @(PLAYERS + P_VY) (local.get $pb) (local.get $vy))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (local.get $vz))
  (!put u8 @(PLAYERS + P_FL) (local.get $pb) (local.get $fl))
  (!mg none push (local.get $p) (local.get $d)))

;; ---- outs, downs and the end, the confirmed world's

;; Credit for slot p going out or down: whoever hit it in the last
;; CREDIT_TICKS, if still in the room (a KO for them), else 255.
(func $p_credit (param $p i32) (result i32)
  (local $pb i32) (local $hb i32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (local.set $hb (!at u8 @(PLAYERS + B_HITBY) (local.get $pb)))
  (if (i32.and (i32.and (i32.ne (!at u16 @(PLAYERS + B_HITT) (local.get $pb)) (i32.const 0)) (i32.ne (local.get $hb) (local.get $p)))
               (i32.lt_u (local.get $hb) (i32.const @NPLAYER)))
    (then
      (if (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $hb) (i32.const 6))) (i32.const @PF_LIVE))
        (then
          (!put u16 @(PLAYERS + B_KOS) (i32.shl (local.get $hb) (i32.const 6))
            (i32.add (!at u16 @(PLAYERS + B_KOS) (i32.shl (local.get $hb) (i32.const 6))) (i32.const 1)))
          (return (local.get $hb))))))
  (i32.const 255))

;; PK_OUT: ball p is out, at the place BH_LEFT gave as this tick began (so
;; everyone out on one tick shares it), still, its KO credited; then the
;; minigame's out.
(func $p_out (param $p i32)
  (local $pb i32) (local $fl i32) (local $place i32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
  (if (i32.ne (i32.and (local.get $fl) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE)) (then (return)))
  (local.set $place (i32.load (i32.const @BH_LEFT)))
  (if (i32.gt_u (local.get $place) (i32.const 255)) (then (local.set $place (i32.const 255))))
  (!put u8 @(PLAYERS + P_FL) (local.get $pb) (i32.or (local.get $fl) (i32.const @PF_DEAD)))
  (!put u8 @(PLAYERS + B_PLACE) (local.get $pb) (local.get $place))
  (!put i32 @(PLAYERS + B_OUTAT) (local.get $pb) (i32.load (i32.const @HDR_TICK)))
  (!put u16 @(PLAYERS + B_ROUNDS) (local.get $pb) (i32.add (!at u16 @(PLAYERS + B_ROUNDS) (local.get $pb)) (i32.const 1)))
  (call $p_sink (local.get $p) (f32.convert_i32_u (local.get $place))))

;; PK_SCORE: ball p is down (back after PG_RESPAWN ticks), still, its KO
;; credited; then the minigame's out.
(func $p_down (param $p i32)
  (local $pb i32) (local $fl i32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
  (if (i32.ne (i32.and (local.get $fl) (i32.const @(PF_LIVE | PF_DEAD))) (i32.const @PF_LIVE)) (then (return)))
  (!put u8 @(PLAYERS + P_FL) (local.get $pb) (i32.or (local.get $fl) (i32.const @PF_DEAD)))
  (!put i32 @(PLAYERS + B_OUTAT) (local.get $pb) (i32.load (i32.const @HDR_TICK)))
  (call $p_sink (local.get $p) (f32.const 0)))

;; What $p_out and $p_down share: still, the credit, FX_SINK (at the ball, or
;; the lowest floor if it fell past it), the minigame's out.
(func $p_sink (param $p i32) (param $size f32)
  (local $pb i32)
  (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
  (!put f32 @(PLAYERS + P_VX) (local.get $pb) (f32.const 0))
  (!put f32 @(PLAYERS + P_VY) (local.get $pb) (f32.const 0))
  (!put f32 @(PLAYERS + P_VZ) (local.get $pb) (f32.const 0))
  (call $fx (i32.const 0) (i32.const @FX_SINK) (local.get $p) (call $p_credit (local.get $p))
            (!at f32 @(PLAYERS + P_PX) (local.get $pb))
            (f32.max (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (f32.load (i32.const @PG_FLOOR)))
            (!at f32 @(PLAYERS + P_PZ) (local.get $pb))
            (local.get $size))
  (!mg none out (local.get $p)))

;; The round's end. Places: PK_OUT, the balls still in share 1st and the rest
;; keep where they went out; PK_SCORE, one more than the balls that scored
;; more. Points to every ball placed, 10 for 1st down to 1 for last; a round
;; played for each, a win for each 1st (still in, for PK_OUT); the result.
(func $p_end (param $t i32)
  (local $p i32) (local $q i32) (local $pb i32) (local $fl i32) (local $kind i32) (local $m i32) (local $pl i32) (local $s i32)
  (local $win i32) (local $nwin i32)
  (local.set $kind (i32.load (i32.const @PG_KIND)))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
    (if (i32.and (local.get $fl) (i32.const @PF_LIVE))
      (then
        (if (i32.eq (local.get $kind) (i32.const @PK_SCORE))
          (then
            (local.set $s (!at u16 @(PLAYERS + PG_SCORE) (local.get $pb)))
            (local.set $pl (i32.const 1))
            (!for $q (i32.const 0) (i32.const @NPLAYER)
              (if (i32.and (i32.ne (i32.and (!at u8 @(PLAYERS + P_FL) (i32.shl (local.get $q) (i32.const 6))) (i32.const @PF_LIVE)) (i32.const 0))
                           (i32.gt_u (!at u16 @(PLAYERS + PG_SCORE) (i32.shl (local.get $q) (i32.const 6))) (local.get $s)))
                (then (!inc $pl))))
            (if (i32.gt_u (local.get $pl) (i32.const 255)) (then (local.set $pl (i32.const 255))))
            (!put u8 @(PLAYERS + B_PLACE) (local.get $pb) (local.get $pl)))
          (else
            (if (i32.eqz (i32.and (local.get $fl) (i32.const @PF_DEAD)))
              (then (!put u8 @(PLAYERS + B_PLACE) (local.get $pb) (i32.const 1))))))
        (if (!at u8 @(PLAYERS + B_PLACE) (local.get $pb)) (then (!inc $m))))))
  (local.set $win (i32.const 255))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
    (local.set $pl (!at u8 @(PLAYERS + B_PLACE) (local.get $pb)))
    (if (i32.and (i32.ne (i32.and (local.get $fl) (i32.const @PF_LIVE)) (i32.const 0)) (i32.ne (local.get $pl) (i32.const 0)))
      (then
        ;; a place past the balls placed (someone placed has left since) counts as last
        (if (i32.gt_u (local.get $pl) (local.get $m)) (then (local.set $pl (local.get $m))))
        (!put u16 @(PLAYERS + PG_PTS) (local.get $pb)
          (i32.add (!at u16 @(PLAYERS + PG_PTS) (local.get $pb))
                   (i32.add (i32.const 1) (i32.div_u (i32.mul (i32.const 9) (i32.sub (local.get $m) (local.get $pl)))
                                                     (select (i32.sub (local.get $m) (i32.const 1)) (i32.const 1) (i32.gt_u (local.get $m) (i32.const 1)))))))
        (if (i32.or (i32.eq (local.get $kind) (i32.const @PK_SCORE)) (i32.eqz (i32.and (local.get $fl) (i32.const @PF_DEAD))))
          (then (!put u16 @(PLAYERS + B_ROUNDS) (local.get $pb) (i32.add (!at u16 @(PLAYERS + B_ROUNDS) (local.get $pb)) (i32.const 1)))))
        ;; a win for each 1st (PK_OUT: still in; a ball alone that fell came 1st of 1 but didn't win)
        (if (i32.and (i32.eq (!at u8 @(PLAYERS + B_PLACE) (local.get $pb)) (i32.const 1))
                     (i32.or (i32.eq (local.get $kind) (i32.const @PK_SCORE)) (i32.eqz (i32.and (local.get $fl) (i32.const @PF_DEAD)))))
          (then
            (!put u16 @(PLAYERS + B_WINS) (local.get $pb) (i32.add (!at u16 @(PLAYERS + B_WINS) (local.get $pb)) (i32.const 1)))
            (local.set $win (local.get $p))
            (!inc $nwin))))))
  (i32.store (i32.const @BH_WINNER) (select (local.get $win) (i32.const 255) (i32.eq (local.get $nwin) (i32.const 1))))
  (i32.store (i32.const @HDR_STATE) (i32.const @H_OVER))
  (i32.store (i32.const @HDR_UNTIL) (i32.add (local.get $t) (i32.const @P_OVER))))

;; The round, at the end of every tick: while it plays, the bumps and the
;; minigame's tick; balls under the lowest floor out (or down, and back after
;; PG_RESPAWN); the count; then the clock: the countdown, play until the
;; minigame is over, the result, the next round laid out.
(func $bumper
  (local $p i32) (local $pb i32) (local $fl i32) (local $live i32) (local $left i32) (local $t i32) (local $state i32)
  (local $n i32) (local $kind i32) (local $end i32) (local $floor f32)
  (local.set $t (i32.load (i32.const @HDR_TICK)))
  (local.set $state (i32.load (i32.const @HDR_STATE)))
  (local.set $kind (i32.load (i32.const @PG_KIND)))
  (if (i32.eq (local.get $state) (i32.const @H_PLAY))
    (then
      (if (i32.and (i32.load (i32.const @PG_FLAGS)) (i32.const @PGF_BUMPS)) (then (call $b_bumps)))
      (!mg none tick)))
  (local.set $floor (f32.sub (f32.load (i32.const @PG_FLOOR)) (f32.const @OUT_DEPTH)))
  (!for $p (i32.const 0) (i32.const @NPLAYER)
    (local.set $pb (i32.shl (local.get $p) (i32.const 6)))
    (local.set $fl (!at u8 @(PLAYERS + P_FL) (local.get $pb)))
    (if (i32.and (local.get $fl) (i32.const @PF_LIVE))
      (then
        (!inc $live)
        (if (i32.eqz (i32.and (local.get $fl) (i32.const @PF_DEAD)))
          (then
            (if (i32.and (i32.eq (local.get $state) (i32.const @H_PLAY)) (f32.lt (!at f32 @(PLAYERS + P_PY) (local.get $pb)) (local.get $floor)))
              (then
                (if (i32.eq (local.get $kind) (i32.const @PK_SCORE))
                  (then (call $p_down (local.get $p)))
                  (else (call $p_out (local.get $p)))))
              (else
                (local.set $n (!at u16 @(PLAYERS + B_HITT) (local.get $pb)))
                (if (local.get $n) (then (!put u16 @(PLAYERS + B_HITT) (local.get $pb) (i32.sub (local.get $n) (i32.const 1))))))))
          (else
            (if (i32.and (i32.and (i32.eq (local.get $state) (i32.const @H_PLAY)) (i32.eq (local.get $kind) (i32.const @PK_SCORE)))
                         (i32.ge_u (i32.sub (local.get $t) (!at i32 @(PLAYERS + B_OUTAT) (local.get $pb))) (i32.load (i32.const @PG_RESPAWN))))
              (then (call $p_respawn (local.get $p))))))
        (if (i32.eqz (i32.and (!at u8 @(PLAYERS + P_FL) (local.get $pb)) (i32.const @PF_DEAD))) (then (!inc $left))))))
  (i32.store (i32.const @HDR_LIVE) (local.get $live))
  (i32.store (i32.const @BH_LEFT) (local.get $left))
  (if (i32.eqz (local.get $live))
    (then (i32.store (i32.const @HDR_STATE) (i32.const @H_IDLE)) (return)))
  (if (i32.eq (local.get $state) (i32.const @H_COUNT))
    (then
      (if (i32.ge_u (local.get $t) (i32.load (i32.const @HDR_UNTIL)))
        (then
          (i32.store (i32.const @HDR_STATE) (i32.const @H_PLAY))
          (i32.store (i32.const @HDR_START) (local.get $t))
          (i32.store (i32.const @HDR_UNTIL) (i32.add (local.get $t) (i32.load (i32.const @PG_LEN))))
          (!mg none start)))
      (return)))
  (if (i32.eq (local.get $state) (i32.const @H_PLAY))
    (then
      ;; PK_OUT also ends with one ball left of two or more, or none; a ball alone plays till it falls
      (local.set $end (!mg i32 over))
      (if (i32.ge_u (local.get $t) (i32.load (i32.const @HDR_UNTIL))) (then (local.set $end (i32.const 1))))
      (if (i32.and (i32.eq (local.get $kind) (i32.const @PK_OUT))
                   (i32.or (i32.eqz (local.get $left))
                           (i32.and (i32.ge_u (i32.load (i32.const @BH_N0)) (i32.const 2)) (i32.le_u (local.get $left) (i32.const 1)))))
        (then (local.set $end (i32.const 1))))
      (if (local.get $end) (then (call $p_end (local.get $t))))
      (return)))
  (if (i32.and (i32.eq (local.get $state) (i32.const @H_OVER)) (i32.ge_u (local.get $t) (i32.load (i32.const @HDR_UNTIL))))
    (then
      (i32.store (i32.const @HDR_HOLE) (i32.add (i32.load (i32.const @HDR_HOLE)) (i32.const 1)))
      (call $p_round (i32.const 1))
      (i32.store (i32.const @HDR_STATE) (i32.const @H_COUNT))
      (i32.store (i32.const @HDR_UNTIL) (i32.add (local.get $t) (i32.const @P_COUNT))))))

;; ---- helpers any minigame may call

;; Ticks since the round's start on bank d (0 before it plays).
(func $p_t (param $d i32) (result i32)
  (if (result i32) (i32.lt_u (i32.load offset=@HDR_STATE (local.get $d)) (i32.const @H_PLAY))
    (then (i32.const 0))
    (else (i32.sub (i32.load offset=@HDR_TICK (local.get $d)) (i32.load offset=@HDR_START (local.get $d))))))

;; Uniform in [0, 1), from the PRNG: serial confirmed code only.
(func $p_unit (result f32) (call $b_unit))

;; Is the ball at record pb in (live, not out, not going out)?
(func $p_in (param $pb i32) (result i32) (call $b_in (local.get $pb)))

;; Point i of n of a sunflower spiral over a disc of radius r round the stage's centre.
(func $p_disc (param $i i32) (param $n i32) (param $r f32) (result f32 f32)
  (local $rr f32) (local $s f32) (local $c f32) (local $cx f32)
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (local.set $rr (f32.mul (local.get $r)
                          (f32.sqrt (f32.div (f32.add (f32.convert_i32_u (local.get $i)) (f32.const 0.5))
                                             (f32.convert_i32_u (select (local.get $n) (i32.const 1) (local.get $n)))))))
  (call $sincos (i32.mul (local.get $i) (i32.const 6258))) ;; the golden angle, in 1/16384 turn
  (local.set $c) (local.set $s)
  (!madd (local.get $c) (local.get $rr) (local.get $cx))
  (!madd (local.get $s) (local.get $rr) (local.get $cx)))

;; The axial hex (q, r) holding (x, z): pointy-top cells of circumradius s
;; (a corner on +z), cell (0, 0) centred on the stage's centre, q along +x,
;; r down-right at 60 degrees; cube rounding, ties to even.
(func $p_hex (param $x f32) (param $z f32) (param $s f32) (result i32 i32)
  (local $u f32) (local $w f32) (local $fq f32) (local $fr f32) (local $fs f32)
  (local $rq f32) (local $rr f32) (local $rs f32) (local $dq f32) (local $dr f32) (local $ds f32)
  (local.set $u (f32.div (f32.sub (local.get $x) (f32.load (i32.const @PG_CX))) (local.get $s)))
  (local.set $w (f32.div (f32.sub (local.get $z) (f32.load (i32.const @PG_CX))) (local.get $s)))
  (local.set $fq (f32.sub (f32.mul (local.get $u) (f32.const 0.57735026)) (f32.mul (local.get $w) (f32.const 0.33333334))))
  (local.set $fr (f32.mul (local.get $w) (f32.const 0.6666667)))
  (local.set $fs (f32.sub (f32.neg (local.get $fq)) (local.get $fr)))
  (local.set $rq (f32.nearest (local.get $fq)))
  (local.set $rr (f32.nearest (local.get $fr)))
  (local.set $rs (f32.nearest (local.get $fs)))
  (local.set $dq (f32.abs (f32.sub (local.get $rq) (local.get $fq))))
  (local.set $dr (f32.abs (f32.sub (local.get $rr) (local.get $fr))))
  (local.set $ds (f32.abs (f32.sub (local.get $rs) (local.get $fs))))
  (if (i32.and (f32.gt (local.get $dq) (local.get $dr)) (f32.gt (local.get $dq) (local.get $ds)))
    (then (local.set $rq (f32.sub (f32.neg (local.get $rr)) (local.get $rs))))
    (else
      (if (f32.gt (local.get $dr) (local.get $ds))
        (then (local.set $rr (f32.sub (f32.neg (local.get $rq)) (local.get $rs)))))))
  (i32.trunc_sat_f32_s (local.get $rq))
  (i32.trunc_sat_f32_s (local.get $rr)))

;; The centre (x, z) of hex (q, r).
(func $p_hexc (param $q i32) (param $r i32) (param $s f32) (result f32 f32)
  (local $fq f32) (local $fr f32) (local $cx f32)
  (local.set $fq (f32.convert_i32_s (local.get $q)))
  (local.set $fr (f32.convert_i32_s (local.get $r)))
  (local.set $cx (f32.load (i32.const @PG_CX)))
  (!madd (f32.add (f32.mul (local.get $fq) (f32.const 1.7320508)) (f32.mul (local.get $fr) (f32.const 0.8660254))) (local.get $s) (local.get $cx))
  (!madd (f32.mul (local.get $fr) (f32.const 1.5)) (local.get $s) (local.get $cx)))

;; A per-round random number for k: the room's seed, the round and k hashed.
;; It reads only the header, so any code on either bank may compute it (for
;; what is scheduled from the round's start: which wall, which colour).
(func $p_seed (param $k i32) (result i32)
  (call $hash32 (i32.load (i32.const @HDR_SEED)) (i32.load (i32.const @HDR_HOLE)) (local.get $k)))
