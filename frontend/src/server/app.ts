import { guardCitizenIntake } from "./security/intake-throttle.js";
import { createMonitoringRouter } from "./routes/monitoring.js";
import express, { type ErrorRequestHandler, type Express } from "express";
import { existsSync } from "node:fs";
import path from "node:path";

import type { Pool } from "pg";
import { getMigrationStatus } from "./db/migrate.js";
import type { ServerConfig } from "./config.js";
import { ApiError, type ApiErrorResponse } from "./errors.js";
import { createCitizenIncidentsRouter } from "./routes/citizen-incidents.js";
import { createStaffIncidentsRouter } from "./routes/staff-incidents.js";
import { createPublicOperationsRouter, createStaffOperationsRouter } from "./routes/operations.js";
import { createIncidentService, type IncidentServices } from "./services/incident-service.js";
import { createPostgresOutboxWriter } from "./services/outbox-publisher.js";
import type { StaffSessionManager } from "./auth/staff-session.js";
import { createPostgresIncidentRepository } from "./store/postgres-incident-repository.js";
import { guardStaffMutation } from "./security/staff-request-guard.js";
import { createStaffOutboxRouter } from "./routes/outbox-review.js";
import { createStaffDispatchRouter } from "./routes/dispatch.js";

export interface ApplicationRuntime {
  app: Express;
  services: IncidentServices;
  staffSessions: StaffSessionManager;
  setSocketAccountRevoker(revoker: (staffId: string) => void): void;
  setSocketSessionRevoker(revoker: (sessionId: string) => void): void;
}

export function createApplication(config: ServerConfig, pool: Pool): ApplicationRuntime {
  const app = express();
  const outbox = createPostgresOutboxWriter();
  const services = createIncidentService(createPostgresIncidentRepository(pool, outbox));
  let revokeAccountSockets: (staffId: string) => void = () => {};
  let revokeStaffSockets: (sessionId: string) => void = () => {};
  const staffRoutes = createStaffIncidentsRouter(config, pool, services, (sessionId) => {
    revokeStaffSockets(sessionId);
  }, (staffId) => { revokeAccountSockets(staffId); });

  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  // Reject unsafe cookie-authenticated requests before body/session/DB work.
  app.use("/api/staff", (_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api/staff", guardStaffMutation);
  // Count malformed create attempts before body parsing or session/incident work.
  app.post("/api/citizen/incidents", guardCitizenIntake(pool, config.sessionSecret));
  app.use(express.json({ limit: "8kb", strict: true }));
  app.use(staffRoutes.sessions.middleware);

  app.get("/api/healthz", (_request, response) => {
    response.json({ status: "ok" });
  });
  app.get("/api/readyz", async (_request, response) => {
    try {
      const schema = await getMigrationStatus(pool);
      response.status(schema.ready ? 200 : 503).json({
        status: schema.ready ? "ready" : "not_ready",
        schemaVersion: schema.currentVersion,
      });
    } catch {
      response.status(503).json({ status: "not_ready" });
    }
  });
  app.use("/api/citizen", createCitizenIncidentsRouter(services));
  app.use("/api/operations", createPublicOperationsRouter(pool));
  app.use("/api/staff/operations", createStaffOperationsRouter(pool));
  app.use("/api/staff/monitoring", createMonitoringRouter(pool));
  app.use("/api/staff/realtime", createStaffOutboxRouter(pool));
  app.use("/api/staff", createStaffDispatchRouter(pool));
  app.use("/api/staff", staffRoutes.router);

  if (existsSync(config.clientDistPath)) {
    app.use(express.static(config.clientDistPath, { index: false }));
    const indexPath = path.join(config.clientDistPath, "index.html");
    app.use((request, response, next) => {
      if (
        (request.method === "GET" || request.method === "HEAD") &&
        !request.path.startsWith("/api") &&
        request.path !== "/socket.io" &&
        request.accepts("html") &&
        existsSync(indexPath)
      ) {
        response.sendFile(indexPath, (error) => {
          if (error) next(error);
        });
        return;
      }
      next();
    });
  }

  app.use((_request, response) => {
    const body: ApiErrorResponse = { error: { code: "not_found", message: "Resource was not found." } };
    response.status(404).json(body);
  });

  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof ApiError) {
      const body: ApiErrorResponse = { error: { code: error.code, message: error.message } };
      response.status(error.status).json(body);
      return;
    }

    const errorType =
      typeof error === "object" && error !== null && "type" in error
        ? String((error as { type: unknown }).type)
        : "";
    const parseError = errorType === "entity.parse.failed" || error instanceof SyntaxError;
    const tooLarge = errorType === "entity.too.large";
    const status = tooLarge ? 413 : parseError ? 400 : 500;
    const body: ApiErrorResponse = {
      error: {
        code: tooLarge ? "payload_too_large" : parseError ? "invalid_json" : "internal_error",
        message: tooLarge
          ? "Request body must not exceed 8 KB."
          : parseError
            ? "Request body could not be parsed."
            : "Internal server error.",
      },
    };
    response.status(status).json(body);
  };
  app.use(errorHandler);

  return {
    app,
    services,
    staffSessions: staffRoutes.sessions,
    setSocketAccountRevoker(revoker) { revokeAccountSockets = revoker; },
    setSocketSessionRevoker(revoker) {
      revokeStaffSockets = revoker;
    },
  };
}
