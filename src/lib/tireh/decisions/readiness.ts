/**
 * Decisions pre-production readiness (docs/AGENT_INTELLIGENCE_SOLUTION.md
 * section 4.8: "Before production: ZDR approval from OpenAI, the EU endpoint
 * for EU members, a hashed safety_identifier, and the DPIA updated").
 *
 * The variables read here are deployment attestations and a secret, not
 * feature flags: they never switch a code path on with every flag unset, so
 * they are read from the env argument and not through tirehFlags().
 *   DECISIONS_ZDR_APPROVED=1           ZDR approval for Decisions is on file
 *   DECISIONS_EU_ENDPOINT_CONFIRMED=1  EU members are routed to the EU endpoint
 *   DECISIONS_SAFETY_ID_SALT           at least 32 characters, not STUDIO_SECRET
 *
 * Codes are content-free constants. runtime.ts logs them only under
 * STUDIO_DECIDER=service, and builds the safety identifier only there.
 */

import { createHash } from 'node:crypto';
import type { DeciderKind } from '../flags';

export type DecisionsReadinessCode =
  | 'zdr_unconfirmed'
  | 'eu_endpoint_unconfirmed'
  | 'safety_identifier_salt_missing'
  | 'safety_identifier_salt_invalid';

/** Shortest accepted DECISIONS_SAFETY_ID_SALT. */
export const MIN_SAFETY_ID_SALT_LENGTH = 32;
/** Prefix of every safety identifier; the rest is 32 hex characters. */
export const SAFETY_ID_PREFIX = 'vox_';

const attested = (value: string | undefined): boolean => value?.trim() === '1';

/** The configured salt, or undefined when it is missing, shorter than 32 characters or equal to STUDIO_SECRET. */
export function safetyIdSalt(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const salt = env.DECISIONS_SAFETY_ID_SALT?.trim();
  if (!salt || salt.length < MIN_SAFETY_ID_SALT_LENGTH) return undefined;
  const secret = env.STUDIO_SECRET?.trim();
  return secret && secret === salt ? undefined : salt;
}

/** The missing attestations, in a fixed order; an empty array means ready. */
export function decisionsReadiness(env: NodeJS.ProcessEnv = process.env): DecisionsReadinessCode[] {
  const codes: DecisionsReadinessCode[] = [];
  if (!attested(env.DECISIONS_ZDR_APPROVED)) codes.push('zdr_unconfirmed');
  if (!attested(env.DECISIONS_EU_ENDPOINT_CONFIRMED)) codes.push('eu_endpoint_unconfirmed');
  if (!env.DECISIONS_SAFETY_ID_SALT?.trim()) codes.push('safety_identifier_salt_missing');
  else if (!safetyIdSalt(env)) codes.push('safety_identifier_salt_invalid');
  return codes;
}

/**
 * Logs `[vox] decisions_readiness:<code>` for each missing attestation, only when
 * the service decider is selected; returns the codes it logged.
 */
export function reportDecisionsReadiness(env: NodeJS.ProcessEnv, decider: DeciderKind,
  warn: (line: string) => void = (line) => console.warn(line)): DecisionsReadinessCode[] {
  if (decider !== 'service') return [];
  const codes = decisionsReadiness(env);
  for (const code of codes) warn(`[vox] decisions_readiness:${code}`);
  return codes;
}

/**
 * subject => 'vox_' + the first 32 hex characters of sha256(`${salt}:${subject}`), or
 * undefined when no usable salt is configured (then no identifier is ever sent).
 */
export function safetyIdentifierHasher(env: NodeJS.ProcessEnv = process.env): ((subject: string) => string) | undefined {
  const salt = safetyIdSalt(env);
  if (!salt) return undefined;
  return (subject: string) => SAFETY_ID_PREFIX + createHash('sha256').update(`${salt}:${subject}`).digest('hex').slice(0, 32);
}
