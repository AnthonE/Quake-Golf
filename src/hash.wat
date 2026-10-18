;; XXH64, exactly as specified: integers only, fixed order, little-endian.
;; tools/xxh64.mjs is the BigInt reference it is tested against.

(func $round (param $acc i64) (param $in i64) (result i64)
  (i64.mul (i64.rotl (i64.add (local.get $acc) (i64.mul (local.get $in) (i64.const 0xC2B2AE3D27D4EB4F)))
                     (i64.const 31))
           (i64.const 0x9E3779B185EBCA87)))

(func $merge (param $acc i64) (param $val i64) (result i64)
  (i64.add (i64.mul (i64.xor (local.get $acc) (call $round (i64.const 0) (local.get $val)))
                    (i64.const 0x9E3779B185EBCA87))
           (i64.const 0x85EBCA77C2B2AE63)))

(func $xxh64 (export "xxh64") (param $p i32) (param $len i32) (param $seed i64) (result i64)
  (local $end i32) (local $lim i32) (local $h i64)
  (local $v1 i64) (local $v2 i64) (local $v3 i64) (local $v4 i64)
  (local.set $end (i32.add (local.get $p) (local.get $len)))
  (if (i32.ge_u (local.get $len) (i32.const 32))
    (then
      (local.set $lim (i32.sub (local.get $end) (i32.const 32)))
      (local.set $v1 (i64.add (i64.add (local.get $seed) (i64.const 0x9E3779B185EBCA87)) (i64.const 0xC2B2AE3D27D4EB4F)))
      (local.set $v2 (i64.add (local.get $seed) (i64.const 0xC2B2AE3D27D4EB4F)))
      (local.set $v3 (local.get $seed))
      (local.set $v4 (i64.sub (local.get $seed) (i64.const 0x9E3779B185EBCA87)))
      (loop $stripes
        (local.set $v1 (call $round (local.get $v1) (i64.load (local.get $p))))
        (local.set $v2 (call $round (local.get $v2) (i64.load offset=8 (local.get $p))))
        (local.set $v3 (call $round (local.get $v3) (i64.load offset=16 (local.get $p))))
        (local.set $v4 (call $round (local.get $v4) (i64.load offset=24 (local.get $p))))
        (local.set $p (i32.add (local.get $p) (i32.const 32)))
        (br_if $stripes (i32.le_u (local.get $p) (local.get $lim))))
      (local.set $h (i64.add (i64.add (i64.rotl (local.get $v1) (i64.const 1)) (i64.rotl (local.get $v2) (i64.const 7)))
                             (i64.add (i64.rotl (local.get $v3) (i64.const 12)) (i64.rotl (local.get $v4) (i64.const 18)))))
      (local.set $h (call $merge (local.get $h) (local.get $v1)))
      (local.set $h (call $merge (local.get $h) (local.get $v2)))
      (local.set $h (call $merge (local.get $h) (local.get $v3)))
      (local.set $h (call $merge (local.get $h) (local.get $v4))))
    (else
      (local.set $h (i64.add (local.get $seed) (i64.const 0x27D4EB2F165667C5)))))
  (local.set $h (i64.add (local.get $h) (i64.extend_i32_u (local.get $len))))
  (block $d8
    (loop $l8
      (br_if $d8 (i32.gt_u (i32.add (local.get $p) (i32.const 8)) (local.get $end)))
      (local.set $h (i64.xor (local.get $h) (call $round (i64.const 0) (i64.load (local.get $p)))))
      (local.set $h (i64.add (i64.mul (i64.rotl (local.get $h) (i64.const 27)) (i64.const 0x9E3779B185EBCA87))
                             (i64.const 0x85EBCA77C2B2AE63)))
      (local.set $p (i32.add (local.get $p) (i32.const 8)))
      (br $l8)))
  (if (i32.le_u (i32.add (local.get $p) (i32.const 4)) (local.get $end))
    (then
      (local.set $h (i64.xor (local.get $h) (i64.mul (i64.load32_u (local.get $p)) (i64.const 0x9E3779B185EBCA87))))
      (local.set $h (i64.add (i64.mul (i64.rotl (local.get $h) (i64.const 23)) (i64.const 0xC2B2AE3D27D4EB4F))
                             (i64.const 0x165667B19E3779F9)))
      (local.set $p (i32.add (local.get $p) (i32.const 4)))))
  (block $d1
    (loop $l1
      (br_if $d1 (i32.ge_u (local.get $p) (local.get $end)))
      (local.set $h (i64.xor (local.get $h) (i64.mul (i64.load8_u (local.get $p)) (i64.const 0x27D4EB2F165667C5))))
      (local.set $h (i64.mul (i64.rotl (local.get $h) (i64.const 11)) (i64.const 0x9E3779B185EBCA87)))
      (local.set $p (i32.add (local.get $p) (i32.const 1)))
      (br $l1)))
  (local.set $h (i64.xor (local.get $h) (i64.shr_u (local.get $h) (i64.const 33))))
  (local.set $h (i64.mul (local.get $h) (i64.const 0xC2B2AE3D27D4EB4F)))
  (local.set $h (i64.xor (local.get $h) (i64.shr_u (local.get $h) (i64.const 29))))
  (local.set $h (i64.mul (local.get $h) (i64.const 0x165667B19E3779F9)))
  (i64.xor (local.get $h) (i64.shr_u (local.get $h) (i64.const 32))))

;; Production hash: slice s of the region, seeded with s, into DIGESTS[s].
(func $hash_slice (export "hash_slice") (param $s i32)
  (!st i64 @DIGESTS (local.get $s)
    (call $xxh64 (i32.add (i32.const @REGION) (i32.shl (local.get $s) (i32.const 12)))
                 (i32.const @SLICE) (i64.extend_i32_u (local.get $s)))))

;; Harness hash: every slice now, then a hash of the 128 digests.
(func $hash_region (export "hash_region") (result i64)
  (local $s i32)
  (!for $s (i32.const 0) (i32.const @NSLICE)
    (!st i64 @FULLDIG (local.get $s)
      (call $xxh64 (i32.add (i32.const @REGION) (i32.shl (local.get $s) (i32.const 12)))
                   (i32.const @SLICE) (i64.extend_i32_u (local.get $s)))))
  (call $xxh64 (i32.const @FULLDIG) (i32.const @(NSLICE * 8)) (i64.const 0)))

(func (export "terrain_hash") (result i64)
  (call $xxh64 (i32.const @TERRAIN_H) (i32.const @(TERRAIN_END - TERRAIN_H)) (i64.const 0)))
