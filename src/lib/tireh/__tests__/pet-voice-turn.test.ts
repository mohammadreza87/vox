/**
 * The pet's voice-mode fix (design PET_CARE_GAME_DESIGN_2026_10_26 §8A.1): a spoken pet turn tells the model the person
 * spoke and is listening, in the per-turn frame and block only. Block A stays byte-identical and a typed pet turn keeps
 * every byte it had, in both prompt layouts (legacy and TIREH_CACHED_PROMPT).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PET_SURFACE_FRAME, PET_SURFACE_FRAME_VOICE } from '../gateway';
import { buildPromptLayout, buildSystemPrompt, personaBlock, SPOKEN_INPUT_LINE, type PromptInput } from '../conversation/prompt';
import { fakeVoice, makeGateway, testOrg } from './fixtures';
import type { SystemBlock } from '../llm-content';

afterEach(() => { vi.unstubAllEnvs(); });

const VOICE_SENTENCE = 'The person said this out loud and is listening for your reply; answer as speech.';
const VOICE_REPLY_LINE = 'A voice reply is requested for this turn.';
const TEXT_REPLY_LINE = 'For this turn, reply in text only;';
const blockA = (system: unknown) => (system as SystemBlock[])[0].text;

describe('the prompt builders', () => {
  const org = testOrg();
  const persona = org.getPersona('aria')!;
  const base: PromptInput = { org, persona, chat: { kind: 'private', chatKey: 'private-reza', personId: 'reza' }, speakerId: 'reza', memories: [],
    now: new Date('2026-10-26T10:00:00Z'), canSpeak: true };

  it('a typed turn is byte-identical with inputModality text or unset', () => {
    expect(buildSystemPrompt({ ...base, inputModality: 'text' })).toBe(buildSystemPrompt(base));
    expect(buildSystemPrompt({ ...base, space: 'personal', inputModality: 'text' })).toBe(buildSystemPrompt({ ...base, space: 'personal' }));
    expect(buildPromptLayout({ ...base, inputModality: 'text', extraFrame: PET_SURFACE_FRAME })).toEqual(buildPromptLayout({ ...base, extraFrame: PET_SURFACE_FRAME }));
    expect(buildSystemPrompt(base)).not.toContain(SPOKEN_INPUT_LINE);
  });

  it('a spoken turn adds one line to the per-turn block and never touches block A', () => {
    const typed = buildPromptLayout({ ...base, extraFrame: PET_SURFACE_FRAME });
    const spoken = buildPromptLayout({ ...base, replyFormat: 'voice', inputModality: 'voice', extraFrame: PET_SURFACE_FRAME_VOICE });
    expect(spoken.system[0].text).toBe(typed.system[0].text);
    expect(spoken.system[0].text).toBe(personaBlock(persona, 'HOOR', 'work', false));
    expect(spoken.system[0].text).not.toContain(SPOKEN_INPUT_LINE);
    expect(spoken.system[0].text).not.toContain(VOICE_SENTENCE);
    expect(spoken.turn).toContain(`Today is 2026-10-26.\n${SPOKEN_INPUT_LINE}\n${VOICE_REPLY_LINE}`);
    expect(spoken.system.at(-1)!.text).toContain(PET_SURFACE_FRAME_VOICE);
    const legacy = buildSystemPrompt({ ...base, inputModality: 'voice' });
    expect(legacy).toContain(`## This turn\nToday is 2026-10-26.\n${SPOKEN_INPUT_LINE}`);
    expect(buildSystemPrompt({ ...base, space: 'personal', inputModality: 'voice' })).toContain(`Today is 2026-10-26.\n${SPOKEN_INPUT_LINE}`);
  });
});

describe('gateway.converse on the pet surface', () => {
  for (const cached of [false, true]) {
    describe(cached ? 'TIREH_CACHED_PROMPT=1' : 'legacy prompt', () => {
      const prompt = async (options: Parameters<ReturnType<typeof makeGateway>['gateway']['converse']>[3]) => {
        if (cached) vi.stubEnv('TIREH_CACHED_PROMPT', '1');
        const { gateway, llm } = makeGateway({ voice: fakeVoice() });
        await gateway.converse('aria', 'reza', 'are you sleepy?', options);
        return { text: llm.lastPrompt, request: llm.replyRequests.at(-1)! };
      };

      it('a typed pet turn is unchanged byte for byte', async () => {
        const typed = await prompt({ surface: 'pet' });
        expect((await prompt({ surface: 'pet', replyFormat: undefined, inputModality: undefined })).text).toBe(typed.text);
        expect((await prompt({ surface: 'pet', inputModality: 'text' })).text).toBe(typed.text);
        expect(typed.text).toContain(PET_SURFACE_FRAME);
        for (const line of [VOICE_SENTENCE, SPOKEN_INPUT_LINE, VOICE_REPLY_LINE, TEXT_REPLY_LINE]) expect(typed.text).not.toContain(line);
      });

      it('a spoken pet turn says the person spoke and is listening, and asks for a voice reply', async () => {
        const spoken = await prompt({ surface: 'pet', replyFormat: 'voice', inputModality: 'voice' });
        expect(spoken.text).toContain(PET_SURFACE_FRAME_VOICE);
        expect(spoken.text).toContain(SPOKEN_INPUT_LINE);
        expect(spoken.text).toContain(VOICE_REPLY_LINE);
        // an agent without its own voice: heard aloud, answered in text
        const heard = await prompt({ surface: 'pet', replyFormat: 'text', inputModality: 'voice' });
        expect(heard.text).toContain(SPOKEN_INPUT_LINE);
        expect(heard.text).toContain(TEXT_REPLY_LINE);
        expect(heard.text).not.toContain(VOICE_REPLY_LINE);
        if (cached) {
          const typed = await prompt({ surface: 'pet' });
          expect(blockA(spoken.request.system)).toBe(blockA(typed.request.system));
          expect(blockA(spoken.request.system)).not.toContain(SPOKEN_INPUT_LINE);
          expect(blockA(spoken.request.system)).not.toContain(VOICE_SENTENCE);
        }
      });

      it('outside the pet surface, a spoken turn adds only the per-turn line', async () => {
        const call = await prompt({ inputModality: 'voice' });
        expect(call.text).toContain(SPOKEN_INPUT_LINE);
        expect(call.text).not.toContain(PET_SURFACE_FRAME);
      });
    });
  }
});
