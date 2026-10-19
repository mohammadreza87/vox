/**
 * End-to-end scenarios for the main use case:
 *
 *   Aria (Product Lead) is ONE persona for everyone. Reza and Parastoo each
 *   build private memories with her, she knows how people relate, she builds
 *   shared memory with groups and projects, and nothing leaks between them.
 */
import { describe, it, expect } from 'vitest';
import {
  callback,
  fakeVoice,
  GAMEEND_CHAT,
  groupText,
  LEADS_CHAT,
  makeGateway,
  privateText,
  privateVoice,
  TG,
} from './fixtures';

function extraction(...memories: Array<Record<string, unknown>>) {
  return { memories };
}

describe('Aria: one persona, shared by everyone', () => {
  it('is the same Aria (identity, personality, voice) for Reza and for Parastoo', async () => {
    const { gateway, llm } = makeGateway();
    await gateway.handleUpdate('aria', privateText(TG.reza, 'Hi Aria'));
    await gateway.handleUpdate('aria', privateText(TG.parastoo, 'Hi Aria'));

    const [toReza, toParastoo] = llm.replyPrompts;
    for (const prompt of [toReza, toParastoo]) {
      expect(prompt).toContain('You are Aria, Product Lead at HOOR');
      expect(prompt).toContain('the same Aria, with the same personality and voice, for everyone');
      expect(prompt).toContain('Personality: Analytical and warm');
    }
    expect(toReza).toContain('Private chat with Reza');
    expect(toParastoo).toContain('Private chat with Parastoo');
  });

  it('knows who each person is and how they relate to others', async () => {
    const { gateway, llm } = makeGateway();
    await gateway.handleUpdate('aria', privateText(TG.parastoo, 'How is my team doing?'));
    const prompt = llm.lastPrompt;
    expect(prompt).toContain('About them: Parastoo — Executive; reports to Reza; manages Milad; works on GameEnd');
    expect(prompt).toContain('Milad reports to Parastoo');
    expect(prompt).toContain('Parastoo and Reza: long-time collaborators');
  });
});

describe('private relationship memory', () => {
  it('Reza and Aria build memories together that Parastoo cannot see', async () => {
    const { gateway, llm, memories } = makeGateway();

    llm.nextExtraction = extraction({
      content: 'Reza is worried GameEnd onboarding is too long',
      type: 'fact',
      kind: 'work',
      about: ['reza'],
      topic: 'gameend onboarding',
      projectId: null,
    });
    await gateway.handleUpdate('aria', privateText(TG.reza, 'I think GameEnd onboarding is too long'));

    const stored = [...memories.records.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0].scope).toEqual({ kind: 'private', personId: 'reza' });
    expect(stored[0].source.personId).toBe('reza');

    // Reza comes back: Aria remembers
    await gateway.handleUpdate('aria', privateText(TG.reza, 'What do you think about onboarding now?'));
    expect(llm.lastPrompt).toContain('Reza is worried GameEnd onboarding is too long (Reza, privately');

    // Parastoo asks the same: nothing leaks
    await gateway.handleUpdate('aria', privateText(TG.parastoo, 'What does Reza think about onboarding?'));
    expect(llm.lastPrompt).not.toContain('worried GameEnd onboarding');
    expect(llm.lastPrompt).toContain("Never reveal, hint at, or confirm anything someone told you in another conversation");
  });

  it('Parastoo builds her own separate memories with the same Aria', async () => {
    const { gateway, llm, memories } = makeGateway();
    llm.nextExtraction = extraction({
      content: 'Parastoo wants sprint reviews on Thursdays',
      type: 'preference',
      kind: 'work',
      about: ['parastoo'],
      topic: 'sprint review day',
    });
    await gateway.handleUpdate('aria', privateText(TG.parastoo, 'Can we do sprint reviews on Thursdays?'));
    expect([...memories.records.values()][0].scope).toEqual({ kind: 'private', personId: 'parastoo' });

    await gateway.handleUpdate('aria', privateText(TG.parastoo, 'Remind me what we agreed'));
    expect(llm.lastPrompt).toContain('Parastoo wants sprint reviews on Thursdays');

    await gateway.handleUpdate('aria', privateText(TG.reza, 'Remind me what we agreed'));
    expect(llm.lastPrompt).not.toContain('sprint reviews on Thursdays');
  });

  it('personal things stay personal even inside the owner\'s groups', async () => {
    const { gateway, llm } = makeGateway();
    llm.nextExtraction = extraction({ content: "Reza's father is in hospital", type: 'fact', kind: 'personal', about: ['reza'] });
    await gateway.handleUpdate('aria', privateText(TG.reza, 'My dad is in hospital, I might be slow this week'));

    await gateway.handleUpdate('aria', groupText(LEADS_CHAT, TG.reza, 'Aria, what should we focus on this week?'));
    expect(llm.lastPrompt).not.toContain('hospital');

    await gateway.handleUpdate('aria', privateText(TG.reza, 'thanks for understanding'));
    expect(llm.lastPrompt).toContain("Reza's father is in hospital");
  });

  it('the same person updating a topic replaces their older memory', async () => {
    const { gateway, llm, memories } = makeGateway();
    llm.nextExtraction = extraction({ content: 'Reza wants dark mode first', type: 'preference', kind: 'work', topic: 'top priority' });
    await gateway.handleUpdate('aria', privateText(TG.reza, 'dark mode first'));
    llm.nextExtraction = extraction({ content: 'Reza wants offline mode first', type: 'preference', kind: 'work', topic: 'Top Priority' });
    await gateway.handleUpdate('aria', privateText(TG.reza, 'actually offline mode first'));

    const active = await memories.listActive('aria');
    expect(active.map((m) => m.content)).toEqual(['Reza wants offline mode first']);
    const old = [...memories.records.values()].find((m) => m.content === 'Reza wants dark mode first')!;
    expect(old.supersededBy).toBe(active[0].id);
    expect(active[0].supersedes).toBe(old.id);
  });
});

describe('sharing private work memories', () => {
  async function rezaTellsLaunchDate() {
    const ctx = makeGateway();
    ctx.llm.nextExtraction = extraction({
      content: 'GameEnd launch moves to March 5',
      type: 'decision',
      kind: 'work',
      topic: 'gameend launch date',
      projectId: 'gameend',
    });
    await ctx.gateway.handleUpdate('aria', privateText(TG.reza, "Let's move the GameEnd launch to March 5"));
    const offerMessage = ctx.bot.sent.find((s) => s.text?.includes('Should I share this'))!;
    const keyboard = (offerMessage.options as { keyboard: { inline_keyboard: Array<Array<{ callback_data: string }>> } }).keyboard;
    const [shareButton, keepButton] = keyboard.inline_keyboard[0];
    return { ...ctx, offerMessage, shareData: shareButton.callback_data, keepData: keepButton.callback_data };
  }

  it('asks before sharing, and keeps it private until approved', async () => {
    const { offerMessage, llm, gateway } = await rezaTellsLaunchDate();
    expect(offerMessage.chatId).toBe(TG.reza);
    expect(offerMessage.text).toContain('Should I share this with the GameEnd project?');

    await gateway.handleUpdate('aria', privateText(TG.parastoo, 'When is the GameEnd launch?'));
    expect(llm.lastPrompt).not.toContain('March 5');
  });

  it('after Reza approves, Parastoo and the GameEnd group see it with provenance', async () => {
    const { gateway, llm, shareData, bot } = await rezaTellsLaunchDate();
    await gateway.handleUpdate('aria', callback(TG.reza, shareData));
    expect(bot.sent.some((s) => s.method === 'answerCallbackQuery' && s.text === 'Shared with GameEnd project.')).toBe(true);

    await gateway.handleUpdate('aria', privateText(TG.parastoo, 'When is the GameEnd launch?'));
    expect(llm.lastPrompt).toContain('GameEnd launch moves to March 5 (Reza, privately, 2026-10-19; shared with: GameEnd project)');

    await gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, '@hoor_aria_bot launch date?'));
    expect(llm.lastPrompt).toContain('GameEnd launch moves to March 5');
  });

  it('only the person who said it can approve sharing', async () => {
    const { gateway, llm, shareData, bot } = await rezaTellsLaunchDate();
    await gateway.handleUpdate('aria', callback(TG.parastoo, shareData));
    expect(bot.sent.some((s) => s.text === 'Only the person who told me can decide this.')).toBe(true);

    await gateway.handleUpdate('aria', privateText(TG.parastoo, 'When is the GameEnd launch?'));
    expect(llm.lastPrompt).not.toContain('March 5');
  });

  it('"Keep private" keeps it private, and a decision cannot be replayed', async () => {
    const { gateway, llm, keepData, shareData, bot } = await rezaTellsLaunchDate();
    await gateway.handleUpdate('aria', callback(TG.reza, keepData));
    await gateway.handleUpdate('aria', callback(TG.reza, shareData));
    expect(bot.sent.some((s) => s.text === 'Already decided.')).toBe(true);

    await gateway.handleUpdate('aria', privateText(TG.parastoo, 'When is the GameEnd launch?'));
    expect(llm.lastPrompt).not.toContain('March 5');
  });

  it('expired or forged callbacks are rejected', async () => {
    const { gateway, bot } = makeGateway();
    await gateway.handleUpdate('aria', callback(TG.reza, 'share:does-not-exist'));
    await gateway.handleUpdate('aria', callback(TG.reza, 'delete:everything'));
    expect(bot.sent.filter((s) => s.text === 'This request has expired.')).toHaveLength(2);
  });
});

describe('shared group memory', () => {
  it('decisions in the GameEnd group become GameEnd project memory for every member', async () => {
    const { gateway, llm, memories } = makeGateway();
    llm.nextExtraction = extraction({
      content: 'The GameEnd team decided to cut the tutorial to 3 steps',
      type: 'decision',
      kind: 'work',
      topic: 'tutorial length',
    });
    await gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.parastoo, 'Aria, we agreed: tutorial is 3 steps max'));
    const [stored] = [...memories.records.values()];
    expect(stored.scope).toEqual({ kind: 'project', projectId: 'gameend' });
    expect(stored.source).toMatchObject({ personId: 'parastoo', chatKind: 'group', groupId: 'gameend-team' });

    // Milad later asks privately: he's a GameEnd member, so Aria can tell him
    await gateway.handleUpdate('aria', privateText(TG.milad, 'How long should the tutorial be?'));
    expect(llm.lastPrompt).toContain('cut the tutorial to 3 steps (Parastoo, in GameEnd Team');

    // Sina is not on GameEnd
    await gateway.handleUpdate('aria', privateText(TG.sina, 'How long should the tutorial be?'));
    expect(llm.lastPrompt).not.toContain('tutorial to 3 steps');
  });

  it('in a group, Aria only uses memories that ALL members may see', async () => {
    const { gateway, llm } = makeGateway();
    // Leads-group memory (Reza + Parastoo only)
    llm.nextExtraction = extraction({ content: 'Leads think the budget is tight', type: 'fact', kind: 'work', topic: 'budget' });
    await gateway.handleUpdate('aria', groupText(LEADS_CHAT, TG.parastoo, 'Aria, note that budget is tight'));

    // In the GameEnd group Milad is present → the Leads memory must not appear
    await gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, 'Aria, can we hire?'));
    expect(llm.lastPrompt).not.toContain('budget is tight');

    // Back in Leads it's fine
    await gateway.handleUpdate('aria', groupText(LEADS_CHAT, TG.reza, 'Aria, can we hire?'));
    expect(llm.lastPrompt).toContain('Leads think the budget is tight');
  });

  it('listens to the group but only speaks when addressed', async () => {
    const { gateway, llm, bot, history } = makeGateway();
    const result = await gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, 'I pushed the new build'));
    expect(result).toBe('ignored');
    expect(bot.sendMessage).not.toHaveBeenCalled();
    expect(llm.extractionCalls).toBe(0);

    await gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.parastoo, 'Aria, did you see what Milad said?'));
    const lastRequest = llm.replyRequests[llm.replyRequests.length - 1];
    expect(lastRequest.messages.map((m) => m.content)).toEqual([
      'Milad: I pushed the new build',
      'Parastoo: Aria, did you see what Milad said?',
    ]);
    expect((await history.recent('aria', 'group-gameend-team', 10)).at(-1)?.role).toBe('assistant');
  });

  it('answers @mentions and replies to her own messages, but not other words containing her name', async () => {
    const { gateway, bot } = makeGateway();
    expect(await gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, '@hoor_aria_bot thoughts?'))).toBe('replied');
    expect(
      await gateway.handleUpdate(
        'aria',
        groupText(GAMEEND_CHAT, TG.milad, 'and this?', {
          reply_to_message: { message_id: 1, chat: { id: GAMEEND_CHAT, type: 'supergroup' }, date: 0, from: { id: 42, is_bot: true, first_name: 'Aria', username: 'hoor_aria_bot' } },
        })
      )
    ).toBe('replied');
    expect(await gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, 'Ariana Grande is touring'))).toBe('ignored');
    expect(bot.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('surfaces conflicting information from different people instead of picking one', async () => {
    const { gateway, llm } = makeGateway();
    llm.nextExtraction = extraction({ content: 'GameEnd launch is Feb 20', type: 'decision', kind: 'work', topic: 'gameend launch date' });
    await gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.parastoo, 'Aria, launch is Feb 20'));
    llm.nextExtraction = extraction({ content: 'GameEnd launch is March 5', type: 'decision', kind: 'work', topic: 'gameend launch date' });
    await gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, 'Aria, launch is March 5'));

    await gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, 'Aria, when do we launch?'));
    expect(llm.lastPrompt).toContain('## Conflicting information');
    expect(llm.lastPrompt).toMatch(/"GameEnd launch is (Feb 20|March 5)" \((Parastoo|Reza), 2026-10-19\) vs/);
  });
});

describe('access control', () => {
  it('strangers get a polite refusal and nothing is stored', async () => {
    const { gateway, bot, memories, llm } = makeGateway();
    expect(await gateway.handleUpdate('aria', privateText(TG.stranger, 'hi'))).toBe('stranger');
    expect(bot.sent[0].text).toContain('I only work with members of HOOR');
    expect(llm.replyPrompts).toHaveLength(0);
    expect(memories.records.size).toBe(0);
  });

  it('refuses unregistered groups when addressed, silently otherwise', async () => {
    const { gateway, bot } = makeGateway();
    expect(await gateway.handleUpdate('aria', groupText(-1, TG.reza, 'hello all'))).toBe('unregistered-group');
    expect(bot.sendMessage).not.toHaveBeenCalled();
    await gateway.handleUpdate('aria', groupText(-1, TG.reza, 'Aria are you here?'));
    expect(bot.sent[0].text).toContain("isn't registered");
  });

  it('stays out of a registered group when a non-member speaks (config out of date)', async () => {
    const { gateway, bot, logger } = makeGateway();
    expect(await gateway.handleUpdate('aria', groupText(LEADS_CHAT, TG.milad, 'Aria, what is the budget?'))).toBe('ignored');
    expect(bot.sendMessage).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('ignores messages from other bots and unknown personas', async () => {
    const { gateway } = makeGateway();
    const update = privateText(TG.reza, 'hi');
    update.message!.from!.is_bot = true;
    expect(await gateway.handleUpdate('aria', update)).toBe('ignored');
    expect(await gateway.handleUpdate('nobody', privateText(TG.reza, 'hi'))).toBe('unknown-persona');
  });

  it('processes each Telegram update once (webhook retries)', async () => {
    const { gateway, bot } = makeGateway();
    const update = privateText(TG.reza, 'hi');
    expect(await gateway.handleUpdate('aria', update)).toBe('replied');
    expect(await gateway.handleUpdate('aria', update)).toBe('duplicate');
    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe('voice', () => {
  it('voice in → transcribed → reply spoken in Aria\'s voice plus a transcript', async () => {
    const voice = fakeVoice('What is our top priority?');
    const { gateway, bot, llm } = makeGateway({ voice });
    expect(await gateway.handleUpdate('aria', privateVoice(TG.reza))).toBe('replied');

    expect(bot.downloadFile).toHaveBeenCalledWith('file-1');
    expect(llm.replyRequests[0].messages.at(-1)?.content).toBe('What is our top priority?');
    expect(voice.synthesize).toHaveBeenCalledWith('Sure.', 'voice-aria');
    expect(bot.sent.map((s) => s.method)).toEqual(['sendVoice', 'sendMessage']);
  });

  it('text in → text out when replyWithVoice is "mirror"', async () => {
    const voice = fakeVoice();
    const { gateway, bot } = makeGateway({ voice });
    await gateway.handleUpdate('aria', privateText(TG.reza, 'hello'));
    expect(voice.synthesize).not.toHaveBeenCalled();
    expect(bot.sent.map((s) => s.method)).toEqual(['sendMessage']);
  });

  it('falls back to text if speech synthesis fails', async () => {
    const voice = fakeVoice('hello');
    voice.synthesize.mockRejectedValueOnce(new Error('quota'));
    const { gateway, bot } = makeGateway({ voice });
    await gateway.handleUpdate('aria', privateVoice(TG.reza));
    expect(bot.sent.map((s) => s.method)).toEqual(['sendMessage']);
  });

  it('says so when a voice note cannot be understood', async () => {
    const { gateway, bot, llm } = makeGateway({ voice: fakeVoice('') });
    await gateway.handleUpdate('aria', privateVoice(TG.reza));
    expect(bot.sent[0].text).toContain("couldn't make out");
    expect(llm.replyPrompts).toHaveLength(0);
  });
});

describe('commands', () => {
  it('/memories shows only what the asker can see, with sources', async () => {
    const { gateway, llm, bot } = makeGateway();
    llm.nextExtraction = extraction({ content: 'Reza likes weekly demos', type: 'preference', kind: 'work' });
    await gateway.handleUpdate('aria', privateText(TG.reza, 'I like weekly demos'));
    llm.nextExtraction = extraction({ content: 'The GameEnd team ships every Friday', type: 'decision', kind: 'work' });
    await gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.parastoo, 'Aria: we ship every Friday'));

    await gateway.handleUpdate('aria', privateText(TG.milad, '/memories'));
    const miladView = bot.sent.at(-1)!.text!;
    expect(miladView).toContain('The GameEnd team ships every Friday [GameEnd project — from Parastoo]');
    expect(miladView).not.toContain('weekly demos');

    await gateway.handleUpdate('aria', privateText(TG.reza, '/memories'));
    expect(bot.sent.at(-1)!.text).toContain('1. Reza likes weekly demos [private with Reza]');
  });

  it('/memories refuses to list in a group', async () => {
    const { gateway, bot } = makeGateway();
    await gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, '/memories@hoor_aria_bot'));
    expect(bot.sent[0].text).toContain('private chat');
  });

  it('/forget deletes only memories you are the source of', async () => {
    const { gateway, llm, bot, memories } = makeGateway();
    llm.nextExtraction = extraction({ content: 'The GameEnd team ships every Friday', type: 'decision', kind: 'work' });
    await gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.parastoo, 'Aria: we ship every Friday'));
    llm.nextExtraction = extraction({ content: 'Milad prefers async standups', type: 'preference', kind: 'work' });
    await gateway.handleUpdate('aria', privateText(TG.milad, 'I prefer async standups'));

    await gateway.handleUpdate('aria', privateText(TG.milad, '/forget 1'));
    expect(bot.sent.at(-1)!.text).toBe('Only Parastoo can delete that one.');
    await gateway.handleUpdate('aria', privateText(TG.milad, '/forget 2'));
    expect(bot.sent.at(-1)!.text).toBe('Forgotten: "Milad prefers async standups"');
    expect((await memories.listActive('aria')).map((m) => m.content)).toEqual(['The GameEnd team ships every Friday']);
  });

  it('/whoami describes how Aria knows you', async () => {
    const { gateway, bot } = makeGateway();
    await gateway.handleUpdate('aria', privateText(TG.milad, '/whoami'));
    expect(bot.sent[0].text).toBe('Milad — Team member; reports to Parastoo; works on GameEnd');
  });
});

describe('resilience', () => {
  it('a failed memory extraction does not break the reply', async () => {
    const { gateway, llm, bot, logger } = makeGateway();
    llm.nextExtraction = 'total garbage';
    expect(await gateway.handleUpdate('aria', privateText(TG.reza, 'hi'))).toBe('replied');
    expect(bot.sendMessage).toHaveBeenCalledTimes(1);

    const original = llm.complete.bind(llm);
    llm.complete = async (req) => {
      if (req.system.startsWith('You extract')) throw new Error('model down');
      return original(req);
    };
    expect(await gateway.handleUpdate('aria', privateText(TG.reza, 'hi again'))).toBe('replied');
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('memory formation quality', () => {
  it('marks only messages since the last reply as new, so old facts are not re-extracted', async () => {
    const { gateway, llm } = makeGateway();
    await gateway.handleUpdate('aria', privateText(TG.reza, 'first message'));
    await gateway.handleUpdate('aria', privateText(TG.reza, 'second message'));
    const transcript = llm.extractionRequests[1].messages[0].content;
    expect(transcript).toContain('[context] Reza (id: reza): first message');
    expect(transcript).toContain('[new] Reza (id: reza): second message');
    expect(transcript).toContain('[new] Aria: Sure.');
  });

  it('shows the extractor what Aria already knows, but only what this audience may see', async () => {
    const { gateway, llm } = makeGateway();
    llm.nextExtraction = extraction({ content: 'Reza has a secret plan for Q3', type: 'fact', kind: 'work', topic: 'q3 plan' });
    await gateway.handleUpdate('aria', privateText(TG.reza, 'secret plan'));

    await gateway.handleUpdate('aria', privateText(TG.reza, 'more on Q3 plan'));
    expect(llm.extractionRequests[1].system).toContain('[topic: q3 plan] Reza has a secret plan for Q3');

    await gateway.handleUpdate('aria', privateText(TG.parastoo, 'Q3 plan?'));
    expect(llm.extractionRequests[2].system).not.toContain('secret plan');
  });

  it('does not store the same memory twice', async () => {
    const { gateway, llm, memories } = makeGateway();
    const same = { content: 'Reza likes weekly demos', type: 'preference', kind: 'work' };
    llm.nextExtraction = extraction(same);
    await gateway.handleUpdate('aria', privateText(TG.reza, 'weekly demos please'));
    llm.nextExtraction = extraction(same);
    await gateway.handleUpdate('aria', privateText(TG.reza, 'as I said, weekly demos'));
    expect(memories.records.size).toBe(1);
  });

  it('credits the person who actually said it in a group', async () => {
    const { gateway, llm, memories } = makeGateway();
    await gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, 'Build 42 crashes on Android 12'));
    llm.nextExtraction = extraction({ content: 'Build 42 crashes on Android 12', type: 'fact', kind: 'work', saidBy: 'milad' });
    await gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.parastoo, 'Aria, note what Milad found'));
    const [stored] = [...memories.records.values()];
    expect(stored.source.personId).toBe('milad');
  });

  it('ignores a claimed speaker who did not speak in the new messages', async () => {
    const { gateway, llm, memories } = makeGateway();
    llm.nextExtraction = extraction({ content: 'Sina approved the budget', type: 'decision', kind: 'work', saidBy: 'sina' });
    await gateway.handleUpdate('aria', privateText(TG.reza, 'Sina approved the budget'));
    expect([...memories.records.values()][0].source.personId).toBe('reza');
  });

  it('handles approving a share for a memory that was deleted meanwhile', async () => {
    const { gateway, llm, bot, memories } = makeGateway();
    llm.nextExtraction = extraction({ content: 'GameEnd launch moves to March 5', type: 'decision', kind: 'work', projectId: 'gameend' });
    await gateway.handleUpdate('aria', privateText(TG.reza, 'launch March 5'));
    const offer = bot.sent.find((s) => s.text?.includes('Should I share'))!;
    const data = (offer.options as { keyboard: { inline_keyboard: Array<Array<{ callback_data: string }>> } }).keyboard.inline_keyboard[0][0].callback_data;
    await memories.delete([...memories.records.keys()][0]);
    await gateway.handleUpdate('aria', callback(TG.reza, data));
    expect(bot.sent.at(-1)?.text).toBe('That memory has since been changed or deleted.');
  });

  it('tells people when voice is not configured', async () => {
    const { gateway, bot } = makeGateway({ voice: null });
    await gateway.handleUpdate('aria', privateVoice(TG.reza));
    expect(bot.sent[0].text).toBe("I can't listen to voice messages yet. Could you type it?");
  });
});

