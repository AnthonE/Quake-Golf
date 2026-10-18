// The Xbox game core (xbox/game.c over the Pentium III translation), played
// by scripted controllers in xbox/headless.c: two players join, wait out the
// countdown, drive with a rocket and a grenade, and walk. The match it records
// must replay in V8 to the same region hash on every tick, and the same
// binary under qemu-i386 -cpu pentium3 must match too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildX86 } from '../tools/x86.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { compareTraces } from '../tools/compare.mjs';

const has = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; } catch { return false; } };
const CLANG = has('clang', ['--version']);
const QEMU = has('qemu-i386', ['-version']);

test('a scripted two-player hole on the Xbox game core replays in V8 tick for tick', { skip: !CLANG && 'clang not installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qg-xbox-'));
  try {
    buildX86({ out: dir });
    const run = (cmd, pre, out) => JSON.parse(execFileSync(cmd, [...pre, '--out', out, '--players', '2', '--ticks', '1800'], { encoding: 'utf8' }).trim());
    const exe = join(dir, 'xbox-headless');
    const s = run(exe, [], dir);
    assert.deepEqual(s.strokes, [1, 1], 'each player took one shot');
    assert.ok(s.ballMovedCm[0] > 15000, `the rocket drive went ${s.ballMovedCm[0] / 100} m`);
    assert.ok(s.ballMovedCm[1] > 500, `the grenade went ${s.ballMovedCm[1] / 100} m`);
    assert.equal(s.frames, 7);

    const native = decodeTrace(readFileSync(join(dir, 'match.qgh')));
    const { trace } = await replay({ bytes: readFileSync('build/game.wasm'), log: parseLog(readFileSync(join(dir, 'match.qgl'))), ticks: 1800 });
    const c = compareTraces(decodeTrace(trace), native);
    assert.ok(c.ok, `V8 vs the Xbox core: ${c.what}`);

    if (QEMU) {
      const p3 = join(dir, 'p3');
      execFileSync('mkdir', ['-p', p3]);
      run('qemu-i386', ['-cpu', 'pentium3', exe], p3);
      const q = compareTraces(native, decodeTrace(readFileSync(join(p3, 'match.qgh'))));
      assert.ok(q.ok, `native vs qemu pentium3: ${q.what}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
