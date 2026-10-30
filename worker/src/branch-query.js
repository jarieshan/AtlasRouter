import { HttpError } from "./errors.js";

export function requestBranch(requestUrl) {
  const values = new URL(requestUrl).searchParams.getAll("dev");
  if (values.length > 1 || (values.length && !["0", "1"].includes(values[0]))) {
    throw new HttpError(400, "dev must be 0 or 1 and appear only once");
  }
  return values[0] === "1" ? "develop" : "master";
}

export function inheritBranch(url, requestUrl) {
  if (requestBranch(requestUrl) === "develop") url.searchParams.set("dev", "1");
  else url.searchParams.delete("dev");
  return url;
}
