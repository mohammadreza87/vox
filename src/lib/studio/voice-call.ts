/**
 * Live voice calls through ElevenLabs Agents.
 *
 *   browser ──audio──▶ ElevenLabs (speech-to-text, turn-taking, Flash TTS)
 *                         │ OpenAI-style chat completion, per turn
 *                         ▼
 *            /api/studio/voice-llm  ──▶  the agent's persona + memories (Claude)
 *
 * ElevenLabs authenticates to our endpoint with a key derived from
 * STUDIO_SECRET; the browser passes a short-lived call token (agent + caller,
 * signed by us) that ElevenLabs forwards with every turn, so a caller can't
 * talk as someone else or to an agent they may not use.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import type { Studio } from './service';
import { logTelegramDiagnostic } from '../tireh/telegram/diagnostics';

export const CALL_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
export const MAX_CALL_SECONDS = 15 * 60;
/** How long a streamed live turn waits for its first delta before sending SSE headers. */
export const FIRST_DELTA_GRACE_MS = 250;

/** The bearer key ElevenLabs sends to our LLM endpoint (stored as an ElevenLabs secret). */
export function voiceLlmKey(secret: string): string {
  return createHmac('sha256', secret).update('voice-llm-key').digest('base64url');
}

/** Identifies the key without revealing it, to notice a rotated STUDIO_SECRET. */
export function voiceLlmKeyId(secret: string): string {
  return createHmac('sha256', voiceLlmKey(secret)).update('id').digest('hex').slice(0, 16);
}

const sign = (secret: string, body: string) => createHmac('sha256', secret).update(`voice-call:${body}`).digest('base64url');

export function callToken(secret: string, agentId: string, telegramId: number, now: Date): string {
  const body = Buffer.from(JSON.stringify({ a: agentId, u: telegramId, e: now.getTime() + CALL_TOKEN_TTL_MS })).toString('base64url');
  return `${body}.${sign(secret, body)}`;
}

export function readCallToken(secret: string, token: unknown, now: Date): { agentId: string; telegramId: number } | null {
  if (typeof token !== 'string' || token.length > 512) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { a, u, e } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { a: unknown; u: unknown; e: unknown };
    if (typeof a !== 'string' || !Number.isSafeInteger(u) || typeof e !== 'number' || e < now.getTime()) return null;
    return { agentId: a, telegramId: u as number };
  } catch {
    return null;
  }
}

export function bearerMatches(header: string | null, expected: string): boolean {
  const token = /^Bearer[ \t]+(.+)$/i.exec(header ?? '')?.[1];
  if (!token) return false;
  const a = Buffer.from(token), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Turn = { role: 'user' | 'assistant'; content: string };

/** OpenAI chat messages → plain user/assistant turns (system and tool messages are ours to write). */
export function toTurns(messages: unknown): Turn[] {
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((m): Turn[] => {
    if (!m || typeof m !== 'object') return [];
    const { role, content } = m as { role?: unknown; content?: unknown };
    if (role !== 'user' && role !== 'assistant') return [];
    const text = typeof content === 'string' ? content
      : Array.isArray(content) ? content.map((c) => (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : '')).join('')
      : '';
    return text.trim() ? [{ role, content: text.slice(0, 4000) }] : [];
  });
}

/**
 * POST from ElevenLabs: an OpenAI-style chat completion request, answered as
 * a server-sent event stream of `chat.completion.chunk`s.
 */
export async function handleVoiceLlm(studio: Studio, request: Request): Promise<Response> {
  if (!bearerMatches(request.headers.get('authorization'), voiceLlmKey(studio.deps.secret))) {
    return Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { messages?: unknown; stream?: unknown; elevenlabs_extra_body?: { call?: unknown } } | null;
  const call = readCallToken(studio.deps.secret, body?.elevenlabs_extra_body?.call, new Date());
  if (!call) return Response.json({ error: { message: 'This call has expired. Start a new one.' } }, { status: 403 });

  let parts: AsyncIterator<string>;
  try {
    // Start before answering so access errors become a proper HTTP error.
    parts = (await studio.liveTurn(call.agentId, call.telegramId, toTurns(body?.messages)))[Symbol.asyncIterator]();
  } catch {
    logTelegramDiagnostic(console, 'live_turn_failed');
    return Response.json({ error: { message: 'The agent is unavailable.' } }, { status: 503 });
  }
  const id = `chatcmpl-${Date.now().toString(36)}`;
  const created = Math.floor(Date.now() / 1000);
  const unavailable = () => {
    logTelegramDiagnostic(console, 'live_turn_failed');
    return Response.json({ error: { message: 'The agent is unavailable.' } }, { status: 503 });
  };

  const firstPart = parts.next();
  if (body?.stream === false) {
    let first: IteratorResult<string>;
    try { first = await firstPart; } catch { return unavailable(); }
    let text = '';
    for (let r = first; !r.done; r = await parts.next()) text += r.value;
    return Response.json({ id, object: 'chat.completion', created, model: 'vox-persona', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] });
  }
  // Stream: the SSE headers go out once the first delta arrives or after a
  // short grace, whichever is first, instead of waiting for the first token.
  // A failure inside the grace stays a retryable HTTP error for ElevenLabs;
  // after it the headers are committed and a failure ends the stream with the
  // spoken fallback, as a mid-stream failure always did.
  firstPart.catch(() => undefined);
  let first: IteratorResult<string> | undefined;
  let grace: ReturnType<typeof setTimeout> | undefined;
  try { first = await Promise.race([firstPart, new Promise<undefined>(resolve => { grace = setTimeout(() => resolve(undefined), FIRST_DELTA_GRACE_MS); })]); }
  catch { return unavailable(); }
  finally { clearTimeout(grace); }

  const chunk = (delta: Record<string, string>, finish: string | null = null) =>
    `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: 'vox-persona', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(chunk({ role: 'assistant' })));
        for (let r = first ?? await firstPart; !r.done; r = await parts.next()) {
          if (r.value) controller.enqueue(encoder.encode(chunk({ content: r.value })));
        }
      } catch {
        logTelegramDiagnostic(console, 'live_stream_failed');
        controller.enqueue(encoder.encode(chunk({ content: ' Sorry, I lost my train of thought.' })));
      }
      controller.enqueue(encoder.encode(chunk({}, 'stop')));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
    async cancel() {
      await parts.return?.();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' } });
}
