import { describe, expect, it } from 'vitest';
import { eventPhase, groundTiming, purgeTemporalEvidence, temporalCompositionRule, temporalContext, temporalGate, temporalNotBefore, timingProposalSchema, type TimingProposal } from '../temporal';
const now = new Date('2026-10-19T12:00:00Z');
const source = { text: 'My class is tomorrow 14:00–16:00 UTC.', sourceId: 'source-1', sourceAt: now, timeZone: 'UTC' };
const after: TimingProposal = { kind: 'after_event', evidenceQuote: source.text, eventWindow: { startsAt: '2026-10-20T14:00:00Z', endsAt: '2026-10-20T16:00:00Z' } };
describe('grounded relationship timing', () => {
  it('attaches caller attribution and refuses invented or paraphrased source evidence', () => {
    const timing = groundTiming(after, source)!;
    expect(timing).toMatchObject({ sourceId: 'source-1', sourceAt: now.toISOString(), timeZone: 'UTC', extraction: 'model_derived' });
    expect(groundTiming({ ...after, evidenceQuote: 'class tomorrow afternoon' }, source)).toBeNull();
    expect(groundTiming({ ...after, sourceId: 'model-invented' }, source)).toBeNull();
    expect(groundTiming(after, { ...source, timeZone: '' })).toBeNull();
    expect(groundTiming(after, { ...source, sourceAt: new Date('invalid') })).toBeNull();
  });
  it('validates dates and window ordering without claiming to prove date extraction', () => {
    expect(timingProposalSchema.safeParse({ ...after, eventWindow: { startsAt: '2026-02-30T12:00:00Z' } }).success).toBe(false);
    expect(timingProposalSchema.safeParse({ ...after, eventWindow: { startsAt: '2026-10-20T16:00:00Z', endsAt: '2026-10-20T14:00:00Z' } }).success).toBe(false);
    expect(timingProposalSchema.safeParse({ ...after, eventWindow: {} }).success).toBe(true);
  });
  it('allows after-event only at a grounded end, with future and running events deferred', () => {
    expect(eventPhase(after, now)).toBe('before'); expect(temporalGate(after, now)).toBe('defer');
    expect(eventPhase(after, new Date('2026-10-20T15:00:00Z'))).toBe('in_progress');
    expect(temporalGate(after, new Date('2026-10-20T15:59:59Z'))).toBe('defer');
    expect(eventPhase(after, new Date('2026-10-20T16:00:00Z'))).toBe('after');
    expect(temporalGate(after, new Date('2026-10-20T16:00:00Z'))).toBeNull();
  });
  it('keeps date-only and unknown ends unknown; due scheduling cannot establish completion', () => {
    const unknown = { ...after, eventWindow: { startsAt: '2026-10-18T14:00:00Z' } };
    expect(eventPhase(unknown, now)).toBe('unknown'); expect(temporalGate(unknown, now)).toBe('defer');
    expect(temporalGate(undefined, now)).toBe('defer'); expect(temporalNotBefore(unknown)).toBeUndefined();
  });
  it('uses preparatory and ongoing purposes distinctly', () => {
    expect(temporalGate({ ...after, kind: 'preparatory' }, now)).toBeNull();
    expect(temporalGate({ ...after, kind: 'preparatory' }, new Date('2026-10-21T12:00:00Z'))).toBe('close');
    const ongoing: TimingProposal = { kind: 'ongoing', evidenceQuote: 'I am making progress.' };
    expect(temporalGate(ongoing, now)).toBeNull();
    expect(temporalCompositionRule(ongoing)).toContain('Do not state or imply');
  });
  it('uses explicit busy windows and never moves the end beyond source evidence', () => {
    const busy = { ...after, busyUntil: '2026-10-20T18:00:00Z' };
    expect(temporalNotBefore(busy)).toBe('2026-10-20T18:00:00.000Z');
    expect(temporalGate(busy, new Date('2026-10-20T17:00:00Z'))).toBe('defer');
    expect(temporalGate(busy, new Date('2026-10-20T18:00:00Z'))).toBeNull();
  });
  it('exports audience-local evidence context and purges terminal intention attribution', () => {
    const timing = groundTiming(after, source)!; const job = { timing };
    expect(temporalContext(timing, now)).toContain('model_derived');
    expect(temporalContext(timing, now)).toContain(source.text);
    purgeTemporalEvidence(job); expect(job.timing).toBeUndefined();
  });
});
