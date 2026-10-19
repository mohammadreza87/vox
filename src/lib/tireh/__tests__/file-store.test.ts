import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createFileStores } from '../memory/file-store';

let dir = '';
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('createFileStores', () => {
  it('persists memories, offers and chat history across restarts, with dates', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tireh-'));
    const path = join(dir, 'state.json');

    const first = createFileStores(path);
    const memory = await first.memories.add({
      personaId: 'aria',
      content: 'Reza likes weekly demos',
      type: 'preference',
      scope: { kind: 'private', personId: 'reza' },
      sensitivity: 'normal',
      source: { personId: 'reza', chatKind: 'private', at: new Date('2026-10-19T10:00:00Z') },
      aboutPersonIds: ['reza'],
      confidence: 0.9,
    });
    const offer = await first.offers.create({ personaId: 'aria', memoryId: memory.id, ownerPersonId: 'reza', proposedScope: { kind: 'org' } });
    await first.history.append('aria', 'private-reza', { role: 'user', personId: 'reza', text: 'hi', at: new Date('2026-10-19T10:00:00Z') });
    expect(existsSync(path)).toBe(true);

    const second = createFileStores(path);
    const [loaded] = await second.memories.listActive('aria');
    expect(loaded.content).toBe('Reza likes weekly demos');
    expect(loaded.source.at).toBeInstanceOf(Date);
    expect(loaded.createdAt).toBeInstanceOf(Date);
    expect((await second.offers.get(offer.id))?.status).toBe('pending');
    const [message] = await second.history.recent('aria', 'private-reza', 5);
    expect(message.at.toISOString()).toBe('2026-10-19T10:00:00.000Z');

    await second.history.clearPersona('aria');
    expect(await createFileStores(path).history.recent('aria', 'private-reza', 5)).toEqual([]);
    await second.memories.delete(memory.id);
    expect(await createFileStores(path).memories.listActive('aria')).toEqual([]);
  });

  it('fences stale append/extraction across independent instances and preserves concurrent writes', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tireh-'));
    const path = join(dir, 'state.json');
    const first = createFileStores(path);
    const second = createFileStores(path);
    const epoch = await first.history.getEpoch('aria');
    const turn = { role: 'assistant' as const, text: 'old secret', at: new Date() };
    await first.history.append('aria', 'p', turn, epoch);
    await second.history.clearPersona('aria');
    await first.history.append('aria', 'p', turn, epoch);
    expect(await first.history.recent('aria', 'p', 10)).toEqual([]);
    const memory = {
      personaId: 'aria', content: 'stale extracted secret', type: 'fact' as const,
      scope: { kind: 'private' as const, personId: 'reza' }, sensitivity: 'normal' as const,
      source: { personId: 'reza', chatKind: 'private' as const, at: new Date() }, aboutPersonIds: [], confidence: .9,
    };
    expect(await first.memories.addIfEpoch(memory, epoch)).toBeNull();
    const nextEpoch = await first.history.getEpoch('aria');
    const added = await first.memories.addIfEpoch(memory, nextEpoch);
    expect(added).not.toBeNull();
    await Promise.all([first.history.append('aria', 'a', turn, nextEpoch), second.history.append('aria', 'b', turn, nextEpoch)]);
    const fresh = createFileStores(path);
    expect(await fresh.history.recent('aria', 'a', 10)).toHaveLength(1);
    expect(await fresh.history.recent('aria', 'b', 10)).toHaveLength(1);
    expect(await fresh.memories.listActive('aria')).toHaveLength(1);
  });

  it('starts empty when the file does not exist', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tireh-'));
    const stores = createFileStores(join(dir, 'missing.json'));
    expect(await stores.memories.listActive('aria')).toEqual([]);
  });
});
