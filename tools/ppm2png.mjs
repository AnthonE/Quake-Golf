#!/usr/bin/env node
// node tools/ppm2png.mjs a.ppm [b.ppm ...]: writes a.png beside each (binary P6 only).
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { isMain } from './main.mjs';

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function ppmToPng(ppm) {
  const m = ppm.subarray(0, 64).toString('latin1').match(/^P6\s+(\d+)\s+(\d+)\s+255\s/);
  if (!m) throw new Error('not a binary 8-bit PPM');
  const [w, h] = [Number(m[1]), Number(m[2])];
  const px = ppm.subarray(m[0].length);
  const raw = Buffer.alloc(h * (1 + 3 * w));
  for (let y = 0; y < h; y++) px.copy(raw, y * (1 + 3 * w) + 1, y * 3 * w, (y + 1) * 3 * w);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

if (isMain(import.meta.url)) {
  for (const f of process.argv.slice(2)) writeFileSync(f.replace(/\.ppm$/, '.png'), ppmToPng(readFileSync(f)));
}
