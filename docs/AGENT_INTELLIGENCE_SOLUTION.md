# Vox: intelligent, fast agents with layered shared memory

Research, project review and solution. Prepared 19–20 October 2026 against branch `develop` at commit `9fb73d3`. **Status, 20 October 2026:** step 0 of section 5 is deployed (revision `504203f`, [receipt](implementation/RELEASE_INTELLIGENCE_STEP0_2026_10_20.md)) except its measurement gate; step 1 has only the committed-document privacy read; steps 2 to 15 are not started. Section 3 findings that step 0 closed are marked in place.

Status: a product and architecture proposal. No production turn was measured; latency and cost figures are engineering estimates from documented prices, third-party benchmarks and a line-by-line reading of the code. Where a number is unverified it says so. Nothing here replaces counsel on GDPR, the AI Act, BIPA or CUBI.

How this was produced: eight web-research tracks with independent fact-checking of the claims the recommendations depend on (five claims were corrected and the corrected versions are used); four code reviews of the current tree; three independent architecture proposals from different angles (latency-first, privacy-first, intelligence-first); three judges (engineering, privacy, product); and a completeness critic. Section 5 says where the proposals disagreed and how this document resolves it.

This builds on, and does not restate, `docs/AGENT_MEMORY_STRATEGY.md`, `docs/implementation/PLAN.md`, `ARCHITECTURE.md`, `PRIVACY_AND_CONSENT.md` and `BACKLOG.md`. Where it changes them it says why.

---

## 1. The answer first

| What you asked for | Possible? | Verdict |
|---|---|---|
| Agents that are much more intelligent and fast | **Yes** | The models are not the limit. Today a text turn recomputes the privacy boundary six to ten times, each a serial chain of storage transactions; live calls recompute it once per streamed token chunk; the prompt is rebuilt from scratch and cannot be cached; triage waits serially; extraction runs inside the request. And in the production runtime, memory and history are switched off by a deliberate transition decision, so replies have no continuity at all. Fixing those gives roughly a 4x faster text turn and usable live calls on the same Claude models. |
| A layered, optimised memory | **Yes** | The six layers in `AGENT_MEMORY_STRATEGY.md` are right. What was missing is the concrete read and write path: a per-chat context pack, per-person and per-group cards in the cached prompt, embeddings with Firestore vector search (the installed SDK already supports it), Mem0-style ADD/UPDATE/NOOP writes, decay, and nightly consolidation. All of it runs on Firestore or the Mac file store you already have. |
| Shared memories with policy on what is stored, what is shared, with whom | **Yes, largely built** | TIREH's "every reader must be allowed" rule, audience snapshots, owner-only sharing, sensitive-never-shared and the PRIV-* requirements already answer most of it, in code. The gaps: group memory goes dark forever when a member joins, successor agents inherit everything, no subject-side rights, no never-store classifier, no audit log, no cascading forget, two policy engines that cannot be shown to agree. |
| Know people by their voice | **Yes as an opt-in attribution and anomaly signal; no as authentication** | Voiceprints are accurate on clean audio but degrade sharply on real channels, and ElevenLabs clones pass them almost every time while Vox itself makes ElevenLabs voices. Under GDPR and the AI Act it must be enrolled, consented verification of the account holder on their own voice notes, never silent identification. Live calls through ElevenLabs Agents give Vox no audio today, so voice notes are the only channel. |
| Know people by how they communicate, even from someone else's account | **Partly** | Writing style is weak evidence on short messages and across the written/spoken boundary (the best system scored 0.62 against a 0.60 baseline), drifts within a year, and a colleague who knows the person imitates them well. Build it as identity confidence: a signal that can only lower what the agent reveals and ask one neutral question. It can never say who the other person is, never grant access, never reach an admin. |
| Decide from the first sentence or an image where the conversation goes | **Yes for text now; calls and images need plumbing** | Decisions already runs per message in `triage.ts`. Run it in parallel instead of before everything, extend the question set in shadow, calibrate on Persian and English, keep Haiku forced-tool as the fallback. First-sentence steering on live calls needs partial transcripts ElevenLabs does not forward. Image steering needs an ingestion path that does not exist yet (the gateway never sees photos and the Decisions seam accepts text only). |
| Predict what people mean and personalise | **Yes, within limits** | Per-person profile cards, an open-threads working state and explicit preferences do most of it. A small reply-style bandit can learn the rest later, after the DPIA covers behavioural adaptation. No emotion inference from voice (banned at work since February 2025); inferred preferences expire unless confirmed. |

The one-sentence version: keep the privacy spine you built, compute it once per turn instead of ten times, move everything that can leave the hot path off it, retrieve by meaning instead of keywords, cache what never changes, let Decisions steer in parallel, and turn conversational continuity back on under consent.

---

## 2. What the research says (verified 19–20 October 2026)

### 2.1 OpenAI Decisions API

- **What it is.** `POST /v1/decisions`, model `gpt-6-luna` only, public beta since 6 October 2026 with GA "in the coming weeks". One input (text, or messages with text and inline base64 images; the reference also allows tool-call items) plus 1 to 200 typed questions: `predicate` returns a probability; `choice` (2 to 255 unique options) returns the chosen value, per-option probabilities and an undefined `confidence` value; `score` returns a probability-weighted index over ordered levels (no documented level limit; the "2 to 10" figure comes from third-party wrappers). Any answer can be a `refusal`. No audio, files, streaming or Batch. At most 128 images per request. ([guide](https://developers.openai.com/api/docs/guides/decisions), [OpenAPI spec](https://github.com/openai/openai-openapi/blob/main/openapi.yaml))
- **Speed.** OpenAI claims "about 10x faster than the Responses API" and showed 150 ms vs 1.6 s at DevDay; it publishes no percentiles. Independent runs: 326 ms median over 1,071 rows ([decision-bench](https://github.com/atlanai/decision-bench/pull/15)), 268 ms median (DataCamp). Vox's own probe recorded 436 ms, with six synthetic cases between 232 ms and 847 ms (`docs/PROACTIVE_GROUPS.md`). Plan on 150 to 450 ms for a 1k-token input.
- **Price.** $0.10 per 1M input tokens, nothing for output or cache. A 1k-token turn with eight questions costs about $0.0001; 100k turns a month about $10. EU residency adds 10%. Zero data retention is available on approval. ([pricing](https://developers.openai.com/api/docs/pricing), [data controls](https://developers.openai.com/api/docs/guides/your-data))
- **Calibration.** The word "calibrated" does not appear in the docs. A community test showed a predicate tracking a 70%-biased coin closely while the same question as a choice returned 98%. Accuracy on a general decision benchmark: 90.5%. Vox's only calibration experiment so far, 32 fictional relationship cases, generalised poorly on holdout (`docs/reports/relationship-decision-calibration.md`). Use predicates wherever a number drives a threshold; use choices only for argmax routing; calibrate on labelled Persian and English turns before any threshold changes user-visible behaviour.
- **Voice.** The API takes no audio. The [voice guide](https://developers.openai.com/api/docs/guides/decisions-voice) shows GPT-Live firing Decisions on `session.input_transcript.delta` while the user is still speaking, with results matched by `source_event_id` and possibly out of order. That is the reference pattern for "decide from the first sentence".
- **Alternatives for the same jobs.** Claude Haiku 5.5 with forced tool use skips thinking, costs the same per input token, returns no probabilities (estimated 0.4 to 0.8 s). Gemini 2.5 Flash-Lite is similar in price at 0.3 to 0.5 s. Groq-hosted small models are cheaper and fast but weaker in Persian. A fine-tuned encoder would answer in 5 to 30 ms once Vox has thousands of labelled turns. Decision models are becoming a category (TypeSafe Jev, Perplexity Decider, Microsoft-Decision-1), so the integration stays behind the vendor-neutral seam Vox already has.
- **SDK.** The installed `openai` package is 6.9.1; the official helper needs 7.30.0 or later. Vox's seam calls `client.post('/decisions')`, which works, but it also caps requests at 7 questions, 16 choices, 8 levels and string input (`src/lib/adaptive/decisions/index.ts`). Any larger question set or image input needs that cap raised and tested.

### 2.2 Context engineering

- **The window is an attention budget.** In Chroma's Context Rot study all 17 models run on LongMemEval answered better from a focused ~300-token input than from the full ~113k-token history ([Chroma](https://www.trychroma.com/research/context-rot)). NoLiMa found that of 13 models claiming 128k context, 11 fall below half their short-context score by 32k tokens when the answer shares no keyword with the question ([NoLiMa, ICML 2025](https://arxiv.org/abs/2502.05167)). Irrelevant memories are distractors, not free context.
- **The winning layout.** A long, byte-stable prefix (identity, rules, examples, slowly changing org or profile) that is cached; then a small just-in-time slice (retrieved memories, date, hints); then recent turns, with older turns compacted. Manus calls the KV-cache hit rate the most important production metric and warns that a timestamp at the top of the prompt defeats it ([Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus), [Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).
- **Claude caching mechanics (verified).** The prefix is hashed in the order tools, system, messages; up to 4 breakpoints; reads at 0.1x ($0.01 per MTok on Haiku 5.5), 1-hour writes at 2x; minimum cacheable prefix 512 tokens on Haiku 5.5. Changing thinking parameters, effort or `output_config.format` invalidates the messages cache. A `{role:"system"}` message appended inside `messages` adds instructions without invalidating the prefix, but Anthropic discourages that slot for retrieved documents and Haiku 5.5 may treat some such messages as untrusted. ([prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [mid-conversation system messages](https://platform.claude.com/docs/en/docs/build-with-claude/mid-conversation-system-messages))
- **Vox's prompt today** is roughly 1,000 to 2,600 tokens, rebuilt every turn, with "Today is <date>" in the first block, memories interleaved, passed as a plain string with no `cache_control` and no effort setting. Nothing is cacheable. Identity plus rules alone (~400 tokens) is below the 512-token minimum, so the org block must join the cached prefix.

### 2.3 Memory systems for agents

- **Convergent shape.** Mem0, Zep/Graphiti, Letta, Hindsight and LangMem all use a small always-in-context layer (profile or blocks), an extracted-fact layer with embeddings and temporal validity, raw episodes as the non-lossy source, and background consolidation. They buy latency and tokens, not accuracy: in Mem0's own LoCoMo table full context scores 72.9% vs Mem0 66.9%, while p95 latency drops from 17.1 s to 1.44 s and tokens per query from 26,031 to 1,764 ([Mem0](https://arxiv.org/html/2504.19413); Zep disputes its own 66.0% figure and reports 75.1%).
- **Write path worth copying.** Mem0: extract candidates from a summary plus the last 10 messages, compare each with the 10 nearest existing memories, choose ADD, UPDATE, DELETE or NOOP. Graphiti: bi-temporal validity (`validFrom`, `invalidatedAt`) and invalidate-never-delete. Generative Agents: retrieval score = relevance + recency decay since last retrieval + importance 1 to 10, with consolidation triggered when accumulated importance crosses a threshold ([Graphiti](https://arxiv.org/html/2501.13956), [Generative Agents](https://ar5iv.labs.arxiv.org/html/2304.03442)).
- **Permission-aware retrieval is the industry pattern.** Glean enforces ACLs at query time and tells you to test negative identities because "the search result is the ground truth, not the upload response"; Microsoft Copilot "only surfaces organizational data to which individual users have at least view permissions" ([Glean](https://developers.glean.com/libraries/indexing-sdk/permissions), [Microsoft](https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-privacy)). Nobody models "about X but said by Y" explicitly; Vox's `aboutPersonIds` plus `source.personId` is ahead of the market.
- **Firestore vector search (verified).** `findNearest` supports pre-filtering with `where` given a composite vector index (the general `in` limit of 30 values applies), vectors up to 2048 dimensions, at most 1000 results, flat exact KNN only, billed at one read per 100 index entries scanned plus one read per returned document ([Firestore](https://firebase.google.com/docs/firestore/vector-search)). The installed `@google-cloud/firestore` 7.11.6 exposes it. Below roughly 300 visible memories per persona no index is needed; Firestore KNN serves to roughly 20 to 50k per persona; pgvector or Upstash only beyond that. Note that the active production profile is file storage on the Mac (section 3), where there is no vector index at all and an in-process scorer is the first step.
- **Embeddings.** `text-embedding-3-small` at $0.02 per 1M tokens: under $0.001 per 1,000 memories. Persian quality is unmeasured and must be checked on Vox data.

### 2.4 Speaker identification by voice

- **Accuracy on clean audio is real.** ECAPA-TDNN class models reach about 0.9% EER on full utterances, 1.3% at 3 s and 2.0% at 2 s on VoxCeleb; under 2 s the field average is unusable (30% EER at 0.5 s). Opus at Telegram's bitrate costs almost nothing ([ERes2NetV2](https://arxiv.org/html/2406.02167), [codec study](https://arxiv.org/html/2509.02771)).
- **But it does not transfer to real channels.** The same model class scores about 5% EER on crowdsourced multi-device audio, 16 to 25% under telephony codecs with noise and reverberation, and about 35% far-field; emotion roughly triples EER and a language switch moves 0.75% to 5.18% (SVeritas, VoxAging, TidyVoice). Text-style verification on short messages sits at roughly 5 to 25% EER. Voice is clearly stronger than style on clean benchmarks; the gap narrows on messenger audio, so the voiceprint is one weighted signal with channel-aware thresholds, not the dominant one.
- **Voice is defeated as an authenticator.** ElevenLabs clones are accepted by ECAPA-TDNN and pyannote 100% of the time and by TitaNet 99.8% at the EER threshold; the standard AASIST countermeasure misses about 96% of them; ASVspoof 5's baseline sits at 29% EER ([clone study](https://github.com/christina75101/voice-clonning-attack), [ASVspoof 5](https://arxiv.org/html/2408.08739v1)). Vox generates ElevenLabs voices itself. A voice match can therefore never unlock memories, approve a share offer or override the account.
- **Enrollment norms.** About 30 s of net speech across several clips, 5 to 10 s to verify, templates bound to a model version. Vendors: pyannoteAI (voiceprint and identify APIs, EU residency, template returned to you and purged after 24 h), Speechmatics, self-hosted WeSpeaker or ReDimNet ONNX (12M parameters), Picovoice Eagle on-device. Azure Speaker Recognition was retired on 30 September 2025; Amazon Connect Voice ID reaches end of life on 20 May 2026.
- **Law.** Voice data is biometric personal data; embeddings used to identify a person are special-category data under GDPR Article 9, and employee consent is presumptively not freely given. The Commission's AI Act Service Desk treats voiceprint matching against known speakers without their involvement as remote biometric identification (Annex III high-risk, obligations from 2 December 2027), and active, consented verification as outside it ([Service Desk](https://ai-act-service-desk.ec.europa.eu/en/biometrics)). Emotion inference from workers' voice is banned since 2 February 2025, with "workplace" read broadly and stress or burnout monitoring explicitly not permitted. Illinois BIPA and Texas CUBI name voiceprints and require written release and destruction schedules. Telegram's developer terms require a privacy policy and explicit, revocable consent for voluntarily submitted data.

### 2.5 Recognising people by how they communicate

- **Weak evidence where Vox needs it.** On PAN 2023's cross-discourse task (written and spoken text from the same people, texts of 2,300 to 10,800 characters) the best verifier scored 0.62 against a 0.60 character n-gram baseline; written-vs-spoken pairings were the hardest ([PAN 2023](https://ceur-ws.org/Vol-3497/paper-199.pdf)). AuthBench (2026) reports equal error rates of 0.104 on documents of ten tokens or fewer and 0.078 at 11 to 100 tokens, and names short documents as the bottleneck ([AuthBench](https://arxiv.org/abs/2609.06771)). An earlier claim of "0.78 F1 at 25 words" was checked and found to be a misreading; it is not used here.
- **Drift and imitation.** Style drifts within the first year; emoji use follows the conversation partner; a colleague who knows the person imitates them up to 67% of the time. LLM "same author?" judgements are strong on tiny closed sets but collapse as candidates grow and have no calibration evidence.
- **What a Telegram bot can see.** User id, `language_code`, timestamps, edits, media habits, text and voice audio. No typing cadence, device or online status. In groups with privacy mode on, only commands and replies. No Persian or Finglish chat stylometry dataset exists.
- **Law.** A style profile is GDPR profiling; a signal that only withholds memories and asks a question is not a solely automated decision under Article 22, but notice, DPIA and workplace dignity duties apply. Text stylometry is probably outside the AI Act's biometric definitions, but no authority has ruled.
- **Verdict.** Build "identity confidence", not "recognition": a per-session state (consistent, uncertain, inconsistent) that can only lower what the agent reveals and ask one neutral question, never grant access, never report to admins.

### 2.6 Fast prediction and conversation steering

- **Voice latency budget.** ElevenLabs' guide targets p50 time-to-first-audio under 800 ms and p95 under 1.5 s, with an illustrative split of endpointing 120/280 ms, STT 60/150, network 60/160, LLM TTFT 250/600, TTS 110/220 and player buffer 80/150 ([ElevenLabs](https://elevenlabs.io/blog/voice-agent-latency-optimization)).
- **Thinking time dominates TTFT.** Claude Haiku 5.5 defaults to effort medium with adaptive thinking on. Artificial Analysis measures 8.2 s TTFT at low effort including thinking, while production telemetry shows 1.44 s p95; Anthropic publishes nothing. Explicit `effort: "low"`, short `max_tokens`, forced tool calls (which skip thinking) and cached prefixes matter more than switching vendors ([effort docs](https://platform.claude.com/docs/en/build-with-claude/effort)).
- **Speculative generation is now default.** LiveKit enables preemptive generation on stable partial transcripts; the draft is discarded if the context changes; cancelled drafts never enter history. Learned turn-taking models (LiveKit, Pipecat Smart Turn v3, ElevenLabs `turn_eagerness`) cut the post-speech wait to about 300 ms; none lists Persian.
- **Intent priors beat raw history.** A compact intent-trajectory prior in the system prompt cut turns-to-goal by about 31% on MultiWOZ ([Luo 2026](https://arxiv.org/abs/2604.27379)).
- **Personalisation.** Azure Personalizer is retired as of 1 October 2026. A hand-rolled Thompson-sampling bandit with a composite reward is enough; reply-rate alone produces engagement bait. Explicit preferences always beat inferred ones.
- **Telegram limits.** Typing status lasts 5 s and must be re-sent; voice notes cannot stream; about one message per second per private chat and 20 per minute per group; whether `editMessageText` counts toward limits is undocumented. **Next.js `after()`** is stable since 15.1 but the repo never calls it, there is no Vercel, and the active Mac polling profile never passes through a Next route, so background work needs a durable job store, not `after()`.

### 2.7 Privacy and governance

- **Prompts are not a privacy control.** In ConfAIde (ICLR 2024) GPT-4 and ChatGPT revealed private facts 39% and 57% of the time with a privacy instruction already in the prompt, and chain-of-thought made it worse ([ConfAIde](https://arxiv.org/abs/2310.17884)). TIREH's code-enforced audience rule is the right design and must stay in code.
- **AI Act.** Emotion inference from workers' biometric signals is banned since 2 February 2025; text-based intent classification is outside the ban but is GDPR profiling. Article 50 disclosure duties apply from 2 August 2026; Annex III high-risk duties moved to 2 December 2027 under the Digital Omnibus.
- **GDPR for employee memories.** Lawful basis is legitimate interest with a purpose-separated assessment and a DPIA, not consent. The Budapest Bank fine was for a voice AI whose notice did not name the purposes, not for using AI.
- **Erasure.** Rights attach to inputs, outputs and stores. Vox trains nothing, so erasure is a cascade: memory rows, history, embeddings, offers, caches and provider logs within one month. Embeddings are personal data and can be inverted.
- **Provider retention.** Anthropic retains nothing by default (30 days for Covered Models such as Fable); OpenAI keeps 30-day abuse logs unless ZDR is approved; ElevenLabs Zero Retention Mode is enterprise-only and Agents retain conversation data for two years by default. The Anthropic web-search tool sends member-derived queries to a third-party search provider and is not yet in the processor table.
- **Group listening.** Disabling Telegram privacy mode means every group message reaches extraction and history; members can see the setting; Telegram advises it only when necessary. A join notice and a mention-only option per group are the minimum.
- **Baseline controls users expect** (ChatGPT, Claude, Copilot, Glean, Notion): per-item view and delete, temporary or incognito mode, org-level kill switch, honest 30-day purge statement, no training on customer data, embeddings deleted within a stated window.

### 2.8 Anthropic platform (where the replies run)

- **Models and prices.** Haiku 5.5 $0.10/$0.50 per MTok up to 100k-token prompts, cache reads $0.01, released 7 October 2026; Sonnet 5.5 $2/$10; Opus 5.5 $4/$20; Fable 5.1 $10/$50. All 1M context. Batch API 50% off. No official TTFT figures ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)).
- **Haiku 5.5 is the only current model that accepts forced `tool_choice` and `thinking: {type: "disabled"}`** (at effort high or below), which makes it the right engine for a sub-second structured gate and the natural fallback for Decisions ([migration guide](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide)). Its `max_tokens` includes thinking, so a 700-token cap can truncate before any text at medium effort.
- **Structured outputs** are grammar-constrained; first use of a schema compiles a grammar (cached 24 h); no probabilities. **Compaction on demand** (beta) is a ready-made session summariser. The **memory tool** adds a round trip per operation and belongs in offline curation. The **Claude Agent SDK** spawns a 1 GiB CLI subprocess per session and does not fit a Next.js route.
- **Cache reads do not count toward rate limits**, so an 80% hit rate makes a 2M-token-per-minute limit behave like 10M.

---

## 3. Where Vox stands today (branch `develop`, commit 9fb73d3)

Forty commits landed on 19 October 2026 (memory strategy, privacy plan, adaptive foundation, Decisions triage, live calls, history privacy). This review is of that tree. Two profiles exist: the **active production profile is the Mac Studio polling runtime with file storage** (`docs/PRODUCTION.md`); Firebase with Firestore and webhooks is the alternative. Several latency numbers below were estimated for the Firestore profile; the file profile pays the same number of recomputations at a lower unit cost (about 60 to 150 ms each instead of 400 to 800 ms). Nobody has timed a real turn on either profile. Measuring is step 0.

### 3.1 What is strong

- **The privacy spine is in code.** `src/lib/tireh/memory/visibility.ts` enforces "every reader of the conversation must be allowed", snapshots the authorised audience on each record (`authorizedPersonIds`), fails closed for legacy records without a snapshot, keeps personal and confidential content in one-to-one chats, and denies guest groups. Chat history carries a privacy stamp and replays only turns written under the same policy key and memory revision. Source-event tombstones block relearning after deletion; share approvals are version-fenced and owner-only. This is the Glean and Copilot pattern, and it survives the ConfAIde finding that prompts leak.
- **Decisions is already in the hot path, safely.** `src/lib/tireh/triage.ts` asks one request per message (effort, needs web, memorable, wants voice, addressed, proactive) with thresholds that lean toward the full path; `src/lib/adaptive/decisions/index.ts` wraps the provider with zod validation, a 500 ms deadline, a circuit breaker and per-turn budgets. `ARCHITECTURE.md` already names a question catalogue (DEC-01 to DEC-07).
- **The product decisions are made.** Work and Personal spaces; private, group and exact-recipient containers; explicit beats inferred; voice recognition optional and never an unlock; a consent ledger with a state machine and affirmative evidence; purposes including `optional.biometric_recognition`; retention tiers; EN/FA consent copy. The adaptive module's `authorizeAccess` is a complete, pure policy function with the right shape.
- **Live calls exist.** ElevenLabs Agents handle STT, turn-taking and streaming TTS and call Vox's authenticated custom-LLM endpoint with a signed call token; `gateway.liveTurn()` streams Claude.
- **Test discipline.** About 1,400 tests in 131 files, including audience-boundary, history-privacy and memory-privacy suites with fake Telegram, LLM and Decisions providers.

### 3.2 The production state nobody should be surprised by

In every runtime that `src/lib/studio/runtime.ts` builds, the adaptive service is wired and its `runtimePrivacy.read` returns `memoryEnabled: false, historyEnabled: false` unconditionally ("legacy unscoped stores have no authoritative source lineage: never unlock them", `src/lib/adaptive/persistence/service.ts`). `gateway.boundary()` derives both flags from it. Consequently, in production: no chat history is replayed, no TIREH memories are retrieved, no extraction runs, and each live-call turn is answered without the previous turns of the same call. Replies are the persona prompt plus the current message plus any adaptive "saved context" strings. `docs/PRODUCTION.md` documents this as the deliberate default-disabled transition. (Fixed in step 0, `04ebc3b`: `makeStudio()` now wires the adaptive service by default, and the two group-guest answer tests that assumed the legacy path run on an explicit legacy harness.) Before that, the Studio test helper never wires the adaptive service, so most memory tests exercise a path production does not take.

This is not a bug to patch quietly. It is a product decision to reverse under consent, with the notice, retention copy and DPIA updated at the same time (section 5, step 4).

### 3.3 What limits speed and intelligence

| Bottleneck | Where | Effect |
|---|---|---|
| The privacy boundary is recomputed 6 to 10 times per text turn and once per streamed token chunk on live calls | `gateway.boundary()` via `unchanged()` before the prompt, before send, per chunk, per memory write; `Studio.adaptiveContext()` | Each recompute is a serial chain of adaptive storage transactions (every "read" is a read-modify-write of a document up to 700 KB with fsync; on Firestore three of them hit one global shared document). Estimated 3 to 4 s per text turn on Firestore and 15 to 30 s per two-sentence live reply; on the file profile a fraction of that but the same shape |
| Triage is awaited before composition starts | `gateway.handleMessage` ~line 344 | The 150 to 850 ms decision call adds serially; the `Promise.all` inside `composeReply` receives an already-settled promise |
| The prompt is rebuilt and uncacheable | `conversation/prompt.ts`, `llm.ts` | Date in the first block, speaker-specific sections before the org block, memories interleaved, system as a plain string, no `cache_control`, no effort; zero cache hits |
| Retrieval loads every active memory (when enabled) and ranks by keyword overlap | `memory/retrieval.ts`, `firestore-store.ts listActive` | O(N) reads per turn, twice (reply and extraction); English-only stopwords, no stemming; a memory phrased differently is never found |
| Extraction and relationship assessment run inside the request | `formMemories`, `observeRelationship` | A second Claude call plus boundary rechecks per write; with scoped relationships on, an assessor call of up to 12 s runs before the reply |
| The studio state document is read and parsed 20 to 45 times per turn | `firestore-store.ts read()`, `validateAudience`, `SharedAuthority` | Up to 1 MiB parsed repeatedly |
| The adaptive account document can lock | `persistence/service.ts requireCapacity` | After 1,500 events a person can no longer withdraw consent or delete a memory; the outbox has no consumer |
| Models | `runtime.ts` | Main replies default to `claude-sonnet-5-5` (`STUDIO_CHAT_MODEL`), 20x the price of Haiku 5.5; Haiku is used for "quick" and live turns; triage goes through a raw 2 s fetch instead of the 500 ms `DecisionService` |
| No per-person profile layer | — | Preferences cover length, language and formatting only; nothing records how a person likes to be talked to, open threads or goals |
| Images are not understood | `triage.ts`, `gateway.ts` | The gateway never handles `message.photo`; the Decisions seam accepts text only |
| Three of everything | `src/lib/adaptive`, `src/lib/relationships`, `src/lib/tireh`, legacy `/app` | Five Decisions clients with four timeouts; three live memory-text stores and six adjacent record shapes; four identity encodings parsed by regex; six authority-fingerprint formats; two policy engines (`visibility.ts` and `authorizeAccess`) with no differential test |

### 3.4 Privacy and security findings to fix first

- **Fixed in step 0 (`bf02807`).** Stranger voice notes bypassed the stranger gate. For a public agent, a non-member's text goes through `decideOnStranger`, but a voice note is routed straight to the gateway, which downloads it and posts it to OpenAI or ElevenLabs STT before any decision (`src/lib/studio/updates.ts:111`, `gateway.ts:306`). Guest-group voice notes are transcribed when the persona is addressed. This contradicts PRIV-020 and PRIV-023.
- **Fixed in step 0 (`e38647c`): the `/api/convai/llm` and `chat/completions` proxies are deleted and session issuance is bound to a signed-in user.** Legacy ElevenLabs custom-LLM routes were unauthenticated. `/api/convai/llm` and `/api/convai/chat/completions` forward any body to Gemini with no bearer check; only `STUDIO_ONLY=1` hides them. `/api/convai/session` issues signed URLs with no caller binding. The legacy `/app` surface also includes `/api/clone-voice` (ElevenLabs cloning from user uploads), a second Telegram webhook, `/api/user/data` and the old memory stack; none of it was in scope of the privacy plan.
- **Group memory goes dark on membership growth.** `isVisibleToAudience` requires every current member to be in the creation-time snapshot, so one new member makes every earlier group memory invisible to everyone, forever; there is no re-authorisation path (fail-closed, so not a leak, but it destroys the value of group memory).
- **Successor agents inherit everything.** `inheritMemories` copies all records of a fired agent, including private and sensitive ones, with no grant check and an empty tombstone set, contradicting the strategy.
- **Subjects have no rights.** Only the utterer can see, share or delete a claim; `aboutPersonIds` is never consulted for access or deletion.
- **Deletion is O(n) per memory and O(n²) for forget-all**, tombstones live in an unbounded array in one document, and "forgotten" is reported before the history purge completes.
- **Guest groups are inconsistent.** Retrieval denies all memories in `hasGuests` groups while the standalone runtime still extracts there; docs claim "only their own memories", which the code never allows.

**Step 0 decision on the legacy routes (20 October 2026).** `/api/convai/llm` and `/api/convai/chat/completions` are deleted: nothing in `src/app` or `src/features` calls them, and Studio live calls use `/api/studio/voice-llm` with `voiceLlmKey` and a signed call token. `/api/convai/session` stays, because the legacy `/app` call screens (`src/features/call/hooks/useCall.ts`) still use it. It now goes through `withAuth` (Firebase ID token) with a per-account limit of six sessions a minute, and it no longer logs the contact name or the signed URL. The signed URL remains a bearer credential that ElevenLabs cannot bind to a caller; retiring the legacy surface is step 15. Operational check: if the legacy `ELEVENLABS_AGENT_ID` agent was configured with a custom LLM pointing at the deleted routes, its calls now fail, and the agent should use its built-in LLM or be retired.

Inventory of the other routes outside `/api/studio` (all return 404 under `STUDIO_ONLY=1`, the production setting). Firebase ID token: `chat`, `chat/stream`, `clone-voice`, `features`, `memory/extract`, `stripe/create-checkout`, `stripe/create-portal`, `stt`, `translate`, `translator/messages`, `tts`, `tts/stream`, `user/data`, `user/subscription`, `user/voices` and the five `v2/*` routes. Signature or secret: `stripe/webhook` (Stripe signature), `telegram/webhook` (Telegram verification), `tireh/telegram/[personaId]` (webhook secret header), `auth/telegram` (Telegram login HMAC), `connections/broker` (HMAC in the Node handler, admitted by middleware only with explicit configuration). Unauthenticated by design: `health`, and `voices` (rate-limited ElevenLabs voice list). **Unauthenticated and unsafe:** `PUT /api/telegram/payments` accepts any body as a Telegram payment update and writes an active paid subscription for the `userId` in the payload, and `POST` creates invoice links for any caller-supplied user. Both need the Telegram secret header and a Firebase caller check before the legacy surface is ever exposed; this is left as a separate fix.

### 3.5 What the plan promises that the code does not yet express

Work and Personal as separate stores (today a prompt flag; Personal has no memory at all), exact-recipient containers with a history policy, projections of private facts, per-agent grants on TIREH records, consent purposes on memories, retention tiers, deletion job states, an audit log. Conversely the code enforces rules the docs never mention (source-event tombstones, `shareVersion` bumps, privacy stamps on history, audience epochs, group receipt windows, the extractor's audience-filtered known list); a redesign must keep them.

---

## 4. The solution

### 4.1 Principles

1. **One snapshot per turn, scalar rechecks everywhere else.** Every input the boundary hash covers already has a monotonic revision written by its owner (memory safety revision, privacy epoch, adaptive document revision, shared revision, studio state, audience epoch). Load once, compare counters at the three load-bearing points (before the model call, before each send, inside each memory write), with identical fail-closed semantics.
2. **Policy before any model, in code.** `visibility.ts` stays the hot-path gate. `authorizeAccess` becomes the authoritative evaluator incrementally, behind a differential test that proves the two agree on every fixture, and only after it gains an account-level identity path (today it denies anyone without a Mini App binding fresher than 12 hours).
3. **Nothing a model outputs can widen an audience.** A probability may narrow scope, mark something confidential, skip extraction or veto an offer. It can never add a recipient, promote a scope, confirm a claim or raise an identity level.
4. **Everything that is not needed for the first sentence leaves the request.** Extraction, consolidation, embeddings, cards, style features, relationship assessment, share offers and audit rows run in a durable, per-chat-ordered job that rechecks the same revisions and tombstones before it writes. On the Mac profile the worker runs in-process beside the pollers; on Firebase a scheduled drain route, the pattern `scoped-relationship-drain.ts` already uses. `after()` is at most an opportunistic kick, never the mechanism.
5. **Measure before believing.** Every step ships behind a flag with content-free per-stage timers and is kept only if its measured delta is positive.

### 4.2 One turn, end to end

Target pipeline for a Telegram text message. Voice notes add transcription at the front; live calls replace the front and back with ElevenLabs Agents and keep the middle.

```
ingress ─ dedupe ∥ privacy epoch ∥ loadTurnSnapshot (ONE parallel read set → revision vector r)
   │       sendChatAction typing: fire-and-forget, repeated every 4 s until the first send
   │
   ├─ PARALLEL
   │    ├─ Decisions pre-pass via DecisionService   (await budget 450 ms; provider deadline 1,500 ms;
   │    │                                             a late answer still feeds the background job)
   │    ├─ read context pack  tireh_context_packs/{persona__chatKey}   (trusted only if built from r)
   │    ├─ candidates: in-process scorer over the cached active set (file profile / <300 memories)
   │    │              or findNearest pre-filtered by persona + allowed scope keys (Firestore, larger)
   │    └─ historyAt(10–12 turns) filtered by policy key + memory revision (as today)
   │
   ├─ prompt: [A persona+rules, 1 h cache] [B org snapshot by state revision, 1 h] [C chat frame + cards, 5 min]
   │          [history, auto breakpoint] [newest user turn + "## For this turn": date, 5–8 memories, conflicts, hints]
   ├─ compare r (≤40 ms) → stream Claude (effort low, max_tokens by route)
   ├─ first sentence as its own message (private chats), one editMessageText at the end; groups send once
   ├─ compare r before each send; retain both turns with stamps; update working state
   └─ enqueue turn.completed {ids, policy key, revision vector, triage answers, no text}  → worker
```

What changes versus today, in order of effect:

1. **Boundary once.** `Studio.adaptiveContext()` becomes `loadTurnSnapshot()`: one parallel read-only load (new `AdaptiveRepository.load()` that parses once and never writes; the shared document skipped for private chats without shared containers; the studio state read once and threaded through `validateAudience` and `SharedAuthority`). `unchanged()` becomes a comparison of the revision vector. Live calls compare every 500 ms or on a change notification, coalesce deltas to about 100 ms, and send SSE headers before the first token. Expected: text turn roughly 7 s to under 4 s on the Firestore profile; live replies stream at model speed.
2. **Triage overlaps retrieval.** Start it first, pass the promise into `composeReply`, await at most 450 ms on the private path (groups wait longer because no reply is pending).
3. **Extraction leaves the request** via the job contract in 4.5.
4. **The prompt becomes cacheable** (4.7).
5. **Retrieval becomes semantic and bounded** (4.4).
6. **Continuity returns under consent** (4.6, step 4).

### 4.3 Memory layers, concretely

Layer names follow `AGENT_MEMORY_STRATEGY.md`; the stores and paths are new.

| Layer | Store | Contents | Written | Read | Retention | Who may see it |
|---|---|---|---|---|---|---|
| L0 live signals | Process memory only (turn snapshot; live-call session object) | Pre-pass answers, language detection, identity hint for this turn, speculative draft state, revision vector | Every turn | Same turn | Dropped at end of turn; never persisted or logged with content | Nobody; outputs only narrow |
| L1 working conversation | `tireh_chats` (stamped rows, add `expiresAt` with a TTL policy) + working-state doc `vox_chat_state/{persona__chatKey}` {goal, open loops, thread status, ≤3 predicted next intents with prefetched memory ids, compact summary ≤500 tokens} | Last 10–12 turns verbatim plus a compaction summary of older turns | `retain()` synchronously after one revision compare; working state in the same post-reply write; summary by the worker when the window exceeds ~4k tokens | `historyAt()` replays only rows stamped with the current policy key and memory revision | User-visible choice, **30-day rolling default** (PRIV-032), temporary mode writes nothing; guest or unknown audiences: none | Audience stamped at write; a row replays only when every current reader was in it |
| L2 profile cards | `tireh_profiles/{persona__person__space}` (≤1,500 chars) | Explicit preferences first and marked explicit; stated preferences and open situations from the relationship assessor; observed adaptation facts (language mix, length, modality, time-of-day) marked observed with 7-day expiry; goals and open threads from L3; never emotion, health, personality, politics or performance | Only the consolidation job (single writer); observed facts require `optional.personalization` | Rendered as Block C, only in a 1:1 with that person in that space; omitted whenever the audience is not exactly that person | Explicit until changed; observed 7 days; stated 180-day reconfirmation | Private to the subject and the agents they granted; never groups, admins, successors or guests |
| L2 group cards | `tireh_group_cards/{persona__group}` (≤1,200 chars) | Decisions, open questions, owners, next steps built only from group-scoped records; stamped with the audience epoch | Consolidation job | Block C in that group only | Rebuilt on audience epoch change | Group members only; never guests, never private chats |
| L3 semantic memory | `tireh_memories` (existing record) + `space`, `status` asserted/inferred/confirmed/disputed, `validFrom`, `invalidatedAt`, `invalidatedBy`, `importance` 1–10, `lastRetrievedAt`, `retrievalCount`, `expiresAt`, `reviewAfter`, `subjectConfirmed`, `contentHash`, `embedding` (normal sensitivity only) with model and version; composite vector index on (persona, scopeKey, active) when on Firestore | Atomic attributed claims with provenance and supersession | Worker only (4.5) | Retrieval (4.4) | Until superseded, revoked or expired; dated facts get `validUntil`; archived after 180 days unused with importance under 4 unless decision or relationship | Unchanged: the every-reader rule with the audience snapshot and current membership |
| L4 curated knowledge | Same collection with `status: confirmed` and `curated: true`, or a projection record linked to its private parent | Owner-confirmed group and project decisions, procedures, approved minimal projections of private facts | Owner approval through the share offer, or a group member confirming a decision; never a model alone | Retrieved like L3, boosted | Versioned; never auto-expired | Scope of the container; new members per `historyPolicy` |
| L5 evidence | `tireh_chats` rows referenced by source event ids; media references | The messages a memory came from; images only when the route was "remember"; raw audio never | Existing path | Memories screen provenance, disputes, deletion cascades; never prompts | Follows L1, or until the memory that references it is forgotten | Same stamp as the chat; subjects see a redacted view |
| Derived: context pack | `tireh_context_packs/{persona__chatKey}` | Rendered Block C, working notes, the visibility-filtered candidate id list, the vector it was built from | Worker after each turn and on policy changes, with the same visibility functions as the hot path | One read per turn; ignored (slow path) when its vector differs | 24 h TTL; purged by the same cascade as its sources | Derived data; inherits every source restriction |
| Separate: voiceprints | `tireh_voiceprints/{org__person__space}`, encrypted with its own key, never in the memory stores | float16 embeddings per channel plus centroid, model version, consent event id | Enrollment only (4.9) | Verification on 1:1 voice notes only | Until withdrawal, leaving the org, 12 months inactivity, or any statutory clock | Never shared, exported, transferred or used for cloning or emotion |

Promotion between layers never widens an audience.

### 4.4 Retrieval

1. Audience → allowed scope keys in code (private:self, people sets containing every reader, group:this group, project/company/org where every reader is a member). Cached per audience; invalidated by the audience epoch.
2. Under roughly 300 visible memories per persona, or on the file profile: score in process over the cached active set (lexical overlap with Persian-aware tokenisation plus cosine to a query embedding computed at write time), cached by (persona, memory safety revision). On Firestore above that: `findNearest` pre-filtered by persona, at most 30 scope keys and `active`, cosine, limit 40, fused with the lexical scorer by reciprocal rank.
3. Rescore: relevance + exp(−0.1 × days since last retrieval) + importance/10 + about-audience bonus + type boost (decision, procedure, relationship).
4. Final gate: `isMemoryAllowedInChat` on every candidate. The index and the pack are optimisations; the code rule is the authority.
5. Top 5 to 8, each at most 60 tokens, rendered with provenance inside a "## For this turn" block in the newest user turn (what the docs advise for retrieved data; the mid-conversation system message is the A/B arm, not the default). Superseded and near-duplicate records are dropped as distractors; `lastRetrievedAt` is bumped by the worker.

Embeddings: `text-embedding-3-small` to start; Persian recall measured on an internal set of about 100 questions (single-session, multi-session, update, temporal, abstention, cross-person leakage) before any ranking change ships. Personal and confidential records stay out of the server-side index and are scored in process from the owner's small set.

### 4.5 Writing memory and the job contract

Gate first: the existing `memorable` predicate plus an `explicit_correction` predicate decide whether extraction runs at all (skip below 0.2 unless corrected or an explicit "remember this"). Then, in the worker:

1. Input: the L1 summary plus the last 10 messages, re-read from stamped history (never carried in the job payload).
2. Never-store classifier in code, with a Decisions predicate as a second signal: health, religion or beliefs, political opinions, union membership, sex life or orientation, ethnicity, biometric descriptions, inferred emotions, credentials, third-party secrets. "Personal" candidates are stored only on an explicit "remember this", otherwise they stay in L1 and expire. Dropped candidates leave a tombstone hash so a replay cannot relearn them.
3. For each surviving candidate, fetch the 10 nearest existing memories visible in that chat and choose ADD, UPDATE or NOOP. UPDATE creates a new record and sets `invalidatedAt` and `invalidatedBy` on the old one; nothing is hard-deleted by a contradiction. Importance priors by kind (decision or commitment 7, preference 6, fact 5).
4. "About X, said by Y": stored in Y's scope as an attributed claim, `status: asserted`, never written into X's card; X may view, dispute and request deletion.
5. Scope and share offers: unchanged `decideScope` and owner-approved offers; a Decisions predicate `reveals_private_reason` can block a draft projection but never approve one.
6. Write through `memories.add({expectedRevision})`, which already fences revision and tombstones.

Nightly consolidation on the Batch API (50% off): merge near-duplicates (cosine above 0.92 within a scope), rewrite L2 cards from current valid facts, expire dated facts, archive stale low-importance records, list unresolved same-topic conflicts in the Memories screen. An extra run triggers when the importance sum of new memories since the last run crosses a threshold.

**Job contract** (one shape for the Mac worker and the Firebase drain route): `id`, `kind` (extract, embed, consolidate, purge, reward, voice_verify), `orderingKey = chatKey`, `dueAt`, `lease {owner, until}`, `attempts`, `idempotencyKey = eventId`, `boundary {policyKey, memoryRevision, revisionVector, consentEpochs}`, payload without message text. The job row is written synchronously before the response returns. A handler whose source rows are gone (temporary mode) no-ops. A stale vector or a matching tombstone aborts the job.

### 4.6 The sharing policy as data

Everything below is enforced in code before any content reaches a model. "Exists" means it is already in `visibility.ts`, `sharing.ts`, `extraction.ts` or the adaptive policy.

**What is stored**

| Content | Stored? | Where | Gate |
|---|---|---|---|
| Ordinary turns and voice-note transcripts | Yes, 30 days default | L1 | `core.conversation`, disclosed; temporary mode stores nothing |
| Durable work facts, decisions, deadlines, preferences, relationships between people | Yes | L3, scoped by `decideScope` (exists) | `optional.auto_memory` for that person and space, or an explicit "remember this" |
| Personal-life facts (health, family, feelings) | Only on explicit "remember this" | L3 private, sensitivity personal (exists); otherwise L1 only | Separate retention prompt, never a share option |
| Confidential remarks | Yes, private to the speaker | exists | — |
| Special categories (4.5) and inferred emotions | **Never** | Never-store classifier | — |
| Greetings, small talk, speculative intentions, transient image descriptions, momentary mood | No | L1 only | — |
| Raw audio, partial transcripts, decision answers with content | No | L0, dropped; a content-free decision log (question version, probabilities, elapsed, route) kept 90 days for calibration | — |
| Voiceprints | Only with separate explicit consent | Isolated store (new) | `optional.biometric_recognition` + jurisdiction approval |
| Style features | Content-free counts only, 7-day expiry, never raw text, never an identity model | L2 observed fields (new) | `optional.personalization` |

**Who may see what**

| Situation | Rule |
|---|---|
| Any memory in any chat | Every person who can read the chat must be in the record's audience snapshot and currently allowed by its scope (exists) |
| Private chat | Audience is that one person (exists) |
| Registered group | Audience is every listed member, speaking or silent; unknown members or guests mean no memories, no history replay, no directory (exists; extend `prompt.ts` to use `group.hasGuests` like `retrieval.ts`) |
| Personal or confidential | One-to-one with the owner only; never shareable (exists) |
| Work fact told privately | Private until the owner approves a share offer with a previewed recipient list (exists); recipients see provenance; on a later correction recipients see "updated" instead of losing it silently (new) |
| Fact stated in a group | That group's memory; never promoted to project or org automatically (exists) |
| Group membership grows | Container `historyPolicy`, default `since_membership`; an admin action re-snapshots existing records for a named new member with a preview of what becomes visible, audited (new) |
| Statement about X by Y | Y's scope, attributed; X may view, dispute and delete (new) |
| Work and Personal | Never cross; an explicit export of the exact fact is a separate action (planned) |
| Successor agent | Only group, people and project records of normal sensitivity whose grant allows transfer; private records need per-record owner approval; tombstones travel with the copies; voiceprints and style profiles never transfer (new) |
| Incognito turn or `/temporary` | Reads nothing from L2 to L4 and writes nothing (new) |
| Shared context from others | Reading what others deliberately shared with you needs membership and a read grant, not every participant's `optional.personalization` consent (change to `shared/service.ts`) |

**Who decides.** The speaker decides sharing of what they said; the subject can delete claims about them; a group admin sets the group's history policy, listening mode and invited agents; each person grants agents per space; an org owner can disable memory for the org but gains no read access; the consent ledger gates every optional purpose; nothing a model outputs can widen an audience.

**Identity levels.** `verified` (Mini App confirmation within 12 hours), `account` (transport-authenticated Telegram id, no contrary hint) and `unverified` (a contrary hint). The judges rejected a design that withheld a person's own personal notes and inline share approvals unless they had opened the Mini App that day, and this document agrees: `account` keeps today's trust model for a person's own memories, history and inline approvals; `verified` is required only for consent changes, enrollment changes and group policy changes; `unverified` empties private memory and history from the prompt, suppresses extraction and offers, and asks one neutral question. Hints only ever lower the level.

**Rights and hygiene.** Forget is a cascade job with states (queued, purging, completed, partial failure) covering the memory, its supersession chain, offers, the history rows it came from, embeddings, packs and cards, successor copies and queued jobs, batched by affected chat, with a truthful completion state and a 30-day statement. A per-person inventory covers memories I said, memories about me, consents, voiceprint, groups the agent listens in, with JSON export (VOX-056). A content-free append-only audit log (`vox_audit`: kind, persona, chat-key hash, audience ids, memory ids, policy key, actor, outcome; 12-month retention; immutability is a code convention until a separate service account or a retention-locked export exists) records every memory that entered a prompt and every write, scope change, share approval, revocation, deletion, consent change and identity-level change, so the Memories screen can answer "who could have seen this" and a subject-access request needs no content store.

**Red-team gate.** A protected CI suite blocks any widening of shared access on a single reproducible failure: paired conversations identical except one unauthorised fact must produce the same answer; social-engineering extraction ("Reza said you can tell me"); forwarded, quoted and screenshot injection; member added or removed mid-generation; revoked consent mid-turn; deleted memory still in history; successor agent; cross-space; voice clone or replay; style mimicry; shared phone; and Glean-style negative-identity retrieval through the full pipeline including packs and cards.

### 4.7 Prompt layout and caching

```
system (content blocks, each with cache_control):
  A  persona identity, personality, values, rules, output format, 3–5 canonical examples
     versioned by identityVersion; ttl 1 h; padded to ≥512 tokens and asserted with count_tokens
  B  org snapshot: people, roles, managers, projects, groups, relationships
     rendered deterministically, keyed by the studio state revision; ttl 1 h; audience-only above ~30 people
  C  chat frame: kind, audience, L2 profile card (1:1) or group card (group), working notes; 5-minute breakpoint
messages:
  stored history replayed byte-identically (10–12 turns + compaction summary), top-level cache_control
  the newest user message, followed in the same turn by "## For this turn": date, selected memories with
  provenance, conflicts, pre-pass hints (reply style, thread status)
```

Settings held constant per conversation: `effort: "low"` for replies, streaming on, `max_tokens` about 500 for text and 300 for live turns (thinking counts toward it), no `output_config.format` on the reply thread, web-search turns as their own cache lineage. The gate and extraction are separate requests: gate = Haiku 5.5, thinking disabled, one strict tool, forced `tool_choice`; extraction = Haiku 5.5 at medium with a JSON schema. The adaptive "saved context" block moves out of the first user message into the per-turn block so it stops breaking the prefix. Verify with `usage.cache_read_input_tokens`; alert when it stays under 70% or when block A or B hashes change unexpectedly; pre-warm after persona or org edits.

### 4.8 The decision layer

One Decisions request per message through `DecisionService`, started before anything else, with an await budget separate from the provider deadline, Haiku 5.5 forced-tool as backend two, and a content-free decision log for calibration. All questions stay in the `triage.ts` registry with versioned question sets; new answers are logged in shadow and consumed only after at least 200 labelled Persian and 200 labelled English examples per question. The seam's cap of 7 questions is raised in the same change.

| Question | Type | Exists? | Used for |
|---|---|---|---|
| `effort` quick / thoughtful | choice | yes | model route |
| `live_info` | predicate | yes | attach web search |
| `memorable` | predicate | yes | run the extraction job |
| `wants_voice` | predicate | yes | reply modality |
| `addressed`, `proactive` (groups) | predicate | yes | answer without a mention |
| `route` answer / smalltalk / clarify / retrieve_deep / task / correction | choice | new, shadow first | prompt variant, `max_tokens`, deeper retrieval, structured correction path (DEC-01, DEC-02) |
| `context_need` none / person_profile / open_threads / group_decisions / project_history | choice | new, shadow first | skip or expand retrieval; which card to expand; what to prefetch read-only |
| `thread_status` continues / resolves / new / unclear | choice | new, shadow first | working-state update and a one-line hint |
| `explicit_style_request` brief / detailed / step_by_step / listening / unspecified | choice | new | honoured for this turn above any stored preference |
| `personal_life`, `confidential` | predicate | new | narrow scope and sensitivity only; group candidates dropped |
| `explicit_correction` | predicate | exists in the experience registry | extraction runs even when `memorable` is low; UPDATE path |
| `image_kind`, `image_task`, `contains_people`, `contains_sensitive_document` | choice + predicate | new, needs image ingestion | route to Claude vision at the matching resolution; never store when sensitive; never derive identity from people |

Rules: predicates wherever a threshold applies, choices only for argmax; no question may ask about a person's emotional, attitudinal, health or performance state, enforced by a CI lint of the catalogue (the lint rejects the words, so the questions are phrased about the message, not the person); the pre-pass input is the last six lines and a persona header, never memories or profile cards, so what leaves to OpenAI under `core.conversation` does not widen; outputs never grant access, identity or sharing. Before production: ZDR approval from OpenAI, the EU endpoint for EU members, a hashed `safety_identifier`, and the DPIA updated to list Decisions as a processor of every message.

**Routing on a miss.** The proposals disagreed. One inverted the default so a triage timeout lands on Haiku; another kept today's "a miss never degrades quality" and routes to the main model. This document keeps the quality rule until the EN/FA evaluation shows Haiku 5.5 at low effort is non-inferior for the quick route; then the default flips. Either way the await budget is 450 ms and a late answer still feeds the background job.

**First-sentence steering on calls.** ElevenLabs Agents deliver only the final text of each turn, so the earliest decision point is the start of Vox's LLM endpoint call; running the pre-pass concurrently with the snapshot read there keeps it off the critical path. Deciding while the person is still speaking needs partial transcripts: either ElevenLabs Scribe v2 Realtime with Vox's own turn loop (preemptive generation on stable partials, discard on lexical change, cancelled drafts never enter history, retries capped) or a GPT-Live pilot with native delegation. Measure ElevenLabs' time-to-first-audio against the cached endpoint first; switch only for a measured gain, since GPT-Live would change the persona voices.

**Images.** This is a new subsystem, not a flag: Telegram `photo` and `document` handling in the gateway, PhotoSize selection (smallest at or above 320 px, base64, detail low), image parts in the Decisions seam, a retention rule ("never stored unless asked"; people in images never produce identity or descriptions; sensitive documents never stored), and an entry in the purpose map and processor table.

### 4.9 Identity: Telegram id, voiceprint, communication style

Four concepts stay distinct, as `src/lib/adaptive/types.ts` already encodes: authenticated account, verified person, temporary speaker label, output audience. The new piece is one score and one seam.

**Identity confidence.** `GatewayDeps.identity` (new `IdentityService`) produces `IdentityHint` (the type exists and is dead today) and `TurnSnapshot.identity.level` is hashed into the policy key. Fusion in log-odds with hard caps: the Telegram account is the prior; an enrolled voiceprint is a weighted signal with channel-aware thresholds; style is weak evidence capped so that alone it can move a session from consistent to uncertain, never to inconsistent. Effects, and nothing else: in uncertain or inconsistent the agent stops using personal and confidential memories and the profile card, tags extraction as speaker-uncertain, refuses offers and callbacks, and asks at most one neutral question per session, only when the conversation is about to touch personal memory ("Quick check before I pull up your notes: still Reza?") with "Yes, it's me" and "Someone else is using this phone". The second switches to an unknown-speaker profile with no access to the owner's private memories and no writes into the owner's memory. True switching needs the Mini App login. The signal never grants access, never says "you are not X", never notifies admins, never enters an employer-visible log, and is disabled per member when it is systematically wrong (Gini of per-user error). A CI test asserts a hint never reaches `AccessRequest`.

**Voiceprint (PRIV-017 to PRIV-025 apply; backlog VOX-038 to VOX-042).**

- Gates before any comparison: adult declaration; jurisdiction registry approval (Illinois and Texas blocked until a written release and destruction policy exist); `optional.biometric_recognition` granted with affirmative evidence, e-signed where required; agent grant; `STUDIO_VOICE_RECOGNITION=1`; the hard deny in `persistence/service.ts` replaced by that check. Employer acceptance is not member consent.
- Enrollment in the Mini App ("Teach Aria to recognise your voice"): three clips of at least 10 s (30 s net after VAD), at least one Telegram voice note and one in-app capture, in each language the person uses; reject overlap or low SNR; store encrypted float16 embeddings with model version, channel and consent event id in the isolated store; erase raw samples after embedding; Delete and Re-enrol in the Memories screen.
- Verification: only on 1:1 Telegram voice notes of a non-guest member with an active enrollment, run in parallel with STT, at least 3 s of net speech or "no opinion", candidate set the account owner alone, three bands calibrated per org from cross-member impostor trials, shipping only when FAR ≤0.5% at FRR ≤5% on ≥5 s audio is measured on consenting members in both languages, shadow mode for the first month. The person knowingly sends a voice note to a persona they enrolled with, which is the "active involvement" the Service Desk distinguishes from remote identification; counsel should confirm that reading before a non-shadow rollout.
- Live calls: raw audio never reaches Vox, so `liveTurn` stays at the account level. If call-based verification is ever wanted, prefer a client-side bounded capture in the Mini App over ElevenLabs audio retention.
- Spoofing posture: keep embeddings of every ElevenLabs persona voice Vox generates and reject matching audio; run ElevenLabs' watermark detector on inbound audio; treat countermeasure scores as a soft flag.
- Drift: adaptive templates from confirmed matches, re-enrol every 6 to 12 months, abstain rather than lower thresholds on emotional or other-language audio, re-embed on model upgrades.
- Key management: the Mac file profile has no KMS; either declare voiceprints Firebase-only with Cloud KMS envelope encryption, or design a file-profile key and backup scheme first.
- Never: identify guests or outsiders, diarize groups to identify people, share voiceprints across orgs or to a successor, infer emotion or any attribute from voice, auto-delete later than CUBI's one-year clock after a member leaves.

**Communication style.**

- Phase 0, pure value: use style to adapt language, formality, length and pacing, and to keep the unknown-speaker state. Content-free features only (character n-grams, misspelling habits, punctuation and emoticon rates, Persian/English/Finglish mix and script, message length and splitting, voice-vs-text ratio, edit frequency, hour-of-day), computed in the worker after at least 50 messages, stored as 7-day-expiring observed facts under `optional.personalization`. Raw text stays under the existing deletion rules; there is no persisted identity model.
- Phase 1, after an internal benchmark on consenting members: the downgrade signal. Never on one message; a sequential test over at least 5 messages against the person's own rolling profile and an explicit unknown class, per-person thresholds set so each member sees fewer than one spurious prompt a week.
- No LLM or Decisions "same author?" judge as a primary signal; at most a tiebreaker after a month of logged calibration.
- There is no phase in which identity is granted from style.

### 4.10 Personalisation and prediction

- Precedence: explicit request this turn > explicit stored preference > inferred hypothesis > persona default, with "Why this?" and Reset in the Experience screen (REQ-08, PRIV-028).
- The L2 card and the L1 working state (goal, open loops, thread status, three predicted next intents with prefetched read-only memory ids) are what make the first reply of a conversation feel informed; they are rebuilt in the worker, not on the request.
- A Beta-Bernoulli Thompson-sampling bandit over 4 to 6 low-risk reply-style arms per (person, persona, space, route), with a composite reward (reaction, non-corrective follow-up within 10 minutes, share offer accepted, voice reciprocated, explicit thanks; negative on "no / again / not what I meant" or an `explicit_correction`), never reply-rate alone, posteriors visible and resettable, explicit preferences pinning arms, chosen arm and propensity logged for offline evaluation. **Deferred** until continuity has shipped, the DPIA covers behavioural adaptation, and whether `message_reaction` updates reach persona bots in private chats is confirmed.

### 4.11 Latency targets

| Route | First visible text or audio (p50 / p95) | Complete reply | Depends on |
|---|---|---|---|
| Private text | 1.2 s / 2.5 s (1.5 s p50 if Haiku TTFT at low effort exceeds 500 ms) | 3 s / 6 s | boundary once; triage parallel; cached prefix; effort low; first-sentence send |
| Group text (addressed) | 1.4 s / 3.0 s, single send | 3 s / 6 s | same, no edits |
| Voice note | transcript 3.0 s / 5.5 s; audio 5 s / 8 s | 6 s / 10 s | download in parallel with the snapshot; transcript first; Flash v2.5 TTS; `sendVoice` cannot stream |
| Live call, Vox side | ≤0.5 s / 1.0 s request → first SSE token | 2 s / 4 s | per-call session cache; no per-chunk boundary; coalesced deltas |
| Live call, end to end | 1.0–1.3 s / 2.0 s end of speech → first audio | — | ElevenLabs STT and turn detection (outside Vox); industry target p50 under 800 ms |

Baselines are estimates for the Firestore profile (text about 7 s p50, voice note about 12 s, live call 3.6 s to first token then 15 to 30 s per reply). The Mac file profile is faster per recomputation but has the same shape. Step 0 replaces these with measurements.

**Measured: step 1 (boundary once), Mac file profile, 20 October 2026.** Vox-side work only. The model is a local stub (zero latency for text; twelve deltas 25 ms apart for live), so no network or model time is included. Harness: `src/lib/studio/__tests__/turn-latency.bench.test.ts` (opt-in, `VOX_TURN_BENCH=1`), content-free timers on the gateway's boundary and recheck calls, a consented account with three saved notes, an explicit preference and shared memory wired. Each figure is the median of three runs of 15 turns after 3 warm-up turns, before (`0ba1ddd`) and after on the same machine. When this was first measured, Step 0's product timers had not landed, so the harness wraps the gateway methods instead. Absolute numbers move with machine load (an earlier "before" run measured 540 ms for the same text turn); the counts and ratios are stable. Firestore was not measured.

| Stage (ms unless a count) | Private text before | Private text after | Live call before | Live call after |
|---|---|---|---|---|
| Boundary computations per turn (count) | 6 | 1 | 15 | 1 |
| Rechecks per turn (count) | 5 | 4 | 14 | 2 |
| First boundary / snapshot | 47 | 12 | 49 | 12 |
| All rechecks | 239 | 4.5 | 693 | 2.4 |
| All privacy work | 286 | 16.7 | 748 | 14.6 |
| Request to provider call | 96 | 14 | 144 | 16 |
| Request to SSE headers | | | 221 | 43 |
| Request to first SSE content | | | 221 | 43 |
| Turn total, Vox side | 287 | 17.5 | 1,064 | 334 (300 is the stub stream) |

**Re-measured after merging main `c7498a5`, same harness and machine.** Main had meanwhile added its own compact mode for prepared and indexed adaptive stores and a read-only committed path for `runtimePrivacy.read`. The default file format still recomputed the full boundary at every recheck, so the comparison is current main against this branch merged with it.

| Stage (ms unless a count) | Private text, main | Private text, merged | Live call, main | Live call, merged |
|---|---|---|---|---|
| Boundary computations per turn (count) | 7 | 1 | 16 | 1 |
| All privacy work | 299 | 35 | 1,434 | 32 |
| Request to provider call | 136 | 46 | 271 | 33 |
| Request to first SSE content | | | 415 | 60 |
| Turn total, Vox side | 303 | 52 | 1,754 | 343 (300 is the stub stream) |

**Measured on develop `39ef433` with step 1 merged (`step1-into-develop`), same harness and machine.** On this branch the change is confined to `boundary()`, `unchanged()` and the live recheck loop, and file-format snapshots read through `readCommittedForEffect`. A repeated `boundary()` in the same turn (after relationship observation, before memory writes) replays the snapshot instead of loading it again.

| Stage (ms unless a count) | Private text, develop | Private text, branch | Live call, develop | Live call, branch |
|---|---|---|---|---|
| Full boundary computations per turn (count) | 7 | 1 | 16 | 1 |
| All privacy work | 296 | 20 | 711 | 19 |
| Request to provider call | 124 | 16 | 174 | 20 |
| Request to first SSE content | | | 247 | 46 |
| Turn total, Vox side | 297 | 22 | 1,025 | 329 (300 is the stub stream) |

### 4.12 What it costs

Per private text turn after restructuring, blended at 70% Haiku and 30% Sonnet escalation: about $0.002, falling to about $0.001 if escalation is 10%; the Decisions pre-pass is about $0.0001 of that; the Haiku-only route is about $0.0003 with a warm cache. Today's main route is Sonnet at about $0.019 per uncached turn. Voice features dominate spend: STT and ElevenLabs TTS and Agents prices on Vox's actual plan are unverified and excluded. Firestore operations fall from roughly 60 to 100 reads and 50 transactional writes per turn to roughly 10 to 15 reads and 3 to 5 writes. Nightly consolidation on the Batch API costs under $0.01 per person-persona per night on Haiku. Order of magnitude: $1 to $3 per active user-month excluding voice. Cache reads do not count toward Anthropic rate limits, so the Start tier covers a pilot; the $500 monthly spend cap is the first wall.

---

## 5. Delivery order

The three proposals shared the diagnosis and the core remedy. They disagreed on four things, resolved here: (a) governance before or after speed: the security gaps ship first, then the boundary collapse, then everything else; (b) triage miss routing: quality preserved until measured; (c) memory placement: user turn by default; (d) the bandit: deferred. Each step ships alone behind a flag and keeps the suites green. Backlog ids refer to `docs/implementation/BACKLOG.md`.

| # | Increment | Touches | Backlog | Gate |
|---|---|---|---|---|
| 0 | **Close the known gaps and measure.** Route non-member voice notes through the stranger decision before any STT and never transcribe guests or `hasGuests` groups; delete or bearer-protect the legacy `/api/convai/*` routes and inventory every route outside `/api/studio` (including `/api/clone-voice`); make `memoryEnabled` honour `allowed`; use `group.hasGuests` in `prompt.ts`; move people-scope recipient validation into `sharing.ts`; make `makeStudio()` wire the adaptive service by default; add content-free per-stage timers and `count_tokens` on the prompt; run one week of p50/p95 per route on the Mac profile | `updates.ts`, `gateway.ts`, `prompt.ts`, `sharing.ts`, test helpers, `llm.ts`, diagnostics | VOX-019, VOX-021 | Measured baseline exists |
| 1 | **Boundary once.** `loadTurnSnapshot` with a revision vector; read-only `load()` in adaptive storage; the studio state read once; `unchanged()` as a scalar compare; a CI test enumerating every former hash input and asserting a monotonic revision writer exists; live calls compare every 500 ms, coalesce deltas, send SSE headers early; drop the unconditional second boundary and the post-LLM recheck in favour of the send check; `/forget` and forget paths unified | `gateway.ts`, `studio/service.ts`, `adaptive/persistence/*`, `shared/service.ts`, `voice-call.ts` | VOX-013, VOX-026 | Text turn ≥40% faster measured; live calls usable |
| 2 | **Hot-path hygiene.** `Promise.all` for dedupe, epoch and snapshot; typing fire-and-forget with a repeater; triage promise passed into `composeReply` with a 450 ms budget; triage through `DecisionService` with a configurable deadline (the other four Decisions clients become adapters or are deleted); transcript sent before TTS on voice notes; refusal and truncation handling after every Claude call | `gateway.ts`, `adaptive/decisions`, `media.ts`, `runtime.ts` | VOX-024, VOX-030 | Decisions no longer on the critical path |
| 3 | **Cache-stable prompt.** `LLMRequest.system` as content blocks with `cache_control`, `effort` and usage metadata; blocks A/B/C; "## For this turn" in the user turn; byte-identical history replay; A/B flag for the system-tail variant | `llm.ts`, `prompt.ts` | VOX-013 | `cache_read_input_tokens` ≥70% in staging |
| 4 | **Continuity under consent.** `runtimePrivacy.read` returns `historyEnabled` for lineage-stamped rows under `core.conversation` with the disclosed 30-day retention and temporary mode, and `memoryEnabled` from `optional.auto_memory` or an explicit request; chat-history TTL; working-state doc; live calls keep their own turns; consent events and outbox moved out of the single account document; the missing PRIV-010 ledger fields added. Prerequisites: controller entity and privacy contact confirmed, notice and PRODUCTION.md updated, LIA/DPIA delta signed | `adaptive/persistence/service.ts`, `gateway.ts`, consent copy, docs | VOX-011, VOX-014 | Legal gate signed; a Studio turn demonstrably loads and retains |
| 5 | **Durable outbox and worker.** Job contract (4.5), file and Firestore stores, in-process worker on the Mac profile, drain route on Firebase; `formMemories`, the relationship assessor, share offers and `reflect` become handlers that recheck the vector and tombstones; never-store classifier; `decideScope` v2 with status and evidence strength | new `tireh/jobs/*`, `extraction.ts`, `bots.ts` | VOX-013, VOX-018 | No text in any job payload; stale-vector abort tested |
| 6 | **Memory record v2 and bounded retrieval.** L3 fields; embeddings at write time in the worker; Persian-aware lexical path; in-process scorer on the file profile; `findNearest` with composite indexes on Firestore above ~300 visible records; the ~100-question EN/FA memory eval with recall@8 and leakage = 0 as gates; negative-identity retrieval tests through the full pipeline | `types.ts`, `retrieval.ts`, `firestore-store.ts`, new `memory/embeddings.ts` | VOX-013 | Eval gates pass before the default switches |
| 7 | **Cards, packs, consolidation, forget cascade.** Profile and group cards, context packs, nightly consolidation on Batch, Mem0-style write path, deletion as a job with states, bounded tombstone subcollection, subject rights ("About me" with Dispute and Request deletion), per-person inventory and export | new `memory/cards.ts`, `memory/pack.ts`, `memory/consolidate.ts`, Memories screen | VOX-013, VOX-014, VOX-056 | Paired-conversation invariance with and without an unauthorised fact |
| 8 | **Sharing policy completion and audit.** `historyPolicy` on groups with the admin re-snapshot action; successor-inheritance filter with tombstones; "updated" notice to recipients on supersession; shared context decoupled from personalization consent; `vox_audit`; the 14-invariant suite from the memory review and the red-team gate as protected CI jobs; PolicySnapshotBuilder with the differential test between `visibility.ts` and `authorizeAccess` as a CI oracle | `visibility.ts`, `sharing.ts`, `studio/service.ts`, new `tireh/policy/snapshot.ts` | VOX-010, VOX-014, VOX-021 | Differential test green on every fixture |
| 9 | **Pre-pass v2 in shadow, then consumed.** Route, context need, thread status, explicit style request, sensitivity predicates, explicit correction; versioned question sets; content-free decision log; catalogue lint; thresholds set per question on ≥200 EN and 200 FA labelled examples; EN/FA reply-quality eval of Haiku-low vs Sonnet before flipping the default route | `triage.ts`, `adaptive/decisions`, new `tireh/decisions/catalog.ts` | VOX-024, VOX-025, VOX-030 | Calibration report per question |
| 10 | **Identity confidence, phase 0 and 1.** `IdentityService` seam, `identity.level` in the snapshot and key, style features for adaptation, unknown-speaker state, then the downgrade signal after the benchmark; hint-isolation and never-widen tests | new `tireh/identity.ts`, `gateway.ts` | VOX-009, VOX-040 | False-prompt budget met per member |
| 11 | **Voice enrollment and verification, shadow first.** Behind the flag, capability approval, jurisdiction registry and consent; isolated encrypted store with a key design for the active profile; pyannoteAI adapter first, self-hosted later; self-echo guard; in-house FAR/FRR per channel and duration | new `studio/identity/voice.ts`, Mini App screens, `http.ts` | VOX-038 to VOX-042 | Counsel opinion on verification vs identification; measured bands |
| 12 | **Image ingestion and triage.** Photo and document handling, PhotoSize selection, image parts in the seam, retention rule, purpose map entry | `gateway.ts`, `adaptive/decisions`, `media.ts` | VOX-031 | Sensitive-document and people rules tested |
| 13 | **Live-call speed after measurement.** Preemptive generation on stable partials with generation ids and cancellation barriers, Flash v2.5 streaming at sentence boundaries, pre-pass on transcript deltas; GPT-Live only as a comparison pilot | `voice-call.ts`, `voice-llm` route | VOX-031, VOX-051 | Measured time-to-first-audio gain |
| 14 | **Reply-style bandit** behind explicit preferences with offline evaluation | new `adaptive/personalization/procedural.ts` | VOX-027 to VOX-029 | DPIA covers behavioural adaptation |
| 15 | **Vendor hygiene.** `openai` to ≥7.30.0 in an isolated PR with compatibility tests; ZDR and EU routing for Decisions; processor table filled from account dashboards (add web search and avatar generation); the Gemini fallback tested or deleted; the standalone TIREH runtime and the legacy Telegram webhook retired or kept by decision | `package.json`, `runtime.ts`, docs | VOX-008, VOX-024 | — |

Steps 0 to 3 remove most of the latency; step 4 is what gives the agent a memory again in production; steps 5 to 8 make it remember well and safely; steps 9 to 14 are the intelligence and identity work, each gated by its own measurement or legal check.

---

## 6. Measurement: what "much more intelligent" means

Three user-facing KPIs with baselines taken in step 0, and every intelligence feature gated on them:

- **Correction rate**: "no / again / not what I meant" per 100 turns (target: down 30%).
- **First-useful-response time**: p50 and p95 per route (targets in 4.11).
- **Recall@8 on the EN/FA memory eval**, with leakage = 0 as a hard gate, and the paired-conversation invariance test.

Plus operational gates: cache read ratio ≥70%, extraction-skip rate, Sonnet-route share alert above 40%, Decisions p50 per question, queue lag, discarded-draft rate when speculation is on.

---

## 7. Risks, unknowns and gates

**Must be measured before it is believed**

- Claude Haiku 5.5 TTFT on Vox's prompts at low effort, thinking disabled, cached and uncached; public numbers range from 1.4 s p95 to 8 s. Every sub-1.5 s target depends on it.
- The "today" baseline is a code-reading estimate for the Firestore profile; production runs the Mac file profile; no turn has been timed on either.
- Decisions p50/p95 from Vox's region (and the EU endpoint), its probability calibration on Persian and mixed-language chat, rate limits on `/v1/decisions`, caching behaviour, URL-image support and post-GA pricing.
- Firestore `findNearest` latency on pre-filtered sets of 1k to 50k vectors; embedding recall for Persian and Finglish.
- Voice: closed-set accuracy for 10 to 50 colleagues on messenger audio at 2, 3, 5 and 10 s; no paper covers it. Style: per-member false-prompt rate and Gini of per-user error.
- Whether `editMessageText` counts toward Telegram limits and whether `message_reaction` updates reach persona bots in private chats.
- That the `memorable` gate skips 40 to 60% of extraction calls and that the Mem0-style write path improves recall on Vox traffic.

**Legal and contractual gates that block specific features, not the core**

- **Sanctions and provider terms.** The user base and operators speak Persian; OpenAI, Anthropic, ElevenLabs and Google terms exclude service to users in sanctioned jurisdictions. Confirm where members and operators are located and obtain counsel's view before investing further in vendor-dependent voice, Decisions and memory features; record it in `PRIVACY_AND_CONSENT.md` and the processor table.
- The registered Joyixir entity, address and the operation of the privacy contact are unverified; no public notice, DPIA, LIA, consent record or BIPA release can name a controller until they are. Make this step 0 of the legal track and a hard gate for step 4.
- DPIA and purpose-separated LIA before the staff rollout (memory, voice verification, routing and prediction, group listening each named separately).
- Jurisdiction registry: voice recognition blocked in Illinois and Texas until a written release and destruction policy exist, and anywhere not reviewed; counsel's reading of consented 1:1 voice-note verification versus remote identification under the AI Act; a short opinion on whether text stylometry is biometric categorisation.
- Article 50 disclosures now: bots say they are AI; a join notice in groups stating that privacy mode is off and what is kept; a worker notice listing each purpose and retention.
- Provider retention: ZDR for Decisions and transcription; replies on models with no default retention (Haiku and Sonnet, not Fable); ElevenLabs Agents retain conversation data for two years by default and Zero Retention Mode is enterprise-only; the Anthropic web-search tool and avatar generation added to the processor table.

**Product questions to decide**

- Group listening: is "listen always" needed, or does mention-and-reply mode deliver most of the value with far less employee data? Make it a per-group admin choice recorded in the container policy and run a short comparison.
- Live calls: stay on ElevenLabs Agents (no audio reaches Vox, voices preserved), build a Vox-owned streaming loop, or pilot GPT-Live. Measure first.
- The standalone TIREH runtime and the legacy `/app` surface: retire or keep, by decision, not by drift.
- Whether a shared-device case (an assistant managing a manager's Telegram) deserves an explicit delegated profile rather than an identity signal.

**Vendor and design risk**

- Decisions is beta on one model; the seam and the Haiku forced-tool backend are the hedge; thresholds must be recalibrated if the model changes.
- The revision vector is only as complete as its writers; the enumeration test is mandatory, and every new policy-bearing store must bump a revision in the same transaction.
- Context packs and cards are derived data; a builder bug would leak at hot-path speed; they are built with the same visibility functions, carry the vector they were built from, and the negative-identity suite runs against them.
- Studio state revision bumps on any org edit (a guest name refresh, a role change) and resets history replay org-wide until a per-person membership revision exists.
- Moving extraction to a worker introduces lag; the working-state overlay and the recent window cover it, and queue lag must be alerted.
- The single Mac process would run pollers, the worker, embeddings and consolidation; bound worker concurrency, isolate failures per job, keep a kill switch per handler, and write down the single-host failure and recovery statement in `PRODUCTION.md`.

**What this document does not claim**

- No production behaviour was measured; figures are estimates from documented prices and third-party benchmarks.
- No finite test suite proves zero leakage; the regression suite is a release gate, not a proof.
- Nothing here replaces counsel on GDPR, the AI Act, sanctions, BIPA or CUBI.

---

## 8. Sources

All links were read on 19 or 20 October 2026. Vendor claims are marked as such in the text.

**OpenAI Decisions and voice**
- Decisions guide: https://developers.openai.com/api/docs/guides/decisions
- Decisions with voice: https://developers.openai.com/api/docs/guides/decisions-voice
- OpenAPI specification: https://github.com/openai/openai-openapi/blob/main/openapi.yaml
- Pricing: https://developers.openai.com/api/docs/pricing
- Data controls: https://developers.openai.com/api/docs/guides/your-data
- Beta announcement thread: https://community.openai.com/t/decisions-api-is-now-available-in-public-beta/1403877
- Independent benchmark: https://github.com/atlanai/decision-bench/pull/15
- Decision-model comparison: https://www.firecrawl.dev/blog/openai-decisions-api-vs-jev

**Context engineering and the Claude platform**
- Anthropic, Effective context engineering: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Manus, Context engineering lessons: https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus
- Chroma, Context Rot: https://www.trychroma.com/research/context-rot
- NoLiMa: https://arxiv.org/abs/2502.05167
- Breunig, How long contexts fail: https://www.dbreunig.com/2025/06/22/how-contexts-fail-and-how-to-fix-them.html
- Prompt caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- Mid-conversation system messages: https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages
- Effort: https://platform.claude.com/docs/en/build-with-claude/effort
- Haiku 5.5 migration guide: https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide
- Structured outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Compaction on demand: https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand
- Memory tool: https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
- Batch processing: https://platform.claude.com/docs/en/build-with-claude/batch-processing
- Pricing: https://platform.claude.com/docs/en/about-claude/pricing
- Rate limits: https://platform.claude.com/docs/en/api/rate-limits
- Agent SDK hosting: https://code.claude.com/docs/en/agent-sdk/hosting
- Data retention: https://platform.claude.com/docs/en/manage-claude/api-and-data-retention

**Agent memory**
- Mem0: https://arxiv.org/html/2504.19413
- Zep / Graphiti: https://arxiv.org/html/2501.13956
- Letta shared memory: https://docs.letta.com/guides/agents/multi-agent-shared-memory
- Generative Agents: https://ar5iv.labs.arxiv.org/html/2304.03442
- Hindsight: https://arxiv.org/abs/2512.12818
- LongMemEval: https://arxiv.org/abs/2410.10813
- LangMem taxonomy: https://langchain-ai.github.io/langmem/concepts/conceptual_guide/
- Glean permissions: https://developers.glean.com/libraries/indexing-sdk/permissions
- Microsoft Copilot privacy: https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-privacy
- OpenFGA search with permissions: https://openfga.dev/docs/interacting/search-with-permissions
- Firestore vector search: https://firebase.google.com/docs/firestore/vector-search
- Firestore pricing: https://firebase.google.com/docs/firestore/pricing
- Cloud KMS envelope encryption: https://docs.cloud.google.com/kms/docs/envelope-encryption
- pgvector: https://github.com/pgvector/pgvector

**Voice and speaker identification**
- ReDimNet2+: https://arxiv.org/html/2609.37014
- ERes2NetV2: https://arxiv.org/html/2406.02167
- Codec effects: https://arxiv.org/html/2509.02771
- VoxAging: https://arxiv.org/html/2505.21445
- Short-segment verification: https://arxiv.org/html/2509.19721
- OpenSVBench: https://arxiv.org/html/2610.13760
- Voice cloning vs verification: https://github.com/christina75101/voice-clonning-attack
- ASVspoof 5: https://arxiv.org/html/2408.08739v1
- Speechmatics speaker identification: https://docs.speechmatics.com/speech-to-text/features/speaker-identification
- pyannoteAI pricing: https://www.pyannote.ai/pricing
- Azure Speaker Recognition retirement: https://learn.microsoft.com/en-us/answers/questions/5606057/enable-speaker-recognition-text-independent
- Telegram bot developer terms: https://telegram.org/tos/bot-developers
- Telegram Bot API: https://core.telegram.org/bots/api

**Communication style and authorship**
- PAN 2023 overview: https://ceur-ws.org/Vol-3497/paper-199.pdf
- AuthBench: https://arxiv.org/abs/2609.06771
- LUAR: https://aclanthology.org/2021.emnlp-main.70/
- LLM authorship judgements: https://arxiv.org/html/2403.08213v1
- AVShift: https://arxiv.org/html/2608.17979
- Imitation attacks: https://arxiv.org/html/2509.14543
- GDPR Article 22: https://gdpr-info.eu/art-22-gdpr/

**Fast voice agents and personalisation**
- ElevenLabs latency guide: https://elevenlabs.io/blog/voice-agent-latency-optimization
- LiveKit turn detector: https://docs.livekit.io/agents/build/turns/turn-detector/
- LiveKit preemptive generation: https://docs.livekit.io/agents/build/audio/
- AssemblyAI best practices: https://www.assemblyai.com/docs/voice-agents/best-practices
- Claude vision: https://platform.claude.com/docs/en/build-with-claude/vision
- Intent prediction prior: https://arxiv.org/abs/2604.27379
- Azure Personalizer retirement: https://azure.microsoft.com/updates/ai-services-personalizer-will-be-retired-on-1-october-2026
- Implicit feedback as reward: https://aclanthology.org/2025.emnlp-main.133/
- Telegram bot FAQ: https://core.telegram.org/bots/faq
- Next.js after(): https://nextjs.org/docs/app/api-reference/functions/after

**Privacy and governance**
- EU AI Act Article 5: https://artificialintelligenceact.eu/article/5/
- AI Act Service Desk, biometrics: https://ai-act-service-desk.ec.europa.eu/en/biometrics
- Digital Omnibus summary: https://www.orrick.com/en/Insights/2026/07/EU-AI-Act-Update-Digital-Omnibus-Finalizes-8-Compliance-Changes
- ICO biometric guidance: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/biometric-data-guidance-biometric-recognition/how-do-we-process-biometric-data-lawfully/
- CNIL on data subject rights: https://www.cnil.fr/en/ensuring-and-facilitating-exercise-data-subjects-rights
- Budapest Bank decision: https://cms.law/en/int/publication/gdpr-enforcement-tracker-report/hungary
- ConfAIde: https://arxiv.org/abs/2310.17884
- Claude memory controls: https://claude.com/blog/memory
- Limitless consent guidance: https://help.limitless.ai/en/articles/10540861-how-to-ask-for-consent-and-let-others-know-you-are-recording
- Telegram privacy mode: https://core.telegram.org/bots/features
- UK Data (Use and Access) Act: https://www.kennedyslaw.com/en/thought-leadership/article/2026/the-data-use-and-access-act-2025-commencement-dates-and-planned-guidance-for-2026

**Repository documents this builds on**
- `docs/AGENT_MEMORY_STRATEGY.md`, `docs/SELF_DEVELOPMENT_RESEARCH.md`
- `docs/implementation/PLAN.md`, `ARCHITECTURE.md`, `PRIVACY_AND_CONSENT.md`, `BACKLOG.md`, `PRODUCTION.md`
- `docs/TIREH_PERSONAS.md`, `docs/VOX_STUDIO.md`, `docs/PROACTIVE_GROUPS.md`, `docs/RELATIONSHIP_SYSTEM_PLAN.md`, `docs/STUDIO_VOICES.md`, `docs/reports/relationship-decision-calibration.md`
