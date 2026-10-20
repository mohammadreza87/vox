import { describe, expect, it } from 'vitest';
import { ackText, explicitRemember, forceQuickTriage, IMAGE_ACK_TEXT, IMAGE_TRIAGE_TIMEOUT_MS, imagePolicy, replyDetail, type ImageTriage } from '../images';
import { TRIAGE_TIMEOUT_MS, type Triage } from '../triage';

const triage = (partial: Partial<ImageTriage> = {}): ImageTriage =>
  ({ kind: 'other', task: 'explain', containsPeople: 0, containsSensitiveDocument: 0, ...partial });

describe('imagePolicy retention', () => {
  it('stores nothing without triage and assumes people', () => {
    expect(imagePolicy(null, 'remember this', true)).toEqual({ suppressMemory: true, containsPeople: true, forceQuick: false });
  });

  it('stores a remember task only below the sensitive threshold', () => {
    expect(imagePolicy(triage({ task: 'remember', containsSensitiveDocument: 0.49 }), '', true).suppressMemory).toBe(false);
    expect(imagePolicy(triage({ task: 'remember', containsSensitiveDocument: 0.5 }), '', true).suppressMemory).toBe(true);
  });

  it('honours an explicit caption request and its negation', () => {
    expect(imagePolicy(triage({ task: 'explain', containsSensitiveDocument: 0.1 }), 'remember this', true).suppressMemory).toBe(false);
    expect(imagePolicy(triage({ task: 'explain', containsSensitiveDocument: 0.1 }), "don't save this", true).suppressMemory).toBe(true);
    expect(imagePolicy(triage({ task: 'explain', containsSensitiveDocument: 0.1 }), 'what is this?', true).suppressMemory).toBe(true);
    expect(imagePolicy(triage({ task: 'explain', containsSensitiveDocument: 0.9 }), 'remember this', true).suppressMemory).toBe(true);
  });

  it('flags people by kind or by a protective probability threshold', () => {
    expect(imagePolicy(triage({ kind: 'photo_of_people', containsPeople: 0 }), '', true).containsPeople).toBe(true);
    expect(imagePolicy(triage({ kind: 'chart', containsPeople: 0.3 }), '', true).containsPeople).toBe(true);
    expect(imagePolicy(triage({ kind: 'chart', containsPeople: 0.29 }), '', true).containsPeople).toBe(false);
  });

  it('forces the quick vision route for quick tasks, or whenever the main model cannot see', () => {
    for (const task of ['explain', 'extract_text', 'decide', 'react'] as const) expect(imagePolicy(triage({ task }), '', true).forceQuick).toBe(true);
    for (const task of ['remember', 'unclear'] as const) expect(imagePolicy(triage({ task }), '', true).forceQuick).toBe(false);
    for (const task of ['remember', 'unclear', 'explain'] as const) expect(imagePolicy(triage({ task }), '', false).forceQuick).toBe(true);
    expect(imagePolicy(null, '', false).forceQuick).toBe(true);
  });
});

describe('explicitRemember', () => {
  it('matches English and Persian requests', () => {
    expect(explicitRemember('Remember this please')).toBe(true);
    expect(explicitRemember('save it for later')).toBe(true);
    expect(explicitRemember('یادت باشه این رسید ناهاره')).toBe(true);
    expect(explicitRemember('اینو به خاطر بسپار')).toBe(true);
    expect(explicitRemember('look at this')).toBe(false);
  });

  it('lets any negation win', () => {
    expect(explicitRemember("don't save this")).toBe(false);
    expect(explicitRemember('don’t remember this')).toBe(false);
    expect(explicitRemember('never keep this, but remember this')).toBe(false);
    expect(explicitRemember('ذخیره نکن')).toBe(false);
    expect(explicitRemember('forget this')).toBe(false);
  });
});

describe('replyDetail', () => {
  it('maps triage to a resolution tier', () => {
    expect(replyDetail(null)).toBe('standard');
    expect(replyDetail(triage({ kind: 'other', task: 'extract_text' }))).toBe('detail');
    expect(replyDetail(triage({ kind: 'receipt', task: 'explain' }))).toBe('detail');
    expect(replyDetail(triage({ kind: 'screenshot', task: 'react' }))).toBe('detail');
    expect(replyDetail(triage({ kind: 'photo_of_people', task: 'react' }))).toBe('low');
    expect(replyDetail(triage({ kind: 'meme', task: 'unclear' }))).toBe('low');
    expect(replyDetail(triage({ kind: 'photo_of_people', task: 'explain' }))).toBe('standard');
    expect(replyDetail(triage({ kind: 'other', task: 'decide' }))).toBe('standard');
  });
});

describe('forceQuickTriage', () => {
  it('turns a missing triage into a quick, search-free one and keeps skillAsked', async () => {
    const out = await forceQuickTriage(Promise.resolve({ triage: null as Triage | null, skillAsked: true }));
    expect(out.skillAsked).toBe(true);
    expect(out.triage).toEqual({ memorable: true, wantsVoice: false, effort: 'quick', needsWeb: false });
    expect(out.triage).not.toHaveProperty('skills');
  });

  it('keeps skills and skillsMiss and never mutates the original', async () => {
    const original = { triage: { effort: 'thoughtful', needsWeb: true, memorable: false, wantsVoice: true, skills: null, skillsMiss: 'low_confidence' } as Triage, skillAsked: true };
    const snapshot = JSON.stringify(original);
    const out = await forceQuickTriage(Promise.resolve(original));
    expect(out.triage).toEqual({ effort: 'quick', needsWeb: false, memorable: false, wantsVoice: true, skills: null, skillsMiss: 'low_confidence' });
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(out).not.toBe(original);
  });
});

describe('acknowledgement and timeouts', () => {
  it('acknowledges in Persian for a Persian caption and in English otherwise', () => {
    expect(ackText('این چیه؟')).toBe(IMAGE_ACK_TEXT.fa);
    expect(ackText('what is this?')).toBe(IMAGE_ACK_TEXT.en);
    expect(ackText('')).toBe(IMAGE_ACK_TEXT.en);
  });

  it('reuses the text triage timeout', () => {
    expect(IMAGE_TRIAGE_TIMEOUT_MS).toBe(TRIAGE_TIMEOUT_MS);
    expect(IMAGE_TRIAGE_TIMEOUT_MS).toBe(2000);
  });
});
