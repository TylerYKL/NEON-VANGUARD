/* ============================================================
   RIGGEDDEMO — write a rigged, animated hero GLB into the dropbox.

   Why this exists: MOTION-AUDIT §4's blocker was never code, it was that every file in
   models/uploads/ is a static mesh (bones 0 · clips 0), so the clip path had nothing real
   to load. `tools/lib/rigged.mjs` builds one in memory for the test suites; this writes the
   same thing to disk so a *browser* can point a hero at it — pick it in the Hero Studio's
   SKIN FILE row, SAVE, reload, and the walk cycle is the file's own clip, not a sine.

   The written file IS committed — same rule as every other skin in models/uploads/ (a GLB
   there is an asset the workspace must keep across resets), 9 KB, and this tool is how you
   regenerate or change it. The in-memory fixture in tools/lib/rigged.mjs stays the test
   source, so the suites never depend on a file on disk.

   Usage:  node tools/riggeddemo.mjs [out.glb]
   ============================================================ */
import fs from 'fs';
import path from 'path';
import { riggedGLB, FIXTURE_CLIPS } from './lib/rigged.mjs';

const out = path.resolve(process.argv[2] || 'models/uploads/aegis-rig.glb');
const buf = Buffer.from(await riggedGLB());
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, buf);

/* read it back through the loader the game uses, so "it wrote a file" is not the claim */
const { parseGLB, gatherStats, normalizeToStage } = await import('../src/gltfutil.js');
const gltf = await parseGLB(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const s = gatherStats(gltf.scene);
const norm = normalizeToStage(gltf.scene, 2.4);
const clips = (gltf.animations || []).filter((c) => c.duration > 0);
const unbound = clips.filter((c) => !c.tracks.every((t) => !!gltf.scene.getObjectByName(t.name.split('.')[0])));

console.log('wrote ' + path.relative(process.cwd(), out) + '  ' + Math.round(buf.length / 1024) + ' KB');
console.log('  bones ' + s.bones + ' · skinned ' + s.skinned + ' · clips ' + clips.length +
  ' (' + clips.map((c) => c.name + ' ' + c.duration.toFixed(2) + 's').join(', ') + ')');
console.log('  fitted to ' + norm.height.toFixed(2) + ' m · tracks that do not bind: ' +
  (unbound.length ? unbound.map((c) => c.name).join(', ') : 'none'));
if (s.bones < 1 || clips.length !== FIXTURE_CLIPS.length || unbound.length) {
  console.log('\nNOT USABLE — the round trip lost something the mixer needs');
  process.exit(1);
}
console.log('\nnext: hero-studio.html → SKIN FILE & CLIPS → ' + path.basename(out) +
  ' → SAVE → reload the tab.\n      The clip rows should echo back what each state resolved to; press' +
  ' CAST SIM →\n      MOVE walk and the legs come from the file, not from animateRig.');
