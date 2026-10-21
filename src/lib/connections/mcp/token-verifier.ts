import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { z } from 'zod';
import { ConnectionsError } from '../errors';
import type { McpPublicTransport } from './transport';

const jwksSchema = z.object({ keys: z.array(z.record(z.string(), z.unknown())).min(1).max(20) }).strict();
/** A resource indicator in a request is not evidence of the returned token's
 * audience. This deliberately supports signed JWT access tokens only; opaque
 * tokens require a separately reviewed introspection contract. */
export async function verifyMcpAccessToken(input: { accessToken: string; issuer: string; resource: string; jwksUri: string;
  scopes: readonly string[]; transport: McpPublicTransport; now: () => number; signal?: AbortSignal; assertCurrent: () => Promise<void> }): Promise<number> {
  try {
    if (input.accessToken.split('.').length !== 3) throw Error();
    const response = await input.transport.json({ url: input.jwksUri, method: 'GET', maxBytes: 65_536,
      signal: input.signal, beforeSend: input.assertCurrent });
    if (response.status !== 200) throw Error();
    const jwks = jwksSchema.parse(response.value);
    for (const key of jwks.keys) if (['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some(name => Object.hasOwn(key, name)) ||
        !['RSA', 'EC', 'OKP'].includes(String(key.kty)) || key.use !== undefined && key.use !== 'sig' ||
        key.key_ops !== undefined && (!Array.isArray(key.key_ops) || key.key_ops.some(op => op !== 'verify')) ||
        key.kty === 'RSA' && (key.e !== 'AQAB' || typeof key.n !== 'string' || !/^[A-Za-z0-9_-]{342,683}$/.test(key.n) ||
          Buffer.from(key.n, 'base64url').length < 256 || Buffer.from(key.n, 'base64url').length > 512) ||
        key.kty === 'EC' && (key.crv !== 'P-256' || !/^[A-Za-z0-9_-]{43}$/.test(String(key.x)) || !/^[A-Za-z0-9_-]{43}$/.test(String(key.y))) ||
        key.kty === 'OKP' && (key.crv !== 'Ed25519' || !/^[A-Za-z0-9_-]{43}$/.test(String(key.x)))) throw Error();
    const now = input.now();
    const { payload, protectedHeader } = await jwtVerify(input.accessToken, createLocalJWKSet(jwks as JSONWebKeySet), {
      algorithms: ['RS256', 'PS256', 'ES256', 'EdDSA'], issuer: input.issuer, audience: input.resource,
      requiredClaims: ['iss', 'aud', 'exp'], currentDate: new Date(now), clockTolerance: 0,
    });
    // No token-header-selected URL or multi-resource general credential is accepted.
    if (protectedHeader.jku !== undefined || protectedHeader.x5u !== undefined ||
        (Array.isArray(payload.aud) ? payload.aud.length !== 1 || payload.aud[0] !== input.resource : payload.aud !== input.resource) ||
        typeof payload.exp !== 'number' || !Number.isSafeInteger(payload.exp) || payload.exp * 1000 <= now ||
        payload.exp * 1000 > now + 31_536_000_000 ||
        payload.iat !== undefined && (typeof payload.iat !== 'number' || payload.iat * 1000 > now + 30_000)) throw Error();
    const scopes = payload.scope === undefined ? [] : typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : (() => { throw Error(); })();
    if (scopes.some(scope => !input.scopes.includes(scope)) || input.scopes.some(scope => !scopes.includes(scope))) throw Error();
    await input.assertCurrent();
    if (payload.exp * 1000 <= input.now()) throw Error();
    return payload.exp * 1000;
  } catch (error) {
    if (ConnectionsError.is(error)) throw error;
    throw new ConnectionsError(403, 'mcp_oauth_token_binding_denied');
  }
}
