// CANNONADE, as drawn and as the AI ball sees it: the platform, a disc of rubber.
// (node tools/new-mg.mjs wrote this; the contract every hook here keeps is at
// the top of client/party-game.mjs.)
import * as L from '../../src/layout.mjs';
import * as MC from '../../src/mg/cannon.mjs'; // CN_*: the minigame's own constants
import { PLAT_Y } from '../../src/party-view.mjs';
import { LOOK } from '../party-render.mjs';

const HH = 0.5; // the platform's half height, m
const radius = (view) => view.dv.getFloat32(L.PG_H + MC.CN_RAD, true);

export default {
  id: L.MG_CANNON, key: 'cannon', name: 'CANNONADE',
  hint: 'BUMP THE OTHERS OFF  LAST ONE ON WINS',
  env: 'day',

  draw(view, ctx, out) {
    const rad = radius(view);
    if (!(rad > 0)) return;
    const cx = view.party().cx;
    out.scene.cyl(cx, PLAT_Y - HH, cx, rad, HH, 0.86, 0.72, 0.5, LOOK.RUBBER);
  },

  frame(view) {
    const cx = view.party().cx;
    return { centre: [cx, PLAT_Y, cx], radius: radius(view) || view.party().size, shape: 'disc' };
  },

  fx() {},

  hud() {},

  brain: {
    // off the platform is a fall; near its rim, a risk
    danger(view, x, z) {
      const cx = view.dv.getFloat32(L.PG_CX + view.bank, true);
      const r = radius(view), d = Math.hypot(x - cx, z - cx);
      return d > r - 0.5 ? 1 : d > r - 3 ? 0.3 : 0;
    },
    // the middle, where a bump has the furthest to push you
    goal(view) {
      const cx = view.dv.getFloat32(L.PG_CX + view.bank, true);
      return [cx, cx];
    },
    hop() { return false; },
  },
};
