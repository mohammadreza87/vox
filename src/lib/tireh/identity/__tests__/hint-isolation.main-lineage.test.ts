/**
 * Main-lineage hint-isolation cases (S10L, earlier run 83848b7 plus the
 * 8a7dc55 voice-band allowance) ported onto the chosen wave A implementation
 * (aiq/identity-lib b34b7c0). API rename: StyleIdentityService ->
 * IdentityConfidenceService; the scanned source list is wave A's (no
 * service.ts). The source-tree scans complement wave A's hint-isolation (d):
 * they also catch dynamic imports and require(), and assert that no production
 * module outside src/lib/tireh/identity imports it except through the shared
 * voice-band contract (S11L: studio/identity/voice.ts, net-speech.ts and
 * tireh/gateway.ts).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { dirname, join, relative, resolve, sep } from 'path';
import { authorizeAccess, resolveVerifiedPerson, type AccessRequest, type IdentityContext } from '../../../adaptive';
import { fixture, NOW } from '../../../adaptive/__tests__/fixtures';
import { IdentityConfidenceService } from '../index';
import { InMemoryStyleProfileStore } from '../store';
import type { IdentitySignals } from '../types';

const SRC = join(process.cwd(), 'src');
const IDENTITY_DIR = join(SRC, 'lib', 'tireh', 'identity');
const ADAPTIVE_DIR = join(SRC, 'lib', 'adaptive');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(path);
    return /\.(ts|tsx|mts)$/.test(entry.name) ? [path] : [];
  });
}
const isTest = (path: string) => path.split(sep).includes('__tests__') || /\.(test|spec)\.tsx?$/.test(path);
const within = (path: string, dir: string) => path === dir || path.startsWith(dir + sep);

interface ImportRef { readonly specifier: string; readonly typeOnly: boolean; readonly statement: string }
function importsOf(source: string): ImportRef[] {
  const refs: ImportRef[] = [];
  for (const m of source.matchAll(/\b(import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*['"]([^'"]+)['"]/g)) {
    refs.push({ specifier: m[4], typeOnly: Boolean(m[2]), statement: m[0] });
  }
  for (const m of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]/gm)) {
    refs.push({ specifier: m[1] ?? m[2] ?? m[3], typeOnly: false, statement: m[0] });
  }
  return refs;
}
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  if (specifier.startsWith('.')) return resolve(dirname(fromFile), specifier);
  if (specifier.startsWith('@/')) return join(SRC, specifier.slice(2));
  return null;
}
const resolvesInto = (target: string | null, dir: string) =>
  target !== null && (within(target, dir) || within(target.replace(/\.(ts|tsx)$/, ''), dir) || target === `${dir}.ts`);

const identitySources = walk(IDENTITY_DIR).filter(path => !isTest(path));
const adaptiveSources = walk(ADAPTIVE_DIR).filter(path => !isTest(path));

describe('main-lineage: hint isolation at runtime', () => {
  it('ignores hint keys spread into the identity context', () => {
    const { request, snapshot } = fixture();
    const clean = authorizeAccess(request, snapshot, NOW);
    expect(clean.allowed).toBe(true);
    const polluted = { ...request, identity: { ...request.identity, source: 'voice_match', claimedPersonId: 'bob', speakerLabel: 'bob' } as unknown as IdentityContext };
    expect(authorizeAccess(polluted, snapshot, NOW)).toEqual(clean);
  });

  it('ignores identity-confidence keys at the top level of the request', () => {
    const { request, snapshot } = fixture();
    const clean = authorizeAccess(request, snapshot, NOW);
    const polluted = {
      ...request, identityHint: { source: 'voice_match', claimedPersonId: 'bob' }, styleHint: { source: 'style', consistency: 'consistent', messages: 50 },
      voice: { band: 'MATCH' }, style: { consistency: 'consistent' }, level: 'verified',
    } as unknown as AccessRequest;
    expect(authorizeAccess(polluted, snapshot, NOW)).toEqual(clean);
  });

  it('never lets a hint stand in for a verified person', () => {
    const { request, snapshot } = fixture();
    const identity = { authenticatedAccountId: request.identity.authenticatedAccountId, source: 'voice_match', claimedPersonId: 'alice', speakerLabel: 'alice' } as unknown as IdentityContext;
    expect(authorizeAccess({ ...request, identity }, snapshot, NOW)).toEqual({ allowed: false, reason: 'identity_unverified' });
    expect(resolveVerifiedPerson(identity, snapshot.account, snapshot.binding, NOW)).toBeUndefined();
    const withSelected = { ...request.identity, claimedPersonId: 'bob', speakerLabel: 'bob' } as unknown as IdentityContext;
    expect(resolveVerifiedPerson(withSelected, snapshot.account, snapshot.binding, NOW))
      .toBe(resolveVerifiedPerson(request.identity, snapshot.account, snapshot.binding, NOW));
  });

  it('never returns identity or person fields from assess', () => {
    const service = new IdentityConfidenceService({ store: new InMemoryStyleProfileStore() });
    const inputs: IdentitySignals[] = [
      { accountPersonId: 'alice', verifiedRecently: true },
      { accountPersonId: 'alice', verifiedRecently: false, voice: { hint: { source: 'voice_match', claimedPersonId: 'bob' }, verification: { band: 'NO_MATCH', netSpeechMs: 9000, modelVersion: 'fake' } } },
      { accountPersonId: 'alice', verifiedRecently: false, style: { source: 'style', consistency: 'uncertain', messages: 9 } },
    ];
    for (const input of inputs) {
      const keys = Object.keys(service.assess(input));
      for (const forbidden of ['identity', 'authenticatedAccountId', 'selectedPerson', 'personId']) expect(keys).not.toContain(forbidden);
    }
  });
});

describe('main-lineage: hint isolation in the source tree', () => {
  it('finds the sources it scans', () => {
    expect(identitySources.map(p => relative(IDENTITY_DIR, p)).sort()).toEqual(
      ['fusion.ts', 'index.ts', 'profile.ts', 'store.ts', 'style-features.ts', 'test.ts', 'types.ts', 'voice-band.ts']);
    expect(adaptiveSources.length).toBeGreaterThan(10);
  });

  it('imports adaptive only as types from adaptive/types', () => {
    for (const file of identitySources) {
      for (const ref of importsOf(readFileSync(file, 'utf8'))) {
        const target = resolveSpecifier(ref.specifier, file);
        if (!resolvesInto(target, ADAPTIVE_DIR) && !ref.specifier.includes('adaptive')) continue;
        expect({ file: relative(SRC, file), statement: ref.statement, typeOnly: ref.typeOnly, specifier: ref.specifier })
          .toEqual({ file: relative(SRC, file), statement: ref.statement, typeOnly: true, specifier: '../../adaptive/types' });
      }
    }
  });

  it('never touches authorization or verified-identity APIs', () => {
    for (const file of identitySources) {
      const source = readFileSync(file, 'utf8');
      for (const name of ['authorizeAccess', 'resolveVerifiedPerson', 'authenticatedAccountId', 'selectedPerson']) {
        expect(source.includes(name), `${relative(SRC, file)} mentions ${name}`).toBe(false);
      }
    }
  });

  it('keeps the adaptive policy free of identity-confidence imports and hint fields', () => {
    for (const file of adaptiveSources) {
      const source = readFileSync(file, 'utf8');
      for (const ref of importsOf(source)) {
        expect(resolvesInto(resolveSpecifier(ref.specifier, file), IDENTITY_DIR) || ref.specifier.includes('tireh/identity'),
          `${relative(SRC, file)} imports ${ref.specifier}`).toBe(false);
      }
      if (file !== join(ADAPTIVE_DIR, 'types.ts')) {
        expect(/claimedPersonId|speakerLabel/.test(source), `${relative(SRC, file)} reads hint fields`).toBe(false);
      }
    }
  });

  it('keeps the style identity library unwired except for the shared voice-band contract', () => {
    const importers: string[] = [];
    for (const file of walk(SRC)) {
      if (isTest(file) || within(file, IDENTITY_DIR)) continue;
      for (const ref of importsOf(readFileSync(file, 'utf8'))) {
        if (resolvesInto(resolveSpecifier(ref.specifier, file), IDENTITY_DIR) || ref.specifier.includes('tireh/identity')) {
          // S11L consumes the shared band/result contract; it does not wire style identity.
          if (resolveSpecifier(ref.specifier, file)?.replace(/\.(ts|tsx)$/, '') !== join(IDENTITY_DIR, 'voice-band')) importers.push(`${relative(SRC, file)} -> ${ref.specifier}`);
        }
      }
    }
    expect(importers).toEqual([]);
    expect(walk(join(SRC, 'lib', 'tireh')).some(p => p === join(SRC, 'lib', 'tireh', 'identity.ts'))).toBe(false);
  });
});
