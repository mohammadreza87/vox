import { describe, expect, it } from 'vitest';
import { createConnectionsCatalog, listProviderDefinitions, isCanonicalProviderResource } from '../catalog';
import { providerDefinitions, providerToolDefinitions, getProviderToolDefinition } from '../providers';
import { ProviderRegistry } from '../providers/registry';
import { ProviderError, type ProviderHttpRequest, type ProviderTransport } from '../transport';
const pageId = '10000000-0000-4000-8000-000000000001';
const orgId = '10000000-0000-4000-8000-000000000002';
const envId = '10000000-0000-4000-8000-000000000003';
const requestId = '10000000-0000-4000-8000-000000000004';
const date = '2026-10-19T00:00:00.000Z';
const repo = { owner: 'example', repository: 'synthetic' };
const item = { id: 4, number: 1, title: 'Synthetic issue', body: 'Synthetic body', state: 'open', updated_at: date };
const selected = { orgId, gameId: pageId, envId };
const native = (data: unknown) => ({ jsonrpc: '2.0', id: 'vox-connections', result: { isError: false, structuredContent: data } });
type Fixture = { id: string; args: Record<string, unknown>; body: unknown; method: string; path: string };
const fixtures: Fixture[] = [
  { id: 'github.repository.get', args: repo, body: { id: 1, full_name: 'example/synthetic', private: true, default_branch: 'main', description: 'Synthetic repository', updated_at: date, token: 'must-not-escape' }, method: 'GET', path: '/repos/example/synthetic' },
  { id: 'github.issue.get', args: { ...repo, number: 1 }, body: item, method: 'GET', path: '/repos/example/synthetic/issues/1' },
  { id: 'github.pull_request.get', args: { ...repo, number: 1 }, body: item, method: 'GET', path: '/repos/example/synthetic/pulls/1' },
  { id: 'github.issue.create', args: { ...repo, title: 'Synthetic', body: 'Body' }, body: item, method: 'POST', path: '/repos/example/synthetic/issues' },
  { id: 'github.pull_request.create_draft', args: { ...repo, title: 'Synthetic', body: 'Body', base: 'main', head: 'change' }, body: { ...item, draft: true }, method: 'POST', path: '/repos/example/synthetic/pulls' },
  { id: 'notion.page.get', args: { pageId }, body: { id: pageId, last_edited_time: date, archived: false, properties: { secret: 'must-not-escape' } }, method: 'GET', path: `/v1/pages/${pageId}` },
  { id: 'notion.page.read_content', args: { pageId }, body: { results: [{ id: pageId, type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Synthetic paragraph' }] }, has_children: false }], has_more: false }, method: 'GET', path: `/v1/blocks/${pageId}/children?page_size=50` },
  { id: 'notion.page.append_text', args: { pageId, text: 'Synthetic paragraph' }, body: { results: [{ id: pageId, last_edited_time: date }] }, method: 'PATCH', path: `/v1/blocks/${pageId}/children` },
  { id: 'slack.channel.get', args: { channelId: 'C123456789' }, body: { ok: true, channel: { id: 'C123456789', name: 'synthetic-channel', is_private: false, updated: 1700000000, context_team_id: 'T123456789', topic: { value: 'must-not-escape' } } }, method: 'GET', path: '/api/conversations.info?channel=C123456789' },
  { id: 'slack.channel.history', args: { channelId: 'C123456789' }, body: { ok: true, messages: [{ ts: '1234567890.123456', text: 'Synthetic channel message', user: 'U123456789', privateMetadata: 'must-not-escape' }], has_more: false }, method: 'GET', path: '/api/conversations.history?channel=C123456789&limit=15' },
  { id: 'slack.message.send', args: { channelId: 'C123456789', text: 'Synthetic text' }, body: { ok: true, channel: 'C123456789', ts: '1234567890.123456' }, method: 'POST', path: '/api/chat.postMessage' },
  { id: 'google_drive.file.get', args: { fileId: 'selected' }, body: { id: 'selected', name: 'Synthetic file', mimeType: 'text/plain', modifiedTime: date, version: '2' }, method: 'GET', path: '/drive/v3/files/selected?supportsAllDrives=true&fields=id,name,mimeType,modifiedTime,version,size' },
  { id: 'google_docs.document.get', args: { documentId: 'selected' }, body: { documentId: 'selected', title: 'Synthetic doc', revisionId: 'rev2', tabs: [{ documentTab: { body: { content: [{ paragraph: { elements: [{ textRun: { content: 'Synthetic document text' } }] } }] } } }] }, method: 'GET', path: '/v1/documents/selected?includeTabsContent=true' },
  { id: 'google_docs.document.insert_text', args: { documentId: 'selected', tabId: 'tab1', index: 1, text: 'Synthetic', requiredRevisionId: 'rev2' }, body: { documentId: 'selected', writeControl: { requiredRevisionId: 'rev3' } }, method: 'POST', path: '/v1/documents/selected:batchUpdate' },
  { id: 'google_sheets.range.get', args: { spreadsheetId: 'selected', range: 'Sheet1!A1:B2' }, body: { range: 'Sheet1!A1:B2', majorDimension: 'ROWS', values: [['Label', 2], ['Other', 3]] }, method: 'GET', path: '/v4/spreadsheets/selected/values/Sheet1!A1%3AB2?valueRenderOption=FORMATTED_VALUE' },
  { id: 'google_sheets.range.update', args: { spreadsheetId: 'selected', range: 'Sheet1!A1:B2', values: [['Synthetic', 2]] }, body: { spreadsheetId: 'selected', updatedRange: 'Sheet1!A1:B1', updatedRows: 1, updatedColumns: 2, updatedCells: 2 }, method: 'PUT', path: '/v4/spreadsheets/selected/values/Sheet1!A1%3AB2?valueInputOption=RAW&includeValuesInResponse=false' },
  { id: 'google_slides.presentation.get', args: { presentationId: 'selected' }, body: { presentationId: 'selected', title: 'Synthetic slides', revisionId: 'rev2', slides: [{ pageElements: [{ shape: { text: { textElements: [{ textRun: { content: 'Synthetic slide text' } }] } } }] }] }, method: 'GET', path: '/v1/presentations/selected?fields=presentationId,title,revisionId,slides(objectId,pageElements(objectId,shape(text(textElements(textRun(content))))))' },
  { id: 'google_slides.presentation.replace_text', args: { presentationId: 'selected', pageObjectIds: ['slide1'], find: 'old', replace: 'new', requiredRevisionId: 'rev2' }, body: { presentationId: 'selected', replies: [{ replaceAllText: { occurrencesChanged: 1 } }], writeControl: { requiredRevisionId: 'rev3' } }, method: 'POST', path: '/v1/presentations/selected:batchUpdate' },
  { id: 'gmail.message.get', args: { messageId: 'abcdef1234' }, body: { id: 'abcdef1234', threadId: 'abcdef5678', snippet: 'Synthetic mail', payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: 'Synthetic' }, { name: 'X-Secret', value: 'must-not-escape' }], body: { data: Buffer.from('Synthetic mail body').toString('base64url') } } }, method: 'GET', path: '/gmail/v1/users/me/messages/abcdef1234?format=full' },
  { id: 'gmail.message.create_draft', args: { to: ['fixture@example.com'], subject: 'Synthetic', body: 'Draft' }, body: { id: 'draft_1', message: { id: 'abcdef1234', threadId: 'abcdef5678' } }, method: 'POST', path: '/gmail/v1/users/me/drafts' },
  { id: 'gmail.message.send', args: { to: ['fixture@example.com'], subject: 'Synthetic', body: 'Mail' }, body: { id: 'abcdef1234', threadId: 'abcdef5678' }, method: 'POST', path: '/gmail/v1/users/me/messages/send' },
  { id: 'figma.file.read_text', args: { fileKey: 'selected', nodeId: '1:2' }, body: { name: 'Synthetic design', lastModified: date, version: '2', nodes: { '1:2': { document: { name: 'Frame', children: [{ characters: 'Synthetic design text' }] } } } }, method: 'GET', path: '/v1/files/selected/nodes?ids=1%3A2&depth=6' },
  { id: 'forgejo.repository.get', args: repo, body: { id: 1, full_name: 'example/synthetic', private: true, default_branch: 'main', description: 'Synthetic', updated_at: date }, method: 'GET', path: '/api/v1/repos/example/synthetic' },
  { id: 'forgejo.issue.get', args: { ...repo, number: 1 }, body: item, method: 'GET', path: '/api/v1/repos/example/synthetic/issues/1' },
  { id: 'forgejo.pull_request.get', args: { ...repo, number: 1 }, body: item, method: 'GET', path: '/api/v1/repos/example/synthetic/pulls/1' },
  { id: 'forgejo.issue.create', args: { ...repo, title: 'Synthetic', body: 'Body' }, body: item, method: 'POST', path: '/api/v1/repos/example/synthetic/issues' },
  { id: 'hetzner.server.get', args: { serverId: 1 }, body: { server: { id: 1, name: 'Synthetic server', status: 'running', created: date, server_type: { name: 'cx23', cores: 2, memory: 4, disk: 40 }, datacenter: { name: 'hel1-dc2', location: { name: 'hel1' } }, public_net: { ip: 'must-not-escape' } } }, method: 'GET', path: '/v1/servers/1' },
  { id: 'hetzner.server.reboot', args: { serverId: 1 }, body: { action: { id: 2, command: 'reboot_server', status: 'running', progress: 0 } }, method: 'POST', path: '/v1/servers/1/actions/reboot' },
  { id: 'hetzner.action.get', args: { serverId: 1, actionId: 2 }, body: { action: { id: 2, command: 'reboot_server', status: 'success', progress: 100 } }, method: 'GET', path: '/v1/servers/1/actions/2' },
  { id: 'google_analytics.report.run', args: { propertyId: '1', startDate: '2026-10-01', endDate: '2026-10-19', metrics: ['activeUsers'], dimensions: ['date'], limit: 10 }, body: { metricHeaders: [{ name: 'activeUsers', type: 'TYPE_INTEGER' }], dimensionHeaders: [{ name: 'date' }], rows: [{ dimensionValues: [{ value: '20261019' }], metricValues: [{ value: '4' }] }], rowCount: 1, metadata: { timeZone: 'Europe/Tallinn', subjectToThresholding: true } }, method: 'POST', path: '/v1beta/properties/1:runReport' },
  { id: 'posthog.insight.get', args: { projectId: '1', insightId: '2' }, body: { id: 2, name: 'Synthetic insight', last_refresh: date, result: [{ label: 'Page views', data: [1, 2], days: ['2026-10-18', '2026-10-19'] }], query: { sql: 'must-not-escape' } }, method: 'GET', path: '/api/projects/1/insights/2/' },
  { id: 'gamend.context', args: selected, body: native({ organizationId: orgId, games: [{ id: pageId, name: 'Synthetic game', reportingTimezone: 'UTC' }], environments: [{ id: envId, gameId: pageId, name: 'Staging', slug: 'staging' }], pagination: { nextGameCursor: null }, metrics: { definitionVersion: '1', timeStorage: 'UTC', reportingTimezone: 'game timezone', missingData: 'UNAVAILABLE', canonicalEvents: 'federation_event_copies' } }), method: 'POST', path: '/v1/mcp' },
  { id: 'gamend.discover', args: selected, body: native({ items: [{ operationId: 'GameTimezoneController_get', description: 'Read reporting timezone', effect: 'read', availability: 'served' }, { operationId: 'Admin_delete', description: 'Excluded', effect: 'write' }], nextCursor: null, catalogVersion: '1' }), method: 'POST', path: '/v1/mcp' },
  { id: 'gamend.describe', args: { ...selected, operationId: 'GameTimezoneController_get' }, body: native({ operationId: 'GameTimezoneController_get', effect: 'read', availability: 'served', description: 'Read timezone', requiresSensitive: false, requiresCredentialAdmin: false, requiresDestructive: false, secretResult: false }), method: 'POST', path: '/v1/mcp' },
  { id: 'gamend.preview', args: { ...selected, operationId: 'GameTimezoneController_get' }, body: native({ operationId: 'GameTimezoneController_get', scope: { orgId, gameId: pageId }, effect: 'read', executed: false, simulationAvailable: false, validation: 'schema-and-current-authority', requiresRequestId: false }), method: 'POST', path: '/v1/mcp' },
  { id: 'gamend.execute', args: { ...selected, operationId: 'AnalyticsController_engagement', from: '2026-10-01', to: '2026-10-19', granularity: 'day', platform: 'android' }, body: native({ contractVersion: 'gamend-agent/1', operationId: 'AnalyticsController_engagement', status: 'succeeded', data: { asOf: date, timezone: 'UTC', granularity: 'day', totalEvents: '2', series: [{ bucket: date, players: 1, sessions: 1, events: 2 }] }, provenance: { scope: { orgId, gameId: pageId, envId }, observedAt: date, truncated: false } }), method: 'POST', path: '/v1/mcp' },
  { id: 'gamend.status', args: { ...selected, requestId }, body: native({ id: requestId, requestId, operationId: 'Native_named_operation', scope: { orgId, gameId: pageId, envId }, status: 'unknown', startedAt: date, completedAt: null, safeResult: { secret: 'must-not-escape' } }), method: 'POST', path: '/v1/mcp' },
];
function setup(fixture: Fixture, body = fixture.body) {
  const tool = getProviderToolDefinition(fixture.id)!; const args = tool.schema.parse(fixture.args);
  const resources = tool.mapResources(args); const catalog = createConnectionsCatalog({ resourceIdsByTool: { [fixture.id]: resources }, destinationIds: ['vox:private'] });
  const calls: ProviderHttpRequest[] = [];
  const transport: ProviderTransport = { async request(input) { calls.push(input); return { status: 200, headers: {}, body }; } };
  const registry = new ProviderRegistry({ catalog, transport }); const provider = catalog.provider(tool.providerId)!;
  const context = { credential: { providerId: tool.providerId, endpointProfileId: provider.endpointProfileId, accessToken: 'synthetic-provider-credential' }, operationId: requestId, scopeKind: 'personal' as const };
  return { registry, context, calls, resources, catalog };
}
describe('code-owned provider adapters', () => {
  it('qualifies every finite tool with an actual request/normalized response fixture', () => expect(new Set(fixtures.map(f => f.id))).toEqual(new Set(providerToolDefinitions.filter(t => !['browser','ssh'].includes(t.providerId)).map(t => t.id))));
  it.each(fixtures)('$id has an exact request and strips unrelated provider metadata', async fixture => {
    const { registry, context, calls, resources } = setup(fixture); const result = await registry.execute(fixture.id, fixture.args, context);
    expect(calls).toHaveLength(1); expect(calls[0].path).toBe(fixture.path); expect(calls[0].method).toBe(fixture.method);
    expect(result.resourceIds).toEqual(resources); expect(result.untrustedContent).toBe(true);
    expect(JSON.stringify(result)).not.toContain('must-not-escape'); expect(JSON.stringify(result)).not.toContain(context.credential.accessToken);
    for (const resource of result.resourceIds) { expect(resource.length).toBeLessThanOrEqual(200); expect(isCanonicalProviderResource(fixture.id, resource)).toBe(true); }
    if (getProviderToolDefinition(fixture.id)!.effect !== 'read') expect(result.providerReceiptRef).toMatch(/^[A-Za-z0-9_.:@/-]+$/);
  });
  it('lists 16 provider/worker profiles with explicit unavailable account/release evidence and input JSON schemas', () => {
    const views = listProviderDefinitions(); expect(views).toHaveLength(16);
    for (const provider of views) { expect(provider.accountEvidence).toBe('unavailable'); expect(provider.releaseState).toBe('disabled_pending_qualification'); expect(provider.tools.length).toBeGreaterThan(0); for (const tool of provider.tools) expect(tool.inputSchema).toHaveProperty('$schema'); }
    expect(new Set(providerDefinitions.map(p => p.id)).size).toBe(16);
  });
  it('cannot execute before a server-reviewed resource inventory exists', async () => {
    const { context } = setup(fixtures[0]); let sends = 0; const registry = new ProviderRegistry({ transport: { async request() { sends++; throw new Error('must not call'); } } });
    await expect(registry.execute(fixtures[0].id, fixtures[0].args, context)).rejects.toMatchObject({ code: 'provider_arguments_or_resource_denied', outcome: 'not_dispatched' }); expect(sends).toBe(0);
  });
  it('rejects wire passthrough, unknown fields, wrong targets and wrong credential profiles before dispatch', async () => {
    const { registry, context, calls } = setup(fixtures[0]);
    for (const args of [{ ...repo, url: 'https://internal.invalid' }, { ...repo, repository: '..' }, { ...repo, owner: 'other' }]) await expect(registry.execute(fixtures[0].id, args, context)).rejects.toMatchObject({ outcome: 'not_dispatched' });
    await expect(registry.execute(fixtures[0].id, repo, { ...context, credential: { ...context.credential, providerId: 'notion' } })).rejects.toMatchObject({ code: 'credential_profile_mismatch' }); expect(calls).toHaveLength(0);
  });
  it('prevents Gmail in Work and binds exact recipients into the resource set', async () => {
    const fixture = fixtures.find(f => f.id === 'gmail.message.send')!; const { registry, context, resources, calls } = setup(fixture);
    expect(resources).toHaveLength(2); expect(resources[1]).not.toContain('@');
    await expect(registry.execute(fixture.id, fixture.args, { ...context, scopeKind: 'work' })).rejects.toMatchObject({ code: 'provider_space_denied' });
    await expect(registry.execute(fixture.id, { ...fixture.args, to: ['elsewhere@example.com'] }, context)).rejects.toMatchObject({ outcome: 'not_dispatched' }); expect(calls).toHaveLength(0);
  });
  it('encodes exact reviewed MIME recipients and prohibits mail header injection', async () => {
    const fixture = fixtures.find(f => f.id === 'gmail.message.send')!; const { registry, context, calls, catalog } = setup(fixture);
    await registry.execute(fixture.id, fixture.args, context); const mime = Buffer.from((calls[0].body as { raw: string }).raw, 'base64url').toString();
    expect(mime).toContain('To: fixture@example.com\r\n'); expect(mime).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(() => catalog.validateArguments(fixture.id, { ...fixture.args, subject: 'Hi\r\nBcc: hidden@example.com' })).toThrow();
  });
  it('requires fresh revisions and constrains range size/formulas/value shape', () => {
    const catalog = createConnectionsCatalog();
    for (const [id, args] of [
      ['google_docs.document.insert_text', { documentId: 'selected', tabId: 'tab', text: 'x', index: 1 }],
      ['google_sheets.range.get', { spreadsheetId: 'selected', range: 'Sheet1!A1:ZZ999' }],
      ['google_sheets.range.update', { spreadsheetId: 'selected', range: 'Sheet1!A1:B2', values: [['=IMPORTXML("https://private")']] }],
      ['google_sheets.range.update', { spreadsheetId: 'selected', range: 'Sheet1!A1:A1', values: [['x', 'y']] }],
    ] as const) expect(() => catalog.validateArguments(id, args)).toThrow();
  });
  it('never promotes provider MCP discovery or accepts arbitrary Gamend operations', async () => {
    const fixture = fixtures.find(f => f.id === 'gamend.discover')!; const { registry, context } = setup(fixture); const result = await registry.execute(fixture.id, fixture.args, context);
    expect(JSON.stringify(result)).not.toContain('Admin_delete'); expect(providerToolDefinitions.some(t => t.id === 'Admin_delete')).toBe(false);
    expect(() => createConnectionsCatalog().validateArguments('gamend.execute', { ...selected, operationId: 'Admin_delete', input: {} })).toThrow();
  });
  it('refuses mismatched Gamend org/game/environment provenance', async () => {
    const fixture = fixtures.find(f => f.id === 'gamend.execute')!;
    const { registry, context } = setup(fixture, native({ contractVersion: 'gamend-agent/1', operationId: 'AnalyticsController_engagement', status: 'succeeded', data: {}, provenance: { scope: { orgId: pageId, gameId: pageId, envId } } }));
    await expect(registry.execute(fixture.id, fixture.args, context)).rejects.toMatchObject({ code: 'provider_scope_mismatch' });
  });
  it.each(fixtures.filter(f => getProviderToolDefinition(f.id)!.effect !== 'read'))('$id treats malformed success as unknown, preventing unsafe retries', async fixture => {
    const { registry, context, calls } = setup(fixture, {});
    await expect(registry.execute(fixture.id, fixture.args, context)).rejects.toMatchObject({ outcome: 'unknown' }); expect(calls).toHaveLength(1);
  });
  it('does not return a credential echoed in permitted provider content', async () => {
    const fixture = fixtures.find(f => f.id === 'github.issue.get')!; const { registry, context } = setup(fixture, { ...item, body: 'synthetic-provider-credential' });
    await expect(registry.execute(fixture.id, fixture.args, context)).rejects.toBeInstanceOf(ProviderError);
  });
  it('pins catalog/schema/resource/destination revisions into deterministic digests', () => {
    const { catalog } = setup(fixtures[0]); const same = setup(fixtures[0]).catalog;
    expect(catalog.get(fixtures[0].id)).toEqual(same.get(fixtures[0].id));
    const changed = createConnectionsCatalog({ destinationIds: ['vox:other'] }); expect(changed.provider('github')!.catalogDigest).not.toBe(catalog.provider('github')!.catalogDigest);
  });
});
