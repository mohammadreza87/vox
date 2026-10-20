/** Select origin only from trusted server configuration, never Host/forwarding
 * headers. Undefined means malformed configuration and must fail closed.
 * Unconfigured direct servers retain their existing request-URL origin. */
export function trustedStudioRequestOrigin(requestUrl: string | URL, webAppUrl?: string): string | undefined {
    let request: URL;
    try { request = new URL(requestUrl); } catch { return; }
    if (webAppUrl === undefined) return request.origin;
    let configured: URL;
    try { configured = new URL(webAppUrl); } catch { return; }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname);
    if ((configured.protocol !== 'https:' && !(configured.protocol === 'http:' && loopback)) ||
        !/^\/studio\/?$/.test(configured.pathname) || configured.username || configured.password || configured.search || configured.hash)
        return;
    return configured.origin;
}
