#!/usr/bin/env node
// node tools/compare.mjs a.qgh b.qgh [c.qgh ...]
// Compares every trace with the first. Names the first tick that differs and,
// from that interval's slice digests, the first slice and field range.
import { readFileSync } from 'node:fs';
import { decodeTrace } from '../harness/core.mjs';
import { NSLICE, describeSlice } from '../src/layout.mjs';

export function compareTraces(ref, other) {
  if (ref.terrainHash !== other.terrainHash) return { ok: false, what: 'terrain hash differs' };
  if (ref.logHash !== other.logHash) return { ok: false, what: 'log hash differs (not the same input log)' };
  const ticks = Math.min(ref.ticks, other.ticks);
  for (let t = 0; t < ticks; t++) {
    if (ref.tickHashes[t] === other.tickHashes[t]) continue;
    const k = Math.floor(t / NSLICE);
    let slice = -1;
    for (let s = 0; s < NSLICE && k < Math.min(ref.nInt, other.nInt); s++) {
      if (ref.sliceDigests[k * NSLICE + s] !== other.sliceDigests[k * NSLICE + s]) { slice = s; break; }
    }
    return {
      ok: false,
      tick: t + 1,
      what: `first mismatch after tick ${t + 1}` + (slice >= 0 ? `; interval ${k} first differs in slice ${slice}, ${describeSlice(slice)}` : ''),
    };
  }
  return { ok: true, ticks };
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
