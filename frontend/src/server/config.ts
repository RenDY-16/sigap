import "dotenv/config";

import { accessSync, constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ServerConfig {
  databaseUrl: string;
  databasePoolMax: number;
  host: string;
  port: number;
  sessionSecret: string;
  tlsCertPath?: string;
  tlsKeyPath?: string;
  lanDemo: boolean;
  secureCookies: boolean;
  clientDistPath: string;
}

export class ServerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerConfigError";
  }
}

export function loadDatabaseConfig(env: NodeJS.ProcessEnv = process.env): Pick<ServerConfig, "databaseUrl" | "databasePoolMax"> {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new ServerConfigError("Set DATABASE_URL in the server-only environment.");
  try {
    const url = new URL(databaseUrl);
    if (!["postgres:", "postgresql:", "mysql:", "mariadb:"].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) {
      throw new Error("invalid database URL");
    }
  } catch {
    throw new ServerConfigError("DATABASE_URL must be a PostgreSQL or MySQL/MariaDB connection URL with a host and database name.");
  }
  const databasePoolMax = Number(env.DATABASE_POOL_MAX?.trim() || "10");
  if (!Number.isInteger(databasePoolMax) || databasePoolMax < 1 || databasePoolMax > 50) {
    throw new ServerConfigError("DATABASE_POOL_MAX must be an integer from 1 to 50.");
  }
  return { databaseUrl, databasePoolMax };
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const database = loadDatabaseConfig(env);
  const sessionSecret = env.SESSION_SECRET?.trim();

  if (!sessionSecret || Buffer.byteLength(sessionSecret, "utf8") < 32) {
    throw new ServerConfigError(
      "Set SESSION_SECRET to a random value of at least 32 bytes in the local environment.",
    );
  }
  const rawPort = env.PORT?.trim() || "3001";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ServerConfigError("PORT must be an integer from 1 to 65535.");
  }

  const tlsCertPath = env.TLS_CERT_PATH?.trim()
    ? path.resolve(env.TLS_CERT_PATH.trim())
    : undefined;
  const tlsKeyPath = env.TLS_KEY_PATH?.trim()
    ? path.resolve(env.TLS_KEY_PATH.trim())
    : undefined;
  if (Boolean(tlsCertPath) !== Boolean(tlsKeyPath)) {
    throw new ServerConfigError("Set both TLS_CERT_PATH and TLS_KEY_PATH, or leave both unset.");
  }

  const host = env.HOST?.trim() || "127.0.0.1";
  const lanDemo = env.LAN_DEMO?.trim() === "1";
  const isLoopback = host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
  if (!isLoopback && (!lanDemo || !tlsCertPath || !tlsKeyPath)) {
    throw new ServerConfigError(
      "Binding beyond localhost requires LAN_DEMO=1 and both TLS_CERT_PATH and TLS_KEY_PATH. Keep HOST=127.0.0.1 for local-only use.",
    );
  }
  if (lanDemo && isLoopback) {
    throw new ServerConfigError(
      "LAN_DEMO=1 is for a LAN-facing server. Set HOST=0.0.0.0 and provide trusted HTTPS certificates, or leave LAN_DEMO unset.",
    );
  }

  for (const [label, filePath] of [["TLS certificate", tlsCertPath], ["TLS private key", tlsKeyPath]] as const) {
    if (!filePath) continue;
    try {
      accessSync(filePath, constants.R_OK);
    } catch {
      throw new ServerConfigError(
        `${label} cannot be read at ${filePath}. Check the path and file permissions.`,
      );
    }
  }

  const here = path.dirname(fileURLToPath(import.meta.url));

  return {
    ...database,
    host,
    port,
    sessionSecret,
    tlsCertPath,
    tlsKeyPath,
    lanDemo,
    secureCookies: Boolean(tlsCertPath && tlsKeyPath),
    clientDistPath: path.resolve(here, "../../dist/client"),
  };
}
