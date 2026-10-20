import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { PersonaGateway } from '../gateway';
import { logStageTiming, logTelegramDiagnostic, TIMING_STAGES } from '../telegram/diagnostics';
import type { TelegramBotClient } from '../telegram/client';
import { formatStageSummary, parseStageTimings, percentile, summarizeStageTimings } from '../timing-report';
import type { DecisionAnswer } from '../triage';
import { fakeVoice, makeGateway, privateText, privateVoice, TG } from './fixtures';
import { expectContentFreeStageTimings } from '@/test/telegram-diagnostics';

const TEXT_CANARY = 'STAGE_TIMING_PRIVATE_TEXT_CANARY_031';
const NAME_CANARY = 'STAGE_TIMING_PERSONA_NAME_CANARY_031';
type Logger = { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

function timed(options: { stageTimings?: boolean } = {}) {
  const ctx = makeGateway({ voice: fakeVoice(TEXT_CANARY) });
  ctx.org.getPersona('aria')!.name = NAME_CANARY;
  const answers: Record<string, DecisionAnswer> = {
    effort: { type: 'choice', choice: 'thoughtful', confidence: 1 },
    live_info: { type: 'predicate', probability: 0 },
    memorable: { type: 'predicate', probability: 1 },
    wants_voice: { type: 'predicate', probability: 0 },
  };
  const logger: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const gateway = new PersonaGateway({
    org: ctx.org, llm: ctx.llm, memories: ctx.memories, offers: ctx.offers, history: ctx.history,
    deduper: { firstSeen: async (key: string) => !key.endsWith('__duplicate') }, voice: fakeVoice(TEXT_CANARY),
    botFor: () => ctx.bot as unknown as TelegramBotClient, decider: { decide: async () => answers },
    logger, now: () => new Date('2026-10-19T10:00:00Z'), stageTimings: options.stageTimings ?? true,
  });
  ctx.llm.nextReply = `${TEXT_CANARY} reply`;
  return { ...ctx, gateway, logger };
}

function expectContentFreeTimings(logger: Logger, forbidden: readonly string[]) {
  const events = expectContentFreeStageTimings(logger, forbidden);
  for (const event of events) expect(TIMING_STAGES).toContain(event.stage);
  return events;
}

const stagesOf = (events: Record<string, unknown>[]) => events.map((event) => event.stage);

describe('content-free per-stage timings from the gateway', () => {
  it('times a replied private text turn per stage, in a fixed order, with no content or identifiers', async () => {
    const ctx = timed();
    expect(await ctx.gateway.handleUpdate('aria', privateText(TG.reza, `Plan the launch. ${TEXT_CANARY}`))).toBe('replied');
    const events = expectContentFreeTimings(ctx.logger, [TEXT_CANARY, NAME_CANARY, 'aria', 'reza', 'private-reza']);
    expect(events.every((event) => event.route === 'private_text')).toBe(true);
    expect(stagesOf(events)).toEqual(['ingress', 'boundary', 'triage', 'retrieval', 'prompt', 'llm_done', 'send', 'extraction', 'total']);
  });

  it('adds speech-to-text and synthesis for a voice note', async () => {
    const ctx = timed();
    expect(await ctx.gateway.handleUpdate('aria', privateVoice(TG.reza))).toBe('replied');
    const events = expectContentFreeTimings(ctx.logger, [TEXT_CANARY, NAME_CANARY, 'aria', 'reza']);
    expect(events.every((event) => event.route === 'voice_note')).toBe(true);
    expect(stagesOf(events)).toEqual(['ingress', 'stt', 'boundary', 'triage', 'retrieval', 'prompt', 'llm_done', 'tts', 'send', 'extraction', 'total']);
  });

  it('emits nothing when timings are off, for duplicates, or for refused strangers', async () => {
    const off = timed({ stageTimings: false });
    expect(await off.gateway.handleUpdate('aria', privateText(TG.reza, TEXT_CANARY))).toBe('replied');
    expect(off.logger.info).not.toHaveBeenCalled();

    const ctx = timed();
    expect(await ctx.gateway.handleUpdate('aria', { ...privateText(TG.reza, TEXT_CANARY), update_id: 'duplicate' as unknown as number })).toBe('duplicate');
    expect(await ctx.gateway.handleUpdate('aria', privateText(TG.stranger, TEXT_CANARY))).toBe('stranger');
    expect(ctx.logger.info).not.toHaveBeenCalled();
  });
});

describe('the timing diagnostic itself', () => {
  it('logs only a fixed route and a clamped whole number, and drops anything else', () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    logStageTiming(log, 'private_text', 'llm_done', 812.6);
    logStageTiming(log, 'live_call', 'total', 1e12);
    logStageTiming(log, 'group_text', 'send', -5);
    expect(log.info.mock.calls).toEqual([
      [{ type: 'telegram_ingress', stage: 'llm_done', reason: 'timing', outcome: 'measured', route: 'private_text', durationMs: 813 }],
      [{ type: 'telegram_ingress', stage: 'total', reason: 'timing', outcome: 'measured', route: 'live_call', durationMs: 86_400_000 }],
      [{ type: 'telegram_ingress', stage: 'send', reason: 'timing', outcome: 'measured', route: 'group_text', durationMs: 0 }],
    ]);
    log.info.mockClear();
    const hostile = Object.defineProperty({}, 'route', { get: () => { throw new Error(TEXT_CANARY); } });
    for (const timing of [undefined, { route: TEXT_CANARY, durationMs: 1 }, { route: 'private_text', durationMs: Number.NaN }, { route: 'private_text', durationMs: '5' }, hostile]) {
      logTelegramDiagnostic(log, 'timing_boundary', timing as never);
    }
    logStageTiming(log, 'private_text', TEXT_CANARY as never, 5);
    expect(log.info).not.toHaveBeenCalled();
    // Non-timing events ignore a measurement entirely.
    logTelegramDiagnostic(log, 'triage_failed', { route: 'private_text', durationMs: 9 });
    expect(log.warn.mock.calls).toEqual([[{ type: 'telegram_ingress', stage: 'triage', reason: 'operation_failed', outcome: 'full_reply_path' }]]);
  });
});

describe('p50/p95 report', () => {
  it('reads Pino JSON and wrapped Node console output, ignores other lines and reports nearest-rank percentiles', () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    for (let ms = 1; ms <= 100; ms++) logStageTiming(log, 'private_text', 'boundary', ms);
    logStageTiming(log, 'live_call', 'llm_ttft', 420);
    const events = log.info.mock.calls.map(([event]) => event);
    const lines = events.map((event, i) => i % 2
      ? JSON.stringify({ level: 30, time: 1, pid: 1, host: 'h', ...event })
      : inspect(event, { breakLength: 60 }));
    const text = ['noise line', JSON.stringify({ type: 'telegram_ingress', stage: 'poll', reason: 'operation_failed', outcome: 'retry_scheduled' }),
      inspect({ type: 'telegram_ingress', stage: 'boundary', reason: 'timing', outcome: 'measured', route: 'not_a_route', durationMs: 9999 }), ...lines].join('\n');
    expect(lines.some((line) => line.includes('\n'))).toBe(true);
    const rows = summarizeStageTimings(parseStageTimings(text));
    expect(rows).toEqual([
      { route: 'private_text', stage: 'boundary', count: 100, p50: 50, p95: 95 },
      { route: 'live_call', stage: 'llm_ttft', count: 1, p50: 420, p95: 420 },
    ]);
    expect(formatStageSummary(rows).split('\n')).toEqual([
      'route         stage       n  p50 ms  p95 ms',
      'private_text  boundary  100      50      95',
      'live_call     llm_ttft    1     420     420',
    ]);
    expect(percentile([], 50)).toBeNaN();
    expect(formatStageSummary([])).toContain('STUDIO_STAGE_TIMINGS=1');
  });
});
