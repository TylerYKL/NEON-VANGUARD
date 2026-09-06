import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rand, pick, TAU, addMat, metalMat } from './util.js';

export const ARENA = 46; // half-extent of playable square

export function buildWorld(scene, renderer) {
  const group = new THREE.Group();
  scene.add(group);

  /* ---------- fog + ambient ---------- */
  scene.fog = new THREE.FogExp2(0x05060f, 0.0125);
  scene.background = new THREE.Color(0x04050c);

  const hemi = new THREE.HemisphereLight(0x3355ff, 0x0a0410, 0.85);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xaaccff, 1.15);
  key.position.set(24, 40, 18);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff2f8f, 0.6);
  rim.position.set(-30, 16, -22);
  scene.add(rim);

  /* ---------- floor: animated neon grid shader ---------- */
  const floorGeo = new THREE.PlaneGeometry(ARENA * 2.6, ARENA * 2.6, 1, 1);
  const floorUni = {
    uTime: { value: 0 },
    uPlayer: { value: new THREE.Vector3() },
    uAccent: { value: new THREE.Color(0x18e0ff) },
    uAccent2: { value: new THREE.Color(0xff2fa0) },
    uPulse: { value: 0 },
  };
  const floorMat = new THREE.ShaderMaterial({
    uniforms: floorUni,
    vertexShader: `
      varying vec2 vUv; varying vec3 vW;
      void main(){
        vUv = uv;
        vec4 w = modelMatrix * vec4(position,1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uPlayer; uniform vec3 uAccent; uniform vec3 uAccent2; uniform float uPulse;
      varying vec2 vUv; varying vec3 vW;
      float gridLine(vec2 p, float w){
        vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
        float l = min(g.x, g.y);
        return 1.0 - min(l * w, 1.0);
      }
      float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3,289.1)))*43758.5453); }
      void main(){
        vec2 p = vW.xz;
        // base tint w/ subtle sector variation
        vec2 cell = floor(p / 8.0);
        float h = hash(cell);
        vec3 col = vec3(0.012,0.017,0.035) + h*0.01;

        // fine grid + heavy grid
        float g1 = gridLine(p * 0.5, 1.0);
        float g2 = gridLine(p * 0.125, 1.4);
        col += uAccent * g1 * 0.055;
        col += mix(uAccent, uAccent2, 0.35 + 0.35*sin(cell.x*1.7+cell.y*2.3)) * g2 * 0.26;

        // travelling data pulses along the heavy grid
        float pulse = sin(p.x*0.35 - uTime*2.2) * sin(p.y*0.31 + uTime*1.6);
        col += uAccent * g2 * smoothstep(0.75,1.0,pulse) * 0.75;

        // player proximity glow
        float d = length(p - uPlayer.xz);
        col += uAccent * exp(-d*0.22) * 0.10;
        col += uAccent2 * exp(-d*0.09) * 0.035;

        // arena shockwave pulse (set on big events)
        float ringR = uPulse * 60.0;
        float rg = smoothstep(2.5, 0.0, abs(d - ringR)) * (1.0-uPulse);
        col += mix(uAccent2, vec3(1.0), 0.4) * rg * 1.4;

        // scanlines + vignette
        col *= 0.92 + 0.08*sin(vW.z*3.0 + uTime*1.5);
        float vig = smoothstep(85.0, 26.0, length(p));
        col *= 0.25 + 0.75*vig;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);

  /* ---------- perimeter walls ---------- */
  const wallMat = metalMat(0x0b0d1a, 0.55, 0.8);
  const stripMatA = addMat(0x19e5ff, 0.95);
  const stripMatB = addMat(0xff2fa0, 0.9);
  const wallH = 6;
  for (let s = 0; s < 4; s++) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(ARENA * 2 + 4, wallH, 2), wallMat);
    const a = (s * Math.PI) / 2;
    w.position.set(Math.sin(a) * (ARENA + 1), wallH / 2, Math.cos(a) * (ARENA + 1));
    w.rotation.y = a;
    group.add(w);
    for (let k = 0; k < 2; k++) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(ARENA * 2 + 4, 0.18, 0.12), k ? stripMatB : stripMatA);
      strip.position.set(Math.sin(a) * ARENA, 1.2 + k * 3.4, Math.cos(a) * ARENA);
      strip.rotation.y = a;
      group.add(strip);
    }
  }

  /* ---------- city skyline behind the walls ----------
     120 towers + ~240 window strips used to be ~360 separate meshes and the
     single biggest draw-call sink in the scene. They never move, so they are
     baked into two merged geometries: one lit shell, one additive strip mesh
     with the neon colour and brightness carried in vertex colours. */
  const cityColors = [0x00e5ff, 0xff2fa0, 0x7a5cff, 0x39ff88, 0xffb028];
  const towerMat = metalMat(0x070912, 0.7, 0.5);
  {
    const towerGeos = [];
    const stripGeos = [];
    const _m = new THREE.Matrix4();
    const _q = new THREE.Quaternion();
    const _e = new THREE.Euler();
    const _v = new THREE.Vector3();
    const _one = new THREE.Vector3(1, 1, 1);
    const col = new THREE.Color();

    for (let i = 0; i < 120; i++) {
      const a = Math.random() * TAU;
      const r = ARENA + 12 + Math.random() * 70;
      const h = 8 + Math.pow(Math.random(), 2) * 70;
      const w = 4 + Math.random() * 9;
      const px = Math.cos(a) * r, py = h / 2 - 1, pz = Math.sin(a) * r;
      const g = new THREE.BoxGeometry(w, h, w * rand(1.4, 0.6));
      _e.set(0, Math.random() * TAU, 0);
      _m.compose(_v.set(px, py, pz), _q.setFromEuler(_e), _one);
      g.applyMatrix4(_m);
      towerGeos.push(g);

      const c = pick(cityColors);
      const n = 1 + ((Math.random() * 3) | 0);
      for (let k = 0; k < n; k++) {
        const sh = h * rand(0.7, 0.2);
        const sg = new THREE.BoxGeometry(0.35, sh, 0.35);
        _m.compose(
          _v.set(px + rand(w / 2, -w / 2), sh / 2 + rand(h - sh, 0), pz + rand(w / 2, -w / 2)),
          _q.identity(), _one
        );
        sg.applyMatrix4(_m);
        // bake colour * brightness into vertex colours
        const bright = rand(0.85, 0.25);
        col.setHex(c).multiplyScalar(bright);
        const cnt = sg.attributes.position.count;
        const carr = new Float32Array(cnt * 3);
        for (let v = 0; v < cnt; v++) { carr[v * 3] = col.r; carr[v * 3 + 1] = col.g; carr[v * 3 + 2] = col.b; }
        sg.setAttribute('color', new THREE.BufferAttribute(carr, 3));
        stripGeos.push(sg);
      }
    }
    const towers = new THREE.Mesh(mergeGeometries(towerGeos, false), towerMat);
    towers.frustumCulled = false;
    group.add(towers);
    towerGeos.forEach((g) => g.dispose());

    const stripMat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const strips = new THREE.Mesh(mergeGeometries(stripGeos, false), stripMat);
    strips.frustumCulled = false;
    group.add(strips);
    stripGeos.forEach((g) => g.dispose());
  }

  /* ---------- holo billboards ---------- */
  const billboards = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + 0.3;
    const r = ARENA + 9;
    const w = rand(16, 9), h = rand(11, 6);
    const uni = { uTime: { value: 0 }, uSeed: { value: Math.random() * 10 }, uCol: { value: new THREE.Color(pick(cityColors)) } };
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.ShaderMaterial({
      uniforms: uni, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        uniform float uTime; uniform float uSeed; uniform vec3 uCol; varying vec2 vUv;
        float hash(vec2 p){ return fract(sin(dot(p,vec2(21.7,93.4)))*4551.3); }
        void main(){
          vec2 uv = vUv;
          float rows = 14.0;
          float row = floor(uv.y*rows);
          float speed = 0.25 + hash(vec2(row,uSeed))*1.2;
          float x = fract(uv.x + uTime*speed*0.12 + hash(vec2(row,uSeed+3.0)));
          float bar = step(0.4, hash(vec2(floor(x*10.0), row+uSeed)));
          float scan = 0.55 + 0.45*sin(uv.y*90.0 - uTime*7.0);
          float edge = smoothstep(0.0,0.05,uv.x)*smoothstep(1.0,0.95,uv.x)*smoothstep(0.0,0.05,uv.y)*smoothstep(1.0,0.95,uv.y);
          float a = (0.10 + bar*0.42) * scan * edge;
          gl_FragColor = vec4(uCol*a*1.5, a*0.85);
        }`,
    }));
    m.position.set(Math.cos(a) * r, rand(16, 8), Math.sin(a) * r);
    m.lookAt(0, m.position.y, 0);
    group.add(m);
    billboards.push(uni);
  }

  /* ---------- arena obstacles (cover pylons) ---------- */
  const obstacles = [];
  const pylonPositions = [
    [-20, -20], [20, -20], [-20, 20], [20, 20],
    [0, -28], [0, 28], [-30, 0], [30, 0],
    [-11, -6], [11, 6],
  ];
  for (const [x, z] of pylonPositions) {
    const h = rand(5.5, 3.2), rr = rand(2.2, 1.4);
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(rr * 0.8, rr, h, 6), metalMat(0x0d1020, 0.5, 0.85));
    body.position.y = h / 2;
    g.add(body);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(rr * 0.9, rr * 0.9, 0.22, 6), addMat(0x19e5ff, 0.9));
    cap.position.y = h + 0.1;
    g.add(cap);
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(rr * 0.83, rr * 0.83, h * 0.5, 6, 1, true), addMat(0x1160ff, 0.35));
    glow.position.y = h * 0.45;
    g.add(glow);
    g.position.set(x, 0, z);
    g.rotation.y = Math.random() * TAU;
    group.add(g);
    obstacles.push({ x, z, r: rr + 0.5, mesh: g, glow: cap });
  }

  /* ---------- rain ---------- */
  const RN = 2200;
  const rp = new Float32Array(RN * 6);
  const rc = new Float32Array(RN * 6);
  const rainSpeed = new Float32Array(RN);
  for (let i = 0; i < RN; i++) {
    const x = rand(ARENA * 2.2, -ARENA * 2.2), y = rand(40, 0), z = rand(ARENA * 2.2, -ARENA * 2.2);
    const len = rand(1.6, 0.7);
    rp[i * 6] = x; rp[i * 6 + 1] = y; rp[i * 6 + 2] = z;
    rp[i * 6 + 3] = x; rp[i * 6 + 4] = y - len; rp[i * 6 + 5] = z;
    const b = rand(0.5, 0.12);
    rc[i * 6] = b * 0.35; rc[i * 6 + 1] = b * 0.75; rc[i * 6 + 2] = b;
    rc[i * 6 + 3] = 0; rc[i * 6 + 4] = 0; rc[i * 6 + 5] = 0;
    rainSpeed[i] = rand(46, 26);
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  rainGeo.setAttribute('color', new THREE.BufferAttribute(rc, 3));
  rainGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 400);
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 }));
  rain.frustumCulled = false;
  group.add(rain);

  /* ---------- floating drones / ambience ----------
     26 spheres became one Points cloud: 1 draw call instead of 26. */
  const motes = [];
  const moteGeo = new THREE.BufferGeometry();
  {
    const N = 26;
    const pos = new Float32Array(N * 3);
    const cols = new Float32Array(N * 3);
    const col = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const x = rand(ARENA, -ARENA), y = rand(14, 3), z = rand(ARENA, -ARENA);
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      col.setHex(pick(cityColors));
      cols[i * 3] = col.r; cols[i * 3 + 1] = col.g; cols[i * 3 + 2] = col.b;
      motes.push({ i, a: Math.random() * TAU, r: rand(14, 5), y, s: rand(0.5, 0.12) * (Math.random() < 0.5 ? -1 : 1), cx: x, cz: z });
    }
    moteGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    moteGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  }
  const moteCloud = new THREE.Points(moteGeo, new THREE.PointsMaterial({
    size: 0.5, vertexColors: true, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }));
  moteCloud.frustumCulled = false;
  group.add(moteCloud);

  return {
    group, floorUni, obstacles, billboards,
    update(dt, t, playerPos) {
      floorUni.uTime.value = t;
      floorUni.uPlayer.value.copy(playerPos);
      if (floorUni.uPulse.value > 0) floorUni.uPulse.value = Math.max(0, floorUni.uPulse.value - dt * 0.9);
      for (const b of billboards) b.uTime.value = t;
      // rain
      const pos = rainGeo.attributes.position.array;
      for (let i = 0; i < RN; i++) {
        const d = rainSpeed[i] * dt;
        pos[i * 6 + 1] -= d; pos[i * 6 + 4] -= d;
        if (pos[i * 6 + 4] < 0) {
          const nx = playerPos.x + rand(60, -60), nz = playerPos.z + rand(60, -60);
          const len = rand(1.6, 0.7);
          pos[i * 6] = nx; pos[i * 6 + 1] = 42; pos[i * 6 + 2] = nz;
          pos[i * 6 + 3] = nx; pos[i * 6 + 4] = 42 - len; pos[i * 6 + 5] = nz;
        }
      }
      rainGeo.attributes.position.needsUpdate = true;
      const mp = moteGeo.attributes.position.array;
      for (const o of motes) {
        o.a += o.s * dt;
        mp[o.i * 3] = o.cx + Math.cos(o.a) * o.r * 0.3;
        mp[o.i * 3 + 1] = o.y + Math.sin(t * 0.8 + o.a) * 0.8;
        mp[o.i * 3 + 2] = o.cz + Math.sin(o.a) * o.r * 0.3;
      }
      moteGeo.attributes.position.needsUpdate = true;
      for (const ob of obstacles) ob.glow.material.opacity = 0.55 + 0.4 * Math.sin(t * 2 + ob.x);
    },
    arenaPulse() { floorUni.uPulse.value = 1; },
  };
}
