/**
 * The anticipated idle hop: the one engine motion that ships in the core chunk. The rest (room transitions,
 * room idles and reactions, growth moments, the settle float, the unlockable moves) load lazily: reactions/rooms.ts.
 */

import type { Beat } from '../types';
import { beat, end } from './util';

/** The happy idle hop, anticipated: a crouch, a 3 px hop, round again. */
export function hopIdle(): Beat[] {
  return end([beat(0, { sy: 0.965 }, 'snap'), beat(85, { sy: 1.025 }, 'snap', { hop: { h: 3, land: 0.06 } }), beat(240, { sy: 1 }, 'pop')], 'jelly');
}
