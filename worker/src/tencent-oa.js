import { ASSETS } from "./generated/assets.js";
import { splitSurgeList } from "./surge-format.js";

export const TENCENT_OA_MODULE = "tencent-oa.sgmodule";

// Legacy tencent_oa=1 links append the same exceptions as the module.
export function appendTencentOaSkipProxy(value) {
  const appended = ASSETS.modules[TENCENT_OA_MODULE].match(/^skip-proxy[ \t]*=[ \t]*%APPEND%[ \t]*(.+)$/m)[1];
  return [...new Set([...splitSurgeList(value), ...splitSurgeList(appended)])].join(", ");
}
