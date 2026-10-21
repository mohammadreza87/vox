/**
 * S03: the whole existing memory-privacy suite with TIREH_CACHED_PROMPT=1, plus
 * a parity matrix: the cached layout renders exactly the memories, and the
 * same organization and outsider sections, as the legacy prompt.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPromptLayout, buildSystemPrompt, type PromptInput } from '../conversation/prompt';
import { OrgDirectory } from '../org/directory';
import type { ChatContext, MemoryRecord, MemoryScope } from '../types';
import { memory, testOrgConfig } from './fixtures';

// The cached arm only: TIREH_PROMPT_SYSTEM_TAIL is pinned off even when set in the process env.
const stub = () => {
  vi.stubEnv('TIREH_CACHED_PROMPT', '1');
  vi.stubEnv('TIREH_PROMPT_SYSTEM_TAIL', '');
};
stub();
beforeEach(stub);
afterAll(() => { vi.unstubAllEnvs(); });

await import('./memory-privacy.test');

const config = testOrgConfig();
config.people.push({ id: 'visitor', name: 'Visitor', role: 'Guest', telegramUserId: 9_999, companyIds: [], projectIds: [], guest: true });
const org = new OrgDirectory(config);
const persona = org.getPersona('aria')!;
const scopes: Record<string, MemoryScope> = {
  privateReza: { kind: 'private', personId: 'reza' },
  privateMilad: { kind: 'private', personId: 'milad' },
  people: { kind: 'people', personIds: ['reza', 'parastoo'] },
  groupLeads: { kind: 'group', groupId: 'leads' },
  groupGameEnd: { kind: 'group', groupId: 'gameend-team' },
  project: { kind: 'project', projectId: 'gameend' },
  company: { kind: 'company', companyId: 'ludaxis' },
  org: { kind: 'org' },
};
const CANARY = (name: string, sensitive = false) => `PARITY_${name}${sensitive ? '_SENSITIVE' : ''}_CANARY`;
const records: MemoryRecord[] = Object.entries(scopes).flatMap(([name, scope]) => [
  memory({ id: name, content: CANARY(name), scope }),
  memory({ id: `${name}-s`, content: CANARY(name, true), scope, sensitivity: 'personal' }),
]);
const chats: Record<string, ChatContext> = {
  'private reza': { kind: 'private', chatKey: 'private-reza', personId: 'reza' },
  'private milad': { kind: 'private', chatKey: 'private-milad', personId: 'milad' },
  'private guest': { kind: 'private', chatKey: 'private-visitor', personId: 'visitor' },
  'group leads': { kind: 'group', chatKey: 'group-leads', group: org.getGroup('leads')! },
  'group gameend': { kind: 'group', chatKey: 'group-gameend-team', group: org.getGroup('gameend-team')! },
  'guest group': { kind: 'group', chatKey: 'group-leads', group: { ...org.getGroup('leads')!, hasGuests: true } },
  'named guest group': { kind: 'group', chatKey: 'group-gameend-team', group: { ...org.getGroup('gameend-team')!, memberIds: [...org.getGroup('gameend-team')!.memberIds, 'visitor'] } },
};
const rendered = (text: string) => new Set(records.map((m) => m.content).filter((content) => text.includes(content)));

describe('cached layout renders the same memories and sections as the legacy prompt', () => {
  for (const [name, chat] of Object.entries(chats)) {
    for (const space of ['work', 'personal'] as const) {
      if (space === 'personal' && chat.kind !== 'private') continue;
      it(`${name} (${space})`, () => {
        const speakerId = chat.kind === 'private' ? chat.personId : 'reza';
        const input: PromptInput = { org, persona, chat, speakerId, memories: records, now: new Date('2026-10-19T10:00:00Z'), space };
        const legacy = buildSystemPrompt(input);
        const layout = buildPromptLayout(input);
        const cached = [...layout.system.map((b) => b.text), layout.turn].join('\n\n');
        expect(rendered(cached)).toEqual(rendered(legacy));
        for (const heading of ['## Organization', '## People outside', 'You report to']) expect(cached.includes(heading)).toBe(legacy.includes(heading));
        expect(layout.hashes.b === null).toBe(!legacy.includes('## Organization'));
      });
    }
  }

  it('renders some memories somewhere, so the parity is not vacuous', () => {
    const chat = chats['private reza'];
    const layout = buildPromptLayout({ org, persona, chat, speakerId: 'reza', memories: records, now: new Date('2026-10-19T10:00:00Z') });
    expect(rendered(layout.turn).size).toBeGreaterThan(2);
    expect(rendered(layout.system.map((b) => b.text).join('\n'))).toEqual(new Set());
  });
});
