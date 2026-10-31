import { HttpError } from "./errors.js";
import { accountView, allocateNodes, parsePoolNodes, userGroups } from "./node-pool.js";
import { readSubscriptionState, readUserState, writeSubscriptionState } from "./subscription-db.js";
import { isPreviewIdentity } from "./page-preview.js";
import { resetPoolNodes } from "./node-import.js";

const MAX_WRITE_ATTEMPTS = 12;

export async function callSubscriptionStore(env, input) {
  if (["account", "rotate-token"].includes(input.action) && await isPreviewIdentity(input.identity?.email, env)) {
    throw new HttpError(403, "Preview accounts do not have stored subscriptions");
  }
  if (input.action === "account" || input.action === "subscription") {
    const subscription = input.action === "subscription";
    const state = await readUserState(env, subscription ? "subscribe_token" : "email", subscription ? input.token : input.identity.email);
    if (subscription && state.users[0] && await isPreviewIdentity(state.users[0].email, env)) throw new HttpError(401, "Unauthorized");
    if (subscription || state.users.length) return operate(state, input).value;
  }
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const stored = await readSubscriptionState(env);
    const { value, changed } = operate(stored.state, input);
    // Commit changed rows together only if no other request changed the version.
    // A loser reloads and recomputes; it must never return an uncommitted token.
    if (!changed || await writeSubscriptionState(env, stored)) return value;
    if (attempt + 1 < MAX_WRITE_ATTEMPTS) {
      const delay = Math.min(10 * 2 ** attempt, 250);
      await new Promise((resolve) => setTimeout(resolve, delay * (0.5 + Math.random())));
    }
  }
  throw new HttpError(503, "Configuration is busy; retry the request");
}

function operate(state, input) {
  const now = new Date().toISOString();
  switch (input.action) {
    case "account":
    case "rotate-token": {
      const { email } = input.identity;
      let user = state.users.find((candidate) => candidate.email === email);
      let changed = false;
      if (!user) {
        user = { id: crypto.randomUUID(), email, enabled: true, createdAt: now, subscribeToken: generateToken() };
        state.users.push(user);
        allocateNodes(state, now);
        changed = true;
      }
      if (!user.enabled) throw new HttpError(403, "Account is disabled");
      if (input.action === "rotate-token") {
        user.subscribeToken = generateToken();
        changed = true;
      }
      return { value: accountView(state, user), changed };
    }
    case "inventory":
      return { value: inventoryView(state), changed: false };
    case "save-inventory": {
      if (!Number.isInteger(input.revision) || input.revision !== state.revision) {
        throw new HttpError(409, "Inventory changed; reload before saving");
      }
      state.nodes = parsePoolNodes(input.nodes, state.nodes);
      allocateNodes(state, now);
      state.revision += 1;
      return { value: inventoryView(state), changed: true };
    }
    case "reset-nodes": {
      if (!Number.isInteger(input.revision) || input.revision !== state.revision) {
        throw new HttpError(409, "Inventory changed; reload before resetting");
      }
      state.nodes = parsePoolNodes(resetPoolNodes(input.nodes));
      allocateNodes(state, now);
      state.revision += 1;
      return { value: inventoryView(state), changed: true };
    }
    case "set-user": {
      const user = state.users.find((candidate) => candidate.id === input.id);
      if (!user) throw new HttpError(404, "User not found");
      if (typeof input.enabled !== "boolean") throw new HttpError(400, "enabled must be a boolean");
      if (user.enabled !== input.enabled) {
        user.enabled = input.enabled;
        // Re-enabling an account must not restore a credential that was revoked.
        user.subscribeToken = generateToken();
        allocateNodes(state, now);
      }
      return { value: inventoryView(state), changed: true };
    }
    case "subscription": {
      const user = state.users.find((candidate) => candidate.enabled && tokensEqual(input.token, candidate.subscribeToken));
      if (!user) throw new HttpError(401, "Unauthorized");
      const groups = userGroups(state, user.id).filter((group) => group.primaryId);
      if (!groups.length) throw new HttpError(503, "Waiting for node allocation");
      return { value: { groups }, changed: false };
    }
    default:
      throw new HttpError(404, "Not Found");
  }
}

function inventoryView(state) {
  return {
    revision: state.revision,
    nodes: state.nodes,
    users: state.users.map((user) => {
      const { subscribeToken, ...view } = accountView(state, user);
      return { ...view, enabled: user.enabled, createdAt: user.createdAt };
    }),
  };
}

function generateToken() {
  return "ar_" + Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function tokensEqual(actual, expected) {
  if (typeof actual !== "string" || actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}
