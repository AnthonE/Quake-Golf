#!/usr/bin/env node
// node tools/compare.mjs a.qgh b.qgh [c.qgh ...]
// Compares every trace with the first. Names the first tick that differs and,
// from that interval's slice digests, the first slice and field range.
import { readFileSync } from 'node:fs';
import { decodeTrace } from '../harness/core.mjs';
import { NSLICE, describeSlice } from '../src/layout.mjs';

export function compareTraces(ref, other) {
  if (ref.terrainHash !== other.terrainHash) return { ok: false, what: 'terrain hash differs' };
  if (ref.logHash === 0n || other.logHash === 0n) return { ok: false, what: 'a trace carries no log hash' };
  if (ref.logHash !== other.logHash) return { ok: false, what: 'log hash differs (not the same input log)' };
  if (ref.ticks !== other.ticks || ref.nInt !== other.nInt) return { ok: false, what: `lengths differ: ${ref.ticks} vs ${other.ticks} ticks` };
  for (let t = 0; t < ref.ticks; t++) {
    if (ref.tickHashes[t] === other.tickHashes[t]) continue;
    // Trace entry t is the state at tick t+1. Interval k's digests are taken at
    // ticks 128k+1 .. 128k+128, so the first interval whose digests all postdate
    // the divergence is k = ceil(t / 128).
    const k = Math.ceil(t / NSLICE);
    let where = '';
    if (k < ref.nInt) {
      for (let s = 0; s < NSLICE; s++) {
        if (ref.sliceDigests[k * NSLICE + s] !== other.sliceDigests[k * NSLICE + s]) {
          where = `; interval ${k} first differs in slice ${s}: ${describeSlice(s)}`;
          break;
        }
      }
    }
    return { ok: false, tick: t + 1, what: `first mismatch at tick ${t + 1}${where}` };
  }
  for (let k = 0; k < ref.nInt; k++) {
    if (ref.intervalHashes[k] !== other.intervalHashes[k]) return { ok: false, what: `interval hash ${k} differs while every tick hash matched` };
  }
  return { ok: true, ticks: ref.ticks };
}

if (import.meta.url === `file://${process.argv[1]}`) {
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
