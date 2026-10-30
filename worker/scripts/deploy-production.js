import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { deploy, runWrangler } from "./deploy.js";

export async function deployProduction({ config, ci, branch, commit, ciWorkerName, dryRun = false,
  run = runWrangler, log = console.log }) {
  if (!dryRun && (ci !== "1" || branch !== "master" || !/^[a-f0-9]{40}$/.test(commit ?? ""))) {
    throw new Error("Production releases run only in Cloudflare Workers Builds for master. Push master to deploy.");
  }
  if (config.name !== "atlas-router" || config.main !== "src/index.js"
    || (ciWorkerName && ciWorkerName !== config.name)
    || config.vars?.UI_ENABLED !== "true" || config.vars?.SUBSCRIPTION_PATH !== "/AtlasRouter") {
    throw new Error("Production must use atlas-router, the current entrypoint, and the production UI and subscription path");
  }
  const production = config.d1_databases?.find((db) => db.binding === "DB");
  const development = config.d1_databases?.find((db) => db.binding === "DEV_DB");
  if (!production?.database_id || !development?.database_id || production.database_id === development.database_id
    || production.migrations_dir !== "migrations" || development.migrations_dir !== "migrations") {
    throw new Error("Production UI requires separate production and development D1 databases");
  }
  const origin = new URL(config.vars.DEV_SUBSCRIPTION_ORIGIN);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/"
    || origin.search || origin.hash || config.routes?.some((route) => route.pattern === origin.hostname)) {
    throw new Error("Development subscriptions require an independent HTTPS origin");
  }
  await deploy({ dryRun, run, log, configPath: "wrangler.jsonc", beforePublish: async () => {
    // The production UI manages development data as well as its own database.
    await run(["d1", "migrations", "apply", "DEV_DB", "--remote", "--config", "wrangler.jsonc"]);
  } });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || args.some((arg) => arg !== "--dry-run")) throw new Error("Usage: npm run deploy [-- --dry-run]");
    const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
    await deployProduction({ config, ci: process.env.WORKERS_CI, branch: process.env.WORKERS_CI_BRANCH,
      commit: process.env.WORKERS_CI_COMMIT_SHA, ciWorkerName: process.env.WRANGLER_CI_OVERRIDE_NAME,
      dryRun: args.includes("--dry-run") });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
