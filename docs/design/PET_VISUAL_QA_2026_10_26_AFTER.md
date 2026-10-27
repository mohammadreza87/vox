# Pet care game: visual re-audit after the polish wave, 27 Oct 2026

Build: `polish/pet-visual-qa` at `89af6ea3` (polish wave `fc135efc` plus the `?at=` demo clock), served locally in mock mode at `http://localhost:3100/studio/pet/demo?mock=1&at=14`. I walked it in the desktop app's built-in browser. I did not change any product code. This re-checks the 30 defects in `PET_VISUAL_QA_2026_10_26.md` (Part B).

Screenshots are in `docs/design/pet-visual-qa-2026-10-26/after/`, saved so that 1 image px = 1 CSS px. Earlier screenshots for comparison are one folder up.

## Verdict

The wave fixed most of what made the build look unfinished. Sheets now show their whole question, with equal one-line buttons and no focus ring on open. The rail sits at y 634 in all six rooms at 390×844. The talk pill's focus follows its shape. Persian is at parity: «موچی», Persian replies, «…», no empty bubble. The guards hold: the moon ends a ball round cleanly, guests see no days chip, and the welcome line is about the pet's own world.

It is not clean yet. I would not ship two things:

1. **The C5 "it bloomed" replay.** The line "It bloomed! We did that." plays for about 5 s over an empty garden. The pot only appears with the next line (checked in the DOM).
2. **Tips interrupt play.** A tip bubble opens over an active ball round.

Three leftovers are still visible at a glance:
- The Regular and Tall stages keep a band of about 200–230 px with nothing in it between the pet's shadow and the rail.
- Play uses the same backdrop as Home.
- Room props still sit at the pet's feet, and the Bedroom dock mixes line icons with an illustrated one.

**Counts:** 22 fixed, 6 improved but not clean, 2 not fixed, 0 unchecked (P-27 is only partly checkable on localhost).

## Status per defect

| ID | Status | What I saw | Screenshot |
|---|---|---|---|
| P-01 | Fixed | The paused note's title is three lines with the whole question: "I paused my messages; they weren't landing. Want them back?" The buttons are 159×46 each and stay on one line. Focus goes to the dialog, with no ring. | `en-390-checkins-paused-full-title` |
| P-02 | Fixed | Moon tapped mid-round: the pips fade, the ball parks and the pet sleeps with a clear HUD. | `en-390-asleep-hud-cleared` |
| P-03 | Fixed | On focus the pill gets a 1 px volt border at a 999 px radius, with no square outline. Typed text has 6 px of inner padding. Hands-free swaps to the send button. A long sentence scrolls inside the pill. | `en-390-talk-typing-long`, `fa-390-talk-focus-typing` |
| P-04 | Improved | Garden is green with a horizon, Closet a neutral grey, Bedroom a plum night with stars, and Life Book sepia. All four read as places, and the Bedroom reads as night. Play still uses Home's teal backdrop (`roomLight.ts` covers only the four away rooms). In the middle of a cross-fade, the new room's warm floor pool lights up on the old teal backdrop for a frame or two. | `en-390-bedroom-night`, `en-390-play-room`, `en-390-room-switch-mid-crossfade` |
| P-05 | Fixed | The rail's top edge is at y 634 in Home, Play, Garden, Closet, Bedroom and Life Book at 390×844, and at y 442 in Play and Closet at 360×640. | (measured) |
| P-06 | Fixed | Three games evenly spaced on 98 px cells (33–327 at 360, 65–325 at 390). Labels are one line in both languages. Zen is a top-corner chip. See new defect N-6 for the corner. | `en-360-play-dock`, `fa-360-play-dock-zen-mirrored` |
| P-07 | Improved | `garden=seeded` (a sprout in a pot) and `garden=bloom` (a pink bloom in a pot) differ clearly. The pot stands in front of the pet and is readable. The C5 replay is still wrong: the bloom line is on screen from 1.1 to 6.3 s, and no `[data-detail^="garden:"]` node exists until 7.3 s, when the room-visit line arrives. On its own, `ci=C5` (with no garden knob) shows no pot and no bloom line. | `en-390-garden-seeded`, `en-390-garden-bloom`, `en-390-ci-c5-bloom-line-no-pot`, `en-390-ci-c5-pot-after-line` |
| P-08 | Improved | C5 (with `garden=bloom`) says "It bloomed! We did that." and holds it before "We found the Garden together". Stage-up says "Look what I've learned so far!", but "Hi!" flashes for about 0.9 s before it. | `en-390-stageup-learned-line` |
| P-09 | Fixed | The room-visit lines now read "We found the Play room together", "We found the Garden together", and so on. | `en-390-play-room` |
| P-10 | Fixed | The segmented control is on its own row. Six illustrated cells per page with page dots, and the Head/Neck/Hand slot row in the dock. At 390 the tray covers only the pet's shadow. At 360 it covers about 20 px of the body (see N-3). | `en-390-closet-items`, `fa-390-closet-items` |
| P-11 | Improved | Tabs are one line and illustrated in both languages ("Learned", «آموخته‌ها»). The page is a cream card with art on the left and text on the right, not a two-page spread. With one page, the hidden ‹ › row still reserves about 40 px of empty dark tray under the card. | `en-390-lifebook-pages-empty-pager-band`, `en-390-lifebook-keepsakes`, `fa-390-lifebook-single-card` |
| P-12 | Fixed | The placeholder is «با ⁨موچی⁩ حرف بزنید…»: Persian name, bidi-isolated, with a real ellipsis (U+2026). | `fa-390-home-hello` |
| P-13 | Fixed | «روزت چطور بود؟» gets the reply «خوب بود! پرش تمرین کردم و ابرها رو تماشا کردم.» | `fa-390-talk-reply-persian` |
| P-14 | Fixed | No empty bubble on entering the Life Book (sampled every 30 ms). The room line is Persian: «دفتر خاطرات رو با هم کشف کردیم». | `fa-390-lifebook-single-card` |
| P-15 | Fixed | Persian 360×640: both buttons are 144×46 on one line. The title breaks in two balanced lines, ending «استفاده می‌کنید؟». «حریم خصوصی و حافظه» is underlined in volt. | `fa-360-mic-sheet-one-line-buttons` |
| P-16 | Fixed | Fresh load: "Hi!" at 3 s, the first tip at 24 s. Sampled over 30 s, the speech bubble never overlapped the thought bubble. | `en-390-home-open-thought` |
| P-17 | Improved | The pet is larger: 250 px wide at 390 (it was 200) and about 275 px at 430. Its floor line barely moved: the shadow is at y 435 at 390 (it was 425) and y 492 at 430. That leaves 200 px at 390 and 230 px at 430 between the shadow and the rail, where only the days chip sits. | `en-390-home-open-thought`, `fa-430-home-lower-band` |
| P-18 | Fixed | During a ball round the bubble's centre x tracks the body's centre x within 1 px (76 samples). | `en-390-ball-round-tip-interrupts` |
| P-19 | Fixed | Home → Play → Garden → Bedroom and the C5 replay switch: the dock row kept its three buttons throughout (sampled every 8 ms). The old dock dims while the new one comes in. | `en-390-room-switch-mid-crossfade` |
| P-20 | Fixed | Persian load at 390: the pill is 358 px at the first sample. The Layout Instability API recorded no shifts. | (measured) |
| P-21 | Fixed | `welcome=1`: "Hi!", then "You're here! I collected some cloud fluff for you." | (bubble log) |
| P-22 | Fixed | Guest: no days chip. "Chat in Telegram" is full width (358 px). | `en-390-guest` |
| P-23 | Not fixed | The Bedroom dock still pairs line-icon Lamp and Story with an illustrated Moon. Garden (Seed, Rain, Breathe) is all line icons, while Home and Play are illustrated. | `en-390-bedroom-night` |
| P-24 | Improved | The Closet bow is worn on the head. Room keepsakes still stand at the pet's feet: a star at the left foot in Play, a book in Life Book, a moon in Bedroom. After a few room visits the Bedroom shows a flower, a moon and a star crowding both feet. | `en-390-play-room`, `en-390-lifebook-keepsakes` |
| P-25 | Fixed | English mic sheet: focus goes to the dialog with no ring. "Privacy and memory" is underlined in volt. | `en-390-mic-sheet` |
| P-26 | Fixed | At 768×1024 the rail spans x 16–123, 21 px left of the 480 px column (x 144–624). Rail type is 14 px and the pet is about 440 px wide. | `en-768-home-side-rail` |
| P-27 | Not fixed | "[Telegram.WebApp] DeviceStorage is not supported in version 6.0" is still logged as an error on every load. I could not check the Cloudflare beacon's CSP on localhost. | n/a |
| P-28 | Fixed | The bubble box is laid out at its final size and the text types inside it: a mid-type frame shows "Plant something with / me? It grows" in the full box. Its offset size stays constant per line. | `en-390-ball-round-tip-interrupts` |
| P-29 | Fixed | The whole bottom stack is `visibility: hidden` behind the paused note and the mic sheet alike. | `en-390-checkins-paused-full-title`, `en-390-mic-sheet` |
| P-30 | Fixed | "How was your day?" gets "Pretty good! I practised my hop and watched the clouds. How was yours?" | (bubble log) |

## New defects

| ID | Sev | What | Area | Screenshot |
|---|---|---|---|---|
| N-1 | major | A tip ("Plant something with me? It grows while you're away and never wilts.") opens during an active ball round, over the pips. It also fired in the same beat as a moon tap. The round does not count as busy for tips. | `tips.ts` / `tipOpen.ts`, PetApp's busy flags for rounds | `en-390-ball-round-tip-interrupts`, `en-390-moon-tap-tip-over-round-hud` |
| N-2 | minor | Stage-up says "Hi!" for about 0.9 s before "Look what I've learned so far!". The hello is not skipped when a stage-up is the open event. | `PetApp.tsx` open sequence (`stageUp`) | `en-390-stageup-learned-line` |
| N-3 | minor | Closet at 360×640: the tray (top y 246) covers about 20 px of the pet's lower body and its shadow, so the pet looks sunk into the panel. The days chip at y 325 showed through the 91 % opaque tray as "4 da… ether" behind the Specs cell. | `rooms/rooms.css` (`.pet-tray`), the days chip in `PetApp.tsx` (hide in tray rooms) | `en-360-closet-tray-covers-pet-chip-bleeds` |
| N-4 | polish | Life Book with one page: an empty band of about 40 px under the card, because the hidden ‹ › pager row keeps its height. | `rooms/BookRoom.tsx` | `en-390-lifebook-pages-empty-pager-band` |
| N-5 | polish | Bubbles leave one word alone on the last line: "wilts.", "that.", «نمی‌شه.», «کردم.». The box is now laid out once, so balanced wrapping (`text-wrap: pretty` or a measured balance) would fit. | `Bubble.tsx`, `fx.css` | `en-390-home-tip-orphan-word`, `fa-390-talk-reply-persian` |
| N-6 | minor (risk) | The Zen chip sits 6–8 px from the top corner: top-left in English, top-right in Persian. In Telegram fullscreen both top corners carry Telegram's own controls, so the chip needs the content safe-area inset. The mirror itself reads naturally in Persian. I could not check this inside Telegram. | `rooms/PlayRoom.tsx` (`.pet-zen`), safe-area insets | `en-390-play-room`, `fa-360-play-dock-zen-mirrored` |
| N-7 | polish | In the Closet the speech bubble's tail sits on the worn bow, half hiding it. The slot row files the bow under "Neck" while it is drawn on top of the head. | `Bubble.tsx` anchor (clear head accessories), `ClosetRoom.tsx` slot naming | `en-390-closet-items` |
| N-8 | polish | Mid cross-fade, the new room's floor pool appears on the old room's backdrop: a warm olive band over the Home teal. | `Stage.tsx` (fade the floor pool with the backdrop), `roomLight.ts` | `en-390-room-switch-mid-crossfade` |
| N-9 | polish (mock) | `ci=C5` without `garden=bloom` replays nothing: no pot and no bloom line, only the room-visit line. The mock knob should seed a bloomed garden. | `_ui/mock.ts` | n/a |

## What I could not check

- **Real Telegram:** fullscreen corner controls (for N-6), safe areas, BackButton, haptics, theme, and the header and bottom-bar room colours. Outside Telegram the SDK reports version 6.0 and refuses the colour calls. It logs `web_app_set_bottom_bar_color {color: #ffffff}`, which needs checking on a device.
- **Timing and motion:** the browser pane is often hidden, and a hidden page does not paint until a screenshot is taken. So I measured the open sequence, bubble overlap, the dock during room switches and the pot timing in the DOM (30 ms samples), not from video. I caught one mid-cross-fade frame; I could not judge the smoothness of the 320 ms fade. I did not check reduced motion.
- **Cloudflare beacon CSP:** it does not load on localhost.
- **Coverage gaps:** English at 430×932 (Persian checked), Persian at 768×1024, the Persian paused note at 360 (fine in the first QA), full Starfall, Bop and Guess rounds, the closet try-on, voice, and the `private` and `outside` roles.
