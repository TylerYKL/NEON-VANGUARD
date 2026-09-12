import { settings, applySettings, snapshotSettings, DEFAULT_SETTINGS } from '../config/settings.js';
import { validateSkillManifest, isSupportedManifestKind } from '../skillValidator.js';

const UPLOAD_API = (() => {
  const host = location.hostname;
  if (/^\d+-/.test(host)) return `${location.protocol}//${host.replace(/^\d+-/, '8081-')}`;
  return `${location.protocol}//${host}:8081`;
})();

// Namespaced afresh: the settings tree was rebuilt around the ice ability, so
// presets saved against the old elemental blocks would merge into nothing.
const STORAGE_KEY = 'frost-sandbox.presets.v1';
const LAST_KEY = 'frost-sandbox.lastPreset';

/**
 * Preset persistence.
 *
 * Presets are plain snapshots of the settings tree, stored in localStorage and
 * exportable as JSON. Loading merges *into* the live settings objects rather
 * than replacing them, so every binding held by a shader or particle system
 * stays valid — which is why a preset can be swapped mid-cast.
 */
export class PresetManager {
  constructor() {
    this.presets = this._read();
  }

  _read() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (error) {
      console.warn('[PresetManager] could not read presets', error);
      return {};
    }
  }

  _write() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.presets));
    } catch (error) {
      console.warn('[PresetManager] could not persist presets', error);
    }
  }

  get names() {
    return Object.keys(this.presets).sort();
  }

  has(name) {
    return Object.prototype.hasOwnProperty.call(this.presets, name);
  }

  save(name) {
    if (!name) return false;
    this.presets[name] = snapshotSettings();
    this._write();
    localStorage.setItem(LAST_KEY, name);
    return true;
  }

  load(name) {
    const preset = this.presets[name];
    if (!preset) return false;
    applySettings(preset);
    localStorage.setItem(LAST_KEY, name);
    return true;
  }

  duplicate(name) {
    if (!this.has(name)) return null;
    let copy = `${name} copy`;
    let index = 2;
    while (this.has(copy)) copy = `${name} copy ${index++}`;
    this.presets[copy] = structuredClone(this.presets[name]);
    this._write();
    return copy;
  }

  remove(name) {
    if (!this.has(name)) return false;
    delete this.presets[name];
    this._write();
    return true;
  }

  reset() {
    applySettings(structuredClone(DEFAULT_SETTINGS));
  }

  /** Trigger a download of the current settings (or a named preset). */
  exportJSON(name = null) {
    const data = name && this.has(name) ? this.presets[name] : snapshotSettings();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${(name ?? 'frost-settings').replace(/\s+/g, '-').toLowerCase()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  /** Export every stored preset in one file. */
  exportAll() {
    const blob = new Blob([JSON.stringify(this.presets, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'frost-presets.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  _rememberSkillManifest(data) {
    globalThis.__neonLastSkillManifest = data;
    try {
      sessionStorage.setItem('neon.lastSkillManifest', JSON.stringify(data));
    } catch {
      // A private/restricted storage context should not block the import.
    }
    globalThis.dispatchEvent?.(new CustomEvent('neon:skill-manifest-import', {
      detail: data,
    }));
  }

  async _uploadSkillData(data, originalName) {
    const validation = validateSkillManifest(data);
    if (!validation.valid) return { uploaded: false, valid: false, validation };
    const base = String(data.id || originalName.replace(/\.json$/i, '')).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    const filename = /\.(?:skill|ability)\.json$/i.test(originalName) ? originalName : `${base}.skill.json`;
    try {
      const response = await fetch(`${UPLOAD_API}/upload/${encodeURIComponent(filename)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      let result = {};
      try { result = await response.json(); } catch { /* server may return plain text */ }
      if (!response.ok) {
        return { uploaded: false, valid: false, validation: result.validation || validation, error: result.error || `HTTP ${response.status}` };
      }
      this._rememberSkillManifest(data);
      return { uploaded: true, valid: true, filename, validation: result.validation || validation, skillManifest: data.label || data.id || 'unnamed skill' };
    } catch (error) {
      return { uploaded: false, valid: false, errors: [{ path: '$', message: error.message || String(error) }] };
    }
  }

  /** Upload a validated skill/ability manifest selected by the user. */
  uploadSkillFromFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.skill.json,.ability.json,application/json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return resolve({ uploaded: false, valid: false, cancelled: true });
        try {
          resolve(await this._uploadSkillData(JSON.parse(await file.text()), file.name));
        } catch (error) {
          resolve({ uploaded: false, valid: false, errors: [{ path: '$', message: error.message || String(error) }] });
        }
      };
      input.click();
    });
  }

  /** Upload the checked-in Prism Burst sample without opening a file picker. */
  async uploadSampleSkill() {
    try {
      const response = await fetch('examples/skills/prism-burst.ability.json', { cache: 'no-store' });
      if (!response.ok) return { uploaded: false, valid: false, error: `sample HTTP ${response.status}` };
      return this._uploadSkillData(await response.json(), 'prism-burst.ability.json');
    } catch (error) {
      return { uploaded: false, valid: false, error: error.message || String(error) };
    }
  }

  /**
   * Import from a JSON file chosen by the user.
   * Accepts either a single settings snapshot or a map of presets.
   * @returns {Promise<{ imported: string[], applied: boolean, skillManifest?: string, validation?: object }>}
   */
  importFromFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return resolve({ imported: [], applied: false });
        try {
          const data = JSON.parse(await file.text());
          // Skill and ability manifests are contracts, not settings snapshots.
          // Validate them and surface them to the combined Hero Studio instead
          // of silently treating every manifest field as a named preset.
          if (data && isSupportedManifestKind(data.kind)) {
            const validation = validateSkillManifest(data);
            if (!validation.valid) {
              resolve({ imported: [], applied: false, validation });
              return;
            }
            this._rememberSkillManifest(data);
            resolve({ imported: [], applied: false, validation, skillManifest: data.label || data.id || 'unnamed skill' });
            return;
          }
          // A settings snapshot always has a `global` block; anything else is
          // treated as a preset collection.
          if (data && data.global && data.ice) {
            applySettings(data);
            resolve({ imported: [], applied: true });
          } else {
            const names = [];
            for (const [name, preset] of Object.entries(data)) {
              if (preset && typeof preset === 'object') {
                this.presets[name] = preset;
                names.push(name);
              }
            }
            this._write();
            resolve({ imported: names, applied: false });
          }
        } catch (error) {
          console.error('[PresetManager] import failed', error);
          resolve({ imported: [], applied: false });
        }
      };
      input.click();
    });
  }

  /** Current live settings, for callers that want to inspect them. */
  get current() {
    return settings;
  }
}
