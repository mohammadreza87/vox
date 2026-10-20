import path from 'node:path';
import {fileURLToPath} from 'node:url';
export default {
  output: 'standalone',
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
  serverExternalPackages: ['better-sqlite3'],
  outputFileTracingIncludes: {
    '/api/storage': [
      './node_modules/better-sqlite3/prebuilds/darwin-arm64.node',
      './node_modules/better-sqlite3/prebuilds/linux-x64.node',
    ],
  },
  experimental: { cpus: 1 },
};
