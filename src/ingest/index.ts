/**
 * Lane B — source/context ingestion public surface.
 *
 * Ingestion turns sources into validated MutationProposal / RuleSet /
 * TripSignal / uncertainty artifacts. It never mutates authoritative trip
 * state directly (FR-02/FR-04).
 */
export * from './ids.ts';
export * from './source.ts';
export * from './artifacts.ts';
export * from './semantic.ts';
export * from './ruleSets.ts';
export * from './normalize.ts';
export * from './travellerContext.ts';
export * from './structured.ts';
export * from './pipeline.ts';
