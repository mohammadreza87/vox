import { act, fireEvent, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeightClass } from '../layout';
import { care, emptyPlay, fakeHost } from '../host.fixture';
import { loadStrings, t, type PetLang, type PetStringKey } from '../strings';
import BedroomRoom from './BedroomRoom';
import BookRoom from './BookRoom';
import ClosetRoom, { slotItems, slotOf } from './ClosetRoom';
import { ItemIcon } from './art';
import GardenRoom from './GardenRoom';
import PlayRoom from './PlayRoom';
import { ROOM_VERBS } from '.';

/**
 * One stable bottom stack (design §9.3; visual QA P-05, P-06, P-19): the rail sits at the same height in every room of a
 * layout class. jsdom has no layout, so this pins the two things that decide it: the CSS gives every part of the stack
 * a fixed height per class (rail, 16, dock slot = --pet-toy, 16, pill, 14 + safe-bottom), and every room puts only a
 * slot-sized element in the flow of the slot (its verbs or Guess's links); anything taller is a tray, absolutely
 * positioned above the rail. Together: rail top = available height − the class's constant stack.
 */
const css = (f: string) => readFileSync(join(process.cwd(), 'src/app/studio/pet', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const PET = css('pet.css');
const ROOMS = css('_ui/rooms/rooms.css');
function rule(src: string, sel: string): Record<string, string> {
  const at = src.split('}').find((r) => r.split('{')[0].trim() === sel);
  if (!at) throw new Error(`no rule ${sel}`);
  return Object.fromEntries(at.split('{').slice(-1)[0].split(';').map((d) => d.split(':').map((x) => x.trim())).filter((d) => d[0]).map(([k, ...v]) => [k, v.join(':')]));
}
const px = (v: string) => Number(v.replace('px', ''));
const tok = (h: HeightClass, name: string) => (h === 'regular' ? undefined : rule(PET, `.pet-root[data-h=${h}]`)[name]) ?? rule(PET, '.pet-root')[name];

let stage: HTMLElement;
beforeAll(async () => { await loadStrings('en'); await loadStrings('fa'); });
beforeEach(() => { stage = document.createElement('div'); stage.className = 'pet-stage'; document.body.appendChild(stage); });
afterEach(() => { stage.remove(); localStorage.clear(); });

describe('the bottom stack (§9.3): the rail top is one height per layout class, in every room', () => {
  it('every part of the stack has a fixed height per class', () => {
    expect(rule(PET, '.pet-bottom').gap).toBe('16px');
    expect(rule(PET, '.pet-bottom').padding).toMatch(/\+ 14px\)$/);
    expect(rule(PET, '.pet-rail').height).toBe('32px');
    expect(rule(PET, '.pet-root[data-h=tall] .pet-rail').height).toBe('44px');
    expect(rule(PET, '.pet-row, .pet-dock').height).toBe('var(--pet-toy)');
    expect(rule(PET, '.pet-pill').height).toBe('var(--pet-pill)');
    // the slot's contents are exactly the slot: a verb is a toy-sized circle and one 16 px label line
    for (const sel of ['.pet-verbs', '.pet-links', '.pet-soon']) expect(rule(ROOMS, sel).height).toBe('var(--pet-toy)');
    expect(rule(ROOMS, '.pet-verb > i').height).toBe('calc(var(--pet-toy) - 16px)');
    expect(rule(ROOMS, '.pet-verb')['line-height']).toBe('16px');
    expect(rule(ROOMS, '.pet-verb > span')['white-space']).toBe('nowrap');
    // a tray never takes the slot's place in the flow: it opens upward above the rail
    expect(rule(ROOMS, '.pet-tray')).toMatchObject({ position: 'absolute', bottom: 'calc(100% + 12px)' });
    // §9.3 vertical budget, per class: identical in every room because nothing above depends on the room
    const stack = (h: HeightClass) => (h === 'tall' ? 44 : 32) + 16 + px(tok(h, '--pet-toy')) + 16 + px(tok(h, '--pet-pill')) + 14;
    expect((['peek', 'short', 'regular', 'tall'] as const).map(stack)).toEqual([32 + 16 + 56 + 16 + 52 + 14, 32 + 16 + 60 + 16 + 48 + 14, 198, 210]);
  });

  /** What a room puts in the slot's flow: everything that is not a tray, a sheet or a portal elsewhere. */
  const inFlow = (c: HTMLElement) => [...c.children].filter((e) => !e.classList.contains('pet-tray') && !e.classList.contains('pet-sheet'));
  const slotOnly = (c: HTMLElement, why: string) => {
    const flow = inFlow(c);
    expect(flow, why).toHaveLength(1);
    expect(['pet-verbs', 'pet-links'].some((k) => flow[0].classList.contains(k)), `${why}: ${flow[0].className}`).toBe(true);
  };

  it('every room, in every phase, keeps to the slot: Play (picker, round, end, Guess), Closet, Life Book, Garden, Bedroom', async () => {
    const host = () => { const h = fakeHost({ play: emptyPlay({ games: { starfall: { rounds: 'one', best: false, zen: false } } }) }); h.send = vi.fn(async () => true); return h; };
    let r = render(<PlayRoom id="play" host={host()} />);
    slotOnly(r.container, 'Play picker');
    fireEvent.click(r.getByRole('button', { name: 'Starfall' }));
    slotOnly(r.container, 'Play round');
    await act(async () => { fireEvent.click(r.getByRole('button', { name: 'Done' })); });
    slotOnly(r.container, 'Play end');
    r.unmount();
    r = render(<PlayRoom id="play" host={host()} />);
    await act(async () => { fireEvent.click(r.getByRole('button', { name: 'Guess' })); });
    slotOnly(r.container, 'Guess');
    r.unmount();
    r = render(<PlayRoom id="play" host={fakeHost({ care: care({ energy: 10 }) })} />);
    slotOnly(r.container, 'Play, tired');
    r.unmount();
    for (const [name, el] of [['Closet', <ClosetRoom key="c" id="closet" host={fakeHost({ role: 'owner', canEditLook: true })} />],
      ['Life Book', <BookRoom key="b" id="book" host={fakeHost()} />], ['Garden', <GardenRoom key="g" id="garden" host={fakeHost()} />],
      ['Bedroom', <BedroomRoom key="r" id="bedroom" host={fakeHost()} />]] as const) {
      r = render(el);
      slotOnly(r.container, name);
      r.unmount();
    }
  });

  it('Play: three games in the dock (P-06), Zen is the switch at the top, not a dock item; Guess stays a game', () => {
    const h = fakeHost();
    h.send = vi.fn(async () => true);
    const { container } = render(<PlayRoom id="play" host={h} />);
    expect([...container.querySelectorAll('.pet-verbs > .pet-verb')].map((b) => b.textContent)).toEqual(['Bop', 'Starfall', 'Guess']);
    expect(document.body.querySelector('.pet-zen')?.textContent).toBe('Zen');
    expect(container.querySelector('.pet-zen')).toBeNull();
    // evenly spaced: one column per verb on the Home toys' pitch, never wider than the row inside the 16 px gutters
    expect(rule(ROOMS, '.pet-verbs')).toMatchObject({ display: 'grid', 'grid-auto-columns': 'minmax(0, calc(var(--pet-toy) + var(--pet-gap)))', 'justify-content': 'center' });
  });
});

/**
 * One-line dock labels (P-06, P-11): every verb label fits its column at 360 px wide in both languages. The column is the
 * Home toys' pitch (toy + gap = 98 px in Regular/Tall) or the row inside the 16 px gutters shared out, whichever is
 * smaller. Character model at the 12 px label size: Onest ~7.0 px a character, Vazirmatn ~6.2 (measured on the QA
 * screenshots at 11 px and 16 px and scaled); a device check stays the real proof.
 */
describe('dock labels are one line at 360 px, English and Persian', () => {
  const COL = (n: number) => Math.min(68 + 30, (360 - 32) / n);
  const PER_CHAR: Record<PetLang, number> = { en: 7.0, fa: 6.2 };
  const width = (s: string, lang: PetLang) => [...s.replace(/[‌⁨⁩]/g, '')].length * PER_CHAR[lang];
  const labels: [string, PetStringKey[]][] = [
    ['play', ['toy.play.bop', 'play.starfall.title', 'toy.play.guess']],
    ['book', ['book.tab.pages', 'book.tab.keepsakes', 'book.tab.learned', 'book.tab.about']],
    ...(['closet', 'garden', 'bedroom'] as const).map((r): [string, PetStringKey[]] => [r, [...ROOM_VERBS[r]]]),
  ];
  for (const lang of ['en', 'fa'] as const) {
    it(lang, () => {
      for (const [room, keys] of labels) {
        for (const k of keys) expect(width(t(k, undefined, lang), lang), `${room} ${k} «${t(k, undefined, lang)}»`).toBeLessThanOrEqual(COL(keys.length));
      }
    });
  }
});

describe('second-pass polish (PET_VISUAL_QA_2026_10_26_AFTER)', () => {
  it('N-4: one page has no pager row under the card; several pages, or About me with its Visits link, keep it', () => {
    const one = render(<BookRoom id="book" host={fakeHost()} />);
    expect(one.container.querySelector('.pet-nav')).toBeNull();
    fireEvent.click(one.getByRole('tab', { name: 'About me' }));
    expect(one.container.querySelector('.pet-nav')?.textContent).toContain('Visits');
    one.unmount();
    const two = render(<BookRoom id="book" host={fakeHost({ play: emptyPlay({ book: [{ id: 'met', at: 1 }, { id: 'stage2', at: 2 }] }) })} />);
    expect(two.container.querySelectorAll('.pet-nav .pet-dots i')).toHaveLength(2);
  });

  it('N-6: the Zen chip sits under the top safe area (Telegram\'s content inset included) and 16 px from the edges', () => {
    const z = rule(ROOMS, '.pet-zen');
    const border = px(z.border.split(' ')[0]);
    expect(z.top).toMatch(/^calc\(var\(--pet-safe-top,env\(safe-area-inset-top,0px\)\) \+ (\d+)px\)$/);
    expect(Number(/\+ (\d+)px/.exec(z.top)![1]) + border).toBeGreaterThanOrEqual(16);
    expect(Number(/max\((\d+)px/.exec(z['inset-inline-start'])![1]) + border).toBeGreaterThanOrEqual(16);
    expect(z.border).toMatch(/transparent/);
    // the safe top the chip reads is device inset + Telegram's content inset (telegram.ts syncSafeAreas)
    const tg = readFileSync(join(process.cwd(), 'src/app/studio/pet/_ui/telegram.ts'), 'utf8');
    expect(tg).toMatch(/const top = \(app\.safeAreaInset\?\.top \?\? 0\) \+ \(app\.contentSafeAreaInset\?\.top \?\? 0\);/);
  });

  it('N-7: the bow is a Head item (the Closet keepsake bow is worn on the head), and the Neck slot is not drawn as a bow', () => {
    expect(slotOf('bow')).toBe('head');
    expect(slotItems(undefined, 'head')).toContain('bow');
    expect(slotItems(undefined, 'neck')).not.toContain('bow');
    const { container } = render(<ClosetRoom id="closet" host={fakeHost()} />);
    const neck = [...container.querySelectorAll('.pet-verbs .pet-verb')].find((b) => b.textContent === 'Neck')!.querySelector('svg')!.innerHTML;
    for (const id of ['bow', 'bowtie'] as const) expect(neck).not.toBe(renderToStaticMarkup(<ItemIcon id={id} />).replace(/^<svg[^>]*>|<\/svg>$/g, ''));
  });

  it('P-23: every dock is drawn in the Home toys\' style: filled, coloured art, never a currentColor line icon', () => {
    for (const el of [<PlayRoom key="p" id="play" host={Object.assign(fakeHost(), { send: vi.fn(async () => true) })} />, <ClosetRoom key="c" id="closet" host={fakeHost()} />,
      <BookRoom key="b" id="book" host={fakeHost()} />, <GardenRoom key="g" id="garden" host={fakeHost()} />, <BedroomRoom key="r" id="bedroom" host={fakeHost()} />]) {
      const { container, unmount } = render(el);
      const icons = [...container.querySelectorAll('.pet-verbs .pet-verb > i > svg')];
      expect(icons.length).toBeGreaterThanOrEqual(2);
      for (const svg of icons) {
        expect(svg.querySelector('[stroke="currentColor"], [fill="currentColor"]'), svg.outerHTML.slice(0, 80)).toBeNull();
        expect([...svg.querySelectorAll('[fill]')].some((n) => /^#/.test(n.getAttribute('fill')!)), svg.outerHTML.slice(0, 80)).toBe(true);
      }
      unmount();
    }
  });

  it('N-3: the tray is opaque, the days chip waits out the tray rooms, and Short gets a lower tray', () => {
    expect(rule(ROOMS, '.pet-tray').background).toBe('#16191E');
    expect(rule(ROOMS, '.pet-root:is([data-room=closet], [data-room=book]) .pet-days').visibility).toBe('hidden');
    expect(rule(ROOMS, '.pet-root:is([data-h=short], [data-h=peek]) .pet-grid')['grid-template-rows']).toBe('repeat(2, 44px)');
  });
});
