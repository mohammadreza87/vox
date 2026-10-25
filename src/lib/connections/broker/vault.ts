import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { idSchema } from '../contracts';
import { canonical } from '../repository';
import { ConnectionsError } from '../errors';
export const vaultBindingSchema = z.object({ accountId: idSchema, personId: idSchema, space: z.enum(['work', 'personal']),
  connectionId: idSchema, providerId: idSchema, agentId: idSchema.optional() }).strict();
export type VaultBinding = z.infer<typeof vaultBindingSchema>;
/** `grantref`: per provider grant, which connections hold a token and which tokens wait to be revoked (sealed like credentials). */
export type VaultKind = 'credential' | 'flow' | 'grantref';
const envelopeSchema = z.object({ id: idSchema, version: z.literal(1), keyVersion: z.string().min(1).max(50), kind: z.enum(['credential', 'flow', 'grantref']),
  binding: vaultBindingSchema, iv: z.string().max(100), tag: z.string().max(100), ciphertext: z.string().max(200_000) }).strict();
export interface BrokerVault {
  binding(kind: VaultKind, id: string): Promise<VaultBinding | undefined>;
  read(kind: VaultKind, id: string, binding: VaultBinding): Promise<unknown | undefined>;
  write(kind: VaultKind, id: string, binding: VaultBinding, value: unknown): Promise<void>;
  delete(kind: VaultKind, id: string): Promise<void>;
  listFlows(): Promise<readonly string[]>;
  /** Bindings of the connections' own credentials (never pending, webhook or grantref records): who still holds a provider grant. */
  credentialBindings?(): Promise<readonly VaultBinding[]>;
  withLock<T>(key: string, run: () => Promise<T>): Promise<T>;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
/** Vault process owns this directory and key. Studio cannot decrypt or read either. */
export class FileBrokerVault implements BrokerVault {
  constructor(readonly directory: string, private readonly key: Uint8Array, private readonly keyVersion = '1') {
    if (key.byteLength !== 32) throw new ConnectionsError(503, 'vault_key_invalid');
  }
  private file(kind: VaultKind, id: string) { return join(this.directory, kind, `${hash(id)}.json`); }
  async binding(kind: VaultKind, id: string): Promise<VaultBinding | undefined> {
    try { return envelopeSchema.parse(JSON.parse(await fs.readFile(this.file(kind, id), 'utf8'))).binding; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw new ConnectionsError(500, 'vault_record_invalid'); }
  }
  async read(kind: VaultKind, id: string, binding: VaultBinding): Promise<unknown | undefined> {
    let json: string;
    try {
      const file = this.file(kind, id); if ((await fs.stat(file)).size > 210_000) throw new ConnectionsError(500, 'vault_record_invalid');
      json = await fs.readFile(file, 'utf8');
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
    try {
      const envelope = envelopeSchema.parse(JSON.parse(json));
      if (envelope.id !== id || envelope.keyVersion !== this.keyVersion || envelope.kind !== kind || canonical(envelope.binding) !== canonical(binding)) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64'));
      decipher.setAAD(Buffer.from(canonical({ version: 1, keyVersion: this.keyVersion, kind, id, binding })));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
    } catch { throw new ConnectionsError(500, 'vault_record_invalid'); }
  }
  async write(kind: VaultKind, id: string, binding: VaultBinding, value: unknown): Promise<void> {
    const { randomUUID } = await import('node:crypto');
    vaultBindingSchema.parse(binding);
    const plaintext = JSON.stringify(value);
    if (Buffer.byteLength(plaintext) > 100_000) throw new ConnectionsError(413, 'vault_record_limit');
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(canonical({ version: 1, keyVersion: this.keyVersion, kind, id, binding })));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const record = { id, version: 1, keyVersion: this.keyVersion, kind, binding, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
    await fs.mkdir(join(this.directory, kind), { recursive: true, mode: 0o700 });
    const temporary = `${this.file(kind, id)}.${randomUUID()}.tmp`;
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); } finally { await handle.close(); }
    try {
      await fs.rename(temporary, this.file(kind, id));
      const directoryHandle = await fs.open(join(this.directory, kind), 'r');
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    } finally { await fs.unlink(temporary).catch(() => undefined); }
  }
  async delete(kind: VaultKind, id: string): Promise<void> {
    await fs.unlink(this.file(kind, id)).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
  }
  async listFlows(): Promise<readonly string[]> {
    try {
      const files = (await fs.readdir(join(this.directory, 'flow'))).filter(id => /^[0-9a-f]{64}\.json$/.test(id));
      if (files.length > 2000) throw new ConnectionsError(503, 'vault_flow_capacity');
      return await Promise.all(files.map(async file => envelopeSchema.parse(JSON.parse(await fs.readFile(join(this.directory, 'flow', file), 'utf8'))).id));
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  /** Reads only the plaintext envelope bindings; nothing is decrypted. A record that cannot be read or parsed cannot be used, so it holds
   * nothing and is skipped: one damaged file (any account's) must never block another account's revocation. */
  async credentialBindings(): Promise<readonly VaultBinding[]> {
    let files: string[];
    try { files = (await fs.readdir(join(this.directory, 'credential'))).filter(file => /^[0-9a-f]{64}\.json$/.test(file)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    if (files.length > 50_000) throw new ConnectionsError(503, 'vault_credential_capacity');
    const bindings: VaultBinding[] = [];
    for (const file of files) {
      let envelope: z.infer<typeof envelopeSchema>;
      try { envelope = envelopeSchema.parse(JSON.parse(await fs.readFile(join(this.directory, 'credential', file), 'utf8'))); }
      catch { continue; }
      if (envelope.kind === 'credential' && envelope.id === envelope.binding.connectionId) bindings.push(envelope.binding);
    }
    return bindings;
  }
  async withLock<T>(key: string, run: () => Promise<T>): Promise<T> {
    await fs.mkdir(join(this.directory, 'locks'), { recursive: true, mode: 0o700 });
    const lock = join(this.directory, 'locks', hash(key));
    try { await fs.mkdir(lock, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ConnectionsError(409, 'vault_operation_busy'); throw error; }
    try { return await run(); } finally { await fs.rmdir(lock); }
  }
}
/** Synthetic-only encrypted fixture can use FileBrokerVault with a temporary key/directory. */
export async function readPrivateKeyFile(path: string, expectedUid?: number): Promise<Buffer> {
  const stat = await fs.lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (expectedUid !== undefined && stat.uid !== expectedUid) || stat.size > 200) throw new ConnectionsError(503, 'broker_key_permissions_invalid');
  const raw = (await fs.readFile(path, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/i.test(raw)) throw new ConnectionsError(503, 'broker_key_invalid');
  return Buffer.from(raw, 'hex');
}
