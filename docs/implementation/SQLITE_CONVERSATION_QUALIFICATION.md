# Prepared Studio conversation consumer qualification

Author investigation on base `66d15a92bb7458a2b4c1982fc0e273bf0a7e1cd8` (20 October 2026). Product code is unchanged. This is a corrected synthetic qualification fixture, not independent acceptance, real-provider qualification or a deployment receipt.

The reported SQLite response was a safe fallback from an **unqualified test provider**, not a missing SQLite context resolver. `makeStudio()` installs generic `FakeLLM`, which does not advertise or implement the final committed transport fence. The compact gateway refuses to export saved context through that adapter and returns `The conversation settings changed. Please try again.` before calling the fake. The new regression reproduces that behavior on both prepared schema 2 formats with experiments removed and verifies zero fake-provider calls.

The reported FILEv2 comparison created `ManagedFileV2Storage` without a schema seed. That constructor defaults to canonical schema 1. Unlike indexed SQLite, that older FILE cohort does not satisfy `hasCommittedPersonalizationTransport`, so it did not exercise the same compact/final-authority path. The fixture includes a negative control proving the default schema and transport difference. These are separate qualification cohorts; successful legacy-FILE output does not qualify prepared FILEv2 or SQLite.

Production `runtime.ts` constructs `AnthropicLLM`, whose `committedExportFence` is backed by an asynchronous request authorization, an immediate synchronous check before the SDK operation, and another synchronous check inside its configured fetch after SDK preparation. With `STUDIO_WEB_SEARCH=off`, runtime preserves those guarantees in an ordinary-completion wrapper. There is no current `contextResolution` option or separate indexed loader installation: `AdaptiveService.readPrivateContext` automatically selects `readIndexedPrivateContext` from the storage adapter. Studio installs the async and synchronous context/audience authority readers on its gateway. Current Studio/canonical clocks must also be coherent; changing only an adaptive clock while retaining `makeStudio`'s fixed `T0` is not a realistic runtime setup.

## Corrected author fixture

`src/lib/studio/__tests__/prepared-conversation-qualification.test.ts` uses an explicit local schema 2 preparation followed by production `openLocalAdaptiveStorage` for both `sqlite-v1` and `file-v2`. Every file is a new disposable synthetic fixture. It installs the real adaptive repository/service, experience service, observer, experiment runtime and post-transaction experiment lifecycle reconciler, and aligns Studio/canonical clocks.

The provider is the installed `AnthropicLLM` with a synthetic key/model and an explicitly injected synthetic fetch; the fixture does not mark a generic fake as qualified. Global fetch is forbidden. The real signed conversation handler, real gateway, bounded private-context loader, provider serialization, SDK preparation/final fetch fence, observer and signed experiment exposure handler all run normally. Provider wire responses are synthetic and prove local integration only.

The tests independently assert the author fixture's async and synchronous authorization callback counts, a valid configured-fetch reply, presence of authorized synthetic saved context at that fetch, and absence of local fence functions in serialized provider input. A grant revoked during asynchronous SDK preparation must produce a non-success response with **zero configured fetches**, proving the transport fence is effective rather than just a type marker.

The full signed consumer journey covers:

- Valid baseline replies with experiments absent and with pilot presentation enabled.
- Zero exposure before actual client acknowledgment, then one accepted exposure.
- Operational kill retaining a valid core reply while dropping presentation and refusing the old acknowledgment.
- Analytics withdrawal refusing stale exposure and removing presentation/turn measurement while retaining the independently allowed saved context.
- Personalization withdrawal refusing stale exposure and removing saved context from the next valid core provider request.
- Separate-store experiment data excluding the synthetic private source text.

## Evidence and limits

Author command: `npx vitest run src/lib/studio/__tests__/prepared-conversation-qualification.test.ts` — **9 passed**, 12.94 seconds, against base `66d15a9` plus this test-only diff. `npx eslint src/lib/studio/__tests__/prepared-conversation-qualification.test.ts` and `git diff --check` also pass. Initial author fixture construction omitted the legacy empty directory required by explicit preparation; an initial guard counter instrumented `complete` while allowing `completeWithWeb`. The corrected fixture creates the explicit empty source directory and uses the production ordinary-completion wrapper. Neither required a product change or relaxed expected outcomes.

No reviewer fixture was edited. No production account/configuration, real provider call, message, deployed environment, browser or physical device was used. Local provider-adapter behavior does not establish provider approval, model quality or live runtime readiness. Next owner: an independent evaluator should inspect and run the corrected fixture against the combined candidate; the lead retains release qualification and disposition.
