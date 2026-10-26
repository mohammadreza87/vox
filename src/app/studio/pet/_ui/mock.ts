/**
 * The ?mock=1 fake: an in-memory PetApi that applies care.ts locally and answers talk with canned
 * lines, so demos, the lab and a plain browser get the whole page with no server and no Telegram.
 * Same shapes and the same guards as the real API; small latencies so "thinking" is visible.
 */

import { PRESET_LOOKS } from '@/lib/studio/character';
import { PetError } from './errors';
import { applyLocal, openLocal, talkLocal } from './care-local';
import { applyPlay, newPlay, playView, type PetPlay } from '@/lib/pet/play';
import { templateMoments } from '@/lib/pet/growth';
import { petLang, type PetLang } from './strings';
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
  /** the demo's language (default: the page's, `petLang()`): the name, replies, moments and souvenir follow it */
  lang?: PetLang;
}

const DAY = 24 * 60 * 60 * 1000;
/** The demo pet's name per language (P-12): a real agent's name comes from the server and stays bidi-isolated. */
export const MOCK_NAME: Record<PetLang, string> = { en: 'Mochi', fa: 'موچی' };

/**
 * Canned talk (P-13, P-30): the common openers get an answer that fits them, anything else a light reaction. Persian is
 * the pet voice (spoken Tehrani, «تو», no digits, no emoji, one «!» at most). Mock only: production replies are the model's.
 */
type Canned = { fits: RegExp; en: string; fa: string };
const OPENERS: Canned[] = [
  { fits: /how (was|is) your day|how are you|how('s| is) it going|روزت|چطوری|خوبی|حالت/i,
    en: 'Pretty good! I practised my hop and watched the clouds. How was yours?', fa: 'خوب بود! پرش تمرین کردم و ابرها رو تماشا کردم. روز تو چطور بود؟' },
  { fits: /what are you (doing|up to)|what's up|چی ?کار می‌?کنی|چه ?کار می‌?کنی/i,
    en: 'Just floating about and humming a little tune.', fa: 'دارم این‌ور اون‌ور می‌چرخم و یه آهنگ کوچولو زیر لب می‌خونم.' },
  { fits: /\b(thanks|thank you)\b|مرسی|ممنون|متشکر/i, en: 'Anytime! That made me happy.', fa: 'قابلی نداشت! حسابی خوشحالم کردی.' },
  { fits: /^\s*(hi|hello|hey|salam)\b|^\s*(سلام|درود)/i, en: 'Hi! I’m so glad you’re here.', fa: 'سلام! چه خوب که اومدی.' },
  { fits: /[?؟]\s*$/, en: 'Good question! Let’s think about it together.', fa: 'سؤال خوبیه! بیا با هم بهش فکر کنیم.' },
];
const REPLIES: Record<PetLang, string[]> = {
  en: ['Ooh, I like that!', 'Tell me more?', 'Ha! That made me smile.', 'Hmm, I think you’re right.'],
  fa: ['وای، چه فکر خوبی!', 'بیشتر برام تعریف کن؟', 'خنده‌م گرفت!', 'آره، فکر کنم حق با توئه.'],
};
const BYE = /\b(bye|goodbye|good night|goodnight|see you|later)\b|خداحافظ|شب[ \u200c]?بخیر/i;
const SAID: Record<PetLang, { bye: string; saved: string; souvenir: string }> = {
  en: { bye: 'Bye for now! Come say hi whenever you like.', saved: 'Okay, I saved that note.', souvenir: 'Hi again! I practised my best hop.' },
  // the souvenir is `say.welcomeBack.3` in the copywriter's words: the pet's own world, never a memory (P-21)
  fa: { bye: 'فعلاً خداحافظ! هر وقت دلت خواست سر بزن.', saved: 'باشه، یادداشتش کردم.', souvenir: 'سلام! یه پرش حسابی تمرین کردم، ببین!' },
};
/** the demo's own growth moments: titles and the first hint are the copywriter's `growth.example.*` in Persian */
const DEMO_MOMENTS: Record<PetLang, [string, string][]> = {
  en: [['I learned how you plan a release', 'Tell me how your team plans a release, then say “remember this”'],
    ['I wrote our first weekly report together', 'Ask me for a weekly report'], ['I got the access I need to read the team calendar', 'Let me read the team calendar']],
  fa: [['یاد گرفتیم نسخه‌ها رو چطور منتشر می‌کنیم', 'بهم بگو تیمت برنامهٔ انتشار نسخه رو چطور می‌چینه، بعد بگو «یادت باشه».'],
    ['اولین گزارش هفتگی‌مون رو با هم نوشتیم', 'ازم بخواه یه گزارش هفتگی با هم بنویسیم'], ['دسترسی تقویم تیم رو گرفتم؛ حالا برنامه‌ها دستمه', 'هر وقت خواستی، بذار تقویم تیم رو ببینم']],
};

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new PetError(0, 'network', 'Aborted')); }, { once: true });
});

/** pet_action demo (§8.4): a few plain requests the triage pre-pass would classify. */
const ACTIONS: [RegExp, PetActionKind][] = [[/\b(bed|sleep|nap)\b|بخواب|چرت/i, 'sleep'], [/\b(cookie|snack|eat)\b|کلوچه|بخور/i, 'feed'], [/\bball\b|توپ/i, 'play_ball'],
  [/\bgarden\b|باغچه/i, 'open_garden'], [/\bcloset\b|کمد/i, 'open_closet'], [/\b(guess|word game)\b|حدس/i, 'start_guess']];
function actionOf(text: string): { action?: TalkAction } {
  const hit = ACTIONS.find(([re]) => re.test(text));
  return hit ? { action: { kind: hit[1], confidence: 0.9 } } : {};
}

const clampStage = (n: number | undefined): Stage => (n === 1 || n === 2 || n === 3 || n === 4 ? n : 3);

export function createMockApi(o: MockOptions = {}): PetApi {
  const now = o.now ?? (() => Date.now());
  const lang: PetLang = o.lang ?? petLang();
  const NAME = MOCK_NAME[lang];
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
  const [release, report, calendar] = DEMO_MOMENTS[lang];
  let growth: PetGrowthView = { mine: [], moments: [
    { id: 'release', kind: 'taught', title: release[0], hint: release[1] },
    { id: 'report', kind: 'task', title: report[0], hint: report[1] },
    { id: 'calendar', kind: 'access', title: calendar[0], hint: calendar[1], lit: { at: new Date(t0 - DAY).toISOString() } },
    // the shared room moments exactly as production words them ("We found the Play room together", P-09, P-14); the
    // season ones stay out of the demo (a lit-able season moment would bring its own sheet into every demo)
    ...templateMoments(lang).filter((m) => m.kind === 'room').map((m) => ({ id: m.id, kind: m.kind, title: m.title, hint: m.hint })),
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
      // the welcome souvenir is about the pet's own world, never a memory or a note (P-21)
      ...(opened.welcome ? { welcome: { souvenir: SAID[lang].souvenir, awayMs: opened.welcome.awayMs } } : {}),
      ...(opened.stageUp ? { stageUp: opened.stageUp } : {}),
      ...(opened.bondMilestone === undefined ? {} : { bondMilestone: opened.bondMilestone }),
      ...(checkin ? { checkin } : {}),
      ...(prefs.enabled || prefs.pausedAt ? { checkins: readPrefs() } : {}),
    };
  };

  const talkReply = (text: string): TalkResponse => {
    const goodbye = BYE.test(text);
    care = talkLocal(care, now());
    const opener = OPENERS.find((c) => c.fits.test(text));
    return goodbye
      ? { reply: SAID[lang].bye, goodbye: true, care, turnId: `mock-${++turn}` }
      : /remember|یادت باشه|یادت بمونه/i.test(text) ? { reply: SAID[lang].saved, care, turnId: `mock-${++turn}`, savedNote: true } as TalkResponse
      : { reply: opener ? opener[lang] : REPLIES[lang][turn % REPLIES[lang].length], care, turnId: `mock-${++turn}`, ...actionOf(text) };
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
