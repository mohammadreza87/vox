import { types } from 'node:util';

/** Cached services and route bundles may load different copies of a class.
 * Match only bounded public metadata; never inspect messages, stacks or payloads.
 * The shared-symbol brand survives duplicate bundles in the same VM, while an
 * external JSON shape cannot acquire it. Data descriptors reject accessors. */
export function brandError(error: Error, name: string): void {
  Object.defineProperty(error, Symbol.for(`vox.${name}`), { value: true, writable: false, configurable: false, enumerable: false });
}

export function namedError(error: unknown, name: string): boolean {
  try {
    if (types.isProxy(error) || !(error instanceof Error) || Object.getOwnPropertyDescriptor(error, 'name')?.value !== name) return false;
    const brand = Object.getOwnPropertyDescriptor(error, Symbol.for(`vox.${name}`));
    return brand?.value === true && brand.writable === false && brand.configurable === false;
  }
  catch { return false; }
}

export function publicDomainError(error: unknown, name: string): boolean {
  try {
    if (!namedError(error, name)) return false;
    const status: unknown = Object.getOwnPropertyDescriptor(error, 'status')?.value;
    const code: unknown = Object.getOwnPropertyDescriptor(error, 'code')?.value;
    return typeof status === 'number' && [400, 401, 403, 404, 409, 413, 415, 422, 429, 500, 502, 503, 504].includes(status) &&
      typeof code === 'string' && /^[a-z][a-z0-9_]{0,95}$/.test(code);
  } catch { return false; }
}

/** Zod 4's Symbol.hasInstance reads `_zod.traits.has` on arbitrary input.
 * Validate its own data descriptors and use the native Set operation instead,
 * so HTTP classification never executes accessors or proxy traps. No issues or
 * validation input is returned. Keep the real-schema regression when upgrading. */
export function isSchemaValidationError(error: unknown): boolean {
  try {
    if (types.isProxy(error) || !(error instanceof Error)) return false;
    if (Object.getOwnPropertyDescriptor(error, 'name')?.value !== 'ZodError') return false;
    const internal: unknown = Object.getOwnPropertyDescriptor(error, '_zod')?.value;
    if (!internal || typeof internal !== 'object' || types.isProxy(internal)) return false;
    const traits: unknown = Object.getOwnPropertyDescriptor(internal, 'traits')?.value;
    return types.isSet(traits) && !types.isProxy(traits) && Set.prototype.has.call(traits, 'ZodError') && Set.prototype.has.call(traits, '$ZodError');
  } catch { return false; }
}
