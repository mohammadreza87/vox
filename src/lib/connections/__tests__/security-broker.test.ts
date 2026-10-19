import { mkdtemp, readFile, readdir, rm, copyFile, writeFile, chmod, symlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it, vi } from 'vitest';
import { BrokerAuthenticator, signBrokerRequest } from '../broker/auth';
import { FileBrokerVault, readPrivateKeyFile, type VaultBinding } from '../broker/vault';
import { validateBrokerProcess, type BrokerConfiguration } from '../broker/bootstrap';

// Deterministic local fixture material, never a deployment key or provider token.
const KEY = new Uint8Array(32).fill(77);
const NOW = 1_800_000_000_000;
const binding: VaultBinding = { accountId: 'qa-account', personId: 'qa-person', space: 'personal', connectionId: 'qa-connection', providerId: 'qa-provider' };

describe('independent broker service authentication and encrypted fixture vault', () => {
  it('binds signed requests to exact method, path and original bytes and rejects replay', () => {
    const body = '{"operationId":"qa-operation"}';
    const headers = signBrokerRequest(KEY, 'POST', '/api/connections/broker', body, NOW);
    const verify = () => new BrokerAuthenticator(KEY, () => NOW);
    expect(() => verify().verify('GET', '/api/connections/broker', body, headers)).toThrow('broker_auth_denied');
    expect(() => verify().verify('POST', '/different-path', body, headers)).toThrow('broker_auth_denied');
    expect(() => verify().verify('POST', '/api/connections/broker', body + ' ', headers)).toThrow('broker_auth_denied');
    const auth = verify(); auth.verify('POST', '/api/connections/broker', body, headers);
    expect(() => auth.verify('POST', '/api/connections/broker', body, headers)).toThrow('broker_auth_denied');
  });

  it('rejects expired service authentication and another signing key', () => {
    const headers = signBrokerRequest(KEY, 'POST', '/api/connections/broker', '{}', NOW);
    expect(() => new BrokerAuthenticator(KEY, () => NOW + 60_001).verify('POST', '/api/connections/broker', '{}', headers)).toThrow('broker_auth_denied');
    expect(() => new BrokerAuthenticator(new Uint8Array(32).fill(88), () => NOW).verify('POST', '/api/connections/broker', '{}', headers)).toThrow('broker_auth_denied');
  });

  it('separate private hex key copies derive compatible signing bytes and reject unsafe ownership/modes/symlinks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vox-independent-keycopies-'));
    try {
      const studioPath = join(directory, 'qa-studio-key'); const brokerPath = join(directory, 'qa-broker-key');
      await writeFile(studioPath, Buffer.from(KEY).toString('hex') + '\n', { mode: 0o600 });
      await copyFile(studioPath, brokerPath); await chmod(brokerPath, 0o600);
      const studioKey = await readPrivateKeyFile(studioPath, process.getuid?.());
      const brokerKey = await readPrivateKeyFile(brokerPath, process.getuid?.());
      expect(studioKey.equals(brokerKey)).toBe(true);
      const headers = signBrokerRequest(studioKey, 'POST', '/api/connections/broker', '{}', NOW);
      expect(() => new BrokerAuthenticator(brokerKey, () => NOW).verify('POST', '/api/connections/broker', '{}', headers)).not.toThrow();
      await chmod(studioPath, 0o644); await expect(readPrivateKeyFile(studioPath)).rejects.toThrow('broker_key_permissions_invalid');
      await chmod(studioPath, 0o600);
      const link = join(directory, 'qa-key-link'); await symlink(studioPath, link);
      await expect(readPrivateKeyFile(link)).rejects.toThrow('broker_key_permissions_invalid');
      if (process.getuid) await expect(readPrivateKeyFile(studioPath, process.getuid() + 1)).rejects.toThrow('broker_key_permissions_invalid');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('encrypts local fixture credentials and authenticates account/person/space/connection/provider binding', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vox-independent-vault-'));
    try {
      const vault = new FileBrokerVault(directory, KEY);
      const secret = { accessToken: 'SYNTHETIC_ENCRYPTION_CANARY_552' };
      await vault.write('credential', 'qa-credential', binding, secret);
      expect(await vault.read('credential', 'qa-credential', binding)).toEqual(secret);
      const files = await readdir(join(directory, 'credential'));
      expect(await readFile(join(directory, 'credential', files[0]), 'utf8')).not.toContain(secret.accessToken);
      for (const [field, value] of Object.entries({ accountId: 'other-account', personId: 'other-person', space: 'work', connectionId: 'other-connection', providerId: 'other-provider' })) {
        await expect(vault.read('credential', 'qa-credential', { ...binding, [field]: value })).rejects.toThrow('vault_record_invalid');
      }
      await expect(new FileBrokerVault(directory, KEY, 'another-key-version').read('credential', 'qa-credential', binding)).rejects.toThrow('vault_record_invalid');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('rejects swapping ciphertext between record IDs with otherwise identical scope', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vox-independent-vault-'));
    try {
      const vault = new FileBrokerVault(directory, KEY);
      await vault.write('credential', 'qa-first', binding, { accessToken: 'FIRST_SYNTHETIC' });
      const [first] = await readdir(join(directory, 'credential'));
      await vault.write('credential', 'qa-second', binding, { accessToken: 'SECOND_SYNTHETIC' });
      const second = (await readdir(join(directory, 'credential'))).find(file => file !== first)!;
      await copyFile(join(directory, 'credential', first), join(directory, 'credential', second));
      await expect(vault.read('credential', 'qa-second', binding)).rejects.toThrow('vault_record_invalid');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('serializes credential rotation with a real filesystem lock and releases it after failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vox-independent-vault-'));
    try {
      const vault = new FileBrokerVault(directory, KEY);
      let entered!: () => void; let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
      const first = vault.withLock('qa-rotation', async () => { entered(); await gate; });
      await started;
      await expect(vault.withLock('qa-rotation', async () => undefined)).rejects.toThrow('vault_operation_busy');
      release(); await first;
      await expect(vault.withLock('qa-rotation', async () => { throw new Error('synthetic failure'); })).rejects.toThrow('synthetic failure');
      await expect(vault.withLock('qa-rotation', async () => 'released')).resolves.toBe('released');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it.skipIf(process.getuid?.() === undefined || process.getuid?.() === 0).each(['VOXX_BOT_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY'])
    ('rejects actual ambient Studio credential variable %s in the isolated broker process', async name => {
      const directory = await mkdtemp(join(tmpdir(), 'vox-independent-process-'));
      const uid = process.getuid!();
      try {
        // Start from an explicit clean process environment; never inspect or print actual values.
        const allowed = new Set(['PATH', 'NODE_ENV', 'HOME', 'TMPDIR', 'TZ', 'LANG', 'LC_ALL', 'USER', 'SHELL', 'PWD', 'LOGNAME', 'TERM', 'NODE_OPTIONS']);
        for (const key of Object.keys(process.env)) if (!allowed.has(key)) vi.stubEnv(key, '');
        const configuration = { brokerUid: uid, studioUid: uid + 1, vaultDirectory: directory,
          vaultKeyFile: join(directory, 'qa-vault-key'), authKeyFile: join(directory, 'qa-auth-key') } as BrokerConfiguration;
        await expect(validateBrokerProcess(configuration)).resolves.toBeUndefined();
        vi.stubEnv(name, 'SYNTHETIC_AMBIENT_CANARY');
        await expect(validateBrokerProcess(configuration)).rejects.toMatchObject({ code: 'broker_ambient_studio_credentials_denied' });
      } finally { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); }
    });
});
