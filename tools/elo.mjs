#!/usr/bin/env node
// elo.json, Fireplace's manifest for its store row on Elo Pros
// (elopros.com, scry-forge's docs/store/GAME-REPO.md): what the store reads
// from this repo. Its "mods" credit what people made for the game; every room
// theme is one, written here from client/themes/ so the store's list and the
// themes never disagree. Other mods (a minigame someone sent, say) are added
// by hand and kept.
//   node tools/elo.mjs           rewrite the themes in elo.json's mods
//   node tools/elo.mjs --check   exit 1 if they're out of date (test/themes.test.mjs runs this)
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readThemes } from './themes.mjs';
import { isMain } from './main.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FILE = join(ROOT, 'elo.json');

const themeMod = (t) => ({ id: t.id, kind: 'theme', name: t.name, by: t.by, ...(t.about ? { about: t.about } : {}), path: `client/themes/${t.id}.json` });

// elo.json as it should be: its theme mods from the themes (a theme's own pr
// link, added when it was merged, kept), everything else as it is.
export function withThemes(manifest = JSON.parse(readFileSync(FILE, 'utf8')), themes = readThemes()) {
  const old = new Map((manifest.mods || []).filter((m) => m.kind === 'theme').map((m) => [m.id, m]));
  const others = (manifest.mods || []).filter((m) => m.kind !== 'theme');
  const mods = [...themes.map((t) => ({ ...themeMod(t), ...(old.get(t.id)?.pr ? { pr: old.get(t.id).pr } : {}) })), ...others];
  return { ...manifest, mods };
}

if (isMain(import.meta.url)) {
  const now = readFileSync(FILE, 'utf8');
  const want = JSON.stringify(withThemes(JSON.parse(now)), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (now !== want) { console.error('elo.json\'s mods are not the themes in client/themes/: run node tools/elo.mjs'); process.exit(1); }
    console.log('elo.json: its mods are the themes');
  } else {
    writeFileSync(FILE, want);
    console.log(now === want ? 'elo.json: no change' : 'elo.json: the themes in its mods rewritten');
  }
}
