/**
 * Test-only fake of the Firestore Admin SDK surface the memory store uses,
 * with '==' / 'in' filters, findNearest capture and serialized transactions.
 * Shared by memory-v2-firestore.test.ts and negative-identity.test.ts.
 */
import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { FirestoreMemoryStore } from '../memory/firestore-store';
import { cosine } from '../memory/embeddings';

/** Stand-in for FieldValue.vector(): has toArray/isEqual like the SDK's VectorValue. */
export class FakeVector {
  constructor(private readonly values: readonly number[]) {}
  toArray(): number[] { return [...this.values]; }
  isEqual(other: unknown): boolean {
    return other instanceof FakeVector && other.values.length === this.values.length && other.values.every((v, i) => v === this.values[i]);
  }
}

type Filter = [field: string, op: string, value: unknown];
interface NearestCall { filters: Filter[]; options: { vectorField: string; queryVector: number[]; limit: number; distanceMeasure: string } }

function clone(value: unknown): unknown {
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  }
  return value; // FakeVector, Timestamp-like and sentinel objects are kept by reference
}

function isDeleteSentinel(value: unknown): boolean {
  return !!value && typeof value === 'object' && typeof (value as { isEqual?: unknown }).isEqual === 'function' &&
    FieldValue.delete().isEqual(value as FieldValue);
}

/** Minimal Admin SDK stand-in with '==' / 'in' filters, findNearest capture and transactions. */
export function fakeFirestore(options: { ignoreNearestFilters?: boolean } = {}) {
  const data = new Map<string, Record<string, unknown>>();
  const nearest: NearestCall[] = [];
  let auto = 0;

  function assertNoUndefined(value: unknown, path = ''): void {
    if (value === undefined) throw new Error(`undefined value at ${path}`);
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
      for (const [k, v] of Object.entries(value)) assertNoUndefined(v, `${path}.${k}`);
    }
  }

  function docRef(path: string) {
    return {
      id: path.split('/').pop()!,
      path,
      async set(value: Record<string, unknown>) {
        assertNoUndefined(value);
        data.set(path, clone(value) as Record<string, unknown>);
      },
      async update(value: Record<string, unknown>) {
        assertNoUndefined(value);
        if (!data.has(path)) throw new Error('missing');
        const next: Record<string, unknown> = { ...data.get(path) };
        for (const [k, v] of Object.entries(value)) {
          if (isDeleteSentinel(v)) delete next[k];
          else next[k] = clone(v);
        }
        data.set(path, next);
      },
      async delete() { data.delete(path); },
      async get() {
        const value = data.get(path);
        return { id: path.split('/').pop()!, exists: value !== undefined, data: () => value };
      },
    };
  }

  function matches(value: Record<string, unknown>, filters: Filter[]): boolean {
    return filters.every(([f, op, v]) => op === 'in' ? (v as unknown[]).includes(value[f]) : value[f] === v);
  }

  function docsOf(path: string) {
    return [...data.entries()]
      .filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
      .map(([key, value]) => ({ id: key.split('/').pop()!, ref: docRef(key), data: () => value }));
  }

  function collectionRef(path: string, filters: Filter[] = []) {
    return {
      doc: (id?: string) => docRef(`${path}/${id ?? `auto${++auto}`}`),
      where: (field: string, op: string, value: unknown) => collectionRef(path, [...filters, [field, op, value]]),
      findNearest(opts: NearestCall['options']) {
        nearest.push({ filters, options: opts });
        return {
          async get() {
            const docs = docsOf(path)
              .filter((d) => options.ignoreNearestFilters || matches(d.data(), filters))
              .map((d) => {
                const e = d.data().embedding;
                const values = e instanceof FakeVector ? e.toArray() : Array.isArray(e) ? (e as number[]) : [];
                return { d, score: cosine(values, opts.queryVector) };
              })
              .sort((a, b) => b.score - a.score)
              .slice(0, opts.limit)
              .map((x) => x.d);
            return { docs };
          },
        };
      },
      async get() {
        return { docs: docsOf(path).filter((d) => matches(d.data(), filters)) };
      },
    };
  }

  type Ref = ReturnType<typeof docRef>;
  let queue = Promise.resolve();
  const db = {
    collection: (name: string) => collectionRef(name),
    async runTransaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> {
      let release!: () => void;
      const previous = queue;
      queue = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      const writes: Array<() => Promise<unknown>> = [];
      try {
        const result = await operation({
          get: (ref: { get(): Promise<unknown> }) => ref.get(),
          set: (ref: Ref, value: Record<string, unknown>) => writes.push(() => ref.set(value)),
          update: (ref: Ref, value: Record<string, unknown>) => writes.push(() => ref.update(value)),
          delete: (ref: Ref) => writes.push(() => ref.delete()),
        });
        for (const write of writes) await write();
        return result;
      } finally { release(); }
    },
  };
  return { db: db as unknown as Firestore, data, nearest };
}

export function vectorStore(db: Firestore) {
  return new FirestoreMemoryStore(db, { vectorValue: (values) => new FakeVector(values) });
}
