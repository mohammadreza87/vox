import { z } from 'zod';
import { defineTool, type ProviderToolDefinition } from './types';
import { inputText, safeText, positiveId, parse, segment, object } from './normalization';
const name = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/).refine(v => v !== '.' && v !== '..');
const repository = z.object({ owner: name, repository: name }).strict();
const issue = repository.extend({ number: positiveId });
const issueResult = z.object({ id: positiveId, number: positiveId, title: safeText(500), body: safeText(32000).nullable().optional(), state: z.enum(['open', 'closed']), updated_at: z.string().max(100) });
const baseHeaders = { 'x-github-api-version': '2026-03-10' };
const repoResource = (a: z.infer<typeof repository>) => [`github:repo:${a.owner.toLowerCase()}/${a.repository.toLowerCase()}`];
const path = (a: z.infer<typeof repository>) => `/repos/${segment(a.owner)}/${segment(a.repository)}`;
export const githubTools: readonly ProviderToolDefinition[] = [
  defineTool({ id: 'github.repository.get', providerId: 'github', title: 'Read repository', description: 'Read one selected repository metadata.', effect: 'read', schema: repository, requiredScopes: ['metadata:read'], resourceFormat: 'github:repo:owner/repository', mapResources: repoResource,
    request: a => ({ method: 'GET', path: path(a), headers: baseHeaders }), normalize: (r, a) => ({ data: parse(z.object({ id: positiveId, full_name: z.string().refine(value => value.toLowerCase() === `${a.owner}/${a.repository}`.toLowerCase()), owner: z.object({ id: positiveId }).optional(), private: z.boolean(), default_branch: safeText(200), description: safeText(1000).nullable(), updated_at: z.string().max(100) }), r.body) }) }),
  ...(['issue', 'pull_request'] as const).map(kind => defineTool({ id: `github.${kind}.get`, providerId: 'github', title: kind === 'issue' ? 'Read issue' : 'Read pull request', description: 'Read one numbered item in a selected repository.', effect: 'read', schema: issue, requiredScopes: [kind === 'issue' ? 'issues:read' : 'pull_requests:read'], resourceFormat: 'github:repo:owner/repository', mapResources: repoResource,
    request: a => ({ method: 'GET', path: `${path(a)}/${kind === 'issue' ? 'issues' : 'pulls'}/${a.number}`, headers: baseHeaders }), normalize: (r, a) => { const data = parse(issueResult.extend({ number: z.literal(a.number) }), r.body); return { data, revision: data.updated_at }; } })),
  defineTool({ id: 'github.issue.create', providerId: 'github', title: 'Create issue', description: 'Create an issue in the exact approved repository; no assignments or labels.', effect: 'write', schema: repository.extend({ title: inputText(256), body: inputText(32000) }), requiredScopes: ['issues:write'], resourceFormat: 'github:repo:owner/repository', mapResources: repoResource,
    request: a => ({ method: 'POST', path: `${path(a)}/issues`, headers: baseHeaders, body: { title: a.title, body: a.body } }), normalize: r => { const data = parse(issueResult, r.body); return { data, receipt: `github:issue:${data.id}`, revision: data.updated_at }; } }),
  defineTool({ id: 'github.pull_request.create_draft', providerId: 'github', title: 'Create draft pull request', description: 'Create a draft pull request between existing same-repository branches.', effect: 'write', schema: repository.extend({ title: inputText(256), body: inputText(32000), base: name, head: name }), requiredScopes: ['pull_requests:write'], resourceFormat: 'github:repo:owner/repository', mapResources: repoResource,
    request: a => ({ method: 'POST', path: `${path(a)}/pulls`, headers: baseHeaders, body: { title: a.title, body: a.body, base: a.base, head: a.head, draft: true, maintainer_can_modify: false } }), normalize: r => { const data = parse(issueResult.extend({ draft: z.literal(true) }), object(r.body)); return { data, receipt: `github:pull:${data.id}`, revision: data.updated_at }; } }),
];
