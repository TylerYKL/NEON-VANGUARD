/* ============================================================
   A RIGGED, ANIMATED HERO — in memory, for the test suites.

   Nothing in models/uploads/ has a skeleton (`animcheck`'s census: every shipped file is
   `bones 0 · clips 0`), so the skinned-clone and clip-loading paths had nothing real to be
   tested against. Building one here, rather than committing a binary, keeps the repo
   text-only and forces the assumptions to be written down:

     · a 3-bone chain (hips → spine → head) under one root, with a real Skeleton
     · one SkinnedMesh weighted across those bones
     · two clips named the way a hero layer would look them up: `Aegis Idle`, `Walk`
     · tracks addressed by bone NAME, which is what survives a glTF round trip

   `riggedGLB()` returns GLB bytes; the caller re-parses them through the game's own
   `parseGLB`, so what a test asserts is what the loader actually produces.
   ============================================================ */
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

/* GLTFExporter reads its own JSON through FileReader, and Node has no global for it.
   These two are all the exporter needs while there are no textures to encode. */
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    /* The exporter assigns `onloadend` AFTER calling readAs…, so the result has to be
       delivered on a later task — resolving in a microtask would fire before the handler
       exists and the parse promise would hang forever (it did). */
    _done(kind) {
      setTimeout(() => {
        const fn = this['on' + kind];
        if (fn) fn({ target: this });
        if (this.onloadend && kind !== 'loadend') this.onloadend({ target: this });
      }, 0);
    }
    readAsArrayBuffer(blob) { blob.arrayBuffer().then((r) => { this.result = r; this._done('load'); }); }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((r) => {
        this.result = 'data:application/octet-stream;base64,' + Buffer.from(r).toString('base64');
        this._done('load');
      });
    }
  };
}

export const FIXTURE_CLIPS = ['Aegis Idle', 'Walk', 'Aegis Attack', 'Death01'];

/** one coherent rig + its clips, built together — a clip's tracks must address THESE bones */
export function buildRigged() {
  const root = new THREE.Group();
  root.name = 'RiggedHero';

  const hips = new THREE.Bone();  hips.name = 'hips';  hips.position.set(0, 1.0, 0);
  const spine = new THREE.Bone(); spine.name = 'spine'; spine.position.set(0, 0.45, 0);
  const head = new THREE.Bone();  head.name = 'head';  head.position.set(0, 0.4, 0);
  hips.add(spine); spine.add(head);
  root.add(hips);

  const geo = new THREE.CylinderGeometry(0.22, 0.3, 1.8, 6, 6, true);
  const pos = geo.attributes.position;
  const idx = [], wt = [];
  for (let i = 0; i < pos.count; i++) {
    const y = (pos.getY(i) + 0.9) / 1.8;                 // 0 at the feet, 1 at the top
    const b = y < 0.55 ? 0 : y < 0.82 ? 1 : 2;
    const edge = b === 0 ? 0.55 : 0.82;
    const blend = Math.max(0, 1 - Math.abs(y - edge) * 5);
    idx.push(b, b === 2 ? 2 : b + 1, 0, 0);
    wt.push(1 - blend * 0.5, blend * 0.5, 0, 0);
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wt, 4));

  const mesh = new THREE.SkinnedMesh(geo,
    new THREE.MeshStandardMaterial({ color: 0x33ffcc, flatShading: true, side: THREE.DoubleSide }));
  mesh.name = 'body';
  const bones = [hips, spine, head];
  mesh.bind(new THREE.Skeleton(bones));
  root.add(mesh);

  const q = (rad) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rad);
  const flat = (list) => list.map((v) => v.toArray()).flat();
  const clips = [
    new THREE.AnimationClip('Aegis Idle', 1.2, [
      new THREE.QuaternionKeyframeTrack('spine.quaternion', [0, 0.6, 1.2], flat([q(0.05), q(-0.05), q(0.05)])),
      new THREE.VectorKeyframeTrack('hips.position', [0, 0.6, 1.2], [0, 1.0, 0, 0, 1.07, 0, 0, 1.0, 0]),
    ]),
    new THREE.AnimationClip('Walk', 0.8, [
      new THREE.QuaternionKeyframeTrack('hips.quaternion', [0, 0.2, 0.4, 0.6, 0.8],
        flat([q(0.2), q(0), q(-0.2), q(0), q(0.2)])),
      new THREE.VectorKeyframeTrack('head.position', [0, 0.4, 0.8], [0, 0.4, 0, 0, 0.47, 0, 0, 0.4, 0]),
    ]),
    /* Two more, so a test can tell "the right clip played at the right time" apart from "a
       clip played". Named the awkward way real files name things, so the resolver's alias
       hunt is what gets exercised rather than a perfect string match. */
    new THREE.AnimationClip('Aegis Attack', 0.4, [
      new THREE.QuaternionKeyframeTrack('spine.quaternion', [0, 0.1, 0.4], flat([q(0.05), q(-0.7), q(0.05)])),
    ]),
    new THREE.AnimationClip('Death01', 0.9, [
      new THREE.VectorKeyframeTrack('hips.position', [0, 0.45, 0.9], [0, 1.0, 0, 0, 0.55, -0.2, 0, 0.3, -0.4]),
      new THREE.QuaternionKeyframeTrack('spine.quaternion', [0, 0.9], flat([q(0.05), q(1.1)])),
    ]),
  ];
  return { root, bones, mesh, skeleton: mesh.skeleton, clips };
}

/** GLB bytes for a freshly built rig — the export round trip is part of the test */
export async function riggedGLB() {
  const rig = buildRigged();
  const scene = new THREE.Scene();
  scene.name = 'rigged-fixture';
  scene.add(rig.root);
  return new GLTFExporter().parseAsync(scene, { binary: true, animations: rig.clips });
}
