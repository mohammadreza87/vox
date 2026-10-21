/**
 * Telegram PhotoSize selection (S12). Telegram sends several re-encoded sizes
 * of every photo; Vox downloads the smallest one that is large enough for the
 * job, never the original.
 */

import type { TelegramPhotoSize } from '../telegram/client';

/** Minimum longest edge per use: triage (low), an ordinary reply, and text-heavy images. */
export const IMAGE_MIN_EDGE = { low: 320, standard: 800, detail: 1092 } as const;
export type ImageDetail = keyof typeof IMAGE_MIN_EDGE;

const dimension = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;

function valid(size: TelegramPhotoSize | null | undefined): size is TelegramPhotoSize {
  return !!size && typeof size.file_id === 'string' && size.file_id.length > 0 && dimension(size.width) && dimension(size.height);
}

const edge = (size: TelegramPhotoSize): number => Math.max(size.width, size.height);
const knownSize = (size: TelegramPhotoSize): number =>
  typeof size.file_size === 'number' && Number.isFinite(size.file_size) ? size.file_size : Number.POSITIVE_INFINITY;

/**
 * The smallest size whose longest edge reaches `minEdge` (ties: the smaller
 * known file size, then array order). When none reaches it, the largest size,
 * so a small image is still usable. Null for empty or all-invalid input.
 * Pure: the input is never mutated.
 */
export function pickPhotoSize(sizes: readonly TelegramPhotoSize[], minEdge: number = IMAGE_MIN_EDGE.low): TelegramPhotoSize | null {
  if (!Array.isArray(sizes)) return null;
  const candidates = sizes.filter(valid);
  if (!candidates.length) return null;
  let best: TelegramPhotoSize | null = null;
  for (const size of candidates) {
    if (edge(size) < minEdge) continue;
    if (!best || edge(size) < edge(best) || (edge(size) === edge(best) && knownSize(size) < knownSize(best))) best = size;
  }
  if (best) return best;
  let largest = candidates[0];
  for (const size of candidates) if (edge(size) > edge(largest)) largest = size;
  return largest;
}
