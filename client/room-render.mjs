// Fireplace's room: the living room at grandma's, at night. A brick fireplace
// with a fire going, pumpkins on the mantel, a walnut console TV with rabbit
// ears showing the game, a rug, a wooden floor, a snowy window. Drawn like
// the cheese, every pixel solved exactly: the room is a few dozen boxes, two
// spheres and two thin rods, traced in one pass, lit by the fire (flickering,
// its shadow cast through the firebox's mouth), by the TV (whatever colour
// the game on it is), and by the snow light from the window. The flames are a
// short march through the firebox. The TV's glass is curved, with scanlines,
// a shadow mask and a glow; as the camera closes in the curve and the lines
// fade, so the last frame of a zoom is the game as it is drawn on its own.
// Shares the page's GPU device, so the TV can show a texture a game drew.
import { FONT } from './font.mjs';

// The TV's glass, in room metres (on its cabinet's front face, z = SCREEN_Z).
export const SCREEN = { x0: 0.48, x1: 1.52, y0: 0.27, y1: 0.9, z: 3.05 };

const WGSL = /* wgsl */ `
struct U {
  cam: vec4f,    // eye, focal (px)
  fwd: vec4f,    // axes; fwd.w the time (s)
  right: vec4f,  // right.w: how far zoomed in, 0 (the couch) to 1 (the glass fills the screen)
  up: vec4f,     // up.w: the TV's picture, 0 the game to 1 the card
  screen: vec4f, // width, height, the fire's flicker now, the TV's brightness
  tv: vec4f,     // the TV light's colour, and whether the set is on
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var game: texture_2d<f32>;
@group(0) @binding(2) var card: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;

const PI = 3.14159265;
const FIRE = vec3f(-1.8, 0.45, 3.68);
const TVC = vec3f(1.0, 0.585, 3.05);

fn hash2(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn hash3(p: vec3f) -> f32 { return fract(sin(dot(p, vec3f(127.1, 311.7, 74.7))) * 43758.5453); }
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2f(1.0, 0.0)), s.x), mix(hash2(i + vec2f(0.0, 1.0)), hash2(i + vec2f(1.0, 1.0)), s.x), s.y);
}
fn fbm(p: vec2f) -> f32 { return 0.5 * vnoise(p) + 0.25 * vnoise(p * 2.1 + 3.7) + 0.125 * vnoise(p * 4.3 + 1.3); }
fn lin(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }

// ---- the room's things: boxes (min, max, material), the room's own planes
const NB = 30u;
// boxes, by index: 0-4 the fireplace (pillars, lintel and chimney breast, base, the firebox's back),
// 5 the mantel, 6 the hearth, 7-9 two logs and a grate, 10-15 the TV (cabinet, legs, the antenna's foot),
// 16 a picture over the mantel, 17-19 board games, 20-21 a side table and its lamp, 22-27 the window's
// frame (sill, head, sides, the cross), 28-29 the couch's arm and back, close by, out of focus
var<private> BLO: array<vec3f, 30> = array<vec3f, 30>(
  vec3f(-2.9, 0.0, 3.45),
  vec3f(-1.25, 0.0, 3.45),
  vec3f(-2.35, 1.02, 3.45),
  vec3f(-2.35, 0.0, 3.45),
  vec3f(-2.35, 0.12, 3.88),
  vec3f(-3.05, 1.22, 3.28),
  vec3f(-3.05, 0.0, 3.02),
  vec3f(-2.15, 0.14, 3.6),
  vec3f(-2.02, 0.25, 3.68),
  vec3f(-2.2, 0.12, 3.58),
  vec3f(0.3, 0.1, 3.05),
  vec3f(0.36, 0.0, 3.1),
  vec3f(1.96, 0.0, 3.1),
  vec3f(0.36, 0.0, 3.62),
  vec3f(1.96, 0.0, 3.62),
  vec3f(1.1, 1.02, 3.3),
  vec3f(-2.45, 1.55, 3.95),
  vec3f(2.3, 0.0, 3.3),
  vec3f(2.33, 0.09, 3.33),
  vec3f(2.28, 0.16, 3.36),
  vec3f(-3.85, 0.0, 1.6),
  vec3f(-3.66, 0.6, 1.78),
  vec3f(2.45, 0.95, 3.9),
  vec3f(2.45, 2.2, 3.93),
  vec3f(2.45, 1.0, 3.93),
  vec3f(3.59, 1.0, 3.93),
  vec3f(3.02, 1.0, 3.95),
  vec3f(2.5, 1.58, 3.95),
  vec3f(-1.9, 0.0, -1.3),
  vec3f(-1.9, 0.0, -1.6)
);
var<private> BHI: array<vec3f, 30> = array<vec3f, 30>(
  vec3f(-2.35, 2.8, 4.0),
  vec3f(-0.7, 2.8, 4.0),
  vec3f(-1.25, 2.8, 4.0),
  vec3f(-1.25, 0.12, 4.0),
  vec3f(-1.25, 1.02, 4.0),
  vec3f(-0.55, 1.32, 4.0),
  vec3f(-0.55, 0.05, 3.45),
  vec3f(-1.45, 0.27, 3.73),
  vec3f(-1.58, 0.37, 3.8),
  vec3f(-1.4, 0.14, 3.82),
  vec3f(2.1, 1.02, 3.75),
  vec3f(0.44, 0.1, 3.18),
  vec3f(2.04, 0.1, 3.18),
  vec3f(0.44, 0.1, 3.7),
  vec3f(2.04, 0.1, 3.7),
  vec3f(1.3, 1.07, 3.5),
  vec3f(-1.15, 2.25, 4.0),
  vec3f(2.75, 0.09, 3.7),
  vec3f(2.71, 0.16, 3.66),
  vec3f(2.74, 0.22, 3.68),
  vec3f(-3.35, 0.6, 2.1),
  vec3f(-3.54, 0.95, 1.92),
  vec3f(3.65, 1.02, 4.0),
  vec3f(3.65, 2.26, 4.0),
  vec3f(2.51, 2.26, 4.0),
  vec3f(3.65, 2.26, 4.0),
  vec3f(3.08, 2.2, 4.0),
  vec3f(3.6, 1.62, 4.0),
  vec3f(-1.45, 0.72, 0.1),
  vec3f(1.9, 1.0, -1.3)
);
// materials: 0 brick, 1 soot, 2 dark wood, 3 stone, 4 log, 5 walnut, 6 metal, 7 picture, 8 board games, 9 table, 10 lamp, 11 white wood, 12 couch, 13 grate
var<private> MAT: array<u32, 30> = array<u32, 30>(0u, 0u, 0u, 0u, 1u, 2u, 3u, 4u, 4u, 13u, 5u, 6u, 6u, 6u, 6u, 6u, 7u, 8u, 8u, 8u, 9u, 10u, 11u, 11u, 11u, 11u, 11u, 11u, 12u, 12u);

struct Hit { t: f32, n: vec3f, m: u32, k: u32 };

fn slab(o: vec3f, inv: vec3f, lo: vec3f, hi: vec3f) -> vec2f {
  let a = (lo - o) * inv;
  let b = (hi - o) * inv;
  let tn = min(a, b);
  let tf = max(a, b);
  return vec2f(max(max(tn.x, tn.y), tn.z), min(min(tf.x, tf.y), tf.z));
}

fn sphere(o: vec3f, d: vec3f, c: vec3f, r: f32) -> f32 {
  let q = o - c;
  let b = dot(q, d);
  let disc = b * b - dot(q, q) + r * r;
  if (disc < 0.0) { return -1.0; }
  return -b - sqrt(disc);
}

// a thin rod from a to b, radius r: the nearest t, or -1
fn rod(o: vec3f, d: vec3f, a: vec3f, b: vec3f, r: f32) -> f32 {
  let ba = b - a;
  let oa = o - a;
  let baba = dot(ba, ba);
  let bard = dot(ba, d);
  let baoa = dot(ba, oa);
  let rdoa = dot(d, oa);
  let oaoa = dot(oa, oa);
  let qa = baba - bard * bard;
  let qb = baba * rdoa - baoa * bard;
  let qc = baba * oaoa - baoa * baoa - r * r * baba;
  let h = qb * qb - qa * qc;
  if (h < 0.0) { return -1.0; }
  let t = (-qb - sqrt(h)) / qa;
  let y = baoa + t * bard;
  if (y > 0.0 && y < baba) { return t; }
  return -1.0;
}

const ROD0A = vec3f(1.2, 1.07, 3.4);
const ROD0B = vec3f(0.78, 1.8, 3.48);
const ROD1B = vec3f(1.66, 1.84, 3.52);
const PUMP0 = vec4f(-2.7, 1.42, 3.6, 0.1);
const PUMP1 = vec4f(-0.85, 1.4, 3.55, 0.08);

fn trace(o: vec3f, d: vec3f, tmax: f32) -> Hit {
  var h: Hit;
  h.t = tmax;
  h.m = 99u;
  let inv = 1.0 / select(d, vec3f(1e-9), abs(d) < vec3f(1e-9));
  for (var k = 0u; k < NB; k++) {
    let s = slab(o, inv, BLO[k], BHI[k]);
    if (s.x <= s.y && s.x > 1e-4 && s.x < h.t) {
      h.t = s.x;
      h.m = MAT[k];
      h.k = k;
      let p = o + d * s.x;
      let c = (BLO[k] + BHI[k]) * 0.5;
      let e = (BHI[k] - BLO[k]) * 0.5;
      let q = (p - c) / e;
      let a = abs(q);
      if (a.x > a.y && a.x > a.z) { h.n = vec3f(sign(q.x), 0.0, 0.0); } else if (a.y > a.z) { h.n = vec3f(0.0, sign(q.y), 0.0); } else { h.n = vec3f(0.0, 0.0, sign(q.z)); }
    }
  }
  for (var k = 0; k < 2; k++) {
    let pp = select(PUMP1, PUMP0, k == 0);
    let t = sphere(o, d, pp.xyz, pp.w);
    if (t > 1e-4 && t < h.t) { h.t = t; h.m = 20u; h.n = normalize(o + d * t - pp.xyz); h.k = u32(k); }
  }
  for (var k = 0; k < 2; k++) {
    let t = rod(o, d, ROD0A, select(ROD1B, ROD0B, k == 0), 0.006);
    if (t > 1e-4 && t < h.t) { h.t = t; h.m = 6u; h.n = -d; }
  }
  // the room: floor, ceiling, walls (x -4..4, z -3..4, y 0..2.8)
  if (d.y < 0.0) { let t = -o.y / d.y; if (t < h.t) { h.t = t; h.m = 30u; h.n = vec3f(0.0, 1.0, 0.0); } }
  if (d.y > 0.0) { let t = (2.8 - o.y) / d.y; if (t < h.t) { h.t = t; h.m = 31u; h.n = vec3f(0.0, -1.0, 0.0); } }
  if (d.z > 0.0) { let t = (4.0 - o.z) / d.z; if (t < h.t) { h.t = t; h.m = 32u; h.n = vec3f(0.0, 0.0, -1.0); } }
  if (d.z < 0.0) { let t = (-3.0 - o.z) / d.z; if (t < h.t) { h.t = t; h.m = 32u; h.n = vec3f(0.0, 0.0, 1.0); } }
  if (d.x > 0.0) { let t = (4.0 - o.x) / d.x; if (t < h.t) { h.t = t; h.m = 32u; h.n = vec3f(-1.0, 0.0, 0.0); } }
  if (d.x < 0.0) { let t = (-4.0 - o.x) / d.x; if (t < h.t) { h.t = t; h.m = 32u; h.n = vec3f(1.0, 0.0, 0.0); } }
  return h;
}

// Is anything between p and q (the rods and pumpkins too small to bother with)?
fn blocked(p: vec3f, q: vec3f) -> bool {
  let d = q - p;
  let inv = 1.0 / select(d, vec3f(1e-9), abs(d) < vec3f(1e-9));
  for (var k = 0u; k < NB; k++) {
    if (k == 7u || k == 8u || k == 9u) { continue; } // the logs and grate: the fire is in them
    let s = slab(p, inv, BLO[k], BHI[k]);
    if (s.x <= s.y && s.x > 1e-3 && s.x < 0.999) { return true; }
  }
  return false;
}

fn brick(p: vec2f, soot: f32) -> vec3f {
  let row = floor(p.y / 0.075);
  let x = p.x / 0.21 + select(0.0, 0.5, (u32(row) & 1u) == 1u);
  let mortar = fract(p.y / 0.075) < 0.12 || fract(x) < 0.05;
  let id = vec2f(floor(x), row);
  var c = lin(vec3f(0.55, 0.22, 0.14)) * (0.7 + 0.5 * hash2(id)) * (0.85 + 0.3 * vnoise(p * 30.0));
  if (mortar) { c = lin(vec3f(0.55, 0.5, 0.44)) * 0.8; }
  return mix(c, vec3f(0.01), soot);
}

fn walnut(p: vec2f) -> vec3f {
  let g = fbm(vec2f(p.x * 1.5, p.y * 40.0) + vec2f(fbm(p * 4.0) * 2.0, 0.0));
  return lin(vec3f(0.36, 0.2, 0.1)) * (0.65 + 0.6 * g);
}

// The fire: how bright it is at p, inside the firebox (0 outside).
fn flame(p: vec3f, t: f32) -> f32 {
  let q = vec3f(p.x - FIRE.x, p.y - 0.2, p.z - 3.72);
  if (q.y < 0.0 || q.y > 0.8 || abs(q.x) > 0.5 || abs(q.z) > 0.15) { return 0.0; }
  let h = q.y / 0.8;
  let width = (0.42 - 0.3 * h) * (0.8 + 0.4 * vnoise(vec2f(q.y * 6.0 - t * 3.0, t)));
  let n = fbm(vec2f(q.x * 7.0, q.y * 5.0 - t * 4.0)) * fbm(vec2f(q.x * 13.0 + 5.0, q.y * 9.0 - t * 6.0));
  let shape = smoothstep(width, width * 0.2, abs(q.x)) * (1.0 - h) * (1.0 - h);
  return max(0.0, n * 3.2 * shape - 0.12) * smoothstep(0.15, 0.05, abs(q.z));
}
fn fireColor(i: f32) -> vec3f { return vec3f(2.4, 0.9, 0.22) * i + vec3f(1.6, 1.3, 0.6) * i * i; }

// The TV's picture at uv (0..1 across the glass): the game or the card, a CRT's curve,
// scanlines and mask fading as the camera closes in.
fn tvPicture(uv0: vec2f, px: vec2f) -> vec3f {
  let z = u.right.w;
  let bend = 0.12 * (1.0 - z);
  var uv = uv0 * 2.0 - 1.0;
  uv = uv * (1.0 + bend * dot(uv, uv) * 0.5);
  if (abs(uv.x) > 1.0 || abs(uv.y) > 1.0) { return vec3f(0.0); }
  let st = uv * 0.5 + 0.5;
  let gs = vec2f(textureDimensions(game));
  let gt = st * gs;
  var c = mix(textureSampleLevel(game, samp, st, 0.0).rgb, textureSampleLevel(card, samp, st, 0.0).rgb, u.up.w);
  c = lin(c);
  let lines = 1.0 - (1.0 - z) * 0.35 * (0.5 + 0.5 * cos(st.y * 2.0 * PI * min(gs.y, 400.0)));
  let mask = 1.0 - (1.0 - z) * 0.12 * step(0.5, fract(px.x / 3.0));
  let edge = smoothstep(1.0, 0.85, max(abs(uv.x), abs(uv.y)));
  c *= lines * mask * mix(edge, 1.0, z) * u.screen.w;
  // the set warming up: static until the picture comes
  if (u.tv.w < 0.99) {
    let n = hash3(vec3f(floor(st * vec2f(320.0, 200.0)), floor(u.fwd.w * 30.0)));
    c = mix(vec3f(n * 0.6), c, u.tv.w);
  }
  return c;
}

struct FOut { @location(0) color: vec4f };
@vertex fn vs_full(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
}

@fragment fn fs_room(@builtin(position) pix: vec4f) -> @location(0) vec4f {
  let d = normalize(u.fwd.xyz * u.cam.w + u.right.xyz * (pix.x - u.screen.x * 0.5) + u.up.xyz * (u.screen.y * 0.5 - pix.y));
  let o = u.cam.xyz;
  let t = u.fwd.w;
  let h = trace(o, d, 60.0);
  let p = o + d * h.t;
  var c = vec3f(0.0);
  var alb = vec3f(0.5);
  var emit = vec3f(0.0);
  var spec = 0.0;
  switch h.m {
    case 0u: { // brick, sootier toward the firebox's mouth
      let uvb = select(select(p.xy, p.zy, abs(h.n.x) > 0.5), p.xz, abs(h.n.y) > 0.5);
      let soot = smoothstep(0.6, 0.0, length(vec2f(p.x - FIRE.x, (p.y - 1.05) * 1.5))) * 0.8;
      alb = brick(uvb, soot);
    }
    case 1u: { alb = brick(p.xy, 0.85); }
    case 2u: { alb = lin(vec3f(0.24, 0.13, 0.07)) * (0.7 + 0.4 * fbm(vec2f(p.x * 3.0, p.y * 60.0))); spec = 0.2; }
    case 3u: { alb = lin(vec3f(0.45, 0.43, 0.4)) * (0.7 + 0.4 * vnoise(p.xz * 9.0)); }
    case 4u: { // a log, its underside glowing
      alb = lin(vec3f(0.18, 0.11, 0.06)) * (0.6 + 0.5 * vnoise(p.xz * 30.0 + p.y * 20.0));
      let ember = smoothstep(0.3, 0.12, p.y) * (0.5 + 0.5 * vnoise(p.xz * 25.0 + t * 0.7));
      emit = vec3f(1.6, 0.4, 0.05) * ember * u.screen.z;
    }
    case 5u: { // walnut, the screen's bezel, the speaker's grille, the knobs
      alb = walnut(select(p.xy, p.zy, abs(h.n.x) > 0.5));
      spec = 0.35;
      if (h.n.z < -0.5) {
        let sx = (p.x - ${SCREEN.x0}) / ${SCREEN.x1 - SCREEN.x0};
        let sy = (p.y - ${SCREEN.y0}) / ${SCREEN.y1 - SCREEN.y0};
        let bez = p.x > 0.4 && p.x < 1.6 && p.y > 0.2 && p.y < 0.97;
        let glass = sx > 0.0 && sx < 1.0 && sy > 0.0 && sy < 1.0;
        if (bez && !glass) { alb = lin(vec3f(0.08, 0.075, 0.07)); spec = 0.5; }
        if (glass) {
          // rounded corners
          let cq = abs(vec2f(sx, sy) * 2.0 - 1.0);
          let corner = length(max(cq - vec2f(0.9, 0.86), vec2f(0.0)));
          if (corner < 0.1) {
            emit = tvPicture(vec2f(sx, 1.0 - sy), pix.xy);
            alb = vec3f(0.02);
            spec = 0.9;
          } else { alb = lin(vec3f(0.08, 0.075, 0.07)); }
        }
        let grille = p.x > 1.68 && p.x < 2.02 && p.y > 0.25 && p.y < 0.82;
        if (grille) { alb = lin(vec3f(0.2, 0.15, 0.1)) * (0.6 + 0.4 * step(0.5, fract(p.x * 140.0)) * step(0.5, fract(p.y * 140.0))); spec = 0.0; }
        for (var k = 0; k < 2; k++) {
          let kc = vec2f(1.77 + 0.17 * f32(k), 0.91);
          if (distance(p.xy, kc) < 0.035) { alb = lin(vec3f(0.7, 0.68, 0.62)); spec = 0.9; }
        }
      }
    }
    case 6u: { alb = lin(vec3f(0.6, 0.6, 0.62)); spec = 0.8; }
    case 7u: { // the picture: a cozy cabin at dusk, in thick paint
      let q = vec2f((p.x + 2.45) / 1.3, (p.y - 1.55) / 0.7);
      let frame = q.x < 0.06 || q.x > 0.94 || q.y < 0.08 || q.y > 0.92;
      alb = mix(lin(vec3f(0.9, 0.55, 0.3)), lin(vec3f(0.25, 0.3, 0.55)), q.y);
      if (q.y < 0.35 + 0.1 * sin(q.x * 9.0)) { alb = lin(vec3f(0.85, 0.88, 0.92)); }
      if (abs(q.x - 0.55) < 0.12 && q.y > 0.3 && q.y < 0.5 + (0.12 - abs(q.x - 0.55))) { alb = lin(vec3f(0.35, 0.18, 0.1)); }
      if (abs(q.x - 0.55) < 0.03 && abs(q.y - 0.38) < 0.04) { emit = vec3f(1.2, 0.8, 0.3); }
      alb *= 0.8 + 0.3 * vnoise(q * 60.0);
      if (frame) { alb = lin(vec3f(0.5, 0.36, 0.12)); spec = 0.5; }
    }
    case 8u: { // board games, each box its own colour
      let k = f32(h.k);
      alb = lin(vec3f(0.5 + 0.4 * sin(k * 2.1), 0.4 + 0.4 * sin(k * 3.7 + 1.0), 0.4 + 0.4 * sin(k * 5.3 + 2.0)));
      if (h.n.y > 0.5 && fract(p.x * 8.0) < 0.5) { alb *= 1.3; }
    }
    case 9u: { alb = walnut(p.xy * 2.0); spec = 0.3; }
    case 10u: { alb = lin(vec3f(0.95, 0.85, 0.6)); emit = vec3f(1.3, 0.9, 0.45) * 0.6; }
    case 11u: { alb = lin(vec3f(0.85, 0.83, 0.78)); }
    case 12u: { alb = lin(vec3f(0.35, 0.12, 0.1)) * (0.7 + 0.3 * vnoise(p.xy * 40.0)); }
    case 13u: { alb = vec3f(0.02); spec = 0.5; }
    case 20u: { // a pumpkin: ribs and a stalk
      let q = p - select(PUMP1.xyz, PUMP0.xyz, h.k == 0u);
      let rib = 0.75 + 0.25 * abs(cos(atan2(q.z, q.x) * 4.0));
      alb = lin(vec3f(0.95, 0.42, 0.08)) * rib;
      if (h.n.y > 0.93) { alb = lin(vec3f(0.3, 0.35, 0.1)); }
      spec = 0.3;
    }
    case 30u: { // the floor: oak planks, and the rug
      let plank = floor(p.x / 0.16);
      let off = hash2(vec2f(plank, 3.0)) * 2.0;
      let seam = fract(p.x / 0.16) < 0.03 || fract((p.z + off) / 1.6) < 0.008;
      alb = lin(vec3f(0.55, 0.34, 0.18)) * (0.75 + 0.35 * hash2(vec2f(plank, floor((p.z + off) / 1.6)))) * (0.85 + 0.3 * fbm(vec2f(p.x * 30.0, p.z * 2.0)));
      if (seam) { alb *= 0.5; }
      spec = 0.25;
      let r = vec2f((p.x + 0.2) / 1.7, (p.z - 1.9) / 1.05);
      let rr = length(r);
      if (rr < 1.0) {
        let ring = fract(rr * 6.0);
        // a braided rug: rings of three yarns, twisted
        let yarn = u32(floor(rr * 14.0 + 0.1 * sin(atan2(r.y, r.x) * 30.0 + rr * 40.0))) % 3u;
        alb = select(select(lin(vec3f(0.5, 0.16, 0.1)), lin(vec3f(0.62, 0.45, 0.22)), yarn == 1u), lin(vec3f(0.3, 0.22, 0.14)), yarn == 2u) * (0.8 + 0.3 * vnoise(p.xz * 80.0));
        if (rr > 0.94) { alb = lin(vec3f(0.85, 0.75, 0.5)); }
        spec = 0.0;
      }
    }
    case 31u: { alb = lin(vec3f(0.55, 0.5, 0.45)); }
    default: { // wallpaper: cream and sage stripes, a darker baseboard, the window
      let a = select(p.x, p.z, abs(h.n.x) > 0.5);
      let stripe = fract(a / 0.3) < 0.5;
      alb = select(lin(vec3f(0.62, 0.66, 0.52)), lin(vec3f(0.78, 0.74, 0.6)), stripe) * (0.92 + 0.08 * vnoise(vec2f(a, p.y) * 20.0));
      if (fract(a / 0.3) < 0.52 && fract(a / 0.3) > 0.48) { alb *= 0.8; }
      if (p.y < 0.14) { alb = lin(vec3f(0.42, 0.28, 0.16)); }
      if (p.y > 2.66) { alb = lin(vec3f(0.75, 0.72, 0.65)); }
      // the window: the night outside, snow coming down past the glass
      if (h.n.z < -0.5 && p.x > 2.5 && p.x < 3.6 && p.y > 1.02 && p.y < 2.2) {
        let wq = vec2f(p.x - 2.5, p.y - 1.02);
        var night = mix(vec3f(0.02, 0.03, 0.08), vec3f(0.06, 0.09, 0.2), wq.y / 1.2);
        if (distance(wq, vec2f(0.85, 0.95)) < 0.07) { night = vec3f(0.9, 0.9, 0.8); }
        for (var k = 0; k < 3; k++) {
          let sc = 22.0 + f32(k) * 14.0;
          let g = wq * sc + vec2f(sin(t * 0.3 + f32(k)) * 2.0, t * (1.5 + f32(k) * 0.6));
          let id = floor(g);
          let f = fract(g) - 0.5 - (vec2f(hash2(id), hash2(id + 3.1)) - 0.5) * 0.6;
          if (hash2(id + 7.0) > 0.7 && length(f) < 0.12) { night += vec3f(0.6); }
        }
        if (wq.y < 0.12 + 0.03 * sin(wq.x * 12.0)) { night = vec3f(0.4, 0.42, 0.5); }
        emit = night;
        alb = vec3f(0.0);
        spec = 0.6;
      }
    }
  }
  // the light: the fire (shadowed, flickering), the TV, the snow light, a touch of ambient
  let fl = FIRE + vec3f(0.0, 0.1, -0.12);
  let lv = fl - p;
  let ld = length(lv);
  let l = lv / ld;
  var fire = vec3f(1.0, 0.52, 0.2) * 3.2 * u.screen.z / (1.0 + ld * ld * 0.45);
  if (blocked(p + h.n * 0.003, fl)) { fire *= 0.12; }
  let tvl = TVC + vec3f(0.0, 0.0, -0.05) - p;
  let td = length(tvl);
  let tvfacing = max(-tvl.z / td, 0.0);
  let tv = u.tv.rgb * 1.6 * tvfacing / (1.0 + td * td * 1.1);
  let snow = vec3f(0.06, 0.08, 0.16) * max(dot(h.n, normalize(vec3f(3.0, 1.6, 4.0) - p)), 0.0) / (1.0 + distance(p, vec3f(3.0, 1.6, 4.0)));
  // what bounces about a small room with a fire in it
  let amb = vec3f(0.07, 0.05, 0.04) * (0.8 + 0.2 * u.screen.z);
  let lambert = max(dot(h.n, l), 0.0);
  c = alb * (fire * lambert + tv * max(dot(h.n, normalize(tvl)), 0.0) + snow + amb) + emit;
  if (spec > 0.0) {
    let r = reflect(d, h.n);
    c += fire * spec * pow(max(dot(r, l), 0.0), 40.0) + u.tv.rgb * spec * 0.4 * pow(max(dot(r, normalize(tvl)), 0.0), 30.0);
  }
  // the flames, through whatever is in front of the firebox
  let inv = 1.0 / select(d, vec3f(1e-9), abs(d) < vec3f(1e-9));
  let fb = slab(o, inv, vec3f(-2.35, 0.12, 3.55), vec3f(-1.25, 1.02, 3.88));
  if (fb.x < fb.y && fb.y > 0.0 && fb.x < h.t + 0.01) {
    let t0 = max(fb.x, 0.0);
    let t1 = min(fb.y, h.t);
    var glow = 0.0;
    for (var k = 0; k < 14; k++) {
      let s = t0 + (t1 - t0) * (f32(k) + hash2(pix.xy + f32(k))) / 14.0;
      glow += flame(o + d * s, t);
    }
    c += fireColor(glow / 14.0 * 2.4 * u.screen.z);
  }
  // the fire's glow in the air, and the TV's
  let near = dot(fl - o, d);
  let miss = length(fl - o - d * max(near, 0.0));
  c += vec3f(1.0, 0.45, 0.12) * 0.035 * u.screen.z / (0.02 + miss * miss) * step(0.0, near) * select(0.15, 1.0, h.t > near - 0.4);
  // filmic, the display's gamma, grain, a warm vignette
  let a = c * 1.1;
  var outc = clamp((a * (2.51 * a + 0.03)) / (a * (2.43 * a + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
  outc = pow(outc, vec3f(1.0 / 2.2));
  let vd = (pix.xy / u.screen.xy - 0.5) * 2.0;
  outc *= mix(vec3f(1.0), vec3f(0.55, 0.45, 0.4), smoothstep(0.6, 1.5, length(vd)) * (1.0 - u.right.w));
  outc += (hash2(pix.xy + fract(t) * 91.0) - 0.5) * 0.03;
  return vec4f(outc, 1.0);
}
`;

// present: false draws only into a target (a capture): headless Chrome can't present WebGPU
export async function createRoom(canvas, device, { present = true } = {}) {
  const format = navigator.gpu.getPreferredCanvasFormat();
  const ctx = present ? canvas.getContext('webgpu') : null;
  ctx?.configure({ device, format, alphaMode: 'opaque' });
  const module = device.createShaderModule({ code: WGSL });
  const info = await module.getCompilationInfo();
  const errs = info.messages.filter((m) => m.type === 'error');
  if (errs.length) throw new Error('WGSL (room): ' + errs.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; '));
  const ubuf = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const pipe = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs_full' },
    fragment: { module, entryPoint: 'fs_room', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const blank = device.createTexture({ size: [4, 4], format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  // the card: a 2D canvas (the title, the standings) copied onto the TV
  const cardCanvas = new OffscreenCanvas(640, 400);
  const card = device.createTexture({ size: [640, 400], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
  const binds = new Map();
  const bindFor = (tex) => {
    if (!binds.has(tex)) binds.set(tex, device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: tex.createView() }, { binding: 2, resource: card.createView() }, { binding: 3, resource: sampler }] }));
    return binds.get(tex);
  };
  const uf = new Float32Array(24);
  const W = canvas.width, H = canvas.height;

  return {
    format, card: cardCanvas, width: W, height: H,
    // a texture a game draws the TV's picture into: its own size, the canvas format
    tvTexture: (w, h) => device.createTexture({ size: [w, h], format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC }),
    // after drawing on .card's context: its pixels up to the TV's card
    updateCard() {
      const img = cardCanvas.getContext('2d').getImageData(0, 0, 640, 400);
      device.queue.writeTexture({ texture: card }, img.data, { bytesPerRow: 640 * 4 }, [640, 400]);
    },
    // s: { cam, look (the point looked at), focal, time, zoom, cardMix, flicker, tvOn, tvLight: [r, g, b], game: GPUTexture | null }
    frame(s, target) {
      if (!ctx && !target) return;
      const f = [s.look[0] - s.cam[0], s.look[1] - s.cam[1], s.look[2] - s.cam[2]];
      const fl = Math.hypot(...f);
      const fw = f.map((v) => v / fl);
      // screen right is +x when looking down +z: the fire on the left, the TV on the right
      const rl = Math.hypot(fw[2], fw[0]) || 1;
      const rt = [fw[2] / rl, 0, -fw[0] / rl];
      const up = [fw[1] * rt[2] - fw[2] * rt[1], fw[2] * rt[0] - fw[0] * rt[2], fw[0] * rt[1] - fw[1] * rt[0]];
      uf.set([...s.cam, s.focal, ...fw, s.time, ...rt, s.zoom, ...up, s.cardMix, W, H, s.flicker, s.tvBright ?? 1, ...(s.tvLight || [0.2, 0.25, 0.3]), s.tvOn]);
      device.queue.writeBuffer(ubuf, 0, uf);
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: (target || ctx.getCurrentTexture()).createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
      pass.setPipeline(pipe);
      pass.setBindGroup(0, bindFor(s.game || blank));
      pass.draw(3);
      pass.end();
      device.queue.submit([enc.finish()]);
    },
    async capture(s) {
      const tex = device.createTexture({ size: [W, H], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      this.frame(s, tex);
      const rgba = await readTexture(device, tex, W, H, format);
      tex.destroy();
      return { width: W, height: H, rgba };
    },
  };
}

// A texture's pixels, RGBA, for a screenshot.
export async function readTexture(device, tex, W, H, format) {
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
  return rgba;
}

export { FONT };
