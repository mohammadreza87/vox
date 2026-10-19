# Studio voice messages / پیام صوتی استودیو

## English

Ask an agent to “send a voice message” or “با ویس جواب بده”. Explicit requests for voice or text take precedence over the routing classifier. Incoming voice messages get voice replies unless the speaker asks for text. If audio generation or delivery fails, the bot labels its response as text; conversation history records that fallback. A failed transcript after successful audio delivery does not resend the voice or report that the audio failed.

Voice replies also work in registered groups that allow voice messages. Mention the agent or reply to it when requesting speech. If someone sends a voice request and then a separate `@bot_username` or full agent name, that mention keeps the same speaker’s immediately preceding, unanswered delivery preference for up to two minutes. It does not copy preferences across people, chats, answered turns or intervening messages. A new explicit text request takes precedence. The agent’s capability instructions distinguish a text turn from an inability to send audio, and override older incorrect claims about voice availability.

### Models and languages

Telegram voice messages use **Eleven v4** (`eleven_v4`) by default, supporting English, Persian and Vietnamese among its languages. `ELEVENLABS_TTS_MODEL` is an optional server override. The voice picker reads the connected account’s model catalogue and labels Persian support from the provider’s language list.

| Model | Persian | Use in this release |
| --- | --- | --- |
| Eleven v4 | Yes | Default for Telegram voice messages and voice previews |
| Eleven v4 Turbo | Yes | Listed as a real-time model; not selected by this change |
| Eleven v3 / v3 Conversational | Yes | Listed alternatives |
| Multilingual v2 / Flash v2.5 | No | Earlier models; unsuitable for Persian speech |

The model determines supported languages; the selected voice influences accent and character. Language support does not establish a native Tehrani accent. The separate live-call configuration is unchanged by this release and is not qualified here for Persian.

Sources: [ElevenLabs models](https://elevenlabs.io/docs/overview/models), [v4 speech endpoint support](https://elevenlabs.io/docs/eleven-creative/playground/text-to-speech), [Voice Design API](https://elevenlabs.io/docs/api-reference/text-to-voice/design). Voice Design now uses `eleven_ttv_v3` instead of `eleven_multilingual_ttv_v2`; no paid design generation was needed to verify the message-delivery fix.

### Choosing a voice

Studio offers provider-listed built-in voices, Voice Design, and the Voice Library. Male, female and neutral choices are available. Library searches start with the persona's primary language when recognized; English, Persian (فارسی) and Vietnamese (Tiếng Việt) have visible shortcuts, alongside all provider-listed languages. Voice samples use the selected English, Persian or Vietnamese language. Library results retain their actual language, category and accent; a generated voice labelled Persian is not presented as a native recording. Listen before choosing a voice.

The free plan cannot use Voice Library voices through the API. Studio shows the plan restriction before selection and offers built-in choices. Existing voice selections are never silently replaced. Provider payment, permission, quota and availability errors produce readable messages without exposing provider request bodies or credentials. [Library access](https://elevenlabs.io/docs/eleven-creative/voices/voice-library), [language labels](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/which-voices-in-the-voice-library-are-native-to-a-specific-language).

On 19 October 2026, account checks returned Starter access and 21 built-in voices: 13 male, 7 female and 1 neutral. Library searches returned male and female results for English, Persian and Vietnamese. Examples include Andrew and Sandra (English), Farshad and Roya (Persian), and TuHau and Ari (Vietnamese). These are discoverable options, not an independently auditioned ranking. Neda retained Melania. Short synthetic Persian/English and Vietnamese Melania samples and an English George sample returned MP3 audio with v4 after the account upgrade. This verifies provider synthesis, not a native-accent benchmark or delivery/playback in Telegram.

### OpenAI and keeping the same voice

OpenAI supports Persian TTS, but an ElevenLabs voice ID cannot be passed to OpenAI. Using a recorded custom voice there requires eligible account access and matching consent/reference recordings from the voice actor. OpenAI’s prompt-generated voices are currently for GPT-Live, not the speech endpoint. Studio keeps ElevenLabs for Neda’s Melania voice; this release does not migrate or clone it. [OpenAI speech](https://developers.openai.com/api/docs/guides/text-to-speech), [custom voices](https://developers.openai.com/api/docs/guides/custom-voices).

## فارسی

برای گرفتن پیام صوتی، از عامل بخواهید «با ویس جواب بده». درخواست صریح صوت یا متن بر تصمیم دسته‌بند اولویت دارد. پیام صوتی ورودی هم با صوت پاسخ داده می‌شود، مگر اینکه گوینده متن بخواهد. اگر ساخت یا ارسال صوت شکست بخورد، عامل روشن می‌گوید که پاسخ فعلاً متنی است و همین وضعیت در سابقهٔ گفتگو ثبت می‌شود. شکست ارسال متنِ همراهِ صوت باعث ارسال دوبارهٔ صوت یا اعلام اشتباه شکست آن نمی‌شود.

پاسخ صوتی در گروه‌های ثبت‌شده‌ای که ارسال ویس را مجاز می‌دانند هم فعال است. هنگام درخواست، عامل را منشن کنید یا به پیامش پاسخ بدهید. اگر همان شخص ابتدا درخواست صوت بدهد و بلافاصله در پیام جداگانه فقط نام کامل عامل یا `@bot_username` را بفرستد، ترجیح صوت یا متنِ درخواست بی‌پاسخ قبلی تا دو دقیقه حفظ می‌شود. این ترجیح بین اشخاص، گفتگوها، نوبت‌های پاسخ‌داده‌شده یا پیام‌های واسطه منتقل نمی‌شود و درخواست صریح جدید برای متن اولویت دارد. متنی بودن یک نوبت به معنی ناتوانی عامل در ارسال صوت نیست و ادعاهای اشتباه قبلی دربارهٔ این قابلیت نباید تکرار شوند.

مدل پیش‌فرض پیام‌های صوتی تلگرام و نمونهٔ صدا **Eleven v4** است که انگلیسی، فارسی و ویتنامی را در کنار زبان‌های دیگر پشتیبانی می‌کند. v4 Turbo، v3 و v3 Conversational نیز در فهرست مدل‌ها با پشتیبانی فارسی مشخص می‌شوند؛ Multilingual v2 و Flash v2.5 فارسی را پشتیبانی نمی‌کنند. مدل زبان‌ها را تعیین می‌کند، ولی صدا روی لهجه و شخصیت اثر دارد؛ پشتیبانی فارسی تضمین لهجهٔ طبیعی تهرانی نیست. تنظیمات تماس زنده در این تغییر عوض نشده و برای فارسی تأیید نشده است. طراحی صدا از مدل جدید `eleven_ttv_v3` استفاده می‌کند.

استودیو صداهای آماده، طراحی صدا و کتابخانه را برای صداهای مردانه، زنانه و خنثی نشان می‌دهد. جست‌وجو با زبان اصلی عامل آغاز می‌شود؛ انگلیسی، فارسی و ویتنامی انتخاب سریع دارند و زبان‌های دیگر هم در فهرست موجودند. نمونهٔ صدا از انتخاب همین سه زبان پیروی می‌کند. برچسب زبان، لهجه و نوع صدا از اطلاعات واقعی ارائه‌دهنده می‌آید؛ صدای تولیدشده به‌عنوان ضبط یک گویندهٔ بومی معرفی نمی‌شود. پیش از انتخاب، نمونه را گوش کنید.

طرح رایگان ElevenLabs اجازهٔ استفادهٔ API از صداهای کتابخانه را نمی‌دهد. استودیو این محدودیت را نشان می‌دهد و صداهای آماده را پیشنهاد می‌کند؛ صدای فعلی خودکار عوض نمی‌شود. در بررسی ۱۹ اکتبر ۲۰۲۶، حساب ارتقایافتهٔ Starter و ۲۱ صدای آماده شامل ۱۳ مردانه، ۷ زنانه و یک خنثی در دسترس بودند. جست‌وجوی کتابخانه برای هر سه زبان انگلیسی، فارسی و ویتنامی نتایج مردانه و زنانه داشت؛ برای نمونه Andrew و Sandra، فرشاد و رؤیا، و TuHau و Ari. این فهرست رتبه‌بندی کیفی نیست. صدای ندا همان Melania ماند و تولید نمونهٔ کوتاه فارسی/انگلیسی و ویتنامی آن، و نمونهٔ انگلیسی George با v4 موفق شد. این نتیجه تأیید تولید صوت توسط سرویس است، نه ارزیابی لهجه یا پخش در تلگرام.

OpenAI هم تولید گفتار فارسی دارد، ولی شناسهٔ صدای ElevenLabs در آن قابل استفاده نیست. ساخت صدای مشابه از ضبط در OpenAI به دسترسی مجاز حساب و ضبط رضایت و نمونه از همان صاحب صدا نیاز دارد. صداهای ساخته‌شده با توضیح متنی OpenAI فعلاً مخصوص GPT-Live هستند. این نسخه صدای Melania را منتقل یا شبیه‌سازی نمی‌کند.
