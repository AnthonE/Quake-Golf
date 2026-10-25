#!/usr/bin/env node
// Fireplace's room themes (client/themes/<id>.json, client/themes.mjs): every
// file checked, then bundled into build/themes.json for the page's picker.
// npm run build runs it; on its own it only checks.
//   node tools/themes.mjs             check every theme, print one line each
//   node tools/themes.mjs new <id>    a new theme file, every field at Grandma's, to edit
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, COLORS, DEFAULT, ID } from '../client/themes.mjs';
import { isMain } from './main.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DIR = join(ROOT, 'client', 'themes');

// Every theme, validated, Grandma's first and the rest by id. Throws on the
// first file that is wrong, naming it and the field.
export function readThemes(dir = DIR) {
  const ids = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
  if (!ids.includes(DEFAULT)) throw new Error(`client/themes/${DEFAULT}.json is missing: it is the room the others change`);
  return [DEFAULT, ...ids.filter((id) => id !== DEFAULT)].map((id) => {
    let t;
    try { t = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')); } catch (e) { throw new Error(`client/themes/${id}.json: not JSON (${e.message})`); }
    return validate(t, id);
  });
}

export function buildThemes(out = join(ROOT, 'build')) {
  const themes = readThemes();
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'themes.json'), JSON.stringify({ themes }) + '\n');
  console.log(`themes.json ${themes.length} themes: ${themes.map((t) => t.id).join(', ')}`);
  return themes;
}

// A theme to start from: Grandma's colours, every one written out.
export function newTheme(id, by = 'your-github-login') {
  const colors = Object.fromEntries(COLORS.map(([key, , def]) => [key, def]));
  return { theme: 1, name: id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 24), by, about: '', window: 'snow', mantel: 'pumpkins', colors };
}

if (isMain(import.meta.url)) {
  const [verb, id, by] = process.argv.slice(2);
  try {
    if (verb === 'new') {
      if (!id || !ID.test(id)) throw new Error('node tools/themes.mjs new <id>: lowercase letters, digits and dashes, 32 at most');
      const f = join(DIR, `${id}.json`);
      if (existsSync(f)) throw new Error(`client/themes/${id}.json is there already`);
      writeFileSync(f, JSON.stringify(newTheme(id, by), null, 2) + '\n');
      console.log(`client/themes/${id}.json: Grandma's room, every colour written out. Change what you like, delete what you don't,`);
      console.log(`and see it at client/room.html?theme=${id} (it reloads as you save).`);
    } else {
      for (const t of readThemes()) console.log(`${t.id.padEnd(20)} ${t.name} by ${t.by} (${t.window}, ${t.mantel})`);
    }
  } catch (e) { console.error(e.message); process.exit(1); }
}
