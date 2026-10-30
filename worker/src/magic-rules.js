import { parse } from "yaml";
import { ASSETS } from "./generated/assets.js";
import { HttpError } from "./errors.js";
import { subscriptionPath } from "./routes.js";
import { inheritBranch, requestBranch } from "./branch-query.js";

const ORIGIN = "https://magicrule.pages.dev";
const CLIENTS = { surge: { name: "Surge", extension: "list" }, mihomo: { name: "Mihomo", extension: "yaml" } };

export function findMagicRuleSource(filename) {
  const match = /^magicrule\/(surge|mihomo)\/([A-Za-z][A-Za-z0-9]*)\.(list|yaml)$/.exec(filename);
  if (!match) return null;
  const [, client, name, extension] = match;
  if (extension !== CLIENTS[client].extension || !Object.hasOwn(ASSETS.magicRules, name)
    || !ASSETS.template.includes(`{{RULESET_${name}}}`)) return null;
  const id = ASSETS.magicRules[name][client];
  if (!/^[a-f0-9]{24}$/.test(id)) return null;
  return { name, client, extension, manifest: `${ORIGIN}/data/rules/${CLIENTS[client].name}/${id}/manifest.json` };
}

export function magicRuleUrl(name, client, requestUrl, token) {
  const filename = `magicrule/${client}/${name}.${CLIENTS[client]?.extension}`;
  if (!findMagicRuleSource(filename)) throw new Error("Unregistered MagicRule source");
  const url = inheritBranch(new URL(`${subscriptionPath(requestUrl)}/rules/${filename}`, requestUrl), requestUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

export function nativeMagicRuleSource(source, requestUrl, token) {
  if (source.kind !== "RULE-SET") return null;
  const url = new URL(source.url);
  const prefix = `${subscriptionPath(requestUrl)}/rules/`;
  if (url.origin !== new URL(requestUrl).origin || !url.pathname.startsWith(prefix)
    || url.searchParams.getAll("token").length !== 1 || url.searchParams.get("token") !== token
    || [...url.searchParams.keys()].some((key) => !["token", "dev"].includes(key))) return null;
  try { if (requestBranch(url) !== requestBranch(requestUrl)) return null; } catch { return null; }
  const registered = findMagicRuleSource(url.pathname.slice(prefix.length));
  if (registered?.client !== "surge") return null;
  return { name: registered.name, url: magicRuleUrl(registered.name, "mihomo", requestUrl, token), format: "yaml" };
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
    if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash
      || !new RegExp(`^/data/_shared/artifacts/${source.name}_[A-Za-z0-9_-]+\\.${source.extension}$`).test(url.pathname)) throw new Error();
    const body = await download(url.toString(), 4 * 1024 * 1024, controller.signal, fetcher);
    const rules = source.client === "mihomo" ? parse(body)?.payload
      : body.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^[#;]/.test(line));
    if (!Array.isArray(rules) || !rules.length || rules.some((line) => typeof line !== "string" || !/^[A-Z][A-Z0-9-]*,[^\r\n]+$/.test(line))) throw new Error();
    return body;
  } catch { throw new HttpError(502, "Unable to load MagicRule list"); }
  finally { clearTimeout(timer); }
}
