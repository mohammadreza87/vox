/** Public guest intake must not initialize getStudio, Firebase, bots or providers. */
import { constants, openSync, closeSync, fstatSync, readFileSync, lstatSync, readlinkSync } from 'node:fs';
import { isAbsolute, join, resolve, parse, relative, sep } from 'node:path';
import { GuestRightsService } from '../adaptive/guest-rights/service';
import { GuestRightsStorage } from '../adaptive/guest-rights/storage';
import { parseGuestPolicy } from '../adaptive/guest-rights/policy';
import { fail } from '../adaptive/rights-intake/repository';
function currentOperator(data: string, id: number) {
    let path = resolve(data);
    for (const [alias, target] of [['/tmp', '/private/tmp'], ['/var', '/private/var']])
        if (path === alias || path.startsWith(alias + '/')) {
            if (lstatSync(alias, { throwIfNoEntry: false })?.isSymbolicLink()) {
                const link = readlinkSync(alias);
                if (link !== target && link !== target.slice(1))
                    return fail(503, 'guest_unavailable');
                path = join(target, relative(alias, path));
            }
            break;
        }
    const file = join(path, 'studio.json');
    let current = parse(file).root;
    for (const part of relative(current, file).split(sep).filter(Boolean)) {
        current = join(current, part);
        const stat = lstatSync(current, { throwIfNoEntry: false });
        if (!stat || stat.isSymbolicLink() || current !== file && !stat.isDirectory())
            return fail(503, 'guest_unavailable');
    }
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.size > 4 * 1024 * 1024)
            return fail(503, 'guest_unavailable');
        const raw = readFileSync(fd, 'utf8');
        if (Buffer.byteLength(raw) > 4 * 1024 * 1024)
            return fail(503, 'guest_unavailable');
        const state: unknown = JSON.parse(raw);
        if (!state || typeof state !== 'object' || !('members' in state) || !Array.isArray(state.members))
            return fail(503, 'guest_unavailable');
        const rows = state.members.filter(m => m && m.telegramId === id);
        if (rows.length !== 1 || !['owner', 'superadmin'].includes(rows[0].role))
            return fail(403, 'guest_operator_required');
        let parent = parse(file).root; for (const part of relative(parent, file).split(sep).filter(Boolean)) { parent = join(parent, part); const info = lstatSync(parent); if (info.isSymbolicLink() || parent !== file && !info.isDirectory()) return fail(503, 'guest_unavailable'); }
        const latest = lstatSync(file);
        if (latest.isSymbolicLink() || latest.ino !== stat.ino || latest.dev !== stat.dev || latest.size !== stat.size || latest.mtimeMs !== stat.mtimeMs)
            return fail(503, 'guest_unavailable');
    }
    finally {
        closeSync(fd);
    }
}
export function guestRightsRuntime(env: NodeJS.ProcessEnv = process.env): GuestRightsService | undefined {
    if ((env.STUDIO_STORAGE ?? 'file') !== 'file' || env.STUDIO_PUBLIC_URL || env.K_SERVICE || env.FUNCTION_TARGET || env.FUNCTION_NAME || env.VERCEL === '1' || !env.STUDIO_DATA_DIR || !isAbsolute(env.STUDIO_DATA_DIR) || resolve(env.STUDIO_DATA_DIR) === '/')
        return;
    const key = () => { const raw = env.STUDIO_GUEST_RIGHTS_KEY_BASE64; return raw && /^[A-Za-z0-9+/]{43}=$/.test(raw) ? Buffer.from(raw, 'base64') : undefined; };
    if (key()?.length !== 32)
        return;
    const data = env.STUDIO_DATA_DIR;
    return new GuestRightsService(new GuestRightsStorage(join(data, 'guest-rights', 'v1')), { key, policy: () => parseGuestPolicy(env.STUDIO_GUEST_RIGHTS_POLICY_JSON), assertOperatorNow: id => currentOperator(data, id) });
}
