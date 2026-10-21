import type { Meta, StoryObj } from '@storybook/react';
import type { CSSProperties } from 'react';
import { ACCESSORIES, DEFAULT_ACCENT, FAMILY_IDS, HAIR_STYLES, PRESET_LOOKS, SPECIES, isCompatible, normalizeLook, type Expression, type Lod } from '@/lib/studio/character';
import type { CharacterLook, Stage } from '@/lib/studio/types';
import { CharacterView } from './CharacterView';

const ground: CSSProperties = { background: '#0E1013', padding: 16, borderRadius: 16 };
const grid = (cols: number): CSSProperties => ({ ...ground, display: 'grid', gridTemplateColumns: `repeat(${cols}, max-content)`, gap: 10, alignItems: 'end' });
const plain = (o: Partial<CharacterLook>) => normalizeLook({ hue: 'lilac', family: 'puff', features: { cheeks: true, lashes: false, brows: false }, ...o });
const EXPRS: Expression[] = ['idle', 'listening', 'thinking', 'speaking', 'happy', 'sleeping'];

const meta: Meta<typeof CharacterView> = {
  title: 'Studio/Character',
  component: CharacterView,
  tags: ['autodocs'],
  args: { look: PRESET_LOOKS[0], stage: 4, expr: 'idle', size: 200, lod: 'hero', label: 'Agent' },
  argTypes: {
    stage: { control: 'select', options: [1, 2, 3, 4] },
    expr: { control: 'select', options: EXPRS },
    lod: { control: 'select', options: ['hero', 'card', 'icon'] satisfies Lod[] },
    size: { control: { type: 'range', min: 24, max: 320, step: 4 } },
  },
  decorators: [(Story) => <div style={ground}><Story /></div>],
};
export default meta;
type Story = StoryObj<typeof CharacterView>;

export const Playground: Story = {};

/** Every species on every family shape (stage 4, no hair or accessory). */
export const Matrix: Story = {
  render: () => (
    <div style={grid(3)}>
      {SPECIES.flatMap((species) => FAMILY_IDS.map((family) => <CharacterView key={species + family} look={plain({ species, family })} stage={4} expr="idle" size={120} lod="card" label={`${species} ${family}`} />))}
    </div>
  ),
};

/** Hair styles and accessories across species; incompatible combinations are skipped. */
export const HairAndAccessories: Story = {
  render: () => (
    <div style={grid(7)}>
      {[...HAIR_STYLES.map((hair) => ({ hair })), ...ACCESSORIES.map((accessory) => ({ accessory, accent: DEFAULT_ACCENT[accessory] }))].flatMap((o, r) =>
        SPECIES.map((species) => {
          const look = plain({ species, ...o, hue: (['apricot', 'lagoon', 'sky', 'rose', 'matcha', 'butter', 'lilac'] as const)[r % 7] });
          return isCompatible(look).ok ? <CharacterView key={r + species} look={look} stage={4} expr="idle" size={96} lod="card" label={species} /> : <div key={r + species} />;
        }))}
    </div>
  ),
};

/** Growth: each preset species at stages 1 → 4. */
export const Stages: Story = {
  render: () => (
    <div style={grid(4)}>
      {SPECIES.flatMap((species) => { const look = PRESET_LOOKS.find((l) => l.species === species)!; return ([1, 2, 3, 4] as Stage[]).map((stage) => <CharacterView key={species + stage} look={look} stage={stage} expr="idle" size={120} lod="card" label={`${species} stage ${stage}`} />); })}
    </div>
  ),
};

/** The face kit: six expressions on four species. */
export const Expressions: Story = {
  render: () => (
    <div style={grid(6)}>
      {[0, 1, 2, 5].flatMap((i) => EXPRS.map((expr) => <CharacterView key={i + expr} look={PRESET_LOOKS[i]} stage={4} expr={expr} size={110} lod="card" label={expr} />))}
    </div>
  ),
};

/** Level of detail: hero, card and the icon face at list sizes. */
export const LevelOfDetail: Story = {
  render: () => (
    <div style={{ ...ground, display: 'flex', gap: 14, alignItems: 'flex-end' }}>
      <CharacterView look={PRESET_LOOKS[1]} stage={4} expr="idle" size={200} lod="hero" label="hero" />
      <CharacterView look={PRESET_LOOKS[1]} stage={4} expr="idle" size={96} lod="card" label="card" />
      {[56, 48, 32, 24].map((s) => <CharacterView key={s} look={PRESET_LOOKS[1]} stage={4} expr="idle" size={s} lod="icon" label={`icon ${s}`} />)}
    </div>
  ),
};
