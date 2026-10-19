import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { attest, canonical, datasetSchema, hash, routingArtifactSchema, type RoutingArtifact, type RoutingDataset } from './contracts';
import type { ImprovementCandidate } from './index';
import type { ProtectedEvaluation } from './workflow';
const execute = promisify(execFile);
/** Evaluator-owned fixed program. Candidate content is parsed as data only. No
 * eval/import/shell or candidate-authored test output is consumed. */
export const EVALUATOR_PROGRAM = `const fs = require('node:fs');
const candidate = JSON.parse(fs.readFileSync('/input/candidate.json','utf8'));
const baseline = JSON.parse(fs.readFileSync('/input/baseline.json','utf8'));
const dataset = JSON.parse(fs.readFileSync('/protected/dataset.json','utf8'));
const action = (config, item) => item.cancelled ? (config.onCancelled === 'stop' ? 'stop' : 'continue') : config.onActive;
let candidateFailures=0, baselineFailures=0;
for(const item of dataset.cases){ candidateFailures += Number(action(candidate,item)!==item.expected); baselineFailures += Number(action(baseline,item)!==item.expected); }
process.stdout.write(JSON.stringify({checks:dataset.cases.length,candidateFailures,baselineFailures}));`;
export const EVALUATOR_DIGEST = hash(EVALUATOR_PROGRAM);
export const POLICY_DIGEST = hash(canonical({ version: 1, zeroFailures: true, noSkipped: true, finalSetUsesPerRegistry: 1, humanRelease: true, productionMutation: false }));
export interface IsolatedEvaluationOptions { candidate: ImprovementCandidate; artifact: RoutingArtifact; baseline: RoutingArtifact;
  dataset: RoutingDataset; imageDigest: string; evaluatorKeyId: string; evaluatorPrivateKey: string; now?: number }
/** No image pull, environment inheritance, network, writable root, Docker socket,
 * keys or repository mounts inside the sandbox. Host Docker access is trusted.
 * This is a container boundary, not separate production service-account IAM. */
export async function evaluateIsolated(options: IsolatedEvaluationOptions) {
  const artifact = routingArtifactSchema.parse(options.artifact); const baseline = routingArtifactSchema.parse(options.baseline); const dataset = datasetSchema.parse(options.dataset);
  if (!/^sha256:[a-f0-9]{64}$/.test(options.imageDigest)) throw new Error('pinned_local_image_required');
  const candidate = options.candidate; const datasetDigest = hash(canonical(dataset));
  if (candidate.artifactDigest !== hash(canonical(artifact)) || candidate.candidateRevision !== candidate.artifactDigest || candidate.datasetVersion !== datasetDigest ||
    candidate.evaluatorVersion !== EVALUATOR_DIGEST || candidate.promotionPolicyVersion !== POLICY_DIGEST || candidate.authorServiceId === options.evaluatorKeyId) throw new Error('evaluation_input_mismatch');
  const directory = await fs.mkdtemp(join(tmpdir(), 'vox-improvement-eval-')); const name = `vox-eval-${randomUUID()}`;
  try {
    const input = join(directory, 'input'); const protectedPath = join(directory, 'protected');
    await fs.mkdir(input, { mode: 0o755 }); await fs.mkdir(protectedPath, { mode: 0o755 });
    for (const [file, value] of [[join(input, 'candidate.json'), canonical(artifact)], [join(input, 'baseline.json'), canonical(baseline)],
      [join(protectedPath, 'dataset.json'), canonical(dataset)], [join(protectedPath, 'runner.cjs'), EVALUATOR_PROGRAM]]) await fs.writeFile(file, value, { mode: 0o444 });
    const args = ['run', '--rm', '--pull=never', '--name', name, '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
      '--user=65534:65534', '--pids-limit=32', '--memory=128m', '--cpus=0.5', '--tmpfs=/tmp:rw,noexec,nosuid,size=8m',
      '--mount', `type=bind,src=${input},dst=/input,readonly`, '--mount', `type=bind,src=${protectedPath},dst=/protected,readonly`,
      '--entrypoint=node', options.imageDigest, '/protected/runner.cjs'];
    let stdout: string;
    try { ({ stdout } = await execute('docker', args, { timeout: 20000, maxBuffer: 4096, encoding: 'utf8' })); }
    catch { throw new Error('isolated_evaluation_unavailable_or_failed'); }
    if (hash(await fs.readFile(join(input, 'candidate.json'))) !== candidate.artifactDigest || hash(await fs.readFile(join(protectedPath, 'runner.cjs'))) !== EVALUATOR_DIGEST ||
      hash(await fs.readFile(join(protectedPath, 'dataset.json'))) !== datasetDigest) throw new Error('evaluation_input_tampered');
    let output: { checks: number; candidateFailures: number; baselineFailures: number };
    try { output = JSON.parse(stdout); } catch { throw new Error('invalid_evaluator_output'); }
    if (Object.keys(output).sort().join(',') !== 'baselineFailures,candidateFailures,checks' || output.checks !== dataset.cases.length ||
      ![output.candidateFailures, output.baselineFailures].every(n => Number.isInteger(n) && n >= 0 && n <= output.checks)) throw new Error('invalid_evaluator_output');
    const receipt: ProtectedEvaluation = { receipt: { candidateId: candidate.id, candidateRevision: candidate.candidateRevision, artifactDigest: candidate.artifactDigest,
      evaluatorServiceId: options.evaluatorKeyId, evaluatorVersion: candidate.evaluatorVersion, datasetVersion: candidate.datasetVersion, promotionPolicyVersion: candidate.promotionPolicyVersion,
      baselineRevision: candidate.baselineRevision, status: output.candidateFailures === 0 ? 'passed' : 'failed', privacyFailures: 0, failedChecks: output.candidateFailures, skippedChecks: 0, testedAt: options.now ?? Date.now() },
      details: { sourceDigest: candidate.baselineRevision, artifactDigest: candidate.artifactDigest, baselineArtifactDigest: hash(canonical(baseline)), datasetDigest, evaluatorDigest: EVALUATOR_DIGEST, imageDigest: options.imageDigest,
        policyDigest: POLICY_DIGEST, phase: 'protected_final', isolation: 'docker_network_none_readonly', ...output } };
    return attest(options.evaluatorKeyId, options.evaluatorPrivateKey, 'protected_evaluation', receipt);
  } finally {
    // Timeout cleanup is necessary because killing the Docker client need not stop its container.
    await execute('docker', ['rm', '-f', name], { timeout: 5000, maxBuffer: 4096 }).catch(() => undefined);
    await fs.rm(directory, { recursive: true, force: true });
  }
}
/** Fixed-budget offline search uses optimization cases only. Final cases and
 * evaluator credentials are absent from this API. */
export function optimizeRouting(baseline: RoutingArtifact, training: RoutingDataset, maxCandidates: number, maxCases: number) {
  routingArtifactSchema.parse(baseline); const dataset = datasetSchema.parse(training);
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 4 || !Number.isInteger(maxCases) || maxCases < 1 || dataset.cases.length > maxCases || maxCases > 128) throw new Error('optimization_budget_exceeded');
  const allVariants: RoutingArtifact[] = [{ ...baseline, onCancelled: 'stop' }, { ...baseline, onCancelled: 'stop', onActive: 'continue' }];
  const variants = allVariants.slice(0, maxCandidates);
  const failures = (config: RoutingArtifact) => dataset.cases.reduce((n, c) => n + Number((c.cancelled ? config.onCancelled === 'stop' ? 'stop' : 'continue' : config.onActive) !== c.expected), 0);
  const selected = [...variants].sort((a, b) => failures(a) - failures(b))[0];
  return { artifact: selected, candidatesConsidered: variants.length, casesPerCandidate: dataset.cases.length,
    baselineFailures: failures(baseline), candidateFailures: failures(selected), evidence: 'optimization_only' as const };
}
