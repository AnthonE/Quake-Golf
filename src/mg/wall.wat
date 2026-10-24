;; THE WALL (MG_WALL): a stand-in until the minigame lands. A plain disc
;; at PLAT_Y sized for the crowd (its radius in PG_SIZE), last ball on it wins.

(func $wl_setup (param $n i32)
  (f32.store (i32.const @PG_SIZE) (f32.min (!madd (f32.sqrt (f32.convert_i32_u (local.get $n))) (f32.const @WL_RK) (f32.const @WL_R0)) (f32.const 64))))

(func $wl_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $x f32) (local $z f32)
  (call $p_disc (local.get $i) (local.get $n) (f32.mul (f32.load (i32.const @PG_SIZE)) (f32.const 0.8)))
  (local.set $z) (local.set $x)
  (local.get $x) (f32.const @PLAT_Y) (local.get $z))

(func $wl_start)

(func $wl_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (local $r f32) (local $dx f32) (local $dz f32)
  (local.set $r (f32.load offset=@PG_SIZE (local.get $d)))
  (local.set $dx (f32.sub (local.get $x) (f32.load offset=@PG_CX (local.get $d))))
  (local.set $dz (f32.sub (local.get $z) (f32.load offset=@PG_CX (local.get $d))))
  (if (result f32) (i32.and (f32.ge (local.get $y) (f32.const @PLAT_Y))
                            (f32.le (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))) (f32.mul (local.get $r) (local.get $r))))
    (then (f32.const @PLAT_Y))
    (else (f32.const -1000))))

(func $wl_push (param $p i32) (param $d i32))

(func $wl_tick)

(func $wl_over (result i32) (i32.const 0))

(func $wl_out (param $p i32))
