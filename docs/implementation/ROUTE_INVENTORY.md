# Route inventory outside /api/studio

Base commit `6d00b80`, dated 2026-10-22. **Documentation only: no route is changed by
this document.** Studio routes under `/api/studio` are out of scope. The recommendations
are inputs to the "legacy `/app` surface and standalone TIREH runtime: retire or keep by
decision" item in [AGENT_INTELLIGENCE_SOLUTION.md](../AGENT_INTELLIGENCE_SOLUTION.md)
section 7.

The table lists exactly the 30 `route.ts` files under `src/app/api` outside
`src/app/api/studio`, with the authentication found by reading each file at the base.

**Production exposure.** `src/middleware.ts` returns 404 for every path outside `/studio`
and `/api/studio` when `STUDIO_ONLY=1`, except the guest-rights intake paths (exact paths
and methods, no query string) and `POST /api/connections/broker` when the broker
configuration is present. `STUDIO_ONLY=1` is the production setting
(`.github/workflows/deploy.yml`, `scripts/firebase-production-env.mjs`,
`docs/PRODUCTION.md`), so most rows are unreachable in production today but stay one
environment variable away from exposure. The recommendations assume that gate can be lost.

Auth terms: *withAuth* is `src/lib/middleware/withAuth.ts` (Firebase ID token via
`verifyIdToken`); *ID token* means the handler verifies the Firebase bearer token itself.

| Route | Methods | Auth at base | Providers/data egress | Known callers | Recommendation | Reason and follow-up |
|---|---|---|---|---|---|---|
| `/api/auth/telegram` | GET, POST | POST: Telegram `initData` HMAC (or Login Widget hash), 24-hour freshness, exchanged for a Firebase token. GET: none (login enabled flag, bot username) | Telegram bot token as HMAC key; Firebase Auth | Login page, `TelegramProvider` | keep | Keep while `/app` exists; retire with `/app`. |
| `/api/chat` | POST | withAuth plus chat rate limit | Google Gemini, Anthropic Claude, OpenAI, DeepSeek (OpenAI SDK with a DeepSeek base URL); chat text | `ChatService` | retire | Retire with `/app`; if kept, add processor rows to PRIV-009. |
| `/api/chat/stream` | POST | Same as `/api/chat` | Same as `/api/chat`, streamed | `stream-chat` | retire | Retire with `/app`. |
| `/api/clone-voice` | POST | Firebase ID token plus tier check; voice-clone rate limiter | ElevenLabs `voices/add` with uploaded voice samples | Legacy `/app` voice settings | retire | PRIV-003/PRIV-025 exclude voice cloning in this release, and there is no subject-consent check. |
| `/api/connections/broker` | POST | Broker authenticator (HMAC plus current Studio profile authority); 503 when unconfigured | Connections broker control plane | Studio connections | keep | Narrow, authenticated part of the Studio authority model. |
| `/api/convai/session` | POST | withAuth; per-account rate limiter | ElevenLabs signed URL for env `ELEVENLABS_AGENT_ID` | `features/call/useCall` | retire | Retire with `/app`; Studio live calls use `/api/studio`. The unauthenticated `/api/convai` proxies were deleted in Step 0. |
| `/api/features` | GET | ID token | Feature flags for the signed-in user | Legacy `/app` | keep | Keep with `/app`; read-only. |
| `/api/guest-rights/[[...path]]` | GET, POST | Telegram `initData` via `VOXX_BOT_TOKEN`; middleware admits exact paths and methods only | Studio guest privacy-rights requests | Studio guest rights | keep | Serves data-subject requests from people without accounts. |
| `/api/health` | GET | None | Firebase read, Redis and Stripe configuration checks; returns Firebase `error.message` strings, environment and version | Operations | secure | Return public status only; put details behind auth. |
| `/api/memory/extract` | POST | withAuth | Google Gemini 2.0 Flash over conversation text | `memory/context`, `MemoryService` | retire | Retire with `/app`; if kept, add a processor row. Old memory stack outside the TIREH privacy rules. |
| `/api/stripe/create-checkout` | POST | ID token | Stripe checkout session | `/app` billing | keep | Keep with `/app` billing. |
| `/api/stripe/create-portal` | POST | ID token | Stripe customer portal | `/app` billing | keep | Keep with `/app` billing. |
| `/api/stripe/webhook` | POST | Stripe signature via `constructEvent` | Stripe events; logs userId and tier only | Stripe | keep | Correctly signed; needed while Stripe billing exists. |
| `/api/stt` | POST | withAuth plus rate limit | ElevenLabs Scribe; recorded audio | Translator page | secure | `console.log('[STT] ElevenLabs response:', result)` logs transcript text, and provider error details are returned to the client. Remove both, or retire with `/app` (translator page). Not fixed in S15. |
| `/api/telegram/payments` | POST | Firebase ID token (`withAuth`); the invoice `userId` is the token's uid, and a different body `userId` is refused (403) | Telegram Bot API (`createInvoiceLink`) | Legacy Telegram payments | fixed | **P0 fixed in the Wave A fixer round (2026-10-22).** The unauthenticated PUT (caller-supplied `successful_payment` wrote an active subscription; every `pre_checkout_query` auto-approved) is deleted: Telegram delivers updates by POST, so only `/api/telegram/webhook` handles payment updates. |
| `/api/telegram/webhook` | GET, POST | POST: secret token verified (`verifyTelegramWebhookToken`) plus rate limit; with `TELEGRAM_WEBHOOK_SECRET` unset verification is skipped (warns) unless `TELEGRAM_WEBHOOK_FAIL_CLOSED=1`, which rejects every request. GET: none | Legacy bot updates and payments. Logs only fixed `telegram_webhook:<code>` lines (QA round 3). `pre_checkout_query` and `successful_payment` are accepted only for a known `priceId` at that price's amount and currency (`src/lib/telegram/prices.ts`); tier and duration come from the price table | Legacy Telegram bot | open (no secret = unverified) | Fail-closed exists behind `TELEGRAM_WEBHOOK_FAIL_CLOSED` (default off) so deployments without the secret keep receiving payment updates. Rollout: set `TELEGRAM_WEBHOOK_SECRET` in every legacy deployment, register it as the setWebhook `secret_token`, then set `TELEGRAM_WEBHOOK_FAIL_CLOSED=1`. Owner: not yet named. Content logs removed in QA round 3. Without the secret a forged update for a real price and amount is still accepted, so the secret rollout remains the fix. |
| `/api/tireh/telegram/[personaId]` | POST | `TIREH_WEBHOOK_SECRET` header; disabled (503) when unset | Standalone TIREH runtime: Anthropic (or the deprecated `GeminiLLM` via `TIREH_LLM_PROVIDER=gemini`), ElevenLabs | Persona bot webhooks | retire | The only production path to the deprecated `GeminiLLM`. Retire after confirming with `getWebhookInfo` that no persona bot webhook points at it. |
| `/api/translate` | POST | withAuth | OpenAI `gpt-4o-mini` chat completions via raw fetch, plus ElevenLabs TTS; text to translate | Translator page | retire | Retire with `/app`. |
| `/api/translator/messages` | GET, POST, DELETE | ID token | Firestore translator history | Translator page | retire | Retire with `/app`. |
| `/api/tts` | POST | withAuth | ElevenLabs TTS; text to speak | Legacy `/app` | retire | Retire with `/app`. |
| `/api/tts/stream` | POST | ID token | ElevenLabs streaming TTS | Legacy `/app` | retire | Retire with `/app`. |
| `/api/user/data` | GET, POST | ID token | Firestore chats, preferences and contacts | Legacy `/app` | keep | Keep with `/app`; access and export rights rely on it. |
| `/api/user/subscription` | GET | ID token | Firestore subscription status | Legacy `/app` billing | keep | Keep with `/app`. |
| `/api/user/voices` | GET, POST, DELETE, PATCH | ID token | Firestore cloned-voice records, default translator voice | Legacy `/app` | keep | Keep with `/app`; DELETE serves deletion of cloned-voice records. |
| `/api/v2/chats` | GET, POST | ID token plus rate limit | Firestore chats | Legacy `/app` | keep | Keep with `/app`. |
| `/api/v2/chats/[chatId]` | GET, PATCH, DELETE | ID token plus rate limit | Firestore chat | Legacy `/app` | keep | Keep with `/app`. |
| `/api/v2/chats/[chatId]/messages` | GET, POST | ID token plus rate limit | Firestore chat messages | Legacy `/app` | keep | Keep with `/app`. |
| `/api/v2/migrate` | GET, POST | ID token | Firestore v1-to-v2 migration of chat data | Legacy `/app` | retire | Retire once the v1-to-v2 migration is confirmed complete. |
| `/api/v2/sync` | GET, POST | ID token plus rate limit | Firestore sync | Legacy `/app` | keep | Keep with `/app`. |
| `/api/voices` | GET | None; rate-limited | Proxies the server ElevenLabs key's voice list, cached one hour | Legacy `/app` | secure | Unauthenticated use of a server credential: require auth, or retire with `/app`. |

## Decisions needed

1. Retire the legacy `/app` surface? Retiring it removes most rows above, the remaining
   Gemini and DeepSeek call sites and the old memory stack. `/api/user/data` and
   `/api/user/voices` need a replacement or a final export before removal.
2. Retire the standalone TIREH runtime (`/api/tireh/telegram/[personaId]`,
   `src/lib/tireh/runtime.ts`, `scripts/tireh-local.ts`), and with it `GeminiLLM`?
3. ~~Owner and date for the P0 fix of `PUT /api/telegram/payments`.~~ Fixed in the Wave A fixer round (2026-10-22). Remaining: name an owner for the `TELEGRAM_WEBHOOK_SECRET` rollout (set it in every legacy deployment, register it with setWebhook, then turn on `TELEGRAM_WEBHOOK_FAIL_CLOSED=1`). (The webhook content logs were removed in QA round 3.)
