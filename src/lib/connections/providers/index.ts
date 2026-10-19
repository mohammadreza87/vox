import type { ProviderDefinition, ProviderToolDefinition } from './types';
import { githubTools } from './github';
import { notionTools } from './notion';
import { slackTools } from './slack';
import { googleDriveTools, googleDocsTools, googleSheetsTools, googleSlidesTools } from './google';
import { gmailTools } from './gmail';
import { figmaTools } from './figma';
import { forgejoTools } from './forgejo';
import { hetznerTools } from './hetzner';
import { googleAnalyticsTools, posthogTools } from './analytics';
import { gamendTools } from './gamend';
import { browserTools, sshTools } from './runners';
export type { ProviderExecutionContext, ProviderResult, ProviderDefinition, ProviderToolDefinition } from './types';
const definitions: ProviderDefinition[] = [];
function register(id: string, label: string, endpointProfileId: string, auth: ProviderDefinition['auth'], documentationUrl: string,
  eligibilityReason: string, setup: string[], tools: readonly ProviderToolDefinition[], protocol: ProviderDefinition['protocol'] = 'rest') {
  definitions.push({ id, label, adapterId: `${id}-typed`, adapterVersion: '1.0.0', endpointProfileId, auth, protocol, documentationUrl,
    eligibility: 'requires_account_qualification', eligibilityReason, accountEvidence: 'unavailable', releaseState: 'disabled_pending_qualification', setup, tools });
}
register('github', 'GitHub', 'github-api', 'oauth_or_app_token', 'https://docs.github.com/en/rest/issues/issues',
  'Selected-repository installation, actual token permissions and account identity must be verified.', ['Register a GitHub App with selected repositories.', 'Request only per-tool metadata/issues/pull-request permissions.'], githubTools);
register('notion', 'Notion', 'notion-api', 'oauth_or_app_token', 'https://developers.notion.com/reference/retrieve-a-page',
  'Integration content capabilities and explicit selected-page sharing require account verification.', ['Create a Notion integration or authorize OAuth.', 'Share only the selected pages and enable the needed read/insert capabilities.'], notionTools);
register('slack', 'Slack', 'slack-api', 'oauth', 'https://docs.slack.dev/reference/methods/conversations.history/',
  'Workspace installation, app governance, channel membership and per-token scopes/rates remain unverified; remote MCP eligibility is separate.', ['Install the reviewed Slack app into the chosen workspace.', 'Approve only channel history and separately chat:write where needed.'], slackTools);
register('google_drive', 'Google Drive', 'google-drive-api', 'oauth', 'https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get',
  'Google OAuth app eligibility and selected-file drive.file access must be verified; Workspace MCP Preview is a separate path.', ['Configure the Google OAuth app.', 'Select explicit files using a reviewed drive.file picker.'], googleDriveTools);
register('google_docs', 'Google Docs', 'google-docs-api', 'oauth', 'https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/get',
  'Google OAuth app and selected-document drive.file compatibility require verification; no automatic MCP Preview admission.', ['Configure Google OAuth with drive.file.', 'Select the exact document; edits require its fresh revision.'], googleDocsTools);
register('google_sheets', 'Google Sheets', 'google-sheets-api', 'oauth', 'https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get',
  'Google OAuth app eligibility and selected-spreadsheet drive.file access require verification.', ['Configure Google OAuth with drive.file.', 'Select a spreadsheet and explicit bounded cell ranges.'], googleSheetsTools);
register('google_slides', 'Google Slides', 'google-slides-api', 'oauth', 'https://developers.google.com/workspace/slides/api/reference/rest/v1/presentations/get',
  'Google OAuth app eligibility and selected-presentation drive.file access require verification.', ['Configure Google OAuth with drive.file.', 'Select a presentation; edits require selected slides and a fresh revision.'], googleSlidesTools);
register('gmail', 'Gmail', 'gmail-api', 'oauth', 'https://developers.google.com/workspace/gmail/api/auth/scopes',
  'Restricted read/compose scopes, verification or security assessment/exemptions, and Personal-only account policy require qualification; send is separately scoped.', ['Use a Personal connection.', 'Verify required Google OAuth scope eligibility.', 'Select exact messages or recipients; sending requires exact content review.'], gmailTools);
register('figma', 'Figma', 'figma-api', 'oauth', 'https://developers.figma.com/docs/rest-api/file-endpoints/',
  'Read OAuth scopes, file access, plan/seat/rate limits require account qualification. Beta MCP canvas writes and custom client entitlement are unavailable here.', ['Authorize file_content:read.', 'Select one file and frame/node.'], figmaTools);
register('forgejo', 'Forgejo', 'forgejo-joyixir', 'oauth_or_app_token', 'https://forgejo.org/docs/latest/user/api/usage/',
  'Installed instance version and actual token permissions must be qualified; OAuth scope enforcement is not assumed.', ['Verify the registered instance API version.', 'Create a dedicated narrowly permissioned token with an explicit repository allowlist.'], forgejoTools);
register('hetzner', 'Hetzner Cloud', 'hetzner-api', 'project_token', 'https://docs.hetzner.cloud/reference/cloud',
  'Exact project/token access and selected server identity require qualification; privileged reboot remains independently gated.', ['Create a read-only project token for inventory.', 'Use a separately reviewed read/write credential for privileged actions.'], hetznerTools);
register('google_analytics', 'Google Analytics', 'google-analytics-api', 'oauth', 'https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport',
  'Property membership, analytics.readonly scope, quota and reporting metadata require account verification.', ['Authorize analytics.readonly.', 'Select the exact GA4 property and bounded report fields.'], googleAnalyticsTools);
register('posthog', 'PostHog', 'posthog-us', 'oauth_or_app_token', 'https://posthog.com/docs/api/insights',
  'Region/project/personal-key insight scope and saved insight response shape must be verified; CLI exec and raw query tools are disabled.', ['Select US or EU registered endpoint explicitly.', 'Create a scoped personal API key and select an aggregated saved insight.'], posthogTools);
register('gamend', 'Gamend', 'gamend-mcp', 'delegated_oauth', 'https://gamend.joyixir.com/.well-known/oauth-protected-resource/v1/mcp',
  'Serving-cell protocol/version, registered Vox OAuth client, current org/game/environment delegation and named operation availability require qualification.', ['Register the Vox client with Gamend.', 'Authorize a native delegated grant with exact org/game/environment and read operations.', 'Qualify MCP 2026-07-28 and native contracts.'], gamendTools, 'mcp');
register('browser', 'Browser reader', 'browser-isolated', 'worker_lease', 'https://playwright.dev/docs/docker',
  'Dedicated worker image, broker-only one-operation authorization and reviewed public page inventory require separate admission. Authenticated and interactive browser work remains unavailable.', ['Register exact public HTTPS pages server-side.', 'Admit the immutable offline Chromium sandbox and live epoch policy.'], browserTools, 'browser_worker');
register('ssh', 'Server diagnostics', 'ssh-isolated', 'worker_lease', 'https://man.openbsd.org/ssh',
  'Dedicated worker identity, independently verified host keys, fixed host/service inventory and forced-command remote user require separate admission. Privileged changes remain unavailable.', ['Independently verify each host key and pinned IP.', 'Install the unprivileged forced-command runbook and register exact service IDs.', 'Admit the isolated worker and broker lease channel.'], sshTools, 'ssh_worker');
// Definitions are application-owned. Callers receive read-only metadata; no provider tool discovery mutates this list.
export const providerDefinitions: readonly ProviderDefinition[] = Object.freeze(definitions.map(provider => Object.freeze({ ...provider, setup: Object.freeze(provider.setup), tools: Object.freeze([...provider.tools]) })));
export const providerToolDefinitions: readonly ProviderToolDefinition[] = Object.freeze(providerDefinitions.flatMap(provider => provider.tools));
export const getProviderDefinition = (id: string): ProviderDefinition | undefined => providerDefinitions.find(provider => provider.id === id);
export const getProviderToolDefinition = (id: string): ProviderToolDefinition | undefined => providerToolDefinitions.find(tool => tool.id === id);
