import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workerDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(workerDir, "..");

function readText(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8")
    .replace(/\r\n/g, "\n")
    .trimEnd() + "\n";
}

function readDirectoryFiles(relativeDir, extension) {
  const dir = path.join(repoRoot, relativeDir);
  return Object.fromEntries(
    readdirSync(dir)
      .filter((name) => name.endsWith(extension))
      .sort()
      .map((name) => [name, readText(path.join(relativeDir, name))]),
  );
}

const assets = {
  template: readText("surge/template.conf"),
  modules: readDirectoryFiles("modules", ".sgmodule"),
};

const generatedDir = path.join(workerDir, "src", "generated");
mkdirSync(generatedDir, { recursive: true });
writeFileSync(
  path.join(generatedDir, "assets.js"),
  `export const ASSETS = ${JSON.stringify(assets, null, 2)};\n`,
);
