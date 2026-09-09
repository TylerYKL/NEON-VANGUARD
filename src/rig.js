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

/* Hard-surface helpers — the concept sheets are chamfered plate armour, not
   smooth primitives. These two builders + flat shading on the metal materials
   are what make the rigs read as forged hardware instead of toy boxes. */

/** A box whose outline is chamfered by a single angular bevel (bevelSegments 1).
    w/h are the face dimensions (X/Y), d the thickness (Z). centre-origin. */
function chamfer(w, h, d, mat, bev) {
  const hw = w / 2, hh = h / 2;
  const sh = new THREE.Shape();
  sh.moveTo(-hw, -hh); sh.lineTo(hw, -hh); sh.lineTo(hw, hh); sh.lineTo(-hw, hh); sh.closePath();
  const b = bev ?? Math.min(w, h, d) * 0.3;
  const g = new THREE.ExtrudeGeometry(sh, {
    depth: Math.max(0.01, d - b * 2), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 1,
  });
  g.center();
  return new THREE.Mesh(g, mat);
}

/** A tapered hexagonal limb segment — flat facets, angular taper, no smoothness. */
function seg(rTop, rBot, len, mat, radial = 6) {
  return new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, radial, 1), mat);
}

export function buildHumanoid(cfg) {
  const accent = cfg.accent;
  const plate = metalMat(cfg.plate ?? 0x2a2f45, 0.45, 0.85);
  const dark = metalMat(0x12141f, 0.6, 0.7);
  const glowM = addMat(accent, 0.95);
  const visorM = addMat(cfg.visor ?? accent, 1.0);

  // Flat shading: each facet catches the key light as a distinct plane, which
  // is the whole difference between "armour" and "smooth plastic".
  for (const m of [plate, dark]) { m.flatShading = true; m.needsUpdate = true; }

  const root = new THREE.Group();
  const bodyG = new THREE.Group(); root.add(bodyG);

  const bulk = cfg.bulk ?? 1;
  const scale = cfg.scale ?? 1;

  // hips
  // the resting height is set at the END of this builder, from measured geometry
  // (`hipsRest` below) — no literal here, or the two would disagree again
  const hips = new THREE.Group(); bodyG.add(hips);
  const pelvis = chamfer(0.52 * bulk, 0.3, 0.36 * bulk, plate); hips.add(pelvis);
  // hip tassets break up the boxy pelvis silhouette
  for (let s = -1; s <= 1; s += 2) {
    const t = chamfer(0.16 * bulk, 0.3, 0.1, dark, 0.03);
    t.position.set(s * 0.3 * bulk, -0.16, 0);
    t.rotation.z = s * 0.18;
    hips.add(t);
  }

  // torso — layered chamfered plates so the front is never one flat box
  const torso = new THREE.Group(); torso.position.y = 0.18; hips.add(torso);
  const chest = chamfer(0.68 * bulk, 0.6, 0.4 * bulk, plate, 0.07); chest.position.y = 0.3; torso.add(chest);
  const collar = chamfer(0.5 * bulk, 0.24, 0.44 * bulk, dark, 0.05); collar.position.y = 0.56; torso.add(collar);
  const abs = chamfer(0.46 * bulk, 0.28, 0.34 * bulk, dark, 0.05); abs.position.y = -0.04; torso.add(abs);
  // hex chest core (the concept sheets all carry one)
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * bulk, 0.12 * bulk, 0.08, 6), glowM);
  core.rotation.x = Math.PI / 2; core.position.set(0, 0.34, 0.21 * bulk); torso.add(core);
  const coreLight = new THREE.PointLight(accent, 2.6, 7, 2); coreLight.position.copy(core.position); torso.add(coreLight);
  // back vents
  for (let s = -1; s <= 1; s += 2) {
    const v = box(0.1, 0.34, 0.1, glowM); v.position.set(s * 0.2 * bulk, 0.34, -0.22 * bulk); torso.add(v);
  }
  // waist tabard for the slimmer frames (not the heavy aegis)
  if (!cfg.pauldrons) {
    const tab = chamfer(0.34 * bulk, 0.7, 0.05, dark, 0.02);
    tab.position.set(0, -0.34, 0.2 * bulk); tab.rotation.x = 0.08; torso.add(tab);
  }

  // head
  const neck = new THREE.Group(); neck.position.y = 0.68; torso.add(neck);
  const head = chamfer(0.3, 0.32, 0.3, plate, 0.06); head.position.y = 0.16; neck.add(head);
  const visor = box(0.26, 0.09, 0.04, visorM); visor.position.set(0, 0.18, 0.16); neck.add(visor);
  // angular cheek guards give the helmet a face instead of a plain box
  for (let s = -1; s <= 1; s += 2) {
    const ck = chamfer(0.05, 0.16, 0.16, dark, 0.02);
    ck.position.set(s * 0.15, 0.12, 0.08); neck.add(ck);
  }
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
    const pad = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2 * bulk, 0), plate);
    pad.scale.set(1, 0.8, 1); shoulder.add(pad);
    if (cfg.pauldrons) {
      // two stacked, angled plates read as layered pauldron armour
      const p2 = chamfer(0.32 * bulk, 0.18, 0.36 * bulk, plate, 0.05); p2.position.set(s * 0.12, 0.08, 0); p2.rotation.z = -s * 0.25; shoulder.add(p2);
      const p3 = chamfer(0.26 * bulk, 0.14, 0.3 * bulk, dark, 0.04); p3.position.set(s * 0.2, -0.06, 0); p3.rotation.z = -s * 0.4; shoulder.add(p3);
      const trim = box(0.32 * bulk, 0.04, 0.06, glowM); trim.position.set(s * 0.1, 0.17, 0.16 * bulk); shoulder.add(trim);
    }
    const upper = seg(0.1 * bulk, 0.075 * bulk, 0.3, dark); upper.position.y = -0.19; shoulder.add(upper);
    const elbow = new THREE.Group(); elbow.position.y = -0.36; shoulder.add(elbow);
    const elbowPad = new THREE.Mesh(new THREE.OctahedronGeometry(0.09 * bulk, 0), plate); elbow.add(elbowPad);
    const fore = seg(0.09 * bulk, 0.065 * bulk, 0.28, plate); fore.position.y = -0.16; elbow.add(fore);
    const hand = new THREE.Group(); hand.position.y = -0.34; elbow.add(hand);
    const fist = chamfer(0.14 * bulk, 0.15, 0.14 * bulk, dark, 0.03); hand.add(fist);
    arms[side] = { shoulder, elbow, hand, upper, fore, fist, pad };
  }

  // legs
  const legs = {};
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? -1 : 1;
    const hip = new THREE.Group(); hip.position.set(s * 0.17 * bulk, -0.14, 0); hips.add(hip);
    const thigh = seg(0.12 * bulk, 0.09 * bulk, 0.3, dark); thigh.position.y = -0.2; hip.add(thigh);
    const knee = new THREE.Group(); knee.position.y = -0.4; hip.add(knee);
    const kneePad = chamfer(0.14 * bulk, 0.16, 0.1, plate, 0.03); kneePad.position.set(0, 0.02, 0.11); knee.add(kneePad);
    const shin = seg(0.1 * bulk, 0.07 * bulk, 0.3, plate); shin.position.y = -0.2; knee.add(shin);
    const foot = chamfer(0.16 * bulk, 0.12, 0.3, dark, 0.03); foot.position.set(0, -0.42, 0.06); knee.add(foot);
    const trim = box(0.1, 0.03, 0.2, glowM); trim.position.set(0, -0.43, 0.06); knee.add(trim);
    legs[side] = { hip, knee, foot };
  }

  // ground glow disc under feet
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.8, 24), addMat(accent, 0.12));
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.03; root.add(disc);

  root.scale.setScalar(scale);

  /* ONE hips baseline, MEASURED instead of guessed.
     It used to live in three places that disagreed: the builder wrote 0.95 * scale
     (a double-applied scale, since the root is scaled too), animateRig wrote a flat
     0.95 every frame, and Hero.hipsRest carried a third copy that nobody read. The
     net of that argument was that every procedural hero stood ~15 cm INTO the deck
     (MOTION-AUDIT F2). So: park the hips at 0, find how far the legs hang below it,
     and lift by exactly that — the soles land on y = 0 and every animation that owns
     `hips.position.y` (the slam in heroes.js) has a real rest value to return to. */
  hips.position.y = 0;
  root.updateMatrixWorld(true);
  let sole = 0;
  for (const side of ['L', 'R']) {
    const b = new THREE.Box3().setFromObject(legs[side].hip);
    if (Number.isFinite(b.min.y)) sole = Math.min(sole, b.min.y);
  }
  const hipsRest = -sole / scale;
  hips.position.y = hipsRest;

  return {
    root, bodyG, hips, torso, neck, head, visor, arms, legs, core, coreLight, disc,
    hipsRest,
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

  // one-sided by design: a stride lifts the body, it never pushes the feet through
  // the floor (a ±bob costs 2 × the amplitude of clearance at the trough)
  const bob = (0.5 - 0.5 * Math.cos(p * 2)) * 0.07 * (0.3 + speed);
  rig.hips.position.y = rig.hipsRest + bob + (speed > 0.05 ? 0.02 : 0);
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
    /* right arm aims forward, recoil kick — and now the kick is the real `recoil`, not just
       the attack envelope: a railshot pushes it to 1.6, a normal shot to 1, and Hero.update
       bleeds it off at dt*6 (~0.27 s), so the arm snaps back and settles instead of punching
       and holding (MOTION-AUDIT F7: this value was decayed and read by nobody). */
    const rec = o.recoil || 0;
    aR.shoulder.rotation.x = damp(aR.shoulder.rotation.x, -1.42 + atkE * 0.4 - rec * 0.22, 26, dt);
    aR.shoulder.rotation.z = damp(aR.shoulder.rotation.z, -0.16, 14, dt);
    aR.elbow.rotation.x = damp(aR.elbow.rotation.x, -0.22 - atkE * 0.2 + rec * 0.3, 24, dt);
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
