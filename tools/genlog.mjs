#!/usr/bin/env node
// Generates the M1 event log (.qgl) from a seed, integer-only, so every run
// writes the same bytes. Balls arrive in bursts until 10,000 are live; blasts
// on random balls keep about a thousand awake, and a big blast every ~16 s
// is the wake storm.
//
// Header (32 B): "QGEL" | u16 ver | u16 rec | u32 course_seed | u32 gen_seed | u32 ticks | u32 n | 8 B zero
// Record (16 B): u32 tick | u8 kind | u8 a | u16 b | u16 x | i16 y | u16 z | i16 c

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { EV_SPAWN, EV_EXPLODE, EV_EXPLODE_BALL, REC } from '../src/layout.mjs';
import { isMain } from './main.mjs';

export function generate({ courseSeed = 7, genSeed = 1, ticks = 20000, target = 10000, blastEvery = 24, blastR = 4, storms = true } = {}) {
  let s = genSeed >>> 0 || 1;
  const rand = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s;
  };
  const below = (n) => rand() % n;
  // Pits where bursts land, so late holes become ball pits.
  const pits = Array.from({ length: 12 }, () => [64 + below(896), 64 + below(896)]);
  const recs = [];
  let spawned = 0;
  for (let t = 0; t < ticks; t++) {
    if (spawned < target && t % 48 === 0) {
      const [px, pz] = pits[below(pits.length)];
      const count = Math.min(32, target - spawned);
      recs.push([t, EV_SPAWN, count, below(64), (px + below(17) - 8) * 64, (2 + below(6)) * 64, (pz + below(17) - 8) * 64, (1 + below(6)) * 64]);
      spawned += count;
    }
    if (blastEvery && t % blastEvery === 7) {
      recs.push([t, EV_EXPLODE_BALL, 8 + below(48), (1 + below(blastR)) * 64, 0, 0, 0, below(65536) - 32768]);
    }
    if (storms && t % 2000 === 1999) {
      const [px, pz] = pits[below(pits.length)];
      recs.push([t, EV_EXPLODE, 255, 12 * 64, px * 64, 64, pz * 64, 0]);
    }
  }
  const buf = new Uint8Array(32 + recs.length * REC);
  const dv = new DataView(buf.buffer);
  buf.set([0x51, 0x47, 0x45, 0x4c], 0); // QGEL
  dv.setUint16(4, 1, true);
  dv.setUint16(6, REC, true);
  dv.setUint32(8, courseSeed >>> 0, true);
  dv.setUint32(12, genSeed >>> 0, true);
  dv.setUint32(16, ticks, true);
  dv.setUint32(20, recs.length, true);
  recs.forEach(([t, kind, a, b, x, y, z, c], i) => {
    const o = 32 + i * REC;
    dv.setUint32(o, t, true);
    dv.setUint8(o + 4, kind);
    dv.setUint8(o + 5, a);
    dv.setUint16(o + 6, b, true);
    dv.setUint16(o + 8, x, true);
    dv.setInt16(o + 10, y, true);
    dv.setUint16(o + 12, z, true);
    dv.setInt16(o + 14, c, true);
  });
  return buf;
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
}

if (isMain(import.meta.url)) {
  const out = arg('out', 'logs/short.qgl');
  const buf = generate({
    courseSeed: Number(arg('course', 7)), genSeed: Number(arg('seed', 1)), ticks: Number(arg('ticks', 20000)),
    blastEvery: Number(arg('blast-every', 24)), blastR: Number(arg('blast-r', 4)), storms: arg('storms', '1') !== '0',
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buf);
  console.log(`${out}: ${(buf.length - 32) / REC} events over ${arg('ticks', 20000)} ticks`);
}
