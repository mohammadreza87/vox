/**
 * Back-compat shim: the character library (./character) is the one source of
 * the cloud's shapes and colours. The Telegram profile photo is the stage-4
 * character on the dark halo, circle-fitted.
 */

import type { AgentLook } from './types';
import { characterSvg } from './character/svg';

export { FAMILIES } from './character/geometry';
export { PALETTE } from './character/palette';

/** The still profile photo (SVG): the fully formed character on the Studio halo. */
export function cloudSvg(look: Pick<AgentLook, 'hue' | 'family' | 'features'> & Partial<AgentLook>, size = 640): string {
  return characterSvg(look, { stage: 4, size, bg: 'halo', fit: 'circle' });
}
