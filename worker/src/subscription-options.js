import { HttpError } from "./errors.js";
import { subscriptionPath } from "./routes.js";
import { inheritBranch } from "./branch-query.js";

export function readSubscriptionOptions(params) {
  const clients = params.getAll("client");
  const dns = params.getAll("doh");
  const tencentOa = params.getAll("tencent_oa");
  const wifiAssist = params.getAll("wifi_assist");
  if (clients.length > 1 || dns.length > 1 || tencentOa.length > 1 || wifiAssist.length > 1
    || (clients.length && !["surge", "clash"].includes(clients[0]))
    || (dns.length && !["0", "1"].includes(dns[0]))
    || (tencentOa.length && !["0", "1"].includes(tencentOa[0]))
    || (wifiAssist.length && !["0", "1"].includes(wifiAssist[0]))) {
    throw new HttpError(400, "Invalid subscription options: client must be surge or clash; doh, tencent_oa and wifi_assist must be 0 or 1");
  }
  if (clients[0] === "clash" && tencentOa[0] === "1") throw new HttpError(400, "Company intranet compatibility requires Surge");
  return { client: clients[0] ?? "surge", doh: dns[0] !== "0", tencentOa: tencentOa[0] === "1", wifiAssist: wifiAssist[0] === "1" };
}

export function buildSubscriptionUrl(requestUrl, token, { client = "surge", doh = true, tencentOa = false, wifiAssist = false } = {}) {
  if (tencentOa && client !== "surge") throw new HttpError(400, "Company intranet compatibility requires Surge");
  const url = inheritBranch(new URL(subscriptionPath(requestUrl), requestUrl), requestUrl);
  url.searchParams.set("token", token);
  if (client !== "surge") url.searchParams.set("client", client);
  if (!doh) url.searchParams.set("doh", "0");
  if (tencentOa) url.searchParams.set("tencent_oa", "1");
  if (wifiAssist) url.searchParams.set("wifi_assist", "1");
  return url.toString();
}
