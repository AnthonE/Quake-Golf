// Red against blue as the clients show it: the sides' names, their text
// colours (the HUD's palette has no blue, so blue is C.CYAN, as Party's
// precedent) and their body colours, by team (0 red, 1 blue).
import * as L from '../../src/layout.mjs';
import { C } from '../font.mjs';

export const SIDE = ['RED', 'BLUE'];
export const SIDE_C = [C.RED, C.CYAN];
export const SIDE_RGB = [[0.95, 0.22, 0.16], [0.22, 0.45, 1]];
// slot p's side from the confirmed record (P_FL's PF_BLUE), for a team mode only: red is the bit clear
export const sideOf = (view, p) => (view.u8[L.PLAYERS + p * L.PSIZE + L.P_FL] & L.PF_BLUE ? 1 : 0);
