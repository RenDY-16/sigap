import "dotenv/config";

import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, chmod, link, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import pg from "pg";
import { getMigrationStatus } from "../src/server/db/migrate.js";

const containerName = "sigap-postgres18-local";
const volumeName = "sigap-postgres18-data";
const containerOwnershipLabel = "sigap.database.local";
const localPort = "54329";
const minimumPassphraseBytes = 32;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type CommandResult = { code: number | null };

function fail(message: string): never {
  throw new Error(message);
}

function run(binary: string, args: string[], options: { env?: NodeJS.ProcessEnv; inputPath?: string } = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      env: options.env,
      shell: false,
      stdio: [options.inputPath ? "pipe" : "ignore", "ignore", "ignore"],
    });
    child.once("error", () => reject(new Error(`${binary} could not be started.`)));
    child.once("close", (code) => resolve({ code }));

    if (options.inputPath && child.stdin) {
      void pipeline(createReadStream(options.inputPath), child.stdin).catch(() => child.kill("SIGTERM"));
    }
  });
}

function parseDatabaseUrl(raw: string | undefined): { url: URL; database: string; password: string } {
  if (!raw) fail("Set DATABASE_URL to the local synthetic PostgreSQL staging database.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail("DATABASE_URL is invalid.");
  }
  if (url.search || url.hash) fail("DATABASE_URL must not contain connection override parameters.");
  const database = decodeURIComponent(url.pathname.slice(1));
  const allowedDatabase = database === "sigap_staging" || /^sigap_backup_[0-9]+_[a-f0-9]{8}$/.test(database);
  if (!(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname === "127.0.0.1" && url.port === localPort && decodeURIComponent(url.username) === "sigap_dev" && allowedDatabase)) {
    fail("Only the owned loopback PostgreSQL 18 synthetic staging database is allowed.");
  }
  if (!url.password) fail("DATABASE_URL must include the local staging database password.");
  return { url, database, password: decodeURIComponent(url.password) };
}

function loadPassphrase(): string {
  const passphrase = process.env.SIGAP_BACKUP_PASSPHRASE;
  if (!passphrase || Buffer.byteLength(passphrase, "utf8") < minimumPassphraseBytes) {
    fail("Set SIGAP_BACKUP_PASSPHRASE to at least 32 bytes for encrypted backup operations.");
  }
  return passphrase;
}

async function assertOwnedContainer(): Promise<void> {
  const inspect = await new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
    const child = spawn("podman", ["inspect", containerName], { shell: false, stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.once("error", () => reject(new Error("Podman could not be started.")));
    child.once("close", (code) => resolve({ code, stdout }));
  });
  if (inspect.code !== 0) fail("The owned local PostgreSQL container is unavailable.");
  let container: any;
  try { container = JSON.parse(inspect.stdout)[0]; } catch { fail("The local database container identity could not be verified."); }
  const bindings = container.HostConfig?.PortBindings?.["5432/tcp"] as Array<{ HostIp?: string; HostPort?: string }> | undefined;
  const mountedVolume = container.Mounts?.some((mount: { Name?: string; Destination?: string }) => mount.Name === volumeName && mount.Destination === "/var/lib/postgresql");
  const health = container.State?.Health?.Status ?? container.State?.Healthcheck?.Status;
  if (container.Config?.Labels?.[containerOwnershipLabel] !== "1" || !container.State?.Running || health !== "healthy" || !bindings?.length || bindings.some((binding) => binding.HostIp !== "127.0.0.1" || binding.HostPort !== localPort) || !mountedVolume) {
    fail("The local PostgreSQL container does not match SIGAP's owned loopback-only staging configuration.");
  }
}

async function ensureSafeArtifactPath(rawPath: string): Promise<string> {
  if (!path.isAbsolute(rawPath)) fail("Provide an absolute backup path outside the source repository.");
  const target = path.resolve(rawPath);
  let parent: string;
  try { parent = await realpath(path.dirname(target)); } catch { fail("The backup destination folder must already exist."); }
  const resolvedTarget = path.join(parent, path.basename(target));
  const rel = path.relative(projectRoot, resolvedTarget);
  if (rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel))) {
    fail("Encrypted backups must be stored outside the source repository.");
  }
  try { await access(resolvedTarget); fail("The backup destination already exists; refusing to overwrite it."); } catch (error) {
    if (error instanceof Error && error.message.includes("refusing to overwrite")) throw error;
    // A missing destination is the expected case.
  }
  return resolvedTarget;
}

function gpgArgs(passphraseFile: string, action: "encrypt" | "decrypt"): string[] {
  return ["--batch", "--yes", "--pinentry-mode", "loopback", "--passphrase-file", passphraseFile,
    ...(action === "encrypt" ? ["--symmetric", "--cipher-algo", "AES256"] : ["--decrypt"])];
}

async function writePassphraseFile(directory: string, passphrase: string): Promise<string> {
  const filename = path.join(directory, "passphrase");
  await writeFile(filename, passphrase, { mode: 0o600, flag: "wx" });
  await chmod(filename, 0o600);
  return filename;
}

async function decryptAndValidate(artifact: string, passphraseFile: string, directory: string): Promise<string> {
  const plaintext = path.join(directory, "database.dump");
  const decrypt = await run("gpg2", [...gpgArgs(passphraseFile, "decrypt"), "--output", plaintext, artifact]);
  if (decrypt.code !== 0) fail("Backup authentication or integrity check failed.");
  await chmod(plaintext, 0o600);
  const archive = await run("podman", ["exec", "--interactive", containerName, "pg_restore", "--list"], { inputPath: plaintext });
  if (archive.code !== 0) fail("The decrypted backup is not a valid PostgreSQL archive.");
  return plaintext;
}

async function backup(artifactArg: string): Promise<void> {
  const database = parseDatabaseUrl(process.env.DATABASE_URL);
  const destination = await ensureSafeArtifactPath(artifactArg);
  const passphrase = loadPassphrase();
  await assertOwnedContainer();
  const tempDirectory = await mkdtemp(path.join(path.dirname(destination), ".sigap-backup-"));
  await chmod(tempDirectory, 0o700);
  const partial = path.join(tempDirectory, "archive.gpg");
  try {
    const passphraseFile = await writePassphraseFile(tempDirectory, passphrase);
    const env = { ...process.env, PGPASSWORD: database.password };
    const dump = spawn("podman", ["exec", "--env", "PGPASSWORD", containerName, "pg_dump", "--format=custom", "--no-owner", "--no-privileges", "--host=127.0.0.1", "--port=5432", "--username=sigap_dev", `--dbname=${database.database}`], { shell: false, env, stdio: ["ignore", "pipe", "ignore"] });
    const encrypt = spawn("gpg2", [...gpgArgs(passphraseFile, "encrypt"), "--output", partial], { shell: false, stdio: ["pipe", "ignore", "ignore"] });
    const failures: Error[] = [];
    dump.once("error", () => failures.push(new Error("Database backup could not be started.")));
    encrypt.once("error", () => failures.push(new Error("Backup encryption could not be started.")));
    let pipeFailed = false;
    const pipe = pipeline(dump.stdout, encrypt.stdin).catch(() => {
      pipeFailed = true;
      dump.kill("SIGTERM");
      encrypt.kill("SIGTERM");
    });
    const [dumpCode, encryptCode] = await Promise.all([
      new Promise<number | null>((resolve) => dump.once("close", resolve)),
      new Promise<number | null>((resolve) => encrypt.once("close", resolve)),
    ]);
    await pipe;
    if (failures.length || pipeFailed || dumpCode !== 0 || encryptCode !== 0) fail("Backup creation failed; no backup was published.");
    await chmod(partial, 0o600);
    await link(partial, destination);
    console.log("Encrypted staging backup created.");
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

async function verify(artifactArg: string): Promise<void> {
  const artifact = path.resolve(artifactArg);
  const passphrase = loadPassphrase();
  await assertOwnedContainer();
  await stat(artifact).catch(() => fail("Backup file is unavailable."));
  const directory = await mkdtemp(path.join(tmpdir(), "sigap-backup-verify-"));
  await chmod(directory, 0o700);
  try {
    const passphraseFile = await writePassphraseFile(directory, passphrase);
    await decryptAndValidate(artifact, passphraseFile, directory);
    console.log("Encrypted backup integrity verified.");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function restore(artifactArg: string, targetName: string): Promise<void> {
  const source = parseDatabaseUrl(process.env.DATABASE_URL);
  if (!/^sigap_restore_[0-9]+_[a-f0-9]{8}$/.test(targetName)) {
    fail("Restore target must be a new sigap_restore_<timestamp>_<random> database.");
  }
  const artifact = path.resolve(artifactArg);
  const passphrase = loadPassphrase();
  await stat(artifact).catch(() => fail("Backup file is unavailable."));
  await assertOwnedContainer();
  const directory = await mkdtemp(path.join(tmpdir(), "sigap-backup-restore-"));
  await chmod(directory, 0o700);
  let created = false;
  const adminUrl = new URL(source.url);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Pool({ connectionString: adminUrl.toString(), max: 1, connectionTimeoutMillis: 3000 });
  try {
    const passphraseFile = await writePassphraseFile(directory, passphrase);
    const plaintext = await decryptAndValidate(artifact, passphraseFile, directory);
    await admin.query(`CREATE DATABASE "${targetName}"`);
    created = true;
    const env = { ...process.env, PGPASSWORD: source.password };
    const restored = await run("podman", ["exec", "--interactive", "--env", "PGPASSWORD", containerName, "pg_restore", "--format=custom", "--exit-on-error", "--single-transaction", "--no-owner", "--no-privileges", "--host=127.0.0.1", "--port=5432", "--username=sigap_dev", `--dbname=${targetName}`], { inputPath: plaintext, env });
    if (restored.code !== 0) fail("Restore failed; the newly created restore database will be removed.");
    const targetUrl = new URL(source.url);
    targetUrl.pathname = `/${targetName}`;
    const restoredPool = new pg.Pool({ connectionString: targetUrl.toString(), max: 1, connectionTimeoutMillis: 3000 });
    try {
      const status = await getMigrationStatus(restoredPool);
      if (!status.ready) fail("Restore completed but the database schema is not current; the new database will be removed.");
    } finally {
      await restoredPool.end();
    }
    console.log("Backup restored into the isolated staging verification database.");
  } catch (error) {
    if (created) await admin.query(`DROP DATABASE IF EXISTS "${targetName}"`).catch(() => undefined);
    throw error;
  } finally {
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "backup" && args.length === 1) await backup(args[0]);
  else if (command === "verify" && args.length === 1) await verify(args[0]);
  else if (command === "restore" && args.length === 2) await restore(args[0], args[1]);
  else fail("Usage: database-backup.mts backup <absolute-path.gpg> | verify <backup.gpg> | restore <backup.gpg> <new-sigap_restore-database>");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Database backup operation failed.");
  process.exitCode = 1;
});
