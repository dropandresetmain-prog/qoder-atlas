/**
 * Lane E public surface. Consumes frozen read models only
 * (`src/contracts/readmodels.ts`); integrator (E3/I5) mounts these pure
 * renderers onto real application endpoints without redesign.
 */
export * from './copy.ts';
export * from './state-inventory.ts';
export * from './case-view-model.ts';
export * from './traveller-presentation.ts';
export * from './html.ts';
export * from './components.ts';
export * from './page.ts';
export * from './screens/operator-dashboard.ts';
export * from './screens/operator-case.ts';
export * from './screens/operator-programme.ts';
export * from './screens/traveller.ts';
export * from './screens/demo-panel.ts';
export * as fixtures from './fixtures/readmodels.ts';
