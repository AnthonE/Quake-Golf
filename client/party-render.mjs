// Party's WebGPU renderer: bumper balls' look for any stage. Drawn at the
// window's own resolution with 4x multisampling, lit by a sun (a moon at
// night) and a sky, tone-mapped, over the sea far below with clouds in the
// sky. The stage is a Scene: boxes, cylinders, hex prisms and spheres packed
// 16 floats a solid, drawn instanced, one draw per shape (and one more per
// shape for the see-through ones, after the rest). Every solid has a look
// (matte, plastic, ice, metal, hazard stripes, glow, paint, checker, wood,
// rubber), a rounded bevel and a soft ink line on its edges. One shadow map
// from the sun covers the action's square (s.focus, s.extent): the solids and
// the balls cast into it (a ball and its rider as spheres) and everything
// samples it soft, the sea included. Decals are flat glowing rings and discs.
// The paint layer is a grid of colour indices over the floor, uploaded when
// its version changes. The balls are bumper's impostors (beach-ball stripes
// turning as they roll, an ink outline, a rider), with its orbs, rockets and
// flashes, and coins and bombs besides; beams, the HUD's 3x5 font, rects and
// the net graph as bumper's. The minimap is the stage drawn from above each
// frame into a small texture with every caster as a dot. Nothing loops over
// solids per pixel. Nothing here is hashed.
import * as L from '../src/layout.mjs';
import { FONT } from './font.mjs';
import { GRAPH_N, GRAPH_PANELS } from './netgraph.mjs';

export const COLS = 80;
export const MAX_SPRITE = 4096;
export const MAX_BEAM = 256;
export const MAX_RECT = 64;
export const MAX_DECAL = 1024;
export const MAX_CASTER = 1024;
export const MAX_BIG = 4; // lines of big text (s.big)
export const BIG_CHARS = 32; // characters a big line
const BIG_WORDS = 4 + BIG_CHARS / 4;
const MSAA = 4;
const NEAR = 0.05; // reversed depth, the far plane at infinity: depth = NEAR / view z
const SHADOW_N = 2048;
const MAP_N = 512;
const MASK_N = 512;
const FLAKES = 4000;

// sprite kinds: solid 0 a ball, 1 a rider's body, 2 an orb, 6 the arrow over you, 7 a rocket, 8 a rider's head, 9 a crumb,
// 10 a spinning coin, 11 a bomb; glowing 3 a flash, 4 a ring, 5 a spark
export const SPRITE = { BALL: 0, BODY: 1, ORB: 2, FLASH: 3, RING: 4, SPARK: 5, ARROW: 6, ROCKET: 7, HEAD: 8, CRUMB: 9, COIN: 10, BOMB: 11 };
export const SHAPE = { BOX: 0, CYL: 1, HEX: 2, SPHERE: 3 };
// The looks, and what their two parameters a and b do (0 takes the default):
//   MATTE    paint with a little grain
//   PLASTIC  a toy's gloss
//   ICE      a: cracks, 0 whole to 1 shattered (they spread out from the middle, wider, and the ice whitens);
//            b: frost, 0 clear to 1 packed snow
//   METAL    brushed along the solid's longer side, the sky and its clouds in it
//   HAZARD   stripes a wide (0.5 m) across the solid's own frame, its colour and black
//   GLOW     lit by a (0 off, 1 bright, past 1 white-hot); b takes the light out to its edges, a neon panel
//   PAINT    the paint layer (s.paint) on its top faces, over its own colour
//   CHECKER  squares a a side (1 m) in the world, its colour and the opposite; b softens the opposite toward it
//   WOOD     planks a wide (0.32 m) along its longer side, grain, seams
//   RUBBER   rough, a faint sheen, a fine pebbly grain
export const LOOK = { MATTE: 0, PLASTIC: 1, ICE: 2, METAL: 3, HAZARD: 4, GLOW: 5, PAINT: 6, CHECKER: 7, WOOD: 8, RUBBER: 9 };
// decal kinds: 0 a ring (its outer edge at radius, width inward), 1 a disc, 2 a zone (a faint disc, a bright rim, ripples going in), 3 a target (a ring, a dot, four ticks)
export const DECAL = { RING: 0, DISC: 1, ZONE: 2, TARGET: 3 };

// A stage as solids, 16 floats each:
//   x, y, z (the centre), shape | half extents x, y, z (radius, half height, radius for the round ones), yaw |
//   r, g, b (0..1, sRGB), look | a, b (the look's two parameters), alpha, seed (varies a look's pattern)
// Filled again every frame without garbage: clear(), then a call per solid.
export class Scene {
  constructor(max = 24000) {
    this.max = max;
    this.data = new Float32Array(max * 16);
    this.n = 0;
  }
  clear() { this.n = 0; }
  get count() { return this.n; }
  // The seed, when none is given, comes from where the solid stands (to an eighth of a metre in x and z), so a
  // still or falling solid keeps its pattern; one that slides sideways should pass its own.
  put(shape, x, y, z, hx, hy, hz, yaw, r, g, b, look, a, b2, alpha, seed) {
    if (this.n >= this.max) return -1;
    const o = this.n * 16, d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = shape;
    d[o + 4] = hx; d[o + 5] = hy; d[o + 6] = hz; d[o + 7] = yaw;
    d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = look;
    d[o + 12] = a; d[o + 13] = b2; d[o + 14] = alpha;
    d[o + 15] = seed ?? ((Math.imul(Math.round(x * 8), 73856093) ^ Math.imul(Math.round(z * 8), 19349663)) >>> 0) % 4096;
    return this.n++;
  }
  box(x, y, z, hx, hy, hz, yaw, r, g, b, look = 0, a = 0, b2 = 0, alpha = 1, seed) { return this.put(0, x, y, z, hx, hy, hz, yaw, r, g, b, look, a, b2, alpha, seed); }
  cyl(x, y, z, radius, hh, r, g, b, look = 0, a = 0, b2 = 0, alpha = 1, seed) { return this.put(1, x, y, z, radius, hh, radius, 0, r, g, b, look, a, b2, alpha, seed); }
  hex(x, y, z, radius, hh, yaw, r, g, b, look = 0, a = 0, b2 = 0, alpha = 1, seed) { return this.put(2, x, y, z, radius, hh, radius, yaw, r, g, b, look, a, b2, alpha, seed); }
  sphere(x, y, z, radius, r, g, b, look = 0, a = 0, b2 = 0, alpha = 1, seed) { return this.put(3, x, y, z, radius, radius, radius, 0, r, g, b, look, a, b2, alpha, seed); }
}

// The backdrops: where the sun is and its light, the sky's gradient and clouds, the ambient light from above and
// below, the sea, how far the haze starts to tell, how soft shadows are, stars, falling snow, and the exposure.
const lin = (c) => c.map((x) => x ** 2.2);
const unit = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
export const ENVS = {
  day: { sun: unit([0.38, 0.8, 0.46]), soft: 1.6, sunc: [1.75, 1.63, 1.4], exposure: 1, skyTop: lin([0.16, 0.38, 0.82]), clouds: 1, skyHor: lin([0.66, 0.8, 0.96]), stars: 0,
    ambSky: [0.2, 0.32, 0.55], snow: 0, ambGnd: [0.13, 0.11, 0.08], fog: 1400, sea: lin([0.02, 0.2, 0.36]) },
  sunset: { sun: unit([-0.62, 0.3, 0.72]), soft: 1.6, sunc: [2.1, 1.2, 0.62], exposure: 1.05, skyTop: lin([0.2, 0.22, 0.48]), clouds: 0.8, skyHor: lin([1.0, 0.6, 0.38]), stars: 0,
    ambSky: [0.24, 0.22, 0.36], snow: 0, ambGnd: [0.17, 0.1, 0.07], fog: 900, sea: lin([0.07, 0.08, 0.2]) },
  night: { sun: unit([0.45, 0.45, -0.62]), soft: 1.8, sunc: [0.42, 0.52, 0.88], exposure: 1.2, skyTop: lin([0.008, 0.016, 0.06]), clouds: 0.4, skyHor: lin([0.07, 0.1, 0.22]), stars: 1,
    ambSky: [0.1, 0.12, 0.24], snow: 0, ambGnd: [0.05, 0.05, 0.08], fog: 700, sea: lin([0.006, 0.025, 0.06]) },
  snow: { sun: unit([0.3, 0.6, 0.5]), soft: 3, sunc: [1.05, 1.02, 1.0], exposure: 1, skyTop: lin([0.56, 0.64, 0.76]), clouds: 1.8, skyHor: lin([0.86, 0.89, 0.94]), stars: 0,
    ambSky: [0.44, 0.48, 0.58], snow: 1, ambGnd: [0.3, 0.31, 0.34], fog: 420, sea: lin([0.12, 0.2, 0.26]) },
};
const envPack = (e) => Float32Array.of(...e.sun, e.soft, ...e.sunc, e.exposure, ...e.skyTop, e.clouds, ...e.skyHor, e.stars, ...e.ambSky, e.snow, ...e.ambGnd, e.fog, ...e.sea, 0);
const ENV_PACKED = Object.fromEntries(Object.entries(ENVS).map(([k, e]) => [k, envPack(e)]));

// The unit meshes, wound counter-clockwise seen from outside: a box [-1, 1]^3, a cylinder and a hex prism of radius 1
// from y -1 to 1 (the hex pointy-top: corners at 30 + 60k degrees from +x toward +z), and two icospheres. Normals are
// per face on flat faces and smooth on round ones; the fragment shader finds edges from the local position.
function buildMeshes() {
  const V = [], I = [], parts = {};
  const vert = (x, y, z, nx, ny, nz) => { V.push(x, y, z, nx, ny, nz); return V.length / 6 - 1; };
  const tri = (a, b, c, n) => {
    const p = (i, k) => V[i * 6 + k];
    const ux = p(b, 0) - p(a, 0), uy = p(b, 1) - p(a, 1), uz = p(b, 2) - p(a, 2);
    const vx = p(c, 0) - p(a, 0), vy = p(c, 1) - p(a, 1), vz = p(c, 2) - p(a, 2);
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) I.push(a, c, b); else I.push(a, b, c);
  };
  const part = (name, fn) => { const first = I.length; fn(); parts[name] = { first, count: I.length - first }; };
  part('box', () => {
    for (let k = 0; k < 3; k++) {
      for (const s of [-1, 1]) {
        const n = [0, 0, 0]; n[k] = s;
        const u = (k + 1) % 3, w = (k + 2) % 3;
        const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => { const p = [0, 0, 0]; p[k] = s; p[u] = a; p[w] = b; return vert(...p, ...n); });
        tri(q[0], q[1], q[2], n); tri(q[0], q[2], q[3], n);
      }
    }
  });
  const prism = (name, sides, offset, smooth) => part(name, () => {
    const ang = (i) => offset + (2 * Math.PI * i) / sides;
    for (let i = 0; i < sides; i++) {
      const a0 = ang(i), a1 = ang(i + 1), am = (a0 + a1) / 2;
      const n0 = smooth ? [Math.cos(a0), 0, Math.sin(a0)] : [Math.cos(am), 0, Math.sin(am)];
      const n1 = smooth ? [Math.cos(a1), 0, Math.sin(a1)] : n0;
      const q = [vert(Math.cos(a0), -1, Math.sin(a0), ...n0), vert(Math.cos(a1), -1, Math.sin(a1), ...n1), vert(Math.cos(a1), 1, Math.sin(a1), ...n1), vert(Math.cos(a0), 1, Math.sin(a0), ...n0)];
      const nm = [Math.cos(am), 0, Math.sin(am)];
      tri(q[0], q[1], q[2], nm); tri(q[0], q[2], q[3], nm);
    }
    for (const s of [-1, 1]) {
      const n = [0, s, 0];
      const c = vert(0, s, 0, ...n);
      const ring = [];
      for (let i = 0; i < sides; i++) ring.push(vert(Math.cos(ang(i)), s, Math.sin(ang(i)), ...n));
      for (let i = 0; i < sides; i++) tri(c, ring[i], ring[(i + 1) % sides], n);
    }
  });
  prism('cyl', 28, 0, true);
  prism('hex', 6, Math.PI / 6, false);
  const ico = (name, subdiv) => part(name, () => {
    const t = (1 + Math.sqrt(5)) / 2;
    let pts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(unit);
    let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (let s = 0; s < subdiv; s++) {
      const mid = new Map();
      const m = (a, b) => {
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        if (!mid.has(key)) { mid.set(key, pts.length); pts.push(unit(pts[a].map((x, k) => x + pts[b][k]))); }
        return mid.get(key);
      };
      faces = faces.flatMap(([a, b, c]) => { const ab = m(a, b), bc = m(b, c), ca = m(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]; });
    }
    const base = pts.map((p) => vert(...p, ...p));
    for (const [a, b, c] of faces) tri(base[a], base[b], base[c], unit(pts[a].map((x, k) => x + pts[b][k] + pts[c][k])));
  });
  ico('sphere', 2);
  ico('sphereLo', 1);
  if (V.length / 6 > 65535) throw new Error('party-render: meshes need 32-bit indices');
  return { vertices: new Float32Array(V), indices: new Uint16Array(I.length % 2 ? [...I, 0] : I), parts };
}
export const MESH = buildMeshes();
const SHAPE_MESH = ['box', 'cyl', 'hex', 'sphere'];
const SHADOW_MESH = ['box', 'cyl', 'hex', 'sphereLo'];

const WGSL = /* wgsl */ `
struct U {
  cam: vec4f,    // eye x, y, z, focal (px)
  fwd: vec4f,    // the camera's axes; fwd.w the time (s)
  right: vec4f,
  up: vec4f,
  screen: vec4f, // width, height, sprites, solid sprites
  counts: vec4f, // decals, casters, beams, rects
  hud: vec4f,    // rows, net graph shown, hurt flash, HUD scale (screen px a HUD px)
  mini: vec4f,   // the minimap's centre x, y and radius (px), and the world radius it shows
  misc: vec4f,   // my slot, the minimap square (1) or a disc (0), HUD x offset (px), riders cast shadows (1)
  sun: vec4f,    // toward the sun (the moon at night); w: shadow softness (texels)
  sunc: vec4f,   // its light; w: exposure
  skyTop: vec4f, // the sky overhead; w: cloud cover
  skyHor: vec4f, // at the horizon; w: stars
  ambSky: vec4f, // ambient light from above; w: snow
  ambGnd: vec4f, // from below; w: haze distance (m)
  sea: vec4f,    // the deep sea; w: shadows on
  lx: vec4f,     // the world to the shadow map: x and y in [-1, 1], depth in [0, 1]
  ly: vec4f,
  lz: vec4f,
  shadow: vec4f, // texel (m), normal offset (m), depth bias, 0
  mask: vec4f,   // the balls' contact shade: x0, z0, 1 / size, y of the lowest code
  mask2: vec4f,  // the codes' y span, 0, 0, 0
  paint: vec4f,  // the paint layer: x0, z0, 1 / size (m), cells a side (0: none)
  map: vec4f,    // the minimap's texture: centre x, z, world half size, the highest y
  map2: vec4f,   // y span, my slot, a dot's least radius (m), my heading (rad)
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> solids: array<vec4f>;  // four a solid (Scene)
@group(0) @binding(2) var<storage, read> order: array<u32>;     // solids by draw
@group(0) @binding(3) var<storage, read> casters: array<vec4f>; // x, y (the bottom), z, radius (negative: a round thing centred at y, no rider)
@group(0) @binding(4) var<storage, read> sprites: array<vec4f>; // four a sprite: pos, size | colour | kind, aspect, min px, seed | velocity, roll
@group(0) @binding(5) var<storage, read> beams: array<vec4f>;   // three a beam: a, width | b, 0 | colour
@group(0) @binding(6) var<storage, read> rects: array<vec4f>;
@group(0) @binding(7) var<storage, read> hud: array<u32>;
@group(0) @binding(8) var<storage, read> font: array<u32>;
@group(0) @binding(9) var<storage, read> graph: array<vec4f>;
@group(0) @binding(10) var<storage, read> decals: array<vec4f>; // three a decal: pos, radius | width, kind, 0, 0 | colour
@group(0) @binding(11) var<storage, read> palette: array<vec4f>; // the paint layer's 256 colours
@group(1) @binding(0) var shadowMap: texture_depth_2d;
@group(1) @binding(1) var shadowCmp: sampler_comparison;
@group(1) @binding(2) var mask: texture_2d<f32>;                 // r: a ball's contact shade, g: the code of the y it sits at
@group(1) @binding(3) var samp: sampler;
@group(1) @binding(4) var paintTex: texture_2d<u32>;
@group(2) @binding(0) var mapTex: texture_2d<f32>;
@group(2) @binding(1) var mapSamp: sampler;

const NEAR = ${NEAR};
const PI = 3.14159265;

fn lin(c: vec3f) -> vec3f { return pow(max(c, vec3f(0.0)), vec3f(2.2)); }
// ACES, fitted, then the display's gamma, and half a level of noise against banding
fn finish(c: vec3f, p: vec2f) -> vec3f {
  let a = c * 0.8 * u.sunc.w;
  let t = clamp((a * (2.51 * a + 0.03)) / (a * (2.43 * a + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
  return pow(t, vec3f(1.0 / 2.2)) + (fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
}

fn hash2(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn hash22(p: vec2f) -> vec2f { return fract(sin(vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)))) * 43758.5453); }
fn hashu(x: u32) -> u32 {
  var h = x * 747796405u + 2891336453u;
  h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  return (h >> 22u) ^ h;
}
fn hashf(x: u32) -> f32 { return f32(hashu(x) & 0xffffffu) / 16777216.0; }
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2f(1.0, 0.0)), s.x), mix(hash2(i + vec2f(0.0, 1.0)), hash2(i + vec2f(1.0, 1.0)), s.x), s.y);
}
fn fbm(p: vec2f) -> f32 { return 0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03 + 7.1) + 0.125 * vnoise(p * 4.1 + 3.3); }
// The walls of a Voronoi pattern: how far p is from the nearest one (in cells)
fn voronoi(p: vec2f) -> f32 {
  let ip = floor(p);
  let fp = fract(p);
  var mr = vec2f(0.0);
  var mb = vec2f(0.0);
  var md = 8.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let b = vec2f(f32(i), f32(j));
      let r = b + hash22(ip + b) - fp;
      let d = dot(r, r);
      if (d < md) { md = d; mr = r; mb = b; }
    }
  }
  md = 8.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let b = mb + vec2f(f32(i), f32(j));
      let r = b + hash22(ip + b) - fp;
      if (dot(mr - r, mr - r) > 1e-5) { md = min(md, dot(0.5 * (mr + r), normalize(r - mr))); }
    }
  }
  return md;
}
// a checkerboard box-filtered over w (from fwidth), so it doesn't shimmer far off
fn checkers(p: vec2f, w: vec2f) -> f32 {
  let ww = max(w, vec2f(1e-4));
  let i = 2.0 * (abs(fract((p - 0.5 * ww) * 0.5) - 0.5) - abs(fract((p + 0.5 * ww) * 0.5) - 0.5)) / ww;
  return 0.5 - 0.5 * i.x * i.y;
}
var<private> CORNERS: array<vec2f, 6> = array<vec2f, 6>(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1));
fn slotColor(s: f32) -> vec3f {
  let h = s * 0.618034;
  return 0.55 + 0.4 * cos(6.2832 * (fract(h) + vec3f(0.0, 0.33, 0.67)));
}
fn rotY(v: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(c * v.x - s * v.z, v.y, s * v.x + c * v.z); }
// Rodrigues: v turned by angle a about the unit axis k.
fn turn(v: vec3f, k: vec3f, a: f32) -> vec3f {
  return v * cos(a) + cross(k, v) * sin(a) + k * dot(k, v) * (1.0 - cos(a));
}

// ---- light
fn ambient(n: vec3f) -> vec3f { return mix(u.ambGnd.rgb, u.ambSky.rgb, n.y * 0.5 + 0.5); }
fn shade(albedo: vec3f, n: vec3f, sun: f32, ao: f32) -> vec3f {
  return albedo * (u.sunc.rgb * max(dot(n, u.sun.xyz), 0.0) * sun + ambient(n) * ao);
}
// the sun's highlight, normalised so a tight one is as bright as it is small
fn sunSpec(n: vec3f, v: vec3f, power: f32, k: f32) -> vec3f {
  let h = normalize(v + u.sun.xyz);
  return u.sunc.rgb * pow(max(dot(n, h), 0.0), power) * k * (power + 8.0) / 25.0 * step(0.0, dot(n, u.sun.xyz));
}
// the sky as a reflection sees it: no clouds, the world below dim
fn skyLite(d: vec3f) -> vec3f {
  var c = mix(u.skyHor.rgb, u.skyTop.rgb, sqrt(max(d.y, 0.0)));
  c = mix(c, u.ambGnd.rgb * 0.7 + u.sea.rgb * 0.6, smoothstep(0.02, -0.3, d.y));
  return c + u.sunc.rgb * pow(max(dot(d, u.sun.xyz), 0.0), 10.0) * 0.12;
}
fn fresnel(n: vec3f, v: vec3f, f0: f32) -> f32 { return f0 + (1.0 - f0) * pow(1.0 - max(dot(n, v), 0.0), 5.0); }

fn sky(d: vec3f) -> vec3f { return skyStars(d, 1.0); }
fn skyStars(d: vec3f, stars: f32) -> vec3f {
  let y = max(d.y, 0.0);
  let night = u.skyHor.w;
  var c = mix(u.skyHor.rgb, u.skyTop.rgb, pow(y, 0.5));
  let sd = max(dot(d, u.sun.xyz), 0.0);
  c += u.sunc.rgb * 0.57 * (pow(sd, 8.0) * 0.25 * (1.0 - 0.8 * night) + pow(sd, 120.0) * 1.5 * (1.0 - 0.6 * night));
  c += mix(vec3f(6.0, 5.5, 4.5), vec3f(1.7, 1.8, 2.0), night) * smoothstep(0.9995 - 0.0002 * night, 0.9998 - 0.0001 * night, sd);
  if (night * stars > 0.0 && d.y > 0.0) {
    let g = vec2f(atan2(d.z, d.x) * 120.0, asin(min(d.y, 1.0)) * 120.0);
    let cell = floor(g);
    let h = hash2(cell);
    let at = hash22(cell + 1.7) * 0.7 + 0.15;
    let pr = 0.6 / max(u.cam.w / 120.0, 1.0);                            // a pixel and a bit, in cells
    let tw = 0.6 + 0.4 * sin(u.fwd.w * (2.0 + 3.0 * hash2(cell + 3.1)) + h * 40.0);
    let b = step(0.93, h) * (0.4 + 2.6 * pow(hash2(cell + 9.2), 6.0));
    c += vec3f(0.9, 0.95, 1.0) * b * (1.0 - smoothstep(0.0, pr, length(fract(g) - at))) * tw * night * 3.0 * smoothstep(0.0, 0.12, d.y);
  }
  if (d.y > 0.01) {
    let w = u.cam.xz + d.xz * (500.0 / d.y) + vec2f(u.fwd.w * 3.0, 0.0);
    let n = fbm(w / 180.0);
    let lo = 0.75 - 0.3 * u.skyTop.w;
    let cl = smoothstep(lo, lo + 0.3, n) * clamp(d.y * 5.0, 0.0, 1.0);
    let cc = (u.sunc.rgb * 0.45 + u.ambSky.rgb * 0.6) * 1.12 * (0.82 + 0.36 * fbm(w / 60.0)) * (1.0 - 0.6 * night) + u.sunc.rgb * pow(sd, 6.0) * 0.35;
    c = mix(c, cc, cl * 0.88);
  }
  return c;
}
// what far things fade to: the sky at the horizon, that way (clouds thin out to nothing there)
fn haze(c: vec3f, d: vec3f, t: f32) -> vec3f {
  let sd = max(dot(d, u.sun.xyz), 0.0);
  let h = mix(u.skyHor.rgb, u.skyTop.rgb, pow(max(d.y, 0.02), 0.5)) + u.sunc.rgb * 0.57 * pow(sd, 8.0) * 0.25 * (1.0 - 0.8 * u.skyHor.w);
  return mix(c, h, 1.0 - exp(-t / u.ambGnd.w));
}

var<private> POISSON: array<vec2f, 8> = array<vec2f, 8>(vec2f(-0.613, 0.617), vec2f(0.170, -0.040), vec2f(-0.299, -0.792), vec2f(0.645, 0.493),
  vec2f(-0.651, -0.110), vec2f(0.421, -0.711), vec2f(0.022, 0.937), vec2f(0.929, -0.215));
// How much of the sun reaches p (normal n): eight bilinear compares, soft, fading out at the map's edge.
fn shadowAt(p: vec3f, n: vec3f) -> f32 {
  if (u.sea.w < 0.5) { return 1.0; }
  let q = vec4f(p + n * u.shadow.y, 1.0);
  let l = vec3f(dot(q, u.lx), dot(q, u.ly), dot(q, u.lz));
  let edge = max(abs(l.x), abs(l.y));
  if (edge >= 1.0 || l.z < 0.0) { return 1.0; }
  let uv = vec2f(l.x * 0.5 + 0.5, 0.5 - l.y * 0.5);
  let zr = min(l.z, 0.99999) - u.shadow.z;
  let r = u.sun.w / ${SHADOW_N}.0;
  var s = 0.0;
  for (var k = 0; k < 8; k++) { s += textureSampleCompareLevel(shadowMap, shadowCmp, uv + POISSON[k] * r, zr); }
  return mix(s / 8.0, 1.0, smoothstep(0.92, 1.0, edge));
}
// The shade a ball casts right under it, on whatever it sits on: drawn each frame from above into a small
// texture, a soft disc a ball with the code of the y it sits at, so only what it sits on darkens (Thin Ice's
// lower floors stay lit). Where two overlap the darker shade and the higher ball win.
struct COut { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) code: f32 };
@vertex fn vs_contact(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> COut {
  var o: COut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  let c = casters[i];
  if (c.w <= 0.0 || c.y < -500.0) { return o; }
  let k = CORNERS[v];
  let q = (c.xz + k * c.w * 0.95 - u.mask.xy) * u.mask.z;
  o.pos = vec4f(q.x * 2.0 - 1.0, 1.0 - q.y * 2.0, 0.0, 1.0);
  o.uv = k;
  o.code = clamp((c.y - u.mask.w) / u.mask2.x, 0.0, 1.0);
  return o;
}
@fragment fn fs_contact(c: COut) -> @location(0) vec4f {
  let d = dot(c.uv, c.uv);
  if (d >= 1.0) { discard; }
  return vec4f(0.6 * pow(1.0 - d, 1.5), c.code, 0.0, 0.0);
}
fn contactAt(p: vec3f) -> f32 {
  let uv = (p.xz - u.mask.xy) * u.mask.z;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return 1.0; }
  let m = textureSampleLevel(mask, samp, uv, 0.0).rg;
  let y = u.mask.w + m.g * u.mask2.x;
  return 1.0 - m.r * (1.0 - smoothstep(0.2, 1.0, abs(p.y - y)));
}

// The paint layer at p (px: metres a pixel). Of the four nearest cells, the colour with the most bilinear weight
// wins, and where two weigh the same they meet, smoothed over a pixel: cells read as round blobs of wet paint, not
// squares, and runs of one colour join up. Past the grid's edge (index 256) nothing is painted.
fn paintId(i: vec2i) -> u32 {
  let n = i32(u.paint.w);
  if (i.x < 0 || i.y < 0 || i.x >= n || i.y >= n) { return 256u; }
  return textureLoad(paintTex, i, 0).r;
}
fn paintCol(id: u32) -> vec4f { return select(palette[min(id, 255u)], vec4f(0.0), id > 255u); }
fn paintAt(p: vec2f, px: f32) -> vec4f {
  if (u.paint.w < 1.0) { return vec4f(0.0); }
  let cells = u.paint.z * u.paint.w;
  let g = (p - u.paint.xy) * cells - 0.5;
  let i = vec2i(floor(g));
  let f = fract(g);
  var id = array<u32, 4>(paintId(i), paintId(i + vec2i(1, 0)), paintId(i + vec2i(0, 1)), paintId(i + vec2i(1, 1)));
  var w = array<f32, 4>((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  var tot = array<f32, 4>(0.0, 0.0, 0.0, 0.0);
  var best = 0u;
  for (var k = 0u; k < 4u; k++) {
    for (var j = 0u; j < 4u; j++) { if (id[j] == id[k]) { tot[k] += w[j]; } }
    if (tot[k] > tot[best]) { best = k; }
  }
  var second = best;
  var sw = 0.0;
  for (var k = 0u; k < 4u; k++) { if (id[k] != id[best] && tot[k] > sw) { sw = tot[k]; second = k; } }
  let t = clamp((tot[best] - sw) / max(px * cells * 1.5, 0.02) + 0.5, 0.0, 1.0);
  return mix(paintCol(id[second]), paintCol(id[best]), t);
}

fn clip(q: vec3f) -> vec4f {
  let r = q - u.cam.xyz;
  return vec4f(dot(r, u.right.xyz) * u.cam.w / (u.screen.x * 0.5), dot(r, u.up.xyz) * u.cam.w / (u.screen.y * 0.5), NEAR, dot(r, u.fwd.xyz));
}
fn toLight(p: vec3f) -> vec4f { let q = vec4f(p, 1.0); return vec4f(dot(q, u.lx), dot(q, u.ly), dot(q, u.lz), 1.0); }
fn toMap(p: vec3f) -> vec4f { return vec4f((p.x - u.map.x) / u.map.z, (u.map.y - p.z) / u.map.z, clamp((u.map.w - p.y) / u.map2.x, 0.0, 1.0), 1.0); }

// ---- the background: the sky, and the sea far below with the stage's shadow and the sun's glint on it
struct VOut { @builtin(position) pos: vec4f };
@vertex fn vs_full(@builtin(vertex_index) i: u32) -> VOut {
  var o: VOut;
  let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  o.pos = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  return o;
}
fn ray(p: vec2f) -> vec3f {
  return normalize(u.fwd.xyz * u.cam.w + u.right.xyz * (p.x - u.screen.x * 0.5) + u.up.xyz * (u.screen.y * 0.5 - p.y));
}
fn sea(w: vec3f, d: vec3f, t: f32) -> vec3f {
  let tt = u.fwd.w;
  let k = clamp(1.0 - t / 260.0, 0.1, 1.0) * 0.8; // far off, the swell smooths out
  let gx = 0.12 * cos(w.x * 0.07 + tt * 0.9) + 0.08 * cos((w.x + w.z) * 0.16 + tt * 1.3) + 0.04 * cos(w.x * 0.33 - w.z * 0.15 + tt * 1.9);
  let gz = 0.1 * cos(w.z * 0.06 - tt * 0.7) + 0.08 * cos((w.x + w.z) * 0.16 + tt * 1.3) + 0.03 * cos(w.z * 0.37 + w.x * 0.12 - tt * 1.7);
  let n = normalize(vec3f(-gx * k, 1.0, -gz * k));
  let r = reflect(d, n);
  let fres = 0.02 + 0.98 * pow(1.0 - max(dot(-d, n), 0.0), 5.0);
  let sl = shadowAt(w, vec3f(0.0, 1.0, 0.0));
  let deep = u.sea.rgb * (0.7 + 0.3 * u.sun.y) * (0.5 + 0.5 * sl);
  var c = mix(deep, skyStars(r, 0.0), fres);
  c += u.sunc.rgb * 2.2 * pow(max(dot(r, u.sun.xyz), 0.0), 600.0) * sl;
  return haze(c, d, t);
}
struct TOut { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 };
@fragment fn fs_world(@builtin(position) p: vec4f) -> TOut {
  var o: TOut;
  let d = ray(p.xy);
  let e = u.cam.xyz;
  if (d.y < 0.0 && e.y > 0.0) {
    let ts = -e.y / d.y;
    o.color = vec4f(finish(sea(e + d * ts, d, ts), p.xy), 1.0);
    o.depth = clamp(NEAR / max(ts * dot(d, u.fwd.xyz), NEAR), 0.0, 1.0);
    return o;
  }
  o.color = vec4f(finish(sky(d), p.xy), 1.0);
  o.depth = 0.0;
  return o;
}

// ---- solids
struct MOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,                        // the world
  @location(1) lp: vec3f,                        // the solid's own frame, unturned, in metres
  @location(2) ln: vec3f,                        // its normal there
  @location(3) @interpolate(flat) col: vec4f,    // rgb, look
  @location(4) @interpolate(flat) prm: vec4f,    // a, b, alpha, seed
  @location(5) @interpolate(flat) ext: vec4f,    // half extents, yaw
  @location(6) @interpolate(flat) shape: u32,
};
fn solidAt(ii: u32, p: vec3f, n: vec3f) -> MOut {
  var o: MOut;
  let i = order[ii];
  let a = solids[4u * i];
  let b = solids[4u * i + 1u];
  let lp = p * b.xyz;
  o.wp = a.xyz + rotY(lp, b.w);
  o.lp = lp;
  o.ln = n;
  o.col = solids[4u * i + 2u];
  o.prm = solids[4u * i + 3u];
  o.ext = b;
  o.shape = u32(a.w);
  return o;
}
@vertex fn vs_solid(@location(0) p: vec3f, @location(1) n: vec3f, @builtin(instance_index) ii: u32) -> MOut {
  var o = solidAt(ii, p, n);
  o.pos = clip(o.wp);
  return o;
}
@vertex fn vs_map(@location(0) p: vec3f, @location(1) n: vec3f, @builtin(instance_index) ii: u32) -> MOut {
  var o = solidAt(ii, p, n);
  o.pos = toMap(o.wp);
  return o;
}
// see-through things (alpha under 0.7) cast no shadow
@vertex fn vs_shadow(@location(0) p: vec3f, @location(1) n: vec3f, @builtin(instance_index) ii: u32) -> @builtin(position) vec4f {
  let i = order[ii];
  if (solids[4u * i + 3u].z < 0.7) { return vec4f(2.0, 2.0, 2.0, 1.0); }
  let a = solids[4u * i];
  let b = solids[4u * i + 1u];
  return toLight(a.xyz + rotY(p * b.xyz, b.w));
}
// a ball, then its rider's body and head, as spheres
@vertex fn vs_shadow_ball(@location(0) p: vec3f, @location(1) n: vec3f, @builtin(instance_index) ii: u32) -> @builtin(position) vec4f {
  let k = ii / 3u;
  let part = ii % 3u;
  let c = casters[k];
  let r = abs(c.w);
  if (r == 0.0 || c.y < -500.0 || (part > 0u && (c.w < 0.0 || u.misc.w < 0.5))) { return vec4f(2.0, 2.0, 2.0, 1.0); }
  var ctr = vec3f(c.x, select(c.y, c.y + r, c.w > 0.0), c.z);
  var rad = r;
  if (part == 1u) { ctr.y = c.y + 2.0 * r + 0.22; rad = 0.34; }
  if (part == 2u) { ctr.y = c.y + 2.0 * r + 0.78; rad = 0.3; }
  return toLight(ctr + p * rad);
}

// The nearest edge of the face a pixel is on: how far (m), which way is out over it (the solid's frame), and the
// face's smaller half size (m), so ink can fade where a face is only a few pixels.
struct Edge { e: f32, tilt: vec3f, size: f32 };
fn nearer(e1: f32, t1: vec3f, e2: f32, t2: vec3f, size: f32) -> Edge {
  var o: Edge;
  o.size = size;
  if (e1 < e2) { o.e = e1; o.tilt = t1; } else { o.e = e2; o.tilt = t2; }
  return o;
}
const S3 = 0.8660254;
fn edgeOf(shape: u32, lp: vec3f, nl: vec3f, h: vec3f) -> Edge {
  var o: Edge;
  o.e = 1e3;
  o.tilt = vec3f(0.0);
  o.size = 1e3;
  let an = abs(nl);
  let sg = sign(lp);
  if (shape == 0u) {
    if (an.x >= an.y && an.x >= an.z) { o = nearer(h.y - abs(lp.y), vec3f(0.0, sg.y, 0.0), h.z - abs(lp.z), vec3f(0.0, 0.0, sg.z), min(h.y, h.z)); }
    else if (an.y >= an.z) { o = nearer(h.x - abs(lp.x), vec3f(sg.x, 0.0, 0.0), h.z - abs(lp.z), vec3f(0.0, 0.0, sg.z), min(h.x, h.z)); }
    else { o = nearer(h.x - abs(lp.x), vec3f(sg.x, 0.0, 0.0), h.y - abs(lp.y), vec3f(0.0, sg.y, 0.0), min(h.x, h.y)); }
  } else if (shape == 1u) {
    if (an.y > 0.7) {
      let r = normalize(lp.xz + vec2f(1e-6, 0.0));
      o.e = h.x - length(lp.xz); o.tilt = vec3f(r.x, 0.0, r.y); o.size = h.x;
    } else { o.e = h.y - abs(lp.y); o.tilt = vec3f(0.0, sg.y, 0.0); o.size = min(h.y, h.x * 1.5); }
  } else if (shape == 2u) {
    if (an.y > 0.7) {
      let d = vec3f(lp.x, dot(lp.xz, vec2f(0.5, S3)), dot(lp.xz, vec2f(-0.5, S3)));
      let ad = abs(d);
      var m = ad.x;
      var dir = vec2f(sign(d.x), 0.0);
      if (ad.y > m) { m = ad.y; dir = vec2f(0.5, S3) * sign(d.y); }
      if (ad.z > m) { m = ad.z; dir = vec2f(-0.5, S3) * sign(d.z); }
      o.e = h.x * S3 - m; o.tilt = vec3f(dir.x, 0.0, dir.y); o.size = h.x * S3;
    } else {
      let f = normalize(nl.xz + vec2f(1e-6, 0.0));
      let t = vec2f(-f.y, f.x);
      let sd = dot(lp.xz, t);
      o = nearer(h.x * 0.5 - abs(sd), vec3f(t.x, 0.0, t.y) * sign(sd), h.y - abs(lp.y), vec3f(0.0, sg.y, 0.0), min(h.x * 0.5, h.y));
    }
  }
  return o;
}

// A solid's pixel, lit, in its look; alpha in w.
fn litSolid(m: MOut, fragPos: vec2f) -> vec4f {
  let shape = m.shape;
  let look = u32(m.col.w + 0.5);
  let pa = m.prm.x;
  let pb = m.prm.y;
  let seed = m.prm.w;
  let yaw = m.ext.w;
  let h = m.ext.xyz;
  let toEye = u.cam.xyz - m.wp;
  let dist = length(toEye);
  let v = toEye / dist;
  let vl = rotY(v, -yaw);                                // the view, in the solid's frame
  var nl = normalize(select(m.ln, m.lp / (h * h), shape == 3u));   // a sphere's normal is exact from where we are on it (an ellipsoid's too)
  // everything that takes a derivative, while every pixel still runs the same code
  let px = max(length(fwidth(m.wp)) * 0.7071, 1e-5);   // metres a pixel, here
  let ndv0 = dot(nl, vl);
  let fwN = fwidth(ndv0);
  let top = abs(nl.y) > 0.7;
  let sw = select(0.5, pa, pa > 0.0);
  let hzd = (m.lp.x + m.lp.y + m.lp.z) / max(sw, 0.05) + seed * 0.37;
  let fwH = fwidth(hzd);
  let csz = select(1.0, pa, pa > 0.0);
  let tw = normalize(rotY(vec3f(-nl.z, 0.0, nl.x), yaw) + vec3f(1e-6, 0.0, 0.0));
  let cq = select(vec2f(dot(m.wp.xz, tw.xz), m.wp.y), m.wp.xz, top) / csz;
  let fwC = fwidth(cq);

  // the edge: a rounded bevel that catches the light, and a soft ink line right on it
  let eg = edgeOf(shape, m.lp, nl, h);
  let bw = max(min(0.07, eg.size * 0.25), px * 1.5);
  let bk = 1.0 - clamp(eg.e / bw, 0.0, 1.0);
  nl = normalize(nl + eg.tilt * bk * bk * 1.3);
  let inkLine = 1.0 - smoothstep(0.35, 1.3, eg.e / px);
  var ink = 1.0 - 0.55 * inkLine * smoothstep(3.0, 12.0, eg.size / px);
  // round things: a soft dark rim where they turn away, as the balls have
  let curved = shape == 3u || (shape == 1u && !top);
  if (curved) { ink *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 2.5 * fwN + 0.02, ndv0)); }

  let n = rotY(nl, yaw);
  let r = reflect(-v, n);
  let sh = shadowAt(m.wp, n);
  var ao = contactAt(m.wp);
  if (!top && shape != 3u) { ao *= 0.72 + 0.28 * smoothstep(0.0, min(0.8, h.y), m.lp.y + h.y); }
  let base = lin(m.col.rgb);
  let grain = fbm(m.lp.xz * 0.7 + m.lp.y * 0.4 + seed * 0.731);
  var alpha = m.prm.z;
  var c = vec3f(0.0);
  switch look {
    case 1u: { // PLASTIC: a toy's gloss
      c = shade(base * 0.92, n, sh, ao) + sunSpec(n, v, 140.0, 0.9) * sh + skyLite(r) * fresnel(n, v, 0.04) * 0.45;
    }
    case 2u: { // ICE: frost deep inside that shifts as you move, a wet gloss, cracks that spread with a and whiten it; b frosts it over
      let depth = 0.22;
      let inner = fbm((m.lp.xz - vl.xz / max(abs(vl.y), 0.22) * depth) * 1.7 + seed * 0.13);
      let near = fbm(m.lp.xz * 3.1 + seed);
      let deep = base * vec3f(0.18, 0.42, 0.72);
      var alb = mix(deep, base, 0.3 + 0.7 * smoothstep(0.25, 0.75, inner));
      alb = mix(alb, vec3f(0.92, 0.96, 1.0), 0.12 * near + 0.5 * pa);
      alb = mix(alb, vec3f(0.9, 0.93, 0.97) * (0.92 + 0.12 * near), clamp(pb, 0.0, 1.0));
      if (!top) { alb = mix(deep * 0.8, alb, 0.45 + 0.4 * smoothstep(-h.y, h.y, m.lp.y)); }
      // cracks: cell walls and rays from the middle, out to a times the face's size, wider as it goes
      var crack = 0.0;
      if (pa > 0.0) {
        let q = m.lp.xz + vec2f(seed * 0.71, seed * 1.37);
        let reach = pa * max(h.x, h.z) * 1.25;
        let rr = length(m.lp.xz);
        let spread = 1.0 - smoothstep(reach - 0.35, reach, rr);
        let wv = voronoi(q * 1.25);
        let wd = (0.012 + 0.05 * pa) * 1.25;
        crack = (1.0 - smoothstep(wd * 0.4, wd + px * 1.25, wv)) * spread;
        // five to eight rays, each wandering and of its own length
        let nr = 5.0 + floor(hash2(vec2f(seed, 2.3)) * 4.0);
        let wob = (vnoise(vec2f(rr * 1.6, seed)) - 0.5) * 0.9 + (vnoise(vec2f(rr * 5.0, seed + 4.0)) - 0.5) * 0.25;
        let sec = atan2(m.lp.z, m.lp.x) / 6.2832 * nr + fract(seed * 0.618) + wob;
        let ray = floor(sec + 0.5);
        let len = 0.45 + 0.55 * hash2(vec2f(ray - nr * floor(ray / nr), seed));
        let rayd = abs(fract(sec + 0.5) - 0.5) * 6.2832 / nr * rr;
        crack = max(crack, (1.0 - smoothstep(0.01 + 0.03 * pa, 0.04 + 0.03 * pa + px, rayd)) * (1.0 - smoothstep(reach * len * 0.8, reach * len, rr)));
        if (pa > 0.45) { crack = max(crack, (1.0 - smoothstep(0.02, 0.05 + px * 2.0, voronoi(q * 3.3 + 5.0))) * spread * smoothstep(0.45, 0.9, pa) * 0.8); }
        if (!top) { crack = 0.0; }
      }
      c = shade(alb, n, sh, ao) * 0.9;
      c += (skyLite(r) * fresnel(n, v, 0.06) * 0.8 + sunSpec(n, v, 220.0, 1.2) * sh) * (1.0 - 0.7 * clamp(pb, 0.0, 1.0));
      c = mix(c, (u.sunc.rgb * max(u.sun.y, 0.3) * sh + ambient(n) * 1.3) * 0.95, crack * 0.85);
      // a glint here and there in the frost
      let gl = step(0.985, hash2(floor(m.lp.xz * 22.0) + seed));
      c += u.sunc.rgb * gl * pow(max(dot(n, normalize(v + u.sun.xyz)), 0.0), 30.0) * 0.6 * sh * (1.0 - smoothstep(0.02, 0.06, px));
      alpha = mix(alpha, 1.0, fresnel(n, v, 0.0) * 0.6 + crack * 0.5);
    }
    case 3u: { // METAL: the sky in it, tinted, brushed along the solid's length
      let lx = h.x >= h.z;
      let along = select(m.lp.z, m.lp.x, lx);
      let across = select(m.lp.x, m.lp.z, lx) + m.lp.y;
      let st = vnoise(vec2f(along * 0.9, across * 55.0 + seed)) - 0.5;
      let ta = rotY(select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), lx), yaw);
      let rb = normalize(r + ta * st * 0.35 + vec3f(0.0, (vnoise(vec2f(along * 0.3, across * 3.0 + seed)) - 0.5) * 0.25, 0.0));
      var env = skyLite(rb);
      let cl = smoothstep(0.42, 0.8, fbm(rb.xz / (abs(rb.y) + 0.3) * 1.3 + seed * 0.1)) * smoothstep(-0.05, 0.2, rb.y);
      env = mix(env, (u.sunc.rgb * 0.45 + u.ambSky.rgb * 0.6) * 1.1, cl * 0.7);
      let brushed = 0.85 + 0.3 * st;
      c = base * (shade(vec3f(0.12), n, sh, ao) + env * 0.9 * brushed * (0.55 + 0.45 * ao)) + base * sunSpec(n, v, 36.0, 0.5) * sh + sunSpec(n, v, 400.0, 1.4) * sh;
    }
    case 4u: { // HAZARD: stripes a wide (0.5 m), the colour and black, gloss paint
      let t = abs(fract(hzd * 0.5) - 0.5) * 2.0;
      let k = smoothstep(0.5 - fwH, 0.5 + fwH, t);
      let alb = mix(base, vec3f(0.018), k) * (0.92 + 0.12 * grain);
      c = shade(alb, n, sh, ao) + sunSpec(n, v, 70.0, 0.35) * sh + skyLite(r) * fresnel(n, v, 0.04) * 0.25;
    }
    case 5u: { // GLOW: lit by a (0 off), b brings the light out to its edges
      let edgeK = mix(1.0, 0.2 + 1.6 * (1.0 - smoothstep(0.0, bw * 5.0 + 0.1, eg.e)), pb);
      c = shade(base * 0.55, n, sh, ao) + sunSpec(n, v, 90.0, 0.4) * sh;
      c += base * 1.9 * pa * edgeK * (0.85 + 0.3 * fresnel(n, v, 0.0)) + vec3f(1.0) * 0.5 * max(pa - 0.8, 0.0) * edgeK * smoothstep(0.6, 1.0, ndv0);
    }
    case 6u: { // PAINT: the paint layer, wet, over the solid's own colour (the tops only)
      var pc = vec4f(0.0);
      if (top && nl.y > 0.0) { pc = paintAt(m.wp.xz, px); }
      let alb = mix(base * (0.9 + 0.15 * grain), lin(pc.rgb), pc.a);
      c = shade(alb, n, sh, ao) + (sunSpec(n, v, 90.0, 0.5) * sh + skyLite(r) * fresnel(n, v, 0.04) * 0.4) * pc.a;
    }
    case 7u: { // CHECKER: squares a a side (1 m) in the world, the colour and its opposite (b softens it)
      let lum = dot(base, vec3f(0.3, 0.55, 0.15));
      let other = mix(select(mix(base, vec3f(1.0), 0.85), base * 0.16, lum > 0.3), base, pb);
      let alb = mix(base, other, checkers(cq, fwC)) * (0.93 + 0.1 * grain);
      c = shade(alb, n, sh, ao) + sunSpec(n, v, 50.0, 0.2) * sh;
    }
    case 8u: { // WOOD: planks a wide (0.32 m) along the longer side, grain, seams, a satin finish
      let lx = h.x >= h.z;
      var along = select(m.lp.z, m.lp.x, lx);
      var across = select(m.lp.x, m.lp.z, lx);
      if (!top) {
        along = select(m.lp.x, m.lp.z, abs(nl.x) > 0.7);
        across = m.lp.y;
        if (shape == 1u) { along = m.lp.y; across = atan2(m.lp.z, m.lp.x) * h.x; }
      }
      let pw = select(0.32, pa, pa > 0.0);
      let pk = floor(across / pw + seed * 0.1);
      let tone = 0.78 + 0.36 * hash2(vec2f(pk, seed));
      let g = along * 0.35 + vnoise(vec2f(along * 0.25, across * 3.0 + pk * 7.0)) * 2.5 + hash2(vec2f(pk, 1.0)) * 9.0;
      let rings = smoothstep(0.15, 0.85, abs(fract(g * 2.2) - 0.5) * 2.0);
      let fa = fract(across / pw);
      let seamW = max(0.035, px / pw * 1.2);
      var seam = smoothstep(0.0, seamW, fa) * smoothstep(0.0, seamW, 1.0 - fa);
      let endAt = fract((along + hash2(vec2f(pk, 3.0)) * 2.4) / 2.4);
      seam *= smoothstep(0.0, seamW * 0.3, endAt) * smoothstep(0.0, seamW * 0.3, 1.0 - endAt);
      let alb = base * tone * (0.78 + 0.22 * mix(1.0, rings, 1.0 - smoothstep(0.01, 0.05, px))) * (0.45 + 0.55 * seam);
      c = shade(alb, n, sh, ao) + sunSpec(n, v, 28.0, 0.14) * sh;
    }
    case 9u: { // RUBBER: rough, a faint broad sheen, a fine pebbly grain
      let e = 0.04;
      let bp = m.lp * 16.0;
      let gx = vnoise(bp.xz + vec2f(e, 0.0)) - vnoise(bp.xz - vec2f(e, 0.0));
      let gz = vnoise(bp.zy + vec2f(e, 0.0)) - vnoise(bp.zy - vec2f(e, 0.0));
      let nb = normalize(n + vec3f(gx, 0.0, gz) * 1.6 * (1.0 - smoothstep(0.005, 0.02, px)));
      c = shade(base * 0.88, nb, sh, ao) + sunSpec(nb, v, 10.0, 0.1) * sh;
    }
    default: { // MATTE
      c = shade(base * (0.9 + 0.16 * grain), n, sh, ao);
    }
  }
  c *= ink;
  return vec4f(finish(haze(c, -v, dist), fragPos), alpha);
}
@fragment fn fs_solid(m: MOut) -> @location(0) vec4f { return vec4f(litSolid(m, m.pos.xy).rgb, 1.0); }
@fragment fn fs_solid_t(m: MOut) -> @location(0) vec4f { return litSolid(m, m.pos.xy); }

// the minimap's picture: each solid's colour from above, its look in a word, an outline, higher brighter
@fragment fn fs_map(m: MOut) -> @location(0) vec4f {
  let look = u32(m.col.w + 0.5);
  let pa = m.prm.x;
  var c = m.col.rgb;
  let nl = normalize(select(m.ln, m.lp, m.shape == 3u));
  if (look == 5u) { c = min(c * (0.7 + 0.8 * pa), vec3f(1.0)); }
  if (look == 2u) { c = mix(c, vec3f(1.0), 0.2 + 0.5 * pa); }
  if (look == 4u) { c = select(c, vec3f(0.05), fract((m.lp.x + m.lp.z) / (2.0 * select(0.5, pa, pa > 0.0))) > 0.5); }
  if (look == 6u) { let p = paintAt(m.wp.xz, 2.0 * u.map.z / ${MAP_N}.0); c = mix(c, p.rgb, p.a); }
  if (look == 9u) { c *= 0.8; }
  let px = 2.0 * u.map.z / ${MAP_N}.0;
  let eg = edgeOf(m.shape, m.lp, nl, m.ext.xyz);
  if (eg.e < px * 1.1 && eg.size > px * 2.5) { c *= 0.5; }
  let hk = clamp((m.wp.y - (u.map.w - u.map2.x)) / u.map2.x, 0.0, 1.0);
  c *= 0.55 + 0.55 * hk;
  return vec4f(c, 0.94 * max(m.prm.z, 0.3));
}

// every caster as a dot on the minimap, mine a white arrow on top
struct DotOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) col: vec4f };
@vertex fn vs_mapdot(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> DotOut {
  var o: DotOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  let c = casters[i];
  if (c.w == 0.0 || c.y < -500.0) { return o; }
  let me = i32(i) == i32(u.map2.y);
  let rm = max(abs(c.w), u.map2.z) * select(1.0, 2.2, me);
  let k = CORNERS[v];
  var off = k;
  if (me) { let a = u.map2.w; off = vec2f(k.x * cos(a) - k.y * sin(a), k.x * sin(a) + k.y * cos(a)); }
  let p = toMap(vec3f(c.x, 0.0, c.z));
  o.pos = vec4f(p.xy + vec2f(off.x, -off.y) * rm / u.map.z, 0.0, 1.0);
  o.uv = k;
  o.col = select(vec4f(select(slotColor(f32(i)), vec3f(0.85), c.w < 0.0), 0.0), vec4f(1.0, 1.0, 1.0, 1.0), me);
  return o;
}
@fragment fn fs_mapdot(d: DotOut) -> @location(0) vec4f {
  if (d.col.a > 0.5) { // an arrowhead pointing +x in its own frame: where I face
    let q = d.uv;
    let inside = q.x > -0.6 && abs(q.y) < (0.9 - q.x) * 0.62 && !(q.x < -0.1 && abs(q.y) < (0.0 - q.x) * 0.8);
    let rim = q.x > -0.85 && abs(q.y) < (1.0 - q.x) * 0.7;
    if (inside) { return vec4f(1.0, 1.0, 1.0, 1.0); }
    if (rim) { return vec4f(0.0, 0.0, 0.0, 1.0); }
    discard;
  }
  let r = length(d.uv);
  if (r > 1.0) { discard; }
  return vec4f(select(d.col.rgb, d.col.rgb * 0.25, r > 0.7), 1.0);
}

// ---- decals: flat on whatever is at their height, glowing
struct DOut { @builtin(position) pos: vec4f, @location(0) q: vec2f, @location(1) @interpolate(flat) col: vec4f, @location(2) @interpolate(flat) prm: vec4f };
@vertex fn vs_decal(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> DOut {
  var o: DOut;
  let a = decals[3u * i];
  let b = decals[3u * i + 1u];
  let R = b.x * 1.05 + 0.05;
  let k = CORNERS[v];
  o.pos = clip(vec3f(a.x + k.x * R, a.y + 0.025, a.z + k.y * R));
  o.q = k * R;
  o.col = decals[3u * i + 2u];
  o.prm = b;
  return o;
}
@fragment fn fs_decal(d: DOut) -> @location(0) vec4f {
  let r = length(d.q);
  let fw = max(fwidth(r), 1e-4);
  let R = d.prm.x;
  let w = max(d.prm.y, 0.02);
  let t = u.fwd.w;
  var a = 0.0;
  var hot = 0.0;
  let rim = smoothstep(R - w - fw, R - w + fw, r) * (1.0 - smoothstep(R - fw, R + fw, r));
  let core = 1.0 - clamp(abs(r - (R - w * 0.5)) / (w * 0.5), 0.0, 1.0);
  switch u32(d.prm.z + 0.5) {
    case 1u: { // a disc, brighter at its rim
      a = (1.0 - smoothstep(R - fw, R + fw, r)) * (0.6 + 0.4 * smoothstep(R * 0.6, R, r));
    }
    case 2u: { // a zone: faint inside, a bright rim, ripples going in
      let rip = smoothstep(0.75, 1.0, fract(r / max(R, 0.1) * 3.0 + t * 0.6)) * (1.0 - smoothstep(R - fw, R, r));
      a = max(rim, (1.0 - smoothstep(R - fw, R + fw, r)) * (0.16 + 0.22 * rip));
      hot = core * rim;
    }
    case 3u: { // a target: a ring, a dot in the middle, four ticks pointing in
      let dot0 = 1.0 - smoothstep(w * 0.9 - fw, w * 0.9 + fw, r);
      let ax = min(abs(d.q.x), abs(d.q.y));
      let tick = (1.0 - smoothstep(w * 0.25 - fw, w * 0.25 + fw, ax)) * smoothstep(R * 0.45, R * 0.45 + fw, r) * (1.0 - smoothstep(R - w, R - w + fw, r));
      a = max(max(rim, dot0), tick);
      hot = core * rim;
    }
    default: { a = rim; hot = core; }
  }
  let k = a * d.col.a;
  if (k <= 0.002) { discard; }
  return vec4f(d.col.rgb * k * (1.0 + 0.7 * hot), k * 0.8);
}

// ---- falling snow round the eye, in the world
struct FOutS { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) a: f32 };
@vertex fn vs_snow(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> FOutS {
  var o: FOutS;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  if (u.ambSky.w <= 0.0) { return o; }
  let B = 44.0;
  let t = u.fwd.w;
  let h = vec3f(hashf(i * 3u), hashf(i * 3u + 1u), hashf(i * 3u + 2u));
  var p = h * B + vec3f(t * 1.1 + sin(t * 0.7 + h.x * 30.0) * 0.8, -t * (1.2 + 0.8 * h.y), t * 0.5 + cos(t * 0.6 + h.z * 30.0) * 0.8);
  p = u.cam.xyz + (fract((p - u.cam.xyz) / B) - 0.5) * B;
  let r = p - u.cam.xyz;
  let z = dot(r, u.fwd.xyz);
  if (z < 0.4) { return o; }
  let s = u.cam.w / z;
  let px = clamp(0.045 * s, 0.9, 5.0);
  let c = CORNERS[v];
  let sc = vec2f(u.screen.x * 0.5 + dot(r, u.right.xyz) * s, u.screen.y * 0.5 - dot(r, u.up.xyz) * s) + c * (px + 0.5);
  o.pos = vec4f(sc.x / u.screen.x * 2.0 - 1.0, 1.0 - sc.y / u.screen.y * 2.0, NEAR / z, 1.0);
  o.uv = c;
  o.a = u.ambSky.w * smoothstep(0.4, 1.5, z) * (1.0 - smoothstep(B * 0.3, B * 0.5, z)) * min(1.0, 0.045 * s / 0.9) * 0.9;
  return o;
}
@fragment fn fs_snow(f: FOutS) -> @location(0) vec4f {
  let r2 = dot(f.uv, f.uv);
  if (r2 > 1.0) { discard; }
  let a = f.a * (1.0 - r2);
  return vec4f(vec3f(0.95, 0.97, 1.0) * a, a);
}

// ---- sprites (bumper's)
struct SOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
  @location(2) @interpolate(flat) kind: u32,
  @location(3) @interpolate(flat) info: vec4f, // view z, world radius, seed, roll
  @location(4) @interpolate(flat) vel: vec3f,
  @location(5) @interpolate(flat) ctr: vec3f,
};

fn project(q: vec3f) -> vec4f {
  let r = q - u.cam.xyz;
  let z = dot(r, u.fwd.xyz);
  let s = u.cam.w / max(z, 0.01);
  return vec4f(u.screen.x * 0.5 + dot(r, u.right.xyz) * s, u.screen.y * 0.5 - dot(r, u.up.xyz) * s, z, s);
}

@vertex fn vs_sprite(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> SOut {
  var o: SOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  if (i >= u32(u.screen.z)) { return o; }
  let a = sprites[4u * i];
  let info = sprites[4u * i + 2u];
  let pr = project(a.xyz);
  if (pr.z < 0.3) { return o; }
  let big = select(1.0, 1.4, u32(info.x) == 11u); // a bomb's fuse and spark stand out over it
  let half = vec2f(a.w, a.w * info.y) * big;
  let px = max(half * pr.w, vec2f(info.z, info.z * info.y)) + 0.5; // half a pixel more, for the edge's smoothing
  let s = pr.xy + CORNERS[v] * px;
  o.pos = vec4f(s.x / u.screen.x * 2.0 - 1.0, 1.0 - s.y / u.screen.y * 2.0, NEAR / pr.z, 1.0);
  o.uv = CORNERS[v] * px / max(half * pr.w, vec2f(info.z, info.z * info.y));
  o.color = sprites[4u * i + 1u];
  o.kind = u32(info.x);
  let vr = sprites[4u * i + 3u];
  o.info = vec4f(pr.z, a.w * big, info.w, vr.w);
  o.vel = vr.xyz;
  o.ctr = a.xyz;
  return o;
}

fn glyphBit(ch: u32, px: vec2i) -> bool {
  if (px.x < 0 || px.x > 2 || px.y < 0 || px.y > 4) { return false; }
  return ((font[ch - 32u] >> u32(14 - (px.y * 3 + px.x))) & 1u) == 1u;
}

// A look's ball and hat (client/looks.mjs PATTERN and STYLE), drawn in the
// ball's own turning frame m and the head's facing f; colours linear.
fn unrgb(v: f32) -> vec3f {
  let k = u32(v + 0.5);
  return vec3f(f32((k >> 16u) & 255u), f32((k >> 8u) & 255u), f32(k & 255u)) / 255.0;
}
fn lookBall(pattern: u32, m: vec3f, a: vec3f, b: vec3f) -> vec3f {
  let lon = atan2(m.z, m.x) / 6.2832 + 0.5;
  var o = a;
  switch pattern {
    case 0u: { // beach: six panels, a, white and b, white at the poles
      let seg = u32(floor(lon * 6.0)) % 3u;
      o = select(select(b, vec3f(0.85), seg == 1u), a, seg == 0u);
      if (abs(m.y) > 0.9) { o = vec3f(0.85); }
    }
    case 1u: { // five bands round it
      o = select(a, b, (u32(floor((m.y * 0.5 + 0.5) * 5.0)) & 1u) == 1u);
    }
    case 2u: { // eight ribs from pole to pole
      o = mix(b, a, smoothstep(0.15, 0.55, abs(sin(lon * 6.2832 * 4.0))));
    }
    case 5u: { // the eight ball: a white spot on top at rest, an 8 on it
      if (m.y > 0.8) {
        o = b;
        let q = vec2i(floor((vec2f(m.x, m.z) / 0.45 + vec2f(0.75, 1.0)) * vec2f(2.0, 2.5)));
        if (glyphBit(56u, q)) { o = vec3f(0.02); }
      }
    }
    default: {}
  }
  return o;
}
fn lookHat(style: u32, n: vec3f, f: vec3f, side: vec3f, c: vec3f, skin: vec3f) -> vec3f {
  let a = atan2(dot(n, side), dot(n, f)) / 6.2832 + 0.5; // round the head, 0..1
  var o = skin;
  switch style {
    case 0u: { if (n.y > 0.45 || (n.y > 0.3 && dot(n, f) > 0.25)) { o = c; } } // a cap
    case 2u: { if (n.y > 0.12) { o = select(c, c * 0.7, n.y < 0.3); } } // a beanie, its brim turned up
    case 3u: { if (n.y > 0.28 && n.y < 0.5) { o = c; } } // a headband
    case 4u: { // a helmet, open at the face, a stripe over the top
      if (n.y > -0.1 && !(dot(n, f) > 0.5 && n.y < 0.45)) { o = select(c, c * 0.3, abs(dot(n, side)) < 0.1 && n.y > 0.35); }
    }
    case 5u: { // a crown: points all round, a red stone at the front
      let zig = abs(fract(a * 5.0) * 2.0 - 1.0);
      if (n.y > 0.3 && n.y < 0.5 + 0.32 * zig) { o = c; }
      if (dot(n, normalize(f + vec3f(0.0, 0.7, 0.0))) > 0.985) { o = vec3f(0.85, 0.04, 0.06); }
    }
    case 6u: { // a pumpkin for a head: ribs, a stalk and a lit grin
      o = c * (0.75 + 0.25 * abs(sin(a * 6.2832 * 4.0)));
      if (n.y > 0.92) { o = vec3f(0.12, 0.3, 0.06); }
      if (dot(n, f) > 0.7 && n.y < -0.12 && n.y > -0.4 && abs(dot(n, side)) < 0.45) { o = vec3f(1.6, 0.9, 0.25); }
    }
    default: {}
  }
  return o;
}

// glossy, as the balls are: the sun's highlight and the sky in it, more at a grazing angle
fn gloss(c: vec3f, n: vec3f, power: f32, k: f32) -> vec3f {
  let v = -u.fwd.xyz;
  let r = reflect(-v, n);
  let fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  return c + u.sunc.rgb * pow(max(dot(r, u.sun.xyz), 0.0), power) * k + sky(r) * fres * k * 0.6;
}

struct FOut { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 };
@fragment fn fs_sprite(s: SOut) -> FOut {
  var o: FOut;
  let rr = length(s.uv);
  let fw = max(fwidth(rr), 1e-4);
  let fwU = fwidth(s.uv);
  var cover = clamp((1.0 - rr) / fw + 0.5, 0.0, 1.0);
  let r2 = min(rr * rr, 1.0);
  let h = sqrt(1.0 - r2);
  // the sphere's normal at this pixel, in the world
  let n = normalize(u.right.xyz * s.uv.x - u.up.xyz * s.uv.y - u.fwd.xyz * h);
  var c = lin(s.color.rgb);
  var z = s.info.x - h * s.info.y;
  let ink = 1.0 - 0.6 * smoothstep(0.86, 0.97, rr);
  let surf = s.ctr + n * s.info.y;
  switch s.kind {
    case 0u: { // a ball: beach-ball panels turning as it rolls, white at the poles; or a look's (alpha 2 + its pattern, the seed its second colour)
      let flat = vec3f(s.vel.x, 0.0, s.vel.z);
      var m = n;
      if (dot(flat, flat) > 1e-4) {
        let dir = normalize(flat);
        m = turn(n, vec3f(dir.z, 0.0, -dir.x), -s.info.w);
      }
      let look = u32(s.color.a + 0.5);
      var alb: vec3f;
      var shine = 1.0;
      if (look <= 1u) {
        let seg = u32(floor((atan2(m.z, m.x) / 6.2832 + 0.5) * 6.0)) % 3u;
        let other = lin(slotColor(s.info.z + 0.5));
        alb = select(select(other, vec3f(0.85), seg == 1u), c, seg == 0u);
        if (abs(m.y) > 0.9) { alb = vec3f(0.85); }
      } else {
        alb = lookBall(look - 2u, m, c, lin(unrgb(s.info.z)));
        if (look == 6u) { shine = 2.0; } // metal
      }
      let sh = shadowAt(surf, n);
      let ao = mix(0.55, 1.0, smoothstep(-0.9, 0.2, n.y));
      c = gloss(shade(alb, n, sh, ao), n, 60.0, 0.5 * shine * (0.35 + 0.65 * sh)) * ink;
    }
    case 1u: { // a rider's body, in its colour
      c = gloss(shade(c * 0.8, n, shadowAt(surf, n), 1.0), n, 20.0, 0.2) * ink;
    }
    case 8u: { // a rider's head: skin, a cap in its colour, two eyes looking where the ball faces; or a look's hat (alpha 2 + its style)
      let f = normalize(vec3f(s.vel.x, 0.0, s.vel.z) + vec3f(1e-5, 0.0, 0.0));
      let side = vec3f(-f.z, 0.0, f.x);
      var alb = lin(vec3f(1.0, 0.8, 0.66));
      let hat = u32(s.color.a + 0.5);
      if (hat <= 1u) {
        if (n.y > 0.45 || (n.y > 0.3 && dot(n, f) > 0.25)) { alb = c; }
      } else {
        alb = lookHat(hat - 2u, n, f, side, c, alb);
      }
      for (var k = -1; k <= 1; k += 2) {
        let eye = normalize(f * 0.86 + side * 0.4 * f32(k) + vec3f(0.0, 0.1, 0.0));
        let dd = dot(n, eye);
        if (hat == 8u) { if (dd > 0.96) { alb = vec3f(1.6, 0.9, 0.25); } continue; } // a pumpkin's eyes, lit from inside
        if (dd > 0.955) { alb = vec3f(0.95); }
        if (dd > 0.985) { alb = vec3f(0.02); }
      }
      c = gloss(shade(alb, n, shadowAt(surf, n), 1.0), n, 30.0, 0.15) * ink;
    }
    case 2u: { // an orb: tinted glass glowing from inside, a white ? in it
      var g = c * (0.6 + 0.6 * h) + gloss(vec3f(0.0), n, 80.0, 1.0);
      let q = vec2i(floor((s.uv / 0.75 + vec2f(0.75, 1.0)) * vec2f(2.0, 2.5)));
      if (glyphBit(63u, q) && rr < 0.75) { g = vec3f(2.5); }
      c = g * (0.8 + 0.2 * ink);
    }
    case 6u: { // the arrow over your own ball
      cover = select(1.0, 0.0, s.uv.y > 0.6 - abs(s.uv.x) * 1.4 || s.uv.y < -0.9 || (abs(s.uv.x) > 0.3 && s.uv.y < -0.1));
      c = c * 1.6;
      z = s.info.x;
    }
    case 9u: { // a crumb, in its colour
      c = shade(c, n, 1.0, 1.0) * ink;
    }
    case 10u: { // a coin: gold, spinning about the up axis, a raised rim and a star
      let spin = u.fwd.w * 3.2 + s.info.z * 1.7 + s.info.w;
      let cs = cos(spin);
      let wd = max(abs(cs), 0.1);
      let q = vec2f(s.uv.x / wd, s.uv.y);
      let rq = length(q);
      cover = clamp((1.0 - rq) / max(fwU.x / wd + fwU.y, 1e-4) + 0.5, 0.0, 1.0);
      let ax = u.right.xyz * cs + u.fwd.xyz * sin(spin);       // across its face
      let face = normalize(cross(ax, vec3f(0.0, 1.0, 0.0))) * sign(cs + 1e-6);
      var nn = face;
      if (rq > 0.78) { nn = normalize(face + (ax * q.x - vec3f(0.0, 1.0, 0.0) * q.y) * 1.4 * smoothstep(0.78, 1.0, rq)); }
      // a five-pointed star, raised
      let ang = atan2(q.x, -q.y);
      let sr = 0.5 * (0.55 + 0.45 * cos(ang * 5.0)) ;
      let star = 1.0 - smoothstep(sr * 0.95 + 0.03, sr * 0.95 + 0.09, rq);
      if (rq < 0.6) { nn = normalize(face + (ax * q.x - vec3f(0.0, 1.0, 0.0) * q.y) * 0.25 * star); }
      let gold = c * select(0.62, 1.0, star > 0.5 || rq > 0.78);
      let r = reflect(u.fwd.xyz, nn);
      let lum = 0.75 + 0.6 * max(dot(nn, u.sun.xyz), 0.0) + 0.3 * nn.y;
      c = gold * lum * 1.15 + vec3f(1.0, 0.9, 0.6) * (pow(max(dot(r, u.sun.xyz), 0.0), 30.0) * 1.2 + pow(1.0 - abs(dot(nn, u.fwd.xyz)), 3.0) * 0.4);
      if (abs(cs) < 0.12) { c = gold * 0.75 * (0.8 + 0.4 * fract(s.uv.y * 8.0)); }
      c *= 1.0 - 0.45 * smoothstep(0.9, 1.0, rq);
      z = s.info.x;
    }
    case 11u: { // a bomb: a glossy body, a metal cap, a fuse with a spark; roll heats it red
      let br = 0.72;
      let bq = (s.uv - vec2f(0.0, 0.12)) / br;
      let rb = length(bq);
      let hb = sqrt(max(1.0 - rb * rb, 0.0));
      let nb = normalize(u.right.xyz * bq.x - u.up.xyz * bq.y - u.fwd.xyz * hb);
      let heat = clamp(s.info.w, 0.0, 1.0) * (0.5 + 0.5 * sin(u.fwd.w * (8.0 + 20.0 * s.info.w)));
      let capQ = s.uv - vec2f(0.0, -0.62);
      let inCap = abs(capQ.x) < 0.2 && abs(capQ.y) < 0.1;
      let fuseX = 0.06 * sin((s.uv.y + 0.72) * 9.0);
      let inFuse = s.uv.y < -0.7 && s.uv.y > -0.9 && abs(s.uv.x - fuseX) < 0.035;
      let sp = s.uv - vec2f(0.06 * sin(1.62), -0.92);
      let spark = (1.0 - smoothstep(0.0, 0.11 + 0.06 * sin(u.fwd.w * 40.0 + s.info.z), length(sp))) * (1.0 + 0.6 * heat);
      cover = 0.0;
      if (spark > 0.05) { c = vec3f(5.0, 3.6, 1.4) * spark; cover = 1.0; z = s.info.x - s.info.y; }
      else if (inFuse) { c = vec3f(0.25, 0.18, 0.1); cover = 1.0; z = s.info.x; }
      else if (inCap) { c = shade(vec3f(0.55), normalize(u.right.xyz * capQ.x * 4.0 - u.fwd.xyz), 1.0, 1.0); cover = 1.0; z = s.info.x - s.info.y * 0.5; }
      if (rb < 1.0) {
        cover = clamp((1.0 - rb) / (fw / br) + 0.5, 0.0, 1.0);
        let body = mix(c, vec3f(1.0, 0.08, 0.04), heat * 0.85);
        c = gloss(shade(body, nb, shadowAt(s.ctr + nb * s.info.y * br, nb), 1.0) + vec3f(1.6, 0.1, 0.05) * heat * 0.4, nb, 70.0, 0.7);
        c *= 1.0 - 0.6 * smoothstep(0.86, 0.97, rb);
        z = s.info.x - hb * s.info.y * br;
      }
    }
    default: { // a rocket
      c = mix(vec3f(3.0, 2.8, 2.2), c * 2.0, r2);
    }
  }
  if (cover <= 0.0) { discard; }
  o.color = vec4f(finish(c, s.pos.xy), cover);
  o.depth = clamp(NEAR / max(z, NEAR), 0.0, 1.0);
  return o;
}

// glowing, blended: 3 a flash, 4 a ring going out, 5 a four-pointed spark
@fragment fn fs_glow(s: SOut) -> @location(0) vec4f {
  let r2 = dot(s.uv, s.uv);
  if (r2 > 1.0) { discard; }
  var a = s.color.a * (1.0 - r2) * (1.0 - r2);
  if (s.kind == 4u) { a = s.color.a * smoothstep(0.6, 0.9, r2) * smoothstep(1.0, 0.92, r2) * 3.0; }
  if (s.kind == 5u) { a = s.color.a * max(0.0, 1.0 - min(abs(s.uv.x), abs(s.uv.y)) * 9.0) * (1.0 - sqrt(r2)); }
  return vec4f(mix(s.color.rgb, vec3f(1.0, 1.0, 0.95), (1.0 - r2) * a) * a, a);
}

// ---- beams: a quad between two projected points
struct BOut { @builtin(position) pos: vec4f, @location(0) color: vec4f, @location(1) across: f32 };
@vertex fn vs_beam(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> BOut {
  var o: BOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  if (i >= u32(u.counts.z)) { return o; }
  let a = beams[3u * i];
  let b = beams[3u * i + 1u];
  var pa = project(a.xyz);
  var pb = project(b.xyz);
  if (pa.z < 0.3 && pb.z < 0.3) { return o; }
  if (pa.z < 0.3) { let t = (0.3 - pa.z) / (pb.z - pa.z); pa = project(mix(a.xyz, b.xyz, t)); }
  if (pb.z < 0.3) { let t = (0.3 - pb.z) / (pa.z - pb.z); pb = project(mix(b.xyz, a.xyz, t)); }
  let dd = pb.xy - pa.xy;
  let n = normalize(vec2f(-dd.y, dd.x) + vec2f(1e-6, 0.0));
  let c = CORNERS[v];
  let end = select(pa, pb, c.x > 0.0);
  let w = max(a.w * end.w, 0.8);
  let s = end.xy + n * c.y * w;
  o.pos = vec4f(s.x / u.screen.x * 2.0 - 1.0, 1.0 - s.y / u.screen.y * 2.0, clamp(NEAR / end.z, 0.0, 1.0), 1.0);
  o.color = beams[3u * i + 2u];
  o.across = c.y;
  return o;
}
@fragment fn fs_beam(b: BOut) -> @location(0) vec4f {
  let a = b.color.a * (1.0 - abs(b.across));
  return vec4f(b.color.rgb * a, a);
}

// ---- HUD, in HUD pixels: the screen's over the HUD scale, the text block centred
var<private> PALETTE: array<vec3f, 8> = array<vec3f, 8>(vec3f(1.0), vec3f(1.0, 0.85, 0.25), vec3f(1.0, 0.35, 0.3), vec3f(0.4, 1.0, 0.4),
  vec3f(0.6), vec3f(0.5, 0.85, 1.0), vec3f(1.0, 0.6, 0.2), vec3f(0.8, 0.55, 1.0));

fn cellBit(cell: vec2i, px: vec2i) -> bool {
  if (cell.x < 0 || cell.y < 0 || cell.x >= ${COLS} || cell.y >= i32(u.hud.x)) { return false; }
  let ch = hud[u32(cell.y) * ${COLS}u + u32(cell.x)] & 255u;
  if (ch < 32u || ch > 95u) { return false; }
  return glyphBit(ch, px);
}
fn lit(p: vec2i) -> bool {
  if (p.x < 0 || p.y < 0) { return false; }
  let cell = vec2i(p.x / 4, p.y / 6);
  return cellBit(cell, vec2i(p.x - cell.x * 4, p.y - cell.y * 6));
}

fn graphPx(p: vec2i) -> vec4f {
  let col = p.x - (${COLS * 4} - ${GRAPH_N + 4});
  if (u.hud.y < 0.5 || col < 0 || col >= ${GRAPH_N}) { return vec4f(0.0); }
  let k = (p.y - 18) / 24;
  let yy = p.y - 18 - 24 * k;
  if (p.y < 18 || k >= ${GRAPH_PANELS} || yy >= 17) { return vec4f(0.0); }
  let v = graph[u32(k * ${GRAPH_N} + col)];
  let f = (16.5 - f32(yy)) / 17.0;
  let near = 0.5 / 17.0;
  if (yy == 16) { return vec4f(0.35, 0.35, 0.35, 0.8); }
  if (k == 0) {
    if (abs(f - v.w) < near) { return vec4f(PALETTE[5], 1.0); }
    if (f < v.x) { return vec4f(PALETTE[3], 0.9); }
    if (f < v.x + v.y) { return vec4f(PALETTE[6], 0.9); }
    if (f < v.x + v.y + v.z) { return vec4f(PALETTE[7], 0.9); }
  } else if (k == 1) {
    if (f < v.x) { return vec4f(PALETTE[6], 0.9); }
  } else if (k == 2) {
    if (abs(f - v.x) < near) { return vec4f(PALETTE[1], 1.0); }
    if (abs(f - v.y) < near) { return vec4f(PALETTE[5], 1.0); }
  } else {
    if (v.y > 3.5) { return vec4f(PALETTE[2], 1.0); }
    if (v.y > 2.5) { return vec4f(PALETTE[7], 1.0); }
    if (v.y > 1.5) { return vec4f(0.35, 0.55, 1.0, 1.0); }
    if (v.x > 0.5 && f < 0.6) { return vec4f(PALETTE[3], 1.0); }
  }
  return vec4f(0.0, 0.0, 0.0, 0.5);
}

// Big text (s.big): up to ${MAX_BIG} lines of the same font, each pixel of it scale HUD pixels a side, kept in the
// hud buffer after the cells: x, y (HUD px, the line's top left), scale, colour | length << 8, then four characters
// a word. The palette colour of the line lit at p, or -1; shadow 1 asks for its drop shadow instead.
fn bigAt(p: vec2i, shadow: i32) -> i32 {
  let base = u32(u.hud.x) * ${COLS}u;
  for (var k = 0u; k < ${MAX_BIG}u; k++) {
    let o = base + k * ${BIG_WORDS}u;
    let s = bitcast<i32>(hud[o + 2u]);
    if (s <= 0) { continue; }
    let l = p - vec2i(bitcast<i32>(hud[o]), bitcast<i32>(hud[o + 1u])) - vec2i(shadow * max(1, s / 3));
    let n = i32(hud[o + 3u] >> 8u);
    if (l.x < 0 || l.y < 0 || l.x >= n * 4 * s || l.y >= 6 * s) { continue; }
    let g = l / s;
    let i = g.x / 4;
    let ch = (hud[o + 4u + u32(i) / 4u] >> (8u * (u32(i) & 3u))) & 255u;
    if (ch >= 32u && ch <= 95u && glyphBit(ch, vec2i(g.x - i * 4, g.y))) { return i32(hud[o + 3u] & 7u); }
  }
  return -1;
}

// The minimap: the stage from above (drawn this frame into its texture), a disc turned the way you face, or a
// square with north up; in screen pixels.
fn miniPx(q: vec2f) -> vec4f {
  let d = q - u.mini.xy;
  let R = u.mini.z;
  let square = u.misc.y > 0.5;
  let dd = select(length(d), max(abs(d.x), abs(d.y)), square);
  if (R <= 0.0 || dd > R + 2.0 * u.hud.w) { return vec4f(0.0); }
  if (dd > R) { return vec4f(1.0, 0.95, 0.85, 0.85); }
  var w = d / R;
  if (!square) {
    let f = normalize(vec2f(u.fwd.x, u.fwd.z) + vec2f(1e-6, 0.0));
    let rt = vec2f(-f.y, f.x);
    w = f * -w.y + rt * w.x;
  }
  let c = textureSampleLevel(mapTex, mapSamp, w * 0.5 + 0.5, 0.0);
  return vec4f(c.rgb, max(c.a, 0.5));
}

@fragment fn fs_hud(@builtin(position) q: vec4f) -> @location(0) vec4f {
  let p = vec2i(floor((q.xy - vec2f(u.misc.z, 0.0)) / u.hud.w));
  if (lit(p)) {
    let cell = vec2i(p.x / 4, p.y / 6);
    let k = (hud[u32(cell.y) * ${COLS}u + u32(cell.x)] >> 8u) & 7u;
    return vec4f(PALETTE[k], 1.0);
  }
  let b = bigAt(p, 0);
  if (b >= 0) { return vec4f(PALETTE[b], 1.0); }
  if (lit(p - vec2i(1, 1))) { return vec4f(0.0, 0.0, 0.0, 0.75); }
  if (bigAt(p, 1) >= 0) { return vec4f(0.0, 0.0, 0.0, 0.75); }
  let g = graphPx(p);
  if (g.a > 0.0) { return g; }
  for (var k = i32(u.counts.w) - 1; k >= 0; k--) {
    let r = rects[2u * u32(k)];
    if (q.x >= r.x && q.x < r.z && q.y >= r.y && q.y < r.w) { return rects[2u * u32(k) + 1u]; }
  }
  let m = miniPx(q.xy);
  if (m.a > 0.0) { return m; }
  let c = vec2f(u.screen.x, u.screen.y) * 0.5;
  let d = (q.xy - c) / c;
  // a flash at the edges, bumped hard or going down; and always a soft vignette
  let rd = length(d);
  let fl = u.hud.z * smoothstep(0.45, 1.4, rd) * 0.7;
  if (fl > 0.003) { return vec4f(1.0, 0.92, 0.7, fl); }
  let vig = smoothstep(0.75, 1.45, rd);
  if (vig > 0.0) { return vec4f(0.0, 0.0, 0.0, vig * 0.45); }
  discard;
  return vec4f(0.0);
}
`;

export async function createRenderer(canvas, { present = true, hudScale = 2, device: shared = null } = {}) {
  // a page with several renderers (Fireplace) gives them one device, so one can draw into another's texture
  let device = shared;
  if (!device) {
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) throw new Error('WebGPU is not available in this browser');
    device = await adapter.requestDevice();
  }
  device.addEventListener('uncapturederror', (e) => console.error('WebGPU:', e.error.message));
  const format = navigator.gpu.getPreferredCanvasFormat();
  const ctx = present ? canvas.getContext('webgpu') : null;
  ctx?.configure({ device, format, alphaMode: 'opaque' });
  const W = canvas.width, H = canvas.height;
  const hs = hudScale;
  const rows = Math.floor(H / hs / 6);
  const hudX = Math.max(0, Math.floor((W / hs - COLS * 4) / 2)) * hs; // the text block, centred
  const module = device.createShaderModule({ code: WGSL });
  const info = await module.getCompilationInfo();
  const errs = info.messages.filter((m) => m.type === 'error');
  if (errs.length) throw new Error('WGSL: ' + errs.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; '));

  const UF = 25 * 4;
  const ubuf = device.createBuffer({ size: UF * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const storage = (size) => device.createBuffer({ size: Math.max(16, size), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  let cap = 0, solidBuf = null, orderBuf = null;
  const casterBuf = storage(MAX_CASTER * 16);
  const spriteBuf = storage(MAX_SPRITE * 64);
  const beamBuf = storage(MAX_BEAM * 48);
  const rectBuf = storage(MAX_RECT * 32);
  const hudBuf = storage((COLS * rows + MAX_BIG * BIG_WORDS) * 4);
  const fontBuf = storage(FONT.length * 4);
  const graphBuf = storage(GRAPH_PANELS * GRAPH_N * 16);
  const decalBuf = storage(MAX_DECAL * 48);
  const paletteBuf = storage(256 * 16);
  device.queue.writeBuffer(fontBuf, 0, FONT);
  const vbuf = device.createBuffer({ size: MESH.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const ibuf = device.createBuffer({ size: MESH.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(vbuf, 0, MESH.vertices);
  device.queue.writeBuffer(ibuf, 0, MESH.indices);

  const TB = GPUTextureUsage.TEXTURE_BINDING, RA = GPUTextureUsage.RENDER_ATTACHMENT, CD = GPUTextureUsage.COPY_DST;
  const shadowTex = device.createTexture({ size: [SHADOW_N, SHADOW_N], format: 'depth32float', usage: TB | RA });
  const mapTex = device.createTexture({ size: [MAP_N, MAP_N], format: 'rgba8unorm', usage: TB | RA });
  const mapDepth = device.createTexture({ size: [MAP_N, MAP_N], format: 'depth32float', usage: RA });
  const maskTex = device.createTexture({ size: [MASK_N, MASK_N], format: 'rg8unorm', usage: TB | RA });
  let paintTex = device.createTexture({ size: [1, 1], format: 'r8uint', usage: TB | CD });
  let paintN = 0, paintVersion = null, paintCells = null;
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const cmpSampler = device.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });
  const colorMs = device.createTexture({ size: [W, H], format, sampleCount: MSAA, usage: RA });
  const depth = device.createTexture({ size: [W, H], format: 'depth32float', sampleCount: MSAA, usage: RA });

  const FRAG = GPUShaderStage.FRAGMENT, VERT = GPUShaderStage.VERTEX;
  // storage buffers go to the one stage that reads them: there are more than a stage may have
  const g0Layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: VERT | FRAG, buffer: { type: 'uniform' } },
      ...[[1, VERT], [2, VERT], [3, VERT], [4, VERT], [5, VERT], [6, FRAG], [7, FRAG], [8, FRAG], [9, FRAG], [10, VERT], [11, FRAG]]
        .map(([binding, visibility]) => ({ binding, visibility, buffer: { type: 'read-only-storage' } })),
    ],
  });
  const g1Layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: FRAG, texture: { sampleType: 'depth' } },
      { binding: 1, visibility: FRAG, sampler: { type: 'comparison' } },
      { binding: 2, visibility: FRAG, texture: { sampleType: 'float' } },
      { binding: 3, visibility: FRAG, sampler: { type: 'filtering' } },
      { binding: 4, visibility: FRAG, texture: { sampleType: 'uint' } },
    ],
  });
  const g2Layout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: FRAG, texture: { sampleType: 'float' } }, { binding: 1, visibility: FRAG, sampler: { type: 'filtering' } }],
  });
  let g0 = null, g1 = null;
  const makeG0 = () => {
    g0 = device.createBindGroup({
      layout: g0Layout,
      entries: [{ binding: 0, resource: { buffer: ubuf } },
        ...[solidBuf, orderBuf, casterBuf, spriteBuf, beamBuf, rectBuf, hudBuf, fontBuf, graphBuf, decalBuf, paletteBuf].map((buffer, k) => ({ binding: 1 + k, resource: { buffer } }))],
    });
  };
  const makeG1 = () => {
    g1 = device.createBindGroup({
      layout: g1Layout,
      entries: [{ binding: 0, resource: shadowTex.createView() }, { binding: 1, resource: cmpSampler }, { binding: 2, resource: maskTex.createView() },
        { binding: 3, resource: sampler }, { binding: 4, resource: paintTex.createView() }],
    });
  };
  const g2 = device.createBindGroup({ layout: g2Layout, entries: [{ binding: 0, resource: mapTex.createView() }, { binding: 1, resource: sampler }] });
  const grow = (n) => {
    cap = Math.max(1024, Math.ceil(n / 1024) * 1024);
    solidBuf?.destroy(); orderBuf?.destroy();
    solidBuf = storage(cap * 64);
    orderBuf = storage(cap * 8);
    makeG0();
  };
  grow(24000);
  makeG1();

  const plShadow = device.createPipelineLayout({ bindGroupLayouts: [g0Layout] });
  const plMap = device.createPipelineLayout({ bindGroupLayouts: [g0Layout, g1Layout] });
  const plMain = device.createPipelineLayout({ bindGroupLayouts: [g0Layout, g1Layout, g2Layout] });
  const meshLayout = [{ arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] }];
  const over = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
  const add = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
  const pipe = (vs, fs, { depthWrite, depthCompare, blend, coverage = false, mesh = false, cull = 'none' }) => device.createRenderPipeline({
    layout: plMain,
    vertex: { module, entryPoint: vs, buffers: mesh ? meshLayout : [] },
    fragment: { module, entryPoint: fs, targets: [{ format, blend }] },
    primitive: { topology: 'triangle-list', cullMode: cull },
    depthStencil: { format: 'depth32float', depthWriteEnabled: depthWrite, depthCompare },
    multisample: { count: MSAA, alphaToCoverageEnabled: coverage },
  });
  const world = pipe('vs_full', 'fs_world', { depthWrite: true, depthCompare: 'always' });
  const solidPipe = pipe('vs_solid', 'fs_solid', { depthWrite: true, depthCompare: 'greater', mesh: true, cull: 'back' });
  const clearPipe = pipe('vs_solid', 'fs_solid_t', { depthWrite: false, depthCompare: 'greater', mesh: true, cull: 'back', blend: over });
  const sprite = pipe('vs_sprite', 'fs_sprite', { depthWrite: true, depthCompare: 'greater', coverage: true });
  const decal = pipe('vs_decal', 'fs_decal', { depthWrite: false, depthCompare: 'greater', blend: add });
  const glow = pipe('vs_sprite', 'fs_glow', { depthWrite: false, depthCompare: 'greater', blend: add });
  const beam = pipe('vs_beam', 'fs_beam', { depthWrite: false, depthCompare: 'greater', blend: add });
  const snow = pipe('vs_snow', 'fs_snow', { depthWrite: false, depthCompare: 'greater', blend: add });
  const hudPipe = pipe('vs_full', 'fs_hud', { depthWrite: false, depthCompare: 'always', blend: over });
  // the shadow map stores the far side of things from the sun (front faces culled), so lit faces never shade themselves
  const shadowPipe = (vs) => device.createRenderPipeline({
    layout: plShadow,
    vertex: { module, entryPoint: vs, buffers: meshLayout },
    primitive: { topology: 'triangle-list', cullMode: 'front' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 1, depthBiasSlopeScale: 1.5 },
  });
  const shadowSolid = shadowPipe('vs_shadow');
  const shadowBall = shadowPipe('vs_shadow_ball');
  const contactPipe = device.createRenderPipeline({
    layout: plShadow,
    vertex: { module, entryPoint: 'vs_contact' },
    fragment: { module, entryPoint: 'fs_contact', targets: [{ format: 'rg8unorm', blend: { color: { operation: 'max', srcFactor: 'one', dstFactor: 'one' }, alpha: { operation: 'max', srcFactor: 'one', dstFactor: 'one' } } }] },
    primitive: { topology: 'triangle-list' },
  });
  const mapPipe = device.createRenderPipeline({
    layout: plMap,
    vertex: { module, entryPoint: 'vs_map', buffers: meshLayout },
    fragment: { module, entryPoint: 'fs_map', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
  });
  const dotPipe = device.createRenderPipeline({
    layout: plMap,
    vertex: { module, entryPoint: 'vs_mapdot' },
    fragment: { module, entryPoint: 'fs_mapdot', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'always' },
  });

  const uf = new Float32Array(UF);
  const hud = new Uint32Array(COLS * rows + MAX_BIG * BIG_WORDS);
  const cells = COLS * rows;
  let order = new Uint32Array(cap * 2), vis = new Uint8Array(cap), keyZ = new Float32Array(cap);
  const casterData = new Float32Array(MAX_CASTER * 4);
  const spriteData = new Float32Array(MAX_SPRITE * 16);
  const beamData = new Float32Array(MAX_BEAM * 12);
  const rectData = new Float32Array(MAX_RECT * 8);
  const decalData = new Float32Array(MAX_DECAL * 12);
  const cnt = new Int32Array(12), start = new Int32Array(12), fill = new Int32Array(12);
  const env = new Float32Array(28);
  let envName = null, lastTime = null, frames = 0, mapNow = false;
  const empty = new Scene(1);
  const NOCAST = [];

  function setEnv(name, time) {
    const want = ENV_PACKED[name] || ENV_PACKED.day;
    const dt = lastTime === null ? 1e9 : time - lastTime;
    lastTime = time;
    if (envName === null || dt < 0 || dt > 0.5) env.set(want);
    else {
      // a change of backdrop eases in over half a second or so
      const k = 1 - Math.exp(-dt / 0.35);
      for (let i = 0; i < 28; i++) env[i] += (want[i] - env[i]) * k;
      const n = Math.hypot(env[0], env[1], env[2]) || 1;
      env[0] /= n; env[1] /= n; env[2] /= n;
    }
    envName = name;
  }

  return {
    rows, width: W, height: H, hudScale: hs, hudX, device,
    // s: { cam: [x, y, z], yaw, pitch, time (s), slot (-1 none),
    //      env: 'day' | 'sunset' | 'night' | 'snow' (a change eases in over half a second),
    //      focus: [x, z] (or [x, y, z]), extent (m): the square the shadow map and the balls' contact shade cover,
    //      scene: a Scene,
    //      casters: [[x, y, z, r]], index = slot for balls: a ball's bottom at y, radius r, a rider over it (riders: false
    //               for none); r < 0 a round thing of radius -r centred at y (an orb, a bomb, a coin); r 0 or y < -500 nothing,
    //      solid: [sprite], glow: [sprite], sprite { pos, size, color: [r,g,b,a], kind (SPRITE), aspect, minpx, seed, vel, roll }:
    //               a COIN's size is its radius, roll turns it; a BOMB's size is its body's radius, roll 0..1 how hot it is,
    //      beams: [{ a, b, width, color }],
    //      decals: [{ pos: [x, y, z], radius, width, color: [r, g, b, a], kind (DECAL) }], flat at y, glowing,
    //      paint: null | { cells: Uint8Array(n * n) (cells[j * n + i] covers x0 + (i + 0.5) * size / n, z0 + (j + 0.5) * size / n),
    //               n, origin: [x0, z0], size (the grid's side, m), palette: Float32Array(1024) (rgba 0..1, index 0..255;
    //               alpha 0 leaves the solid's own colour), version (uploaded when it or cells changes) },
    //      rects: [[x0, y0, x1, y1, r, g, b, a]] (screen px), text: Uint32Array(COLS * rows), graph (client/netgraph.mjs), flash 0..1,
    //      big: [{ text, x, y, scale, color }] (up to MAX_BIG lines of BIG_CHARS: the HUD font scale times over, its top
    //               left at x, y in HUD pixels from the text block's corner (a cell is 4 x 6), a palette colour C.*),
    //      mini: [cx, cy, radius px, world radius] | null, miniShape: 'disc' (turns the way you face) | 'square' (north up),
    //      miniCentre: [x, z] (the focus) }
    frame(u8, s, target) {
      if (!ctx && !target) return;
      const scene = s.scene || empty;
      const casters = s.casters || NOCAST;
      const nc = Math.min(casters.length, MAX_CASTER);
      const focal = Math.min(W, H * 1.6) * 0.62;
      const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw), cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
      const fwd = [cp * cy, sp, cp * sy], right = [-sy, 0, cy], up = [-sp * cy, cp, -sp * sy];
      const cam = s.cam;
      setEnv(s.env || 'day', s.time || 0);

      // the solids by draw: those in view by shape (opaque, then see-through, far to near), and all of them by shape
      // for the shadow map and the minimap; and how high and low the stage goes round the focus
      const n = scene.count, D = scene.data;
      if (n > cap) { grow(n); order = new Uint32Array(cap * 2); vis = new Uint8Array(cap); keyZ = new Float32Array(cap); }
      const xz = (p) => (p && p.length > 2 ? [p[0], p[2]] : p);
      const focus = xz(s.focus) || [cam[0], cam[2]];
      const ext = s.extent || 60;
      const kx = W / 2 / focal, ky = H / 2 / focal, nx = 1 / Math.sqrt(1 + kx * kx), ny = 1 / Math.sqrt(1 + ky * ky);
      cnt.fill(0);
      let y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < n; i++) {
        const o = i * 16;
        const sh = D[o + 3] & 3;
        const rx = D[o] - cam[0], ry = D[o + 1] - cam[1], rz = D[o + 2] - cam[2];
        const rad = Math.sqrt(D[o + 4] * D[o + 4] + D[o + 5] * D[o + 5] + D[o + 6] * D[o + 6]);
        const z = rx * fwd[0] + ry * fwd[1] + rz * fwd[2];
        const x = rx * right[0] + rz * right[2];
        const y = rx * up[0] + ry * up[1] + rz * up[2];
        cnt[8 + sh]++;
        if (z > -rad && (Math.abs(x) - z * kx) * nx < rad && (Math.abs(y) - z * ky) * ny < rad) {
          const k = sh + (D[o + 14] < 1 ? 4 : 0);
          cnt[k]++;
          vis[i] = k + 1;
          keyZ[i] = z;
        } else vis[i] = 0;
        if (Math.abs(D[o] - focus[0]) < ext + rad && Math.abs(D[o + 2] - focus[1]) < ext + rad) {
          y0 = Math.min(y0, D[o + 1] - D[o + 5]);
          y1 = Math.max(y1, D[o + 1] + D[o + 5]);
        }
      }
      let acc = 0;
      for (let k = 0; k < 8; k++) { start[k] = acc; acc += cnt[k]; }
      for (let k = 8; k < 12; k++) { start[k] = acc; acc += cnt[k]; }
      fill.set(start);
      for (let i = 0; i < n; i++) {
        if (vis[i]) order[fill[vis[i] - 1]++] = i;
        order[fill[8 + (D[i * 16 + 3] & 3)]++] = i;
      }
      for (let k = 4; k < 8; k++) {
        if (cnt[k] > 1 && cnt[k] <= 4096) order.subarray(start[k], start[k] + cnt[k]).sort((a, b) => keyZ[b] - keyZ[a]);
      }
      for (let k = 0; k < nc; k++) {
        const c = casters[k];
        if (c[3] === 0 || c[1] < -500) continue;
        if (Math.abs(c[0] - focus[0]) < ext && Math.abs(c[2] - focus[1]) < ext) { y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1] + 2 * Math.abs(c[3]) + 1.2); }
      }
      if (y0 > y1) { y0 = cam[1] - 30; y1 = cam[1]; }
      // whole metres, four at a time, so the shadow map holds still while things move
      y0 = Math.floor(y0 / 4) * 4 - 2;
      y1 = Math.ceil(y1 / 4) * 4 + 2;

      // the shadow map: square to the sun, over the focus square and the stage's height there, snapped to its texels
      const sun = [env[0], env[1], env[2]];
      const lx = (() => { const v = [sun[2], 0, -sun[0]]; const l = Math.hypot(...v); return v.map((a) => a / l); })();
      const ly = [sun[1] * lx[2] - sun[2] * lx[1], sun[2] * lx[0] - sun[0] * lx[2], sun[0] * lx[1] - sun[1] * lx[0]];
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const mid = [focus[0], (y0 + y1) / 2, focus[1]];
      let half = 0, dmin = Infinity, dmax = -Infinity;
      for (const ax of [-1, 1]) for (const ay of [y0, y1]) for (const az of [-1, 1]) {
        const p = [focus[0] + ax * ext, ay, focus[1] + az * ext];
        const q = [p[0] - mid[0], p[1] - mid[1], p[2] - mid[2]];
        half = Math.max(half, Math.abs(dot(q, lx)), Math.abs(dot(q, ly)));
        const d = -dot(p, sun);
        dmin = Math.min(dmin, d); dmax = Math.max(dmax, d);
      }
      half = Math.ceil(half / 2) * 2;
      dmin -= 40; // whatever is high over the square still casts into it
      const texel = 2 * half / SHADOW_N;
      const cx = Math.round(dot(mid, lx) / texel) * texel, cyy = Math.round(dot(mid, ly) / texel) * texel;
      const span = dmax - dmin;
      const shadowsOn = n > 0 || nc > 0;

      // the minimap's square: its centre (the focus) and the world radius it shows
      const mini = s.mini || null;
      const mc = xz(s.miniCentre) || focus;
      const mr = mini ? mini[3] : ext;

      uf.set([cam[0], cam[1], cam[2], focal,
        ...fwd, s.time || 0,
        ...right, 0,
        ...up, 0,
        W, H, 0, 0,
        0, nc, 0, 0,
        rows, s.graph ? 1 : 0, s.flash || 0, hs,
        ...(mini || [0, 0, 0, 1]),
        s.slot ?? -1, s.miniShape === 'square' ? 1 : 0, hudX, s.riders === false ? 0 : 1]);
      uf.set(env, 36);
      uf[63] = shadowsOn ? 1 : 0;
      uf.set([lx[0] / half, lx[1] / half, lx[2] / half, -cx / half,
        ly[0] / half, ly[1] / half, ly[2] / half, -cyy / half,
        -sun[0] / span, -sun[1] / span, -sun[2] / span, -dmin / span,
        texel, texel * 1.5, 0.02 / span, 0,
        focus[0] - ext, focus[1] - ext, 1 / (2 * ext), y0,
        y1 - y0, 0, 0, 0,
        0, 0, 0, 0,
        mc[0], mc[1], mr, y1,
        y1 - y0, s.slot ?? -1, 2.2 * (2 * mr / MAP_N), s.yaw], 64);

      // the paint layer, when it changes
      const pt = s.paint;
      if (pt && pt.n > 0) {
        if (pt.n !== paintN) {
          paintTex.destroy();
          paintTex = device.createTexture({ size: [pt.n, pt.n], format: 'r8uint', usage: TB | CD });
          paintN = pt.n;
          paintVersion = null;
          makeG1();
        }
        if (pt.version !== paintVersion || pt.cells !== paintCells) {
          device.queue.writeTexture({ texture: paintTex }, pt.cells, { bytesPerRow: pt.n }, [pt.n, pt.n]);
          device.queue.writeBuffer(paletteBuf, 0, pt.palette, 0, 1024);
          paintVersion = pt.version;
          paintCells = pt.cells;
        }
        uf.set([pt.origin[0], pt.origin[1], 1 / pt.size, pt.n], 88);
      }

      // sprites, solid ones first, then what glows
      let ns = 0;
      const putSprite = (p) => {
        const c = p.color, v = p.vel, o = ns * 16;
        spriteData[o] = p.pos[0]; spriteData[o + 1] = p.pos[1]; spriteData[o + 2] = p.pos[2]; spriteData[o + 3] = p.size;
        spriteData[o + 4] = c[0]; spriteData[o + 5] = c[1]; spriteData[o + 6] = c[2]; spriteData[o + 7] = c[3] ?? 1;
        spriteData[o + 8] = p.kind; spriteData[o + 9] = p.aspect ?? 1; spriteData[o + 10] = p.minpx ?? 1; spriteData[o + 11] = p.seed ?? 0;
        spriteData[o + 12] = v ? v[0] : 0; spriteData[o + 13] = v ? v[1] : 0; spriteData[o + 14] = v ? v[2] : 0; spriteData[o + 15] = p.roll ?? 0;
        ns++;
      };
      for (const p of s.solid || NOCAST) { if (ns >= MAX_SPRITE) break; putSprite(p); }
      const nSolid = ns;
      for (const p of s.glow || NOCAST) { if (ns >= MAX_SPRITE) break; putSprite(p); }
      uf[18] = ns; uf[19] = nSolid;
      let nd = 0;
      for (const d of s.decals || NOCAST) {
        if (nd >= MAX_DECAL) break;
        const c = d.color, o = nd * 12;
        decalData[o] = d.pos[0]; decalData[o + 1] = d.pos[1]; decalData[o + 2] = d.pos[2];
        decalData[o + 4] = d.radius; decalData[o + 5] = d.width ?? 0.3; decalData[o + 6] = d.kind ?? 0;
        decalData[o + 8] = c[0]; decalData[o + 9] = c[1]; decalData[o + 10] = c[2]; decalData[o + 11] = c[3] ?? 1;
        nd++;
      }
      let nb = 0;
      for (const b of s.beams || NOCAST) {
        if (nb >= MAX_BEAM) break;
        const o = nb * 12;
        beamData[o] = b.a[0]; beamData[o + 1] = b.a[1]; beamData[o + 2] = b.a[2]; beamData[o + 3] = b.width;
        beamData[o + 4] = b.b[0]; beamData[o + 5] = b.b[1]; beamData[o + 6] = b.b[2];
        beamData[o + 8] = b.color[0]; beamData[o + 9] = b.color[1]; beamData[o + 10] = b.color[2]; beamData[o + 11] = b.color[3] ?? 1;
        nb++;
      }
      const rects = s.rects || NOCAST;
      const nr = Math.min(rects.length, MAX_RECT);
      for (let k = 0; k < nr; k++) rectData.set(rects[k], k * 8);
      uf[20] = nd; uf[22] = nb; uf[23] = nr;
      for (let k = 0; k < nc; k++) { const c = casters[k]; casterData[4 * k] = c[0]; casterData[4 * k + 1] = c[1]; casterData[4 * k + 2] = c[2]; casterData[4 * k + 3] = c[3]; }

      const q = device.queue;
      q.writeBuffer(ubuf, 0, uf);
      if (n) q.writeBuffer(solidBuf, 0, D, 0, n * 16);
      if (acc) q.writeBuffer(orderBuf, 0, order, 0, acc);
      if (nc) q.writeBuffer(casterBuf, 0, casterData, 0, nc * 4);
      if (ns) q.writeBuffer(spriteBuf, 0, spriteData, 0, ns * 16);
      if (nd) q.writeBuffer(decalBuf, 0, decalData, 0, nd * 12);
      if (nb) q.writeBuffer(beamBuf, 0, beamData, 0, nb * 12);
      if (nr) q.writeBuffer(rectBuf, 0, rectData, 0, nr * 8);
      if (s.graph) q.writeBuffer(graphBuf, 0, s.graph);
      if (s.text) hud.set(s.text.subarray(0, cells)); else hud.fill(0, 0, cells);
      hud.fill(0, cells);
      for (let k = 0; k < Math.min(MAX_BIG, s.big?.length || 0); k++) {
        const b = s.big[k], o = cells + k * BIG_WORDS, t = String(b.text).toUpperCase().slice(0, BIG_CHARS);
        hud[o] = b.x | 0; hud[o + 1] = b.y | 0; hud[o + 2] = Math.max(0, b.scale | 0); hud[o + 3] = ((b.color ?? 0) & 7) | (t.length << 8);
        for (let i = 0; i < t.length; i++) hud[o + 4 + (i >> 2)] |= (t.charCodeAt(i) & 255) << (8 * (i & 3));
      }
      q.writeBuffer(hudBuf, 0, hud);

      const enc = device.createCommandEncoder();
      const meshDraw = (pass, names, k, from = 0) => {
        for (let sh = 0; sh < 4; sh++) {
          const c = cnt[k + sh];
          if (!c) continue;
          const m = MESH.parts[names[sh]];
          pass.drawIndexed(m.count, c, m.first, 0, start[k + sh] + from);
        }
      };
      // the sun's view: every solid, every ball and rider
      {
        const pass = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: shadowTex.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 } });
        pass.setBindGroup(0, g0);
        pass.setVertexBuffer(0, vbuf);
        pass.setIndexBuffer(ibuf, 'uint16');
        pass.setPipeline(shadowSolid);
        meshDraw(pass, SHADOW_MESH, 8);
        if (nc) {
          pass.setPipeline(shadowBall);
          const m = MESH.parts.sphereLo;
          pass.drawIndexed(m.count, nc * 3, m.first, 0, 0);
        }
        pass.end();
      }
      // the balls' contact shade
      {
        const pass = enc.beginRenderPass({ colorAttachments: [{ view: maskTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
        if (nc) {
          pass.setBindGroup(0, g0);
          pass.setPipeline(contactPipe);
          pass.draw(6, nc);
        }
        pass.end();
      }
      // the minimap: the stage from above, then the dots, mine last
      // (a big stage's every other frame: it is a lot of solids for a little picture)
      frames++;
      if (mini && (n < 6000 || frames % 2 === 0 || mapNow)) {
        const pass = enc.beginRenderPass({
          colorAttachments: [{ view: mapTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0.04, 0.16, 0.28, 0.55] }],
          depthStencilAttachment: { view: mapDepth.createView(), depthLoadOp: 'clear', depthStoreOp: 'discard', depthClearValue: 1 },
        });
        pass.setBindGroup(0, g0);
        pass.setBindGroup(1, g1);
        pass.setVertexBuffer(0, vbuf);
        pass.setIndexBuffer(ibuf, 'uint16');
        pass.setPipeline(mapPipe);
        meshDraw(pass, SHAPE_MESH, 8);
        if (nc) {
          pass.setPipeline(dotPipe);
          pass.draw(6, nc);
          const me = s.slot ?? -1;
          if (me >= 0 && me < nc) pass.draw(6, 1, 0, me);
        }
        pass.end();
      }
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: colorMs.createView(), resolveTarget: (target || ctx.getCurrentTexture()).createView(), loadOp: 'clear', storeOp: 'discard', clearValue: [0, 0, 0, 1] }],
        depthStencilAttachment: { view: depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'discard', depthClearValue: 0 },
      });
      pass.setBindGroup(0, g0);
      pass.setBindGroup(1, g1);
      pass.setBindGroup(2, g2);
      pass.setVertexBuffer(0, vbuf);
      pass.setIndexBuffer(ibuf, 'uint16');
      pass.setPipeline(world);
      pass.draw(3);
      pass.setPipeline(solidPipe);
      meshDraw(pass, SHAPE_MESH, 0);
      pass.setPipeline(sprite);
      if (nSolid) pass.draw(6, nSolid, 0, 0);
      pass.setPipeline(decal);
      if (nd) pass.draw(6, nd);
      pass.setPipeline(clearPipe);
      meshDraw(pass, SHAPE_MESH, 4);
      pass.setPipeline(beam);
      if (nb) pass.draw(6, nb);
      pass.setPipeline(glow);
      if (ns > nSolid) pass.draw(6, ns - nSolid, 0, nSolid);
      if (env[19] > 0.01) { pass.setPipeline(snow); pass.draw(6, FLAKES); }
      pass.setPipeline(hudPipe);
      pass.draw(3);
      pass.end();
      q.submit([enc.finish()]);
    },

    async capture(u8, s) {
      const tex = device.createTexture({ size: [W, H], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      mapNow = true;
      this.frame(u8, s, tex);
      mapNow = false;
      const row = Math.ceil(W * 4 / 256) * 256;
      const buf = device.createBuffer({ size: row * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = device.createCommandEncoder();
      enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: row }, [W, H]);
      device.queue.submit([enc.finish()]);
      await buf.mapAsync(GPUMapMode.READ);
      const src = new Uint8Array(buf.getMappedRange());
      const rgba = new Uint8ClampedArray(W * H * 4);
      const bgra = format === 'bgra8unorm';
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * row + x * 4, o = (y * W + x) * 4;
          rgba[o] = src[i + (bgra ? 2 : 0)]; rgba[o + 1] = src[i + 1]; rgba[o + 2] = src[i + (bgra ? 0 : 2)]; rgba[o + 3] = 255;
        }
      }
      buf.unmap();
      buf.destroy();
      tex.destroy();
      return { width: W, height: H, rgba };
    },
  };
}
