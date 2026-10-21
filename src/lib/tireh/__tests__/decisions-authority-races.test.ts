import { expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import { DecisionService, OpenAIDecisionProvider } from '../../adaptive/decisions';
import { ServiceDecider } from '../decisions/service-decider';

it('revalidates per-request history authority after SDK preparation before the real transport', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response('{}', { headers: { 'content-type': 'application/json' } }));
  const provider = OpenAIDecisionProvider.guarded({ apiKey: 'synthetic-only', dangerouslyAllowBrowser: true }, fetcher);
  const client = Reflect.get(provider, 'client') as OpenAI;
  const create = client.decisions.create.bind(client.decisions);
  let allowed = true;
  vi.spyOn(client.decisions, 'create').mockImplementation((...args) => {
    allowed = false;
    return create(...args);
  });
  const decider = new ServiceDecider(new DecisionService(provider));
  const result = await decider.decideDetailed('PRIVATE_HISTORY_EXPORT_CANARY', [{ name: 'ready', type: 'predicate', instructions: 'Synthetic question?' }], 1000,
    { authorize: async () => allowed ? 'synthetic-boundary' : null });
  expect(result.answers).toEqual({});
  expect(result.outcome).toBe('unknown');
  expect(fetcher).not.toHaveBeenCalled();
});
