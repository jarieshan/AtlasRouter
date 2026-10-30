import { HttpError } from "./errors.js";
import { readPreviewNodes } from "./subscription-db.js";

export async function isPreviewIdentity(email, env) {
  const configured = env.PREVIEW_EMAIL_HASHES;
  if (configured === undefined || configured === "") return false;
  if (typeof configured !== "string") throw new HttpError(503, "Preview identity configuration is invalid");
  const hashes = configured.split(",").map((value) => value.trim().toLowerCase());
  if (hashes.some((value) => !/^[a-f0-9]{64}$/.test(value))) throw new HttpError(503, "Preview identity configuration is invalid");
  if (typeof email !== "string") return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase()));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return hashes.includes(hash);
}

// Display-only fixtures: no credentials, real nodes, or stored user identity.
export function pagePreviewProfile() {
  const groups = [
    ["🇺🇸USA-ISP", "🇺🇸 美国 ISP"],
    ["🇭🇰HK-IDC", "🇭🇰 香港 IDC"],
    ["🇸🇬SG-WARP", "🇸🇬 新加坡 WARP"],
    ["🇯🇵JP-ISP", "🇯🇵 日本 ISP"],
  ].map(([group, name], index) => ({
    group,
    primaryId: `preview-${index}-0`,
    nodes: [0, 1, 2].map((offset) => ({ id: `preview-${index}-${offset}`, name: `${name} 示例 ${offset + 1}` })),
  }));
  return {
    email: "preview@example.invalid",
    status: "active",
    subscriptionUrl: "https://preview.invalid/AtlasRouter?token=preview",
    groups,
  };
}

export async function readPreviewProfile(env) {
  const groups = new Map();
  for (const { id, name, group } of await readPreviewNodes(env)) {
    if (!groups.has(group)) groups.set(group, { group, primaryId: id, nodes: [] });
    groups.get(group).nodes.push({ id, name });
  }
  return {
    ...pagePreviewProfile(),
    nodeSource: "database",
    status: groups.size ? "active" : "pending",
    groups: [...groups.values()],
  };
}
