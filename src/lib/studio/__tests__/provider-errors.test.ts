import { APIConnectionError, AuthenticationError, BadRequestError, InternalServerError, NotFoundError, RateLimitError } from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { providerErrorMessage } from '../http';

const body = (type: string, message: string) => ({ type: 'error', error: { type, message } });
const headers = new Headers();

describe('providerErrorMessage', () => {
  it('explains Claude API failures without exposing keys', () => {
    expect(providerErrorMessage(new AuthenticationError(401, body('authentication_error', 'invalid x-api-key'), undefined, headers)))
      .toMatch(/rejected the server's ANTHROPIC_API_KEY/);
    expect(providerErrorMessage(new NotFoundError(404, body('not_found_error', 'model: claude-x'), undefined, headers)))
      .toMatch(/model not found \(model: claude-x\).*STUDIO_PERSONA_MODEL/);
    expect(providerErrorMessage(new BadRequestError(400, body('invalid_request_error', 'Your credit balance is too low to access the Anthropic API.'), undefined, headers)))
      .toMatch(/out of credit/);
    expect(providerErrorMessage(new RateLimitError(429, body('rate_limit_error', 'slow down'), undefined, headers))).toMatch(/rate-limiting/);
    expect(providerErrorMessage(new InternalServerError(529, body('overloaded_error', 'Overloaded'), undefined, headers))).toMatch(/overloaded/);
    expect(providerErrorMessage(new APIConnectionError({ message: 'fetch failed' }))).toMatch(/can't reach Claude/);
  });

  it('explains OpenAI and ElevenLabs failures', () => {
    expect(providerErrorMessage(new Error('ElevenLabs voice design failed: HTTP 401'))).toMatch(/ELEVENLABS_API_KEY was rejected/);
    expect(providerErrorMessage(new Error('OpenAI image generation failed: HTTP 429'))).toMatch(/rate limited or out of credit/);
    expect(providerErrorMessage(new Error('OpenAI image generation failed: Billing hard limit reached'))).toBe('OpenAI image generation failed: Billing hard limit reached');
  });

  it('leaves other errors to the generic message', () => {
    expect(providerErrorMessage(new Error('boom'))).toBeNull();
    expect(providerErrorMessage('nope')).toBeNull();
  });
});
