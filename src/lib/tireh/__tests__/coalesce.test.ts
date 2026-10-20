import { describe, expect, it } from 'vitest';
import { coalesceDeltas } from '../conversation/coalesce';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function collect(source: AsyncIterable<string>): Promise<string[]> { const out: string[] = []; for await (const part of source) out.push(part); return out; }

describe('coalesceDeltas', () => {
  it('passes the first delta at once, merges the rest by sentence, and preserves the text', async () => {
    async function* deltas() { yield 'Hel'; yield 'lo'; yield ' there'; yield '.'; yield ' How'; yield ' are'; yield ' you?'; }
    const parts = await collect(coalesceDeltas(deltas(), 1_000));
    expect(parts).toEqual(['Hel', 'lo there.', ' How are you?']);
    expect(parts.join('')).toBe('Hello there. How are you?');
  });

  it('flushes held text once its oldest part reaches the window, without waiting for the next delta', async () => {
    const seen: Array<{ part: string; at: number }> = [];
    const started = performance.now();
    async function* deltas() { yield 'First'; yield ' held'; await sleep(250); yield ' later'; }
    for await (const part of coalesceDeltas(deltas(), 50)) seen.push({ part, at: performance.now() - started });
    expect(seen.map(s => s.part)).toEqual(['First', ' held', ' later']);
    expect(seen[1].at).toBeLessThan(200);
  });

  it('closes the source when the consumer stops', async () => {
    let closed = false;
    async function* deltas() { try { yield 'One.'; yield 'Two.'; yield 'Three.'; } finally { closed = true; } }
    for await (const part of coalesceDeltas(deltas())) { if (part === 'One.') break; }
    await sleep(0);
    expect(closed).toBe(true);
  });

  it('propagates a source failure to the consumer', async () => {
    async function* deltas(): AsyncGenerator<string> { yield 'Partial'; throw new Error('provider failed'); }
    const parts: string[] = [];
    await expect((async () => { for await (const part of coalesceDeltas(deltas())) parts.push(part); })()).rejects.toThrow('provider failed');
    expect(parts).toEqual(['Partial']);
  });
});
