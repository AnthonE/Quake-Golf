// XXH64 in BigInt: slow, obviously correct, the reference the wasm is tested against.
const M = (1n << 64n) - 1n;
const P1 = 0x9E3779B185EBCA87n;
const P2 = 0xC2B2AE3D27D4EB4Fn;
const P3 = 0x165667B19E3779F9n;
const P4 = 0x85EBCA77C2B2AE63n;
const P5 = 0x27D4EB2F165667C5n;

const rotl = (x, r) => ((x << BigInt(r)) | (x >> BigInt(64 - r))) & M;
const round = (acc, input) => (rotl((acc + input * P2) & M, 31) * P1) & M;
const merge = (acc, val) => (((acc ^ round(0n, val)) * P1) + P4) & M;

export function xxh64(bytes, seed = 0n) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = bytes.length;
  let p = 0;
  let h;
  seed = BigInt.asUintN(64, BigInt(seed));
  if (len >= 32) {
    let v1 = (seed + P1 + P2) & M;
    let v2 = (seed + P2) & M;
    let v3 = seed;
    let v4 = (seed - P1) & M;
    while (p <= len - 32) {
      v1 = round(v1, dv.getBigUint64(p, true));
      v2 = round(v2, dv.getBigUint64(p + 8, true));
      v3 = round(v3, dv.getBigUint64(p + 16, true));
      v4 = round(v4, dv.getBigUint64(p + 24, true));
      p += 32;
    }
    h = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) & M;
    h = merge(h, v1);
    h = merge(h, v2);
    h = merge(h, v3);
    h = merge(h, v4);
  } else {
    h = (seed + P5) & M;
  }
  h = (h + BigInt(len)) & M;
  while (p + 8 <= len) {
    h ^= round(0n, dv.getBigUint64(p, true));
    h = ((rotl(h, 27) * P1) + P4) & M;
    p += 8;
  }
  if (p + 4 <= len) {
    h ^= (BigInt(dv.getUint32(p, true)) * P1) & M;
    h = ((rotl(h, 23) * P2) + P3) & M;
    p += 4;
  }
  while (p < len) {
    h ^= (BigInt(bytes[p]) * P5) & M;
    h = (rotl(h, 11) * P1) & M;
    p++;
  }
  h ^= h >> 33n;
  h = (h * P2) & M;
  h ^= h >> 29n;
  h = (h * P3) & M;
  h ^= h >> 32n;
  return h;
}
