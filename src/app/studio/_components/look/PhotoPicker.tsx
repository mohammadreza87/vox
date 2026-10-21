'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { lookKey } from '@/lib/studio/character';
import { ApiError, api, haptic, mediaUrl, tg, type AgentView } from '../../_lib/client';
import { useProfileSync } from '../../_lib/useProfileSync';
import { Cloud, PALETTE } from '../Cloud';
import { errorMessage, useNav } from '../StudioApp';
import { Icon, Spinner, hueVars } from '../ui';
import { arrowStep } from './OptionRail';
import { ProfileSyncStatus } from './ProfileSyncStatus';
import { TelegramPhoto, telegramStage } from './TelegramPhoto';
import { clock, useNow } from './syncState';

/** Portraits per Generate tap: two `count:1` requests, each revealed as it lands (PLAN D3/D19). */
const PER_TAP = 2;
/** Median portrait time; progress = 0.92·(1 − e^(−t/τ)) (interaction §2.6). */
const TAU_S = 20;
/** Variants shown before "···" expands the rest. */
const COLLAPSED = 4;

type Slot = { key: string; state: 'forming' | 'landed' | 'failed'; file?: string };
type Gen = { batch: number; started: number; slots: Slot[] };
type Busy = 'choose' | 'upload' | null;
type Fail = { message: string; retry?: () => void };

export interface PhotoPickerProps {
  agent: AgentView;
  onUpdate: (a: AgentView) => void;
  /** Start one Generate on mount (the profile's "Regenerate" opens the sheet with this) */
  autoGenerate?: boolean;
}

/**
 * The Telegram photo: the character render or a portrait drawn from it.
 * Generate fires two `select:false` requests, shows a forming mist per slot,
 * reveals each image once decoded, then chooses the newest once (one Telegram
 * push) with Undo. Tapping a tile commits it immediately; every tile waits
 * while a request is in flight.
 *
 * Server work outlives the picker: closing the sheet or tapping Next mid-request
 * still chooses the portrait and hands the agent to the parent (still mounted);
 * only this component's own state updates are dropped.
 */
export function PhotoPicker({ agent, onUpdate, autoGenerate }: PhotoPickerProps) {
  const nav = useNav();
  const look = agent.look;
  const name = agent.persona.name;
  const active = agent.status === 'active';
  const pal = PALETTE[look.hue] ?? PALETTE.lilac;

  const latest = useRef(agent);
  latest.current = agent;
  const update = useRef(onUpdate);
  update.current = onUpdate;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  /** In-flight guard readable from a stale closure (a snack's Undo after the sheet closed) */
  const running = useRef(false);
  /** A server answer: the parent's updater stays valid after unmount, and `latest` keeps Undo's `prev` right. */
  const adopt = (a: AgentView) => { latest.current = a; update.current(a); };
  const tiles = useRef<Array<HTMLButtonElement | null>>([]);

  useProfileSync(agent, onUpdate);

  const [gen, setGen] = useState<Gen | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  /** Tile shown as chosen before the server agrees (null = the character) */
  const [optimistic, setOptimistic] = useState<{ file: string | null } | null>(null);
  const [fail, setFail] = useState<Fail | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [limitUntil, setLimitUntil] = useState<number | null>(null);
  const [genOff, setGenOff] = useState(false);
  const [shake, setShake] = useState<{ file: string | null; n: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const batchSeq = useRef(0);
  /** After a commit on an active agent: offer Undo once Telegram has the photo */
  const undoAfterSync = useRef<{ prev: string | null } | undefined>(undefined);

  const inFlight = !!gen || !!busy;
  const now = useNow(!!gen || limitUntil !== null, gen ? 500 : 1000);
  const limitLeft = limitUntil !== null ? (limitUntil - now) / 1000 : 0;
  useEffect(() => { if (limitUntil !== null && limitLeft <= 0) setLimitUntil(null); }, [limitUntil, limitLeft]);

  /** Drafts (or the picker already closed): snack now. Active: once Telegram has the photo (now, or when polling sees it land). */
  const offerUndo = (prev: string | null, a: AgentView, message: string) => {
    if (a.status !== 'active' || !alive.current) {
      nav.snack({ message, tone: 'success', action: { label: 'Undo', run: () => void commitRef.current(prev, { undo: true }) }, ms: 5000 });
      return;
    }
    undoAfterSync.current = { prev };
    showUndoWhenSynced(a);
  };

  const showUndoWhenSynced = (a: AgentView) => {
    const pending = undoAfterSync.current;
    if (!pending) return;
    const status = a.profileSync?.status ?? 'synced';
    if (status === 'pending') return;
    undoAfterSync.current = undefined;
    if (status !== 'synced') return; // the status row owns the failure (inline Retry)
    nav.snack({ message: 'Telegram photo updated', tone: 'success', action: { label: 'Undo', run: () => void commitRef.current(pending.prev, { undo: true }) }, ms: 5000 });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { showUndoWhenSynced(agent); }, [agent]);

  /** Make `file` the photo (null = the character). Optimistic ring; reverts with a shake on failure. */
  const commit = async (file: string | null, o: { undo?: boolean; announce?: string } = {}) => {
    const a = latest.current;
    const prev = a.look.avatar ?? null;
    if (file === prev || running.current) return;
    running.current = true;
    haptic.select();
    if (alive.current) { setFail(null); setNote(null); setOptimistic({ file }); setBusy('choose'); }
    try {
      const r = await api.chooseAvatar(a.id, file);
      adopt(r.agent);
      if (!o.undo && (r.agent.status === 'active' || o.announce)) offerUndo(prev, r.agent, o.announce ?? 'Photo changed');
    } catch (e) {
      haptic.error();
      if (!alive.current) {
        nav.snack({ message: `Couldn’t change the photo. ${errorMessage(e)}`, tone: 'error', action: { label: 'Retry', run: () => void commitRef.current(file, o) } });
        return;
      }
      setShake((s) => ({ file, n: (s?.n ?? 0) + 1 }));
      setFail({ message: errorMessage(e), retry: () => void commit(file, o) });
    } finally {
      running.current = false;
      if (alive.current) { setOptimistic(null); setBusy(null); }
    }
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const generate = async () => {
    if (running.current || limitUntil !== null) return;
    running.current = true;
    // Closing the Mini App mid-generation would lose the auto-choose (the job store is deferred); held until it lands, even if the sheet closes.
    const app = tg() as (ReturnType<typeof tg> & { enableClosingConfirmation?(): void; disableClosingConfirmation?(): void }) | null;
    app?.enableClosingConfirmation?.();
    try { await drawAndChoose(); } finally { running.current = false; app?.disableClosingConfirmation?.(); }
  };

  const drawAndChoose = async () => {
    const a0 = latest.current;
    const before = new Set(a0.look.avatarVariants ?? []);
    const prev = a0.look.avatar ?? null;
    const batch = ++batchSeq.current;
    const claimed: string[] = [];
    // Written from the parallel requests below (a holder, so TS doesn't narrow them to their initial values)
    const out = { last: null as AgentView | null, retryAfter: null as number | null, off: false, failure: null as unknown };
    haptic.light();
    setFail(null);
    setNote(null);
    setGen({ batch, started: Date.now(), slots: Array.from({ length: PER_TAP }, (_, i) => ({ key: `${batch}-${i}`, state: 'forming' as const })) });
    const setSlot = (i: number, s: Partial<Slot>) => setGen((g) => (g && g.batch === batch ? { ...g, slots: g.slots.map((x, j) => (j === i ? { ...x, ...s } : x)) } : g));

    await Promise.all(Array.from({ length: PER_TAP }, async (_, i) => {
      try {
        const r = await api.generateAvatars(a0.id, 1, { select: false });
        out.last = r.agent;
        // Variants are prepended, so this response's own file is the first one nobody has claimed.
        const file = (r.agent.look.avatarVariants ?? []).find((f) => !before.has(f) && !claimed.includes(f));
        if (!file) { setSlot(i, { state: 'failed' }); return; }
        claimed.push(file);
        if (!alive.current) return;
        await decode(mediaUrl(file));
        if (!alive.current) return;
        setSlot(i, { state: 'landed', file });
        haptic.medium();
      } catch (e) {
        if (e instanceof ApiError && e.status === 429) out.retryAfter = Math.max(out.retryAfter ?? 0, e.retryAfter ?? 60);
        else if (e instanceof ApiError && e.status === 503) out.off = true;
        else out.failure = e;
        if (alive.current) setSlot(i, { state: 'failed' });
      }
    }));

    const { last, retryAfter, off, failure } = out;
    const here = alive.current;
    if (here && retryAfter !== null) { setLimitUntil(Date.now() + retryAfter * 1000); haptic.warn(); }
    if (here && off) setGenOff(true);
    const newest = claimed[claimed.length - 1];
    if (!newest) {
      setGen(null);
      if (last) adopt(last);
      if (here && retryAfter === null && !off) {
        haptic.error();
        setFail({ message: failure ? `Couldn’t draw new portraits. ${errorMessage(failure)}` : 'Couldn’t draw new portraits.', retry: () => void generateRef.current() });
      }
      return;
    }
    // The choose (and the one Telegram push) is server work: it runs even if the sheet closed or Next was tapped.
    try {
      const r = await api.chooseAvatar(a0.id, newest);
      running.current = false;
      setGen(null);
      adopt(r.agent);
      if (alive.current && r.agent.status !== 'active') haptic.success();
      offerUndo(prev, r.agent, claimed.length > 1 ? 'Using the newest portrait' : 'Using the new portrait');
      if (alive.current && claimed.length < PER_TAP && retryAfter === null) setNote('One portrait couldn’t be drawn this time.');
    } catch (e) {
      running.current = false;
      setGen(null);
      if (last) adopt(last);
      haptic.error();
      const message = `The new portraits are saved, but switching failed. ${errorMessage(e)}`;
      if (alive.current) setFail({ message, retry: () => void commitRef.current(newest) });
      else nav.snack({ message, tone: 'error', action: { label: 'Retry', run: () => void commitRef.current(newest) } });
    }
  };
  const generateRef = useRef(generate);
  generateRef.current = generate;

  const auto = useRef(autoGenerate);
  useEffect(() => {
    if (!auto.current) return;
    auto.current = false;
    void generateRef.current();
  }, []);

  const upload = async (file: File) => {
    if (running.current) return;
    running.current = true;
    const a0 = latest.current;
    const before = new Set(a0.look.avatarVariants ?? []);
    const prev = a0.look.avatar ?? null;
    setFail(null);
    setNote(null);
    setBusy('upload');
    try {
      let r = await api.uploadAvatar(a0.id, file);
      const added = (r.agent.look.avatarVariants ?? []).find((f) => !before.has(f));
      if (added && r.agent.look.avatar !== added) r = await api.chooseAvatar(a0.id, added);
      adopt(r.agent);
      if (alive.current && r.agent.status !== 'active') haptic.success();
      offerUndo(prev, r.agent, 'Using your photo');
    } catch (e) {
      haptic.error();
      if (alive.current) setFail({ message: errorMessage(e), retry: () => fileRef.current?.click() });
      else nav.snack({ message: `Couldn’t use your photo. ${errorMessage(e)}`, tone: 'error' });
    } finally {
      running.current = false;
      if (alive.current) setBusy(null);
    }
  };

  // Tiles: character first, then new slots, then portraits (old looks sink to the end), then "+".
  const key = lookKey(look);
  const staleOf = (f: string) => (look.avatarLooks?.[f] ? look.avatarLooks[f] !== key : f === look.avatar && !!look.avatarStale);
  const slotFiles = new Set(gen?.slots.map((s) => s.file).filter(Boolean));
  const variants = (look.avatarVariants ?? []).filter((f) => !slotFiles.has(f));
  const ordered = [...variants.filter((f) => !staleOf(f)), ...variants.filter(staleOf)];
  const selected = optimistic ? optimistic.file : look.avatar ?? null;
  const room = Math.max(0, COLLAPSED - (gen?.slots.length ?? 0));
  let shown = expanded ? ordered : ordered.slice(0, room);
  if (!expanded && selected && ordered.includes(selected) && !shown.includes(selected)) shown = [...shown.slice(0, Math.max(0, room - 1)), selected];
  const hidden = ordered.length - shown.length;
  const canGenerate = nav.me.features.avatars && !genOff;

  // Radiogroup: one tab stop (the chosen tile), arrows move focus. Arrows don't choose here: a choice is a
  // Telegram push, so Space/Enter commits. aria-disabled (not disabled) keeps focus on the tile while it saves.
  const radios: Array<string | null> = [null, ...shown];
  const tabStop = Math.max(0, radios.indexOf(selected));
  const onTileKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = arrowStep(e);
    if (!step) return;
    e.preventDefault();
    const el = tiles.current[(i + step + radios.length) % radios.length];
    el?.focus();
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };
  // A shake remounts its tile (to replay the animation): keep keyboard focus on it.
  useEffect(() => {
    if (!shake) return;
    const el = tiles.current[radios.indexOf(shake.file)];
    if (el && (!document.activeElement || document.activeElement === document.body)) el.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shake]);
  const tileProps = (file: string | null, i: number) => ({
    ref: (el: HTMLButtonElement | null) => { tiles.current[i] = el; },
    type: 'button' as const,
    role: 'radio' as const,
    'aria-checked': selected === file,
    'aria-disabled': inFlight || undefined,
    tabIndex: i === tabStop ? 0 : -1,
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => onTileKey(e, i),
    onClick: () => { if (!inFlight) void commit(file); },
  });

  return (
    <section className="vx-photos" style={hueVars(pal)} aria-labelledby={titleId}>
      <div className="vx-photos-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="vx-head" id={titleId}>Telegram photo</div>
          <div className="vx-small vx-2">Portraits are drawn from {name}’s character.</div>
        </div>
        {(hidden > 0 || expanded) && (
          <button className="vx-icon-btn" aria-label={expanded ? 'Show fewer photos' : `Show all ${ordered.length} photos`} aria-expanded={expanded}
            onClick={() => { haptic.select(); setExpanded((x) => !x); }}>
            <Icon name="more" width={3} />
          </button>
        )}
      </div>

      {active ? (
        <ProfileSyncStatus agent={agent} photo={44}
          onRetry={() => api.syncProfile(agent.id).then((r) => update.current(r.agent)).catch((e) => { haptic.error(); setFail({ message: errorMessage(e) }); })}
          onRegenerate={canGenerate ? () => void generate() : undefined}
          onUseCharacter={() => commit(null)} />
      ) : (
        <div className="vx-sync">
          <TelegramPhoto agent={agent} size={44} />
          <div className="vx-sync-text">
            <span className="vx-sync-title">How it looks in Telegram</span>
            <span className="vx-sync-detail">Becomes the bot photo when you hire {name}.</span>
          </div>
        </div>
      )}

      {!active && look.avatar && look.avatarStale && (
        <div className="vx-banner warn" role="note">
          <Icon name="warn" size={18} />
          <div className="vx-banner-body">
            <span>This portrait was drawn from an older look.</span>
            <div className="vx-photos-actions">
              {canGenerate && <button className="vx-btn vx-btn-secondary vx-sync-btn" disabled={inFlight || limitUntil !== null} onClick={() => void generate()}>Regenerate</button>}
              <button className="vx-btn vx-sync-btn vx-sync-ghost" disabled={inFlight} onClick={() => void commit(null)}>Use character</button>
            </div>
          </div>
        </div>
      )}

      <div className="vx-photos-grid" role="radiogroup" aria-label={`${name}’s Telegram photo`} aria-busy={inFlight}>
        <button key={`character-${shake?.file === null ? shake.n : 0}`} {...tileProps(null, 0)} className={`vx-ptile character${shake?.file === null ? ' vx-shake' : ''}`}
          aria-label={`Character · grows with ${name}`}>
          <span className="vx-ptile-disc"><Cloud look={look} size={60} stage={telegramStage(agent)} lod="card" still label={name} /></span>
          <span className="vx-ptile-cap"><b>Character</b><span>grows with {name}</span></span>
          <TileMarks selected={selected === null} pending={busy === 'choose' && optimistic?.file === null} />
        </button>

        {gen?.slots.map((s, i) => (
          <FormingTile key={s.key} slot={s} index={i} look={look} name={name} stage={telegramStage(agent)}
            progress={formProgress((now - gen.started) / 1000)} />
        ))}

        {shown.map((f, i) => {
          const stale = staleOf(f);
          return (
            <button key={`${f}-${shake?.file === f ? shake.n : 0}`} {...tileProps(f, i + 1)} className={`vx-ptile photo${stale ? ' stale' : ''}${shake?.file === f ? ' vx-shake' : ''}`}
              aria-label={`${f.startsWith('up-') ? 'Your photo' : 'Portrait'}${stale ? ' · old look' : ''}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mediaUrl(f)} alt="" draggable={false} loading="lazy" decoding="async" />
              {stale && <span className="vx-ptile-tag">Old look</span>}
              <TileMarks selected={selected === f} pending={busy === 'choose' && optimistic?.file === f} />
            </button>
          );
        })}

        <button type="button" className="vx-ptile add" aria-label="Upload a photo" aria-disabled={inFlight || undefined}
          onClick={() => { if (inFlight) return; haptic.tap(); fileRef.current?.click(); }}>
          {busy === 'upload' ? <Spinner size={22} /> : <Icon name="plus" size={24} />}
          <span className="vx-ptile-cap"><b>{busy === 'upload' ? 'Uploading…' : 'Upload'}</b></span>
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void upload(file);
        }} />
      </div>

      {canGenerate && (gen
        ? <GenerateProgress gen={gen} now={now} name={name} accessory={look.accessory} />
        : (
          <button className="vx-btn vx-btn-secondary vx-btn-block vx-photos-gen" disabled={inFlight || limitUntil !== null} onClick={() => void generate()}>
            {limitUntil !== null
              ? <><Icon name="clock" size={18} /><span className="vx-num">Next portrait in {clock(limitLeft)}</span></>
              : <><Icon name="spark" size={18} />{(look.avatarVariants?.length ?? 0) > 0 ? `Draw ${PER_TAP} more portraits` : `Draw ${PER_TAP} portraits`}</>}
          </button>
        ))}
      {limitUntil !== null && <p className="vx-photos-foot">Portrait limit reached for now. Uploads still work.</p>}

      {fail && (
        <div className="vx-photos-error" role="alert">
          <span>{fail.message}</span>
          {fail.retry && <button className="vx-btn vx-btn-secondary vx-sync-btn" disabled={inFlight} onClick={() => { haptic.tap(); fail.retry?.(); }}>Retry</button>}
        </div>
      )}
      {note && !fail && <p className="vx-photos-foot" role="status">{note}</p>}
      {active && <p className="vx-photos-foot">Telegram may take a minute to refresh the photo in open chats.</p>}
    </section>
  );
}

/** Volt ring drawn with stroke-dashoffset + popping check (motion §4.11 step 3); spinner while the commit is in flight. */
function TileMarks({ selected, pending }: { selected: boolean; pending: boolean }) {
  return (
    <>
      <svg className="vx-ptile-ring" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" data-on={selected || undefined}>
        <rect x="1.5" y="1.5" width="97" height="97" rx="18.5" pathLength={1} />
      </svg>
      {selected && <span className="vx-ptile-check" aria-hidden="true">{pending ? <Spinner size={12} /> : <Icon name="check" size={13} width={3} />}</span>}
    </>
  );
}

/**
 * A portrait forming: hue mist that condenses while the silhouette surfaces
 * (driven by --form 0→1), then a circular wipe reveals the decoded image and
 * the mist bursts out. Opacity/transform/clip-path only (no animated blur, D18).
 */
function FormingTile({ slot, index, look, name, stage, progress }: { slot: Slot; index: number; look: AgentView['look']; name: string; stage: AgentView['stage']; progress: number }) {
  const landed = slot.state === 'landed' && slot.file;
  return (
    <div className={`vx-ptile forming${landed ? ' landed' : ''}${slot.state === 'failed' ? ' failed' : ''}`} role="img"
      aria-label={landed ? 'New portrait' : slot.state === 'failed' ? 'Couldn’t draw this one' : `Drawing portrait ${index + 1}`}
      style={{ '--form': progress, '--i': index } as CSSProperties}>
      <span className="vx-mist" aria-hidden="true" />
      <span className="vx-ghost" aria-hidden="true">
        <Cloud look={look} size={64} stage={slot.state === 'failed' ? 1 : stage} expr={slot.state === 'failed' ? 'sleeping' : 'idle'} lod="card" still label={name} />
      </span>
      {slot.state === 'failed' && <span className="vx-ptile-cap"><span>Couldn’t draw this one</span></span>}
      {landed && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="vx-reveal" src={mediaUrl(slot.file!)} alt="" draggable={false} />
          <span className="vx-burst" aria-hidden="true">{Array.from({ length: 6 }, (_, k) => <i key={k} style={{ '--k': k } as CSSProperties} />)}</span>
        </>
      )}
    </div>
  );
}

const formProgress = (t: number) => 0.92 * (1 - Math.exp(-Math.max(0, t) / TAU_S));

const ACCESSORY_WORD: Partial<Record<string, string>> = { bowtie: 'bow tie', specs: 'specs', headset: 'headset', headphones: 'headphones' };

/** Rotating narrative while portraits form; the last line holds (interaction §5.2, motion §4.11). */
export function generateCopy(t: number, name: string, accessory?: string): string {
  if (t >= 45) return 'Taking longer than usual · keep this open';
  if (t >= 8) return 'Still painting, almost there…';
  const lines = [
    'Gathering mist…',
    `Finding ${name}’s smile…`,
    accessory && accessory !== 'none' ? `Fitting the ${ACCESSORY_WORD[accessory] ?? accessory}…` : 'Adding the soft vinyl finish…',
  ];
  return lines[Math.min(lines.length - 1, Math.floor(t / 3))];
}

function GenerateProgress({ gen, now, name, accessory }: { gen: Gen; now: number; name: string; accessory?: string }) {
  const t = (now - gen.started) / 1000;
  const ready = gen.slots.filter((s) => s.state === 'landed').length;
  const p = Math.max(formProgress(t), (ready / gen.slots.length) * 0.96);
  const label = ready > 0 ? `${ready} of ${gen.slots.length} ready` : generateCopy(t, name, accessory);
  return (
    <div className="vx-gen" role="status" aria-live="polite">
      <span className="vx-gen-fill" style={{ transform: `scaleX(${p})` }} aria-hidden="true" />
      <span className="vx-gen-label" key={label}>{label}</span>
      <span className="vx-gen-time vx-num" aria-hidden="true">{clock(t)}</span>
    </div>
  );
}

/** Resolves once the image can paint without a flash (img.decode); never rejects. */
function decode(src: string): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve();
  const img = new Image();
  img.src = src;
  const done = img.decode ? img.decode() : new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; });
  return Promise.race([done, new Promise<void>((res) => setTimeout(res, 8000))]).catch(() => undefined);
}
