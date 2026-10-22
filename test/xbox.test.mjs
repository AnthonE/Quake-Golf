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
    const { trace } = await replay({ bytes: readFileSync('build/xbox/game.wasm'), log: parseLog(readFileSync(join(dir, 'match.qgl'))), ticks: 1800 });
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

// The neural golfer on the Xbox core (xbox/brain.c, the legs in game.c): the
// same genome rebuilds V8's weights and makes V8's decisions bit for bit, and
// the golfer bred into the build plays a hole the browser replays.
test('the neural golfer on the Xbox core: V8\'s brain bit for bit, and a hole V8 replays', { skip: !CLANG && 'clang not installed' }, async () => {
  const { Brain, features } = await import('../client/brain.mjs');
  const { newMemory, instantiate, Sim } = await import('../harness/core.mjs');
  const { View } = await import('../src/view.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'qg-xbox-brain-'));
  try {
    buildX86({ out: dir });
    const exe = join(dir, 'xbox-headless');
    const G = 'qg2:7v_AAAEAAUACgAPA__8';
    const brainRun = (pre) => JSON.parse(execFileSync(pre[0], [...pre.slice(1), '--brain', G, '--seeds', '1,7,11,23'], { encoding: 'utf8' }));
    const c = brainRun([exe]);
    assert.equal(c.weights.toString(16), 'ffac99fb', 'the weights, as test/brain.test.mjs pins them in V8');
    const dv = new DataView(new ArrayBuffer(4));
    const fl = (u) => { dv.setUint32(0, u); return dv.getFloat32(0); };
    const bits = (x) => { dv.setFloat32(0, x); return dv.getUint32(0); };
    const brain = new Brain(G);
    const module = await WebAssembly.compile(readFileSync('build/xbox/game.wasm'));
    for (const h of c.holes) {
      const memory = newMemory();
      const sim = new Sim(await instantiate(module, memory), memory);
      sim.init(h.seed);
      const x = features(new View(memory.buffer), h.ball.map(fl), h.cup.map(fl));
      assert.deepEqual(Array.from(x, bits), h.x, `course ${h.seed}: the features`);
      const d = brain.decide(x);
      assert.deepEqual([bits(d.dh), bits(d.turn)], [h.dh, h.turn], `course ${h.seed}: the shot`);
    }

    const golfer = readFileSync('xbox/golfer.h', 'utf8').match(/GOLFER_DEFAULT "(qg2:[A-Za-z0-9_-]+)"/)[1];
    const play = (pre, out) => JSON.parse(execFileSync(pre[0], [...pre.slice(1), '--out', out, '--players', '0', '--cpu', '1', '--genome', golfer,
      '--seed', '7', '--ticks', '40000'], { encoding: 'utf8' }).trim());
    const s = play([exe], dir);
    assert.deepEqual(s.sunk, [1], 'the golfer sank course 7');
    assert.ok(s.strokes[0] >= 1 && s.strokes[0] <= 9, `${s.strokes[0]} strokes`);
    const native = decodeTrace(readFileSync(join(dir, 'match.qgh')));
    const log = parseLog(readFileSync(join(dir, 'match.qgl')));
    const { trace } = await replay({ bytes: readFileSync('build/xbox/game.wasm'), log, ticks: log.ticks });
    const r = compareTraces(decodeTrace(trace), native);
    assert.ok(r.ok, `V8 vs the Xbox core's neural golfer: ${r.what}`);

    if (QEMU) {
      assert.deepEqual(brainRun(['qemu-i386', '-cpu', 'pentium3', exe]), c, 'the brain under qemu pentium3');
      const p3 = join(dir, 'p3');
      execFileSync('mkdir', ['-p', p3]);
      assert.deepEqual(play(['qemu-i386', '-cpu', 'pentium3', exe], p3).strokes, s.strokes);
      const q = compareTraces(native, decodeTrace(readFileSync(join(p3, 'match.qgh'))));
      assert.ok(q.ok, `native vs qemu pentium3: ${q.what}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
