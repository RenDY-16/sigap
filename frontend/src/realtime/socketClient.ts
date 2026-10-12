import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "../shared/socket-events.js";

export type BrowserSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type RealtimeEvent =
  | "incident:snapshot"
  | "incident:created"
  | "incident:location:updated"
  | "incident:status:updated"
  | "incident:withdrawal:requested"
  | "incident:error";

const seenOutboxEventIds = new Set<string>();

/** Deduplicate outbox replay across both sockets for the lifetime of this page. */
export function hasSeenOutboxEvent(id: string): boolean {
  if (seenOutboxEventIds.has(id)) return true;
  seenOutboxEventIds.add(id);
  return false;
}

export function connectCitizenSocket(accessToken: string): BrowserSocket {
  return io({
    auth: { accessToken },
    withCredentials: true,
  }) as unknown as BrowserSocket;
}

export function connectStaffSocket(): BrowserSocket {
  return io({ withCredentials: true }) as unknown as BrowserSocket;
}
