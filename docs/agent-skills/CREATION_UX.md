# Vox Studio: agent creation UX spec

Scope: Spawn steps 1 (Brief) and 2 (Persona). Steps 3–6 (Look, Voice, Test, Hire) keep their current behaviour; the only change there is that Test uses the role's starter prompts.
Audience: the frontend engineer who builds this next.
Inputs read: `docs/VOX_STUDIO.md`, `screens/Spawn.tsx`, `screens/Spawn.test.tsx`, `ui.tsx`, `studio.css`, `Cloud.tsx`, `Home.tsx`, `Agent.tsx`, `_lib/client.ts`, `_lib/connections-copy.ts`, and the Claude Design export `~/Downloads/Vox Studio Mini App.html`.

**Design reference export (found and unpacked).** It holds 9 boards at 390×844. The three creation boards are "Spawn 1: brief", "Spawn 2: Claude draft" and "Spawn 3: voice". This spec reuses the following from them:
- the brief title "Who do you need?" and the line "Everything is optional. Claude fills the gaps."
- the "Surprise me" action, which this spec merges into one adaptive CTA
- name suggestions as 40 px Unbounded pills under "Claude suggests · pick a name"
- the refine composer pinned above the CTA: a 48 px pill with a 36 px volt send button
- the `.vx-changed` volt underline sweep (700 ms) with the hint "Claude updated 1 line"
- "Won't do" with its overline in `--warn`
- the CTA pattern "Use {name} · choose a voice"
- the segmented control (`#1E2228` track, 4 px padding, 36 px tabs)

Every token in the export matches `studio.css`.

---

## 1. Competitive teardown

**OpenAI GPT builder.** It offers two modes: a conversational builder that drafts the GPT from your description, and a Configure view with name, description, instructions, starters and capabilities ([help](https://help.openai.com/en/articles/8554397-gpt-builder)). The chat proposes a name, offers alternatives, generates a profile picture, auto-writes conversation starters and then interviews you about audience, tone and exclusions ([walkthrough](https://kendratech.substack.com/p/build-your-first-gpt-and-cincyai)).
- *Steal:* the AI names it, gives it a face and writes its starters, so nothing starts blank. Offer name alternatives as one-tap swaps.
- *Avoid:* the multi-turn interview, and two parallel editors (chat and form) for the same state. Creation is also now limited to workspace plans, which shows how much governance can weigh a builder down.

**ChatGPT Skills and agent.** Skills arrived as reusable instruction packs that are separate from a GPT's persona. They were tested late 2025 ([BleepingComputer](https://bleepingcomputer.com/news/artificial-intelligence/openai-is-reportedly-testing-claude-like-skills-for-chatgpt)) and reportedly shipped to workplace plans in July 2026 ([secondary source](https://theaicareerlab.com/blog/chatgpt-skills-what-they-are-how-to-enable-2026)).
- *Steal:* skills are small named units, separate from who the agent is.
- *Avoid:* admin-gated, file-shaped skills. Ours are picked from a curated list.

**Claude Projects and Skills.** Each skill card shows its source, a brief description and an on/off toggle. Claude picks a skill by its description, with no manual invocation ([Anthropic help](https://support.claude.com/en/articles/12512180-using-skills-in-claude)).
- *Steal:* a skill is a title plus a one-line "when this applies" summary, toggled on or off. The summary does real work, so write it that way.
- *Avoid:* ZIP uploads and developer framing.

**Google Gems.** You write "a sentence or two", then the wand ("Use Gemini to re-write instructions") expands it. A preview pane tests the Gem without saving, and premade Gems can be copied and edited ([Google help](https://support.google.com/gemini/answer/15235603), [Google blog](https://blog.google/products/gemini/google-gems-tips/)).
- *Steal:* write a little and let the AI expand it, which is exactly our "Draft with Claude". Use "copy a premade" as the template model.
- *Avoid:* a bare instructions box as the first thing people see, and a split-pane preview that needs desktop width.

**Microsoft Copilot Studio / M365 Agent Builder.** The best "new agent" page in the set, because one screen offers all three ways in: describe it, pick a template, or "Skip to configure". A description yields a name, description, instructions, starter prompts and capabilities, and the starters are reused as one-tap tests in "Try it". It may ask a series of clarifying questions ([Microsoft Learn](https://learn.microsoft.com/en-us/training/modules/build-manage-no-code-copilot-agent-sharepoint/4-create-agent-copilot-chat-part1)).
- *Steal:* three ways in on one page, and starters that do double duty as test prompts.
- *Avoid:* the open-ended clarifying conversation. We allow exactly one question.

**Character.AI.** Name, tagline, greeting, long description, and a "Definition" whose example dialogues "teach the AI specific phrasing and reactions", plus a voice picker ([creation guide, third-party](https://shapes.inc/fandom/character-ai/creation-guide)).
- *Steal:* example dialogue is the fastest way to show what a persona *sounds like*. That is our "How they talk" card.
- *Avoid:* a 32k-character definition field with `{{char}}` syntax. That is expert mode leaking into the default path.

**Poe.** A flat form: picture, a name that is prefilled at random, description, base bot, prompt, knowledge, greeting, suggested replies and temperature ([Poe docs](https://creator.poe.com/docs/how-to-create-a-prompt-bot)).
- *Steal:* the name is never blank.
- *Avoid:* showing model and temperature knobs to everyone.

**Lindy.** Lindy 3.0 (Aug 2025) builds an agent from a prompt and adds department templates ([changelog](https://www.lindy.ai/changelog), [review](https://nocode.mba/articles/lindy-ai-review)).
- *Steal:* prompt first, with templates grouped by job.
- *Avoid:* a workflow canvas for non-technical users.

**Relevance AI.** Three paths: "Invent" from a description, clone a marketplace agent, or build from scratch, then wire agents into "workforces" on a canvas ([docs preview](https://relevance-site-git-invent-page.preview.relevanceai.com/docs/get-started/introduction.md)).
- *Steal:* "clone a pre-built teammate" maps to our role packs.
- *Avoid:* several routes to the same outcome. NN/g warns that multiple routes to the same secondary options add clutter ([NN/g](https://www.nngroup.com/articles/progressive-disclosure/)).

**Dust.** A template opens a Sidekick-guided flow that drafts instructions and proposes tools, and you can "accept, edit, or decline each suggestion" ([Dust docs](https://docs.dust.tt/docs/user-documentation/agents/templates.md)).
- *Steal:* accept or decline each suggestion individually. Our skill chips are exactly this.

**Notion Custom Agents.** "+" offers three starts (describe in chat, template, blank). Notion AI drafts instructions, triggers *and access*, and you review and iterate ([Notion help](https://www.notion.com/help/custom-agent)).
- *Steal:* the AI drafts even the non-obvious settings, and review is a first-class step (our Persona step).
- *Avoid:* there is no test inside the build flow. We keep Test.

**OpenAI AgentKit Agent Builder.** A visual canvas whose reference flow is classify, route, then act ([OpenAI](https://openai.com/index/introducing-agentkit/)). Critics note it becomes hard to read once branches multiply ([Osher](https://osher.com.au/blog/openai-agentkit/)).
- *Steal:* classify-then-route as a first-class step. That is our decision routing, and the user never sees the graph.
- *Avoid:* the canvas.

**Sintra (2025–26 "AI employees").** A fixed cast of named helpers with an onboarding "like a video game" ([Lindy review](https://lindy.ai/blog/sintra-ai-review), [tech.eu](https://tech.eu/2025/06/10/lithuanian-ai-startup-sintra-secures-17m-seed-empowering-smbs-with-ai-helpers/)).
- *Steal:* role-named characters feel like colleagues, which our clouds already do.
- *Avoid:* the closed cast, where you can't create your own. Custom agents must always remain possible here.

**What makes the best ones feel effortless**
1. **One sentence is the whole first screen.** Copilot, Notion and Gems all start from a short description.
2. **Templates are nouns.** "UA Manager" beats a blank page. Nielsen calls a blank prompt a "disclosure cliff" and recommends starter templates on level 1 ([Nielsen](https://jakobnielsenphd.substack.com/p/progressive-disclosure)).
3. **The AI drafts everything,** including name, face, starters and settings.
4. **The draft is the editor.** You review it, then refine with a sentence.
5. **Try it before you save.**

They break down where clarification turns into an interview. Microsoft's own guidance is to "scope services when in doubt" by disambiguating with a few options rather than guessing ([HAX G10](https://www.microsoft.com/en-us/research/blog/guidelines-for-human-ai-interaction-design/)). PAIR warns that showing confidence is a consequential design decision; calibrate trust rather than maximise it ([PAIR](https://pair.withgoogle.com/chapter/People%20+%20AI%20Guidebook%20-%20Explainability%20+%20Trust.pdf)).

---

## 2. Principles

1. **One sentence is enough.** The composer is the hero. Everything else is optional and appears after intent, never before it.
2. **Suggest, don't steer.** A role appears only when routing is confident. It is applied quietly and removed with one tap. Uncertainty becomes *at most one* question, asked only when the user presses Draft. Never show numbers or percentages; confidence is expressed through behaviour (applied, asked or silent).
3. **Show, then tell.** Lead with who they are and how they sound: role, skills, two sample exchanges. Long-form fields come after.
4. **Defaults over decisions.** Name, cloud, skills, languages and voice brief all arrive pre-chosen. Everything personal (presentation, languages, background, accent, temperament) sits behind one "Fine-tune" row.
5. **Colour belongs to the agent; volt belongs to you.** The role's hue tints the cloud and nothing else. Volt marks only actions, focus and the user's own selections. No new colours.
6. **Calm motion, physical feedback.** One easing family, 120–320 ms. Haptics fire only for changes the user caused. Reduced motion means opacity only. Telegram asks for 60 fps and fewer effects on weak Android devices ([Telegram](https://core.telegram.org/bots/webapps)), so at most one animated cloud is on screen.
7. **Never a dead end.** Custom is always possible. If routing fails it falls back to local keywords, and if that fails nothing is shown. The brief text is never lost.

---

## 3. The new Brief step

### 3.1 Model and data contract (what the UI needs)

```ts
// proposed as src/lib/studio/role-library.ts; shipped as src/lib/studio/skills/catalog.ts and skills/route.ts (shared by server routing and the client: no network to browse, instant offline fallback)
export type PackId = 'lifestyle' | 'tech' | 'ai' | 'mobile' | 'publisher';
export type L10n = { en: string; fa: string };
export interface SkillDef { id: string; title: L10n; summary: L10n }               // title ≤ 18 chars, summary ≤ 70
export interface RoleDef {
  id: string; pack: PackId; title: L10n; summary: L10n;                              // title ≤ 24, summary ≤ 44 (one line at 13 px in the card)
  hue: keyof typeof PALETTE; defaultSkills: string[]; optionalSkills: string[];      // 4–6 default
  starters: L10n[];                                                                  // 2–3 "ask me…", each ≤ 48 chars
  keywords: { en: string[]; fa: string[] };                                          // local fallback router
}

// Routing result (Decisions API: fixed answer set + scores; local keyword fallback)
export interface Routing {
  roleId: string | null; pack: PackId | null; skills: string[];
  confidence: number;                // top score, 0..1
  margin: number;                    // top − second
  alternatives: string[];            // up to 3 role ids, best first
  clarify?: { kind: 'pack' | 'role'; options: string[] };  // 'pack': ['work','personal']; 'role': two role ids
  source: 'decisions' | 'keywords' | 'picked' | 'successor';
}

// SpawnBrief additions (src/lib/studio/types.ts)
roleId?: string; skills?: string[];
routing?: { source: Routing['source']; confidence: number };
lookHint?: { hue: string };          // keeps the cloud colour the user saw on Brief → Drafting → Persona
// traits: send ONLY if the user moved a slider (today 50/50/40 is always sent, which contradicts "Claude fills the gaps")
// domain: derived from role.pack (lifestyle→'Personal', tech/ai/mobile→'Product', publisher→'Publishing'); the Domain chips go away

// PersonaSpec additions
roleId?: string; pack?: PackId; skills?: string[];
samples?: Array<{ user: string; agent: string }>;   // exactly 2; user lines come from the role's starters when there is a role
```

API: `api.route({ text, locale, answer?, exclude? }) → Routing` (client timeout 800 ms) and `api.setSkills(agentId, skillIds) → { agent }`. `api.draft(brief, successorOf)` is unchanged in shape.

Thresholds (keep in one constants file so product can tune them):

| Result | Rule | UI |
|---|---|---|
| **Match** | top ≥ 0.75 and margin ≥ 0.15 | Role card appears and is applied (removable) |
| **Ambiguous** | 0.40 ≤ top < 0.75, or margin < 0.15 | Nothing while typing. One question when Draft is pressed |
| **None** | top < 0.40 | Custom. Nothing shown |
| After a clarifier answer | top ≥ 0.55 | Apply; otherwise custom |

### 3.2 Routing behaviour (`useRouting`)

- **Trigger:** at least 3 words or 12 characters, and **700 ms** after the last keystroke. Also triggers immediately on Draft if the current text has not been routed. Never per keystroke. An `AbortController` cancels any in-flight call when typing resumes.
- **Remote first, local fallback.** Call the Decisions API with an 800 ms client budget. On timeout, error or offline, run `localRoute(text, locale)` against `keywords`. Do not show the local result while a remote call is pending, so the role does not flip from local to remote.
- **Hysteresis.** When role R is showing and a new top role R′ arrives, replace R only if R′ is a Match *and* conf(R′) − conf(R) ≥ 0.10. Clear R (fade out) only if the text has changed by more than 40% since R appeared and the new result is None.
- **Respect the user.** A role the user picked or carried from a predecessor (`source: 'picked' | 'successor'`) is never auto-replaced, and routing stops until they detach it. Roles the user dismissed go into `exclude` for the rest of the session and are never re-suggested.
- **One question per session.** Once the clarifier has been shown (answered or skipped), it is never shown again. The answer is sent as `answer` on later routes.
- **Skills.** On a match, turn on `role.defaultSkills` plus any optional skills the classifier picked, at most 6 on. User toggles are remembered per role id while the step is open, so switching roles and back keeps them.
- **Privacy.** Brief text goes to OpenAI only on pause or submit, never per keystroke, and is not logged. Telemetry is content-free (see 3.10). If product prefers zero third-party calls before submit, swap to "local while typing, remote on Draft". The UI does not change.

### 3.3 Layout (390 px, mobile-first)

```
TopBar (unchanged: ‹ Agents · Steps 1/6)
.vx-scroll  (padding 12 16, gap 20, bottom padding clears dock)
 ├─ BriefHeader      overline · vx-title · vx-2 line      [hero Cloud 64, inline-end]
 ├─ BriefComposer    s1 card, r20, textarea 17/24, 3→6 rows, footer row
 ├─ (slot)           PackRow when empty │ RouteCard │ CustomLine │ Clarifier
 ├─ FineTune         disclosure row (collapsed)
 └─ inline error banner (role=alert) when a draft failed
.vx-dock             one primary CTA (adaptive label) │ "Skip — draft as written" while clarifying
```

- **Hero cloud.** `Cloud` at 64 px, stage 2, `hue: 'ash'` until a role is applied, then `role.hue`. Expressions: `idle` at rest, `listening` while the composer has focus and text changes, `thinking` while a route has been in flight for more than 150 ms, `happy` for 1.2 s when a role is first applied, then `idle`. It is the single animated cloud on screen.
- **Safe areas.** The dock already pads with `env(safe-area-inset-bottom)`. Change it to `max(env(safe-area-inset-bottom), var(--tg-safe-area-inset-bottom, 0px))`.
- **Keyboard.** While the composer has focus, listen to `visualViewport` resize events and keep the dock directly above the keyboard (translateY by `innerHeight − visualViewport.height`). Hide FineTune and PackRow so the composer and CTA both fit. Verify on Telegram iOS and Android.
- **RTL.** The step root gets `dir={locale==='fa'?'rtl':'ltr'} lang={locale}`, following the other panels. The composer uses `dir="auto"` so an English UI still accepts Persian briefs. Use logical properties only (`padding-inline`, `inset-inline-end`, `margin-inline-start`). Directional chevrons get `.vx-mirror`.
- **Locale.** Add a `useStudioLocale()` hook: `tg().initDataUnsafe.user.language_code` starts with `fa` → `'fa'`, else `'en'`. **Phase 1:** English chrome with Persian-aware input and output (dir=auto, Persian examples, Persian role titles when the brief is Persian). **Phase 2:** turn on the FA chrome once all six steps have copy, so the flow does not switch languages halfway.
- **Fonts.** Onest and Unbounded have no Arabic glyphs, so Persian falls back to system-ui. Letter-spacing breaks Arabic joining, so tracking and uppercase are reset under RTL (see CSS).

### 3.4 Copy (EN / FA)

| Key | EN | FA |
|---|---|---|
| overline | Spawn an agent | ساخت همکار جدید |
| overline (successor) | Successor to {name} | جانشین {name} |
| title | Who do you need? | به چه کسی نیاز دارید؟ |
| title (successor) | Who comes after {name}? | چه کسی جای {name} را می‌گیرد؟ |
| sub | Describe them in a sentence, in any language. Claude fills in the rest. | در یک جمله و به هر زبانی توصیفش کنید. بقیه را Claude کامل می‌کند. |
| composer label (sr-only) | Describe who you need | توصیف همکاری که لازم دارید |
| example 1 | A running coach who keeps me honest | مربی دویدنی که نگذارد از برنامه عقب بمانم |
| example 2 | Someone to run UA for our puzzle game launch in Turkey | کسی که جذب کاربر عرضهٔ بازی پازل ما در ترکیه را پیش ببرد |
| example 3 | A calm product lead who remembers every decision | مدیر محصولی آرام که همهٔ تصمیم‌ها یادش بماند |
| example 4 | A tutor who helps my daughter with maths in Persian | معلمی که به دخترم ریاضی را به فارسی یاد بدهد |
| successor placeholder | What should be different from {name}? | چه چیزی با {name} فرق کند؟ |
| pack row overline | Or start from a role | یا از یک نقش شروع کنید |
| packs (short) | Life · Tech · AI · Mobile · Publishing | زندگی · فناوری · هوش مصنوعی · موبایل · نشر بازی |
| packs (full) | Lifestyle · Tech company · AI company · Mobile company · Publisher | سبک زندگی · شرکت فناوری · شرکت هوش مصنوعی · شرکت موبایل · ناشر بازی |
| browse link | Browse roles | مرور نقش‌ها |
| card overline (routed) | Suggested role · {pack} | نقش پیشنهادی · {pack} |
| card overline (picked) | Starting from · {pack} | شروع از · {pack} |
| card overline (successor) | Same role as {name} | همان نقش {name} |
| skills overline | Skills | مهارت‌ها |
| more skills chip | + {n} more / + Add | + {n} مورد دیگر / + افزودن |
| change | Change | تغییر |
| detach (aria) | Keep it custom | سفارشی بماند |
| detached toast-line | Keeping it custom. **Undo** | سفارشی می‌ماند. **بازگرداندن** |
| custom line | Custom agent | همکار سفارشی |
| clarifier overline | One quick question | یک سؤال کوتاه |
| clarifier pack | For work or your personal life? | برای کار یا زندگی شخصی؟ |
| options | Work · Personal life | کار · زندگی شخصی |
| clarifier role | Which is closer? | کدام نزدیک‌تر است؟ |
| skip | Skip — draft as written | رد شو و همین را پیش‌نویس کن |
| fine-tune | Fine-tune | تنظیم جزئیات |
| fine-tune summary (default) | Claude decides | به انتخاب Claude |
| fields | Presents as · Languages · Background · Accent · Temperament | جنسیت · زبان‌ها · پیشینه · لهجه · خلق‌وخو |
| presentation | Woman · Man · Neutral | زن · مرد · خنثی |
| sliders | Warm–Direct · Playful–Serious · Concise–Expansive | گرم–رک · شوخ–جدی · کوتاه–مفصل |
| auto language note | Persian (from your brief) | فارسی (از توصیف شما) |
| CTA empty | Surprise me | غافلگیرم کن |
| CTA | Draft with Claude | پیش‌نویس با Claude |
| CTA successor | Draft the successor | پیش‌نویس جانشین |
| CTA offline | You're offline | آفلاین هستید |
| offline banner | You're offline. Roles still work; drafting needs a connection. | آفلاین هستید. نقش‌ها کار می‌کنند؛ پیش‌نویس به اینترنت نیاز دارد. |
| error suffix | Your brief is safe. | متن شما محفوظ است. |
| retry | Try again | دوباره امتحان کنید |
| drafting (role) | Imagining your {role}… | در حال ساختن {role} شما… |
| drafting (custom) | Claude is imagining them… | Claude دارد تصورش می‌کند… |
| drafting beats | Choosing a name · Writing how they talk · Picking skills · Shaping their cloud | انتخاب نام · نوشتن لحن گفتار · انتخاب مهارت‌ها · شکل دادن ابرش |

Counts in FA use `Intl.NumberFormat('fa-IR')`. Keep the copy in `_lib/spawn-copy.ts`, following the `connections-copy.ts` pattern.

### 3.5 States, screen by screen

Wireframes are 390 px wide. `( )` marks a chip, `╭╮` a card, `▏` the caret.

#### S0 · Empty (first open)
```
┌──────────────────────────────────────────┐
│ ‹ Agents         ▬ ▪ ▪ ▪ ▪ ▪             │
│ SPAWN AN AGENT                    .--.   │  overline · hero Cloud 64 (ash, idle)
│ Who do you need?                 ( ·· )  │  .vx-title
│ Describe them in a sentence, in   `--'   │  .vx-2
│ any language. Claude fills in the rest.  │
│ ╭──────────────────────────────────────╮ │
│ │ A running coach who keeps me honest  │ │  rotating example (text-3), 17/24
│ │                                      │ │
│ │                                      │ │
│ ╰──────────────────────────────────────╯ │
│ OR START FROM A ROLE                     │
│ (Life) (Tech) (AI) (Mobile) (Publishing)→│  scroll-x, 40 px chips
│ ┌──────────────────────────────────────┐ │
│ │ Fine-tune            Claude decides ⌄│ │  disclosure, 56 px
│ └──────────────────────────────────────┘ │
│ ╭──────────────────────────────────────╮ │
│ │            ⚄  Surprise me            │ │  primary, dice icon
│ ╰──────────────────────────────────────╯ │
└──────────────────────────────────────────┘
```
- The composer is **not** auto-focused, because focusing would raise the keyboard over the pack row. A tap anywhere on the card focuses it.
- The example overlay rotates every 3.2 s (fade out 160 ms, in 240 ms, `--ease`). It stops on focus and never rotates under reduced motion. The textarea keeps a stable `aria-label`, and its `aria-describedby` points to a hidden "For example: …" line.
- **Surprise me** behaves as today (empty brief). Haptic `tap`. The cloud does one `vxHop`.

#### S1 · Typing
```
│ ╭──────────────────────────────────────╮ │  border rgba(volt,.4); bg s1
│ │ someone to run UA for our puzzle     │ │  cloud → listening
│ │ game launch in Turkey▏               │ │
│ │                        Browse roles ›│ │  footer: link (counter from 500/600)
│ ╰──────────────────────────────────────╯ │
│ ┌──────────────────────────────────────┐ │
│ │ Fine-tune            Claude decides ⌄│ │  (hidden while keyboard is up)
│ ╰──────────────────────────────────────╯ │
│ ╭──────────────────────────────────────╮ │
│ │         ✦  Draft with Claude         │ │  label crossfades from "Surprise me"
```
- When the first character is typed, PackRow collapses (height to 0, 240 ms) and "Browse roles" appears in the composer footer. That is the only place it appears while text exists, so there is never more than one route to the sheet on screen.
- Counter `{n}/600` shows from 500 characters onward (`.vx-count`). `maxLength` is 600, as today.
- Cmd/Ctrl+Enter submits. Plain Enter inserts a newline.

#### S2 · Routing (in flight)
Same as S1 visually. Only the hero cloud changes, to `thinking`, after 150 ms. There are no spinners in content. An existing card stays put; it is not dimmed or replaced until a new result passes hysteresis.

#### S3 · Matched (role applied)
```
│ ╭──────────────────────────────────────╮ │
│ │ someone to run UA for our puzzle     │ │
│ │ game launch in Turkey                │ │
│ ╰──────────────────────────────────────╯ │
│ ╭──────────────────────────────────────╮ │  .vx-route (enter: y8→0, 280 ms, --ease-in)
│ │ (☁) SUGGESTED ROLE · MOBILE COMPANY ✕│ │  mini Cloud 40 in role hue (.vx-still)
│ │     UA Manager                       │ │  17/22 · 600
│ │     Buys installs that pay back.     │ │  13/18 · text-2 · 1 line
│ │ ──────────────────────────────────── │ │
│ │ (Paid UA) (Creative testing)         │ │  .vx-skill on (s3)
│ │ (ROAS modelling) (Geo launch plans)  │ │
│ │ (Budget pacing) ( + 3 more )         │ │  opens SkillsSheet
│ │                            Change ›  │ │  opens RoleSheet (alternatives on top)
│ ╰──────────────────────────────────────╯ │
```
- The hero cloud crossfades from ash to lagoon (320 ms, `--ease-in`), with a scale spring from 0.92 to 1 (stiffness 420, damping 16, the same values LookStep uses), then shows `happy` for 1.2 s.
- **No haptic when a suggestion arrives passively while typing,** because the keyboard is already giving tactile feedback. A visually-hidden `role="status"` announces "Suggested role: UA Manager, Mobile company" **only when the role id changes**.
- **Skill chip tap** toggles on/off in place (`aria-pressed`, haptic `select`). Off chips stay where they are, dashed in `text-3`, so a mistaken tap is fixed with a second tap. No undo toast is needed.
- **✕ (Keep it custom)** collapses the card into S3b and adds the role to `exclude`. Haptic `select`.
- **Change** opens RoleSheet with "Closest to your brief" listing `alternatives` above the packs.
- **CTA** is "Draft with Claude". The brief now includes `roleId`, `skills` (on only), `routing` and `lookHint.hue`.

#### S3b · Detached (custom)
```
│ Custom agent · Keeping it custom.  Undo  │  5 s, then →
│ Custom agent                Browse roles›│  .vx-custom-line, 44 px
```
Undo restores the role and its skill toggles, and removes it from `exclude`.

#### S4 · Picked from the library
This is S3 with the overline "Starting from · {pack}". It is reached from PackRow (S0), from "Browse roles" or from "Change".
- Routing then stops for the session until the role is detached.
- If the composer is empty, the placeholder changes to "Anything specific? e.g. *for our Turkish launch, weekly reports*" / «نکتهٔ خاصی هست؟ مثلاً گزارش هفتگی برای عرضه در ترکیه». The brief stays optional, and the CTA reads "Draft with Claude".

**RoleSheet** (existing `Sheet`, label "Roles"):
```
│              ───                         │
│ Roles                                    │  .vx-title-m
│ [Life][Tech][AI][Mobile][Publishing]     │  role=tablist, scroll-x; initial = tapped pack or routed pack
│ CLOSEST TO YOUR BRIEF                    │  only when alternatives exist
│ ┌──────────────────────────────────────┐ │
│ │ (☁) UA Manager                     ✓ │ │  .vx-pick-row 64 px; static mini Cloud 36
│ │     Buys installs that pay back.     │ │
│ ├──────────────────────────────────────┤ │
│ │ (☁) Publishing Producer              │ │
│ │     Takes a game from soft launch…   │ │
│ └──────────────────────────────────────┘ │
│ MOBILE COMPANY                           │
│ … 8–10 rows …                            │
│ Keep it custom                           │  text button, 44 px
```
- Tapping a row applies the role, closes the sheet and fires haptic `select`. No confirm step is needed: the choice is visible on the card and reversible.
- Clouds in the sheet are static (`.vx-still`), so ten SVGs cost nothing on low-end Android.
- On open, focus goes to the selected tab. On close, focus returns to the opener. Esc closes the sheet.

#### S5 · Clarifying (only after Draft is pressed, at most once)
Pack-level variant (`kind: 'pack'`), for example "a coach who keeps me honest about deadlines":
```
│ ╭──────────────────────────────────────╮ │
│ │ a coach who keeps me honest about    │ │
│ │ deadlines                            │ │
│ ╰──────────────────────────────────────╯ │
│ ╭──────────────────────────────────────╮ │  .vx-ask (enter 280 ms --ease-in)
│ │ ONE QUICK QUESTION                   │ │
│ │ For work or your personal life?      │ │  17/22 · 600 · id=ask-q
│ │ ╭────────────────╮╭────────────────╮ │ │  role=radiogroup, options 52 px
│ │ │ Work           ││ Personal life  │ │ │
│ │ ╰────────────────╯╰────────────────╯ │ │
│ ╰──────────────────────────────────────╯ │
│ ╭──────────────────────────────────────╮ │
│ │       Skip — draft as written        │ │  dock: secondary
│ ╰──────────────────────────────────────╯ │
```
Role-level variant (`kind: 'role'`), for example "someone to run UA for our puzzle launch", where Mobile and Publisher score within 0.15 of each other:
```
│ │ Which is closer?                     │ │
│ │ ╭────────────────╮╭────────────────╮ │ │
│ │ │ UA Manager     ││ Publishing     │ │ │
│ │ │ Mobile company ││ Producer       │ │ │  sub-line 13 px text-2
│ │ ╰────────────────╯╰────────────────╯ │ │  Publisher
```
- On appear, haptic `soft`, the composer blurs and focus moves to the first option. Arrow keys move between options (roving tabindex).
- **On answer:** haptic `select`. The chosen option gets a volt border and its label becomes a 14 px Spinner. The other options fade to 0.4.
  - *Role answer:* apply that role (`source: 'picked'`) and start drafting at once. The user already asked to draft, so the answer *is* the submit.
  - *Pack answer:* re-route with `answer` (800 ms budget). If top ≥ 0.55, apply it; otherwise draft custom. Either way, drafting starts immediately.
- **Skip:** draft custom with no role. In both cases the clarifier is marked as asked and never returns.

#### S6 · Drafting (full screen, replaces `Drafting`)
```
│                                          │
│                 .-~~-.  ∘                │  Cloud 150, role hue (or the existing
│                (  ◔ ◔ )∘                 │  3-hue carousel when custom), thinking
│                 `-..-'                   │
│        Imagining your UA Manager…        │  .vx-title-m
│           Writing how they talk          │  .vx-2, crossfades every 2.4 s
│                                          │
```
- The beats are honest stages, not a fake progress bar. They stop on the last beat and do not loop.
- `aria-live="polite"` announces the title once, not each beat.
- When the draft arrives: haptic `success` (as today), then the step transition. *Nice to have:* a shared `layoutId="spawn-cloud"` from the drafting cloud to the Persona face. If `AnimatePresence mode="wait"` prevents it, fall back to the existing spring scale-in.

#### S7 · Draft failed
```
│ ╭ composer: text intact ───────────────╮ │
│ ╭ route card: intact ──────────────────╮ │
│ ┌──────────────────────────────────────┐ │  .vx-banner.danger role=alert
│ │ ⚠ {errorMessage}. Your brief is safe.│ │
│ │                          Try again › │ │
│ └──────────────────────────────────────┘ │
│ ╭──────────────────────────────────────╮ │
│ │         ✦  Draft with Claude         │ │  enabled
```
- **Render the error inline above the dock, not in SpawnScreen's top `role="alert"`, and never both.** The existing test calls `getByRole('alert')`, which fails if there are two.
- Haptic `error` (as today). State is preserved because BriefStep stays mounted.

#### S8 · Offline (`navigator.onLine === false`, `online`/`offline` events)
- Show an info banner (`.vx-banner.info`) at the top of the scroll area.
- Local routing still runs, so cards and the library work. The CTA is disabled and reads "You're offline".
- On reconnect, the banner fades out (160 ms) and the CTA re-enables. There is no haptic.

#### S9 · Successor (`successorOf` set)
- Prefetch `api.agent(successorOf)`.
- Overline "Successor to Aria". Title "Who comes after Aria?". Placeholder "What should be different from Aria?".
- The card is pre-applied with the predecessor's `roleId` and `skills` (`source: 'successor'`, overline "Same role as Aria"). It is detachable like any other role.
- CTA "Draft the successor".
- If the predecessor has no `roleId` (legacy), show the custom line with the predecessor's `persona.role` as plain text.

#### S10 · Fine-tune expanded
```
│ ┌──────────────────────────────────────┐ │
│ │ Fine-tune  Woman · Persian, English ⌃│ │  summary = what's set; else "Claude decides"
│ ├──────────────────────────────────────┤ │
│ │ PRESENTS AS                          │ │
│ │ (Woman) (Man) (Neutral)              │ │  single-select chips (unchanged semantics)
│ │ LANGUAGES                            │ │
│ │ (English)(Persian✓)(Vietnamese)(…)   │ │  multi; Persian pre-marked "from your brief"
│ │ BACKGROUND                           │ │
│ │ [Persian, Tehran   ] [Early 30s    ] │ │  culture · age (2-col grid as today)
│ │ ACCENT                               │ │
│ │ [Soft Tehrani English              ] │ │  hint: real accents work best
│ │ TEMPERAMENT                          │ │
│ │ Warm ──────●────── Direct            │ │  sliders; sent only if touched
│ │ Playful ───●────── Serious           │ │
│ │ Concise ──●─────── Expansive         │ │
│ └──────────────────────────────────────┘ │
```
- Height animates from 0 to auto in 240 ms (`--ease`). The chevron rotates 180°.
- The summary shows a maximum of 3 items, then "+n".
- **Auto language.** If the brief contains Persian script, Persian shows as pre-selected with the note "(from your brief)". A user tap overrides it.

### 3.6 Motion tokens (mirror `studio.css` in `screens/spawn/motion.ts`)

```ts
export const EASE = { standard: [0.2, 0, 0, 1], enter: [0.05, 0.7, 0.1, 1], over: [0.34, 1.56, 0.64, 1] } as const; // --ease, --ease-in, --ease-over
export const DUR = { press: 0.12, state: 0.18, exit: 0.16, enter: 0.28, layout: 0.32, sweep: 0.7 } as const;
```

| Element | Motion |
|---|---|
| Press (chips, buttons) | scale 0.96–0.97, 120 ms (existing `:active`) |
| Chip on/off, borders, focus | 180 ms `--ease` |
| Card / clarifier enter | opacity 0→1, y 8→0, 280 ms `EASE.enter`; siblings `layout` 320 ms |
| Card exit | opacity →0, 160 ms `EASE.standard` |
| Role change inside card | title crossfade 200 ms; chips stagger 30 ms, scale 0.9→1, 240 ms `EASE.over` |
| Hero cloud hue | crossfade 320 ms + spring (420/16) |
| CTA label change | `AnimatePresence mode="popLayout"`, 160 ms crossfade |
| Fine-tune | height auto 240 ms; chevron 240 ms |
| Step transition | unchanged (x 24, 240 ms) |

Under `useReducedMotion()`: every transition becomes opacity-only at 120 ms. There is no placeholder rotation, no hop or spring, and no `.vx-changed` sweep (a static underline instead). The CSS cloud animations are already disabled under reduced motion.

### 3.7 Haptics (Telegram rules: `selectionChanged` only when a selection *changes*)

| Event | Call |
|---|---|
| Draft / Surprise me / Try again | `haptic.tap()` |
| Skill toggle, pack/role pick, clarifier answer, detach, undo, Fine-tune chip | `haptic.select()` |
| Clarifier appears | `haptic.soft()` |
| Draft ready | `haptic.success()` (existing) |
| Draft failed | `haptic.error()` (existing) |
| Passive suggestion while typing, offline/online changes | none |

### 3.8 Accessibility

- **Targets.** Every control is at least 44×44. Chips are visually 32–40 px and reach 44 px with `.vx-hit`.
- **Composer.** `aria-label="Describe who you need"` and `aria-describedby` pointing to the example hint. It uses `dir="auto"`. The textarea's own outline is suppressed only because `.vx-composer:focus-within` draws the volt focus border.
- **Route card.** `<section aria-labelledby>`. The ✕ button has `aria-label="Keep it custom"`. The skill group is `role="group"` with `aria-label="Skills"` and contains toggle buttons with `aria-pressed`. Role changes are announced by a single polite status node.
- **Clarifier.** `role="radiogroup" aria-labelledby="ask-q"`, options with `role="radio" aria-checked`. Focus moves in on appear and goes to the CTA (or Drafting) after an answer.
- **Fine-tune.** `<button aria-expanded aria-controls="fine-tune">`, with a `role="region"` body.
- **Sheets.** The existing `Sheet` needs three additions: focus the first control on open, restore focus on close, and close on Esc. Tabs use `role="tablist"`/`tab` with `aria-selected`.
- **Order.** Header → composer → card (✕, skills, Change) → Fine-tune → error → CTA.
- **Contrast.** `--text-3` is used only for placeholder, counter and off-chips. Real text uses `--text`/`--text-2`.
- **RTL.** `letter-spacing: 0` and no uppercase for Persian headings and overlines. Directional icons are mirrored. Bubbles and ✕ use logical insets.

### 3.9 Test impact (`Spawn.test.tsx`)

- **Placeholder query.** `getByPlaceholderText(/a calm product lead/i)` breaks because of the rotating overlay. Query `getByRole('textbox', { name: /describe who you need/i })` instead.
- **Persian chip.** The test that clicks the 'Persian' chip must open "Fine-tune" first.
- **Persona CTA.** `/looks good.*next/i` becomes `/use .* pick a look/i`.
- **Route mock.** Mock `api.route`. If it is unmocked, the local fallback must return None so drafting proceeds. Account for the up-to-800 ms route-on-submit under fake timers.
- **Single alert.** Keep exactly one `role="alert"` for draft errors.

### 3.10 Telemetry (content-free; no brief text)

Events: `spawn_route_shown{source, pack, bucket}`, `spawn_route_detached`, `spawn_role_picked{from}`, `spawn_clarify_{shown|answered|skipped}{kind}`, `spawn_skill_toggled{on}`, `spawn_drafted{has_role, source, skills_n, fine_tuned}`.

Targets:
- detach rate below 15%; this is the "not pushy" check
- clarifier skip rate below 30%
- median time from open to Draft below 20 s

---

## 4. Persona step additions

### 4.1 Layout

```
┌──────────────────────────────────────────┐
│ ‹ Back           ▪ ▬ ▪ ▪ ▪ ▪          🗑 │
│  .--.                                    │
│ ( ◠◠ ) Leyla                             │  AgentFace 88 · .vx-title
│  `--'  ● UA Manager · Mobile company     │  .vx-role-line (hue dot)
│        Turkish · 30s · Istanbul English  │  .vx-small .vx-3
│ OTHER NAMES CLAUDE LIKED                 │
│ (Leyla) (Deniz) (Ece)                    │  .vx-name-chip (Unbounded 15, 40 px)
│ “Buys installs that pay back, and says   │  tagline 17/24
│  so when they don’t.”                    │
│ SKILLS · 5                               │
│ (Paid UA) (Creative testing)             │  same SkillChips as Brief
│ (ROAS modelling) (Geo launch plans)      │
│ (Budget pacing) ( + Add )                │
│ HOW THEY TALK                            │
│ ╭──────────────────────────────────────╮ │  .vx-card .vx-samples
│ │        What CPI should we aim for in │ │  .vx-bubble.me (s3, end)
│ │                             Turkey?  │ │
│ │ (☁) Under $0.50 on Android is        │ │  .vx-bubble.them (s2, start, face 20)
│ │     realistic. I’d test five         │ │
│ │     creatives before scaling.        │ │
│ │           Can we skip soft launch?   │ │
│ │ (☁) We can, but I wouldn’t. Three    │ │
│ │     weeks tells us if D7 holds.      │ │
│ ╰──────────────────────────────────────╯ │
│ PROFILE                                  │
│ ┌ Name · Role · Tagline · Personality ·  │  existing EditableRows
│ │ Backstory · Values · Won’t do (warn)·  │
│ │ Languages · Speaking style           ┐ │
│ ╭──────────────────────────────────────╮ │  pinned .vx-refine (dock row 1)
│ │ Ask Claude: make her more playful… ↑ │ │
│ ╰──────────────────────────────────────╯ │
│ ╭──────────────────────────────────────╮ │  dock row 2 (hidden while refine has focus)
│ │       Use Leyla · pick a look        │ │
│ ╰──────────────────────────────────────╯ │
└──────────────────────────────────────────┘
```

### 4.2 Behaviour

- **Role line.** It shows the role title, a 8 px dot in `PALETTE[look.hue].base`, and the full pack name. Custom agents show `persona.role` with no pack and a `--text-3` dot. To rename the role, use the existing "Role" EditableRow. Template roles are not swapped after drafting; skills are the lever for that.
- **Name chips.** Restyle the existing "Other names Claude liked" chips as `.vx-name-chip` (Unbounded 15 px, 40 px tall, as in the design export). Behaviour is unchanged.
- **Skills.** These use the same `SkillChips` as Brief: tap to toggle off (dashed, kept in place), tap again to restore.
  - Saving is optimistic with a 600 ms debounce (`api.setSkills`). On failure, revert and show the existing toast.
  - "+ Add" opens the **SkillsSheet** with these sections:
    - "On", listing each on skill's title and summary
    - "Suggested for {role}", listing the role's `optionalSkills`
    - "More skills", a search field over the full library that appears when the user types
  - Rows are 56 px with a trailing check toggle. The cap is **8**; at the cap, add buttons are disabled with the hint "Up to 8 skills. Turn one off first." / «حداکثر ۸ مهارت. اول یکی را خاموش کنید.»
  - Chips are read-only when `!agent.canEdit` (locked agents).
  - **Expertise.** Hide the Expertise row when `skills` exist, since skills supersede it. Legacy agents still show it.
- **How they talk.** Two `samples` generated at draft time. The user lines come from the role's `starters` (custom agents get Claude-written questions). Agent replies are at most 220 characters each, written in the agent's first language.
  - The section is hidden if `samples` is missing, which covers legacy drafts.
  - Bubbles: "me" uses `--s3` (deliberately *not* volt, because these are illustrations rather than your messages). "them" uses `--s2` with a 20 px static face at the inline-start.
  - The existing "How they talk" EditableRow is renamed **"Speaking style"** to avoid two sections with the same name.
- **Refine-by-instruction stays.** It moves from the card into a pinned pill composer (the design export pattern). Placeholder: "Ask Claude: make her more playful…" / «از Claude بخواهید: کمی شوخ‌طبع‌ترش کن…».
  - Send is disabled when the input is empty or a refine is running, and shows a Spinner while busy. Enter submits.
  - Refine may change persona fields, `skills` and `samples`. Diff before and after (`useChangedFields`). Changed text fields get `.vx-changed`, and new skill chips scale in (240 ms `EASE.over`).
  - A polite status line reports "Claude updated {n} fields" / «Claude {n} بخش را به‌روز کرد».
  - Haptic `success` on completion, as today.
  - While the refine input has focus, the CTA row hides, so with the keyboard up the user sees content plus the composer.
- **Won't do.** The overline uses `--warn`, as in the design export.
- **CTA.** "Use {name} · pick a look" / «{name} را نگه دار · انتخاب ظاهر». Save-then-next and `editing` behaviour are unchanged; while editing a row, the CTA keeps the "Save & next" label.
- **Test step.** The suggestion chips become `role.starters` in the agent's locale, falling back to today's three.

---

## 5. CSS additions and component breakdown

### 5.1 CSS (append to `studio.css`; existing tokens only)

The only new values are volt and black alphas, and the existing file already uses both.

```css
/* ---- utilities ---- */
.vx-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.vx-hit { position: relative; }
.vx-hit::after { content: ""; position: absolute; inset-inline: 0; top: calc(50% - 22px); height: 44px; }   /* 44 px target for 32–40 px chips */
.vx-still, .vx-still * { animation: none !important; }                                                        /* static mini clouds */
.vx-link { min-height: 44px; display: inline-flex; align-items: center; gap: 4px; background: none; border: 0; padding: 0; color: var(--text-2); font-size: 13px; font-weight: 600; cursor: pointer; }
.vx-link:active { color: var(--text); }
.vx [dir="rtl"] .vx-mirror { transform: scaleX(-1); }
.vx [dir="rtl"] :is(.vx-display, .vx-title, .vx-title-m, .vx-over, .vx-pill) { letter-spacing: 0; text-transform: none; }  /* tracking breaks Arabic-script joining */

/* ---- brief ---- */
.vx-brief { display: flex; flex-direction: column; gap: 20px; }
.vx-brief-head { display: flex; align-items: flex-end; gap: 12px; }
.vx-brief-head > :first-child { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.vx-composer { position: relative; background: var(--s1); border: 1px solid var(--hair); border-radius: 20px; padding: 14px 16px 6px; transition: border-color .18s var(--ease); cursor: text; }
.vx-composer:focus-within { border-color: rgba(214, 255, 92, .4); }
.vx-composer-input { display: block; width: 100%; min-height: 72px; max-height: 144px; padding: 0; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 17px; line-height: 24px; resize: none; outline: none; }
.vx-composer-ph { position: absolute; inset-inline: 16px; top: 14px; color: var(--text-3); font-size: 17px; line-height: 24px; pointer-events: none; }
.vx-composer-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 44px; }
.vx-count { font-size: 11px; line-height: 14px; color: var(--text-3); font-feature-settings: "tnum"; }
.vx-packs { display: flex; gap: 8px; overflow-x: auto; margin-inline: -16px; padding-inline: 16px; scrollbar-width: none; }
.vx-packs::-webkit-scrollbar { display: none; }
.vx-packs .vx-chip { height: 40px; padding: 0 16px; font-size: 14px; }

/* ---- route card ---- */
.vx-route { background: var(--s1); border: 1px solid var(--hair); border-radius: 20px; padding-block: 12px 4px; padding-inline: 16px 8px; display: flex; flex-direction: column; gap: 10px; }
.vx-route-head { display: flex; align-items: flex-start; gap: 12px; }
.vx-route-head > div { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; padding-top: 2px; }
.vx-route-title { font-weight: 600; font-size: 17px; line-height: 22px; }
.vx-route-sum { font-size: 13px; line-height: 18px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vx-route-rule { height: 1px; background: var(--hair); margin-inline-end: 8px; }
.vx-route-foot { display: flex; justify-content: flex-end; padding-inline-end: 8px; }
.vx-custom-line { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 44px; padding-inline: 4px; color: var(--text-2); font-size: 14px; }

/* ---- skills ---- */
.vx-skills { display: flex; flex-wrap: wrap; gap: 8px; }
.vx-skill {
  height: 36px; padding: 0 14px; border-radius: 999px; border: 1px solid transparent; background: var(--s3); color: var(--text);
  font-size: 13px; font-weight: 500; white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
  transition: background .18s var(--ease), color .18s var(--ease), border-color .18s var(--ease), transform .12s var(--ease);
}
.vx-skill:active { transform: scale(.96); }
.vx-skill[aria-pressed="false"] { background: transparent; border-color: var(--hair); border-style: dashed; color: var(--text-3); }
.vx-skill-add { background: transparent; border: 1px dashed var(--hair); color: var(--text-2); }
.vx-skill:disabled { cursor: default; transform: none; }

/* ---- one clarifying question ---- */
.vx-ask { display: flex; flex-direction: column; gap: 12px; padding: 16px; background: var(--s1); border: 1px solid var(--hair); border-radius: 20px; }
.vx-ask-q { margin: 0; font-weight: 600; font-size: 17px; line-height: 22px; }
.vx-ask-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(128px, 1fr)); gap: 8px; }
.vx-ask-option {
  min-height: 52px; padding: 10px 14px; border-radius: 16px; border: 1px solid var(--hair); background: var(--s2); color: var(--text);
  display: flex; flex-direction: column; justify-content: center; gap: 2px; text-align: start; font-weight: 600; font-size: 15px; line-height: 20px; cursor: pointer;
  transition: border-color .18s var(--ease), background .18s var(--ease), opacity .18s var(--ease), transform .12s var(--ease);
}
.vx-ask-option:active { transform: scale(.97); }
.vx-ask-option[aria-checked="true"] { border-color: var(--volt); background: rgba(214, 255, 92, .08); color: var(--volt); }
.vx-ask-option[data-dim] { opacity: .4; }
.vx-ask-sub { font-size: 13px; line-height: 18px; font-weight: 500; color: var(--text-2); }

/* ---- disclosure (Fine-tune) ---- */
.vx-disclose { width: 100%; min-height: 56px; display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: var(--s1); border: 1px solid var(--hair); border-radius: 16px; color: var(--text); text-align: start; cursor: pointer; }
.vx-disclose[aria-expanded="true"] { border-end-start-radius: 0; border-end-end-radius: 0; }
.vx-disclose-sum { flex: 1; min-width: 0; text-align: end; color: var(--text-2); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vx-disclose-chev { flex-shrink: 0; color: var(--text-2); transition: transform .24s var(--ease); }
.vx-disclose[aria-expanded="true"] .vx-disclose-chev { transform: rotate(180deg); }
.vx-disclose-body { display: flex; flex-direction: column; gap: 20px; padding: 16px; background: var(--s1); border: 1px solid var(--hair); border-top: 0; border-radius: 0 0 16px 16px; }

/* ---- sheet lists (RoleSheet, SkillsSheet) ---- */
.vx-tabs { display: flex; gap: 8px; overflow-x: auto; margin-inline: -16px; padding: 0 16px 4px; scrollbar-width: none; }
.vx-tabs::-webkit-scrollbar { display: none; }
.vx-tabs [role="tab"][aria-selected="true"] { background: var(--text); color: var(--ground); }
.vx-pick-row { width: 100%; min-height: 64px; display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: none; border: 0; border-top: 1px solid var(--hair); color: var(--text); text-align: start; cursor: pointer; }
.vx-pick-row:first-child { border-top: 0; }
.vx-pick-row:active { background: var(--s2); }
.vx-pick-row > div { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.vx-pick-row[aria-selected="true"] .vx-pick-check, .vx-pick-row[aria-pressed="true"] .vx-pick-check { color: var(--volt); }

/* ---- persona ---- */
.vx-role-line { display: flex; align-items: center; gap: 6px; color: var(--text-2); font-size: 15px; line-height: 21px; min-width: 0; }
.vx-hue-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--hue, var(--text-3)); flex-shrink: 0; }
.vx-name-chip { height: 40px; padding: 0 18px; font-family: var(--font-unbounded), sans-serif; font-weight: 500; font-size: 15px; }
.vx-samples { padding: 16px; display: flex; flex-direction: column; gap: 8px; }
.vx-bubble { max-width: 84%; padding: 10px 14px; border-radius: 20px; font-size: 15px; line-height: 21px; white-space: pre-wrap; overflow-wrap: anywhere; }
.vx-bubble.me { align-self: flex-end; background: var(--s3); border-end-end-radius: 6px; }
.vx-bubble.them { align-self: flex-start; background: var(--s2); border-end-start-radius: 6px; }
.vx-said { display: flex; align-items: flex-end; gap: 8px; align-self: flex-start; max-width: 92%; }
.vx-said > .vx-bubble { max-width: none; }
.vx-dock-stack { flex-direction: column; }
.vx-refine { display: flex; align-items: center; gap: 8px; height: 48px; padding-inline: 16px 6px; border-radius: 999px; background: var(--s2); border: 1px solid var(--hair); transition: border-color .18s var(--ease); }
.vx-refine:focus-within { border-color: rgba(214, 255, 92, .4); }
.vx-refine input { flex: 1; min-width: 0; height: 100%; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 15px; outline: none; }
.vx-refine input::placeholder { color: var(--text-3); }
.vx-send { width: 36px; height: 36px; flex-shrink: 0; border-radius: 999px; border: 0; background: var(--volt); color: var(--on-volt); display: grid; place-items: center; cursor: pointer; transition: background .18s var(--ease), transform .12s var(--ease); }
.vx-send:active { transform: scale(.94); }
.vx-send:disabled { background: var(--s3); color: var(--text-3); cursor: default; transform: none; }
@keyframes vxSweep { from { background-size: 0% 2px; } to { background-size: 100% 2px; } }
.vx-changed { background-image: linear-gradient(var(--volt), var(--volt)); background-repeat: no-repeat; background-position: 0 100%; animation: vxSweep .7s var(--ease) both; }
.vx [dir="rtl"] .vx-changed { background-position: 100% 100%; }

@media (prefers-reduced-motion: reduce) {
  .vx-changed { animation: none; background-size: 100% 2px; }
  .vx-skill, .vx-ask-option, .vx-disclose-chev, .vx-composer { transition-duration: .01s; }
}
```

Icon additions in `ui.tsx` `PATHS`:
- `chevron: 'M6 9l6 6 6-6'`
- `chevronEnd: 'M9 6l6 6-6 6'` (add `.vx-mirror` under RTL)
- `search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M20 20l-4-4'`

`close`, `dice`, `spark`, `send`, `plus` and `check` already exist.

### 5.2 Components: new folder `src/app/studio/_components/screens/spawn/`

`Spawn.tsx` keeps `SpawnScreen` (the orchestrator) plus LookStep, VoiceStep, TestStep and HireStep, so there is no churn there. BriefStep, Drafting and PersonaStep move to the new folder.

| File | Export and props |
|---|---|
| `BriefStep.tsx` | `BriefStep({ locale, busy, successor?: AgentView, error?: string \| null, offline: boolean, onDraft(brief: SpawnBrief): void, onRetry(): void })` |
| `BriefHeader.tsx` | `BriefHeader({ locale, hue: Hue, expr: Expression, successorName?: string })` |
| `BriefComposer.tsx` | `BriefComposer({ value, onChange, locale, examples: string[], placeholder?: string, maxLength = 600, onFocusChange(f: boolean), onSubmit(): void, footer?: ReactNode })`, forwards `ref` |
| `PackRow.tsx` | `PackRow({ locale, onPick(pack: PackId): void })` |
| `RouteCard.tsx` | `RouteCard({ locale, role: RoleDef, source: Routing['source'], predecessorName?: string, skills: SkillToggle[], extra: number, onToggleSkill(id), onMoreSkills(), onChange(), onDetach() })` |
| `CustomLine.tsx` | `CustomLine({ locale, onUndo?: () => void, onBrowse(): void })` |
| `Clarifier.tsx` | `Clarifier({ locale, clarify: NonNullable<Routing['clarify']>, pending?: string, onAnswer(id: string): void })` |
| `FineTune.tsx` | `FineTune({ locale, open, onToggle(), value: FineTuneValue, onChange(v), autoLanguages: string[] })`; `FineTuneValue = { presentation?, languages: string[], culture, age, accent, traits?: Traits /* undefined until touched */ }` |
| `RoleSheet.tsx` | `RoleSheet({ open, onClose, locale, initialPack: PackId, closest: string[], selectedId: string \| null, onPick(id: string \| null) })` |
| `SkillChips.tsx` | `SkillChips({ locale, items: SkillToggle[], onToggle(id), onAdd?(), extra?: number, readOnly?: boolean })`; `SkillToggle = { id: string; on: boolean }` |
| `SkillsSheet.tsx` | `SkillsSheet({ open, onClose, locale, roleId?: string, selected: string[], onChange(next: string[]), max = 8 })` |
| `Drafting.tsx` | `Drafting({ locale, role?: RoleDef, hue?: Hue })` |
| `PersonaStep.tsx` | `PersonaStep({ ...StepProps, names: string[], locale })` (current props + locale) |
| `RoleLine.tsx` | `RoleLine({ locale, persona: PersonaSpec, hue: Hue })` |
| `SampleExchanges.tsx` | `SampleExchanges({ locale, agent: AgentView, changed?: boolean })` |
| `RefineComposer.tsx` | `RefineComposer({ locale, busy: boolean, onSubmit(instruction: string): Promise<boolean>, onFocusChange(f: boolean) })` |
| `useRouting.ts` | `useRouting({ text, locale, enabled, exclude, answer }) → { routing: Routing \| null, status: 'idle' \| 'routing' \| 'done', routeNow(opts?): Promise<Routing \| null> }` (debounce, abort, timeout, hysteresis, local fallback) |
| `useStudioLocale.ts` | `useStudioLocale(): 'en' \| 'fa'` |
| `useOnline.ts` | `useOnline(): boolean` |
| `useChangedFields.ts` | `useChangedFields(prev?: PersonaSpec, next?: PersonaSpec): Set<string>` (clears after 1.5 s) |
| `motion.ts` | `EASE`, `DUR` (section 3.6) |
| `_lib/spawn-copy.ts` | `spawnCopy: { en, fa }` (section 3.4 plus persona strings in section 4) |
| `src/lib/studio/skills/catalog.ts`, `src/lib/studio/skills/route.ts` | shipped as `CATALOG`, `getRole`, `resolveSkills`, `catalogView()`, `routeLocally(text, opts)` and `routeBrief(text, opts)`; the proposal named them `PACKS`, `ROLES`, `SKILLS`, `localRoute`, `packToDomain` |

**Draft tap, in order.**
1. `haptic.tap()`.
2. If offline, do nothing; the button is disabled anyway.
3. If the text changed since the last route, `await routeNow()`. The CTA shows a Spinner and keeps its label, for at most 800 ms.
4. If `routing.clarify` exists, no role was picked, and the clarifier has not been asked yet: show the Clarifier and stop here.
5. Otherwise build the brief (`description`, `roleId`, `skills` that are on, `routing`, `lookHint`, `domain`, Fine-tune fields, and `traits` only if touched) and call `onDraft`.

**Library content contract (for whoever writes the five packs).**
- Lengths: role title ≤ 24 characters, summary ≤ 44, 4–6 default skills, 2–4 optional skills, skill title ≤ 18, skill summary ≤ 70, 2–3 starters of ≤ 48 characters each. Every string needs both `en` and `fa`.
- Hues should differ between neighbouring roles within a pack.
- Example per pack, used in the wireframes:
  - Lifestyle · **Running Coach** · matcha · *Plans your runs and keeps you honest.* · Training plans, Habit check-ins, Pace & recovery, Race prep
  - Tech · **Product Lead** · lilac · *Turns fuzzy ideas into clear bets.* · Prioritisation, Specs, Research synthesis, Roadmaps, Decision log
  - AI · **Eval Engineer** · sky · *Proves whether the model got better.* · Eval design, Regression tracking, Red-teaming, Labelling guides
  - Mobile · **UA Manager** · lagoon · *Buys installs that pay back.* · Paid UA, Creative testing, ROAS modelling, Geo launch plans, Budget pacing (optional: Store listing tests, Attribution/SKAN, Influencer deals)
  - Publisher · **Publishing Producer** · apricot · *Takes a game from soft launch to global.* · Soft-launch plans, KPI reviews, Milestones, Studio relations

---

## 6. What to remove or simplify in today's BriefStep

| Today | Decision |
|---|---|
| "Who should join the team?" and its long subcopy | **Replace** with "Who do you need?" and one sentence (from the design export) |
| "In a sentence" labelled textarea (rows 3, 15 px) | **Promote** to the hero composer (17/24, s1 card, rotating examples, sr-only label) |
| Presents as chips | **Move** into Fine-tune (same semantics) |
| **Knowledge domain chips (10)** | **Remove.** The role library and routing replace them; `domain` comes from the pack |
| Languages chips | **Move** into Fine-tune; Persian is auto-marked when the brief is in Persian |
| Nationality/culture and Age inputs | **Move** into Fine-tune → Background |
| Accent input and hint | **Move** into Fine-tune |
| Temperament sliders | **Move** into Fine-tune, and **send only if touched** (today 50/50/40 is always sent, which biases every draft) |
| Single "Draft with Claude" CTA | **Adaptive:** "Surprise me" when empty, "Draft with Claude" otherwise. This absorbs the export's separate "Surprise me" button |
| Error rendered at the top of SpawnScreen | **Move** inline above the dock for step 0 (one alert only) |
| `Drafting` 3-cloud carousel | **Keep for custom drafts.** Role drafts use one cloud in the role hue and honest beats |
| Successor: overline text only | **Upgrade:** predecessor's role and skills pre-applied, with successor title and placeholder |
| Persona "Ask Claude to change" card | **Replace** with the pinned refine composer; same API, plus changed-field highlighting |
| Persona "Expertise" row | **Hide** when skills exist |
| Persona "How they talk" field | **Rename** to "Speaking style"; the new "How they talk" card shows samples |
| Test step hard-coded starters | **Use** the role's starters |

**Kept, as required:** the successor flow, languages, culture/accent, presentation and the traits sliders. All of them are one tap away behind Fine-tune, or pre-applied (successor).

---

## Sources

- OpenAI GPT builder: https://help.openai.com/en/articles/8554397-gpt-builder · https://kendratech.substack.com/p/build-your-first-gpt-and-cincyai
- ChatGPT Skills (secondary): https://bleepingcomputer.com/news/artificial-intelligence/openai-is-reportedly-testing-claude-like-skills-for-chatgpt · https://theaicareerlab.com/blog/chatgpt-skills-what-they-are-how-to-enable-2026
- Claude Skills: https://support.claude.com/en/articles/12512180-using-skills-in-claude
- Google Gems: https://support.google.com/gemini/answer/15235603 · https://blog.google/products/gemini/google-gems-tips/
- Microsoft Agent Builder / Copilot Studio: https://learn.microsoft.com/en-us/training/modules/build-manage-no-code-copilot-agent-sharepoint/4-create-agent-copilot-chat-part1
- Character.AI (third-party guide): https://shapes.inc/fandom/character-ai/creation-guide
- Poe: https://creator.poe.com/docs/how-to-create-a-prompt-bot
- Lindy: https://www.lindy.ai/changelog · https://nocode.mba/articles/lindy-ai-review
- Relevance AI: https://relevance-site-git-invent-page.preview.relevanceai.com/docs/get-started/introduction.md
- Dust: https://docs.dust.tt/docs/user-documentation/agents/templates.md
- Notion Custom Agents: https://www.notion.com/help/custom-agent
- OpenAI AgentKit: https://openai.com/index/introducing-agentkit/ · https://osher.com.au/blog/openai-agentkit/
- Sintra: https://lindy.ai/blog/sintra-ai-review · https://tech.eu/2025/06/10/lithuanian-ai-startup-sintra-secures-17m-seed-empowering-smbs-with-ai-helpers/
- OpenAI Decisions API (secondary; fixed answer set with scores): https://letsdatascience.com/news/openai-opens-decisions-api-public-beta-b69a1e40 · https://vercel.com/i/what-is-openai-decisions-api
- Progressive disclosure: https://www.nngroup.com/articles/progressive-disclosure/ · https://jakobnielsenphd.substack.com/p/progressive-disclosure
- HAX guidelines (G10 scope services when in doubt): https://www.microsoft.com/en-us/research/blog/guidelines-for-human-ai-interaction-design/
- PAIR Explainability + Trust: https://pair.withgoogle.com/chapter/People%20+%20AI%20Guidebook%20-%20Explainability%20+%20Trust.pdf
- Telegram Mini Apps (design guidelines, safe areas, haptics, language_code): https://core.telegram.org/bots/webapps
