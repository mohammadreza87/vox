import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, fsyncSync } from 'fs';
import { dirname } from 'path';
import { InMemoryRelationshipStore, relationshipId } from './store';
import type { RelationshipState } from './types';
/** Single-process local runtime only. Use Firestore when running multiple workers/instances. */
export class FileRelationshipStore extends InMemoryRelationshipStore {
  constructor(private readonly path: string) {
    super(); mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, 'utf8')) as { version: number; epochs?: Array<[string, number]>; states: RelationshipState[] };
      if (data.version !== 1 || !Array.isArray(data.states)) throw new Error('Invalid relationship store');
      this.epochs = new Map(data.epochs ?? []);
      this.states = new Map(data.states.map((s) => [relationshipId(s.key), s]));
    }
  }
  protected override async commit(states: Map<string, RelationshipState>): Promise<void> {
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, epochs: [...this.epochs], states: [...states.values()] }), { mode: 0o600 });
    const fd = openSync(temporary, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, this.path); this.states = states;
  }
}
