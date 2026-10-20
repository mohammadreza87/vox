# S03: Cache-stable prompt layout and the llm.ts upgrade

Step 3 of [docs/AGENT_INTELLIGENCE_SOLUTION.md](../../AGENT_INTELLIGENCE_SOLUTION.md) (sections 2.2, 2.8, 4.7 and the Step 3 row of section 5).
Base commit: `6d00b8066e5d8e8d444bb47d978aa571e20929df`. Branch: `aiq/prompt-caching`.

## Goal

Make the reply prompt cacheable without changing the default behaviour.

**Default behaviour (both flags unset):** the system prompt and the message list are byte-identical to base 6d00b80.

**`llm.ts` changes:**
- `LLMRequest.system` may be a string or an array of `SystemBlock`s.
- New optional `systemTail` and `onMeta` request fields.
- Messages may carry extras: `trailingText` and `cacheControl`.
- `AnthropicLLM` reports content-free usage and stop metadata from `complete`, `stream` and `completeWithWeb`.
- `GeminiLLM` keeps working.

**Cached layout, behind `TIREH_CACHED_PROMPT=1`:**
- `composeReply` and `liveTurn` send three system blocks:
  - A: persona identity, rules and examples. TTL 1h. Never contains a date. Padded to at least 512 approximate tokens.
  - B: deterministic org snapshot, only where the base renders `## Organization`. TTL 1h.
  - C: chat frame. TTL 5m.
- Everything volatile moves into a `## For this turn` text block sent after the newest user message: the date, speaker, reply format, active skill, memories with provenance, conflicts, saved context, relationship context and the final reminder.
- One history breakpoint is set on the last assistant turn before the newest user message.
- History rows are replayed byte-identically.
- The saved-context block is no longer unshifted as the first user message.

**`TIREH_PROMPT_SYSTEM_TAIL=1`:** an A/B arm that only works together with the cached prompt. It sends the per-turn block as a trailing `{role:'system'}` message, in `composeReply` only.

Effort stays `'low'` for every chat reply, constant per conversation. The doc gate is `cache_read_input_tokens` at or above 70% in staging. That is measured after merge using the existing `captureUsage`/`observedUsage` trace fields, not in this run.

## Files

### `src/lib/tireh/flags.ts` (new)
Byte-identical to shared contract file 1; `shasum -a 256` = `6b8edcd4bf18ca2f4d7a160f0a83077e823d6f491834abf54268a31433566630`.

### `src/lib/tireh/llm-content.ts` (new)
Byte-identical to shared contract file 2; sha256 = `4c83fe241a05bca3e61a0d2f4470398ccd07d0e20a22527f1537cdd3e548e663`. Provides CacheControl, SystemBlock, LLMSystem, systemText, LLMMessageExtras, LLMStopReason, LLMResponseMeta, VisionUnsupportedError, isVisionCapable and approxTokens. S03 uses only systemText, approxTokens and the types; S12 uses the rest.

### `src/lib/tireh/llm.ts`
Only the regions allowed by the ownership table.

1. **Imports and re-exports** after the existing imports: `systemText` and the types from `./llm-content`; re-export `CacheControl, SystemBlock, LLMSystem, LLMResponseMeta, LLMStopReason`.
2. **Types.** `LLMMessage extends LLMMessageExtras { role; content; images? }` (LLMImage unchanged). `LLMRequest.system: LLMSystem`. New `systemTail?: string` and `onMeta?: (meta: LLMResponseMeta) => void` with the contract JSDoc. Everything else unchanged.
3. **`normalizeTurns`.** Skip rule unchanged. New message: add `trailingText: [...]` only for a user message with non-empty trailingText; add `cacheControl: {...}` only when set; trailingText on assistant messages is dropped. Merge: concatenate user trailingText; the last defined cacheControl wins. Inputs without extras produce output deep-equal to the base (no `undefined`-valued keys).
4. **`anthropicTurns`.** Without extras: the exact base mapping. With extras: `[...imageBlocks, {type:'text', text: content || (images ? 'Describe the shared image.' : '')}, ...trailingText blocks]`, with `cache_control: {type:'ephemeral', ttl?}` on the LAST block only. Image blocks always come first.
5. **`geminiParts`.** Text part is `[content, ...(user ? trailingText : [])].join('\n\n')`; image parts unchanged.
6. **`cachedSystem(system: LLMSystem)`.** A string keeps the exact base `</rules>` split. An array maps each block to `{type:'text', text, cache_control?: {type:'ephemeral', ttl?}}` with no other transformation.
7. **System tail typing.** `SystemTailTurn = {role:'system'; content: string}`, `WireMessage = Anthropic.MessageParam | SystemTailTurn` (SDK 0.71 does not type mid-conversation system messages, documented like EffortBody). `wireMessages(request)` appends the tail when set. `AnthropicBody = Omit<MessageCreateParamsNonStreaming,'messages'> & EffortBody & {messages: WireMessage[]}`; `create` and `stream` pass it to the SDK through one commented narrowing cast.
8. **Callers.** `complete`, `stream` and `completeWithWeb` use `wireMessages(request)`. pause_turn continuations still push the assistant content at the end. Without `systemTail` the bodies are deep-equal to the base.
9. **Metadata.** Private `stopReasonOf` (six Anthropic values, else `'unknown'`) and `emitMeta` (no-op without `onMeta`; try/catch so a throwing getter or callback never changes delivery; token fields copied only when finite). Meta = `{provider:'anthropic', model, stopReason, inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens}`, never text. `complete` emits right after `create`, before the `requireComplete` throw. `completeWithWeb` emits once for the final response; the fallbacks delegate to `complete`, which emits itself. `stream` records `stop_reason` from `message_delta` and emits once in `finally` when a `message_start` was seen (`'unknown'` unless completed). `captureUsage`, `observedUsage` and `recordStage` unchanged.
10. **`GeminiLLM.complete`, two edits only:** `systemInstruction: systemText(system) + (systemTail ? '\n\n' + systemTail : '')`, and the outgoing text joins `trailingText` with `'\n\n'` when there are no images. Gemini ignores cacheControl and onMeta. Other Gemini lines and `createLLMFromEnv` are S15's.

`effort`, `supportsEffort`, `EffortBody`, `CHAT_EFFORT`, the authorization fences, `transportAuthority` and `webAnswer` are unchanged.

### `src/lib/tireh/conversation/prompt.ts`
`buildSystemPrompt(input): string` keeps its signature and output byte for byte (the golden snapshot is the guard). New:

- Imports: `createHash` from `crypto`; `approxTokens`, `SystemBlock` from `../llm-content`; `type LLMMessage` from `../llm` (no cycle).
- Exported constants: `MIN_CACHE_BLOCK_TOKENS = 512`, `MAX_PROMPT_MEMORY_CHARS = 210`, `PROACTIVE_GROUP_FRAME` (the exact base proactive sentence without its leading `\n\n`), `LIVE_CALL_FRAME` (the exact base `## Live voice call` text), `SAVED_CONTEXT_HEADER`.
- Private `TURN_CONTEXT_NOTE` (one plain paragraph explaining the `## For this turn` block, untrusted data that the rules outrank; only the final block counts) and `CACHE_PAD_LINE`.
- `padCacheBlock(text, minTokens = 512)`: unchanged when long enough, else `'\n\n'` plus as many pad lines as needed. Deterministic and pure.
- `personaBlock(persona, orgName, space, routed)` (Block A): `padCacheBlock(stablePersonaPrefix(...) + '\n\n' + TURN_CONTEXT_NOTE)`, org name removed for personal. Depends only on persona, org name, space and routed; never date, speaker, chat or memories.
- `orgSnapshotBlock(org, persona)` (Block B): `text` is exactly the base `## Organization` section; `key` is its sha256 hex. `null` reserved for a future audience-only cap.
- `PromptHooks { profileCard?, groupCard?, workingNotes? }`: L2 hooks, unused by the gateway in this run.
- `PromptLayout { system: SystemBlock[]; turn: string; hashes: {a; b|null; c} }` (first 16 hex of sha256).
- `buildPromptLayout(input & { savedContext?, relationshipContext?, extraFrame?, hooks? })`:
  - system: A (1h); B (1h) only when `space === 'work' && chat.kind === 'private' && !guestsPresent`; C (5m).
  - C (work): the Conversation section (group form without the latest-speaker line), `## People outside` with guests, `## How people relate` (private, no guests), `## Live information` when `persona.webSearch`, `## Your voice` when `canSpeak`, `## Capabilities`, the hooks (`## Profile card`, `## Group card`, `## Working notes`, each through plain()), then `extraFrame`. C (personal): the base Personal `## Conversation`, hooks, `extraFrame`. C never contains the date, memories, conflicts, saved context, relationship context, the reply-format line, `<active_skill>` or the latest speaker.
  - turn (work): `## For this turn`, `Today is YYYY-MM-DD.`, the group latest-speaker line, the base reply-format line; then `activeSkill`, the memories section (base headings and empty state; content clipped by `clipMemory`), the conflicts section (clipped), `SAVED_CONTEXT_HEADER + '\n' + JSON.stringify(savedContext)`, raw relationship context, and `FINAL_REMINDER` last. turn (personal): heading and date, the org-name-free active skill, saved context, relationship context, `FINAL_REMINDER`.
  - `clipMemory`: more than 210 code points gives the first 210 plus `…`, applied before JSON escaping.
- `attachTurnBlock(messages, turn, asSystemTail)`: finds the last user message (pushes one if none); tail mode returns `{systemTail: turn}`, otherwise sets `trailingText = [turn]`; in both cases sets `cacheControl: {type:'ephemeral'}` on the last assistant message before it. Mutates only the per-request message objects.

### `src/lib/tireh/gateway.ts`
Small edits in the allowed regions only; `boundary()`, `unchanged()`, the liveTurn recheck/stream loop, `requestAuthorized` and `exportAuthorizedNow` are untouched.

- (a) Imports: the `./conversation/prompt` line gains `attachTurnBlock, buildPromptLayout, LIVE_CALL_FRAME, PROACTIVE_GROUP_FRAME, type PromptInput`; `import { tirehFlags } from './flags';` right after.
- (b) composeReply: `promptInput` with the same fields and evaluation order (`now`, `canFollowUp`, `canSpeak`, then `relationshipContext`); `legacySystem` rebuilt from it with the same bytes. After `packedContext`, under the flag: `buildPromptLayout`, `attachTurnBlock`, no unshift; otherwise the base unshift. The request gets `systemTail` only when set. No `onMeta` is wired.
- (c) liveTurn: the same pattern with `LIVE_CALL_FRAME`; live calls never use the system tail.

### Test-support edits
- `src/lib/tireh/__tests__/fixtures.ts`: `FakeLLM.complete` only. Uses `systemText()` for the extraction check; records `replyPrompts` as the full model-visible text (system text, last user trailingText, systemTail) when system is an array or extras are present, else exactly as before.
- `src/lib/relationships/simulation/gateway-session.ts` and `src/lib/studio/scoped-relationship-drain.ts`: `systemText(request.system)`.

### New tests
- `__tests__/cached-prompt-baseline.test.ts`: golden snapshots generated on unmodified base code (commit 1) of `buildSystemPrompt`, the Anthropic/Gemini bodies and FakeLLM gateway requests; never regenerated. A second describe proves `TIREH_PROMPT_SYSTEM_TAIL=1` alone changes nothing.
- `__tests__/llm-blocks.test.ts`: string/array system serialization, normalizeTurns, anthropicTurns, systemTail, onMeta, Gemini, shared-file hashes.
- `conversation/__tests__/prompt-layout.test.ts`: Blocks A/B/C, turn, padding, hashes, attachTurnBlock, snapshots of A and B.
- `__tests__/cached-prompt-gateway.test.ts`: gateway behaviour with the flag on (FakeLLM plus wire-level checks with the mocked SDK).
- Wrappers that re-run existing suites under the flag: `cached-prompt-memory-privacy.test.ts` (plus a layout-vs-base memory parity matrix), `cached-prompt-gateway-suite.test.ts`, `cached-prompt-gateway-suite-tail.test.ts`, `cached-prompt-audience-boundary.test.ts`.

## Flags
- `TIREH_CACHED_PROMPT=1` (default off), read through `tirehFlags().cachedPrompt` at the start of each composeReply and liveTurn prompt assembly.
- `TIREH_PROMPT_SYSTEM_TAIL=1` (default off; effective only with the cached prompt, enforced in flags.ts). composeReply only.
- No other env is read. llm.ts is flag-free. `effort` stays `'low'` for every chat reply under both flag values.

## Acceptance
- Flags unset: the golden baseline passes without `-u`.
- Shared-file sha256 values match the contract.
- The lib-scoped `tsc` exits 0; full `tsc` reports only the base Privacy.tsx(111,6) TS17008.
- Flag off: `npx vitest run src/lib/tireh src/lib/adaptive/decisions` fully green; no new failing files in studio/relationships.
- Flag on (`TIREH_CACHED_PROMPT=1 npx vitest run src/lib/tireh`): all files pass except existing tests whose local fakes call string methods on `request.system` or read the saved-context row at `messages[0]` (enumerated in the report); each has a flag-on counterpart.
- Both flags on: the S03 test files are green.
- Full `npx vitest run`: no new failing files against the sandbox baseline.
- eslint clean on changed files; gateway.ts hunks confined to the allowed regions.
- No log, diagnostic, history row, audit row or `LLMResponseMeta` contains message, memory or prompt text; no new diagnostic codes or stage names.

## Out of scope
Step 1 (loadTurnSnapshot, revision vectors, single boundary, scalar unchanged, liveTurn rechecks, adaptive persistence seams); wiring onMeta, cache-hit alerting, hash-change alerts and pre-warming; `count_tokens` verification (needs the network); history length and compaction; real L2 card content (Step 7); the Block B audience-only cap; pre-pass v2 hints (S09); retrieval ranking (S06); image ingestion (S12); GeminiLLM deprecation and createLLMFromEnv (S15); proactiveContext, extraction and triage prompts (stay strings); studio suites under the flag; editing existing tests other than FakeLLM.complete; Privacy.tsx and package files.

## Risks
- Strict byte identity with flags unset: guarded by the golden snapshot generated before any change.
- gateway.ts merge conflicts with S09, S11L, S12 and the re-planned Step 1: edits stay inside the allowed regions and keep the `system`/`messages` identifiers.
- Cache string/array asymmetry: the breakpoint assistant turn is a block array in turn N and a string in turn N+1; verify `cache_read_input_tokens` in staging, and if needed always send block arrays under the flag.
- History beyond HISTORY_LIMIT=20 slides the window, so the messages cache misses; system blocks still hit.
- Web-search turns change C and form their own cache lineage.
- Prompt injection: memories and saved context move into the user role. Mitigated by TURN_CONTEXT_NOTE in A, FINAL_REMINDER at the end of the turn block, a separate content block and plain() on memory text. Evaluate in EN/FA quality checks before enabling.
- System-tail arm: Haiku 5.5 may treat mid-conversation system messages as untrusted; off by default.
- Breakpoint budget: A, B, C plus history is 4, the API maximum; a test asserts 4 or fewer.
- approxTokens overestimates English tokens; real Block A sizes are well above 512.
- Existing tests whose fakes treat `request.system` as a string fail under the flag; enumerated and covered by counterparts. The gateway-suite wrappers use a scoped test-only `Array.prototype.startsWith` shim; production code has no shim.
- Callers outside src/lib/tireh reading `request.system` as a string must use `systemText()` (S06, S08, S12 after merge).
- 1-hour cache writes cost 2x; measure before enabling broadly.
