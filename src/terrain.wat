;; 512 x 512 heightfield from one 32-bit seed, integer value noise only,
;; so every machine builds the same bytes. Heights in 1/256 m.

(func $val (param $lx i32) (param $lz i32) (param $s i32) (param $amp i32) (result i32)
  (i32.shr_u (i32.mul (i32.and (call $hash32 (local.get $lx) (local.get $lz) (local.get $s)) (i32.const 0xffff))
                      (local.get $amp))
             (i32.const 16)))

(func $terrain_gen (param $seed i32)
  (local $x i32) (local $z i32) (local $h i32) (local $k i32) (local $s i32)
  (local $lx i32) (local $lz i32) (local $fx i32) (local $fz i32)
  (!for $z (i32.const 0) (i32.const @GRID)
    (!for $x (i32.const 0) (i32.const @GRID)
      (local.set $h (i32.const 4096))
      (!octave 7 8192 1)
      (!octave 6 4096 2)
      (!octave 5 2048 3)
      (!octave 4 1024 4)
      (!octave 3 512 5)
      (local.set $k (i32.add (i32.shl (local.get $z) (i32.const 9)) (local.get $x)))
      (!st u16 @TERRAIN_H (local.get $k) (local.get $h))
      ;; surface: fairway, rough, sand, green, in 32 m patches
      (!st u8 @TERRAIN_S (local.get $k)
        (i32.and (call $hash32 (i32.shr_u (local.get $x) (i32.const 4)) (i32.shr_u (local.get $z) (i32.const 4))
                               (i32.xor (local.get $seed) (i32.const 0x5bd1e995)))
                 (i32.const 3))))))
