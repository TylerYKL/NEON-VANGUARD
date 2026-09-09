import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* ============================================================
   GLTF UTIL — DOM-free helpers shared by Character Bay, Hero
   Studio and the headless test (tools/glbtest.mjs). Keeping parse /
   stats / normalisation here means the load pipeline can be exercised
   in Node via a GLTFExporter -> GLTFLoader round-trip, no browser.
   ============================================================ */

/** Parse an in-memory GLB / glTF. Resolves to the gltf object. */
export function parseGLB(buffer) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', resolve, reject);
  });
}

/** Count what a loaded model will actually cost to draw. */
export function gatherStats(root) {
  const mats = new Set(), texs = new Set(), geos = new Set();
  let meshes = 0, tris = 0, bones = 0, skinned = 0;
  root.traverse((o) => {
    if (o.isBone) bones++;
    if (o.isSkinnedMesh) skinned++;
    if (o.isMesh && o.geometry) {
      meshes++;
      const g = o.geometry;
      if (!geos.has(g.uuid)) {
        geos.add(g.uuid);
        const pos = g.attributes.position;
        if (pos) tris += (g.index ? g.index.count : pos.count) / 3;
      }
      const list = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of list) {
        if (!m || mats.has(m.uuid)) continue;
        mats.add(m.uuid);
        for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) {
          if (m[k] && !texs.has(m[k].uuid)) texs.add(m[k].uuid);
        }
      }
    }
  });
  return { meshes, tris: Math.round(tris), materials: mats.size, textures: texs.size, bones, skinned };
}

/** Fit a loaded model to the stage: uniform scale to a target height,
    centred on X/Z, feet resting on y = 0. Returns what it did.

    The correction lives on `root.position`, so **anyone who overwrites that
    position loses the lift and the model sinks through the floor** (which is
    what `Hero.animateGLB` used to do — half a hero buried). The numbers are
    therefore also stamped on `root.userData.stage` — plain numbers, so they
    survive `clone(true)` — and consumers must treat them as the base their own
    offsets are added to, not as something to replace. */
export function normalizeToStage(root, targetHeight = 2.4) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3(); box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = targetHeight / maxDim;
  root.scale.multiplyScalar(scale);
  root.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(root);
  const c = new THREE.Vector3(); b2.getCenter(c);
  const lift = -b2.min.y;                      // relative: a root may already be placed
  root.position.x -= c.x;
  root.position.z -= c.z;
  root.position.y += lift;
  root.updateMatrixWorld(true);
  root.userData.stage = {
    lift: +lift.toFixed(4), cx: +(-c.x).toFixed(4), cz: +(-c.z).toFixed(4),
    scale: +scale.toFixed(4), height: +(size.y * scale).toFixed(3),
  };
  return {
    before: [+size.x.toFixed(2), +size.y.toFixed(2), +size.z.toFixed(2)],
    scale: +scale.toFixed(3), height: +(size.y * scale).toFixed(2), lift: +lift.toFixed(3),
  };
}
