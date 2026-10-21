/**
 * Goodbye intent on the pet page (brief §1.4): the page plays one wave and closes the talk. Matches
 * a farewell anywhere in a short message ("ok bye!", "good night mochi", "شب بخیر"), never inside
 * another word ("byte", "nightly").
 */

const FAREWELL = [
  'bye', 'bye bye', 'byebye', 'goodbye', 'good bye', 'good night', 'goodnight', 'gn', 'nighty night', 'night night', 'nite',
  'see you', 'see ya', 'cya', 'talk later', 'catch you later', 'ttyl', 'gotta go', 'got to go', 'have to go', 'i have to go', 'off to bed',
  'sleep well', 'sweet dreams',
];
const EN = new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${FAREWELL.map((f) => f.replace(/ /g, '\\s+')).join('|')})(?=$|[^\\p{L}\\p{N}])`, 'iu');
const FA = /خداحافظ|خدانگهدار|شب[\s\u200c]*بخیر|(?:^|[^\p{L}])بای(?=$|[^\p{L}])/u;
/** A long message that says "see you" somewhere is a conversation, not a goodbye. */
const MAX_GOODBYE_CHARS = 80;

export function isGoodbye(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= MAX_GOODBYE_CHARS && (EN.test(t) || FA.test(t));
}
