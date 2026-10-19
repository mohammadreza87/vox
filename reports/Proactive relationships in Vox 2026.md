# Build Relationships Through Memory and Judgment

**Evidence reviewed through 19 October 2026.** Vox can build the relationship loop you describe, including natural next-day follow-ups without asking permission before each ordinary interaction. Kindroid, Nomi, and ElliQ already document combinations of initiative, evolving memory, and restraint, although their published descriptions do not establish human-quality judgment. ([Kindroid](https://kindroid.ai/v2/docs/chat-features-and-tools/), [Nomi](https://nomi.ai/nomi-knowledge/proactive-messaging-when-your-nomi-messages-you-first/), [ElliQ](https://blog.elliq.com/elliq3)) My recommendation is to build **a system that remembers unresolved situations and continually reconsiders whether to act**, with Decisions choosing bounded actions. The essential intelligence is recognizing when context has changed, when a question would help, and when a conversation should end comfortably. Research supports several ingredients, but no reviewed study establishes the complete proposed system across cultures and months of use. This report distinguishes documented products, empirical findings, experimental proposals, and engineering recommendations; it does not establish provider-account access or deployed Vox behavior.

## Existing products demonstrate the interaction pattern

The closest current comparison is Kindroid. Its help page, updated **18 October 2026**, describes context-dependent proactive text, voice messages, selfies, and calls. Resuming a conversation cancels and replans a pending action. Its Learned Context maintains relationship development, important facts, and ongoing situations; recent reactions also inform context. These are unusually relevant published mechanisms for Vox, although the vendor does not disclose calibrated timing or emotion accuracy. ([Kindroid documentation](https://kindroid.ai/v2/docs/chat-features-and-tools/))

| Example | Documented behavior relevant to Vox | Evidence boundary |
|---|---|---|
| **Kindroid** | Proactive actions adapt to context; pending actions can be replanned; outreach pauses after three unanswered contacts. | Current vendor documentation, not independent testing or a universal cadence recommendation. ([Source](https://kindroid.ai/v2/docs/chat-features-and-tools/)) |
| **Nomi** | Published messaging settings increase spacing after nonresponse; one setting sends once until a reply. Its Identity Core incorporates significant experiences and feedback. | The guides date to 2024; they remain published, but unchanged 2026 UI behavior was not verified. ([Messaging](https://nomi.ai/nomi-knowledge/proactive-messaging-when-your-nomi-messages-you-first/), [memory](https://nomi.ai/updates/introducing-the-nomi-identity-core-fostering-dynamic-and-authentic-identities/)) |
| **ElliQ** | A Relationship Orchestration Engine chooses actions and dialogue using remembered information. Presence and sleep controls influence check-ins; an unanswered initiation ends after brief listening. | Vendor architecture and FAQ claims. The product serves an older US audience, limiting direct generalization to Vox. ([Architecture](https://blog.elliq.com/elliq3), [FAQ](https://elliq.com/pages/faqs)) |

These examples establish feasibility, not a winning algorithm. Vox should borrow the observable behaviors—continuity, replanning, and reduced pressure after silence—then evaluate its own implementation. Product-level quiet hours, stop controls, and privacy settings are compatible with spontaneous conversation. **A friendly follow-up should not require a new permission question.** Transparency means users understand that Vox is an AI and can correct or stop it; it does not require procedural dialogue before every social initiative.

## Research favors contextual restraint over constant engagement

The strongest directly relevant 2026 field study is **PITCH: 12 graduate students using an English Slack agent for 14 days**. Morning and evening check-ins occurred at user-selected times. The agent sometimes pursued productivity despite distress, interrupted multipart answers, or promised unavailable features; 109 of 336 conversations ended with an unanswered agent message. The study supports sensitivity to conversational resistance and completion. Its small, technically familiar sample and coaching setting do not prove companionship benefits or optimal spontaneous timing. ([Final CHI 2026 paper](https://adnan-abbas.github.io/assets/pdf/PITCH_CHI_2026.pdf))

The peer-reviewed *Inner Thoughts* work separates generating a potentially useful contribution from deciding to speak. Its evaluated dialogue method and brief live Slack study offer evidence for selective initiative, with substantially different conditions from a long-term one-to-one companion. The practical implication is to generate candidate actions internally without making every candidate an interruption. ([CHI 2025 paper](https://stfang.me/assets/pdf/Inner_thoughts_CHI25.pdf))

A particularly relevant new proposal is *Proactive AI: From Turns to Replannable Dialogue Timelines*, submitted **4 October 2026**. It distinguishes prepared messages from intentions to reconsider later, re-evaluates delivery against fresh context, and makes silence an explicit outcome. It includes a prototype and illustrative interaction, **without an empirical user evaluation**. Its optional mechanism requiring eventual contact should not become Vox's default: an opportunity to reconnect need not create an obligation to send. ([Preprint](https://arxiv.org/html/2610.05159v1), [TypeScript prototype](https://github.com/airalogy/proactive-ai))

Companionship findings require equally careful interpretation. Peer-reviewed research reports short-term reductions in loneliness, including momentary improvement after use during a week-long study; feeling heard helped explain the effect. That is evidence for attentive interaction, not durable wellbeing improvement or a causal benefit from unsolicited messages. ([Journal of Consumer Research paper](https://doi.org/10.1093/jcr/ucaf040))

The **revised MIT/OpenAI randomized study** followed 981 completers for four weeks across text and voice conditions and conversation types. Its revised results report no significant effects of assigned experimental conditions. Greater voluntary use correlated with worse psychosocial outcomes, while trust and social attraction correlated with dependence and problematic use; those associations do not establish causation. The experiment lacked a no-AI control and involved US English-speaking adults. Earlier simplified claims about voice being beneficial or harmful should not override the revised analysis. ([Latest full paper](https://arxiv.org/html/2503.17473v2))

An **October 2026 CESifo working paper** reports increased loneliness in a French experiment encouraging daily personal conversation with self-chosen generative AI over 28 days, among 7,286 baseline/endline completers. Other wellbeing estimates were adverse but imprecise. This is a working paper, not settled consensus, and it studies ordinary AI use rather than Vox's proposed design. Its intervention and outcome horizon differ from momentary-relief experiments. Together, these studies justify measuring immediate helpfulness and longer-term experience separately. ([Working paper 12882](https://www.ifo.de/DocDL/cesifo1_wp12882.pdf))

## Build a relationship state that can change its mind

The following architecture is an engineering recommendation. Decisions currently provides predicate probabilities, supplied-option choices, and ordered scores, with `gpt-6-luna` in public beta. Its guide directs richer extraction to Structured Outputs and tool execution to function calling; thresholds should be calibrated on application examples. **Decisions supplies judgments; Vox supplies memory, scheduling, execution, and evaluation.** ([Official guide](https://developers.openai.com/api/docs/guides/decisions))

```mermaid
flowchart LR
    A[Message or timed reconsideration] --> B[Retrieve and update relationship state]
    B --> C[Decisions selects a valid action]
    C --> D[Check latest state and delivery constraints]
    D --> E[Speak, defer, close topic, or stay quiet]
    E --> F[Observe reply, correction, or silence]
    F --> B
```

Avoid one opaque relationship score. Store different kinds of information separately so that evidence, uncertainty, and authority remain visible:

| State | Example | Proposed lifecycle |
|---|---|---|
| Attributed fact | “My boss criticized me today.” | Preserve source and timestamp; corrections supersede it. |
| Open situation | Workplace disagreement | Open, resolved, or abandoned; reconsider relevance and expire stale entries. |
| Temporary cue | Quieter delivery during this turn | Record uncertainty and short expiry; never automatically promote it to a trait. |
| Communication preference | Appreciates brief support | Explicit corrections dominate; inferred preferences need repeated evidence. |
| Pending intention | Revisit the disagreement | Store purpose and cancellation conditions; re-evaluate before sending. |
| Contact state | Recent unanswered outreach | Track factual delivery/response status and current quiet or stop settings. |

For the boss example, today's conversation creates an unresolved situation and a provisional next-day intention. Tomorrow's job reloads the latest context. “We talked and it is fine now” closes it. A newer concern can supersede it. If the situation remains relevant and timing is appropriate, Vox can ask, “How did today go—any better with your boss?” It then follows the answer rather than insisting on completing its original plan. A changed subject is a reason to follow the user's lead; silence gives little evidence about the underlying feeling.

The action vocabulary can include `acknowledge`, `listen`, `ask_one_question`, `offer_help`, `follow_up`, `defer`, `close_topic`, and `stay_quiet`. These are proposed Vox labels. Use a deterministic runtime for quiet hours, explicit stops, duplicate prevention, cancellation, and version checks. A delayed decision must not act on an obsolete conversation snapshot. Separate deciding whether outreach is justified from choosing its topic, and compose wording only after an action survives those checks.

Memory quality deserves its own evaluation. **LongMemEval** tests knowledge updates, temporal reasoning, extraction, multi-session reasoning, and abstention; these make useful tests for changed circumstances and false assumptions. It does not evaluate unsolicited timing. ([ICLR paper](https://proceedings.iclr.cc/paper_files/paper/2025/file/d813d324dbf0598bbdc9c8e79740ed01-Paper-Conference.pdf), [benchmark code](https://github.com/xiaowu0162/LongMemEval)) **LoCoMo-Conv**, a September 2026 preprint, tests retrieval when users imply needs rather than explicitly request memories. In its setup, naive retrieval recall fell from 0.533 for direct dialogue to 0.312 for implicit queries. Its synthetic rewrites and model-based judgments limit generalization, but its “silent grounding” concept is valuable: memory can improve a response without being recited. ([Paper](https://arxiv.org/html/2609.03467v1), [evaluation code](https://github.com/MiuLab/LoCoMo-Conv/))

Useful implementation references include [airalogy/proactive-ai](https://github.com/airalogy/proactive-ai) for reconsiderable intentions, [Graphiti](https://github.com/getzep/graphiti) for temporal facts and episode provenance, and the current [Letta Code](https://github.com/letta-ai/letta-code) harness for persistent memory and scheduled work. These are candidates to inspect, not a benchmarked recommendation to replace Vox's architecture. Vox's existing [memory strategy](/Volumes/Workspace/Ludaxis/vox/docs/AGENT_MEMORY_STRATEGY.md) is relevant local background, but a proposal is not shipped behavior.

## Voice should adjust communication without claiming certainty

**The transcript and audio routes differ.** The documented GPT-Live Decisions integration forwards conversation transcripts; it does not automatically give Decisions vocal tone. Realtime voice-to-voice processing exposes tone and inflection to an audio-capable model, but access to those signals does not establish accurate knowledge of private feelings. ([Decisions voice integration](https://developers.openai.com/api/docs/guides/decisions-voice), [Realtime audio](https://developers.openai.com/api/docs/guides/realtime-conversations#audio-inputs-and-outputs)) Cross-language speech-emotion robustness remains an active research problem; a 2026 Interspeech study specifically addresses degradation on unseen target languages. It does not benchmark Vox or OpenAI's voice models. ([Study](https://arxiv.org/abs/2606.06200))

I recommend combining explicit words with temporary acoustic observations, such as slower delivery or longer pauses, while retaining uncertainty about fatigue, surroundings, and recording conditions. That can justify softer wording or fewer questions without announcing “you are sad.” The user's correction should override the interpretation. Evaluate target languages, mixed-language speech, noise, and individual variation before using acoustic cues for consequential decisions.

Similarly, learn culture through the person's communication: preferred language, formality, humor, greetings, and occasions they mention. Do not derive intimacy, religion, or emotional needs from nationality, accent, or gender. Warmth should remain available without escalating personal questioning. Vox should be able to end a conversation naturally, remember without displaying the memory, and stop revisiting a topic. Nonresponse should reduce immediate contact pressure, not trigger stronger affection or guilt.

## Validate useful initiative before automating broader change

Use two learning speeds. Update this person's corrected facts and reversible preferences promptly. Change global routing policies, prompts, or models through versioned evaluation and rollout. Record context, candidate action, policy version, actual decision, and observed outcome; an estimated probability is not an outcome. OpenAI's evaluation guidance supports representative task-specific cases, human calibration, and ongoing regression evaluation. ([Evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices))

Begin with multilingual, multi-day replay cases: a conflict resolves before follow-up, a tired-sounding user reports being happy, an unanswered message, a topic boundary, and private/group context crossings. Run shadow decisions without sending messages and separately assess memory updates, routing, timing, cancellation, and wording. Then introduce ordinary initiative to a selected live pilot with visible controls and natural corrections, without permission prompts for every follow-up.

For eligible low-stakes opportunities, compare outreach with **no message**, measuring welcome timing, usefulness, unwanted contact, memory corrections, and progress on the user's actual situation. Do not withhold requested reminders. HeartSteps demonstrates the experimental value of randomizing an intervention against no intervention and observing changing effects over time; its physical-activity findings cannot be transferred to affectionate messaging. ([Trial](https://pmc.ncbi.nlm.nih.gov/articles/PMC6401341/)) No reviewed evidence establishes a universal best check-in frequency. Reply rate alone cannot distinguish benefit from obligation; include interviews and longer-term satisfaction and control.

The original product-development loop should remain a separate workstream. Convert recurring friction into minimally necessary product evidence, cluster issues, reproduce failures, propose changes, test them, and release through feature flags with rollback. Keep personal narratives in relationship memory rather than copying them into developer issues. Existing settings and workflows can adapt immediately where supported; new executable features need an evaluated development pipeline. None of the relationship studies validates autonomous production changes.

For Vox, I would make these five concrete design decisions:

1. **Make contextual initiative normal:** ordinary follow-ups require no repeated approval, while stop, quiet-hours, and privacy controls remain straightforward.
2. **Store provisional intentions:** every planned outreach is reconsidered against current context; no-action and topic closure are successful outcomes.
3. **Keep evidence separate from interpretation:** source-backed facts, temporary cues, corrections, expiry, and individual preferences have explicit lifecycles.
4. **Optimize for useful interaction:** validate shadow behavior, then compare selected live outreach with silence; reject reply maximization as the sole objective.
5. **Separate personal adaptation from product change:** update relationship state promptly, evaluate global policies, and route feature development through tested releases.
