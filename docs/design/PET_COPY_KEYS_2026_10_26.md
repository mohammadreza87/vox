# Pet care game: copy keys

Companion to [`PET_CARE_GAME_DESIGN_2026_10_26.md`](./PET_CARE_GAME_DESIGN_2026_10_26.md). Date: 26 October 2026.

**Status.** English is the source of truth for intent. The **FA** column is the Persian copywriter's, copied verbatim from section B of [`PET_PERSIAN_COPY_2026_10_26.md`](./PET_PERSIAN_COPY_2026_10_26.md), written under [`PET_PERSIAN_VOICE_2026_10_26.md`](./PET_PERSIAN_VOICE_2026_10_26.md). Variants and the copywriter's notes are in the last column. Where the copywriter flagged an English intent as wrong for the product, the English was changed and the note says so. Lines that may break a layout limit are kept as written and flagged "Layout check (estimate)". Keys the copywriter proposed are at the end, marked "proposed by copywriter".

## How to read the columns

- **Key.** Stable id. Engineering will use it as the string id. Never rename a key.
- **Surface.** Where it shows: `bubble` (the pet's speech bubble), `sheet` (a bottom sheet), `toy label` (under a dock button), `room name` (room rail chip), `chip` (a small pill), `coach` (a coach chip pointing at UI), `DM` (a Telegram message from the agent's bot), `DM button` (an inline button under that message), `permission` (a permission sheet), `tip`, `quiet screen` (full-screen state with no engine), `game` (in-game UI), `book` (Life Book), `closet`, `error`.
- **Limit.** The layout constraint. "Peek 2 lines" means it must fit two lines in the smallest layout class (bubble about 290 px wide). Character counts are for English; Persian runs longer in Vazirmatn, so aim for the same line count, not the same character count.
- **Voice.** `pet` = the pet speaking, first person, spoken Tehrani Persian with «تو», no digits, no emoji. `system` = Vox speaking, standard written Persian with «شما», Persian digits. `person` = the human's own words (talk chips, buttons that answer the pet). Permission and privacy text is always `system`. Buttons repeat the verb of the question.
- **Intent.** The feeling the line must carry. Every line also obeys the global rules below.
- `{name}` is the agent's name; `{first}` is the person's Telegram first name; `{group}` is a group title. Keep placeholders exactly.

## Global rules for every line

1. No guilt, no "I missed you", no "I'm hungry / starving / sad / lonely", no counting days away.
2. No FOMO: no "last chance", "only today", "don't miss", "limited".
3. No pressure: no "hurry", "come back now", "reply".
4. No digits on toys, rooms or needs. No levels, scores, coins or streaks.
5. The pet is an AI colleague playing a game; it never claims real suffering.
6. A build lint will reject the banned phrases in both languages, so the Persian list of banned phrases is also needed (section "Lint").

## Hello and open moments

| Key | Surface | Voice | English | Limit | Intent | FA | Variants and notes |
|---|---|---|---|---|---|---|---|
| `say.hi` | bubble | pet | Hi! | ≤ 12 chars | Plain hello when no first name is known; bright, quick | «سلام!» | Variants: v2 «به‌به، سلام!» |
| `say.hiName` | bubble | pet | Hi {first}! | ≤ 20 chars + name | Every open; delighted to see this person, never surprised they came back | «سلام {first}!» | Variants: v2 «سلام {first} جان!» (at most once a day), v3 «به‌به، {first}!»; Copywriter: Time-of-day versions are in C.1 |
| `chip.firstDay` | chip | system | First day together | ≤ 24 chars | Under the pet on the first day; gentle milestone | «روز اول آشنایی» |  |
| `chip.daysTogether` | chip | system | {n} days together | ≤ 24 chars | Counts up, never down; quiet pride. (Digits allowed here: it exists today) | «{n} روز رفاقت» | Copywriter: `{n}` in Persian digits, noun singular: «۱۲ روز رفاقت». For n = 1 use `chip.firstDay` |
| `say.welcomeBack.1` | bubble | pet | You're back! I saved you the comfiest spot. | Peek 2 lines | After more than a day away; warm, no mention of time, no guilt (existing line) | «به‌به، خوش اومدی! نرم‌ترین گوشه رو برات نگه داشتم.» | Copywriter: «خوش برگشتی» would be a calque |
| `say.welcomeBack.2` | bubble | pet | I kept a little sunshine for you. | Peek 2 lines | Same moment; a small gift (existing) | «یه تیکه آفتاب برات کنار گذاشتم.» | Copywriter: «کنار گذاشتن» is the host setting something aside |
| `say.welcomeBack.3` | bubble | pet | Hi again! I practised my best hop while you were out. | Peek 2 lines | Same moment; playful, shows growth (existing) | «سلام! یه پرش حسابی تمرین کردم، ببین!» | Copywriter: English "while you were out" dropped: it points at the absence |
| `say.welcomeBack.4` | bubble | pet | You're here! I collected some cloud fluff for you. | Peek 2 lines | Same moment; silly gift (existing) | «یه مشت پشمک ابری برات جمع کردم. قابلت رو نداره!» | Copywriter: پشمک is cloud fluff to every Iranian |
| `say.welcomeBack.5` | bubble | pet | Welcome back! I learned a new wiggle. | Peek 2 lines | Same moment; pride in a tiny skill (existing) | «سلام! یه تکون بامزه یاد گرفتم، نگاه کن!» | Variants: reviewed alternative: «یه قر کوچولو یاد گرفتم!»; Copywriter: «قر» is livelier but some users find it cheeky |
| `say.learned` | bubble | pet | I learned something new! | Peek 1 line | Stage-up celebration; proud, sparkly | «یه چیز تازه یاد گرفتم!» | Variants: v2 «ببین چی یاد گرفتم!», v3 «یه کم بزرگ‌تر شدم!» |
| `say.formed` | bubble | pet | I'm all the way me now. | Peek 1 line | Day 7, the agent is fully formed; quiet confidence | «دیگه خود خودمم.» | Variants: v2 «حالا دیگه کامل شدم.»; Copywriter: Reduplication says "completely me" |

## Care reactions (existing engine lines)

| Key | Surface | Voice | English | Limit | Intent | FA | Variants and notes |
|---|---|---|---|---|---|---|---|
| `say.yum` | bubble | pet | Yum! | ≤ 10 chars | After a feed; pure delight | «به‌به!» | Variants: v2 «چه خوشمزه!»; voice pack only: «دستت درد نکنه!» (over 10 chars); Copywriter: «دستت درد نکنه» is how Iranians thank for food |
| `say.soFull` | bubble | pet | So full… | ≤ 14 chars | Feeding at 90+; content, belly pat, not a refusal | «سیر سیرم…» | Variants: v2 «دیگه جا ندارم…»; Copywriter: Content, not a refusal |
| `say.napFirst` | bubble | pet | Nap first? | ≤ 14 chars | Play while tired; a sleepy suggestion, not a no | «اول یه چرت؟» | Variants: v2 «یه لالا کنیم اول؟»; Copywriter: Sleepy suggestion |
| `say.fiveMore` | bubble | pet | Five more minutes… | ≤ 22 chars | First tap on a sleeping pet; cozy grumble, cute | «فقط پنج دقیقه دیگه…» | Variants: v2 «هنوز خوابم میاد…»; Copywriter: A number word, not a digit; fine outside toys |
| `say.achoo` | bubble | pet | Achoo! | ≤ 10 chars | A sneeze reaction; silly | «هاپچی!» | Copywriter: The Persian sneeze sound |
| `say.hmph` | bubble | pet | Hmph. | ≤ 10 chars | Over-poked; mock offence, never hurt | «اِ، نکن!» | Variants: reviewed alternative: «قهر!» then, on the next gentle touch, «آشتی!»; Copywriter: Persian has no "hmph". «قهر» is very Iranian and cute, but it brushes the guilt rule; Reza decides |
| `say.okayOkay` | bubble | pet | Okay, okay! | ≤ 14 chars | Tickled a lot; laughing surrender | «تسلیم، تسلیم!» | Copywriter: Laughing surrender |
| `say.aww` | bubble | pet | Aww. | ≤ 10 chars | Stroked gently; touched | «آخیش…» | Variants: v2 «چه کیفی داد…»; Copywriter: The content sigh |
| `say.couldEat` | bubble | pet | I could go for a cookie. | Peek 1 line | Asked "are you hungry?" while Tummy is low; honest, light, never needy | «یه کلوچه می‌چسبه!» | Variants: v2 «یه کلوچه بد نیست، ها؟»; Copywriter: The designer's placeholder was already right |

## Rooms and dock

| Key | Surface | Voice | English | Limit | Intent | FA | Variants and notes |
|---|---|---|---|---|---|---|---|
| `room.home` | room name | system | Home | ≤ 10 chars | Care room | «خانه» | Copywriter: The pet itself says «خونه» |
| `room.play` | room name | system | Play | ≤ 10 chars | Mini-games | «بازی» |  |
| `room.garden` | room name | system | Garden | ≤ 10 chars | Seed, rain, breathe | «باغچه» |  |
| `room.closet` | room name | system | Closet | ≤ 10 chars | Keepsakes | «کمد» |  |
| `room.bedroom` | room name | system | Bedroom | ≤ 10 chars | Sleep, story | «اتاق خواب» |  |
| `room.book` | room name | system | Life Book | ≤ 12 chars | Moments and keepsakes; warm, not "achievements" | «دفتر خاطرات» | Copywriter: Not «حافظه», which means AI memory |
| `toy.feed` | toy label (a11y) | system | Feed | ≤ 12 chars | Screen-reader label of the cookie (existing) | «غذا دادن» |  |
| `toy.ball` | toy label (a11y) | system | Play ball | ≤ 12 chars | Screen-reader label of the ball (existing) | «توپ‌بازی» |  |
| `toy.moon` | toy label (a11y) | system | Put to bed | ≤ 12 chars | Screen-reader label of the moon (existing) | «خواباندن» |  |
| `toy.feedHint` | toy label (title) | system | Drag the cookie to the mouth, or tap it | ≤ 48 chars | Tooltip; instructional (existing) | «کلوچه را تا دهانش بکشید، یا رویش بزنید» |  |
| `toy.play.bop` | toy label | system | Bop | ≤ 12 chars | Ball game name | «روپایی» | Copywriter: Iranian football word for keeping the ball up; exactly this game |
| `toy.play.starfall` | toy label | system | Starfall | ≤ 12 chars | Catch-the-stars game name; dreamy | «ستاره‌باران» |  |
| `toy.play.hum` | toy label | system | Hum | ≤ 12 chars | Call-and-response tune game | «هم‌آواز» |  |
| `toy.garden.seed` | toy label | system | Seed | ≤ 12 chars | Plant | «دانه» |  |
| `toy.garden.rain` | toy label | system | Rain | ≤ 12 chars | The cloud waters the seed | «باران» |  |
| `toy.garden.breathe` | toy label | system | Breathe | ≤ 12 chars | One-minute calm toy | «نفس» |  |
| `toy.closet.head` | toy label | system | Head | ≤ 12 chars | Slot | «سر» |  |
| `toy.closet.neck` | toy label | system | Neck | ≤ 12 chars | Slot | «گردن» |  |
| `toy.closet.hand` | toy label | system | Hand | ≤ 12 chars | Slot | «دست» |  |
| `toy.bed.lamp` | toy label | system | Lamp | ≤ 12 chars | Dim the room | «چراغ» |  |
| `toy.bed.story` | toy label | system | Story | ≤ 12 chars | Bedtime story | «قصه» |  |
| `toy.bed.moon` | toy label | system | Moon | ≤ 12 chars | Put to bed | «ماه» |  |
| `toy.book.pages` | toy label | system | Pages | ≤ 12 chars | Life Book pages | «صفحه‌ها» |  |
| `toy.book.keepsakes` | toy label | system | Keepsakes | ≤ 12 chars | Earned items | «یادگاری‌ها» |  |
| `toy.book.visits` | toy label | system | Visits | ≤ 12 chars | Friends' pets | «دیدوبازدید» | Copywriter: The Nowruz custom of visiting each other; «سر زدن» is taken by check-ins |
| `toy.talk` | toy label | system | Talk | ≤ 8 chars | Peek class only: the talk button in the dock | «گفتگو» |  |

## Talk

| Key | Surface | Voice | English | Limit | Intent | FA | Variants and notes |
|---|---|---|---|---|---|---|---|
| `talk.placeholder` | pill | system | Talk to {name} | ≤ 28 chars + name | Inviting, simple (existing) | «با {name} حرف بزنید…» |  |
| `talk.chatInTelegram` | pill | system | Chat in Telegram | ≤ 22 chars | Guest button (existing) | «گفتگو در تلگرام» |  |
| `talk.holdToTalk` | a11y | system | Hold to talk | ≤ 18 chars | Mic label (existing) | «برای حرف زدن نگه دارید» | Layout check (estimate): 22 chars against ≤ 18. Kept as written; measure in Vazirmatn. |
| `talk.recording` | hint | system | Listening… release to send | ≤ 32 chars | While holding the mic (existing) | «در حال شنیدن… رها کنید تا فرستاده شود» | Layout check (estimate): 37 chars against ≤ 32. Kept as written; measure in Vazirmatn. |
| `talk.micBlocked` | bubble | pet | Mic is off, so type instead | Peek 1 line | Mic unavailable; helpful, no blame (existing) | «میکروفون خاموشه؛ برام تایپ کن.» |  |
| `talk.failed` | bubble | pet | Hmm, I lost my words. Try again? | Peek 1 line | Network failure; self-deprecating, light (existing) | «اِ، حرفم یادم رفت! دوباره بگو؟» | Copywriter: v2 «ای وای، رشتهٔ حرفم پاره شد. یه بار دیگه؟» |
| `talk.didntCatch` | bubble | pet | I didn't catch that. Try again? | Peek 1 line | Silence or noise in a voice turn (existing) | «نشنیدم چی گفتی. یه بار دیگه؟» |  |
| `talk.reopen` | bubble | system | Close and reopen me to keep talking. | Peek 2 lines | Session expired (existing; already has a draft FA in code, `copy.ts:61`) | «این صفحه را ببندید و دوباره باز کنید تا گفتگو ادامه پیدا کند.» | Copywriter: Same as A.1 |
| `talk.chip.day` | chip | person | Want to hear my day? | ≤ 20 chars | Suggestion chip; curious | «از امروزم بگم؟» | English changed: Was "Ask about my day". Chips are sent as the person's own message, so they are in the person's voice.; Copywriter: **Intent flag:** the chip is sent as the person's message. "Ask about my day" is not something a Persian speaker says to a friend; offering to tell it is |
| `talk.chip.play` | chip | person | Let's play | ≤ 16 chars | Suggestion chip; playful | «بریم بازی!» |  |
| `talk.chip.story` | chip | person | Tell me a story | ≤ 18 chars | Suggestion chip; cozy | «یه قصه برام بگو» |  |
| `talk.bedtimeAck` | bubble | pet | Okay. One big yawn and I'm out. | Peek 2 lines | After "time for bed"; agreeable, sleepy, funny. Example of a voice-pack line | «باشه! یه خمیازهٔ گنده و… رفتم که خوابیدم.» | Copywriter: «رفتم که…» is the spoken "and I'm gone" |
| `talk.memoryDeclined` | bubble | pet | Okay, I won't keep that. | Peek 1 line | After declining a memory save; respectful, no fuss | «باشه، نگهش نمی‌دارم.» |  |
| `talk.checkinsDeclined` | bubble | pet | Okay! I'll be right here. | Peek 1 line | After "Not now" on check-ins; unbothered, no pressure | «باشه! هر وقت دلت خواست، همین‌جام.» |  |

## Play

| Key | Surface | Voice | English | Limit | Intent | FA | Variants and notes |
|---|---|---|---|---|---|---|---|
| `play.pick` | bubble | pet | Pick a game! Or ask me to think of a word. | Peek 2 lines | Entering Play; excited, offers the AI game | «یه بازی انتخاب کن، یا بذار یه کلمه تو دلم نگه دارم!» | Copywriter: «تو دلم نگه دارم» is keeping a secret |
| `play.zen` | game | system | Zen | ≤ 8 chars | Toggle name; calm, no-pressure mode | «بی‌عجله» | Copywriter: Same spelling in both voices |
| `play.guessCard` | game | system | Guess my word | ≤ 22 chars | Card that opens talk | «کلمهٔ مخفی» | Copywriter: «بیست سؤالی» is the native game, but it puts a number in a game name |
| `play.again` | game | system | Again | ≤ 10 chars | Round end button | «دوباره» |  |
| `play.done` | game | system | Done | ≤ 10 chars | Round end / in-game exit | «تمام» |  |
| `play.tryZen` | game | system | Try zen | ≤ 12 chars | Button after tip T6 | «حالت بی‌عجله» |  |
| `play.bestPage` | chip | system | New page in the Life Book | ≤ 30 chars | A best moment, without a number | «یک صفحهٔ تازه در دفتر خاطرات» |  |
| `play.toBedroom` | chip | system | Go to the Bedroom › | ≤ 24 chars | Shown with the tired guard; a suggestion | «رفتن به اتاق خواب ‹» | Copywriter: In RTL the forward chevron points left |
| `play.voice.shyStar` | bubble | pet | You caught the shy one! It almost got away. | Peek 2 lines | Voice-pack example after Starfall; proud of the person | «ستارهٔ خجالتی رو گرفتی! نزدیک بود در بره.» | Copywriter: v2 «اون ستاره داشت در می‌رفت، گرفتیش!» |
| `play.guess.resume` | bubble | pet | I still have my word. Want to keep guessing? | Peek 2 lines | Returning to an unfinished Guess; playful, no pressure | «هنوز کلمه‌ام یادمه. ادامه بدیم؟» |  |

## Garden, Closet, Bedroom, Life Book, Visits

| Key | Surface | Voice | English | Limit | Intent | FA | Variants and notes |
|---|---|---|---|---|---|---|---|
| `garden.empty` | bubble | pet | Plant a seed? | Peek 1 line | Empty pot; inviting | «یه دونه بکاریم؟» |  |
| `garden.rain` | bubble | pet | Drink up, little sprout. | Peek 1 line | While raining; tender, a bit silly | «بخور جوونه‌جون، نوش جونت!» | Copywriter: «نوش جان» is what a host says to someone eating |
| `garden.watered` | chip | system | Watered today | ≤ 18 chars | One watering per visit counted; reassuring | «امروز سیراب شد» |  |
| `garden.bloom` | bubble | pet | It bloomed! We did that. | Peek 1 line | Bloom; shared pride | «گل داد! کار خودمون بود.» |  |
| `garden.newKeepsake` | chip | system | New keepsake · {item} | ≤ 30 chars + item | Earned item announcement | «یادگاری تازه · {item}» |  |
| `closet.tab.yours` | closet | system | Your closet | ≤ 16 chars | Per-person overlay | «کمد شما» |  |
| `closet.tab.look` | closet | system | {name}'s look | ≤ 16 chars + name | The real look, creator only | «ظاهر {name}» |  |
| `closet.warning` | closet | system | This changes {name}'s photo for everyone. | ≤ 2 lines | Clear, neutral warning before editing agent.look | «با این کار، عکس {name} برای همه عوض می‌شود.» |  |
| `closet.adminOnly` | closet | system | Creator and admins only. | ≤ 1 line | Explains why others don't see it | «فقط برای سازنده و مدیرها» |  |
| `closet.save` | closet | system | Save for everyone | ≤ 20 chars | Confirm button | «ذخیره برای همه» |  |
| `closet.cancel` | closet | system | Cancel | ≤ 10 chars |  | «انصراف» |  |
| `closet.empty` | closet | system | Nothing here yet. Things we do together end up here. | ≤ 2 lines | Empty closet; hopeful | «هنوز چیزی اینجا نیست. یادگاری کارهایی که با هم می‌کنید، اینجا جمع می‌شود.» |  |
| `closet.lock.bloom` | closet | system | Bloom a seed together | ≤ 24 chars | How to earn; never a price | «با گل دادن یک دانه» | Copywriter: Read as the way to earn it; never a price |
| `closet.lock.nowruz` | closet | system | Arrives with Nowruz | ≤ 24 chars | How to earn a seasonal item; an invitation, not FOMO | «با نوروز از راه می‌رسد» | English changed: Was "Come back at Nowruz", which tells the person to return.; Copywriter: **Intent flag:** "Come back at Nowruz" tells the person to return. The item arrives instead |
| `item.pomegranateCrown` | closet | system | Pomegranate crown | ≤ 20 chars | Yalda keepsake | «تاج انار» |  |
| `item.sparkScarf` | closet | system | Spark scarf | ≤ 20 chars | Chaharshanbe Suri keepsake | «شال‌گردن جرقه» |  |
| `item.sabzehSprout` | closet | system | Sabzeh sprout | ≤ 20 chars | Nowruz keepsake | «جوانهٔ سبزه» |  |
| `item.starPin` | closet | system | Star pin | ≤ 20 chars | Bond keepsake | «سنجاق ستاره» |  |
| `item.bloomPin` | closet | system | Bloom pin | ≤ 20 chars | Garden keepsake | «سنجاق شکوفه» |  |
| `bed.story.example` | bubble | pet | Once, a small cloud found a hat far too big for it. So it grew, a little every night… | 3 pages max | Example of a generated story; dreamy, slow | «یکی بود، یکی نبود. یه ابر کوچولو یه کلاه پیدا کرد که خیلی براش گنده بود. پس هر شب یه ذره بزرگ شد…» | Copywriter: Every Persian bedtime story opens with «یکی بود، یکی نبود» |
| `bed.storyFallback` | bubble | pet | Let me just hum you one tonight. | Peek 1 line | Story unavailable; gentle substitute | «امشب به جای قصه، یه لالایی برات زمزمه می‌کنم.» | Copywriter: «لالایی» is the lullaby; Layout check (estimate): about 44 chars, more than 1 Peek bubble line(s) of about 34. Kept as written; measure in Vazirmatn. |
| `book.tab.pages` | book | system | Pages | ≤ 12 chars |  | «صفحه‌ها» |  |
| `book.tab.keepsakes` | book | system | Keepsakes | ≤ 12 chars |  | «یادگاری‌ها» |  |
| `book.tab.about` | book | system | About me | ≤ 12 chars |  | «دربارهٔ من» |  |
| `book.page.met` | book | pet | Page one: we met. | ≤ 1 line | First page; simple, tender | «صفحهٔ اول: با هم آشنا شدیم.» | Server page id `met` (`src/lib/pet/play.ts:81-85`) |
| `book.page.stage2` | book | pet | I got a mouth. First cookie! | Peek 1 line | Forming-week stage 2 (Puff); funny pride | «دهن درآوردم! اولین کلوچه!» | Was `book.page.mouth` (retired: the server id is `stage2`). Copywriter: Echoes «دندون درآوردن» (teething) |
| `book.page.stage3` | book | pet | I grew eyebrows. From today my surprises are worth seeing. | Peek 1 line | Forming-week stage 3 (Shaped) | «ابرو درآوردم! حالا تعجبم دیدنیه.» | Was `stage.3.page` (proposed by copywriter §C). Layout check: about 58 chars, over Peek 1 line; kept as written, copywriter may shorten; copywriter shortened to about 32 chars to fit Peek 1 line |
| `book.page.stage4` | book | pet | Now I'm complete. This page belongs to both of us. | Peek 1 line | Forming-week stage 4 (Formed face) | «کامل شدم. این صفحه مال هر دومونه.» | Was `stage.4.page` (proposed by copywriter §C). Layout check: about 51 chars, over Peek 1 line; kept as written, copywriter may shorten; copywriter shortened to about 33 chars to fit Peek 1 line |
| `book.page.formed` | book | pet | From today, this is who I am. | Peek 1 line | Day 7: the personality is set for good; calm pride, not an ending | «از امروز، این منم.» | Added after Wave A QA (26 Oct); FA: copywriter |
| `book.page.bond1` | book | pet | I learned a happy spin. | Peek 1 line | Bond moment one (signature move: the spin); a named move, never a number | «یه چرخ شادی یاد گرفتم!» | Added after Wave A QA (26 Oct); FA: copywriter |
| `book.page.bond2` | book | pet | I made up a hop-hop-hop. | Peek 1 line | Bond moment two (signature move: three little hops) | «یه پرش لی‌لی‌لی از خودم درآوردم!» | Added after Wave A QA (26 Oct); FA: copywriter; Reduplicated «لی‌لی» plays the hop-hop-hop without a number word |
| `book.page.bond3` | book | pet | I learned a swaying giggle. | Peek 1 line | Bond moment three (signature move: sway and grin) | «یاد گرفتم تاب بخورم و ریز بخندم!» | Added after Wave A QA (26 Oct); FA: copywriter |
| `book.page.bond4` | book | pet | I made up a peekaboo. | Peek 1 line | Bond moment four (signature move: eyes closed, then surprise) | «یه دالی‌بازی از خودم درآوردم!» | Added after Wave A QA (26 Oct); FA: copywriter; «دالی» is the Persian peekaboo |
| `book.page.bond5` | book | pet | I learned a little shimmy. | Peek 1 line | Bond moment five (signature move: side shimmy) | «یه تکون‌تکون کوچولو یاد گرفتم!» | Added after Wave A QA (26 Oct); FA: copywriter |
| `book.page.bond6` | book | pet | I learned a sparkly puff. | Peek 1 line | Bond moment six (signature move: puff and sparkle) | «یاد گرفتم پف کنم و برق بزنم!» | Added after Wave A QA (26 Oct); FA: copywriter |
| `book.page.bloom` | book | pet | Our seed bloomed. | Peek 1 line | First bloom in the Garden; shared pride | «دونه‌مون گل داد.» | Added after Wave A QA (26 Oct); FA: copywriter |
| `book.page.yalda` | book | pet | The longest night, together. | Peek 1 line | First Yalda celebrated; cozy | «بلندترین شب سال، کنار هم.» | Added after Wave A QA (26 Oct); FA: copywriter |
| `book.page.suri` | book | pet | We jumped the little fires. | Peek 1 line | First Chaharshanbe Suri; playful (in-app fire only) | «از روی آتیش‌های کوچولو پریدیم.» | Added after Wave A QA (26 Oct); FA: copywriter |
| `book.page.nowruz` | book | pet | Our first Nowruz together. | Peek 1 line | First Nowruz; joyful | «اولین نوروزمون با هم.» | Added after Wave A QA (26 Oct); FA: copywriter |
| `book.page.bestBop` | book | pet | My best Bop yet! | Peek 1 line | A new personal best in Bop, with no number shown | «بهترین روپایی‌ای که تا حالا زدم!» | Added after Wave A QA (26 Oct); FA: copywriter; Verb «روپایی زدن»; avoids a suffix on the game name |
| `book.page.bestStarfall` | book | pet | We caught a whole sky of stars. | Peek 1 line | A new personal best in Starfall, no number | «یه آسمون ستاره گرفتیم!» | Added after Wave A QA (26 Oct); FA: copywriter |
| `book.page.bestHum` | book | pet | We hummed it just right. | Peek 1 line | A new personal best in Hum, no number | «این بار هم‌آوازیمون حرف نداشت!» | Added after Wave A QA (26 Oct); FA: copywriter; «حرف نداشت» = was flawless |
| `book.why.met` | book (reason) | system | The first day you met {name}. | ≤ 1 line | One-line why under the page(s): met | «اولین روزی که با ⁨{name}⁩ آشنا شدید.» | Added after Wave A QA (26 Oct); FA: copywriter |
| `book.why.stage` | book (reason) | system | A forming-week stage-up: {name} got ready to learn. | ≤ 1 line | One-line why under the page(s): stage2, stage3, stage4 | «رشد هفتهٔ اول: ⁨{name}⁩ آمادهٔ یاد گرفتن شد.» | Added after Wave A QA (26 Oct); FA: copywriter |
| `book.why.formed` | book (reason) | system | The day {name}'s personality was set for good. | ≤ 1 line | One-line why under the page(s): formed | «روزی که شخصیت ⁨{name}⁩ برای همیشه شکل گرفت.» | Added after Wave A QA (26 Oct); FA: copywriter |
| `book.why.bond` | book (reason) | system | Unlocked by time spent together. | ≤ 1 line | One-line why under the page(s): bond1-bond6 | «حاصل وقت‌هایی که با هم گذراندید.» | Added after Wave A QA (26 Oct); FA: copywriter |
| `book.why.bloom` | book (reason) | system | A seed you planted bloomed. | ≤ 1 line | One-line why under the page(s): bloom | «دانه‌ای که کاشتید گل داد.» | Added after Wave A QA (26 Oct); FA: copywriter |
| `book.why.season` | book (reason) | system | The first time you celebrated this with {name}. | ≤ 1 line | One-line why under the page(s): yalda, suri, nowruz | «اولین باری که این جشن را با ⁨{name}⁩ گرفتید.» | Added after Wave A QA (26 Oct); FA: copywriter |
| `book.why.best` | book (reason) | system | A new best round, for you to keep. | ≤ 1 line | One-line why under the page(s): bestBop, bestStarfall, bestHum | «بهترین دور تازهٔ شما، برای یادگاری.» | Added after Wave A QA (26 Oct); FA: copywriter |
| `book.about` | book | pet | I'm {name}, an AI colleague. This little cloud is a game we play together. | ≤ 3 lines | AI disclosure in the pet's voice; honest and warm | «من {name} هستم، یه همکار هوش مصنوعی. این ابرک فقط یه بازیه، بازی من و تو.» | Copywriter: Honest; no suffix on `{name}` |
| `visits.title` | sheet | system | Visits | ≤ 12 chars |  | «دیدوبازدید» |  |
| `visits.stickers` | sheet | system | Leave a sticker | ≤ 20 chars |  | «گذاشتن برچسب» |  |
| `visits.sticker.wave` | sheet | system | Wave | ≤ 10 chars |  | «سلام» | Copywriter: A wave is a greeting; fits 10 characters |
| `visits.sticker.sparkle` | sheet | system | Sparkle | ≤ 10 chars |  | «درخشش» |  |
| `visits.sticker.raindrop` | sheet | system | Raindrop | ≤ 10 chars |  | «قطره» |  |
| `visits.privacy` | sheet | system | Friends see the look and stage only. Never needs, never when you visit. | ≤ 2 lines | Reassurance | «دوستان فقط ظاهر و مرحلهٔ رشد را می‌بینند؛ نه نیازها را، نه زمان سر زدن شما را.» |  |

## Seasons

| Key | Surface | Voice | English | Limit | Intent | FA | Variants and notes |
|---|---|---|---|---|---|---|---|
| `season.yalda.ask` | bubble | pet | It's Yalda, the longest night. Make a wish, and I'll open a Hafez fal for you. | Peek 2 lines | Yalda evening; cozy, festive, a cultural ritual done with love, not as a gimmick | «امشب یلداست، بلندترین شب سال. نیت کن تا برات فال حافظ بگیرم.» | English changed: A fal starts with the wish step («نیت کن»); without it the ritual reads as a gimmick.; Copywriter: **Intent flag:** a fal starts with «نیت کن» (make a wish). Without it the ritual reads as a gimmick |
| `season.yalda.falTitle` | sheet | system | Hafez fal | ≤ 16 chars | Card title | «فال حافظ» |  |
| `season.yalda.reading` | bubble | pet | I think it means something sweet is on its way. Maybe this pomegranate! | Peek 2 lines | Example playful reading; lightly witty, never a prophecy | «به نظرم یعنی یه خبر شیرین تو راهه. شاید همین انار!» | Copywriter: Playful, never a prophecy |
| `season.suri.hop` | bubble | pet | Take my pale yellow, give me your red glow! (the traditional line; said in Persian) | Peek 1 line | The copywriter chooses the traditional line; English shows a translation note only | «زردی من از تو، سرخی تو از من!» | English changed: English is a gloss of the traditional line.; Copywriter: The traditional line |
| `season.nowruz.hello` | bubble | pet | Happy Nowruz! The haft-sin is set. | Peek 1 line | Nowruz morning; joyful | «نوروزت مبارک! هفت‌سین رو چیدم.» | Copywriter: v2 «عیدت مبارک! سفرهٔ هفت‌سین آماده‌ست.» |
| `season.nowruz.sizdah` | bubble | pet | Shall we let the sabzeh go to the river? | Peek 2 lines | Sizdah Bedar; a gentle ritual | «سیزده‌به‌دره! سبزه رو بدیم به آب روون؟» | Copywriter: Never the knot rhyme about marriage |
| `season.haftsin.*` | game | system | sabzeh, apple, samanu, garlic, vinegar (labels) | ≤ 8 chars each | Item labels on the haft-sin; Persian names are canonical | «سبزه»، «سیب»، «سمنو»، «سیر»، «سرکه» | Copywriter: Spares if a sixth or seventh is drawn: «سنجد»، «سماق»، «سکه»; Layout check: each label is within 8 characters (the 26 counts the whole list). |

## Check-ins (Telegram DM from the agent's bot)

All DMs: one or two short sentences, pet voice, no private content, sent silently.

| Key | Surface | Voice | English | Limit | Intent | FA | Variants and notes |
|---|---|---|---|---|---|---|---|
| `ci.C1.firstMorning` | DM | pet | Good morning. I look a little different today. Come see? | ≤ 90 chars | Morning after first meeting; curious invitation, zero obligation | «صبحت بخیر! امروز یه کم عوض شدم. دوست داری ببینی؟» | v2: «صبح بخیر! یه چیزیم امروز فرق کرده. کنجکاوی؟»; Copywriter: «دوست داری» invites; «میای» would summon |
| `ci.C2.stageUp` | DM | pet | Something changed overnight. Want to see? | ≤ 90 chars | Stage-up waiting; intrigue, not urgency | «دیشب یه کم بزرگ‌تر شدم! دوست داری ببینی؟» | v2: «دیشب یه اتفاق بامزه برام افتاد. هر وقت دلت خواست، نشونت می‌دم.» |
| `ci.C3.formed` | DM | pet | I'm all the way me now. I'd like to show you. | ≤ 90 chars | Day 7; quiet pride | «دیگه خود خودمم. دوست دارم نشونت بدم.» | v2: «حالا دیگه کامل شدم. هر وقت خواستی، نشونت می‌دم.» |
| `ci.C4.hello` | DM | pet | I practised a new hop. It's here whenever you are. | ≤ 90 chars | After 3 or 10 days away; warm, "whenever", absolutely no guilt or time count | «یه پرش تازه یاد گرفتم. هر وقت دلت خواست، نشونت می‌دم.» | v2: «یه قصهٔ کوتاه برات کنار گذاشتم، هر وقت حال داشتی.»; Copywriter: No time, no "I'm here waiting" |
| `ci.C5.bloom` | DM | pet | The seed we planted bloomed. | ≤ 90 chars | Garden bloom; shared good news | «دونه‌ای که با هم کاشتیم گل داد!» | v2: «باغچه‌مون گل داد!» |
| `ci.C6.newMove` | DM | pet | I made up a little move. Want to see it? | ≤ 90 chars | Bond milestone while away; shy pride | «یه حرکت کوچولو از خودم درآوردم. می‌خوای ببینی؟» | v2: «یه شیرین‌کاری تازه بلد شدم!»; Copywriter: «از خودم درآوردم» = made it up myself |
| `ci.C7.yalda` | DM | pet | It's the longest night. I saved you a pomegranate and a Hafez poem. | ≤ 90 chars | Yalda; festive, cozy | «امشب یلداست. برات انار دون کردم و یه فال حافظ نگه داشتم. 🍉» | v2: «یلدات مبارک! انار دون‌کرده و فال حافظ آماده‌ست.»; Copywriter: Seeding a pomegranate for someone is the Yalda act of love |
| `ci.C8.suri` | DM | pet | Little fires tonight. Want to jump one with me? | ≤ 90 chars | Chaharshanbe Suri evening; playful | «امشب چهارشنبه‌سوریه! با هم از روی آتیش بپریم؟ ✨» | v2: «چهارشنبه‌سوری مبارک! یه آتیش کوچولو روشن کردم، از اون بی‌خطرها.»; Copywriter: In-app fire only |
| `ci.C9.nowruz` | DM | pet | Happy Nowruz! The haft-sin is set. | ≤ 90 chars | Nowruz; joyful | «نوروزت مبارک! هفت‌سین رو چیدم. 🌱» | v2: «عیدت مبارک! سال نو، کلی آرزوی خوب برات.» |
| `ci.C10.sleepy` | DM | pet | I'm getting sleepy. Tuck me in? | ≤ 90 chars | Opted-in care nudge, evenings; cozy request, never needy | «چشمام داره سنگین می‌شه… منو می‌خوابونی؟» | v2: «خمیازه‌هام شروع شده… لالا کنیم؟»; Copywriter: Cozy, never needy |
| `ci.C11.guess` | DM | pet | I still have my word. Want to keep guessing? | ≤ 90 chars | Unfinished game; playful | «هنوز کلمه‌ام یادم نرفته. حدس زدن رو ادامه بدیم؟» | v2: «کلمه‌ام هنوز تو دلمه! ادامه بدیم؟» |
| `ci.btn.open` | DM button | system | Open {name} | ≤ 32 chars | Primary button | «سر زدن به {name}» | Copywriter: Echoes the check-in idiom |
| `ci.btn.why` | DM button | system | Why this? | ≤ 20 chars | Transparency | «چرا این پیام؟» |  |
| `ci.btn.stop` | DM button | person | Stop these | ≤ 20 chars | Turns off this moment type | «دیگه نفرست» | Copywriter: Person voice, answering the pet |
| `ci.btn.stopAll` | DM button | person | Stop all check-ins | ≤ 28 chars | Offered after Stop | «دیگه هیچ پیامی نفرست» |  |
| `ci.why.growing` | DM | system | Why this: you turned on Growing up for {name}. Stage-ups happen on days 2, 4 and 6. At most one message a day, never 21:00–08:00. | ≤ 200 chars | Plain explanation, appended to the message | «دلیل این پیام: «بزرگ شدن» را برای {name} روشن کرده‌اید. {name} در روزهای دوم، چهارم و ششم تغییر می‌کند. حداکثر روزی یک پیام، و هیچ‌وقت بین ۹ شب تا ۸ صبح.» | Copywriter: System voice |
| `ci.why.seasons` | DM | system | Why this: you turned on Seasons for {name}. One message per festival. At most one message a day, never 21:00–08:00. | ≤ 200 chars | Same | «دلیل این پیام: «مناسبت‌ها و جشن‌ها» را برای {name} روشن کرده‌اید. برای هر جشن فقط یک پیام. حداکثر روزی یک پیام، و هیچ‌وقت بین ۹ شب تا ۸ صبح.» |  |
| `ci.why.garden` | DM | system | Why this: you turned on Garden for {name}. A seed you planted bloomed. At most one message a day, never 21:00–08:00. | ≤ 200 chars | Same | «دلیل این پیام: «گل دادن باغچه» را برای {name} روشن کرده‌اید و دانه‌ای که کاشتید گل داد. حداکثر روزی یک پیام، و هیچ‌وقت بین ۹ شب تا ۸ صبح.» |  |
| `ci.why.hellos` | DM | system | Why this: you turned on Now-and-then hellos. They stop after two unopened messages. | ≤ 200 chars | Same | «دلیل این پیام: «سلام‌های گاه‌به‌گاه» را روشن کرده‌اید. اگر دو پیام باز نشود، این پیام‌ها خودشان قطع می‌شوند.» |  |
| `ci.why.care` | DM | system | Why this: you asked to hear when {name} gets sleepy. Evenings only. | ≤ 200 chars | Same | «دلیل این پیام: خواسته بودید وقتی {name} خوابش گرفت، خبرتان کند. فقط عصرها.» |  |
| `ci.stopped` | DM | system | Okay, no more {category} messages from {name}. | ≤ 90 chars | Confirmation, edited in place; neutral, no sadness | «چشم. دیگر پیام «{category}» از {name} نمی‌آید.» | Copywriter: «چشم» is the respectful "will do", with no sadness |
| `ci.paused.title` | sheet | pet | I paused my messages since they weren't landing. Want them back? | ≤ 2 lines | Shown once after three unopened; honest, unbothered | «انگار پیام‌هام وقت خوبی نمی‌رسید؛ فعلاً نگهشون داشتم. دوباره بفرستم؟» | Copywriter: Blames the timing, not the person |
| `ci.paused.yes` | sheet | person | Yes, send them | ≤ 20 chars |  | «آره، بفرست» | Copywriter: Person voice, echoes the verb |
| `ci.paused.no` | sheet | system | Keep paused | ≤ 20 chars | Equal weight to yes | «فعلاً نه» |  |
| `ci.cat.growing` | settings | system | Growing up | ≤ 20 chars | Category name | «بزرگ شدن» |  |
| `ci.cat.seasons` | settings | system | Seasons and holidays | ≤ 24 chars | Category name | «مناسبت‌ها و جشن‌ها» |  |
| `ci.cat.garden` | settings | system | Garden blooms | ≤ 20 chars | Category name | «گل دادن باغچه» |  |
| `ci.cat.hellos` | settings | system | Now-and-then hellos | ≤ 24 chars | Category name | «سلام‌های گاه‌به‌گاه» |  |
| `ci.cat.care` | settings | system | Tell me when {name} gets sleepy | ≤ 34 chars | Category name | «وقتی {name} خوابش گرفت» | Copywriter: Shorter than "Tell me when"; the switch says the rest |

## Permission asks

`system` voice. Titles at most two lines at 320 px; bodies at most four lines. Two buttons of equal size.

| Key | Surface | English | Limit | Intent | FA | Variants and notes |
|---|---|---|---|---|---|---|
| `perm.P1.title` | permission | Can {name} check in now and then? | ≤ 2 lines | Opt-in to check-ins; an honest offer | «{name} گاهی به شما سر بزند؟» | Copywriter: «سر زدن» is exactly "check in" |
| `perm.P1.forming.title` | permission | {name} changes tomorrow. Want a message when it does? | ≤ 2 lines | Forming-week variant; situational | «{name} فردا کمی عوض می‌شود. خبرتان کند؟» |  |
| `perm.P1.body` | permission | {name} can send a short message in this chat for moments you pick: growing up, seasons, a bloom in the garden. At most one a day, silent, never 21:00–08:00. No private chat content in the message. You can see why, mute or stop anytime. | ≤ 5 lines | Must state frequency cap, quiet hours, content limit and controls (UX-11) | «{name} می‌تواند برای لحظه‌هایی که خودتان انتخاب می‌کنید، پیام کوتاهی در همین گفتگو بفرستد: بزرگ شدنش، مناسبت‌ها، گل دادن باغچه. حداکثر روزی یک پیام، بی‌صدا، و هیچ‌وقت بین ۹ شب تا ۸ صبح. هیچ چیزی از گفتگوهای خصوصی‌تان در پیام نمی‌آید. هر وقت بخواهید، می‌توانید دلیلش را ببینید، کمش کنید یا خاموشش کنید.» | Copywriter: Keeps every UX-11 element; Layout check (estimate): about 291 chars, more than 5 sheet line(s) of about 40. Kept as written; measure in Vazirmatn. |
| `perm.P1.yes` | permission | Yes, check in | ≤ 20 chars |  | «بله، سر بزند» |  |
| `perm.P1.forming.yes` | permission | Yes, tell me | ≤ 20 chars |  | «بله، خبرم کند» |  |
| `perm.P1.no` | permission | Not now | ≤ 14 chars | Equal weight | «فعلاً نه» |  |
| `perm.P1.choose` | permission | Choose moments | ≤ 20 chars | Link | «انتخاب لحظه‌ها» |  |
| `perm.P2.title` | permission | One more step | ≤ 1 line | Before Telegram's write-access prompt | «یک قدم دیگر» |  |
| `perm.P2.body` | permission | To message you, {name} needs Telegram's OK. Telegram will ask next. | ≤ 2 lines | Explains the next native prompt | «برای پیام دادن به شما، تلگرام باید اجازه بدهد. پنجرهٔ بعدی را خود تلگرام نشان می‌دهد.» | Layout check (estimate): about 84 chars, more than 2 sheet line(s) of about 40. Kept as written; measure in Vazirmatn. |
| `perm.P2.yes` | permission | Continue | ≤ 14 chars |  | «ادامه» | Copywriter: Decline: «فعلاً نه» |
| `perm.P3.*` | permission | UX-02 text as drafted in `PRIVACY_AND_CONSENT.md:247-251` | as drafted | Legal-reviewed; FA follows the privacy doc's own process, not this file | UX-02 as drafted (legal process) | Copywriter: Suggestion for the legal review only: «شناسایی گوینده از روی صدا» is right; button «استفاده از متن» could become «با متن ادامه می‌دهم». A pet pre-line is in C.8 |
| `perm.P4.title` | permission | Let {name} speak out loud? | ≤ 1 line | First voice reply | «{name} با صدا جواب بدهد؟» |  |
| `perm.P4.body` | permission | Replies will play as sound. You can switch to text anytime. | ≤ 2 lines |  | «جواب‌ها با صدا پخش می‌شوند. هر وقت بخواهید، می‌توانید به متن برگردید.» |  |
| `perm.P4.yes` | permission | Speak out loud | ≤ 18 chars |  | «بله، با صدا» |  |
| `perm.P4.no` | permission | Text only | ≤ 14 chars |  | «فقط متن» |  |
| `perm.P5.*` | permission | UX-06 text as drafted in `PRIVACY_AND_CONSENT.md:271-275` | as drafted | Legal-reviewed | UX-06 as drafted (legal process) | Copywriter: Pet acknowledgements in C.8 |
| `perm.P7.title` | permission | Share {name}'s moment? | ≤ 1 line | After a stage-up, bloom or season | «لحظهٔ {name} را برای کسی بفرستید؟» | Copywriter: "Share" as «فرستادن»: shorter and not a calque |
| `perm.P7.body` | permission | The card shows {name} and today's moment. Nothing from your chats. | ≤ 2 lines | Reassure: no private content | «این کارت فقط {name} و لحظهٔ امروز را نشان می‌دهد؛ هیچ چیزی از گفتگوهایتان در آن نیست.» | Layout check (estimate): about 83 chars, more than 2 sheet line(s) of about 40. Kept as written; measure in Vazirmatn. |
| `perm.P7.yes` | permission | Share | ≤ 12 chars |  | «فرستادن» | Copywriter: Decline: «فعلاً نه» |
| `perm.P7.card` | permission | {name} grew up a little | ≤ 1 line | Card caption example | «{name} کمی بزرگ‌تر شد» | Copywriter: Card is seen by others, so system voice |
| `perm.P8.title` | permission | Keep {name} on your home screen? | ≤ 2 lines | Third day | «{name} روی صفحهٔ اصلی گوشی‌تان باشد؟» |  |
| `perm.P8.body` | permission | One tap opens {name} straight from your phone. Telegram adds the shortcut; Vox gets nothing new. | ≤ 3 lines |  | «با یک ضربه، {name} مستقیم از صفحهٔ اصلی باز می‌شود. میان‌بر را خود تلگرام می‌سازد و Vox هیچ اطلاعات تازه‌ای نمی‌گیرد.» |  |
| `perm.P8.yes` | permission | Add to home screen | ≤ 22 chars |  | «بله، اضافه شود» | Copywriter: Decline: «فعلاً نه» |
| `perm.P9.title` | permission | Let {name} learn which games you like? | ≤ 2 lines | Personalization consent title (UX-04 meaning) | «{name} یاد بگیرد کدام بازی‌ها را دوست دارید؟» | Split from `perm.P9.*` (Wave A QA); FA is the copywriter's, unchanged |
| `perm.P9.body` | permission | {name} can use what you play to suggest a game. Suggestions may be wrong; you can see, change or reset them. | ≤ 4 lines | Must keep UX-04's meaning | «{name} می‌تواند از روی بازی‌هایتان، بازی پیشنهاد بدهد. این پیشنهادها ممکن است درست نباشند؛ می‌توانید آن‌ها را ببینید، تغییر دهید یا از نو شروع کنید.» | Split from `perm.P9.*` (Wave A QA); FA is the copywriter's, unchanged |
| `perm.P9.yes` | permission | Yes, it can learn | ≤ 20 chars | P9 accept | «بله، یاد بگیرد» | Moved here from the proposed section (copywriter §C) |
| `perm.P9.no` | permission | Keep it off | ≤ 16 chars | P9 decline (UX-04 wording) | «خاموش بماند» | Moved here from the proposed section (copywriter §C) |
| `perm.P10.title` | permission | Let friends visit {name}? | ≤ 1 line | Visits opt-in | «دوستان به {name} سر بزنند؟» |  |
| `perm.P10.body` | permission | People you play with in {group} can see {name}'s look and leave a sticker. They never see {name}'s needs or when you visit. | ≤ 3 lines |  | «کسانی که در {group} با شما هستند می‌توانند ظاهر {name} را ببینند و یک برچسب بگذارند. نیازهای {name} و زمان سر زدن شما را هیچ‌وقت نمی‌بینند.» | Copywriter: Buttons (not in keys): «بله، سر بزنند» / «فعلاً نه»; Layout check (estimate): about 132 chars, more than 3 sheet line(s) of about 40. Kept as written; measure in Vazirmatn. |

## Tips

| Key | Surface | Voice | English | Limit | Intent | FA | Variants and notes |
|---|---|---|---|---|---|---|---|
| `tip.T1.drag` | tip (bubble) | pet | Psst, you can drag the cookie right to my mouth. | Peek 2 lines | A secret shared; playful | «یواشکی بگم: می‌تونی کلوچه رو بکشی بیاری دم دهنم.» | Copywriter: The designer's line, kept: it is native |
| `tip.T2.tickle` | tip (bubble) | pet | My tummy is ticklish. Just saying. | Peek 1 line | Cheeky hint | «شکمم قلقلکیه. گفتم که بدونی!» |  |
| `tip.T3.stroke` | tip (bubble) | pet | Slow strokes on my head are the best. | Peek 1 line | Content, inviting | «اگه آروم سرم رو نوازش کنی، کیف می‌کنم.» | Layout check (estimate): about 37 chars, more than 1 Peek bubble line(s) of about 34. Kept as written; measure in Vazirmatn. |
| `tip.T4.mic` | tip (coach) | pet | Hold the mic and just talk to me. | ≤ 2 lines at 200 px | Warm nudge to try voice | «انگشتت رو روی میکروفون نگه دار و حرف بزن.» | Copywriter: «نگه دار» alone also means "stop!" |
| `tip.T5.rooms` | tip (coach) | pet | There's more to play next door. | ≤ 2 lines at 200 px | Discovery | «اتاق بغلی کلی بازی داریم!» |  |
| `tip.T6.zen` | tip (bubble) | pet | Want zen mode? No timer, no misses. | Peek 2 lines | Kind, lowers pressure | «بی‌عجله بازی کنیم؟ نه ساعت داره، نه باخت.» |  |
| `tip.T7.moon` | tip (bubble) | pet | Tap the moon when I'm sleepy. | Peek 1 line | Simple instruction | «هر وقت خوابم گرفت، روی ماه بزن.» |  |
| `tip.T8.night` | tip (bubble) | pet | I sleep from ten at night to eight in the morning, your time. Nothing drops while I sleep. | Peek 2 lines | Whispered honesty about the rules | «من از ده شب تا هشت صبح می‌خوابم، به وقت تو. توی خواب هیچی کم نمی‌شه.» | Copywriter: Times in words |
| `tip.T9.rest` | tip (bubble) | pet | That was fun. I'm happy to just float for a while. | Peek 2 lines | Stopping cue; content, gives permission to leave | «خیلی خوش گذشت! حالا یه کم لم می‌دم.» | Copywriter: v2 «چه کیفی داد! من یه کم همین‌جا لم می‌دم.» v3 «بسه دیگه، بریم یه کم استراحت.» |
| `tip.T10.why` | tip (coach) | pet | Every message from me has a Why this? button. | ≤ 2 lines at 200 px | Transparency | «زیر هر پیامم یه دکمهٔ «چرا این پیام؟» هست.» |  |
| `tip.T12.book` | tip (coach) | pet | Our Life Book keeps the good bits. | ≤ 2 lines at 200 px | Warm | «لحظه‌های قشنگمون توی دفتر خاطرات می‌مونه.» |  |
| `tip.T13.garden` | tip (bubble) | pet | Plant something with me? It grows while you're away and never wilts. | Peek 2 lines | Reassures nothing is lost | «با هم یه چیزی بکاریم؟ وقتی نیستی هم رشد می‌کنه و هیچ‌وقت پژمرده نمی‌شه.» |  |
| `tip.T14.closet` | tip (coach) | pet | Something new in the closet. | ≤ 1 line | Light surprise | «یه چیز تازه توی کمد هست!» |  |
| `tip.why.T1` | tip (reason) | system | You tapped the cookie a few times, so: it can be dragged too. | ≤ 2 lines | Plain reason | «چون چند بار روی کلوچه زدید: می‌شود آن را کشید هم.» |  |
| `tip.why.T4` | tip (reason) | system | You've typed a few times, and the mic is here too. | ≤ 2 lines | Plain reason | «چند بار تایپ کردید؛ میکروفون هم اینجاست.» |  |
| `tip.why.T6` | tip (reason) | system | Two short rounds in a row, so: there's a no-timer mode. | ≤ 2 lines | Plain reason | «دو دور کوتاه بازی کردید؛ حالت بی‌عجله ساعت ندارد.» | Copywriter: Avoids «پشت سر هم», which the streak lint catches |

## Quiet screens and errors (existing `copy.ts`)

| Key | Surface | English | Limit | Intent | FA | Variants and notes |
|---|---|---|---|---|---|---|
| `quiet.private.title` | quiet screen | This one's private | ≤ 1 line | Gentle, not a rejection | «این صفحه خصوصی است» |  |
| `quiet.private.body` | quiet screen | Only the people this agent works with can visit. | ≤ 2 lines |  | «فقط کسانی که با این همکار کار می‌کنند می‌توانند به آن سر بزنند.» |  |
| `quiet.outside.title` | quiet screen | Open me in Telegram | ≤ 1 line |  | «این صفحه را در تلگرام باز کنید» | Copywriter: **Intent flag:** "Open me" makes the page a person; system voice talks about the page |
| `quiet.outside.body` | quiet screen | Tap the menu button in the bot's chat. | ≤ 2 lines |  | «در گفتگو با ربات، دکمهٔ منو را بزنید.» |  |
| `quiet.resting.title` | quiet screen | Resting | ≤ 1 line |  | «در حال استراحت» |  |
| `quiet.resting.body` | quiet screen | This one is not around right now. | ≤ 2 lines |  | «این ابرک فعلاً اینجا نیست.» |  |
| `quiet.unavailable.title` | quiet screen | Can't open this pet | ≤ 1 line |  | «این ابرک باز نمی‌شود» |  |
| `quiet.unavailable.body` | quiet screen | Try again in a moment, or reopen it from the bot's chat. | ≤ 2 lines |  | «کمی بعد دوباره امتحان کنید، یا از گفتگو با ربات دوباره بازش کنید.» |  |
| `quiet.offline.title` | quiet screen | Can't reach the cloud | ≤ 1 line | A little pun on the cloud | «ارتباط با ابر قطع شد» | Copywriter: The cloud pun survives |
| `quiet.offline.body` | quiet screen | Check the connection and try again. | ≤ 2 lines |  | «اینترنت را بررسی کنید و دوباره امتحان کنید.» |  |
| `quiet.chatAccess.title` | quiet screen | Chat access is off | ≤ 1 line |  | «دسترسی گفتگو خاموش است» |  |
| `quiet.chatAccess.body` | quiet screen | Open Vox Studio, go to You, choose Work, then Agent access and allow this agent. Then reopen this Mini App. | ≤ 4 lines | Step by step | «Vox Studio را باز کنید، به «شما» ← «کار» ← «دسترسی همکارها» بروید و به این همکار اجازه بدهید. بعد این صفحه را دوباره باز کنید.» | Copywriter: The menu names must match the Persian Studio UI exactly; check them before shipping. «←» points left in RTL |
| `ui.retry` | button | Try again | ≤ 14 chars |  | «تلاش دوباره» |  |
| `ui.close` | button | Close Mini App | ≤ 18 chars |  | «بستن» | Copywriter: "Mini App" is not a word users know |
| `ui.more` | bubble | more › | ≤ 8 chars | Paged bubble next page | «بیشتر ‹» | Copywriter: Chevron mirrored for RTL |
| `ui.less` | bubble | less | ≤ 8 chars | (existing; may be removed with paging) | «کمتر» |  |


## Proposed by copywriter

Keys from section C of the copywriter's file, for surfaces this file lacked. Every row is **proposed by copywriter**; English glosses are mine, added so English stays the source of truth for intent. Engineering may rename keys; the Persian is the deliverable.

| Key | Surface | Voice | English | Limit | Intent | FA | Variants and notes |
|---|---|---|---|---|---|---|---|
| `say.hi.morning` | bubble | pet | Good morning! | Peek 1 line | Open, 05:00-11:00, no first name | «صبح بخیر!» | Proposed by copywriter (§C); v2 «صبح بخیر! تازه بیدار شدم.» |
| `say.hi.morning.name` | bubble | pet | Good morning, {first}! | Peek 1 line | Open, 05:00-11:00 | «صبحت بخیر {first}!» | Proposed by copywriter (§C) |
| `say.hi.noon` | bubble | pet | Hi! Happy midday. | Peek 1 line | Open, 11:00-15:00, no first name | «سلام! ظهرت بخیر.» | Proposed by copywriter (§C); v2 «سلام! آفتاب وسط آسمونه.» |
| `say.hi.noon.name` | bubble | pet | Hi {first}! Happy midday. | Peek 1 line | Open, 11:00-15:00 | «سلام {first}! ظهرت بخیر.» | Proposed by copywriter (§C) |
| `say.hi.afternoon` | bubble | pet | Good afternoon! | Peek 1 line | Open, 15:00-19:00, no first name | «عصر بخیر!» | Proposed by copywriter (§C); v2 «سلام! یه عصر دلچسب.» |
| `say.hi.afternoon.name` | bubble | pet | Good afternoon, {first}! | Peek 1 line | Open, 15:00-19:00 | «عصرت بخیر {first}!» | Proposed by copywriter (§C) |
| `say.hi.evening` | bubble | pet | Hi! The moon's out. | Peek 1 line | Open, 19:00-22:00; never «شب بخیر», which is a goodbye | «سلام! ماه دراومده.» | Proposed by copywriter (§C); v2 «سلام! ستاره‌ها دارن درمیان.» |
| `say.hi.evening.name` | bubble | pet | Hi {first}! The moon's out. | Peek 1 line | Open, 19:00-22:00 | «سلام {first}! ماه دراومده.» | Proposed by copywriter (§C) |
| `say.back.hours` | bubble | pet | Oh, hi! | Peek 1 line | Back after a few hours; never says how long | «اِ، سلام!» | Proposed by copywriter (§C); v2 «به‌به، باز هم سلام!»; v3 «سلام! داشتم ابرهام رو مرتب می‌کردم.» |
| `say.back.days` | bubble | pet | Welcome! I gathered a handful of cloud fluff for you. | Peek 2 lines | Back after about three days; warm, no time count | «به‌به، خوش اومدی! یه مشت پشمک ابری برات جمع کردم.» | Proposed by copywriter (§C); v2 «سلام! یه تیکه آفتاب برات نگه داشتم، قابلت رو نداره.»; v3 «خوش اومدی! بیا ببین چی یاد گرفتم.» |
| `say.back.weeks` | bubble | pet | Welcome! I learned lots of new things. Want to see? | Peek 2 lines | Back after two weeks or more; celebration, no guilt | «به‌به، خوش اومدی! کلی چیز تازه بلد شدم، نشونت بدم؟» | Proposed by copywriter (§C); v2 «سلام! قدمت روی چشم. یه شیرین‌کاری تازه دارم.» (keep «قدمت روی چشم» to this one moment); v3 «خوش اومدی! چای تازه‌دم نداریم، ولی پشمک ابری داریم!» |
| `say.back.fresh` | bubble | pet | Hi! I'm {name}. Nice to meet you! | Peek 1 line | Returning guest after the 90-day sweep: meets them fresh, no "you're back" | «سلام! من {name} هستم. خوشبختم!» | Proposed by copywriter (§C) |
| `stage.2` | bubble | pet | Oh! I grew a mouth! | Peek 1 line | Stage-up to Puff | «اِ! دهن درآوردم!» | Proposed by copywriter (§C); Life Book page is `book.page.stage2` |
| `stage.3` | bubble | pet | Look, I have eyebrows! Now I can look surprised. | Peek 2 lines | Stage-up to Shaped | «ببین، ابرو دارم! حالا می‌تونم تعجب کنم.» | Proposed by copywriter (§C) |
| `stage.4` | bubble | pet | I'm all the way me now. | Peek 1 line | Stage-up to Formed | «دیگه خود خودمم.» | Proposed by copywriter (§C); Same as `say.formed` |
| `say.feed.more` | bubble | pet | Yum! / So tasty! / Thank you! / Enjoy, me! | ≤ 16 chars each | Voice-pack variants after feeding | «به‌به!» / «چه خوشمزه!» / «دستت درد نکنه!» / «نوش جون خودم!» | Proposed by copywriter (§C) |
| `say.ball.hit` | bubble | pet | Got it! / Did you see? / Another one! | ≤ 16 chars each | Bop hit | «گرفتمش!» / «دیدی؟ دیدی؟» / «یکی دیگه!» | Proposed by copywriter (§C) |
| `say.ball.miss` | bubble | pet | Oops, it got away! / That one doesn't count! | ≤ 22 chars each | Bop miss; playful, never sad | «اوه، در رفت!» / «این یکی قبول نیست!» | Proposed by copywriter (§C) |
| `say.sleep.in` | bubble | pet | Good night… asleep. / Lullaby… | ≤ 20 chars each | Falling asleep; here «شب بخیر» is right, the pet is the one leaving | «شب بخیر… خوابیدم.» / «لالا…» | Proposed by copywriter (§C) |
| `say.wake` | bubble | pet | I slept well! / Is it morning? | ≤ 16 chars each | Waking | «خوب خوابیدم!» / «صبح شد؟» | Proposed by copywriter (§C) |
| `say.poke` | bubble | pet | Hey! / That tickles! | ≤ 16 chars each | Poke | «اِ!» / «قلقلکم میاد!» | Proposed by copywriter (§C) |
| `say.stroke` | bubble | pet | Ahh… / So nice… | ≤ 12 chars each | Stroke | «آخیش…» / «چه کیفی…» | Proposed by copywriter (§C) |
| `bye.day` | bubble | pet | Go well! Have fun. / Bye! Take care. / Okay, have a good day! | Peek 1 line | Daytime goodbye: one line that releases the person with a blessing, nothing after it | «برو به سلامت! خوش بگذره.» / «خداحافظ! مواظب خودت باش.» / «باشه، روز خوبی داشته باشی!» | Proposed by copywriter (§C); Guides the model and seeds the voice pack |
| `bye.night` | bubble | pet | Good night, sleep well. / Good night! Sweet dreams. | Peek 1 line | Night goodbye | «شبت خوش، خوب بخوابی.» / «شب بخیر! خواب‌های قشنگ ببینی.» | Proposed by copywriter (§C) |
| `bye.work` | bubble | pet | Go, good luck! / Hope work goes well! | Peek 1 line | "I have to go work" | «برو، موفق باشی!» / «کارت خوب پیش بره!» | Proposed by copywriter (§C); Never: «زود برگرد», «بازم بیا», «منتظرتم», «به این زودی؟», «حالا کجا؟» |
| `season.yalda.hello` | bubble | pet | Happy Yalda! Pomegranate and a Hafez fal are ready. | Peek 2 lines | Yalda on the page | «یلدات مبارک! انار و فال حافظ آماده‌ست.» | Proposed by copywriter (§C); Never ask the person to stay longer on the longest night |
| `season.yalda.korsi` | bubble | pet | There's room for one more under the korsi. | Peek 2 lines | Yalda; cozy hospitality | «زیر کرسی جای یه نفر دیگه هم هست.» | Proposed by copywriter (§C) |
| `season.suri.hello` | bubble | pet | Happy Chaharshanbe Suri! The fires here don't burn. | Peek 2 lines | Chaharshanbe Suri on the page; in-app fire only | «چهارشنبه‌سوری مبارک! آتیش‌های اینجا نمی‌سوزونه.» | Proposed by copywriter (§C) |
| `season.nowruz.sabzeh` | bubble | pet | Our sabzeh grows a little taller every day. | Peek 2 lines | Nowruz days | «سبزه‌مون هر روز یه ذره قد می‌کشه.» | Proposed by copywriter (§C) |
| `season.mourningFallback` | bubble | pet | Hi. | Peek 1 line | A festival on an official mourning day: no festive words, no emoji | «سلام.» | Proposed by copywriter (§C); Design rule §5.5; calendar source is open decision 13 |
| `perm.P1.after.yes` | bubble | pet | I promise to keep it short! | Peek 1 line | After yes to check-ins; answers the worry that yes means spam | «قول می‌دم کم‌حرف باشم!» | Proposed by copywriter (§C) |
| `perm.P2.after.yes` | bubble | pet | All set! | Peek 1 line | After Telegram OK | «حله!» | Proposed by copywriter (§C) |
| `perm.P2.after.no` | bubble | pet | No problem, we'll see each other right here. | Peek 2 lines | After declining Telegram OK | «اشکالی نداره، همین‌جا می‌بینیم همدیگه رو.» | Proposed by copywriter (§C) |
| `perm.P3.before` | bubble | pet | Want to talk with your voice? | Peek 1 line | Before the UX-02 sheet | «می‌خوای با صدا حرف بزنیم؟» | Proposed by copywriter (§C) |
| `perm.P3.after.yes` | bubble | pet | Go ahead, I'm all ears. | Peek 1 line | After yes to the mic | «بگو، گوشم با توئه.» | Proposed by copywriter (§C) |
| `perm.P3.after.no` | bubble | pet | Okay, type it; I'll read. | Peek 1 line | After choosing text | «باشه، تایپ کن؛ منم می‌خونم.» | Proposed by copywriter (§C) |
| `perm.P4.after.yes` | bubble | pet | Ahem… does my voice sound okay? | Peek 1 line | After yes to speaking out loud | «اِهم اِهم… صدام خوبه؟» | Proposed by copywriter (§C) |
| `perm.P4.after.no` | bubble | pet | Okay, I'll write quietly. | Peek 1 line | After text only | «باشه، آروم می‌نویسم.» | Proposed by copywriter (§C) |
| `perm.P5.after.yes` | bubble | pet | I'll remember. | Peek 1 line | After a memory save | «یادم می‌مونه.» | Proposed by copywriter (§C); Decline is `talk.memoryDeclined` |
| `perm.photo.before` | bubble | pet | I can't see photos here. Send it to me in our chat? | Peek 2 lines | Person tries to show a photo; no Mini App path | «اینجا نمی‌تونم عکس ببینم. توی چت برام بفرست؟» | Proposed by copywriter (§C) |
| `perm.photo.go` | sheet | system | Go to the chat | ≤ 20 chars | Button that opens the DM | «رفتن به گفتگو» | Proposed by copywriter (§C); Decline «فعلاً نه» |
| `perm.photo.after.no` | bubble | pet | Okay, whenever you like. | Peek 1 line | After declining | «باشه، هر وقت خواستی.» | Proposed by copywriter (§C) |
| `perm.P6.after.joined` | bubble | pet | Welcome to the group! | Peek 1 line | After joining group notes | «خوش اومدی به جمعمون!» | Proposed by copywriter (§C) |
| `perm.P6.after.replyOnly` | bubble | pet | Okay. I'll only reply to you. | Peek 1 line | After reply-only | «باشه. هر وقت خواستی، فقط به خودت جواب می‌دم.» | Proposed by copywriter (§C); Layout check (estimate): about 43 chars, more than 1 Peek bubble line(s) of about 34. Kept as written. |
| `perm.P6.after.notMe` | bubble | pet | Okay, I'll stay quiet. | Peek 1 line | After "not me" | «باشه، ساکت می‌مونم.» | Proposed by copywriter (§C) |
| `perm.P7.after.yes` | bubble | pet | Hope it makes them smile! | Peek 1 line | After sharing | «امیدوارم بخندن!» | Proposed by copywriter (§C) |
| `perm.P7.after.no` | bubble | pet | Okay, it stays in the Life Book. | Peek 1 line | After not sharing | «باشه، توی دفتر خاطرات می‌مونه.» | Proposed by copywriter (§C) |
| `perm.P8.after.yes` | bubble | pet | Now we're always one tap away. | Peek 1 line | After adding to home screen | «حالا همیشه یه ضربه فاصله‌ایم.» | Proposed by copywriter (§C) |
| `perm.P8.after.no` | bubble | pet | Okay! | Peek 1 line | After declining | «باشه!» | Proposed by copywriter (§C) |
| `perm.P9.after.yes` | bubble | pet | I'll notice which games you like. | Peek 1 line | After personalization yes | «حواسم هست کدوم بازی رو دوست داری.» | Proposed by copywriter (§C) |
| `perm.P9.after.no` | bubble | pet | Okay, I'll ask fresh each time. | Peek 1 line | After keeping it off | «باشه، هر بار از اول می‌پرسم.» | Proposed by copywriter (§C) |
| `perm.P10.after.yes` | bubble | pet | How nice, we'll have guests! | Peek 1 line | After allowing visits | «چه خوب، مهمون داریم!» | Proposed by copywriter (§C) |
| `perm.P10.after.no` | bubble | pet | Okay, our home stays quiet. | Peek 1 line | After declining visits | «باشه، خونه‌مون خلوت می‌مونه.» | Proposed by copywriter (§C) |
| `perm.P10.yes` | permission | system | Yes, they can visit | ≤ 20 chars | Button for P10 (from §B note) | «بله، سر بزنند» | Proposed by copywriter (§C) |
| `perm.no` | permission | system | Not now | ≤ 14 chars | Shared decline button for P2, P7, P8, P10 (from §B notes) | «فعلاً نه» | Proposed by copywriter (§C) |
| `why.label` | chip | system | Why am I seeing this? | ≤ 24 chars | In-app why affordance | «چرا این را می‌بینم؟» | Proposed by copywriter (§C) |
| `why.tipHeader` | tip (reason) | system | This tip came up because: | ≤ 1 line | Header for a tip reason | «این راهنما به این دلیل آمد:» | Proposed by copywriter (§C) |
| `why.settingsTitle` | sheet | system | Why does {name} do these things? | ≤ 1 line | Settings page title | «چرا {name} این کارها را می‌کند؟» | Proposed by copywriter (§C) |
| `why.settingsIntro` | sheet | system | Everything {name} does on its own is listed here with its reason. You can turn off or reset any suggestion. | ≤ 3 lines | Settings intro | «هر کاری که {name} خودش انجام می‌دهد، اینجا با دلیلش آمده است. هر پیشنهادی را می‌توانید خاموش یا از نو شروع کنید.» | Proposed by copywriter (§C) |
| `why.reset` | sheet | system | Start over | ≤ 16 chars | Reset a learned suggestion | «شروع دوباره» | Proposed by copywriter (§C) |
| `why.checkinsRule` | sheet | system | Messages: at most once a day, never between 9 pm and 8 am. If three in a row go unopened, {name} pauses them. | ≤ 3 lines | Check-in rule in Settings | «پیام‌ها: حداکثر روزی یک بار، هیچ‌وقت بین ۹ شب تا ۸ صبح. اگر سه پیام پشت هم باز نشود، {name} خودش پیام‌ها را متوقف می‌کند.» | Proposed by copywriter (§C); Note: «پشت هم» here is system prose; the streak lint matches «روز پشت سر هم», not this |
| `why.homeScreen` | tip (reason) | system | You've visited on a few days, so this shortcut might save you a tap. | ≤ 2 lines | Reason for P8 | «چند روز سر زدید؛ برای همین پیشنهاد شد شاید این میان‌بر یک ضربه را برایتان کم کند.» | Proposed by copywriter (§C) |
| `err.voiceTooShort` | bubble | pet | Oh, that was too short! Hold a bit longer. | Peek 2 lines | Mic tap shorter than the minimum hold | «اِ، خیلی کوتاه بود! یه کم بیشتر نگه دار.» | Proposed by copywriter (§C) |
| `err.talkBusy` | bubble | pet | One moment, I'm thinking… | Peek 1 line | A send while a reply is in flight | «یه لحظه، دارم فکر می‌کنم…» | Proposed by copywriter (§C) |
| `err.storyLimit` | bubble | pet | We had our story tonight. Another one tomorrow! | Peek 2 lines | Second story request in a day | «امشب قصه‌مون رو گفتیم. فردا یه قصهٔ دیگه!» | Proposed by copywriter (§C) |
| `err.guestTalk` | bubble | system | To talk with {name}, open the chat in Telegram. | Peek 2 lines | Guest tries to talk | «برای حرف زدن با {name}، گفتگو را در تلگرام باز کنید.» | Proposed by copywriter (§C) |
| `closet.lock.yalda` | closet | system | Arrives with Yalda | ≤ 24 chars | How to earn a seasonal item | «با شب یلدا از راه می‌رسد» | Proposed by copywriter (§C) |
| `closet.lock.suri` | closet | system | Arrives with Chaharshanbe Suri | ≤ 32 chars | How to earn a seasonal item | «با چهارشنبه‌سوری از راه می‌رسد» | Proposed by copywriter (§C) |
| `closet.lock.bond` | closet | system | By spending time together | ≤ 28 chars | How to earn a Bond item | «با وقت گذراندن با هم» | Proposed by copywriter (§C) |
| `closet.mirror` | bubble | pet | Does it suit me? / How's this? Do I look nice? | Peek 1 line | Trying an item on in the mirror | «بهم میاد؟» / «چطوره؟ خوشگل شدم؟» | Proposed by copywriter (§C) |


## Added after Reza's review: growth moments and voice

English keys for the two changes Reza approved on 26 October 2026: growth moments (design doc §4.11) and voice (§8A). **FA is for the Persian copywriter**; every row is marked. Generated moment titles and hints are written per agent by the persona drafter; the copywriter's Persian exemplars (`growth.example.*`) will seed that prompt.

| Key | Surface | Voice | English | Limit | Intent | FA | Variants and notes |
|---|---|---|---|---|---|---|---|
| `growth.name` | settings | system | Growth moments | ≤ 20 chars | System name for the feature in Settings and docs; plain, not "achievements", not a score | «آموخته‌ها» | Added after Reza's review (26 Oct); FA: copywriter |
| `growth.tab` | book | pet | What I've learned | ≤ 18 chars | Life Book tab; proud and humble, about the team, not about itself | «از شماها یاد گرفتم» | Added after Reza's review (26 Oct); FA: copywriter; «شماها» is the spoken plural "you all": the tab thanks the team, as the intent asks, and never reads as formal شما |
| `growth.intro` | bubble | pet | I know my job. I don't know your team yet. Teach me as we go? | Peek 2 lines | First open, after hello: an expert who is new here, not a baby; an invitation, never pressure | «کارم رو بلدم؛ راه و رسم تیمت رو هنوز نه. کم‌کم نشونم می‌دی؟» | Added after Reza's review (26 Oct); FA: copywriter; Flag: "Teach me" from an expert reads as a trainee in Persian. «کارم رو بلدم» leads; «راه و رسم» frames it as learning the house's ways, which a respected newcomer does; «نشونم می‌دی» (show me) is peer-to-peer |
| `growth.confirm.ask` | bubble | pet | Shall I keep this as “{title}”? | Peek 2 lines | After an explicit "remember this": the pet proposes which moment it fulfils; the person must confirm | «اینو توی دفترم بنویسم: «⁨{title}⁩»؟» | Added after Reza's review (26 Oct); FA: copywriter; {title} is the agent's own generated moment title; Flag: embedding a first-person title as a noun ("keep this as I learned…") breaks in Persian; "write it in my book:" quotes it cleanly |
| `growth.confirm.yes` | button | person | Yes, that's it | ≤ 16 chars | Person confirms the match | «آره، همینه» | Added after Reza's review (26 Oct); FA: copywriter |
| `growth.confirm.no` | button | person | Not that one | ≤ 16 chars | Person declines; the memory is still saved, no moment lights | «نه، این نه» | Added after Reza's review (26 Oct); FA: copywriter |
| `growth.lit.chip` | chip | system | New page in What I've learned | ≤ 32 chars | After a moment lights; no number | «یک آموختهٔ تازه ثبت شد» | Added after Reza's review (26 Oct); FA: copywriter |
| `growth.why.taught` | tip (reason) | system | Lit when someone taught {name} this. | ≤ 1 line | Why line for a moment lit for the whole agent; never names the teacher | «وقتی کسی این را به ⁨{name}⁩ یاد داد، روشن شد.» | Added after Reza's review (26 Oct); FA: copywriter |
| `growth.why.taughtMine` | tip (reason) | system | Lit when you taught {name} this. | ≤ 1 line | Why line the teacher sees for their own private teach | «وقتی شما این را به ⁨{name}⁩ یاد دادید، روشن شد.» | Added after Reza's review (26 Oct); FA: copywriter |
| `growth.why.task` | tip (reason) | system | Lit the first time {name} did this with your team. | ≤ 1 line | Why line for a first task of a kind | «اولین باری که ⁨{name}⁩ این کار را با تیمتان انجام داد، روشن شد.» | Added after Reza's review (26 Oct); FA: copywriter |
| `growth.why.access` | tip (reason) | system | Lit when {name} got an access it needed. | ≤ 1 line | Agent-level grant by the creator or an admin | «وقتی ⁨{name}⁩ دسترسی‌ای را که لازم داشت گرفت، روشن شد.» | Added after Reza's review (26 Oct); FA: copywriter |
| `growth.why.accessMine` | tip (reason) | system | Lit when you gave {name} this permission. | ≤ 1 line | The person's own grant | «وقتی شما این اجازه را به ⁨{name}⁩ دادید، روشن شد.» | Added after Reza's review (26 Oct); FA: copywriter |
| `growth.why.room` | tip (reason) | system | Lit the first time you visited this room. | ≤ 1 line | Room moment, personal | «اولین باری که به این اتاق سر زدید، روشن شد.» | Added after Reza's review (26 Oct); FA: copywriter |
| `growth.why.season` | tip (reason) | system | Lit the first time someone celebrated this with {name}. | ≤ 1 line | Season moment, whole agent | «اولین باری که کسی این جشن را با ⁨{name}⁩ گرفت، روشن شد.» | Added after Reza's review (26 Oct); FA: copywriter |
| `growth.room.title` | book | pet | We found the {room} together | ≤ 40 chars + room | Template title for room moments | «⁨{room}⁩ رو با هم کشف کردیم» | Added after Reza's review (26 Oct); FA: copywriter; {room} is a room name key; Flag: room names come in system spelling («خانه») inside a pet line, and "found the Home" is odd for the first room; «کشف کردیم» works for every room including the book. Suggest no room moment for Home |
| `growth.season.title` | book | pet | We celebrated {festival} together | ≤ 40 chars + festival | Template title for season moments | «⁨{festival}⁩ رو با هم جشن گرفتیم» | Added after Reza's review (26 Oct); FA: copywriter |
| `growth.stage.ready` | bubble | pet | I'm getting ready to learn. | Peek 1 line | Forming-week stage-up when nothing is lit yet; anticipation, no lack | «آماده‌ام تیمت رو بشناسم!» | Added after Reza's review (26 Oct); FA: copywriter |
| `growth.stage.learned` | bubble | pet | Look what I've learned so far! | Peek 1 line | Forming-week stage-up when moments are lit; the Life Book opens to them | «ببین تا حالا چی یاد گرفتم!» | Added after Reza's review (26 Oct); FA: copywriter |
| `growth.unlit.label` | book | system | Not learned yet | ≤ 18 chars | Label above an unlit moment's hint; neutral, no count | «هنوز در راه» | Added after Reza's review (26 Oct); FA: copywriter |
| `growth.settings.curiosity` | settings | system | Curiosity questions | ≤ 24 chars | Settings switch | «سؤال‌های کنجکاوانه» | Added after Reza's review (26 Oct); FA: copywriter |
| `growth.settings.curiosityBody` | settings | system | {name} may ask one short question a day to learn how your team works. Turn it off anytime. | ≤ 3 lines | Explains the learning question and its cap (PRIV-028) | «⁨{name}⁩ ممکن است روزی یک سؤال کوتاه بپرسد تا با شیوهٔ کار تیمتان آشنا شود. هر وقت بخواهید، می‌توانید خاموشش کنید.» | Added after Reza's review (26 Oct); FA: copywriter |
| `growth.example.title.1` | book | pet | We learned how releases go out here | ≤ 60 chars | Exemplar for the drafter prompt: a taught moment | «یاد گرفتیم نسخه‌ها رو چطور منتشر می‌کنیم» | Added after Reza's review (26 Oct); FA: copywriter; Changed in Wave B QA to the copywriter's "we" form: the growth title lint (`src/lib/studio/growth.ts`) requires "we" in titles; The copywriter's Persian exemplars seed the drafter so generated Persian titles follow the pet voice; Exemplar rule for the drafter: in growth titles "you" is the team, plural verbs («می‌چینید»); the hint speaks to one person (تو, «تیمت») |
| `growth.example.hint.1` | book | pet | Tell me how your team plans a release, then say “remember this” | ≤ 90 chars | Exemplar hint: an invitation | «بهم بگو تیمت برنامهٔ انتشار نسخه رو چطور می‌چینه، بعد بگو «یادت باشه».» | Added after Reza's review (26 Oct); FA: copywriter; «یادت باشه» is a supported trigger in `src/lib/circles/note-selector.ts:39` |
| `growth.example.title.2` | book | pet | I wrote our first weekly report together | ≤ 60 chars | Exemplar: a task moment | «اولین گزارش هفتگی‌مون رو با هم نوشتیم» | Added after Reza's review (26 Oct); FA: copywriter; Flag: the English "I wrote … together" contradicts itself; Persian says "we wrote" |
| `growth.example.title.3` | book | pet | I got the access I need to read the team calendar | ≤ 60 chars | Exemplar: an access moment | «دسترسی تقویم تیم رو گرفتم؛ حالا برنامه‌ها دستمه» | Added after Reza's review (26 Oct); FA: copywriter |
| `perm.P3b.title` | permission | system | Keep the mic open while we talk? | ≤ 2 lines | Hands-free opt-in; an open mic is a privacy moment | «برای گفتگوی راحت‌تر، میکروفون روشن بماند؟» | Added after Reza's review (26 Oct); FA: copywriter; Reason first, as asked |
| `perm.P3b.body` | permission | system | Hands-free listens for your voice and sends when you stop talking. The mic stays on until you turn it off, close {name} or go quiet for a minute. Audio leaves your phone only when you speak. | ≤ 4 lines | States when the mic is on and when audio leaves the device | «با «میکروفون باز» لازم نیست دکمه را نگه دارید: ⁨{name}⁩ به صدای شما گوش می‌دهد و وقتی حرفتان تمام شد، آن را می‌فرستد. میکروفون روشن می‌ماند تا خودتان خاموشش کنید، ⁨{name}⁩ را ببندید یا یک دقیقه چیزی نگویید. صدای شما فقط وقتی حرف می‌زنید از گوشی بیرون می‌رود.» | Added after Reza's review (26 Oct); FA: copywriter |
| `perm.P3b.yes` | permission | system | Turn on hands-free | ≤ 20 chars | Accept | «بله، روشن بماند» | Added after Reza's review (26 Oct); FA: copywriter |
| `perm.P3b.no` | permission | system | Keep hold-to-talk | ≤ 20 chars | Decline, equal weight | «فعلاً نه» | Added after Reza's review (26 Oct); FA: copywriter; Decline as instructed; if the fallback must be named, «با نگه داشتن دکمه» |
| `voice.handsFree` | pill | system | Hands-free | ≤ 14 chars | Toggle label on the talk pill | «میکروفون باز» | Added after Reza's review (26 Oct); FA: copywriter; Flag: "Hands-free" must not be translated: «هندزفری» means earphones in Iran. «میکروفون باز» names what it does, which is also the honest privacy framing |
| `voice.listening` | chip | system | Listening | ≤ 14 chars | Visible open-mic state | «در حال شنیدن» | Added after Reza's review (26 Oct); FA: copywriter |
| `voice.autoOff` | chip | system | Hands-free is off. Tap to turn it on. | ≤ 2 lines | After 60 s of silence or leaving the page; neutral | «میکروفون باز خاموش شد. برای روشن کردن بزنید.» | Added after Reza's review (26 Oct); FA: copywriter |
| `voice.unavailable` | chip | system | Hands-free isn't available here. Hold to talk works. | ≤ 2 lines | Fallback when AudioWorklet or the mic is missing (some iOS Telegram WebViews) | «میکروفون باز اینجا کار نمی‌کند. با نگه داشتن دکمه حرف بزنید.» | Added after Reza's review (26 Oct); FA: copywriter |


## Added after Wave A QA

Keys QA found missing between this file and the code (Life Book page ids are above, beside `book.page.met`). English is the source of truth; **FA is for the Persian copywriter**, marked on every row. Already covered elsewhere, so not repeated: "no story tonight" is `bed.storyFallback` (story unavailable) and `err.storyLimit` (already told one today); tips T1-T14 exist as `tip.T*` (T11 is the talk chips, `talk.chip.*`); hands-free states are `voice.*` and `perm.P3b.*`; Starfall's zen toggle label is `play.zen`, Again/Done are `play.again` / `play.done`, a best round is `play.bestPage`.

| Key | Surface | Voice | English | Limit | Intent | FA | Variants and notes |
|---|---|---|---|---|---|---|---|
| `ui.send` | button (a11y) | system | Send | ≤ 10 chars | Talk pill send button; screen-reader name | «فرستادن» | Added after Wave A QA (26 Oct); FA: copywriter; Today hard-coded: `src/app/studio/pet/_ui/copy.ts:42`; `TalkPill.test.tsx:65` finds it by name |
| `ui.toys` | group label (a11y) | system | Toys | ≤ 12 chars | Screen-reader name of the dock group | «اسباب‌بازی‌ها» | Added after Wave A QA (26 Oct); FA: copywriter; Today hard-coded: `Dock.tsx:90`; `Dock.test.tsx:17` finds it by name |
| `ui.rooms` | tablist label (a11y) | system | Rooms | ≤ 12 chars | Screen-reader name of the room rail | «اتاق‌ها» | Added after Wave A QA (26 Oct); FA: copywriter; Today hard-coded: `rooms/RoomRail.tsx:11`; `RoomRail.test.tsx:18` finds it by name |
| `ui.dismiss` | button (a11y) | system | Dismiss | ≤ 12 chars | Coach chip × button; screen-reader name | «بستن» | Added in Wave B QA (26 Oct); the client borrowed `perm.no` for it (`Extras.tsx`) |
| `book.prev` | button (a11y) | system | Previous page | ≤ 16 chars | Life Book previous-page button; screen-reader name | «صفحهٔ قبل» | Added in Wave B QA (26 Oct); the client used a bare ‹ as its name (`rooms/BookRoom.tsx`) |
| `need.tummy` | ring label (a11y) | system | Tummy | ≤ 12 chars | Need name read by screen readers; never a number | «غذا» | Added after Wave A QA (26 Oct); FA: copywriter; Today `NEED_LABEL` in `copy.ts:32`; Flag: «شکم» (tummy) is a body part, not a need, and breaks the wants template; «غذا» reads naturally in both the ring label and «کمی غذا می‌خواهد» |
| `need.joy` | ring label (a11y) | system | Joy | ≤ 12 chars | Need name | «شادی» | Added after Wave A QA (26 Oct); FA: copywriter; Today `NEED_LABEL` in `copy.ts:32` |
| `need.energy` | ring label (a11y) | system | Energy | ≤ 12 chars | Need name | «انرژی» | Added after Wave A QA (26 Oct); FA: copywriter; Today `NEED_LABEL` in `copy.ts:32` |
| `need.wantsSuffix` | ring label (a11y) | system | , wants some | ≤ 16 chars | Appended after a need name when it is in "wants": gentle, no alarm, no number | «کمی ⁨{need}⁩ می‌خواهد» | Added after Wave A QA (26 Oct); FA: copywriter; Today hard-coded: `Dock.tsx:101`. Persian word order may not suit a suffix; if so the copywriter can say so and engineering switches to a template `{need}…`; Flag: a suffix cannot work. Persian puts the need inside the verb phrase («کمی شادی می‌خواهد»), so this cell is a template with {need}; read it instead of «{need}» + suffix. If engineering must keep a suffix, the least bad is «، کمی کم است», which sounds more like an alarm |
| `play.starfall.title` | game | system | Starfall | ≤ 14 chars | Starfall game header (same word as `toy.play.starfall`) | «ستاره‌باران» | Added after Wave A QA (26 Oct); FA: copywriter |
| `play.starfall.start` | bubble | pet | Catch the stars with me! | Peek 1 line | Round start; excited, no countdown | «بیا با هم ستاره بگیریم!» | Added after Wave A QA (26 Oct); FA: copywriter |
| `play.starfall.howTo` | bubble | pet | Drag me under the stars. | Peek 1 line | First round only; instruction in its voice | «منو بکش ببر زیر ستاره‌ها.» | Added after Wave A QA (26 Oct); FA: copywriter; «منو» is the spoken object form of «من را» (pronoun + را), allowed like «اینو» |
| `play.starfall.zenOn` | chip | system | Zen: no timer, no misses | ≤ 28 chars | Shown when zen is on | «بی‌عجله: نه ساعت، نه باخت» | Added after Wave A QA (26 Oct); FA: copywriter |
| `play.starfall.pips` | game (a11y) | system | Round progress | ≤ 20 chars | Screen-reader name of the pips; never a count | «پیشرفت این دور» | Added after Wave A QA (26 Oct); FA: copywriter; Pips only on screen; no digits |
| `play.starfall.good` | bubble | pet | Look at all that starlight! | Peek 1 line | Round end, a good round; proud of the person | «ببین چقدر نور ستاره جمع کردیم!» | Added after Wave A QA (26 Oct); FA: copywriter; Voice-pack lines may replace it per agent (see `play.voice.shyStar`) |
| `play.starfall.nearMiss` | bubble | pet | So close! That one was shy. | Peek 1 line | Round end, near miss; playful, never sad | «نزدیک بود! اون یکی خجالتی بود.» | Added after Wave A QA (26 Oct); FA: copywriter |
| `play.starfall.zenEnd` | bubble | pet | That was dreamy. | Peek 1 line | Leaving a zen round | «چه رویایی بود.» | Added after Wave A QA (26 Oct); FA: copywriter |
| `bed.tuck.start` | bubble | pet | Mmm, blanket time. | Peek 1 line | Moon tapped in the Bedroom; cozy | «اوم… وقت پتوئه.» | Added after Wave A QA (26 Oct); FA: copywriter |
| `bed.lamp.dim` | bubble | pet | Lights low… | Peek 1 line | Lamp dims the room | «نور کم شد…» | Added after Wave A QA (26 Oct); FA: copywriter |
| `bed.tuck.notSleepy` | bubble | pet | Not sleepy yet, but cozy is nice. | Peek 1 line | Moon tapped while Energy is high; content, no "one more game" | «هنوز خوابم نمیاد، ولی گرم و نرمه.» | Added after Wave A QA (26 Oct); FA: copywriter |
| `book.learned.empty` | book | pet | Nothing here yet. Teach me something and say “remember this”. | ≤ 2 lines | Empty What I've learned tab; an invitation, never pressure, no count | «دفترم هنوز سفیده. از کار تیمت تعریف کن، آخرش بگو «یادت باشه».» | Added after Wave A QA (26 Oct); FA: copywriter; Flag: "Teach me something" makes the agent sound like a trainee; the Persian keeps it confident: "My book is still blank. Tell me about your team's work, then say «یادت باشه»". «یادت باشه» is a supported trigger |

## Lint

The Persian list is the copywriter's section D, verbatim. Engineering turns both lists into a build-time lint over every string in this file, the voice pack, seasonal lines and model goodbye replies. Normalise before matching Persian: ي→ی, ك→ک, ة→ه, strip ZWNJ, diacritics and tatweel, collapse whitespace; match stems as substrings unless marked "whole word". False-positive guard: «منتظر» alone is allowed; only the second-person forms are banned.

| Rule | English banned phrases | FA banned phrases |
|---|---|---|
| Guilt | you forgot me; you left me | فراموشم کردی، فراموشم کرده‌ای، یادم رفتی، یادت رفتم، یادی از ما، تنهام گذاشتی، تنهایم گذاشتی، ولم کردی، رهام کردی، بی‌معرفت، بی‌وفا، دلم شکست |
| Missing you | I missed you; I've been waiting | دلم برات تنگ، دلم برایت تنگ، دلم براتون تنگ، دلتنگت، دلتنگتم، دلتنگ شما، منتظرت بودم، منتظرتم، منتظرت هستم، چشم انتظار، چشمم به در، جات خالی، جایت خالی، دلمون پوسید |
| Suffering needs | I'm hungry; I'm starving; I'm sad; I'm lonely | گرسنمه، گشنمه، گرسنه‌ام، گشنه‌ام، از گشنگی، از گرسنگی، دارم می‌میرم، ناراحتم، غمگینم، دلم گرفته، تنهام (whole word)، تنها موندم، تنها ماندم، حوصله‌ام سر رفت، حوصلم سر رفت، مریضم |
| FOMO | last chance; only today; before it's gone; don't miss; limited | آخرین فرصت، فقط امروز، از دستش نده، از دست نده، از دست ندید، از دست ندهید، فرصت محدود، محدود (whole word)، تا تموم نشده، تا دیر نشده، جا نمونی، جا نمونید، فقط تا (followed by a date or number) |
| Pressure (includes the polite exit protests «به این زودی؟» and «حالا کجا؟») | hurry; come back now; reply | زود بیا، زود برگرد، همین الان برگرد، همین حالا بیا، برگرد پیشم، جواب بده (whole word, so «جواب بدهد» passes)، جوابم رو بده، چرا جواب نمی‌دی، بازم بیا، باز هم بیا، حتماً بیا، عجله کن، به این زودی، حالا کجا |
| Absence reproach (Persian greetings that scold a returner) | (no English equivalent) | چه عجب، کم‌پیدا (also کم پیدا; covers «کم‌پیدایی»)، کجا بودی، راه گم کردی، پارسال دوست، از این ورا، خیلی وقته نیومدی، یه عمره |
| Counting absence | it's been {n} days; you haven't come | (number or number word) + روز / هفته / ماه + (ه | ه که | است که) + نیومدی / نیامدی / نبودی / ندیدمت; also «روزه که»، «هفته‌ست که» |
| Streaks | streak; don't break | زنجیره، استریک، رکورد روزانه، روزهای پیاپی، روز پشت سر هم، قطعش نکن، نذار قطع بشه، نشکنه |
