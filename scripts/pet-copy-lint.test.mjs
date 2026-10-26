import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { extractStrings, fallbackVoiceFrom, lintText, normalizeFa, voiceFor, voiceMapFrom } from './lib/pet-copy-lint.mjs';
import { collect, run } from './check-pet-copy.mjs';

const script = fileURLToPath(new URL('./check-pet-copy.mjs', import.meta.url));
const rules = (text, voice = 'pet', dm = false) => lintText({ text, voice, dm }).map((v) => v.rule);

test('extracts copy with key paths; skips object keys, imports, types, regexes and comments', () => {
  const src = `
    import type { X } from '@/lib/pet/types';
    type K = 'a' | 'b';
    // 'not copy'
    const re = /it's a 'regex'/g;
    export const SAY = {
      'quiet.private.title': 'This one\\'s private',
      hi: 'Hi!', /* 'skip' */
      nested: { deep: \`Hi \${name}, \${a.b} more\` },
      pick: (n: number) => (n > 1 ? 'many' : "one"),
      list: ['a b', 'c d'],
    } as const;
    const x = 10 / 2; const y = 'after division';
  `;
  const got = extractStrings(src).map((e) => [e.key, e.text]);
  assert.deepEqual(got, [
    ['SAY.quiet.private.title', "This one's private"],
    ['SAY.hi', 'Hi!'],
    ['SAY.nested.deep', 'Hi {name}, {…} more'],
    ['SAY.pick', 'many'],
    ['SAY.pick', 'one'],
    ['SAY.list[0]', 'a b'],
    ['SAY.list[1]', 'c d'],
    ['y', 'after division'],
  ]);
});

test('reports source lines and reads a key→voice map by its values, whatever its name', () => {
  const src = "export const VOICE = { 'say.hi': 'pet', 'perm.P1.title': 'system' };\nexport const en = {\n  'say.hi': 'Hi!',\n  'say.pet': 'pet',\n};\n";
  const entries = extractStrings(src);
  assert.equal(entries.find((e) => e.text === 'Hi!').line, 3);
  const { map, decls } = voiceMapFrom(entries);
  assert.deepEqual([...map], [['say.hi', 'pet'], ['perm.P1.title', 'system']]);
  assert.deepEqual([...decls], ['VOICE']);
  assert.deepEqual(voiceFor('perm.P1.title', map), { voice: 'system', from: 'map' });
  assert.deepEqual(voiceFor('say.feed.more[2]', new Map([['say.feed.more', 'pet']]), 'system'), { voice: 'pet', from: 'map' });
  assert.deepEqual(voiceFor('err.offline', new Map()), { voice: 'system', from: 'prefix' });
  assert.deepEqual(voiceFor('say.other', map), { voice: 'pet', from: 'prefix' });
  assert.deepEqual(voiceFor('say.hi', undefined), { voice: 'pet', from: 'prefix' });
});

test('a NOT_SYSTEM-style map: unmapped keys take the module fallback, or system when the map lists no system key', () => {
  const src = "export const NOT_SYSTEM: Partial<Record<K, Exclude<V, 'system'>>> = {\n  'say.hi': 'pet',\n  'ci.btn.stop': 'person',\n};\nexport const voiceOf = (key: K): V => NOT_SYSTEM[key] ?? 'system';\n";
  const { map, decls } = voiceMapFrom(extractStrings(src));
  assert.deepEqual([...decls], ['NOT_SYSTEM']);
  assert.equal(fallbackVoiceFrom(src), 'system');
  assert.deepEqual(voiceFor('say.hi', map, 'system'), { voice: 'pet', from: 'map' });
  assert.deepEqual(voiceFor('ci.why.growing', map, 'system'), { voice: 'system', from: 'map-default' });
  assert.deepEqual(voiceFor('say.other', map), { voice: 'system', from: 'map-default' });
});

test('English banned phrases, case and curly apostrophes ignored', () => {
  for (const [text, rule] of [
    ['You forgot me!', 'banned-guilt'], ['I missed you so much', 'banned-missing-you'], ['I’ve been waiting', 'banned-missing-you'],
    ["I'm starving", 'banned-suffering'], ['I am so lonely', 'banned-suffering'], ['Last chance!', 'banned-fomo'],
    ['Limited hats', 'banned-fomo'], ["Don't miss it", 'banned-fomo'], ['Hurry!', 'banned-pressure'], ['Come back now', 'banned-pressure'],
    ['Please reply', 'banned-pressure'], ["It's been 5 days", 'banned-counting-absence'], ["It's been {n} days", 'banned-counting-absence'],
    ["You haven't come", 'banned-counting-absence'], ['Keep your streak', 'banned-streaks'], ["Don't break it", 'banned-streaks'],
  ]) assert.ok(rules(text, 'system').includes(rule), `${text} -> ${rule}`);
});

test('English guards: reassurance and plain verbs pass', () => {
  for (const text of ['No hurry.', "I'll only reply to you.", 'You chose: Only reply to me', 'Welcome back! I learned a new wiggle.', 'I kept a little sunshine for you.'])
    assert.deepEqual(rules(text), [], text);
});

test('Persian banned stems match after normalisation (ي ك ة, ZWNJ, diacritics, spacing)', () => {
  assert.equal(normalizeFa('دلم‌برات‌تنگ شده'), 'دلمبراتتنگ شده');
  for (const [text, rule] of [
    ['دلم برات تنگ شده بود', 'banned-missing-you'], ['دلم‌برات‌تنگ', 'banned-missing-you'], ['منتظرتم', 'banned-missing-you'],
    ['فراموشم کردي؟'.replace('؟', ''), 'banned-guilt'], ['بی معرفت', 'banned-guilt'],
    ['چه عجب', 'banned-absence-reproach'], ['کم‌پیدایی', 'banned-absence-reproach'], ['کم پیدایی', 'banned-absence-reproach'], ['کجا بودی', 'banned-absence-reproach'],
    ['گشنمه', 'banned-suffering'], ['خیلی تنهام', 'banned-suffering'], ['فقط امروز', 'banned-fomo'], ['کلاه محدود', 'banned-fomo'],
    ['فقط تا ۵ آبان', 'banned-fomo'], ['فقط تا جمعه', 'banned-fomo'], ['زود برگرد', 'banned-pressure'], ['جواب بده', 'banned-pressure'],
    ['حالا کجا', 'banned-pressure'], ['حتماً بیا', 'banned-pressure'], ['سه روزه که نیومدی', 'banned-counting-absence'],
    ['۳ روزه نیومدی', 'banned-counting-absence'], ['هفته‌ست که', 'banned-counting-absence'], ['زنجیره رو نشکن', 'banned-streaks'], ['روز پشت سر هم', 'banned-streaks'],
  ]) assert.ok(rules(text, 'system').includes(rule), `${text} -> ${rule}`);
});

test('Persian false-positive guards from the lint section', () => {
  for (const text of ['منتظر تلگرام…', 'منتظر تماس', '{name} با صدا جواب بدهد', 'اگر سه پیام پشت هم باز نشود', 'تنهایی', 'حالت بی‌عجله', 'محدودیت'])
    assert.ok(!rules(text, 'system').some((r) => r.startsWith('banned-')), text);
});

test('digits: none in pet voice; Persian system strings take Persian digits only', () => {
  assert.deepEqual(rules('Five more minutes…'), []);
  assert.deepEqual(rules('3 more!'), ['digit-in-pet-voice']);
  assert.deepEqual(rules('پنج دقیقه دیگه'), []);
  assert.deepEqual(rules('۵ دقیقه دیگه'), ['digit-in-pet-voice']);
  assert.deepEqual(rules('حداکثر روزی ۱ بار، بین ۹ شب تا ۸ صبح', 'system'), []);
  assert.deepEqual(rules('بین 9 شب', 'system'), ['non-persian-digit-in-system-voice']);
  assert.deepEqual(rules('بین ٩ شب', 'system'), ['non-persian-digit-in-system-voice']);
  assert.deepEqual(rules('This group already has 12 people.', 'system'), []);
});

test('Persian characters and punctuation', () => {
  assert.deepEqual(rules('سلام علي'), ['arabic-letter']);
  assert.deepEqual(rules('كتاب'), ['arabic-letter']);
  assert.deepEqual(rules('خوبی?', 'system'), ['latin-punctuation-in-persian']);
  assert.deepEqual(rules('سلام, خوبی؛ آره', 'system'), ['latin-punctuation-in-persian']);
  assert.deepEqual(rules('سلام، خوبی؟ آره؛ باشه', 'system'), []);
});

test('emoji: none in pet bubbles; the seasonal three on DM keys only; system voice untouched', () => {
  assert.deepEqual(rules('Yay 🙂'), ['emoji-in-pet-voice']);
  assert.deepEqual(rules('یلدات مبارک 🍉'), ['emoji-in-pet-voice']);
  assert.deepEqual(rules('یلدات مبارک 🍉', 'pet', true), []);
  assert.deepEqual(rules('نوروز ✨🌱', 'pet', true), []);
  assert.deepEqual(rules('Hi 🎉', 'pet', true), ['emoji-not-seasonal-in-dm']);
  assert.deepEqual(rules('📌 Get your copies', 'system'), []);
  assert.deepEqual(rules('tap ⋯, then Settings · retry ←'), []);
});

function fixture(files, fn) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'vox-pet-copy-'));
  try {
    for (const [rel, body] of Object.entries(files)) { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); }
    fn(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('collect prefers the strings module and its voice map, and adds check-in templates as DM pet voice', () => fixture({
  'src/app/studio/pet/_ui/strings/en.ts': "export const en = { 'say.hi': 'Hi!', 'perm.P1.after.yes': 'Only today!', 'sys.count': '3 notes' };\n",
  'src/app/studio/pet/_ui/strings/fa.ts': "export const fa = { 'say.hi': 'سلام 3', 'perm.P1.after.yes': 'قول می‌دم' };\n",
  'src/app/studio/pet/_ui/strings/voice.ts': "export const STRING_VOICE = { 'say.hi': 'pet', 'perm.P1.after.yes': 'pet', 'sys.count': 'system' };\n",
  'src/lib/studio/pet-checkins/templates.ts': "export const CHECKINS = { 'ci.yalda': 'یلدات مبارک! 🍉', 'ci.bad': 'Hi 🎉' };\n",
  'src/app/studio/pet/_ui/copy.ts': "export const COPY = { a: 'never read' };\n",
}, (root) => {
  const { sources, notes, violations } = run(root);
  assert.deepEqual(sources.map((s) => s.file), ['src/app/studio/pet/_ui/strings/en.ts', 'src/app/studio/pet/_ui/strings/fa.ts', 'src/lib/studio/pet-checkins/templates.ts']);
  assert.match(notes[0], /key→voice map \(STRING_VOICE: 3 keys; unmapped keys are by prefix\)/);
  assert.deepEqual(violations.map((v) => `${v.file.split('/').pop()}:${v.key}:${v.rule}`), [
    'en.ts:perm.P1.after.yes:banned-fomo',
    'fa.ts:say.hi:digit-in-pet-voice',
    'templates.ts:CHECKINS.ci.bad:emoji-not-seasonal-in-dm',
  ]);
}));

test('collect falls back to today\'s copy and says so', () => fixture({
  'src/app/studio/pet/_ui/copy.ts': "export const COPY = { restingTitle: 'Resting', talkFailed: 'Lost 2 words' };\nconst other = 'Hurry';\n",
  'src/app/studio/pet/_ui/circle-copy.ts': "const COPY = { fa: { x: 'سلام, دنیا' } } as const;\n",
  'src/lib/studio/pet-http.ts': "const N = /x/;\nconst SOUVENIRS = [\n  'I missed you',\n];\n",
}, (root) => {
  const { sources, notes, entries } = collect(root);
  assert.equal(sources.length, 3);
  assert.match(notes[0], /not found: linting today's copy/);
  assert.deepEqual(entries.map((e) => [e.key, e.voice]), [['COPY.restingTitle', 'system'], ['COPY.talkFailed', 'pet'], ['COPY.fa.x', 'system'], ['SOUVENIRS[0]', 'pet']]);
  assert.deepEqual(run(root).violations.map((v) => v.rule), ['digit-in-pet-voice', 'latin-punctuation-in-persian', 'banned-missing-you']);
}));

test('CLI prints file:key: rule: excerpt and exits 1 on a violation; --json is parseable', () => {
  const text = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.ok([0, 1].includes(text.status), text.stderr);
  assert.match(text.stdout, /^source /m);
  for (const line of text.stdout.split('\n').filter((l) => /: banned-|: digit-|: emoji-|: arabic-|: latin-|: non-persian-/.test(l)))
    assert.match(line, /^[^:]+\.ts:[^:]+: [a-z-]+: .+/);
  const json = spawnSync(process.execPath, [script, '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(json.stdout);
  assert.equal(json.status, parsed.violations.length ? 1 : 0);
  assert.ok(parsed.strings > 0);
});
