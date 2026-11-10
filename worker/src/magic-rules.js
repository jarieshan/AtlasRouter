import { ASSETS } from "./generated/assets.js";
import { HttpError } from "./errors.js";
import { subscriptionPath } from "./routes.js";
import { inheritBranch, requestBranch } from "./branch-query.js";

// The MagicRule index lists manifests on both Pages projects; each names artifacts on its own site.
const MANIFEST = /^https:\/\/(?:magicrule|rule-26r)\.pages\.dev\/data\/rules\/(Surge|Mihomo)\/[a-f0-9]{24}\/manifest\.json$/;
const CLIENTS = { surge: { name: "Surge", extension: "list" }, mihomo: { name: "Mihomo", extension: "yaml" } };
const RULE = /^[A-Z][A-Z0-9-]*,[^\r\n]+$/;

export function findMagicRuleSource(filename) {
  const match = /^magicrule\/(surge|mihomo)\/([A-Za-z][A-Za-z0-9]*)\.(list|yaml)$/.exec(filename);
  if (!match) return null;
  const [, client, name, extension] = match;
  if (extension !== CLIENTS[client].extension || !Object.hasOwn(ASSETS.magicRules, name)
    || !ASSETS.template.includes(`{{RULESET_${name}}}`)) return null;
  const manifest = ASSETS.magicRules[name][client];
  if (typeof manifest !== "string" || MANIFEST.exec(manifest)?.[1] !== CLIENTS[client].name) return null;
  return { name, client, extension, manifest };
}

// No token: [Host] keys reference these URLs, and the Clash converter splits Host lines at the first "=".
export function magicRuleUrl(name, client, requestUrl) {
  const filename = `magicrule/${client}/${name}.${CLIENTS[client]?.extension}`;
  if (!findMagicRuleSource(filename)) throw new Error("Unregistered MagicRule source");
  return inheritBranch(new URL(`${subscriptionPath(requestUrl)}/rules/${filename}`, requestUrl), requestUrl).toString();
}

export function nativeMagicRuleSource(source, requestUrl) {
  if (source.kind !== "RULE-SET") return null;
  const url = new URL(source.url);
  const prefix = `${subscriptionPath(requestUrl)}/rules/`;
  if (url.origin !== new URL(requestUrl).origin || !url.pathname.startsWith(prefix) || url.hash
    || [...url.searchParams.keys()].some((key) => key !== "dev")) return null;
  try { if (requestBranch(url) !== requestBranch(requestUrl)) return null; } catch { return null; }
  const registered = findMagicRuleSource(url.pathname.slice(prefix.length));
  if (registered?.client !== "surge") return null;
  return { name: registered.name, url: magicRuleUrl(registered.name, "mihomo", requestUrl), format: "yaml" };
}

// Line checks keep large lists within the Worker CPU budget, unlike a full YAML parse:
// MagicRule's classical YAML is a `payload:` key followed by one list item per line.
export function magicRuleLines(body, client) {
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^[#;]/.test(line));
  if (client === "surge") return lines;
  if (lines.shift() !== "payload:") return [];
  return lines.map((line) => /^-\s+(['"]?)([^'"]*)\1$/.exec(line)?.[2] ?? null);
}

async function download(url, limit, signal, fetcher) {
  const response = await fetcher(url, {
    redirect: "manual", signal,
    headers: { accept: "application/json, application/yaml, text/plain", "user-agent": "AtlasRouter-Rules/1.0" },
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error(); }
    chunks.push(value);
  }
  return new Blob(chunks).text();
}

export async function downloadMagicRuleSet(source, fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const manifest = JSON.parse(await download(source.manifest, 256 * 1024, controller.signal, fetcher));
    if (manifest.client !== CLIENTS[source.client].name || manifest.rule !== source.name) throw new Error();
    const artifact = manifest.artifacts.find((entry) => entry.role === "full" && entry.ext === source.extension && !entry.binary && !entry.empty);
    const url = new URL(artifact.url);
    if (url.origin !== new URL(source.manifest).origin || url.username || url.password || url.search || url.hash
      || !new RegExp(`^/data/_shared/artifacts/${source.name}_[A-Za-z0-9_-]+\\.${source.extension}$`).test(url.pathname)) throw new Error();
    const body = await download(url.toString(), 4 * 1024 * 1024, controller.signal, fetcher);
    const rules = magicRuleLines(body, source.client);
    if (!rules.length || rules.some((rule) => rule === null || !RULE.test(rule))) throw new Error();
    return body;
  } catch { throw new HttpError(502, "Unable to load MagicRule list"); }
  finally { clearTimeout(timer); }
}

// Clients keep their own copy when a download fails; the stored copy covers new installations.
export async function serveMagicRuleSet(request, env, source, fetcher = fetch) {
  let body = null;
  let failure;
  try { body = await downloadMagicRuleSet(source, fetcher); } catch (error) { failure = error; }
  let hash;
  if (body === null) {
    let stored = null;
    try {
      stored = await env.DB.prepare("SELECT sha256, body FROM magic_rule_sets WHERE name = ? AND client = ?")
        .bind(source.name, source.client).first();
    } catch { /* Without a stored copy the upstream error stands. */ }
    if (!stored) throw failure;
    ({ sha256: hash, body } = stored);
  } else {
    hash = await sha256(body);
    try {
      const stored = await env.DB.prepare("SELECT sha256 FROM magic_rule_sets WHERE name = ? AND client = ?")
        .bind(source.name, source.client).first();
      if (stored?.sha256 !== hash) {
        await env.DB.prepare(`INSERT INTO magic_rule_sets (name, client, sha256, body, updated_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (name, client) DO UPDATE SET sha256 = excluded.sha256, body = excluded.body, updated_at = excluded.updated_at`)
          .bind(source.name, source.client, hash, body, new Date().toISOString()).run();
      }
    } catch { /* A storage failure must not withhold a list that passed validation. */ }
  }
  const headers = {
    "content-type": source.client === "mihomo" ? "application/yaml; charset=utf-8" : "text/plain; charset=utf-8",
    "cache-control": "no-cache",
    etag: `"${hash}"`,
  };
  const matches = (request.headers.get("if-none-match") ?? "").split(",")
    .some((tag) => ["*", headers.etag].includes(tag.trim().replace(/^W\//, "")));
  return new Response(matches ? null : body, { status: matches ? 304 : 200, headers });
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
