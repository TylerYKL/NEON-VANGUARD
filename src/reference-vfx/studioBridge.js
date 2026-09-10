import { Box3, Mesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const REFERENCE_ART = [
  ['AEGIS-7', 'impact', 'concept/upsampler/aegis-7-effect.png'],
  ['AEGIS-7', 'special', 'concept/upsampler/aegis-7-special.png'],
  ['LYRA-V', 'impact', 'concept/upsampler/lyra-v-effect.png'],
  ['LYRA-V', 'special', 'concept/upsampler/lyra-v-special.png'],
  ['NYX-0', 'impact', 'concept/upsampler/nyx-0-effect.png'],
  ['NYX-0', 'special', 'concept/upsampler/nyx-0-special.png'],
];

const API = (() => {
  const host = location.hostname;
  if (/^\d+-/.test(host)) return `${location.protocol}//${host.replace(/^\d+-/, '8081-')}`;
  return `${location.protocol}//${host}:8081`;
})();

function fitImported(root) {
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const scale = 1.8 / Math.max(0.001, size.y);
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);
  const fitted = new Box3().setFromObject(root);
  const fittedCenter = fitted.getCenter(new Vector3());
  root.position.x -= fittedCenter.x;
  root.position.z -= fittedCenter.z;
  root.position.y -= fitted.min.y;
}

function prepareModel(root) {
  root.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
    if (node.material && !Array.isArray(node.material)) node.material.side = 2;
  });
  fitImported(root);
}

export function installStudioBridge(app) {
  const host = document.getElementById('studio-bridge');
  if (!host) return;
  const loader = new GLTFLoader();
  let imported = null;
  let importedURL = null;

  host.innerHTML = `
    <div class="bridge__head"><b>NEON VANGUARD · LINEAR VFX LAB</b><button data-bridge="close">×</button></div>
    <p class="bridge__copy">Reference sandbox skills: Q Frost Lance · E Storm Lance · R Cinder Fall · F Nova Beam · V Voltaic Snare.</p>
    <label class="bridge__button">IMPORT GLB<input data-bridge="file" type="file" accept=".glb"></label>
    <select data-bridge="library"><option value="">uploaded GLB library</option></select>
    <button class="bridge__button bridge__small" data-bridge="reset">RESET PROCEDURAL CHARACTER</button>
    <a class="bridge__button bridge__small bridge__link" href="hero-studio-legacy.html">OPEN LEGACY GLB / VIDEO / GPU VFX / AUDIO WORKFLOW ↗</a>
    <div class="bridge__refs"><b>SKILL PNG REFERENCES</b><div data-bridge="refs"></div></div>
    <div class="bridge__status" data-bridge="status">Select a cast and aim on the ground. Press G for live parameters.</div>
  `;

  const status = host.querySelector('[data-bridge="status"]');
  const setStatus = (text, bad = false) => {
    status.textContent = text;
    status.classList.toggle('is-bad', bad);
  };

  function showModel(root, label) {
    if (imported) {
      app.scene.remove(imported);
      imported.traverse((node) => {
        if (node.isMesh) {
          node.geometry?.dispose();
          if (node.material && !Array.isArray(node.material)) node.material.dispose();
        }
      });
    }
    imported = root;
    prepareModel(imported);
    app.scene.add(imported);
    app.character.root.visible = false;
    setStatus('GLB ACTIVE · ' + label + ' · reference skills cast around the imported model');
  }

  function resetModel() {
    if (imported) {
      app.scene.remove(imported);
      imported = null;
    }
    if (importedURL) {
      URL.revokeObjectURL(importedURL);
      importedURL = null;
    }
    app.character.root.visible = true;
    setStatus('PROCEDURAL REFERENCE CHARACTER ACTIVE');
  }

  function loadURL(url, label) {
    setStatus('LOADING GLB · ' + label + '…');
    loader.load(url, (gltf) => showModel(gltf.scene || gltf.scenes[0], label), undefined,
      (error) => setStatus('GLB LOAD FAILED · ' + (error.message || error), true));
  }

  host.querySelector('[data-bridge="file"]').onchange = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (importedURL) URL.revokeObjectURL(importedURL);
    importedURL = URL.createObjectURL(file);
    loadURL(importedURL, file.name);
  };
  host.querySelector('[data-bridge="reset"]').onclick = resetModel;
  host.querySelector('[data-bridge="close"]').onclick = () => host.classList.toggle('is-hidden');

  const refs = host.querySelector('[data-bridge="refs"]');
  const overlay = document.createElement('div');
  overlay.className = 'bridge__artOverlay';
  overlay.innerHTML = '<button>×</button><img alt="skill reference"><small></small>';
  document.body.appendChild(overlay);
  const showArt = (name, kind, src) => {
    overlay.querySelector('img').src = src;
    overlay.querySelector('small').textContent = `${name} · ${kind} · live target reference`;
    overlay.classList.add('is-visible');
  };
  overlay.querySelector('button').onclick = () => overlay.classList.remove('is-visible');
  for (const [name, kind, src] of REFERENCE_ART) {
    const button = document.createElement('button');
    button.className = 'bridge__ref';
    button.innerHTML = `<img src="${src}" alt=""><span>${name} · ${kind}</span>`;
    button.onclick = () => showArt(name, kind, src);
    refs.appendChild(button);
  }

  fetch(`${API}/files`).then((response) => response.ok ? response.json() : []).then((files) => {
    const select = host.querySelector('[data-bridge="library"]');
    for (const file of files.filter((entry) => /\.glb$/i.test(entry.name))) {
      const option = document.createElement('option');
      option.value = `models/uploads/${file.name}`;
      option.textContent = file.name;
      select.appendChild(option);
    }
    select.onchange = () => { if (select.value) loadURL(select.value, select.value.split('/').pop()); };
  }).catch(() => setStatus('LOCAL GLB LIBRARY OFFLINE · IMPORT GLB STILL WORKS', true));

  window.addEventListener('beforeunload', () => {
    if (importedURL) URL.revokeObjectURL(importedURL);
  });
}
