// Main's earlier S12 lineage (d99e3a5) cases that pass against the chosen wave A image module; the rest are recorded in WAVE_A_MAIN_INTEGRATION.md (S12).
import { describe, expect, it } from 'vitest';
import { pickPhotoSize } from '../images';
import type { TelegramPhotoSize } from '../telegram/client';
import { photoSizes } from './images-main-lineage-fixtures';

const size = (file_id: string, width: number, height: number, file_size?: number): TelegramPhotoSize =>
  ({ file_id, width, height, ...(file_size !== undefined ? { file_size } : {}) });

describe('pickPhotoSize', () => {

  it('picks the smallest size whose longest edge is at least 320 px', () => {
    expect(pickPhotoSize(photoSizes())?.file_id).toBe('photo-320');
  });

  it('measures the longest edge of portrait photos', () => {
    expect(pickPhotoSize([size('a', 67, 90), size('b', 240, 320)])?.file_id).toBe('b');
  });

  it('falls back to the largest size when none reaches the minimum', () => {
    expect(pickPhotoSize([size('a', 90, 90), size('b', 200, 150)])?.file_id).toBe('b');
  });

  it('breaks edge ties by the smaller known file size, then array order', () => {
    expect(pickPhotoSize([size('big', 320, 240, 9_000), size('small', 240, 320, 5_000)])?.file_id).toBe('small');
    expect(pickPhotoSize([size('unknown', 320, 240), size('known', 320, 200, 5_000)])?.file_id).toBe('known');
    expect(pickPhotoSize([size('first', 320, 240), size('second', 320, 240)])?.file_id).toBe('first');
  });

  it('never mutates its input', () => {
    const sizes = photoSizes().reverse();
    const before = JSON.stringify(sizes);
    pickPhotoSize(sizes);
    pickPhotoSize(sizes, 5000);
    expect(JSON.stringify(sizes)).toBe(before);
  });
});
