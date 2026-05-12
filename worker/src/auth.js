import { HttpError } from "./errors.js";

export function getRequestToken(request) {
  return new URL(request.url).searchParams.get("token") ?? "";
}

export function requireAuthorized(request, env) {
  const expected = env.SUBSCRIBE_TOKEN;
  if (!expected) {
    throw new HttpError(500, "SUBSCRIBE_TOKEN is not configured");
  }

  const actual = getRequestToken(request);
  if (!tokensEqual(actual, expected)) {
    throw new HttpError(401, "Unauthorized");
  }

  return actual;
}

function tokensEqual(actual, expected) {
  if (!actual || actual.length !== expected.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return diff === 0;
}
