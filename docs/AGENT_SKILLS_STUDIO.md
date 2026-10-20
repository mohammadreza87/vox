# Vox agents: a premium skill library, a human voice and a smarter creation flow

Prepared 20 October 2026 on branch `feat/agent-skills-studio` (base `d56dfa7`, which is `develop` plus step 0 of `AGENT_INTELLIGENCE_SOLUTION.md`).

The ask: agents "talk like a stupid bot". We want world-class role skills and knowledge for lifestyle, tech, AI, mobile and publishing teams, a premium but minimal creation flow, and smart decision routing. This document says what was built, why, what was decided along the way, and what is still unverified. The research behind it is in `docs/agent-skills/`:

| Document | What it holds |
|---|---|
| [LANDSCAPE.md](agent-skills/LANDSCAPE.md) | GitHub skills landscape (53 repos verified via the GitHub API), what makes top skills excellent, licence register, caveats |
| [VOICE.md](agent-skills/VOICE.md) | Why agents sounded robotic (traced to code), the voice charter, persona drafting rules, Persian register, eval kit |
| [CREATION_UX.md](agent-skills/CREATION_UX.md) | Teardown of 13 agent builders, principles, the new Brief and Persona steps state by state |

It builds on `AGENT_INTELLIGENCE_SOLUTION.md` and does not change its privacy spine. Because skills make the stable part of each prompt larger, this branch also turns on the simplest form of that plan's prompt caching (§4.7): the stable prefix is sent as one cached block.

---

## 1. Why agents sounded like bots

Measured on a typical persona with the real `buildSystemPrompt` (see VOICE.md §1):

1. **The persona was told, not shown.** A third-person bio plus an expertise list, no example of how the agent talks, so Claude fell back to its default assistant voice. What the creator wrote was 14% of the prompt; rules were 44%.
2. **Rules scripted the replies.** They handed the model sentences it repeated verbatim. The Personal branch literally called the agent "an AI assistant".
3. **Thinking ate the reply budget.** Sonnet 5.5 and Haiku 5.5 think by default and `max_tokens` includes thinking. With caps of 400/700 (300 on live calls) and no `effort`, replies could come back empty and fall back to an English "Sorry, I lost my train of thought" even in Persian chats. The sandbox Test chat (500 tokens) had the same problem: the first impression of every new agent.
4. **No craft.** Roles were a title and a free-text expertise list; nothing told the agent how a great UA lead or sleep coach actually works.
5. **Markdown leaked into Telegram** as raw `**` and `#`.
6. **Not changed here, and the biggest single cause:** in production, chat history and memory are off pending consent work (`AGENT_INTELLIGENCE_SOLUTION.md` §3.2), so every message is answered cold. That is a product and DPIA decision, out of scope for this branch.

## 2. What was built

### 2.1 The skill library (`src/lib/studio/skills/`)

| Pack | Space | Roles | Skills |
|---|---|---:|---:|
| Core (shared) | both | – | 15 |
| Lifestyle | personal | 11 | 55 |
| Tech company | work | 12 | 60 |
| AI company | work | 9 | 42 |
| Mobile company | work | 11 | 52 |
| Game Publisher (incl. book editor) | work | 11 | 48 |
| **Total** | | **54** | **272** |

- **A skill** is a practitioner playbook: a "Use when…" trigger, a 3–7 step method, a quality bar, pitfalls, named frameworks, the deliverable shape, licensed sources and Persian copy.
- **A role** bundles:
  - a mission;
  - specific domain knowledge;
  - a point of view it argues for;
  - a voice;
  - honest limits;
  - 3–6 default skills plus optional ones;
  - three "ask me" starters;
  - a cloud hue, default traits, routing keywords in English and Persian, and Persian copy.
- **The catalog is code.** It is reviewed like code and validated at load by `catalog.ts` and `schema.ts`, which check limits, namespacing, duplicate ids and dangling references. A broken catalog fails tests and startup, never a prompt. `catalogView()` is the client-safe projection without playbook bodies.
- **Content standard** (`LANDSCAPE.md` §3): the wording is original, inspired by permissive sources (MIT, Apache-2.0, CC0) and cited.
  - Non-commercial, share-alike and leaked-prompt repositories were not used.
  - Authors verified date-sensitive facts as of October 2026 and corrected the research matrix where it was wrong. Examples: EU AI Act dates after the Digital Omnibus (Reg. 2026/1744), OWASP Top 10:2025, DORA's current metrics, Play target API 36, Xcode 26, PEGI paid-random-items rules, Brazil's ECA Digital, and the amended COPPA rule.
- **Lifestyle safety is part of quality.** These roles are coaches and educators, never clinicians, dietitians, therapists or financial advisers. Each has explicit red flags and referral steps.
  - The crisis protocol lists verified numbers (Iran 115, 110 and 123; 988; 116 123; 112) and otherwise points to findahelpline.com.
  - The money coach plans in real terms for high-inflation economies and never names an asset.
  - The travel planner covers Iranian-passport realities and tells people to confirm entry rules with official sources.

### 2.2 How a role reaches the model

`persona.roleId` and `persona.skillIds` (at most 8) are stored on the agent.

- **Rendering:** `org-bridge.ts` renders them with `renderCraft()` into a `<craft>` block in the stable part of the system prompt, and caches the result per catalog.
- **What the craft block says:** use the skills quietly, give results rather than steps, and never claim an analysis or data you don't have.
- **Budget per skill:** 1,500 characters, about 375 tokens. The median authored playbook (about 1,340 characters) renders in full; long ones drop their least essential lines first.
- **Total size:** the median craft block is about 2.2k tokens.

The system prompt is now ordered stable-first (`tireh/conversation/prompt.ts`):

| Part | Contents | Size |
|---|---|---|
| Stable, byte-identical across speakers, chats, dates and capabilities | identity → `<character>` (personality, opinions, signature moves, pet peeves) → `<voice>` charter → `<craft>` → `<voice_examples>` → `<rules>` | about 3.5–4k tokens with a role |
| Volatile | conversation and audience → people/org (where allowed) → live info → voice capability → this turn (date, delivery) → memories → conflicts → a one-line reminder that the rules outrank everything after them | about 0.1–0.5k tokens |

- **Caching:** `AnthropicLLM` sends everything up to the closing `</rules>` tag as its own `cache_control` block (`cachedSystem` in `tireh/llm.ts`). Repeat turns within five minutes read it at a tenth of the input price; prompts without the tag stay plain strings.
- **Tag safety:** creator-written persona text (name, role, character fields, voice examples) has the prompt's own section tags stripped, so it cannot close `<character>` and forge a `<rules>` block.
- **Privacy:** every rule keeps its meaning and every test-pinned privacy string still holds. Two scripted refusal sentences now say "decline briefly in your own words".

### 2.3 The voice

- **Voice charter** (`tireh/conversation/voice.ts`), about 400 tokens and part of every agent:
  - lead with the answer and have a view;
  - mirror the person's language, register and length;
  - ask one question at most;
  - no stock lines, with banned clichés listed in English and Persian.
- **Persian register:** everyday chat Persian, شما until they use تو, their English work terms, and a short ta'arof beat before the substance.
- **Persona drafting** (`studio/persona.ts`):
  - **New rules:** vivid and specific, banned adjectives unless shown through behaviour, one likeable flaw, Persian register.
  - **New fields:** `opinions`, `signatureMoves`, `petPeeves`, `voiceExamples`. The sample exchanges are written in the same single drafting call, using the role's starters as the user lines.
  - **Example screening:** examples written in clichés or markdown are dropped rather than taught to the agent.
- **Model calls:**
  - Chat replies run at `effort: low` with headroom for thinking (quick 1,200, thoughtful 2,000, live 800 tokens).
  - Persona design runs at `effort: medium`.
  - The sandbox Test chat and stranger handling got the same fix.
- **Output cleanup:**
  - Replies are stripped of markdown once (`toPlainChat`).
  - An empty reply gets a fallback in the speaker's language and a content-free `reply_empty` diagnostic.

### 2.4 Decision routing (`skills/route.ts`, `POST /api/studio/catalog/route`)

The creator just describes who they need, in English or Persian.

- **While typing** (700 ms after a pause): the server's **local router** answers with no third-party call.
  - It normalises Persian and Arabic letter forms, ZWNJ and digits, applies light stemming, and weights keywords by rarity and by work-versus-personal cues.
  - Confidence is calibrated to the UX thresholds.
  - It has its own `route` rate budget (90 per minute) so editing never hits the 30-per-minute mutation limit.
- **On Draft** (`final: true`): one **OpenAI Decisions** request.
  - The questions are a `pack` choice plus one `role_<pack>` choice per pack: at most 6 questions and 16 choices, within the stricter `DecisionService` limits.
  - The brief is framed as data, never instructions.
  - It has a 1.5 s timeout, falls back to local on any failure, logs only content-free diagnostics, and spends the `expensive` budget.
- **Thresholds** (one constant, tunable):

  | Result | Rule | What the creator sees |
  |---|---|---|
  | Match | confidence ≥ 0.75 with a margin ≥ 0.15 | Applied as a removable card |
  | Ambiguous | below a match | At most one clarifying question after Draft: "For work or your personal life?" or "Which is closer?" |
  | None | confidence < 0.40 | Stays custom |
  | After an answer | applies at ≥ 0.55 | |

- **Sample checks by the content authors:** 22 of 23, 20 of 22, and the UX spec's example "Someone to run UA for our puzzle game launch in Turkey" routes to `mobile.growth-ua` at 0.81.
- **Server-side checks on draft:**
  - `Studio.draft` rejects unknown roles with a 400, filters and caps skills, applies the role's hue, and passes the role to the persona designer.
  - Library ids returned by Claude are removed: the server sets them, never the model.

### 2.5 The creation flow (`src/app/studio/_components/screens/spawn/`)

The Brief step is now one composer under "Who do you need?":

1. **Examples:** real examples rotate in the input, in English and Persian.
2. **Browse instead of typing:** an empty composer offers the five packs. They open a role sheet with still mini clouds in each role's hue.
3. **Live suggestion:** a confident route quietly applies a role card: hue cloud, title, one line, toggleable skill chips. ✕ keeps it custom, with Undo, and that role is never suggested again.
4. **One question at most:** an ambiguous route asks only after Draft, once, and "Skip, draft as written" is always there.
5. **Fine-tune:** presentation, languages, culture, age, accent and temperament sit behind one row that reads "Claude decides". Traits are now sent only if a slider was moved; before, a 50/50/40 bias went into every draft.
6. **Successors** start with the predecessor's role and skills.

The Persona step leads with the role line and shows:

- skill chips, with an add sheet capped at 8;
- a "How they talk" card built from `voiceExamples`;
- refine-by-instruction, pinned above the call to action, with changed fields highlighted.

Motion uses the existing ease tokens, with one animated cloud on screen, haptics only on user-caused changes, 44 px targets, focus-managed sheets, reduced-motion support and RTL for Persian briefs. The screens themselves stay English for now. The Persian copy is written, and switches on once all six steps are translated, so the flow never changes language halfway.

## 3. Decisions taken on your behalf

| Decision | Why | How to change |
|---|---|---|
| Brief text goes to OpenAI only on Draft, never while typing | Privacy and cost; the local router is good enough for live suggestions | `final` flag in `useRouting.ts`; the UI doesn't change |
| "Publisher" means game publisher (mobile-first plus PC/console), plus a book-editor role | Ludaxis is a game company | Add or rename roles in `packs/publisher.ts` |
| "Lifestyle" means personal-life coaches (body, mind, money, plans, home, learning, career, relationships, cooking) | Matches "full lifestyle agents" | `packs/lifestyle.ts` |
| Skill render budget is 1,500 characters | The full playbooks were being cut to 4 steps at 900 | `SKILL_CHAR_BUDGET` in `render.ts` |
| Cache the stable prefix (5-minute TTL) | Skills add about 2–3.5k tokens per turn; caching makes repeat turns cheap | `cachedSystem` in `tireh/llm.ts`; tools still come first in the cache key, so a turn that adds web search misses it |
| Screens stay English (Persian input works) | Avoid a half-translated flow | `spawn/copy.ts` already has `fa` |

## 4. Verification

- `npx tsc --noEmit` is clean, and eslint is clean on every changed file.
- `npx vitest run src/lib/studio src/lib/tireh src/app/studio src/lib/adaptive/decisions`: 1,766 of 1,779 tests pass.
  - 10 failures are `guest-rights-http.test.ts`, which cannot `mkdtemp` in `/tmp` inside this sandbox and is unrelated to this work.
  - 3 are 10-second timeouts under parallel load in `prepared-conversation-qualification` and `PreferenceLearningPanel.integration`; both files pass when run alone (11/11), and the base commit shows the same timeouts.
- Two independent reviews (backend/privacy and frontend) ran against the branch. Their confirmed findings are fixed. Among them:
  - Markdown cleanup no longer touches code, maths or comparisons.
  - Persona text can no longer forge prompt tags.
  - The craft cache is bounded.
  - A broken catalog now fails soft in production.
  - Single-option clarifiers are shown.
  - Leaving mid-Draft no longer leaves an orphan draft.
  - Double-tapping Next no longer skips a step.
  - The brief is frozen while Draft resolves.
  - Persona skill saves are serialised.
  - Persian overlines are no longer letter-spaced.
  - Touch targets are 44 px.
- New tests cover:
  - catalog validation;
  - the router (English and Persian, exclusions, answers, clarify, a Decisions happy path, timeouts and refusals);
  - HTTP (403 for pending members, 400s, budgets);
  - service (role and skill validation, refine merge, PATCH);
  - the voice charter and stable-prefix ordering;
  - markdown stripping and localised fallbacks;
  - the creation flow (14 tests) and the routing reducer.
- **Voice eval on the real model** (`npm run eval:voice`, `claude-sonnet-5-5` at effort low, 16 prompts in English and Persian across four agents built from the real library):
  - **What works:**
    - No clichés or AI disclaimers.
    - Clear pushback on bad ideas (skipping QA, a Friday-night release, a juice cleanse), each with a better alternative.
    - An honest "No, I'm an AI" when asked.
    - Responds to the person first in emotional messages.
    - Natural everyday Persian, with ta'arof handled («مزاحم نیستید، بفرمایید») and work loanwords kept (ریلیز، ریتنشن).
  - **First run:** 11 of 16 replies passed the automatic lint.
    - Misses were length, two questions, and one register error: a تو greeting answered with شما.
    - The cause of the register error was the persona's own Persian voice examples, which reply with شما.
    - The charter now spells out length, one question with the other assumption stated, تو mirroring with verb forms, and names in the reply's script. The examples block says examples set tone, not register.
  - **After tuning:**
    - The تو greeting is answered with «تو چطوری؟».
    - Replies are shorter (the D7 analysis went from 173 to 141 words).
    - The formal-Persian and vague-plan items now pass.
  - **Remaining flags, needing a native reviewer rather than more tuning:**
    - long expert answers where depth helps (sample-size maths);
    - a greeting returned with a second question;
    - an occasional Latin name in a Persian reply;
    - one Finglish answer that switched script.
- **Not verified:**
  - Beyond the voice eval above, no model behaviour was measured (routing with real Decisions, live calls).
  - The flow has not been seen in a real browser.
  - The Persian copy has not been reviewed by a native speaker.

## 5. Next steps

1. **Have a native Persian speaker score the eval's Persian replies** (LLM judges are unreliable on Persian role-play). Rerun it after any charter change:
   ```bash
   npm run eval:voice -- --only F
   ```
2. **Look at the flow in Telegram**, using the visual checklist in `CREATION_UX.md` §3.5 and the frontend notes in the branch's PR.
3. **Domain review of the Lifestyle and Publisher packs** before launch. These have the least prior art and the highest stakes (health, money, crisis, legal).
4. **Turn conversational continuity back on** under consent (`AGENT_INTELLIGENCE_SOLUTION.md` step 4). No prompt work compensates for answering every message cold.
5. **Measure caching:** check `cache_read_input_tokens` in the turn telemetry. A 1-hour TTL may pay off for agents people talk to every few minutes.
6. **Watch the state document:** the new persona fields add about 3–6 KB per agent at their limits. On Firestore the whole studio state is one document with a 1 MiB cap, so trim fired agents or split agents out before that becomes the limit.
7. **Later:**
   - per-turn skill selection with Decisions (inject only the matching playbook);
   - Persian screens once all six steps are translated.

### Also fixed in this branch (found while reviewing)

- **The same token-budget bug in other Claude calls.** Each now sends an effort level and has room for thinking:

  | Call | maxTokens | Effort |
  |---|---|---|
  | relationship check-ins (`relationships/compose.ts`) | 768 → 2,048 | low |
  | memory extraction | 1,024 → 3,072 | low |
  | reviewed memory | 700 → 2,048 | low |
  | message memory | 1,200 → 3,072 | low |
  | the relationship assessor | 1,600 → 4,096 | medium |
  | connections task steps | 1,800 → 4,096 | medium |

  Each connections task step's daily-budget reservation now uses the same 4,096, so the reservation matches what a step can spend.
- **Telegram's Back closes an open role or skills sheet** instead of leaving Spawn (`nav.guardBack`, `useBackGuard`).
- **A successor's creator gets the predecessor's role even when not an admin.** `GET agents/:id/successor` returns only name, roleId and skillIds, under the same rules as drafting a successor.
- **Refine can clear a character list** ("drop the pet peeves"); lists Claude merely left out are kept.
- **Personal-space prompts never name the work organisation,** even inside Claude-written taglines or examples.
