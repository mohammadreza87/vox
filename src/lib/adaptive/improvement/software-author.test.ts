import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { attest, canonical, hash, verifyAttestation, type Authority, type TrustStore } from './contracts';
import { SOFTWARE_TARGET_PATH } from './software-contracts';
import { softwareBaseBinding, type ModelSoftwareProposal, type SoftwareFinding } from './software-workflow';
import { SOFTWARE_POLICY_DIGEST } from './software-sandbox';
import { createSyntheticPersianPatch } from './software-patch';
import { SOFTWARE_AUTHOR_ENDPOINT, SOFTWARE_AUTHOR_MODEL, SOFTWARE_AUTHOR_POLICY_DIGEST, softwareAuthorInputDigest } from './software-author-contracts';
import { authorSoftwarePatch, createOpenAISoftwareAuthorTransport, type AuthorSoftwarePatchOptions, type SoftwareAuthorContext } from './software-author';
const sdk = vi.hoisted(() => ({ configurations: [] as unknown[], create: vi.fn() }));
vi.mock('openai', () => ({ default: class { responses = { create: sdk.create }; constructor(configuration: unknown) { sdk.configurations.push(configuration); } } }));
afterEach(() => { vi.useRealTimers(); sdk.create.mockReset(); sdk.configurations.length = 0; });
function setup() {
  const trust: TrustStore = {}; const privateKeys: Record<string, string> = {};
  for (const role of ['analyst', 'author', 'evaluator', 'human'] as Authority[]) {
    const pair = generateKeyPairSync('ed25519'); trust[role] = { role, publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
    privateKeys[role] = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  }
  const source = readFileSync(process.cwd() + '/src/lib/adaptive/improvement/fixtures/sentence-detector-base.ts.txt', 'utf8');
  const base = { repositoryCommit: '1'.repeat(40), repositoryTreeOid: '2'.repeat(40), targetPath: SOFTWARE_TARGET_PATH,
    source, baseSourceDigest: hash(source), baseBlobOid: createHash('sha1').update(`blob ${Buffer.byteLength(source)}\0${source}`).digest('hex') };
  const now = 100000;
  const finding: SoftwareFinding = { schemaVersion: 1, id: 'secret_finding_identifier', issueId: 'secret_issue_identifier', kind: 'synthetic',
    problemCode: 'persian_sentence_boundary', purpose: 'product_improvement', base: softwareBaseBinding(base), lineageIds: [hash('PRIVATE_CANARY_LINEAGE')],
    sampleCount: 1, failureCount: 1, reviewedAt: now - 1, expiresAt: now + 60000 };
  const proposal: ModelSoftwareProposal = { schemaVersion: 2, id: 'secret_proposal_identifier', findingId: finding.id,
    hypothesis: 'recognize_persian_question_mark', authorMode: 'openai_responses', base: softwareBaseBinding(base), policyDigest: SOFTWARE_POLICY_DIGEST,
    authorPolicyDigest: SOFTWARE_AUTHOR_POLICY_DIGEST, createdAt: now, budget: { maxCandidates: 1, maxCases: 12 } };
  const context: SoftwareAuthorContext = { signedFinding: attest('analyst', privateKeys.analyst, 'software_finding', finding),
    signedProposal: attest('author', privateKeys.author, 'software_proposal', proposal), base };
  const patch = createSyntheticPersianPatch(base, finding.issueId, SOFTWARE_POLICY_DIGEST).patch;
  const response = { id: 'resp_synthetic', model: SOFTWARE_AUTHOR_MODEL, status: 'completed', usage: { input_tokens: 500, output_tokens: 100, total_tokens: 600 },
    output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ patch }) }] }] };
  const create = vi.fn().mockResolvedValue(response);
  const options: AuthorSoftwarePatchOptions = { context: vi.fn().mockResolvedValue(context), reserve: vi.fn().mockResolvedValue({ reservationDigest: hash('reservation'), issuedAt: now }),
    trust, authorKeyId: 'author', authorPrivateKey: privateKeys.author, transport: { create }, now: () => now };
  return { trust, privateKeys, context, response, create, options, patch, now };
}
describe('bounded model software author', () => {
  it('uses one credential-free minimized request and signs actual patch provenance', async () => {
    const s = setup(); const result = await authorSoftwarePatch(s.options);
    expect(s.create).toHaveBeenCalledTimes(1); expect(s.options.reserve).toHaveBeenCalledTimes(1); expect(s.options.context).toHaveBeenCalledTimes(3);
    const request = s.create.mock.calls[0][0];
    expect(request).toMatchObject({ model: 'gpt-6.1-sol', store: false, stream: false, tools: [], tool_choice: 'none', max_output_tokens: 2048,
      reasoning: { effort: 'low' }, text: { format: { type: 'json_schema', strict: true } } });
    const serialized = JSON.stringify(request);
    for (const forbidden of [s.context.signedFinding.payload.id, s.context.signedFinding.payload.issueId, s.context.signedProposal.payload.id,
      ...s.context.signedFinding.payload.lineageIds, s.context.signedFinding.signature, s.privateKeys.author, 'protectedCorpus', 'privateKey']) expect(serialized).not.toContain(forbidden);
    expect(JSON.parse(request.input).source).toBe(s.context.base.source);
    expect(result.receipt.payload).toMatchObject({ status: 'completed', inputDigest: softwareAuthorInputDigest(s.context.base.source), inputTokens: 500, outputTokens: 100, totalTokens: 600, patchDigest: hash(s.patch) });
    expect(verifyAttestation(result.receipt, 'author', 'software_author_attempt', s.trust)).toBe(true);
    expect(result.artifact).toMatchObject({ schemaVersion: 2, authorMode: 'openai_responses', patch: s.patch, authorReceiptDigest: hash(canonical(result.receipt)) });
  });
  it('fixes provider endpoint, retries and timeout independently of environment defaults', async () => {
    const transport = createOpenAISoftwareAuthorTransport('HOST_ONLY_SYNTHETIC_KEY');
    expect(sdk.configurations).toEqual([{ apiKey: 'HOST_ONLY_SYNTHETIC_KEY', baseURL: SOFTWARE_AUTHOR_ENDPOINT, timeout: 30000, maxRetries: 0 }]);
    sdk.create.mockResolvedValue({}); const s = setup(); await authorSoftwarePatch({ ...s.options, transport });
    expect(sdk.create.mock.calls[0][1]).toMatchObject({ timeout: 30000, maxRetries: 0 });
    expect(sdk.create.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(() => createOpenAISoftwareAuthorTransport(' ')).toThrow('credential_required');
  });
  it.each([
    ['refused', { output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: 'cannot comply' }] }] }],
    ['incomplete', { status: 'incomplete' }], ['incomplete', { usage: null }], ['incomplete', { usage: { input_tokens: 1, output_tokens: 2, total_tokens: 999 } }],
    ['incomplete', { output: [{ type: 'function_call', name: 'exec', arguments: '{}' }] }],
    ['incomplete', { output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{}' }] }, { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{}' }] }] }],
    ['provider_error', { model: 'unapproved-model' }],
    ['invalid_patch', { output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'not JSON' }] }] }],
    ['invalid_patch', { output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ patch: 'arbitrary code', expected: 'pass' }) }] }] }],
  ])('records %s truthfully without creating a candidate', async (status, changes) => {
    const s = setup(); s.create.mockResolvedValue({ ...s.response, ...changes }); const result = await authorSoftwarePatch(s.options);
    expect(result.receipt.payload.status).toBe(status); expect(result.receipt.payload.patchDigest).toBeNull(); expect(result.artifact).toBeUndefined(); expect(s.create).toHaveBeenCalledTimes(1);
  });
  it.each(['path', 'oversized', 'wrong_context'])('rejects %s patch without evaluating or executing it', async kind => {
    const s = setup(); const patch = kind === 'path' ? s.patch.replace(SOFTWARE_TARGET_PATH, '../secret.ts') : kind === 'oversized' ? 'x'.repeat(32769) : s.patch.replace('  // Uses a more robust pattern', '  // invented context');
    s.create.mockResolvedValue({ ...s.response, output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ patch }) }] }] });
    const result = await authorSoftwarePatch(s.options); expect(result.artifact).toBeUndefined(); expect(result.receipt.payload.status).toBe('invalid_patch');
  });
  it('retains known over-budget usage truthfully but withholds candidate', async () => {
    const s = setup(); s.create.mockResolvedValue({ ...s.response, usage: { input_tokens: 500, output_tokens: 2049, total_tokens: 2549 } });
    const result = await authorSoftwarePatch(s.options);
    expect(result.receipt.payload).toMatchObject({ status: 'incomplete', inputTokens: 500, outputTokens: 2049, totalTokens: 2549, patchDigest: null });
    expect(result.artifact).toBeUndefined();
  });
  it('checks fresh time after awaiting dispatch context so expired findings never dispatch', async () => {
    const s = setup(); let clock = s.now; let reads = 0;
    await expect(authorSoftwarePatch({ ...s.options, now: () => clock, context: async () => {
      if (++reads === 2) clock += 60000;
      return s.context;
    } })).rejects.toThrow('ineligible_software_author_context');
    expect(s.options.reserve).toHaveBeenCalledTimes(1); expect(s.create).not.toHaveBeenCalled();
  });
  it('hard aborts a transport that ignores SDK timeout and never retries', async () => {
    vi.useFakeTimers(); const s = setup(); let signal: AbortSignal | undefined;
    s.create.mockImplementation((_request, options) => { signal = options.signal; return new Promise(() => undefined); });
    const pending = authorSoftwarePatch(s.options); await vi.advanceTimersByTimeAsync(30000); const result = await pending;
    expect(signal?.aborted).toBe(true); expect(s.create).toHaveBeenCalledTimes(1); expect(result.artifact).toBeUndefined();
    expect(result.receipt.payload).toMatchObject({ status: 'timeout', responseId: null, inputTokens: null, outputTokens: null, totalTokens: null });
  });
  it('keeps unknown provider-error usage unavailable and excludes raw errors', async () => {
    const s = setup(); s.create.mockRejectedValue(new Error('SECRET_PROVIDER_ERROR')); const result = await authorSoftwarePatch(s.options);
    expect(result.receipt.payload).toMatchObject({ status: 'provider_error', inputTokens: null, outputTokens: null, totalTokens: null });
    expect(JSON.stringify(result)).not.toContain('SECRET_PROVIDER_ERROR');
  });
  it('rejects forged signatures, wrong author key and expired findings before reservation or dispatch', async () => {
    const s = setup(); const signedFinding = { ...s.context.signedFinding, signature: 'forged' };
    await expect(authorSoftwarePatch({ ...s.options, context: async () => ({ ...s.context, signedFinding }) })).rejects.toThrow('untrusted_software_author_context');
    await expect(authorSoftwarePatch({ ...s.options, authorPrivateKey: s.privateKeys.analyst })).rejects.toThrow('software_author_key_mismatch');
    await expect(authorSoftwarePatch({ ...s.options, now: () => s.now + 60000 })).rejects.toThrow('ineligible_software_author_context');
    expect(s.options.reserve).not.toHaveBeenCalled(); expect(s.create).not.toHaveBeenCalled();
  });
  it('does not dispatch when durable reservation is refused or context revokes during reservation', async () => {
    const s = setup(); await expect(authorSoftwarePatch({ ...s.options, reserve: async () => { throw new Error('author_attempt_already_reserved'); } })).rejects.toThrow('author_attempt_already_reserved');
    let reads = 0; await expect(authorSoftwarePatch({ ...s.options, context: async () => { if (++reads > 1) throw new Error('finding_ineligible'); return s.context; } })).rejects.toThrow('finding_ineligible');
    expect(s.create).not.toHaveBeenCalled();
  });
  it('preserves known usage but withholds artifact if lineage is revoked before candidate creation', async () => {
    const s = setup(); let reads = 0;
    const result = await authorSoftwarePatch({ ...s.options, context: async () => { if (++reads > 2) throw new Error('revoked'); return s.context; } });
    expect(result.receipt.payload).toMatchObject({ status: 'incomplete', inputTokens: 500, outputTokens: 100, totalTokens: 600, patchDigest: null }); expect(result.artifact).toBeUndefined();
  });
});
