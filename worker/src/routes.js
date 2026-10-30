export const API_PATH = "/api";
export const ACCOUNT_PATH = "/";
export const ACCOUNT_PROFILE_PATH = `${API_PATH}/account/profile`;
export const ACCOUNT_TOKEN_PATH = `${API_PATH}/account/token`;
export const POOL_SUBSCRIPTION_PATH = "/AtlasRouter";

export function getAdminRoutes(env) {
  const slug = env.ADMIN_API_SLUG;
  if (typeof slug !== "string" || !/^[a-f0-9]{32}$/.test(slug)) return null;
  const prefix = `${API_PATH}/${slug}/pool`;
  return { state: `${prefix}/state`, nodes: `${prefix}/nodes`, users: `${prefix}/users`, import: `${prefix}/import` };
}
