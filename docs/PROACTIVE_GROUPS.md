# Group participation / مشارکت در گروه‌ها

## English

### Agent settings

Open an agent → **Manage** → **Group replies**. The creator and people with access-management permission can change these settings. Everyone who can view the agent can see its current reply mode and remembering status. Settings apply to this agent across its groups; each group's context stays separate.

| Mode | Behavior |
| --- | --- |
| **Mentions only** | Reply to mentions and direct replies. |
| **Balanced** (default) | Join when a useful contribution is clear. |
| **Active** | Join relevant conversations more often. |

All modes can follow messages Telegram delivers, including messages the agent does not answer. The mode controls reply frequency; choosing Mentions only does not stop context observation or clear conversation history. Balanced and Active are selective and do not promise a reply to every message.

In Balanced and Active, with observation on, the person the agent just answered keeps its attention: their next typed message within 3 minutes is answered as a reply while nobody else, person or agent, has spoken since, unless it is aimed elsewhere (a reply to or mention of a person or another bot, or another agent of the group by name). This follow-up is inferred, not explicit, so Mentions only, observation off and `STUDIO_GROUP_OBSERVATION=off` never use it; a voice note still needs a mention or reply, and a spontaneous contribution never opens one. A message the classifier judges clearly meant for the agent is answered as a reply too. Each message gets at most one agent's inferred reply.

**Remember useful group facts** is a separate switch, enabled by default. When enabled, useful facts can become durable group memories even when the agent stays silent. Turning it off stops new group memories; recent conversation context and existing memories remain. Use the memory controls to delete existing memories.

Useful group facts remain scoped to their originating group. This setting does not share private chats, automatically export facts to other groups, or create a shared memory vault for other agents. Any separate, explicitly approved sharing retains its own audience rules. Following messages and saving durable memories are different operations: switching remembering off does not stop processing recent conversation context.

Current audience checks also apply: an unknown group audience receives only the current exchange, with no stored memory or prior history sent to the model. Where no history is stored (an unknown audience, or history off), the agent also sees up to the last 8 lines visible in that chat from the past 15 minutes: held in the running process only, never stored, extracted into memory or put in another agent's prompt, and emptied when the audience changes (including a changed or unreadable member count), the agent leaves or is removed, sharing changes or its history is forgotten. When the audience is known, prior group history must carry the group-policy stamp; both history and memories must authorize every current reader. Direct mentions still require these checks; they only bypass the spontaneous-reply budget.

### Let Telegram deliver ordinary messages

For participation without a mention, the agent must receive ordinary group messages. Either:

1. Open [BotFather](https://t.me/BotFather), select the bot, disable **Group Privacy** (`/setprivacy` → **Disable**), then remove the bot from the group and add it again; or
2. Have a group administrator make the bot a group admin.

These settings do not change Telegram permissions automatically. A bot's creator can manage it through BotFather, including a bot created through a manager. Telegram's managed-bot access API controls which users can access a bot; it does not disable Group Privacy. Suggested default administrator rights do not grant administrator status. See [Telegram privacy mode](https://core.telegram.org/bots/features#privacy-mode) and [managed-bot access settings](https://core.telegram.org/bots/api#setmanagedbotaccesssettings).

### Limits and verification

Spontaneous replies share a budget across all agents in the same group:

| Mode of the agent considering a reply | Minimum gap between spontaneous reply claims | Maximum claims in the group's 5-minute window |
| --- | --- | --- |
| **Balanced** | 45 seconds | 3 |
| **Active** | 20 seconds | 6 |

The fixed window starts with its first claimed reply. A group with different agent modes still shares one timer and counter; the candidate agent's mode determines which limit is checked. A slot is claimed before generation, so a failed generation or send may consume it. Explicit name/username mentions and replies to the agent's own messages bypass this spontaneous-reply budget; access checks and other service limits still apply. A message the classifier judges clearly meant for the agent, and a follow-up from the person it just answered, are replies and bypass this budget; useful unsolicited contributions still use it.

Group memory persists a receipt window covering **256 message IDs** per agent in each group, plus a retired-ID floor. Distinct eligible events delivered out of order within that window can each receive one extraction attempt. Receipts are recorded **before** extraction, so duplicate deliveries, failed attempts and receipts for deleted memories remain closed after a restart. Ancient message IDs at or below the retired floor are deliberately skipped even if previously unseen. A useful fact can therefore be missed on failure or very late delivery; deleting a memory does not reopen its message receipt or automatically reimport that fact.

Operators can set `STUDIO_GROUP_OBSERVATION=off` to disable passive group observation and spontaneous participation. This switch does not disable explicitly addressed requests (a mention, the agent's name or a reply to its message), erase existing history or memories, or disable remembering for direct exchanges. The per-agent remembering switch still applies. Inferred follow-ups and classifier-addressed messages stop with it.

Automatic participation uses OpenAI Decisions to evaluate whether a contribution is useful. It still depends on Telegram delivery, provider access, response time and application limits. An unavailable decision service must not turn every group message into a reply. A single short synthetic account check on **19 October 2026** succeeded with `gpt-6-luna`: HTTP200, predicate and choice answers parsed, **436ms** total, within the current 2-second triage budget. [OpenAI Decisions contract](https://developers.openai.com/api/reference/resources/decisions/methods/create)

Six later synthetic cases exercised the new personality-aware questions. All returned HTTP200 and parsed within 2 seconds. Candidate decisions below precede permission checks and shared throttling; probabilities are not guarantees.

| Synthetic case | Addressed probability | Useful unsolicited contribution probability | Latency | Candidate behavior |
| --- | --- | --- | --- | --- |
| English contextual question | 1.00 | 0.67 | 847ms | Reply in both modes |
| Persian contextual question | 1.00 | 0.98 | 278ms | Reply in both modes |
| Open question, warm companion | 0.65 | 0.85 | 402ms | Balanced quiet; Active reply |
| Same question, reserved reviewer | 0.04 | 0.19 | 232ms | Quiet in both modes |
| Persian conversation between people | 0.00 | 0.01 | 253ms | Quiet in both modes |
| Repeated English greeting | 0.00 | 0.00 | 273ms | Quiet in both modes |

The warm open question did not meet the expected Balanced participation outcome: its usefulness probability was below the 0.90 threshold, while it passed Active's 0.80 threshold. This is conservative behavior on one example, not evidence to tune thresholds. The between-people case was silent but received a remembering probability of 0.96; durable-memory quality requires separate evaluation.

These probes used no user transcripts. They establish bounded provider access and response-shape observations only; they are not a latency distribution, group-conversation quality evaluation, Telegram end-to-end test or proof of deployment. This document does not claim the feature is live. Release acceptance must separately verify a real group's delivery permissions, selective replies, silent remembering, memory isolation, failure recovery and the exact served revision.

This release targets the Mac Studio polling runtime, which processes each bot’s updates serially. Concurrent webhook memory writes are not fully qualified: two simultaneous corrections to the same author/topic can leave conflicting active records because memory replacement is not an atomic ordered write. The receipt window prevents duplicate extraction claims; it does not promise atomic ordered memory updates. Do not use this release report as Firebase/webhook qualification.

### Circles: joining a group's notes (pilot, off by default)

Circles let people in a group choose **Join · 18+**, **Only reply to me** or **Not me** for a public Vox agent, and keep explicit notes. They run only with `STUDIO_CIRCLES=circles`, in chats on `STUDIO_CIRCLE_CHATS`, and only after a host adds the agent. Privacy rules and card copy are in [PRIVACY_AND_CONSENT.md](implementation/PRIVACY_AND_CONSENT.md) (UX-16, UX-17).

- **Cap:** at most 12 people can join one group's notes. Notes are used in the group only while every human reading it has joined; other bots count as readers.
- **Leaves:** Vox bots join as non-admins, so Telegram does not send them member updates. A leave is seen on the next service message or the next membership check during a turn. Until then the group fails closed: notes stay off when the count cannot be confirmed.
- **Safe mode needs ordinary messages:** the RAM-only window (8 lines, 15 minutes) sees unaddressed lines only when **Group Privacy** is disabled or the bot is a group admin (see above). Otherwise it sees only mentions and replies; behaviour stays correct, just less fluent.
- **Notifications are Telegram-native:** cards, welcomes, save proposals and confirmations are quiet messages, and counters change by edits, which never notify. Only "Everyone's in" notifies, at most once a day. Each person's own Telegram mute settings control the rest; Vox asks for no notification permission. A group save also reaches each joined member as a quiet DM ("📌 Saved from <group>: …").
- **Pet in the group:** after a one-time BotFather setup of a Main Mini App on the Vox manager bot, the card's **Details & pet 🐾** button opens each person's own pet over the group chat. Until then it opens the agent's DM.
- **Channels are post-only:** with `STUDIO_CIRCLES=circles`, someone who can manage a public agent gets **Add to a channel** next to Add to group (Telegram asks for posting rights). Only a channel added by an approved member who may use the agent is recorded; if anyone else adds it, the bot leaves at once. Vox never subscribes to channel posts and stores nothing from the channel. To post, a member who may use the agent sends `/post <text or brief>` to the agent, or opens the agent in Studio and uses Groups > Post to channels. The agent drafts from its character alone (no memories, no notes), the member sees a preview with **Post**, **Edit** and **Cancel**, and nothing is sent before Post. Posts notify subscribers unless the member turns notification off. Each post has a **Meet <agent> 🐾** button that opens the agent's DM card. If the channel has a comments group, Studio offers to add the agent there too; group rules apply in it. An agent can be in at most 5 channels. Studio shows a channel where the agent lacks posting rights. If Telegram refuses a post, the same preview can be posted again. A draft keeps no text and lasts 30 minutes; "forget me" and rights erasure delete a person's drafts. A channel the agent leaves or is removed from is dropped even while Circles is off.

## فارسی

بررسی مخاطبان فعلی نیز اعمال می‌شود: اگر مخاطبان گروه نامعلوم باشند، فقط گفت‌وگوی جاری به مدل می‌رسد و حافظهٔ ذخیره‌شده یا تاریخچهٔ قبلی ارسال نمی‌شود. برای مخاطبان معلوم، تاریخچهٔ قبلی گروه باید نشان سیاست گروه را داشته باشد؛ همهٔ خوانندگان فعلی باید برای تاریخچه و حافظه‌ها مجاز باشند. خطاب مستقیم نیز این بررسی‌ها را دور نمی‌زند؛ فقط از بودجهٔ پاسخ خودجوش مستثناست. جایی که تاریخچه ذخیره نمی‌شود (مخاطبان نامعلوم یا تاریخچهٔ خاموش)، عامل حداکثر ۸ خط آخرِ قابل‌دیدن همان گفت‌وگو از ۱۵ دقیقهٔ گذشته را هم می‌بیند: فقط در حافظهٔ برنامهٔ در حال اجرا، بدون ذخیره، بدون استخراج به حافظه و بدون رسیدن به درخواست عامل دیگر؛ و با تغییر مخاطبان (از جمله تغییر یا ناخوانا بودن تعداد اعضا)، خروج یا حذف عامل، تغییر اشتراک‌گذاری یا فراموش کردن تاریخچه‌اش خالی می‌شود.

### تنظیمات عامل

صفحهٔ عامل را باز کنید ← **Manage / مدیریت** ← **Group replies / پاسخ در گروه**. سازنده و افرادی که اجازهٔ مدیریت دسترسی دارند می‌توانند این تنظیمات را تغییر دهند. همهٔ کسانی که عامل را می‌بینند، حالت پاسخ و وضعیت یادسپاری آن را هم می‌بینند. این تنظیمات برای همین عامل در همهٔ گروه‌هایش اعمال می‌شود؛ زمینهٔ گفت‌وگوی هر گروه جدا می‌ماند.

| حالت | رفتار |
| --- | --- |
| **Mentions only / فقط هنگام خطاب** | به منشن‌ها و پاسخ‌های مستقیم جواب می‌دهد. |
| **Balanced / متعادل** (پیش‌فرض) | وقتی مشارکت مفیدی روشن باشد، وارد گفت‌وگو می‌شود. |
| **Active / فعال** | بیشتر در گفت‌وگوهای مرتبط مشارکت می‌کند. |

در همهٔ حالت‌ها، عامل می‌تواند پیام‌هایی را که تلگرام تحویل می‌دهد دنبال کند؛ حتی پیام‌هایی که به آن‌ها جواب نمی‌دهد. انتخاب حالت فقط میزان پاسخ‌گویی را تغییر می‌دهد. حالت «فقط هنگام خطاب» مشاهدهٔ زمینه را متوقف یا تاریخچهٔ گفت‌وگو را پاک نمی‌کند. حالت‌های متعادل و فعال هم انتخابی هستند و قرار نیست به همهٔ پیام‌ها پاسخ دهند.

در حالت‌های متعادل و فعال، وقتی مشاهده روشن است، کسی که عامل همین الان به او جواب داده توجه عامل را نگه می‌دارد: پیام تایپی بعدی او تا ۳ دقیقه، تا وقتی کس دیگری (آدم یا عامل) حرف نزده، پاسخ می‌گیرد؛ مگر پیام به سمت دیگری باشد (پاسخ یا منشن یک فرد یا ربات دیگر، یا نام عامل دیگری از همان گروه). این ادامهٔ گفت‌وگو استنباطی است نه صریح؛ پس در حالت «فقط هنگام خطاب»، با مشاهدهٔ خاموش و با `STUDIO_GROUP_OBSERVATION=off` به کار نمی‌رود. پیام صوتی همچنان منشن یا پاسخ لازم دارد و مشارکت خودجوش هرگز آن را باز نمی‌کند. پیامی که دسته‌بند به‌روشنی خطاب به عامل تشخیص دهد هم پاسخ می‌گیرد. به هر پیام حداکثر یک عامل پاسخ استنباطی می‌دهد.

کلید **Remember useful group facts / به‌خاطر سپردن نکات مفید گروه** مستقل است و پیش‌فرض روشن دارد. وقتی روشن باشد، نکات مفید می‌توانند به حافظهٔ ماندگار همان گروه تبدیل شوند؛ حتی وقتی عامل ساکت می‌ماند. خاموش کردن آن ذخیرهٔ نکات جدید گروه را متوقف می‌کند، اما زمینهٔ اخیر گفت‌وگو و حافظه‌های قبلی باقی می‌مانند. برای حذف حافظه‌های قبلی از بخش مدیریت حافظه استفاده کنید.

نکات گروه به محدودهٔ همان گروه وابسته می‌مانند. این گزینه گفت‌وگوهای خصوصی را به اشتراک نمی‌گذارد، نکات را خودکار به گروه‌های دیگر نمی‌فرستد و برای عامل‌های دیگر مخزن حافظهٔ مشترک نمی‌سازد. اشتراک‌گذاری جداگانه‌ای که صریحاً تأیید شده باشد همچنان تابع مخاطبان مجاز خودش است. دنبال کردن پیام‌ها با ذخیرهٔ حافظهٔ ماندگار فرق دارد؛ خاموش کردن یادسپاری، پردازش زمینهٔ اخیر گفت‌وگو را متوقف نمی‌کند.

### دریافت پیام‌های معمولی از تلگرام

برای مشارکت بدون منشن، عامل باید پیام‌های معمولی گروه را دریافت کند. یکی از این دو راه لازم است:

1. در [BotFather](https://t.me/BotFather)، ربات را انتخاب و **Group Privacy / حریم خصوصی گروه** را غیرفعال کنید (`/setprivacy` سپس **Disable**). بعد ربات را از گروه حذف و دوباره اضافه کنید؛ یا
2. یکی از مدیران گروه، ربات را مدیر گروه کند.

این تنظیمات اجازه‌های تلگرام را خودکار تغییر نمی‌دهند. سازندهٔ ربات می‌تواند آن را از طریق BotFather مدیریت کند؛ این موضوع برای رباتی که از طریق ربات مدیر ساخته شده هم صدق می‌کند. API دسترسی ربات‌های مدیریت‌شده فقط مشخص می‌کند چه کاربرانی به ربات دسترسی دارند؛ حریم خصوصی گروه را غیرفعال نمی‌کند. پیشنهاد اجازه‌های پیش‌فرض مدیریت هم به‌تنهایی ربات را مدیر نمی‌کند. [مستندات حریم خصوصی تلگرام](https://core.telegram.org/bots/features#privacy-mode) و [تنظیمات دسترسی ربات مدیریت‌شده](https://core.telegram.org/bots/api#setmanagedbotaccesssettings)

### محدودیت‌ها و شواهد بررسی

بودجهٔ پاسخ‌های خودجوش بین همهٔ عامل‌های یک گروه مشترک است:

| حالت عاملی که می‌خواهد پاسخ دهد | حداقل فاصله بین رزرو نوبت‌های پاسخ خودجوش | حداکثر نوبت‌های رزروشده در بازهٔ ۵ دقیقه‌ای گروه |
| --- | --- | --- |
| **Balanced / متعادل** | ۴۵ ثانیه | ۳ |
| **Active / فعال** | ۲۰ ثانیه | ۶ |

بازهٔ ثابت با اولین نوبت رزروشده شروع می‌شود. حتی اگر عامل‌های یک گروه حالت‌های متفاوتی داشته باشند، زمان‌سنج و شمارنده مشترک است؛ حد مجاز با حالت عاملی که می‌خواهد پاسخ دهد بررسی می‌شود. نوبت پیش از تولید پاسخ رزرو می‌شود، پس خطای تولید یا ارسال هم ممکن است آن را مصرف کند. خطاب صریح با نام یا نام کاربری عامل و پاسخ به پیام خود عامل از این بودجهٔ خودجوش عبور می‌کند؛ بررسی دسترسی و سایر محدودیت‌های سرویس همچنان برقرار است. پیامی که دسته‌بند به‌روشنی خطاب به عامل تشخیص دهد و ادامهٔ گفت‌وگوی کسی که عامل همین الان به او جواب داده، پاسخ به حساب می‌آیند و از این بودجه عبور می‌کنند؛ مشارکت‌های خودجوش مفید همچنان از بودجهٔ مشترک استفاده می‌کنند.

حافظهٔ گروه برای هر عامل در هر گروه، پنجرهٔ رسیدی شامل **۲۵۶ شناسهٔ پیام** و یک کف برای شناسه‌های بازنشسته را ذخیره می‌کند. رویدادهای واجد شرایط و متمایزی که خارج از ترتیب اما در همین پنجره برسند، هرکدام می‌توانند یک بار وارد تلاش استخراج شوند. رسید **پیش از** استخراج ثبت می‌شود؛ بنابراین تحویل تکراری، تلاش ناموفق و رسید مربوط به حافظهٔ حذف‌شده پس از راه‌اندازی مجدد هم بسته می‌مانند. پیام بسیار قدیمی با شناسهٔ برابر یا پایین‌تر از کف بازنشسته، حتی اگر قبلاً دیده نشده باشد، عمداً کنار گذاشته می‌شود. در نتیجه خطا یا تحویل بسیار دیرهنگام می‌تواند باعث از دست رفتن نکته‌ای مفید شود؛ حذف حافظه رسید پیام آن را دوباره باز نمی‌کند و باعث ورود خودکار دوبارهٔ همان نکته نمی‌شود.

اپراتور می‌تواند با `STUDIO_GROUP_OBSERVATION=off` مشاهدهٔ منفعل پیام‌های گروه و مشارکت خودجوش را غیرفعال کند. این کلید درخواست‌های صریحاً خطاب‌شده (منشن، نام عامل یا پاسخ به پیام آن) را متوقف نمی‌کند، تاریخچه یا حافظهٔ موجود را پاک نمی‌کند و یادسپاری در گفت‌وگوهای مستقیم را خاموش نمی‌کند. کلید یادسپاری مستقل هر عامل همچنان اعمال می‌شود. ادامهٔ گفت‌وگوی استنباطی و پیام‌های خطاب‌شده از نگاه دسته‌بند با این کلید متوقف می‌شوند.

مشارکت خودکار از OpenAI Decisions برای ارزیابی مفید بودن یک پاسخ استفاده می‌کند و به تحویل پیام از تلگرام، دسترسی به سرویس، زمان پاسخ و محدودیت‌های برنامه وابسته است. قطع بودن سرویس تصمیم‌گیری نباید باعث پاسخ دادن به همهٔ پیام‌های گروه شود. یک بررسی کوتاه با ورودی ساختگی در **۱۹ اکتبر ۲۰۲۶** با مدل `gpt-6-luna` موفق بود: HTTP200، پاسخ‌های شرطی و انتخابی قابل‌خواندن و زمان کل **۴۳۶ میلی‌ثانیه**، کمتر از مهلت فعلی ۲ ثانیه. [قرارداد OpenAI Decisions](https://developers.openai.com/api/reference/resources/decisions/methods/create)

شش ورودی ساختگی دیگر پرسش‌های جدید وابسته به شخصیت را بررسی کردند. همه با HTTP200 و در کمتر از ۲ ثانیه پاسخ قابل‌خواندن دادند. تصمیم‌های احتمالی جدول پیش از بررسی دسترسی و محدودیت مشترک گروه هستند؛ این احتمال‌ها تضمین نیستند.

| ورودی ساختگی | احتمال خطاب به عامل | احتمال مفید بودن مشارکت خودجوش | زمان پاسخ | رفتار احتمالی |
| --- | --- | --- | --- | --- |
| پرسش انگلیسی وابسته به زمینه | ۱٫۰۰ | ۰٫۶۷ | ۸۴۷ میلی‌ثانیه | پاسخ در هر دو حالت |
| پرسش فارسی وابسته به زمینه | ۱٫۰۰ | ۰٫۹۸ | ۲۷۸ میلی‌ثانیه | پاسخ در هر دو حالت |
| پرسش باز، همراه صمیمی | ۰٫۶۵ | ۰٫۸۵ | ۴۰۲ میلی‌ثانیه | متعادل: سکوت؛ فعال: پاسخ |
| همان پرسش، بررسی‌کنندهٔ کم‌حرف | ۰٫۰۴ | ۰٫۱۹ | ۲۳۲ میلی‌ثانیه | سکوت در هر دو حالت |
| گفت‌وگوی فارسی بین افراد | ۰٫۰۰ | ۰٫۰۱ | ۲۵۳ میلی‌ثانیه | سکوت در هر دو حالت |
| سلام تکراری انگلیسی | ۰٫۰۰ | ۰٫۰۰ | ۲۷۳ میلی‌ثانیه | سکوت در هر دو حالت |

پرسش باز برای همراه صمیمی به نتیجهٔ مورد انتظار در حالت متعادل نرسید: احتمال مفید بودن از آستانهٔ ۰٫۹۰ کمتر بود، اما از آستانهٔ ۰٫۸۰ حالت فعال عبور کرد. این فقط رفتار محافظه‌کارانه در یک نمونه است، نه دلیل کافی برای تغییر آستانه‌ها. نمونهٔ گفت‌وگوی بین افراد با وجود سکوت، احتمال یادسپاری ۰٫۹۶ گرفت؛ کیفیت حافظهٔ ماندگار به ارزیابی جداگانه نیاز دارد.

در این بررسی‌ها از متن گفت‌وگوی کاربران استفاده نشد. نتیجه فقط شواهد محدود دسترسی به سرویس و ساختار پاسخ را نشان می‌دهد؛ توزیع تأخیر، کیفیت گفت‌وگوی گروهی، آزمون سرتاسری تلگرام یا انتشار روی محیط عملیاتی را ثابت نمی‌کند. این سند ادعا نمی‌کند قابلیت منتشر شده است. پذیرش انتشار باید دریافت واقعی پیام‌های یک گروه، پاسخ‌گویی انتخابی، یادسپاری در حالت سکوت، جداسازی حافظه، بازیابی پس از خطا و نسخهٔ دقیق در حال سرویس‌دهی را جداگانه بررسی کند.

هدف این انتشار، اجرای polling روی Mac Studio است که پیام‌های هر ربات را به‌ترتیب پردازش می‌کند. نوشتن هم‌زمان حافظه در اجرای webhook هنوز به‌طور کامل تأیید نشده است: دو اصلاح هم‌زمان از یک گوینده دربارهٔ یک موضوع ممکن است رکوردهای فعال متناقض باقی بگذارند، چون جایگزینی حافظه یک نوشتن اتمی و مرتب نیست. پنجرهٔ رسید، درخواست تکراری استخراج را محدود می‌کند؛ تضمین به‌روزرسانی اتمی و مرتب حافظه نمی‌دهد. این گزارش، تأیید اجرای Firebase یا webhook نیست.

### حلقه‌ها: پیوستن به یادداشت‌های گروه (آزمایشی، پیش‌فرض خاموش)

با حلقه‌ها، افراد یک گروه برای یک عامل عمومی Vox یکی از **می‌پیوندم · ۱۸+**، **فقط به من جواب بده** یا **مرا حساب نکن** را انتخاب می‌کنند و یادداشت‌های صریح نگه داشته می‌شوند. این قابلیت فقط با `STUDIO_CIRCLES=circles`، در گفت‌وگوهای فهرست `STUDIO_CIRCLE_CHATS` و فقط پس از اضافه شدن عامل توسط میزبان کار می‌کند. قواعد حریم خصوصی و متن کارت‌ها در [PRIVACY_AND_CONSENT.md](implementation/PRIVACY_AND_CONSENT.md) (UX-16 و UX-17) آمده است.

- **سقف:** حداکثر ۱۲ نفر می‌توانند به یادداشت‌های یک گروه بپیوندند. یادداشت‌ها در گروه فقط وقتی به کار می‌روند که همهٔ انسان‌هایی که گروه را می‌خوانند پیوسته باشند؛ ربات‌های دیگر هم خواننده حساب می‌شوند.
- **خروج اعضا:** ربات‌های Vox بدون دسترسی مدیر به گروه می‌پیوندند، پس تلگرام تغییرات اعضا را برایشان نمی‌فرستد. خروج یک نفر با پیام سرویس بعدی یا بررسی بعدی اعضا در هنگام پاسخ دیده می‌شود. تا آن موقع گروه محتاطانه عمل می‌کند: وقتی تعداد تأیید نشود، یادداشت‌ها خاموش می‌مانند.
- **حالت امن به پیام‌های معمولی نیاز دارد:** پنجرهٔ موقت در حافظهٔ برنامه (۸ خط، ۱۵ دقیقه) فقط وقتی خط‌های بدون خطاب را می‌بیند که **Group Privacy / حریم خصوصی گروه** غیرفعال باشد یا ربات مدیر گروه باشد (بالاتر را ببینید). در غیر این صورت فقط منشن‌ها و پاسخ‌ها را می‌بیند؛ رفتار درست می‌ماند، فقط روانی کمتری دارد.
- **اعلان‌ها از خود تلگرام است:** کارت‌ها، خوشامدها، پیشنهاد ذخیره و تأییدها بی‌صدا فرستاده می‌شوند و شمارنده‌ها با ویرایش تغییر می‌کنند که هرگز اعلان نمی‌دهد. فقط «همه پیوستند» اعلان می‌دهد، حداکثر روزی یک بار. بقیه را تنظیمات بی‌صدا کردن تلگرامِ خود هر فرد کنترل می‌کند؛ Vox اجازهٔ اعلان نمی‌خواهد. ذخیره در گروه به‌صورت پیام خصوصی بی‌صدا («📌 از <گروه> ذخیره شد: …») هم به هر عضو پیوسته می‌رسد.
- **پت در گروه:** پس از یک بار تنظیم Main Mini App برای ربات مدیر Vox در BotFather، دکمهٔ **جزئیات و پت 🐾** روی کارت، پت خود هر فرد را روی همان گفت‌وگوی گروه باز می‌کند. تا آن زمان، گفت‌وگوی خصوصی عامل را باز می‌کند.
- **کانال‌ها فقط برای ارسال‌اند:** با `STUDIO_CIRCLES=circles`، کسی که می‌تواند یک عامل عمومی را مدیریت کند، کنار «افزودن به گروه» گزینهٔ **افزودن به کانال** را می‌بیند (تلگرام اجازهٔ ارسال پست را می‌پرسد). فقط کانالی ثبت می‌شود که یک عضو تأییدشده با اجازهٔ استفاده از عامل اضافه کرده باشد؛ اگر کس دیگری اضافه‌اش کند، ربات فوراً خارج می‌شود. Vox هرگز پست‌های کانال را دریافت نمی‌کند و چیزی از کانال ذخیره نمی‌کند. برای ارسال، عضوی که اجازهٔ استفاده از عامل را دارد `/post <متن یا توضیح>` را به عامل می‌فرستد، یا عامل را در استودیو باز می‌کند و از گروه‌ها ← ارسال به کانال‌ها استفاده می‌کند. عامل فقط از روی شخصیت خودش پیش‌نویس می‌نویسد (نه حافظه، نه یادداشت)، عضو پیش‌نمایش را با **ارسال**، **ویرایش** و **لغو** می‌بیند و پیش از «ارسال» چیزی فرستاده نمی‌شود. پست‌ها برای مشترکان اعلان می‌دهند، مگر عضو اعلان را خاموش کند. هر پست دکمهٔ **آشنایی با <عامل> 🐾** دارد که کارت گفت‌وگوی خصوصی عامل را باز می‌کند. اگر کانال گروه نظرات داشته باشد، استودیو پیشنهاد می‌دهد عامل را آنجا هم اضافه کنید؛ قواعد گروه در آن برقرار است. هر عامل حداکثر در ۵ کانال می‌تواند باشد. استودیو کانالی را که عامل در آن اجازهٔ ارسال ندارد نشان می‌دهد. اگر تلگرام پستی را نپذیرد، همان پیش‌نمایش را می‌توان دوباره ارسال کرد. پیش‌نویس هیچ متنی نگه نمی‌دارد و ۳۰ دقیقه اعتبار دارد؛ «فراموشم کن» و درخواست حذف داده‌ها پیش‌نویس‌های فرد را پاک می‌کنند. کانالی که عامل از آن خارج یا اخراج شود، حتی وقتی Circles خاموش است، از فهرست برداشته می‌شود.
