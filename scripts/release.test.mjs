import assert from "node:assert/strict";
import test from "node:test";
import { releaseTag } from "./release.mjs";

const push = { event: "push", ref: "refs/heads/master" };
test("release commits use the centralized version and allow a commit body", () => {
  assert.equal(
    releaseTag(
      { ...push, message: "[release] v0.1.0\n\nRelease notes" },
      "0.1.0",
    ),
    "v0.1.0",
  );
});
test("ordinary commits, other branches, and pull requests do not release", () => {
  for (const event of [
    { ...push, message: "fix: [release] v0.1.0" },
    { ...push, ref: "refs/heads/feature", message: "[release] v0.1.0" },
    {
      event: "pull_request",
      ref: "refs/pull/1/merge",
      message: "[release] v0.1.0",
    },
  ])
    assert.equal(releaseTag(event, "0.1.0"), "");
});
test("malformed or mismatched release commits fail before publishing", () => {
  for (const message of [
    "[release] v0.2.0",
    "[release] 0.1.0",
    "[release] v01.1.0",
    "[release] v0.1.0 extra",
    "[release] v0.1.0; echo injected",
  ]) {
    assert.throws(() => releaseTag({ ...push, message }, "0.1.0"));
  }
});
test("existing tag and published release builds retain their release target", () => {
  assert.equal(
    releaseTag({ event: "push", ref: "refs/tags/v0.1.0" }),
    "v0.1.0",
  );
  assert.equal(
    releaseTag({ event: "release", ref: "refs/tags/v0.1.0", tag: "v0.1.0" }),
    "v0.1.0",
  );
});
