/** Explicit local format selection. Opening never starts or repairs a transition. */
import { lstatSync } from 'fs';
import { FileAdaptiveStorage, type AdaptiveStorage } from './storage';
import { managedDirectory, openManagedAdaptiveStorage } from './indexed/managed-storage';
export type AdaptiveStorageFormat = 'file' | 'sqlite-v1' | 'file-v2';
export function parseAdaptiveStorageFormat(raw: string | undefined, runtimeStorage: string, persistent: boolean): AdaptiveStorageFormat {
  const format = raw?.trim() || 'file';
  if (!['file', 'sqlite-v1', 'file-v2'].includes(format)) throw new Error('STUDIO_ADAPTIVE_FORMAT must be file, sqlite-v1 or file-v2');
  if (format !== 'file' && (runtimeStorage !== 'file' || !persistent)) throw new Error('Managed adaptive storage requires local persistent file storage');
  return format as AdaptiveStorageFormat;
}
export function openLocalAdaptiveStorage(root: string, format: AdaptiveStorageFormat, now: () => number = Date.now): { storage: AdaptiveStorage; close: () => void } {
  if (format !== 'file') {
    const storage = openManagedAdaptiveStorage(root, { format, now });
    return { storage, close: () => storage.close() };
  }
  const managed = lstatSync(managedDirectory(root), { throwIfNoEntry: false });
  const legacy = lstatSync(root, { throwIfNoEntry: false });
  if (managed || legacy && (!legacy.isDirectory() || legacy.isSymbolicLink()))
    throw new Error('Adaptive storage has managed state; select its explicit current format after verified transition');
  return { storage: new FileAdaptiveStorage(root), close: () => {} };
}
