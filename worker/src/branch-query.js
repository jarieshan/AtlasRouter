import { HttpError } from "./errors.js";

export function requestBranch(requestUrl) {
  const url = new URL(requestUrl);
  const values = url.searchParams.getAll("dev");
  if (values.length > 1 || (values.length && !["0", "1"].includes(values[0]))) {
    throw new HttpError(400, "dev must be 0 or 1 and appear only once");
  }
  return url.pathname === "/AtlasRouter-Dev" || url.pathname.startsWith("/AtlasRouter-Dev/") || values[0] === "1" ? "develop" : "master";
}

export function inheritBranch(url, requestUrl) {
  requestBranch(requestUrl);
  url.searchParams.delete("dev");
  return url;
}
