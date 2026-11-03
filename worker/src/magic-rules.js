import { ASSETS } from "./generated/assets.js";

const ARTIFACTS = "https://magicrule.pages.dev/data/_shared/artifacts/";
const EXTENSIONS = { surge: "list", mihomo: "yaml" };

export function magicRuleUrl(name, client) {
  const url = Object.hasOwn(ASSETS.magicRules, name) && Object.hasOwn(EXTENSIONS, client) ? ASSETS.magicRules[name][client] : null;
  if (typeof url !== "string" || !url.startsWith(`${ARTIFACTS}${name}_`) || !url.endsWith(`.${EXTENSIONS[client]}`)) {
    throw new Error("Unregistered MagicRule source");
  }
  return url;
}

export function nativeMagicRuleSource(source) {
  if (source.kind !== "RULE-SET") return null;
  const name = Object.keys(ASSETS.magicRules).find((key) => ASSETS.magicRules[key].surge === source.url);
  return name ? { name, url: magicRuleUrl(name, "mihomo"), format: "yaml" } : null;
}
