/**
 * p50/p95 per route and stage from Studio server logs written with
 * STUDIO_STAGE_TIMINGS=1 (content-free timing lines only).
 *
 *   npm run timings:report -- "$HOME/Library/Application Support/Vox Studio/logs/server.log"
 *   cat server.log | npm run --silent timings:report
 */
import { readFileSync } from 'node:fs';
import { formatStageSummary, parseStageTimings, summarizeStageTimings } from '../src/lib/tireh/timing-report';

const files = process.argv.slice(2);
const text = files.length ? files.map((file) => readFileSync(file, 'utf8')).join('\n') : readFileSync(0, 'utf8');
process.stdout.write(`${formatStageSummary(summarizeStageTimings(parseStageTimings(text)))}\n`);
