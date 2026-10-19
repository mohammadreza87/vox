import { createInterface } from 'node:readline';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import dotenv from 'dotenv';
import { FileRelationshipStore } from '../src/lib/relationships/file-store';
import { RelationshipLoop } from '../src/lib/relationships/loop';
import type { RelationshipSimulationPort } from '../src/lib/relationships/simulation/protocol';
import { replayScenario } from '../src/lib/relationships/simulation/replay';
import { loadRelationshipScenario } from '../src/lib/relationships/simulation/scenario';
import { SyntheticGatewaySession, type GatewayCommand } from '../src/lib/relationships/simulation/gateway-session';
import type { RelationshipKey, TurnInput } from '../src/lib/relationships/types';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function fakeAssessment(text: string) {
  if (/boss criticized/i.test(text)) return {
    timeZone: 'UTC',
    situations: [{ topic: 'boss-conflict', summary: 'The user described criticism from their boss.', status: 'open' as const }],
    followUp: { topic: 'boss-conflict', purpose: 'Check in gently about the conversation with their boss.', dueAt: '2026-10-02T12:00:00.000Z' },
  };
  if (/talked it through/i.test(text)) return { situations: [{ topic: 'boss-conflict', summary: 'The user says the disagreement is resolved.', status: 'closed' as const }] };
  if (/جلسه سختی/u.test(text)) return {
    timeZone: 'UTC',
    situations: [{ topic: 'meeting', summary: 'The user mentioned a difficult meeting.', status: 'open' as const }],
    followUp: { topic: 'meeting', purpose: 'Offer a gentle check-in.', dueAt: '2026-10-20T12:00:00.000Z' },
  };
  if (/خوبم و خوشحالم/u.test(text)) return { situations: [{ topic: 'meeting', summary: 'The user says they are happy.', status: 'closed' as const }] };
  return {};
}

async function main() {
  const mode = option('--mode') ?? 'interactive';
  const directory = option('--dir');
  const fake = process.argv.includes('--fake');
  const realModel = process.argv.includes('--real-model');
  if (!directory || fake === realModel) throw new Error('Choose exactly one of --fake or --real-model, and provide --dir <empty-or-dedicated-local-directory>.');
  const decision = option('--decision') ?? 'stay_quiet';
  if (!['send', 'defer', 'close', 'stay_quiet'].includes(decision)) throw new Error('--decision must be send, defer, close, or stay_quiet');
  if (realModel) {
    const envPath = option('--env');
    if (!envPath) throw new Error('--real-model requires --env <path-to-local-env-file>');
    const parsed = dotenv.parse(readFileSync(resolve(envPath)));
    for (const [key, value] of Object.entries(parsed)) if (!process.env[key]) process.env[key] = value;
    if (!process.env.ANTHROPIC_API_KEY || !process.env.OPENAI_API_KEY) throw new Error('The selected env file must provide model credentials. Values are never printed.');
  }
  const maxTurns = Number(option('--max-turns') ?? '20');
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 20) throw new Error('--max-turns must be from 1 to 20');
  const userAgentModel = option('--user-model');
  if (userAgentModel && userAgentModel !== 'gpt-6.1-sol' && userAgentModel !== 'gpt-6-luna') throw new Error('--user-model must be gpt-6.1-sol or gpt-6-luna');
  const root = resolve(directory);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (mode === 'interactive') {
    const scenario = loadRelationshipScenario();
    const session = new SyntheticGatewaySession(root, scenario, realModel, {
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      openaiApiKey: process.env.OPENAI_API_KEY,
      chatModel: process.env.STUDIO_CHAT_MODEL,
      voiceModel: process.env.STUDIO_VOICE_MODEL,
      decision: decision as 'send' | 'defer' | 'close' | 'stay_quiet',
      userAgentModel: userAgentModel as 'gpt-6.1-sol' | 'gpt-6-luna' | undefined,
      maxTurns,
    }, () => new Date(), maxTurns);
    process.stderr.write(`Synthetic PersonaGateway ready (${realModel ? 'real providers' : 'fake providers'}); fake Telegram transport only; cap ${maxTurns} user turns.\n`);
    const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of input) {
      if (!line.trim()) continue;
      try {
        const command = JSON.parse(line) as GatewayCommand;
        const response = await session.execute(command);
        process.stdout.write(`${JSON.stringify({ ok: true, ...response as object })}\n`);
        if (command.op === 'quit') break;
      } catch {
        process.stdout.write(`${JSON.stringify({ ok: false, error: 'synthetic_session_command_failed' })}\n`);
      }
    }
    return;
  }
  if (mode !== 'replay' || !fake) throw new Error('mode replay requires --fake; real provider sessions must use interactive mode');
  let now = new Date('2026-10-01T12:00:00.000Z');
  const store = new FileRelationshipStore(join(root, 'state.json'));
  const sent: Array<{ at: string; intentionId: string; text: string; syntheticMessageId: string }> = [];
  const loop = new RelationshipLoop({
    store, mode: 'live', now: () => new Date(now),
    assessor: { async assess({ text }) { return fakeAssessment(text); } },
    decisions: { async choose() { return decision as 'send' | 'defer' | 'close' | 'stay_quiet'; } },
  });
  const port: RelationshipSimulationPort = {
    turn: (input: TurnInput) => loop.observeTurn(input),
    reconsider: async () => loop.drain({
      authorize: async () => true,
      loadContext: async () => '',
      compose: async (job) => `Synthetic check-in about ${job.topic}.`,
      send: async (job, text) => {
        const syntheticMessageId = `synthetic-${sent.length + 1}`;
        sent.push({ at: now.toISOString(), intentionId: job.id, text, syntheticMessageId });
        return syntheticMessageId;
      },
    }),
    control: (key, action, options) => loop.control(key, action, options),
    state: (key: RelationshipKey) => loop.status(key),
    advanceTo: (at) => { now = at; },
  };

  if (mode === 'replay') {
    const scenario = loadRelationshipScenario();
    const evidence = await replayScenario(scenario, port);
    const report = {
      schemaVersion: 1,
      scenarioId: scenario.id,
      seed: scenario.seed,
      mode: 'deterministic_replay',
      evidenceKind: fake ? 'simulated_core_replay' : 'synthetic_real_provider_core_replay',
      virtualDays: scenario.virtualDays,
      timelineEntries: evidence.length,
      executedCoreEvents: evidence.filter((event) => 'result' in event).length,
      annotationsNotExecuted: evidence.filter((event) => !('result' in event)).map(({ index, kind }) => ({ index, kind })),
      events: evidence,
      syntheticDeliveryAttempts: sent,
      note: fake ? 'Fake assessor and selectable deterministic decisions; this is not model-quality or live-delivery evidence.' : 'Real model providers with fictional inputs and fake local transport; this is not real-user or live-delivery evidence.',
    };
    const reportPath = join(root, 'report.json');
    writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
    process.stdout.write(`${JSON.stringify({ ok: true, reportPath, timelineEntries: evidence.length, executedCoreEvents: evidence.filter((event) => 'result' in event).length, syntheticDeliveryAttempts: sent.length })}\n`);
    return;
  }
  if (mode !== 'interactive') throw new Error('mode must be interactive or replay');

}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'simulation failed'}\n`);
  process.exitCode = 1;
});
