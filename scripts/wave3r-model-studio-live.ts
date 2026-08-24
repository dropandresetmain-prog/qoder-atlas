/**
 * Wave 3R Mission 3 §3 — Model Studio LIVE validation through the ACTUAL
 * application paths (not scratch calls):
 *
 *  1. Organiser/event extraction via `modelStudioExtractionClient` (the
 *     ingestion seam) against the frozen EXTRACTION_OUTPUT_SCHEMA DTOs.
 *  2. Traveller natural-language ChangeRequest via `interpretChangeRequest`
 *     (the DR-5 intake seam) — clear text must yield a schema-validated
 *     proposal; ambiguous text must fail closed into structured uncertainty.
 *  3. Strict structured validation fail-closed probe: a task whose schema
 *     contradicts the instructed output proves `ModelStudioClient.call`
 *     rejects schema-violating model output as structured data — never
 *     guesses, never crashes.
 *
 * LLM output is proposal only: nothing here mutates state or touches a
 * provider. Credentials come from config and are never printed. Evidence is
 * sanitized: only synthetic inputs, statuses, and structural summaries are
 * persisted (no raw model text, no key material).
 *
 * Run: node --experimental-strip-types scripts/wave3r-model-studio-live.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { loadConfig } from '../src/config/config.ts';
import { ModelStudioClient, type ModelTask } from '../src/intelligence/client.ts';
import { modelStudioExtractionClient } from '../src/app/extraction.ts';
import { interpretChangeRequest } from '../src/app/changeIntake.ts';

interface EvidenceStep {
  step: string;
  timestamp: string;
  result: Record<string, unknown>;
}

const evidence: EvidenceStep[] = [];

function record(step: string, result: Record<string, unknown>): void {
  evidence.push({ step, timestamp: new Date().toISOString(), result });
  process.stdout.write(`${step}: ${JSON.stringify(result)}\n`);
}

/** Structural summary of an extraction output — never echoes raw model text. */
function extractionSummary(output: unknown): Record<string, unknown> {
  if (output === null || typeof output !== 'object') return { shape: typeof output };
  const o = output as Record<string, unknown>;
  const summary: Record<string, unknown> = { fields: Object.keys(o) };
  for (const [key, value] of Object.entries(o)) {
    if (Array.isArray(value)) summary[`${key}Count`] = value.length;
    else if (typeof value === 'string') summary[`${key}Present`] = true;
    else if (value && typeof value === 'object') summary[`${key}Fields`] = Object.keys(value as object);
  }
  return summary;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const { apiKey, model, baseUrl } = config.providers.modelStudio;
  if (!apiKey) throw new Error('Model Studio API key ABSENT — refusing LIVE validation');

  // Identical construction to src/app/compose.ts — the same client the
  // application uses; no bespoke transport or options.
  const client = new ModelStudioClient({ apiKey, model, baseUrl });
  if (!client.isConfigured()) throw new Error('Model Studio client not configured');
  if (client.mode !== 'LIVE') throw new Error('Model Studio client is not in LIVE mode');
  if (!client.baseUrl.includes('dashscope-intl')) {
    throw new Error(`Model Studio base URL is not the documented international endpoint: ${new URL(client.baseUrl).hostname}`);
  }
  record('model_studio.config', {
    endpoint: new URL(client.baseUrl).hostname,
    model: client.model,
    mode: client.mode,
    configured: true,
  });

  // -------------------------------------------------------------------------
  // 1. Organiser/event extraction through the ingestion seam (RULE_SET task).
  //    Synthetic organiser policy source — never real documents.
  // -------------------------------------------------------------------------
  const extraction = modelStudioExtractionClient(client);
  const ruleSource = [
    'Subject: Summit travel policy — final rules',
    '',
    'From the organising committee of the Meridian Summit 2026:',
    '1. Flight spend for delegates must not exceed 450 USD per booking.',
    '2. Any flight above 300 USD requires prior organisation approval.',
    '3. Hotel bookings must be refundable; cancellations are free until 48 hours before check-in.',
    '4. Ground transport is event-funded.',
  ].join('\n');
  const ruleSetResult = await extraction.extract({
    task: 'RULE_SET',
    sourceKind: 'EMAIL',
    title: 'Summit travel policy',
    content: ruleSource,
  });
  record('model_studio.extraction_rule_set', ruleSetResult.ok
    ? { ok: true, summary: extractionSummary(ruleSetResult.output) }
    : { ok: false, reason: ruleSetResult.reason });
  if (!ruleSetResult.ok) throw new Error(`RULE_SET extraction failed: ${ruleSetResult.reason}`);

  // 1b. Anchor-event extraction through the same seam.
  const anchorSource = [
    'Meridian Summit 2026 — organiser briefing',
    '',
    'Event: Meridian Summit 2026 (conference), organised by Meridian Events Pte Ltd.',
    'Venue: Marina Pavilion, Singapore (timezone Asia/Singapore).',
    'Schedule: starts 2026-10-01T09:00:00+08:00, ends 2026-10-03T18:00:00+08:00.',
    'Keynote "Opening Remarks" runs 2026-10-01T09:30:00+08:00 to 2026-10-01T10:15:00+08:00.',
  ].join('\n');
  const anchorResult = await extraction.extract({
    task: 'ANCHOR_EVENT',
    sourceKind: 'DOCUMENT',
    title: 'Organiser briefing',
    content: anchorSource,
  });
  record('model_studio.extraction_anchor_event', anchorResult.ok
    ? { ok: true, summary: extractionSummary(anchorResult.output) }
    : { ok: false, reason: anchorResult.reason });
  if (!anchorResult.ok) throw new Error(`ANCHOR_EVENT extraction failed: ${anchorResult.reason}`);

  // -------------------------------------------------------------------------
  // 2. Traveller NL ChangeRequest through the DR-5 intake seam.
  // -------------------------------------------------------------------------
  const at = '2026-08-25T06:00:00Z';
  const clear = await interpretChangeRequest(
    { modelClient: client },
    {
      travellerId: 'trv-live-validation',
      tripId: 'trip-live-validation',
      text: 'I must arrive in Singapore by 2026-09-30T18:00:00+08:00 because of the rehearsal. Please treat this as a hard requirement.',
      at,
    },
  );
  record('model_studio.change_request_clear', {
    ok: clear.ok,
    provenance: clear.provenance,
    ...(clear.proposal
      ? { intentKind: clear.proposal.intentKind, urgency: clear.proposal.urgency, target: clear.proposal.target }
      : {}),
    ...(clear.clarificationNeeded ? { clarificationNeeded: clear.clarificationNeeded } : {}),
  });
  if (!clear.ok || clear.provenance !== 'MODEL') {
    throw new Error(`clear ChangeRequest did not yield a MODEL-backed proposal: ${clear.clarificationNeeded ?? 'no detail'}`);
  }

  // Ambiguous text: the intake must fail closed — either the model asks for
  // clarification (the designed path) or the call itself errors (still fail
  // closed). The evidence distinguishes the two honestly; a proposal from
  // ambiguous text is the only violation.
  const ambiguityAttempts: Array<Record<string, unknown>> = [];
  let ambiguous: Awaited<ReturnType<typeof interpretChangeRequest>> | undefined;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    ambiguous = await interpretChangeRequest(
      { modelClient: client },
      {
        travellerId: 'trv-live-validation',
        tripId: 'trip-live-validation',
        text: 'Something about my trip needs changing, not sure what exactly.',
        at,
      },
    );
    if (ambiguous.ok) break;
    // A model-requested clarification carries the model's own question; a
    // call failure carries the canned intake message. Only a call failure
    // earns ONE bounded retry — a clarification is already the proof.
    const ambiguousMode = ambiguous.clarificationNeeded?.startsWith('Model interpretation failed')
      ? 'CALL_FAILED'
      : 'MODEL_CLARIFICATION';
    ambiguityAttempts.push({
      attempt,
      ok: ambiguous.ok,
      provenance: ambiguous.provenance,
      mode: ambiguousMode,
      ...(ambiguous.clarificationNeeded ? { clarificationNeeded: ambiguous.clarificationNeeded } : {}),
      uncertaintyStatements: ambiguous.uncertainties?.map((u) => u.statement) ?? [],
    });
    if (ambiguousMode === 'MODEL_CLARIFICATION') break;
  }
  record('model_studio.change_request_ambiguous', { attempts: ambiguityAttempts });
  if (!ambiguous || ambiguous.ok) {
    throw new Error('ambiguous ChangeRequest was accepted as a proposal — fail-closed violation');
  }

  // -------------------------------------------------------------------------
  // 3. Strict validation fail-closed probe: the schema contradicts the
  //    instructed value, so ANY compliant model output is rejected. The
  //    client must surface structured INVALID_OUTPUT — never guess.
  // -------------------------------------------------------------------------
  const impossibleTask: ModelTask<{ echo: 'NEVER_THIS' }> = {
    id: 'mission3_fail_closed_probe',
    systemPrompt:
      'Respond with a single JSON object and nothing else: {"echo": "ALWAYS_THIS"}. ' +
      'You must respond with exactly that object.',
    userPrompt: 'Respond now.',
    schema: z.strictObject({ echo: z.literal('NEVER_THIS') }),
  };
  const impossible = await client.call(impossibleTask);
  record('model_studio.strict_validation_fail_closed', impossible.ok
    ? { ok: true, unexpected: 'model output satisfied the contradictory schema' }
    : { ok: false, category: impossible.error.category, code: impossible.error.code });
  if (impossible.ok) {
    throw new Error('fail-closed probe unexpectedly passed — schema contradiction not enforced');
  }

  // Verdict.
  const verdict = {
    extraction: 'PASS',
    changeRequestClear: 'PASS',
    changeRequestAmbiguousFailClosed: 'PASS',
    strictValidationFailClosed: 'PASS',
  };
  record('model_studio.verdict', verdict);

  mkdirSync(resolve('output'), { recursive: true });
  writeFileSync(
    resolve('output/wave3r-mission3-model-studio-live.json'),
    `${JSON.stringify(
      {
        probe: 'wave3r-mission3-model-studio-live',
        generatedAt: new Date().toISOString(),
        endpoint: new URL(client.baseUrl).hostname,
        model: client.model,
        mode: client.mode,
        note: 'LLM output is proposal only; no state mutation, no provider action.',
        steps: evidence,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  process.stdout.write('EVIDENCE WRITTEN output/wave3r-mission3-model-studio-live.json\n');
}

main().catch((error) => {
  try {
    mkdirSync(resolve('output'), { recursive: true });
    writeFileSync(
      resolve('output/wave3r-mission3-model-studio-live.partial.json'),
      `${JSON.stringify({ probe: 'wave3r-mission3-model-studio-live', aborted: String(error), steps: evidence }, null, 2)}\n`,
      'utf8',
    );
  } catch {
    // Evidence persistence must never mask the primary error.
  }
  process.stderr.write(`MODEL STUDIO LIVE FAILED: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
