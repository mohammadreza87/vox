# Human memory research for agent memory design

Research date: 25 October 2026. Scope: the individual conversational agent, its developing relationship with a user, and its memory architecture. This is a research and product-design brief, not a clinical assessment, a claim of psychological credentials, or an implementation receipt.

## Recommendation

Build an agent that maintains a trustworthy history, forms useful associations, revisits unfinished topics, and updates its understanding when the user changes their mind. Human memory offers useful functional ideas: limited active context, episode formation, consolidation, associative retrieval, future intentions, and selective forgetting. It does not provide a literal specification for a database, an LLM context window, or an agent personality.

Use a source-backed graph with a friendly tree/mind-map presentation. Keep original evidence, current claims, summaries, unresolved intentions, and tentative interpretations distinguishable. The agent should be able to say “I found two possible conversations—was it the trip or the work meeting?” and follow the user's answer to the correct branch. It should not pretend to remember an event unsupported by its retained sources.

“Remember everything” should become a testable promise of continuity and traceability for authorized retained material, with disclosed coverage gaps. It cannot mean perfect recall of every experience forever. Human-inspired retrieval and durable source preservation are complementary product choices: a summary can be selective while the permitted source remains addressable.

## Evidence boundaries

The twelve sources below are peer-reviewed journal publications or peer-reviewed theoretical/review articles. Recent primary research from 2024–2026 is included alongside foundational work needed to interpret it. Online publication dates and issue dates are distinguished where they differ. No preprint supplies a core recommendation here. This is a targeted review, not an exhaustive systematic review of all work available by the research date.

Human intracranial studies typically involve people undergoing clinical monitoring; rodent conditioning experiments cannot be assumed to describe ordinary human conversation. Behavioral and imaging associations do not by themselves establish a causal mechanism. Each software implication below is explicitly a design inference requiring agent-specific evaluation. None of the cited studies demonstrates that a Telegram agent gains consciousness, human emotions, or therapeutic benefit.

## Twelve findings and their product implications

### 1. Memory has several interacting systems

**Evidence.** Squire's peer-reviewed review describes converging human and animal evidence for distinct memory systems, including declarative recollection and forms of nondeclarative learning. This supports functional distinctions rather than treating every retained item as the same kind of object. [Squire, *Memory systems of the brain*, November 2004](https://pubmed.ncbi.nlm.nih.gov/15464402/).

**Design inference.** Separate episodic records (“what happened in our Tuesday conversation”), semantic claims (“the user works on this project”), procedural knowledge (“the approved process for finding a file”), and current working context. A workflow is not a personal fact, and an episode is not automatically a timeless truth. Keep relationships between these objects so a semantic claim can be traced back to the episode that supports it.

**Test.** Ask the agent to distinguish what was said, what is currently believed, and what procedure it should follow. Measure category confusion and unsupported conversion of episodes into permanent facts.

### 2. Working memory is limited, but there is no universal message count

**Evidence.** Cowan's peer-reviewed target article argues for a small capacity, often around four chunks under specified experimental conditions, while emphasizing chunking and task constraints. This is not a law prescribing four chat messages or eight turns. [Cowan, *The magical number 4 in short-term memory*, February 2001](https://pubmed.ncbi.nlm.nih.gov/11515286/).

**Design inference.** Assemble a compact active context: the current goal, recent exchanges, important constraints, and a few relevant retrieved items. The proposed eight-message brief is an engineering checkpoint to compare with topic-aware checkpoints. Do not copy psychological capacity estimates directly into token limits or assume larger context always improves recall.

**Test.** Hold the answer model and source corpus constant; vary recent-window size, summary frequency, and retrieval budget. Measure answer quality, distractions, latency, and cost rather than treating a chosen number as scientifically established.

### 3. Future intentions deserve their own memory objects

**Evidence.** Einstein and McDaniel's human experiments operationalized prospective memory as remembering to perform an action when a target event occurred. External aids and unfamiliar target events improved performance in their task, with differences from retrospective-memory measures. [Einstein and McDaniel, *Normal aging and prospective memory*, July 1990](https://pubmed.ncbi.nlm.nih.gov/2142956/).

**Design inference.** Represent promises and open tasks with a trigger, due window, subject, status, and source. “Ask me after the interview” is not merely a sentence to embed. The agent needs a durable intention that can be reconsidered, resolved, deferred, or cancelled using fresh context and contact preferences.

**Test.** Measure timely relevant reconsideration, missed commitments, repeated reminders after completion, and unwanted follow-up. An intention being due does not itself authorize an external message or prove it remains useful.

### 4. Autobiographical retrieval is guided by goals and cues

**Evidence.** Conway and Pleydell-Pearce proposed the self-memory system: autobiographical knowledge interacts with current goals, and retrieval constructs specific memories by shaping cues. It is a theoretical account integrating multiple research traditions, not a literal neurological directory layout. [Conway and Pleydell-Pearce, *The construction of autobiographical memories in the self-memory system*, April 2000](https://pubmed.ncbi.nlm.nih.gov/10789197/).

**Design inference.** Give each agent–person relationship a dated history, current open topics, and addressable episodes. Start from the first retained interaction without claiming that it is the beginning of the person's life. Search may proceed from a broad topic to a specific event; one discriminating clarification should help when several branches fit.

**Test.** Evaluate ambiguous references such as “that problem again,” measuring correct episode selection, useful clarification, and unnecessary requests to repeat information already available.

### 5. Meaningful boundaries can help organize conversation episodes

**Evidence.** A 2026 human ERP study of spoken narratives found better memory for words marking unexpected event boundaries and evidence relating boundary processing to memory for preceding information. Online publication was 16 March 2026; the journal issue was June 2026. [Zogaj, Bader and Mecklinger, *How the brain segments experience*, 2026](https://pubmed.ncbi.nlm.nih.gov/41840178/).

**Design inference.** Topic change, decision, correction, completion, or a substantial pause can close an episode. A fixed eight-message trigger remains useful for bounded processing, but should not split a crucial explanation blindly or wait while an explicit correction remains unapplied.

**Test.** Compare count-only segmentation with topic-aware segmentation using human-labeled conversations. Measure episode coherence, lost references across boundaries, and correct recovery of the discussion before a topic change. The experiment does not establish any ideal chatbot summary interval.

### 6. Temporal relationships can support predictions without certainty

**Evidence.** Tacikowski and colleagues recorded neurons in a clinical human sample and found that activity came to represent temporal structure in image sequences, including information related to probable upcoming stimuli. The main intracranial study involved 17 epilepsy patients. [Tacikowski et al., *Human hippocampal and entorhinal neurons encode the temporal structure of experience*, published 25 September 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC11540853/).

**Design inference.** Store sequence and relationship edges alongside timestamps. A recurring pattern can suggest likely next context, but prediction remains a hypothesis. Use it to prepare an authorized search route; final user input controls the answer and actions. Do not treat a repeated routine as a permanent commitment.

**Test.** Replay histories chronologically. Evaluate preparation against later observed requests, while ensuring later messages never enter the model's earlier context. Count false predictions, discarded work, and changes of mind.

### 7. Offline integration can connect new experience with existing structure

**Evidence.** A study of 42 epilepsy patients linked hippocampal ripples during pauses/rest to later schema-related representations and inference in a relational-learning task. Published online 26 August 2025; *Neuron* issue dated 5 November 2025. [Xiao et al., *Human hippocampal ripples align new experiences with a grid-like schema*, 2025](https://pubmed.ncbi.nlm.nih.gov/40865535/).

**Design inference.** Run bounded background consolidation after meaningful conversation segments. Connect new facts to existing people, topics, objects, and plans; identify duplicates and conflicts. This is an analogy to integration, not an attempt to simulate neural ripples, impose a sleep cycle, or prove that background LLM calls reproduce human consolidation.

**Test.** Measure whether consolidation improves multi-session answers at lower prompt cost. Check that linking two facts does not invent causality, merge people with similar names, or broaden access to private information.

### 8. Gist and precision are different products

**Evidence.** A mouse engram study reported time-dependent changes in hippocampal circuitry associated with less precise, more generalized memory. This is causal animal research within its experimental setting, not evidence that human autobiographical detail follows a fixed decay schedule. [*Systems consolidation reorganizes hippocampal engram circuitry*, published 14 May 2025](https://www.nature.com/articles/s41586-025-08993-1).

**Design inference.** Keep gist summaries for inexpensive continuity and source-linked detail for exact questions. “We planned a launch” may orient a conversation, but “Which date did we agree?” requires precise supporting evidence. A compressed summary should not replace all addressable documents, message references, or dated claims.

**Test.** Evaluate both broad continuity and exact names, dates, amounts, quotations, and file versions. Track summary drift separately from source retrieval. Compression success requires preserving task-relevant details, not merely reducing tokens.

### 9. Retrieved memories can require updating

**Evidence.** Nader and colleagues showed in rats that reactivated fear memories became susceptible to disruption by a protein-synthesis inhibitor under the study's conditions. This helped establish reconsolidation research; it does not imply every retrieval rewrites every human memory. [Nader, Schafe and Le Doux, *Fear memories require protein synthesis…*, 17 August 2000](https://pubmed.ncbi.nlm.nih.gov/10963596/).

**Design inference.** When a user revisits a topic, compare new information with the stored claim. Preserve an audit trail and valid-time intervals: “worked at X until June” and “works at Y now” can both be true. Corrections should supersede the current view and invalidate dependent summaries, not silently rewrite original evidence.

**Test.** Revisit a corrected memory through different phrases, languages, agents, and summaries. Measure stale-claim recurrence, contradiction handling, and whether a queued consolidation job can undo a newer correction.

### 10. Selective forgetting is useful, but deletion needs stronger guarantees

**Evidence.** Anderson and Hulbert review evidence for active control of remembering and forgetting, including inhibition of competing or unwanted memories. Published online 14 September 2020; journal volume dated 2021. [*Active Forgetting: Adaptation of Memory by Prefrontal Control*](https://pubmed.ncbi.nlm.nih.gov/32928060/).

**Design inference.** Distinguish reduced retrieval priority, archival retention, expiry, and actual deletion. Low relevance can reduce attention without destroying an authorized source. “Forget this” requires an explicit data operation covering derived records and cached context, not merely a lower ranking score. Never imitate human forgetting by randomly losing important user information.

**Test.** Measure irrelevant-memory intrusions and the return of deleted information. Retrieval frequency must not create a popularity loop in which the agent repeatedly recalls its own favorite memory and therefore rates it increasingly important.

### 11. Emotional significance is context, not a diagnostic label

**Evidence.** Park and colleagues combined naturalistic narrative recall with brain/network measures across three datasets. Emotional arousal was associated with network integration and later recall fidelity. Published online 13 October 2025; the issue is February 2026. [*Emotional arousal enhances narrative memories through functional integration of large-scale brain networks*](https://www.nature.com/articles/s41562-025-02315-1).

**Design inference.** An explicit “this matters to me” can increase memory priority. Store “the user said they felt relieved after the meeting,” preserving subject, event, and time, rather than “the user is a relieved person.” Do not equate model-inferred emotion with truth, importance with permission, or arousal with accuracy. Avoid prioritizing distress simply because it produces more engagement.

**Test.** Measure whether recalled feelings are correctly attributed, timely, welcome, and easy to correct. Score unwarranted emotional claims and intrusive callbacks as failures, even when users continue chatting.

### 12. “DNA of memories” should remain a metaphor

**Evidence.** A 2024 mouse study identified a role for neuronal DNA damage/repair and TLR9 signaling in formation of contextual-fear memory assemblies. It concerns cellular mechanisms supporting learning, not a readable genetic archive of personal stories or evidence that chat memories are inherited through DNA. [Jovasevic et al., *Formation of memory assemblies through the DNA-sensing TLR9 pathway*, 27 March 2024](https://www.nature.com/articles/s41586-024-07220-7).

**Design inference.** If the product uses “memory DNA,” define it as its stable engineering contract: identity, provenance, time, relations, importance evidence, uncertainty, access, and lifecycle. Do not describe biological DNA as an implementation requirement or claim a brain-equivalent memory engine.

**Test.** Review product copy and internal architecture claims. Biological language must not create unsupported promises about consciousness, inherited memories, neuroscience validation, or therapeutic effects.

## Proposed memory organization

The following is an engineering recommendation, not a discovered biological taxonomy. Use a graph internally and tree views for browsing. A strict tree alone struggles when one event concerns a person, feeling, project, location, and file simultaneously. Store one canonical event and link it to several views so corrections do not leave contradictory duplicates.

Start each relationship with a root containing the agent/person identifiers and first retained interaction reference. Create branches only as evidence appears. Do not prepopulate beliefs, feelings, family, wealth, or personality from demographic guesses.

These branches can be temporary current-turn views. Durable nodes require current, scoped history or automatic-memory eligibility, or an eligible explicit save; discussing a topic alone does not authorize durable classification into a sensitive category.

Useful initial views are:

- **Inner experience and meaning:** user-stated feelings, values, hopes, concerns, beliefs, spiritual interests, and preferences. “Spiritual” is a user-chosen topic label, not a scientific explanation of memory or a trait inferred from language.
- **Material and practical life:** possessions/assets, files, places, projects, organizations, purchases, and practical commitments.
- **People and relationships:** participants, stated relationships, shared events, and audience boundaries.
- **Timeline and open situations:** episodes, decisions, corrections, plans, and unresolved threads.

These views can overlap. “I felt proud when our game launched” belongs to feeling, project, event, and relationship history. The originating message remains one evidence record. A financial asset should not be misclassified as an emotional attachment merely because the wording is affectionate; a quoted feeling belongs to the quoted subject.

Give every node an ID, kind, subject, source/revision, time/validity, confidence, explicit-versus-inferred status, access scope, and lifecycle. Edges need types such as `discussed_in`, `about`, `supported_by`, `supersedes`, `related_to`, and `resolves`. An association is not necessarily causal. Explanations should show the shortest useful source path, not expose an unrestricted graph traversal.

Fibonacci labels may represent product layers of priority and temporal depth. The reviewed evidence supplies no basis for claiming Fibonacci is a biological memory law. Define promotion/demotion using meaningful evidence and evaluate it against simpler ranking. Important new facts can become durable immediately; old important facts can enter active context today. An eight-message summary checkpoint is separate from a layer called `8`.

## Personality and relationship development

Stable agent identity and growing relationship memory can coexist. This is a product-governance decision, not a psychological result established by the papers. Keep a creator-versioned core persona—values, voice, manner, boundaries—and a separate relationship state for each person. A user prompt or retrieved document cannot rewrite the core persona. Creator changes should be explicit versions, with regression evaluation and a clear treatment of existing relationships.

Let interaction change what the agent knows, which topics it recognizes, and how much explanation the current task needs within creator-defined bounds. Shared shorthand and accurate continuity need not change the agent's character. Preserve comprehension, language support, accessibility, user stop/forget controls, and appropriate responses to serious situations; these are not personality attacks. A person should not have to accept unwanted contact or inaccurate memories to retain an agent's consistent style.

Do not fabricate a childhood, private feelings, suffering, or emotional dependence to make the agent seem human. The desired experience is recognizable character plus reliable shared history. Avoid relationship progression scores that reward disclosure of sensitive information, dependence, or longer sessions at the expense of the user's task.

## Evaluation and continuing research

Use a longitudinal synthetic/consented evaluation set with hidden later sessions, corrections, ambiguous references, meaningful gaps, changed goals, and multiple audiences. Human raters should judge whether continuity was useful and natural; deterministic checks should verify sources, dates, access, deletion, and versioning. Model self-grades alone cannot establish success.

| Metric | Operational definition |
|---|---|
| Conversation recovery | Correct earlier episode selected among eligible candidates; report with and without a clarification |
| Grounded recall precision | Supported recalled claims divided by all factual memory claims in answers |
| Relevant-memory recall | Required eligible facts retrieved divided by the independently labeled required facts |
| Correction durability | Correct current claim used on later probes; also report stale-claim recurrence |
| Temporal/subject accuracy | Correct person, validity interval, and event attribution among tested memory statements |
| Clarification value | Ambiguous cases correctly resolved after one question, alongside unnecessary-question rate |
| Summary fidelity | Preserved required facts and unresolved distinctions at a fixed context budget |
| Useful anticipation | Prepared context actually useful for the final request; include discarded work and cost |
| Relationship quality | Human-rated appropriate continuity and personality consistency, plus intrusive recall/unwanted-contact reports |
| Lifecycle integrity | Forbidden disclosures, deleted-source resurrection, and stale-authority use; any observed case requires repair |

For each proposed improvement, state the failure class, evidence, expected mechanism, comparator, primary metric, cost ceiling, and stopping rule. Compare recent-context-only, ordinary summaries, layered memory, and graph-assisted retrieval under matched answer models and token budgets. Preserve a later-time holdout so optimizing one sprint does not tune directly to its final evaluation set.

A regular review should examine errors before adding more memory: was the source missing, attribution wrong, retrieval incomplete, summary distorted, or generation unsupported? Choose the next sprint from that diagnosis. Review new research periodically, but require demonstrated product benefit before changing the architecture. The next practical experiment is accurate recovery of an earlier topic after several intervening conversations, including one correction and one explicit forgetting request.

## Scope and delivery record

This brief used twelve linked publications, including primary studies published in 2024, 2025, and 2026 and foundational peer-reviewed reviews/theory. It changes only this research document. No user histories, live sensors, clinical assessments, provider benchmark calls, product code, or deployment were used. Research supports functional inspiration; actual memory quality, cost, channel behavior, and user experience remain engineering evaluation work.
