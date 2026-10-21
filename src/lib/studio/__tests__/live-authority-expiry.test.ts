import { afterEach, expect, it, vi } from 'vitest';
import { NOW } from '../../adaptive/personalization/__tests__/fixtures';
import { closeFileStudios, fileStudio } from './file-studio';
import { ID } from './helpers';

afterEach(async () => { vi.restoreAllMocks(); await closeFileStudios(); });

it('rechecks time-only personalization approval expiry before every coalesced live part', async () => {
  const { h, f, agent } = await fileStudio();
  const expires = NOW + 1000;
  f.expirePersonalizationAt(expires); f.setNow(expires - 1);
  expect((await h.studio.adaptiveContext(agent.id, `tg-${ID.alice}`, 'work')).context).toContain('Synthetic snapshot note');
  let supplied = false;
  h.studio.deps.fastLLM = { complete: vi.fn(), stream: async function* (request) {
    supplied = JSON.stringify(request.messages).includes('Synthetic snapshot note');
    yield 'Already delivered.';
    f.setNow(expires + 1);
    yield 'POST_EXPIRY_OUTPUT_CANARY.';
  } };
  const chunks: string[] = [];
  for await (const part of await h.studio.liveTurn(agent.id, ID.alice, [{ role: 'user', content: 'Synthetic current voice turn.' }])) chunks.push(part);
  expect(supplied).toBe(true);
  expect(chunks).toEqual(['Already delivered.']);
  expect((await h.studio.adaptiveContext(agent.id, `tg-${ID.alice}`, 'work')).context).toEqual([]);
});
