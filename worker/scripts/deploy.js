import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workerDir = fileURLToPath(new URL("../", import.meta.url));
const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const developmentConfig = fileURLToPath(new URL("../wrangler.dev.jsonc", import.meta.url));
const productionConfig = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url));

export function assertCloudflareBuildTarget(workerName, env = process.env) {
  if (!env.WORKERS_CI && !env.WRANGLER_CI_OVERRIDE_NAME) return;
  const branch = { "atlas-router-dev": "develop", "atlas-router": "master" }[workerName];
  if (!branch || env.WORKERS_CI_BRANCH !== branch || env.WRANGLER_CI_OVERRIDE_NAME !== workerName) {
    throw new Error("Cloudflare Builds must use the matching branch and deploy only its connected Worker (--development or --router-only)");
  }
}

export function assertDevelopmentIsolation(development, production) {
  const productionDomains = new Set((production.routes ?? []).map((route) => (typeof route === "string" ? route : route.pattern).toLowerCase()));
  const productionDatabases = new Set((production.d1_databases ?? []).map((db) => db.database_id));
  const developmentDatabase = development.d1_databases?.find((db) => db.binding === "DB");
  if (development.name !== "atlas-router-dev" || development.name === production.name
      || !development.routes?.length || development.routes.some((route) =>
        !route || typeof route !== "object" || route.custom_domain !== true
        || typeof route.pattern !== "string" || !/^[a-z0-9.-]+$/i.test(route.pattern)
        || productionDomains.has(route.pattern.toLowerCase()))
      || !developmentDatabase?.database_id || development.d1_databases.some((db) => productionDatabases.has(db.database_id))) {
    throw new Error("Development must use its own Worker, domains and D1 database");
  }
}

export async function deployDevelopment(options = {}) {
  const [development, production] = await Promise.all([developmentConfig, productionConfig].map(async (file) =>
    JSON.parse(await readFile(file, "utf8"))));
  assertDevelopmentIsolation(development, production);
  await deploy({ ...options, configPath: developmentConfig });
}

export async function deploy({ dryRun = false, run = runWrangler, log = console.log, configPath } = {}) {
  const configArgs = configPath ? ["--config", configPath] : [];
  if (!dryRun) {
    log("Applying D1 migrations before deployment...");
    await run(["d1", "migrations", "apply", "DB", "--remote", ...configArgs]);
  }

  const directory = await mkdtemp(path.join(tmpdir(), "atlasrouter-deploy-"));
  try {
    const slug = randomBytes(16).toString("hex");
    const secretsFile = path.join(directory, "secrets.json");
    await writeFile(secretsFile, JSON.stringify({ ADMIN_API_SLUG: slug }), { mode: 0o600, flag: "wx" });
    log(dryRun ? "Checking deployment without changing remote resources..." : "Deploying Worker with a new management route Secret...");
    // Upload code and the new Secret together; omitted Secrets are inherited.
    await run(["deploy", ...configArgs, ...(dryRun ? ["--dry-run"] : []), "--secrets-file", secretsFile], slug);
    if (!dryRun) log("Deployment complete. Refresh open administrator pages to use the new route.");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function runWrangler(args, secret) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wrangler, ...args], {
      cwd: workerDir,
      env: { ...process.env, WRANGLER_WRITE_LOGS: "false", WRANGLER_LOG: "log", WRANGLER_LOG_SANITIZE: "true", WRANGLER_SEND_METRICS: "false" },
      stdio: ["inherit", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", () => reject(new Error("Unable to start Wrangler")));
    child.on("close", (code, signal) => {
      const redact = (chunks) => {
        const text = Buffer.concat(chunks).toString("utf8");
        return secret ? text.replaceAll(secret, "<redacted>") : text;
      };
      process.stdout.write(redact(stdout));
      process.stderr.write(redact(stderr));
      if (code === 0) resolve();
      else reject(new Error(`Wrangler ${args[0]} failed (${signal ?? code})`));
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--dry-run", "--router-only", "--development"].includes(arg)) ||
      (args.includes("--router-only") && args.includes("--development"))) {
    console.error("Usage: node scripts/deploy.js [--dry-run] [--router-only | --development]");
    process.exitCode = 1;
  } else {
    const action = args.includes("--development") ? deployDevelopment : deploy;
    const workerName = args.includes("--development") ? "atlas-router-dev" : "atlas-router";
    const dryRun = args.includes("--dry-run");
    Promise.resolve().then(() => {
      // Builds can override Wrangler's configured name. Check before any remote D1 migration.
      if (!dryRun) assertCloudflareBuildTarget(workerName);
      return action({ dryRun });
    }).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
