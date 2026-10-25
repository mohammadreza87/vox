import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { MIN_NET_SPEECH_MS } from '../voice-band';

describe('shared voice-band contract file', () => {
  it('is byte-identical to the shared contract (S10L and S11L)', () => {
    const bytes = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../voice-band.ts'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('b8d0a41d69e38129c3b47b4450194133e3a90b075dbc54c55c775b03e88421bd');
    expect(MIN_NET_SPEECH_MS).toBe(3000);
  });
});
