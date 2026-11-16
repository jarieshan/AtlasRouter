import { requestBranch } from "./branch-query.js";
import { HttpError } from "./errors.js";
import { DEV_SUBSCRIPTION_PATH, INTERNAL_ACCOUNT_PAGE_PATH, POOL_SUBSCRIPTION_PATH } from "./routes.js";

export function developmentAvailable(env) {
  return Boolean(env.DEV_DB && env.DEV_DB !== env.DB && typeof env.DEV_SUBSCRIPTION_SERVICE?.fetch === "function");
}

// The portal sends this rendering context only after verifying Access and roles.
// The private Worker receives no browser credentials or user identity.
export async function developmentPage(request, env, context) {
  const url = new URL(request.url);
  url.pathname = INTERNAL_ACCOUNT_PAGE_PATH;
  url.search = "";
  const response = await env.DEV_SUBSCRIPTION_SERVICE.fetch(new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", origin: url.origin },
    body: JSON.stringify(context),
    redirect: "manual",
  })).catch(() => { throw new HttpError(503, "Development page is unavailable"); });
  if (response.status !== 200 || !response.headers.get("content-type")?.includes("text/html")
    || response.headers.get("x-atlasrouter-page-environment") !== "development") {
    await response.body?.cancel();
    throw new HttpError(503, "Development page is unavailable");
  }
  return new Response(response.body, response);
}

// Public subscription forwarding is restricted to these paths and GET requests.
export async function developmentRequest(request, env) {
  const url = new URL(request.url);
  const development = requestBranch(request.url) === "develop";
  const subscription = [POOL_SUBSCRIPTION_PATH, DEV_SUBSCRIPTION_PATH].some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`));
  if (env.SUBSCRIPTION_VARIANT === "development") {
    if (!development || !subscription) throw new HttpError(404, "Not Found");
    return null;
  }
  if (!development) return null;
  if (!subscription) throw new HttpError(404, "Not Found");
  if (request.method !== "GET") throw new HttpError(405, "Method Not Allowed");
  if (!developmentAvailable(env)) throw new HttpError(503, "Development subscriptions are not configured");
  const headers = new Headers();
  for (const name of ["accept", "if-none-match"]) {
    if (request.headers.has(name)) headers.set(name, request.headers.get(name));
  }
  if (url.pathname === POOL_SUBSCRIPTION_PATH || url.pathname.startsWith(`${POOL_SUBSCRIPTION_PATH}/`)) {
    url.pathname = DEV_SUBSCRIPTION_PATH + url.pathname.slice(POOL_SUBSCRIPTION_PATH.length);
  }
  url.searchParams.delete("dev");
  const response = await env.DEV_SUBSCRIPTION_SERVICE.fetch(new Request(url, { method: "GET", headers, redirect: "manual" }));
  return new Response(response.body, response);
}
