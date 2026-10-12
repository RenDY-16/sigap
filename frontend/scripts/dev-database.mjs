#!/usr/bin/env node
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const containerName = "sigap-postgres18-local";
const volumeName = "sigap-postgres18-data";
const image = "docker.io/library/postgres:18";
const ownershipLabel = "sigap.database.local";
const port = 54329;

function podman(args, { capture = false, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("podman", args, { shell: false, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", () => reject(new Error("Podman could not be started. Install/enable Podman before using the local database.")));
    child.on("close", (code) => {
      if (code !== 0 && !allowFailure) reject(new Error(`Podman command failed (exit ${code}). ${capture ? stderr.trim() : "See command output."}`));
      else resolve({ code, stdout });
    });
  });
}

async function inspect({ allowStaleHealth = false } = {}) {
  const exists = await podman(["container", "exists", containerName], { capture: true, allowFailure: true });
  if (exists.code === 1) return null;
  if (exists.code !== 0) throw new Error("Podman could not check whether the database container exists.");
  const result = await podman(["inspect", containerName], { capture: true });
  const container = JSON.parse(result.stdout)[0];
  if (container.Config?.Labels?.[ownershipLabel] !== "1") {
    throw new Error(`The name ${containerName} is already used by another container. Refusing to operate on it.`);
  }
  const bindings = container.HostConfig?.PortBindings?.["5432/tcp"];
  const mountedVolume = container.Mounts?.some((mount) => mount.Name === volumeName && mount.Destination === "/var/lib/postgresql");
  if (!bindings?.length || bindings.some((binding) => binding.HostIp !== "127.0.0.1" || binding.HostPort !== String(port)) || !mountedVolume) {
    throw new Error("Existing local database container does not match the loopback-only port and named volume configuration.");
  }
  const healthTest = container.Config?.Healthcheck?.Test;
  const healthCommand = Array.isArray(healthTest) ? healthTest.join(" ") : "";
  if (!allowStaleHealth && (!healthCommand.includes("pg_isready") || !healthCommand.includes("-h 127.0.0.1") || !healthCommand.includes("-p 5432"))) {
    throw new Error("Existing database container uses an old or unknown health check. Run npm run db:down, then npm run db:up; the named data volume will be preserved.");
  }
  return container;
}

async function up() {
  const existing = await inspect();
  if (!existing) {
    await podman(["volume", "create", volumeName]);
    await podman([
      "run", "--detach", "--name", containerName, "--label", `${ownershipLabel}=1`,
      "--publish", `127.0.0.1:${port}:5432`,
      "--volume", `${volumeName}:/var/lib/postgresql`,
      "--env", "POSTGRES_USER=sigap_dev",
      "--env", "POSTGRES_PASSWORD=sigap_local_synthetic_only",
      "--env", "POSTGRES_DB=sigap_staging",
      "--health-cmd", "pg_isready -h 127.0.0.1 -p 5432 -U sigap_dev -d sigap_staging",
      "--health-interval", "2s", "--health-timeout", "3s", "--health-retries", "30",
      "--health-start-period", "5s", image,
    ]);
  } else if (!existing.State?.Running) {
    await podman(["start", containerName]);
  }
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const container = await inspect();
    if (!container?.State?.Running) throw new Error("PostgreSQL container stopped before becoming healthy. Inspect its Podman logs.");
    // Running the declared check also works when rootless health timers are unavailable.
    await podman(["healthcheck", "run", containerName], { capture: true, allowFailure: true });
    const checked = await inspect();
    const health = checked?.State?.Health?.Status ?? checked?.State?.Healthcheck?.Status;
    if (health === "healthy") {
      console.log(`Local PostgreSQL 18 is healthy on 127.0.0.1:${port}. Run npm run db:migrate.`);
      return;
    }
    await delay(1000);
  }
  throw new Error("PostgreSQL did not pass its container health check within 120 seconds.");
}

async function status() {
  const container = await inspect();
  if (!container) {
    console.log(JSON.stringify({ container: containerName, exists: false, volume: volumeName }));
    process.exitCode = 1;
    return;
  }
  const health = container.State?.Health?.Status ?? container.State?.Healthcheck?.Status ?? "unknown";
  console.log(JSON.stringify({ container: containerName, running: Boolean(container.State?.Running), health, port: `127.0.0.1:${port}`, volume: volumeName }));
  if (!container.State?.Running || health !== "healthy") process.exitCode = 1;
}

async function down() {
  const container = await inspect({ allowStaleHealth: true });
  if (container) {
    if (container.State?.Running) await podman(["stop", "--time", "15", containerName]);
    await podman(["rm", containerName]);
  }
  console.log(`Local container removed. Named volume ${volumeName} is preserved.`);
}

try {
  const action = process.argv[2];
  if (action === "up") await up();
  else if (action === "status") await status();
  else if (action === "down") await down();
  else throw new Error("Usage: node scripts/dev-database.mjs up|status|down");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Local database command failed.");
  process.exitCode = 1;
}
