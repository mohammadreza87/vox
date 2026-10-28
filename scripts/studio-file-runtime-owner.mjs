/** Cooperative original-FILE lifetime admission. Importing this module performs no I/O. */
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManagedMemoryGuardToken, readManagedMemoryAccountPreflight,readManagedMemoryAccountArtifact,revokeManagedMemoryAccountGuard } from './studio-memory-account-operation.mjs';

export const FILE_RUNTIME_OWNER_GUARD = '.studio-runtime-owner-v1.lock';
export const FILE_RUNTIME_OWNER_MARKER = 'file-runtime-owner-v1.json';
export const FILE_RUNTIME_OWNER_MARKER_BYTES = '{"version":1,"kind":"studio-file-runtime-owner"}\n';
const SLOT = Symbol.for('vox.studio.file-runtime-owner.v1');
const fail = () => { throw new Error('Studio FILE runtime ownership unavailable'); };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const identity = s => ({ dev: String(s.dev), ino: String(s.ino), birth: String(s.birthtimeNs) });
const stat = p => fs.lstatSync(p, { bigint: true, throwIfNoEntry: false });
const sha = v => typeof v === 'string' && /^[a-f0-9]{40}(?![\s\S])/.test(v);
const integer = v => Number.isSafeInteger(v) && v >= 0 && !Object.is(v, -0);
const uid = () => BigInt(process.geteuid?.() ?? process.getuid?.() ?? -1);
const hash = b => createHash('sha256').update(b).digest('hex');
function registry() {
  const old = globalThis[SLOT];
  if (old) { if (old.version !== 1 || !(old.roots instanceof Map) || !(old.owners instanceof WeakMap) || !(old.authorizations instanceof WeakMap)) fail(); return old; }
  const value = { version: 1, roots: new Map(), owners: new WeakMap(), authorizations: new WeakMap(), operations: new WeakMap(), fixtures: new Map(), transient: new Map(), intents: new Map(), fds: new Map() };
  Object.defineProperty(globalThis, SLOT, { value, configurable: false, writable: false });
  return value;
}
function pathString(p) {
  if (typeof p === 'number') { const found = registry().fds.get(p); if (!found || !equal(identity(fs.fstatSync(p, { bigint:true })), found.identity)) fail(); return found.path; }
  if (p instanceof URL) p = fileURLToPath(p);
  if (Buffer.isBuffer(p)) p = p.toString();
  if (typeof p !== 'string' || !p || p.length > 4096 || p.includes('\0')) fail();
  let value = resolve(p);
  for (const [alias, target] of [['/tmp', '/private/tmp'], ['/var', '/private/var']]) {
    if (value !== alias && !value.startsWith(`${alias}/`)) continue;
    const info = stat(alias);
    if (info?.isSymbolicLink()) {
      const link = fs.readlinkSync(alias);
      if (link !== target && link !== target.slice(1)) fail();
      value = join(target, relative(alias, value));
    }
    break;
  }
  return value;
}
function ancestors(p) { const result = []; for (let current = p, count = 0; ; count++) { if (count > 256) fail(); result.push(current); const parent = dirname(current); if (parent === current) return result; current = parent; } }
function checkComponents(p, allowMissing = false) {
  let current = parse(p).root;
  for (const part of relative(current, p).split(sep).filter(Boolean)) {
    current = join(current, part);
    const info = stat(current);
    if (!info) { if (allowMissing) return; fail(); }
    if (info.isSymbolicLink() || current !== p && !info.isDirectory()) fail();
  }
}
function privateRoot(p, create = false, allowMissingFinal = false) {
  if (typeof p !== 'string' || !isAbsolute(p)) fail();
  const root = pathString(p);
  if (root === parse(root).root || /(?:^|\/)\.next(?:\/|$)|(?:^|\/)public(?:\/|$)/.test(root)) fail();
  checkComponents(dirname(root));
  if (!stat(root) && (create || allowMissingFinal)) {
    const parent = stat(dirname(root));
    if (!parent?.isDirectory() || parent.uid !== uid() || (parent.mode & 0o077n) !== 0n) fail();
    if (create) fs.mkdirSync(root, { mode: 0o700 });
    else return { root, info: undefined };
  }
  checkComponents(root);
  const info = stat(root);
  if (!info?.isDirectory() || info.uid !== uid() || (info.mode & 0o077n) !== 0n) fail();
  return { root, info };
}
function readRegular(p, max, privateOnly = true) {
  checkComponents(p);
  const before = stat(p);
  if (!before?.isFile() || before.nlink !== 1n || before.uid !== uid() || privateOnly && (before.mode & 0o077n) !== 0n || before.size > BigInt(max)) fail();
  const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    const buffer = Buffer.alloc(max + 1); let n = 0, count;
    do { count = fs.readSync(fd, buffer, n, buffer.length - n, null); n += count; } while (count && n < buffer.length);
    const after = fs.fstatSync(fd, { bigint: true }), named = stat(p);
    if (!named?.isFile() || n > max || !equal(identity(before), identity(opened)) || !equal(identity(opened), identity(after)) || !equal(identity(after), identity(named)) || opened.ctimeNs !== after.ctimeNs || opened.mtimeNs !== after.mtimeNs || opened.size !== after.size || after.nlink !== 1n || named.ctimeNs !== after.ctimeNs) fail();
    const bytes = buffer.subarray(0, n), text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { text, digest: hash(bytes), identity: identity(after), stat: after };
  } finally { fs.closeSync(fd); }
}
function release(v) { if (!v || Object.keys(v).sort().join() !== 'buildId,revision,sourceTree' || !sha(v.revision) || !sha(v.sourceTree) || typeof v.buildId !== 'string' || !v.buildId || v.buildId.length > 200 || v.buildId.trim() !== v.buildId || /[\x00-\x1f\x7f]/.test(v.buildId)) fail(); return structuredClone(v); }
function parseRecord(text) {
  const r = JSON.parse(text);
  if (!r || Object.keys(r).sort().join() !== 'kind,nonce,pid,release,role,startedAt,version' || r.version !== 1 || r.kind !== 'studio-file-runtime-owner' || !['runtime', 'maintenance'].includes(r.role) || !/^[a-f0-9]{64}$/.test(r.nonce) || !integer(r.pid) || r.pid < 1 || !integer(r.startedAt)) fail();
  release(r.release); return r;
}
function syncDir(p) { const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function markerPath(root) { return join(root, 'adaptive', FILE_RUNTIME_OWNER_MARKER); }
function assertMarker(root, expected) {
  const current = readRegular(markerPath(root), 128);
  if (current.text !== FILE_RUNTIME_OWNER_MARKER_BYTES || expected && !equal(current.identity, expected)) fail();
  if (stat(`${join(root, 'adaptive')}.managed`)) fail();
  return current.identity;
}
function details(owner) { const entry = registry().owners.get(owner); if (!entry || registry().roots.get(entry.root) !== entry || entry.capability !== owner) fail(); return entry; }
function active(entry) { if (entry.state !== 'active' || entry.controller.signal.aborted) fail(); }
function terminate(entry, state) {
  if (entry.state !== 'active') return;
  entry.state = state; entry.controller.abort();
  for (const callback of entry.listeners) { try { Promise.resolve(callback()).catch(() => undefined); } catch { /* Safety latch is already durable in this process. */ } }
  entry.listeners.clear();
}
function assertEntry(entry) {
  active(entry);
  try {
    const info = privateRoot(entry.root).info, heldRoot = fs.fstatSync(entry.rootFd, { bigint: true });
    if (!equal(identity(info), entry.rootIdentity) || !equal(identity(heldRoot), entry.rootIdentity)) fail();
    const held = fs.fstatSync(entry.fd, { bigint: true }), named = readRegular(join(entry.root, FILE_RUNTIME_OWNER_GUARD), 2048);
    if (!held.isFile() || held.nlink !== 1n || held.uid !== uid() || (held.mode & 0o077n) !== 0n || !equal(identity(held), entry.guardIdentity) || !equal(named.identity, entry.guardIdentity) || named.text !== entry.bytes || named.digest !== entry.digest || held.ctimeNs !== named.stat.ctimeNs || held.ctimeNs !== entry.guardMetadata.ctime || held.mtimeNs !== entry.guardMetadata.mtime || held.size !== entry.guardMetadata.size) fail();
    if (entry.marker) assertMarker(entry.root, entry.marker);
    active(entry);
  } catch { terminate(entry, 'lost'); fail(); }
}
export function acquireFileRuntimeOperationGuard(input, operation, managedToken) {
  if (typeof operation !== 'string' || !/^[a-z][a-z-]{0,63}$/.test(operation)) fail();
  if(typeof input!=='string'||!isAbsolute(input)||resolve(input)==='/')throw new Error('Production base must be an absolute private directory.');
  if(operation==='prepare'&&!stat(input))fs.mkdirSync(input,{recursive:true,mode:0o700});
  const resolved=fs.realpathSync(input);
  if(resolved==='/')throw new Error('Production base must be a private directory, not the filesystem root.');
  const { root: base } = privateRoot(resolved);
  const baseIdentity = identity(stat(base)), lockPath = join(base, '.studio-operation.lock');
  const managedMemory=managedToken===undefined?undefined:readManagedMemoryGuardToken(managedToken,base,operation);
  const bytes = JSON.stringify({ version: 1, token: randomBytes(32).toString('hex'), pid: process.pid, startedAt: new Date().toISOString(), operation,
    ...(managedMemory?{managedMemory}:{} ) });
  if(Buffer.byteLength(bytes)>4096)fail();
  try{fs.mkdirSync(lockPath,{mode:0o700});}catch(error){if(error.code==='EEXIST')throw new Error('Another operation or a stale lock exists. Explicit verified recovery is required; no automatic reclaim.');throw error;}
  const lockIdentity = identity(stat(lockPath)), ownerPath = join(lockPath, 'owner.json');
  const ownerFd = fs.openSync(ownerPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW, 0o600);
  fs.writeFileSync(ownerFd, bytes); fs.fsyncSync(ownerFd); syncDir(lockPath); syncDir(base);
  const binding = { base,baseIdentity,lockPath,lockIdentity,managedMemory,bytes,operation,ownerPath, ownerFd, identity: identity(fs.fstatSync(ownerFd, { bigint: true })), digest: hash(bytes), closed: false };
  const assertOwned = () => {
    if (binding.closed || !equal(identity(stat(base)), baseIdentity) || !equal(identity(stat(lockPath)), lockIdentity)) fail();
    const current = readRegular(ownerPath, 4096), held = fs.fstatSync(ownerFd, { bigint: true });
    if (!equal(current.identity, binding.identity) || !equal(identity(held), binding.identity) || current.digest !== binding.digest) fail();
  };
  const guard = Object.freeze({ base, assertOwned, release() {
    assertOwned();
    if (!equal(fs.readdirSync(lockPath), ['owner.json']))throw new Error('Operation lock contains unknown files; explicit verified recovery is required.');
    fs.unlinkSync(ownerPath); fs.rmdirSync(lockPath); syncDir(base);
    binding.closed = true; revokeManagedMemoryAccountGuard(guard);fs.closeSync(ownerFd);
  } });
  registry().operations.set(guard, binding); return guard;
}
/** Inspection never mints an operation identity. */
export function inspectFileRuntimeOperationGuard(guard) {
  checkOperation(guard); const b=registry().operations.get(guard);
  return {base:b.base,baseIdentity:b.baseIdentity,directoryIdentity:b.lockIdentity,ownerIdentity:b.identity,digest:b.digest,
    record:JSON.parse(b.bytes),operation:b.operation};
}
export function createMaintenanceAuthorization(operationGuard) {
  checkOperation(operationGuard);
  const token = Object.freeze({}); registry().authorizations.set(token, operationGuard); return token;
}
function checkOperation(guard) {
  const binding = registry().operations.get(guard); if (!binding || binding.closed) fail();
  trusted(() => guard.assertOwned());
  const current = readRegular(binding.ownerPath, 4096), held = fs.fstatSync(binding.ownerFd, { bigint: true });
  if (!equal(identity(held), binding.identity) || !equal(current.identity, binding.identity) || current.digest !== binding.digest) fail();
}
function checkAuthorization(token) { const guard = registry().authorizations.get(token); if (!guard) fail(); checkOperation(guard); }
export function assertMaintenanceAuthorization(dataRoot,authorization,owner) {
  checkAuthorization(authorization);const e=details(owner);
  if(e.root!==pathString(dataRoot)||e.role!=='maintenance'||e.authorization!==authorization)fail();
  assertEntry(e);active(e);
}
function trusted(fn) { if (!fn) return; if (typeof fn !== 'function' || fn.constructor.name === 'AsyncFunction') fail(); const result = fn(); if (result && (typeof result === 'object' || typeof result === 'function') && typeof result.then === 'function') fail(); }
export function acquireFileRuntimeOwner({ dataRoot, release: r, role = 'runtime', authorization } = {}) {
  r = release(r); if (!['runtime', 'maintenance'].includes(role)) fail();
  if (role === 'maintenance') checkAuthorization(authorization);
  const { root, info } = privateRoot(dataRoot, true), reg = registry(), old = reg.roots.get(root);
  if (old) {
    if (old.state === 'active' && old.role === role && equal(old.record.release, r) && (role !== 'maintenance' || old.authorization === authorization)) { assertEntry(old); return old.capability; }
    if (!(role === 'maintenance' && old.role === 'maintenance' && old.state === 'closed' && old.authorization === authorization)) fail();
  }
  const rootFd = fs.openSync(root, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let fd;
  try { fd = fs.openSync(join(root, FILE_RUNTIME_OWNER_GUARD), fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o600); }
  catch { fs.closeSync(rootFd); fail(); }
  const entry = { root, rootFd, fd, rootIdentity: identity(info), role, authorization, state: 'active', controller: new AbortController(), listeners: new Set() };
  reg.roots.set(root, entry);
  try {
    entry.record = { version: 1, kind: 'studio-file-runtime-owner', role, nonce: randomBytes(32).toString('hex'), pid: process.pid, startedAt: Date.now(), release: r };
    entry.bytes = JSON.stringify(entry.record) + '\n'; if (Buffer.byteLength(entry.bytes) > 2048) fail();
    fs.writeFileSync(fd, entry.bytes); fs.fsyncSync(fd); syncDir(root);
    const initial=fs.fstatSync(fd,{bigint:true});entry.guardIdentity = identity(initial);entry.guardMetadata={ctime:initial.ctimeNs,mtime:initial.mtimeNs,size:initial.size}; entry.digest = hash(entry.bytes);
    const cap = Object.freeze({ root, signal: entry.controller.signal, get state() { return entry.state; },
      assertCurrent() { assertEntry(details(cap)); }, assertActive() { active(details(cap)); },
      beginDrain() { terminate(details(cap), 'draining'); },
      onDrain(callback) { const e = details(cap); if (typeof callback !== 'function') fail(); if (e.state !== 'active') { void Promise.resolve(callback()).catch(() => undefined); return () => {}; } e.listeners.add(callback); return () => e.listeners.delete(callback); },
      snapshot() { assertEntry(details(cap)); return { root, rootIdentity: { ...entry.rootIdentity }, guardIdentity: { ...entry.guardIdentity }, digest: entry.digest, record: structuredClone(entry.record) }; },
    });
    entry.capability = cap; reg.owners.set(cap, entry);
    assertEntry(entry);
    if (stat(markerPath(root))) entry.marker = assertMarker(root);
    return cap;
  } catch { entry.state = 'lost'; entry.controller.abort(); fail(); }
}
export function installFileRuntimeOwnerMarker(owner) {
  const e = details(owner); if (e.role !== 'runtime') fail(); assertEntry(e);
  const adaptive = join(e.root, 'adaptive');
  if (stat(`${adaptive}.managed`)) fail();
  if (!stat(adaptive)) fs.mkdirSync(adaptive, { mode: 0o700 });
  checkComponents(adaptive); if (!stat(adaptive)?.isDirectory()) fail();
  const p = markerPath(e.root); let fd;
  try { fd = fs.openSync(p, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (fd !== undefined) { try { fs.writeFileSync(fd, FILE_RUNTIME_OWNER_MARKER_BYTES); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
  else { const existing = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); try { fs.fsyncSync(existing); } finally { fs.closeSync(existing); } }
  syncDir(adaptive); syncDir(e.root); e.marker = assertMarker(e.root); assertEntry(e);
}
export function inspectFileRuntimeOwner(dataRoot) {
  try {
  const { root, info } = privateRoot(dataRoot), p = join(root, FILE_RUNTIME_OWNER_GUARD);
  if (!stat(p)) return null;
  const read = readRegular(p, 2048), record = parseRecord(read.text);
  if (stat(markerPath(root))) assertMarker(root);
  return { root, rootIdentity: identity(info), guardIdentity: read.identity, digest: read.digest, record };
  } catch { fail(); }
}
export function retireStoppedFileRuntimeOwner({ dataRoot, expected, authorization, assertStopped }) {
  checkAuthorization(authorization); trusted(assertStopped);
  const actual = inspectFileRuntimeOwner(dataRoot); if (!actual || actual.record.pid === process.pid || !equal(actual, expected)) fail();
  checkAuthorization(authorization); trusted(assertStopped);
  if (!equal(inspectFileRuntimeOwner(dataRoot), expected)) fail();
  fs.unlinkSync(join(actual.root, FILE_RUNTIME_OWNER_GUARD)); syncDir(actual.root);
}
export function releaseMaintenanceFileRuntimeOwner(owner, authorization) {
  const e = details(owner); if (e.role !== 'maintenance' || e.authorization !== authorization) fail();
  checkAuthorization(authorization); assertEntry(e);
  fs.unlinkSync(join(e.root, FILE_RUNTIME_OWNER_GUARD)); syncDir(e.root); e.state = 'closed'; e.controller.abort(); fs.closeSync(e.fd); fs.closeSync(e.rootFd);
}
export function assertFileRuntimePath(path) {
  const p = pathString(path); if (!p) return;
  const reg = registry();
  for (const current of ancestors(p)) {
    const known = reg.roots.get(current);
    if (known) { assertEntry(known); return known.capability; }
    let guard; try { guard = stat(join(current, FILE_RUNTIME_OWNER_GUARD)); } catch (error) { if (error.code !== 'ENOTDIR') throw error; }
    let marker; try { marker = stat(markerPath(current)); } catch (error) { if (error.code !== 'ENOTDIR') throw error; }
    if (guard || marker) fail();
  }
}
export function commitFileRuntimeRename(source, destination, beforeCommit) {
  const owner = assertFileRuntimePath(destination), sourceOwner = assertFileRuntimePath(source); if (owner !== sourceOwner) fail();
  trusted(beforeCommit); owner?.assertActive();
  fs.renameSync(source, destination); moveTransient(source, destination);
}
export function prepareFileRuntimeTransient(path) {
  const owner=assertFileRuntimePath(path), value=pathString(path), parent=dirname(value);
  if(stat(value)){const error=new Error('Studio temporary path already exists');error.code='EEXIST';throw error;}
  registry().intents.set(value,{owner,parentIdentity:identity(stat(parent)),rootIdentity:owner?details(owner).rootIdentity:undefined});
}
export function createFileRuntimeTransientDirectory(path) {
  prepareFileRuntimeTransient(path); fs.mkdirSync(path,{mode:0o700}); remember(path);
}
function remember(p) {
  const value=pathString(p); if(!value)return;
  const reg=registry(), parent=dirname(value), intent=reg.intents.get(value), parentTransient=reg.transient.get(parent);
  if(!intent&&!parentTransient)return;
  const provenance=intent??{owner:parentTransient.owner,parentIdentity:identity(stat(parent)),rootIdentity:parentTransient.rootIdentity};
  const actual=stat(value), parentNow=stat(parent);
  if(!actual||!parentNow||!equal(identity(parentNow),provenance.parentIdentity))fail();
  reg.transient.set(value,{identity:identity(actual),...provenance});reg.intents.delete(value);
}
function moveTransient(from,to){
  const a=pathString(from),b=pathString(to),reg=registry();
  for(const [name,entry]of [...reg.transient])if(name===a||name.startsWith(`${a}/`)){
    reg.transient.delete(name);
    // Only a staged lock remains transient after publication; canonical data never does.
    if(/\.lock$/.test(b))reg.transient.set(b+name.slice(a.length),entry);
  }
  reg.intents.delete(a);
}
function sameTransient(value,expected){
  if(!expected)return false;
  const parent=stat(dirname(value)),actual=stat(value);
  if(!parent||!equal(identity(parent),expected.parentIdentity)||actual&&!equal(identity(actual),expected.identity))return false;
  if(expected.owner){const e=details(expected.owner),root=stat(e.root),held=fs.fstatSync(e.rootFd,{bigint:true});if(!root||!equal(identity(root),expected.rootIdentity)||!equal(identity(held),expected.rootIdentity))return false;}
  checkComponents(dirname(value));return true;
}
function cleanup(p,directory=false,recursive=false){
  const value=pathString(p),reg=registry(),expected=reg.transient.get(value);
  if(!sameTransient(value,expected))return false;
  if(stat(value)){
    if(directory&&recursive){
      const ordered=[];let count=0;
      const visit=current=>{if(++count>50000)fail();const proof=reg.transient.get(current),info=stat(current);if(!sameTransient(current,proof)||!info||info.isSymbolicLink())fail();if(info.isDirectory())for(const name of fs.readdirSync(current))visit(join(current,name));ordered.push([current,info.isDirectory()]);};
      visit(value);
      for(const [current,isDirectory]of ordered){if(!sameTransient(current,reg.transient.get(current)))fail();if(isDirectory)fs.rmdirSync(current);else fs.unlinkSync(current);reg.transient.delete(current);}
    }else if(directory)fs.rmdirSync(value);else fs.unlinkSync(value);
  }
  reg.transient.delete(value);return true;
}
function guardedDelete(p, fn, directory = false, recursive = false) {
  try { assertFileRuntimePath(p); } catch (error) { if (cleanup(p, directory, recursive)) return; throw error; }
  const value=pathString(p);
  try{const result=fn();for(const key of [...registry().transient.keys()])if(key===value||directory&&key.startsWith(`${value}/`))registry().transient.delete(key);return result;}finally{registry().intents.delete(value);}
}
const syncOverrides = {
  existsSync(p) { try { assertFileRuntimePath(p); } catch(error) { const value=pathString(p), expected=registry().transient.get(value), actual=stat(value);if(!sameTransient(value,expected))throw error;return !!actual; } return fs.existsSync(p); },
  readFileSync(p, ...args) { assertFileRuntimePath(p); return fs.readFileSync(p, ...args); },
  readdirSync(p, ...args) { assertFileRuntimePath(p); return fs.readdirSync(p, ...args); },
  mkdirSync(p, ...args) { assertFileRuntimePath(p); const result = fs.mkdirSync(p, ...args); remember(p); return result; },
  openSync(p, ...args) { assertFileRuntimePath(p); const fd = fs.openSync(p, ...args); registry().fds.set(fd, {path:pathString(p),identity:identity(fs.fstatSync(fd,{bigint:true}))}); if (args[0] === 'wx' || typeof args[0] === 'number' && (args[0] & fs.constants.O_EXCL)) remember(p); return fd; },
  closeSync(fd) { registry().fds.delete(fd); return fs.closeSync(fd); },
  writeFileSync(p, ...args) { if(typeof p==='number')fail();assertFileRuntimePath(p); const result = fs.writeFileSync(p, ...args); remember(p); return result; },
  appendFileSync(p, ...args) { if(typeof p==='number')fail();assertFileRuntimePath(p); return fs.appendFileSync(p, ...args); },
  renameSync(a, b) { return commitFileRuntimeRename(a, b); },
  unlinkSync(p) { return guardedDelete(p, () => fs.unlinkSync(p)); },
  rmdirSync(p, ...args) { return guardedDelete(p, () => fs.rmdirSync(p, ...args), true); },
  rmSync(p, ...args) { return guardedDelete(p, () => fs.rmSync(p, ...args), stat(pathString(p))?.isDirectory(),args[0]?.recursive===true); },
  writeSync(){fail();},writevSync(){fail();},ftruncateSync(){fail();},fchmodSync(){fail();},fchownSync(){fail();},futimesSync(){fail();},
  chmodSync(p, ...args) { assertFileRuntimePath(p); return fs.chmodSync(p, ...args); },
};
// Unused callback/stream/copy APIs are not silently advertised as guarded live writers.
const unsupportedLiveSync={};
for(const name of ['readFile','readdir','opendir','read','readv','write','writev','ftruncate','fchmod','fchown','futimes','writeFile','appendFile','rename','unlink','rm','rmdir','mkdir','open','copyFile','copyFileSync','cp','cpSync','link','linkSync','symlink','symlinkSync','truncate','truncateSync','chmod','chown','chownSync','lchown','lchownSync','lchmod','lchmodSync','utimes','utimesSync','lutimes','lutimesSync','createReadStream','createWriteStream','watch','watchFile'])if(typeof fs[name]==='function')unsupportedLiveSync[name]=(path,...args)=>{if(typeof path==='number'||assertFileRuntimePath(path)||['copyFile','copyFileSync','cp','cpSync','link','linkSync','symlink','symlinkSync','rename'].includes(name)&&assertFileRuntimePath(args[0]))fail();return fs[name](path,...args);};
export const fileRuntimeFs = Object.freeze({ ...fs, ...unsupportedLiveSync, ...syncOverrides,
  readSync(fd,...args){assertFileRuntimePath(fd);return fs.readSync(fd,...args);},
  readvSync(fd,...args){assertFileRuntimePath(fd);return fs.readvSync(fd,...args);},
 get promises(){return fileRuntimePromises;} });
/** Any access that can mutate must open in the same synchronous owner turn. */
function mutatingOpen(flags){
  if(flags===undefined||typeof flags==='string'&&['r','rs','sr'].includes(flags))return false;
  if(typeof flags==='number')return (flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_APPEND))!==0;
  return true;
}
function synchronousFileHandle(fd){
  let handleFd=fd;
  return {
    get fd(){return handleFd;},
    async close(){if(handleFd<0)return;const current=handleFd;handleFd=-1;fs.closeSync(current);},
    async stat(options){return fs.fstatSync(handleFd,options);},
    async readFile(options){return fs.readFileSync(handleFd,options);},
    async read(buffer,offset,length,position){
      if(buffer===undefined){buffer=Buffer.alloc(16384);offset=0;length=buffer.byteLength;position=null;}
      else if(!ArrayBuffer.isView(buffer)){
        const options=buffer;buffer=options.buffer??Buffer.alloc(16384);offset=options.offset??0;length=options.length??buffer.byteLength-offset;position=options.position??null;
      }else if(offset&&typeof offset==='object'){
        const options=offset;offset=options.offset??0;length=options.length??buffer.byteLength-offset;position=options.position??null;
      }
      const bytesRead=fs.readSync(handleFd,buffer,offset??0,length??buffer.byteLength-(offset??0),position??null);
      return {bytesRead,buffer};
    },
    async readv(buffers,position){const bytesRead=fs.readvSync(handleFd,buffers,position);return {bytesRead,buffers};},
  };
}
const unsupportedLivePromises={};
for(const name of ['copyFile','cp','link','symlink','truncate','chown','lchown','lchmod','utimes','lutimes','watch'])if(typeof fsp[name]==='function')unsupportedLivePromises[name]=async(path,...args)=>{if(assertFileRuntimePath(path)||['copyFile','cp','link','symlink'].includes(name)&&assertFileRuntimePath(args[0]))fail();return fsp[name](path,...args);};
export const fileRuntimePromises = Object.freeze({ ...fsp,...unsupportedLivePromises,
  async readFile(p, ...args) { assertFileRuntimePath(p); const value = await fsp.readFile(p, ...args); assertFileRuntimePath(p); return value; },
  async readdir(p, ...args) { assertFileRuntimePath(p); const value = await fsp.readdir(p, ...args); assertFileRuntimePath(p); return value; },
  async opendir(p, ...args) { assertFileRuntimePath(p); const value = await fsp.opendir(p, ...args); try { assertFileRuntimePath(p); return value; } catch (error) { await value.close(); throw error; } },
  async mkdir(p, ...args) { assertFileRuntimePath(p); const value = fs.mkdirSync(p, ...args); remember(p); return value; },
  async open(p, ...args) {
    const ownerAtOpen=assertFileRuntimePath(p);
    let value;
    if(mutatingOpen(args[0])){
      ownerAtOpen?.assertActive();
      // No await, callback or authority I/O separates the guard and mutating open.
      value=synchronousFileHandle(fs.openSync(p,...args));
    }else value=await fsp.open(p,...args);
    if (args[0] === 'wx' || typeof args[0] === 'number' && (args[0] & fs.constants.O_EXCL)) remember(p);
    let closed=false;
    const openedFd=value.fd, expected = identity(fs.fstatSync(openedFd, { bigint: true }));
    registry().fds.set(openedFd,{path:pathString(p),identity:expected});
    const check = () => { if(closed||assertFileRuntimePath(p)!==ownerAtOpen)fail(); const named = stat(pathString(p)), held = fs.fstatSync(value.fd, { bigint: true }); if (!named || !equal(identity(named), expected) || !equal(identity(held), expected)) fail(); };
    try { check(); } catch (error) { registry().fds.delete(openedFd);await value.close(); throw error; }
    return new Proxy(value, { get(target, key) {
      if (key === 'close' || key === Symbol.asyncDispose) return async () => { if(closed)return;closed=true;const bound=registry().fds.get(openedFd); if(bound && equal(bound.identity,expected))registry().fds.delete(openedFd); return target.close(); };
      if (key === 'createWriteStream' || key === 'createReadStream' || key === 'readLines') return () => fail();
      if (key === 'write') return async (...values) => { check(); const bytesWritten=fs.writeSync(target.fd,...values); return {bytesWritten,buffer:values[0]}; };
      if (key === 'writev') return async (buffers,position) => { check(); const bytesWritten=fs.writevSync(target.fd,buffers,position); return {bytesWritten,buffers}; };
      if (key === 'appendFile') return async (...values) => { check(); fs.appendFileSync(target.fd,...values); };
      if (key === 'chmod') return async mode => { check(); fs.fchmodSync(target.fd,mode); };
      if (key === 'chown') return async (user,group) => { check(); fs.fchownSync(target.fd,user,group); };
      if (key === 'utimes') return async (atime,mtime) => { check(); fs.futimesSync(target.fd,atime,mtime); };
      if (key === 'writeFile') return async (...values) => { check(); fs.writeFileSync(target.fd, ...values); };
      if (key === 'sync') return async () => { check(); fs.fsyncSync(target.fd); };
      if (key === 'datasync') return async () => { check(); fs.fdatasyncSync(target.fd); };
      if (key === 'truncate') return async length => { check(); fs.ftruncateSync(target.fd, length); };
      const member = Reflect.get(target, key, target);
      if (typeof member !== 'function') return member;
      return async (...values) => { check(); const result = await member.apply(target, values); check(); return result; };
    } });
  },
  async writeFile(p, ...args) { return syncOverrides.writeFileSync(p, ...args); },
  async appendFile(p, ...args) { return syncOverrides.appendFileSync(p, ...args); },
  async rename(a, b) { return syncOverrides.renameSync(a, b); },
  async unlink(p) { return syncOverrides.unlinkSync(p); },
  async rmdir(p, ...args) { return syncOverrides.rmdirSync(p, ...args); },
  async chmod(p, ...args) { return syncOverrides.chmodSync(p, ...args); },
  async rm(p, ...args) { return syncOverrides.rmSync(p, ...args); },
});

/** Explicit temp fixture provenance; never grants ownership or selects by environment. */
export function registerFileRuntimeFixture({ dataRoot, artifactRoot, release: input }) {
  const r=release(input),{root}=privateRoot(dataRoot),artifact=pathString(artifactRoot);
  if(!/^\/(?:private\/)?tmp\//.test(root)||!/^\/(?:private\/)?tmp\//.test(artifact)||root===artifact||dirname(root)!==dirname(artifact)||registry().roots.has(root))fail();
  checkComponents(artifact);
  if(!stat(join(artifact,'server.js'))?.isFile()||fs.readFileSync(join(artifact,'.next','BUILD_ID'),'utf8').trim()!==r.buildId)fail();
  const rootIdentity=identity(stat(root)),artifactIdentity=identity(stat(artifact));
  const receiptPath=join(dirname(root),'file-runtime-owner-fixture-v1.json');let receipt;
  if(stat(receiptPath)){
    receipt=readRegular(receiptPath,4096);const value=JSON.parse(receipt.text);
    if(!value||Object.keys(value).sort().join()!=='artifact,artifactIdentity,buildId,fixtureId,kind,metadataSource,providerBlocking,revision,root,rootIdentity,sourceRoot,sourceTree,version'||value.version!==1||value.kind!=='studio-file-runtime-fixture'||!/^([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/.test(value.fixtureId)||value.providerBlocking!==true||value.metadataSource!=='next-build-source-binding'||pathString(value.root)!==root||pathString(value.artifact)!==artifact||!equal(value.rootIdentity,rootIdentity)||!equal(value.artifactIdentity,artifactIdentity)||!equal(release({revision:value.revision,sourceTree:value.sourceTree,buildId:value.buildId}),r))fail();
    const source=pathString(value.sourceRoot);checkComponents(source);
    if(fs.readFileSync(join(source,'.next','BUILD_ID'),'utf8').trim()!==r.buildId)fail();
  }else if(stat(markerPath(root)))fail();
  if(stat(markerPath(root)))assertMarker(root);
  // A receipt-bound contender or maintenance recovery process may reach real
  // exclusive acquisition. Registration grants no owner capability or registry
  // root entry; an existing holder still requires actual guarded recovery.
  const holder=inspectFileRuntimeOwner(root);
  if(holder&&(!receipt||!['runtime','maintenance'].includes(holder.record.role)||holder.root!==root||!equal(holder.rootIdentity,rootIdentity)||!equal(holder.record.release,r)))fail();
  registry().fixtures.set(root,{artifact,release:r,rootIdentity,artifactIdentity,receipt:receipt?{path:receiptPath,identity:receipt.identity,digest:receipt.digest}:undefined});
}
/** A fixture receipt is provenance for isolated qualification, never approval of production. */
export function assertFileRuntimeFixture(dataRoot) {
  // Reject unregistered roots before touching any live filesystem path.
  if(typeof dataRoot!=='string'||!isAbsolute(dataRoot))fail();
  let candidate=resolve(dataRoot),registered=registry().fixtures.get(candidate);
  if(!registered&&candidate.startsWith('/tmp/')){candidate=`/private${candidate}`;registered=registry().fixtures.get(candidate);}
  if(!registered||!/^\/(?:private\/)?tmp\//.test(candidate))fail();
  const {root}=privateRoot(candidate),f=registered;
  if(!f?.receipt||!/^\/(?:private\/)?tmp\//.test(root)||!/^\/(?:private\/)?tmp\//.test(f.artifact)||dirname(root)!==dirname(f.artifact)||
    !equal(identity(stat(root)),f.rootIdentity)||!equal(identity(stat(f.artifact)),f.artifactIdentity))fail();
  const receipt=readRegular(f.receipt.path,4096),value=JSON.parse(receipt.text);
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/.test(value.fixtureId)||receipt.digest!==f.receipt.digest||!equal(receipt.identity,f.receipt.identity)||value.providerBlocking!==true||value.metadataSource!=='next-build-source-binding')fail();
  if(fs.readFileSync(join(pathString(value.sourceRoot),'.next','BUILD_ID'),'utf8').trim()!==f.release.buildId)fail();
}
export function fileRuntimeFixtureProvenance(dataRoot) {
  assertFileRuntimeFixture(dataRoot);const f=registry().fixtures.get(pathString(dataRoot)),r=readRegular(f.receipt.path,4096),value=JSON.parse(r.text);
  return {fixtureId:value.fixtureId,receiptDigest:r.digest,parent:dirname(pathString(dataRoot))};
}
/** Isolated real launchd fixture topology; no caller-selected label/port/preload. */
export function fileRuntimeFixtureSupervisor(dataRoot) {
  assertFileRuntimeFixture(dataRoot);const root=pathString(dataRoot),f=registry().fixtures.get(root),provenance=fileRuntimeFixtureProvenance(root),parent=dirname(root),base=join(parent,'base');
  privateRoot(parent);
  if(stat(join(parent,'launch-agents')))privateRoot(join(parent,'launch-agents'));
  const baseIdentity=identity(privateRoot(base).info),saved=readRegular(join(parent,'mi1-synthetic-supervisor-v1.json'),4096),v=JSON.parse(saved.text),preload=join(parent,'mi1-fixture-preload-v1.mjs'),loaded=readRegular(preload,65536);
  if(!v||Object.keys(v).sort().join()!=='artifactIdentity,baseIdentity,fixtureId,fixtureReceiptDigest,kind,preloadDigest,preloadIdentity,rootIdentity,scope,status,version'||v.version!==1||v.kind!=='mi1-synthetic-supervisor'||v.scope!=='synthetic'||v.status!=='unverified'||v.fixtureId!==provenance.fixtureId||v.fixtureReceiptDigest!==provenance.receiptDigest||!equal(v.baseIdentity,baseIdentity)||!equal(v.rootIdentity,f.rootIdentity)||!equal(v.artifactIdentity,f.artifactIdentity)||!equal(v.preloadIdentity,loaded.identity)||v.preloadDigest!==loaded.digest||saved.text!==JSON.stringify(v)+'\n'||(saved.stat.mode&0o777n)!==0o600n||(loaded.stat.mode&0o777n)!==0o600n)fail();
  const label=`io.ludaxis.vox-studio.fixture.${provenance.fixtureId}`,port=49152+(parseInt(provenance.fixtureId.slice(0,4),16)%16384);
  return {scope:'synthetic',fixtureId:provenance.fixtureId,parent,base,dataRoot:root,artifact:f.artifact,label,port,plist:join(parent,'launch-agents',`${label}.plist`),preload,preloadIdentity:loaded.identity,preloadDigest:loaded.digest};
}
/** Controller provenance is a registered current preflight, not a caller path. */
export function registerFileRuntimeManagedArtifact(binding) {
  const p=readManagedMemoryAccountPreflight(binding),reg=registry();
  reg.managedArtifacts??=new Map();reg.managedArtifacts.set(p.dataRoot,{artifact:p.artifact,release:p.release,artifactIdentity:p.artifactIdentity,digest:p.artifactDigest});
}
export function fileRuntimeArtifactDigest(dataRoot) {
  const {root}=privateRoot(dataRoot),reg=registry(),fixture=reg.fixtures.get(root),managed=reg.managedArtifacts?.get(root);
  let artifact,r,pinned;
  if(fixture){assertFileRuntimeFixture(root);artifact=fixture.artifact;r=fixture.release;pinned=fixture.artifactIdentity;}
  else if(managed){artifact=managed.artifact;r=managed.release;pinned=managed.artifactIdentity;}
  else {const entry=pathString(process.argv[1]);if(!entry?.endsWith('/server.js')||pathString(process.cwd())!==dirname(entry))fail();artifact=dirname(entry);r=resolveFileRuntimeRelease(root);pinned=identity(stat(artifact));}
  checkComponents(artifact);if(!equal(identity(stat(artifact)),pinned))fail();
  const manifest=readRegular(join(artifact,'studio-release.json'),65536,false),value=JSON.parse(manifest.text);
  if(!equal(release({revision:value.revision,sourceTree:value.sourceTree,buildId:value.buildId}),r)||
    readRegular(join(artifact,'.next','BUILD_ID'),256,false).text.trim()!==r.buildId||managed&&manifest.digest!==managed.digest)fail();
  readManagedMemoryAccountArtifact(artifact,value);
  const owner=reg.roots.get(root);if(owner&&!equal(owner.record.release,r))fail();
  return manifest.digest;
}
export function resolveFileRuntimeRelease(dataRoot) {
  // Resolution is read-only. Acquisition alone creates a missing final directory.
  const { root } = privateRoot(dataRoot, false, true), fixture = registry().fixtures.get(root);
  if (fixture) {
    if (!equal(identity(stat(root)), fixture.rootIdentity) || !equal(identity(stat(fixture.artifact)), fixture.artifactIdentity)) fail();
    if(fixture.receipt){const actual=readRegular(fixture.receipt.path,4096);if(!equal(actual.identity,fixture.receipt.identity)||actual.digest!==fixture.receipt.digest)fail();}
    return structuredClone(fixture.release);
  }
  const entry = pathString(process.argv[1]);
  if (!entry || !entry.endsWith('/server.js')) fail();
  const artifact = dirname(entry); checkComponents(entry);
  if (pathString(process.cwd()) !== artifact) fail();
  const revision = readRegular(join(artifact, 'revision'), 128, false).text.trim();
  const manifest = JSON.parse(readRegular(join(artifact, 'studio-release.json'), 65536, false).text);
  const buildId = readRegular(join(artifact, '.next', 'BUILD_ID'), 256, false).text.trim();
  const r = release({ revision, sourceTree: manifest.sourceTree, buildId });
  if (manifest.revision !== r.revision || manifest.buildId !== buildId || process.env.STUDIO_REVISION && process.env.STUDIO_REVISION !== revision) fail();
  return r;
}

/** Legacy source/dev admission only; this never grants FRO1 ownership authority. */
export function isUnmarkedFileRuntimeSource(dataRoot) {
  const root = pathString(dataRoot), reg = globalThis[SLOT] ? registry() : undefined;
  const entry = typeof process.argv[1] === 'string' ? pathString(process.argv[1]) : undefined;
  if (process.env.NODE_ENV === 'production' || entry?.endsWith('/server.js') || reg?.fixtures.has(root)) return false;
  // Do not follow an alias into an owned tree or infer absence through a bad path.
  checkComponents(root, true);
  for (const current of ancestors(root)) {
    if (reg?.roots.has(current)) fail();
    let guard, marker;
    try { guard = stat(join(current, FILE_RUNTIME_OWNER_GUARD)); } catch (error) { if (error.code !== 'ENOTDIR') throw error; }
    try { marker = stat(markerPath(current)); } catch (error) { if (error.code !== 'ENOTDIR') throw error; }
    if (guard || marker) fail();
  }
  return true;
}

export function publishFileRuntimeTransientTree(path){
  const value=pathString(path),reg=registry();
  for(const name of [...reg.transient.keys()])if(name===value||name.startsWith(`${value}/`))reg.transient.delete(name);
  for(const name of [...reg.intents.keys()])if(name===value||name.startsWith(`${value}/`))reg.intents.delete(name);
}

/** Opaque synchronous staging descriptor. Integer values are never writer authority. */
export function openFileRuntimeDescriptor(path,flags,mode){
  const owner=assertFileRuntimePath(path), fd=fs.openSync(path,flags,mode), expected=identity(fs.fstatSync(fd,{bigint:true}));let closed=false;
  remember(path);
  const check=()=>{if(closed||assertFileRuntimePath(path)!==owner)fail();const current=stat(pathString(path)),held=fs.fstatSync(fd,{bigint:true});if(!current||!equal(identity(current),expected)||!equal(identity(held),expected))fail();};
  return Object.freeze({writeFile(data,options){check();fs.writeFileSync(fd,data,options);},sync(){check();fs.fsyncSync(fd);},close(){if(closed)return;closed=true;if(!equal(identity(fs.fstatSync(fd,{bigint:true})),expected))fail();fs.closeSync(fd);}});
}
