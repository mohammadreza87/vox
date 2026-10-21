# S15: Vendor hygiene

Step 15 of [docs/AGENT_INTELLIGENCE_SOLUTION.md](../../AGENT_INTELLIGENCE_SOLUTION.md):
openai 7.39.0, the Decisions typed helper with a `post()` fallback, Gemini
deprecation, the PRIV-009 processor table and a route inventory.

Base commit: `6d00b8066e5d8e8d444bb47d978aa571e20929df` (origin/develop at the merge of PR #100).

## Goal

- Move `openai` from 6.9.1 to 7.39.0 (latest; floor 7.30.0) in a lockfile-only change.
- `OpenAIDecisionProvider` calls `client.decisions.create` when the installed SDK has
  it, keeps `client.post('/decisions')` as the fallback and keeps zod validation at the
  provider boundary.
- Pin the raw-fetch OpenAI wire formats in `media.ts` with compatibility tests.
- Mark the `GeminiLLM` path deprecated and warn at startup without deleting it.
- Add the PRIV-009 processor table and a route inventory for every route outside `/api/studio`.
- No new flags. Wire bodies are byte-identical to the base, and with no flags set Studio
  behaves exactly as at the base.

## Designer pre-checks (scratch worktree at 6d00b80)

- `npm view openai`: latest 7.39.0 (2026-10-19); 7.30.0 published 2026-10-06. The
  registry is reachable only with `--cache "$TMPDIR/..."` (root-owned files in `~/.npm/_cacache`).
- The only breaking change in 7.0.0 is "require Node.js 22"; the package has no runtime dependencies.
- Lib-scoped tsc exits 0 against 7.39.0 with no source change. `OpenAI['decisions'].create(body, options?)`
  exists; `client.post`, the `RequestOptions` fields `{signal, timeout, maxRetries}` and
  `APIConnectionTimeoutError` are unchanged.
- `npm install openai@^7.39.0 --package-lock-only --ignore-scripts` changes package.json and,
  in package-lock.json, the root range plus the `node_modules/openai` entry (version,
  resolved, integrity `sha512-iEA9ndbrj32vhYZwJg2v9BQVuztGUOb2SBQU16ZcWNkQHWEBjtarxjqR9c6d5PbWMG0Eyfhk66OZ0iJ8XpFjyw==`,
  engines node>=22, new optional peers, bin removed).

## Files

| Path | Change |
|---|---|
| `package.json` | One line: `"openai": "^6.9.1"` becomes `"openai": "^7.39.0"`. No engines, no other dependency. |
| `package-lock.json` | Generated with `npm install openai@^7.39.0 --package-lock-only --ignore-scripts --cache "$TMPDIR/npm-cache-s15"`. Only the root range and the `node_modules/openai` entry change. If the registry is unreachable, skip both files and record the commands. |
| test environment (not committed) | Symlink farm: a real `node_modules` directory with every entry of the main checkout symlinked except `openai`, which points at an unpacked `openai-7.39.0` tarball in `$TMPDIR`. Tests run on both 7.39.0 (farm) and 6.9.1 (plain symlink). |
| `src/lib/adaptive/decisions/index.ts` | Only the `OpenAIDecisionProvider` class body (S09 owns the rest). Constructor and `guarded()` unchanged. `evaluate` gains an optional 4th `options?: { readonly timeoutMs?: number }`; the zod re-parse is unchanged; same body `{model, input, questions, prompt_cache_options: {mode: 'explicit'}}`; request options `{signal, timeout, maxRetries: 0}`; typed `client.decisions.create` when present, else `client.post('/decisions', {body, ...request})`; both inside `decisionAuthority.run`. Private static `requestTimeoutMs` (500 when not finite, else `Math.floor` clamped to `[1, 5000]`) and `typedCreate` (structural detection via `Reflect.get`, no compile-time reference to `OpenAI['decisions']`). Header comment and schemas untouched. |
| `src/lib/adaptive/decisions/README.md` | Only the SDK paragraph. |
| `src/lib/studio/media.ts` | No source change: `OpenAIMedia` uses injectable raw fetch, not the SDK. Pinned by a new test. |
| `src/app/api/stt/route.ts`, `src/app/api/chat/route.ts`, `src/app/api/chat/stream/route.ts`, `src/lib/adaptive/improvement/software-author.ts`, `src/services/implementations/EmbeddingService.ts` | No change expected; a minimal type fix only if tsc or tests fail after the upgrade. |
| `src/lib/tireh/llm.ts` | `@deprecated` JSDoc above `GeminiLLM` (body unchanged); `GEMINI_DEPRECATION_WARNING` constant above `createLLMFromEnv`; signature `createLLMFromEnv(env = process.env, log: Pick<Console, 'warn'> = console)`; one fixed `log.warn` in the gemini branch after the key check. Anthropic, default and error branches byte-identical. |
| `docs/TIREH_PERSONAS.md` | "Gemini (deprecated)" note before `## Testing`; "(deprecated)" in the two places that offer Gemini. |
| `docs/implementation/PRIVACY_AND_CONSENT.md` | New PRIV-009a processor table (10 rows) right after the PRIV-009 paragraph; unverified cells read exactly `verify on account dashboard`; TODO for the sanctions/jurisdiction counsel view. |
| `docs/implementation/ROUTE_INVENTORY.md` (new) | Every `route.ts` under `src/app/api` outside `/api/studio`: methods, auth found at the base, providers/data, surface, retire/keep/secure and reason; a "Decisions needed" list. No route changes. |
| `src/lib/adaptive/decisions/openai-compat.test.ts` (new) | Decisions provider compatibility tests. |
| `src/lib/studio/__tests__/openai-compat.test.ts` (new) | `OpenAIMedia` wire-format pinning. |
| `src/lib/tireh/__tests__/gemini-deprecation.test.ts` (new) | `createLLMFromEnv` warning tests. |

## Interfaces

```ts
// src/lib/adaptive/decisions/index.ts (OpenAIDecisionProvider class body only)
export class OpenAIDecisionProvider implements DecisionProvider {
  readonly committedExportFence?: true;
  constructor(client: Pick<OpenAI, 'post'>, guard?: typeof guardedProvider);                 // unchanged
  static guarded(options: { apiKey: string; dangerouslyAllowBrowser?: boolean }, transportFetch?: typeof fetch): OpenAIDecisionProvider; // unchanged
  /** client.decisions.create when present (openai >= 7.30.0), else client.post('/decisions'); maxRetries 0; timeout = options.timeoutMs clamped [1, 5000], default 500. */
  evaluate(input: DecisionInput, signal: AbortSignal, authorizeNow?: () => boolean, options?: { readonly timeoutMs?: number }): Promise<unknown>;
  private static requestTimeoutMs(value: number | undefined): number;
  private static typedCreate(client: object): ((body: object, options: { signal: AbortSignal; timeout: number; maxRetries: 0 }) => Promise<unknown>) | null;
}

// src/lib/tireh/llm.ts (S15 regions only)
/** @deprecated ... */ export class GeminiLLM implements LLM { /* body unchanged */ }
export const GEMINI_DEPRECATION_WARNING: string;
export function createLLMFromEnv(env?: NodeJS.ProcessEnv, log?: Pick<Console, 'warn'>): LLM;
```

## Flags

- No new flags. The SDK upgrade cannot be put behind a flag; the typed decisions path is
  wire-identical (same URL, body, retries and timeout). With every flag unset,
  `DecisionService` passes no options, so the provider timeout stays 500 ms.
- Existing env values are read unchanged (`OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL`,
  `OPENAI_STT_MODEL`, `OPENAI_DECISION_MODEL`, `STUDIO_DECISIONS`, `STUDIO_DECISIONS_ENABLED`,
  `STUDIO_WEB_SEARCH`, `TIREH_LLM_PROVIDER`, `TIREH_LLM_MODEL`, `GEMINI_API_KEY`).
- `TIREH_LLM_PROVIDER=gemini` keeps working; its only new behaviour is one fixed
  `console.warn` per `createLLMFromEnv` call.

## Tests

- Decisions `openai-compat.test.ts`: the installed SDK exposes `decisions.create`; typed
  path (spy, single POST to `https://api.openai.com/v1/decisions`, bearer header, exact
  body, no signal/timeout/authorizeNow keys); fallback for `{ post }` fakes and for
  `decisions` objects without a `create` function; timeout clamping on both paths
  (1200, 0 to 1, 60000 to 5000, 12.7 to 12, NaN/undefined to 500); zod boundary (eight
  questions, an unknown key, `input_audio` reject before fetch; a low-detail image passes);
  transport fence on the typed path (authority flip and abort give 0 fetches; a concurrent
  permitted request gives exactly 1); no retries and `DecisionService` mapping through the
  real SDK (500 gives provider_error with 1 fetch, 429 rate_limited, 404 unsupported, a full
  answer gives answered with inputTokens 10); an SDK timeout rejects with
  `OpenAI.APIConnectionTimeoutError` (instanceof only).
- Studio `openai-compat.test.ts`: `media.ts` has no SDK import; `generateAvatar`,
  `transcribe` and `decide` wire formats, errors and env overrides; a canary check that
  thrown messages and console calls never contain input, prompt or audio content.
- `gemini-deprecation.test.ts`: the warning fires exactly once for gemini, with no env
  values; never for anthropic; error branches unchanged and silent.
- Regression: lib tsc on 7.39.0 and 6.9.1; focused vitest on both; eslint on changed files.

## Acceptance

- package.json changes one line; package-lock.json changes only the root range and the
  `node_modules/openai` entry with the integrity above (or the PR records why the registry
  was unreachable, with the exact commands).
- Lib-scoped tsc exits 0 on 7.39.0 and 6.9.1; full tsc reports only the known
  `Privacy.tsx(111,6)` TS17008.
- On 7.39.0 the provider uses `client.decisions.create` (spy-proven) with base-identical
  body, URL, retries (0) and timeout (500 with no options); on `post`-only fakes and on
  6.9.1 it uses `client.post('/decisions')`; zod re-validation runs before both.
- `transport-fence.test.ts`, `decisions.test.ts`, `indexed-controls.test.ts` and
  `sync-authority.test.ts` pass unmodified on 7.39.0; no existing test file is edited.
- `OpenAIMedia` source unchanged, its wire formats pinned.
- `GeminiLLM` carries `@deprecated`; `createLLMFromEnv` warns only for gemini; the default
  anthropic path is byte-identical and silent.
- PRIV-009a table with the 10 rows; every unverified cell reads `verify on account dashboard`.
- ROUTE_INVENTORY.md lists all route.ts files under `src/app/api` outside `/api/studio`.
- PR description: the Gemini recommendation, the Node 22 runtime note and the commands used.

## Out of scope

- Decisions schemas, caps, the `DecisionProvider` interface, deadline handling and the
  `DecisionService` body, including its timeout classification (S09).
- Migrating `OpenAIMedia.decide` to `DecisionService` or adding `prompt_cache_options` to it.
- Any change to the behaviour of routes outside `/api/studio` (document only).
- Deleting `GeminiLLM`, `@google/generative-ai`, the standalone TIREH runtime or the legacy
  Telegram webhook.
- S03-owned lines in llm.ts; package.json engines, CI Node versions, Firebase runtime config;
  ZDR/EU account configuration and verified processor-table values; Step 1 code; S06's
  `OpenAIEmbeddingProvider`.

## Risks

- openai 7 requires Node >= 22. CI uses 22.23.3, deploy.yml uses '22', PRODUCTION.md says
  the Mac runs Node 22. The Firebase frameworksBackend runtime is not pinned, so the operator
  must confirm Node 22 for Cloud Functions before deploying.
- 7.39.0 was published one day before this run; the lockfile pins its integrity hash.
- The typed path wraps the `APIPromise` in `Promise.resolve`; nothing uses APIPromise helpers here.
- Pre-existing defect (report to S09): `DecisionService` maps timeouts via
  `error.name === 'APIConnectionTimeoutError'`, but the SDK sets `name` to `'Error'` on
  6.9.1 and 7.39.0, so SDK timeouts are labelled `provider_error`.
- Merge with S09 in decisions/index.ts: take S15's class body and S09's everything else.
- Merge with S03 in llm.ts: keep both sides of adjacent hunks.
- Never run npm install through a symlinked node_modules; every npm command needs
  `--cache "$TMPDIR/npm-cache-s15"`.
- The 7.x lockfile entry drops the openai bin; no script uses it.
- `next build` cannot be a gate (the base fails on Privacy.tsx); rely on the lib tsc and vitest.
