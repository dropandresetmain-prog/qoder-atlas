/**
 * Application entrypoint (F0 skeleton).
 *
 * Starts with no external credentials: config defaults to REPLAY mode, opens
 * SQLite, and serves the health endpoint. Provider/model capability wiring is
 * added by downstream lanes (C/D) behind the seams in `src/contracts/`.
 */
import { loadConfig } from './config/config.ts';
import { openDatabase, kvGet } from './persistence/database.ts';
import { createAppServer } from './server/http.ts';

function main(): void {
  const config = loadConfig();
  const db = openDatabase(config.sqlitePath);

  const server = createAppServer(config);
  server.listen(config.httpPort, () => {
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : config.httpPort;
    console.log(
      `[atlas] AI Trip Recovery Layer started env=${config.environment} mode=${config.adapterMode} ` +
        `schema=v${kvGet(db, 'schema_version')} http=http://localhost:${port}`,
    );
  });

  const shutdown = (signal: string): void => {
    console.log(`[atlas] received ${signal}, shutting down`);
    server.close(() => {
      db.close();
      process.exit(0);
    });
    // Hard exit if connections refuse to drain.
    setTimeout(() => process.exit(1), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
