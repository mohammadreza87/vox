import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { RequestedRoutineEngine, ROUTINE_LIMITS } from './index';
import type { RoutineBinding, RoutineDependencies, RoutineLedger } from './types';
import { nextDailyOccurrence } from './schedule';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
const binding: RoutineBinding = {
  memberId: 'telegram-account:123', agentId: 'marcus', telegramUserId: '123', telegramChatId: '123',
  telegramBotId: '456', tokenFingerprint: 'a'.repeat(64),
};
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-routines-')); directories.push(directory);
  let clock = new Date('2026-10-20T08:00:00Z');
  let allowed = true, enabled = true;
  const authorize = vi.fn(async () => allowed);
  const generate = vi.fn(async (input: Parameters<RoutineDependencies['generate']>[0]) => { expect(await input.isCurrent()).toBe(true); return 'Slang lesson generated for today.'; });
  const send = vi.fn(async (input: Parameters<RoutineDependencies['send']>[0]) => { expect(await input.isCurrent()).toBe(true); expect(input.isCurrentNow()).toBe(true); return { status: 'accepted' as const, messageId: '901' }; });
  const chooseTiming = vi.fn(async () => ({ action: 'send' as 'send' | 'defer' }));
  const dependencies: RoutineDependencies = { filePath: path.join(directory, 'routines.json'), authorize, authorizeNow: () => allowed, generate, send, chooseTiming, now: () => clock, enabled: () => enabled };
  const engine = new RequestedRoutineEngine(dependencies);
  const create = (extra = {}) => engine.manage(binding, { type: 'create', inboundMessageId: '1', instruction: 'Teach one new slang phrase daily', timeZone: 'Europe/Tallinn', ...extra });
  const ledger = () => JSON.parse(fs.readFileSync(dependencies.filePath, 'utf8')) as RoutineLedger;
  return { engine, dependencies, authorize, generate, send, chooseTiming, create, ledger,
    at: (value: string) => { clock = new Date(value); }, revoke: () => { allowed = false; }, disable: () => { enabled = false; } };
}

describe('daily requested routine lifecycle', () => {
  it('persists user instruction and sends fresh content over multiple days with bounded recent lessons', async () => {
    const f = fixture();
    const created = await f.create(); expect(created.routines[0].timing).toBe('adaptive');
    for (let day = 20; day < 30; day++) {
      f.at(`2026-10-${day}T08:00:00Z`);
      expect((await f.engine.tick()).accepted).toBe(1);
      expect((await f.engine.tick()).claimed).toBe(0);
    }
    expect(f.generate).toHaveBeenCalledTimes(10);
    expect(f.generate.mock.calls[9][0].recentLessons).toHaveLength(7);
    expect(f.ledger().routines[0].recentLessons).toHaveLength(7);
    expect(f.ledger().occurrences.every(item => item.status === 'accepted')).toBe(true);
    expect(fs.statSync(f.dependencies.filePath).mode & 0o777).toBe(0o600);
  });

  it('deduplicates authenticated inbound IDs, scopes lists, and does not authorize private group targets', async () => {
    const f = fixture(); const first = await f.create();
    expect((await f.create({ instruction: 'different' })).duplicate).toBe(true);
    expect(f.ledger().routines).toHaveLength(1);
    const other = await f.engine.manage({ ...binding, memberId: 'other' }, { type: 'list' }); expect(other.routines).toEqual([]);
    await expect(f.engine.manage({ ...binding, telegramChatId: '-555' }, { type: 'list' })).rejects.toThrow();
    await expect(f.engine.manage({ ...binding, memberId: 'other' }, { type: 'stop', inboundMessageId: '2', routineId: first.routines[0].id })).rejects.toThrow('routine_not_found');
  });

  it('pause/resume/update preserve ownership and stopped content cannot be resurrected', async () => {
    const f = fixture(); const id = (await f.create()).routines[0].id;
    await f.engine.manage(binding, { type: 'pause', routineId: id, inboundMessageId: '2' });
    await f.engine.manage(binding, { type: 'update', routineId: id, inboundMessageId: 'paused-edit', instruction: 'Updated while paused' });
    expect(f.ledger().routines[0].status).toBe('paused');
    expect((await f.engine.tick()).claimed).toBe(0);
    await f.engine.manage(binding, { type: 'resume', routineId: id, inboundMessageId: '3' });
    await f.engine.tick();
    await f.engine.manage(binding, { type: 'update', routineId: id, inboundMessageId: '4', instruction: 'New daily instruction' });
    expect((await f.engine.tick()).claimed).toBe(0);
    await f.engine.manage(binding, { type: 'stop', routineId: id, inboundMessageId: '5' });
    const stopped = f.ledger().routines[0]; expect(stopped.instruction).toBe(''); expect(stopped.recentLessons).toEqual([]);
    expect(JSON.stringify(f.ledger())).not.toContain('Slang lesson');
    await expect(f.engine.manage(binding, { type: 'resume', routineId: id, inboundMessageId: '6' })).rejects.toThrow('routine_stopped');
  });

  it('does not burst after several missed days or a timezone update', async () => {
    const f = fixture(); const id = (await f.create({ timing: 'fixed', localTime: '10:00' })).routines[0].id;
    f.at('2026-10-25T06:00:00Z');
    expect((await f.engine.tick()).accepted).toBe(1);
    f.at('2026-10-25T09:00:00Z');
    expect((await f.engine.tick()).claimed).toBe(0);
    await f.engine.manage(binding, { type: 'update', routineId: id, inboundMessageId: '2', timing: 'adaptive' });
    expect((await f.engine.tick()).claimed).toBe(0);
    expect(f.send).toHaveBeenCalledOnce();
  });

  it('retains no provider text in occurrence records and expires recent snippets after 30 days', async () => {
    const f = fixture(); await f.create(); await f.engine.tick();
    expect(JSON.stringify(f.ledger().occurrences)).not.toContain('Slang');
    f.at('2026-11-21T08:00:00Z');
    const result = await f.engine.manage(binding, { type: 'list' });
    expect(result.routines[0].recentLessons).toEqual([]);
    expect(f.ledger().occurrences).toHaveLength(0);
  });

  it('fails closed at bounded routine capacity without evicting active routines', async () => {
    const f = fixture();
    for (let i = 0; i < ROUTINE_LIMITS.routinesPerBinding; i++) await f.create({ inboundMessageId: String(i) });
    await expect(f.create({ inboundMessageId: '999' })).rejects.toThrow('routine_capacity');
    expect(f.ledger().routines).toHaveLength(8);
  });

  it('limits each tick to four claims and lets later due tasks advance on the next pass', async () => {
    const f = fixture();
    for (let i = 0; i < 6; i++) await f.engine.manage({ ...binding, agentId: `agent${i}`, telegramBotId: String(500 + i) }, {
      type: 'create', inboundMessageId: String(i), instruction: 'Daily lesson', timeZone: 'Europe/Tallinn',
    });
    expect((await f.engine.tick()).claimed).toBe(4);
    expect((await f.engine.tick()).claimed).toBe(2);
    expect((await f.engine.tick()).claimed).toBe(0);
    expect(f.send).toHaveBeenCalledTimes(6);
  });
});

describe('timezone timing decisions', () => {
  it.each([
    ['2026-03-08T06:00:00Z', '02:30', 'America/New_York', '2026-03-08T07:00:00.000Z'],
    ['2026-11-01T04:00:00Z', '01:30', 'America/New_York', '2026-11-01T05:30:00.000Z'],
    ['2026-11-01T05:45:00Z', '01:30', 'America/New_York', '2026-11-02T06:30:00.000Z'],
    ['2026-10-24T08:00:00Z', '10:00', 'Europe/Tallinn', '2026-10-25T08:00:00.000Z'],
    ['2026-10-20T08:00:00Z', '10:15', 'Asia/Kathmandu', '2026-10-21T04:30:00.000Z'],
  ])('handles %s %s %s without double fall-back delivery', (now, time, zone, expected) => {
    expect(nextDailyOccurrence(new Date(now), time, zone)).toBe(expected);
  });

  it('requires a valid known timezone and fixed clock', async () => {
    const f = fixture();
    await expect(f.create({ timeZone: 'Unknown/Somewhere' })).rejects.toThrow('routine_invalid_timezone');
    await expect(f.create({ localTime: '25:00' })).rejects.toThrow('routine_invalid_time');
    await expect(f.create({ timing: 'fixed' })).rejects.toThrow('routine_invalid_time');
    expect(fs.existsSync(f.dependencies.filePath)).toBe(false);
  });

  it('waits outside daytime and defers at least an hour with no forced daily send', async () => {
    const f = fixture(); f.at('2026-10-20T03:00:00Z'); await f.create();
    expect((await f.engine.tick()).claimed).toBe(0);
    f.at('2026-10-20T06:00:00Z');
    f.chooseTiming.mockResolvedValue({ action: 'defer' });
    for (let hour = 6; hour < 17; hour++) {
      f.at(`2026-10-20T${String(hour).padStart(2, '0')}:00:00Z`); await f.engine.tick();
    }
    expect(f.chooseTiming).toHaveBeenCalledTimes(8); expect(f.generate).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
    expect(f.ledger().routines[0].nextRunAt).toBe('2026-10-21T06:00:00.000Z');
  });

  it('declines missing/failed timing choices and suppresses generation if decision crosses quiet time', async () => {
    const f = fixture(); f.at('2026-10-20T16:50:00Z'); await f.create();
    f.chooseTiming.mockImplementation(async () => { f.at('2026-10-20T17:00:00Z'); return { action: 'send' }; });
    await f.engine.tick(); expect(f.generate).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
});

describe('authority, concurrency and restart fences', () => {
  it('only claims a due occurrence once with overlapping workers', async () => {
    const f = fixture(); await f.create();
    const second = new RequestedRoutineEngine(f.dependencies);
    await Promise.all([f.engine.tick(), second.tick(), f.engine.tick()]);
    expect(f.generate).toHaveBeenCalledOnce(); expect(f.send).toHaveBeenCalledOnce();
  });

  it('does not retry an ambiguous Telegram result after restart', async () => {
    const f = fixture(); await f.create();
    f.send.mockImplementation(async () => { throw new Error('PRIVATE_NETWORK_DETAIL'); });
    expect((await f.engine.tick()).unknown).toBe(1);
    await new RequestedRoutineEngine(f.dependencies).tick(); expect(f.send).toHaveBeenCalledOnce();
    expect(f.ledger().occurrences[0].status).toBe('unknown'); expect(JSON.stringify(f.ledger())).not.toContain('PRIVATE_NETWORK_DETAIL');
  });

  it.each(['dispatching', 'generating'] as const)('never replays restart %s claims and terminalizes expired claims', async status => {
    const f = fixture(); await f.create();
    f.send.mockImplementation(async () => {
      const ledger = f.ledger(); ledger.occurrences[0].status = status;
      fs.writeFileSync(f.dependencies.filePath, JSON.stringify(ledger));
      throw new Error('crash');
    });
    await f.engine.tick();
    const ledger = f.ledger(); ledger.occurrences[0].status = status;
    fs.writeFileSync(f.dependencies.filePath, JSON.stringify(ledger));
    f.at('2026-10-20T08:16:00Z'); await new RequestedRoutineEngine(f.dependencies).tick();
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.ledger().occurrences[0].status).toBe(status === 'dispatching' ? 'unknown' : 'failed');
  });

  it('pauses revoked current authority before provider export', async () => {
    const f = fixture(); await f.create(); f.revoke(); await f.engine.tick();
    expect(f.chooseTiming).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
    expect(f.ledger().routines[0].status).toBe('paused');
  });

  it('rechecks token rotation, kill flag and revocation after generation', async () => {
    for (const action of ['revoke', 'disable', 'rotate'] as const) {
      const f = fixture(); await f.create();
      f.generate.mockImplementation(async () => {
        if (action === 'revoke') f.revoke();
        if (action === 'disable') f.disable();
        if (action === 'rotate') f.authorize.mockResolvedValue(false);
        return 'Generated private output';
      });
      await f.engine.tick(); expect(f.send).not.toHaveBeenCalled();
      expect(JSON.stringify(f.ledger())).not.toContain('Generated private output');
    }
  });

  it('cross-worker stop during generation clears content and prevents delivery', async () => {
    const f = fixture(); const id = (await f.create()).routines[0].id;
    const other = new RequestedRoutineEngine(f.dependencies);
    f.generate.mockImplementation(async input => {
      await other.manage(binding, { type: 'stop', inboundMessageId: '2', routineId: id });
      expect(input.isCurrentNow()).toBe(false);
      return 'Do not persist this cancelled lesson';
    });
    await f.engine.tick(); expect(f.send).not.toHaveBeenCalled();
    expect(f.ledger().routines[0].instruction).toBe(''); expect(f.ledger().occurrences[0].status).toBe('cancelled');
  });

  it('final synchronous fence sees paused FILE state before the transport attempt', async () => {
    const f = fixture(); const id = (await f.create()).routines[0].id;
    let remoteCalls = 0;
    f.send.mockImplementation(async input => {
      await new RequestedRoutineEngine(f.dependencies).manage(binding, { type: 'pause', inboundMessageId: '2', routineId: id });
      if (input.isCurrentNow()) remoteCalls++;
      return { status: 'failed', messageId: '' };
    });
    await f.engine.tick(); expect(remoteCalls).toBe(0);
  });

  it('malformed ledgers fail closed instead of resetting authorization or routines', async () => {
    const f = fixture(); await f.create(); fs.writeFileSync(f.dependencies.filePath, '{"version":99}');
    await expect(f.engine.manage(binding, { type: 'list' })).rejects.toThrow('routine_ledger_unavailable');
    await expect(f.engine.tick()).rejects.toThrow('routine_ledger_unavailable'); expect(f.send).not.toHaveBeenCalled();
  });

  it('default disabled engine never accepts management or starts providers', async () => {
    const f = fixture(); const engine = new RequestedRoutineEngine({ ...f.dependencies, enabled: undefined });
    await expect(engine.manage(binding, { type: 'list' })).rejects.toThrow('routine_authority_denied');
    expect(await engine.tick()).toEqual({ claimed: 0, accepted: 0, failed: 0, unknown: 0 });
  });

  it('rejects authority revoked while management waits for the FILE transaction', async () => {
    const f = fixture(); const lock = `${f.dependencies.filePath}.lock`;
    fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, `${process.pid}-${randomUUID()}`), '');
    const pending = f.create();
    await new Promise(resolve => setTimeout(resolve, 30));
    f.revoke(); fs.rmSync(lock, { recursive: true });
    await expect(pending).rejects.toThrow('routine_authority_denied');
    expect(fs.existsSync(f.dependencies.filePath)).toBe(false);
  });

  it('does not retain lesson content when authority changes during an accepted remote send', async () => {
    const f = fixture(); await f.create();
    f.send.mockImplementation(async () => { f.revoke(); return { status: 'accepted', messageId: '901' }; });
    expect((await f.engine.tick()).accepted).toBe(1);
    expect(f.ledger().routines[0].recentLessons).toEqual([]);
  });

  it('purges stopped metadata on maintenance ticks without active routines', async () => {
    const f = fixture(); const id = (await f.create()).routines[0].id;
    await f.engine.manage(binding, { type: 'stop', routineId: id, inboundMessageId: '2' });
    f.at('2026-11-21T08:00:00Z'); await f.engine.tick();
    expect(f.ledger().routines).toEqual([]); expect(f.ledger().inbound).toEqual([]);
  });
});

function childEngine(filePath: string, receiptPath: string, crash: boolean): Promise<void> {
  const source = `
    import { RequestedRoutineEngine } from ${JSON.stringify(path.join(process.cwd(), 'src/lib/studio/routines/index.ts'))};
    import { appendFileSync } from 'node:fs';
    const binding=${JSON.stringify(binding)};
    const engine=new RequestedRoutineEngine({filePath:${JSON.stringify(filePath)},enabled:()=>true,
      now:()=>new Date('2026-10-20T08:00:00Z'),authorize:async()=>true,authorizeNow:()=>true,
      chooseTiming:async()=>({action:'send'}),generate:async()=>{await new Promise(r=>setTimeout(r,40));return 'Synthetic lesson';},
      send:async(input)=>{if(!await input.isCurrent()||!input.isCurrentNow())return{status:'failed'};
        appendFileSync(${JSON.stringify(receiptPath)},'attempt\\n');
        ${crash ? 'process.exit(0);' : "return {status:'accepted',messageId:'901'};"}
      }});
    await engine.manage(binding,{type:'create',inboundMessageId:'one',instruction:'Teach slang daily',timeZone:'Europe/Tallinn'});
    await engine.tick();
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    let errors = ''; child.stderr.on('data', value => { errors += value; });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`child_exit_${code}: ${errors}`)));
  });
}

describe('actual isolated Node processes', () => {
  it('cleans a dead process lock safely and deduplicates concurrent process claims', async () => {
    const f = fixture(); const lock = `${f.dependencies.filePath}.lock`, receipt = `${f.dependencies.filePath}.receipts`;
    fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, `2147483647-${randomUUID()}`), '');
    await Promise.all([childEngine(f.dependencies.filePath, receipt, false), childEngine(f.dependencies.filePath, receipt, false)]);
    expect(f.ledger().routines).toHaveLength(1); expect(f.ledger().occurrences).toHaveLength(1);
    expect(fs.readFileSync(receipt, 'utf8')).toBe('attempt\n');
  });

  it('persists dispatching before a process crash and never retries after restart', async () => {
    const f = fixture(), receipt = `${f.dependencies.filePath}.receipts`;
    await childEngine(f.dependencies.filePath, receipt, true);
    expect(f.ledger().occurrences[0].status).toBe('dispatching');
    await childEngine(f.dependencies.filePath, receipt, false);
    expect(fs.readFileSync(receipt, 'utf8')).toBe('attempt\n');
    f.at('2026-10-20T08:16:00Z'); await f.engine.tick();
    expect(f.ledger().occurrences[0].status).toBe('unknown'); expect(f.send).not.toHaveBeenCalled();
  });
});
