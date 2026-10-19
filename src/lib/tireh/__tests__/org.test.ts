import { describe, it, expect } from 'vitest';
import { loadOrgConfig, parseOrgConfig } from '../org/config';
import { OrgDirectory } from '../org/directory';
import { DEFAULT_ORG_CONFIG } from '../org/default-org';
import { testOrg, testOrgConfig, TG } from './fixtures';

describe('org config', () => {
  it('loads the default HOOR seed with Aria and the TIREH reporting lines', () => {
    const org = new OrgDirectory(loadOrgConfig({}));
    expect(org.getPersona('aria')?.role).toBe('Product Lead');
    expect(org.getPerson('milad')?.managerId).toBe('parastoo');
    expect(org.getPerson('shadmehr')?.managerId).toBe('erfan-sh');
    expect(org.getPerson('sina')?.managerId).toBe('erfan-k');
    // No Telegram ids by default: nobody can talk to a persona until configured
    expect(org.listPeople().every((p) => p.telegramUserId === undefined)).toBe(true);
  });

  it('does not mutate the default seed', () => {
    loadOrgConfig({});
    expect(DEFAULT_ORG_CONFIG.people[0].projectIds).toEqual([]);
  });

  it('the documented example config is valid', () => {
    const config = loadOrgConfig({ TIREH_ORG_CONFIG_PATH: 'tireh.org.example.json' });
    expect(config.personas[0].id).toBe('aria');
    expect(config.groups[0].projectId).toBe('gameend');
  });

  it('loads from TIREH_ORG_CONFIG JSON', () => {
    const config = loadOrgConfig({ TIREH_ORG_CONFIG: JSON.stringify(testOrgConfig()) });
    expect(config.people.find((p) => p.id === 'reza')?.telegramUserId).toBe(TG.reza);
  });

  it('mirrors project membership onto people', () => {
    const org = testOrg();
    expect(org.getPerson('milad')?.projectIds).toEqual(['gameend']);
    expect(org.getPerson('sina')?.projectIds).toEqual([]);
  });

  it('reports every broken reference', () => {
    const bad = testOrgConfig();
    bad.people[1].managerId = 'ghost';
    bad.projects[0].memberIds.push('nobody');
    bad.personas[0].ownerId = 'ghost-owner';
    bad.groups[1].telegramChatId = bad.groups[0].telegramChatId;
    let message = '';
    try {
      parseOrgConfig(bad);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('person "parastoo" has unknown manager "ghost"');
    expect(message).toContain('duplicate group telegramChatId -100500');
    expect(message).toContain('project "gameend" has unknown member "nobody"');
    expect(message).toContain('persona "aria" has unknown owner "ghost-owner"');
  });

  it('rejects malformed ids and duplicate Telegram accounts', () => {
    const badId = testOrgConfig();
    badId.people[0].id = 'Not Kebab';
    expect(() => parseOrgConfig(badId)).toThrow();

    const dupTelegram = testOrgConfig();
    dupTelegram.people[1].telegramUserId = TG.reza;
    expect(() => parseOrgConfig(dupTelegram)).toThrow(/duplicate telegramUserId/);
  });
});

describe('OrgDirectory relationships', () => {
  const org = testOrg();

  it('knows reporting lines in both directions', () => {
    expect(org.describeRelationship('parastoo', 'milad')).toContain('Milad reports to Parastoo');
    expect(org.describeRelationship('milad', 'parastoo')).toContain('Milad reports to Parastoo');
  });

  it('knows peers, declared relationships and shared projects', () => {
    expect(org.describeRelationship('parastoo', 'sina')).toContain('Parastoo and Sina both report to Reza');
    const rezaParastoo = org.describeRelationship('reza', 'parastoo');
    expect(rezaParastoo).toContain('Reza and Parastoo: long-time collaborators');
    expect(rezaParastoo).toContain('Reza and Parastoo both work on GameEnd');
  });

  it('describes a person with manager, reports and projects', () => {
    expect(org.describePerson('parastoo')).toBe('Parastoo — Executive; reports to Reza; manages Milad; works on GameEnd');
  });

  it('resolves people by Telegram id and groups by chat id', () => {
    expect(org.getPersonByTelegramId(TG.parastoo)?.id).toBe('parastoo');
    expect(org.getPersonByTelegramId(TG.stranger)).toBeUndefined();
    expect(org.getGroupByChatId(-100500)?.id).toBe('gameend-team');
  });
});
