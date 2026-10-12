import "dotenv/config";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";
import { loadDatabaseConfig } from "../config.js";
import { closeDatabasePool, createDatabasePool } from "./pool.js";

const migrationsDirectory = fileURLToPath(new URL("./migrations/", import.meta.url));
const lockKey = "7351926417083";
interface Migration { version: string; filename: string; checksum: string; sql: string }
interface AppliedMigration { version: string; filename: string; checksum: string }
export interface MigrationStatus {
  ready: boolean;
  currentVersion: string;
  pending: string[];
}

async function readMigrations(): Promise<Migration[]> {
  const files = (await readdir(migrationsDirectory)).filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name));
  const migrations = await Promise.all(files.map(async (filename) => {
    const sql = await readFile(path.join(migrationsDirectory, filename), "utf8");
    return { filename, version: BigInt(filename.split("_")[0]).toString(), sql,
      checksum: createHash("sha256").update(sql).digest("hex") };
  }));
  migrations.sort((a, b) => BigInt(a.version) < BigInt(b.version) ? -1 : 1);
  for (let index = 0; index < migrations.length; index += 1) {
    if (BigInt(migrations[index].version) !== BigInt(index + 1)) {
      throw new Error("Migration filenames must contain a complete, unique sequence starting at 1.");
    }
  }
  if (!migrations.length) throw new Error("No schema migrations were found.");
  return migrations;
}

async function readApplied(client: PoolClient): Promise<AppliedMigration[]> {
  const exists = await client.query<{ table_name: string | null }>(
    "SELECT to_regclass('public.schema_migrations')::text AS table_name",
  );
  if (!exists.rows[0].table_name) return [];
  const result = await client.query<AppliedMigration>("SELECT version, filename, checksum FROM schema_migrations");
  return result.rows.sort((a, b) => BigInt(a.version) < BigInt(b.version) ? -1 : 1);
}

function validateApplied(migrations: Migration[], applied: AppliedMigration[]): void {
  for (let index = 0; index < applied.length; index += 1) {
    const actual = applied[index];
    const expected = migrations[index];
    if (!expected || actual.version !== expected.version || actual.filename !== expected.filename) {
      throw new Error("Applied schema has an unknown migration or a missing earlier migration.");
    }
    if (actual.checksum !== expected.checksum) {
      throw new Error(`Migration checksum mismatch: ${expected.filename}. Restore the original migration; add a new migration for changes.`);
    }
  }
}

async function withMigrationLock<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let locked = false;
  let destroyed = false;
  try {
    await client.query("SELECT pg_advisory_lock($1::bigint)", [lockKey]);
    locked = true;
    return await operation(client);
  } finally {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock($1::bigint)", [lockKey]);
      } catch {
        // Destroy a connection whose lock cannot be released.
        client.release(true);
        destroyed = true;
      }
    }
    if (!destroyed) client.release();
  }
}

export async function getMigrationStatus(pool: Pool): Promise<MigrationStatus> {
  const migrations = await readMigrations();
  return withMigrationLock(pool, async (client) => {
    const applied = await readApplied(client);
    validateApplied(migrations, applied);
    const pending = migrations.slice(applied.length).map((migration) => migration.filename);
    return { ready: pending.length === 0, currentVersion: applied.at(-1)?.version ?? "0", pending };
  });
}

export async function runMigrations(pool: Pool): Promise<{ applied: string[]; currentVersion: string }> {
  const migrations = await readMigrations();
  return withMigrationLock(pool, async (client) => {
    const existing = await readApplied(client);
    validateApplied(migrations, existing);
    const applied: string[] = [];
    for (const migration of migrations.slice(existing.length)) {
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO schema_migrations(version, filename, checksum) VALUES ($1, $2, $3)",
          [migration.version, migration.filename, migration.checksum],
        );
        await client.query("COMMIT");
        applied.push(migration.filename);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return { applied, currentVersion: migrations.at(-1)!.version };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const action = process.argv[2];
  if (action !== "migrate" && action !== "status") {
    process.stderr.write("Usage: tsx src/server/db/migrate.ts migrate|status\n");
    process.exitCode = 1;
  } else {
    let pool: Pool | undefined;
    try {
      pool = createDatabasePool(loadDatabaseConfig());
      const result = action === "migrate" ? await runMigrations(pool) : await getMigrationStatus(pool);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if ("ready" in result && !result.ready) process.exitCode = 1;
    } catch (error) {
      // Only our schema validation errors are safe to print; pg errors may include private values.
      const message = error instanceof Error && /^(Migration |Applied schema |No schema )/.test(error.message)
        ? error.message : "Database operation failed. Check the database service and server-only configuration.";
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    } finally {
      if (pool) await closeDatabasePool(pool);
    }
  }
}
