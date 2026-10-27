export interface ReleaseIdentity { revision:string; sourceTree:string; buildId:string }
export interface PathIdentity {dev:string;ino:string;birth:string}
export interface OwnerSnapshot {root:string;rootIdentity:PathIdentity;guardIdentity:PathIdentity;digest:string;record:{version:1;kind:'studio-file-runtime-owner';role:'runtime'|'maintenance';nonce:string;pid:number;startedAt:number;release:ReleaseIdentity}}
declare const maintenance:unique symbol;
export interface MaintenanceAuthorization {readonly [maintenance]:true}
export interface FileRuntimeOwner {readonly root:string;readonly signal:AbortSignal;readonly state:'active'|'draining'|'lost'|'closed';assertCurrent():void;assertActive():void;beginDrain():void;onDrain(callback:()=>void|Promise<unknown>):()=>void;snapshot():OwnerSnapshot}
export const FILE_RUNTIME_OWNER_GUARD:string;
export const FILE_RUNTIME_OWNER_MARKER:string;
export const FILE_RUNTIME_OWNER_MARKER_BYTES:string;
export function acquireFileRuntimeOperationGuard(base:string,operation:string):{base:string;assertOwned():void;release():void};
export function createMaintenanceAuthorization(operationGuard:{assertOwned():void}):MaintenanceAuthorization;
export function acquireFileRuntimeOwner(input:{dataRoot:string;release:ReleaseIdentity;role?:'runtime'|'maintenance';authorization?:MaintenanceAuthorization}):FileRuntimeOwner;
export function installFileRuntimeOwnerMarker(owner:FileRuntimeOwner):void;
export function inspectFileRuntimeOwner(dataRoot:string):OwnerSnapshot|null;
export function retireStoppedFileRuntimeOwner(input:{dataRoot:string;expected:OwnerSnapshot;authorization:MaintenanceAuthorization;assertStopped:()=>void}):void;
export function releaseMaintenanceFileRuntimeOwner(owner:FileRuntimeOwner,authorization:MaintenanceAuthorization):void;
export function assertFileRuntimePath(path:import('node:fs').PathLike|number):FileRuntimeOwner|undefined;
export function commitFileRuntimeRename(source:string,destination:string,beforeCommit?:()=>void):void;
export const fileRuntimeFs:typeof import('node:fs');
export const fileRuntimePromises:typeof import('node:fs/promises');

export function registerFileRuntimeFixture(input:{dataRoot:string;artifactRoot:string;release:ReleaseIdentity}):void;
export function resolveFileRuntimeRelease(dataRoot:string):ReleaseIdentity;
/** Unqualified legacy source/dev admission; throws on any known/control-marked tree. */
export function isUnmarkedFileRuntimeSource(dataRoot:string):boolean;

export function prepareFileRuntimeTransient(path:string):void;
export function createFileRuntimeTransientDirectory(path:string):void;

export function publishFileRuntimeTransientTree(path:string):void;

export interface BoundFileRuntimeDescriptor {writeFile(data:string|NodeJS.ArrayBufferView,options?:import('node:fs').WriteFileOptions):void;sync():void;close():void}
export function openFileRuntimeDescriptor(path:string,flags:string|number,mode?:number):BoundFileRuntimeDescriptor;
