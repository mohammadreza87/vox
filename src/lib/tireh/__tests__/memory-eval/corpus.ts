/**
 * Synthetic EN/FA memory corpus for the retrieval eval (about 130 records).
 *
 * Every record carries an explicit, hand-written `visibleTo` label: the askers
 * whose chat may use it by scope and audience snapshot. The label is the
 * eval's independent oracle; the eval test cross-checks it against
 * isVisibleInChat. Superseded, invalidated and expired records keep their
 * scope label: their exclusion is tracked through the questions' forbidden ids.
 */
import type { MemoryRecord, MemoryScope, MemorySensitivity, MemoryType } from '../../types';
import type { AskerKey } from './org';

interface ScopeSpec {
  scope: MemoryScope;
  /** undefined = legacy row without an audience snapshot (fails closed). */
  auth: string[] | undefined;
  sensitivity: MemorySensitivity;
  visibleTo: AskerKey[];
}

/** Hand-written audience labels; deliberately not derived from visibility.ts. */
const SCOPES = {
  'p:reza': { scope: { kind: 'private', personId: 'reza' }, auth: ['reza'], sensitivity: 'normal', visibleTo: ['p:reza'] },
  'p:parastoo': { scope: { kind: 'private', personId: 'parastoo' }, auth: ['parastoo'], sensitivity: 'normal', visibleTo: ['p:parastoo'] },
  'p:milad': { scope: { kind: 'private', personId: 'milad' }, auth: ['milad'], sensitivity: 'normal', visibleTo: ['p:milad'] },
  'p:sina': { scope: { kind: 'private', personId: 'sina' }, auth: ['sina'], sensitivity: 'normal', visibleTo: ['p:sina'] },
  'p:negar': { scope: { kind: 'private', personId: 'negar' }, auth: ['negar'], sensitivity: 'normal', visibleTo: ['p:negar'] },
  'personal:reza': { scope: { kind: 'private', personId: 'reza' }, auth: ['reza'], sensitivity: 'personal', visibleTo: ['p:reza'] },
  'personal:parastoo': { scope: { kind: 'private', personId: 'parastoo' }, auth: ['parastoo'], sensitivity: 'personal', visibleTo: ['p:parastoo'] },
  'confidential:reza': { scope: { kind: 'private', personId: 'reza' }, auth: ['reza'], sensitivity: 'confidential', visibleTo: ['p:reza'] },
  'people:reza+parastoo': { scope: { kind: 'people', personIds: ['parastoo', 'reza'] }, auth: ['parastoo', 'reza'], sensitivity: 'normal', visibleTo: ['p:reza', 'p:parastoo'] },
  'people:milad+sina': { scope: { kind: 'people', personIds: ['milad', 'sina'] }, auth: ['milad', 'sina'], sensitivity: 'normal', visibleTo: ['p:milad', 'p:sina'] },
  /** Snapshotted while Arman was still in the team. */
  'g:team-old': { scope: { kind: 'group', groupId: 'gameend-team' }, auth: ['arman', 'milad', 'parastoo', 'reza'], sensitivity: 'normal', visibleTo: ['p:reza', 'p:parastoo', 'p:milad', 'g:gameend-team'] },
  'g:team': { scope: { kind: 'group', groupId: 'gameend-team' }, auth: ['milad', 'parastoo', 'reza'], sensitivity: 'normal', visibleTo: ['p:reza', 'p:parastoo', 'p:milad', 'g:gameend-team'] },
  'g:leads': { scope: { kind: 'group', groupId: 'leads' }, auth: ['parastoo', 'reza'], sensitivity: 'normal', visibleTo: ['p:reza', 'p:parastoo', 'g:leads'] },
  /** Partners is heard with guests, so its group chat sees nothing. */
  'g:partners': { scope: { kind: 'group', groupId: 'partners' }, auth: ['negar', 'reza', 'sina'], sensitivity: 'normal', visibleTo: ['p:reza', 'p:sina', 'p:negar'] },
  'proj:gameend-old': { scope: { kind: 'project', projectId: 'gameend' }, auth: ['arman', 'milad', 'parastoo', 'reza'], sensitivity: 'normal', visibleTo: ['p:reza', 'p:parastoo', 'p:milad'] },
  'proj:gameend': { scope: { kind: 'project', projectId: 'gameend' }, auth: ['milad', 'parastoo', 'reza'], sensitivity: 'normal', visibleTo: ['p:reza', 'p:parastoo', 'p:milad'] },
  'proj:kian': { scope: { kind: 'project', projectId: 'kian' }, auth: ['milad', 'reza', 'sina'], sensitivity: 'normal', visibleTo: ['p:reza', 'p:milad', 'p:sina'] },
  'co:ludaxis': { scope: { kind: 'company', companyId: 'ludaxis' }, auth: ['arman', 'milad', 'parastoo', 'reza'], sensitivity: 'normal', visibleTo: ['p:reza', 'p:parastoo', 'p:milad', 'p:arman'] },
  'co:joyixir': { scope: { kind: 'company', companyId: 'joyixir' }, auth: ['sina'], sensitivity: 'normal', visibleTo: ['p:sina'] },
  org: { scope: { kind: 'org' }, auth: ['arman', 'milad', 'parastoo', 'reza', 'sina'], sensitivity: 'normal', visibleTo: ['p:reza', 'p:parastoo', 'p:milad', 'p:sina', 'p:arman'] },
  'org-legacy': { scope: { kind: 'org' }, auth: undefined, sensitivity: 'normal', visibleTo: [] },
} satisfies Record<string, ScopeSpec>;

type ScopeCode = keyof typeof SCOPES;

export interface EvalRecord {
  record: MemoryRecord;
  lang: 'en' | 'fa';
  visibleTo: readonly AskerKey[];
}

const day = (iso: string) => new Date(`${iso}T09:00:00Z`);

interface Extra {
  type?: MemoryType;
  about?: string[];
  topic?: string;
  at?: string;
  by?: string;
  v2?: Partial<MemoryRecord>;
}

const rows: EvalRecord[] = [];

function add(id: string, lang: 'en' | 'fa', code: ScopeCode, content: string, extra: Extra = {}): MemoryRecord {
  const spec: ScopeSpec = SCOPES[code];
  const at = day(extra.at ?? '2026-10-08');
  const scope = spec.scope;
  const by = extra.by ?? (scope.kind === 'private' ? scope.personId : scope.kind === 'people' ? scope.personIds[0] : 'reza');
  const record: MemoryRecord = {
    id,
    personaId: 'aria',
    content,
    type: extra.type ?? 'fact',
    scope,
    ...(spec.auth ? { authorizedPersonIds: [...spec.auth] } : {}),
    sensitivity: spec.sensitivity,
    source: {
      personId: by,
      chatKind: scope.kind === 'group' ? 'group' : 'private',
      ...(scope.kind === 'group' ? { groupId: scope.groupId } : {}),
      eventIds: [`evt-${id}`],
      at,
    },
    aboutPersonIds: extra.about ?? [],
    ...(extra.topic ? { topic: extra.topic } : {}),
    confidence: 0.9,
    createdAt: at,
    updatedAt: at,
    ...extra.v2,
  };
  rows.push({ record, lang, visibleTo: spec.visibleTo });
  return record;
}

/** Old record replaced through the store's supersede path. */
function supersede(oldId: string, newId: string): void {
  const old = rows.find((r) => r.record.id === oldId)!.record;
  const next = rows.find((r) => r.record.id === newId)!.record;
  old.supersededBy = newId;
  next.supersedes = oldId;
}

/** Old record closed by an UPDATE with invalidatedAt/invalidatedBy (never a hard delete). */
function invalidate(oldId: string, newId: string, at = '2026-10-12'): void {
  const old = rows.find((r) => r.record.id === oldId)!.record;
  old.invalidatedAt = day(at);
  old.invalidatedBy = newId;
}

const expired = (at: string): Partial<MemoryRecord> => ({ expiresAt: day(at) });

// ============================================================================
// English
// ============================================================================

// single-session facts
add('en-demo', 'en', 'p:reza', 'Reza prefers weekly demos on Wednesday mornings', { type: 'preference', about: ['reza'], at: '2026-10-11', v2: { importance: 6, status: 'confirmed' } });
add('en-demo-dup', 'en', 'p:reza', '  Reza prefers weekly demos on Wednesday mornings ', { type: 'preference', about: ['reza'], at: '2026-09-02' });
add('en-sprint', 'en', 'p:parastoo', 'Parastoo wants sprint reviews moved to Thursdays', { type: 'preference', about: ['parastoo'] });
add('en-beta', 'en', 'g:team-old', 'GameEnd beta build ships to testers on November 3', { type: 'decision', by: 'parastoo', at: '2026-09-28' });
add('en-monet', 'en', 'proj:gameend-old', 'GameEnd monetization will use a one-time purchase with no ads', { type: 'decision', at: '2026-09-15' });
add('en-kian-engine', 'en', 'proj:kian', 'Kian prototype runs on Unity 6 with the URP pipeline', { by: 'milad' });
add('en-payroll', 'en', 'co:ludaxis', 'Ludaxis payroll is processed on the 25th of each month', { by: 'parastoo' });
add('en-allhands', 'en', 'org', 'HOOR all-hands meeting happens every first Monday of the month', { by: 'reza' });
add('en-freeze', 'en', 'g:leads', 'Leads agreed to freeze hiring until the Series A closes', { type: 'decision' });
add('en-rust', 'en', 'p:milad', 'Milad is learning Rust for the backend rewrite', { about: ['milad'] });
add('en-mkt-budget', 'en', 'people:reza+parastoo', 'Reza and Parastoo agreed the annual marketing budget is 40k dollars', { type: 'decision', about: ['reza', 'parastoo'] });
add('en-partners-call', 'en', 'g:partners', 'Partners call with Negar covers localization pricing for Persian and Arabic', { by: 'reza', about: ['negar'] });
add('en-joyixir-office', 'en', 'co:joyixir', 'Joyixir office moves to north Tehran in January', { by: 'sina' });

// updates: supersede and invalidate pairs
add('en-flight-old', 'en', 'p:reza', 'Reza flight to Dubai is on October 28', { type: 'event', about: ['reza'], at: '2026-10-01' });
add('en-flight', 'en', 'p:reza', 'Reza flight to Dubai moved to October 30', { type: 'event', about: ['reza'], at: '2026-10-09' });
supersede('en-flight-old', 'en-flight');
add('en-launch-old', 'en', 'proj:gameend', 'GameEnd launch date is February 10', { type: 'decision', at: '2026-09-10' });
add('en-launch', 'en', 'proj:gameend', 'GameEnd launch date is February 20', { type: 'decision', at: '2026-10-05', v2: { importance: 9 } });
supersede('en-launch-old', 'en-launch');
add('en-standup-old', 'en', 'g:team', 'Daily standup is at 9:30 in the main room', { type: 'decision', at: '2026-09-20' });
add('en-standup', 'en', 'g:team', 'Daily standup moved to 10:00', { type: 'decision', at: '2026-10-12' });
invalidate('en-standup-old', 'en-standup');
add('en-art-old', 'en', 'proj:kian', 'Kian art style is pixel art', { type: 'decision', at: '2026-09-05' });
add('en-art', 'en', 'proj:kian', 'Kian art style switched to low-poly 3D', { type: 'decision', at: '2026-10-03' });
supersede('en-art-old', 'en-art');
add('en-expense-old', 'en', 'org', 'Expense reports are due every Friday', { at: '2026-08-20' });
add('en-expense', 'en', 'org', 'Expense reports are due on the last business day of the month', { at: '2026-10-02' });
invalidate('en-expense-old', 'en-expense', '2026-10-02');
add('en-board-old', 'en', 'g:leads', 'Board meeting is on November 12', { type: 'event', at: '2026-09-30' });
add('en-board', 'en', 'g:leads', 'Board meeting rescheduled to November 19', { type: 'event', at: '2026-10-10' });
supersede('en-board-old', 'en-board');
add('en-laptop-old', 'en', 'p:sina', 'Sina uses a ThinkPad laptop for development', { about: ['sina'], at: '2026-08-01' });
add('en-laptop', 'en', 'p:sina', 'Sina switched to a MacBook Pro for development', { about: ['sina'], at: '2026-10-06' });
invalidate('en-laptop-old', 'en-laptop', '2026-10-06');
add('en-vpn-old', 'en', 'co:ludaxis', 'Ludaxis VPN uses WireGuard on port 51820', { at: '2026-07-01' });
add('en-vpn', 'en', 'co:ludaxis', 'Ludaxis VPN moved to Tailscale', { at: '2026-10-04' });
supersede('en-vpn-old', 'en-vpn');

// temporal
add('en-okr-old', 'en', 'org', 'Q3 OKR focus is retention', { at: '2026-07-01', v2: expired('2026-09-30') });
add('en-okr', 'en', 'org', 'Q4 OKR focus is monetization', { at: '2026-10-01', v2: { validFrom: day('2026-10-01') } });
add('en-codefreeze', 'en', 'g:team', 'Code freeze: no merges to the release branch until October 15', { type: 'decision', at: '2026-10-01', v2: expired('2026-10-15') });
add('en-merges', 'en', 'g:team', 'Release branch merges now need two approvals', { type: 'decision', at: '2026-10-16' });
add('en-design-review', 'en', 'p:parastoo', 'Parastoo had the design review with the art team on October 14', { type: 'event', about: ['parastoo'], at: '2026-10-14' });
add('en-playtest-1', 'en', 'proj:kian', 'Kian playtest one was on September 30 with 12 players', { type: 'event', at: '2026-09-30' });
add('en-playtest-2', 'en', 'proj:kian', 'Kian playtest two is planned for November 15', { type: 'event', at: '2026-10-10' });
add('en-office-closed', 'en', 'co:ludaxis', 'Ludaxis office is closed this week for renovation', { at: '2026-09-29', v2: expired('2026-10-05') });
add('en-office-open', 'en', 'co:ludaxis', 'Ludaxis office reopened after the renovation on October 6', { at: '2026-10-06' });
add('en-vacation', 'en', 'p:milad', 'Milad vacation is November 1 to November 9', { type: 'event', about: ['milad'] });
add('en-sickleave', 'en', 'p:milad', 'Milad was on sick leave October 2 to 4', { type: 'event', about: ['milad'], at: '2026-10-02', v2: expired('2026-10-05') });
add('en-termsheet', 'en', 'g:leads', 'Deadline for the Series A term sheet is December 1', { type: 'decision' });

// multi-session
add('en-engine-a', 'en', 'p:reza', 'Reza is choosing between Unity and Godot for the next prototype', { about: ['reza'], at: '2026-10-02' });
add('en-engine-b', 'en', 'p:reza', 'Reza leans toward Godot because Unity licensing costs too much', { about: ['reza'], at: '2026-10-09' });
add('en-onb-a', 'en', 'g:team', 'Playtesters said the onboarding tutorial is too long', { at: '2026-10-03' });
add('en-onb-b', 'en', 'g:team', 'Team decided to cut the onboarding tutorial to three steps', { type: 'decision', at: '2026-10-10' });
add('en-sound-a', 'en', 'proj:kian', 'Kian needs a sound designer before the playtest', { at: '2026-09-25' });
add('en-sound-b', 'en', 'proj:kian', 'Kian sound designer candidate is Bahar, interview on October 25', { at: '2026-10-11' });
add('en-investor-a', 'en', 'people:reza+parastoo', 'Investor update draft is due October 22', { at: '2026-10-05' });
add('en-investor-b', 'en', 'people:reza+parastoo', 'Investor update should highlight retention numbers', { at: '2026-10-12' });
add('en-producer-a', 'en', 'p:sina', 'Sina wants to move into a producer role', { about: ['sina'], at: '2026-09-18' });
add('en-producer-b', 'en', 'p:sina', 'Sina asked for a training budget for the producer role', { about: ['sina'], at: '2026-10-07' });
add('en-wellness-a', 'en', 'org', 'HOOR wellness stipend is 200 dollars per quarter', { at: '2026-09-01' });
add('en-wellness-b', 'en', 'org', 'The wellness stipend can be used for a gym or therapy', { at: '2026-10-01' });
add('en-runway-a', 'en', 'g:leads', 'Leads reviewed the burn rate: 14 months of runway', { at: '2026-09-22' });
add('en-runway-b', 'en', 'g:leads', 'Runway extends to 18 months if hiring stays frozen', { at: '2026-10-08' });
add('en-mentor-a', 'en', 'p:parastoo', 'Parastoo mentor is Leila', { about: ['parastoo'], at: '2026-09-20' });
add('en-mentor-b', 'en', 'p:parastoo', 'Parastoo meets her mentor Leila every other Tuesday', { about: ['parastoo'], at: '2026-10-08' });

// leakage and abstention targets
add('en-salary-milad', 'en', 'p:milad', 'Milad salary review is on December 5', { about: ['milad'] });
add('en-salary-parastoo', 'en', 'p:parastoo', 'Parastoo salary review is on November 20', { about: ['parastoo'] });
add('en-salary-reza', 'en', 'confidential:reza', 'Reza salary review is handled by the board', { about: ['reza'] });
add('en-team-budget', 'en', 'g:team', 'Team marketing budget for the beta event is 5k dollars', { type: 'decision' });
add('en-leads-budget', 'en', 'g:leads', 'Leads plan to cut the marketing budget next quarter', { type: 'decision' });
add('en-bonus-legacy', 'en', 'org-legacy', 'Year-end bonuses are paid to everyone in December');
add('en-negar-invoice', 'en', 'p:negar', 'Negar invoices Ludaxis on the first of each month', { about: ['negar'] });
add('en-knee', 'en', 'personal:reza', 'Reza has knee surgery scheduled and wants it kept private', { about: ['reza'] });
add('en-parastoo-news', 'en', 'personal:parastoo', 'Parastoo personal news: she is expecting a baby', { about: ['parastoo'] });

// ============================================================================
// Persian (with Arabic-keyboard letters and ZWNJ spelling variants)
// ============================================================================

// single-session facts
add('fa-1on1', 'fa', 'p:reza', 'رضا ترجیح می‌دهد جلسه‌های یک‌به‌یک صبح‌ها برگزار شود', { type: 'preference', about: ['reza'] });
add('fa-report', 'fa', 'p:parastoo', 'پرستو می‌خواهد گزارش هفتگی تیم را یکشنبه‌ها بگیرد', { type: 'preference', about: ['parastoo'] });
add('fa-beta', 'fa', 'g:team-old', 'نسخه بتای گیم‌اند روز ۱۲ آبان برای تستر‌ها ارسال مي‌شود', { type: 'decision', by: 'parastoo', at: '2026-09-28' });
add('fa-levels', 'fa', 'proj:kian', 'طراحی سطح‌های کیان را میلاد انجام می‌دهد', { about: ['milad'] });
add('fa-insurance', 'fa', 'co:ludaxis', 'بیمه تکمیلی کارمندان لوداکسیس از اول آذر فعال می‌شود', { by: 'parastoo' });
add('fa-hours', 'fa', 'org', 'ساعت کاری هور از ۹ صبح تا ۵ عصر است');
add('fa-raise', 'fa', 'g:leads', 'مدیران تصمیم گرفتند حقوق‌ها از دی ماه ده درصد افزایش یابد', { type: 'decision' });
add('fa-migrate', 'fa', 'p:milad', 'ميلاد برای مهاجرت به کانادا برنامه‌ريزی می‌کند', { about: ['milad'] });
add('fa-netlib', 'fa', 'people:milad+sina', 'میلاد و سینا قرار گذاشتند کتابخانه شبکه را با هم بازنویسی کنند', { type: 'decision', about: ['milad', 'sina'] });
add('fa-music', 'fa', 'proj:gameend-old', 'موسیقی گیم‌اند را یک آهنگساز بیرونی می‌سازد', { type: 'decision', at: '2026-09-12' });
add('fa-tea', 'fa', 'p:sina', 'سینا به قهوه حساسیت دارد و چای سبز می‌نوشد', { type: 'preference', about: ['sina'] });
add('fa-joyixir', 'fa', 'co:joyixir', 'دفتر جوی‌ایکسیر در خیابان ولیعصر است', { by: 'sina' });

// updates
add('fa-flight-old', 'fa', 'p:reza', 'پرواز رضا به استانبول ۵ آبان است', { type: 'event', about: ['reza'], at: '2026-10-01' });
add('fa-flight', 'fa', 'p:reza', 'پرواز رضا به استانبول به ۷ آبان منتقل شد', { type: 'event', about: ['reza'], at: '2026-10-10' });
supersede('fa-flight-old', 'fa-flight');
add('fa-price-old', 'fa', 'proj:gameend', 'قیمت گیم‌اند ۵ دلار تعیین شد', { type: 'decision', at: '2026-09-14' });
add('fa-price', 'fa', 'proj:gameend', 'قیمت نهایی گیم‌اند ۸ دلار شد', { type: 'decision', at: '2026-10-07' });
supersede('fa-price-old', 'fa-price');
add('fa-demo-old', 'fa', 'g:team', 'جلسه دمو هفتگی سه‌شنبه‌ها است', { type: 'decision', at: '2026-09-15' });
add('fa-demo', 'fa', 'g:team', 'جلسه دمو هفتگی به چهارشنبه منتقل شد', { type: 'decision', at: '2026-10-11' });
invalidate('fa-demo-old', 'fa-demo', '2026-10-11');
add('fa-engine-old', 'fa', 'proj:kian', 'موتور بازی کیان گودو انتخاب شد', { type: 'decision', at: '2026-09-01' });
add('fa-engine', 'fa', 'proj:kian', 'موتور بازی کیان به یونیتی تغییر کرد', { type: 'decision', at: '2026-10-04' });
supersede('fa-engine-old', 'fa-engine');
add('fa-wifi-old', 'fa', 'org', 'رمز وای‌فای دفتر هر ماه عوض می‌شود', { at: '2026-08-10' });
add('fa-wifi', 'fa', 'org', 'رمز وای‌فای دفتر هر هفته عوض می‌شود', { at: '2026-10-03' });
invalidate('fa-wifi-old', 'fa-wifi', '2026-10-03');
add('fa-investor-old', 'fa', 'g:leads', 'سرمایه‌گذار اصلی دور اول صندوق نوآوری است', { at: '2026-09-09' });
add('fa-investor', 'fa', 'g:leads', 'سرمایه‌گذار اصلی دور اول شتاب‌دهنده آوا شد', { type: 'decision', at: '2026-10-09' });
supersede('fa-investor-old', 'fa-investor');
add('fa-home-old', 'fa', 'p:parastoo', 'پرستو در محله ونک زندگی می‌کند', { about: ['parastoo'], at: '2026-07-15' });
add('fa-home', 'fa', 'p:parastoo', 'پرستو به محله تجریش اسباب‌کشی کرد', { about: ['parastoo'], at: '2026-10-05' });
invalidate('fa-home-old', 'fa-home', '2026-10-05');
add('fa-travel-old', 'fa', 'co:ludaxis', 'سقف هزینه سفر کاری ۲۰ میلیون تومان است', { at: '2026-06-01' });
add('fa-travel', 'fa', 'co:ludaxis', 'سقف هزینه سفر کاری به ۳۰ میلیون تومان رسید', { at: '2026-10-01' });
supersede('fa-travel-old', 'fa-travel');

// temporal
add('fa-priority-old', 'fa', 'org', 'اولویت فصل تابستان جذب کاربر بود', { at: '2026-06-25', v2: expired('2026-09-22') });
add('fa-priority', 'fa', 'org', 'اولویت فصل پاییز درآمدزایی است', { type: 'decision', at: '2026-09-23' });
add('fa-freeze', 'fa', 'g:team', 'تا ۲۰ مهر هیچ تغییری روی شاخه انتشار ادغام نشود', { type: 'decision', at: '2026-10-01', v2: expired('2026-10-12') });
add('fa-merge', 'fa', 'g:team', 'ادغام روی شاخه انتشار فقط با دو تایید انجام شود', { type: 'decision', at: '2026-10-13' });
add('fa-review', 'fa', 'p:milad', 'میلاد ۲۲ مهر با تیم هنری جلسه بازبینی داشت', { type: 'event', about: ['milad'], at: '2026-10-14' });
add('fa-playtest-1', 'fa', 'proj:kian', 'تست کاربری اول کیان ۸ مهر با ۱۰ نفر انجام شد', { type: 'event', at: '2026-09-30' });
add('fa-playtest-2', 'fa', 'proj:kian', 'تست کاربری دوم کیان برای ۲۵ آبان برنامه‌ریزی شده', { type: 'event', at: '2026-10-12' });
add('fa-office-closed', 'fa', 'co:ludaxis', 'دفتر لوداکسیس این هفته برای تعمیرات تعطیل است', { at: '2026-09-29', v2: expired('2026-10-05') });
add('fa-office-open', 'fa', 'co:ludaxis', 'دفتر لوداکسیس بعد از تعمیرات از ۱۴ مهر باز شد', { at: '2026-10-06' });
add('fa-leave', 'fa', 'p:sina', 'مرخصی سینا از ۱۰ تا ۱۸ آذر است', { type: 'event', about: ['sina'] });
add('fa-finance', 'fa', 'g:leads', 'مهلت ارسال گزارش مالی به هیئت مدیره ۱۵ آبان است', { type: 'decision' });

// multi-session
add('fa-logo-a', 'fa', 'p:reza', 'رضا بین دو طراح برای لوگو مردد است', { about: ['reza'], at: '2026-10-01' });
add('fa-logo-b', 'fa', 'p:reza', 'رضا طراح دوم را برای لوگو انتخاب کرد چون سبکش مینیمال است', { type: 'decision', about: ['reza'], at: '2026-10-08' });
add('fa-level3-a', 'fa', 'g:team', 'بازیکنان گفتند مرحله سوم خیلی سخت است', { at: '2026-10-02' });
add('fa-level3-b', 'fa', 'g:team', 'تیم تصمیم گرفت سختی مرحله سوم را کم کند', { type: 'decision', at: '2026-10-09' });
add('fa-animator-a', 'fa', 'proj:kian', 'کیان به یک انیماتور نیاز دارد', { at: '2026-09-26' });
add('fa-animator-b', 'fa', 'proj:kian', 'برای استخدام انیماتور کیان با دو نفر مصاحبه شد', { at: '2026-10-10' });
add('fa-investor-report-a', 'fa', 'people:reza+parastoo', 'پیش‌نویس گزارش سرمایه‌گذاران تا ۳۰ مهر آماده شود', { at: '2026-10-04' });
add('fa-investor-report-b', 'fa', 'people:reza+parastoo', 'گزارش سرمایه‌گذاران باید روی نرخ ماندگاری تاکید کند', { at: '2026-10-11' });
add('fa-lead-a', 'fa', 'p:milad', 'میلاد می‌خواهد مسئول فنی تیم شود', { about: ['milad'], at: '2026-09-19' });
add('fa-lead-b', 'fa', 'p:milad', 'میلاد برای نقش مسئول فنی یک دوره مدیریت می‌خواهد', { about: ['milad'], at: '2026-10-06' });
add('fa-edu-a', 'fa', 'org', 'کمک‌هزینه آموزشی هر نفر سالی ۱۰ میلیون تومان است', { at: '2026-09-03' });
add('fa-edu-b', 'fa', 'org', 'کمک‌هزینه آموزشی برای دوره‌های آنلاین هم قابل استفاده است', { at: '2026-10-02' });
add('fa-hiring-a', 'fa', 'g:leads', 'مدیران گفتند تا پایان سال دو برنامه‌نویس استخدام شود', { at: '2026-09-21' });
add('fa-hiring-b', 'fa', 'g:leads', 'بودجه استخدام دو برنامه‌نویس تایید شد', { type: 'decision', at: '2026-10-07' });
add('fa-german-a', 'fa', 'p:sina', 'سینا می‌خواهد زبان آلمانی یاد بگیرد', { about: ['sina'], at: '2026-09-10' });
add('fa-german-b', 'fa', 'p:sina', 'سینا کلاس زبان آلمانی را شنبه‌ها شروع کرد', { about: ['sina'], at: '2026-10-03' });

// leakage and abstention targets
add('fa-salary-milad', 'fa', 'p:milad', 'بررسی حقوق میلاد ۱۴ آذر است', { about: ['milad'] });
add('fa-salary-parastoo', 'fa', 'p:parastoo', 'بررسی حقوق پرستو ۳۰ آبان است', { about: ['parastoo'] });
add('fa-salary-reza', 'fa', 'confidential:reza', 'بررسی حقوق رضا با هیئت مدیره است', { about: ['reza'] });
add('fa-ads-team', 'fa', 'g:team', 'بودجه تبلیغات رویداد بتا ۵۰ میلیون تومان است', { type: 'decision' });
add('fa-ads-pair', 'fa', 'people:reza+parastoo', 'بودجه تبلیغات کل سال ۲ میلیارد تومان است', { type: 'decision', about: ['reza', 'parastoo'] });
add('fa-ads-leads', 'fa', 'g:leads', 'بودجه تبلیغات فصل بعد کاهش می‌یابد', { type: 'decision' });
add('fa-bonus-legacy', 'fa', 'org-legacy', 'پاداش پایان سال به همه پرداخت می‌شود');
add('fa-negar-invoice', 'fa', 'p:negar', 'نگار صورت‌حساب‌هایش را اول هر ماه برای لوداکسیس می‌فرستد', { about: ['negar'] });
add('fa-payroll', 'fa', 'co:ludaxis', 'حقوق کارمندان لوداکسیس ۲۵ هر ماه پرداخت می‌شود', { by: 'parastoo' });
add('fa-translation', 'fa', 'g:partners', 'قرارداد ترجمه فارسی با شرکا امضا شد', { type: 'decision', about: ['negar'] });
add('fa-parastoo-news', 'fa', 'personal:parastoo', 'پرستو باردار است و فعلا نمی‌خواهد کسی بداند', { about: ['parastoo'] });
add('fa-reza-health', 'fa', 'personal:reza', 'رضا برای درمان کمردرد پیش فیزیوتراپ می‌رود', { about: ['reza'] });
// Near duplicate of fa-merge, older; ranks below it.
add('fa-merge-near', 'fa', 'g:team', 'ادغام روی شاخه انتشار فقط با دو تایید انجام می‌شود', { type: 'decision', at: '2026-10-13', v2: { importance: 3 } });

export const CORPUS: readonly EvalRecord[] = rows;
export const RECORDS: readonly MemoryRecord[] = rows.map((r) => r.record);
export const BY_ID: ReadonlyMap<string, EvalRecord> = new Map(rows.map((r) => [r.record.id, r]));
