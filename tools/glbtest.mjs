/* ============================================================
   GLBTEST — verify the shared Character Bay / Hero Studio GLB pipeline headlessly.

   Round-trips the real code from src/gltfutil.js (the exact functions the
   viewer calls on drop):  build a known scene -> GLTFExporter (binary GLB)
   -> parseGLB -> normalizeToStage -> gatherStats, then asserts the numbers.

   No browser, no WebGL. Runs on plain Node with the repo's three.

   Usage:  node tools/glbtest.mjs
   ============================================================ */

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { parseGLB, gatherStats, normalizeToStage } from '../src/gltfutil.js';

/* GLTFExporter reads its binary chunk through FileReader, which Node lacks.
   Minimal polyfill backed by Blob.arrayBuffer(). */
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((ab) => {
        this.result = ab;
        if (this.onload) this.onload();
        if (this.onloadend) this.onloadend();
      });
    }
  };
}

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

/* ---- a known scene: two boxes, one shared material, height 3 ---- */
const mat = new THREE.MeshStandardMaterial({ color: 0x888888 });
const root = new THREE.Group();
const a = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), mat); a.position.y = 1;   // y 0..2
const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat); b.position.y = 2.5; // y 2..3
root.add(a, b);

const exporter = new GLTFExporter();
const glb = await new Promise((resolve, reject) => {
  exporter.parse(root, resolve, reject, { binary: true });
});
check('exporter produced a binary GLB', glb instanceof ArrayBuffer && glb.byteLength > 100,
  'bytes ' + (glb.byteLength || 0));

/* ---- run it through the viewer's pipeline ---- */
const gltf = await parseGLB(glb);
check('parseGLB resolved a scene', !!(gltf.scene || gltf.scenes[0]));

const obj = gltf.scene || gltf.scenes[0];
const stats = gatherStats(obj);
check('meshes == 2', stats.meshes === 2, 'got ' + stats.meshes);
check('triangles == 24 (two boxes)', stats.tris === 24, 'got ' + stats.tris);
check('materials == 1 (shared)', stats.materials === 1, 'got ' + stats.materials);
check('textures == 0', stats.textures === 0, 'got ' + stats.textures);

const norm = normalizeToStage(obj, 2.4);
obj.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(obj);
const size = new THREE.Vector3(); box.getSize(size);
const c = new THREE.Vector3(); box.getCenter(c);
check('normalised height == 2.4', Math.abs(size.y - 2.4) < 1e-3, 'got ' + size.y.toFixed(3));
check('feet rest on y = 0', Math.abs(box.min.y) < 1e-3, 'got ' + box.min.y.toFixed(3));
check('centred on X and Z', Math.abs(c.x) < 1e-3 && Math.abs(c.z) < 1e-3,
  'x ' + c.x.toFixed(3) + ' z ' + c.z.toFixed(3));
check('uniform scale recorded (0.8)', Math.abs(norm.scale - 0.8) < 1e-3, 'got ' + norm.scale);
check('lift reported + stamped for consumers (survives a clone)',
  Math.abs(norm.lift - obj.userData.stage.lift) < 1e-6, 'lift ' + norm.lift);
check('stamp is plain numbers, so clone(true) can copy it',
  obj.clone(true).userData.stage.lift === obj.userData.stage.lift);

/* ---- MOTION-AUDIT §4 phase A: skinned clones, and why ----
   The repo's own uploaded heroes are static meshes (0 bones), so the skeleton
   semantics the game now depends on had nothing to be tested against. tools/lib/
   rigged.mjs builds a real 3-bone rig with two clips in memory and round-trips it
   through the same exporter/loader pair the viewer uses. */
const { clone: cloneRig } = await import('three/addons/utils/SkeletonUtils.js');
const { riggedGLB, FIXTURE_CLIPS } = await import('./lib/rigged.mjs');

const rigGltf = await parseGLB(await riggedGLB());
const rigScene = rigGltf.scene;
normalizeToStage(rigScene, 2.4);          // the stamp the game's loaders would have applied
const rigStats = gatherStats(rigScene);
const tplMesh = rigScene.getObjectByName('body');

check('the rigged fixture survives a GLB round trip with a real skeleton',
  rigStats.bones === 3 && rigStats.skinned === 1, 'bones ' + rigStats.bones + ' skinned ' + rigStats.skinned);
check('both clips come back with their names',
  JSON.stringify((rigGltf.animations || []).map((c) => c.name)) === JSON.stringify(FIXTURE_CLIPS),
  (rigGltf.animations || []).map((c) => c.name).join(','));
check('every track resolves to a node of the parsed scene',
  (rigGltf.animations || []).every((c) => c.tracks.every((t) => !!THREE.PropertyBinding.findNode(rigScene, t.name.split('.')[0]))),
  (rigGltf.animations || [])[1].tracks.map((t) => t.name).join(','));

{
  const mixer = new THREE.AnimationMixer(rigScene);
  mixer.clipAction(rigGltf.animations[1]).play();       // 'Walk'
  mixer.update(0.4);
  const hips = rigScene.getObjectByName('hips'), head = rigScene.getObjectByName('head');
  check('a mixer on the parsed scene moves the bones',
    Math.abs(hips.rotation.x + 0.2) < 0.05 && Math.abs(head.position.y - 0.47) < 0.02,
    'hips.x ' + hips.rotation.x.toFixed(3) + ' head.y ' + head.position.y.toFixed(3));
}

/* the hazard phase A removes: a plain clone copies bones but keeps the template's skeleton */
{
  const plain = rigScene.clone(true);
  const pm = plain.getObjectByName('body');
  const ownHips = plain.getObjectByName('hips');
  check('plain clone(true) keeps the TEMPLATE skeleton while copying the bones (the bug)',
    pm.skeleton === tplMesh.skeleton && pm.skeleton.bones.indexOf(ownHips) === -1,
    'skeleton shared ' + (pm.skeleton === tplMesh.skeleton) + ', own hips bound ' + (pm.skeleton.bones.indexOf(ownHips) !== -1));
  check('…so the clone\'s own bones are inert decoration',
    ownHips !== tplMesh.skeleton.bones[0] && ownHips.parent !== tplMesh.skeleton.bones[0].parent,
    'cloned hips is not the bound one');
}

{
  const A = cloneRig(rigScene), B = cloneRig(rigScene);
  const ma = A.getObjectByName('body'), mb = B.getObjectByName('body');
  check('cloneRig gives each clone its own skeleton', ma.skeleton !== mb.skeleton, 'shared skeleton');
  check('…bound to that clone\'s own bones',
    ma.skeleton.bones[0] === A.getObjectByName('hips') && mb.skeleton.bones[0] === B.getObjectByName('hips'),
    'bones not rebound to the clone');
  const mA = new THREE.AnimationMixer(A);
  const restB = B.getObjectByName('hips').getWorldPosition(new THREE.Vector3()).clone();
  mA.clipAction(rigGltf.animations[1]).play(); mA.update(0.4);
  A.updateMatrixWorld(true); B.updateMatrixWorld(true);
  check('animating one clone leaves the other at rest (four heroes, four skeletons)',
    Math.abs(A.getObjectByName('hips').rotation.x) > 0.05 &&
    B.getObjectByName('hips').getWorldPosition(new THREE.Vector3()).distanceTo(restB) < 1e-6,
    'A ' + A.getObjectByName('hips').rotation.x.toFixed(3) + ' vs B moved ' +
    B.getObjectByName('hips').getWorldPosition(new THREE.Vector3()).distanceTo(restB).toFixed(6));
  check('materials and geometry still stay shared by pointer (the caches depend on it)',
    ma.material === mb.material && ma.geometry === mb.geometry,
    'material ' + (ma.material === mb.material) + ' geometry ' + (ma.geometry === mb.geometry));
  /* NOT a freebie: SkeletonUtils.clone builds its own objects and skips `userData`, so a
     stamp written by normalizeToStage does NOT ride along on a root it clones. heroes.js
     copies it forward; anything new that clones a fitted root has to do the same. */
  check('a skeleton clone does NOT carry userData — the stamp has to be copied by hand',
    ma.userData.stage === undefined && rigScene.userData.stage !== undefined,
    'clone got ' + JSON.stringify(ma.userData.stage) + ' while the template holds ' + JSON.stringify(rigScene.userData.stage));
  check('…and the clone still starts at the template’s own position (the lift is on the root)',
    Math.abs(A.position.y - rigScene.position.y) < 1e-9 && Math.abs(B.position.y - rigScene.position.y) < 1e-9,
    A.position.y + ' / ' + B.position.y + ' / ' + rigScene.position.y);
}

{
  // static meshes — what every FX file is today — must clone exactly as before
  const flat = new THREE.Group();
  const m1 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat); m1.name = 'box';
  flat.add(m1);
  const c = cloneRig(flat);
  check('a static (unskinned) template clones identically — the FX path is unchanged',
    c.getObjectByName('box') !== m1 && c.getObjectByName('box').material === m1.material &&
    c.getObjectByName('box').geometry === m1.geometry, 'clone shares material+geometry, not the object');
}

console.log('\n' + (fail ? 'FAILURES: ' + fail : 'ERRORS none') + '  (' + pass + ' passed, ' + fail + ' failed)');
process.exit(fail ? 1 : 0);
