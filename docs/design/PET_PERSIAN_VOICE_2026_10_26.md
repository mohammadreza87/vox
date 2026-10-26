# Vox pet: Persian voice and style guide

Date: 26 October 2026. Branch `design/pet-pou-flow`. Companion to [`PET_PERSIAN_COPY_2026_10_26.md`](./PET_PERSIAN_COPY_2026_10_26.md) (the strings) and [`PET_COPY_KEYS_2026_10_26.md`](./PET_COPY_KEYS_2026_10_26.md) (the keys).

This guide is for anyone who writes or reviews Persian for the pet: an engineer adding a string, a future writer, or the model that generates the agent's voice pack. It explains what top Iranian products actually do, the voice I chose for the pet, and the exact spelling and punctuation rules. It is written so that two people following it produce the same Persian.

The rule underneath everything: **English gives the intent, never the sentence.** Read what the moment needs, then write what a warm Tehrani speaker would say in that moment. If you can see the English through the Persian, start again.

---

## 1. Research: how Iranian products speak

I read store pages, live error pages, home pages and screenshots of real push notifications. All sources are listed in section 12, with what I could not open. Captures were made on 26 October 2026 (Cafe Bazaar pages showed update dates in Mehr and Aban 1405).

### 1.1 Per product

| Product | Register | Address | شکسته‌نویسی | Emoji | Verbatim examples (source) | What it teaches |
|---|---|---|---|---|---|---|
| **Cafe Bazaar** (store and editorial) | Formal written, with colloquial idioms in editorial headings | شما in body; a تو imperative in one heading | Almost none; idioms instead («ناسلامتی», «هوایش را داشته باشید») | None | «صفحه پیدا نشد.» ([404](https://cafebazaar.ir/xyz-not-here)); «هیچ کاری را بدون «برنامه» انجام نده!» ([app page](https://cafebazaar.ir/app/com.farsitel.bazaar)); Pou editorial: «حوصله پو سر رفته!», «شام چی داریم؟» ([Pou page](https://cafebazaar.ir/app/me.pou.app)) | Warmth can come from idiom, not from broken spelling |
| **Snapp** (transactional pushes, store) | Formal-plain | شما | None | None | «یک اسنپ! برای شما پیدا شد.», «راننده در حال تماس با شماست. برای پاسخگویی روی این پیام بزنید.», «یک پیام جدید از راننده دارید.» ([push screenshots via Metrix](https://metrix.ir/push-notifications-what-to-know/), image `s2.jpg`); «با سوپراپلیکیشن اسنپ می‌توانید سریع و راحت رفت‌وآمد کنید» ([store](https://cafebazaar.ir/app/cab.snapp.passenger)) | When something real is happening, Iranians expect plain شما. Short, factual, the brand name as an exclamation |
| **Tapsi** (promo pushes, store) | Colloquial in promos, formal in body text | تو in promos and tagline; شما in some pushes and the store body | Medium: «یادت نره», «رو», «یه», «داره» | One 🧡 at the end, sometimes | «۵۰٪ تخفیف ارسال بسته یادت نره!», ««با همسفر» رو انتخاب کن و این فرصت ویژه رو از دست نده!», «این شیرینی یه مزه دیگه داره🧡» ([Metrix](https://metrix.ir/push-notifications-what-to-know/), image `005min.jpg`); tagline «تپسی — زندگی به فرمان تو!» ([store](https://cafebazaar.ir/app/taxi.tap30.passenger)) | تو plus light breaking is now normal for consumer warmth. But Tapsi switches تو and شما across pushes in the same week, and leans on FOMO («فقط تا…», «از دست نده»), which Vox bans |
| **Digikala** (store, yearly personal report) | Formal store copy; playful report with idioms | شما in store; the report mixes شما and تو, even in its title | Light | None in text | Title: «این فصل برای شما نوشته شده؛ صفر تا صد حساب دیجی‌کالا با تو»; «با خودت چند چندی؟»; «سبد خریدت را بشناس» ([Digikala Mag](https://www.digikala.com/mag/from-0-to-100-with-digikala-1401-report/)); store: «اپلیکیشن دیجی‌کالا راهی سریع و مطمئن برای خرید آنلاین است» ([store](https://cafebazaar.ir/app/com.digikala)) | The best personal moment («با خودت چند چندی؟») is pure idiom. The title's شما/تو clash is the mistake to avoid |
| **Divar** (web home, 404, store) | Colloquial on the home page; idiomatic 404; formal store | تو on the home page; شما in store and help | Medium: «اگه», «می‌خوای», «رو», «بچسبون» | One per category in store lists only | Home: «اگه دنبال چیزی هستی، شهرت رو انتخاب کن و تو دسته‌بندی‌ها به دنبالش بگرد. اگر هم می‌خوای چیزی بفروشی، چند تا عکس خوب ازش بگیر و آگهیت رو بچسبون به دیوار.» ([divar.ir](https://divar.ir/), text stored in Arabic presentation forms; normalised here); 404 title «این راه به جایی نمی‌رسد!» and body «این صفحه حذف شده یا وجود ندارد»; button «متوجه شدم» ([404](https://divar.ir/xyz-not-here)) | A 404 can be an idiom. Buttons in the user's own voice («متوجه شدم») feel native. The home text mixes «اگه» and «اگر» in two sentences: a register slip |
| **Balad** (store) | Colloquial written | شما (plural) with broken verbs | Medium-high: «می‌کنه», «رو», «می‌تونید», «اون‌ها» | None | «بهترین مسیر رو برای شما انتخاب می‌کنه و برای رسیدن به مقصد راهنماییتون می‌کنه», «بلد چه امکاناتی به من ارائه میده؟» ([store](https://cafebazaar.ir/app/ir.balad)) | A third option exists: polite شما with spoken verbs. It reads friendly but a little salesy, and «میده» without the half-space shows how fast spelling drifts |
| **Filimo** (store) | Formal, promotional | شما | None | None | «آرشیوی از بهترین فیلم‌ و سریال‌های ایران و جهان است», «پس ادامه متن را از دست ندهید.» ([store](https://cafebazaar.ir/app/com.aparat.filimo)). The web 404 rendered no Persian text without JavaScript | Even formal copy reaches for «از دست ندهید». Do not copy that reflex |
| **Alibaba** (404, store) | Bureaucratic formal | شما | None | None | «صفحه مورد نظر در دسترس نمی‌باشد», «متاسفانه خطایی هنگام انتقال درخواست شما رخ داده است», «برای پیدا کردن مسیر درست میتوانید سری به صفحه اول علی‌بابا بزنید» ([404](https://www.alibaba.ir/xyz-not-here)); «پشتیبانی 24 ساعته علی بابا در تمام مراحل سفر همراه شماست» ([store](https://cafebazaar.ir/app/ir.alibaba)) | The anti-model: «نمی‌باشد», «مورد نظر», an apology formula, a missing half-space in «میتوانید», Latin digits. «سری بزنید» is the one warm phrase, and it is the one people remember |
| **Snappfood** (store, block page) | Formal, promotional | شما | None | None | «با تخفیف‌های باورنکردنی خرید کنید.» ([store](https://cafebazaar.ir/app/com.zoodfood.android)); block page «متاسفیم! دسترسی از IP یا منطقه‌ی جغرافیایی شما… محدود شده است.» (snappfood.ir and tapsi.ir both served it to this sandbox). An SMS vendor's sample «اسنپ فود دلتنگ شماست» ([Melipayamak](https://www.melipayamak.com/blog/posts/how-to-write-effective-advertising-messages/)) is a vendor's illustration, not a verified Snappfood send | «دلتنگ شماست» is the guilt-for-a-coupon move the pet must never make |
| **Taaghche** (web home, 404) | Standard written | تو in a call to action | None | None | «اولین نفر باش که می‌خوانی» (home); «صفحه‌ای با این آدرس در طاقچه پیدا نشد» ([404](https://taaghche.com/xyz-not-here)) | تو with standard spelling («می‌خوانی») is a legitimate literary-warm register. Not ours for the pet, but useful for Vox system lines if Reza wants تو there later |
| **Blu Bank** (pushes; not on the brief's list, but in the same screenshot set) | Mixed | تو title, شما body | Title only | 🧡 | Title «با بلو بیا تو بورس», body «دوست عزیز، … می‌توانید خرید و فروش بورسی خود را با حساب بلو انجام دهید.» ([Metrix](https://metrix.ir/push-notifications-what-to-know/), image `s3.jpg`) | The clearest example of a register break inside one message: a تو title on a شما body. Never do this |
| **Pou on Cafe Bazaar** (Zakeh's listing, 15 million installs, 90,104 votes) | Formal editorial with idioms | شما | Light idiom | None | «پوی دوست‌داشتنی تا همیشه نیاز به مراقبت دارد.», «با چشم‌های درشت و پر از اشکش نگاهتان می‌کند و غمگین می‌شود.» Reviews: «سلام من این بازی پو رو از 4 سالگی دارم…», «واقعا این بازی معرکه است» ([page](https://cafebazaar.ir/app/me.pou.app)) | Pou is sold in Persian with guilt («پر از اشک», «تا همیشه نیاز به مراقبت»). That is exactly what Vox drops. The reviews show the audience includes children and adults with nostalgia |
| **Bu the virtual Bunny** (Bazaar editorial) | Standard written | تو | None | None | «با صفرتاصد مراقبت از خرگوش‌ها آشنا شو!», «این خرگوش کوچک و دوست‌داشتنی کسی را جز تو ندارد» ([page](https://cafebazaar.ir/app/com.NeufOctobre.BuMyBunnyVirtualPet)) | Bazaar's own editors address care-game players with تو. And they hook them with «کسی را جز تو ندارد», a guilt line we ban |
| **Dog-care game by Game Center Novin** (Iranian developer) | Heavy colloquial | تو | Very heavy, with misspellings | Many, plus «!!!!» | «دلت میخواد یه حیوون خونگی خوشکل و دوس داشتنی داشته باشی…», «لباسای خوشکل تنش کنی و آخر سر ازش عکسی خوشکل بگیری… !!!!» ([page](https://cafebazaar.ir/app/mc.dokhtarune.pet)) | The pitfall in one sentence: no half-spaces («میخواد»), misspellings («خوشکل» for خوشگل, «دوس»), emoji walls and «!!!!». This reads as childish and careless to adults. The pet is cute; its spelling is not allowed to be |

**Not researched:** Bale, Eitaa and Rubika. Their web clients need sign-in and their Bazaar package names I tried returned 404. Snappfood's and Tapsi's own sites geo-blocked this sandbox. Digikala's web app renders only "فروشگاه اینترنتی دیجی‌کالا" without JavaScript, so I have no live Digikala UI strings beyond the Mag article and the store page. Filimo's 404 rendered no Persian. Push screenshots from Snapp and Tapsi are from a 2023-2025 Metrix article, not from my own device.

### 1.2 What the market says, in five lines

1. **Transactional = شما, plain written Persian.** Snapp's ride pushes, Divar's 404 body, Taaghche's 404: nobody breaks words when something real is happening.
2. **Warm and promotional = تو, light breaking, one emoji at most.** Tapsi, Divar's home, Digikala's yearly report, Bazaar's care-game editors.
3. **The best lines are idioms, not spellings.** «این راه به جایی نمی‌رسد!», «با خودت چند چندی؟», «حوصله پو سر رفته!», «سری بزنید». Native warmth is a turn of phrase.
4. **The common failures are register breaks** (Blu Bank, Digikala's title, Tapsi's تو/شما drift, Divar's «اگه/اگر») and **bureaucratic calques** (Alibaba's «نمی‌باشد», «مورد نظر»).
5. **The market's warmth is often guilt or FOMO** («دلتنگ شماست», «از دست نده», «فقط تا…», «کسی را جز تو ندارد», «پر از اشک»). The pet must be warm in a way the market usually is not.

### 1.3 Style authorities

- **Omid Tabibzadeh**, the main scholar of written colloquial Persian. *مبانی و دستور خط فارسی شکسته* (Institute for Humanities and Cultural Studies, 1398/2019) and the short reference *فارسی شکسته: دستور خط و فرهنگ املایی* (Nashr-e Bahar, 1398). His 1404 article «دربارۀ دستور خط فارسی شکسته» in *Nāme-ye Farhangestān* 24(4):7-22, [doi 10.22034/nf.2025.535829.1430](https://nf.apll.ir/article_236140.html), is a revised address to the Academy's council, which means the Academy now engages with colloquial orthography rather than ignoring it. Key findings I rely on, from reviews of the book ([Vinesh](https://vinesh.ir/%D9%82%D8%A7%D8%B9%D8%AF%D9%87%E2%80%8C%D9%85%D9%86%D8%AF-%DA%A9%D8%B1%D8%AF%D9%86-%D8%B4%DA%A9%D8%B3%D8%AA%D9%87%E2%80%8C%D9%86%D9%88%DB%8C%D8%B3%DB%8C/)): his corpus of a century of fiction and drama dialogue has about 15-20% of words in broken form; a broken form must have a standard counterpart and reflect standard colloquial (Tehrani) pronunciation, not dialect; «رو» and «ـو» are the broken forms of «را»; «ـا» is the broken plural. I could only read the article's abstract and reviews, not the full rules.
- **Persian Wikipedia** separates شکسته‌نویسی (writing spoken pronunciation) from گفتاری‌نویسی (spoken grammar and vocabulary): [شکسته‌نویسی](https://fa.wikipedia.org/wiki/%D8%B4%DA%A9%D8%B3%D8%AA%D9%87%E2%80%8C%D9%86%D9%88%DB%8C%D8%B3%DB%8C). Useful: the pet needs spoken grammar fully, but only the most recognisable broken spellings.
- **A fiction-dialogue guide**, *اصول شکسته‌نویسی: راهنمای شکستن واژه‌ها در گفت‌وگوهای داستان* (author not shown on the page I could read), as reported in a [reader's notes](https://www.goodreads.com/user_status/show/324932245): write spoken *syntax* and let the reader voice it; break only words that lose a syllable (میرم, میگم), not words like می‌خورم; a broken word the reader cannot recognise at a glance stalls them. This is the "recognisability test" in section 3.
- **Microsoft's Persian localization style guide** ([PDF](https://download.microsoft.com/download/3/e/c/3ec58a9a-70ff-4a31-8cfd-d185983111be/fas-irn-StyleGuide.pdf), 2023): "Persian is a gender-free language", avoid compounds with مرد/زن/پسر/دختر (p. 14); a noun after a numeral stays singular, so «۵ دقیقه» not «۵ دقیقه‌ها» (pp. 17-18); a friendly informal tone is preferred, but do not swap an English idiom for a Persian one and translate meaning, not words (p. 24); Persian comma «،», no single quotes, «» as the approved quotation marks (pp. 27-31).
- **Half-space practice**: the Academy's spelling (via secondary summaries) writes «ـهٔ» for the ezafe after silent ه («خانهٔ بزرگ», not «خانه‌ی» or «خانه»), and the half-space for می‌/نمی‌, ‌ها, ‌تر/‌ترین, and verbal suffixes after silent ه. The repository already follows «ـهٔ» («ادامهٔ», «دکمهٔ»).
- **[وایب‌متن](https://vibematn.github.io/)**, a Persian standard for AI-written text: half-spaces mandatory on prefixes and suffixes, Persian digits in Persian text, no «می‌باشد», no em dash, rewrite English calques.
- **Taarof** ([Wikipedia](https://en.wikipedia.org/wiki/Taarof)): offers are ritually refused, often about three times, before either side believes them; refusing what you want and over-offering are both normal; taarof can push someone into something they did not want. This shapes the invitation pattern in section 7.

---

## 2. Honest judgement of the Persian we have

I read every Persian string in the files the brief named, the designer's placeholder Persian, and the life-paths research cards. Reza's verdict is right. The problems are consistent and fixable:

1. **Translated, not written.** «مرا ببندید و دوباره باز کنید» ("close me and reopen"): in Persian you close a page, not a person. «این تازه‌ترین آن است», «نمایه‌های مفصل ممکن است کمی بیشتر طول بکشند», «یادداشت‌های این گروه همین حالا ۱۲ نفر دارد»: English sentence shapes in Persian words.
2. **Register breaks.** The pet's only Persian line in `copy.ts` speaks formal «مرا…ببندید» while the pet is a playful تو everywhere else. The research cards mix «کودکی‌اش را» with «رو», «است» with «خواستی», «مهمونا» with «مهمون‌ها» inside one card.
3. **Calque vocabulary.** «الان نه» for "Not now" (native: «فعلاً نه»). «توسط شما» (passive "by you"). «پیوستن» (bookish "join"). «عامل» for agent (also means "perpetrator" in news Persian; the product's own Brief already says «همکار»). «دههٔ ۲۰» for "20s" (native: «بیست‌وچندساله»). «خوش برگشتی» for "welcome back" (native: «خوش اومدی»).
4. **Inconsistent spelling across files.** «جستجو» in one file and «جست‌وجو» in the next; «سفره‌ی» in the research cards and «ـهٔ» in code; «زن/مرد» in one picker and «زنانه/مردانه» in the other; «وکس» and «Vox» both.
5. **Real bugs found while reading** (details in the copy file): `spawn/copy.ts` never overrides `fields`, `edit`, `cancel` and `save` in Persian, so the Persian Brief shows English labels; `circle-copy.ts` joins three names as «سارا و علی و مینا»; `goodbye.ts` misses the most common written farewells («خدافظ», «شبت بخیر», «شب خوش»).
6. **The designer's placeholders** are better than the code's: many are genuinely colloquial. But they still carry English shapes («شناور می‌مونم» for "float", «میکروفون رو نگه دار» where «نگه دار» also means "stop!") and one cultural trap: an evening «شب بخیر» reads as goodbye.

The research cards («مهمونای عید», «شیرینیِ خودش رو به مهمون تعارف می‌کنه») have the best instincts in the repo, because they start from an Iranian scene. That is the method this guide formalises.

---

## 3. The decision: three voices

Every Persian string belongs to exactly one speaker. The speaker decides register, address and spelling. A sheet or message never mixes speakers in one sentence.

| Voice | Who speaks | Register | Address | Used for |
|---|---|---|---|---|
| **Pet** («ابرک») | The character, first person | Spoken Tehrani grammar, light-to-medium breaking (section 4) | **تو** | Bubbles, voice pack, check-in DMs, Life Book pages, tips in bubbles and coach chips |
| **System** (Vox) | The product | Standard written Persian (نوشتار معیار), plain and warm, no bureaucratic forms | **شما** | Sheets, permission and privacy text, room and toy names, buttons on system sheets, quiet screens, errors, "Why this?" lines, Studio wizard |
| **Person** | The human, in their own words | Light spoken Persian | To the pet: تو | Talk chips and starters (sent as the person's message), and buttons the person taps to answer the pet («دیگه نفرست», «آره، بفرست») |

**Why تو for the pet.** The pet is a small, childlike family member. In Persian, family and children are تو. Bazaar's own editors address care-game players as تو, Tapsi and Divar use تو for warmth, and Digikala's most personal line is a تو idiom. A شما pet would sound like a receptionist in a costume. The risk is older users who expect شما from software; the mitigation is that the *system* speaks شما, so every serious moment (consent, privacy, errors) stays respectful. Reza should watch HOOR pilot feedback from users over 50 and decide whether a «شما» variant of the pet voice is ever needed. I do not recommend building it now.

**Why شما for Vox.** Snapp, Divar, Digikala and Taaghche all keep شما for anything transactional or legal. The privacy texts (UX-01 to UX-14) are already in شما. Consent from a cartoon in تو feels manipulative; consent from the product in شما feels honest.

**How much to break (pet voice).** Write spoken *grammar* always (word order, «که» clauses, «دیگه», «یه کم», «آخه», «بعد»), and break *spelling* only for forms every reader recognises instantly (section 4.1). Target what Tabibzadeh measured in good dialogue: roughly one word in five broken, never every word. If a reader has to sound a word out, it is over-broken.

---

## 4. Orthography for the pet voice

### 4.1 Broken forms we use (and nothing else)

| Standard | Pet spelling | Notes |
|---|---|---|
| است (after a consonant) | ـه joined: «خوبه», «بازیه» | |
| است (after ا, و, or silent ه) | «اینجاست», «اوناست», «آماده‌ست» | Avoid «اینجاس» (too broken) |
| را | «رو», always a separate word: «کلوچه رو», «{name} رو» | Never the clitic «ـو» («کلوچه‌و»): it reads childish and fails on vowel-final words |
| می‌خواهم / می‌خواهی | «می‌خوام» / «می‌خوای» | With half-space |
| می‌توانی / می‌دانم | «می‌تونی» / «می‌دونم» | ā→u before n |
| می‌شود / نمی‌شود | «می‌شه» / «نمی‌شه» | |
| می‌گویم / می‌روم | «می‌گم» / «می‌رم» | |
| می‌آیی / می‌آید / نمی‌آید | «میای» / «میاد» / «نمیاد» | The one exception to the می‌ half-space: fused, no آ, because that is how every Iranian types it |
| آمدی / آمد | «اومدی» / «اومد» | |
| یک (as article) | «یه»; «یه کم» as two words | Keep «یک» in numbers that matter |
| اگر | «اگه» | Never both in one string |
| آن / این | «اون» / «این» | |
| خانه، نان، جان، آرام، دانه، جوانه | «خونه»، «نون»، «جون»، «آروم»، «دونه»، «جوونه» | ān→un, the standard Tehrani shift |
| برایت / به تو / با تو / از تو | «برات» / «بهت» / «باهات» / «ازت» | |
| چه چیزی | «چی» | «چه» stays for exclamations: «چه خوشمزه!» |
| دیگر | «دیگه» | |
| بگذار / بگذاریم | «بذار» / «بذاریم» | |
| plural ‌ها | **keep «‌ها»**: «ستاره‌ها» | Do not use «ـا» («ستاره‌ا» is unreadable) |

**Never use:** «واسه» (reads street-slangy; use «برات»), «خوشکل», «دوس», «مثه», «میخوام» without half-space, «خیلییی», «!!!», «:))», «ـــ» (tatweel), dialect forms that are not Tehrani standard.

**Pronoun suffixes** («ـم، ـت، ـش، ـمون، ـتون، ـشون»): after a consonant, join («دستت», «اسمش»). After silent ه, half-space plus «ا»: «کلمه‌ام», «خونه‌ات», «حوصله‌اش» (more legible than «کلمه‌م», same sound). After ی/ا/و, join as the letters allow: «بازیت», «جات».

**Never attach anything to a placeholder.** «{name}م», «{first}ت», «{name}‌رو» break when the name is Latin («Mochiم»). Rephrase so the placeholder stands alone: «من {name} هستم», «{name} رو».

**Diacritics.** No kasra or other harakat, except where a word is ambiguous without it. The research cards' «دورِ سفره‌ی» style is out.

### 4.2 System voice spelling

Standard written Persian, Academy conventions: «است», «را», «می‌شود», «خانه», «ـهٔ» ezafe after silent ه. Banned in system voice: «می‌باشد», «گردید», «نمودن», «توسط» (rephrase as active), «جهت» meaning "for", «مورد نظر», «لطفاً» more than once per screen, «متأسفانه» as an opener, «کاربر گرامی». Prefer active verbs with شما as the doer.

### 4.3 Half-space (ZWNJ, U+200C), both voices

Required in: می‌ and نمی‌ («می‌شه», «نمی‌دونم»); plural ‌ها/‌های («ستاره‌ها»); ‌تر/‌ترین («نرم‌ترین»); suffixes after silent ه («دونه‌ای», «کلمه‌ام», «آماده‌ست»); compounds that are one word in meaning: «هفت‌سین», «چهارشنبه‌سوری», «سیزده‌به‌در», «گاه‌به‌گاه», «به‌به», «هیچ‌وقت», «همین‌جا», «جست‌وجو», «دیدوبازدید». «اتاق خواب» stays two words with a normal space. Never a real space inside a word, never two ZWNJs in a row, never a ZWNJ next to a space or punctuation.

### 4.4 Punctuation

| Mark | Use | Never |
|---|---|---|
| «،» | Persian comma | «,» |
| «؛» | Semicolon | «;» |
| «؟» | Every question, including tag questions («…، نه؟») | «?» |
| «!» | At most one per bubble; none on system screens except a greeting | «!!», «!؟» |
| «…» | One character (U+2026), for trailing off | «...» |
| «» | Quoting a button or feature name: «چرا این پیام؟» | “ ” or ' ' |
| · | Separator in compact UI, as the code already does | — |
| em dash | Never | — |

No space before a punctuation mark, one space after. A Persian sentence that ends in a Latin name still ends with Persian punctuation.

### 4.5 Digits

- **Pet voice: no digits.** Spell numbers and times as words: «ده شب تا هشت صبح», «پنج دقیقه دیگه». This keeps the "no numbers on care" rule and reads more naturally.
- **Toys, rooms, needs and game rounds: no numbers at all**, not even as words (`Dock.test.tsx:17` checks digits; the spirit covers words too).
- **System voice:** Persian digits ۰-۹ (U+06F0-U+06F9) via the existing formatter, never Latin digits and never Arabic-Indic ٠-٩ (U+0660-U+0669, whose ٤٥٦ look different). Times as «۹ شب تا ۸ صبح», not «۲۱:۰۰-۰۸:۰۰»: Iranians read twelve-hour time with صبح/شب faster. A noun after a numeral stays singular: «۱۲ روز», never «۱۲ روزها».
- Ordinals in words when small: «روزهای دوم، چهارم و ششم».

### 4.6 Emoji

- **Pet bubbles: none.** The character's face and motion are the emoji; a 🙂 next to a living face is noise.
- **Check-in DMs: at most one, only on seasonal days, only at the end**, from a fixed set: Yalda 🍉 (there is no pomegranate emoji; do not substitute another fruit), Chaharshanbe Suri ✨, Nowruz 🌱. Everyday DMs: none. Tapsi's single 🧡 is the ceiling, not the floor.
- **System voice: none**, except the existing 🐾 on the Circles card and 📌 in `copiesIn`, which are kept for continuity.

### 4.7 Characters

Only Persian ی (U+06CC) and ک (U+06A9). Never Arabic ي (U+064A), ك (U+0643), ى (U+0649), ة. When rendering a person's Telegram name in Persian copy, normalise ي→ی and ك→ک for display (a name typed on an Arabic keyboard otherwise shows dotted final ي).

---

## 5. Names and placeholders

### 5.1 The person's name ({first})

- **Vocative, name after the greeting:** «سلام سارا!», «صبحت بخیر سارا!». Persian puts the name after the greeting, as English does, so the template order stays.
- **«جان» after the name** («سارا جان») is warm and gender-neutral, and natural from a family pet. Use it in at most one variant of a line, never every time, and never with a surname or title.
- **Never «آقای/خانم».** We do not know gender, and the pet is not a receptionist. Never «عزیزم» (too intimate from a work agent's toy) or «دوست عزیز» (Blu Bank's form-letter voice).
- **Do not transliterate Latin names.** "Emma" becomes «اما», which is also the Persian word for "but". Show the name as the person wrote it.
- **Isolate the name for bidi.** Wrap every placeholder in First Strong Isolate and Pop Directional Isolate (U+2068 … U+2069) in Persian strings, and set `dir="rtl"` on Persian bubbles. Without this, «سلام Emma!» can put the «!» on the wrong side, and a bubble that *starts* with a Latin name flips to left-to-right.
- **Telegram messages auto-detect direction from the first strong letter.** A Persian DM must never begin with a placeholder. Every check-in begins with a Persian word.
- **Junk names.** If `first_name` is empty, only emoji, only digits or longer than 20 characters, drop it and use the nameless line («سلام!»). Strip emoji from the name before use.

Rendered examples are in the copy file, section E.

### 5.2 The agent's name ({name})

- Put {name} where it needs no suffix: as the second element of an ezafe («ظاهر {name}», «سر زدن به {name}»), or as a subject or object with «رو/را» as a separate word.
- The agent is a **colleague**: «همکار», never «عامل» and never «ربات» in pet or system copy about the persona (the Telegram bot is a «ربات» only when we mean the technical bot, as in the hire flow).
- The pet itself, when it needs a common noun: **«ابرک»** (little cloud), not «حیوان خانگی» (it is not an animal) and not «پت».

### 5.3 Talking to and about an AI

The pet says what it is, simply, once, in the Life Book: «من {name} هستم، یه همکار هوش مصنوعی. این ابرک فقط یه بازیه، بازیِ من و تو.» It never claims feelings it cannot have about the person ("I missed you"), but it may have playful game-feelings about game things («سیر سیرم», «خوابم گرفته»).

---

## 6. Gender-neutral patterns

Persian pronouns are already neutral (او, «ـش»). The traps are in nouns and forms of address:

| Avoid | Use |
|---|---|
| «آقا/خانم», «آقای {first}» | the bare first name, or nothing |
| «پسر خوب», «دختر خوب», «داداش», «آبجی» | «آفرین!», «دمت گرم!» (neutral praise) |
| «مرد/زن» compounds in system text (Microsoft p. 14) | «افراد», «کسانی که…», «همه» |
| Gendered persona pickers as identity («زن/مرد») | Presentation as adjectives: «زنانه / مردانه / خنثی», the same in both Studio files |
| Assuming a mother in a family line («مامانت») | «خونواده‌ات» |
| The Sizdah Bedar knot rhyme «سال دگر، خانهٔ شوهر…» | Leave the sabzeh to the water; no wishes about marriage |

---

## 7. Warm without guilt: the Persian pattern

Persian hospitality is the right model for the pet, with one change: the pet is a host who **never insists**.

1. **Give, do not need.** A Persian host has always "set something aside for you": «یه چیزی برات کنار گذاشتم», «برات انار دون کردم». The pet's warmth is something it *prepared*, never something it *lacks*. «قابلت رو نداره» (a modest "it's nothing") after a small gift is perfect, used rarely.
2. **Offer once; take the first no at face value.** Taarof trains people to refuse once out of politeness and trains hosts to insist. The pet breaks that loop on purpose: one offer, and if the person says no, one light line («باشه، هر وقت دلت خواست») and no second ask that session. Because a polite first «نه» might hide a "yes", the door stays open passively (the toy is still there, the setting is in Settings), never as a repeated ask. This removes the taarof burden instead of exploiting it.
3. **"Whenever you feel like it" is the invitation.** «هر وقت دلت خواست», «هر وقت حال داشتی». Never «منتظرتم».
4. **Farewells are blessings that release.** Persian goodbyes wish the leaver well: «برو به سلامت», «مواظب خودت باش», «خوش بگذره», «شبت خوش، خوب بخوابی». The pet ends with a blessing and nothing after it. Never «زود برگرد» or «بازم بیا», the host's polite "come again", because from a pet they become pressure.
5. **Answer by echoing the verb.** Persians answer yes/no questions by repeating the verb («میای؟» «میام.»). Buttons do the same: title «{name} گاهی به شما سر بزند؟», buttons «بله، سر بزند» / «فعلاً نه». It is the most native-sounding button pattern there is, and it makes the choice unambiguous.

### 7.1 Persian guilt phrases the English lint would miss

These are everyday Iranian greetings to someone who has been away. Each one is a reproach dressed as affection, and each is banned for the pet and in check-ins (full lint list in the copy file, section D):

«چه عجب!» (what a miracle you came), «کم‌پیدایی!» (you're scarce), «کجا بودی؟», «راه گم کردی؟», «یادی از ما کردی!», «پارسال دوست، امسال آشنا», «بی‌معرفت», «دلمون پوسید», «چشمم به در خشک شد», «جات خالی بود».

---

## 8. Do and don't

Each pair shows a line that was translated from English and its native rewrite.

| # | Moment | Translated (don't) | Native (do) | Why |
|---|---|---|---|---|
| 1 | Session expired | «برای ادامهٔ گفتگو، مرا ببندید و دوباره باز کنید.» | «این صفحه را ببندید و دوباره باز کنید تا گفتگو ادامه پیدا کند.» | You close a page, not a person; system voice owns this line |
| 2 | Evening greeting | «شب بخیر سارا!» | «سلام سارا! ماه دراومده.» | «شب بخیر» is a farewell in Persian (and `goodbye.ts` treats it as one) |
| 3 | Welcome back | «خوش برگشتی!» | «به‌به، خوش اومدی!» | «خوش برگشتی» is a calque; «خوش اومدی» is what people say |
| 4 | Return gift | «مقداری پشم ابر برایت جمع کردم.» | «یه مشت پشمک ابری برات جمع کردم. قابلت رو نداره!» | پشمک (Yazdi cotton candy) *is* cloud fluff to an Iranian; «قابلت رو نداره» is the host's modesty |
| 5 | Decline | «الان نه» | «فعلاً نه» | "Not now" is «فعلاً نه» in every Iranian mouth |
| 6 | Over-poked | «هومف.» | «اِ، نکن!» | Persian has no "hmph"; «اِ» is the mock-offended gasp |
| 7 | Tickled a lot | «باشه، باشه!» | «تسلیم، تسلیم!» | Laughing surrender in Persian is «تسلیم» |
| 8 | Stroked gently | «آو.» | «آخیش…» | «آخیش» is the sigh of contentment |
| 9 | Full | «خیلی سیر…» | «سیرِ سیرم…» → written «سیر سیرم…» | Reduplication is how Persian says "completely" |
| 10 | Stop-playing cue | «حالا یه کم همین‌جوری شناور می‌مونم.» | «خیلی خوش گذشت! حالا یه کم لم می‌دم.» | Iranians «لم می‌دن» (lounge); "float" is an English image |
| 11 | Mic tip | «میکروفون رو نگه دار و باهام حرف بزن.» | «انگشتت رو روی میکروفون نگه دار و حرف بزن.» | «نگه دار» alone also means "stop!" |
| 12 | Age chip | «دههٔ ۳۰» | «سی‌وچندساله» | People say ages that way |
| 13 | Join | «پیوستن به یادداشت‌های گروه» / «مرا حساب نکن» | «منم هستم · ۱۸+» / «من نیستم» | The native pair for in/out is «منم هستم / من نیستم» |
| 14 | Saved by | «ذخیره‌شده توسط شما» | «خودتان ذخیره کرده‌اید» | «توسط» passives are the classic translation smell |
| 15 | Offline | «به ابر نمی‌رسم» (pet) on a system screen | «ارتباط با ابر قطع شد» | Keeps the cloud pun, stays in system voice |
| 16 | Talk chip | «از روزم بپرس» (a literal "ask about my day") | «از امروزم بگم؟» | The chip is sent as the person's own message. Nobody tells a friend "ask me about my day"; they offer to tell it |
| 17 | Absence DM | «یه پرش تازه تمرین کردم. هر وقت خواستی اینجاست.» | «یه پرش تازه یاد گرفتم. هر وقت دلت خواست، نشونت می‌دم.» | The hop is not "here"; the pet will *show* it, whenever you like |
| 18 | Pressure, Persian style | «زود برگرد!» | «برو به سلامت، خوش بگذره!» | A blessing releases; "come back soon" pulls |
| 19 | Seasonal lock | «نوروز برگرد» (from "Come back at Nowruz") | «با نوروز از راه می‌رسد» | The item arrives; the person is not told to return |
| 20 | Bureaucratic error | «صفحه مورد نظر در دسترس نمی‌باشد» | «این صفحه الان باز نمی‌شود.» | Alibaba's form is the anti-model |

---

## 9. Glossary

| English | Persian (pet / system) | Why |
|---|---|---|
| pet (the character) | «ابرک» | It is a cloud. «حیوان خانگی» is wrong and «پت» is Finglish. The ‑ک diminutive is affectionate |
| agent | «همکار» | «عامل» is bureaucratic and, in news Persian, a perpetrator |
| feed | pet: «غذا بده»; system label: «غذا دادن» | |
| cookie | «کلوچه» | A real Iranian sweet (کلوچهٔ فومن); warmer than «بیسکویت» or «کوکی» |
| play (ball) | «توپ‌بازی» | |
| put to bed / tuck in | pet: «می‌خوابونیم؟»; system: «خواباندن» | |
| nap | «چرت» | |
| sleepy | «خوابم گرفته», «چشمام سنگین شده» | Idioms, not «خواب‌آلود» |
| pet (stroke) / cuddle | «نوازش» | |
| tickle | «قلقلک» | |
| bond (hidden) | «انس» | «انس گرفتن» is the native word for growing close; engineers and the voice pack use it, the UI never shows it |
| days together (chip) | «روز اول آشنایی» / «{n} روز رفاقت» | «رفاقت» is warm and gender-neutral; «آشنایی» is how Iranians mark meeting |
| room: Home | «خانه» | System spelling; the pet says «خونه» |
| room: Play | «بازی» | |
| room: Garden | «باغچه» | A home garden plot, not a park |
| room: Closet | «کمد» | |
| room: Bedroom | «اتاق خواب» | Two words |
| room: Life Book | «دفتر خاطرات» | Every Iranian child kept one. Note «خاطره» (a moment remembered) is not «حافظه» (AI memory); never use «حافظه» for the book |
| mini-game | «بازی» | No need for "mini" |
| zen mode | «بی‌عجله» | Means "no rush", and is spelled the same in both voices, so the feature name never changes spelling |
| wardrobe / keepsake | «کمد» / «یادگاری» | |
| locked item ("how to earn") | «چطور به دستش بیاریم» (pet) / «راه به دست آوردن» (system) | Never a price |
| check-in | «سر زدن» | The exact Persian idiom for dropping in |
| Why this? | «چرا این پیام؟» (DM) / «چرا این را می‌بینم؟» (app) | |
| tip | no label; the pet just says it | |
| permission | «اجازه» | |
| share | «فرستادن برای دیگران»; button «فرستادن» | «به اشتراک گذاشتن» is long and translated |
| Mini App | avoid; say «این صفحه» | Users do not know the term |
| memory (AI) | «حافظه»; "remember this" = «یادت باشه» | |
| notes (Circles) | «یادداشت‌ها» | |
| Hafez fal | «فال حافظ»; first «نیت کن» | The ritual starts with making a wish |
| sabzeh, haft-sin | «سبزه», «هفت‌سین» | |
| Chaharshanbe Suri line | «زردی من از تو، سرخی تو از من» | Traditional |
| goodbye (pet) | «برو به سلامت», «شبت خوش» | Blessings |

---

## 10. Cultural flags on the English intent

1. **"Good evening" must not become «شب بخیر».** It is a goodbye. Evening greetings are «سلام» plus an evening observation.
2. **Talk chips are the person's words.** "Ask about my day" is sent as the person's message, so write what a person would actually say to open that topic: «از امروزم بگم؟».
3. **"Come back at Nowruz"** is an instruction to return. Persian: the item "arrives with Nowruz".
4. **Fal-e Hafez needs «نیت کن».** Opening a fal without the wish step feels like a gimmick to Iranians, which the key's own intent warns against. The reading stays playful, never a prophecy.
5. **Sizdah Bedar:** keep releasing the sabzeh into running water; never the knot-tying rhyme about marriage.
6. **Mourning days.** Iranian brands soften tone on official mourning days (Tasua, Ashura, other شهادت days). Around 2034-2035 Ashura falls near Nowruz, and Ramadan overlaps Nowruz in 2025-2027. Seasonal check-ins should check the official Iranian calendar and fall back to a quiet greeting without festive words or emoji when a festival coincides with a mourning day.
7. **Chaharshanbe Suri safety.** Real fireworks injure people every year. The pet only jumps in-app fires; no line should encourage real firecrackers.
8. **«قر» (dance wiggle)** is fun and common, but some conservative users read it as cheeky. I use «تکون» in the main line.
9. **"Hmph"/«قهر».** A mock sulk («قهر!» then «آشتی!») is very Iranian and very cute, but «قهر» touches the guilt rule; it is offered only as a reviewed variant.

---

## 11. Engineering notes

1. **Lint normalisation.** Before matching the Persian banned list, normalise: ي→ی, ك→ک, remove ZWNJ and diacritics, collapse spaces. Otherwise «دلم برات تنگ» and «دلم‌برات‌تنگ» slip through.
2. **Self-check script for every Persian string:** no U+064A/U+0643/U+0649/U+0629; no Latin or Arabic-Indic digits in pet strings; «?» and «,» banned in Persian; «می» or «نمی» followed directly by a letter (except the whitelisted «میام/میای/میاد/نمیاد») is a missing half-space; no tatweel; no «...».
3. **`goodbye.ts`** misses common written farewells. Proposed additions are in the copy file, section A.6.
4. **`circle-copy.ts` list joining:** Persian lists use «،» between items and «و» before the last: «سارا، علی و مینا».
5. **`spawn/copy.ts`:** `fields`, `edit`, `cancel`, `save` fall back to English in Persian.
6. **Bidi:** FSI/PDI around every placeholder in Persian strings; `dir="rtl"` on Persian bubbles; DMs never start with a placeholder.
7. **One spelling per term across Studio:** «جست‌وجو», «زنانه/مردانه/خنثی», «Vox» (Latin) in system copy.

---

## 12. Sources and limits

Opened and read (26 October 2026):

- Cafe Bazaar: [Pou](https://cafebazaar.ir/app/me.pou.app), [dog-care game](https://cafebazaar.ir/app/mc.dokhtarune.pet), [Bu the virtual Bunny](https://cafebazaar.ir/app/com.NeufOctobre.BuMyBunnyVirtualPet), [Bazaar](https://cafebazaar.ir/app/com.farsitel.bazaar), [Snapp](https://cafebazaar.ir/app/cab.snapp.passenger), [Tapsi](https://cafebazaar.ir/app/taxi.tap30.passenger), [Digikala](https://cafebazaar.ir/app/com.digikala), [Divar](https://cafebazaar.ir/app/ir.divar), [Balad](https://cafebazaar.ir/app/ir.balad), [Filimo](https://cafebazaar.ir/app/com.aparat.filimo), [Alibaba](https://cafebazaar.ir/app/ir.alibaba), [Snappfood](https://cafebazaar.ir/app/com.zoodfood.android), [Bazaar 404](https://cafebazaar.ir/xyz-not-here)
- Live sites: [divar.ir](https://divar.ir/), [Divar 404](https://divar.ir/xyz-not-here), [Alibaba 404](https://www.alibaba.ir/xyz-not-here), [Taaghche home](https://taaghche.com/) and [404](https://taaghche.com/xyz-not-here), snappfood.ir and tapsi.ir (geo-block page only)
- Push notification screenshots (Snapp, Tapsi, Blu Bank) in [Metrix: پوش نوتیفیکیشن چیست؟](https://metrix.ir/push-notifications-what-to-know/), images read directly
- [Digikala Mag yearly report](https://www.digikala.com/mag/from-0-to-100-with-digikala-1401-report/)
- [Melipayamak SMS samples](https://www.melipayamak.com/blog/posts/how-to-write-effective-advertising-messages/) (vendor samples, not verified sends)
- [Tabibzadeh, نامه فرهنگستان 1404](https://nf.apll.ir/article_236140.html) (abstract only); [Vinesh review of his book](https://vinesh.ir/%D9%82%D8%A7%D8%B9%D8%AF%D9%87%E2%80%8C%D9%85%D9%86%D8%AF-%DA%A9%D8%B1%D8%AF%D9%86-%D8%B4%DA%A9%D8%B3%D8%AA%D9%87%E2%80%8C%D9%86%D9%88%DB%8C%D8%B3%DB%8C/); [Persian Wikipedia: شکسته‌نویسی](https://fa.wikipedia.org/wiki/%D8%B4%DA%A9%D8%B3%D8%AA%D9%87%E2%80%8C%D9%86%D9%88%DB%8C%D8%B3%DB%8C); [reader's notes on اصول شکسته‌نویسی](https://www.goodreads.com/user_status/show/324932245)
- [Microsoft Persian style guide](https://download.microsoft.com/download/3/e/c/3ec58a9a-70ff-4a31-8cfd-d185983111be/fas-irn-StyleGuide.pdf) (extracted with pypdf)
- [وایب‌متن](https://vibematn.github.io/); [OneCenter on UX writing with Iranian examples](https://onecenter.ir/ux-writing-%DA%86%DB%8C%D8%B3%D8%AA%D8%9F-%DB%8C%D9%88-%D8%A7%DB%8C%DA%A9%D8%B3-%D8%B1%D8%A7%DB%8C%D8%AA%D8%B1-%DA%A9%DB%8C%D8%B3%D8%AA%D8%9F-%D9%86%D9%85%D9%88%D9%86%D9%87%D9%87%D8%A7/) (its Iranian examples are images without text; I used only its general tone advice); [Taarof](https://en.wikipedia.org/wiki/Taarof)

Could not open or verify:

- Tabibzadeh's full rule appendices (book not online; article PDF not read). My orthography follows his principles as reviewed, plus common practice; a native editor should check section 4.1 against *فارسی شکسته: دستور خط و فرهنگ املایی*.
- The Academy's *دستور خط فارسی* full text (only secondary summaries).
- Bale, Eitaa, Rubika; in-app Digikala, Snappfood, Filimo and Snapp UI beyond pushes and store pages; Telegram's own Persian localization terms (for example whether it says «هم‌رسانی» or «اشتراک‌گذاری»).
- A Persian-made pet game with substantial Persian in-game text. Bazaar's pet titles I found are foreign games with Persian store copy, plus one small Iranian dress-up game.
- No HOOR user testing. The تو decision should be checked with pilot users of different ages.
