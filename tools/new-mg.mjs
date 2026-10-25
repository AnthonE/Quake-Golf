#!/usr/bin/env node
// A new Party minigame, ready to fill in: a round platform over the sea, bumps
// on, the last ball on it wins (sumo, the smallest game the framework plays),
// in the four files every minigame has, and wired into the five lists that name
// them all. It builds and passes as written; from there the minigame is yours.
//   node tools/new-mg.mjs <key> <prefix> "<NAME>" [--dry-run]
//     key     its file name and id: lowercase letters, e.g. sumo
//     prefix  two lowercase letters no other minigame uses: its hooks are $<prefix>_<hook>,
//             its constants <PREFIX>_*
//     NAME    what the title card says: capitals, digits, spaces (the 3x5 font), 20 at most
// Writes src/mg/<key>.wat and .mjs, client/mg/<key>.mjs, test/mg-<key>.test.mjs;
// edits src/layout.mjs, src/party.wat, client/mg/index.mjs, test/party.test.mjs.
// Appending keeps every other minigame's id, so their logs and seeds still mean
// what they meant; the party and Fireplace builds change, as they must.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './main.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The edits to the files that list every minigame, each found by its anchor;
// one that moved stops the tool before it writes anything.
export function plan(key, prefix, name, { root = ROOT, layout } = {}) {
  const P = prefix.toUpperCase();
  const K = key.toUpperCase();
  const read = (f) => readFileSync(join(root, f), 'utf8');
  if (!/^[a-z]{2,12}$/.test(key)) throw new Error('key: 2 to 12 lowercase letters (it names the files and MG_<KEY>)');
  if (!/^[a-z]{2}$/.test(prefix)) throw new Error('prefix: two lowercase letters');
  if (!/^[A-Z0-9][A-Z0-9 ]{0,19}$/.test(name)) throw new Error('NAME: capitals, digits and spaces, 20 at most (the title card\'s font)');
  const L = layout;
  if (L.MINIGAMES.some((m) => m.key === key)) throw new Error(`a minigame is already called ${key}`);
  if (L.MINIGAMES.some((m) => m.prefix === prefix)) throw new Error(`${L.MINIGAMES.find((m) => m.prefix === prefix).key} has the prefix ${prefix}`);
  if (L.MINIGAMES.some((m) => m.name === name)) throw new Error(`a minigame is already called ${name}`);
  if (Object.keys(L).some((k) => k.startsWith(`${P}_`)) || Object.keys(L.MG_CONSTS).some((k) => k.startsWith(`${P}_`))) throw new Error(`names starting ${P}_ are taken: pick another prefix`);
  if (`MG_${K}` in L) throw new Error(`MG_${K} is taken`);
  for (const f of [`src/mg/${key}.wat`, `src/mg/${key}.mjs`, `client/mg/${key}.mjs`, `test/mg-${key}.test.mjs`]) if (existsSync(join(root, f))) throw new Error(`${f} is there already`);
  const id = L.NMG;
  const edits = [];
  const edit = (file, find, replace) => {
    const text = edits.find((e) => e.file === file)?.after ?? read(file);
    const n = text.split(find).length - 1;
    if (n !== 1) throw new Error(`${file}: expected "${find.trim().slice(0, 60)}" once, found it ${n} times; add the minigame by hand (CONTRIBUTING.md)`);
    const after = text.replace(find, replace);
    const e = edits.find((x) => x.file === file);
    if (e) e.after = after; else edits.push({ file, after });
  };
  const lastLine = (file, re) => {
    const text = edits.find((e) => e.file === file)?.after ?? read(file);
    const all = text.match(re);
    if (!all) throw new Error(`${file}: no line like ${re}; add the minigame by hand (CONTRIBUTING.md)`);
    return all.at(-1);
  };
  // src/layout.mjs: the list, the id, the count, the constants
  edit('src/layout.mjs', `]; // index = MG_*`, `  { key: '${key}', prefix: '${prefix}', name: '${name}' },\n]; // index = MG_*`);
  edit('src/layout.mjs', `export const NMG = ${id};`, `export const MG_${K} = ${id};\nexport const NMG = ${id + 1};`);
  const imp = lastLine('src/layout.mjs', /^import \* as mg_\w+ from '\.\/mg\/\w+\.mjs';$/gm);
  edit('src/layout.mjs', `${imp}\n`, `${imp}\nimport * as mg_${key} from './mg/${key}.mjs';\n`);
  const consts = lastLine('src/layout.mjs', /^export const MG_CONSTS = Object\.freeze\(Object\.assign\(\{\}, [^\n]*\)\);$/gm);
  edit('src/layout.mjs', consts, consts.replace(/\)\);$/, `, mg_${key}));`));
  // src/party.wat: its hooks
  const inc = lastLine('src/party.wat', /^#include "mg\/\w+\.wat"$/gm);
  edit('src/party.wat', `${inc}\n`, `${inc}\n#include "mg/${key}.wat"\n`);
  // client/mg/index.mjs: its module
  const cimp = lastLine('client/mg/index.mjs', /^import \w+ from '\.\/\w+\.mjs';$/gm);
  edit('client/mg/index.mjs', `${cimp}\n`, `${cimp}\nimport ${key} from './${key}.mjs';\n`);
  const arr = lastLine('client/mg/index.mjs', /^export const MG = \[[^\n]*\];$/gm);
  edit('client/mg/index.mjs', arr, arr.replace(/\];$/, `, ${key}];`));
  // test/party.test.mjs: the registry's own check, which names every minigame
  const ids = lastLine('test/party.test.mjs', /^ {2}const ids = \[L\.MG_[^\n]*\];$/gm);
  edit('test/party.test.mjs', ids, ids.replace(/\];$/, `, L.MG_${K}];`));
  const pre = lastLine('test/party.test.mjs', /^ {2}assert\.deepEqual\(L\.MINIGAMES\.map\(\(m\) => m\.prefix\), \[[^\n]*\]\);$/gm);
  edit('test/party.test.mjs', pre, pre.replace(/\]\);$/, `, '${prefix}']);`));
  const files = {
    [`src/mg/${key}.mjs`]: constantsFile(key, P, name, id, L.FX_MG),
    [`src/mg/${key}.wat`]: watFile(prefix, P, name),
    [`client/mg/${key}.mjs`]: clientFile(key, P, name),
    [`test/mg-${key}.test.mjs`]: testFile(key, P, name),
  };
  return { id, edits, files };
}

const constantsFile = (key, P, name, id, FX_MG) => `// ${name} (MG_${key.toUpperCase()}, prefix ${P.toLowerCase()}): a round platform over the sea,
// sized for the crowd; bump the others off, and the last ball on it wins.
// (node tools/new-mg.mjs wrote this as a start: say here what your minigame is.)
// Literal numbers only: the sim reads them through layout.mjs's MG_CONSTS,
// the client imports this file itself.
export const ${P}_R0 = 12; // the platform: ${P}_R0 m plus ${P}_RK times the root of the balls in, at most ${P}_RMAX
export const ${P}_RK = 4.5;
export const ${P}_RMAX = 64;
export const ${P}_LEN = 11250; // 90 s
// Its header, byte offsets in PG_H (112 B, in the prediction's copy).
export const ${P}_RAD = 0; // f32 the platform's radius
// Its FX kinds are FX_MG + 4 * MG_${key.toUpperCase()} + k, k 0 to 3: ${FX_MG + 4 * id} to ${FX_MG + 4 * id + 3}.
`;

const watFile = (p, P, name) => `;; ${name}: a round platform over the sea, sized for the crowd. Bump the
;; others off; the last ball on it wins. (node tools/new-mg.mjs wrote this: every
;; hook is here, most of them empty, for you to fill.)
;;
;; src/party.wat calls these through (!mg) on PG_GAME:
;;   setup n          the round's knobs (PG_KIND, PG_LEN, PG_SIZE, ...) and the stage, for n balls
;;   spawn i n        where ball i of n starts: x y z
;;   start            play starts (the confirmed world)
;;   begin p d        ball p's own start on bank d: writes only its record
;;   ground d x y z   the floor's top under (x, z) no higher than y on bank d, or -1000 for none
;;   push p d         ball p after its roll on bank d: its record and bank d's FX ring only
;;   tick             once a tick in play: serial, in slot order, the confirmed world
;;   over             1 ends the round now
;;   out p            ball p is out
;; State lives only in PG_H (${P}_RAD...), PG_S, PG_BIG, and PG_M and PG_SCORE in
;; each ball's record. Floats: (!madd a b c) for a * b + c, angles through $sincos.

;; The platform for the crowd.
(func $${p}_setup (param $n i32)
  (local $rad f32)
  (local.set $rad (f32.min (!madd (f32.sqrt (f32.convert_i32_u (local.get $n))) (f32.const @${P}_RK) (f32.const @${P}_R0)) (f32.const @${P}_RMAX)))
  (i32.store (i32.const @PG_KIND) (i32.const @PK_OUT))
  (i32.store (i32.const @PG_LEN) (i32.const @${P}_LEN))
  (f32.store (i32.const @PG_SIZE) (local.get $rad))
  (f32.store (i32.const @(PG_H + ${P}_RAD)) (local.get $rad)))

;; A sunflower spiral over most of the platform.
(func $${p}_spawn (param $i i32) (param $n i32) (result f32 f32 f32)
  (local $x f32) (local $z f32)
  (call $p_disc (local.get $i) (local.get $n) (f32.mul (f32.load (i32.const @(PG_H + ${P}_RAD))) (f32.const 0.8)))
  (local.set $z) (local.set $x)
  (local.get $x) (f32.const @PLAT_Y) (local.get $z))

(func $${p}_start)
(func $${p}_begin (param $p i32) (param $d i32))

;; The platform's top under (x, z) if (x, z) is on it, on bank d.
(func $${p}_ground (param $d i32) (param $x f32) (param $y f32) (param $z f32) (result f32)
  (local $r f32) (local $dx f32) (local $dz f32)
  (if (f32.lt (local.get $y) (f32.const @PLAT_Y)) (then (return (f32.const -1000))))
  (local.set $r (f32.load offset=@(PG_H + ${P}_RAD) (local.get $d)))
  (local.set $dx (f32.sub (local.get $x) (f32.load offset=@PG_CX (local.get $d))))
  (local.set $dz (f32.sub (local.get $z) (f32.load offset=@PG_CX (local.get $d))))
  (if (result f32) (f32.le (!madd (local.get $dx) (local.get $dx) (f32.mul (local.get $dz) (local.get $dz))) (f32.mul (local.get $r) (local.get $r)))
    (then (f32.const @PLAT_Y))
    (else (f32.const -1000))))

(func $${p}_push (param $p i32) (param $d i32))
(func $${p}_tick)
(func $${p}_over (result i32) (i32.const 0))
(func $${p}_out (param $p i32))
`;

const clientFile = (key, P, name) => `// ${name}, as drawn and as the AI ball sees it: the platform, a disc of rubber.
// (node tools/new-mg.mjs wrote this; the contract every hook here keeps is at
// the top of client/party-game.mjs.)
import * as L from '../../src/layout.mjs';
import * as MC from '../../src/mg/${key}.mjs'; // ${P}_*: the minigame's own constants
import { PLAT_Y } from '../../src/party-view.mjs';
import { LOOK } from '../party-render.mjs';

const HH = 0.5; // the platform's half height, m
const radius = (view) => view.dv.getFloat32(L.PG_H + MC.${P}_RAD, true);

export default {
  id: L.MG_${key.toUpperCase()}, key: '${key}', name: '${name}',
  hint: 'BUMP THE OTHERS OFF  LAST ONE ON WINS',
  env: 'day',

  draw(view, ctx, out) {
    const rad = radius(view);
    if (!(rad > 0)) return;
    const cx = view.party().cx;
    out.scene.cyl(cx, PLAT_Y - HH, cx, rad, HH, 0.86, 0.72, 0.5, LOOK.RUBBER);
  },

  frame(view) {
    const cx = view.party().cx;
    return { centre: [cx, PLAT_Y, cx], radius: radius(view) || view.party().size, shape: 'disc' };
  },

  fx() {},

  hud() {},

  brain: {
    // off the platform is a fall; near its rim, a risk
    danger(view, x, z) {
      const cx = view.dv.getFloat32(L.PG_CX + view.bank, true);
      const r = radius(view), d = Math.hypot(x - cx, z - cx);
      return d > r - 0.5 ? 1 : d > r - 3 ? 0.3 : 0;
    },
    // the middle, where a bump has the furthest to push you
    goal(view) {
      const cx = view.dv.getFloat32(L.PG_CX + view.bank, true);
      return [cx, cx];
    },
    hop() { return false; },
  },
};
`;

const testFile = (key, P, name) => `// ${name} (src/mg/${key}.wat): the platform for the crowd, the floor only on
// it, and a ball off it out. (node tools/new-mg.mjs wrote these; keep them
// true as the minigame grows, and add what it does.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty } from './helpers.mjs';
import { View, PLAT_Y } from '../src/party-view.mjs';
import * as L from '../src/layout.mjs';
import * as MC from '../src/mg/${key}.mjs'; // ${P}_*: the minigame's own constants

// A room of n balls in ${name}, on the debug build (a NaN traps), stepped into play unless asked not to.
async function room(n = 2, { play = true, seed = 7 } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_${key.toUpperCase()} + 1, true);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  while (play && v.hole().state !== L.H_PLAY) step();
  return { sim, v, dv, step };
}

test('the platform for 1, 8, 64 and 256: sized for the crowd, every ball on it', async () => {
  for (const n of [1, 8, 64, 256]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party();
    const rad = Math.min(MC.${P}_R0 + MC.${P}_RK * Math.sqrt(n), MC.${P}_RMAX);
    assert.equal(r.game, L.MG_${key.toUpperCase()});
    assert.ok(Math.abs(r.size - rad) < 1e-4, \`\${r.size} m for \${n}\`);
    assert.deepEqual([r.kind, r.len], [L.PK_OUT, MC.${P}_LEN]);
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p);
      assert.equal(b.pos[1], PLAT_Y, \`\${n}: P\${p + 1} on the platform\`);
      assert.ok(Math.hypot(b.pos[0] - r.cx, b.pos[2] - r.cx) < r.size, \`\${n}: P\${p + 1} inside the rim\`);
    }
  }
});

test('a ball put off the rim falls and is out, and the one left on wins', async () => {
  const g = await room(2);
  const r = g.v.party();
  const b = L.PLAYERS + 1 * L.PSIZE;
  g.dv.setFloat32(b + L.P_PX, r.cx + r.size + 3, true);
  g.dv.setFloat32(b + L.P_PZ, r.cx, true);
  for (let k = 0; k < 2000 && !g.v.partier(1).out; k++) g.step();
  assert.ok(g.v.partier(1).out, 'P2 is out');
  assert.ok(!g.v.partier(0).out, 'P1 is still on');
  for (let k = 0; k < 2000 && g.v.partier(0).place === 0; k++) g.step();
  assert.equal(g.v.partier(0).place, 1, 'P1 wins the round');
});
`;

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
  const dry = process.argv.includes('--dry-run');
  const [key, prefix, name] = args;
  try {
    if (!key || !prefix || !name) throw new Error('node tools/new-mg.mjs <key> <prefix> "<NAME>" [--dry-run]');
    const layout = await import('../src/layout.mjs');
    const { id, edits, files } = plan(key, prefix, name, { layout });
    for (const [f, text] of Object.entries(files)) { if (!dry) writeFileSync(join(ROOT, f), text); console.log(`${dry ? 'would write' : 'wrote'} ${f}`); }
    for (const e of edits) { if (!dry) writeFileSync(join(ROOT, e.file), e.after); console.log(`${dry ? 'would edit' : 'edited'} ${e.file}`); }
    console.log(`\n${name} is minigame ${id} (MG_${key.toUpperCase()}). Next:`);
    console.log(`  npm run build && node --test test/mg-${key}.test.mjs test/party.test.mjs`);
    console.log(`  node net/play.mjs --party --mg ${id} --bots 7     # play it with bots: open the URL it prints`);
    console.log('  then make it yours: src/mg/' + key + '.wat (the rules), client/mg/' + key + '.mjs (the look, the bots). CONTRIBUTING.md has the bar.');
  } catch (e) { console.error(e.message); process.exit(1); }
}
