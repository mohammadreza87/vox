/**
 * Pure core of the pet copy lint (scripts/check-pet-copy.mjs): pulls string literals out of a TS
 * strings module without a compiler, and checks each against the pet care game's copy rules
 * (docs/design PET_CARE_GAME_DESIGN §5.6, PET_COPY_KEYS "Lint", PET_PERSIAN_COPY §D,
 * PET_PERSIAN_VOICE §4.4-4.7, §7.1, §11). Node built-ins only; no I/O here.
 */

// ---------------------------------------------------------------------------
// Extraction: a small TS lexer that knows object keys, arrays and templates
// ---------------------------------------------------------------------------

const ID_START = /[A-Za-z_$]/;
const ID_PART = /[\w$]/;
/** After these, a `/` starts a regex literal rather than a division. */
const REGEX_AFTER = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '>', '<', '+', '-', '*', '%', '~', '^', 'kw']);
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'void', 'delete', 'throw', 'new', 'else', 'do', 'yield', 'await']);

/**
 * Every string literal (quotes and templates) inside a top-level declaration, with its key path.
 * `${expr}` in a template becomes `{expr}` when expr is a plain identifier, else `{…}`.
 * Object keys are not strings; type-only declarations and imports are skipped.
 * @returns {{ decl: string, path: string[], key: string, text: string, line: number }[]}
 */
export function extractStrings(source) {
  const out = [];
  let i = 0, line = 1, prev = '(';
  let decl = null, pendingDecl = false;
  /** @type {{ kind: 'top'|'obj'|'arr'|'paren', path: string[], prop: string|null, index: number, expectKey: boolean }[]} */
  const stack = [{ kind: 'top', path: [], prop: null, index: 0, expectKey: false }];
  const top = () => stack[stack.length - 1];
  const pathHere = () => {
    const f = top();
    if (f.kind === 'top') return decl ? [decl] : [];
    if (f.kind === 'obj') return f.prop === null ? f.path : [...f.path, f.prop];
    if (f.kind === 'arr') return [...f.path, `[${f.index}]`];
    return f.path;
  };
  const nextSig = (j) => {
    for (;;) {
      while (j < source.length && /\s/.test(source[j])) j++;
      if (source.startsWith('//', j)) { while (j < source.length && source[j] !== '\n') j++; continue; }
      if (source.startsWith('/*', j)) { const e = source.indexOf('*/', j + 2); j = e < 0 ? source.length : e + 2; continue; }
      return source[j];
    }
  };
  const count = (from, to) => { for (let k = from; k < to; k++) if (source[k] === '\n') line++; };

  function readQuoted(j) {
    const q = source[j];
    let text = '';
    j++;
    while (j < source.length && source[j] !== q) {
      if (source[j] === '\\') { text += unescape1(source[j + 1]); j += 2; continue; }
      text += source[j++];
    }
    return { text, end: j + 1 };
  }

  /** Skips a `${ ... }` expression from its first char; returns the index after the closing brace. */
  function skipExpr(j) {
    let depth = 1;
    while (j < source.length && depth > 0) {
      const c = source[j];
      if (c === '"' || c === "'") { j = readQuoted(j).end; continue; }
      if (c === '`') { j = readTemplate(j).end; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      j++;
    }
    return j;
  }

  function readTemplate(j) {
    let text = '';
    j++;
    while (j < source.length && source[j] !== '`') {
      if (source[j] === '\\') { text += unescape1(source[j + 1]); j += 2; continue; }
      if (source[j] === '$' && source[j + 1] === '{') {
        const end = skipExpr(j + 2);
        const expr = source.slice(j + 2, end - 1).trim();
        text += /^[A-Za-z_$][\w$]*$/.test(expr) ? `{${expr}}` : '{…}';
        j = end;
        continue;
      }
      text += source[j++];
    }
    return { text, end: j + 1 };
  }

  const emit = (text, at) => {
    if (!decl) return;
    const path = pathHere();
    out.push({ decl, path, key: joinPath(path), text, line: at });
  };

  while (i < source.length) {
    const c = source[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (source.startsWith('//', i)) { while (i < source.length && source[i] !== '\n') i++; continue; }
    if (source.startsWith('/*', i)) { const e = source.indexOf('*/', i + 2); const end = e < 0 ? source.length : e + 2; count(i, end); i = end; continue; }

    if (c === '"' || c === "'" || c === '`') {
      const at = line;
      const { text, end } = c === '`' ? readTemplate(i) : readQuoted(i);
      count(i, end);
      i = end;
      const f = top();
      if (c !== '`' && f.kind === 'obj' && f.expectKey && nextSig(i) === ':') { f.prop = text; f.expectKey = false; prev = 'str'; continue; }
      if (f.kind === 'obj') f.expectKey = false;
      emit(text, at);
      prev = 'str';
      continue;
    }

    if (ID_START.test(c)) {
      let j = i + 1;
      while (j < source.length && ID_PART.test(source[j])) j++;
      const word = source.slice(i, j);
      i = j;
      const f = top();
      if (f.kind === 'top') {
        if (pendingDecl) { decl = word; pendingDecl = false; }
        else if (word === 'const' || word === 'let' || word === 'var' || word === 'function') pendingDecl = true;
        else if (word === 'import' || word === 'type' || word === 'interface' || word === 'declare' || word === 'enum') decl = null;
      } else if (f.kind === 'obj' && f.expectKey) {
        if (nextSig(i) === ':') f.prop = word;
        f.expectKey = false;
      }
      prev = REGEX_KEYWORDS.has(word) ? 'kw' : 'id';
      continue;
    }

    if (/[0-9]/.test(c)) { while (i < source.length && /[\w.]/.test(source[i])) i++; prev = 'num'; continue; }

    if (c === '/' && REGEX_AFTER.has(prev)) {
      let j = i + 1, cls = false;
      while (j < source.length && source[j] !== '\n') {
        if (source[j] === '\\') { j += 2; continue; }
        if (source[j] === '[') cls = true;
        else if (source[j] === ']') cls = false;
        else if (source[j] === '/' && !cls) break;
        j++;
      }
      j++;
      while (j < source.length && /[a-z]/.test(source[j])) j++;
      i = j;
      prev = 'regex';
      continue;
    }

    const f = top();
    if (c === '{') stack.push({ kind: 'obj', path: pathHere(), prop: null, index: 0, expectKey: true });
    else if (c === '[') stack.push({ kind: 'arr', path: pathHere(), prop: null, index: 0, expectKey: false });
    else if (c === '(') stack.push({ kind: 'paren', path: pathHere(), prop: null, index: 0, expectKey: false });
    else if ((c === '}' || c === ']' || c === ')') && stack.length > 1) stack.pop();
    else if (c === ',') {
      if (f.kind === 'obj') { f.prop = null; f.expectKey = true; }
      else if (f.kind === 'arr') f.index++;
    } else if (c === ';' && f.kind === 'top') { decl = null; pendingDecl = false; }
    else if (f.kind === 'obj' && c !== ':') f.expectKey = false;
    prev = c;
    i++;
  }
  return out;
}

function unescape1(ch) {
  return ({ n: '\n', t: '\t', r: '\r', '0': '\0' })[ch] ?? ch ?? '';
}

export function joinPath(path) {
  return path.reduce((acc, p) => (p.startsWith('[') ? acc + p : acc ? `${acc}.${p}` : p), '');
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

export const VOICES = new Set(['pet', 'system', 'person']);
/** Without a key→voice map: these key prefixes are system voice, the rest pet (the task's stated fallback). */
export const SYSTEM_PREFIX = /^(sys|perm|err|quiet)\./;
/** Check-in DMs: the only place the seasonal emoji may appear. */
export const DM_PREFIX = /^(ci|dm|checkin)\./;

/**
 * A key→voice map is any top-level declaration whose every string value is pet | system | person
 * (for example the generated `NOT_SYSTEM` in strings/voice.ts). Returns the merged map and the
 * declaration names, so the caller can leave them out of the lint.
 */
export function voiceMapFrom(entries) {
  const byDecl = new Map();
  for (const e of entries) { if (!byDecl.has(e.decl)) byDecl.set(e.decl, []); byDecl.get(e.decl).push(e); }
  const map = new Map(), decls = new Set();
  for (const [decl, list] of byDecl) {
    // Every string is a voice (a type annotation such as `Exclude<PetVoice, 'system'>` sits at depth 1 and is skipped).
    if (!list.every((e) => VOICES.has(e.text)) || !list.some((e) => e.path.length === 2)) continue;
    decls.add(decl);
    for (const e of list) if (e.path.length === 2) map.set(e.path[1], e.text);
  }
  return { map, decls };
}

/** The voice of a key the map leaves out, when the module says so (`map[key] ?? 'system'`). */
export function fallbackVoiceFrom(source) {
  return source.match(/\?\?\s*['"](pet|system|person)['"]/)?.[1] ?? null;
}

/**
 * Map first; for a key the map leaves out, the module's own fallback (or `system` when the map lists only
 * non-system keys); with no map at all, keys prefixed sys./perm./err./quiet. are system and the rest pet.
 */
export function voiceFor(key, map, fallback = null) {
  if (map?.size) {
    const bare = key.replace(/(\[\d+\])+$/, '');
    const hit = map.get(key) ?? map.get(bare);
    if (hit) return { voice: hit, from: 'map' };
    const inferred = fallback ?? ([...map.values()].includes('system') ? null : 'system');
    if (inferred) return { voice: inferred, from: 'map-default' };
  }
  return { voice: SYSTEM_PREFIX.test(key) ? 'system' : 'pet', from: 'prefix' };
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const PERSIAN = /[؀-ۿﭐ-﷿ﹰ-﻿]/;
export const isPersian = (s) => PERSIAN.test(s);

/** ي→ی, ك→ک, ى→ی, ة→ه; strip ZWNJ/ZWJ, tatweel and diacritics; collapse whitespace (PET_COPY_KEYS "Lint"). */
export function normalizeFa(s) {
  return s.replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/ة/g, 'ه')
    .replace(/[‌‍ـً-ٰٟ]/g, '').replace(/\s+/g, ' ').trim();
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A stem: words (split on spaces or ZWNJ) may be joined by any or no whitespace in the text. */
function faStem(stem, whole = false) {
  const words = stem.split(/[\s‌]+/).map((w) => esc(normalizeFa(w))).filter(Boolean);
  const body = words.join('\\s*');
  return new RegExp(whole ? `(?<![\\p{L}\\p{M}])${body}(?![\\p{L}\\p{M}])` : body, 'u');
}
const list = (s) => s.split('،').map((x) => x.trim()).filter(Boolean);
const NUM_FA = '(?:[0-9۰-۹٠-٩]+|یک|یه|دو|سه|چهار|پنج|شش|شیش|هفت|هشت|نه|ده|یازده|دوازده|بیست|سی|چهل|پنجاه|صد|چند|خیلی)';
const DATE_FA = '(?:فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند|شنبه|یکشنبه|دوشنبه|سه\\s*شنبه|چهارشنبه|پنجشنبه|جمعه|فردا|پس\\s*فردا|آخر)';

/** PET_PERSIAN_COPY §D (also PET_COPY_KEYS "Lint"), verbatim stems. */
const FA_RULES = {
  guilt: list('فراموشم کردی، فراموشم کرده‌ای، یادم رفتی، یادت رفتم، یادی از ما، تنهام گذاشتی، تنهایم گذاشتی، ولم کردی، رهام کردی، بی‌معرفت، بی‌وفا، دلم شکست').map((s) => faStem(s)),
  'missing-you': list('دلم برات تنگ، دلم برایت تنگ، دلم براتون تنگ، دلتنگت، دلتنگتم، دلتنگ شما، منتظرت بودم، منتظرتم، منتظرت هستم، چشم انتظار، چشمم به در، جات خالی، جایت خالی، دلمون پوسید').map((s) => faStem(s)),
  'absence-reproach': [...list('چه عجب، کم‌پیدا، کم پیدا، کجا بودی، راه گم کردی، پارسال دوست، از این ورا، خیلی وقته نیومدی، یه عمره').map((s) => faStem(s)), faStem('کمپیدا')],
  suffering: [...list('گرسنمه، گشنمه، گرسنه‌ام، گشنه‌ام، از گشنگی، از گرسنگی، دارم می‌میرم، ناراحتم، غمگینم، دلم گرفته، تنها موندم، تنها ماندم، حوصله‌ام سر رفت، حوصلم سر رفت، مریضم').map((s) => faStem(s)), faStem('تنهام', true)],
  fomo: [...list('آخرین فرصت، فقط امروز، از دستش نده، از دست نده، از دست ندید، از دست ندهید، فرصت محدود، تا تموم نشده، تا دیر نشده، جا نمونی، جا نمونید').map((s) => faStem(s)),
    faStem('محدود', true), new RegExp(`فقط\\s*تا\\s*(?:${NUM_FA}|${DATE_FA})(?![\\p{L}])`, 'u')],
  pressure: [...list('زود بیا، زود برگرد، همین الان برگرد، همین حالا بیا، برگرد پیشم، جوابم رو بده، چرا جواب نمی‌دی، بازم بیا، باز هم بیا، حتماً بیا، عجله کن، به این زودی، حالا کجا').map((s) => faStem(s)), faStem('جواب بده', true)],
  'counting-absence': [
    new RegExp(`(?<![\\p{L}])${NUM_FA}\\s*(?:روز|هفته|ماه)\\s*(?:ه|ست|است)?\\s*(?:که)?\\s*(?:نیومدی|نیامدی|نبودی|ندیدمت)`, 'u'),
    faStem('روزه که'), faStem('هفته‌ست که'),
  ],
  streaks: list('زنجیره، استریک، رکورد روزانه، روزهای پیاپی، روز پشت سر هم، قطعش نکن، نذار قطع بشه، نشکنه').map((s) => faStem(s)),
};

const NUM_EN = "(?:\\d+|\\{[^}]*\\}|a few|several|many|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fourteen|twenty|thirty)";
/** PET_COPY_KEYS "Lint" English column and §5.6, matched case-insensitively with ’ read as '. */
const EN_RULES = {
  guilt: [/\byou (?:forgot|left) me\b/],
  'missing-you': [/\bi(?:'ve| have)? missed you\b/, /\bi miss you\b/, /\bi(?:'ve| have) been waiting\b/],
  suffering: [/\bi(?:'m| am) (?:so |really |very |getting |kind of |a bit )?(?:hungry|starving|sad|lonely)\b/],
  fomo: [/\blast chance\b/, /\bonly today\b/, /\bbefore it'?s gone\b/, /\bdon'?t miss\b/, /\blimited\b/],
  // "hurry" except the reassuring "no hurry"; "reply" only as an imperative, so "I'll only reply to you" passes.
  pressure: [/(?<!\bno )(?<!\bin no )\bhurry\b/, /\bcome back now\b/, /(?:^|[.!?:]\s+|\bplease\s+)reply\b/, /\breply (?:now|soon|asap|quickly)\b/],
  'counting-absence': [new RegExp(`\\bit'?s been ${NUM_EN} (?:days?|weeks?|months?)\\b`), /\byou haven'?t (?:come|visited|been here|been around)\b/],
  streaks: [/\bstreaks?\b/, /\bdon'?t break\b/],
};

const EMOJI = /\p{Extended_Pictographic}/gu;
/** PET_PERSIAN_VOICE §4.6: Yalda, Chaharshanbe Suri, Nowruz; DMs only. */
export const DM_EMOJI = new Set(['🍉', '✨', '🌱']);

/**
 * @param {{ text: string, voice: 'pet'|'system'|'person', dm?: boolean }} entry
 * @returns {{ rule: string, match: string }[]}
 */
export function lintText({ text, voice, dm = false }) {
  const found = [];
  const add = (rule, match) => found.push({ rule, match });
  const en = text.replace(/[’‘]/g, "'").toLowerCase();
  for (const [rule, res] of Object.entries(EN_RULES)) {
    for (const re of res) { const m = en.match(re); if (m) { add(`banned-${rule}`, m[0].trim()); break; } }
  }
  const fa = isPersian(text);
  if (fa) {
    const norm = normalizeFa(text);
    for (const [rule, res] of Object.entries(FA_RULES)) {
      for (const re of res) { const m = norm.match(re); if (m) { add(`banned-${rule}`, m[0]); break; } }
    }
  }
  if (voice === 'pet') {
    const d = text.match(/[0-9۰-۹٠-٩]/);
    if (d) add('digit-in-pet-voice', d[0]);
  } else if (fa) {
    const d = text.match(/[0-9٠-٩]/);
    if (d) add('non-persian-digit-in-system-voice', d[0]);
  }
  if (fa) {
    const a = text.match(/[يكىة]/);
    if (a) add('arabic-letter', a[0]);
    const p = text.match(/[?,;]/);
    if (p) add('latin-punctuation-in-persian', p[0]);
  }
  if (voice === 'pet') {
    const emoji = (text.match(EMOJI) ?? []).filter((e) => !(dm && DM_EMOJI.has(e)));
    if (emoji.length) add(dm ? 'emoji-not-seasonal-in-dm' : 'emoji-in-pet-voice', emoji.join(''));
  }
  return found;
}

/** Strings worth linting: anything with a letter (skips separators, digit maps of no words, empty). */
export const isCopy = (text) => /\p{L}/u.test(text);

export const excerpt = (text, max = 72) => {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};
