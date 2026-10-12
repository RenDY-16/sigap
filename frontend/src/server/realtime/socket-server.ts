import type { IncomingMessage, ServerResponse, Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import type { Request, Response, RequestHandler } from "express";
import { Server, type Socket } from "socket.io";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import type {
  ClientToServerEvents,
  IncidentSocketError,
  InterServerEvents,
  LocationUpdateAcknowledgement,
  IncidentRealtimeEnvelope,
  ServerToClientEvents,
  SocketData,
} from "../../shared/socket-events.js";
import { ApiError } from "../errors.js";
import type { IncidentServices } from "../services/incident-service.js";
import type { StaffSessionManager } from "../auth/staff-session.js";
import { hasStaffCapability, lockStaffAccess } from "../identity/staff-policy.js";
import { STAFF_ADMIN_ADVISORY_LOCK_KEY } from "../identity/staff-repository.js";

function staffRegionRoom(regionId: string): string {
  return `staff:region:${regionId}:incidents`;
}

export interface ManagedSocketServer {
  io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
  disconnectStaffSession(sessionId: string): void;
  disconnectStaffAccount(staffId: string): void;
  stopAcceptingUpdates(): Promise<void>;
  publishOutboxEvent(envelope: IncidentRealtimeEnvelope, client: PoolClient): Promise<boolean>;
}

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type HttpOrHttpsServer = HttpServer | HttpsServer;

function incidentRoom(incidentId: string): string {
  return `incident:${incidentId}`;
}

function socketError(error: unknown): IncidentSocketError {
  if (error instanceof ApiError) return { code: error.code, message: error.message };
  return { code: "location_update_failed", message: "The location update was not accepted." };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function staffSessionId(socket: { data: SocketData }): string | undefined {
  return socket.data.audience === "staff" ? socket.data.sessionId : undefined;
}

export function attachSocketServer(
  server: HttpOrHttpsServer,
  services: IncidentServices,
  sessionMiddleware: RequestHandler,
  staffSessions: Pick<StaffSessionManager, "resolvePrincipalForSession">,
): ManagedSocketServer {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(server, {
    serveClient: false,
  });

  io.engine.use(
    (
      request: IncomingMessage,
      response: ServerResponse,
      next: (error?: any) => void,
    ) => {
      sessionMiddleware(request as unknown as Request, response as unknown as Response, next);
    },
  );

  const staffSocketsBySession = new Map<string, Set<AppSocket>>();
  const staffSocketsByAccount = new Map<string, Set<AppSocket>>();
  async function syncStaffRooms(socket: AppSocket, regionIds: string[]): Promise<void> {
    const previous = socket.data.regionIds ?? [];
    for (const regionId of previous) {
      if (!regionIds.includes(regionId)) await socket.leave(staffRegionRoom(regionId));
    }
    for (const regionId of regionIds) await socket.join(staffRegionRoom(regionId));
    socket.data.regionIds = [...regionIds];
  }
  function trackStaffSocket(socket: AppSocket, sessionId: string, staffId: string): void {
    const sessions = staffSocketsBySession.get(sessionId) ?? new Set<AppSocket>();
    sessions.add(socket);
    staffSocketsBySession.set(sessionId, sessions);
    const accounts = staffSocketsByAccount.get(staffId) ?? new Set<AppSocket>();
    accounts.add(socket);
    staffSocketsByAccount.set(staffId, accounts);
  }
  const inFlightLocationUpdates = new Set<Promise<void>>();
  let acceptingLocationUpdates = true;

  io.use(async (socket, next) => {
    const query = socket.handshake.query;
    if (query.accessToken !== undefined || query.token !== undefined) {
      next(new Error("Citizen tokens must be provided through socket auth."));
      return;
    }

    const auth = socket.handshake.auth;
    const accessToken = isRecord(auth) ? auth.accessToken : undefined;
    if (typeof accessToken === "string") {
      try {
        const incident = await services.getIncidentForCitizen(accessToken);
        socket.data.audience = "citizen";
        socket.data.incidentId = incident.id;
        await socket.join(incidentRoom(incident.id));
        next();
      } catch {
        next(new Error("Citizen session was not authorized."));
      }
      return;
    }

    const request = socket.request as IncomingMessage & Request & { sessionID?: string };
    const sessionId = request.sessionID;
    try {
      const principal = typeof sessionId === "string"
        ? await staffSessions.resolvePrincipalForSession(sessionId) : null;
      if (!principal || !sessionId || !hasStaffCapability(principal, "read_incidents") || !principal.regionIds.length) {
        next(new Error("A citizen token or signed-in staff session is required."));
        return;
      }
      socket.data.audience = "staff";
      socket.data.sessionId = sessionId;
      socket.data.staffId = principal.id;
      await syncStaffRooms(socket, principal.regionIds);
      next();
    } catch {
      next(new Error("Staff session was not authorized."));
    }
  });

  io.on("connection", async (rawSocket) => {
    const socket = rawSocket as AppSocket;
    socket.on("disconnect", () => {
      const sessionId = staffSessionId(socket);
      if (!sessionId) return;
      const sessions = staffSocketsBySession.get(sessionId);
      sessions?.delete(socket);
      if (sessions?.size === 0) staffSocketsBySession.delete(sessionId);
      const staffId = socket.data.staffId;
      if (!staffId) return;
      const accounts = staffSocketsByAccount.get(staffId);
      accounts?.delete(socket);
      if (accounts?.size === 0) staffSocketsByAccount.delete(staffId);
    });
    if (socket.data.audience === "staff") {
      const sessionId = staffSessionId(socket);
      const staffId = socket.data.staffId;
      if (!sessionId || !staffId) { socket.disconnect(true); return; }
      // Track before awaiting DB work so a committed admin revoke can disconnect
      // a connection that is still being initialized. Re-read after handshake.
      trackStaffSocket(socket, sessionId, staffId);
      try {
        const principal = await staffSessions.resolvePrincipalForSession(sessionId);
        if (!principal || principal.id !== staffId || !hasStaffCapability(principal, "read_incidents") || !principal.regionIds.length) {
          socket.disconnect(true);
        } else if (socket.connected) {
          await syncStaffRooms(socket, principal.regionIds);
        }
      } catch { socket.disconnect(true); }
    }
    if (socket.data.audience === "citizen" && socket.data.incidentId) {
      try {
        const incident = await services.getIncidentForCitizen(
          typeof socket.handshake.auth?.accessToken === "string"
            ? socket.handshake.auth.accessToken
            : "",
        );
        socket.emit("incident:snapshot", incident);
      } catch {
        socket.disconnect(true);
      }
    }

    socket.on("incident:location:update", (rawUpdate, acknowledge) => {
      const operation = (async () => {
      const respond = (result: LocationUpdateAcknowledgement) => acknowledge?.(result);
      if (!acceptingLocationUpdates) {
        const error: IncidentSocketError = { code: "server_shutting_down", message: "The staging server is stopping; location updates were not accepted." };
        socket.emit("incident:error", error);
        respond({ ok: false, error });
        return;
      }
      if (socket.data.audience !== "citizen" || !socket.data.incidentId) {
        const error: IncidentSocketError = {
          code: "citizen_socket_required",
          message: "GPS updates require an authorized citizen incident socket.",
        };
        socket.emit("incident:error", error);
        respond({ ok: false, error });
        return;
      }

      if (!isRecord(rawUpdate)) {
        const error: IncidentSocketError = { code: "invalid_location", message: "A valid GPS point is required." };
        socket.emit("incident:error", error);
        respond({ ok: false, error });
        return;
      }

      try {
        const incident = await services.updateGpsLocation(socket.data.incidentId, {
          lat: rawUpdate.lat as number,
          lng: rawUpdate.lng as number,
          measuredAt: rawUpdate.measuredAt as string,
        });
        respond({ ok: true, incident });
      } catch (error) {
        const serialized = socketError(error);
        socket.emit("incident:error", serialized);
        respond({ ok: false, error: serialized });
      }
      })();
      inFlightLocationUpdates.add(operation);
      void operation.then(
        () => inFlightLocationUpdates.delete(operation),
        () => inFlightLocationUpdates.delete(operation),
      );
    });
  });

  async function publishOutboxEvent(envelope: IncidentRealtimeEnvelope, client: PoolClient): Promise<boolean> {
    try {
      if (!envelope.incident.id) return false;
      // The outbox transaction may own the pool's only connection. Every query
      // below (including principal/session resolution) uses this same client.
      // Shared admin mutex precedes account/session locks and read-only incident lookup. Admin writes
      // take the exclusive mutex, so accumulating recipients across a batch cannot
      // deadlock with an admin holding another recipient's account for update.
      await client.query("SELECT pg_advisory_xact_lock_shared($1::bigint)", [STAFF_ADMIN_ADVISORY_LOCK_KEY]);
      const candidates = [...staffSocketsByAccount.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([, sockets]) => [...sockets].sort((left, right) => (left.data.sessionId ?? "").localeCompare(right.data.sessionId ?? "")));
      const authorized: { socket: AppSocket; staffId: string; regionIds: string[] }[] = [];
      for (const socket of candidates) {
        if (!socket.connected) continue;
        const sessionId = staffSessionId(socket);
        const principal = sessionId ? await staffSessions.resolvePrincipalForSession(sessionId, client) : null;
        if (!principal || !sessionId || principal.id !== socket.data.staffId) {
          socket.disconnect(true);
          continue;
        }
        try {
          const current = await lockStaffAccess(client, { principal, sessionId }, "read_incidents");
          authorized.push({ socket, staffId: current.id, regionIds: current.regionIds });
        } catch (error) {
          if (!(error instanceof ApiError)) throw error;
          socket.disconnect(true);
        }
      }
      // Region is storage authority, including historical outbox payloads without
      // region. Read storage after staff access; never trust the public incident DTO.
      const incident = await client.query<{ region_id: string }>(
        "SELECT region_id FROM incidents WHERE id=$1", [envelope.incident.id],
      );
      const regionId = incident.rows[0]?.region_id;
      if (!regionId) return false;
      const recipients = authorized.filter(recipient => recipient.socket.connected && recipient.regionIds.includes(regionId));
      for (const recipient of authorized) {
        if (recipient.socket.connected) await syncStaffRooms(recipient.socket, recipient.regionIds);
      }
      // Audit every authorized delivery before any emit. A SQL failure therefore
      // rolls the complete event attempt back without a partial staff broadcast.
      for (const recipient of recipients) {
        // Precise incident data is a server delivery attempt, not proof of browser
        // receipt. Keep actor-linked audit metadata free of coordinates and secrets.
        await client.query(
          `INSERT INTO audit_events(id,incident_id,event,actor_kind,staff_id,details,occurred_at)
           VALUES($1,$2,'incident:realtime_delivery_attempt','staff',$3,$4::jsonb,clock_timestamp())`,
          [randomUUID(), envelope.incident.id, recipient.staffId,
            JSON.stringify({ channel: "socket", access: "attempt", regionId })],
        );
      }
      for (const recipient of recipients) {
        if (recipient.socket.connected) recipient.socket.emit(envelope.event, envelope);
      }
      io.to(incidentRoom(envelope.incident.id)).emit(envelope.event, envelope);
      return true;
    } catch {
      // SQL failures are rolled back by the publisher's per-event savepoint.
      // Never emit staff data after a failed authorization or audit check.
      return false;
    }
  }

  return {
    io,
    disconnectStaffSession(sessionId) {
      const sockets = staffSocketsBySession.get(sessionId);
      if (!sockets) return;
      for (const socket of sockets) socket.disconnect(true);
      staffSocketsBySession.delete(sessionId);
    },
    disconnectStaffAccount(staffId) {
      const sockets = staffSocketsByAccount.get(staffId);
      if (!sockets) return;
      for (const socket of [...sockets]) socket.disconnect(true);
      staffSocketsByAccount.delete(staffId);
    },
    async stopAcceptingUpdates() {
      acceptingLocationUpdates = false;
      await Promise.allSettled([...inFlightLocationUpdates]);
    },
    publishOutboxEvent,
  };
}
