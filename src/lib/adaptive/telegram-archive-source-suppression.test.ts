import { describe, expect, it } from 'vitest';
import { resetTelegramArchives, suppressTelegramArchiveSource, telegramArchiveEntrySchema, type TelegramArchiveEntry } from './telegram-archive-state';

function row(): TelegramArchiveEntry {
  const event = (n: number, logicalId = `telegram:${n}`) => ({eventId:`update:${n}`,logicalId,revision:n,
    occurredAt:100,receivedAt:100,expiresAt:10000,role:'user' as const,text:`SYNTHETIC_${n}`});
  const events=[event(1),event(2,'telegram:1'),event(3)];
  return {agentId:'agent',space:'work',enabled:true,generation:1,clearedAt:0,index:events,
    state:{schemaVersion:1,scope:{accountId:'telegram-account:42',personId:'p',agentId:'agent',space:'work',containerId:'c'},botId:7,revision:1,
      pending:events,receipts:events.map(e=>({eventId:e.eventId,logicalId:e.logicalId,sourceRevision:e.revision,fingerprint:'a'.repeat(64)})),
      head:{fileId:'head',digest:'b'.repeat(64),messageId:99,sequence:1}}};
}
describe('bounded source suppression author checks',()=>{
  it('tombstones every accepted revision, retains other sources and is idempotent',()=>{
    const value=row(),head=structuredClone(value.state!.head),clearedAt=value.clearedAt;
    expect(suppressTelegramArchiveSource(value,'telegram:1')).toBe(true);
    expect(value.state!.receipts.map(r=>r.suppressed)).toEqual([true,true,undefined]);
    expect(value.state!.pending.map(e=>e.logicalId)).toEqual(['telegram:3']);
    expect(value.index.map(e=>e.logicalId)).toEqual(['telegram:3']);
    expect(value.state!.head).toEqual(head);expect(value.clearedAt).toBe(clearedAt);
    const once=structuredClone(value);expect(suppressTelegramArchiveSource(value,'telegram:1')).toBe(true);expect(value).toEqual(once);
    expect(telegramArchiveEntrySchema.parse(value)).toEqual(value);
  });
  it('does not invent lineage for unknown sources',()=>{
    const value=row(),before=structuredClone(value);expect(suppressTelegramArchiveSource(value,'telegram:999')).toBe(false);expect(value).toEqual(before);
  });
  it.each(['prepared','bundle_sending','bundle_verified','manifest_sending','unknown'] as const)('preserves uncertain effect metadata for %s operations',stage=>{
    const value=row();value.state!.operation={id:'operation',sequence:2,authorityRevision:'old',eventIds:['update:1','update:2'],stage,createdAt:100};
    suppressTelegramArchiveSource(value,'telegram:1');
    if(stage==='prepared') expect(value.state!.operation).toBeUndefined();
    else expect(value.state!.operation).toMatchObject({id:'operation',stage:'unknown',eventIds:['update:1','update:2']});
  });
  it('requires the explicit reader marker while leaving legacy rows valid',()=>{
    const value=row();expect(telegramArchiveEntrySchema.safeParse(value).success).toBe(true);
    value.state!.receipts[0].suppressed=true;expect(telegramArchiveEntrySchema.safeParse(value).success).toBe(false);
    value.sourceSuppressionVersion=1;expect(telegramArchiveEntrySchema.safeParse(value).success).toBe(true);
    expect(telegramArchiveEntrySchema.safeParse({...value,sourceSuppressionVersion:2}).success).toBe(false);
  });
  it('removes tombstones only together with the head and pending source lineage behind a new time barrier',()=>{
    const value=row();suppressTelegramArchiveSource(value,'telegram:1');resetTelegramArchives({telegramArchives:[value]},500,'work','agent');
    expect(value.state).toBeUndefined();expect(value.sourceSuppressionVersion).toBeUndefined();expect(value.index).toEqual([]);expect(value.clearedAt).toBe(500);
  });
});
