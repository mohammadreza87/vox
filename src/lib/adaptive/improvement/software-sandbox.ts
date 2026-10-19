import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { attest, canonical, hash } from './contracts';
import { softwarePatchArtifactSchema, softwareEvaluationSchema, softwareRunInputSchema, softwareRunOutputSchema, type FrozenSoftwareBase, type SoftwarePatchArtifact, type SoftwareRunInput, type SoftwareRunOutput } from './software-contracts';
import { materializeSoftwarePatch } from './software-patch';

const execute = promisify(execFile);
export const SOFTWARE_IMAGE_DIGEST = 'sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9';
/** Only this runner, operations, and one source file cross the container boundary.
 * The host never imports or executes either source. Expected results, scoring,
 * signing material, repository and registry stay on the host. */
export const SOFTWARE_HARNESS = `import { readFileSync } from 'node:fs';
import { SentenceDetector } from './source.ts';
const inputs = JSON.parse(readFileSync('/input/operations.json','utf8'));
const results = inputs.map(input => {
  const detector = new SentenceDetector();
  return {schemaVersion:1,steps:input.operations.map(operation => {
    let sentences=[],flushed=null;
    if(operation.kind==='chunk') sentences=detector.addChunk(operation.text);
    else if(operation.kind==='flush') flushed=detector.flush();
    else if(operation.kind==='reset') detector.reset();
    else throw new Error('invalid_operation');
    return {sentences,flushed,buffer:detector.getBuffer(),currentIndex:detector.getCurrentIndex()};
  })};
});
process.stdout.write(JSON.stringify(results));`;
export const SOFTWARE_HARNESS_DIGEST = hash(SOFTWARE_HARNESS);

type Step = SoftwareRunOutput['steps'][number];
const sentence = (text: string, index = 0) => ({ text, index });
const step = (texts: string[] = [], buffer = '', currentIndex = texts.length, flushed: Step['flushed'] = null, firstIndex = 0): Step => ({ sentences: texts.map((text, index) => sentence(text, firstIndex + index)), flushed, buffer, currentIndex });
/** Generated privately at evaluation time. Never exported or written into a
 * candidate mount. Random tokens prevent reuse of a precomputed output table. */
function protectedCorpus() {
  const token = randomUUID().replaceAll('-', '') + 'x';
  const en = `Hello ${token}.`, fa = `سلام ${token}؟`, tail = `Pending ${token}`;
  const cases: { input: SoftwareRunInput; expected: SoftwareRunOutput; persian: boolean }[] = [];
  const add = (operations: SoftwareRunInput['operations'], steps: Step[], persian = false) => cases.push({ input: softwareRunInputSchema.parse({ schemaVersion: 1, operations }), expected: softwareRunOutputSchema.parse({ schemaVersion: 1, steps }), persian });
  add([{kind:'chunk',text:en}], [step([en])]);
  add([{kind:'chunk',text:fa}], [step([fa])], true);
  add([{kind:'chunk',text:en+' '+fa}], [step([en,fa])], true);
  add([{kind:'chunk',text:fa.slice(0,7)},{kind:'chunk',text:fa.slice(7)}], [step([],fa.slice(0,7),0),step([fa])], true);
  add([{kind:'chunk',text:en.slice(0,8)},{kind:'chunk',text:en.slice(8)}], [step([],en.slice(0,8),0),step([en])]);
  const abbrev = `Dr. Morgan ${token} is here.`;
  add([{kind:'chunk',text:'Dr. '},{kind:'chunk',text:abbrev.slice(4)}], [step([],'Dr. ',0),step([abbrev])]);
  const decimal = `Value ${token} is 3.14 today.`;
  add([{kind:'chunk',text:decimal}], [step([decimal])]);
  add([{kind:'chunk',text:tail},{kind:'flush'},{kind:'flush'}], [step([],tail,0),step([],'',1,sentence(tail)),step([],'',1)]);
  add([{kind:'chunk',text:en},{kind:'chunk',text:tail},{kind:'reset'},{kind:'chunk',text:fa},{kind:'flush'}], [step([en]),step([],tail,1),step([], '',0),step([fa]),step([], '',1)], true);
  const second = `Goodbye ${token}!`;
  add([{kind:'chunk',text:en},{kind:'chunk',text:second}], [step([en]),step([second],'',2,null,1)]);
  add([{kind:'chunk',text:`**Hello ${token}**.`}], [step([en])]);
  add([{kind:'chunk',text:''},{kind:'flush'},{kind:'reset'}], [step([], '',0),step([], '',0),step([], '',0)]);
  return cases;
}

function scoreSoftware(cases: ReturnType<typeof protectedCorpus>, outputs: SoftwareRunOutput[]) {
  return cases.filter((entry,index) => canonical(entry.expected) !== canonical(outputs[index])).length;
}
function reproducesPersian(cases: ReturnType<typeof protectedCorpus>, outputs: SoftwareRunOutput[]) {
  return cases.some((entry,index) => entry.persian && canonical(entry.expected) !== canonical(outputs[index]));
}
/** Binds actual runtime functions; transpiler/build changes intentionally produce
 * a new evaluator identity. It is not advertised as a stable source Git hash. */
export const SOFTWARE_EVALUATOR_DIGEST = hash(canonical({ version: 2, harness: SOFTWARE_HARNESS_DIGEST,
  implementation: [protectedCorpus, sentence, step, scoreSoftware, reproducesPersian, runSource, evaluateSoftwareIsolated, canonical].map(fn=>fn.toString()),
  protocol: 'strict_schema_v1_16ops_16384input_65536output_256sentences_exact_step_count',
  outputSchema: JSON.stringify(softwareRunOutputSchema._def), inputSchema: JSON.stringify(softwareRunInputSchema._def),
}));
export const SOFTWARE_POLICY_DIGEST = hash(canonical({ version: 1, evaluator: SOFTWARE_EVALUATOR_DIGEST, image: SOFTWARE_IMAGE_DIGEST, zeroCandidateFailures: true, baselinePersianReproduction: true, finalSetUsesPerRegistry: 1, humanRelease: true, productionMutation: false }));

export interface SoftwareIsolatedEvaluationOptions {
  artifact: SoftwarePatchArtifact; base: FrozenSoftwareBase; imageDigest: string;
  evaluatorKeyId: string; evaluatorPrivateKey: string; now?: number;
}

async function runSource(source: string, inputs: SoftwareRunInput[], imageDigest: string): Promise<SoftwareRunOutput[]> {
  const directory = await fs.mkdtemp(join(tmpdir(), 'vox-software-eval-'));
  const name = `vox-software-${randomUUID()}`;
  try {
    await fs.chmod(directory, 0o755);
    for (const [file, value] of [['source.ts',source],['runner.mjs',SOFTWARE_HARNESS],['operations.json',canonical(inputs)]]) await fs.writeFile(join(directory,file),value,{mode:0o444});
    const args = ['run','--rm','--pull=never','--name',name,'--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--user=65534:65534','--pids-limit=32','--memory=128m','--cpus=0.5','--ulimit=nofile=64:64','--tmpfs=/tmp:rw,noexec,nosuid,size=8m','--mount',`type=bind,src=${directory},dst=/input,readonly`,'--entrypoint=node',imageDigest,'--disable-warning=ExperimentalWarning','/input/runner.mjs'];
    const { stdout, stderr } = await execute('docker',args,{timeout:20000,killSignal:'SIGKILL',maxBuffer:131072,encoding:'utf8',env:{NODE_ENV:process.env.NODE_ENV ?? 'test',PATH:process.env.PATH ?? '/usr/bin:/bin',HOME:process.env.HOME ?? tmpdir()}});
    if (stderr.trim() || hash(await fs.readFile(join(directory,'source.ts'))) !== hash(source) || hash(await fs.readFile(join(directory,'runner.mjs'))) !== SOFTWARE_HARNESS_DIGEST || hash(await fs.readFile(join(directory,'operations.json'))) !== hash(canonical(inputs))) throw new Error('invalid_software_execution');
    const parsed: unknown = JSON.parse(stdout);
    if (!Array.isArray(parsed) || parsed.length !== inputs.length) throw new Error('invalid_software_output');
    return parsed.map((output,index) => {
      const result = softwareRunOutputSchema.parse(output);
      if (result.steps.length !== inputs[index].operations.length) throw new Error('incomplete_software_output');
      return result;
    });
  } finally {
    let cleanupFailed = false;
    try { await execute('docker',['rm','-f',name],{timeout:5000,killSignal:'SIGKILL',maxBuffer:4096}); } catch (error) { cleanupFailed = !(error instanceof Error && error.message.includes('No such container')); }
    await fs.rm(directory,{recursive:true,force:true});
    if (cleanupFailed) throw new Error('software_cleanup_failed');
  }
}

export async function evaluateSoftwareIsolated(options: SoftwareIsolatedEvaluationOptions) {
  if (options.imageDigest !== SOFTWARE_IMAGE_DIGEST) throw new Error('pinned_local_software_image_required');
  const artifact = softwarePatchArtifactSchema.parse(options.artifact);
  const materialized = materializeSoftwarePatch(options.base, artifact.patch);
  const identity = artifact.identity;
  if (identity.policyDigest !== SOFTWARE_POLICY_DIGEST || identity.repositoryCommit !== options.base.repositoryCommit || identity.repositoryTreeOid !== options.base.repositoryTreeOid || identity.targetPath !== options.base.targetPath || identity.baseBlobOid !== options.base.baseBlobOid || identity.baseSourceDigest !== options.base.baseSourceDigest || identity.patchDigest !== materialized.patchDigest || identity.resultSourceDigest !== materialized.resultSourceDigest) throw new Error('software_evaluation_identity_mismatch');
  const cases = protectedCorpus();
  const datasetDigest = hash(canonical(cases));
  let baselineFailures = 0, candidateFailures = 0;
  let status: 'passed' | 'failed' | 'incomplete' = 'incomplete';
  try {
    const baseline = await runSource(options.base.source,cases.map(c=>c.input),options.imageDigest);
    baselineFailures = scoreSoftware(cases,baseline);
    const baselineReproduced = reproducesPersian(cases,baseline);
    const candidate = await runSource(materialized.source,cases.map(c=>c.input),options.imageDigest);
    candidateFailures = scoreSoftware(cases,candidate);
    status = baselineReproduced && baselineFailures > 0 && candidateFailures === 0 ? 'passed' : 'failed';
  } catch (error) {
    if (error instanceof Error && error.message === 'software_cleanup_failed') throw error;
    // Invalid output, crashes, missing image/daemon and timeout are unavailable
    // evidence. In particular no candidate-authored pass/fail logs are trusted.
    status = 'incomplete';
  }
  const receipt = softwareEvaluationSchema.parse({ identity: artifact.identity, datasetDigest, evaluatorDigest: SOFTWARE_EVALUATOR_DIGEST, imageDigest: options.imageDigest, checks: cases.length, baselineFailures, candidateFailures, status, testedAt: options.now ?? Date.now(), phase: 'protected_final', isolation: 'docker_candidate_only_host_scored' });
  return attest(options.evaluatorKeyId,options.evaluatorPrivateKey,'software_protected_evaluation',receipt);
}
