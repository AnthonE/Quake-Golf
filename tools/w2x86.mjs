#!/usr/bin/env node
// wasm -> i386 assembly for the original Xbox's Pentium III: i686 integer
// ops and CMOV, SSE1 for f32 and f32x4, x87 only for a standalone floor, and
// nothing from SSE2. The output assembles with clang (GAS, Intel syntax) for
// ELF (the Linux replay runner) or COFF (nxdk).
//
//   node tools/w2x86.mjs build/game.wasm --target elf|coff [--no-bounds] --out game.s [--header qg_sim.h]
//
// Every op keeps wasm's bits: round to nearest under a fixed MXCSR (no FTZ or
// DAZ), min and max with wasm's NaN and signed-zero rules, saturating
// truncation, unsigned conversion, and no fused multiply-add. Locals live in
// the frame; the operand stack is cached in registers within a basic block
// and lives in fixed per-depth slots across control flow and calls.

import { readFileSync, writeFileSync } from 'node:fs';
import { isMain } from './main.mjs';

// ---------------------------------------------------------------- decoder

const VALTYPE = { 0x7f: 'i32', 0x7e: 'i64', 0x7d: 'f32', 0x7c: 'f64', 0x7b: 'v128' };

class Reader {
  constructor(buf, pos = 0, end = buf.length) { this.b = buf; this.p = pos; this.end = end; }
  more() { return this.p < this.end; }
  u8() { if (this.p >= this.end) throw new Error('unexpected end'); return this.b[this.p++]; }
  u32() {
    let r = 0, s = 0, c;
    do { c = this.u8(); r |= (c & 0x7f) << s; s += 7; } while (c & 0x80);
    return r >>> 0;
  }
  s32() {
    let r = 0, s = 0, c;
    do { c = this.u8(); r |= (c & 0x7f) << s; s += 7; } while (c & 0x80);
    if (s < 32 && (c & 0x40)) r |= -1 << s;
    return r | 0;
  }
  s64() {
    let r = 0n, s = 0n, c;
    do { c = this.u8(); r |= BigInt(c & 0x7f) << s; s += 7n; } while (c & 0x80);
    if (s < 64n && (c & 0x40)) r |= -1n << s;
    return BigInt.asUintN(64, r);
  }
  s33() {
    let r = 0, s = 0, c;
    do { c = this.u8(); r += (c & 0x7f) * 2 ** s; s += 7; } while (c & 0x80);
    if (c & 0x40) r -= 2 ** s;
    return r;
  }
  f32bits() { const v = this.b[this.p] | (this.b[this.p + 1] << 8) | (this.b[this.p + 2] << 16) | (this.b[this.p + 3] << 24); this.p += 4; return v >>> 0; }
  bytes(n) { const v = this.b.subarray(this.p, this.p + n); this.p += n; return v; }
  name() { return new TextDecoder().decode(this.bytes(this.u32())); }
  valtype() { const t = VALTYPE[this.u8()]; if (!t) throw new Error('bad valtype'); return t; }
}

// opcode -> [name, immediate kind]
const OPS = {
  0x00: ['unreachable'], 0x01: ['nop'], 0x02: ['block', 'bt'], 0x03: ['loop', 'bt'], 0x04: ['if', 'bt'],
  0x05: ['else'], 0x0b: ['end'], 0x0c: ['br', 'u32'], 0x0d: ['br_if', 'u32'], 0x0e: ['br_table', 'table'],
  0x0f: ['return'], 0x10: ['call', 'u32'], 0x11: ['call_indirect', 'u32u32'],
  0x1a: ['drop'], 0x1b: ['select'], 0x1c: ['select', 'vt'],
  0x20: ['local.get', 'u32'], 0x21: ['local.set', 'u32'], 0x22: ['local.tee', 'u32'],
  0x23: ['global.get', 'u32'], 0x24: ['global.set', 'u32'],
  0x28: ['i32.load', 'mem'], 0x29: ['i64.load', 'mem'], 0x2a: ['f32.load', 'mem'], 0x2b: ['f64.load', 'mem'],
  0x2c: ['i32.load8_s', 'mem'], 0x2d: ['i32.load8_u', 'mem'], 0x2e: ['i32.load16_s', 'mem'], 0x2f: ['i32.load16_u', 'mem'],
  0x30: ['i64.load8_s', 'mem'], 0x31: ['i64.load8_u', 'mem'], 0x32: ['i64.load16_s', 'mem'], 0x33: ['i64.load16_u', 'mem'],
  0x34: ['i64.load32_s', 'mem'], 0x35: ['i64.load32_u', 'mem'],
  0x36: ['i32.store', 'mem'], 0x37: ['i64.store', 'mem'], 0x38: ['f32.store', 'mem'], 0x39: ['f64.store', 'mem'],
  0x3a: ['i32.store8', 'mem'], 0x3b: ['i32.store16', 'mem'], 0x3c: ['i64.store8', 'mem'], 0x3d: ['i64.store16', 'mem'], 0x3e: ['i64.store32', 'mem'],
  0x3f: ['memory.size', 'u8'], 0x40: ['memory.grow', 'u8'],
  0x41: ['i32.const', 's32'], 0x42: ['i64.const', 's64'], 0x43: ['f32.const', 'f32'], 0x44: ['f64.const', 'f64'],
};
const NAMES0x45 = [
  'i32.eqz', 'i32.eq', 'i32.ne', 'i32.lt_s', 'i32.lt_u', 'i32.gt_s', 'i32.gt_u', 'i32.le_s', 'i32.le_u', 'i32.ge_s', 'i32.ge_u',
  'i64.eqz', 'i64.eq', 'i64.ne', 'i64.lt_s', 'i64.lt_u', 'i64.gt_s', 'i64.gt_u', 'i64.le_s', 'i64.le_u', 'i64.ge_s', 'i64.ge_u',
  'f32.eq', 'f32.ne', 'f32.lt', 'f32.gt', 'f32.le', 'f32.ge',
  'f64.eq', 'f64.ne', 'f64.lt', 'f64.gt', 'f64.le', 'f64.ge',
  'i32.clz', 'i32.ctz', 'i32.popcnt', 'i32.add', 'i32.sub', 'i32.mul', 'i32.div_s', 'i32.div_u', 'i32.rem_s', 'i32.rem_u',
  'i32.and', 'i32.or', 'i32.xor', 'i32.shl', 'i32.shr_s', 'i32.shr_u', 'i32.rotl', 'i32.rotr',
  'i64.clz', 'i64.ctz', 'i64.popcnt', 'i64.add', 'i64.sub', 'i64.mul', 'i64.div_s', 'i64.div_u', 'i64.rem_s', 'i64.rem_u',
  'i64.and', 'i64.or', 'i64.xor', 'i64.shl', 'i64.shr_s', 'i64.shr_u', 'i64.rotl', 'i64.rotr',
  'f32.abs', 'f32.neg', 'f32.ceil', 'f32.floor', 'f32.trunc', 'f32.nearest', 'f32.sqrt',
  'f32.add', 'f32.sub', 'f32.mul', 'f32.div', 'f32.min', 'f32.max', 'f32.copysign',
  'f64.abs', 'f64.neg', 'f64.ceil', 'f64.floor', 'f64.trunc', 'f64.nearest', 'f64.sqrt',
  'f64.add', 'f64.sub', 'f64.mul', 'f64.div', 'f64.min', 'f64.max', 'f64.copysign',
  'i32.wrap_i64', 'i32.trunc_f32_s', 'i32.trunc_f32_u', 'i32.trunc_f64_s', 'i32.trunc_f64_u',
  'i64.extend_i32_s', 'i64.extend_i32_u', 'i64.trunc_f32_s', 'i64.trunc_f32_u', 'i64.trunc_f64_s', 'i64.trunc_f64_u',
  'f32.convert_i32_s', 'f32.convert_i32_u', 'f32.convert_i64_s', 'f32.convert_i64_u', 'f32.demote_f64',
  'f64.convert_i32_s', 'f64.convert_i32_u', 'f64.convert_i64_s', 'f64.convert_i64_u', 'f64.promote_f32',
  'i32.reinterpret_f32', 'i64.reinterpret_f64', 'f32.reinterpret_i32', 'f64.reinterpret_i64',
  'i32.extend8_s', 'i32.extend16_s', 'i64.extend8_s', 'i64.extend16_s', 'i64.extend32_s',
];
NAMES0x45.forEach((n, i) => { OPS[0x45 + i] = [n]; });
const OPS_FC = {
  0: ['i32.trunc_sat_f32_s'], 1: ['i32.trunc_sat_f32_u'], 2: ['i32.trunc_sat_f64_s'], 3: ['i32.trunc_sat_f64_u'],
  4: ['i64.trunc_sat_f32_s'], 5: ['i64.trunc_sat_f32_u'], 6: ['i64.trunc_sat_f64_s'], 7: ['i64.trunc_sat_f64_u'],
  8: ['memory.init', 'u32u8'], 9: ['data.drop', 'u32'], 10: ['memory.copy', 'u8u8'], 11: ['memory.fill', 'u8'],
};
const OPS_FD = {
  0: ['v128.load', 'mem'], 11: ['v128.store', 'mem'], 12: ['v128.const', 'v128'],
  17: ['i32x4.splat'], 19: ['f32x4.splat'],
  55: ['i32x4.eq'], 56: ['i32x4.ne'],
  77: ['v128.not'], 78: ['v128.and'], 79: ['v128.andnot'], 80: ['v128.or'], 81: ['v128.xor'], 82: ['v128.bitselect'],
  92: ['v128.load32_zero', 'mem'],
  137: ['i16x8.extend_low_i8x16_u'], 169: ['i32x4.extend_low_i16x8_u'],
  228: ['f32x4.add'], 229: ['f32x4.sub'], 230: ['f32x4.mul'], 231: ['f32x4.div'],
};
const OPS_FE = {
  0: ['memory.atomic.notify', 'mem'], 1: ['memory.atomic.wait32', 'mem'], 3: ['atomic.fence', 'u8'],
  0x10: ['i32.atomic.load', 'mem'], 0x12: ['i32.atomic.load8_u', 'mem'], 0x13: ['i32.atomic.load16_u', 'mem'],
  0x17: ['i32.atomic.store', 'mem'], 0x19: ['i32.atomic.store8', 'mem'], 0x1a: ['i32.atomic.store16', 'mem'],
  0x1e: ['i32.atomic.rmw.add', 'mem'],
};

function immediate(r, kind) {
  switch (kind) {
    case undefined: return undefined;
    case 'u32': return r.u32();
    case 'u8': return r.u8();
    case 's32': return r.s32();
    case 's64': return r.s64();
    case 'f32': return r.f32bits();
    case 'f64': r.bytes(8); return 0;
    case 'v128': return Uint8Array.from(r.bytes(16));
    case 'mem': { const align = r.u32(); if (align & 0x40) throw new Error('multi-memory'); return { align, offset: r.u32() }; }
    case 'bt': {
      const c = r.b[r.p];
      if (c === 0x40) { r.p++; return { empty: true }; }
      if (VALTYPE[c]) { r.p++; return { result: VALTYPE[c] }; }
      return { type: r.s33() };
    }
    case 'table': { const n = r.u32(); const ls = []; for (let i = 0; i < n; i++) ls.push(r.u32()); return { labels: ls, def: r.u32() }; }
    case 'vt': { const n = r.u32(); const ts = []; for (let i = 0; i < n; i++) ts.push(r.valtype()); return ts; }
    case 'u32u32': return [r.u32(), r.u32()];
    case 'u32u8': return [r.u32(), r.u8()];
    case 'u8u8': return [r.u8(), r.u8()];
    default: throw new Error(`immediate kind ${kind}`);
  }
}

function decodeBody(r) {
  const ops = [];
  while (r.more()) {
    const at = r.p;
    const b = r.u8();
    let def;
    if (b === 0xfc) def = OPS_FC[r.u32()];
    else if (b === 0xfd) def = OPS_FD[r.u32()];
    else if (b === 0xfe) def = OPS_FE[r.u32()];
    else def = OPS[b];
    if (!def) throw new Error(`unsupported opcode 0x${b.toString(16)} at byte ${at}`);
    ops.push({ op: def[0], imm: immediate(r, def[1]) });
  }
  return ops;
}

export function decode(bin) {
  const r = new Reader(bin);
  if (r.f32bits() !== 0x6d736100 || r.f32bits() !== 1) throw new Error('not a wasm v1 module');
  const mod = { types: [], funcs: [], exports: [], memory: null, imports: [] };
  const sigs = [];
  while (r.more()) {
    const id = r.u8();
    const size = r.u32();
    const s = new Reader(bin, r.p, r.p + size);
    r.p += size;
    if (id === 0) continue; // custom (names)
    if (id === 1) {
      for (let n = s.u32(); n--;) {
        if (s.u8() !== 0x60) throw new Error('bad func type');
        const params = []; for (let k = s.u32(); k--;) params.push(s.valtype());
        const results = []; for (let k = s.u32(); k--;) results.push(s.valtype());
        mod.types.push({ params, results });
      }
    } else if (id === 2) {
      for (let n = s.u32(); n--;) {
        const m = s.name(), f = s.name(), kind = s.u8();
        if (kind !== 2) throw new Error(`import ${m}.${f}: only a memory import is supported`);
        const flags = s.u8();
        const min = s.u32();
        const max = flags & 1 ? s.u32() : null;
        mod.memory = { min, max, shared: Boolean(flags & 2) };
        mod.imports.push(`${m}.${f}`);
      }
    } else if (id === 3) {
      for (let n = s.u32(); n--;) sigs.push(s.u32());
    } else if (id === 7) {
      for (let n = s.u32(); n--;) {
        const name = s.name(), kind = s.u8(), index = s.u32();
        if (kind === 0) mod.exports.push({ name, index });
      }
    } else if (id === 10) {
      const n = s.u32();
      for (let i = 0; i < n; i++) {
        const size = s.u32();
        const body = new Reader(bin, s.p, s.p + size);
        s.p += size;
        const locals = [];
        for (let k = body.u32(); k--;) { const c = body.u32(); const t = body.valtype(); for (let j = 0; j < c; j++) locals.push(t); }
        mod.funcs.push({ type: sigs[i], locals, ops: decodeBody(body) });
      }
    } else if (id === 12) {
      // data count: fine as long as there are no data segments
    } else {
      throw new Error(`unsupported section ${id} (tables, globals, data and start are banned in the sim)`);
    }
  }
  if (!mod.memory || mod.memory.max !== mod.memory.min) throw new Error('need one imported memory with min == max');
  return mod;
}

// ---------------------------------------------------------------- codegen

const SIZE = { i32: 4, f32: 4, i64: 8, v128: 16 };
const GPRS = ['eax', 'ecx', 'edx', 'ebx', 'esi', 'edi'];
const BYTE = { eax: 'al', ecx: 'cl', edx: 'dl', ebx: 'bl' };
const WORD = { eax: 'ax', ecx: 'cx', edx: 'dx', ebx: 'bx', esi: 'si', edi: 'di' };
const XMMS = ['xmm0', 'xmm1', 'xmm2', 'xmm3', 'xmm4', 'xmm5', 'xmm6', 'xmm7'];
const INVERT = { e: 'ne', ne: 'e', b: 'ae', ae: 'b', a: 'be', be: 'a', l: 'ge', ge: 'l', g: 'le', le: 'g' };
const ICMP = { eq: 'e', ne: 'ne', lt_s: 'l', lt_u: 'b', gt_s: 'g', gt_u: 'a', le_s: 'le', le_u: 'be', ge_s: 'ge', ge_u: 'ae' };
const hex = (n) => `0x${(n >>> 0).toString(16)}`;
const INLINE_MAX = 48; // ops in a leaf function worth expanding at each call
const isGpr = (r) => GPRS.includes(r);

class Module {
  constructor(mod, opts = {}) {
    const { target = 'elf', bounds = true, names = [], prefix = new Uint8Array(8) } = opts;
    this.prefix = prefix;
    this.mod = mod;
    this.fnNames = names;
    this.target = target;
    this.bounds = bounds;
    this.memSize = mod.memory.min * 65536;
    this.lits = new Map(); // key -> { label, align, data }
    this.names = new Map(mod.exports.map((e) => [e.index, e.name]));
    // Small leaf functions are expanded at their call sites: no arguments
    // pushed, no frame, no results copied back.
    this.inline = new Set(mod.funcs.map((f, i) => i).filter((i) => {
      const ops = mod.funcs[i].ops;
      return opts.inline !== false && ops.length <= INLINE_MAX && !ops.some((o) => o.op === 'call' || o.op === 'call_indirect');
    }));
  }

  sym(name) { return this.target === 'coff' ? `_${name}` : name; }
  // a local (non-exported) symbol, so profilers and disassemblers can name it
  fnLabel(i) { return `qgf_${i}_${(this.fnNames[i] || this.names.get(i) || 'f').replace(/[^A-Za-z0-9_]/g, '_')}`; }
  get mem() { return this.sym('qg_mem'); }

  lit(kind, value) {
    const key = `${kind}:${value}`;
    let l = this.lits.get(key);
    if (!l) {
      l = { label: `.Lc${this.lits.size}`, kind, value };
      this.lits.set(key, l);
    }
    return l.label;
  }
  f32lit(bits) { return `dword ptr [${this.lit('f32', bits >>> 0)}]`; }
  m128lit(bytes) { return `xmmword ptr [${this.lit('v128', Array.from(bytes).join(','))}]`; }
  splatLit(bits) { const b = new Uint8Array(16); const dv = new DataView(b.buffer); for (let k = 0; k < 4; k++) dv.setUint32(4 * k, bits >>> 0, true); return this.m128lit(b); }
  i64lit(v) { return this.lit('i64', BigInt.asUintN(64, v).toString()); }

  translate() {
    const out = ['.intel_syntax noprefix'];
    // COFF: declare SafeSEH compatibility (there are no exception handlers), or nxdk's link refuses the object
    if (this.target === 'coff') out.push('.def @feat.00', '.scl 3', '.type 0', '.endef', '.globl @feat.00', '.set @feat.00, 1');
    out.push('.text');
    const sigOf = (i) => this.mod.types[this.mod.funcs[i].type];
    this.sigOf = sigOf;
    const counts = {};
    this.mod.funcs.forEach((f, i) => {
      const g = new Fn(this, i, f, sigOf(i));
      out.push(...g.emit());
      for (const [k, v] of Object.entries(g.counts)) counts[k] = (counts[k] || 0) + v;
    });
    this.counts = counts;
    for (const e of this.mod.exports) out.push(...this.wrapper(e));
    out.push('.data', '.balign 16');
    for (const l of [...this.lits.values()].sort((a, b) => (a.kind === 'v128' ? -1 : 1) - (b.kind === 'v128' ? -1 : 1))) {
      if (l.kind === 'v128') out.push('.balign 16', `${l.label}:`, `  .byte ${l.value}`);
      else if (l.kind === 'i64') { const v = BigInt(l.value); out.push('.balign 8', `${l.label}:`, `  .long ${hex(Number(v & 0xffffffffn))}, ${hex(Number(v >> 32n))}`); }
      else out.push('.balign 4', `${l.label}:`, `  .long ${hex(l.value)}`);
    }
    out.push('.balign 4', `.globl ${this.sym('qg_sim_mxcsr')}`, `${this.sym('qg_sim_mxcsr')}:`, '  .long 0x1f80');
    // sha-256(game.wasm)[0..8], which a hello carries so the relay can refuse a different sim
    out.push(`.globl ${this.sym('qg_wasm_prefix')}`, `${this.sym('qg_wasm_prefix')}:`, `  .byte ${Array.from(this.prefix).join(', ')}`);
    // x87: all exceptions masked, 64-bit precision, round down (only floor uses it)
    out.push(`.globl ${this.sym('qg_sim_fpucw')}`, `${this.sym('qg_sim_fpucw')}:`, '  .short 0x077f', '  .short 0');
    out.push('.bss', '.balign 4096', `.globl ${this.mem}`, `${this.mem}:`, `  .zero ${this.memSize}`);
    return out.join('\n') + '\n';
  }

  // cdecl, C-callable: saves the callee-saved registers and the FPU modes,
  // sets the sim's, and returns one i32 / f32 bits in eax, one i64 in edx:eax,
  // or several results through a trailing out pointer.
  wrapper({ name, index }) {
    const sig = this.sigOf(index);
    const res = resultLayout(sig.results);
    const out = [`.globl ${this.sym(`qg_${name}`)}`, ...(this.target === 'elf' ? [`.type qg_${name}, @function`] : []), `${this.sym(`qg_${name}`)}:`,
      '  push ebp', '  mov ebp, esp', '  push ebx', '  push esi', '  push edi',
      '  sub esp, 8', '  stmxcsr dword ptr [esp]', '  fnstcw word ptr [esp + 4]',
      `  ldmxcsr dword ptr [${this.sym('qg_sim_mxcsr')}]`, `  fldcw word ptr [${this.sym('qg_sim_fpucw')}]`];
    if (res.bytes) out.push(`  sub esp, ${res.bytes}`);
    const offs = []; let o = 8;
    for (const t of sig.params) { offs.push(o); o += SIZE[t]; }
    const outPtr = o;
    for (let i = sig.params.length - 1; i >= 0; i--) {
      for (let w = SIZE[sig.params[i]] / 4 - 1; w >= 0; w--) out.push(`  push dword ptr [ebp + ${offs[i] + 4 * w}]`);
    }
    out.push(`  call ${this.fnLabel(index)}`);
    const multi = sig.results.length > 1 || sig.results.some((t) => t === 'v128');
    if (multi) {
      out.push(`  mov ecx, dword ptr [ebp + ${outPtr}]`);
      for (let w = 0; w < res.bytes / 4; w++) out.push(`  mov eax, dword ptr [esp + ${4 * w}]`, `  mov dword ptr [ecx + ${4 * w}], eax`);
    } else if (sig.results.length === 1) {
      out.push('  mov eax, dword ptr [esp]');
      if (sig.results[0] === 'i64') out.push('  mov edx, dword ptr [esp + 4]');
    }
    if (res.bytes) out.push(`  add esp, ${res.bytes}`);
    out.push('  ldmxcsr dword ptr [esp]', '  fldcw word ptr [esp + 4]', '  add esp, 8',
      '  pop edi', '  pop esi', '  pop ebx', '  pop ebp', '  ret');
    return out;
  }

  header() {
    const ct = { i32: 'uint32_t', i64: 'uint64_t', f32: 'float' };
    const lines = [
      '// Generated by tools/w2x86.mjs from build/game.wasm. Do not edit.',
      '#ifndef QG_SIM_H', '#define QG_SIM_H', '#include <stdint.h>', '',
      `#define QG_MEM_SIZE ${this.memSize}u`,
      `extern uint8_t qg_mem[${this.memSize}];`,
      'extern const uint8_t qg_wasm_prefix[8]; // sha-256 of the game.wasm translated, for the hello', '',
      '// The sim, cdecl. One i32 or f32 result comes back as uint32_t bits, one',
      '// i64 as uint64_t, several through the trailing out pointer (u32 words).',
    ];
    for (const { name, index } of this.mod.exports) {
      const sig = this.sigOf(index);
      const args = sig.params.map((t, i) => `${ct[t]} a${i}`);
      const multi = sig.results.length > 1;
      if (multi) args.push('uint32_t *out');
      const ret = sig.results.length === 1 && !multi ? (sig.results[0] === 'i64' ? 'uint64_t' : 'uint32_t') : 'void';
      lines.push(`${ret} qg_${name}(${args.join(', ') || 'void'});`);
    }
    lines.push('', '// The host provides these.',
      'void qg_rt_trap(uint32_t code); // 1 out of bounds, 2 divide by zero, 3 unreachable; never returns',
      'uint32_t qg_rt_wait32(uint32_t addr, uint32_t offset, uint32_t expected, uint32_t timeout_lo, uint32_t timeout_hi);',
      'uint32_t qg_rt_notify(uint32_t addr, uint32_t offset, uint32_t count);',
      '', '#endif', '');
    return lines.join('\n');
  }
}

function resultLayout(results) {
  const offs = []; let o = 0;
  for (const t of results) { offs.push(o); o += SIZE[t]; }
  return { offs, bytes: o };
}

class Fn {
  constructor(m, index, f, sig) {
    this.m = m;
    this.index = index;
    this.sig = sig;
    this.ops = f.ops;
    this.code = [];
    this.cold = [];
    this.counts = {};
    this.labelN = 0;
    // params above ebp (pushed by the caller), then the result area
    this.locals = [];
    let o = 8;
    for (const t of sig.params) { this.locals.push({ t, addr: `ebp + ${o}` }); o += SIZE[t]; }
    this.argBytes = o - 8;
    this.res = resultLayout(sig.results);
    this.resBase = o;
    let lo = 0;
    this.zero = [];
    for (const t of f.locals) {
      if (t === 'f64') throw new Error('f64 local');
      lo += SIZE[t];
      this.locals.push({ t, addr: `ebp - ${lo}` });
      this.zero.push([lo, SIZE[t]]);
    }
    // each inlined callee's params and locals, one area per callee (the
    // expansions never nest, and one call's are dead before the next's)
    this.inlineBase = new Map();
    for (const { op, imm } of f.ops) {
      if (op !== 'call' || !m.inline.has(imm) || this.inlineBase.has(imm)) continue;
      this.inlineBase.set(imm, this.locals.length);
      for (const t of [...m.mod.types[m.mod.funcs[imm].type].params, ...m.mod.funcs[imm].locals]) {
        lo += SIZE[t];
        this.locals.push({ t, addr: `ebp - ${lo}` });
      }
    }
    this.localBytes = (lo + 15) & ~15;
    this.stack = [];
    this.maxDepth = 0;
    this.owner = new Map(); // reg -> stack entry
    this.busy = new Set();  // regs held by the op being lowered
    this.ctrl = [];
    this.dead = false;
    this.name = m.fnNames[index] || m.names.get(index) || `f${index}`;
  }

  label(p = 'L') { return `.L${p}${this.index}_${this.labelN++}`; }
  e(s) { this.code.push(`  ${s}`); }
  slot(d) { this.maxDepth = Math.max(this.maxDepth, d + 1); return `ebp - ${this.localBytes + 16 * (d + 1)}`; }
  where(i) { const x = this.stack[i]; return x.k === 'l' ? this.locals[x.i].addr : this.slot(i); }
  ptr(size, addr) { return `${{ 1: 'byte', 2: 'word', 4: 'dword', 8: 'qword', 16: 'xmmword' }[size]} ptr [${addr}]`; }

  // ---- register file

  free(cls) { return (cls === 'x' ? XMMS : GPRS).filter((r) => !this.owner.has(r) && !this.busy.has(r)); }
  alloc(cls = 'g', byteOnly = false) {
    let f = this.free(cls);
    if (byteOnly) f = f.filter((r) => BYTE[r]);
    if (f.length) { this.busy.add(f[0]); return f[0]; }
    // spill the deepest stack entry holding a suitable register
    for (let i = 0; i < this.stack.length; i++) {
      const x = this.stack[i];
      if (x.k === 'r' && (cls === 'x') === !isGpr(x.r) && (!byteOnly || BYTE[x.r])) {
        const r = x.r;
        this.spill(i);
        this.busy.add(r);
        return r;
      }
    }
    throw new Error(`${this.name}: out of ${cls} registers`);
  }
  release(r) { if (r) this.busy.delete(r); }
  // Free one particular register before the op pops its inputs.
  evict(r) {
    const x = this.owner.get(r);
    if (x) this.spill(this.stack.indexOf(x));
  }
  evictAll(cls) { for (let i = 0; i < this.stack.length; i++) if (this.stack[i].k === 'r' && (cls === undefined || (cls === 'x') === !isGpr(this.stack[i].r))) this.spill(i); }

  // ---- the value stack

  push(t, k, extra = {}) {
    const x = { t, k, ...extra };
    if (k === 'r') { this.busy.delete(x.r); this.owner.set(x.r, x); }
    this.stack.push(x);
    this.maxDepth = Math.max(this.maxDepth, this.stack.length);
    return x;
  }
  pushReg(t, r, nn = false) { return this.push(t, 'r', { r, nn }); }
  pop() {
    const x = this.stack.pop();
    if (!x) throw new Error(`${this.name}: stack underflow`);
    x.d = this.stack.length; // the depth it sat at, for its slot
    if (x.k === 'r') { this.owner.delete(x.r); this.busy.add(x.r); }
    return x;
  }

  // Write entry i to its own slot; flags-safe (only moves, push and pop).
  spill(i) {
    const x = this.stack[i];
    if (x.k === 's') return;
    const s = this.slot(i);
    if (x.k === 'c') this.storeConst(x, s);
    else if (x.k === 'l') this.copyMem(this.locals[x.i].addr, s, SIZE[x.t]);
    else if (x.k === 'f') { this.e(`mov ${this.ptr(4, s)}, 0`); this.e(`set${x.cc} ${this.ptr(1, s)}`); }
    else if (x.k === 'r') {
      if (isGpr(x.r)) this.e(`mov ${this.ptr(4, s)}, ${x.r}`);
      else if (x.t === 'v128') this.e(`movups ${this.ptr(16, s)}, ${x.r}`);
      else this.e(`movss ${this.ptr(4, s)}, ${x.r}`);
      this.owner.delete(x.r);
    }
    this.stack[i] = { t: x.t, k: 's', nn: x.nn };
  }
  spillAll() { for (let i = 0; i < this.stack.length; i++) this.spill(i); }
  storeConst(x, addr) {
    if (x.t === 'i64') {
      this.e(`mov ${this.ptr(4, addr)}, ${hex(Number(x.v & 0xffffffffn))}`);
      this.e(`mov ${this.ptr(4, `${addr} + 4`)}, ${hex(Number(x.v >> 32n))}`);
    } else if (x.t === 'v128') {
      const dv = new DataView(x.v.buffer, x.v.byteOffset, 16);
      for (let w = 0; w < 4; w++) this.e(`mov ${this.ptr(4, `${addr} + ${4 * w}`)}, ${hex(dv.getUint32(4 * w, true))}`);
    } else this.e(`mov ${this.ptr(4, addr)}, ${hex(x.v)}`);
  }
  // Memory to memory without a register: push and pop (flags-safe).
  copyMem(from, to, size) {
    if (from === to) return;
    for (let w = 0; w < size / 4; w++) {
      this.e(`push ${this.ptr(4, `${from} + ${4 * w}`)}`);
      this.e(`pop ${this.ptr(4, `${to} + ${4 * w}`)}`);
    }
  }
  // Before local.set x: no stack entry may still read the old value.
  detach(i) {
    for (let k = 0; k < this.stack.length; k++) {
      const x = this.stack[k];
      if (x.k === 'l' && x.i === i) this.spill(k);
    }
  }
  // Flags entries become real values before any op that might clobber flags.
  settle() {
    for (let k = 0; k < this.stack.length; k++) if (this.stack[k].k === 'f') this.materialize(k);
  }
  materialize(k) {
    const x = this.stack[k];
    const f = this.free('g').filter((r) => BYTE[r]);
    if (!f.length) { this.spill(k); return; }
    const r = f[0];
    this.e(`set${x.cc} ${BYTE[r]}`);
    this.e(`movzx ${r}, ${BYTE[r]}`);
    this.stack[k] = { t: 'i32', k: 'r', r, nn: true };
    this.owner.set(r, this.stack[k]);
  }

  // ---- operands of a popped entry

  mem(x) { return x.k === 'l' ? this.locals[x.i].addr : this.slot(x.d); }
  // A source operand for an integer op: imm, reg, or memory.
  src32(x) {
    if (x.k === 'c') return hex(x.v);
    if (x.k === 'r') return x.r;
    if (x.k === 'f') throw new Error('flags operand');
    return this.ptr(4, this.mem(x));
  }
  // The entry in a GPR the op may clobber.
  ownG(x, byteOnly = false) {
    if (x.k === 'r' && isGpr(x.r) && (!byteOnly || BYTE[x.r])) return x.r;
    const r = this.alloc('g', byteOnly);
    if (x.k === 'r' && isGpr(x.r)) { this.e(`mov ${r}, ${x.r}`); this.release(x.r); }
    else if (x.k === 'r') { const s = this.slot(x.d); this.e(`movss ${this.ptr(4, s)}, ${x.r}`); this.e(`mov ${r}, ${this.ptr(4, s)}`); this.release(x.r); }
    else if (x.k === 'f') throw new Error('flags operand');
    else this.e(`mov ${r}, ${this.src32(x)}`);
    return r;
  }
  // f32 / v128 source: xmm reg or memory (v128 memory only if aligned literal).
  srcX(x) {
    if (x.k === 'r' && !isGpr(x.r)) return x.r;
    if (x.t === 'v128') {
      if (x.k === 'c') return this.m.m128lit(x.v);
      return this.ownX(x);
    }
    if (x.k === 'c') return this.m.f32lit(x.v);
    if (x.k === 'r') { const s = this.slot(x.d); this.e(`mov ${this.ptr(4, s)}, ${x.r}`); this.release(x.r); return this.ptr(4, s); }
    return this.ptr(4, this.mem(x));
  }
  ownX(x) {
    if (x.k === 'r' && !isGpr(x.r)) return x.r;
    const r = this.alloc('x');
    if (x.t === 'v128') {
      if (x.k === 'c') this.e(`movaps ${r}, ${this.m.m128lit(x.v)}`);
      else this.e(`movups ${r}, ${this.ptr(16, this.mem(x))}`);
    } else if (x.k === 'r') {
      const s = this.slot(x.d); this.e(`mov ${this.ptr(4, s)}, ${x.r}`); this.release(x.r); this.e(`movss ${r}, ${this.ptr(4, s)}`);
    } else if (x.k === 'c') this.e(`movss ${r}, ${this.m.f32lit(x.v)}`);
    else this.e(`movss ${r}, ${this.ptr(4, this.mem(x))}`);
    return r;
  }
  // i64 / v128 operand address in memory (spilling a register value to its slot).
  addrOf(x) {
    if (x.k === 'c') return x.t === 'i64' ? this.m.i64lit(x.v) : this.m.lit('v128', Array.from(x.v).join(','));
    if (x.k === 'r') {
      const s = this.slot(x.d);
      if (x.t === 'v128') this.e(`movups ${this.ptr(16, s)}, ${x.r}`);
      else if (isGpr(x.r)) this.e(`mov ${this.ptr(4, s)}, ${x.r}`);
      else this.e(`movss ${this.ptr(4, s)}, ${x.r}`);
      this.release(x.r);
      return s;
    }
    return this.mem(x);
  }

  // Effective address for an access of `size` bytes; returns [operand base, reg or null].
  ea(x, offset, size) {
    const lim = this.m.memSize - offset - size;
    if (x.k === 'c') {
      const a = (x.v >>> 0) + offset;
      if (a + size > this.m.memSize) this.e(`jmp ${this.trap(1)}`);
      return [`${this.m.mem} + ${a}`, null];
    }
    const r = this.ownG(x);
    if (this.m.bounds) {
      if (lim < 0) this.e(`jmp ${this.trap(1)}`);
      else { this.e(`cmp ${r}, ${hex(lim)}`); this.e(`ja ${this.trap(1)}`); }
    }
    return [`${r} + ${this.m.mem}${offset ? ` + ${offset}` : ''}`, r];
  }
  trap(code) {
    this.traps = this.traps || {};
    if (!this.traps[code]) this.traps[code] = this.label('trap');
    return this.traps[code];
  }

  // ---- control

  blockSig(imm) {
    if (imm.empty) return { params: [], results: [] };
    if (imm.result) return { params: [], results: [imm.result] };
    return this.m.mod.types[imm.type];
  }
  // Put the top n values (all in their slots by now) at depths base..base+n.
  moveTop(n, base) {
    const top = this.stack.length - n;
    for (let k = 0; k < n; k++) {
      const x = this.stack[top + k];
      if (top + k !== base + k) this.copyMem(this.slot(top + k), this.slot(base + k), SIZE[x.t]);
    }
  }
  // Results of the function, from the top of the stack into the result area.
  writeResults() {
    const n = this.sig.results.length;
    const top = this.stack.length - n;
    for (let k = 0; k < n; k++) this.storeTo(top + k, `ebp + ${this.resBase + this.res.offs[k]}`);
  }
  // Entry i's value into memory at addr, from wherever it is (flags-safe).
  storeTo(i, addr) {
    const x = this.stack[i];
    if (x.k === 'c') this.storeConst(x, addr);
    else if (x.k === 'f') { this.e(`mov ${this.ptr(4, addr)}, 0`); this.e(`set${x.cc} ${this.ptr(1, addr)}`); }
    else if (x.k === 'r') {
      if (isGpr(x.r)) this.e(`mov ${this.ptr(4, addr)}, ${x.r}`);
      else if (x.t === 'v128') this.e(`movups ${this.ptr(16, addr)}, ${x.r}`);
      else this.e(`movss ${this.ptr(4, addr)}, ${x.r}`);
    } else this.copyMem(this.where(i), addr, SIZE[x.t]);
  }
  branchTo(depth) {
    const f = this.ctrl[this.ctrl.length - 1 - depth];
    if (f.kind === 'func') { this.writeResults(); return '.Lret' + this.index; }
    const arity = f.kind === 'loop' ? f.sig.params.length : f.sig.results.length;
    this.moveTop(arity, f.height);
    return f.kind === 'loop' ? f.top : f.end;
  }
  needsMove(depth) {
    const f = this.ctrl[this.ctrl.length - 1 - depth];
    if (f.kind === 'func') return true;
    const arity = f.kind === 'loop' ? f.sig.params.length : f.sig.results.length;
    return arity > 0 && this.stack.length - arity !== f.height;
  }
  resetTo(f, types) {
    this.stack.length = f.height;
    for (const t of types) this.push(t, 's');
    this.owner.clear();
    this.busy.clear();
  }
  // Flags for a popped condition: returns the condition code that means "true".
  test(c) {
    if (c.k === 'f') return c.cc;
    if (c.k === 'r') { this.e(`test ${c.r}, ${c.r}`); this.release(c.r); }
    else this.e(`cmp ${this.ptr(4, this.mem(c))}, 0`);
    return 'ne';
  }

  // ctx: the local index base and the block a return leaves, inside an inlined body
  run(ops, ctx) {
    for (let pc = 0; pc < ops.length; pc++) {
      const { op } = ops[pc];
      let { imm } = ops[pc];
      if (ctx.base && op.startsWith('local.')) imm += ctx.base;
      this.counts[op] = (this.counts[op] || 0) + 1;
      if (this.dead) { this.deadOp(op, imm); continue; }
      // At most one flags entry exists (each compare settles the last). It
      // stays as flags only into an op that consumes it from the top; ops
      // that emit nothing leave it be; anything else makes it a value first.
      const consumes = ['br_if', 'if', 'select', 'i32.eqz'].includes(op) && this.stack.at(-1)?.k === 'f';
      if (!consumes && !['local.get', 'i32.const', 'f32.const', 'i64.const', 'v128.const'].includes(op)) this.settle();
      if (op === 'f32.floor' && ops[pc + 1]?.op === 'i32.trunc_sat_f32_s') {
        this.floorToInt();
        this.counts['i32.trunc_sat_f32_s'] = (this.counts['i32.trunc_sat_f32_s'] || 0) + 1;
        pc++;
      } else if (op === 'return' && ctx.frame) this.lower('br', this.ctrl.length - 1 - this.ctrl.indexOf(ctx.frame));
      else if (op === 'call' && this.inlineBase.has(imm)) this.inlineCall(imm);
      else this.lower(op, imm);
      if (this.busy.size) throw new Error(`${this.name}: ${op} left ${[...this.busy]} busy`);
    }
  }

  // The callee's body as a block: arguments into its params, its locals
  // zeroed, a return as a branch out of the block.
  inlineCall(fi) {
    const callee = this.m.mod.funcs[fi];
    const sig = this.m.sigOf(fi);
    const base = this.inlineBase.get(fi);
    for (let k = sig.params.length - 1; k >= 0; k--) this.setLocal(base + k, false);
    callee.locals.forEach((t, k) => this.storeConst({ t, v: t === 'i64' ? 0n : t === 'v128' ? new Uint8Array(16) : 0 }, this.locals[base + sig.params.length + k].addr));
    this.spillAll();
    const frame = { kind: 'block', sig: { params: [], results: sig.results }, height: this.stack.length, end: this.label('end') };
    this.ctrl.push(frame);
    this.owner.clear();
    this.counts.inlined = (this.counts.inlined || 0) + 1;
    this.run(callee.ops, { base, frame });
  }

  emit() {
    const sig = this.sig;
    this.ctrl.push({ kind: 'func', sig: { params: [], results: sig.results }, height: 0 });
    this.run(this.ops, { base: 0, frame: null });
    if (this.ctrl.length) throw new Error(`${this.name}: unbalanced control`);
    const frame = this.localBytes + 16 * this.maxDepth;
    const fn = this.m.fnLabel(this.index);
    const head = [...(this.m.target === 'elf' ? [`.type ${fn}, @function`] : []), `${fn}:`, '  push ebp', '  mov ebp, esp'];
    if (frame) head.push(`  sub esp, ${frame}`);
    if (this.zero.length) {
      const bytes = this.zero.reduce((a, [, s]) => a + s, 0);
      const top = this.zero.at(-1)[0];
      if (bytes > 64) head.push(`  lea edi, [ebp - ${top}]`, `  mov ecx, ${bytes / 4}`, '  xor eax, eax', '  rep stosd');
      else for (const [o, s] of this.zero) for (let w = 0; w < s / 4; w++) head.push(`  mov dword ptr [ebp - ${o - 4 * w}], 0`);
    }
    const tail = [`.Lret${this.index}:`, '  mov esp, ebp', '  pop ebp', this.argBytes ? `  ret ${this.argBytes}` : '  ret'];
    const traps = [];
    for (const [code, l] of Object.entries(this.traps || {})) traps.push(`${l}:`, `  push ${code}`, `  call ${this.m.sym('qg_rt_trap')}`);
    const size = this.m.target === 'elf' ? [`.size ${fn}, .-${fn}`] : [];
    return [...head, ...this.code, ...tail, ...this.cold, ...traps, ...size, ''];
  }

  deadOp(op, imm) {
    if (op === 'block' || op === 'loop' || op === 'if') { this.ctrl.push({ kind: 'dead' }); return; }
    const f = this.ctrl.at(-1);
    if (op === 'else' && f.kind !== 'dead') { this.elseOp(f, false); return; }
    if (op === 'end') {
      if (f.kind === 'dead') { this.ctrl.pop(); return; }
      this.endOp(false);
    }
  }

  elseOp(f, live) {
    if (live) { this.spillAll(); this.e(`jmp ${f.end}`); }
    this.code.push(`${f.else}:`);
    f.hasElse = true;
    this.resetTo(f, f.sig.params);
    this.dead = false;
  }

  endOp(live) {
    const f = this.ctrl.pop();
    if (f.kind === 'func') {
      if (live) this.writeResults();
      this.dead = false;
      return;
    }
    if (live) this.spillAll();
    if (f.kind === 'if' && !f.hasElse) this.code.push(`${f.else}:`);
    if (f.end) this.code.push(`${f.end}:`);
    this.resetTo(f, f.sig.results);
    this.dead = false;
  }

  lower(op, imm) {
    const [ty, name] = op.includes('.') ? op.split(/\.(.*)/) : ['', op];
    switch (op) {
      case 'nop': return;
      case 'unreachable': this.e(`jmp ${this.trap(3)}`); this.dead = true; return;
      case 'block': case 'loop': {
        const sig = this.blockSig(imm);
        this.spillAll();
        const f = { kind: op, sig, height: this.stack.length - sig.params.length };
        if (op === 'loop') { f.top = this.label('top'); this.code.push(`${f.top}:`); }
        else f.end = this.label('end');
        this.ctrl.push(f);
        this.owner.clear();
        return;
      }
      case 'if': {
        const sig = this.blockSig(imm);
        const c = this.pop();
        this.spillAll();
        const f = { kind: 'if', sig, height: this.stack.length - sig.params.length, else: this.label('else'), end: this.label('end') };
        if (c.k === 'c') { if (!c.v) this.e(`jmp ${f.else}`); }
        else { const cc = this.test(c); this.e(`j${INVERT[cc]} ${f.else}`); }
        this.ctrl.push(f);
        this.owner.clear();
        return;
      }
      case 'else': this.elseOp(this.ctrl.at(-1), true); return;
      case 'end': this.endOp(true); return;
      case 'br': this.spillAll(); this.e(`jmp ${this.branchTo(imm)}`); this.dead = true; return;
      case 'return': this.writeResults(); this.e(`jmp .Lret${this.index}`); this.dead = true; return;
      case 'br_if': {
        const c = this.pop();
        this.spillAll();
        if (c.k === 'c') { if (c.v) { this.e(`jmp ${this.branchTo(imm)}`); this.dead = true; } return; }
        const cc = this.test(c);
        if (this.needsMove(imm)) {
          const skip = this.label('skip');
          this.e(`j${INVERT[cc]} ${skip}`);
          this.e(`jmp ${this.branchTo(imm)}`);
          this.code.push(`${skip}:`);
        } else this.e(`j${cc} ${this.branchTo(imm)}`);
        return;
      }
      case 'call': return this.call(imm);
      case 'drop': { const x = this.pop(); if (x.k === 'r') this.release(x.r); return; }
      case 'select': return this.select();
      case 'local.get': this.push(this.locals[imm].t, 'l', { i: imm }); return;
      case 'local.set': case 'local.tee': return this.setLocal(imm, op === 'local.tee');
      case 'i32.const': this.push('i32', 'c', { v: imm | 0, nn: imm >= 0 }); return;
      case 'f32.const': this.push('f32', 'c', { v: imm >>> 0 }); return;
      case 'i64.const': this.push('i64', 'c', { v: BigInt.asUintN(64, imm) }); return;
      case 'v128.const': this.push('v128', 'c', { v: imm }); return;
      case 'memory.fill': return this.fill();
      case 'memory.copy': return this.copy();
      case 'atomic.fence': this.e('lock or dword ptr [esp], 0'); return;
      case 'memory.atomic.notify': return this.rtCall('qg_rt_notify', imm, 2);
      case 'memory.atomic.wait32': return this.rtCall('qg_rt_wait32', imm, 3);
      default:
    }
    if (imm && imm.offset !== undefined) return this.access(op, imm);
    if (ty === 'i32') return this.i32(name, op);
    if (ty === 'f32') return this.f32(name, op);
    if (ty === 'i64') return this.i64(name, op);
    return this.v128(op);
  }

  setLocal(i, tee) {
    const v = this.pop();
    this.detach(i);
    const L = this.locals[i];
    const size = SIZE[L.t];
    if (v.k === 'c') this.storeConst(v, L.addr);
    else if (v.k === 'f') { this.e(`mov ${this.ptr(4, L.addr)}, 0`); this.e(`set${v.cc} ${this.ptr(1, L.addr)}`); }
    else if (v.k === 'r') {
      if (isGpr(v.r)) this.e(`mov ${this.ptr(4, L.addr)}, ${v.r}`);
      else if (v.t === 'v128') this.e(`movups ${this.ptr(16, L.addr)}, ${v.r}`);
      else this.e(`movss ${this.ptr(4, L.addr)}, ${v.r}`);
    } else {
      const from = this.mem(v);
      if (from !== L.addr) {
        const scratch = size === 16 ? this.free('x')[0] : this.free('g')[0];
        if (size === 16 && scratch) { this.e(`movups ${scratch}, ${this.ptr(16, from)}`); this.e(`movups ${this.ptr(16, L.addr)}, ${scratch}`); }
        else if (scratch && size <= 8) for (let w = 0; w < size / 4; w++) { this.e(`mov ${scratch}, ${this.ptr(4, `${from} + ${4 * w}`)}`); this.e(`mov ${this.ptr(4, `${L.addr} + ${4 * w}`)}, ${scratch}`); }
        else this.copyMem(from, L.addr, size);
      }
    }
    if (tee) {
      if (v.k === 'r') this.pushReg(v.t, v.r, v.nn);
      else this.push(L.t, 'l', { i, nn: v.nn });
    } else if (v.k === 'r') this.release(v.r);
  }

  call(fi) {
    const sig = this.m.sigOf(fi);
    const n = sig.params.length;
    this.evictAll();
    // values below the arguments stay where they are: a callee can't touch our locals
    for (let k = 0; k < this.stack.length - n; k++) if (this.stack[k].k === 'f') this.spill(k);
    const res = resultLayout(sig.results);
    if (res.bytes) this.e(`sub esp, ${res.bytes}`);
    const base = this.stack.length - n;
    for (let k = n - 1; k >= 0; k--) {
      const x = this.stack[base + k];
      const words = SIZE[x.t] / 4;
      if (x.k === 'c') {
        if (x.t === 'i64') { this.e(`push ${hex(Number(x.v >> 32n))}`); this.e(`push ${hex(Number(x.v & 0xffffffffn))}`); }
        else if (x.t === 'v128') { const dv = new DataView(x.v.buffer, x.v.byteOffset, 16); for (let w = 3; w >= 0; w--) this.e(`push ${hex(dv.getUint32(4 * w, true))}`); }
        else this.e(`push ${hex(x.v)}`);
      } else if (x.k === 'f') {
        // cannot happen: flags are settled before a call
        throw new Error('flags argument');
      } else {
        const a = this.where(base + k);
        for (let w = words - 1; w >= 0; w--) this.e(`push ${this.ptr(4, `${a} + ${4 * w}`)}`);
      }
    }
    this.e(`call ${this.m.fnLabel(fi)}`);
    this.stack.length = base;
    for (let k = 0; k < sig.results.length; k++) {
      const t = sig.results[k];
      const s = this.slot(base + k);
      for (let w = 0; w < SIZE[t] / 4; w++) this.e(`pop ${this.ptr(4, `${s} + ${4 * w}`)}`);
      this.push(t, 's');
    }
  }

  // C helpers (cdecl): args are (addr, offset, ...rest as u32 words).
  rtCall(fn, imm, nargs) {
    this.evictAll();
    const xs = [];
    for (let k = 0; k < nargs; k++) xs.unshift(this.pop());
    for (const x of xs) if (x.k === 'f') throw new Error('flags argument');
    const words = [];
    for (const x of xs) {
      if (x.k === 'c') {
        if (x.t === 'i64') words.push(hex(Number(x.v & 0xffffffffn)), hex(Number(x.v >> 32n)));
        else words.push(hex(x.v));
      } else {
        const a = this.mem(x);
        words.push(this.ptr(4, a));
        if (x.t === 'i64') words.push(this.ptr(4, `${a} + 4`));
      }
    }
    words.splice(1, 0, String(imm.offset));
    for (let k = words.length - 1; k >= 0; k--) this.e(`push ${words[k]}`);
    this.e(`call ${this.m.sym(fn)}`);
    this.e(`add esp, ${4 * words.length}`);
    this.busy.add('eax');
    this.pushReg('i32', 'eax');
  }

  fill() {
    this.evictAll('g');
    const n = this.pop(), v = this.pop(), d = this.pop();
    const lim = this.m.memSize;
    const ld = (r, x) => this.e(`mov ${r}, ${this.src32(x)}`);
    ld('edi', d); ld('eax', v); ld('ecx', n);
    if (this.m.bounds) {
      this.e(`cmp ecx, ${hex(lim)}`); this.e(`ja ${this.trap(1)}`);
      this.e(`mov edx, ${hex(lim)}`); this.e('sub edx, ecx');
      this.e('cmp edi, edx'); this.e(`ja ${this.trap(1)}`);
    }
    this.e('movzx eax, al'); this.e('imul eax, eax, 0x01010101');
    this.e(`add edi, offset ${this.m.mem}`);
    this.e('mov edx, ecx'); this.e('shr ecx, 2'); this.e('rep stosd');
    this.e('mov ecx, edx'); this.e('and ecx, 3'); this.e('rep stosb');
  }

  copy() {
    this.evictAll('g');
    const n = this.pop(), s = this.pop(), d = this.pop();
    const lim = this.m.memSize;
    const ld = (r, x) => this.e(`mov ${r}, ${this.src32(x)}`);
    ld('edi', d); ld('esi', s); ld('ecx', n);
    if (this.m.bounds) {
      this.e(`cmp ecx, ${hex(lim)}`); this.e(`ja ${this.trap(1)}`);
      this.e(`mov edx, ${hex(lim)}`); this.e('sub edx, ecx');
      this.e('cmp edi, edx'); this.e(`ja ${this.trap(1)}`);
      this.e('cmp esi, edx'); this.e(`ja ${this.trap(1)}`);
    }
    const fwd = this.label('fwd'), done = this.label('done');
    this.e('cmp edi, esi'); this.e(`jbe ${fwd}`);
    this.e('lea eax, [esi + ecx]'); this.e('cmp edi, eax'); this.e(`jae ${fwd}`);
    // overlapping, destination above: copy from the end, a byte at a time
    this.e(`lea esi, [esi + ecx + ${this.m.mem} - 1]`); this.e(`lea edi, [edi + ecx + ${this.m.mem} - 1]`);
    this.e('std'); this.e('rep movsb'); this.e('cld'); this.e(`jmp ${done}`);
    this.code.push(`${fwd}:`);
    this.e(`add esi, offset ${this.m.mem}`); this.e(`add edi, offset ${this.m.mem}`);
    this.e('mov edx, ecx'); this.e('shr ecx, 2'); this.e('rep movsd');
    this.e('mov ecx, edx'); this.e('and ecx, 3'); this.e('rep movsb');
    this.code.push(`${done}:`);
  }

  select() {
    const c = this.pop(), b = this.pop(), a = this.pop(); // c ? a : b
    if (c.k === 'c') {
      const keep = c.v ? a : b, drop = c.v ? b : a;
      if (drop.k === 'r') this.release(drop.r);
      if (keep.k === 'r') this.pushReg(keep.t, keep.r, keep.nn);
      else if (keep.k === 's' && keep.d !== this.stack.length) { this.copyMem(this.slot(keep.d), this.slot(this.stack.length), SIZE[keep.t]); this.push(keep.t, 's'); }
      else this.stack.push({ ...keep, d: undefined });
      return;
    }
    const t = a.t;
    if (t === 'i32') {
      const r = this.ownG(b);
      let s = a.k === 'r' ? a.r : a.k === 'c' ? null : this.ptr(4, this.mem(a));
      if (!s) { s = this.alloc('g'); this.e(`mov ${s}, ${hex(a.v)}`); }
      const cc = this.test(c);
      this.e(`cmov${cc} ${r}, ${s}`);
      if (isGpr(s)) this.release(s);
      this.pushReg('i32', r, a.nn && b.nn);
      return;
    }
    if (t === 'f32') {
      const r = this.ownX(b);
      const s = this.srcX(a);
      const cc = this.test(c);
      const skip = this.label('sel');
      this.e(`j${INVERT[cc]} ${skip}`);
      this.e(XMMS.includes(s) ? `movaps ${r}, ${s}` : `movss ${r}, ${s}`);
      this.code.push(`${skip}:`);
      if (XMMS.includes(s)) this.release(s);
      this.pushReg('f32', r);
      return;
    }
    if (t === 'v128') {
      const r = this.ownX(b);
      const s = this.ownX(a);
      const cc = this.test(c);
      const skip = this.label('sel');
      this.e(`j${INVERT[cc]} ${skip}`);
      this.e(`movaps ${r}, ${s}`);
      this.code.push(`${skip}:`);
      this.release(s);
      this.pushReg('v128', r);
      return;
    }
    // i64: through memory, into a's slot
    const d = a.d;
    const fa = this.addrOf(a), fb = this.addrOf(b);
    const cc = this.test(c);
    const skip = this.label('sel');
    // copy a first (flags-safe), then overwrite with b when the condition is false
    this.copyMem(fa, this.slot(d), 8);
    this.e(`j${cc} ${skip}`);
    this.copyMem(fb, this.slot(d), 8);
    this.code.push(`${skip}:`);
    this.push('i64', 's');
  }

  access(op, imm) {
    const off = imm.offset;
    const atomic = op.includes('atomic');
    if (/load/.test(op)) {
      const a = this.pop();
      const size = { 'i32.load': 4, 'f32.load': 4, 'i64.load': 8, 'v128.load': 16, 'v128.load32_zero': 4,
        'i32.load8_u': 1, 'i32.load8_s': 1, 'i32.load16_u': 2, 'i32.load16_s': 2,
        'i64.load8_u': 1, 'i64.load16_u': 2, 'i64.load32_u': 4, 'i64.load8_s': 1, 'i64.load16_s': 2, 'i64.load32_s': 4,
        'i32.atomic.load': 4, 'i32.atomic.load8_u': 1, 'i32.atomic.load16_u': 2 }[op];
      if (!size) throw new Error(`unsupported ${op}`);
      const [base, ar] = this.ea(a, off, op === 'v128.load32_zero' ? 4 : size);
      const at = (s) => this.ptr(s, base);
      if (op.startsWith('i32')) {
        const r = ar || this.alloc('g');
        const kind = op.replace('i32.', '').replace('atomic.', '');
        if (kind === 'load') this.e(`mov ${r}, ${at(4)}`);
        else this.e(`${kind.endsWith('_s') ? 'movsx' : 'movzx'} ${r}, ${at(size)}`);
        this.pushReg('i32', r, size < 4 && !kind.endsWith('_s'));
        return;
      }
      if (op === 'f32.load') { const x = this.alloc('x'); this.e(`movss ${x}, ${at(4)}`); this.release(ar); this.pushReg('f32', x); return; }
      if (op === 'v128.load') { const x = this.alloc('x'); this.e(`movups ${x}, ${at(16)}`); this.release(ar); this.pushReg('v128', x); return; }
      if (op === 'v128.load32_zero') { const x = this.alloc('x'); this.e(`movss ${x}, ${at(4)}`); this.release(ar); this.pushReg('v128', x); return; }
      // i64 loads land in the slot
      const s = this.slot(this.stack.length);
      const t = this.alloc('g');
      if (size === 8) {
        this.e(`mov ${t}, ${at(4)}`); this.e(`mov ${this.ptr(4, s)}, ${t}`);
        this.e(`mov ${t}, ${this.ptr(4, `${base} + 4`)}`); this.e(`mov ${this.ptr(4, `${s} + 4`)}, ${t}`);
      } else {
        const signed = op.endsWith('_s');
        if (size === 4) this.e(`mov ${t}, ${at(4)}`);
        else this.e(`${signed ? 'movsx' : 'movzx'} ${t}, ${at(size)}`);
        this.e(`mov ${this.ptr(4, s)}, ${t}`);
        if (signed) { this.e(`sar ${t}, 31`); this.e(`mov ${this.ptr(4, `${s} + 4`)}, ${t}`); }
        else this.e(`mov ${this.ptr(4, `${s} + 4`)}, 0`);
      }
      this.release(t); this.release(ar);
      this.push('i64', 's');
      return;
    }
    // stores and read-modify-writes
    const v = this.pop(), a = this.pop();
    const size = { 'i32.store': 4, 'f32.store': 4, 'i64.store': 8, 'v128.store': 16, 'i32.store8': 1, 'i32.store16': 2,
      'i64.store8': 1, 'i64.store16': 2, 'i64.store32': 4,
      'i32.atomic.store': 4, 'i32.atomic.store8': 1, 'i32.atomic.store16': 2, 'i32.atomic.rmw.add': 4 }[op];
    if (!size) throw new Error(`unsupported ${op}`);
    if (op === 'i32.atomic.rmw.add') {
      const r = this.ownG(v);
      const [base, ar] = this.ea(a, off, 4);
      this.e(`lock xadd ${this.ptr(4, base)}, ${r}`);
      this.release(ar);
      this.pushReg('i32', r);
      return;
    }
    if (atomic) {
      const r = this.ownG(v, size === 1);
      const [base, ar] = this.ea(a, off, size);
      const rn = size === 1 ? BYTE[r] : size === 2 ? WORD[r] : r;
      this.e(`xchg ${this.ptr(size, base)}, ${rn}`);
      this.release(r); this.release(ar);
      return;
    }
    if (v.t === 'i64') {
      const from = this.addrOf(v);
      const [base, ar] = this.ea(a, off, size);
      const t = this.alloc('g', size === 1);
      this.e(`mov ${t}, ${this.ptr(4, from)}`);
      this.e(`mov ${this.ptr(size === 8 ? 4 : size, base)}, ${size === 1 ? BYTE[t] : size === 2 ? WORD[t] : t}`);
      if (size === 8) { this.e(`mov ${t}, ${this.ptr(4, `${from} + 4`)}`); this.e(`mov ${this.ptr(4, `${base} + 4`)}, ${t}`); }
      this.release(t); this.release(ar);
      return;
    }
    if (v.t === 'v128') {
      const x = this.ownX(v);
      const [base, ar] = this.ea(a, off, 16);
      this.e(`movups ${this.ptr(16, base)}, ${x}`);
      this.release(x); this.release(ar);
      return;
    }
    if (v.t === 'f32' && v.k === 'r') {
      const [base, ar] = this.ea(a, off, 4);
      this.e(`movss ${this.ptr(4, base)}, ${v.r}`);
      this.release(v.r); this.release(ar);
      return;
    }
    // i32 (and f32 bits from memory or a constant)
    if (v.k === 'c') {
      const [base, ar] = this.ea(a, off, size);
      const mask = size === 1 ? 0xff : size === 2 ? 0xffff : 0xffffffff;
      this.e(`mov ${this.ptr(size, base)}, ${hex(v.v & mask)}`);
      this.release(ar);
      return;
    }
    const r = this.ownG(v, size === 1);
    const [base, ar] = this.ea(a, off, size);
    this.e(`mov ${this.ptr(size, base)}, ${size === 1 ? BYTE[r] : size === 2 ? WORD[r] : r}`);
    this.release(r); this.release(ar);
  }

  i32(name, op) {
    const bin = { add: 'add', sub: 'sub', and: 'and', or: 'or', xor: 'xor', mul: 'imul' }[name];
    if (bin) {
      let b = this.pop(), a = this.pop();
      if (name !== 'sub' && a.k !== 'r' && b.k === 'r' && isGpr(b.r)) [a, b] = [b, a];
      const r = this.ownG(a);
      if (bin === 'imul' && b.k === 'c') this.e(`imul ${r}, ${r}, ${hex(b.v)}`);
      else this.e(`${bin} ${r}, ${this.src32(b)}`);
      if (b.k === 'r') this.release(b.r);
      const nn = name === 'and' ? (a.nn || b.nn) : name === 'or' || name === 'xor' ? (a.nn && b.nn) : false;
      this.pushReg('i32', r, nn);
      return;
    }
    const sh = { shl: 'shl', shr_s: 'sar', shr_u: 'shr', rotl: 'rol', rotr: 'ror' }[name];
    if (sh) {
      const top = this.stack.at(-1);
      if (top.k === 'c') {
        const b = this.pop(), a = this.pop();
        const r = this.ownG(a);
        const n = b.v & 31;
        if (n) this.e(`${sh} ${r}, ${n}`);
        this.pushReg('i32', r, (name === 'shr_u' && n > 0) || (a.nn && name === 'shr_s'));
        return;
      }
      this.evict('ecx');
      const b = this.pop(), a = this.pop();
      if (!(b.k === 'r' && b.r === 'ecx')) { this.busy.add('ecx'); this.e(`mov ecx, ${this.src32(b)}`); if (b.k === 'r') this.release(b.r); }
      const r = this.ownG(a);
      this.e(`${sh} ${r}, cl`);
      this.release('ecx');
      this.pushReg('i32', r);
      return;
    }
    if (['div_u', 'rem_u', 'div_s', 'rem_s'].includes(name)) {
      this.evict('eax'); this.evict('edx');
      const b = this.pop(), a = this.pop();
      this.busy.add('eax'); this.busy.add('edx');
      let d = b.k === 'r' ? b.r : null;
      if (d === 'eax' || d === 'edx') throw new Error('divisor in eax/edx');
      if (!d) { d = this.alloc('g'); this.e(`mov ${d}, ${this.src32(b)}`); }
      if (a.k === 'r') { this.e(`mov eax, ${a.r}`); this.release(a.r); } else this.e(`mov eax, ${this.src32(a)}`);
      this.e(`test ${d}, ${d}`); this.e(`jz ${this.trap(2)}`);
      if (name.endsWith('_u')) { this.e('xor edx, edx'); this.e(`div ${d}`); }
      else {
        if (name === 'rem_s') {
          // INT_MIN % -1 is 0 in wasm and a fault on x86
          const ok = this.label('rem');
          this.e(`cmp ${d}, -1`); this.e(`jne ${ok}`); this.e('xor eax, eax'); this.e(`mov ${d}, 1`);
          this.code.push(`${ok}:`);
        }
        this.e('cdq'); this.e(`idiv ${d}`);
      }
      this.release(d);
      const keep = name.startsWith('div') ? 'eax' : 'edx';
      this.release(keep === 'eax' ? 'edx' : 'eax');
      this.pushReg('i32', keep, name === 'rem_u' && b.nn);
      return;
    }
    if (name === 'eqz') {
      const a = this.pop();
      if (a.k === 'f') { this.push('i32', 'f', { cc: INVERT[a.cc] }); return; }
      if (a.k === 'c') { this.push('i32', 'c', { v: a.v ? 0 : 1, nn: true }); return; }
      if (a.k === 'r') { this.e(`test ${a.r}, ${a.r}`); this.release(a.r); }
      else this.e(`cmp ${this.ptr(4, this.mem(a))}, 0`);
      this.push('i32', 'f', { cc: 'e' });
      return;
    }
    if (ICMP[name]) {
      const b = this.pop(), a = this.pop();
      let cc = ICMP[name];
      if (a.k === 'r') { this.e(`cmp ${a.r}, ${this.src32(b)}`); }
      else if (a.k !== 'c' && b.k !== 'f' && (b.k === 'c' || b.k === 'r')) this.e(`cmp ${this.ptr(4, this.mem(a))}, ${this.src32(b)}`);
      else { const r = this.ownG(a); this.e(`cmp ${r}, ${this.src32(b)}`); this.release(r); }
      if (a.k === 'r') this.release(a.r);
      if (b.k === 'r') this.release(b.r);
      this.push('i32', 'f', { cc });
      return;
    }
    if (name === 'wrap_i64') {
      const a = this.pop();
      if (a.k === 'c') { this.push('i32', 'c', { v: Number(a.v & 0xffffffffn) | 0 }); return; }
      const r = this.alloc('g'); this.e(`mov ${r}, ${this.ptr(4, this.addrOf(a))}`); this.pushReg('i32', r);
      return;
    }
    if (name === 'extend8_s' || name === 'extend16_s') {
      const a = this.pop(); const r = this.ownG(a, name === 'extend8_s');
      this.e(`movsx ${r}, ${name === 'extend8_s' ? BYTE[r] : WORD[r]}`); this.pushReg('i32', r);
      return;
    }
    if (name === 'reinterpret_f32') { const a = this.pop(); this.retype(a, 'i32'); return; }
    if (name === 'trunc_sat_f32_s') return this.truncS();
    if (name === 'trunc_sat_f32_u') return this.truncU();
    throw new Error(`unsupported ${op}`);
  }

  retype(a, t) {
    if (a.k === 'c' || a.k === 'l') { this.stack.push({ ...a, t, d: undefined }); return; }
    const s = this.addrOf(a);
    if (s !== this.slot(this.stack.length)) this.copyMem(s, this.slot(this.stack.length), 4);
    this.push(t, 's');
  }

  // cvttss2si gives 0x80000000 on NaN and overflow; wasm saturates.
  truncS() {
    const a = this.pop();
    const x = this.ownX(a);
    const r = this.alloc('g');
    this.e(`cvttss2si ${r}, ${x}`);
    this.e(`cmp ${r}, 0x80000000`);
    const cold = this.label('sat'), done = this.label('done');
    this.e(`je ${cold}`);
    this.code.push(`${done}:`);
    this.coldSat(cold, done, x, r);
    this.release(x);
    this.pushReg('i32', r);
  }
  coldSat(cold, done, x, r) {
    const nan = this.label('nan');
    this.cold.push(`${cold}:`,
      `  ucomiss ${x}, ${x}`, `  jp ${nan}`,
      `  ucomiss ${x}, ${this.m.f32lit(0)}`, `  jbe ${done}`,
      `  mov ${r}, 0x7fffffff`, `  jmp ${done}`,
      `${nan}:`, `  mov ${r}, 0`, `  jmp ${done}`);
  }
  // floor then saturating truncation, in SSE1: truncate, and step down one
  // when that went up (negative non-integers). No sign-of-zero question: the
  // result is an integer.
  floorToInt() {
    const a = this.pop();
    const x = this.ownX(a);
    const r = this.alloc('g');
    const t = this.alloc('x');
    const cold = this.label('sat'), done = this.label('done');
    this.e(`cvttss2si ${r}, ${x}`);
    this.e(`cmp ${r}, 0x80000000`);
    this.e(`je ${cold}`);
    this.e(`cvtsi2ss ${t}, ${r}`);
    this.e(`ucomiss ${x}, ${t}`);
    this.e(`sbb ${r}, 0`);
    this.code.push(`${done}:`);
    this.coldSat(cold, done, x, r);
    this.release(x); this.release(t);
    this.pushReg('i32', r);
  }
  truncU() {
    const a = this.pop();
    const x = this.ownX(a);
    const r = this.alloc('g');
    const t = this.alloc('x');
    const zero = this.label('zero'), big = this.label('big'), done = this.label('done'), sat = this.label('sat');
    this.e(`ucomiss ${x}, ${this.m.f32lit(0xbf800000)}`); // -1.0: NaN or <= -1 gives 0
    this.e(`jbe ${zero}`);
    this.e(`ucomiss ${x}, ${this.m.f32lit(0x4f000000)}`); // 2^31
    this.e(`jae ${big}`);
    this.e(`cvttss2si ${r}, ${x}`);
    this.code.push(`${done}:`);
    this.cold.push(`${zero}:`, `  mov ${r}, 0`, `  jmp ${done}`,
      `${big}:`, `  ucomiss ${x}, ${this.m.f32lit(0x4f800000)}`, `  jae ${sat}`,
      `  movaps ${t}, ${x}`, `  subss ${t}, ${this.m.f32lit(0x4f000000)}`, `  cvttss2si ${r}, ${t}`,
      `  xor ${r}, 0x80000000`, `  jmp ${done}`,
      `${sat}:`, `  mov ${r}, 0xffffffff`, `  jmp ${done}`);
    this.release(x); this.release(t);
    this.pushReg('i32', r);
  }

  f32(name, op) {
    const bin = { add: 'addss', sub: 'subss', mul: 'mulss', div: 'divss' }[name];
    if (bin) {
      let b = this.pop(), a = this.pop();
      if ((name === 'add' || name === 'mul') && !(a.k === 'r') && b.k === 'r') [a, b] = [b, a];
      const x = this.ownX(a);
      const s = this.srcX(b);
      this.e(`${bin} ${x}, ${s}`);
      if (XMMS.includes(s)) this.release(s);
      this.pushReg('f32', x);
      return;
    }
    if (name === 'min' || name === 'max') return this.minmax(name);
    if (name === 'sqrt') {
      const a = this.pop();
      if (a.k === 'r') { this.e(`sqrtss ${a.r}, ${a.r}`); this.pushReg('f32', a.r); return; }
      const x = this.alloc('x'); this.e(`sqrtss ${x}, ${this.srcX(a)}`); this.pushReg('f32', x);
      return;
    }
    if (name === 'abs' || name === 'neg') {
      const a = this.pop();
      if (a.k === 'c') { this.push('f32', 'c', { v: name === 'abs' ? a.v & 0x7fffffff : (a.v ^ 0x80000000) >>> 0 }); return; }
      const x = this.ownX(a);
      this.e(`${name === 'abs' ? 'andps' : 'xorps'} ${x}, ${this.m.splatLit(name === 'abs' ? 0x7fffffff : 0x80000000)}`);
      this.pushReg('f32', x);
      return;
    }
    if (name === 'floor' || name === 'ceil' || name === 'trunc' || name === 'nearest') {
      // x87 frndint under a rounding control set for just this op
      const rc = { floor: 0x077f, ceil: 0x0b7f, trunc: 0x0f7f, nearest: 0x037f }[name];
      const a = this.pop();
      const s = this.slot(a.d);
      const from = a.k === 'c' ? this.m.f32lit(a.v) : this.ptr(4, this.addrOf(a));
      if (rc !== 0x077f) { this.e('sub esp, 4'); this.e('fnstcw word ptr [esp]'); this.e(`mov word ptr [esp + 2], ${hex(rc)}`); this.e('fldcw word ptr [esp + 2]'); }
      this.e(`fld ${from}`); this.e('frndint'); this.e(`fstp ${this.ptr(4, s)}`);
      if (rc !== 0x077f) { this.e('fldcw word ptr [esp]'); this.e('add esp, 4'); }
      this.push('f32', 's');
      return;
    }
    if (name === 'convert_i32_s' || (name === 'convert_i32_u' && this.stack.at(-1).nn)) {
      const a = this.pop();
      const x = this.alloc('x');
      if (a.k === 'c') { const r = this.alloc('g'); this.e(`mov ${r}, ${hex(a.v)}`); this.e(`cvtsi2ss ${x}, ${r}`); this.release(r); }
      else { this.e(`cvtsi2ss ${x}, ${this.src32(a)}`); if (a.k === 'r') this.release(a.r); }
      this.pushReg('f32', x);
      return;
    }
    if (name === 'convert_i32_u') {
      const a = this.pop();
      const r = this.ownG(a);
      const t = this.alloc('g');
      const x = this.alloc('x');
      const big = this.label('big'), done = this.label('done');
      this.e(`test ${r}, ${r}`); this.e(`js ${big}`);
      this.e(`cvtsi2ss ${x}, ${r}`);
      this.code.push(`${done}:`);
      // halve with the low bit kept sticky, convert, double: one rounding
      this.cold.push(`${big}:`, `  mov ${t}, ${r}`, `  shr ${t}, 1`, `  and ${r}, 1`, `  or ${t}, ${r}`,
        `  cvtsi2ss ${x}, ${t}`, `  addss ${x}, ${x}`, `  jmp ${done}`);
      this.release(r); this.release(t);
      this.pushReg('f32', x);
      return;
    }
    if (name === 'reinterpret_i32') { const a = this.pop(); this.retype(a, 'f32'); return; }
    const cmp = { gt: ['a', false], ge: ['ae', false], lt: ['a', true], le: ['ae', true] }[name];
    if (cmp) {
      let b = this.pop(), a = this.pop();
      if (cmp[1]) [a, b] = [b, a];
      const x = a.k === 'r' ? a.r : this.ownX(a);
      const s = this.srcX(b);
      this.e(`ucomiss ${x}, ${s}`);
      this.release(x);
      if (XMMS.includes(s)) this.release(s);
      this.push('i32', 'f', { cc: cmp[0] });
      return;
    }
    if (name === 'eq' || name === 'ne') {
      const b = this.pop(), a = this.pop();
      const x = this.ownX(a);
      const s = this.srcX(b);
      const r = this.alloc('g', true), t = this.alloc('g', true);
      this.e(`ucomiss ${x}, ${s}`);
      if (name === 'eq') { this.e(`sete ${BYTE[r]}`); this.e(`setnp ${BYTE[t]}`); this.e(`and ${BYTE[r]}, ${BYTE[t]}`); }
      else { this.e(`setne ${BYTE[r]}`); this.e(`setp ${BYTE[t]}`); this.e(`or ${BYTE[r]}, ${BYTE[t]}`); }
      this.e(`movzx ${r}, ${BYTE[r]}`);
      this.release(x); this.release(t);
      if (XMMS.includes(s)) this.release(s);
      this.pushReg('i32', r, true);
      return;
    }
    if (name === 'copysign') {
      const b = this.pop(), a = this.pop();
      const x = this.ownX(a), y = this.ownX(b);
      this.e(`andps ${x}, ${this.m.splatLit(0x7fffffff)}`);
      this.e(`andps ${y}, ${this.m.splatLit(0x80000000)}`);
      this.e(`orps ${x}, ${y}`);
      this.release(y);
      this.pushReg('f32', x);
      return;
    }
    throw new Error(`unsupported ${op}`);
  }

  // wasm min/max: NaN in gives NaN out, and -0 < +0. minss/maxss return the
  // second operand on NaN or a tie, so take both orders and combine.
  minmax(name) {
    const b = this.pop(), a = this.pop();
    const ins = name === 'min' ? 'minss' : 'maxss';
    // against a constant that is neither zero nor NaN there is no tie of
    // different bits, and putting the variable second passes its NaN through
    const k = a.k === 'c' ? a : b.k === 'c' ? b : null;
    if (k && (k.v & 0x7fffffff) !== 0 && (k.v & 0x7f800000) !== 0x7f800000) {
      const v = k === a ? b : a;
      const x = this.alloc('x');
      this.e(`movss ${x}, ${this.m.f32lit(k.v)}`);
      const s = this.srcX(v);
      this.e(`${ins} ${x}, ${s}`);
      if (XMMS.includes(s)) this.release(s);
      this.pushReg('f32', x);
      return;
    }
    const xa = this.ownX(a), xb = this.ownX(b);
    const t = this.alloc('x');
    this.e(`movaps ${t}, ${xb}`);
    this.e(`${ins} ${t}, ${xa}`);   // b<a?b:a (min) / b>a?b:a (max); a on NaN
    if (name === 'min') {
      this.e(`minss ${xa}, ${xb}`); // a<b?a:b; b on NaN
      this.e(`orps ${xa}, ${t}`);   // -0|+0 = -0; NaN|x = NaN
    } else {
      const u = this.alloc('x');
      this.e(`movaps ${u}, ${xa}`);
      this.e(`cmpunordss ${u}, ${xb}`);
      this.e(`maxss ${xa}, ${xb}`);
      this.e(`andps ${xa}, ${t}`);  // +0&-0 = +0
      this.e(`orps ${xa}, ${u}`);   // NaN in: all ones, a NaN
      this.release(u);
    }
    this.release(xb); this.release(t);
    this.pushReg('f32', xa);
  }

  // i64 in memory pairs, computed in eax:edx (plus ecx, ebx).
  i64(name, op) {
    this.evictAll('g');
    const out = (lo, hi) => { const s = this.slot(this.stack.length); this.e(`mov ${this.ptr(4, s)}, ${lo}`); this.e(`mov ${this.ptr(4, `${s} + 4`)}, ${hi}`); this.push('i64', 's'); };
    const lo = (a) => this.ptr(4, a), hi = (a) => this.ptr(4, `${a} + 4`);
    if (name === 'extend_i32_u' || name === 'extend_i32_s') {
      const a = this.pop();
      this.e(`mov eax, ${this.src32(a)}`);
      if (name === 'extend_i32_s') { this.e('cdq'); out('eax', 'edx'); } else out('eax', '0');
      return;
    }
    if (name === 'eqz') {
      const a = this.pop(); const fa = this.addrOf(a);
      this.e(`mov eax, ${lo(fa)}`); this.e(`or eax, ${hi(fa)}`);
      this.push('i32', 'f', { cc: 'e' });
      return;
    }
    const b = this.pop(), a = this.pop();
    const fa = this.addrOf(a);
    if (['eq', 'ne'].includes(name)) {
      const fb = this.addrOf(b);
      this.e(`mov eax, ${lo(fa)}`); this.e(`mov edx, ${hi(fa)}`); this.e(`xor eax, ${lo(fb)}`); this.e(`xor edx, ${hi(fb)}`); this.e('or eax, edx');
      this.push('i32', 'f', { cc: name === 'eq' ? 'e' : 'ne' });
      return;
    }
    const rel = { lt_u: ['b', false], ge_u: ['ae', false], gt_u: ['b', true], le_u: ['ae', true], lt_s: ['l', false], ge_s: ['ge', false], gt_s: ['l', true], le_s: ['ge', true] }[name];
    if (rel) {
      const fb = this.addrOf(b);
      const [x, y] = rel[1] ? [fb, fa] : [fa, fb];
      this.e(`mov eax, ${lo(x)}`); this.e(`mov edx, ${hi(x)}`); this.e(`cmp eax, ${lo(y)}`); this.e(`sbb edx, ${hi(y)}`);
      this.push('i32', 'f', { cc: rel[0] });
      return;
    }
    if (['add', 'sub', 'and', 'or', 'xor'].includes(name)) {
      const fb = this.addrOf(b);
      const [l, h] = { add: ['add', 'adc'], sub: ['sub', 'sbb'], and: ['and', 'and'], or: ['or', 'or'], xor: ['xor', 'xor'] }[name];
      this.e(`mov eax, ${lo(fa)}`); this.e(`mov edx, ${hi(fa)}`); this.e(`${l} eax, ${lo(fb)}`); this.e(`${h} edx, ${hi(fb)}`);
      out('eax', 'edx');
      return;
    }
    if (name === 'mul') {
      const fb = this.addrOf(b);
      this.e(`mov eax, ${lo(fa)}`); this.e(`mul ${lo(fb)}`);
      this.e(`mov ecx, ${lo(fa)}`); this.e(`imul ecx, ${hi(fb)}`); this.e('add edx, ecx');
      this.e(`mov ecx, ${hi(fa)}`); this.e(`imul ecx, ${lo(fb)}`); this.e('add edx, ecx');
      out('eax', 'edx');
      return;
    }
    if (['shl', 'shr_u', 'shr_s', 'rotl', 'rotr'].includes(name)) {
      this.e(`mov eax, ${lo(fa)}`); this.e(`mov edx, ${hi(fa)}`);
      if (b.k === 'c') {
        let n = Number(b.v & 63n);
        let kind = name;
        if (kind === 'rotr') { kind = 'rotl'; n = (64 - n) & 63; }
        if (kind === 'rotl') {
          if (n >= 32) { this.e('xchg eax, edx'); n -= 32; }
          if (n) { this.e('mov ebx, edx'); this.e(`shld edx, eax, ${n}`); this.e(`shld eax, ebx, ${n}`); }
        } else if (kind === 'shl') {
          if (n >= 32) { this.e('mov edx, eax'); this.e('xor eax, eax'); if (n > 32) this.e(`shl edx, ${n - 32}`); }
          else if (n) { this.e(`shld edx, eax, ${n}`); this.e(`shl eax, ${n}`); }
        } else {
          const ar = kind === 'shr_s' ? 'sar' : 'shr';
          if (n >= 32) { this.e('mov eax, edx'); if (kind === 'shr_s') this.e('sar edx, 31'); else this.e('xor edx, edx'); if (n > 32) this.e(`${ar} eax, ${n - 32}`); }
          else if (n) { this.e(`shrd eax, edx, ${n}`); this.e(`${ar} edx, ${n}`); }
        }
      } else {
        this.e(`mov ecx, ${lo(this.addrOf(b))}`);
        let kind = name;
        if (kind === 'rotr') { this.e('neg ecx'); kind = 'rotl'; }
        this.e('and ecx, 63');
        const s = this.label('sh');
        this.e('test cl, 32'); this.e(`jz ${s}`);
        if (kind === 'rotl') this.e('xchg eax, edx');
        else if (kind === 'shl') { this.e('mov edx, eax'); this.e('xor eax, eax'); }
        else { this.e('mov eax, edx'); if (kind === 'shr_s') this.e('sar edx, 31'); else this.e('xor edx, edx'); }
        this.code.push(`${s}:`);
        this.e('and ecx, 31');
        if (kind === 'rotl') { this.e('mov ebx, edx'); this.e('shld edx, eax, cl'); this.e('shld eax, ebx, cl'); }
        else if (kind === 'shl') { this.e('shld edx, eax, cl'); this.e('shl eax, cl'); }
        else { this.e('shrd eax, edx, cl'); this.e(`${kind === 'shr_s' ? 'sar' : 'shr'} edx, cl`); }
      }
      out('eax', 'edx');
      return;
    }
    throw new Error(`unsupported ${op}`);
  }

  v128(op) {
    const ps = { 'f32x4.add': 'addps', 'f32x4.sub': 'subps', 'f32x4.mul': 'mulps', 'f32x4.div': 'divps', 'v128.and': 'andps', 'v128.or': 'orps', 'v128.xor': 'xorps' }[op];
    if (ps) {
      const b = this.pop(), a = this.pop();
      const x = this.ownX(a);
      const s = this.srcX(b);
      this.e(`${ps} ${x}, ${s}`);
      if (XMMS.includes(s)) this.release(s);
      this.pushReg('v128', x);
      return;
    }
    if (op === 'v128.andnot') {
      const b = this.pop(), a = this.pop();
      const y = this.ownX(b), s = this.srcX(a);
      this.e(`andnps ${y}, ${s}`); // ~b & a
      if (XMMS.includes(s)) this.release(s);
      this.pushReg('v128', y);
      return;
    }
    if (op === 'v128.not') {
      const a = this.pop(); const x = this.ownX(a);
      this.e(`xorps ${x}, ${this.m.splatLit(0xffffffff)}`);
      this.pushReg('v128', x);
      return;
    }
    if (op === 'v128.bitselect') {
      const c = this.pop(), b = this.pop(), a = this.pop();
      const xc = this.ownX(c), xa = this.ownX(a), sb = this.srcX(b);
      this.e(`andps ${xa}, ${xc}`);  // a & c
      this.e(`andnps ${xc}, ${sb}`); // ~c & b
      this.e(`orps ${xa}, ${xc}`);
      this.release(xc);
      if (XMMS.includes(sb)) this.release(sb);
      this.pushReg('v128', xa);
      return;
    }
    if (op === 'f32x4.splat') {
      const a = this.pop(); const x = this.ownX(a);
      this.e(`shufps ${x}, ${x}, 0`);
      this.pushReg('v128', x);
      return;
    }
    if (op === 'i32x4.splat') {
      const a = this.pop();
      if (a.k === 'c') { this.push('v128', 'c', { v: new Uint8Array(new Uint32Array([a.v, a.v, a.v, a.v]).buffer) }); return; }
      const x = this.alloc('x');
      if (a.k === 'r') { const s = this.slot(a.d); this.e(`mov ${this.ptr(4, s)}, ${a.r}`); this.release(a.r); this.e(`movss ${x}, ${this.ptr(4, s)}`); }
      else this.e(`movss ${x}, ${this.ptr(4, this.mem(a))}`);
      this.e(`shufps ${x}, ${x}, 0`);
      this.pushReg('v128', x);
      return;
    }
    // integer lanes: no SSE2, so scalar through memory into the first operand's slot
    if (op === 'i32x4.ne' || op === 'i32x4.eq') {
      this.evictAll('g');
      const b = this.pop(), a = this.pop();
      const fa = this.addrOf(a), fb = this.addrOf(b), s = this.slot(a.d);
      for (let k = 0; k < 4; k++) {
        this.e(`mov eax, ${this.ptr(4, `${fa} + ${4 * k}`)}`);
        this.e(`cmp eax, ${this.ptr(4, `${fb} + ${4 * k}`)}`);
        this.e(`set${op === 'i32x4.ne' ? 'ne' : 'e'} al`); this.e('movzx eax, al'); this.e('neg eax');
        this.e(`mov ${this.ptr(4, `${s} + ${4 * k}`)}, eax`);
      }
      this.push('v128', 's');
      return;
    }
    if (op === 'i16x8.extend_low_i8x16_u' || op === 'i32x4.extend_low_i16x8_u') {
      this.evictAll('g');
      const a = this.pop();
      const fa = this.addrOf(a), s = this.slot(a.d);
      const [n, from, to] = op.startsWith('i16') ? [8, 1, 2] : [4, 2, 4];
      // high lanes first: the result may overwrite its own source
      for (let k = n - 1; k >= 0; k--) {
        this.e(`movzx eax, ${this.ptr(from, `${fa} + ${from * k}`)}`);
        this.e(`mov ${this.ptr(to, `${s} + ${to * k}`)}, ${to === 2 ? 'ax' : 'eax'}`);
      }
      this.push('v128', 's');
      return;
    }
    throw new Error(`unsupported ${op}`);
  }
}

export function translate(bin, opts = {}) {
  const mod = decode(bin);
  const m = new Module(mod, opts);
  const asm = m.translate();
  return { asm, header: m.header(), counts: m.counts, mod };
}

// Function names in definition order, from the expanded WAT the module was
// assembled from (the release binary carries no name section).
export function watNames(wat) {
  return [...wat.matchAll(/\(func\s+\$([A-Za-z0-9_.]+)|\(func\s*\(export\s+"([^"]+)"/g)].map((m) => m[1] || m[2]);
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  const input = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--')) || 'build/game.wasm';
  const { asm, header } = translate(readFileSync(input), { target: opt('target', 'elf'), bounds: !argv.includes('--no-bounds') });
  const out = opt('out', null);
  if (out) writeFileSync(out, asm); else process.stdout.write(asm);
  const h = opt('header', null);
  if (h) writeFileSync(h, header);
}

if (isMain(import.meta.url)) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
