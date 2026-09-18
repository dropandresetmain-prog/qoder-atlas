/**
 * R1 — pure projection of a durable case-attention record (C8 ESCALATE) onto the
 * Case read model. Human label/detail are derived from the closed reason code, so
 * presentation can never drift from semantics; the typed refs stay secondary.
 */
import type { RecoveryCaseAttentionView } from '../../../contracts/v2/product/readModels.ts';
import {
  RECOVERY_CASE_ATTENTION_PRESENTATION,
  RECOVERY_CASE_ATTENTION_RESOLUTION_LABELS,
  type RecoveryCaseAttentionRecord,
} from '../../../contracts/v2/planning/recoveryCaseAttention.ts';

export function projectCaseAttention(record: RecoveryCaseAttentionRecord): RecoveryCaseAttentionView {
  const presentation = RECOVERY_CASE_ATTENTION_PRESENTATION[record.reasonCode];
  return {
    attentionRef: record.id,
    reason: { label: presentation.label, code: record.reasonCode },
    detail: presentation.detail,
    status: { label: record.status === 'OPEN' ? 'Needs attention' : 'Cleared', code: record.status },
    openedAt: record.openedAt,
    basisAssessmentRef: record.basisAssessmentId,
    ...(record.resolvedAt ? { resolvedAt: record.resolvedAt } : {}),
    ...(record.resolutionCode
      ? { resolution: { label: RECOVERY_CASE_ATTENTION_RESOLUTION_LABELS[record.resolutionCode], code: record.resolutionCode } }
      : {}),
  };
}
