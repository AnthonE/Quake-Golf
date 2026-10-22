#!/usr/bin/env node
// Checks a replay (net/replay.mjs): steps it on a referee, compares every
// interval hash with the relay's, and prints the scores. Exits 1 if any differ.
//   node tools/replay.mjs <file.qgr>
import { readFileSync } from 'node:fs';
import { decodeReplay, checkReplay } from '../net/replay.mjs';
import { TICK_MS } from '../net/wire.mjs';

const path = process.argv[2];
if (!path) { console.error('usage: node tools/replay.mjs <file.qgr>'); process.exit(2); }
const file = readFileSync(path);
const r = await decodeReplay(new Uint8Array(file.buffer, file.byteOffset, file.byteLength));
const out = await checkReplay(readFileSync('build/game.wasm'), r);
console.log(`${path}: ${file.length} B, seed ${r.seed}, ${(out.ticks * TICK_MS / 1000).toFixed(1)} s from sim tick ${r.from - r.roomStart}${r.region ? ' (a keyframe)' : ''}`);
console.log(`interval hashes: ${out.compared - out.wrong.length} of ${out.compared} equal the relay's${out.wrong.length ? `; they differ at sim ticks ${out.wrong.slice(0, 8).join(', ')}` : ''}`);
console.log(`${out.players.length} players; best: ${out.players.slice(0, 5).map((p) => `P${p.slot + 1} ${p.total}`).join(', ')}`);
process.exit(out.wrong.length ? 1 : 0);
