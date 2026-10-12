import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/** The MariaDB pool adapter exposes the same result shape as pg. Native SQL
 * bypasses repository SQL translation and uses mysql2's ? placeholders. */
interface MysqlMigrationClient {
  query<Row = Record<string, unknown>>(sql: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
  release(destroy?: boolean): void;
}
interface MysqlMigrationPool { connect(): Promise<MysqlMigrationClient> }
interface Baseline { filename: string; version: string; checksum: string; statements: string[]; tables: string[] }
interface JournalRow { version: string; filename: string; checksum: string; state: string }
export interface MysqlMigrationStatus { ready: boolean; currentVersion: string; pending: string[] }
const filename = "0008_xampp_baseline.sql";
const native = (sql: string) => `/* mysql-native */ ${sql}`;

/** SQL-aware splitting keeps semicolons inside seed JSON/string literals intact.
 * This baseline intentionally contains neither stored routines nor DELIMITER. */
function splitStatements(sql: string): string[] {
  const result: string[] = [];
  let statement = "";
  let quote: string | undefined;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    if (lineComment) {
      if (char === "\n") { lineComment = false; statement += "\n"; }
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") { blockComment = false; index += 1; statement += " "; }
      continue;
    }
    if (quote) {
      statement += char;
      if (char === "\\" && next !== undefined) { statement += next; index += 1; }
      else if (char === quote) {
        if (next === quote) { statement += next; index += 1; }
        else quote = undefined;
      }
      continue;
    }
    if (char === "-" && next === "-" && /\s/.test(sql[index + 2] ?? "")) { lineComment = true; index += 1; continue; }
    if (char === "/" && next === "*") { blockComment = true; index += 1; continue; }
    if (char === "'" || char === '"' || char === "`") { quote = char; statement += char; continue; }
    if (char === ";") { if (statement.trim()) result.push(statement.trim()); statement = ""; }
    else statement += char;
  }
  if (quote || blockComment) throw new Error("Migration baseline contains an unterminated SQL literal or comment.");
  if (statement.trim()) result.push(statement.trim());
  return result;
}

async function readBaseline(): Promise<Baseline> {
  const sql = await readFile(new URL(`./mysql-migrations/${filename}`, import.meta.url), "utf8");
  const statements = splitStatements(sql);
  const tables = statements.flatMap((statement) => {
    const table = /^CREATE TABLE ([a-z_]+)\s*\(/i.exec(statement)?.[1];
    return table ? [table] : [];
  });
  if (!tables.length || tables.includes("schema_migrations") || tables.length !== new Set(tables).size) {
    throw new Error("Migration baseline has an invalid table inventory.");
  }
  return { filename, version: "8", checksum: createHash("sha256").update(sql).digest("hex"), statements, tables };
}

async function withLock<T>(pool: MysqlMigrationPool, operation: (client: MysqlMigrationClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let locked = false;
  let destroy = false;
  try {
    const version = await client.query<{ server_version: string; database_name: string | null }>(
      native("SELECT VERSION() AS server_version, DATABASE() AS database_name"),
    );
    const server = version.rows[0];
    const number = server?.server_version.match(/(\d+)\.(\d+)\.\d+(?=-MariaDB)/i);
    if (!server?.database_name || !number || Number(number[1]) < 10 || (Number(number[1]) === 10 && Number(number[2]) < 4)) {
      throw new Error("Migration requires a selected MariaDB 10.4 or newer database.");
    }
    // Migration DDL auto-commits, so hold a session lock on this pinned client.
    const result = await client.query<{ acquired: number | null }>(
      native("SELECT GET_LOCK(SHA2(CONCAT('sigap-schema:', DATABASE()), 256), 30) AS acquired"),
    );
    if (Number(result.rows[0]?.acquired) !== 1) throw new Error("Migration schema lock is unavailable; retry after the other migration finishes.");
    locked = true;
    await client.query(native("SET SESSION time_zone = '+00:00'"));
    return await operation(client);
  } finally {
    if (locked) {
      try {
        const release = await client.query<{ released: number | null }>(
          native("SELECT RELEASE_LOCK(SHA2(CONCAT('sigap-schema:', DATABASE()), 256)) AS released"),
        );
        destroy = Number(release.rows[0]?.released) !== 1;
      } catch { destroy = true; }
    }
    client.release(destroy);
  }
}

async function inspect(client: MysqlMigrationClient, baseline: Baseline): Promise<JournalRow | undefined> {
  const result = await client.query<{ table_name: string }>(native(
    "SELECT TABLE_NAME AS table_name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()",
  ));
  const tables = result.rows.map((row) => row.table_name);
  if (!tables.length) return undefined;
  if (!tables.includes("schema_migrations")) {
    throw new Error("Migration refused: use an empty dedicated database; existing objects have no SIGAP migration journal.");
  }
  const rows = await client.query<JournalRow>(native("SELECT version, filename, checksum, state FROM schema_migrations"));
  const row = rows.rows[0];
  if (rows.rows.length !== 1 || !row || row.version !== baseline.version || row.filename !== baseline.filename || row.checksum !== baseline.checksum) {
    throw new Error("Migration journal or checksum mismatch. Restore the original baseline; do not overwrite an existing schema.");
  }
  if (row.state !== "completed") {
    throw new Error("Migration is incomplete: MariaDB DDL cannot roll back. Preserve this database for diagnosis and migrate a new empty database; no automatic replay is permitted.");
  }
  const expected = new Set(["schema_migrations", ...baseline.tables]);
  if (tables.length !== expected.size || tables.some((table) => !expected.has(table))) {
    throw new Error("Migration table inventory differs from the completed baseline. Restore the database or investigate schema drift.");
  }
  return row;
}

export async function getMysqlMigrationStatus(pool: MysqlMigrationPool): Promise<MysqlMigrationStatus> {
  const baseline = await readBaseline();
  return withLock(pool, async (client) => {
    const row = await inspect(client, baseline);
    return { ready: Boolean(row), currentVersion: row?.version ?? "0", pending: row ? [] : [baseline.filename] };
  });
}

export async function applyMysqlMigrations(pool: MysqlMigrationPool): Promise<{ applied: string[]; currentVersion: string }> {
  const baseline = await readBaseline();
  return withLock(pool, async (client) => {
    const existing = await inspect(client, baseline);
    if (existing) return { applied: [], currentVersion: existing.version };
    // Never claim transactional DDL. Persist 'applying' before any application
    // table changes; interruption at any point fails closed on the next start.
    await client.query(native(`CREATE TABLE schema_migrations (
      version VARCHAR(20) PRIMARY KEY,
      filename VARCHAR(200) NOT NULL UNIQUE,
      checksum CHAR(64) NOT NULL CHECK(checksum REGEXP BINARY '^[0-9a-f]{64}$'),
      state VARCHAR(16) NOT NULL CHECK(state IN ('applying','completed')),
      applied_at DATETIME(6) NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin`));
    await client.query(native("INSERT INTO schema_migrations(version,filename,checksum,state) VALUES (?,?,?,'applying')"),
      [baseline.version, baseline.filename, baseline.checksum]);
    for (const statement of baseline.statements) await client.query(native(statement));
    await client.query(native("UPDATE schema_migrations SET state='completed', applied_at=CURRENT_TIMESTAMP(6) WHERE version=? AND checksum=? AND state='applying'"),
      [baseline.version, baseline.checksum]);
    await inspect(client, baseline);
    return { applied: [baseline.filename], currentVersion: baseline.version };
  });
}
