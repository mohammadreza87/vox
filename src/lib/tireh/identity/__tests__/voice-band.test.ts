import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MIN_NET_SPEECH_MS } from '../voice-band';

describe('shared voice-band contract', () => {
  it('is byte-identical to the S10L/S11L contract file', () => {
    const bytes = readFileSync(join(process.cwd(), 'src/lib/tireh/identity/voice-band.ts'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('b8d0a41d69e38129c3b47b4450194133e3a90b075dbc54c55c775b03e88421bd');
  });

  it('requires 3 s of net speech', () => {
    expect(MIN_NET_SPEECH_MS).toBe(3000);
  });
});
