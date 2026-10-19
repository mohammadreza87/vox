import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';
import { signInitData, verifyInitData } from '../auth';
import { decryptSecret, encryptSecret } from '../crypto';
import { SECRET } from './helpers';

describe('bot token encryption', () => {
  it('round-trips and never contains the plaintext', () => {
    const token = '123456:AAE-secret-token';
    const sealed = encryptSecret(token, SECRET);
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain(token);
    expect(decryptSecret(sealed, SECRET)).toBe(token);
  });

  it('uses a fresh IV every time', () => {
    expect(encryptSecret('same', SECRET)).not.toBe(encryptSecret('same', SECRET));
  });

  it('fails with the wrong key or tampered data (GCM auth tag)', () => {
    const sealed = encryptSecret('token', SECRET);
    expect(() => decryptSecret(sealed, `${SECRET}-other`)).toThrow();
    const [v, iv, tag, data] = sealed.split('.');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 1;
    expect(() => decryptSecret([v, iv, tag, flipped.toString('base64')].join('.'), SECRET)).toThrow();
    expect(() => decryptSecret('garbage', SECRET)).toThrow('Unrecognized secret format');
  });

  it('refuses short secrets', () => {
    expect(() => encryptSecret('x', 'short')).toThrow(/at least 32/);
    expect(() => encryptSecret('x', '')).toThrow();
  });
});

describe('Telegram Mini App initData', () => {
  const BOT = '111:voxx-bot-token';
  const user = { id: 42, first_name: 'Reza', username: 'reza' };
  const now = 1_800_000_000;

  it('accepts data signed with the bot token', () => {
    expect(verifyInitData(signInitData(user, BOT, now), BOT, 86_400, now)).toEqual(user);
  });

  it('matches Telegram\'s algorithm (independent HMAC over sorted key=value lines)', () => {
    const params = new URLSearchParams({ query_id: 'AAH', user: JSON.stringify(user), auth_date: String(now) });
    const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(BOT).digest();
    params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
    expect(verifyInitData(params.toString(), BOT, 86_400, now)?.id).toBe(42);
  });

  it('rejects tampered data', () => {
    const signed = new URLSearchParams(signInitData(user, BOT, now));
    signed.set('user', JSON.stringify({ ...user, id: 1 }));
    expect(verifyInitData(signed.toString(), BOT, 86_400, now)).toBeNull();
  });

  it('rejects a different bot token', () => {
    expect(verifyInitData(signInitData(user, BOT, now), '222:other', 86_400, now)).toBeNull();
  });

  it('rejects stale auth_date (> 24h) and accepts exactly 24h', () => {
    const signed = signInitData(user, BOT, now - 86_400);
    expect(verifyInitData(signed, BOT, 86_400, now)?.id).toBe(42);
    expect(verifyInitData(signed, BOT, 86_400, now + 1)).toBeNull();
  });

  it('rejects missing/malformed hashes and empty input without throwing', () => {
    const signed = new URLSearchParams(signInitData(user, BOT, now));
    signed.set('hash', 'abc');
    expect(verifyInitData(signed.toString(), BOT, 86_400, now)).toBeNull();
    signed.delete('hash');
    expect(verifyInitData(signed.toString(), BOT, 86_400, now)).toBeNull();
    expect(verifyInitData('', BOT)).toBeNull();
    expect(verifyInitData(signInitData(user, BOT, now), '', 86_400, now)).toBeNull();
  });

  it('rejects a validly signed payload without a usable user', () => {
    const bad = { id: 1.5, first_name: 'x' };
    expect(verifyInitData(signInitData(bad, BOT, now), BOT, 86_400, now)).toBeNull();
  });
});
