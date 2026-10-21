/**
 * Character library (isomorphic). portrait.ts is server-only and is imported
 * directly, never through this barrel.
 */

export { PALETTE, ACCENTS, INK, TONES, GROUND_COLOR, mix, material, derivePalette, hairMaterial, accentColor, contrastRatio, readsOn, type HuePalette, type Material } from './palette';
export { stageFor, STAGE_PARTS, hasPart, type StagePart } from './stage';
export {
  eyeD, mouthD, EYE, MOUTH, STAGE_EYE, talkMouth, mouthOpenness, eyeOpen, mouthFilled, eyeFor, mouthFor, scaleEye, SPEAKING_STILL,
  type Expression, type EyeShape, type MouthShape,
} from './face';
export {
  lookKey, normalizeLook, isCompatible, parseLookPatch, suggestAccessories,
  FAMILY_IDS, SPECIES, HAIR_STYLES, HAIR_TONES, ACCESSORIES, ACCENT_COLORS, DEFAULT_ACCENT,
} from './look';
export { PRESET_LOOKS } from './presets';
export { FAMILIES, GROUND, bodyD, silhouette } from './geometry';
export { countDrawn, type SvgNode } from './node';
export {
  characterModel, mix3, modelEye, stageGrowth, RIG_LAYERS, BEAK_MOUTH, BEAK_OPEN, BEAK_DROP, beakLowerD, beakMouth, beakUpperD,
  type CharacterModel, type DerivedPalette, type Lod, type ModelOpts, type RigLayer,
} from './model';
export { characterSvg, modelToSvg, nodesToSvg, rootTransform, circleFit } from './svg';
