/** Test-only scheduling around actual guarded FILE operations. The final
 * authority callback, owner checks and atomic rename are never replaced. */
type Runtime = typeof import('../lib/studio/file-runtime-owner');
type Hooks = {
  afterTemporarySync?: (path: string) => void | Promise<void>;
  afterDescriptorSync?: (path: string) => void;
  transientDirectory?: (path: string, error?: unknown) => void;
};
const hooks: Hooks = {};
export function setFileRuntimeIoHooks(next: Hooks) { Object.assign(hooks, next); }
export function resetFileRuntimeIoHooks() {
  delete hooks.afterTemporarySync;
  delete hooks.afterDescriptorSync;
  delete hooks.transientDirectory;
}
export function instrumentFileRuntime(actual: Runtime): Runtime {
  return {
    ...actual,
    fileRuntimePromises: {
      ...actual.fileRuntimePromises,
      async open(...args: Parameters<Runtime['fileRuntimePromises']['open']>) {
        const handle = await actual.fileRuntimePromises.open(...args);
        if (!String(args[0]).endsWith('.tmp')) return handle;
        return new Proxy(handle, {
          get(target, key) {
            if (key === 'sync') return async () => {
              await target.sync();
              await hooks.afterTemporarySync?.(String(args[0]));
            };
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      },
    },
    createFileRuntimeTransientDirectory(path) {
      try { actual.createFileRuntimeTransientDirectory(path); }
      catch (error) { hooks.transientDirectory?.(path, error); throw error; }
      hooks.transientDirectory?.(path);
    },
    openFileRuntimeDescriptor(...args) {
      const descriptor = actual.openFileRuntimeDescriptor(...args);
      return {
        ...descriptor,
        sync() { descriptor.sync(); hooks.afterDescriptorSync?.(String(args[0])); },
      };
    },
  };
}
