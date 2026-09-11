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

const CAST_OPTIONS = Object.fromEntries(REFERENCE_CASTS.map((cast) => [cast.label, cast.id]));
const HERO_OPTIONS = { Aegis: 'aegis', Nyx: 'nyx', Lyra: 'lyra' };
const SLOT_OPTIONS = { Q: 0, E: 1, R: 2 };

const API = (() => {
  const host = location.hostname;
  if (/^\d+-/.test(host)) return `${location.protocol}//${host.replace(/^\d+-/, '8081-')}`;
  return `${location.protocol}//${host}:8081`;
})();

function fitImported(root) {
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  const size = box.getSize(new Vector3());
  root.scale.setScalar(1.8 / Math.max(0.001, size.y));
  root.updateMatrixWorld(true);
  const fitted = new Box3().setFromObject(root);
  const center = fitted.getCenter(new Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= fitted.min.y;
}

function prepareModel(root) {
  root.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
    node.layers.enable(3);
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
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose());
}

function makeOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'studio-art-overlay';
  overlay.innerHTML = '<button type="button" aria-label="Close reference gallery">×</button><img alt="skill reference"><small></small>';
  document.body.appendChild(overlay);
  overlay.querySelector('button').onclick = () => overlay.classList.remove('is-visible');
  overlay.onclick = (event) => {
    if (event.target === overlay) overlay.classList.remove('is-visible');
  };
  return overlay;
}

function makeLegacyPanel() {
  const panel = document.createElement('div');
  panel.className = 'studio-legacy-panel';
  panel.setAttribute('aria-hidden', 'true');
  panel.innerHTML = `
    <div class="studio-legacy-panel__head">
      <b>LEGACY WORKFLOW · COMPATIBILITY VIEW</b>
      <button type="button" aria-label="Close legacy workflow">×</button>
    </div>
    <iframe title="Legacy Hero Studio workflow"></iframe>
  `;
  document.body.appendChild(panel);
  const close = () => {
    panel.classList.remove('is-visible');
    panel.setAttribute('aria-hidden', 'true');
  };
  panel.querySelector('button').onclick = close;
  return {
    open() {
      const frame = panel.querySelector('iframe');
      if (!frame.getAttribute('src')) frame.src = 'hero-studio-legacy.html';
      panel.classList.add('is-visible');
      panel.setAttribute('aria-hidden', 'false');
    },
  };
}

/**
 * Mounts Hero Studio controls inside the existing right-side lil-gui VFX Editor.
 * There is intentionally no second left-side panel or tab: reference casting,
 * model fitting, legacy slots, and compatibility notes all live in one folder.
 */
export function installStudioBridge(app) {
  const gui = app.editor?.gui;
  if (!gui) return;

  const loader = new GLTFLoader();
  const overlay = makeOverlay();
  const legacyPanel = makeLegacyPanel();
  let imported = null;
  let importedMixer = null;
  let importedURL = null;
  let loadToken = 0;
  let savedConfig = {};
  let route = normalizeReferenceSkills(null);
  let modelOptions = { 'procedural body': '' };
  let assetOptions = { 'no legacy asset': '' };
  let audioOptions = { 'no audio cue': '' };

  const state = {
    hero: 'aegis',
    slot: 0,
    cast: 'ice',
    referenceOn: true,
    legacyFx: false,
    model: '',
    scale: 1,
    yaw: 0,
    height: 0,
    assetSlot: 0,
    asset: '',
    audio: '',
    assetOn: false,
    status: 'Loading Hero Studio controls…',
  };

  const studio = gui.addFolder('Hero Studio (Beta)');
  const statusController = studio.add(state, 'status').name('status').disable();
  const routing = studio.addFolder('Playable skill routing');
  const heroes = routing.add(state, 'hero', HERO_OPTIONS).name('hero');
  const slots = routing.add(state, 'slot', SLOT_OPTIONS).name('slot');
  const casts = routing.add(state, 'cast', CAST_OPTIONS).name('reference cast');
  const referenceOn = routing.add(state, 'referenceOn').name('replace match casts');
  const legacyFx = routing.add(state, 'legacyFx').name('also play legacy FX');
  const saveRoute = routing.add({ save: () => saveRouting() }, 'save').name('Save routing to game');

  const modelFolder = studio.addFolder('Hero model assignment');
  let modelController = modelFolder.add(state, 'model', { 'procedural body': '' }).name('assigned model');
  const scaleController = modelFolder.add(state, 'scale', 0.5, 2, 0.01).name('scale');
  const yawController = modelFolder.add(state, 'yaw', -180, 180, 1).name('yaw degrees');
  const heightController = modelFolder.add(state, 'height', -3, 3, 0.01).name('height offset');
  const saveModel = modelFolder.add({ save: () => saveModelFit() }, 'save').name('Save model fit to game');
  const importModel = modelFolder.add({ importGLB: () => fileInput.click() }, 'importGLB').name('Import GLB for preview');
  const resetModelButton = modelFolder.add({ reset: () => resetModel() }, 'reset').name('Reset procedural preview');

  const assets = studio.addFolder('Legacy skill assets / audio');
  const assetSlot = assets.add(state, 'assetSlot', SLOT_OPTIONS).name('slot');
  let assetController = assets.add(state, 'asset', { 'no legacy asset': '' }).name('asset / video / GLB');
  let audioController = assets.add(state, 'audio', { 'no audio cue': '' }).name('audio cue');
  const assetOn = assets.add(state, 'assetOn').name('enable legacy slot');
  const saveAsset = assets.add({ save: () => saveAssetSlot() }, 'save').name('Save slot asset to game');

  const galleryFolder = studio.addFolder('Skill PNG gallery');
  const openGallery = galleryFolder.add({ open: () => showGallery() }, 'open').name('Open reference gallery');
  galleryFolder.add({ note: 'Six concept references available' }, 'note').name('availability').disable();

  const compatibility = studio.addFolder('Compatibility / not migrated');
  const compatibilityNotes = {
    native: 'Native: casts, routing, GLB preview, model fit, persistence',
    legacyFX: 'Legacy-only: per-file GLB/video FX tuning UI',
    gpu: 'Legacy-only: GPU VFX profile editor and particle tuning',
    audio: 'Mixed: slot assignment persists here; legacy playback controls remain legacy',
    castSim: 'Legacy-only: CAST SIM remains in the compatibility view',
    skillImport: 'Not supported: new gameplay skills are code-registered, not JSON-registered',
    legacyPanel: 'Open compatibility view for the complete legacy workflow',
  };
  for (const [key, text] of Object.entries(compatibilityNotes)) {
    compatibility.add(compatibilityNotes, key).name(key).disable();
  }
  const openLegacy = compatibility.add({ open: () => legacyPanel.open() }, 'open').name('Open legacy compatibility view');

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.glb';
  fileInput.hidden = true;
  document.body.appendChild(fileInput);

  function setStatus(message, toast = false) {
    state.status = message;
    statusController.updateDisplay();
    if (toast) app.hud.showToast(message);
  }

  function heroConfig(heroId = state.hero) {
    if (!savedConfig[heroId] || typeof savedConfig[heroId] !== 'object') savedConfig[heroId] = {};
    return savedConfig[heroId];
  }

  function sync(controller) {
    controller.updateDisplay();
  }

  function refreshOptionControllers() {
    modelController = modelController.options(modelOptions);
    modelController.onChange(handleModelChange);
    assetController = assetController.options(assetOptions);
    audioController = audioController.options(audioOptions);
  }

  function renderModel() {
    const config = heroConfig();
    state.model = config.model || '';
    state.scale = Number.isFinite(Number(config.scale)) ? Number(config.scale) : 1;
    state.yaw = Number.isFinite(Number(config.yawDeg)) ? Number(config.yawDeg) : 0;
    state.height = Number.isFinite(Number(config.pos?.y)) ? Number(config.pos.y) : 0;
    sync(modelController);
    sync(scaleController);
    sync(yawController);
    sync(heightController);
    applyPreviewFit();
  }

  function renderAsset() {
    const config = heroConfig();
    const entry = config.fxSlots?.[state.assetSlot] || null;
    state.asset = entry?.src || '';
    state.audio = entry?.p?.audio || '';
    state.assetOn = !!entry && entry.on !== false;
    sync(assetController);
    sync(audioController);
    sync(assetOn);
  }

  function renderRoute({ loadAssignedModel = true } = {}) {
    const slotsForHero = route.map[state.hero];
    state.cast = slotsForHero[state.slot];
    state.referenceOn = route.on;
    state.legacyFx = route.legacyFx;
    sync(heroes);
    sync(slots);
    sync(casts);
    sync(referenceOn);
    sync(legacyFx);
    app.selectAbility(state.cast, { silent: true });
    renderModel();
    renderAsset();
    if (loadAssignedModel) {
      const assignedModel = heroConfig().model;
      if (assignedModel && imported?.userData?.studioModel !== assignedModel) {
        loadURL(assignedModel, assignedModel.split('/').pop());
      }
    }
    setStatus(`${state.hero.toUpperCase()} ${['Q', 'E', 'R'][state.slot]} → ${REFERENCE_CASTS.find((entry) => entry.id === state.cast)?.label || state.cast}`);
  }

  function applyPreviewFit() {
    if (!imported?.userData?.studioFit) return;
    const fit = imported.userData.studioFit;
    imported.scale.setScalar(fit.scale * state.scale);
    imported.position.set(fit.x, fit.y + state.height, fit.z);
    imported.rotation.y = state.yaw * Math.PI / 180;
  }

  async function saveConfig(payload, message) {
    const response = await fetch(`${API}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    savedConfig = payload;
    setStatus(message, true);
  }

  async function saveRouting() {
    const payload = { ...savedConfig, referenceSkills: route };
    setStatus('Saving skill routing…');
    try {
      await saveConfig(payload, 'Routing saved · restart the match to apply');
    } catch (error) {
      setStatus(`Routing save failed · ${error.message || error}`, true);
    }
  }

  async function saveModelFit() {
    const current = heroConfig();
    const payload = {
      ...savedConfig,
      [state.hero]: {
        ...current,
        model: state.model || null,
        scale: state.scale,
        yawDeg: state.yaw,
        pos: { ...(current.pos || {}), y: state.height },
      },
    };
    setStatus(`Saving ${state.hero.toUpperCase()} model fit…`);
    try {
      await saveConfig(payload, `${state.hero.toUpperCase()} model fit saved · restart the match to apply`);
    } catch (error) {
      setStatus(`Model save failed · ${error.message || error}`, true);
    }
  }

  async function saveAssetSlot() {
    const current = heroConfig();
    const fxSlots = Array.isArray(current.fxSlots) ? [...current.fxSlots] : [null, null, null];
    const previous = fxSlots[state.assetSlot]?.p || {};
    fxSlots[state.assetSlot] = state.asset
      ? { src: state.asset, on: state.assetOn, p: { ...previous, audio: state.audio || null } }
      : null;
    route = { ...route, legacyFx: route.legacyFx || state.assetOn };
    state.legacyFx = route.legacyFx;
    sync(legacyFx);
    const payload = {
      ...savedConfig,
      referenceSkills: route,
      [state.hero]: { ...current, fxSlots },
    };
    setStatus(`Saving ${state.hero.toUpperCase()} ${['Q', 'E', 'R'][state.assetSlot]} asset slot…`);
    try {
      await saveConfig(payload, `${state.hero.toUpperCase()} ${['Q', 'E', 'R'][state.assetSlot]} asset slot saved`);
    } catch (error) {
      setStatus(`Asset save failed · ${error.message || error}`, true);
    }
  }

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
    setStatus(`GLB active · ${label}${animations.length ? ' · idle clip active' : ''}`, true);
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
    setStatus('Procedural reference character active', true);
  }

  function loadURL(url, label) {
    const token = ++loadToken;
    setStatus(`Loading GLB · ${label}…`);
    loader.load(url, (gltf) => {
      const root = gltf.scene || gltf.scenes[0];
      if (token !== loadToken) {
        disposeImported(root);
        return;
      }
      showModel(root, label, gltf.animations || [], url);
    }, undefined, (error) => {
      if (token === loadToken) setStatus(`GLB load failed · ${error.message || error}`, true);
    });
  }

  function showGallery() {
    const img = overlay.querySelector('img');
    const caption = overlay.querySelector('small');
    const current = Number(overlay.dataset.index || 0);
    const [name, kind, src] = REFERENCE_ART[current % REFERENCE_ART.length];
    img.src = src;
    img.alt = `${name} ${kind} skill reference`;
    caption.textContent = `${name} · ${kind} · click the image to close · ${current + 1}/${REFERENCE_ART.length}`;
    overlay.dataset.index = String((current + 1) % REFERENCE_ART.length);
    overlay.classList.add('is-visible');
  }

  heroes.onChange(() => {
    renderRoute();
  });
  slots.onChange(() => {
    renderRoute({ loadAssignedModel: false });
  });
  casts.onChange(() => {
    route.map[state.hero][state.slot] = state.cast;
    renderRoute({ loadAssignedModel: false });
  });
  referenceOn.onChange((value) => { route.on = value; });
  legacyFx.onChange((value) => { route.legacyFx = value; });
  scaleController.onChange((value) => { state.scale = Number(value); heroConfig().scale = state.scale; applyPreviewFit(); });
  yawController.onChange((value) => { state.yaw = Number(value); heroConfig().yawDeg = state.yaw; applyPreviewFit(); });
  heightController.onChange((value) => {
    state.height = Number(value);
    heroConfig().pos = { ...(heroConfig().pos || {}), y: state.height };
    applyPreviewFit();
  });
  function handleModelChange(value) {
    state.model = value;
    heroConfig().model = value || null;
    if (value) loadURL(value, value.split('/').pop());
    else resetModel();
  }
  function handleAssetSlotChange() {
    state.assetSlot = Number(state.assetSlot);
    renderAsset();
  }
  modelController.onChange(handleModelChange);
  assetSlot.onChange(handleAssetSlotChange);
  fileInput.onchange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (importedURL) URL.revokeObjectURL(importedURL);
    importedURL = URL.createObjectURL(file);
    loadURL(importedURL, `${file.name} · preview only`);
    fileInput.value = '';
  };

  renderRoute();

  fetch(`${API}/config`, { cache: 'no-store' })
    .then((response) => response.ok ? response.json() : {})
    .then((config) => {
      savedConfig = config && typeof config === 'object' ? config : {};
      route = normalizeReferenceSkills(savedConfig.referenceSkills);
      const loadedHero = savedConfig[state.hero] || {};
      if (loadedHero.model) modelOptions[loadedHero.model.split('/').pop()] = loadedHero.model;
      for (const entry of loadedHero.fxSlots || []) {
        if (entry?.src) assetOptions[entry.src.split('/').pop()] = entry.src;
        if (entry?.p?.audio) audioOptions[entry.p.audio.split('/').pop()] = entry.p.audio;
      }
      refreshOptionControllers();
      renderRoute();
    })
    .catch(() => setStatus('Config API offline · defaults active', true));

  fetch(`${API}/files`)
    .then((response) => response.ok ? response.json() : [])
    .then((files) => {
      const entries = Array.isArray(files) ? files : [];
      const modelFiles = entries.filter((entry) => /\.glb$/i.test(entry.name)
        && !/(?:-s\d+)?-fx\.glb$/i.test(entry.name));
      const assetFiles = entries.filter((entry) => /\.(?:glb|mp4|webm|ogv)$/i.test(entry.name));
      const audioFiles = entries.filter((entry) => /\.(?:ogg|wav|mp3|m4a|aac|opus|flac)$/i.test(entry.name));
      modelOptions = { 'procedural body': '' };
      for (const file of modelFiles) modelOptions[file.name] = `models/uploads/${file.name}`;
      if (state.model && !Object.values(modelOptions).includes(state.model)) modelOptions[state.model.split('/').pop()] = state.model;
      assetOptions = { 'no legacy asset': '' };
      for (const file of assetFiles) assetOptions[file.name] = `models/uploads/${file.name}`;
      audioOptions = { 'no audio cue': '' };
      for (const file of audioFiles) audioOptions[file.name] = `models/uploads/${file.name}`;
      refreshOptionControllers();
      renderModel();
      renderAsset();
    })
    .catch(() => setStatus('Upload library offline · direct GLB preview still works', true));

  app.frame = ((frame) => () => {
    frame();
    importedMixer?.update(app.time.delta);
  })(app.frame.bind(app));

  window.addEventListener('beforeunload', () => {
    if (importedURL) URL.revokeObjectURL(importedURL);
  });
}
