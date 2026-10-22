/**
 * Telegram messages are sent without a parse mode, so markdown arrives as
 * literal symbols ("**bold**", "## Plan", "- item"). The prompt asks for plain
 * sentences; this is the safety net for replies that slip.
 *
 * Deliberately conservative: code inside ``` fences is kept verbatim (only the
 * fence lines go), and outside fences it only removes markup that is
 * unambiguous. It never touches underscores (usernames, snake_case),
 * arithmetic ("2*3", "a**2"), comparisons ("> 50%"), numbered steps, link
 * targets or any non-Latin text.
 */

const FENCE = /^\s*```[\w+-]*\s*$/;
const HEADING = /^(\s{0,3})#{1,6}\s+/;
const BULLET = /^(\s*)[-*•]\s+(?=\S)/;
// A quote marker, but not a comparison such as "> 50%".
const QUOTE = /^\s{0,3}>\s+(?=[^\s\d])/;
const RULE = /^\s{0,3}(?:[-*_]\s*){3,}$/;

function inline(line: string): string {
  return line
    // **bold** (also ***both***), only between non-word characters so "a**2" stays maths.
    .replace(/(^|[^\w*])\*{2,3}(?=\S)([^*\n]*?\S)\*{2,3}(?![\w*])/g, '$1$2')
    // *italic*, only when it opens after a non-word character and closes before one.
    .replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g, '$1$2')
    // `code`
    .replace(/`([^`\n]+)`/g, '$1')
    // [text](https://…) → text (https://…)
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)');
}

/** Plain chat text from a model reply: no markdown markers, same words, code kept as written. */
export function toPlainChat(text: string): string {
  const out: string[] = [];
  let inCode = false;
  for (const raw of text.split('\n')) {
    if (FENCE.test(raw)) { inCode = !inCode; continue; }
    if (inCode) { out.push(raw); continue; }
    if (RULE.test(raw)) continue;
    const line = raw.replace(HEADING, '$1').replace(QUOTE, '').replace(BULLET, '$1');
    out.push(inline(line));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** A reply with no word, number or emoji ("......", "؟!") says nothing; treat it like an empty one. */
export function isDegenerateReply(text: string): boolean {
  return !!text.trim() && !/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(text);
}

/** When the model returns no text: in the speaker's script, never a canned English line in a Persian chat. */
export function emptyReplyFallback(latest: string): string {
  // Arabic script is Persian here unless it carries Arabic-only letters (ة ي ك) and no Persian-only ones (پ چ ژ گ ک ی).
  const arabicScript = /[\u0600-\u06ff]/.test(latest);
  const arabicOnly = /[ةيك]/.test(latest) && !/[پچژگکی]/.test(latest);
  return arabicScript && !arabicOnly
    ? 'ببخشید، یه لحظه رشته‌ی فکرم پاره شد. می‌شه دوباره بگید؟'
    : 'Sorry, I lost my train of thought. Could you say that again?';
}
