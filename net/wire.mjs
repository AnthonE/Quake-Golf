// Wire format v0, little-endian. Shared by the relay, the bots and the browser client.
//
// Input word (32 bits): yaw b0-13 | pitch b14-23 | move b24-27 | jump b28 | shot counter b29-30 | weapon b31
//
// Input datagram, client to server (16 + 4n B):
//   0 u8 0x01 | 1 u8 n | 2 u16 seq | 4 u32 first_tick | 8 u32 ack_tick | 12 u32 ack_bits | 16 n x u32 words
//   (only ticks the server hasn't closed; ack_bits bit k = has bundle tick ack_tick-1-k)
//
// Bundle datagram, server to client, every second tick (1,040 B + 2 per event, padded to 4):
//   0 u8 0x02 | 1 u8 nb=4 | 2 u8 np=64 | 3 u8 ne | 4 u32 T | 8 nb x np x u32 (row k is tick T-k)
//   | ne x (u8 slot, u8 kind<<4 | age) | pad | trailer: u32 in_ack | i16 slack (1/16 ms, negative = late) | u8 late | u8 flags
//
// Handshake on a client-opened bidirectional stream:
//   hello   (24 B): 0x10 | proto | u16 client max datagram | u8[8] sha-256(game.wasm) prefix | u32 room | u32 nonce | u32 0
//   welcome (32 B): 0x11 | slot | u16 server max datagram | u32 join_tick | u32 seed | u32 server_tick | u32 tick_us | u8 send_every | u8 nb | u8 np | u8 0 | u64 0
//   reject  (4 B):  0x1f | reason (1 wasm mismatch, 2 room full, 3 protocol) | 0 | 0

export const PROTO = 1;
export const T_INPUT = 0x01;
export const T_BUNDLE = 0x02;
export const T_HELLO = 0x10;
export const T_WELCOME = 0x11;
export const T_REJECT = 0x1f;
export const REJECT = { WASM: 1, FULL: 2, PROTO: 3 };
export const EV_JOIN = 1;
export const EV_LEAVE = 2;

export const TICK_US = 8000;
export const TICK_MS = TICK_US / 1000;
export const SEND_EVERY = 2;
export const NB = 4;
export const NP = 64;
export const MAX_DATAGRAM = 1161; // quinn's worst case on a 1,200-byte path, minus the session prefix
export const MAX_INPUTS = 64;
export const RING = 256; // ticks of history kept per player; a power of two

export function packInput({ yaw = 0, pitch = 0, move = 0, jump = 0, shot = 0, weapon = 0 }) {
  return ((yaw & 0x3fff) | ((pitch & 0x3ff) << 14) | ((move & 0xf) << 24) | ((jump & 1) << 28) | ((shot & 3) << 29) | ((weapon & 1) << 31)) >>> 0;
}

export function unpackInput(w) {
  return { yaw: w & 0x3fff, pitch: (w >>> 14) & 0x3ff, move: (w >>> 24) & 0xf, jump: (w >>> 28) & 1, shot: (w >>> 29) & 3, weapon: w >>> 31 };
}

export const JUMP_BIT = 1 << 28;
export const MOVE_BITS = 0xf << 24;

export function encodeInput({ seq, firstTick, ackTick, ackBits, words }) {
  const n = Math.min(words.length, MAX_INPUTS);
  const buf = new Uint8Array(16 + 4 * n);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, T_INPUT);
  dv.setUint8(1, n);
  dv.setUint16(2, seq & 0xffff, true);
  dv.setUint32(4, firstTick >>> 0, true);
  dv.setUint32(8, ackTick >>> 0, true);
  dv.setUint32(12, ackBits >>> 0, true);
  for (let i = 0; i < n; i++) dv.setUint32(16 + 4 * i, words[i] >>> 0, true);
  return buf;
}

export function decodeInput(buf) {
  if (buf.length < 16 || buf[0] !== T_INPUT) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = dv.getUint8(1);
  if (buf.length < 16 + 4 * n) return null;
  const words = new Uint32Array(n);
  for (let i = 0; i < n; i++) words[i] = dv.getUint32(16 + 4 * i, true);
  return { seq: dv.getUint16(2, true), firstTick: dv.getUint32(4, true), ackTick: dv.getUint32(8, true), ackBits: dv.getUint32(12, true), words };
}

export function bundleSize(ne) {
  return 8 + NB * NP * 4 + ((2 * ne + 3) & ~3) + 8;
}

// rows: NB Uint32Array(NP), row k = tick T-k. events: [{ slot, kind, tick }].
export function encodeBundle({ T, rows, events, inAck, slack, late, flags = 0 }) {
  const ne = events.length;
  const buf = new Uint8Array(bundleSize(ne));
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, T_BUNDLE);
  dv.setUint8(1, NB);
  dv.setUint8(2, NP);
  dv.setUint8(3, ne);
  dv.setUint32(4, T >>> 0, true);
  for (let k = 0; k < NB; k++) {
    const row = rows[k];
    for (let p = 0; p < NP; p++) dv.setUint32(8 + 4 * (k * NP + p), row ? row[p] : 0, true);
  }
  let o = 8 + NB * NP * 4;
  for (const e of events) {
    dv.setUint8(o++, e.slot);
    dv.setUint8(o++, (e.kind << 4) | ((T - e.tick) & 0xf));
  }
  o = buf.length - 8;
  dv.setUint32(o, inAck >>> 0, true);
  dv.setInt16(o + 4, Math.max(-32768, Math.min(32767, Math.round(slack * 16))), true);
  dv.setUint8(o + 6, late & 0xff);
  dv.setUint8(o + 7, flags);
  return buf;
}

export function decodeBundle(buf) {
  if (buf.length < 16 || buf[0] !== T_BUNDLE) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const nb = dv.getUint8(1);
  const np = dv.getUint8(2);
  const ne = dv.getUint8(3);
  const T = dv.getUint32(4, true);
  if (buf.length < 8 + nb * np * 4 + 2 * ne + 8) return null;
  const rows = [];
  for (let k = 0; k < nb; k++) {
    const row = new Uint32Array(np);
    for (let p = 0; p < np; p++) row[p] = dv.getUint32(8 + 4 * (k * np + p), true);
    rows.push(row);
  }
  const events = [];
  let o = 8 + nb * np * 4;
  for (let i = 0; i < ne; i++) {
    const slot = dv.getUint8(o++);
    const b = dv.getUint8(o++);
    events.push({ slot, kind: b >> 4, tick: T - (b & 0xf) });
  }
  o = buf.length - 8;
  return { T, nb, np, rows, events, inAck: dv.getUint32(o, true), slack: dv.getInt16(o + 4, true) / 16, late: dv.getUint8(o + 6), flags: dv.getUint8(o + 7) };
}

export function encodeHello({ maxDatagram, wasmPrefix, room = 0, nonce = 0 }) {
  const buf = new Uint8Array(24);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, T_HELLO);
  dv.setUint8(1, PROTO);
  dv.setUint16(2, maxDatagram, true);
  buf.set(wasmPrefix.subarray(0, 8), 4);
  dv.setUint32(12, room, true);
  dv.setUint32(16, nonce >>> 0, true);
  return buf;
}

export function decodeHello(buf) {
  if (buf.length < 24 || buf[0] !== T_HELLO) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { proto: dv.getUint8(1), maxDatagram: dv.getUint16(2, true), wasmPrefix: buf.slice(4, 12), room: dv.getUint32(12, true), nonce: dv.getUint32(16, true) };
}

export function encodeWelcome({ slot, maxDatagram, joinTick, seed, serverTick }) {
  const buf = new Uint8Array(32);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, T_WELCOME);
  dv.setUint8(1, slot);
  dv.setUint16(2, maxDatagram, true);
  dv.setUint32(4, joinTick, true);
  dv.setUint32(8, seed, true);
  dv.setUint32(12, serverTick, true);
  dv.setUint32(16, TICK_US, true);
  dv.setUint8(20, SEND_EVERY);
  dv.setUint8(21, NB);
  dv.setUint8(22, NP);
  return buf;
}

export function decodeWelcome(buf) {
  if (buf.length >= 4 && buf[0] === T_REJECT) return { reject: buf[1] };
  if (buf.length < 32 || buf[0] !== T_WELCOME) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    slot: dv.getUint8(1), maxDatagram: dv.getUint16(2, true), joinTick: dv.getUint32(4, true), seed: dv.getUint32(8, true),
    serverTick: dv.getUint32(12, true), tickUs: dv.getUint32(16, true), sendEvery: dv.getUint8(20), nb: dv.getUint8(21), np: dv.getUint8(22),
  };
}

export const encodeReject = (reason) => new Uint8Array([T_REJECT, reason, 0, 0]);

// A stream reader that keeps what it over-reads, since handshake messages
// may arrive split or glued together.
export function bufferedReader(reader) {
  let buf = new Uint8Array(0);
  return {
    async read(n) {
      while (buf.length < n) {
        const { value, done } = await reader.read();
        if (done) break;
        const next = new Uint8Array(buf.length + value.length);
        next.set(buf, 0);
        next.set(value, buf.length);
        buf = next;
      }
      const out = buf.subarray(0, Math.min(n, buf.length));
      buf = buf.subarray(out.length);
      return out;
    },
  };
}

export async function wasmPrefix(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)).subarray(0, 8);
}

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}
