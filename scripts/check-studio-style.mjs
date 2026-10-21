#!/usr/bin/env node
/**
 * Soft Weather style gate for Studio screens (PLAN E4, UI spec §8.5).
 *
 * Fails when a screen under src/app/studio/_components/screens:
 *   1. hard-codes a hex colour (#RRGGBB): colours come from CSS tokens, hueVars() or PALETTE;
 *   2. pushes the total inline `style={{` count over the budget (default 40, from ~330);
 *   3. renders a native <select>, checkbox, radio, file input or <details> without a vx- class.
 *
 *   node scripts/check-studio-style.mjs [--max-style=40] [--json] [--warn]
 *
 * --warn reports without failing (for the window before every screen is migrated).
 * A line can opt out of rule 1 with a trailing `// style-ok: <reason>`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SCREENS = join(ROOT, 'src/app/studio/_components/screens');
export const STYLE_BUDGET = 40;

const HEX = /#[0-9A-Fa-f]{6}\b/g;
const STYLE = /style=\{\{/g;
const OPT_OUT = /\/\/\s*style-ok\b/;
/** Opening JSX tags of native controls; the attributes run to the first unnested `>`. */
const NATIVE = /<(select|details|input)\b/g;
const RAW_INPUT = /\btype=["'](checkbox|radio|file)["']/;
const VX_CLASS = /className=(?:"[^"]*\bvx-[^"]*"|'[^']*\bvx-[^']*'|\{[^}]*\bvx-[^}]*\})/;

/** Every screen source file (tests and stories excluded). */
export function screenFiles(dir = SCREENS) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...screenFiles(path));
    else if (/\.tsx$/.test(name) && !/\.(test|stories)\.tsx$/.test(name)) out.push(path);
  }
  return out.sort();
}

/** The text of a JSX opening tag starting at `from` (handles `>` inside `{…}` and quotes). */
function openingTag(src, from) {
  let depth = 0, quote = '';
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return src.slice(from, i + 1);
  }
  return src.slice(from);
}

const lineAt = (src, index) => src.slice(0, index).split('\n').length;

/** Findings for one file's source. Pure, so the rules can be tested without the tree. */
export function checkSource(src, file = '<source>') {
  const hex = [], raw = [];
  src.split('\n').forEach((line, i) => {
    if (OPT_OUT.test(line) || /^\s*(\/\/|\*|\/\*)/.test(line)) return;
    for (const m of line.matchAll(HEX)) hex.push({ file, line: i + 1, text: m[0] });
  });
  const styles = [...src.matchAll(STYLE)].length;
  for (const m of src.matchAll(NATIVE)) {
    const tag = openingTag(src, m.index);
    const kind = m[1];
    if (kind === 'input' && !RAW_INPUT.test(tag)) continue;
    if (!VX_CLASS.test(tag)) raw.push({ file, line: lineAt(src, m.index), text: tag.replace(/\s+/g, ' ').slice(0, 80) });
  }
  return { file, hex, styles, raw };
}

export function checkScreens({ dir = SCREENS, maxStyle = STYLE_BUDGET } = {}) {
  const files = screenFiles(dir).map((path) => checkSource(readFileSync(path, 'utf8'), relative(ROOT, path)));
  const styles = files.reduce((n, f) => n + f.styles, 0);
  const hex = files.flatMap((f) => f.hex);
  const raw = files.flatMap((f) => f.raw);
  return {
    ok: hex.length === 0 && raw.length === 0 && styles <= maxStyle,
    styles, maxStyle, hex, raw,
    perFile: files.filter((f) => f.styles).map((f) => ({ file: f.file, styles: f.styles })).sort((a, b) => b.styles - a.styles),
  };
}

function main(argv) {
  const flag = (name) => argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  const max = Number(flag('max-style')?.split('=')[1] ?? STYLE_BUDGET);
  const report = checkScreens({ maxStyle: Number.isFinite(max) ? max : STYLE_BUDGET });
  if (flag('json')) { console.log(JSON.stringify(report, null, 2)); return report.ok || flag('warn') ? 0 : 1; }

  const bad = (s) => `✗ ${s}`, good = (s) => `✓ ${s}`;
  console.log(report.hex.length ? bad(`${report.hex.length} hard-coded hex colour(s)`) : good('no hard-coded hex colours'));
  for (const h of report.hex) console.log(`    ${h.file}:${h.line}  ${h.text}`);
  console.log(report.styles > report.maxStyle ? bad(`${report.styles} inline style={{ (budget ${report.maxStyle})`) : good(`${report.styles} inline style={{ (budget ${report.maxStyle})`));
  if (report.styles > report.maxStyle) for (const f of report.perFile.slice(0, 12)) console.log(`    ${String(f.styles).padStart(3)}  ${f.file}`);
  console.log(report.raw.length ? bad(`${report.raw.length} unstyled native control(s)`) : good('no unstyled native controls'));
  for (const r of report.raw) console.log(`    ${r.file}:${r.line}  ${r.text}`);
  return report.ok || flag('warn') ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
