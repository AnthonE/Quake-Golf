#!/usr/bin/env node
// node tools/compare.mjs a.qgh b.qgh [c.qgh ...]
// Compares every trace with the first. Names the first tick that differs and,
// from that interval's slice digests, the first slice and field range.
import { readFileSync } from 'node:fs';
import { decodeTrace } from '../harness/core.mjs';
import { NSLICE, describeSlice } from '../src/layout.mjs';
import { isMain } from './main.mjs';

export function compareTraces(ref, other) {
  if (ref.terrainHash !== other.terrainHash) return { ok: false, what: 'terrain hash differs' };
  if (ref.logHash === 0n || other.logHash === 0n) return { ok: false, what: 'a trace carries no log hash' };
  if (ref.logHash !== other.logHash) return { ok: false, what: 'log hash differs (not the same input log)' };
  if (ref.ticks !== other.ticks || ref.nInt !== other.nInt) return { ok: false, what: `lengths differ: ${ref.ticks} vs ${other.ticks} ticks` };
  for (let t = 0; t < ref.ticks; t++) {
    if (ref.tickHashes[t] === other.tickHashes[t]) continue;
    // Trace entry t is the state at tick t+1. Slice s of interval k is digested
    // at entry 128k+s, so the 128 digests taken from entry t on are slices
    // t%128..127 of interval floor(t/128), then 0..t%128-1 of the next. Scan them
    // in time order: the first that differs is the earliest field where the
    // divergence is visible (it may have spread there from somewhere else).
    const k0 = Math.floor(t / NSLICE);
    const s0 = t % NSLICE;
    let where = '';
    for (let i = 0; i < NSLICE && !where; i++) {
      const k = k0 + (s0 + i >= NSLICE ? 1 : 0);
      const sl = (s0 + i) % NSLICE;
      if (k >= ref.nInt) break;
      if (ref.sliceDigests[k * NSLICE + sl] !== other.sliceDigests[k * NSLICE + sl]) {
        where = `; first visible in slice ${sl} (digested at tick ${k * NSLICE + sl + 1}): ${describeSlice(sl)}`;
      }
    }
    return { ok: false, tick: t + 1, what: `first mismatch at tick ${t + 1}${where}` };
  }
  for (let k = 0; k < ref.nInt; k++) {
    if (ref.intervalHashes[k] !== other.intervalHashes[k]) return { ok: false, what: `interval hash ${k} differs while every tick hash matched` };
  }
  return { ok: true, ticks: ref.ticks };
}

if (isMain(import.meta.url)) {
  const files = process.argv.slice(2);
  if (files.length < 2) { console.error('usage: compare.mjs ref.qgh other.qgh...'); process.exit(2); }
  const ref = decodeTrace(readFileSync(files[0]));
  let bad = 0;
  for (const f of files.slice(1)) {
    const other = decodeTrace(readFileSync(f));
    const r = compareTraces(ref, other);
    if (r.ok) console.log(`ok   ${other.tag} == ${ref.tag} over ${r.ticks} ticks`);
    else { bad++; console.log(`FAIL ${other.tag} vs ${ref.tag}: ${r.what}`); }
  }
  console.log(bad ? `${bad} of ${files.length - 1} traces differ` : `all ${files.length} traces agree`);
  process.exit(bad ? 1 : 0);
}
