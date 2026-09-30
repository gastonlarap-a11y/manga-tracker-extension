/**
 * Copies the built extension to a stable folder to load unpacked from.
 *
 * `wxt build` wipes `.output/`, so a browser pointed at `.output/chrome-mv3`
 * loses the extension on every build. This folder survives builds. It was a
 * shell one-liner with `$HOME/Library/...`, `mkdir -p` and `rsync`, none of
 * which exists on Windows; the same folder is now worked out per platform,
 * beside the desktop app's data directory (Go's os.UserConfigDir).
 *
 * Usage: bun run install:local   (builds first, then copies)
 */
import { cp, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// import.meta.url rather than Bun's import.meta.dir: the typecheck here runs
// against the extension's DOM types, which know only the standard one.
const source = fileURLToPath(new URL("../.output/chrome-mv3", import.meta.url));

function dataDir(): string {
  switch (process.platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", "MangaTracker");
    case "win32": {
      const appData = process.env.APPDATA;
      if (appData === undefined || appData === "") {
        throw new Error(
          "APPDATA is not set, so there is no folder to install into",
        );
      }
      return join(appData, "MangaTracker");
    }
    default:
      return join(
        process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
        "MangaTracker",
      );
  }
}

const target = join(dataDir(), "extension");
const staging = `${target}.new`;
const retired = `${target}.old`;

// Copied beside the target and swapped in with renames, so the browser never
// finds a half-copied extension — what `rsync --delete-after` guaranteed — and
// replaced rather than merged, so a file removed from the build does not live
// on in the copy it loads.
await rm(staging, { recursive: true, force: true });
await cp(source, staging, { recursive: true });
await rm(retired, { recursive: true, force: true });
try {
  await rename(target, retired);
} catch (cause) {
  // Nothing installed yet is the first run, not a failure. Cast justified:
  // node:fs rejects with an ErrnoException, whose `code` is the only field read.
  if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
    throw cause;
  }
}
await rename(staging, target);
await rm(retired, { recursive: true, force: true });
console.log(`Installed the unpacked build into ${target}`);
