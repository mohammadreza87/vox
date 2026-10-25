import { describe, expect, it } from 'vitest';
import { agentShortCode, cardCallback, circleJoinUrl, MAX_CALLBACK_BYTES, newJoinCode, parseCardCallback, parseCirclesMode, parsePetLaunch, parseStartPayload, petLaunchCode, receiptIdFor, receiptOwner, sameShort, startPayload } from '../codec';
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

describe('S4 pet launch codes and the group card link', () => {
  const SECRET = 'a-secret-that-is-at-least-32-characters-long';
  it('a launch code is p_<8-char opaque short>_<joinCode>, at most 64 chars of [A-Za-z0-9_-], and parses back', () => {
    const short = agentShortCode(SECRET, 'ag0123456789'), join = newJoinCode();
    expect(short).toMatch(/^[A-Za-z0-9_-]{8}$/);
    expect(short).not.toContain('ag0123');
    expect(agentShortCode(SECRET, 'ag0123456789')).toBe(short);
    expect(agentShortCode(SECRET, 'ag0123456788')).not.toBe(short);
    expect(agentShortCode(`${SECRET}x`, 'ag0123456789')).not.toBe(short);
    const code = petLaunchCode(short, join);
    expect(code).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(code.length).toBeLessThanOrEqual(64);
    expect(parsePetLaunch(code)).toEqual({ short, joinCode: join });
    // A short or join code holding '_' still splits on the fixed width.
    expect(parsePetLaunch('p_ab_cd_ef_ghijklmnopqrstuvwxyz0123')).toEqual({ short: 'ab_cd_ef', joinCode: 'ghijklmnopqrstuvwxyz0123' });
    for (const bad of ['', 'p_', 'p_short_x', `p_${short}_${'a'.repeat(54)}`, `j_${join}`, `p_${short}_${join}!`]) expect(parsePetLaunch(bad)).toBeNull();
    expect(() => petLaunchCode('short', join)).toThrow('invalid_launch_code');
    expect(sameShort(short, short)).toBe(true);
    expect(sameShort(short, `${short}x`)).toBe(false);
  });

  it('circleJoinUrl: a launch route opens the Main Mini App; none keeps the S2 DM hop exactly', () => {
    const join = 'abcdefghijklmnopqrstuv';
    expect(circleJoinUrl('cookie_bot', join)).toBe('https://t.me/cookie_bot?start=j_abcdefghijklmnopqrstuv');
    expect(circleJoinUrl('cookie_bot', join, { bot: 'VoxxBot', short: 'AbCdEf12' })).toBe('https://t.me/VoxxBot?startapp=p_AbCdEf12_abcdefghijklmnopqrstuv');
    expect(circleJoinUrl('cookie_bot', join, { bot: 'cookie_bot', short: 'AbCdEf12' })).toBe('https://t.me/cookie_bot?startapp=p_AbCdEf12_abcdefghijklmnopqrstuv');
  });
});
