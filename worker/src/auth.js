import { HttpError } from "./errors.js";

export function getRequestToken(request) {
  return new URL(request.url).searchParams.get("token") ?? "";
}

export function findAuthorizedProfile(request, profiles) {
  const actual = getRequestToken(request);
  const profile = profiles.find((candidate) => tokensEqual(actual, candidate.subscribeToken));
  if (!profile) {
    throw new HttpError(401, "Unauthorized");
  }

  return {
    profile,
    token: actual,
  };
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
