import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyRoleMetadata } from '../../../../scripts/connections-preflight.mjs';
const configuration = { brokerUid: 61001, studioUid: 61000 };
const file = (uid: number) => ({ kind: 'file', uid, mode: 0o600, links: 1, symbolicLink: false });
const metadata = () => ({ brokerConfig: file(61001), vaultDirectory: { kind: 'directory', uid: 61001, mode: 0o700, links: 2, symbolicLink: false }, vaultKey: file(61001), brokerAuthKey: file(61001), studioAuthKey: file(61000) });
const keys = { readable: true, validEncoding: true, controlCopiesMatch: true, vaultDistinct: true };
const principals = { broker: true, studio: true };
const codes = (result: ReturnType<typeof verifyRoleMetadata>) => result.issues.map((issue: { code: string }) => issue.code);
describe('offline independent broker deployment templates/preflight', () => {
  it('verifies distinct nonroot role ownership and keyroles without claiming runtime/ACL/provider proof or activation', () => {
    const report = verifyRoleMetadata(configuration, metadata(), keys, principals);
    expect(report.status).toBe('PASS'); expect(report).toMatchObject({ runtimeIamProof: 'UNAVAILABLE', aclProof: 'UNAVAILABLE', keyValuesPrinted: false, serviceActivation: false, usersOrSecretsCreated: false });
  });
  it('rejects shared/root identities and nonexistent deployment principals', () => {
    expect(codes(verifyRoleMetadata({ brokerUid: 61000, studioUid: 61000 }, metadata(), keys, principals))).toContain('independent_nonroot_uids_required');
    expect(codes(verifyRoleMetadata({ brokerUid: 0, studioUid: 61000 }, metadata(), keys, principals))).toContain('independent_nonroot_uids_required');
    expect(codes(verifyRoleMetadata(configuration, metadata(), keys))).toEqual(expect.arrayContaining(['broker_principal_unavailable', 'studio_principal_unavailable']));
  });
  it('rejects role-swapped, group-readable, symlinked and hardlinked credential/config files', () => {
    for (const patch of [{ uid: 61000 }, { mode: 0o640 }, { symbolicLink: true }, { links: 2 }]) {
      const current = metadata(); current.vaultKey = { ...current.vaultKey, ...patch };
      expect(verifyRoleMetadata(configuration, current, keys, principals).status).toBe('FAIL');
    }
    const swapped = metadata(); swapped.studioAuthKey.uid = 61001;
    expect(codes(verifyRoleMetadata(configuration, swapped, keys, principals))).toContain('studioAuthKey_ownership_or_permissions_invalid');
  });
  it('requires actual matching control keycopies and a different vault key; missing roles remain unavailable', () => {
    expect(codes(verifyRoleMetadata(configuration, metadata(), { ...keys, controlCopiesMatch: false }, principals))).toContain('studio_broker_control_key_mismatch');
    expect(codes(verifyRoleMetadata(configuration, metadata(), { ...keys, vaultDistinct: false }, principals))).toContain('vault_control_key_reuse_denied');
    expect(codes(verifyRoleMetadata(configuration, {}, { ...keys, readable: false }, principals))).toContain('private_key_role_proof_unavailable');
  });
  it('contains inactive deployment templates with dedicated identities, no credential environment and restricted Linux service privileges', () => {
    const systemd = readFileSync(resolve('services/connections-broker/systemd/vox-connections-broker.service'), 'utf8');
    for (const required of ['User=vox-broker', 'Group=vox-broker', 'NoNewPrivileges=true', 'CapabilityBoundingSet=', 'ProtectSystem=strict', 'ProtectHome=true', 'PrivateDevices=true', 'UMask=0077', 'KillMode=control-group']) expect(systemd).toContain(required);
    expect(systemd).not.toMatch(/Environment=.*(?:TOKEN|SECRET|PRIVATE_KEY|PASSWORD)=/);
    const plist = readFileSync(resolve('services/connections-broker/launchd/io.ludaxis.vox.connections-broker.plist'), 'utf8');
    expect(plist).toContain('<key>UserName</key><string>vox-broker</string>'); expect(plist).toContain('<key>Umask</key><integer>63</integer>'); expect(plist).not.toContain('STUDIO_SECRET');
  });
});
