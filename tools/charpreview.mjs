/* ============================================================
   CHARPREVIEW — dump the posed, real rig as world-space triangles
   so tools/render.py can rasterise it to a PNG without a browser.

   This is the feedback loop for art direction: the sandbox has no
   WebGL, so we extract the exact geometry three.js would draw and
   flat-shade it in Python. It runs the REAL buildHumanoid / weapon
   builders / animateRig from src/rig.js with the REAL per-hero cfg
   from HERO_DEFS — so what you see in the PNG is what ships.

   Usage:  node tools/charpreview.mjs [aegis|lyra|nyx|all]
   Writes: .tmpbuild/char-<id>.json
   ============================================================ */

import * as THREE from 'three';
import fs from 'fs';
import path from 'path';
import {
  buildHumanoid, animateRig, buildIonGauntlets, buildRiotShield,
  buildMedGloves, buildRailPistol, buildDrone,
} from '../src/rig.js';
import { HERO_DEFS } from '../src/heroes.js';

const OUT = path.resolve('.tmpbuild');
fs.mkdirSync(OUT, { recursive: true });

const which = process.argv[2] || 'all';
const defs = which === 'all' ? HERO_DEFS : HERO_DEFS.filter((d) => d.id === which);

for (const d of defs) {
  const rig = buildHumanoid({
    accent: d.color, visor: d.color2, bulk: d.bulk, scale: d.scale,
    pauldrons: d.pauldrons, hood: d.hood, crest: d.crest, plate: d.plate,
  });
  const root = rig.root;

  // attach the real loadout
  if (d.id === 'aegis') { buildIonGauntlets(rig, d.color); buildRiotShield(rig, d.color2); }
  else if (d.id === 'lyra') { buildMedGloves(rig, d.color); root.add(buildDrone(rig, d.color2).group); }
  else { buildRailPistol(rig, d.color); root.add(buildDrone(rig, d.color2).group); }

  // settle into a natural stance using the real animator
  for (let i = 0; i < 45; i++) {
    animateRig(rig, 1 / 30, {
      speed: 0, time: i / 30, attack: 0, cast: 0, dead: false, hurt: 0,
      style: d.style, block: d.id === 'aegis',
    });
  }
  root.updateMatrixWorld(true);

  const tris = [];
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
  const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _n = new THREE.Vector3();

  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const m = o.material;
    const isGlow = m.isMeshBasicMaterial;             // addMat = additive glow
    const base = (m.color ? [m.color.r, m.color.g, m.color.b] : [1, 1, 1]);
    const emis = (m.emissive ? [m.emissive.r, m.emissive.g, m.emissive.b] : [0, 0, 0]);
    const ei = (m.emissiveIntensity || 0);
    const opacity = m.opacity ?? 1;

    const g = o.geometry;
    const pos = g.attributes.position;
    const idx = g.index;
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
      _a.fromBufferAttribute(pos, ia).applyMatrix4(o.matrixWorld);
      _b.fromBufferAttribute(pos, ib).applyMatrix4(o.matrixWorld);
      _c.fromBufferAttribute(pos, ic).applyMatrix4(o.matrixWorld);
      _e1.subVectors(_b, _a); _e2.subVectors(_c, _a); _n.crossVectors(_e1, _e2).normalize();
      tris.push({
        v: [+_a.x.toFixed(4), +_a.y.toFixed(4), +_a.z.toFixed(4),
            +_b.x.toFixed(4), +_b.y.toFixed(4), +_b.z.toFixed(4),
            +_c.x.toFixed(4), +_c.y.toFixed(4), +_c.z.toFixed(4)],
        n: [+_n.x.toFixed(3), +_n.y.toFixed(3), +_n.z.toFixed(3)],
        base: base.map((x) => +x.toFixed(3)),
        emis: emis.map((x) => +x.toFixed(3)),
        ei: +ei.toFixed(2),
        glow: isGlow ? 1 : 0,
        op: +opacity.toFixed(2),
      });
    }
  });

  const file = path.join(OUT, 'char-' + d.id + '.json');
  fs.writeFileSync(file, JSON.stringify({ id: d.id, scale: d.scale, tris }));
  console.log(d.id.padEnd(6), tris.length, 'triangles ->', file);
}
console.log('done');
