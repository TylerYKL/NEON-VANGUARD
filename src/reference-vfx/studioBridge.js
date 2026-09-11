import { AnimationMixer, Box3, LoopRepeat, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  HERO_IDS,
  REFERENCE_CASTS,
  normalizeReferenceSkills,
} from './heroSkills.js';

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
    node.layers.enable(3); // keep imported heroes visible to the contact-shadow pass
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) if (material) material.side = 2;
  });
  fitImported(root);
  root.userData.studioFit = {
    scale: root.scale.x,
    x: root.position.x,
    y: root.position.y,
    z: root.position.z,
  };
}

function disposeImported(root) {
  if (!root) return;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((node) => {
    if (!node.isMesh) return;
    if (node.geometry) geometries.add(node.geometry);
    for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) textures.add(value);
      }
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose());
}

export function installStudioBridge(app) {
  const host = document.getElementById('studio-bridge');
  if (!host) return;
  const loader = new GLTFLoader();
  let imported = null;
  let importedMixer = null;
  let importedURL = null;
  let loadToken = 0;

  host.innerHTML = `
    <div class="bridge__head"><b>NEON VANGUARD · HERO STUDIO (BETA)</b><button data-bridge="close">×</button></div>
    <p class="bridge__copy">Reference sandbox skills: Q Frost Lance · E Storm Lance · R Cinder Fall · F Nova Beam · V Voltaic Snare.</p>
    <section class="bridge__mapping">
      <b>PLAYABLE HERO SKILL ROUTING</b>
      <div class="bridge__heroes" data-bridge="heroes"></div>
      <div class="bridge__route">
        <select data-bridge="slot"><option value="0">Q SLOT</option><option value="1">E SLOT</option><option value="2">R SLOT</option></select>
        <select data-bridge="cast"></select>
      </div>
      <label class="bridge__check"><input data-bridge="reference-on" type="checkbox" checked> REPLACE MATCH CASTS</label>
      <label class="bridge__check"><input data-bridge="legacy-fx" type="checkbox"> ALSO PLAY LEGACY FX</label>
      <button class="bridge__button bridge__small" data-bridge="save-route">SAVE ROUTING TO GAME</button>
    </section>
    <section class="bridge__model">
      <b>HERO MODEL ASSIGNMENT</b>
      <select data-bridge="model"></select>
      <label class="bridge__range">SCALE <input data-bridge="scale" type="range" min="0.5" max="2" step="0.01"><output data-bridge="scale-out"></output></label>
      <label class="bridge__range">YAW <input data-bridge="yaw" type="range" min="-180" max="180" step="1"><output data-bridge="yaw-out"></output></label>
      <label class="bridge__range">HEIGHT <input data-bridge="height" type="range" min="-3" max="3" step="0.01"><output data-bridge="height-out"></output></label>
      <button class="bridge__button bridge__small" data-bridge="save-model">SAVE MODEL FIT TO GAME</button>
    </section>
    <section class="bridge__skillAssets">
      <b>LEGACY SKILL ASSET / AUDIO SLOTS</b>
      <div class="bridge__route"><select data-bridge="asset-slot"><option value="0">Q SLOT</option><option value="1">E SLOT</option><option value="2">R SLOT</option></select><select data-bridge="asset"></select></div>
      <select data-bridge="audio"><option value="">no legacy audio cue</option></select>
      <label class="bridge__check"><input data-bridge="asset-on" type="checkbox"> ENABLE LEGACY ASSET + AUDIO FOR THIS SLOT</label>
      <button class="bridge__button bridge__small" data-bridge="save-asset">SAVE SLOT ASSET TO GAME</button>
    </section>
    <label class="bridge__button">IMPORT GLB FOR PREVIEW<input data-bridge="file" type="file" accept=".glb"></label>
    <select data-bridge="library"><option value="">uploaded hero GLB library</option></select>
    <button class="bridge__button bridge__small" data-bridge="reset">RESET PROCEDURAL CHARACTER</button>
    <button class="bridge__button bridge__small bridge__link" data-bridge="legacy">EXPAND LEGACY GLB / VIDEO / GPU VFX / AUDIO WORKFLOW</button>
    <div class="bridge__refs"><b>SKILL PNG REFERENCES</b><div data-bridge="refs"></div></div>
    <div class="bridge__status" data-bridge="status">Select a cast and aim on the ground. Press G for live parameters.</div>
    <div class="bridge__legacyPanel" data-bridge="legacy-panel" aria-hidden="true">
      <div class="bridge__legacyHead"><b>LEGACY HERO STUDIO WORKFLOW</b><button data-bridge="legacy-close">×</button></div>
      <iframe data-bridge="legacy-frame" title="Legacy Hero Studio"></iframe>
    </div>
  `;

  const referenceFrame = app.frame.bind(app);
  app.frame = () => {
    referenceFrame();
    importedMixer?.update(app.time.delta);
  };

  const status = host.querySelector('[data-bridge="status"]');
  const setStatus = (text, bad = false) => {
    status.textContent = text;
    status.classList.toggle('is-bad', bad);
  };

  let savedConfig = {};
  let route = normalizeReferenceSkills(null);
  let selectedHero = 'aegis';
  let selectedSlot = 0;
  const heroButtons = host.querySelector('[data-bridge="heroes"]');
  const slotSelect = host.querySelector('[data-bridge="slot"]');
  const castSelect = host.querySelector('[data-bridge="cast"]');
  const referenceOn = host.querySelector('[data-bridge="reference-on"]');
  const legacyFX = host.querySelector('[data-bridge="legacy-fx"]');
  const modelSelect = host.querySelector('[data-bridge="model"]');
  const scaleInput = host.querySelector('[data-bridge="scale"]');
  const scaleOutput = host.querySelector('[data-bridge="scale-out"]');
  const yawInput = host.querySelector('[data-bridge="yaw"]');
  const yawOutput = host.querySelector('[data-bridge="yaw-out"]');
  const heightInput = host.querySelector('[data-bridge="height"]');
  const heightOutput = host.querySelector('[data-bridge="height-out"]');
  const assetSlot = host.querySelector('[data-bridge="asset-slot"]');
  const assetSelect = host.querySelector('[data-bridge="asset"]');
  const audioSelect = host.querySelector('[data-bridge="audio"]');
  const assetOn = host.querySelector('[data-bridge="asset-on"]');
  let libraryFiles = [];

  for (const heroId of HERO_IDS) {
    const button = document.createElement('button');
    button.className = 'bridge__hero';
    button.dataset.hero = heroId;
    button.textContent = heroId.toUpperCase();
    button.onclick = () => {
      selectedHero = heroId;
      renderRoute();
    };
    heroButtons.appendChild(button);
  }
  for (const cast of REFERENCE_CASTS) {
    const option = document.createElement('option');
    option.value = cast.id;
    option.textContent = cast.label;
    castSelect.appendChild(option);
  }

  function heroConfig(heroId = selectedHero) {
    if (!savedConfig[heroId] || typeof savedConfig[heroId] !== 'object') savedConfig[heroId] = {};
    return savedConfig[heroId];
  }

  function renderModel() {
    const config = heroConfig();
    const model = config.model || '';
    modelSelect.value = model;
    scaleInput.value = Number.isFinite(Number(config.scale)) ? config.scale : 1;
    yawInput.value = Number.isFinite(Number(config.yawDeg)) ? config.yawDeg : 0;
    heightInput.value = Number.isFinite(Number(config.pos?.y)) ? config.pos.y : 0;
    scaleOutput.textContent = `${Number(scaleInput.value).toFixed(2)}x`;
    yawOutput.textContent = `${yawInput.value}°`;
    heightOutput.textContent = `${Number(heightInput.value).toFixed(2)}m`;
    applyPreviewFit();
  }

  function renderAsset() {
    const config = heroConfig();
    const slot = Number(assetSlot.value);
    const entry = config.fxSlots?.[slot] || null;
    assetSelect.value = entry?.src || '';
    audioSelect.value = entry?.p?.audio || '';
    assetOn.checked = !!entry && entry.on !== false;
  }

  function updateRangeOutputs() {
    const config = heroConfig();
    config.scale = Number(scaleInput.value);
    config.yawDeg = Number(yawInput.value);
    config.pos = { ...(config.pos || {}), y: Number(heightInput.value) };
    scaleOutput.textContent = `${Number(scaleInput.value).toFixed(2)}x`;
    yawOutput.textContent = `${yawInput.value}°`;
    heightOutput.textContent = `${Number(heightInput.value).toFixed(2)}m`;
    applyPreviewFit();
  }

  function applyPreviewFit() {
    if (!imported?.userData?.studioFit) return;
    const fit = imported.userData.studioFit;
    imported.scale.setScalar(fit.scale * Number(scaleInput.value || 1));
    imported.position.set(fit.x, fit.y + Number(heightInput.value || 0), fit.z);
    imported.rotation.y = Number(yawInput.value || 0) * Math.PI / 180;
  }

  function renderRoute() {
    const slots = route.map[selectedHero];
    selectedSlot = Number(slotSelect.value);
    castSelect.value = slots[selectedSlot];
    referenceOn.checked = route.on;
    legacyFX.checked = route.legacyFx;
    for (const button of heroButtons.children) button.classList.toggle('is-active', button.dataset.hero === selectedHero);
    const cast = slots[selectedSlot];
    app.selectAbility(cast, { silent: true });
    renderModel();
    renderAsset();
    const assignedModel = heroConfig().model;
    if (assignedModel && imported?.userData?.studioModel !== assignedModel) {
      loadURL(assignedModel, assignedModel.split('/').pop());
    }
    setStatus(`${selectedHero.toUpperCase()} ${['Q', 'E', 'R'][selectedSlot]} → ${REFERENCE_CASTS.find((entry) => entry.id === cast)?.label || cast}`);
  }

  slotSelect.onchange = () => {
    selectedSlot = Number(slotSelect.value);
    renderRoute();
  };
  castSelect.onchange = () => {
    route.map[selectedHero][selectedSlot] = castSelect.value;
    renderRoute();
  };
  referenceOn.onchange = () => { route.on = referenceOn.checked; };
  legacyFX.onchange = () => { route.legacyFx = legacyFX.checked; };

  async function saveConfig(payload, successMessage) {
    const response = await fetch(`${API}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    savedConfig = payload;
    setStatus(successMessage);
  }

  host.querySelector('[data-bridge="save-route"]').onclick = async () => {
    const payload = { ...savedConfig, referenceSkills: route };
    setStatus('SAVING HERO SKILL ROUTING…');
    try {
      await saveConfig(payload, 'ROUTING SAVED · RESTART THE MATCH TO APPLY');
    } catch (error) {
      setStatus(`ROUTING SAVE FAILED · ${error.message || error}`, true);
    }
  };

  for (const input of [scaleInput, yawInput, heightInput]) input.oninput = updateRangeOutputs;
  modelSelect.onchange = () => {
    const model = modelSelect.value;
    heroConfig().model = model || null;
    if (model) loadURL(model, model.split('/').pop());
    else resetModel();
  };
  host.querySelector('[data-bridge="save-model"]').onclick = async () => {
    const current = heroConfig();
    const pos = { ...(current.pos || {}), y: Number(heightInput.value) };
    const payload = {
      ...savedConfig,
      [selectedHero]: {
        ...current,
        model: modelSelect.value || null,
        scale: Number(scaleInput.value),
        yawDeg: Number(yawInput.value),
        pos,
      },
    };
    setStatus(`SAVING ${selectedHero.toUpperCase()} MODEL FIT…`);
    try {
      await saveConfig(payload, `${selectedHero.toUpperCase()} MODEL FIT SAVED · RESTART THE MATCH TO APPLY`);
    } catch (error) {
      setStatus(`MODEL SAVE FAILED · ${error.message || error}`, true);
    }
  };

  assetSlot.onchange = renderAsset;
  host.querySelector('[data-bridge="save-asset"]').onclick = async () => {
    const current = heroConfig();
    const fxSlots = Array.isArray(current.fxSlots) ? [...current.fxSlots] : [null, null, null];
    const slot = Number(assetSlot.value);
    const src = assetSelect.value;
    const previous = fxSlots[slot]?.p || {};
    fxSlots[slot] = src
      ? { src, on: assetOn.checked, p: { ...previous, audio: audioSelect.value || null } }
      : null;
    const nextRoute = { ...route, legacyFx: route.legacyFx || assetOn.checked };
    const payload = {
      ...savedConfig,
      referenceSkills: nextRoute,
      [selectedHero]: { ...current, fxSlots },
    };
    setStatus(`SAVING ${selectedHero.toUpperCase()} ${['Q', 'E', 'R'][slot]} ASSET SLOT…`);
    try {
      route = nextRoute;
      await saveConfig(payload, `${selectedHero.toUpperCase()} ${['Q', 'E', 'R'][slot]} ASSET SLOT SAVED`);
    } catch (error) {
      setStatus(`ASSET SAVE FAILED · ${error.message || error}`, true);
    }
  };
  const legacyPanel = host.querySelector('[data-bridge="legacy-panel"]');
  const legacyFrame = host.querySelector('[data-bridge="legacy-frame"]');
  const closeLegacy = () => {
    legacyPanel.classList.remove('is-visible');
    legacyPanel.setAttribute('aria-hidden', 'true');
  };
  host.querySelector('[data-bridge="legacy"]').onclick = () => {
    if (!legacyFrame.getAttribute('src')) legacyFrame.src = 'hero-studio-legacy.html';
    legacyPanel.classList.add('is-visible');
    legacyPanel.setAttribute('aria-hidden', 'false');
  };
  host.querySelector('[data-bridge="legacy-close"]').onclick = closeLegacy;
  renderRoute();

  fetch(`${API}/config`, { cache: 'no-store' }).then((response) => response.ok ? response.json() : {})
    .then((config) => {
      savedConfig = config && typeof config === 'object' ? config : {};
      route = normalizeReferenceSkills(savedConfig.referenceSkills);
      renderRoute();
    }).catch(() => setStatus('CONFIG API OFFLINE · DEFAULT ROUTING ACTIVE', true));

  function showModel(root, label, animations = [], modelURL = label) {
    if (importedMixer) importedMixer.stopAllAction();
    if (imported) {
      app.scene.remove(imported);
      disposeImported(imported);
    }
    imported = root;
    prepareModel(imported);
    imported.userData.studioModel = modelURL;
    applyPreviewFit();
    app.scene.add(imported);
    if (animations.length) {
      importedMixer = new AnimationMixer(imported);
      const idle = animations.find((clip) => /idle|stand|rest/i.test(clip.name)) || animations[0];
      importedMixer.clipAction(idle).setLoop(LoopRepeat, Infinity).play();
    } else {
      importedMixer = null;
    }
    app.character.root.visible = false;
    setStatus(`GLB ACTIVE · ${label}${animations.length ? ' · IDLE CLIP ACTIVE' : ''} · reference skills cast around the imported model`);
  }

  function resetModel() {
    loadToken++;
    if (importedMixer) importedMixer.stopAllAction();
    importedMixer = null;
    if (imported) {
      app.scene.remove(imported);
      disposeImported(imported);
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
    const token = ++loadToken;
    setStatus('LOADING GLB · ' + label + '…');
    loader.load(url, (gltf) => {
      const root = gltf.scene || gltf.scenes[0];
      if (token !== loadToken) {
        disposeImported(root);
        return;
      }
      showModel(root, label, gltf.animations || [], url);
    }, undefined, (error) => {
      if (token === loadToken) setStatus('GLB LOAD FAILED · ' + (error.message || error), true);
    });
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
    libraryFiles = Array.isArray(files) ? files : [];
    const modelFiles = libraryFiles.filter((entry) => /\.glb$/i.test(entry.name)
      && !/(?:-s\d+)?-fx\.glb$/i.test(entry.name));
    const assetFiles = libraryFiles.filter((entry) => /\.(?:glb|mp4|webm|ogv)$/i.test(entry.name));
    const audioFiles = libraryFiles.filter((entry) => /\.(?:ogg|wav|mp3|m4a|aac|opus|flac)$/i.test(entry.name));
    modelSelect.innerHTML = '<option value="">manifest model / procedural body</option>';
    const librarySelect = host.querySelector('[data-bridge="library"]');
    for (const file of modelFiles) {
      const value = `models/uploads/${file.name}`;
      for (const select of [modelSelect, librarySelect]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = file.name;
        select.appendChild(option);
      }
    }
    assetSelect.innerHTML = '<option value="">no legacy asset</option>';
    for (const file of assetFiles) {
      const option = document.createElement('option');
      option.value = `models/uploads/${file.name}`;
      option.textContent = file.name;
      assetSelect.appendChild(option);
    }
    for (const file of audioFiles) {
      const option = document.createElement('option');
      option.value = `models/uploads/${file.name}`;
      option.textContent = file.name;
      audioSelect.appendChild(option);
    }
    renderModel();
    renderAsset();
    librarySelect.onchange = () => {
      if (librarySelect.value) loadURL(librarySelect.value, librarySelect.value.split('/').pop());
    };
  }).catch(() => setStatus('LOCAL GLB LIBRARY OFFLINE · IMPORT GLB STILL WORKS', true));

  window.addEventListener('beforeunload', () => {
    if (importedURL) URL.revokeObjectURL(importedURL);
  });
}
