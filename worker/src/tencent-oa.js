import { ASSETS } from "./generated/assets.js";
import { splitSurgeList } from "./surge-format.js";

export const TENCENT_OA_MODULE = "tencent-oa.sgmodule";

// Legacy tencent_oa=1 links replace skip-proxy with the module's list, as the module does.
export function tencentOaSkipProxy() {
  return splitSurgeList(ASSETS.modules[TENCENT_OA_MODULE].match(/^skip-proxy[ \t]*=[ \t]*(.+)$/m)[1]).join(", ");
}
