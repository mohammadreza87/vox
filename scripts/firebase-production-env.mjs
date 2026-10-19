#!/usr/bin/env node
import { chmodSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const DEFAULT_PUBLIC_URL = 'https://vox-aicontact-fe0e3.web.app';
export const FIREBASE_PUBLIC_KEYS = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
];

export function productionOrigin(value = DEFAULT_PUBLIC_URL) {
  let url;
  try { url = new URL(value); } catch { throw new Error('STUDIO_PUBLIC_URL must be a public HTTPS origin.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('STUDIO_PUBLIC_URL must be a public HTTPS origin.');
  }
  return url.origin;
}

function required(env, key) {
  const value = env[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing required production configuration: ${key}`);
  if (/^(?:test(?:[-_.]|$)|your[-_]|replace[-_])|\.\.\./i.test(value) || ['123456', '1:123:web:abc'].includes(value)) {
    throw new Error(`Replace the placeholder production configuration: ${key}`);
  }
  return value;
}

export function firebaseProductionEnv(env) {
  const config = Object.fromEntries(FIREBASE_PUBLIC_KEYS.map(key => [key, required(env, key)]));
  const project = required(env, 'FIREBASE_PROJECT_ID');
  if (project !== config.NEXT_PUBLIC_FIREBASE_PROJECT_ID) throw new Error('FIREBASE_PROJECT_ID must match NEXT_PUBLIC_FIREBASE_PROJECT_ID.');
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) throw new Error('Invalid Firebase production project ID.');
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(config.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)) throw new Error('Invalid Firebase production storage bucket.');
  for (const key of ['STUDIO_SECRET', 'VOXX_BOT_TOKEN', 'STUDIO_SUPERADMIN_IDS', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY']) config[key] = required(env, key);
  if (config.STUDIO_SECRET.trim().length < 32) throw new Error('STUDIO_SECRET must contain at least 32 characters.');
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(config.VOXX_BOT_TOKEN)) throw new Error('Invalid VOXX_BOT_TOKEN format.');
  const ids = config.STUDIO_SUPERADMIN_IDS.split(/[,\s]+/).filter(Boolean);
  if (!ids.length || ids.some(id => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))) throw new Error('STUDIO_SUPERADMIN_IDS must contain positive Telegram user IDs.');
  const revision = required(env, 'STUDIO_REVISION');
  if (!/^[a-f0-9]{40}$/i.test(revision)) throw new Error('STUDIO_REVISION must contain the full deployed Git commit SHA.');
  const publicUrl = productionOrigin(env.STUDIO_PUBLIC_URL || DEFAULT_PUBLIC_URL);
  const mediaBucket = env.STUDIO_MEDIA_BUCKET || config.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(mediaBucket)) throw new Error('Invalid STUDIO_MEDIA_BUCKET.');
  return {
    ...config,
    STUDIO_STORAGE: 'firestore',
    STUDIO_ONLY: '1',
    STUDIO_BOTS: '0',
    STUDIO_REVISION: revision,
    STUDIO_PUBLIC_URL: publicUrl,
    STUDIO_WEBAPP_URL: `${publicUrl}/studio`,
    STUDIO_MEDIA_BUCKET: mediaBucket,
    VOXX_BOT_USERNAME: env.VOXX_BOT_USERNAME || 'VoxxBot',
    STUDIO_ORG_NAME: env.STUDIO_ORG_NAME || 'HOOR',
  };
}

export function dotenvLine(key, value) {
  if (value.includes('\0')) throw new Error(`${key} cannot contain a NUL character.`);
  // Node/Next and Firebase both support these quotes. Firebase additionally
  // expands double-quoted backslash escapes, so only use them when unchanged.
  const candidates = [];
  if (!value.includes("'")) candidates.push(`${key}='${value}'`);
  if (!value.includes('"') && !/\\[nrtv\\'"]/.test(value)) candidates.push(`${key}="${value}"`);
  if (!/[#\r\n]/.test(value)) candidates.push(`${key}=${value}`);
  for (const line of candidates) if (parseEnv(line)[key] === value) return line;
  throw new Error(`${key} cannot be encoded exactly in the production dotenv file.`);
}

export function writeProductionEnv(path, config) {
  const contents = Object.entries(config).map(([key, value]) => dotenvLine(key, value)).join('\n') + '\n';
  const parsed = parseEnv(contents);
  if (Object.entries(config).some(([key, value]) => parsed[key] !== value)) throw new Error('Production dotenv round-trip validation failed.');
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, contents, { mode: 0o600, flag: 'wx' });
    chmodSync(temporary, 0o600);
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = firebaseProductionEnv(process.env);
    writeProductionEnv(resolve(process.argv[2] || '.env'), config);
    console.log('Firebase production configuration validated and written privately.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
