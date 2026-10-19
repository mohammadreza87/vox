import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRelationshipScenario } from '../simulation/scenario';
import { SyntheticGatewaySession } from '../simulation/gateway-session';

describe('synthetic PersonaGateway session', () => {
  it('grounds yesterday\'s relative dates in the original message time during proactive reconsideration', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vox-gateway-sim-time-'));
    try {
      let now = new Date('2026-10-20T12:00:00.000Z');
      const session = new SyntheticGatewaySession(root, loadRelationshipScenario(), false, {}, () => now);
      await session.execute({ op: 'turn', personId: 'asha', audience: { kind: 'private', personId: 'asha' }, text: 'My interview is tomorrow.' });
      now = new Date('2026-10-21T15:00:00.000Z');
      const context = await session.gateway.proactiveContext('tireh', 'asha', 'Interview check-in');
      expect(context).toContain('"text":"My interview is tomorrow.","at":"2026-10-20T12:00:00.000Z"');
      expect(context).toContain('relative dates refer to each message');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('routes natural replies through PersonaGateway and enforces share, revoke, and guest audience boundaries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vox-gateway-sim-'));
    try {
      const scenario = loadRelationshipScenario();
      const now = new Date('2026-10-20T12:00:00.000Z');
      const session = new SyntheticGatewaySession(root, scenario, false, {}, () => now);
      const tea = await session.execute({ op: 'seed_memory', ownerId: 'asha', content: 'Asha likes jasmine tea.', topic: 'favorite-tea' }) as { result: { memoryId: string } };
      const canary = await session.execute({ op: 'seed_memory', ownerId: 'asha', content: 'Private family code: ashas-secret-code-8142.', topic: 'family-secret', sensitivity: 'personal' }) as { result: { memoryId: string } };
      await session.execute({ op: 'share', memoryId: tea.result.memoryId, ownerId: 'asha', recipientIds: ['marco'] });

      const llm = session.llm as { requests: Array<{ system: string }> };
      const answerPrompt = () => llm.requests.findLast((request) => !request.system.startsWith('You extract long-term memories'))!.system;
      // Exact-recipient sharing authorizes Marco's private retrieval. It does
      // not move a private-origin fact into a group's retained context.
      const privateTurn = await session.execute({ op: 'turn', personId: 'marco', audience: { kind: 'private', personId: 'marco' }, text: 'What tea does Asha like?' }) as { replies: string[] };
      expect(privateTurn.replies).toHaveLength(1);
      expect(answerPrompt()).toContain('Asha likes jasmine tea.');
      expect(answerPrompt()).not.toContain('ashas-secret-code-8142');

      const group = session.org.getGroup('book-club')!;
      await session.stores.memories.add({
        personaId: 'tireh', content: 'Book club meets on Saturday.', type: 'fact',
        topic: 'book-club-meeting', scope: { kind: 'group', groupId: group.id },
        authorizedPersonIds: [...group.memberIds], sensitivity: 'normal',
        source: { personId: 'marco', chatKind: 'group', groupId: group.id, at: now },
        aboutPersonIds: [], confidence: 1,
      });
      const groupTurn = await session.execute({ op: 'turn', personId: 'marco', audience: { kind: 'group', groupId: 'book-club' }, text: 'What tea should we get for the meetup?' }) as { replies: string[] };
      expect(groupTurn.replies).toHaveLength(1);
      expect(answerPrompt()).toContain('Book club meets on Saturday.');
      expect(answerPrompt()).not.toContain('Asha likes jasmine tea.');
      expect(answerPrompt()).not.toContain('ashas-secret-code-8142');

      await session.execute({ op: 'guest_join', groupId: 'book-club' });
      await session.execute({ op: 'turn', personId: 'marco', audience: { kind: 'group', groupId: 'book-club' }, text: 'What tea should we get?' });
      expect(answerPrompt()).not.toContain('Book club meets on Saturday.');
      expect(answerPrompt()).not.toContain('Asha likes jasmine tea.');
      expect(answerPrompt()).not.toContain('ashas-secret-code-8142');

      await session.execute({ op: 'revoke', memoryId: tea.result.memoryId, ownerId: 'asha' });
      await session.execute({ op: 'guest_leave', groupId: 'book-club' });
      await session.execute({ op: 'turn', personId: 'marco', audience: { kind: 'private', personId: 'marco' }, text: 'What tea does Asha like?' });
      expect(answerPrompt()).not.toContain('Asha likes jasmine tea.');
      expect(answerPrompt()).not.toContain('ashas-secret-code-8142');
      expect(await session.stores.memories.get(canary.result.memoryId)).not.toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('can prove a positive proactive message and keeps group outreach suppressed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vox-gateway-sim-send-'));
    try {
      let now = new Date('2026-10-20T12:00:00.000Z');
      const session = new SyntheticGatewaySession(root, loadRelationshipScenario(), false, { decision: 'send' }, () => now);
      await session.execute({ op: 'turn', personId: 'asha', audience: { kind: 'private', personId: 'asha' }, text: "My boss criticized the presentation. I don't want advice; just listen." });
      const before = session.telegram.sends.length;
      now = new Date('2026-10-21T12:00:00.000Z');
      const positive = await session.execute({ op: 'reconsider' }) as { result: { sent: number } ; replies: string[] };
      expect(positive.result.sent).toBe(1);
      expect(session.telegram.sends.length).toBeGreaterThan(before);
      expect(positive.replies).toHaveLength(1);

      const group = await session.relationships.observeTurn({ personaId: 'tireh', chatKey: 'group-book-club', audience: { kind: 'group', groupId: 'book-club' }, eventId: 'group-follow-up', speakerId: 'marco', source: 'telegram', at: now, text: 'A group only follow-up is not allowed.' });
      expect(group.duplicate).toBe(false);
      const report = await session.relationships.drain({ authorize: async () => true, loadContext: async () => '', compose: async () => 'Group check-in', send: async () => { throw new Error('group send must remain disabled'); } });
      expect(report.sent).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
