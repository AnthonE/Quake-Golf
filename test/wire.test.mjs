import test from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../net/wire.mjs';

test('input words round-trip every field', () => {
  const v = { yaw: 0x3fff, pitch: 1023, move: 0b1010, jump: 1, shot: 3, weapon: 1 };
  assert.deepEqual(W.unpackInput(W.packInput(v)), v);
  assert.equal(W.packInput({}), 0);
  assert.equal(W.packInput(v) & W.JUMP_BIT, W.JUMP_BIT);
});

test('input datagrams round-trip', () => {
  const words = [1, 2, 0xffffffff, 12345];
  const d = W.decodeInput(W.encodeInput({ seq: 7, firstTick: 1000, ackTick: 998, ackBits: 0x80000001, words }));
  assert.deepEqual([...d.words], words);
  assert.equal(d.firstTick, 1000);
  assert.equal(d.ackBits, 0x80000001);
});

test('bundles round-trip and their size matches the formula', () => {
  const rows = [0, 1, 2, 3].map((k) => Uint32Array.from({ length: W.NP }, (_, p) => k * 1000 + p));
  const events = [{ slot: 5, kind: W.EV_JOIN, tick: 99 }, { slot: 9, kind: W.EV_LEAVE, tick: 100 }];
  const buf = W.encodeBundle({ T: 100, rows, events, inAck: 98, slack: -1.5, late: 3 });
  assert.equal(buf.length, W.bundleSize(2));
  const b = W.decodeBundle(buf);
  assert.equal(b.T, 100);
  assert.deepEqual([...b.rows[3]], [...rows[3]]);
  assert.deepEqual(b.events, events);
  assert.equal(b.slack, -1.5);
  assert.equal(b.inAck, 98);
});

test('a 64-player bundle fits the worst-case datagram, even with 32 events', () => {
  assert.equal(W.bundleSize(0), 1040);
  assert.ok(W.bundleSize(32) <= W.MAX_DATAGRAM, `${W.bundleSize(32)} B`);
});

test('the handshake round-trips and rejects are recognised', () => {
  const h = W.decodeHello(W.encodeHello({ maxDatagram: 1200, wasmPrefix: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), room: 2, nonce: 9 }));
  assert.equal(h.maxDatagram, 1200);
  assert.deepEqual([...h.wasmPrefix], [1, 2, 3, 4, 5, 6, 7, 8]);
  const w = W.decodeWelcome(W.encodeWelcome({ slot: 3, maxDatagram: 1400, joinTick: 50, seed: 7, serverTick: 46 }));
  assert.equal(w.slot, 3);
  assert.equal(w.tickUs, 8000);
  assert.deepEqual(W.decodeWelcome(W.encodeReject(W.REJECT.WASM)), { reject: W.REJECT.WASM });
});

test('the buffered reader keeps what it over-reads', async () => {
  const chunks = [new Uint8Array([1, 2, 3, 4, 5, 6]), new Uint8Array([7, 8])];
  const r = W.bufferedReader({ read: async () => (chunks.length ? { value: chunks.shift(), done: false } : { done: true }) });
  assert.deepEqual([...await r.read(4)], [1, 2, 3, 4]);
  assert.deepEqual([...await r.read(4)], [5, 6, 7, 8]);
});

test('compare refuses traces of different length or without a log hash', async () => {
  const { compareTraces } = await import('../tools/compare.mjs');
  const base = { terrainHash: 1n, logHash: 2n, ticks: 256, nInt: 2, tickHashes: new BigUint64Array(256), intervalHashes: new BigUint64Array(2), sliceDigests: new BigUint64Array(256) };
  assert.equal(compareTraces(base, { ...base }).ok, true);
  assert.match(compareTraces(base, { ...base, ticks: 128, nInt: 1 }).what, /lengths differ/);
  assert.match(compareTraces(base, { ...base, logHash: 0n }).what, /no log hash/);
  const other = { ...base, intervalHashes: BigUint64Array.of(0n, 9n) };
  assert.match(compareTraces(base, other).what, /interval hash 1/);
});

test('a stamped copy of a shared body equals a bundle encoded for that recipient', () => {
  const rows = [0, 1, 2, 3].map((k) => Uint32Array.from({ length: W.NP }, (_, p) => k * 7 + p));
  const events = [{ slot: 2, kind: W.EV_JOIN, tick: 40 }];
  const body = W.encodeBundle({ T: 41, rows, events, inAck: 0, slack: 0, late: 0 });
  const stamped = W.stampTrailer(body.slice(), { inAck: 39, slack: -2.25, late: 7 });
  assert.deepEqual([...stamped], [...W.encodeBundle({ T: 41, rows, events, inAck: 39, slack: -2.25, late: 7 })]);
  assert.equal(body[body.length - 2], 0, 'the shared body is untouched');
});
