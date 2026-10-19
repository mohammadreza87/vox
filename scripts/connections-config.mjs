#!/usr/bin/env node
// Execute with: node --import tsx scripts/connections-config.mjs <generate|check> ...
// Offline only. Never loads dotenv, starts services, generates secrets, or calls providers.
import { promises as fs } from 'node:fs';
import { resolve, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectionsConfigurationSchema } from '../src/lib/connections/config.ts';
import { brokerConfigurationSchema } from '../src/lib/connections/broker/bootstrap.ts';
import { createConnectionsCatalog, isCanonicalProviderResource } from '../src/lib/connections/catalog.ts';
import { providerDefinitions, getProviderDefinition, getProviderToolDefinition } from '../src/lib/connections/providers/index.ts';
import { DEFAULT_ENDPOINT_PROFILES } from '../src/lib/connections/transport.ts';
import { validateOAuthProfile } from '../src/lib/connections/broker/oauth.ts';
import { providerScopePermits } from '../src/lib/connections/broker/service.ts';
const uid = '10000000-0000-4000-8000-000000000001';
const org = '10000000-0000-4000-8000-000000000002';
const env = '10000000-0000-4000-8000-000000000003';
const hash = '0'.repeat(64);
const googleFile = 'SYNTHETIC_SELECTED_FILE';
const details = {
  github: { tool: 'github.repository.get', resource: 'github:repo:synthetic-owner/synthetic-repository', args: { owner: 'synthetic-owner', repository: 'synthetic-repository' }, scopes: ['metadata:read'], subject: `credential:${hash}`, tenant: 'repository_owner:100001', auth: 'Selected-repository GitHub App or qualified fine-grained token; the credential-resource identity path verifies exact repository access and returned owner ID, not installation ID.', setup: 'operator', identityKind: 'credential_resource', additional: 'GitHub user OAuth is a separate supported alternative; qualify /user plus exact repo rights. No merge, deployment or source writes are included.' },
  notion: { tool: 'notion.page.read_content', resource: `notion:page:${uid}`, args: { pageId: uid }, scopes: ['read_content'], subject: uid, tenant: org, auth: 'Notion internal/public integration token with read-content capability and explicit page sharing; /v1/users/me must return bot ID and bot.workspace_id.', setup: 'operator', identityKind: 'integration_bot', additional: 'Do not substitute workspace_name or owner labels. REST OAuth/PKCE setup is not enabled by this sample.' },
  slack: { tool: 'slack.channel.get', resource: 'slack:channel:C123456789', args: { channelId: 'C123456789' }, scopes: ['channels:read'], subject: 'U123456789', tenant: 'T123456789', auth: 'Workspace-approved Slack installation and a scoped user/bot token; auth.test verifies user/team. This public-channel identity example requires channels:read and channel visibility.', setup: 'operator', identityKind: 'provider_user', additional: 'Message history additionally needs channels:history (or groups:history for private channels); send needs separate chat:write and exact review. Actual rate class/admin governance remains unverified.' },
  google_drive: { tool: 'google_drive.file.get', resource: `google_drive:file:${googleFile}`, args: { fileId: googleFile }, scopes: ['openid', 'https://www.googleapis.com/auth/drive.file'], auth: 'Google system-browser OAuth with OpenID identity and selected-file drive.file access through a reviewed picker.', setup: 'oauth' },
  google_docs: { tool: 'google_docs.document.get', resource: `google_docs:document:${googleFile}`, args: { documentId: googleFile }, scopes: ['openid', 'https://www.googleapis.com/auth/drive.file'], auth: 'Google system-browser OAuth and explicitly selected document; qualify drive.file compatibility for this document.', setup: 'oauth' },
  google_sheets: { tool: 'google_sheets.range.get', resource: `google_sheets:spreadsheet:${googleFile}`, args: { spreadsheetId: googleFile, range: 'Sheet1!A1:B2' }, scopes: ['openid', 'https://www.googleapis.com/auth/drive.file'], auth: 'Google system-browser OAuth and selected spreadsheet; tool arguments must name an explicit rectangle of at most 1000 cells.', setup: 'oauth' },
  google_slides: { tool: 'google_slides.presentation.get', resource: `google_slides:presentation:${googleFile}`, args: { presentationId: googleFile }, scopes: ['openid', 'https://www.googleapis.com/auth/drive.file'], auth: 'Google system-browser OAuth and selected presentation; this example reads bounded text only.', setup: 'oauth' },
  gmail: { tool: 'gmail.message.get', resource: 'gmail:message:abcdef1234567890', args: { messageId: 'abcdef1234567890' }, scopes: ['openid', 'https://www.googleapis.com/auth/gmail.readonly'], auth: 'Personal-only Google OAuth; Gmail read is a restricted scope requiring reviewed verification/assessment or applicable exemption.', setup: 'oauth', additional: 'No compose or send scope is requested by this read example; each is separately reviewed and sending binds exact recipients/content.' },
  figma: { tool: 'figma.file.read_text', resource: 'figma:file:SYNTHETIC_FILE:node:1:2', args: { fileKey: 'SYNTHETIC_FILE', nodeId: '1:2' }, scopes: ['current_user:read', 'file_content:read'], subject: '100001', tenant: '100001', auth: 'Qualified Figma OAuth/PAT with current_user:read for /v1/me plus file_content:read for the selected node.', setup: 'operator', identityKind: 'provider_user', additional: 'REST scopes do not qualify custom-client Figma MCP entitlement or beta canvas writes.' },
  forgejo: { tool: 'forgejo.repository.get', resource: 'forgejo:repo:synthetic-owner/synthetic-repository', args: { owner: 'synthetic-owner', repository: 'synthetic-repository' }, scopes: ['read:repository'], subject: '100001', tenant: '100001', auth: 'Dedicated application token on registered git.joyixir.com; verify installed-version token restrictions and /api/v1/user identity.', setup: 'operator', identityKind: 'provider_user', additional: 'Do not assume Forgejo OAuth scopes are enforced. Token repository allowlist and version qualification remain required.' },
  hetzner: { tool: 'hetzner.server.get', resource: 'hetzner:server:100001', args: { serverId: 100001 }, scopes: ['project:read'], subject: `credential:${hash}`, tenant: `credential_scope:${hash}`, auth: 'Read-only Hetzner Cloud project token. Exact server read verifies a credential-bound capability profile; Cloud account/project ID remains unavailable.', setup: 'operator', identityKind: 'credential_resource', additional: 'Read access does not prove project:read_write. Reboot is privileged and excluded from this sample.' },
  google_analytics: { tool: 'google_analytics.report.run', resource: 'google_analytics:property:100001', args: { propertyId: '100001', startDate: '2026-10-01', endDate: '2026-10-02', metrics: ['activeUsers'], dimensions: ['date'], limit: 10 }, scopes: ['openid', 'https://www.googleapis.com/auth/analytics.readonly'], auth: 'Google OAuth with OpenID identity, analytics.readonly and exact GA4 property membership; no configuration writes.', setup: 'oauth', additional: 'Preserve property/date/timezone/threshold/freshness evidence; unsupported fields remain UNAVAILABLE.' },
  posthog: { tool: 'posthog.insight.get', resource: 'posthog:project:100001:insight:100002', args: { projectId: '100001', insightId: '100002' }, scopes: ['insight:read'], subject: `credential:${hash}`, tenant: 'project:100001', auth: 'Insight-scoped personal/secret API credential for one exact saved insight in the selected US/EU region; scoped capability identity makes no user-identity claim.', setup: 'operator', identityKind: 'credential_resource', additional: 'A native user/project identity alternative additionally requires user:read and project:read. Choose the region explicitly; no SQL/person/CLI exec surface.' },
  gamend: { tool: 'gamend.context', resource: `gamend:org:${org}:game:${uid}:env:${env}`, args: { orgId: org, gameId: uid, envId: env }, scopes: ['tenancy:read'], subject: uid, tenant: org, auth: 'Native delegated Gamend MCP credential with exact current org/game/environment and named read operations; context verifies grant ownerAdminId, scopes, expiry/revoke and MCP version.', setup: 'operator', identityKind: 'native_delegation', additional: 'AnalyticsController_engagement separately requires analytics:read. Native write/deploy capabilities are not exposed even when a native grant contains them.' },
  browser: { tool: 'browser.page.read', resource: 'browser:page:SYNTHETIC_PAGE', args: { targetId: 'SYNTHETIC_PAGE' }, scopes: ['worker:public_page_read'], subject: 'ATTESTED_WORKER_ID_REQUIRED', tenant: 'ATTESTED_SCOPE_REQUIRED', auth: 'Separately attested runner service plus broker operation lease and server-registered exact public HTTPS page inventory.', setup: 'operator', identityKind: 'worker_attestation', additional: 'Static bearer/OAuth token enrollment is unavailable. Initial worker is offline, no-JavaScript, public-page read only; authenticated and interactive browser work remains unavailable.' },
  ssh: { tool: 'ssh.service.status', resource: 'ssh:host:SYNTHETIC_HOST:service:SYNTHETIC_SERVICE', args: { hostId: 'SYNTHETIC_HOST', serviceId: 'SYNTHETIC_SERVICE' }, scopes: ['worker:service_status'], subject: 'ATTESTED_WORKER_ID_REQUIRED', tenant: 'ATTESTED_SCOPE_REQUIRED', auth: 'Separately attested worker with exact literal host IP, unprivileged user, independently verified Ed25519/ECDSA host key and registered service ID.', setup: 'operator', identityKind: 'worker_attestation', additional: 'Static bearer/OAuth enrollment is unavailable. Install the root-owned forced-command service.status runbook; no generic shell, sudo, uploads or privileged changes.' },
};
export function makeExamples(outputDirectory) {
  const root = resolve(outputDirectory);
  const profiles = providerDefinitions.map(provider => {
    const item = details[provider.id]; if (!item) throw new Error('example_provider_missing');
    return { accountId: 'telegram-account:1000000000000001', space: provider.id === 'gmail' ? 'personal' : 'work', providerId: provider.id,
      providerSubject: item.subject ?? 'SYNTHETIC_GOOGLE_SUBJECT', providerTenantId: item.tenant ?? 'SYNTHETIC_GOOGLE_SUBJECT', endpointProfileId: provider.endpointProfileId,
      setup: item.setup, qualified: false, evidenceReference: '', dailyModelTokenCeiling: 0, dailyToolCallCeiling: 0,
      resources: [{ id: item.resource, label: `SYNTHETIC ${provider.label} resource`, toolIds: [item.tool] }] };
  });
  const manifest = { schemaVersion: 1, enabled: false, profiles };
  const broker = { schemaVersion: 1, host: '127.0.0.1', port: 8789, brokerUid: 61001, studioUid: 61000,
    vaultDirectory: '/var/lib/vox-connections-broker/vault', vaultKeyFile: '/etc/vox-connections-broker/vault.key', authKeyFile: '/etc/vox-connections-broker/control.key',
    keyVersion: '1', studioOrigin: 'http://127.0.0.1:3000', enabledProviderIds: [], oauthProfiles: {},
    operatorScopes: Object.fromEntries(providerDefinitions.filter(p => details[p.id].setup === 'operator' && !['browser', 'ssh'].includes(p.id)).map(p => [p.id, details[p.id].scopes])),
    connectionsManifestFile: join(root, 'connections.manifest.example.json'), catalog: { resourceIdsByTool: {}, destinationIds: ['vox:private', 'model:studio'], endpointProfileIds: {} } };
  const setup = { schemaVersion: 1, exampleOnly: true, realProviderProof: 'UNAVAILABLE', providerCount: profiles.length, providers: providerDefinitions.map(provider => {
    const item = details[provider.id];
    return { providerId: provider.id, label: provider.label, exampleOnly: true, realProviderProof: 'UNAVAILABLE', identityKind: item.identityKind ?? 'provider_user',
      authOptions: item.auth, requestedScopesExample: item.scopes, supportedSetup: item.setup, resourceFormat: getProviderToolDefinition(item.tool).resourceFormat,
      toolId: item.tool, argumentsExample: item.args, endpointProfileId: provider.endpointProfileId, additional: item.additional ?? 'Resource rights, granted scopes and API compatibility require account-specific qualification.', documentationUrl: provider.documentationUrl };
  }) };
  return { manifest, broker, setup };
}
export function checkConfiguration(manifestInput, brokerInput, { manifestPath } = {}) {
  const issues = []; const warnings = [];
  const manifestParsed = connectionsConfigurationSchema.safeParse(manifestInput); const brokerParsed = brokerConfigurationSchema.safeParse(brokerInput);
  if (!manifestParsed.success) issues.push({ code: 'manifest_schema_invalid', count: manifestParsed.error.issues.length });
  if (!brokerParsed.success) issues.push({ code: 'broker_schema_invalid', count: brokerParsed.error.issues.length });
  if (!manifestParsed.success || !brokerParsed.success) return { status: 'FAIL', offline: true, realProviderProof: 'UNAVAILABLE', issues, warnings };
  const manifest = manifestParsed.data; const broker = brokerParsed.data;
  for (const path of [broker.vaultDirectory, broker.vaultKeyFile, broker.authKeyFile, broker.connectionsManifestFile]) if (!isAbsolute(path)) issues.push({ code: 'broker_path_must_be_absolute' });
  if (broker.brokerUid === broker.studioUid || broker.brokerUid === 0 || broker.studioUid === 0) issues.push({ code: 'broker_independent_uid_required' });
  if (resolve(broker.vaultKeyFile) === resolve(broker.authKeyFile)) issues.push({ code: 'broker_distinct_key_paths_required' });
  if (manifestPath && resolve(manifestPath) !== resolve(broker.connectionsManifestFile)) issues.push({ code: 'mirrored_manifest_path_mismatch' });
  if (new Set(broker.enabledProviderIds).size !== broker.enabledProviderIds.length) issues.push({ code: 'duplicate_enabled_provider' });
  for (const providerId of broker.enabledProviderIds) {
    if (!getProviderDefinition(providerId)) issues.push({ code: 'enabled_provider_unknown' });
    if (!manifest.profiles.some(profile => profile.providerId === providerId && profile.qualified)) warnings.push({ code: 'enabled_provider_has_no_qualified_profile' });
    if (['browser', 'ssh'].includes(providerId)) {
      if (!broker.runnerAdmissionFile || !isAbsolute(broker.runnerAdmissionFile)) issues.push({ code: 'runner_attestation_enrollment_not_configured' });
      else warnings.push({ code: 'runner_signed_attestation_and_runtime_proof_require_deployment_preflight' });
    }
  }
  if (Object.values(broker.catalog.resourceIdsByTool).some(resources => resources.length)) issues.push({ code: 'global_resource_union_forbidden' });
  for (const [providerId, oauth] of Object.entries(broker.oauthProfiles)) {
    try { validateOAuthProfile(oauth); if (oauth.providerId !== providerId) throw new Error(); }
    catch { issues.push({ code: 'oauth_profile_invalid' }); }
    if (!broker.enabledProviderIds.includes(providerId)) issues.push({ code: 'oauth_provider_not_enabled' });
    if ((providerId.startsWith('google_') || providerId === 'gmail') && !oauth.scopes.includes('openid')) issues.push({ code: 'google_openid_identity_scope_required' });
  }
  for (const [providerId, scopes] of Object.entries(broker.operatorScopes)) {
    if (!getProviderDefinition(providerId) || scopes.some(scope => !/^[A-Za-z0-9_.:/-]{1,200}$/.test(scope)) || new Set(scopes).size !== scopes.length) issues.push({ code: 'operator_scope_invalid' });
  }
  const partitions = new Map();
  for (const [index, profile] of manifest.profiles.entries()) {
    const provider = getProviderDefinition(profile.providerId); if (!provider) continue;
    const allowedProfiles = DEFAULT_ENDPOINT_PROFILES.filter(endpoint => endpoint.providerId === profile.providerId).map(endpoint => endpoint.id);
    if (['browser', 'ssh'].includes(profile.providerId)) allowedProfiles.push(provider.endpointProfileId);
    if (!allowedProfiles.includes(profile.endpointProfileId)) issues.push({ code: 'endpoint_profile_provider_mismatch', profileIndex: index });
    if (profile.qualified && !broker.enabledProviderIds.includes(profile.providerId)) issues.push({ code: 'qualified_provider_not_broker_enabled', profileIndex: index });
    if (!profile.qualified) warnings.push({ code: 'provider_account_qualification_unavailable', profileIndex: index });
    if (profile.setup === 'oauth' && profile.qualified && !broker.oauthProfiles[profile.providerId]) issues.push({ code: 'oauth_setup_profile_missing', profileIndex: index });
    if (profile.setup === 'operator' && profile.qualified && !broker.operatorScopes[profile.providerId]?.length && !['browser', 'ssh'].includes(profile.providerId)) issues.push({ code: 'operator_scopes_missing', profileIndex: index });
    if (profile.providerId === 'hetzner' && (!/^credential:[a-f0-9]{64}$/.test(profile.providerSubject) || profile.providerTenantId !== `credential_scope:${profile.providerSubject.slice(11)}`)) issues.push({ code: 'hetzner_credential_bound_identity_required', profileIndex: index });
    if (profile.providerId === 'posthog') {
      const matches = profile.resources.map(resource => /^posthog:project:(\d+):insight:(\d+)$/.exec(resource.id));
      if (!matches.length || matches.some(match => !match) || new Set(matches.filter(Boolean).map(match => match[1])).size !== 1) issues.push({ code: 'posthog_one_project_inventory_required', profileIndex: index });
      if (profile.providerSubject.startsWith('credential:') && matches[0] && profile.providerTenantId !== `project:${matches[0][1]}`) issues.push({ code: 'posthog_credential_project_mismatch', profileIndex: index });
    }
    if (profile.providerId === 'gamend') {
      const tuples = profile.resources.map(resource => /^gamend:org:([^:]+):game:([^:]+):env:([^:]+)$/.exec(resource.id)).filter(Boolean);
      if (!tuples.length || new Set(tuples.map(match => match[0])).size !== 1 || tuples[0][1] !== profile.providerTenantId) issues.push({ code: 'gamend_one_native_scope_required', profileIndex: index });
    }
    for (const resource of profile.resources) for (const toolId of resource.toolIds) {
      const tool = getProviderToolDefinition(toolId);
      if (!tool || !isCanonicalProviderResource(toolId, resource.id)) issues.push({ code: 'canonical_resource_invalid', profileIndex: index });
      if (profile.qualified && tool && !['browser', 'ssh'].includes(profile.providerId)) {
        const scopes = profile.setup === 'oauth' ? broker.oauthProfiles[profile.providerId]?.scopes ?? [] : broker.operatorScopes[profile.providerId] ?? [];
        if (tool.requiredScopes.some(required => !providerScopePermits(profile.providerId, required, scopes))) issues.push({ code: 'configured_scopes_do_not_cover_tool', profileIndex: index });
      }
    }
    const partition = JSON.stringify([profile.accountId, profile.space]); const entries = partitions.get(partition) ?? [];
    entries.push(profile); partitions.set(partition, entries);
  }
  for (const profiles of partitions.values()) {
    const resourceIdsByTool = {}; const endpointProfileIds = {};
    for (const profile of profiles) { endpointProfileIds[profile.providerId] = profile.endpointProfileId; for (const resource of profile.resources) for (const toolId of resource.toolIds) (resourceIdsByTool[toolId] ??= []).push(resource.id); }
    try { createConnectionsCatalog({ resourceIdsByTool, endpointProfileIds, destinationIds: ['vox:private', 'model:studio', ...profiles.map(profile => `provider:${profile.providerId}`)] }); }
    catch { issues.push({ code: 'partition_catalog_inventory_invalid' }); }
  }
  return { status: issues.length ? 'FAIL' : 'PASS', offline: true, realProviderProof: 'UNAVAILABLE', manifestEnabled: manifest.enabled,
    profileCount: manifest.profiles.length, providerCount: new Set(manifest.profiles.map(profile => profile.providerId)).size,
    qualifiedProfileCount: manifest.profiles.filter(profile => profile.qualified).length, issues, warnings };
}
async function readBoundedJson(path, limit) {
  const stat = await fs.lstat(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw new Error('configuration_file_invalid');
  const data = await fs.readFile(path, 'utf8'); if (Buffer.byteLength(data) > limit) throw new Error('configuration_file_invalid');
  return JSON.parse(data);
}
async function cli(args) {
  const [mode, ...rest] = args; const options = {};
  if (!['generate', 'check'].includes(mode) || rest.length % 2) throw new Error('configuration_arguments_invalid');
  for (let index = 0; index < rest.length; index += 2) { const key = rest[index]; if (!['--out', '--manifest', '--broker'].includes(key) || options[key]) throw new Error('configuration_arguments_invalid'); options[key] = rest[index + 1]; }
  if (mode === 'generate') {
    if (!options['--out'] || Object.keys(options).length !== 1) throw new Error('configuration_arguments_invalid');
    const output = resolve(options['--out']); const examples = makeExamples(output);
    const report = checkConfiguration(examples.manifest, examples.broker, { manifestPath: join(output, 'connections.manifest.example.json') });
    if (report.status !== 'PASS') throw new Error('generated_examples_invalid');
    await fs.mkdir(output, { recursive: true, mode: 0o700 });
    const files = ['connections.manifest.example.json', 'broker.example.json', 'provider-setup.examples.json'];
    for (const file of files) { try { await fs.lstat(join(output, file)); throw new Error('example_file_already_exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    for (const [index, value] of [examples.manifest, examples.broker, examples.setup].entries()) await fs.writeFile(join(output, files[index]), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    process.stdout.write(JSON.stringify({ ...report, generatedFiles: files, exampleOnly: true }) + '\n');
  } else {
    if (!options['--manifest'] || !options['--broker'] || Object.keys(options).length !== 2) throw new Error('configuration_arguments_invalid');
    const manifestPath = resolve(options['--manifest']); const brokerPath = resolve(options['--broker']);
    const report = checkConfiguration(await readBoundedJson(manifestPath, 512000), await readBoundedJson(brokerPath, 200000), { manifestPath });
    process.stdout.write(JSON.stringify(report) + '\n'); if (report.status !== 'PASS') process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli(process.argv.slice(2)).catch(error => {
  const codes = ['configuration_arguments_invalid', 'configuration_file_invalid', 'example_file_already_exists', 'generated_examples_invalid'];
  process.stderr.write((codes.includes(error.message) ? error.message : 'configuration_check_failed') + '\n'); process.exitCode = 1;
});
