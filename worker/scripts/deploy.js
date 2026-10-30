import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workerDir = fileURLToPath(new URL("../", import.meta.url));
const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
export async function deploy({ dryRun = false, run = runWrangler, log = console.log, configPath,
  databaseBinding = "DB", secretName = "ADMIN_API_SLUG", beforePublish = async () => {} } = {}) {
  const configArgs = configPath ? ["--config", configPath] : [];
  if (!dryRun) {
    log("Applying D1 migrations before deployment...");
    await run(["d1", "migrations", "apply", databaseBinding, "--remote", ...configArgs]);
    await beforePublish();
  }

  const directory = await mkdtemp(path.join(tmpdir(), "atlasrouter-deploy-"));
  try {
    const slug = randomBytes(16).toString("hex");
    const secretsFile = path.join(directory, "secrets.json");
    await writeFile(secretsFile, JSON.stringify({ [secretName]: slug }), { mode: 0o600, flag: "wx" });
    log(dryRun ? "Checking deployment without changing remote resources..." : "Deploying Worker with a new management route Secret...");
    // Upload code and the new Secret together; omitted Secrets are inherited.
    await run(["deploy", ...configArgs, ...(dryRun ? ["--dry-run"] : []), "--secrets-file", secretsFile], slug);
    if (!dryRun) log("Deployment complete. Refresh open administrator pages to use the new route.");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function runWrangler(args, secret) {
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
      if (code === 0) resolve(redact(stdout));
      else reject(new Error(`Wrangler ${args[0]} failed (${signal ?? code})`));
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.error("Use npm run deploy in Cloudflare Workers Builds for master, or npm run build for a local check. See docs/deployment-cloudflare.md.");
  process.exitCode = 1;
}
