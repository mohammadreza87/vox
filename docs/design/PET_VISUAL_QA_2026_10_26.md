# Pet care game: visual QA, 26 Oct 2026

Reviewer stance: senior product designer, visual and interaction quality only. Two parts:

- **Part A:** the design artifact "Vox Pet Care Game" (https://claude.ai/artifact/Wsb8vcwQjbxPBm39SN4Fvd). I cleaned it in place and republished it to the same URL (versions 24 to 26).
- **Part B:** the live app in mock mode (https://vox.joyixir.com/studio/pet/demo?mock=1), walked in the desktop app's built-in browser. I did not change any product code.

Screenshots are in `docs/design/pet-visual-qa-2026-10-26/`. They were captured at device scale and saved at half size, so 1 image px = 1 CSS px. Prefixes: `en-`/`fa-` is the language, then the viewport width.

---

## Part A: design artifact, changes per board

Why it read as "not clean": the Hafez card was not the only visible draft marker. Eleven bracketed or editorial markers were live on the artboards:

- `[A curated Hafez line…]`
- `[existing /start welcome, unchanged]`
- five orange "FA: copywriter" labels
- `[FA: copywriter]` and `[FA]` inside the Persian talk pill
- raw `{audio_providers}` / `{processing_locations}` / `{verified_audio_retention_summary}` template variables in the mic sheet
- a dashed "Telegram's prompt appears here" placeholder box

Three boards had Persian captions that rendered left-to-right in a Latin fallback font. Other problems: a caption block in the wrong order, ragged right margins on two boards, a second type scale on one board, and preview sizes that did not match their frames. The persuasive content was fine. The finish was not.

Every Persian line I added comes verbatim from the copywriter's keys in `docs/design/PET_COPY_KEYS_2026_10_26.md` and `PET_PERSIAN_COPY_2026_10_26.md`, so nothing was translated by me.

| Board | Change |
|---|---|
| **6 · Seasons** | The Hafez placeholder is replaced with a real public-domain couplet, set as a right-to-left `blockquote` verse card: «یوسف گم‌گشته بازآید به کنعان غم مخور / کلبهٔ احزان شود روزی گلستان غم مخور». I chose it over «الا یا ایها الساقی» because the card's reading, "something sweet is on its way", only makes sense after a hopeful verse; the first ghazal is about love turning hard. The caption marks it "Sample verse, editor to choose". The fal card used to sit over the room rail and half the dock (it was anchored 120 px from the bottom). The dock now steps aside while the card is open, and the card sits just above the talk pill. The repeated caption sentence is removed. The haft-sin table is now right-to-left and has all seven sin items (سنجد and سماق added; it showed five). Board height is now 1300 (see below). |
| **Screen component (PetScreen)** | The Persian hands-free pill showed `[FA: copywriter]` and `[FA]`. These are replaced with «در حال شنیدن» and «میکروفون باز» (keys `voice.listening` and `voice.handsFree`). This fixes every board that imports the screen in Persian. |
| **1 · First open** | The Telegram welcome bubble no longer reads `[existing /start welcome, unchanged]`. It shows three grey text lines instead, and the "unchanged" note moved into the caption. "FA: copywriter (new key)" is replaced with `growth.intro` Persian. Notes now share one muted note style with a hairline. The preview size was 1720 wide while the frame is 2120; it is now 2120. |
| **2 · Daily loop** | Three "FA: copywriter" markers are replaced with the copywriter's Persian: `growth.stage.learned` / `.ready`, `growth.confirm.ask` / `.yes` / `.no`, and `growth.lit.chip` plus the why line. The code reference is styled as a note. The preview size was 2120 against a 2920 frame; fixed. |
| **5 · Bedroom, Life Book** | The FA marker is replaced with `growth.tab` «از شماها یاد گرفتم» and `growth.unlit.label` «هنوز در راه». |
| **14 · Voice** | Two "FA: copywriter" markers are replaced with P3b Persian (title, yes, no) and `voice.*`, including the copywriter's warning not to use «هندزفری», which means earphones in Iran. |
| **8 · Permissions** | The P3 mic sheet body showed raw template variables. It now reads "Your audio is sent to our speech providers to transcribe and answer your request…", which is close to the live sheet. A caption note says the live sheet fills providers, locations and retention from the privacy record. The dashed placeholder box over the P2 screen is removed; its explanation moved into a caption note. Persian captions now render right-to-left in Vazirmatn (the `.fa` style was missing). Height is 1300. |
| **7 · Check-ins** | Column 2 had its kicker and title at the bottom of the caption; they are now at the top like every other column. The rules column is 540 wide (was 500), which closes a 40 px ragged right margin. Height is 1300. |
| **9 · Tips, 10 · States** | Persian captions were left-to-right in the Latin font because the `.fa` style was missing; they are now right-to-left in Vazirmatn. Tips height is 1300. |
| **11 · Layout** | The caption type scale now matches the other boards (13/19 body, 17/23 title, 6 px gap; it was 13/18, 16/22, 5 px). Side padding is 80 like the other boards (was 60). Width is 2680 (was 2760), which removes 120 px of empty space on the right. |
| **Canvas layout** | Row 4 (Seasons, Check-ins, Permissions, Tips) is 1300 tall so long captions and footers cannot clip. I estimated the Permissions captions at 30–60 px past the 1200 frame. Rows 5 and 6 moved down 100 px to keep the same 100 px gap under each row. |

**Read-back:** I read version 25 back and scanned the visible text of every board. No `[…]`, `FA:`, `TODO`, `TBD`, lorem or `{variable}` text is left in the UI. The only `{…}` left are the screen component's own template slots. Version 26 adds only the right-to-left style.

**Left as is (judgement calls):**
- Boards with a rules row (Daily loop, Permissions, Tips, Voice) keep 40 px top padding against 48 elsewhere. Matching them would push captions out of the frame.
- The overview's fourth principle card has two paragraphs against one on the others.
- Layout and Voice pass `face="listening"`, which the character component does not define, so it renders the idle face. It is invisible but should be added to the component's options.
- The Tips coach chip covers two dock toys. That is how a coach mark works, so I kept it.

---

## Part B: the live app, mock mode

The page renders outside Telegram in mock mode. The Telegram SDK falls back to version 6.0 and logs warnings, which is expected outside Telegram.

**What works and should be kept:**
- The idle blink and breath read well (`en-390-home-idle-a` and `-b-blink`, one second apart).
- Feeding has a real chew with crumbs (`en-390-home-feed-chew`).
- The welcome-back hop has a convincing squash.
- At 360×640 the rail collapses to icons plus the active label, as designed.
- Persian mirrors the rail and dock correctly, uses Persian digits («۴ روز رفاقت») and fits the paused note.
- The tablet side rail exists.

**Defects.** Severity: blocker means it breaks the moment, major means it is visibly unclean or contradicts the design, minor means it is noticeable, polish means only a designer would notice.

| ID | Screen | Viewport | Sev | What is wrong | What clean looks like | Suggested fix (area) | Screenshot |
|---|---|---|---|---|---|---|---|
| P-01 | Check-in paused note | 390×844 EN | blocker | The title is cut to two lines, so the question disappears: "I paused my messages since they weren't landing. Want…" | The whole question is readable. Sheets never truncate the ask. | `_ui/extras.css:5`: `.pet-sheet b` clamps titles to 2 lines. Allow 3 lines, or shorten `ci.paused.title` | `en-390-checkins-paused-title-truncated.jpg` |
| P-02 | Home, dock | 390×844 | blocker | Tapping the moon during a ball round puts the pet to sleep, but the round's pips (4/10) and the ball stay frozen on screen over the sleeping pet. | Sleep ends or pauses the round and clears its HUD. Or the moon is disabled during a round. | `PetApp.tsx` / `Dock.tsx`: the ball round's state and the sleep action | `en-390-home-asleep-with-ball-hud-stuck.jpg` |
| P-03 | Talk pill, focused and typing | 390×844 | major | A square 2 px volt outline appears inside the round pill. While typing, the start of the text is clipped and the pill's shape breaks around the input box. | The focus state follows the pill's radius (border colour change). The text scrolls inside the pill with padding and is never clipped against the edge. | `pet.css:23`: the global `:focus-visible` outline hits the input. Use `:focus-within` on the pill; `TalkPill.tsx` input padding | `en-390-talk-focus-square-ring.jpg`, `en-390-talk-typing-clipped.jpg` |
| P-04 | All rooms | all | major | Home, Play, Garden, Closet, Bedroom and Life Book share the same teal backdrop. Only the dock changes, so rooms do not read as places, and the Bedroom is not night. | Each room has its own backdrop and light (the design swaps the backdrop per room; Bedroom is dark and warm). | `scene.ts` / `rooms/*Room.tsx`: per-room backdrop tokens | `en-390-bedroom.jpg`, `en-390-garden-bloom.jpg` |
| P-05 | Room rail | 390×844 | major | The rail jumps between rooms: about y 650 on Home, 630 on Play, 580 on Closet and 590 on Life Book, because the dock or panel height varies. | The rail sits at one fixed height. Room content lives in a fixed-height slot under it. | `layout.ts` / `Dock.tsx`: reserve a constant dock slot; panels open upward from it | compare `en-390-home-idle-a`, `en-390-play-room`, `en-390-closet-items` |
| P-06 | Play dock | 390×844, 360×640 | major | Four items with uneven spacing. Bop and Zen sit 8–13 px from the screen edges. "Guess my word" wraps to two lines and pushes its icon out of line. Zen is a dock item; the design has it as a toggle. | Three evenly spaced games inside 16 px gutters, single-line labels, Zen as the top-right toggle, Guess in talk. | `rooms/PlayRoom.tsx`, `Dock.tsx`, `strings/en.ts` (shorter "Guess" label) | `en-390-play-room.jpg`, `en-360-play-dock-edges.jpg` |
| P-07 | Garden: seeded, bloom and C5 replay | 390×844 | major | The plant is a 12 px flower half-hidden behind the pet's foot. `garden=seeded` and `garden=bloom` look the same. The C5 "it bloomed" replay shows no bloom. | A pot in front of the pet with readable stages (seed, sprout, bloom), as on the design board. The bloom is the hero of the C5 replay. | `rooms/GardenRoom.tsx`: plant size, position and per-stage art | `en-390-garden-seeded.jpg`, `en-390-garden-bloom.jpg`, `en-390-ci-c5-bloom-wrong-line.jpg` |
| P-08 | C5 replay and stage-up | 390×844 | major | The C5 replay's bubble is the room-visit line "We found the garden together", not the bloom line. `stageup=1` bursts sparkles but says only "Hi!". The moment the person was promised has no words. | C5: "It bloomed! We did that." Stage-up: `growth.stage.learned` / `.ready`. The room-visit moment never overrides a replay. | `Asks.tsx` replay (`bloom`, stage cases); the line chosen in `PetApp.tsx` | `en-390-ci-c5-bloom-wrong-line.jpg`, `en-390-stageup-says-hi.jpg` |
| P-09 | Room-visit bubble and chip | all rooms | major (mock) | "We found the play together": the mock builds titles from room ids (`mock.ts:101`). Production `templateMoments` uses "Play room", so this is mock-only, but it is what reviewers see. | Same titles as production. | `_ui/mock.ts:101`: use `templateMoments(lang)` | `en-390-play-room.jpg` |
| P-10 | Closet | 390×844 | major | Two tab levels in one row ("Your closet / Mochi's look" plus "Head / Neck / Hand"), with the last tab against the edge. Items are text-only pills (Glasses, Specs, Beret…) with no thumbnails. It reads as a form. | Segmented control on its own row. A slot row under it. Illustrated item cells (icon plus label), six per page, as on the design board. | `rooms/ClosetRoom.tsx`, `rooms/rooms.css` | `en-390-closet-items.jpg` |
| P-11 | Life Book (EN) | 390×844 | major | "What I've learned" and "About me" wrap to two lines while "Pages" and "Keepsakes" do not, so the tab row is ragged. The page is a dark generic card, not a book. | Single-line tabs (shorter labels or a smaller size). A cream page spread like the design board. | `rooms/BookRoom.tsx`, `strings/en.ts` (`book.tab.*`) | `en-390-lifebook-tabs-wrap.jpg` |
| P-12 | Persian: name | 390×844 FA | major | The name stays Latin inside Persian text: «با Mochi حرف بزنید...», «اولین روزی که با Mochi آشنا شدید.» The placeholder also uses three dots instead of «…». | «با موچی حرف بزنید…». The mock uses «موچی» in Persian; production names stay bidi-isolated. | `_ui/mock.ts` (`NAME` per language), `strings/fa.ts` placeholder punctuation | `fa-390-home.jpg`, `fa-390-lifebook-latin-name.jpg` |
| P-13 | Persian: talk | 390×844 FA | major (mock) | The mock replies in English: "That sounds lovely. Tell me more?" | Persian mock replies in the pet voice. | `_ui/mock.ts:45` | `fa-390-talk-reply-in-english.jpg` |
| P-14 | Persian: room entry | 390×844 FA | major | An empty white speech bubble flashes on room entry and disappears. The mock's moment titles are English-only. | No bubble without text. Persian titles. | `Bubble.tsx` (skip empty text), `_ui/mock.ts` moments | `fa-390-lifebook-empty-bubble.jpg` |
| P-15 | Mic sheet (Persian) | 360×640 FA | major | The primary label «استفاده از میکروفون» wraps to two lines, so the two buttons have different heights. The title's last word «می‌کنید؟» sits alone on line 2. | Equal one-line buttons: a shorter label or a smaller size in Peek and Short layouts. Balanced title lines. | `extras.css` sheet buttons, `strings/fa.ts` (`perm.P3.yes`) | `fa-360-mic-sheet-button-wraps.jpg` |
| P-16 | First open | 390×844 | major | There is no hello. The first bubble, a few seconds in, is tip T2 ("My tummy is ticklish. Just saying."), and the speech bubble touches the cookie thought bubble. | Hello first ("Hi Sara!"). No tip in the opening seconds. Speech and thought bubbles never overlap. | `PetApp.tsx` open sequence, `tips.ts` timing, bubble/thought placement | `en-390-first-open-bubble-thought-collide.jpg` |
| P-17 | Stage composition | 390×844, 430×932 | major | The pet sits high, leaving about 200 px of dead stage above the rail. At 430×932 the pet does not grow, and the bottom cluster is narrower than the screen. 360×640 looks balanced by comparison. | The pet's floor line sits about 60% down the free stage. The Tall layout scales the pet up (design: up to 520). Bubbles have room above. | `scene.ts` (pet size and position per layout) | `en-390-home-idle-a.jpg`, `en-430-home-dead-space.jpg`, `en-360-home.jpg` |
| P-18 | Bubble anchoring | 390×844 | minor | During the ball round the "Yum!" bubble stays put while the pet travels right. | The bubble follows the head anchor, or is suppressed while the pet travels. | `Bubble.tsx` anchor | `en-390-home-yum-bubble-detached.jpg` |
| P-19 | Room switch | 360×640, 390×844 | minor | For about a second after entering a room the dock is missing, and the rail floats over an empty band. | The dock cross-fades in place. | `Dock.tsx` lazy room chunk; keep the old dock until the new one is ready | `en-360-play-dock-missing-on-entry.jpg`, `en-390-ci-c5-dock-missing.jpg` |
| P-20 | Talk pill on load (FA) | 390×844 FA | minor | The pill first renders narrow, then jumps to full width when the hands-free toggle mounts. | Full width from the first frame. | `TalkPill.tsx`: reserve the toggle's width | `fa-390-home-pill-narrow-latin-name.jpg` vs `fa-390-home.jpg` |
| P-21 | Welcome back | 390×844 | major (copy/privacy) | The line is "I kept thinking about your trip to Shiraz.", taken in the mock from a group memory note. The spec line is "Hi again! I practised my best hop."; it never refers to the absence and never surfaces private context on open. | A souvenir line about the pet's own world. | `_ui/mock.ts:135`. Confirm the server's welcome souvenir never draws on memory | `en-390-welcome-back-memory-line.jpg` |
| P-22 | Guest view | 390×844 | minor | A guest sees the "4 days together" chip, which is the owner's relationship count. "Chat in Telegram" hugs its text (196 px) while every other bottom control is full width. | No days chip for guests. A full-width button. | `PetApp.tsx` chip for guest role, guest pill style | `en-390-guest.jpg` |
| P-23 | Dock icon style | Garden, Bedroom | minor | Home uses illustrated toys; Garden and Bedroom use thin line icons; Bedroom mixes line Lamp and Story icons with an illustrated Moon. | One illustration style across every dock. | `Dock.tsx` / room icon set | `en-390-bedroom.jpg` |
| P-24 | Room prop placement | all rooms | minor | Each room puts a prop (star, flower, bow, moon, book) at the cloud's bottom-left foot. It reads as a dropped object, and the Closet bow is not on the head. | Accessories sit on the body (bow on the head). Room props are placed in the scene, not on the pet. | `Details.tsx` / room props | `en-390-closet-items.jpg` |
| P-25 | Mic sheet (EN) | 390×844 | polish | The primary button shows a focus ring as soon as the sheet opens (touch users see a double outline). "Privacy and memory" looks like plain text, not a link. | No focus ring for pointer or touch users. A link-styled reference. | `extras.css`, `Extras.tsx` initial focus | `en-390-mic-sheet.jpg` |
| P-26 | Tablet | 768×1024 | minor | The side rail is pinned to the far left edge, far from the 480 px column. Rail text is 12 px on a tablet. The pet is small for the space. | The rail docks to the column's side. Type is 14–15 px. The pet scales with the column. | `layout.ts` wide class, `rooms/RoomRail.tsx` | `en-768-home-side-rail.jpg` |
| P-27 | Console | all | polish (eng) | The Cloudflare Insights beacon is blocked by the CSP on every load. Outside Telegram, "DeviceStorage is not supported in version 6.0" is logged as an error. | A clean console. | CSP `script-src` (add the beacon host or disable the beacon); guard the DeviceStorage call by Telegram version | n/a |
| P-28 | Bubble typewriter | all | polish | The bubble box grows as each character types, so the frame jitters ("We foun…", "Just s…"). | Measure the final size first, then reveal the text inside a fixed box. | `Bubble.tsx` | `en-390-closet-items.jpg` |
| P-29 | Sheets: rail visibility | 390×844 | polish | The paused note leaves the room rail visible above the sheet; the mic sheet hides it. | One rule for every sheet. | `Extras.tsx` / `Asks.tsx` | `en-390-checkins-paused-title-truncated.jpg`, `en-390-mic-sheet.jpg` |
| P-30 | Mock talk reply | 390×844 | polish (mock) | "How was your day?" gets "That sounds lovely. Tell me more?" Reviewers read this as the pet not listening. | Mock replies that fit the common opening questions. | `_ui/mock.ts:45` | `en-390-talk-reply.jpg` |

---

## Top 10 "make it clean", by impact

1. **Sheets never truncate or wrap their ask** (P-01, P-15). Allow a 3-line title or shorten it, and keep buttons to one line in Peek and Short layouts. The paused note currently hides its own question.
2. **One stable bottom stack** (P-05, P-19, P-20). Give the dock a fixed-height slot so the rail stops jumping between rooms, cross-fade the dock on room change, and render the pill at full width from the first frame.
3. **Fix the talk pill's focus and typing state** (P-03). The focus ring should follow the pill shape, with no square outline and no clipped text.
4. **Rooms look like places** (P-04). Give each room its own backdrop and light, and make the Bedroom night. Today only the dock changes.
5. **Payoffs are visible and spoken** (P-07, P-08). Add a real pot and plant with readable seed, sprout and bloom stages. C5 shows the bloom with its own line, and the stage-up says what it learned instead of "Hi!".
6. **Play dock** (P-06). Three evenly spaced games inside 16 px gutters with single-line labels, and Zen as the toggle.
7. **Closet and Life Book look like the design** (P-10, P-11). One tab level per row, illustrated item cells, a cream book spread, and single-line tabs.
8. **Persian parity** (P-12, P-13, P-14). Localise the pet's name, give the mock Persian replies and moment titles, and never render an empty bubble.
9. **Open and composition** (P-16, P-17, P-18). Hello first and no tip in the opening seconds. Bubbles never collide and follow the pet. Lower and scale the pet so the Regular and Tall stages are not half empty.
10. **State and copy guards** (P-02, P-21). Sleep ends an active round and clears its HUD, and the welcome-back line never quotes personal memory.

---

## What I could not check

- **Real Telegram:** initData, safe-area insets, BackButton and Close, haptics, `viewportChanged` with the on-screen keyboard, the half-sheet (Peek) launch, and theme colours. All of Part B ran outside Telegram in mock mode.
- **First-paint timing.** The built-in browser pane was hidden, so it does not paint until a tool call returns. The blank-screen times I measured (2.4–4.4 s) are not reliable, and I do not report them as a defect. Measure on a device.
- **Voice:** the mic recording, hands-free listening, speaking states and barge-in. These need real audio. I only checked the mic permission sheet.
- **Not walked:** full Starfall and Bop rounds, drag-to-mouth, the closet try-on, the Guess game, P1, P7 and P8 sheets (they wait for session conditions), the `private` and `outside` roles, reduced motion, and low-end Android performance.
- **Persian not covered at:** 430×932 and 768×1024. Persian was checked at 390×844 and 360×640.
- **Rendering the design artifact.** The canvas needs a claude.ai sign-in in the browser pane, and the Design type's rules say not to self-render. I checked board positions by reproducing the screen component's layout math. Open the canvas once to confirm the Seasons fal card and the taller row 4.
