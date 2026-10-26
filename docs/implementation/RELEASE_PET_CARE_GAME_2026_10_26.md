# 26 October 2026 pet care game release candidate (not deployed)

This is a candidate, not a deployed release. Nothing here was installed, no production flag was changed, no message reached a real person and no real-provider generation ran. Branch `design/pet-pou-flow`: Wave A is commit `6c722cd`, Wave B is `3a7304a`, and Wave C plus this QA pass are uncommitted on top. Design: [PET_CARE_GAME_DESIGN_2026_10_26.md](../design/PET_CARE_GAME_DESIGN_2026_10_26.md); copy: [PET_COPY_KEYS_2026_10_26.md](../design/PET_COPY_KEYS_2026_10_26.md).

## Scope

**Wave A, foundations (`6c722cd`).** Server: the per-person `PetPlay` store (items, wearing, garden, book, games, tips, asks, seasons, litMine) on PetCare's erasure epoch, with export, forget and the 90-day sweep, and the play route (`src/lib/pet/play.ts`, `src/lib/studio/pet-http.ts`); the voice-mode fix (`replyFormat` and `inputModality` on converse, the voice line in the pet's surface frame); the `SpeechSynthesizer` seam behind `STUDIO_TTS_PROVIDER` and an EN/FA sentence splitter (`src/lib/studio/tts/`). Client: the bilingual strings catalogue generated from the keys file (`src/app/studio/pet/_ui/strings/`), five no-scroll layout classes, the room rail, the paged bubble, RTL. Motion: anticipation, follow-through, eye lead and saccades, settle rule, per-stage vocabulary, reduced motion, frame guard (`src/app/studio/pet/_engine/`). Tooling: the copy lint (`scripts/check-pet-copy.mjs`), the gate runner (`npm run check:pet`), `pet-v1` decision-log rows, `src/lib/tireh/pet-flags.ts`. `PetCare` and `care.test.ts` unchanged.

**Wave B, rooms and voice (`3a7304a`).** Server: the Gemini speech adapter behind `STUDIO_TTS_PROVIDER=gemini`; `talk-voice?stream=1` NDJSON with one sentence per event and the authority fence before each; growth moments drafted at spawn, stored per agent and lit per person, with `growth/confirm` after an explicit save. Client: Play (Starfall, zen), Bedroom, Life Book, lit details, tips v1, the UX-02 mic sheet, hands-free (AudioWorklet detector, barge-in, auto-off), streamed sentence playback (`_ui/rooms/`, `_ui/tips.ts`, `_ui/handsFree.ts`, `_ui/voiceStream.ts`).

**Wave C, Telegram and AI (uncommitted).** Server: check-ins (`src/lib/pet/checkins.ts`, `src/lib/studio/pet-checkins/`: planner, chooser, delivery with Open / Why this? / Stop buttons, store, GET/POST `…/checkins`, the `?ci=` open mark), the scheduled trigger `POST /api/studio/pet/checkins/run`, the maintenance-loop runner, the mourning-day table (`src/lib/pet/mourning-days.ts`), the generated server copy (`src/lib/pet/checkin-copy.ts`), Decisions wiring for check-ins, the view and talk (`src/lib/studio/pet-decisions.ts`, `pet-view-decisions.ts`), `pet_action` on talk responses, `PetView.checkin / checkins / suggest / canEditLook`, the pet-signed `POST …/look`, Guess as a game id with its `bestGuess` page, the `setVisits` play op, export and erase of the check-in record. Client: Garden, Closet (overlay, and the creator's real look), Guess my word, asks P1, P2 and P7-P10, the `?ci=` replay, `pet_action` after the reply, the share card (`_ui/Asks.tsx`, `_ui/askRules.ts`, `_ui/petAction.ts`, `_ui/share.ts`, `_ui/telegram-more.ts`, `_ui/rooms/`). Motion: outfits, the garden pot, Guess reactions (`_engine/outfits.ts`, `_engine/garden.ts`). Copy: 25 Wave C rows in the keys file.

**This QA pass.** Every Wave C string comes from the catalogue (`strings/extra.ts` removed; `book.page.bestGuess` added to the keys file, the one design edit allowed). Seams aligned: check-in and look POSTs carry the care epoch; the Closet uses the pet-signed look route and `view.canEditLook` (it used Studio's route, whose initData is the manager bot's); the session wrapper exposes `look`, and `look_forbidden` no longer ends the pet; P10 sets `setVisits`; Guess sends `gameRound 'guess'` and shows the `bestGuess` page; P1 is not asked while the server reports check-ins off (`live: false`), and a P1 yes with every moment switched off is a no; `view.suggest` reorders tips and asks only among those the rules already allow, and `null` means none this session; the pet route refuses its static siblings (`checkins`, `launch`) as agent ids. The page now measures the character again when the bottom stack first paints, which removed an intermittent Peek overlap (also reproducible at `3a7304a`).

## Gates

| Gate | Result |
|---|---|
| `npx vitest run src/lib/pet src/lib/studio src/lib/tireh src/lib/circles src/lib/adaptive/notifications src/app/studio/pet "src/app/studio/(studio)/lab"` | 244 files, 4,033 tests: 4,021 passed, 1 skipped, 11 failed, all known sandbox failures, alike in two consecutive runs: 10 `EPERM` on `/tmp` mkdtemp in `guest-rights-http.test.ts`; the load-only timeout in `prepared-conversation-qualification.test.ts` (`file-v2`) |
| Pet unit tests (`src/lib/pet`, `src/app/studio/pet`) | 46 files, 499 passed; 8 of 8 runs under doubled CPU load passed after the measure fix (1 of 6 failed the same way at `3a7304a`); a P7 share test that raced its lazy chunk now waits for the import |
| `node --test scripts/*.test.mjs` | 271 passed, 0 failed |
| Copy lint `node scripts/check-pet-copy.mjs` | 854 strings, 0 violations (en.ts, fa.ts, checkin-copy.ts) |
| `npm run check:pet` | copy lint, copy lint tests, pet unit tests and pet bundle all pass |
| `npx tsc --noEmit` | clean |
| ESLint on the 86 changed and new files | 0 errors, 1 warning (an unused `portrait` in `telegram.ts`, present at `3a7304a`) |
| Humane invariants | `git diff --quiet HEAD -- src/lib/pet/care.ts src/lib/pet/__tests__/care.test.ts` holds; `Dock.test.tsx`, `prompt-layout.test.ts` and `care.test.ts` pass (59 tests) |
| `STUDIO_BOTS=0 next build` | passes |

## Bundle

Measured with `node scripts/check-pet-bundle.mjs` on this candidate's `next build` (brotli quality 11; CSS raw).

| | Measured | Ceiling |
|---|---|---|
| Route JS, `/studio/pet/launch` (the heavier page) | 199,482 B | 200,678 B |
| Route JS, `/studio/pet/[agentId]` | 199,083 B | 200,678 B |
| Engine chunk | 45,490 B | 46,292 B |
| Route CSS | 11,692 B | 12,000 B |

No ceiling changed in Wave C. Recorded ceiling changes, both product calls written into `scripts/check-pet-bundle.mjs`: Wave A raised the engine from 39,784 B to 45,268 B (+1 KB slack) and route JS from 188,384 B to 195,851 B (+1 KB) for motion polish, bilingual strings and the layout classes; Wave B raised route JS to 199,142 B + 1,536 B of slack (200,678 B) for the rooms, tips, hands-free and streamed voice glue. Against Wave B QA's 199,142 B the launch page grew 340 B and the engine 208 B. Everything Wave C adds loads lazily: Closet 1,961 B, Garden 1,854 B, Play with Guess 3,721 B, Life Book 2,540 B, the asks and share chunk 10,199 B, the share card 1,094 B (all brotli, each under the 12 KB room-chunk gate).

## Flags and defaults

| Variable | Default | Meaning |
|---|---|---|
| `STUDIO_TTS_PROVIDER` | `eleven` | `gemini` switches the pet's speech to Gemini; an invalid value falls back to `eleven` with one warning |
| `GEMINI_API_KEY` | unset | Gemini speech key (`GOOGLE_API_KEY` when unset); without either, replies stay text under `gemini` |
| `STUDIO_GEMINI_TTS_MODEL`, `STUDIO_GEMINI_TTS_VOICE` | unset | model and voice overrides for the Gemini adapter |
| `ELEVENLABS_LIVE_TTS_MODEL` | `eleven_flash_v2_5` | live-call speech model |
| `OPENAI_STT_MODEL` | `gpt-4o-mini-transcribe` | transcription model |
| `STUDIO_PET_DECISIONS` | `off` | `shadow` asks Decisions and logs `pet-v1` rows beside the local ranker; `on` consumes calibrated answers only |
| `STUDIO_PET_DECISIONS_CALIBRATED` | unset | `question:language` pairs that passed calibration (200 labelled examples each); none has |
| `STUDIO_PET_CHECKINS` | `off` | master switch; off means nothing is ever sent and the page never asks P1 |
| `STUDIO_PET_CHECKINS_TRIGGER_SECRET` | unset | bearer secret (32+ characters) for `POST /api/studio/pet/checkins/run`; unset, the route answers 404 |

## Sign-off before enabling

- **Check-ins:** the privacy owner signs off the check-in DM text and payloads (`ci.*`, `perm.P1.*`; the P1 copy is hashed into the consent evidence) before `STUDIO_PET_CHECKINS=on`.
- **Mourning days:** HOOR checks the table in `src/lib/pet/mourning-days.ts` against the official Iranian calendar (its lunar dates are `verified: false`, which also quiets the neighbouring days) and extends it before the next Persian year.
- **Gemini speech:** the Persian TTS bake-off result before `STUDIO_TTS_PROVIDER=gemini` becomes anyone's default.
- **Microphone notice:** legal confirms the UX-02 provider facts (processing locations and retention, PRIV-039); until then the sheet names the provider and points at Privacy.
- **Decisions `on`:** each question and language passes the calibration gate first.

## Known gaps

- Visits are not built: P10 records the person's yes as the `visitsOpen` flag only.
- Keepsakes are earned only; there are no keepsake payments.
- Check-ins C5 (bloom not seen yet) and C11 (a Guess left mid-way) cannot fire yet: a bloom happens while the person is on the page, and the server keeps no mid-game record.
- The `task` growth kind has no lighting path yet.
- The speech provider is one for the whole deployment, not per agent.

## Device checklist

1. No scrolling at Peek, Short, Regular, Tall and Wide, in English and Persian (RTL mirrored), on iOS and Android Telegram.
2. First paint: Telegram's loader hands straight to the character, which stands clear of the dock and the safe areas, including fullscreen.
3. Low-end Android: the lite tier holds p95 frame time at 33 ms or less; reduced motion is honoured.
4. Persian lines fit their limits in Vazirmatn (the ten flagged keys); system lines show Persian digits; Latin names stay in isolates.
5. A spoken turn is answered as speech, never "I'm reading your text".
6. Hold-to-talk after the UX-02 sheet; the sheet names the provider.
7. Hands-free on iOS and Android Telegram: it hears, sends at the end of speech, turns off after a quiet minute, and barge-in stops the pet's voice on the speaker; where the WebView cannot, hold-to-talk remains.
8. Streamed sentences play in order with lip-sync on ElevenLabs; Gemini only on a test deployment with the flag.
9. Play: Starfall by drag and arrow keys, zen with no timer, pips with no digits; Bop's pips.
10. Bedroom lamp and tuck-in; quiet hours put the pet to sleep and nothing drops.
11. Life Book swipes the right way in RTL; "remember this" and its confirm step light a taught moment.
12. Garden: plant either seed, water on different days, bloom with the Bloom pin; Breathe runs and ends calmly.
13. Closet: the overlay changes this screen only; the creator's look tab asks first, then changes the bot's photo; a member and a group launch see no look tab.
14. Guess my word: the Persian opener goes out in Persian, a pip per answer, give up, zen hint, resume after leaving, the best page.
15. With check-ins off, P1 never shows. On a test bot with them on: P1 at the end of a second-day session, Choose moments, then P2 over a group launch.
16. On that test bot: a silent check-in DM; Open replays its moment instead of the hello; Why this? explains; Stop these and Stop all work; nothing arrives between 21:00 and 08:00 local.
17. P7 share (Telegram share, story or the copy fallback), P8 home-screen shortcut on Telegram 8.0+, P9 and P10 each once per their rules.
18. pet_action: "time for bed" taps the moon only after the reply has been said; "let's go to the garden" switches room.
19. A guest of a public agent sees no growth, no asks and no look tab, and talk opens the DM.
20. On a slow or failed strings chunk the page paints in English, then switches language; Retry recovers offline.

## OpenAI deprecations

OpenAI removes `tts-1`, `tts-1-hd` and `gpt-4o-mini-tts` on 6 January 2027, so OpenAI stays out of speech synthesis. It removes `gpt-4o-mini-transcribe`, the default `OPENAI_STT_MODEL`, on 26 February 2027; the replacement is `gpt-transcribe`. The variable allows the switch without a code change, but the default must move, and the Persian transcription quality be rechecked, before that date.

## Upgrade

Installing this candidate follows `docs/PRODUCTION.md` §Mac Studio release: commit the release, run that section's validation and build on the exact revision, then upgrade against the approved present baseline (`--expect-current`, `--expect-revision`, `--expect-build`), never `--expect-absent`. The new variables above are optional and default off; set any of them only in the owner-only production configuration file, never in chat, commits or service plists, and only after its sign-off. No migration is needed: the play, growth and check-in records are new, content-free stores on the existing erasure epoch. Rollback keeps the current deletion and rights state. Nothing in this note was run against production.

## فارسی

این یک نامزد انتشار است، نه انتشار مستقرشده: چیزی نصب نشد، هیچ پرچم تولیدی تغییر نکرد و پیامی به کسی نرسید. موج A (`6c722cd`) پایه‌ها را ساخت: ذخیرهٔ بازی، رفع حالت صوتی، رشته‌های دوزبانه، چیدمان بدون اسکرول و حرکت. موج B (`3a7304a`) اتاق‌ها، لحظه‌های رشد، حالت بدون دست، پخش جمله‌به‌جمله و آداپتور گفتار Gemini را افزود. موج C (ثبت‌نشده) باغچه، کمد، بازی «کلمه‌ام را حدس بزن»، پرسش‌های P1، P2 و P7 تا P10، پیام‌های سرزدن و اتصال Decisions را آورد.

همهٔ دروازه‌ها گذشتند؛ تنها ۱۱ شکست شناخته‌شدهٔ محیط آزمون باقی است. اندازهٔ صفحه ۱۹۹٬۴۸۲ بایت، موتور ۴۵٬۴۹۰ بایت و CSS برابر ۱۱٬۶۹۲ بایت است و در این موج هیچ سقفی بالا نرفت. سرزدن‌ها، Decisions و گفتار Gemini به‌طور پیش‌فرض خاموش‌اند. پیش از روشن‌کردن آن‌ها تأیید مسئول حریم خصوصی برای متن پیام‌ها، بررسی جدول روزهای سوگواری توسط HOOR، نتیجهٔ مقایسهٔ گفتار فارسی و تأیید حقوقی دربارهٔ ارائه‌دهندهٔ صدا لازم است. دیدوبازدید، پرداخت یادگاری‌ها، سرزدن‌های C5 و C11، نوع رشد `task` و انتخاب ارائه‌دهندهٔ گفتار برای هر همکار هنوز ساخته نشده‌اند.

## Deployed

PR [126](https://github.com/mohammadreza87/vox/pull/126) merged into `main` as `baae9494` on 26 October 2026; the deployed head is `6c1577e39df37b62eea47d163fbf9c16a87b5b6e` (main after PRs 125, 126 and 121), source tree `296a0dbde2b9b34314269dd15af79d70d637e331`, build `5slDUJoLKa25wVDqsvXQj`, built 18:39 UTC and installed on the Mac Studio polling runtime at 18:41 UTC with a stopped-process backup at `backups/2026-10-26T18-41-46-954Z`. The previous release was `5444cfb2` (build `EBqoCQPe_ya6dvZY2b-c_`).

Before installing, the revision was verified locally: `tsc --noEmit` clean, 715 pet tests passing, copy lint clean across 854 strings, `next build` passing, bundle under every ceiling. Preflight passed for all providers. One build attempt in the root checkout failed with a webpack hasher crash until the stale `.next` cache was deleted; the rebuild verified the same revision.

Public verification after install: `/api/studio/health` returns the deployed revision with `bots: true`; `/` redirects to `/studio`; `/studio` and `/studio/pet/launch` load; `/api/studio/me` answers 401 without initData; `/api/chat`, `/api/telegram/payments`, `/api/convai/session` and `/_next/image` answer 404; an unauthenticated POST to `/api/studio/pet/checkins/run` answers 404 because no trigger secret is configured.

No pet flag was set: `STUDIO_PET_CHECKINS`, `STUDIO_PET_DECISIONS` and `STUDIO_TTS_PROVIDER` keep their defaults, so this release changes the pet's rooms, motion, strings and voice-mode fix for everyone and sends nothing new to anyone. The device checklist above and the sign-offs listed under "Needs sign-off" remain open; no authenticated Telegram journey, real voice turn or device test was performed as part of the install.

### فارسی

درخواست ادغام ۱۲۶ در `main` ادغام و نسخهٔ `6c1577e3` در ۲۶ اکتبر ۲۰۲۶ ساعت ۱۸:۴۱ UTC روی اجرای Mac Studio نصب شد. مسیر سلامت همین نسخه را با ربات‌های فعال گزارش می‌دهد و مسیرهای قدیمی بسته‌اند. هیچ پرچم مربوط به حیوان خانگی (پیام‌های سرزدن، Decisions، صدای Gemini) روشن نشده است. فهرست آزمون روی دستگاه و تأییدهای لازم همچنان باز هستند.
