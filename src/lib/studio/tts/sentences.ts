/**
 * Sentence splitting for sentence-level speech (design PET_CARE_GAME_DESIGN_2026_10_26 §8A.3, "fake streaming"): each
 * piece is synthesized as soon as it is complete, in order. Pure and deterministic.
 *
 * - Hard ends: `.` `!` `?` `…` (and Persian `؟`), with any run of them and closing quotes, followed by a space or the end.
 * - Never after a known abbreviation ("e.g.", "Dr.", Persian "ه.ش."), a single initial ("J."), inside a decimal ("3.5",
 *   "۳.۵"), inside a URL or e-mail (no space follows), or inside «…» / “…” quotes.
 * - The Persian comma `،` is a soft end, used only to break a sentence longer than SOFT_BREAK_CHARS.
 * - Pieces shorter than MIN_PIECE_CHARS merge with their neighbour so prosody does not chop; none exceeds MAX_PIECE_CHARS
 *   (cut at a clause mark or a space when it must be).
 */

/** "A Persian comma is only a soft cut for a sentence longer than about 180 characters" (§8A.3). */
export const SOFT_BREAK_CHARS = 180;
/** "Pieces shorter than about 20 characters merge with the next" (§8A.3). */
export const MIN_PIECE_CHARS = 20;
/** "Pieces stop at about 240 characters" (§8A.3). */
export const MAX_PIECE_CHARS = 240;

const TERMINATORS = new Set(['.', '!', '?', '…', '؟']);
const OPENERS: Readonly<Record<string, string>> = { '«': '»', '“': '”', '(': ')' };
const CLOSERS = new Set(['»', '”', ')', ']', '"', '\'', '’']);
const DIGIT = /[0-9۰-۹٠-٩]/;
const SPACE = /\s/;

/** Lower-cased tokens (with their dots) after which a period never ends a sentence. */
const EN_ABBREVIATIONS = new Set([
  'e.g.', 'i.e.', 'etc.', 'vs.', 'cf.', 'approx.', 'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'sr.', 'jr.', 'st.', 'mt.',
  'inc.', 'ltd.', 'co.', 'corp.', 'no.', 'nos.', 'fig.', 'dept.', 'est.', 'a.m.', 'p.m.', 'u.s.', 'u.k.', 'jan.', 'feb.',
  'mar.', 'apr.', 'jun.', 'jul.', 'aug.', 'sep.', 'sept.', 'oct.', 'nov.', 'dec.', 'min.', 'max.', 'ca.', 'al.',
]);
/** Persian date and era marks written with dots (ه.ش. solar Hijri, ه.ق. lunar Hijri, ق.م. BCE, م. CE). */
const FA_ABBREVIATIONS = new Set(['ه.ش.', 'ه.ق.', 'ق.م.', 'م.', 'ص.', 'ج.']);

function isAbbreviation(token: string, lang: 'en' | 'fa'): boolean {
  const t = token.replace(/^[«“"'(\[]+/, '').toLowerCase();
  if (EN_ABBREVIATIONS.has(t) || (lang === 'fa' && FA_ABBREVIATIONS.has(t))) return true;
  // a single initial ("J.") or a dotted acronym ("U.N.")
  return /^(?:\p{Lu}\.)+$/u.test(token.replace(/^[«“"'(\[]+/, ''));
}

/** The hard sentence pieces of `text`, before merging and size limits. */
function hardPieces(text: string, lang: 'en' | 'fa'): string[] {
  const pieces: string[] = [];
  const quotes: string[] = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (OPENERS[c]) { quotes.push(OPENERS[c]); i++; continue; }
    if (quotes.length && c === quotes[quotes.length - 1]) { quotes.pop(); i++; continue; }
    if (!TERMINATORS.has(c)) { i++; continue; }
    // a decimal point: a digit on both sides
    if (c === '.' && i > 0 && DIGIT.test(text[i - 1]) && DIGIT.test(text[i + 1] ?? '')) { i++; continue; }
    // an end mark inside «…» / “…” / (…) ends the quoted sentence, not the reply's: the outer sentence goes on
    const quoted = quotes.length > 0;
    let j = i;
    while (j < text.length && TERMINATORS.has(text[j])) j++;
    // closing quotes and brackets right after the end mark belong to this sentence
    while (j < text.length && CLOSERS.has(text[j])) {
      if (quotes.length && text[j] === quotes[quotes.length - 1]) quotes.pop();
      j++;
    }
    const atBoundary = j >= text.length || SPACE.test(text[j]);
    if (!atBoundary || quoted) { i = j; continue; }
    if (c === '.' && j === i + 1) {
      const token = text.slice(text.slice(0, i + 1).search(/\S+$/), i + 1);
      if (isAbbreviation(token, lang)) { i = j; continue; }
    }
    pieces.push(text.slice(start, j));
    start = j;
    i = j;
  }
  if (start < text.length) pieces.push(text.slice(start));
  return pieces.map((p) => p.trim()).filter(Boolean);
}

/** A sentence longer than SOFT_BREAK_CHARS, broken at Persian commas into clauses as long as they may be. */
function softBreak(piece: string): string[] {
  if (piece.length <= SOFT_BREAK_CHARS || !piece.includes('،')) return [piece];
  const clauses = piece.split(/(?<=،)\s+/u);
  const out: string[] = [];
  let current = '';
  for (const clause of clauses) {
    const joined = current ? `${current} ${clause}` : clause;
    if (current && joined.length > SOFT_BREAK_CHARS) { out.push(current); current = clause; }
    else current = joined;
  }
  if (current) out.push(current);
  return out;
}

/** Cuts a piece longer than MAX_PIECE_CHARS at the last clause mark, else the last space, else hard. */
function hardCap(piece: string): string[] {
  const out: string[] = [];
  let rest = piece;
  while (rest.length > MAX_PIECE_CHARS) {
    const window = rest.slice(0, MAX_PIECE_CHARS + 1);
    let cut = -1;
    for (let k = window.length - 1; k >= MIN_PIECE_CHARS; k--) {
      if (SPACE.test(window[k]) && /[،,;:]/.test(window[k - 1])) { cut = k; break; }
    }
    if (cut < 0) cut = window.search(/\s\S*$/);
    if (cut < MIN_PIECE_CHARS) cut = MAX_PIECE_CHARS;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Joins pieces shorter than MIN_PIECE_CHARS to the next one (the last to the one before), within MAX_PIECE_CHARS. */
function mergeShort(pieces: string[]): string[] {
  const out: string[] = [];
  let carry = '';
  for (const piece of pieces) {
    const joined = carry ? `${carry} ${piece}` : piece;
    if (carry && joined.length > MAX_PIECE_CHARS) { out.push(carry); carry = piece; }
    else carry = joined;
    if (carry.length >= MIN_PIECE_CHARS) { out.push(carry); carry = ''; }
  }
  if (carry) {
    const last = out.length ? `${out[out.length - 1]} ${carry}` : carry;
    if (out.length && last.length <= MAX_PIECE_CHARS) out[out.length - 1] = last;
    else out.push(carry);
  }
  return out;
}

/**
 * Splits a reply into speakable pieces, in order. `lang` adds that language's abbreviations; both languages' end marks
 * are always honoured, since replies mix them. Joining the pieces with single spaces gives back the text, with its
 * whitespace collapsed at the cuts.
 */
export function splitSentences(text: string, lang: 'en' | 'fa'): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const pieces = hardPieces(trimmed, lang).flatMap(softBreak).flatMap(hardCap);
  return mergeShort(pieces).flatMap(hardCap);
}
