// Replays: a room's record as a file, the closed ticks coded as the wire codes
// them, with the referee's interval hashes, so whoever plays it back checks
// every interval against the relay's. A 256-player minute is a few hundred KB.
//   head (40 B): 'QGR1' | u8[8] sha-256(game.wasm) prefix | u32 seed | u32 room_start
//     | u32 from (the server tick it starts at) | u32 n ticks | u32 hashes | u32 key bytes | u32 body bytes
//   hashes x (u32 sim tick | u32 0 | u64 the referee's interval hash)
//   key: the region at `from`, packed (wire.mjs packKey); none when from is the room's start
//   body: the n ticks as a fill carries them (u8 parts | parts x (u16 bytes | the part)), gzipped
// The relay writes one when a room ends (--replays <dir>); the page plays one
// (?replay=<url>); node tools/replay.mjs checks one.
import * as W from './wire.mjs';

const MAGIC = [0x51, 0x47, 0x52, 0x31]; // QGR1
const HEAD = 40;

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

// ticks: each tick's parts, from `from` on; hashes: [[sim tick, bigint]];
// region: the region at `from`, or null when from is roomStart.
/** @param {{ prefix: Uint8Array, seed: number, roomStart: number, from: number, ticks: Uint8Array[][], hashes: [number, bigint][], region?: Uint8Array | null }} r */
export async function encodeReplay({ prefix, seed, roomStart, from, ticks, hashes, region = null }) {
  const fill = W.encodeFill(from, ticks);
  const body = await pipe(fill.subarray(16), new CompressionStream('gzip'));
  const key = region ? await W.packKey(region) : new Uint8Array(0);
  const buf = new Uint8Array(HEAD + 16 * hashes.length + key.length + body.length);
  const dv = new DataView(buf.buffer);
  buf.set(MAGIC, 0);
  buf.set(prefix.subarray(0, 8), 4);
  [seed, roomStart, from, ticks.length, hashes.length, key.length, body.length].forEach((v, k) => dv.setUint32(12 + 4 * k, v >>> 0, true));
  let o = HEAD;
  for (const [t, h] of hashes) { dv.setUint32(o, t, true); dv.setBigUint64(o + 8, BigInt.asUintN(64, h), true); o += 16; }
  buf.set(key, o);
  buf.set(body, o + key.length);
  return buf;
}

// { prefix, seed, roomStart, from, ticks: [{ tick, parts }], hashes: Map(sim tick -> bigint), region (or null) }
export async function decodeReplay(buf) {
  if (buf.length < HEAD || MAGIC.some((b, i) => buf[i] !== b)) throw new Error('not a replay (.qgr)');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const [seed, roomStart, from, n, nh, keyBytes, bodyBytes] = [0, 1, 2, 3, 4, 5, 6].map((k) => dv.getUint32(12 + 4 * k, true));
  const hashes = new Map();
  let o = HEAD;
  for (let k = 0; k < nh; k++, o += 16) hashes.set(dv.getUint32(o, true), dv.getBigUint64(o + 8, true));
  const region = keyBytes ? await W.unpackKey(buf.subarray(o, o + keyBytes)) : null;
  const body = await pipe(buf.subarray(o + keyBytes, o + keyBytes + bodyBytes), new DecompressionStream('gzip'));
  const ticks = W.decodeFillBody(from, n, body);
  if (ticks.length !== n) throw new Error(`a replay of ${n} ticks holds ${ticks.length}`);
  return { prefix: buf.slice(4, 12), seed, roomStart, from, ticks, hashes, region };
}

// Steps a replay on a referee and compares each interval it closes with the
// file's: { ticks, compared, wrong: [sim ticks], players: [{ slot, total, holes }] },
// the players as they stood when the room was fullest (by the end, they may all have left).
export async function checkReplay(bytes, r) {
  const { Referee } = await import('./referee.mjs');
  const { View } = await import('../src/view.mjs');
  const L = await import('../src/layout.mjs');
  const prefix = await W.wasmPrefix(bytes);
  if (prefix.some((b, i) => b !== r.prefix[i])) throw new Error('this replay is from another build of game.wasm');
  const ref = await Referee.create(bytes);
  ref.reset(r.seed, r.region);
  const base = new W.TickBase();
  if (r.region) base.seed(r.region); else base.reset();
  let compared = 0;
  const wrong = [];
  const view = new View(ref.u8.buffer);
  let players = [];
  const standings = () => {
    const now = [];
    for (let p = 0; p < L.NPLAYER; p++) { const pl = view.player(p); if (pl.live) now.push({ slot: p, total: pl.total, holes: pl.holes }); }
    if (now.length >= players.length) players = now;
  };
  for (const [k, { parts }] of r.ticks.entries()) {
    const { events, words } = base.apply(parts);
    const iv = ref.step({ ev: events, w: words });
    if (k % L.NSLICE === 0) standings();
    if (!iv || !r.hashes.has(iv.tick)) continue;
    compared++;
    if (r.hashes.get(iv.tick) !== iv.hash) wrong.push(iv.tick);
  }
  standings();
  players.sort((a, b) => a.total - b.total || a.slot - b.slot);
  return { ticks: r.ticks.length, compared, wrong, players };
}
