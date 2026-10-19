import { z } from 'zod';
import { defineTool, type ProviderToolDefinition } from './types';
import { inputText, safeText, parse, segment, object, cleanText } from './normalization';
const messageId = z.string().regex(/^[a-f0-9]{8,40}$/);
const address = z.string().min(3).max(128).regex(/^[A-Za-z0-9.!#$%&'*+=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/).transform(v => v.toLowerCase());
export const gmailRecipientResource = (address: string): string => `gmail:recipient:${Buffer.from(address.toLowerCase()).toString('base64url')}`;
const compose = z.object({ to: z.array(address).min(1).max(10).refine(v => new Set(v).size === v.length), subject: inputText(256).refine(v => !/[\r\n]/.test(v)), body: inputText(32000) }).strict();
function raw(a: z.infer<typeof compose>): string {
  const subject = `=?UTF-8?B?${Buffer.from(a.subject).toString('base64')}?=`;
  const mime = `To: ${a.to.join(', ')}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(a.body).toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? ''}\r\n`;
  return Buffer.from(mime).toString('base64url');
}
function plainParts(payload: unknown): { text: string; truncated: boolean } {
  let text = ''; let truncated = false;
  const visit = (node: unknown, depth: number) => { if (depth > 6 || text.length >= 32000) { truncated = true; return; } const part = object(node);
    if (part.mimeType === 'text/plain' && part.body && typeof part.body === 'object') {
      const body = object(part.body); if (typeof body.data === 'string' && /^[A-Za-z0-9_-]*={0,2}$/.test(body.data)) text += cleanText(Buffer.from(body.data, 'base64url').toString('utf8'), 32000) + '\n';
      if (body.attachmentId) truncated = true;
    }
    if (Array.isArray(part.parts)) for (const child of part.parts.slice(0, 25)) visit(child, depth + 1);
  };
  visit(payload, 0); return { text: text.slice(0, 32000), truncated: truncated || text.length > 32000 };
}
export const gmailTools: readonly ProviderToolDefinition[] = [
  defineTool({ id: 'gmail.message.get', providerId: 'gmail', title: 'Read selected email', description: 'Personal-only selected email read; plain text only, excluding attachments and remote content.', effect: 'read', personalOnly: true, schema: z.object({ messageId }).strict(), requiredScopes: ['https://www.googleapis.com/auth/gmail.readonly'], resourceFormat: 'gmail:message:messageId', mapResources: a => [`gmail:message:${a.messageId}`],
    request: a => ({ method: 'GET', path: `/gmail/v1/users/me/messages/${segment(a.messageId)}?format=full` }), normalize: (r, a) => { const data = parse(z.object({ id: z.literal(a.messageId), threadId: messageId, snippet: safeText(1000).optional(), internalDate: z.string().regex(/^\d{1,16}$/).optional() }), r.body); const payload = object(object(r.body).payload); const headers = parse(z.array(z.object({ name: z.string().max(100), value: safeText(1000) })).max(200), payload.headers ?? []).filter(h => ['from', 'to', 'subject', 'date'].includes(h.name.toLowerCase())); const text = plainParts(payload); return { data: { ...data, headers, text: text.text }, truncated: text.truncated }; } }),
  ...(['draft', 'send'] as const).map(action => defineTool({ id: `gmail.message.${action === 'draft' ? 'create_draft' : 'send'}`, providerId: 'gmail', title: action === 'draft' ? 'Create email draft' : 'Send email', description: 'Personal-only exact recipient/subject/plain-text body; no CC, BCC, attachments or mutable-draft send.', effect: action === 'draft' ? 'draft' : 'send', personalOnly: true, schema: compose, requiredScopes: [action === 'draft' ? 'https://www.googleapis.com/auth/gmail.compose' : 'https://www.googleapis.com/auth/gmail.send'], resourceFormat: 'gmail:mailbox:self plus gmail:recipient:base64urlLowercaseAddress', mapResources: a => ['gmail:mailbox:self', ...a.to.map(gmailRecipientResource)],
    request: a => ({ method: 'POST', path: action === 'draft' ? '/gmail/v1/users/me/drafts' : '/gmail/v1/users/me/messages/send', body: action === 'draft' ? { message: { raw: raw(a) } } : { raw: raw(a) } }), normalize: r => {
      if (action === 'draft') { const data = parse(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), message: z.object({ id: messageId, threadId: messageId }) }), r.body); return { data, receipt: `gmail:draft:${data.id}` }; }
      const data = parse(z.object({ id: messageId, threadId: messageId }), r.body); return { data, receipt: `gmail:message:${data.id}` };
    } })),
];
