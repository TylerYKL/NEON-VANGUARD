/* ============================================================
   BALANCE — every number worth arguing about, in one place.
   The dev overlay (backtick) edits this live; `Export` prints
   JSON you can paste straight back into this file.
   ============================================================ */

export const BALANCE = {
  combat: {
    critChance: 0.12,
    critMul: 1.9,
    comboDecay: 2.5,
    comboStep: 0.2,
    comboMax: 8,
    reviveBase: 12,
    reviveMax: 20,
    hitStopMax: 0.10,
  },
  economy: {
    coreNeed: 16,
    shardSelf: 24,
    shardOther: 11,
    shardChanceChaff: 0.30,
    shardChanceElite: 0.55,
    killEnergy: 6,
    dmgEnergy: 0.055,
    takenEnergy: 0.18,
    waveBonus: 500,
    skipBonus: 300,
    waveHeal: 0.25,
    waveEnergy: 25,
  },
  scaling: {
    countStep: 0.12,
    hpStep: 0.09,
    dmgStep: 0.055,
    eliteStep: 0.055,
    eliteMax: 0.34,
    eliteFromWave: 4,
    maxAlive: 45,
    spawnGapMin: 0.18,
    spawnGapMax: 0.55,
  },
  hazard: {
    fromWave: 6,
    baseGap: 8.5,
    gapStep: 0.28,
    minGap: 4.2,
    warn: 1.4,
    zap: 0.9,
    heroDps: 30,
    enemyDps: 46,
    radMin: 3.8,
    radMax: 5.4,
  },
  chain: {
    window: 6.5,
    mul2: 1.45,
    mul3: 2.0,
    overdriveTime: 2.6,
    overdriveScale: 0.28,
    trinityShield: 160,
    trinityDmg: 260,
  },
  dash: { iframe: 0.20, cooldown: 1.5, duration: 0.18, dodgeEnergy: 5 },
  heroes: {
    aegis: { hp: 340, speed: 7.6, armor: 0.35 },
    lyra: { hp: 220, speed: 8.3, armor: 0.05 },
    nyx: { hp: 195, speed: 8.7, armor: 0 },
  },
  // Point-light pool sizes. These are the HARD CAP on simultaneous point
  // lights of each kind — see src/lights.js. The count must stay constant
  // during play: three.js keys its shader programs on the light count, so
  // raising or lowering this at runtime recompiles every material once.
  perf: {
    lightsEnemy: 8,
    lightsPickup: 4,
    lightsEffect: 4,
  },
  enemies: {
    skitter: { hp: 55, speed: 10.5, dmg: 9, cd: 1.9, tell: 0.38 },
    brute: { hp: 210, speed: 6.2, dmg: 22, cd: 1.5, tell: 0.5 },
    charger: { hp: 150, speed: 10.8, dmg: 28, cd: 2.2, tell: 0.62 },
    sentinel: { hp: 130, speed: 3.4, dmg: 15, cd: 2.6, tell: 0.55 },
    warden: { hp: 185, speed: 2.6, dmg: 24, cd: 3.4, tell: 0.75 },
    juggernaut: { hp: 2600, speed: 4.6, dmg: 38, cd: 2.0, tell: 0.85 },
  },
};

/** [min, max, step] per key, for the tuning sliders */
export const RANGES = {
  critChance: [0, 1, 0.01], critMul: [1, 5, 0.1], comboDecay: [0.5, 8, 0.1],
  comboStep: [0, 1, 0.05], comboMax: [1, 20, 1],
  reviveBase: [2, 40, 1], reviveMax: [2, 60, 1], hitStopMax: [0, 0.3, 0.005],
  coreNeed: [4, 40, 1], shardSelf: [0, 100, 1], shardOther: [0, 100, 1],
  shardChanceChaff: [0, 1, 0.05], shardChanceElite: [0, 1, 0.05],
  killEnergy: [0, 40, 1], dmgEnergy: [0, 0.4, 0.005], takenEnergy: [0, 1, 0.01],
  waveBonus: [0, 3000, 50], skipBonus: [0, 2000, 50], waveHeal: [0, 1, 0.05], waveEnergy: [0, 100, 5],
  countStep: [0, 0.6, 0.01], hpStep: [0, 0.4, 0.005], dmgStep: [0, 0.3, 0.005],
  eliteStep: [0, 0.2, 0.005], eliteMax: [0, 1, 0.02], eliteFromWave: [1, 20, 1],
  maxAlive: [10, 120, 5], spawnGapMin: [0.05, 2, 0.05], spawnGapMax: [0.1, 4, 0.05],
  fromWave: [1, 20, 1], baseGap: [1, 20, 0.5], gapStep: [0, 1, 0.02], minGap: [1, 15, 0.2],
  warn: [0.2, 4, 0.1], zap: [0.2, 4, 0.1], heroDps: [0, 120, 2], enemyDps: [0, 200, 2],
  radMin: [1, 12, 0.2], radMax: [1, 16, 0.2],
  window: [1, 20, 0.5], mul2: [1, 4, 0.05], mul3: [1, 6, 0.05],
  overdriveTime: [0.5, 8, 0.1], overdriveScale: [0.05, 1, 0.01],
  trinityShield: [0, 500, 10], trinityDmg: [0, 900, 10],
  iframe: [0, 1, 0.02], cooldown: [0.2, 6, 0.1], duration: [0.05, 1, 0.01], dodgeEnergy: [0, 40, 1],
  hp: [10, 4000, 5], speed: [0.5, 20, 0.1], armor: [0, 0.9, 0.01],
  dmg: [1, 200, 1], cd: [0.2, 8, 0.1], tell: [0, 3, 0.05],
  lightsEnemy: [0, 45, 1], lightsPickup: [0, 24, 1], lightsEffect: [0, 12, 1],
};

const DEFAULTS = JSON.parse(JSON.stringify(BALANCE));

export function resetBalance() {
  const fresh = JSON.parse(JSON.stringify(DEFAULTS));
  for (const k of Object.keys(fresh)) BALANCE[k] = fresh[k];
  return BALANCE;
}

export function exportBalance() { return JSON.stringify(BALANCE, null, 2); }

export function importBalance(json) {
  const o = typeof json === 'string' ? JSON.parse(json) : json;
  for (const g of Object.keys(o)) {
    if (!BALANCE[g]) continue;
    for (const k of Object.keys(o[g])) {
      if (typeof BALANCE[g][k] === 'object') Object.assign(BALANCE[g][k], o[g][k]);
      else BALANCE[g][k] = o[g][k];
    }
  }
  return BALANCE;
}

/** push BALANCE into the live definition tables */
export function applyBalance(HERO_DEFS, ENEMY_TYPES) {
  for (const d of HERO_DEFS) {
    const b = BALANCE.heroes[d.id];
    if (!b) continue;
    d.hp = b.hp; d.speed = b.speed; d.armor = b.armor;
  }
  for (const [k, b] of Object.entries(BALANCE.enemies)) {
    const T = ENEMY_TYPES[k];
    if (!T) continue;
    T.hp = b.hp; T.speed = b.speed; T.dmg = b.dmg; T.cd = b.cd; T.tell = b.tell;
  }
}
