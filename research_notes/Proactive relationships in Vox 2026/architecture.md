# Architecture and evaluation for Vox's ongoing relationship loop

Research date: 19 October 2026. Read-only research and focused source inspection; no provider calls, production operations, or application changes. The recommendations below treat ordinary, relevant conversational initiative as the desired product behavior. They do not introduce a permission prompt before each friendly follow-up.

## What should Decisions do, and what must Vox supply?

### Takeaway

Decisions is a useful fast next-action classifier, not a complete persistent companion or autonomous software-development engine. Vox should own the relationship state, triggers, schedules, action execution, and feedback record; a generation model composes language and extracts richer structured records.

### Cited Findings

- **Verified documentation, accessed 19 October 2026:** the Decisions guide describes a public beta with only `gpt-6-luna`, input consisting of text/images, and three result types: predicate probability, choice from supplied options, and ordered score. It directs custom-schema extraction/explanations to Responses Structured Outputs and tool requests to function calling. It recommends distinct observable criteria, a fallback category, and thresholds calibrated on application examples with false-positive/false-negative costs. JavaScript examples require SDK 7.30.0 or newer. OpenAI's roughly 10× latency claim is about decision evaluation, not Vox end-to-end latency. [Decisions guide](https://developers.openai.com/api/docs/guides/decisions)
- **Verified API reference, accessed 19 October 2026:** the TypeScript reference accepts 1–200 questions, excludes raw audio from documented input, and allows per-question refusals. Those cases need explicit application handling. The reference is not proof that Vox's organization has the required model access or capacity. [Decisions TypeScript reference](https://developers.openai.com/api/reference/typescript/resources/decisions/methods/create)
- **Verified local source, 19 October 2026:** `decideOnStranger` selects reply/decline/ignore/block for outsiders using a text-generation call and JSON parsing. This is an existing bounded-action pattern, but not a general personal relationship controller and not a Decisions integration. [service.ts](/Volumes/Workspace/Ludaxis/vox/src/lib/studio/service.ts:761)
- **Verified local source, 19 October 2026:** the ordinary conversation path records messages, retrieves memory, generates a reply, and forms memories. Personal memory visibility is restricted to the owning person's one-to-one conversation. [gateway.ts](/Volumes/Workspace/Ludaxis/vox/src/lib/tireh/gateway.ts:170), [visibility.ts](/Volumes/Workspace/Ludaxis/vox/src/lib/tireh/memory/visibility.ts:46)
- **Existing proposal, not shipped behavior:** Vox's memory strategy already separates live signals, working state, personal preferences, and temporal facts, and documents unresolved context-isolation issues. It is a good architectural starting point, but its existence does not establish implementation or deployment. [AGENT_MEMORY_STRATEGY.md](/Volumes/Workspace/Ludaxis/vox/docs/AGENT_MEMORY_STRATEGY.md:1)

### Inferences

**Proposed loop:** `message / relevant event / scheduled reconsideration → retrieve the correct person's context → update facts and tentative state → choose a bounded action → check current delivery constraints → compose and send, defer, or remain quiet → observe response/correction → update state and future candidates`.

The durable object should be an **opportunity to reconnect**, rather than a message irrevocably queued for tomorrow. Example: record “unresolved difficult interaction with boss,” its source, last update, possible next-day reconsideration, and cancellation conditions. When due, reload the latest conversation. If the user has said it is resolved, close it. If they changed subject, defer or leave it alone. If nothing superseded it and the timing is appropriate, ask “How did today go—any better with your boss?” without an approval question first.

Maintain separate record types:

| State | Example | Update rule |
|---|---|---|
| Attributed fact | User said their boss spoke harshly today | Source message, time, correction/supersession |
| Open situation | How that disagreement develops | Open/resolved/abandoned, expiry, follow-up candidates |
| Temporary cue | Speech seemed subdued in this turn | Low-confidence observation, short expiry, never silently promoted to a trait |
| Interaction preference | Usually likes brief support; dislikes repeated advice | Explicit preferences dominate; inferred preferences require repeated evidence |
| Relationship history | Prior shared joke or helpful conversation | Recall selectively and contextually |
| Contact state | Last outbound message, unanswered attempts, local time, quiet hours | Checked at send time, including an explicit stop |

A compact action vocabulary might be `acknowledge`, `listen`, `ask_one_question`, `offer_help`, `share_something_relevant`, `follow_up`, `defer`, `close_topic`, and `stay_quiet`. These are proposed Vox labels, not predefined API features. Don't request a chain of dependent judgments in one independent-question batch. For example, first decide whether any outreach is justified; then choose among currently valid opportunities.

For an already active conversation, “stay quiet” can mean end the response naturally without another question. For an outbound opportunity, it means no notification. The agent should be able to remember a detail without displaying that memory immediately, and to be warm without steering every interaction into personal disclosure.

Implementation recommendation: use durable jobs with idempotency keys, per-user sequence/version checks, cancellation, retries, and duplicate-send protection. A scheduled job should re-evaluate current state, then atomically claim an outbound action; competing triggers must not send multiple check-ins. Treat time windows and contact preferences as evolving estimates but explicit stop/quiet-hour settings as deterministic constraints.

**Two learning speeds:** update this user's memories and reversible preferences after interaction; update global action rubrics/prompts/models only through versioned evaluation and rollout. One user's silence must not become “users dislike empathy,” and one user's “ask more questions” must not alter every agent.

**Secondary product loop:** recurring interaction friction → minimally necessary product evidence → clustered issue hypothesis → reproduction and severity/confidence → implementation proposal → tested change and feature flag → measured outcome. Keep private narratives in the relationship store. An issue should say “voice turns lose context after reconnect” or “three users repeatedly request a weekly review,” with permitted supporting evidence, rather than copying a personal story into a developer issue. Adapt existing settings/workflows per user immediately where supported; new executable functionality needs the development pipeline and a rollback path.

### Gaps

- No live access, rate-limit, region, cost, or latency tests were performed for Vox. Public-beta documentation does not establish the app account's entitlement or operational readiness.
- The humanlike quality of timing cannot be inferred from predicate confidence. It needs application labels and user evidence.
- The scoped source search found no proactive relationship scheduler in Studio/Tireh. This is a scoped observation, not a claim about every branch or an external service.
- The generic HTTP reference showed a broader input union than language SDK reference pages. Before implementation, verify the exact SDK/API schema rather than relying on generated type unions. The guide and TypeScript reference are consistent on the text/image use case required here.

## How should voice and cultural context influence the relationship?

### Takeaway

Voice can improve responsiveness, but transcript-based Decisions does not hear vocal tone. Use audio-capable interpretation for optional prosodic cues, then combine those cues with the person's words, history, and corrections; do not turn a momentary impression into a durable emotional label.

### Cited Findings

- **Verified documentation, accessed 19 October 2026:** GPT-Live's Decisions integration forwards conversation transcripts and supports input/output transcript triggers. It requires a working Live connection and `api.decisions.write`; no Decisions-specific alpha header is required. Questions can change within a session, while delegation type remains fixed. Results identify the source event, may combine deltas, and may arrive out of order; the guide instructs applications to use the newest relevant result. Its expression example reacts to words such as getting a job; it is not proof of acoustic emotion recognition. [Connect voice to Decisions](https://developers.openai.com/api/docs/guides/decisions-voice)
- **Verified documentation, accessed 19 October 2026:** Realtime voice-to-voice input avoids intermediate transcription and makes tone and inflection available to the model. This establishes access to audio cues, not calibrated accuracy at identifying a person's internal feelings. [Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations#audio-inputs-and-outputs)
- **Primary technical study, 4 June 2026, accepted to Interspeech 2026:** Mi and colleagues describe degradation when speech-emotion models trained on a source language are evaluated on unseen target languages, associated with language distribution mismatch and limited target-language labels. Their representation-learning method improves cross-language generalization in their experimental setting. This is evidence that cross-language robustness remains an active problem; it is not a benchmark of GPT-Live or Vox. [Learning Emotion-discriminative Representations for Zero-Shot Cross-lingual Speech Emotion Recognition](https://arxiv.org/abs/2606.06200)
- **Verified local source, 19 October 2026:** Vox's Mini App `callTurn` transcribes the recording, sends only text to `gateway.converse`, then optionally synthesizes the reply. The current path therefore cannot preserve raw acoustic information for the conversation model. [service.ts](/Volumes/Workspace/Ludaxis/vox/src/lib/studio/service.ts:833)

### Inferences

Use two inputs when audio is available: (1) words and explicit statements, and (2) a transient audio observation containing evidence, uncertainty, and timestamp. For example, “long pauses and quieter delivery than earlier in this call; could reflect tiredness or recording conditions” is more useful than `user_is_depressed=true`.

React proportionately. A cue can justify slower pacing, softer wording, or fewer questions without announcing an emotional classification. If the topic matters, ask a natural clarification. “That sounded like a rough day” is tentative; “I know you are sad” claims knowledge the system does not have. If the user corrects the interpretation, accept the correction immediately.

Prefer individual evidence to cultural stereotypes. Learn language, level of formality, humor, the holidays the user mentions, their response to greetings, and time-of-day patterns. Do not assume that nationality implies religion, that a language implies location, or that an accent determines how intimate the agent should become. Inferred cultural context should remain revisable.

Keep voice affect separate from speaker identity and access control. A cheerful voice should change tone, never authorization. Don't infer gender in order to choose warmth or care; those behaviors can be personalized directly.

### Gaps

- No evaluated accuracy is established for Vox's target languages, mixed-language speech, microphones, background noise, or particular users. No evidence found here supports a universal “happy/sad detector.”
- The cross-language study addresses speech emotion recognition, not broad culture-aware social intelligence. Cultural adaptation rules above are recommendations to test, not a proven automated cultural inference system.
- Native transcript triggering can help prepare reactions during speech, but long-horizon relationship memory and scheduling must still be supplied by Vox.

## What does evidence say about companionship, and how should Vox validate benefit?

### Takeaway

Evidence supports the possibility of feeling heard and momentary comfort, but does not establish that more conversation or stronger attachment produces lasting benefit. Build a natural relationship loop, then measure appropriateness and usefulness over time rather than optimizing for message count.

### Cited Findings

- **Peer-reviewed research, online 25 June 2025; Journal of Consumer Research April 2026 issue:** De Freitas and colleagues report short-term reductions in loneliness in controlled studies. Their week-long study found momentary reductions after use; feeling heard was an important explanatory factor. This is encouraging evidence for attentive conversation, not proof of durable wellbeing improvement or proof that proactive outreach causes benefit. Full paper was fetched from the authors' institution after the journal host failed. [AI Companions Reduce Loneliness, institutional full text](https://www.hbs.edu/ris/Publication%20Files/AI%20Companions%20Reduce%20Loneliness%2011.7.2025_57451c02-8047-4e0d-abfc-55841f64166d.pdf), [journal DOI](https://doi.org/10.1093/jcr/ucaf040)
- **Primary randomized study, latest arXiv version 2 October 2025:** the four-week MIT/OpenAI experiment included 981 completers and over 300,000 messages, comparing text/neutral voice/engaging voice and conversation types. The revised abstract reports no significant effects from assigned experimental conditions. Greater voluntary use was associated with worse psychosocial outcomes, and higher trust/social attraction with emotional dependence and problematic use. Those usage associations do not establish causation. It lacked a no-AI control, used US English-speaking adults, and compared specific ChatGPT configurations. Avoid stronger claims based on early summaries or the original version. [Fang et al., latest full text](https://arxiv.org/html/2503.17473v2), [version history](https://arxiv.org/abs/2503.17473)
- **Primary working paper, version 1 October 2026, not treated as peer-reviewed consensus:** a preregistered French experiment analyzed 7,286 adults completing baseline/endline. Treatment encouraged daily personal conversation with a self-chosen generative AI for 28 days; control continued usual behavior. The authors report increased loneliness; other wellbeing estimates were adverse but imprecise. This concerns encouragement of ordinary AI use, not a purpose-built proactive Vox companion, and cannot identify which unseen conversational behaviors caused the result. Its different outcome horizon and intervention matter when comparing with momentary relief studies. [Fréget, Reshef, and Senik, CESifo 12882](https://www.ifo.de/DocDL/cesifo1_wp12882.pdf)
- **Official practice guidance, accessed 19 October 2026:** OpenAI recommends task-specific evaluation, representative production distributions, human calibration of automated grading, and continuous evaluation on changes. It explicitly includes multilingual input and long-running conversation as edge cases. [Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)

### Inferences

The evidence suggests a concrete distinction: “this conversation felt helpful” and “this product is improving someone's life over weeks” are separate outcomes. The evidence does not justify avoiding warmth; it justifies avoiding a reward function that equates benefit with longer sessions, more confessions, or escalating closeness.

**Recommended metrics, not established benchmark standards:**

| Area | What to measure |
|---|---|
| Perceived benefit | Occasional low-friction feedback about helpfulness and feeling understood; qualitative interviews |
| Timing | User-rated appropriate timing; interruptions; quiet-hour violations; follow-ups arriving after resolution |
| Memory quality | Wrong-detail rate, unwanted recall, corrections incorporated, stale facts, private-to-group leakage |
| Conversation quality | Relevant acknowledgment, unnecessary questions, repeated topics, unsolicited advice, ability to end naturally |
| Outreach quality | Welcome versus unwanted outreach, mute/stop/block reports, duplicate delivery, repeated unanswered outreach |
| Practical outcome | Progress on the actual user situation or task, when observable and appropriate |
| Longer-term experience | Trust, control, satisfaction, whether Vox helps or crowds out activities and relationships the user values |

Nonresponse is ambiguous: the person may be busy, offline, asleep, uninterested in this topic, or simply finished. Record it as missing/limited evidence and reduce immediate contact pressure. Do not mark it as sadness, rejection, or “needs more affection.” Do not train the system to ask increasingly intimate questions because that previously produced replies.

**Proposed rollout:**

1. Construct multilingual multi-day conversation cases with explicit facts, transient cues, and changed situations. Include boss conflict resolved before follow-up, sarcasm, quiet voices caused by a room/microphone, affectionate versus formal styles, ignored outreach, “don't ask me about that,” and private/group crossings. Label whether to speak, when, which topic, and whether to ask a question. Use multiple human reviewers for ambiguous cases.
2. Run shadow decisions against realistic event sequences without sending messages. Evaluate routing, stale-context cancellation, temporal consistency, refusal/fallback behavior, cross-user isolation, duplicate prevention, and the quality of generated candidate messages separately.
3. Introduce ordinary initiative to a bounded pilot, with visible controls and natural conversational corrections. Do not ask permission before every routine follow-up. Start with user-mentioned open situations and familiar topics; treat health interpretation and acoustic affect as lower-confidence inputs.
4. Randomize eligible low-stakes outreach opportunities to send versus no-message holdout, or compare timing policies, so the system can learn whether outreach adds benefit instead of crediting outcomes that would happen anyway. Do not withhold requested reminders or urgent user-requested assistance. Track usefulness and unwanted outreach alongside replies.
5. Promote global policy/model changes only after offline regression results and pilot comparisons. Retain versioned decision traces and rollback; update personal memories immediately when corrected. Expand only when the relevant language and audience evidence supports it.

For the boss example, successful behavior may be a brief next-day question, a supportive exchange, and then several days without outbound messages. The loop can improve while becoming less chatty.

### Gaps

- No reviewed study here directly tests the exact proposed combination: dynamic relationship memory, Decisions routing, spontaneous cross-day follow-up, voice cues, and personalized feature creation.
- There is no established universal best check-in frequency or confidence threshold. Vox must establish these for its population and situations.
- Long-term effects, cultural generalization, and the effect of repeated product/personality updates remain uncertain. Existing studies should inform hypotheses, not be presented as guarantees.

