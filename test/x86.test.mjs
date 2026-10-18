// The translator against V8, op by op, on the values that catch a port out:
// signed zeros, NaNs, denormals, the saturation edges, rounding ties in
// unsigned conversion, and every 64-bit shift count that crosses a word. One
// module runs the same loops in V8 and as Pentium III code (natively, and
// under qemu-i386 -cpu pentium3 when it is installed); every output word must
// be equal, except that a NaN may be any NaN (wasm leaves its bits open).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assemble } from '../tools/asm.mjs';
import { translate } from '../tools/w2x86.mjs';
import { CFLAGS } from '../tools/x86.mjs';

const has = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; } catch { return false; } };
const CLANG = has('clang', ['--version']);
const QEMU = has('qemu-i386', ['-version']);

const IN_F = 0x10000, IN_I = 0x18000, IN_L = 0x1c000, COUNTS = 0x100;
const OUT_F = 0x100000, OUT_I = 0x200000, OUT_END = 0x300000;

const WAT = `
(module
  (import "env" "mem" (memory 64 64 shared))
  (func $f32bin (param $a f32) (param $b f32) (param $of i32) (param $oi i32)
    (f32.store offset=0 (local.get $of) (f32.add (local.get $a) (local.get $b)))
    (f32.store offset=4 (local.get $of) (f32.sub (local.get $a) (local.get $b)))
    (f32.store offset=8 (local.get $of) (f32.mul (local.get $a) (local.get $b)))
    (f32.store offset=12 (local.get $of) (f32.div (local.get $a) (local.get $b)))
    (f32.store offset=16 (local.get $of) (f32.min (local.get $a) (local.get $b)))
    (f32.store offset=20 (local.get $of) (f32.max (local.get $a) (local.get $b)))
    (f32.store offset=24 (local.get $of) (f32.copysign (local.get $a) (local.get $b)))
    (f32.store offset=28 (local.get $of) (select (local.get $a) (local.get $b) (f32.lt (local.get $a) (local.get $b))))
    (f32.store offset=32 (local.get $of) (f32.min (f32.mul (local.get $a) (local.get $b)) (f32.add (local.get $a) (local.get $b))))
    (i32.store offset=0 (local.get $oi) (f32.lt (local.get $a) (local.get $b)))
    (i32.store offset=4 (local.get $oi) (f32.gt (local.get $a) (local.get $b)))
    (i32.store offset=8 (local.get $oi) (f32.le (local.get $a) (local.get $b)))
    (i32.store offset=12 (local.get $oi) (f32.ge (local.get $a) (local.get $b)))
    (i32.store offset=16 (local.get $oi) (f32.eq (local.get $a) (local.get $b)))
    (i32.store offset=20 (local.get $oi) (f32.ne (local.get $a) (local.get $b)))
    (i32.store offset=24 (local.get $oi) (select (i32.const 7) (i32.const 9) (f32.ge (local.get $a) (local.get $b))))
    (i32.store offset=28 (local.get $oi) (i32.eqz (f32.le (local.get $a) (local.get $b))))
    (i32.store offset=32 (local.get $oi)
      (block (result i32) (drop (br_if 0 (i32.const 11) (f32.gt (local.get $a) (local.get $b)))) (i32.const 22)))
    (i32.store offset=36 (local.get $oi)
      (if (result i32) (f32.lt (local.get $b) (local.get $a)) (then (i32.const 3)) (else (i32.const 4))))
    (i32.store offset=40 (local.get $oi) (i32.and (f32.lt (local.get $a) (local.get $b)) (f32.ge (local.get $a) (f32.const 0))))
    ;; a compare left below the top while an eqz or a select tests something else
    (i32.store offset=44 (local.get $oi) (i32.add (f32.lt (local.get $a) (local.get $b)) (i32.eqz (local.get $of))))
    (i32.store offset=48 (local.get $oi) (select (f32.gt (local.get $a) (local.get $b)) (i32.const 5) (local.get $oi))))

  (func $f32un (param $a f32) (param $of i32) (param $oi i32)
    (f32.store offset=0 (local.get $of) (f32.abs (local.get $a)))
    (f32.store offset=4 (local.get $of) (f32.neg (local.get $a)))
    (f32.store offset=8 (local.get $of) (f32.sqrt (local.get $a)))
    (f32.store offset=12 (local.get $of) (f32.floor (local.get $a)))
    (f32.store offset=16 (local.get $of) (f32.ceil (local.get $a)))
    (f32.store offset=20 (local.get $of) (f32.trunc (local.get $a)))
    (f32.store offset=24 (local.get $of) (f32.nearest (local.get $a)))
    (f32.store offset=28 (local.get $of) (f32.min (local.get $a) (f32.const 0.5)))
    (f32.store offset=32 (local.get $of) (f32.max (f32.const -3) (local.get $a)))
    (f32.store offset=36 (local.get $of) (f32.min (local.get $a) (f32.const 0)))
    (f32.store offset=40 (local.get $of) (f32.max (local.get $a) (f32.const -0)))
    (f32.store offset=44 (local.get $of) (f32.min (f32.max (local.get $a) (f32.const 0)) (f32.const 510.99)))
    (f32.store offset=48 (local.get $of) (f32.mul (local.get $a) (f32.const 1e-30)))
    (v128.store offset=64 (local.get $of)
      (f32x4.mul (f32x4.add (f32x4.splat (local.get $a)) (v128.const f32x4 1e-40 -0 1 -2.5))
                 (v128.const f32x4 0.5 1e38 -1e-38 3)))
    (v128.store offset=80 (local.get $of) (f32x4.sub (f32x4.splat (local.get $a)) (v128.const f32x4 1e-45 1 -1 0)))
    (i32.store offset=0 (local.get $oi) (i32.trunc_sat_f32_s (local.get $a)))
    (i32.store offset=4 (local.get $oi) (i32.trunc_sat_f32_u (local.get $a)))
    (i32.store offset=8 (local.get $oi) (i32.trunc_sat_f32_s (f32.floor (local.get $a))))
    (i32.store offset=12 (local.get $oi) (i32.trunc_sat_f32_s (f32.floor (f32.mul (local.get $a) (f32.const 2.5)))))
    (i32.store offset=16 (local.get $oi) (i32.reinterpret_f32 (f32.neg (local.get $a))))
    (i32.store offset=20 (local.get $oi) (f32.lt (f32.abs (local.get $a)) (f32.const inf))))

  (func $i32un (param $x i32) (param $of i32) (param $oi i32)
    (f32.store offset=0 (local.get $of) (f32.convert_i32_s (local.get $x)))
    (f32.store offset=4 (local.get $of) (f32.convert_i32_u (local.get $x)))
    (f32.store offset=8 (local.get $of) (f32.convert_i32_u (i32.and (local.get $x) (i32.const 0xffff))))
    (f32.store offset=12 (local.get $of) (f32.convert_i32_u (i32.shr_u (local.get $x) (i32.const 1))))
    (f32.store offset=16 (local.get $of) (f32.reinterpret_i32 (local.get $x)))
    (v128.store offset=32 (local.get $of) (i32x4.splat (local.get $x)))
    (i64.store offset=0 (local.get $oi) (i64.extend_i32_s (local.get $x)))
    (i64.store offset=8 (local.get $oi) (i64.extend_i32_u (local.get $x)))
    (i32.store offset=16 (local.get $oi) (i32.extend8_s (local.get $x)))
    (i32.store offset=20 (local.get $oi) (i32.extend16_s (local.get $x)))
    (i32.store offset=24 (local.get $oi) (i32.eqz (local.get $x)))
    (i32.store8 offset=28 (local.get $oi) (local.get $x))
    (i32.store16 offset=30 (local.get $oi) (local.get $x)))

  (func $i32bin (param $x i32) (param $y i32) (param $oi i32)
    (i32.store offset=0 (local.get $oi) (i32.add (local.get $x) (local.get $y)))
    (i32.store offset=4 (local.get $oi) (i32.sub (local.get $x) (local.get $y)))
    (i32.store offset=8 (local.get $oi) (i32.mul (local.get $x) (local.get $y)))
    (i32.store offset=12 (local.get $oi) (i32.shl (local.get $x) (local.get $y)))
    (i32.store offset=16 (local.get $oi) (i32.shr_s (local.get $x) (local.get $y)))
    (i32.store offset=20 (local.get $oi) (i32.shr_u (local.get $x) (local.get $y)))
    (i32.store offset=24 (local.get $oi) (i32.rotl (local.get $x) (local.get $y)))
    (i32.store offset=28 (local.get $oi) (i32.rotr (local.get $x) (local.get $y)))
    (i32.store offset=32 (local.get $oi) (i32.lt_s (local.get $x) (local.get $y)))
    (i32.store offset=36 (local.get $oi) (i32.lt_u (local.get $x) (local.get $y)))
    (i32.store offset=40 (local.get $oi) (i32.ge_s (local.get $x) (local.get $y)))
    (i32.store offset=44 (local.get $oi) (i32.gt_u (local.get $x) (local.get $y)))
    (i32.store offset=48 (local.get $oi) (select (local.get $x) (local.get $y) (i32.and (local.get $x) (i32.const 4))))
    (i32.store offset=52 (local.get $oi) (select (local.get $x) (local.get $y) (i32.le_u (local.get $x) (local.get $y))))
    (if (local.get $y)
      (then
        (i32.store offset=56 (local.get $oi) (i32.div_u (local.get $x) (local.get $y)))
        (i32.store offset=60 (local.get $oi) (i32.rem_u (local.get $x) (local.get $y)))
        (i32.store offset=64 (local.get $oi) (i32.rem_s (local.get $x) (local.get $y)))
        (if (i32.or (i32.ne (local.get $x) (i32.const 0x80000000)) (i32.ne (local.get $y) (i32.const -1)))
          (then (i32.store offset=68 (local.get $oi) (i32.div_s (local.get $x) (local.get $y))))))))

  (func $i64bin (param $a i64) (param $b i64) (param $oi i32)
    (i64.store offset=0 (local.get $oi) (i64.add (local.get $a) (local.get $b)))
    (i64.store offset=8 (local.get $oi) (i64.sub (local.get $a) (local.get $b)))
    (i64.store offset=16 (local.get $oi) (i64.mul (local.get $a) (local.get $b)))
    (i64.store offset=24 (local.get $oi) (i64.xor (local.get $a) (local.get $b)))
    (i64.store offset=32 (local.get $oi) (i64.and (local.get $a) (local.get $b)))
    (i64.store offset=40 (local.get $oi) (i64.or (local.get $a) (local.get $b)))
    (i64.store offset=48 (local.get $oi) (i64.shl (local.get $a) (local.get $b)))
    (i64.store offset=56 (local.get $oi) (i64.shr_u (local.get $a) (local.get $b)))
    (i64.store offset=64 (local.get $oi) (i64.shr_s (local.get $a) (local.get $b)))
    (i64.store offset=72 (local.get $oi) (i64.rotl (local.get $a) (local.get $b)))
    (i64.store offset=80 (local.get $oi) (i64.rotr (local.get $a) (local.get $b)))
    (i64.store offset=88 (local.get $oi) (select (local.get $a) (local.get $b) (i64.lt_u (local.get $a) (local.get $b))))
    (i32.store offset=96 (local.get $oi) (i64.eq (local.get $a) (local.get $b)))
    (i32.store offset=100 (local.get $oi) (i64.ne (local.get $a) (local.get $b)))
    (i32.store offset=104 (local.get $oi) (i64.lt_u (local.get $a) (local.get $b)))
    (i32.store offset=108 (local.get $oi) (i64.lt_s (local.get $a) (local.get $b)))
    (i32.store offset=112 (local.get $oi) (i64.gt_u (local.get $a) (local.get $b)))
    (i32.store offset=116 (local.get $oi) (i64.gt_s (local.get $a) (local.get $b)))
    (i32.store offset=120 (local.get $oi) (i64.le_u (local.get $a) (local.get $b)))
    (i32.store offset=124 (local.get $oi) (i64.ge_s (local.get $a) (local.get $b)))
    (i32.store offset=128 (local.get $oi) (i64.eqz (local.get $a)))
    (i32.store offset=132 (local.get $oi) (i32.wrap_i64 (local.get $b))))

  (func $i64sh (param $a i64) (param $oi i32)
    ${[0, 1, 5, 31, 32, 33, 47, 63, 64, 65].map((n, k) => `
    (i64.store offset=${80 * k} (local.get $oi) (i64.shl (local.get $a) (i64.const ${n})))
    (i64.store offset=${80 * k + 8} (local.get $oi) (i64.shr_u (local.get $a) (i64.const ${n})))
    (i64.store offset=${80 * k + 16} (local.get $oi) (i64.shr_s (local.get $a) (i64.const ${n})))
    (i64.store offset=${80 * k + 24} (local.get $oi) (i64.rotl (local.get $a) (i64.const ${n})))
    (i64.store offset=${80 * k + 32} (local.get $oi) (i64.rotr (local.get $a) (i64.const ${n})))
    (i64.store offset=${80 * k + 40} (local.get $oi) (i64.mul (local.get $a) (i64.const 0x9E3779B185EBCA87)))`).join('')})

  (func $lanes (param $i i32) (param $j i32) (param $of i32) (param $oi i32)
    (local $m v128)
    (local.set $m (i32x4.ne (i32x4.extend_low_i16x8_u (i16x8.extend_low_i8x16_u (v128.load32_zero (local.get $i))))
                            (i32x4.splat (i32.const 0))))
    (v128.store offset=0 (local.get $oi) (local.get $m))
    (v128.store offset=16 (local.get $oi) (i32x4.extend_low_i16x8_u (v128.load (local.get $j))))
    (v128.store offset=32 (local.get $oi) (i16x8.extend_low_i8x16_u (v128.load (local.get $j))))
    (v128.store offset=48 (local.get $oi) (v128.and (v128.load (local.get $i)) (v128.load (local.get $j))))
    (v128.store offset=0 (local.get $of)
      (v128.bitselect (v128.load (local.get $j)) (f32x4.splat (f32.const -1.5)) (local.get $m))))

  (func $bulk (param $oi i32)
    (local $k i32)
    (loop $l
      (i32.store8 offset=0x2f0000 (local.get $k) (i32.mul (local.get $k) (i32.const 37)))
      (local.set $k (i32.add (local.get $k) (i32.const 1)))
      (br_if $l (i32.lt_u (local.get $k) (i32.const 256))))
    (memory.copy (i32.const 0x2f0003) (i32.const 0x2f0000) (i32.const 101))
    (memory.copy (i32.const 0x2f0080) (i32.const 0x2f0085) (i32.const 77))
    (memory.fill (i32.const 0x2f0010) (i32.const 0x1a5) (i32.const 13))
    (memory.copy (local.get $oi) (i32.const 0x2f0000) (i32.const 256)))

  (func (export "run")
    (local $i i32) (local $j i32) (local $nf i32) (local $ni i32) (local $nl i32) (local $of i32) (local $oi i32)
    (local.set $nf (i32.load (i32.const ${COUNTS})))
    (local.set $ni (i32.load (i32.const ${COUNTS + 4})))
    (local.set $nl (i32.load (i32.const ${COUNTS + 8})))
    (local.set $of (i32.const ${OUT_F}))
    (local.set $oi (i32.const ${OUT_I}))
    (local.set $i (i32.const 0))
    (loop $a
      (local.set $j (i32.const 0))
      (loop $b
        (call $f32bin (f32.load offset=${IN_F} (i32.shl (local.get $i) (i32.const 2)))
                      (f32.load offset=${IN_F} (i32.shl (local.get $j) (i32.const 2))) (local.get $of) (local.get $oi))
        (local.set $of (i32.add (local.get $of) (i32.const 40)))
        (local.set $oi (i32.add (local.get $oi) (i32.const 52)))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br_if $b (i32.lt_u (local.get $j) (local.get $nf))))
      (call $f32un (f32.load offset=${IN_F} (i32.shl (local.get $i) (i32.const 2))) (local.get $of) (local.get $oi))
      (local.set $of (i32.add (local.get $of) (i32.const 96)))
      (local.set $oi (i32.add (local.get $oi) (i32.const 24)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $a (i32.lt_u (local.get $i) (local.get $nf))))
    (local.set $i (i32.const 0))
    (loop $c
      (call $i32un (i32.load offset=${IN_I} (i32.shl (local.get $i) (i32.const 2))) (local.get $of) (local.get $oi))
      (local.set $of (i32.add (local.get $of) (i32.const 48)))
      (local.set $oi (i32.add (local.get $oi) (i32.const 32)))
      (local.set $j (i32.const 0))
      (loop $d
        (call $i32bin (i32.load offset=${IN_I} (i32.shl (local.get $i) (i32.const 2)))
                      (i32.load offset=${IN_I} (i32.shl (local.get $j) (i32.const 2))) (local.get $oi))
        (local.set $oi (i32.add (local.get $oi) (i32.const 72)))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br_if $d (i32.lt_u (local.get $j) (local.get $ni))))
      (call $lanes (i32.add (i32.const ${IN_I}) (i32.shl (local.get $i) (i32.const 2)))
                   (i32.add (i32.const ${IN_I}) (i32.shl (i32.rem_u (i32.mul (local.get $i) (i32.const 7)) (local.get $ni)) (i32.const 2)))
                   (local.get $of) (local.get $oi))
      (local.set $of (i32.add (local.get $of) (i32.const 16)))
      (local.set $oi (i32.add (local.get $oi) (i32.const 64)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $c (i32.lt_u (local.get $i) (local.get $ni))))
    (local.set $i (i32.const 0))
    (loop $e
      (call $i64sh (i64.load offset=${IN_L} (i32.shl (local.get $i) (i32.const 3))) (local.get $oi))
      (local.set $oi (i32.add (local.get $oi) (i32.const 800)))
      (local.set $j (i32.const 0))
      (loop $f
        (call $i64bin (i64.load offset=${IN_L} (i32.shl (local.get $i) (i32.const 3)))
                      (i64.load offset=${IN_L} (i32.shl (local.get $j) (i32.const 3))) (local.get $oi))
        (local.set $oi (i32.add (local.get $oi) (i32.const 136)))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br_if $f (i32.lt_u (local.get $j) (local.get $nl))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $e (i32.lt_u (local.get $i) (local.get $nl))))
    (call $bulk (local.get $oi))))
`;

const F32 = [0, 0x80000000, 0x3f800000, 0xbf800000, 0x3f000000, 0xbf000000, 0x3fc00000, 0xbfc00000, 0x40200000, 0xc0200000,
  0x3effffff, 0xbeffffff, 0x3f7fffff, 0xbf7fffff, 0xbf800001, 0x4affffff, 0x4b000000, 0xcb000001, 0x4b7fffff,
  0x4effffff, 0x4f000000, 0xcf000000, 0xcf000001, 0x4f7fffff, 0x4f800000, 0x501502f9, 0xd01502f9,
  0x7f7fffff, 0xff7fffff, 0x00800000, 0x00000001, 0x007fffff, 0x80000001, 0x80400000,
  0x7f800000, 0xff800000, 0x7fc00000, 0x7fa00001, 0xffc00000, 0x40490fdb, 0xc2c98000, 0x0da24260, 0x000116c2];
const I32 = [0, 1, -1, 2, 7, 31, 32, 33, 63, 64, 0x7fffffff, 0x80000000, 0x80000001, 0xfffffffe, 0x12345678, 0xdeadbeef,
  0x00ff00ff, 16777217, 16777219, 0x7fffff80, 0x7fffffc0, 0x7fffffbf, 0xffffff80, 0xffffffc0, 0xffffff7f, 0x80000080,
  0x800000c0, 0x80000180, 0x80000081, 0x80000181, 0xffffff81, 0x80000141, 100, -100, -7, 0x55aa55aa];
const I64 = [0n, 1n, -1n, 0x7fffffffffffffffn, 0x8000000000000000n, 0xffffffffn, 0x100000000n, 0x123456789abcdef0n,
  31n, 32n, 33n, 63n, 64n, 65n, -32n, 0xC2B2AE3D27D4EB4Fn];
// and a few dozen fixed pseudo-random words
let s = 0x9e3779b9;
const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
for (let k = 0; k < 12; k++) F32.push(rnd());
for (let k = 0; k < 8; k++) I32.push(rnd());
for (let k = 0; k < 6; k++) I64.push((BigInt(rnd()) << 32n) | BigInt(rnd()));

function input() {
  const b = new Uint8Array(0x20000);
  const dv = new DataView(b.buffer);
  dv.setUint32(COUNTS, F32.length, true);
  dv.setUint32(COUNTS + 4, I32.length, true);
  dv.setUint32(COUNTS + 8, I64.length, true);
  F32.forEach((v, i) => dv.setUint32(IN_F + 4 * i, v >>> 0, true));
  I32.forEach((v, i) => dv.setUint32(IN_I + 4 * i, v >>> 0, true));
  I64.forEach((v, i) => dv.setBigUint64(IN_L + 8 * i, BigInt.asUintN(64, v), true));
  return b;
}

const isNaN32 = (w) => (w & 0x7f800000) === 0x7f800000 && (w & 0x7fffff) !== 0;
function diff(ref, got) {
  const a = new Uint32Array(ref.buffer, ref.byteOffset, ref.length / 4);
  const b = new Uint32Array(got.buffer, got.byteOffset, got.length / 4);
  const bad = [];
  let nan = 0;
  for (let k = 0; k < a.length; k++) {
    if (a[k] === b[k]) continue;
    const off = k * 4;
    if (off < OUT_I - OUT_F && isNaN32(a[k]) && isNaN32(b[k])) { nan++; continue; }
    if (bad.length < 8) bad.push(`+0x${(OUT_F + off).toString(16)}: v8 ${a[k].toString(16)} x86 ${b[k].toString(16)}`);
    else bad.push(null);
  }
  return { bad, nan };
}

test('the Pentium III translation computes what V8 computes, op by op', { skip: !CLANG && 'clang not installed' }, async () => {
  const bin = await assemble(WAT, 'ops.wat');
  // V8
  const memory = new WebAssembly.Memory({ initial: 64, maximum: 64, shared: true });
  const { exports } = await WebAssembly.instantiate(await WebAssembly.compile(bin), { env: { mem: memory } });
  const u8 = new Uint8Array(memory.buffer);
  const inp = input();
  u8.set(inp, 0);
  exports.run();
  const ref = u8.slice(OUT_F, OUT_END);
  // native
  const dir = mkdtempSync(join(tmpdir(), 'qg-x86-'));
  try {
    const { asm, header } = translate(bin, { target: 'elf' });
    writeFileSync(join(dir, 'ops.s'), asm);
    writeFileSync(join(dir, 'qg_sim.h'), header);
    writeFileSync(join(dir, 'driver.c'), `#include "sys.h"
#include "qg_sim.h"
void qg_rt_trap(uint32_t c) { (void)c; die("trap"); }
uint32_t qg_rt_wait32(uint32_t a, uint32_t o, uint32_t e, uint32_t l, uint32_t h) { (void)a; (void)o; (void)e; (void)l; (void)h; return 1; }
uint32_t qg_rt_notify(uint32_t a, uint32_t o, uint32_t c) { (void)a; (void)o; (void)c; return 0; }
int main(int argc, char **argv) {
  uint32_t n; uint8_t *in = readfile(argv[1], &n);
  if (argc < 3 || !in) die("usage: driver in out");
  memcpy(qg_mem, in, n);
  qg_run();
  return writefile(argv[2], qg_mem + ${OUT_F}, ${OUT_END - OUT_F}) ? 0 : 1;
}
`);
    writeFileSync(join(dir, 'in.bin'), inp);
    const exe = join(dir, 'driver');
    execFileSync('clang', [...CFLAGS, `-I${dir}`, `-I${resolve('harness/native')}`, join(dir, 'driver.c'), join(dir, 'ops.s'), '-o', exe]);
    const runs = [['native', exe, []]];
    if (QEMU) runs.push(['qemu pentium3', 'qemu-i386', ['-cpu', 'pentium3', exe]]);
    for (const [name, cmd, pre] of runs) {
      const outFile = join(dir, `out-${runs.indexOf(runs.find((r) => r[0] === name))}.bin`);
      execFileSync(cmd, [...pre, join(dir, 'in.bin'), outFile]);
      const { bad, nan } = diff(ref, new Uint8Array(readFileSync(outFile)));
      assert.equal(bad.length, 0, `${name}: ${bad.length} words differ from V8 (${nan} NaN-only):\n${bad.filter(Boolean).join('\n')}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
