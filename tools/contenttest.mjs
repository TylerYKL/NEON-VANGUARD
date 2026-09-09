/* Content contract test: the reusable layout set and new enemy variants are
   data-valid before a browser pass exercises their visuals. */
import { ARENA_LAYOUTS } from '../src/world.js';
import { ENEMY_TYPES } from '../src/entities.js';

const check = (name, value) => {
  if (!value) throw new Error('FAIL ' + name);
  console.log('PASS  ' + name);
};
const layouts = Object.values(ARENA_LAYOUTS);
check('three arena layouts are registered', layouts.length === 3);
for (const [key, layout] of Object.entries(ARENA_LAYOUTS)) {
  check(key + ' has a full cover layout', layout.pylons.length === 10);
  check(key + ' has distinct floor colours', layout.accent !== layout.accent2);
}
check('charger enemy variant is registered', !!ENEMY_TYPES.charger && !ENEMY_TYPES.charger.ranged);
check('warden enemy variant is registered', !!ENEMY_TYPES.warden && ENEMY_TYPES.warden.ranged);
check('all content enemies have telegraph timings', Object.values(ENEMY_TYPES).every((t) => t.tell > 0 && t.tellR > 0));
console.log('\nERRORS none  (content contract passed)');
