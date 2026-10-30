import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runWrangler } from "./deploy.js";

const workerDir = fileURLToPath(new URL("../", import.meta.url));

export async function deployPreview({ config, branch, ciWorkerName, dryRun = false, run = runWrangler, log = console.log }) {
  if (branch !== "develop") {
    log("Skipping Preview deployment: only develop publishes the development environment.");
    return { skipped: true };
  }
  if (config.name !== "atlas-router" || config.main !== "src/index.js"
    || (ciWorkerName && ciWorkerName !== config.name)) {
    throw new Error("Preview deployment must target atlas-router with the current branch entrypoint");
  }
  const production = config.d1_databases?.find((db) => db.binding === "DB");
  const migration = config.d1_databases?.find((db) => db.binding === "DEV_DB");
  const preview = config.previews?.d1_databases;
  if (!production?.database_id || !migration?.database_id || preview?.length !== 1
    || preview[0].binding !== "DB" || preview[0].database_id !== migration.database_id
    || preview[0].database_name !== migration.database_name
    || production.database_id === migration.database_id
    || migration.migrations_dir !== "migrations" || preview[0].migrations_dir !== "migrations") {
    throw new Error("Preview and DEV_DB must use the same independent development database and migrations");
  }
  if (config.previews.vars?.UI_ENABLED !== "false" || config.previews.vars?.SUBSCRIPTION_PATH !== "/AtlasRouter-Dev") {
    throw new Error("Preview must disable the UI and use /AtlasRouter-Dev");
  }
  if (dryRun) {
    log("Preview configuration verified: develop, independent D1, UI disabled. No remote changes.");
    return { skipped: false, dryRun: true };
  }
  log("Applying development D1 migrations before publishing the develop Preview...");
  await run(["d1", "migrations", "apply", "DEV_DB", "--remote", "--config", "wrangler.jsonc"]);
  // The checked-in Preview bindings take precedence over any old Dashboard base configuration.
  await run(["preview", "--name", "develop", "--config", "wrangler.jsonc", "--ignore-base-config"]);
  log("Develop Preview published. Production code and production D1 were not changed.");
  return { skipped: false, dryRun: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || args.some((arg) => arg !== "--dry-run")) throw new Error("Usage: npm run deploy:preview [-- --dry-run]");
    const branch = process.env.WORKERS_CI_BRANCH ?? execFileSync("git", ["branch", "--show-current"], {
      cwd: workerDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
    await deployPreview({ config, branch, ciWorkerName: process.env.WRANGLER_CI_OVERRIDE_NAME, dryRun: args.includes("--dry-run") });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
