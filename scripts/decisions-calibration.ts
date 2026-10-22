#!/usr/bin/env node
/**
 * Offline calibration report for the triage pre-pass (Step 9 of
 * docs/AGENT_INTELLIGENCE_SOLUTION.md).
 *
 *   npx tsx scripts/decisions-calibration.ts --log <decision-log-v1.jsonl> --labels <labels.csv> \
 *     [--since ISO] [--until ISO] [--thresholds 0.2,0.5,0.8] [--firestore]
 *
 * Reads the content-free decision log (TIREH_DECISION_LOG): the JSONL file
 * store, or with --firestore the 'vox_decision_log' collection (needs the
 * Firebase Admin credentials of the environment; --log is then ignored).
 * Labels are a CSV with exactly `row_id,question,label`. The log carries no
 * content to label from, by design: labels must come from a separately
 * consented or synthetic evaluation run whose harness recorded the row ids.
 *
 * Prints precision and recall per question, choice value, script language
 * and threshold, plus a 'support n/200' gate line per question and language.
 * Never prints row ids or label contents. Logic: src/lib/tireh/decisions/calibration.ts.
 */
import { readFileSync } from 'fs';
import { computeCalibration, DEFAULT_THRESHOLDS, formatCalibration, parseLabelsCsv, unmatchedLabelCount } from '../src/lib/tireh/decisions/calibration';
import { createFileDecisionLogStore, FirestoreDecisionLogStore, type DecisionLogStore } from '../src/lib/tireh/decisions/log';

const USAGE = 'usage: npx tsx scripts/decisions-calibration.ts --log <decision-log-v1.jsonl> --labels <labels.csv> [--since ISO] [--until ISO] [--thresholds 0.2,0.5,0.8] [--firestore]';

function fail(message: string): never {
  process.stderr.write(`${message}\n${USAGE}\n`);
  process.exit(2);
}

interface Args { log?: string; labels: string; since?: Date; until?: Date; thresholds: readonly number[]; firestore: boolean }

function parseArgs(argv: readonly string[]): Args {
  const valued = new Set(['--log', '--labels', '--since', '--until', '--thresholds']);
  const values = new Map<string, string>();
  let firestore = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--firestore') { firestore = true; continue; }
    const value = argv[i + 1];
    if (!valued.has(flag) || values.has(flag) || value === undefined || value.startsWith('--')) fail(`bad argument: ${flag}`);
    values.set(flag, value);
    i++;
  }
  const labels = values.get('--labels');
  const log = values.get('--log');
  if (!labels) fail('--labels is required');
  if (!log && !firestore) fail('--log is required unless --firestore is given');
  const date = (flag: string): Date | undefined => {
    const raw = values.get(flag);
    if (raw === undefined) return undefined;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) fail(`${flag} must be an ISO date`);
    return parsed;
  };
  let thresholds = DEFAULT_THRESHOLDS;
  const raw = values.get('--thresholds');
  if (raw !== undefined) {
    thresholds = raw.split(',').map((t) => Number(t.trim()));
    if (!thresholds.length || thresholds.some((t) => !Number.isFinite(t) || t <= 0 || t >= 1)) fail('--thresholds must be numbers between 0 and 1');
  }
  return { ...(log ? { log } : {}), labels, since: date('--since'), until: date('--until'), thresholds, firestore };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let labelText: string;
  try { labelText = readFileSync(args.labels, 'utf8'); } catch { return fail('cannot read the --labels file'); }
  let labels;
  try { labels = parseLabelsCsv(labelText); } catch (error) { return fail(error instanceof Error ? error.message : 'invalid labels'); }
  const store: DecisionLogStore = args.firestore
    ? new FirestoreDecisionLogStore(await (await import('@/lib/firebase-admin')).getAdminDb())
    : createFileDecisionLogStore(args.log!);
  const rows = await store.list({ since: args.since, until: args.until, limit: 10_000 });
  process.stdout.write(formatCalibration(computeCalibration(rows, labels, args.thresholds)));
  process.stdout.write(`unmatched label rows: ${unmatchedLabelCount(rows, labels)}\n`);
}

main().catch(() => fail('calibration failed'));
