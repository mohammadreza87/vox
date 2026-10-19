/** Deterministic attention signals only; these never grant access to a group or persona. */
import type { TelegramMessage } from './telegram/client';
import type { Persona } from './types';

export function groupAddressing(persona: Persona, message: TelegramMessage): { direct: boolean; otherTarget: boolean } {
  const text = message.text ?? message.caption ?? '';
  const entities = message.text !== undefined ? message.entities : message.caption_entities;
  const username = persona.telegramUsername?.replace(/^@/, '').toLowerCase();
  let routingText = text;
  let direct = false;
  let otherTarget = false;
  const mention = (handle: string) => {
    if (username && handle.toLowerCase() === username) direct = true;
    else if (/bot$/i.test(handle)) otherTarget = true;
  };

  // Telegram offsets are UTF-16 code units, as are String.slice offsets.
  for (const entity of entities ?? []) {
    if (!Number.isInteger(entity.offset) || !Number.isInteger(entity.length)
      || entity.offset < 0 || entity.length <= 0 || entity.offset + entity.length > text.length) continue;
    if (entity.type === 'text_mention') {
      // A linked display label can name anyone: its target id is authoritative.
      routingText = routingText.slice(0, entity.offset) + ' '.repeat(entity.length) + routingText.slice(entity.offset + entity.length);
      if (entity.user) {
        if (persona.telegramId !== undefined && entity.user.id === persona.telegramId) direct = true;
        else if (entity.user.is_bot) otherTarget = true;
      }
    }
  }

  // Match complete username tokens, whether or not Telegram supplied entities.
  // Unicode boundaries exclude email addresses and username-prefix collisions.
  const mentions = /(^|[^\p{L}\p{N}\p{M}_@])@([A-Za-z0-9_]+)(?![\p{L}\p{N}\p{M}_])/gu;
  for (const match of routingText.matchAll(mentions)) mention(match[2]);

  const repliedTo = message.reply_to_message?.from;
  if (repliedTo?.is_bot) {
    const ownReply = persona.telegramId !== undefined
      ? repliedTo.id === persona.telegramId
      : !!username && repliedTo.username?.toLowerCase() === username;
    if (ownReply) direct = true;
    else otherTarget = true;
  }

  const name = persona.name.trim().normalize('NFC').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (name && new RegExp(`(^|[^\\p{L}\\p{N}\\p{M}_@\u200c\u200d])${name}(?=$|[^\\p{L}\\p{N}\\p{M}_@\u200c\u200d])`, 'iu').test(routingText.normalize('NFC'))) direct = true;

  return { direct, otherTarget: otherTarget && !direct };
}
