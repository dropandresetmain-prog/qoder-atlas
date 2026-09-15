/**
 * Attach M9 target product HTTP to an existing Node server dispatcher.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { composeTargetApplication, type TargetApplication, type TargetApplicationOptions } from './composeTargetApplication.ts';
import { handleTargetProductHttp } from './targetHttpHandlers.ts';

export interface TargetEndpoints {
  app: TargetApplication;
  handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean>;
  close(): Promise<void>;
}

export async function composeTargetEndpoints(
  options: TargetApplicationOptions,
): Promise<TargetEndpoints> {
  const app = await composeTargetApplication(options);
  return {
    app,
    handle: (req, res, url) => handleTargetProductHttp({ app }, req, res, url),
    close: () => app.close(),
  };
}
