/**
 * How a Persian message addresses the agent: تو forms (informal) or شما forms
 * (formal). Deterministic and conservative: only unambiguous second-person
 * markers count, so «تو» ("in"), «باید», «جدید» or «دوستان» never decide it.
 * A neutral message keeps the register the speaker used last.
 */

export type Register = 'informal' | 'formal';

const INFORMAL = new Set([
  'هستی', 'نیستی', 'داری', 'نداری', 'کجایی', 'خوبی', 'خودت', 'ازت', 'بهت', 'باهات', 'برات', 'واست', 'نظرت', 'اسمت',
  'بگو', 'نگو', 'بکن', 'نکن', 'کن', 'بده', 'نده', 'بیا', 'بنویس', 'بفرست', 'بخون', 'ببین', 'بپرس', 'بذار',
]);
const FORMAL = new Set([
  'شما', 'شماها', 'حضرتعالی', 'جنابعالی', 'بفرمایید', 'بفرمائید', 'بفرمایین',
  'هستید', 'هستین', 'نیستید', 'نیستین', 'دارید', 'دارین', 'ندارید', 'ندارین', 'کجایید', 'کجایین', 'خوبید', 'خوبین', 'چطورید', 'چطورین',
  'خودتون', 'خودتان', 'ازتون', 'ازتان', 'بهتون', 'بهتان', 'باهاتون', 'براتون', 'برایتان', 'واستون', 'نظرتون', 'نظرتان', 'اسمتون', 'اسمتان', 'حالتون', 'حالتان',
  'بگید', 'بگین', 'نگید', 'نگین', 'بکنید', 'بکنین', 'کنید', 'کنین', 'بدید', 'بدین', 'بیاین', 'بنویسید', 'بنویسین', 'بفرستید', 'بفرستین', 'بخونید', 'بخونین', 'بخوانید', 'ببینید', 'ببینین', 'بپرسید', 'بپرسین', 'بذارید', 'بذارین',
]);
/** Nouns that look like a می‌ verb. */
const NOT_VERBS = new Set(['میانگین', 'میادین', 'میهمانی', 'میلادی', 'میانی', 'میزبانی', 'میلیونی', 'میلیاردی', 'میکروفونی', 'میراثی', 'میدانی', 'میوه‌ای', 'میزی']);

/** Present/imperfect verbs: (ن)می + stem, with or without a ZWNJ; «ی» is تو, «ید/ین» is شما. */
const MI_VERB = /^ن?می\u200c?\p{L}{2,}$/u;

/** One token's register, or undefined when it says nothing. */
function tokenRegister(token: string): Register | undefined {
  if (INFORMAL.has(token)) return 'informal';
  if (FORMAL.has(token)) return 'formal';
  if (NOT_VERBS.has(token) || !MI_VERB.test(token)) return undefined;
  if (/(?:ید|ین)$/u.test(token)) return 'formal';
  if (/ی$/u.test(token)) return 'informal';
  return undefined;
}

/** The register of a Persian message; undefined when it is not Persian, neutral or mixed evenly. */
export function persianRegister(text: string): Register | undefined {
  if (!/[\u0600-\u06FF]/u.test(text)) return undefined;
  const tokens = text.normalize('NFC').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\u200d/g, '')
    // A spaced «می رم» is one verb.
    .replace(/(^|[^\p{L}])(ن?می) (?=\p{L})/gu, '$1$2\u200c')
    .split(/[^\p{L}\p{M}\u200c]+/u).map((t) => t.replace(/^\u200c+|\u200c+$/g, '')).filter(Boolean);
  let informal = 0, formal = 0;
  for (const token of tokens) {
    const register = tokenRegister(token);
    if (register === 'informal') informal++;
    else if (register === 'formal') formal++;
  }
  return informal > formal ? 'informal' : formal > informal ? 'formal' : undefined;
}

/** The latest message's register, else the last one detected in the speaker's earlier lines (oldest first). */
export function registerFor(latest: string, earlier: readonly string[] = []): Register | undefined {
  const now = persianRegister(latest);
  if (now || !/[\u0600-\u06FF]/u.test(latest)) return now;
  for (let i = earlier.length - 1; i >= 0; i--) {
    const before = persianRegister(earlier[i]);
    if (before) return before;
  }
  return undefined;
}
