/**
 * Growth moments (design PET_CARE_GAME_DESIGN_2026_10_26 §4.11): the named things an agent learns or does with the
 * people it works with. Isomorphic and pure, like play.ts: the definitions live on the Agent (`agent.growth`, drafted
 * at spawn by persona.ts, or the default set here), the agent-wide lit records in `studio_pet_growth/{agentId}`
 * (pet-growth-store.ts), the personal ones in `PetPlay.litMine`. Nothing here reads or writes `PetCare`.
 *
 * Kinds: `taught` (an explicit "remember this" save the person then confirms), `task` (not wired yet), `access`
 * (a permission granted in context), `room` (a first room visit) and `season` (a first festival). `room` and `season`
 * are shared templates, never generated: their ids are fixed (`room-<room>`, `season-<festival>`) so the play ops
 * that light them need no lookup.
 *
 * A lit record holds the moment id, its kind and dates only, plus, for `taught`, an opaque keyed hash of the source
 * note copy (never the note, never who taught it), so erasing that note dims the moment (§4.11 "Erasure").
 */

import { PLAY_ROOMS, roomMoment, SEASON_IDS, type PlayRoom, type SeasonId } from './play';

export type GrowthKind = 'taught' | 'task' | 'access' | 'room' | 'season';
export const GROWTH_KINDS: readonly GrowthKind[] = ['taught', 'task', 'access', 'room', 'season'];
/** The kinds the persona drafter writes; room and season are templates. */
export const DRAFTED_KINDS: readonly GrowthKind[] = ['taught', 'task', 'access'];
export type GrowthLang = 'en' | 'fa';

export interface GrowthMoment {
  /** stable slug, unique per agent (MOMENT_ID in play.ts); never shown */
  id: string;
  /** pet voice, says "we", no digits, ≤ GROWTH_LIMITS.titleChars */
  title: string;
  /** an invitation, never pressure, ≤ GROWTH_LIMITS.hintChars */
  hint: string;
  kind: GrowthKind;
}

/** `agent.growth`: the drafted (or default) taught/task/access moments. Templates are added when the view is built. */
export interface AgentGrowth {
  v: 1;
  lang: GrowthLang;
  /** drafted: from the persona call; default: the role family's set (a missing or bad block) */
  source: 'drafted' | 'default';
  moments: GrowthMoment[];
}

export const GROWTH_LIMITS = {
  titleChars: 40,
  hintChars: 80,
  /** the whole list the page shows, templates included */
  minMoments: 15,
  maxMoments: 25,
  /** agent.growth as JSON, so the one state document stays small (open decision 15) */
  maxBytes: 6 * 1024,
  /** agent-wide lit records (more than every moment ever defined, for a hand-edited record) */
  lit: 64,
} as const;

export const SEASON_MOMENT = (season: SeasonId) => `season-${season}`;
/** The rooms whose first visit is a moment (no Home: it is where the pet starts). */
export const GROWTH_ROOMS: readonly PlayRoom[] = PLAY_ROOMS;
/** How many drafted moments fit beside the templates. */
export const TEMPLATE_COUNT = GROWTH_ROOMS.length + SEASON_IDS.length;
export const MIN_DRAFTED = GROWTH_LIMITS.minMoments - TEMPLATE_COUNT;
export const MAX_DRAFTED = GROWTH_LIMITS.maxMoments - TEMPLATE_COUNT;

const ROOM_NAME: Readonly<Record<GrowthLang, Record<PlayRoom, string>>> = {
  en: { play: 'Play room', garden: 'Garden', closet: 'Closet', bedroom: 'Bedroom', book: 'Life Book' },
  fa: { play: 'اتاق بازی', garden: 'باغچه', closet: 'کمد', bedroom: 'اتاق خواب', book: 'دفتر خاطرات' },
};
const FESTIVAL_NAME: Readonly<Record<GrowthLang, Record<SeasonId, string>>> = {
  en: { yalda: 'Yalda', suri: 'Chaharshanbe Suri', nowruz: 'Nowruz' },
  fa: { yalda: 'یلدا', suri: 'چهارشنبه‌سوری', nowruz: 'نوروز' },
};
/** PET_COPY_KEYS `growth.room.title` / `growth.season.title`; the hints are new lines for the copywriter to review. */
const ISOLATE = (s: string) => `⁨${s}⁩`;
const TEMPLATE_COPY: Readonly<Record<GrowthLang, { room: (r: string) => [string, string]; season: (f: string) => [string, string] }>> = {
  en: {
    room: (r) => [`We found the ${r} together`, `Peek into the ${r} with me sometime`],
    season: (f) => [`We celebrated ${f} together`, `When ${f} comes, we can celebrate it together`],
  },
  fa: {
    room: (r) => [`${ISOLATE(r)} رو با هم کشف کردیم`, `هر وقت دلت خواست، با هم یه سر به ${ISOLATE(r)} بزنیم`],
    season: (f) => [`${ISOLATE(f)} رو با هم جشن گرفتیم`, `${ISOLATE(f)} که برسه، با هم جشنش می‌گیریم`],
  },
};

/** The shared room and season moments, in the agent's language. */
export function templateMoments(lang: GrowthLang): GrowthMoment[] {
  const copy = TEMPLATE_COPY[lang];
  return [
    ...GROWTH_ROOMS.map((room): GrowthMoment => { const [title, hint] = copy.room(ROOM_NAME[lang][room]); return { id: roomMoment(room), title, hint, kind: 'room' }; }),
    ...SEASON_IDS.map((season): GrowthMoment => { const [title, hint] = copy.season(FESTIVAL_NAME[lang][season]); return { id: SEASON_MOMENT(season), title, hint, kind: 'season' }; }),
  ];
}

/* ---------- default sets per role family ---------- */

export type RoleFamily = 'support' | 'analysis' | 'creative' | 'engineering' | 'lead' | 'people' | 'general';
const FAMILY_RULES: ReadonlyArray<[RegExp, RoleFamily]> = [
  [/support|customer|success|\bcs\b|help ?desk|پشتیبانی|مشتری/i, 'support'],
  [/research|analy|finance|account|data|legal|تحلیل|پژوهش|مالی|داده|حقوقی/i, 'analysis'],
  [/design|creative|market|brand|content|writer|طراح|بازاریابی|محتوا|برند|نویسنده/i, 'creative'],
  [/engineer|developer|dev\b|ops|infra|tech|\bit\b|مهندس|برنامه‌نویس|توسعه/i, 'engineering'],
  [/sales|exec|chief|ceo|director|manager|lead|producer|partner|فروش|مدیر|تهیه‌کننده/i, 'lead'],
  [/coach|well|people|\bhr\b|care|mentor|منابع انسانی|مربی/i, 'people'],
];
export const roleFamily = (role: string | undefined): RoleFamily => FAMILY_RULES.find(([re]) => re.test(role ?? ''))?.[1] ?? 'general';

type Pair = readonly [id: string, kind: GrowthKind, title: string, hint: string];
/** Every agent: how the team works together. Kept short so they pass the lint in both languages. */
const CORE: Readonly<Record<GrowthLang, readonly Pair[]>> = {
  en: [
    ['taught-team-ways', 'taught', 'We learned how our team works', 'Tell me how your team works, then say “remember this”'],
    ['taught-words', 'taught', 'We learned the words our team uses', 'Teach me a word your team uses, then say “remember this”'],
    ['taught-good-week', 'taught', 'We learned what a good week means', 'Tell me what a good week looks like, then say “remember this”'],
    ['task-first-job', 'task', 'We finished our first job together', 'Give me a small job, and we can do it together'],
    ['access-calendar', 'access', 'We got the access we need to plan', 'When it fits, you can let me help with planning'],
    ['access-checkins', 'access', 'We agreed on how I check in', 'You can choose how I check in with you'],
  ],
  fa: [
    ['taught-team-ways', 'taught', 'یاد گرفتیم تیممون چطور کار می‌کنه', 'از روال کار تیمت برام بگو، آخرش بگو «یادت باشه»'],
    ['taught-words', 'taught', 'اصطلاح‌های خودمونی تیم رو یاد گرفتیم', 'یه اصطلاح خودمونی تیمت رو برام معنی کن، آخرش بگو «یادت باشه»'],
    ['taught-good-week', 'taught', 'یاد گرفتیم هفتهٔ خوب برامون یعنی چی', 'تعریف کن یه هفتهٔ خوب برای تیمت چه شکلیه، آخرش بگو «یادت باشه»'],
    ['task-first-job', 'task', 'اولین کارمون رو با هم تموم کردیم', 'یه کار کوچیک بهم بسپار، با هم انجامش می‌دیم'],
    ['access-calendar', 'access', 'دسترسی برنامه‌ریزی رو با هم راه انداختیم', 'هر وقت صلاح دونستی، اجازه بده توی برنامه‌ریزی کمکت کنم'],
    ['access-checkins', 'access', 'با هم قرار سر زدن‌ها رو گذاشتیم', 'خودت انتخاب کن کی و چطور بهت سر بزنم'],
  ],
};
const FAMILY: Readonly<Record<RoleFamily, Readonly<Record<GrowthLang, readonly Pair[]>>>> = {
  support: {
    en: [
      ['taught-tone', 'taught', 'We learned how we talk to customers', 'Show me how your team answers a customer, then say “remember this”'],
      ['taught-escalate', 'taught', 'We learned when we hand a case on', 'Tell me when a case goes to someone else, then say “remember this”'],
      ['task-first-reply', 'task', 'We drafted our first reply together', 'Ask me to draft a reply with you'],
    ],
    fa: [
      ['taught-tone', 'taught', 'یاد گرفتیم با مشتری‌ها چطور حرف بزنیم', 'نشونم بده تیمت چطور جواب مشتری رو می‌ده، آخرش بگو «یادت باشه»'],
      ['taught-escalate', 'taught', 'یاد گرفتیم کی پرونده رو ارجاع بدیم', 'بگو کی یه پرونده باید ارجاع بشه، آخرش بگو «یادت باشه»'],
      ['task-first-reply', 'task', 'اولین جوابمون رو با هم نوشتیم', 'ازم بخواه یه جواب رو با هم بنویسیم'],
    ],
  },
  analysis: {
    en: [
      ['taught-sources', 'taught', 'We learned which sources we trust', 'Tell me which sources your team trusts, then say “remember this”'],
      ['taught-report-shape', 'taught', 'We learned how our reports look', 'Show me how your team shapes a report, then say “remember this”'],
      ['task-first-summary', 'task', 'We wrote our first summary together', 'Ask me to sum something up with you'],
    ],
    fa: [
      ['taught-sources', 'taught', 'یاد گرفتیم به چه منابعی اعتماد کنیم', 'بگو تیمت به چه منابعی اعتماد داره، آخرش بگو «یادت باشه»'],
      ['taught-report-shape', 'taught', 'یاد گرفتیم گزارش‌هامون چه شکلیه', 'نشونم بده گزارش‌های تیمت چه شکلیه، آخرش بگو «یادت باشه»'],
      ['task-first-summary', 'task', 'اولین خلاصه‌مون رو با هم نوشتیم', 'ازم بخواه یه چیزی رو با هم خلاصه کنیم'],
    ],
  },
  creative: {
    en: [
      ['taught-brand-voice', 'taught', 'We learned how our brand sounds', 'Tell me how your brand sounds, then say “remember this”'],
      ['taught-review', 'taught', 'We learned how we review ideas', 'Tell me how your team reviews ideas, then say “remember this”'],
      ['task-first-draft', 'task', 'We made our first draft together', 'Ask me to sketch a first draft with you'],
    ],
    fa: [
      ['taught-brand-voice', 'taught', 'یاد گرفتیم برندمون با چه لحنی حرف می‌زنه', 'بگو برندتون با چه لحنی حرف می‌زنه، آخرش بگو «یادت باشه»'],
      ['taught-review', 'taught', 'یاد گرفتیم ایده‌ها رو چطور بررسی کنیم', 'بگو تیمت ایده‌ها رو چطور بررسی می‌کنه، آخرش بگو «یادت باشه»'],
      ['task-first-draft', 'task', 'اولین پیش‌نویسمون رو با هم ساختیم', 'ازم بخواه یه پیش‌نویس رو با هم شروع کنیم'],
    ],
  },
  engineering: {
    en: [
      ['taught-release', 'taught', 'We learned how we plan a release', 'Tell me how your team plans a release, then say “remember this”'],
      ['taught-review-code', 'taught', 'We learned how we review changes', 'Tell me how your team reviews changes, then say “remember this”'],
      ['task-first-fix', 'task', 'We worked through our first fix', 'Bring me a small problem and we can work it through'],
    ],
    fa: [
      ['taught-release', 'taught', 'یاد گرفتیم نسخه‌ها رو چطور منتشر می‌کنیم', 'بگو تیمت نسخهٔ تازه رو چطور منتشر می‌کنه، آخرش بگو «یادت باشه»'],
      ['taught-review-code', 'taught', 'یاد گرفتیم تغییرها رو چطور بازبینی کنیم', 'بگو تیمت تغییرها رو چطور بازبینی می‌کنه، آخرش بگو «یادت باشه»'],
      ['task-first-fix', 'task', 'اولین مشکلمون رو با هم حل کردیم', 'یه مشکل کوچیک بیار، با هم حلش می‌کنیم'],
    ],
  },
  lead: {
    en: [
      ['taught-decisions', 'taught', 'We learned how we make decisions', 'Tell me how your team decides, then say “remember this”'],
      ['taught-priorities', 'taught', 'We learned what comes first for us', 'Tell me what comes first for your team, then say “remember this”'],
      ['task-first-plan', 'task', 'We put together our first plan', 'Ask me to shape a plan with you'],
    ],
    fa: [
      ['taught-decisions', 'taught', 'یاد گرفتیم اینجا چطور تصمیم می‌گیریم', 'بگو تیمت چطور تصمیم می‌گیره، آخرش بگو «یادت باشه»'],
      ['taught-priorities', 'taught', 'یاد گرفتیم اولویت‌هامون چیه', 'بگو برای تیمت چی از همه مهم‌تره، آخرش بگو «یادت باشه»'],
      ['task-first-plan', 'task', 'اولین برنامه‌مون رو با هم چیدیم', 'ازم بخواه یه برنامه رو با هم بچینیم'],
    ],
  },
  people: {
    en: [
      ['taught-onboarding', 'taught', 'We learned how we welcome people', 'Tell me how your team welcomes someone new, then say “remember this”'],
      ['taught-rituals', 'taught', 'We learned the rituals we keep', 'Tell me about a ritual your team keeps, then say “remember this”'],
      ['task-first-guide', 'task', 'We wrote our first guide together', 'Ask me to write a short guide with you'],
    ],
    fa: [
      ['taught-onboarding', 'taught', 'رسم خوشامدگویی تیممون رو یاد گرفتیم', 'بگو تیمت چطور از یه تازه‌وارد استقبال می‌کنه، آخرش بگو «یادت باشه»'],
      ['taught-rituals', 'taught', 'رسم‌های تیممون رو یاد گرفتیم', 'یکی از رسم‌های تیمت رو برام تعریف کن، آخرش بگو «یادت باشه»'],
      ['task-first-guide', 'task', 'اولین راهنمامون رو با هم نوشتیم', 'ازم بخواه یه راهنمای کوتاه رو با هم بنویسیم'],
    ],
  },
  general: {
    en: [
      ['taught-handoff', 'taught', 'We learned how we hand work over', 'Tell me how work changes hands here, then say “remember this”'],
      ['taught-tools', 'taught', 'We learned the tools we rely on', 'Tell me which tools your team relies on, then say “remember this”'],
      ['task-first-list', 'task', 'We sorted our first list together', 'Ask me to sort a list with you'],
    ],
    fa: [
      ['taught-handoff', 'taught', 'یاد گرفتیم کارها رو چطور دست به دست کنیم', 'بگو اینجا کارها چطور دست به دست می‌شه، آخرش بگو «یادت باشه»'],
      ['taught-tools', 'taught', 'ابزارهای تیممون رو یاد گرفتیم', 'بگو تیمت به چه ابزارهایی تکیه می‌کنه، آخرش بگو «یادت باشه»'],
      ['task-first-list', 'task', 'اولین فهرستمون رو با هم مرتب کردیم', 'ازم بخواه یه فهرست رو با هم مرتب کنیم'],
    ],
  },
};

/** The default drafted-kind moments for a role, in the agent's language (no model call). */
export function defaultMoments(role: string | undefined, lang: GrowthLang): GrowthMoment[] {
  return [...CORE[lang], ...FAMILY[roleFamily(role)][lang]].map(([id, kind, title, hint]) => ({ id, kind, title, hint }));
}

export function defaultGrowth(role: string | undefined, lang: GrowthLang): AgentGrowth {
  return { v: 1, lang, source: 'default', moments: defaultMoments(role, lang) };
}

/** The agent's language for growth copy: Persian when its first language is Persian. */
export function growthLang(languages: readonly string[] | undefined): GrowthLang {
  return /persian|farsi|فارسی|^fa\b/i.test(languages?.[0] ?? '') ? 'fa' : 'en';
}

/** Every moment the page shows: the agent's (or the default) drafted moments, then the templates. */
export function allMoments(growth: AgentGrowth | undefined, fallback: { role?: string; languages?: readonly string[] }): GrowthMoment[] {
  const g = growth?.v === 1 && Array.isArray(growth.moments) ? growth : defaultGrowth(fallback.role, growthLang(fallback.languages));
  const templates = templateMoments(g.lang === 'fa' ? 'fa' : 'en');
  const fixed = new Set(templates.map((t) => t.id));
  return [...g.moments.filter((m) => DRAFTED_KINDS.includes(m.kind) && !fixed.has(m.id)), ...templates];
}

/* ---------- lit records ---------- */

/** One agent-wide lit moment: ids, kind and dates; `ref` is an opaque keyed hash of a taught moment's source note. */
export interface GrowthLit {
  id: string;
  kind: GrowthKind;
  at: number;
  ref?: string;
  /** the source note was erased: the moment is dark again (its page goes) until someone teaches it again */
  dimmedAt?: number;
}

const MOMENT_SLUG = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const REF = /^[0-9a-f]{16,64}$/;

/** Stored lit records as GrowthLit[]: unknown kinds, bad ids, duplicates and anything else are dropped. */
export function sanitizeLit(raw: unknown): GrowthLit[] {
  const out: GrowthLit[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== 'string' || !MOMENT_SLUG.test(o.id) || seen.has(o.id) || !GROWTH_KINDS.includes(o.kind as GrowthKind)) continue;
    if (typeof o.at !== 'number' || !Number.isFinite(o.at) || out.length >= GROWTH_LIMITS.lit) continue;
    seen.add(o.id);
    out.push({ id: o.id, kind: o.kind as GrowthKind, at: o.at,
      ...(typeof o.ref === 'string' && REF.test(o.ref) ? { ref: o.ref } : {}),
      ...(typeof o.dimmedAt === 'number' && Number.isFinite(o.dimmedAt) ? { dimmedAt: o.dimmedAt } : {}) });
  }
  return out;
}

/** Lights one moment (idempotent: an already lit one stays as it was; a dimmed one lights again). */
export function lightMoment(lit: readonly GrowthLit[], entry: { id: string; kind: GrowthKind; at: number; ref?: string }): { lit: GrowthLit[]; changed: boolean } {
  const current = lit.find((l) => l.id === entry.id);
  if (current && current.dimmedAt === undefined) return { lit: [...lit], changed: false };
  const next: GrowthLit = { id: entry.id, kind: entry.kind, at: entry.at, ...(entry.ref ? { ref: entry.ref } : {}) };
  if (!current && lit.length >= GROWTH_LIMITS.lit) return { lit: [...lit], changed: false };
  return { lit: current ? lit.map((l) => l.id === entry.id ? next : l) : [...lit, next], changed: true };
}

/** Dims every lit taught moment whose source note is one of `refs`. */
export function dimMoments(lit: readonly GrowthLit[], refs: ReadonlySet<string>, at: number): { lit: GrowthLit[]; dimmed: number } {
  let dimmed = 0;
  const next = lit.map((l) => {
    if (!l.ref || !refs.has(l.ref) || l.dimmedAt !== undefined) return l;
    dimmed++;
    return { ...l, dimmedAt: at };
  });
  return { lit: next, dimmed };
}

/* ---------- the view ---------- */

/** PetView.growth: every moment with its agent-wide lit date, and the ids lit only for this person. */
export interface PetGrowthView {
  /** `lit.at`: ISO 8601 time it lit for the whole agent (absent while dark, or dimmed after its source note was erased) */
  moments: Array<{ id: string; title: string; hint: string; kind: GrowthKind; lit?: { at: string } }>;
  /** moment ids lit only in this person's view (first room visits, personal grants, private teaching) */
  mine?: string[];
}

export function growthView(moments: readonly GrowthMoment[], lit: readonly GrowthLit[], litMine: ReadonlyArray<{ id: string }> = []): PetGrowthView {
  const on = new Map(lit.filter((l) => l.dimmedAt === undefined).map((l) => [l.id, l.at]));
  const ids = new Set(moments.map((m) => m.id));
  const mine = [...new Set(litMine.map((l) => l.id))].filter((id) => ids.has(id));
  return {
    moments: moments.map((m) => ({ id: m.id, title: m.title, hint: m.hint, kind: m.kind, ...(on.has(m.id) ? { lit: { at: new Date(on.get(m.id)!).toISOString() } } : {}) })),
    ...(mine.length ? { mine } : {}),
  };
}
