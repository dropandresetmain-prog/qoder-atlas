/**
 * Northstar RV-N2 — deterministic mapping of recognized policy clauses
 * (from `mapEventBriefWithModel` output) to a frozen-vocabulary RuleSet.
 *
 * Recognized clause kinds:
 *   - FUNDED_WINDOW      — windowStart + windowEnd required, normalized via
 *                          normalizeExtractedTemporal with explicit timezone;
 *                          missing/unparseable temporal -> uncertainty, clause
 *                          dropped (no wall-clock fallback, ADR-040).
 *   - SPEND_LIMIT        — amount + currency required -> maxAmount.
 *   - APPROVAL_ABOVE_SPEND — amount + currency + approver (mapped to one of
 *                            ORGANISATION_APPROVER / TRAVELLER / HUMAN_AGENT).
 *   - CHANGE_TERMS       — `allowed` boolean from statement keywords
 *                          ("allowed"/"not allowed"); `fee` optional.
 *   - CANCELLATION_TERMS — `refundable` boolean; `refundDeadline` normalized
 *                          via normalizeExtractedTemporal (or dropped).
 *
 * Unrecognized kinds are recorded as UncertaintyRecord entries and never
 * turned into executable rules. This module is anti-hardcoding: it knows
 * the policy vocabulary, not the scenario.
 */
import {
  type EntityId,
  type UncertaintyRecord,
} from '../domain/common.ts';
import { hashId } from '../ingest/ids.ts';
import { normalizeExtractedTemporal } from '../ingest/temporal.ts';
import {
  ApproverPrincipalSchema,
  PolicyRuleSchema,
  RuleSetSchema,
  type ApproverPrincipal,
  type Payer,
  type RuleSet,
} from '../domain/rules.ts';

export interface RecognizedClause {
  kind: string;
  statement: string;
  windowStart?: string;
  windowEnd?: string;
  amount?: number;
  currency?: string;
  approver?: string;
}

export interface RecognizedClausesInput {
  clauses: RecognizedClause[];
  ruleSetId: string;
  sourceId: EntityId;
  ownerOrganisationId?: EntityId;
  timezone?: string;
  name?: string;
}

export interface RecognizedClausesResult {
  ruleSet?: RuleSet;
  uncertainties: UncertaintyRecord[];
}

const APPROVER_ALIASES: Array<{ match: RegExp; value: ApproverPrincipal }> = [
  { match: /organisation[_ ]?approver|organization[_ ]?approver|finance|approver/i, value: 'ORGANISATION_APPROVER' },
  { match: /human[_ ]?agent|agent|human/i, value: 'HUMAN_AGENT' },
  { match: /traveller|self|passenger|attendee/i, value: 'TRAVELLER' },
];

function classifyApprover(value: string | undefined): ApproverPrincipal | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  if (ApproverPrincipalSchema.safeParse(trimmed).success) {
    return trimmed as ApproverPrincipal;
  }
  for (const alias of APPROVER_ALIASES) {
    if (alias.match.test(trimmed)) return alias.value;
  }
  return undefined;
}

function classifyPayerFromStatement(statement: string): Payer {
  const s = statement.toLowerCase();
  if (/event/.test(s)) return 'EVENT_ORGANISATION';
  if (/organis|organiz|company|employer/.test(s)) return 'ORGANISATION';
  if (/other|third party|insurer/.test(s)) return 'OTHER';
  return 'EVENT_ORGANISATION';
}

function parseBooleanStatement(statement: string): { truey: boolean; falsy: boolean } {
  const s = statement.toLowerCase();
  const truey = /\ballowed\b|\bpermitted\b|\byes\b|\bcan\b|\bavailable\b/.test(s);
  const falsy = /\bnot allowed\b|\bforbidden\b|\bprohibited\b|\bno\b|\bdenied\b/.test(s);
  return { truey, falsy };
}

function deterministicId(prefix: string, ...parts: string[]): EntityId {
  return hashId(prefix, ...parts) as EntityId;
}

function makeUncertainty(
  sourceId: EntityId,
  statement: string,
  severity: UncertaintyRecord['severity'] = 'MEDIUM',
): UncertaintyRecord {
  return {
    id: deterministicId('uncertainty', sourceId, statement, severity),
    statement,
    aboutRefs: [],
    sourceId,
    severity,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function buildFundedWindow(
  clause: RecognizedClause,
  sourceId: EntityId,
  timezone: string | undefined,
): { rule?: Record<string, unknown>; uncertainty?: UncertaintyRecord } {
  if (clause.windowStart === undefined || clause.windowEnd === undefined) {
    return {
      uncertainty: makeUncertainty(
        sourceId,
        `FUNDED_WINDOW dropped: missing windowStart or windowEnd (statement: ${clause.statement})`,
      ),
    };
  }
  if (!timezone) {
    return {
      uncertainty: makeUncertainty(
        sourceId,
        `FUNDED_WINDOW dropped: no explicit timezone to normalize temporal values (statement: ${clause.statement})`,
      ),
    };
  }
  const start = normalizeExtractedTemporal(clause.windowStart, timezone);
  const end = normalizeExtractedTemporal(clause.windowEnd, timezone);
  if (start === undefined || end === undefined) {
    return {
      uncertainty: makeUncertainty(
        sourceId,
        `FUNDED_WINDOW dropped: windowStart/windowEnd not parseable with timezone ${timezone} (statement: ${clause.statement})`,
      ),
    };
  }
  const coveredBy = classifyPayerFromStatement(clause.statement);
  return {
    rule: {
      kind: 'FUNDED_WINDOW',
      windowStart: start,
      windowEnd: end,
      coveredBy,
      incrementalPayer: 'TRAVELLER' as Payer,
    },
  };
}

function buildSpendLimit(
  clause: RecognizedClause,
  sourceId: EntityId,
): { rule?: Record<string, unknown>; uncertainty?: UncertaintyRecord } {
  if (!isFiniteNumber(clause.amount) || typeof clause.currency !== 'string' || clause.currency.length !== 3) {
    return {
      uncertainty: makeUncertainty(
        sourceId,
        `SPEND_LIMIT dropped: amount and 3-letter currency required (statement: ${clause.statement})`,
      ),
    };
  }
  return {
    rule: {
      kind: 'SPEND_LIMIT',
      maxAmount: { amount: clause.amount, currency: clause.currency.toUpperCase() },
    },
  };
}

function buildApprovalAboveSpend(
  clause: RecognizedClause,
  sourceId: EntityId,
): { rule?: Record<string, unknown>; uncertainty?: UncertaintyRecord } {
  if (!isFiniteNumber(clause.amount) || typeof clause.currency !== 'string' || clause.currency.length !== 3) {
    return {
      uncertainty: makeUncertainty(
        sourceId,
        `APPROVAL_ABOVE_SPEND dropped: amount and 3-letter currency required (statement: ${clause.statement})`,
      ),
    };
  }
  const approver = classifyApprover(clause.approver);
  if (!approver) {
    return {
      uncertainty: makeUncertainty(
        sourceId,
        `APPROVAL_ABOVE_SPEND dropped: approver unrecognised (value: ${clause.approver ?? 'absent'})`,
      ),
    };
  }
  return {
    rule: {
      kind: 'APPROVAL_ABOVE_SPEND',
      threshold: { amount: clause.amount, currency: clause.currency.toUpperCase() },
      approver,
    },
  };
}

function buildChangeTerms(
  clause: RecognizedClause,
  sourceId: EntityId,
): { rule?: Record<string, unknown>; uncertainty?: UncertaintyRecord } {
  const { truey, falsy } = parseBooleanStatement(clause.statement);
  if (!truey && !falsy) {
    return {
      uncertainty: makeUncertainty(
        sourceId,
        `CHANGE_TERMS dropped: statement did not contain allowed/not-allowed keywords (statement: ${clause.statement})`,
      ),
    };
  }
  const rule: Record<string, unknown> = {
    kind: 'CHANGE_TERMS',
    allowed: truey && !falsy,
  };
  if (isFiniteNumber(clause.amount) && typeof clause.currency === 'string' && clause.currency.length === 3) {
    rule['fee'] = { amount: clause.amount, currency: clause.currency.toUpperCase() };
  }
  return { rule };
}

function buildCancellationTerms(
  clause: RecognizedClause,
  sourceId: EntityId,
  timezone: string | undefined,
): { rule?: Record<string, unknown>; uncertainty?: UncertaintyRecord } {
  const { truey, falsy } = parseBooleanStatement(clause.statement);
  if (!truey && !falsy) {
    return {
      uncertainty: makeUncertainty(
        sourceId,
        `CANCELLATION_TERMS dropped: statement did not contain refundable/non-refundable keywords (statement: ${clause.statement})`,
      ),
    };
  }
  const refundable = truey && !falsy;
  const rule: Record<string, unknown> = {
    kind: 'CANCELLATION_TERMS',
    refundable,
  };
  if (clause.windowStart) {
    if (!timezone) {
      return {
        uncertainty: makeUncertainty(
          sourceId,
          `CANCELLATION_TERMS dropped: refund deadline present but no explicit timezone (statement: ${clause.statement})`,
        ),
      };
    }
    const deadline = normalizeExtractedTemporal(clause.windowStart, timezone);
    if (deadline === undefined) {
      // Drop the deadline but keep the rule: refundable boolean is the
      // explicit statement.
    } else {
      rule['refundDeadline'] = deadline;
    }
  }
  if (isFiniteNumber(clause.amount) && typeof clause.currency === 'string' && clause.currency.length === 3) {
    rule['fee'] = { amount: clause.amount, currency: clause.currency.toUpperCase() };
  }
  return { rule };
}

function buildRule(
  clause: RecognizedClause,
  sourceId: EntityId,
  timezone: string | undefined,
  index: number,
): { rule?: Record<string, unknown>; uncertainty?: UncertaintyRecord } {
  const kind = clause.kind.trim().toUpperCase();
  switch (kind) {
    case 'FUNDED_WINDOW':
      return buildFundedWindow(clause, sourceId, timezone);
    case 'SPEND_LIMIT':
      return buildSpendLimit(clause, sourceId);
    case 'APPROVAL_ABOVE_SPEND':
      return buildApprovalAboveSpend(clause, sourceId);
    case 'CHANGE_TERMS':
      return buildChangeTerms(clause, sourceId);
    case 'CANCELLATION_TERMS':
      return buildCancellationTerms(clause, sourceId, timezone);
    default: {
      void index;
      return {
        uncertainty: makeUncertainty(
          sourceId,
          `Unrecognized clause kind: ${clause.kind} (statement: ${clause.statement})`,
        ),
      };
    }
  }
}

/**
 * Deterministic mapping of recognized policy clauses to a RuleSet. Each
 * clause is mapped individually; a failure on one clause never aborts the
 * others. Unrecognized kinds are recorded as uncertainty and never become
 * rules.
 */
export function recognizedPolicyClausesToRuleSet(input: RecognizedClausesInput): RecognizedClausesResult {
  const uncertainties: UncertaintyRecord[] = [];
  const validRules: Array<Record<string, unknown>> = [];
  input.clauses.forEach((clause, index) => {
    const built = buildRule(clause, input.sourceId, input.timezone, index);
    if (built.uncertainty) uncertainties.push(built.uncertainty);
    if (built.rule) {
      // Assign ids and validate against the frozen schema before accepting.
      const candidate: Record<string, unknown> = {
        ...built.rule,
        id: deterministicId(
          'rule',
          input.ruleSetId,
          String(index),
          String(built.rule['kind'] ?? ''),
        ),
        sourceId: input.sourceId,
      };
      const parsed = PolicyRuleSchema.safeParse(candidate);
      if (parsed.success) {
        validRules.push(parsed.data as unknown as Record<string, unknown>);
      } else {
        uncertainties.push(
          makeUncertainty(
            input.sourceId,
            `${String(built.rule['kind'])} clause failed frozen schema validation: ${parsed.error.issues
              .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
              .join('; ')}`,
            'HIGH',
          ),
        );
      }
    }
  });
  if (validRules.length === 0) {
    return { uncertainties };
  }
  const candidateRuleSet: Record<string, unknown> = {
    id: input.ruleSetId,
    kind: 'ORGANISATION',
    name: input.name ?? 'Programme policy clauses',
    sourceId: input.sourceId,
    rules: validRules,
  };
  if (input.ownerOrganisationId !== undefined) {
    candidateRuleSet['ownerOrganisationId'] = input.ownerOrganisationId;
  }
  const parsed = RuleSetSchema.safeParse(candidateRuleSet);
  if (!parsed.success) {
    uncertainties.push(
      makeUncertainty(
        input.sourceId,
        `RuleSet failed validation: ${parsed.error.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ')}`,
        'HIGH',
      ),
    );
    return { uncertainties };
  }
  // RuleSetSchema permits non-strict for rules (it uses PolicyRuleSchema
  // which is discriminated). validRules already hold validated PolicyRule
  // objects, so the parsed data is authoritative.
  return { ruleSet: parsed.data as RuleSet, uncertainties };
}
