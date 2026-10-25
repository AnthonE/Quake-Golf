// Fireplace's room themes (client/themes.mjs, client/themes/*.json): every
// file is a theme the room can draw, Grandma's is the room as it was, and the
// shader and the schema name the same colours. A theme only changes pixels, so
// the sims' bits never see it; these check the data and the wiring, and
// tools/theme-shots.mjs shows what each one looks like.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COLORS, NCOLOR, UNIFORM_BYTES, WINDOWS, MANTELS, DEFAULT, FALLBACK, validate, pack, wgsl } from '../client/themes.mjs';
import { readThemes, newTheme } from '../tools/themes.mjs';

const lines = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

test('every theme file is a theme the room can draw, Grandma\'s first', () => {
  const themes = readThemes();
  assert.equal(themes[0].id, DEFAULT);
  assert.ok(themes.length >= 2, `${themes.length} themes`);
  for (const t of themes) {
    for (const [key, n] of COLORS) assert.equal(n === 1 ? t.colors[key].length : t.colors[key].length, n === 1 ? 3 : n, `${t.id}: ${key}`);
    assert.ok(WINDOWS.includes(t.window) && MANTELS.includes(t.mantel), t.id);
  }
});

test("Grandma's file writes out every default, and they are the room as it was", () => {
  const raw = JSON.parse(readFileSync(`client/themes/${DEFAULT}.json`, 'utf8'));
  assert.deepEqual(Object.keys(raw.colors), COLORS.map((c) => c[0]), 'every colour, in order: the file is the template');
  const g = readThemes()[0];
  assert.deepEqual(g.colors, FALLBACK.colors);
  assert.equal(g.window, 'snow');
  assert.equal(g.mantel, 'pumpkins');
  // newTheme (node tools/themes.mjs new <id>) starts from the same room
  assert.deepEqual(validate(newTheme('x-room', 'someone'), 'x-room').colors, FALLBACK.colors);
});

test('a theme that is wrong says what to fix', () => {
  const ok = { theme: 1, name: 'Test', by: 'someone' };
  assert.equal(lines(() => validate(ok, 'test')), null);
  const cases = [
    [{ ...ok, theme: 2 }, 'test', '"theme": 1'],
    [{ ...ok, name: '' }, 'test', '"name" is required'],
    [{ ...ok, name: 'x'.repeat(25) }, 'test', '24 characters'],
    [{ ...ok, name: 'Café' }, 'test', 'plain ASCII'],
    [{ ...ok, by: '-nope' }, 'test', 'GitHub login'],
    [{ ...ok, by: undefined }, 'test', 'GitHub login'],
    [{ ...ok, about: 'x'.repeat(201) }, 'test', '200 characters'],
    [{ ...ok, window: 'fog' }, 'test', '"window" is one of'],
    [{ ...ok, mantel: 'cat' }, 'test', '"mantel" is one of'],
    [{ ...ok, colour: {} }, 'test', '"colour" is not a theme field'],
    [{ ...ok, colors: { bricks: '#ffffff' } }, 'test', '"colors.bricks" is not a colour'],
    [{ ...ok, colors: { brick: '#fff' } }, 'test', '#rrggbb'],
    [{ ...ok, colors: { brick: [1, 0, 2] } }, 'test', 'from 0 to 1'],
    [{ ...ok, colors: { rug: ['#ffffff', '#000000'] } }, 'test', 'a list of 3 colours'],
    [{ ...ok, colors: { rug: [0.1, 0.2, 0.3] } }, 'test', 'a list of 3 colours'],
    [{ ...ok, colors: { wallpaper: '#ffffff' } }, 'test', 'a list of 2 colours'],
    [ok, 'Bad_Id', "the file's name is the theme's id"],
    [[], 'test', 'a JSON object'],
  ];
  for (const [t, id, want] of cases) {
    const got = lines(() => validate(t, id));
    assert.ok(got && got.includes(want), `${JSON.stringify(t)}: ${got}`);
    assert.ok(got.startsWith(`client/themes/${id}.json`), got);
  }
  // colours as [r, g, b] work too, and fill only what they name
  const t = validate({ ...ok, colors: { brick: [1, 0.5, 0], wallpaper: ['#000000', [1, 1, 1]] } }, 'test');
  assert.deepEqual(t.colors.brick, [1, 0.5, 0]);
  assert.deepEqual(t.colors.wallpaper, [[0, 0, 0], [1, 1, 1]]);
  assert.deepEqual(t.colors.mortar, FALLBACK.colors.mortar);
});

test("the uniform: linear colours, the default fire's tint exactly 1, the modes last", () => {
  const f = pack(FALLBACK);
  assert.equal(f.byteLength, UNIFORM_BYTES);
  const at = (key) => { let k = 0; for (const [c, n] of COLORS) { if (c === key) return k; k += n; } };
  const fire = at('fire');
  assert.deepEqual([...f.slice(fire * 4, fire * 4 + 4)], [1, 1, 1, 1]);
  const brick = at('brick');
  assert.ok(Math.abs(f[brick * 4] - Math.pow(0x8c / 255, 2.2)) < 1e-6);
  const u = new Uint32Array(f.buffer);
  assert.equal(u[NCOLOR * 4], WINDOWS.indexOf('snow'));
  assert.equal(u[NCOLOR * 4 + 1], MANTELS.indexOf('pumpkins'));
  const r = new Uint32Array(pack(validate({ theme: 1, name: 'R', by: 'x', window: 'rain', mantel: 'none' }, 'r')).buffer);
  assert.deepEqual([r[NCOLOR * 4], r[NCOLOR * 4 + 1]], [1, 2]);
});

test("the room's shader reads every colour the schema names, and only those", () => {
  const src = readFileSync('client/room-render.mjs', 'utf8');
  const declared = new Set([...wgsl().matchAll(/const (TH_\w+) =/g)].map((m) => m[1]));
  assert.equal(declared.size, COLORS.length);
  const used = new Set([...src.matchAll(/\b(TH_[A-Z_]+)\b/g)].map((m) => m[1]));
  for (const k of used) assert.ok(declared.has(k), `the shader reads ${k}, which no colour declares`);
  for (const k of declared) assert.ok(used.has(k), `${k} is in the schema but the shader never reads it`);
  assert.match(wgsl(), new RegExp(`array<vec4f, ${NCOLOR}>`));
});

test("elo.json credits every theme as a mod (node tools/elo.mjs writes them), and CONTRIBUTING.md names every colour", async () => {
  const { withThemes, FILE } = await import('../tools/elo.mjs');
  const now = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.deepEqual(now, withThemes(now), "elo.json's mods are not the themes: run node tools/elo.mjs");
  assert.equal(now.game, 'fireplace');
  const guide = readFileSync('CONTRIBUTING.md', 'utf8');
  for (const [key] of COLORS) assert.ok(guide.includes(`\`${key}\``), `CONTRIBUTING.md doesn't name the colour ${key}`);
  for (const w of [...WINDOWS, ...MANTELS]) assert.ok(guide.includes(`\`${w}\``), `CONTRIBUTING.md doesn't name ${w}`);
});
