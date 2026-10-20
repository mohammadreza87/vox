/** File (Mac) profile Studio harness: file Studio state, file adaptive and shared
 * storage, and a confirmed account with consent, an agent grant, an explicit
 * preference and a saved note. */
import { mkdtempSync } from 'fs';
import { createHash, randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileAdaptiveStorage } from '../../adaptive/persistence/storage';
import { SharedMemoryRepository } from '../../adaptive/shared/repository';
import { SharedMemoryService } from '../../adaptive/shared/service';
import { preferenceFixture } from '../../adaptive/personalization/__tests__/fixtures';
import type { ChatContext } from '../../tireh/types';
import { canUseAgent } from '../permissions';
import { groupId, personId } from '../org-bridge';
import { hire, ID, makeStudio, seedOrg } from './helpers';

const fixtures: Awaited<ReturnType<typeof preferenceFixture>>[] = [];
/** Call from afterEach: removes every fixture directory created by fileStudio. */
export async function closeFileStudios(): Promise<void> { await Promise.all(fixtures.splice(0).map(f => f.close())); }

/** File profile: file Studio state, file adaptive and shared storage, consented account. */
export async function fileStudio() {
  const h = makeStudio(), users = await seedOrg(h), { agent } = await hire(h, users.alice);
  const f = await preferenceFixture({ file: true, telegramId: ID.alice, agentId: agent.id }); fixtures.push(f);
  await f.grant(); await f.agent(); await f.save({ key: 'response_length', value: 'brief' });
  const state = await f.adaptive.read(ID.alice, 'work');
  await f.adaptive.createMemory(ID.alice, { space: 'work', text: 'Synthetic snapshot note', eventId: randomUUID(), expectedRevision: state.revision });
  h.studio.deps.adaptive = f.adaptive; h.studio.deps.experience = f.experience;
  const store = h.store;
  const sharedStorage = new FileAdaptiveStorage(mkdtempSync(join(tmpdir(), 'vox-snapshot-shared-')));
  h.studio.deps.shared = new SharedMemoryService(new SharedMemoryRepository(sharedStorage), f.adaptive, {
    member: async telegramId => {
      const current = await store.read(), member = current.members.find(m => m.telegramId === telegramId);
      return { active: !!member && member.role !== 'pending', agentIds: member ? current.agents.filter(a => a.status === 'active' && canUseAgent(member, a)).map(a => a.id) : [] };
    },
    agent: async id => ({ active: (await store.read()).agents.some(a => a.id === id && a.status === 'active') }),
    group: async id => {
      const current = await store.read(), group = current.groups.find(g => groupId(g.chatId) === id);
      if (!group) return null;
      const memberTelegramIds = [...group.memberIds].sort((a, b) => a - b);
      return { memberTelegramIds, hasGuests: group.hasGuests, revision: createHash('sha256').update(JSON.stringify([id, memberTelegramIds, group.audienceEpoch ?? 0])).digest('hex') };
    },
  });
  const accountStorage = f.adaptive.repository.storage as FileAdaptiveStorage;
  const chat: ChatContext = { kind: 'private', chatKey: `private-${personId(ID.alice)}`, personId: personId(ID.alice) };
  return { h, f, agent, chat, accountStorage, sharedStorage };
}

