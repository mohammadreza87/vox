/**
 * S12 image seam fences (fixer r1 on main): the turn's authority is re-checked
 * after the download and handed to the decider, as text triage does since
 * 8a7dc55; each download carries a deadline. Fake providers only; no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DecisionService } from '../../adaptive/decisions';
import { ServiceDecider } from '../decisions/service-decider';
import { ingestTelegramImage, type ImageIngestDeps } from '../images';
import type { TelegramBotClient } from '../telegram/client';
import type { DeciderAuthority } from '../triage';
import type { ChatContext } from '../types';
import { scriptedProvider } from './decisions-fixtures';
import { TG, testOrg } from './fixtures';
import { imageAnswers, imageBot, photoLadder, privatePhoto, scriptedDecider, VisionFakeLLM } from './images-fixtures';

const org = testOrg();
const persona = org.getPersona('aria')!;
const rezaChat: ChatContext = { kind: 'private', chatKey: 'private-reza', personId: 'reza' };

beforeEach(() => { vi.stubEnv('STUDIO_IMAGES', '1'); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function setup(decider: ImageIngestDeps['decider'], authority?: DeciderAuthority) {
  const ladder = photoLadder();
  const bot = imageBot(ladder.files);
  const warn = vi.fn();
  const deps: ImageIngestDeps = {
    org, decider, llm: new VisionFakeLLM('claude-fable-5-1'), fastLlm: new VisionFakeLLM(),
    bot: bot as unknown as TelegramBotClient, log: { warn }, ...(authority ? { authority } : {}),
  };
  const message = privatePhoto(TG.reza, ladder.sizes, 'what is this?').message!;
  return { deps, bot, warn, message };
}

describe('image seam authority', () => {
  it('drops the image, with no acknowledgement and no decider call, when the authority was withdrawn during the download', async () => {
    const decider = scriptedDecider({ image: imageAnswers() });
    const { deps, bot, warn, message } = setup(decider, { authorize: async () => null });
    expect(await ingestTelegramImage(deps, persona, rezaChat, 'reza', message, 'what is this?')).toBeNull();
    expect(bot.downloadImage).toHaveBeenCalledTimes(1);
    expect(decider.decideParts).not.toHaveBeenCalled();
    expect(bot.sendMessage).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('tireh_image:authority_changed');
  });

  it('a synchronous authorizeNow that fails drops the image as well', async () => {
    const decider = scriptedDecider({ image: imageAnswers() });
    const { deps, message } = setup(decider, { authorize: async () => 'k', authorizeNow: () => false });
    expect(await ingestTelegramImage(deps, persona, rezaChat, 'reza', message, 'what is this?')).toBeNull();
    expect(decider.decideParts).not.toHaveBeenCalled();
  });

  it('hands the same authority to decideParts', async () => {
    const decider = scriptedDecider({ image: imageAnswers() });
    const authority: DeciderAuthority = { authorize: async () => 'turn-key' };
    const { deps, message } = setup(decider, authority);
    expect(await ingestTelegramImage(deps, persona, rezaChat, 'reza', message, 'what is this?')).not.toBeNull();
    expect(decider.decideParts!.mock.calls[0][3]).toBe(authority);
  });

  it('an authority withdrawn after the post-download check stops the export at the guarded transport (triage null)', async () => {
    const { provider } = scriptedProvider();
    let calls = 0;
    const authority: DeciderAuthority = { authorize: async () => (calls++ === 0 ? 'turn-key' : null) };
    const { deps, message } = setup(new ServiceDecider(new DecisionService(provider)), authority);
    const turn = await ingestTelegramImage(deps, persona, rezaChat, 'reza', message, 'what is this?');
    expect(calls).toBeGreaterThan(1);
    expect(provider.evaluate).not.toHaveBeenCalled();
    expect(turn?.triage).toBeNull();
    expect(turn?.suppressMemory).toBe(true);
  });
});

describe('image download deadline', () => {
  it('a download that hits its deadline is logged as download_timeout and the image is dropped', async () => {
    const { deps, bot, warn, message } = setup(scriptedDecider({ image: imageAnswers() }));
    bot.downloadImage.mockImplementation(async () => { throw new DOMException('The operation timed out.', 'TimeoutError'); });
    expect(await ingestTelegramImage(deps, persona, rezaChat, 'reza', message, 'what is this?')).toBeNull();
    expect(warn).toHaveBeenCalledWith('tireh_image:download_timeout');
  });
});
