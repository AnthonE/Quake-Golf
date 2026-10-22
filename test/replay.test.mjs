import test from 'node:test';
import assert from 'node:assert/strict';
import { wasmBytes } from './helpers.mjs';
import { parseLog } from '../harness/core.mjs';
import { playHoles } from '../tools/gengame.mjs';
import { Referee } from '../net/referee.mjs';
import { encodeReplay, decodeReplay, checkReplay } from '../net/replay.mjs';
import * as W from '../net/wire.mjs';
import * as L from '../src/layout.mjs';

// A bot match as the relay records it, the referee's hashes over it, and a keyframe midway.
async function room() {
  const { log } = await playHoles({ bytes: wasmBytes(), courseSeed: 5, bots: 3, ticks: 2400, delay: 6, joins: [0, 300, 900] });
  const parsed = parseLog(log);
  const record = [];
  let prev = new Uint32Array(W.NP);
  for (let k = 0, t = 0; t < parsed.ticks; t++) {
    const ev = [], cur = prev.slice();
    for (; k < parsed.count && parsed.tickOf(k) === t; k++) {
      const o = 32 + k * L.REC;
      if (log[o + 4] === L.EV_JOIN) ev.push({ slot: log[o + 5], kind: W.EV_JOIN });
      if (log[o + 4] === L.EV_INPUT) cur[log[o + 5]] = new DataView(log.buffer, log.byteOffset + o + 8, 4).getUint32(0, true);
    }
    record.push(W.encodeTick(ev, prev, cur));
    prev = cur;
  }
  const ref = await Referee.create(wasmBytes());
  ref.reset(parsed.courseSeed);
  const base = new W.TickBase();
  const hashes = [];
  let key = null;
  for (const [t, parts] of record.entries()) {
    const { events, words } = base.apply(parts);
    const iv = ref.step({ ev: events, w: words });
    if (iv) hashes.push([iv.tick, iv.hash]);
    if (t === 1000) key = await ref.key();
  }
  return { seed: parsed.courseSeed, record, hashes, key, prefix: await W.wasmPrefix(wasmBytes()) };
}

test('a replay from the room\'s start and one from a keyframe both check out; a changed tick does not', async () => {
  const { seed, record, hashes, key, prefix } = await room();
  const roomStart = 5000;
  const file = await encodeReplay({ prefix, seed, roomStart, from: roomStart, ticks: record, hashes });
  const r = await decodeReplay(file);
  assert.equal(r.seed, seed);
  assert.equal(r.ticks.length, record.length);
  assert.equal(r.ticks[7].tick, roomStart + 7);
  assert.deepEqual(r.ticks[7].parts, record[7]);
  assert.equal(r.hashes.size, hashes.length);
  const out = await checkReplay(wasmBytes(), r);
  assert.equal(out.compared, Math.floor(record.length / L.NSLICE));
  assert.deepEqual(out.wrong, []);
  assert.equal(out.players.length, 3);
  const bytes = record.reduce((a, parts) => a + parts.reduce((b, p) => b + p.length, 0), 0);
  assert.ok(file.length < bytes + 16 * hashes.length + 64, `${file.length} B for ${bytes} B of ticks`);

  // from the keyframe at sim tick 1408: the region, then the record since
  const region = await W.unpackKey(key.packed);
  const late = await decodeReplay(await encodeReplay({ prefix, seed, roomStart, from: roomStart + key.tick, ticks: record.slice(key.tick), hashes, region }));
  assert.equal(late.ticks[0].tick, roomStart + key.tick);
  const lateOut = await checkReplay(wasmBytes(), late);
  assert.equal(lateOut.compared, hashes.filter(([t]) => t > key.tick).length);
  assert.deepEqual(lateOut.wrong, []);

  // one player's aim in one tick, changed: every interval from there on differs
  const t = 1700;
  const forged = record.slice();
  const base = new W.TickBase();
  for (let k = 0; k < t; k++) base.apply(record[k]);
  const before = base.w.slice();
  const after = before.slice();
  base.apply(record[t]);
  after.set(base.w);
  after[0] = (after[0] ^ 0x40) >>> 0;
  forged[t] = W.encodeTick([], before, after);
  // the tick after is coded against the forged words, so recode it against them
  const next = after.slice();
  base.apply(record[t + 1]);
  next.set(base.w);
  forged[t + 1] = W.encodeTick([], after, next);
  const bad = await checkReplay(wasmBytes(), await decodeReplay(await encodeReplay({ prefix, seed, roomStart, from: roomStart, ticks: forged, hashes })));
  assert.ok(bad.wrong.length > 0 && bad.wrong[0] > t, `differs from sim tick ${bad.wrong[0]}`);

  // another build's replay is refused
  const other = prefix.slice();
  other[0] ^= 1;
  await assert.rejects(checkReplay(wasmBytes(), { ...r, prefix: other }), /another build/);
});
