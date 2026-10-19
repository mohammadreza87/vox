/**
 * Default HOOR organization seed, from the TIREH master spec.
 *
 * Telegram ids are intentionally absent: nobody can talk to a persona until
 * a deployment provides a config with real ids (see tireh.org.example.json).
 */

import type { OrgConfig } from '../types';

export const DEFAULT_ORG_CONFIG: OrgConfig = {
  organization: { id: 'hoor', name: 'HOOR' },
  people: [
    { id: 'reza', name: 'Reza', role: 'HOOR / Super Admin', companyIds: ['ludaxis', 'joyixir'], projectIds: [] },
    { id: 'parastoo', name: 'Parastoo', role: 'Executive', managerId: 'reza', companyIds: ['ludaxis'], projectIds: [] },
    { id: 'erfan-sh', name: 'Erfan Sh', role: 'Executive', managerId: 'reza', companyIds: ['ludaxis'], projectIds: [], notes: 'Erfan Sheikh Hosseini' },
    { id: 'erfan-k', name: 'Erfan K', role: 'Executive', managerId: 'reza', companyIds: ['ludaxis'], projectIds: [], notes: 'Erfan Kouzehgaran' },
    { id: 'milad', name: 'Milad', role: 'Team member', managerId: 'parastoo', companyIds: ['ludaxis'], projectIds: [] },
    { id: 'shadmehr', name: 'Shadmehr', role: 'Team member', managerId: 'erfan-sh', companyIds: ['ludaxis'], projectIds: [] },
    { id: 'sina', name: 'Sina', role: 'Team member', managerId: 'erfan-k', companyIds: ['ludaxis'], projectIds: [] },
  ],
  relationships: [],
  companies: [
    { id: 'ludaxis', name: 'Ludaxis' },
    { id: 'joyixir', name: 'Joyixir' },
  ],
  projects: [
    {
      id: 'gameend',
      name: 'GameEnd',
      companyId: 'ludaxis',
      memberIds: ['reza', 'parastoo', 'milad'],
      description: 'Game product line',
    },
  ],
  groups: [],
  personas: [
    {
      id: 'aria',
      name: 'Aria',
      role: 'Product Lead',
      personality:
        'Analytical, warm and direct. Skeptical of unsupported assumptions and comfortable challenging weak ideas, but always constructive.',
      communicationStyle:
        'Concise and conversational. Short paragraphs, no markdown headings. Asks one sharp question at a time.',
      values: ['Truthfulness over agreement', 'Evidence over opinion', 'Protect what people tell her in confidence'],
      voice: {
        elevenLabsVoiceId: 'EXAVITQu4vr4xnSDxMaL',
        description: 'Calm, clear female voice; medium pace; lightly expressive',
      },
      ownerId: 'reza',
      telegramUsername: 'hoor_aria_bot',
      identityVersion: 1,
      replyWithVoice: 'mirror',
    },
  ],
};
