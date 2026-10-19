import { z } from 'zod';
import { defineTool, type ProviderToolDefinition } from './types';
import { componentId, safeText, parse, segment, object, extractText } from './normalization';
export const figmaTools: readonly ProviderToolDefinition[] = [
  defineTool({ id: 'figma.file.read_text', providerId: 'figma', title: 'Read selected Figma frame', description: 'Read bounded native text from one selected Figma node. No images, plugins or beta canvas writes.', effect: 'read', schema: z.object({ fileKey: componentId, nodeId: z.string().regex(/^\d{1,12}:\d{1,12}$/) }).strict(), requiredScopes: ['file_content:read'], resourceFormat: 'figma:file:fileKey:node:nodeId', mapResources: a => [`figma:file:${a.fileKey}:node:${a.nodeId}`],
    request: a => ({ method: 'GET', path: `/v1/files/${segment(a.fileKey)}/nodes?ids=${segment(a.nodeId)}&depth=6` }), normalize: (r, a) => {
      const data = parse(z.object({ name: safeText(500), lastModified: z.string().max(100), version: z.string().max(200) }), r.body);
      const nodes = object(object(r.body).nodes); const node = object(nodes[a.nodeId]); const document = object(node.document);
      const title = parse(safeText(500), document.name); const text = extractText(document, 'figma');
      return { data: { ...data, nodeId: a.nodeId, title, text: text.text }, revision: data.version, truncated: text.truncated };
    } }),
];
