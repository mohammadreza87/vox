import type { RightsRequestView, RightsSpace } from './rights-client';
export type RightsLocale = 'en' | 'fa';
import { rightsCopy } from '@/lib/adaptive/rights-intake/notice';
export { rightsCopy };
export function rightsDate(at: number, locale: RightsLocale) { return new Date(at).toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-GB'); }
export function rightsTitle(space: RightsSpace, locale: RightsLocale) { const c = rightsCopy[locale]; return `${c.title} · ${c[space]}`; }
export function rightsState(row: Pick<RightsRequestView, 'state'>, locale: RightsLocale) { return rightsCopy[locale].states[row.state]; }
