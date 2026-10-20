import { createHash } from 'crypto';
import { RightsFileStorage } from '../rights-intake/storage';
import { GUEST_LEDGER_KEY } from './contracts';
/** Separate fixed-key ledger; hardened RI1 file/clock primitives, no account schema or directory reuse. */
export class GuestRightsStorage {
    readonly backing: RightsFileStorage;
    constructor(readonly directory: string) { this.backing = new RightsFileStorage(directory); }
    static readonly filename = createHash('sha256').update(GUEST_LEDGER_KEY).digest('hex') + '.json';
    read() { return this.backing.readCommittedForEffect(GUEST_LEDGER_KEY); }
    observe(now: number) { this.backing.observeRightsTime(now); }
    transact<T>(mutate: (raw: unknown | null) => {
        document: unknown;
        result: T;
    }, fence: () => void) { return this.backing.transact(GUEST_LEDGER_KEY, mutate, fence); }
}
