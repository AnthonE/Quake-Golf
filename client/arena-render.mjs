// The arena's WebGPU renderer: golf's look (the terrain ray-marched per pixel
// at 320x200, bodies as depth-tested splats, a 3x5 HUD font), the map's
// boxes ray-traced in the same pass (walls, roofs, the cave's roof: a slab
// test per box, a group's bounds first, and a ray to the sun from whatever a
// pixel lands on for its shadow), with what a
// shooter needs on top: tracers as beams, sprites for blasts, sparks and
// weapon pads, the team modes' flags and skull, a zone painted on the ground
// for a hill, and a HUD of rectangles under the text for the gun in your
// hands, the shield and health bars, the crosshair, the scope and the
// hit marker. Fighters and projectiles come straight from shared memory;
// everything else from the main thread each frame. Nothing here is hashed.
import * as L from '../src/layout.mjs';
import { FONT } from './font.mjs';
import { GRAPH_N, GRAPH_PANELS } from './netgraph.mjs';

export const COLS = 80;
export const MAX_SPRITE = 256;
export const MAX_BEAM = 128;
export const MAX_RECT = 128;
const FAR = 700;
// The HUD text's colours by C.* (client/font.mjs), for the shader and for rects drawn to match it.
export const PALETTE = [[1, 1, 1], [1, 0.85, 0.25], [1, 0.35, 0.3], [0.4, 1, 0.4], [0.6, 0.6, 0.6], [0.5, 0.85, 1], [1, 0.6, 0.2], [0.8, 0.55, 1]];
const vec3 = (c) => `vec3f(${c.map((v) => v.toFixed(3)).join(', ')})`;

// The camera a frame state ({ cam, yaw, pitch, zoom }) on a W x H screen
// sees through: the focal length (px) and the horizon's row, the pitch a
// vertical shear as golf's.
export function lens(s, W, H) {
  const focal = W * 0.62 * (s.zoom || 1);
  return { focal, horizon: H / 2 + Math.tan(Math.max(-1.35, Math.min(1.35, s.pitch))) * focal };
}

// Where world point q lands on the screen, as the shader's project() puts it:
// [x, y, depth ahead of the eye (m; under 0.3 behind it)]. For the HUD's waypoints.
export function project(s, W, H, q) {
  const { focal, horizon } = lens(s, W, H);
  const r = [q[0] - s.cam[0], q[1] - s.cam[1], q[2] - s.cam[2]];
  const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
  const zf = r[0] * cy + r[2] * sy, xr = -r[0] * sy + r[2] * cy;
  const k = focal / Math.max(zf, 0.01);
  return [W / 2 + xr * k, horizon - r[1] * k, zf];
}

const WGSL = /* wgsl */ `
struct U {
  cam: vec4f,     // eye x, y, z, focal (px)
  view: vec4f,    // cos yaw, sin yaw, horizon (px), time (s)
  screen: vec4f,  // width, height, far, extrapolate the confirmed world (s)
  misc: vec4f,    // my slot, sprites, highest ground, beams
  hud: vec4f,     // rows, rects, crosshair kind, hit marker (0..1)
  fx: vec4f,      // damage flash (0..1), scope (1), net graph shown (1), crosshair gap (px)
  pred: vec4f,    // extrapolate my projectiles (s); the motion tracker's centre x, y and radius (px)
  map: vec4f,     // boxes, groups, sides (0 none, 1 one against the rest, 2 red and blue), the zone's height band (m)
  zone: vec4f,    // a disc painted on the ground: centre x, z, radius (0: none), the height it's at
  zcol: vec4f,    // its colour, and how hard it pulses (0..1)
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var hmap: texture_2d<f32>;
@group(0) @binding(2) var smap: texture_2d<u32>;
@group(0) @binding(3) var<storage, read> players: array<u32>;
@group(0) @binding(4) var<storage, read> proj: array<u32>;
@group(0) @binding(5) var<storage, read> sprites: array<vec4f>;
@group(0) @binding(6) var<storage, read> beams: array<vec4f>;
@group(0) @binding(7) var<storage, read> rects: array<vec4f>;
@group(0) @binding(8) var<storage, read> hud: array<u32>;
@group(0) @binding(9) var<storage, read> font: array<u32>;
@group(0) @binding(10) var<storage, read> graph: array<vec4f>;
@group(0) @binding(11) var<storage, read> boxes: array<vec4f>;  // two a box: x0, y0, z0, material | x1, y1, z1, 0
@group(0) @binding(12) var<storage, read> groups: array<vec4f>; // two a group: x0, y0, z0, first box | x1, y1, z1, count

const SKY_LO = vec3f(0.74, 0.8, 0.88);
const SKY_HI = vec3f(0.22, 0.42, 0.72);
const SUN = vec3f(0.42, 0.78, 0.46);

fn hgt(x: f32, z: f32) -> f32 {
  let g = clamp(vec2f(x, z) * 0.5, vec2f(0.0), vec2f(510.99));
  let i = vec2i(g);
  let f = g - vec2f(i);
  let a = textureLoad(hmap, i, 0).r;
  let b = textureLoad(hmap, i + vec2i(1, 0), 0).r;
  let c = textureLoad(hmap, i + vec2i(0, 1), 0).r;
  let d = textureLoad(hmap, i + vec2i(1, 1), 0).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

fn hash2(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }

// grass, rock, the sand track, the bases' metal
fn surfColor(s: u32, w: vec2f) -> vec3f {
  let n = hash2(floor(w * 2.0));
  switch s {
    case 0u: { return vec3f(0.3, 0.5, 0.2) * (0.88 + 0.2 * n); }
    case 1u: { return vec3f(0.48, 0.43, 0.36) * (0.8 + 0.35 * hash2(floor(w * 0.7))); }
    case 2u: { return vec3f(0.72, 0.62, 0.42) * (0.92 + 0.12 * n); }
    default: {
      let seam = min(abs(fract(w.x / 4.0) - 0.5), abs(fract(w.y / 4.0) - 0.5)) < 0.04;
      return select(vec3f(0.5, 0.56, 0.62), vec3f(0.3, 0.34, 0.4), seam);
    }
  }
}

fn ground(w: vec2f) -> vec3f {
  let g = clamp(w * 0.5 - 0.5, vec2f(0.0), vec2f(510.0));
  let i = vec2i(g);
  let f = g - vec2f(i);
  let a = surfColor(textureLoad(smap, i, 0).r, w);
  let b = surfColor(textureLoad(smap, i + vec2i(1, 0), 0).r, w);
  let c = surfColor(textureLoad(smap, i + vec2i(0, 1), 0).r, w);
  let d = surfColor(textureLoad(smap, i + vec2i(1, 1), 0).r, w);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// The boxes' materials (tools/map.mjs's MATERIALS): metal, rock, dark metal, red, blue, light.
var<private> MATERIAL: array<vec3f, 6> = array<vec3f, 6>(vec3f(0.56, 0.6, 0.64), vec3f(0.47, 0.42, 0.36), vec3f(0.24, 0.27, 0.31),
  vec3f(0.62, 0.17, 0.14), vec3f(0.17, 0.27, 0.64), vec3f(0.75, 0.95, 1.0));

struct Hit { t: f32, n: vec3f, k: u32 };

// The nearest box the ray o + t d enters past t = 0 and before tmax (k = 0xffffffff for none).
// A box the ray starts inside isn't seen, so a camera in a wall sees out.
fn traceBoxes(o: vec3f, d: vec3f, tmax: f32) -> Hit {
  var h: Hit;
  h.t = tmax;
  h.k = 0xffffffffu;
  let inv = 1.0 / select(d, vec3f(1e-9), abs(d) < vec3f(1e-9));
  for (var g = 0u; g < u32(u.map.y); g++) {
    let gl = groups[2u * g];
    let gh = groups[2u * g + 1u];
    let ga = (gl.xyz - o) * inv;
    let gb = (gh.xyz - o) * inv;
    let gn = min(ga, gb);
    let gf = max(ga, gb);
    if (max(max(gn.x, gn.y), max(gn.z, 0.0)) > min(min(gf.x, gf.y), min(gf.z, h.t))) { continue; }
    let first = u32(gl.w);
    for (var k = first; k < first + u32(gh.w); k++) {
      let ta = (boxes[2u * k].xyz - o) * inv;
      let tb = (boxes[2u * k + 1u].xyz - o) * inv;
      let tn = min(ta, tb);
      let tf = max(ta, tb);
      let t0 = max(max(tn.x, tn.y), tn.z);
      if (t0 <= min(min(tf.x, tf.y), tf.z) && t0 > 0.0 && t0 < h.t) {
        h.t = t0;
        h.k = k;
        if (t0 == tn.x) { h.n = vec3f(-sign(d.x), 0.0, 0.0); } else if (t0 == tn.y) { h.n = vec3f(0.0, -sign(d.y), 0.0); } else { h.n = vec3f(0.0, 0.0, -sign(d.z)); }
      }
    }
  }
  return h;
}

// 0 where a box stands between p and the sun, else 1.
fn sunlit(p: vec3f) -> f32 {
  if (u.map.x < 0.5) { return 1.0; }
  return select(1.0, 0.0, traceBoxes(p, SUN, 400.0).k != 0xffffffffu);
}

// A box's face at w: its material, panel seams on metal, a dark line on every edge.
fn boxColor(k: u32, w: vec3f, n: vec3f) -> vec3f {
  let lo = boxes[2u * k];
  let hi = boxes[2u * k + 1u].xyz;
  let m = min(u32(lo.w), 5u);
  // the two axes across the face
  var uv = w.xy;
  var e = min(min(w.x - lo.x, hi.x - w.x), min(w.y - lo.y, hi.y - w.y));
  if (abs(n.x) > 0.5) { uv = w.zy; e = min(min(w.z - lo.z, hi.z - w.z), min(w.y - lo.y, hi.y - w.y)); }
  if (abs(n.y) > 0.5) { uv = w.xz; e = min(min(w.x - lo.x, hi.x - w.x), min(w.z - lo.z, hi.z - w.z)); }
  var c = MATERIAL[m];
  if (m == 1u) { c *= 0.75 + 0.4 * hash2(floor(uv * 1.5)); }
  else if (m != 5u) {
    let seam = min(abs(fract(uv.x / 2.0) - 0.5), abs(fract(uv.y / 1.0) - 0.5)) > 0.47;
    c *= select(1.0, 0.82, seam) * (0.94 + 0.08 * hash2(floor(uv * 0.5)));
  }
  return c * select(1.0, 0.6, e < 0.06);
}

// The zone (a hill) on what a pixel landed on: at w across, y up, z metres off.
// A tinted disc with rings running out over it and a bright rim a pixel or
// more wide, on surfaces within the band of its height.
fn zone(c: vec3f, w: vec2f, y: f32, z: f32) -> vec3f {
  let d = distance(w, u.zone.xy);
  if (u.zone.z <= 0.0 || d > u.zone.z || abs(y - u.zone.w) > u.map.w) { return c; }
  let rim = max(0.3, 1.6 * z / u.cam.w);
  let rings = 0.5 + 0.5 * sin(d * 1.6 - u.view.w * 4.0);
  var k = 0.22 + 0.2 * u.zcol.w * rings;
  if (d > u.zone.z - rim) { k = 0.9; }
  return mix(c, u.zcol.rgb, k);
}

fn sky(sy: f32) -> vec3f {
  let t = clamp((u.view.z - sy) / u.screen.y * 1.6, 0.0, 1.0);
  return mix(SKY_LO, SKY_HI, t);
}

fn dither(c: vec3f, p: vec2f) -> vec3f {
  var m = array<f32, 4>(0.0, 0.5, 0.75, 0.25);
  let k = m[(u32(p.x) & 1u) + 2u * (u32(p.y) & 1u)];
  return floor(c * 31.0 + k) / 31.0;
}

struct VOut { @builtin(position) pos: vec4f };
@vertex fn vs_full(@builtin(vertex_index) i: u32) -> VOut {
  var o: VOut;
  let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  o.pos = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  return o;
}

struct TOut { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 };
@fragment fn fs_terrain(@builtin(position) p: vec4f) -> TOut {
  var o: TOut;
  let fwd = u.view.xy;
  let right = vec2f(-fwd.y, fwd.x);
  let dir = fwd + right * ((p.x - u.screen.x * 0.5) / u.cam.w);
  let rise = (u.view.z - p.y) / u.cam.w;
  var z = 0.3;
  var prev = 0.0;
  var hit = false;
  // zoomed, the steps stretch with the focal length so far things stay sharp
  let k = 0.012 * 240.0 / u.cam.w;
  // the boxes first: the ground is marched only as far as the nearest
  let ray = vec3f(dir.x, rise, dir.y);
  let bh = traceBoxes(u.cam.xyz, ray, u.screen.z);
  loop {
    let w = u.cam.xz + dir * z;
    let ry = u.cam.y + rise * z;
    if (ry <= hgt(w.x, w.y)) { hit = true; break; }
    if (rise >= 0.0 && ry > u.misc.z) { break; }
    prev = z;
    z += 0.04 + z * k;
    if (z > min(u.screen.z, bh.t)) { break; }
  }
  if (bh.k != 0xffffffffu && (!hit || bh.t < z)) {
    let w = u.cam.xyz + ray * bh.t;
    var c = boxColor(bh.k, w, bh.n);
    if (u32(boxes[2u * bh.k].w) != 5u) {
      c *= 0.42 + 0.68 * max(dot(bh.n, SUN), 0.0) * sunlit(w + bh.n * 0.01) + 0.06 * bh.n.y;
    }
    if (bh.n.y > 0.5) { c = zone(c, w.xz, w.y, bh.t); }
    c = mix(c, SKY_LO, 1.0 - exp(-bh.t / 420.0));
    o.color = vec4f(dither(c, p.xy), 1.0);
    o.depth = bh.t / u.screen.z;
    return o;
  }
  if (!hit) {
    var c = sky(p.y);
    let sd = dot(normalize(vec3f(dir.x, rise, dir.y)), SUN);
    c += vec3f(1.0, 0.9, 0.7) * pow(max(sd, 0.0), 300.0);
    // a ringed planet low in the sky, for the look
    let pd = normalize(vec3f(dir.x, rise, dir.y));
    let pc = normalize(vec3f(-0.6, 0.32, 0.74));
    let a = acos(clamp(dot(pd, pc), -1.0, 1.0));
    if (a < 0.16) { c = mix(c, vec3f(0.62, 0.66, 0.78) * (0.7 + 0.3 * (pd.y - pc.y + 0.16) / 0.32), 0.85); }
    let ring = abs(a - 0.24) < 0.012 && abs(pd.y - pc.y) < 0.06;
    if (ring) { c = mix(c, vec3f(0.85, 0.85, 0.9), 0.6); }
    o.color = vec4f(dither(c, p.xy), 1.0);
    o.depth = 1.0;
    return o;
  }
  var lo = prev;
  var hi = z;
  for (var i = 0; i < 6; i++) {
    let m = 0.5 * (lo + hi);
    let w = u.cam.xz + dir * m;
    if (u.cam.y + rise * m <= hgt(w.x, w.y)) { hi = m; } else { lo = m; }
  }
  z = hi;
  let w = u.cam.xz + dir * z;
  let n = normalize(vec3f(hgt(w.x - 1.0, w.y) - hgt(w.x + 1.0, w.y), 2.0, hgt(w.x, w.y - 1.0) - hgt(w.x, w.y + 1.0)));
  var c = ground(w);
  // steep ground is rock whatever it's painted
  c = mix(c, vec3f(0.46, 0.41, 0.35) * (0.8 + 0.3 * hash2(floor(w * 0.5))), smoothstep(0.82, 0.7, n.y));
  c *= 0.45 + 0.65 * max(dot(n, SUN), 0.0) * select(1.0, sunlit(vec3f(w.x, u.cam.y + rise * z + 0.05, w.y)), z < 160.0);
  c = zone(c, w, u.cam.y + rise * z, z);
  let fog = 1.0 - exp(-z / 420.0);
  c = mix(c, SKY_LO, fog);
  o.color = vec4f(dither(c, p.xy), 1.0);
  o.depth = z / u.screen.z;
  return o;
}

// ---- splats: fighters, projectiles, sprites
struct SOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
  @location(2) @interpolate(flat) kind: u32,
};

fn pf(base: u32, off: u32) -> f32 { return bitcast<f32>(players[(base + off) / 4u]); }
fn jf(base: u32, off: u32) -> f32 { return bitcast<f32>(proj[(base + off) / 4u]); }
fn slotColor(s: u32) -> vec3f {
  let h = f32(s) * 0.618034;
  return 0.5 + 0.4 * cos(6.2832 * (fract(h) + vec3f(0.0, 0.33, 0.67)));
}

fn project(q: vec3f) -> vec4f {
  let r = q - u.cam.xyz;
  let zf = r.x * u.view.x + r.z * u.view.y;
  let xr = -r.x * u.view.y + r.z * u.view.x;
  let s = u.cam.w / max(zf, 0.01);
  return vec4f(u.screen.x * 0.5 + xr * s, u.view.z - r.y * s, zf, s);
}

var<private> CORNERS: array<vec2f, 6> = array<vec2f, 6>(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1));

// instances: fighters [0, NPLAYER), projectiles, then sprites
@vertex fn vs_splat(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> SOut {
  var o: SOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  let corner = CORNERS[v];
  var center = vec3f(0.0);
  var half = vec2f(0.0);
  var color = vec4f(1.0);
  var kind = 0u;
  var minpx = 0.8;
  let dt = u.screen.w;
  if (i < ${L.NPLAYER}u) {
    let b = i * ${L.PSIZE}u;
    let fl = players[(b + ${L.P_FL}u) / 4u] & 255u;
    if ((fl & ${L.PF_LIVE}u) == 0u || (fl & ${L.PF_DEAD}u) != 0u || i == u32(u.misc.x)) { return o; }
    let vel = vec3f(pf(b, ${L.P_VX}u), pf(b, ${L.P_VY}u), pf(b, ${L.P_VZ}u));
    center = vec3f(pf(b, ${L.P_PX}u), pf(b, ${L.P_PY}u) + 0.92, pf(b, ${L.P_PZ}u)) + vel * dt;
    half = vec2f(0.5, 0.92);
    color = vec4f(slotColor(i), 1.0);
    // the match's sides: red and blue by PF_BLUE; Infection's zombies green, the juggernaut gold, everyone else one blue
    if (u.map.z > 1.5) { color = select(vec4f(0.92, 0.22, 0.16, 1.0), vec4f(0.22, 0.42, 1.0, 1.0), (fl & ${L.PF_BLUE}u) != 0u); }
    else if (u.map.z > 0.5) { color = vec4f(0.3, 0.5, 0.95, 1.0); }
    if ((fl & ${L.PF_ZOMBIE}u) != 0u) { color = vec4f(0.35, 0.95, 0.25, 1.0); }
    if ((fl & ${L.PF_JUGG}u) != 0u) { color = vec4f(1.0, 0.72, 0.15, 1.0); }
    kind = 1u;
    minpx = 1.0;
  } else if (i < ${L.NPLAYER + L.NPROJ}u) {
    let j = i - ${L.NPLAYER}u;
    let b = j * ${L.JSIZE}u;
    let k = (proj[(b + ${L.J_KIND}u) / 4u] >> 16u) & 255u;
    if (k == 0u) { return o; }
    let mine = (proj[(b + ${L.J_OWNER}u) / 4u] & 255u) == u32(u.misc.x);
    let vel = vec3f(jf(b, ${L.J_VX}u), jf(b, ${L.J_VY}u), jf(b, ${L.J_VZ}u));
    center = vec3f(jf(b, ${L.J_PX}u), jf(b, ${L.J_PY}u), jf(b, ${L.J_PZ}u)) + vel * select(dt, u.pred.x, mine);
    kind = 2u;
    switch k {
      case ${L.K_ROCKET}u: { half = vec2f(0.25); color = vec4f(1.0, 0.7, 0.3, 1.0); minpx = 1.5; }
      case ${L.K_GRENADE}u: { half = vec2f(0.12); color = vec4f(0.3, 0.36, 0.2, 1.0); kind = 0u; minpx = 1.0; }
      case ${L.K_BOLT}u: { half = vec2f(0.2); color = vec4f(0.35, 0.75, 1.0, 1.0); minpx = 1.5; }
      default: { half = vec2f(0.1); color = vec4f(1.0, 0.35, 0.85, 1.0); minpx = 1.0; }
    }
  } else {
    let s = i - ${L.NPLAYER + L.NPROJ}u;
    if (s >= u32(u.misc.y)) { return o; }
    let a = sprites[3u * s];
    color = sprites[3u * s + 1u];
    let info = sprites[3u * s + 2u]; // kind, aspect, min px, 0
    center = a.xyz;
    half = vec2f(a.w, a.w * info.y);
    kind = u32(info.x);
    minpx = info.z;
  }
  let pr = project(center);
  if (pr.z < 0.3 || pr.z > u.screen.z) { return o; }
  let px = max(half * pr.w, vec2f(minpx, minpx * half.y / half.x));
  let s = vec2f(pr.x, pr.y) + corner * px;
  o.pos = vec4f(s.x / u.screen.x * 2.0 - 1.0, 1.0 - s.y / u.screen.y * 2.0, pr.z / u.screen.z, 1.0);
  o.uv = corner;
  o.color = color;
  o.kind = kind;
  return o;
}

// solid splats: 0 a ball, 1 a fighter, 2 a glowing bolt, 4 a weapon on its pad, 7 a flag, 8 a skull
@fragment fn fs_splat(s: SOut) -> @location(0) vec4f {
  let r2 = dot(s.uv, s.uv);
  var c = s.color.rgb;
  switch s.kind {
    case 0u: {
      if (r2 > 1.0) { discard; }
      let n = vec3f(s.uv.x, -s.uv.y, sqrt(1.0 - r2));
      c *= 0.45 + 0.6 * max(dot(n, normalize(vec3f(0.3, 0.8, 0.5))), 0.0);
    }
    case 1u: { // a soldier: helmet with a gold visor, armoured body, legs
      let y = s.uv.y;
      let head = length(vec2f(s.uv.x * 1.15, (y + 0.78) * 2.0)) < 0.42;
      let visor = head && y > -0.86 && y < -0.72 && abs(s.uv.x) < 0.3;
      let body = abs(s.uv.x) < 0.78 - 0.18 * max(y, 0.0) && y > -0.58 && y < 0.25;
      let legs = y >= 0.25 && abs(abs(s.uv.x) - 0.3) < 0.2;
      if (!head && !body && !legs) { discard; }
      if (visor) { c = vec3f(0.95, 0.72, 0.25); }
      else if (legs) { c *= 0.65; }
      c *= 0.7 + 0.3 * (1.0 - abs(s.uv.x));
    }
    case 2u: {
      if (r2 > 1.0) { discard; }
      c = mix(vec3f(1.0, 1.0, 0.95), c, sqrt(r2));
    }
    case 4u: { // a weapon on its pad: a bar of its colour over a ring of light
      let bar = abs(s.uv.y + 0.2) < 0.18 && abs(s.uv.x) < 0.9;
      let ring = abs(s.uv.y - 0.85) < 0.12;
      if (!bar && !ring) { discard; }
      if (ring) { c = mix(c, vec3f(1.0), 0.5); }
    }
    case 7u: { // a flag: a pole with a gold knob, the pennant in the sprite's colour waving off it, the far end most
      let x = s.uv.x;
      let y = s.uv.y;
      let wave = 0.07 * sin(x * 6.0 - u.view.w * 7.0) * (x + 0.8);
      let pole = abs(x + 0.86) < 0.07 && y > -0.94;
      let knob = length(vec2f(x + 0.86, (y + 0.95) * 2.0)) < 0.13;
      let flag = x > -0.8 && x < 0.95 - 0.12 * abs(y + 0.56 - wave) && y > -0.92 + wave && y < -0.2 + wave;
      if (!pole && !knob && !flag) { discard; }
      if (knob) { c = vec3f(1.0, 0.82, 0.3); }
      else if (pole && !flag) { c = vec3f(0.82, 0.82, 0.78) * (0.8 + 0.3 * (x + 0.86) / 0.07); }
      else { c *= 0.78 + 0.32 * (0.5 + 0.5 * sin(x * 6.0 - u.view.w * 7.0 + 1.2)); }
    }
    case 8u: { // a skull: a lit dome of bone, dark eyes and nose, a jaw of teeth
      let x = s.uv.x;
      let y = s.uv.y;
      let dome = length(vec2f(x, (y + 0.18) * 1.06)) < 0.8;
      let jaw = abs(x) < 0.44 - 0.25 * max(y - 0.7, 0.0) && y > 0.3 && y < 0.9;
      if (!dome && !jaw) { discard; }
      let eye = length(vec2f(abs(x) - 0.31, (y + 0.02) * 1.15)) < 0.21;
      let nose = y > 0.2 && y < 0.44 && abs(x) < (y - 0.2) * 0.45;
      let teeth = y > 0.58 && y < 0.86 && abs(fract(x * 4.5 + 0.5) - 0.5) < 0.07;
      let r = vec2f(x, y + 0.18);
      let n = vec3f(r.x, -r.y, sqrt(max(1.0 - dot(r, r), 0.05)));
      c *= 0.55 + 0.5 * max(dot(normalize(n), normalize(vec3f(0.3, 0.8, 0.5))), 0.0);
      if (eye || nose) { c = vec3f(0.08, 0.06, 0.06); }
      else if (teeth) { c *= 0.45; }
    }
    default: {}
  }
  return vec4f(dither(c, s.pos.xy), 1.0);
}

// glowing sprites, blended: 3 a blast, 5 a spark, 6 a shield shimmer
@fragment fn fs_glow(s: SOut) -> @location(0) vec4f {
  let r2 = dot(s.uv, s.uv);
  if (r2 > 1.0) { discard; }
  var a = s.color.a * (1.0 - r2);
  if (s.kind == 6u) { a = s.color.a * smoothstep(0.5, 1.0, r2) * 2.0; }
  return vec4f(mix(s.color.rgb, vec3f(1.0, 1.0, 0.9), (1.0 - r2) * a) * a, a);
}

// ---- beams: tracers, a quad between two projected points
struct BOut { @builtin(position) pos: vec4f, @location(0) color: vec4f, @location(1) across: f32 };
@vertex fn vs_beam(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> BOut {
  var o: BOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  if (i >= u32(u.misc.w)) { return o; }
  let a = beams[3u * i];
  let b = beams[3u * i + 1u];
  var pa = project(a.xyz);
  var pb = project(b.xyz);
  if (pa.z < 0.3 && pb.z < 0.3) { return o; }
  // clip the end behind the eye to just in front of it
  if (pa.z < 0.3) { let t = (0.3 - pa.z) / (pb.z - pa.z); pa = project(mix(a.xyz, b.xyz, t)); }
  if (pb.z < 0.3) { let t = (0.3 - pb.z) / (pa.z - pb.z); pb = project(mix(b.xyz, a.xyz, t)); }
  let d = pb.xy - pa.xy;
  let n = normalize(vec2f(-d.y, d.x) + vec2f(1e-6, 0.0));
  let c = CORNERS[v];
  let end = select(pa, pb, c.x > 0.0);
  let w = max(a.w * end.w, 0.6);
  let s = end.xy + n * c.y * w;
  o.pos = vec4f(s.x / u.screen.x * 2.0 - 1.0, 1.0 - s.y / u.screen.y * 2.0, clamp(end.z / u.screen.z, 0.0, 1.0), 1.0);
  o.color = beams[3u * i + 2u];
  o.across = c.y;
  return o;
}
@fragment fn fs_beam(b: BOut) -> @location(0) vec4f {
  let a = b.color.a * (1.0 - abs(b.across) * 0.6);
  return vec4f(b.color.rgb * a, a);
}

// ---- HUD
var<private> PALETTE: array<vec3f, 8> = array<vec3f, 8>(${PALETTE.map(vec3).join(', ')});

fn glyphBit(cell: vec2i, px: vec2i) -> bool {
  if (cell.x < 0 || cell.y < 0 || cell.x >= ${COLS} || cell.y >= i32(u.hud.x)) { return false; }
  if (px.x < 0 || px.x > 2 || px.y < 0 || px.y > 4) { return false; }
  let ch = hud[u32(cell.y) * ${COLS}u + u32(cell.x)] & 255u;
  if (ch < 32u || ch > 95u) { return false; }
  return ((font[ch - 32u] >> u32(14 - (px.y * 3 + px.x))) & 1u) == 1u;
}

fn lit(p: vec2i) -> bool {
  let cell = vec2i(p.x / 4, p.y / 6);
  return glyphBit(cell, vec2i(p.x - cell.x * 4, p.y - cell.y * 6));
}

fn graphPx(p: vec2i) -> vec4f {
  let col = p.x - (i32(u.screen.x) - ${GRAPH_N + 4});
  if (u.fx.z < 0.5 || col < 0 || col >= ${GRAPH_N}) { return vec4f(0.0); }
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

// crosshairs: 0 a ring and dot (rifles), 1 a dot (precision), 2 a wide ring (shotgun),
// 3 a big circle (rocket), 4 a chevron (plasma, needles), 5 a sword's brackets, 7 none
fn cross(d: vec2f, kind: u32, gap: f32) -> bool {
  let r = length(d);
  switch kind {
    case 0u: { return (abs(r - 6.0 - gap) < 0.6) || (r < 0.8) || (abs(d.y) < 0.5 && abs(abs(d.x) - 9.5 - gap) < 1.5); }
    case 1u: { return r < 1.0 || (abs(d.x) < 0.5 && abs(abs(d.y) - 4.0) < 1.2) || (abs(d.y) < 0.5 && abs(abs(d.x) - 4.0) < 1.2); }
    case 2u: { return abs(r - 11.0) < 0.6 || r < 0.8; }
    case 3u: { return abs(r - 14.0) < 0.6 || (r < 0.8) || (abs(d.y) < 0.5 && abs(d.x) < 3.0); }
    case 4u: { return (abs(abs(d.x) - (d.y + 5.0) * 0.8) < 0.7 && d.y > -5.0 && d.y < 2.0) || r < 0.8; }
    case 7u: { return false; }
    default: { return (abs(abs(d.x) - 7.0) < 0.7 && abs(d.y) < 6.0) || r < 0.8; }
  }
}

@fragment fn fs_hud(@builtin(position) q: vec4f) -> @location(0) vec4f {
  let p = vec2i(q.xy);
  let c = vec2f(u.screen.x, u.screen.y) * 0.5;
  let d = q.xy - c - vec2f(0.5);
  // the scope: black past a circle, a fine cross through it
  if (u.fx.y > 0.5) {
    let r = length(d);
    if (r > u.screen.y * 0.46) { return vec4f(0.0, 0.0, 0.0, 1.0); }
    if (abs(r - u.screen.y * 0.46) < 1.0) { return vec4f(0.1, 0.1, 0.1, 1.0); }
    if ((abs(d.x) < 0.5 || abs(d.y) < 0.5) && r > 3.0) { return vec4f(0.0, 0.0, 0.0, 0.8); }
  }
  // the hit marker: four short ticks out from the centre
  if (u.hud.w > 0.0 && abs(abs(d.x) - abs(d.y)) < 0.7 && max(abs(d.x), abs(d.y)) > 3.0 && max(abs(d.x), abs(d.y)) < 6.5) {
    return vec4f(1.0, 1.0, 1.0, u.hud.w);
  }
  // the crosshair, red over an enemy in range
  let ck = u32(u.hud.z);
  if (u.fx.y < 0.5 && cross(d, ck & 7u, u.fx.w)) { return select(vec4f(0.55, 0.85, 1.0, 0.9), vec4f(1.0, 0.25, 0.2, 0.95), ck >= 8u); }
  let td = q.xy - u.pred.yz;
  let tr = length(td);
  if (u.pred.w > 0.0 && (abs(tr - u.pred.w) < 0.7 || (tr < u.pred.w && (abs(td.x) < 0.4 || abs(td.y) < 0.4)))) { return vec4f(0.5, 0.8, 1.0, 0.7); }
  if (lit(p)) {
    let cell = vec2i(p.x / 4, p.y / 6);
    let k = (hud[u32(cell.y) * ${COLS}u + u32(cell.x)] >> 8u) & 7u;
    return vec4f(PALETTE[k], 1.0);
  }
  if (lit(p - vec2i(1, 1))) { return vec4f(0.0, 0.0, 0.0, 0.8); }
  let g = graphPx(p);
  if (g.a > 0.0) { return g; }
  // rectangles, the last drawn on top: the gun, the bars
  for (var k = i32(u.hud.y) - 1; k >= 0; k--) {
    let r = rects[2u * u32(k)];
    if (q.x >= r.x && q.x < r.z && q.y >= r.y && q.y < r.w) {
      let col = rects[2u * u32(k) + 1u];
      return vec4f(dither(col.rgb, q.xy), col.a);
    }
  }
  // the tracker's face, and the sweep going round it
  if (u.pred.w > 0.0 && tr < u.pred.w) {
    let sweep = fract(atan2(td.y, td.x) / 6.2832 - u.view.w * 0.5);
    return vec4f(0.1, 0.25, 0.4, 0.35 + 0.25 * pow(sweep, 8.0));
  }
  // hurt: the edges flash red
  let edge = max(abs(d.x) / c.x, abs(d.y) / c.y);
  if (u.fx.x > 0.0 && edge > 0.8) { return vec4f(0.8, 0.05, 0.05, u.fx.x * (edge - 0.8) * 3.0); }
  discard;
  return vec4f(0.0);
}
`;

export async function createRenderer(canvas, { present = true, device: shared = null } = {}) {
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
  const rows = Math.floor(H / 6);
  const module = device.createShaderModule({ code: WGSL });
  const info = await module.getCompilationInfo();
  const errs = info.messages.filter((m) => m.type === 'error');
  if (errs.length) throw new Error('WGSL: ' + errs.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; '));

  const ubuf = device.createBuffer({ size: 160, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const storage = (size) => device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const playerBuf = storage(L.NPLAYER * L.PSIZE);
  const projBuf = storage(L.NPROJ * L.JSIZE);
  const spriteBuf = storage(MAX_SPRITE * 48);
  const beamBuf = storage(MAX_BEAM * 48);
  const rectBuf = storage(MAX_RECT * 32);
  const hudBuf = storage(COLS * rows * 4);
  const fontBuf = storage(FONT.length * 4);
  const graphBuf = storage(GRAPH_PANELS * GRAPH_N * 16);
  const boxBuf = storage(L.NBOX * 32);
  const groupBuf = storage(L.NGROUP * 32);
  let nbox = 0, ngroup = 0;
  device.queue.writeBuffer(fontBuf, 0, FONT);
  const hmap = device.createTexture({ size: [512, 512], format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const smap = device.createTexture({ size: [512, 512], format: 'r8uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const depth = device.createTexture({ size: [W, H], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT });

  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } },
      // the bodies, projectiles, sprites and beams are read by the vertex stage, the rest by the fragment's: at most 8 a stage
      ...[3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((b) => ({ binding: b, visibility: b <= 6 ? GPUShaderStage.VERTEX : GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } })),
    ],
  });
  const bind = device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: { buffer: ubuf } },
      { binding: 1, resource: hmap.createView() },
      { binding: 2, resource: smap.createView() },
      ...[playerBuf, projBuf, spriteBuf, beamBuf, rectBuf, hudBuf, fontBuf, graphBuf, boxBuf, groupBuf].map((buffer, k) => ({ binding: 3 + k, resource: { buffer } })),
    ],
  });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const pipe = (vs, fs, { depthWrite, depthCompare, blend }) => device.createRenderPipeline({
    layout: pl,
    vertex: { module, entryPoint: vs },
    fragment: { module, entryPoint: fs, targets: [{ format, blend }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: depthWrite, depthCompare },
  });
  const over = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
  const add = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
  const terrain = pipe('vs_full', 'fs_terrain', { depthWrite: true, depthCompare: 'always' });
  const splat = pipe('vs_splat', 'fs_splat', { depthWrite: true, depthCompare: 'less' });
  const glow = pipe('vs_splat', 'fs_glow', { depthWrite: false, depthCompare: 'less', blend: add });
  const beam = pipe('vs_beam', 'fs_beam', { depthWrite: false, depthCompare: 'less', blend: add });
  const hudPipe = pipe('vs_full', 'fs_hud', { depthWrite: false, depthCompare: 'always', blend: over });

  const uf = new Float32Array(40);
  const hud = new Uint32Array(COLS * rows);
  const spriteData = new Float32Array(MAX_SPRITE * 12);
  const beamData = new Float32Array(MAX_BEAM * 12);
  const rectData = new Float32Array(MAX_RECT * 8);
  let hmax = 100;

  return {
    rows, width: W, height: H,
    setTerrain(u8) {
      const h16 = new Uint16Array(u8.buffer, L.TERRAIN_H, 512 * 512);
      const hf = new Float32Array(512 * 512);
      hmax = 0;
      for (let i = 0; i < hf.length; i++) { hf[i] = h16[i] / 256; hmax = Math.max(hmax, hf[i]); }
      device.queue.writeTexture({ texture: hmap }, hf, { bytesPerRow: 512 * 4 }, [512, 512]);
      device.queue.writeTexture({ texture: smap }, u8.slice(L.TERRAIN_S, L.TERRAIN_S + 512 * 512), { bytesPerRow: 512 }, [512, 512]);
    },

    // map: a View's map() (src/arena-view.mjs): its boxes and their groups
    setMap(map) {
      const b = new Float32Array(L.NBOX * 8), g = new Float32Array(L.NGROUP * 8);
      map.boxes.forEach((x, k) => b.set([x.box[0], x.box[1], x.box[2], x.material, x.box[3], x.box[4], x.box[5], 0], 8 * k));
      map.groups.forEach((x, k) => g.set([x.box[0], x.box[1], x.box[2], x.first, x.box[3], x.box[4], x.box[5], x.count], 8 * k));
      device.queue.writeBuffer(boxBuf, 0, b);
      device.queue.writeBuffer(groupBuf, 0, g);
      nbox = map.boxes.length;
      ngroup = map.groups.length;
    },

    // s: { cam, yaw, pitch, zoom (focal multiplier), time, dt, dtPred, proj, slot,
    //      solid: [{ pos, size, aspect, color: [r,g,b], kind, minpx }] (objectives, pads), glow: [... kind 3, 5, 6, color [r,g,b,a]],
    //      beams: [{ a, b, width, color: [r,g,b,a] }], rects: [[x0, y0, x1, y1, r, g, b, a]],
    //      crosshair, gap, marker, hurt, scope, text, graph, sides (0 colour by slot, 1 one side against the rest, 2 red and blue by PF_BLUE),
    //      zone (null, or { x, z, r, y, h, color: [r,g,b], pulse }: a disc painted on the terrain and box tops within h of y, any height without y) }
    frame(u8, s, target) {
      if (!ctx && !target) return;
      const { focal, horizon } = lens(s, W, H);
      const sprites = [...s.solid, ...s.glow].slice(0, MAX_SPRITE);
      const z = s.zone;
      uf.set([s.cam[0], s.cam[1], s.cam[2], focal, Math.cos(s.yaw), Math.sin(s.yaw), horizon, s.time,
        W, H, FAR, s.dt, s.slot, sprites.length, hmax + 2, Math.min(s.beams.length, MAX_BEAM),
        rows, Math.min(s.rects.length, MAX_RECT), s.crosshair, s.marker, s.hurt, s.scope ? 1 : 0, s.graph ? 1 : 0, s.gap, s.dtPred ?? s.dt, ...(s.tracker || [0, 0, 0]),
        nbox, ngroup, Number(s.sides) || 0, z ? (z.y === undefined ? 1e9 : z.h ?? 2) : 0,
        z ? z.x : 0, z ? z.z : 0, z ? z.r : 0, z?.y ?? 0, ...(z ? z.color : [1, 1, 1]), z?.pulse ?? 0]);
      if (s.graph) device.queue.writeBuffer(graphBuf, 0, s.graph);
      device.queue.writeBuffer(ubuf, 0, uf);
      device.queue.writeBuffer(playerBuf, 0, u8, L.PLAYERS, L.NPLAYER * L.PSIZE);
      device.queue.writeBuffer(projBuf, 0, u8, s.proj ?? L.PROJ, L.NPROJ * L.JSIZE);
      sprites.forEach((p, k) => {
        const c = p.color;
        spriteData.set([p.pos[0], p.pos[1], p.pos[2], p.size, c[0], c[1], c[2], c[3] ?? 1, p.kind, p.aspect ?? 1, p.minpx ?? 1, 0], k * 12);
      });
      if (sprites.length) device.queue.writeBuffer(spriteBuf, 0, spriteData, 0, sprites.length * 12);
      s.beams.slice(0, MAX_BEAM).forEach((b, k) => beamData.set([b.a[0], b.a[1], b.a[2], b.width, b.b[0], b.b[1], b.b[2], 0, ...b.color], k * 12));
      if (s.beams.length) device.queue.writeBuffer(beamBuf, 0, beamData, 0, Math.min(s.beams.length, MAX_BEAM) * 12);
      s.rects.slice(0, MAX_RECT).forEach((r, k) => rectData.set(r, k * 8));
      if (s.rects.length) device.queue.writeBuffer(rectBuf, 0, rectData, 0, Math.min(s.rects.length, MAX_RECT) * 8);
      hud.set(s.text.subarray(0, hud.length));
      device.queue.writeBuffer(hudBuf, 0, hud);
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: (target || ctx.getCurrentTexture()).createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
        depthStencilAttachment: { view: depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
      });
      pass.setBindGroup(0, bind);
      pass.setPipeline(terrain);
      pass.draw(3);
      pass.setPipeline(splat);
      pass.draw(6, L.NPLAYER + L.NPROJ, 0, 0);
      if (s.solid.length) pass.draw(6, Math.min(s.solid.length, MAX_SPRITE), 0, L.NPLAYER + L.NPROJ);
      pass.setPipeline(beam);
      if (s.beams.length) pass.draw(6, Math.min(s.beams.length, MAX_BEAM));
      pass.setPipeline(glow);
      const ng = sprites.length - s.solid.length;
      if (ng > 0) pass.draw(6, ng, 0, L.NPLAYER + L.NPROJ + s.solid.length);
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
