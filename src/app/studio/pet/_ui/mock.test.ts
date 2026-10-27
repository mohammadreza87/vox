import { describe, expect, it } from 'vitest';
import { createMockApi, MOCK_NAME } from './mock';

const at = () => 1_800_000_000_000;

describe('the ?mock=1 demo', () => {
  it('?ci=C5 alone seeds the bloomed garden its replay is about (N-9); an explicit garden knob still wins', async () => {
    const c5 = await createMockApi({ ci: 'C5', now: at, lang: 'en' }).get('mock');
    // bloomed an hour ago: the fresh bloom (`blooming`) the C5 replay shows
    expect(c5.play?.garden?.state).toMatch(/^bloom(ing|ed)$/);
    expect(c5.play?.book.some((p) => p.id === 'bloom')).toBe(true);
    const seeded = await createMockApi({ ci: 'C5', garden: 'seeded', now: at, lang: 'en' }).get('mock');
    expect(seeded.play?.garden?.state).toBe('seeded');
    const plain = await createMockApi({ now: at, lang: 'en' }).get('mock');
    expect(plain.play?.garden).toBeNull();
  });

  it('speaks the page language: the name, the room moments as production words them, the welcome souvenir (P-09, P-12, P-21)', async () => {
    const fa = await createMockApi({ welcome: true, now: at, lang: 'fa' }).get('mock');
    expect(fa.name).toBe(MOCK_NAME.fa);
    expect(fa.welcome?.souvenir).toBe('سلام! یه پرش حسابی تمرین کردم، ببین!');
    const en = await createMockApi({ welcome: true, now: at, lang: 'en' }).get('mock');
    expect(en.welcome?.souvenir).toBe('Hi again! I practised my best hop.');
    expect(en.growth?.moments.find((m) => m.id === 'room-play')?.title).toBe('We found the Play room together');
  });

  it('answers the common openers in the pet voice, in both languages (P-13, P-30)', async () => {
    const en = await createMockApi({ now: at, lang: 'en', latency: { talk: 0 } }).talk('mock', { text: 'How was your day?' } as never);
    expect(en.reply).toMatch(/How was yours\?$/);
    const fa = await createMockApi({ now: at, lang: 'fa', latency: { talk: 0 } }).talk('mock', { text: 'روزت چطور بود؟' } as never);
    expect(fa.reply).toBe('خوب بود! پرش تمرین کردم و ابرها رو تماشا کردم. روز تو چطور بود؟');
    expect(fa.reply).not.toMatch(/[0-9۰-۹]/);
  });
});
