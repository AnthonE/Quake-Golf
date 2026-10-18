import test from 'node:test';
import assert from 'node:assert/strict';
import { xxh64 } from '../tools/xxh64.mjs';
import { newSim } from './helpers.mjs';
import { NET } from '../src/layout.mjs';

test('the BigInt reference matches the published XXH64 vector', () => {
  assert.equal(xxh64(new Uint8Array(0), 0n), 0xEF46DB3751D8E999n);
});

test('the wasm XXH64 matches the reference at every length and seed', async () => {
  const sim = await newSim();
  for (const len of [0, 1, 3, 4, 7, 8, 15, 31, 32, 33, 63, 64, 100, 1024, 4096, 4099]) {
    for (const seed of [0n, 5n, 0xFFFFFFFFFFFFFFFFn]) {
      const buf = new Uint8Array(len).map((_, i) => (i * 131 + len * 7) & 255);
      sim.u8.set(buf, NET);
      const got = BigInt.asUintN(64, sim.x.xxh64(NET, len, BigInt.asIntN(64, seed)));
      assert.equal(got, xxh64(buf, seed), `len ${len} seed ${seed}`);
    }
  }
});
