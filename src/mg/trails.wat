;; LIGHT TRAILS: a round platform over the sea, sized for the crowd. Bump the
;; others off; the last ball on it wins. (node tools/new-mg.mjs wrote this: every
;; hook is here, most of them empty, for you to fill.)
;;
;; src/party.wat calls these through (!mg) on PG_GAME:
;;   setup n          the round's knobs (PG_KIND, PG_LEN, PG_SIZE, ...) and the stage, for n balls
;;   spawn i n        where ball i of n starts: x y z
;;   start            play starts (the confirmed world)
;;   begin p d        ball p's own start on bank d: writes only its record
;;   ground d x y z   the floor's top under (x, z) no higher than y on bank d, or -1000 for none
;;   push p d         ball p after its roll on bank d: its record and bank d's FX ring only
;;   tick             once a tick in play: serial, in slot order, the confirmed world
;;   over             1 ends the round now
;;   out p            ball p is out
;; State lives only in PG_H (LT_RAD...), PG_S, PG_BIG, and PG_M and PG_SCORE in
;; each ball's record. Floats: (!madd a b c) for a * b + c, angles through $sincos.

;; The platform for the crowd.
(func $lt_setup (param $n i32)
  (local $rad f32)
  (local.set $rad (f32.min (!madd (f32.sqrt (f32.convert_i32_u (local.get $n))) (f32.const @LT_RK) (f32.const @LT_R0)) (f32.const @LT_RMAX)))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_OUT))
  (i32.store (i32.const @PG_LEN) (i32.const @LT_LEN))
  (f32.store (i32.const @PG_SIZE) (local.get $rad))
  (f32.store (i32.const @(PG_H + LT_RAD)) (local.get $rad)))

;; A sunflower spiral over most of the platform.
(func $lt_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $x f32) (local $z f32)
  (call $p_disc (local.get $i) (local.get $n) (f32.mul (f32.load (i32.const @(PG_H + LT_RAD))) (f32.const 0.8)))
  (local.set $z) (local.set $x)
  (local.get $x) (f32.const @PLAT_Y) (local.get $z))

(func $lt_start)
(func $lt_begin (param $p i32) (param $d i32))

;; The platform's top under (x, z) if (x, z) is on it, on bank d.
(func $lt_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (local $r f32) (local $dx f32) (local $dz f32)
  (if (f32.lt (local.get $y) (f32.const @PLAT_Y)) (then (return (f32.const -1000))))
  (local.set $r (f32.load offset=@(PG_H + LT_RAD) (local.get $d)))
  (local.set $dx (f32.sub (local.get $x) (f32.load offset=@PG_CX (local.get $d))))
  (local.set $dz (f32.sub (local.get $z) (f32.load offset=@PG_CX (local.get $d))))
  (if (result f32) (f32.le (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))) (f32.mul (local.get $r) (local.get $r)))
    (then (f32.const @PLAT_Y))
    (else (f32.const -1000))))

(func $lt_push (param $p i32) (param $d i32))
(func $lt_tick)
(func $lt_over (result i32) (i32.const 0))
(func $lt_out (param $p i32))
