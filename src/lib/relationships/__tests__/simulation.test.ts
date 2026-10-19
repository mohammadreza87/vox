import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRelationshipScenario, personaSystemPrompt } from '../simulation/scenario';
import { FileRelationshipStore } from '../file-store';
import { RelationshipLoop } from '../loop';
import type { DecisionProvider, RelationshipKey } from '../types';
import { replayScenario } from '../simulation/replay';
import type { RelationshipSimulationPort } from '../simulation/protocol';

describe('90-day relationship simulation scenario', () => {
  it('is reproducible, chronological, and spans all six synthetic personas', () => {
    const scenario = loadRelationshipScenario();

    expect(scenario.virtualDays).toBe(90);
    expect(scenario.seed).toBe(761019);
    expect(scenario.personas).toHaveLength(6);
    expect(new Set(scenario.personas.map((persona) => persona.id)).size).toBe(6);
    expect(scenario.events.at(-1)?.day).toBe(90);
    expect(scenario.events.some((event) => event.kind === 'share_grant')).toBe(true);
    expect(scenario.events.some((event) => event.kind === 'share_revoke')).toBe(true);
    expect(scenario.events.some((event) => event.kind === 'restart')).toBe(true);
    expect(scenario.events.some((event) => event.kind === 'delivery_result' && event.status === 'unknown')).toBe(true);
  });

  it('gives model users individual motives and boundaries instead of cultural assumptions', () => {
    const scenario = loadRelationshipScenario();
    const prompt = personaSystemPrompt(scenario.personas.find((persona) => persona.id === 'nima')!);

    expect(prompt).toContain('switches between Persian and English by context');
    expect(prompt).toContain('do not infer culture from language');
    expect(prompt).toContain('fictional');
  });

  it('replays a resolved conflict against the real loop and keeps the canceled follow-up silent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vox-relationship-replay-'));
    try {
      let now = new Date('2026-10-20T12:00:00.000Z');
      const key: RelationshipKey = { personaId: 'tireh', chatKey: 'asha-private', audience: { kind: 'private', personId: 'asha' } };
      const store = new FileRelationshipStore(join(root, 'relationship.json'));
      const loop = new RelationshipLoop({
        store,
        mode: 'live',
        now: () => new Date(now),
        assessor: { async assess({ text }) {
          if (text.includes('criticized')) return {
            situations: [{ topic: 'boss-conflict', summary: 'Asha was criticized by her boss', status: 'open' }],
            followUp: { topic: 'boss-conflict', purpose: 'check in gently', dueAt: '2026-10-21T12:00:00.000Z' },
          };
          if (text.includes('talked it through')) return {
            situations: [{ topic: 'boss-conflict', summary: 'Asha resolved the disagreement', status: 'closed' }],
          };
          return {};
        } },
        decisions: { async choose() { return 'send'; } },
      });

      const first = await loop.observeTurn({ ...key, eventId: 'asha-1', speakerId: 'asha', source: 'telegram', at: now, text: "My boss criticized the presentation. I don't want advice; just listen." });
      expect(first.duplicate).toBe(false);
      expect((await loop.status(key)).intentions[0]?.status).toBe('pending');

      now = new Date('2026-10-21T08:00:00.000Z');
      await loop.observeTurn({ ...key, eventId: 'asha-2', speakerId: 'asha', source: 'telegram', at: now, text: "We talked it through this morning. It's fine now." });
      expect((await loop.status(key)).intentions[0]?.status).toBe('closed');

      now = new Date('2026-10-21T12:00:00.000Z');
      let sends = 0;
      const report = await loop.drain({
        authorize: async () => true,
        loadContext: async () => '',
        compose: async () => 'How did it go?',
        send: async () => { sends++; return 'synthetic-message'; },
      });
      expect(report.sent).toBe(0);
      expect(sends).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('persists an uncertain transport result and suppresses a retry after restart', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vox-relationship-restart-'));
    try {
      let now = new Date('2026-10-20T12:00:00.000Z');
      const key: RelationshipKey = { personaId: 'tireh', chatKey: 'asha-private', audience: { kind: 'private', personId: 'asha' } };
      const storePath = join(root, 'relationship.json');
      const makeLoop = (store: FileRelationshipStore) => new RelationshipLoop({
        store, mode: 'live', now: () => new Date(now),
        assessor: { async assess() { return { timeZone: 'UTC', followUp: { topic: 'test-topic', purpose: 'check in', timing: { kind: 'ongoing', evidenceQuote: 'I have a thing tomorrow.' }, dueAt: '2026-10-20T13:00:00.000Z' } }; } },
        decisions: { async choose() { return 'send'; } } satisfies DecisionProvider,
      });
      const firstLoop = makeLoop(new FileRelationshipStore(storePath));
      await firstLoop.observeTurn({ ...key, eventId: 'send-uncertain-1', speakerId: 'asha', source: 'telegram', at: now, text: 'I have a thing tomorrow.' });
      now = new Date('2026-10-20T13:00:00.000Z');
      let attempts = 0;
      const deps = {
        authorize: async () => true,
        loadContext: async () => '',
        compose: async () => 'Thinking of you.',
        send: async () => { attempts++; throw new Error('transport acknowledgement lost'); },
      };
      await firstLoop.drain(deps);
      expect(attempts).toBe(1);
      expect((await firstLoop.status(key)).intentions[0]?.status).toBe('delivery_unknown');

      const restarted = makeLoop(new FileRelationshipStore(storePath));
      now = new Date('2026-10-20T14:00:00.000Z');
      await restarted.drain({ ...deps, send: async () => { attempts++; return 'retry-must-not-happen'; } });
      expect(attempts).toBe(1);
      expect((await restarted.status(key)).intentions[0]?.status).toBe('delivery_unknown');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('runs every fixture day through the live coordinator on a virtual clock', async () => {
    const scenario = loadRelationshipScenario();
    const root = mkdtempSync(join(tmpdir(), 'vox-relationship-90d-'));
    try {
      let now = new Date('2026-10-01T00:00:00.000Z');
      const store = new FileRelationshipStore(join(root, 'relationship.json'));
      const loop = new RelationshipLoop({
        store, mode: 'live', now: () => new Date(now),
        assessor: { async assess({ text }) {
          if (text.includes('boss criticized')) return { timeZone: 'UTC', situations: [{ topic: 'boss-conflict', summary: 'Asha was criticized', status: 'open' }], followUp: { topic: 'boss-conflict', purpose: 'check in', dueAt: '2026-10-02T12:00:00.000Z' } };
          if (text.includes('talked it through')) return { situations: [{ topic: 'boss-conflict', summary: 'Resolved', status: 'closed' }] };
          if (text.includes('finished the tiny model ship')) return { situations: [{ topic: 'model-ship', summary: 'Finished a model ship', status: 'closed' }] };
          if (text.includes('interview is tomorrow')) return { timeZone: 'UTC', situations: [{ topic: 'interview', summary: 'Interview tomorrow', status: 'open' }], followUp: { topic: 'interview', purpose: 'check in', dueAt: '2026-10-09T12:00:00.000Z' } };
          if (text.includes('It went well')) return { situations: [{ topic: 'interview', summary: 'Interview went well', status: 'closed' }] };
          if (text.includes('جلسه سختی')) return { timeZone: 'UTC', situations: [{ topic: 'meeting', summary: 'Difficult meeting', status: 'open' }], followUp: { topic: 'meeting', purpose: 'check in gently', dueAt: '2026-10-20T12:00:00.000Z' } };
          if (text.includes('خوبم و خوشحالم')) return { situations: [{ topic: 'meeting', summary: 'Hana says she is happy', status: 'closed' }] };
          return {};
        } },
        decisions: { async choose() { return 'stay_quiet'; } },
        policy: { allowGroupOutreach: false },
      });
      let sends = 0;
      const port: RelationshipSimulationPort = {
        turn: (input) => loop.observeTurn(input),
        reconsider: () => loop.drain({ authorize: async () => true, loadContext: async () => '', compose: async () => 'Synthetic follow-up', send: async () => { sends++; return `synthetic-${sends}`; } }),
        control: (key, action, options) => loop.control(key, action, options),
        state: (key) => loop.status(key),
        advanceTo: (at) => { now = at; },
      };
      const evidence = await replayScenario(scenario, port);

      expect(evidence).toHaveLength(scenario.events.length);
      expect(evidence.at(-1)?.day).toBe(90);
      const ashaState = await loop.status({ personaId: scenario.relationship.agentId, chatKey: 'asha-private', audience: { kind: 'private', personId: 'asha' } });
      const leilaState = await loop.status({ personaId: scenario.relationship.agentId, chatKey: 'leila-private', audience: { kind: 'private', personId: 'leila' } });
      expect(ashaState.situations.find((situation) => situation.topic === 'boss-conflict')?.status).toBe('closed');
      expect(ashaState.intentions.some((job) => job.reason === 'topic_closed' && job.status === 'closed' && !job.topic && !job.purpose && job.sourceIds.length === 0)).toBe(true);
      expect(leilaState.situations.find((situation) => situation.topic === 'interview')?.status).toBe('closed');
      expect(leilaState.intentions.some((job) => job.reason === 'topic_closed' && job.status === 'closed' && !job.topic && !job.purpose && job.sourceIds.length === 0)).toBe(true);
      expect(sends).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
