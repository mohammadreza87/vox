import { afterEach, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { digest } from '../../adaptive/persistence/repository';
import { hire, ID, makeStudio, memberOf, seedOrg, type Harness } from './helpers';

const fixtures: Harness[] = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map(h => rm(h.dir, { recursive: true, force: true }))); });
async function fixture() {
  const h = makeStudio(); fixtures.push(h);
  const people = await seedOrg(h), { agent } = await hire(h, people.superadmin, {}, undefined, 'private');
  await h.store.update(s => { const a = s.agents.find(a => a.id === agent.id)!; a.access = [ID.alice]; a.blocked = []; });
  const source = async () => { const s = await h.store.read(); return [s.members.find(m => m.telegramId === ID.alice)!, s.agents.find(a => a.id === agent.id)!] as const; };
  return { h, people, agent, source };
}

it.each(['block', 'access', 'visibility', 'role'] as const)('%s restore cannot recreate the old source authority digest', async kind => {
  const { h, people, agent, source } = await fixture();
  const before = await source();
  if (kind === 'block') { await h.studio.blockByAgent(agent.id, ID.alice); await h.studio.unblock(people.superadmin, agent.id, ID.alice); }
  if (kind === 'access') { await h.studio.setAccess(people.superadmin, agent.id, []); await h.studio.setAccess(people.superadmin, agent.id, [ID.alice]); }
  if (kind === 'visibility') { await h.studio.setVisibility(people.superadmin, agent.id, 'org'); await h.studio.setVisibility(people.superadmin, agent.id, 'private'); }
  if (kind === 'role') { await h.studio.setRole(people.superadmin, ID.alice, 'pending'); await h.studio.setRole(people.superadmin, ID.alice, 'member'); }
  const after = await source(), index = kind === 'role' ? 0 : 1;
  expect(after[index].learningAuthorityRevision).toBe((before[index].learningAuthorityRevision ?? 0) + 2);
  expect(digest(after)).not.toBe(digest(before));
  const withoutEpoch = (rows: typeof before) => rows.map(({ learningAuthorityRevision: _epoch, ...row }) => row);
  expect(withoutEpoch(after)).toEqual(withoutEpoch(before));
});

it.each([null, -1, 1.5, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1])('invalid or exhausted epoch %s aborts the authority mutation without writing', async revision => {
  const { h, agent } = await fixture();
  await h.store.update(s => { s.agents.find(a => a.id === agent.id)!.learningAuthorityRevision = revision as number; });
  const before = await h.store.read();
  await expect(h.studio.blockByAgent(agent.id, ID.alice)).rejects.toMatchObject({ status: 503 });
  expect(await h.store.read()).toEqual(before);
});

it('bootstrap promotion advances the member epoch in the same commit', async () => {
  const { h } = await fixture();
  await h.store.update(s => { s.members.find(m => m.telegramId === ID.superadmin)!.role = 'member'; });
  const before = await memberOf(h, ID.superadmin);
  await h.studio.ensureMember({ id: ID.superadmin, first_name: before.name });
  expect(await memberOf(h, ID.superadmin)).toMatchObject({ role: 'owner', learningAuthorityRevision: (before.learningAuthorityRevision ?? 0) + 1 });
});
