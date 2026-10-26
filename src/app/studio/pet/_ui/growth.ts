/**
 * Growth moments and Life Book pages on the page (design §4.7, §4.11): which moments just lit, the why line for a lit
 * moment or a book page, and the unlit `taught` moment a "remember this" save most likely taught. Pure.
 */

import type { BookMomentId } from '@/lib/pet/play';
import type { LitDetails, PetGrowthMoment, PetGrowthView } from './contract';
import type { PetStringKey } from './strings';

/** Lit in this person's view: lit for the whole agent, or only for them (`mine`: first room visits, their own grants and teaching). */
export const isLit = (m: PetGrowthMoment, g: PetGrowthView | undefined) => !!m.lit || !!g?.mine?.includes(m.id);
export const litIds = (g: PetGrowthView | undefined): Set<string> => new Set((g?.moments ?? []).filter((m) => isLit(m, g)).map((m) => m.id));

/** Moments lit in `next` that were not lit in `prev`. The first view of a session lights nothing (it is not news). */
export function newlyLit(prev: PetGrowthView | undefined | null, next: PetGrowthView | undefined): PetGrowthMoment[] {
  if (!prev || !next) return [];
  const was = litIds(prev);
  return next.moments.filter((m) => isLit(m, next) && !was.has(m.id));
}

/** The part a moment lights (§10.3), as lightMoment and the `litPeak` cue name it. */
export function detailOf(m: PetGrowthMoment): { detail: 'glint' | 'pin' | 'charm' | 'keepsake' | 'seasonal'; id?: string } {
  switch (m.kind) {
    case 'taught': return { detail: 'glint' };
    case 'task': return { detail: 'pin' };
    case 'access': return { detail: 'charm' };
    case 'room': return { detail: 'keepsake', id: m.id.replace(/^room-/, '') };
    default: return { detail: 'seasonal', id: m.id.replace(/^season-/, '') };
  }
}

/** What the lit moments draw on the character (§10.3): kinds to parts; room keepsakes (by room) oldest first, the latest season. */
export function detailsOf(g: PetGrowthView | undefined): LitDetails {
  // personal moments carry no date in the view: they keep the view's order after the agent-wide ones
  const lit = (g?.moments ?? []).filter((m) => isLit(m, g)).sort((a, b) => (a.lit?.at ?? '~').localeCompare(b.lit?.at ?? '~'));
  const d: LitDetails = { glint: false, pin: false, charm: false, keepsakes: [], seasonal: null };
  for (const m of lit) {
    if (m.kind === 'taught') d.glint = true;
    else if (m.kind === 'task') d.pin = true;
    else if (m.kind === 'access') d.charm = true;
    else if (m.kind === 'room') d.keepsakes!.push(m.id.replace(/^room-/, ''));
    else d.seasonal = m.id.replace(/^season-/, '');
  }
  return d;
}

/** A lit moment's one-line why (§4.11): personal kinds say "you" when the moment is this person's own. */
export function momentWhy(m: PetGrowthMoment, g: PetGrowthView | undefined): PetStringKey {
  const mine = !!g?.mine?.includes(m.id);
  switch (m.kind) {
    case 'taught': return mine ? 'growth.why.taughtMine' : 'growth.why.taught';
    case 'access': return mine ? 'growth.why.accessMine' : 'growth.why.access';
    case 'task': return 'growth.why.task';
    case 'room': return 'growth.why.room';
    default: return 'growth.why.season';
  }
}

/** A Life Book page's title and shared why line (keys file: `book.page.<id>`, `book.why.*`). */
export function pageKeys(id: BookMomentId): { title: PetStringKey; why: PetStringKey } {
  const why: PetStringKey = id === 'met' ? 'book.why.met' : id === 'formed' ? 'book.why.formed' : id === 'bloom' ? 'book.why.bloom'
    : id.startsWith('stage') ? 'book.why.stage' : id.startsWith('bond') ? 'book.why.bond' : id.startsWith('best') ? 'book.why.best' : 'book.why.season';
  return { title: `book.page.${id}` as PetStringKey, why };
}

const WORD = /[\p{L}\p{N}]{3,}/gu;
const STOP = new Set(['the', 'and', 'you', 'your', 'how', 'this', 'that', 'with', 'for', 'our', 'then', 'say', 'remember', 'tell', 'learned', 'team',
  'یاد', 'بگو', 'این', 'که', 'رو', 'را', 'با']);
const words = (s: string) => new Set((s.toLowerCase().match(WORD) ?? []).filter((w) => !STOP.has(w)));

/**
 * The unlit `taught` moment the saved words most likely match (shared words in the title and hint), or the server's
 * own proposal when it names one. Null when nothing is unlit or nothing matches: never a guess with no overlap.
 */
export function bestTaught(g: PetGrowthView | undefined, said: string, proposed?: string): PetGrowthMoment | null {
  const open = (g?.moments ?? []).filter((m) => m.kind === 'taught' && !isLit(m, g));
  if (proposed) { const p = open.find((m) => m.id === proposed); if (p) return p; }
  const w = words(said);
  let best: PetGrowthMoment | null = null, score = 0;
  for (const m of open) {
    let n = 0;
    for (const x of words(`${m.title} ${m.hint}`)) if (w.has(x)) n++;
    if (n > score) { best = m; score = n; }
  }
  return best;
}
