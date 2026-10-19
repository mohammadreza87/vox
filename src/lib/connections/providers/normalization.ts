import { z } from 'zod';
import { ProviderError } from '../transport';
export const componentId = z.string().min(1).max(150).regex(/^[A-Za-z0-9_-]+$/);
export const positiveId = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const numericId = z.string().regex(/^[1-9]\d{0,15}$/);
export const uuid = z.string().uuid().transform(value => value.toLowerCase());
export const safeText = (max: number) => z.string().max(max * 4).transform(value => cleanText(value, max));
export const inputText = (max: number) => z.string().min(1).max(max).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));
export function cleanText(value: string, max = 16_000): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, max);
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProviderError('provider_result_invalid');
  return value as Record<string, unknown>;
}
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ProviderError('provider_result_invalid');
  return result.data;
}
export const segment = (value: string | number): string => encodeURIComponent(String(value));
export const revisionOf = (value: unknown): string | undefined => typeof value === 'string' && /^[\x20-\x7e]{1,200}$/.test(value) ? value : undefined;
/** Text extraction follows only known content keys; attachments, links, users and metadata are excluded. */
export function extractText(value: unknown, mode: 'google' | 'figma', max = 32_000): { text: string; truncated: boolean } {
  let text = ''; let nodes = 0; let truncated = false;
  const visit = (node: unknown, depth: number): void => {
    if (++nodes > 5000 || depth > 20 || text.length >= max) { truncated = true; return; }
    if (Array.isArray(node)) { for (const item of node.slice(0, 1000)) visit(item, depth + 1); if (node.length > 1000) truncated = true; return; }
    if (!node || typeof node !== 'object') return;
    const data = node as Record<string, unknown>;
    if (mode === 'figma' && typeof data.characters === 'string') text += cleanText(data.characters, max) + '\n';
    if (mode === 'google' && typeof data.content === 'string') text += cleanText(data.content, max);
    for (const key of mode === 'figma' ? ['children', 'document'] : ['body', 'content', 'elements', 'paragraph', 'textRun', 'table', 'tableRows', 'tableCells', 'tabs', 'documentTab', 'childTabs', 'slides', 'pageElements', 'shape', 'text', 'textElements']) {
      if (typeof data[key] === 'object') visit(data[key], depth + 1);
    }
  };
  visit(value, 0);
  return { text: text.slice(0, max), truncated: truncated || text.length > max };
}
