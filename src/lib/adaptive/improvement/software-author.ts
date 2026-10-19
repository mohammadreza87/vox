/** One-shot provider author. Model output remains data until protected Docker evaluation. */
import OpenAI from 'openai';
import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';
import { z } from 'zod';
import { attest, canonical, hash, identifier, validateTrust, verifyAttestation, type Attestation, type TrustStore } from './contracts';
import { softwareFindingSchema, softwareProposalSchema, softwareBaseBinding, type SoftwareFinding, type SoftwareProposal } from './software-workflow';
import { createSyntheticPersianPatch, materializeSoftwarePatch } from './software-patch';
import { modelSoftwarePatchArtifactSchema, type FrozenSoftwareBase } from './software-contracts';
import { SOFTWARE_AUTHOR_ENDPOINT, SOFTWARE_AUTHOR_INSTRUCTIONS, SOFTWARE_AUTHOR_MAX_OUTPUT_TOKENS, SOFTWARE_AUTHOR_MODEL,
  SOFTWARE_AUTHOR_PATCH_JSON_SCHEMA, SOFTWARE_AUTHOR_POLICY_DIGEST, SOFTWARE_AUTHOR_TIMEOUT_MS,
  softwareAuthorAttemptSchema, softwareAuthorInputDigest, softwareAuthorPublicInput, type SoftwareAuthorAttempt } from './software-author-contracts';

export interface SoftwareAuthorContext { signedFinding: Attestation<SoftwareFinding>; signedProposal: Attestation<SoftwareProposal>; base: FrozenSoftwareBase }
export interface SoftwareAuthorTransport { create(request: ResponseCreateParamsNonStreaming, options: { signal: AbortSignal }): Promise<unknown> }
/** Provider credentials stay in this host closure. Endpoint cannot come from a model or request. */
export function createOpenAISoftwareAuthorTransport(apiKey: string): SoftwareAuthorTransport {
  if (!apiKey.trim()) throw new Error('software_author_credential_required');
  const client = new OpenAI({ apiKey, baseURL: SOFTWARE_AUTHOR_ENDPOINT, timeout: SOFTWARE_AUTHOR_TIMEOUT_MS, maxRetries: 0 });
  return { create: (request, options) => client.responses.create(request, { signal: options.signal, timeout: SOFTWARE_AUTHOR_TIMEOUT_MS, maxRetries: 0 }) };
}
export interface AuthorSoftwarePatchOptions {
  /** Trusted registry method; rechecks current baseline, expiry and revoked lineage.
   * It must never be supplied by a web request or untrusted candidate. */
  context: () => Promise<SoftwareAuthorContext>;
  reserve: (context: SoftwareAuthorContext) => Promise<{ reservationDigest: string; issuedAt: number }>;
  trust: TrustStore | (() => TrustStore); authorKeyId: string; authorPrivateKey: string;
  transport: SoftwareAuthorTransport; now?: () => number;
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function verifyContext(context: SoftwareAuthorContext, options: AuthorSoftwarePatchOptions, now: number) {
  const trust = typeof options.trust === 'function' ? options.trust() : options.trust;
  validateTrust(trust);
  if (!verifyAttestation(context.signedFinding, 'analyst', 'software_finding', trust) ||
    !verifyAttestation(context.signedProposal, 'author', 'software_proposal', trust) || context.signedProposal.keyId !== options.authorKeyId) throw new Error('untrusted_software_author_context');
  const finding = softwareFindingSchema.parse(context.signedFinding.payload);
  const proposal = softwareProposalSchema.parse(context.signedProposal.payload);
  if (proposal.authorMode !== 'openai_responses' || proposal.authorPolicyDigest !== SOFTWARE_AUTHOR_POLICY_DIGEST ||
    proposal.findingId !== finding.id || finding.reviewedAt > now || finding.expiresAt <= now || proposal.createdAt < finding.reviewedAt || proposal.createdAt > now ||
    !same(finding.base, softwareBaseBinding(context.base)) || !same(proposal.base, finding.base)) throw new Error('ineligible_software_author_context');
  // Verifies exact source SHA256/Git blob and the reviewed synthetic reproduction seam.
  createSyntheticPersianPatch(context.base, finding.issueId, proposal.policyDigest);
  return { finding, proposal };
}
const token = z.number().int().nonnegative().max(10000000);
const usageSchema = z.object({ input_tokens: token, output_tokens: token, total_tokens: token }).refine(u => u.total_tokens === u.input_tokens + u.output_tokens);
function projectProvider(value: unknown) {
  const response = z.object({ id: identifier, model: z.literal(SOFTWARE_AUTHOR_MODEL), status: z.string(),
    output: z.array(z.unknown()).max(16), usage: z.unknown().optional(), error: z.unknown().optional(), incomplete_details: z.unknown().optional() }).parse(value);
  const usage = usageSchema.safeParse(response.usage);
  return { response, usage: usage.success ? usage.data : null };
}
export async function authorSoftwarePatch(options: AuthorSoftwarePatchOptions) {
  const now = options.now ?? Date.now;
  const initial = await options.context(); const { finding } = verifyContext(initial, options, now());
  const trust = typeof options.trust === 'function' ? options.trust() : options.trust;
  const keyProbe = attest(options.authorKeyId, options.authorPrivateKey, 'software_author_key_check', { sourceDigest: initial.base.baseSourceDigest });
  if (!verifyAttestation(keyProbe, 'author', 'software_author_key_check', trust)) throw new Error('software_author_key_mismatch');
  const reservation = await options.reserve(initial); const startedAt = now();
  if (!/^[a-f0-9]{64}$/.test(reservation.reservationDigest) || !Number.isSafeInteger(reservation.issuedAt) || reservation.issuedAt < 0 || reservation.issuedAt > startedAt) throw new Error('invalid_author_reservation');
  // Recheck after reservation: revocation while acquiring the durable budget must prevent dispatch.
  const dispatchContext = await options.context(); verifyContext(dispatchContext, options, now());
  if (!same(initial, dispatchContext)) throw new Error('software_author_context_changed');
  const request: ResponseCreateParamsNonStreaming = {
    model: SOFTWARE_AUTHOR_MODEL, reasoning: { effort: 'low' }, instructions: SOFTWARE_AUTHOR_INSTRUCTIONS,
    input: canonical(softwareAuthorPublicInput(initial.base.source)), max_output_tokens: SOFTWARE_AUTHOR_MAX_OUTPUT_TOKENS,
    store: false, stream: false, tools: [], tool_choice: 'none',
    text: { format: { type: 'json_schema', name: 'software_patch', strict: true, schema: SOFTWARE_AUTHOR_PATCH_JSON_SCHEMA } },
  };
  let status: SoftwareAuthorAttempt['status'] = 'provider_error';
  let returnedModel: typeof SOFTWARE_AUTHOR_MODEL | null = null; let responseId: string | null = null;
  let inputTokens: number | null = null, outputTokens: number | null = null, totalTokens: number | null = null;
  let patch: string | undefined; let result: ReturnType<typeof materializeSoftwarePatch> | undefined;
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('software_author_timeout')); }, SOFTWARE_AUTHOR_TIMEOUT_MS); });
    const raw = await Promise.race([options.transport.create(request, { signal: controller.signal }), deadline]);
    const projected = projectProvider(raw); const response = projected.response;
    returnedModel = response.model; responseId = response.id;
    if (projected.usage) { inputTokens = projected.usage.input_tokens; outputTokens = projected.usage.output_tokens; totalTokens = projected.usage.total_tokens; }
    if (response.status !== 'completed' || response.error != null || response.incomplete_details != null) status = 'incomplete';
    else {
      const messages: string[] = []; let refusal = false; let invalid = false;
      for (const item of response.output) {
        const kind = z.object({ type: z.string() }).safeParse(item);
        if (!kind.success) { invalid = true; break; }
        if (kind.data.type === 'reasoning') continue;
        const message = z.object({ type: z.literal('message'), role: z.literal('assistant'), status: z.literal('completed'), content: z.array(z.unknown()).min(1).max(2) }).safeParse(item);
        if (!message.success) { invalid = true; break; }
        for (const content of message.data.content) {
          if (z.object({ type: z.literal('refusal'), refusal: z.string() }).safeParse(content).success) { refusal = true; continue; }
          const text = z.object({ type: z.literal('output_text'), text: z.string().max(40000) }).safeParse(content);
          if (!text.success) invalid = true; else messages.push(text.data.text);
        }
      }
      if (refusal) status = 'refused';
      else if (invalid || messages.length !== 1 || !projected.usage || projected.usage.output_tokens > SOFTWARE_AUTHOR_MAX_OUTPUT_TOKENS) status = 'incomplete';
      else {
        try {
          const output = z.object({ patch: z.string().min(1).max(32768) }).strict().parse(JSON.parse(messages[0]));
          result = materializeSoftwarePatch(initial.base, output.patch); patch = output.patch; status = 'completed';
        } catch { status = 'invalid_patch'; }
      }
    }
  } catch {
    status = controller.signal.aborted ? 'timeout' : 'provider_error';
  } finally { if (timer) clearTimeout(timer); }
  if (status === 'completed') {
    try {
      const current = await options.context(); verifyContext(current, options, now());
      if (!same(initial, current)) throw new Error('software_author_context_changed');
    } catch { status = 'incomplete'; patch = undefined; result = undefined; }
  }
  const attempt = softwareAuthorAttemptSchema.parse({ schemaVersion: 1, reservationDigest: reservation.reservationDigest,
    findingDigest: hash(canonical(initial.signedFinding)), proposalDigest: hash(canonical(initial.signedProposal)),
    inputDigest: softwareAuthorInputDigest(initial.base.source), sourceDigest: initial.base.baseSourceDigest,
    authorPolicyDigest: SOFTWARE_AUTHOR_POLICY_DIGEST, requestedModel: SOFTWARE_AUTHOR_MODEL, returnedModel, responseId, status,
    inputTokens, outputTokens, totalTokens, patchDigest: status === 'completed' ? result!.patchDigest : null,
    startedAt, finishedAt: now() });
  const receipt = { ...attest(options.authorKeyId, options.authorPrivateKey, 'software_author_attempt', attempt), purpose: 'software_author_attempt' as const };
  if (!patch || !result || status !== 'completed') return { receipt, artifact: undefined };
  const artifact = modelSoftwarePatchArtifactSchema.parse({ schemaVersion: 2, authorMode: 'openai_responses', patch,
    authorReceiptDigest: hash(canonical(receipt)), identity: { schemaVersion: 1, issueId: finding.issueId,
      repositoryCommit: initial.base.repositoryCommit, repositoryTreeOid: initial.base.repositoryTreeOid, targetPath: initial.base.targetPath,
      baseBlobOid: initial.base.baseBlobOid, baseSourceDigest: initial.base.baseSourceDigest, patchDigest: result.patchDigest,
      resultSourceDigest: result.resultSourceDigest, policyDigest: initial.signedProposal.payload.policyDigest } });
  return { receipt, artifact };
}
