# Operator setup for Connectors & plugins (Settings v2)

This list covers what an operator sets up before the **Connectors & plugins** page can connect each app. It gives names and steps only. Values, keys and secrets never go in this file, in Studio env or in Telegram.

The page tells each person what is missing for their account, agent and space. It never shows a secret or a path:

| Page text | What it means | Where it is fixed |
|---|---|---|
| Connections are switched off by Vox | The manifest has `enabled: false` or no manifest exists | Studio manifest |
| The Vox connection service isn't running | Studio has no broker configured | Studio env and the broker process |
| Vox hasn't set this up for your account and this agent yet | No qualified profile exists for this exact account, space, agent and provider | Studio manifest `profiles[]` |
| Available in your Personal space only | Gmail tools are Personal-only | Nothing to fix |
| Answers from connected apps are waiting for AI processing approval | `modelPolicy` doesn't match `STUDIO_CHAT_MODEL` or isn't qualified | Studio manifest and env |
| Custom MCP servers are turned off by Vox | `selfServiceMcp.enabled` is false in the manifest or the broker config | Manifest and broker config |
| This Vox server can't add MCP servers from the app yet | Studio storage has no committed-state fence (for example `STUDIO_STORAGE=firestore`) | `STUDIO_STORAGE=file` |
| A Vox admin connects this for your account. It can't be connected from here yet | An operator-token or runner app (Notion, Slack, Figma, Forgejo, Hetzner, PostHog, Gamend, browser, ssh). The page never offers Connect for these | Operator enrollment, see below |

## How connectors reach conversations

- **Studio Mini App.** A person uses a connected app from **Connectors & plugins**, with **Ask \<Agent\>**. This runs the existing isolated task runtime. Each tool call is reviewed and approved there, and the result stays in that private session.
- **Telegram DM.** With `STUDIO_SETTINGS_V2=1`, `/ask` or `/connectors` in the agent's private chat sends a quiet button to `/studio/connect/<agentId>?ask=1`. That page runs the same reviewed task with the agent bot's own sign-in. No question text, connector data or result enters the DM or its history.
- **Not yet supported:**
  - ordinary chat replies, Telegram replies and calls (push-to-talk and live) don't use connected apps;
  - voice can't approve a reviewed call;
  - answers inside the DM would need a new destination (`telegram:agent_dm`). That destination changes every catalog digest and needs its own security review.

## Common (every provider)

1. Run the broker as its own non-root UID, separate from Studio. It needs these files, which the broker UID owns:
   - a 0700 vault directory;
   - two different 64-hex keys, the vault key and the control key, each in its own 0600 file.
   
   Studio keeps its own 0600 copy of the control key only.
2. Set these Studio env names:
   - `STUDIO_CONNECTIONS_CONFIG_FILE` (absolute path to the manifest)
   - `STUDIO_CONNECTIONS_BROKER_URL` and `STUDIO_CONNECTIONS_BROKER_AUTH_KEY_FILE` (set both or neither)
   - `STUDIO_CHAT_MODEL` (must equal the manifest's `modelPolicy.model`)
   - `STUDIO_WEBAPP_URL` (public HTTPS origin, used for the POST origin check and the `/ask` button)
   - `STUDIO_STORAGE` and `STUDIO_DATA_DIR` (production uses file storage; the main-app MCP path needs it)
   - `STUDIO_SETTINGS_V2=1`
3. The broker takes no env. Startup refuses any variable whose name contains `TOKEN`, `SECRET` or `STUDIO_`. Its configuration is one 0600 JSON file passed on argv to `node --import tsx scripts/connections-broker.mjs serve <config>`. The file holds:
   - `host`, `port`, `brokerUid` and `studioUid`;
   - `vaultDirectory`, `vaultKeyFile`, `authKeyFile`, `keyVersion` and `studioOrigin`;
   - `enabledProviderIds`, `oauthProfiles` and `operatorScopes`;
   - `connectionsManifestFile`, `runnerAdmissionFile` (optional) and `selfServiceMcp`.
4. Write the manifest with:
   - `enabled: true`;
   - `modelPolicy { provider: 'anthropic', model, qualified: true, evidenceReference }`.
5. Configure the reverse proxy:
   - `https://<host>/oauth/callback/<providerId>` goes to the broker, for providers that use broker sign-in;
   - `https://<host>/oauth/callback/remote_mcp` and `https://<host>/oauth/client-metadata.json` go to Studio, which relays them;
   - strip query strings from access logs.
6. Check the setup offline before starting:
   - `node --import tsx scripts/connections-config.mjs check --manifest <file> --broker <file>`
   - `node --import tsx scripts/connections-preflight.mjs --manifest <file> --broker <file> --studio-auth-key <file>`

## Custom MCP (the only self-service connector today)

- **Manifest:**
  - `selfServiceMcp { enabled: true, dailyModelTokenCeiling ≥ 1, dailyToolCallCeiling ≥ 1 }`
- **Broker config:**
  - add `remote_mcp` to `enabledProviderIds`;
  - set `selfServiceMcp { enabled: true, callbackUrl: https://<host>/oauth/callback/remote_mcp, clientMetadataUrl: https://<host>/oauth/client-metadata.json, registeredClients[], scopes }`.
- **Servers people can add need:**
  - public HTTPS Streamable HTTP;
  - RFC 9728 protected-resource metadata and RFC 8414 server metadata;
  - S256 PKCE;
  - signed-JWT access tokens for that exact resource;
  - either client-ID metadata or a preregistered client.
- **Adding from the Vox main app** (new in Settings v2) uses the same checks:
  - a manager-signed person who may use the agent;
  - `selfServiceMcp.enabled`;
  - the same URL, TLS and private-address validation.
  
  It needs the file storage committed-state fence and an identity store with a committed read. Without them the page says that servers can't be added from the app, and offers no Add row. While an identity change for the same account is being written, the main-app path refuses each step, as the bot path does.

## Google family

This covers `google_drive`, `google_docs`, `google_sheets`, `google_slides`, `gmail` and `google_analytics`.

1. In Google Cloud Console:
   - configure the OAuth consent screen;
   - create a **Web application** OAuth client;
   - add one redirect URI per provider ID: `https://<host>/oauth/callback/<providerId>`.
2. Enable the Drive, Docs, Sheets, Slides, Gmail and Analytics Data APIs, as needed.
3. Request scopes: `openid` plus `drive.file`, `gmail.readonly` or `analytics.readonly`.
   - `gmail.readonly` is a restricted scope. It needs Google verification or a security assessment.
   - Gmail is Personal space only.
4. In the broker config:
   - set `oauthProfiles.<providerId>` with the pinned Google endpoints, `clientId`, `clientSecret`, `callbackUrl` and `scopes`;
   - add each ID to `enabledProviderIds`.
   
   The client secret lives only in the broker config.
5. In the manifest, add one profile for each person, agent and space: `{ accountId, space, agentId, providerId, providerSubject, providerTenantId, endpointProfileId, setup: 'oauth', qualified: true, evidenceReference, dailyModelTokenCeiling ≥ 1, dailyToolCallCeiling ≥ 1, resources[] }`. It contains the exact file, property or message IDs.

## GitHub

1. Create a GitHub OAuth app, or a GitHub App with selected repositories. Set the callback to `https://<host>/oauth/callback/github`.
2. Do one of the following:
   - put the app in broker `oauthProfiles.github`, with the pinned GitHub endpoints and no revoke URL;
   - or create a fine-grained token and enroll it as an operator token (see the next section).
3. Add a manifest profile for each person, agent and space that lists the exact repositories.

## Notion, Slack, Figma, Forgejo, Hetzner, PostHog, Gamend

These use operator tokens. Broker sign-in supports only GitHub and Google today. The Connectors & plugins page shows these apps as "A Vox admin connects this" and never offers Connect, because a person can't finish them from a page.

1. In each provider's console, create a narrowly scoped credential:
   - **Notion:** an integration token. Share only the selected pages with it.
   - **Slack:** an app installed in the workspace, with channel history read only.
   - **Figma:** a personal access token or OAuth token with `file_content:read`.
   - **Forgejo:** an app token, limited to an explicit repository allowlist.
   - **Hetzner:** a read-only project token.
   - **PostHog:** a personal API key scoped to insights.
   - **Gamend:** a delegated grant.
2. In the broker config, set `operatorScopes.<providerId>` and add the ID to `enabledProviderIds`.
3. Add a manifest profile with `setup: 'operator'` and the exact resources. This comes before enrollment: enrollment refuses (`provider_setup_required`) until the profile exists.
4. Enroll the credential: `node --import tsx scripts/connections-broker.mjs enroll <config> <accountId> <space> <flowId>`, with the token on stdin. It never goes in a file, an env variable or a shell history.

   `<flowId>` belongs to a pending setup for that person, agent and space, and it expires after 10 minutes. **Open gap:** Settings v2 doesn't start that setup or show its flow ID, so no supported page hands an operator a flow ID today. Until an operator enrollment flow exists, these apps stay at "A Vox admin connects this".

## Browser reader and Server diagnostics (runners)

- Set `runnerAdmissionFile` in the broker config.
- Use the attested worker image or host, with host-key pinning. See `RUNNER_OPERATIONS.md`.

## Rights (applies whatever the flag)

Rights export and erasure now cover connections.

**Export** includes:
- connections, provider accounts, grants and reviews;
- tasks, workflows and MCP entries.

Tokens never appear, because they exist only in the broker vault.

**Erasure** revokes and removes connections:
- A rights erasure covers the request's space.
- The pet page's "forget me" covers both spaces.

Records are revoked at once, so the broker refuses any further use. The provider account identity (subject and tenant) is cleared at the same moment.

The broker is then asked to drop each vault entry with `/v1/erase`. This needs no identity confirmation, because the person may never come back:
- the broker asks Studio for `erasedContext`;
- Studio answers only for a connection that an erasure revoked and marked, and only for the plain account actor.

So `/v1/erase` can stop use and drop secrets, but it can never use them. Once the broker confirms, the records go.

A broker without `/v1/erase` (an older build) falls back to `/v1/revoke` with a server-minted actor. That needs a current identity and a current member or agent bot.

If the broker can't be reached, the entry waits. A later Connections load retries it, at most every 5 minutes after a failure. Deploy the broker and Studio from the same build so `/v1/erase` exists on both sides.

## Connectors people use (manager counts)

- Managers see per-app counts of people with a live connection. They never see who, which account, which resources or when.
- The viewer's own connections are never counted.
- An app appears only once at least 3 other people use it.
- For a non-public agent, an app never appears when every other person who may use the agent has connected it.
