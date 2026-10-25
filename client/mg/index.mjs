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
import snowball from './snowball.mjs';
import tilt from './tilt.mjs';
import lava from './lava.mjs';
import gale from './gale.mjs';
import drums from './drums.mjs';
import hoops from './hoops.mjs';
import pinball from './pinball.mjs';
import trails from './trails.mjs';
import maze from './maze.mjs';
import bullseye from './bullseye.mjs';
import cannon from './cannon.mjs';
import rope from './rope.mjs';

export const MG = [thinice, color, sweep, light, bombs, wall, pads, hill, potato, coins, paint, race, chute, tag, snowball, tilt, lava, gale, drums, hoops, pinball, trails, maze, bullseye, cannon, rope];
