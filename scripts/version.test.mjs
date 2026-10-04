import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const metadata = [
  "build/config.yml",
  "build/darwin/Info.plist",
  "build/darwin/Info.dev.plist",
  "build/windows/info.json",
  "build/windows/wails.exe.manifest",
  "api/openapi.json",
];
test("a version bump updates all packaging metadata and sync is idempotent", () => {
  const root = mkdtempSync(join(tmpdir(), "lightremote-version-"));
  try {
    for (const file of ["scripts/version.mjs", ...metadata]) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      copyFileSync(new URL(`../${file}`, import.meta.url), join(root, file));
    }
    writeFileSync(join(root, "version.txt"), "1.2.3\n");
    const sync = () =>
      execFileSync(process.execPath, [join(root, "scripts/version.mjs")], {
        stdio: "pipe",
      });
    sync();
    const contents = () =>
      metadata.map((file) => readFileSync(join(root, file), "utf8"));
    const before = contents();
    for (const content of before) assert.ok(content.includes("1.2.3"));
    sync();
    assert.deepEqual(contents(), before);
    writeFileSync(join(root, "version.txt"), "v1.2.3\n");
    assert.throws(sync, /version.txt must contain a stable version/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
