import { requireAuthorized } from "./auth.js";
import { HttpError } from "./errors.js";
import { parseNodesText } from "./nodes.js";
import { getModule, renderSurgeProfile } from "./render-surge.js";

const TEXT_HEADERS = {
  "content-type": "text/plain; charset=utf-8",
  "cache-control": "no-store",
};

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};

export async function handleRequest(request, env) {
  try {
    if (request.method !== "GET") {
      return textResponse("Method Not Allowed", 405);
    }

    const url = new URL(request.url);
    const token = requireAuthorized(request, env);

    if (url.pathname === "/surge" || url.pathname === "/surge.conf") {
      const nodes = parseNodesText(env.NODES_TEXT);
      return textResponse(renderSurgeProfile({ requestUrl: request.url, token, nodes }));
    }

    if (url.pathname.startsWith("/modules/")) {
      const content = getModule(lastPathSegment(url.pathname));
      if (!content) {
        throw new HttpError(404, "Module not found");
      }
      return textResponse(content);
    }

    throw new HttpError(404, "Not Found");
  } catch (error) {
    if (error instanceof HttpError) {
      return textResponse(error.message, error.status);
    }
    return textResponse("Internal Server Error", 500);
  }
}

function lastPathSegment(pathname) {
  return decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) ?? "");
}

function textResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: TEXT_HEADERS,
  });
}
