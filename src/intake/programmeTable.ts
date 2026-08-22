/**
 * Northstar RV-N2 — table-like (XLSX/CSV pre-parsed) row adapter.
 *
 * Adapter for callers that already have rows as `Record<string, unknown>[]`
 * (e.g. an XLSX library, a frontend table component, a CSV parsed elsewhere).
 * Reuses the shared normalizeTravellerRow to guarantee that CSV and table-row
 * channels produce EQUAL drafts for EQUAL data.
 */
import type { ProgrammeTravellerDraft } from '../contracts/programmeIntake.ts';
import { normalizeTravellerRow } from './programmeRows.ts';

export interface TableResult {
  drafts: ProgrammeTravellerDraft[];
  unresolvedStatements: string[];
}

export function tableRowsToDrafts(
  rows: Record<string, unknown>[],
  draftIdPrefix: string,
): TableResult {
  const drafts: ProgrammeTravellerDraft[] = [];
  const unresolvedStatements: string[] = [];
  rows.forEach((row, index) => {
    const result = normalizeTravellerRow(row, draftIdPrefix, index);
    if (result.draft) drafts.push(result.draft);
    if (result.unresolved) unresolvedStatements.push(result.unresolved);
  });
  return { drafts, unresolvedStatements };
}
