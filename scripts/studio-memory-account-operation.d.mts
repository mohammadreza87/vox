import type {FileRuntimeOwner,MaintenanceAuthorization,PathIdentity,ReleaseIdentity} from './studio-file-runtime-owner.mjs';
import type {QualifiedMemoryTime,QualifiedMemoryPreflightTime} from './studio-memory-account-time.mjs';
declare const preflight:unique symbol,operation:unique symbol;
export interface ManagedMemoryAccountPreflight {readonly [preflight]:true}
export interface ManagedMemoryAccountOperation {readonly [operation]:true}
export interface MemoryTimeSample {nowMs:number;utcLowerMs:number;utcUpperMs:number}
export interface OperationGuard {base:string;assertOwned():void;release():void}
export const MEMORY_ACCOUNT_OPERATION_FILE:string;
export const MEMORY_ACCOUNT_OPERATION_LIMIT:number;
export const MEMORY_ACCOUNT_OPERATION_RETENTION_MS:number;
export function prepareManagedMemoryAccountPreflight(input:{base:string;action:'initialize'|'resume'|'expire'|'finalize'}):Promise<ManagedMemoryAccountPreflight>;
export function readManagedMemoryAccountPreflight(binding:ManagedMemoryAccountPreflight):{dataRoot:string;artifactDigest:string;artifact:string;artifactIdentity:PathIdentity;release:ReleaseIdentity;assertCurrent():void};
export function assertManagedMemoryAccountPreflight(binding:ManagedMemoryAccountPreflight):void;
export function acquireManagedMemoryAccountOperationGuard(binding:ManagedMemoryAccountPreflight,time:QualifiedMemoryPreflightTime,qualification:SyntheticManagedMemoryAccountQualification):OperationGuard;
export function readManagedMemoryGuardToken(token:object,base:string,action:string):unknown;
export function parseManagedMemoryAccountOperation(text:string):Record<string,unknown>;
export function readManagedMemoryAccountOperationRecord(base:string):{text:string;digest:string;identity:PathIdentity;value:Record<string,unknown>}|null;
export function prepareManagedMemoryAccountJournal(input:{guard:OperationGuard;preflight:QualifiedMemoryPreflightTime}):unknown;
export function createManagedMemoryAccountOperation(input:{guard:OperationGuard;owner:FileRuntimeOwner;authorization:MaintenanceAuthorization;time:QualifiedMemoryTime;action:'initialize'|'resume'}):ManagedMemoryAccountOperation;
export function assertManagedMemoryAccountOperation(context:ManagedMemoryAccountOperation,input?:{dataRoot?:string;owner?:FileRuntimeOwner;authorization?:MaintenanceAuthorization;time?:QualifiedMemoryTime;action?:'initialize'|'resume'}):void;
export function readManagedMemoryAccountOperation(context:ManagedMemoryAccountOperation):{dataRoot:string;owner:FileRuntimeOwner;authorization:MaintenanceAuthorization;time:QualifiedMemoryTime;action:'initialize'|'resume';assertCurrent():void;checkDeadline():MemoryTimeSample;reserveTransient(row:{purpose:'time'|'marker';basename:string}):void;createdTransient(row:{purpose:'time'|'marker';basename:string;digest:string}):void;published(row:{purpose:'time'|'marker';digest:string;highWaterMs?:number}):void};
export function inspectManagedMemoryAccountRoot(operation:ManagedMemoryAccountOperation,input:{stage:'before-publication'|'before-migration'|'accounts-qualified'}):{controlDigest:string;inventoryDigest:string};
declare const qualification:unique symbol;
export interface SyntheticManagedMemoryAccountQualification {readonly [qualification]:true}
export function registerSyntheticManagedMemoryAccountQualification(input:{binding:ManagedMemoryAccountPreflight;preflight:QualifiedMemoryPreflightTime}):SyntheticManagedMemoryAccountQualification;
export function assertSyntheticManagedMemoryAccountQualification(token:SyntheticManagedMemoryAccountQualification,input:{binding:ManagedMemoryAccountPreflight;preflight:QualifiedMemoryPreflightTime}):{digest:string;policyDigest:string;scope:'synthetic';status:'unverified'};
export const MEMORY_ACCOUNT_MANAGED_HELPERS:Readonly<Record<string,string>>;
export function readManagedMemoryAccountArtifact(artifact:string,manifest:unknown,options?:{helpersDirectory?:string}):{path:string;manifest:unknown};
export function assertNoPendingMemoryAccountOperation(base:string):void;
export function markManagedMemoryAccountStarting(operation:ManagedMemoryAccountOperation):unknown;
export function finalizeManagedMemoryAccountOperation(input:{guard:OperationGuard;preflight:QualifiedMemoryPreflightTime;expectedRecord:unknown}):Promise<unknown>;
export function cancelManagedMemoryAccountOperation(input:{guard:OperationGuard;preflight:QualifiedMemoryPreflightTime}):void;
export function expireManagedMemoryAccountOperation(input:{guard:OperationGuard;owner:FileRuntimeOwner;authorization:MaintenanceAuthorization;time:QualifiedMemoryTime}):unknown;
export function assertManagedMemoryAccountStartup(input:{base:string;dataRoot:string;release:unknown;nativeQuery:(pid:number)=>unknown}):{stoppedDigest:string;terminalDigest:string}|undefined;
export function recoverManagedMemoryAccountController(binding:ManagedMemoryAccountPreflight,expected:unknown):unknown;
export function reconcileManagedMemoryAccountJournal(input:{guard:OperationGuard;owner:FileRuntimeOwner;authorization:MaintenanceAuthorization;time:QualifiedMemoryTime;preflight:QualifiedMemoryPreflightTime}):unknown;

export function registerManagedMemoryAccountDeadlineAbort(guard:OperationGuard,callback:()=>void):void;
export function managedMemoryAccountDeadlineExpired(guard:OperationGuard):boolean;
export function holdManagedMemoryAccountOperation(context:ManagedMemoryAccountOperation,reason:'cancelled'|'changed'|'time_unavailable'|'io_unknown'|'process_unproved'|'capacity'|'retention_overdue'):unknown;
export function reconcileRunningManagedMemoryAccountOperation(binding:ManagedMemoryAccountPreflight):Promise<unknown>;
export function verifyManagedMemoryAccountOperationalHealth(binding:ManagedMemoryAccountPreflight,operationDigest:string):Promise<{version:1;state:'available'}>;

export function managedMemoryAccountCleanupOnly(guard:OperationGuard):boolean;
export function revokeManagedMemoryAccountGuard(guard:OperationGuard):void;

export function assertManagedMemoryAccountExpiryDue(binding:ManagedMemoryAccountPreflight,preflight:QualifiedMemoryPreflightTime):void;
export function inspectManagedMemoryAccountPreflightTransients(input:{binding:ManagedMemoryAccountPreflight;preflight:QualifiedMemoryPreflightTime}):{snapshotDigest:string;transients:Array<{name:string;purpose:'time'|'marker';identity:PathIdentity;digest:string}>};
