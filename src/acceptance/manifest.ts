/**
 * Acceptance-run manifest: declarative orchestration for S1–S8 (and any
 * future pack) through real HTTP/application boundaries.
 *
 * The runner interprets generic action types only. Scenario IDs are
 * orchestration metadata — never business-behaviour switches.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema } from '../domain/common.ts';
import { ScenarioExecutionModeSchema } from './modes.ts';

export const InputPackRefSchema = z.strictObject({
  /** Logical pack id (e.g. global programme pack, local S1 pack). */
  packId: z.string().min(1),
  /** Semver-like or opaque version string declared by the pack author. */
  version: z.string().min(1),
  /** Directory or file path relative to the manifest, or absolute. */
  path: z.string().min(1),
});
export type InputPackRef = z.infer<typeof InputPackRefSchema>;

export const BoundaryDeclarationSchema = z.strictObject({
  /** Named seam (provider id, ingress channel, or native UI surface). */
  seam: z.string().min(1),
  mode: ScenarioExecutionModeSchema,
  /** Optional note for operators; never interpreted as business logic. */
  note: z.string().optional(),
});
export type BoundaryDeclaration = z.infer<typeof BoundaryDeclarationSchema>;

const HttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

/** Generic HTTP submission through a product boundary. */
export const HttpActionSchema = z.strictObject({
  type: z.literal('http'),
  method: HttpMethodSchema.default('POST'),
  /** Absolute path on the app server, e.g. /api/runtime/plan */
  path: z.string().min(1),
  /** JSON body; string values may use {{binding}} placeholders. */
  body: z.unknown().optional(),
  query: z.record(z.string(), z.string()).optional(),
  /** Bindings extracted from the JSON response via simple dotted paths. */
  capture: z.record(z.string(), z.string()).optional(),
  /** Expected HTTP status; default 200. */
  expectStatus: z.number().int().positive().default(200),
  provenance: ScenarioExecutionModeSchema.optional(),
});
export type HttpAction = z.infer<typeof HttpActionSchema>;

/** Traveller natural-language / text submission. */
export const TravellerMessageActionSchema = z.strictObject({
  type: z.literal('traveller_message'),
  travellerId: EntityIdSchema,
  tripId: EntityIdSchema,
  text: z.string().min(1),
  at: IsoDateTimeSchema,
  capture: z.record(z.string(), z.string()).optional(),
  expectStatus: z.number().int().positive().default(200),
  provenance: ScenarioExecutionModeSchema.optional(),
});
export type TravellerMessageAction = z.infer<typeof TravellerMessageActionSchema>;

const UiKindSchema = z.enum([
  'organiser_preview',
  'organiser_commit',
  'traveller_approve',
  'traveller_decline',
  'traveller_text',
]);

/** Native UI-facing actions exercised through HTTP product surfaces. */
export const UiActionSchema = z.strictObject({
  type: z.literal('ui_action'),
  kind: UiKindSchema,
  /** Path params / body fields required by the chosen kind. */
  params: z.record(z.string(), z.unknown()).default({}),
  at: IsoDateTimeSchema.optional(),
  capture: z.record(z.string(), z.string()).optional(),
  expectStatus: z.number().int().positive().default(200),
  provenance: ScenarioExecutionModeSchema.optional(),
});
export type UiAction = z.infer<typeof UiActionSchema>;

/**
 * Approved simulated external event injected through a real ingress boundary
 * (e.g. POST /api/events/atlas). Evidence must label this SIMULATED even when
 * downstream provider work is LIVE/RECORD.
 */
export const SimulatedExternalEventActionSchema = z.strictObject({
  type: z.literal('simulated_external_event'),
  /** Ingress path, typically /api/events/atlas */
  path: z.string().min(1).default('/api/events/atlas'),
  body: z.unknown(),
  query: z.record(z.string(), z.string()).optional(),
  capture: z.record(z.string(), z.string()).optional(),
  expectStatus: z.number().int().positive().default(200),
  /** Always SIMULATED_EXTERNAL_EVENT for this action type. */
  provenance: z.literal('SIMULATED_EXTERNAL_EVENT').default('SIMULATED_EXTERNAL_EVENT'),
});
export type SimulatedExternalEventAction = z.infer<typeof SimulatedExternalEventActionSchema>;

/** Observe authoritative/application state (no mutation). */
export const ObserveActionSchema = z.strictObject({
  type: z.literal('observe'),
  /** GET path; may include {{binding}} placeholders. */
  path: z.string().min(1),
  capture: z.record(z.string(), z.string()).optional(),
  expectStatus: z.number().int().positive().default(200),
  /** Optional evidence label for what is being observed. */
  label: z.string().optional(),
});
export type ObserveAction = z.infer<typeof ObserveActionSchema>;

const AssertionValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/**
 * Generic declarative semantic assertion against a step's response/state.
 * Scenario meaning lives in the manifest data; the runner only interprets
 * these operators generically — there is no scenario-specific assertion
 * code and no general-purpose expression language.
 */
export const AssertionSchema = z.strictObject({
  /** Human-readable expectation; echoed verbatim in failure reports. */
  description: z.string().optional(),
  /**
   * Subject: a dotted path into the step's JSON response (omit to assert the
   * whole body), OR a previously captured binding name via `binding`.
   */
  path: z.string().optional(),
  binding: z.string().optional(),
  op: z.enum([
    'equals',
    'notEquals',
    'truthy',
    'falsy',
    'exists',
    'notExists',
    'arrayNotEmpty',
    'arrayLengthMin',
    'arrayLengthMax',
    'contains',
    'gte',
    'lte',
  ]),
  /** Expected value where the operator needs one; strings support {{binding}}. */
  expected: AssertionValueSchema.optional(),
});
export type Assertion = z.infer<typeof AssertionSchema>;

export const ManifestStepSchema = z.strictObject({
  id: z.string().min(1),
  description: z.string().optional(),
  action: z.discriminatedUnion('type', [
    HttpActionSchema,
    TravellerMessageActionSchema,
    UiActionSchema,
    SimulatedExternalEventActionSchema,
    ObserveActionSchema,
  ]),
  /**
   * Semantic assertions evaluated after status checks and captures. A failed
   * assertion fails the step (and the run) with expected/actual context.
   */
  assert: z.array(AssertionSchema).default([]),
});
export type ManifestStep = z.infer<typeof ManifestStepSchema>;

export const AcceptanceManifestSchema = z.strictObject({
  /** Orchestration metadata only — never a behaviour switch in engine code. */
  scenarioId: z.string().min(1),
  title: z.string().min(1),
  /** Default provider/run mode for this manifest. */
  mode: ScenarioExecutionModeSchema,
  globalInputPack: InputPackRefSchema,
  localInputPack: InputPackRefSchema,
  /**
   * Declared LIVE / RECORD / REPLAY / SIMULATED seams for this run.
   * Preflight verifies these are present; it does not encode business truth.
   */
  boundaries: z.array(BoundaryDeclarationSchema).min(1),
  /** Environment variable names required when mode needs live credentials. */
  requiredEnv: z.array(z.string()).default([]),
  /** Provider adapter ids that must be configured for LIVE/RECORD. */
  requiredProviders: z.array(z.enum(['atlas', 'nuitee', 'modelStudio', 'googleRoutes'])).default([]),
  /** Structural references checked by preflight (existence only). */
  expect: z
    .strictObject({
      anchorEventIds: z.array(EntityIdSchema).default([]),
      travellerIds: z.array(EntityIdSchema).default([]),
      tripIds: z.array(EntityIdSchema).default([]),
    })
    .default({ anchorEventIds: [], travellerIds: [], tripIds: [] }),
  /**
   * Optional structural route/date parameters — validated as shapes only
   * (ISO dates / non-empty airport-like codes), never as business truth.
   */
  routeParams: z
    .array(
      z.strictObject({
        origin: z.string().min(1).optional(),
        destination: z.string().min(1).optional(),
        date: z.string().min(1).optional(),
      }),
    )
    .default([]),
  steps: z.array(ManifestStepSchema).min(1),
});
export type AcceptanceManifest = z.infer<typeof AcceptanceManifestSchema>;

export class ManifestLoadError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = 'ManifestLoadError';
    this.issues = issues;
  }
}

/** Load and validate one acceptance manifest from disk. */
export function loadAcceptanceManifest(manifestPath: string): AcceptanceManifest {
  if (!existsSync(manifestPath)) {
    throw new ManifestLoadError(`manifest not found: ${manifestPath}`);
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new ManifestLoadError(
      `manifest JSON parse failed for ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const parsed = AcceptanceManifestSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`,
    );
    throw new ManifestLoadError(`manifest schema validation failed for ${manifestPath}`, issues);
  }
  return parsed.data;
}

/** Resolve a pack path declared relative to the manifest file. */
export function resolvePackPath(manifestPath: string, packPath: string): string {
  if (isAbsolute(packPath)) return packPath;
  return resolve(dirname(manifestPath), packPath);
}

/** Resolve a manifest path; relative paths resolve from cwd. */
export function resolveManifestPath(path: string, cwd: string = process.cwd()): string {
  return isAbsolute(path) ? path : join(cwd, path);
}
