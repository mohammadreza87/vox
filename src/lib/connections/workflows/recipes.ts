import { getProviderToolDefinition } from '../providers';
export interface WorkflowRecipe { toolId: string; arguments: Record<string, unknown>; fields: Array<{ key: string; label: string; type: 'text' | 'date'; value: string }> }
/** Explicit single-resource read recipes. These are UI suggestions only; core
 * revalidates the schema, catalogue, mapped resources and current grant. */
export function workflowRecipe(resourceId: string, toolIds: readonly string[]): WorkflowRecipe | null {
  const parts = resourceId.split(':');
  const recipes: Record<string, WorkflowRecipe> = {
    github: { toolId: 'github.repository.get', arguments: { owner: parts[2]?.split('/')[0], repository: parts[2]?.split('/')[1] }, fields: [] },
    forgejo: { toolId: 'forgejo.repository.get', arguments: { owner: parts[2]?.split('/')[0], repository: parts[2]?.split('/')[1] }, fields: [] },
    notion: { toolId: 'notion.page.read_content', arguments: { pageId: parts[2] }, fields: [] },
    slack: { toolId: 'slack.channel.get', arguments: { channelId: parts[2] }, fields: [] },
    google_drive: { toolId: 'google_drive.file.get', arguments: { fileId: parts[2] }, fields: [] },
    google_docs: { toolId: 'google_docs.document.get', arguments: { documentId: parts[2] }, fields: [] },
    google_sheets: { toolId: 'google_sheets.range.get', arguments: { spreadsheetId: parts[2], range: 'Sheet1!A1:B10' }, fields: [{ key: 'range', label: 'Sheet range', type: 'text', value: 'Sheet1!A1:B10' }] },
    google_slides: { toolId: 'google_slides.presentation.get', arguments: { presentationId: parts[2] }, fields: [] },
    gmail: { toolId: 'gmail.message.get', arguments: { messageId: parts[2] }, fields: [] },
    figma: { toolId: 'figma.file.read_text', arguments: { fileKey: parts[2], nodeId: parts.slice(4).join(':') }, fields: [] },
    hetzner: { toolId: 'hetzner.server.get', arguments: { serverId: Number(parts[2]) }, fields: [] },
    posthog: { toolId: 'posthog.insight.get', arguments: { projectId: parts[2], insightId: parts[4] }, fields: [] },
    gamend: { toolId: 'gamend.context', arguments: { orgId: parts[2], gameId: parts[4], envId: parts[6] }, fields: [] },
    browser: { toolId: 'browser.page.read', arguments: { targetId: parts[2] }, fields: [] },
    ssh: { toolId: 'ssh.service.status', arguments: { hostId: parts[2], serviceId: parts[4] }, fields: [] },
    google_analytics: { toolId: 'google_analytics.report.run', arguments: { propertyId: parts[2], startDate: '2026-01-01', endDate: '2026-01-01', metrics: ['activeUsers'], dimensions: ['date'], limit: 100 },
      fields: [{ key: 'startDate', label: 'Start date', type: 'date', value: '' }, { key: 'endDate', label: 'End date', type: 'date', value: '' }] },
  };
  const recipe = recipes[parts[0]];
  if (!recipe || !toolIds.includes(recipe.toolId)) return null;
  const tool = getProviderToolDefinition(recipe.toolId);
  if (!tool || tool.effect !== 'read' || !tool.schema.safeParse(recipe.arguments).success) return null;
  return recipe;
}
export interface WorkflowChoice extends WorkflowRecipe { id: string; grantId: string; agentId: string; connectionId: string; providerId: string; label: string; resourceId: string; expiresAt: number }
