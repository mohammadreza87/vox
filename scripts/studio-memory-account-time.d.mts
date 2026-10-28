import type { FileRuntimeOwner } from './studio-file-runtime-owner.mjs';
import type { ManagedMemoryAccountPreflight } from './studio-memory-account-operation.mjs';
export interface MemoryTimeInterval {readonly nowMs:number;readonly utcLowerMs:number;readonly utcUpperMs:number}
export interface TimeRequest {version:1;nonce:string;rootBinding:string;artifactDigest:string;policyDigest:string;purpose:'initialize'|'resume'|'runtime'}
export interface UtcAssertion {version:1;requestDigest:string;providerId:string;keyId:string;utcMs:number;uncertaintyMs:number;sequence:number;issuedAtMs:number;expiresAtMs:number;signature:string}
export interface QualifiedUtcProvider {acquire(request:TimeRequest,signal:AbortSignal):Promise<UtcAssertion>}
export interface SyntheticMemoryTimePolicy {version:1;scope:'synthetic';providerId:string;keyId:string;algorithm:'Ed25519';publicKey:string;keyNotBeforeMs:number;keyNotAfterMs:number;maxUncertaintyMs:number;maxRequestElapsedMs:number;maxAssertionLifetimeMs:number;maxExtrapolationAgeMs:number;maxDriftPpm:number;maxSuspendGapMs:number;sourcePositiveSkewMs:2000;sourceQuantumMs:1000;sourceNegativeSkewMs:number|null;utcEvidenceDigest:string;sourceEvidenceDigest:string}
declare const qualified:unique symbol;
declare const preflight:unique symbol;
export interface QualifiedMemoryTime {readonly [qualified]:true;sampleNow():MemoryTimeInterval;assertCurrent():void}
export interface QualifiedMemoryPreflightTime {readonly [preflight]:true;sampleNow():MemoryTimeInterval;assertCurrent():void}
export function registerSyntheticMemoryTimePolicy(input:{dataRoot:string;policy:SyntheticMemoryTimePolicy;provider:QualifiedUtcProvider;monotonic?:()=>number;bootIdentity?:()=>string}):{readonly policyDigest:string;revoke():void};
export function acquireQualifiedMemoryTime(input:{dataRoot:string;owner:FileRuntimeOwner;artifactDigest:string;purpose:'initialize'|'resume'|'runtime';signal?:AbortSignal}):Promise<QualifiedMemoryTime>;
export function acquireQualifiedMemoryPreflightTime(input:{binding:ManagedMemoryAccountPreflight;purpose:'initialize'|'resume';signal?:AbortSignal}):Promise<QualifiedMemoryPreflightTime>;
export function assertQualifiedMemoryTime(value:QualifiedMemoryTime,input?:{dataRoot?:string;owner?:FileRuntimeOwner}):void;
export function assertQualifiedMemoryPreflightTime(value:QualifiedMemoryPreflightTime,input?:{binding?:ManagedMemoryAccountPreflight;dataRoot?:string;artifactDigest?:string}):void;
export function qualifiedMemoryTimeForRoot(dataRoot:string):QualifiedMemoryTime;
export function qualifiedMemoryClock(value:QualifiedMemoryTime):()=>number;
export function qualifiedMemoryInterval(clock:()=>number,observed:number):MemoryTimeInterval;
export function qualifiedMemoryTimePolicy(value:QualifiedMemoryTime):Readonly<SyntheticMemoryTimePolicy>;
export function qualifiedMemoryPreflightTimePolicy(value:QualifiedMemoryPreflightTime):Readonly<SyntheticMemoryTimePolicy>;
