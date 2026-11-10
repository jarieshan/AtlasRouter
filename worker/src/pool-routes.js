import { isAdminEmail, requireAccessAdmin, requireAccessUser } from "./access-auth.js";
import { HttpError } from "./errors.js";
import { importPoolNodes } from "./node-import.js";
import { downloadClashRuleSet, findClashRuleSource } from "./clash-rules.js";
import { findMagicRuleSource, serveMagicRuleSet } from "./magic-rules.js";
import { renderAccountPage } from "./pool-pages.js";
import { isPreviewIdentity, readPreviewProfile } from "./page-preview.js";
import { renderClashProfile } from "./render-clash.js";
import { getModule, renderSurgeProfile } from "./render-surge.js";
import { callSubscriptionStore } from "./subscription-store.js";
import { buildSubscriptionUrl, readSubscriptionOptions } from "./subscription-options.js";
import { uiEnvironment } from "./ui-environment.js";
import { developmentAvailable, developmentRequest } from "./development.js";
import {
  ACCOUNT_PATH, ACCOUNT_PROFILE_PATH, ACCOUNT_TOKEN_PATH, POOL_SUBSCRIPTION_PATH, getAdminRoutes,
} from "./routes.js";

const ACCOUNT_ROUTES = new Set([ACCOUNT_PATH, ACCOUNT_PROFILE_PATH, ACCOUNT_TOKEN_PATH]);

export async function handlePoolRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/AtlasRouter-Dev" || path.startsWith("/AtlasRouter-Dev/")) {
    throw new HttpError(404, "Not Found");
  }
  const developmentResponse = await developmentRequest(request, env);
  if (developmentResponse) return developmentResponse;
  if (ACCOUNT_ROUTES.has(path)) {
    if (path === ACCOUNT_PATH && env.UI_ENABLED === "false") throw new HttpError(404, "Not Found");
    const identity = await requireAccessUser(request, env);
    requireMethod(request, path === ACCOUNT_TOKEN_PATH ? "POST" : "GET");
    const previewIdentity = await isPreviewIdentity(identity.email, env);
    const target = uiEnvironment(request.url, env);
    if (path === ACCOUNT_PATH) {
      const preview = previewIdentity || url.searchParams.get("preview") === "1";
      const isAdmin = !preview && isAdminEmail(identity.email, env);
      const adminRoutes = isAdmin ? getAdminRoutes(env) : null;
      if (isAdmin && !adminRoutes) throw new HttpError(503, "Management API is not configured");
      const previewProfile = previewIdentity ? await readPreviewProfile(target.env) : null;
      return html(renderAccountPage({ isAdmin, adminRoutes, preview, previewProfile,
        development: target.development, developmentAvailable: developmentAvailable(env) }));
    }
    if (path === ACCOUNT_TOKEN_PATH) await readMutation(request);
    if (previewIdentity) return Response.json(await readPreviewProfile(target.env));
    const profile = await callSubscriptionStore(target.env, { action: path === ACCOUNT_TOKEN_PATH ? "rotate-token" : "account", identity });
    const subscriptionUrl = buildSubscriptionUrl(target.subscriptionBase, profile.subscribeToken);
    const { subscribeToken, ...view } = profile;
    return Response.json({ ...view, subscriptionUrl });
  }
  const adminRoutes = getAdminRoutes(env);
  if (adminRoutes && Object.values(adminRoutes).includes(path)) {
    await requireAccessAdmin(request, env);
    const target = uiEnvironment(request.url, env);
    requireMethod(request, path === adminRoutes.nodes ? "PUT" : path === adminRoutes.users ? "PATCH"
      : path === adminRoutes.import ? "POST" : "GET");
    if (path === adminRoutes.import) {
      return Response.json(await importPoolNodes(await readMutation(request), fetch, env));
    }
    let input = { action: "inventory" };
    if (path === adminRoutes.nodes) {
      const body = await readMutation(request);
      input = { action: "save-inventory", nodes: body.nodes, revision: body.revision };
    }
    if (path === adminRoutes.users) {
      const body = await readMutation(request);
      input = { action: "set-user", id: body.id, enabled: body.enabled };
    }
    return Response.json(await callSubscriptionStore(target.env, input));
  }
  const subscriptionPath = env.SUBSCRIPTION_PATH ?? POOL_SUBSCRIPTION_PATH;
  if (subscriptionPath !== POOL_SUBSCRIPTION_PATH) throw new HttpError(503, "Subscription path is not configured correctly");
  const modulePrefix = `${subscriptionPath}/modules/`;
  const rulesPrefix = `${subscriptionPath}/rules/`;
  let ruleSource = null;
  if (path.startsWith(rulesPrefix)) {
    const magicRule = findMagicRuleSource(path.slice(rulesPrefix.length));
    if (magicRule) {
      requireMethod(request, "GET");
      return serveMagicRuleSet(request, env, magicRule);
    }
    ruleSource = await findClashRuleSource(path.slice(rulesPrefix.length));
    if (!ruleSource) throw new HttpError(404, "Not Found");
  }
  let module = null;
  if (path.startsWith(modulePrefix)) {
    try {
      module = getModule(decodeURIComponent(path.slice(modulePrefix.length)));
    } catch {
      throw new HttpError(404, "Not Found");
    }
    if (!module) throw new HttpError(404, "Not Found");
  }
  if (path === subscriptionPath || module || ruleSource) {
    requireMethod(request, "GET");
    const tokens = url.searchParams.getAll("token");
    if (tokens.length !== 1 || !/^ar_[a-f0-9]{64}$/.test(tokens[0])) throw new HttpError(401, "Unauthorized");
    const { groups } = await callSubscriptionStore(env, { action: "subscription", token: tokens[0] });
    if (ruleSource) return new Response(await downloadClashRuleSet(ruleSource), { headers: { "content-type": "text/plain; charset=utf-8" } });
    if (module) return new Response(module, { headers: { "content-type": "text/plain; charset=utf-8" } });
    const options = readSubscriptionOptions(url.searchParams);
    const surge = renderSurgeProfile({
      requestUrl: request.url, token: tokens[0], groups, nodes: groups.flatMap((group) => group.nodes), options,
      smartPriorityScheme: env.SMART_PRIORITY_SCHEME,
      showAllGroups: env.SHOW_ALL_PROXY_GROUPS === "true",
      tailnetEndpoints: env.TAILNET_ENDPOINTS,
    });
    const body = options.client === "clash" ? await renderClashProfile(surge, { requestUrl: request.url, token: tokens[0] }) : surge;
    return new Response(body, { headers: {
      "content-type": options.client === "clash" ? "application/yaml; charset=utf-8" : "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${subscriptionPath.slice(1)}.${options.client === "clash" ? "yaml" : "conf"}"`,
    } });
  }
  return null;
}

function requireMethod(request, expected) {
  if (request.method !== expected) throw new HttpError(405, "Method Not Allowed");
}

async function readMutation(request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    throw new HttpError(403, "Same-origin request required");
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new HttpError(415, "Content-Type must be application/json");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Request body must be a JSON object");
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 512 * 1024) {
      await reader.cancel();
      throw new HttpError(413, "Request body is too large");
    }
    chunks.push(value);
  }
  try {
    const value = JSON.parse(await new Blob(chunks).text());
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new HttpError(400, "Request body must be a JSON object");
  }
}

function html(body) {
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}
