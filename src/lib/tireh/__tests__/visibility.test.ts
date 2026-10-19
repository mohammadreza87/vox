import { describe, it, expect } from 'vitest';
import { audienceOf, canPersonSee, isVisibleToAudience, parseScopeKey, scopeKey } from '../memory/visibility';
import { memory, testOrg } from './fixtures';
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
