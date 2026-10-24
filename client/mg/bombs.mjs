// BOMB RAIN: a stand-in until the minigame lands. A plain disc at PLAT_Y,
// its radius in PG_SIZE, drawn as one cylinder; the brain keeps off its edge.
import * as L from '../../src/layout.mjs';
import { PLAT_Y } from '../../src/party-view.mjs';
import { LOOK } from '../party-render.mjs';

const disc = (view) => { const g = view.party(); return { cx: g.cx, r: g.size }; };

export default {
  id: L.MG_BOMBS, key: 'bombs', name: 'BOMB RAIN',
  hint: 'STAY ON THE DISC  LAST ONE ON WINS',
  env: 'sunset',
  draw(view, ctx, out) {
    const { cx, r } = disc(view);
    out.scene.cyl(cx, PLAT_Y - 1, cx, r, 1, 0.72, 0.74, 0.78, LOOK.PLASTIC);
  },
  frame(view) {
    const { cx, r } = disc(view);
    return { centre: [cx, PLAT_Y, cx], radius: r, shape: 'disc' };
  },
  fx() {},
  hud() {},
  brain: {
    // past the rim is deadly, the last 3 m before it a warning
    danger(view, x, z) {
      const { cx, r } = disc(view);
      const e = r - Math.hypot(x - cx, z - cx);
      return e <= 0 ? 1 : e < 3 ? (3 - e) / 3 * 0.6 : 0;
    },
    goal(view) { const { cx } = disc(view); return [cx, cx]; },
    hop() { return false; },
  },
};
