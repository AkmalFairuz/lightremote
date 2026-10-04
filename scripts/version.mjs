import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
export const version = readFileSync(
  new URL("version.txt", root),
  "utf8",
).trim();
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error(
    "version.txt must contain a stable version such as 0.1.0 (without v)",
  );
}

export function syncVersion() {
  const replacements = {
    "build/config.yml": [/^(  version: ).*$/m, `$1${version}`],
    "build/darwin/Info.plist": [
      /(<key>CFBundle(?:ShortVersionString|Version)<\/key>\s*<string>)[^<]+/g,
      `$1${version}`,
    ],
    "build/darwin/Info.dev.plist": [
      /(<key>CFBundle(?:ShortVersionString|Version)<\/key>\s*<string>)[^<]+/g,
      `$1${version}`,
    ],
    "build/windows/info.json": [
      /("(?:file_version|ProductVersion)": ")[^"]+/g,
      `$1${version}`,
    ],
    "build/windows/wails.exe.manifest": [
      /(<assemblyIdentity type="win32" name="com.akmalfairuz.lightremote" version=")[^"]+/,
      `$1${version}`,
    ],
    "api/openapi.json": [/("version": ")[^"]+/, `$1${version}`],
  };
  for (const [path, [pattern, replacement]] of Object.entries(replacements)) {
    const url = new URL(path, root);
    const original = readFileSync(url, "utf8");
    if (!pattern.test(original))
      throw new Error(`Missing version field in ${path}`);
    pattern.lastIndex = 0;
    const updated = original.replace(pattern, replacement);
    if (updated !== original) writeFileSync(url, updated);
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  syncVersion();
