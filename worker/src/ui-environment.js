import { HttpError } from "./errors.js";
import { POOL_SUBSCRIPTION_PATH } from "./routes.js";
import { developmentAvailable } from "./development.js";

export function uiEnvironment(requestUrl, env) {
  const url = new URL(requestUrl);
  const values = url.searchParams.getAll("environment");
  if (values.length > 1 || (values.length && !["production", "development"].includes(values[0]))) {
    throw new HttpError(400, "Invalid UI environment");
  }
  const development = values[0] === "development";
  if (development && !developmentAvailable(env)) {
    throw new HttpError(503, "Development subscriptions are not configured");
  }
  url.pathname = env.SUBSCRIPTION_PATH ?? POOL_SUBSCRIPTION_PATH;
  url.search = "";
  if (development) url.searchParams.set("dev", "1");
  return { env: development ? { ...env, DB: env.DEV_DB } : env, subscriptionBase: url.toString(), development };
}
