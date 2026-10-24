// Party's renderer on synthetic stages, no sim: every shape and look, decals,
// the paint layer, glows, balls with riders, coins and bombs, each backdrop,
// a crowd of 256 and a stress test of 20,000 solids. tools/party-shot.mjs
// reads each back with capture() (headless Chrome, ?present=0) into
// traces/party-render-<scene>.png; in a browser it draws the one in ?scene=
// (or flips through them all, a click for the next), moving.
//   ?scene=looks  ?env=night (any scene, another backdrop)  ?scene=crowd~over (seen from high over the edge)  ?res=1280x800  ?present=0
import { createRenderer, Scene, LOOK, SPRITE, COLS, DECAL, ENVS } from './party-render.mjs';
import { put, C } from './font.mjs';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('screen');
const note = document.getElementById('note');
const CX = 512, FLOOR = 40;
const slotColor = (s) => { const h = (s * 0.618034) % 1; return [0, 0.33, 0.67].map((o) => 0.55 + 0.4 * Math.cos(6.2832 * (h + o))); };
// a small PRNG, so every scene comes out the same each time
const rng = (seed) => () => { seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x9e3779b9) | 0; let t = seed ^ (seed >>> 12); t = Math.imul(t, 0x297a2d39) ^ (t >>> 15); return (t >>> 0) / 4294967296; };
// pointy-top axial hexes (as src/party-view.mjs hexCentre): circumradius s, centred on (CX, CX)
const hexCentre = (qq, r, s) => [CX + s * Math.sqrt(3) * (qq + r / 2), CX + s * 1.5 * r];
const hexes = (R, s) => {
  const out = [];
  const n = Math.ceil(R / s) + 1;
  for (let r = -n; r <= n; r++) for (let qq = -2 * n; qq <= 2 * n; qq++) {
    const [x, z] = hexCentre(qq, r, s);
    if (Math.hypot(x - CX, z - CX) <= R) out.push([x, z, qq, r]);
  }
  return out;
};

function frameState(W, H, HS) {
  return {
    cam: [0, 0, 0], yaw: 0, pitch: 0, time: 0, slot: -1, env: 'day', focus: [CX, CX], extent: 40,
    scene: new Scene(24000), casters: [], solid: [], glow: [], beams: [], decals: [], paint: null,
    rects: [], text: null, graph: null, flash: 0, mini: [36 * HS, H - 36 * HS, 30 * HS, 40], miniShape: 'disc',
  };
}

// A ball and its rider, as the frontends draw them: casters[slot] its shadow, the sprites its picture.
function ball(s, p, x, y, z, { vel = [0, 0, 0], roll = 0, face, own = false, item = 0, r = 1 } = {}) {
  const col = slotColor(p);
  const f = face ?? Math.atan2(vel[2], vel[0]);
  const fv = [Math.cos(f), 0, Math.sin(f)];
  while (s.casters.length <= p) s.casters.push([0, -1000, 0, 0]);
  s.casters[p] = [x, y, z, r];
  s.solid.push({ pos: [x, y + r, z], size: r, color: [...col, 1], kind: SPRITE.BALL, minpx: 1, vel, roll, seed: p });
  s.solid.push({ pos: [x, y + 2 * r + 0.22, z], size: 0.34, color: [...col, 1], kind: SPRITE.BODY, minpx: 1 });
  s.solid.push({ pos: [x, y + 2 * r + 0.78, z], size: 0.3, color: [...col, 1], kind: SPRITE.HEAD, minpx: 1, vel: fv });
  if (item) s.solid.push({ pos: [x, y + 2 * r + 1.55, z], size: 0.26, color: [1, 0.85, 0.2, 1], kind: SPRITE.ORB, minpx: 1 });
  if (own) s.solid.push({ pos: [x, y + 2 * r + 1.65, z], size: 0.3, color: [1, 1, 0.4, 1], kind: SPRITE.ARROW, minpx: 2 });
}
// the camera behind and above a point, looking along yaw
function chase(s, at, yaw, { back = 9.2, pitch = -0.42, lift = 1.6 } = {}) {
  s.yaw = yaw; s.pitch = pitch;
  s.cam = [at[0] - Math.cos(yaw) * Math.cos(pitch) * back, at[1] + lift - Math.sin(pitch) * back, at[2] - Math.sin(yaw) * Math.cos(pitch) * back];
}
// HUD text at a point in the world (the renderer's projection)
function label(s, r, p, text, color = C.WHITE) {
  const focal = Math.min(r.width, r.height * 1.6) * 0.62;
  const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw), cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
  const d = [p[0] - s.cam[0], p[1] - s.cam[1], p[2] - s.cam[2]];
  const z = d[0] * cp * cy + d[1] * sp + d[2] * cp * sy;
  if (z < 1) return;
  const sx = r.width / 2 + (d[0] * -sy + d[2] * cy) * focal / z;
  const syy = r.height / 2 - (d[0] * -sp * cy + d[1] * cp + d[2] * -sp * sy) * focal / z;
  const col = Math.round((sx - r.hudX) / (4 * r.hudScale) - text.length / 2), row = Math.floor(syy / (6 * r.hudScale));
  put(s.text, COLS, col, row, text, color);
}
const title = (s, r, t, sub, color = C.YELLOW) => {
  put(s.text, COLS, Math.floor((COLS - t.length) / 2), 1, t, color);
  if (sub) put(s.text, COLS, Math.floor((COLS - sub.length) / 2), 2, sub, C.GREY);
};

// a crowd: n balls over a disc of radius R round (cx, cz) on a floor at y, rolling every which way
function crowd(s, n, R, y, rand, { from = 0, cx = CX, cz = CX, skip = () => false } = {}) {
  let p = from;
  for (let k = 0; p < from + n && k < n * 8; k++) {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * R;
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (skip(x, z)) continue;
    const h = rand() * Math.PI * 2, v = 2 + rand() * 6;
    ball(s, p, x, y + (rand() < 0.08 ? rand() * 0.8 : 0), z, { vel: [Math.cos(h) * v, 0, Math.sin(h) * v], roll: rand() * 40 });
    p++;
  }
  return p;
}

const SCENES = {
  // every look on every shape, on a matte floor, with a strip of paint and a few balls between them
  looks(s, r) {
    s.env = 'day';
    s.yaw = Math.PI / 2; s.pitch = -0.5;
    s.cam = [CX, FLOOR + 17, CX - 26];
    const sc = s.scene;
    sc.box(CX, FLOOR - 0.5, CX, 22, 0.5, 14, 0, 0.78, 0.8, 0.84, LOOK.MATTE);
    const names = ['MATTE', 'PLASTIC', 'ICE', 'METAL', 'HAZARD', 'GLOW', 'PAINT', 'CHECKER', 'WOOD', 'RUBBER'];
    const cols = [[0.85, 0.45, 0.35], [0.2, 0.55, 1.0], [0.72, 0.9, 1.0], [0.85, 0.87, 0.9], [1.0, 0.78, 0.08], [1.0, 0.35, 0.75], [0.9, 0.9, 0.88], [0.95, 0.95, 0.95], [0.72, 0.47, 0.27], [0.85, 0.15, 0.12]];
    const pa = [0, 0, 0.75, 0, 0.35, 1, 0, 0.5, 0, 0];
    const pb = [0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0];
    for (let k = 0; k < 10; k++) {
      const x = CX + 18 - k * 4;
      const [cr, cg, cb] = cols[k];
      sc.box(x, FLOOR + 0.8, CX + 7, 1.3, 0.8, 1.3, 0.3, cr, cg, cb, k, pa[k], pb[k]);
      sc.cyl(x, FLOOR + 1.0, CX + 2.5, 1.35, 1.0, cr, cg, cb, k, pa[k], pb[k]);
      sc.hex(x, FLOOR + 0.35, CX - 2, 1.6, 0.35, 0, cr, cg, cb, k, pa[k], pb[k]);
      sc.sphere(x, FLOOR + 1.3, CX - 6.5, 1.3, cr, cg, cb, k, pa[k], pb[k]);
      label(s, r, [x, FLOOR + 2.2, CX + 9.2], names[k], k === 5 ? C.PURPLE : C.WHITE);
    }
    // the paint layer: stripes of slot colours over the PAINT column
    const n = 64, cells = new Uint8Array(n * n), palette = new Float32Array(1024);
    for (let i = 1; i < 256; i++) palette.set([...slotColor(i - 1), 1], i * 4);
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      const wx = x / n * 32 - 16, wz = z / n * 32 - 16;
      const blob = Math.sin(wx * 0.9) + Math.cos(wz * 1.1) + Math.sin((wx + wz) * 0.5);
      cells[z * n + x] = blob > 0.6 ? 1 + ((Math.floor(wx / 2) + Math.floor(wz / 3)) & 7) * 31 % 255 : 0;
    }
    s.paint = { cells, n, origin: [CX - 6 - 16, CX - 16], size: 32, palette, version: 1 };
    const rand = rng(3);
    for (let k = 0; k < 9; k++) ball(s, k, CX - 16 + k * 4, FLOOR, CX - 10.5 + rand() * 1.5, { vel: [rand() * 6 - 3, 0, 4], roll: rand() * 9, own: k === 4, face: Math.PI / 2 });
    s.decals.push({ pos: [CX - 9, FLOOR, CX - 11], radius: 1.6, width: 0.25, color: [1, 0.85, 0.3, 0.9], kind: DECAL.RING });
    s.decals.push({ pos: [CX - 1, FLOOR, CX - 11], radius: 1.6, width: 0.3, color: [0.4, 1, 0.5, 0.8], kind: DECAL.DISC });
    s.decals.push({ pos: [CX + 7, FLOOR, CX - 11], radius: 1.8, width: 0.3, color: [0.4, 0.8, 1, 0.9], kind: DECAL.ZONE });
    s.decals.push({ pos: [CX + 15, FLOOR, CX - 11], radius: 1.6, width: 0.22, color: [1, 0.3, 0.25, 0.95], kind: DECAL.TARGET });
    s.slot = 4;
    s.focus = [CX, CX]; s.extent = 24;
    s.mini[3] = 24; s.miniShape = 'square';
    title(s, r, 'EVERY LOOK ON EVERY SHAPE', 'BOX  CYLINDER  HEX  SPHERE   DECALS: RING DISC ZONE TARGET');
  },

  // three floors of hex ice, cracking under the crowd; tiles that went, tiles going
  thinice(s, r) {
    s.env = 'snow';
    const sc = s.scene, rand = rng(11);
    const R = 12 + 3.2 * Math.sqrt(64);
    const layers = [FLOOR, FLOOR - 12, FLOOR - 24];
    layers.forEach((y, li) => {
      for (const [x, z] of hexes(R, 2)) {
        const u = rand();
        const gone = li === 0 ? u < 0.16 : u < 0.06;
        if (gone) {
          if (u < 0.02 && li === 0) sc.hex(x, y - 0.25 - 3 - rand() * 4, z, 1.94, 0.25, 0, 0.75, 0.9, 1.0, LOOK.ICE, 1);
          continue;
        }
        const crack = li === 0 && rand() < 0.2 ? 0.15 + rand() * 0.85 : 0;
        sc.hex(x, y - 0.25, z, 1.94, 0.25, 0, li === 0 ? 0.74 : 0.66, li === 0 ? 0.9 : 0.85, 1.0, LOOK.ICE, crack, li * 0.3);
      }
    });
    crowd(s, 60, R - 4, FLOOR, rand);
    for (let k = 60; k < 64; k++) ball(s, k, CX + (rand() - 0.5) * 30, FLOOR - 12, CX + (rand() - 0.5) * 30, { vel: [rand() * 4, 0, rand() * 4], roll: rand() * 9 });
    ball(s, 64, CX + 2, FLOOR, CX - 6, { vel: [0, 0, 5], roll: 2, own: true, face: Math.PI / 2 });
    s.slot = 64;
    chase(s, [CX + 2, FLOOR + 1, CX - 6], Math.PI / 2 - 0.15);
    s.extent = R + 2; s.mini[3] = R + 2;
    title(s, r, 'THIN ICE', '61 OF 65 LEFT');
  },

  // a floor of four colours; the call is BLUE: every other colour drops away
  colorcall(s, r) {
    s.env = 'day';
    const sc = s.scene, rand = rng(5);
    const COLORS = [[1, 0.3, 0.28], [0.25, 0.55, 1], [1, 0.82, 0.15], [0.3, 0.85, 0.35]];
    const R = 34;
    for (const [x, z, qq, rr] of hexes(R, 2)) {
      const k = (((qq * 7 + rr * 13 + Math.floor(rand() * 4)) % 4) + 4) % 4;
      const drop = k !== 1 ? 0.6 + rand() * 1.4 : 0;
      const c = COLORS[k];
      sc.hex(x, FLOOR - 0.3 - drop, z, 1.95, 0.3, 0, ...c, LOOK.PLASTIC, 0, 0, 1);
    }
    crowd(s, 127, R - 2, FLOOR, rand);
    ball(s, 127, CX - 3, FLOOR, CX - 8, { vel: [1, 0, 5], roll: 1, own: true, face: Math.PI / 2 });
    s.slot = 127;
    chase(s, [CX - 3, FLOOR + 1, CX - 8], Math.PI / 2 + 0.1, { back: 11, pitch: -0.5 });
    s.extent = R + 2; s.mini[3] = R + 2;
    title(s, r, 'BLUE!', 'COLOR CALL  128 LEFT', C.CYAN);
  },

  // a checkered disc at sunset, hazard beams sweeping round a metal post
  sweeper(s, r) {
    s.env = 'sunset';
    const sc = s.scene, rand = rng(7);
    const R = 26;
    sc.cyl(CX, FLOOR - 1, CX, R, 1, 0.92, 0.9, 0.85, LOOK.CHECKER, 2, 0.55);
    sc.cyl(CX, FLOOR - 1.6, CX, R + 0.4, 1.2, 0.3, 0.32, 0.38, LOOK.METAL);
    for (let k = 0; k < 48; k++) {
      const a = k / 48 * Math.PI * 2;
      sc.cyl(CX + Math.cos(a) * (R + 0.2), FLOOR + 0.2, CX + Math.sin(a) * (R + 0.2), 0.45, 0.25, 0.9, 0.12, 0.1, LOOK.RUBBER);
    }
    sc.cyl(CX, FLOOR + 1.5, CX, 1.4, 1.5, 0.75, 0.78, 0.82, LOOK.METAL);
    sc.cyl(CX, FLOOR + 3.2, CX, 0.9, 0.2, 1, 0.3, 0.2, LOOK.GLOW, 1);
    for (let k = 0; k < 3; k++) {
      const a = 0.4 + k * 2.094;
      const L2 = R / 2;
      sc.box(CX + Math.cos(a) * (L2 + 0.7), FLOOR + 0.9, CX + Math.sin(a) * (L2 + 0.7), L2, 0.35, 0.35, a, 1, 0.75, 0.1, LOOK.HAZARD, 0.45, 0, 1, k + 1);
    }
    crowd(s, 47, R - 2, FLOOR, rand);
    ball(s, 47, CX - 4, FLOOR + 1.2, CX - 14, { vel: [2, 3, 6], roll: 1, own: true, face: Math.PI / 2 });
    s.slot = 47;
    chase(s, [CX - 4, FLOOR + 1, CX - 14], Math.PI / 2 + 0.2, { back: 10, pitch: -0.38 });
    s.extent = R + 4; s.mini[3] = R + 2;
    title(s, r, 'SWEEPER', 'HOP THE BEAMS  48 LEFT', C.ORANGE);
  },

  // night: bombs fall where the targets say; the rim crumbling
  bombs(s, r) {
    s.env = 'night';
    const sc = s.scene, rand = rng(13);
    const R = 30;
    for (const [x, z] of hexes(R, 2.5)) {
      const d = Math.hypot(x - CX, z - CX);
      if (d > R - 3 && rand() < 0.5) continue;
      sc.hex(x, FLOOR - 0.5, z, 2.46, 0.5, 0, 0.32, 0.36, 0.52, LOOK.MATTE);
    }
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2;
      sc.cyl(CX + Math.cos(a) * (R - 1), FLOOR + 1.5, CX + Math.sin(a) * (R - 1), 0.3, 1.5, 0.3, 0.3, 0.35, LOOK.METAL);
      sc.sphere(CX + Math.cos(a) * (R - 1), FLOOR + 3.3, CX + Math.sin(a) * (R - 1), 0.45, [1, 0.5, 0.2][k % 3], [0.6, 0.9, 0.4][k % 3], [0.2, 1, 0.9][k % 3], LOOK.GLOW, 1.2);
    }
    for (let k = 0; k < 16; k++) {
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * (R - 4);
      const x = CX + Math.cos(a) * d, z = CX + Math.sin(a) * d;
      const h = 2 + rand() * 18;
      s.decals.push({ pos: [x, FLOOR, z], radius: 1.4 + h * 0.08, width: 0.22, color: [1, 0.3, 0.2, 0.95], kind: DECAL.TARGET });
      s.solid.push({ pos: [x, FLOOR + h, z], size: 0.55, color: [0.12, 0.12, 0.14, 1], kind: SPRITE.BOMB, minpx: 2, seed: k, roll: h < 5 ? 0.8 : 0 });
      s.beams.push({ a: [x, FLOOR + h, z], b: [x, FLOOR, z], width: 0.05, color: [1, 0.35, 0.2, 0.3] });
      s.casters.push([x, FLOOR + h, z, -0.55]);
    }
    crowd(s, 63, R - 4, FLOOR, rand);
    for (let k = 0; k < 3; k++) {
      const p = [CX + (rand() - 0.5) * 30, FLOOR + 0.8, CX + (rand() - 0.5) * 30];
      s.glow.push({ pos: p, size: 3, color: [1, 0.85, 0.4, 0.6], kind: SPRITE.RING, minpx: 1 });
      s.glow.push({ pos: p, size: 1.8, color: [1, 0.6, 0.2, 1], kind: SPRITE.FLASH, minpx: 1 });
    }
    ball(s, 63, CX + 2, FLOOR, CX - 12, { vel: [0, 0, 5], roll: 1, own: true, face: Math.PI / 2 + 0.1 });
    s.slot = 63;
    chase(s, [CX + 2, FLOOR + 1, CX - 12], Math.PI / 2 + 0.1, { back: 10, pitch: -0.45 });
    s.extent = R + 2; s.mini[3] = R + 2;
    title(s, r, 'BOMB RAIN', 'WATCH THE RINGS  64 LEFT', C.RED);
  },

  // a round stage painted by everyone rolling over it
  paint(s, r) {
    s.env = 'day';
    const sc = s.scene, rand = rng(17);
    const R = 30;
    sc.cyl(CX, FLOOR - 1, CX, R, 1, 0.92, 0.92, 0.9, LOOK.PAINT);
    sc.cyl(CX, FLOOR - 1.2, CX, R + 0.5, 1.1, 0.25, 0.25, 0.3, LOOK.PLASTIC);
    const n = 128, cells = new Uint8Array(n * n), palette = new Float32Array(1024);
    for (let i = 0; i < 32; i++) palette.set([...slotColor(i), 1], (i + 1) * 4);
    const cellOf = (x, z) => [Math.floor((x - CX + R) / (2 * R) * n), Math.floor((z - CX + R) / (2 * R) * n)];
    const paintAt = (x, z, rad, v) => {
      const [i, j] = cellOf(x, z), cr = Math.ceil(rad / (2 * R) * n);
      for (let b = -cr; b <= cr; b++) for (let a = -cr; a <= cr; a++) if (a * a + b * b <= cr * cr && i + a >= 0 && j + b >= 0 && i + a < n && j + b < n) cells[(j + b) * n + i + a] = v;
    };
    for (let p = 0; p < 32; p++) {
      let x = CX + (rand() - 0.5) * 40, z = CX + (rand() - 0.5) * 40, h = rand() * 6.3;
      for (let k = 0; k < 220; k++) {
        h += (rand() - 0.5) * 0.5;
        x += Math.cos(h) * 0.5; z += Math.sin(h) * 0.5;
        if (Math.hypot(x - CX, z - CX) > R - 1) h += Math.PI;
        paintAt(x, z, 1.1, p + 1);
      }
      ball(s, p, x, FLOOR, z, { vel: [Math.cos(h) * 6, 0, Math.sin(h) * 6], roll: rand() * 20, own: p === 0 });
    }
    s.paint = { cells, n, origin: [CX - R, CX - R], size: 2 * R, palette, version: 1 };
    const me = s.casters[0];
    s.slot = 0;
    chase(s, [me[0], FLOOR + 1, me[2]], Math.atan2(CX - me[2], CX - me[0]), { back: 14, pitch: -0.62 });
    s.extent = R + 2; s.mini[3] = R + 2;
    title(s, r, 'PAINT PARTY', 'MOST CELLS WINS', C.GREEN);
  },

  // 256 balls on one big disc, a hill zone glowing in the middle: readable at a glance?
  crowd(s, r) {
    s.env = 'day';
    const sc = s.scene, rand = rng(23);
    const R = 16 + 3.5 * 16;
    sc.cyl(CX, FLOOR - 1.5, CX, R, 1.5, 0.98, 0.86, 0.5, LOOK.MATTE);
    sc.cyl(CX, FLOOR - 1.7, CX, R + 0.6, 1.4, 0.95, 0.55, 0.2, LOOK.PLASTIC);
    s.decals.push({ pos: [CX + 6, FLOOR, CX + 4], radius: 9, width: 0.6, color: [0.3, 0.9, 1, 0.9], kind: DECAL.ZONE });
    s.decals.push({ pos: [CX - 30, FLOOR, CX + 22], radius: 9, width: 0.35, color: [1, 1, 1, 0.45], kind: DECAL.RING });
    crowd(s, 255, R - 2, FLOOR, rand);
    ball(s, 255, CX - 2, FLOOR, CX - 10, { vel: [2, 0, 6], roll: 1, own: true, face: Math.PI / 2 });
    s.slot = 255;
    chase(s, [CX - 2, FLOOR + 1, CX - 10], Math.PI / 2 + 0.25, { back: 10, pitch: -0.36 });
    s.extent = 40; s.focus = [CX, CX]; s.mini[3] = R * 1.04;
    title(s, r, 'KING OF THE HILL', '256 IN THE ROOM', C.CYAN);
  },

  // a square stage at sunset, a wall of blocks sweeping across with gaps in it
  wall(s, r) {
    s.env = 'sunset';
    const sc = s.scene, rand = rng(29);
    const half = 24;
    sc.box(CX, FLOOR - 1, CX, half, 1, half, 0, 0.62, 0.42, 0.24, LOOK.WOOD);
    for (const sgn of [-1, 1]) {
      sc.box(CX + sgn * (half + 0.3), FLOOR - 0.7, CX, 0.3, 1.3, half + 0.6, 0, 1, 0.78, 0.08, LOOK.HAZARD, 0.6);
      sc.box(CX, FLOOR - 0.7, CX + sgn * (half + 0.3), half, 1.3, 0.3, 0, 1, 0.78, 0.08, LOOK.HAZARD, 0.6);
    }
    for (let w = 0; w < 2; w++) {
      const x = CX - 6 + w * 22;
      const gaps = new Set([Math.floor(rand() * 12), Math.floor(rand() * 12), Math.floor(rand() * 12)]);
      for (let k = 0; k < 12; k++) {
        if (gaps.has(k)) continue;
        sc.box(x, FLOOR + 1.6, CX - half + 2 + k * 4, 0.9, 1.6, 1.95, 0, w ? 0.25 : 0.9, w ? 0.6 : 0.2, w ? 0.95 : 0.25, w ? LOOK.METAL : LOOK.RUBBER, 0, 0, 1, 100 + k);
        sc.box(x, FLOOR + 3.3, CX - half + 2 + k * 4, 0.95, 0.12, 2.0, 0, 1, 0.8, 0.1, LOOK.GLOW, 0.8, 0, 1, 200 + k);
      }
    }
    crowd(s, 63, half - 3, FLOOR, rand, { cx: CX - 10, skip: (x) => Math.abs(x - (CX - 6)) < 2.5 });
    ball(s, 63, CX - 14, FLOOR, CX + 1, { vel: [5, 0, 0], roll: 1, own: true, face: 0 });
    s.slot = 63;
    chase(s, [CX - 14, FLOOR + 1, CX + 1], 0.15, { back: 10, pitch: -0.4 });
    s.extent = half + 2; s.mini[3] = half + 1; s.miniShape = 'square';
    title(s, r, 'THE WALL', 'FIND A GAP  64 LEFT', C.ORANGE);
  },

  // night: the music stopped, the pads light up
  pads(s, r) {
    s.env = 'night';
    const sc = s.scene, rand = rng(31);
    const R = 28;
    sc.cyl(CX, FLOOR - 1, CX, R, 1, 0.16, 0.16, 0.22, LOOK.PLASTIC);
    sc.cyl(CX, FLOOR - 0.95, CX, R + 0.3, 0.9, 0.5, 0.2, 0.9, LOOK.GLOW, 0.7);
    const pads = [];
    for (let k = 0; k < 16; k++) {
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * (R - 4);
      pads.push([CX + Math.cos(a) * d, CX + Math.sin(a) * d]);
    }
    pads.forEach(([x, z], k) => {
      const c = [[0.2, 1, 0.5], [1, 0.4, 0.8], [0.3, 0.7, 1], [1, 0.8, 0.2]][k % 4];
      sc.cyl(x, FLOOR + 0.06, z, 2.2, 0.06, ...c, LOOK.GLOW, k < 12 ? 1 : 0.1, 1);
      if (k < 12) s.decals.push({ pos: [x, FLOOR + 0.12, z], radius: 2.8, width: 0.25, color: [...c, 0.9], kind: DECAL.ZONE });
    });
    crowd(s, 31, R - 3, FLOOR, rand);
    ball(s, 31, CX, FLOOR, CX - 14, { vel: [1, 0, 6], roll: 1, own: true, face: Math.PI / 2 });
    s.slot = 31;
    chase(s, [CX, FLOOR + 1, CX - 14], Math.PI / 2, { back: 11, pitch: -0.5 });
    s.extent = R + 2; s.mini[3] = R + 2;
    title(s, r, 'MUSICAL PADS', 'GET ON A PAD  32 LEFT', C.PURPLE);
  },

  // coins raining onto plastic platforms, a bomb passed round
  coins(s, r) {
    s.env = 'day';
    const sc = s.scene, rand = rng(37);
    const R = 24;
    sc.cyl(CX, FLOOR - 1, CX, R, 1, 0.45, 0.8, 0.95, LOOK.PLASTIC);
    sc.cyl(CX, FLOOR - 1.1, CX, R + 0.4, 1, 1, 1, 1, LOOK.PLASTIC);
    for (let k = 0; k < 5; k++) {
      const a = k / 5 * Math.PI * 2 + 0.3;
      sc.cyl(CX + Math.cos(a) * 13, FLOOR + 0.4, CX + Math.sin(a) * 13, 3.2, 0.4, [1, 0.4, 0.3, 0.3, 0.8][k], [0.4, 0.8, 0.9, 0.7, 0.4][k], [0.3, 0.3, 0.3, 1, 1][k], LOOK.PLASTIC);
    }
    for (let k = 0; k < 40; k++) {
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * (R - 2);
      const x = CX + Math.cos(a) * d, z = CX + Math.sin(a) * d;
      const h = k < 14 ? 2 + rand() * 14 : 0.45;
      s.solid.push({ pos: [x, FLOOR + h, z], size: 0.45, color: [1, 0.8, 0.22, 1], kind: SPRITE.COIN, minpx: 2, seed: k });
      s.casters.push([x, FLOOR + h, z, -0.4]);
      if (k < 14) s.beams.push({ a: [x, FLOOR + h, z], b: [x, FLOOR, z], width: 0.04, color: [1, 0.85, 0.3, 0.25] });
    }
    const n0 = s.casters.length;
    crowd(s, 23, R - 3, FLOOR, rand, { from: n0 });
    const me = n0 + 23;
    ball(s, me, CX - 3, FLOOR, CX - 9, { vel: [0, 0, 5], roll: 1, own: true, face: Math.PI / 2 });
    const holder = s.casters[n0 + 2];
    s.solid.push({ pos: [holder[0], holder[1] + 4.1, holder[2]], size: 0.5, color: [0.12, 0.12, 0.14, 1], kind: SPRITE.BOMB, minpx: 2, roll: 0.9 });
    s.slot = me;
    chase(s, [CX - 3, FLOOR + 1, CX - 9], Math.PI / 2, { back: 9, pitch: -0.4 });
    s.extent = R + 2; s.mini[3] = R + 2;
    title(s, r, 'COIN RUSH', 'COINS 12', C.YELLOW);
  },

  // a long field to a finish line; the doll at the far end
  redlight(s, r) {
    s.env = 'sunset';
    const sc = s.scene, rand = rng(41);
    const len = 160, wid = 20;
    for (let k = 0; k < 16; k++) sc.box(CX, FLOOR - 1, CX - len / 2 + 5 + k * 10, wid, 1, 5, 0, k % 2 ? 0.42 : 0.47, k % 2 ? 0.7 : 0.75, 0.3, LOOK.MATTE);
    sc.box(CX, FLOOR + 0.01, CX + len / 2 - 14, wid, 0.02, 1.2, 0, 0.05, 0.05, 0.05, LOOK.CHECKER, 0.8, 0, 1);
    for (const sgn of [-1, 1]) sc.box(CX + sgn * (wid + 0.4), FLOOR + 0.6, CX, 0.4, 1.6, len / 2, 0, 0.6, 0.38, 0.22, LOOK.WOOD);
    // the doll: a dress, a body, a head with pigtails, facing the field
    const dz = CX + len / 2 - 4;
    sc.cyl(CX, FLOOR + 3, dz, 3, 3, 1, 0.55, 0.15, LOOK.PLASTIC);
    sc.cyl(CX, FLOOR + 7.5, dz, 1.8, 1.5, 1, 0.85, 0.3, LOOK.PLASTIC);
    sc.sphere(CX, FLOOR + 11, dz, 2.3, 1, 0.82, 0.66, LOOK.PLASTIC);
    sc.sphere(CX, FLOOR + 11.8, dz + 0.3, 2.35, 0.1, 0.08, 0.06, LOOK.PLASTIC);
    for (const sgn of [-1, 1]) {
      sc.sphere(CX + sgn * 2.4, FLOOR + 11.5, dz + 0.5, 0.9, 0.1, 0.08, 0.06, LOOK.PLASTIC);
      sc.sphere(CX + sgn * 0.8, FLOOR + 11.3, dz - 2.05, 0.32, 1, 0.15, 0.1, LOOK.GLOW, 1.5);
    }
    crowd(s, 40, 1, FLOOR, rand, { cz: CX - 30 });
    for (let p = 0; p < 40; p++) { const c = s.casters[p]; c[0] = CX + (rand() - 0.5) * 2 * (wid - 2); c[2] = CX - 60 + rand() * 70; s.solid[p * 3].pos = [c[0], c[1] + 1, c[2]]; s.solid[p * 3 + 1].pos = [c[0], c[1] + 2.22, c[2]]; s.solid[p * 3 + 2].pos = [c[0], c[1] + 2.78, c[2]]; }
    ball(s, 40, CX + 1, FLOOR, CX - 30, { vel: [0, 0, 7], roll: 1, own: true, face: Math.PI / 2 });
    s.slot = 40;
    chase(s, [CX + 1, FLOOR + 1, CX - 30], Math.PI / 2, { back: 11, pitch: -0.3 });
    s.focus = [CX, CX]; s.extent = 82; s.mini[3] = 82; s.miniShape = 'square';
    title(s, r, 'RED LIGHT', 'GREEN: ROLL', C.GREEN);
  },

  // see-through solids: ice and glass over things behind
  glass(s, r) {
    s.env = 'day';
    const sc = s.scene, rand = rng(43);
    sc.box(CX, FLOOR - 0.5, CX, 18, 0.5, 18, 0, 0.9, 0.9, 0.92, LOOK.CHECKER, 1, 0.6);
    for (let k = 0; k < 6; k++) {
      const x = CX - 10 + k * 4;
      sc.sphere(x, FLOOR + 1, CX + 4, 1, ...slotColor(k), LOOK.PLASTIC);
      sc.box(x, FLOOR + 1.5, CX + 1, 1.6, 1.5, 0.3, 0, ...[[0.7, 0.9, 1], [1, 0.5, 0.5], [0.6, 1, 0.6], [1, 1, 0.6], [0.8, 0.6, 1], [1, 1, 1]][k], k % 2 ? LOOK.PLASTIC : LOOK.ICE, k % 2 ? 0 : 0.5, 0, 0.35 + k * 0.08);
    }
    sc.hex(CX, FLOOR + 3.5, CX - 4, 3, 0.4, 0, 0.7, 0.9, 1, LOOK.ICE, 0.3, 0, 0.5);
    crowd(s, 8, 6, FLOOR, rand, { cz: CX - 6 });
    s.yaw = Math.PI / 2; s.pitch = -0.32;
    s.cam = [CX, FLOOR + 7, CX - 18];
    s.extent = 20; s.mini[3] = 20; s.miniShape = 'square';
    title(s, r, 'SEE-THROUGH', 'ALPHA UNDER 1: DRAWN AFTER, DEPTH-TESTED, NOT WRITTEN');
  },

  // ice cracking, a from 0 to 1 along each row; the back row frosted over (b 0.6)
  cracks(s, r) {
    s.env = 'snow';
    s.yaw = Math.PI / 2; s.pitch = -0.75;
    s.cam = [CX, FLOOR + 11, CX - 9];
    const sc = s.scene;
    for (let row = 0; row < 2; row++) {
      for (let k = 0; k < 6; k++) {
        const [x, z] = hexCentre(k - 3 + (row ? 0 : 0), row * 2 - 1, 2);
        const a = (k + 1) / 6 * (row ? 1 : 0.84) - (row ? 0 : 0.14);
        sc.hex(x, FLOOR - 0.25, z, 1.94, 0.25, 0, 0.74, 0.9, 1.0, LOOK.ICE, Math.max(0, a), row ? 0.6 : 0, 1, 7 + k);
        label(s, r, [x, FLOOR, z + (row ? 1.2 : -1.6)], `A ${Math.max(0, a).toFixed(2)}`, C.GREY);
      }
    }
    s.extent = 12; s.mini = null;
    title(s, r, 'THIN ICE CRACKING', 'A 0 TO 1  (BACK ROW: FROST B 0.6)');
  },

  // the sky: a little stage, looking out toward the sun (or the moon) low over the sea
  horizon(s, r, env) {
    s.env = env || 'day';
    const sc = s.scene, rand = rng(53);
    sc.cyl(CX, FLOOR - 1, CX, 14, 1, 0.95, 0.75, 0.45, LOOK.WOOD);
    sc.cyl(CX, FLOOR + 0.8, CX + 6, 0.8, 0.8, 1, 0.3, 0.2, LOOK.GLOW, 1);
    sc.box(CX - 5, FLOOR + 0.7, CX + 3, 1.2, 0.7, 1.2, 0.4, 0.85, 0.87, 0.9, LOOK.METAL);
    crowd(s, 12, 10, FLOOR, rand);
    const sun = (ENVS[s.env] || ENVS.day).sun;
    const yaw = Math.atan2(sun[2], sun[0]) + 0.35;
    s.yaw = yaw; s.pitch = 0.1;
    s.cam = [CX - 22 * Math.cos(yaw), FLOOR + 5, CX - 22 * Math.sin(yaw)];
    s.extent = 16; s.mini = null;
    title(s, r, 'THE SKY');
  },

  // 20,000 solids and 256 balls
  stress(s, r) {
    s.env = 'day';
    const sc = s.scene, rand = rng(47);
    const R = 100;
    sc.box(CX, FLOOR - 1, CX, R, 1, R, 0, 0.5, 0.55, 0.6, LOOK.CHECKER, 4, 0.7);
    while (sc.count < 20000) {
      const x = CX + (rand() * 2 - 1) * (R - 2), z = CX + (rand() * 2 - 1) * (R - 2);
      if (Math.abs(x - CX) < 14 && Math.abs(z - CX) < 14) continue;
      const k = sc.count % 4, look = Math.floor(rand() * 10), c = slotColor(sc.count);
      const h = 0.3 + rand() * rand() * 4;
      if (k === 0) sc.box(x, FLOOR + h, z, 0.3 + rand() * 0.6, h, 0.3 + rand() * 0.6, rand() * 6, ...c, look, rand());
      else if (k === 1) sc.cyl(x, FLOOR + h, z, 0.3 + rand() * 0.5, h, ...c, look, rand());
      else if (k === 2) sc.hex(x, FLOOR + h * 0.3, z, 0.6 + rand() * 0.5, h * 0.3, 0, ...c, look, rand());
      else sc.sphere(x, FLOOR + 0.5, z, 0.5, ...c, look, rand());
    }
    crowd(s, 255, 13, FLOOR, rand);
    ball(s, 255, CX, FLOOR, CX - 12, { vel: [0, 0, 5], roll: 1, own: true, face: Math.PI / 2 });
    s.slot = 255;
    chase(s, [CX, FLOOR + 1, CX - 12], Math.PI / 2 + 0.3, { back: 12, pitch: -0.35, lift: 3 });
    s.extent = 50; s.mini[3] = 60;
    title(s, r, `STRESS  ${sc.count} SOLIDS  256 BALLS`);
  },
};

async function main() {
  [canvas.width, canvas.height] = q.has('res') ? q.get('res').split('x').map(Number) : [Math.min(1600, innerWidth * devicePixelRatio) | 0, Math.min(1000, innerHeight * devicePixelRatio) | 0];
  const W = canvas.width, H = canvas.height;
  const HS = Math.max(1, Math.round(H / 240));
  const r = await createRenderer(canvas, { present: q.get('present') !== '0', hudScale: HS });
  const names = Object.keys(SCENES);
  const build = (name, time) => {
    const [scene, env] = name.split('@');
    const [base, view] = scene.split('~');
    const s = frameState(W, H, HS);
    s.text = new Uint32Array(COLS * r.rows);
    SCENES[base](s, r, env);
    if (env) s.env = env;
    // ~over: the frontends' view when there is nobody to follow, high over the stage's edge
    if (view === 'over') {
      const R = s.mini ? s.mini[3] : s.extent;
      s.yaw = 0.8 + Math.PI; s.pitch = -0.62;
      s.cam = [s.focus[0] + Math.cos(0.8) * R * 1.3, FLOOR + R * 0.95, s.focus[1] + Math.sin(0.8) * R * 1.3];
    }
    s.time = time;
    put(s.text, COLS, 1, r.rows - 1, `${base.toUpperCase()}  ${s.env.toUpperCase()}  ${s.scene.count} SOLIDS  ${s.casters.length} CASTERS  ${s.solid.length + s.glow.length} SPRITES`, C.GREY);
    return s;
  };
  // a frame read back as a PNG (base64), headless Chrome can't composite WebGPU
  const png = async (s) => {
    const { width, height, rgba } = await r.capture(null, s);
    const c = new OffscreenCanvas(width, height);
    c.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
    const out = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let bin = '';
    for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode(...out.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  let t = 100;
  window.__demo = {
    names,
    ready: true,
    // the main thread's cost of a frame (building the scene is the frontend's, not counted): n frames into a texture
    async bench(name, n = 20) {
      const s = build(name, 1000);
      const tex = r.device.createTexture({ size: [W, H], format: navigator.gpu.getPreferredCanvasFormat(), usage: GPUTextureUsage.RENDER_ATTACHMENT });
      const ms = [];
      for (let k = 0; k < n; k++) {
        s.time = 1000 + k / 60;
        const t0 = performance.now();
        r.frame(null, s, tex);
        ms.push(performance.now() - t0);
        if (k % 5 === 4) await r.device.queue.onSubmittedWorkDone();
      }
      await r.device.queue.onSubmittedWorkDone();
      tex.destroy();
      ms.sort((a, b) => a - b);
      return { median: ms[n >> 1], best: ms[0], solids: s.scene.count, sprites: s.solid.length + s.glow.length };
    },
    async shot(name) {
      t += 10;
      const s = build(name, t);
      const t0 = performance.now();
      const out = await png(s);
      return { png: out, ms: performance.now() - t0, solids: s.scene.count };
    },
  };
  note.textContent = `${names.join(' ')}  (click for the next)`;
  if (q.get('present') === '0') return;
  let k = Math.max(0, names.indexOf((q.get('scene') || 'looks').split('@')[0]));
  let name = q.get('scene') || names[k];
  canvas.addEventListener('click', () => { k = (k + 1) % names.length; name = names[k] + (q.get('env') ? '@' + q.get('env') : ''); note.textContent = name; });
  if (q.get('env') && !name.includes('@')) name += '@' + q.get('env');
  let s = null, built = null;
  const loop = (now) => {
    requestAnimationFrame(loop);
    if (built !== name) { s = build(name, now / 1000); built = name; }
    s.time = now / 1000;
    r.frame(null, s);
  };
  requestAnimationFrame(loop);
}

main().catch((e) => {
  note.textContent = String(e?.message || e);
  window.__demo = { error: String(e?.stack || e) };
});
