import {
  IncidentProgrammeViewSchema,
  type IncidentProgrammeView,
} from '../../../contracts/v2/product/readModels.ts';
import { buildChangeAwareness } from './changeAwareness.ts';
import { projectLiveDependencyGraph } from './liveDependencyGraph.ts';
import type { IncidentProgrammeFacts } from './types.ts';

export function projectIncidentProgramme(input: IncidentProgrammeFacts): IncidentProgrammeView {
  const ldg = projectLiveDependencyGraph({
    ...input,
    scope: 'INCIDENT_PROGRAMME',
  });
  return IncidentProgrammeViewSchema.parse({
    generatedAt: input.generatedAt,
    incidentRef: input.incidentRef,
    sourceChangeSummary: input.sourceChangeSummary,
    affectedSet: input.affectedSet.map((entry) => ({ ...entry })),
    programmeCommitments: input.programmeCommitments.map((entry) => ({
      itemRef: entry.itemRef,
      label: entry.label,
      ...(entry.windowLabel ? { windowLabel: entry.windowLabel } : {}),
      state: entry.state,
    })),
    ...(input.currentProgrammeState ? { currentProgrammeState: input.currentProgrammeState } : {}),
    ...(input.proposedProgrammeState ? { proposedProgrammeState: input.proposedProgrammeState } : {}),
    ldg,
    change: buildChangeAwareness(input),
  });
}
