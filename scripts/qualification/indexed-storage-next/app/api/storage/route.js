import Database from 'better-sqlite3';
import {existsSync, realpathSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const require = createRequire(import.meta.url);
function unavailable() {
  return Response.json({error: 'synthetic_storage_disabled'}, {status: 503});
}
function databasePath() {
  const directory = process.env.SQLITE_FIXTURE_DATA;
  if (!directory || !path.isAbsolute(directory) || realpathSync(directory) !== directory) throw new Error('synthetic_data_directory_invalid');
  return path.join(directory, 'synthetic.sqlite');
}
function result(db) {
  const row = db.prepare('SELECT value FROM synthetic WHERE id = 1').get();
  const identity = db.prepare('SELECT sqlite_version() AS sqliteVersion, sqlite_source_id() AS sqliteSourceId').get();
  const natives = Object.keys(require.cache).filter(name => name.endsWith('.node') && name.includes('better-sqlite3'));
  if (natives.length !== 1) throw new Error('synthetic_native_identity_invalid');
  return {row, ...identity, node: process.version, platform: process.platform, arch: process.arch, nativePath: natives[0]};
}
export async function GET() {
  if (process.env.SQLITE_FIXTURE_ENABLED !== '1') return unavailable();
  const filename = databasePath();
  if (!existsSync(filename)) return Response.json({error: 'synthetic_storage_not_initialized'}, {status: 404});
  const db = new Database(filename, {readonly: true, fileMustExist: true, timeout: 0});
  try { return Response.json(result(db)); }
  finally { db.close(); }
}
export async function POST(request) {
  if (process.env.SQLITE_FIXTURE_ENABLED !== '1') return unavailable();
  if (request.headers.get('x-synthetic-fixture') !== 'initialize-fixed-row-v1') return Response.json({error: 'synthetic_guard_required'}, {status: 403});
  const db = new Database(databasePath(), {timeout: 0});
  try {
    if (db.pragma('journal_mode = DELETE', {simple: true}) !== 'delete') throw new Error('synthetic_journal_invalid');
    db.pragma('synchronous = FULL');
    db.pragma('foreign_keys = ON');
    db.pragma('trusted_schema = OFF');
    db.pragma('secure_delete = ON');
    db.transaction(() => {
      db.exec('CREATE TABLE IF NOT EXISTS synthetic(id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL) STRICT');
      db.prepare('INSERT INTO synthetic(id,value) VALUES(1,?) ON CONFLICT(id) DO NOTHING').run('synthetic-native-qualified-v1');
    }).immediate();
    return Response.json(result(db), {status: 201});
  } finally { db.close(); }
}
