import { renderAdminPage } from "./admin.js";
import { requireAccessAdmin } from "./access-auth.js";
import { findAuthorizedProfile } from "./auth.js";
import { loadRouterConfig, saveRouterConfig, serializeRouterConfig } from "./config-loader.js";
import { HttpError } from "./errors.js";
import { generateMitmCertificate } from "./mitm-certificate.js";
import { getModule, renderSurgeProfile } from "./render-surge.js";
import { ADMIN_CERTIFICATE_PATH, ADMIN_CONFIG_PATH, ADMIN_PATH, SUBSCRIPTION_PATH } from "./routes.js";

const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};
const TEXT_HEADERS = {
  ...SECURITY_HEADERS,
  "content-type": "text/plain; charset=utf-8",
  "cache-control": "no-store",
};
const HTML_HEADERS = {
  ...SECURITY_HEADERS,
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
};
const JSON_HEADERS = {
  ...SECURITY_HEADERS,
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};

export async function handleRequest(request, env) {
  try {
    const url = new URL(request.url);
    const moduleName = servedModuleName(url.pathname);

    if (!isServedPath(url.pathname, moduleName)) {
      throw new HttpError(404, "Not Found");
    }

    if (url.pathname === ADMIN_PATH) {
      await requireAccessAdmin(request, env);
      if (request.method !== "GET") {
        return textResponse("Method Not Allowed", 405);
      }
      return htmlResponse(renderAdminPage());
    }

    if (url.pathname === ADMIN_CONFIG_PATH) {
      return await handleAdminConfigRequest(request, env);
    }

    if (url.pathname === ADMIN_CERTIFICATE_PATH) {
      return await handleAdminCertificateRequest(request, env);
    }

    if (request.method !== "GET") {
      return textResponse("Method Not Allowed", 405);
    }

    const config = await loadRouterConfig(env);
    const { profile, token } = findAuthorizedProfile(request, config.profiles);

    if (url.pathname === SUBSCRIPTION_PATH) {
      return textResponse(renderSurgeProfile({ requestUrl: request.url, token, nodes: profile.nodes, mitm: profile.mitm }));
    }

    if (moduleName !== null) {
      const content = getModule(moduleName);
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

function isServedPath(pathname, moduleName) {
  return pathname === ADMIN_PATH
    || pathname === ADMIN_CONFIG_PATH
    || pathname === ADMIN_CERTIFICATE_PATH
    || pathname === SUBSCRIPTION_PATH
    || moduleName !== null;
}

function servedModuleName(pathname) {
  if (!pathname.startsWith("/modules/")) {
    return null;
  }

  let name;
  try {
    name = lastPathSegment(pathname);
  } catch {
    return null;
  }
  return getModule(name) ? name : null;
}

async function handleAdminConfigRequest(request, env) {
  await requireAccessAdmin(request, env);

  if (request.method !== "GET" && request.method !== "PUT") {
    return textResponse("Method Not Allowed", 405);
  }

  if (request.method === "GET") {
    const config = await loadRouterConfig(env);
    return jsonResponse(serializeRouterConfig(config));
  }

  const nextConfig = await readJson(request);
  const savedConfig = await saveRouterConfig(env, nextConfig);
  return jsonResponse(serializeRouterConfig(savedConfig));
}

async function handleAdminCertificateRequest(request, env) {
  await requireAccessAdmin(request, env);

  if (request.method !== "POST") {
    return textResponse("Method Not Allowed", 405);
  }

  const input = await readJson(request);
  const label = typeof input.name === "string" && input.name.trim()
    ? input.name
    : typeof input.id === "string" && input.id.trim()
      ? input.id
      : "AtlasRouter";

  return jsonResponse({ mitm: generateMitmCertificate(label) });
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

function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: HTML_HEADERS,
  });
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value, null, 2) + "\n", {
    status,
    headers: JSON_HEADERS,
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
}
