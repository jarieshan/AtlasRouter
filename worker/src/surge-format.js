// Split Surge lists without splitting quoted credentials or nested rule expressions.
export function splitSurgeList(value) {
  const parts = [];
  let start = 0, quoted = false, escaped = false, depth = 0;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (escaped) { escaped = false; continue; }
    if (quoted && char === "\\") { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth < 0) throw new Error("Invalid list");
    if (char === "," && depth === 0) { parts.push(value.slice(start, i).trim()); start = i + 1; }
  }
  if (quoted || escaped || depth) throw new Error("Invalid list");
  parts.push(value.slice(start).trim());
  return parts;
}

export function surgeValue(value) {
  if (!value.startsWith('"')) return value;
  if (!value.endsWith('"')) throw new Error("Invalid quoted value");
  return value.slice(1, -1).replace(/\\(["\\])/g, "$1");
}

export function surgeAssignment(line) {
  const index = line.indexOf("=");
  if (index < 1) throw new Error("Invalid assignment");
  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}

export function surgeOptions(parts) {
  const options = new Map();
  for (const part of parts) {
    const [name, value] = surgeAssignment(part);
    const key = name.toLowerCase();
    if (options.has(key) || !/^[a-z][a-z0-9-]*$/.test(key)) throw new Error("Invalid option");
    options.set(key, surgeValue(value));
  }
  return options;
}

export function surgeSections(text) {
  const sections = new Map();
  let lines;
  for (const source of text.split(/\r?\n/)) {
    const line = source.trim();
    if (!line || /^[#;]/.test(line)) continue;
    const heading = line.match(/^\[([^\]]+)\]$/);
    if (heading) {
      const name = heading[1].trim().toLowerCase();
      if (!sections.has(name)) sections.set(name, []);
      lines = sections.get(name);
    } else if (lines) lines.push(line);
  }
  return sections;
}

export function surgeBoolean(value) {
  if (/^(true|on|1)$/i.test(value)) return true;
  if (/^(false|off|0)$/i.test(value)) return false;
  throw new Error("Invalid boolean");
}

export function positiveInteger(value) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new Error("Invalid integer");
  return Number(value);
}

const SMART_PRIORITY_WEIGHTS = {
  linear: (index) => index + 1,
  "geometric-3": (index) => 3 ** index,
  "geometric-10": (index) => 10 ** index,
  "geometric-10-from-100": (index) => (index ? 10 ** (index + 1) : 1),
  "geometric-10-from-10000": (index) => (index ? 10 ** (index + 3) : 1),
};
export const SMART_PRIORITY_SCHEMES = Object.keys(SMART_PRIORITY_WEIGHTS);

// Exact-name expressions keep regex metacharacters and priority delimiters literal.
export function orderedSmartPriority(names, scheme = "linear") {
  if (!SMART_PRIORITY_SCHEMES.includes(scheme)) throw new Error("Invalid Smart priority scheme");
  return names.map((name, index) => {
    const weight = SMART_PRIORITY_WEIGHTS[scheme](index);
    if (!Number.isSafeInteger(weight)) throw new Error("Smart priority exceeds the supported range");
    const pattern = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/[:;"\u0000-\u001f\u007f]/g, (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`);
    return `^${pattern}$:${weight}`;
  }).join(";");
}
