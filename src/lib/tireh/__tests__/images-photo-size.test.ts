import { describe, expect, it } from 'vitest';
import { IMAGE_MIN_EDGE, pickPhotoSize } from '../images';
import type { TelegramPhotoSize } from '../telegram/client';
import { photoSizes } from './images-fixtures';

const size = (file_id: string, width: number, height: number, file_size?: number): TelegramPhotoSize =>
  ({ file_id, width, height, ...(file_size !== undefined ? { file_size } : {}) });

describe('pickPhotoSize', () => {
  it('uses the documented minimum edges', () => {
    expect(IMAGE_MIN_EDGE).toEqual({ low: 320, standard: 800, detail: 1092 });
  });

  it('picks the smallest size whose longest edge is at least 320 px', () => {
    expect(pickPhotoSize(photoSizes())?.file_id).toBe('photo-320');
  });

  it('measures the longest edge of portrait photos', () => {
    expect(pickPhotoSize([size('a', 67, 90), size('b', 240, 320)])?.file_id).toBe('b');
  });

  it('honours larger minimum edges', () => {
    expect(pickPhotoSize(photoSizes(), 800)?.file_id).toBe('photo-800');
    expect(pickPhotoSize(photoSizes(), IMAGE_MIN_EDGE.detail)?.file_id).toBe('photo-1280');
  });

  it('falls back to the largest size when none reaches the minimum', () => {
    expect(pickPhotoSize([size('a', 90, 90), size('b', 200, 150)])?.file_id).toBe('b');
  });

  it('returns null for empty or all-invalid input and skips invalid entries', () => {
    expect(pickPhotoSize([])).toBeNull();
    const invalid = [size('zero', 0, 400), size('nan', 400, Number.NaN), size('', 400, 400)];
    expect(pickPhotoSize(invalid)).toBeNull();
    expect(pickPhotoSize([...invalid, size('ok', 400, 300)])?.file_id).toBe('ok');
    expect(pickPhotoSize([size('fraction', 400.5, 300), size('ok', 500, 300)])?.file_id).toBe('ok');
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
