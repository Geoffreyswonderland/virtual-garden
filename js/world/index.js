import * as THREE from 'three';
import { createEnv, pickTier } from './env.js?v=18';
import { buildTerrain } from './terrain.js?v=18';
import { buildGrass } from './grass.js?v=21';
import { buildPlants, updatePlants, plantColliders, FOLIAGE } from './plants.js?v=18';
import { buildStructures, boxColliders, circleColliders } from './build.js?v=22';
import { buildAtmos } from './atmos.js?v=18';

export function createWorld(canvas) {
  const tier = pickTier();
  const env = createEnv(canvas, tier);
  const { scene, camera, time } = env;
  buildTerrain(scene);
  buildGrass(scene, time, env.tier.grass);
  buildPlants(scene, time);
  const parts = buildStructures(scene);
  const atmos = buildAtmos(scene, env);

  // night-time touches that depend on the sky
  env.onEnv(p => {
    FOLIAGE.night.value = p.night;
    const glow = Math.max(0, p.night - 0.05);
    parts.winMat.emissiveIntensity = glow * 0.75;
    parts.lamp.intensity = glow * 4.5;
  });

  const sunView = new THREE.Vector3();
  function update(dt, t) {
    // the sun direction in view space, for backlit leaves
    sunView.set(...env.env.sunDir).normalize().transformDirection(camera.matrixWorldInverse);
    FOLIAGE.sunView.value.copy(sunView);
    if (parts.water.material.normalMap) parts.water.material.normalMap.offset.set(t * 0.01, t * 0.007);
    updatePlants(dt, t);
    atmos.update(dt, t);
    env.update(dt, t);
  }

  const colliders = {
    circles: [...plantColliders, ...circleColliders],
    boxes: boxColliders,
  };
  return { env, scene, camera, tier, parts, dewMat: atmos.dewMat, colliders, update, resize: env.resize };
}
