import pg from "pg";
import { createMysqlDatabasePool } from "./mysql-pool.js";
import type { ServerConfig } from "../config.js";

export type { Pool, PoolClient } from "pg";

type DatabasePoolConfig = Pick<ServerConfig, "databaseUrl"> &
  Partial<Pick<ServerConfig, "databasePoolMax">>;

/** One pool per server process; inject it into every persistence component. */
export function createDatabasePool(config: DatabasePoolConfig): pg.Pool {
  if (/^(mysql|mariadb):/.test(config.databaseUrl)) return createMysqlDatabasePool(config);
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: config.databasePoolMax ?? 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
    query_timeout: 12_000,
    application_name: "sigap-staging",
  });
  pool.on("error", () => {
    // The original error can include private connection details.
    process.stderr.write("SIGAP database idle connection failed.\n");
  });
  return pool;
}

export async function closeDatabasePool(pool: pg.Pool): Promise<void> {
  await pool.end();
}
