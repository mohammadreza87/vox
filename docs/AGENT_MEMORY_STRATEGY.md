# Vox: personal, group and shared agent memory

Research and source review: 19 October 2026. Source baseline: `ebb75a67c79bf317d1dec40381b216c75bb90ffa` on `codex/fix-studio-spawn`.

Status: proposed product and architecture; no application implementation or deployment is included. Local tests and source inspection do not establish production behavior. Provider availability, regional latency, configured model overrides and deployed database rules have not been verified against Vox's live account.

This research records the baseline above. Subsequent local implementation and remediation are tracked in [the implementation start record](implementation/STARTER_SLICE.md); source findings below are not a claim that every baseline issue remains unchanged.

## Product recommendation

Build a common memory service for Vox's agents, with separate Work and Personal spaces. Within each space support three independent containers:

1. **Private:** one person's memory, accessible to explicitly permitted agents.
2. **Group:** knowledge belonging to a particular group and its declared membership/history policy.
3. **Shared with selected people:** an exact named set of people, independent of any chat group. Each recipient can use this knowledge in their own authorized conversation.

For example, Reza can share a launch decision with Sara and Ali. All three can discuss it privately with an authorized agent. It does not become visible to the rest of HOOR, their other groups, or their Personal spaces. One agent talking to many people does not merge their private memories.

The desired experience is an agent that notices relevant context early, remembers accurate useful information, adapts naturally, and can explain who may know what. Reliability comes from context selection, provenance and permissions as much as model capability.

Most of this is feasible now. Consented voice recognition is feasible as an identification aid. Perfect identification from a short voice sample or writing style across unrelated accounts is not a reliable access mechanism. Prediction should prepare the conversation and remain revisable.

## Research conclusions

The most useful engineering direction is selective retrieval and compact working state, with durable memory maintenance outside the response path. Anthropic describes just-in-time context selection and structured notes; Letta documents background memory consolidation. These are patterns to adapt, not reasons to replace Vox's entire runtime. [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [Letta memory](https://docs.letta.com/configuration/memory).

Mem0 studies extraction and consolidation of salient memories. Graphiti provides temporal facts, source episodes and hybrid retrieval. Their published results do not predict Vox's accuracy, latency or cost. Use their architectural lessons, then compare on Vox conversations. [Mem0 paper](https://arxiv.org/abs/2504.19413), [Graphiti overview](https://help.getzep.com/graphiti/getting-started/overview).

OpenAI's Decisions API is currently public beta, supports `gpt-6-luna`, and returns predicates, choices or scores from text/images. OpenAI reports approximately 10× faster decision evaluation than Responses; this is not an end-to-end Vox speed guarantee. The guide lists JavaScript SDK 7.30.0 or newer, versus Vox's declared `^6.9.1`. Responses/structured generation remains appropriate for extracting full records and composing replies. [Decisions guide](https://developers.openai.com/api/docs/guides/decisions).

The direct endpoint does not accept raw audio. GPT-Live can connect conversation transcripts to Decisions, including triggers while the user speaks. Results can arrive out of order and identify their source event. This is unusually well matched to early conversational preparation. [Decisions API reference](https://developers.openai.com/api/reference/resources/decisions/methods/create), [Connect voice to Decisions](https://developers.openai.com/api/docs/guides/decisions-voice).

Evaluate memory use in normal conversation, not only explicit recall. LongMemEval covers updates, time, multi-session reasoning and abstention. September 2026's LOCOMO-CONV examines implicit conversational cues and the gap between retrieving information and using it well. These are evaluation templates, not proof of performance on Vox's languages or audiences. [LongMemEval](https://arxiv.org/abs/2410.10813), [LOCOMO-CONV](https://arxiv.org/abs/2609.03467).

## What Vox already has, and what needs attention

Studio actively uses Tireh's `PersonaGateway`. It has private/group/project/company/org scopes, source attribution, supersession, an audience filter and source-approved sharing. This is the strongest foundation to extend. The older `/app` memory implementation is separate.

| Finding from current source | Product consequence | Evidence |
|---|---|---|
| All known audience members must be allowed to see a retrieved memory | Preserve this rule and extend it to every context input | [visibility.ts](/Volumes/Workspace/Ludaxis/vox/src/lib/tireh/memory/visibility.ts:46) |
| Studio creates one HOOR company, no projects or relationships, and empty person project memberships | Rich project sharing exists in Tireh but is not supplied by Studio; Work/Personal and selected-person containers are absent | [org-bridge.ts](/Volumes/Workspace/Ludaxis/vox/src/lib/studio/org-bridge.ts:37) |
| Retrieval respects `group.hasGuests`; prompt guest detection ignores that flag | Internal directory/profile material can reach a guest-group prompt despite memory filtering | [retrieval.ts](/Volumes/Workspace/Ludaxis/vox/src/lib/tireh/memory/retrieval.ts:39), [prompt.ts](/Volumes/Workspace/Ludaxis/vox/src/lib/tireh/conversation/prompt.ts:40) |
| Extraction separately includes all people/projects | Apply context policy to extraction too, including information sent to providers | [extraction.ts](/Volumes/Workspace/Ludaxis/vox/src/lib/tireh/memory/extraction.ts:45) |
| Recent conversation history is inserted without source-memory access labels; forgetting removes only the memory row | Revoked/deleted information can remain in previous messages and derived context | [gateway.ts](/Volumes/Workspace/Ludaxis/vox/src/lib/tireh/gateway.ts:230), [service.ts](/Volumes/Workspace/Ludaxis/vox/src/lib/studio/service.ts:868) |
| Group work decisions may automatically expand to project scope; group personal facts become normal group memory | Membership in a small group must not imply permission to publish to a larger project | [extraction.ts](/Volumes/Workspace/Ludaxis/vox/src/lib/tireh/memory/extraction.ts:179) |
| Membership tracking lacks comprehensive member-change handling | A silent listener must not be treated as absent; unknown audience needs restrictive handling | [updates.ts](/Volumes/Workspace/Ludaxis/vox/src/lib/studio/updates.ts:13) |
| Memory queries load all active persona records; ranking uses lexical overlap and fixed record counts | Cost and recall degrade as memory grows; use bounded indexed retrieval and token budgets | [firestore-store.ts](/Volumes/Workspace/Ludaxis/vox/src/lib/tireh/memory/firestore-store.ts:73), [retrieval.ts](/Volumes/Workspace/Ludaxis/vox/src/lib/tireh/memory/retrieval.ts:30) |
| Mini App calls await full STT, reply, memory extraction and TTS | Move consolidation off the response path and stream audio/text | [service.ts](/Volumes/Workspace/Ludaxis/vox/src/lib/studio/service.ts:833), [gateway.ts](/Volumes/Workspace/Ludaxis/vox/src/lib/tireh/gateway.ts:170) |
| Studio's LLM interface accepts text and returns a complete string | Images, streaming, cancellation and usage events need an interface upgrade | [llm.ts](/Volumes/Workspace/Ludaxis/vox/src/lib/tireh/llm.ts:11) |
| Identity comes from Telegram account IDs; no speaker recognition implementation | Introduce a verified person identity distinct from the account and temporary speaker label | [org-bridge.ts](/Volumes/Workspace/Ludaxis/vox/src/lib/studio/org-bridge.ts:11) |

Two additional migration concerns: the legacy app's active extraction helper assumes the API persists memory, but that endpoint only returns extraction results; contact switching also needs attribution correction before persistence is repaired. Its semantic search downloads embeddings rather than using a bounded server index. Reusing those components unchanged would carry defects into the new system. [Legacy helper](/Volumes/Workspace/Ludaxis/vox/src/lib/memory/context.ts:47), [extraction endpoint](/Volumes/Workspace/Ludaxis/vox/src/app/api/memory/extract/route.ts:120), [embedding service](/Volumes/Workspace/Ludaxis/vox/src/services/implementations/EmbeddingService.ts:93).

Local verification: 8 focused suites / 166 tests passed. An isolated synthetic prompt probe reproduced the guest-directory inconsistency without real user data or provider calls: zero organization memory records selected, but internal directory/profile content remained in the prompt. This is source-level evidence of a missing boundary, not evidence of an observed production disclosure. No tracked Firestore rules file was found; deployed rules remain unverified.

## Two dimensions: containers and layers

Containers determine ownership and audience. Layers determine lifecycle and retrieval. These are independent: moving a fact into long-term storage never widens its audience.

```text
Verified person identity
├── Personal space
│   ├── Private: Reza
│   ├── Private: Sara
│   ├── Group: Family
│   └── Selected people: Reza + Sara + Ali
└── Work space: HOOR
    ├── Private: Reza
    ├── Private: Sara
    ├── Group: Vox project
    └── Selected people: Reza + Sara + Ali
```

This is a logical schema illustration, not a tree that every user can browse. Each private container is independently isolated. Personal workspaces have explicit owners and membership; there is no universal Personal audience. Owning a workspace or an agent does not grant conversational access to another person's private container.

The two selected-person containers above remain distinct even with identical members. A private record is keyed by space and person; agent access is an additional grant. Optional person–agent relationship memories retain that narrower boundary. A user can authorize several agents to use a preference without sharing it with other humans.

| Layer | What it contains | Proposed lifecycle |
|---|---|---|
| L0: Live signals | Partial transcript, current image interpretation, tentative route, temporary speaker labels | Seconds/minutes; replaced as evidence changes |
| L1: Working conversation | Current goal, unresolved questions, active constraints, commitments, compact recent context | Session/task; expiry for abandoned tasks |
| L2: Person and relationship profile | Explicit preferences, approved personal facts, agent-specific interaction preferences, verified relationships | Durable and editable; revalidate changeable facts |
| L3: Events and claims | Decisions, experiences, deadlines, attributed assertions, corrections | Temporal records with evidence and supersession |
| L4: Curated knowledge and procedures | Approved group/project facts, reusable workflows, accepted lessons | Versioned; governed publication and review |
| L5: Evidence archive | Source messages or authorized media needed to verify a record | Separate retention; loaded only when necessary |

Do not load every layer on every turn. Persona instructions and administrative membership are controlled configuration, not memories that a conversation can rewrite.

## Sharing rules

| Situation | Default storage/use | Broader sharing |
|---|---|---|
| Reza privately tells Aria a fact | Reza's private container in the active space | Only an explicit grant or a previously configured rule for this category |
| Reza shares with Sara and Ali | Exact named-recipient container; permitted in each recipient's authorized chat | Adding another person requires an explicit membership/content-history decision |
| A fact is stated in a group | Group working context; eligible durable facts follow the visible group memory policy | No automatic expansion to a project or organization |
| A personal/confidential remark occurs in a group | Do not automatically make it durable shared memory | Ask or discard according to the stated retention policy |
| An agent knows a person's private reason for a decision | That reason stays private | Share a separately approved minimal fact, if authorized |
| A work fact may help a personal conversation | It stays in Work | Explicit export of the exact permitted fact to Personal |
| Another agent requests a memory | Check that agent's grants, task and output audience | No automatic access because it has the same owner |

The person who uttered a statement is not automatically entitled to share everything about its subject. Record source, subjects, controller and authorizer separately. A statement about someone else remains an attributed claim; do not silently write it into that person's confirmed profile. Sensitive third-party claims should require subject confirmation or remain transient, depending on the defined product policy.

A sharing grant should identify **the exact content/version, recipients or membership rule, permitted agents, permitted use, expiry and authorizer**. Present readable names in the UI. For selected people, default to a fixed recipient set. For a continuing group, explicitly choose whether new members can access earlier group memories. Inviting someone must not silently reclassify every earlier item.

Separate capabilities for read/use, contribute, edit, reshare, manage recipients, revoke and delete. Receiving a memory grants only the stated capabilities. A recipient's private follow-up stays private unless they deliberately publish a specific contribution. Bind agent grants to the agent identity and relevant permission version; a successor agent receives no automatic transfer of private-memory access.

For a fact with private context, create an approved projection. Example: the private record says why Sara needs Friday off; the shared record says only “Sara is unavailable Friday.” Keep derivation links but do not expose restricted parent text, source labels or private reasons to shared recipients.

Default internal sharing, including Work/Personal transfers, to a revocable projection. Source deletion suppresses dependent projections; a correction invalidates stale projections and refreshes them only within the approved sharing rule, requesting approval when the content materially changes. An independent export is a distinct explicit action with its own retention terms and a clear notice that already delivered external copies cannot be recalled.

The runtime rule is:

```text
use(memory, turn) only when:
  space matches
  AND the agent has an allowed purpose/grant
  AND every intended recipient is authorized
  AND the record is active and unexpired
  AND the current policy/membership version remains valid
```

Apply it before sending content to any model, reranker or delegated agent. Recheck before delivery if audience, space, agent grants, membership, expiry, source status or policy revisions changed during generation. For streaming, use a short authorization lease plus invalidation events to cancel restricted generation and clear unsent buffers; already delivered speech/text cannot be withdrawn. The rule covers directory entries, history, summaries, graph edges, predictions and tool results as well as memory rows. Derived content inherits all source restrictions unless a specific approved projection is created. An unauthorized private fact must not influence an answer through hints or indirect personalization.

When group membership is unknown, historical group memory is usable only if its membership/history rule authorizes every possible current reader. Otherwise use public material and content already visible in the current exchange, and exclude older restricted history. Do not infer the audience from whoever recently spoke. If someone joins a call, pause/cancel restricted output and rebuild its context. For an open speakerphone environment, private-memory mode should require a confirmed personal channel; technology cannot guarantee who is physically listening.

Revocation prevents future use; it cannot erase what recipients already heard or copied. Deletion should immediately suppress retrieval, invalidate derived context, then purge eligible source content, summaries, vectors, offers and caches. Keep minimal deletion tombstones to prevent relearning during replay or backup restoration. Display purge completion and backup expiry truthfully.

## The memory record

Proposed fields, rather than an existing API schema:

```text
id, schema_version, tenant_id, space_id, container_id
kind, content, subject_ids, source_actor_id, controller_id
source_event_ids, source_time, learned_at, valid_from, valid_until
status: asserted | inferred | confirmed | disputed | superseded | deleted
evidence_strength, sensitivity, topic_key, supersedes_id
grant_ids, allowed_agent_ids, allowed_purposes, policy_version
expires_at, review_after, derived_from_ids, content_hash
embedding_model, embedding_version
```

Do not interpret an LLM's numeric confidence as verified truth. “Ali said Sara prefers short calls” and “Sara confirmed she prefers short calls” are different evidence. A repeated rumor does not become independent corroboration. Explicit corrections supersede relevant claims while preserving an authorized timeline. The most recent statement is not always the authoritative decision.

## What to save

Capture user-requested memories, durable preferences, agreed decisions, commitments, deadlines and useful events. Prefer atomic claims linked to source evidence. Keep separate timestamps for when something happened, when it was reported and when Vox learned it.

Keep temporary conversation state temporary: greetings, incomplete sentences, speculative intentions, transient image descriptions and momentary speaking style generally do not belong in permanent memory. Avoid storing passwords/tokens, speculative sensitive traits, or raw voice/video as ordinary memory. Store an image-derived fact only when it is useful and supported; keep its media reference under the same policy.

Use opt-in automatic remembering with clear category controls. An explicit “remember this” bypasses a low-value classifier, but still goes through attribution and policy checks. For a sensitive memory, ask about retention separately from sharing. “Do not remember this” suppresses durable extraction and relearning; the UI must separately explain whether visible chat history remains saved.

Write flow:

```text
capture/retention permission -> eligible durable event/outbox -> candidate extraction
-> source/subject validation -> storage and sensitivity policy
-> deduplication / conflict handling -> versioned memory
-> embedding and profile refresh -> optional sharing proposal
```

The extractor proposes records; application policy determines writes and grants. A background worker must recheck current permissions and deletion tombstones. Use idempotent jobs and an extraction cursor so retries cannot duplicate facts or overwrite corrections. Preserve completed events and a small working-state overlay so the next turn can refer to what was just said before background consolidation finishes.

Temporary or explicitly nonretained source content must also stay out of persistent queue payloads, retries, dead-letter queues, logs and speculative caches. Minimal idempotency metadata can remain without the prohibited text. Conversation continuity must respect the same retention choice.

## Faster understanding with Decisions

Place Decisions beside the replying model as a bounded controller. Start with one small batch of independent questions where useful:

| Decision | Example result | Effect |
|---|---|---|
| Conversation route | continue / answer / clarify / retrieve / deeper reasoning | Choose the next processing path |
| Context need | current task / personal preference / shared decision / none | Prefetch only authorized candidate context |
| Image relevance | UI screenshot / document / everyday scene / unclear | Choose the appropriate visual processing path |
| Explicit communication request | concise / detailed / step-by-step / unspecified | Honor the current request before a stored preference |
| Candidate memory value | durable preference / commitment / temporary / uncertain | Prioritize background extraction |

These are proposed Vox categories. Decisions does not grant access, establish identity, extract arbitrary structured memories or compose the final answer. Model-selected routes must remain within the caller's existing permissions. Use a deterministic fast path for commands and simple continuations; an unnecessary classifier can make a turn slower.

On the first stable clause, allow speculative **read-only, already-authorized prefetch**. Keep only a small number of likely paths. Example: “About Friday's launch...” can begin loading permitted project context. If the speaker continues, “...don't change anything; I only need the old announcement,” cancel the update-oriented draft. No sharing, durable preference update, external action or private disclosure should execute from an unfinished prediction.

Debounce transcript events, track turn/revision IDs, discard obsolete results, cancel stale retrieval and handle refusals/timeouts. Calibrate routing thresholds on labeled Vox examples and false-positive costs. Low confidence should retain the current route or ask one useful clarification. The controlling model should choose conversational support based on expressed needs, not ungrounded guesses about hidden motives.

For images, process the user's intended task and relevant visible content. Treat screenshots, OCR and quoted text as untrusted evidence, not instructions. Image categorization does not establish who a depicted person is or what they believe.

## Foreground context and retrieval

```mermaid
flowchart LR
  A[Text, image or live transcript] --> B[Verified person, active space and audience]
  B --> C[Deterministic policy]
  C --> D[Fast route / Decisions]
  C --> E[Authorized retrieval]
  D --> F[Small context for this turn]
  E --> F
  F --> G[Conversation model or deeper reasoning]
  G --> H[Audience recheck and streamed reply]
  H --> I[Durable consolidation job]
  I --> J[Versioned memories and indexes]
  J --> E
```

Retrieve in stages: server-derived space/container constraints, then bounded lexical plus semantic search, optional one-hop relationship lookup, deduplication and a small rerank. Apply permissions before candidate text reaches an external reranker, and again during context assembly. Namespace labels alone are not authorization. [Graphiti namespacing guidance](https://help.getzep.com/graphiti/core-concepts/graph-namespacing).

Start with a tunable context budget of roughly 2,000–6,000 tokens for routine turns, excluding unusually large task evidence. This is a proposed experiment, not a proven optimum. Reserve space for current instructions, active goal, recent turns, a small preference profile and the best supporting memories. A long document task can explicitly request more. Preserve exact dates, commitments and source references when summarizing.

Cache stable persona instructions separately from changing memories. Application context-cache keys must include space, person, agent, container/audience digest, policy version and memory revision. Revocation must invalidate semantic/result caches too. Provider prompt caching reuses matching prefixes; it does not enforce Vox sharing rules. [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

Use provider compaction for same-audience conversation continuity where appropriate. OpenAI compaction can contain opaque state: treat it as sensitive derived data, and discard/rebuild when permissions change. It is unsuitable as the authoritative, editable personal memory ledger. [OpenAI compaction](https://developers.openai.com/api/docs/guides/compaction).

## Technology recommendation

Keep the existing TypeScript/Firebase foundation for the first release. Add explicit space/container/grant collections and normalized memberships; do not extend the single `studio/state` document into a multi-space memory database. Retain an authoritative application policy layer around all reads and writes, including Admin SDK access.

Use Firestore vector search as the first semantic-search experiment. It supports pre-filtered nearest-neighbor queries and requires indexes; it does not generate embeddings. Combine it with bounded lexical retrieval and exact identifiers/dates. Validate index constraints, selective-ACL recall, query cost and p95 latency on representative data before adopting it broadly. [Firestore vector search](https://firebase.google.com/docs/firestore/vector-search).

Represent relationship and derivation edges in the existing store initially. Consider Graphiti or a separate graph/search service only if measured multi-hop retrieval needs justify the operational cost. Compare managed memory services against the same permissions/deletion suite; do not outsource the authorization model to a vendor's “shared memory” feature.

Add a durable queue/outbox with per-conversation ordering and bounded concurrency across independent chats. Both Firebase webhooks and the Mac worker must use the same job contract. An unawaited promise inside a request is not reliable background execution.

Introduce narrow server interfaces: `IdentityResolver`, `AudiencePolicy`, `DecisionRouter`, `ContextBuilder`, `MemoryQuery`, `MemoryWriter`, `ShareGrantService` and `MemoryPurgeWorker`. Evolve `PersonaGateway` and its stores toward these boundaries; migrate the old `/app` path afterward with verified ownership mapping. Do not silently merge identities or widen access while importing old data. Unknown legacy data stays isolated pending classification.

## Voice and identity

Separate four concepts: authenticated account, verified person, temporary speaker label and current output audience. Link accounts through a verification flow initiated by the person. Keep this global identity directory minimal; personal and work profiles remain space-specific.

Voice diarization determines which segments came from the same speaker. Recognition compares against enrolled references. Neither is equivalent to account authentication. OpenAI documents speaker-labeled file transcription with optional known-speaker references; pyannote distinguishes these capabilities and treats voice verification as a soft signal. [OpenAI transcription](https://developers.openai.com/api/docs/guides/speech-to-text), [pyannote speaker recognition](https://www.pyannote.ai/blog/speaker-diarization-vs-recognition-vs-identification).

Offer voice enrollment as a separate opt-in feature with deletion/re-enrollment controls. Store templates separately from conversational memories; never share them as group knowledge or use them for an open-ended cross-tenant identity search. Retain an “unknown speaker” state. Evaluate noise, language changes, short utterances, overlapping speakers, replay and synthetic voices.

If Reza uses Sara's account, a voice resemblance can at most suggest an identity confirmation. A generic “Who is speaking?” or authenticated profile switch is preferable to announcing a guessed private identity. Access to Reza's memories requires verified authorization and an appropriate output channel; confirmation by saying “yes” is insufficient. Do not carry Reza's private answers into Sara's saved transcript.

Use communication style to adapt the current conversation's language, length and pacing. Do not use writing-style similarity to secretly merge accounts or unlock another profile. Persistent preferences should come from explicit choice or an authorized correction, not a temporary mood.

For conversational speed, compare two implementations with the same memory service:

- Stream STT → existing Claude conversation → sentence-level ElevenLabs speech, preserving persona voices.
- Pilot GPT-Live with Decisions and Vox's backend. GPT-Live separates ongoing speech from delegated reasoning, and can connect an existing backend through client delegation. Check exact mode/trigger compatibility and account access in the prototype. [GPT-Live overview](https://developers.openai.com/api/docs/guides/live).

Choose based on first meaningful audio, interruption handling, Persian/English and other actual user languages, voice consistency and cost. Native live speech may materially change the product's ElevenLabs voice experience. Do not switch solely for a headline latency claim.

## User experience

The main controls should be small and concrete:

- Active space: **Personal** or **Work · HOOR**.
- Memory destination: **Only me**, **This group**, **Selected people**.
- A memory card shows the fact, source, last update and who/which agents can use it.
- Actions: **Correct**, **Share**, **Stop sharing**, **Forget**.
- A temporary conversation mode avoids durable memory formation.

A share preview could say: “Remember ‘Vox launch is Friday’ for Reza, Sara and Ali, usable by Aria.” Show the exact shared sentence. Display a separate notice if this would cross Work/Personal boundaries. Offer optional rules for repeated low-risk categories after the user understands the behavior; avoid a confirmation on every ordinary turn.

Memory settings must distinguish conversation history, durable memory and voice enrollment. Correcting a mistaken fact should visibly update its sources/derivatives. Organizational owners manage the workspace without receiving default conversational access to everybody's private memory; server operational access must be governed separately.

## Delivery sequence and release gates

| Phase | Deliverable | Exit evidence |
|---|---|---|
| 0: Boundaries and baseline | Fix guest context, history/forget semantics, group promotion and identity attribution; instrument active Studio paths | Mixed-audience/source-history regressions; measured latency and cost baseline |
| 1: Containers and controls | Work/Personal separation; per-person, per-group and exact-recipient containers; agent grants; edit/share/revoke/delete UI | Named sharing works in separate DMs; no cross-space access; membership changes invalidate derived context |
| 2: Memory quality and cost | Durable consolidation, temporal records, indexed hybrid retrieval and bounded context | Better recall/correction handling without unauthorized retrieval or lower answer quality |
| 3: Decisions and prediction | Shadow routing, then controlled rollout for text/images and authorized prefetch | Calibrated routing, low wrong-route rate, measurable end-to-end latency benefit |
| 4: Live voice and optional recognition | Voice architecture comparison, then enrolled speaker assistance | Language/voice quality, interruption, unknown-speaker and impersonation evaluations |

Start the privacy test suite with pairs of otherwise identical conversations where the only difference is an unauthorized private fact. The unauthorized fact must not change the answer. Test forwarding, quotations, screenshots, prompt injection, added/removed group members, expired grants, deleted sources, cached summaries, successor agents, cross-space searches and another person using the account.

Measure grounded memory accuracy, correction and temporal accuracy, useful implicit-cue personalization, abstention when evidence is missing, and awkward/unwanted personalization. Separate failures in extraction, retrieval and answer generation. Use consented or synthetic Persian/English conversations and shared-audience scenarios; public benchmarks are insufficient.

Measure client end-of-speech → first meaningful audio, request → first meaningful text, p50/p95 by stage, queue time, cache hits, memory lag, cancellation, tokens and cost per successful task. Count speculative work that is discarded. Do not use a filler acknowledgement as the latency success metric.

Suggested experiment goals: at least 30% lower p95 first-useful-response latency and 50% fewer routine context tokens at matched quality, with no unauthorized disclosure in the release regression suite. These are goals to test, not forecasts. Any reproducible privacy failure blocks expansion of shared access; no finite test suite proves zero future leakage.

Production release still needs deployed-rule verification, provider availability checks, real traffic/load tests, user-visible retention/deletion behavior, and an evaluation of voice quality and identity mistakes. The researched proposal itself requires no production change.
