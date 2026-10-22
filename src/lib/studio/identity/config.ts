/**
 * Configuration for S11L voiceprints: per-org and per-channel band thresholds
 * and the environment. There are no built-in thresholds on purpose: unset or
 * invalid configuration means no opinion (verify) and 503 (enroll).
 */
import { z } from 'zod';
import type { VoiceBand } from '../../tireh/identity/voice-band';
import type { VoiceChannel } from './store';

export const VOICE_THRESHOLDS_ENV = 'VOICE_MATCH_THRESHOLDS_JSON';

export interface BandThresholds { match: number; noMatch: number; selfEcho: number }
type ChannelOverrides = Partial<Record<VoiceChannel, Partial<BandThresholds>>>;
export interface VoiceThresholdConfig {
  default?: BandThresholds & { channels?: ChannelOverrides };
  orgs?: Record<string, BandThresholds & { channels?: ChannelOverrides }>;
}

const unit = z.number().finite().min(0).max(1);
const validBands = (t: BandThresholds) => t.noMatch >= 0 && t.noMatch < t.match && t.match <= 1 && t.selfEcho > 0 && t.selfEcho <= 1;
const bandsSchema = z.object({ match: unit, noMatch: unit, selfEcho: unit }).strict().refine(validBands);
const partialSchema = z.object({ match: unit, noMatch: unit, selfEcho: unit }).partial().strict();
const channelsSchema = z.object({ telegram_voice_note: partialSchema, mini_app: partialSchema }).partial().strict();
const entrySchema = z.object({ match: unit, noMatch: unit, selfEcho: unit, channels: channelsSchema.optional() }).strict()
  .refine(validBands);
const configSchema = z.object({
  default: entrySchema.optional(),
  orgs: z.record(z.string().min(1).max(200), entrySchema).optional(),
}).strict();

/** Null when unset, not JSON or not matching the schema. Never throws; the caller warns 'voiceprint_thresholds_invalid' once. */
export function parseVoiceThresholds(raw: string | undefined): VoiceThresholdConfig | null {
  if (raw === undefined || !raw.trim()) return null;
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return null; }
  const parsed = configSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** orgs[orgKey] ?? default, with the channel override merged and re-validated. */
export function resolveThresholds(cfg: VoiceThresholdConfig | null, orgKey: string, channel: VoiceChannel): BandThresholds | null {
  if (!cfg) return null;
  const entry = cfg.orgs && Object.hasOwn(cfg.orgs, orgKey) ? cfg.orgs[orgKey] : cfg.default;
  if (!entry) return null;
  const override = entry.channels && Object.hasOwn(entry.channels, channel) ? entry.channels[channel] : undefined;
  const merged = { match: entry.match, noMatch: entry.noMatch, selfEcho: entry.selfEcho, ...(override ?? {}) };
  const checked = bandsSchema.safeParse(merged);
  return checked.success ? checked.data : null;
}

export function bandFor(score: number, t: BandThresholds): VoiceBand {
  if (Number.isNaN(score)) return 'NO_MATCH';
  if (score >= t.match) return 'MATCH';
  if (score < t.noMatch) return 'NO_MATCH';
  return 'UNCERTAIN';
}

/**
 * True for a schemaVersion 2 STUDIO_ADAPTIVE_POLICY_JSON (the internal-pilot
 * basis). Employer or pilot availability is not member consent, so the
 * voiceprint provider is withheld under it.
 */
export function pilotManifest(raw: string | undefined): boolean {
  if (raw === undefined || !raw.trim()) return false;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return !!parsed && typeof parsed === 'object' && (parsed as { schemaVersion?: unknown }).schemaVersion === 2;
  } catch {
    return false;
  }
}

export interface VoiceprintEnv {
  /** Raw VOICEPRINT_KEY (parsed by parseVoiceprintKey). */
  key: string | undefined;
  apiKey: string | undefined;
  baseUrl: string | undefined;
  thresholds: VoiceThresholdConfig | null;
  /** True when the internal-pilot manifest is active (provider withheld). */
  pilot: boolean;
  /** True when VOICE_MATCH_THRESHOLDS_JSON is set but invalid. */
  thresholdsInvalid: boolean;
}

export function voiceprintEnv(env: NodeJS.ProcessEnv): VoiceprintEnv {
  const raw = env[VOICE_THRESHOLDS_ENV];
  const thresholds = parseVoiceThresholds(raw);
  const blank = (value: string | undefined) => value?.trim() ? value.trim() : undefined;
  return {
    key: blank(env.VOICEPRINT_KEY),
    apiKey: blank(env.PYANNOTE_API_KEY),
    baseUrl: blank(env.PYANNOTE_BASE_URL),
    thresholds,
    pilot: pilotManifest(env.STUDIO_ADAPTIVE_POLICY_JSON),
    thresholdsInvalid: !!raw?.trim() && !thresholds,
  };
}
