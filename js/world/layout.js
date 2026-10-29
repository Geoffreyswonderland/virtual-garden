/* Single source of truth for where things are (metres; y is up, the
   player starts at +z looking towards -z). World modules build from it,
   the controller uses it for collisions, the story uses it for targets. */

export const EYE = 1.6;

export const L = {
  start: [0, 14.2],
  lane: { x0: -4, x1: 4, z0: 10.35, z1: 16 },          // outside the gate
  fence: { x0: -10, x1: 10, z0: -12, z1: 10 },          // the homestead
  gate: { x: 0, z: 10, half: 0.75 },
  hut: { x: 0, z: -8.7, w: 6.6, d: 3.6, door: [0, -6.25] },
  yard: { x0: -3.4, x1: 3.4, z0: -6.4, z1: -3.6 },
  veg: { x: -4.7, z: 3.6, w: 3.2, d: 1.9 },             // vegetable bed with weeds
  beans: { x: 5.0, z: 0.6, w: 4.0, d: 3.0 },            // bean field
  pouch: [2.55, 2.35],
  bucket: [2.55, -1.05],
  hoe: [7.45, 2.55],
  pond: { x: -6.5, z: -3.4, r: 1.8 },
  eastFence: { x: 9.2, z0: -7, z1: -1.2 },              // 東籬 with chrysanthemums
  woodpile: [3.9, -7.3],
  jar: [-3.75, -6.9],
  willows: [[-4.6, 7.4], [5.0, 8.3], [-8.0, -1.0], [6.6, -10.0], [-6.6, -11.3]],
  elms: [[2.4, -11.4], [-1.2, -12.9], [8.3, 6.5], [-8.6, 7.2]],
  peaches: [[-2.7, -4.9, 'peach'], [2.8, -4.7, 'plum']],
  laneTrees: [[-5.6, 13.5], [6.2, 15.0]],
};

// walking network (also painted onto the ground as dirt paths)
export const PATHS = [
  [[0, 17], [0, 10], [0.45, 7], [0.2, 4], [-0.4, 1], [-0.5, -2], [0, -4.4], [0, -6.1]],
  [[0.2, 4], [-1.5, 2.3], [-3.4, 1.55], [-4.9, 1.5]],
  [[-0.4, 1], [1.4, 1.0], [2.3, 0.9]],
  [[2.3, 0.9], [2.35, 2.75], [5.0, 2.75], [7.1, 2.7]],
  [[2.3, 0.9], [2.2, -1.05]],
];

// the narrow way home at dusk, through tall grass past the east fence (道狹草木長)
export const NARROW = [[7.1, 2.7], [7.7, 0.6], [7.85, -1.6], [7.35, -4.0], [5.6, -5.35], [3.6, -5.85], [1.6, -5.95], [0.7, -5.9]];

// where the player should stand for each target (used by "帶我過去")
export const APPROACH = {
  gate: [0, 11.3],
  veg: [-4.3, 1.5],
  pouch: [2.35, 2.75],
  beans: [2.3, 0.9],
  bucket: [2.2, -1.05],
  hoe: [7.1, 2.7],
  door: [0, -6.1],
  yard: [0, -4.4],
  narrow: [7.1, 2.7],
};

export const TREE_RADIUS = 0.45;
