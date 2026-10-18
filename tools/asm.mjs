#!/usr/bin/env node
// The macro assembler. Hand-written WAT in, game.wasm out, no compiler.
//
//   #include "file.wat"     splice another source file
//   #if DEBUG / #else / #endif
//   @NAME, @(expr)          layout constants from src/layout.mjs, folded at build time
//   (!macro args...)        JS macros from src/macros.mjs; args are raw s-expressions
//
// It refuses anything the determinism rules ban: memory.grow, relaxed SIMD,
// data segments (they would rewrite shared memory on every instantiate) and
// mutable globals (per-thread state the region never sees).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import wabtInit from 'wabt';
import * as layout from '../src/layout.mjs';
import { makeMacros } from '../src/macros.mjs';

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

export function forbid(wat, where = 'source') {
  const rules = [
    [/\bmemory\.grow\b/, 'memory.grow'],
    [/\brelaxed_/, 'relaxed SIMD'],
    [/\(\s*data\b/, 'data segment'],
    [/\(\s*mut\b/, 'mutable global'],
  ];
  for (const [re, what] of rules) {
    const m = wat.match(re);
    if (m) throw new Error(`forbidden in the sim (${where}): ${what} (${m[0]})`);
  }
}

export function expand(file, { DEBUG = false } = {}) {
  const scope = { ...layout, ...layout.PHYS, DEBUG: DEBUG ? 1 : 0 };
  let src = include(file);
  src = conditionals(src, { DEBUG });
  src = stripComments(src);
  src = expandMacros(src, makeMacros({ DEBUG }));
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

async function main() {
  const out = join(ROOT, 'build');
  mkdirSync(out, { recursive: true });
  const entry = join(ROOT, 'src', 'game.wat');
  const manifest = {};
  for (const debug of [false, true]) {
    const wat = expand(entry, { DEBUG: debug });
    const base = debug ? 'game.debug' : 'game';
    writeFileSync(join(out, `${base}.wat`), wat);
    const bin = await assemble(wat, `${base}.wat`, { debugNames: debug });
    writeFileSync(join(out, `${base}.wasm`), bin);
    manifest[base] = {
      raw: bin.length,
      gzip: gzipSync(bin, { level: 9 }).length,
      sha256: createHash('sha256').update(bin).digest('hex'),
    };
  }
  manifest.binaryen = await binaryenSize(readFileSync(join(out, 'game.wasm')));
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const g = manifest.game;
  console.log(`game.wasm ${g.raw} B, ${g.gzip} B gzip, sha256 ${g.sha256.slice(0, 16)}`);
  if (manifest.binaryen.raw) console.log(`binaryen -O3 would give ${manifest.binaryen.raw} B, ${manifest.binaryen.gzip} B gzip (measurement only)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
