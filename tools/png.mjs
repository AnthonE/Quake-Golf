// PNG in and out, for the maps (tools/map.mjs): no dependencies, zlib only.
// Reads non-interlaced greyscale, grey + alpha, RGB, RGBA and palette images
// at 8 or 16 bits (and palette or grey at 1, 2, 4); writes 8- or 16-bit grey
// and 8-bit RGB. decode gives { width, height, channels, depth, data }: data
// holds one number per channel per pixel (0..255 or 0..65535), palette
// images expanded to RGB(A).
import { deflateSync, inflateSync } from 'node:zlib';

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
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

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function decodePng(buf) {
  buf = Buffer.from(buf);
  if (!SIG.every((b, i) => buf[i] === b)) throw new Error('not a PNG');
  let at = 8, ihdr = null, palette = null, trns = null;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  if (!ihdr) throw new Error('PNG without IHDR');
  const { width, height, depth, color, interlace } = ihdr;
  if (interlace) throw new Error('interlaced PNGs are not supported: save it without interlacing');
  if (!(color in CHANNELS)) throw new Error(`PNG colour type ${color} is not supported`);
  const nch = CHANNELS[color];
  const bpp = Math.max(1, (nch * depth) >> 3); // bytes per pixel, for the filters
  const stride = Math.ceil((width * nch * depth) / 8);
  const raw = inflateSync(Buffer.concat(idat));
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = rows.subarray(y * stride, (y + 1) * stride);
    const up = y ? rows.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0, b = up ? up[i] : 0, c = up && i >= bpp ? up[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (f !== 0) throw new Error(`bad PNG filter ${f}`);
      row[i] = v & 255;
    }
  }
  const sample = (y, k) => {
    const row = y * stride;
    if (depth === 16) return rows.readUInt16BE(row + 2 * k);
    if (depth === 8) return rows[row + k];
    const bit = k * depth;
    return (rows[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  if (color === 3) {
    if (!palette) throw new Error('palette PNG without PLTE');
    const out = trns ? 4 : 3;
    const data = new Uint16Array(width * height * out);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const k = sample(y, x), o = (y * width + x) * out;
        data[o] = palette[3 * k]; data[o + 1] = palette[3 * k + 1]; data[o + 2] = palette[3 * k + 2];
        if (trns) data[o + 3] = k < trns.length ? trns[k] : 255;
      }
    }
    return { width, height, channels: out, depth: 8, data };
  }
  const data = new Uint16Array(width * height * nch);
  for (let y = 0; y < height; y++) for (let k = 0; k < width * nch; k++) data[y * width * nch + k] = sample(y, k);
  // grey below 8 bits reads as 8: 0..255
  if (depth < 8) { const s = 255 / ((1 << depth) - 1); for (let i = 0; i < data.length; i++) data[i] = Math.round(data[i] * s); }
  return { width, height, channels: nch, depth: Math.max(8, depth), data };
}

// data: one number per channel per pixel. channels 1 (grey) or 3 (RGB); depth 8 or 16 (grey only).
export function encodePng({ width, height, channels = 1, depth = 8, data }) {
  if (!(channels === 1 || (channels === 3 && depth === 8))) throw new Error('writes 8/16-bit grey or 8-bit RGB only');
  const bps = depth / 8;
  const stride = width * channels * bps;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1);
    raw[o] = 0;
    for (let k = 0; k < width * channels; k++) {
      const v = data[y * width * channels + k];
      if (bps === 2) raw.writeUInt16BE(v, o + 1 + 2 * k); else raw[o + 1 + k] = v;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = depth; ihdr[9] = channels === 1 ? 0 : 2;
  return Buffer.concat([Buffer.from(SIG), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
