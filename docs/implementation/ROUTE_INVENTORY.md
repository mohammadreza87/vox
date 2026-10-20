# Routes outside /api/studio (inventory at 6d00b80)

Step 15 of [docs/AGENT_INTELLIGENCE_SOLUTION.md](../AGENT_INTELLIGENCE_SOLUTION.md).
**This document changes no route.** It lists every `route.ts` under `src/app/api`
outside `/api/studio` (30 files) at commit `6d00b80`, the authentication found by
reading each file, and a recommendation: retire, keep or secure.

**Production exposure.** `src/middleware.ts` returns 404 for every path outside
`/studio` and `/api/studio` when `STUDIO_ONLY=1`, except two narrow exceptions:
the guest-rights intake paths (exact paths and methods, no query string) and
`POST /api/connections/broker` when the broker configuration is present.
`STUDIO_ONLY=1` is the production setting (`.github/workflows/deploy.yml`,
`scripts/firebase-production-env.mjs`, `docs/PRODUCTION.md`). Every other route
below is therefore unreachable in production today, but stays one environment
variable away from exposure. The recommendations assume that gate can be lost.

Auth terms: *withAuth* is `src/lib/middleware/withAuth.ts` (Firebase ID token via
`verifyIdToken`); *verifyIdToken* means the handler checks the bearer token itself.

| Route | Methods | Auth at base (verified by reading the file) | Providers / data | Surface | Recommendation | Reason |
|---|---|---|---|---|---|---|
| `/api/auth/telegram` | POST, GET | POST: Telegram Mini App `initData` HMAC or Login Widget hash, 24-hour freshness; issues a session JWT. GET: none (returns whether Telegram login is enabled and the bot username) | Telegram bot token (HMAC key) | Legacy `/app` login | Keep, tied to the `/app` decision | Correct HMAC check; it only matters while `/app` exists |
| `/api/chat` | POST | withAuth; chat rate limiter | OpenAI (SDK), Gemini (`@google/generative-ai`), DeepSeek (OpenAI SDK with a DeepSeek base URL); chat text | Legacy `/app` | Retire with legacy `/app` | Duplicates Studio chat on separate providers outside the privacy design |
| `/api/chat/stream` | POST | withAuth; chat rate limiter | Same as `/api/chat`, streamed | Legacy `/app` | Retire with legacy `/app` | Same as `/api/chat` |
| `/api/clone-voice` | POST | verifyIdToken; voice-clone rate limiter | ElevenLabs `voices/add` (voice cloning from uploaded audio) | Legacy `/app` | Retire | PRIV-025 allows no voice cloning in the first release |
| `/api/connections/broker` | POST | Admitted by middleware only with explicit broker configuration; HMAC and current Studio profile authority in `handleStudioBrokerControl` | Connections broker control plane | Studio connections | Keep | Part of the Studio authority model; narrow, authenticated exception |
| `/api/convai/session` | POST | withAuth; per-account rate limiter | ElevenLabs signed URL for the shared legacy agent | Legacy `/app` voice calls | Retire with `/app` | The unauthenticated `/api/convai` proxies were deleted in Step 0; Studio calls use `/api/studio/voice-llm` |
| `/api/features` | GET | verifyIdToken | Feature flags for the signed-in user | Legacy `/app` | Keep with `/app` | Read-only; goes when `/app` goes |
| `/api/guest-rights/[[...path]]` | GET, POST | Public intake by design; middleware admits only exact paths and methods without a query string; the handler applies the guest-rights policy | Guest rights requests (Studio guest-rights runtime) | Guest rights intake | Keep | Serves data-subject requests from people without accounts |
| `/api/health` | GET | None | Firebase read, Redis and Stripe configuration and reachability, including provider error messages and the app version | Operations | Secure | Unauthenticated detail about infrastructure; return liveness only, or restrict to operators |
| `/api/memory/extract` | POST | withAuth; no rate limiter found | Gemini; chat text | Legacy `/app` memory | Retire with `/app` | Old memory stack outside the TIREH privacy rules |
| `/api/stripe/create-checkout` | POST | verifyIdToken | Stripe checkout session | Billing | Keep, by billing decision | Authenticated; depends on whether paid plans continue |
| `/api/stripe/create-portal` | POST | verifyIdToken | Stripe customer portal | Billing | Keep, by billing decision | Authenticated; depends on whether paid plans continue |
| `/api/stripe/webhook` | POST | Stripe signature (`constructEvent`) | Stripe events, subscription records | Billing | Keep, by billing decision | Correctly signed; needed while Stripe billing exists |
| `/api/stt` | POST | withAuth; API rate limiter | ElevenLabs Scribe (`scribe_v1`); recorded audio | Legacy `/app` | Retire with `/app` | Studio has its own STT path |
| `/api/telegram/payments` | POST, PUT | None | Telegram Bot API (invoice links, `answerPreCheckoutQuery`); writes a subscription document | Legacy Telegram payments | Secure or retire, highest priority | POST creates invoice links for any caller-supplied user; PUT approves every `pre_checkout_query` and, on a `successful_payment` body, writes an active subscription for the `userId` in the payload |
| `/api/telegram/webhook` | POST, GET | POST: webhook rate limiter and `verifyTelegramWebhookToken`, which skips verification when `TELEGRAM_WEBHOOK_SECRET` is unset; GET: none | Legacy bot updates, payments; logs full update bodies to the console | Legacy Telegram bot | Retire, by decision (section 7) | Fails open without the secret and logs message content; Studio bots use their own ingress |
| `/api/tireh/telegram/[personaId]` | POST | Secret header; 503 when `TIREH_WEBHOOK_SECRET` is unset | Standalone TIREH runtime (Anthropic, or deprecated Gemini via `TIREH_LLM_PROVIDER=gemini`), ElevenLabs | Standalone TIREH | Retire after the decision; keep the code until then | Superseded by Studio; still the only route that reaches `GeminiLLM` |
| `/api/translate` | POST | withAuth; API rate limiter | OpenAI chat completions (raw fetch), ElevenLabs TTS; text to translate | Legacy translator | Retire with `/app` | Not part of Studio |
| `/api/translator/messages` | GET, POST, DELETE | Firebase ID token (`getAdminAuth().verifyIdToken`) | Firestore translator history | Legacy translator | Retire with `/app` | Not part of Studio |
| `/api/tts` | POST | withAuth; API rate limiter | ElevenLabs TTS; text to speak | Legacy `/app` | Retire with `/app` | Studio has its own TTS path |
| `/api/tts/stream` | POST | verifyIdToken | ElevenLabs streaming TTS | Legacy `/app` | Retire with `/app` | Studio has its own TTS path |
| `/api/user/data` | GET, POST | verifyIdToken; v2 API rate limiter | Firestore chats, preferences and contacts (load and save) | Legacy `/app` | Keep while `/app` exists | Serves the user's own data, which rights requests (access, export) rely on |
| `/api/user/subscription` | GET | verifyIdToken | Firestore subscription status | Legacy `/app` billing | Keep while `/app` exists | Read-only status for signed-in users |
| `/api/user/voices` | GET, POST, DELETE, PATCH | verifyIdToken | Firestore cloned-voice records, default translator voice | Legacy `/app` | Keep while `/app` exists | DELETE serves deletion of a user's cloned-voice records |
| `/api/v2/chats` | GET, POST | verifyIdToken | Firestore chats | Legacy `/app` | Retire with `/app` | Legacy chat storage |
| `/api/v2/chats/[chatId]` | GET, PATCH, DELETE | verifyIdToken | Firestore chat | Legacy `/app` | Retire with `/app` | Legacy chat storage |
| `/api/v2/chats/[chatId]/messages` | GET, POST | verifyIdToken | Firestore chat messages | Legacy `/app` | Retire with `/app` | Legacy chat storage |
| `/api/v2/migrate` | POST, GET | verifyIdToken | Firestore migration of legacy chat data | Legacy `/app` | Retire with `/app` | One-time migration helper |
| `/api/v2/sync` | POST, GET | verifyIdToken | Firestore sync | Legacy `/app` | Retire with `/app` | Legacy chat storage |
| `/api/voices` | GET | None; voices rate limiter only | Proxies the server ElevenLabs key's voice list (cached one hour) | Legacy `/app` | Secure (require auth) or retire | Unauthenticated use of a server credential |

## Decisions needed

Each of these is a product decision, "by decision, not by drift"
(docs/AGENT_INTELLIGENCE_SOLUTION.md section 7):

- **The legacy `/app` surface.** Retiring it removes most rows above, the remaining
  Gemini and DeepSeek call sites, and the old memory stack. Rights-related routes
  (`/api/user/data`, `/api/user/voices`) need a replacement or a final export before removal.
- **Billing.** Whether Stripe and Telegram payments continue. If Telegram payments stay,
  `/api/telegram/payments` must be secured first (Telegram secret header plus a caller check).
- **The standalone TIREH runtime** (`/api/tireh/telegram/[personaId]`, `scripts/tireh-local.ts`).
  Retiring it also allows deleting `GeminiLLM` and the `TIREH_LLM_PROVIDER` switch.
- **The legacy Telegram webhook** (`/api/telegram/webhook`). Retire or secure; it fails open
  without `TELEGRAM_WEBHOOK_SECRET` and logs update bodies.
