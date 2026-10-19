import { createHash } from 'crypto';
import { AuthorizedContextRetriever } from '../../adaptive/retrieval';

const retriever = new AuthorizedContextRetriever();

/** Select only the current authorized snapshot. The complete source/policy
 * receipt still governs provider use/delivery, including unselected sources. */
export function selectAdaptiveContext(context: readonly string[], query: string,
  options: { priorityContext?: readonly string[]; authority?: { scope: string; revision: string } } = {}): string[] {
  const rows = [...(options.priorityContext ?? []).map(text => ({ text, layer: 'preference' as const })),
    ...context.map(text => ({ text, layer: 'memory' as const }))];
  const unique = [...new Map(rows.map((row, index) => [row.text, { ...row, freshness: index }])).values()];
  // Priority is server metadata, never inferred from a user-authored text label.
  const priority = new Set(options.priorityContext ?? []);
  return retriever.select({ query, authority: options.authority, candidates: unique.map(row => ({ ...row,
    layer: priority.has(row.text) ? 'preference' : 'memory',
    id: createHash('sha256').update(row.text).digest('hex'),
  })) }).selected.map(row => row.text);
}
