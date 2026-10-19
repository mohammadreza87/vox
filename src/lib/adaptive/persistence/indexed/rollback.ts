/** Export the latest committed SQLite state to a fresh managed FILEv2 target.
 * Never restores the migration-time archive or enables the old unsafe FILE path. */
import { transitionAdaptiveStorage, type TransitionOptions, type TransitionResult } from './migration';
export function rollbackAdaptiveStorage(root: string, options: TransitionOptions): Promise<TransitionResult> {
  return transitionAdaptiveStorage(root, 'file-v2', options);
}
