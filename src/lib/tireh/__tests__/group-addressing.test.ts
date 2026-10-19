import { describe, expect, it } from 'vitest';
import { groupAddressing } from '../group-addressing';
import type { TelegramMessage, TelegramUser } from '../telegram/client';
import type { Persona } from '../types';

const neda: Persona = {
  id: 'neda', name: 'Neda', role: 'Companion', personality: 'Warm and curious', communicationStyle: 'Brief',
  values: [], voice: { elevenLabsVoiceId: '', description: '' }, ownerId: 'owner', identityVersion: 1,
  replyWithVoice: 'mirror', telegramUsername: 'hoor_neda_bot', telegramId: 700,
};
const user = (id: number, username?: string, isBot = false): TelegramUser => ({ id, username, is_bot: isBot, first_name: 'Test person' });
const message = (text: string, extra: Partial<TelegramMessage> = {}): TelegramMessage => ({
  message_id: 1, from: user(100), chat: { id: -500, type: 'supergroup' }, date: 0, text, ...extra,
});
const reply = (author: TelegramUser): TelegramMessage => message('Earlier message', { from: author });

describe('groupAddressing', () => {
  it.each([
    ['@hoor_neda_bot, what do you think?', true],
    ['Hi @HOOR_NEDA_BOT!', true],
    ['(@hoor_neda_bot)', true],
    ['@hoor_neda_bot_extra, hello', false],
    ['@hoor_neda_bot123, hello', false],
    ['user@hoor_neda_bot.example', false],
    ['x@hoor_neda_bot', false],
    ['@hoor_neda_botندا', false],
  ])('matches complete username tokens in %s', (text, direct) => {
    expect(groupAddressing(neda, message(text)).direct).toBe(direct);
  });

  it('does not accept an entity that covers only the prefix of a longer username', () => {
    expect(groupAddressing(neda, message('@hoor_neda_bot_extra, hello', {
      entities: [{ type: 'mention', offset: 0, length: '@hoor_neda_bot'.length }],
    }))).toEqual({ direct: false, otherTarget: false });
  });

  it('resolves a text_mention by Telegram id even without a username or matching display name', () => {
    const target = user(700, undefined, true);
    expect(groupAddressing(neda, message('Ask our producer', {
      entities: [{ type: 'text_mention', offset: 4, length: 12, user: target }],
    }))).toEqual({ direct: true, otherTarget: false });
  });

  it('does not let another linked user claim this persona through its display label', () => {
    expect(groupAddressing(neda, message('Neda, hello', {
      entities: [{ type: 'text_mention', offset: 0, length: 4, user: user(999) }],
    }))).toEqual({ direct: false, otherTarget: false });
    expect(groupAddressing(neda, message('@hoor_neda_bot, hello', {
      entities: [{ type: 'text_mention', offset: 0, length: '@hoor_neda_bot'.length, user: user(999, 'otherbot', true) }],
    }))).toEqual({ direct: false, otherTarget: true });
  });

  it('uses UTF-16 entity offsets and the caption entities for media', () => {
    expect(groupAddressing(neda, message('', {
      text: undefined, caption: '🌟 Ask her',
      caption_entities: [{ type: 'text_mention', offset: 7, length: 3, user: user(700, undefined, true) }],
    }))).toEqual({ direct: true, otherTarget: false });
  });

  it.each([
    { offset: -1, length: 2 }, { offset: 0.5, length: 2 }, { offset: 0, length: 0 },
    { offset: 0, length: 99 }, { offset: Number.NaN, length: 2 },
  ])('ignores malformed entity range %j', (range) => {
    expect(groupAddressing(neda, message('her', {
      entities: [{ type: 'text_mention', ...range, user: user(700, undefined, true) }],
    }))).toEqual({ direct: false, otherTarget: false });
  });

  it('recognizes replies by bot id even after its username changed', () => {
    expect(groupAddressing(neda, message('What about tomorrow?', { reply_to_message: reply(user(700, 'renamed_bot', true)) })))
      .toEqual({ direct: true, otherTarget: false });
  });

  it('uses a case-insensitive reply username when the persona has no bot id', () => {
    expect(groupAddressing({ ...neda, telegramId: undefined }, message('And this?', {
      reply_to_message: reply(user(700, 'HOOR_NEDA_BOT', true)),
    }))).toEqual({ direct: true, otherTarget: false });
  });

  it('does not let a mismatched bot id override trusted identity through a stale username', () => {
    expect(groupAddressing(neda, message('And this?', { reply_to_message: reply(user(999, 'hoor_neda_bot', true)) })))
      .toEqual({ direct: false, otherTarget: true });
  });

  it.each([
    ['Neda, hello!', true], ['Hi NEDA.', true], ['Nedalee, hello', false],
    ['Neda2', false], ['other_Neda', false], ['@Neda', false], ['Neda@example.test', false],
  ])('uses Unicode-aware display-name boundaries in %s', (text, direct) => {
    expect(groupAddressing(neda, message(text)).direct).toBe(direct);
  });

  it('matches full Persian names and does not match a prefix or a ZWNJ-connected word', () => {
    const persian = { ...neda, name: 'ندا سهرابی' };
    expect(groupAddressing(persian, message('ندا سهرابی، نظرت چیه؟')).direct).toBe(true);
    expect(groupAddressing(persian, message('ندا، نظرت چیه؟')).direct).toBe(false);
    expect(groupAddressing({ ...neda, name: 'ندا' }, message('ندا\u200cجان')).direct).toBe(false);
  });

  it('normalizes canonically equivalent names and treats name punctuation literally', () => {
    expect(groupAddressing({ ...neda, name: 'Zoë Ann' }, message('Zoe\u0308 Ann, hello')).direct).toBe(true);
    expect(groupAddressing({ ...neda, name: 'Neda (QA)' }, message('Neda (QA), hello')).direct).toBe(true);
    expect(groupAddressing({ ...neda, name: 'Neda (QA)' }, message('Neda QAAAA, hello')).direct).toBe(false);
  });

  it('marks another bot mention or bot reply as another target, without treating human mentions that way', () => {
    expect(groupAddressing(neda, message('@weatherbot forecast?'))).toEqual({ direct: false, otherTarget: true });
    expect(groupAddressing(neda, message('And this?', { reply_to_message: reply(user(999, 'weatherbot', true)) })))
      .toEqual({ direct: false, otherTarget: true });
    expect(groupAddressing(neda, message('@alice, lunch?'))).toEqual({ direct: false, otherTarget: false });
    expect(groupAddressing(neda, message('Ask her', {
      entities: [{ type: 'text_mention', offset: 4, length: 3, user: user(999, undefined, true) }],
    }))).toEqual({ direct: false, otherTarget: true });
  });

  it('lets a direct request to this persona win even when another bot is targeted too', () => {
    expect(groupAddressing(neda, message('@weatherbot and @hoor_neda_bot, compare these.'))).toEqual({ direct: true, otherTarget: false });
    expect(groupAddressing(neda, message('Neda, what do you think?', { reply_to_message: reply(user(999, 'weatherbot', true)) })))
      .toEqual({ direct: true, otherTarget: false });
  });
});
