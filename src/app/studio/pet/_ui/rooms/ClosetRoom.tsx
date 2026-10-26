'use client';

import { useEffect, useRef, useState } from 'react';
import { FREE_ACCESSORIES, KEEPSAKES, WEAR_SLOTS, WEARABLE_IDS, type KeepsakeId, type PetPlayView, type WearableId, type WearSlot } from '@/lib/pet/play';
import type { Accessory } from '@/lib/studio/types';
import { Sheet } from '../Sheet';
import { pick, t, type PetStringKey } from '../strings';
import type { RoomProps } from '.';
import './rooms.css';

/** Six items a page (§4.3), swiped by page with dots; nothing scrolls. */
export const PAGE = 6;
const SLOT_KEY: Record<WearSlot, PetStringKey> = { head: 'toy.closet.head', neck: 'toy.closet.neck', hand: 'toy.closet.hand' };
/** The real look's single accessory (Studio's vocabulary, src/lib/studio/types.ts `Accessory`), `none` first. */
export const LOOK_ACCESSORIES: readonly Accessory[] = ['none', ...Object.keys(FREE_ACCESSORIES) as Accessory[]];

const isKeepsake = (id: WearableId): id is KeepsakeId => id in KEEPSAKES;
export const slotOf = (id: WearableId): WearSlot => (isKeepsake(id) ? KEEPSAKES[id].slot : FREE_ACCESSORIES[id as keyof typeof FREE_ACCESSORIES]);
/** How a keepsake is earned, from the strings (never a price; seasonal ones "arrive with" the festival). */
export function earnKey(id: KeepsakeId): PetStringKey {
  const e = KEEPSAKES[id].earn;
  return 'season' in e ? `closet.lock.${e.season}` as PetStringKey : 'bloom' in e ? 'closet.lock.bloom' : 'closet.lock.bond';
}
/** An item is the person's to wear: every free accessory, and the keepsakes they earned (`play.items`). */
export const owned = (play: PetPlayView | undefined, id: WearableId) => !isKeepsake(id) || !!play?.items.some((i) => i.id === id);
/** The slot's items, earned keepsakes first, then the free ones, then the locked keepsakes. */
export function slotItems(play: PetPlayView | undefined, slot: WearSlot): WearableId[] {
  const all = WEARABLE_IDS.filter((id) => slotOf(id) === slot);
  const rank = (id: WearableId) => (isKeepsake(id) ? (owned(play, id) ? 0 : 2) : 1);
  return [...all].sort((a, b) => rank(a) - rank(b));
}

/** The real look's tab (§4.3): only where the server says so (`view.canEditLook`: the creator or an admin, never a guest or a launch). */
export const canEditLook = (v: ReturnType<NonNullable<RoomProps['host']>['view']>) => !!v?.canEditLook && !v.talkInDm;

type Tab = 'yours' | 'look';

/**
 * Closet (design §4.3, S11). "Your closet" is this person's overlay (`wear` play op, `PetPlay.wearing`): it changes the
 * pet on their screen only, never `agent.look` or the bot's photo. Items are the free accessories and the keepsakes
 * earned (`play.items`); a locked keepsake is a soft silhouette that says how it is earned. Trying one on turns the pet
 * to the mirror (`roomReact('admire')`) with a line in its voice. "{name}'s look", for the creator, edits the real look
 * through the pet's own look route (POST …/look, the same rule and save as Studio's), after the sheet that says it changes
 * the photo for everyone.
 */
export default function ClosetRoom({ host }: RoomProps) {
  const [tab, setTab] = useState<Tab>('yours');
  const [slot, setSlot] = useState<WearSlot>('head');
  const [page, setPage] = useState(0);
  const [confirm, setConfirm] = useState<Accessory | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const swipe = useRef<number | null>(null);
  const ac = useRef<AbortController | null>(null);
  const play = host?.view()?.play;
  useEffect(() => { host?.engine()?.setWearing?.(play?.wearing ?? {}); }, [host, play?.wearing]);
  useEffect(() => () => ac.current?.abort(), []);
  // the warning sheet owns the moment: no tip, no ask meanwhile (§6.1)
  useEffect(() => { host?.busy('closet', !!confirm); return () => host?.busy('closet', false); }, [host, confirm]);
  if (!host) return null;
  const lang = host.lang;
  const v = host.view();
  const name = v?.name ?? '';
  const creator = canEditLook(v);
  const rtl = lang === 'fa';

  const list: readonly (WearableId | Accessory)[] = tab === 'yours' ? slotItems(play, slot) : LOOK_ACCESSORIES;
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const at = Math.min(page, pages - 1);
  const shown = list.slice(at * PAGE, at * PAGE + PAGE);
  const go = (by: 1 | -1) => setPage(Math.max(0, Math.min(pages - 1, at + by)));

  const wear = async (id: WearableId) => {
    if (!owned(play, id)) return;
    const s = slotOf(id);
    const next = play?.wearing[s] === id ? null : id;
    const r = await host.play({ op: 'wear', slot: s, item: next });
    if (!r || r.guard === 'locked') return;
    host.engine()?.setWearing?.(r.play.wearing);
    // the mirror (§4.3): the engine's try-on glance at the item where it has one, else the admire turn
    const e = host.engine();
    if (next) { if (e?.tryOn) e.tryOn(next); else e?.roomReact?.('admire'); host.say(pick('closet.mirror', Date.now(), undefined, lang)); }
  };

  /** The pet's look route (POST …/look, pet-signed, the care epoch): a refusal is a note here, never the end of the pet. */
  const saveLook = async (accessory: Accessory) => {
    setConfirm(null);
    ac.current?.abort();
    const c = new AbortController();
    ac.current = c;
    try {
      if (!host.api.look) { setNote(t('closet.lookElsewhere', { name }, lang)); return; }
      const res = await host.api.look(host.agentId, { look: { accessory } }, { signal: c.signal });
      if (c.signal.aborted) return;
      const cur = host.view();
      if (!cur) return;
      const look = { ...cur.look, ...res.look };
      host.patch?.({ look });
      host.engine()?.setLook(look, cur.stage);
      host.engine()?.roomReact?.('admire');
      host.say(pick('closet.mirror', Date.now(), undefined, lang));
    } catch (e) {
      if (c.signal.aborted) return;
      const code = (e as { code?: string } | null)?.code;
      setNote(code === 'look_forbidden' ? t('closet.adminOnly', undefined, lang) : t('closet.lookElsewhere', { name }, lang));
    }
  };

  const label = (id: WearableId | Accessory) => t(`item.${id}` as PetStringKey, undefined, lang);
  return (
    <div className="pet-closet" data-room="closet">
      <div className="pet-tabs" role="tablist">
        {(creator ? ['yours', 'look'] as const : ['yours'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setPage(0); setNote(null); }}>
            {t(k === 'yours' ? 'closet.tab.yours' : 'closet.tab.look', { name }, lang)}
          </button>
        ))}
        {tab === 'yours' && WEAR_SLOTS.map((s) => (
          <button key={s} type="button" className="pet-slot" aria-pressed={slot === s} onClick={() => { setSlot(s); setPage(0); }}>{t(SLOT_KEY[s], undefined, lang)}</button>
        ))}
      </div>
      <div className="pet-grid" role="tabpanel"
        onPointerDown={(e) => { swipe.current = e.clientX; }}
        onPointerUp={(e) => { const x = swipe.current; swipe.current = null; if (x === null || Math.abs(e.clientX - x) < 36) return; go((e.clientX < x) !== rtl ? 1 : -1); }}>
        {shown.map((id) => {
          if (tab === 'look') {
            const on = (v?.look.accessory ?? 'none') === id;
            return <button key={id} type="button" className="pet-item" aria-pressed={on} onClick={() => { if (!on) setConfirm(id as Accessory); }}>{label(id)}</button>;
          }
          const w = id as WearableId;
          const mine = owned(play, w);
          const on = play?.wearing[slotOf(w)] === w;
          return mine
            ? <button key={id} type="button" className="pet-item" aria-pressed={on} onClick={() => void wear(w)}>{label(w)}</button>
            : <button key={id} type="button" className="pet-item" data-locked="" aria-disabled="true" aria-label={`${label(w)}: ${t(earnKey(w as KeepsakeId), undefined, lang)}`}>
                <small>{t(earnKey(w as KeepsakeId), undefined, lang)}</small>
              </button>;
        })}
      </div>
      {pages > 1 && <div className="pet-dots" aria-hidden="true">{Array.from({ length: pages }, (_, k) => <i key={k} data-on={k === at ? '' : undefined} onClick={() => setPage(k)} />)}</div>}
      {note && <span className="pet-chip" role="status">{note}</span>}
      {confirm && <Sheet title={t('closet.warning', { name }, lang)} yes={t('closet.save', undefined, lang)} no={t('closet.cancel', undefined, lang)}
        onYes={() => void saveLook(confirm)} onNo={() => setConfirm(null)} />}
    </div>
  );
}
