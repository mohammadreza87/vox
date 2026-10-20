import { defineConfig } from 'vitest/config';

/** The repository's browser setup assumes window; exercise this filesystem and
 * process engine in Node without those browser-only setup fixtures. */
export default defineConfig({ test: { environment: 'node', include: ['src/lib/studio/routines/**/*.test.ts'], testTimeout: 10_000 } });
