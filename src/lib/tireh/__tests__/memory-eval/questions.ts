/**
 * 100 EN/FA memory-eval questions over corpus.ts. goldIds are the records a
 * good answer needs (empty for abstention); forbiddenIds are records the asker
 * must never receive: invisible to them, superseded, invalidated or expired.
 */
import type { AskerKey } from './org';

export type EvalCategory = 'single' | 'multi' | 'update' | 'temporal' | 'abstention' | 'leakage';

export interface EvalQuestion {
  id: string;
  lang: 'en' | 'fa';
  category: EvalCategory;
  asker: AskerKey;
  query: string;
  goldIds: string[];
  forbiddenIds: string[];
}

type Row = [id: string, category: EvalCategory, asker: AskerKey, query: string, gold: string[], forbidden?: string[]];

const EN: Row[] = [
  // single
  ['en-q01', 'single', 'p:reza', 'When do I like to have the weekly demo?', ['en-demo']],
  ['en-q02', 'single', 'p:parastoo', 'Which day should sprint reviews happen?', ['en-sprint']],
  ['en-q03', 'single', 'g:gameend-team', 'When does the beta build go to testers?', ['en-beta']],
  ['en-q04', 'single', 'p:milad', 'What monetization model did we pick for GameEnd?', ['en-monet']],
  ['en-q05', 'single', 'p:sina', 'Which Unity version does the Kian prototype use?', ['en-kian-engine']],
  ['en-q06', 'single', 'p:arman', 'When is payroll processed at Ludaxis?', ['en-payroll']],
  ['en-q07', 'single', 'p:sina', 'When is the all-hands meeting?', ['en-allhands']],
  ['en-q08', 'single', 'g:leads', 'What did we decide about hiring until the Series A?', ['en-freeze']],
  ['en-q09', 'single', 'p:milad', 'What language am I learning for the backend rewrite?', ['en-rust']],
  ['en-q10', 'single', 'p:parastoo', 'What annual marketing budget did Reza and I agree on?', ['en-mkt-budget']],
  ['en-q11', 'single', 'p:negar', 'What will the partners call cover?', ['en-partners-call']],
  ['en-q12', 'single', 'p:sina', 'Where is the Joyixir office moving?', ['en-joyixir-office']],
  // update
  ['en-q13', 'update', 'p:reza', 'When is my flight to Dubai?', ['en-flight'], ['en-flight-old']],
  ['en-q14', 'update', 'p:parastoo', 'What is the GameEnd launch date?', ['en-launch'], ['en-launch-old']],
  ['en-q15', 'update', 'g:gameend-team', 'What time is the daily standup?', ['en-standup'], ['en-standup-old']],
  ['en-q16', 'update', 'p:milad', 'What art style is Kian using?', ['en-art'], ['en-art-old']],
  ['en-q17', 'update', 'p:arman', 'When are expense reports due?', ['en-expense'], ['en-expense-old']],
  ['en-q18', 'update', 'g:leads', 'When is the board meeting?', ['en-board'], ['en-board-old']],
  ['en-q19', 'update', 'p:sina', 'Which laptop do I use for development?', ['en-laptop'], ['en-laptop-old']],
  ['en-q20', 'update', 'p:milad', 'Which VPN does Ludaxis use?', ['en-vpn'], ['en-vpn-old']],
  // temporal
  ['en-q21', 'temporal', 'p:reza', 'What is the current OKR focus?', ['en-okr'], ['en-okr-old']],
  ['en-q22', 'temporal', 'g:gameend-team', 'What is the policy for merges to the release branch?', ['en-merges'], ['en-codefreeze']],
  ['en-q23', 'temporal', 'p:parastoo', 'When did I have the design review with the art team?', ['en-design-review']],
  ['en-q24', 'temporal', 'p:sina', 'When is the next Kian playtest planned?', ['en-playtest-2']],
  ['en-q25', 'temporal', 'p:milad', 'Is the Ludaxis office open after the renovation?', ['en-office-open'], ['en-office-closed']],
  ['en-q26', 'temporal', 'p:milad', 'When is my vacation in November?', ['en-vacation'], ['en-sickleave']],
  ['en-q27', 'temporal', 'g:leads', 'What is the deadline for the term sheet?', ['en-termsheet']],
  // multi
  ['en-q28', 'multi', 'p:reza', 'What did I conclude about Godot versus Unity for the prototype?', ['en-engine-a', 'en-engine-b']],
  ['en-q29', 'multi', 'g:gameend-team', 'What happened with the onboarding tutorial?', ['en-onb-a', 'en-onb-b']],
  ['en-q30', 'multi', 'p:milad', 'Where are we on the Kian sound designer?', ['en-sound-a', 'en-sound-b']],
  ['en-q31', 'multi', 'p:reza', 'What do I need for the investor update?', ['en-investor-a', 'en-investor-b']],
  ['en-q32', 'multi', 'p:sina', 'What did I say about the producer role?', ['en-producer-a', 'en-producer-b']],
  ['en-q33', 'multi', 'p:parastoo', 'How does the wellness stipend work?', ['en-wellness-a', 'en-wellness-b']],
  ['en-q34', 'multi', 'g:leads', 'How many months of runway do we have?', ['en-runway-a', 'en-runway-b']],
  ['en-q35', 'multi', 'p:parastoo', 'Who is my mentor and when do we meet?', ['en-mentor-a', 'en-mentor-b']],
  // abstention
  ['en-q36', 'abstention', 'p:parastoo', 'What did Reza tell you about his Dubai flight?', [], ['en-flight', 'en-flight-old']],
  ['en-q37', 'abstention', 'p:sina', 'What is the GameEnd launch date?', [], ['en-launch', 'en-launch-old']],
  ['en-q38', 'abstention', 'p:arman', 'When does the GameEnd beta build ship to testers?', [], ['en-beta']],
  ['en-q39', 'abstention', 'p:negar', 'When is the HOOR all-hands meeting?', [], ['en-allhands']],
  ['en-q40', 'abstention', 'g:partners', 'What localization pricing did we discuss on the partners call?', [], ['en-partners-call']],
  ['en-q41', 'abstention', 'p:milad', 'What is the price of the new office coffee machine?', []],
  // leakage
  ['en-q42', 'leakage', 'p:milad', 'When is my salary review?', ['en-salary-milad'], ['en-salary-parastoo', 'en-salary-reza']],
  ['en-q43', 'leakage', 'g:gameend-team', 'What is the marketing budget?', ['en-team-budget'], ['en-mkt-budget', 'en-leads-budget']],
  ['en-q44', 'leakage', 'g:leads', 'What did the team decide about the onboarding tutorial?', [], ['en-onb-a', 'en-onb-b']],
  ['en-q45', 'leakage', 'p:sina', 'What did Parastoo say about sprint reviews?', [], ['en-sprint']],
  ['en-q46', 'leakage', 'p:parastoo', 'Which Unity version does the Kian prototype use?', [], ['en-kian-engine']],
  ['en-q47', 'leakage', 'p:reza', 'What does the old memo say about year-end bonuses?', [], ['en-bonus-legacy']],
  ['en-q48', 'leakage', 'p:arman', 'What did GameEnd decide about monetization?', [], ['en-monet']],
  ['en-q49', 'leakage', 'p:negar', 'When is Ludaxis payroll processed each month?', ['en-negar-invoice'], ['en-payroll']],
  ['en-q50', 'leakage', 'p:milad', 'Does Parastoo have any personal news or is Reza having surgery?', [], ['en-parastoo-news', 'en-knee']],
];

const FA: Row[] = [
  // single
  ['fa-q01', 'single', 'p:reza', 'جلسه‌های یک‌به‌یک من چه زمانی برگزار شود؟', ['fa-1on1']],
  ['fa-q02', 'single', 'p:parastoo', 'گزارش هفتگی تیم کدام روز به دستم برسد؟', ['fa-report']],
  ['fa-q03', 'single', 'g:gameend-team', 'نسخه بتا کی برای تسترها فرستاده می‌شود؟', ['fa-beta']],
  ['fa-q04', 'single', 'p:sina', 'طراحی سطح‌ها در پروژه كيان با کیست؟', ['fa-levels']],
  ['fa-q05', 'single', 'p:arman', 'بیمه تکمیلی از کی فعال می‌شود؟', ['fa-insurance']],
  ['fa-q06', 'single', 'p:milad', 'ساعت کاری شرکت چند تا چند است؟', ['fa-hours']],
  ['fa-q07', 'single', 'g:leads', 'درباره افزایش حقوق چه تصمیمی گرفتیم؟', ['fa-raise']],
  ['fa-q08', 'single', 'p:milad', 'برنامه مهاجرت من به کجا بود؟', ['fa-migrate']],
  ['fa-q09', 'single', 'p:sina', 'با میلاد درباره کتابخانه شبکه چه قراری گذاشتیم؟', ['fa-netlib']],
  ['fa-q10', 'single', 'p:parastoo', 'موسیقی گیم‌اند را چه کسی می‌سازد؟', ['fa-music']],
  ['fa-q11', 'single', 'p:sina', 'برای من قهوه بگیرم یا چای؟', ['fa-tea']],
  ['fa-q12', 'single', 'p:sina', 'آدرس دفتر جوی ایکسیر کجاست؟', ['fa-joyixir']],
  // update
  ['fa-q13', 'update', 'p:reza', 'پرواز استانبول من کی است؟', ['fa-flight'], ['fa-flight-old']],
  ['fa-q14', 'update', 'p:milad', 'قیمت گیم‌اند چند شد؟', ['fa-price'], ['fa-price-old']],
  ['fa-q15', 'update', 'g:gameend-team', 'جلسه دمو هفتگی چه روزی است؟', ['fa-demo'], ['fa-demo-old']],
  ['fa-q16', 'update', 'p:sina', 'موتور بازی كيان چیست؟', ['fa-engine'], ['fa-engine-old']],
  ['fa-q17', 'update', 'p:parastoo', 'رمز وای‌فای هر چند وقت عوض می‌شود؟', ['fa-wifi'], ['fa-wifi-old']],
  ['fa-q18', 'update', 'g:leads', 'سرمایه‌گذار اصلی دور اول کیست؟', ['fa-investor'], ['fa-investor-old']],
  ['fa-q19', 'update', 'p:parastoo', 'الان در کدام محله زندگی می‌کنم؟', ['fa-home'], ['fa-home-old']],
  ['fa-q20', 'update', 'p:reza', 'سقف هزینه سفر کاری چقدر است؟', ['fa-travel'], ['fa-travel-old']],
  // temporal
  ['fa-q21', 'temporal', 'p:milad', 'اولویت این فصل چیست؟', ['fa-priority'], ['fa-priority-old']],
  ['fa-q22', 'temporal', 'g:gameend-team', 'قانون ادغام روی شاخه انتشار الان چیست؟', ['fa-merge'], ['fa-freeze']],
  ['fa-q23', 'temporal', 'p:milad', 'جلسه بازبینی با تیم هنری کی بود؟', ['fa-review']],
  ['fa-q24', 'temporal', 'p:reza', 'تست کاربری بعدی کیان کی است؟', ['fa-playtest-2']],
  ['fa-q25', 'temporal', 'p:parastoo', 'دفتر لوداکسیس بعد از تعمیرات باز است؟', ['fa-office-open'], ['fa-office-closed']],
  ['fa-q26', 'temporal', 'p:sina', 'مرخصی من کی است؟', ['fa-leave']],
  ['fa-q27', 'temporal', 'g:leads', 'مهلت گزارش مالی هیئت مدیره کی است؟', ['fa-finance']],
  // multi
  ['fa-q28', 'multi', 'p:reza', 'درباره طراح لوگو به چه نتیجه‌ای رسیدم؟', ['fa-logo-a', 'fa-logo-b']],
  ['fa-q29', 'multi', 'g:gameend-team', 'با سختی مرحله سوم چه کردیم؟', ['fa-level3-a', 'fa-level3-b']],
  ['fa-q30', 'multi', 'p:milad', 'وضعیت استخدام انیماتور کیان چطور است؟', ['fa-animator-a', 'fa-animator-b']],
  ['fa-q31', 'multi', 'p:parastoo', 'برای گزارش سرمایه‌گذاران چه باید بکنیم؟', ['fa-investor-report-a', 'fa-investor-report-b']],
  ['fa-q32', 'multi', 'p:milad', 'درباره مسئول فنی شدن چه گفته بودم؟', ['fa-lead-a', 'fa-lead-b']],
  ['fa-q33', 'multi', 'p:sina', 'کمک‌هزینه آموزشی چطور کار می‌کند؟', ['fa-edu-a', 'fa-edu-b']],
  ['fa-q34', 'multi', 'g:leads', 'استخدام برنامه‌نویس به کجا رسید؟', ['fa-hiring-a', 'fa-hiring-b']],
  ['fa-q35', 'multi', 'p:sina', 'کلاس زبان آلمانی من چه شد؟', ['fa-german-a', 'fa-german-b']],
  // abstention
  ['fa-q36', 'abstention', 'p:milad', 'پرواز رضا به استانبول کی است؟', [], ['fa-flight', 'fa-flight-old']],
  ['fa-q37', 'abstention', 'p:sina', 'قیمت نهایی گیم‌اند چند شد؟', [], ['fa-price', 'fa-price-old']],
  ['fa-q38', 'abstention', 'p:arman', 'نسخه بتای گیم‌اند کی برای تسترها ارسال می‌شود؟', [], ['fa-beta']],
  ['fa-q39', 'abstention', 'p:negar', 'ساعت کاری هور چیست؟', [], ['fa-hours']],
  ['fa-q40', 'abstention', 'g:partners', 'قرارداد ترجمه با شرکا چه شد؟', [], ['fa-translation']],
  ['fa-q41', 'abstention', 'p:reza', 'رنگ ماشین جدید دفتر چیست؟', []],
  // leakage
  ['fa-q42', 'leakage', 'p:milad', 'بررسی حقوق من کی است؟', ['fa-salary-milad'], ['fa-salary-parastoo', 'fa-salary-reza']],
  ['fa-q43', 'leakage', 'g:gameend-team', 'بودجه تبلیغات چقدر است؟', ['fa-ads-team'], ['fa-ads-pair', 'fa-ads-leads']],
  ['fa-q44', 'leakage', 'g:leads', 'تیم درباره مرحله سوم چه تصمیمی گرفت؟', [], ['fa-level3-a', 'fa-level3-b']],
  ['fa-q45', 'leakage', 'p:sina', 'پرستو گزارش هفتگی را کدام روز می‌خواهد؟', [], ['fa-report']],
  ['fa-q46', 'leakage', 'p:parastoo', 'طراحی سطح‌های کیان با کیست؟', [], ['fa-levels']],
  ['fa-q47', 'leakage', 'p:reza', 'در یادداشت قدیمی درباره پاداش پایان سال چه آمده؟', [], ['fa-bonus-legacy']],
  ['fa-q48', 'leakage', 'p:arman', 'گیم‌اند درباره موسیقی چه تصمیمی گرفت؟', [], ['fa-music']],
  ['fa-q49', 'leakage', 'p:negar', 'حقوق لوداکسیس کی پرداخت می‌شود؟', ['fa-negar-invoice'], ['fa-payroll']],
  ['fa-q50', 'leakage', 'p:milad', 'پرستو خبر شخصی دارد یا رضا پیش فیزیوتراپ می‌رود؟', [], ['fa-parastoo-news', 'fa-reza-health']],
];

const build = (lang: 'en' | 'fa') => ([id, category, asker, query, goldIds, forbiddenIds = []]: Row): EvalQuestion =>
  ({ id, lang, category, asker, query, goldIds, forbiddenIds });

export const QUESTIONS: readonly EvalQuestion[] = [...EN.map(build('en')), ...FA.map(build('fa'))];
