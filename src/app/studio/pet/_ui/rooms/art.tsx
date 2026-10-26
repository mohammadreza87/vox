/**
 * The rooms' small illustrations, in the Home toys' style (Particles.tsx: vinyl-toy minimal, two tones and a highlight,
 * no outlines on fills): the Closet's item cells and slot verbs (P-10), the Life Book's tab verbs and its page doodle
 * (P-11). Loaded with the room chunks only. Every icon is decorative (aria-hidden); its button carries the name.
 */

import type { ReactElement } from 'react';
import type { WearableId, WearSlot } from '@/lib/pet/play';
import type { Accessory } from '@/lib/studio/types';

const Svg = ({ children }: { children: React.ReactNode }) => <svg viewBox="0 0 32 32" aria-hidden="true">{children}</svg>;
const HI = '#ffffffb3';

const star = (cx: number, cy: number, r: number) => {
  const p: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2, d = i % 2 ? r * 0.45 : r;
    p.push(`${(cx + d * Math.cos(a)).toFixed(1)} ${(cy + d * Math.sin(a)).toFixed(1)}`);
  }
  return `M${p.join('L')}z`;
};
const petals = (cx: number, cy: number, r: number, fill: string, core: string) => (
  <>
    {[0, 72, 144, 216, 288].map((a) => <circle key={a} cx={cx + r * Math.sin((a * Math.PI) / 180)} cy={cy - r * Math.cos((a * Math.PI) / 180)} r={r * 0.78} fill={fill} />)}
    <circle cx={cx} cy={cy} r={r * 0.62} fill={core} />
  </>
);

/** One drawing per wearable (play.ts ids) and per real-look accessory (Studio's vocabulary, `none` included). */
const ITEM: Record<string, () => ReactElement> = {
  glasses: () => <Svg><path d="M13 17h6" stroke="#E6E2D8" strokeWidth="2.2" fill="none" /><circle cx="9.5" cy="17" r="5" fill="#9FD3FF66" stroke="#E6E2D8" strokeWidth="2.4" /><circle cx="22.5" cy="17" r="5" fill="#9FD3FF66" stroke="#E6E2D8" strokeWidth="2.4" /><path d="M7 15.5a3 3 0 0 1 2.5-1.8" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" fill="none" /></Svg>,
  specs: () => <Svg><path d="M13.5 16.5h5" stroke="#B5674A" strokeWidth="2.2" fill="none" /><rect x="3.5" y="12.5" width="10" height="8" rx="2.5" fill="#FFE27A55" stroke="#B5674A" strokeWidth="2.4" /><rect x="18.5" y="12.5" width="10" height="8" rx="2.5" fill="#FFE27A55" stroke="#B5674A" strokeWidth="2.4" /></Svg>,
  beret: () => <Svg><ellipse cx="16" cy="19" rx="12.5" ry="6.5" fill="#A8344A" /><ellipse cx="16" cy="17.5" rx="12.5" ry="6.5" fill="#D9536B" /><circle cx="16" cy="10.5" r="2" fill="#A8344A" /><path d="M8 16a8 4 0 0 1 6-2.6" stroke={HI} strokeWidth="1.8" strokeLinecap="round" fill="none" /></Svg>,
  cap: () => <Svg><path d="M5 21a11 11 0 0 1 22 0z" fill="#3D7BD9" /><path d="M16 21h12.5a2.5 2.5 0 0 1-2.5 3H16z" fill="#2A5DAE" /><circle cx="16" cy="10" r="1.6" fill="#2A5DAE" /><path d="M9 17a7 7 0 0 1 4-4.5" stroke={HI} strokeWidth="1.8" strokeLinecap="round" fill="none" /></Svg>,
  beanie: () => <Svg><path d="M6 21a10 10 0 0 1 20 0z" fill="#5FB58F" /><rect x="5" y="20" width="22" height="5" rx="2.5" fill="#3F8F6C" /><circle cx="16" cy="9" r="3" fill="#F2F1EC" /><path d="M10 17a6.5 6.5 0 0 1 3.5-4" stroke={HI} strokeWidth="1.8" strokeLinecap="round" fill="none" /></Svg>,
  headphones: () => <Svg><path d="M6 20v-3a10 10 0 0 1 20 0v3" stroke="#E6E2D8" strokeWidth="2.6" fill="none" strokeLinecap="round" /><rect x="3.5" y="17.5" width="6" height="9" rx="3" fill="#FF8FB1" /><rect x="22.5" y="17.5" width="6" height="9" rx="3" fill="#FF8FB1" /></Svg>,
  headset: () => <Svg><path d="M6 19v-2a10 10 0 0 1 20 0v2" stroke="#E6E2D8" strokeWidth="2.6" fill="none" strokeLinecap="round" /><rect x="3.5" y="16.5" width="6" height="9" rx="3" fill="#9FD3FF" /><path d="M6.5 25.5c0 2.5 3 3.5 8 3.5" stroke="#E6E2D8" strokeWidth="2" fill="none" strokeLinecap="round" /><circle cx="15.5" cy="29" r="1.8" fill="#D6FF5C" /></Svg>,
  bow: () => <Svg><path d="M16 16 5 9.5v13zM16 16l11-6.5v13z" fill="#FF8FB1" /><path d="M16 16 5 9.5v6z" fill="#FFB3CA" /><rect x="13" y="12.5" width="6" height="7" rx="2.5" fill="#E2668F" /></Svg>,
  flower: () => <Svg>{petals(16, 16, 6.5, '#FFB3CA', '#FFE27A')}</Svg>,
  star: () => <Svg><path d={star(16, 17, 12.5)} fill="#F5C842" /><path d={star(16, 16, 11.5)} fill="#FFE27A" /><circle cx="12.5" cy="13.5" r="1.6" fill="#fff9" /></Svg>,
  bowtie: () => <Svg><path d="M16 16 5 10v12zM16 16l11-6v12z" fill="#7A6CF0" /><rect x="13" y="13" width="6" height="6" rx="2" fill="#5B4FD0" /><path d="M7 13.5 12 16" stroke={HI} strokeWidth="1.6" strokeLinecap="round" /></Svg>,
  pomegranateCrown: () => <Svg><path d="M5 23 7 10l5 6 4-8 4 8 5-6 2 13z" fill="#F2C14E" /><rect x="5" y="22" width="22" height="4" rx="1.5" fill="#D9A23A" /><circle cx="16" cy="18" r="3.4" fill="#C8102E" /><circle cx="15" cy="17" r="1" fill="#fff9" /></Svg>,
  sparkScarf: () => <Svg><path d="M4 12c6 3 18 3 24 0v6c-6 3-18 3-24 0z" fill="#D6FF5C" /><path d="M19 17l4 11h-6l-1-10z" fill="#B8E040" /><path d="M8 14.5h3M14 15.5h3" stroke="#0E101333" strokeWidth="1.6" strokeLinecap="round" /></Svg>,
  sabzehSprout: () => <Svg><path d="M7 21h18l-2 7H9z" fill="#B5674A" /><rect x="6" y="19" width="20" height="3.5" rx="1.5" fill="#C97B5C" /><path d="M10 19c0-5-2-8-2-8M13 19c0-6 1-10 1-10M16 19V7M19 19c0-6-1-10-1-10M22 19c0-5 2-8 2-8" stroke="#7BC67E" strokeWidth="2" strokeLinecap="round" fill="none" /></Svg>,
  starPin: () => <Svg><circle cx="16" cy="16" r="11" fill="#2B3A55" /><path d={star(16, 16.5, 8)} fill="#FFE27A" /></Svg>,
  bloomPin: () => <Svg><circle cx="16" cy="16" r="11" fill="#3F8F6C" />{petals(16, 16, 4.6, '#FFB3CA', '#FFE27A')}</Svg>,
  none: () => <Svg><circle cx="16" cy="16" r="10" fill="none" stroke="#A9ADB5" strokeWidth="2.4" /><path d="M9 23 23 9" stroke="#A9ADB5" strokeWidth="2.4" strokeLinecap="round" /></Svg>,
};

export function ItemIcon({ id }: { id: WearableId | Accessory }) {
  const Draw = ITEM[id] ?? ITEM.star;
  return <Draw />;
}

/**
 * The Closet's three slot verbs (the room's dock): a hat, a scarf, a little mitten. Neck is a scarf, never a bow: the
 * Closet's keepsake bow is worn on the head (and the Bow item is a head item), so a bow on Neck filed it there (N-7).
 */
const SLOT: Record<WearSlot, () => ReactElement> = {
  head: ITEM.beret,
  neck: () => <Svg><path d="M5 11c6 3.5 16 3.5 22 0v6c-6 3.5-16 3.5-22 0z" fill="#3D7BD9" /><path d="M19 16l4.5 11h-6.5l-1.5-10z" fill="#2A5DAE" /><path d="M9 13.2v5.6M14 14.2v5.6M24 12.6v5.2" stroke="#F2F1EC" strokeWidth="1.8" strokeLinecap="round" /></Svg>,
  hand: () => <Svg><path d="M9 27V15a3 3 0 0 1 6 0v-3a3 3 0 0 1 6 0v6.5l2-2a2.6 2.6 0 0 1 3.7 3.6L21 27z" fill="#F2A65A" /><rect x="8" y="24.5" width="14" height="4" rx="2" fill="#D9873A" /><path d="M11.5 14v5" stroke={HI} strokeWidth="1.6" strokeLinecap="round" /></Svg>,
};
export const SlotIcon = ({ slot }: { slot: WearSlot }) => SLOT[slot]();

/** The Life Book's four tab verbs (its dock): an open book, a ribboned keepsake, a lit spark, the little cloud. */
export type BookTab = 'pages' | 'keepsakes' | 'learned' | 'about';
const TAB: Record<BookTab, () => ReactElement> = {
  pages: () => <Svg><path d="M16 9c-3-2-7-2.5-11-1.5v16c4-1 8-.5 11 1.5z" fill="#F4EBD9" /><path d="M16 9c3-2 7-2.5 11-1.5v16c-4-1-8-.5-11 1.5z" fill="#E6D8BC" /><path d="M8 12.5c2-.4 4-.2 5.5.4M8 16c2-.4 4-.2 5.5.4" stroke="#14202c55" strokeWidth="1.4" strokeLinecap="round" fill="none" /></Svg>,
  keepsakes: () => <Svg><rect x="6" y="13" width="20" height="14" rx="3" fill="#D9536B" /><rect x="5" y="10" width="22" height="5" rx="2" fill="#FF8FB1" /><path d="M16 10v17" stroke="#FFE27A" strokeWidth="3" /><path d="M16 10c-2-4-7-4-6-1s6 1 6 1 5 2 6-1-4-3-6 1z" fill="#FFE27A" /></Svg>,
  learned: () => <Svg><circle cx="16" cy="14" r="8.5" fill="#FFE27A" /><path d="M12.5 21.5h7v3.5a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2z" fill="#A9ADB5" /><path d="M12 11a5 5 0 0 1 3.5-2.8" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" fill="none" /></Svg>,
  about: () => <Svg><path d="M8 25a6 6 0 0 1-1-11.9 8 8 0 0 1 15.4-1.6A6.5 6.5 0 0 1 24 25z" fill="#7FE0D0" /><circle cx="13" cy="18" r="1.4" fill="#14202C" /><circle cx="19" cy="18" r="1.4" fill="#14202C" /><path d="M14 21.5a3 3 0 0 0 4 0" stroke="#14202C" strokeWidth="1.4" strokeLinecap="round" fill="none" /></Svg>,
};
export const TabIcon = ({ tab }: { tab: BookTab }) => TAB[tab]();

/** The left page of a Life Book spread: the pet drawn in ink, as a child draws it (dashed while a moment is unlit). */
export function Doodle({ faint }: { faint?: boolean }) {
  return (
    <svg className="pet-doodle" viewBox="0 0 64 56" aria-hidden="true">
      <path d="M14 46a10 10 0 0 1-2-19.8A14 14 0 0 1 39 21a11 11 0 0 1 12 15 9 9 0 0 1-3 10z" fill={faint ? 'none' : '#7FE0D0'} stroke="#14202C" strokeWidth="2"
        strokeLinejoin="round" strokeDasharray={faint ? '3 4' : undefined} />
      {!faint && <><circle cx="26" cy="34" r="2" fill="#14202C" /><circle cx="37" cy="34" r="2" fill="#14202C" /><path d="M28.5 39a4 4 0 0 0 6 0" stroke="#14202C" strokeWidth="1.8" strokeLinecap="round" fill="none" /></>}
      <path d="M8 50h48" stroke="#14202C40" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The Garden's and Bedroom's dock verbs (P-23), drawn like Home's cookie, ball and moon: every dock in one style.
 * (The Bedroom's moon is Home's own MoonIcon.)
 */
export const SeedIcon = () => <Svg><path d="M16 18v-6" stroke="#5FB58F" strokeWidth="2.4" strokeLinecap="round" /><path d="M16 12c0-4 3-6.5 7.5-6.5 0 4-3 6.5-7.5 6.5z" fill="#7BC67E" /><path d="M16 13c0-3.2-2.6-5.5-6.5-5.5 0 3.2 2.6 5.5 6.5 5.5z" fill="#5FB58F" /><ellipse cx="16" cy="23" rx="7.5" ry="5.5" fill="#B9773F" /><ellipse cx="16" cy="22" rx="7.5" ry="5.5" fill="#E3A35E" /><path d="M11 20.5a5 3 0 0 1 3.5-2" stroke="#F6CF95" strokeWidth="1.8" strokeLinecap="round" fill="none" /></Svg>;
export const RainIcon = () => <Svg><path d="M9 20a5.5 5.5 0 0 1-.8-10.9 7.5 7.5 0 0 1 14.4-1.4A5.6 5.6 0 0 1 23 20z" fill="#7FB8E6" /><path d="M9 18.5a5.5 5.5 0 0 1-.8-10.9 7.5 7.5 0 0 1 14.4-1.4A5.6 5.6 0 0 1 23 18.5z" fill="#BFE1FF" /><path d="M11 23.5l-1 3M16 23.5l-1 3M21 23.5l-1 3" stroke="#4A9FE0" strokeWidth="2.4" strokeLinecap="round" /><path d="M10.5 11.5a4 4 0 0 1 3-2.6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" fill="none" /></Svg>;
export const BreatheIcon = () => <Svg><circle cx="16" cy="16" r="12" fill="#3F8F6C" /><circle cx="16" cy="16" r="8" fill="#7FE0D0" /><circle cx="16" cy="16" r="3.6" fill="#F2F1EC" /><path d="M10 12.5a7 7 0 0 1 3.5-3.6" stroke="#ffffffb3" strokeWidth="1.8" strokeLinecap="round" fill="none" /></Svg>;
export const LampIcon = () => <Svg><path d="M11 5h10l4 11H7z" fill="#F2C14E" /><path d="M11 5h10l1.2 3.4H9.8z" fill="#FFE27A" /><rect x="15" y="16" width="2.4" height="8" fill="#A9ADB5" /><rect x="9.5" y="23.5" width="13" height="3.5" rx="1.75" fill="#8A8F98" /><path d="M12 9.5 10.4 14" stroke="#fff9" strokeWidth="1.6" strokeLinecap="round" /></Svg>;
export const StoryIcon = () => <Svg><rect x="8" y="5" width="18" height="22" rx="2.5" fill="#F4EBD9" /><rect x="6" y="4" width="18" height="22" rx="2.5" fill="#7A6CF0" /><rect x="6" y="4" width="4" height="22" rx="2" fill="#5B4FD0" /><path d={star(17, 14.5, 5.5)} fill="#FFE27A" /></Svg>;
