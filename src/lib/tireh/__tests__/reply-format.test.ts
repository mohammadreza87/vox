import { describe, expect, it } from 'vitest';
import { makeGateway, privateText, TG } from './fixtures';

describe('reply delivery format', () => {
  it('sends plain words to Telegram and keeps the same text in history', async () => {
    const { gateway, llm, bot, history } = makeGateway();
    llm.nextReply = '## Plan\n**Ship** the small fix first:\n- smoke-test purchases\n- staged rollout';
    expect(await gateway.handleUpdate('aria', privateText(TG.reza, 'can we ship friday?'))).toBe('replied');
    const sent = bot.sent.filter((s) => s.method === 'sendMessage').at(-1)!.text;
    expect(sent).toBe('Plan\nShip the small fix first:\nsmoke-test purchases\nstaged rollout');
    expect((await history.recent('aria', 'private-reza', 5)).at(-1)).toMatchObject({ role: 'assistant', text: sent });
  });

  it('asks chat replies for low effort with room for thinking', async () => {
    const { gateway, llm } = makeGateway();
    await gateway.handleUpdate('aria', privateText(TG.reza, 'hi'));
    expect(llm.replyRequests.at(-1)).toMatchObject({ effort: 'low', maxTokens: 2000 });
  });

  it.each([
    ['سلام، برنامه‌ی فردا چیه؟', 'ببخشید، یه لحظه رشته‌ی فکرم پاره شد. می‌شه دوباره بگید؟'],
    ['what is the plan tomorrow?', 'Sorry, I lost my train of thought. Could you say that again?'],
  ])('answers an empty model reply in the speaker’s language and logs it content-free (%s)', async (message, fallback) => {
    const { gateway, llm, bot, logger } = makeGateway();
    llm.nextReply = '';
    await gateway.handleUpdate('aria', privateText(TG.reza, message));
    expect(bot.sent.filter((s) => s.method === 'sendMessage').at(-1)!.text).toBe(fallback);
    expect(logger.warn).toHaveBeenCalledWith({ type: 'telegram_ingress', stage: 'reply_generation', reason: 'empty_output', outcome: 'fallback_reply' });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(message);
  });
});

describe('toPlainChat', () => {
  it('keeps maths, comparisons and fenced code exactly as written', async () => {
    const { toPlainChat } = await import('../conversation/format');
    expect(toPlainChat('a**2 + b**2 = c**2')).toBe('a**2 + b**2 = c**2');
    expect(toPlainChat('> 50% of users churn by D7')).toBe('> 50% of users churn by D7');
    expect(toPlainChat('Run this:\n```bash\n# install deps\nnpm ci\n- run: npm test\n```')).toBe('Run this:\n# install deps\nnpm ci\n- run: npm test');
    expect(toPlainChat('**Ship** it, then *watch* `crash_rate`')).toBe('Ship it, then watch crash_rate');
  });

  it('answers in Persian only for Persian script', async () => {
    const { emptyReplyFallback } = await import('../conversation/format');
    expect(emptyReplyFallback('برنامه‌ی فردا چیه؟')).toContain('ببخشید');
    expect(emptyReplyFallback('سلام')).toContain('ببخشید');
    expect(emptyReplyFallback('ما هي الخطة غدا')).toContain('Sorry');
  });
});
