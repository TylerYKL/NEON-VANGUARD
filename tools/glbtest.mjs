/* ============================================================
   GLBTEST — verify the Model Viewer's load pipeline headlessly.

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

console.log('\n' + (fail ? 'FAILURES: ' + fail : 'ERRORS none') + '  (' + pass + ' passed, ' + fail + ' failed)');
process.exit(fail ? 1 : 0);
