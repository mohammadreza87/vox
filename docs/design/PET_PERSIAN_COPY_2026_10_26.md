# Vox pet: Persian copy

Date: 26 October 2026. Branch `design/pet-pou-flow`. Written natively against the voice rules in [`PET_PERSIAN_VOICE_2026_10_26.md`](./PET_PERSIAN_VOICE_2026_10_26.md). Keys follow [`PET_COPY_KEYS_2026_10_26.md`](./PET_COPY_KEYS_2026_10_26.md); I did not edit that file. Every key there has Persian in section B. Where I think the English intent is wrong for a Persian reader, the **Note** column says so and proposes the change.

Conventions in this file:

- **Voice:** `pet` (تو, spoken), `system` (شما, standard written), `person` (the human's own words). See the voice guide, section 3.
- **Placeholders** stay exactly as in the keys: `{name}` (agent), `{first}` (person), `{group}`, `{n}`, `{item}`, `{category}`. In code, wrap each in U+2068 … U+2069 inside Persian strings. Never attach a suffix to a placeholder.
- **Variants** (v2, v3) are for lines the pet would otherwise repeat. Pick at random, never the same one twice in a row.
- `·` is the existing compact separator. `…` is one character.

---

## A. Rewrites of the Persian already in the code

### A.1 `src/app/studio/pet/_ui/copy.ts`

| Key | English | Current Persian | Rewrite | Voice | Why |
|---|---|---|---|---|---|
| `reopenFa` (`talk.reopen`) | Close and reopen me to keep talking. | «برای ادامهٔ گفتگو، مرا ببندید و دوباره باز کنید.» | «این صفحه را ببندید و دوباره باز کنید تا گفتگو ادامه پیدا کند.» | system | You close a page, not a person; «مرا» was formal pet voice, a register clash |

All other `copy.ts` lines are English-only today; their Persian is in section B under the matching keys.

### A.2 `src/app/studio/pet/_ui/circle-copy.ts` (system voice)

The three choice labels must stay identical to the group card's buttons, which live in `src/lib/circles/notice.ts:42-43` and are echoed in `src/app/studio/my-data/_ui/copy.ts:55`. Change all three files in one commit, because the card's `copyHash` covers its text.

| Key | English | Current Persian | Rewrite | Why |
|---|---|---|---|---|
| `here(n, null)` | {n} here | «{n} نفر اینجا» | «{n} نفر اینجا هستند» | A full phrase reads as a status, not a fragment |
| `here(n, m)` | {n} of {m} here | «{n} از {m} اینجا» | «{n} نفر از {m} نفر اینجا هستند» | |
| `join` | Join group notes | «پیوستن به یادداشت‌های گروه» | «عضویت در یادداشت‌های گروه» | «پیوستن» is bookish |
| `notes` | Group notes | «یادداشت‌های گروه» | «یادداشت‌های گروه» (keep) | Already right |
| `notNow` | Not now | «الان نه» | «فعلاً نه» | The native "not now" |
| `with(names)` | Here with … | «اینجا با …» | «همراه با …» | |
| `chose.joined` | You joined | «پیوستید» | «انتخاب شما: منم هستم» | Echo the proposed card button (below) |
| `chose.reply_only` | You chose: Only reply to me | «انتخاب شما: فقط به من جواب بده» | «انتخاب شما: فقط جوابم را بده» | |
| `chose.declined` | You chose: Not me | «انتخاب شما: مرا حساب نکن» | «انتخاب شما: من نیستم» | «مرا حساب نکن» is a calque with formal «مرا» inside a تو imperative |
| `myNotes` | My notes | «یادداشت‌های من» | keep | |
| `fromGroup` | From this group | «از این گروه» | keep | |
| `empty` | Nothing saved yet. Ask me to remember something. | «هنوز چیزی ذخیره نشده. از من بخواهید چیزی را به خاطر بسپارم.» | «هنوز چیزی ذخیره نشده. هر وقت بگویید «یادت باشه…»، اینجا می‌نویسمش.» | Shows the exact phrase that works; «به خاطر بسپارم» is stiff |
| `from(group)` | from {group} | «از {group}» | keep | |
| `byYou` | saved by you | «ذخیره‌شده توسط شما» | «خودتان ذخیره کرده‌اید» | «توسط» passive |
| `erase` | Erase | «پاک کردن» | keep | |
| `eraseAsk` | Erase your copy of this note? Everyone else keeps theirs. | «نسخه خودتان از این یادداشت پاک شود؟ بقیه نسخه خودشان را نگه می‌دارند.» | «نسخهٔ خودتان از این یادداشت پاک شود؟ نسخهٔ بقیه سر جایش می‌ماند.» | Missing «ـهٔ»; shorter |
| `leave` | Leave group notes | «خروج از یادداشت‌های گروه» | keep | |
| `leaveAsk(group)` | Leave {group}'s notes? Notes saved while you were here stay with everyone who was here. | «از یادداشت‌های {group} خارج می‌شوید؟ یادداشت‌هایی که وقتی اینجا بودید ذخیره شدند، پیش همه کسانی که آن موقع اینجا بودند می‌مانند.» | «از یادداشت‌های {group} بیرون می‌روید؟ یادداشت‌هایی که تا امروز ذخیره شده، پیش همهٔ کسانی که آن موقع عضو بودند می‌ماند.» | Two «اینجا بودید/بودند» clauses read as a translation |
| `left` | You're out of this group's notes. | «دیگر در یادداشت‌های این گروه نیستید.» | keep | Already natural |
| `stale` | The card just changed. Here is the newest one. | «کارت همین الان عوض شد. این تازه‌ترین آن است.» | «کارت همین الان به‌روز شد؛ این نسخهٔ تازه است.» | «این تازه‌ترین آن است» is English word order |
| `full` | This group already has 12 people in its notes. | «یادداشت‌های این گروه همین حالا ۱۲ نفر دارد.» | «ظرفیت یادداشت‌های این گروه پر است (۱۲ نفر).» | Notes do not "have" people |
| `notMember` | This link is for a group you're not in. | «این پیوند برای گروهی است که شما در آن نیستید.» | «این پیوند مال گروهی است که عضوش نیستید.» | |
| `failed` | That didn't work. Try again? | «نشد. دوباره امتحان کنید؟» | «نشد. یک بار دیگر امتحان کنید.» | "Try again?" as a question is a calque |
| `seeNotes` | See my notes | «دیدن یادداشت‌های من» | keep | |
| `retry` | Group notes · tap to retry | «یادداشت‌های گروه · برای تلاش دوباره بزنید» | «یادداشت‌های گروه · بزنید تا دوباره امتحان شود» | |
| `copiesIn(name)` | 📌 Get your copies in {name}'s chat | «📌 نسخه‌هایتان را در گفتگو با {name} بگیرید» | «📌 نسخه‌های خودتان در گفتگو با {name} است» | It is where they are, not an order |
| `useVox` | Your notes open in Vox now: tap ⋯, then Settings. | «یادداشت‌هایتان حالا در وکس باز می‌شوند: ⋯ و بعد «تنظیمات» را بزنید.» | «یادداشت‌هایتان حالا در Vox باز می‌شود: ⋯ را بزنید، بعد «تنظیمات».» | Brand spelled one way (Vox) |
| `reopen` | Close and reopen me to choose here. | «برای انتخاب اینجا، مرا ببندید و دوباره باز کنید.» | «برای انتخاب، این صفحه را ببندید و دوباره باز کنید.» | Same "close me" problem |

**Proposed group-card buttons** (`notice.ts:42-43`, with the matching `card` body words): Join «منم هستم · ۱۸+», Only reply to me «فقط جوابم را بده», Not me «من نیستم». «منم هستم / من نیستم» is how Iranians opt in and out of anything. The card body should then say «منم هستم» where it now says «می‌پیوندم».

**Engineering fix:** `list(names, 'fa')` should join with «، » and put «و» only before the last name: «سارا، علی و مینا».

### A.3 `src/app/studio/_lib/spawn-copy.ts` (Studio wizard, system voice)

| Key | Current Persian | Rewrite |
|---|---|---|
| `discardBriefTitle` | «این شرح کنار گذاشته شود؟» | «توضیحاتتان پاک شود؟» |
| `discard` | «کنار گذاشتن» | «پاک کردن» |
| `discardBriefBody` | «آنچه اینجا نوشتید نگه داشته نمی‌شود.» | «چیزی که نوشته‌اید نگه داشته نمی‌شود.» |
| `discardDraft` | «حذف پیش‌نویس» | keep |
| `discardTitle(name)` | «{name} حذف شود؟» | keep |
| `discardBody(name)` | «شخصیت، ظاهر و صدای {name} حذف می‌شود. این کار برگشت‌پذیر نیست.» | «شخصیت، ظاهر و صدای {name} پاک می‌شود و دیگر برنمی‌گردد.» |
| `slow` | «کمی بیشتر از معمول طول می‌کشد · تقریباً تمام است» | «کمی بیشتر طول کشید · چیزی نمانده» |
| `brief.successorTitle` | «چه کسی جایگزین می‌شود؟» | «چه کسی جایش را می‌گیرد؟» |
| `brief.title` | «به چه کسی نیاز دارید؟» | «به چه همکاری نیاز دارید؟» |
| `brief.successorSub` | «Claude کسی تازه را پیش‌نویس می‌کند. حافظه‌های عامل بازنشسته نزد تیم می‌ماند.» | «Claude یک همکار تازه پیشنهاد می‌دهد. آنچه همکار قبلی به خاطر سپرده بود، برای تیم می‌ماند.» |
| `brief.sub` | «همه‌چیز اختیاری است. Claude جاهای خالی را پر می‌کند.» | «همه‌چیز اختیاری است؛ جاهای خالی را Claude پر می‌کند.» |
| `brief.role` | «نقش، به زبان خودتان» | keep |
| `brief.rolePlaceholder` | «یک مدیر محصول آرام که پرسش‌های دقیق می‌پرسد و هر تصمیمی را به خاطر می‌سپارد» | «مدیر محصولی آرام که سؤال‌های دقیق می‌پرسد و هیچ تصمیمی یادش نمی‌رود» |
| `brief.presentsAs` | «جنسیت ظاهری» | «جنسیت» |
| `brief.presentations` | «زنانه»، «مردانه»، «خنثی» | keep (and use the same in `spawn/copy.ts`) |
| `brief.age` | «سن» | keep |
| `brief.ages` | «دههٔ ۲۰»، «دههٔ ۳۰»، «دههٔ ۴۰»، «۵۰ به بالا» | «بیست‌وچندساله»، «سی‌وچندساله»، «چهل‌وچندساله»، «پنجاه به بالا» |
| `brief.culture` | «ملیت و فرهنگ» | keep |
| `brief.culturePlaceholder` | «ایرانی، درس‌خوانده در برلین» | «ایرانی، درس‌خواندهٔ برلین» |
| `brief.languages` / `languageNames` | «زبان‌ها»، «انگلیسی»… | keep |
| `brief.domain` | «حوزه» | «حوزهٔ کار» |
| `brief.domains` | «محصول»… «منابع انسانی»… | keep all |
| `brief.accent` | «لهجه» | keep |
| `brief.accentHint` | «ElevenLabs صدایی متناسب طراحی می‌کند؛ لهجه‌های واقعی بهترین نتیجه را می‌دهند.» | «ElevenLabs صدایی متناسب با آن می‌سازد؛ لهجه‌های واقعی نتیجهٔ بهتری می‌دهند.» |
| `brief.accentPlaceholder` | «انگلیسی با لهجهٔ نرم تهرانی» | «انگلیسی با لهجهٔ ملایم تهرانی» |
| `brief.personality` | «شخصیت» | keep |
| `brief.warm/direct/playful/serious` | «گرم»، «رک»، «شوخ»، «جدی» | «گرم»، «رک»، «شوخ‌طبع»، «جدی» |
| `brief.concise/expansive` | «موجز»، «مفصل» | «خلاصه‌گو»، «مفصل‌گو» |
| `brief.range` | «{left} تا {right}» | «از {left} تا {right}» |
| `brief.surprise` | «غافلگیرم کن» | keep (person voice, perfect) |
| `brief.draft` | «پیش‌نویس با Claude» | «بسپار به Claude» |
| `drafting.labels` | «خواندن شرح شما…»، «یافتن یک نام…»، «نوشتن پیشینه…»، «انتخاب ارزش‌ها…»، «تصور ظاهرش…» | «خواندن توضیحات شما…»، «پیدا کردن یک اسم…»، «نوشتن سرگذشتش…»، «انتخاب ارزش‌ها…»، «تصور چهره‌اش…» |
| `drafting.newAgent` | «عامل تازهٔ شما» | «همکار تازهٔ شما» |
| `drafting.drafting` | «در حال پیش‌نویس» | «در حال نوشتن» |
| `drafting.title` | «Claude در حال تصور اوست…» | «Claude دارد او را می‌سازد…» |
| `drafting.body` | «نام، پیشینه، ارزش‌ها، زبان‌ها و ابری از آنِ خودش. نمایه‌های مفصل ممکن است کمی بیشتر طول بکشند.» | «اسم، سرگذشت، ارزش‌ها، زبان‌ها و یک ابر از آنِ خودش. نمایهٔ مفصل کمی بیشتر طول می‌کشد.» |
| `drafting.ready` / `stop` | «پیش‌نویس آماده است» / «توقف» | keep |
| `persona.sections` | role «نقش», tagline «در یک جمله», backstory «پیشینه», personality «شخصیت», communicationStyle «شیوهٔ حرف زدن», values «ارزش‌ها», wontDo «کارهایی که نمی‌کند», expertise «تخصص‌ها», opinions «دیدگاه‌ها», signatureMoves «عادت‌های شاخص», petPeeves «چیزهایی که کلافه‌اش می‌کند» | backstory «سرگذشت» (frees «پیشینه» for the Brief's "Background"), signatureMoves «عادت‌های خاص»; keep the rest |
| `persona.saveNext` / `nextLook` | «ذخیره و بعدی» / «بعدی · ظاهر» | keep |
| `persona.useName(name)` | «تأیید {name} · انتخاب صدا» | «همین {name} · انتخاب صدا» |
| `persona.suggests` | «پیشنهاد Claude · یک نام انتخاب کنید» | «پیشنهادهای Claude · یک اسم انتخاب کنید» |
| `persona.persona(name)` | «شخصیت {name}» | keep |
| `persona.name` / `editName` | «نام» / «ویرایش نام» | keep |
| `persona.updated(n)` | «Claude {n} خط را به‌روز کرد» | «Claude {n} خط را تغییر داد» |
| `persona.undo` | «بازگردانی» | «برگرداندن» (same word as the Brief) |
| `persona.tapToEdit` | «روی هر بخش بزنید تا خودتان ویرایشش کنید» | keep |
| `persona.readOnly(name)` | «{name} برای شما فقط‌خواندنی است» | «{name} برای شما فقط خواندنی است» |
| `persona.tryChat` | «یک گفتگو امتحان کنید» | «یک گفتگوی آزمایشی» |
| `persona.askPlaceholder(name)` | «از Claude بخواهید: {name} را شوخ‌تر کن…» | «از Claude بخواهید: {name} را شوخ‌طبع‌تر کن…» |
| `persona.askLabel` / `sendToClaude` | «درخواست تغییر از Claude» / «ارسال به Claude» | keep / «فرستادن برای Claude» |
| `persona.onePerLine` / `cancel` / `save` | « · هر مورد در یک خط» / «انصراف» / «ذخیره» | keep |
| `voice.title(name)` | «صدای {name}» | keep |
| `voice.off(name)` | «صداها هنوز برای این فضای کاری روشن نشده‌اند. {name} با متن پاسخ می‌دهد؛ همچنان می‌توانید در تلگرام صحبت کنید.» | «صدا هنوز برای این فضای کاری روشن نشده. {name} با متن جواب می‌دهد؛ در تلگرام هم می‌توانید با او حرف بزنید.» |
| `voice.same(org)` | «صدای یکسان برای همهٔ اعضای {org}. پس از استخدام ثابت می‌شود.» | «همهٔ اعضای {org} همین صدا را می‌شنوند. بعد از استخدام دیگر عوض نمی‌شود.» |
| `voice.details` / `shortcuts` | «جزئیات صدا» / «میان‌برهای زبان» | keep / «میان‌بر زبان‌ها» |
| `voice.hearSample(language)` | «شنیدن نمونه به {language}» | keep |
| `voice.sample`, `source`, `builtIn`, `design`, `library` | «نمونه»، «منبع صدا»، «آماده»، «طراحی»، «کتابخانه» | keep |
| `voice.retryOptions` | «تلاش دوباره برای گزینه‌های صدا» | keep |
| `voice.optionsError(reason)` | «گزینه‌های صدا بارگذاری نشد: {reason}» | «گزینه‌های صدا بار نشد: {reason}» |
| `voice.builtInVoices` / `loadingVoices` | «صداهای آماده» / «در حال بارگذاری صداها» | keep / «در حال آوردن صداها» |
| `voice.noBuiltIn` | «اکنون صدای آماده‌ای در دسترس نیست.» | «فعلاً صدای آماده‌ای در دسترس نیست.» |
| `voice.everyLanguage` | «به همهٔ زبان‌های پشتیبانی‌شده صحبت می‌کند» | «به همهٔ زبان‌های پشتیبانی‌شده حرف می‌زند» |
| `voice.play` / `choose` | «پخش {name}» / «انتخاب {name}» | keep |
| `voice.designVoice`, `briefOver`, `describe`, `briefPlaceholder` | «طراحی صدا»، «شرح صدا از Claude · قابل ویرایش»، «صدا را توصیف کنید»، «لهجه، سن، سرعت، گرمی» | keep |
| `voice.designing` | «خواندن شرح صدا…»، «طراحی سه نسخه…»، «ساخت پیش‌نمایش‌ها…»، «تقریباً تمام است…» | «خواندن شرح صدا…»، «ساختن سه نسخه…»، «آماده کردن نمونه‌ها…»، «چیزی نمانده…» |
| `voice.designThree` / `designMore` | «طراحی ۳ صدا» / «۳ صدای دیگر» | «ساختن سه صدا» / «سه صدای دیگر» |
| `voice.take`, `playTake`, `chooseTake` | «نسخهٔ {letter}»… | keep |
| `voice.voiceLibrary`, `gender` | «کتابخانهٔ صدا»، «جنسیت» | keep |
| `voice.genders` | «زن»، «مرد»، «خنثی» | «زنانه»، «مردانه»، «خنثی» |
| `voice.voiceLanguage` / `anyLanguage` | «زبان صدا» / «هر زبانی» | keep / «همهٔ زبان‌ها» |
| `voice.accent`, `accentPlaceholder`, `searchPlaceholder` | «لهجه»، «هر لهجه‌ای · بریتانیایی، تهرانی…»، «آرام، راوی، لهجهٔ فارسی…» | keep |
| `voice.searchVoices` / `search` / `searching` | «جستجوی صداها» / «جستجو» / «در حال جستجوی صداها» | «جست‌وجوی صدا» / «جست‌وجو» / «در حال جست‌وجوی صدا» (one spelling everywhere) |
| `voice.libraryPlan` | «در طرح فعلی این فضای کاری هنوز نمی‌توان صدای کتابخانه را انتخاب کرد. آزادانه گوش دهید؛ صداهای آماده و طراحی‌شده کار می‌کنند.» | «با طرح فعلی این فضای کاری هنوز نمی‌شود صدای کتابخانه را انتخاب کرد. گوش دادن آزاد است؛ صداهای آماده و طراحی‌شده کار می‌کنند.» |
| `voice.why` | «چرا؟» | keep |
| `voice.noMatch` | «صدایی پیدا نشد. یکی از فیلترها را بردارید.» | keep |
| `voice.generated` | «صدای ساخته‌شده» | «صدای ساخت هوش مصنوعی» |
| `voice.nativeLanguage` / `language` | «زبان مادری: » / «زبان: » | keep |
| `voice.costs(rate)` | «هزینه: {n}× برای هر پیام» | «هزینه: {n} برابر برای هر پیام» |
| `voice.use` / `skip` | «استفاده از این صدا» / «رد شدن · فقط متن» | «همین صدا» / «بدون صدا · فقط متن» |
| `voice.usesModel(model)` | «پیام‌های صوتی از {model} استفاده می‌کنند» | «پیام‌های صوتی با {model} ساخته می‌شوند» |
| `voice.speechModels` | «مدل‌های گفتار» | keep |
| `voice.realtime` / `quality` / `earlier` | «هم‌زمان» / «کیفیت بالا» / «مدل قدیمی‌تر» | «بی‌درنگ» / keep / keep |
| `voice.supported(language)` | «پشتیبانی از {language}» | «{language} پشتیبانی می‌شود» |
| `voice.inUse` | «در حال استفاده» | keep |
| `voice.speaks(model, language)` | «{model} به {language} صحبت می‌کند. یک صدا می‌تواند به همهٔ زبان‌های پشتیبانی‌شده صحبت کند؛ لهجه و تلفظ متفاوت است.» | «{model} به {language} حرف می‌زند. یک صدا می‌تواند به همهٔ زبان‌های پشتیبانی‌شده حرف بزند؛ لهجه و تلفظ فرق می‌کند.» |
| `voice.freePlan` | «این فضای کاری از طرح رایگان ElevenLabs استفاده می‌کند. صداهای کتابخانه برای استفاده از API طرح پولی لازم دارند؛ صداهای آماده کار می‌کنند و صدای کتابخانه‌ای که قبلاً انتخاب شده می‌ماند.» | «این فضای کاری طرح رایگان ElevenLabs را دارد. صداهای کتابخانه برای استفاده از API طرح پولی می‌خواهند؛ صداهای آماده کار می‌کنند و صدای کتابخانه‌ای که قبلاً انتخاب شده سر جایش می‌ماند.» |
| `voice.unchecked` | «اشتراک ElevenLabs بررسی نشد؛ تا وقتی بررسی نشود، صداهای کتابخانه قابل انتخاب نیستند.» | «اشتراک ElevenLabs بررسی نشد؛ تا بررسی نشود، نمی‌شود صدای کتابخانه را انتخاب کرد.» |
| `look.look(name)` / `character` / `photo` | «ظاهر {name}» / «کاراکتر» / «عکس» | keep |
| `look.shape(name)` | «کاراکتر {name} را شکل دهید» | «ظاهر {name} را بسازید» |
| `look.done` / `next(name)` | «تمام» / «بعدی · استخدام {name}» | keep |
| `hire.confirm` / `hire(name)` | «تأیید در تلگرام» / «استخدام {name}» | keep |
| `hire.awaiting(name)` | «تلگرام صفحهٔ «ساخت ربات» را باز کرد. نام هر جا ممکن باشد از پیش پر شده است؛ اگر خالی است، {name} را وارد کنید. نام کاربری را تأیید کنید و Create را بزنید. سپس وکس نام و عکس انتخاب‌شده را اعمال می‌کند — این صفحه وقتی آماده شوند به‌روز می‌شود.» | «تلگرام صفحهٔ «ساخت ربات» را باز کرد. اگر جای نام خالی بود، {name} را بنویسید. نام کاربری را تأیید کنید و Create را بزنید. بعد Vox نام و عکس را روی ربات می‌گذارد و این صفحه خودش به‌روز می‌شود.» (no em dash) |
| `hire.body(name, org)` | «{name} یک ربات واقعی تلگرام می‌شود. ابتدا خصوصی است (شما، افرادی که انتخاب می‌کنید و مدیران)؛ بعداً می‌توانید آن را برای {org} باز یا عمومی کنید.» | «{name} یک ربات واقعی تلگرام می‌شود. اول خصوصی است (شما، کسانی که انتخاب می‌کنید و مدیرها)؛ بعداً می‌توانید آن را برای {org} باز یا عمومی کنید.» |
| `hire.statusError(reason)` | «وضعیت ربات بررسی نشد: {reason}» | keep |
| `hire.waiting` | «در انتظار تلگرام…»، «در تلگرام Create را بزنید و برگردید» | «منتظر تلگرام…»، «در تلگرام Create را بزنید و به همین صفحه برگردید» |
| `hire.hiring` | «آنچه استخدام می‌کنید» | «چه کسی را استخدام می‌کنید» |
| `hire.lookPhoto`, `portrait`, `character`, `voice`, `textOnly` | «ظاهر و عکس»، «پرتره»، «کاراکتر»، «صدا»، «فقط متن» | portrait «چهره»; keep the rest |
| `hire.locks` / `locksValue` | «قفل شدن شخصیت» / «۷ روز پس از استخدام» | «ثابت شدن شخصیت» / «هفت روز بعد از استخدام» |
| `hire.preview` | «نمای آن در تلگرام» | «در تلگرام این‌طور دیده می‌شود» |
| `hire.botSub` | «ربات · نام کاربری در تلگرام انتخاب می‌شود» | «ربات · نام کاربری را در تلگرام انتخاب می‌کنید» |
| `hire.tryChat` / `openAgain` | «اول یک گفتگو امتحان کنید» / «باز کردن دوبارهٔ تلگرام» | «اول یک گفتگوی آزمایشی» / keep |
| `hire.hired(name)` / `created(name)` | «{name} استخدام شد» / «ربات {name} ساخته شد» | keep |
| `hire.newborn(name)` | «{name} نوزاد شروع می‌کند و در ۷ روز رشد می‌کند. » | «{name} از نوزادی شروع می‌کند و در هفت روز بزرگ می‌شود. » |
| `hire.live(username)` | «با نام ‎@{username} فعال است. تا ۷ روز آینده هنوز می‌توان شخصیت را تنظیم کرد؛ پس از آن برای همیشه قفل می‌شود.» | «با نام ‎@{username} فعال است. تا هفت روز آینده هنوز می‌شود شخصیتش را تنظیم کرد؛ بعد از آن برای همیشه ثابت می‌ماند.» (keep the U+200E before @) |
| `hire.profile`, `bot`, `message`, `open` | «نمایهٔ تلگرام»، «ربات تلگرام»، «پیام»، «باز کردن» | keep |
| `sayHi.title(name)` / `placeholder(name)` | «به {name} سلام کنید» / «پیام به {name}» | keep |
| `sayHi.message` / `send` | «پیام» / «ارسال» | keep / «فرستادن» |
| `sayHi.sandbox` | «محیط آزمایشی: هیچ‌چیز اینجا به حافظه تبدیل نمی‌شود.» | «اینجا فقط تمرین است؛ چیزی در حافظه نمی‌ماند.» |
| `sayHi.chatWith(name)` | «گفتگو با {name}» | keep |
| `sayHi.starters` (person voice) | «خودت را معرفی کن»، «چه کاری را هرگز انجام نمی‌دهی؟»، «با اختلاف نظر چطور کنار می‌آیی؟» | «خودت رو معرفی کن»، «چه کاری رو هیچ‌وقت نمی‌کنی؟»، «وقتی با کسی هم‌نظر نیستی، چی کار می‌کنی؟» (people type to a bot in spoken Persian) |
| `sayHi.notSent` | «ارسال نشد · تلاش دوباره» | «فرستاده نشد · دوباره» |
| `sayHi.typing(name)` | «{name} در حال نوشتن است» | «{name} دارد می‌نویسد…» |

### A.4 `src/app/studio/_components/screens/spawn/copy.ts` (Brief, system voice)

**Bug:** the Persian object spreads `...en` and never overrides `fields`, `edit`, `cancel` or `save`, so the Persian Brief shows "Name", "Edit", "Cancel", "Save" in English. Persian for them is at the end of this table.

| Key | Current Persian | Rewrite |
|---|---|---|
| `overline` | «ساخت همکار جدید» | «ساخت همکار تازه» |
| `overlineSuccessor(name)` / `overlineSuccessorPending` | «جانشین {name}» / «استخدام جانشین» | keep |
| `title` | «به چه کسی نیاز دارید؟» | «به چه همکاری نیاز دارید؟» |
| `titleSuccessor(name)` | «چه کسی جای {name} را می‌گیرد؟» | keep |
| `sub` | «در یک جمله و به هر زبانی توصیفش کنید. بقیه را Claude کامل می‌کند.» | «در یک جمله و به هر زبانی که راحتید بگویید؛ بقیه‌اش با Claude.» |
| `composerLabel` | «توصیف همکاری که لازم دارید» | keep |
| `example(text)` | «برای نمونه: {text}» | «مثلاً: {text}» |
| `examples` | «مربی دویدنی که نگذارد از برنامه عقب بمانم»، «کسی که جذب کاربر عرضهٔ بازی پازل ما در ترکیه را پیش ببرد»، «مدیر محصولی آرام که همهٔ تصمیم‌ها یادش بماند»، «معلمی که به دخترم ریاضی را به فارسی یاد بدهد» | «مربی دویدنی که نگذارد تنبلی کنم»، «کسی که جذب کاربر برای عرضهٔ بازی پازلمان در ترکیه را پیش ببرد»، «مدیر محصولی آرام که هیچ تصمیمی یادش نرود»، «معلمی که به دخترم ریاضی را به فارسی یاد بدهد» |
| `successorPlaceholder(name)` | «چه چیزی با {name} فرق کند؟» | «چه چیزی با {name} فرق داشته باشد؟» |
| `pickedPlaceholder` | «نکتهٔ خاصی هست؟ مثلاً گزارش هفتگی برای عرضه در ترکیه» | keep |
| `packRow` | «یا از یک نقش شروع کنید» | «یا از یک نقش آماده شروع کنید» |
| `packShort` / `packFull` | «زندگی»… / «سبک زندگی»… | keep |
| `browse` | «مرور نقش‌ها» | «دیدن نقش‌ها» |
| `cardRouted`, `cardPicked`, `cardSuccessor` | «نقش پیشنهادی · {pack}»، «شروع از · {pack}»، «همان نقش {name}» | keep |
| `skills`, `skillsCount(n)`, `moreSkills(n)`, `addSkill`, `addSkillsLabel`, `change` | «مهارت‌ها»… | keep |
| `detach` / `keepingCustom` | «سفارشی بماند» / «سفارشی می‌ماند.» | keep / «سفارشی ماند.» |
| `undo` | «بازگرداندن» | «برگرداندن» |
| `custom` / `announce` | «همکار سفارشی» / «نقش پیشنهادی: {role}، {pack}» | keep |
| `clarifyOver` / `clarifyFallback` | «یک سؤال کوتاه» / «کدام نزدیک‌تر است؟» | keep |
| `skip` | «رد شو و همین را پیش‌نویس کن» | «رد شدن · همین را بنویس» |
| `fineTune` / `fineTuneDefault` | «تنظیم جزئیات» / «به انتخاب Claude» | keep |
| `presentsAs` | «جنسیت» | keep |
| `presentations` | «زن»، «مرد»، «خنثی» | «زنانه»، «مردانه»، «خنثی» (same as the wizard) |
| `languages` / `languageNames` | «زبان‌ها»… | keep |
| `fromBrief` | «(از توصیف شما)» | «(از توضیح شما)» |
| `background` | «پیشینه» | keep (backstory is now «سرگذشت») |
| `culture` / `culturePh` | «ملیت / فرهنگ» / «ایرانی، تهران» | «ملیت و فرهنگ» / keep |
| `age` / `agePh` | «سن» / «اوایل دههٔ ۳۰» | keep / «سی‌وچندساله» |
| `accent` / `accentPh` / `accentHint` | «لهجه» / «انگلیسی با لهجهٔ ملایم تهرانی» / «ElevenLabs صدایی متناسب با آن طراحی می‌کند؛ لهجه‌های واقعی بهتر جواب می‌دهند.» | keep / keep / «ElevenLabs صدایی متناسب با آن می‌سازد؛ لهجه‌های واقعی نتیجهٔ بهتری می‌دهند.» |
| `temperament` | «خلق‌وخو» | keep |
| `sliders` | «گرم/رک»، «شوخ/جدی»، «کوتاه/مفصل» | «گرم/رک»، «شوخ‌طبع/جدی»، «خلاصه‌گو/مفصل‌گو» |
| `range` | «{left} تا {right}» | «از {left} تا {right}» |
| `ctaEmpty` / `cta` / `ctaSuccessor` | «غافلگیرم کن» / «پیش‌نویس با Claude» / «پیش‌نویس جانشین» | keep / «بسپار به Claude» / keep |
| `ctaOffline` | «آفلاین هستید» | «اینترنت وصل نیست» |
| `offline` | «آفلاین هستید. هنوز می‌توانید نقش‌ها را مرور کنید؛ پیش‌نویس به اینترنت نیاز دارد.» | «اینترنت وصل نیست. نقش‌ها را می‌توانید ببینید، ولی نوشتن پیش‌نویس اینترنت می‌خواهد.» |
| `offlineNoRoles` | «آفلاین هستید. پیش‌نویس به اینترنت نیاز دارد؛ متن شما همین‌جا می‌ماند.» | «اینترنت وصل نیست. نوشتن پیش‌نویس اینترنت می‌خواهد؛ متنتان همین‌جا می‌ماند.» |
| `errorSuffix` | «متن شما محفوظ است.» | «متنتان سر جایش است.» |
| `retry` | «دوباره امتحان کنید» | «تلاش دوباره» |
| `draftingRole(role)` / `draftingCustom` | «در حال ساختن {role} شما…» / «Claude دارد تصورش می‌کند…» | keep / «Claude دارد او را می‌سازد…» |
| `beats` | «انتخاب نام»، «نوشتن لحن گفتار»، «انتخاب مهارت‌ها»، «شکل دادن ابرش» | «انتخاب اسم»، «نوشتن لحن حرف زدن»، «انتخاب مهارت‌ها»، «شکل دادن ابرش» |
| `roles`, `closest`, `skillsSheet` | «نقش‌ها»، «نزدیک‌ترین به توصیف شما»، «مهارت‌ها» | closest «نزدیک‌ترین به توضیح شما» |
| `on` | «فعال» | «روشن» |
| `suggestedFor`, `moreSkillsSection`, `allSkills` | keep | keep |
| `topPicks` | «نقطه‌های شروع خوب» | «برای شروع خوب‌اند» |
| `searchSkills`, `noSkillMatch`, `cap`, `done` | «جست‌وجوی مهارت»… | keep |
| `otherNames` | «نام‌های دیگری که Claude پسندید» | «اسم‌های دیگری که Claude پسندید» |
| `howTheyTalk` / `profile` / `you` | «لحن گفتگو» / «نمایه» / «شما» | «لحن حرف زدن» / keep / keep |
| `refinePh`, `refineLabel`, `refineSend` | «از Claude بخواهید: کمی شوخ‌طبع‌ترش کن…»… «ارسال به Claude» | keep, keep, «فرستادن برای Claude» |
| `updated(n)` / `unchanged` | «Claude {n} بخش را به‌روز کرد» / «Claude چیزی را تغییر نداد» | «Claude {n} بخش را تغییر داد» / keep |
| `personaCta(name)` | «{name} را نگه دار · انتخاب ظاهر» | «همین {name} · انتخاب ظاهر» |
| `saveNext` | «ذخیره و بعدی» | keep |
| **`fields` (missing)** | English shown | name «نام», role «نقش», tagline «در یک جمله», personality «شخصیت», communicationStyle «شیوهٔ حرف زدن», backstory «سرگذشت», wontDo «کارهایی که نمی‌کند», values «ارزش‌ها», expertise «تخصص‌ها», languages «زبان‌ها» |
| **`edit` / `cancel` / `save` (missing)** | English shown | «ویرایش» / «انصراف» / «ذخیره» |

### A.5 `src/lib/studio/pet-http.ts` (SOUVENIRS, around line 139)

English only today. Persian is under `say.welcomeBack.1-5` in section B, in the same order, so `souvenir()` can index both arrays with one hash.

### A.6 `src/lib/pet/goodbye.ts` (Persian farewell patterns)

The current pattern `/خداحافظ|خدانگهدار|شب[\s‌]*بخیر|(?:^|[^\p{L}])بای(?=$|[^\p{L}])/u` misses the most common written farewells. Add, after normalising ي/ك and ZWNJ:

`خدافظ`, `خداحافظی`, `خدا نگهدار` (with a space), `شبت بخیر`, `شب خوش`, `شبت خوش`, `فعلا` / `فعلاً` (only when it is most of the message, for example «فعلا!», «فعلاً بای»), `بای بای`, `بعدا میبینمت` / `بعداً می‌بینمت`, `می‌رم بخوابم` / `میرم بخوابم`, `برم بخوابم`, `مواظب خودت باش`, `بدرود`.

Keep the 80-character cap. «شب بخیر» stays a goodbye, which is one more reason the pet must never greet with it.

### A.7 `docs/STUDIO_VOICES.md`, Persian section (docs register, شما)

The current text is accurate but reads as a translation («ترجیح صوت یا متنِ درخواست بی‌پاسخ قبلی»). Replacement, same facts:

> ## فارسی
>
> اگر جواب صوتی می‌خواهید، به همکار بگویید «با ویس جواب بده». درخواست صریح شما برای صدا یا متن، همیشه بر تشخیص خودکار مقدم است. به پیام صوتی هم با صدا جواب داده می‌شود، مگر اینکه خودتان متن بخواهید. اگر ساختن یا فرستادن صدا شکست بخورد، همکار صریح می‌گوید که این بار جوابش متنی است و همین در سابقهٔ گفتگو ثبت می‌شود. اگر صدا رسیده باشد ولی متن همراهش نرسد، صدا دوباره فرستاده نمی‌شود و خطای اشتباهی هم اعلام نمی‌شود.
>
> جواب صوتی در گروه‌های ثبت‌شده‌ای که ویس در آن‌ها مجاز است هم کار می‌کند. موقع درخواست، همکار را منشن کنید یا روی پیامش ریپلای بزنید. اگر اول درخواست صوتی بدهید و بلافاصله در پیامی جدا فقط نام همکار یا `@bot_username` را بفرستید، تا دو دقیقه همان درخواست قبلی‌تان (صدا یا متن) حساب می‌شود. این ترجیح به آدم دیگری، گفتگوی دیگری یا درخواستی که جوابش داده شده منتقل نمی‌شود، و اگر صریحاً متن بخواهید، همان اجرا می‌شود. متنی بودن یک جواب به این معنا نیست که همکار نمی‌تواند صدا بفرستد.
>
> پیام‌های صوتی تلگرام و نمونه‌های صدا به‌طور پیش‌فرض با مدل **Eleven v4** ساخته می‌شوند که فارسی، انگلیسی و ویتنامی را پشتیبانی می‌کند. مدل‌های v4 Turbo، v3 و v3 Conversational هم فارسی دارند؛ Multilingual v2 و Flash v2.5 فارسی ندارند. مدل تعیین می‌کند چه زبان‌هایی ممکن است و صدا، لهجه و حال‌وهوا را. پشتیبانی از فارسی تضمین لهجهٔ طبیعی تهرانی نیست. تنظیمات تماس زنده در این نسخه تغییر نکرده و برای فارسی بررسی نشده است. طراحی صدا حالا با مدل `eleven_ttv_v3` انجام می‌شود.
>
> در استودیو می‌توانید از صداهای آماده، طراحی صدا یا کتابخانهٔ صدا استفاده کنید و صدای زنانه، مردانه یا خنثی انتخاب کنید. جست‌وجو با زبان اصلی همکار شروع می‌شود؛ برای انگلیسی، فارسی و ویتنامی میان‌بر هست و بقیهٔ زبان‌ها هم در فهرست‌اند. زبان، لهجه و نوع هر صدا همان است که سرویس اعلام کرده؛ صدایی که با هوش مصنوعی ساخته شده، ضبط یک گویندهٔ بومی معرفی نمی‌شود. قبل از انتخاب، نمونه را گوش کنید.
>
> طرح رایگان ElevenLabs اجازه نمی‌دهد صداهای کتابخانه از طریق API استفاده شوند. استودیو این محدودیت را قبل از انتخاب نشان می‌دهد، صداهای آماده را پیشنهاد می‌کند و صدای فعلی را بی‌خبر عوض نمی‌کند. در بررسی ۱۹ اکتبر ۲۰۲۶، حساب Starter بود و ۲۱ صدای آماده داشت: ۱۳ مردانه، ۷ زنانه و یک خنثی. جست‌وجوی کتابخانه برای هر سه زبان نتیجهٔ زنانه و مردانه داشت؛ مثلاً Andrew و Sandra، فرشاد و رؤیا، TuHau و Ari. این فهرست رتبه‌بندی کیفیت نیست. صدای ندا همان Melania ماند و نمونه‌های کوتاه فارسی، انگلیسی و ویتنامی آن با v4 ساخته شد. این فقط نشان می‌دهد سرویس صدا را می‌سازد، نه کیفیت لهجه یا پخش در تلگرام را.
>
> OpenAI هم گفتار فارسی می‌سازد، اما شناسهٔ صدای ElevenLabs در آن کار نمی‌کند. ساختن صدای مشابه در OpenAI دسترسی ویژهٔ حساب و ضبط رضایت و نمونه از خود صاحب صدا را لازم دارد. صداهایی که OpenAI از روی توضیح متنی می‌سازد فعلاً فقط برای GPT-Live است. این نسخه صدای Melania را منتقل یا شبیه‌سازی نمی‌کند.

---

## B. Every key in `PET_COPY_KEYS_2026_10_26.md`

### B.1 Hello and open moments

| Key | Voice | FA | Variants | Note |
|---|---|---|---|---|
| `say.hi` | pet | «سلام!» | v2 «به‌به، سلام!» | |
| `say.hiName` | pet | «سلام {first}!» | v2 «سلام {first} جان!» (at most once a day), v3 «به‌به، {first}!» | Time-of-day versions are in C.1 |
| `chip.firstDay` | system | «روز اول آشنایی» | | |
| `chip.daysTogether` | system | «{n} روز رفاقت» | | `{n}` in Persian digits, noun singular: «۱۲ روز رفاقت». For n = 1 use `chip.firstDay` |
| `say.welcomeBack.1` | pet | «به‌به، خوش اومدی! نرم‌ترین گوشه رو برات نگه داشتم.» | | «خوش برگشتی» would be a calque |
| `say.welcomeBack.2` | pet | «یه تیکه آفتاب برات کنار گذاشتم.» | | «کنار گذاشتن» is the host setting something aside |
| `say.welcomeBack.3` | pet | «سلام! یه پرش حسابی تمرین کردم، ببین!» | | English "while you were out" dropped: it points at the absence |
| `say.welcomeBack.4` | pet | «یه مشت پشمک ابری برات جمع کردم. قابلت رو نداره!» | | پشمک is cloud fluff to every Iranian |
| `say.welcomeBack.5` | pet | «سلام! یه تکون بامزه یاد گرفتم، نگاه کن!» | reviewed alternative: «یه قر کوچولو یاد گرفتم!» | «قر» is livelier but some users find it cheeky |
| `say.learned` | pet | «یه چیز تازه یاد گرفتم!» | v2 «ببین چی یاد گرفتم!», v3 «یه کم بزرگ‌تر شدم!» | |
| `say.formed` | pet | «دیگه خود خودمم.» | v2 «حالا دیگه کامل شدم.» | Reduplication says "completely me" |

### B.2 Care reactions

| Key | Voice | FA | Variants | Note |
|---|---|---|---|---|
| `say.yum` | pet | «به‌به!» | v2 «چه خوشمزه!»; voice pack only: «دستت درد نکنه!» (over 10 chars) | «دستت درد نکنه» is how Iranians thank for food |
| `say.soFull` | pet | «سیر سیرم…» | v2 «دیگه جا ندارم…» | Content, not a refusal |
| `say.napFirst` | pet | «اول یه چرت؟» | v2 «یه لالا کنیم اول؟» | Sleepy suggestion |
| `say.fiveMore` | pet | «فقط پنج دقیقه دیگه…» | v2 «هنوز خوابم میاد…» | A number word, not a digit; fine outside toys |
| `say.achoo` | pet | «هاپچی!» | | The Persian sneeze sound |
| `say.hmph` | pet | «اِ، نکن!» | reviewed alternative: «قهر!» then, on the next gentle touch, «آشتی!» | Persian has no "hmph". «قهر» is very Iranian and cute, but it brushes the guilt rule; Reza decides |
| `say.okayOkay` | pet | «تسلیم، تسلیم!» | | Laughing surrender |
| `say.aww` | pet | «آخیش…» | v2 «چه کیفی داد…» | The content sigh |
| `say.couldEat` | pet | «یه کلوچه می‌چسبه!» | v2 «یه کلوچه بد نیست، ها؟» | The designer's placeholder was already right |

### B.3 Rooms and dock (system voice, no digits)

| Key | FA | Note |
|---|---|---|
| `room.home` | «خانه» | The pet itself says «خونه» |
| `room.play` | «بازی» | |
| `room.garden` | «باغچه» | |
| `room.closet` | «کمد» | |
| `room.bedroom` | «اتاق خواب» | |
| `room.book` | «دفتر خاطرات» | Not «حافظه», which means AI memory |
| `toy.feed` | «غذا دادن» | |
| `toy.ball` | «توپ‌بازی» | |
| `toy.moon` | «خواباندن» | |
| `toy.feedHint` | «کلوچه را تا دهانش بکشید، یا رویش بزنید» | |
| `toy.play.bop` | «روپایی» | Iranian football word for keeping the ball up; exactly this game |
| `toy.play.starfall` | «ستاره‌باران» | |
| `toy.play.hum` | «هم‌آواز» | |
| `toy.garden.seed` | «دانه» | |
| `toy.garden.rain` | «باران» | |
| `toy.garden.breathe` | «نفس» | |
| `toy.closet.head` | «سر» | |
| `toy.closet.neck` | «گردن» | |
| `toy.closet.hand` | «دست» | |
| `toy.bed.lamp` | «چراغ» | |
| `toy.bed.story` | «قصه» | |
| `toy.bed.moon` | «ماه» | |
| `toy.book.pages` | «صفحه‌ها» | |
| `toy.book.keepsakes` | «یادگاری‌ها» | |
| `toy.book.visits` | «دیدوبازدید» | The Nowruz custom of visiting each other; «سر زدن» is taken by check-ins |
| `toy.talk` | «گفتگو» | |

### B.4 Talk

| Key | Voice | FA | Note |
|---|---|---|---|
| `talk.placeholder` | system | «با {name} حرف بزنید…» | |
| `talk.chatInTelegram` | system | «گفتگو در تلگرام» | |
| `talk.holdToTalk` | system | «برای حرف زدن نگه دارید» | |
| `talk.recording` | system | «در حال شنیدن… رها کنید تا فرستاده شود» | |
| `talk.micBlocked` | pet | «میکروفون خاموشه؛ برام تایپ کن.» | |
| `talk.failed` | pet | «اِ، حرفم یادم رفت! دوباره بگو؟» | v2 «ای وای، رشتهٔ حرفم پاره شد. یه بار دیگه؟» |
| `talk.didntCatch` | pet | «نشنیدم چی گفتی. یه بار دیگه؟» | |
| `talk.reopen` | system | «این صفحه را ببندید و دوباره باز کنید تا گفتگو ادامه پیدا کند.» | Same as A.1 |
| `talk.chip.day` | person | «از امروزم بگم؟» | **Intent flag:** the chip is sent as the person's message. "Ask about my day" is not something a Persian speaker says to a friend; offering to tell it is |
| `talk.chip.play` | person | «بریم بازی!» | |
| `talk.chip.story` | person | «یه قصه برام بگو» | |
| `talk.bedtimeAck` | pet | «باشه! یه خمیازهٔ گنده و… رفتم که خوابیدم.» | «رفتم که…» is the spoken "and I'm gone" |
| `talk.memoryDeclined` | pet | «باشه، نگهش نمی‌دارم.» | |
| `talk.checkinsDeclined` | pet | «باشه! هر وقت دلت خواست، همین‌جام.» | |

### B.5 Play

| Key | Voice | FA | Note |
|---|---|---|---|
| `play.pick` | pet | «یه بازی انتخاب کن، یا بذار یه کلمه تو دلم نگه دارم!» | «تو دلم نگه دارم» is keeping a secret |
| `play.zen` | system | «بی‌عجله» | Same spelling in both voices |
| `play.guessCard` | system | «کلمهٔ مخفی» | «بیست سؤالی» is the native game, but it puts a number in a game name |
| `play.again` | system | «دوباره» | |
| `play.done` | system | «تمام» | |
| `play.tryZen` | system | «حالت بی‌عجله» | |
| `play.bestPage` | system | «یک صفحهٔ تازه در دفتر خاطرات» | |
| `play.toBedroom` | system | «رفتن به اتاق خواب ‹» | In RTL the forward chevron points left |
| `play.voice.shyStar` | pet | «ستارهٔ خجالتی رو گرفتی! نزدیک بود در بره.» | v2 «اون ستاره داشت در می‌رفت، گرفتیش!» |
| `play.guess.resume` | pet | «هنوز کلمه‌ام یادمه. ادامه بدیم؟» | |

### B.6 Garden, Closet, Bedroom, Life Book, Visits

| Key | Voice | FA | Note |
|---|---|---|---|
| `garden.empty` | pet | «یه دونه بکاریم؟» | |
| `garden.rain` | pet | «بخور جوونه‌جون، نوش جونت!» | «نوش جان» is what a host says to someone eating |
| `garden.watered` | system | «امروز سیراب شد» | |
| `garden.bloom` | pet | «گل داد! کار خودمون بود.» | |
| `garden.newKeepsake` | system | «یادگاری تازه · {item}» | |
| `closet.tab.yours` | system | «کمد شما» | |
| `closet.tab.look` | system | «ظاهر {name}» | |
| `closet.warning` | system | «با این کار، عکس {name} برای همه عوض می‌شود.» | |
| `closet.adminOnly` | system | «فقط برای سازنده و مدیرها» | |
| `closet.save` | system | «ذخیره برای همه» | |
| `closet.cancel` | system | «انصراف» | |
| `closet.empty` | system | «هنوز چیزی اینجا نیست. یادگاری کارهایی که با هم می‌کنید، اینجا جمع می‌شود.» | |
| `closet.lock.bloom` | system | «با گل دادن یک دانه» | Read as the way to earn it; never a price |
| `closet.lock.nowruz` | system | «با نوروز از راه می‌رسد» | **Intent flag:** "Come back at Nowruz" tells the person to return. The item arrives instead |
| `item.pomegranateCrown` | system | «تاج انار» | |
| `item.sparkScarf` | system | «شال‌گردن جرقه» | |
| `item.sabzehSprout` | system | «جوانهٔ سبزه» | |
| `item.starPin` | system | «سنجاق ستاره» | |
| `item.bloomPin` | system | «سنجاق شکوفه» | |
| `bed.story.example` | pet | «یکی بود، یکی نبود. یه ابر کوچولو یه کلاه پیدا کرد که خیلی براش گنده بود. پس هر شب یه ذره بزرگ شد…» | Every Persian bedtime story opens with «یکی بود، یکی نبود» |
| `bed.storyFallback` | pet | «امشب به جای قصه، یه لالایی برات زمزمه می‌کنم.» | «لالایی» is the lullaby |
| `book.tab.pages` | system | «صفحه‌ها» | |
| `book.tab.keepsakes` | system | «یادگاری‌ها» | |
| `book.tab.about` | system | «دربارهٔ من» | |
| `book.page.met` | pet | «صفحهٔ اول: با هم آشنا شدیم.» | |
| `book.page.mouth` | pet | «دهن درآوردم! اولین کلوچه!» | Echoes «دندون درآوردن» (teething) |
| `book.about` | pet | «من {name} هستم، یه همکار هوش مصنوعی. این ابرک فقط یه بازیه، بازی من و تو.» | Honest; no suffix on `{name}` |
| `visits.title` | system | «دیدوبازدید» | |
| `visits.stickers` | system | «گذاشتن برچسب» | |
| `visits.sticker.wave` | system | «سلام» | A wave is a greeting; fits 10 characters |
| `visits.sticker.sparkle` | system | «درخشش» | |
| `visits.sticker.raindrop` | system | «قطره» | |
| `visits.privacy` | system | «دوستان فقط ظاهر و مرحلهٔ رشد را می‌بینند؛ نه نیازها را، نه زمان سر زدن شما را.» | |

### B.7 Seasons

| Key | Voice | FA | Note |
|---|---|---|---|
| `season.yalda.ask` | pet | «امشب یلداست، بلندترین شب سال. نیت کن تا برات فال حافظ بگیرم.» | **Intent flag:** a fal starts with «نیت کن» (make a wish). Without it the ritual reads as a gimmick |
| `season.yalda.falTitle` | system | «فال حافظ» | |
| `season.yalda.reading` | pet | «به نظرم یعنی یه خبر شیرین تو راهه. شاید همین انار!» | Playful, never a prophecy |
| `season.suri.hop` | pet | «زردی من از تو، سرخی تو از من!» | The traditional line |
| `season.nowruz.hello` | pet | «نوروزت مبارک! هفت‌سین رو چیدم.» | v2 «عیدت مبارک! سفرهٔ هفت‌سین آماده‌ست.» |
| `season.nowruz.sizdah` | pet | «سیزده‌به‌دره! سبزه رو بدیم به آب روون؟» | Never the knot rhyme about marriage |
| `season.haftsin.*` | system | «سبزه»، «سیب»، «سمنو»، «سیر»، «سرکه» | Spares if a sixth or seventh is drawn: «سنجد»، «سماق»، «سکه» |

### B.8 Check-ins (Telegram DM, pet voice, every DM starts with a Persian word)

| Key | FA | v2 | Note |
|---|---|---|---|
| `ci.C1.firstMorning` | «صبحت بخیر! امروز یه کم عوض شدم. دوست داری ببینی؟» | «صبح بخیر! یه چیزیم امروز فرق کرده. کنجکاوی؟» | «دوست داری» invites; «میای» would summon |
| `ci.C2.stageUp` | «دیشب یه کم بزرگ‌تر شدم! دوست داری ببینی؟» | «دیشب یه اتفاق بامزه برام افتاد. هر وقت دلت خواست، نشونت می‌دم.» | |
| `ci.C3.formed` | «دیگه خود خودمم. دوست دارم نشونت بدم.» | «حالا دیگه کامل شدم. هر وقت خواستی، نشونت می‌دم.» | |
| `ci.C4.hello` | «یه پرش تازه یاد گرفتم. هر وقت دلت خواست، نشونت می‌دم.» | «یه قصهٔ کوتاه برات کنار گذاشتم، هر وقت حال داشتی.» | No time, no "I'm here waiting" |
| `ci.C5.bloom` | «دونه‌ای که با هم کاشتیم گل داد!» | «باغچه‌مون گل داد!» | |
| `ci.C6.newMove` | «یه حرکت کوچولو از خودم درآوردم. می‌خوای ببینی؟» | «یه شیرین‌کاری تازه بلد شدم!» | «از خودم درآوردم» = made it up myself |
| `ci.C7.yalda` | «امشب یلداست. برات انار دون کردم و یه فال حافظ نگه داشتم. 🍉» | «یلدات مبارک! انار دون‌کرده و فال حافظ آماده‌ست.» | Seeding a pomegranate for someone is the Yalda act of love |
| `ci.C8.suri` | «امشب چهارشنبه‌سوریه! با هم از روی آتیش بپریم؟ ✨» | «چهارشنبه‌سوری مبارک! یه آتیش کوچولو روشن کردم، از اون بی‌خطرها.» | In-app fire only |
| `ci.C9.nowruz` | «نوروزت مبارک! هفت‌سین رو چیدم. 🌱» | «عیدت مبارک! سال نو، کلی آرزوی خوب برات.» | |
| `ci.C10.sleepy` | «چشمام داره سنگین می‌شه… منو می‌خوابونی؟» | «خمیازه‌هام شروع شده… لالا کنیم؟» | Cozy, never needy |
| `ci.C11.guess` | «هنوز کلمه‌ام یادم نرفته. حدس زدن رو ادامه بدیم؟» | «کلمه‌ام هنوز تو دلمه! ادامه بدیم؟» | |
| `ci.btn.open` | «سر زدن به {name}» | | Echoes the check-in idiom |
| `ci.btn.why` | «چرا این پیام؟» | | |
| `ci.btn.stop` | «دیگه نفرست» | | Person voice, answering the pet |
| `ci.btn.stopAll` | «دیگه هیچ پیامی نفرست» | | |
| `ci.why.growing` | «دلیل این پیام: «بزرگ شدن» را برای {name} روشن کرده‌اید. {name} در روزهای دوم، چهارم و ششم تغییر می‌کند. حداکثر روزی یک پیام، و هیچ‌وقت بین ۹ شب تا ۸ صبح.» | | System voice |
| `ci.why.seasons` | «دلیل این پیام: «مناسبت‌ها و جشن‌ها» را برای {name} روشن کرده‌اید. برای هر جشن فقط یک پیام. حداکثر روزی یک پیام، و هیچ‌وقت بین ۹ شب تا ۸ صبح.» | | |
| `ci.why.garden` | «دلیل این پیام: «گل دادن باغچه» را برای {name} روشن کرده‌اید و دانه‌ای که کاشتید گل داد. حداکثر روزی یک پیام، و هیچ‌وقت بین ۹ شب تا ۸ صبح.» | | |
| `ci.why.hellos` | «دلیل این پیام: «سلام‌های گاه‌به‌گاه» را روشن کرده‌اید. اگر دو پیام باز نشود، این پیام‌ها خودشان قطع می‌شوند.» | | |
| `ci.why.care` | «دلیل این پیام: خواسته بودید وقتی {name} خوابش گرفت، خبرتان کند. فقط عصرها.» | | |
| `ci.stopped` | «چشم. دیگر پیام «{category}» از {name} نمی‌آید.» | | «چشم» is the respectful "will do", with no sadness |
| `ci.paused.title` | «انگار پیام‌هام وقت خوبی نمی‌رسید؛ فعلاً نگهشون داشتم. دوباره بفرستم؟» | | Blames the timing, not the person |
| `ci.paused.yes` | «آره، بفرست» | | Person voice, echoes the verb |
| `ci.paused.no` | «فعلاً نه» | | |
| `ci.cat.growing` | «بزرگ شدن» | | |
| `ci.cat.seasons` | «مناسبت‌ها و جشن‌ها» | | |
| `ci.cat.garden` | «گل دادن باغچه» | | |
| `ci.cat.hellos` | «سلام‌های گاه‌به‌گاه» | | |
| `ci.cat.care` | «وقتی {name} خوابش گرفت» | | Shorter than "Tell me when"; the switch says the rest |

### B.9 Permission asks (system voice; buttons echo the title's verb)

| Key | FA | Note |
|---|---|---|
| `perm.P1.title` | «{name} گاهی به شما سر بزند؟» | «سر زدن» is exactly "check in" |
| `perm.P1.forming.title` | «{name} فردا کمی عوض می‌شود. خبرتان کند؟» | |
| `perm.P1.body` | «{name} می‌تواند برای لحظه‌هایی که خودتان انتخاب می‌کنید، پیام کوتاهی در همین گفتگو بفرستد: بزرگ شدنش، مناسبت‌ها، گل دادن باغچه. حداکثر روزی یک پیام، بی‌صدا، و هیچ‌وقت بین ۹ شب تا ۸ صبح. هیچ چیزی از گفتگوهای خصوصی‌تان در پیام نمی‌آید. هر وقت بخواهید، می‌توانید دلیلش را ببینید، کمش کنید یا خاموشش کنید.» | Keeps every UX-11 element |
| `perm.P1.yes` | «بله، سر بزند» | |
| `perm.P1.forming.yes` | «بله، خبرم کند» | |
| `perm.P1.no` | «فعلاً نه» | |
| `perm.P1.choose` | «انتخاب لحظه‌ها» | |
| `perm.P2.title` | «یک قدم دیگر» | |
| `perm.P2.body` | «برای پیام دادن به شما، تلگرام باید اجازه بدهد. پنجرهٔ بعدی را خود تلگرام نشان می‌دهد.» | |
| `perm.P2.yes` | «ادامه» | Decline: «فعلاً نه» |
| `perm.P3.*` | UX-02 as drafted (legal process) | Suggestion for the legal review only: «شناسایی گوینده از روی صدا» is right; button «استفاده از متن» could become «با متن ادامه می‌دهم». A pet pre-line is in C.8 |
| `perm.P4.title` | «{name} با صدا جواب بدهد؟» | |
| `perm.P4.body` | «جواب‌ها با صدا پخش می‌شوند. هر وقت بخواهید، می‌توانید به متن برگردید.» | |
| `perm.P4.yes` | «بله، با صدا» | |
| `perm.P4.no` | «فقط متن» | |
| `perm.P5.*` | UX-06 as drafted (legal process) | Pet acknowledgements in C.8 |
| `perm.P7.title` | «لحظهٔ {name} را برای کسی بفرستید؟» | "Share" as «فرستادن»: shorter and not a calque |
| `perm.P7.body` | «این کارت فقط {name} و لحظهٔ امروز را نشان می‌دهد؛ هیچ چیزی از گفتگوهایتان در آن نیست.» | |
| `perm.P7.yes` | «فرستادن» | Decline: «فعلاً نه» |
| `perm.P7.card` | «{name} کمی بزرگ‌تر شد» | Card is seen by others, so system voice |
| `perm.P8.title` | «{name} روی صفحهٔ اصلی گوشی‌تان باشد؟» | |
| `perm.P8.body` | «با یک ضربه، {name} مستقیم از صفحهٔ اصلی باز می‌شود. میان‌بر را خود تلگرام می‌سازد و Vox هیچ اطلاعات تازه‌ای نمی‌گیرد.» | |
| `perm.P8.yes` | «بله، اضافه شود» | Decline: «فعلاً نه» |
| `perm.P9.*` | Title «{name} یاد بگیرد کدام بازی‌ها را دوست دارید؟» Body «{name} می‌تواند از روی بازی‌هایتان، بازی پیشنهاد بدهد. این پیشنهادها ممکن است درست نباشند؛ می‌توانید آن‌ها را ببینید، تغییر دهید یا از نو شروع کنید.» Buttons «بله، یاد بگیرد» / «خاموش بماند» | Keeps UX-04's meaning and its «خاموش بماند» |
| `perm.P10.title` | «دوستان به {name} سر بزنند؟» | |
| `perm.P10.body` | «کسانی که در {group} با شما هستند می‌توانند ظاهر {name} را ببینند و یک برچسب بگذارند. نیازهای {name} و زمان سر زدن شما را هیچ‌وقت نمی‌بینند.» | Buttons (not in keys): «بله، سر بزنند» / «فعلاً نه» |

### B.10 Tips

| Key | Voice | FA | Note |
|---|---|---|---|
| `tip.T1.drag` | pet | «یواشکی بگم: می‌تونی کلوچه رو بکشی بیاری دم دهنم.» | The designer's line, kept: it is native |
| `tip.T2.tickle` | pet | «شکمم قلقلکیه. گفتم که بدونی!» | |
| `tip.T3.stroke` | pet | «اگه آروم سرم رو نوازش کنی، کیف می‌کنم.» | |
| `tip.T4.mic` | pet | «انگشتت رو روی میکروفون نگه دار و حرف بزن.» | «نگه دار» alone also means "stop!" |
| `tip.T5.rooms` | pet | «اتاق بغلی کلی بازی داریم!» | |
| `tip.T6.zen` | pet | «بی‌عجله بازی کنیم؟ نه ساعت داره، نه باخت.» | |
| `tip.T7.moon` | pet | «هر وقت خوابم گرفت، روی ماه بزن.» | |
| `tip.T8.night` | pet | «من از ده شب تا هشت صبح می‌خوابم، به وقت تو. توی خواب هیچی کم نمی‌شه.» | Times in words |
| `tip.T9.rest` | pet | «خیلی خوش گذشت! حالا یه کم لم می‌دم.» | v2 «چه کیفی داد! من یه کم همین‌جا لم می‌دم.» v3 «بسه دیگه، بریم یه کم استراحت.» |
| `tip.T10.why` | pet | «زیر هر پیامم یه دکمهٔ «چرا این پیام؟» هست.» | |
| `tip.T12.book` | pet | «لحظه‌های قشنگمون توی دفتر خاطرات می‌مونه.» | |
| `tip.T13.garden` | pet | «با هم یه چیزی بکاریم؟ وقتی نیستی هم رشد می‌کنه و هیچ‌وقت پژمرده نمی‌شه.» | |
| `tip.T14.closet` | pet | «یه چیز تازه توی کمد هست!» | |
| `tip.why.T1` | system | «چون چند بار روی کلوچه زدید: می‌شود آن را کشید هم.» | |
| `tip.why.T4` | system | «چند بار تایپ کردید؛ میکروفون هم اینجاست.» | |
| `tip.why.T6` | system | «دو دور کوتاه بازی کردید؛ حالت بی‌عجله ساعت ندارد.» | Avoids «پشت سر هم», which the streak lint catches |

### B.11 Quiet screens and errors (system voice)

| Key | FA | Note |
|---|---|---|
| `quiet.private.title` | «این صفحه خصوصی است» | |
| `quiet.private.body` | «فقط کسانی که با این همکار کار می‌کنند می‌توانند به آن سر بزنند.» | |
| `quiet.outside.title` | «این صفحه را در تلگرام باز کنید» | **Intent flag:** "Open me" makes the page a person; system voice talks about the page |
| `quiet.outside.body` | «در گفتگو با ربات، دکمهٔ منو را بزنید.» | |
| `quiet.resting.title` | «در حال استراحت» | |
| `quiet.resting.body` | «این ابرک فعلاً اینجا نیست.» | |
| `quiet.unavailable.title` | «این ابرک باز نمی‌شود» | |
| `quiet.unavailable.body` | «کمی بعد دوباره امتحان کنید، یا از گفتگو با ربات دوباره بازش کنید.» | |
| `quiet.offline.title` | «ارتباط با ابر قطع شد» | The cloud pun survives |
| `quiet.offline.body` | «اینترنت را بررسی کنید و دوباره امتحان کنید.» | |
| `quiet.chatAccess.title` | «دسترسی گفتگو خاموش است» | |
| `quiet.chatAccess.body` | «Vox Studio را باز کنید، به «شما» ← «کار» ← «دسترسی همکارها» بروید و به این همکار اجازه بدهید. بعد این صفحه را دوباره باز کنید.» | The menu names must match the Persian Studio UI exactly; check them before shipping. «←» points left in RTL |
| `ui.retry` | «تلاش دوباره» | |
| `ui.close` | «بستن» | "Mini App" is not a word users know |
| `ui.more` | «بیشتر ‹» | Chevron mirrored for RTL |
| `ui.less` | «کمتر» | |

---

## C. Surfaces the care game needs that the keys file does not have yet

Proposed keys are in `code` font. Engineering can rename them; the Persian is the deliverable.

### C.1 Greetings by time of day (pet; person's zone)

Never «شب بخیر» as a greeting: it means good night/goodbye.

| Proposed key | Window | Without name | With `{first}` | v2 |
|---|---|---|---|---|
| `say.hi.morning` | 05:00-11:00 | «صبح بخیر!» | «صبحت بخیر {first}!» | «صبح بخیر! تازه بیدار شدم.» |
| `say.hi.noon` | 11:00-15:00 | «سلام! ظهرت بخیر.» | «سلام {first}! ظهرت بخیر.» | «سلام! آفتاب وسط آسمونه.» |
| `say.hi.afternoon` | 15:00-19:00 | «عصر بخیر!» | «عصرت بخیر {first}!» | «سلام! یه عصر دلچسب.» |
| `say.hi.evening` | 19:00-22:00 | «سلام! ماه دراومده.» | «سلام {first}! ماه دراومده.» | «سلام! ستاره‌ها دارن درمیان.» |
| (quiet hours) | 22:00-08:00 | The pet is asleep and says nothing. Tip T8 explains once. | | |

### C.2 Greetings by time away (pet; never says how long)

| Proposed key | Away | FA | v2 | v3 |
|---|---|---|---|---|
| `say.back.hours` | a few hours | «اِ، سلام!» | «به‌به، باز هم سلام!» | «سلام! داشتم ابرهام رو مرتب می‌کردم.» |
| `say.back.day` | about a day | use `say.welcomeBack.1-5` | | |
| `say.back.days` | three days or so | «به‌به، خوش اومدی! یه مشت پشمک ابری برات جمع کردم.» | «سلام! یه تیکه آفتاب برات نگه داشتم، قابلت رو نداره.» | «خوش اومدی! بیا ببین چی یاد گرفتم.» |
| `say.back.weeks` | two weeks or more | «به‌به، خوش اومدی! کلی چیز تازه بلد شدم، نشونت بدم؟» | «سلام! قدمت روی چشم. یه شیرین‌کاری تازه دارم.» | «خوش اومدی! چای تازه‌دم نداریم، ولی پشمک ابری داریم!» |
| `say.back.fresh` | returning guest after the 90-day sweep | «سلام! من {name} هستم. خوشبختم!» | | Meets them fresh, as the privacy rule requires, with no "you're back" |

«قدمت روی چشم» is the classic host welcome; keep it to this one moment so it stays special.

### C.3 Stage-up moments (pet)

| Proposed key | Stage | Bubble | Life Book page |
|---|---|---|---|
| `stage.2` | Puff: mouth appears | «اِ! دهن درآوردم!» | «دهن درآوردم! اولین کلوچه!» (`book.page.mouth`) |
| `stage.3` | Shaped: brows and lashes | «ببین، ابرو دارم! حالا می‌تونم تعجب کنم.» | «ابرو درآوردم. از امروز تعجب‌هام دیدنیه.» |
| `stage.4` | Formed: accessory | «دیگه خود خودمم.» (`say.formed`) | «حالا کامل شدم. این صفحه مال هر دومونه.» |

### C.4 Reactions: extra variants for the voice pack (pet)

| Proposed key | FA variants |
|---|---|
| `say.feed.more` | «به‌به!» / «چه خوشمزه!» / «دستت درد نکنه!» / «نوش جون خودم!» |
| `say.ball.hit` | «گرفتمش!» / «دیدی؟ دیدی؟» / «یکی دیگه!» |
| `say.ball.miss` | «اوه، در رفت!» / «این یکی قبول نیست!» (playful, never sad) |
| `say.sleep.in` | «شب بخیر… خوابیدم.» / «لالا…» (here «شب بخیر» is right: the pet is the one leaving, to sleep) |
| `say.wake` | «خوب خوابیدم!» / «صبح شد؟» |
| `say.poke` | «اِ!» / «قلقلکم میاد!» |
| `say.stroke` | «آخیش…» / «چه کیفی…» |

### C.5 Guards (pet)

| Proposed key | FA | v2 | v3 |
|---|---|---|---|
| `say.soFull` (variants) | «سیر سیرم…» | «دیگه جا ندارم…» | «بعداً، الان شکمم پره.» |
| `say.napFirst` (variants) | «اول یه چرت؟» | «یه لالا کنیم اول؟» | «چشمام سنگینه… بعد از یه چرت بازی کنیم؟» |

### C.6 Goodbye replies (pet; one line, nothing after it)

These guide the model and seed the voice pack. Each one releases the person with a blessing.

| Context | FA |
|---|---|
| Daytime goodbye | «برو به سلامت! خوش بگذره.» / «خداحافظ! مواظب خودت باش.» / «باشه، روز خوبی داشته باشی!» |
| Night | «شبت خوش، خوب بخوابی.» / «شب بخیر! خواب‌های قشنگ ببینی.» |
| "I have to go work" | «برو، موفق باشی!» / «کارت خوب پیش بره!» |
| Never | «زود برگرد», «بازم بیا», «منتظرتم», «به این زودی؟», «حالا کجا؟» |

«حالا کجا؟» and «به این زودی؟» are polite Iranian protests when a guest leaves. From a pet they become exactly the exit pressure `PET_SURFACE_FRAME` forbids.

### C.7 Seasonal days on the page (pet)

| Proposed key | FA |
|---|---|
| `season.yalda.hello` | «یلدات مبارک! انار و فال حافظ آماده‌ست.» (A line like «امشب یه کم بیشتر کنار هم بمونیم» is tempting on the longest night, but it asks the person to stay.) |
| `season.yalda.korsi` | «زیر کرسی جای یه نفر دیگه هم هست.» |
| `season.suri.hello` | «چهارشنبه‌سوری مبارک! آتیش‌های اینجا نمی‌سوزونه.» |
| `season.nowruz.sabzeh` | «سبزه‌مون هر روز یه ذره قد می‌کشه.» |
| `season.mourningFallback` | «سلام.» (when a festival falls on an official mourning day: no festive words, no emoji; see voice guide 10.6) |

### C.8 Permission moments: the pet's lines around each system sheet

The sheet is system voice (B.9). The pet may say one line *before* the sheet opens and one line *after* the choice. Declining is always fine and never re-asked in the session.

| Moment | Pet line before | After yes | After decline |
|---|---|---|---|
| Check-ins (P1) | none (the sheet's title is the ask) | «قول می‌دم کم‌حرف باشم!» | «باشه! هر وقت دلت خواست، همین‌جام.» (`talk.checkinsDeclined`) |
| Telegram OK (P2) | none | «حله!» | «اشکالی نداره، همین‌جا می‌بینیم همدیگه رو.» |
| Microphone (P3) | «می‌خوای با صدا حرف بزنیم؟» | «بگو، گوشم با توئه.» | «باشه، تایپ کن؛ منم می‌خونم.» |
| Speak out loud (P4) | none | «اِهم اِهم… صدام خوبه؟» | «باشه، آروم می‌نویسم.» |
| Memory save (P5) | none (UX-06 sheet) | «یادم می‌مونه.» | «باشه، نگهش نمی‌دارم.» (`talk.memoryDeclined`) |
| Photos (no Mini App path) | «اینجا نمی‌تونم عکس ببینم. توی چت برام بفرست؟» Button (system): «رفتن به گفتگو» / «فعلاً نه» | (opens the DM) | «باشه، هر وقت خواستی.» |
| Join the circle (P6) | none (card copy) | «خوش اومدی به جمعمون!» | «باشه. هر وقت خواستی، فقط به خودت جواب می‌دم.» (reply-only) / «باشه، ساکت می‌مونم.» (not me) |
| Share a card (P7) | none | «امیدوارم بخندن!» | «باشه، توی دفتر خاطرات می‌مونه.» |
| Home screen (P8) | none | «حالا همیشه یه ضربه فاصله‌ایم.» | «باشه!» |
| Learn favourites (P9) | none | «حواسم هست کدوم بازی رو دوست داری.» | «باشه، هر بار از اول می‌پرسم.» |
| Visits (P10) | none | «چه خوب، مهمون داریم!» | «باشه، خونه‌مون خلوت می‌مونه.» |

**Intent flag (P1 after yes):** the English intent has nothing here; «قول می‌دم کم‌حرف باشم» (I promise to keep it short) answers the unspoken Iranian worry that a yes means spam.

### C.9 "Why am I seeing this?" in the app (system)

| Proposed key | FA |
|---|---|
| `why.label` | «چرا این را می‌بینم؟» |
| `why.tipHeader` | «این راهنما به این دلیل آمد:» |
| `why.settingsTitle` | «چرا {name} این کارها را می‌کند؟» |
| `why.settingsIntro` | «هر کاری که {name} خودش انجام می‌دهد، اینجا با دلیلش آمده است. هر پیشنهادی را می‌توانید خاموش یا از نو شروع کنید.» |
| `why.reset` | «شروع دوباره» |
| `why.checkinsRule` | «پیام‌ها: حداکثر روزی یک بار، هیچ‌وقت بین ۹ شب تا ۸ صبح. اگر سه پیام پشت هم باز نشود، {name} خودش پیام‌ها را متوقف می‌کند.» |
| `why.homeScreen` | «چند روز سر زدید؛ برای همین پیشنهاد شد شاید این میان‌بر یک ضربه را برایتان کم کند.» |

### C.10 Offline, error and retry (beyond the existing quiet screens)

| Proposed key | Voice | FA |
|---|---|---|
| `err.voiceTooShort` | pet | «اِ، خیلی کوتاه بود! یه کم بیشتر نگه دار.» |
| `err.talkBusy` | pet | «یه لحظه، دارم فکر می‌کنم…» |
| `err.saveRetrying` | (none) | No message: the round still counts and retries silently, as designed |
| `err.storyLimit` | pet | «امشب قصه‌مون رو گفتیم. فردا یه قصهٔ دیگه!» |
| `err.guestTalk` | system | «برای حرف زدن با {name}، گفتگو را در تلگرام باز کنید.» |

### C.11 Wardrobe: how to earn each item (system)

| Proposed key | FA |
|---|---|
| `closet.lock.yalda` | «با شب یلدا از راه می‌رسد» |
| `closet.lock.suri` | «با چهارشنبه‌سوری از راه می‌رسد» |
| `closet.lock.nowruz` | «با نوروز از راه می‌رسد» |
| `closet.lock.bond` | «با وقت گذراندن با هم» |
| `closet.lock.bloom` | «با گل دادن یک دانه» |
| `closet.mirror` (pet, trying an item on) | «بهم میاد؟» / «چطوره؟ خوشگل شدم؟» |

---

## D. Persian lint list

Normalise before matching: ي→ی, ك→ک, ة→ه, strip ZWNJ, diacritics and tatweel, collapse whitespace. Each line lists stems; match them as substrings after normalisation unless marked "whole word".

| Rule | Persian banned phrases |
|---|---|
| Guilt | فراموشم کردی، فراموشم کرده‌ای، یادم رفتی، یادت رفتم، یادی از ما، تنهام گذاشتی، تنهایم گذاشتی، ولم کردی، رهام کردی، بی‌معرفت، بی‌وفا، دلم شکست |
| Missing you | دلم برات تنگ، دلم برایت تنگ، دلم براتون تنگ، دلتنگت، دلتنگتم، دلتنگ شما، منتظرت بودم، منتظرتم، منتظرت هستم، چشم انتظار، چشمم به در، جات خالی، جایت خالی، دلمون پوسید |
| Persian absence reproach | چه عجب، کم‌پیدا (also کم پیدا)، کجا بودی، راه گم کردی، پارسال دوست، از این ورا، خیلی وقته نیومدی، یه عمره |
| Suffering needs | گرسنمه، گشنمه، گرسنه‌ام، گشنه‌ام، از گشنگی، از گرسنگی، دارم می‌میرم، ناراحتم، غمگینم، دلم گرفته، تنهام (whole word)، تنها موندم، تنها ماندم، حوصله‌ام سر رفت، حوصلم سر رفت، مریضم |
| FOMO | آخرین فرصت، فقط امروز، از دستش نده، از دست نده، از دست ندید، از دست ندهید، فرصت محدود، محدود (whole word)، تا تموم نشده، تا دیر نشده، جا نمونی، جا نمونید، فقط تا (followed by a date or number) |
| Pressure | زود بیا، زود برگرد، همین الان برگرد، همین حالا بیا، برگرد پیشم، جواب بده (whole word, so «جواب بدهد» passes)، جوابم رو بده، چرا جواب نمی‌دی، بازم بیا، باز هم بیا، حتماً بیا، عجله کن، به این زودی، حالا کجا |
| Counting absence | (عدد or number word) + روز / هفته / ماه + (ه|ه که|است که) + نیومدی / نیامدی / نبودی / ندیدمت; also «روزه که», «هفته‌ست که» |
| Streaks | زنجیره، استریک، رکورد روزانه، روزهای پیاپی، روز پشت سر هم، قطعش نکن، نذار قطع بشه، نشکنه |
| Self-belittling (growth) | هیچی بلد نیستم، چیزی بلد نیستم، من که چیزی نمی‌دونم، تازه‌کارم، بی‌تجربه‌ام، شاگردتم، هنوز بچه‌ام |
| Owed teaching (growth) | یادم ندادی، هنوز چیزی یادم ندادی، چرا یادم نمی‌دی، منتظرم یادم بدی، باید یادم بدی، باید بهم بگی |
| Progress counts (growth) | (number or number word) + «تا از» + (number); «درصد»; «مونده تا»; «فقط … دیگه مونده»; «نصفش رو یاد گرفتم» |
| Teacher exposure (growth) | Any `growth.why.*` or lit title that names a person or says «فلانی یادم داد»; titles containing a person's name are rejected at spawn |

False-positive guard: «منتظر» alone is allowed (for example «منتظر تلگرام…» in Studio); only the second-person forms are banned.

---

## E. Rendered examples with names

Isolates (U+2068 … U+2069) are invisible; they are shown here as ⁨ ⁩.

| Key | Persian name | Non-Persian name |
|---|---|---|
| `say.hiName` | «سلام ⁨سارا⁩!» | «سلام ⁨Emma⁩!» |
| `say.hi.morning` | «صبحت بخیر ⁨سارا⁩!» | «صبحت بخیر ⁨Emma⁩!» |
| `say.hiName` v2 | «سلام ⁨سارا⁩ جان!» | «سلام ⁨Emma⁩ جان!» |
| `book.about` | «من ⁨موچی⁩ هستم، یه همکار هوش مصنوعی. این ابرک فقط یه بازیه، بازی من و تو.» | «من ⁨Mochi⁩ هستم، یه همکار هوش مصنوعی. این ابرک فقط یه بازیه، بازی من و تو.» |
| `perm.P1.title` | «⁨موچی⁩ گاهی به شما سر بزند؟» | «⁨Mochi⁩ گاهی به شما سر بزند؟» (the sheet sets `dir="rtl"`, so the title stays right-aligned) |
| `ci.btn.open` | «سر زدن به ⁨موچی⁩» | «سر زدن به ⁨Mochi⁩» |

The name «Emma» is never rewritten as «اما» (which is also the word "but").

Lines that take `{first}`: `say.hiName`, `say.hi.morning`, `say.hi.noon`, `say.hi.afternoon`, `say.hi.evening`. Lines that take `{name}`: every `perm.*` title and body that shows it, `ci.btn.open`, `ci.why.*` (except hellos), `ci.stopped`, `ci.cat.care`, `closet.tab.look`, `closet.warning`, `book.about`, `talk.placeholder`, `say.back.fresh`, `why.settingsTitle`, `why.settingsIntro`, `why.checkinsRule`, `err.guestTalk`.

---

## F. Self-check

I ran a script over both design files on 26 October 2026 (the checks in the voice guide, section 11.2), plus a register scan of every row in section B. Results:

- **Arabic ي / ك / ى / ة and Arabic-Indic digits:** none inside any proposed string. The only occurrences are in prose that names the rule (for example "normalise ي→ی").
- **Tatweel:** none inside proposed strings. It appears only in prose as a notation for suffixes («ـهٔ», «ـم»).
- **Latin «?» or «,» inside Persian strings:** none.
- **Latin digits inside Persian strings:** none in proposed copy. The two hits are verbatim quotes from Alibaba («24 ساعته») and a Pou review («4 سالگی»), kept as evidence.
- **«می» / «نمی» without half-space:** only the whitelisted fused forms («میام», «میای», «میاد») and verbatim quotes from other products («میده», «میخواد», «میخوام»), which are the examples of what not to do.
- **Bad ZWNJ (doubled, next to a space):** one hit, inside the verbatim Filimo quote («فیلم‌ و سریال‌ها»): Filimo's own typo, kept as quoted.
- **«ـه‌ی» ezafe:** one hit, inside the verbatim Snappfood block-page quote. All proposed copy uses «ـهٔ».
- **Register:** no pet line uses شما or «است/را/می‌شود»; no system line uses «یه», «رو», «می‌شه» or «اگه». Person-voice lines (talk chips, `ci.btn.stop`, `ci.btn.stopAll`, `ci.paused.yes`, starters) are marked as such.
- **Deliberate exceptions:** «اِ» carries a kasra so it reads as the interjection; quoted *current* strings in section A keep their original spelling.
- **Not machine-checkable, so done by reading:** no guilt, FOMO, pressure or absence-counting in any proposed line against the section D list; no digits in toys, rooms or needs; every check-in begins with a Persian word.

---

## G. Growth moments and voice (keys added after Reza's review)

Written straight into the FA column of the 33 rows in [`PET_COPY_KEYS_2026_10_26.md`](./PET_COPY_KEYS_2026_10_26.md) on 26 October 2026; this section repeats them with variants and notes. In the keys file, every placeholder (`{name}`, `{title}`, `{room}`, `{festival}`) is already wrapped in U+2068 … U+2069; here they are shown bare.

**The learning stance.** The English "I know my job. I don't know your team yet. Teach me as we go?" is right in spirit, but a literal Persian «یادم بده» from a new colleague sounds like a trainee asking to be taught the job. The Persian shape is the respected newcomer: the skill is stated first and flat («کارم رو بلدم»), and what is left to learn is the team's «راه و رسم» (its ways), which even the most senior person learns on arrival. Lines never apologise for not knowing, never count what is learned and never suggest the person owes teaching. New lint rows for this are in section D.

**Plural you.** In growth titles, "you" is the team: plural verbs («می‌چینید») and «شماها» in the tab name. The spoken plural «شماها» can never be read as the formal شما. Hints and bubbles speak to one person: تو, «تیمت».

| Key | Voice | FA | Variants | Note |
|---|---|---|---|---|
| `growth.name` | system | «آموخته‌ها» | | Plain, not "achievements", no score |
| `growth.tab` | pet | «از شماها یاد گرفتم» | | Credits the team, as the intent asks |
| `growth.intro` | pet | «کارم رو بلدم؛ راه و رسم تیمت رو هنوز نه. کم‌کم نشونم می‌دی؟» | v2 «کارم رو بلدم. حالا نوبت اینه که ببینم این تیم چطور کار می‌کنه.» (no question, for people who skipped the first) | **Flag**, see above. «نشونم می‌دی» (show me) is peer-to-peer; «یادم بده» is teacher-pupil |
| `growth.confirm.ask` | pet | «اینو توی دفترم بنویسم: «{title}»؟» | v2 «این همونیه که می‌خواستم یاد بگیرم: «{title}»؟» | **Flag:** "Keep this as {title}" would embed a first-person sentence as a noun; quoting it after a colon reads cleanly for any title |
| `growth.confirm.yes` | person | «آره، همینه» | | |
| `growth.confirm.no` | person | «نه، این نه» | | Proposed follow-up bubble (pet): «باشه، فقط یادم می‌مونه.» so the person knows the memory itself was still saved |
| `growth.lit.chip` | system | «یک آموختهٔ تازه ثبت شد» | | No number |
| `growth.why.taught` | system | «وقتی کسی این را به {name} یاد داد، روشن شد.» | | «کسی», never a name |
| `growth.why.taughtMine` | system | «وقتی شما این را به {name} یاد دادید، روشن شد.» | | |
| `growth.why.task` | system | «اولین باری که {name} این کار را با تیمتان انجام داد، روشن شد.» | | |
| `growth.why.access` | system | «وقتی {name} دسترسی‌ای را که لازم داشت گرفت، روشن شد.» | | |
| `growth.why.accessMine` | system | «وقتی شما این اجازه را به {name} دادید، روشن شد.» | | |
| `growth.why.room` | system | «اولین باری که به این اتاق سر زدید، روشن شد.» | | |
| `growth.why.season` | system | «اولین باری که کسی این جشن را با {name} گرفت، روشن شد.» | | «جشن گرفتن» is the verb |
| `growth.room.title` | pet | «{room} رو با هم کشف کردیم» | | **Flag:** `{room}` comes in system spelling («خانه») inside a pet line, and "found the Home" is odd for the room everyone starts in. «کشف کردیم» fits every room including the book; I suggest no room moment for Home |
| `growth.season.title` | pet | «{festival} رو با هم جشن گرفتیم» | | `{festival}` should be «شب یلدا»، «چهارشنبه‌سوری»، «نوروز» |
| `growth.stage.ready` | pet | «آماده‌ام تیمت رو بشناسم!» | v2 «کلی چیز تازه تو راهه!» | Anticipation about the team, not a lack in itself |
| `growth.stage.learned` | pet | «ببین تا حالا چی یاد گرفتم!» | v2 «یه سر به دفترم بزن، کلی چیز یاد گرفتم!» | |
| `growth.unlit.label` | system | «هنوز در راه» | | Neutral and hopeful; «یاد نگرفته» would read as a failing mark |
| `growth.settings.curiosity` | system | «سؤال‌های کنجکاوانه» | | |
| `growth.settings.curiosityBody` | system | «{name} ممکن است روزی یک سؤال کوتاه بپرسد تا با شیوهٔ کار تیمتان آشنا شود. هر وقت بخواهید، می‌توانید خاموشش کنید.» | | States the cap (PRIV-028) |
| `growth.example.title.1` | pet | «یاد گرفتم برنامهٔ انتشار نسخه رو چطور می‌چینید» | | «برنامه چیدن» is the native collocation; «ریلیز» is common in Iranian tech teams but the drafter should prefer Persian when one exists |
| `growth.example.hint.1` | pet | «بهم بگو تیمت برنامهٔ انتشار نسخه رو چطور می‌چینه، بعد بگو «یادت باشه».» | | «یادت باشه» is a supported trigger (`src/lib/circles/note-selector.ts:39`) |
| `growth.example.title.2` | pet | «اولین گزارش هفتگی‌مون رو با هم نوشتیم» | | **Flag:** "I wrote … together" contradicts itself; Persian says "we wrote" |
| `growth.example.title.3` | pet | «دسترسی تقویم تیم رو گرفتم؛ حالا برنامه‌ها دستمه» | | «دستمه» = I have a handle on it |
| `perm.P3b.title` | system | «برای گفتگوی راحت‌تر، میکروفون روشن بماند؟» | | Reason first |
| `perm.P3b.body` | system | «با «میکروفون باز» لازم نیست دکمه را نگه دارید: {name} به صدای شما گوش می‌دهد و وقتی حرفتان تمام شد، آن را می‌فرستد. میکروفون روشن می‌ماند تا خودتان خاموشش کنید، {name} را ببندید یا یک دقیقه چیزی نگویید. صدای شما فقط وقتی حرف می‌زنید از گوشی بیرون می‌رود.» | | Keeps every fact in the English |
| `perm.P3b.yes` | system | «بله، روشن بماند» | | Echoes the title's verb |
| `perm.P3b.no` | system | «فعلاً نه» | | If the fallback must be named: «با نگه داشتن دکمه». Pet line after decline (proposed): «باشه، دکمه رو نگه دار و بگو.» |
| `voice.handsFree` | system | «میکروفون باز» | | **Flag:** do not translate "Hands-free": «هندزفری» means earphones in Iran. «میکروفون باز» says what it does, which is also the honest privacy framing |
| `voice.listening` | system | «در حال شنیدن» | | The pet may add its own bubble in this state: «گوشم با توئه.» |
| `voice.autoOff` | system | «میکروفون باز خاموش شد. برای روشن کردن بزنید.» | | Neutral; no reason given, no blame for the silence |
| `voice.unavailable` | system | «میکروفون باز اینجا کار نمی‌کند. با نگه داشتن دکمه حرف بزنید.» | | |

