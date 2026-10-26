/** Author regression for the real FILE writer's synchronous policy context.
 * All identities, permissions, provider transport and files are synthetic. */
import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { hire, ID, makeStudio, seedOrg, T0 } from './__tests__/helpers';
import { StudioTelegramArchive } from './telegram-archive';
import { AdaptiveService } from '../adaptive/persistence/service';
import { AdaptiveRepository, accountIdFor } from '../adaptive/persistence/repository';
import { FileAdaptiveStorage } from '../adaptive/persistence/storage';
import { adaptiveOptionsFromManifest } from '../adaptive/persistence/config';
import { AdaptiveRelationshipService } from '../adaptive/relationships/service';
import type { ArchiveTransport } from '../tireh/memory/telegram-archive/contracts';

const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('uses locked FILE draft policy for publication while denying the send callback during another canonical write', async () => {
  const h = makeStudio(), users = await seedOrg(h), { agent } = await hire(h, users.alice); directories.push(h.dir);
  vi.spyOn(h.studio, 'botToken').mockReturnValue('7012:author-synthetic-token');
  const capabilities = ['core_text', 'personalization', 'auto_memory'];
  const options = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'author-draft-context', enabledCapabilities: capabilities,
    accounts: [{ accountId: accountIdFor(ID.alice), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
    approvals: capabilities.map((capability, index) => ({ schemaVersion: 1, id: `author-approval-${index}`, revision: 1,
      createdAt: T0.getTime(), updatedAt: T0.getTime(), jurisdiction: 'SYNTHETIC', capability, state: 'approved',
      configurationVersion: 'author-draft-context', effectiveAt: T0.getTime(), reviewExpiresAt: T0.getTime() + 86_400_000,
      owner: 'synthetic-only', approvalReference: 'synthetic-only' })) }));
  const adaptive = new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(join(h.dir, 'adaptive'))), {
    ...options, scopedRelationshipsEnabled: true, now: () => h.clock.now.getTime(),
  });
  h.studio.deps.adaptive = adaptive; h.studio.deps.relationshipAuthority = new AdaptiveRelationshipService(adaptive);
  await adaptive.confirm(ID.alice, { confirm: true, adultConfirmed: true });
  for (const purpose of ['optional.personalization', 'optional.auto_memory'] as const) {
    const current = await adaptive.read(ID.alice, 'work');
    const shown = await adaptive.present(ID.alice, { space: 'work', purpose, locale: 'en',
      expectedRevision: current.purposes.find(row => row.purpose === purpose)!.revision, eventId: randomUUID() });
    await adaptive.changeConsent(ID.alice, { space: 'work', purpose, state: 'granted',
      expectedRevision: shown.purposes.find(row => row.purpose === purpose)!.revision, eventId: randomUUID(), receipt: shown.receipt });
  }
  const current = await adaptive.read(ID.alice, 'work');
  await adaptive.setAgentAccess(ID.alice, agent.id, { space: 'work', allowed: true, expectedRevision: current.revision, eventId: randomUUID() });

  const files = new Map<string, Uint8Array>();
  let snapshotPhase = false, checkedBusy = false;
  const transport: ArchiveTransport = {
    async upload(chatId, _name, bytes, authorizeNow) {
      expect(chatId).toBe(ID.alice); expect(authorizeNow()).toBe(true);
      if (snapshotPhase && !checkedBusy) {
        checkedBusy = true;
        await adaptive.withAccountDocument(ID.alice, () => {
          // The external-effect callback cannot use a draft to excuse a busy
          // committed store, even though publication's mutation itself can.
          expect(authorizeNow()).toBe(false);
        });
        expect(authorizeNow()).toBe(true);
      }
      const fileId = `author-file-${files.size + 1}`; files.set(fileId, new Uint8Array(bytes));
      return { fileId, messageId: files.size };
    },
    async download(fileId, maxBytes) {
      const bytes = files.get(fileId); if (!bytes || bytes.byteLength > maxBytes) throw new Error('synthetic-unavailable');
      return new Uint8Array(bytes);
    },
  };
  const archive = new StudioTelegramArchive(h.studio, () => true, () => transport, () => true);
  const message = { message_id: 1, date: Math.floor(h.clock.now.getTime() / 1000), text: '/archive enable',
    from: { id: ID.alice, first_name: 'Synthetic author', is_bot: false }, chat: { id: ID.alice, type: 'private' as const } };
  await archive.command(agent.id, message); h.clock.now = new Date(T0.getTime() + 2000);
  const scope = await archive.scope(ID.alice, agent.id), core = archive.archive(scope), at = h.clock.now.getTime();
  await core.capture(scope, { eventId: 'author-e', logicalId: 'telegram:10', revision: 1, occurredAt: at, receivedAt: at,
    expiresAt: at + 60_000, role: 'user', text: 'SYNTHETIC_DRAFT_CONTEXT' });
  await core.checkpoint(scope, { force: true }); snapshotPhase = true;
  expect(await core.compact(scope)).toMatchObject({ status: 'published' }); expect(checkedBusy).toBe(true);
  expect((await core.recover(scope)).events.map(event => event.text)).toEqual(['SYNTHETIC_DRAFT_CONTEXT']);
});
