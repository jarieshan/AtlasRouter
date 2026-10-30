import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const workerDir = fileURLToPath(new URL("../", import.meta.url));
const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const identifier = /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i;
const dryRunCommand = "npm run deploy:branches -- --dry-run";
const settings = {
  branch_includes: ["master", "develop"],
  branch_excludes: [],
  root_directory: "worker",
  build_command: "npm ci && npm run build:branches",
  deploy_command: dryRunCommand,
  path_includes: ["*"],
  path_excludes: [],
};

class SetupError extends Error {}

async function readBuildToken(env) {
  let auth;
  try {
    // Capture CLI output in memory: never print the token or Wrangler's error output.
    const { stdout } = await promisify(execFile)(process.execPath, [wrangler, "auth", "token", "--json"], {
      cwd: workerDir,
      env: { ...env, WRANGLER_WRITE_LOGS: "false", WRANGLER_SEND_METRICS: "false" },
      timeout: 30_000,
    });
    auth = JSON.parse(stdout);
  } catch {
    throw new SetupError("Cannot read the selected Builds API token through Wrangler.");
  }
  if (auth?.type !== "api_token" || typeof auth.token !== "string" || !auth.token) {
    throw new SetupError("Select an API token in Cloudflare Builds; local OAuth and Global API keys are not supported.");
  }
  return auth.token;
}

function matchesSettings(trigger) {
  return Object.entries(settings).every(([key, value]) => Array.isArray(value)
    ? Array.isArray(trigger?.[key]) && JSON.stringify([...trigger[key]].sort()) === JSON.stringify([...value].sort())
    : key === "root_directory" ? trigger?.[key]?.replace(/^\/+|\/+$/g, "") === value : trigger?.[key] === value);
}

export async function setupBuilds({ env = process.env, readToken = readBuildToken, fetcher = fetch, log = console.log } = {}) {
  if (env.WORKERS_CI !== "1" || env.WRANGLER_CI_OVERRIDE_NAME !== "atlas-router"
      || env.WORKERS_CI_BRANCH !== "develop" || !identifier.test(env.WORKERS_CI_BUILD_UUID ?? "")
      || !/^[a-f0-9]{40}$/i.test(env.WORKERS_CI_COMMIT_SHA ?? "")) {
    throw new SetupError("Run setup:builds inside atlas-router Cloudflare Builds on develop.");
  }
  const token = await readToken(env);
  const api = async (route, body) => {
    let response;
    let data;
    try {
      response = await fetcher(`https://api.cloudflare.com/client/v4${route}`, {
        method: body ? "PATCH" : "GET",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      data = await response.json();
    } catch {
      throw new SetupError("Cloudflare Builds setup request failed; no credentials or response body were logged.");
    }
    if (response.status === 401 || response.status === 403) {
      throw new SetupError("Cloudflare denied setup. Add Workers Builds Configuration > Edit to the existing Builds token, then retry the build.");
    }
    if (!response.ok || data?.success !== true) {
      throw new SetupError(`Cloudflare Builds setup failed (HTTP ${response.status}); response details were omitted.`);
    }
    return data.result;
  };

  let account = env.CLOUDFLARE_ACCOUNT_ID;
  if (!account) {
    const accounts = await api("/accounts?per_page=2");
    if (!Array.isArray(accounts) || accounts.length !== 1) {
      throw new SetupError("Set CLOUDFLARE_ACCOUNT_ID in Builds variables to select the account; setup will not guess between accounts.");
    }
    account = accounts[0].id;
  }
  if (!/^[a-f0-9]{32}$/i.test(account)) throw new SetupError("The Builds account ID is invalid.");
  const base = `/accounts/${account}`;
  const scripts = await api(`${base}/workers/scripts`);
  const worker = Array.isArray(scripts) && scripts.find((script) => script.id === "atlas-router");
  if (!worker || !identifier.test(worker.tag ?? "")) throw new SetupError("Cannot identify the existing atlas-router Worker.");

  const build = await api(`${base}/builds/builds/${env.WORKERS_CI_BUILD_UUID}`);
  const metadata = build?.build_trigger_metadata;
  if (build?.build_uuid !== env.WORKERS_CI_BUILD_UUID || build?.trigger?.external_script_id !== worker.tag
      || !identifier.test(build?.trigger?.trigger_uuid ?? "") || metadata?.branch !== "develop"
      || metadata?.commit_hash !== env.WORKERS_CI_COMMIT_SHA || metadata?.deploy_command !== dryRunCommand
      || !["push", "manual", "api"].includes(metadata?.build_trigger_source)) {
    throw new SetupError("The running build must be a develop dry-run for this Worker; pull-request and publishing builds cannot configure triggers.");
  }
  const triggerId = build.trigger.trigger_uuid;
  const triggersRoute = `${base}/builds/workers/${worker.tag}/triggers`;
  const findTrigger = (triggers) => Array.isArray(triggers) && triggers.find((trigger) => trigger.trigger_uuid === triggerId);
  const trigger = findTrigger(await api(triggersRoute));
  const repository = trigger?.repo_connection;
  if (!trigger || trigger.deleted_on || trigger.external_script_id !== worker.tag
      || trigger.deploy_command !== dryRunCommand || trigger.root_directory?.replace(/^\/+|\/+$/g, "") !== "worker"
      || repository?.provider_type !== "github" || repository.provider_account_name !== "jarieshan"
      || repository.repo_name !== "AtlasRouter") {
    throw new SetupError("The current trigger must target jarieshan/AtlasRouter, worker/, and the dry-run deploy command.");
  }

  const changed = !matchesSettings(trigger);
  if (changed) {
    await api(`${base}/builds/triggers/${triggerId}`, settings);
    const confirmed = findTrigger(await api(triggersRoute));
    if (confirmed?.external_script_id !== worker.tag || !matchesSettings(confirmed)) {
      throw new SetupError("Could not confirm both branches and the dry-run command after updating the trigger.");
    }
  }
  log("Builds setup verified: master + develop; deploy command remains dry-run. No Worker code or D1 data was changed.");
  return { changed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  setupBuilds().catch((error) => {
    console.error(error instanceof SetupError ? error.message : "Builds setup failed; private error details were omitted.");
    process.exitCode = 1;
  });
}
