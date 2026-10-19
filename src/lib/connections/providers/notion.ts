import { z } from 'zod';
import { defineTool, type ProviderToolDefinition } from './types';
import { uuid, inputText, safeText, parse, object, segment } from './normalization';
const page = z.object({ pageId: uuid }).strict();
const resource = (a: z.infer<typeof page>) => [`notion:page:${a.pageId}`];
const headers = { 'notion-version': '2026-03-11' };
export const notionTools: readonly ProviderToolDefinition[] = [
  defineTool({ id: 'notion.page.get', providerId: 'notion', title: 'Read page metadata', description: 'Read metadata for one selected page; excludes linked records and people.', effect: 'read', schema: page, requiredScopes: ['read_content'], resourceFormat: 'notion:page:uuid', mapResources: resource,
    request: a => ({ method: 'GET', path: `/v1/pages/${segment(a.pageId)}`, headers }), normalize: (r, a) => { const data = parse(z.object({ id: z.literal(a.pageId), last_edited_time: z.string().max(100), archived: z.boolean().optional(), in_trash: z.boolean().optional() }), r.body); return { data, revision: data.last_edited_time }; } }),
  defineTool({ id: 'notion.page.read_content', providerId: 'notion', title: 'Read page content', description: 'Read at most 50 direct text blocks; nested pages/blocks remain excluded.', effect: 'read', schema: page, requiredScopes: ['read_content'], resourceFormat: 'notion:page:uuid', mapResources: resource,
    request: a => ({ method: 'GET', path: `/v1/blocks/${segment(a.pageId)}/children?page_size=50`, headers }), normalize: r => { const data = parse(z.object({ results: z.array(z.unknown()).max(50), has_more: z.boolean() }), r.body); const blocks: { id: string; type: string; text: string; hasChildren: boolean }[] = [];
      for (const entry of data.results) { const block = object(entry); if (!['paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'quote', 'code', 'to_do'].includes(String(block.type))) continue;
        const body = object(block[String(block.type)]); const texts = parse(z.array(z.object({ plain_text: safeText(2000).optional(), text: z.object({ content: safeText(2000) }).optional() })).max(100), body.rich_text ?? []);
        blocks.push({ id: parse(uuid, block.id), type: String(block.type), text: texts.map(t => t.plain_text ?? t.text?.content ?? '').join('').slice(0, 4000), hasChildren: block.has_children === true }); }
      return { data: { blocks }, truncated: data.has_more || blocks.some(b => b.hasChildren) }; } }),
  defineTool({ id: 'notion.page.append_text', providerId: 'notion', title: 'Append text to page', description: 'Append one plain paragraph to a selected page. Notion provides no atomic revision precondition.', effect: 'write', schema: page.extend({ text: inputText(2000) }), requiredScopes: ['insert_content'], resourceFormat: 'notion:page:uuid', mapResources: resource,
    request: a => ({ method: 'PATCH', path: `/v1/blocks/${segment(a.pageId)}/children`, headers, body: { children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: a.text } }] } }] } }), normalize: r => { const data = parse(z.object({ results: z.array(z.object({ id: uuid, last_edited_time: z.string().max(100) })).min(1).max(1) }), r.body); return { data: { blocks: data.results }, receipt: `notion:block:${data.results[0].id}`, revision: data.results[0].last_edited_time }; } }),
];
