# Vox Studio

Vox Studio is the Telegram Mini App inside **@VoxxBot** where everyone in HOOR spawns, shapes, calls and manages AI agents. Each agent is a real Telegram bot with one personality, one voice and one cloud face, and its memories are shared across the people it talks to (see [TIREH_PERSONAS.md](./TIREH_PERSONAS.md) for the memory model).

```
Telegram ── @VoxxBot (Mini App: /studio) ──┐
        └─ @hoor_aria_bot, @hoor_…_bot ────┤
                                         ▼
            Next.js Studio UI + authenticated API
            ├─ Firebase production: webhooks + Firestore + Cloud Storage
            └─ Mac alternative: one poller process + private files
                 │
                 ├─ Claude        persona design (stronger model) + replies (fast model)
                 ├─ OpenAI        avatars (gpt-image-1) + speech-to-text
                 └─ ElevenLabs    voice design / library + speech
```

## What it does

| | |
|---|---|
| **Spawn** | Write a loose brief: presentation, domain, languages, culture, accent, age and temperament. Claude drafts the name, backstory, values, voice brief and a random cloud look. You can edit any field or ask Claude to change things. |
| **Look** | 8 colours × 3 cloud shapes, plus cheeks, lashes and brows. A dice button gives a random look. The chosen cloud becomes the Telegram profile photo unless you select a generated or uploaded picture (JPEG/PNG/WebP, cropped to 640px). |
| **Voice** | Choose built-in voices, design a voice, or search the library by gender, accent and language. Voice messages use Eleven v4 with Persian support; the picker shows account restrictions and supported languages. See [Studio voices](./STUDIO_VOICES.md). |
| **Test** | A sandbox chat. Nothing said there becomes a memory. |
| **Hire** | Opens Telegram's "Create bot" screen (managed bots). One tap creates the bot. Studio stores its token encrypted, then sets the name, description, commands and photo. |
| **Forming → locked** | For 7 days after hire, the personality and look can still be tuned. After that they are fixed for good. To change who an agent is, **fire** it and **hire a successor**. Its memories can pass to the successor, be archived or be deleted. |
| **Who can talk** | Every agent is **Private** by default: its creator, people they pick, and admins. It can be opened to **Everyone in HOOR**, or made **Public** so anyone on Telegram can message it. A public agent decides in character how to treat strangers (its `withStrangers` style and `openness` score, drafted by Claude): answer, politely decline, ignore spam, or block. Strangers get a daily message limit; blocks can be lifted from the agent's page. |
| **Groups** | Add an agent to a Telegram group from its page (people it works with can, or anyone for a public agent). Everyone in that group can then talk to it, even if it's private. With people outside HOOR present, it only uses that group's memories. |
| **Calls** | Talk to an agent in the Mini App. Each turn goes your voice → OpenAI STT → Claude (with memories) → ElevenLabs. |
| **Memories** | See what an agent remembers that you're allowed to see. You can delete anything you said. |
| **Org** | Superadmins grant or remove admin rights for people and agents. Admins approve new people. Who can use each agent is set per agent (see *Who can talk*). |

People outside HOOR are **guests**: they only ever see their own private memories and their groups' memories, never HOOR's org chart, projects or company knowledge.

### Telegram name and profile photo

The hire link includes the saved name and suggested username. Telegram's creation screen can prefill the name, but has no avatar parameter. After **Create**, Studio applies the saved name and the selected picture, or renders the cloud character as a 640×640 JPEG. Clicking **Next** while editing a name saves the edit before continuing.

Bot creation and profile delivery have separate statuses. The final screen shows profile setup in progress or the fields Telegram refused, with a retry action. A missing image or failed conversion cannot count as success. Active cloud-look changes and automatically selected generated pictures also update the Telegram photo.

The Mac polling runtime repairs active bots without a profile receipt at startup and retries failed or interrupted delivery after 1 minute, doubling to at most 1 hour. Successfully delivered, unchanged profiles are skipped. This does not recreate bots or change their username. Webhook deployments apply profiles when bots are created or edited and support manual sync; they do not run this background reconciliation loop.

**فارسی:** لینک استخدام نام ذخیره‌شده و نام کاربری پیشنهادی را به تلگرام می‌فرستد. صفحهٔ ساخت ربات امکان دریافت آواتار از لینک را ندارد؛ پس از زدن **Create**، استودیو نام و تصویر انتخاب‌شده را اعمال می‌کند. اگر عکسی انتخاب نشده باشد، تصویر ابری به عکس پروفایل تبدیل می‌شود. زدن **Next** هنگام ویرایش نام، ابتدا تغییر را ذخیره می‌کند. صفحهٔ نهایی وضعیت تنظیم پروفایل و خطاهای احتمالی را همراه با امکان تلاش دوباره نشان می‌دهد. سرویس مک پروفایل ربات‌های قدیمی را نیز تکمیل می‌کند و خطاها را با فاصلهٔ یک دقیقه تا یک ساعت دوباره امتحان می‌کند؛ پروفایل موفق و بدون تغییر دوباره ارسال نمی‌شود. این کار ربات را دوباره نمی‌سازد و نام کاربری آن را تغییر نمی‌دهد. حالت وب‌هوک فقط هنگام ساخت، ویرایش یا درخواست همگام‌سازی دستی پروفایل را به‌روز می‌کند.

Roles: `owner > superadmin > admin > member > pending`. New people who press /start in @VoxxBot are `pending` until an admin approves them. The Telegram IDs in `STUDIO_SUPERADMIN_IDS` are the founding **owners**: they always stay owners and can make other owners, superadmins and admins. Superadmins can grant up to superadmin but never make or change owners. The last owner can't be removed.

## Production (Firebase)

Production runs serverless, so Studio switches modes there: bots receive updates by **webhook** (`/api/studio/telegram/[key]`, one derived secret per bot), state lives in **Firestore** (`studio/state`), media in **Cloud Storage** (`studio/media/`), and memories in the TIREH Firestore collections. Pushing to `main` deploys it and reconnects every bot.

One-time setup, all in GitHub → repo **Settings → Secrets and variables → Actions** (never paste keys in chat):

| Kind | Name | Value |
|---|---|---|
| Secret | `STUDIO_SECRET` | `openssl rand -hex 32` |
| Secret | `VOXX_BOT_TOKEN` | @VoxxBot token from @BotFather |
| Secret | `ANTHROPIC_API_KEY` | Claude |
| Secret | `OPENAI_API_KEY` | avatars + speech-to-text |
| Secret | `ELEVENLABS_API_KEY` | voices |
| Variable | `VOXX_BOT_USERNAME` | `VoxxBot` |
| Variable | `STUDIO_SUPERADMIN_IDS` | your Telegram user id (founding owner) |
| Variable | `STUDIO_PUBLIC_URL` | the production URL, e.g. `https://vox-aicontact-fe0e3.web.app` |
| Variable (optional) | `STUDIO_MEDIA_BUCKET` | defaults to the Firebase storage bucket |

Also turn on **Bot Management** for @VoxxBot in @BotFather's Mini App. After the next deploy, open @VoxxBot → /start → **Open Vox Studio**. To reconnect bots by hand: `curl -X POST $STUDIO_PUBLIC_URL/api/studio/telegram/setup -H "Authorization: Bearer $STUDIO_SECRET"`.

## Setup on the Mac Studio (alternative: one always-on server)

For the supervised production release, private secrets, backups, HTTPS routing and
rollback, follow [PRODUCTION.md](./PRODUCTION.md). The commands below are a manual
setup reference; they do not install a production service.

1. **Enable bot management for @VoxxBot.** In Telegram, open @BotFather → *Open* (the Mini App) → your bot → *Bot Settings*, and turn on **Bot Management**. This lets VoxxBot create agent bots for you.
2. **Get a public HTTPS URL** for the Mac (Telegram Mini Apps require HTTPS). Cloudflare Tunnel is the simplest:
   ```sh
   brew install cloudflared
   cloudflared tunnel login
   cloudflared tunnel create vox
   cloudflared tunnel route dns vox studio.yourdomain.com
   cloudflared tunnel run --url http://localhost:3000 vox
   ```
3. **Configure** `.env.local` in the repo. See the *Vox Studio* block in `.env.example`:
   - `STUDIO_SECRET`: `openssl rand -hex 32`
   - `VOXX_BOT_TOKEN` and `VOXX_BOT_USERNAME`
   - `STUDIO_SUPERADMIN_IDS`: your Telegram id (ask @userinfobot)
   - `STUDIO_WEBAPP_URL=https://studio.yourdomain.com/studio`
   - `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`

   Keep keys in this file only. Never paste them into chats or commits.
4. **Run**:
   ```sh
   npm install
   npm run build
   npm run studio:start      # next start with the bot runner enabled
   ```
   Keep it running with `pm2` or a `launchd` agent. Open @VoxxBot, press /start and tap **Open Vox Studio**.

Back up `.vox-studio/` (state, memories, media). It is the whole database.

## Development

```sh
STUDIO_DEV_USER_ID=<your telegram id> STUDIO_SUPERADMIN_IDS=<same> npm run dev
# open http://localhost:3000/studio — outside Telegram the dev user is used
```

Code map:
- `src/lib/studio/`: domain, permissions, persona design, media providers, service, HTTP router, bot runner, runtime wiring. Tests are in `__tests__/`.
- `src/app/studio/`: the Mini App.
  - `_components/Cloud.tsx`: the animated cloud characters.
  - `_components/screens/*`: one file per screen.
- `src/app/api/studio/[...path]/route.ts`: API entry.
- `src/instrumentation*.ts`: starts the bot runner when `STUDIO_BOTS=1`.

## Not built yet

- Recognising people by their voice (voiceprints with consent).
- Agents proposing new agents through an approval inbox.
- Group voice calls.
