import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));

const sourceFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(filename)
      : /\.tsx?$/.test(entry.name)
      ? [filename]
      : [];
  });

test("typechecking includes every application TypeScript source file", () => {
  const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  assert.deepEqual(parsed.errors, []);

  const included = new Set(parsed.fileNames);
  const missing = ["src", "lib", "types"]
    .flatMap((directory) => sourceFiles(path.join(root, directory)))
    .filter((filename) => !included.has(filename))
    .map((filename) => path.relative(root, filename));

  assert.deepEqual(missing, [], "Application files must not silently escape typechecking");
});
