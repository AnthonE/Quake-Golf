// TERRITORIES (M_TERRITORY, prefix tr): every hill point of the map
// (MAP_HILLS) is a territory, all of them up at once, a circle of TR_R. A
// side with more fighters on one than the other pushes its capture toward
// itself, a tick a tick, TR_CAP to take it (as many each: it holds still);
// one taken stays its side's until the other side takes it back through
// neutral. Every TR_POINT a side scores a point for each territory it holds.
// TR_TARGET points win; the most at the clock wins.
export const TR_TARGET = 200;
export const TR_CAP = 625; // ticks of more of you on it to take a neutral territory: 5 s
export const TR_POINT = 250; // ticks between points: 2 s
export const TR_R = '5'; // a territory's radius, m (and TR_H up or down of its point)
export const TR_H = '2';
// Its news, FX_MODE with these as size (MX_AM + 8 * 5 ..).
export const TR_MX_TAKE = 56; // a side took a territory: owner 255, shot 1 red / 2 blue, at its centre
export const TR_MX_LOSE = 57; // a side's territory went neutral: owner 255, shot the side that lost it, 1 / 2
