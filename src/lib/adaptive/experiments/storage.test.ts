import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ControlledExperimentService } from './service';
import { FileExperimentStorage, MemoryExperimentStorage } from './storage';
import { authority, config, NOW, source } from './test-fixtures';
import { runExperimentCommand } from '../../../../scripts/studio-experiments';
const directories: string[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), 'vox-experiment-test-')); directories.push(d); return d; };
afterEach(() => directories.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
function activate(service: ControlledExperimentService) { service.install(config(), NOW); service.transition(config().id, 1, 'offline', NOW); service.transition(config().id, 2, 'shadow', NOW); service.transition(config().id, 3, 'pilot', NOW); }
describe('durable experiment ledger', () => {
  it('survives independent controller restarts and immediately observes another process kill', () => {
    const d = dir(), first = new ControlledExperimentService(new FileExperimentStorage(d)); activate(first);
    const p = first.prepare(authority(), source(), NOW, () => undefined)!;
    const second = new ControlledExperimentService(new FileExperimentStorage(d));
    expect(second.prepare(authority(), source('another-session'), NOW, () => undefined)!.density).toBe(p.density);
    second.kill(config().id, 4, 'quarantine', NOW + 1);
    expect(first.current(authority(), p, NOW + 1)).toBe(false);
    expect(first.expose(authority(), p.receipt, NOW + 1, () => undefined).recorded).toBe(false);
    expect(first.storage.read().derived.every(r => r.state === 'quarantined')).toBe(true);
  });
  it('persists observed expiry across restart even when the system clock moves backward', () => {
    const d = dir(), first = new ControlledExperimentService(new FileExperimentStorage(d)); activate(first);
    const a = { ...authority(), expiresAt: NOW + 100_000 }, p = first.prepare(a, source(), NOW, () => undefined)!;
    expect(first.current(a, p, NOW + 10_000)).toBe(false);
    const restarted = new ControlledExperimentService(new FileExperimentStorage(d));
    expect(restarted.current(a, p, NOW)).toBe(false); expect(restarted.prepare(a, source('delayed-job'), NOW, () => undefined)).toBeUndefined();
    expect(restarted.storage.read()).toMatchObject({ observedAt: NOW + 10_000, definitions: [{ phase: 'killed' }] });
  });
  it('rejects busy locks, oversized/nonprivate files, ledger symlinks and symlink ancestors', () => {
    const d = dir(), store = new FileExperimentStorage(d); mkdirSync(join(d, 'writer.lock'));
    expect(() => store.read()).toThrow('busy'); rmSync(join(d, 'writer.lock'), { recursive: true });
    writeFileSync(join(d, 'ledger.json'), Buffer.alloc(2_000_001), { mode: 0o600 }); expect(() => store.read()).toThrow('Unsafe');
    rmSync(join(d, 'ledger.json')); const target = join(dir(), 'private.json'); writeFileSync(target, '{}', { mode: 0o600 });
    symlinkSync(target, join(d, 'ledger.json')); expect(() => store.read()).toThrow('Unsafe');
    const linked = join(dir(), 'alias'); symlinkSync(d, linked); expect(() => new FileExperimentStorage(join(linked, 'child'))).toThrow('Unsafe');
  });
  it('aborts a failed final publication fence and leaves prior ledger intact', () => {
    const d = dir(), service = new ControlledExperimentService(new FileExperimentStorage(d)); activate(service);
    const before = readFileSync(join(d, 'ledger.json'), 'utf8'); let fences = 0;
    expect(() => service.storage.transaction(doc => { doc.observedAt++; }, () => { if (++fences === 2) throw new Error('revoked at publication'); })).toThrow('revoked');
    expect(readFileSync(join(d, 'ledger.json'), 'utf8')).toBe(before);
  });
  it('reserves deletion markers and fails capacity rather than evicting tombstones', () => {
    const store = new MemoryExperimentStorage();
    expect(() => store.transaction(d => { d.tombstones = Array.from({ length: 3001 }, (_, i) => ({ id: i.toString(16).padStart(64, '0'), at: NOW, kind: 'source_deleted' })); })).toThrow();
    expect(store.read().tombstones).toEqual([]);
  });
  it('provides a strict local install/advance/kill command with revision conflicts and no implicit activation', () => {
    const d = dir(), input = join(dir(), 'reviewed.json'); writeFileSync(input, JSON.stringify(config()), { mode: 0o600 });
    expect(runExperimentCommand([d, 'install', input], NOW)).toEqual({ revision: 1, phase: 'off' });
    expect(() => runExperimentCommand([d, 'advance', config().id, '1', 'pilot'], NOW)).toThrow();
    expect(runExperimentCommand([d, 'advance', config().id, '1', 'offline'], NOW)).toMatchObject({ phase: 'offline' });
    expect(runExperimentCommand([d, 'kill', config().id, '2', 'purge'], NOW)).toMatchObject({ phase: 'killed' });
    expect(() => runExperimentCommand([d, 'advance', config().id, '2', 'shadow'], NOW)).toThrow();
  });
});
