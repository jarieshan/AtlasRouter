import { requestBranch } from "./branch-query.js";
import { HttpError } from "./errors.js";

const SHARED_ACCESS_KEYS = ["ACCESS_TEAM_DOMAIN", "ACCESS_AUD", "ACCESS_JWKS_JSON"];

export function branchEnvironment(env, branch) {
  if (!["master", "develop"].includes(branch)) throw new Error("Unknown branch");
  const selected = {};
  for (const [name, value] of Object.entries(env)) {
    if (branch === "develop" && name.startsWith("DEV_")) selected[name.slice(4)] = value;
    if (branch === "master" && !name.startsWith("DEV_")) selected[name] = value;
  }
  // One hostname uses one Access application. Data and administrator settings remain separate.
  for (const name of SHARED_ACCESS_KEYS) {
    if (env[name] !== undefined) selected[name] = env[name];
  }
  if (!selected.DB) throw new HttpError(503, "Selected branch database is not configured");
  return selected;
}

export function createBranchRouter(loaders) {
  return {
    async fetch(request, env, ctx) {
      try {
        const branch = requestBranch(request.url);
        const selected = branchEnvironment(env, branch);
        const module = await loaders[branch]();
        if (typeof module.default?.fetch !== "function") throw new Error("Invalid branch entrypoint");
        return await module.default.fetch(request, selected, ctx);
      } catch (error) {
        return new Response(error instanceof HttpError ? error.message : "Internal Server Error", {
          status: error instanceof HttpError ? error.status : 500,
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
        });
      }
    },
  };
}
