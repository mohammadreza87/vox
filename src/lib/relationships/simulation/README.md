# Synthetic relationship simulator

The checked-in scenario is a 90-day deterministic replay with six fictional users and EN/FA examples. Run it with an isolated local state directory:

```sh
npx tsx scripts/relationship-simulation.ts --fake --mode replay --dir /tmp/vox-relationship-replay --decision stay_quiet
```

The replay uses the actual `RelationshipLoop`, a fake assessor, a selectable deterministic decision, fake time, and a synthetic send callback. It writes `state.json` and `report.json` into the selected directory. Do not point it at production paths. `delivery_unknown` is retained and never retried; the harness does not make exactly-once transport claims.

For a real-provider session with fictional data, run `STUDIO_CHAT_MODEL=claude-haiku-5-5 STUDIO_VOICE_MODEL=claude-haiku-5-5 npx tsx scripts/relationship-simulation.ts --real-model --env /path/to/local/.env.local --dir /tmp/vox-agent-sol --mode interactive --user-model gpt-6.1-sol --max-turns 20`. Use a separate directory and `--user-model gpt-6-luna` for the second synthetic user agent. Credentials are read locally and never included in output. The actual `PersonaGateway`, Anthropic assessor/chat, and OpenAI Decisions provider handle synthetic turns; all Telegram sends go to an in-process fake sink. No bot credential or production gateway is loaded. The explicit `--fake` mode never calls a model provider; its `--decision` option accepts `send`, `defer`, `close`, or `stay_quiet`.

Interactive mode reads one JSON command per stdin line and writes one JSON response per stdout line. Commands are defined in `gateway-session.ts`: `turn` (personId, audience, text), `advance` (ISO timestamp), `reconsider`, `seed_memory`, `share`, `revoke`, `group_join`, `group_leave`, `guest_join`, `guest_leave`, `state`, and `quit`. A private turn must name its owner; a group turn uses `{"kind":"group","groupId":"book-club"}`. Asha and Marco are initial book-club members. Share and revoke call the production owner helpers and file stores. Responses include the natural reply, all synthetic relationship state, privacy-safe observations and delivery receipts. Session metadata and transcript input/output, memories, history, relationships, and observations are persisted under the selected local directory.

An independent synthetic user agent reads the JSON output, then chooses its next turn from a persona prompt in `scenario.ts`. The user's voice and decisions come from the agent session (`gpt-6.1-sol` or `gpt-6-luna`), not canned messages represented as model role-play. Fake replay tests coordinator decisions and state behavior, not model judgment, natural assistant wording, actual Telegram delivery, or user outcomes. Real-provider interactive sessions exercise the production gateway code only on fictional turns; they remain simulated evidence and do not establish real-user outcomes or live delivery.

The replay report records scenario id, seed, ordered events and synthetic delivery attempts. An interactive session records the user input and assistant output per turn, model/provider identifiers and call limits, but never credentials. For role-play, keep turns fictional and cap each session at 20 user turns.

The core replay reports executed turn/reconsideration events separately from timeline annotations. Its sharing, membership, delivery-fault, and restart annotations are not executed by that core-only adapter; those behaviors are exercised by dedicated integration tests and the interactive gateway controls. Do not count 32 timeline entries as 32 end-to-end assertions. Interactive membership controls mirror Studio history/relationship invalidation; they still use fake transport and do not verify Telegram membership APIs.
