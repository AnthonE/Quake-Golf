// Fireplace's room themes: a local reskin of the living room, one JSON file
// each in client/themes/<id>.json. A theme is data, never code: colours, what
// stands on the mantel and the weather at the window. It changes what the room
// looks like on this screen and nothing else (the sim never sees it, so a theme
// can't desync a room). Grandma's (grandma.json) is the room as it was drawn
// before themes: every colour below is its default, and a theme leaves out
// whatever it doesn't change.
//
// Colours are what a colour picker shows ("#rrggbb", or [r, g, b] from 0 to 1);
// pack() turns them into the linear light the shader adds up. tools/asm.mjs
// checks every file and bundles them into build/themes.json; the room page
// reads one file at a time, so a theme being edited shows on a reload.

// Every colour, in the uniform's order: [key, how many, default(s), what it paints]
export const COLORS = [
  ['brick', 1, '#8c3824', 'the chimney breast and the firebox'],
  ['mortar', 1, '#8c8070', 'between the bricks'],
  ['mantel', 1, '#3d2112', 'the mantel shelf'],
  ['hearth', 1, '#736e66', 'the hearth stone in front of the fire'],
  ['wood', 1, '#5c331a', "the TV's cabinet and the side table"],
  ['couch', 1, '#591f1a', 'the couch you sit on'],
  ['trim', 1, '#d9d4c7', "the window's frame"],
  ['ceiling', 1, '#8c8073', 'the ceiling'],
  ['floor', 1, '#8c572e', 'the floorboards'],
  ['wallpaper', 2, ['#9ea885', '#c7bd99'], "the wallpaper's two stripes"],
  ['baseboard', 1, '#6b4729', 'the baseboard'],
  ['cornice', 1, '#bfb8a6', 'the band along the top of the walls'],
  ['rug', 3, ['#80291a', '#9e7338', '#4d3824'], "the braided rug's three yarns"],
  ['rugEdge', 1, '#d9bf80', "the rug's edge"],
  ['lamp', 1, '#f2d999', "the lamp's shade"],
  ['lampGlow', 1, '#e4c18d', 'the light in the lamp'],
  ['fire', 1, '#ffbd7b', 'the flames, the embers and the firelight on everything'],
  ['paintSky', 2, ['#e68c4d', '#404d8c'], "the painting's sky, at the horizon and at the top"],
  ['paintGround', 1, '#d9e0eb', "the painting's ground"],
  ['paintHouse', 1, '#592e1a', 'the cabin in the painting'],
  ['paintFrame', 1, '#805c1f', "the painting's frame"],
  ['night', 2, ['#2b3451', '#47557b'], 'the sky through the window, low and high'],
  ['moon', 1, '#f3f3e6', 'the moon (and the stars, on a clear night)'],
  ['flakes', 1, '#cacaca', 'snowflakes or raindrops'],
  ['sill', 1, '#a8acba', 'the ledge outside the window'],
  ['outdoor', 1, '#47516f', 'the light the window lets in'],
  ['ambient', 1, '#4c413b', "the light that bounces round the room: everything's floor"],
  ['props', 2, ['#f26b14', '#f26b14'], 'the two things on the mantel'],
  ['propCap', 1, '#4d591a', "a pumpkin's stalk, a bauble's cap"],
];
export const WINDOWS = ['snow', 'rain', 'clear'];
export const MANTELS = ['pumpkins', 'baubles', 'none'];
export const KEYS = ['theme', 'name', 'by', 'about', 'window', 'mantel', 'colors'];
export const NAME_MAX = 24;
export const ABOUT_MAX = 200;
export const DEFAULT = 'grandma';
// GitHub's rule for a login
export const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
export const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

// one vec4f per colour, then the modes
export const NCOLOR = COLORS.reduce((n, [, k]) => n + k, 0);
export const UNIFORM_BYTES = NCOLOR * 16 + 16;

// The WGSL the room's shader declares: the uniform's struct and an index for
// each colour (TH_BRICK, TH_WALLPAPER + 1, ...).
export function wgsl() {
  let k = 0;
  const idx = COLORS.map(([key, n]) => { const s = `const TH_${key.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase()} = ${k}u;`; k += n; return s; });
  return `struct Theme { c: array<vec4f, ${NCOLOR}>, mode: vec4u }; // mode: the window, the mantel\n${idx.join('\n')}\n`;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
function color(v, where) {
  if (typeof v === 'string') {
    if (!HEX.test(v)) throw new Error(`${where}: "${v}" is not a colour; write "#rrggbb"`);
    return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  }
  if (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1)) return v.slice();
  throw new Error(`${where}: a colour is "#rrggbb" or [r, g, b] with each from 0 to 1`);
}
const printable = (s) => /^[\x20-\x7e]*$/.test(s);

// A theme file's contents (parsed JSON) as the room draws it, or an Error that
// says what to fix. id is its file's name.
export function validate(t, id) {
  const at = `client/themes/${id}.json`;
  const fail = (m) => { throw new Error(`${at}: ${m}`); };
  if (!ID.test(id)) fail(`the file's name is the theme's id: lowercase letters, digits and dashes, 32 at most`);
  if (!t || typeof t !== 'object' || Array.isArray(t)) fail('a theme is a JSON object');
  for (const k of Object.keys(t)) if (!KEYS.includes(k)) fail(`"${k}" is not a theme field (${KEYS.join(', ')})`);
  if (t.theme !== 1) fail('"theme": 1 is the format this file is written in');
  if (typeof t.name !== 'string' || !t.name.trim() || t.name.length > NAME_MAX || !printable(t.name)) fail(`"name" is required: ${NAME_MAX} characters at most, plain ASCII (the TV's font)`);
  if (typeof t.by !== 'string' || !LOGIN.test(t.by)) fail('"by" is your GitHub login: who made it, credited on the store');
  if (t.about !== undefined && (typeof t.about !== 'string' || t.about.length > ABOUT_MAX)) fail(`"about" is a line of text, ${ABOUT_MAX} characters at most`);
  if (t.window !== undefined && !WINDOWS.includes(t.window)) fail(`"window" is one of ${WINDOWS.join(', ')}`);
  if (t.mantel !== undefined && !MANTELS.includes(t.mantel)) fail(`"mantel" is one of ${MANTELS.join(', ')}`);
  const cs = t.colors ?? {};
  if (typeof cs !== 'object' || Array.isArray(cs)) fail('"colors" is an object of colours by name');
  const known = new Map(COLORS.map((c) => [c[0], c]));
  for (const k of Object.keys(cs)) if (!known.has(k)) fail(`"colors.${k}" is not a colour of the room (${COLORS.map((c) => c[0]).join(', ')})`);
  const col = (v, where) => { try { return color(v, where); } catch (e) { return fail(e.message); } };
  const colors = {};
  for (const [key, n, def] of COLORS) {
    const v = cs[key] ?? def;
    if (n === 1) colors[key] = col(v, `colors.${key}`);
    else {
      if (!Array.isArray(v) || v.length !== n || (n === 3 && typeof v[0] === 'number')) fail(`"colors.${key}" is a list of ${n} colours`);
      colors[key] = v.map((x, i) => col(x, `colors.${key}[${i}]`));
    }
  }
  return { id, name: t.name.trim(), by: t.by, about: t.about ?? '', window: t.window ?? 'snow', mantel: t.mantel ?? 'pumpkins', colors };
}

// The defaults as a validated theme, for whatever has no file to read.
export const FALLBACK = validate({ theme: 1, name: "Grandma's", by: 'AnthonE' }, DEFAULT);

const lin = (v) => Math.pow(v, 2.2);
// A validated theme as the room's uniform: every colour in linear light, the
// fire as a tint of the default fire's (so the default's is exactly 1), then
// the modes.
export function pack(th) {
  const buf = new ArrayBuffer(UNIFORM_BYTES);
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  const fire0 = FALLBACK.colors.fire.map(lin);
  let k = 0;
  for (const [key, n] of COLORS) {
    const list = n === 1 ? [th.colors[key]] : th.colors[key];
    for (const c of list) {
      const l = c.map(lin);
      f.set(key === 'fire' ? l.map((x, i) => x / fire0[i]) : l, k * 4);
      f[k * 4 + 3] = 1;
      k++;
    }
  }
  u[NCOLOR * 4] = WINDOWS.indexOf(th.window);
  u[NCOLOR * 4 + 1] = MANTELS.indexOf(th.mantel);
  return f;
}

// ---- in the page: a theme by id, read from its own file (so an edit shows on
// a reload, with no build), and every theme the build bundled, for cycling.
export async function loadTheme(id) {
  if (!ID.test(id)) throw new Error(`no theme "${id}"`);
  const r = await fetch(new URL(`./themes/${id}.json`, import.meta.url), { cache: 'no-store' });
  if (!r.ok) throw new Error(`no theme "${id}" (${r.status})`);
  return validate(await r.json(), id);
}
export async function themeList() {
  try {
    const r = await fetch(new URL('../build/themes.json', import.meta.url));
    return r.ok ? (await r.json()).themes.map((t) => t.id) : [DEFAULT];
  } catch { return [DEFAULT]; }
}
// The theme this viewer last picked (a convenience: a private window has none).
export const STORE_KEY = 'fireplace.theme';
export function savedTheme() { try { return localStorage.getItem(STORE_KEY); } catch { return null; } }
export function saveTheme(id) { try { localStorage.setItem(STORE_KEY, id); } catch { /* not kept */ } }
