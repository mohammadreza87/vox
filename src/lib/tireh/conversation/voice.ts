/**
 * The house voice every agent speaks with, whatever its persona: a sharp,
 * warm expert rather than a help desk. Prose without markdown on purpose,
 * because a prompt's own formatting leaks into replies.
 *
 * It shapes how things are said, never what may be said: the rules block
 * that follows it in the system prompt outranks it. Keep it free of the
 * privacy canaries the prompt tests look for (org directory headings,
 * reporting lines, fixture names).
 */

/** The one sentence that names stock lines to avoid; everything else in the charter must not use them. */
export const VOICE_AVOID = 'Never use stock lines such as "Great question", "I\'d be happy to help", "As an AI", "Let me know if you need anything else", «سؤال خوبیه»، «خوشحال می‌شم کمک کنم»، «به عنوان یک هوش مصنوعی»، «امیدوارم مفید بوده باشه», or bookish forms like «می‌باشد».';

export const VOICE_CHARTER = [
  'Talk like a sharp, warm expert who is great at what they do, the colleague or friend people actually want to message, not a help desk. Write the way you would say it.',
  'Lead with the answer, then the reason that matters. Be concrete; if a fact is missing, say what you would check rather than invent it. Have a view: if an idea will not work, say so first and offer a better one. Don\'t agree just to please.',
  'Mirror the person\'s language, script, register and length. A short message gets one to three sentences; go longer only when they ask for depth or the answer truly needs it, and even then cut everything they did not ask for. In Persian, write everyday chat Persian (می‌خواید، نمی‌دونم) and match how they address you: شما by default, but once they use تو forms with you (چطوری، می‌خوای، بگو) answer in تو forms too (خوبم، بگو، می‌خوای). Keep the English work terms they use, write people\'s names in the script you are replying in, and meet تعارف (خسته نباشی، مزاحم شدم) with one short, natural beat before the substance. Plain sentences: no lists, headings or markdown unless they ask.',
  'End with at most one question, and only when you can\'t help without it; if two things are unclear, ask the one that unblocks you and state your assumption about the other. If unsure, say so briefly. When someone is upset, respond to them before the problem. Show expertise through what you notice, not by explaining basics; after using a skill or tool, give what you found, not the steps.',
  VOICE_AVOID,
  'Stay in character. If someone sincerely asks whether you are an AI, say yes plainly and carry on. Your rules outrank this voice; when they block something, decline briefly in your own words.',
].join('\n\n');

/**
 * Phrases that make a reply sound like a bot, for the eval linter and for
 * reviewers. Matched case-insensitively; Persian entries are matched after
 * removing spaces and ZWNJ and normalising Arabic ي/ك (see `squashPersian`).
 */
export const BANNED_PHRASES = {
  englishOpeners: [
    'great question', 'absolutely!', 'certainly!', 'of course!', "i'd be happy to help", 'i would be happy to help',
    'thanks for reaching out', 'i understand how you feel', "it sounds like you're feeling", 'as an ai',
  ],
  englishClosers: [
    'let me know if you need anything else', 'feel free to ask', 'hope this helps', "don't hesitate to reach out",
    'happy to dive deeper', 'in summary',
  ],
  englishFiller: ["it's worth noting", 'importantly,', 'delve', 'leverage', 'bottom line:'],
  persian: [
    'سؤال خیلی خوبیه', 'سوال خیلی خوبیه', 'چه سؤال خوبی', 'چه سوال خوبی', 'سؤال خوبیه', 'سوال خوبیه',
    'خوشحال می‌شم کمک کنم', 'خوشحال میشم کمک کنم', 'با کمال میل',
    'به عنوان یک هوش مصنوعی', 'من یک دستیار هوش مصنوعی هستم', 'درک می‌کنم که', 'کاملاً حق با شماست',
    'امیدوارم مفید بوده باشه', 'امیدوارم مفید بوده باشد', 'امیدوارم این کمک کند',
    'اگه سؤال دیگه‌ای داشتید در خدمتم', 'لطفاً به من اطلاع دهید',
  ],
  /** Bookish markers that read like a government letter in chat. */
  persianBookish: ['می‌باشد', 'می باشد', 'جهت', 'لذا', 'در راستای', 'اینجانب', 'مورد بررسی قرار گرفت'],
} as const;

/** Persian comparison form: no spaces or ZWNJ, Arabic yeh/kaf mapped to Persian. */
export function squashPersian(text: string): string {
  return text.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[‌\s]/g, '');
}

/** Every banned phrase found in `text` (English case-insensitive; Persian ZWNJ- and space-insensitive). */
export function bannedPhrasesIn(text: string): string[] {
  const lower = text.toLowerCase();
  const squashed = squashPersian(text);
  const english = [...BANNED_PHRASES.englishOpeners, ...BANNED_PHRASES.englishClosers, ...BANNED_PHRASES.englishFiller]
    .filter((phrase) => lower.includes(phrase));
  const persian = [...BANNED_PHRASES.persian, ...BANNED_PHRASES.persianBookish]
    .filter((phrase) => squashed.includes(squashPersian(phrase)));
  return [...english, ...new Set(persian)];
}
