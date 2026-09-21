/**
 * Deterministic proposer: programme time swaps (B1).
 *
 * Generates recovery options from canonical programme state only. For every
 * programme item a failing subject cannot meet (the item the evaluator named
 * as the unmet requirement), it proposes exchanging that item's window with
 * another item of the SAME programme that starts later — a bilateral
 * `CHANGE_PROGRAMME_ITEM_TIME` pair. Candidates are ordered by how little
 * the programme moves (nearest later slot first), through the end of that
 * programme. Viability, not a nearest-N cap, decides which swaps survive.
 *
 * It does not decide viability: every candidate is evaluated by the real M6
 * registry over an overlay (evaluateRecoveryStrategy), which is where the
 * counterpart's own participants, buffers, resources and objectives are
 * checked. No traveller, event, item title, route or provider is inspected.
 */
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';
import { compareInstants } from '../../../domain/v2/shared/time.ts';
import type { WProgrammeItem } from '../../world/world.ts';
import { MAX_CANDIDATES_PER_PROPOSER, unmetProgrammeItems, type ProposalCandidate, type ProposerInput, type StrategyProposer } from '../proposer.ts';

export const PROGRAMME_TIME_SWAP_PROPOSER_ID = 'proposer.programme-time-swap';

const INACTIVE_LIFECYCLES = new Set(['CANCELLED', 'CLOSED', 'WITHDRAWN', 'SUPERSEDED']);

function swappable(item: WProgrammeItem): item is WProgrammeItem & { window: { start: string; end: string } } {
  return item.window !== null && !INACTIVE_LIFECYCLES.has(item.lifecycleStatus);
}

/**
 * Programme time-swap must keep every later counterpart in the same programme.
 * Other proposers stay on the global candidate ceiling.
 */
export function proposalValidationLimit(proposerId: string, rawCount: number): number {
  if (proposerId === PROGRAMME_TIME_SWAP_PROPOSER_ID) return Math.max(1, rawCount);
  return MAX_CANDIDATES_PER_PROPOSER;
}

export function createProgrammeTimeSwapProposer(): StrategyProposer {
  return {
    id: PROGRAMME_TIME_SWAP_PROPOSER_ID,
    version: '1',
    async propose(input: ProposerInput): Promise<ProposalCandidate[]> {
      const itemsById = new Map(input.world.programmeItems.map((item) => [item.id, item]));
      const candidates: ProposalCandidate[] = [];
      const emitted = new Set<string>();

      for (const failing of [...input.failing].sort((a, b) => a.subject.id.localeCompare(b.subject.id))) {
        for (const unmetRef of unmetProgrammeItems(failing.assessment)) {
          const unmet = itemsById.get(unmetRef.id);
          if (!unmet || !swappable(unmet)) continue;
          const counterparts = input.world.programmeItems
            .filter((other): other is WProgrammeItem & { window: { start: string; end: string } } =>
              other.id !== unmet.id && other.programmeId === unmet.programmeId && swappable(other)
              && compareInstants(other.window!.start, unmet.window.start) > 0)
            .sort((a, b) => compareInstants(a.window.start, b.window.start) || a.id.localeCompare(b.id));

          for (const counterpart of counterparts) {
            const key = `${PROGRAMME_TIME_SWAP_PROPOSER_ID}:${unmet.id}:${counterpart.id}`;
            if (emitted.has(key)) continue;
            emitted.add(key);
            const affected: TypedRef[] = [
              { kind: 'PROGRAMME_ITEM', id: unmet.id },
              { kind: 'PROGRAMME_ITEM', id: counterpart.id },
              failing.subject,
            ];
            candidates.push({
              key,
              effects: [
                { effectKind: 'CHANGE_PROGRAMME_ITEM_TIME', programmeItemId: unmet.id, proposedWindow: { start: counterpart.window.start, end: counterpart.window.end } },
                { effectKind: 'CHANGE_PROGRAMME_ITEM_TIME', programmeItemId: counterpart.id, proposedWindow: { start: unmet.window.start, end: unmet.window.end } },
              ],
              affectedSubjectRefs: affected,
              rationale: `Exchange the windows of two items of the same programme so the unmet obligation starts at ${counterpart.window.start} instead of ${unmet.window.start}; the counterpart takes the earlier window.`,
              assumptions: [
                { code: 'counterpart_accepts_earlier_window', description: 'The counterpart item and its participants can operate in the earlier window; verified by the overlay evaluation, not assumed.', subjectRef: { kind: 'PROGRAMME_ITEM', id: counterpart.id } },
              ],
            });
          }
        }
      }
      return candidates;
    },
  };
}
