import { describe, expect, it } from 'vitest';
import { makeExamples, checkConfiguration } from '../../../../scripts/connections-config.mjs';
import { createConnectionsCatalog } from '../catalog';
import { providerDefinitions } from '../providers';
import { workflowRecipe } from '../workflows/recipes';
const directory = '/tmp/vox-offline-config-fixture';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const examples = () => clone(makeExamples(directory));
const codes = (report: ReturnType<typeof checkConfiguration>) => report.issues.map((issue: { code: string }) => issue.code);
describe('offline Connections operator configuration', () => {
  it('generates all16 finite profiles with secrets absent, disabled switches, zero budgets and unavailable live evidence', () => {
    const { manifest, broker, setup } = examples();
    expect(manifest.enabled).toBe(false); expect(manifest.profiles).toHaveLength(16); expect(broker.enabledProviderIds).toEqual([]); expect(broker.oauthProfiles).toEqual({});
    for (const profile of manifest.profiles) expect(profile).toMatchObject({ qualified: false, evidenceReference: '', dailyToolCallCeiling: 0, dailyModelTokenCeiling: 0 });
    expect(new Set(setup.providers.map((provider: { providerId: string }) => provider.providerId))).toEqual(new Set(providerDefinitions.map(provider => provider.id)));
    for (const provider of setup.providers) expect(provider.realProviderProof).toBe('UNAVAILABLE');
    expect(JSON.stringify({ manifest, broker, setup })).not.toContain('clientSecret'); expect(JSON.stringify({ manifest, broker, setup })).not.toContain('accessToken');
    const report = checkConfiguration(manifest, broker, { manifestPath: directory + '/connections.manifest.example.json' });
    expect(report).toMatchObject({ status: 'PASS', offline: true, realProviderProof: 'UNAVAILABLE', profileCount: 16, qualifiedProfileCount: 0 });
  });
  it('gives actual schema-valid tool arguments and canonical resources for every provider example', () => {
    const { manifest, setup } = examples();
    for (const example of setup.providers) {
      const profile = manifest.profiles.find((item: { providerId: string }) => item.providerId === example.providerId)!;
      const catalog = createConnectionsCatalog({ resourceIdsByTool: { [example.toolId]: profile.resources.map((resource: { id: string }) => resource.id) }, destinationIds: ['vox:private'] });
      const args = catalog.validateArguments(example.toolId, example.argumentsExample);
      expect(catalog.mapResources(example.toolId, args)).toEqual(profile.resources.map((resource: { id: string }) => resource.id));
    }
  });
  it('keeps all16 minimum resource examples compatible with the code-owned single-read workflow recipes', () => {
    const { manifest } = examples();
    for (const profile of manifest.profiles) {
      const resource = profile.resources[0]; const recipe = workflowRecipe(resource.id, resource.toolIds);
      expect(recipe, profile.providerId).not.toBeNull();
    }
  });
  it('uses exact current manifest/broker schemas and never prints invalid private values', () => {
    const { manifest, broker } = examples(); manifest.profiles[0].resources[0].id = 'private-secret-value-not-a-resource';
    const report = checkConfiguration(manifest, broker); expect(report.status).toBe('FAIL'); expect(codes(report)).toContain('manifest_schema_invalid'); expect(JSON.stringify(report)).not.toContain('private-secret-value-not-a-resource');
    expect(codes(checkConfiguration({ schemaVersion: 999 }, { token: 'must-not-escape' }))).toEqual(['manifest_schema_invalid', 'broker_schema_invalid']);
  });
  it('rejects crossprovider endpoints, global inventory unions and duplicate enabled profiles', () => {
    const { manifest, broker } = examples(); manifest.profiles[0].endpointProfileId = 'notion-api'; broker.catalog.resourceIdsByTool = { 'github.repository.get': ['github:repo:synthetic-owner/synthetic-repository'] }; broker.enabledProviderIds = ['github', 'github'];
    const report = checkConfiguration(manifest, broker); expect(codes(report)).toEqual(expect.arrayContaining(['endpoint_profile_provider_mismatch', 'global_resource_union_forbidden', 'duplicate_enabled_provider']));
  });
  it('does not configure a runner by treating its opaque label as a bearer identity', () => {
    const { manifest, broker } = examples(); broker.enabledProviderIds = ['browser', 'ssh'];
    expect(codes(checkConfiguration(manifest, broker))).toContain('runner_attestation_enrollment_not_configured');
  });
  it('requires independent service UID, absolute distinct key paths and exact mirrored manifest path', () => {
    const { manifest, broker } = examples(); broker.studioUid = broker.brokerUid; broker.authKeyFile = broker.vaultKeyFile; broker.vaultDirectory = 'relative/vault';
    expect(codes(checkConfiguration(manifest, broker, { manifestPath: '/tmp/another-copy.json' }))).toEqual(expect.arrayContaining(['broker_independent_uid_required', 'broker_distinct_key_paths_required', 'broker_path_must_be_absolute', 'mirrored_manifest_path_mismatch']));
  });
  it('requires configured scopes/OAuth setup when a provider is declared qualified', () => {
    const { manifest, broker } = examples();
    const slack = manifest.profiles.find((profile: { providerId: string }) => profile.providerId === 'slack')!; slack.qualified = true; slack.evidenceReference = 'fixture:evidence'; broker.enabledProviderIds = ['slack']; broker.operatorScopes.slack = ['chat:write'];
    expect(codes(checkConfiguration(manifest, broker))).toContain('configured_scopes_do_not_cover_tool');
    const drive = manifest.profiles.find((profile: { providerId: string }) => profile.providerId === 'google_drive')!; drive.qualified = true; drive.evidenceReference = 'fixture:evidence'; broker.enabledProviderIds.push('google_drive');
    expect(codes(checkConfiguration(manifest, broker))).toContain('oauth_setup_profile_missing');
  });
  it('pins OAuth endpoint/callback/scope metadata without making account/private network calls', () => {
    const { manifest, broker } = examples(); broker.enabledProviderIds = ['google_drive'];
    broker.oauthProfiles = { google_drive: { providerId: 'google_drive', issuer: 'https://accounts.google.com', authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', revokeUrl: 'https://oauth2.googleapis.com/revoke', clientId: 'synthetic-fixture-client', clientSecret: 'synthetic-fixture-secret', callbackUrl: 'https://broker.example.invalid/oauth/callback/google_drive', scopes: ['openid', 'https://www.googleapis.com/auth/drive.file'] } };
    expect(checkConfiguration(manifest, broker).status).toBe('PASS');
    broker.oauthProfiles.google_drive.tokenUrl = 'https://attacker.invalid/token';
    expect(codes(checkConfiguration(manifest, broker))).toContain('oauth_profile_invalid');
    expect(JSON.stringify(checkConfiguration(manifest, broker))).not.toContain('synthetic-fixture-secret');
  });
  it('requires truthful credential-bound Hetzner identity and single PostHog/Gamend native partition', () => {
    const { manifest, broker } = examples(); const hetzner = manifest.profiles.find((profile: { providerId: string }) => profile.providerId === 'hetzner')!; hetzner.providerSubject = 'invented-person';
    const posthog = manifest.profiles.find((profile: { providerId: string }) => profile.providerId === 'posthog')!; posthog.resources.push({ id: 'posthog:project:999999:insight:100002', label: 'Other project', toolIds: ['posthog.insight.get'] });
    const gamend = manifest.profiles.find((profile: { providerId: string }) => profile.providerId === 'gamend')!; gamend.providerTenantId = 'not-the-native-org';
    expect(codes(checkConfiguration(manifest, broker))).toEqual(expect.arrayContaining(['hetzner_credential_bound_identity_required', 'posthog_one_project_inventory_required', 'gamend_one_native_scope_required']));
  });
  it('does not accept a Work Gmail partition or arbitrary tool/URL resource IDs', () => {
    const { manifest, broker } = examples(); const mail = manifest.profiles.find((profile: { providerId: string }) => profile.providerId === 'gmail')!; mail.space = 'work';
    expect(codes(checkConfiguration(manifest, broker))).toContain('manifest_schema_invalid');
  });
});
