;; One contact of awake ball i with ball j, spliced into both contact walks
;; (balls.wat): j at dx, dy, dz from i, d2 its squared distance, less than a
;; diameter's and more than none. Adds j's push on i to ax, ay, az.
  (local.set $dist (f32.sqrt (local.get $d2)))
  (local.set $inv (f32.div (f32.const 1) (local.get $dist)))
  (local.set $nx (f32.mul (local.get $dx) (local.get $inv)))
  (local.set $ny (f32.mul (local.get $dy) (local.get $inv)))
  (local.set $nz (f32.mul (local.get $dz) (local.get $inv)))
  (local.set $pen (f32.sub (f32.const @TWO_R) (local.get $dist)))
  (if (i32.and (!ld u8 @FLAGS (local.get $j)) (i32.const @F_AWAKE))
    (then
      ;; equal masses: each side takes half, so i and j get exact negatives
      (local.set $vrel (!dot3 (f32.sub (!ld f32 @VX (local.get $j)) (local.get $vx))
                              (f32.sub (!ld f32 @VY (local.get $j)) (local.get $vy))
                              (f32.sub (!ld f32 @VZ (local.get $j)) (local.get $vz))
                              (local.get $nx) (local.get $ny) (local.get $nz)))
      (local.set $coef (f32.neg (f32.mul (f32.mul (local.get $pen) (f32.const @PUSH)) (f32.const 0.5))))
      (if (f32.lt (local.get $vrel) (f32.const 0))
        (then
          (local.set $coef (!madd (local.get $vrel)
                                  (select (f32.const @((1 + Number(E_BB)) * 0.5)) (f32.const 0.5)
                                          (f32.lt (local.get $vrel) (f32.const @(-Number(BOUNCE_MIN)))))
                                  (local.get $coef))))))
    (else
      ;; a sleeping neighbour is static; hit it hard enough and it wakes next tick
      (local.set $vrel (f32.neg (!dot3 (local.get $vx) (local.get $vy) (local.get $vz)
                                       (local.get $nx) (local.get $ny) (local.get $nz))))
      (local.set $coef (f32.neg (f32.mul (local.get $pen) (f32.const @PUSH))))
      (if (f32.lt (local.get $vrel) (f32.const 0))
        (then
          (local.set $coef (!madd (local.get $vrel)
                                  (select (f32.const @(1 + Number(E_BB))) (f32.const 1)
                                          (f32.lt (local.get $vrel) (f32.const @(-Number(BOUNCE_MIN)))))
                                  (local.get $coef)))))
      (if (f32.lt (local.get $vrel) (f32.const @(-Number(WAKE_V))))
        (then (i32.atomic.store8 offset=@WAKE (local.get $j) (i32.const 1))))))
  (local.set $ax (!madd (local.get $nx) (local.get $coef) (local.get $ax)))
  (local.set $ay (!madd (local.get $ny) (local.get $coef) (local.get $ay)))
  (local.set $az (!madd (local.get $nz) (local.get $coef) (local.get $az)))
