# Skills landscape and role-skill matrix for Vox

*Research date: 2026-10-20. Star counts, licences and last-push dates come from the GitHub REST API (unauthenticated, about 13:31 local time) unless marked otherwise. The matrix it drafted now lives in code: `src/lib/studio/skills/packs/*.ts`.*

## 0. Executive summary

- **The format has settled.** Anthropic's `SKILL.md` (YAML `name` + `description`, a Markdown body, optional `references/`, `scripts/`, `assets/`) is now the open Agent Skills standard (spec moved to agentskills.io). OpenAI Codex uses the same folder format and adds an `agents/openai.yaml` UI manifest. `openai/skills` is deprecated in favour of `openai/plugins`. Vox can adopt one skill format that matches both ecosystems.
- **The most-starred libraries are engineering-first.** obra/superpowers (302k), mattpocock/skills (298k) and anthropics/skills (182k) lead on stars, and all three teach *how to write skills* better than any other source. For **business roles**, the deepest sources are Anthropic's `knowledge-work-plugins` (Apache-2.0 role plugins for PM, marketing, sales, finance, legal, HR, support, data, design and ops), `coreyhaines31/marketingskills`, `phuryn/pm-skills`, `alirezarezvani/claude-skills` and `msitarzewski/agency-agents`. All are MIT or Apache, so they are safe to learn from.
- **Two Vox packs have almost no good GitHub prior art.** **Lifestyle** (personal coaching) has only thin one-paragraph "Act as a..." prompts (prompts.chat, CC0). **Game publishing** (producer, BD, localisation, platform relations, publishing analytics) is the same: Claude-Code-Game-Studios covers game *development*, not publishing. These two packs can set Vox apart, but they need a domain-expert review before launch.
- **What makes skills premium is structure, not length.** The best skills share these traits: a trigger-only description, a context-first intake, a step method where each step ends on a completion criterion, an exact deliverable template, a self-check quality bar, named failure modes, references kept out of the main body, and evals with assertions. Section 3 covers each with evidence.
- **Licence traps:** Anthropic's docx/pdf/pptx/xlsx skills are proprietary. Leaked-prompt repos (x1xhlol, CL4R1T4S, LouisShark, linexjlin, jujumilk3, ai-boost) contain third-party prompts and must not be reused. hesreallyhim/awesome-claude-code (CC BY-NC-ND), deanpeters/Product-Manager-Skills (CC BY-NC-SA) and lawve-ai/awesome-legal-skills (CC BY-NC-ND) are non-commercial. trailofbits/skills is CC BY-SA, so anything derived from it must carry the same licence.
- **Even top skills contain wrong facts.** One example: a highly starred EU AI Act skill says Article 50 transparency duties apply from 2 Aug 2025. Under Article 113 they apply from 2 Aug 2026. Vox needs a fact-verification pass and dated sources inside every regulated skill.
- **Matrix delivered:** 15 core skills plus 5 packs with 54 roles and 245 role skills, 260 skills in total. Every skill has an id, a trigger, a method, a deliverable, a quality bar, pitfalls, frameworks and licensed sources.

## 1. Method and verification

1. Started from the candidate list, then ran discovery searches for business-role, game, ASO/mobile, legal, EU AI Act and lifestyle skill libraries.
2. Verified 53 repos with `GET /repos/{owner}/{repo}` (stars, SPDX licence, `pushed_at`, archived). For repos where GitHub reports `NOASSERTION` or no licence, I read the LICENSE or README directly.
3. Shallow-cloned and read the actual skill files of the 12 most relevant repos: anthropics/skills (skill-creator, internal-comms, discernment-nudge), anthropics/knowledge-work-plugins (legal review-contract, PM write-spec, support ticket-triage), obra/superpowers (writing-skills, brainstorming), mattpocock/skills (writing-for-agents, grill-me), coreyhaines31/marketingskills (aso, product-marketing, evals), msitarzewski/agency-agents (economy-designer), alirezarezvani/claude-skills (SKILL-AUTHORING-STANDARD, ai-act-readiness), Donchitos/Claude-Code-Game-Studios (live-ops-designer, launch-checklist), openai/skills (define-goal + openai.yaml), wshobson/agents (avoid-ai-writing), contains-studio/agents and danielmiessler/Fabric patterns. I also checked which Fabric patterns exist.
4. Wrote original skill outlines. Nothing is copied verbatim. Each skill cites what inspired it and that source's licence.

## 2. Ranked repo landscape

Ranked by stars. **Format** codes: `SKILL.md` = Agent Skills folders; `agent.md` = Claude Code subagent/persona files; `prompt` = plain prompts; `list` = curated index; `plugin` = plugin bundles of skills, commands and agents. **Reuse**: ✅ permissive (cite), ⚠️ conditions apply, ⛔ do not reuse content.

| # | Repo | Stars | Licence | Last push | Format | What's great / why it matters for Vox | Reuse |
|---|---|---:|---|---|---|---|---|
| 1 | [obra/superpowers](https://github.com/obra/superpowers) | 302,357 | MIT | 2026-10-20 | SKILL.md | Best guide to *writing* skills: TDD for skills (watch an agent fail without the skill, then write the minimum fix), "description = when to use, never a workflow summary", rationalisation tables, "match the form to the failure". Its brainstorming skill asks one question per message. | ✅ |
| 2 | [mattpocock/skills](https://github.com/mattpocock/skills) | 298,038 | MIT | 2026-10-19 | SKILL.md | Small composable skills. `writing-for-agents` names the key levers: context pointers, steps that end on a **completion criterion** with high "demand", context load vs cognitive load, and progressive disclosure. `grill-me` is a relentless interview pattern. | ✅ |
| 3 | [anthropics/skills](https://github.com/anthropics/skills) | 182,367 | Apache-2.0 per skill; **docx/pdf/pptx/xlsx proprietary** | 2026-10-09 | SKILL.md + spec | The reference implementation. `skill-creator` covers the eval loop (with-skill vs baseline runs, assertions, a viewer), description optimisation (20 should/should-not-trigger queries with near-miss negatives, 60/40 split, 3 runs each), 3-level loading, the <500-line body rule and "explain why instead of ALL-CAPS MUST". `internal-comms` routes to `examples/` per message type. | ⚠️ (doc skills ⛔) |
| 4 | [f/prompts.chat](https://github.com/f/prompts.chat) (ex awesome-chatgpt-prompts) | 173,629 | Prompts CC0-1.0, code MIT | 2026-10-20 | prompt (CSV) | Widest set of "Act as a..." role personas, covering most lifestyle roles (travel guide, chef, life coach, dietitian, career counsellor). CC0 means free reuse, but the prompts are one paragraph with no method or quality bar. | ✅ |
| 5 | [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) | 161,955 | MIT | 2026-10-19 | agent.md | The closest analogue to Vox "AI colleagues". Persona-first files (identity and memory, critical rules, deliverable templates, workflow, communication style, success metrics) across divisions including game-development (economy designer, game designer), marketing (incl. ASO), paid-media, finance, healthcare and a "specialized" group with life-adjacent roles. | ✅ |
| 6 | [x1xhlol/system-prompts-and-models-of-ai-tools](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools) | 144,120 | GPL-3.0 (contents are third-party leaked prompts) | 2026-10-12 | prompt | Leaked product system prompts. Study only for a high-level sense of structure. Never copy. | ⛔ |
| 7 | [dair-ai/Prompt-Engineering-Guide](https://github.com/dair-ai/Prompt-Engineering-Guide) | 79,365 | MIT | 2026-03-11 | guide | Taxonomy of prompting and context-engineering techniques, with a teaching angle. | ✅ |
| 8 | [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) | 77,480 | README badge says Apache-2.0; no LICENSE file detected (UNVERIFIED) | 2026-09-18 | list + skills | Discovery index of community skills. | ⚠️ |
| 9 | [openai/openai-cookbook](https://github.com/openai/openai-cookbook) | 76,712 | MIT | 2026-10-20 | notebooks | Evals, structured outputs and prompting guides. Reference for the AI pack. | ✅ |
| 10 | [PlexPt/awesome-chatgpt-prompts-zh](https://github.com/PlexPt/awesome-chatgpt-prompts-zh) | 63,790 | MIT | 2026-04-28 | prompt | Chinese role-prompt guide. Low relevance. | ✅ |
| 11 | [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) | 56,068 | CC BY-NC-ND 4.0 | 2026-10-20 | list | Curated index. Use for discovery only. | ⛔ |
| 12 | [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) | 55,601 | MIT | 2026-10-19 | SKILL.md + references + evals | **Best-in-class business skills** (52 skill folders). A shared `product-marketing.md` context doc that every skill reads first. Per-skill `evals/evals.json` with assertions. Weighted scoring rubrics in `references/`. Brand-maturity tiers that calibrate the audit ("is this a mistake or a data-informed choice?"). Outputs that state character limits. An explicit rule that fetched pages are untrusted data. | ✅ |
| 13 | [anthropics/claude-cookbooks](https://github.com/anthropics/claude-cookbooks) | 53,593 | MIT | 2026-10-17 | notebooks | RAG, contextual retrieval, tool use, agent patterns. | ✅ |
| 14 | [K-Dense-AI/scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills) | 53,116 | MIT | 2026-10-19 | SKILL.md | Science and research skills. Reference for ML/research roles (not read in depth). | ✅ |
| 15 | [elder-plinius/CL4R1T4S](https://github.com/elder-plinius/CL4R1T4S) | 51,389 | AGPL-3.0 (leaked prompts) | 2026-09-22 | prompt | Leaked system prompts. | ⛔ |
| 16 | [sickn33/agentic-awesome-skills](https://github.com/sickn33/agentic-awesome-skills) (ex antigravity-awesome-skills) | 47,981 | MIT | 2026-10-19 | catalog | Large aggregated catalog with an installer. Discovery only. | ✅ |
| 17 | [danielmiessler/Fabric](https://github.com/danielmiessler/Fabric) | 44,380 | MIT | 2026-10-20 | prompt "patterns" | Rigid, reliable structure: IDENTITY and PURPOSE, then STEPS, then OUTPUT INSTRUCTIONS, then INPUT, with named output sections and exact counts and lengths. Useful patterns: `summarize_meeting`, `extract_wisdom`, `analyze_claims`. | ✅ |
| 18 | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | 43,285 | Apache-2.0 | 2026-10-20 | plugin directory | Official plugin directory. | ✅ |
| 19 | [wshobson/agents](https://github.com/wshobson/agents) | 41,212 | MIT | 2026-10-19 | plugin (agents + skills + commands) | 92 plugins, about 185 skills and 200 agents, plus plugin evals. `avoid-ai-writing` is a model writing skill: modes (rewrite/detect/edit), context profiles, P0–P2 severity tiers and tiered vocabulary files. | ✅ |
| 20 | [anthropics/financial-services](https://github.com/anthropics/financial-services) | 40,492 | Apache-2.0 | 2026-09-21 | plugin | Institutional finance workflows (modelling, research). Not read in depth. | ✅ |
| 21 | [github/awesome-copilot](https://github.com/github/awesome-copilot) | 40,214 | MIT | 2026-10-19 | instructions/agents/skills | Copilot ecosystem equivalents. Good for engineering roles. | ✅ |
| 22 | [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) | 36,043 | MIT | 2026-10-19 | list | Index of 1000+ skills from official dev teams. | ✅ |
| 23 | [davila7/claude-code-templates](https://github.com/davila7/claude-code-templates) | 32,778 | MIT | 2026-10-20 | templates/CLI | Aggregated agents and skills with an installer. | ✅ |
| 24 | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | 32,693 | README says MIT; no LICENSE file (UNVERIFIED) | 2026-10-14 | SKILL.md | Vendor-official engineering best-practice skills (React/Next.js). | ⚠️ |
| 25 | [linexjlin/GPTs](https://github.com/linexjlin/GPTs) | 32,039 | none | 2024-09-27 | prompt | Leaked GPT prompts. Stale. | ⛔ |
| 26 | [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins) | 30,593 | Apache-2.0 | 2026-10-20 | plugin (role bundles) | **The role-pack template.** Plugins: product-management, marketing, sales (36 skills), finance, legal, human-resources, customer-support, data, design, engineering, operations, small-business, enterprise-search, productivity, bio-research. Patterns: ask for missing context, load an org playbook (`legal.local.md`) or fall back to generic standards *and say so*, GREEN/YELLOW/RED severity, an exact output template, redline + fallback + priority, negotiation tiers, and a "not legal advice" boundary. | ✅ |
| 27 | [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills) | 28,438 | MIT | 2026-08-30 | SKILL.md (+ python tools) | 380+ skills: C-level advisors, marketing, product, RA/QM (EU AI Act, GDPR, ISO 27001/42001), compliance-os, finance, commercial. Its `SKILL-AUTHORING-STANDARD.md` lists 10 patterns: context-first, practitioner voice, multi-mode, related skills with "NOT for" disambiguation, proactive triggers, an output-artifacts table, a quality loop, confidence tags, and more. **Contains at least one dated fact error (see §0).** | ✅ (verify facts) |
| 28 | [openai/skills](https://github.com/openai/skills) | 28,183 | Per skill (mostly Apache-2.0; Figma proprietary) | 2026-09-08 | SKILL.md + `agents/openai.yaml` | **Deprecated** in favour of openai/plugins. Uses .system/.curated/.experimental tiers. `define-goal` has a strong quality bar that rejects pure activity goals. | ⚠️ |
| 29 | [phuryn/pm-skills](https://github.com/phuryn/pm-skills) | 27,242 | MIT | 2026-10-16 | plugin (9 PM plugins, 69 skills) | One named framework per skill: OST, pre-mortem, north star, Ansoff, PESTLE, Porter, lean canvas, market sizing, cohort analysis. | ✅ |
| 30 | [Donchitos/Claude-Code-Game-Studios](https://github.com/Donchitos/Claude-Code-Game-Studios) | 26,920 | MIT | 2026-10-19 | agent.md + SKILL.md + hooks | 49 studio agents and ~72-74 skills. A **collaboration protocol**: question first, then 2–4 options with a recommendation, the user decides, and nothing is written without approval. Config-scoped checklists ("unset is not none"). Cross-department launch checklist. LiveOps cadence tiers. | ✅ |
| 31 | [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) | 25,880 | MIT | 2026-10-11 | agent.md | 100+ engineering, infra and QA subagents. | ✅ |
| 32 | [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering) | 18,176 | MIT | 2026-10-12 | SKILL.md | Context engineering, memory, multi-agent patterns. | ✅ |
| 33 | [travisvn/awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills) | 15,478 | none | 2026-04-28 | list | Index only. | ⛔ content / links OK |
| 34 | [jujumilk3/leaked-system-prompts](https://github.com/jujumilk3/leaked-system-prompts) | 14,974 | none | 2026-09-23 | prompt | Leaked prompts. | ⛔ |
| 35 | [contains-studio/agents](https://github.com/contains-studio/agents) | 12,419 | none | 2025-07-28 | agent.md | Studio agents (ASO, TikTok, growth). Descriptions embed `<example>` dialogues to improve triggering. Stale, ideas only. | ⛔ content |
| 36 | [Jeffallan/claude-skills](https://github.com/Jeffallan/claude-skills) | 11,948 | MIT | 2026-10-16 | SKILL.md | Full-stack engineering skills. | ✅ |
| 37 | [LouisShark/chatgpt_system_prompt](https://github.com/LouisShark/chatgpt_system_prompt) | 10,809 | MIT label, third-party GPT prompts inside | 2026-10-13 | prompt | Extracted GPT prompts and injection notes. | ⛔ |
| 38 | [ai-boost/awesome-prompts](https://github.com/ai-boost/awesome-prompts) | 9,103 | GPL-3.0 (+ third-party GPT prompts) | 2026-10-20 | prompt | Top GPT Store prompts. | ⛔ |
| 39 | [trailofbits/skills](https://github.com/trailofbits/skills) | 7,656 | CC BY-SA 4.0 | 2026-10-19 | SKILL.md | Expert security-review skills. Share-alike licence. | ⚠️ |
| 40 | [deanpeters/Product-Manager-Skills](https://github.com/deanpeters/Product-Manager-Skills) | 7,542 | CC BY-NC-SA 4.0 | 2026-10-16 | SKILL.md | Good PM content but non-commercial. | ⛔ |
| 41 | [openai/plugins](https://github.com/openai/plugins) | 7,518 | no root licence (per plugin; UNVERIFIED) | 2026-10-08 | Codex plugins | Successor to openai/skills: build-ios-apps, expo, notion, figma. | ⚠️ |
| 42 | [czlonkowski/n8n-skills](https://github.com/czlonkowski/n8n-skills) | 6,471 | MIT | 2026-10-15 | SKILL.md | Tool-specific skills done well. | ✅ |
| 43 | [AvdLee/SwiftUI-Agent-Skill](https://github.com/AvdLee/SwiftUI-Agent-Skill) | 3,728 | MIT | 2026-10-06 | SKILL.md | SwiftUI best practices from a recognised iOS expert. | ✅ |
| 44 | [expo/skills](https://github.com/expo/skills) | 2,948 | MIT | 2026-10-18 | SKILL.md | Vendor-official Expo/React Native skills. | ✅ |
| 45 | [wondelai/skills](https://github.com/wondelai/skills) | 2,468 | MIT | 2026-09-10 | SKILL.md | 65 book-framework skills (JTBD, Mom Test, Hooked, Crossing the Chasm, negotiation...). The books themselves are copyrighted. | ✅ (concepts) |
| 46 | [appeeky/aso-skills](https://github.com/appeeky/aso-skills) (ex Eronred) | 2,192 | MIT | 2026-10-06 | SKILL.md | ASO skills backed by live store data through an API. | ✅ |
| 47 | [callstackincubator/agent-skills](https://github.com/callstackincubator/agent-skills) | 1,676 | MIT | 2026-10-08 | SKILL.md | React Native performance and best practices. | ✅ |
| 48 | [RefoundAI/lenny-skills](https://github.com/RefoundAI/lenny-skills) | 1,432 | MIT | 2026-07-16 | SKILL.md + references/artifacts.md | PM skills distilled from Lenny's Podcast and Newsletter, with source counts per skill and verified quotes. The quotes are third-party, so don't copy them. | ✅ |
| 49 | [getsentry/skills](https://github.com/getsentry/skills) | 1,069 | Apache-2.0 | 2026-10-19 | SKILL.md | Team-internal engineering skills (code review, security). | ✅ |
| 50 | [lawve-ai/awesome-legal-skills](https://github.com/lawve-ai/awesome-legal-skills) | 878 | CC BY-NC-ND 4.0 | 2026-10-19 | list | Legal skills index. | ⛔ |
| 51 | [rshankras/claude-code-apple-skills](https://github.com/rshankras/claude-code-apple-skills) | 814 | MIT | 2026-07-24 | SKILL.md | Apple platform + App Store router skills. | ✅ |
| 52 | [appeeky/ua-skills](https://github.com/appeeky/ua-skills) | 73 | none | 2026-08-23 | SKILL.md | Mobile UA skills. Tiny and unlicensed. | ⛔ |
| 53 | [asodevapp/skills](https://github.com/asodevapp/skills) | 5 | MIT | 2026-05-11 | SKILL.md | Official ASO.dev skills (vendor). Low adoption. | ✅ |

Not counted as skill libraries: anthropics/claude-code (152,861★, the CLI) and openai/codex (≈130k★, scraped from HTML, not the API).

### What the landscape covers per Vox pack

| Pack | Depth on GitHub | Best sources |
|---|---|---|
| Core (writing, decisions, synthesis) | Deep | anthropics/skills (internal-comms, discernment-nudge), Fabric, wshobson avoid-ai-writing, KWP, pm-skills |
| Tech company | Very deep | KWP (engineering, design, data, support, HR, finance), superpowers, mattpocock, wshobson, trailofbits, VoltAgent |
| AI company | Deep for engineering, thin for governance | wshobson llm-application-dev, Agent-Skills-for-Context-Engineering, cookbooks, alirezarezvani RA/QM (verify facts) |
| Mobile company | Medium (engineering and ASO good; LiveOps and monetisation thin) | AvdLee, apple-skills, expo, callstack, marketingskills aso, appeeky, agency-agents economy-designer, Game Studios live-ops |
| Publisher | **Thin** (nothing for producer, BD, loc, platform relations or publishing analytics) | Game Studios (dev side), KWP legal pattern, marketingskills; the rest is practitioner literature |
| Lifestyle | **Thin** (persona prompts only) | prompts.chat (CC0), agency-agents (specialized), plus authoritative public-health and consumer-finance sources |

## 3. The craft: what makes the best skills excellent

Each pattern below gives the evidence, then what Vox should do with it.

1. **The description is a trigger, not a summary.** anthropics/skills puts *all* "when to use" text in the frontmatter `description`, made a bit "pushy" because models under-trigger. superpowers found that when a description summarises the workflow, agents follow the summary and skip the body. Its rule: start with "Use when..." and list only the triggering conditions. mattpocock: front-load the leading word, one trigger per distinct branch. → *Vox:* each skill's `whenToUse` is the routing key for picking a skill in a Telegram conversation. Write it as concrete situations and owner phrases, and add a "not for" line when skills sit close together (alirezarezvani pattern 4).
2. **Progressive disclosure: three loading levels.** Metadata (~100 words) is always loaded, the body (<500 lines) loads on trigger, and `references/` load only when pointed to. Domain variants live in separate reference files (e.g., `references/apple-specs.md` vs `google-play-specs.md` in marketingskills ASO). → *Vox:* keep the role persona and skill index in the system prompt, load a skill's body on demand, and keep long reference (rubrics, regulations, benchmarks) in retrievable files.
3. **Context first, then a shared, versioned brief.** marketingskills makes every skill read `.agents/product-marketing.md` before asking anything. That doc has a version and a changelog. alirezarezvani standardises per-domain context files. KWP legal asks four context questions (side, deadline, focus, deal context) and proceeds on partial answers, stating its assumptions. → *Vox:* this maps directly onto agent **memory**. `core.context-intake` keeps a living brief per owner/company, and every skill reads it before asking.
4. **The method is steps with completion criteria.** mattpocock: every step ends on a criterion the agent can check, and "demand" (e.g., "every modified model accounted for") drives thoroughness. Fabric and KWP number their steps and say what each step produces. → *Vox:* the `method` array is ordered steps, and each step names its output.
5. **The deliverable is an exact template.** KWP contract review prints its output skeleton (Summary → Key findings → Clause-by-clause with GREEN/YELLOW/RED → Negotiation strategy → Next steps). Fabric pins section names and even bullet lengths. superpowers notes that when the output comes out the wrong shape, a positive recipe works better than a list of prohibitions. → *Vox:* `deliverable` names the sections in order, with a short chat version and an optional document version.
6. **A quality bar the agent checks itself against.** openai `define-goal` blocks goal creation until a quality bar passes. alirezarezvani has a "quality loop" and confidence tags (verified / medium / assumed). anthropics/discernment-nudge adds 2–3 follow-up questions so users check key facts. → *Vox:* run `qualityBar` as a silent self-review before sending, and surface confidence on factual claims.
7. **Calibrated judgement, not textbook rules.** marketingskills ASO puts an app in a Dominant / Established / Challenger tier before scoring, and asks "is this a mistake or a data-informed choice by a team with more information?". Game Studios scopes checklists to project config and treats "unset" as a question, not a licence to list everything. → *Vox:* skills should adapt depth to the owner's situation (stage, size, jurisdiction) and say which assumptions they used.
8. **Named frameworks with practitioner caveats.** pm-skills and wondelai attach one named framework per skill. The best skills add the caveat a senior practitioner would ("Use RICE, but sanity-check Effort with the engineer who owns it"). → *Vox:* `frameworks` plus method steps carry these caveats, which is the difference between premium and generic.
9. **Failure modes are written down.** superpowers keeps rationalisation tables and red-flag lists. KWP lists "common issues" per clause. agency-agents lists critical rules. → *Vox:* `pitfalls` per skill, plus red-flag triggers that switch modes (see `core.scope-and-referral`).
10. **Persona plus skills plus memory equals a colleague.** agency-agents writes identity, memory, personality, success metrics and a communication style per agent, then gives it deliverable templates. Game Studios adds a **collaboration protocol**: ask, then offer 2–4 options with a recommendation, the human decides, and the agent gets approval before acting. → *Vox:* role persona (voice) + skill pack (methods) + memory (brief) + collaboration protocol (approval before any external action). This also fits Vox's safety posture.
11. **Evals ship with the skill.** marketingskills ships `evals/evals.json` (prompt, expected output, assertions) for each skill. skill-creator runs with-skill vs baseline in parallel, grades assertions, and optimises descriptions on a held-out trigger set. superpowers: "if you didn't watch an agent fail without the skill, you don't know if the skill teaches the right thing." → *Vox:* each skill gets 3–5 realistic owner prompts with assertions drawn from its quality bar. Run them on every persona or prompt change.
12. **Treat fetched content as untrusted, and keep humans in control.** marketingskills ASO tells the agent never to follow instructions found inside listings or reviews. KWP legal and Game Studios make the agent ask before writing or sending. → *Vox:* bots read the owner's forwarded content and the web, so prompt-injection hygiene and explicit confirmation before external actions (sending, booking, posting) must be part of every skill.

**Anti-patterns seen in high-star repos:** walls of ALL-CAPS MUSTs (Anthropic advises explaining the why instead), giant monolithic SKILL.md files, one-paragraph persona prompts with no method (prompts.chat, leaked GPTs), stale regulatory facts presented without dates, and descriptions that duplicate the body.

### Recommended Vox skill file shape (SKILL.md-compatible)

```markdown
---
name: growth.ua-campaign-plan            # namespaced id
description: Use when <owner situations/phrases>. Not for <near-miss> (use <other skill>).
metadata: { pack: mobile, role: growth-ua, version: 1.0.0, reviewed: 2026-10-20 }
---
# UA campaign plan
## Before starting      -> read owner/company brief (core.context-intake); ask only what is missing
## Method               -> ordered steps, each ending on a completion criterion
## Deliverable          -> exact section order; chat version (<=10 lines) + doc version
## Quality bar          -> 3-5 self-checks run before replying
## Pitfalls & red flags -> failure modes; mode switches (scope/referral, approval needed)
## References           -> references/*.md (benchmarks with dates, regulation excerpts, rubrics)
evals/evals.json        -> 3-5 owner prompts + assertions derived from the quality bar
```


## 4. Skill matrix

The matrix drafted here is now code: `src/lib/studio/skills/packs/*.ts` (54 roles, 272 skills, validated by `src/lib/studio/skills/catalog.ts`). The authors corrected it while writing; the code is the source of truth.

## 5. Gaps, risks and recommendations for Vox

1. **Lifestyle and Publisher are where Vox can lead, and they carry the most risk.** No GitHub source reaches premium depth here. Before launch, have each skill reviewed by a practitioner: a certified trainer and a registered dietitian for fitness/nutrition, a sleep clinician for the sleep red flags, a game-publishing producer and BD lead, a localisation manager. Ship these skills marked "expert-reviewed" so the premium claim is earned.
2. **Regulated edges need one shared guardrail.** `core.scope-and-referral` and `wellbeing.crisis-protocol` should be always-on overlays for the lifestyle and legal roles, not opt-in skills. Crisis resources must be region-aware (Telegram users are global).
3. **Facts decay, so skills need dated references.** Keep volatile facts (store metadata limits, Play/App Store policies, AI Act dates, visa systems, benchmarks) in `references/*.md` with `checked:` dates and owners. Re-verify quarterly. The AI Act date error in a top repo shows why.
4. **Memory is the moat.** The best public skills fake memory with context files (`product-marketing.md`, `company-context.md`). Vox has real per-agent memory, so `core.context-intake` and the "read brief first" step will feel noticeably more personal than any GitHub skill.
5. **Telegram-native deliverables.** Every deliverable has a short chat form (≤10 lines, bottom line first) and an optional long form (doc or file). Quality bars should check the chat form fits on one phone screen.
6. **Consent before action.** Adopt the Game Studios / KWP pattern: agents propose, the owner approves, and only then does the agent send, book, post or buy. This matches the platform's safety model and builds trust.
7. **Evals per skill, from day one.** Turn each skill's quality bar into 3–5 assertions on realistic owner prompts (marketingskills `evals.json` shape). Run trigger evals on near-miss prompts across skills that sit close together, e.g., `nutrition.meal-prep-plan` vs `chef.weekly-menu` and `ua.creative-testing` vs `pubua.creative-ops`.
8. **Licensing hygiene.** Write everything originally and cite inspiration. Don't ingest leaked-prompt repos, NC/ND-licensed repos or Anthropic's proprietary document skills into any training or content pipeline. Attribute CC BY-SA sources (trailofbits, OWASP, Diataxis) if any derived text ships.
9. **Cross-platform mobile.** The matrix has native iOS and Android roles. If customers are mostly React Native or Expo shops, add a small cross-platform role using expo/skills and callstackincubator/agent-skills (both MIT) as inspiration.
10. **Book-publishing add-on.** It is worth a small optional role (4 skills included) for authors and indie presses who use Vox. Keep it out of the core Publisher pack.
## 6. Source register (licence and reuse notes)

| Key | Source | Licence / reuse | Used by # skills |
|---|---|---|---:|
| `gh_anthropic_skills` | [anthropics/skills](https://github.com/anthropics/skills) | Apache-2.0 per skill; docx/pdf/pptx/xlsx are proprietary source-available (DO NOT REUSE) | 5 |
| `gh_kwp` | [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins) | Apache-2.0 | 45 |
| `gh_finserv` | [anthropics/financial-services](https://github.com/anthropics/financial-services) | Apache-2.0 | 1 |
| `gh_superpowers` | [obra/superpowers](https://github.com/obra/superpowers) | MIT | 4 |
| `gh_mattpocock` | [mattpocock/skills](https://github.com/mattpocock/skills) | MIT | 4 |
| `gh_agency` | [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) | MIT | 13 |
| `gh_wshobson` | [wshobson/agents](https://github.com/wshobson/agents) | MIT | 3 |
| `gh_voltagent_sub` | [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) | MIT | 2 |
| `gh_contains` | [contains-studio/agents](https://github.com/contains-studio/agents) | No license file (all rights reserved) - ideas only | 1 |
| `gh_alireza` | [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills) | MIT | 13 |
| `gh_marketingskills` | [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) | MIT | 17 |
| `gh_pmskills` | [phuryn/pm-skills](https://github.com/phuryn/pm-skills) | MIT | 16 |
| `gh_lenny` | [RefoundAI/lenny-skills](https://github.com/RefoundAI/lenny-skills) | MIT (quotes inside are third-party; do not copy quotes) | 1 |
| `gh_wondelai` | [wondelai/skills](https://github.com/wondelai/skills) | MIT (book frameworks; books themselves are copyrighted) | 1 |
| `gh_deanpeters` | [deanpeters/Product-Manager-Skills](https://github.com/deanpeters/Product-Manager-Skills) | CC BY-NC-SA 4.0 (non-commercial: DO NOT REUSE in Vox) | 0 |
| `gh_openai_skills` | [openai/skills](https://github.com/openai/skills) | Per-skill: mostly Apache-2.0, Notion MIT-style, Figma proprietary terms; repo deprecated in favour of openai/plugins | 4 |
| `gh_openai_plugins` | [openai/plugins](https://github.com/openai/plugins) | No root license file - per-plugin; treat as ideas only (UNVERIFIED) | 1 |
| `gh_prompts_chat` | [f/prompts.chat (formerly awesome-chatgpt-prompts)](https://github.com/f/prompts.chat) | Prompts CC0-1.0; code MIT | 2 |
| `gh_fabric` | [danielmiessler/Fabric](https://github.com/danielmiessler/Fabric) | MIT | 2 |
| `gh_game_studios` | [Donchitos/Claude-Code-Game-Studios](https://github.com/Donchitos/Claude-Code-Game-Studios) | MIT | 18 |
| `gh_trailofbits` | [trailofbits/skills](https://github.com/trailofbits/skills) | CC BY-SA 4.0 (share-alike: derivatives must carry same license) | 2 |
| `gh_ctx_eng` | [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering) | MIT | 1 |
| `gh_aso_appeeky` | [appeeky/aso-skills (was Eronred/aso-skills)](https://github.com/appeeky/aso-skills) | MIT | 2 |
| `gh_asodev` | [asodevapp/skills (ASO.dev)](https://github.com/asodevapp/skills) | MIT | 3 |
| `gh_avdlee` | [AvdLee/SwiftUI-Agent-Skill](https://github.com/AvdLee/SwiftUI-Agent-Skill) | MIT | 2 |
| `gh_apple_skills` | [rshankras/claude-code-apple-skills](https://github.com/rshankras/claude-code-apple-skills) | MIT | 3 |
| `gh_expo` | [expo/skills](https://github.com/expo/skills) | MIT | 1 |
| `gh_callstack` | [callstackincubator/agent-skills](https://github.com/callstackincubator/agent-skills) | MIT | 1 |
| `gh_awesome_copilot` | [github/awesome-copilot](https://github.com/github/awesome-copilot) | MIT | 1 |
| `gh_prompt_guide` | [dair-ai/Prompt-Engineering-Guide](https://github.com/dair-ai/Prompt-Engineering-Guide) | MIT | 1 |
| `gh_openai_cookbook` | [openai/openai-cookbook](https://github.com/openai/openai-cookbook) | MIT | 1 |
| `gh_claude_cookbooks` | [anthropics/claude-cookbooks](https://github.com/anthropics/claude-cookbooks) | MIT | 1 |
| `gh_sentry` | [getsentry/skills](https://github.com/getsentry/skills) | Apache-2.0 | 1 |
| `gh_legal_awesome` | [lawve-ai/awesome-legal-skills](https://github.com/lawve-ai/awesome-legal-skills) | CC BY-NC-ND 4.0 (DO NOT REUSE; link only) | 0 |
| `gh_inspect` | [UKGovernmentBEIS/inspect_ai](https://github.com/UKGovernmentBEIS/inspect_ai) | MIT | 2 |
| `gh_promptfoo` | [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo) | MIT | 2 |
| `gh_robyn` | [facebookexperimental/Robyn (MMM)](https://github.com/facebookexperimental/Robyn) | MIT | 2 |
| `gh_meridian` | [google/meridian (MMM)](https://github.com/google/meridian) | Apache-2.0 | 2 |
| `gh_geolift` | [facebookincubator/GeoLift](https://github.com/facebookincubator/GeoLift) | MIT | 1 |
| `gh_fsrs` | [open-spaced-repetition/fsrs4anki (FSRS)](https://github.com/open-spaced-repetition/fsrs4anki) | MIT | 1 |
| `gh_pd_incident` | [PagerDuty/incident-response-docs](https://github.com/PagerDuty/incident-response-docs) | Apache-2.0 | 3 |
| `gh_atlas` | [mitre-atlas/atlas-data (MITRE ATLAS)](https://github.com/mitre-atlas/atlas-data) | Apache-2.0 | 1 |
| `gh_vllm` | [vllm-project/vllm](https://github.com/vllm-project/vllm) | Apache-2.0 (UNVERIFIED this session) | 1 |
| `gh_kdense` | [K-Dense-AI/scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills) | MIT | 2 |
| `ref_eu_ai_act` | [Regulation (EU) 2024/1689 (AI Act)](https://eur-lex.europa.eu/eli/reg/2024/1689/oj) | EU law; reuse with attribution (Decision 2011/833/EU) | 7 |
| `ref_gdpr` | [Regulation (EU) 2016/679 (GDPR)](https://eur-lex.europa.eu/eli/reg/2016/679/oj) | EU law; reuse with attribution | 5 |
| `ref_gpai_cop` | [EU General-Purpose AI Code of Practice (Jul 2025)](https://digital-strategy.ec.europa.eu/en/policies/contents-code-gpai) | EU publication; cite | 1 |
| `ref_edpb_ai` | [EDPB Opinion 28/2024 on AI models](https://www.edpb.europa.eu/) | EU publication; cite | 1 |
| `ref_cpc_games` | [EU CPC Network key principles on in-game virtual currencies (2024)](https://commission.europa.eu/) | EU publication; cite | 3 |
| `ref_nist_ai_rmf` | [NIST AI RMF 1.0 + Generative AI Profile (NIST AI 600-1)](https://www.nist.gov/itl/ai-risk-management-framework) | US Gov work (public domain) | 2 |
| `ref_iso42001` | [ISO/IEC 42001:2023 AI management system](https://www.iso.org/standard/81230.html) | Paid copyrighted standard - cite clause numbers only | 2 |
| `ref_owasp_llm` | [OWASP Top 10 for LLM Applications (2025)](https://genai.owasp.org/) | CC BY-SA 4.0 | 3 |
| `ref_owasp_asvs` | [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) | CC BY-SA 4.0 | 1 |
| `ref_owasp_masvs` | [OWASP MASVS / MASTG](https://mas.owasp.org/) | CC BY-SA 4.0 (per OWASP MAS site; UNVERIFIED in repo root) | 1 |
| `ref_slsa` | [SLSA supply-chain framework](https://slsa.dev/) | Community spec; cite (license UNVERIFIED) | 1 |
| `ref_cvss_epss` | [FIRST CVSS v4.0 + EPSS; CISA KEV catalog](https://www.first.org/cvss/) | FIRST spec (cite); CISA KEV public domain | 1 |
| `ref_stride` | [Microsoft Threat Modeling / STRIDE; Shostack 'Threat Modeling' (2014)](https://learn.microsoft.com/azure/security/develop/threat-modeling-tool-threats) | Reference only | 1 |
| `ref_wcag` | [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) | W3C Document License | 2 |
| `ref_apple_hig` | [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/) | Apple proprietary - reference only | 3 |
| `ref_apple_review` | [Apple App Review Guidelines + privacy manifest docs](https://developer.apple.com/app-store/review/guidelines/) | Apple proprietary - reference only | 8 |
| `ref_apple_ads_attr` | [Apple SKAdNetwork / AdAttributionKit docs](https://developer.apple.com/documentation/adattributionkit) | Apple proprietary - reference only | 1 |
| `ref_apple_ppo` | [App Store Connect: Product Page Optimization & Custom Product Pages](https://developer.apple.com/app-store/product-page-optimization/) | Apple proprietary - reference only | 3 |
| `ref_play_policy` | [Google Play Developer Policy Center + Play Console Help](https://play.google.com/about/developer-content-policy/) | Google - reference only | 7 |
| `ref_android_vitals` | [Android developers: Android vitals, Compose & architecture guides](https://developer.android.com/topic/performance/vitals) | Docs content CC BY (version UNVERIFIED); samples Apache-2.0 | 4 |
| `ref_material3` | [Material Design 3](https://m3.material.io/) | Google - reference only | 2 |
| `ref_swift_concurrency` | [Swift.org: Swift 6 language mode & data-race safety](https://www.swift.org/documentation/) | Apache-2.0 docs (UNVERIFIED) | 1 |
| `ref_steamworks` | [Steamworks documentation (store, Next Fest, review rules)](https://partner.steamgames.com/doc/home) | Valve - reference only | 5 |
| `ref_platform_cert` | Sony TRC / Xbox Requirements (XR) / Nintendo Lotcheck | Confidential under NDA - skill must use customer-supplied checklists only | 1 |
| `ref_ratings` | [IARC, ESRB, PEGI, USK, CERO rating systems](https://www.globalratings.com/) | Reference only | 3 |
| `ref_ftc_endorse` | [FTC Endorsement Guides (16 CFR Part 255) + 'Disclosures 101 for Social Media Influencers'](https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers) | US Gov (public domain) | 2 |
| `ref_asa_cap` | [UK CAP Code / ASA influencer marketing guidance](https://www.asa.org.uk/) | Reference only | 1 |
| `ref_coppa` | [COPPA Rule (16 CFR Part 312, amended 2025)](https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa) | US Gov (public domain) | 2 |
| `ref_mqm` | [MQM - Multidimensional Quality Metrics](https://themqm.org/) | CC BY 4.0 (UNVERIFIED) | 1 |
| `ref_icu_cldr` | [Unicode ICU MessageFormat + CLDR plural rules](https://cldr.unicode.org/) | Unicode License | 1 |
| `ref_diataxis` | [Diataxis documentation framework (Daniele Procida)](https://diataxis.fr/) | CC BY-SA 4.0 | 2 |
| `ref_google_style` | [Google developer documentation style guide](https://developers.google.com/style) | CC BY 4.0 | 2 |
| `ref_plainlanguage` | [US Federal Plain Language Guidelines](https://www.plainlanguage.gov/guidelines/) | US Gov (public domain) | 2 |
| `ref_c4` | [C4 model (Simon Brown)](https://c4model.com/) | CC BY 4.0 | 2 |
| `ref_adr` | [Architecture Decision Records (Michael Nygard, 2011) / adr.github.io](https://adr.github.io/) | Reference only | 3 |
| `ref_sre_book` | [Google SRE books (SRE, SRE Workbook)](https://sre.google/books/) | Free to read, (c) Google/O'Reilly - cite only | 9 |
| `ref_dora` | [DORA research program + 'Accelerate' (Forsgren, Humble, Kim 2018)](https://dora.dev/) | Reports (c) Google; book copyrighted - cite only | 3 |
| `ref_otel_genai` | [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) | Apache-2.0 | 2 |
| `ref_cfpb` | [CFPB 'Your Money, Your Goals' toolkit](https://www.consumerfinance.gov/consumer-tools/educator-tools/your-money-your-goals/) | US Gov (public domain) | 6 |
| `ref_who_activity` | [WHO Guidelines on physical activity and sedentary behaviour (2020)](https://www.who.int/publications/i/item/9789240015128) | CC BY-NC-SA 3.0 IGO | 2 |
| `ref_parq` | [PAR-Q+ pre-exercise screening](https://eparmedx.com/) | Free to use, (c) PAR-Q+ Collaboration - do not modify | 2 |
| `ref_dga` | [Dietary Guidelines for Americans (USDA/HHS)](https://www.dietaryguidelines.gov/) | US Gov (public domain) | 3 |
| `ref_issn_protein` | [ISSN Position Stand: protein and exercise (Jaeger et al., 2017, JISSN)](https://doi.org/10.1186/s12970-017-0177-8) | Open access CC BY 4.0 | 2 |
| `ref_sleep_aasm` | [AASM/SRS adult sleep duration consensus (Watson et al., 2015); AASM CBT-I guideline (2021)](https://aasm.org/) | Copyrighted papers - cite only | 4 |
| `ref_who_dwm` | [WHO 'Doing What Matters in Times of Stress' (2020)](https://www.who.int/publications/i/item/9789240003927) | CC BY-NC-SA 3.0 IGO | 3 |
| `ref_crisis_lines` | [988 Suicide & Crisis Lifeline; findahelpline.com; Samaritans](https://findahelpline.com/) | Reference only | 2 |
| `ref_food_safety` | [FoodSafety.gov safe minimum internal temperatures; EU Reg. 1169/2011 Annex II allergens](https://www.foodsafety.gov/food-safety-charts/safe-minimum-internal-temperatures) | US Gov public domain / EU law | 1 |
| `ref_travel_official` | [Official entry rules: travel.state.gov, gov.uk foreign travel advice, EU EES/ETIAS portal, IATA Travel Centre](https://travel.state.gov/) | Government sources - cite; always re-check | 5 |
| `ref_cefr` | [Council of Europe CEFR descriptors (2020 Companion Volume)](https://www.coe.int/en/web/common-european-framework-reference-languages) | (c) Council of Europe - cite only | 3 |
| `bk_minto` | Barbara Minto, 'The Pyramid Principle' | Copyrighted book - concepts only | 1 |
| `bk_zinsser` | William Zinsser, 'On Writing Well' | Copyrighted book - concepts only | 1 |
| `bk_amazon_memo` | Amazon narrative 6-pager & PR/FAQ ('Working Backwards', Bryar & Carr 2021) | Copyrighted book - concepts only | 1 |
| `bk_rapid` | [Bain RAPID decision roles; Atlassian DACI play](https://www.atlassian.com/team-playbook/plays/daci) | Atlassian playbook (c) Atlassian - cite | 1 |
| `bk_bezos_doors` | [Bezos 2015 shareholder letter (one-way vs two-way doors)](https://www.aboutamazon.com/) | Cite only | 1 |
| `bk_okrs` | John Doerr, 'Measure What Matters'; Christina Wodtke, 'Radical Focus' | Copyrighted books - concepts only | 1 |
| `bk_premortem` | Gary Klein, 'Performing a Project Premortem' (HBR, 2007) | Cite only | 2 |
| `bk_sbi` | CCL Situation-Behavior-Impact feedback model; Kim Scott 'Radical Candor' | Cite only | 1 |
| `bk_nvc` | Marshall Rosenberg, 'Nonviolent Communication' | Copyrighted book - concepts only | 3 |
| `bk_crucial` | Patterson et al., 'Crucial Conversations' | Copyrighted book - concepts only | 2 |
| `bk_sift` | [Mike Caulfield, SIFT / lateral reading ('Verified', 2023)](https://hapgood.us/) | Cite only | 3 |
| `bk_feynman` | Feynman technique; 'Make It Stick' (Brown, Roediger, McDaniel 2014) | Copyrighted book - concepts only | 3 |
| `bk_negotiation` | Fisher & Ury 'Getting to Yes' (BATNA); Chris Voss 'Never Split the Difference' | Copyrighted books - concepts only | 2 |
| `bk_gtd` | David Allen, 'Getting Things Done' (GTD is a trademark) | Copyrighted book - concepts only; avoid trademark use in product names | 3 |
| `bk_atomic_research` | Tomer Sharon, atomic research / 'Validating Product Ideas' | Cite only | 1 |
| `bk_tiny_habits` | BJ Fogg 'Tiny Habits'; James Clear 'Atomic Habits'; Gollwitzer implementation intentions | Copyrighted - concepts only | 1 |
| `bk_mi` | Miller & Rollnick, 'Motivational Interviewing' (OARS) | Copyrighted book - concepts only | 3 |
| `bk_rp_volume` | Israetel et al., volume landmarks MEV/MAV/MRV; Helms RIR-based RPE | Copyrighted - concepts only | 2 |
| `bk_precision_nutrition` | [Precision Nutrition hand-portion method](https://www.precisionnutrition.com/) | Copyrighted - concepts only | 2 |
| `bk_iwt` | Ramit Sethi 'I Will Teach You to Be Rich' (conscious spending plan); Warren 'All Your Worth' (50/30/20) | Copyrighted books - concepts only | 2 |
| `bk_bogleheads` | [Bogleheads investment philosophy (wiki)](https://www.bogleheads.org/wiki/Bogleheads%C2%AE_investment_philosophy) | Cite only (license UNVERIFIED) | 1 |
| `bk_dyl` | Burnett & Evans, 'Designing Your Life' (odyssey plans) | Copyrighted book - concepts only | 1 |
| `bk_first90` | Michael Watkins, 'The First 90 Days' | Copyrighted book - concepts only | 1 |
| `bk_xyz_resume` | Laszlo Bock XYZ resume formula; 'Work Rules!' | Cite only | 1 |
| `bk_who_hiring` | Geoff Smart & Randy Street, 'Who' (scorecards, topgrading interview) | Copyrighted book - concepts only | 3 |
| `bk_rework` | [Google re:Work structured interviewing guides](https://rework.withgoogle.com/) | Cite (license UNVERIFIED) | 2 |
| `bk_mbsr` | Kabat-Zinn MBSR; Kristin Neff self-compassion; Seligman PERMA | Concepts only | 3 |
| `bk_gottman` | [Gottman Institute research (Four Horsemen, repair, bids)](https://www.gottman.com/) | Concepts only | 2 |
| `bk_culture_map` | [Erin Meyer, 'The Culture Map'; Emily Post Institute etiquette](https://emilypost.com/) | Copyrighted - concepts only | 2 |
| `bk_sfah` | Samin Nosrat 'Salt Fat Acid Heat'; J. Kenji Lopez-Alt 'The Food Lab' | Copyrighted books - concepts only | 5 |
| `bk_cagan` | [Marty Cagan 'Inspired' / 'Empowered' (SVPG)](https://www.svpg.com/) | Copyrighted - concepts only | 1 |
| `bk_torres` | [Teresa Torres 'Continuous Discovery Habits' (opportunity solution tree)](https://www.producttalk.org/) | Copyrighted - concepts only | 1 |
| `bk_rice` | [Intercom RICE prioritization (Sean McBride, 2016)](https://www.intercom.com/blog/rice-simple-prioritization-for-product-managers/) | Cite only | 1 |
| `bk_jtbd` | Jobs to be Done: Christensen 'Competing Against Luck'; Bob Moesta 'Demand-Side Sales' | Concepts only | 1 |
| `bk_shapeup` | [Basecamp 'Shape Up' (Ryan Singer)](https://basecamp.com/shapeup) | Free online, (c) Basecamp - cite only | 1 |
| `bk_kohavi` | Kohavi, Tang, Xu 'Trustworthy Online Controlled Experiments' (2020) | Copyrighted book - concepts only | 3 |
| `bk_heart` | Google HEART framework (Rodden, Hutchinson, Fu 2010) | Cite only | 1 |
| `bk_metric_trees` | North Star / metric trees (Amplitude North Star Playbook); AARRR (Dave McClure) | Cite only | 3 |
| `bk_nielsen` | [Nielsen Norman Group 10 usability heuristics; Steve Krug 'Rocket Surgery Made Easy'](https://www.nngroup.com/articles/ten-usability-heuristics/) | Cite only | 2 |
| `bk_hendrickson` | Elisabeth Hendrickson 'Explore It!'; Lisa Crispin & Janet Gregory 'Agile Testing' (quadrants) | Copyrighted books - concepts only | 3 |
| `bk_staff` | [Will Larson 'Staff Engineer' & 'Crafting Engineering Strategy'; Tanya Reilly 'The Staff Engineer's Path'](https://lethain.com/) | Copyrighted - concepts only | 1 |
| `bk_rumelt` | Richard Rumelt 'Good Strategy Bad Strategy' (diagnosis, guiding policy, coherent actions) | Copyrighted book - concepts only | 1 |
| `bk_team_topologies` | Skelton & Pais 'Team Topologies' | Copyrighted book - concepts only | 1 |
| `bk_tech_radar` | [Thoughtworks Technology Radar (adopt/trial/assess/hold)](https://www.thoughtworks.com/radar) | Cite only | 2 |
| `bk_fowler` | [Martin Fowler: strangler fig, parallel change (expand/contract), tech-debt quadrant](https://martinfowler.com/) | Cite only | 2 |
| `bk_kcs` | [Consortium for Service Innovation: Knowledge-Centered Service (KCS v6)](https://www.serviceinnovation.org/kcs/) | Cite (license UNVERIFIED) | 2 |
| `bk_cs_metrics` | Customer success: NRR/GRR, health scores, QBRs (Gainsight / TSIA practice) | Cite only | 1 |
| `bk_saas_finance` | SaaS finance: burn multiple (David Sacks), Rule of 40, CAC payback, 13-week cash flow | Cite only | 2 |
| `bk_karpathy` | [Andrej Karpathy 'A Recipe for Training Neural Networks' (2019)](https://karpathy.github.io/2019/04/25/recipe/) | Cite only | 2 |
| `bk_chip` | Chip Huyen 'AI Engineering' (2025) & 'Designing ML Systems' (2022) | Copyrighted books - concepts only | 6 |
| `bk_hamel` | [Hamel Husain & Shreya Shankar on evals: error analysis, LLM-judge alignment; 'Who Validates the Validators?' (2024)](https://hamel.dev/) | Cite only | 5 |
| `bk_anthropic_agents` | [Anthropic engineering: 'Building effective agents' (2024), 'Effective context engineering for AI agents' (2025), 'Writing tools for agents' (2025)](https://www.anthropic.com/engineering) | (c) Anthropic - cite only | 5 |
| `bk_anthropic_evals` | [Anthropic docs: define success criteria & develop test cases; Contextual Retrieval (2024)](https://docs.anthropic.com/) | (c) Anthropic - cite only | 2 |
| `bk_openai_prompting` | [OpenAI prompting guides (GPT-5 prompting guide, function calling, evals best practices)](https://platform.openai.com/docs) | (c) OpenAI - cite only | 3 |
| `bk_model_cards` | Mitchell et al. 'Model Cards' (2019); Gebru et al. 'Datasheets for Datasets' (2021) | Cite only | 2 |
| `bk_ml_debt` | Sculley et al. 'Hidden Technical Debt in ML Systems' (2015); Breck et al. 'ML Test Score' (2017) | Cite only | 1 |
| `bk_safety_frameworks` | Anthropic Responsible Scaling Policy; OpenAI Preparedness Framework; Google DeepMind Frontier Safety Framework | Cite only | 2 |
| `bk_willison` | [Simon Willison on prompt injection & the 'lethal trifecta' (2025)](https://simonwillison.net/) | Cite only | 1 |
| `bk_pair` | [Google PAIR People + AI Guidebook; Shape of AI pattern library (Emily Campbell)](https://pair.withgoogle.com/guidebook/) | Cite only | 2 |
| `bk_annotation` | Krippendorff's alpha / inter-annotator agreement; 'Human-in-the-Loop Machine Learning' (Monarch 2021) | Concepts only | 3 |
| `bk_mda` | Hunicke, LeBlanc, Zubek 'MDA' (2004); Jesse Schell 'The Art of Game Design'; Raph Koster 'A Theory of Fun' | Cite only | 1 |
| `bk_game_balance` | [Schreiber & Romero 'Game Balance' (2021); Machinations; Daniel Cook (Lostgarden) on loops & value chains](https://lostgarden.com/) | Concepts only | 2 |
| `bk_motivation` | [Quantic Foundry gamer motivation model; Rigby & Ryan 'Glued to Games' (SDT); Bartle types](https://quanticfoundry.com/) | Cite only | 2 |
| `bk_dof` | [Deconstructor of Fun (game deconstructions, LiveOps, economy essays)](https://www.deconstructoroffun.com/) | Cite only | 6 |
| `bk_seufert` | [Eric Seufert 'Freemium Economics' (2014) & Mobile Dev Memo](https://mobiledevmemo.com/) | Copyrighted - concepts only | 11 |
| `bk_mobile_benchmarks` | Industry benchmarks: GameAnalytics, AppsFlyer Performance Index, Liftoff/Adjust reports, Sensor Tower | Proprietary reports - cite figures with date | 6 |
| `bk_aso_practice` | ASO practice: Apple/Google metadata limits; keyword difficulty/popularity (AppTweak, Sensor Tower, ASO.dev) | Cite only | 1 |
| `bk_cmx` | [CMX SPACES community model (David Spinks 'The Business of Belonging')](https://cmxhub.com/) | Concepts only | 1 |
| `bk_carless` | [Simon Carless / GameDiscoverCo (Steam demand, wishlist & review ratios)](https://newsletter.gamediscover.co/) | Cite only | 2 |
| `bk_zukowski` | [Chris Zukowski, How To Market A Game (wishlists, Next Fest, hooks)](https://howtomarketagame.com/) | Cite only | 5 |
| `bk_derek_lieu` | [Derek Lieu on game trailers](https://www.derek-lieu.com/blog) | Cite only | 1 |
| `bk_presskit` | [presskit() by Rami Ismail; press embargo & key distribution practice (Keymailer, Lurkit)](https://dopresskit.com/) | Free tool - cite | 2 |
| `bk_localization` | Chandler & Deming 'The Game Localization Handbook'; Kate Edwards on culturalization | Copyrighted - concepts only | 3 |
| `bk_publishing_deals` | [Game publishing deal practice: rev share, MG, recoup waterfall, IP/sequel rights (e.g., GDC talks, Game Developer articles)](https://www.gamedeveloper.com/) | Cite only (no single canonical source - UNVERIFIED specifics) | 9 |
| `bk_book_publishing` | [Book publishing: Chicago Manual of Style; ONIX/BISAC metadata (BISG, EDItEUR); Jane Friedman 'The Business of Being a Writer'](https://www.editeur.org/) | Cite only | 4 |

## 7. UNVERIFIED and caveats

- **Star counts** are a snapshot from the unauthenticated GitHub API on 2026-10-20 (~13:31 local) and will drift. mattpocock/skills at 298,038★ is surprisingly high but was returned by the API.
- **Licences not confirmed from a LICENSE file:** ComposioHQ/awesome-claude-skills (README badge Apache-2.0), vercel-labs/agent-skills (README says MIT), openai/plugins (no root licence), OWASP MASVS repo (OWASP sites state CC BY-SA 4.0), vllm-project/vllm (Apache-2.0 from memory, not re-checked), MQM, SLSA, KCS, the Bogleheads wiki and the Android docs content licence version.
- **Repos listed but not read in depth:** anthropics/financial-services, K-Dense-AI/scientific-agent-skills, github/awesome-copilot, VoltAgent lists, sickn33/agentic-awesome-skills, davila7/claude-code-templates, appeeky/aso-skills (README only), RefoundAI/lenny-skills (README only), wondelai/skills (README only).
- **EU AI Act dates:** Article 113 application dates are given in `gov.ai-act-classification`. Whether the Commission's late-2025 "digital omnibus" proposal has since been adopted and moved the high-risk dates is UNVERIFIED and must be checked against EUR-Lex before use.
- **Travel entry systems** (EU EES/ETIAS, UK ETA): rollout dates change. Skills must check official sources at use time.
- **Store specifics** (custom product page limits, the 2025 Apple age-rating tiers, Play target-API deadlines, Android vitals thresholds, closed-testing rules): deliberately left out of skill text, or phrased as "check current". Fill them into dated reference files.
- **Benchmarks** (retention, CPI, ROAS, wishlist conversion, review multipliers): genre- and date-specific. Skills say "dated, sourced benchmarks". No numbers are asserted.
- **Health and nutrition numbers** used in skills come from public guidance: WHO 2020 activity guidelines (150–300 min moderate/week + strength ≥2 days), ISSN protein ranges (1.4–2.0 g/kg; ~1.6 g/kg from meta-analysis), AASM ≥7 h sleep for adults, and USDA safe temperatures (poultry 74°C/165°F, the 2-hour rule). Still have a clinician or dietitian review them before launch.
- **Publishing deal practice** (rev share, MG, recoupment) has no single canonical public source. Treat the skill content as practitioner synthesis that needs expert review.
