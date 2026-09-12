import { readFile } from "node:fs/promises";

/** KEY=value lines; a JSON-quoted value is unquoted. Unknown lines skipped. */
export function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const raw = trimmed.slice(eq + 1).trim();
    try {
      values[key] = raw.startsWith('"') ? JSON.parse(raw) : raw;
    } catch {
      values[key] = raw;
    }
  }
  return values;
}

/** Load repo-root .env into process.env for keys not already set. The CI
 *  key pair in .env is for `gh secret set`, never for a local deploy, which
 *  runs as AWS_PROFILE=jamie; so AWS_* names are never lifted from it. */
export async function loadEnvInto(path) {
  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch {
    return {};
  }
  const values = parseEnv(text);
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith("AWS_") || key.startsWith("ELIXIR_CLAN_AWS_")) continue;
    if (!process.env[key]) process.env[key] = value;
  }
  return values;
}
