import { describe, expect, it } from 'vitest';
import { ID, makeStudio, seedOrg, T0 } from './helpers';
import type { TelegramChatMemberUpdated } from '../../tireh/telegram/client';
import { studioToOrg } from '../org-bridge';
async function setup() {
  const h = makeStudio(); await seedOrg(h);
  await h.store.update(s => { s.groups.push({ chatId: -100, title: 'Synthetic group', memberIds: [ID.alice, ID.bob], hasGuests: false, agentIds: [], addedAt: T0.toISOString() }); });
  return h;
}
function event(id: number, status: string, is_member?: boolean): TelegramChatMemberUpdated {
  const user = { id, first_name: 'Synthetic', is_bot: false };
  return { chat: { id: -100, type: 'supergroup' }, from: user, date: 1,
    old_chat_member: { status: 'member', user }, new_chat_member: { status, user, ...(is_member === undefined ? {} : { is_member }) } };
}
describe('Observed group audience epochs', () => {
  it('distinguishes a leave and rejoin even when the final recipients are identical', async () => {
    const h = await setup();
    await h.studio.onGroupChatMember(event(ID.bob, 'left'));
    expect((await h.store.read()).groups[0]).toMatchObject({ memberIds: [ID.alice], audienceEpoch: 1 });
    await h.studio.onGroupChatMember(event(ID.bob, 'member'));
    const state = await h.store.read();
    expect(state.groups[0]).toMatchObject({ memberIds: [ID.alice, ID.bob], audienceEpoch: 2 });
    expect(studioToOrg(state, 'Test').getGroup('chat-100')!.audienceEpoch).toBe(2);
  });
  it('unknown status never reduces the known audience or makes a group more permissive', async () => {
    const h = await setup();
    await h.studio.onGroupChatMember(event(ID.bob, 'future_unknown_status'));
    expect((await h.store.read()).groups[0]).toMatchObject({ memberIds: [ID.alice, ID.bob], hasGuests: true });
    await h.studio.onGroupChatMember(event(ID.bob, 'member'));
    expect((await h.store.read()).groups[0].hasGuests).toBe(true);
  });
  it('an observed outsider remains a guest even after they leave', async () => {
    const h = await setup();
    await h.studio.onGroupChatMember(event(ID.stranger, 'restricted', true));
    expect((await h.store.read()).groups[0]).toMatchObject({ memberIds: [ID.alice, ID.bob, ID.stranger], hasGuests: true });
    await h.studio.onGroupChatMember(event(ID.stranger, 'restricted', false));
    expect((await h.store.read()).groups[0]).toMatchObject({ memberIds: [ID.alice, ID.bob], hasGuests: true });
  });
});
