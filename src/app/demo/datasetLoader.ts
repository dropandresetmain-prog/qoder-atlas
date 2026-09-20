/**
 * Demo/input-boundary dataset loader.
 *
 * Reads a *configured* dataset directory (`NORTHSTAR_DEMO_DATASET_DIR`) — no
 * dataset path, file set or content is compiled into the application. The
 * directory's whole JSON content is hashed into one dataset content hash so
 * provisioning can tell "already loaded, unchanged" from "same identity,
 * different content" without re-reading the world.
 *
 * Files the materializer does not express (for example money/custody detail
 * whose target home is not built yet) are still hashed: they are part of the
 * dataset's identity even when they are deliberately not materialized, so a
 * change to them is never silently invisible.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DatasetGroundTransfersSchema,
  DatasetJourneyRequirementsSchema,
  DatasetJurisdictionsSchema,
  DatasetProgrammeSchema,
  type DatasetJourneyRequirement,
  type DatasetGroundTransfers,
  type DatasetJourneyRequirements,
  type DatasetJurisdictions,
  type DatasetProgramme,
} from './datasetSchema.ts';
import { mergeEnvWithDotenvFiles } from '../../config/config.ts';

/** Required: the programme/roster document. */
export const PROGRAMME_FILE = 'programme.json';
/** Optional: registered ground-transfer durations. */
export const GROUND_TRANSFERS_FILE = 'ground-transfers.json';
/** Optional: place->jurisdiction attribution and knowledge coverage. */
export const JURISDICTIONS_FILE = 'jurisdictions.json';
/** Optional typed Journey requirements declared by the source organiser. */
export const JOURNEY_REQUIREMENTS_FILE = 'journey-requirements.json';

export interface LoadedDataset {
  /** Stable dataset identity, derived from the configured directory name. */
  datasetKey: string;
  directory: string;
  /** sha256 over every JSON file in the directory, name-ordered. */
  contentHash: string;
  /** Every JSON file that contributed to `contentHash`, name-ordered. */
  contributingFiles: string[];
  programme: DatasetProgramme;
  groundTransfers: DatasetGroundTransfers | undefined;
  jurisdictions: DatasetJurisdictions | undefined;
  journeyRequirements?: DatasetJourneyRequirements;
}

export class DatasetLoadError extends Error {
  readonly directory: string;
  constructor(message: string, directory: string) {
    super(message);
    this.name = 'DatasetLoadError';
    this.directory = directory;
  }
}

function sourceJourneyItemAlias(travellerDraftId: string, index: number): string {
  return `journey-item:${travellerDraftId}#${index}`;
}

function validateJourneyRequirementRefs(
  requirements: readonly DatasetJourneyRequirement[],
  travellers: DatasetProgramme['importDraft']['travellers'],
  directory: string,
): void {
  for (const requirement of requirements) {
    if (requirement.kind !== 'STAY_ARRIVAL_DATE_ALIGNED') continue;
    const traveller = travellers.find((candidate) => candidate.draftId === requirement.travellerDraftId);
    if (!traveller) continue;
    const resolve = (ref: { system: string; value: string }, label: string) => {
      const matches = traveller.declaredTravel.flatMap((item, index) =>
        sourceJourneyItemAlias(traveller.draftId, index) === `${ref.system}:${ref.value}` ? [{ item, index }] : [],
      );
      if (matches.length !== 1) {
        throw new DatasetLoadError(
          `${JOURNEY_REQUIREMENTS_FILE} requirement ${requirement.id} ${label} ${ref.system}:${ref.value} ` +
            `must resolve to exactly one declared item for traveller ${traveller.draftId}`,
          directory,
        );
      }
      return matches[0]!;
    };
    const original = resolve(requirement.originalStayItemRef, 'original stay item reference');
    const arrival = resolve(requirement.arrivalTransportItemRef, 'arrival transport item reference');
    if (original.item.itemKind !== 'STAY') {
      throw new DatasetLoadError(`${JOURNEY_REQUIREMENTS_FILE} requirement ${requirement.id} original stay item is not a STAY`, directory);
    }
    if (arrival.item.itemKind !== 'TRANSPORT_LEG') {
      throw new DatasetLoadError(`${JOURNEY_REQUIREMENTS_FILE} requirement ${requirement.id} arrival item is not a TRANSPORT_LEG`, directory);
    }
    if (original.index === arrival.index) {
      throw new DatasetLoadError(`${JOURNEY_REQUIREMENTS_FILE} requirement ${requirement.id} references one item twice`, directory);
    }
  }
}

/** Configured dataset directory, or undefined when no demo dataset is configured. */
export function datasetDirectoryFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const merged = mergeEnvWithDotenvFiles(env);
  const raw = (merged.NORTHSTAR_DEMO_DATASET_DIR ?? '').trim();
  return raw === '' ? undefined : path.resolve(raw);
}

async function readJsonFile(directory: string, file: string): Promise<{ text: string; parsed: unknown } | undefined> {
  try {
    const text = await readFile(path.join(directory, file), 'utf8');
    return { text, parsed: JSON.parse(text) as unknown };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new DatasetLoadError(`dataset file ${file} could not be read: ${String(error)}`, directory);
  }
}

export async function loadDataset(directory: string): Promise<LoadedDataset> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    throw new DatasetLoadError(`dataset directory could not be read: ${String(error)}`, directory);
  }

  const jsonFiles = entries.filter((name) => name.endsWith('.json')).sort();
  if (!jsonFiles.includes(PROGRAMME_FILE)) {
    throw new DatasetLoadError(`dataset directory does not contain ${PROGRAMME_FILE}`, directory);
  }

  const hash = createHash('sha256');
  for (const name of jsonFiles) {
    const bytes = await readFile(path.join(directory, name));
    hash.update(name, 'utf8');
    hash.update('\0');
    hash.update(bytes);
    hash.update('\0');
  }

  const programmeRaw = await readJsonFile(directory, PROGRAMME_FILE);
  const programme = DatasetProgrammeSchema.safeParse(programmeRaw?.parsed);
  if (!programme.success) {
    throw new DatasetLoadError(`${PROGRAMME_FILE} does not match the dataset contract: ${programme.error.message}`, directory);
  }

  const groundRaw = await readJsonFile(directory, GROUND_TRANSFERS_FILE);
  let groundTransfers: DatasetGroundTransfers | undefined;
  if (groundRaw) {
    const parsed = DatasetGroundTransfersSchema.safeParse(groundRaw.parsed);
    if (!parsed.success) {
      throw new DatasetLoadError(`${GROUND_TRANSFERS_FILE} does not match the dataset contract: ${parsed.error.message}`, directory);
    }
    groundTransfers = parsed.data;
  }

  const jurisdictionsRaw = await readJsonFile(directory, JURISDICTIONS_FILE);
  let jurisdictions: DatasetJurisdictions | undefined;
  if (jurisdictionsRaw) {
    const parsed = DatasetJurisdictionsSchema.safeParse(jurisdictionsRaw.parsed);
    if (!parsed.success) {
      throw new DatasetLoadError(`${JURISDICTIONS_FILE} does not match the dataset contract: ${parsed.error.message}`, directory);
    }
    jurisdictions = parsed.data;
  }

  const journeyRequirementsRaw = await readJsonFile(directory, JOURNEY_REQUIREMENTS_FILE);
  let journeyRequirements: DatasetJourneyRequirements | undefined;
  if (journeyRequirementsRaw) {
    const parsed = DatasetJourneyRequirementsSchema.safeParse(journeyRequirementsRaw.parsed);
    if (!parsed.success) {
      throw new DatasetLoadError(`${JOURNEY_REQUIREMENTS_FILE} does not match the dataset contract: ${parsed.error.message}`, directory);
    }
    const knownTravellerDraftIds = new Set(programme.data.importDraft.travellers.map((traveller) => traveller.draftId));
    const unknown = parsed.data.requirements.find((requirement) => !knownTravellerDraftIds.has(requirement.travellerDraftId));
    if (unknown) {
      throw new DatasetLoadError(`${JOURNEY_REQUIREMENTS_FILE} references unknown traveller draft ${unknown.travellerDraftId}`, directory);
    }
    validateJourneyRequirementRefs(parsed.data.requirements, programme.data.importDraft.travellers, directory);
    journeyRequirements = parsed.data;
  }

  return {
    datasetKey: path.basename(directory),
    directory,
    contentHash: hash.digest('hex'),
    contributingFiles: jsonFiles,
    programme: programme.data,
    groundTransfers,
    jurisdictions,
    journeyRequirements,
  };
}
