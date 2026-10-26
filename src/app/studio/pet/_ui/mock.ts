/**
 * The ?mock=1 fake: an in-memory PetApi that applies care.ts locally and answers talk with canned
 * lines, so demos, the lab and a plain browser get the whole page with no server and no Telegram.
 * Same shapes and the same guards as the real API; small latencies so "thinking" is visible.
 */

import { PRESET_LOOKS } from '@/lib/studio/character';
import { PetError } from './errors';
import { applyLocal, openLocal, talkLocal } from './care-local';
import { applyPlay, newPlay, playView, roomMoment, type PetPlay } from '@/lib/pet/play';
import type { CheckinPrefs, PetActionKind, PetApi, PetGrowthView, TalkAction } from './contract';
import type { CharacterLook, CircleDecisionRequest, PetCare, PetCircle, PetNote, PetPrivateView, PetView, Stage, TalkResponse } from '@/lib/pet/types';

export interface MockOptions {
  /** PRESET_LOOKS index (default 0, the lagoon cloud) */
  look?: number;
  stage?: number;
  /** guest: full page, talk goes to the DM · private: the 403 sleeper · outside: no Telegram (401) */
  role?: 'guest' | 'private' | 'outside';
  /** play welcome-back with a souvenir on open */
  welcome?: boolean;
  /** play the stage-up celebration on open */
  stageUp?: boolean;
  /** Wave B: the mic sheet (UX-02) has not been answered yet */
  askMic?: boolean;
  /** Wave C: the Garden's pot (seeded, ready to bloom on the next watering, bloomed) */
  garden?: string;
  /** Wave C: opened from a check-in (`?ci=C5`): the first GET carries `checkin` */
  ci?: string;
  /** Wave C: check-ins already on, or on and paused (the paused note) */
  checkins?: string;
  /** Wave C: two keepsakes already earned (the Closet, T14) */
  items?: boolean;
  /** starting needs and Bond (default: Tummy in "wants" so the rings, wiggle and thought bubble show) */
  care?: Partial<Pick<PetCare, 'tummy' | 'joy' | 'energy' | 'bond'>>;
  /** latency per call in ms (default 260 for care, 1400 for talk) */
  latency?: { care?: number; talk?: number };
  now?: () => number;
}

const DAY = 24 * 60 * 60 * 1000;
const NAME = 'Mochi';

const REPLIES = [
  'That sounds lovely. Tell me more?',
  'Ooh, I like that idea!',
  'Hmm, let me think… yes, I think you’re right.',
  'You always make the clouds feel lighter.',
  'Ha! That made my day.',
];
const BYE = /\b(bye|goodbye|good night|goodnight|see you|later)\b/i;

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new PetError(0, 'network', 'Aborted')); }, { once: true });
});

/** pet_action demo (§8.4): a few plain requests the triage pre-pass would classify. */
const ACTIONS: [RegExp, PetActionKind][] = [[/\b(bed|sleep|nap)\b/i, 'sleep'], [/\b(cookie|snack|eat)\b/i, 'feed'], [/\bball\b/i, 'play_ball'],
  [/\bgarden\b/i, 'open_garden'], [/\bcloset\b/i, 'open_closet'], [/\b(guess|word game)\b/i, 'start_guess']];
function actionOf(text: string): { action?: TalkAction } {
  const hit = ACTIONS.find(([re]) => re.test(text));
  return hit ? { action: { kind: hit[1], confidence: 0.9 } } : {};
}

const clampStage = (n: number | undefined): Stage => (n === 1 || n === 2 || n === 3 || n === 4 ? n : 3);

export function createMockApi(o: MockOptions = {}): PetApi {
  const now = o.now ?? (() => Date.now());
  let look: CharacterLook = PRESET_LOOKS[Math.abs(o.look ?? 0) % PRESET_LOOKS.length];
  const stage = clampStage(o.stage);
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();
  const t0 = now();
  // a few needs in "wants" so the rings, the wiggle and the thought bubble show on a demo
  let care: PetCare = {
    v: 1, agentId: 'mock', userId: 1,
    tummy: 48, joy: 72, energy: 84, bond: 12, ...o.care,
    asleep: false, lastUpdatedAt: t0, lastSeenAt: t0 - (o.welcome ? 2 * DAY : 60_000), firstMetAt: t0 - 3 * DAY,
    tz, quietStart: 22, quietEnd: 8, lastSeenStage: o.stageUp && stage > 1 ? ((stage - 1) as Stage) : stage,
    caps: { hourStart: t0, petJoy: 0, talkJoy: 0, careBond: 0, dayStart: t0 },
  };
  let turn = 0;
  // Wave B demo: a play record (applied with play.ts, like the server) and a few growth moments
  let play: PetPlay = newPlay('mock', 1, t0 - 3 * DAY);
  // the demo person already said yes to the mic (UX-02), so hold-to-talk records at once (the sheet: ?mock=1&ask=mic)
  if (!o.askMic) play.asks.P3 = { lastAskedAt: t0 - DAY, declined: 0, acceptedAt: t0 - DAY };
  const HOUR = DAY / 24;
  if (o.garden === 'seeded') play.garden = { seed: 'flower', plantedAt: t0 - HOUR, waterings: 0 };
  if (o.garden === 'ready') play.garden = { seed: 'flower', plantedAt: t0 - 2 * DAY, waterings: 2 };
  if (o.garden === 'bloom') { play.garden = { seed: 'flower', plantedAt: t0 - 3 * DAY, waterings: 3, bloomedAt: t0 - HOUR }; play.items.push({ id: 'bloomPin', earnedAt: t0 - HOUR }); play.book.push({ id: 'bloom', at: t0 - HOUR }); }
  if (o.items && !play.items.length) play.items.push({ id: 'bloomPin', earnedAt: t0 - DAY }, { id: 'starPin', earnedAt: t0 - DAY });
  let checkin = o.ci ? { ref: 'mock-ci-reference-x', momentId: o.ci } : undefined;
  let prefs: CheckinPrefs = { enabled: o.checkins === 'on' || o.checkins === 'paused', types: { growingUp: true, seasons: true, garden: true, hellos: false, careNudges: false },
    sound: false, sentThisWeek: 0, live: true, ...(o.checkins === 'paused' ? { pausedAt: t0 - DAY, pausedNote: true as const } : {}) };
  /** the paused note shows once per pause: the first read carries it, then it is marked shown (like the server) */
  const readPrefs = (): CheckinPrefs => { const p = { ...prefs, types: { ...prefs.types } }; if (prefs.pausedNote) { const { pausedNote: _n, ...rest } = prefs; void _n; prefs = rest; } return p; };
  let growth: PetGrowthView = { mine: [], moments: [
    { id: 'release', kind: 'taught', title: 'I learned how you plan a release', hint: 'Tell me how your team plans a release, then say “remember this”' },
    { id: 'report', kind: 'task', title: 'I wrote our first weekly report together', hint: 'Ask me for a weekly report' },
    { id: 'calendar', kind: 'access', title: 'I got the access I need to read the team calendar', hint: 'Let me read the team calendar', lit: { at: new Date(t0 - DAY).toISOString() } },
    ...(['play', 'garden', 'closet', 'bedroom', 'book'] as const).map((r) => ({ id: roomMoment(r), kind: 'room' as const, title: `We found the ${r} together`, hint: `Peek into the ${r} with me sometime` })),
  ] };
  // personal moments (first room visits, own grants) show in `mine`, never as an agent-wide `lit`
  const litMine = () => { growth = { ...growth, mine: play.litMine.map((l) => l.id) }; };
  // Circles S4 demo (`?mock=1&j=<16+ chars>`): a two-person group card and a few notes, in memory.
  let myState: PetCircle['myState'] = null;
  let notes: PetNote[] = [
    { copyId: 'm1-aaaaaaaaaaaa', text: 'We are going to Shiraz in May 🌸', savedAt: new Date(t0 - DAY).toISOString(), groupTitle: 'HOOR family' },
    { copyId: 'm2-bbbbbbbbbbbb', text: 'Parastoo likes her tea with cardamom.', savedAt: new Date(t0 - 2 * DAY).toISOString(), groupTitle: 'HOOR family', byMe: true },
    { copyId: 'm3-cccccccccccc', text: 'Water the basil on Sundays.', savedAt: new Date(t0 - 3 * DAY).toISOString(), byMe: true },
  ];
  const circle = (): PetCircle => ({
    chatTitle: 'HOOR family', agents: [NAME], joined: myState === 'joined' ? 2 : 1, total: 2, on: myState === 'joined', myState,
    ...(myState === 'joined' ? { members: ['Parastoo'] } : {}),
    card: { copy: { notice: `🐾 ${NAME} can keep notes for this group: only things someone here asks to save. Every member who joins keeps their own copy. Adults (18+) only.`,
      join: 'Join · 18+', reply: 'Only reply to me', decline: 'Not me' }, copyHash: '0'.repeat(64), revision: 'gmock', locale: 'en' },
  });

  const refuse = () => {
    if (o.role === 'outside') throw new PetError(401, 'authentication_required', 'Open in Telegram');
    if (o.role === 'private') {
      const body: PetPrivateView = { error: 'pet_private', name: NAME, look, stage };
      throw new PetError(403, 'pet_private', 'Private', body);
    }
  };

  // every GET is an "open" on the server: decay, welcome floors, quiet-hours sleep, stage-up, once each
  const view = (): PetView => {
    const t = now();
    const opened = openLocal(care, t, stage);
    care = opened.care;
    return {
      agentId: 'mock', name: NAME, look, stage, formingDay: 5, botUsername: 'vox_mochi_bot', voice: false, listen: o.role !== 'guest',
      role: o.role === 'guest' ? 'guest' : 'owner', care, now: t, play: playView(play, t, tz), growth, canEditLook: o.role !== 'guest',
      ...(opened.welcome ? { welcome: { souvenir: 'I kept thinking about your trip to Shiraz.', awayMs: opened.welcome.awayMs } } : {}),
      ...(opened.stageUp ? { stageUp: opened.stageUp } : {}),
      ...(opened.bondMilestone === undefined ? {} : { bondMilestone: opened.bondMilestone }),
      ...(checkin ? { checkin } : {}),
      ...(prefs.enabled || prefs.pausedAt ? { checkins: readPrefs() } : {}),
    };
  };

  const talkReply = (text: string): TalkResponse => {
    const goodbye = BYE.test(text);
    care = talkLocal(care, now());
    return goodbye
      ? { reply: 'Bye for now! Come say hi whenever you like.', goodbye: true, care, turnId: `mock-${++turn}` }
      : /remember/i.test(text) ? { reply: 'Okay, I saved that note.', care, turnId: `mock-${++turn}`, savedNote: true } as TalkResponse
      : { reply: REPLIES[turn++ % REPLIES.length], care, turnId: `mock-${turn}`, ...actionOf(text) };
  };

  return {
    async get(_agentId, opts) {
      await sleep(120, opts?.signal);
      refuse();
      const v = view();
      // a check-in's moment replays once, on the open it came with
      checkin = undefined;
      return v;
    },
    async checkins(_agentId, req, opts) {
      await sleep(o.latency?.care ?? 260, opts?.signal);
      refuse();
      if (req && 'op' in req) {
        if (req.op === 'resume') { const { pausedAt: _p, pausedNote: _n, ...rest } = prefs; void _p; void _n; prefs = { ...rest, enabled: true }; }
        else if (req.op === 'stop') prefs = req.type ? { ...prefs, types: { ...prefs.types, [req.type]: false } } : { ...prefs, enabled: false };
      } else if (req) prefs = { ...prefs, enabled: req.enabled, ...(req.enabled && req.types ? { types: { ...prefs.types, ...req.types } } : {}) };
      return readPrefs();
    },
    async care(_agentId, req, opts) {
      await sleep(o.latency?.care ?? 260, opts?.signal);
      refuse();
      const t = now();
      const r = applyLocal(care, req.action, t, req.n);
      care = r.care;
      return { care, now: t, ...(r.guard ? { guard: r.guard } : {}) };
    },
    async talk(_agentId, req, opts) {
      await sleep(o.latency?.talk ?? 1400, opts?.signal);
      refuse();
      if (o.role === 'guest') throw new PetError(403, 'guest_talk', 'Guests talk in the DM');
      return talkReply(req.text);
    },
    async talkVoice(_agentId, _audio, opts) {
      await sleep(o.latency?.talk ?? 1400, opts?.signal);
      refuse();
      if (o.role === 'guest') throw new PetError(403, 'guest_talk', 'Guests talk in the DM');
      return { transcript: '(voice note)', ...talkReply('') };
    },
    async play(_agentId, req, opts) {
      await sleep(o.latency?.care ?? 260, opts?.signal);
      refuse();
      const t = now();
      const r = applyPlay(play, req, { now: t, tz, stage, formed: true, bond: care.bond, accessMoments: ['calendar'] });
      play = r.play;
      litMine();
      return { play: playView(play, t, tz), now: t, ...(r.guard ? { guard: r.guard } : {}), ...(req.op === 'roomVisited' || req.op === 'askAccepted' ? { growth } : {}) };
    },
    async look(_agentId, req, opts) {
      await sleep(o.latency?.care ?? 260, opts?.signal);
      refuse();
      if (o.role === 'guest') throw new PetError(403, 'look_forbidden', 'look_forbidden');
      look = { ...look, ...req.look, features: { ...look.features, ...req.look.features } };
      return { look };
    },
    async growthConfirm(_agentId, momentId, opts) {
      await sleep(o.latency?.care ?? 260, opts?.signal);
      refuse();
      const was = growth.moments.find((m) => m.id === momentId);
      if (!was) throw new PetError(404, 'invalid_request', 'moment_not_found');
      growth = { ...growth, moments: growth.moments.map((m) => (m.id === momentId && !m.lit ? { ...m, lit: { at: new Date(now()).toISOString() } } : m)) };
      return { lit: was.lit ? null : 'agent', growth };
    },
    async send<T>(_agentId: string, method: 'GET' | 'POST' | 'DELETE', action: string, body?: unknown, opts?: { signal?: AbortSignal }): Promise<T> {
      await sleep(o.latency?.care ?? 260, opts?.signal);
      refuse();
      const path = action.split('?')[0];
      let out: unknown;
      if (path === 'circle') out = circle();
      else if (path === 'circle/decision') { myState = (body as CircleDecisionRequest).choice; out = circle(); }
      else if (path === 'circle/leave') { out = { left: myState === 'joined' }; myState = 'withdrawn'; }
      else if (path === 'notes') out = { mine: notes.filter((n) => !n.groupTitle), group: notes.filter((n) => n.groupTitle) };
      else if (method === 'DELETE') { const id = decodeURIComponent(path.split('/')[1] ?? ''); out = { erased: notes.some((n) => n.copyId === id) }; notes = notes.filter((n) => n.copyId !== id); }
      else throw new PetError(404, 'circle_unavailable', 'No circle');
      return out as T;
    },
  };
}
