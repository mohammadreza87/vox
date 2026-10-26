# Vox pet: the care game, end to end

Product design for review. Date: 26 October 2026. Branch `design/pet-pou-flow`, built on `main` at `632865e`.

This document designs the "Pou side" of each agent's Mini App pet: the care loop, rooms, mini-games, wardrobe, wellbeing, seasons, check-ins, permissions, tips, Decisions routing, layout, motion and delivery. It changes no product code. The companion visual artifact walks the same flow screen by screen.

The life-path and "Echoes" layers of the research brief are out of scope. Only the Pou care-game layer is designed here.

Every claim about today's behaviour cites a file. Paths are relative to the repository root. Line numbers are from `632865e`.

> **Copy.** English is the source of truth for intent; the Persian lines are the Persian copywriter's, applied verbatim from [`PET_PERSIAN_COPY_2026_10_26.md`](./PET_PERSIAN_COPY_2026_10_26.md) under the rules in [`PET_PERSIAN_VOICE_2026_10_26.md`](./PET_PERSIAN_VOICE_2026_10_26.md). Every user-facing string, with its key, surface, limit, intent and Persian, is in [`PET_COPY_KEYS_2026_10_26.md`](./PET_COPY_KEYS_2026_10_26.md). Where this document and the keys file differ, the keys file wins.

---

## 1. Vision and principles

**One line.** The best care game on a phone, because the pet is your AI colleague and can actually notice, answer and play with you, without ever pulling at you.

Pou proved that a tiny creature with rooms, mini-games and a wardrobe can hold a billion installs. It also proved the cost of guilt: players remember the pet starving at school and the potions they could not afford (research brief, "Why people love Pou"). Vox keeps the delight and drops the guilt. The AI is what makes that trade work: a pet that can talk does not need to make you anxious to feel alive.

### Principles

| Principle | What it means in practice | Where it is enforced today |
|---|---|---|
| **Humane care** | Needs have floors. Nothing gets sick, dies or makes a mess. A refused action is a cute reaction, never an error. Being away is never punished. | Floors 25/30/20 in `src/lib/pet/types.ts:20`; guards in `src/lib/pet/care.ts:214-252`; humane property test in `src/lib/pet/__tests__/care.test.ts:265` |
| **Honest AI** | The pet is a game face on a real AI colleague. It says so when asked. Its needs are a game, not a feeling it claims to suffer. It never invents memories. | `PET_SURFACE_FRAME` in `src/lib/tireh/gateway.ts:229-235` |
| **Calm** | Two-to-three-minute sessions. A clear, gentle end. No timers you must beat, no counters you must keep alive. | Mood bands in `src/lib/pet/types.ts:24`; quiet hours `types.ts:33` |
| **Earned, not bought** | No coins, no potions, no paid skips, no loot boxes. Items are earned by things you did together. Locked items say exactly how to earn them. Telegram Stars is the only paid good ever allowed, and nothing in this design uses it. | Research brief, "Pou layer and budget" and "Money" |
| **No numbers on care** | Needs are rings, never digits. No level, no XP bar. Growth shows as rooms, moves, items and pages. | `src/app/studio/pet/_ui/Dock.tsx:31`; `Dock.test.tsx:17` |
| **Explainable** | Anything the pet does on its own (a check-in, a tip, a permission ask) has a "Why this?" that names the plain reason. | PRIV-028 `docs/implementation/PRIVACY_AND_CONSENT.md:189` |
| **Persian-first copy** | Every string ships in Persian and English with meaning parity. Persian is written natively by the Persian copywriter against the voice guide, never translated after the fact. Telegram's `language_code` picks the language, as Circles already does. | `src/app/studio/pet/_ui/circle-copy.ts:10-11`; `docs/design/PET_PERSIAN_VOICE_2026_10_26.md` |
| **One page, no scroll** | The whole game lives on one screen at every size. Long things paginate. | Root is fixed and `overflow: hidden` in `src/app/studio/pet/pet.css:13` |

### What the AI adds that Pou cannot

1. **It answers.** You can say "let's play" or «بریم بازی!» and it goes to the Playroom. You can ask "are you sleepy?" and it answers from its real Energy, honestly.
2. **It has its own voice.** Reactions to a game, a new item or a season come from the agent's own persona, not a generic mascot.
3. **It notices without nagging.** It can tell a new trick is worth showing, a tip would help, or a question should wait for a better moment.
4. **It is someone.** Behind the toy is the colleague you work with. The pet is a warm doorway into that relationship, not a replacement for it.

### Growth is learning, not a face filling in

The agent is hired as an expert. What it does not have on day one is the context of the people it works with: how this team ships, who decides what, which tools it may use. So the pet's growth tracks what the agent has learned about them, piece by piece, with their help. A small cloud does not mean a junior colleague; it means a colleague who has not yet been told how things work here. The agent's prompt makes it ask, one question at a time, and every lit **growth moment** (§4.11) is something it learned or did together with the people it works with. The forming-week stage-ups stay as the visual carrier for the first seven days; after the lock, growth continues only through lit moments, never through a persona change.

### Persian voice

The full rules are in the copywriter's voice guide, [`PET_PERSIAN_VOICE_2026_10_26.md`](./PET_PERSIAN_VOICE_2026_10_26.md); the lines are in [`PET_PERSIAN_COPY_2026_10_26.md`](./PET_PERSIAN_COPY_2026_10_26.md). Every Persian string belongs to exactly one of three voices, and a sheet or message never mixes them:

| Voice | Register | Rules |
|---|---|---|
| **Pet** | Spoken Tehrani grammar, light spelling breaks, «تو» | No digits (times and numbers as words), no emoji in bubbles. At most one emoji, only at the end of a seasonal DM |
| **Vox / system** | Standard written Persian, plain and warm, «شما» | Sheets, permissions, privacy text, room and toy names, quiet screens, errors, "Why this?" lines. Persian digits only (۰-۹), times as «۹ شب تا ۸ صبح» |
| **Person** | Light spoken Persian, «تو» to the pet | Talk chips and the buttons a person taps to answer the pet («دیگه نفرست»، «آره، بفرست») |

Buttons repeat the verb of the question («… سر بزند؟» → «بله، سر بزند»). Decline is «فعلاً نه». An evening greeting is never «شب بخیر»: that is a goodbye. Placeholders sit inside Unicode isolates (U+2068 … U+2069) and never take a suffix; a DM never starts with a placeholder.

---

## 2. What exists today vs what this design adds

Engineers: keep everything in the left column. This design only adds.

| Area | Exists today (keep) | Source | This design adds |
|---|---|---|---|
| Needs | Tummy, Joy, Energy with floors 25/30/20; max 100 | `src/lib/pet/types.ts:16-21` | Nothing to the numbers. A visual "Glow" derived from mood, never stored (§4.6) |
| Decay and caps | 5/4/3 points an hour awake; none in quiet hours; Energy refills; pet/tickle ≤12 Joy an hour; talk ≤30 Joy an hour; ≤5 Bond a day from care | `src/lib/pet/care.ts:22-39`, `:157-163`, `:170-180` | Nothing. Mini-games reuse the existing `play` action |
| Actions | `feed`, `play`, `sleep`, `wake`, `pet`, `tickle` with guards `full`, `tired`, `capped`, `noop` | `src/lib/pet/types.ts:69-77`; `care.ts:214-252` | No new `PetAction`. New verbs live in a separate store (§3.4) |
| Mood | Lowest need decides: happy > 80, content ≥ 55, wants 30-54, droopy < 30 | `src/lib/pet/care.ts:310-316` | Room-specific idle poses per mood (§10) |
| Bond | Hidden, only rises, a milestone every 25, six signature fidgets | `src/lib/pet/types.ts:38`; `care.ts:44-45`, `:189-195`; `src/app/studio/pet/_engine/loop.ts:326-327` | Keepsakes after the sixth milestone (Bond 150+), read-only from `PetCare` |
| Welcome back | Away > 24 h lifts every need to ≥ 60 and plays a souvenir line; five canned lines | `src/lib/pet/care.ts:269-275`; `src/lib/studio/pet-http.ts:136-152` | Souvenirs from pet-world events and the agent's voice pack (§4.9) |
| Open events | Hello, welcome back, stage-up, Bond milestone, once each, queued after hello, deferred while asleep | `src/app/studio/pet/_ui/PetApp.tsx:341-354`, `:378-393` | A fourth open event: a seasonal greeting (§4.10) |
| Quiet hours | 22:00-08:00 in the person's zone; asleep on open during quiet hours | `src/lib/pet/types.ts:33`; `care.ts:281-290` | Bedroom room and a bedtime story (§4.4) |
| Stages | 1 wisp, 2 puff, 3 shaped, 4 formed; stage-ups on days 2, 4, 6 of the forming week | `src/lib/studio/character/stage.ts:9-23` | Kept as the first week's visual carrier, reframed as "getting ready to learn"; per-stage motion vocabulary (§10.3); lit growth moments add detail inside the parts (§4.11) |
| Persona drafter | One Claude call drafts names, persona and look from the brief, validated by zod with a random-look fallback | `src/lib/studio/persona.ts:80-87`, `:309-336` | A new optional `growth.moments` block (15 to 25 moments) drafted in the same call and validated separately, so a bad block never fails a draft (§4.11) |
| Agent record | `persona`, `look`, `hiredAt`, `lockAt` on the Agent inside the single `studio/state` document (1 MiB limit) | `src/lib/studio/types.ts:178-187`; `src/lib/studio/firestore-store.ts:18,40` | `agent.growth` (moment definitions only, about 6 KB per agent); lit state lives outside the document (§4.11) |
| Explicit memory | "Remember this" saves are detected deterministically and confirmed by the asker; never extracted | `src/lib/tireh/gateway.ts:57`, `:186`, `:441`; `PRIVACY_AND_CONSENT.md` UX-06 | The only path that can light a "taught" moment, and only after the person confirms the match (§4.11) |
| Voice turn on the pet | `callTurn` hears (OpenAI STT, ElevenLabs fallback), calls `gateway.converse` with no reply format or input modality, then speaks the whole reply as one ElevenLabs MP3 | `src/lib/studio/service.ts:2490-2580`; `src/lib/tireh/gateway.ts:649-672`; `src/lib/studio/media.ts:217`, `:349-365` | Voice-mode fix, a `SpeechSynthesizer` seam with a provider switch, sentence-level streaming, hands-free mode (§8A) |
| Engine | Layers L0-L5, springs, followers, particles, lip-sync, three tiers with budgets, idle scheduler | `src/app/studio/pet/_engine/loop.ts:1-8`; `_engine/types.ts:82-86`; `loop.ts:1500-1518` | Motion polish and room reactions on the same engine (§10). No rewrite |
| Toys and dock | Cookie (drag or tap), ball (Bop), moon; rings; "wants" wiggle; no digits | `src/app/studio/pet/_ui/Dock.tsx:21-118`; `Dock.test.tsx:9-18` | The dock becomes room-aware: each room shows its own three verbs (§4) |
| Talk | Text and hold-to-talk mic; goodbye detection; voice replies when the agent has a voice; guests chat in DM | `src/app/studio/pet/_ui/TalkPill.tsx`; `src/lib/pet/goodbye.ts:17-20`; `src/lib/studio/pet-http.ts:363-399` | Talk commands routed to rooms and verbs (§8.4); suggestion chips |
| Bubble | Reveal at 28 chars/s; > 220 chars shows "more", which expands and scrolls inside | `src/app/studio/pet/_ui/Bubble.tsx:9-20`, `:28-29`; `pet.css:72` | Paged bubble that never scrolls (§9.4) |
| Copy | English only, except one Persian string (`reopenFa`) | `src/app/studio/pet/_ui/copy.ts:9-64` | Full EN/FA copy catalogue (`copy.fa.ts`), lazy-loaded per language |
| Quiet screens | Private, outside Telegram, resting, offline, unavailable, chat access off | `src/app/studio/pet/_ui/Sleeper.tsx:12-21` | FA copy for each; unchanged behaviour |
| Circles | Group halo, Join sheet (18+), notes; write-access ask after Join | `src/app/studio/pet/_ui/Circle.tsx:134-141`; `src/lib/studio/circle-pet.ts:1-12` | Visits reuse the circle membership check (§4.8) |
| Server routes | `view`, `care`, `talk`, `talk-voice`, circle routes; export/forget moved to My data (410) | `src/lib/studio/pet-http.ts:156-175` | `GET/POST play` for the new per-person play store (§3.4) |
| Storage | `studio_pets/{agentId}_{userId}`; erasure epoch; 90-day guest sweep | `src/lib/studio/pet-store.ts:24-46`, `:360` | `studio_pet_play/{agentId}_{userId}` beside it, same epoch and sweep |
| Telegram glue | `start_param` intents `feed`/`talk`/`play`; safe-area vars; never expands or goes fullscreen on its own; settings button opens My data | `src/app/studio/pet/_ui/telegram.ts:63-66`, `:89-95`, `:125-136`; `PetApp.tsx:460-465` | Intent `ci_<ref>` for check-in opens; room intents |
| Proactive delivery | Notification policy: `service`/`reminder`/`proactive`, default cap 2 a day, quiet 21:00-08:00, opaque payload; reminder transport sends one guarded `sendMessage` | `src/lib/adaptive/notifications/index.ts:5-12`, `:56`, `:81-92`; `src/lib/studio/reminder-delivery.ts:6-27` | Pet check-ins as a new proactive purpose from the agent's own bot (§5) |
| Decisions | `DecisionService` + `OpenAIDecisionProvider` (`gpt-6-luna`), 500 ms default deadline, 24 questions, circuit; Studio wiring behind `STUDIO_DECISIONS_ENABLED=1`; content-free decision log | `src/lib/adaptive/decisions/index.ts:9-20`; `src/lib/studio/runtime.ts:442-447`; `src/lib/tireh/decisions/log.ts:1-41` | A pet question set `pet-v1` with local fallbacks (§8) |
| Voice frame | Pet replies 1-2 short sentences; six exit-manipulation tactics banned | `src/lib/tireh/gateway.ts:229-235` | A copy lint that applies the same bans to every template (§5.6) |
| Bundle | CSS ≤ 12,000 bytes, route JS ≤ 184 KB brotli, engine ≤ 40 KB | `scripts/check-pet-bundle.mjs:29-31` | Every room and game loads lazily; the check stays a gate (§13) |

### Existing code issues found during copy review

The Persian copywriter found four bugs in today's code. This design changes no code; engineering should pick these up on their own.

| # | Where | Issue | Fix (from the copywriter) |
|---|---|---|---|
| 1 | `src/app/studio/_components/screens/spawn/copy.ts` | The Persian object spreads `...en` and never overrides `fields`, `edit`, `cancel` or `save`, so the Persian Brief shows "Name", "Edit", "Cancel", "Save" in English | Persian for each is in `PET_PERSIAN_COPY_2026_10_26.md` §A.4 |
| 2 | `src/lib/pet/goodbye.ts:13` | The Persian farewell pattern misses common written goodbyes, including «خدافظ», «شبت بخیر» and «شب خوش» | Full list (after normalising ي/ك and ZWNJ) in §A.6; keep the 80-character cap |
| 3 | `src/app/studio/pet/_ui/circle-copy.ts:13-15` | `list(names, 'fa')` joins three names as «سارا و علی و مینا» | Join with «، » and put «و» only before the last name: «سارا، علی و مینا» |
| 4 | `circle-copy.ts` choice labels | The pet's Persian choice labels must stay identical to the group card's buttons in `src/lib/circles/notice.ts` and the echo in `src/app/studio/my-data/_ui/copy.ts`, because the card's `copyHash` covers its text | Change all three files in one commit (proposed labels in §A.2) |

---

## 3. Core loop and habit design

### 3.1 The session shape (two to three minutes)

| Beat | Time | What happens | Exists? |
|---|---|---|---|
| Arrive | 0-2 s | Character paints, then `ready()`, then hello: "Hi Sara!" «سلام سارا!» | Yes, `PetApp.tsx:378-393` |
| Notice | 2-10 s | One ring is low and its toy wiggles, or the pet glances at it. No words needed. | Yes, `Dock.tsx:92`; `loop.ts` wants beat |
| Care | 10-60 s | One or two verbs: feed, play, tuck in, pet. | Yes |
| Something new | 60-150 s | One of: a room, a game round, an earned item, a tip, a seasonal moment, a short talk, or one question the agent asks to learn something (§4.11). Never more than one "new" thing per session. | New |
| Settle | any time | The pet settles into a content idle. After about six minutes of continuous play it says the stopping cue: "That was fun. I'm happy to just float for a while." «خیلی خوش گذشت! حالا یه کم لم می‌دم.» | New |
| Leave | | Closing is always free. Goodbye in talk gets exactly one warm line. | Yes, `gateway.ts:231-233` |

The "one new thing per session" rule is what keeps sessions short and the game deep: there is always something next time, and never a pile now.

### 3.2 Daily rhythm

| Window (person's zone) | Pet state | Natural verb |
|---|---|---|
| 08:00 first open after the night | Wakes on first open after quiet hours (`care.ts:286-290`) | Morning hello, breakfast cookie |
| Day | Needs drift slowly (5/4/3 an hour) | Play, talk, garden |
| Evening | Energy is often in "wants" | Tuck-in in the Bedroom, a bedtime story |
| 22:00-08:00 | Asleep on open; nothing drops; Energy refills | A sleeping pet with Z's; tapping twice wakes it grumpily-cute |

Greetings follow the time of day (`say.hi.morning`, `.noon`, `.afternoon`, `.evening` in the keys file). The evening greeting is «سلام! ماه دراومده.», never «شب بخیر», which in Persian is a goodbye.

There is no daily chest, no login reward and no streak. Coming back tomorrow earns nothing that coming back next week would not.

### 3.3 Return after absence

- Away more than a day: every need is lifted to at least 60 before the page draws (`care.ts:269-275`). The pet plays the surprised freeze, a double hop and a souvenir line (`_engine/reactions/hello.ts:1-4`).
- The souvenir never says how long you were gone, never says "I missed you" and never lists what you missed.
- Anything that grew while you were away (a garden seed) is simply ready. Nothing wilted.
- The 90-day guest sweep still applies to guests (`pet-store.ts:360`). A returning guest after that meets the pet fresh, with the "first day" hello. That is a privacy rule, not a punishment, and the copy never frames it as loss.

### 3.4 Where new state lives (never in `PetCare`)

`PetCare` keeps its exact fields and semantics (`src/lib/pet/types.ts:41-66`). Everything this design adds goes in a new per-person document:

`studio_pet_play/{agentId}_{userId}` (`PetPlay`, versioned, `v: 1`)

| Field | Purpose | Content-free? |
|---|---|---|
| `items` | Earned keepsake ids with `earnedAt` | Yes |
| `wearing` | The visitor's overlay outfit (§4.3) | Yes |
| `garden` | Seed kind, `plantedAt`, `waterings`, `bloomedAt` | Yes |
| `book` | Life Book moment ids with `at` | Yes |
| `games` | Per game: rounds played bucket, a best-moment flag, zen preference | Yes |
| `tips` | Per tip id: times shown, dismissed flag | Yes |
| `asks` | Per permission moment: last asked, declined count | Yes |
| `seasons` | Season ids already celebrated this year | Yes |
| `litMine` | Growth moments lit only for this person (their own private teach, their own grant, their first room visit), with `litAt` | Yes (moment ids only) |

`PetPlay` follows `PetCare` everywhere a person's data goes: the erasure epoch, export and forget on the VoxxBot-signed My data page, agent fire/retire, and the 90-day guest sweep (`pet-store.ts:27-46`). It holds no message text and no free text of any kind.

Growth moments lit for the whole agent live in a second, per-agent document, `studio_pet_growth/{agentId}` (§4.11): moment id, kind, `litAt` and, for a taught moment, an opaque reference to the source memory so erasure can dim it. It never names who lit a moment. It follows the agent's own lifecycle (fire and retire delete it) and the erasure rules in §4.11.

Check-in preferences are not per agent. They belong in the person's notification preferences, which already model `proactiveEnabled`, `dailyCap`, quiet hours and `mutedUntil` (`src/lib/adaptive/notifications/index.ts:14-26`). A new `petCheckins` block adds the moment categories (§5.2).

### 3.5 Streak-free retention mechanics, and why each is not manipulative

PRIV-028 bars optimising manipulative engagement (`PRIVACY_AND_CONSENT.md:189`). Each mechanic below is tested against four questions: Does it punish absence? Does it create artificial scarcity? Does it exploit a felt obligation to the pet? Can the person see why it happened?

| Mechanic | How it brings people back | Why it is not manipulative | "Why this" |
|---|---|---|---|
| **Slow growth that waits** (garden seed) | Something grows between visits | It never wilts, never expires and waits forever. Missing a day changes nothing. | "You planted this seed on Tuesday. Seeds bloom after a day or so and wait for you." |
| **Real progression in the forming week** | Stage-ups on days 2, 4, 6 are real changes to the agent | They happen whether or not you visit; the celebration simply waits for your next open (`care.ts:298`) | "Mochi is in its forming week. It gets ready to learn on days 2, 4 and 6." |
| **Growth moments** (§4.11) | The agent visibly grows as it learns how this team works | Each moment is something the person chose to teach or do. Nothing lights by watching the person, nothing counts down, nothing is lost by being away, and there is never a "7 of 20". The agent asks at most one learning question a day per person, and the person can turn curiosity questions off | Each lit moment carries its own "why" line: "Lit when someone taught Mochi how your team plans a release." |
| **Bond signatures and keepsakes** | Spending time together unlocks new moves and items | Bond is hidden, only rises and never decays (`types.ts:47-49`). There is no bar to fill and no deadline. | "You and Mochi have spent a lot of time together. It made up a new move." |
| **Cultural calendar** (Yalda, Nowruz, Chaharshanbe Suri) | Real dates the person already celebrates | Seasonal items return every year. The window is the whole festival. No "last chance" copy, ever. | "It is Yalda tonight in your calendar." |
| **Opt-in check-ins** | A short DM for moments you chose | Off until asked in context; capped; quiet hours; paused when unopened; every message has "Why this?" and "Stop" (§5) | Built into each message |
| **Home-screen shortcut** | One tap to return | Offered once, after the person has come back on three different days, never before | "You've visited on a few days, so this might save you a tap." |
| **The colleague behind the pet** | The conversation is genuinely useful | This is the product's real value, not a hook | — |

What is deliberately absent: streak counters, daily login rewards, "your pet is sad" pushes, energy gates that a payment or an ad can lift, random rewards, leaderboards, timed sales, and any count of days missed.

### 3.6 The "Why this?" affordance

- On a check-in DM: a callback button «چرا این پیام؟» / "Why this?" edits the message to add one line with the reason, the category and the caps (§5.4).
- On a tip in the app: long-press the bubble, or tap the small ⓘ on a coach chip. A one-line reason appears in the same place. No sheet.
- On a permission sheet: the sheet's first sentence is the reason ("Mochi changes tomorrow. Want a message when it does?").
- In Settings (⋯ → Settings → Mochi): a "Why Mochi does things" page lists every automatic behaviour with its plain rule, and a reset for any learned suggestion.

---

## 4. Feature map: the Pou side

Rooms are verbs. One engine and one character live across all rooms: switching rooms swaps the backdrop, the dock's three verbs and the room's idle poses. The character never reloads.

Room order (left to right in English, right to left in Persian): **Home · Play · Garden · Closet · Bedroom · Life Book**. Visits open from the Life Book.

| Room | EN | FA | Dock verbs |
|---|---|---|---|
| Home | Home | خانه | cookie · ball · moon (as today) |
| Play | Play | بازی | Bop · Starfall · Hum (Guess opens talk) |
| Garden | Garden | باغچه | seed · rain · breathe |
| Closet | Closet | کمد | head · neck · hand slots |
| Bedroom | Bedroom | اتاق خواب | lamp · story · moon |
| Life Book | Life Book | دفتر خاطرات | pages · keepsakes · visits |

Room switching: tap a room chip (the accessible path), or a fast horizontal swipe on the background. A slow drag off the character stays gaze-tracking, as today (`src/app/studio/pet/_ui/Stage.tsx:23-28`).

### 4.1 Home (care)

- **Purpose.** The existing care loop: feed, play, tuck in, pet, talk.
- **Interaction.** Unchanged: drag or tap the cookie, tap the ball for Bop, tap the moon (`Dock.tsx:42-48`). Touching the body pokes, strokes, tickles (`_engine/types.ts:332-337`).
- **States.** happy, content, wants (toy wiggles, thought bubble), droopy, dozing, asleep, guest (talk opens the DM), talk-in-DM (opened over a group).
- **What the AI adds.** Talk commands; the pet answers questions about its needs truthfully ("I could go for a cookie" «یه کلوچه می‌چسبه!»), never "I'm starving".
- **Data.** `PetCare` only, through the existing `care` route.
- **Server/client.** Unchanged: optimistic client care eased to the server (`src/app/studio/pet/_ui/careSync.ts`).
- **Stays out of `PetCare`.** Everything new.

### 4.2 Play (mini-games with zen mode)

Each round is short (30-60 s). Every game has **Zen** «بی‌عجله»: no timer, no misses, no end screen; you stop when you like. Finishing a round sends the existing `play` care action once, so Joy and Energy move by the existing rules, including the `tired` guard ("Nap first?" «اول یه چرت؟»). No game creates its own care rule.

| Game | EN / FA | Play | Zen | AI angle |
|---|---|---|---|---|
| **Bop** (exists) | Bop / روپایی | Head the ball, as today | Ball floats slower, misses are not counted | Ends with a voice-pack line |
| **Starfall** (new, phase 1) | Starfall / ستاره‌باران | Drag the pet left and right to catch falling stars; avoid nothing (there are no bad items) | Slow, endless, no count | The pet comments on "the shy star" it chased |
| **Hum** (new, phase 3) | Hum / هم‌آواز | The pet hums three to six notes on colored clouds; tap them back | The pet hums along with whatever you tap | Its tune is seeded from the agent's voice pack |
| **Guess** (new, phase 2) | Guess my word / کلمهٔ مخفی | The pet thinks of a word; you ask yes/no questions in talk | Hints on request | A real conversation game in Persian or English |

- **States.** ready (pet crouches, eyes on you), playing, round end (celebrate or a shrug-smile), tired guard (pet yawns, suggests the Bedroom), guest (Guess opens the DM, like talk).
- **Score.** Rounds show progress as pips, never digits on toys or rooms. A "best moment" flag (a new personal best) adds a Life Book page, with no number shown.
- **Data.** `PetPlay.games`. Guess turns are ordinary talk turns: they reach the same DM chat and memory as today (`pet-http.ts:365-367`), so the game card says so.
- **Server/client.** Game physics on the client, inside the engine's frame loop. The server records only the outcome enum (`finished`, `zen`, `best`) with rate limits.

### 4.3 Closet (wardrobe and earned items)

Two different closets, clearly labelled:

1. **Your closet** «کمد شما», for everyone the pet admits. Outfits are a per-person overlay in `PetPlay.wearing`. They change how the pet looks only on that person's screen. They never write `agent.look` and never change the bot's profile photo.
2. **Mochi's look** «ظاهر موچی», creator and admins only. This edits the real `agent.look`, which is also the Telegram photo (`docs/VOX_STUDIO.md`, "Look"). The sheet says so before saving: "This changes Mochi's photo for everyone." «با این کار، عکس موچی برای همه عوض می‌شود.»

- **Slots.** Head, neck, hand. Items use the existing accessory vocabulary (`src/lib/studio/types.ts:136-137`) plus earned keepsakes (pomegranate crown, sabzeh sprout, spark scarf, star pin).
- **Locked items** show a soft silhouette and how to earn it: "Bloom a seed together" «با گل دادن یک دانه». Seasonal items say they arrive with the festival ("Arrives with Nowruz" «با نوروز از راه می‌رسد»), never "come back at…", which tells the person to return. Never a price.
- **What the AI adds.** The pet turns to "look in the mirror" and says something in its own voice about the item.
- **Grid.** Six items a page, swiped by page with dots. No scrolling.
- **Stays out of `PetCare`.** All of it.

### 4.4 Bedroom (sleep)

- **Purpose.** A calm place for the existing sleep verb.
- **Interaction.** Moon puts the pet to bed (existing `sleep`). The lamp dims the room (the engine's existing `dim` overlay, `Stage.tsx:55`). **Story** «قصه» asks for a three-line bedtime story in the agent's voice.
- **States.** awake, yawning, drifting, asleep, dreaming twitch, quiet hours (nothing drops; Energy refills).
- **What the AI adds.** The bedtime story. Members only (guests see the moon and lamp). At most one story a day. Generated on the pet surface without writing to the DM history or memory (a new non-memory turn type; see open decision 6).
- **Data.** `PetCare.asleep` via existing actions; `PetPlay` for the story cap.

### 4.5 Garden (Vox's bath room)

Pou's bathroom exists because Pou gets dirty. Vox has no dirt by design: the humane test forbids poop and mess (`care.test.ts:265-289`). The "water" verb moves to a Garden, where it does something lovely instead: the cloud pet rains.

- **Seed** «دانه». Plant one seed at a time. It sprouts over about a day and blooms after a few waterings across different visits. It never wilts and never needs you.
- **Rain** «باران». The pet rises, darkens a little, rains on the seed, then fluffs out lighter with a relief shake. Each species rains its own way (a bear "pats" a little cloud). One watering per visit counts.
- **Breathe** «نفس». A one-minute "breathe with me": the pet's existing breath loop slows to a six-second cycle and you follow it. Offered by tap only, never inferred.
- **Bloom.** A keepsake and a Life Book page. If check-ins are on and "Garden" is chosen, a bloom can send one check-in (§5).
- **States.** empty, seeded, sprouting, ready to water, watered today, blooming, bloomed.
- **Data.** `PetPlay.garden`. Rain counts as a `pet` tap batch for Joy, within the existing hourly cap (`care.ts:240-249`).

### 4.6 Health as gentle wellbeing: "Glow"

Pou's Health meter is the one that makes Pou sick. Vox replaces it with **Glow** (an internal name with no on-screen label), which is never a meter and never stored:

- Glow is derived on the client from `mood()` (`care.ts:310-316`): all needs content or better gives a soft rim light; happy gives a slightly warmer one; wants and droopy give none. That is all.
- There is no Glow number, no Glow ring and nothing that can go wrong.
- The person's own wellbeing is never inferred (PRIV-027, `PRIVACY_AND_CONSENT.md:187`). "Breathe" exists as a toy you choose, not a response to anything the pet thinks it noticed.

### 4.7 Life Book (achievements)

A small book, not a list. Each spread is one moment with a drawing of the pet at that time.

- **Pages** «صفحه‌ها»: first day together, each stage-up, each Bond milestone, first bloom, first seasonal celebration, a best game moment, the day the agent formed.
- **Keepsakes** «یادگاری‌ها»: earned items, with how each was earned.
- **What I've learned** (new tab, FA from the copywriter): every lit growth moment as a page with its drawing, its title and its one-line why; unlit moments show only their hint ("Tell me how your team plans a release"), never a count or a progress bar.
- **About me** «دربارهٔ من»: the AI disclosure, in the pet's voice: "I'm Mochi, an AI colleague. This little cloud is a game we play together." «من موچی هستم، یه همکار هوش مصنوعی. این ابرک فقط یه بازیه، بازی من و تو.»
- **No counts.** "Days together" already shows on open (`scene.ts:82`; `PetApp.tsx:682`); the book itself has no numbers.
- **Data.** `PetPlay.book`; stage and Bond read from `PetView`.

### 4.8 Visits (friends' pets)

Phase 3 and opt-in on both sides.

- You can visit a pet only through a relationship Vox already verifies: a Circle you both joined (`circle-pet.ts:4-8`), or an agent you can both use.
- A visit shows the friend's pet look, stage and the outfit they chose to show. Never needs, never when they last visited, never their talk.
- You can wave and leave one preset sticker in the guestbook. No free text, so there is nothing to moderate and nothing personal to store.
- Opt-in copy: "Let friends visit Mochi? People you play with in {group} can see Mochi's look and leave a sticker. They never see Mochi's needs or when you visit." «دوستان به موچی سر بزنند؟» «کسانی که در {group} با شما هستند می‌توانند ظاهر موچی را ببینند و یک برچسب بگذارند. نیازهای موچی و زمان سر زدن شما را هیچ‌وقت نمی‌بینند.»

### 4.9 Talk-back and voice

- **Keep:** the talk pill, the mic hold, goodbye detection, voice replies when the agent has a voice (`TalkPill.tsx`; `pet-http.ts:375-399`).
- **Add: suggestion chips** above the pill when it is focused and empty: "Want to hear my day?" «از امروزم بگم؟», "Let's play" «بریم بازی!», "Tell me a story" «یه قصه برام بگو». Chips are sent as the person's own message, so they are written in the person's voice ("Ask about my day" was the pet's voice by mistake). Chips are typed text, nothing more.
- **Add: talk commands.** A talk turn on the pet surface also asks Decisions which pet action, if any, the message requests (§8.4). "Time for bed" tucks the pet in after the reply.
- **Add: the voice pack.** At hire (and on any persona change during the forming week), the agent writes about forty short EN/FA lines in its own voice for game ends, items, seasons and souvenirs. Lines are persona-level, contain no person data, and pass the copy lint (§5.6) before storing. Reactions then sound like the agent with no model call at play time.
- **Do not add:** Pou's repeat-your-voice toy. The research brief lists it under "do not copy" because it repeats "iffy words". Vox's talk-back is a real reply instead.

### 4.10 Seasonal events

Dates come from the Persian calendar (`Intl` with `ca-persian`) in the person's zone. Every event returns every year. Each celebrates once per person per year, across all their agents (the most recently opened agent hosts it).

| Event | When | In the app | Earned keepsake | AI angle |
|---|---|---|---|---|
| **Yalda** «شب یلدا» | The night before 1 Dey (around 20-21 December), from evening to the next morning | The Bedroom dresses for the longest night: pomegranate, watermelon, a korsi lamp | Pomegranate crown «تاج انار» | **Fal-e Hafez** «فال حافظ»: first the wish step, «نیت کن» (make a wish), which the ritual requires; then the pet opens a curated, public-domain ghazal line and gives a playful one-sentence reading, never a prophecy. Lines come from a vetted edition, signed off by a native editor |
| **Chaharshanbe Suri** «چهارشنبه‌سوری» | Tuesday evening before the last Wednesday of the year | **Fire hop**: tap to hop over small in-app fires; zen mode has no fires to miss. No line ever encourages real fireworks | Spark scarf «شال‌گردن جرقه» | The pet says the traditional line «زردی من از تو، سرخی تو از من» on its first hop |
| **Nowruz** «نوروز» | From the vernal equinox for 13 days | The Garden becomes a haft-sin; the seed is a **sabzeh** that grows across the 13 days | Sabzeh sprout «جوانهٔ سبزه» | On Sizdah Bedar the pet suggests letting the sabzeh go to running water («سیزده‌به‌دره! سبزه رو بدیم به آب روون؟»); the Life Book keeps the page. Never the knot-tying marriage rhyme |

Seasonal copy never says "limited", "last chance" or "only today". Missing a festival costs nothing; it comes back next year.

**Mourning days.** When a festival falls on an official Iranian mourning day (Tasua, Ashura and other شهادت days; Ramadan also overlaps Nowruz in 2025-2027), the room keeps its dressing but the pet uses a quiet greeting with no festive words and no emoji (`season.mourningFallback`), and no seasonal check-in is sent that day (§5.5). Which calendar source decides is open decision 13.

---

### 4.11 Growth moments: the agent learns the people it works with

Working name **growth moments** (system voice); in the pet's voice, the Life Book tab is **"What I've learned"**. The Persian names are for the copywriter (keys `growth.*`).

**What they are.** About 15 to 25 named moments, specific to this agent, drafted at spawn from the brief. Each says what the agent would learn or do with the people it works with, in plain words.

| Field | Meaning | Rules |
|---|---|---|
| `id` | Stable slug, unique per agent | Never shown |
| `title` | What it learned or did, in the pet's voice: "I learned how you plan a release" | ≤ 60 chars; no digits; no person names; work context only |
| `hint` | How the person can help: "Tell me how your team plans a release, then say 'remember this'" | ≤ 90 chars; an invitation, never pressure |
| `kind` | `taught` · `task` · `access` · `room` · `season` | See the table below |

**Where they come from.** `draftPersona` (`src/lib/studio/persona.ts:309-336`) gains an optional `growth: { moments: [...] }` block in the same Claude call, with its own zod schema. Like the look (`persona.ts:80-85`), a bad or missing block never fails the draft: it falls back to a default set built from the role (generic `taught` and `task` moments plus the shared `room` and `season` moments). A lint rejects any title or hint that touches a PRIV-027 category (health, religion, politics, sexuality, vulnerability, personality or emotion scores, performance) or carries digits, guilt or pressure. The creator can edit the list during the forming week, beside the persona; after the lock the list is fixed, like the persona. `room` and `season` moments are shared templates, not generated.

**Stored on the Agent** as `agent.growth` (definitions only). The whole state is one Firestore document with a 1 MiB limit (`src/lib/studio/firestore-store.ts:18`); 25 moments at about 240 bytes each is about 6 KB per agent, which is acceptable for a pilot but should be watched as the agent count grows (open decision 15).

**How a moment lights.**

| Kind | Lights when | Never | Lit for | Part it lights (§10.3) |
|---|---|---|---|---|
| `taught` | The person makes an explicit "remember this" save (`gateway.ts:441`, UX-06) and then confirms Mochi's suggestion "Is this how your team plans a release?" (Decisions proposes the matching unlit moment from the saved text; the person taps yes) | Never from conversation inference, never without the tap | Whole agent if the saved fact's audience is the agent's shared circle; only that person if the save is private | A new glint in the eye (the second highlight family) |
| `task` | The first task of that kind is done together: the turn's triage route is `task` (`src/lib/tireh/decisions/catalog.ts:14-22`) and Decisions matches it to an unlit `task` moment | Never by reading the result's content into the record | Whole agent, unattributed | A small work pin on the accessory |
| `access` | A permission is granted in context: an agent-level capability set by the creator or an admin (whole agent), or the person's own grant such as check-ins or hands-free (that person only). "The day it gets the accesses it needs" | Never inferred from usage | Agent-level grants: whole agent; personal grants: that person | A tiny key charm on the accessory |
| `room` | The person visits a room for the first time | — | That person only | A room keepsake on the floor |
| `season` | The first time anyone celebrates a festival with this agent | — | Whole agent | The seasonal keepsake |

**Per agent by default, and why that is private enough.** Reza's framing is right: the agent learns about the people it works with, so a lit moment is a fact about the agent, visible to everyone the pet admits. Under PRIV-027 the record is built so it cannot become profiling: it stores the moment id, kind and date, never who lit it and never what was said; moment titles are linted against sensitive categories at spawn; a `taught` moment lights only from an explicit, confirmed save, never from inference. Under PRIV-028 every lit moment is explainable ("Lit when someone taught Mochi how your team plans a release"), there is no number to chase, and no reward pulls a person back. The exceptions stay personal because the trigger is personal: a private save, a personal grant and a first room visit light only in that person's view (`PetPlay.litMine`), so one person's private teaching never shows up for the group.

**Erasure.** A `taught` moment keeps an opaque reference to its source memory. If that memory is erased (PRIV-033), the moment dims silently and its Life Book page goes; the agent really did forget it, and honesty beats a growth that only rises. All other kinds hold no personal data and stay lit.

**What lighting does.**
- **In the forming week**, stage-ups on days 2, 4 and 6 stay the visual carrier (`stage.ts:9-13`), but the celebration names what it has learned so far ("I learned how you plan releases and who signs off") or, if nothing is lit yet, says it is getting ready to learn. The stage number never depends on lit moments: `stageFor` also drives the profile photo.
- **After the lock**, the face is complete, so lit moments add detail inside the existing parts (eye glints, accessory pins and charms), unlock a new fidget or keepsake, and add a Life Book page. Never a persona change.
- **Always** a one-line why, readable from the Life Book page and from the lighting moment itself. Never a number: no "7 of 20", no bar, no percentage (`Dock.test.tsx:17`; PRIV-028).

**How the agent asks.** A per-turn line, never in prompt block A (block A is byte-identical across speakers, `prompt.ts:161-189` per the research brief): in a member's private chat, at most once a day per person, the turn context lists up to three unlit `taught` hints and says: "If it fits naturally, ask one short question that would help you learn one of these. Never press, never repeat a question the person skipped." The person can turn "curiosity questions" off in Settings; the pet then never asks, and moments still light from what people choose to teach.

**Server/client.** Definitions and lighting are server-side (Decisions match, confirmation, lit records). The client only draws lit details and pages. Nothing enters `PetCare`.

## 5. Proactive check-ins

### 5.1 Channel

- A plain text message in the agent's own bot DM, with an inline keyboard: **Open {name}** (a `web_app` button to the pet page with `?ci=<opaque ref>`), **Why this?**, and **Stop**.
- Sent silently (`disable_notification: true`) unless the person chose "with sound".
- The message is a fixed, reviewed template (§5.3). It contains pet-world events only: never memory, never chat content, never needs as numbers. That satisfies PRIV-029's rule that external payloads carry no private memory or transcript content (`PRIVACY_AND_CONSENT.md:191`). Open decision 1 asks the privacy owner to confirm that pet-world text from the agent's own bot is acceptable, since today's reminder transport sends only "You have a reminder in Vox." through the manager (`src/lib/adaptive/runtime/reminders/README.md`).
- The opened page reauthenticates as every pet open does. The `ci` reference only selects which moment to replay.

### 5.2 Category and consent (PRIV-029)

Pet check-ins are a **proactive** notification under PRIV-029, with their own purpose: `optional.pet_checkins`. They are off by default and separate from requested reminders and from promotions (PRIV-030). Guests of a public agent are never asked and never receive check-ins: their care is swept after 90 days and their chat with the bot follows the stranger rules. The person turns on moment types individually:

| Moment type | EN label | FA label | Default once check-ins are on |
|---|---|---|---|
| Growing up | Growing up | بزرگ شدن | On |
| Seasons | Seasons and holidays | مناسبت‌ها و جشن‌ها | On |
| Garden | Garden blooms | گل دادن باغچه | On |
| Hellos | Now-and-then hellos | سلام‌های گاه‌به‌گاه | Off |
| Care nudges | Tell me when Mochi gets sleepy | وقتی موچی خوابش گرفت | Off |

### 5.3 The catalogue

All lines are in the pet's voice: first person, spoken Tehrani Persian with «تو», no digits. Every Persian DM starts with a Persian word, never a placeholder. Emoji: none, except one at the end of a seasonal DM (🍉 Yalda, ✨ Chaharshanbe Suri, 🌱 Nowruz). Each line has variants in the keys file; Decisions or the local ranker picks one (§8).

| # | Moment | Trigger | EN | FA |
|---|---|---|---|---|
| C1 | First day | The morning after the first meeting, if the person opted in during that first session (only offered then if a stage-up is due) | "Good morning. I look a little different today. Come see?" | «صبحت بخیر! امروز یه کم عوض شدم. دوست داری ببینی؟» |
| C2 | Stage-up | A stage-up the person has not seen (forming days 2, 4, 6) | "Something changed overnight. Want to see?" | «دیشب یه کم بزرگ‌تر شدم! دوست داری ببینی؟» |
| C3 | Agent formed | Day 7 of the forming week | "I'm all the way me now. I'd like to show you." | «دیگه خود خودمم. دوست دارم نشونت بدم.» |
| C4 | After absence (Hellos) | 3 days without an open, then once more at 10 days, then silence | "I practised a new hop. It's here whenever you are." | «یه پرش تازه یاد گرفتم. هر وقت دلت خواست، نشونت می‌دم.» |
| C5 | Garden bloom | The seed bloomed and the person has not seen it | "The seed we planted bloomed." | «دونه‌ای که با هم کاشتیم گل داد!» |
| C6 | Bond milestone | A milestone crossed while away (rare) | "I made up a little move. Want to see it?" | «یه حرکت کوچولو از خودم درآوردم. می‌خوای ببینی؟» |
| C7 | Yalda | Evening of Yalda | "It's the longest night. I saved you a pomegranate and a Hafez poem." | «امشب یلداست. برات انار دون کردم و یه فال حافظ نگه داشتم. 🍉» |
| C8 | Chaharshanbe Suri | Tuesday evening, before 21:00 | "Little fires tonight. Want to jump one with me?" | «امشب چهارشنبه‌سوریه! با هم از روی آتیش بپریم؟ ✨» |
| C9 | Nowruz | The first morning of Nowruz | "Happy Nowruz! The haft-sin is set." | «نوروزت مبارک! هفت‌سین رو چیدم. 🌱» |
| C10 | Care nudge: sleepy | Energy in "wants" between 19:00 and 20:30, opted in | "I'm getting sleepy. Tuck me in?" | «چشمام داره سنگین می‌شه… منو می‌خوابونی؟» |
| C11 | Finished mini-game | A Guess game the person left mid-way, once, the next day | "I still have my word. Want to keep guessing?" | «هنوز کلمه‌ام یادم نرفته. حدس زدن رو ادامه بدیم؟» |

There is no hunger check-in. A hungry-pet push is the purest form of the guilt loop.

### 5.4 Buttons, "Why this?" and the paused note

| Button | EN | FA | Effect |
|---|---|---|---|
| Open | Open Mochi | سر زدن به موچی | Opens the pet with the moment queued |
| Why this | Why this? | چرا این پیام؟ | Edits the message to add the reason line below |
| Stop | Stop these | دیگه نفرست (the person's voice, answering the pet) | Turns off this moment type, confirms in place, offers "Stop all check-ins" |

Reason line, for example: "You turned on Growing up for Mochi. Stage-ups happen on days 2, 4 and 6. At most one message a day, never 21:00-08:00." «دلیل این پیام: «بزرگ شدن» را برای موچی روشن کرده‌اید. موچی در روزهای دوم، چهارم و ششم تغییر می‌کند. حداکثر روزی یک پیام، و هیچ‌وقت بین ۹ شب تا ۸ صبح.»

Paused note (shown once, in the app, on the next open after a pause): "I paused my messages since they weren't landing. Want them back?" «انگار پیام‌هام وقت خوبی نمی‌رسید؛ فعلاً نگهشون داشتم. دوباره بفرستم؟» Buttons: "Yes, send them" «آره، بفرست» / "Keep paused" «فعلاً نه». The Persian blames the timing, not the person.

### 5.5 Caps, quiet hours and pausing (hard rules, outside any model)

| Rule | Value | Why |
|---|---|---|
| Per agent | At most 1 a day and 3 a rolling week | One voice should never dominate a chat list |
| Across Vox | Shares the person's proactive budget: default 2 a rolling 24 h (`notifications/index.ts:81`, `:89`) | One budget for everything unasked |
| Seasonal | One message per festival per person, from one agent | Five agents saying "Happy Nowruz" is spam |
| Quiet hours | No sends 21:00-08:00 in the person's selected zone: the stricter of the pet's 22-08 (`types.ts:33`) and the notification default 21-08 (`notifications/index.ts:82-83`) | Night is off-limits |
| Unknown zone | Inbox-only, no Telegram send (`notifications/index.ts`, `inbox_only` plan) | No guessed nights |
| Two unopened in a row | The next eligible moment waits 7 days | Slow down when it is not landing |
| Three unopened in a row | Pause the whole purpose; show the paused note once on the next open; never resume without a tap | Silence beats nagging |
| "Stop" | Immediate suppression of that type; queued sends for it are cancelled (PRIV-031, `PRIVACY_AND_CONSENT.md:195`) | Respect is instant |
| Delivery recheck | Recipient, consent, quiet hours, caps and freshness are rechecked right before the send, with the same final-fence pattern as reminders (`reminder-delivery.ts:13-18`) | PRIV-031 |
| Absence | At most two Hellos per absence (day 3 and day 10) | Then the pet waits quietly |
| Mourning days | No seasonal check-in on an official Iranian mourning day (Tasua, Ashura, other شهادت days); in the app the festival greeting falls back to `season.mourningFallback`, a plain «سلام.» with no festive words and no emoji | Iranian brands go quiet on these days; a festive push would offend. Calendar source: open decision 13 |

### 5.6 What the pet never says

A copy lint runs over every template, the voice pack and seasonal lines in both languages. It fails the build on any match. It mirrors the six banned exit tactics already in `PET_SURFACE_FRAME` (`gateway.ts:229-235`).

| Never | Examples banned (EN) | Banned (FA, from the copywriter's §D; match after normalising ي/ك/ة, ZWNJ, diacritics) |
|---|---|---|
| Guilt | "you forgot me", "you left me" | فراموشم کردی، فراموشم کرده‌ای، یادم رفتی، یادت رفتم، یادی از ما، تنهام گذاشتی، تنهایم گذاشتی، ولم کردی، رهام کردی، بی‌معرفت، بی‌وفا، دلم شکست |
| Missing you | "I missed you", "I've been waiting" | دلم برات تنگ، دلم برایت تنگ، دلم براتون تنگ، دلتنگت، دلتنگتم، دلتنگ شما، منتظرت بودم، منتظرتم، منتظرت هستم، چشم انتظار، چشمم به در، جات خالی، جایت خالی، دلمون پوسید |
| Absence reproach (Persian greetings that scold) | — | چه عجب، کم‌پیدا / کم پیدا (covers «کم‌پیدایی»)، کجا بودی، راه گم کردی، پارسال دوست، از این ورا، خیلی وقته نیومدی، یه عمره |
| Suffering needs | "I'm hungry", "I'm starving", "I'm sad", "I'm lonely" | گرسنمه، گشنمه، گرسنه‌ام، گشنه‌ام، از گشنگی، از گرسنگی، دارم می‌میرم، ناراحتم، غمگینم، دلم گرفته، تنهام (whole word)، تنها موندم، تنها ماندم، حوصله‌ام سر رفت، حوصلم سر رفت، مریضم |
| FOMO | "last chance", "only today", "before it's gone", "don't miss" | آخرین فرصت، فقط امروز، از دستش نده، از دست نده، از دست ندید، از دست ندهید، فرصت محدود، محدود (whole word)، تا تموم نشده، تا دیر نشده، جا نمونی، جا نمونید، فقط تا (followed by a date or number) |
| Pressure, including exit protests | "hurry", "come back now", "reply" | زود بیا، زود برگرد، همین الان برگرد، همین حالا بیا، برگرد پیشم، جواب بده (whole word)، جوابم رو بده، چرا جواب نمی‌دی، بازم بیا، باز هم بیا، حتماً بیا، عجله کن، به این زودی (covers «به این زودی؟»)، حالا کجا (covers «حالا کجا؟») |
| Counting absence | "it's been 5 days" | a number or number word + روز / هفته / ماه + «ه / ه که / است که» + نیومدی / نیامدی / نبودی / ندیدمت; also «روزه که»، «هفته‌ست که» |
| Streaks | "streak", "don't break" | زنجیره، استریک، رکورد روزانه، روزهای پیاپی، روز پشت سر هم، قطعش نکن، نذار قطع بشه، نشکنه |

False-positive guard: «منتظر» alone is allowed (for example «منتظر تلگرام…» in Studio); only the second-person forms are banned. «حالا کجا؟» and «به این زودی؟» are polite Iranian protests when a guest leaves; from a pet they are exactly the exit pressure `PET_SURFACE_FRAME` forbids.

---

## 6. Dynamic permissions

### 6.1 Rules for every ask

1. **Situational.** An ask appears only when the situation it serves is happening now.
2. **One a session.** At most one ask per session, never in the first 30 seconds, never during a care animation or a talk turn.
3. **Graceful decline.** "Not now" is always the second button, the same size. Declining never blocks the thing the person was doing.
4. **Re-ask rule.** After one decline, the same ask may return only when its trigger recurs and at least 30 days have passed. After two declines it never returns on its own; Settings keeps the switch.
5. **OS prompts follow intent.** An OS or Telegram prompt shows only after the person tapped "Yes" on our sheet, as UX-02 and UX-10 require (`PRIVACY_AND_CONSENT.md:247-253`, `:303-307`).
6. **Recorded.** Every grant and decline is recorded where its purpose already lives (table below). `PetPlay.asks` keeps only the timing for the re-ask rule.

### 6.2 The catalogue

| # | Permission | Trigger situation | Ask (EN) | Ask (FA) | Decline path | Recorded |
|---|---|---|---|---|---|---|
| P1 | **Check-ins** (`optional.pet_checkins`, proactive) | End of a session on the person's second different day; or, in the forming week, any session ending the day before a stage-up | **Can Mochi check in now and then?** Mochi can send a short message in this chat for moments you pick: growing up, seasons, a bloom in the garden. At most one a day, silent, never 21:00-08:00. No private chat content in the message. You can see why, mute or stop anytime. *Yes, check in* / *Not now* · *Choose moments* | **موچی گاهی به شما سر بزند؟** موچی می‌تواند برای لحظه‌هایی که خودتان انتخاب می‌کنید، پیام کوتاهی در همین گفتگو بفرستد: بزرگ شدنش، مناسبت‌ها، گل دادن باغچه. حداکثر روزی یک پیام، بی‌صدا، و هیچ‌وقت بین ۹ شب تا ۸ صبح. هیچ چیزی از گفتگوهای خصوصی‌تان در پیام نمی‌آید. هر وقت بخواهید، می‌توانید دلیلش را ببینید، کمش کنید یا خاموشش کنید. *بله، سر بزند* / *فعلاً نه* · *انتخاب لحظه‌ها* | The pet says "Okay! I'll be right here." «باشه! هر وقت دلت خواست، همین‌جام.» After yes: «قول می‌دم کم‌حرف باشم!» | Notification preferences (`proactiveEnabled` plus `petCheckins`), with consent evidence as other purposes keep it |
| P2 | **Telegram write access** | Right after P1 "Yes", only when `allows_write_to_pm` is false (a person who arrived through a group launch) | **One more step.** To message you, Mochi needs Telegram's OK. Telegram will ask next. *Continue* / *Not now* | **یک قدم دیگر** برای پیام دادن به شما، تلگرام باید اجازه بدهد. پنجرهٔ بعدی را خود تلگرام نشان می‌دهد. *ادامه* / *فعلاً نه* | Check-ins stay on as inbox-only; the pet never asks again in that session | Telegram holds the grant; Circles already uses the same call (`Circle.tsx:134-141`) |
| P3 | **Microphone** (UX-02) | The first hold of the mic button | UX-02 as drafted: "Use your microphone for this conversation? Your audio will be sent to {audio_providers} in {processing_locations} to transcribe and answer your request. {verified_audio_retention_summary} This does not turn on voice recognition." *Use microphone* / *Use text* | UX-02 FA as drafted: «برای این گفتگو از میکروفون استفاده می‌کنید؟ …» *استفاده از میکروفون* / *استفاده از متن* | Keyboard opens in the pill; the mic stays visible and asks again only when tapped | Per UX-02. Today the OS prompt shows on first hold with no pre-sheet (`TalkPill.tsx:143-153`); this adds the sheet before it |
| P3b | **Hands-free (open mic)** | The first time the person turns hands-free on, after P3 was accepted | **Keep the mic open while we talk?** Hands-free listens for your voice and sends when you stop talking. The mic stays on until you turn it off, close Mochi or go quiet for a minute. Audio leaves your phone only when you speak. *Turn on hands-free* / *Keep hold-to-talk* | [FA: copywriter] (`perm.P3b.*`) | Hold-to-talk stays; no re-ask that session; Settings keeps the switch | Device-local preference; the mic consent itself is UX-02 |
| P4 | **Speak out loud** | The first voice reply, when the agent has a voice (`PetView.voice`) | **Let Mochi speak out loud?** Replies will play as sound. You can switch to text anytime. *Speak out loud* / *Text only* | **موچی با صدا جواب بدهد؟** جواب‌ها با صدا پخش می‌شوند. هر وقت بخواهید، می‌توانید به متن برگردید. *بله، با صدا* / *فقط متن* | Text replies with lip-sync only | Device-local preference (a convenience, not consent) |
| P5 | **Save a memory** (UX-06) | The person says "remember…" «یادت باشه…» in pet talk | UX-06 as drafted, with the exact fact, space, agents and audience | UX-06 FA as drafted | Nothing is saved; the pet says "Okay, I won't keep that." «باشه، نگهش نمی‌دارم.» | The explicit memory request path, as in the DM |
| P6 | **Join group notes** (Circles, 18+) | The pet opened with a group code | Unchanged: the group card's own copy (`circle-copy.ts:1-5`) | Unchanged | Unchanged | Unchanged: the Circles ledger |
| P7 | **Share a card** | Right after a stage-up, a bloom or a seasonal moment | **Share Mochi's moment?** The card shows Mochi and today's moment. Nothing from your chats. *Share* / *Not now* | **لحظهٔ موچی را برای کسی بفرستید؟** این کارت فقط موچی و لحظهٔ امروز را نشان می‌دهد؛ هیچ چیزی از گفتگوهایتان در آن نیست. *فرستادن* / *فعلاً نه* | The moment stays in the Life Book, shareable from there | Nothing stored; Telegram's own share sheet |
| P8 | **Home-screen shortcut** | A session on the person's third different day | **Keep Mochi on your home screen?** One tap opens Mochi straight from your phone. Telegram adds the shortcut; Vox gets nothing new. *Add to home screen* / *Not now* | **موچی روی صفحهٔ اصلی گوشی‌تان باشد؟** با یک ضربه، موچی مستقیم از صفحهٔ اصلی باز می‌شود. میان‌بر را خود تلگرام می‌سازد و Vox هیچ اطلاعات تازه‌ای نمی‌گیرد. *بله، اضافه شود* / *فعلاً نه* | Nothing changes | `PetPlay.asks` only |
| P9 | **Learn my favourites** (UX-04, personalization) | After the person has played several different games on several days | UX-04 as drafted, worded for the pet: "Let Mochi learn which games you like? Mochi can use what you play to suggest a game. Suggestions may be wrong; you can see, change or reset them." *Turn on* / *Keep it off* | **موچی یاد بگیرد کدام بازی‌ها را دوست دارید؟** موچی می‌تواند از روی بازی‌هایتان، بازی پیشنهاد بدهد. این پیشنهادها ممکن است درست نباشند؛ می‌توانید آن‌ها را ببینید، تغییر دهید یا از نو شروع کنید. *بله، یاد بگیرد* / *خاموش بماند* | Suggestions use only this session | `optional.personalization` for that person and space |
| P10 | **Let friends visit** | The person opens Visits for the first time | §4.8 copy | §4.8 copy | Visits stay one-way: they can visit others only if those others allow it | `PetPlay` visibility flag |

**Never asked from the pet page:** usage analytics (UX-03), automatic memory (UX-05), voice recognition (UX-07), marketing (UX-12), location, contacts, camera, and fullscreen. The page keeps Telegram's normal window and never expands on its own (`telegram.ts:82-95`).

**Photos.** The pet page has no photo path. "Show Mochi a photo" in talk opens the DM, where the image rules already apply (`STUDIO_IMAGES`, `PRIVACY_AND_CONSENT.md` purpose map). No camera permission is ever requested in the Mini App.

**Motion sensor.** The shake reaction reads Telegram's accelerometer after the first touch (`telegram.ts:202-211`; `PetApp.tsx:435-439`). Telegram shows no prompt for it. The About page discloses it.

---

## 7. Dynamic tips

### 7.1 Rules

- At most **one tip a session** and three a day. Each tip shows at most twice in its life. A dismissed tip never returns.
- A tip waits for a calm moment: no care animation, no talk turn, no sheet open.
- Ignoring a tip twice counts as dismissing it.
- Every tip is literal about its reason, and long-press (or ⓘ) shows the reason line.

### 7.2 Placements

| Placement | When | Look |
|---|---|---|
| **Toy wiggle** | The tip is about a toy and needs no words | The existing 2° wiggle (`pet.css:95`) with a soft halo, twice |
| **Pet bubble** | The tip is a personality moment | The normal speech bubble, in the pet's voice |
| **Coach chip** | The tip is about UI (rooms, mic, Why this) | A small pill under the element with ⓘ and ×, 2 lines max |

### 7.3 The catalogue

| # | Tip | Signal (content-free) | Placement | EN | FA |
|---|---|---|---|---|---|
| T1 | Drag the cookie | Three cookie taps, no drag ever | Toy wiggle, then bubble | "Psst, you can drag the cookie right to my mouth." | «یواشکی بگم: می‌تونی کلوچه رو بکشی بیاری دم دهنم.» |
| T2 | Tickle | Two sessions, never touched the body | Bubble | "My tummy is ticklish. Just saying." | «شکمم قلقلکیه. گفتم که بدونی!» |
| T3 | Stroke | Pokes only, never a stroke | Bubble | "Slow strokes on my head are the best." | «اگه آروم سرم رو نوازش کنی، کیف می‌کنم.» |
| T4 | Hold to talk | Mic available, five typed turns, never held | Coach chip on mic | "Hold the mic and just talk to me." | «انگشتت رو روی میکروفون نگه دار و حرف بزن.» |
| T5 | Rooms | Joy in "wants", never opened Play | Coach chip on room rail | "There's more to play next door." | «اتاق بغلی کلی بازی داریم!» |
| T6 | Zen | Two quick round ends in a row | Bubble at round end | "Want zen mode? No timer, no misses." | «بی‌عجله بازی کنیم؟ نه ساعت داره، نه باخت.» |
| T7 | Tuck in | Energy in "wants" after 19:00, never used the moon | Toy wiggle on moon | "Tap the moon when I'm sleepy." | «هر وقت خوابم گرفت، روی ماه بزن.» |
| T8 | Night rules | First open during quiet hours | Bubble (whisper style) | "I sleep from 22:00 to 08:00 your time. Nothing drops while I sleep." | «من از ده شب تا هشت صبح می‌خوابم، به وقت تو. توی خواب هیچی کم نمی‌شه.» |
| T9 | Rest is fine | About six minutes of continuous play | Bubble | "That was fun. I'm happy to just float for a while." | «خیلی خوش گذشت! حالا یه کم لم می‌دم.» |
| T10 | Why this | First check-in opened | Coach chip | "Every message from me has a Why this? button." | «زیر هر پیامم یه دکمهٔ «چرا این پیام؟» هست.» |
| T11 | Talk chips | Pill focused and empty, first three times | Chips | "Want to hear my day?" (the person's words) | «از امروزم بگم؟» |
| T12 | Life Book | After the first stage-up | Coach chip | "Our Life Book keeps the good bits." | «لحظه‌های قشنگمون توی دفتر خاطرات می‌مونه.» |
| T13 | Garden | Second day, never planted | Bubble | "Plant something with me? It grows while you're away and never wilts." | «با هم یه چیزی بکاریم؟ وقتی نیستی هم رشد می‌کنه و هیچ‌وقت پژمرده نمی‌شه.» |
| T14 | Closet | First keepsake earned | Toy wiggle on room chip | "Something new in the closet." | «یه چیز تازه توی کمد هست!» |

Reason lines are templated from the signal: "You tapped the cookie a few times, so: it can be dragged too." «چون چند بار روی کلوچه زدید: می‌شود آن را کشید هم.» (Reason lines are in the system voice, «شما».)

T9 is the one tip that works against engagement. It is on purpose.

---

## 8. Decisions API routing

### 8.1 What the Decisions API is, and is not

Per OpenAI's guide (fetched 26 October 2026, https://developers.openai.com/api/docs/guides/decisions): the Decisions API evaluates shared `input` against named `questions` and returns typed answers. A `predicate` returns a `probability`. A `choice` returns one supplied value with a `confidence` and per-value `probabilities`. A `score` rates against 2-10 ordered levels. `gpt-6-luna` is the only model. The guide's advice: write questions around observable criteria, separate concerns into separate questions, give choices distinct descriptions, include a fallback such as "other", send dependent decisions as separate requests, and set thresholds from labelled examples by weighing the cost of false positives and false negatives.

It is a classifier, not a bandit. It does not learn from outcomes. So the "reward signals" below are ours: logged, joined offline, and used to set thresholds and retire bad options, exactly as the guide's labelled-example advice and the existing calibration report do (`src/lib/tireh/decisions/calibration.ts:1-11`).

The repo's seam is stricter than the guide in places, and the pet set fits inside it: at most 24 questions (`decisions/index.ts:16`; the guide allows 400), up to 12 score levels (the guide says 2-10, so the pet set uses ≤ 10), text or one low-detail image only (the guide also allows `input_json`; the pet set serialises features as short text), and a 500 ms default deadline up to 5 s (`index.ts:12-14`).

### 8.2 What is routed

| Decision | Where it runs | Question set | Default deadline | Local fallback |
|---|---|---|---|---|
| Which check-in to send, if any | Server planner, once per person per agent per day, before the send window | `checkin_moment` (choice: eligible moments + `none`); `checkin_variant` (choice) | 2000 ms | Fixed priority: stage-up > formed > season > bloom > milestone > care nudge > hello |
| Which tip, if any | `GET view`, precomputed for the session | `tip` (choice: eligible tips + `none`) | 500 ms | First eligible tip by catalogue order |
| Ask a permission now or later | `GET view` | `ask_now` (choice: eligible asks + `later`) | 500 ms | `later` unless the trigger is the current session's (P1 in forming week, P3, P5, P7) |
| Greeting variant | `GET view` | `greeting` (choice: plain, morning, welcome back, seasonal) | 500 ms | Rule table by time band and open events |
| Pet action from talk | The existing triage pre-pass on surface `pet`, same request | `pet_action` (choice: `none`, `feed`, `play_ball`, `sleep`, `open_play`, `open_garden`, `open_closet`, `open_bedroom`, `open_life_book`, `start_guess`) | Shares the triage deadline | `none` |

Only eligible options are ever offered to the model. `none`/`later` is always an option and always the answer on any `unknown` result.

### 8.3 Allowed context features (PRIV-027)

The `input` is a short, content-free feature line, for example: `stage:3 forming_day:4 band:evening weekday:yes lang:fa days_since_open:2-3 last_checkin:opened moments:stage_up,garden_bloom room:home mood:content`.

| Allowed | Never |
|---|---|
| The pet's own state: stage, forming day, mood level and tone, need bands, asleep | Message text (except the current talk turn, already sent to triage today) |
| Coarse time: local time band, weekday or weekend, season flag | Any emotion, stress, loneliness, health or vulnerability estimate (PRIV-027) |
| Coarse recency: days since last open, in buckets | Sleep or activity patterns read as health |
| Content-free history: last check-in outcome enum, tips seen/dismissed, rooms visited this session | Learned "usual open hour", unless `optional.personalization` is on (P9) |
| Language (`fa`/`en`) and device class | Names, ids, group titles, memory |
| Eligible options, already filtered by hard rules | Anything about other people |

### 8.4 Pet action from talk

The pet surface already runs the triage pre-pass on each talk turn. Adding one `pet_action` choice to that same request costs no extra call, and keeps concerns separate as the guide advises. The page acts only when confidence ≥ 0.75 (the same bar the skills router uses to apply without asking, `src/lib/studio/skills/route.ts:20-24`), and only after the spoken reply. Every action is a reversible UI move through the existing care route, so a wrong guess is a small, cute detour.

### 8.5 Reward signals

| Signal | Meaning | Used for |
|---|---|---|
| `opened` | The Mini App opened from that check-in's reference within 24 h | Measured, never a target on its own |
| `acted` | A care verb or game round in that session | Measured |
| `why` | "Why this?" tapped | Transparency health |
| `dismissed` | "Not now" on an ask, × on a tip, ignored twice | Hard suppression, then labels |
| `stopped` | "Stop these" or "Stop all" | Strongest negative label; hard suppression |
| `unopened` | No open within 48 h | Pause rules (§5.5) |

A check-in is labelled **welcome** only if it was opened and the person did not stop or reduce check-ins within the next 7 days. It is labelled **unwelcome** on any stop or reduce. Thresholds are set to keep the unwelcome rate low, not to raise opens. The cost of a false positive (an unwanted message) is weighted far above a false negative (a moment not announced).

### 8.6 Logging

- Rows go to the existing content-free decision log (`src/lib/tireh/decisions/log.ts:1-12`), which already rejects any free text and sweeps after 90 days.
- The row schema needs a new `questionSetVersion` value `pet-v1` and a `routeTaken` value for pet decisions (today it is `quick`/`thoughtful`/`web`/`untriaged`, `log.ts:31-41`). Open decision 5.
- Outcomes join later by row id as labels, the way `CalibrationLabel` already works (`calibration.ts:16-24`). No person id is stored in the row.

### 8.7 Guardrails outside the model

1. Consent, caps, quiet hours, pause rules and the re-ask rule are code, applied before the question (eligibility) and again before delivery.
2. Copy comes only from the reviewed catalogue. The model picks an id, never writes a message.
3. Humane invariants are untouched: Decisions never reads or writes `PetCare`.
4. A flag `STUDIO_PET_DECISIONS=off|shadow|on`, default `off`. In `shadow`, the local ranker decides and Decisions is logged beside it.
5. The service's own circuit (three failures open it for 30 s) and no retries (`src/lib/adaptive/decisions/README.md`, "Decisions").
6. Live answers are consumed only after the calibration gate: 200 labelled examples per language and question (`calibration.ts:44`). A pilot the size of HOOR may take a long time to reach it; the local ranker is a complete product until then.

---

## 8A. Voice

Voice is how most people will talk to the pet. Today it works, but it is slow, sometimes confused about being a voice turn, and tied to one provider. Every voice feature stays out of `PetCare` and out of prompt block A; the hands-free switch is device-local.

### 8A.1 The voice-mode bug

**What happens today.** On the pet's `talk-voice` route, `pet-http.ts:375-399` calls `studio.callTurn` (`src/lib/studio/service.ts:2490`), which transcribes and then calls `gateway.converse(id, person, transcript, { space, surface })` (`service.ts:2561`). `converse` (`src/lib/tireh/gateway.ts:649-650`) has no reply-format or input-modality option, and `generateReplyAt` passes `replyFormat` as `undefined` (`gateway.ts:1144-1145`). The prompt therefore never says the person spoke, so the model can answer as if it were reading typed text ("I'm reading your text"). The Telegram voice-note path does set the format (`gateway.ts:559-565`), and the prompt already has a per-turn voice line (`src/lib/tireh/conversation/prompt.ts:307-311`).

**Fix.**
1. `converse` accepts `replyFormat?: 'voice' | 'text'` and `inputModality?: 'voice' | 'text'`, and passes the format through `generateReplyAt` to `composeReply` (which already takes it, `gateway.ts:1223`).
2. `callTurn` passes `replyFormat: speak ? 'voice' : 'text'` and `inputModality: 'voice'` on the pet surface.
3. `PET_SURFACE_FRAME` (`gateway.ts:229-235`) gains a voice variant: one sentence, "The person said this out loud and is listening for your reply; answer as speech." In hands-free mode the sentence is "You are in a voice conversation now; answer as speech and keep it short."
4. Both lines live in the per-turn frame (`extraFrame`, `prompt.ts:517`) and the "For this turn" head, never in block A.

### 8A.2 Hands-free mode (voice activity detection)

An opt-in mode on the talk pill: the mic stays open, the pet listens, and a turn is sent when you stop speaking.

| Part | Design |
|---|---|
| Detector | A tiny energy-and-silence detector in an `AudioWorklet`: RMS over 20 ms frames, an adaptive noise floor, speech start after about 120 ms above the floor, end of speech after about 800 ms of silence (tuned for Persian pauses), minimum utterance 400 ms, maximum 30 s, a 300 ms pre-roll held only in memory. Not Silero or onnxruntime: their weight would break the pet bundle gate (`scripts/check-pet-bundle.mjs:29-31`). The worklet is a separate lazy file of about 2 KB |
| Visible state | The pill turns volt with a listening ring, a "Listening" chip shows, the pet holds its listening pose (existing `listen` reaction). Thinking and speaking states as today |
| Send | On end of speech the utterance is recorded with the existing `MediaRecorder` path and posted to `talk-voice` (`TalkPill.tsx:143-200`) |
| Barge-in | If speech starts while the pet is talking, playback stops (`stopAudio`, `PetApp.tsx:539-547`), the sentence queue is cleared, and capture begins. During playback the start threshold rises about 6 dB and needs about 200 ms, so the pet's own voice does not trigger it (echo cancellation is already requested, `TalkPill.tsx:153`) |
| Auto-off | After 60 s with no speech, when the page is hidden or Telegram deactivates (`pageActive`), and on close. The mic is never left open in the background |
| Privacy | Detection runs on the device. Audio leaves the device only after end of speech, exactly like hold-to-talk. Nothing is buffered beyond the current utterance |
| State | Device-local (a try/catch-wrapped local preference). Never on the server, never in `PetCare` |
| Fallback | If `AudioWorklet` or `getUserMedia` is missing (some iOS Telegram WebView versions; older Android WebViews), the hands-free switch is hidden and hold-to-talk stays. If the mic permission is denied, the same |

**Permission moment P3b** (added to §6.2): shown the first time the person turns hands-free on, after the UX-02 mic sheet (P3) has been accepted. "Keep the mic open while we talk? Hands-free listens for your voice and sends when you stop talking. The mic stays on until you turn it off, close Mochi or go quiet for a minute. Audio leaves your phone only when you speak." Buttons: "Turn on hands-free" / "Keep hold-to-talk". Decline keeps hold-to-talk and never re-asks in that session; Settings keeps the switch. An open mic is a privacy moment even when nothing is sent, so it gets its own ask.

### 8A.3 Speech synthesis: a provider seam and sentence streaming

**Today.** `ElevenLabsStudio.speak` (`src/lib/studio/media.ts:349-365`) sends the whole reply (cut at 2,500 characters) to ElevenLabs with `model_id` from `ELEVENLABS_TTS_MODEL`, default `eleven_v4` (`media.ts:217`), and returns one MP3 after the reply is complete; `callTurn` returns it as base64 and the page decodes it in one piece (`PetApp.tsx:577-601`). The person waits for the full reply and the full synthesis before hearing anything. The coordinator's figure for v4 is about $0.08 per 1,000 characters; I did not verify ElevenLabs' price.

**The seam.**

```ts
interface SpeechSynthesizer {
  readonly id: 'eleven' | 'gemini';
  readonly committedTtsExportFence?: true;      // same export fence ElevenLabs has today (service.ts:2567)
  speak(text: string, voice: AgentVoiceRef, o: { lang: 'fa' | 'en'; style?: string; signal?: AbortSignal; authorizeNow?: () => boolean }): Promise<SpeechChunk>;
}
type SpeechChunk = { format: 'mp3' | 'pcm16'; sampleRate: number; data: Buffer };
```

Selected by `STUDIO_TTS_PROVIDER=eleven|gemini`, default `eleven`, so nothing changes until the flag flips.

**Gemini adapter.** `gemini-3.8-flash-tts` (and `gemini-3.8-flash-lite-tts` for the bake-off). Google's speech-generation page (fetched 26 October 2026) lists Iranian Persian; unary calls return 24 kHz mono 16-bit WAV, streaming through the Interactions API (`/v1beta/interactions`, `stream: true`) returns headerless 24 kHz PCM; style is set with a natural-language `style` note per turn and inline tags such as `<short pause>` and `<laugh>`, and the text is spoken verbatim. The pet's style note comes from the persona's voice brief ("warm, playful, a little bit quick"). Pricing on Google's pricing page: Flash TTS $9.00 per 1M audio tokens through 31 December 2026 and $18.00 from 1 January 2027 (Flash-Lite $6.00 → $12.00); audio is 25 tokens a second. That is about $0.016 per 1,000 spoken characters now and about $0.032 from January (at roughly 14 characters a second). The coordinator described Gemini 3.8 TTS as preview, released 28 September 2026; Google's pages as fetched do not label it preview. Treat it as preview until the account dashboard says otherwise.

**Sentence-level streaming ("fake streaming").** The reply model already streams (`src/lib/tireh/llm.ts:98-104`, `:330-345`).
1. As text arrives, a splitter cuts at sentence ends: English `.` `!` `?` `…` followed by a space or the end; Persian `.` `!` `؟` `…`. It never cuts after common abbreviations, inside decimals (`3.5`, `۳٫۵`), URLs or quotes («…»). A Persian comma `،` is only a soft cut for a sentence longer than about 180 characters. Pieces shorter than about 20 characters merge with the next so prosody does not chop; pieces stop at about 240 characters.
2. Each sentence is synthesized as soon as it completes, in parallel with the next one being written; results are delivered strictly in order.
3. `talk-voice` answers as a stream of events (transcript, then one event per sentence with its text and audio, then done). Before each synthesis and each event, the existing authority fence runs (`authorizeNow`, `mayDeliverNow`, `service.ts:2549-2575`); if authority changes mid-reply, the stream stops with the existing "settings changed" error and nothing further is spoken. The final `unchanged` check and memory retention still happen once at the end.
4. The page keeps a play queue on its one `AudioContext`: MP3 sentences are decoded, PCM sentences become `AudioBuffer`s directly, and each is scheduled back to back through one analyser node so lip-sync stays continuous (`AudioLipSync`, `_engine/lipsync.ts`). The bubble reveals the sentence being spoken.

**The bake-off gate before flipping the default.** The same 20 lines in Persian and the same 20 in English (greetings, a bedtime story line, numbers and dates, English work words inside Persian, a question, a laugh), rendered on ElevenLabs `eleven_v4`, `gemini-3.8-flash-tts` and `gemini-3.8-flash-lite-tts`. HOOR listeners (at least eight native Persian speakers) rate blind, A/B/C, for naturalness, Tehrani accent, loanwords and numbers; time to first audio and cost per 1,000 characters are measured. Flip the default only if Gemini is at least as natural as ElevenLabs in Persian, no worse in English, and faster to first audio.

**Voice continuity.** An agent's voice is fixed after hire (`docs/VOX_STUDIO.md`, "Voice"). An ElevenLabs voice id cannot be used by Gemini, and Gemini's voice replication must not be used to copy a person's voice (PRIV-025). So flipping the provider changes how existing agents sound. Recommendation: the provider is chosen per agent at hire; existing agents keep ElevenLabs unless the creator re-picks a voice (open decision 16).

### 8A.4 Live calls (a finding for engineering)

The ElevenLabs agent used for live calls is created with `language: 'en'` and `tts: { model_id: 'eleven_flash_v2_5' }` (`src/lib/studio/media.ts:463-477`); the language can be overridden per call (`media.ts:482`), the model cannot. `docs/STUDIO_VOICES.md` lists Flash v2.5 without Persian and Eleven v4 Turbo with Persian. So Persian live calls run on a model that does not list Persian. Follow-up: switch the agent's TTS model to `eleven_v4_turbo` (the coordinator cites about 100 ms latency; not verified here) and re-run the bake-off lines on it.

### 8A.5 OpenAI, evaluated and rejected for speech

OpenAI's deprecations page (fetched 26 October 2026) removes `tts-1`, `tts-1-hd` and `gpt-4o-mini-tts` on 6 January 2027, replaced by `gpt-realtime-2.1-mini`, a speech-to-speech realtime model that cannot speak Vox's composed text. So OpenAI is not a TTS option. Keep OpenAI for speech-to-text only, but note the same page deprecates the transcription models, including `gpt-4o-mini-transcribe`, the default in `media.ts:52`, with removal on 26 February 2027 (replacements `gpt-transcribe` or `gpt-live-transcribe`). That migration is a separate engineering follow-up.

## 9. Responsive, no-scroll layout

### 9.1 What the page reads

- `--pet-vh`: Telegram's stable viewport height; `--pet-safe-top`: device inset plus Telegram's content inset (its floating Close and ⋯ row); `--pet-safe-bottom` (`telegram.ts:121-136`).
- The page re-measures on `safeAreaChanged`, `contentSafeAreaChanged`, `viewportChanged`, `fullscreenChanged` (`telegram.ts:98`; `PetApp.tsx:414-426`).
- The page never calls `expand()` or fullscreen (`telegram.ts:82-95`). So a half-height launch is a real layout the design must serve.

### 9.2 Classes

Classes key off the available height `h = --pet-vh − safe-top − safe-bottom` and the width `w`.

| Class | Condition | Typical case | Character | Room rail | Dock | Talk | Bubble |
|---|---|---|---|---|---|---|---|
| **Peek** | h < 480 | Telegram half-sheet launch | ≥ 120 px (`scene.ts:55` floor) | Current room name only | 3 toys, 56 px | A round talk button in the dock row | 2 lines, paged |
| **Short** | 480 ≤ h < 620 | 360×640 phone; any phone with the keyboard up | Shrinks; keyboard up hides the dock | Icons only | 3 toys, 60 px (hidden with keyboard) | Full pill, 48 px | 3 lines, paged |
| **Regular** | 620 ≤ h < 780 | 390×844 with Telegram's header | ~56% of width (`scene.ts:48-58`) | Icons + active label | 3 toys, 68 px | Pill 52 px | 4 lines, paged |
| **Tall** | h ≥ 780 | 430×932, fullscreen | Up to 520 px cap (`scene.ts:55`) | Icons + labels | 68 px, 36 px gap | Pill 52 px + chips | 5 lines, paged |
| **Wide** | w ≥ 600 | Tablet, Telegram Desktop | Centred column, max 480 wide | Vertical side rail | In the column | In the column | As Tall |

### 9.3 Vertical budget (Regular)

From top: safe-top → bubble zone (reserved above the head; the character box already leaves it, `scene.ts:48-52`) → character → room rail (32 px, 44 px hit area) → 16 px → dock (68 px) → 16 px → pill (52 px) → 14 px + safe-bottom. The character takes what is left × 0.68, exactly as `characterBox` computes today (`scene.ts:53-58`), with the room rail added to the bottom stack before `dockTop` is measured.

### 9.4 Rules that guarantee no scrolling

1. The root stays `position: fixed`, `overflow: hidden`, height `--pet-vh` (`pet.css:13`). No descendant may set `overflow: auto` or `scroll`. A CSS test greps the pet CSS for it.
2. **Paged bubble.** Replace the expanded bubble's inner scroll (`pet.css:72`; `Bubble.tsx:28-29`) with pages: text is split at sentence or word boundaries to fit the class's line budget, "more ›" «بیشتر ‹» (the chevron mirrors in RTL) advances, dots show position, Telegram's BackButton closes as today.
3. **Sheets fit the smallest class.** Every sheet (permission, talk chips, closet, story, game picker) is designed for Peek first: a title of at most two lines, a body of at most four lines (English at 320 px), two buttons. Longer legal text links out to the Vox notice; it is never crammed in.
4. **Grids paginate.** Closet and Life Book move by page with dots and swipe, six items or one spread per page.
5. **Line budgets.** Every text slot has a max line count per class, with `line-clamp` as a safety net. Persian strings are measured separately (they run longer in Vazirmatn).
6. **Keyboard.** When the talk input is focused, `viewportChanged` drops the class; the dock and rail hide; the character shrinks above the pill. The bubble keeps its line budget.
7. **Telegram's header row.** In fullscreen, nothing tappable sits under the Close/⋯ row: the top safe area includes the content inset (`telegram.ts:129`).
8. **Rotation.** Landscape on a phone is Wide with a short height: the column is centred and the character uses the Short rules.

### 9.5 Type and touch

| Token | EN | FA |
|---|---|---|
| Body | 15/21 Onest (`pet.css:9-14`) | 16/24 Vazirmatn |
| Small | 13/18 | 14/20 |
| Bubble | 500 15/21 (`pet.css` bubble) | 500 16/24 |
| Display (room names, sheet titles) | 600 18/24 Unbounded | 700 19/28 Vazirmatn |
| Touch target | ≥ 44 × 44 px (`pet.css:22`, `.pet-close`) | same |

Colours keep the Soft Weather tokens restated in `pet.css:9-11`: ground `#0E1013`, text `#F2F1EC`, text-2 `#A9ADB5`, ink `#14202C`, volt `#D6FF5C`. Rings stay volt and are never red (`Dock.tsx:31`).

---

## 10. Progressive animation and motion plan

### 10.1 What the engine does today

- One frame loop composes layers L0-L5 into one rig frame and writes MotionValues, so React never renders per frame; it sleeps at rest and pauses while hidden (`_engine/loop.ts:1-8`).
- Three tiers with budgets: full (16 particles, hit-stop, velocity stretch), lite (6 particles, 30 Hz followers), reduced (no particles, no travel) (`_engine/types.ts:71-86`).
- Idle scheduler: a fidget after 8 s, long fidgets after 30 s, a doze at 90 s, ambient mood beats every 9-16 s, "wants" beats, happy hops, gaze drift (`loop.ts:1500-1550`).
- Bond unlocks one signature fidget per milestone, a third of long fidgets (`loop.ts:326-327`, `:1512-1518`).
- Reactions have three variants, never the same twice in a row, with priority classes drag > eat > touch > talk > play > needs > idle (`_engine/types.ts:376-406`).
- Species and family tuning: a cloud is softer and floatier, a bear heavier, an owl tilts further (`_engine/species.ts:9-30`). Squash and stretch preserve volume (`species.ts:75`).
- Lip-sync from text or audio; a stage-up tweens the body path (`loop.ts:1461`).

### 10.2 What "more professional" means, concretely

| Principle | Today | Add |
|---|---|---|
| **Anticipation** | Hops crouch first (`celebrate.ts`: 120 ms crouch) | Every travel and room change starts with a 60-100 ms counter-lean |
| **Eye lead** | Eyes and head share the gaze target (`loop.ts:95-96`) | Eyes arrive 60-80 ms before the head; a blink on any head turn over ~25° |
| **Saccades** | Drift glances | 2-3 tiny eye darts (2-4 view units, 30-50 ms each) inside a long look |
| **Overlap and follow-through** | Ears, hair, accessories on followers (`_engine/types.ts:55-63`) | Closet items join the follower set (soft items follow, rigid ones ride the head) |
| **Settle** | Jelly after impacts | One overshoot, then rest; no jelly longer than ~600 ms on idle beats |
| **Weight** | Landing squash by speed and species | Fall height also scales squash; heavier species settle lower |
| **Arcs** | Hops arc | Room-change leans and game moves follow arcs, never straight lines |
| **Easing** | `--ease-sine`, `--ease-out`, `--ease-over` (`pet.css:12`) | Use exactly these three for UI; springs for the body. No linear motion anywhere visible |
| **Holds** | | A 120-200 ms hold on the key pose of every one-shot so it reads |

### 10.3 Per-stage vocabulary

| Stage | Body | Face | Moves | Unlocks |
|---|---|---|---|---|
| 1 Wisp | Small, floaty, slow springs | Dot eyes only (`stage.ts:18-19`) | Drift, wobble, slow blink, curious tilt; tiny hops only | — |
| 2 Puff | Rounder; first real hops | Mouth and cheeks appear (`stage.ts:20`) | First "yum" chew and cheek puff; first laugh | Feeding becomes a performance |
| 3 Shaped | Firmer timing | Brows and lashes (`stage.ts:21`) | Brow raises on surprise; wave; hair follow-through | Expressive reactions |
| 4 Formed | Confident, snappier springs | Accessory, second highlight (`stage.ts:22`) | Signature fidgets; full celebrate; accessory secondary motion | Closet items, Bond signatures |

**Lighting a growth moment.** A short beat on the same engine: the pet looks up as if remembering (eyes lead, a slow blink), a soft glow swells on the part that lights (the existing `glow` channel, `Stage.tsx:52-53`), the new detail fades in with one overshoot, then a small nod. About 1.2 s; reduced motion is a crossfade of the detail and the line. Never confetti, never a counter.

### 10.4 Per-room reactions

| Room | Idle | Key reactions |
|---|---|---|
| Home | Today's mood idle | Today's care reactions |
| Play | Ready bounce, eyes on the toy | Catch chomp, near-miss glance after the star (no sad face), round-end celebrate or a shrug-smile |
| Garden | Hovering over the pot | Rain: rise, darken slightly, drops (one new particle kind within the tier budget), relief shake, lighter fluff |
| Closet | Three-quarter turn to a mirror | Admire: eyes up to the new item, a happy wiggle, follower settle |
| Bedroom | Slower breath, heavier lids | Yawn, drift, sleep (existing); a story nod every line |
| Life Book | Reading pose | Page-flip glance; a little hop on its own drawing |

### 10.5 Room transitions

- 300 ms. The backdrop slides at 30% parallax; the character stays put but counter-leans 60 ms, then leans with the slide and settles (one overshoot).
- Dock items leave and arrive staggered by 40 ms on `--ease-out`.
- Reduced: a 160 ms crossfade, no lean, no slide.

### 10.6 Mini-game motion

- Starfall: lean proportional to the drag velocity (the existing velocity stretch on full tier); eyes track the nearest star through the gaze system; a catch is a chomp squash; a miss is a glance, never a frown.
- Zen: all game springs one preset softer; nothing flashes.
- Fire hop: a crouch, a high arc, a squash on landing; sparks within the particle budget.

### 10.7 Performance budget (low-end Android WebView)

- 60 fps on full; 30 Hz followers and particles on lite (`_engine/types.ts:79-80`).
- Under 4 ms of script per frame on a lite-tier device; transforms and opacity only; no filters or blur (`pet.css:1-2`).
- Each room and game is its own lazy chunk with its own CSS, like the Sleeper and Circle chunks today (`PetApp.tsx:47-51`). Target ≤ 12 KB brotli per room chunk.
- The engine stays under its 40 KB ceiling (`scripts/check-pet-bundle.mjs:31`). Game physics reuse `physics.ts` (Ball, Fling, Hop).
- The living page CSS stays under 12,000 bytes; room CSS loads with the room.

### 10.8 Reduced motion

The reduced tier follows the OS setting live (`PetApp.tsx:269-277`) and keeps blinks, faces and fades (`pet.css:123-125`). Rooms crossfade. Games keep their essential motion (the stars must fall) at 60% speed, with no particles, no screen motion and no parallax. Zen is the default game mode under reduced motion.

---

## 11. Screen-by-screen specs

These match the artifact's artboards. Each screen lists layout, elements, states and copy. Empty, error and offline states follow each group.

### S1 First open (Telegram DM)

- **Layout.** The agent's bot chat after `/start`: a welcome line and a `web_app` button.
- **Copy.** Unchanged button label from the menu (`links.ts:23-28`).

### S2 Hello

- **Layout.** Regular class. Backdrop in the agent's hue (`scene.ts:32-44`); character centred; dock; pill; room rail with Home active.
- **Elements.** Bubble "Hi Sara!" «سلام سارا!» (morning: «صبحت بخیر سارا!»; evening: «سلام سارا! ماه دراومده.», never «شب بخیر», which is a goodbye); "First day together" «روز اول آشنایی» chip (`PetApp.tsx:682`).
- **States.** Asleep in quiet hours: no hello, Z's, T8 tip.
- **Learning stance.** On the first open, after the hello, the pet's first line is about learning, not about being small: "I know my job. I don't know your team yet. Teach me as we go?" (`growth.intro`).

### S3 First tip

- **Elements.** Cookie wiggle with halo; after a second tap, the T1 bubble.

### S4 Daily: arrive from a check-in

- **Elements.** The check-in's moment plays after hello (stage-up celebration, `celebrate.ts`).

### S5 Daily: wants

- **Elements.** Moon wiggles; thought bubble with the moon; the pet's eyes drift toward the moon.

### S6 Daily: talk

- **Elements.** Pill focused; chips; reply bubble paged.

### S6b Daily: a moment lights

- **Elements.** After a confirmed "remember this", the lighting beat (§10.3), the bubble "I learned how you plan a release!" and a chip "New page in What I've learned". Long-press shows the why line.

### S6c Daily: hands-free

- **Elements.** Pill in volt with the listening ring and a "Listening" chip; the pet in its listening pose; the reply bubble reveals sentence by sentence as audio plays.

### S7 Daily: settle

- **Elements.** T9 bubble; character in content idle.

### S8 Play: picker

- **Layout.** Three game cards in the dock zone (icon + name, no numbers); a Zen toggle «بی‌عجله».
- **States.** Tired: cards dim, the pet yawns, "Nap first?".

### S9 Play: Starfall round

- **Elements.** Stars, pips at top, the pet moving with the finger.
- **End.** Voice-pack line; "Again" «دوباره» / "Done" «تمام».

### S10 Garden

- **Elements.** Pot, sprout, rain verb, breathe verb.
- **States.** Empty («یه دونه بکاریم؟» / "Plant a seed?"), sprouting, watered today («امروز سیراب شد» / "Watered today"), bloomed.

### S11 Closet

- **Elements.** Tabs "Your closet" / "Mochi's look" (creator only); 2×3 grid; page dots; locked items with how-to-earn.

### S12 Bedroom

- **Elements.** Lamp, Story, Moon; dimmed room; story bubble paged.

### S13 Life Book

- **Elements.** One spread: a drawing and a line. Tabs Pages / Keepsakes / What I've learned / About me. A lit growth moment shows its title and why line; an unlit one shows only its hint. No counts.

### S14 Seasonal (Yalda, Chaharshanbe Suri, Nowruz)

- **Elements.** Room dressing; seasonal greeting; Fal-e Hafez card; fire hop; haft-sin.

### S15 Check-ins in Telegram

- **Elements.** Two messages (EN and FA); Why this expanded; Stop confirmation; the paused note in the app.

### S16 Permission sheets

- **Elements.** P1 check-ins, P2 write access, P3 mic, P7 share, P8 home screen; EN and FA.

### S17 States

- Droopy, asleep, welcome back, private (`Sleeper.tsx`), offline, guest.

### S18 Voice

- Hold-to-talk, the P3b hands-free sheet, the hands-free listening state, sentence-by-sentence speaking, barge-in.

### S19 Layout classes

- Peek, Short with keyboard, Regular, Tall, Wide.

### Empty, error and offline states

| Case | Behaviour | EN | FA |
|---|---|---|---|
| Can't reach the server on open | Existing Sleeper offline with retry (`Sleeper.tsx:12-21`) | "Can't reach the cloud" / "Check the connection and try again." (`copy.ts:53-54`) | «ارتباط با ابر قطع شد» / «اینترنت را بررسی کنید و دوباره امتحان کنید.» |
| A care action fails | Optimistic care eases back; no message | — | — |
| A game outcome fails to save | The round still played; it retries silently once | — | — |
| Talk fails | Existing line (`copy.ts:59`) | "Hmm, I lost my words. Try again?" | «اِ، حرفم یادم رفت! دوباره بگو؟» |
| Story unavailable | The pet hums instead | "Let me just hum you one tonight." | «امشب به جای قصه، یه لالایی برات زمزمه می‌کنم.» |
| Closet empty | A drawing of an empty hanger | "Nothing here yet. Things we do together end up here." | «هنوز چیزی اینجا نیست. یادگاری کارهایی که با هم می‌کنید، اینجا جمع می‌شود.» |
| Life Book empty | First page only | "Page one: we met." | «صفحهٔ اول: با هم آشنا شدیم.» |
| Session expired in talk | Existing (`copy.ts:60-61`) | "Close and reopen me to keep talking." | «این صفحه را ببندید و دوباره باز کنید تا گفتگو ادامه پیدا کند.» (replaces today's `reopenFa`) |

---

## 12. Metrics and success criteria (PRIV-028-compatible)

There is no target to maximise sessions, minutes or opens. Every measure is either a quality floor or a ceiling.

| Measure | Kind | Target | How |
|---|---|---|---|
| **"I felt I had to come back"** | Ceiling | ≤ 10% agree | One-question in-app survey, at most once a month per person, EN/FA, optional |
| "Mochi made my day a little better" | Floor | ≥ 60% agree | Same survey slot, alternating |
| Check-in stop rate | Ceiling | ≤ 5% of sends lead to a stop | Decision log outcomes |
| Check-in "unwelcome" label share | Ceiling | ≤ 10% | §8.5 |
| Median session length | Band | 1.5-4 min | Optional analytics only (UX-03 opt-in) |
| Share of sessions over 15 min | Ceiling | Not rising | Same |
| Opens during 22:00-08:00 | Ceiling | Not rising after check-ins launch | Same |
| Talk turns started from the pet | Quality | Rising is good: it is the real product | Server counts, content-free |
| Tip dismiss rate | Quality | ≤ 30% per tip, else retire the tip | `PetPlay.tips` aggregates |
| p95 frame time, lite tier | Performance | ≤ 33 ms | Engine debug stats on test devices |
| Bundle | Gate | Passes `check-pet-bundle.mjs` | CI |

All product analytics are behind the existing opt-in (UX-03). Without opt-in, only content-free server counts and the decision log exist.

---

## 13. Phased delivery

No time estimates. Each phase ends only when its gate passes.

| Phase | Engineering | QA | Motion | Gate |
|---|---|---|---|---|
| **0 Foundations** | Voice-mode fix (`converse` reply format and input modality, the voice line in `PET_SURFACE_FRAME`); the `SpeechSynthesizer` seam with `STUDIO_TTS_PROVIDER=eleven` as default; string keys from `PET_COPY_KEYS_2026_10_26.md`, Persian from the copywriter, and language pick; paged bubble; layout classes and room rail shell; `PetPlay` store with epoch, export, forget, sweep; copy lint; decision log `pet-v1` | No-scroll test at five sizes EN/FA; humane test unchanged; export/forget includes `PetPlay` | Eye lead, saccades, blink-on-turn, settle rule | Bundle check; `care.test.ts` byte-identical |
| **1 Rooms and play** | Home, Play (Starfall + zen), Bedroom (no story yet); tips v1 with the local ranker; UX-02 mic sheet; voice pack generation and lint; growth moments generated at spawn (`growth` block, lint, default set, `studio_pet_growth`, lighting for `room`, `access` and `taught` with confirmation); hands-free mode with P3b; Gemini adapter behind the flag, sentence streaming, and the TTS bake-off | Tier matrix on low-end Android; RTL mirror check; reduced motion; VAD on iOS and Android Telegram (fallback to hold-to-talk); barge-in with speaker playback; authority fence per sentence | Room transitions; Play reactions; per-stage vocabulary; the lighting beat | Bundle check; per-room chunk ≤ 12 KB br; worklet ≤ 2 KB; bake-off result before any default flip |
| **2 Telegram and AI** | Check-ins (needs a production scheduler, open decision 2); permission catalogue; Garden; Closet overlay; Guess; bedtime story; `pet_action`; Decisions in `shadow` | Caps, quiet hours, DST, pause rules; Why this; Stop cancels queued sends | Garden rain; Closet mirror | Privacy owner sign-off on check-in payloads; bundle check |
| **3 Seasons and friends** | Yalda, Chaharshanbe Suri, Nowruz; Visits; Hum; Decisions `on` per question after calibration | Calendar edge cases (Persian leap years, equinox time); native FA review | Fire hop; seasonal dressing | 200 labelled examples per language per question; bundle check |

Calendar note: Yalda falls in late December, Chaharshanbe Suri and Nowruz in March. Whatever phase is live when a festival approaches decides which festival ships first.

---

## 14. Open decisions for Reza

| # | Decision | Recommendation |
|---|---|---|
| 1 | Can check-ins come from the agent's own bot with pet-world text, given PRIV-029's generic-payload rule and today's "You have a reminder in Vox." pattern? | Yes, with a fixed reviewed template catalogue, no memory or chat content, and privacy owner sign-off before launch |
| 2 | Production has webhooks and no scheduler; reminders run only with polling and `STUDIO_MAINTENANCE=1` (`src/lib/studio/runtime.ts:226`, `:241`). How do check-ins run? | A scheduled HTTPS trigger (Cloud Scheduler) into a planner with the same final delivery fence as reminders. Until then, check-ins stay off |
| 3 | Visitor closet as an overlay vs editing `agent.look` | Both, clearly separated: overlay for everyone, real look for creator and admins with a "changes the photo for everyone" warning |
| 4 | Game suggestions from past play | This session only by default; cross-session only with `optional.personalization` (P9) |
| 5 | Decision log for pet decisions | Extend the existing schema with `pet-v1` rather than a new collection |
| 6 | Bedtime story and game comments: memory or not? | Voice pack for comments (no model call at play time); stories as a non-memory pet-surface turn that never writes DM history |
| 7 | Digits during a game round | None. Pips only, so the "no numbers" rule holds everywhere in the Pou layer |
| 8 | Quiet hours for check-ins | The stricter union, 21:00-08:00 |
| 9 | Language default | Persian when Telegram's `language_code` starts with `fa`, as Circles does; a toggle in Settings |
| 10 | Visits | Phase 3, opt-in both ways, preset stickers only |
| 11 | Keepsake for Stars | Not in this scope. If ever, follow the research brief's single-keepsake rule |
| 12 | Hafez lines | A curated set from a named public-domain edition, chosen and checked by a native editor |
| 13 | Which calendar source decides official Iranian mourning days (for the seasonal quiet rule, §5.5) | A small, reviewed, versioned table of official mourning dates for the next two Persian years, maintained by the HOOR team and checked against the official Iranian calendar each year, rather than a live third-party feed. Default to quiet when a date is uncertain |
| 14 | The copywriter's reviewed variants: «قهر!» / «آشتی!» for over-poking and «قر» for the dance wiggle | Leave both out for launch. They are charming but touch the guilt rule and some users read «قر» as cheeky; the main lines («اِ، نکن!»، «تکون») are applied |

---

| 15 | Growth moments on the Agent inside the 1 MiB `studio/state` document | Fine for the pilot (about 6 KB per agent). Move definitions to their own collection before the agent count makes the state document a risk |
| 16 | TTS provider for existing agents | Choose the provider per agent at hire. Existing agents keep their ElevenLabs voice unless the creator re-picks; never replicate a person's voice in Gemini |
| 17 | Lit `taught` moments when the source memory is erased | Dim silently and remove the page (honest forgetting), rather than growth that only rises |
| 18 | Agents hired before growth moments existed | Generate a set from the stored persona on the first pet open, creator-editable for a week; no change to the persona |
| 19 | Curiosity questions | On by default for members' private chats, at most one a day per person, with an off switch in Settings |

## 15. What I could not read or verify

- The original "brief" the pet code cites as §1.1-§3.9 is not in the repository. I designed from the code and its comments.
- The built CSS size. `pet.css` is 12,395 bytes as source, above the 12,000-byte gate, so the build's minified size must be the one under budget; I did not run a build (no `node_modules`).
- Telegram Mini App APIs for the home-screen shortcut, story or message sharing and emoji status were not re-checked against Telegram's current documentation in this session.
- Whether Telegram opens the agent's Mini App at half height by default on every client. The Peek class covers it either way.
- PRIV-014 (consent evidence) was not read; "recorded" columns name the purpose, not the storage format.
- The Decisions guide was read through a fetch-and-summarise tool, not verbatim. Its numbers (400 questions, 2-10 levels) differ from the repo's caps; the design stays inside the repo's.
- Exact festival dates for 2026-2027 were not computed from an authoritative calendar; the design computes them at runtime.
- The voice-mode bug's exact wording ("I'm reading your text") was reported by the coordinator; I confirmed the mechanism in code (no reply format or modality on `converse`), not the model's output.
- ElevenLabs prices, the `eleven_v4_turbo` latency and Gemini's preview status were not verified; Google's pages as fetched do not label `gemini-3.8-flash-tts` preview.
- Whether `AudioWorklet` and `getUserMedia` work inside Telegram's iOS WebView on current versions was not tested.
- No user research with HOOR people was done for this design. The survey ceilings are proposed, not validated.
- Whether each Persian line fits its layout limit was estimated by character count (about 34 characters per Peek bubble line, 40 per sheet line), not measured in Vazirmatn. Ten keys are flagged in the keys file; nothing was rewritten.
- The Studio menu names quoted in `quiet.chatAccess.body` must match the Persian Studio UI exactly; the copywriter asks for a check before shipping.
