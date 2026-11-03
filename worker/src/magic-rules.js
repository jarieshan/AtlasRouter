import { ASSETS } from "./generated/assets.js";

// The MagicRule index serves artifacts from both Pages projects.
const ARTIFACTS = ["https://magicrule.pages.dev/data/_shared/artifacts/", "https://rule-26r.pages.dev/data/_shared/artifacts/"];
const EXTENSIONS = { surge: "list", mihomo: "yaml" };

export function magicRuleUrl(name, client) {
  const url = Object.hasOwn(ASSETS.magicRules, name) && Object.hasOwn(EXTENSIONS, client) ? ASSETS.magicRules[name][client] : null;
  if (typeof url !== "string" || !ARTIFACTS.some((prefix) => url.startsWith(`${prefix}${name}_`)) || !url.endsWith(`.${EXTENSIONS[client]}`)) {
    throw new Error("Unregistered MagicRule source");
  }
  return url;
}

export function nativeMagicRuleSource(source) {
  if (source.kind !== "RULE-SET") return null;
  const name = Object.keys(ASSETS.magicRules).find((key) => ASSETS.magicRules[key].surge === source.url);
  return name ? { name, url: magicRuleUrl(name, "mihomo"), format: "yaml" } : null;
}
