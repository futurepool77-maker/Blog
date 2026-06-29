// Minimal .env loader (zero dependencies). Reads KEY=VALUE pairs from the
// repo-root .env into process.env for any key NOT already set, so a real
// environment variable always wins over the file. A missing .env is fine.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, "..", ".env");

try {
  const text = readFileSync(ENV_PATH, "utf8");
  for (let line of text.split("\n")) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = val;
  }
} catch (e) {
  // Missing .env is expected; only surface real read errors (e.g. permissions).
  if (e.code !== "ENOENT") {
    console.error(`Warning: could not read .env: ${e.message}`);
  }
}
