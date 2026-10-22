/**
 * Synthetic HOOR-style organization for the EN/FA memory eval. All names and
 * facts are invented. Arman left gameend-team and the GameEnd project after
 * some records were snapshotted with him in authorizedPersonIds; Negar is a
 * guest who only shares the partners group.
 */
import { parseOrgConfig } from '../../org/config';
import { OrgDirectory } from '../../org/directory';
import type { ChatContext, OrgConfig } from '../../types';

export const EVAL_NOW = new Date('2026-10-20T12:00:00Z');

export const TELEGRAM = { reza: 3001, parastoo: 3002, milad: 3003, sina: 3004, negar: 3005, arman: 3006 } as const;
export const CHAT_IDS = { 'gameend-team': -300100, leads: -300200, partners: -300300 } as const;

export function evalOrgConfig(): OrgConfig {
  return parseOrgConfig({
    organization: { id: 'hoor', name: 'HOOR' },
    people: [
      { id: 'reza', name: 'Reza', role: 'HOOR / Super Admin', telegramUserId: TELEGRAM.reza, companyIds: ['ludaxis'] },
      { id: 'parastoo', name: 'Parastoo', role: 'Executive', managerId: 'reza', telegramUserId: TELEGRAM.parastoo, companyIds: ['ludaxis'] },
      { id: 'milad', name: 'Milad', role: 'Engineer', managerId: 'parastoo', telegramUserId: TELEGRAM.milad, companyIds: ['ludaxis'] },
      { id: 'sina', name: 'Sina', role: 'Producer', managerId: 'reza', telegramUserId: TELEGRAM.sina, companyIds: ['joyixir'] },
      { id: 'negar', name: 'Negar', role: 'Localization partner', telegramUserId: TELEGRAM.negar, companyIds: [], guest: true },
      { id: 'arman', name: 'Arman', role: 'Former GameEnd artist', managerId: 'parastoo', telegramUserId: TELEGRAM.arman, companyIds: ['ludaxis'] },
    ],
    relationships: [{ a: 'reza', b: 'parastoo', label: 'co-founders' }],
    companies: [
      { id: 'ludaxis', name: 'Ludaxis' },
      { id: 'joyixir', name: 'Joyixir' },
    ],
    projects: [
      { id: 'gameend', name: 'GameEnd', companyId: 'ludaxis', memberIds: ['reza', 'parastoo', 'milad'] },
      { id: 'kian', name: 'Kian', companyId: 'joyixir', memberIds: ['reza', 'milad', 'sina'] },
    ],
    groups: [
      { id: 'gameend-team', name: 'GameEnd Team', telegramChatId: CHAT_IDS['gameend-team'], memberIds: ['reza', 'parastoo', 'milad'], projectId: 'gameend' },
      { id: 'leads', name: 'Leads', telegramChatId: CHAT_IDS.leads, memberIds: ['reza', 'parastoo'] },
      { id: 'partners', name: 'Partners', telegramChatId: CHAT_IDS.partners, memberIds: ['reza', 'sina', 'negar'] },
    ],
    personas: [
      {
        id: 'aria',
        name: 'Aria',
        role: 'Product Lead',
        personality: 'Analytical and warm',
        communicationStyle: 'Concise',
        values: ['Truthfulness'],
        voice: { elevenLabsVoiceId: 'voice-aria', description: 'calm' },
        ownerId: 'reza',
        telegramUsername: 'hoor_aria_bot',
        replyWithVoice: 'never',
      },
    ],
  });
}

export function evalOrg(): OrgDirectory {
  return new OrgDirectory(evalOrgConfig());
}

/** A private chat ('p:<person>') or a group chat ('g:<group>'); partners is always heard with guests. */
export type AskerKey =
  | 'p:reza' | 'p:parastoo' | 'p:milad' | 'p:sina' | 'p:negar' | 'p:arman'
  | 'g:gameend-team' | 'g:leads' | 'g:partners';

export const ASKERS: readonly AskerKey[] = [
  'p:reza', 'p:parastoo', 'p:milad', 'p:sina', 'p:negar', 'p:arman', 'g:gameend-team', 'g:leads', 'g:partners',
];

export function chatFor(org: OrgDirectory, asker: AskerKey): ChatContext {
  const [kind, id] = asker.split(':') as ['p' | 'g', string];
  if (kind === 'p') return { kind: 'private', chatKey: `private-${id}`, personId: id };
  const group = org.getGroup(id)!;
  return { kind: 'group', chatKey: `group-${id}`, group: id === 'partners' ? { ...group, hasGuests: true } : group };
}
