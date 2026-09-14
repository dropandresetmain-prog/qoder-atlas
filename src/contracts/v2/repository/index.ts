/**
 * NORTHSTAR v2 repository ports barrel (M2).
 *
 * Kept out of `contracts/v2/index.ts` on purpose: the protocol contracts there
 * are frozen C0 material shared by every lane, while these ports grow with each
 * milestone's tables. Import this module (or a single file from it), not the
 * PostgreSQL implementations, from domain handlers.
 */
export type * from './people.ts';
export type * from './travel.ts';
export type * from './queries.ts';
export type * from './arrangements.ts';
export type * from './arrangementQueries.ts';
