import test from 'node:test';
import assert from 'node:assert/strict';
import { splitArgs, expandMacros, constants, conditionals, forbid, stripComments, assemble } from '../tools/asm.mjs';
import { makeMacros } from '../src/macros.mjs';
import * as L from '../src/layout.mjs';

test('splitArgs keeps groups and @(expr) whole', () => {
  assert.deepEqual(splitArgs('f32 @(PX + 4) (local.get $i)'), ['f32', '@(PX + 4)', '(local.get $i)']);
  assert.deepEqual(splitArgs('  $i (i32.const 0) (call $f (i32.const 1))'), ['$i', '(i32.const 0)', '(call $f (i32.const 1))']);
});

test('ld folds the base into the memarg and scales the index', () => {
  const m = makeMacros({ DEBUG: false });
  assert.equal(expandMacros('(!ld f32 @PX (local.get $i))', m), '(f32.load offset=@PX (i32.shl (local.get $i) (i32.const 2)))');
  assert.equal(expandMacros('(!ld u8 @FLAGS (local.get $i))', m), '(i32.load8_u offset=@FLAGS (local.get $i))');
  assert.equal(constants('offset=@PX', L), `offset=${L.PX}`);
  assert.equal(constants('@(NCELL * 4)', L), String(L.NCELL * 4));
});

test('macros nest and loops get fresh labels', () => {
  const m = makeMacros({ DEBUG: false });
  const out = expandMacros('(!for $i (i32.const 0) (i32.const 4) (!inc $n)) (!for $j (i32.const 0) (i32.const 2) (nop))', m);
  assert.ok(!out.includes('(!'));
  const labels = out.match(/\$brk\d+/g);
  assert.equal(new Set(labels).size, 2);
});

test('debug-only code vanishes from release builds', () => {
  assert.equal(expandMacros('(!chk (local.get $x) 1 (local.get $i))', makeMacros({ DEBUG: false })), '');
  assert.match(expandMacros('(!chk (local.get $x) 1 (local.get $i))', makeMacros({ DEBUG: true })), /assert_finite/);
  assert.equal(conditionals('a\n#if DEBUG\nb\n#else\nc\n#endif\nd', { DEBUG: false }).replace(/\n+/g, ' ').trim(), 'a c d');
});

test('comments are stripped, strings kept', () => {
  assert.equal(stripComments('(a) ;; gone\n(b "x;;y") (; also gone ;)').replace(/\s+/g, ' ').trim(), '(a) (b "x;;y")');
  // escaped quotes stay inside the string, block comments nest
  assert.equal(stripComments('(a "q\\"(;") (; outer (; inner ;) still ;) b').replace(/\s+/g, ' ').trim(), '(a "q\\"(;") b');
  assert.throws(() => stripComments('(a "never closed'), /unterminated string/);
  assert.throws(() => stripComments('(; never closed'), /unterminated block comment/);
});

test('the determinism rules are enforced by the assembler', () => {
  for (const bad of ['(memory.grow (i32.const 1))', '(f32x4.relaxed_madd)', '(data (i32.const 0) "x")', '(global $g (mut i32) (i32.const 0))', '(global $g (export "g") (mut i32) (i32.const 0))']) {
    assert.throws(() => forbid(bad), /forbidden/, bad);
  }
  forbid('(global $g i32 (i32.const 0))');
});

test('the binary is checked too, so no spelling sneaks a banned construct through', async () => {
  for (const bad of [
    '(module (memory 1) (func (drop (memory.grow (i32.const 1)))))',
    '(module (memory 1) (data (i32.const 0) "x"))',
    '(module (global (mut i32) (i32.const 0)))',
    '(module (import "e" "g" (global (mut i32))))',
  ]) {
    await assert.rejects(assemble(bad), /forbidden in the sim \(binary\)/, bad);
  }
});

test('wabt assembles shared memory and atomics', async () => {
  const bin = await assemble('(module (import "env" "mem" (memory 1 1 shared)) (func (export "f") (result i32) (i32.atomic.load (i32.const 0))))');
  assert.ok(WebAssembly.validate(bin));
});
