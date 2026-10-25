import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { authorizeAccess, isAuthorizationCurrent, resolveVerifiedPerson, type AccessRequest, type IdentityHint } from '../../../adaptive';
import { fixture, NOW } from '../../../adaptive/__tests__/fixtures';
import { fuseIdentity } from '../fusion';

const HINT: IdentityHint = { source: 'voice_match', claimedPersonId: 'bob', speakerLabel: 'Bob' };
// Resolved from this file's path (Vite rewrites `new URL(relative, import.meta.url)` into asset URLs).
const HERE = dirname(fileURLToPath(import.meta.url));
const source = (relative: string): string => readFileSync(resolve(HERE, relative), 'utf8');

function hinted(request: AccessRequest): AccessRequest[] {
  return [
    { ...request, identity: { ...request.identity, ...HINT } } as AccessRequest,
    { ...request, hint: HINT, identityHint: HINT, style: { source: 'style', consistency: 'inconsistent', messages: 9 },
      voice: { hint: HINT, verification: { band: 'MATCH', netSpeechMs: 9000, modelVersion: 'fake' } },
      identity: { ...request.identity, level: 'verified' } } as unknown as AccessRequest,
  ];
}

describe('identity hints never reach the adaptive policy inputs', () => {
  it('(a) leaves authorizeAccess and isAuthorizationCurrent unchanged', () => {
    const { request, snapshot } = fixture();
    const clean = authorizeAccess(request, snapshot, NOW);
    expect(clean.allowed).toBe(true);
    if (!clean.allowed) return;
    for (const variant of hinted(request)) {
      const decision = authorizeAccess(variant, snapshot, NOW);
      expect(decision).toEqual(clean);
      if (decision.allowed) expect(decision.stamp.requestFingerprint).toBe(clean.stamp.requestFingerprint);
      expect(isAuthorizationCurrent(clean.stamp, variant, snapshot, NOW)).toBe(true);
    }
  });

  it('(b) never moves resolveVerifiedPerson to a claimed person', () => {
    const { request, snapshot } = fixture();
    expect(resolveVerifiedPerson(request.identity, snapshot.account, snapshot.binding, NOW)).toBe('alice');
    const claimed = { ...request.identity, ...HINT };
    expect(resolveVerifiedPerson(claimed, snapshot.account, snapshot.binding, NOW)).toBe('alice');
    const unselected = { authenticatedAccountId: request.identity.authenticatedAccountId, ...HINT };
    expect(resolveVerifiedPerson(unselected, snapshot.account, snapshot.binding, NOW)).toBeUndefined();
  });

  it('(c) keeps hints out of the policy, identity and persistence sources', () => {
    const forbidden = /IdentityHint|claimedPersonId|speakerLabel|voice_match/;
    for (const file of ['../../../adaptive/policy.ts', '../../../adaptive/identity.ts', '../../../adaptive/persistence/service.ts']) {
      expect(source(file), file).not.toMatch(forbidden);
    }
    const types = source('../../../adaptive/types.ts');
    expect(types.match(/export interface IdentityHint\b/g)).toHaveLength(1);
    for (const name of ['IdentityContext', 'AccessRequest']) {
      const body = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(types)?.[1];
      expect(body, name).toBeDefined();
      expect(body, name).not.toMatch(/hint|claimedPersonId|speakerLabel|voice_match|level/i);
    }
  });

  it('(d) keeps the identity library away from policy inputs and wiring', () => {
    const dir = resolve(HERE, '..');
    const files = readdirSync(dir).filter(name => name.endsWith('.ts'));
    expect(files.sort()).toEqual(['fusion.ts', 'index.ts', 'profile.ts', 'store.ts', 'style-features.ts', 'test.ts', 'types.ts', 'voice-band.ts']);
    const adaptiveImports: string[] = [];
    for (const name of files) {
      const text = source(`../${name}`);
      expect(text, name).not.toMatch(/\b(AccessRequest|IdentityContext|PolicySnapshot|authorizeAccess|resolveVerifiedPerson)\b/);
      for (const line of text.split('\n').filter(l => /^\s*(import|export)\b.*\bfrom\s+'/.test(l))) {
        const specifier = /from\s+'([^']+)'/.exec(line)?.[1] ?? '';
        expect(specifier, `${name}: ${line}`).not.toMatch(/adaptive\/policy|adaptive\/persistence|gateway|studio|llm/);
        if (specifier.includes('adaptive')) adaptiveImports.push(`${name}: ${line.trim()}`);
      }
    }
    expect(adaptiveImports).toEqual(["types.ts: import type { IdentityHint } from '../../adaptive/types';"]);
  });

  it('(e) never copies a hint into the assessment', () => {
    for (const band of ['MATCH', 'UNCERTAIN', 'NO_MATCH'] as const) {
      for (const hint of [HINT, { source: 'voice_match' } as IdentityHint]) {
        const result = fuseIdentity({ accountPersonId: 'alice', verifiedRecently: true,
          voice: { hint, verification: { band, netSpeechMs: 7000, modelVersion: 'fake' } } });
        expect(Object.keys(result).sort()).toEqual(['capped', 'level', 'logOdds', 'session']);
        expect(Object.values(result)).not.toContain(hint);
        const json = JSON.stringify(result);
        for (const token of ['voice_match', 'bob', 'Bob', 'speakerLabel', 'claimedPersonId', 'alice']) expect(json).not.toContain(token);
      }
    }
  });
});
