import { describe, expect, it } from 'vitest';
import { pickPhotoSize, replyPhotoSize, type ImageTriage } from '../images';
import type { TelegramPhotoSize } from '../telegram/client';

const size = (width: number, height: number, extra: Partial<TelegramPhotoSize> = {}): TelegramPhotoSize => ({ file_id: `f-${width}x${height}`, width, height, ...extra });
const ladder = [size(90, 67), size(320, 240), size(800, 600), size(1280, 960)];
const triage = (patch: Partial<ImageTriage>): ImageTriage => ({ kind: 'other', task: 'react', containsPeople: 0, containsSensitiveDocument: 0, ...patch });

describe('pickPhotoSize', () => {
  it('returns null for no sizes', () => {
    expect(pickPhotoSize([])).toBeNull();
  });

  it('picks the smallest size whose longest edge is at least 320', () => {
    expect(pickPhotoSize(ladder)).toEqual(size(320, 240));
  });

  it('uses the longest edge for portrait images', () => {
    expect(pickPhotoSize([size(240, 320), size(600, 800)])).toEqual(size(240, 320));
  });

  it('falls back to the largest when every size is below the minimum', () => {
    expect(pickPhotoSize([size(90, 67), size(200, 150), size(160, 120)])).toEqual(size(200, 150));
  });

  it('ignores invalid entries', () => {
    const invalid = [
      { width: 400, height: 300 } as TelegramPhotoSize,
      size(0, 500), size(Number.NaN, 400), size(400, Number.POSITIVE_INFINITY), size(-5, 600), { ...size(330, 200), file_id: '' },
    ];
    expect(pickPhotoSize([...invalid, size(640, 480)])).toEqual(size(640, 480));
    expect(pickPhotoSize(invalid)).toBeNull();
  });

  it('breaks ties by file_size and then by order', () => {
    const a = size(320, 240, { file_id: 'a', file_size: 9000 });
    const b = size(240, 320, { file_id: 'b', file_size: 4000 });
    const c = size(320, 200, { file_id: 'c', file_size: 4000 });
    expect(pickPhotoSize([a, b, c])?.file_id).toBe('b');
    expect(pickPhotoSize([c, b])?.file_id).toBe('c');
    expect(pickPhotoSize([size(320, 240, { file_id: 'x' }), size(320, 240, { file_id: 'y' })])?.file_id).toBe('x');
  });

  it('honours a custom minimum edge', () => {
    expect(pickPhotoSize(ladder, 1024)).toEqual(size(1280, 960));
    expect(pickPhotoSize(ladder.slice(0, 3), 1024)).toEqual(size(800, 600));
  });
});

describe('replyPhotoSize', () => {
  it('uses 1024 px for unknown triage, text extraction and text-heavy kinds', () => {
    const big = size(1280, 960);
    expect(replyPhotoSize(ladder, null)).toEqual(big);
    expect(replyPhotoSize(ladder, triage({ task: 'extract_text', kind: 'photo_of_people' }))).toEqual(big);
    for (const kind of ['document', 'receipt', 'screenshot', 'chart'] as const) {
      expect(replyPhotoSize(ladder, triage({ kind, task: 'react' }))).toEqual(big);
    }
  });

  it('uses 640 px for other images', () => {
    expect(replyPhotoSize(ladder, triage({ kind: 'photo_of_people', task: 'react' }))).toEqual(size(800, 600));
    expect(replyPhotoSize(ladder, triage({ kind: 'meme', task: 'explain' }))).toEqual(size(800, 600));
  });
});
