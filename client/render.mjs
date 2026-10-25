// WebGPU renderer, three passes over one small canvas scaled up with crisp
// pixels: the terrain ray-marched per pixel (voxel space, pitch by shearing)
// writing depth, bodies as depth-tested splats uploaded straight from the
// sim's shared memory, then a HUD in a 3x5 font. Nothing here is hashed, so
// any math goes.
import * as L from '../src/layout.mjs';
import { FONT } from './font.mjs';
import { GRAPH_N, GRAPH_PANELS } from './netgraph.mjs';

export const COLS = 80; // HUD cells of 4 x 6 px
const FAR = 900;
const MAX_FLASH = 64;
const NO_TINTS = new Uint32Array(L.NPLAYER); // a page with no looks: every seat its own colour
// the third array (vz) ends at 6 x BALL_CAP floats; flags and owners follow
const BALL_WORDS = 6 * L.BALL_CAP + L.BALL_CAP / 4 + L.BALL_CAP / 2;

const WGSL = /* wgsl */ `
struct U {
  cam: vec4f,      // eye x, y, z, focal (px)
  view: vec4f,     // cos yaw, sin yaw, horizon (px), time (s)
  screen: vec4f,   // width, height, far, extrapolate (s)
  cup: vec4f,      // cup x, y, z, my slot
  hole: vec4f,     // hole direction x, z, highest ground, flash count
  me: vec4u,       // nballs, my ball (or 0xffffffff), hud rows, sunk-ball count
  pred: vec4f,     // extrapolate my projectiles (s): they come from the prediction, at its own clock; the net graph shown (1)
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var hmap: texture_2d<f32>;
@group(0) @binding(2) var smap: texture_2d<u32>;
@group(0) @binding(3) var<storage, read> balls: array<f32>;
@group(0) @binding(4) var<storage, read> players: array<u32>;
@group(0) @binding(5) var<storage, read> proj: array<u32>;
@group(0) @binding(6) var<storage, read> flashes: array<vec4f>;
@group(0) @binding(7) var<storage, read> hud: array<u32>;
@group(0) @binding(8) var<storage, read> font: array<u32>;
@group(0) @binding(9) var<storage, read> graph: array<vec4f>;

const SKY_LO = vec3f(0.62, 0.66, 0.74);
const SKY_HI = vec3f(0.16, 0.22, 0.42);
const SUN = vec3f(0.48, 0.74, 0.47);

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

fn surfColor(s: u32, w: vec2f) -> vec3f {
  let n = hash2(floor(w * 2.0));
  let stripe = select(0.94, 1.06, (i32(floor(dot(w, vec2f(-u.hole.y, u.hole.x)) / 5.0)) & 1) == 0);
  switch s {
    case 0u: { return vec3f(0.33, 0.6, 0.2) * stripe * (0.96 + 0.08 * n); }
    case 1u: { return vec3f(0.2, 0.4, 0.13) * (0.85 + 0.3 * n); }
    case 2u: { return vec3f(0.86, 0.77, 0.52) * (0.92 + 0.12 * n); }
    default: { return vec3f(0.4, 0.74, 0.3) * select(0.97, 1.03, ((i32(floor(w.x)) + i32(floor(w.y))) & 1) == 0); }
  }
}

// surface colours blended over the four samples around w, so edges are soft
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
  loop {
    let w = u.cam.xz + dir * z;
    let ry = u.cam.y + rise * z;
    if (ry <= hgt(w.x, w.y)) { hit = true; break; }
    if (rise >= 0.0 && ry > u.hole.z) { break; }
    prev = z;
    z += 0.04 + z * 0.012;
    if (z > u.screen.z) { break; }
  }
  if (!hit) {
    var c = sky(p.y);
    let sd = dot(normalize(vec3f(dir.x, rise, dir.y)), SUN);
    c += vec3f(1.0, 0.9, 0.7) * pow(max(sd, 0.0), 300.0);
    o.color = vec4f(dither(c, p.xy), 1.0);
    o.depth = 1.0;
    return o;
  }
  var a = prev;
  var b = z;
  for (var k = 0; k < 6; k++) {
    let m = 0.5 * (a + b);
    let w = u.cam.xz + dir * m;
    if (u.cam.y + rise * m <= hgt(w.x, w.y)) { b = m; } else { a = m; }
  }
  z = b;
  let w = u.cam.xz + dir * z;
  let n = normalize(vec3f(hgt(w.x - 1.0, w.y) - hgt(w.x + 1.0, w.y), 2.0, hgt(w.x, w.y - 1.0) - hgt(w.x, w.y + 1.0)));
  var c = ground(w) * (0.45 + 0.65 * max(dot(n, SUN), 0.0));
  // the slipgate: a dark swirl in the green with a lit rim
  let dc = distance(w, u.cup.xz);
  if (dc < 0.62) {
    let ang = atan2(w.y - u.cup.z, w.x - u.cup.x);
    let swirl = 0.5 + 0.5 * sin(ang * 3.0 + dc * 18.0 - u.view.w * 5.0);
    c = mix(vec3f(0.08, 0.02, 0.12), vec3f(0.45, 0.15, 0.7), swirl * (1.0 - dc / 0.62));
    if (dc > 0.5) { c = vec3f(0.85, 0.75, 1.0); }
  }
  let fog = 1.0 - exp(-z / 380.0);
  c = mix(c, SKY_LO, fog);
  o.color = vec4f(dither(c, p.xy), 1.0);
  o.depth = z / u.screen.z;
  return o;
}

// ---- splats
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
  return 0.55 + 0.45 * cos(6.2832 * (fract(h) + vec3f(0.0, 0.33, 0.67)));
}
// a look's colour for slot p (client/looks.mjs tint, after the player records), else the seat's
fn tintOf(p: u32, seat: vec3f) -> vec3f {
  let w = players[${L.NPLAYER * L.PSIZE / 4}u + min(p, 255u)];
  if (p > 255u || (w >> 24u) == 0u) { return seat; }
  return vec3f(f32((w >> 16u) & 255u), f32((w >> 8u) & 255u), f32(w & 255u)) / 255.0;
}

// world point -> screen x, y (px), forward depth, px per metre
fn project(q: vec3f) -> vec4f {
  let r = q - u.cam.xyz;
  let zf = r.x * u.view.x + r.z * u.view.y;
  let xr = -r.x * u.view.y + r.z * u.view.x;
  let s = u.cam.w / max(zf, 0.01);
  return vec4f(u.screen.x * 0.5 + xr * s, u.view.z - r.y * s, zf, s);
}

var<private> CORNERS: array<vec2f, 6> = array<vec2f, 6>(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1));

// instance ranges: balls [0, BALL_CAP), players, projectiles, flashes, markers
@vertex fn vs_splat(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> SOut {
  var o: SOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0); // off screen unless set below
  let corner = CORNERS[v];
  var center = vec3f(0.0);
  var half = vec2f(0.0);   // metres
  var color = vec4f(1.0);
  var kind = 0u;
  var minpx = 0.6;
  let dt = u.screen.w;
  if (i < ${L.BALL_CAP}u) {
    if (i >= u.me.x) { return o; }
    let fl = (bitcast<u32>(balls[${6 * L.BALL_CAP}u + i / 4u]) >> ((i & 3u) * 8u)) & 255u;
    if ((fl & ${L.F_LIVE}u) == 0u) { return o; }
    let owner = (bitcast<u32>(balls[${6 * L.BALL_CAP + L.BALL_CAP / 4}u + i / 2u]) >> ((i & 1u) * 16u)) & 65535u;
    let vel = select(vec3f(0.0), vec3f(balls[i + ${3 * L.BALL_CAP}u], balls[i + ${4 * L.BALL_CAP}u], balls[i + ${5 * L.BALL_CAP}u]), (fl & ${L.F_AWAKE}u) != 0u);
    center = vec3f(balls[i], balls[i + ${L.BALL_CAP}u], balls[i + ${2 * L.BALL_CAP}u]) + vel * dt;
    half = vec2f(${L.PHYS.R});
    // a look shows more than the seat's tint does
    let looked = owner < 256u && (players[${L.NPLAYER * L.PSIZE / 4}u + min(owner, 255u)] >> 24u) != 0u;
    color = vec4f(mix(vec3f(1.0), tintOf(owner, slotColor(owner)), select(select(0.25, 0.6, looked), 0.0, owner == u32(u.cup.w))), 1.0);
    kind = 0u;
    minpx = 0.8;
  } else if (i < ${L.BALL_CAP + L.NPLAYER}u) {
    let p = i - ${L.BALL_CAP}u;
    let b = p * ${L.PSIZE}u;
    if ((players[(b + ${L.P_FL}u) / 4u] & ${L.PF_LIVE}u) == 0u || p == u32(u.cup.w)) { return o; }
    let vel = vec3f(pf(b, ${L.P_VX}u), pf(b, ${L.P_VY}u), pf(b, ${L.P_VZ}u));
    center = vec3f(pf(b, ${L.P_PX}u), pf(b, ${L.P_PY}u) + 0.9, pf(b, ${L.P_PZ}u)) + vel * dt;
    half = vec2f(0.45, 0.9);
    color = vec4f(tintOf(p, slotColor(p)), 1.0);
    kind = 1u;
    minpx = 1.0;
  } else if (i < ${L.BALL_CAP + L.NPLAYER + L.NPROJ}u) {
    let j = i - ${L.BALL_CAP + L.NPLAYER}u;
    let b = j * ${L.JSIZE}u;
    let k = (proj[(b + ${L.J_KIND}u) / 4u] >> 16u) & 255u;
    if (k == 0u) { return o; }
    let mine = (proj[(b + ${L.J_OWNER}u) / 4u] & 255u) == u32(u.cup.w);
    let vel = vec3f(jf(b, ${L.J_VX}u), jf(b, ${L.J_VY}u), jf(b, ${L.J_VZ}u));
    center = vec3f(jf(b, ${L.J_PX}u), jf(b, ${L.J_PY}u), jf(b, ${L.J_PZ}u)) + vel * select(dt, u.pred.x, mine);
    if (k == ${L.K_ROCKET}u) { half = vec2f(0.22); color = vec4f(1.0, 0.75, 0.3, 1.0); kind = 2u; minpx = 1.5; }
    else { half = vec2f(0.14); color = vec4f(0.25, 0.32, 0.18, 1.0); kind = 0u; minpx = 1.0; }
  } else if (i < ${L.BALL_CAP + L.NPLAYER + L.NPROJ + MAX_FLASH}u) {
    let f = i - ${L.BALL_CAP + L.NPLAYER + L.NPROJ}u;
    if (f >= u32(u.hole.w)) { return o; }
    let fl = flashes[2u * f];
    let info = flashes[2u * f + 1u]; // age (s), size (m), kind, 0
    center = fl.xyz;
    let grow = clamp(info.x / 0.35, 0.0, 1.0);
    half = vec2f(info.y * (0.35 + 0.65 * grow));
    color = vec4f(select(vec3f(1.0, 0.65, 0.2), vec3f(0.75, 0.4, 1.0), info.z > 1.5), 1.0 - grow);
    kind = 3u;
  } else {
    // markers: 0 the flag over the cup, 1 the arrow over my ball
    let m = i - ${L.BALL_CAP + L.NPLAYER + L.NPROJ + MAX_FLASH}u;
    if (m == 0u) {
      center = u.cup.xyz + vec3f(0.0, 1.6, 0.0);
      half = vec2f(0.6, 1.6);
      kind = 4u;
      minpx = 3.0;
    } else {
      if (u.me.y == 0xffffffffu) { return o; }
      let bi = u.me.y;
      let fl = (bitcast<u32>(balls[${6 * L.BALL_CAP}u + bi / 4u]) >> ((bi & 3u) * 8u)) & 255u;
      if ((fl & ${L.F_LIVE}u) == 0u) { return o; }
      center = vec3f(balls[bi], balls[bi + ${L.BALL_CAP}u] + 0.9 + 0.12 * sin(u.view.w * 4.0), balls[bi + ${2 * L.BALL_CAP}u]);
      half = vec2f(0.3);
      color = vec4f(1.0, 0.85, 0.2, 1.0);
      kind = 5u;
      minpx = 2.5;
    }
  }
  let pr = project(center);
  if (pr.z < 0.3 || pr.z > u.screen.z || (kind == 5u && pr.z < 4.0)) { return o; }
  var px = max(half * pr.w, vec2f(minpx, minpx * half.y / half.x));
  if (kind == 5u) { px = min(px, vec2f(4.0)); } // the arrow over my ball stays small
  let s = vec2f(pr.x, pr.y) + corner * px;
  o.pos = vec4f(s.x / u.screen.x * 2.0 - 1.0, 1.0 - s.y / u.screen.y * 2.0, pr.z / u.screen.z, 1.0);
  o.uv = corner;
  o.color = color;
  o.kind = kind;
  return o;
}

@fragment fn fs_splat(s: SOut) -> @location(0) vec4f {
  let r2 = dot(s.uv, s.uv);
  var c = s.color.rgb;
  switch s.kind {
    case 0u: { // a ball: a lit sphere
      if (r2 > 1.0) { discard; }
      let n = vec3f(s.uv.x, -s.uv.y, sqrt(1.0 - r2));
      c *= 0.45 + 0.6 * max(dot(n, normalize(vec3f(0.3, 0.8, 0.5))), 0.0);
    }
    case 1u: { // a player: body and head
      let head = length(vec2f(s.uv.x, (s.uv.y + 0.78) * 2.2)) < 0.42;
      let body = abs(s.uv.x) < 0.8 - 0.25 * max(s.uv.y, 0.0) && s.uv.y > -0.55;
      if (!head && !body) { discard; }
      if (head) { c = vec3f(0.85, 0.66, 0.5); }
      c *= 0.7 + 0.3 * (1.0 - abs(s.uv.x));
    }
    case 2u: { // a rocket: hot core, glow
      if (r2 > 1.0) { discard; }
      c = mix(vec3f(1.0, 1.0, 0.85), c, sqrt(r2));
    }
    case 4u: { // the flag: pole and pennant
      let pole = abs(s.uv.x + 0.85) < 0.12;
      let flag = s.uv.x > -0.85 && s.uv.y < -0.35 && s.uv.y > -1.0 + (s.uv.x + 0.85) * 0.18 && s.uv.x < 1.0 - abs(s.uv.y + 0.68) * 0.5;
      if (!pole && !flag) { discard; }
      c = select(vec3f(0.9, 0.9, 0.85), vec3f(0.85, 0.12, 0.1), flag);
    }
    case 5u: { // my arrow, pointing down
      if (abs(s.uv.x) > (1.0 - s.uv.y) * 0.5 || s.uv.y < -1.0) { discard; }
    }
    default: {}
  }
  return vec4f(dither(c, s.pos.xy), 1.0);
}

@fragment fn fs_flash(s: SOut) -> @location(0) vec4f {
  let r2 = dot(s.uv, s.uv);
  if (r2 > 1.0) { discard; }
  let a = s.color.a * (1.0 - r2);
  return vec4f(mix(s.color.rgb, vec3f(1.0, 1.0, 0.8), (1.0 - r2) * a) * a, a);
}

// ---- HUD: COLS x rows cells of 4 x 6 px; each cell a char (low 8 bits) and a colour (bits 8-11)
var<private> PALETTE: array<vec3f, 8> = array<vec3f, 8>(vec3f(1.0), vec3f(1.0, 0.85, 0.25), vec3f(1.0, 0.35, 0.3), vec3f(0.4, 1.0, 0.4),
  vec3f(0.6), vec3f(0.5, 0.85, 1.0), vec3f(1.0, 0.6, 0.2), vec3f(0.8, 0.55, 1.0));

fn glyphBit(cell: vec2i, px: vec2i) -> bool {
  if (cell.x < 0 || cell.y < 0 || cell.x >= ${COLS} || cell.y >= i32(u.me.z)) { return false; }
  if (px.x < 0 || px.x > 2 || px.y < 0 || px.y > 4) { return false; }
  let ch = hud[u32(cell.y) * ${COLS}u + u32(cell.x)] & 255u;
  if (ch < 32u || ch > 95u) { return false; }
  return ((font[ch - 32u] >> u32(14 - (px.y * 3 + px.x))) & 1u) == 1u;
}

fn lit(p: vec2i) -> bool {
  let cell = vec2i(p.x / 4, p.y / 6);
  return glyphBit(cell, vec2i(p.x - cell.x * 4, p.y - cell.y * 6));
}

// ---- the net graph (client/netgraph.mjs): ${GRAPH_PANELS} strips of ${GRAPH_N} columns at the top right, under
// their labels (HUD rows 2, 6, 10, 14), each 17 px tall, newest on the right
fn graphPx(p: vec2i) -> vec4f {
  let col = p.x - (i32(u.screen.x) - ${GRAPH_N + 4});
  if (u.pred.y < 0.5 || col < 0 || col >= ${GRAPH_N}) { return vec4f(0.0); }
  let k = (p.y - 18) / 24;
  let yy = p.y - 18 - 24 * k;
  if (p.y < 18 || k >= ${GRAPH_PANELS} || yy >= 17) { return vec4f(0.0); }
  let v = graph[u32(k * ${GRAPH_N} + col)];
  let f = (16.5 - f32(yy)) / 17.0; // this pixel's height, 0 at the base to 1 at the top
  let near = 0.5 / 17.0;
  let back = vec4f(0.0, 0.0, 0.0, 0.5);
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
  return back;
}

@fragment fn fs_hud(@builtin(position) q: vec4f) -> @location(0) vec4f {
  let p = vec2i(q.xy);
  let c = vec2i(i32(u.screen.x) / 2, i32(u.screen.y) / 2);
  let d = p - c;
  if ((d.x == 0 && abs(d.y) >= 2 && abs(d.y) <= 4) || (d.y == 0 && abs(d.x) >= 2 && abs(d.x) <= 4)) { return vec4f(1.0, 1.0, 1.0, 0.9); }
  if (lit(p)) {
    let cell = vec2i(p.x / 4, p.y / 6);
    let k = (hud[u32(cell.y) * ${COLS}u + u32(cell.x)] >> 8u) & 7u;
    return vec4f(PALETTE[k], 1.0);
  }
  if (lit(p - vec2i(1, 1))) { return vec4f(0.0, 0.0, 0.0, 0.8); }
  let g = graphPx(p);
  if (g.a > 0.0) { return g; }
  discard;
  return vec4f(0.0);
}
`;

// present: false draws nothing to the canvas (only capture() renders), for
// headless browsers, where presenting a WebGPU canvas loses the device.
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

  const ubuf = device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const storage = (size) => device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const ballBuf = storage(BALL_WORDS * 4);
  const playerBuf = storage(L.NPLAYER * L.PSIZE + L.NPLAYER * 4); // the records, then each slot's tint
  const projBuf = storage(L.NPROJ * L.JSIZE);
  const flashBuf = storage(MAX_FLASH * 32);
  const hudBuf = storage(COLS * rows * 4);
  const fontBuf = storage(FONT.length * 4);
  const graphBuf = storage(GRAPH_PANELS * GRAPH_N * 16);
  device.queue.writeBuffer(fontBuf, 0, FONT);
  const hmap = device.createTexture({ size: [512, 512], format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const smap = device.createTexture({ size: [512, 512], format: 'r8uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const depth = device.createTexture({ size: [W, H], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT });

  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } },
      ...[3, 4, 5, 6, 7, 8, 9].map((b) => ({ binding: b, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } })),
    ],
  });
  const bind = device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: { buffer: ubuf } },
      { binding: 1, resource: hmap.createView() },
      { binding: 2, resource: smap.createView() },
      ...[ballBuf, playerBuf, projBuf, flashBuf, hudBuf, fontBuf, graphBuf].map((buffer, k) => ({ binding: 3 + k, resource: { buffer } })),
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
  const terrain = pipe('vs_full', 'fs_terrain', { depthWrite: true, depthCompare: 'always' });
  const splat = pipe('vs_splat', 'fs_splat', { depthWrite: true, depthCompare: 'less' });
  const flash = pipe('vs_splat', 'fs_flash', { depthWrite: false, depthCompare: 'less', blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } });
  const hudPipe = pipe('vs_full', 'fs_hud', { depthWrite: false, depthCompare: 'always', blend: over });

  const uf = new Float32Array(28);
  const uu = new Uint32Array(uf.buffer);
  const hud = new Uint32Array(COLS * rows);
  const flashData = new Float32Array(MAX_FLASH * 8);
  let hmax = 100;

  return {
    rows,
    // The terrain, once per room: heights (1/256 m) and surfaces out of shared memory.
    setTerrain(u8) {
      const h16 = new Uint16Array(u8.buffer, L.TERRAIN_H, 512 * 512);
      const hf = new Float32Array(512 * 512);
      hmax = 0;
      for (let i = 0; i < hf.length; i++) { hf[i] = h16[i] / 256; hmax = Math.max(hmax, hf[i]); }
      device.queue.writeTexture({ texture: hmap }, hf, { bytesPerRow: 512 * 4 }, [512, 512]);
      device.queue.writeTexture({ texture: smap }, u8.slice(L.TERRAIN_S, L.TERRAIN_S + 512 * 512), { bytesPerRow: 512 }, [512, 512]);
    },

    // One frame. s: { cam: [x, y, z], yaw, pitch (radians), time, dt, dtPred, proj, cup, dir, slot, myBall, nballs, flashes: [{ pos, age, size, kind }], text: Uint32Array, graph: the net graph's Float32Array or null }
    // dt extrapolates the confirmed world; projectiles come from address `proj`
    // (the prediction's copy, where mine are ahead), mine extrapolated by dtPred.
    // Drawn to the canvas, or to `target` (a texture) when given.
    frame(u8, s, target) {
      if (!ctx && !target) return;
      const focal = W * 0.75;
      uf.set([s.cam[0], s.cam[1], s.cam[2], focal, Math.cos(s.yaw), Math.sin(s.yaw), H / 2 + Math.tan(Math.max(-1.35, Math.min(1.35, s.pitch))) * focal, s.time,
        W, H, FAR, s.dt, s.cup[0], s.cup[1], s.cup[2], s.slot, s.dir[0], s.dir[1], hmax + 2, Math.min(s.flashes.length, MAX_FLASH)]);
      uu[20] = s.nballs; uu[21] = s.myBall < 0 ? 0xffffffff : s.myBall; uu[22] = rows; uu[23] = 0;
      uf[24] = s.dtPred ?? s.dt;
      uf[25] = s.graph ? 1 : 0;
      if (s.graph) device.queue.writeBuffer(graphBuf, 0, s.graph);
      device.queue.writeBuffer(ubuf, 0, uf);
      const n = s.nballs;
      if (n) {
        for (const [k, a] of [L.PX, L.PY, L.PZ, L.VX, L.VY, L.VZ].entries()) device.queue.writeBuffer(ballBuf, k * L.BALL_CAP * 4, u8, a, ((n + 3) & ~3) * 4);
        device.queue.writeBuffer(ballBuf, 6 * L.BALL_CAP * 4, u8, L.FLAGS, (n + 3) & ~3);
        device.queue.writeBuffer(ballBuf, (6 * L.BALL_CAP + L.BALL_CAP / 4) * 4, u8, L.OWNER, ((n + 1) & ~1) * 2);
      }
      device.queue.writeBuffer(playerBuf, 0, u8, L.PLAYERS, L.NPLAYER * L.PSIZE);
      device.queue.writeBuffer(playerBuf, L.NPLAYER * L.PSIZE, s.tints ?? NO_TINTS);
      device.queue.writeBuffer(projBuf, 0, u8, s.proj ?? L.PROJ, L.NPROJ * L.JSIZE);
      s.flashes.slice(0, MAX_FLASH).forEach((f, k) => flashData.set([f.pos[0], f.pos[1], f.pos[2], 0, f.age, f.size, f.kind, 0], k * 8));
      device.queue.writeBuffer(flashBuf, 0, flashData);
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
      if (n) pass.draw(6, n, 0, 0);
      pass.draw(6, L.NPLAYER + L.NPROJ, 0, L.BALL_CAP);
      pass.draw(6, 2, 0, L.BALL_CAP + L.NPLAYER + L.NPROJ + MAX_FLASH);
      pass.setPipeline(flash);
      if (s.flashes.length) pass.draw(6, Math.min(s.flashes.length, MAX_FLASH), 0, L.BALL_CAP + L.NPLAYER + L.NPROJ);
      pass.setPipeline(hudPipe);
      pass.draw(3);
      pass.end();
      device.queue.submit([enc.finish()]);
    },

    // One frame read back from the GPU as RGBA bytes, for screenshots where
    // the browser can't composite a WebGPU canvas (headless runs).
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
