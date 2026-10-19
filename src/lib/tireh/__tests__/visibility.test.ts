import { describe, it, expect } from 'vitest';
import { audienceOf, canPersonSee, isVisibleInChat, isVisibleToAudience, parseScopeKey, scopeKey } from '../memory/visibility';
import { memory, testOrg, testOrgConfig } from './fixtures';
import { OrgDirectory } from '../org/directory';
import { buildSystemPrompt } from '../conversation/prompt';
import type { ChatContext, MemoryScope } from '../types';

const org = testOrg();
const gameendGroup = org.getGroup('gameend-team')!;

describe('canPersonSee', () => {
  it('private memories belong to one person only', () => {
    const scope: MemoryScope = { kind: 'private', personId: 'reza' };
    expect(canPersonSee(org, 'reza', scope)).toBe(true);
    expect(canPersonSee(org, 'parastoo', scope)).toBe(false);
  });

  it('project memories are visible to project members only', () => {
    const scope: MemoryScope = { kind: 'project', projectId: 'gameend' };
    expect(canPersonSee(org, 'milad', scope)).toBe(true);
    expect(canPersonSee(org, 'sina', scope)).toBe(false);
  });

  it('group memories are visible to group members only', () => {
    const scope: MemoryScope = { kind: 'group', groupId: 'leads' };
    expect(canPersonSee(org, 'parastoo', scope)).toBe(true);
    expect(canPersonSee(org, 'milad', scope)).toBe(false);
  });

  it('company memories respect company boundaries', () => {
    const scope: MemoryScope = { kind: 'company', companyId: 'ludaxis' };
    expect(canPersonSee(org, 'milad', scope)).toBe(true);
    expect(canPersonSee(org, 'sina', scope)).toBe(false);
  });

  it('org memories are visible to every member and no outsider', () => {
    expect(canPersonSee(org, 'sina', { kind: 'org' })).toBe(true);
    expect(canPersonSee(org, 'nobody', { kind: 'org' })).toBe(false);
  });
});

describe('isVisibleToAudience', () => {
  const dm: ChatContext = { kind: 'private', chatKey: 'private-reza', personId: 'reza' };
  const group: ChatContext = { kind: 'group', chatKey: 'group-gameend-team', group: gameendGroup };

  it('the audience of a group is every registered member, not just speakers', () => {
    expect(audienceOf(group).sort()).toEqual(['milad', 'parastoo', 'reza']);
    expect(audienceOf(dm)).toEqual(['reza']);
  });

  it("excludes someone's private memory from a group they are in", () => {
    const m = memory({ content: 'Reza is planning a surprise for Parastoo', scope: { kind: 'private', personId: 'reza' } });
    expect(isVisibleToAudience(org, m, audienceOf(dm))).toBe(true);
    expect(isVisibleToAudience(org, m, audienceOf(group))).toBe(false);
  });

  it('requires EVERY audience member to have access', () => {
    const leadsOnly = memory({ content: 'Budget is tight', scope: { kind: 'group', groupId: 'leads' } });
    // Milad is in the GameEnd group but not in Leads → hidden there
    expect(isVisibleToAudience(org, leadsOnly, audienceOf(group))).toBe(false);
  });

  it('personal memories never leave a one-to-one chat with their owner', () => {
    const personal = memory({
      content: "Reza's father is unwell",
      sensitivity: 'personal',
      scope: { kind: 'private', personId: 'reza' },
    });
    expect(isVisibleToAudience(org, personal, ['reza'])).toBe(true);
    expect(isVisibleToAudience(org, personal, ['reza', 'parastoo'])).toBe(false);
    // even if someone mistakenly widened its scope
    const widened = { ...personal, scope: { kind: 'org' } as MemoryScope };
    expect(isVisibleToAudience(org, widened, ['reza'])).toBe(false);
  });

  it('an empty audience sees nothing', () => {
    expect(isVisibleToAudience(org, memory({ content: 'x', scope: { kind: 'org' } }), [])).toBe(false);
  });

  it('a one-member group is still not a private conversation for personal memories', () => {
    const personal = memory({ content: 'Private family detail', sensitivity: 'personal', scope: { kind: 'private', personId: 'reza' } });
    expect(isVisibleInChat(org, personal, dm)).toBe(true);
    expect(isVisibleInChat(org, personal, { ...group, group: { ...gameendGroup, memberIds: ['reza'] } })).toBe(false);
  });
});

describe('scope keys', () => {
  it('round-trip', () => {
    const scopes: MemoryScope[] = [
      { kind: 'private', personId: 'reza' },
      { kind: 'group', groupId: 'leads' },
      { kind: 'project', projectId: 'gameend' },
      { kind: 'company', companyId: 'ludaxis' },
      { kind: 'org' },
    ];
    for (const scope of scopes) expect(parseScopeKey(scopeKey(scope))).toEqual(scope);
    expect(parseScopeKey('weird:x')).toBeNull();
    expect(parseScopeKey('private')).toBeNull();
  });
});

describe('guests (people outside the organization)', () => {
  const config = testOrgConfig();
  config.people.push({ id: 'sam', name: 'Sam', role: 'Guest', telegramUserId: 999, companyIds: [], projectIds: [], guest: true });
  config.groups.push({ id: 'open', name: 'Open chat', telegramChatId: -42, memberIds: ['reza', 'sam'], hasGuests: true });
  const withGuest = new OrgDirectory(config);

  it('see only their own private memories and their groups, never org, company or project knowledge', () => {
    expect(canPersonSee(withGuest, 'sam', { kind: 'private', personId: 'sam' })).toBe(true);
    expect(canPersonSee(withGuest, 'sam', { kind: 'private', personId: 'reza' })).toBe(false);
    expect(canPersonSee(withGuest, 'sam', { kind: 'group', groupId: 'open' })).toBe(true);
    expect(canPersonSee(withGuest, 'sam', { kind: 'group', groupId: 'leads' })).toBe(false);
    expect(canPersonSee(withGuest, 'sam', { kind: 'org' })).toBe(false);
    expect(canPersonSee(withGuest, 'sam', { kind: 'company', companyId: 'ludaxis' })).toBe(false);
    expect(canPersonSee(withGuest, 'sam', { kind: 'project', projectId: 'gameend' })).toBe(false);
    // Members are unaffected.
    expect(canPersonSee(withGuest, 'reza', { kind: 'org' })).toBe(true);
  });

  it('an org memory is hidden from any conversation a guest can read', () => {
    const orgFact = memory({ scope: { kind: 'org' } });
    expect(isVisibleToAudience(withGuest, orgFact, ['reza'])).toBe(true);
    expect(isVisibleToAudience(withGuest, orgFact, ['reza', 'sam'])).toBe(false);
  });

  it('keeps the org chart and reporting lines out of the prompt when a guest is present', () => {
    const persona = { ...withGuest.getPersona('aria')!, strangerPolicy: 'Chats about design; keeps plans private.' };
    const guestPrompt = buildSystemPrompt({ org: withGuest, persona, chat: { kind: 'private', personId: 'sam', chatKey: 'p:sam' } as ChatContext, speakerId: 'sam', memories: [] });
    expect(guestPrompt).toContain('Sam (not part of HOOR)');
    expect(guestPrompt).toContain('Chats about design; keeps plans private.');
    for (const hidden of ['## Organization', 'How people relate', 'You report to', 'Parastoo', 'Executive']) expect(guestPrompt).not.toContain(hidden);
    const memberPrompt = buildSystemPrompt({ org: withGuest, persona, chat: { kind: 'private', personId: 'reza', chatKey: 'p:reza' } as ChatContext, speakerId: 'reza', memories: [] });
    expect(memberPrompt).toContain('## Organization');
    expect(memberPrompt).not.toContain('- Sam');
  });
});
