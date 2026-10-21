import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { FirestoreRevisionSource, InProcessRevisionSource, RevisionCounter, sameRevisions, type RevisionProbe } from '../privacy/revisions';
import { TurnReadScope } from '../privacy/read-scope';
import { createInMemoryStores } from '../memory/store';
import { createFileStores } from '../memory/file-store';
import { StudioStore } from '../../studio/store';
import { FirestoreStudioStore } from '../../studio/firestore-store';

describe('revision sources', () => {
  it('reads in-process probes synchronously and hints at a change without I/O', async () => {
    const counter = new RevisionCounter('test');
    const probe = counter.probe('doc');
    const source = new InProcessRevisionSource();
    expect(await source.read([probe])).toEqual([0]);
    expect(source.changed([probe])).toBe(false);
    counter.bump('doc');
    expect(await source.read([probe])).toEqual([1]);
    expect(source.changed([probe])).toBe(true);
    expect(sameRevisions([probe], await source.read([probe]))).toBe(false);
    await expect(source.read([{ key: 'remote', value: 0, remote: { path: 'a/b', field: 'rev' } }])).rejects.toThrow();
  });

  it('reads every remote probe with one masked getAll, in probe order', async () => {
    const fields: Record<string, Record<string, unknown>> = { 'studio/state': { revision: 7 }, 'adaptiveAccounts/x': { rev: 3 } };
    const getAll = vi.fn(async (...args: unknown[]) => (args.slice(0, -1) as Array<{ path: string }>).map(ref => ({ get: (field: string) => fields[ref.path]?.[field] })));
    const db = { doc: (path: string) => ({ path }), getAll };
    const counter = new RevisionCounter('local');
    const probes: RevisionProbe[] = [
      { key: 'a', value: 7, remote: { path: 'studio/state', field: 'revision' } },
      counter.probe('memory'),
      { key: 'b', value: 3, remote: { path: 'adaptiveAccounts/x', field: 'rev' } },
      { key: 'c', value: 0, remote: { path: 'tireh_memory_state/missing', field: 'revision' } },
      { key: 'd', value: 7, remote: { path: 'studio/state', field: 'revision' } },
    ];
    const source = new FirestoreRevisionSource(db);
    expect(await source.read(probes)).toEqual([7, 0, 3, 0, 7]);
    expect(getAll).toHaveBeenCalledTimes(1);
    expect(getAll.mock.calls[0].at(-1)).toEqual({ fieldMask: ['revision', 'rev'] });
    expect(getAll.mock.calls[0].length).toBe(4); // three distinct documents plus read options
    expect(source.changed(probes)).toBeUndefined();
    expect(source.changed([counter.probe('memory')])).toBe(false);
  });
});

describe('Studio state revision', () => {
  it('advances on every committed update and serves one committed copy per snapshot', async () => {
    const store = new StudioStore(mkdtempSync(join(tmpdir(), 'vox-revision-')));
    expect(store.revisions.get('state')).toBe(0);
    await store.update(s => { s.audit.push({ at: 'x', actor: 'a', action: 'b' }); });
    await store.audit({ actor: 'a', action: 'c' });
    expect(store.revisions.get('state')).toBe(2);

    const scope = TurnReadScope.load();
    const [first, second] = await scope.run(async () => [await store.read(), await store.read()]);
    expect(first).toEqual(second);
    first.members.push({ telegramId: 1, name: 'x', role: 'member', joinedAt: 'x' });
    expect((await scope.run(() => store.read())).members).toEqual([]);
    const [probe] = await scope.probes();
    expect(probe.value).toBe(2);
    expect(probe.local!()).toBe(2);
    await scope.run(() => store.update(s => { s.audit.push({ at: 'y', actor: 'a', action: 'd' }); }));
    expect(scope.wrote).toBe(true);
    expect(probe.local!()).toBe(3);
  });

  it('keeps a commit counter outside the Firestore JSON', async () => {
    const doc: Record<string, unknown> = {};
    const ref = { get: async () => ({ get: (field: string) => doc[field] }) };
    const db = { doc: () => ref, runTransaction: async (fn: (tx: unknown) => unknown) => fn({
      get: async () => ({ get: (field: string) => doc[field] }), set: (_ref: unknown, value: Record<string, unknown>) => { Object.assign(doc, value); } }) } as unknown as Firestore;
    const store = new FirestoreStudioStore(db, { file: () => { throw new Error('unused'); } } as never);
    await store.update(() => undefined);
    await store.update(() => undefined);
    expect(doc.revision).toBe(2);
    expect(JSON.parse(doc.json as string)).not.toHaveProperty('revision');
    const scope = TurnReadScope.load();
    await scope.run(() => store.read());
    expect((await scope.probes())[0]).toMatchObject({ value: 2, remote: { path: 'studio/state', field: 'revision' } });
  });
});

describe('memory revision and privacy epoch probes', () => {
  it('follow invalidation and history purges in memory', async () => {
    const stores = createInMemoryStores();
    const memory = await stores.memories.revisionProbe('aria');
    const epoch = await stores.history.epochProbe('aria');
    expect([memory.value, epoch.value]).toEqual([0, 0]);
    await stores.history.clearPersona('aria');
    expect([memory.local!(), epoch.local!()]).toEqual([1, 1]);
    expect(await stores.memories.safetyRevision('aria')).toBe(memory.local!());
  });

  it('reload the file store once when taken and then re-read in process', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'vox-revision-file-')), 'memory.json');
    const stores = createFileStores(path);
    await stores.memories.invalidate('aria');
    const memory = await stores.memories.revisionProbe!('aria');
    const epoch = await stores.history.epochProbe!('aria');
    expect([memory.value, epoch.value]).toEqual([1, 0]);
    await stores.history.clearPersona('aria');
    expect([memory.local!(), epoch.local!()]).toEqual([2, 1]);
    expect(await stores.memories.safetyRevision('aria')).toBe(2);
  });
});
