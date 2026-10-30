import { HttpError } from "./errors.js";
import { DEV_SUBSCRIPTION_PATH, POOL_SUBSCRIPTION_PATH } from "./routes.js";

function developmentSubscriptionBase(env) {
  if (!env.DEV_SUBSCRIPTION_ORIGIN) return null;
  try {
    const url = new URL(env.DEV_SUBSCRIPTION_ORIGIN);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error();
    return new URL(DEV_SUBSCRIPTION_PATH, url).toString();
  } catch {
    throw new HttpError(503, "Development subscription origin is not configured correctly");
  }
}

// This selects the data managed by the production UI, never the code serving a subscription.
export function uiEnvironment(requestUrl, env) {
  const values = new URL(requestUrl).searchParams.getAll("environment");
  if (values.length > 1 || (values.length && !["production", "development"].includes(values[0]))) {
    throw new HttpError(400, "Invalid UI environment");
  }
  if (values[0] !== "development") {
    const subscriptionBase = new URL(requestUrl);
    subscriptionBase.pathname = env.SUBSCRIPTION_PATH ?? POOL_SUBSCRIPTION_PATH;
    return { env, subscriptionBase: subscriptionBase.toString(), development: false };
  }
  const subscriptionBase = developmentSubscriptionBase(env);
  if (!env.DEV_DB || env.DEV_DB === env.DB || !subscriptionBase
    || new URL(subscriptionBase).origin === new URL(requestUrl).origin) {
    throw new HttpError(503, "Development subscriptions are not configured");
  }
  return { env: { ...env, DB: env.DEV_DB }, subscriptionBase, development: true };
}
