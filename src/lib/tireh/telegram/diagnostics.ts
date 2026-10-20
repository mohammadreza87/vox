/**
 * Content-free operational diagnostics for Telegram ingress. Callers select a
 * fixed event; exceptions, request data and bot/account identifiers never enter
 * this API. This is not a conversation/analytics event producer.
 *
 * Timing events (`timing_*`) add exactly two fields: a route from a fixed list
 * and a whole number of milliseconds. Nothing else a caller passes is logged.
 */
const diagnostics = {
  poll_failed: { level: 'warn', stage: 'poll', reason: 'operation_failed', outcome: 'retry_scheduled' },
  update_failed: { level: 'error', stage: 'update', reason: 'operation_failed', outcome: 'continue_polling' },
  menu_failed: { level: 'warn', stage: 'menu', reason: 'operation_failed', outcome: 'continue_polling' },
  refresh_failed: { level: 'error', stage: 'refresh', reason: 'operation_failed', outcome: 'retry_on_refresh' },
  profile_failed: { level: 'warn', stage: 'profile', reason: 'operation_failed', outcome: 'retry_on_refresh' },
  relationship_failed: { level: 'warn', stage: 'relationship', reason: 'operation_failed', outcome: 'retry_on_drain' },
  bot_online: { level: 'info', stage: 'lifecycle', reason: 'activated', outcome: 'online' },
  bot_offline: { level: 'info', stage: 'lifecycle', reason: 'deactivated', outcome: 'offline' },
  persona_webhook_disabled: { level: 'error', stage: 'persona_webhook', reason: 'not_configured', outcome: 'http_503' },
  persona_webhook_failed: { level: 'error', stage: 'persona_webhook', reason: 'operation_failed', outcome: 'http_200' },
  studio_webhook_disabled: { level: 'error', stage: 'studio_webhook', reason: 'not_configured', outcome: 'http_503' },
  studio_webhook_setup_failed: { level: 'error', stage: 'studio_webhook_setup', reason: 'operation_failed', outcome: 'http_502' },
  studio_webhook_failed: { level: 'error', stage: 'studio_webhook', reason: 'operation_failed', outcome: 'http_200' },
  managed_bot_fired: { level: 'warn', stage: 'managed_bot', reason: 'agent_inactive', outcome: 'ignored' },
  managed_bot_unmatched: { level: 'warn', stage: 'managed_bot', reason: 'no_waiting_agent', outcome: 'ignored' },
  token_decryption_failed: { level: 'error', stage: 'bot_token', reason: 'decryption_failed', outcome: 'unavailable' },
  profile_apply_failed: { level: 'warn', stage: 'profile_apply', reason: 'operation_failed', outcome: 'retry_on_refresh' },
  profile_edit_failed: { level: 'warn', stage: 'profile_edit', reason: 'operation_failed', outcome: 'continue' },
  profile_photo_failed: { level: 'warn', stage: 'profile_photo', reason: 'operation_failed', outcome: 'continue' },
  profile_webhook_failed: { level: 'warn', stage: 'profile_webhook', reason: 'operation_failed', outcome: 'continue' },
  profile_name_failed: { level: 'warn', stage: 'profile_name', reason: 'operation_failed', outcome: 'continue' },
  profile_short_description_failed: { level: 'warn', stage: 'profile_short_description', reason: 'operation_failed', outcome: 'continue' },
  profile_description_failed: { level: 'warn', stage: 'profile_description', reason: 'operation_failed', outcome: 'continue' },
  profile_commands_failed: { level: 'warn', stage: 'profile_commands', reason: 'operation_failed', outcome: 'continue' },
  stranger_decider_failed: { level: 'warn', stage: 'stranger_decider', reason: 'operation_failed', outcome: 'fallback_model' },
  stranger_fallback_failed: { level: 'warn', stage: 'stranger_fallback', reason: 'operation_failed', outcome: 'fallback_decision' },
  speech_failed: { level: 'warn', stage: 'speech', reason: 'operation_failed', outcome: 'text_fallback' },
  voice_agent_configured: { level: 'info', stage: 'voice_agent', reason: 'configured', outcome: 'available' },
  relationship_history_failed: { level: 'warn', stage: 'relationship_history', reason: 'operation_failed', outcome: 'continue' },
  relationship_observation_failed: { level: 'warn', stage: 'relationship_observation', reason: 'operation_failed', outcome: 'continue' },
  unknown_account: { level: 'warn', stage: 'audience', reason: 'unknown_account', outcome: 'refused' },
  unknown_group: { level: 'warn', stage: 'audience', reason: 'unknown_group', outcome: 'refused' },
  group_nonmember: { level: 'warn', stage: 'audience', reason: 'group_nonmember', outcome: 'refused' },
  reply_generation_failed: { level: 'error', stage: 'reply_generation', reason: 'operation_failed', outcome: 'ignored' },
  reply_empty: { level: 'warn', stage: 'reply_generation', reason: 'empty_output', outcome: 'fallback_reply' },
  extraction_failed: { level: 'error', stage: 'memory_extraction', reason: 'operation_failed', outcome: 'continue' },
  transcription_failed: { level: 'error', stage: 'transcription', reason: 'operation_failed', outcome: 'unavailable' },
  triage_failed: { level: 'warn', stage: 'triage', reason: 'operation_failed', outcome: 'full_reply_path' },
  voice_delivery_failed: { level: 'error', stage: 'voice_delivery', reason: 'delivery_failed', outcome: 'text_fallback' },
  voice_quota_failed: { level: 'error', stage: 'voice_delivery', reason: 'quota_exceeded', outcome: 'text_fallback' },
  voice_rate_limited: { level: 'error', stage: 'voice_delivery', reason: 'rate_limited', outcome: 'text_fallback' },
  voice_payment_failed: { level: 'error', stage: 'voice_delivery', reason: 'payment_required', outcome: 'text_fallback' },
  voice_permission_failed: { level: 'error', stage: 'voice_delivery', reason: 'permission_denied', outcome: 'text_fallback' },
  voice_unavailable: { level: 'error', stage: 'voice_delivery', reason: 'unavailable', outcome: 'text_fallback' },
  voice_provider_failed: { level: 'error', stage: 'voice_delivery', reason: 'provider_error', outcome: 'text_fallback' },
  voice_transcript_failed: { level: 'warn', stage: 'voice_transcript', reason: 'operation_failed', outcome: 'audio_already_delivered' },
  transcription_fallback: { level: 'warn', stage: 'transcription', reason: 'primary_provider_failed', outcome: 'fallback_provider' },
  web_search_unavailable: { level: 'warn', stage: 'web_search', reason: 'tool_unavailable', outcome: 'reply_without_search' },
  live_turn_failed: { level: 'warn', stage: 'live_turn', reason: 'operation_failed', outcome: 'http_503' },
  live_stream_failed: { level: 'warn', stage: 'live_stream', reason: 'operation_failed', outcome: 'stream_fallback' },
  studio_http_voice_failed: { level: 'warn', stage: 'studio_http_voice', reason: 'provider_unavailable', outcome: 'http_error' },
  studio_http_persona_failed: { level: 'warn', stage: 'persona_generation', reason: 'invalid_output', outcome: 'http_502' },
  studio_http_provider_failed: { level: 'error', stage: 'studio_http', reason: 'provider_failed', outcome: 'http_502' },
  studio_http_failed: { level: 'error', stage: 'studio_http', reason: 'operation_failed', outcome: 'http_500' },
  skill_route_failed: { level: 'warn', stage: 'skill_route', reason: 'operation_failed', outcome: 'local_fallback' },
  skill_route_timeout: { level: 'warn', stage: 'skill_route', reason: 'timeout', outcome: 'local_fallback' },
  skill_route_refused: { level: 'warn', stage: 'skill_route', reason: 'no_answer', outcome: 'local_fallback' },
  timing_ingress: { level: 'info', stage: 'ingress', reason: 'timing', outcome: 'measured' },
  timing_stt: { level: 'info', stage: 'stt', reason: 'timing', outcome: 'measured' },
  timing_boundary: { level: 'info', stage: 'boundary', reason: 'timing', outcome: 'measured' },
  timing_triage: { level: 'info', stage: 'triage', reason: 'timing', outcome: 'measured' },
  timing_retrieval: { level: 'info', stage: 'retrieval', reason: 'timing', outcome: 'measured' },
  timing_prompt: { level: 'info', stage: 'prompt', reason: 'timing', outcome: 'measured' },
  timing_llm_ttft: { level: 'info', stage: 'llm_ttft', reason: 'timing', outcome: 'measured' },
  timing_llm_done: { level: 'info', stage: 'llm_done', reason: 'timing', outcome: 'measured' },
  timing_tts: { level: 'info', stage: 'tts', reason: 'timing', outcome: 'measured' },
  timing_send: { level: 'info', stage: 'send', reason: 'timing', outcome: 'measured' },
  timing_extraction: { level: 'info', stage: 'extraction', reason: 'timing', outcome: 'measured' },
  timing_total: { level: 'info', stage: 'total', reason: 'timing', outcome: 'measured' },
} as const;

export type TelegramDiagnostic = keyof typeof diagnostics;

/** Turn stages that can be timed; see tireh/timing.ts for what each one spans. */
export const TIMING_STAGES = ['ingress', 'stt', 'boundary', 'triage', 'retrieval', 'prompt', 'llm_ttft', 'llm_done', 'tts', 'send', 'extraction', 'total'] as const;
export type TimingStage = typeof TIMING_STAGES[number];
export const TIMING_ROUTES = ['private_text', 'group_text', 'voice_note', 'call_turn', 'live_call'] as const;
export type TimingRoute = typeof TIMING_ROUTES[number];
const MAX_TIMING_MS = 86_400_000;

const profileSteps = {
  webhook: 'profile_webhook_failed', name: 'profile_name_failed', photo: 'profile_photo_failed',
  'short description': 'profile_short_description_failed', description: 'profile_description_failed', commands: 'profile_commands_failed',
} as const satisfies Record<string, TelegramDiagnostic>;

export function profileStepDiagnostic(step: string): TelegramDiagnostic {
  return Object.hasOwn(profileSteps, step) ? profileSteps[step as keyof typeof profileSteps] : 'profile_apply_failed';
}

/** Only exact known codes survive; hostile getters/proxies cannot break fallback. */
export function voiceFailureDiagnostic(error: unknown): TelegramDiagnostic {
  try {
    const code: unknown = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    switch (code) {
      case 'quota_exceeded': return 'voice_quota_failed';
      case 'rate_limited': return 'voice_rate_limited';
      case 'payment_required': return 'voice_payment_failed';
      case 'permission_denied': return 'voice_permission_failed';
      case 'unavailable': return 'voice_unavailable';
      case 'provider_error': return 'voice_provider_failed';
    }
  } catch { /* A diagnostic must not interfere with the text fallback. */ }
  return 'voice_delivery_failed';
}

export function logTelegramDiagnostic(
  log: Pick<Console, 'info' | 'warn' | 'error'>,
  event: TelegramDiagnostic,
  timing?: { route: TimingRoute; durationMs: number },
): void {
  // Guard even callers that bypass the type boundary. No unknown value is
  // forwarded to the destination, including inherited object property names.
  if (!Object.hasOwn(diagnostics, event)) return;
  const diagnostic = diagnostics[event];
  const fields = { type: 'telegram_ingress', stage: diagnostic.stage, reason: diagnostic.reason, outcome: diagnostic.outcome };
  if (diagnostic.reason !== 'timing') {
    log[diagnostic.level](fields);
    return;
  }
  // A timing event without a valid measurement is dropped, never logged
  // partially. Hostile getters cannot escape: only copied primitives are used.
  let route: unknown, durationMs: unknown;
  try { route = timing?.route; durationMs = timing?.durationMs; } catch { return; }
  if (typeof route !== 'string' || !(TIMING_ROUTES as readonly string[]).includes(route)) return;
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) return;
  log[diagnostic.level]({ ...fields, route: route as TimingRoute, durationMs: Math.min(MAX_TIMING_MS, Math.max(0, Math.round(durationMs))) });
}

/** One content-free timing line for a stage of a turn on a fixed route. */
export function logStageTiming(log: Pick<Console, 'info' | 'warn' | 'error'>, route: TimingRoute, stage: TimingStage, durationMs: number): void {
  if (!(TIMING_STAGES as readonly string[]).includes(stage)) return;
  logTelegramDiagnostic(log, `timing_${stage}`, { route, durationMs });
}
