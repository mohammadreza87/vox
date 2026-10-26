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
  /** Field mask: data() of each result holds only these fields. */
  select(...fields: string[]): FakeQuery;
  /** A field name, or FieldPath.documentId() (any non-string, or '__name__') for document-id order. */
  orderBy(field: unknown, direction?: 'asc' | 'desc'): FakeQuery;
  limit(count: number): FakeQuery;
  /** Exclusive cursor on the orderBy value (a document id for document-id order). */
  startAfter(value: unknown): FakeQuery;
  get(): Promise<{ docs: FakeQueryDoc[] }>;
}

/** One executed query, for assertions (for example that a field mask left a field out). */
export interface FakeQueryLog {
  readonly collection: string;
  readonly select: readonly string[] | null;
  readonly orderBy: string | null;
  readonly limit: number | null;
  readonly startAfter: unknown;
  readonly returned: number;
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
  /** Every collection query run with get(), for assertions. */
  readonly queries: FakeQueryLog[];
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
  const queries: FakeQueryLog[] = [];
  const state: FakeFirestore = { db: undefined as unknown as Firestore, data, writes, queries };
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

  interface QuerySpec {
    filters: Array<[string, '==' | '<=', unknown]>;
    select?: string[];
    /** '__name__' orders by document id. */
    order?: { field: string; desc: boolean };
    limit?: number;
    after?: { value: unknown };
  }
  const compare = (a: unknown, b: unknown): number => {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    const x = String(a), y = String(b);
    return x < y ? -1 : x > y ? 1 : 0;
  };

  const query = (collection: string, spec: QuerySpec): FakeQuery => ({
    where: (field, op, value) => query(collection, { ...spec, filters: [...spec.filters, [field, op, value]] }),
    select: (...fields) => query(collection, { ...spec, select: fields }),
    orderBy: (field, direction = 'asc') => query(collection, {
      ...spec, order: { field: typeof field === 'string' && field !== '__name__' ? field : '__name__', desc: direction === 'desc' },
    }),
    limit: count => query(collection, { ...spec, limit: count }),
    startAfter: value => query(collection, { ...spec, after: { value } }),
    async get() {
      guard();
      let rows = [...data.entries()]
        .filter(([key]) => key.startsWith(`${collection}/`) && !key.slice(collection.length + 1).includes('/'))
        .filter(([, value]) => spec.filters.every(([field, op, expected]) => op === '=='
          ? value[field] === expected
          : typeof value[field] === 'number' && typeof expected === 'number' && (value[field] as number) <= expected))
        .map(([key, value]) => ({ key, id: key.split('/').pop() ?? key, value }));
      const order = spec.order;
      if (order) {
        const of = (row: { id: string; value: DocData }) => order.field === '__name__' ? row.id : row.value[order.field];
        rows.sort((a, b) => compare(of(a), of(b)) * (order.desc ? -1 : 1));
        if (spec.after) {
          const cursor = spec.after.value;
          rows = rows.filter(row => compare(of(row), cursor) * (order.desc ? -1 : 1) > 0);
        }
      }
      if (spec.limit !== undefined) rows = rows.slice(0, spec.limit);
      const fields = spec.select;
      const project = (value: DocData): DocData => fields
        ? Object.fromEntries(fields.filter(f => f in value).map(f => [f, value[f]]))
        : value;
      queries.push({
        collection, select: fields ? [...fields] : null, orderBy: order?.field ?? null, limit: spec.limit ?? null,
        startAfter: spec.after?.value, returned: rows.length,
      });
      const docs = rows.map(row => ({ id: row.id, ref: docRef(row.key), data: () => clone(project(row.value)) }));
      return { docs };
    },
  });

  const collection = (name: string): FakeCollection => ({ ...query(name, { filters: [] }), doc: (id: string) => docRef(`${name}/${id}`) });

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
