import { fileRuntimeFs, assertFileRuntimePath } from '../studio/file-runtime-owner';
const { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, fsyncSync } = fileRuntimeFs;

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
  override readCommittedForEffect(key:Parameters<InMemoryRelationshipStore['read']>[0]):RelationshipState { assertFileRuntimePath(this.path);return super.readCommittedForEffect(key); }
  override update<T>(key:Parameters<InMemoryRelationshipStore['read']>[0],fn:(state:RelationshipState)=>T):Promise<T> {assertFileRuntimePath(this.path);return super.update(key,state=>{assertFileRuntimePath(this.path);return fn(state);});}
  override bumpEpoch(id:string):Promise<void> {assertFileRuntimePath(this.path);return super.bumpEpoch(id);}
  override async read(key:Parameters<InMemoryRelationshipStore['read']>[0]) { assertFileRuntimePath(this.path); const result=await super.read(key); assertFileRuntimePath(this.path);return result; }
  override async due(now:Date,limit:number) { assertFileRuntimePath(this.path); const result=await super.due(now,limit);assertFileRuntimePath(this.path);return result; }
  override async keysForPersona(id:string) { assertFileRuntimePath(this.path);const result=await super.keysForPersona(id);assertFileRuntimePath(this.path);return result; }
  override async keysForAccount(id:string) { assertFileRuntimePath(this.path);const result=await super.keysForAccount(id);assertFileRuntimePath(this.path);return result; }
  protected override async commit(states: Map<string, RelationshipState>): Promise<void> {
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, epochs: [...this.epochs], states: [...states.values()] }), { mode: 0o600 });
    const fd = openSync(temporary, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, this.path); this.states = states;
  }
}
