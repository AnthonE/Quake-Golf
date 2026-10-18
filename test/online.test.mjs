// The Xbox client's keyframe path: xbox/inflate.c against what the referee
// sends, net/wire.mjs packKey (the region, its floats' bytes grouped, then
// gzipped by the platform's CompressionStream). Real regions, a fresh course
// and a pit of thousands of balls, plus data that forces stored blocks and long
// matches, each unpacked by the C code and compared byte for byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { packKey, shuffle } from '../net/wire.mjs';
import { newMemory, instantiate, parseLog, Sim } from '../harness/core.mjs';
import { generate } from '../tools/genlog.mjs';
import * as L from '../src/layout.mjs';
import { CFLAGS } from '../tools/x86.mjs';

const has = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; } catch { return false; } };
const CLANG = has('clang', ['--version']);

async function region(ticks) {
  const bytes = readFileSync('build/game.wasm');
  const memory = newMemory();
  const sim = new Sim(await instantiate(await WebAssembly.compile(bytes), memory), memory);
  const log = parseLog(generate({ ticks }));
  sim.init(log.courseSeed);
  for (let t = 0; t < ticks; t++) { sim.feed(log, t); sim.x.step(); }
  return { bytes: sim.regionCopy(), balls: sim.nballs };
}

test('xbox/inflate.c unpacks every keyframe the referee could send', { skip: !CLANG && 'clang not installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qg-inflate-'));
  try {
    writeFileSync(join(dir, 'driver.c'), `#include "sys.h"
#include "inflate.h"
static uint8_t unpacked[1 << 21];
int main(int argc, char **argv) {
  uint32_t n; uint8_t *in = readfile(argv[1], &n);
  if (argc < 3 || !in) die("usage: driver in.gz out");
  int32_t got = gunzip(in, n, unpacked, sizeof unpacked);
  if (got < 0) die("gunzip failed");
  return writefile(argv[2], unpacked, (uint32_t)got) ? 0 : 1;
}
`);
    const exe = join(dir, 'driver');
    execFileSync('clang', [...CFLAGS, `-I${resolve('harness/native')}`, `-I${resolve('xbox')}`, join(dir, 'driver.c'), resolve('xbox/inflate.c'), '-o', exe]);
    const fresh = await region(1);
    const pit = await region(4000);
    assert.ok(pit.balls > 800, `the pit has ${pit.balls} balls`);
    let s = 1;
    const noise = new Uint8Array(300000).map(() => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s & 255; });
    const runs = new Uint8Array(L.REGION_SIZE).map((_, i) => (i >> 12) & 1 ? 0 : (i * 7) & 255);
    const cases = [['fresh course', fresh.bytes, true], [`${pit.balls}-ball pit`, pit.bytes, true], ['noise (stored blocks)', noise, false], ['runs (long matches)', runs, false]];
    for (const [name, raw, isRegion] of cases) {
      const packed = isRegion ? await packKey(raw) : new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
      writeFileSync(join(dir, 'in.gz'), packed);
      execFileSync(exe, [join(dir, 'in.gz'), join(dir, 'out')]);
      const out = new Uint8Array(readFileSync(join(dir, 'out')));
      const want = isRegion ? shuffle(raw) : raw;
      assert.equal(out.length, want.length, `${name}: length`);
      assert.ok(Buffer.from(out).equals(Buffer.from(want)), `${name}: ${packed.length} B packed did not unpack to the same bytes`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
