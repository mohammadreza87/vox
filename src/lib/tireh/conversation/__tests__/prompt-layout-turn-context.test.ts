/**
 * S03 x 962e877 (group agents): the turn-context lines (what this turn can see,
 * a quoted reply, the register to mirror) are per-turn only. They must never
 * enter the cacheable system blocks A/B/C, which stay byte-identical whatever
 * the turn context is. Closes WAVE_A_ON_MAIN.md open issue 3 (no committed
 * test pinned this). Pure: no provider, no network, no filesystem.
 */
import { describe, expect, it } from 'vitest';
import type { ChatContext } from '../../types';
import { testOrg } from '../../__tests__/fixtures';
import { buildPromptLayout } from '../prompt';

const org = testOrg();
const persona = org.getPersona('aria')!;
const NOW = new Date('2026-10-19T10:00:00Z');
const QUOTED_NAME = 'QuoteCanaryName';
const VISIBLE = 'are the recent lines visible to you in this group';
const ONLY_LATEST = 'You see only the latest message';
const GROUP_RECENT = 'this group\'s recent conversation';
const QUOTE = 'The latest message replies to';
const INFORMAL = 'They address you with تو forms';
const FORMAL = 'They address you with شما forms';

type LayoutInput = Parameters<typeof buildPromptLayout>[0];
const chats: Array<[string, ChatContext, 'work' | 'personal']> = [
  ['private work', { kind: 'private', chatKey: 'private-reza', personId: 'reza' } as ChatContext, 'work'],
  ['private personal', { kind: 'private', chatKey: 'private-reza', personId: 'reza' } as ChatContext, 'personal'],
  ['group', { kind: 'group', chatKey: 'group-gameend-team', group: org.getGroup('gameend-team')! } as ChatContext, 'work'],
];
const variants: Array<[string, Partial<LayoutInput>, string[]]> = [
  ['recent window', { recentWindow: true }, [VISIBLE]],
  ['history hidden with a quote of someone else', { historyVisible: false, replyQuote: { who: QUOTED_NAME, text: 'x', own: false } }, [ONLY_LATEST, QUOTE, QUOTED_NAME]],
  ['history visible with an own quote', { historyVisible: true, replyQuote: { who: persona.name, text: 'x', own: true } }, [GROUP_RECENT, QUOTE]],
  ['informal register', { register: 'informal' }, [INFORMAL]],
  ['formal register', { register: 'formal' }, [FORMAL]],
];
const GROUP_ONLY = new Set([VISIBLE, ONLY_LATEST, GROUP_RECENT]);
const ALL_MARKERS = [VISIBLE, ONLY_LATEST, GROUP_RECENT, QUOTE, QUOTED_NAME, INFORMAL, FORMAL];

describe('S03 layout: 962e877 turn-context lines stay out of blocks A/B/C', () => {
  for (const [chatName, chat, space] of chats) {
    const build = (extra: Partial<LayoutInput>) =>
      buildPromptLayout({ org, persona, chat, speakerId: 'reza', memories: [], now: NOW, space, ...extra });
    const base = build({});

    it(`${chatName}: no turn-context marker appears in any system block`, () => {
      for (const [, extra] of variants) {
        const layout = build(extra);
        for (const block of layout.system) for (const marker of ALL_MARKERS) expect(block.text).not.toContain(marker);
      }
    });

    for (const [variantName, extra, expected] of variants) {
      it(`${chatName}, ${variantName}: blocks A/B/C and their hashes are byte-identical to a turn without context`, () => {
        const layout = build(extra);
        expect(layout.system).toStrictEqual(base.system);
        expect(layout.hashes).toStrictEqual(base.hashes);
        for (const marker of expected) {
          if (chat.kind !== 'group' && GROUP_ONLY.has(marker)) continue;
          expect(layout.turn).toContain(marker);
        }
      });
    }
  }
});
