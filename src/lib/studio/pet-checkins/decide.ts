/**
 * Which eligible check-in to send, if any (design §8.2 `checkin_moment`, `checkin_variant`). The planner already
 * applied every hard rule; this only chooses among its candidates. The local ranker decides by default. Under
 * STUDIO_PET_DECISIONS=shadow, Decisions is asked as well and logged as `pet-v1`, and the local choice is kept. Under
 * `on`, a calibrated answer is consumed (`none` means no message today); an uncalibrated or unknown one is not.
 */

import { CHECKIN_MOMENTS, type CheckinMomentId } from '../../pet/checkins';
import { askPetDecisions, choiceQuestion, daysBucket, petDecisionInput, petDecisionLive, petFeatureLine, pickChoice, PET_DECISION_DEADLINES, timeBand, type PetDecisionContext } from '../pet-decisions';
import type { DecisionQuestion } from '../../tireh/triage';
import { localClock, templateVariants, type CheckinCandidate, type CheckinPlan, type PlanInput } from './planner';

export interface CheckinChoice {
  /** null: Decisions (calibrated, `on`) answered none: no message today */
  pick: CheckinCandidate | null;
  variant: number;
  by: 'local' | 'decisions';
}

const FRAME = 'You choose whether a virtual pet sends one short, optional, pre-written message to the person who looks after it, and which. '
  + 'Prefer none whenever a message might be unwelcome or unnecessary: an unwanted message costs far more than a moment left unannounced. '
  + 'Judge only from the facts given; never infer anything about the person\'s feelings, health or habits.';

/** The content-free feature line for one plan (§8.3). */
export function checkinFeatures(input: PlanInput, plan: Extract<CheckinPlan, { status: 'send' }>, tz: string): string {
  const { care, agent, record, now } = input;
  const clock = localClock(now, tz);
  const last = [...record.sent].filter((s) => s.agentId === agent.id).sort((a, b) => b.at - a.at)[0];
  return petFeatureLine({
    stage: agent.stage, forming_day: agent.formingDay ?? 'formed', band: timeBand(clock.hour), weekday: plan.lang === 'fa' ? clock.weekday !== 5 : clock.weekday !== 0 && clock.weekday !== 6,
    lang: plan.lang, days_since_open: care ? daysBucket(now - care.lastSeenAt) : 'never',
    last_checkin: !last ? 'none' : last.openedAt !== undefined ? 'opened' : last.stoppedAt !== undefined ? 'stopped' : 'unopened',
    unopened_streak: plan.streak, moments: plan.candidates.map((c) => c.moment),
  });
}

export function checkinQuestions(plan: Extract<CheckinPlan, { status: 'send' }>): DecisionQuestion[] {
  const moments = choiceQuestion('checkin_moment', 'Which of the listed moments, if any, should the pet mention today? Answer none unless one clearly fits.', [
    ...plan.candidates.map((c) => ({ value: c.moment, description: CHECKIN_MOMENTS[c.moment].description })),
    { value: 'none', description: 'Send nothing today.' },
  ]);
  const variants = templateVariants(plan.pick.template, plan.lang);
  if (variants.length < 2) return [moments];
  return [moments, choiceQuestion('checkin_variant', `If the pet sends moment ${plan.pick.moment}, which wording fits best?`,
    variants.map((text, i) => ({ value: `v${i}`, description: text })))];
}

/** The local choice, the shadow call, or a calibrated Decisions answer (see the file comment). Never throws. */
export async function chooseCheckin(ctx: PetDecisionContext, input: PlanInput, plan: Extract<CheckinPlan, { status: 'send' }>, tz: string): Promise<CheckinChoice> {
  const local: CheckinChoice = { pick: plan.pick, variant: plan.variant, by: 'local' };
  if (ctx.mode === 'off' || !ctx.decider) return local;
  const questions = checkinQuestions(plan);
  const pending = askPetDecisions(ctx, { agentId: input.agent.id, lang: plan.lang, input: petDecisionInput(FRAME, checkinFeatures(input, plan, tz)),
    questions, deadlineMs: PET_DECISION_DEADLINES.checkin });
  if (ctx.mode === 'shadow') { await pending; return local; }
  const detail = await pending;
  const chosen = petDecisionLive(ctx, 'checkin_moment', plan.lang)
    ? pickChoice(detail, 'checkin_moment', [...plan.candidates.map((c) => c.moment), 'none']) : null;
  if (chosen?.value === 'none') return { pick: null, variant: 0, by: 'decisions' };
  const pick = chosen ? plan.candidates.find((c) => c.moment === (chosen.value as CheckinMomentId)) ?? plan.pick : plan.pick;
  let variant = pick === plan.pick ? plan.variant : 0;
  const count = templateVariants(pick.template, plan.lang).length;
  const v = pick === plan.pick && petDecisionLive(ctx, 'checkin_variant', plan.lang)
    ? pickChoice(detail, 'checkin_variant', Array.from({ length: count }, (_, i) => `v${i}`)) : null;
  if (v) variant = Number(v.value.slice(1));
  return { pick, variant, by: chosen || v ? 'decisions' : 'local' };
}
