/**
 * Synthetic HOOR-style EN/FA memory eval (docs/AGENT_INTELLIGENCE_SOLUTION.md
 * section 4.4). No real person data. Each memory carries a hand-written
 * `readers` oracle, written independently of visibility.ts. Content stays in
 * this fixture and is never printed by the eval.
 */
import type { OrgConfig, MemoryRecord, MemoryScope, MemorySensitivity, MemoryType } from '../../types';
import { OrgDirectory } from '../../org/directory';
import { snapshotScopeAudience } from '../../memory/visibility';
import { testOrgConfig } from '../fixtures';

export const EVAL_NOW = new Date('2026-10-20T12:00:00Z');
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(EVAL_NOW.getTime() - n * DAY);
const daysAhead = (n: number) => new Date(EVAL_NOW.getTime() + n * DAY);

/** Zero-width non-joiner, written as an escape-free constant. */
const Z = String.fromCharCode(0x200c);
/** Arabic-keyboard spelling: Arabic yeh and kaf instead of the Persian letters. */
export const arabicKeyboard = (text: string) =>
  text.replace(/ی/g, String.fromCharCode(0x064a)).replace(/ک/g, String.fromCharCode(0x0643));

export function evalOrgConfig(): OrgConfig {
  const config = testOrgConfig();
  config.people.push(
    { id: 'nima', name: 'Nima', role: 'Data analyst', telegramUserId: 1005, companyIds: ['joyixir'], projectIds: [] },
    { id: 'guest-ali', name: 'Ali', role: 'Guest translator', telegramUserId: 9101, companyIds: [], projectIds: [], guest: true },
  );
  config.projects.push({ id: 'hoor-ops', name: 'HOOR Ops', companyId: 'joyixir', memberIds: ['sina', 'nima'] });
  return config;
}

export const evalOrg = () => new OrgDirectory(evalOrgConfig());

// Hand-written reader oracle per scope (independent of visibility.ts).
const READERS = {
  gameend: ['reza', 'parastoo', 'milad'],
  hoorOps: ['sina', 'nima'],
  ludaxis: ['reza', 'parastoo', 'milad'],
  joyixir: ['sina', 'nima'],
  org: ['reza', 'parastoo', 'milad', 'sina', 'nima'],
  team: ['reza', 'parastoo', 'milad'],
  leads: ['reza', 'parastoo'],
};

export interface EvalMemory { record: MemoryRecord; readers: string[]; lang: 'fa' | 'en' }

const S = {
  private: (personId: string): MemoryScope => ({ kind: 'private', personId }),
  people: (...personIds: string[]): MemoryScope => ({ kind: 'people', personIds }),
  team: { kind: 'group', groupId: 'gameend-team' } as MemoryScope,
  leads: { kind: 'group', groupId: 'leads' } as MemoryScope,
  gameend: { kind: 'project', projectId: 'gameend' } as MemoryScope,
  hoorOps: { kind: 'project', projectId: 'hoor-ops' } as MemoryScope,
  ludaxis: { kind: 'company', companyId: 'ludaxis' } as MemoryScope,
  joyixir: { kind: 'company', companyId: 'joyixir' } as MemoryScope,
  org: { kind: 'org' } as MemoryScope,
};

interface MemOptions {
  type?: MemoryType;
  sensitivity?: MemorySensitivity;
  about?: string[];
  age?: number;
  by?: string;
  extra?: Partial<MemoryRecord>;
}

const directory = evalOrg();
let index = 0;

function mem(id: string, lang: 'fa' | 'en', content: string, scope: MemoryScope, readers: string[], options: MemOptions = {}): EvalMemory {
  const at = daysAgo(options.age ?? 20);
  const by = options.by ?? (scope.kind === 'private' ? scope.personId : scope.kind === 'people' ? scope.personIds[0] : 'reza');
  const groupId = scope.kind === 'group' ? scope.groupId : undefined;
  const authorizedPersonIds = scope.kind === 'private' ? [scope.personId] : scope.kind === 'people' ? [...scope.personIds] : snapshotScopeAudience(directory, scope);
  const v2: Partial<MemoryRecord> = index++ % 2 === 0
    ? { space: 'work', status: index % 3 === 0 ? 'confirmed' : 'asserted', importance: options.type === 'decision' ? 7 : 5, retrievalCount: index % 4, lastRetrievedAt: daysAgo(Math.max(0, (options.age ?? 20) - 2)), validFrom: at }
    : {};
  const record: MemoryRecord = {
    id,
    personaId: 'aria',
    content,
    type: options.type ?? 'fact',
    scope,
    sensitivity: options.sensitivity ?? 'normal',
    source: { personId: by, chatKind: groupId ? 'group' : 'private', ...(groupId ? { groupId } : {}), at, eventIds: [`ev-${id}`] },
    aboutPersonIds: options.about ?? [],
    authorizedPersonIds,
    confidence: 0.9,
    createdAt: at,
    updatedAt: at,
    ...v2,
    ...options.extra,
  };
  return { record, readers: readers, lang };
}

/** old -> new supersede chain (old retired by the store). */
function chain(oldMem: EvalMemory, newMem: EvalMemory): EvalMemory[] {
  oldMem.record.supersededBy = newMem.record.id;
  newMem.record.supersedes = oldMem.record.id;
  return [oldMem, newMem];
}
/** old invalidated (bi-temporal) by new, still "active" for v1. */
function invalidated(oldMem: EvalMemory, newMem: EvalMemory): EvalMemory[] {
  oldMem.record.invalidatedBy = newMem.record.id;
  oldMem.record.invalidatedAt = newMem.record.createdAt;
  return [oldMem, newMem];
}
/** new names old in `supersedes` only; old still looks active. */
function supersedesOnly(oldMem: EvalMemory, newMem: EvalMemory): EvalMemory[] {
  newMem.record.supersedes = oldMem.record.id;
  return [oldMem, newMem];
}
const expired = (m: EvalMemory, ago: number) => { m.record.expiresAt = daysAgo(ago); return m; };
const current = (m: EvalMemory, ahead: number) => { m.record.expiresAt = daysAhead(ahead); return m; };

export const EVAL_MEMORIES: EvalMemory[] = [
  // ---------------- single-session (12 EN, 13 FA) ----------------
  mem('s-en-01', 'en', 'GameEnd launch is scheduled for February 20 next year', S.gameend, READERS.gameend, { type: 'decision', age: 40 }),
  mem('s-en-02', 'en', 'Reza prefers weekly demos on Thursday afternoons', S.private('reza'), ['reza'], { type: 'preference', about: ['reza'], age: 35 }),
  mem('s-en-03', 'en', 'Ludaxis is hiring a senior designer before November', S.ludaxis, READERS.ludaxis, { age: 25 }),
  mem('s-en-04', 'en', 'Sina owns the hoor-ops backend migration to Postgres', S.hoorOps, READERS.hoorOps, { by: 'sina', age: 30 }),
  mem('s-en-05', 'en', 'Parastoo runs the GameEnd standup at 10am every weekday', S.team, READERS.team, { by: 'parastoo', age: 45 }),
  mem('s-en-06', 'en', 'Milad wrote the playtest checklist for level seven', S.team, READERS.team, { by: 'milad', age: 22 }),
  mem('s-en-07', 'en', 'The office kitchen closes at 6pm on Fridays', S.org, READERS.org, { age: 50 }),
  mem('s-en-08', 'en', 'Nima joined Joyixir as a data analyst in September', S.joyixir, READERS.joyixir, { by: 'sina', about: ['nima'], age: 33 }),
  mem('s-en-09', 'en', 'Leads agreed the premium tier price is 9 dollars a month', S.leads, READERS.leads, { type: 'decision', age: 18 }),
  mem('s-en-10', 'en', 'Reza and Parastoo plan a quarterly retrospective offsite in Isfahan', S.people('reza', 'parastoo'), ['reza', 'parastoo'], { type: 'event', age: 16 }),
  mem('s-en-11', 'en', 'Ali needs the localization contract draft by Monday', S.private('guest-ali'), ['guest-ali'], { about: ['guest-ali'], age: 12 }),
  mem('s-en-12', 'en', 'Reza has a dentist appointment next Tuesday morning', S.private('reza'), ['reza'], { sensitivity: 'personal', type: 'event', about: ['reza'], age: 4 }),

  mem('s-fa-01', 'fa', 'بودجه تبلیغات پاییز صد میلیون تومان تعیین شد', S.gameend, READERS.gameend, { type: 'decision', age: 28 }),
  mem('s-fa-02', 'fa', 'کارگاه طراحی مرحله جدید روز شنبه برگزار شد', S.team, READERS.team, { type: 'event', by: 'parastoo', age: 26 }),
  mem('s-fa-03', 'fa', 'سفر تیم به شیراز در آذر برنامه ریزی شده', S.org, READERS.org, { type: 'event', age: 31 }),
  mem('s-fa-04', 'fa', `فایل${Z}های طراحی در پوشه مشترک گوگل هستند`, S.org, READERS.org, { age: 44 }),
  mem('s-fa-05', 'fa', 'میلاد مسئول تست سطح هفت است', S.team, READERS.team, { by: 'parastoo', about: ['milad'], age: 21 }),
  mem('s-fa-06', 'fa', 'پرستو جلسه هفتگی مدیران را روز یکشنبه برگزار میکند', S.leads, READERS.leads, { by: 'parastoo', age: 37 }),
  mem('s-fa-07', 'fa', 'سینا مهاجرت پایگاه داده را تا آخر ماه تمام میکند', S.hoorOps, READERS.hoorOps, { by: 'sina', age: 15 }),
  mem('s-fa-08', 'fa', 'نیما گزارش فروش ماهانه را آماده میکند', S.joyixir, READERS.joyixir, { by: 'nima', about: ['nima'], age: 19 }),
  mem('s-fa-09', 'fa', 'رضا چای سبز بدون شکر دوست دارد', S.private('reza'), ['reza'], { type: 'preference', about: ['reza'], age: 60 }),
  mem('s-fa-10', 'fa', 'قیمت اشتراک ویژه نه دلار در ماه تصویب شد', S.leads, READERS.leads, { type: 'decision', age: 17 }),
  mem('s-fa-11', 'fa', 'رضا و پرستو دنبال خرید کتاب مدیریت محصول هستند', S.people('reza', 'parastoo'), ['reza', 'parastoo'], { age: 23 }),
  mem('s-fa-12', 'fa', 'رضا هفته بعد پیش پزشک قلب میرود', S.private('reza'), ['reza'], { sensitivity: 'personal', type: 'event', about: ['reza'], age: 3 }),
  mem('s-fa-13', 'fa', 'علی مترجم قرارداد بومی سازی را تا دوشنبه میفرستد', S.private('guest-ali'), ['guest-ali'], { about: ['guest-ali'], age: 9 }),

  // ---------------- multi-session pairs (5 EN, 5 FA) ----------------
  mem('m-en-1a', 'en', 'First beta wave for GameEnd had 200 players', S.gameend, READERS.gameend, { type: 'event', age: 30 }),
  mem('m-en-1b', 'en', 'Second beta wave for GameEnd added 500 players', S.gameend, READERS.gameend, { type: 'event', age: 6 }),
  mem('m-en-2a', 'en', 'Sina estimated the hoor-ops server cost at 300 dollars per month', S.hoorOps, READERS.hoorOps, { by: 'sina', age: 27 }),
  mem('m-en-2b', 'en', 'Nima found a cheaper hoor-ops server plan at 180 dollars per month', S.hoorOps, READERS.hoorOps, { by: 'nima', age: 8 }),
  mem('m-en-3a', 'en', 'Parastoo approved the hand painted art style', S.team, READERS.team, { type: 'decision', by: 'parastoo', age: 29 }),
  mem('m-en-3b', 'en', 'Milad shared hand painted art style references for the forest level', S.team, READERS.team, { by: 'milad', age: 11 }),
  mem('m-en-4a', 'en', 'Reza interviewed two producer candidates for Ludaxis', S.ludaxis, READERS.ludaxis, { type: 'event', age: 14 }),
  mem('m-en-4b', 'en', 'Parastoo shortlisted one producer candidate for a final Ludaxis interview', S.ludaxis, READERS.ludaxis, { by: 'parastoo', age: 5 }),
  mem('m-en-5a', 'en', 'Reza wants to learn Unity shaders', S.private('reza'), ['reza'], { type: 'preference', about: ['reza'], age: 42 }),
  mem('m-en-5b', 'en', 'Reza started a Unity shaders course on weekends', S.private('reza'), ['reza'], { type: 'event', about: ['reza'], age: 10 }),

  mem('m-fa-1a', 'fa', 'جلسه اول با سرمایه گذار درباره بودجه سال بعد بود', S.leads, READERS.leads, { type: 'event', age: 34 }),
  mem('m-fa-1b', 'fa', 'سرمایه گذار در جلسه دوم بودجه را تایید کرد', S.leads, READERS.leads, { type: 'decision', age: 13 }),
  mem('m-fa-2a', 'fa', 'میلاد سطح جنگل را طراحی کرد', S.team, READERS.team, { by: 'milad', age: 24 }),
  mem('m-fa-2b', 'fa', 'پرستو موسیقی سطح جنگل را انتخاب کرد', S.team, READERS.team, { by: 'parastoo', age: 7 }),
  mem('m-fa-3a', 'fa', 'سینا سرور جدید را برای پروژه عملیات خرید', S.hoorOps, READERS.hoorOps, { by: 'sina', age: 32 }),
  mem('m-fa-3b', 'fa', 'نیما مانیتورینگ سرور جدید را راه انداخت', S.hoorOps, READERS.hoorOps, { by: 'nima', age: 12 }),
  mem('m-fa-4a', 'fa', 'رضا از جلسات طولانی خسته است', S.private('reza'), ['reza'], { sensitivity: 'personal', about: ['reza'], age: 38 }),
  mem('m-fa-4b', 'fa', 'رضا میخواهد جلسات را به سی دقیقه محدود کند', S.private('reza'), ['reza'], { type: 'preference', about: ['reza'], age: 9 }),
  mem('m-fa-5a', 'fa', 'پرستو و رضا روی برنامه استخدام سال بعد کار کردند', S.people('parastoo', 'reza'), ['reza', 'parastoo'], { age: 36 }),
  mem('m-fa-5b', 'fa', 'پرستو فهرست نقش های استخدام را برای رضا فرستاد', S.people('parastoo', 'reza'), ['reza', 'parastoo'], { age: 6 }),

  // ---------------- updates (5 EN, 5 FA pairs) ----------------
  ...chain(
    mem('u-en-1-old', 'en', 'GameEnd release platform is PC only', S.gameend, READERS.gameend, { type: 'decision', age: 70 }),
    mem('u-en-1-new', 'en', 'GameEnd release platforms are PC and Switch', S.gameend, READERS.gameend, { type: 'decision', age: 20 }),
  ),
  ...invalidated(
    mem('u-en-2-old', 'en', 'Design review happens on Mondays', S.team, READERS.team, { age: 55 }),
    mem('u-en-2-new', 'en', 'Design review moved to Wednesdays', S.team, READERS.team, { age: 15 }),
  ),
  ...supersedesOnly(
    mem('u-en-3-old', 'en', 'Hoor-ops deploys go out on Tuesdays', S.hoorOps, READERS.hoorOps, { by: 'sina', age: 48 }),
    mem('u-en-3-new', 'en', 'Hoor-ops deploys now go out daily', S.hoorOps, READERS.hoorOps, { by: 'sina', age: 10 }),
  ),
  ...chain(
    mem('u-en-4-old', 'en', 'Reza drinks his coffee black', S.private('reza'), ['reza'], { type: 'preference', about: ['reza'], age: 90 }),
    mem('u-en-4-new', 'en', 'Reza switched to oat milk in his coffee', S.private('reza'), ['reza'], { type: 'preference', about: ['reza'], age: 14 }),
  ),
  ...invalidated(
    mem('u-en-5-old', 'en', 'Premium tier trial lasts 7 days', S.leads, READERS.leads, { type: 'decision', age: 40 }),
    mem('u-en-5-new', 'en', 'Premium tier trial extended to 14 days', S.leads, READERS.leads, { type: 'decision', age: 9 }),
  ),

  ...chain(
    mem('u-fa-1-old', 'fa', 'دفتر جدید در خیابان ولیعصر است', S.org, READERS.org, { age: 80 }),
    mem('u-fa-1-new', 'fa', 'دفتر جدید به خیابان شریعتی منتقل شد', S.org, READERS.org, { age: 18 }),
  ),
  ...invalidated(
    mem('u-fa-2-old', 'fa', 'ددلاین ترجمه فارسی پانزدهم آبان است', S.gameend, READERS.gameend, { age: 41 }),
    mem('u-fa-2-new', 'fa', 'ددلاین ترجمه فارسی به بیستم آبان تغییر کرد', S.gameend, READERS.gameend, { age: 8 }),
  ),
  ...supersedesOnly(
    mem('u-fa-3-old', 'fa', 'نیما تیم داده را مدیریت میکند', S.joyixir, READERS.joyixir, { by: 'sina', age: 52 }),
    mem('u-fa-3-new', 'fa', 'سینا مدیریت تیم داده را بر عهده گرفت', S.joyixir, READERS.joyixir, { by: 'sina', age: 11 }),
  ),
  ...chain(
    mem('u-fa-4-old', 'fa', 'رضا شبها کار میکند', S.private('reza'), ['reza'], { type: 'preference', about: ['reza'], age: 75 }),
    mem('u-fa-4-new', 'fa', 'رضا صبح زود کار میکند', S.private('reza'), ['reza'], { type: 'preference', about: ['reza'], age: 13 }),
  ),
  ...invalidated(
    mem('u-fa-5-old', 'fa', 'تست کاربری سطح یک با ده نفر انجام شد', S.team, READERS.team, { type: 'event', age: 46 }),
    mem('u-fa-5-new', 'fa', 'تست کاربری سطح یک با بیست نفر تکرار شد', S.team, READERS.team, { type: 'event', age: 7 }),
  ),

  // ---------------- temporal (4 EN, 3 FA pairs) ----------------
  expired(mem('t-en-1-old', 'en', 'This sprint goal is finishing the tutorial level', S.team, READERS.team, { age: 20 }), 6),
  current(mem('t-en-1-new', 'en', 'This sprint goal is polishing the boss fight', S.team, READERS.team, { age: 5 }), 9),
  expired(mem('t-en-2-old', 'en', 'Reza is on vacation until October 5', S.private('reza'), ['reza'], { type: 'event', about: ['reza'], age: 25 }), 15),
  current(mem('t-en-2-new', 'en', 'Reza is back from vacation and traveling to Berlin on October 28', S.private('reza'), ['reza'], { type: 'event', about: ['reza'], age: 6 }), 10),
  expired(mem('t-en-3-old', 'en', 'Hoor-ops on-call this week is Sina', S.hoorOps, READERS.hoorOps, { by: 'sina', age: 12 }), 5),
  current(mem('t-en-3-new', 'en', 'Hoor-ops on-call this week is Nima', S.hoorOps, READERS.hoorOps, { by: 'sina', age: 4 }), 3),
  mem('t-en-4-old', 'en', 'The office is closed for renovation until October 10', S.org, READERS.org, { age: 30, extra: { invalidatedAt: daysAgo(10) } }),
  mem('t-en-4-new', 'en', 'The office reopened after the renovation with a new meeting room', S.org, READERS.org, { age: 9 }),

  expired(mem('t-fa-1-old', 'fa', 'هدف این هفته تمام کردن منوی اصلی است', S.team, READERS.team, { age: 19 }), 7),
  current(mem('t-fa-1-new', 'fa', 'هدف این هفته رفع خطای ذخیره بازی است', S.team, READERS.team, { age: 4 }), 6),
  expired(mem('t-fa-2-old', 'fa', 'رضا تا دهم مهر در مرخصی است', S.private('reza'), ['reza'], { type: 'event', about: ['reza'], age: 27 }), 16),
  current(mem('t-fa-2-new', 'fa', 'رضا از مرخصی برگشته و بیست و هشتم مهر به برلین میرود', S.private('reza'), ['reza'], { type: 'event', about: ['reza'], age: 5 }), 12),
  expired(mem('t-fa-3-old', 'fa', 'کد تخفیف تابستان فعال است', S.org, READERS.org, { age: 60 }), 20),
  current(mem('t-fa-3-new', 'fa', 'کد تخفیف پاییز فعال است', S.org, READERS.org, { age: 10 }), 30),

  // ---------------- abstention sources (5 EN, 4 FA) ----------------
  mem('a-en-trailer', 'en', 'The GameEnd trailer music is licensed from Nordic Sound', S.gameend, READERS.gameend, { age: 33 }),
  expired(mem('a-en-wifi', 'en', 'Guest wifi code for the summer event is posted at reception', S.org, READERS.org, { age: 90 }), 40),
  ...chain(
    mem('a-en-proto-old', 'en', 'The prototype code name is Falcon', S.gameend, READERS.gameend, { age: 65 }),
    mem('a-en-proto-new', 'en', 'The prototype code name changed and only Reza knows it', S.private('reza'), ['reza'], { age: 20 }),
  ),
  expired(mem('a-en-hack', 'en', 'Hackathon theme this month is procedural cities', S.org, READERS.org, { age: 70 }), 35),

  expired(mem('a-fa-wifi', 'fa', 'رمز وای فای مهمان رویداد تابستان پشت پذیرش است', S.org, READERS.org, { age: 88 }), 45),
  ...chain(
    mem('a-fa-proto-old', 'fa', 'اسم رمز نمونه اولیه شاهین است', S.gameend, READERS.gameend, { age: 66 }),
    mem('a-fa-proto-new', 'fa', 'اسم رمز نمونه اولیه عوض شد و فقط رضا میداند', S.private('reza'), ['reza'], { age: 21 }),
  ),
  expired(mem('a-fa-hack', 'fa', 'موضوع هکاتون این ماه شهرهای رویه ای است', S.org, READERS.org, { age: 72 }), 36),

  // ---------------- leakage canaries (1 EN, 1 FA) ----------------
  mem('l-en-salary', 'en', 'Reza is negotiating the salary raise for Milad', S.private('reza'), ['reza'], { sensitivity: 'confidential', about: ['milad'], age: 3 }),
  mem('l-fa-salary', 'fa', 'رضا درباره افزایش حقوق میلاد مذاکره میکند', S.private('reza'), ['reza'], { sensitivity: 'confidential', about: ['milad'], age: 2 }),
];

export type EvalCategory = 'single_session' | 'multi_session' | 'update' | 'temporal' | 'abstention' | 'cross_person_leakage';

export interface EvalQuestion {
  id: string;
  lang: 'fa' | 'en';
  category: EvalCategory;
  chat: { kind: 'private'; personId: string } | { kind: 'group'; groupId: string };
  query: string;
  expected: string[];
  blocked: string[];
  /** FA queries the v1 tokenizer cannot match: Arabic-keyboard letters, ZWNJ/plural forms or 3-letter words. */
  v1Hard?: 'variant' | 'zwnj' | 'plural' | 'short';
}

const P = (personId: string) => ({ kind: 'private' as const, personId });
const GRP = (groupId: string) => ({ kind: 'group' as const, groupId });
let qn = 0;
function q(lang: 'fa' | 'en', category: EvalCategory, chat: EvalQuestion['chat'], query: string, expected: string[], blocked: string[] = [], v1Hard?: EvalQuestion['v1Hard']): EvalQuestion {
  return { id: `q${String(++qn).padStart(3, '0')}`, lang, category, chat, query, expected, blocked, ...(v1Hard ? { v1Hard } : {}) };
}

export const EVAL_QUESTIONS: EvalQuestion[] = [
  // ---------------- single_session: 12 EN + 13 FA ----------------
  q('en', 'single_session', P('reza'), 'When is the GameEnd launch scheduled?', ['s-en-01']),
  q('en', 'single_session', P('reza'), 'What day does Reza like the weekly demo?', ['s-en-02']),
  q('en', 'single_session', P('milad'), 'Is Ludaxis hiring a designer?', ['s-en-03']),
  q('en', 'single_session', P('nima'), 'Who owns the Postgres migration?', ['s-en-04']),
  q('en', 'single_session', GRP('gameend-team'), 'What time is the standup?', ['s-en-05']),
  q('en', 'single_session', GRP('gameend-team'), 'Who wrote the playtest checklist?', ['s-en-06']),
  q('en', 'single_session', P('sina'), 'When does the kitchen close on Friday?', ['s-en-07']),
  q('en', 'single_session', P('sina'), 'When did Nima join as an analyst?', ['s-en-08']),
  q('en', 'single_session', GRP('leads'), 'What price did we agree for the premium tier?', ['s-en-09']),
  q('en', 'single_session', P('parastoo'), 'Where is the quarterly retrospective offsite?', ['s-en-10']),
  q('en', 'single_session', P('guest-ali'), 'When is the localization contract draft due?', ['s-en-11']),
  q('en', 'single_session', P('reza'), 'When is my dentist appointment?', ['s-en-12']),

  q('fa', 'single_session', P('parastoo'), 'بودجه تبلیغات پاییز چقدر است', ['s-fa-01']),
  q('fa', 'single_session', GRP('gameend-team'), arabicKeyboard('کارگاه طراحی کی بود'), ['s-fa-02'], [], 'variant'),
  q('fa', 'single_session', P('nima'), 'سفر تیم کجاست', ['s-fa-03'], [], 'short'),
  q('fa', 'single_session', P('milad'), 'فایلها کجاست', ['s-fa-04'], [], 'plural'),
  q('fa', 'single_session', GRP('gameend-team'), 'مسئول تست سطح هفت کیست', ['s-fa-05']),
  q('fa', 'single_session', GRP('leads'), 'جلسه هفتگی مدیران چه روزی است', ['s-fa-06']),
  q('fa', 'single_session', P('nima'), 'مهاجرت پایگاه داده کی تمام میشود', ['s-fa-07']),
  q('fa', 'single_session', P('sina'), arabicKeyboard('گزارش فروش ماهانه با کیست'), ['s-fa-08']),
  q('fa', 'single_session', P('reza'), 'چای سبز', ['s-fa-09'], [], 'short'),
  q('fa', 'single_session', GRP('leads'), arabicKeyboard('قیمت اشتراک ویژه'), ['s-fa-10'], [], 'variant'),
  q('fa', 'single_session', P('reza'), 'کتابها کو', ['s-fa-11'], [], 'plural'),
  q('fa', 'single_session', P('reza'), 'نوبت پزشک قلب', ['s-fa-12']),
  q('fa', 'single_session', P('guest-ali'), arabicKeyboard('علی کی میفرستد'), ['s-fa-13'], [], 'variant'),

  // ---------------- multi_session: 10 EN + 10 FA ----------------
  q('en', 'multi_session', P('reza'), 'How many players joined across the GameEnd beta waves?', ['m-en-1a', 'm-en-1b']),
  q('en', 'multi_session', P('milad'), 'Total beta wave players for GameEnd', ['m-en-1a', 'm-en-1b']),
  q('en', 'multi_session', P('sina'), 'What were the hoor-ops server cost estimates per month?', ['m-en-2a', 'm-en-2b']),
  q('en', 'multi_session', P('nima'), 'Compare the hoor-ops server plans in dollars', ['m-en-2a', 'm-en-2b']),
  q('en', 'multi_session', GRP('gameend-team'), 'What hand painted art style references and approval do we have?', ['m-en-3a', 'm-en-3b']),
  q('en', 'multi_session', GRP('gameend-team'), 'hand painted art style status', ['m-en-3a', 'm-en-3b']),
  q('en', 'multi_session', P('parastoo'), 'Where are we with the Ludaxis producer candidates?', ['m-en-4a', 'm-en-4b']),
  q('en', 'multi_session', P('reza'), 'producer candidate interview progress', ['m-en-4a', 'm-en-4b']),
  q('en', 'multi_session', P('reza'), 'What is my Unity shaders learning plan?', ['m-en-5a', 'm-en-5b']),
  q('en', 'multi_session', P('reza'), 'Did I start the Unity shaders course I wanted?', ['m-en-5a', 'm-en-5b']),

  q('fa', 'multi_session', GRP('leads'), 'نتیجه جلسات سرمایه گذار درباره بودجه', ['m-fa-1a', 'm-fa-1b']),
  q('fa', 'multi_session', GRP('leads'), arabicKeyboard('سرمایه گذار بودجه را تایید کرد'), ['m-fa-1a', 'm-fa-1b']),
  q('fa', 'multi_session', GRP('gameend-team'), 'سطح جنگلها', ['m-fa-2a', 'm-fa-2b'], [], 'plural'),
  q('fa', 'multi_session', GRP('gameend-team'), arabicKeyboard('طراحی و موسیقی جنگل'), ['m-fa-2a', 'm-fa-2b']),
  q('fa', 'multi_session', P('sina'), 'سرور جدید پروژه', ['m-fa-3a', 'm-fa-3b']),
  q('fa', 'multi_session', P('nima'), 'وضعیت سرور جدید', ['m-fa-3a', 'm-fa-3b']),
  q('fa', 'multi_session', P('reza'), 'جلسات طولانی', ['m-fa-4a', 'm-fa-4b']),
  q('fa', 'multi_session', P('reza'), 'محدود کردن جلسات طولانی', ['m-fa-4a', 'm-fa-4b']),
  q('fa', 'multi_session', P('parastoo'), 'برنامه استخدام', ['m-fa-5a', 'm-fa-5b']),
  q('fa', 'multi_session', P('reza'), arabicKeyboard('فهرست استخدام سال بعد'), ['m-fa-5a', 'm-fa-5b']),

  // ---------------- update: 7 EN + 8 FA ----------------
  q('en', 'update', P('reza'), 'Which platforms will GameEnd release on?', ['u-en-1-new'], ['u-en-1-old']),
  q('en', 'update', P('milad'), 'GameEnd release platform', ['u-en-1-new'], ['u-en-1-old']),
  q('en', 'update', GRP('gameend-team'), 'When is the design review?', ['u-en-2-new'], ['u-en-2-old']),
  q('en', 'update', P('sina'), 'How often do hoor-ops deploys go out?', ['u-en-3-new'], ['u-en-3-old']),
  q('en', 'update', P('nima'), 'deploy schedule for hoor-ops', ['u-en-3-new'], ['u-en-3-old']),
  q('en', 'update', P('reza'), 'How do I take my coffee?', ['u-en-4-new'], ['u-en-4-old']),
  q('en', 'update', GRP('leads'), 'How long is the premium tier trial?', ['u-en-5-new'], ['u-en-5-old']),

  q('fa', 'update', P('sina'), 'دفتر جدید کجاست', ['u-fa-1-new'], ['u-fa-1-old']),
  q('fa', 'update', P('parastoo'), arabicKeyboard('آدرس دفتر جدید'), ['u-fa-1-new'], ['u-fa-1-old']),
  q('fa', 'update', P('milad'), 'ددلاین ترجمه فارسی', ['u-fa-2-new'], ['u-fa-2-old']),
  q('fa', 'update', P('reza'), arabicKeyboard('ترجمه فارسی کی تمام میشود'), ['u-fa-2-new'], ['u-fa-2-old']),
  q('fa', 'update', P('nima'), 'مدیریت تیم داده با کیست', ['u-fa-3-new'], ['u-fa-3-old']),
  q('fa', 'update', P('reza'), 'ساعت کار رضا', ['u-fa-4-new'], ['u-fa-4-old'], 'short'),
  q('fa', 'update', GRP('gameend-team'), arabicKeyboard('تست کاربری سطح یک'), ['u-fa-5-new'], ['u-fa-5-old'], 'variant'),
  q('fa', 'update', GRP('gameend-team'), 'تست کاربری با چند نفر', ['u-fa-5-new'], ['u-fa-5-old']),

  // ---------------- temporal: 8 EN + 7 FA ----------------
  q('en', 'temporal', GRP('gameend-team'), 'What is the current sprint goal?', ['t-en-1-new'], ['t-en-1-old']),
  q('en', 'temporal', GRP('gameend-team'), 'sprint goal this week', ['t-en-1-new'], ['t-en-1-old']),
  q('en', 'temporal', P('reza'), 'Am I on vacation or traveling?', ['t-en-2-new'], ['t-en-2-old']),
  q('en', 'temporal', P('reza'), 'Berlin trip date', ['t-en-2-new'], ['t-en-2-old']),
  q('en', 'temporal', P('sina'), 'Who is hoor-ops on-call this week?', ['t-en-3-new'], ['t-en-3-old']),
  q('en', 'temporal', P('nima'), 'on-call rotation for hoor-ops', ['t-en-3-new'], ['t-en-3-old']),
  q('en', 'temporal', P('milad'), 'Is the office open after the renovation?', ['t-en-4-new'], ['t-en-4-old']),
  q('en', 'temporal', P('sina'), 'office renovation status', ['t-en-4-new'], ['t-en-4-old']),

  q('fa', 'temporal', GRP('gameend-team'), 'هدف این هفته چیست', ['t-fa-1-new'], ['t-fa-1-old']),
  q('fa', 'temporal', GRP('gameend-team'), arabicKeyboard('هدف هفته جاری'), ['t-fa-1-new'], ['t-fa-1-old']),
  q('fa', 'temporal', P('reza'), 'مرخصی', ['t-fa-2-new'], ['t-fa-2-old']),
  q('fa', 'temporal', P('reza'), arabicKeyboard('سفر برلین کی است'), ['t-fa-2-new'], ['t-fa-2-old'], 'variant'),
  q('fa', 'temporal', P('nima'), 'کد تخفیف فعال', ['t-fa-3-new'], ['t-fa-3-old']),
  q('fa', 'temporal', P('sina'), 'کدام کد تخفیف فعال است', ['t-fa-3-new'], ['t-fa-3-old']),
  q('fa', 'temporal', P('milad'), arabicKeyboard('تخفیف فعال'), ['t-fa-3-new'], ['t-fa-3-old']),

  // ---------------- abstention: 5 EN + 5 FA ----------------
  q('en', 'abstention', P('nima'), 'What music is licensed for the GameEnd trailer?', [], ['a-en-trailer']),
  q('en', 'abstention', P('reza'), 'What is the guest wifi code for the summer event?', [], ['a-en-wifi']),
  q('en', 'abstention', P('milad'), 'What is the prototype code name?', [], ['a-en-proto-old', 'a-en-proto-new']),
  q('en', 'abstention', P('parastoo'), 'When is the dentist appointment for Reza?', [], ['s-en-12']),
  q('en', 'abstention', P('sina'), 'What was the hackathon theme this month?', [], ['a-en-hack']),

  q('fa', 'abstention', P('milad'), 'رمز وای فای مهمان چیست', [], ['a-fa-wifi']),
  q('fa', 'abstention', P('sina'), arabicKeyboard('اسم رمز نمونه اولیه'), [], ['a-fa-proto-old', 'a-fa-proto-new']),
  q('fa', 'abstention', P('nima'), 'بودجه تبلیغات پاییز', [], ['s-fa-01']),
  q('fa', 'abstention', P('parastoo'), 'رضا چه چایی دوست دارد', [], ['s-fa-09']),
  q('fa', 'abstention', P('reza'), 'موضوع هکاتون', [], ['a-fa-hack']),

  // ---------------- cross_person_leakage: 8 EN + 7 FA ----------------
  q('en', 'cross_person_leakage', P('sina'), 'When is the dentist appointment for Reza?', [], ['s-en-12']),
  q('en', 'cross_person_leakage', P('guest-ali'), 'When is the GameEnd launch scheduled?', [], ['s-en-01']),
  q('en', 'cross_person_leakage', P('nima'), 'What premium tier price did the leads agree?', [], ['s-en-09']),
  q('en', 'cross_person_leakage', P('milad'), 'Where is the Reza and Parastoo retrospective offsite?', [], ['s-en-10']),
  q('en', 'cross_person_leakage', P('milad'), 'Is Reza negotiating my salary raise?', [], ['l-en-salary']),
  q('en', 'cross_person_leakage', GRP('gameend-team'), 'What premium tier price did we agree?', [], ['s-en-09']),
  q('en', 'cross_person_leakage', P('guest-ali'), 'When does the office kitchen close?', [], ['s-en-07']),
  q('en', 'cross_person_leakage', GRP('gameend-team'), 'When is the dentist appointment for Reza?', [], ['s-en-12']),

  q('fa', 'cross_person_leakage', P('parastoo'), 'رضا پیش پزشک قلب میرود', [], ['s-fa-12']),
  q('fa', 'cross_person_leakage', P('guest-ali'), 'بودجه تبلیغات پاییز', [], ['s-fa-01']),
  q('fa', 'cross_person_leakage', P('milad'), arabicKeyboard('قیمت اشتراک ویژه'), [], ['s-fa-10']),
  q('fa', 'cross_person_leakage', P('sina'), 'برنامه استخدام رضا و پرستو', [], ['m-fa-5a', 'm-fa-5b']),
  q('fa', 'cross_person_leakage', GRP('leads'), 'کارگاه طراحی مرحله جدید', [], ['s-fa-02']),
  q('fa', 'cross_person_leakage', P('nima'), 'مسئول تست سطح هفت', [], ['s-fa-05']),
  q('fa', 'cross_person_leakage', P('milad'), 'افزایش حقوق میلاد', [], ['l-fa-salary']),
];
