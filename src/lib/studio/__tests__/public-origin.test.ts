import { afterEach, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { makeStudio, seedOrg, ID } from './helpers';
import { signInitData } from '../auth';
import { handleConversationRequest } from '../conversation';
import { handleProductPauseRequest } from '../product-pause-http';
import { handleRightsRequest } from '../rights-http';
import { handleLearningRequest } from '../learning-http';
import { handleExperimentExposure } from '../experiments-http';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { AdaptiveRepository } from '../../adaptive/persistence/repository';
import { MemoryAdaptiveStorage } from '../../adaptive/runtime/storage';
import { rightsFixture } from '../../adaptive/rights-intake/fixtures';
import type { Studio } from '../service';

const token = '123:synthetic-public-origin';
const publicOrigin = 'https://studio.synthetic';
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

const surfaces: Array<[string, (studio: Studio, request: Request) => Promise<Response>]> = [
  ['conversation', (s, r) => handleConversationRequest(s, r, token)],
  ['product-pause', (s, r) => handleProductPauseRequest(s, r, token)],
  ['rights', (s, r) => handleRightsRequest(s, r, ['requests'], token)],
  ['learning', (s, r) => handleLearningRequest(s, r, ['correction-authority'], token)],
  ['experiments', (s, r) => handleExperimentExposure(s, r, token)],
];
const cases: Array<[string, string | undefined, string, string | undefined, number, string]> = [
  ['configured public origin', publicOrigin, 'same-origin', `${publicOrigin}/studio`, 415, 'json_required'],
  ['missing origin', undefined, 'same-origin', `${publicOrigin}/studio`, 403, 'origin_denied'],
  ['opaque origin', 'null', 'same-origin', `${publicOrigin}/studio`, 403, 'origin_denied'],
  ['hostile origin with spoofed forwarded host', 'https://attacker.synthetic', 'same-origin', `${publicOrigin}/studio`, 403, 'origin_denied'],
  ['internal origin cannot override configured public authority', 'http://localhost:3107', 'same-origin', `${publicOrigin}/studio`, 403, 'origin_denied'],
  ['cross-site header denies matching public origin', publicOrigin, 'cross-site', `${publicOrigin}/studio`, 403, 'origin_denied'],
  ['invalid supplied server configuration', publicOrigin, 'same-origin', `${publicOrigin}/other`, 503, 'origin_unavailable'],
  ['explicit empty server configuration', 'http://localhost:3107', 'same-origin', '', 503, 'origin_unavailable'],
  ['unconfigured direct-server compatibility', 'http://localhost:3107', 'same-origin', undefined, 415, 'json_required'],
];

describe.each(surfaces)('%s trusted public origin behind an internal request URL', (_surface, handle) => {
  it.each(cases)('%s', async (_label, origin, fetchSite, configured, status, error) => {
    const h = makeStudio();
    cleanup.push(() => rm(h.dir, { recursive: true, force: true }));
    await seedOrg(h);
    h.studio.deps.webAppUrl = configured;
    h.studio.deps.adaptive = new AdaptiveService(new AdaptiveRepository(new MemoryAdaptiveStorage()));
    const rights = await rightsFixture();
    cleanup.push(rights.close);
    h.studio.deps.rights = rights.service;
    const sentBefore = h.manager.sendMessage.mock.calls.length;
    const request = new Request('http://localhost:3107/api/studio/synthetic', {
      method: 'POST',
      headers: {
        ...(origin === undefined ? {} : { origin }),
        'sec-fetch-site': fetchSite,
        'content-type': 'text/plain',
        host: 'attacker.synthetic',
        'x-forwarded-host': 'studio.synthetic',
        'x-forwarded-proto': 'https',
        'x-telegram-init-data': signInitData({ id: ID.alice, first_name: 'Synthetic' }, token),
      },
      body: '{}',
    });
    const response = await handle(h.studio, request);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
    // Valid origins reach content-type validation; no body processing or provider work is allowed.
    expect(h.chatLLM.replyRequests).toHaveLength(0);
    expect(h.personaLLM.requests).toHaveLength(0);
    expect(h.manager.sendMessage).toHaveBeenCalledTimes(sentBefore);
  });
});
