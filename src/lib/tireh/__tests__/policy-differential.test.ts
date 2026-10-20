/**
 * Differential oracle (docs/AGENT_INTELLIGENCE_SOLUTION.md section 5, Step 8):
 * visibility.isVisibleToAudience and adaptive authorizeAccess, through the
 * independent PolicySnapshotBuilder, must agree (allow/deny) on every fixture
 * and generated audience. Every case where they cannot agree yet is listed in
 * KNOWN_DIVERGENCES with a reason; an entry that no longer matches a real
 * divergence fails the test so the allowlist only shrinks.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { isVisibleToAudience } from '../memory/visibility';
import { resnapshotPatch } from '../memory/sharing';
import { OrgDirectory } from '../org/directory';
import { adaptiveAllowsAudience, buildPolicyMapping } from '../policy/snapshot';
import type { MemoryRecord, MemoryScope, MemorySensitivity, OrgConfig } from '../types';
import { studioToOrg } from '../../studio/org-bridge';
import type { StudioState } from '../../studio/types';
import { memory, testOrgConfig } from './fixtures';

const NOW = Date.parse('2026-10-20T00:00:00Z');
const PERSONA = 'aria';

/** Documentation only: how TIREH records are modelled in the adaptive contract. */
export const MODELING_NOTES = [
  'Identity: a synthetic verified account_confirmation binding per reader. TIREH has no binding records, so identity is not compared; unknown readers still fail as inactive people.',
  'Purpose: core.conversation with no consent rows. Optional-purpose consent gates live in the turn boundary, not in visibility.ts.',
  'Space: one Work space per organization until S06 adds MemoryRecord.space.',
  'Agent grant: derived from personaId, because the memory store is per agent; a record of another persona is not representable.',
  'Time: every record and membership starts at the record creation time, so only the authorization snapshot (never historyPolicy) decides who joined late.',
] as const;

interface Divergence { name: string; reason: string; matches(m: MemoryRecord, audience: readonly string[]): boolean }

export const KNOWN_DIVERGENCES: Divergence[] = [
  {
    name: 'duplicate-reader-sensitive-private',
    reason: 'visibility.ts counts raw audience entries for personal/confidential records (length must be 1) and fails closed on a duplicated reader; the adaptive request carries a de-duplicated known audience. Chat audiences are de-duplicated by audienceOf(), so production never passes duplicates.',
    matches: (m, audience) => m.sensitivity !== 'normal' && m.scope.kind === 'private' && !m.supersededBy &&
      audience.length > 1 && audience.every((id) => m.scope.kind === 'private' && id === m.scope.personId),
  },
];

function differentialOrg(): OrgDirectory {
  const config = testOrgConfig();
  const withGuest: OrgConfig = {
    ...config,
    people: [...config.people, { id: 'gwen', name: 'Gwen', role: 'Guest', companyIds: [], projectIds: [], guest: true }],
    groups: config.groups.map((g) => (g.id === 'leads' ? { ...g, memberIds: [...g.memberIds, 'gwen'] } : g)),
  };
  return new OrgDirectory(withGuest);
}

const SCOPES: Array<{ label: string; scope: MemoryScope }> = [
  { label: 'private-reza', scope: { kind: 'private', personId: 'reza' } },
  { label: 'private-gwen', scope: { kind: 'private', personId: 'gwen' } },
  { label: 'people-reza-parastoo', scope: { kind: 'people', personIds: ['reza', 'parastoo'] } },
  { label: 'people-reza-gwen', scope: { kind: 'people', personIds: ['reza', 'gwen'] } },
  { label: 'group-gameend', scope: { kind: 'group', groupId: 'gameend-team' } },
  { label: 'group-leads', scope: { kind: 'group', groupId: 'leads' } },
  { label: 'project-gameend', scope: { kind: 'project', projectId: 'gameend' } },
  { label: 'company-ludaxis', scope: { kind: 'company', companyId: 'ludaxis' } },
  { label: 'company-joyixir', scope: { kind: 'company', companyId: 'joyixir' } },
  { label: 'org', scope: { kind: 'org' } },
];
const SENSITIVITIES: MemorySensitivity[] = ['normal', 'personal', 'confidential'];
const AUTHORIZED: Array<{ label: string; of(defaults: string[] | undefined): string[] | undefined }> = [
  { label: 'default', of: (d) => d },
  { label: 'legacy-undefined', of: () => undefined },
  { label: 'empty', of: () => [] },
  { label: 'minus-last', of: (d) => d?.slice(0, -1) },
  { label: 'plus-sina', of: (d) => [...new Set([...(d ?? []), 'sina'])] },
];

function corpus(): MemoryRecord[] {
  const rows: MemoryRecord[] = [];
  for (const { label, scope } of SCOPES) for (const sensitivity of SENSITIVITIES) for (const auth of AUTHORIZED) for (const superseded of [false, true]) {
    const base = memory({ id: `m-${label}-${sensitivity}-${auth.label}${superseded ? '-superseded' : ''}`, content: 'differential fixture', scope, sensitivity });
    rows.push({ ...base, authorizedPersonIds: auth.of(base.authorizedPersonIds), ...(superseded ? { supersededBy: 'x' } : {}) });
  }
  return rows;
}

function audiences(org: OrgDirectory): string[][] {
  const pool = ['reza', 'parastoo', 'milad', 'sina', 'gwen', 'ghost'];
  const out: string[][] = [];
  for (let i = 0; i < pool.length; i++) {
    out.push([pool[i]]);
    for (let j = i + 1; j < pool.length; j++) {
      out.push([pool[i], pool[j]]);
      for (let k = j + 1; k < pool.length; k++) out.push([pool[i], pool[j], pool[k]]);
    }
  }
  for (const group of org.config.groups) out.push([...group.memberIds]);
  out.push([], ['reza', 'reza']);
  return out;
}

/** Ids, scope kind, sensitivity and audience only: never content. */
const describeCase = (m: MemoryRecord, audience: readonly string[], visibility: boolean) =>
  `${m.id} scope=${m.scope.kind} sensitivity=${m.sensitivity} audience=[${audience.join(',')}] visibility=${visibility}`;

describe('visibility vs adaptive policy differential', () => {
  it('snapshot.ts derives scope membership without the visibility decision functions', () => {
    const source = readFileSync(join(__dirname, '..', 'policy', 'snapshot.ts'), 'utf8');
    for (const name of ['canPersonSee', 'isVisibleToAudience', 'isMemoryAllowedInChat', 'snapshotScopeAudience']) {
      expect(source.includes(name), `snapshot.ts must not use ${name}`).toBe(false);
    }
  });

  it('agrees on every fixture and generated audience, except the documented divergences', () => {
    const org = differentialOrg();
    const rows = corpus();
    const groups = audiences(org);
    expect(rows).toHaveLength(300);
    const unexplained: string[] = [];
    const hits = new Map<string, number>();
    const falseMatches: string[] = [];
    let allowed = 0;
    for (const m of rows) for (const audience of groups) {
      const visibility = isVisibleToAudience(org, m, audience);
      const adaptive = adaptiveAllowsAudience(org, m, audience, PERSONA, NOW);
      if (visibility) allowed++;
      const entry = KNOWN_DIVERGENCES.find((d) => d.matches(m, audience));
      if (entry) {
        if (visibility === adaptive) falseMatches.push(`${entry.name}: ${describeCase(m, audience, visibility)}`);
        else hits.set(entry.name, (hits.get(entry.name) ?? 0) + 1);
      } else if (visibility !== adaptive) unexplained.push(describeCase(m, audience, visibility));
    }
    expect(allowed).toBeGreaterThan(50);
    expect(unexplained, 'unexplained divergences').toEqual([]);
    expect(falseMatches, 'allowlist entries that match cases which do not diverge: narrow or remove them').toEqual([]);
    for (const entry of KNOWN_DIVERGENCES) {
      expect(entry.reason.length).toBeGreaterThan(20);
      expect(hits.get(entry.name) ?? 0, `${entry.name} no longer matches a divergence: remove it`).toBeGreaterThan(0);
    }
  });

  it('a record of another persona is not representable and is denied', () => {
    const org = differentialOrg();
    const m = memory({ content: 'x', scope: { kind: 'private', personId: 'reza' } });
    expect(buildPolicyMapping({ org, memory: m, readerPersonId: 'reza', audience: ['reza'], personaId: 'other', now: NOW })).toBeNull();
    expect(adaptiveAllowsAudience(org, m, ['reza'], 'other', NOW)).toBe(false);
    expect(adaptiveAllowsAudience(org, m, ['reza'], PERSONA, NOW)).toBe(true);
  });
});

describe('Studio-mapped groups and historyPolicy', () => {
  const state = {
    members: [
      { telegramId: 100, name: 'Owner', role: 'owner', joinedAt: '2026-01-01T00:00:00Z' },
      { telegramId: 300, name: 'Alice', role: 'member', joinedAt: '2026-01-01T00:00:00Z' },
      { telegramId: 400, name: 'Bob', role: 'member', joinedAt: '2026-10-15T00:00:00Z' },
    ],
    agents: [],
    groups: [
      { chatId: -1001, title: 'Open history', memberIds: [300, 400], hasGuests: false, agentIds: ['agent-1'], historyPolicy: 'all_authorized_history', addedAt: '2026-01-01T00:00:00Z' },
      { chatId: -1002, title: 'Default', memberIds: [300, 400], hasGuests: false, agentIds: ['agent-1'], addedAt: '2026-01-01T00:00:00Z' },
    ],
    audit: [],
  } as unknown as StudioState;

  it('a member who joined after creation is denied by both under both policies until re-snapshotted', () => {
    const org = studioToOrg(state);
    expect(org.getGroup('chat-1001')?.historyPolicy).toBe('all_authorized_history');
    expect('historyPolicy' in org.getGroup('chat-1002')!).toBe(false);
    for (const groupId of ['chat-1001', 'chat-1002']) {
      const before = memory({ id: `m-${groupId}`, personaId: 'agent-1', content: 'x', scope: { kind: 'group', groupId }, authorizedPersonIds: ['tg-300'],
        source: { personId: 'tg-300', chatKind: 'group', groupId, at: new Date('2026-10-10T00:00:00Z') } });
      const mapping = buildPolicyMapping({ org, memory: before, readerPersonId: 'tg-300', audience: ['tg-300'], personaId: 'agent-1', now: NOW })!;
      expect(mapping.snapshot.container.historyPolicy).toBe(groupId === 'chat-1001' ? 'all_authorized_history' : 'since_membership');
      for (const audience of [['tg-400'], ['tg-300', 'tg-400']]) {
        expect(isVisibleToAudience(org, before, audience)).toBe(false);
        expect(adaptiveAllowsAudience(org, before, audience, 'agent-1', NOW)).toBe(false);
      }
      expect(isVisibleToAudience(org, before, ['tg-300'])).toBe(true);
      expect(adaptiveAllowsAudience(org, before, ['tg-300'], 'agent-1', NOW)).toBe(true);

      const after = { ...before, ...resnapshotPatch(before, groupId, 'tg-400')! };
      expect(after.authorizedPersonIds).toEqual(['tg-300', 'tg-400']);
      for (const audience of [['tg-400'], ['tg-300', 'tg-400']]) {
        expect(isVisibleToAudience(org, after, audience)).toBe(true);
        expect(adaptiveAllowsAudience(org, after, audience, 'agent-1', NOW)).toBe(true);
      }
    }
  });
});
