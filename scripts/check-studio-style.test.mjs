import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkScreens, checkSource } from './check-studio-style.mjs';

test('flags hard-coded hex colours, but not comments or opted-out lines', () => {
  const src = [
    "const a = { color: '#D6FF5C' };",
    '// the board uses #0E1013 here',
    "const b = '#FFFFFF'; // style-ok: Telegram brand white",
    '<span style={{ background: `${pal.base}1F` }} />',
  ].join('\n');
  const r = checkSource(src, 'x.tsx');
  assert.deepEqual(r.hex.map((h) => [h.line, h.text]), [[1, '#D6FF5C']]);
  assert.equal(r.styles, 1);
});

test('native controls need a vx- class; text inputs and styled controls pass', () => {
  const src = `
    <select value={v} onChange={(e) => set(e.target.value)}><option /></select>
    <select className="vx-select" value={v} />
    <input type="checkbox" checked={on} onChange={() => toggle(x > 1)} />
    <input className={\`vx-check \${on ? 'on' : ''}\`} type="radio" />
    <input type="text" />
    <details className="vx-disclosure"><summary>More</summary></details>
    <details><summary>Raw</summary></details>
  `;
  const r = checkSource(src, 'x.tsx');
  assert.deepEqual(r.raw.map((x) => x.line), [2, 4, 8]);
  assert.match(r.raw[1].text, /type="checkbox"/);
});

test('the whole screens tree reports totals and a per-file style count', () => {
  const r = checkScreens({ maxStyle: 10_000 });
  assert.equal(typeof r.styles, 'number');
  assert.ok(Array.isArray(r.perFile));
  assert.equal(r.ok, r.hex.length === 0 && r.raw.length === 0);
});
