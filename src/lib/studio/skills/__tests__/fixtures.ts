/**
 * A small fixture skill library for routing, service and HTTP tests. Tests
 * must never depend on the shipped pack content, which changes independently.
 */

import type { Hue } from '../../types';
import { assembleCatalog, type Catalog } from '../catalog';
import type { AgentRole, AgentSkill, PackId, PackModule, SkillPack, SkillSpace } from '../types';

export function fixtureSkill(id: string, title: string, summary: string, extra: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id, title, summary,
    whenToUse: `Use when the work calls for ${title.toLowerCase()}.`,
    method: ['Frame the goal in one line.', 'Do the work in small, checked steps.', 'Write down what changed and why.'],
    qualityBar: ['Every claim has a number or a source.', 'The owner and the date are explicit.', 'It fits on one screen.'],
    pitfalls: ['Skipping the baseline.', 'Changing two things at once.'],
    frameworks: [],
    sources: [{ name: 'Fixture source', url: 'https://example.com/fixture' }],
    ...extra,
  };
}

export function fixtureRole(
  id: string, space: SkillSpace, title: string, summary: string,
  skills: string[], optionalSkills: string[], keywords: string[], hue: Hue, extra: Partial<AgentRole> = {},
): AgentRole {
  return {
    id, pack: id.split('.')[0] as PackId, space, title, summary,
    mission: `Accountable for great ${title.toLowerCase()} work.`,
    knowledge: ['First knowledge area', 'Second knowledge area', 'Third knowledge area'],
    pointOfView: ['Small steps beat big plans.', 'Measure before you change anything.'],
    voice: 'Calm, specific and brief.',
    boundaries: 'Defers big calls to the people who own them.',
    skills, optionalSkills,
    starters: ['Ask me where to start', 'Ask me what to measure', 'Ask me what to drop'],
    hue,
    traits: { warmDirect: 50, playfulSerious: 50, conciseExpansive: 50 },
    keywords,
    ...extra,
  };
}

export const coreModule: PackModule = {
  roles: [],
  skills: [
    fixtureSkill('core.decision-memo', 'Decision memo', 'One page that records a decision, options and why.'),
    fixtureSkill('core.weekly-review', 'Weekly review', 'A short weekly look back at progress and what is next.'),
    fixtureSkill('core.goal-setting', 'Goal setting', 'Clear, measurable goals with a date.'),
  ],
};

export const lifestyleModule: PackModule = {
  pack: {
    id: 'lifestyle', space: 'personal', title: 'Lifestyle', tagline: 'Coaches and helpers for your own life.',
    roles: ['lifestyle.running-coach', 'lifestyle.life-coach', 'lifestyle.math-tutor'],
    fa: { title: 'سبک زندگی', tagline: 'مربی‌ها و همراه‌هایی برای زندگی شخصی شما.' },
  },
  roles: [
    fixtureRole('lifestyle.running-coach', 'personal', 'Running Coach', 'Plans your runs and keeps you injury free.',
      ['run.training-plan', 'run.injury-prevention', 'core.weekly-review'], ['run.race-day'],
      ['running', 'runner', 'marathon', 'half marathon', '5k', 'jogging', 'دویدن', 'دونده', 'ماراتن'], 'apricot',
      { fa: { title: 'مربی دویدن', summary: 'برنامهٔ دویدن شما را می‌چیند.' } }),
    fixtureRole('lifestyle.life-coach', 'personal', 'Life Coach', 'Keeps you honest about the goals you set.',
      ['core.goal-setting', 'core.weekly-review', 'life.habit-tracker'], [],
      ['coach', 'habits', 'accountability', 'honest', 'motivation', 'goals', 'مربی زندگی', 'عادت'], 'rose',
      { fa: { title: 'مربی زندگی', summary: 'شما را به هدف‌هایتان پایبند نگه می‌دارد.' } }),
    fixtureRole('lifestyle.math-tutor', 'personal', 'Math Tutor', 'Patient help with maths homework and exams.',
      ['tutor.lesson-plan', 'tutor.practice-sets', 'core.weekly-review'], ['tutor.exam-prep'],
      ['tutor', 'math', 'maths', 'homework', 'algebra', 'geometry', 'ریاضی', 'معلم ریاضی', 'تکلیف'], 'butter',
      { fa: { title: 'معلم ریاضی', summary: 'کمک صبورانه در ریاضی.' } }),
  ],
  skills: [
    fixtureSkill('run.training-plan', 'Training plan', 'A week-by-week running plan built around your races.'),
    fixtureSkill('run.injury-prevention', 'Injury prevention', 'Load, rest and strength work that keeps you running.'),
    fixtureSkill('run.race-day', 'Race day plan', 'Pacing, fuel and warm-up for race day.'),
    fixtureSkill('life.habit-tracker', 'Habit tracker', 'Small daily habits, tracked without guilt.'),
    fixtureSkill('tutor.lesson-plan', 'Lesson plan', 'One topic at a time, from example to practice.'),
    fixtureSkill('tutor.practice-sets', 'Practice sets', 'Short graded exercises with worked answers.'),
    fixtureSkill('tutor.exam-prep', 'Exam prep', 'A revision schedule and mock questions before an exam.'),
  ],
};

export const mobileModule: PackModule = {
  pack: {
    id: 'mobile', space: 'work', title: 'Mobile company', tagline: 'Growth and store roles for mobile apps and games.',
    roles: ['mobile.ua-manager', 'mobile.aso-specialist'],
  },
  roles: [
    fixtureRole('mobile.ua-manager', 'work', 'UA Manager', 'Buys installs that pay back.',
      ['ua.campaign-plan', 'ua.creative-testing', 'ua.roas-model', 'core.weekly-review'], ['ua.geo-launch', 'ua.budget-pacing', 'core.decision-memo'],
      ['ua', 'user acquisition', 'paid ads', 'installs', 'roas', 'cpi', 'launch', 'جذب کاربر', 'تبلیغات'], 'lagoon',
      { fa: { title: 'مدیر جذب کاربر', summary: 'نصب‌هایی می‌خرد که برگشت دارند.' } }),
    fixtureRole('mobile.aso-specialist', 'work', 'ASO Specialist', 'Gets the store page found and installed.',
      ['aso.listing-audit', 'aso.keyword-research', 'aso.screenshot-testing'], [],
      ['aso', 'app store optimization', 'store listing', 'store page', 'screenshots', 'ratings'], 'sky'),
  ],
  skills: [
    fixtureSkill('ua.campaign-plan', 'Campaign plan', 'Channels, budgets and targets for a paid launch.'),
    fixtureSkill('ua.creative-testing', 'Creative testing', 'A steady pipeline of ad creatives with clean tests.'),
    fixtureSkill('ua.roas-model', 'ROAS modelling', 'Predicts payback from early cohort revenue.'),
    fixtureSkill('ua.geo-launch', 'Geo launch plans', 'Country-by-country launch order, budgets and benchmarks.'),
    fixtureSkill('ua.budget-pacing', 'Budget pacing', 'Daily spend kept on plan across networks.'),
    fixtureSkill('aso.listing-audit', 'Listing audit', 'A store page review against the category leaders.'),
    fixtureSkill('aso.keyword-research', 'Keyword research', 'Store search terms worth ranking for.'),
    fixtureSkill('aso.screenshot-testing', 'Screenshot testing', 'Store screenshots tested one change at a time.'),
  ],
};

export const publisherModule: PackModule = {
  pack: {
    id: 'publisher', space: 'work', title: 'Publisher', tagline: 'Taking games from soft launch to scale.',
    roles: ['publisher.publishing-producer'],
  },
  roles: [
    fixtureRole('publisher.publishing-producer', 'work', 'Publishing Producer', 'Takes a game from soft launch to global.',
      ['pub.soft-launch', 'pub.milestone-plan', 'pub.kpi-review'], [],
      ['publishing', 'soft launch', 'puzzle', 'game launch', 'publisher', 'milestones', 'ناشر', 'انتشار بازی'], 'lilac'),
  ],
  skills: [
    fixtureSkill('pub.soft-launch', 'Soft launch', 'Test markets, gates and what to learn before scaling.'),
    fixtureSkill('pub.milestone-plan', 'Milestone plan', 'Milestones a studio and publisher both sign.'),
    fixtureSkill('pub.kpi-review', 'KPI review', 'Retention, monetisation and payback read every week.'),
  ],
};

export const techModule: PackModule = {
  pack: {
    id: 'tech', space: 'work', title: 'Tech company', tagline: 'Product and engineering roles for software teams.',
    roles: ['tech.product-manager', 'tech.delivery-lead'],
  },
  roles: [
    fixtureRole('tech.product-manager', 'work', 'Product Manager', 'Decides what to build next, and why.',
      ['pm.prd', 'pm.prioritization', 'core.decision-memo'], ['pm.roadmap'],
      ['product manager', 'product lead', 'roadmap', 'prioritization', 'prd', 'product decisions', 'مدیر محصول'], 'matcha'),
    fixtureRole('tech.delivery-lead', 'work', 'Delivery Lead', 'Keeps the team on track and on time.',
      ['delivery.sprint-plan', 'delivery.risk-log', 'core.weekly-review'], [],
      ['deadlines', 'delivery', 'sprint', 'standup', 'on track', 'coach', 'تحویل', 'ددلاین'], 'ash'),
  ],
  skills: [
    fixtureSkill('pm.prd', 'PRD', 'A one-page product requirements document.'),
    fixtureSkill('pm.prioritization', 'Prioritization', 'Ranked bets with reach, impact and effort.'),
    fixtureSkill('pm.roadmap', 'Roadmap', 'Now, next and later, with the reasons.'),
    fixtureSkill('delivery.sprint-plan', 'Sprint plan', 'Two weeks of work the team believes in.'),
    fixtureSkill('delivery.risk-log', 'Risk log', 'Risks with owners and the next step for each.'),
  ],
};

export const FIXTURE_MODULES: PackModule[] = [coreModule, lifestyleModule, mobileModule, publisherModule, techModule];

/** A fresh, valid fixture catalog. */
export function fixtureCatalog(modules: PackModule[] = FIXTURE_MODULES): Catalog {
  return assembleCatalog(modules);
}

/** A pack with more roles than one Decisions question may offer (16 + none > 16 choices). */
export function crowdedCatalog(): Catalog {
  const roles = Array.from({ length: 16 }, (_, i) => fixtureRole(
    `tech.role-${i + 1}`, 'work', `Role ${i + 1}`, `Fixture role number ${i + 1}.`,
    ['core.decision-memo', 'core.weekly-review', 'core.goal-setting'], [],
    [`alpha${i + 1}`, `beta${i + 1}`, `gamma${i + 1}`, `delta${i + 1}`, `epsilon${i + 1}`, `zeta${i + 1}`], 'ash',
  ));
  const pack: SkillPack = { id: 'tech', space: 'work', title: 'Tech company', tagline: 'Many roles.', roles: roles.map((r) => r.id) };
  return assembleCatalog([coreModule, { pack, roles, skills: [] }]);
}
