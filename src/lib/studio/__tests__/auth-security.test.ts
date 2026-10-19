import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';
import { signInitData, verifyInitData } from '../auth';

const BOT = '123:local-test-token';
const NOW = 1_800_000_000;
const USER = { id: 42, first_name: 'Test' };

describe('Mini App authentication boundaries', () => {
  it('rejects future timestamps beyond clock skew', () => {
    expect(verifyInitData(signInitData(USER, BOT, NOW + 31), BOT, 86400, NOW)).toBeNull();
    expect(verifyInitData(signInitData(USER, BOT, NOW + 30), BOT, 86400, NOW)).toEqual(USER);
  });

  it('rejects ambiguous duplicate fields even when the full payload is signed', () => {
    for (const field of ['user', 'auth_date', 'query_id']) {
      const params = new URLSearchParams({ user: JSON.stringify(USER), auth_date: String(NOW), query_id: 'abc' });
      params.append(field, params.get(field)!);
      const check = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join('\n');
      const key = createHmac('sha256', 'WebAppData').update(BOT).digest();
      params.set('hash', createHmac('sha256', key).update(check).digest('hex'));
      expect(verifyInitData(params.toString(), BOT, 86400, NOW)).toBeNull();
    }
    const signed = new URLSearchParams(signInitData(USER, BOT, NOW));
    signed.append('hash', signed.get('hash')!);
    expect(verifyInitData(signed.toString(), BOT, 86400, NOW)).toBeNull();
  });

  it('rejects invalid Telegram user ids', () => {
    for (const id of [0, -1, 1.5]) {
      expect(verifyInitData(signInitData({ ...USER, id }, BOT, NOW), BOT, 86400, NOW)).toBeNull();
    }
  });
});
