/** Safe codes only. Never include provider bodies, URLs, credentials, or arguments. */
export class ConnectionsError extends Error {
  readonly name = 'ConnectionsError';
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export const deny = (code: string, status = 403): never => { throw new ConnectionsError(status, code); };
