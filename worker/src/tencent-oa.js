import { ASSETS } from "./generated/assets.js";
import { splitSurgeList } from "./surge-format.js";

export function appendTencentOaSkipProxy(value) {
  return [...new Set([
    ...splitSurgeList(value), ...ASSETS.tencentOa.skipProxyCidrs,
    ...ASSETS.tencentOa.domains.flatMap((domain) =>
      domain === "oa.com" || domain === "woa.com" ? [domain, `*.${domain}`] : [`*${domain}`]),
  ])].join(", ");
}
