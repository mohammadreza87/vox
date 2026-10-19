# TIREH Shared Personas on Telegram

Telegram is the messenger. Vox runs the AI personas behind it.

## The use case

TIREH has AI colleagues such as **Aria, the Product Lead**. Aria is **one persona for the whole organization**: the same name, voice and personality for everyone.

- When **Reza** talks to Aria, they build memories together.
- When **Parastoo** talks to Aria, she builds her own memories with the same Aria.
- Aria **knows who everyone is and how they relate** (Parastoo reports to Reza and manages Milad; Reza and Parastoo are co-founders).
- Aria builds **shared memories** with groups and projects.
- Aria **never leaks** what someone told her privately.

## How it works

```
 Telegram                                     Vox  (src/lib/tireh)
 ────────                                     ───────────────────
 Reza ── text / voice note ──► @hoor_aria_bot ──► POST /api/tireh/telegram/aria
                                                   │ 1. verify webhook secret (fails closed)
                                                   │ 2. drop duplicate update_id (Telegram retries)
                                                   │ 3. who? Telegram id → TIREH person (strangers refused)
                                                   │ 4. where? private chat, or a REGISTERED group
                                                   │ 5. group: listen always, reply only when addressed
                                                   │ 6. voice note → ElevenLabs Scribe → text
                                                   │ 7. memories this audience may see → system prompt
                                                   │ 8. LLM reply (Anthropic or Gemini)
 Reza ◄── voice in Aria's voice + text ────────────┤ 9. ElevenLabs TTS in Aria's fixed voice
                                                   │10. extract new memories → scope them in code
 Reza ◄── "Share this with GameEnd?" [Yes][No] ────┘11. private work facts: offer to share
```

Each persona is its **own Telegram bot**, with its own name, photo, @username and chat. One Vox server runs all of them.

## The privacy rule

> **A persona may use a memory only if EVERY person who can read the conversation is allowed to see it.**

- **Private chat:** the audience is that one person.
- **Registered group:** the audience is every member listed in config, whether or not they have spoken.

This rule is enforced **in code, before anything reaches the model** (`memory/visibility.ts`). Memories that aren't allowed are never put in the prompt, so no prompt trick can make Aria reveal them.

### Memory scopes

| Scope | Who can see it | Created by |
|---|---|---|
| `private` | one person | anything said in a private chat |
| `group` | members of a registered group | things said in a group |
| `project` | project members | decisions in a project's group, or a private work fact the owner approved for sharing |
| `company` | company members | config / future |
| `org` | everyone in the organization | config / future |

Two further protections:

- **Personal** memories (health, family, feelings) never leave a one-to-one chat with their owner, even if their scope is somehow widened.
- **Confidential** remarks stay with the speaker, even when said in a group.

### Sharing private work facts

When Reza tells Aria a work decision in private, for example "move the GameEnd launch to March 5":

1. It is stored as **private**.
2. Aria asks: *"Should I share this with the GameEnd project?"* with **[Share]** and **[Keep private]** buttons.
3. Only Reza can press them. Anyone else gets "Only the person who told me can decide this."
4. After approval, Parastoo and the GameEnd group see it **with provenance**: "(Reza, privately, 2026-10-19; shared with: GameEnd project)".

### Provenance and conflicts

Every memory records who said it, where, when and its scope.

- The same person updating the same topic **replaces** their older memory.
- Different people disagreeing are **kept side by side**. Aria is told to mention both sources, not silently pick one.

## Commands

| Command | What it does |
|---|---|
| `/start` | introduction |
| `/whoami` | how Aria knows you (role, manager, reports, projects) |
| `/memories` | what Aria remembers **that you can see**, with scope and source. Private chat only. |
| `/forget <n>` | delete a memory **you** are the source of |

## Code map

| File | Responsibility |
|---|---|
| `src/lib/tireh/types.ts` | domain model: people, groups, personas, memory, scopes |
| `src/lib/tireh/org/config.ts` | load and validate the org config (cross-checks every reference) |
| `src/lib/tireh/org/default-org.ts` | HOOR seed from the TIREH spec (no Telegram ids) |
| `src/lib/tireh/org/directory.ts` | lookups, reporting lines, relationship descriptions |
| `src/lib/tireh/memory/visibility.ts` | **the privacy rule** |
| `src/lib/tireh/memory/retrieval.ts` | rank allowed memories; detect conflicts |
| `src/lib/tireh/memory/extraction.ts` | LLM proposes memories; **code decides scope** |
| `src/lib/tireh/memory/store.ts` | store interfaces and in-memory implementations |
| `src/lib/tireh/memory/firestore-store.ts` | Firestore (Admin SDK) implementations |
| `src/lib/tireh/conversation/prompt.ts` | persona system prompt (identity, people, allowed memories, rules) |
| `src/lib/tireh/gateway.ts` | Telegram update handling end to end |
| `src/lib/tireh/telegram/client.ts` | minimal Bot API client |
| `src/lib/tireh/voice.ts` | ElevenLabs speech-to-text and text-to-speech |
| `src/lib/tireh/llm.ts` | model-independent LLM interface (Anthropic / Gemini) |
| `src/lib/tireh/runtime.ts` | production wiring from env |
| `src/app/api/tireh/telegram/[personaId]/route.ts` | webhook endpoint |
| `scripts/tireh-set-webhooks.mjs` | register webhooks for persona bots |

### Firestore collections

```
tireh_memories/{id}                          personaId, active, scope, scopeKey, source, …
tireh_share_offers/{id}
tireh_chats/{personaId__chatKey}/messages/{auto}
tireh_updates/{personaId__updateId}          webhook idempotency
```

These collections are written only by the server (Admin SDK). Keep client access denied in Firestore rules.

## Setup

1. **Create the bot.** In @BotFather, `/newbot` → e.g. `@hoor_aria_bot`. Set its name, photo and description to match the persona. For group listening, `/setprivacy` → **Disable**. After changing privacy mode, remove the bot from the group and add it again, or make it a group admin.
2. **Write the org config.** Copy `tireh.org.example.json` to `tireh.org.json` (gitignored) and fill in:
   - real **Telegram user ids** (each person can get theirs from @userinfobot)
   - groups with their **chat ids** and **complete member lists**. The member list is the audience for privacy. If someone not listed speaks in the group, the persona stays silent and logs a warning.
3. **Set environment variables.** See `.env.example`, section "TIREH": `TIREH_WEBHOOK_SECRET`, `TIREH_BOT_TOKEN_ARIA`, `TIREH_ORG_CONFIG_PATH`, `ANTHROPIC_API_KEY` (or Gemini), `ELEVENLABS_API_KEY` for voice, `SERVICE_ACCOUNT_KEY` for Firestore.
4. **Deploy, then register webhooks:**
   ```bash
   TIREH_PUBLIC_URL=https://your-host TIREH_WEBHOOK_SECRET=... TIREH_BOT_TOKEN_ARIA=... \
     node scripts/tireh-set-webhooks.mjs aria
   ```
5. **Talk to Aria** on Telegram: text or voice, privately or in the registered group.

### Adding a persona

Add an entry to `personas` in the org config, create its bot, set `TIREH_BOT_TOKEN_<ID>`, and register its webhook. Bump `identityVersion` whenever the personality or voice changes on purpose.

## Testing

```bash
npx vitest run src/lib/tireh src/app/api/tireh
```

`src/lib/tireh/__tests__/gateway.test.ts` runs the full use case end to end with a scripted LLM, a fake Telegram bot and in-memory stores:

- same Aria for Reza and Parastoo
- relationship awareness
- private memories don't leak
- share offers, owner-only approval and provenance
- group and project memory, plus the all-members rule
- conflict surfacing
- stranger and unregistered-group refusal
- webhook retries
- voice in and out
- commands

## Known limits and next steps

- **Live calls:** Telegram bots can't make calls. Use a "Call Aria" button that opens the Vox Mini App, which already does live ElevenLabs calls. It is not wired yet.
- **Response time:** replies are generated inside the webhook request (an LLM call, plus TTS for voice). For heavy use, move processing to a queue or a long-polling worker on the agent Mac Studio.
- **Org config is static.** Changes need a redeploy. That is deliberate for identity, but members and groups may later belong in Firestore with an admin UI in the Mini App.
- **Retrieval is keyword-based.** Vox's existing embedding service could be plugged into `memory/retrieval.ts` for semantic search.
- **Data protection:** memories about employees are personal data under GDPR. Run a data protection impact assessment before rolling this out to staff, and publish a retention policy.
