import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Vector3,
  MathUtils,
} from 'three';
import { ELEMENTS, ELEMENT_META, settings } from '../config/settings.js';

/** The beta bench deliberately uses the same target menu as the legacy CAST SIM. */
export const BETA_SIM_TARGETS = Object.freeze([0, 3, 6, 9, 12]);
export const BETA_SIM_SPEEDS = Object.freeze([1, 0.5, 0.25]);

/**
 * Small, reference-runtime CAST SIM for Hero Studio (Beta).
 *
 * This is not a second ability implementation. It calls the same
 * AbilityManager.cast path as a live click, uses the real character cast clip
 * and lunge, and lets App keep ownership of the frame/update order. The target
 * markers are visual stage dressing only: the beta reference abilities are VFX
 * casts and do not own gameplay damage or enemy state.
 */
export class BetaCastSim {
  constructor(app) {
    this.app = app;
    this.scene = app.scene;
    this.group = new Group();
    this.group.name = 'BetaCastSimTargets';
    this.scene.add(this.group);

    this.enabled = false;
    this.auto = false;
    this.speed = 1;
    this.targets = 3;
    this.distance = 10;
    this.casts = 0;
    this.last = 'bench off · enable to stage a cast';
    this._nextAuto = 0;
    this._pool = [];
    this._forward = new Vector3();
    this._right = new Vector3();
    this._center = new Vector3();
    this._buildTargetPool(Math.max(...BETA_SIM_TARGETS));
    this._layoutTargets();
  }

  get timeScale() {
    return this.enabled ? this.speed : 1;
  }

  get status() {
    if (!this.enabled) return this.last;
    const label = ELEMENT_META[this.app.element]?.label || this.app.element;
    const mode = this.auto ? 'auto' : 'ready';
    return `${mode} · ${label} · ${this.targets} visual targets · ${this.casts} casts`;
  }

  _buildTargetPool(count) {
    const ringGeometry = new RingGeometry(0.32, 0.42, 24);
    const markerGeometry = new CylinderGeometry(0.025, 0.07, 0.18, 6);
    const colors = ['#50dcff', '#b56cff', '#ffb45e', '#8fffc4'];

    for (let i = 0; i < count; i++) {
      const target = new Group();
      target.name = `BetaSimTarget${i + 1}`;
      const color = new Color(colors[i % colors.length]);
      const ring = new Mesh(
        ringGeometry,
        new MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
          blending: AdditiveBlending,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.012;
      const marker = new Mesh(
        markerGeometry,
        new MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.48,
          depthWrite: false,
          blending: AdditiveBlending,
        })
      );
      marker.position.y = 0.1;
      target.add(ring, marker);
      target.userData.baseScale = 1;
      target.visible = false;
      this.group.add(target);
      this._pool.push(target);
    }
  }

  _layoutTargets() {
    const character = this.app.character;
    if (!character) return;

    const yaw = character.facing;
    this._forward.set(Math.sin(yaw), 0, Math.cos(yaw));
    this._right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    this._center.copy(character.position).addScaledVector(this._forward, this.distance);

    const half = (this.targets - 1) * 0.62;
    for (let i = 0; i < this._pool.length; i++) {
      const target = this._pool[i];
      const visible = this.enabled && i < this.targets;
      target.visible = visible;
      if (!visible) continue;
      const across = i - half;
      target.position.copy(this._center).addScaledVector(this._right, across);
      target.position.y = 0;
      const pulse = 1 + Math.sin(this.app.elapsed * 3 + i * 0.7) * 0.06;
      target.scale.setScalar(pulse);
    }
  }

  setEnabled(value) {
    const next = !!value;
    if (next === this.enabled) return;
    this.enabled = next;
    if (!next) {
      this.auto = false;
      this.last = 'bench off · effects cleared';
      this.app.clearEffects();
    } else {
      this.last = 'bench ready · cast the selected reference ability';
    }
    this._layoutTargets();
  }

  setAuto(value) {
    this.auto = !!value && this.enabled;
    this._nextAuto = this.app.elapsed + 0.2;
  }

  setSpeed(value) {
    const numeric = Number(value);
    this.speed = BETA_SIM_SPEEDS.includes(numeric) ? numeric : 1;
  }

  setTargets(value) {
    const numeric = Number(value);
    this.targets = BETA_SIM_TARGETS.includes(numeric) ? numeric : 3;
    this._layoutTargets();
  }

  setDistance(value) {
    const numeric = Number(value);
    this.distance = Number.isFinite(numeric) ? MathUtils.clamp(numeric, 2, 24) : 10;
    this._layoutTargets();
  }

  /** Cast one reference ability without requiring a pointer or mouse click. */
  cast(element = this.app.element) {
    if (!this.enabled || !ELEMENTS.includes(element)) return null;

    const character = this.app.character;
    const config = settings[element];
    const yaw = character.facing;
    const origin = character.position.clone();
    const direction = this._forward.set(Math.sin(yaw), 0, Math.cos(yaw)).clone();
    const distance = MathUtils.clamp(
      this.distance,
      Math.max(0.2, config.minRange ?? 0),
      Math.max(0.4, config.range ?? this.distance)
    );

    this.app.aim.cancel();
    this.app.selectAbility(element, { silent: true });
    const ability = this.app.abilities.cast(origin, direction, distance, element);
    if (!ability) return null;

    // A bench cast is forced: it is for inspecting a phase stack, not waiting
    // through the match cooldown while tuning the effect.
    this.app.cooldowns.set(element, 0);
    character.setFacing(yaw);
    character.playCast(config.castAnim);
    character.castLunge();

    this.casts++;
    this.last = `${ELEMENT_META[element]?.label || element} cast · ${this.targets} visual targets`;
    this._nextAuto = this.app.elapsed + 0.45;
    return ability;
  }

  update() {
    this._layoutTargets();
    if (!this.enabled || !this.auto || this.app.abilities.active.length || this.app.elapsed < this._nextAuto) return;
    this.cast(this.app.element);
  }

  reset() {
    this.app.clearEffects();
    this.auto = false;
    this.casts = 0;
    this.last = this.enabled ? 'bench reset · ready' : 'bench off · enable to stage a cast';
    this._layoutTargets();
  }

  afterClear() {
    if (this.enabled) this.last = 'effects cleared · bench ready';
  }

  dispose() {
    this.enabled = false;
    this.auto = false;
    for (const target of this._pool) {
      target.children.forEach((child) => {
        child.geometry?.dispose();
        child.material?.dispose();
      });
    }
    this.scene.remove(this.group);
    this._pool.length = 0;
  }
}
