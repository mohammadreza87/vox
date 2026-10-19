import { z } from 'zod';
import { defineTool, type ProviderToolDefinition } from './types';
import { inputText, safeText, positiveId, parse, segment } from './normalization';
const name = z.string().min(1).max(80).regex(/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/).refine(v => v !== '.' && v !== '..');
const repository = z.object({ owner: name, repository: name }).strict();
const path = (a: z.infer<typeof repository>) => `/api/v1/repos/${segment(a.owner)}/${segment(a.repository)}`;
const resource = (a: z.infer<typeof repository>) => [`forgejo:repo:${a.owner.toLowerCase()}/${a.repository.toLowerCase()}`];
const issue = z.object({ id: positiveId, number: positiveId, title: safeText(500), body: safeText(32000).optional(), state: z.enum(['open', 'closed']), updated_at: z.string().max(100) });
export const forgejoTools: readonly ProviderToolDefinition[] = [
  defineTool({ id: 'forgejo.repository.get', providerId: 'forgejo', title: 'Read Forgejo repository', description: 'Read one selected repository on the registered instance; installed version/token must be qualified.', effect: 'read', schema: repository, requiredScopes: ['read:repository'], resourceFormat: 'forgejo:repo:owner/repository', mapResources: resource,
    request: a => ({ method: 'GET', path: path(a) }), normalize: (r, a) => ({ data: parse(z.object({ id: positiveId, full_name: z.string().refine(value => value.toLowerCase() === `${a.owner}/${a.repository}`.toLowerCase()), private: z.boolean(), default_branch: safeText(200), description: safeText(1000), updated_at: z.string().max(100) }), r.body) }) }),
  ...(['issue', 'pull_request'] as const).map(kind => defineTool({ id: `forgejo.${kind}.get`, providerId: 'forgejo', title: kind === 'issue' ? 'Read Forgejo issue' : 'Read Forgejo pull request', description: 'Read an exact numbered issue or pull request; no generic API access.', effect: 'read', schema: repository.extend({ number: positiveId }), requiredScopes: ['read:issue'], resourceFormat: 'forgejo:repo:owner/repository', mapResources: resource,
    request: a => ({ method: 'GET', path: `${path(a)}/${kind === 'issue' ? 'issues' : 'pulls'}/${a.number}` }), normalize: (r, a) => { const data = parse(issue.extend({ number: z.literal(a.number) }), r.body); return { data, revision: data.updated_at }; } })),
  defineTool({ id: 'forgejo.issue.create', providerId: 'forgejo', title: 'Create Forgejo issue', description: 'Create one issue with exact title/body in the approved repository; no assignments.', effect: 'write', schema: repository.extend({ title: inputText(256), body: inputText(32000) }), requiredScopes: ['write:issue'], resourceFormat: 'forgejo:repo:owner/repository', mapResources: resource,
    request: a => ({ method: 'POST', path: `${path(a)}/issues`, body: { title: a.title, body: a.body } }), normalize: r => { const data = parse(issue, r.body); return { data, receipt: `forgejo:issue:${data.id}`, revision: data.updated_at }; } }),
];
