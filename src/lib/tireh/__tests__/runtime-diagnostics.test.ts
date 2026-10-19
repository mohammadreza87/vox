import { describe, expect, it, vi } from 'vitest';
import { telegramCanary } from '@/test/telegram-diagnostics';
import { groupText, testOrgConfig, TG } from './fixtures';
import { loadOrgConfig } from '../org/config';

const capture = vi.hoisted(() => ({ lines: [] as string[] }));
vi.mock('@/lib/logger', async () => {
  const { default: pino } = await import('pino');
  return { logger: pino({ base: null, timestamp: false }, { write: (line: string) => { capture.lines.push(line); } }) };
});
vi.mock('@/lib/firebase-admin', () => ({ getAdminDb: async () => new Map() }));
vi.mock('../org/config', async (importOriginal) => ({ ...await importOriginal<typeof import('../org/config')>(), loadOrgConfig: vi.fn() }));
vi.mock('../memory/firestore-store', async () => {
  const memory = await import('../memory/store');
  return { FirestoreMemoryStore: memory.InMemoryMemoryStore, FirestoreShareOfferStore: memory.InMemoryShareOfferStore,
    FirestoreChatHistoryStore: memory.InMemoryChatHistoryStore, FirestoreUpdateDeduper: memory.InMemoryUpdateDeduper };
});

describe('production runtime diagnostic destination', () => {
  it('preserves catalog fields at the actual Pino destination for a real update handler', async () => {
    vi.mocked(loadOrgConfig).mockReturnValue(testOrgConfig());
    vi.stubEnv('ANTHROPIC_API_KEY', telegramCanary.credential);
    vi.stubEnv('TIREH_BOT_TOKEN_ARIA', telegramCanary.credential);
    try {
      const { getPersonaGateway } = await import('../runtime');
      const gateway = await getPersonaGateway();
      // Unknown unaddressed group needs no outbound Telegram/provider request.
      expect(await gateway.handleUpdate('aria', groupText(telegramCanary.chat, TG.reza, telegramCanary.transcript))).toBe('unregistered-group');
      expect(capture.lines.map((line) => JSON.parse(line))).toEqual([{
        level: 40, type: 'telegram_ingress', stage: 'audience', reason: 'unknown_group', outcome: 'refused',
      }]);
      for (const value of Object.values(telegramCanary)) expect(capture.lines.join('')).not.toContain(String(value));
    } finally { vi.unstubAllEnvs(); }
  });
});
