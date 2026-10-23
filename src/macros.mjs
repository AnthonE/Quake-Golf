// Macros for the hand-written WAT. Each takes raw s-expression strings and
// returns WAT text; the assembler re-scans the output, so macros may nest.
// Layout constants stay as @NAME here and are folded after expansion.
import { ARMS } from './layout.mjs';

const SHIFT = { f32: 2, i32: 2, i64: 3, u16: 1, u8: 0, v128: 2 };
const LOAD = { f32: 'f32.load', i32: 'i32.load', i64: 'i64.load', u16: 'i32.load16_u', u8: 'i32.load8_u', v128: 'v128.load' };
const STORE = { f32: 'f32.store', i32: 'i32.store', i64: 'i64.store', u16: 'i32.store16', u8: 'i32.store8', v128: 'v128.store' };

function scaled(type, idx) {
  const s = SHIFT[type];
  if (s === undefined) throw new Error(`no element type ${type}`);
  return s === 0 ? idx : `(i32.shl ${idx} (i32.const ${s}))`;
}

export function makeMacros({ DEBUG }) {
  let label = 0;
  const fresh = (p) => `$${p}${label++}`;
  return {
    // (!ld f32 @PX (local.get $i)): element i of an array whose base folds into the memarg.
    // v128 indexes by ball, so a block of four f32 lanes starts at ball 4k.
    ld: (type, base, idx) => `(${LOAD[type]} offset=${base} ${scaled(type, idx)})`,
    st: (type, base, idx, val) => `(${STORE[type]} offset=${base} ${scaled(type, idx)} ${val})`,
    // (!at f32 @(PLAYERS + P_VX) (local.get $pb)): a field of a record whose byte address is given.
    at: (type, off, addr) => `(${LOAD[type]} offset=${off} ${addr})`,
    put: (type, off, addr, val) => `(${STORE[type]} offset=${off} ${addr} ${val})`,

    // (!for $i from to body...): counted loop, `to` re-read each pass.
    for: (v, from, to, ...body) => {
      const brk = fresh('brk');
      const top = fresh('top');
      return `(local.set ${v} ${from}) (block ${brk} (loop ${top} (br_if ${brk} (i32.ge_u (local.get ${v}) ${to})) ${body.join(' ')} (local.set ${v} (i32.add (local.get ${v}) (i32.const 1))) (br ${top})))`;
    },
    // (!f32x4 a b c d): a vector of four scalars.
    f32x4: (a, b, c, d) => `(f32x4.replace_lane 3 (f32x4.replace_lane 2 (f32x4.replace_lane 1 (f32x4.splat ${a}) ${b}) ${c}) ${d})`,
    // (!unroll $v (k...) body...): body once per k, with (local.get $v) as the constant k.
    // Sibling copies may share labels: a label is scoped to its own block.
    unroll: (v, ks, ...body) => ks.slice(1, -1).trim().split(/\s+/)
      .map((k) => body.join(' ').replaceAll(`(local.get ${v})`, `(i32.const ${k})`)).join(' '),
    inc: (v) => `(local.set ${v} (i32.add (local.get ${v}) (i32.const 1)))`,

    // Explicit multiply then add: wasm never fuses, and neither do we.
    madd: (a, b, c) => `(f32.add (f32.mul ${a} ${b}) ${c})`,
    dot3: (ax, ay, az, bx, by, bz) => `(f32.add (f32.add (f32.mul ${ax} ${bx}) (f32.mul ${ay} ${by})) (f32.mul ${az} ${bz}))`,
    splat: (k) => `(f32x4.splat (f32.const ${k}))`,
    // Lane-wise clamp of a scalar.
    clamp: (x, lo, hi) => `(f32.min (f32.max ${x} ${lo}) ${hi})`,

    // One value-noise octave for the terrain: period 2^logp, amplitude amp.
    octave: (logp, amp, o) => {
      const p = 1 << Number(logp);
      const v = (lx, lz) => `(call $val ${lx} ${lz} (local.get $s) (i32.const ${amp}))`;
      const lx1 = '(i32.add (local.get $lx) (i32.const 1))';
      const lz1 = '(i32.add (local.get $lz) (i32.const 1))';
      const wx0 = `(i32.sub (i32.const ${p}) (local.get $fx))`;
      const wz0 = `(i32.sub (i32.const ${p}) (local.get $fz))`;
      return `
        (local.set $s (i32.xor (local.get $seed) (i32.mul (i32.const ${o}) (i32.const 0x9e3779b9))))
        (local.set $lx (i32.shr_u (local.get $x) (i32.const ${logp})))
        (local.set $lz (i32.shr_u (local.get $z) (i32.const ${logp})))
        (local.set $fx (i32.and (local.get $x) (i32.const ${p - 1})))
        (local.set $fz (i32.and (local.get $z) (i32.const ${p - 1})))
        (local.set $h (i32.add (local.get $h) (i32.shr_u
          (i32.add
            (i32.add (i32.mul ${v('(local.get $lx)', '(local.get $lz)')} (i32.mul ${wx0} ${wz0}))
                     (i32.mul ${v(lx1, '(local.get $lz)')} (i32.mul (local.get $fx) ${wz0})))
            (i32.add (i32.mul ${v('(local.get $lx)', lz1)} (i32.mul ${wx0} (local.get $fz)))
                     (i32.mul ${v(lx1, lz1)} (i32.mul (local.get $fx) (local.get $fz)))))
          (i32.const ${2 * Number(logp)}))))`;
    },

    // (!arm field w): the arena's weapon table (ARMS in layout.mjs) as a chain of
    // selects on the weapon in w, so the constants inline; f32 for the float
    // fields, i32 for the rest, 0 for weapon 0 and a field a weapon lacks.
    arm: (field, w) => {
      const f32 = field === 'speed';
      const c = (v) => (f32 ? `(f32.const ${v || 0})` : `(i32.const ${v || 0})`);
      let out = c(0);
      for (let k = ARMS.length - 1; k >= 1; k--) {
        if (!(field in ARMS[k]) && !['speed', 'kind', 'burst'].includes(field)) throw new Error(`ARMS[${k}] has no ${field}`);
        out = `(select ${c(ARMS[k][field])} ${out} (i32.eq ${w} (i32.const ${k})))`;
      }
      return out;
    },

    // Debug-only: trap with a code if a value is NaN or infinite.
    chk: (v, code, idx) => (DEBUG ? `(call $assert_finite ${v} (i32.const ${code}) ${idx})` : ''),
  };
}
