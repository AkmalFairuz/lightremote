import { appendFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { version } from "./version.mjs";

export function releaseTag(
  { event, ref, message = "", tag = "" },
  appVersion = version,
) {
  if (
    event === "push" &&
    ref === "refs/heads/master" &&
    message.startsWith("[release]")
  ) {
    const subject = message.split(/\r?\n/, 1)[0];
    const match =
      /^\[release\] (v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(
        subject,
      );
    if (!match)
      throw new Error(
        "Release commit subject must be exactly [release] vX.Y.Z",
      );
    if (match[1] !== `v${appVersion}`)
      throw new Error("Release commit version must match version.txt");
    return match[1];
  }
  if (event === "release") return tag;
  if (event === "push" && ref.startsWith("refs/tags/"))
    return ref.slice("refs/tags/".length);
  return "";
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const tag = releaseTag({
    event: process.env.EVENT_NAME,
    ref: process.env.EVENT_REF,
    message: process.env.COMMIT_MESSAGE,
    tag: process.env.RELEASE_TAG,
  });
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `tag=${tag}\nautomatic=${Boolean(tag && process.env.EVENT_REF === "refs/heads/master")}\n`,
  );
}
