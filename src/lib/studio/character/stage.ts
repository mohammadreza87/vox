import type { AgentStatus, Stage } from '../types';

/**
 * Stage of the progressive face from the forming day (1–7). Drafts and
 * agents waiting on Telegram show the fully formed target.
 * Thresholds live here only (PLAN D7): day 1 / 2–3 / 4–5 / 6–7, so the full
 * face lives at least two days before the lock; stage-ups land on days 2, 4, 6.
 */
export function stageFor(formingDay: number | null, status: AgentStatus | string): Stage {
  if (status === 'draft' || status === 'awaiting_bot') return 4;
  if (formingDay === null) return 4;
  return formingDay <= 1 ? 1 : formingDay <= 3 ? 2 : formingDay <= 5 ? 3 : 4;
}

export type StagePart = 'species' | 'hair' | 'accessory' | 'cheeks' | 'lashes' | 'brows' | 'mouth' | 'highlight2';

/** Which parts of the character exist at each stage (character §7). */
export const STAGE_PARTS: Record<Stage, ReadonlyArray<StagePart>> = {
  1: [],
  2: ['species', 'mouth', 'cheeks'],
  3: ['species', 'mouth', 'cheeks', 'lashes', 'brows', 'hair'],
  4: ['species', 'mouth', 'cheeks', 'lashes', 'brows', 'hair', 'accessory', 'highlight2'],
};

export const hasPart = (stage: Stage | 5, part: StagePart) => STAGE_PARTS[Math.min(stage, 4) as Stage].includes(part);
