/**
 * Data-driven Demo Console control catalog.
 *
 * Presentation labels (including hero section names) live in configured demo
 * data. Application code understands only generic kinds/variants.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { mergeEnvWithDotenvFiles } from '../../config/config.ts';
import { disruptionEventFileFromEnv } from './providerDisruptionEventSource.ts';
import {
  clockOnlyStages,
  loadTimeline,
  providerEventStages,
  type DelayTimeline,
} from './progressiveDelayTimeline.ts';

export type DemoControlKind = 'PROVIDER_EVENT' | 'EVALUATION_CLOCK_ADVANCE';

export type DemoControlVariant =
  | 'CONFIGURED_AIRLINE_REBOOKING'
  | 'TIMELINE_PROVIDER_STAGE'
  | 'TIMELINE_CLOCK_STAGE';

export interface DemoControlDefinition {
  id: string;
  kind: DemoControlKind;
  variant: DemoControlVariant;
  group: string;
  label: string;
  description: string;
  order: number;
  /** Timeline stage id when variant is TIMELINE_*. */
  stageId?: string;
}

export interface DemoControlCatalog {
  controls: DemoControlDefinition[];
  timelinePath?: string;
  timeline?: DelayTimeline;
  disruptionEventFile?: string;
}

interface RawControlEntry {
  id?: unknown;
  kind?: unknown;
  variant?: unknown;
  group?: unknown;
  label?: unknown;
  description?: unknown;
  order?: unknown;
  stageId?: unknown;
}

interface RawCatalogFile {
  timelinePath?: unknown;
  controls?: unknown;
}

export function demoControlsFileFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const merged = mergeEnvWithDotenvFiles(env);
  const raw = (merged.NORTHSTAR_DEMO_CONTROLS_FILE ?? '').trim();
  return raw === '' ? undefined : raw;
}

export function progressiveDelayTimelineFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const merged = mergeEnvWithDotenvFiles(env);
  const raw = (merged.NORTHSTAR_DEMO_PROGRESSIVE_DELAY_TIMELINE ?? '').trim();
  return raw === '' ? undefined : raw;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function parseControl(raw: RawControlEntry): DemoControlDefinition | undefined {
  const id = asString(raw.id);
  const kind = asString(raw.kind);
  const variant = asString(raw.variant);
  const group = asString(raw.group) ?? 'Demo';
  const label = asString(raw.label);
  const description = asString(raw.description) ?? '';
  const order = typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : 100;
  const stageId = asString(raw.stageId);
  if (!id || !label) return undefined;
  if (kind !== 'PROVIDER_EVENT' && kind !== 'EVALUATION_CLOCK_ADVANCE') return undefined;
  if (
    variant !== 'CONFIGURED_AIRLINE_REBOOKING'
    && variant !== 'TIMELINE_PROVIDER_STAGE'
    && variant !== 'TIMELINE_CLOCK_STAGE'
  ) {
    return undefined;
  }
  if (
    (variant === 'TIMELINE_PROVIDER_STAGE' || variant === 'TIMELINE_CLOCK_STAGE')
    && !stageId
  ) {
    return undefined;
  }
  return {
    id,
    kind,
    variant,
    group,
    label,
    description,
    order,
    ...(stageId ? { stageId } : {}),
  };
}

function loadRawCatalog(path: string): RawCatalogFile {
  return JSON.parse(readFileSync(path, 'utf8')) as RawCatalogFile;
}

function synthesizeFromConfiguredSources(
  disruptionEventFile: string | undefined,
  timelinePath: string | undefined,
  timeline: DelayTimeline | undefined,
): DemoControlDefinition[] {
  const controls: DemoControlDefinition[] = [];
  if (disruptionEventFile) {
    controls.push({
      id: 'airline-disruption-configured',
      kind: 'PROVIDER_EVENT',
      variant: 'CONFIGURED_AIRLINE_REBOOKING',
      group: 'Configured provider event',
      label: 'Trigger configured airline disruption',
      description: 'Applies the configured disclosed airline event through the normal provider-event boundary.',
      order: 10,
    });
  }
  if (timeline) {
    let order = 20;
    for (const stage of providerEventStages(timeline)) {
      controls.push({
        id: stage.id,
        kind: 'PROVIDER_EVENT',
        variant: 'TIMELINE_PROVIDER_STAGE',
        stageId: stage.id,
        group: 'Progressive delay',
        label: stage.narrative?.slice(0, 80) || stage.id,
        description: stage.narrative ?? `Provider-event stage ${stage.id}`,
        order,
      });
      order += 10;
    }
    for (const stage of clockOnlyStages(timeline)) {
      controls.push({
        id: stage.id,
        kind: 'EVALUATION_CLOCK_ADVANCE',
        variant: 'TIMELINE_CLOCK_STAGE',
        stageId: stage.id,
        group: 'Progressive delay',
        label: stage.narrative?.slice(0, 80) || stage.id,
        description: stage.narrative ?? `Clock advance to ${stage.planningNow}`,
        order,
      });
      order += 10;
    }
  }
  void timelinePath;
  return controls;
}

/**
 * Load available demo controls from configured catalog file and/or configured
 * disruption + progressive-delay sources. Returns an empty catalog when nothing
 * is configured (caller still gates behind demoResetGate).
 */
export function loadDemoControlCatalog(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): DemoControlCatalog {
  const catalogPath = demoControlsFileFromEnv(env);
  const disruptionEventFile = disruptionEventFileFromEnv(env);
  let timelinePath = progressiveDelayTimelineFromEnv(env);
  let controls: DemoControlDefinition[] = [];

  if (catalogPath) {
    const abs = resolve(cwd, catalogPath);
    if (!existsSync(abs)) {
      throw new Error(`demo controls file not found: ${catalogPath}`);
    }
    const raw = loadRawCatalog(abs);
    const fromFile = Array.isArray(raw.controls)
      ? raw.controls
        .map((entry) => parseControl(entry as RawControlEntry))
        .filter((entry): entry is DemoControlDefinition => entry !== undefined)
      : [];
    const fileTimeline = asString(raw.timelinePath);
    if (fileTimeline && !timelinePath) timelinePath = fileTimeline;
    controls = fromFile;
  }

  let timeline: DelayTimeline | undefined;
  if (timelinePath) {
    const absTimeline = resolve(cwd, timelinePath);
    if (!existsSync(absTimeline)) {
      throw new Error(`progressive delay timeline not found: ${timelinePath}`);
    }
    timeline = loadTimeline(absTimeline);
  }

  if (controls.length === 0) {
    controls = synthesizeFromConfiguredSources(disruptionEventFile, timelinePath, timeline);
  } else {
    // Drop airline control when the runtime has no disclosed event file.
    controls = controls.filter((control) => {
      if (control.variant === 'CONFIGURED_AIRLINE_REBOOKING') return Boolean(disruptionEventFile);
      return true;
    });
  }

  controls = [...controls].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  return {
    controls,
    ...(timelinePath ? { timelinePath } : {}),
    ...(timeline ? { timeline } : {}),
    ...(disruptionEventFile ? { disruptionEventFile } : {}),
  };
}

export function findDemoControl(
  catalog: DemoControlCatalog,
  id: string,
): DemoControlDefinition | undefined {
  return catalog.controls.find((control) => control.id === id);
}
