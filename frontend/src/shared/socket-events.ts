import type { GeoPoint, PublicIncident } from "./domain.js";

/** Browser GPS measurement payload. The server always assigns the source as GPS. */
export interface GpsLocationUpdate extends GeoPoint {
  measuredAt: string;
}

export interface IncidentSocketError {
  code: string;
  message: string;
}

export type LocationUpdateAcknowledgement =
  | { ok: true; incident: PublicIncident }
  | { ok: false; error: IncidentSocketError };

export type IncidentRealtimeEventName =
  | "incident:created"
  | "incident:location:updated"
  | "incident:status:updated"
  | "incident:withdrawal:requested";

/** Safe durable event envelope. `incident` never includes server-only digests. */
export interface IncidentRealtimeEnvelope {
  id: string;
  event: IncidentRealtimeEventName;
  incident: PublicIncident;
  occurredAt: string;
}

export interface ServerToClientEvents {
  "incident:snapshot": (incident: PublicIncident) => void;
  "incident:created": (envelope: IncidentRealtimeEnvelope) => void;
  "incident:location:updated": (envelope: IncidentRealtimeEnvelope) => void;
  "incident:status:updated": (envelope: IncidentRealtimeEnvelope) => void;
  "incident:withdrawal:requested": (envelope: IncidentRealtimeEnvelope) => void;
  "incident:error": (error: IncidentSocketError) => void;
}

export interface ClientToServerEvents {
  "incident:location:update": (
    update: GpsLocationUpdate,
    acknowledge?: (result: LocationUpdateAcknowledgement) => void,
  ) => void;
}

export interface InterServerEvents {}

export interface SocketData {
  audience?: "citizen" | "staff";
  incidentId?: string;
  /** Server-only cookie session reference; never included in incident envelopes. */
  sessionId?: string;
  staffId?: string;
  /** Server-resolved room membership; revalidated from PostgreSQL before delivery. */
  regionIds?: string[];
}
