import { vi } from 'vitest';
import { preferenceFixture, NOW } from '../__tests__/fixtures';
import { hire, ID, makeStudio, seedOrg } from '../../../studio/__tests__/helpers';
import { DecisionService, type DecisionInput } from '../../decisions';
import { AdaptiveExperienceService } from '../../runtime/service';
import { createStudioPreferenceLearning } from '../../../studio/preference-learning';
import { LEARNING_VERSION } from './contracts';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
export async function learningFixture(options: { file?: boolean; guarded?: boolean; key?: string; value?: string } = {}) {
  const h = makeStudio({ adaptive: false }), users = await seedOrg(h), { agent } = await hire(h, users.alice);
  const f = await preferenceFixture({ file: options.file !== false, telegramId: ID.alice, agentId: agent.id });
  let now = NOW;
  h.studio.deps.now = () => new Date(now);
  h.studio.deps.adaptive = f.adaptive;
  const provider = { ...(options.guarded !== false ? { committedExportFence: true as const } : {}),
    evaluate: vi.fn(async (input: DecisionInput, signal: AbortSignal, authorizeNow?: () => boolean) => {
      if (signal.aborted || authorizeNow && !authorizeNow()) throw new Error('denied');
      return { model: 'gpt-6-luna', answers: input.questions.map(q => {
        if (q.type === 'predicate') return { name: q.name, type: q.type, probability: 0 };
        if (q.type !== 'choice') throw new Error('unsupported_fixture');
        const value = q.name === (options.key ?? 'response_length') ? options.value ?? 'brief' : q.choices.find(c => c.value === 'unknown')?.value ?? q.choices[0].value;
        return { name: q.name, type: q.type, choice: value, confidence: 0.99, probabilities: q.choices.map(c => ({ value: c.value, probability: c.value === value ? 1 : 0 })) };
      }), usage: { input_tokens: 12 } };
    }) };
  const decisions = new DecisionService(provider);
  const experience = new AdaptiveExperienceService(f.adaptive, { decisionsEnabled: true, decisions });
  h.studio.deps.experience = experience;
  const learning = createStudioPreferenceLearning(h.studio); h.studio.deps.preferenceLearning = learning;
  const scope = { space: 'work' as const, agentId: agent.id };
  const view = () => learning.view(ID.alice, scope);
  const command = async () => ({ ...scope, expectedRevision: (await view()).revision, eventId: randomUUID() });
  async function enable(locale: 'en' | 'fa' = 'en') {
    if ((await f.adaptive.read(ID.alice, 'work')).purposes.find(p => p.purpose === 'optional.personalization')!.state !== 'granted') await f.grant();
    if (!(await f.adaptive.withAccountDocument(ID.alice, d => d.agentGrants.some(g => g.space === 'work' && g.agentId === agent.id && g.allowed)))) await f.agent();
    await learning.present(ID.alice, { ...await command(), locale });
    const shown = await view(); await learning.toggle(ID.alice, { ...await command(), enabled: true, version: LEARNING_VERSION, receipt: shown.presentation!.receipt });
  }
  const turn = () => ({ sessionId: randomUUID(), turnId: randomUUID(), revision: 1, contextKey: randomUUID() });
  const enqueue = (text = 'Please keep future replies brief.', logical = turn(), signal?: AbortSignal) => learning.enqueue({ telegramId: ID.alice, ...scope, turn: logical, text }, signal);
  return { h, f, agent, provider, experience, learning, scope, view, command, enable, turn, enqueue,
    setNow: (value: number) => { now = value; f.setNow(value); },
    close: async () => { await learning.tasks.close(); await learning.tasks.settle(); await f.close(); await rm(h.store.dir, { recursive: true, force: true, maxRetries: 3 }); } };
}
