// A player's look: a ball and a hat, worn in every game the room plays. It is
// drawing only, never the sim: the relay carries each slot's look word beside
// the ticks (net/wire.mjs T_LOOK), so the hashed world is the same bits with or
// without them, and a room where nobody picked one looks as it always did.
// Ball 0 and hat 0 are the house look, the seat's own colours.
//
// The lists are append-only: a look's number is its place in its list, and
// that number is what goes on the wire. A number this build doesn't know (a
// newer client's) is drawn as the house look.
//
// A look with `unlock` is earned: it opens when that achievement does
// (client/achievements.mjs), kept in this browser like the achievements.

// The ball's patterns, as the bumper and party renderers draw them (case 0)
export const PATTERN = { BEACH: 0, STRIPES: 1, RIBS: 2, SOLID: 3, METAL: 4, EIGHT: 5 };
// The hat's styles, as the head is drawn (case 8)
export const STYLE = { CAP: 0, NONE: 1, BEANIE: 2, BAND: 3, HELMET: 4, CROWN: 5, PUMPKIN: 6 };

// a: the ball's colour (null: the seat's), b: its second colour (null: the
// seat's other, as the beach ball's third panel has always been)
export const BALLS = [
  { key: 'house', name: 'HOUSE COLOURS', pattern: PATTERN.BEACH, a: null, b: null },
  { key: 'beach', name: 'BEACH BALL', pattern: PATTERN.BEACH, a: [0.95, 0.22, 0.18], b: [0.18, 0.42, 0.95] },
  { key: 'candy', name: 'CANDY', pattern: PATTERN.STRIPES, a: [1.0, 0.42, 0.62], b: [0.98, 0.95, 0.93] },
  { key: 'zebra', name: 'ZEBRA', pattern: PATTERN.STRIPES, a: [0.07, 0.07, 0.08], b: [0.95, 0.95, 0.92] },
  { key: 'melon', name: 'MELON', pattern: PATTERN.RIBS, a: [0.36, 0.76, 0.3], b: [0.1, 0.38, 0.14] },
  { key: 'pumpkin', name: 'PUMPKIN', pattern: PATTERN.RIBS, a: [1.0, 0.56, 0.12], b: [0.8, 0.36, 0.06] },
  { key: 'snow', name: 'SNOWBALL', pattern: PATTERN.SOLID, a: [0.9, 0.94, 1.0], b: [0.9, 0.94, 1.0] },
  { key: 'eight', name: 'EIGHT BALL', pattern: PATTERN.EIGHT, a: [0.06, 0.06, 0.07], b: [0.97, 0.97, 0.94], unlock: 'toasted' },
  { key: 'gold', name: 'GOLD', pattern: PATTERN.METAL, a: [1.0, 0.76, 0.22], b: [1.0, 0.76, 0.22], unlock: 'golden' },
  { key: 'mallow', name: 'MARSHMALLOW', pattern: PATTERN.STRIPES, a: [0.98, 0.95, 0.88], b: [0.78, 0.5, 0.24], unlock: 'campfire' },
];

// color: the hat's (null: the ball's colour, as the cap has always been)
export const HATS = [
  { key: 'cap', name: 'CAP', style: STYLE.CAP, color: null },
  { key: 'beanie', name: 'BEANIE', style: STYLE.BEANIE, color: [0.86, 0.18, 0.2] },
  { key: 'band', name: 'HEADBAND', style: STYLE.BAND, color: [0.2, 0.36, 0.88] },
  { key: 'helmet', name: 'HELMET', style: STYLE.HELMET, color: [0.95, 0.95, 0.97] },
  { key: 'none', name: 'NO HAT', style: STYLE.NONE, color: null },
  { key: 'pumpkin', name: 'PUMPKIN HEAD', style: STYLE.PUMPKIN, color: [1.0, 0.56, 0.12], unlock: 'chair' },
  { key: 'crown', name: 'CROWN', style: STYLE.CROWN, color: [1.0, 0.8, 0.22], unlock: 'roll' },
];

// what a card calls one: THE EIGHT BALL, THE CANDY BALL, THE CROWN
export const lookName = (x) => `THE ${x.pattern === undefined || /BALL$/.test(x.name) ? x.name : `${x.name} BALL`}`;

// The look word: the ball in the low byte, the hat in the next. 0 is the house look.
export const packLook = (ball, hat) => ((ball & 255) | ((hat & 255) << 8)) >>> 0;
export const unpackLook = (w) => ({ ball: BALLS[w & 255] ? w & 255 : 0, hat: HATS[(w >>> 8) & 255] ? (w >>> 8) & 255 : 0 });

// The seat's colour, as the bumper and party frontends have always drawn it
export const slotColor = (s) => { const h = (s * 0.618034) % 1; return [0, 0.33, 0.67].map((o) => 0.55 + 0.4 * Math.cos(6.2832 * (h + o))); };
// three 0..1 channels as one integer under 2^24, exact in an f32
export const rgb24 = (c) => (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255);

// What a slot in look w draws as: the ball's colour (the body's too), its
// second colour, the pattern, the hat's colour and style.
export function lookOf(slot, w = 0, seat = slotColor) {
  const { ball, hat } = unpackLook(w);
  const B = BALLS[ball], Hh = HATS[hat];
  const a = B.a || seat(slot);
  return { ball, hat, a, b: B.b || seat(slot + 0.5), pattern: B.pattern, hatColor: Hh.color || a, style: Hh.style };
}

// The sprites' fields for a rider (client/party-render.mjs SPRITE): the ball,
// the body and the head. color[3] is 1 for the house look (the renderer's old
// path: beach panels, the seat's colours from the seed, a cap), else 2 + the
// pattern or the style; a ball's seed is then its second colour, rgb24.
export function riderSprites(slot, w = 0) {
  const L = lookOf(slot, w);
  const { ball, hat } = unpackLook(w);
  return {
    ball: ball ? { color: [...L.a, 2 + L.pattern], seed: rgb24(L.b) } : { color: [...L.a, 1], seed: slot },
    body: { color: [...L.a, 1] },
    head: { color: [...L.hatColor, hat ? 2 + L.style : 1] },
  };
}

// For renderers that tint a whole player one colour (golf, the arena): the
// ball's colour with bit 24 set, or 0 for the house look (the seat's colour).
export const tint = (w) => { const { ball } = unpackLook(w); return ball ? (rgb24(BALLS[ball].a) | 0x1000000) >>> 0 : 0; };
// every slot's, from a host (client/host.mjs look), into one array kept per host
const TINTS = new WeakMap();
export function tintsOf(h) {
  let t = TINTS.get(h);
  if (!t) TINTS.set(h, (t = new Uint32Array(256)));
  for (let p = 0; p < 256; p++) t[p] = tint(h.look(p));
  return t;
}

// ---- what this browser picked, and what it has earned (localStorage, like the room's theme)
const KEY = 'fireplace.look';
export function savedLook() {
  try { return Number(localStorage.getItem(KEY)) >>> 0; } catch { return 0; }
}
export function saveLook(w) {
  try { localStorage.setItem(KEY, String(w >>> 0)); } catch { /* private window: this visit only */ }
}
// open: a look with no unlock, or one whose achievement is in `got` (a Set of ids)
export const isOpen = (look, got) => !look.unlock || got.has(look.unlock);
// the next open entry after k in list, wrapping
export function nextOpen(list, k, got) {
  for (let i = 1; i <= list.length; i++) { const j = (k + i) % list.length; if (isOpen(list[j], got)) return j; }
  return 0;
}
// a word with anything not open put back to the house look
export function wearable(w, got) {
  const { ball, hat } = unpackLook(w);
  return packLook(isOpen(BALLS[ball], got) ? ball : 0, isOpen(HATS[hat], got) ? hat : 0);
}

// ---- a picture of a look, for the TV's cards (a 2D canvas context)
const css = (c, k = 1) => `rgb(${c.map((v) => Math.round(Math.min(1, v * k) * 255)).join(',')})`;
export function drawLook(g, cx, cy, r, slot, w, t = 0) {
  const L = lookOf(slot, w);
  // the ball
  g.save();
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
  g.fillStyle = css(L.a); g.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  const spin = (t * 0.6) % 1;
  if (L.pattern === PATTERN.BEACH) {
    const pw = 2 * r / 3;
    for (let k = -3; k < 3; k++) {
      g.fillStyle = [css(L.a), css([0.85, 0.85, 0.85]), css(L.b)][(k + 3) % 3];
      g.fillRect(cx - r + k * pw + spin * 3 * pw, cy - r, pw + 1, 2 * r);
    }
    g.fillStyle = css([0.85, 0.85, 0.85]); g.fillRect(cx - r, cy - r, 2 * r, r * 0.28); g.fillRect(cx - r, cy + r * 0.72, 2 * r, r * 0.28);
  } else if (L.pattern === PATTERN.STRIPES) {
    g.fillStyle = css(L.b);
    for (let k = 1; k < 5; k += 2) g.fillRect(cx - r, cy - r + k * (2 * r / 5), 2 * r, 2 * r / 5);
  } else if (L.pattern === PATTERN.RIBS) {
    g.fillStyle = css(L.b);
    for (let k = 0; k < 8; k += 2) g.fillRect(cx - r + ((k + spin * 2) % 8) * (r / 4), cy - r, r / 8, 2 * r);
  } else if (L.pattern === PATTERN.METAL) {
    g.fillStyle = css(L.a, 1.25); g.fillRect(cx - r * 0.6, cy - r * 0.7, r * 0.35, r * 0.35);
  } else if (L.pattern === PATTERN.EIGHT) {
    g.fillStyle = css(L.b); g.beginPath(); g.arc(cx + r * 0.15, cy - r * 0.1, r * 0.45, 0, Math.PI * 2); g.fill();
    const px = Math.max(1, Math.round(r * 0.12));
    const EIGHT = [7, 5, 7, 5, 7]; // the font's 8, three pixels a row
    EIGHT.forEach((row, y) => { for (let x = 0; x < 3; x++) if ((row >> (2 - x)) & 1) { g.fillStyle = '#111'; g.fillRect(cx + r * 0.15 - 1.5 * px + x * px, cy - r * 0.1 - 2.5 * px + y * px, px, px); } });
  }
  g.restore();
  // a rim, so a dark ball still shows on a dark card
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = Math.max(1, r * 0.05);
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  // the rider, as the renderers place it on a ball of radius r: a body 0.22 r over its top, a head 0.78 r
  const hr = r * 0.3, hx = cx, hy = cy - r - r * 0.78;
  g.fillStyle = css(L.a, 0.8); g.beginPath(); g.arc(cx, cy - r - r * 0.22, r * 0.34, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = L.style === STYLE.PUMPKIN ? css(L.hatColor) : css([1, 0.8, 0.66]);
  g.beginPath(); g.arc(hx, hy, hr, 0, Math.PI * 2); g.fill();
  g.fillStyle = css(L.hatColor);
  if (L.style === STYLE.CAP) g.fillRect(hx - hr, hy - hr, 2 * hr, hr * 0.7);
  else if (L.style === STYLE.BEANIE) g.fillRect(hx - hr, hy - hr * 1.1, 2 * hr, hr);
  else if (L.style === STYLE.BAND) g.fillRect(hx - hr, hy - hr * 0.6, 2 * hr, hr * 0.35);
  else if (L.style === STYLE.HELMET) { g.fillRect(hx - hr, hy - hr * 1.05, 2 * hr, hr * 1.1); g.fillRect(hx - hr, hy, hr * 0.35, hr * 0.8); }
  else if (L.style === STYLE.CROWN) for (let k = 0; k < 3; k++) g.fillRect(hx - hr + k * hr * 0.75, hy - hr * 1.5, hr * 0.5, hr * 0.9);
  else if (L.style === STYLE.PUMPKIN) { g.fillStyle = '#3c8a2c'; g.fillRect(hx - hr * 0.12, hy - hr * 1.35, hr * 0.24, hr * 0.45); }
  g.fillStyle = L.style === STYLE.PUMPKIN ? '#ffd860' : '#111';
  g.fillRect(hx - hr * 0.45, hy - hr * 0.1, hr * 0.22, hr * 0.28);
  g.fillRect(hx + hr * 0.23, hy - hr * 0.1, hr * 0.22, hr * 0.28);
}
