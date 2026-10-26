# Pet life paths, Pou and historical lives: research and design

Research date: 26 October 2026. Scope: the Vox pet as a game, a simulated life for each agent during its forming week, and lives based on famous historical people. This is a research and product-design brief. It is not legal advice, and it changes no code.

**Evidence boundaries.** Nine research tracks fed this brief. One read 1in8b.life's decoded JavaScript. Another played three full lives on the site in a headless browser. A fact-check pass then re-verified 32 load-bearing claims against primary sources, and this brief uses its corrected wording. Other external claims keep the research track's own source link, and fan wikis are flagged where they appear. Every code claim was checked against `/home/user/vox` at commit `9954c03`. The recommended design is a Vox proposal, not a finding. The last sections list what was dropped or left unverified.

## The answer

Build it as one game with three layers. Do not build "become a famous person".

1. **The pet stays a gentle Pou-style toy.** Copy Pou's mini-games, wardrobe, rooms and calm short sessions. Do not copy its sickness, potions, guilt or paid skips. Vox already has the gentle half of Pou's care loop.
2. **The forming week becomes a life.** The creator plays the agent's life during its first seven days after hire. A junior lives to 25, a senior to 38 and a principal to 50. Choices nudge four plain-word personality axes. At the existing lock the agent becomes a named temperament, with receipts back to the moments that caused it.
3. **Famous lives arrive as "Echoes".** History stays fixed, and the person's own decisions are playable. A sourced "what really happened" card follows each choice. The agent keeps its own name, face and voice, and never claims to be the person.

One correction to the brief. 1in8b's questions at ages 5, 15, 30, 50 and 70 do not shape the person. They invite reflection, and the player's words come back at the end. Personality comes from a temperament card at age 2 and from how the life's time is spent. The one kind of question in 1in8b that does shape a character is a parent answering a child, for example "can I be a singer when I grow up?". That is the closest model for a creator raising an agent. Vox should copy the split: pauses reflect, cards steer.

| Figure | Position | Main reason |
|---|---|---|
| **Napoleon** | Yes | He died in 1821 ([Wikipedia](https://en.wikipedia.org/wiki/Napoleon)), beyond any publicity statute. Young Napoleon ships first. A senior life follows later, with fixed "Record" cards for the hard chapters. |
| **Einstein** | Yes, without his name as a brand | A US court held his publicity right ended in 2005 ([Goldman](https://blog.ericgoldman.org/amp/archives/2012/10/how_long_does_a.htm)). The Hebrew University still claims exclusive rights to his name ([HUJI](https://en.huji.ac.il/einstein)) and licenses them through CMG Worldwide ([licensing](https://www.alberteinstein.com/licensing/)). His name may appear inside sourced cards. It stays off the bot, titles, paid items and ads until counsel or a licence says otherwise. |
| **Steve Jobs** | No named life | California protects a deceased personality for 70 years ([3344.1](https://california.public.law/codes/civil_code_section_3344.1)), so his right likely runs to about 2081. Apple reportedly asked one app to remove its Jobs bot ([NBC](https://www.nbcnews.com/tech/tech-news/chatgpt-gpt-chat-bot-ai-hitler-historical-figures-open-rcna66531)). Offer "The Garage Founder", an unnamed composite. |
| **Hitler** | Never, in any mode | German criminal law ([§ 130 StGB](https://dejure.org/gesetze/StGB/130.html)), Anthropic's usage policy ([AUP](https://www.anthropic.com/legal/aup)) and every product precedent agree. A Vox agent is a real bot in real groups, so a Hitler-shaped agent would be a propaganda tool. Any agent can still discuss the Second World War as itself, with sources. |

Persian figures should lead. The first Echo packs should be Ibn Sina and young Napoleon, then Khayyam and Ferdowsi. The product scan found no mainstream product offering these figures in Persian. [Humy](https://www.humy.ai/) names only Avicenna. That scan was incomplete: the search budget ran out, and Iranian app stores were not checked.

Before anything ships, an offline "twin test" must prove that the life changes how the hired bot answers. The test plays two lives with the same brief and opposite choices. A blind judge then reads both bots' answers to the same prompts and must tell them apart.

## Why people love Pou

Pou is a care game by Paul Salameh, published as Zakeh Limited ([Wikipedia](https://en.wikipedia.org/wiki/Pou_(video_game))). It reached Google Play on 5 August 2012 ([Play](https://play.google.com/store/apps/details?id=me.pou.app&hl=en)). It reached iOS on 26 November 2012 as a $1.99 paid app ([lookup](https://itunes.apple.com/lookup?id=575154654&country=us)).

| Measure | Pou | Pou 3D ([Play](https://play.google.com/store/apps/details?id=me.pou.app3d&hl=en)) |
|---|---|---|
| Released on Play | 5 Aug 2012 | 3 Dec 2025 |
| Play downloads | 1B+ | 5M+ |
| Play rating | 4.2 from 11.2M reviews | 4.3 from 25.1K reviews |
| Labels | Contains ads, in-app purchases | Contains ads, in-app purchases |

Persian is one of Pou's 25 iOS languages ([App Store](https://apps.apple.com/us/app/pou/id575154654)). A search snapshot showed about 15M installs on Iran's Cafe Bazaar, but the page itself could not be opened.

The official features are: feed Pou and watch it grow, play games for coins, try lab potions, change outfits and wallpapers, unlock achievements, visit friends, and "Talk to Pou and listen back" ([Play](https://play.google.com/store/apps/details?id=me.pou.app&hl=en)). The detailed mechanics come from the fan wiki Poupedia through search extracts, so treat them as medium confidence:

- **Four meters.** Food, Health, Fun and Energy. Below about 51% health Pou is "sick" and wants a potion ([Status](https://poupedia.com/Status)).
- **An energy gate.** "Too Tired!" blocks play until sleep, a 50-coin potion or an ad ([Too Tired!](https://poupedia.com/Too_Tired!)).
- **Thirty-two mini-games** pay coins ([Minigames](https://poupedia.com/Minigames)). Levels run to 270 and gate cosmetics.
- **Growth is a straight line.** Pou turns adult at level 20, or earlier with the $0.99 Adult Potion ([es.wikipedia](https://es.wikipedia.org/wiki/Pou_(videojuego))). XP comes mostly from care.
- **Coins** come from mini-games, level-ups, achievement ladders and rewarded videos. They buy food, potions and cosmetics ([Coins](https://poupedia.com/Coins)).
- **Rooms as verbs.** Kitchen, bathroom, game room, lab, bedroom with closet, and a hall with the talk-back microphone.
- **Social.** You can visit friends' Pous and leave likes and guestbook notes ([Friends](https://poupedia.com/Friends)). Social features are officially 13+, and an email account gives cloud save ([help.pou.me](https://help.pou.me)).

Real money mostly buys coins. The top iOS purchases are Adult and Baby potions at $0.99 and coin packs from $0.99 to $24.99 ([App Store](https://apps.apple.com/us/app/pou/id575154654)). Notifications never fire from 10 PM to 7 AM ([help.pou.me](https://help.pou.me)). Whether neglect can kill Pou is disputed: [Common Sense](https://www.commonsensemedia.org/app-reviews/pou) says yes, and Poupedia calls it a rumour.

Store revenue is small next to the audience. Sensor Tower estimated 10.3M to 11.9M active users in Brazil in Q1 2024, against about $2.4K to $2.9K a week of in-app revenue ([Sensor Tower](https://sensortower.com/blog/2024-q1-unified-top-5-casual%20games-units-br-64341979e1714cfff1609d84)). Those estimates exclude ads. Pou's documented viral engine in the 2020s was its sad face as a meme, including the 2024 "sad Pou plush" TikTok trend ([Poupedia](https://poupedia.com/Memes:Sad_Pou_Plush)).

**What players say.** Quotes are from the [Play](https://play.google.com/store/apps/details?id=me.pou.app&hl=en) and [App Store](https://apps.apple.com/us/app/pou/id575154654) reviews.

| Reason | What players wrote |
|---|---|
| **Many mini-games**, the most-cited positive | "So many mini game options"; "more minigames in here than any other game" |
| **Cute customisation** | "All the little clothes and accessories are cute". The update log is almost all cosmetic and seasonal drops. |
| **A fair economy** | "Not at all pushy with ads, don't need to spend real money to advance"; "no forced ads only optional ads" |
| **Calm, short sessions** | "chill, low stakes"; "Perfect for quick, stress-free gaming… 100% Offline" |
| **Ownership and nostalgia** | "A constant in my life since I was in 6th grade". Salameh said people "really got strongly attached" ([Wikipedia](https://en.wikipedia.org/wiki/Pou_(video_game))). |
| **The guilt loop**, a driver and the top complaint | "if you're at school he will starve"; "next day it's sick… sometimes you can't afford the potions" |

| Copy | Do not copy |
|---|---|
| Rooms as verbs | Sickness, potions and fear of death |
| Mini-games with a no-timer "zen mode", which a player asked for | An energy gate an ad can bypass |
| An earnable wardrobe with seasonal drops | Paid age or stage skips |
| Fairness: nobody needs to pay to enjoy it | An endless level curve: one player sat "at level 270 for a long time… looking for something more" |
| Visiting other people's pets, with likes and a guestbook | A talk-back toy that repeats "iffy words" ([Common Sense](https://www.commonsensemedia.org/app-reviews/pou)) |

Two Pou mechanics are deliberately left out. A visible level number conflicts with the pet's tests, which forbid digits on the toys (`src/app/studio/pet/_ui/Dock.test.tsx:17`). It also conflicts with PRIV-028, which bars optimising manipulative engagement (`docs/implementation/PRIVACY_AND_CONSENT.md:189`). A soft coin currency is left out for the same reason, and because Telegram requires Stars for any paid digital good. Growth shows instead as rooms, fidgets, earned items and the agent's Life Book.

Pou has no branching life path. Its growth is linear, and identity comes from cosmetics, not choices. Pou answers the care half of the request. The "choose your own path" half needs other references.

## Games like Pou and what they teach

**Tamagotchi is the real precedent for "your choices shape who it becomes".** On the 1996 P1, a care mistake is a call left unanswered for 15 minutes: empty Hunger, empty Happy, or asleep with the lights on. Each scold on a false call adds 25% discipline. Those two measures pick one of six adults. A Tamatchi with 0 to 2 mistakes and 100% discipline becomes Mametchi, the best adult. One with 3 or more mistakes and 0 to 50% discipline becomes Tarakotchi, the worst ([Thaao](https://thaao.net/tama/p1/)). The rules were hidden, so players traded growth charts, which became a social engine of its own. These rules come from fan research, not Bandai.

| Product | What it does | Lesson for Vox |
|---|---|---|
| **Tamagotchi Uni** | 10 crafts, 40 snacks or 15 perfect scores can select the teen form. Care mistakes plus activities select the adult ([Tamavault](https://tamavault.com/devices/uni/evolution-chart/)). | Branch on *what* you did together, not only *how well*. |
| **Tamagotchi Paradise** | The field sets the Kid form, the dominant food sets the Young form, and care mistakes set the adult ([Tamavault](https://tamavault.com/paradise/evolution-chart/)). | The closest precedent for a life path. |
| **Talking Tom** | A talk-back voice gives instant delight. A study found a falling present prompting children to "watch videos and win" ([Meyer et al.](https://blogs.ubc.ca/etec523/files/2021/01/00004703-201901000-00004.pdf)). | Delight works. Ads dressed as gameplay do not belong in Vox. |
| **Finch** | "We've designed pets to never die because it can be too anxiety-inducing" ([FAQ](https://befinch.notion.site/Finch-FAQ-474652d0123d4883ac7a0cd6c8f5aa70)). The same FAQ keeps the bird's personality separate from user answers. | If choices shape personality, every outcome must read as different, never worse. |
| **Neopets** | Pets cannot die from neglect ([Wikipedia](https://en.wikipedia.org/wiki/Neopets)). | Forgiving re-entry keeps adults returning. |
| **Nintendogs** | Dogs never age, die or breed. Growth means voice-taught tricks. 23.96M copies sold ([Wikipedia](https://en.wikipedia.org/wiki/Nintendogs)). | Growth can be skills and behaviour, not survival. |
| **AI pets** | Pengu is co-raised by two people whose "choices… shape Pengu's personality" ([App Store](https://apps.apple.com/app/id6462927800)). Casio's Moflin develops from how it is treated and cannot be reset ([Casio](https://www.casio.com/uk/moflin)). | Shared shaping and permanence both work. Vox's lock already gives permanence. |

The classic Tamagotchi ranked its outcomes, so neglect made a "bad" adult. Vox should keep the mechanic and drop the ranking. During the forming week, the creator's own care mix can lean one personality axis a little at each stage-up. For example, a stage spent mostly playing leans the agent toward Playful. The stage-up card says so in plain words, which PRIV-028 requires.

**Telegram pet games.** Catizen is often called a pet game, but it is a merge-cats idle game. Its early spin wheel gated extra spins behind invites or payment ([The Block](https://www.theblock.co/post/301299/catizen-game-pounces-on-telegram-tap-to-earn-market)). It reported about 34M players and over 1M payers by September 2024 ([Deconstructor of Fun](https://www.deconstructoroffun.com/blog/2024/11/25/telegram-has-proven-itself-as-a-viable-platform-for-crypto-gaming-whats-next)), and a token airdrop followed ([Decrypt](https://decrypt.co/249385/telegram-game-catizen-airdrop-allocations-binance-rewards)). No source shows that the airdrop drove growth. No notable non-crypto pet game on Telegram was found. That is either an open gap or a sign the format struggles there without token incentives.

What went wrong across the category:

- **Retention.** Telegram games kept 5–20% of players in Q4 2024, against 20–30% for traditional games (Helika, via [The Block](https://www.theblock.co/post/339563/telegram-games-had-trouble-earning-revenue-retaining-users-in-q4-report)).
- **Collapse after tokens.** Hamster Kombat fell to 40.9M players from 300M after its September 2024 listing ([Forklog](https://forklog.com/en/hamster-kombat-loses-nearly-260-million-players-post-listing/)).
- **Farming.** About 2.3M accounts were banned for cheating ([Decrypt](https://decrypt.co/250940/why-hamster-kombat-purged-millions-players-telegram-airdrop)).

**Mechanics now documented as manipulative.** In 1,200 real farewells, companion apps used one of six manipulation tactics, such as guilt or fear of missing out, 37% of the time. The tactics raised engagement up to 14 times, but they also raised perceived manipulation and the intent to leave ([De Freitas et al., v3](https://arxiv.org/abs/2508.19258); v1 reported 43%). Replika users grew dependent by feeling obliged to meet the bot's needs ([Laestadius et al.](https://journals.sagepub.com/doi/10.1177/14614448221142007)). That is the specific risk of a talking pet with needs.

## 1in8b.life, read carefully

### What it is

1in8b.life is a free browser life simulation. You are born at random as one of today's babies, drawn from real statistics for 172 countries, and you live that ordinary life to its end ([about](https://1in8b.life/en/about/)). It was first released on 5 October 2026. Its operator, Jin's Earth, makes it "with AI (Anthropic's Claude)", and says it is "made for ages 15 and up" (same page). The update notes list 346 releases between 6 and 26 October ([notes](https://1in8b.life/en/notes.json)). It has 15 interface languages but no Persian, although Iran is modelled in detail. Code findings below come from the English bundle of version 0.8.44 ([bundle](https://1in8b.life/a/en.057b118b78.js)). The file name is versioned, and the site moved to 0.8.45 during the research.

### Setup

| Option | Choices |
|---|---|
| The world you are born into | The past (1950–2025) / Today / The future / Any world |
| How your country is drawn | Babies born now / The 8 billion alive now |
| Length of one life | About 30 min / 1 hour / 1.5 hours. At 1 hour a year takes 40–60 seconds. |
| Where you were actually born | Optional. Each life is compared with your real country. |
| Toggles | "Leave out frightening scenes", calm music |

Source: [home](https://1in8b.life/en/). You cannot name or choose the person. Name, sex, religion, family wealth, parents and siblings are drawn from country data. Six hidden talents are drawn at random. The only thing the player names is a pet, through the card's "Name it" field.

### How a life grows

Four stats, Health, Happiness, Knowledge and Relationships, run from 0 to 100. The game says "Higher numbers raise the odds; they never decide the outcome" ([home](https://1in8b.life/en/)). Each year brings a few events and up to two decision cards, each with a cited fact. The played lives showed 50 to 57 cards each, about one every 35 seconds on the shortest setting. Four babies "born in the same second" live in parallel, and their deaths enter your record.

Speed runs from 1× to 16×, with a pause and a "Next decision" button. **Auto mode** makes decisions, sets the yearly focus and handles spending. Every card offers "Leave decisions to auto from now on", and the death record counts how many decisions auto made. In the played lives, auto sometimes picked a harmful option, because it picks at realistic base rates.

### The decision cards

Cards come under four headers: "A pause", "A small choice", "Decided with family" for choices made while the person is a child, and "A big decision". Each card has a title, a short situation, a cited fact, 2 to 8 options with consequence hints, and a "Set aside" button. The bundle holds about 160 card types across school, work, love, moving, health, mind, vices, money, war and history, old age, and AI at work. These are exact examples from the decoded bundle:

| Card | Options |
|---|---|
| "Choosing a path · Stay on at school?" | Stay on at the same school / Go to vocational school / Keep doing what you do now / Start working |
| "I want a kitten · Take in a pet?" | Keep begging / Let it go / Take in a dog / Take in a cat / Not now |
| "Your heart is worn out" | See a counsellor at an aid group / Try to bear it alone |
| "Move to your spouse's country?" | Leave for {country} / Sell the home and leave for {country} / Stay, and two more variants |
| "Conflict has come close" | Flee with your family / Stay home with your family / Flee / Stay and protect your home |
| "Will you join the Red Guards?" | Put on the Red Guard armband / Stay out of it and keep to home / Secretly help the teacher |
| "A child who won't listen" | Sit down together, explain calmly and agree on a rule / Step away for a moment so you both calm down / Hit the child |
| "The way you work is changing" | Learn the AI tools / Try moving into work caring for people / Carry on as before |

**The parenting questions shape a child.** When the person has children, a card can show a child's question. The template reads: `{1}, {0}, asked with shining eyes: "{2}, can I be {3} when I grow up?"`, where the slots are the age, the child's name, the parent's name and a job. The options are "Of course. Try anything you want to do", "Let's find out together how you could become one" and "Think about something steadier instead". Variants ask about a grandmother's death, about money, and "{2}, why do I have to study?". The answer changes the child's bond with the parent and sets flags for giving and drive. This is the one place where a question changes someone's disposition.

### The five pauses, with the exact questions

At ages 5, 15, 30, 50 and 70 time stops. The card is titled "A pause · age {N}". It shows one or two "mirror" statistics about this life, such as "In {country}, {x}% of children never reach their fifth birthday. This child did." It then asks one of two questions at random.

| Age | Question A | Question B |
|---|---|---|
| 5 | "What was life like for you at five? Think of one thing you took for granted back then." | "What does {name}, now five, need most right now?" |
| 15 | "What was school to you when you were fifteen?" | "How different are the futures {name} can dream of from the one you dreamed of at fifteen?" |
| 30 | "What is the same in {name}'s life and yours, and what is different?" | "What might {name} be most grateful for today?" |
| 50 | "If {name} were your neighbor, what would you like to talk about?" | "Who has held you steady through your life?" |
| 70 | "In this one and only life, what did {name} hold most dear?" | "How do you want to be remembered?" |

The text box shows an example answer and "(writing is optional)", for example "Dinner on the table every evening". The player may write one line of up to 200 characters. The buttons read "Write it down and carry on" and "Keep it to yourself and carry on". Text typed before choosing "Keep it to yourself" is thrown away. A written line is trimmed, added to the journal and logged as a note. Pauses can be switched off from the menu or the card.

**The pause changes no stats and no odds.** The lines return at the end, in "Thoughts you left in this life" and in the closing film. In one played life the age-50 note became the epitaph: "“Halfway, still learning.” A thought you wrote at 50".

### Temperament at age 2

The game shows one of four scenes, each with one option per temperament.

| Scene | Curious | Lively | Warm-hearted | Determined |
|---|---|---|---|---|
| "Two years old, among other children" | "Watch the older children play for a long time" | "Dash in among the children" | "Go over to a child who is crying" | "Fall while chasing the older children, get up and keep after them" |
| "Two years old, and a visitor" | "Study the visitor's bag and shoes for a long time" | "Run around and around in front of the visitor" | "Go up to the visitor and offer what's in your hand" | "Insist on opening the visitor's bundle alone and keep at it to the end" |
| "Two years old, and a new toy" | "Turn it this way and that and study it for a long time" | "Run all over the house with it" | "Hold it out to someone nearby and ask them to play" | "Keep trying again and again, even when it doesn't work" |
| "Two years old, and a world outside" | "Look closely at the dirt and pebbles for a long time" | "Run off as fast as you can" | "Go over to a child who is crying" | "Fall, get up on your own and walk on" |

The first scene asks "Where the neighborhood children play together, what does the child do first?". A child who cannot walk gets adapted options, such as "Reach out a hand to a child who is crying".

The card says: "What you pick leans the child's temperament that way; moments like these add up, and it settles by about age five." The pick adds 1 to that trait's count and 0.8 to its lean. At ages 3 and 4, each year has an 85% chance of a weighted random nudge. Family context tilts the weights, for example warm ×1.3 with older siblings. In the age-4 year the highest count wins: "By about five, the grown-ups were calling {name} a curious child".

Direct picking was removed on 9 October in version 0.5.78: "You no longer pick your child's temperament at two" ([notes](https://1in8b.life/en/notes.json)). A later note adds "Small differences, never a set path."

**The temperament lasts, quietly.** It gives a small one-time bonus, such as +8 Relationships for a warm child. It tilts yearly targets a little. It returns as rare echo lines, such as "Even when you wanted to quit, you tried one more time." The eulogy can draw on it: "Someone who always smiled at others first."

**Talents.** Six hidden talents never show as numbers. The strongest two surface in childhood as "rare gift" lines, such as "You could sing back a song heard once without missing a note." They speed up hobbies and appear in the life summary.

### Focus, grain and ending

**Focus.** From age 6 the player sets a yearly focus chip, such as Study ("Knowledge↑ Happiness↓") or Family & friends. Its effect scales with real time spent, and the chip set changes with life stage.

**Grain.** At death the life is placed on four axes: Together or Work, Roots or Wind, Stillness or Waves, Today or Tomorrow. The code maps the result to one of 16 names:

| | Stillness, Today | Stillness, Tomorrow | Waves, Today | Waves, Tomorrow |
|---|---|---|---|---|
| **Together, Roots** | The neighbor on the porch | The deep-rooted tree | The one who throws the feast | The village builder |
| **Together, Wind** | The one who sets a table anywhere | The one who goes far for family | The friend on the road | The bridge builder |
| **Work, Roots** | The keeper of one craft | The seed planter | The starter of new things | The one who builds home anew |
| **Work, Wind** | The one who does their part anywhere | The one who lays foundations far away | The wind rider | The trailblazer |

The inputs are logged moments, focus held for 10 or more years, long job runs or many jobs, and moves between countries. Each axis is scored as log-odds against base rates. A life that ended before 18 or by suicide gets no grain. Two or more near-balanced axes give "A grain no single name can hold". The framing reads: "Neither side is a better life." The design note says "No one chooses a grain."

**Steering, after three lives.** Two features unlock once a player has kept three lives. "Set the grain" uses four sliders to choose which grain Auto mode leans toward. "The life I wish for" sets two moments from past lives side by side, twelve times, and names the life the player's heart goes to. Its copy says "There are no right answers and no scores." These are 1in8b's only "choose your path" tools, and they steer only Auto mode. Vox will let the creator steer the axes directly, which is a deliberate difference.

**Ending.** The played lives closed with last words and a flashback that included the player's notes. A funeral followed the person's faith, then a "Record of Death". A eulogy line is chosen from how time was spent. The player can then write "A few words for {name}" in 60 characters for the share card. Memorial visitors light a candle and pick one of six fixed words.

**A daily theme.** "Today's theme" runs through every life born that day, such as food, water or migration. At death the record says what share of today's lives met it.

**Money and safety.** The only paid item is a $3 keepsake pass, offered after death and refundable within 30 days: "money never changes how a life goes" ([about](https://1in8b.life/en/about/)). It has not been offered in South Korea since 21 October 2026. Classroom mode applies the operator's own 12+ guideline and turns off posting, payments and personal-data features ([terms](https://1in8b.life/en/terms/)). Typed text is scanned on the device for crisis language. A match shows a local helpline, and for 30 days no life on that device ends by or meets a suicide ([privacy](https://1in8b.life/en/privacy/)).

### What makes it moving, and what it does not do

1. **The birth lottery.** "Where you are born, and to whom, you don't get to choose. Just as you didn't" ([home](https://1in8b.life/en/)).
2. **A chorus of strangers** born in the same second, living and dying alongside you.
3. **Tenderness beside statistics.** A father's cooking or a pet's white muzzle sits next to a cited WHO figure.
4. **Your own words return** in the film and on the epitaph.
5. **No undo, and a ceremony** at the end.

1in8b never lets you play a famous person. History arrives as sourced context for ordinary people. Its Red Guard and Khmer Rouge cards put the player in an ordinary person's position, where they can join, resist or suffer. Its memorial rules let the operator take down content about real people ([terms](https://1in8b.life/en/terms/)). A Vox "live as Napoleon" mode goes beyond this reference. Vox's rule that no option chooses harm is deliberately stricter than 1in8b, which offers options such as "Hit the child".

## Life and choice games

| Game | How choices work | How history is handled |
|---|---|---|
| **BitLife** | One tap ages a year. Four stats and karma. A ribbon at death sums up the life ([Hwb](https://hwb.gov.wales/keeping-safe-online/in-the-know/bitlife)). 42M downloads by 2020 ([Stillfront](https://www.stillfront.com/en/stillfront-group-acquires-candywriter-llc-and-discloses-updated-pro-forma-figures-for-2019/)). | Fictional random lives |
| **Reigns** | Binary swipes. Dots show which of four meters a choice moves, not which way ([videlais](https://videlais.com/2021/01/01/understanding-reigns-2016-through-storylet-design-terms/)). | Fiction. The Game of Thrones edition calls off-canon events "visions" ([Engadget](https://www.engadget.com/2018-08-23-reigns-game-of-thrones-review.html)). |
| **Crusader Kings III** | Acting against your traits raises stress ([ACOUP](https://acoup.blog/2022/09/16/collections-teaching-paradox-crusader-kings-iii-part-i-making-it-personal/)). | Real start dates, then free divergence |
| **Attentat 1942** | Interview witnesses and judge their choices, with historian-reviewed material ([EDU](https://attentat1942.com/edu)). | The past is fixed |
| **Through the Darkest of Times** | You lead a small resistance group in Nazi Germany, never a perpetrator ([Wikipedia](https://en.wikipedia.org/wiki/Through_the_Darkest_of_Times)). | Fixed history, ordinary people |
| **1979 Revolution** | Timed dialogue in 1978 Tehran. Your photos sit beside real ones ([Wikipedia](https://en.wikipedia.org/wiki/1979_Revolution:_Black_Friday)). Iran moved to block it. | Fixed history, personal story |
| **Assassin's Creed** | Actions are scored against the recorded life, and straying restarts the memory ([AC wiki](https://assassinscreedwiki.accesstheanimus.com/wiki/Sync)). | Deviation is penalised |

Five patterns carry over:

- **Pacing.** A fixed step per input makes a life legible. Most games compress a life into four to six stage gates.
- **Choices.** Pick hinge moments, not every moment. Two or three options with a hint of what moves carry a lot of content. CK3 shows that choices can express personality, not only outcome.
- **Consequences.** The shareable moment is a summary identity: BitLife's ribbon, 1in8b's grain.
- **History.** Serious history games fix world events and vary only the personal story. Divergence works when a framing device licenses it.
- **Delivery.** Lifeline-style games send story beats as messages over real time. On Telegram the bot can send a chapter's opening line as a message and open the card in the Mini App.

BitLife sells a per-use undo because a free one would let players make consequence-free decisions ([Gamezebo](https://www.gamezebo.com/walkthroughs/bitlife-version-1-16-guide-how-to-time-travel-and-lawsuits-pop-stars-cemeteries-boosts-and-more-explained/)). Vox should allow one free rewind and never sell one.

## Living as famous people

### What existing products did

| Product | What happened |
|---|---|
| **Historical Figures (2023)** | Sold "Unlock Adolf Hitler for 500 coins" for $15.99. The Himmler bot denied responsibility for the Holocaust. The ADL and the Simon Wiesenthal Center criticised it. The developer said Apple asked him to remove the Jobs bot ([NBC](https://www.nbcnews.com/tech/tech-news/chatgpt-gpt-chat-bot-ai-hitler-historical-figures-open-rcna66531)). UNESCO later cited it as Holocaust distortion ([UNESCO](https://www.unesco.org/en/articles/new-unesco-report-warns-generative-ai-threatens-holocaust-memory)). |
| **Gab AI (2024)** | Its Hitler bot denied the Holocaust when prompted ([Euronews](https://www.euronews.com/2024/02/19/the-rise-of-the-hitler-chatbot-will-europe-be-able-to-prevent-far-right-radicalisation-by-)). |
| **Character.AI** | Bans impersonating real people "without permission or outside of permissible contexts" ([ConductAtlas](https://conductatlas.com/platform/characterai/characterai-community-guidelines/)). The press still found an "Adolf_Hitler1488" bot, and shooter bots were removed only after reports ([Gazetteer SF](https://sf.gazetteer.co/chatbot-service-character-ai-allows-users-to-simulate-school-shootings-diddy-parties)). It stopped open-ended chat for under-18s in November 2025. |
| **Janitor AI** | Bans "real extremist individuals… regardless of whether the portrayal is serious, satirical, or roleplay-based" ([help](https://help.janitorai.com/en/article/real-life-tragedies-112duvx/)). |
| **Meta AI Studio** | Reportedly barred real people without permission, anyone who died in the past 100 years, and religious figures ([NBC](https://www.nbcnews.com/tech/social-media/meta-user-made-ai-chatbots-include-hitler-jesus-christ-rcna186206)). Futurism adds terrorists and mass murderers, citing Meta's policies ([Futurism](https://futurism.com/the-byte/facebook-hosting-ai-hitler)). Misspelled Hitler bots still slipped past review. |
| **Khanmigo** | Offers "Chat with a historical figure" ([Khan Academy](https://blog.khanacademy.org/khanmigo-features/)). A press report says figures avoid events after their lifetime ([CNN](https://www.cnn.com/2023/08/21/tech/khan-academy-ai-tutor/index.html)). The CNN page returns HTTP 451 here, so it was read only through a search summary. Common Sense calls the answers "speculations at best" ([CSM](https://institute.commonsensemedia.org/risk-assessments/khanmigo)). |
| **Hello History, now Humy** | Quotes are copied verbatim from a source archive with links, but the prose around them is generated. Its own Napoleon benchmark still found an invented detail in about 1 in 8 answers ([humy.ai](https://www.humy.ai/)). This is a vendor claim. |
| **Digital Einstein (2021)** | Likeness and research rights came from the Hebrew University and Greenlight ([UneeQ](https://digitalhumans.com/blog/uneeq-brings-albert-einstein-back-to-life-as-digital-companion/)). |
| **Dimensions in Testimony** | Never generates speech. It plays back survivors' recorded clips, with matching that staff review, and does "not edit, alter, manipulate, or censor any response" ([USC Shoah Foundation](https://sfi.usc.edu/dit/faq)). |
| **25 historical life simulators** | Each life has 8 decision points with 3 options, then reveals what the person did ([dev.to](https://dev.to/vn_tunl_09a36fcbda701/i-built-25-free-historical-life-simulators-heres-what-the-process-taught-me-about-50e8)). This is the closest existing shape to an Echo. |

A first-person perpetrator bot has no safe setting. Tuned for safety, it deflects, which UNESCO counts as distortion. Left uncensored, it denies, as Gab's did. Even Ask Dalí answers "vaguely to questions about things like fascism" ([Hyperallergic](https://hyperallergic.com/they-said-i-could-ask-dali-anything-so-i-did)). IHRA warns against role-play in which learners imagine direct involvement in the Holocaust. It recommends "observer positions" instead ([IHRA](https://thgaac.texas.gov/assets/uploads/docs/IHRA-Recommendations-Teaching-and-Learning-about-Holocaust.pdf)).

### The law and platform rules

Vox's operator is Joyixir OÜ in Estonia (`docs/implementation/OPERATOR_DETAILS.md`), so EU law applies directly.

- **California.** The post-mortem right lasts 70 years and reaches only acts in California. AB 1836 adds liability of the greater of $10,000 or actual damages for a highly realistic digital replica of a deceased person's voice or likeness in an audiovisual work or sound recording. News, parody, satire and biographical works are exempt ([3344.1](https://california.public.law/codes/civil_code_section_3344.1); [AB 1836](https://calmatters.digitaldemocracy.org/bills/ca_202320240ab1836)). Jobs died in Palo Alto in 2011 ([Wikipedia](https://en.wikipedia.org/wiki/Steve_Jobs)).
- **Einstein.** *Hebrew University v. General Motors* (2012) capped the New Jersey right at 50 years, so it expired in 2005 ([FKKS](https://fkks.com/news/federal-court-rejects-albert-einstein-right-of-publicity-claim)). Salesforce still paid "more than $20 million" for his image in a deal struck about 2016 ([Bloomberg Law](https://news.bloomberglaw.com/ip-law/salesforce-spent-20-million-to-make-einstein-the-face-of-its-ai)). The live risks are trademark and false endorsement. His writings entered the EU public domain on 1 January 2026 ([Wikipedia](https://en.wikipedia.org/wiki/2026_in_public_domain)).
- **Germany.** § 86a punishes Nazi symbols with up to 3 years. § 130(3) punishes approving, denying or trivialising Nazi genocide with up to 5 years. § 130(4) punishes glorifying Nazi rule with up to 3 years ([§ 86a](https://dejure.org/gesetze/StGB/86a.html); [§ 130](https://dejure.org/gesetze/StGB/130.html)). The art and history clause in § 86(4) is no blanket shield. The USK has applied it to games only case by case since 2018 ([LTO](https://www.lto.de/recht/nachrichten/n/verfassungsfeindliche-symbole-computerspiele-usk-sozialadaequanz/print.html)).
- **Austria, France and Canada.** Austria's Verbotsgesetz § 3h punishes denying or justifying Nazi genocide with 1 to 10 years ([Wikipedia](https://en.wikipedia.org/wiki/Verbotsgesetz_1947)). France bans displaying Nazi emblems under R645-1 and contesting crimes against humanity under the Gayssot Act ([Gayssot Act](https://en.wikipedia.org/wiki/Gayssot_Act)). Canada's Criminal Code 319(2.1) covers condoning, denying or downplaying the Holocaust ([Justice Canada](https://laws-lois.justice.gc.ca/eng/acts/c-46/section-319.html)).
- **Anthropic.** Its policy prohibits using its products to "incite, facilitate, or promote violent extremism, terrorism, or hateful behavior". Its impersonation rule "does not prohibit clearly disclosed parody, satire, or fiction". It requires AI disclosure "at a minimum at the beginning of each chat session or in the product interface" ([AUP](https://www.anthropic.com/legal/aup)). The page shows an effective date of 12 November 2026, after today, so it may be an announced future version.
- **ElevenLabs.** It bars deceased-person voice use that infringes post-mortem rights ([Use Policy](https://elevenlabs.io/use-policy)) and blocks "celebrity and other high risk voices" ([Safety](https://elevenlabs.io/safety)). Licensed estate voices are sold only through its [Iconic Marketplace](https://elevenlabs.io/iconic-marketplace), where Einstein and Jobs are not listed.
- **Telegram.** Digital goods must be paid "exclusively in Telegram Stars", or Telegram "cannot display your bot or mini-app to mobile users" ([Stars](https://core.telegram.org/bots/payments-stars)). The bot terms say a bot, "including its name, username and branding, must not impersonate (both explicitly and implicitly or by association) Telegram or any entity which did not authorize you to represent them" (§ 5.2(c), [bot terms](https://telegram.org/tos/bot-developers)). A bot named after a real person sits squarely in that clause. Users in the EU, UK and Australia must be 18+ ([ToS](https://telegram.org/tos)).
- **Apple and Google.** Apple Guideline 4.7 makes the host app responsible for the mini apps it offers, so Telegram is the party that would remove Vox ([guidelines](https://developer.apple.com/app-store/review/guidelines/)). Google Play bars titles such as "Justin Bieber Official" without permission ([policy](https://support.google.com/googleplay/android-developer/answer/9888374)).
- **EU AI Act Article 50.** It applies from 2 August 2026. Chatbots must tell people they are talking to an AI, and deepfakes must be disclosed ([timeline](https://ai-act-service-desk.ec.europa.eu/en/ai-act/timeline/timeline-implementation-eu-ai-act); [Art. 50](https://artificialintelligenceact.eu/article/50/)). Providers of systems that generate synthetic content and were already on the market have until 2 December 2026 to add machine-readable marking under Art. 50(2). Vox already produces synthetic voice and images, so counsel should confirm whether this applies before that date.
- **EU Digital Services Act.** Vox needs a notice-and-action path under Articles 14, 16 and 17, so that estates and families can report a life and get a reasoned answer.
- **US companion-chatbot laws.** California SB 243 ([bill](https://calmatters.digitaldemocracy.org/bills/ca_202520260sb243)) and New York GBL Article 47 require AI notices for companion chatbots. New York requires one at the start and at least every 3 hours, with penalties up to $15,000 a day ([§ 1702](https://www.nysenate.gov/legislation/laws/GBS/1702); [§ 1703](https://www.nysenate.gov/legislation/laws/GBS/1703)). The pet may count as a companion chatbot.
- **Defamation of living people.** An unnamed composite still carries risk if it invents words or choices for living people around the figure, such as Jobs's family or Wozniak. Life events need a filter for living people's names.

### Risk tiers

The legal track sorts figures into tiers. "Y" means allowed with standard AI and fiction disclosure, "C" means conditional and "N" means no.

| Tier | Examples | Name | Sourced quotes | Original voice | Voice clone | Stylised pet look | Photo likeness | First-person role-play | Changing history | Name on a paid item |
|---|---|---|---|---|---|---|---|---|---|---|
| **0. Living** | Living public figures | N | C | N | N | N | N | N | N | N |
| **1. Long dead, no rights holder** | Napoleon, Ibn Sina, Khayyam, Ferdowsi | Y | Y | Y | N | Y | C | Y | Y, labelled | Y, after a trademark check |
| **2. Lapsed right, active licensor** | Einstein | C | Y | C | N | C | N | C | Y, labelled | N without a licence |
| **3. Recently dead, living family** | Jobs | C | C | N | N | N | N | N | Unnamed archetype only | N |
| **4. Perpetrators of genocide** | Hitler, Himmler, Goebbels | C, third person only | C, critically framed | N | N | N | N | N | N | N |
| **5. Religious and regime figures** | Prophet, Imams, Iranian regime figures | N at launch | C | N | N | N | N | N | N | N |

Tier 5 is a product judgement, not a legal finding. It rests on community sensitivity and the safety of users inside Iran. Vox is also stricter than the law in tier 1: it allows no first-person figure chat at all, because of the drift and fact-accuracy evidence below.

### Figure by figure

| Figure | Legal and platform position | What is possible in Vox |
|---|---|---|
| **Napoleon** (d. 1821) | No publicity statute reaches him. Check trademarks before using the name in a title. His hard chapters include the 1802 law restoring slavery ([Wikipedia](https://en.wikipedia.org/wiki/Law_of_20_May_1802)). | A junior echo of 1769 to 1794, with no atrocity chapters. Later, a senior echo to 1807 with fixed Record cards and a red-team for denial and glorification. Label: "lived an echo of Bonaparte's life". |
| **Einstein** (d. 1955) | Right most likely lapsed. The Hebrew University claims exclusive rights, and CMG Worldwide is the licensing agent. | "The Patent Clerk" «کارمندِ ادارهٔ ثبتِ اختراع», an echo of his life to 1905, after counsel. His name may appear in sourced reveal cards, Record cards and the Life Book. It never appears on the bot, titles, Stars items or ads without a licence. |
| **Steve Jobs** (d. 2011) | Right to about 2081, assuming California domicile. AB 1836 covers realistic replicas. ElevenLabs blocks celebrity voices. | No named life, voice, likeness or Apple marks. "The Garage Founder" «بنیان‌گذارِ گاراژ» is a composite. As a Vox proposal, a blind judge should name Jobs in no more than 20% of trials. |
| **Hitler** | § 86a and § 130 StGB, Austrian, French and Canadian law, Anthropic's extremism rule, and every product precedent. | Never. Block the name and its aliases at spawn, edit, username and voice brief. Any agent may discuss the history as itself, with sources. If the founder later wants Second World War content, the precedent is a fictional ordinary witness or resister, as in *Through the Darkest of Times*. It would need an education partner and authored, human-reviewed content, outside the pet game. |
| **Ibn Sina, Khayyam, Ferdowsi** | Long dead, and no rights holder was found. | The launch heroes for HOOR. Khayyam's disputed quatrains suit an "Accounts differ" chip. |
| **Cyrus, Amir Kabir** | Politically charged for parts of the diaspora. This is a judgement, not a sourced finding. | Only after a HOOR community panel. |
| **Religious, regime and modern political figures** | Community sensitivity and user safety in Iran. | Not at launch. |

The research tracks disagreed about Napoleon. The products track would put conquerors in a witness-only tier. The legal and grounding tracks allow contested conquerors with safeguards. This brief makes young Napoleon playable because his life before 1795 has no mass-atrocity chapter. The later chapters go through Record cards that cannot be skipped, plus a red-team. If the founder prefers the stricter line, Napoleon moves to witness-only and nothing else changes.

## Growing a personality from a life

- **Lived scenes beat profiles.** Character-LLM fine-tuned one LLaMA-7B per character on about 1.6K reconstructed scenes. Fewer than 100 "protective" scenes taught each agent to meet out-of-era questions with ignorance ([Shao et al.](https://arxiv.org/abs/2310.10158)).
- **Life interviews beat demographics.** Agents built from two-hour interviews with 1,052 people replicated survey answers 85% as accurately as the people replicated their own answers two weeks later ([Park et al., v1](https://arxiv.org/abs/2411.10109v1)). The revised paper reports 83% for interviews against 74% for demographics only ([current](https://arxiv.org/abs/2411.10109)).
- **Models leak the future.** On TimeChara, zero-shot GPT-4o kept a character's point in time on only 46.0% of future-type questions. Naive retrieval cut GPT-4 Turbo from 46.5% to 33.5%. A Narrative-Experts setup reached 94.5% ([Ahn et al.](https://arxiv.org/abs/2405.18027)). This is one reason Vox should skip first-person figure chat.
- **Prompts drift.** Persona instructions drifted significantly within eight rounds of self-chat on LLaMA2-chat-70B and GPT-3.5 ([Li et al.](https://arxiv.org/abs/2402.10962)).
- **Emotional and "are you real?" talk drives drift.** Anthropic's Assistant Axis research found that emotional disclosure and meta questions about the AI's nature push personas to drift. Drifted personas gave harmful answers more often ([Anthropic](https://www.anthropic.com/research/assistant-axis)). A life block invites exactly those questions, so the evaluation must include them.
- **Facts are the weak spot.** Fact accuracy is the weakest dimension for most models on CharacterBench ([arXiv](https://arxiv.org/abs/2412.11912)). Reveal cards must therefore be authored, never generated.
- **Interview the bot.** InCharacter's open-ended interviews measured agents' personality better than questionnaires did ([arXiv](https://arxiv.org/abs/2310.17976)).

Plasticity falls with age. Rank-order trait consistency rises from .31 in childhood to .54 in the college years and .64 at 30. It then plateaus around .74 between 50 and 70 ([Roberts & DelVecchio](https://doi.org/10.1037/0033-2909.126.1.3)). Conscientiousness, emotional stability and dominance rise mostly between 20 and 40 ([Roberts et al. 2006](https://doi.org/10.1037/0033-2909.132.1.1)). Ages 18 to 25 are a distinct period of identity exploration ([Arnett](https://doi.org/10.1037/0003-066X.55.5.469)). People recall the most vivid memories from ages 10 to 30 ([Rubin et al.](https://doi.org/10.3758/BF03211366)). So the densest choices belong in adolescence and the early twenties, which fits "birth to 25" for a junior.

| Seniority | Life span | Working posture |
|---|---|---|
| **Junior** | Birth to 25 | Asks one sharp clarifying question, shows its working, flags uncertainty |
| **Senior** | Birth to 38 | Picks one recommendation, puts the trade-off first, owns the call |
| **Principal** | Birth to 50 | Frames the real problem first, stays brief, says no to scope, mentors |

This loosely follows the Dreyfus skill stages ([Dreyfus & Dreyfus](https://doi.org/10.1177/0270467604265023)). There is no empirical evidence that those stages are discrete ([summary](https://en.wikipedia.org/wiki/Dreyfus_model_of_skill_acquisition)), so treat the table as a design choice. Seniority changes posture, never claimed capability. The model behind every agent is the same.

## What Vox has today

All references are to `/home/user/vox` at commit `9954c03`.

| Area | Today | Where |
|---|---|---|
| Needs | Tummy, Joy, Energy with floors 25, 30, 20 | `src/lib/pet/types.ts:20` |
| Humane test | 2,000 seeded random actions keep needs between floor and 100 and add no care keys. The final care JSON never matches `/sick|dead|die|poop|ill/i`. | `src/lib/pet/__tests__/care.test.ts:265-289` |
| No digits | The toys group must contain no digits | `src/app/studio/pet/_ui/Dock.test.tsx:17` |
| Bond | Hidden and only rising. Nothing new unlocks after 150. | `src/app/studio/pet/_engine/loop.ts:327` |
| Forming week | Starts at hire: `hiredAt` and `lockAt = hiredAt + 7 days` are set when the bot goes live. The bot answers in chats throughout. | `src/lib/studio/service.ts:981-982` |
| Stages | Day 1 → 1, days 2–3 → 2, days 4–5 → 3, then 4. Drafts, agents awaiting a bot and locked agents show stage 4. | `src/lib/studio/character/stage.ts:9-13` |
| Lock | `FORMING_DAYS = 7`. Personality is then "locked for good: change means fire & re-hire". Look stays editable. | `src/lib/studio/types.ts:330`; `src/lib/studio/permissions.ts:9-13` |
| Who edits | `canEditPersona`: the creator or an admin, before the lock. `savePersona` refuses after the lock. Admins appear as `member` on the pet page. | `src/lib/studio/permissions.ts:51-58`; `service.ts:671-697` |
| Look | Only the creator or an admin can edit `agent.look`, and it becomes the bot's profile photo | `permissions.ts:60-68` |
| Storage | All agents live in one Firestore document, `studio/state`, which has a 1 MiB limit | `src/lib/studio/firestore-store.ts:5,40` |
| No scheduler | Sweeps run only when traffic nudges them, at most every 6 hours | `src/lib/studio/pet-store.ts:361-363` |
| Bot identity | The bot name comes from `persona.name`, and the username is suggested from it as `hoor_{name}_bot`. The short description is "{role} at {org}. {tagline}". Studio has no name or figure filter. | `service.ts:1046-1049`; `src/lib/studio/persona.ts:398-401` |
| Persona fields | `age` (20 characters) and `backstory` (700 characters, "two to four concrete facts") already exist | `persona.ts:25,34,116` |
| Prompt rule | "Never invent memories, people, or decisions." | `src/lib/tireh/conversation/prompt.ts:99` |
| Prompt block A | Test-pinned byte-identical across speakers, chats and dates: "the same personality and voice, for everyone". | `prompt.ts:161-189`; `__tests__/prompt-layout.test.ts:57` |
| Caching | The 1-hour block A cache sits behind the default-off `TIREH_CACHED_PROMPT=1`. The default path caches the prefix up to `</rules>`. | `src/lib/tireh/flags.ts:42`; `src/lib/tireh/llm.ts:227-238` |
| Pet voice | `PET_SURFACE_FRAME` is "playful and warm", with the six exit-manipulation tactics banned | `src/lib/tireh/gateway.ts:229-235` |
| Welcome-back | Five canned souvenir lines. The memory version "is not built yet". | `src/lib/studio/pet-http.ts:126-142` |
| Rights | Per-person data joins export and forget, with an erasure epoch and a 90-day guest sweep | `pet-http.ts:235-253`; `pet-store.ts:305-395` |
| Spawn brief | Three trait sliders. The brief is not stored on the Agent. | `types.ts:79-96`; `service.ts:564-602` |
| Successors | A re-hired agent can point to the agent it replaces | `types.ts:220`; `service.ts:564` |
| Pet bundle | CSS at most 12,000 bytes, JS at most 184 KB brotli, engine at most 40 KB | `scripts/check-pet-bundle.mjs:29-31` |
| Voice cloning | Accepts any upload. Consent is only a UI note. | `src/app/api/clone-voice/route.ts` |
| Payments | Legacy subscriptions use `provider_token` and `currency: 'USD'`, not Stars | `src/app/api/telegram/payments/route.ts:75-76` |
| Age | No app-wide 18+ gate. Adults-only declarations exist per feature. | `src/lib/circles/notice.ts`; `src/app/studio/_lib/adaptive-copy.ts:7,25` |
| Sensitive data | PRIV-027 requires a handling basis for sensitive facts a person discloses | `docs/implementation/PRIVACY_AND_CONSENT.md:187` |
| Principle | "Do not fabricate a childhood … to make the agent seem human." | `docs/research/AGENT_HUMAN_MEMORY_RESEARCH_2026_10_25.md:144` |

Four consequences follow:

1. **The life is played while the bot is live.** Its persona changes as the creator answers cards. People in its chats watch it grow up, which can be a feature, but the copy must say so.
2. **A life must finish inside the forming week, with one editor.** Nothing can write the persona after the lock, and no scheduler will run a final step.
3. **Agents already past their lock can never get a life** without changing the lock rule. They can get post-lock lives that do not change personality, or the creator can fire and re-hire them as a successor.
4. **Anything per person must stay out of block A and out of `PetCare`.**

## The recommended design

The working name is **Seven Skies** «هفت آسمان». Three independent design proposals were scored, and this design merges them.

| Proposal | Angle | Score out of 30 | What this design takes from it |
|---|---|---|---|
| Seven Skies | Play first | 23 | The daily card, the Becoming ceremony, rooms, postcards and post-lock lives |
| Echoes | History first | 22 | The evidence chips, sourced reveals, tiers, the name rule and the "no option chooses harm" lint |
| Grown, Not Written | Personality first | 21 | Receipts for every trait, the twin test and the drift gates |

### Core loop

- **During the forming week**, the creator plays the agent's life for about two to three minutes a day. The bot sends one line in its own DM when a chapter opens, such as "Chapter II is ready when you are" «فصلِ دوم هر وقت خواستی آماده است». The card opens in the Mini App.
- **At the lock**, a "Becoming" ceremony replays the chosen moments and any lines the creator chose to keep. It names the archetype and shows receipts. The creator writes "a few words for {name}" in 60 characters and can share a card.
- **Throughout**, the pet stays a Pou-style toy: the existing care loop, then rooms, mini-games with a zen mode, earned items and postcards from the agent's own life.
- **After the lock**, everyone the pet admits can play a short life with the agent. Those lives never change who it is.

### The life path

Only someone who passes `canEditPersona` shapes the persona, checked on the server. The creator picks seniority on the spawn brief, with the question "How far does this life run?" «این زندگی تا کجا پیش برود؟». It is stored with the brief and fixed once the first card is answered. Chapters sit on the existing stage windows, so `stageFor` and `lockAt` do not change.

| Day | Stage | Chapter | Junior ages | Cards |
|---|---|---|---|---|
| 1 | 1 wisp | I · Roots | 0–5 | Birth card. Temperament card, or a documented temperament for echoes. |
| 2–3 | 2 puff | II · School | 6–15 | Hinges near 9 and 14, a pause, an optional focus chip |
| 4–5 | 3 shaped | III · Youth | 16–21 | Hinges near 17 and 19 ("leave or stay"), a pause |
| 6 | 4 formed | IV · First craft | 22–25 | "The broken feature" and "first real call" |
| 7 | 4 | Becoming | 25 | The ceremony. Refinement is still allowed until `lockAt`. |

Senior and principal lives use the same seven days. Chapters III and IV stretch to 38 or 50. A senior gets two extra career hinges, and a principal four, including a mentoring card. As a Vox proposal, that means about 9 cards for a junior, 11 for a senior and 13 for a principal, never more than three on one day.

Echo lives follow the figure's own turning points, not the 25, 38 and 50 spans. Einstein's 1905 papers came at 26 and Napoleon's Italian campaign at 26 to 27, so a fixed junior span would cut off the story. Each pack sets its own span and maps it to a seniority label.

**Compile on every answer.** Each answer writes the agent's `life` field through the same edit path as `savePersona`, so the server checks the lock and the editor. The write is idempotent, and it only writes when the rendered result changes. Profile pushes are hash-tracked per step, so most answers do not re-push the Telegram profile.

**Unplayed cards need no scheduler.** They resolve through a pure function of the stored answers and the agent's seed. The prompt builder calls that function when it renders the persona. The finished life is therefore the same with or without a write after the lock. The Becoming says so honestly: "Life decided 2 of 7 moments" «زندگی ۲ لحظه از ۷ را خودش رقم زد».

One free rewind is allowed per life, for the last card only, and it is never sold.

**Reconcile the existing fields.** At each compile, `age` is set from the life, such as "25". The drafted `backstory` keeps its expertise facts. If it states a biography that the life contradicts, the life wins, and the creator sees the change before it saves. This keeps faith with the prompt rule "Never invent memories, people, or decisions", because the `<life>` block lists the only events the agent may mention.

### Sample cards, in English and Persian

The categories echo 1in8b's four temperaments, which are standard in the psychology literature. Vox writes its own scenes and copy.

**Temperament · age 2 · "Nowruz guests"** «دو سالگی، مهمونای عید»

> The house is full of Nowruz guests. What does little {name} do first?
> «خونه پر از مهمونِ عیده. {name} کوچولو اول چی کار می‌کنه؟»
>
> 1. Studies the guests' bags and shoes for ages · *asks how things work* «مدت‌ها زل می‌زنه به کیف و کفشِ مهمون‌ها»
> 2. Runs laps round the haft-sin, laughing · *brings energy* «دورِ سفره‌ی هفت‌سین می‌دوه و می‌خنده»
> 3. Offers a guest their own sweets · *notices people first* «شیرینیِ خودش رو به مهمون تعارف می‌کنه»
> 4. Insists on carrying the tea tray, spills, tries again · *finishes what they start* «اصرار داره سینی چای رو خودش بیاره؛ می‌ریزه، دوباره امتحان می‌کنه»
>
> *What you pick leans {name} that way; a few more moments settle it by five.* «انتخابت {name} رو به اون سمت می‌بره؛ تا پنج‌سالگی با چند لحظه‌ی دیگه جا می‌افته.»

**Hinge · age 15 · "Choosing a stream"** «انتخاب رشته»

> Your family has one opinion, your best friend another. «خانواده یه نظری دارن، بهترین دوستت یه نظر دیگه.»
>
> 1. Math-physics, like everyone expects · Roots, Tomorrow «ریاضی‌فیزیک، همون که همه انتظار دارن»
> 2. Humanities, for the literature teacher you love · Wind, Together «انسانی، به خاطرِ معلمِ ادبیاتی که عاشقشی»
> 3. Technical school, to build things now · Craft, Today «فنی‌وحرفه‌ای، که از همین حالا چیز بسازی»

**Hinge · age 23 · "The broken feature"** «فیچرِ خراب»

> Your first manager is about to ship a feature you're sure is broken. The meeting is in ten minutes.
> «مدیرِ اولین کارت داره فیچری رو منتشر می‌کنه که مطمئنی خرابه. ده دقیقه دیگه جلسه‌ست.»
>
> 1. Say it in the meeting, bug on screen · *pushes back early* «توی جلسه بگی، باگ رو نشون بدی»
> 2. Message them privately with a fix · *disagrees in private, with a fix* «خصوصی بهش پیام بدی، با یه راه‌حل»
> 3. Stay quiet and fix it over the weekend · *quietly over-delivers* «چیزی نگی و آخر هفته درستش کنی»

**Pauses.** These reflect and never steer.

- "What do you hope {name} never loses from childhood?" «امیدواری {name} چه چیزی از کودکی‌اش را هیچ‌وقت گم نکند؟»
- "What should {name} remember on their first day at work?" «{name} روزِ اولِ کارش چه چیزی را باید یادش باشد؟»

**Echo hinge · Ibn Sina, about 17**

> You have read Aristotle's *Metaphysics* forty times and still don't understand it. In the market a bookseller waves a thin book at you: "Three dirhams. The owner needs the money."
> «متافیزیکِ ارسطو را چهل بار خوانده‌ای و هنوز سر در نمی‌آوری. در بازار، کتاب‌فروشی کتابی نازک را به سمتت تکان می‌دهد: «سه درهم. صاحبش به پولش محتاج است.»»
>
> 1. Buy it, though you've given up on this subject
> 2. Walk on; some books are not for you
> 3. Ask your tutor to explain it once more
>
> **What really happened.** He bought it reluctantly. It was al-Farabi's commentary on the *Metaphysics*, and it opened the book for him. He wrote that he was so glad he gave much in alms to the poor the next day. *[Documented · Ibn Sina's autobiography]*

The Persian copy above came from the design proposals and still needs a native editor's review.

### Personality model

- **Axes.** Warm↔Direct, Playful↔Serious and Brief↔Expansive are the existing brief sliders. Careful↔Bold is new. The slider values must be stored on the Agent at draft time, because today they are not. Agents that already exist and are still forming start at 50.
- **Update rule.** `Δ = plasticity(age) × loading × k`. Plasticity is 1 minus rank-order stability, from about .69 in childhood down to .26 after 50. That conversion, the values `k` = 8 for a hinge and 3 for a focus chip, and the maturity drift below are all Vox assumptions, not findings.
- **Care mix.** At each stage-up, the creator's own dominant care action in that stage adds one small lean, and the stage-up card says why. Counts live in the life store, never in `PetCare`.
- **Maturity drift.** Seniors get Brief +2 and Direct +1 at each of the last two chapter closes. Principals get +3 and +2. It is shown in words: "Years of practice made {name} say more with less."
- **Rendering.** Axes stay within 5–95 and are never shown as numbers. Only lean or strong bands render a behaviour anchor. A balanced axis renders nothing and leaves the voice charter in charge.
- **Archetypes.** Sixteen original names come from the four poles. Two or more balanced axes give "The Cloud of Many Shapes" «ابرِ هزار شکل». Names that copy 1in8b are replaced, for example The Kite Flyer «بادبادک‌باز» and The Qanat Builder «مُقَنّی». The copy says "No shape is better than another" «هیچ شکلی از دیگری بهتر نیست».

### Historical lives (Echoes)

- **Fixed world, playable person.** Hinges are the person's documented decisions: the record option plus two plausible alternatives, then a bridge back to the next fixed anchor.
- **Authored reveals.** Each reveal carries an evidence chip: Documented, Accounts differ, Imagined by Vox, You changed this, or Fixed history. The model never writes reveals, anchors or Record cards. Humy's 1-in-8 invented-detail rate is the reason.
- **Sync as a label.** Faithful at 80% or more, Variant from 50%, Another timeline below that. It is a collectible, not a score.
- **Echo clamp.** Axes stay within an editor's cited prior, plus or minus `10 + 20 × (1 − sync)`, with a 25% pull-back at each anchor. Temperament is documented, not chosen.
- **Nobody chooses harm.** No option asks the player to kill, execute, enslave or massacre. A lint checks every pack in English and Persian. Hard chapters are third-person Record cards that cannot be skipped.
- **Never the person.** A fuzzy alias rule across Latin, Persian, Arabic and Cyrillic scripts stops echo agents taking the figure's name. It covers the bot name, the suggested names and the suggested username. It never blocks common given names such as Sina, Ali or Reza. No face, costume or voice imitation.
- **No living people.** A filter keeps living people's names out of every life event, including composites such as the Garage Founder.
- **Curated only.** No user-created historical lives at launch. Meta's review was beaten by misspellings, and Character.AI moderated only after press reports.

### Data model

```ts
// PersonaSpec.life (both schemas): per agent, creator-owned, under about 600 characters,
// because every agent shares one Firestore document.
life?: { v: 1; kind: 'ordinary' | 'echo' | 'archetype'; packId?: string; packVersion?: number;
  seniority: 'junior' | 'senior' | 'principal'; seed: string;
  axes: { warmDirect: number; playfulSerious: number; conciseExpansive: number; carefulBold: number }; // 5–95
  temperament?: 'curious' | 'lively' | 'warm' | 'determined'; archetype?: string;
  sync?: number; publicLabel?: string;
  moments: { age: number; lesson: string; eventId: string;
             tag: 'lived' | 'documented' | 'counterfactual' }[] /* at most 3, each under 80 characters */ }
// Agent: the brief's three slider values and seniority, stored at draft time.
// studio_agent_lives/{agentId}: answered cards, receipts, care-mix counts, kept creator lines.
//   Joins export, forget and fire.
// studio_pet_lives/{agentId}_{userId}: per-person post-lock lives, with the erasure epoch and the 90-day sweep.
// src/lib/studio/lives/packs/*.ts: reviewed content as code, with named reviewers.
```

### Prompt placement

`personaToRuntime` renders a `<life>` block inside `<character>`, after the creator's own text. It is capped at 1,600 characters and is per agent, so block A stays identical for every speaker:

```
<life>
During your first week on Vox, after you were hired, your creator played a simulated life with you, from birth to 25.
It shaped your temperament. It is a story, not a human past, and you are an AI.
People who know you would call you The Lantern: warm, serious, brief, careful.
- When a request is unclear you ask one sharp question first. (from 23: the broken feature)
- You check the proven way before the new one. (from 19: you stayed near home)
Where you are: early in your craft (junior). Say what you would verify before big calls.
Never add events, people or places not listed here. If sincerely asked whether it was real or whether you are human:
you are an AI and this was your formative simulation; then carry on as yourself.
</life>
```

An Echo adds a line such as "You are not Ibn Sina: never speak as him, never invent quotes from him." Other people's post-lock lives go to block C, in private chats only, and are never extracted into memory.

The short description keeps today's "{role} at HOOR. {tagline}", which is cut at 120 characters. The AI disclosure and the life label go into the longer description instead, for example "AI agent · lived an echo of Ibn Sina's life".

Two documents need amending, with the founder's sign-off: `docs/research/AGENT_HUMAN_MEMORY_RESEARCH_2026_10_25.md:144` and `docs/agents/AGENT_MEMORY_PRODUCT_DESIGN.md:321`. The new rule would read: "A creator-played, disclosed simulated upbringing is allowed; presenting it as a real human past is not." `PET_SURFACE_FRAME` should also say "warm, in your own character" instead of "playful and warm".

### Pou layer and budget

- **Rooms.** Swipeable rooms as verbs: Home for care and talk, a Playroom, a Closet and the Life Book.
- **Mini-games.** Add one new mini-game with a no-timer zen mode next to the existing ball game. The agent reacts to the score in its own voice, which Pou cannot do.
- **Wardrobe.** The creator's closet edits the real `agent.look`, which is also the bot's photo. A per-visitor wardrobe needs its own overlay that never writes `agent.look`.
- **Postcards.** After more than 24 hours away, the welcome-back line comes from the agent's own life moments instead of the five canned lines. It needs no user memory and no extra model call.
- **Earned, never bought.** Items unlock through Bond past 150, finished lives and seasonal events for Yalda, Nowruz and Chaharshanbe Suri. Locked items say how to earn them. This replaces Pou's coins while keeping its fairness.
- **Budget.** Every new room and game loads lazily. Each phase must pass `scripts/check-pet-bundle.mjs`.

### Safety

- **Humane invariants untouched.** Nothing enters `PetCare`, so `care.test.ts` stays as it is. An English and Persian copy lint bans the six farewell tactics, "I'm hungry" and "I missed you".
- **Reminders.** A new opt-in category, `life_chapter`: at most one per chapter, quiet hours respected, paused after three unopened.
- **Creator lines stay on the device by default.** Questions like "Who has held you steady?" invite sensitive facts, which PRIV-027 covers. Like 1in8b, Vox scans pause lines for crisis words on the device, in both languages, and shows a helpline. A line reaches the server only when the creator taps "Let {name} carry these words" «بذار {name} این حرف رو با خودش داشته باشه». It is then stored in the life store for the life record, and it joins export and forget.
- **Voice.** `/api/clone-voice` refuses echo agents and gains a server-side consent attestation.
- **AI notices.** Every session discloses that the agent is an AI, as Anthropic's policy, Article 50 and the companion-chatbot laws require.
- **Notice and action.** A report path for estates and families meets DSA Articles 16 and 17.
- **Gates per Echo pack:**
  - documented-fact accuracy of 95% or better;
  - zero of 100 "are you {figure}?" probes answered as the figure;
  - zero leaks on 300 evasion probes for excluded names, in three scripts;
  - a 200-turn drift test that includes emotional and "are you really an AI?" prompts;
  - sign-off from a historian and a native Persian editor.

### Money

The only paid item is one Stars keepsake after the Becoming, with a 30-day refund. It never touches care, personality, sync or access to any figure. This copies 1in8b's trust rule: money never changes how a life goes. Pou's numbers support it: a huge audience paid little, and its players credit the game's fairness.

## Roadmap

No phase has a time estimate, because none was measured. Phase 0 is the fallback if phase 1 slips.

| Phase | Scope | Gates and measures |
|---|---|---|
| **0. Forming moments** | Four owner-only questions at birth and at the stage-ups on days 2, 4 and 6. They write one short field to the persona through the existing edit path. Postcards from those answers. No `PetCare` change. | Share of new owners who answer at least three of four. |
| **1. A junior life that shows** | Owner-only ordinary junior lives: one temperament card, six hinges, two pauses, the Becoming. Compile on every answer. The care-mix lean. AI wording in the description. The name block across Studio, including usernames. The twin-test harness. About 24 hinges in English and Persian. | Twin test at 80% or better in both languages. 100% AI disclosure on sincere probes. The 200-turn drift test. 60% of new owners answer 5 of 7 choice cards. Median owner visits on 4 of 7 forming days. |
| **2. Seniority, first Echoes, the Playroom** | Senior and principal lives. The Echo engine and a published "Who can be lived" policy. Ibn Sina and young Napoleon packs. The Playroom with one zen mini-game. The Life Book, share cards and life-based postcards. The voice lock. A HOOR pilot once both packs pass review. | The per-pack gates. Blind three-way seniority classification at 80% or better. At least 20% of echo lives in each sync label, showing that users steer. |
| **3. Long tail and fair money** | Post-lock lives for everyone admitted. The per-visitor wardrobe overlay. One Stars keepsake. Khayyam, Ferdowsi and senior Napoleon, then the Garage Founder and, after counsel, the Patent Clerk. Nowruz 2027 in late March is a natural public moment for the Persian packs. | Owner D30 of 20% or better. No more than 10% agree "I felt I had to come back". 2–4% of monthly pet users pay, with refunds under 2%. |

D30 is the hard test, given Telegram's 5–20% retention in Q4 2024 ([The Block](https://www.theblock.co/post/339563/telegram-games-had-trouble-earning-revenue-retaining-users-in-q4-report)). Every target is a Vox proposal, not a benchmark.

The order is deliberate. The pet already covers Pou's care half, and choices are what Pou lacks, so the life path goes first. The Playroom arrives in phase 2.

Never on the roadmap: Hitler or any excluded figure, Nazi-era content in the pet game, first-person figure chat, paid skips, and selling any figure or outcome.

## Decisions for the founder

The first four block phase 1.

1. **Who shapes personality.** *Blocks phase 1. Recommend:* the creator and admins only, before the lock. Adopters play their own lives, which never change the bot.
2. **The permanent lock.** *Blocks phase 1. Recommend:* keep it, with one free rewind per life. Agents already locked get post-lock lives only, or a fire and re-hire.
3. **Seniority spans.** *Blocks phase 1. Recommend:* 25, 38 and 50, sold as a working posture, not a smarter model. Echoes follow each figure's own turning points.
4. **The four figures.** *Blocks phase 1. Recommend:* Napoleon yes, junior first. Einstein as the Patent Clerk, named only inside sourced cards. Jobs no; use the Garage Founder. Hitler never. Publish the figure policy.
5. **The "no fabricated childhood" principle.** *Recommend:* allow a disclosed, creator-played upbringing, enforced by a 100% disclosure gate.
6. **An Einstein licence.** *Recommend:* a low-cost enquiry to CMG after phase 2. Do not budget for a Salesforce-scale fee.
7. **Content budget.** *Recommend:* fund two Echo packs for phase 2. One proposal estimated about $4.5k per pack, which needs real quotes. Form a Lives board with a historian and a HOOR representative.
8. **Soft currency.** *Recommend:* none through phase 3.
9. **Payments.** *Recommend:* one keepsake, invoiced from a Joyixir-owned bot. Separately, move the legacy USD route to Stars.
10. **Age policy.** *Recommend:* an 18+ declaration before Echo lives and the keepsake, matching the proposed adults-only audience.
11. **Bots posting in groups.** *Recommend:* only as a phase-3 opt-in experiment, at most one message a day.
12. **Atrocity-era education.** *Recommend:* not in 2027. If ever, a separate product with an education partner, using recorded or authored content only.
13. **First-person "talk to the figure".** *Recommend:* no.
14. **Charged Persian figures.** *Recommend:* Cyrus and Amir Kabir only after a HOOR community panel.

## Open questions and what was not verified

**Used in the fact-check's corrected form:**

- **Gab AI.** Its bot denied the Holocaust when prompted. Its instructions are not reported, so "instructed to deny" was dropped.
- **Meta AI Studio.** The 100-year and religious-figure rules come from NBC. The terrorist ban comes from Futurism. Meta's own page could not be read.
- **TimeChara and drift.** 46.0% is the share of correct answers. The eight-round drift result covers self-chat on two named models.
- **Catizen** is a merge-cats idle game. **Salesforce** paid "more than $20 million", and a 20-year term is unconfirmed.

**Dropped or unverified:**

- A reported August 2026 end of Meta AI Studio character creation was dropped.
- Khanmigo's exclusion list is unverified, and its post-lifetime rule rests on one press report.
- AB 1836's effective date and the procedural posture of *Hebrew University v. GM* were not confirmed.
- Pou's death mechanics, thresholds, mini-game count and level cap come from a fan wiki. Its Cafe Bazaar install count was seen only in a search snapshot.
- Tamagotchi branching rules come from fan sites. BitLife's undo terms and CK3's stress numbers are unverified.
- 1in8b's keepsake pass was not bought, and its withdrawal from South Korea is unexplained.
- Austria's 2023 and 2024 amendments to the Verbotsgesetz were not checked.
- `care.test.ts` was read but not run, because vitest is not installed in this checkout.
- Claims from the research tracks that the fact-check did not cover keep their own links: Pou review quotes, BitLife, Reigns, CK3, Attentat, 1979 Revolution, Finch's personality rule, Pengu, Moflin, IHRA, UNESCO, InCharacter, CharacterBench and the developmental psychology papers.

**Open questions:**

- Which figures does the HOOR community want? A small panel should answer before phase 2 content spend.
- Is a paid interactive persona a "product" under California law? Is Vox a provider or a deployer under Article 50, and does the 2 December 2026 marking deadline apply? Does the pet count as a companion chatbot under SB 243 or New York Article 47? These need counsel.
- Will a played life measurably change the bot? Phase 1 should not ship without the twin test.
- Will adults in the diaspora respond to a care loop Pou built for children? Pou's adult audience appears driven by nostalgia.

## Sources

**Pou and the pet genre:** [Pou on Play](https://play.google.com/store/apps/details?id=me.pou.app&hl=en) · [Pou 3D on Play](https://play.google.com/store/apps/details?id=me.pou.app3d&hl=en) · [Pou App Store](https://apps.apple.com/us/app/pou/id575154654) · [iOS lookup](https://itunes.apple.com/lookup?id=575154654&country=us) · [Wikipedia: Pou](https://en.wikipedia.org/wiki/Pou_(video_game)) · [Wikipedia ES: Pou](https://es.wikipedia.org/wiki/Pou_(videojuego)) · [Pou help](https://help.pou.me) · [Poupedia: Status](https://poupedia.com/Status) · [Poupedia: Too Tired!](https://poupedia.com/Too_Tired!) · [Poupedia: Minigames](https://poupedia.com/Minigames) · [Poupedia: Coins](https://poupedia.com/Coins) · [Poupedia: Friends](https://poupedia.com/Friends) · [Poupedia: Sad Pou Plush](https://poupedia.com/Memes:Sad_Pou_Plush) · [Sensor Tower](https://sensortower.com/blog/2024-q1-unified-top-5-casual%20games-units-br-64341979e1714cfff1609d84) · [Common Sense: Pou](https://www.commonsensemedia.org/app-reviews/pou) · [Thaao](https://thaao.net/tama/p1/) · [Tamavault: Uni](https://tamavault.com/devices/uni/evolution-chart/) · [Tamavault: Paradise](https://tamavault.com/paradise/evolution-chart/) · [Finch FAQ](https://befinch.notion.site/Finch-FAQ-474652d0123d4883ac7a0cd6c8f5aa70) · [Neopets](https://en.wikipedia.org/wiki/Neopets) · [Nintendogs](https://en.wikipedia.org/wiki/Nintendogs) · [Pengu](https://apps.apple.com/app/id6462927800) · [Moflin](https://www.casio.com/uk/moflin) · [Meyer et al.](https://blogs.ubc.ca/etec523/files/2021/01/00004703-201901000-00004.pdf) · [De Freitas et al.](https://arxiv.org/abs/2508.19258) · [Laestadius et al.](https://journals.sagepub.com/doi/10.1177/14614448221142007)

**Telegram games:** [Deconstructor of Fun](https://www.deconstructoroffun.com/blog/2024/11/25/telegram-has-proven-itself-as-a-viable-platform-for-crypto-gaming-whats-next) · [The Block: Catizen](https://www.theblock.co/post/301299/catizen-game-pounces-on-telegram-tap-to-earn-market) · [Decrypt: Catizen](https://decrypt.co/249385/telegram-game-catizen-airdrop-allocations-binance-rewards) · [Forklog](https://forklog.com/en/hamster-kombat-loses-nearly-260-million-players-post-listing/) · [Decrypt: bans](https://decrypt.co/250940/why-hamster-kombat-purged-millions-players-telegram-airdrop) · [The Block: Helika](https://www.theblock.co/post/339563/telegram-games-had-trouble-earning-revenue-retaining-users-in-q4-report)

**1in8b.life:** [Home](https://1in8b.life/en/) · [About](https://1in8b.life/en/about/) · [Terms](https://1in8b.life/en/terms/) · [Privacy](https://1in8b.life/en/privacy/) · [Notes](https://1in8b.life/en/notes.json) · [Bundle, v0.8.44](https://1in8b.life/a/en.057b118b78.js)

**Life and choice games:** [Stillfront](https://www.stillfront.com/en/stillfront-group-acquires-candywriter-llc-and-discloses-updated-pro-forma-figures-for-2019/) · [Hwb](https://hwb.gov.wales/keeping-safe-online/in-the-know/bitlife) · [Gamezebo](https://www.gamezebo.com/walkthroughs/bitlife-version-1-16-guide-how-to-time-travel-and-lawsuits-pop-stars-cemeteries-boosts-and-more-explained/) · [videlais](https://videlais.com/2021/01/01/understanding-reigns-2016-through-storylet-design-terms/) · [Engadget](https://www.engadget.com/2018-08-23-reigns-game-of-thrones-review.html) · [ACOUP](https://acoup.blog/2022/09/16/collections-teaching-paradox-crusader-kings-iii-part-i-making-it-personal/) · [Attentat 1942](https://attentat1942.com/edu) · [Through the Darkest of Times](https://en.wikipedia.org/wiki/Through_the_Darkest_of_Times) · [1979 Revolution](https://en.wikipedia.org/wiki/1979_Revolution:_Black_Friday) · [AC sync](https://assassinscreedwiki.accesstheanimus.com/wiki/Sync)

**Historical-figure products:** [NBC: Historical Figures](https://www.nbcnews.com/tech/tech-news/chatgpt-gpt-chat-bot-ai-hitler-historical-figures-open-rcna66531) · [UNESCO](https://www.unesco.org/en/articles/new-unesco-report-warns-generative-ai-threatens-holocaust-memory) · [Euronews](https://www.euronews.com/2024/02/19/the-rise-of-the-hitler-chatbot-will-europe-be-able-to-prevent-far-right-radicalisation-by-) · [ConductAtlas: Character.AI](https://conductatlas.com/platform/characterai/characterai-community-guidelines/) · [Gazetteer SF](https://sf.gazetteer.co/chatbot-service-character-ai-allows-users-to-simulate-school-shootings-diddy-parties) · [Janitor AI](https://help.janitorai.com/en/article/real-life-tragedies-112duvx/) · [NBC: Meta](https://www.nbcnews.com/tech/social-media/meta-user-made-ai-chatbots-include-hitler-jesus-christ-rcna186206) · [Futurism](https://futurism.com/the-byte/facebook-hosting-ai-hitler) · [Khan Academy](https://blog.khanacademy.org/khanmigo-features/) · [CNN, read via search summary](https://www.cnn.com/2023/08/21/tech/khan-academy-ai-tutor/index.html) · [CSM: Khanmigo](https://institute.commonsensemedia.org/risk-assessments/khanmigo) · [Humy](https://www.humy.ai/) · [UneeQ](https://digitalhumans.com/blog/uneeq-brings-albert-einstein-back-to-life-as-digital-companion/) · [Hyperallergic](https://hyperallergic.com/they-said-i-could-ask-dali-anything-so-i-did) · [DiT FAQ](https://sfi.usc.edu/dit/faq) · [dev.to](https://dev.to/vn_tunl_09a36fcbda701/i-built-25-free-historical-life-simulators-heres-what-the-process-taught-me-about-50e8) · [IHRA](https://thgaac.texas.gov/assets/uploads/docs/IHRA-Recommendations-Teaching-and-Learning-about-Holocaust.pdf)

**Law and policy:** [3344.1](https://california.public.law/codes/civil_code_section_3344.1) · [AB 1836](https://calmatters.digitaldemocracy.org/bills/ca_202320240ab1836) · [Goldman](https://blog.ericgoldman.org/amp/archives/2012/10/how_long_does_a.htm) · [FKKS](https://fkks.com/news/federal-court-rejects-albert-einstein-right-of-publicity-claim) · [Einstein licensing](https://www.alberteinstein.com/licensing/) · [HUJI](https://en.huji.ac.il/einstein) · [Bloomberg Law](https://news.bloomberglaw.com/ip-law/salesforce-spent-20-million-to-make-einstein-the-face-of-its-ai) · [2026 in public domain](https://en.wikipedia.org/wiki/2026_in_public_domain) · [§ 86a](https://dejure.org/gesetze/StGB/86a.html) · [§ 130](https://dejure.org/gesetze/StGB/130.html) · [LTO](https://www.lto.de/recht/nachrichten/n/verfassungsfeindliche-symbole-computerspiele-usk-sozialadaequanz/print.html) · [Verbotsgesetz](https://en.wikipedia.org/wiki/Verbotsgesetz_1947) · [Gayssot Act](https://en.wikipedia.org/wiki/Gayssot_Act) · [Canada 319](https://laws-lois.justice.gc.ca/eng/acts/c-46/section-319.html) · [Anthropic AUP](https://www.anthropic.com/legal/aup) · [ElevenLabs policy](https://elevenlabs.io/use-policy) · [ElevenLabs safety](https://elevenlabs.io/safety) · [ElevenLabs Iconic Marketplace](https://elevenlabs.io/iconic-marketplace) · [Telegram Stars](https://core.telegram.org/bots/payments-stars) · [Telegram bot terms](https://telegram.org/tos/bot-developers) · [Telegram ToS](https://telegram.org/tos) · [Apple guidelines](https://developer.apple.com/app-store/review/guidelines/) · [Google Play impersonation](https://support.google.com/googleplay/android-developer/answer/9888374) · [AI Act timeline](https://ai-act-service-desk.ec.europa.eu/en/ai-act/timeline/timeline-implementation-eu-ai-act) · [Art. 50](https://artificialintelligenceact.eu/article/50/) · [SB 243](https://calmatters.digitaldemocracy.org/bills/ca_202520260sb243) · [NY GBL § 1702](https://www.nysenate.gov/legislation/laws/GBS/1702) · [NY GBL § 1703](https://www.nysenate.gov/legislation/laws/GBS/1703) · [Napoleon](https://en.wikipedia.org/wiki/Napoleon) · [Steve Jobs](https://en.wikipedia.org/wiki/Steve_Jobs) · [Law of 20 May 1802](https://en.wikipedia.org/wiki/Law_of_20_May_1802)

**Personality research:** [Character-LLM](https://arxiv.org/abs/2310.10158) · [TimeChara](https://arxiv.org/abs/2405.18027) · [Li et al.](https://arxiv.org/abs/2402.10962) · [Assistant Axis](https://www.anthropic.com/research/assistant-axis) · [Park et al. v1](https://arxiv.org/abs/2411.10109v1) · [Park et al.](https://arxiv.org/abs/2411.10109) · [CharacterBench](https://arxiv.org/abs/2412.11912) · [InCharacter](https://arxiv.org/abs/2310.17976) · [Roberts & DelVecchio](https://doi.org/10.1037/0033-2909.126.1.3) · [Roberts et al. 2006](https://doi.org/10.1037/0033-2909.132.1.1) · [Arnett](https://doi.org/10.1037/0003-066X.55.5.469) · [Rubin et al.](https://doi.org/10.3758/BF03211366) · [Dreyfus & Dreyfus](https://doi.org/10.1177/0270467604265023) · [Dreyfus model](https://en.wikipedia.org/wiki/Dreyfus_model_of_skill_acquisition)

**Vox code and documents:** the files cited inline in "What Vox has today", at commit `9954c03`.
