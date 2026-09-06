import * as THREE from 'three';
import { metalMat, addMat, emissiveMat, TAU, damp, lerp, rand } from './util.js';

/* ============================================================
   Procedural humanoid rig — built from primitives, no assets.
   Every hero shares the skeleton; silhouette + gear differ.
   ============================================================ */

function box(w, h, d, mat, r = 0) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}
function caps(r, len, mat) {
  return new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
}

export function buildHumanoid(cfg) {
  const accent = cfg.accent;
  const plate = metalMat(cfg.plate ?? 0x2a2f45, 0.45, 0.85);
  const dark = metalMat(0x12141f, 0.6, 0.7);
  const glowM = addMat(accent, 0.95);
  const visorM = addMat(cfg.visor ?? accent, 1.0);

  const root = new THREE.Group();
  const bodyG = new THREE.Group(); root.add(bodyG);

  const bulk = cfg.bulk ?? 1;
  const scale = cfg.scale ?? 1;

  // hips
  const hips = new THREE.Group(); hips.position.y = 0.95 * scale; bodyG.add(hips);
  const pelvis = box(0.5 * bulk, 0.3, 0.34 * bulk, plate); hips.add(pelvis);

  // torso
  const torso = new THREE.Group(); torso.position.y = 0.18; hips.add(torso);
  const chest = box(0.66 * bulk, 0.62, 0.42 * bulk, plate); chest.position.y = 0.3; torso.add(chest);
  const abs = box(0.44 * bulk, 0.26, 0.32 * bulk, dark); abs.position.y = -0.02; torso.add(abs);
  // chest core light
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.1 * bulk, 12, 12), glowM);
  core.position.set(0, 0.34, 0.2 * bulk); torso.add(core);
  const coreLight = new THREE.PointLight(accent, 2.6, 7, 2); coreLight.position.copy(core.position); torso.add(coreLight);
  // back vents
  for (let s = -1; s <= 1; s += 2) {
    const v = box(0.1, 0.34, 0.1, glowM); v.position.set(s * 0.2 * bulk, 0.34, -0.22 * bulk); torso.add(v);
  }

  // head
  const neck = new THREE.Group(); neck.position.y = 0.68; torso.add(neck);
  const head = box(0.3, 0.32, 0.3, plate); head.position.y = 0.16; neck.add(head);
  const visor = box(0.26, 0.09, 0.04, visorM); visor.position.set(0, 0.18, 0.16); neck.add(visor);
  if (cfg.hood) {
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.44, 6), metalMat(cfg.plate ?? 0x22263a, 0.8, 0.2));
    hood.position.y = 0.3; hood.rotation.y = Math.PI / 6; neck.add(hood);
  }
  if (cfg.crest) {
    const cr = box(0.05, 0.2, 0.26, glowM); cr.position.set(0, 0.36, 0.02); neck.add(cr);
  }

  // shoulders + arms
  const arms = {};
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? -1 : 1;
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.38 * bulk, 0.52, 0);
    torso.add(shoulder);
    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.19 * bulk, 10, 8), plate);
    pad.scale.set(1, 0.85, 1); shoulder.add(pad);
    if (cfg.pauldrons) {
      const p2 = box(0.3 * bulk, 0.16, 0.34 * bulk, plate); p2.position.set(s * 0.1, 0.06, 0); shoulder.add(p2);
      const trim = box(0.32 * bulk, 0.04, 0.06, glowM); trim.position.set(s * 0.1, 0.14, 0.16 * bulk); shoulder.add(trim);
    }
    const upper = caps(0.085 * bulk, 0.26, dark); upper.position.y = -0.19; shoulder.add(upper);
    const elbow = new THREE.Group(); elbow.position.y = -0.36; shoulder.add(elbow);
    const fore = caps(0.08 * bulk, 0.24, plate); fore.position.y = -0.16; elbow.add(fore);
    const hand = new THREE.Group(); hand.position.y = -0.34; elbow.add(hand);
    const fist = box(0.13 * bulk, 0.14, 0.13 * bulk, dark); hand.add(fist);
    arms[side] = { shoulder, elbow, hand, upper, fore, fist, pad };
  }

  // legs
  const legs = {};
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? -1 : 1;
    const hip = new THREE.Group(); hip.position.set(s * 0.17 * bulk, -0.14, 0); hips.add(hip);
    const thigh = caps(0.1 * bulk, 0.26, dark); thigh.position.y = -0.2; hip.add(thigh);
    const knee = new THREE.Group(); knee.position.y = -0.4; hip.add(knee);
    const shin = caps(0.09 * bulk, 0.26, plate); shin.position.y = -0.2; knee.add(shin);
    const foot = box(0.16 * bulk, 0.1, 0.3, dark); foot.position.set(0, -0.4, 0.05); knee.add(foot);
    const trim = box(0.1, 0.03, 0.2, glowM); trim.position.set(0, -0.43, 0.06); knee.add(trim);
    legs[side] = { hip, knee, foot };
  }

  // ground glow disc under feet
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.8, 24), addMat(accent, 0.12));
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.03; root.add(disc);

  root.scale.setScalar(scale);

  return {
    root, bodyG, hips, torso, neck, head, visor, arms, legs, core, coreLight, disc,
    mats: { plate, dark, glowM, visorM },
    _phase: Math.random() * 10,
  };
}

/* --------- procedural animation --------- */
export function animateRig(rig, dt, o) {
  const speed = o.speed ?? 0;          // 0..1 normalised move speed
  const t = o.time;
  const atk = o.attack ?? 0;           // 0..1 attack progress (1 = just fired)
  const cast = o.cast ?? 0;
  const dead = o.dead ?? false;
  const hurt = o.hurt ?? 0;

  rig._phase += dt * (2.2 + speed * 9);
  const p = rig._phase;

  if (dead) {
    rig.bodyG.rotation.x = damp(rig.bodyG.rotation.x, -1.35, 6, dt);
    rig.bodyG.position.y = damp(rig.bodyG.position.y, -0.3, 6, dt);
    rig.disc.material.opacity = damp(rig.disc.material.opacity, 0.05, 4, dt);
    return;
  }
  rig.bodyG.rotation.x = damp(rig.bodyG.rotation.x, 0, 8, dt);

  const bob = Math.sin(p * 2) * 0.035 * (0.3 + speed);
  rig.hips.position.y = 0.95 + bob + (speed > 0.05 ? 0.02 : 0);
  rig.hips.rotation.z = Math.sin(p) * 0.04 * speed;
  rig.torso.rotation.y = damp(rig.torso.rotation.y, -Math.sin(p) * 0.16 * speed, 12, dt);
  rig.torso.rotation.x = damp(rig.torso.rotation.x, speed * 0.12 + cast * -0.15, 10, dt);
  rig.neck.rotation.x = damp(rig.neck.rotation.x, -speed * 0.08, 8, dt);

  // legs stride
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    const L = rig.legs[side];
    const sw = Math.sin(p + (s > 0 ? 0 : Math.PI));
    const target = sw * 0.85 * speed;
    L.hip.rotation.x = damp(L.hip.rotation.x, target - speed * 0.1, 16, dt);
    L.knee.rotation.x = damp(L.knee.rotation.x, Math.max(0, -sw) * 1.1 * speed + 0.06, 16, dt);
  }

  // arms
  const swing = 0.6 * speed;
  const aR = rig.arms.R, aL = rig.arms.L;
  const atkE = Math.pow(atk, 0.6);

  if (o.style === 'fist') {
    // right hook punch on attack, guard pose otherwise
    aR.shoulder.rotation.x = damp(aR.shoulder.rotation.x, -0.55 - atkE * 1.15, 22, dt);
    aR.shoulder.rotation.z = damp(aR.shoulder.rotation.z, -0.35 + atkE * 0.25, 18, dt);
    aR.elbow.rotation.x = damp(aR.elbow.rotation.x, -1.5 + atkE * 1.35, 22, dt);
    aL.shoulder.rotation.x = damp(aL.shoulder.rotation.x, -0.75 + (o.block ? -0.35 : 0), 14, dt);
    aL.shoulder.rotation.z = damp(aL.shoulder.rotation.z, 0.5 + (o.block ? 0.25 : 0), 14, dt);
    aL.elbow.rotation.x = damp(aL.elbow.rotation.x, -1.7, 14, dt);
  } else if (o.style === 'gun') {
    // right arm aims forward, recoil kick
    aR.shoulder.rotation.x = damp(aR.shoulder.rotation.x, -1.42 + atkE * 0.4, 26, dt);
    aR.shoulder.rotation.z = damp(aR.shoulder.rotation.z, -0.16, 14, dt);
    aR.elbow.rotation.x = damp(aR.elbow.rotation.x, -0.22 - atkE * 0.2, 24, dt);
    aL.shoulder.rotation.x = damp(aL.shoulder.rotation.x, -0.5 - Math.sin(p) * swing * 0.5 - cast * 0.9, 12, dt);
    aL.shoulder.rotation.z = damp(aL.shoulder.rotation.z, 0.3, 12, dt);
    aL.elbow.rotation.x = damp(aL.elbow.rotation.x, -0.9 - cast * 0.6, 12, dt);
  } else { // support / caster
    aR.shoulder.rotation.x = damp(aR.shoulder.rotation.x, -0.95 - atkE * 0.55 - cast * 0.7, 16, dt);
    aR.shoulder.rotation.z = damp(aR.shoulder.rotation.z, -0.34 - cast * 0.2, 14, dt);
    aR.elbow.rotation.x = damp(aR.elbow.rotation.x, -0.8 + atkE * 0.45, 18, dt);
    aL.shoulder.rotation.x = damp(aL.shoulder.rotation.x, -0.9 - cast * 0.8, 14, dt);
    aL.shoulder.rotation.z = damp(aL.shoulder.rotation.z, 0.34, 14, dt);
    aL.elbow.rotation.x = damp(aL.elbow.rotation.x, -0.85 - cast * 0.4, 14, dt);
  }

  // hurt flinch
  if (hurt > 0) {
    rig.torso.rotation.x -= hurt * 0.25;
    rig.neck.rotation.z = hurt * 0.2;
  } else {
    rig.neck.rotation.z = damp(rig.neck.rotation.z, 0, 10, dt);
  }

  // core pulse
  const pulse = 0.75 + 0.25 * Math.sin(t * 4);
  rig.core.material.opacity = pulse;
  rig.coreLight.intensity = 1.4 + pulse * 1.2 + atk * 3;
  rig.disc.material.opacity = 0.09 + 0.05 * Math.sin(t * 3) + speed * 0.05;
}

/* ============================================================
   WEAPONS — modern / near-future hardware, no swords or staves
   ============================================================ */

export function buildIonGauntlets(rig, accent) {
  const g = {};
  for (const side of ['L', 'R']) {
    const gaunt = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.34), metalMat(0x3a2010, 0.35, 0.95));
    shell.position.z = 0.04; gaunt.add(shell);
    const knuck = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.1), addMat(accent, 1));
    knuck.position.set(0, 0.06, 0.2); gaunt.add(knuck);
    for (let i = -1; i <= 1; i++) {
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.05), addMat(accent, 0.85));
      v.position.set(i * 0.1, 0, -0.16); gaunt.add(v);
    }
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.22, 8), metalMat(0x1a1c28, 0.5, 0.9));
    cuff.position.y = 0.2; gaunt.add(cuff);
    const light = new THREE.PointLight(accent, 1.4, 3.5, 2); gaunt.add(light);
    rig.arms[side].hand.add(gaunt);
    gaunt.rotation.x = -Math.PI / 2;
    g[side] = { group: gaunt, knuck, light };
  }
  return g;
}

export function buildRiotShield(rig, accent) {
  const sh = new THREE.Group();
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.25, 0.08), new THREE.MeshStandardMaterial({
    color: 0x0b2a3a, roughness: 0.15, metalness: 0.4, transparent: true, opacity: 0.55,
  }));
  sh.add(panel);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.02, 1.32, 0.05), metalMat(0x2a2f45, 0.4, 0.9));
  frame.position.z = -0.03; sh.add(frame);
  for (let i = -1; i <= 1; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.03), addMat(accent, 0.95));
    bar.position.set(0, i * 0.42, 0.06); sh.add(bar);
  }
  const emblem = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.24, 6), addMat(accent, 1));
  emblem.position.z = 0.07; sh.add(emblem);
  sh.position.set(-0.05, -0.1, 0.16);
  sh.rotation.set(0.2, 0.25, 0);
  rig.arms.L.hand.add(sh);
  return { group: sh, panel, frame };
}

export function buildMedGloves(rig, accent) {
  const g = {};
  for (const side of ['L', 'R']) {
    const grp = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.26), metalMat(0x123028, 0.3, 0.85));
    grp.add(shell);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 6, 16), addMat(accent, 1));
    ring.position.z = 0.14; grp.add(ring);
    const emitter = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), addMat(0xffffff, 1));
    emitter.position.z = 0.14; grp.add(emitter);
    const light = new THREE.PointLight(accent, 1.2, 3.5, 2); grp.add(light);
    grp.rotation.x = -Math.PI / 2;
    rig.arms[side].hand.add(grp);
    g[side] = { group: grp, ring, emitter, light };
  }
  return g;
}

export function buildRailPistol(rig, accent) {
  const grp = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.5), metalMat(0x23132e, 0.3, 0.95));
  body.position.z = 0.16; grp.add(body);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.26, 0.14), metalMat(0x14101c, 0.5, 0.7));
  grip.position.set(0, -0.16, 0.02); grp.add(grip);
  const rail1 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.46), addMat(accent, 1));
  rail1.position.set(-0.07, 0.08, 0.26); grp.add(rail1);
  const rail2 = rail1.clone(); rail2.position.x = 0.07; grp.add(rail2);
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.14, 8), addMat(accent, 0.9));
  muzzle.rotation.x = Math.PI / 2; muzzle.position.z = 0.46; grp.add(muzzle);
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 6, 14), addMat(0xffffff, 0.9));
  coil.position.z = 0.3; grp.add(coil);
  const light = new THREE.PointLight(accent, 0.8, 3, 2); light.position.z = 0.5; grp.add(light);
  grp.rotation.x = Math.PI / 2;
  grp.position.set(0, -0.08, 0.02);
  rig.arms.R.hand.add(grp);
  return { group: grp, muzzle, coil, light, rails: [rail1, rail2] };
}

/** shoulder-mounted companion drone (used by healer + gunner) */
export function buildDrone(rig, accent, side = 'L') {
  const grp = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.OctahedronGeometry(0.17, 0), metalMat(0x1a1e2e, 0.35, 0.95));
  grp.add(hull);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), addMat(accent, 1));
  eye.position.z = 0.13; grp.add(eye);
  const ringA = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.012, 5, 20), addMat(accent, 0.8));
  ringA.rotation.x = Math.PI / 2; grp.add(ringA);
  const light = new THREE.PointLight(accent, 1.1, 4, 2); grp.add(light);
  return { group: grp, hull, eye, ringA, light, side, bob: Math.random() * 10 };
}
