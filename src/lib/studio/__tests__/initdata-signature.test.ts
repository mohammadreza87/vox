import { createPublicKey, generateKeyPairSync, sign } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import { botIdOfToken, checkInitDataSignature, signInitData, TELEGRAM_INITDATA_KEYS, verifyBotInitData } from '../auth';
import { verifyAgentInitData, verifyManagerInitData } from '../initdata-trust';
import type { Studio } from '../service';
import { agentInit, TEST_INITDATA_KEY_HEX, TEST_INITDATA_PRIVATE_KEY } from './initdata-keys';

const TOKEN = '7001:SYNTHETIC_AGENT_TOKEN';
const BOT = 7001;
const who = { id: 300, first_name: 'Alice' };

describe("Telegram's third-party initData signature (Ed25519)", () => {
  it('pins the keys published on core.telegram.org/bots/webapps (checked 2026-10-25), and both parse as Ed25519', () => {
    expect(TELEGRAM_INITDATA_KEYS.production).toBe('e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d');
    expect(TELEGRAM_INITDATA_KEYS.test).toBe('40055058a4ee38156a06562e52eece92a771bcd8346a8c4615cb7376eddf72ec');
    for (const hex of Object.values(TELEGRAM_INITDATA_KEYS)) {
      const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(hex, 'hex')]), format: 'der', type: 'spki' });
      expect(key.asymmetricKeyType).toBe('ed25519');
    }
  });

  it('signs "<bot_id>:WebAppData" plus the sorted fields except hash and signature, base64url without padding', () => {
    const init = agentInit(who, TOKEN, 1_800_000_000, { query_id: 'AAE', start_param: 'p_x' });
    const signature = new URLSearchParams(init).get('signature')!;
    expect(signature).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(checkInitDataSignature(init, BOT, TEST_INITDATA_KEY_HEX)).toBe('valid');
    // the production key never accepts a test signature
    expect(checkInitDataSignature(init, BOT)).toBe('invalid');
  });

  /**
   * Known answer, independent of auth.ts: the data-check-string is written out by hand from Telegram's recipe
   * (core.telegram.org/bots/webapps, "Validating data for Third-Party Use", checked 2026-10-25): "<bot_id>:WebAppData",
   * a line feed, then every received field except hash and signature, sorted by key, as decoded key=value, joined by
   * line feeds. It is signed with crypto.sign directly, never through signInitData, so a drift in the shared helper
   * (which the signer and the verifier both use) fails here instead of locking out every real Telegram launch.
   */
  describe('known answer for the documented data-check-string', () => {
    const userJson = '{"id":300,"first_name":"Alice Б","last_name":"a&b=c+d"}';
    const documented = '7001:WebAppData\n'
      + 'auth_date=1800000000\n'
      + 'chat_instance=-8812345678901234567\n'
      + 'chat_type=sender\n'
      + 'query_id=AAEtest\n'
      + 'start_param=p_x\n'
      + `user=${userJson}`;
    const sig = (text: string) => sign(null, Buffer.from(text, 'utf8'), TEST_INITDATA_PRIVATE_KEY).toString('base64url');
    /** initData as a client sends it: percent-encoded, unsorted, with Telegram's hash and signature in the middle. */
    const initWith = (signature: string) => [
      `user=${encodeURIComponent(userJson)}`, `hash=${'ab'.repeat(32)}`, 'chat_type=sender', `signature=${signature}`,
      'start_param=p_x', 'auth_date=1800000000', 'query_id=AAEtest', 'chat_instance=-8812345678901234567',
    ].join('&');

    it('a signature over the hand-built string verifies', () => {
      expect(checkInitDataSignature(initWith(sig(documented)), 7001, TEST_INITDATA_KEY_HEX)).toBe('valid');
    });

    it('the test signer (agentInit/signInitData) produces exactly that signature (Ed25519 is deterministic)', () => {
      const signed = signInitData(JSON.parse(userJson), TOKEN, 1_800_000_000,
        { query_id: 'AAEtest', chat_type: 'sender', start_param: 'p_x', chat_instance: '-8812345678901234567' },
        { botId: 7001, privateKey: TEST_INITDATA_PRIVATE_KEY });
      expect(new URLSearchParams(signed).get('signature')).toBe(sig(documented));
    });

    it('every plausible drift from the recipe is refused', () => {
      const lines = documented.split('\n');
      const drifts = [
        lines.join('&'), // fields joined with & instead of line feeds
        lines[0] + lines.slice(1).join('\n'), // no line feed after the prefix
        `${lines[0]}\n${lines.slice(1).reverse().join('\n')}`, // not sorted
        `${lines[0]}\n${[...lines.slice(1), `hash=${'ab'.repeat(32)}`].sort().join('\n')}`, // hash left in
        lines.slice(1).join('\n'), // no prefix
        `WebAppData\n${lines.slice(1).join('\n')}`, // prefix without the bot id
        `7001:WebAppData\n${lines.slice(1, -1).join('\n')}\nuser=${encodeURIComponent(userJson)}`, // values left percent-encoded
        `${documented}\n`, // a trailing line feed
      ];
      for (const text of drifts) expect(checkInitDataSignature(initWith(sig(text)), 7001, TEST_INITDATA_KEY_HEX)).toBe('invalid');
    });
  });

  it('valid, missing and every kind of invalid', () => {
    const valid = agentInit(who, TOKEN);
    expect(checkInitDataSignature(valid, BOT, TEST_INITDATA_KEY_HEX)).toBe('valid');
    expect(checkInitDataSignature(signInitData(who, TOKEN), BOT, TEST_INITDATA_KEY_HEX)).toBe('missing');
    const p = new URLSearchParams(valid);
    const tweak = (f: (q: URLSearchParams) => void) => { const q = new URLSearchParams(p); f(q); return q.toString(); };
    const invalid = [
      tweak((q) => q.set('user', JSON.stringify({ ...who, id: 400 }))), // a field changed after signing
      tweak((q) => q.set('auth_date', String(Number(q.get('auth_date')) + 1))),
      tweak((q) => q.append('start_param', 'added')),
      tweak((q) => q.set('signature', q.get('signature')!.slice(0, 85))), // wrong length
      tweak((q) => q.set('signature', `${q.get('signature')!.slice(0, 85)}+`)), // not base64url
      // a changed signature byte (the first character carries six full bits; the last one has unused padding bits)
      tweak((q) => q.set('signature', `${q.get('signature')!.startsWith('A') ? 'B' : 'A'}${q.get('signature')!.slice(1)}`)),
      tweak((q) => q.append('signature', q.get('signature')!)), // duplicate key
      tweak((q) => q.set('signature', '')),
      signInitData(who, TOKEN, undefined, {}, { botId: BOT, privateKey: generateKeyPairSync('ed25519').privateKey }), // another key
    ];
    for (const init of invalid) expect(checkInitDataSignature(init, BOT, TEST_INITDATA_KEY_HEX)).toBe('invalid');
    expect(checkInitDataSignature(valid, BOT + 1, TEST_INITDATA_KEY_HEX)).toBe('invalid'); // signed for another bot
    expect(checkInitDataSignature(valid, 0, TEST_INITDATA_KEY_HEX)).toBe('invalid');
    expect(checkInitDataSignature(valid, BOT, 'not-a-key')).toBe('invalid');
  });

  it('never throws on garbage', () => {
    for (const junk of ['', '%', '%%%===&&&', 'signature=%E0%A4%A', 'signature=' + 'A'.repeat(86), '\u0000signature=x', 'a='.repeat(5000)]) {
      expect(() => checkInitDataSignature(junk, BOT, TEST_INITDATA_KEY_HEX)).not.toThrow();
      expect(['missing', 'invalid']).toContain(checkInitDataSignature(junk, BOT, TEST_INITDATA_KEY_HEX));
    }
  });

  it('verifyBotInitData needs both: a valid signature with a bad HMAC is refused, and the HMAC still covers signature', () => {
    const o = { key: TEST_INITDATA_KEY_HEX, requireSignature: true };
    expect(verifyBotInitData(agentInit(who, TOKEN), { token: TOKEN, botId: BOT }, o)).toMatchObject({ user: { id: 300 }, signature: 'valid' });
    expect(verifyBotInitData(agentInit(who, TOKEN), { token: '7001:OTHER', botId: BOT }, o)).toEqual({ user: null, signature: 'hmac_failed' });
    // replacing the signature (even with another genuine one) breaks the HMAC
    const a = new URLSearchParams(agentInit(who, TOKEN, 1_800_000_000));
    a.set('signature', new URLSearchParams(agentInit({ ...who, id: 301 }, TOKEN, 1_800_000_000)).get('signature')!);
    expect(verifyBotInitData(a.toString(), { token: TOKEN, botId: BOT }, { ...o, nowSeconds: 1_800_000_000 }).user).toBeNull();
    expect(verifyBotInitData(signInitData(who, TOKEN), { token: TOKEN, botId: BOT }, o)).toEqual({ user: null, signature: 'missing' });
    expect(verifyBotInitData(signInitData(who, TOKEN), { token: TOKEN, botId: BOT }, { ...o, requireSignature: false })).toMatchObject({ user: { id: 300 }, signature: 'missing' });
  });

  it('botIdOfToken reads the numeric prefix only', () => {
    expect(botIdOfToken('123456:ABC')).toBe(123456);
    expect(botIdOfToken('token-7000')).toBe(0);
    expect(botIdOfToken('0123:x')).toBe(0);
  });
});

describe('initdata-trust policy', () => {
  const studio = (mode?: 'enforce' | 'shadow') => ({ deps: { initDataKey: TEST_INITDATA_KEY_HEX, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...(mode ? { initDataSignature: () => mode } : {}) } }) as unknown as Studio;
  const signer = { token: TOKEN, botId: BOT };

  it('agent-signed: missing is refused unless the route is relaxable and the switch is shadow; invalid always refused', () => {
    const missing = signInitData(who, TOKEN);
    const forged = signInitData(who, TOKEN, undefined, {}, { botId: BOT, privateKey: generateKeyPairSync('ed25519').privateKey });
    expect(verifyAgentInitData(studio(), missing, signer, 'pet', { relaxable: true })).toBeNull();
    expect(verifyAgentInitData(studio('shadow'), missing, signer, 'pet', { relaxable: false })).toBeNull();
    expect(verifyAgentInitData(studio('shadow'), missing, signer, 'pet', { relaxable: true })).toMatchObject({ id: 300 });
    expect(verifyAgentInitData(studio('shadow'), forged, signer, 'pet', { relaxable: true })).toBeNull();
    expect(verifyAgentInitData(studio(), agentInit(who, TOKEN), signer, 'connections')).toMatchObject({ id: 300 });
  });

  it('the production key is the default when no key is injected', () => {
    const s = { deps: { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } } as unknown as Studio;
    expect(verifyAgentInitData(s, agentInit(who, TOKEN), signer, 'pet')).toBeNull();
  });

  it('manager-signed: a missing signature is accepted (only Vox holds that token), a present one must verify', () => {
    const MANAGER = '555:SYNTHETIC_MANAGER';
    expect(verifyManagerInitData(studio(), signInitData(who, MANAGER), MANAGER, 'my_data')).toMatchObject({ id: 300 });
    expect(verifyManagerInitData(studio(), agentInit(who, MANAGER), MANAGER, 'my_data')).toMatchObject({ id: 300 });
    expect(verifyManagerInitData(studio(), signInitData(who, MANAGER, undefined, {}, { botId: 555, privateKey: generateKeyPairSync('ed25519').privateKey }), MANAGER, 'my_data')).toBeNull();
    expect(verifyManagerInitData(studio(), agentInit(who, TOKEN), MANAGER, 'my_data')).toBeNull(); // an agent's initData
    expect(verifyManagerInitData(studio(), agentInit(who, MANAGER), '', 'my_data')).toBeNull();
  });
});
