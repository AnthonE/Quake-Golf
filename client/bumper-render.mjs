// Bumper balls' WebGPU renderer, for the web: drawn at the window's own
// resolution with 4x multisampling, lit by a sun and a sky, tone-mapped.
// Nothing is ray-marched: the cheese is a disc with holes, so every pixel
// solves for it exactly. That gives the wheel's top with its little eyes and
// the rounded lip of every hole, the rind, the wall of each hole a ray falls
// into (in the sun's shadow below its lip, darker the deeper; holes that
// overlap open into each other), the sea far below with the wheel's shadow
// and the sun's glint on it, and a sky with clouds. The balls' soft shadows,
// and the ring where a falling orb will land, come from a small mask drawn
// each frame on the CPU, so a pixel of cheese reads one texel rather than
// walking 256 balls. Balls are glossy beach-ball impostors with depth and a
// soft ink outline, their stripes turning as they roll, each with a rider
// (a body, and a head with a cap and eyes that look where the ball faces).
// Orbs, rockets, crumbs and every flash are sprites from the main thread.
// The HUD's 3x5 font and minimap are scaled up to the screen. Nothing here
// is hashed.
import * as L from '../src/layout.mjs';
import { FONT } from './font.mjs';
import { GRAPH_N, GRAPH_PANELS } from './netgraph.mjs';
import { PLAT_Y, PLAT_T } from '../src/bumper-view.mjs';

export const COLS = 80;
export const MAX_SPRITE = 1536;
export const MAX_BEAM = 64;
export const MAX_RECT = 64;
export const MAX_CASTER = L.NPLAYER + L.NORB;
const FAR = 900;
const MSAA = 4;
// the sun, and the shadow mask: MASK_N texels a side over MASK_W metres round the wheel's centre
const SUN = (() => { const v = [0.38, 0.8, 0.46]; const n = Math.hypot(...v); return v.map((x) => x / n); })();
const MASK_N = 512;
const MASK_W = 200;

// sprite kinds: solid 0 a ball, 1 a rider's body, 2 an orb, 6 the arrow over you, 7 a rocket, 8 a rider's head, 9 a crumb;
// glowing 3 a flash, 4 a ring, 5 a spark
export const SPRITE = { BALL: 0, BODY: 1, ORB: 2, FLASH: 3, RING: 4, SPARK: 5, ARROW: 6, ROCKET: 7, HEAD: 8, CRUMB: 9 };

const WGSL = /* wgsl */ `
struct U {
  cam: vec4f,    // eye x, y, z, focal (px)
  fwd: vec4f,    // the camera's axes; fwd.w the time (s)
  right: vec4f,
  up: vec4f,
  screen: vec4f, // width, height, far, sprites
  wheel: vec4f,  // centre (x = z), top, thickness, rim radius
  counts: vec4f, // holes, casters, beams, rects
  hud: vec4f,    // rows, net graph shown, hurt flash, HUD scale (screen px a HUD px)
  mini: vec4f,   // the minimap's centre x, y and radius (px), and the world radius it shows
  misc: vec4f,   // my slot, minimap follows me, HUD x offset (px), 0
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> holes: array<vec4f>;    // x, z, radius now, 0
@group(0) @binding(2) var<storage, read> casters: array<vec4f>;  // x, y (the bottom), z, radius (negative for an orb)
@group(0) @binding(3) var<storage, read> sprites: array<vec4f>;  // four a sprite: pos, size | colour | kind, aspect, min px, seed | velocity, roll
@group(0) @binding(4) var<storage, read> beams: array<vec4f>;    // three a beam: a, width | b, 0 | colour
@group(0) @binding(5) var<storage, read> rects: array<vec4f>;
@group(0) @binding(6) var<storage, read> hud: array<u32>;
@group(0) @binding(7) var<storage, read> font: array<u32>;
@group(0) @binding(8) var<storage, read> graph: array<vec4f>;
@group(0) @binding(9) var mask: texture_2d<f32>;                 // r: shadow, g: an orb's landing ring
@group(0) @binding(10) var samp: sampler;

const SUN = vec3f(${SUN.join(', ')});
const SUNC = vec3f(1.0, 0.93, 0.8) * 1.75;

fn lin(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }
// ACES, fitted, then the display's gamma, and half a level of noise against banding
fn finish(c: vec3f, p: vec2f) -> vec3f {
  let a = c * 0.8;
  let t = clamp((a * (2.51 * a + 0.03)) / (a * (2.43 * a + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
  return pow(t, vec3f(1.0 / 2.2)) + (fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
}

fn hash2(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2f(1.0, 0.0)), s.x), mix(hash2(i + vec2f(0.0, 1.0)), hash2(i + vec2f(1.0, 1.0)), s.x), s.y);
}
fn fbm(p: vec2f) -> f32 { return 0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03 + 7.1) + 0.125 * vnoise(p * 4.1 + 3.3); }

// light from the sky above and the cheese and sea below, on a normal
fn ambient(n: vec3f) -> vec3f { return mix(vec3f(0.14, 0.1, 0.04), vec3f(0.2, 0.32, 0.55), n.y * 0.5 + 0.5); }
fn shade(albedo: vec3f, n: vec3f, sun: f32, ao: f32) -> vec3f {
  return albedo * (SUNC * max(dot(n, SUN), 0.0) * sun + ambient(n) * ao);
}

fn sky(d: vec3f) -> vec3f {
  let y = max(d.y, 0.0);
  var c = mix(lin(vec3f(0.66, 0.8, 0.96)), lin(vec3f(0.16, 0.38, 0.82)), pow(y, 0.5));
  let sd = max(dot(d, SUN), 0.0);
  c += vec3f(1.0, 0.85, 0.6) * (pow(sd, 8.0) * 0.25 + pow(sd, 120.0) * 1.5) + vec3f(6.0, 5.5, 4.5) * smoothstep(0.9995, 0.9998, sd);
  if (d.y > 0.01) {
    let w = u.cam.xz + d.xz * (500.0 / d.y) + vec2f(u.fwd.w * 3.0, 0.0);
    let n = fbm(w / 180.0);
    let cl = smoothstep(0.45, 0.75, n) * clamp(d.y * 5.0, 0.0, 1.0);
    c = mix(c, vec3f(1.05, 1.03, 1.0) * (0.85 + 0.3 * fbm(w / 60.0)), cl * 0.85);
  }
  return c;
}
// what far things fade to: the sky at the horizon, that way
fn haze(c: vec3f, d: vec3f, t: f32) -> vec3f {
  return mix(c, sky(vec3f(d.x, max(d.y, 0.02), d.z)), 1.0 - exp(-t / 1400.0));
}

fn holeAt(p: vec2f) -> i32 {
  for (var k = 0u; k < u32(u.counts.x); k++) {
    let h = holes[k];
    if (distance(p, h.xy) < h.z) { return i32(k); }
  }
  return -1;
}
fn onCheese(p: vec2f) -> bool { return distance(p, vec2f(u.wheel.x)) < u.wheel.w && holeAt(p) < 0; }

fn maskAt(p: vec2f) -> vec2f {
  let uv = (p - vec2f(u.wheel.x) + ${MASK_W / 2}.0) / ${MASK_W}.0;
  return textureSampleLevel(mask, samp, uv, 0.0).rg;
}

// Where a ray inside the circle (c, r) in xz leaves it.
fn circleExit(o: vec2f, d: vec2f, c: vec2f, r: f32) -> f32 {
  let q = o - c;
  let a = max(dot(d, d), 1e-9);
  let b = dot(q, d);
  let disc = max(b * b - a * (dot(q, q) - r * r), 0.0);
  return (-b + sqrt(disc)) / a;
}

struct Shaft { t: f32, k: i32 };
// From t0, inside one or more holes: where the ray meets a shaft's wall (and
// which hole's), or t -1 if it leaves the cheese's thickness first.
fn shaft(o: vec3f, d: vec3f, t0: f32) -> Shaft {
  var s: Shaft;
  s.t = t0;
  s.k = -1;
  for (var it = 0; it < 8; it++) {
    let p = o + d * (s.t + 0.002);
    var best = -1.0;
    for (var k = 0u; k < u32(u.counts.x); k++) {
      let h = holes[k];
      if (distance(p.xz, h.xy) < h.z) {
        let e = circleExit(o.xz, d.xz, h.xy, h.z);
        if (e > best) { best = e; s.k = i32(k); }
      }
    }
    if (best < 0.0) {
      if (distance(p.xz, vec2f(u.wheel.x)) >= u.wheel.w) { s.t = -1.0; }
      return s;
    }
    s.t = best;
    if (o.y + d.y * s.t < u.wheel.y - u.wheel.z) { s.t = -1.0; return s; }
  }
  return s;
}

// The cheese's top at p, lit: eyes, the rounded lip of every hole and of the rim, the balls' shadows.
fn top(p: vec2f) -> vec3f {
  var alb = lin(vec3f(1.0, 0.76, 0.22)) * (0.9 + 0.14 * fbm(p * 0.35) + 0.04 * hash2(floor(p * 6.0)));
  var n = vec3f(0.0, 1.0, 0.0);
  var ao = 1.0;
  // an eye: a shallow pit, its far wall catching the sun
  let cell = floor(p / 1.7);
  let ctr = (cell + 0.25 + 0.5 * vec2f(hash2(cell), hash2(cell + 7.3))) * 1.7;
  let er = 0.06 + 0.26 * hash2(cell + 3.1) * hash2(cell + 9.7);
  let v = (p - ctr) / er;
  if (dot(v, v) < 1.0) {
    n = normalize(vec3f(-v.x, 1.3, -v.y));
    alb *= 0.78;
    ao *= 0.7;
  }
  // the lip: the nearest edge, the normal rolling over toward it
  var edge = u.wheel.w - distance(p, vec2f(u.wheel.x));
  var away = normalize(vec2f(u.wheel.x) - p + vec2f(1e-5, 0.0));
  for (var k = 0u; k < u32(u.counts.x); k++) {
    let e = distance(p, holes[k].xy) - holes[k].z;
    if (e < edge) { edge = e; away = normalize(p - holes[k].xy + vec2f(1e-5, 0.0)); }
  }
  let lip = 1.0 - smoothstep(0.0, 0.45, edge);
  n = normalize(mix(n, vec3f(-away.x, 0.35, -away.y), lip * 0.8));
  ao *= 1.0 - 0.25 * lip;
  let m = maskAt(p);
  var c = shade(alb, n, 1.0 - m.r, ao * (1.0 - 0.6 * m.r));
  c = mix(c, vec3f(2.0, 1.9, 1.7), m.g * 0.7);
  return c;
}

fn sea(w: vec3f, d: vec3f, t: f32) -> vec3f {
  let tt = u.fwd.w;
  let k = clamp(1.0 - t / 260.0, 0.1, 1.0) * 0.8; // far off, the swell smooths out
  let gx = 0.12 * cos(w.x * 0.07 + tt * 0.9) + 0.08 * cos((w.x + w.z) * 0.16 + tt * 1.3) + 0.04 * cos(w.x * 0.33 - w.z * 0.15 + tt * 1.9);
  let gz = 0.1 * cos(w.z * 0.06 - tt * 0.7) + 0.08 * cos((w.x + w.z) * 0.16 + tt * 1.3) + 0.03 * cos(w.z * 0.37 + w.x * 0.12 - tt * 1.7);
  let n = normalize(vec3f(-gx * k, 1.0, -gz * k));
  let r = reflect(d, n);
  let fres = 0.02 + 0.98 * pow(1.0 - max(dot(-d, n), 0.0), 5.0);
  var deep = lin(vec3f(0.02, 0.2, 0.36)) * (0.7 + 0.3 * SUN.y);
  // the wheel's shadow, straight down the sun from it
  let under = distance(w.xz + SUN.xz / SUN.y * u.wheel.y, vec2f(u.wheel.x)) < u.wheel.w;
  if (under) { deep *= 0.5; }
  var c = mix(deep, sky(r), fres);
  if (!under) { c += vec3f(4.0, 3.6, 3.0) * pow(max(dot(r, SUN), 0.0), 600.0); }
  return haze(c, d, t);
}

struct VOut { @builtin(position) pos: vec4f };
@vertex fn vs_full(@builtin(vertex_index) i: u32) -> VOut {
  var o: VOut;
  let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  o.pos = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  return o;
}

struct TOut { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 };
@fragment fn fs_world(@builtin(position) p: vec4f) -> TOut {
  var o: TOut;
  let d = normalize(u.fwd.xyz * u.cam.w + u.right.xyz * (p.x - u.screen.x * 0.5) + u.up.xyz * (u.screen.y * 0.5 - p.y));
  let e = u.cam.xyz;
  let ytop = u.wheel.y;
  let ybot = u.wheel.y - u.wheel.z;
  let ctr = vec2f(u.wheel.x);
  var t = 1e9;
  var c = vec3f(0.0);
  let rind = lin(vec3f(0.95, 0.62, 0.16));
  // the top, or a hole in it and the wall of its shaft
  if (e.y > ytop && d.y < 0.0) {
    let tt = (ytop - e.y) / d.y;
    let w = e.xz + d.xz * tt;
    if (distance(w, ctr) < u.wheel.w) {
      if (holeAt(w) < 0) {
        t = tt;
        c = top(w);
      } else {
        let s = shaft(e, d, tt);
        if (s.t > 0.0) {
          t = s.t;
          let q = e + d * s.t;
          let h = holes[u32(s.k)];
          let n = normalize(vec3f(h.x - q.x, 0.0, h.y - q.z));
          // sunlit only where the sun gets in over the lip
          let up = (ytop - q.y) / SUN.y;
          let lit = select(0.0, 1.0, distance(q.xz + SUN.xz * up, h.xy) < h.z);
          let deep = (ytop - q.y) / u.wheel.z;
          let alb = lin(vec3f(1.0, 0.72, 0.2)) * (0.85 + 0.2 * vnoise(vec2f(atan2(n.z, n.x) * 6.0, q.y * 2.0)));
          c = shade(alb, n, lit, (1.0 - 0.8 * deep) * 0.8);
        }
      }
    }
  }
  // the rind, from outside
  let q = e.xz - ctr;
  let a = max(dot(d.xz, d.xz), 1e-9);
  let b = dot(q, d.xz);
  let cc = dot(q, q) - u.wheel.w * u.wheel.w;
  let disc = b * b - a * cc;
  if (cc > 0.0 && disc > 0.0) {
    let t1 = (-b - sqrt(disc)) / a;
    let y = e.y + d.y * t1;
    if (t1 > 0.0 && t1 < t && y < ytop && y > ybot) {
      let w = e + d * t1;
      if (holeAt(w.xz) < 0) {
        t = t1;
        var n = normalize(vec3f(w.x - ctr.x, 0.0, w.z - ctr.y));
        // the eyes the rind cuts through, as pits
        let ang = atan2(n.z, n.x) * u.wheel.w;
        let cell = floor(vec2f(ang, y) / vec2f(2.4, 1.7));
        let mid = (cell + 0.5) * vec2f(2.4, 1.7) + (vec2f(hash2(cell), hash2(cell + 5.1)) - 0.5) * 0.8;
        let er = 0.2 + 0.45 * hash2(cell + 2.2);
        let v = (vec2f(ang, y) - mid) / er;
        var alb = rind * (0.9 + 0.15 * fbm(vec2f(ang, y) * 0.8));
        var ao = 1.0 - 0.5 * smoothstep(1.5, 0.0, y - ybot) - 0.2 * smoothstep(0.5, 0.0, ytop - y);
        if (dot(v, v) < 1.0) { alb *= 0.75; ao *= 0.55; n = normalize(n - vec3f(0.0, v.y, 0.0) * 0.6); }
        c = shade(alb, n, 1.0, ao);
      }
    }
  }
  // the underside, from below
  if (e.y < ybot && d.y > 0.0) {
    let tb = (ybot - e.y) / d.y;
    if (tb < t && onCheese(e.xz + d.xz * tb)) { t = tb; c = shade(rind * 0.7, vec3f(0.0, -1.0, 0.0), 0.0, 0.5); }
  }
  if (t < 1e8) {
    o.color = vec4f(finish(haze(c, d, t), p.xy), 1.0);
    o.depth = clamp(t * dot(d, u.fwd.xyz) / u.screen.z, 0.0, 1.0);
    return o;
  }
  if (d.y < 0.0) {
    let ts = -e.y / d.y;
    o.color = vec4f(finish(sea(e + d * ts, d, ts), p.xy), 1.0);
    o.depth = clamp(ts * dot(d, u.fwd.xyz) / u.screen.z, 0.0, 1.0);
    return o;
  }
  o.color = vec4f(finish(sky(d), p.xy), 1.0);
  o.depth = 1.0;
  return o;
}

// ---- sprites
struct SOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
  @location(2) @interpolate(flat) kind: u32,
  @location(3) @interpolate(flat) info: vec4f, // view z, world radius, seed, roll
  @location(4) @interpolate(flat) vel: vec3f,
};

fn project(q: vec3f) -> vec4f {
  let r = q - u.cam.xyz;
  let z = dot(r, u.fwd.xyz);
  let s = u.cam.w / max(z, 0.01);
  return vec4f(u.screen.x * 0.5 + dot(r, u.right.xyz) * s, u.screen.y * 0.5 - dot(r, u.up.xyz) * s, z, s);
}

var<private> CORNERS: array<vec2f, 6> = array<vec2f, 6>(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1));

@vertex fn vs_sprite(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> SOut {
  var o: SOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  if (i >= u32(u.screen.w)) { return o; }
  let a = sprites[4u * i];
  let info = sprites[4u * i + 2u];
  let pr = project(a.xyz);
  if (pr.z < 0.3 || pr.z > u.screen.z) { return o; }
  let half = vec2f(a.w, a.w * info.y);
  let px = max(half * pr.w, vec2f(info.z, info.z * info.y)) + 0.5; // half a pixel more, for the edge's smoothing
  let s = pr.xy + CORNERS[v] * px;
  o.pos = vec4f(s.x / u.screen.x * 2.0 - 1.0, 1.0 - s.y / u.screen.y * 2.0, pr.z / u.screen.z, 1.0);
  o.uv = CORNERS[v] * px / max(half * pr.w, vec2f(info.z, info.z * info.y));
  o.color = sprites[4u * i + 1u];
  o.kind = u32(info.x);
  let vr = sprites[4u * i + 3u];
  o.info = vec4f(pr.z, a.w, info.w, vr.w);
  o.vel = vr.xyz;
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

fn slotColor(s: f32) -> vec3f {
  let h = s * 0.618034;
  return 0.55 + 0.4 * cos(6.2832 * (fract(h) + vec3f(0.0, 0.33, 0.67)));
}

// Rodrigues: v turned by angle a about the unit axis k.
fn turn(v: vec3f, k: vec3f, a: f32) -> vec3f {
  return v * cos(a) + cross(k, v) * sin(a) + k * dot(k, v) * (1.0 - cos(a));
}

// glossy: the sun's highlight and the sky in it, more at a grazing angle
fn gloss(c: vec3f, n: vec3f, power: f32, k: f32) -> vec3f {
  let v = -normalize(u.fwd.xyz * 1.0);
  let r = reflect(-v, n);
  let fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  return c + SUNC * pow(max(dot(r, SUN), 0.0), power) * k + sky(r) * fres * k * 0.6;
}

struct FOut { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 };
@fragment fn fs_solid(s: SOut) -> FOut {
  var o: FOut;
  let rr = length(s.uv);
  let fw = max(fwidth(rr), 1e-4);
  var cover = clamp((1.0 - rr) / fw + 0.5, 0.0, 1.0);
  let r2 = min(rr * rr, 1.0);
  let h = sqrt(1.0 - r2);
  // the sphere's normal at this pixel, in the world
  let n = normalize(u.right.xyz * s.uv.x - u.up.xyz * s.uv.y - u.fwd.xyz * h);
  var c = lin(s.color.rgb);
  var z = s.info.x - h * s.info.y;
  let ink = 1.0 - 0.6 * smoothstep(0.86, 0.97, rr);
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
      c = gloss(shade(alb, n, 1.0, 1.0), n, 60.0, 0.5 * shine) * ink;
    }
    case 1u: { // a rider's body, in its colour
      c = gloss(shade(c * 0.8, n, 1.0, 1.0), n, 20.0, 0.2) * ink;
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
      c = gloss(shade(alb, n, 1.0, 1.0), n, 30.0, 0.15) * ink;
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
    case 9u: { // a crumb of cheese
      c = shade(lin(vec3f(1.0, 0.8, 0.32)), n, 1.0, 1.0) * ink;
    }
    default: { // a rocket
      c = mix(vec3f(3.0, 2.8, 2.2), c * 2.0, r2);
    }
  }
  if (cover <= 0.0) { discard; }
  o.color = vec4f(finish(c, s.pos.xy), cover);
  o.depth = clamp(z / u.screen.z, 0.0, 1.0);
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
  o.pos = vec4f(s.x / u.screen.x * 2.0 - 1.0, 1.0 - s.y / u.screen.y * 2.0, clamp(end.z / u.screen.z, 0.0, 1.0), 1.0);
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

// The minimap: the wheel from above, the way you face up, holes dark, balls
// as dots in their colours, yours white. In screen pixels.
fn miniPx(q: vec2f) -> vec4f {
  let d = q - u.mini.xy;
  let rp = length(d);
  if (u.mini.z <= 0.0 || rp > u.mini.z + 2.0) { return vec4f(0.0); }
  if (rp > u.mini.z) { return vec4f(1.0, 0.95, 0.85, 0.8); }
  let s = u.mini.w / u.mini.z;
  let f = normalize(vec2f(u.fwd.x, u.fwd.z) + vec2f(1e-6, 0.0));
  let rt = vec2f(-f.y, f.x);
  let me = casters[u32(max(u.misc.x, 0.0))];
  let centre = select(vec2f(u.wheel.x), me.xz, u.misc.x >= 0.0 && me.w > 0.0 && u.misc.y > 0.5);
  let w = centre + (f * -d.y + rt * d.x) * s;
  for (var k = 0u; k < u32(u.counts.y); k++) {
    let b = casters[k];
    if (b.w <= 0.0 || b.y < u.wheel.y - 1.0) { continue; }
    if (distance(w, b.xz) < max(b.w, s * 1.5)) {
      if (i32(k) == i32(u.misc.x)) { return vec4f(1.0, 1.0, 1.0, 1.0); }
      return vec4f(slotColor(f32(k)), 1.0);
    }
  }
  if (onCheese(w)) { return vec4f(1.0, 0.82, 0.35, 0.85); }
  return vec4f(0.05, 0.25, 0.4, 0.6);
}

@fragment fn fs_hud(@builtin(position) q: vec4f) -> @location(0) vec4f {
  let p = vec2i(floor((q.xy - vec2f(u.misc.z, 0.0)) / u.hud.w));
  if (lit(p)) {
    let cell = vec2i(p.x / 4, p.y / 6);
    let k = (hud[u32(cell.y) * ${COLS}u + u32(cell.x)] >> 8u) & 7u;
    return vec4f(PALETTE[k], 1.0);
  }
  if (lit(p - vec2i(1, 1))) { return vec4f(0.0, 0.0, 0.0, 0.75); }
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

export async function createRenderer(canvas, { present = true, hudScale = 1, device: shared = null } = {}) {
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

  const ubuf = device.createBuffer({ size: 160, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const storage = (size) => device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const holeBuf = storage(L.NHOLE * 16);
  const casterBuf = storage(MAX_CASTER * 16);
  const spriteBuf = storage(MAX_SPRITE * 64);
  const beamBuf = storage(MAX_BEAM * 48);
  const rectBuf = storage(MAX_RECT * 32);
  const hudBuf = storage(COLS * rows * 4);
  const fontBuf = storage(FONT.length * 4);
  const graphBuf = storage(GRAPH_PANELS * GRAPH_N * 16);
  device.queue.writeBuffer(fontBuf, 0, FONT);
  const maskTex = device.createTexture({ size: [MASK_N, MASK_N], format: 'rg8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const colorMs = device.createTexture({ size: [W, H], format, sampleCount: MSAA, usage: GPUTextureUsage.RENDER_ATTACHMENT });
  const depth = device.createTexture({ size: [W, H], format: 'depth32float', sampleCount: MSAA, usage: GPUTextureUsage.RENDER_ATTACHMENT });

  const FRAG = GPUShaderStage.FRAGMENT, VERT = GPUShaderStage.VERTEX;
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: VERT | FRAG, buffer: { type: 'uniform' } },
      ...[[1, FRAG], [2, FRAG], [3, VERT], [4, VERT], [5, FRAG], [6, FRAG], [7, FRAG], [8, FRAG]].map(([binding, visibility]) => ({ binding, visibility, buffer: { type: 'read-only-storage' } })),
      { binding: 9, visibility: FRAG, texture: { sampleType: 'float' } },
      { binding: 10, visibility: FRAG, sampler: { type: 'filtering' } },
    ],
  });
  const bind = device.createBindGroup({
    layout,
    entries: [{ binding: 0, resource: { buffer: ubuf } },
      ...[holeBuf, casterBuf, spriteBuf, beamBuf, rectBuf, hudBuf, fontBuf, graphBuf].map((buffer, k) => ({ binding: 1 + k, resource: { buffer } })),
      { binding: 9, resource: maskTex.createView() }, { binding: 10, resource: sampler }],
  });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const pipe = (vs, fs, { depthWrite, depthCompare, blend, coverage = false }) => device.createRenderPipeline({
    layout: pl,
    vertex: { module, entryPoint: vs },
    fragment: { module, entryPoint: fs, targets: [{ format, blend }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: depthWrite, depthCompare },
    multisample: { count: MSAA, alphaToCoverageEnabled: coverage },
  });
  const over = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
  const add = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
  const world = pipe('vs_full', 'fs_world', { depthWrite: true, depthCompare: 'always' });
  const solid = pipe('vs_sprite', 'fs_solid', { depthWrite: true, depthCompare: 'less', coverage: true });
  const glow = pipe('vs_sprite', 'fs_glow', { depthWrite: false, depthCompare: 'less', blend: add });
  const beam = pipe('vs_beam', 'fs_beam', { depthWrite: false, depthCompare: 'less', blend: add });
  const hudPipe = pipe('vs_full', 'fs_hud', { depthWrite: false, depthCompare: 'always', blend: over });

  const uf = new Float32Array(40);
  const hud = new Uint32Array(COLS * rows);
  const holeData = new Float32Array(L.NHOLE * 4);
  const casterData = new Float32Array(MAX_CASTER * 4);
  const spriteData = new Float32Array(MAX_SPRITE * 16);
  const beamData = new Float32Array(MAX_BEAM * 12);
  const rectData = new Float32Array(MAX_RECT * 8);
  const maskData = new Uint8Array(MASK_N * MASK_N * 2);

  // The shadow mask: each ball's shadow down the sun, soft, and a dark spot
  // where it sits; each orb on its way down, a ring where it will land.
  const TEX = MASK_N / MASK_W;
  const stamp = (cx, cz, rad, fn) => {
    const x0 = Math.max(0, Math.floor((cx - L.B_CX + MASK_W / 2 - rad) * TEX)), x1 = Math.min(MASK_N - 1, Math.ceil((cx - L.B_CX + MASK_W / 2 + rad) * TEX));
    const z0 = Math.max(0, Math.floor((cz - L.B_CX + MASK_W / 2 - rad) * TEX)), z1 = Math.min(MASK_N - 1, Math.ceil((cz - L.B_CX + MASK_W / 2 + rad) * TEX));
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot((x + 0.5) / TEX - MASK_W / 2 + L.B_CX - cx, (z + 0.5) / TEX - MASK_W / 2 + L.B_CX - cz);
        fn((z * MASK_N + x) * 2, d);
      }
    }
  };
  function drawMask(casters) {
    maskData.fill(0);
    for (const [x, y, z, r] of casters) {
      const up = y - PLAT_Y;
      if (r > 0) {
        if (up < -0.5) continue;
        const hc = up + r;
        const sx = x - SUN[0] / SUN[1] * hc, sz = z - SUN[2] / SUN[1] * hc;
        const soft = 0.25 + up * 0.08;
        const dark = Math.max(0.15, 0.72 - up * 0.05);
        stamp(sx, sz, r + soft, (i, d) => { const v = dark * Math.min(1, Math.max(0, (r + soft - d) / (2 * soft))) * 255; if (v > maskData[i]) maskData[i] = v; });
        if (up < 1) stamp(x, z, r * 0.8, (i, d) => { const v = (1 - up) * 0.5 * Math.max(0, 1 - d / (r * 0.8)) ** 2 * 255; if (v > maskData[i]) maskData[i] = Math.min(255, maskData[i] + v * 0.5); });
      } else if (up > 1) {
        const rr = 0.7 + up * 0.08;
        stamp(x, z, rr + 0.3, (i, d) => { const v = Math.max(0, 1 - Math.abs(d - rr) / 0.22) * 255; if (v > maskData[i + 1]) maskData[i + 1] = v; });
        stamp(x, z, 0.6, (i, d) => { const v = 0.4 * Math.max(0, 1 - d / 0.6) * 255; if (v > maskData[i]) maskData[i] = v; });
      }
    }
    device.queue.writeTexture({ texture: maskTex }, maskData, { bytesPerRow: MASK_N * 2 }, [MASK_N, MASK_N]);
  }

  return {
    rows, width: W, height: H, hudScale: hs, hudX,
    // s: { cam, yaw, pitch, time, slot, wheel (src/bumper-view.mjs), casters: [[x, y, z, r]] (index = slot for balls),
    //      solid: [sprite], glow: [sprite] with sprite { pos, size, color: [r,g,b,a], kind, aspect, minpx, seed, vel, roll },
    //      beams: [{ a, b, width, color }], rects (screen px), text, graph, flash, mini: [cx, cy, r px, world r] | null, miniFollow }
    frame(u8, s, target) {
      if (!ctx && !target) return;
      const focal = Math.min(W, H * 1.6) * 0.62;
      const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw), cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
      const sprites = [...s.solid, ...s.glow].slice(0, MAX_SPRITE);
      const w = s.wheel;
      uf.set([s.cam[0], s.cam[1], s.cam[2], focal,
        cp * cy, sp, cp * sy, s.time,
        -sy, 0, cy, 0,
        -sp * cy, cp, -sp * sy, 0,
        W, H, FAR, sprites.length,
        L.B_CX, PLAT_Y, PLAT_T, w.rim,
        w.holes.length, Math.min(s.casters.length, MAX_CASTER), Math.min(s.beams.length, MAX_BEAM), Math.min(s.rects.length, MAX_RECT),
        rows, s.graph ? 1 : 0, s.flash || 0, hs,
        ...(s.mini || [0, 0, 0, 1]),
        s.slot, s.miniFollow ? 1 : 0, hudX, 0]);
      device.queue.writeBuffer(ubuf, 0, uf);
      w.holes.forEach((h, k) => holeData.set([h.x, h.z, h.r, 0], 4 * k));
      if (w.holes.length) device.queue.writeBuffer(holeBuf, 0, holeData, 0, 4 * w.holes.length);
      s.casters.slice(0, MAX_CASTER).forEach((c, k) => casterData.set(c, 4 * k));
      if (s.casters.length) device.queue.writeBuffer(casterBuf, 0, casterData, 0, 4 * Math.min(s.casters.length, MAX_CASTER));
      drawMask(s.casters);
      sprites.forEach((p, k) => {
        const c = p.color, v = p.vel || [0, 0, 0];
        spriteData.set([p.pos[0], p.pos[1], p.pos[2], p.size, c[0], c[1], c[2], c[3] ?? 1, p.kind, p.aspect ?? 1, p.minpx ?? 1, p.seed ?? 0, v[0], v[1], v[2], p.roll ?? 0], k * 16);
      });
      if (sprites.length) device.queue.writeBuffer(spriteBuf, 0, spriteData, 0, sprites.length * 16);
      s.beams.slice(0, MAX_BEAM).forEach((b, k) => beamData.set([b.a[0], b.a[1], b.a[2], b.width, b.b[0], b.b[1], b.b[2], 0, ...b.color], k * 12));
      if (s.beams.length) device.queue.writeBuffer(beamBuf, 0, beamData, 0, Math.min(s.beams.length, MAX_BEAM) * 12);
      s.rects.slice(0, MAX_RECT).forEach((r, k) => rectData.set(r, k * 8));
      if (s.rects.length) device.queue.writeBuffer(rectBuf, 0, rectData, 0, Math.min(s.rects.length, MAX_RECT) * 8);
      if (s.graph) device.queue.writeBuffer(graphBuf, 0, s.graph);
      hud.set(s.text.subarray(0, hud.length));
      device.queue.writeBuffer(hudBuf, 0, hud);
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: colorMs.createView(), resolveTarget: (target || ctx.getCurrentTexture()).createView(), loadOp: 'clear', storeOp: 'discard', clearValue: [0, 0, 0, 1] }],
        depthStencilAttachment: { view: depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'discard', depthClearValue: 1 },
      });
      pass.setBindGroup(0, bind);
      pass.setPipeline(world);
      pass.draw(3);
      pass.setPipeline(solid);
      if (s.solid.length) pass.draw(6, Math.min(s.solid.length, MAX_SPRITE), 0, 0);
      pass.setPipeline(beam);
      if (s.beams.length) pass.draw(6, Math.min(s.beams.length, MAX_BEAM));
      pass.setPipeline(glow);
      const ng = sprites.length - Math.min(s.solid.length, MAX_SPRITE);
      if (ng > 0) pass.draw(6, ng, 0, s.solid.length);
      pass.setPipeline(hudPipe);
      pass.draw(3);
      pass.end();
      device.queue.submit([enc.finish()]);
    },

    async capture(u8, s) {
      const tex = device.createTexture({ size: [W, H], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      this.frame(u8, s, tex);
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
