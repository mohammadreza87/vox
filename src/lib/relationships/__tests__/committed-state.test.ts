import {describe, expect, it} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {InMemoryRelationshipStore, FileRelationshipStore, type RelationshipState, type RelationshipKey} from '..';
const key: RelationshipKey = {personaId: 'agent', chatKey: 'private-person', audience: {kind: 'private', personId: 'person'}};
describe('committed relationship effect snapshot', () => {
  it('refuses queued/inflight writes and releases after both failure and success', async () => {
    let release!: () => void;
    class Held extends InMemoryRelationshipStore {
      fail = false;
      protected override async commit(states: Map<string, RelationshipState>) {
        await new Promise<void>(resolve => {release = resolve;});
        if (this.fail) throw Error('synthetic write failed');
        await super.commit(states);
      }
    }
    const store = new Held();
    expect(store.readCommittedForEffect(key).revision).toBe(0);
    const first = store.update(key, s => {s.revision++;});
    expect(() => store.readCommittedForEffect(key)).toThrow('busy');
    await Promise.resolve(); release(); await first;
    const snapshot = store.readCommittedForEffect(key); expect(snapshot.revision).toBe(1);
    snapshot.revision = 900; expect(store.readCommittedForEffect(key).revision).toBe(1);
    store.fail = true; const failed = store.bumpEpoch(key.personaId);
    expect(() => store.readCommittedForEffect(key)).toThrow('busy');
    await Promise.resolve(); release(); await expect(failed).rejects.toThrow('synthetic');
    expect(store.readCommittedForEffect(key).epoch).toBe(0);
  });
  it('matches the FILE durable epoch after restart and cannot resurrect prior-epoch content', async () => {
    const path = mkdtempSync(join(tmpdir(), 'vox-relationship-sync-'));
    try {
      const store = new FileRelationshipStore(join(path, 'synthetic.json'));
      await store.update(key, s => {s.preferences.push({key: 'synthetic', value: 'PRIVATE_CANARY', sourceId: 'source', updatedAt: '2026-10-19T10:00:00Z'}); s.revision++;});
      expect(store.readCommittedForEffect(key)).toEqual(await store.read(key));
      const bump = store.bumpEpoch(key.personaId); expect(() => store.readCommittedForEffect(key)).toThrow('busy'); await bump;
      const restarted = new FileRelationshipStore(join(path, 'synthetic.json'));
      expect(restarted.readCommittedForEffect(key)).toEqual(await store.read(key));
      expect(restarted.readCommittedForEffect(key).preferences).toEqual([]);
    } finally {rmSync(path, {recursive: true, force: true});}
  });
});
