/* ============================================================
   IMPLANTS — the between-wave upgrade draft.
   Every entry writes into G.mods, which gameplay code reads.
   Keep effects wired to a real call site; no dead stats.
   ============================================================ */

export const MOD_DEFAULTS = {
  dmg: 1,            // outgoing hero damage
  armor: 0,          // flat damage reduction on top of the hero's own
  speed: 0,          // additive move-speed fraction
  cdr: 0,            // cooldown reduction fraction
  energy: 1,         // ult charge gain multiplier
  magnet: 1,         // pickup magnet radius multiplier
  chainWindow: 1,    // ultimate chain duration multiplier
  coreNeed: 0,       // reduces kills required per Charge Core
  critChance: 0.12,  // base crit
  critMul: 1.9,
  lifesteal: 0,      // fraction of damage dealt returned as healing
  dodgeBuff: 0,      // seconds of +40% damage after a clean dodge
  hazardBoost: 1,    // hazard damage to enemies
  shardValue: 1,     // charge from shards
  // hero-specific switches
  fistCleave: 0,     // Ion Fist finisher cleave radius bonus
  slamStun: 0,       // extra Seismic Slam stun seconds
  domeReflect: 0,    // Bastion Field returns damage to nearby hostiles
  bloomSlow: 0,      // Bloom Field slow strength
  lockRange: 0,      // Lyra repair-lock radius bonus
  phoenixShield: 1,  // Phoenix overshield multiplier
  railRefund: 0,     // Railshot cooldown refunded per kill
  swarmExtra: 0,     // extra swarm missiles
  singularityR: 1,   // Singularity radius multiplier
};

const C = { common: '#7cf9ff', rare: '#ffb14a', epic: '#ff3df0' };

export const UPGRADES = [
  /* ---------- squad-wide ---------- */
  { id: 'oc', name: 'OVERCLOCK', rarity: 'common', max: 4, icon: '\u25C6',
    desc: '+12% damage for the whole squad.',
    apply: (m) => { m.dmg += 0.12; } },
  { id: 'plate', name: 'ABLATIVE PLATING', rarity: 'common', max: 4, icon: '\u25A3',
    desc: '+8% damage reduction for everyone.',
    apply: (m) => { m.armor += 0.08; } },
  { id: 'servo', name: 'SERVO BOOST', rarity: 'common', max: 3, icon: '\u25B6',
    desc: '+10% move speed.',
    apply: (m) => { m.speed += 0.10; } },
  { id: 'coolant', name: 'CRYO COOLANT', rarity: 'rare', max: 3, icon: '\u2744',
    desc: '\u221215% ability cooldowns.',
    apply: (m) => { m.cdr = Math.min(0.55, m.cdr + 0.15); } },
  { id: 'cap', name: 'CAPACITOR BANK', rarity: 'rare', max: 3, icon: '\u26A1',
    desc: '+25% ultimate charge rate.',
    apply: (m) => { m.energy += 0.25; } },
  { id: 'magnet', name: 'GRAVITY WELL', rarity: 'common', max: 2, icon: '\u25CE',
    desc: 'Double pickup magnet range, +40% shard value.',
    apply: (m) => { m.magnet += 1; m.shardValue += 0.4; } },
  { id: 'crit', name: 'WEAK-POINT SCANNER', rarity: 'rare', max: 3, icon: '\u2732',
    desc: '+10% crit chance, +0.3\u00D7 crit damage.',
    apply: (m) => { m.critChance += 0.10; m.critMul += 0.3; } },
  { id: 'vamp', name: 'NANITE SIPHON', rarity: 'epic', max: 2, icon: '\u2695',
    desc: '4% of damage dealt is returned as healing to the squad.',
    apply: (m) => { m.lifesteal += 0.04; } },

  /* ---------- mechanic upgrades ---------- */
  { id: 'chain', name: 'SYNC PROTOCOL', rarity: 'epic', max: 2, icon: '\u221E',
    desc: 'Ultimate chain window +45%. Chaining is far easier to land.',
    apply: (m) => { m.chainWindow += 0.45; } },
  { id: 'core', name: 'CORE RECYCLER', rarity: 'rare', max: 3, icon: '\u2b21',
    desc: 'Charge Cores drop 3 kills sooner.',
    apply: (m) => { m.coreNeed += 3; } },
  { id: 'dodge', name: 'REFLEX WEAVE', rarity: 'rare', max: 2, icon: '\u21AF',
    desc: 'A clean dodge grants +40% damage for 3s.',
    apply: (m) => { m.dodgeBuff += 3; } },
  { id: 'grid', name: 'GRID TAP', rarity: 'rare', max: 2, icon: '\u2261',
    desc: 'Arena discharges deal +80% damage to hostiles.',
    apply: (m) => { m.hazardBoost += 0.8; } },

  /* ---------- AEGIS ---------- */
  { id: 'fist', name: 'SHOCK KNUCKLES', hero: 'aegis', rarity: 'rare', max: 2, icon: '\u2726',
    desc: 'AEGIS: Ion Fist finisher cleaves 3m wider.',
    apply: (m) => { m.fistCleave += 3; } },
  { id: 'slam', name: 'CONCUSSIVE CHARGE', hero: 'aegis', rarity: 'rare', max: 2, icon: '\u25BC',
    desc: 'AEGIS: Seismic Slam stuns 1s longer.',
    apply: (m) => { m.slamStun += 1; } },
  { id: 'dome', name: 'MIRROR LATTICE', hero: 'aegis', rarity: 'epic', max: 1, icon: '\u25CB',
    desc: 'AEGIS: Bastion Field burns hostiles that touch it for 45/s.',
    apply: (m) => { m.domeReflect += 45; } },

  /* ---------- LYRA ---------- */
  { id: 'bloom', name: 'VISCOUS NANITES', hero: 'lyra', rarity: 'rare', max: 2, icon: '\u2743',
    desc: 'LYRA: Bloom Field slows hostiles inside it by 45%.',
    apply: (m) => { m.bloomSlow += 0.45; } },
  { id: 'lock', name: 'WIDE-BAND EMITTER', hero: 'lyra', rarity: 'common', max: 2, icon: '\u25CC',
    desc: 'LYRA: repair-lock range +2m.',
    apply: (m) => { m.lockRange += 2; } },
  { id: 'phoenix', name: 'HARD REBOOT', hero: 'lyra', rarity: 'epic', max: 1, icon: '\u2605',
    desc: 'LYRA: Phoenix Protocol overshield \u00D71.8.',
    apply: (m) => { m.phoenixShield += 0.8; } },

  /* ---------- NYX ---------- */
  { id: 'rail', name: 'KINETIC RECLAIM', hero: 'nyx', rarity: 'rare', max: 2, icon: '\u27F6',
    desc: 'NYX: every Railshot kill refunds 1.2s of its cooldown.',
    apply: (m) => { m.railRefund += 1.2; } },
  { id: 'swarm', name: 'EXPANDED PODS', hero: 'nyx', rarity: 'common', max: 3, icon: '\u2059',
    desc: 'NYX: +5 swarm missiles.',
    apply: (m) => { m.swarmExtra += 5; } },
  { id: 'sing', name: 'EVENT HORIZON', hero: 'nyx', rarity: 'epic', max: 1, icon: '\u2b24',
    desc: 'NYX: Singularity radius \u00D71.5.',
    apply: (m) => { m.singularityR += 0.5; } },
];

export const RARITY_COLOR = C;

/** three distinct offers, weighted by rarity, respecting stack caps */
export function rollOffers(taken, n = 3, wave = 1) {
  const weight = { common: 60, rare: 30, epic: 12 };
  const pool = UPGRADES.filter((u) => (taken[u.id] || 0) < u.max);
  const out = [];
  const used = new Set();
  for (let i = 0; i < n && pool.length; i++) {
    const avail = pool.filter((u) => !used.has(u.id));
    if (!avail.length) break;
    let total = 0;
    for (const u of avail) total += weight[u.rarity];
    let r = Math.random() * total;
    let pick = avail[avail.length - 1];
    for (const u of avail) { r -= weight[u.rarity]; if (r <= 0) { pick = u; break; } }
    used.add(pick.id);
    out.push(pick);
  }
  // from wave 3, guarantee the draft is never three commons
  if (wave >= 3 && out.length === n && out.every((u) => u.rarity === 'common')) {
    const better = pool.filter((u) => u.rarity !== 'common' && !used.has(u.id));
    if (better.length) out[n - 1] = better[(Math.random() * better.length) | 0];
  }
  return out;
}
