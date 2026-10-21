# Vox Studio production

Studio supports two deployment profiles. Firebase uses Firestore, Cloud Storage
and Telegram webhooks. The alternative Mac Studio profile uses one persistent
Node.js process, a private data directory and Telegram long polling. Never use
file storage on an ephemeral server or run pollers and webhooks for the same bot.

**Active target (19 October 2026):** `https://vox.joyixir.com/studio` uses the Mac
Studio polling profile. The manager and active agent bots belong to that runtime.
Firebase deployment is held: the `Deploy` job requires repository variable
`STUDIO_PRODUCTION_TARGET=firebase`. An unset or different value skips that job,
including manual dispatch. CI and preview deployment remain independent.

Do not set that variable as a routine release step. A target migration must first
stop the existing polling owner, preserve or migrate its state and encrypted bot
tokens, and qualify the destination before registering webhooks. Firebase's
production verifier registers webhooks and changes the manager's menu URL;
`STUDIO_BOTS=0` only prevents polling and does not make Firebase inactive.
Granted Firebase IAM roles do not change transport ownership or activate outreach.

The composed Mac runtime currently suppresses the legacy relationship loop when
adaptive privacy is present. Owner/Super Admin eligibility alone does not enable
outreach. A release must also qualify Work/Personal scope, current consent and
agent grants, external-channel permission, and final-send revocation checks.

## Adaptive defaults and history transition

For the default-disabled release, leave `STUDIO_ADAPTIVE_POLICY_JSON` absent and
`STUDIO_DECISIONS_ENABLED` absent or `0`. Ordinary replies remain available;
adaptive capability eligibility, saved-memory use, personalization, optional
analytics and inbox delivery remain unavailable. Automatic memory, biometric
recognition and content-quality review are unavailable in this slice even if a
manifest requests them. No external notification sender or autonomous improvement
worker is started.

`STUDIO_ADAPTIVE_POLICY_JSON` is a private, server-owned reviewed manifest, parsed
by [the configuration adapter](../src/lib/adaptive/persistence/config.ts). It
resolves account-specific jurisdiction keys, enabled capabilities and current
approval records. Invalid supplied configuration fails runtime initialization;
parsing a manifest does not establish approval. `STUDIO_DECISIONS_ENABLED=1` also
requires an OpenAI client and current endpoint eligibility, profile, consent and
agent authority. Do not enable either setting as part of a default-disabled
release. The current Mac `prepare` command rewrites only its listed configuration
keys, and the Firebase environment writer does not export these adaptive settings;
future enablement needs an explicit configuration-delivery change and verification.

The Studio runtime stops reading and retaining legacy unscoped conversation
history and stops legacy automatic memory extraction. Existing legacy stores are
preserved for an explicit migration; confirming an account profile does not import
or authorize them. Replies therefore use the current input and any separately
authorized explicit context, without the old retained conversation history. This
change also applies when optional adaptive capabilities are disabled.


## Firebase production

The existing hostname is `https://vox-aicontact-fe0e3.web.app`; Studio opens at
`/studio`. Configure the following in the repository's
[Actions secrets](https://github.com/mohammadreza87/vox/settings/secrets/actions):

- `STUDIO_SECRET`: a stable random encryption secret of at least 32 characters,
  generated on the deployment host and entered directly into the secret store.
- `VOXX_BOT_TOKEN`: @VoxxBot's manager token.
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`: providers required for
  the complete chat, avatar and voice experience.
- Existing Firebase service account, project ID and all six
  `NEXT_PUBLIC_FIREBASE_*` configuration secrets used by the deployment workflow.

Set repository variable `STUDIO_SUPERADMIN_IDS` to your positive Telegram user ID.
Optional variables include `STUDIO_PUBLIC_URL`, `VOXX_BOT_USERNAME`,
`STUDIO_MEDIA_BUCKET`, `STUDIO_ORG_NAME` and `STUDIO_PORTRAITS`; their default values use the existing
Firebase hostname/bucket, VoxxBot, and HOOR. Portraits are drawn by editing a render of the agent's
vector character; set `STUDIO_PORTRAITS=text` to use the text-only prompt instead. Enable Bot Management for @VoxxBot in
BotFather's Mini App before trying to hire an agent.

The production workflow validates configuration, lint/types, tests and the high
severity audit gate before deployment. It writes private server settings with
`STUDIO_STORAGE=firestore`, `STUDIO_BOTS=0`, `STUDIO_ONLY=1` and the source revision.
Missing configuration fails deployment instead of publishing a disabled Studio.
It then registers every bot webhook and verifies the exact live revision, Studio
page, unauthenticated rejection, and excluded legacy routes. A failed registration
or readiness check fails the deployment job.

CI and read-only credentials checks do not prove a working user flow. After a
successful deployment, verify owner/pending access, draft/test/hire, a real reply,
voice, and persistence from Telegram. Verify Firestore and Cloud Storage access
policies and backups in the project; local backup commands below cover only the
Mac profile. The Firestore state document has the platform's 1 MiB document limit.

Adaptive persistence uses separate `adaptiveAccounts` and `adaptiveSharedMemory`
collections through Firebase Admin transactions. Account metadata can be written
by normal runtime authorization checks even with adaptive capabilities disabled.
These documents contain application JSON; `STUDIO_SECRET` encrypts bot tokens and
does not encrypt adaptive document payloads. Before using this profile, verify
deployed Firestore rules deny direct client reads and writes to both collections,
including authenticated clients, and verify backend IAM and operator access.
Admin SDK access bypasses client rules. `firebase.json` currently configures
hosting only: this deployment does not publish Firestore rules or establish IAM,
backups or separate worker credentials. A passing application test is not evidence
that these production boundaries are configured.

To recover Firebase, redeploy the last tested revision while preserving its
encryption secret and compatible data. Reconnect webhooks to that revision's
hostname and repeat the live checks. Do not run the Mac polling profile against
those bot tokens during recovery.

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

3. Validate every credential and model without sending messages or generating
   billable content. It checks the Telegram token, Anthropic, OpenAI (image and
   transcription models) and ElevenLabs (TTS model and remaining characters), and
   stops if @VoxxBot has a webhook, which means another deployment such as
   Firebase owns the bot:

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
   # Initial install only; for upgrades use the approved present baseline below.
   node scripts/studio-production.mjs install --expect-absent
   node scripts/studio-production.mjs status
   ```

   `--expect-absent` is only for a verified initial install. For an upgrade, pass
   `--expect-current '<absolute-resolved-release-path>' --expect-revision
   '<full-40-character-revision>' --expect-build '<approved-build-id>'` using the
   trusted, approved current baseline. See [Studio operation coordination](STUDIO_OPERATIONS.md)
   for lock ownership, recovery and operator requirements.
   The build records its commit, source tree and build ID; installation
   copies the standalone server, static assets and public files into an independent
   release directory, excluding `.env*` files. The guarded install procedure
   snapshots stopped state before switching, supervises the app with
   `io.ludaxis.vox-studio`, and checks the intended revision at
   `/api/studio/health`. Automatic startup recovery is guarded: it may restore the
   prior release only while the active pointer still identifies this operation's
   candidate. No secrets are placed in the plist or argv.

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
   - `/api/chat`, `/api/telegram/payments`, `/api/convai/session`, and `/_next/image`
     return 404 in Studio-only production mode.
   - Open @VoxxBot in Telegram. Check owner access, pending-user approval,
     draft/test/hire, replies, voice and reload persistence. Startup readiness
     does not prove these real Telegram/provider flows.

## Operations and recovery

```sh
node scripts/studio-production.mjs status
node scripts/studio-production.mjs backup
node scripts/studio-production.mjs rollback \
  --expect-current '<absolute-resolved-release-path>' \
  --expect-revision '<full-40-character-revision>' \
  --expect-build '<approved-build-id>'
node scripts/studio-production.mjs stop
```

Rollback requires an expected present baseline; it does not accept
`--expect-absent`. See [Studio operation coordination](STUDIO_OPERATIONS.md) for
the lock, stale-lock recovery and bypass limits. Verify implementation and release
evidence before using this procedure.

Backups stop this service, copy both state and its matching encryption configuration
to a private timestamped directory, then restart it if it was running. The installer
also takes a backup before each deployment. Local backups are not off-host disaster
recovery; arrange protected off-host copies and a restore drill before relying on
them for business-critical data. No automatic backup schedule is installed.

To restore, stop the service, preserve current data, restore a matching `data/` and
`production.env` from one backup, select a compatible release, and verify status
and Telegram behavior. Rollback switches code; it does not revert user data.

Adaptive file stores live under `STUDIO_DATA_DIR/adaptive/` and
`STUDIO_DATA_DIR/shared-memory/`; keep them with the matching state backup and
configuration. Preserve deletion tombstones, revoked grants and consent epochs
when reconciling a restore so old snapshots cannot resurrect deleted content or
permission. For Firebase, reconcile the corresponding collections as well.
Rolling back to code from before the adaptive privacy boundary can resume legacy
history and memory use; disabling the new flags does not constrain that older
code. Verify the rollback candidate's privacy behavior and schema compatibility
before serving it, or keep the service stopped until a compatible recovery is
ready. Backup restoration and tombstone replay require their own qualification.

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
requests, and counts request bytes before parsing. File-mode counters are
process-local. Firebase uses transaction-backed shared counters, Firestore state
and webhook delivery instead of long polling.

Connections stays disabled unless all three of `STUDIO_CONNECTIONS_CONFIG_FILE`,
`STUDIO_CONNECTIONS_BROKER_URL` and `STUDIO_CONNECTIONS_BROKER_AUTH_KEY_FILE` are
set and every profile in the manifest is marked qualified; the broker is read-only
by construction. The install script preserves these keys, and none is set on the
Mac Studio host. See [connections/ACCOUNT_ONBOARDING.md](connections/ACCOUNT_ONBOARDING.md).
`src/lib/env.ts` validates only the legacy web-app variables and is not used by
Studio, which reads its `STUDIO_*` and `VOXX_*` variables in `src/lib/studio/runtime.ts`.

Telegram Web framing is allowed only from `https://web.telegram.org`. Calls still
require microphone permission and delegation by the Telegram client. See
[Telegram clients](https://telegram.org/apps),
[Web iframe events](https://core.telegram.org/api/web-events), and the
[Permissions Policy explainer](https://github.com/w3c/webappsec-permissions-policy/blob/main/permissions-policy-explainer.md).
