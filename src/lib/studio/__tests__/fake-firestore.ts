/**
 * In-memory stand-in for the parts of the Firestore Admin SDK the style
 * profile store uses. Copied locally (the fake in
 * src/lib/tireh/__tests__/firestore-store.test.ts is not exported and existing
 * tests are not edited). set() rejects undefined values like Firestore does.
 */
import type { Firestore } from 'firebase-admin/firestore';

type DocData = Record<string, unknown>;

interface FakeSnapshot { readonly id: string; readonly exists: boolean; data(): DocData | undefined }
interface FakeDocRef {
  readonly id: string;
  readonly path: string;
  get(): Promise<FakeSnapshot>;
  set(value: DocData): Promise<void>;
  delete(): Promise<void>;
}
interface FakeQueryDoc { readonly id: string; readonly ref: FakeDocRef; data(): DocData }
interface FakeQuery {
  where(field: string, op: '==' | '<=', value: unknown): FakeQuery;
  get(): Promise<{ docs: FakeQueryDoc[] }>;
}
interface FakeCollection extends FakeQuery { doc(id: string): FakeDocRef }
interface FakeTransaction {
  get(ref: FakeDocRef): Promise<FakeSnapshot>;
  set(ref: FakeDocRef, value: DocData): void;
  delete(ref: FakeDocRef): void;
}

export interface FakeFirestore {
  readonly db: Firestore;
  /** path -> document, for assertions. */
  readonly data: Map<string, DocData>;
  /** Every value passed to set(), for assertions. */
  readonly writes: DocData[];
  /** Makes every operation reject with this error (for failure tests). */
  failWith?: Error;
}

function assertNoUndefined(value: unknown, path = ''): void {
  if (value === undefined) throw new Error(`undefined value at ${path}`);
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertNoUndefined(v, `${path}.${k}`);
  }
}

const clone = (value: DocData): DocData => JSON.parse(JSON.stringify(value)) as DocData;

export function fakeFirestore(): FakeFirestore {
  const data = new Map<string, DocData>();
  const writes: DocData[] = [];
  const state: FakeFirestore = { db: undefined as unknown as Firestore, data, writes };
  const guard = () => { if (state.failWith) throw state.failWith; };

  const docRef = (path: string): FakeDocRef => ({
    id: path.split('/').pop() ?? path,
    path,
    async get() {
      guard();
      const value = data.get(path);
      return { id: path.split('/').pop() ?? path, exists: value !== undefined, data: () => (value ? clone(value) : undefined) };
    },
    async set(value: DocData) {
      guard();
      assertNoUndefined(value);
      writes.push(clone(value));
      data.set(path, clone(value));
    },
    async delete() {
      guard();
      data.delete(path);
    },
  });

  const query = (collection: string, filters: Array<[string, '==' | '<=', unknown]>): FakeQuery => ({
    where: (field, op, value) => query(collection, [...filters, [field, op, value]]),
    async get() {
      guard();
      const docs = [...data.entries()]
        .filter(([key]) => key.startsWith(`${collection}/`) && !key.slice(collection.length + 1).includes('/'))
        .filter(([, value]) => filters.every(([field, op, expected]) => op === '=='
          ? value[field] === expected
          : typeof value[field] === 'number' && typeof expected === 'number' && (value[field] as number) <= expected))
        .map(([key, value]) => ({ id: key.split('/').pop() ?? key, ref: docRef(key), data: () => clone(value) }));
      return { docs };
    },
  });

  const collection = (name: string): FakeCollection => ({ ...query(name, []), doc: (id: string) => docRef(`${name}/${id}`) });

  let queue: Promise<void> = Promise.resolve();
  const db = {
    collection,
    async runTransaction<T>(operation: (tx: FakeTransaction) => Promise<T>): Promise<T> {
      let release!: () => void;
      const previous = queue;
      queue = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const pending: Array<() => Promise<void>> = [];
      try {
        guard();
        const result = await operation({
          get: ref => ref.get(),
          set: (ref, value) => { assertNoUndefined(value); pending.push(() => ref.set(value)); },
          delete: ref => { pending.push(() => ref.delete()); },
        });
        for (const write of pending) await write();
        return result;
      } finally { release(); }
    },
    batch() {
      const pending: Array<() => Promise<void>> = [];
      return {
        delete: (ref: FakeDocRef) => { pending.push(() => ref.delete()); },
        commit: async () => { guard(); for (const write of pending) await write(); },
      };
    },
  };
  (state as { db: Firestore }).db = db as unknown as Firestore;
  return state;
}
