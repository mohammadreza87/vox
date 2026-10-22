# Vox privacy, consent and voice recognition implementation requirements

Planning review: **19 October 2026**. Status: **proposed requirements and bilingual draft copy; no implementation, collection, legal sign-off or deployment**. Registered operator name supplied by the user: **Joyixir OÜ**. Intended launch audience: **adults only (18+) in the EU/EEA and US**. The user confirmed **info@joyixir.com** as Joyixir's privacy contact on 19 October 2026. Mailbox operation and legal approval have not been verified. The [registered address is verified from the official Estonian register](OPERATOR_DETAILS.md). Mailbox operation, processing roles and the full legal notice still require qualification.

**اطلاعات تماس تأییدشده توسط کاربر:** کاربر در ۱۹ اکتبر ۲۰۲۶ نشانی **info@joyixir.com** را برای تماس دربارهٔ حریم خصوصی Joyixir تأیید کرد. کارکرد صندوق ایمیل و تأیید حقوقی بررسی نشده است. نام شخصیت حقوقی ثبت‌شده، **Joyixir OÜ**، توسط کاربر تأیید شد؛ نشانی ثبت‌شده از سامانهٔ رسمی شرکت‌های استونی بررسی شده است؛ نقش‌های پردازش و تأیید کامل متن حقوقی هنوز تکمیل نشده‌اند.

This document complements [Agent memory strategy](../AGENT_MEMORY_STRATEGY.md) and [Self-development research](../SELF_DEVELOPMENT_RESEARCH.md). It governs behavioral observation, durable personalization, predictions, notifications and optional speaker recognition. Requirements marked `PRIV-*` are proposed Vox release criteria. They combine source-informed legal constraints with deliberately stricter product choices; they are not a legal guarantee or a complete jurisdiction survey.

## 1. Decisions and boundaries

**PRIV-001 — Separate purposes.** Give every data operation an approved purpose, data inventory entry, retention rule, audience and lawful-basis record. “Improve Vox” is insufficient. Keep providing the requested conversation, operational security, optional product analytics, personal adaptation, biometric recognition, human quality review, and marketing separate. A disclosure is not consent; OS microphone permission is not biometric enrollment; notification transport permission is not marketing permission.

**PRIV-002 — Core access and optional choices.** Core conversations must work with every optional switch off. Offer text and explicit account/person selection as alternatives to microphone use and speaker recognition. Optional denial must not cause repeated prompts, worse account access or a higher-friction refusal path. No preselected choices, consent inferred from continued use, or bundled “accept privacy policy” checkbox. Privacy notice acknowledgement, contractual agreement and consent events have different record types. See [S2](#s2-consent) and [S3](#s3-lawful-basis).

**PRIV-003 — Scope.** No always-on microphone, off-app screen surveillance, unrequested connector harvesting, cross-site advertising, sale of biometric data, voice cloning, sensitive-trait inference or employee productivity scoring in this release. Future scope requires its own assessment and product decision. Ordinary adaptation to an explicit request such as “answer briefly” must not be described as diagnosing emotion or personality.

**PRIV-004 — Adults and accidental participants.** Use a proportionate 18+ entry gate without collecting full birth dates by default. Do not infer age from voice. An adult account cannot enroll a child's voice or grant consent for another competent adult. Provide an underage/accidental-capture response and deletion route; an adults-only label does not prevent incidental child or bystander data. Stop optional capture on a credible underage signal and route review without storing unnecessary evidence.

## 2. Legal interpretation that informs the design

### EU/EEA

GDPR has several possible lawful bases. Contract necessity must be assessed against the actual requested service; security may rely on a documented legitimate-interest assessment or a legal obligation where applicable. Optional analytics is not automatically contract necessary. Special-category processing needs an applicable Article 9 condition as well as an Article 6 basis. These determinations remain launch decisions, not something the UI can settle. [S3](#s3-lawful-basis)

For this plan, optional behavioral personalization and analytics use separate opt-in controls. EU ePrivacy device storage/access is an additional gate: calling collection “server-side,” “first-party” or pseudonymous does not itself exempt device access. A strictly necessary requested-service exemption needs a documented operation-level assessment; national implementations and narrow analytics exemptions require country review. [S4](#s4-eprivacy)

Voice-to-text, anonymous session speaker labels, identifying a person, and generating a voice are different operations. A recording is personal data when identifiable; it is not automatically Article 9 biometric identification merely because it contains a voice. Voiceprints used to identify a person trigger the biometric regime. The EDPB voice-assistant guidance calls for explicit consent with a practical alternative and recommends user-initiated recognition and local template generation/storage/matching. It also warns about processing non-enrolled speakers. [S1](#s1-voice-assistants)

The AI Act requires direct AI interaction disclosure and has separate duties for synthetic output, emotion recognition and biometric categorisation. Biometric-based emotion/intent inference in workplaces and educational institutions is prohibited subject to narrow medical/safety exceptions. Consent does not override a prohibition. Vox must distinguish a person's expressed preference or semantic request from biometric emotion inference. [S5](#s5-ai-act-transparency), [S6](#s6-ai-act-prohibitions-and-definitions)

As checked on this document's date, the Commission's amended timeline places Article 50 transparency from **2 August 2026**, existing prohibitions from **2 February 2025**, Annex III high-risk requirements from **2 December 2027**, and Annex I product-related high-risk requirements from **2 August 2028**. A **2 December 2026** transition concerns certain preexisting synthetic-content providers under Article 50(2); it does not generally defer AI interaction disclosure. The 2026 Omnibus is reflected in the Commission's consolidated-text service; counsel must verify the controlling amended legislation and EEA incorporation at launch. [S7](#s7-current-ai-act-timeline)

### US

There is no “US consent” switch that resolves every state law. The following examples establish targeted gates, not an exhaustive inventory:

- **Illinois BIPA:** voiceprints fall within its definitions. Section 15 requires advance written information on collection, specific purpose and term plus an executed written release; a public retention/destruction policy; destruction on purpose satisfaction or within three years of last interaction, whichever is earlier; restrictions on disclosure; no sale, lease, trade or other profit from biometrics; and protective handling. Applicability, electronic execution and vendor flows require review. [S8](#s8-illinois)
- **Texas:** Section 503.001 covers commercial voiceprint capture, advance notice/consent, protection, restricted disclosure and destruction within a reasonable time no later than one year after purpose expiry, subject to specified exceptions. Amendments effective January 2026 add AI-related provisions; the broad model-development exception excludes systems deployed to uniquely identify a specific person. Treat biometric recognition as gated pending Texas-specific review, including cloud disclosures. [S9](#s9-texas)
- **California:** CCPA applicability depends on business facts and thresholds; biometrics processed to uniquely identify a consumer are sensitive personal information. Relevant rights include know/access, correction, deletion and applicable sale/sharing opt-out or sensitive-use limitation. Current CPPA guidance uses the adjusted **$26.625 million** revenue threshold (effective 2025), **100,000** consumers/households bought/sold/shared, or **50%** revenue from selling/sharing; entity relationships and processor obligations can also matter. Do not hard-code the old $25 million threshold. Current regulation effective dates and applicability require review. [S10](#s10-california)
- **Washington:** RCW 19.375 has its own enrollment, disclosure and retention terms and an unusual definition excluding audio recordings and data generated from them. Do not assume every voice pipeline has the same coverage as BIPA, or that a definition exclusion removes other Washington privacy obligations. [S11](#s11-washington)
- **Recording/interception:** Florida's statutory consent exception uses prior consent of all parties; California confidential-communication recording and other state/federal interception rules need review for the exact real-time STT, streaming, storage and provider architecture. Lack of a saved audio file does not itself establish that no interception occurs. Interstate calls create additional choice-of-law questions. [S12](#s12-recording-and-interception)
- The FTC identifies hidden biometric collection, unsubstantiated accuracy claims and inadequate vendor/risk assessment as possible unfairness/deception concerns. Product promises must match measured behavior. [S13](#s13-ftc-biometric-policy)

**PRIV-005 — Jurisdiction release registry.** Maintain a counsel-reviewed country/state/feature allowlist with `blocked | review_pending | approved`, applicability reasoning, sources, effective date, owner, review expiry and exact configuration version. EU membership, EEA incorporation, residence, participant location and relevant establishment/processing facts are different inputs. Use proportionate declarations and known account facts; IP is an uncertain signal, not a legal determination. Unknown/conflicting coverage keeps biometric and multi-party audio features disabled. Do not collect precise location solely to avoid a privacy gate.

| Launch slice | Required targeted review | Planned state before that review |
|---|---|---|
| EU member states | GDPR role/basis/DPIA, national ePrivacy and communications law, AI Act role/use classification | Core launch pending legal/data-flow review; optional features off |
| EEA non-EU states | GDPR/EEA application and AI Act incorporation, local ePrivacy/communications rules | Separate country approval; no automatic EU flag inheritance |
| Illinois | BIPA coverage, executed release, public destruction policy, disclosure chain | Recognition blocked |
| Texas | CUBI + relevant Texas privacy/AI provisions, updated exceptions, vendor disclosures | Recognition blocked |
| California | CCPA coverage/current rules, notice at collection, rights, biometrics and recording architecture | Voice/multi-party release pending targeted review; optional uses off |
| Florida | Prior all-party interception consent, participant/channel design | Multi-party audio blocked |
| Washington | RCW definitions/exclusions, applicable general/health privacy rules | Recognition pending targeted review |
| Remaining US states, territories and interstate sessions | Current comprehensive privacy, biometrics, consumer health, recording, AI and marketing rules; no blanket fallback | Legal inventory required before expansion; affected feature blocked where unresolved |

## 3. Purpose and permission map

These are **proposed product defaults**, subject to legal basis decisions. A user choice is enforced even where the law might permit a broader use. No data collected on a non-consent basis may be silently reused after an optional consent is refused.

| Purpose key | Data/use | Proposed UX and processing gate | Retention/rights treatment |
|---|---|---|---|
| `core.conversation` | User-sent text, intentionally submitted audio, necessary STT/LLM/TTS and current task state | Clear core notice and requested interaction; Article 6 basis to be determined per contract/role; microphone/recording rules separately enforced | Short-lived audio; chat-history retention disclosed separately; ordinary rights route |
| `ops.security_reliability` | Minimal error codes, authorization/deletion outcomes, abuse/security signals and service timing | Document necessity and legitimate-interest/legal-obligation basis where applicable; device access assessed separately | No transcript/voiceprint in generic logs; distinct retention and objection handling |
| `optional.product_analytics` | Allowlisted action counts, feature exposure and outcome events | Off; affirmative opt-in before optional SDK/device collection and export | Purpose-scoped pseudonymous IDs; deletion/withdrawal route |
| `optional.personalization` | Patterns used to propose durable preferences or customize later sessions | Off; opt-in per verified person and space; show/edit inferred preference | Turn off future inference/use; separate delete of earlier preferences |
| `optional.auto_memory` | Automatic durable extraction of useful facts/commitments | Off; separate choice from ordinary conversation and analytics | Source-linked memory, editable/deletable; sensitive categories separately gated |
| `explicit.memory_request` | Exact fact the user asks to save | Just-in-time scope/content confirmation; not blanket consent for all future memory | Same scoped memory controls; lawful basis recorded for this narrow request |
| `optional.biometric_recognition` | Enrollment sample, reference voiceprint, live comparison data | Off; explicit, separate subject consent/release before any template creation/comparison; approved jurisdictions/devices only | Isolated encrypted template store; withdrawal triggers deletion workflow |
| `optional.reminder_delivery` | User-requested reminder/alert, destination token/address and timing | Off until person selects channel or creates reminder; OS permission only after intent | Per reminder/channel controls; no inferred-interest enrollment |
| `optional.proactive_suggestions` | Unrequested suggestions derived from approved memories/behavior | Off; separate permission from requested reminders | Explain why, dismiss/reset; quiet hours and caps |
| `optional.marketing` | Future promotional messages over separately named channels; outside initial release | Disabled and no enrollment UI in initial release; later explicit channel/purpose preference and local law review | Immediate suppression/opt-out; no marketing in mandatory service alerts |
| `optional.content_quality_review` | Specific donated conversation/audio with authorized human reviewers | Off; case-level donation, audience/subject authority check, retention and reviewers shown | Separate restricted evidence store; not enabled by analytics |
| `model_training` | Reuse of private content/voiceprints in shared model weights | Disabled in first release for Joyixir and contracted providers where the product can contractually control this | Do not promise machine unlearning; prevent unauthorized entry into training |

**PRIV-006 — Approved basis register.** Before collecting real data, legal/privacy owner approves the purpose map with Article 6 and, where needed, Article 9 grounds; ePrivacy analysis; US applicability; mandatory/optional status; objection/withdrawal consequences; controller/processor roles; and evidence of necessity. No generic “legitimate interests” fallback after a withdrawal. Work deployments need employer/employee imbalance analysis; employer acceptance is not an individual's freely given biometric consent. [S2](#s2-consent), [S3](#s3-lawful-basis)

**PRIV-007 — Semantic separation.** Analytics opt-in cannot enable transcript retention, auto-memory, human listening, speaker identification, replay, marketing or training. Turning off auto-memory must not silently delete an existing chat; the UI must separately show saved history and its deletion controls. Temporary mode must also suppress persistent queue/dead-letter payloads and diagnostic content copies.

**PRIV-008 — Telemetry projection.** Maintain event-schema allowlists at producer and ingress. Send counts/status/durations and opaque evidence references rather than content. Drop raw text/audio, voiceprints, sensitive inferences, contact lists, private URLs and free-form exception dumps from general analytics. Keep optional analytics identity separate from protected person identity. Reidentifiable/pseudonymous events remain personal data.

**PRIV-009 — Providers and connectors.** Maintain a versioned processor/subprocessor table for audio transport, STT, LLM, TTS, recognition, storage, notifications and analytics: legal role, data fields, processing countries, subprocessors, remote support access, configured retention, training/abuse-review exceptions, DPA, transfer mechanism, deletion API and evidence. Verify account/endpoint settings rather than rely on a vendor's generic “zero retention” claim. Default abuse-monitoring retention, application/session storage, inference caches and exceptional safety retention are separate facts; a regional endpoint does not alone prove regional processing. Any GPT-Live stored-session option stays off unless its expiration and available deletion controls meet the approved policy. OAuth authorization does not permit every downstream use. Connectors require named scope and a disconnect/delete route.

### PRIV-009 processor table (draft, version 2026-10-22, base 6d00b80)

Documented defaults come from docs/AGENT_INTELLIGENCE_SOLUTION.md section 2.7 (verified 19-20 Oct 2026); every configured value is a placeholder until read from the account dashboard.

| Processor and service | Vox feature and code path | Data sent | Purpose key | Status at base | Legal role | Region/endpoint | Documented default retention and training | Configured retention, ZDR, DPA, transfer mechanism | Deletion route | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| Anthropic Messages API | Persona replies, memory extraction and the relationship assessor: `AnthropicLLM` in `src/lib/tireh/llm.ts`, wired by `src/lib/studio/runtime.ts` | Chat text for the turn, replayed history and memories authorized for the audience | `core.conversation`; `optional.auto_memory` for extraction | Live in Studio | processor (to confirm in DPA) | `api.anthropic.com`; processing region: verify on account dashboard | Section 2.7: nothing retained by default, 30 days for Covered Models such as Fable | verify on account dashboard | verify on account dashboard | TODO: dashboard capture, date, owner |
| Anthropic web_search server tool (`web_search_20250305`) | `AnthropicLLM.completeWithWeb`; on for a Studio agent unless `agent.liveWeb === false` (and off for all agents with `STUDIO_WEB_SEARCH=off`) | Model-generated search queries derived from member messages, passed to Anthropic's third-party search provider, whose identity and retention are unknown | `core.conversation` | Live in Studio (default on) | processor (to confirm in DPA) | Anthropic plus an unnamed search provider: verify on account dashboard | Section 2.7: not documented for the search provider; Anthropic defaults as row 1 | verify on account dashboard | verify on account dashboard | TODO: dashboard capture, date, owner |
| Anthropic vision for Telegram images | `LLMImage` blocks in `anthropicTurns`; private chats only; off until `STUDIO_IMAGES=1` (S12) | One minimized image plus its caption per turn; never retained in history | `core.conversation` | Code path present; ingestion off (flag not in base) | processor (to confirm in DPA) | `api.anthropic.com`; processing region: verify on account dashboard | As row 1 | verify on account dashboard | verify on account dashboard | TODO: dashboard capture, date, owner |
| OpenAI Images API (`gpt-image-1`, `OPENAI_IMAGE_MODEL`) | Avatar generation: `OpenAIMedia.generateAvatar` in `src/lib/studio/media.ts` | Prompt built by `avatarPrompt` from operator-entered persona role, presentation, avatarHint and look; no member messages | Operator agent setup (needs a purpose-map key) | Live in Studio when `OPENAI_API_KEY` is set | processor (to confirm in DPA) | `api.openai.com`; processing region: verify on account dashboard | Section 2.7: 30-day abuse-monitoring logs unless ZDR is approved | verify on account dashboard | verify on account dashboard | TODO: dashboard capture, date, owner |
| OpenAI Decisions API (`gpt-6-luna`) | Studio triage via `OpenAIMedia.decide` (persona header plus the last six chat lines, sent whenever `OPENAI_API_KEY` is set, unless `STUDIO_DECISIONS=off`); adaptive `DecisionService` via `OpenAIDecisionProvider.guarded` behind `STUDIO_DECISIONS_ENABLED=1`, which may include one low-detail image data URL (`input_image`); `prompt_cache_options` explicit with no breakpoints on the adaptive path | Persona header, recent chat lines, fixed questions; optionally one low-detail image | `core.conversation` (triage); adaptive path per its own purpose gate | Triage live in Studio; adaptive path off by default | processor (to confirm in DPA) | `api.openai.com`; EU residency available at +10%: verify on account dashboard | Section 2.7: 30-day abuse logs unless ZDR is approved; image inputs are exceptions to ZDR per docs/implementation/ARCHITECTURE.md | verify on account dashboard | verify on account dashboard | TODO: dashboard capture, date, owner |
| OpenAI Audio transcriptions (`gpt-4o-mini-transcribe`, `OPENAI_STT_MODEL`) | `OpenAIMedia.transcribe` via `StudioVoiceService` for Telegram voice notes; members only after the Step 0 stranger gate, never guests or `hasGuests` groups | Voice-note audio | `core.conversation` | Live in Studio when `OPENAI_API_KEY` is set | processor (to confirm in DPA) | `api.openai.com`; processing region: verify on account dashboard | Section 2.7: 30-day abuse logs unless ZDR is approved | verify on account dashboard | verify on account dashboard | TODO: dashboard capture, date, owner |
| ElevenLabs Speech-to-Text (Scribe `scribe_v1`, `ELEVENLABS_STT_MODEL`) | `ElevenLabsStudio.transcribe`, the fallback when OpenAI is missing or fails (diagnostic `transcription_fallback`); `ElevenLabsVoiceService` in `src/lib/tireh/voice.ts` (standalone runtime); legacy `/api/stt` | Voice-note or recorded audio | `core.conversation` | Live (fallback) in Studio; legacy and standalone paths | processor (to confirm in DPA) | `api.elevenlabs.io`; processing region: verify on account dashboard | Section 2.7: Zero Retention Mode is enterprise-only | verify on account dashboard | verify on account dashboard | TODO: dashboard capture, date, owner |
| ElevenLabs TTS (`ELEVENLABS_TTS_MODEL`, default `eleven_v4`), Voice Design (`eleven_ttv_v3`) and voice library | `ElevenLabsStudio.speak`, `designVoices`, `saveDesignedVoice`, `addLibraryVoice` | Reply text capped at 2,500 characters; operator-written voice descriptions | `core.conversation`; operator agent setup for voice design | Live in Studio when `ELEVENLABS_API_KEY` is set | processor (to confirm in DPA) | `api.elevenlabs.io`; processing region: verify on account dashboard | Section 2.7: Zero Retention Mode is enterprise-only | verify on account dashboard | verify on account dashboard | TODO: dashboard capture, date, owner |
| ElevenLabs Agents (Conversational AI) live calls | `createAgent`, `updateAgent`, `signedUrl` in `ElevenLabsStudio`; `custom_llm` points to `/api/studio/voice-llm` through a stored secret, with TTS `eleven_flash_v2_5` | Live-call audio, transcripts and agent responses pass through ElevenLabs; agent configuration and the server secret reference | `core.conversation` | Live in Studio for live calls | processor (to confirm in DPA) | `api.elevenlabs.io`; processing region: verify on account dashboard | Section 2.7: conversation data retained two years by default; Zero Retention Mode is enterprise-only | verify on account dashboard | verify on account dashboard | TODO: dashboard capture, date, owner |
| Google Gemini API via `GeminiLLM` (deprecated) | Only with `TIREH_LLM_PROVIDER=gemini` in the standalone TIREH runtime (`/api/tireh/telegram/[personaId]`) or `scripts/tireh-local.ts`; never in Studio | Chat text, replayed history and memories for the standalone personas | `core.conversation` | Deprecated; off unless that env is set | processor (to confirm in DPA) | `generativelanguage.googleapis.com`; processing region: verify on account dashboard | Not covered by section 2.7: verify on account dashboard | verify on account dashboard | verify on account dashboard | TODO: dashboard capture, date, owner |

- Not yet listed: processors used only by routes outside /api/studio (OpenAI chat completions in /api/chat and /api/translate, DeepSeek, Google Gemini in /api/chat, /api/chat/stream and /api/memory/extract, ElevenLabs voice cloning in /api/clone-voice), plus Stripe, Telegram, Firebase/Google Cloud and Sentry. Add rows for any route kept per [ROUTE_INVENTORY.md](ROUTE_INVENTORY.md).
- Sanctions and provider-terms review (AGENT_INTELLIGENCE_SOLUTION.md section 7) applies to every row; record counsel's view here.

## 4. Consent ledger and enforcement

**PRIV-010 — Server authority.** A server-owned ledger governs optional collection and use; a browser preference is only a request. The ledger represents **permission to process**, not permission to view somebody else's memory. Account authentication, verified-person context, audience authorization, purpose permission, jurisdiction status and provider eligibility must all pass.

Proposed ledger fields:

```text
consent_event_id, subject_person_id, authenticated_actor_account_id
controller_entity_id, tenant_id, space_id, device_scope, agent_scope
purpose_id, purpose_version, data_category_ids, recipient_config_version
notice_id, notice_version, rendered_copy_hash, locale, jurisdiction_policy_version
presented_at, decided_at_server, effective_at, expires_at
state, decision_method, explicit_statement_version, signed_release_reference
previous_event_id, idempotency_key, policy_epoch, source_channel
withdrawal_received_at, purge_job_id, minimal_evidence_expiry
```

Retain no sample audio in the ledger. A biometric written-release reference points to restricted consent evidence, not a voiceprint. Collect only proportionate proof; avoid storing full IP/device fingerprints as routine consent evidence. Consent evidence has its own justified retention term and access policy.

**PRIV-011 — State machine.** Keep permission and deletion jobs separate:

```text
NOT_ASKED -> PRESENTED -> GRANTED | DECLINED
GRANTED -> WITHDRAWN | EXPIRED | RECONSENT_REQUIRED | SUSPENDED
WITHDRAWN | EXPIRED | RECONSENT_REQUIRED | SUSPENDED -> PRESENTED -> GRANTED | DECLINED
DECLINED -> PRESENTED only on a deliberate user/settings action or justified new purpose

Deletion: NOT_REQUIRED | QUEUED -> PURGING -> COMPLETED | PARTIAL_FAILURE
                                             PARTIAL_FAILURE -> PURGING
```

Only `GRANTED`, unexpired, current-version permission allows the optional operation. `PRESENTED` is not permission. Dismissal, no answer, locale/copy-loading failure, offline enrollment or ledger error means off. `SUSPENDED` supports risk/admin intervention without recording a fictitious user withdrawal. A notice typo need not invalidate existing consent; a material purpose/data/recipient/use expansion must be assessed and, when new consent is required, blocked until obtained. Never backdate permission to cover earlier capture.

**PRIV-012 — Atomic grant.** Write immutable consent evidence and current permission with a monotonic subject-purpose epoch in one durable transaction before starting optional processing. If a grant cannot be committed, keep the feature off. Duplicate or reordered requests must converge without overriding a later withdrawal. Material expansion creates a new purpose/version, not a silent edit of an old grant.

**PRIV-013 — Revocation propagation.** Acknowledge withdrawal only after the authoritative state is durably disabled and invalidation is issued. Local UI immediately stops new optional capture while the request is sent. In-flight workers recheck epoch before provider transmission, durable writes and delivery; short-lived authorization leases and cancellation stop streams when invalidated. If the server cannot be reached, say withdrawal synchronization is pending, stop this device's optional work and do not falsely claim global completion. Other devices must fail closed when leases expire. Already transmitted/delivered material cannot be recalled.

**PRIV-014 — Pending work and derivatives.** Consent/grant invalidation suppresses stale extraction jobs, retries, predictions, summaries, vectors, exports and notification candidates. Every job carries source IDs, scope, purpose/version and policy epoch; workers recheck current state. Tombstones survive replay/restore for the justified prevention period. Restrict or delete derived records according to their lineage and the purpose being withdrawn; do not indiscriminately erase separately justified legal/security records.

**PRIV-015 — Meaning of withdrawal.** Disabling personalization stops future inference/use for that optional purpose; offer deletion of earlier inferred preferences alongside it. Disabling biometric recognition stops matching and initiates template/enrollment deletion. Consent withdrawal does not retroactively invalidate prior lawful processing. Explain any independently justified retained record and its period. Prevent future training use; first release avoids irrevocable shared-model ingestion in the first place.

**PRIV-016 — Settings and receipts.** “Privacy and memory” shows each purpose, current state, scope, last change, data saved, processors/detail link, and one-step off control of equal accessibility to on. Show grant/withdrawal receipts without exposing the biometric or private content. Allow independent per-space choices; a private person must authenticate again before editing sensitive choices on a shared device.

## 5. Voice recognition and multi-speaker safety

**PRIV-017 — No identity from similarity alone.** Retain account identity, temporary speaker segment, claimed person and verified person as distinct fields. Voice/style estimates can suggest a speaker label inside an already authorized context; they must never unlock private memory, confirm account ownership, authorize sharing/payment/tool actions, silently link accounts or promote a guessed speaker to verified identity. Require authenticated person selection or another approved factor and the ordinary audience policy. Do not run open-ended cross-tenant identity searches or disclose candidate names from a global identity search. Constrain eligible references by verified scope before any comparison.

**PRIV-018 — Enrollment sequence.** First verify account/person and eligible jurisdiction. Present voiceprint purpose, processing location, devices/agents, recipients, sample/template retention, deletion and the equivalent alternative. Capture a separate explicit statement/written release with approved electronic execution where needed. Only then activate a bounded sample-capture session, with visible state and cancel. Bind the resulting template to that verified person and scope. Reject/erase failed, abandoned or mixed-speaker enrollment samples; do not enroll from past calls, public media, third-party uploads or ordinary microphone permission.

**PRIV-019 — Local-first recognition.** Evaluate user-initiated on-device generation, storage and matching as the preferred architecture. The browser/Telegram/device feasibility remains to be proven. If feasible local isolation cannot be delivered, keep recognition off until a reviewed cloud architecture justifies the departure from EDPB's recommendation, demonstrates vendor/disclosure eligibility in each jurisdiction, and has truthful copy. Templates must not automatically propagate to every device/person using the same account. [S1](#s1-voice-assistants)

**PRIV-020 — No comparison before permission.** Checking whether an unknown speaker matches someone is itself processing. Do not extract a biometric query template for a nonconsenting guest “just to see.” Use explicit single-person identification sessions or a channel that isolates consented audio. For a mixed stream that cannot isolate eligible participants before biometric processing, disable biometric matching for the entire stream. Speaker diarization must remain temporary and non-identifying unless separately approved; review the actual provider's intermediate embeddings and reuse.

**PRIV-021 — Robustness and abstention.** Validate false accept/reject and unknown-speaker cases separately on EN/FA, accents, mixed languages, microphones/noise, illness, aging, replay and synthesized/cloned speech using authorized evaluation data. Set thresholds from measured risk; retain an “unknown” result and accessible manual route. No claim that short samples, liveness detection or confidence scores make recognition infallible. No false acceptance may grant additional permissions, even in tests.

**PRIV-022 — Shared devices/accounts.** Consent belongs to a person, not everyone who knows an account password. Shared-account sessions default to unverified speaker labels and no private-memory retrieval until person selection is verified. A workspace owner can configure service policy but cannot enroll or consent for all members. Recognition cannot switch a Work conversation into a person's Personal space. On logout, revoke device leases and erase local samples/templates according to explicit device policy.

**PRIV-023 — Multi-party notice and choice.** Every participant must receive understandable AI/audio-processing notice before capture; obtain any required recording/interception permission before their audio enters the provider path. Host clicks, an existing Telegram group membership, a visible bot, speaking after a banner, or a single recorded “yes” do not automatically establish sufficient permission for everyone. Give guests a no-account notice/decision route and keep proof per participant/session. Anyone can stop optional processing. A new/unknown participant pauses the affected capture/output until the audience and permissions are resolved. If that cannot be enforced, do not ship mixed-group audio in that jurisdiction.

**PRIV-024 — Audience and bystanders.** Apply the memory strategy's audience rule to history, directories, profiles, predictions, model prompts, tools and output, including `hasGuests` and silent members. If someone joins or moves to speakerphone, cancel restricted generation and rebuild. Ask for a private confirmed channel before speaking private material. Do not promise to detect every physical bystander. Accidental audio without a valid purpose/basis is suppressed and erased through the incident workflow; do not retain it to improve speaker matching.

**PRIV-025 — Recognition is not cloning.** Speaker recognition compares characteristics; voice cloning creates speech resembling a person. The recognition release authorizes neither cloning nor using the voice for TTS training. Use disclosed licensed synthetic voices in first release. Any later clone feature requires a separate identity/rights/abuse review and consent flow; an export must preserve applicable synthetic-content labeling.

## 6. Personalization, prediction and notifications

**PRIV-026 — Bounded predictions.** Treat predictions as revisable hypotheses with source, purpose, expiry and scope. Partial transcripts may support authorized read-only prefetch for the requested task. They must not commit durable preferences, send messages, enroll marketing, publish memories or trigger external actions. Discard stale turn/revision results and recheck policy before use. Changes in wording must never expand authority.

**PRIV-027 — No hidden sensitive profiling.** Do not derive health, religion, politics, sexual orientation, vulnerability, personality/emotion scores or employment performance from voice/interaction style in this release. A disclosed sensitive fact still needs an appropriate handling/basis policy; optional personalization is not blanket explicit consent for every sensitive use. Keep reminders based on facts the person deliberately supplies separate from health inference. Block prohibited biometric categorisation and workplace/education emotion inference independently of user toggles. [S6](#s6-ai-act-prohibitions-and-definitions)

**PRIV-028 — Explainable adaptation.** A person can inspect “Vox suggested shorter answers because you selected brief mode,” edit/delete it and reset adaptation. An interruption alone is not evidence of frustration. Do not optimize manipulative engagement, predict sensitive traits or use personal behavior for employment, credit, insurance or similarly consequential automated decisions. A later significant-decision feature needs a new legal/product review, including GDPR Article 22 and applicable US rules. [S14](#s14-rights-and-notices)

**PRIV-029 — Notification categories.** Separate required service/security notices, explicitly requested reminders, proactive suggestions and promotions. A due reminder has a named destination, time/timezone, deduplication key and expiry; its permission does not authorize general suggestions. User controls include per-channel off, quiet hours, frequency cap, snooze, “why this,” and cancel. External notification payloads contain generic text and an opaque reference rather than private memory/transcript content; there is no private content-bearing exception in this release. Detailed content appears per recipient in the authenticated inbox after current authorization; opening reauthenticates and checks audience.

**PRIV-030 — Marketing and channels.** Request push/Telegram/email marketing choices individually; never reuse a requested reminder grant or an OS allow response as marketing consent. Review national ePrivacy/direct-marketing rules and US channel rules before enabling promotional push or other channels. Push's precise treatment depends on country/channel/implementation; there is no universal claim that it is exempt or that all push needs GDPR consent. For this product, promotions remain off absent specific opt-in, with immediate preference suppression and a clear channel-specific stop. Transactional/security messages must not carry promotional additions. [S4](#s4-eprivacy), [S15](#s15-communications-guidance)

**PRIV-031 — Delivery recheck.** Notification workers check purpose state, current memory/source authority, recipient, channel, quiet hours and freshness immediately before delivery. Delete/revoke cancels queued and speculative notifications. Push permission revoked at OS/browser level means unavailable; do not repeatedly request it. Do not expose private information in notification titles, analytics delivery receipts or shared-device history. Provider acceptance is not evidence that a person saw/heard a message.

## 7. Retention, rights and accountability

**PRIV-032 — Retention schedule.** Approve actual numeric periods and propagation SLAs before enabling each category. The table below is a **starting engineering target for review**, not a public promise or a statutory safe harbor. Apply a shorter applicable legal/contractual requirement; a legal maximum is not a recommended default. Evidence holds require a specific lawful reason, limited access and review date, without continued feature use.

| Data class | Proposed starting target | Required separation/proof |
|---|---|---|
| Raw audio for ordinary turn | No saved recording by default. Application processing buffers only where possible; remove application working copies after completed/failed processing; hard transient TTL target 1 hour | Provider residual/abuse retention is a separate, verified schedule and may be longer; disclose and assess before launch; no “never stored” or universal 1-hour deletion claim |
| Partial transcript/speculative context | Session-lifetime; hard abandoned-session TTL target 24 hours | No persistent diagnostic/retry copy; final saved history is a separate choice |
| Durable chat history | User-visible retention choice; proposed initial 30-day rolling default, with temporary mode | Confirm product decision and vendor behavior; no inference that forgetting memory erases chat |
| Preferences and authorized memory | Until user removes, purpose ends, or review/expiry rule; proposed 180-day reconfirmation of inferred preferences | Deletion covers projections, vectors, summaries and authorized caches |
| Enrollment raw sample | Delete after template creation or cancellation; target no later than 1 hour | Voiceprint has a separate store, purpose and schedule |
| Reference voiceprint | Until withdrawal, purpose expiry or approved inactivity limit; proposed 180-day inactivity deletion | Immediately deny matching on withdrawal; online purge target 24 hours; all copies bounded and verified |
| Live query template | One recognition attempt; no archive | Do not place embeddings in generic tracing, analytics or queues |
| Optional event-level analytics | Proposed 30 days; only genuinely anonymous aggregates may remain longer under an approved anonymization assessment | Small cohorts/rare combinations are not automatically anonymous |
| Security/reliability metadata | Proposed 30 days, longer for scoped incident records with a justified schedule | No raw content by default; independent basis and access controls |
| Human-donated quality case | Case-level disclosed end date; proposed 30 days | No automatic training or general prompt/PR export |
| Consent/release and deletion evidence | Period established by legal necessity/limitation analysis; currently unresolved | Minimal evidence, separate from source content/template |
| Backups and provider residuals | Proposed backup expiry cap 30 days, subject to infrastructure feasibility | Restore applies tombstones before reads; report provider pending/failure and actual expiry |

**PRIV-033 — Deletion orchestration.** Suppress immediately, then purge primary stores, object storage, local device stores, source messages where eligible, caches, vectors, graph links, profile summaries, speculative artifacts, queues/dead letters, notification candidates, reviewer datasets and provider copies. Produce per-system acknowledgements; retry failures and notify the privacy operator. Distinguish `blocked from use`, `online purge completed`, `provider pending` and `backup expiry pending`. Never display “all copies deleted” when only one database row was removed.

**PRIV-034 — Rights workflow.** Provide access/export, correction, erasure, restriction, objection, consent withdrawal and applicable portability through accessible EN/FA routes, with request tracking and jurisdiction deadlines. Verify the requester proportionately without voice biometrics or collecting excessive identity evidence. Protect other people's data in multi-party exports; ownership of a workspace does not authorize exporting another person's private memory. Support requests from non-account guests. Apply California and other US rights only as legally applicable while offering consistent core controls to all users. [S14](#s14-rights-and-notices), [S10](#s10-california)

**PRIV-035 — Organizational controls.** Complete a DPIA before pilot collection for the combined observation/memory/biometric design and document residual risk, necessity, alternatives, safeguards and consultation requirements. Perform security/abuse review, vendor agreements/transfer assessments, role-based support access and breach-response exercises. Separate observer/optimizer/developer credentials from consent, raw private evidence and release controls. The improvement service cannot rewrite legal policy, grant itself data access, or publish private examples in code/issues/prompts. Use synthetic reproductions first.

**PRIV-036 — Accurate notices.** Publish a layered notice, short first-use summary and per-feature just-in-time explanation in EN and FA. Name who receives data, who decides purposes and whether human review occurs. Avoid absolute statements such as “completely anonymous,” “only on device,” “no audio is stored” or “fully compliant” unless the precise claim has current supporting evidence.

## 8. EN/FA draft just-in-time copy

All copy is **draft pending verified data flows and qualified legal/native-language review**. Render FA with correct RTL, keyboard/focus order, screen-reader labels and isolated LTR names/IDs. Equal decline means comparable size, contrast, placement and effort. Do not obscure decline behind “manage.” Both languages must express the same purpose/scope and maintain the same versioned identifiers. Variables in braces must resolve to verified launch facts; unresolved variables block that flow.

### UX-01 — First interaction: disclosure, not consent (`PRIV-002`, `PRIV-036`)

**EN:** “You’re talking with Vox, an AI assistant operated by Joyixir OÜ. It can make mistakes. Vox processes the messages you send to answer you. Optional memory, personalization and usage analytics are off until you choose them. [How your data is used]” Action: **Continue**. No “I consent to the privacy policy” checkbox.

**FA:** «شما با Vox، یک دستیار هوش مصنوعی از Joyixir OÜ، گفتگو می‌کنید. ممکن است پاسخ‌های آن اشتباه باشد. Vox پیام‌هایی را که می‌فرستید پردازش می‌کند تا به شما پاسخ دهد. حافظهٔ اختیاری، شخصی‌سازی و تحلیل استفاده تا زمانی که خودتان فعالشان نکنید، خاموش هستند. [داده‌های شما چگونه استفاده می‌شوند]» دکمه: **ادامه**.

This summary must link to the approved core basis/history/provider notice; it cannot substitute for it.

### UX-02 — Before microphone capture (`PRIV-018`, `PRIV-023`)

**EN:** “Use your microphone for this conversation? Your audio will be sent to {audio_providers} in {processing_locations} to transcribe and answer your request. {verified_audio_retention_summary} This does not turn on voice recognition.” Actions: **Use microphone** / **Use text**. Then show the OS permission prompt only after the first action.

**FA:** «برای این گفتگو از میکروفون استفاده می‌کنید؟ صدای شما برای تبدیل به متن و پاسخ به درخواستتان به {audio_providers} در {processing_locations} فرستاده می‌شود. {verified_audio_retention_summary_fa} با این کار، شناسایی گوینده از روی صدا فعال نمی‌شود.» دکمه‌ها: **استفاده از میکروفون** / **استفاده از متن**.

### UX-03 — Optional usage analytics (`PRIV-007`, `PRIV-008`)

**EN:** “Help improve Vox with usage analytics? Share feature-use events and performance measurements with {analytics_recipient}. This option excludes message text, recordings and voiceprints. Keep using Vox if you decline. Change this anytime in Privacy and memory.” Actions: **Allow usage analytics** / **No thanks**. Default: off.

**FA:** «با تحلیل استفاده به بهتر شدن Vox کمک می‌کنید؟ رویدادهای استفاده از قابلیت‌ها و اندازه‌گیری عملکرد با {analytics_recipient} به اشتراک گذاشته می‌شود. این گزینه شامل متن پیام‌ها، صدای ضبط‌شده یا الگوی زیست‌سنجی صدا نمی‌شود. اگر نپذیرید، همچنان می‌توانید از Vox استفاده کنید. هر زمان می‌توانید این انتخاب را در «حریم خصوصی و حافظه» تغییر دهید.» دکمه‌ها: **اجازهٔ تحلیل استفاده** / **نه، ممنون**. پیش‌فرض: خاموش.

### UX-04 — Personal adaptation (`PRIV-026`, `PRIV-028`)

**EN:** “Adapt Vox to you in {space_name}? Vox can use your interaction patterns to suggest preferences, such as shorter replies. Suggestions may be wrong; you can review, change or delete them. This does not share your preferences with other people.” Actions: **Turn on personalization** / **Keep it off**.

**FA:** «Vox را در {space_name} برای شما شخصی‌سازی کنیم؟ Vox می‌تواند از الگوهای تعامل شما برای پیشنهاد ترجیحاتی مانند پاسخ کوتاه‌تر استفاده کند. این پیشنهادها ممکن است اشتباه باشند؛ می‌توانید آن‌ها را ببینید، تغییر دهید یا حذف کنید. با این کار، ترجیحات شما با دیگران به اشتراک گذاشته نمی‌شود.» دکمه‌ها: **فعال کردن شخصی‌سازی** / **خاموش بماند**.

### UX-05 — Automatic memory (`PRIV-007`)

**EN:** “Remember useful details automatically in {space_name}? Vox will suggest and save eligible preferences and commitments from your conversations for future chats with {agent_names}. You can inspect and delete memories. Saved chat history has separate controls.” Actions: **Turn on automatic memory** / **Keep it off**.

**FA:** «جزئیات مفید در {space_name} به‌طور خودکار به خاطر سپرده شوند؟ Vox می‌تواند ترجیحات و تعهدات مجاز را از گفتگوهای شما پیشنهاد و ذخیره کند تا در گفتگوهای بعدی با {agent_names} استفاده شوند. می‌توانید حافظه‌ها را ببینید و حذف کنید. سابقهٔ ذخیره‌شدهٔ گفتگو تنظیمات جداگانه‌ای دارد.» دکمه‌ها: **فعال کردن حافظهٔ خودکار** / **خاموش بماند**.

### UX-06 — Explicit save and audience (`PRIV-017`, `PRIV-024`)

**EN:** “Save ‘{exact_memory}’ for {person_name}, in {space_name}, for use by {agent_names}? Audience: {readable_recipient_list}. Keep until {retention_description}. Sharing it more widely needs a separate choice.” Actions: **Save this memory** / **Don’t save**. Sensitive/third-party facts receive the additional approved subject/sensitivity checks before this screen.

**FA:** ««{exact_memory}» برای {person_name} در {space_name} ذخیره شود تا {agent_names} از آن استفاده کنند؟ مخاطبان: {readable_recipient_list}. مدت نگهداری: {retention_description_fa}. اشتراک‌گذاری با افراد بیشتر به انتخاب جداگانه نیاز دارد.» دکمه‌ها: **ذخیرهٔ این حافظه** / **ذخیره نشود**.

### UX-07 — Voiceprint enrollment (`PRIV-018`–`PRIV-022`)

**EN:** “Recognize your voice? Joyixir would create a biometric voiceprint from a short sample to help label you in {eligible_scope}. Matching can be wrong and will not unlock private data or authorize actions. The sample is processed by {recognition_processor} in {recognition_location} and deleted {sample_deletion_term}. Your voiceprint is stored {template_location}, accessible to {template_recipients}, and deleted {template_deletion_term}. This does not clone your voice. You can turn recognition off and request deletion anytime in Privacy and memory. You can use person selection instead.”

Separate unchecked statement: **“I explicitly consent to Joyixir collecting, storing and using my voice sample and biometric voiceprint for the speaker-recognition purpose, scope, recipients and periods shown above.”** Actions: **Enroll my voice** / **Use person selection**. Where a signed written release is required, add the legally approved electronic execution step; a checkbox alone is not assumed sufficient.

**FA:** «صدای شما را شناسایی کنیم؟ Joyixir از یک نمونهٔ کوتاه، الگوی زیست‌سنجی صدای شما را می‌سازد تا در {eligible_scope} به تشخیص برچسب گوینده کمک کند. تطبیق صدا ممکن است اشتباه باشد و دسترسی به داده‌های خصوصی یا اجازهٔ انجام کارها را ایجاد نمی‌کند. نمونهٔ صدا را {recognition_processor} در {recognition_location} پردازش می‌کند و {sample_deletion_term_fa} حذف می‌شود. الگوی صدا در {template_location} نگهداری می‌شود، {template_recipients} به آن دسترسی دارند و {template_deletion_term_fa} حذف می‌شود. با این کار، صدای شما شبیه‌سازی نمی‌شود. هر زمان می‌توانید شناسایی صدا را خاموش کنید و در «حریم خصوصی و حافظه» درخواست حذف بدهید. می‌توانید به‌جای آن، شخص را به‌صورت دستی انتخاب کنید.»

تأیید جداگانه و بدون تیک پیش‌فرض: **«صریحاً رضایت می‌دهم که Joyixir نمونهٔ صدا و الگوی زیست‌سنجی صدای من را برای هدف شناسایی گوینده، در محدوده، با دریافت‌کنندگان و برای مدت‌های توضیح‌داده‌شده در بالا جمع‌آوری، نگهداری و استفاده کند.»** دکمه‌ها: **ثبت الگوی صدای من** / **انتخاب دستی شخص**.

### UX-08 — Turn recognition off (`PRIV-013`, `PRIV-015`, `PRIV-033`)

**EN:** “Voice recognition is off. New matching has stopped. Voiceprint deletion: {deletion_status}. {verified_remaining_copy_and_expiry_summary} Your conversations and saved memories have separate controls.” Link: **View deletion progress**.

**FA:** «شناسایی صدا خاموش است. تطبیق جدید صدا متوقف شده است. وضعیت حذف الگوی صدا: {deletion_status_fa}. {verified_remaining_copy_and_expiry_summary_fa} گفتگوها و حافظه‌های ذخیره‌شده تنظیمات جداگانه‌ای دارند.» پیوند: **دیدن روند حذف**.

Offline variant EN: “Recognition stopped on this device. Your account change is waiting to sync.” FA: «شناسایی صدا در این دستگاه متوقف شد. تغییر تنظیمات حساب شما در انتظار همگام‌سازی است.»

### UX-09 — Group audio participant gate (`PRIV-023`)

**EN:** “Vox is an AI participant. This session would send everyone’s audio to {providers} for {session_purposes}. {session_retention_summary} Optional voice recognition is {recognition_state}. Each person must choose before processing starts. You may continue in text without audio processing.” Actions per participant: **Agree to this session’s audio processing** / **Continue in text**. Do not activate capture until the approved session gate is satisfied.

**FA:** «Vox یک شرکت‌کنندهٔ هوش مصنوعی است. در این جلسه، صدای همه برای {session_purposes_fa} به {providers} فرستاده می‌شود. {session_retention_summary_fa} شناسایی اختیاری صدا {recognition_state_fa} است. هر فرد باید پیش از شروع پردازش انتخاب کند. می‌توانید بدون پردازش صدا، گفتگو را به‌صورت متنی ادامه دهید.» دکمه‌ها برای هر فرد: **موافقت با پردازش صدای این جلسه** / **ادامه با متن**.

Joining warning EN: “Audio processing is paused while a new participant reviews the session.” FA: «پردازش صدا تا بررسی شرایط جلسه توسط شرکت‌کنندهٔ جدید متوقف است.» This is a gate draft, not a claim that this wording alone satisfies every recording statute.

### UX-10 — Requested reminder (`PRIV-029`, `PRIV-031`)

**EN:** “Remind you about {user_supplied_task} at {local_time_and_timezone} through {channel}? Preview: {generic_preview}. This allows this reminder; it does not enable promotions.” Actions: **Create reminder** / **Cancel**. After selection, request OS permission if needed; if denied, offer an in-app reminder or explicit alternate channel.

**FA:** «دربارهٔ {user_supplied_task} در {local_time_and_timezone} از طریق {channel} یادآوری شود؟ پیش‌نمایش: {generic_preview_fa}. این انتخاب فقط برای همین یادآوری است و پیام‌های تبلیغاتی را فعال نمی‌کند.» دکمه‌ها: **ساخت یادآوری** / **لغو**.

### UX-11 — Proactive suggestions (`PRIV-029`)

**EN:** “Allow occasional suggestions in {space_name}? Vox may use memories and preferences you allow to suggest useful next steps through {channel}. You can see why, dismiss them, set quiet hours or turn them off.” Actions: **Allow suggestions** / **Keep them off**. Show a proposed frequency cap before granting.

**FA:** «پیشنهادهای گاه‌به‌گاه در {space_name} فعال شوند؟ Vox می‌تواند از حافظه‌ها و ترجیحاتی که اجازه داده‌اید استفاده کند تا از طریق {channel} گام‌های بعدی مفید را پیشنهاد دهد. می‌توانید دلیل هر پیشنهاد را ببینید، آن را رد کنید، ساعات سکوت تعیین کنید یا پیشنهادها را خاموش کنید.» دکمه‌ها: **اجازهٔ پیشنهادها** / **خاموش بمانند**. سقف تعداد پیشنهادی پیش از انتخاب نمایش داده شود.

### UX-12 — Marketing channel (`PRIV-030`; future design only)

Do not render this flow or enable marketing enrollment in the initial release. This draft records the separation required if a later release includes promotions.

**EN:** “Receive Vox news and offers from Joyixir by {one_channel}? This is optional and separate from reminders and security messages. You can stop anytime through {channel_stop_control} or Privacy and memory.” Actions: **Allow {channel} offers** / **No thanks**. Separate choice for every channel.

**FA:** «خبرها و پیشنهادهای تبلیغاتی Vox را از Joyixir از طریق {one_channel} دریافت می‌کنید؟ این گزینه اختیاری و از یادآوری‌ها و پیام‌های امنیتی جداست. هر زمان می‌توانید از طریق {channel_stop_control_fa} یا «حریم خصوصی و حافظه» آن را متوقف کنید.» دکمه‌ها: **اجازهٔ پیشنهادها از طریق {channel}** / **نه، ممنون**.

### UX-13 — Review a suggested preference (`PRIV-028`)

**EN:** “Would you like shorter spoken replies? This is a suggestion based on {non_sensitive_visible_reason}; it may be wrong.” Actions: **Use shorter replies** / **Keep current style**. Link: **See or reset preferences**.

**FA:** «پاسخ‌های صوتی کوتاه‌تر را ترجیح می‌دهید؟ این پیشنهاد بر اساس {non_sensitive_visible_reason_fa} است و ممکن است درست نباشد.» دکمه‌ها: **پاسخ‌های کوتاه‌تر** / **حفظ شیوهٔ فعلی**. پیوند: **دیدن یا بازنشانی ترجیحات**.

### UX-14 — Donate a specific quality case (`PRIV-009`, `PRIV-035`)

**EN:** “Share this selected conversation to investigate {issue}? {reviewer_team} may review {exact_data_types} until {case_end_date}. Review the selection first. This does not authorize other conversations, biometric enrollment or model training.” Actions: **Review and share selection** / **Don’t share**. A final reviewed selection confirmation is required before export.

**FA:** «این گفتگوی انتخاب‌شده را برای بررسی {issue} به اشتراک می‌گذارید؟ {reviewer_team} می‌تواند {exact_data_types_fa} را تا {case_end_date} بررسی کند. ابتدا بخش انتخاب‌شده را ببینید. این انتخاب اجازهٔ استفاده از گفتگوهای دیگر، ثبت الگوی زیست‌سنجی صدا یا آموزش مدل را نمی‌دهد.» دکمه‌ها: **بررسی و اشتراک بخش انتخاب‌شده** / **به اشتراک گذاشته نشود**.

### UX-15 — Deletion status and contact (`PRIV-033`, `PRIV-034`)

**EN:** “Your selected data is blocked from further use. Deleted from: {completed_systems}. Still pending: {pending_systems_and_dates}. We’ll show completion here. Contact info@joyixir.com about this request.” Only use a completion variant after all applicable acknowledgements; explain any lawfully retained exception specifically.

**FA:** «استفادهٔ بیشتر از داده‌های انتخاب‌شدهٔ شما مسدود شده است. حذف‌شده از: {completed_systems}. در انتظار حذف: {pending_systems_and_dates}. تکمیل حذف در همین‌جا نمایش داده می‌شود. برای پیگیری این درخواست با info@joyixir.com تماس بگیرید.»

## 9. Privacy notice publication checklist

**PRIV-037 — Publish only after factual verification.** The full EN/FA notice and any required US state supplement must cover:

- User-confirmed legal entity **Joyixir OÜ**, postal address, effective date/version, privacy contact (user-confirmed: **info@joyixir.com**; mailbox operation and legal approval remain unverified), applicable representative and DPO contact if required. The registered address is recorded in [operator details](OPERATOR_DETAILS.md); the complete controller notice still needs legal approval.
- Actual controller/processor or joint-controller role for consumer, Work and guest/group flows; who determines purposes and who handles rights. Workspace owners' administrative access and its limits.
- Collected and inferred categories, source (direct, connector, participant, model), purpose-by-purpose basis and any special-category condition; legitimate interests identified where used. Required fields, consequences of refusal, optional choices and consent withdrawal.
- Microphone/audio transport, transcripts, saved history, temporary mode, memories, predictions, templates, matching, provider-generated intermediates and notification tokens described separately; no implication all voices are enrolled.
- Named recipients/categories and processor register, countries, safeguards/transfer mechanism, subprocessors and authorized human access. No automatic claim that EU hosting prevents remote foreign access.
- Category-specific retention periods or meaningful criteria, inactivity, enrollment cancellation, provider residuals, backups, deletion limitations and legal holds.
- How to inspect/correct/delete memories and inferred preferences, export eligible data, object/restrict, withdraw consent, complain to the competent authority and use applicable US appeal/authorized-agent/opt-out routes.
- Profiling/prediction logic in understandable terms, input sources, consequences and uncertainty; actual status of any significant automated decision. No invented model accuracy or legal-compliance guarantee.
- Sharing recipients/history rules, third-party data responsibilities, guest/multi-party choice, bystander limitations and what external delivered copies cannot be recalled.
- Adults-only scope and incidental minor handling; how material purpose changes are communicated and when new consent is obtained.
- Accurate sale/share/targeted-advertising and sensitive-use disclosures, applicable opt-out signals such as GPC, and state-specific rights if the business is covered; no sale/sharing claims until actual SDK/vendor contracts and data flows are audited.
- Public biometric retention/destruction policy where applicable; the legally approved release text and the no-biometric alternative. Separate policies for any future cloning or training use.

This checklist is an implementation inventory; qualified review must map it to current GDPR Articles 12–14 and applicable US disclosure rules. [S14](#s14-rights-and-notices), [S10](#s10-california)

## 10. Acceptance evidence and launch decisions

**PRIV-038 — Required synthetic acceptance cases.** Run against the exact candidate/configuration with provider mocks plus separately authorized vendor test accounts. No real biometric samples or private conversations are required to start implementation.

| Acceptance ID | Requirements | Pass evidence |
|---|---|---|
| PVT-01 Defaults/decline | 001–008, 036 | Fresh EN/FA account uses core text/call with optional features off; network/storage inspection shows no optional SDK export before opt-in; equal decline path works with keyboard/screen reader |
| PVT-02 Purpose isolation | 006–012 | Grant analytics only; attempts to save automatic memory, enroll template, donate audio, train or market are denied server-side; forged client toggles fail |
| PVT-03 Concurrent withdrawal | 010–015 | Withdrawal races partial audio, provider dispatch, retry and stream output; later epochs win; no new optional dispatch/write after invalidation; offline status remains truthful |
| PVT-04 Replay/restore | 014, 033 | Dead letters, old extraction jobs and backup restore cannot recreate removed templates/preferences or emit cancelled notifications |
| PVT-05 Enrollment | 017–022 | No template/query creation before consent/release commit; wrong person/mixed audio/cancelled enrollment purges; local/cloud locations match approved notice |
| PVT-06 Guests and shared account | 017, 020–024 | Unknown/silent/new guest cannot access private directory/history/predictions; no matching on unconsented mixed stream; account owner cannot impersonate another speaker |
| PVT-07 Spoof/abstention | 017, 021, 025 | Authorized synthetic/replay cases can yield unknown; false match never grants permissions; no implicit voice cloning endpoint enabled |
| PVT-08 Memory and predictions | 007, 014, 026–028 | Partial transcript never commits action/preference; sensitive inferred tags rejected; changing audience cancels restricted output; preference reset is inspectable |
| PVT-09 Notifications | 029–031 | Reminder does not enable offers; marketing opt-out suppresses queue; source revocation/quiet hours checked at send; generic lockscreen payload; denied OS permission is handled |
| PVT-10 End-to-end deletion | 009, 032–034 | Per-store/provider deletion acknowledgements, residual/backup dates and restricted minimal evidence match UI; injected provider failure reports pending and retries |
| PVT-11 Rights and copies | 016, 034, 037 | Account and guest requests tracked; verified export excludes other people's private data; deletion/correction/objection reach derivatives |
| PVT-12 Jurisdiction and policy | 004–006, 019, 035–039 | Illinois/Texas/unknown-region recognition denied without valid registry approval; expired policy blocked; prohibited emotion/category paths denied regardless of consent |
| PVT-13 Private canaries | 008, 009, 024, 035 | Seed private synthetic strings and embeddings in protected fixtures; assert absence from unauthorized/shared analytics, generic logs, optimizer datasets, prompts, issues and external notification payloads. Protected synthetic fixtures and authorized private-context prompt tests may contain their scoped canaries |
| PVT-14 Bilingual parity | 016, 036–037 | Both locales render full scope/recipients/retention and equal controls; missing variables block grants; receipts preserve the exact presented version/hash |

The cases establish engineering evidence, not a claim that unlawful processing is impossible. Recognition accuracy/bias evaluation needs a separately authorized and representative dataset before real recognition rollout.

**PRIV-039 — Unresolved launch blockers and owners.** Planning can proceed; the affected feature must not collect real data until its blocker closes.

| Decision | Proposed accountable owner | Required artifact |
|---|---|---|
| Registered entity/address; verification of user-confirmed privacy email **info@joyixir.com**; exact market/state availability | Joyixir operator + counsel | Verified entity/contact block and geographic feature registry; user confirmation of the email alone does not close this gate |
| Consumer vs Work controller roles, requested-service basis and security interests | Privacy counsel + product owner | Processing register, role agreements and basis/necessity analysis |
| EU/EEA biometric/behavioral DPIA, EEA legal incorporation and national ePrivacy/recording details | Privacy lead + local counsel | Approved DPIA and country release decisions; supervisory consultation if legally required |
| US state inventory, BIPA signed release/public destruction policy, Texas vendor disclosures, California applicability, interstate call design | US privacy/communications counsel | State feature matrix, approved forms, public policy and specific recording architecture decision |
| Local recognition feasibility or justified cloud alternative | Security + voice engineering + privacy | Prototype with synthetic/authorized samples, threat model and documented storage/matching locations |
| Actual STT/LLM/TTS/analytics/push vendors, regions, training exceptions and transfers | Engineering + procurement/privacy | Config evidence, contracts, subprocessor/transfer inventory and deletion tests |
| Numeric retention, purge latency, backup cap and legally retained evidence | Privacy + SRE + data engineering | Tested schedule, job SLOs and truthful notice variables |
| AI Act provider/deployer role, biometric/remote use and risk classification, synthetic marking duties | AI governance counsel + product | Current amended-law assessment and provider responsibilities; no assumed high-risk exemption |
| Marketing channel/country/state rules, proactive notification boundaries | Product + counsel | Approved channel matrix and final copy |
| EN/FA legal and accessibility review | Legal + native Persian reviewer + design | Meaning-parity sign-off, rendered flows and accessibility results |

**PRIV-040 — Release evidence boundaries.** Track separately: source implementation, synthetic checks, legal approval, provider/account configuration, deployed revision and actual participant-facing behavior. Passing tests or approving a notice does not enable a market or prove provider deletion. Release each optional feature behind its own kill switch; exercises must prove collection stops as well as UI visibility. Rollback must handle data/consent schema migrations and previously generated derivatives.

## 11. Primary sources and currency notes

All links below were reviewed/retrieved on **19 October 2026**. Statutes can change and online databases can lag effective Acts. Product requirements above intentionally add controls beyond the short legal summaries. Recheck sources, effective dates and actual service facts before launch.

### S1. Voice assistants

[EDPB Guidelines 02/2021, final v2.0, adopted 7 July 2021](https://www.edpb.europa.eu/system/files/2021-07/edpb_guidelines_202102_on_vva_v2.0_adopted_en.pdf): sections 3.4.1–3.4.4, 3.6, 3.8.2 and 3.9; particularly paragraphs 81–90 and 127–137. Guidance, not a new statute. Source for distinction between ordinary voice requests, biometric identification, secondary purposes and local/user-initiated recognition recommendation.

### S2. Consent

[EDPB Guidelines 05/2020, v1.1, adopted 4 May 2020](https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_202005_consent_en.pdf): consent conditions, granularity, power imbalance, explicit consent, proof and withdrawal. Article 7 consent requires real choice, purpose specificity and withdrawal as easy as granting; a general product contract or privacy notice cannot substitute for it. Design details such as purpose epochs and fail-closed queue handling are Vox engineering proposals.

### S3. Lawful basis

[European Commission: legal grounds for processing data](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/legal-grounds-processing-data_en) and [GDPR official text, Articles 5, 6, 9, 25, 28, 32, 35 and Chapter V](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng). The Commission page was readable; EUR-Lex returned a robot-verification challenge during this review. Article-level references should be checked against the official current text in legal review; no claim of full consolidated-legislation verification is made here.

### S4. ePrivacy

[EDPB Guidelines 2/2023, final technical-scope guidance, publication 16 October 2024](https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-22023-technical-scope-art-53-eprivacy-directive_en) and [Directive 2002/58/EC official text](https://eur-lex.europa.eu/eli/dir/2002/58/oj/eng), especially Articles 5(3) and 13 as amended/transposed. The final guidance index was available via search; EUR-Lex readable text was challenged. Device-access scope and communications rules are distinct from downstream GDPR processing. The technical-scope guideline is not itself an exemption catalogue. Country/channel legal review remains mandatory.

### S5. AI Act transparency

[European Commission AI Act Service Desk: Article 50](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-50), displaying text based on the 27 July 2026 consolidation. See paragraphs 1–5 for direct interaction, machine-readable synthetic marking, emotion/categorisation and deepfake disclosures, including accessibility/timing. Evaluate Joyixir's provider/deployer role and upstream/downstream responsibilities; a chatbot label does not discharge every synthetic-output duty.

### S6. AI Act prohibitions and definitions

[European Commission Service Desk: Article 5](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-5), particularly paragraph 1(f)–(g), and [Article 3](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-3), definitions 34–43. Work/education emotion inference prohibition has narrow medical/safety exceptions; this plan does not invoke those exceptions. Biometric emotion recognition is legally distinct from ordinary semantic request interpretation.

### S7. Current AI Act timeline

[European Commission amended implementation timeline](https://ai-act-service-desk.ec.europa.eu/en/ai-act/timeline/timeline-implementation-eu-ai-act) and [Commission announcement: AI Omnibus enters into force, 27 July 2026](https://digital-strategy.ec.europa.eu/en/news/ai-omnibus-enters-force). The Service Desk links the [consolidated version as at 27 July 2026](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02024R1689-20260727) and [Omnibus official publication](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=OJ:L_202601744); EUR-Lex returned a robot challenge. Timeline statements here are grounded in current Commission pages, not unverified earlier deadline summaries.

### S8. Illinois

[Illinois General Assembly, 740 ILCS 14/15](https://www.ilga.gov/legislation/ilcs/fulltext?DocName=074000140K15) and [definitions, 740 ILCS 14/10](https://www.ilga.gov/legislation/ilcs/fulltext?DocName=074000140K10). Section 15 was readable in official indexed search; direct retrieval intermittently failed. Verify current definitions, effective amendments and release execution in final review. No claim that a generic online toggle alone meets BIPA is made.

### S9. Texas

[Texas Legislature, Business & Commerce Code §503.001](https://statutes.capitol.texas.gov/GetStatute.aspx?Code=BC&Value=503.001), including 2025 amendment effective 1 January 2026. Applicability/exceptions and disclosure limits are fact dependent. Do not equate a GDPR processor contract with automatic permission for a Texas biometric disclosure.

### S10. California

[CPPA current FAQ](https://www.cppa.ca.gov/faq.html), [updated monetary thresholds effective 1 January 2025](https://cppa.ca.gov/regulations/cpi_adjustment.html), [current laws/regulations index](https://cppa.ca.gov/regulations/) and [California Attorney General CCPA rights/notices overview](https://oag.ca.gov/privacy/ccpa). The index includes law/regulations effective 1 January 2026. Thresholds, effective dates and duties must be checked for the exact Joyixir entity and processing; California rights are not conditioned merely on being a paid subscriber.

### S11. Washington

[Washington Legislature, RCW 19.375](https://app.leg.wa.gov/RCW/default.aspx?cite=19.375&full=true), especially .010 and .020. Definition and exceptions differ from other states; a targeted opinion on the actual voice pipeline is necessary. This source does not cover every Washington health/general privacy requirement.

### S12. Recording and interception

[Florida Senate, 2026 §934.03](https://www.flsenate.gov/Laws/Statutes/2026/934.03), particularly (2)(d), and [California Legislature, Penal Code §632](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=632.&lawCode=PEN). Florida text was readable; California direct retrieval failed during this review, so the California provision is a targeted review pointer rather than a freshly verified full statutory analysis. Review federal law, other states, channel/provider role, participant location and exceptions with communications counsel.

### S13. FTC biometric policy

[FTC warning and policy statement summary, 18 May 2023](https://www.ftc.gov/news-events/news/press-releases/2023/05/ftc-warns-about-misuses-biometric-information-harm-consumers). Addresses possible unfair/deceptive practices, risk and vendor assessment and accuracy claims; it does not establish one nationwide biometric consent formula.

### S14. Rights and notices

[European Commission information for individuals](https://commission.europa.eu/law/law-topic/data-protection/information-individuals_en): rights, notice content and profiling/automated decision distinction. [GDPR official text](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng) remains controlling. The detailed checklist is a proposed product inventory to be mapped to the current law by qualified review.

### S15. Communications guidance

[CNIL electronic communications guidance, 10 June 2026](https://www.cnil.fr/fr/communication-electronique-quelles-regles) and [CNIL electronic direct marketing guidance, 10 June 2026](https://www.cnil.fr/fr/la-prospection-commerciale-par-courrier-electronique). These French authority sources distinguish transactional communication and marketing, with consent/limited customer exceptions. They do not determine every push implementation or every EU country's rules. Vox's proposed separate opt-in is a product default, not a universal statement of channel law.
