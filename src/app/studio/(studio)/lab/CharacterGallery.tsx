'use client';

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ACCENT_COLORS, ACCESSORIES, DEFAULT_ACCENT, FAMILY_IDS, HAIR_STYLES, HAIR_TONES, PRESET_LOOKS, SPECIES, isCompatible, normalizeLook,
  type Expression,
} from '@/lib/studio/character';
import { HUES, type CharacterLook, type Stage } from '@/lib/studio/types';
import { Cloud } from '../../_components/Cloud';
import { CharacterView } from '../../_components/character/CharacterView';

const STAGES: Stage[] = [1, 2, 3, 4];
const EXPRESSIONS: Expression[] = ['idle', 'listening', 'thinking', 'speaking', 'happy', 'sleeping'];
const SIZES = [24, 32, 48, 56];
const SHEETS = ['presets', 'species', 'hair', 'accessories', 'stages', 'expressions', 'small'] as const;
type Sheet = typeof SHEETS[number];

const grid = (cols: number, gap = 6): CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap, justifyItems: 'center', alignItems: 'end' });
const card: CSSProperties = { padding: 12, overflowX: 'auto' };
const rail: CSSProperties = { display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 };
const plain = (o: Partial<CharacterLook>): CharacterLook => normalizeLook({ hue: 'lilac', family: 'puff', features: { cheeks: true, lashes: false, brows: false }, ...o });

/** A static tile (no rig): what the sheets in reports/character/ show, live on the device. */
function Tile({ look, size = 76, stage = 4, expr = 'idle', label }: { look: CharacterLook; size?: number; stage?: Stage; expr?: Expression; label?: string }) {
  const ok = isCompatible(look).ok;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 0 }}>
      {ok
        ? <CharacterView look={look} stage={stage} expr={expr} size={size} lod={size <= 56 ? 'icon' : size >= 140 ? 'hero' : 'card'} label={label ?? look.species ?? 'cloud'} />
        : <div aria-hidden style={{ width: size, height: size, display: 'grid', placeItems: 'center', color: 'var(--text-3)' }}>—</div>}
      {label && <span className="vx-small vx-2" style={{ fontSize: 10, textAlign: 'center' }}>{label}</span>}
    </div>
  );
}

function Rail<T extends string>({ label, values, value, onPick, disabled }: { label: string; values: readonly T[]; value: T; onPick: (v: T) => void; disabled?: (v: T) => string | null }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="vx-over">{label}</span>
      <div style={rail} role="group" aria-label={label}>
        {values.map((v) => {
          const why = disabled?.(v) ?? null;
          return (
            <button key={v} type="button" className="vx-chip" aria-pressed={v === value}
              disabled={!!why} title={why ?? undefined} onClick={() => onPick(v)}>{v}</button>
          );
        })}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <div className="vx-section-head"><span className="vx-over">{title}</span></div>
      <div className="vx-card" style={card}>{children}</div>
    </>
  );
}

/**
 * Character lab: a live picker over every look field (incompatible options
 * greyed with the reason), and every contact sheet from reports/character/
 * rendered live, so the art can be judged on a phone inside Telegram.
 */
export function CharacterGallery() {
  const [look, setLook] = useState<CharacterLook>(() => normalizeLook(PRESET_LOOKS[0]));
  const [stage, setStage] = useState<Stage>(4);
  const [expr, setExpr] = useState<Expression>('idle');
  const [sheet, setSheet] = useState<Sheet>('presets');
  const set = (patch: Partial<CharacterLook>) => setLook((l) => normalizeLook({ ...l, ...patch, ...(patch.accessory ? { accent: DEFAULT_ACCENT[patch.accessory] } : {}) }));
  const why = <K extends keyof CharacterLook>(key: K) => (v: CharacterLook[K]) => { const r = isCompatible({ ...look, [key]: v }); return r.ok ? null : r.reason; };
  const presets = useMemo(() => PRESET_LOOKS.map((l) => normalizeLook(l)), []);

  return (
    <section className="vx-section" aria-label="Characters" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="vx-section-head"><span className="vx-over">Character · live</span></div>
      <div className="vx-card" style={{ ...card, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <Cloud look={look} stage={stage} expr={expr} size={200} label="Lab character" />
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          {SIZES.map((s) => <CharacterView key={s} look={look} stage={stage} expr={expr} size={s} lod="icon" label={`${s} px`} />)}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
          <Rail label="Stage" values={STAGES.map(String) as Array<'1' | '2' | '3' | '4'>} value={String(stage) as '1'} onPick={(v) => setStage(Number(v) as Stage)} />
          <Rail label="Expression" values={EXPRESSIONS} value={expr} onPick={setExpr} />
          <Rail label="Species" values={SPECIES} value={look.species!} onPick={(species) => set({ species })} disabled={why('species')} />
          <Rail label="Shape" values={FAMILY_IDS} value={look.family} onPick={(family) => set({ family })} disabled={why('family')} />
          <Rail label="Colour" values={HUES} value={look.hue} onPick={(hue) => set({ hue })} />
          <Rail label="Hair" values={HAIR_STYLES} value={look.hair!} onPick={(hair) => set({ hair })} disabled={why('hair')} />
          <Rail label="Hair tone" values={HAIR_TONES} value={look.hairTone!} onPick={(hairTone) => set({ hairTone })} />
          <Rail label="Accessory" values={ACCESSORIES} value={look.accessory!} onPick={(accessory) => set({ accessory })} disabled={why('accessory')} />
          <Rail label="Accent" values={ACCENT_COLORS} value={look.accent!} onPick={(accent) => set({ accent })} />
          <div style={rail}>
            {(['cheeks', 'lashes', 'brows'] as const).map((f) => (
              <button key={f} type="button" className="vx-chip" aria-pressed={look.features[f]} onClick={() => set({ features: { ...look.features, [f]: !look.features[f] } })}>{f}</button>
            ))}
            <button type="button" className="vx-chip" onClick={() => setLook(presets[Math.floor(Math.random() * presets.length)])}>Random preset</button>
          </div>
        </div>
      </div>

      <div style={rail} role="group" aria-label="Sheets">
        {SHEETS.map((s) => <button key={s} type="button" className="vx-chip" aria-pressed={s === sheet} onClick={() => setSheet(s)}>{s}</button>)}
      </div>

      {sheet === 'presets' && (
        <Section title={`Presets · ${presets.length}`}>
          <div style={grid(4)}>{presets.map((l, i) => <button key={i} type="button" onClick={() => setLook(l)} style={{ background: 'none', border: 0, padding: 0 }}><Tile look={l} label={[l.species, l.hair !== 'none' && l.hair, l.accessory !== 'none' && l.accessory].filter(Boolean).join(' · ')} /></button>)}</div>
        </Section>
      )}
      {sheet === 'species' && (
        <Section title="Species × shape">
          <div style={grid(3)}>{SPECIES.flatMap((species) => FAMILY_IDS.map((family) => <Tile key={species + family} look={plain({ species, family, hue: look.hue })} size={88} label={`${species} · ${family}`} />))}</div>
        </Section>
      )}
      {sheet === 'hair' && (
        <Section title="Hair × species">
          <div style={grid(4)}>{HAIR_STYLES.filter((h) => h !== 'none').flatMap((hair) => (['cloud', 'cat', 'dog', 'bear'] as const).map((species) => <Tile key={hair + species} look={plain({ species, hair, hue: look.hue, hairTone: look.hairTone })} label={`${hair} · ${species}`} />))}</div>
        </Section>
      )}
      {sheet === 'accessories' && (
        <Section title="Accessories × species">
          <div style={grid(4)}>{ACCESSORIES.filter((a) => a !== 'none').flatMap((accessory) => (['cloud', 'cat', 'owl', 'bunny'] as const).map((species) => <Tile key={accessory + species} look={plain({ species, accessory, accent: DEFAULT_ACCENT[accessory], hue: look.hue })} label={`${accessory} · ${species}`} />))}</div>
        </Section>
      )}
      {sheet === 'stages' && (
        <Section title="Stages 1 wisp → 4 formed">
          <div style={grid(4)}>{SPECIES.flatMap((species) => { const l = presets.find((p) => p.species === species)!; return STAGES.map((s) => <Tile key={species + s} look={l} stage={s} label={`${species} · ${s}`} />); })}</div>
        </Section>
      )}
      {sheet === 'expressions' && (
        <Section title="Expressions">
          <div style={grid(3)}>{EXPRESSIONS.map((e) => <Tile key={e} look={look} expr={e} size={96} label={e} />)}</div>
        </Section>
      )}
      {sheet === 'small' && (
        <Section title="Small sizes (icon LOD)">
          {SIZES.map((s) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
              <span className="vx-small vx-2" style={{ width: 36 }}>{s}</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{presets.slice(0, 14).map((l, i) => <CharacterView key={i} look={l} stage={4} expr="idle" size={s} lod="icon" label={`Preset ${i + 1}`} />)}</div>
            </div>
          ))}
        </Section>
      )}
    </section>
  );
}
