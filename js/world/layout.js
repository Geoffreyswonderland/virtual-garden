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
  // the bean field is not in the garden: it lies outside the back gate, at the foot of the south mountain
  // (種豆南山下), reached by a footpath through grass taller than a person (道狹草木長)
  beans: { x: 5.8, z: -20.6, w: 5.2, d: 3.6 },
  backGate: { x: 5.8, z: -12, half: 0.62 },
  pouch: [3.0, -18.25],                                  // seed pouch on a stump at the field's edge
  hoeSpot: [7.45, -18.35],                               // where the hoe is stood while weeding by hand
  bucket: [-3.2, -6.0],                                   // by the water jar, just scenery now
  hoe: [3.45, -6.62],                                    // in the morning it leans against the woodpile
  pond: { x: -6.5, z: -3.4, r: 1.8 },
  eastFence: { x: 9.2, z0: -7, z1: -1.2 },              // 東籬 with chrysanthemums
  woodpile: [3.9, -7.3],
  jar: [-3.75, -6.9],
  willows: [[-4.6, 7.4], [5.0, 8.3], [-8.0, -1.0], [8.4, -10.3], [-6.6, -11.3]],
  elms: [[2.4, -11.4], [-1.2, -12.9], [8.3, 6.5], [-8.6, 7.2]],
  peaches: [[-2.7, -4.9, 'peach'], [2.8, -4.7, 'plum']],
  laneTrees: [[-5.6, 13.5], [6.2, 15.0]],
};

// walking network (also painted onto the ground as dirt paths)
export const PATHS = [
  [[0, 17], [0, 10], [0.45, 7], [0.2, 4], [-0.4, 1], [-0.5, -2], [0, -4.4], [0, -6.1]],
  [[0.2, 4], [-1.5, 2.3], [-3.4, 1.55], [-4.9, 1.5]],
  // from the yard, past the woodpile and round the east end of the hut to the back gate
  [[0, -4.4], [2.4, -5.3], [4.9, -5.55], [5.7, -8.5], [5.8, -12]],
];

// the footpath from the back gate out to the bean field: the only way there and back. Nobody keeps
// it cut, so the grass on both sides has grown taller than a person (道狹草木長).
export const NARROW = [[5.8, -12], [5.95, -15.4], [6.35, -18.75]];
export const NARROW_Z0 = -12.35;   // tall grass only between these two z values
export const NARROW_Z1 = -18.6;

// where the player should stand for each target (used by "帶我過去")
export const APPROACH = {
  gate: [0, 11.3],
  veg: [-4.3, 1.5],
  hoe: [3.6, -5.9],
  backGate: [5.8, -11.4],
  narrow: [5.8, -12],
  beans: [6.3, -18.9],
  pouch: [3.4, -17.7],
  door: [0, -6.1],
  yard: [0, -4.4],
};

export const TREE_RADIUS = 0.45;
