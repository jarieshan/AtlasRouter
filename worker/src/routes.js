export const API_PATH = "/api";
export const ACCOUNT_PATH = "/";
export const ACCOUNT_PROFILE_PATH = `${API_PATH}/account/profile`;
export const ACCOUNT_TOKEN_PATH = `${API_PATH}/account/token`;
export const POOL_SUBSCRIPTION_PATH = "/AtlasRouter";
export const DEV_SUBSCRIPTION_PATH = "/AtlasRouter-Dev";

export function subscriptionPath(requestUrl) {
  const path = new URL(requestUrl).pathname;
  return path === DEV_SUBSCRIPTION_PATH || path.startsWith(`${DEV_SUBSCRIPTION_PATH}/`)
    ? DEV_SUBSCRIPTION_PATH : POOL_SUBSCRIPTION_PATH;
}

export function getAdminRoutes(env) {
  const slug = env.ADMIN_API_SLUG;
  if (typeof slug !== "string" || !/^[a-f0-9]{32}$/.test(slug)) return null;
  const prefix = `${API_PATH}/${slug}/pool`;
  return { state: `${prefix}/state`, nodes: `${prefix}/nodes`, users: `${prefix}/users`, import: `${prefix}/import`,
    resetProduction: `${prefix}/reset-production` };
}
