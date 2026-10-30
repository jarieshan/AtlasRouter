import { HttpError } from "./errors.js";
import { handlePoolRequest } from "./pool-routes.js";

const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};

export async function handleRequest(request, env) {
  let response;
  try {
    response = await handlePoolRequest(request, env);
    if (!response) throw new HttpError(404, "Not Found");
  } catch (error) {
    response = new Response(error instanceof HttpError ? error.message : "Internal Server Error", {
      status: error instanceof HttpError ? error.status : 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  response.headers.set("cache-control", "no-store");
  return response;
}
