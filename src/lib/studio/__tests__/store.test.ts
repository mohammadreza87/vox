import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import { StudioStore } from '../store';
import { fakeMember, tempDir } from './helpers';

describe('StudioStore', () => {
  it('starts empty and persists atomically to studio.json (no .tmp left behind)', async () => {
    const dir = tempDir();
    const store = new StudioStore(dir);
    expect(await store.read()).toEqual({ members: [], agents: [], groups: [], audit: [] });
    await store.update((s) => { s.members.push(fakeMember(1, 'member')); });
    const files = readdirSync(dir);
    expect(files).toContain('studio.json');
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8')).members).toHaveLength(1);
  });

  it('reloads from disk in a new instance and fills missing collections', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'studio.json'), JSON.stringify({ members: [fakeMember(7, 'admin')] }));
    const store = new StudioStore(dir);
    const s = await store.read();
    expect(s.members[0].telegramId).toBe(7);
    expect(s.agents).toEqual([]);
    expect(s.audit).toEqual([]);
  });

  it('serializes concurrent updates: no lost writes', async () => {
    const store = new StudioStore(tempDir());
    // Fire 50 read-modify-write updates at once, interleaved with reads.
    await Promise.all(Array.from({ length: 50 }, (_, i) => Promise.all([
      store.update((s) => { s.members = [...s.members, fakeMember(i + 1, 'member')]; }),
      store.read(),
    ])));
    expect((await store.read()).members).toHaveLength(50);
    expect(new Set((await new StudioStore(store.dir).read()).members.map((m) => m.telegramId)).size).toBe(50);
  });

  it('a throwing update leaves memory and disk unchanged and does not block later updates', async () => {
    const dir = tempDir();
    const store = new StudioStore(dir);
    await store.update((s) => { s.members.push(fakeMember(1, 'member')); });
    const before = readFileSync(join(dir, 'studio.json'), 'utf8');
    await expect(store.update((s) => { s.members.push(fakeMember(2, 'member')); throw new Error('nope'); })).rejects.toThrow('nope');
    expect((await store.read()).members).toHaveLength(1);
    expect(readFileSync(join(dir, 'studio.json'), 'utf8')).toBe(before);
    await store.update((s) => { s.members.push(fakeMember(3, 'member')); });
    expect((await store.read()).members.map((m) => m.telegramId)).toEqual([1, 3]);
  });

  it('a failed disk write leaves the in-memory state unchanged', async () => {
    const store = new StudioStore(tempDir());
    await store.update((s) => { s.members.push(fakeMember(1, 'member')); });
    const persist = vi.spyOn(store as unknown as { persist: () => void }, 'persist').mockImplementationOnce(() => { throw new Error('ENOSPC'); });
    await expect(store.update((s) => { s.members.push(fakeMember(2, 'member')); })).rejects.toThrow('ENOSPC');
    persist.mockRestore();
    expect((await store.read()).members).toHaveLength(1);
  });

  it('read() and update() results are copies: mutating them does not change stored state', async () => {
    const store = new StudioStore(tempDir());
    const member = await store.update((s) => { s.members.push(fakeMember(1, 'member')); return s.members[0]; });
    member.role = 'superadmin';
    const snapshot = await store.read();
    snapshot.members[0].role = 'admin';
    expect((await store.read()).members[0].role).toBe('member');
  });

  it('caps the audit log at 5000 entries', async () => {
    const store = new StudioStore(tempDir());
    await store.update((s) => {
      for (let i = 0; i < 5000; i++) s.audit.push({ at: '', actor: 1, action: `a${i}` });
    });
    await store.audit({ actor: 1, action: 'last' });
    const { audit } = await store.read();
    expect(audit).toHaveLength(5000);
    expect(audit[0].action).toBe('a1');
    expect(audit.at(-1)?.action).toBe('last');
  });

  it('only saves and serves safe media names inside the media dir', async () => {
    const dir = tempDir();
    const store = new StudioStore(dir);
    await store.saveMedia('av-1.jpg', Buffer.from('img'));
    expect((await store.readMedia('av-1.jpg'))?.toString()).toBe('img');
    expect(await store.readMedia('missing.jpg')).toBeNull();
    for (const bad of ['../studio.json', '..', '.hidden', 'a/b.jpg', '/etc/passwd', 'x\\..\\y', '', 'a'.repeat(200)]) {
      await expect(store.saveMedia(bad, Buffer.from('x'))).rejects.toThrow('Unsafe media file name');
      expect(await store.readMedia(bad)).toBeNull();
    }
    // studio.json lives one level up and is never reachable as media
    writeFileSync(join(dir, 'studio.json'), '{}');
    expect(await store.readMedia('studio.json')).toBeNull();
    expect(existsSync(join(dir, 'media', 'av-1.jpg'))).toBe(true);
  });
});
