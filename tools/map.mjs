#!/usr/bin/env node
// The map compiler: maps/<name>/ in, the bytes of the arena's map out, built
// into build/arena/game.wasm by tools/asm.mjs as a passive data segment that
// init copies into memory. A map is a directory:
//
//   map.json      bounds, the terrain images and how to read them, the
//                 structures (boxes, by prefab or by hand), teleporters,
//                 spawn points, weapon pads, and what the team modes play
//                 for (two flags, the skull's spot, hills: defaults for any
//                 left out); see maps/bloodgulch/map.json
//   height.png    the ground: grey, 8 or 16 bits, 2 m a pixel, read as
//                 metres = base + level * scale
//   surface.png   optional: what the ground is (colours, nearest of "surfaces")
//
// Anything a fighter can stand on, hide behind or walk under that the ground
// can't be (walls, roofs, bridges, a cave's roof) is a box: [x0, y0, z0, x1,
// y1, z1, material], in metres. A prefab is a list of boxes about its own
// origin, placed by a structure at a point with a quarter turn and a remap of
// its materials, so one base serves both teams.
//
//   node tools/map.mjs maps/bloodgulch     checks a map and prints what it holds
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as L from '../src/layout.mjs';
import { decodePng } from './png.mjs';
import { isMain } from './main.mjs';

// Ground types, as the sim and the renderer number them, and the colours a
// surface image paints them with unless map.json says otherwise.
export const SURFACES = ['grass', 'rock', 'sand', 'metal'];
const SURFACE_RGB = { grass: [77, 128, 51], rock: [122, 110, 92], sand: [184, 158, 107], metal: [128, 143, 158] };
// Box materials, as client/arena-render.mjs colours them.
export const MATERIALS = ['metal', 'rock', 'dark', 'red', 'blue', 'light'];
const WEAPONS = { ar: L.W_AR, br: L.W_BR, magnum: L.W_MAGNUM, sniper: L.W_SNIPER, shotgun: L.W_SHOTGUN, rocket: L.W_ROCKET, plasma: L.W_PLASMA, needler: L.W_NEEDLER, sword: L.W_SWORD };
const GROUND = -1000; // a spawn or pad with no top: on the ground

export function mapDir(name = process.env.QG_MAP || L.MAP_NAME) {
  return resolve(name.includes('/') ? name : join(L.MAPS, name));
}

// A box turned by `turn` degrees about the y axis (+x towards +z at 90), then moved to `at`.
function place(box, at, turn) {
  const [x0, y0, z0, x1, y1, z1] = box;
  const q = ((Math.round(turn / 90) % 4) + 4) % 4;
  if (turn % 90) throw new Error(`turn ${turn}: quarter turns only`);
  const rot = ([x, z]) => [[x, z], [-z, x], [-x, -z], [z, -x]][q];
  const a = rot([x0, z0]), b = rot([x1, z1]);
  return [Math.min(a[0], b[0]) + at[0], y0 + at[1], Math.min(a[1], b[1]) + at[2], Math.max(a[0], b[0]) + at[0], y1 + at[1], Math.max(a[1], b[1]) + at[2]];
}

// Points in a structure (teleporter pads, spawns) turn and move with it.
export function placePoint([x, y, z], at = [0, 0, 0], turn = 0) {
  const b = place([x, y, z, x, y, z], at, turn);
  return [b[0], b[1], b[2]];
}

const round = (v) => Math.fround(v);

export function compileMap(dir = mapDir()) {
  const where = (s) => `${dir}/map.json: ${s}`;
  const spec = JSON.parse(readFileSync(join(dir, 'map.json'), 'utf8'));
  const fail = (s) => { throw new Error(where(s)); };
  const t = spec.terrain || fail('no "terrain"');
  // ---- the ground
  const img = decodePng(readFileSync(join(dir, t.height || 'height.png')));
  const [ox, oz] = t.origin || fail('terrain.origin: the world x, z of the images\' first pixel');
  if (ox % L.SPACING || oz % L.SPACING) fail(`terrain.origin ${ox}, ${oz}: multiples of ${L.SPACING} m`);
  const gx = ox / L.SPACING, gz = oz / L.SPACING;
  const W = img.width, H = img.height;
  if (gx < 1 || gz < 1 || gx + W > L.GRID - 1 || gz + H > L.GRID - 1) fail(`the images (${W} x ${H} at ${ox}, ${oz}) must lie inside the world, a sample in from its edge`);
  const scale = t.scale ?? (img.depth === 16 ? 1 / 256 : 0.25);
  const base = t.base ?? 0;
  const heights = new Uint16Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const m = base + img.data[i * img.channels] * scale;
    heights[i] = Math.max(0, Math.min(65535, Math.round(m * 256)));
  }
  const surf = new Uint8Array(W * H);
  if (t.surface) {
    const s = decodePng(readFileSync(join(dir, t.surface)));
    if (s.width !== W || s.height !== H) fail(`${t.surface} is ${s.width} x ${s.height}, the height image ${W} x ${H}`);
    const pal = SURFACES.map((n) => (t.surfaces && t.surfaces[n]) || SURFACE_RGB[n]);
    for (let i = 0; i < W * H; i++) {
      const c = s.channels >= 3 ? [0, 1, 2].map((k) => s.data[i * s.channels + k]) : [0, 0, 0].map(() => s.data[i * s.channels]);
      let best = 0, bd = Infinity;
      pal.forEach((p, k) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; best = k; } });
      surf[i] = best;
    }
  }
  // ---- structures: a group of boxes each
  const prefabs = spec.prefabs || {};
  const groups = [], boxes = [], teleporters = [];
  const mat = (name, tint, ctx) => {
    const m = MATERIALS.indexOf((tint && tint[name]) || name || 'metal');
    if (m < 0) fail(`${ctx}: no material "${name}" (${MATERIALS.join(', ')})`);
    return m;
  };
  for (const [k, s] of (spec.structures || []).entries()) {
    const name = s.name || `structure ${k}`;
    const list = s.prefab ? (prefabs[s.prefab] || fail(`${name}: no prefab "${s.prefab}"`)) : (s.boxes || fail(`${name}: no boxes`));
    const at = s.at || [0, 0, 0], turn = s.turn || 0;
    const first = boxes.length;
    for (const b of list) {
      if (b.length < 6 || b.slice(0, 6).some((v) => typeof v !== 'number')) fail(`${name}: a box is [x0, y0, z0, x1, y1, z1, material]`);
      if (!(b[0] < b[3] && b[1] < b[4] && b[2] < b[5])) fail(`${name}: box ${JSON.stringify(b)} is empty or inside out`);
      boxes.push({ box: place(b, at, turn).map(round), material: mat(b[6], s.tint, name), group: groups.length });
    }
    if (boxes.length === first) continue;
    const mine = boxes.slice(first);
    const bound = [0, 1, 2].map((a) => Math.min(...mine.map((b) => b.box[a]))).concat([3, 4, 5].map((a) => Math.max(...mine.map((b) => b.box[a]))));
    groups.push({ name, bound, first, count: mine.length });
    for (const tp of s.teleporters || []) teleporters.push({ from: placePoint(tp.from, at, turn), to: placePoint(tp.to, at, turn), radius: tp.radius ?? 1.2 });
  }
  for (const tp of spec.teleporters || []) teleporters.push({ from: tp.from, to: tp.to, radius: tp.radius ?? 1.2 });
  if (boxes.length > L.NBOX) fail(`${boxes.length} boxes, at most ${L.NBOX}`);
  if (groups.length > L.NGROUP) fail(`${groups.length} structures, at most ${L.NGROUP}`);
  if (teleporters.length > L.NTELE) fail(`${teleporters.length} teleporters, at most ${L.NTELE}`);
  // ---- where fighters go, start and find guns
  const bounds = spec.bounds || fail('no "bounds": [x0, x1, z0, z1], where fighters can go');
  if (!(bounds[0] < bounds[1] && bounds[2] < bounds[3])) fail('bounds: [x0, x1, z0, z1]');
  const inside = (x, z, what) => { if (!(x >= bounds[0] && x <= bounds[1] && z >= bounds[2] && z <= bounds[3])) fail(`${what} at ${x}, ${z} is out of bounds`); };
  const spawns = (spec.spawns || []).map((s, k) => { inside(s[0], s[1], `spawn ${k}`); return { x: s[0], z: s[1], top: s[2] ?? GROUND }; });
  if (!spawns.length || spawns.length > L.NSPAWN) fail(`${spawns.length} spawn points: 1 to ${L.NSPAWN}`);
  const pads = (spec.pads || []).map((p, k) => {
    const w = WEAPONS[p.weapon] || fail(`pad ${k}: no weapon "${p.weapon}" (${Object.keys(WEAPONS).join(', ')})`);
    inside(p.at[0], p.at[1], `pad ${k}`);
    return { x: p.at[0], z: p.at[1], top: p.at[2] ?? GROUND, weapon: w };
  });
  if (pads.length > L.NPAD) fail(`${pads.length} pads, at most ${L.NPAD}`);
  for (const [k, tp] of teleporters.entries()) { inside(tp.from[0], tp.from[2], `teleporter ${k}`); inside(tp.to[0], tp.to[2], `teleporter ${k}'s exit`); }
  // ---- what the team modes play for: the flags' stands, the skull's spot, the hills
  const point = (at, what) => {
    if (!Array.isArray(at) || at.length < 2 || at.slice(0, 3).some((v) => typeof v !== 'number')) fail(`${what}: "at" is [x, z] or [x, z, top]`);
    inside(at[0], at[1], what);
    return [at[0], at[1], at[2] ?? GROUND];
  };
  const [bw, bd] = [bounds[1] - bounds[0], bounds[3] - bounds[2]];
  const mid = [(bounds[0] + bounds[1]) / 2, (bounds[2] + bounds[3]) / 2];
  let flags;
  if (spec.flags) {
    if (!Array.isArray(spec.flags) || spec.flags.length !== 2) fail('flags: exactly two, red\'s and blue\'s');
    flags = ['red', 'blue'].map((team) => point((spec.flags.find((f) => f.team === team) || fail(`flags: no ${team} flag`)).at, `${team}'s flag`));
  } else {
    // an eighth in from each end of the longer side, red at the low end
    flags = bw >= bd ? [[bounds[0] + bw / 8, mid[1], GROUND], [bounds[1] - bw / 8, mid[1], GROUND]] : [[mid[0], bounds[2] + bd / 8, GROUND], [mid[0], bounds[3] - bd / 8, GROUND]];
  }
  const ball = spec.ball ? point(spec.ball.at, 'the ball') : [...mid, GROUND];
  let hills;
  if (spec.hills) {
    if (!Array.isArray(spec.hills) || !spec.hills.length || spec.hills.length > L.NHILL) fail(`${spec.hills.length ?? 0} hills: 1 to ${L.NHILL}`);
    hills = spec.hills.map((h, k) => {
      if (!(h.radius > 0 && h.radius <= 30)) fail(`hill ${k}: a radius over 0, at most 30 m`);
      return [...point(h.at, `hill ${k}`), h.radius];
    });
  } else {
    // the middle, and halfway from it to each flag
    const r = Math.max(3, Math.min(10, Math.min(bw, bd) / 10));
    hills = [[...mid, GROUND, r], ...flags.map((f) => [(mid[0] + f[0]) / 2, (mid[1] + f[1]) / 2, GROUND, r])];
  }
  const sides = [0, 0];
  for (const s of spawns) { const k = half(s.x, s.z, flags); if (k < 2) sides[k]++; }
  ['red', 'blue'].forEach((team, k) => { if (!sides[k]) fail(`no spawn on ${team}'s half (the spawns nearer its flag at ${flags[k][0]}, ${flags[k][1]} than the other)`); });

  // ---- the bytes: the head as MAP lays it out, the groups, the boxes, the images
  const head = new DataView(new ArrayBuffer(L.MAP_HEAD));
  const rel = (a) => a - L.MAP;
  head.setUint32(rel(L.MAP_NBOX), boxes.length, true);
  head.setUint32(rel(L.MAP_NGROUP), groups.length, true);
  head.setUint32(rel(L.MAP_NTELE), teleporters.length, true);
  head.setUint32(rel(L.MAP_NSPAWN), spawns.length, true);
  head.setUint32(rel(L.MAP_NPAD), pads.length, true);
  bounds.forEach((v, k) => head.setFloat32(rel(L.MAP_BOUNDS) + 4 * k, v, true));
  spawns.forEach((s, k) => {
    head.setFloat32(rel(L.MAP_SPAWN) + 8 * k, s.x, true);
    head.setFloat32(rel(L.MAP_SPAWN) + 8 * k + 4, s.z, true);
    head.setFloat32(rel(L.MAP_SPAWNY) + 4 * k, s.top, true);
  });
  pads.forEach((p, k) => {
    const a = rel(L.MAP_PADS) + 16 * k;
    head.setFloat32(a, p.x, true); head.setFloat32(a + 4, p.z, true); head.setFloat32(a + 8, p.top, true); head.setUint32(a + 12, p.weapon, true);
  });
  teleporters.forEach((tp, k) => {
    const a = rel(L.MAP_TELE) + L.TELE_SIZE * k;
    [...tp.from, tp.radius, ...tp.to].forEach((v, i) => head.setFloat32(a + 4 * i, v, true));
  });
  const gbytes = new DataView(new ArrayBuffer(groups.length * 32));
  groups.forEach((g, k) => { g.bound.forEach((v, i) => gbytes.setFloat32(32 * k + 4 * i, v, true)); gbytes.setUint32(32 * k + 24, g.first, true); gbytes.setUint32(32 * k + 28, g.count, true); });
  const bbytes = new DataView(new ArrayBuffer(boxes.length * L.BOX_SIZE));
  boxes.forEach((b, k) => { b.box.forEach((v, i) => bbytes.setFloat32(32 * k + 4 * i, v, true)); bbytes.setUint32(32 * k + 24, b.material, true); bbytes.setUint32(32 * k + 28, b.group, true); });
  const hbytes = new Uint8Array(heights.buffer.slice(0));
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw new Error('a little-endian host, please');
  // the objectives as MAP_OBJ lays them out
  const obj = new DataView(new ArrayBuffer(L.MAP_OBJ_SIZE));
  const orel = (a) => a - L.MAP_OBJ;
  obj.setUint32(orel(L.MAP_NHILL), hills.length, true);
  flags.forEach((f, k) => f.forEach((v, i) => obj.setFloat32(orel(L.MAP_FLAGS) + 16 * k + 4 * i, v, true)));
  ball.forEach((v, i) => obj.setFloat32(orel(L.MAP_BALL) + 4 * i, v, true));
  hills.forEach((h, k) => h.forEach((v, i) => obj.setFloat32(orel(L.MAP_HILLS) + 16 * k + 4 * i, v, true)));
  const parts = [new Uint8Array(head.buffer), new Uint8Array(gbytes.buffer), new Uint8Array(bbytes.buffer), hbytes, surf, new Uint8Array(obj.buffer)];
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  const offs = [];
  parts.reduce((at, p) => { offs.push(at); bytes.set(p, at); return at + p.length; }, 0);
  return {
    name: spec.name || dir,
    bytes,
    // folded into the arena's WAT as @MAPSEG_* and @MAPIMG_*
    consts: {
      MAPSEG_GROUPS: offs[1], MAPSEG_NGROUPB: gbytes.byteLength, MAPSEG_BOXES: offs[2], MAPSEG_NBOXB: bbytes.byteLength,
      MAPSEG_H: offs[3], MAPSEG_S: offs[4], MAPSEG_OBJ: offs[5], MAPIMG_X0: gx, MAPIMG_Z0: gz, MAPIMG_W: W, MAPIMG_H: H,
    },
    bounds, groups, boxes, teleporters, spawns, pads, flags, ball, hills, sides, heights, surf, origin: [ox, oz], size: [W, H],
  };
}

// Whose half of the map (x, z) is on, as the sim's $a_half reckons it in f32:
// 0 red's if strictly nearer red's flag than blue's, 1 blue's if strictly
// nearer blue's, 2 neither's (as far from both).
export function half(x, z, flags) {
  const f = Math.fround;
  const d2 = ([fx, fz]) => { const dx = f(f(x) - f(fx)), dz = f(f(z) - f(fz)); return f(f(dx * dx) + f(dz * dz)); };
  const r = d2(flags[0]), b = d2(flags[1]);
  return r < b ? 0 : r > b ? 1 : 2;
}

// The segment as WAT text: a passive data segment, copied out by memory.init.
// Only letters and digits go in plain, so nothing in it reads as a macro,
// a constant or a comment to the assembler's later passes.
export function dataSegment(bytes, name = '$map') {
  let s = '';
  for (const b of bytes) s += /[A-Za-z0-9]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : '\\' + b.toString(16).padStart(2, '0');
  return `(data ${name} "${s}")`;
}

if (isMain(import.meta.url)) {
  const m = compileMap(mapDir(process.argv[2]));
  console.log(`${m.name}: ${m.size[0]} x ${m.size[1]} samples at ${m.origin.join(', ')}, ${m.boxes.length} boxes in ${m.groups.length} structures, ` +
    `${m.teleporters.length} teleporters, ${m.spawns.length} spawns, ${m.pads.length} pads; ${m.bytes.length} B`);
  for (const g of m.groups) console.log(`  ${g.name}: ${g.count} boxes, ${g.bound.map((v) => +v.toFixed(2)).join(' ')}`);
  const at = ([x, z, top]) => `${x}, ${z}${top === GROUND ? '' : ` up to ${top}`}`;
  console.log(`  flags: red ${at(m.flags[0])}, blue ${at(m.flags[1])}; spawns on each half: red ${m.sides[0]}, blue ${m.sides[1]}`);
  console.log(`  the skull: ${at(m.ball)}; ${m.hills.length} hills: ${m.hills.map((h) => `${at(h)} r ${h[3]}`).join('; ')}`);
}
