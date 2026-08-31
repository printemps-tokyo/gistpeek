// Build the loadable extension, with no bundler in the way.
//
// Chrome runs ES modules in both the service worker and an extension page, so
// tsc alone is enough: compile, then copy the three things TypeScript does not
// touch (the manifest, the panel markup and the icons). `--tests` compiles the
// test tree instead, which is the only reason a second output directory exists.

import { cp, mkdir, rm, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const testsOnly = process.argv.includes("--tests");
const outDir = testsOnly ? "dist-test" : "dist";
const project = testsOnly ? "tsconfig.json" : "tsconfig.build.json";

await rm(join(root, outDir), { recursive: true, force: true });

const tsc = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["tsc", "-p", project, "--outDir", outDir],
  { cwd: root, stdio: "inherit" },
);
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

// A compile that emits nothing exits 0, and the failure then surfaces
// somewhere unrelated -- as a missing module, in another tool, on another
// machine. Check the output is there while we still know why it would not be.
const expected = join(root, outDir, testsOnly ? "test" : "src");
try {
  const emitted = await stat(expected);
  if (!emitted.isDirectory()) throw new Error("not a directory");
} catch {
  console.error(`gistpeek: tsc reported success but ${expected} is not there`);
  process.exit(1);
}

if (!testsOnly) {
  await mkdir(join(root, outDir, "src"), { recursive: true });
  for (const file of ["manifest.json"]) {
    await cp(join(root, file), join(root, outDir, file));
  }
  for (const file of ["sidepanel.html", "sidepanel.css"]) {
    await cp(join(root, "src", file), join(root, outDir, "src", file));
  }
  await cp(join(root, "icons"), join(root, outDir, "icons"), { recursive: true });
  console.log(`gistpeek: built ${outDir}/ -- load it with chrome://extensions -> Load unpacked`);
}
