#!/usr/bin/env node
// How maps/bloodgulch/ was drawn: the ground painted into height.png and
// surface.png, the structures, teleporters, spawns, pads and the team
// modes' objectives written to map.json. The files it writes are the map;
// this is only the brush that
// made them. Edit the images in any paint program (16-bit grey, 1/256 m a
// level), map.json in any editor, or this and run it again:
//   node tools/bloodgulch.mjs [maps/bloodgulch]
//
// The gulch runs along x, walled all round: a base at each end, back to the
// cliff, its roof reached by stairs inside to a hatch or by a bridge from the
// slope behind it; a teleporter behind each base to the far side of the
// field; a ridge along the north wall with a cave through it; a creek bed
// down the middle and boulders for cover.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from './png.mjs';
import { compileMap, SURFACES, placePoint } from './map.mjs';
import { isMain } from './main.mjs';

export const ORIGIN = [320, 400]; // world x, z of the first pixel; 2 m a pixel
export const SIZE = [192, 112];
const BOUNDS = [356, 668, 432, 592];
const FLOOR = 20; // the field
const PAD = 21; // a base's floor
const ROOF = 4.8; // a roof's top over its floor
const CAVE = { x0: 482, x1: 542, z0: 572, z1: 576, floor: 21, top: 29 };
const BASES = [{ name: 'red base', x: 392, turn: 0, team: 'red' }, { name: 'blue base', x: 632, turn: 180, team: 'blue' }];

const tidy = (v) => (typeof v === 'number' ? +v.toFixed(3) : v);
const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
// value noise from a hash, for the field's roll and the rocks
const hash = (x, z) => { let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1) ^ 0x5bd1e995) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
function noise(x, z, p) {
  const gx = Math.floor(x / p), gz = Math.floor(z / p), fx = smooth(0, 1, x / p - gx), fz = smooth(0, 1, z / p - gz);
  const a = hash(gx, gz), b = hash(gx + 1, gz), c = hash(gx, gz + 1), d = hash(gx + 1, gz + 1);
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
}
const BOULDERS = [[446, 548, 4, 2.2], [470, 458, 5, 2.8], [556, 452, 4.5, 2.4], [590, 560, 5, 3], [600, 470, 3.5, 2], [428, 470, 3.5, 2.2], [530, 548, 3, 1.6]];

// The ground at (x, z) in metres, and what it is.
export function ground(x, z) {
  // the field rolls, gently down the middle so a long shot along it is clear
  const mid = smooth(4, 26, Math.abs(z - 512));
  let h = FLOOR + (noise(x, z, 26) - 0.5) * (0.6 + 2.2 * mid) + (noise(x + 77, z, 9) - 0.5) * 0.5 * mid;
  h += 3 * smooth(40, 80, Math.abs(z - 512)); // the field climbs to the side walls
  let s = 'grass';
  // the walls: past the bounds the ground climbs 30 m, rounded at the corners
  const dx = Math.max(0, Math.abs(x - 512) - (BOUNDS[1] - BOUNDS[0]) / 2 + 2);
  const dz = Math.max(0, Math.abs(z - 512) - (BOUNDS[3] - BOUNDS[2]) / 2 + 2);
  const out = Math.hypot(dx, dz);
  if (out > 0) { h += 30 * smooth(0, 16, out) + 4 * (noise(x, z, 7) - 0.5) * smooth(2, 10, out); if (out > 3) s = 'rock'; }
  // the creek bed
  if (Math.abs(z - 512 + 3 * Math.sin(x / 31)) < 5 && Math.abs(x - 512) < 100) { s = 'sand'; h -= 0.25 * smooth(5, 1, Math.abs(z - 512 + 3 * Math.sin(x / 31))); }
  // boulders
  for (const [bx, bz, r, ht] of BOULDERS) {
    const t = 1 - Math.hypot(x - bx, z - bz) / r;
    if (t > 0) { h += ht * Math.sqrt(t) * (0.85 + 0.3 * noise(x, z, 2)); s = 'rock'; }
  }
  // the bases: a flat pad, and behind each a slope up to roof height for the bridge
  for (const b of BASES) {
    const lx = (x - b.x) * (b.turn ? -1 : 1), lz = z - 512;
    const wz = 1 - smooth(13, 19, Math.abs(lz));
    if (lx >= -14) h += (PAD - h) * wz * (1 - smooth(13, 20, lx));
    else { const v = h + (PAD + ROOF * smooth(-14, -24, lx) - h) * wz; h = lx < -24 ? Math.max(h, v) : v; }
    if (Math.abs(lx) <= 12.5 && Math.abs(lz) <= 11.5) s = 'metal';
  }
  // the ridge on the north side, flat-topped, a cave through it along x
  const rx = Math.min(smooth(476, 486, x), smooth(548, 538, x));
  const rz = smooth(560, 566, z);
  const r = rx * rz;
  if (r > 0 && CAVE.top > h) { h += (CAVE.top - h) * r; if (r > 0.6) s = 'rock'; }
  return { h, s };
}

// The base, about its own floor at its centre, facing +x (the field).
// Walls 0.8 m thick and 4 m high; the roof 0.8 m thick with a parapet;
// doors front, back and either side; stairs up the +z wall to a hatch;
// a bridge from the roof back over the yard to the slope; a teleporter's frame.
function basePrefab() {
  const B = [];
  const wall = (x0, z0, x1, z1, door, along) => {
    // a wall from (x0, z0) to (x1, z1), 4 m high, with a door 3 m high over [door[0], door[1]] along it
    if (!door) { B.push([x0, 0, z0, x1, 4, z1, 'metal']); return; }
    const [d0, d1] = door;
    if (along === 'z') { B.push([x0, 0, z0, x1, 4, d0, 'metal'], [x0, 0, d1, x1, 4, z1, 'metal'], [x0, 3, d0, x1, 4, d1, 'dark']); }
    else { B.push([x0, 0, z0, d0, 4, z1, 'metal'], [d1, 0, z0, x1, 4, z1, 'metal'], [d0, 3, z0, d1, 4, z1, 'dark']); }
  };
  wall(9.2, -9, 10, 9, [-1.75, 1.75], 'z'); // front
  wall(-10, -9, -9.2, 9, [-1.75, 1.75], 'z'); // back
  wall(-9.2, -9, 9.2, -8.2, [-7.5, -4.5], 'x');
  wall(-9.2, 8.2, 9.2, 9, [-7.5, -4.5], 'x');
  // the roof, open over the top of the stairs
  B.push([-10, 4, -9, 10, ROOF, 6.2, 'metal'], [-10, 4, 6.2, -1, ROOF, 9, 'metal'], [7.2, 4, 6.2, 10, ROOF, 9, 'metal'], [-1, 4, 8.2, 7.2, ROOF, 9, 'metal']);
  // the parapet, a metre high, open at the back for the bridge
  B.push([9.5, ROOF, -9, 10, ROOF + 1, 9, 'dark'], [-10, ROOF, -9, 9.5, ROOF + 1, -8.5, 'dark'], [-10, ROOF, 8.5, 9.5, ROOF + 1, 9, 'dark'],
    [-10, ROOF, -8.5, -9.5, ROOF + 1, -1.5, 'dark'], [-10, ROOF, 1.5, -9.5, ROOF + 1, 8.5, 'dark']);
  // twelve steps of 0.4 m up the +z wall, front to back
  for (let i = 1; i <= 12; i++) B.push([9.2 - 0.8 * i, 0, 6.2, 10 - 0.8 * i, 0.4 * i, 8.2, 'dark']);
  // the bridge, with rails
  B.push([-24, ROOF - 0.4, -1.5, -10, ROOF, 1.5, 'dark'], [-24, ROOF, -1.5, -10, ROOF + 0.9, -1.3, 'metal'], [-24, ROOF, 1.3, -10, ROOF + 0.9, 1.5, 'metal']);
  // the teleporter's frame, in the yard behind
  B.push([-13.4, 0, 9.6, -13, 3, 10.4, 'light'], [-11, 0, 9.6, -10.6, 3, 10.4, 'light'], [-13.4, 3, 9.6, -10.6, 3.4, 10.4, 'light']);
  return B.map((b) => b.map(tidy));
}

export function bloodGulch() {
  const at = (b) => [b.x, PAD, 512];
  const local = (b, p) => placePoint(p, at(b), b.turn).map(tidy);
  const spawns = [];
  for (const b of BASES) {
    for (const [x, z] of [[-5, -4], [-5, 4], [4, -4]]) { const p = local(b, [x, 0, z]); spawns.push([p[0], p[2]]); }
    for (const [x, z] of [[2, -4], [-6, -5]]) { const p = local(b, [x, 0, z]); spawns.push([p[0], p[2], PAD + ROOF + 0.5]); }
    for (const [x, z] of [[-12, -6], [14, 7], [14, -7]]) { const p = local(b, [x, 0, z]); spawns.push([p[0], p[2]]); }
  }
  for (const [x, z] of [[440, 446], [470, 500], [500, 470], [520, 545], [554, 500], [584, 534], [610, 445], [420, 580], [600, 580], [512, 440],
    [465, 525], [560, 470], [512, 512], [540, 586], [450, 585], [575, 445]]) spawns.push([x, z]);
  const tele = (b, [x, z]) => ({ from: local(b, [-12, 0, 10]), to: [x, +(ground(x, z).h + 0.1).toFixed(2), z], radius: 1.1 });
  return {
    name: 'Blood Gulch',
    bounds: BOUNDS,
    terrain: { origin: ORIGIN, height: 'height.png', scale: 1 / 256, base: 0, surface: 'surface.png' },
    prefabs: { base: basePrefab() },
    structures: [
      ...BASES.map((b) => ({ name: b.name, prefab: 'base', at: at(b), turn: b.turn, tint: { dark: b.team } })),
      { name: 'the cave', boxes: [[CAVE.x0 + 4, CAVE.floor + 3.5, CAVE.z0 - 3, CAVE.x1 - 4, CAVE.top, CAVE.z1 + 3, 'rock']] },
      { name: 'west rocks', boxes: [[452, 20, 452, 457, 23.4, 455, 'rock'], [454, 20, 455, 456, 22.2, 459, 'rock']] },
      { name: 'east rocks', boxes: [[566, 20, 569, 571, 23.4, 572, 'rock'], [568, 20, 565, 570, 22.2, 569, 'rock']] },
    ],
    teleporters: [tele(BASES[0], [470, 440]), tele(BASES[1], [554, 584])],
    spawns,
    pads: [
      { weapon: 'sniper', at: [398, 512, PAD + ROOF + 0.5] }, { weapon: 'sniper', at: [626, 512, PAD + ROOF + 0.5] },
      { weapon: 'rocket', at: [512, 512] }, { weapon: 'shotgun', at: [418, 548] }, { weapon: 'shotgun', at: [606, 476] },
      { weapon: 'sword', at: [512, 574] }, { weapon: 'br', at: [452, 478] }, { weapon: 'br', at: [572, 546] },
      { weapon: 'needler', at: [482, 548] }, { weapon: 'plasma', at: [542, 468] }, { weapon: 'br', at: [512, 458] }, { weapon: 'plasma', at: [436, 500] },
    ],
    // what the team modes play for: a flag on each base's floor, in the middle
    // of its room; the skull mid-field, as far from either base as from its
    // teleporter's exit; six hills, by turns either side of the middle (a
    // roof's top keeps it off the room under it, the cave's off the ridge)
    flags: BASES.map((b) => ({ team: b.team, at: [b.x, 512] })),
    ball: { at: [512, 512] },
    hills: [
      { at: [512, 512], radius: 8 }, { at: [BASES[0].x, 512, PAD + ROOF + 0.5], radius: 6 }, { at: [568.5, 570.5, 24], radius: 4 },
      { at: [512, CAVE.z0 + 2, CAVE.floor + 2], radius: 4 }, { at: [BASES[1].x, 512, PAD + ROOF + 0.5], radius: 6 }, { at: [454.5, 453.5, 24], radius: 4 },
    ],
  };
}

export function paint() {
  const [W, H] = SIZE;
  const hgt = new Uint16Array(W * H), rgb = new Uint8Array(W * H * 3);
  const pal = { grass: [77, 128, 51], rock: [122, 110, 92], sand: [184, 158, 107], metal: [128, 143, 158] };
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x = ORIGIN[0] + 2 * i, z = ORIGIN[1] + 2 * j;
      let { h, s } = ground(x, z);
      // the cave: its floor cut through the ridge
      if (x >= CAVE.x0 && x <= CAVE.x1 && z >= CAVE.z0 && z <= CAVE.z1) { h = CAVE.floor; s = 'sand'; }
      hgt[j * W + i] = Math.round(h * 256);
      rgb.set(pal[s], 3 * (j * W + i));
    }
  }
  if (!SURFACES.every((n) => pal[n])) throw new Error('a surface without a colour');
  return { hgt, rgb };
}

if (isMain(import.meta.url)) {
  const dir = process.argv[2] || 'maps/bloodgulch';
  mkdirSync(dir, { recursive: true });
  const { hgt, rgb } = paint();
  writeFileSync(join(dir, 'height.png'), encodePng({ width: SIZE[0], height: SIZE[1], channels: 1, depth: 16, data: hgt }));
  writeFileSync(join(dir, 'surface.png'), encodePng({ width: SIZE[0], height: SIZE[1], channels: 3, depth: 8, data: rgb }));
  const spec = bloodGulch();
  // one box to a line, so the file reads (and diffs) like a level script
  const text = JSON.stringify(spec, null, 2).replace(/\[\s+(-?[\d.]+|"[^"]*"),\s+([^[\]{}]*?)\s+\]/g, (m) => m.replace(/\s+/g, ' ').replace('[ ', '[').replace(' ]', ']'));
  writeFileSync(join(dir, 'map.json'), text + '\n');
  const m = compileMap(dir);
  console.log(`${m.name}: ${m.boxes.length} boxes in ${m.groups.length} structures, ${m.teleporters.length} teleporters, ${m.spawns.length} spawns, ${m.bytes.length} B`);
}
