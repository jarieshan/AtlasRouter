import { splitSurgeList, surgeAssignment, surgeBoolean, surgeValue } from "./surge-format.js";

// Rule-set visibility is an AtlasRouter shorthand for the target group's visibility.
export function applyRuleSetVisibility(profile, { showAllGroups = false } = {}) {
  const visibility = new Map();
  let section = "";
  const lines = profile.split("\n").map((line) => {
    const heading = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (heading) section = heading[1].trim().toLowerCase();
    if (section !== "rule" || !/^\s*(?:RULE-SET|DOMAIN-SET),/.test(line)) return line;
    const parts = splitSurgeList(line);
    const options = parts.slice(3).filter((part) => /^hidden\s*=/i.test(part));
    if (!options.length) return line;
    if (options.length !== 1) throw new Error("Duplicate rule-set visibility option");
    const hidden = surgeBoolean(surgeValue(surgeAssignment(options[0])[1]));
    const policy = surgeValue(parts[2]);
    if (visibility.has(policy) && visibility.get(policy) !== hidden) throw new Error("Conflicting rule-set visibility options");
    visibility.set(policy, hidden);
    return parts.filter((part, index) => index < 3 || !/^hidden\s*=/i.test(part)).join(",");
  });
  if (!visibility.size && !showAllGroups) return profile;
  const remaining = new Set(visibility.keys());
  section = "";
  const result = lines.map((line) => {
    const heading = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (heading) section = heading[1].trim().toLowerCase();
    if (section !== "proxy group" || /^\s*(?:[#;]|\/\/)/.test(line) || !line.includes("=")) return line;
    const [name, value] = surgeAssignment(line);
    const policy = surgeValue(name);
    if (!visibility.has(policy) && !showAllGroups) return line;
    const parts = splitSurgeList(value).filter((part, index) => index === 0 || !/^hidden\s*=/i.test(part));
    if (!showAllGroups && visibility.get(policy)) parts.push("hidden=true");
    remaining.delete(policy);
    return `${name} = ${parts.join(", ")}`;
  });
  if (remaining.size) throw new Error("Rule-set visibility requires an existing policy group");
  return result.join("\n");
}
