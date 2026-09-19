import type { ChangeRequestRecord } from '../change/changeRequest.ts';

/** Read-side contract; submission and lifecycle changes stay in command handlers. */
export interface ChangeRequestReadRepository {
  loadChangeRequest(workspaceId: string, changeRequestId: string): Promise<ChangeRequestRecord | undefined>;
}
