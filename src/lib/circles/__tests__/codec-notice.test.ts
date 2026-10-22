import { describe, expect, it } from 'vitest';
import { cardCallback, MAX_CALLBACK_BYTES, newJoinCode, parseCardCallback, parseCirclesMode, parseStartPayload, receiptIdFor, receiptOwner, startPayload } from '../codec';
import { agentCard, AGENT_NOTICE, choiceReceipt, copyHash, localeOf } from '../notice';

describe('circles codec', () => {
  it('reads STUDIO_CIRCLES fail-closed', () => {
    expect(['reply', 'circles', ' Reply ', 'off', '', undefined, 'on', 'true'].map(parseCirclesMode)).toEqual(['reply', 'circles', 'reply', 'off', 'off', 'off', 'off', 'off']);
  });

  it('callback data carries a short id within 64 bytes and round-trips', () => {
    const id = receiptIdFor(8_123_456_789);
    expect(id).toMatch(/^[0-9a-z]{1,11}-[A-Za-z0-9_-]{12}$/);
    expect(receiptOwner(id)).toBe(8_123_456_789);
    for (const bad of ['unknownReceipt', '-abcdefabcdef', '0-abcdefabcdef', 'Zz-abcdefabcdef', 'a-short']) expect(receiptOwner(bad), bad).toBeUndefined();
    for (const action of ['cj', 'cr', 'cd', 'ci', 'cs', 'cn'] as const) {
      const data = cardCallback(action, id);
      expect(Buffer.byteLength(data)).toBeLessThanOrEqual(MAX_CALLBACK_BYTES);
      expect(parseCardCallback(data)).toEqual({ action, id });
    }
    expect(() => cardCallback('cj', 'x'.repeat(41))).toThrow('invalid_card_callback');
    expect(() => cardCallback('cj', 'a:b')).toThrow('invalid_card_callback');
    for (const other of [undefined, '', 'share:abc', 'keep:abc', 'cx:abc', 'cj:', 'cj:a b', 'cj:é', `cj:${'a'.repeat(62)}`]) expect(parseCardCallback(other), String(other)).toBeNull();
  });

  it('start payloads are at most 64 chars of [A-Za-z0-9_-] and unknown ones read as a plain /start', () => {
    const code = newJoinCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(parseStartPayload(startPayload('join', code))).toEqual({ kind: 'join', code });
    expect(parseStartPayload('c_chan')).toEqual({ kind: 'channel', code: 'chan' });
    expect(parseStartPayload('a_agent')).toEqual({ kind: 'agent', code: 'agent' });
    for (const bad of [undefined, '', 'hoor', 'x_abc', 'j_', 'j_a.b', `j_${'a'.repeat(63)}`]) expect(parseStartPayload(bad), String(bad)).toBeNull();
    expect(() => startPayload('join', 'a'.repeat(63))).toThrow('invalid_start_payload');
  });
});

describe('agent card notice', () => {
  it('hashes the exact rendered text plus button labels, so any wording change is a different copy', () => {
    const card = agentCard('Cookie', 'en');
    expect(card.copyHash).toBe(copyHash(card.text, ['Join · 18+', 'Only reply to me', 'Not me']));
    expect(card.copyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(agentCard('Cookie', 'en', undefined, true).copyHash).not.toBe(card.copyHash);
    expect(agentCard('Cookie', 'en', 'joined').copyHash).not.toBe(card.copyHash);
    expect(agentCard('Mina', 'en').copyHash).not.toBe(card.copyHash);
    expect(agentCard('Cookie', 'fa').copyHash).not.toBe(card.copyHash);
    expect(AGENT_NOTICE).toEqual({ id: 'notice:agent_choice', version: 'agent-v2' });
  });

  it('has EN and FA copy for every choice, with the 18+ Join and the scope sentence', () => {
    expect(agentCard('Cookie', 'en').text).toContain('Talk with Cookie privately. Join also lets Cookie keep your own notes and use notes from groups you join.');
    expect(agentCard('کوکی', 'fa').text).toContain('با کوکی خصوصی گفتگو کنید.');
    // Persian Telegram labels its Start button «شروع»; the card names the button the reader sees.
    expect(agentCard('Cookie', 'fa').text).toContain('فشردن «شروع» به‌تنهایی چیزی را انتخاب نمی‌کند.');
    expect(agentCard('Cookie', 'fa').text).not.toContain('Start');
    expect(agentCard('Cookie', 'fa').labels).toMatchObject({ join: 'می‌پیوندم · ۱۸+', reply: 'فقط به من جواب بده', decline: 'مرا حساب نکن' });
    for (const locale of ['en', 'fa'] as const) for (const choice of ['joined', 'reply_only', 'declined'] as const) {
      expect(choiceReceipt('Cookie', choice, locale).length).toBeLessThanOrEqual(200);
    }
    expect([localeOf('fa'), localeOf('fa-IR'), localeOf('en'), localeOf(undefined), localeOf('far')]).toEqual(['fa', 'fa', 'en', 'en', 'en']);
  });
});
