# Vox

Vox is a Telegram-based studio for AI agents, built by Joyixir for the HOOR community. Inside the **@VoxxBot** Mini App a person spawns an agent from a loose brief, gives it a look and a voice, tests it, and hires it as a real Telegram bot with one personality and one voice. Agents answer in text and voice, take live calls, work in groups, and remember only what the people in a conversation have allowed.

The product documentation lives in `docs/`. Start with [Vox Studio](docs/VOX_STUDIO.md) for what the product does and how to run it, [Production](docs/PRODUCTION.md) for how it is released, and the [implementation plan](docs/implementation/PLAN.md) for the current baseline, backlog and release receipts.

## What is in the repository

| Area | Path | Notes |
|---|---|---|
| Studio: spawn, hire, bots, groups, calls | `src/lib/studio` | Service, runtime, Telegram updates, per-agent bots, skills library and routing |
| Personas, prompts, memory visibility, gateway | `src/lib/tireh` | The turn pipeline: audience boundary, triage, prompt, LLM, TTS, memory formation |
| Adaptive privacy and personalization | `src/lib/adaptive` | Consent ledger, Work and Personal spaces, persistence formats, rights intake, observation, learning, experiments, Decisions |
| Relationships | `src/lib/relationships`, `src/lib/adaptive/relationships` | Follow-up loops; default off, enabled per environment |
| Connections | `src/lib/connections` | Read-only, per-agent access to app accounts through a broker; disabled until an operator qualifies an account ([docs](docs/connections/PLAN.md)) |
| Studio UI and API | `src/app/studio`, `src/app/api/studio` | Telegram Mini App screens and the signed API behind them |
| Operations | `scripts/` | `studio-build.mjs`, `studio-production.mjs`, Firebase, Connections, inventory and evaluation scripts |

Stack: Next.js 15, React 19, TypeScript 5, Vitest, Playwright, better-sqlite3 for the indexed storage format. Providers: Anthropic Claude for persona design and replies, OpenAI for speech-to-text, images and Decisions, ElevenLabs for voices. Firebase remains an optional hosting profile.

## Running locally

```bash
npm ci
cp .env.example .env.local   # then add the STUDIO_* and provider keys described in docs/VOX_STUDIO.md
npm run studio:start
```

Studio reads its configuration (`STUDIO_*`, `VOXX_BOT_TOKEN`, provider keys) in `src/lib/studio/runtime.ts`. With `STUDIO_ONLY=1`, which both production profiles set, the middleware serves only `/studio`, its API, the public privacy notice and static assets; every legacy route returns 404.

## Checks

```bash
npm run lint
npx tsc --noEmit
npx vitest run
npm run e2e            # Playwright journeys; see .github/workflows/ci.yml for the production journey gates
```

CI runs lint and types, the unit and integration suites, the release script tests, a production build, browser journeys and an advisory dependency audit. The production dependency audit is blocking in the deploy workflow.

## Releasing

The active production profile is a single polling process on a Mac Studio with file storage, installed through `scripts/studio-production.mjs`. The build writes `.next/studio-release.json` and the installer refuses an artifact that does not match the committed revision. Each release is recorded as a receipt under `docs/implementation/` and linked from the plan. See [docs/PRODUCTION.md](docs/PRODUCTION.md) and [docs/STUDIO_OPERATIONS.md](docs/STUDIO_OPERATIONS.md).

## Documentation map

- Product: [Vox Studio](docs/VOX_STUDIO.md), [voices](docs/STUDIO_VOICES.md), [proactive groups](docs/PROACTIVE_GROUPS.md), [Tireh personas](docs/TIREH_PERSONAS.md)
- Intelligence and memory: [agent intelligence solution](docs/AGENT_INTELLIGENCE_SOLUTION.md) (the delivery order being worked through), [agent skills studio](docs/AGENT_SKILLS_STUDIO.md), [per-message skill routing](docs/SKILL_ROUTING.md), [memory strategy](docs/AGENT_MEMORY_STRATEGY.md), [self-development research](docs/SELF_DEVELOPMENT_RESEARCH.md)
- Privacy, consent and the adaptive runtime: [implementation plan](docs/implementation/PLAN.md), [backlog](docs/implementation/BACKLOG.md), [privacy and consent](docs/implementation/PRIVACY_AND_CONSENT.md), [QA and release](docs/implementation/QA_AND_RELEASE.md)
- Relationships: [system plan](docs/RELATIONSHIP_SYSTEM_PLAN.md), [operations](docs/RELATIONSHIP_OPERATIONS.md), [reports](docs/reports/)
- Connections: [plan](docs/connections/PLAN.md), [implementation status](docs/connections/IMPLEMENTATION_STATUS.md), [user guide](docs/connections/USER_GUIDE.md), [operator onboarding](docs/connections/ACCOUNT_ONBOARDING.md)

## Legacy web app

Vox began in 2025 as a Firebase-hosted voice-contacts web app (Google sign-in, premade and custom AI contacts, voice cloning, a translator). Its routes (`/app`, `/login`, `/create`, `/translator`, `/pricing`, `/api/chat`, `/api/tts`, `/api/clone-voice`, `/api/v2/*`) and its Firebase and Stripe code are still in the tree and still tested, but they are hidden in production by `STUDIO_ONLY=1`. [PITCH_DECK.md](PITCH_DECK.md), [IMPLEMENTATION_SPEC.md](IMPLEMENTATION_SPEC.md) and [PRODUCTION_READINESS_SPEC.md](PRODUCTION_READINESS_SPEC.md) describe that era and are kept as historical documents.

## License

MIT, see [LICENSE](LICENSE).
