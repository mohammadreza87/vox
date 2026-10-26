import { describe, expect, it } from 'vitest';
import type { ConnectionProfile } from '../config';
import { catalogForProfiles } from '../inventory';
import { McpConnectionsCatalog, snapshotMcpCatalog } from '../mcp/catalog';

/**
 * Settings Part 2b S0: enrolled connections store `catalogDigest`, and their sealed credentials are bound to the
 * connection revision. A digest change for an existing profile or MCP catalog would pause every such connection
 * until the person signs in again. These values were computed before Part 2b and must not move.
 */
const profile = (providerId: string, resources: ConnectionProfile['resources'], agentId?: string): ConnectionProfile => ({
  accountId: 'telegram-account:7', space: 'work', ...(agentId ? { agentId } : {}), providerId, providerSubject: 'qa-subject',
  providerTenantId: 'qa-tenant', endpointProfileId: `${providerId.replace(/_/g, '-')}-default`, setup: 'oauth', qualified: true,
  evidenceReference: 'qa-evidence', dailyModelTokenCeiling: 0, dailyToolCallCeiling: 0, resources });
const drive = profile('google_drive', [{ id: 'google_drive:file:qa-file-1', label: 'QA file', toolIds: ['google_drive.file.get'] }], 'agent-a');
const docs = profile('google_docs', [{ id: 'google_docs:document:qa-doc-1', label: 'QA doc', toolIds: ['google_docs.document.get', 'google_docs.document.insert_text'] }], 'agent-a');
const github = profile('github', [{ id: 'github:repo:qa/fixture', label: 'qa/fixture', toolIds: ['github.repository.get', 'github.issue.get'] }]);
const digestOf = (profiles: ConnectionProfile[], providerId: string) => catalogForProfiles(profiles).provider(providerId)?.catalogDigest;

describe('catalog digest pin (existing enrolled connections stay valid)', () => {
  it('pins profile-derived digests, including the multi-profile coupling Part 2b leaves in place', () => {
    expect({
      driveAlone: digestOf([drive], 'google_drive'),
      docsAlone: digestOf([docs], 'google_docs'),
      driveWithDocs: digestOf([drive, docs], 'google_drive'),
      docsWithDrive: digestOf([drive, docs], 'google_docs'),
      githubUnbound: digestOf([github], 'github'),
      noProfiles: digestOf([], 'google_drive'),
    }).toEqual(PINNED_PROFILE_DIGESTS);
  });

  it('pins the MCP catalog digest (hashes the snapshot only, never destinations)', () => {
    const snapshot = snapshotMcpCatalog('https://mcp.example.com/mcp', [
      { name: 'search', description: 'Search QA notes', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } },
      { name: 'fetch', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false } },
    ]);
    const catalog = new McpConnectionsCatalog(snapshot);
    expect({ snapshot: snapshot.catalogDigest, provider: catalog.provider('remote_mcp')?.catalogDigest, endpointProfileId: catalog.endpointProfileId })
      .toEqual(PINNED_MCP_DIGESTS);
  });
});

// Computed at ecc6582 (before Part 2b). Never regenerate these to make a failing test pass.
const PINNED_PROFILE_DIGESTS = {
  driveAlone: '14a9ec192532777f5182e3790c75b923d965e1385db308be1527fbd7b9dc917e',
  docsAlone: '49bf9efddda30804854132c3f77c194b883ed5ceef603c863485a8ccf8d61b87',
  driveWithDocs: 'ee4f21f783a47bd82655e2b28ea2f02c5f9b88f6019938002cd8438a60b9c062',
  docsWithDrive: '1f45bbde833891f4306619e8d35e831123e0defd25ed3d660aa27db07341b268',
  githubUnbound: '344d062da10227d9f9391fdbaaca53d1de0432587106875619dc2ca56a2babf5',
  noProfiles: '72b8e41b256c158831fcb776da6bc0a60b01704fb3f48cf114b9617226828363',
};
const PINNED_MCP_DIGESTS = {
  snapshot: '3b2bc0dfcd48386b58294a04c44d68bbd854ad5486e7dd4ab80d98d3c2328f54',
  provider: '3b2bc0dfcd48386b58294a04c44d68bbd854ad5486e7dd4ab80d98d3c2328f54',
  endpointProfileId: 'mcp-3497e03f4abdcb7b7047d3f5903e5cd6267b06dcd2e3ff45b9b632fe7299b035',
};
