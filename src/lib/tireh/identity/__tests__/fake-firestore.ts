/**
 * Minimal in-memory stand-in for the Firestore Admin SDK, shaped like the
 * private fakeFirestore() in src/lib/tireh/__tests__/firestore-store.test.ts.
 * Supports collection().doc(id).get/set/delete and where(field, '==', value).get().
 * The raw `data` map is exposed for canary scans. Not a test file.
 */
export interface FakeFirestore {
  readonly data: Map<string, Record<string, unknown>>;
  collection(name: string): FakeCollection;
}

export interface FakeDocRef {
  readonly id: string;
  readonly path: string;
  get(): Promise<{ id: string; exists: boolean; data(): Record<string, unknown> | undefined }>;
  set(value: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
}

export interface FakeCollection {
  doc(id: string): FakeDocRef;
  where(field: string, op: '==', value: unknown): FakeCollection;
  get(): Promise<{ docs: { id: string; ref: FakeDocRef; data(): Record<string, unknown> }[] }>;
}

function assertNoUndefined(value: unknown, path = ''): void {
  if (value === undefined) throw new Error(`undefined value at ${path}`);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const [key, child] of Object.entries(value)) assertNoUndefined(child, `${path}.${key}`);
  }
}

export function fakeFirestore(): FakeFirestore {
  const data = new Map<string, Record<string, unknown>>();

  function docRef(path: string): FakeDocRef {
    const id = path.split('/').pop() ?? '';
    return {
      id,
      path,
      async get() {
        const value = data.get(path);
        return { id, exists: value !== undefined, data: () => (value === undefined ? undefined : structuredClone(value)) };
      },
      async set(value: Record<string, unknown>) {
        assertNoUndefined(value);
        data.set(path, structuredClone(value));
      },
      async delete() {
        data.delete(path);
      },
    };
  }

  function collectionRef(path: string, filters: readonly (readonly [string, unknown])[] = []): FakeCollection {
    return {
      doc: (id: string) => docRef(`${path}/${id}`),
      where: (field: string, _op: '==', value: unknown) => collectionRef(path, [...filters, [field, value]]),
      async get() {
        const docs = [...data.entries()]
          .filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
          .filter(([, value]) => filters.every(([field, expected]) => value[field] === expected))
          .map(([key, value]) => ({ id: key.split('/').pop() ?? '', ref: docRef(key), data: () => structuredClone(value) }));
        return { docs };
      },
    };
  }

  return { data, collection: (name: string) => collectionRef(name) };
}
