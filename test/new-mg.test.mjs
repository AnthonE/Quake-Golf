// tools/new-mg.mjs: a new minigame's four files and its line in each list that
// names every minigame. This checks the plan against the files as they are, so
// a change to one of those lists that would strand the tool fails here, not in
// a contributor's hands; that a scaffolded minigame builds and passes the
// party tests was checked by running it on a copy of the repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/layout.mjs';
import { plan } from '../tools/new-mg.mjs';

test('the plan for a new minigame finds every list, appends to each, and writes the nine hooks', () => {
  const { id, edits, files } = plan('zzsumo', 'zq', 'ZZ SUMO', { layout: L });
  assert.equal(id, L.NMG);
  assert.deepEqual(edits.map((e) => e.file).sort(), ['client/mg/index.mjs', 'src/layout.mjs', 'src/party.wat', 'test/party.test.mjs']);
  const lay = edits.find((e) => e.file === 'src/layout.mjs').after;
  assert.ok(lay.includes("  { key: 'zzsumo', prefix: 'zq', name: 'ZZ SUMO' },\n]; // index = MG_*"));
  assert.ok(lay.includes(`export const MG_ZZSUMO = ${L.NMG};\nexport const NMG = ${L.NMG + 1};`));
  assert.ok(lay.includes("import * as mg_zzsumo from './mg/zzsumo.mjs';"));
  assert.match(lay, /, mg_zzsumo\)\);/);
  assert.ok(edits.find((e) => e.file === 'src/party.wat').after.includes('#include "mg/zzsumo.wat"'));
  assert.match(edits.find((e) => e.file === 'client/mg/index.mjs').after, /export const MG = \[[^\]]*, zzsumo\];/);
  const t = edits.find((e) => e.file === 'test/party.test.mjs').after;
  assert.ok(t.includes(', L.MG_ZZSUMO];') && t.includes(", 'zq']);"));
  assert.deepEqual(Object.keys(files).sort(), ['client/mg/zzsumo.mjs', 'src/mg/zzsumo.mjs', 'src/mg/zzsumo.wat', 'test/mg-zzsumo.test.mjs']);
  for (const hook of ['setup', 'spawn', 'start', 'begin', 'ground', 'push', 'tick', 'over', 'out']) assert.match(files['src/mg/zzsumo.wat'], new RegExp(`\\(func \\$zq_${hook}\\b`), hook);
  assert.match(files['src/mg/zzsumo.mjs'], new RegExp(`${L.FX_MG + 4 * L.NMG} to ${L.FX_MG + 4 * L.NMG + 3}`));
  assert.doesNotMatch(files['src/mg/zzsumo.mjs'], /^import/m, 'a constants file imports nothing');
});

test('it refuses a key, a prefix or a name already taken, and names that break the rules', () => {
  const refuse = (args, want) => assert.throws(() => plan(...args, { layout: L }), (e) => e.message.includes(want), `${args}: ${want}`);
  refuse(['thinice', 'zq', 'NEW'], 'already called thinice');
  refuse(['newone', 'ti', 'NEW'], 'has the prefix ti');
  refuse(['newone', 'zq', 'THIN ICE'], 'already called THIN ICE');
  refuse(['New', 'zq', 'NEW'], 'key:');
  refuse(['newone', 'z', 'NEW'], 'prefix:');
  refuse(['newone', 'zq', 'New one'], 'NAME:');
  refuse(['newone', 'fp', 'NEW'], 'names starting FP_ are taken');
});
