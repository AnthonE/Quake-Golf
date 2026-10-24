// Every minigame's client module, by MG_* id: how its stage draws, where the
// camera looks, its FX and HUD lines, and the AI ball's sense of it
// (client/party-bot.mjs). The frontend takes MG[view.party().game].
import thinice from './thinice.mjs';
import color from './color.mjs';
import sweep from './sweep.mjs';
import light from './light.mjs';
import bombs from './bombs.mjs';
import wall from './wall.mjs';
import pads from './pads.mjs';
import hill from './hill.mjs';
import potato from './potato.mjs';
import coins from './coins.mjs';
import paint from './paint.mjs';
import race from './race.mjs';
import chute from './chute.mjs';
import tag from './tag.mjs';

export const MG = [thinice, color, sweep, light, bombs, wall, pads, hill, potato, coins, paint, race, chute, tag];
