import type { KeyObject } from 'node:crypto';
import type { FileRuntimeOwner, MaintenanceAuthorization, acquireFileRuntimeOperationGuard } from '../studio-file-runtime-owner.mjs';
import type { SyntheticMemoryTimePolicy, QualifiedMemoryTime, TimeRequest, UtcAssertion } from '../studio-memory-account-time.mjs';
export const UTC_BASE:number;
export const REAL_MANAGED_BASE:string;
export function hash(bytes:string|Uint8Array):string;
export function identity(path:string):{dev:string;ino:string;birth:string};
export function image(root:string):Array<Record<string,unknown>>;
export function signAssertion(value:Omit<UtcAssertion,'signature'>,key:KeyObject):UtcAssertion;
export function denyRealManagedIo<T>(run:(attempts:Array<{operation:string;path:string}>)=>T|Promise<T>):Promise<T>;
export interface ManagedTimeFixture {
 parent:string;base:string;dataRoot:string;directory:string;artifact:string;sourceRoot:string;
 release:{revision:string;sourceTree:string;buildId:string};manifest:Record<string,unknown>;manifestBytes:string;artifactDigest:string;
 receipt:Record<string,unknown>;receiptPath:string;owner:FileRuntimeOwner;
 guard:ReturnType<typeof acquireFileRuntimeOperationGuard>;authorization:MaintenanceAuthorization;
 keys:{publicKey:KeyObject;privateKey:KeyObject};policy:SyntheticMemoryTimePolicy;
 provider:{acquire(request:TimeRequest,signal:AbortSignal):Promise<UtcAssertion>};
 control:{offsetMs:number;manualNow:number;boot:string;sequence:number;providerCalls:number;requests:TimeRequest[];providerMode:string;
  mutate?: (value:Omit<UtcAssertion,'signature'>,request:TimeRequest)=>Omit<UtcAssertion,'signature'>|void;
  afterSign?:(value:UtcAssertion,request:TimeRequest)=>UtcAssertion|void;
  onAcquire?:(request:TimeRequest,signal:AbortSignal)=>void|Promise<void>;ownerRelease?:string};
 registration?:{readonly policyDigest:string;revoke():void};
 monotonic():number;now():number;register():{readonly policyDigest:string;revoke():void};
 acquire(extra?:{dataRoot?:string;owner?:FileRuntimeOwner;artifactDigest?:string;purpose?:'initialize'|'resume'|'runtime';signal?:AbortSignal}):Promise<QualifiedMemoryTime>;
 mark(highWaterMs?:number):void;close():void;
}
export function createManagedTimeFixture(options?:{manual?:boolean;register?:boolean;assertionLifetimeMs?:number;uncertaintyMs?:number;policy?:Partial<SyntheticMemoryTimePolicy>}):ManagedTimeFixture;
export function withManagedTimeFixture<T>(run:(fixture:ManagedTimeFixture)=>T|Promise<T>,options?:Parameters<typeof createManagedTimeFixture>[0]):Promise<T>;
