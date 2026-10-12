import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";

import { createApplication } from "./app.js";
import { loadServerConfig } from "./config.js";
import { closeDatabasePool, createDatabasePool } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { attachSocketServer } from "./realtime/socket-server.js";
import { createOutboxPublisher } from "./services/outbox-publisher.js";
import { createDispatchCoordinator } from "./dispatch/dispatch-coordinator.js";
import { LocalMockAdapter } from "./dispatch/local-mock-adapter.js";

const config = loadServerConfig();
const pool = createDatabasePool(config);
try {
  await runMigrations(pool);
} catch {
  process.stderr.write("SIGAP startup failed: database or schema is not ready.\n");
  await closeDatabasePool(pool);
  process.exit(1);
}
const runtime = createApplication(config, pool);
const server = config.tlsCertPath && config.tlsKeyPath
  ? createHttpsServer(
      { cert: readFileSync(config.tlsCertPath), key: readFileSync(config.tlsKeyPath) },
      runtime.app,
    )
  : createHttpServer(runtime.app);

const sockets = attachSocketServer(server, runtime.services, runtime.staffSessions.middleware, runtime.staffSessions);
runtime.setSocketSessionRevoker(sockets.disconnectStaffSession);
runtime.setSocketAccountRevoker(sockets.disconnectStaffAccount);
const outboxPublisher = createOutboxPublisher(pool, sockets.publishOutboxEvent);
const dispatchCoordinator = createDispatchCoordinator(pool, new LocalMockAdapter());

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const forceExit = setTimeout(() => {
    process.stderr.write("SIGAP shutdown exceeded its grace period.\n");
    process.exit(1);
  }, 30_000);
  forceExit.unref();
  try {
    const httpClosed = new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") reject(error);
        else resolve();
      });
      server.closeIdleConnections();
    });
    await sockets.stopAcceptingUpdates();
    await runtime.services.stopAcceptingMutations();
    await dispatchCoordinator.stop();
    await outboxPublisher.stop();
    await new Promise<void>((resolve) => sockets.io.close(() => resolve()));
    await httpClosed;
    await closeDatabasePool(pool);
    clearTimeout(forceExit);
  } catch {
    process.stderr.write("SIGAP graceful shutdown failed.\n");
    process.exitCode = 1;
    try { await closeDatabasePool(pool); } catch { /* safe fixed-message log only */ }
    clearTimeout(forceExit);
  }
}
process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
outboxPublisher.start();
dispatchCoordinator.start();
server.once("error", () => {
  process.stderr.write("SIGAP HTTP server failed to start.\n");
  process.exitCode = 1;
  void shutdown();
});
server.listen(config.port, config.host, () => {
  const scheme = config.secureCookies ? "https" : "http";
  process.stdout.write(`SIGAP staging server listening at ${scheme}://${config.host}:${config.port}\n`);
});
