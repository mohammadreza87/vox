import type { Accessory, AccentColor, CharacterLook, CloudFamily, CloudSpecies, HairStyle, HairTone, Hue } from '../types';

type Row = [Hue, CloudFamily, CloudSpecies, HairStyle, HairTone, Accessory, AccentColor, 'c' | 'cl' | 'cb' | 'l' | 'b' | ''];

/**
 * Curated looks (pickers, Drafting materialize, dice) in the minimal style:
 * most are a plain cloud body with one quiet cue, the way the reference
 * portraits are. Every species, hair style, accessory, family and hue
 * appears; each species on several hues and families. The first seven are
 * one per species (the lineup); the first is the reference look itself
 * (lagoon, round glasses, blush). Features: c = cheeks, l = lashes, b = brows.
 */
const ROWS: Row[] = [
  ['lagoon', 'puff', 'cloud', 'none', 'deep', 'glasses', 'ink', 'c'],
  ['lilac', 'puff', 'cat', 'none', 'deep', 'none', 'ink', 'c'],
  ['apricot', 'puff', 'dog', 'none', 'deep', 'scarf', 'sky', 'c'],
  ['rose', 'puff', 'bunny', 'none', 'deep', 'bow', 'coral', 'c'],
  ['sky', 'puff', 'bear', 'none', 'deep', 'specs', 'ink', 'cb'],
  ['matcha', 'puff', 'owl', 'none', 'deep', 'glasses', 'ink', ''],
  ['butter', 'puff', 'chick', 'none', 'deep', 'flower', 'rose', 'c'],
  // clouds: the reference pair first (sky with brows), then one cue each
  ['sky', 'puff', 'cloud', 'none', 'deep', 'glasses', 'ink', 'b'],
  ['sky', 'drift', 'cloud', 'none', 'deep', 'none', 'ink', 'cb'],
  ['ash', 'tower', 'cloud', 'tuft', 'ink', 'headphones', 'sky', ''],
  ['rose', 'puff', 'cloud', 'bun', 'cocoa', 'none', 'ink', 'c'],
  ['lilac', 'drift', 'cloud', 'curls', 'deep', 'bowtie', 'coral', 'c'],
  ['matcha', 'tower', 'cloud', 'fringe', 'cocoa', 'cap', 'sky', 'c'],
  ['lagoon', 'drift', 'cat', 'spiky', 'deep', 'star', 'butter', 'c'],
  ['apricot', 'tower', 'cat', 'fringe', 'cocoa', 'beret', 'berry', 'c'],
  ['sky', 'puff', 'cat', 'pony', 'apricot', 'headset', 'lilac', 'cl'],
  ['butter', 'drift', 'cat', 'none', 'deep', 'glasses', 'ink', ''],
  ['ash', 'puff', 'dog', 'tuft', 'deep', 'none', 'ink', 'c'],
  ['sky', 'tower', 'dog', 'none', 'deep', 'bowtie', 'berry', 'c'],
  ['rose', 'drift', 'dog', 'fringe', 'cocoa', 'glasses', 'ink', 'c'],
  ['matcha', 'puff', 'dog', 'none', 'deep', 'flower', 'rose', 'c'],
  ['lilac', 'puff', 'bunny', 'none', 'deep', 'glasses', 'ink', 'c'],
  ['lagoon', 'drift', 'bunny', 'tuft', 'deep', 'scarf', 'butter', 'c'],
  ['butter', 'puff', 'bunny', 'fringe', 'cocoa', 'none', 'ink', 'cl'],
  ['apricot', 'tower', 'bunny', 'none', 'deep', 'headphones', 'sky', 'c'],
  ['matcha', 'tower', 'bear', 'none', 'deep', 'beanie', 'coral', 'c'],
  ['apricot', 'drift', 'bear', 'none', 'deep', 'scarf', 'lagoon', 'c'],
  ['rose', 'puff', 'bear', 'curls', 'cocoa', 'none', 'ink', 'c'],
  ['ash', 'puff', 'bear', 'fringe', 'ink', 'headset', 'lilac', 'b'],
  ['sky', 'tower', 'owl', 'none', 'deep', 'specs', 'ink', ''],
  ['rose', 'drift', 'owl', 'fringe', 'deep', 'none', 'ink', 'c'],
  ['butter', 'puff', 'owl', 'none', 'deep', 'bow', 'sky', 'c'],
  ['ash', 'tower', 'owl', 'none', 'deep', 'scarf', 'lagoon', ''],
  ['lagoon', 'tower', 'chick', 'none', 'deep', 'none', 'ink', 'c'],
  ['rose', 'drift', 'chick', 'none', 'deep', 'bowtie', 'sky', 'c'],
  ['sky', 'puff', 'chick', 'none', 'deep', 'glasses', 'ink', 'c'],
  ['lilac', 'drift', 'chick', 'none', 'deep', 'star', 'butter', 'c'],
];

export const PRESET_LOOKS: ReadonlyArray<CharacterLook> = ROWS.map(([hue, family, species, hair, hairTone, accessory, accent, f]) => ({
  hue, family, species, hair, hairTone, accessory, accent,
  features: { cheeks: f.includes('c'), lashes: f.includes('l'), brows: f.includes('b') },
}));
