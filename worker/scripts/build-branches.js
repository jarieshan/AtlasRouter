import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";

const exec = promisify(execFile);
const workerDir = fileURLToPath(new URL("../", import.meta.url));
const repository = path.resolve(workerDir, "..");
export const BRANCHES = ["master", "develop"];

async function command(file, args, cwd) {
  try {
    return (await exec(file, args, { cwd, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, WRANGLER_WRITE_LOGS: "false", WRANGLER_SEND_METRICS: "false" } })).stdout.trim();
  } catch (error) {
    const detail = `${error.stderr ?? ""}\n${error.stdout ?? ""}`.slice(-4000)
      .replace(/ar_[a-f0-9]{64}/g, "<redacted>").replace(/\/api\/[a-f0-9]{32}\//g, "/api/<redacted>/");
    throw new Error(`${file} ${args[0]} failed\n${detail}`);
  }
}

export async function resolveBranches(repoRoot = repository, fetchRemote = true) {
  if (fetchRemote) await command("git", ["fetch", "--no-tags", "origin",
    ...BRANCHES.map((name) => `refs/heads/${name}:refs/remotes/origin/${name}`)], repoRoot);
  return Object.fromEntries(await Promise.all(BRANCHES.map(async (branch) => {
    const ref = fetchRemote ? `refs/remotes/origin/${branch}` : `refs/heads/${branch}`;
    const sha = await command("git", ["rev-parse", "--verify", `${ref}^{commit}`], repoRoot);
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error(`Invalid ${branch} revision`);
    return [branch, sha];
  })));
}

export async function compileBranches(sources, output, { runtimeDir = path.join(workerDir, "src") } = {}) {
  await mkdir(output, { recursive: true });
  for (const branch of BRANCHES) {
    await build({ entryPoints: [sources[branch]], outfile: path.join(output, `${branch}.js`),
      bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true,
      external: ["cloudflare:*", "node:*"], logLevel: "silent" });
  }
  for (const name of ["branch-router.js", "branch-query.js", "errors.js"]) {
    await cp(path.join(runtimeDir, name), path.join(output, name));
  }
  const entry = path.join(output, "entry.js");
  await writeFile(entry, `import { createBranchRouter } from "./branch-router.js";
export default createBranchRouter({
  master: () => import("./master.js"),
  develop: () => import("./develop.js"),
});\n`);
  await build({ entryPoints: [entry], outfile: path.join(output, "index.js"), bundle: true,
    format: "esm", platform: "browser", target: "es2022", minify: true,
    external: ["cloudflare:*", "node:*"], logLevel: "silent" });
  return path.join(output, "index.js");
}

async function runtimeContract(directory) {
  try {
    const value = JSON.parse(await readFile(path.join(directory, "branch-runtime.json"), "utf8"));
    const migrations = await readdir(path.join(directory, "migrations"));
    return value.version === 1 && value.entry === "src/index.js" && value.storage === "d1-pool"
      && value.query === "dev" && migrations.some((name) => name.endsWith(".sql"));
  } catch { return false; }
}

export async function buildBranches({ repoRoot = repository, output = path.join(workerDir, ".wrangler/branches"),
  fetchRemote = true, install = true, verify = true, log = console.log } = {}) {
  const refs = await resolveBranches(repoRoot, fetchRemote);
  const temporary = await mkdtemp(path.join(tmpdir(), "atlas-branches-"));
  const stagedOutput = path.join(temporary, "output");
  const manifest = { version: 1, refs, contracts: {}, verified: verify, bundleSha256: "", migrations: {} };
  const sources = {};
  try {
    for (const branch of BRANCHES) {
      log(`Building ${branch} at ${refs[branch]}`);
      const checkout = path.join(temporary, branch);
      await mkdir(checkout);
      const entries = (await command("git", ["ls-tree", "--name-only", refs[branch]], repoRoot)).split("\n");
      const archive = path.join(temporary, `${branch}.tar`);
      await command("git", ["archive", "--format=tar", `--output=${archive}`, refs[branch],
        ...["worker", "surge", "modules", ".github"].filter((name) => entries.includes(name))], repoRoot);
      await command("tar", ["-xf", archive, "-C", checkout], repoRoot);
      const app = path.join(checkout, "worker");
      const pkg = JSON.parse(await readFile(path.join(app, "package.json"), "utf8"));
      if (install) await command("npm", ["ci", "--no-audit", "--no-fund"], app);
      if (pkg.scripts?.generate) await command("npm", ["run", "generate"], app);
      if (verify) {
        if (!pkg.scripts?.test) throw new Error(`${branch} must provide npm test`);
        await command("npm", ["test"], app);
        log(`${branch}: tests passed`);
      }
      manifest.contracts[branch] = await runtimeContract(app);
      if (manifest.contracts[branch]) {
        await cp(path.join(app, "migrations"), path.join(stagedOutput, branch, "migrations"), { recursive: true });
        const names = (await readdir(path.join(app, "migrations"))).filter((name) => name.endsWith(".sql")).sort();
        manifest.migrations[branch] = Object.fromEntries(await Promise.all(names.map(async (name) => [name,
          createHash("sha256").update(await readFile(path.join(app, "migrations", name))).digest("hex")])));
      }
      sources[branch] = path.join(app, "src/index.js");
    }
    const bundle = await compileBranches(sources, stagedOutput);
    manifest.bundleSha256 = createHash("sha256").update(await readFile(bundle)).digest("hex");
    await writeFile(path.join(stagedOutput, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    await mkdir(path.dirname(output), { recursive: true });
    // Only replace a previous artifact after both branch builds have succeeded.
    await rm(output, { recursive: true, force: true });
    await cp(stagedOutput, output, { recursive: true });
    log(`Single Worker bundle ready. Deployment contracts: ${JSON.stringify(manifest.contracts)}`);
    return manifest;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--local")) {
    console.error("Usage: node scripts/build-branches.js [--local]");
    process.exitCode = 1;
  } else {
    buildBranches({ fetchRemote: !args.includes("--local") }).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
