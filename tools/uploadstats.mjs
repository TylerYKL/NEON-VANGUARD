/* ============================================================
   UPLOADSTATS — print budget stats for every GLB in models/uploads/
   using the exact pipeline the game/viewer uses (parseGLB ->
   normalizeToStage -> gatherStats). No browser, no WebGL.

   Usage:  node tools/uploadstats.mjs
   ============================================================ */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { parseGLB, gatherStats, normalizeToStage } from '../src/gltfutil.js';

/* Minimal browser shims so GLTFLoader can decode textured GLBs in Node.
   Textures resolve to 4x4 dummies — fine for stats, never rendered here. */
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
if (typeof globalThis.Image === 'undefined') {
  globalThis.Image = class {
    constructor() { this.width = 4; this.height = 4; }
    set src(v) { this._src = v; setTimeout(() => { if (this.onload) this.onload(); }, 0); }
    get src() { return this._src; }
    decode() { return Promise.resolve(); }
  };
}
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement: () => new globalThis.Image(),
    createElementNS: () => new globalThis.Image(),
  };
}

const dir = join(import.meta.dirname, '..', 'models', 'uploads');
const files = readdirSync(dir).filter((f) => /\.glb$/i.test(f)).sort();
if (!files.length) { console.log('no .glb files in models/uploads/'); process.exit(0); }

for (const f of files) {
  const buf = readFileSync(join(dir, f));
  try {
    const gltf = await parseGLB(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const obj = gltf.scene || gltf.scenes[0];
    const norm = normalizeToStage(obj, 2.4);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3(); box.getSize(size);
    const s = gatherStats(obj);
    console.log(`\n== ${f} ==  (${(buf.byteLength / 1048576).toFixed(1)} MB)`);
    console.log(`   meshes ${s.meshes}  tris ${s.tris.toLocaleString()}  mats ${s.materials}  tex ${s.textures}`);
    console.log(`   bones ${s.bones}  skinned ${s.skinned}  clips ${(gltf.animations || []).length}`);
    console.log(`   normalized: height ${size.y.toFixed(2)} scale ${norm.scale.toFixed(3)} feetY ${box.min.y.toFixed(3)}`);
  } catch (e) {
    console.log(`\n== ${f} ==  PARSE FAIL: ${e.message}`);
  }
}
