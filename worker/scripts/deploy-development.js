import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runWrangler } from "./deploy.js";
import { readTailnetEndpoints } from "../src/tailnet-nodes.js";

export async function deployDevelopment({ config, production, ci, branch, commit, tailnetEndpoints, dryRun = false, run = runWrangler }) {
  if (!dryRun && (ci !== "1" || branch !== "develop" || !/^[a-f0-9]{40}$/.test(commit ?? ""))) {
    throw new Error("Development releases run only in Cloudflare Workers Builds for develop");
  }
  const database = config.d1_databases?.[0];
  const expected = production.d1_databases?.find((db) => db.binding === "DEV_DB");
  const live = production.d1_databases?.find((db) => db.binding === "DB");
  if (config.name !== "atlas-router-development" || config.main !== "src/index.js"
    || config.workers_dev !== false || config.preview_urls !== false || config.routes?.length || config.previews
    || config.services?.length || config.triggers?.crons?.length || config.d1_databases?.length !== 1
    || database?.binding !== "DB" || !database.database_id || database.database_id !== expected?.database_id
    || database.database_id === live?.database_id || database.migrations_dir !== "migrations"
    || config.vars?.UI_ENABLED !== "false" || config.vars?.SUBSCRIPTION_PATH !== "/AtlasRouter-Dev"
    || config.vars?.SUBSCRIPTION_VARIANT !== "development") {
    throw new Error("Development must use the private subscription Worker and isolated test database");
  }
  if ((!dryRun || tailnetEndpoints) && !readTailnetEndpoints(tailnetEndpoints).length) {
    throw new Error("Development Builds requires a non-empty TAILNET_ENDPOINTS secret");
  }
  const directory = tailnetEndpoints ? await mkdtemp(path.join(tmpdir(), "atlasrouter-dev-secrets-")) : null;
  try {
    const secretsFile = directory && path.join(directory, "secrets.json");
    if (secretsFile) await writeFile(secretsFile, JSON.stringify({ TAILNET_ENDPOINTS: tailnetEndpoints }), { mode: 0o600, flag: "wx" });
    if (!dryRun) await run(["d1", "migrations", "apply", "DB", "--remote", "--config", "wrangler.development.jsonc"]);
    // Publish the complete mapping and code together in Builds; inherit unrelated Secrets.
    await run(["deploy", "--config", "wrangler.development.jsonc", ...(dryRun ? ["--dry-run"] : []),
      ...(secretsFile ? ["--secrets-file", secretsFile] : [])], tailnetEndpoints);
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || args.some((arg) => arg !== "--dry-run")) throw new Error("Usage: npm run deploy:development [-- --dry-run]");
    const config = JSON.parse(await readFile(new URL("../wrangler.development.jsonc", import.meta.url), "utf8"));
    const production = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
    await deployDevelopment({ config, production, ci: process.env.WORKERS_CI,
      branch: process.env.WORKERS_CI_BRANCH, commit: process.env.WORKERS_CI_COMMIT_SHA,
      tailnetEndpoints: process.env.TAILNET_ENDPOINTS, dryRun: args.includes("--dry-run") });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
