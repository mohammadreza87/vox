/**
 * Differential oracle (docs/AGENT_INTELLIGENCE_SOLUTION.md section 5, Step 8):
 * visibility.isVisibleToAudience and adaptive authorizeAccess, through the
 * independent PolicySnapshotBuilder, must agree (allow/deny) on every fixture
 * and every generated audience. Deterministic: no randomness.
 *
 * Modelling notes (documented non-divergences, not allowlist entries):
 *  - Identity: TIREH trusts the transport-authenticated id; adaptive needs a
 *    verified binding, so the builder always synthesizes one per reader.
 *    Identity levels are not compared here.
 *  - Time: joinedAt is 0 for every snapshot member. The history fence is the
 *    authorizedPersonIds snapshot, so historyPolicy never widens by itself.
 *  - Guests in a group chat (hasGuests) are handled by isMemoryAllowedInChat,
 *    outside this per-audience comparison.
 *  - Legacy rows without authorizedPersonIds: both deny for dynamic scopes
 *    (no trustworthy original audience); private and people fall back to
 *    their intrinsic audience in both.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { isVisibleToAudience, scopeKey, snapshotScopeAudience } from '../memory/visibility';
import { resnapshotPatch } from '../memory/sharing';
import { OrgDirectory } from '../org/directory';
import { adaptiveAllowsAudience, buildPolicyMapping } from '../policy/snapshot';
import type { MemoryRecord, MemoryScope, MemorySensitivity, OrgConfig } from '../types';
import { studioToOrg } from '../../studio/org-bridge';
import type { StudioState } from '../../studio/types';
import { memory, testOrg, testOrgConfig } from './fixtures';

const NOW = Date.parse('2026-10-20T00:00:00Z');
const PERSONA = 'aria';

interface Divergence { name: string; backlog: string; reason: string; match(m: MemoryRecord, audience: readonly string[], org: OrgDirectory): boolean }

/** Every entry must carry a reason and a backlog id, and must match only real divergences. Never silence a whole scope kind. */
const KNOWN_DIVERGENCES: Array<Divergence> = [
  {
    name: 'duplicate-reader-sensitive-private',
    backlog: 'S08-DIFF-1',
    reason: 'visibility.ts counts raw audience entries for personal/confidential records (length must be exactly 1), so a duplicated owner id fails closed; adaptive requires a unique known audience, so the builder de-duplicates first. Chat audiences come from audienceOf(), which de-duplicates, so production never passes duplicates.',
    match: (m, audience, org) => m.sensitivity !== 'normal' && m.scope.kind === 'private' && !m.supersededBy && audience.length > 1 &&
      new Set(audience).size === 1 && audience[0] === m.scope.personId && !!org.getPerson(m.scope.personId),
  },
];
const DOCUMENTED_DIVERGENCES = ['duplicate-reader-sensitive-private'];

function guestOrg(): OrgDirectory {
  const config = testOrgConfig();
  const withGuest: OrgConfig = {
    ...config,
    people: [...config.people, { id: 'visitor', name: 'Visitor', role: 'Guest', companyIds: [], projectIds: [], guest: true }],
    groups: config.groups.map((g) => (g.id === 'leads' ? { ...g, memberIds: [...g.memberIds, 'visitor'] } : g)),
  };
  return new OrgDirectory(withGuest);
}

function openHistoryOrg(): OrgDirectory {
  const base = guestOrg().config;
  return new OrgDirectory({ ...base, groups: base.groups.map((g) => ({ ...g, historyPolicy: 'all_authorized_history' as const })) });
}

const PEOPLE = ['reza', 'parastoo', 'milad', 'sina', 'visitor'];

function subsets<T>(items: readonly T[], max: number): T[][] {
  const out: T[][] = [];
  const walk = (start: number, current: T[]) => {
    if (current.length) out.push([...current]);
    if (current.length === max) return;
    for (let i = start; i < items.length; i++) walk(i + 1, [...current, items[i]]);
  };
  walk(0, []);
  return out;
}

function scopes(): MemoryScope[] {
  return [
    ...PEOPLE.map((personId): MemoryScope => ({ kind: 'private', personId })),
    ...subsets(PEOPLE, 3).map((personIds): MemoryScope => ({ kind: 'people', personIds })),
    { kind: 'group', groupId: 'gameend-team' },
    { kind: 'group', groupId: 'leads' },
    { kind: 'project', projectId: 'gameend' },
    { kind: 'company', companyId: 'ludaxis' },
    { kind: 'company', companyId: 'joyixir' },
    { kind: 'org' },
  ];
}

const SENSITIVITIES: MemorySensitivity[] = ['normal', 'personal', 'confidential'];
type AuthMode = 'default' | 'legacy' | 'subset' | 'empty' | 'snapshot';
const AUTH_MODES: AuthMode[] = ['default', 'legacy', 'subset', 'empty', 'snapshot'];

interface Case { m: MemoryRecord; label: string }

function corpus(org: OrgDirectory): Case[] {
  const rows: Case[] = [];
  let n = 0;
  for (const scope of scopes()) for (const sensitivity of SENSITIVITIES) for (const mode of AUTH_MODES) for (const superseded of [false, true]) {
    const base = memory({ id: `diff-${n++}`, content: 'differential fixture', scope, sensitivity });
    const authorizedPersonIds = mode === 'default' ? base.authorizedPersonIds
      : mode === 'legacy' ? undefined
        : mode === 'subset' ? base.authorizedPersonIds?.slice(0, -1)
          : mode === 'empty' ? []
            : snapshotScopeAudience(org, scope);
    rows.push({
      m: { ...base, authorizedPersonIds, ...(superseded ? { supersededBy: 'diff-next' } : {}) },
      label: `${scopeKey(scope)} sensitivity=${sensitivity} auth=${mode}${superseded ? ' superseded' : ''}`,
    });
  }
  return rows;
}

function audiences(): string[][] {
  return [...subsets([...PEOPLE, 'unknown-x'], 3), ['reza', 'reza'], ['visitor', 'visitor'], ['reza', 'parastoo', 'reza'], ['sina', 'sina']];
}

function compare(org: OrgDirectory) {
  const unexplained: string[] = [];
  const falseMatches: string[] = [];
  const hits = new Map<string, number>();
  let allowed = 0;
  let checked = 0;
  const groups = audiences();
  for (const { m, label } of corpus(org)) for (const audience of groups) {
    checked++;
    const visibility = isVisibleToAudience(org, m, audience);
    const adaptive = adaptiveAllowsAudience(org, m, audience, PERSONA, NOW);
    if (visibility) allowed++;
    const entry = KNOWN_DIVERGENCES.find((d) => d.match(m, audience, org));
    // The message carries a scope key, sensitivity, authorization mode and audience; never content.
    const message = `${label} audience=[${audience.join(',')}] visibility=${visibility} adaptive=${adaptive}`;
    if (entry) {
      if (visibility === adaptive) falseMatches.push(`${entry.name}: ${message}`);
      else hits.set(entry.name, (hits.get(entry.name) ?? 0) + 1);
    } else if (visibility !== adaptive) unexplained.push(message);
  }
  return { unexplained, falseMatches, hits, allowed, checked };
}

describe('visibility vs adaptive policy differential', () => {
  it('KNOWN_DIVERGENCES is exactly the documented list, each with a reason and a backlog id', () => {
    expect(KNOWN_DIVERGENCES.map((d) => d.name)).toEqual(DOCUMENTED_DIVERGENCES);
    for (const d of KNOWN_DIVERGENCES) {
      expect(d.reason.length).toBeGreaterThan(40);
      expect(d.backlog).toMatch(/^S08-DIFF-\d+$/);
    }
  });

  it('snapshot.ts derives memberships without the visibility decision functions', () => {
    const source = readFileSync(join(__dirname, '..', 'policy', 'snapshot.ts'), 'utf8');
    for (const name of ['canPersonSee', 'isVisibleToAudience', 'isMemoryAllowedInChat', 'snapshotScopeAudience', 'audienceOf']) {
      expect(source.includes(name), `snapshot.ts must not use ${name}`).toBe(false);
    }
  });

  for (const [name, make] of [['testOrg', testOrg], ['guest org', guestOrg], ['all_authorized_history org', openHistoryOrg]] as const) {
    it(`agrees on every fixture and generated audience: ${name}`, () => {
      const org = make();
      const { unexplained, falseMatches, hits, allowed, checked } = compare(org);
      expect(checked).toBeGreaterThan(30_000);
      expect(allowed).toBeGreaterThan(500);
      expect(unexplained, 'unexplained divergences').toEqual([]);
      expect(falseMatches, 'allowlist entries matching cases that do not diverge').toEqual([]);
      for (const entry of KNOWN_DIVERGENCES) expect(hits.get(entry.name) ?? 0, `${entry.name} no longer diverges: remove it`).toBeGreaterThan(0);
    });
  }

  it('buildPolicyMapping returns null for sensitive non-private records', () => {
    const org = testOrg();
    for (const sensitivity of ['personal', 'confidential'] as const) {
      for (const scope of [{ kind: 'people', personIds: ['reza', 'parastoo'] }, { kind: 'group', groupId: 'leads' }, { kind: 'org' }] as MemoryScope[]) {
        expect(buildPolicyMapping({ org, memory: memory({ content: 'x', scope, sensitivity }), readerPersonId: 'reza', audience: ['reza'], personaId: PERSONA, now: NOW })).toBeNull();
      }
      expect(buildPolicyMapping({ org, memory: memory({ content: 'x', scope: { kind: 'private', personId: 'reza' }, sensitivity }), readerPersonId: 'reza', audience: ['reza'], personaId: PERSONA, now: NOW })).not.toBeNull();
    }
  });

  it("another agent's record is denied by the oracle for every scope, while the same record of this agent is allowed", () => {
    // visibility.ts has no persona argument: persona isolation is the stores' listActive(personaId).
    // The oracle must not be more permissive than that, so it denies a record of another persona outright.
    const org = testOrg();
    for (const scope of [{ kind: 'private', personId: 'reza' }, { kind: 'people', personIds: ['reza', 'parastoo'] }, { kind: 'org' }] as MemoryScope[]) {
      const own = memory({ content: 'x', scope });
      const other = { ...own, personaId: 'other-agent' };
      expect(adaptiveAllowsAudience(org, own, ['reza'], PERSONA, NOW)).toBe(true);
      expect(buildPolicyMapping({ org, memory: other, readerPersonId: 'reza', audience: ['reza'], personaId: PERSONA, now: NOW })).toBeNull();
      expect(adaptiveAllowsAudience(org, other, ['reza'], PERSONA, NOW)).toBe(false);
    }
  });

  it('an empty audience is denied', () => {
    const org = testOrg();
    const m = memory({ content: 'x', scope: { kind: 'org' } });
    expect(adaptiveAllowsAudience(org, m, [], PERSONA, NOW)).toBe(false);
    expect(isVisibleToAudience(org, m, [])).toBe(false);
  });

  it("historyPolicy 'all_authorized_history' does not make a non-snapshot member visible", () => {
    const org = openHistoryOrg();
    const m = memory({ content: 'x', scope: { kind: 'group', groupId: 'gameend-team' }, authorizedPersonIds: ['reza', 'parastoo'] });
    expect(org.isGroupMember('milad', 'gameend-team')).toBe(true);
    expect(buildPolicyMapping({ org, memory: m, readerPersonId: 'milad', audience: ['milad'], personaId: PERSONA, now: NOW })!.snapshot.container.historyPolicy).toBe('all_authorized_history');
    expect(adaptiveAllowsAudience(org, m, ['milad'], PERSONA, NOW)).toBe(false);
    expect(isVisibleToAudience(org, m, ['milad'])).toBe(false);
    expect(adaptiveAllowsAudience(org, m, ['reza', 'parastoo'], PERSONA, NOW)).toBe(true);
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

  it('a member who joined later is denied by both under both policies until re-snapshotted', () => {
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
