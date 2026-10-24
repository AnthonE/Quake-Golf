#!/usr/bin/env node
// The macro assembler. Hand-written WAT in, game.wasm out, no compiler.
//
//   #include "file.wat"     splice another source file
//   #if DEBUG / #else / #endif   (and #if ARENA, #if !ARENA, #if FIESTA, #if BUMPER)
//   @NAME, @(expr)          layout constants from the sim's layout.mjs, folded at build time
//
// Two sims, each from its own directory: src/ (the browsers, Node and the
// relays, build/) and xbox/sim/ (the Xbox's, frozen, translated to Pentium III
// code: build/xbox/). Each has its own layout.mjs and macros.mjs. The arena
// (build/arena/) is src/ again with ARENA set: a deathmatch on the same engine;
// bumper balls (build/bumper/) is src/ with BUMPER set: every player a ball.
// Fireplace (build/fireplace/) is all three in one module, each as its own
// build would be under a prefix, with src/fireplace.wat dispatching to the one on now.
//   (!macro args...)        JS macros from src/macros.mjs; args are raw s-expressions
//
// It refuses anything the determinism rules ban: memory.grow, relaxed SIMD,
// active data segments (they would rewrite shared memory on every
// instantiate) and mutable globals (per-thread state the region never sees).
// A passive segment is only bytes until init copies it out with memory.init:
// the arena's map (tools/map.mjs; QG_MAP=name or --map name picks one of
// maps/, Blood Gulch by default) goes in as one, through (!mapdata).

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import wabtInit from 'wabt';
import * as layout from '../src/layout.mjs';
import { makeMacros } from '../src/macros.mjs';
import { pathToFileURL } from 'node:url';
import { isMain } from './main.mjs';
import { compileMap, dataSegment, mapDir } from './map.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FEATURES = {
  simd: true, threads: true, bulk_memory: true, mutable_globals: true,
  sat_float_to_int: true, sign_extension: true, multi_value: true,
};

export function include(file, seen = new Set()) {
  const path = resolve(file);
  if (seen.has(path)) throw new Error(`include cycle at ${path}`);
  seen.add(path);
  const out = readFileSync(path, 'utf8').split('\n').map((line) => {
    const m = line.match(/^\s*#include\s+"([^"]+)"\s*$/);
    return m ? include(join(dirname(path), m[1]), seen) : line;
  });
  seen.delete(path);
  return out.join('\n');
}

export function conditionals(src, flags) {
  const out = [];
  const stack = [];
  for (const line of src.split('\n')) {
    const t = line.trim();
    let m;
    if ((m = t.match(/^#if\s+(!?)(\w+)$/))) {
      const on = Boolean(flags[m[2]]) !== (m[1] === '!');
      stack.push({ on, parent: stack.every((s) => s.on) });
    } else if (t === '#else') {
      const top = stack.at(-1);
      if (!top) throw new Error('#else without #if');
      top.on = !top.on;
    } else if (t === '#endif') {
      if (!stack.pop()) throw new Error('#endif without #if');
    } else if (stack.every((s) => s.on)) {
      out.push(line);
    } else {
      out.push('');
    }
  }
  if (stack.length) throw new Error('unterminated #if');
  return out.join('\n');
}

// Index just past the string literal that opens at src[i] === '"', honouring escapes.
function closeString(src, i) {
  for (let k = i + 1; k < src.length; k++) {
    if (src[k] === '\\') k++;
    else if (src[k] === '"') return k + 1;
  }
  throw new Error(`unterminated string at ${i}`);
}

export function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      const j = closeString(src, i);
      out += src.slice(i, j);
      i = j - 1;
    } else if (c === ';' && src[i + 1] === ';') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
    } else if (c === '(' && src[i + 1] === ';') {
      // block comments nest in WAT
      let depth = 0;
      let j = i;
      for (; j < src.length; j++) {
        if (src[j] === '(' && src[j + 1] === ';') { depth++; j++; }
        else if (src[j] === ';' && src[j + 1] === ')') { depth--; j++; if (depth === 0) break; }
      }
      if (depth !== 0) throw new Error('unterminated block comment');
      out += src.slice(i, j + 1).replace(/[^\n]/g, ' ');
      i = j;
    } else {
      out += c;
    }
  }
  return out;
}

// Index just past the s-expression that opens at src[i] === '('.
function closeParen(src, i) {
  let depth = 0;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (c === '"') k = closeString(src, k) - 1;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return k + 1;
  }
  throw new Error(`unbalanced parens at ${i}: ${src.slice(i, i + 60)}`);
}

// Top-level whitespace split, keeping parenthesised groups whole.
export function splitArgs(s) {
  const args = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    if (s[i] === '(' || (s[i] === '@' && s[i + 1] === '(')) {
      const start = i;
      const j = closeParen(s, s[i] === '@' ? i + 1 : i);
      args.push(s.slice(start, j));
      i = j;
    } else {
      let j = i;
      while (j < s.length && !/[\s()]/.test(s[j])) j++;
      args.push(s.slice(i, j));
      i = j;
    }
  }
  return args;
}

export function expandMacros(src, macros, depth = 0) {
  if (depth > 64) throw new Error('macro expansion too deep');
  let out = '';
  let i = 0;
  let changed = false;
  while (i < src.length) {
    const k = src.indexOf('(!', i);
    if (k < 0) { out += src.slice(i); break; }
    out += src.slice(i, k);
    const end = closeParen(src, k);
    const [name, ...args] = splitArgs(src.slice(k + 2, end - 1));
    const fn = macros[name];
    if (!fn) throw new Error(`unknown macro !${name}`);
    out += fn(...args);
    i = end;
    changed = true;
  }
  return changed ? expandMacros(out, macros, depth + 1) : out;
}

export function constants(src, scope) {
  const keys = Object.keys(scope);
  const vals = keys.map((k) => scope[k]);
  const evaluate = (expr) => {
    const v = new Function(...keys, `return (${expr});`)(...vals);
    if (typeof v !== 'number' && typeof v !== 'string') throw new Error(`@(${expr}) is not a number`);
    return String(v);
  };
  let out = '';
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '@') { out += src[i]; continue; }
    if (src[i + 1] === '(') {
      const end = closeParen(src, i + 1);
      out += evaluate(src.slice(i + 2, end - 1));
      i = end - 1;
    } else {
      const m = src.slice(i + 1).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      if (!m) throw new Error(`bare @ at ${i}`);
      if (!(m[0] in scope)) throw new Error(`unknown constant @${m[0]}`);
      out += String(scope[m[0]]);
      i += m[0].length;
    }
  }
  return out;
}

// The test files build in parallel processes: a reader sees the old file or
// the new one, never half of one.
function writeAtomic(path, data) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export function forbid(wat, where = 'source') {
  const rules = [
    [/\bmemory\.grow\b/, 'memory.grow'],
    [/\brelaxed_/, 'relaxed SIMD'],
    [/\(\s*mut\b/, 'mutable global'],
  ];
  for (const [re, what] of rules) {
    const m = wat.match(re);
    if (m) throw new Error(`forbidden in the sim (${where}): ${what} (${m[0]})`);
  }
  // a segment with an offset (or a memory) before its bytes is active; a
  // passive one has only its name (or wabt's (;n;) index) before its string
  for (const m of wat.matchAll(/\(\s*data\b(?!\.)/g)) {
    const rest = wat.slice(m.index + m[0].length).replace(/^\s*(\$[^\s()"]+|\(;[^;]*;\))?\s*/, '');
    if (rest[0] !== '"' && rest[0] !== ')') throw new Error(`forbidden in the sim (${where}): active data segment (${wat.slice(m.index, m.index + 40)})`);
  }
}

export function expand(file, { DEBUG = false, ARENA = false, BUMPER = false, layout: lay = layout, macros = makeMacros, map = null } = {}) {
  if (ARENA && !map) map = compileMap();
  const scope = { ...lay, ...lay.PHYS, ...(lay.BPHYS || {}), DEBUG: DEBUG ? 1 : 0, ...(map ? map.consts : {}) };
  let src = include(file);
  // the arena's mode is a layout constant, so #if FIESTA picks its rules at build time
  src = conditionals(src, { DEBUG, ARENA, BUMPER, FIESTA: ARENA && !!lay.FIESTA });
  src = stripComments(src);
  const m = macros({ DEBUG });
  if (map) m.mapdata = () => dataSegment(map.bytes);
  src = expandMacros(src, m);
  src = constants(src, scope);
  forbid(src);
  return src;
}

export async function assemble(wat, name = 'game.wat', { debugNames = false, check = true } = {}) {
  const wabt = await wabtInit();
  const mod = wabt.parseWat(name, wat, FEATURES);
  let bin;
  try {
    mod.resolveNames();
    mod.validate(FEATURES);
    bin = new Uint8Array(mod.toBinary({ log: false, write_debug_names: debugNames }).buffer);
  } finally {
    mod.destroy();
  }
  // The source check can be dodged by spelling; the binary can't. Disassemble
  // to wabt's canonical text and apply the same rules there.
  if (check) forbid(await canonical(bin), 'binary');
  return bin;
}

export async function canonical(bin) {
  const wabt = await wabtInit();
  const mod = wabt.readWasm(bin, { readDebugNames: false, ...FEATURES });
  try {
    return mod.toText({ foldExprs: false, inlineExport: false });
  } finally {
    mod.destroy();
  }
}

async function binaryenSize(bin) {
  try {
    const { default: binaryen } = await import('binaryen');
    const m = binaryen.readBinary(bin);
    m.setFeatures(binaryen.Features.All);
    binaryen.setOptimizeLevel(3);
    binaryen.setShrinkLevel(2);
    m.optimize();
    const out = m.emitBinary();
    m.dispose();
    return { raw: out.length, gzip: gzipSync(out, { level: 9 }).length };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

// One game's expanded module as part of another: its every $identifier
// (outside strings) under `prefix.`, its exports made internal (an anonymous
// exported function takes its export's name), its module head and memory
// import dropped, so several can share one module and one memory.
export function prefixed(wat, prefix) {
  const head = wat.match(/^\s*\(module\s*\(import "env" "mem" \(memory \d+ \d+ shared\)\)/);
  if (!head) throw new Error('not a sim module');
  const body = wat.slice(head[0].length, wat.lastIndexOf(')'));
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"') { const j = closeString(body, i); out += body.slice(i, j); i = j - 1; }
    else if (c === '$' && /[A-Za-z0-9_]/.test(body[i + 1] || '')) out += `$${prefix}.`;
    else out += c;
  }
  const names = new Set([...out.matchAll(/\(func (\$[\w.]+)/g)].map((m) => m[1]));
  out = out.replace(/\(func \(export "(\w+)"\)/g, (_, e) => {
    const name = `$${prefix}.${e}`;
    if (names.has(name)) throw new Error(`${name} is taken`);
    return `(func ${name}`;
  });
  return out.replace(/\(func (\$[\w.]+) \(export "\w+"\)/g, '(func $1');
}

export const GAMESETS = [['g', {}], ['a', { ARENA: true }], ['b', { BUMPER: true }]];

export function fireplaceWat({ DEBUG = false, layout: lay = layout, macros = makeMacros, map = compileMap(), src = join(ROOT, 'src') } = {}) {
  const games = GAMESETS.map(([prefix, flags]) => prefixed(expand(join(src, 'game.wat'), { DEBUG, ...flags, layout: lay, macros, map: flags.ARENA ? map : null }), prefix));
  const fp = expand(join(src, 'fireplace.wat'), { DEBUG, layout: lay, macros });
  const wat = `(module\n  (import "env" "mem" (memory ${lay.PAGES} ${lay.PAGES} shared))\n${games.join('\n')}\n${fp}\n)\n`;
  forbid(wat);
  return wat;
}

export const SIMS = [
  { name: 'game', src: join(ROOT, 'src'), out: join(ROOT, 'build') },
  { name: 'xbox', src: join(ROOT, 'xbox', 'sim'), out: join(ROOT, 'build', 'xbox') },
  { name: 'arena', src: join(ROOT, 'src'), out: join(ROOT, 'build', 'arena'), flags: { ARENA: true } },
  { name: 'bumper', src: join(ROOT, 'src'), out: join(ROOT, 'build', 'bumper'), flags: { BUMPER: true } },
  { name: 'fireplace', src: join(ROOT, 'src'), out: join(ROOT, 'build', 'fireplace'), fireplace: true },
];

async function buildSim({ name, src, out, flags = {}, fireplace = false }) {
  mkdirSync(out, { recursive: true });
  const map = flags.ARENA || fireplace ? compileMap(mapDir(MAP_ARG)) : null;
  const lay = await import(pathToFileURL(join(src, 'layout.mjs')).href);
  const { makeMacros: macros } = await import(pathToFileURL(join(src, 'macros.mjs')).href);
  const entry = join(src, 'game.wat');
  const manifest = {};
  for (const debug of [false, true]) {
    const wat = fireplace ? fireplaceWat({ DEBUG: debug, layout: lay, macros, map, src }) : expand(entry, { DEBUG: debug, ...flags, layout: lay, macros, map });
    const base = debug ? 'game.debug' : 'game';
    writeAtomic(join(out, `${base}.wat`), wat);
    const bin = await assemble(wat, `${base}.wat`, { debugNames: debug });
    writeAtomic(join(out, `${base}.wasm`), bin);
    manifest[base] = {
      raw: bin.length,
      gzip: gzipSync(bin, { level: 9 }).length,
      sha256: createHash('sha256').update(bin).digest('hex'),
    };
  }
  manifest.binaryen = await binaryenSize(readFileSync(join(out, 'game.wasm')));
  writeAtomic(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const g = manifest.game;
  const where = out === join(ROOT, 'build') ? 'game.wasm' : `${name}/game.wasm`;
  console.log(`${where} ${g.raw} B, ${g.gzip} B gzip, sha256 ${g.sha256.slice(0, 16)}${map ? ` (map: ${map.name}, ${map.bytes.length} B)` : ''}`);
  if (manifest.binaryen.raw) console.log(`  binaryen -O3 would give ${manifest.binaryen.raw} B, ${manifest.binaryen.gzip} B gzip (measurement only)`);
}

const MAP_ARG = (() => { const i = process.argv.indexOf('--map'); return i >= 0 ? process.argv[i + 1] : undefined; })();

async function main() {
  for (const sim of SIMS) await buildSim(sim);
}

if (isMain(import.meta.url)) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
