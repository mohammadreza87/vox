/** The ESM protocol is shared with the installed Node release controller. Pure on import. */
import { acquireFileRuntimeOwner, installFileRuntimeOwnerMarker, isUnmarkedFileRuntimeSource, resolveFileRuntimeRelease, type FileRuntimeOwner } from '../../../scripts/studio-file-runtime-owner.mjs';
export * from '../../../scripts/studio-file-runtime-owner.mjs';

export function ensureStudioFileRuntimeOwner(dataRoot:string,options:{requireQualified?:boolean}={}):FileRuntimeOwner|undefined {
  // Unmarked development source remains usable, outside the FRO1 proof. This
  // branch cannot admit production, a managed/fixture entry, or any owned tree.
  if(!options.requireQualified&&isUnmarkedFileRuntimeSource(dataRoot))return undefined;
  const owner=acquireFileRuntimeOwner({dataRoot,release:resolveFileRuntimeRelease(dataRoot)});
  installFileRuntimeOwnerMarker(owner);
  const hooks=globalThis as typeof globalThis & {__voxFileOwnerSignalHooks?:WeakSet<FileRuntimeOwner>};
  const registered=hooks.__voxFileOwnerSignalHooks??=new WeakSet();
  if(!registered.has(owner)){registered.add(owner);process.once('SIGTERM',()=>owner.beginDrain());process.once('SIGINT',()=>owner.beginDrain());}
  return owner;
}
