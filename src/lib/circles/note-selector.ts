/**
 * What gets saved (GROUP_AGENTS_SPEC R2 decision 3): the NoteSelector seam. `explicit` (the default)
 * proposes a note only for an explicit "remember this" / «یادت باشه», detected deterministically, with
 * no model call; the asker then confirms with one tap. `decisions` is a placeholder, disabled:
 * STUDIO_NOTE_SELECTOR=decisions proposes nothing. Read per use (runtime.ts).
 */

export type NoteSelectorKind = 'explicit' | 'decisions';
export const parseNoteSelector = (value?: string): NoteSelectorKind => value?.trim().toLowerCase() === 'decisions' ? 'decisions' : 'explicit';

export interface NoteRequest {
  text: string;
  chatKind: 'private' | 'group';
  /** The agent's name and @username: a leading address ("Cookie, remember …") is not part of the note. */
  names: readonly string[];
  /** The replied-to message's text: "remember this" as a reply saves that message. */
  replied?: string;
}
/** forUs: "remember for us" / «برای ما»; in a group every save is for the group either way. */
export interface NoteSelection { text: string; forUs: boolean }

export interface NoteSelector {
  readonly kind: NoteSelectorKind;
  /** null: nothing to save. */
  select(request: NoteRequest): NoteSelection | null;
}

/** Negatives and "you don't have to" forms, anywhere: never a save. */
const NEGATIVE = /(?:do not|don't|don’t|never|no need to|not)\s+(?:remember|save)|(?:do not|don't|don’t)\s+(?:want|need|have)\s+(?:you\s+)?to\s+remember|یادت نباشه|یادت نمونه|یادت نماند|به خاطر نسپار|ذخیره نکن/iu;
/** English must open the message (after an optional address): "remember" plus an explicit save marker. */
const EN_OPEN = /^(?:(?:hey|hi|ok|okay)[\s,]+)?(?:please\s+)?(?:(?:can|could|would|will) you\s+)?(?:please\s+)?remember\b/iu;
const SEP = '\\s*(?:[:：,،\\-–—]\\s*)?';
/** "remember for us: …" / "remember this: …" / "remember: …" (a bare "remember this" saves the replied-to message). */
const EN_MARKER = new RegExp(`^\\s*(?:(for us|for me|for both of us|for the two of us)${SEP}(?:that\\s+)?|(?:this|that)(?:\\s+(for us|for me))?(?:\\s*[:：,،\\-–—]\\s*|\\s*$)|\\s*[:：]\\s*)`, 'iu');
/** "remember that <clause>": a clause opens with a subject (pronoun, determiner, name or number); "remember that trip we planned" does not. */
const EN_CLAUSE = /^\s*that\s+(?=(?:i|i'm|i'll|we|we're|we'll|you|you're|he|he's|she|she's|it|it's|they|they're|there|there's|the|my|our|your|his|her|their|its|a|an|this|these|those)\s|\p{Lu}|\d)/u;
/** "…, remember this" as its own clause: after punctuation, never a subject ("I'll remember that", "I can't remember that"). */
const EN_TAIL = /[,،;.!:\-–—]\s*(?:(?:so|and|ok|okay)\s+)?(?:please\s+)?remember (?:this|that)( for us| for me| for both of us)?\s*[.!]*$/iu;
const FA_TRIGGER = '(?:یادت (?:باشه|باشد|بمونه|بماند|نره|نرود)|به خاطر بسپار|یادداشت کن)';
const FA_PREFIX = '(?:(?:برای ما|برامون|برای هر دومون)\\s+)?(?:(?:اینو|این را|این رو)\\s+)?';
/** Persian opens the message or is the whole last clause; never mid-sentence («گفتی یادت باشه زنگ بزنم ولی یادت رفت»). */
const FA_LEAD = new RegExp(`^${FA_PREFIX}${FA_TRIGGER}(?=$|[\\s:：,،.!\\-–—])`, 'u');
const FA_TAIL = new RegExp(`(?:^|[\\s,،:.!\\-–—]+)${FA_PREFIX}${FA_TRIGGER}[\\s.!]*$`, 'u');
/** Reported speech before a tail («دیروز گفتی یادت باشه») and recall questions without a mark («یادت باشه دیروز چی گفتم»). */
const FA_REPORTED = /(?:گفتی|گفتم|گفت|گفته|گفتید|گفتین|بگو|نگفتم|نگفتی)\s*$/u;
const FA_QUESTION = /(?:^|[\s،,])(?:چی|چیه|چه|کی|کجا|چرا|چطور|چطوری|چجوری|کدوم|کدام|آیا)(?=$|[\s،,])/u;
const FA_US = /برای ما|برامون|برای هر دومون/u;
const trimText = (value: string) => value.replace(/^[\s:：,،\-–—«"']+|[\s:：,،\-–—»"'.!]+$/gu, '').replace(/^که\s+/u, '').trim();

function stripAddress(text: string, names: readonly string[]): string {
  let value = text.trim().replace(/^@[A-Za-z0-9_]+[\s,،:]*/u, '');
  for (const name of names.filter(Boolean)) {
    const lead = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[\\s,،:!]+|$)`, 'iu');
    if (lead.test(value)) { value = value.replace(lead, ''); break; }
  }
  return value.trim();
}

function english(said: string): { rest: string; forUs: boolean } | null {
  const open = EN_OPEN.exec(said);
  if (open) {
    const after = said.slice(open[0].length), marker = EN_MARKER.exec(after);
    if (marker) return { rest: after.slice(marker[0].length), forUs: /us|both|two/i.test(marker[1] ?? marker[2] ?? '') };
    const clause = EN_CLAUSE.exec(after);
    return clause ? { rest: after.slice(clause[0].length), forUs: false } : null;
  }
  const tail = EN_TAIL.exec(said);
  return tail ? { rest: said.slice(0, tail.index), forUs: / for us| for both/i.test(tail[1] ?? '') } : null;
}

function persian(said: string, names: readonly string[]): { rest: string; forUs: boolean } | null {
  const lead = FA_LEAD.exec(said), tail = lead ? null : FA_TAIL.exec(said);
  if (!lead && !tail) return null;
  const before = tail ? said.slice(0, tail.index) : '';
  if (tail && FA_REPORTED.test(before)) return null;
  const rest = lead ? said.slice(lead[0].length) : stripAddress(before, names);
  return FA_QUESTION.test(rest) ? null : { rest, forUs: FA_US.test(said) };
}

/**
 * The explicit remember intent, deterministic. English must open the message (after an optional
 * address) with an explicit marker ("remember for us: …", "remember this: …", "remember that <clause>"),
 * or end it as its own clause ("…, remember this"); Persian must open it or be its whole last clause
 * («یادت باشه …», «… برای ما یادت باشه», «یادت نره …»). Questions, recall forms ("remember when …"),
 * negatives and someone else's remembering ("I'll remember that") never count. With no text of its own,
 * a reply saves the replied-to message.
 */
export function parseRememberIntent(request: NoteRequest): NoteSelection | null {
  const said = stripAddress(request.text, request.names);
  if (!said || /[?؟]\s*$/u.test(said) || NEGATIVE.test(said)) return null;
  const found = english(said) ?? persian(said, request.names);
  if (!found) return null;
  const text = trimText(found.rest) || trimText(request.replied ?? '');
  return text ? { text, forUs: found.forUs } : null;
}

export const explicitSelector: NoteSelector = { kind: 'explicit', select: parseRememberIntent };

/**
 * TODO(circles-decisions): use the OpenAI decisions API to decide what to save, for whom and for which
 * bot (R2 decision 3), behind its own review. Until then it is disabled: it never proposes.
 */
export const decisionsSelector: NoteSelector = {
  kind: 'decisions',
  select() { throw new Error('note_selector_unavailable'); },
};

export const noteSelectorFor = (kind: NoteSelectorKind): NoteSelector => kind === 'decisions' ? decisionsSelector : explicitSelector;
