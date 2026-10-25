/**
 * Server feature flags for the agent-intelligence steps in
 * docs/AGENT_INTELLIGENCE_SOLUTION.md. Every flag defaults off: with all of
 * them unset the runtime behaves exactly as before. Values are read at call
 * time (tests use vi.stubEnv) and come only from the server environment, never
 * from message content or a model. Created byte-identically by every step that
 * reads a flag; change it only in a follow-up commit after the steps merge.
 */

export type TriageQuestionSet = 'v1' | 'v2' | 'v2-live';
export type DeciderKind = 'default' | 'service';

export interface TirehFlags {
  /** S03 TIREH_CACHED_PROMPT=1: system blocks A/B/C and a per-turn block in the newest user turn. */
  readonly cachedPrompt: boolean;
  /** S03 TIREH_PROMPT_SYSTEM_TAIL=1: A/B arm sending the per-turn block as a trailing system tail. Needs cachedPrompt. */
  readonly promptSystemTail: boolean;
  /** S06 TIREH_RETRIEVAL_V2=1: Persian-aware fused ranking, at most 8 memories for the prompt. */
  readonly retrievalV2: boolean;
  /** S06 TIREH_VECTOR_RETRIEVAL=1: Firestore findNearest candidates. Needs retrievalV2. */
  readonly vectorRetrieval: boolean;
  /** S08 TIREH_SHARING_V2=1: successor filter, supersede notices, shared-context consent decoupling, group re-snapshot. */
  readonly sharingV2: boolean;
  /** S08 TIREH_AUDIT_LOG=1: content-free append-only vox_audit rows. */
  readonly auditLog: boolean;
  /** S09 STUDIO_DECIDER=service: triage through DecisionService; anything else keeps the current decider. */
  readonly decider: DeciderKind;
  /** S09 TRIAGE_QUESTION_SET=v2 | v2-live; unset or unknown means v1, the current questions. */
  readonly triageQuestionSet: TriageQuestionSet;
  /** S09 TIREH_DECISION_LOG=1: content-free decision log rows with 90-day retention. */
  readonly decisionLog: boolean;
  /** S12 STUDIO_IMAGES=1: Telegram photo and image-document ingestion. */
  readonly images: boolean;
  /** S11L STUDIO_VOICE_RECOGNITION=1: voiceprint enrollment and verification; approval and consent are still required. */
  readonly voiceRecognition: boolean;
  /** S11L STUDIO_VOICE_SHADOW=1: shadow verification of 1:1 voice notes, off the reply path; needs STUDIO_VOICE_RECOGNITION */
  readonly voiceShadow: boolean;
}

const on = (value: string | undefined): boolean => value?.trim() === '1';

export function tirehFlags(env: NodeJS.ProcessEnv = process.env): TirehFlags {
  const questionSet = env.TRIAGE_QUESTION_SET?.trim().toLowerCase();
  const cachedPrompt = on(env.TIREH_CACHED_PROMPT);
  const retrievalV2 = on(env.TIREH_RETRIEVAL_V2);
  return {
    cachedPrompt,
    promptSystemTail: cachedPrompt && on(env.TIREH_PROMPT_SYSTEM_TAIL),
    retrievalV2,
    vectorRetrieval: retrievalV2 && on(env.TIREH_VECTOR_RETRIEVAL),
    sharingV2: on(env.TIREH_SHARING_V2),
    auditLog: on(env.TIREH_AUDIT_LOG),
    decider: env.STUDIO_DECIDER?.trim().toLowerCase() === 'service' ? 'service' : 'default',
    triageQuestionSet: questionSet === 'v2' || questionSet === 'v2-live' ? questionSet : 'v1',
    decisionLog: on(env.TIREH_DECISION_LOG),
    images: on(env.STUDIO_IMAGES),
    voiceRecognition: on(env.STUDIO_VOICE_RECOGNITION),
    voiceShadow: on(env.STUDIO_VOICE_SHADOW),
  };
}
