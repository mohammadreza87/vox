# Vox Studio production

Studio needs one persistent Node.js process and a private writable data directory.
Its Telegram long polling and file database do not support Firebase Functions,
ephemeral storage, multiple replicas, or two processes polling the same bot token.
The legacy Firebase website is a separate deployment.

## Mac Studio release

Node.js 22 and the existing signed-in macOS user are used. Port 3107 is bound to
127.0.0.1; HTTPS reaches it through a named Cloudflare Tunnel. The machine must stay
awake. This launch agent starts at login and restarts the app after a crash; it does
not start before the user signs in after reboot.

1. Prepare owner-only configuration on the production host:

   ```sh
   node scripts/studio-production.mjs prepare
   ```

   This imports configured Studio provider keys from `.env.local`, preserves
   existing production values, and generates the encryption secret on the host.
   Configuration lives in `~/Library/Application Support/Vox Studio/production.env`
   (0600), with data in the adjacent `data/` directory (0700). Keep this secret
   stable: changing it prevents decryption of existing agent bot tokens.

2. Fill in these fields in that private file:

   - `VOXX_BOT_TOKEN`: manager token for @VoxxBot. Enable Bot Management in
     BotFather's Mini App for managed-agent creation.
   - `STUDIO_SUPERADMIN_IDS`: your positive Telegram user ID, comma separated if
     multiple bootstrap owners are intended.
   - `STUDIO_WEBAPP_URL`: the chosen public HTTPS URL ending in `/studio`.
   - `ANTHROPIC_API_KEY`: required for agent design and replies.
   - `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`: needed for avatars, transcription,
     voice design and spoken calls. Their absence disables provider features.

   Do not paste these values into chat, commits, commands, or service plists.
   `prepare` can be rerun to import previously missing values from `.env.local`.

3. Validate credentials and model access without sending messages or generating
   billable content:

   ```sh
   node scripts/studio-production.mjs check
   ```

4. Commit the release, then validate and build that revision:

   ```sh
   npm ci
   npm run lint
   npx tsc --noEmit
   npx vitest run
   npm audit --omit=dev --audit-level=high
   npm run studio:build
   node scripts/studio-production.mjs install
   node scripts/studio-production.mjs status
   ```

   The build records its commit, source tree and build ID; installation rejects
   artifacts from a different revision. Installation copies the standalone server, static assets and public files into
   an independent release directory, excluding `.env*` files. It snapshots stopped
   state before switching, supervises the app with `io.ludaxis.vox-studio`, and
   checks the exact revision at `/api/studio/health`. Failed startup restores the
   previous release when one exists. No secrets are placed in the plist or argv.

5. Create a **named** Cloudflare Tunnel and route the selected hostname to
   `http://127.0.0.1:3107`, with a final catch-all `http_status:404`. Run its connector
   as a persistent macOS service. Store its token in an owner-only file and use
   `cloudflared tunnel run --token-file <private-file>`.
   [Cloudflare service instructions](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/as-a-service/macos/)
   and [run parameters](https://developers.cloudflare.com/tunnel/reference/run-parameters/).

6. Verify from the public hostname:

   - `/` redirects to `/studio`; `/studio` loads over valid HTTPS.
   - `/api/studio/health` returns 200, `bots: true`, and the installed revision.
   - `/api/studio/me` without signed Telegram initData returns 401.
   - `/api/chat`, `/api/telegram/payments`, `/api/convai/llm`, and `/_next/image`
     return 404 in Studio-only production mode.
   - Open @VoxxBot in Telegram. Check owner access, pending-user approval,
     draft/test/hire, replies, voice and reload persistence. Startup readiness
     does not prove these real Telegram/provider flows.

## Operations and recovery

```sh
node scripts/studio-production.mjs status
node scripts/studio-production.mjs backup
node scripts/studio-production.mjs rollback
node scripts/studio-production.mjs stop
```

Backups stop this service, copy both state and its matching encryption configuration
to a private timestamped directory, then restart it if it was running. The installer
also takes a backup before each deployment. Local backups are not off-host disaster
recovery; arrange protected off-host copies and a restore drill before relying on
them for business-critical data. No automatic backup schedule is installed.

To restore, stop the service, preserve current data, restore a matching `data/` and
`production.env` from one backup, select a compatible release, and verify status
and Telegram behavior. Rollback switches code; it does not revert user data.

Logs: `~/Library/Application Support/Vox Studio/logs/server.log` and `error.log`.
Restrict access to these files; logs can contain provider and conversation metadata.
Rotate logs through host administration. If health fails, the revision is wrong,
Telegram authentication breaks, or data persistence fails, stop promotion and
restore the previous code. Do not run a second poller to diagnose the same token.

## Security boundaries

`STUDIO_ONLY=1` restricts this host to Studio, its API, and required static assets.
It redirects the root page and hides legacy Firebase APIs, billing routes and the
unused image optimizer. Studio validates Telegram signatures and freshness,
restricts member access, encrypts stored bot tokens, limits per-user provider
requests, and counts request bytes before parsing. Counters are process-local:
multi-instance deployment requires shared persistence, locking, and rate limits.

Telegram Web framing is allowed only from `https://web.telegram.org`. Calls still
require microphone permission and delegation by the Telegram client. See
[Telegram clients](https://telegram.org/apps),
[Web iframe events](https://core.telegram.org/api/web-events), and the
[Permissions Policy explainer](https://github.com/w3c/webappsec-permissions-policy/blob/main/permissions-policy-explainer.md).
