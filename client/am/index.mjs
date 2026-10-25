// Every team mode's client module, by mode number (AMC[L.M_CTF]): how its
// objective draws, its HUD lines and news, its board columns, and what the AI
// fighter goes for (client/arena-bot.mjs). The frontend (client/arena-game.mjs)
// takes AMC[view.mode().mode]; a mode without one (a Fiesta, Infection, gun
// game, Juggernaut) has none. Each module default-exports:
//
//   mode, key: its M_* and its AM key.
//   carry: 'flag' | 'skull' | 'bomb' | undefined: what a carrier (PF_CARRY) holds, for
//     the carrier's HUD (a flag is drawn in the other side's colour) and the
//     kill feed's KILL_CARRY.
//   hud(view, ctx): its own lines, rows 2 to 4 at the top left (rows 0 and 1
//     there are the frontend's: your side and kills; the clock is row 0's
//     middle, the score bar rows 4 and 5's middle, banners the middle band),
//     each within cols 1 to 26: the shields and health take rows 1 to 3 from
//     col 27 (x 108 of 320), and the score bar's text is centred on row 4
//     (from col 30 at its widest with a target of 100).
//     ctx { put(x, y, s, c), centre(y, s, c), right(y, s, c) (text cells, 80
//     across), rect(x0, y0, x1, y1, r, g, b, a) (320 x 200 units, under the
//     text), rows, C, slot (the fighter shown), me (its fighter(), from the
//     prediction when it's yours, or null), team (its side, 0 or 1; -1 for
//     nobody), now (ms), t (s into play) }.
//   news(f, ctx): a news FX (kind FX_MODE, f.size this mode's MX code, MX_AM +
//     8k .. + 7) as the confirmed world's ring has it: { tick, kind, owner
//     (255 for nobody, where its MX code says so), shot, pos, size }. ctx {
//     slot, me, name(p) ('YOU' or 'P12'), team(p) (slot p's side, 0 / 1;
//     owner 255 is both nobody and slot 255, so a module knows from f.size
//     whether its news has a doer), feed(text, color), banner(text, color,
//     ms), glow({ pos, size, color: [r, g, b, a], kind (3 a blast, 5 a spark,
//     6 a ring), life (ms), grow }), sound, dist (m from the camera), C, now,
//     view }.
//   draw(view, ctx, out): this frame's world objects. ctx { dt (s past the
//     confirmed tick, to now), now (ms), t (s into play), slot (yours, -1 for
//     a spectator), shown (the fighter the camera's in: yours, or the one a
//     spectator watches; -1 for none: draw nothing over its head, and its
//     side is the one the waypoints speak to, as the HUD's), me (fighter()
//     of slot, confirmed), pme (the prediction's, or null), cam [x, y, z],
//     view, pview }.
//     out { solid: [] (sprites, upright, one depth at the middle: { pos (the
//     middle), size (half its width, m), aspect (height / width), color:
//     [r, g, b, a], kind, minpx (px at least) }; kind 7 a flag on its pole
//     waving (size 0.6, aspect 2: 2.4 m tall), 8 a skull, 0 a ball, 4 a
//     weapon), glow: [] (kind 3, 5, 6, as
//     news's), beams: [] ({ a, b, width, color: [r, g, b, a] }), markers: []
//     (HUD waypoints drawn over everything, through walls, with the distance:
//     { pos: [x, y, z], label, color: C.*, kind: 'flag' | 'skull' | 'hill' |
//     undefined (a diamond) }, clamped to the screen's edge when off it), zone:
//     null or one ground disc the renderer paints on the terrain and box tops,
//     { x, z, r, y (only surfaces within h of it; omit for any), h (default 2),
//     color: [r, g, b], pulse (0..1) } }. Objectives' sprites go before the FX
//     (MAX_SPRITE caps them together).
//   cols: the board's columns between the name and KILLS / DEATHS: [{ head,
//     get(o) -> string }], o a fighter().
//   goal(view, me, ctx): the AI fighter's objective, or null to fight and
//     wander as in a Fiesta. ctx { role ('attack' | 'defend': rank % 3 === 2
//     among its side's fighters in slot order defends), rank, view, ally(p, q),
//     slot, t }. Returns { pos: [x, y, z] (feet), r (m across: near enough;
//     arrival also wants feet within 2 m up or down), hurry (0..1: under 0.5 it
//     fights whoever it sees first; from 0.5 it keeps going while it shoots;
//     from 0.9 it doesn't stop to shoot at all), hold (stay within r once
//     there, looking round) }. me is fighter() of the confirmed world. Called
//     every 8 ticks, staggered by slot.
//   state(view) (optional): what the gates (net/run-arena.mjs) should see, JSON.
import * as L from '../../src/layout.mjs';
import slayer from './slayer.mjs';
import ctf from './ctf.mjs';
import oddball from './oddball.mjs';
import hill from './hill.mjs';
import headhunter from './headhunter.mjs';
import territories from './territories.mjs';
import vip from './vip.mjs';
import assault from './assault.mjs';

export const AMC = [];
for (const m of [slayer, ctf, oddball, hill, headhunter, territories, vip, assault]) AMC[m.mode] = m;
// the module whose MX codes a news item's size falls in (MX_AM + 8k for AM[k]), or undefined
export const newsOf = (size) => (size >= L.MX_AM ? AMC[L.AM[(size - L.MX_AM) >> 3]?.mode] : undefined);
export { SIDE, SIDE_C, SIDE_RGB, sideOf } from './sides.mjs';
