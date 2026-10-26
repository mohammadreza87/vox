/** The check-in planner (design §5.3, §5.5): pure, deterministic, every hard rule before any choice. */
import { describe, expect, it } from 'vitest';
import { newCare } from '../../pet/care';
import { CHECKIN_MOMENTS, newCheckinAgent, newCheckinRecord, unopenedStreak, type PetCheckinRecord, type PetCheckinSent } from '../../pet/checkins';
import { MOURNING_TABLE, mourningStatus, type MourningTable } from '../../pet/mourning-days';
import { newPlay, type PetPlay } from '../../pet/play';
import type { PetCare } from '../../pet/types';
import { checkinPersonHash, eligibleMoments, planCheckin, type PlanInput } from '../pet-checkins/planner';

const TZ = 'Asia/Tehran';
const HOUR = 3_600_000, DAY = 24 * HOUR;
/** 2026-10-26 13:30 in Tehran (UTC+3:30): no festival, outside quiet hours. */
const NOON = Date.parse('2026-10-26T10:00:00Z');
const HASH = checkinPersonHash('synthetic-secret', 300);
const A = 'agent-a', B = 'agent-b';

function record(o: { types?: Partial<PetCheckinRecord['agents'][string]['types']>; agents?: string[]; tz?: string | null; sent?: PetCheckinSent[]; decidedAt?: number } = {}): PetCheckinRecord {
  const r = newCheckinRecord(300, NOON - 30 * DAY, 'fa');
  for (const id of o.agents ?? [A]) {
    r.agents[id] = { ...newCheckinAgent(), enabled: true, types: { growingUp: true, seasons: true, garden: true, hellos: true, careNudges: true, ...o.types },
      consent: { purpose: 'optional.pet_checkins', state: 'granted', revision: 1, effectiveAt: o.decidedAt ?? NOON - 20 * DAY,
        evidence: { eventId: 'evt-12345678', noticeId: 'perm.P1', noticeVersion: 'pet-checkins-v1', copyHash: 'a'.repeat(64), locale: 'fa',
          presentedAt: (o.decidedAt ?? NOON - 20 * DAY) - 1000, decidedAt: o.decidedAt ?? NOON - 20 * DAY, surface: 'mini_app', affirmative: true } } };
  }
  if (o.tz !== null) r.tz = o.tz ?? TZ;
  r.sent = o.sent ?? [];
  return r;
}

function care(o: Partial<PetCare> = {}, at = NOON - 2 * DAY): PetCare {
  return { ...newCare(A, 300, at, TZ, 4), ...o };
}

let refs = 0;
function sent(o: Partial<PetCheckinSent> & { at: number }): PetCheckinSent {
  refs++;
  return { ref: `ref${String(refs).padStart(13, '0')}xyz`, agentId: A, moment: 'C2', occurrence: `x:${refs}`, day: '2026-10-01', personHash: HASH,
    state: 'accepted', lang: 'fa', variant: 0, ...o };
}

function input(o: Partial<PlanInput> = {}): PlanInput {
  return { record: record(), agent: { id: A, hiredAt: new Date(NOON - 20 * DAY).toISOString(), stage: 4, formingDay: 7 }, care: care(), play: newPlay(A, 300, NOON - 20 * DAY),
    now: NOON, personHash: HASH, ...o };
}

/** An agent in its forming week: day 4 (stage 3), and a person who last saw stage 2. */
function forming(o: Partial<PlanInput> = {}): PlanInput {
  return input({ agent: { id: A, hiredAt: new Date(NOON - 3.5 * DAY).toISOString(), stage: 3, formingDay: 4 }, care: care({ lastSeenStage: 2 }), ...o });
}

describe('consent and the switches', () => {
  it('sends a due stage-up with its template and a stable variant', () => {
    const plan = planCheckin(forming());
    expect(plan).toMatchObject({ status: 'send', lang: 'fa', day: '2026-10-26', pick: { moment: 'C2', type: 'growingUp', template: 'ci.C2.stageUp', occurrence: 'stage:3' }, variant: 0 });
    expect(planCheckin(forming())).toEqual(plan);
  });

  it('needs consent for this agent and this moment type', () => {
    const off = record(); off.agents[A].enabled = false;
    expect(planCheckin(forming({ record: off }))).toMatchObject({ status: 'skip', reason: 'off' });
    const withdrawn = record(); withdrawn.agents[A].consent = { ...withdrawn.agents[A].consent!, state: 'withdrawn' };
    expect(planCheckin(forming({ record: withdrawn }))).toMatchObject({ status: 'skip', reason: 'off' });
    expect(planCheckin(forming({ record: record({ types: { growingUp: false } }) }))).toMatchObject({ status: 'skip', reason: 'none_eligible' });
    // another agent's consent never covers this one
    expect(planCheckin(forming({ record: record({ agents: [B] }) }))).toMatchObject({ status: 'skip', reason: 'off' });
  });

  it('an unknown zone is inbox-only: nothing goes to Telegram', () => {
    expect(planCheckin(forming({ record: record({ tz: null }) }))).toMatchObject({ status: 'inbox_only' });
    expect(planCheckin(forming({ record: record({ tz: 'Mars/Olympus' }) }))).toMatchObject({ status: 'inbox_only' });
  });

  it('never sends 21:00-08:00 in the person\'s zone (the stricter union of 22-08 and 21-08)', () => {
    const at = (h: number, m = 0) => Date.parse(`2026-10-26T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+03:30`);
    expect(planCheckin(forming({ now: at(21, 5) }))).toMatchObject({ status: 'skip', reason: 'quiet_hours' });
    expect(planCheckin(forming({ now: at(3) }))).toMatchObject({ status: 'skip', reason: 'quiet_hours' });
    expect(planCheckin(forming({ now: at(7, 59) }))).toMatchObject({ status: 'skip', reason: 'quiet_hours' });
    expect(planCheckin(forming({ now: at(8) }))).toMatchObject({ status: 'send' });
    expect(planCheckin(forming({ now: at(20, 59) }))).toMatchObject({ status: 'send' });
  });
});

describe('caps', () => {
  it('one a day per agent (a reserved send counts) and three a rolling week', () => {
    expect(planCheckin(forming({ record: record({ sent: [sent({ at: NOON - HOUR, day: '2026-10-26', state: 'reserved' })] }) }))).toMatchObject({ reason: 'agent_day' });
    // a refused or cancelled send never counts
    expect(planCheckin(forming({ record: record({ sent: [sent({ at: NOON - HOUR, day: '2026-10-26', state: 'failed' })] }) }))).toMatchObject({ status: 'send' });
    const week = [1, 2, 3].map((d) => sent({ at: NOON - d * DAY, day: `2026-10-${26 - d}`, openedAt: NOON - d * DAY + HOUR }));
    expect(planCheckin(forming({ record: record({ sent: week }) }))).toMatchObject({ reason: 'agent_week' });
    const older = [1, 2, 8].map((d) => sent({ at: NOON - d * DAY, day: `2026-10-${26 - d}`, openedAt: NOON - d * DAY + HOUR }));
    expect(planCheckin(forming({ record: record({ sent: older }) }))).toMatchObject({ status: 'send' });
  });

  it('shares the Vox-wide proactive budget (2 a rolling 24 h) across agents', () => {
    const others = [sent({ agentId: B, at: NOON - 3 * HOUR, day: '2026-10-26', openedAt: NOON - 2 * HOUR }), sent({ agentId: 'agent-c', at: NOON - 2 * HOUR, day: '2026-10-26', openedAt: NOON - HOUR })];
    expect(planCheckin(forming({ record: record({ sent: others }) }))).toMatchObject({ status: 'skip', reason: 'budget' });
    expect(planCheckin(forming({ record: record({ sent: others.slice(1) }) }))).toMatchObject({ status: 'send' });
    expect(planCheckin(forming({ record: record({ sent: others.slice(1) }), dailyCap: 1 }))).toMatchObject({ reason: 'budget' });
  });

  it('two unopened in a row: the next eligible moment waits seven days after the last send', () => {
    const two = [sent({ at: NOON - 3 * DAY }), sent({ at: NOON - 4 * DAY })];
    expect(unopenedStreak(two, NOON)).toBe(2);
    expect(planCheckin(forming({ record: record({ sent: two }) }))).toMatchObject({ status: 'skip', reason: 'cooling', streak: 2 });
    const later = [sent({ at: NOON - 8 * DAY }), sent({ at: NOON - 9 * DAY })];
    expect(planCheckin(forming({ record: record({ sent: later }) }))).toMatchObject({ status: 'send' });
    // an opened send ends the streak; a send still inside its 48 h does not count yet
    expect(unopenedStreak([sent({ at: NOON - 3 * DAY }), sent({ at: NOON - 4 * DAY, openedAt: NOON - 4 * DAY + HOUR }), sent({ at: NOON - 5 * DAY })], NOON)).toBe(1);
    expect(unopenedStreak([sent({ at: NOON - HOUR }), sent({ at: NOON - 3 * DAY })], NOON)).toBe(1);
  });

  it('three unopened in a row pause the whole purpose; a pause holds until a tap, and a resume starts a fresh count', () => {
    const three = [3, 12, 20].map((d) => sent({ at: NOON - d * DAY, agentId: d === 12 ? B : A }));
    expect(planCheckin(forming({ record: record({ sent: three }) }))).toMatchObject({ status: 'skip', reason: 'pause_now', streak: 3 });
    const paused = record(); paused.pausedAt = NOON - DAY;
    expect(planCheckin(forming({ record: paused }))).toMatchObject({ reason: 'paused' });
    const resumed = record({ sent: three.map((s) => ({ ...s, at: s.at - 10 * DAY })) }); resumed.resumedAt = NOON - 2 * DAY;
    expect(planCheckin(forming({ record: resumed }))).toMatchObject({ status: 'send', streak: 0 });
  });
});

describe('the catalogue', () => {
  it('never a hunger moment: a hungry pet sends nothing of its own', () => {
    const hungry = care({ tummy: 25, joy: 90, energy: 90, lastSeenStage: 4, bond: 0, seenBond: 0, lastSeenAt: NOON - HOUR });
    expect(planCheckin(input({ care: hungry }))).toMatchObject({ status: 'skip', reason: 'none_eligible' });
    expect(Object.values(CHECKIN_MOMENTS).map((m) => m.template).join(' ')).not.toMatch(/hung|eat|food|feed/i);
  });

  it('C1 the first morning after the first meeting, when the person said yes that first day and a stage-up is due', () => {
    const met = Date.parse('2026-10-25T15:00:00+03:30');
    const morning = Date.parse('2026-10-26T09:00:00+03:30');
    const plan = planCheckin({ ...forming({ now: morning }), record: record({ decidedAt: met + HOUR }), care: care({ lastSeenStage: 1, firstMetAt: met, lastSeenAt: met + HOUR }, met),
      agent: { id: A, hiredAt: new Date(met - 1.2 * DAY).toISOString(), stage: 2, formingDay: 2 } });
    expect(plan).toMatchObject({ status: 'send', pick: { moment: 'C1', occurrence: 'stage:2' } });
    // the same stage is never sent twice (C1 and C2 share the occurrence)
    const again = planCheckin({ ...forming({ now: morning + DAY }), record: record({ decidedAt: met + HOUR, sent: [sent({ at: morning, moment: 'C1', occurrence: 'stage:2', day: '2026-10-26', openedAt: morning + HOUR })] }),
      care: care({ lastSeenStage: 1, firstMetAt: met, lastSeenAt: met + HOUR }, met), agent: { id: A, hiredAt: new Date(met - 1.2 * DAY).toISOString(), stage: 2, formingDay: 2 } });
    expect(again).toMatchObject({ status: 'skip', reason: 'none_eligible' });
  });

  it('C3 on day 7 of the forming week, unseen; C6 an unseen bond milestone', () => {
    const hired = NOON - 6.2 * DAY;
    expect(planCheckin(input({ agent: { id: A, hiredAt: new Date(hired).toISOString(), stage: 4, formingDay: 7 }, care: care({ lastSeenStage: 4, lastSeenAt: hired + 5 * DAY }) })))
      .toMatchObject({ status: 'send', pick: { moment: 'C3', occurrence: 'formed' } });
    expect(planCheckin(input({ care: care({ lastSeenStage: 4, bond: 52, seenBond: 30, lastSeenAt: NOON - HOUR }) }))).toMatchObject({ pick: { moment: 'C6', occurrence: 'bond:2' } });
  });

  it('C4 hellos on day 3 and day 10 of an absence, then silence', () => {
    const away = (days: number, hellos: number[]) => planCheckin(input({ now: NOON, care: care({ lastSeenStage: 4, lastSeenAt: NOON - days * DAY }),
      record: record({ sent: hellos.map((d) => sent({ at: NOON - d * DAY, moment: 'C4', occurrence: `away:x:${d}`, openedAt: NOON - d * DAY + HOUR })) }) }));
    expect(away(2, [])).toMatchObject({ reason: 'none_eligible' });
    expect(away(3, [])).toMatchObject({ pick: { moment: 'C4' } });
    expect(away(9, [6])).toMatchObject({ reason: 'none_eligible' });
    expect(away(10, [7])).toMatchObject({ pick: { moment: 'C4' } });
    expect(away(20, [17, 10])).toMatchObject({ reason: 'none_eligible' });
    expect(planCheckin(input({ record: record({ types: { hellos: false } }), care: care({ lastSeenStage: 4, lastSeenAt: NOON - 3 * DAY }) }))).toMatchObject({ reason: 'none_eligible' });
  });

  it('C10 only between 19:00 and 20:30, when energy is what the pet wants, for someone who opted in', () => {
    const evening = Date.parse('2026-10-26T19:45:00+03:30');
    const sleepy = care({ lastSeenStage: 4, tummy: 90, joy: 90, energy: 40, lastUpdatedAt: evening, lastSeenAt: evening - HOUR });
    expect(planCheckin(input({ now: evening, care: sleepy }))).toMatchObject({ pick: { moment: 'C10' } });
    expect(planCheckin(input({ now: evening + 50 * 60_000, care: { ...sleepy, lastUpdatedAt: evening + 50 * 60_000 } }))).toMatchObject({ reason: 'none_eligible' });
    expect(planCheckin(input({ now: evening, care: sleepy, record: record({ types: { careNudges: false } }) }))).toMatchObject({ reason: 'none_eligible' });
  });

  it('C5 a bloom the person has not seen since', () => {
    const play: PetPlay = { ...newPlay(A, 300, NOON - 5 * DAY), garden: { seed: 'flower', plantedAt: NOON - 5 * DAY, waterings: 3, bloomedAt: NOON - DAY } };
    expect(planCheckin(input({ play, care: care({ lastSeenStage: 4, lastSeenAt: NOON - 2 * DAY }) }))).toMatchObject({ pick: { moment: 'C5', occurrence: `bloom:${NOON - 5 * DAY}` } });
    expect(planCheckin(input({ play, care: care({ lastSeenStage: 4, lastSeenAt: NOON - HOUR }) }))).toMatchObject({ reason: 'none_eligible' });
  });

  it('the local priority: a stage-up before a hello', () => {
    const plan = planCheckin(forming({ care: care({ lastSeenStage: 2, lastSeenAt: NOON - 4 * DAY }) }));
    expect(plan.status === 'send' && plan.candidates.map((c) => c.moment)).toEqual(['C2', 'C4']);
  });
});

describe('seasons', () => {
  /** Yalda 1405: 30 Azar = 21 December 2026, evening in Tehran. */
  const YALDA = Date.parse('2026-12-21T18:30:00+03:30');
  const seasonal = (o: Partial<PlanInput> = {}) => input({ now: YALDA, care: care({ lastSeenStage: 4, lastSeenAt: YALDA - HOUR }), ...o });

  it('Yalda in the evening only, once per festival per person across agents', () => {
    expect(planCheckin(seasonal())).toMatchObject({ status: 'send', pick: { moment: 'C7', occurrence: 'yalda:1405', season: { id: 'yalda', year: 1405 } } });
    expect(planCheckin(seasonal({ now: Date.parse('2026-12-21T12:00:00+03:30') }))).toMatchObject({ reason: 'none_eligible' });
    const elsewhere = record({ agents: [A, B] }); elsewhere.seasons.yalda = 1405;
    expect(planCheckin(seasonal({ record: elsewhere }))).toMatchObject({ reason: 'none_eligible' });
    expect(planCheckin(seasonal({ record: record({ types: { seasons: false } }) }))).toMatchObject({ reason: 'none_eligible' });
  });

  it('no seasonal moment on a mourning day, or on a day the table cannot vouch for', () => {
    const mourning: MourningTable = { ...MOURNING_TABLE, days: [...MOURNING_TABLE.days, { date: '1405-09-30', id: 'fatima', verified: true }] };
    expect(planCheckin(seasonal({ mourning }))).toMatchObject({ reason: 'none_eligible' });
    const neighbour: MourningTable = { ...MOURNING_TABLE, days: [{ date: '1405-10-01', id: 'fatima', verified: false }] };
    expect(planCheckin(seasonal({ mourning: neighbour }))).toMatchObject({ reason: 'none_eligible' });
    const uncovered: MourningTable = { ...MOURNING_TABLE, years: [1406] };
    expect(planCheckin(seasonal({ mourning: uncovered }))).toMatchObject({ reason: 'none_eligible' });
  });

  it('Nowruz on its first morning; Chaharshanbe Suri on the Tuesday evening', () => {
    const nowruz = Date.parse('2027-03-21T09:00:00+03:30');
    expect(eligibleMoments(input({ now: nowruz, care: care({ lastSeenStage: 4, lastSeenAt: nowruz - HOUR }) }), TZ).map((c) => c.moment)).toEqual(['C9']);
    const suri = Date.parse('2027-03-16T19:00:00+03:30');
    expect(eligibleMoments(input({ now: suri, care: care({ lastSeenStage: 4, lastSeenAt: suri - HOUR }) }), TZ).map((c) => c.moment)).toEqual(['C8']);
  });
});

describe('the mourning table', () => {
  it('covers the next two Persian years and quiets an unverified date\'s neighbours', () => {
    expect(MOURNING_TABLE.years).toEqual([1405, 1406]);
    expect(mourningStatus(Date.parse('2026-06-25T12:00:00+03:30'), TZ)).toBe('mourning'); // Ashura 1405 (4 Tir)
    expect(mourningStatus(Date.parse('2026-06-26T12:00:00+03:30'), TZ)).toBe('mourning'); // the day after, unverified
    expect(mourningStatus(Date.parse('2026-06-04T12:00:00+03:30'), TZ)).toBe('mourning'); // 14 Khordad, verified
    expect(mourningStatus(Date.parse('2026-06-05T12:00:00+03:30'), TZ)).toBe('clear');
    expect(mourningStatus(Date.parse('2026-12-21T19:00:00+03:30'), TZ)).toBe('clear'); // Yalda 1405
    expect(mourningStatus(Date.parse('2028-04-01T12:00:00+03:30'), TZ)).toBe('uncertain'); // 1407: not in the table
    for (const d of MOURNING_TABLE.days) expect(d.date).toMatch(/^140[56]-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
  });
});
