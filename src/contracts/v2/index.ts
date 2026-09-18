/**
 * NORTHSTAR v2 contracts barrel — protocol/interaction contracts only.
 *
 * Deliberately NOT imported by production runtime composition during M0
 * (see docs/refactor/CONTRACTS.md "Isolation from production composition").
 */
export * from './command/domainCommand.ts';
export type * from './command/unitOfWork.ts';
export * from './scope/readScope.ts';
export * from './assessment/assessmentManifest.ts';
export * from './ingestion/informationIngestion.ts';
export * from './scenario/scenarioChange.ts';
export * from './scenario/recoveryStrategy.ts';
export * from './planning/index.ts';
export * from './action/actionPlan.ts';
export * from './authority/authorityEnvelope.ts';
export * from './execution/execution.ts';
export * from './migration/migrationEnvelope.ts';
export * from './extension/extensionRegistration.ts';
