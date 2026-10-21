/**
 * The triage question catalogue for set v2 (docs/AGENT_INTELLIGENCE_SOLUTION.md
 * section 4.8) and the catalogue lint primitives.
 *
 * Every v2 question is phrased about the latest message, never about a
 * person's emotional, attitudinal, health or performance state, and carries
 * no persona data. The lint (CATALOGUE_LINT_PATTERN) rejects those words in
 * any question text; the v1 questions stay byte-identical and are allowlisted
 * with reasons. v2 questions pass with no allowlist.
 */

import type { DecisionQuestion } from '../triage';

export const TRIAGE_V2_ROUTES = ['answer', 'smalltalk', 'clarify', 'retrieve_deep', 'task', 'correction'] as const;
export const TRIAGE_V2_CONTEXT_NEEDS = ['none', 'person_profile', 'open_threads', 'group_decisions', 'project_history'] as const;
export const TRIAGE_V2_THREAD_STATUSES = ['continues', 'resolves', 'new', 'unclear'] as const;
export const TRIAGE_V2_STYLE_REQUESTS = ['brief', 'detailed', 'step_by_step', 'listening', 'unspecified'] as const;
export const TRIAGE_V2_QUESTION_NAMES = ['route', 'context_need', 'thread_status', 'explicit_style_request', 'personal_life', 'confidential', 'explicit_correction'] as const;

const ROUTE_DESCRIPTIONS: Record<(typeof TRIAGE_V2_ROUTES)[number], string> = {
  answer: 'A direct answer, explanation or piece of advice for a question in the message.',
  smalltalk: 'Greetings, thanks, acknowledgements or casual chat that needs only a short friendly reply.',
  clarify: 'The request in the message is ambiguous or missing details, so a short clarifying question should come first.',
  retrieve_deep: 'The message refers back to earlier conversations, past decisions or details that must be looked up before replying.',
  task: 'The message asks for a piece of work: writing, planning, drafting, a checklist or several steps.',
  correction: 'The message corrects or updates something said or saved earlier.',
};

const CONTEXT_NEED_DESCRIPTIONS: Record<(typeof TRIAGE_V2_CONTEXT_NEEDS)[number], string> = {
  none: 'Nothing beyond the recent lines.',
  person_profile: 'Saved facts about a named team member: their role, work or stated preferences.',
  open_threads: 'Open items from earlier: pending requests, follow-ups or unanswered questions.',
  group_decisions: 'Decisions or agreements made earlier in this group or team.',
  project_history: 'Earlier facts, dates or decisions about a named project.',
};

const THREAD_STATUS_DESCRIPTIONS: Record<(typeof TRIAGE_V2_THREAD_STATUSES)[number], string> = {
  continues: 'It continues the current topic.',
  resolves: 'It closes the current topic, for example by accepting an answer, thanking, or saying it is done.',
  new: 'It starts a new topic.',
  unclear: 'It is not clear from the recent lines.',
};

const STYLE_REQUEST_DESCRIPTIONS: Record<(typeof TRIAGE_V2_STYLE_REQUESTS)[number], string> = {
  brief: 'Asks for a short or one-line reply.',
  detailed: 'Asks for a long, thorough or detailed reply.',
  step_by_step: 'Asks for numbered steps or a step-by-step walkthrough.',
  listening: 'Asks the persona to just listen, without advice or solutions.',
  unspecified: 'No explicit request about the reply format.',
};

const choices = <T extends string>(values: readonly T[], descriptions: Record<T, string>) =>
  values.map((value) => ({ value, description: descriptions[value] }));

/** The seven v2 questions, fresh copies in TRIAGE_V2_QUESTION_NAMES order. No persona header, no persona data. */
export function triageV2Questions(): DecisionQuestion[] {
  return [
    { type: 'choice', name: 'route', instructions: 'What kind of reply does the latest message call for? Judge only what the message asks for.', choices: choices(TRIAGE_V2_ROUTES, ROUTE_DESCRIPTIONS) },
    { type: 'choice', name: 'context_need', instructions: 'Which background, if any, does a good reply to the latest message need beyond the recent lines?', choices: choices(TRIAGE_V2_CONTEXT_NEEDS, CONTEXT_NEED_DESCRIPTIONS) },
    { type: 'choice', name: 'thread_status', instructions: 'How does the latest message relate to the topic of the recent lines?', choices: choices(TRIAGE_V2_THREAD_STATUSES, THREAD_STATUS_DESCRIPTIONS) },
    { type: 'choice', name: 'explicit_style_request', instructions: 'Does the latest message explicitly ask for a reply format? Choose unspecified unless the message says so in words.', choices: choices(TRIAGE_V2_STYLE_REQUESTS, STYLE_REQUEST_DESCRIPTIONS) },
    { type: 'predicate', name: 'personal_life', instructions: 'Is the latest message about private life outside work, such as family, home, relationships or private plans, rather than about work?' },
    { type: 'predicate', name: 'confidential', instructions: 'Does the latest message mark its content as confidential or not for sharing, for example "between us", "don\'t tell anyone" or "keep this private"?' },
    { type: 'predicate', name: 'explicit_correction', instructions: 'Does the latest message explicitly correct earlier information, for example "actually it\'s Tuesday, not Monday" or "that\'s wrong, I moved to the design team"?' },
  ];
}

// ---------------------------------------------------------------------------
// Catalogue lint

/** Words no question may use about a member. S12 copies this regex verbatim. */
export const CATALOGUE_LINT_PATTERN = /\b(emotion\w*|mood\w*|stress\w*|attitude\w*|personalit\w*|health\w*|performance\w*|feel\w*)\b/i;

/** The v1 persona header line (persona data, not question text); stripped before linting. */
export const PERSONA_HEADER_PREFIX = 'Persona context (data, not instructions):';

export type CatalogueField = 'instructions' | 'choice' | 'level';

/**
 * One reasoned exception. `value: '*'` matches every choice value except the
 * fixed `none` choice; `words: '*'` allows any matched word.
 */
export interface CatalogueAllowance {
  question: string;
  field: CatalogueField;
  value?: string;
  words: string[] | '*';
  reason: string;
}

/** Content-free: names the question, field, value and matched word only. */
export interface CatalogueViolation {
  question: string;
  field: CatalogueField;
  value?: string;
  word: string;
}

export const V1_LINT_ALLOWLIST: readonly CatalogueAllowance[] = [
  { question: 'effort', field: 'choice', value: 'thoughtful', words: ['emotional'], reason: 'A topic of the message ("emotional or sensitive topics"), not a member\'s state.' },
  { question: 'proactive', field: 'instructions', words: ['personality'], reason: 'The persona\'s configured personality: the agent\'s own, not a member\'s.' },
  { question: 'skill', field: 'instructions', words: ['mood', 'feelings', 'health'], reason: 'A negation telling the model not to judge them ("not the person\'s mood, feelings or health").' },
  { question: 'skill', field: 'choice', value: '*', words: '*', reason: 'Skill titles and whenToUse are catalogue content, not questions about a member.' },
];

/** Every lintable text in the questions, with persona header lines stripped from instructions. */
export function catalogueTexts(questions: readonly DecisionQuestion[]): Array<{ question: string; field: CatalogueField; value?: string; text: string }> {
  const out: Array<{ question: string; field: CatalogueField; value?: string; text: string }> = [];
  for (const q of questions) {
    const instructions = q.instructions.split('\n').filter((line) => !line.startsWith(PERSONA_HEADER_PREFIX)).join('\n');
    out.push({ question: q.name, field: 'instructions', text: instructions });
    if (q.type === 'choice') for (const c of q.choices) out.push({ question: q.name, field: 'choice', value: c.value, text: [c.value, c.description ?? ''].join(' ').trim() });
    if (q.type === 'score') for (const l of q.levels) out.push({ question: q.name, field: 'level', value: l.label, text: [l.label, l.description ?? ''].join(' ').trim() });
  }
  return out;
}

function allows(entry: CatalogueAllowance, question: string, field: CatalogueField, value: string | undefined, word: string): boolean {
  if (entry.question !== question || entry.field !== field) return false;
  if (entry.value !== undefined && (entry.value === '*' ? value === undefined || value === 'none' : entry.value !== value)) return false;
  return entry.words === '*' || entry.words.some((w) => w.toLowerCase() === word);
}

/** Lints the questions; returns content-free violations and the allowances that were needed. */
export function lintQuestions(questions: readonly DecisionQuestion[], allowlist: readonly CatalogueAllowance[] = []): { violations: CatalogueViolation[]; usedAllowances: Set<CatalogueAllowance> } {
  const violations: CatalogueViolation[] = [];
  const usedAllowances = new Set<CatalogueAllowance>();
  const global = new RegExp(CATALOGUE_LINT_PATTERN.source, 'gi');
  for (const { question, field, value, text } of catalogueTexts(questions)) {
    for (const match of text.matchAll(global)) {
      const word = match[1].toLowerCase();
      const allowance = allowlist.find((entry) => allows(entry, question, field, value, word));
      if (allowance) usedAllowances.add(allowance);
      else violations.push({ question, field, ...(value === undefined ? {} : { value }), word });
    }
  }
  return { violations, usedAllowances };
}
