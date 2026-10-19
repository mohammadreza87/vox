import { expect } from 'vitest';

/** Synthetic only: never use credentials, IDs or text from a real account. */
export const telegramCanary = {
  transcript: 'CANARY_PRIVATE_TRANSCRIPT_021',
  credential: 'CANARY_FAKE_BOT_CREDENTIAL_021',
  persona: 'CANARY_PRIVATE_PERSONA_021',
  username: 'CANARY_PRIVATE_BOT_NAME_021',
  account: 88776655,
  update: 99887766,
  chat: 77665544,
} as const;

export function telegramCanaryError(): Error {
  const privateText = Object.values(telegramCanary).join(' ');
  return Object.assign(new Error(privateText, { cause: { providerBody: privateText } }), {
    name: privateText,
    code: privateText,
    request: { token: telegramCanary.credential },
  });
}

export function expectContentFreeTelegramLogs(calls: unknown[][], forbidden: readonly unknown[] = []): void {
  expect(calls.length).toBeGreaterThan(0);
  for (const args of calls) {
    // Check raw arguments, before serialization/redaction; Error's non-enumerable
    // message and stack must never reach a logger even if JSON would hide them.
    expect(args).toHaveLength(1);
    expect(args[0]).not.toBeInstanceOf(Error);
    expect(args[0]).toEqual({
      type: 'telegram_ingress', stage: expect.any(String),
      reason: expect.any(String), outcome: expect.any(String),
    });
    for (const value of [...Object.values(telegramCanary), ...forbidden]) {
      expect(JSON.stringify(args)).not.toContain(String(value));
      expect(args).not.toContain(value);
    }
  }
}
