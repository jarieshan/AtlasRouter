import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { BRANCHES } from "./build-branches.js";
import { deploy, runWrangler } from "./deploy.js";

const workerDir = fileURLToPath(new URL("../", import.meta.url));
const configPath = path.join(workerDir, "wrangler.branches.jsonc");
const artifactDir = path.join(workerDir, ".wrangler/branches");

export function assertBranchDeployment(config, manifest, branch, env = process.env) {
  const production = config.d1_databases?.find((db) => db.binding === "DB");
  const development = config.d1_databases?.find((db) => db.binding === "DEV_DB");
  if (config.name !== "atlas-router" || !production?.database_id || !development?.database_id
      || production.database_id === development.database_id || config.d1_databases.length !== 2) {
    throw new Error("Branch deployment requires one atlas-router Worker and two different D1 databases");
  }
  if (config.main !== ".wrangler/branches/index.js"
      || production.migrations_dir !== ".wrangler/branches/master/migrations"
      || development.migrations_dir !== ".wrangler/branches/develop/migrations") {
    throw new Error("Deployment must use the verified branch bundle and migration snapshots");
  }
  if (!BRANCHES.includes(branch)) throw new Error("Deployment branch must be master or develop");
  if (manifest.version !== 1 || manifest.verified !== true || BRANCHES.some((name) => !/^[a-f0-9]{40}$/.test(manifest.refs?.[name]))) {
    throw new Error("Build and test both Git branches before deployment");
  }
  const incompatible = BRANCHES.filter((name) => manifest.contracts?.[name] !== true);
  if (incompatible.length) throw new Error(`${incompatible.join(", ")} is not ready for the D1/dev routing contract; align its application baseline before deployment`);
  if ((env.WORKERS_CI || env.WRANGLER_CI_OVERRIDE_NAME)
      && (env.WRANGLER_CI_OVERRIDE_NAME !== config.name || env.WORKERS_CI_BRANCH !== branch)) {
    throw new Error("Cloudflare Builds branch or Worker does not match this deployment");
  }
  if (env.WORKERS_CI_COMMIT_SHA && env.WORKERS_CI_COMMIT_SHA !== manifest.refs[branch]) {
    throw new Error("This build event is outdated; a newer branch commit must be built");
  }
}

export async function readRemoteHeads() {
  const { stdout } = await promisify(execFile)("git", ["ls-remote", "--heads", "origin", ...BRANCHES], { cwd: workerDir });
  return Object.fromEntries(stdout.trim().split("\n").filter(Boolean).map((line) => {
    const [sha, ref] = line.split(/\s+/);
    return [ref.replace("refs/heads/", ""), sha];
  }));
}

export async function deployBranches({ branch = process.env.WORKERS_CI_BRANCH, dryRun = false, env = process.env,
  run = runWrangler, log = console.log, remoteHeads = readRemoteHeads, artifact = artifactDir, configFile = configPath } = {}) {
  const [config, manifest] = await Promise.all([
    readFile(configFile, "utf8").then(JSON.parse),
    readFile(path.join(artifact, "manifest.json"), "utf8").then(JSON.parse),
  ]);
  if (path.resolve(path.dirname(configFile), config.main) !== path.resolve(artifact, "index.js")) {
    throw new Error("Configured entrypoint is not the verified artifact");
  }
  const actualHash = createHash("sha256").update(await readFile(path.join(artifact, "index.js"))).digest("hex");
  if (actualHash !== manifest.bundleSha256) throw new Error("Branch bundle changed after build");
  const assertFresh = async () => {
    const latest = await remoteHeads();
    if (BRANCHES.some((name) => latest[name] !== manifest.refs[name])) throw new Error("Branch heads changed; rebuild before deploying this artifact");
  };
  const assertOtherSchema = async () => {
    // Both implementations ship together. Never publish the other branch against an older schema.
    const other = branch === "develop" ? "master" : "develop";
    const result = JSON.parse(await run(["d1", "execute", other === "master" ? "DB" : "DEV_DB", "--remote",
      "--command", "SELECT name FROM d1_migrations", "--json", "--config", configFile]));
    if (!Array.isArray(result) || !result.length || result.some((entry) => !entry.success || !Array.isArray(entry.results))) {
      throw new Error(`Cannot verify ${other} database migrations`);
    }
    const applied = new Set(result.flatMap((entry) => entry.results.map((row) => row.name)));
    if (Object.keys(manifest.migrations[other]).some((name) => !applied.has(name))) {
      throw new Error(`${other} has pending migrations; deploy that branch first`);
    }
  };
  if (!dryRun) {
    assertBranchDeployment(config, manifest, branch, env);
    for (const name of BRANCHES) {
      const directory = path.join(artifact, name, "migrations");
      const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
      const hashes = Object.fromEntries(await Promise.all(names.map(async (file) => [file,
        createHash("sha256").update(await readFile(path.join(directory, file))).digest("hex")])));
      if (JSON.stringify(hashes) !== JSON.stringify(manifest.migrations?.[name])) throw new Error(`${name} migrations changed after build`);
    }
    await assertFresh();
  }
  await deploy({ dryRun, run, log, configPath: configFile,
    databaseBinding: branch === "develop" ? "DEV_DB" : "DB",
    secretName: branch === "develop" ? "DEV_ADMIN_API_SLUG" : "ADMIN_API_SLUG",
    beforePublish: async () => { await assertOtherSchema(); await assertFresh(); } });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const branchIndex = args.indexOf("--branch");
  const branch = branchIndex < 0 ? process.env.WORKERS_CI_BRANCH : args[branchIndex + 1];
  const remaining = args.filter((_, index) => branchIndex < 0 || (index !== branchIndex && index !== branchIndex + 1));
  if ((branchIndex >= 0 && !BRANCHES.includes(branch)) || remaining.some((arg) => arg !== "--dry-run")) {
    console.error("Usage: node scripts/deploy-branches.js [--branch master|develop] [--dry-run]");
    process.exitCode = 1;
  } else {
    deployBranches({ branch, dryRun: args.includes("--dry-run") }).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
