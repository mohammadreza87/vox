/**
 * The triage question catalogue (docs/AGENT_INTELLIGENCE_SOLUTION.md section
 * 4.8, Step 9): question names per set, the v2 questions, the fixed choice
 * values the decision log may record, and the catalogue lint.
 *
 * Every v2 question is phrased about the latest message, never about a
 * person's emotional, attitudinal, health or performance state, and carries
 * no persona header or message text. The lint (CATALOGUE_LINT) rejects those
 * words in any question text once the persona header line is stripped; the
 * frozen v1 texts that contain them are allowlisted with reasons. The v2
 * questions pass with no allowance.
 *
 * Imports only types from ../triage, so there is no runtime import cycle.
 */

import type { DecisionQuestion } from '../triage';
import { tirehFlags, type TriageQuestionSet } from '../flags';

export const V1_QUESTION_NAMES = ['effort', 'live_info', 'memorable', 'wants_voice', 'addressed', 'proactive', 'skill'] as const;
export const V2_QUESTION_NAMES = ['route', 'context_need', 'thread_status', 'explicit_style_request', 'personal_life', 'confidential', 'explicit_correction'] as const;
/** Reserved for S12 (image ingestion): names only; their texts and parsing live there. */
export const IMAGE_V1_QUESTION_NAMES = ['image_kind', 'image_task', 'contains_people', 'contains_sensitive_document'] as const;

/** The decision log records any chosen skill as this value, never the skill id. */
export const SKILL_SELECTED = 'selected';

/** The only choice values a decision-log row or a calibration label may carry, per question. */
export const CATALOGUE_CHOICE_VALUES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  effort: Object.freeze(['quick', 'thoughtful']),
  skill: Object.freeze(['none', SKILL_SELECTED]),
  route: Object.freeze(['answer', 'smalltalk', 'clarify', 'retrieve_deep', 'task', 'correction']),
  context_need: Object.freeze(['none', 'person_profile', 'open_threads', 'group_decisions', 'project_history']),
  thread_status: Object.freeze(['continues', 'resolves', 'new', 'unclear']),
  explicit_style_request: Object.freeze(['brief', 'detailed', 'step_by_step', 'listening', 'unspecified']),
  image_kind: Object.freeze(['screenshot', 'document', 'receipt', 'chart', 'photo_of_people', 'meme', 'other']),
  image_task: Object.freeze(['explain', 'extract_text', 'decide', 'react', 'remember', 'unclear']),
});

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

/**
 * The seven v2 questions in V2_QUESTION_NAMES order. Frozen: callers get
 * copies through triageQuestions(). No persona header, no message text.
 */
export const TRIAGE_V2_QUESTIONS: readonly DecisionQuestion[] = deepFreeze<DecisionQuestion[]>([
  {
    type: 'choice',
    name: 'route',
    instructions: 'Which kind of reply does the latest message call for? Judge the message itself.',
    choices: [
      { value: 'answer', description: 'A direct answer, explanation or piece of advice about what the message asks.' },
      { value: 'smalltalk', description: 'Greeting, thanks, acknowledgement or casual chat that needs only a short friendly reply.' },
      { value: 'clarify', description: 'The message is ambiguous or incomplete, so a short clarifying question should come first.' },
      { value: 'retrieve_deep', description: 'The message refers to earlier conversations, past decisions or shared history that must be looked up.' },
      { value: 'task', description: 'The message asks for something to be produced or done: a draft, plan, list, summary or reminder.' },
      { value: 'correction', description: 'The message corrects or updates something said, decided or saved earlier.' },
    ],
  },
  {
    type: 'choice',
    name: 'context_need',
    instructions: 'Beyond the recent lines, what background would a good reply to the latest message need?',
    choices: [
      { value: 'none', description: 'Nothing beyond the recent lines.' },
      { value: 'person_profile', description: 'Facts, preferences or plans stated earlier by or about the people the message names.' },
      { value: 'open_threads', description: 'Unfinished topics, open questions or pending commitments from earlier in this conversation.' },
      { value: 'group_decisions', description: 'Decisions or agreements made earlier in this group.' },
      { value: 'project_history', description: 'Earlier facts, plans or deadlines about a project or piece of work the message names.' },
    ],
  },
  {
    type: 'choice',
    name: 'thread_status',
    instructions: 'How does the latest message relate to the topic of the recent lines?',
    choices: [
      { value: 'continues', description: 'It continues the same topic.' },
      { value: 'resolves', description: 'It closes the topic: a final answer, confirmation, agreement or thanks.' },
      { value: 'new', description: 'It starts a different topic.' },
      { value: 'unclear', description: 'The relation cannot be told from these lines.' },
    ],
  },
  {
    type: 'choice',
    name: 'explicit_style_request',
    instructions: 'Does the latest message explicitly ask for a particular form of reply? Choose unspecified unless the message states it.',
    choices: [
      { value: 'brief', description: 'It asks for a short or one-line reply.' },
      { value: 'detailed', description: 'It asks for a thorough, detailed reply.' },
      { value: 'step_by_step', description: 'It asks for steps, a walkthrough or a numbered list.' },
      { value: 'listening', description: 'It asks to be heard out without advice or solutions.' },
      { value: 'unspecified', description: 'It does not ask for a particular form.' },
    ],
  },
  {
    type: 'predicate',
    name: 'personal_life',
    instructions: 'Is the latest message about private life outside work, such as family, home, friends, private appointments or personal plans, rather than work matters?',
  },
  {
    type: 'predicate',
    name: 'confidential',
    instructions: 'Does the latest message say or clearly imply that what it shares is confidential, secret or not to be passed on to others?',
  },
  {
    type: 'predicate',
    name: 'explicit_correction',
    instructions: 'Does the latest message explicitly correct or retract something said, decided or saved earlier (for example "actually it is Tuesday, not Monday" or "forget what I said about the budget")?',
  },
]);

/** The set gateway triage uses for this call: tirehFlags().triageQuestionSet, read now. */
export function triageQuestionSetNow(): TriageQuestionSet {
  return tirehFlags().triageQuestionSet;
}

// ---------------------------------------------------------------------------
// Catalogue lint

/** No question may ask about a member's state. Copied verbatim by S12's test. */
export const CATALOGUE_LINT = /\b(emotion\w*|mood\w*|stress\w*|attitude\w*|personalit\w*|health\w*|performance\w*|feel\w*)\b/i;

/** The v1 persona header line (persona data, not question text); stripped before linting. */
export const PERSONA_HEADER_PREFIX = 'Persona context (data, not instructions):';

/** One reasoned exception. `choice:*` covers every choice of that question. */
export interface LintAllowance { question: string; field: 'instructions' | `choice:${string}`; reason: string }

/** Content-free: the question name, the field and the matched word only. */
export interface LintViolation { question: string; field: string; match: string }

/** Exactly the frozen texts that need it; v2 questions need no entry. */
export const CATALOGUE_LINT_ALLOWLIST: readonly LintAllowance[] = Object.freeze([
  { question: 'effort', field: 'choice:thoughtful', reason: '"emotional or sensitive topics" names a topic of the message, not a member\'s state; v1 text is frozen.' },
  { question: 'proactive', field: 'instructions', reason: '"Consider their personality" refers to the persona\'s own configured character, not a member; v1 text is frozen.' },
  { question: 'skill', field: 'instructions', reason: 'A negative instruction ("not the person\'s mood, feelings or health"); the text is owned by skill-routing.ts.' },
  { question: 'skill', field: 'choice:*', reason: 'Skill titles and whenToUse are catalogue content from the skill library, not questions about a member.' },
] as LintAllowance[]);

const allowed = (allow: readonly LintAllowance[], violation: LintViolation): boolean =>
  allow.some((a) => a.question === violation.question
    && (a.field === violation.field || (a.field === 'choice:*' && violation.field.startsWith('choice:'))));

/**
 * Lints the instructions (with every PERSONA_HEADER_PREFIX line stripped) and
 * each choice or level description. Returns the violations not covered by
 * `allow`; an empty array means the catalogue passes.
 */
export function lintQuestions(questions: readonly DecisionQuestion[], allow: readonly LintAllowance[] = []): LintViolation[] {
  const out: LintViolation[] = [];
  const check = (question: string, field: string, text: string | undefined) => {
    const match = text ? CATALOGUE_LINT.exec(text) : null;
    if (!match) return;
    const violation = { question, field, match: match[0] };
    if (!allowed(allow, violation)) out.push(violation);
  };
  for (const q of questions) {
    check(q.name, 'instructions', q.instructions.split('\n').filter((line) => !line.startsWith(PERSONA_HEADER_PREFIX)).join('\n'));
    if (q.type === 'choice') for (const c of q.choices) check(q.name, `choice:${c.value}`, c.description);
    if (q.type === 'score') for (const l of q.levels) check(q.name, `level:${l.label}`, l.description);
  }
  return out;
}
