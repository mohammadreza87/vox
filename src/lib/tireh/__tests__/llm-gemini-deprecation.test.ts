/** S15: TIREH_LLM_PROVIDER=gemini keeps working but logs one fixed deprecation warning. */
import { describe, expect, it, vi } from 'vitest';
import { AnthropicLLM, createLLMFromEnv, GEMINI_DEPRECATION_WARNING, GeminiLLM } from '../llm';

describe('createLLMFromEnv Gemini deprecation', () => {
  it('returns a GeminiLLM and warns exactly once with the fixed, content-free message', () => {
    const warn = vi.fn();
    const env = { TIREH_LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'SYNTHETIC_KEY_CANARY', TIREH_LLM_MODEL: 'gemini-synthetic-model' };
    expect(createLLMFromEnv(env, { warn })).toBeInstanceOf(GeminiLLM);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(GEMINI_DEPRECATION_WARNING);
    const message = String(warn.mock.calls[0][0]);
    // No env value reaches the message: not the key, not the model.
    expect(message).not.toContain('SYNTHETIC_KEY_CANARY');
    expect(message).not.toContain('gemini-synthetic-model');
    expect(message.startsWith('tireh_llm_gemini_deprecated:')).toBe(true);
  });

  it('warns once per call', () => {
    const warn = vi.fn();
    createLLMFromEnv({ TIREH_LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' }, { warn });
    createLLMFromEnv({ TIREH_LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' }, { warn });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('never warns on the default Anthropic path', () => {
    const warn = vi.fn();
    expect(createLLMFromEnv({ ANTHROPIC_API_KEY: 'k' }, { warn })).toBeInstanceOf(AnthropicLLM);
    expect(createLLMFromEnv({ TIREH_LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }, { warn })).toBeInstanceOf(AnthropicLLM);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps the error branches unchanged and silent', () => {
    const warn = vi.fn();
    expect(() => createLLMFromEnv({ TIREH_LLM_PROVIDER: 'gemini' }, { warn })).toThrow('GEMINI_API_KEY is required for TIREH_LLM_PROVIDER=gemini');
    expect(() => createLLMFromEnv({ TIREH_LLM_PROVIDER: 'other' }, { warn })).toThrow('Unknown');
    expect(() => createLLMFromEnv({ TIREH_LLM_PROVIDER: 'other' }, { warn })).toThrow('Unknown TIREH_LLM_PROVIDER "other"');
    expect(() => createLLMFromEnv({}, { warn })).toThrow('ANTHROPIC_API_KEY is required for TIREH personas');
    expect(warn).not.toHaveBeenCalled();
  });

  it('defaults the logger to console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      createLLMFromEnv({ TIREH_LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' });
      expect(warn).toHaveBeenCalledWith(GEMINI_DEPRECATION_WARNING);
    } finally { warn.mockRestore(); }
  });
});
