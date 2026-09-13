/**
 * NORTHSTAR v2 domain barrel — schema/type contracts only.
 *
 * Deliberately NOT imported by production runtime composition during M0
 * (see docs/refactor/CONTRACTS.md "Isolation from production composition").
 */
export * from './shared/index.ts';
export * from './people/traveller.ts';
export * from './trip/trip.ts';
export * from './trip/support.ts';
export * from './arrangements/reservation.ts';
export * from './programmes/programme.ts';
export * from './knowledge/information.ts';
