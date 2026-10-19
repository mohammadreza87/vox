#!/usr/bin/env node
/**
 * Register the Telegram webhook for every TIREH persona bot.
 *
 * Usage:
 *   TIREH_PUBLIC_URL=https://your-host \
 *   TIREH_WEBHOOK_SECRET=... \
 *   TIREH_BOT_TOKEN_ARIA=... \
 *   node scripts/tireh-set-webhooks.mjs aria [other-persona ...]
 *
 * Each bot is pointed at {TIREH_PUBLIC_URL}/api/tireh/telegram/{personaId}.
 */

const base = process.env.TIREH_PUBLIC_URL?.replace(/\/$/, '');
const secret = process.env.TIREH_WEBHOOK_SECRET;
const personas = process.argv.slice(2);

if (!base || !secret || personas.length === 0) {
  console.error('Set TIREH_PUBLIC_URL and TIREH_WEBHOOK_SECRET, and pass persona ids, e.g.: node scripts/tireh-set-webhooks.mjs aria');
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
  console.error('TIREH_WEBHOOK_SECRET may only contain A-Z, a-z, 0-9, _ and - (Telegram requirement), up to 256 chars.');
  process.exit(1);
}

let failed = false;
for (const personaId of personas) {
  const envName = `TIREH_BOT_TOKEN_${personaId.toUpperCase().replace(/-/g, '_')}`;
  const token = process.env[envName];
  if (!token) {
    console.error(`✗ ${personaId}: ${envName} is not set`);
    failed = true;
    continue;
  }
  const url = `${base}/api/tireh/telegram/${personaId}`;
  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, secret_token: secret, allowed_updates: ['message', 'callback_query'] }),
  });
  const json = await response.json().catch(() => ({}));
  if (json.ok) {
    console.log(`✓ ${personaId}: webhook → ${url}`);
  } else {
    console.error(`✗ ${personaId}: ${json.description ?? `HTTP ${response.status}`}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
