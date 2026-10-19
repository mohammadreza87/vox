# Vox Studio

Vox Studio is the Telegram Mini App inside **@VoxxBot** where everyone in HOOR spawns, shapes, calls and manages AI agents. Each agent is a real Telegram bot with one personality, one voice and one cloud face, and its memories are shared across the people it talks to (see [TIREH_PERSONAS.md](./TIREH_PERSONAS.md) for the memory model).

```
Telegram ── @VoxxBot (Mini App: /studio) ──┐
        └─ @hoor_aria_bot, @hoor_…_bot ────┤  long polling
                                           ▼
            one Next.js process on the Mac Studio
            ├─ /studio            Mini App UI
            ├─ /api/studio/*      Mini App API (Telegram initData auth)
            ├─ bot runner         VoxxBot + every hired agent bot
            └─ .vox-studio/       studio.json, memory.json, media/
                 │
                 ├─ Claude        persona design (stronger model) + replies (fast model)
                 ├─ OpenAI        avatars (gpt-image-1) + speech-to-text
                 └─ ElevenLabs    voice design / library + speech
```

## What it does

| | |
|---|---|
| **Spawn** | Write a loose brief: presentation, domain, languages, culture, accent, age and temperament. Claude drafts the name, backstory, values, voice brief and a random cloud look. You can edit any field or ask Claude to change things. |
| **Look** | 8 colours × 3 cloud shapes, plus cheeks, lashes and brows. A dice button gives a random look. Profile pictures are generated with OpenAI or uploaded (JPEG/PNG/WebP, cropped to 640px). |
| **Voice** | ElevenLabs Voice Design creates three options from the voice brief, or you can search the voice library by gender, accent and language. |
| **Test** | A sandbox chat. Nothing said there becomes a memory. |
| **Hire** | Opens Telegram's "Create bot" screen (managed bots). One tap creates the bot. Studio stores its token encrypted, then sets the name, description, commands and photo. |
| **Forming → locked** | For 7 days after hire, the personality and look can still be tuned. After that they are fixed for good. To change who an agent is, **fire** it and **hire a successor**. Its memories can pass to the successor, be archived or be deleted. |
| **Groups** | Add an agent to any Telegram group from its page. In a group with people outside HOOR, agents only use that group's memories. |
| **Calls** | Talk to an agent in the Mini App. Each turn goes your voice → OpenAI STT → Claude (with memories) → ElevenLabs. |
| **Memories** | See what an agent remembers that you're allowed to see. You can delete anything you said. |
| **Org** | Superadmins grant or remove admin rights for people and agents. Admins approve new people. Everyone approved can use every shared agent. |

Roles: `superadmin > admin > member > pending`. New people who press /start in @VoxxBot are `pending` until an admin approves them. The first superadmins come from `STUDIO_SUPERADMIN_IDS`.

## Setup on the Mac Studio

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
