import { HttpError } from "./errors.js";

export function parseNodesText(value) {
  if (!value) {
    throw new HttpError(500, "NODES_TEXT is not configured");
  }

  const nodes = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map(parseNodeLine);

  if (nodes.length === 0) {
    throw new HttpError(500, "NODES_TEXT must contain at least one proxy line");
  }

  return nodes;
}

export function renderProxyLines(nodes) {
  return nodes.map((node) => node.line).join("\n");
}

function parseNodeLine(line) {
  assertSingleLine(line);

  const separatorIndex = line.indexOf("=");
  if (separatorIndex <= 0 || separatorIndex === line.length - 1) {
    throw new HttpError(500, "Each NODES_TEXT line must use Surge proxy syntax: name = type, server, port, ...");
  }

  const name = line.slice(0, separatorIndex).trim();
  const value = line.slice(separatorIndex + 1).trim();

  if (!name || !value) {
    throw new HttpError(500, "Each NODES_TEXT line must include both name and proxy value");
  }
  if (name.includes(",")) {
    throw new HttpError(500, "Node name cannot contain a comma");
  }

  return {
    name,
    line: `${name} = ${value}`,
  };
}

function assertSingleLine(value) {
  if (/[\r\n]/.test(value)) {
    throw new HttpError(500, "Proxy line must be a single line");
  }
}
