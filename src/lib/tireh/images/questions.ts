/**
 * Image triage questions (question set `image-v1`). They ask about the image
 * and the request, never about a person's state, and they never identify
 * anyone: `contains_people` is only a retention signal.
 */

import type { DecisionAnswer, DecisionQuestion } from '../triage';
import type { Persona } from '../types';

export const IMAGE_QUESTION_SET = 'image-v1' as const;
/** Below this choice confidence the task is treated as unclear. */
export const IMAGE_TASK_MIN_CONFIDENCE = 0.5;
/**
 * A 'remember' task widens memory formation, so it needs more: below this confidence it reads as 'unclear'
 * (main's IMAGE_REMEMBER_CONFIDENCE, kept from the lineage the merge replaced).
 */
export const IMAGE_REMEMBER_CONFIDENCE = 0.6;

export const IMAGE_KINDS = ['screenshot', 'document', 'receipt', 'chart', 'photo_of_people', 'meme', 'other'] as const;
export const IMAGE_TASKS = ['explain', 'extract_text', 'decide', 'react', 'remember', 'unclear'] as const;

export interface ImageTriage {
  kind: typeof IMAGE_KINDS[number];
  task: typeof IMAGE_TASKS[number];
  /** Probability in [0,1]; a retention signal only, never identity. */
  containsPeople: number;
  /** Probability in [0,1]; >= 0.5 means the image is never stored. */
  containsSensitiveDocument: number;
}

export const IMAGE_TRIAGE_QUESTIONS: readonly DecisionQuestion[] = Object.freeze([
  {
    type: 'choice',
    name: 'image_kind',
    instructions: 'What kind of image was shared?',
    choices: [
      { value: 'screenshot', description: 'A screenshot of an app, website or device screen' },
      { value: 'document', description: 'A photo or scan of a page, letter, form or card' },
      { value: 'receipt', description: 'A receipt, invoice or bill' },
      { value: 'chart', description: 'A chart, graph, table or diagram' },
      { value: 'photo_of_people', description: 'A photo whose main subject is one or more people' },
      { value: 'meme', description: 'A meme or joke picture' },
      { value: 'other', description: 'Anything else' },
    ],
  },
  {
    type: 'choice',
    name: 'image_task',
    instructions: 'Judging by the caption and the image, what does the sender want done with it?',
    choices: [
      { value: 'explain', description: 'Explain or describe what it shows' },
      { value: 'extract_text', description: 'Read out, copy or translate the text in it' },
      { value: 'decide', description: 'Help choose or decide something based on it' },
      { value: 'react', description: 'Just sharing it; a short natural reply is enough' },
      { value: 'remember', description: 'Keep it or its details for later' },
      { value: 'unclear', description: 'Not clear from the message' },
    ],
  },
  {
    type: 'predicate',
    name: 'contains_people',
    instructions: 'Does the image show one or more people, including faces or bodies?',
  },
  {
    type: 'predicate',
    name: 'contains_sensitive_document',
    instructions: 'Does the image show an identity document, a bank or payment card, an account statement, a medical record, a password, an access code or a similar private record?',
  },
] satisfies DecisionQuestion[]);

/** The only text sent with the image: the persona name and the caption. Never memories, history or profiles. */
export function imageTriageInput(persona: Persona, caption: string): string {
  return `Image shared with ${persona.name} in a private chat.\nCaption: ${caption.trim() || '(none)'}`;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function readImageTriage(answers: Record<string, DecisionAnswer>): ImageTriage | null {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return null;
  const kind = answers.image_kind, task = answers.image_task;
  const people = answers.contains_people, sensitive = answers.contains_sensitive_document;
  if (task?.type !== 'choice' || typeof task.choice !== 'string' || !finite(task.confidence)) return null;
  if (people?.type !== 'predicate' || !finite(people.probability)) return null;
  if (sensitive?.type !== 'predicate' || !finite(sensitive.probability)) return null;
  const kindValue = kind?.type === 'choice' && (IMAGE_KINDS as readonly string[]).includes(kind.choice)
    ? kind.choice as ImageTriage['kind'] : 'other';
  const minConfidence = task.choice === 'remember' ? IMAGE_REMEMBER_CONFIDENCE : IMAGE_TASK_MIN_CONFIDENCE;
  const taskValue = (IMAGE_TASKS as readonly string[]).includes(task.choice) && task.confidence >= minConfidence
    ? task.choice as ImageTriage['task'] : 'unclear';
  return { kind: kindValue, task: taskValue, containsPeople: clamp(people.probability), containsSensitiveDocument: clamp(sensitive.probability) };
}
