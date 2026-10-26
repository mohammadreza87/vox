/**
 * Pet decisions (design §8): check-in choice, the view's tip / ask_now / greeting and talk's pet_action, each under
 * STUDIO_PET_DECISIONS off | shadow | on, logged as `pet-v1`, consumed only after the calibration gate.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InitDataUser } from '../auth';
import { agentInit } from './initdata-keys';
import { handlePetRequest } from '../pet-http';
import { chooseCheckin } from '../pet-checkins/decide';
import { checkinPersonHash, planCheckin, type PlanInput } from '../pet-checkins/planner';
import { petDecisionContext, petFeatureLine, type PetDecisionContext } from '../pet-decisions';
import { startPetAction } from '../pet-view-decisions';
import { createDecisionLogSink, InMemoryDecisionLogStore } from '../../tireh/decisions/log';
import { calibrationReport, petCalibratedPairs, petCalibrationPasses, type CalibrationLabel } from '../../tireh/decisions/calibration';
import { parsePetCalibrated, petFlags } from '../../tireh/pet-flags';
import type { Decider, DecideDetail, DecisionAnswer, DecisionQuestion } from '../../tireh/triage';
import { newCare } from '../../pet/care';
import { newCheckinAgent, newCheckinRecord } from '../../pet/checkins';
import { newPlay } from '../../pet/play';
import type { PetView, TalkResponse } from '../../pet/types';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { AdaptiveRepository, accountIdFor } from '../../adaptive/persistence/repository';
import { adaptiveOptionsFromManifest } from '../../adaptive/persistence/config';
import { MemoryAdaptiveStorage } from '../../adaptive/runtime/storage';
import { hire, ID, makeStudio, seedOrg, type Harness } from './helpers';

afterEach(() => { vi.unstubAllEnvs(); });

const flush = () => new Promise((r) => setTimeout(r, 20));

function fakeDecider(answers: (questions: DecisionQuestion[]) => Record<string, DecisionAnswer>, delayMs = 0) {
  const calls: Array<{ input: string; questions: DecisionQuestion[] }> = [];
  const decider: Decider & { calls: typeof calls } = {
    calls,
    decide: vi.fn(async () => ({})),
    decideDetailed: vi.fn(async (input: string, questions: DecisionQuestion[]): Promise<DecideDetail> => {
      calls.push({ input, questions });
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      const a = answers(questions);
      return { answers: a, elapsedMs: 12, outcome: Object.keys(a).length ? 'answered' : 'unknown' };
    }),
  };
  return decider;
}
const choice = (value: string, confidence = 0.9): DecisionAnswer => ({ type: 'choice', choice: value, confidence });

function ctxFor(decider: Decider | undefined, mode: 'off' | 'shadow' | 'on', calibrated: string[] = []) {
  const store = new InMemoryDecisionLogStore();
  const ctx: PetDecisionContext = { decider, log: createDecisionLogSink(store, { enabled: () => true }), mode, calibrated: new Set(calibrated), now: () => new Date('2026-10-26T10:00:00Z') };
  return { ctx, store };
}

/** Day 4 of the forming week, a stage-up due, and a three-day absence: candidates C2 then C4. */
function planInput(): PlanInput {
  const NOON = Date.parse('2026-10-26T10:00:00Z');
  const record = newCheckinRecord(300, NOON - 5 * 86_400_000, 'fa');
  record.tz = 'Asia/Tehran';
  record.agents.a = { ...newCheckinAgent(), enabled: true, types: { growingUp: true, seasons: true, garden: true, hellos: true, careNudges: false },
    consent: { purpose: 'optional.pet_checkins', state: 'granted', revision: 1, effectiveAt: NOON - 5 * 86_400_000,
      evidence: { eventId: 'evt-12345678', noticeId: 'perm.P1', noticeVersion: 'pet-checkins-v1', copyHash: 'a'.repeat(64), locale: 'fa', presentedAt: 1, decidedAt: 2, surface: 'mini_app', affirmative: true } } };
  return { record, agent: { id: 'a', hiredAt: new Date(NOON - 3.5 * 86_400_000).toISOString(), stage: 3, formingDay: 4 },
    care: { ...newCare('a', 300, NOON - 4 * 86_400_000, 'Asia/Tehran', 2), lastSeenStage: 2 }, play: newPlay('a', 300, NOON - 4 * 86_400_000), now: NOON, personHash: checkinPersonHash('s', 300) };
}
function sendPlan(input: PlanInput) {
  const plan = planCheckin(input);
  if (plan.status !== 'send') throw new Error(`expected a send, got ${JSON.stringify(plan)}`);
  return plan;
}

describe('checkin_moment and checkin_variant', () => {
  it('off: no call; the local ranker decides', async () => {
    const decider = fakeDecider(() => ({ checkin_moment: choice('C4') }));
    const input = planInput();
    const { ctx } = ctxFor(decider, 'off');
    expect(await chooseCheckin(ctx, input, sendPlan(input), 'Asia/Tehran')).toMatchObject({ pick: { moment: 'C2' }, by: 'local' });
    expect(decider.calls).toHaveLength(0);
  });

  it('shadow: asks over the eligible moments plus none, logs a pet-v1 row, and keeps the local choice', async () => {
    const decider = fakeDecider(() => ({ checkin_moment: choice('C4', 0.8) }));
    const input = planInput();
    const { ctx, store } = ctxFor(decider, 'shadow');
    expect(await chooseCheckin(ctx, input, sendPlan(input), 'Asia/Tehran')).toMatchObject({ pick: { moment: 'C2' }, by: 'local' });
    const q = decider.calls[0].questions[0];
    expect(q.type === 'choice' && q.choices.map((c) => c.value)).toEqual(['C2', 'C4', 'none']);
    // the input is the content-free feature line: no names, no ids, no text
    expect(decider.calls[0].input).toMatch(/stage:3 forming_day:4 band:midday weekday:yes lang:fa days_since_open:4-7 last_checkin:none unopened_streak:0 moments:C2,C4$/);
    await flush();
    expect(store.rows).toEqual([expect.objectContaining({ questionSetVersion: 'pet-v1', routeTaken: 'pet', names: ['checkin_moment'], personaId: 'a', language: 'fa', chatKind: 'private',
      answers: [{ name: 'checkin_moment', type: 'choice', choice: 'C4', confidence: 0.8 }] })]);
  });

  it('on: consumed only for a calibrated question and language; none means no message today', async () => {
    const input = planInput();
    const plan = sendPlan(input);
    expect(await chooseCheckin(ctxFor(fakeDecider(() => ({ checkin_moment: choice('C4') })), 'on', ['checkin_moment:en']).ctx, input, plan, 'Asia/Tehran')).toMatchObject({ pick: { moment: 'C2' }, by: 'local' });
    expect(await chooseCheckin(ctxFor(fakeDecider(() => ({ checkin_moment: choice('C4') })), 'on', ['checkin_moment:fa']).ctx, input, plan, 'Asia/Tehran')).toMatchObject({ pick: { moment: 'C4' }, by: 'decisions' });
    expect(await chooseCheckin(ctxFor(fakeDecider(() => ({ checkin_moment: choice('none') })), 'on', ['checkin_moment:fa']).ctx, input, plan, 'Asia/Tehran')).toEqual({ pick: null, variant: 0, by: 'decisions' });
    // a value never offered, or an unknown result, is the local choice
    expect(await chooseCheckin(ctxFor(fakeDecider(() => ({ checkin_moment: choice('C7') })), 'on', ['checkin_moment:fa']).ctx, input, plan, 'Asia/Tehran')).toMatchObject({ pick: { moment: 'C2' } });
    expect(await chooseCheckin(ctxFor(fakeDecider(() => ({})), 'on', ['checkin_moment:fa']).ctx, input, plan, 'Asia/Tehran')).toMatchObject({ pick: { moment: 'C2' }, by: 'local' });
  });
});

describe('the feature line and the gate', () => {
  it('keeps only catalogue words', () => {
    expect(petFeatureLine({ stage: 3, weekday: true, moments: ['C2', 'C4'], name: 'Mochi the cat', bad: 'a b', 'Bad Key': 'x', none: undefined, empty: [] }))
      .toBe('stage:3 weekday:yes moments:C2,C4 empty:none');
  });

  it('passes a question only with 200 labelled examples in that language for every value', () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, questionSetVersion: 'pet-v1' as const, names: ['tip'], answers: [{ name: 'tip', type: 'choice' as const, choice: i % 2 ? 'T1' : 'none', confidence: 0.8 }],
      outcome: 'answered' as const, elapsedMs: 10, routeTaken: 'pet' as const, personaId: 'a', chatKind: 'private' as const, language: 'fa' as const, at: new Date() }));
    const labels: CalibrationLabel[] = rows.map((r, i) => ({ id: r.id, question: 'tip', label: i % 3 ? 'T1' : 'none' }));
    const report = calibrationReport(rows, labels);
    expect(petCalibrationPasses(report, 'tip', 'fa')).toBe(true);
    expect(petCalibrationPasses(report, 'tip', 'en')).toBe(false);
    expect(petCalibrationPasses(calibrationReport(rows.slice(0, 199), labels), 'tip', 'fa')).toBe(false);
    expect(petCalibratedPairs(report)).toEqual(['tip:fa']);
  });

  it('reads STUDIO_PET_DECISIONS_CALIBRATED and STUDIO_PET_CHECKINS, defaulting to nothing and off', () => {
    expect(petFlags({})).toMatchObject({ petCheckins: 'off' });
    expect([...petFlags({}).petDecisionsCalibrated]).toEqual([]);
    expect(petFlags({ STUDIO_PET_CHECKINS: ' ON ' }).petCheckins).toBe('on');
    expect([...parsePetCalibrated('tip:fa, Checkin_moment:EN ,bad,x:de')]).toEqual(['tip:fa', 'checkin_moment:en']);
  });
});

describe('pet_action', () => {
  it('shadow logs and never returns an action; on returns it only for a calibrated language at ≥ 0.75', async () => {
    const decider = fakeDecider(() => ({ pet_action: choice('feed', 0.9) }));
    const shadow = ctxFor(decider, 'shadow', ['pet_action:en']);
    expect(await startPetAction(shadow.ctx, { agentId: 'a', text: 'can you have a cookie?' }).result()).toBeUndefined();
    await flush();
    expect(shadow.store.rows[0]).toMatchObject({ questionSetVersion: 'pet-v1', names: ['pet_action'], language: 'en' });
    const q = decider.calls[0].questions[0];
    expect(q.type === 'choice' && q.choices.map((c) => c.value)).toEqual(['none', 'feed', 'play_ball', 'sleep', 'open_play', 'open_garden', 'open_closet', 'open_bedroom', 'open_life_book', 'start_guess']);
    expect(await startPetAction(ctxFor(decider, 'on', ['pet_action:en']).ctx, { agentId: 'a', text: 'eat this' }).result()).toEqual({ kind: 'feed', confidence: 0.9 });
    expect(await startPetAction(ctxFor(decider, 'on', ['pet_action:fa']).ctx, { agentId: 'a', text: 'eat this' }).result()).toBeUndefined();
    expect(await startPetAction(ctxFor(fakeDecider(() => ({ pet_action: choice('sleep', 0.7) })), 'on', ['pet_action:en']).ctx, { agentId: 'a', text: 'nap?' }).result()).toBeUndefined();
    expect(await startPetAction(ctxFor(fakeDecider(() => ({ pet_action: choice('none', 0.99) })), 'on', ['pet_action:en']).ctx, { agentId: 'a', text: 'hi' }).result()).toBeUndefined();
    const off = fakeDecider(() => ({ pet_action: choice('feed') }));
    expect(await startPetAction(ctxFor(off, 'off', ['pet_action:en']).ctx, { agentId: 'a', text: 'eat' }).result()).toBeUndefined();
    expect(off.calls).toHaveLength(0);
  });
});

/* ---------- through the routes ---------- */

const ORIGIN = 'https://vox.example';
const user = (id: number): InitDataUser => ({ id, first_name: `U${id}` });

async function allowTalk(h: Harness, agentId: string, telegramId: number) {
  const now = Date.now();
  const options = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'test', enabledCapabilities: ['core_text'],
    accounts: [{ accountId: accountIdFor(telegramId), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
    approvals: [{ schemaVersion: 1, id: 'approval0', revision: 1, createdAt: now, updatedAt: now, jurisdiction: 'SYNTHETIC', capability: 'core_text',
      state: 'approved', configurationVersion: 'test', effectiveAt: now, reviewExpiresAt: now + 86_400_000, owner: 'test-owner', approvalReference: 'synthetic' }] }));
  const adaptive = new AdaptiveService(new AdaptiveRepository(new MemoryAdaptiveStorage()), options);
  h.studio.deps.adaptive = adaptive;
  const confirmed = await adaptive.confirm(telegramId, { confirm: true, adultConfirmed: true, declaredJurisdiction: 'EE' });
  await adaptive.setAgentAccess(telegramId, agentId, { space: 'work', allowed: true, expectedRevision: confirmed.revision, eventId: 'grant-pet-1' });
}

async function route(decider: Decider) {
  const h = makeStudio({ adaptive: false });
  h.studio.deps.webAppUrl = `${ORIGIN}/studio`;
  const store = new InMemoryDecisionLogStore();
  h.studio.deps.decider = decider;
  h.studio.deps.decisionLog = createDecisionLogSink(store, { enabled: () => true });
  const org = await seedOrg(h);
  const mochi = await hire(h, org.alice, { name: 'Mochi' });
  const call = (path: string[] = [], body?: unknown) => handlePetRequest(h.studio, new Request(`${ORIGIN}/api/studio/pet/${mochi.agent.id}${path.length ? `/${path.join('/')}` : ''}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-pet-tz': 'Asia/Tehran', 'x-telegram-init-data': agentInit(user(ID.alice), mochi.token) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), mochi.agent.id, path);
  return { h, store, mochi, call };
}

describe('the view', () => {
  it('shadow: the response is unchanged and tip, ask_now and greeting are logged', async () => {
    vi.stubEnv('STUDIO_PET_DECISIONS', 'shadow');
    const decider = fakeDecider(() => ({ tip: choice('T1'), ask_now: choice('P8'), greeting: choice('morning') }));
    const { call, store } = await route(decider);
    const view = await (await call()).json() as PetView;
    expect(view.suggest).toBeUndefined();
    await flush();
    expect(decider.calls[0].questions.map((q) => q.name)).toEqual(['tip', 'ask_now', 'greeting']);
    expect(decider.calls[0].input).not.toMatch(/Mochi|U300|300/);
    expect(store.rows[0]).toMatchObject({ questionSetVersion: 'pet-v1', names: ['tip', 'ask_now', 'greeting'], routeTaken: 'pet' });
  });

  it('on: only calibrated answers, and never past the 500 ms deadline', async () => {
    vi.stubEnv('STUDIO_PET_DECISIONS', 'on');
    vi.stubEnv('STUDIO_PET_DECISIONS_CALIBRATED', 'tip:en,greeting:en');
    const { call } = await route(fakeDecider(() => ({ tip: choice('T3'), ask_now: choice('P8'), greeting: choice('plain') })));
    expect(((await (await call()).json()) as PetView).suggest).toEqual({ tip: 'T3', greeting: 'plain' });
    const slow = await route(fakeDecider(() => ({ tip: choice('T3') }), 3000));
    const started = Date.now();
    const view = await (await slow.call()).json() as PetView;
    expect(Date.now() - started).toBeLessThan(1500);
    expect(view.suggest).toBeUndefined();
  });

  it('off: Decisions is never asked', async () => {
    const decider = fakeDecider(() => ({ tip: choice('T1') }));
    const { call } = await route(decider);
    expect(((await (await call()).json()) as PetView).suggest).toBeUndefined();
    expect(decider.calls).toHaveLength(0);
    expect(petDecisionContext({ deps: {} } as never).mode).toBe('off');
  });
});

describe('talk', () => {
  it('adds `action` only under on, calibrated, at ≥ 0.75; shadow logs it beside the reply', async () => {
    vi.stubEnv('STUDIO_PET_DECISIONS', 'on');
    vi.stubEnv('STUDIO_PET_DECISIONS_CALIBRATED', 'pet_action:en');
    const { h, call, mochi, store } = await route(fakeDecider(() => ({ pet_action: choice('open_garden', 0.88) })));
    await allowTalk(h, mochi.agent.id, ID.alice);
    const body = await (await call(['talk'], { text: 'let us go to the garden' })).json() as TalkResponse;
    expect(body).toMatchObject({ reply: 'Sure.', action: { kind: 'open_garden', confidence: 0.88 } });
    vi.stubEnv('STUDIO_PET_DECISIONS', 'shadow');
    const shadow = await (await call(['talk'], { text: 'let us go to the garden' })).json() as TalkResponse;
    expect(shadow.action).toBeUndefined();
    await flush();
    expect(store.rows.map((r) => r.names)).toEqual([['pet_action'], ['pet_action']]);
  });

  it('voice: the pre-pass starts from the transcript, on the plain and the streamed answer', async () => {
    vi.stubEnv('STUDIO_PET_DECISIONS', 'on');
    vi.stubEnv('STUDIO_PET_DECISIONS_CALIBRATED', 'pet_action:en');
    const decider = fakeDecider(() => ({ pet_action: choice('sleep', 0.8) }));
    const { h, mochi } = await route(decider);
    await allowTalk(h, mochi.agent.id, ID.alice);
    const voice = (query = '') => {
      const form = new FormData();
      form.append('audio', new Blob([new Uint8Array(8)], { type: 'audio/webm' }));
      return handlePetRequest(h.studio, new Request(`${ORIGIN}/api/studio/pet/${mochi.agent.id}/talk-voice${query}`, {
        method: 'POST', headers: { origin: ORIGIN, 'x-pet-tz': 'Asia/Tehran', 'x-telegram-init-data': agentInit(user(ID.alice), mochi.token) }, body: form,
      }), mochi.agent.id, ['talk-voice']);
    };
    expect(await (await voice()).json()).toMatchObject({ transcript: 'hello there', action: { kind: 'sleep', confidence: 0.8 } });
    expect(decider.calls[0].input).toContain('hello there');
    const lines = (await (await voice('?stream=1')).text()).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.at(-1)).toMatchObject({ type: 'done', action: { kind: 'sleep', confidence: 0.8 } });
  });
});
