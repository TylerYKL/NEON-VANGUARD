/* Three-vfx style profile + vanilla runtime checks. No renderer is needed: the test
   verifies the serialised editor contract and the instanced particle buffers. */
import * as THREE from 'three';
import { clampVFX, DEFAULT_VFX, spawnVFX, vfxEdit, vfxFor, VFX_SHARED } from '../src/vfx.js';

const check = (name, value) => {
  if (!value) throw new Error('FAIL ' + name);
  console.log('  PASS  ' + name);
};

const tuning = { aegis: {} };
const before = vfxEdit(tuning, 'aegis', VFX_SHARED);
check('opening the editor does not enable a game profile', !before.configured && !tuning.aegis.vfx);
const p = clampVFX({ burst: 99999, life: -4, color0: '#12ABEF', easing: 99 });
check('profile clamps particle count', p.burst === 160);
check('profile clamps particle life', p.life === 0.12);
check('profile keeps valid colours', p.color0 === '#12abef');
check('profile clamps enum values', p.easing === 4);

before.setP(Object.assign({}, DEFAULT_VFX, { burst: 4, duration: 0.2, life: 0.12 }));
before.setOn(true);
check('editor setter materialises the shared profile', tuning.aegis.vfx && tuning.aegis.vfx.on);
check('game resolves the enabled shared profile', !!vfxFor(tuning, 'aegis', 1));

const scene = new THREE.Scene();
const owner = { pos: new THREE.Vector3(1, 0, 2) };
const G = { scene };
const inst = spawnVFX(G, Object.assign({}, tuning.aegis.vfx.p, { follow: 1 }), new THREE.Vector3(1, 0.08, 2), 0, owner);
check('runtime creates one instanced mesh', inst.obj && inst.obj.isInstancedMesh);
check('runtime exposes GPU particle lifetime attributes', !!inst.obj.geometry.getAttribute('aLife'));
check('runtime exposes GPU particle velocity attributes', !!inst.obj.geometry.getAttribute('aVelocity'));
check('runtime exposes GPU particle colour attributes', !!inst.obj.geometry.getAttribute('aColor0'));
owner.pos.set(4, 0, 5);
inst.update(0.05);
check('follow anchor moves the instanced effect', inst.obj.position.x === 4 && inst.obj.position.z === 5);
inst.update(0.4);
check('effect expires after emitter plus particle life', !inst.alive);
inst.kill();
console.log('\nERRORS none  (VFX profile/runtime checks passed)');
