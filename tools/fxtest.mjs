/* FX quality budget test — the renderer keeps fixed buffers while quality
   profiles reduce admissions before the pool overwrites live effects. */
import * as THREE from 'three';
const CTX = () => ({
  createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} }),
  createImageData: (n) => ({ data: new Uint8ClampedArray(n * n * 4) }),
  putImageData() {}, fillRect() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
  set fillStyle(v) {}, set lineWidth(v) {}, set strokeStyle(v) {},
});
globalThis.self = globalThis;
globalThis.window = globalThis;
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => CTX() }) };
globalThis.Image = class { set src(v) { this.width = this.height = 4; this.onload && this.onload(); } };
const { FX } = await import('../src/fx.js');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
const fx = new FX(scene, camera);
const color = new THREE.Color(0xff8a2b);
const p = { x: 0, y: 1, z: 0 };
const check = (name, v) => { if (!v) throw new Error('FAIL ' + name); console.log('PASS  ' + name); };

fx.setQuality(0.5);
fx.setQuality(0.5);
const lowBudget = fx.particleBudget;
fx.setQuality(1.6);
const highBudget = fx.particleBudget;
check('low quality keeps a smaller particle budget', lowBudget < highBudget);
check('quality profile raises particle admission at cinematic', highBudget === 6000);

fx.setQuality(1.6);
for (let i = 0; i < 7000; i++) fx.spawn({ x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, color, life: 10, size: 0.1 });
for (let i = 0; i < 60; i++) fx.ring(p, color, { dur: 10 });
for (let i = 0; i < 40; i++) fx.beam(new THREE.Vector3(), new THREE.Vector3(1, 0, 1), color, { dur: 10 });
for (let i = 0; i < 600; i++) fx.spark(p, { x: 1, y: 1, z: 0 }, color, { dur: 10 });
check('particle overload is reported instead of overwriting live slots', fx.dropped.particles > 0);
check('ring overload is reported instead of overwriting live slots', fx.dropped.rings > 0);
check('beam overload is reported instead of overwriting live slots', fx.dropped.beams > 0);
check('spark overload is reported instead of overwriting live slots', fx.dropped.sparks > 0);

fx.setQuality(0.5);
const stats = fx.budgetStats();
check('particle admissions never exceed the low-quality budget', fx.alive <= fx.particleBudget);
check('ring admissions never exceed the low-quality budget', fx.rings.length <= fx.ringBudget);
check('beam admissions never exceed the low-quality budget', fx.beams.length <= fx.beamBudget);
check('spark admissions never exceed the low-quality budget', fx.sparks.length <= fx.sparkBudget);
check('budget report exposes every FX pool', /\d+\/\d+/.test(stats.particles) && /\d+\/\d+/.test(stats.rings) && /\d+\/\d+/.test(stats.beams) && /\d+\/\d+/.test(stats.sparks));
console.log('  quality budget: ' + JSON.stringify(stats));
console.log('\nERRORS none  (FX quality budgets passed)');
