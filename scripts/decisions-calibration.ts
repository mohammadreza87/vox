#!/usr/bin/env node
/**
 * Offline calibration report for the triage pre-pass (S09).
 *
 *   node --import tsx scripts/decisions-calibration.ts --log <decision-log-v1.jsonl> --labels <labels.csv> \
 *     [--thresholds 0.2,0.5,0.8] [--question route] [--since 2026-10-01]
 *
 * Reads a content-free decision log (TIREH_DECISION_LOG file store) and a
 * labelled CSV (`id,question,label[,language]`), then prints precision and
 * recall per question, threshold and language. Local files only: no network
 * and no Firestore mode. Logic lives in src/lib/tireh/decisions/calibration.ts.
 */
import { readFileSync } from 'fs';
import { calibrationReport, DEFAULT_THRESHOLDS, formatCalibrationReport, parseDecisionLogJsonl, parseLabelsCsv } from '../src/lib/tireh/decisions/calibration';

const USAGE = 'usage: node --import tsx scripts/decisions-calibration.ts --log <decision-log-v1.jsonl> --labels <labels.csv> [--thresholds 0.2,0.5,0.8] [--question <name>] [--since <YYYY-MM-DD>]';

function fail(message?: string): never {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}

function parseArgs(argv: readonly string[]): { log: string; labels: string; thresholds: readonly number[]; question?: string; since?: Date } {
  const allowed = new Set(['--log', '--labels', '--thresholds', '--question', '--since']);
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!allowed.has(flag) || flags.has(flag) || value === undefined || value.startsWith('--')) fail(`bad argument: ${flag}`);
    flags.set(flag, value);
    i++;
  }
  const log = flags.get('--log'), labels = flags.get('--labels');
  if (!log || !labels) fail('--log and --labels are required');
  let thresholds = DEFAULT_THRESHOLDS;
  const rawThresholds = flags.get('--thresholds');
  if (rawThresholds !== undefined) {
    thresholds = rawThresholds.split(',').map((t) => Number(t.trim()));
    if (!thresholds.length || thresholds.some((t) => !Number.isFinite(t) || t <= 0 || t >= 1)) fail('--thresholds must be numbers between 0 and 1');
  }
  const question = flags.get('--question');
  if (question !== undefined && !/^[a-z][a-z0-9_]{0,63}$/.test(question)) fail('--question must be a question name');
  const rawSince = flags.get('--since');
  const since = rawSince === undefined ? undefined : new Date(rawSince);
  if (since && Number.isNaN(since.getTime())) fail('--since must be a date');
  return { log, labels, thresholds, ...(question ? { question } : {}), ...(since ? { since } : {}) };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  let logText: string, labelText: string;
  try { logText = readFileSync(args.log, 'utf8'); } catch { return fail('cannot read --log file'); }
  try { labelText = readFileSync(args.labels, 'utf8'); } catch { return fail('cannot read --labels file'); }
  let labels;
  try { labels = parseLabelsCsv(labelText); } catch (error) { return fail(error instanceof Error ? error.message : 'invalid labels'); }
  const rows = parseDecisionLogJsonl(logText).filter((r) => !args.since || r.at.getTime() >= args.since.getTime());
  const selected = args.question ? labels.filter((l) => l.question === args.question) : labels;
  process.stdout.write(formatCalibrationReport(calibrationReport(rows, selected, args.thresholds)));
}

main();
