// PINBALL (MG_PINBALL, prefix pn): a round platform over the sea,
// sized for the crowd; bump the others off, and the last ball on it wins.
// (node tools/new-mg.mjs wrote this as a start: say here what your minigame is.)
// Literal numbers only: the sim reads them through layout.mjs's MG_CONSTS,
// the client imports this file itself.
export const PN_R0 = 12; // the platform: PN_R0 m plus PN_RK times the root of the balls in, at most PN_RMAX
export const PN_RK = 4.5;
export const PN_RMAX = 64;
export const PN_LEN = 11250; // 90 s
// Its header, byte offsets in PG_H (112 B, in the prediction's copy).
export const PN_RAD = 0; // f32 the platform's radius
// Its FX kinds are FX_MG + 4 * MG_PINBALL + k, k 0 to 3: 112 to 115.
